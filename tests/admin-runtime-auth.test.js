const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

async function withEnv(patch, callback) {
    const previous = {};

    for (const [key, value] of Object.entries(patch || {})) {
        previous[key] = process.env[key];
        if (value === undefined || value === null) {
            delete process.env[key];
        } else {
            process.env[key] = String(value);
        }
    }

    try {
        return await callback();
    } finally {
        for (const key of Object.keys(patch || {})) {
            if (previous[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = previous[key];
            }
        }
    }
}

async function withAdminModule(createClientImpl, callback) {
    const modulePath = path.resolve(__dirname, '../api/_lib/admin.js');
    const originalLoad = Module._load;
    const state = {
        clients: []
    };

    delete require.cache[modulePath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '@supabase/supabase-js') {
            return {
                createClient(url, key, options = {}) {
                    const client = createClientImpl({ url, key, options, state });
                    state.clients.push({ url, key, options, client });
                    return client;
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let adminModule;
    try {
        adminModule = require(modulePath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback({ adminModule, state });
    } finally {
        delete require.cache[modulePath];
    }
}

function createMockResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
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

async function withPaymentHandler(handlerRelativePath, options, callback) {
    const handlerPath = path.resolve(__dirname, handlerRelativePath);
    const originalLoad = Module._load;
    const state = {
        paymentCalls: []
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../_lib/admin' || request === '../../_lib/admin') {
            return {
                async requireAuthenticatedUser(req) {
                    if (typeof options.requireAuthenticatedUser === 'function') {
                        return options.requireAuthenticatedUser(req);
                    }
                    return options.authResult;
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                }
            };
        }

        if ((request === '../_lib/request-security' || request === '../../_lib/request-security') && options.requestSecurityModule) {
            return options.requestSecurityModule;
        }

        if (request === '../_lib/payments/orders' || request === '../../_lib/payments/orders') {
            return {
                async createPaymentRequest(payload) {
                    state.paymentCalls.push({ action: 'create', payload });
                    return { success: true, mode: 'create' };
                },
                async completeMockPayment(payload) {
                    state.paymentCalls.push({ action: 'mock-complete', payload });
                    return { success: true, mode: 'mock-complete' };
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

test('admin helper reads Supabase URL and publishable key from environment aliases', async () => {
    await withEnv({
        SUPABASE_URL: undefined,
        SUPABASE_PUBLISHABLE_KEY: undefined,
        SUPABASE_ANON_KEY: undefined,
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key-from-next'
    }, async () => {
        await withAdminModule(() => ({
            auth: {
                async getUser() {
                    return { data: { user: null }, error: { message: 'Unauthorized' } };
                }
            }
        }), async ({ adminModule }) => {
            assert.equal(adminModule.getSupabaseUrl(), 'https://example.supabase.co');
            assert.equal(adminModule.getSupabasePublishableKey(), 'public-key-from-next');
        });
    });
});

test('requireAuthenticatedUser returns a request-scoped client by default and exposes adminSupabase separately', async () => {
    await withEnv({
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'public-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key'
    }, async () => {
        await withAdminModule(({ key, options }) => {
            if (key === 'public-key') {
                return {
                    kind: 'request',
                    auth: {
                        async getUser(token) {
                            return {
                                data: {
                                    user: {
                                        id: 'user-1',
                                        email: 'member@example.com'
                                    }
                                },
                                error: null,
                                token,
                                headers: options?.global?.headers || {}
                            };
                        }
                    }
                };
            }

            if (key === 'service-key') {
                return {
                    kind: 'admin',
                    auth: {
                        async getUser() {
                            return {
                                data: {
                                    user: {
                                        id: 'user-1',
                                        email: 'member@example.com'
                                    }
                                },
                                error: null
                            };
                        }
                    }
                };
            }

            throw new Error(`Unexpected key: ${key}`);
        }, async ({ adminModule, state }) => {
            const result = await adminModule.requireAuthenticatedUser({
                headers: {
                    authorization: 'Bearer member-token'
                }
            });

            assert.equal(result.user.id, 'user-1');
            assert.equal(result.supabase.kind, 'request');
            assert.equal(result.requestSupabase.kind, 'request');
            assert.equal(result.adminSupabase.kind, 'admin');
            assert.equal(result.supabase, result.requestSupabase);

            const requestClients = state.clients.filter((entry) => entry.key === 'public-key');
            assert.equal(requestClients.length >= 2, true);
            assert.deepEqual(
                requestClients[0].options.global.headers,
                { Authorization: 'Bearer member-token' }
            );
        });
    });
});

test('requireAuthenticatedUser falls back to admin auth when no public client config is available', async () => {
    await withEnv({
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: undefined,
        SUPABASE_ANON_KEY: undefined,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
        SUPABASE_SERVICE_ROLE_KEY: 'service-key'
    }, async () => {
        await withAdminModule(({ key }) => {
            if (key === 'service-key') {
                return {
                    kind: 'admin',
                    auth: {
                        async getUser(token) {
                            assert.equal(token, 'admin-fallback-token');
                            return {
                                data: {
                                    user: {
                                        id: 'user-2',
                                        email: 'fallback@example.com'
                                    }
                                },
                                error: null
                            };
                        }
                    }
                };
            }

            throw new Error(`Unexpected key: ${key}`);
        }, async ({ adminModule }) => {
            const result = await adminModule.requireAuthenticatedUser({
                headers: {
                    authorization: 'Bearer admin-fallback-token'
                }
            });

            assert.equal(result.user.id, 'user-2');
            assert.equal(result.requestSupabase, null);
            assert.equal(result.supabase.kind, 'admin');
            assert.equal(result.adminSupabase.kind, 'admin');
        });
    });
});

test('requireAdmin also falls back to admin client when no public client config is available', async () => {
    await withEnv({
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: undefined,
        SUPABASE_ANON_KEY: undefined,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
        SUPABASE_SERVICE_ROLE_KEY: 'service-key'
    }, async () => {
        await withAdminModule(({ key }) => {
            if (key === 'service-key') {
                return {
                    kind: 'admin',
                    auth: {
                        async getUser(token) {
                            assert.equal(token, 'admin-token');
                            return {
                                data: {
                                    user: {
                                        id: 'admin-1',
                                        email: 'admin@example.com'
                                    }
                                },
                                error: null
                            };
                        }
                    },
                    async rpc(name, args) {
                        assert.equal(name, 'get_user_permissions');
                        assert.deepEqual(args, { p_user_id: 'admin-1' });
                        return {
                            data: {
                                is_admin: true,
                                is_super_admin: false,
                                role: 'admin',
                                permissions: ['*'],
                                expires_at: null
                            },
                            error: null
                        };
                    }
                };
            }

            throw new Error(`Unexpected key: ${key}`);
        }, async ({ adminModule }) => {
            const result = await adminModule.requireAdmin({
                headers: {
                    authorization: 'Bearer admin-token'
                }
            });

            assert.equal(result.user.id, 'admin-1');
            assert.equal(result.requestSupabase, null);
            assert.equal(result.supabase.kind, 'admin');
            assert.equal(result.adminSupabase.kind, 'admin');
            assert.equal(result.roles[0].role_name, 'admin');
        });
    });
});

test('payment create handler passes request and admin Supabase clients separately', async () => {
    await withPaymentHandler('../api/payments/create.js', {
        authResult: {
            user: { id: 'user-1' },
            supabase: { kind: 'request' },
            requestSupabase: { kind: 'request' },
            adminSupabase: { kind: 'admin' }
        }
    }, async ({ handler, state }) => {
        const req = {
            method: 'POST',
            headers: {
                host: 'zaoyoe.com'
            },
            body: {
                package_id: 'pkg-1'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.paymentCalls.length, 1);
        assert.equal(state.paymentCalls[0].action, 'create');
        assert.equal(state.paymentCalls[0].payload.supabase.kind, 'request');
        assert.equal(state.paymentCalls[0].payload.adminSupabase.kind, 'admin');
    });
});

test('payment create handler returns 429 when rate-limited before auth or order writes', async () => {
    let authCalled = false;

    await withPaymentHandler('../api/payments/create.js', {
        requireAuthenticatedUser() {
            authCalled = true;
            throw new Error('should not run');
        },
        requestSecurityModule: {
            resolveClientIp() {
                return '203.0.113.21';
            },
            takeRateLimitToken() {
                return {
                    allowed: false,
                    limit: 12,
                    remaining: 0,
                    resetAt: Date.now() + 15_000,
                    retryAfterSeconds: 15
                };
            },
            applyRateLimitHeaders(res) {
                res.setHeader('Retry-After', '15');
            }
        }
    }, async ({ handler, state }) => {
        const req = {
            method: 'POST',
            headers: {
                host: 'zaoyoe.com'
            },
            body: {
                package_id: 'pkg-1'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 429);
        assert.equal(payload.success, false);
        assert.equal(payload.code, 'rate_limited');
        assert.equal(state.paymentCalls.length, 0);
        assert.equal(authCalled, false);
    });
});

test('mock payment completion explicitly prefers adminSupabase for privileged writes', async () => {
    await withPaymentHandler('../api/payments/mock/complete.js', {
        authResult: {
            user: { id: 'user-1' },
            supabase: { kind: 'request' },
            adminSupabase: { kind: 'admin' }
        }
    }, async ({ handler, state }) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                order_no: 'mock-1'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.paymentCalls.length, 1);
        assert.equal(state.paymentCalls[0].action, 'mock-complete');
        assert.equal(state.paymentCalls[0].payload.supabase.kind, 'admin');
    });
});
