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

async function withShopPurchaseHandler(mockAdminModule, callback, mockRequestSecurityModule = null) {
    const handlerPath = path.resolve(__dirname, '../api/shop/purchase.js');
    const originalLoad = Module._load;
    const resolvedAdminModule = {
        getOptionalSupabaseAdmin() {
            return null;
        },
        async parseJsonBody(req) {
            return req.body || {};
        },
        ...mockAdminModule
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../_lib/admin') {
            return resolvedAdminModule;
        }

        if (request === '../_lib/request-security' && mockRequestSecurityModule) {
            return mockRequestSecurityModule;
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

test('shop purchase only allows POST', async () => {
    await withShopPurchaseHandler({
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        }
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(res.headers.allow, 'POST');
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});

test('shop purchase rejects IP-rate-limited requests before checking auth', async () => {
    let authCalled = false;

    await withShopPurchaseHandler({
        async requireAuthenticatedUser() {
            authCalled = true;
            throw new Error('should not run');
        },
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        }
    }, async (handler) => {
        const req = {
            method: 'POST',
            headers: {
                'x-forwarded-for': '203.0.113.18'
            },
            body: {}
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 429);
        assert.equal(payload.success, false);
        assert.equal(payload.code, 'rate_limited');
        assert.equal(authCalled, false);
    }, {
        resolveClientIp() {
            return '203.0.113.18';
        },
        takeRateLimitToken() {
            return {
                allowed: false,
                limit: 12,
                remaining: 0,
                resetAt: Date.now() + 30_000,
                retryAfterSeconds: 30
            };
        },
        applyRateLimitHeaders(res) {
            res.setHeader('Retry-After', '30');
        }
    });
});

test('shop purchase uses the request-scoped client and normalized payload', async () => {
    const rpcCalls = [];
    const rateLimitKeys = [];

    await withShopPurchaseHandler({
        async requireAuthenticatedUser() {
            return {
                user: {
                    id: 'user-1',
                    email: 'member@example.com'
                },
                requestSupabase: {
                    rpc(name, params) {
                        rpcCalls.push({ name, params });
                        return Promise.resolve({
                            data: {
                                success: true,
                                data: {
                                    order_id: 'order-1',
                                    remaining_points: 8,
                                    content: 'KEY-123'
                                }
                            },
                            error: null
                        });
                    }
                },
                supabase: null
            };
        },
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        }
    }, async (handler) => {
        const req = {
            method: 'POST',
            headers: {
                'x-forwarded-for': '203.0.113.25'
            },
            body: {
                productId: ' product-1 ',
                quantity: 2.9,
                discountCode: ' abcd1234 ',
                agentId: ' agent-7 ',
                site: 'cn',
                idempotencyKey: 'purchase-attempt-1'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(rpcCalls.length, 1);
        assert.deepEqual(rpcCalls[0], {
            name: 'fn_purchase_shop_item',
            params: {
                p_product_id: 'product-1',
                p_user_id: 'user-1',
                p_site: 'cn',
                p_quantity: 2,
                p_discount_code: 'ABCD1234',
                p_agent_id: 'agent-7'
            }
        });
        assert.equal(rateLimitKeys.length, 3);
        assert.equal(rateLimitKeys[0], 'shop-purchase:ip:203.0.113.25');
        assert.equal(rateLimitKeys[1], 'shop-purchase:user:user-1');
        assert.match(rateLimitKeys[2], /^shop-purchase:idempotency:user-1:[a-f0-9]{64}$/);
    }, {
        resolveClientIp() {
            return '203.0.113.25';
        },
        takeRateLimitToken(options = {}) {
            rateLimitKeys.push(options.key);
            return {
                allowed: true,
                limit: 10,
                remaining: 9,
                resetAt: Date.now() + 60_000,
                retryAfterSeconds: 60
            };
        },
        applyRateLimitHeaders() {}
    });
});

test('shop purchase rejects duplicate submissions before executing the purchase RPC', async () => {
    let rpcCalled = false;

    await withShopPurchaseHandler({
        async requireAuthenticatedUser() {
            return {
                user: {
                    id: 'user-dup',
                    email: 'member@example.com'
                },
                requestSupabase: {
                    rpc() {
                        rpcCalled = true;
                        return Promise.resolve({ data: null, error: null });
                    }
                },
                supabase: null
            };
        },
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        }
    }, async (handler) => {
        const req = {
            method: 'POST',
            headers: {
                'x-forwarded-for': '203.0.113.99'
            },
            body: {
                productId: 'product-2',
                quantity: 1,
                site: 'intl',
                idempotencyKey: 'same-click-token'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 409);
        assert.equal(payload.success, false);
        assert.equal(payload.code, 'duplicate_submission');
        assert.equal(rpcCalled, false);
    }, {
        resolveClientIp() {
            return '203.0.113.99';
        },
        takeRateLimitToken(options = {}) {
            if (String(options.key || '').startsWith('shop-purchase:idempotency:')) {
                return {
                    allowed: false,
                    limit: 1,
                    remaining: 0,
                    resetAt: Date.now() + 45_000,
                    retryAfterSeconds: 45
                };
            }

            return {
                allowed: true,
                limit: 10,
                remaining: 9,
                resetAt: Date.now() + 60_000,
                retryAfterSeconds: 60
            };
        },
        applyRateLimitHeaders() {}
    });
});
