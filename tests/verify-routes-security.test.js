const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { PassThrough } = require('node:stream');
const Module = require('node:module');

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        order: null,
        limit: null,
        payload: null,
        single: false,
        maybeSingle: false
    };

    const builder = {
        select() {
            return builder;
        },
        eq(column, value) {
            state.filters.push({ column, value });
            return builder;
        },
        order(column, options = {}) {
            state.order = { column, options };
            return builder;
        },
        limit(value) {
            state.limit = value;
            return builder;
        },
        single() {
            state.single = true;
            return builder;
        },
        maybeSingle() {
            state.maybeSingle = true;
            return builder;
        },
        insert(payload) {
            state.mode = 'insert';
            state.payload = payload;
            return builder;
        },
        update(payload) {
            state.mode = 'update';
            state.payload = payload;
            return builder;
        },
        delete() {
            state.mode = 'delete';
            return builder;
        },
        then(resolve, reject) {
            return Promise.resolve(executor(state)).then(resolve, reject);
        },
        catch(reject) {
            return builder.then(undefined, reject);
        }
    };

    return builder;
}

function getFilterValue(query, column) {
    return query.filters.find((item) => item.column === column)?.value;
}

function applyCommonFilters(rows, query) {
    return rows.filter((row) => query.filters.every(({ column, value }) => row[column] === value));
}

function createSupabaseStub(state = {}) {
    const tokens = state.tokens || {};
    const verificationLogs = state.verificationLogs || [];
    const adminRoles = state.adminRoles || {};
    const permissions = state.permissions || {};
    const verifySettings = state.verifySettings || {
        price_per_verify: 10,
        verify_api_key: 'verify-api-key',
        verify_api_base_url: 'https://verify.test'
    };

    return {
        auth: {
            async getUser(token) {
                const user = tokens[String(token || '').trim()];
                if (user) {
                    return { data: { user }, error: null };
                }
                return { data: { user: null }, error: { message: 'Unauthorized' } };
            }
        },
        async rpc(name, args = {}) {
            if (name === 'get_user_permissions') {
                return {
                    data: permissions[args.p_user_id] || {
                        is_admin: false,
                        is_super_admin: false
                    },
                    error: null
                };
            }

            throw new Error(`Unexpected RPC in test stub: ${name}`);
        },
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'system_config' && query.mode === 'select') {
                    const configKey = getFilterValue(query, 'config_key');
                    if (configKey !== 'verify_settings') {
                        return { data: null, error: null };
                    }

                    const row = { config_value: verifySettings };
                    return {
                        data: query.single || query.maybeSingle ? row : [row],
                        error: null
                    };
                }

                if (table === 'verification_logs' && query.mode === 'select') {
                    let rows = applyCommonFilters(verificationLogs, query);
                    if (query.order?.column === 'created_at') {
                        const ascending = query.order.options?.ascending !== false;
                        rows = [...rows].sort((left, right) => {
                            const leftTime = Date.parse(left.created_at || 0);
                            const rightTime = Date.parse(right.created_at || 0);
                            return ascending ? leftTime - rightTime : rightTime - leftTime;
                        });
                    }
                    if (Number.isFinite(query.limit)) {
                        rows = rows.slice(0, query.limit);
                    }

                    return { data: rows, error: null };
                }

                if (table === 'admin_roles' && query.mode === 'select') {
                    let rows = (adminRoles[getFilterValue(query, 'user_id')] || []).map((role) => ({
                        role_name: role.role_name || 'admin',
                        expires_at: role.expires_at || null
                    }));

                    if (Number.isFinite(query.limit)) {
                        rows = rows.slice(0, query.limit);
                    }

                    return { data: rows, error: null };
                }

                throw new Error(`Unexpected table access in test stub: ${table}/${query.mode}`);
            });
        }
    };
}

async function withTestServer(state, callback) {
    const serverPath = path.resolve(__dirname, '../server/index.js');
    const originalLoad = Module._load;
    const fakeSupabase = createSupabaseStub(state);

    delete require.cache[serverPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '@supabase/supabase-js') {
            return {
                createClient() {
                    return fakeSupabase;
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let serverModule;
    try {
        serverModule = require(serverPath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback({ app: serverModule.app });
    } finally {
        delete require.cache[serverPath];
    }
}

async function dispatchRequest(app, {
    method = 'GET',
    url = '/',
    headers = {}
} = {}) {
    const responseChunks = [];
    const socket = new PassThrough();
    socket.remoteAddress = '127.0.0.1';
    socket.on('data', (chunk) => {
        responseChunks.push(Buffer.from(chunk));
    });

    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = url;
    req.headers = Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
    );
    req.push(null);

    const res = new http.ServerResponse(req);
    res.assignSocket(socket);
    app.handle(req, res);
    await once(res, 'finish');

    const rawResponse = Buffer.concat(responseChunks).toString('utf8');
    const separatorIndex = rawResponse.indexOf('\r\n\r\n');
    const body = separatorIndex >= 0
        ? rawResponse.slice(separatorIndex + 4)
        : rawResponse;

    return {
        status: res.statusCode,
        headers: res.getHeaders(),
        text: body,
        json() {
            return body ? JSON.parse(body) : {};
        }
    };
}

test('quota endpoint requires authentication', async () => {
    await withTestServer({}, async ({ app }) => {
        const response = await dispatchRequest(app, { url: '/api/quota' });
        const payload = response.json();

        assert.equal(response.status, 401);
        assert.equal(payload.code, 'unauthorized');
    });
});

test('queue endpoint requires admin privileges', async () => {
    await withTestServer({
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        }
    }, async ({ app }) => {
        const response = await dispatchRequest(app, {
            url: '/api/queue',
            headers: {
                Authorization: 'Bearer member-token'
            }
        });
        const payload = response.json();

        assert.equal(response.status, 403);
        assert.equal(payload.code, 'admin_required');
    });
});

test('queue endpoint allows admins and proxies upstream data', async () => {
    await withTestServer({
        tokens: {
            'admin-token': { id: 'admin-1', email: 'admin@example.com' }
        },
        permissions: {
            'admin-1': { is_admin: true, is_super_admin: false }
        }
    }, async ({ app }) => {
        const originalFetch = global.fetch;
        global.fetch = async (input, init) => {
            const url = String(input || '');
            if (url === 'https://verify.test/api/queue') {
                return new Response(JSON.stringify({
                    queue_size: 7,
                    running_jobs: 2
                }), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
            }

            throw new Error(`Unexpected fetch URL in test: ${url}`);
        };

        try {
            const response = await dispatchRequest(app, {
                url: '/api/queue',
                headers: {
                    Authorization: 'Bearer admin-token'
                }
            });
            const payload = response.json();

            assert.equal(response.status, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.queue_size, 7);
            assert.equal(payload.running_jobs, 2);
        } finally {
            global.fetch = originalFetch;
        }
    });
});

test('verify status endpoint rejects task ids not owned by the authenticated user', async () => {
    await withTestServer({
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        },
        verificationLogs: [
            {
                id: 'log-1',
                user_id: 'other-user',
                site: 'cn',
                verification_id: 'task-123',
                created_at: '2026-03-22T12:00:00.000Z',
                message: JSON.stringify({ job_id: 'task-123', email: 'other@example.com' })
            }
        ]
    }, async ({ app }) => {
        const response = await dispatchRequest(app, {
            url: '/api/verify/status/task-123',
            headers: {
                Authorization: 'Bearer member-token'
            }
        });
        const payload = response.json();

        assert.equal(response.status, 404);
        assert.equal(payload.code, 'job_not_found');
    });
});
