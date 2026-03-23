const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

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
        },
        get headers() {
            return state.headers;
        }
    };
}

function createRpcResult(data, error = null) {
    return {
        single() {
            return Promise.resolve({ data, error });
        },
        then(resolve, reject) {
            return Promise.resolve({ data, error }).then(resolve, reject);
        }
    };
}

async function withLoginSecurityHandler({
    adminModule,
    requestSecurityModule = null
}, callback) {
    const handlerPath = path.resolve(__dirname, '../api/auth/login-security.js');
    const originalLoad = Module._load;

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../_lib/admin') {
            return adminModule;
        }

        if (request === '../_lib/request-security' && requestSecurityModule) {
            return requestSecurityModule;
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
        return await callback(handler);
    } finally {
        delete require.cache[handlerPath];
    }
}

test('login security preflight reports locked accounts without exposing extra data', async () => {
    const rpcCalls = [];
    await withLoginSecurityHandler({
        adminModule: {
            getSupabaseAdmin() {
                return {
                    rpc(name, args) {
                        rpcCalls.push({ name, args });
                        if (name === 'check_ip_blacklisted') {
                            return Promise.resolve({
                                data: { blocked: false },
                                error: null
                            });
                        }

                        if (name === 'check_user_locked') {
                            return createRpcResult({
                                is_locked: true,
                                locked_until: '2026-03-23T12:00:00.000Z',
                                remaining_seconds: 420
                            });
                        }

                        throw new Error(`Unexpected RPC: ${name}`);
                    }
                };
            },
            async parseJsonBody(req) {
                return req.body || {};
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            }
        },
        requestSecurityModule: {
            resolveClientIp() {
                return '203.0.113.8';
            },
            takeRateLimitToken() {
                return {
                    allowed: true,
                    limit: 20,
                    remaining: 19,
                    resetAt: Date.now() + 60_000
                };
            },
            applyRateLimitHeaders() {}
        }
    }, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                action: 'preflight',
                email: 'Member@Example.com'
            },
            headers: {}
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.action, 'preflight');
        assert.equal(payload.security.ip_blocked, false);
        assert.equal(payload.security.account_locked, true);
        assert.equal(payload.security.remaining_seconds, 420);
        assert.equal(rpcCalls[1].args.user_email, 'member@example.com');
    });
});

test('login security record_failure surfaces automatic IP blacklisting after repeated abuse', async () => {
    let ipCheckCalls = 0;
    await withLoginSecurityHandler({
        adminModule: {
            getSupabaseAdmin() {
                return {
                    from(table) {
                        assert.equal(table, 'system_config');
                        return {
                            select() { return this; },
                            eq() { return this; },
                            maybeSingle() {
                                return Promise.resolve({
                                    data: {
                                        config_value: {
                                            login_lockout_attempts: 4,
                                            lockout_duration: 600000
                                        }
                                    },
                                    error: null
                                });
                            }
                        };
                    },
                    rpc(name) {
                        if (name === 'check_ip_blacklisted') {
                            ipCheckCalls += 1;
                            return Promise.resolve({
                                data: {
                                    blocked: ipCheckCalls > 1,
                                    reason: ipCheckCalls > 1 ? 'auto blacklist' : null,
                                    expires_at: ipCheckCalls > 1 ? '2026-03-24T00:00:00.000Z' : null
                                },
                                error: null
                            });
                        }

                        if (name === 'record_login_failure') {
                            return createRpcResult({
                                is_now_locked: true,
                                locked_until: '2026-03-23T12:00:00.000Z',
                                ip_auto_blocked: true
                            });
                        }

                        return Promise.resolve({
                            data: { blocked: false },
                            error: null
                        });
                    }
                };
            },
            async parseJsonBody(req) {
                return req.body || {};
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            }
        },
        requestSecurityModule: {
            resolveClientIp() {
                return '198.51.100.18';
            },
            takeRateLimitToken() {
                return {
                    allowed: true,
                    limit: 20,
                    remaining: 19,
                    resetAt: Date.now() + 60_000
                };
            },
            applyRateLimitHeaders() {}
        }
    }, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                action: 'record_failure',
                email: 'member@example.com'
            },
            headers: {}
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.security.account_locked, true);
        assert.equal(payload.security.ip_blocked, true);
        assert.equal(payload.security.ip_block_reason, 'auto blacklist');
    });
});

test('login security endpoint returns 429 when rate limited before touching Supabase', async () => {
    let getSupabaseAdminCalled = false;
    await withLoginSecurityHandler({
        adminModule: {
            getSupabaseAdmin() {
                getSupabaseAdminCalled = true;
                throw new Error('should not run');
            },
            async parseJsonBody(req) {
                return req.body || {};
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            }
        },
        requestSecurityModule: {
            resolveClientIp() {
                return '203.0.113.10';
            },
            takeRateLimitToken() {
                return {
                    allowed: false,
                    limit: 20,
                    remaining: 0,
                    resetAt: Date.now() + 30_000,
                    retryAfterSeconds: 30
                };
            },
            applyRateLimitHeaders(res) {
                res.setHeader('Retry-After', '30');
            }
        }
    }, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                action: 'preflight',
                email: 'member@example.com'
            },
            headers: {}
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 429);
        assert.equal(payload.success, false);
        assert.equal(payload.retry_after_seconds, 30);
        assert.equal(getSupabaseAdminCalled, false);
    });
});
