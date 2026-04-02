const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function createMockResponse() {
    const state = {
        statusCode: 200,
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader() {
            return this;
        },
        end(payload = '') {
            state.body = String(payload || '');
            return this;
        },
        json() {
            return state.body ? JSON.parse(state.body) : {};
        },
        get statusCode() {
            return state.statusCode;
        }
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeComparable(value) {
    return value == null ? '' : String(value);
}

function createSupabase(state) {
    function maybeSingle(table, filters = []) {
        const row = (state.tables[table] || []).find((item) => filters.every((filter) => (
            normalizeComparable(item?.[filter.field]) === normalizeComparable(filter.value)
        )));
        return Promise.resolve({
            data: row ? clone(row) : null,
            error: null
        });
    }

    return {
        async rpc(fn, args) {
            state.rpcCalls.push({ fn, args: clone(args) });
            if (fn !== 'fn_check_code_status') {
                throw new Error(`Unexpected rpc: ${fn}`);
            }

            if (String(args?.p_code || '').toUpperCase() === 'ZY-CN-LOOKUP') {
                return {
                    data: {
                        valid: true,
                        query_type: 'code',
                        code: 'ZY-CN-LOOKUP',
                        status: 'used',
                        batch_id: 'batch-cn-1',
                        batch_name: 'CN Batch',
                        package_name: 'Starter',
                        points: 100,
                        used_by: 'Alice'
                    },
                    error: null
                };
            }

            return {
                data: { valid: false },
                error: null
            };
        },
        from(table) {
            return {
                select() {
                    return {
                        eq(field, value) {
                            const filters = [{ field, value }];
                            return {
                                maybeSingle() {
                                    return maybeSingle(table, filters);
                                }
                            };
                        }
                    };
                }
            };
        }
    };
}

async function withPointsLookupHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/points/lookup.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        rpcCalls: [],
        tables: {
            points_ledger: clone(options?.tables?.points_ledger || []),
            profiles: clone(options?.tables?.profiles || []),
            prompts: clone(options?.tables?.prompts || [])
        }
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite(value, { defaultValue } = {}) {
                    const normalized = String(value || '').trim().toLowerCase();
                    if (normalized === 'intl') return 'intl';
                    if (normalized === 'cn') return 'cn';
                    if (normalized === 'all') return 'all';
                    return defaultValue || '';
                },
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        supabase: createSupabase(state)
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let handler;
    try {
        handler = require(handlerPath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback({ handler, state });
    } finally {
        delete require.cache[handlerPath];
    }
}

test('points lookup handler returns code status payload via fn_check_code_status', async () => {
    await withPointsLookupHandler({ tables: {} }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', url: '/api/admin/points/lookup?site=cn&q=ZY-CN-LOOKUP', headers: {} }, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'points.manage' });
        assert.equal(state.rpcCalls[0]?.fn, 'fn_check_code_status');
        assert.equal(res.json().kind, 'code');
        assert.equal(res.json().result?.code, 'ZY-CN-LOOKUP');
    });
});

test('points lookup handler falls back to ledger lookup for UUID ids and attaches prompt title', async () => {
    await withPointsLookupHandler({
        tables: {
            points_ledger: [
                {
                    id: '11111111-1111-4111-8111-111111111111',
                    site: 'cn',
                    reason: 'unlock_prompt',
                    reference_id: 'prompt-1',
                    amount: -20,
                    user_id: 'user-1',
                    created_at: '2026-04-01T10:00:00.000Z'
                }
            ],
            profiles: [
                { id: 'user-1', username: 'Alice', email: 'alice@example.com' }
            ],
            prompts: [
                { id: 'prompt-1', title: 'Smoke Prompt' }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', url: '/api/admin/points/lookup?site=cn&q=11111111-1111-4111-8111-111111111111', headers: {} }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().kind, 'ledger');
        assert.equal(res.json().result?.prompt_title, 'Smoke Prompt');
        assert.equal(res.json().result?.profiles?.username, 'Alice');
    });
});
