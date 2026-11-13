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
    const resolvedAdminModule = {
        getOptionalSupabaseAdmin() {
            return null;
        },
        ...adminModule
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../_lib/admin') {
            return resolvedAdminModule;
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

test('login security rejects unauthenticated record_failure requests to prevent lockout DoS and allows internal secret calls', async () => {
    let ipCheckCalls = 0;
    let recordFailureCalls = 0;
    const prevSecret = process.env.INTERNAL_AUTH_SECURITY_SECRET;
    process.env.INTERNAL_AUTH_SECURITY_SECRET = 'test-internal-auth-secret';
    try {
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
                                recordFailureCalls += 1;
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
            const unauthRes = createMockResponse();
            await handler({
                method: 'POST',
                body: {
                    action: 'record_failure',
                    email: 'member@example.com'
                },
                headers: {}
            }, unauthRes);

            assert.equal(unauthRes.statusCode, 403);
            assert.equal(unauthRes.json().success, false);
            assert.equal(unauthRes.json().code, 'record_failure_forbidden');
            assert.equal(recordFailureCalls, 0);

            const internalRes = createMockResponse();
            await handler({
                method: 'POST',
                body: {
                    action: 'record_failure',
                    email: 'member@example.com'
                },
                headers: {
                    'x-internal-auth-secret': 'test-internal-auth-secret'
                }
            }, internalRes);
            const payload = internalRes.json();

            assert.equal(internalRes.statusCode, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.security.account_locked, true);
            assert.equal(payload.security.ip_blocked, true);
            assert.equal(payload.security.ip_block_reason, 'auto blacklist');
            assert.equal(recordFailureCalls, 1);
        });
    } finally {
        if (prevSecret === undefined) delete process.env.INTERNAL_AUTH_SECURITY_SECRET;
        else process.env.INTERNAL_AUTH_SECURITY_SECRET = prevSecret;
    }
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
        for (const action of ['preflight', 'preflight_ip']) {
            const req = {
                method: 'POST',
                body: action === 'preflight_ip' ? { action } : { action, email: 'member@example.com' },
                headers: {}
            };
            const res = createMockResponse();

            await handler(req, res);
            const payload = res.json();

            assert.equal(res.statusCode, 429);
            assert.equal(payload.success, false);
            assert.equal(payload.retry_after_seconds, 30);
            assert.equal(getSupabaseAdminCalled, false);
        }
    });
});

function ipPreflightFixture({ rpc, clientIp = '203.0.113.11', getSupabaseAdmin } = {}) {
    return {
        adminModule: {
            getSupabaseAdmin: getSupabaseAdmin || (() => ({ rpc })),
            async parseJsonBody(req) { return req.body || {}; },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            }
        },
        requestSecurityModule: {
            resolveClientIp() { return clientIp; },
            takeRateLimitToken() {
                return { allowed: true, limit: 20, remaining: 19, resetAt: Date.now() + 60_000 };
            },
            applyRateLimitHeaders() {}
        }
    };
}

test('IP preflight does not require an email and never checks or changes account state', async () => {
    for (const blocked of [false, true]) {
        const rpcCalls = [];
        await withLoginSecurityHandler(ipPreflightFixture({
            rpc(name, args) {
                rpcCalls.push({ name, args });
                assert.equal(name, 'check_ip_blacklisted');
                return Promise.resolve({ data: { blocked }, error: null });
            }
        }), async (handler) => {
            for (const body of [{ action: 'preflight_ip' }, { action: 'preflight_ip', email: 'ignored@example.com' }]) {
                const res = createMockResponse();
                await handler({ method: 'POST', body, headers: {} }, res);
                assert.equal(res.statusCode, 200);
                assert.equal(res.json().success, true);
                assert.equal(res.json().action, 'preflight_ip');
                assert.equal(res.json().security.ip_blocked, blocked);
                assert.equal(res.json().security.account_locked, false);
            }
            assert.deepEqual(rpcCalls, Array.from({ length: 2 }, () => ({
                name: 'check_ip_blacklisted', args: { client_ip: '203.0.113.11' }
            })));
        });
    }
});

test('account preflight and password failure still require an email', async () => {
    await withLoginSecurityHandler(ipPreflightFixture({
        getSupabaseAdmin() { throw new Error('database must not be reached'); }
    }), async (handler) => {
        for (const action of ['preflight', 'record_failure']) {
            for (const email of [undefined, '', '   ']) {
                const res = createMockResponse();
                await handler({ method: 'POST', body: { action, email }, headers: {} }, res);
                assert.equal(res.statusCode, 400);
                assert.equal(res.json().success, false);
                assert.equal(res.json().message, 'Email is required');
            }
        }
    });
});

test('IP preflight fails closed when the security database is unconfigured or unavailable', async () => {
    const fixtures = [
        ipPreflightFixture({ getSupabaseAdmin() { throw new Error('security database unavailable'); } }),
        ipPreflightFixture({ rpc() { return Promise.resolve({ data: null, error: new Error('IP lookup unavailable') }); } })
    ];
    for (const fixture of fixtures) {
        await withLoginSecurityHandler(fixture, async (handler) => {
            const res = createMockResponse();
            await handler({ method: 'POST', body: { action: 'preflight_ip' }, headers: {} }, res);
            assert.equal(res.statusCode, 500);
            assert.equal(res.json().success, false);
            assert.equal(res.json().security, undefined);
        });
    }
});

test('IP preflight fails closed when no client IP can be resolved', async () => {
    await withLoginSecurityHandler(ipPreflightFixture({
        clientIp: '', rpc() { throw new Error('empty IP must not be checked'); }
    }), async (handler) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: { action: 'preflight_ip' }, headers: {} }, res);
        assert.equal(res.statusCode, 503);
        assert.equal(res.json().success, false);
        assert.equal(res.json().security, undefined);
    });
});

test('IP preflight requires an explicit boolean decision from the security lookup', async () => {
    for (const data of [null, {}, { blocked: 'false' }, { blocked: 0 }]) {
        await withLoginSecurityHandler(ipPreflightFixture({
            rpc() { return Promise.resolve({ data, error: null }); }
        }), async (handler) => {
            const res = createMockResponse();
            await handler({ method: 'POST', body: { action: 'preflight_ip' }, headers: {} }, res);
            assert.equal(res.statusCode, 503);
            assert.equal(res.json().success, false);
            assert.equal(res.json().security, undefined);
        });
    }
});

test('password_login verifies credentials server-side, records real failures, and returns session on success', async () => {
    const rpcCalls = [];
    const signInCalls = [];
    let accountLocked = false;
    let authOutcome = { error: Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials', status: 400 }) };

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
                                    data: { config_value: { login_lockout_attempts: 2, lockout_duration: 600000 } },
                                    error: null
                                });
                            }
                        };
                    },
                    rpc(name, args) {
                        rpcCalls.push({ name, args });
                        if (name === 'check_ip_blacklisted') {
                            return Promise.resolve({ data: { blocked: false }, error: null });
                        }
                        if (name === 'check_user_locked') {
                            return createRpcResult({ is_locked: accountLocked, remaining_seconds: accountLocked ? 300 : 0 });
                        }
                        if (name === 'record_login_failure') {
                            return createRpcResult({ is_now_locked: true, locked_until: '2026-11-13T15:00:00.000Z', ip_auto_blocked: false });
                        }
                        if (name === 'reset_login_failures') {
                            return Promise.resolve({ data: null, error: null });
                        }
                        throw new Error(`Unexpected RPC ${name}`);
                    }
                };
            },
            createSupabasePasswordVerificationClient() {
                return {
                    auth: {
                        async signInWithPassword(input) {
                            signInCalls.push(input);
                            return authOutcome;
                        }
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
            resolveClientIp() { return '203.0.113.55'; },
            takeRateLimitToken() { return { allowed: true, limit: 20, remaining: 19, resetAt: Date.now() + 60_000 }; },
            applyRateLimitHeaders() {}
        }
    }, async (handler) => {
        const missingPasswordRes = createMockResponse();
        await handler({ method: 'POST', body: { action: 'password_login', email: 'user@example.com' }, headers: {} }, missingPasswordRes);
        assert.equal(missingPasswordRes.statusCode, 400);

        const badCredsRes = createMockResponse();
        await handler({
            method: 'POST',
            body: { action: 'password_login', email: 'User@Example.com ', password: 'wrong-password', captchaToken: 'cf-turnstile-tok' },
            headers: {}
        }, badCredsRes);
        assert.equal(badCredsRes.statusCode, 401);
        assert.equal(badCredsRes.json().code, 'invalid_credentials');
        assert.equal(badCredsRes.json().security.account_locked, true);
        assert.deepEqual(signInCalls[0], {
            email: 'user@example.com',
            password: 'wrong-password',
            options: { captchaToken: 'cf-turnstile-tok' }
        });
        assert.ok(rpcCalls.some((c) => c.name === 'record_login_failure'));

        const priorFailures = rpcCalls.filter((c) => c.name === 'record_login_failure').length;
        authOutcome = { error: Object.assign(new Error('Email not confirmed'), { code: 'email_not_confirmed', status: 400 }) };
        const unconfirmedRes = createMockResponse();
        await handler({ method: 'POST', body: { action: 'password_login', email: 'user@example.com', password: 'good-password' }, headers: {} }, unconfirmedRes);
        assert.equal(unconfirmedRes.statusCode, 400);
        assert.equal(unconfirmedRes.json().code, 'email_not_confirmed');
        assert.equal(rpcCalls.filter((c) => c.name === 'record_login_failure').length, priorFailures);

        authOutcome = {
            data: {
                session: { access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 3600, token_type: 'bearer' },
                user: { id: 'user-1', email: 'user@example.com' }
            },
            error: null
        };
        const successRes = createMockResponse();
        await handler({ method: 'POST', body: { action: 'password_login', email: 'user@example.com', password: 'good-password' }, headers: {} }, successRes);
        assert.equal(successRes.statusCode, 200);
        assert.equal(successRes.json().success, true);
        assert.equal(successRes.json().session.access_token, 'acc-1');
        assert.ok(rpcCalls.some((c) => c.name === 'reset_login_failures' && c.args.user_email === 'user@example.com'));

        accountLocked = true;
        const lockedSignInsBefore = signInCalls.length;
        const lockedRes = createMockResponse();
        await handler({ method: 'POST', body: { action: 'password_login', email: 'user@example.com', password: 'good-password' }, headers: {} }, lockedRes);
        assert.equal(lockedRes.statusCode, 429);
        assert.equal(lockedRes.json().code, 'account_locked');
        assert.equal(signInCalls.length, lockedSignInsBefore);
    });
});
