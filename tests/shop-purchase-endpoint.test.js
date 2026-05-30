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

async function withShopPurchaseHandler(mockAdminModule, callback, mockRequestSecurityModule = null, mockExtraModules = {}) {
    const handlerPath = path.resolve(__dirname, '../api/shop/purchase.js');
    const sharedHandlerPath = path.resolve(__dirname, '../server/api-handlers/public/shop.js');
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
    delete require.cache[sharedHandlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../_lib/admin') {
            return resolvedAdminModule;
        }

        if (request === '../_lib/request-security' && mockRequestSecurityModule) {
            return mockRequestSecurityModule;
        }

        if (Object.prototype.hasOwnProperty.call(mockExtraModules, request)) {
            return mockExtraModules[request];
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
        delete require.cache[sharedHandlerPath];
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
                                    content: 'KEY-123',
                                    discount_code: 'ABCD1234',
                                    subtotal: 200,
                                    discount_amount: 20,
                                    final_total: 180,
                                    is_exclusive: false,
                                    stack_priority: 12,
                                    pricing_apply_stage: 'catalog_price'
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
        assert.match(String(res.headers['server-timing'] || ''), /shop-purchase-iplimit;dur=\d+/);
        assert.match(String(res.headers['server-timing'] || ''), /shop-purchase-auth;dur=\d+/);
        assert.match(String(res.headers['server-timing'] || ''), /shop-purchase-rpc;dur=\d+/);
        assert.match(String(res.headers['server-timing'] || ''), /shop-purchase-followups;dur=\d+/);
        assert.match(String(res.headers['server-timing'] || ''), /shop-purchase-total;dur=\d+/);
        assert.equal(rpcCalls.length, 1);
        assert.deepEqual(payload.data.stacking_policy, {
            is_exclusive: false,
            stack_priority: 12,
            pricing_apply_stage: 'catalog_price',
            apply_stage_label: '目录价阶段',
            exclusivity_label: '可并行权益',
            summary: '这张券可与其它可并行权益叠加，在 目录价阶段 按优先级 12 参与结算。'
        });
        assert.equal(Array.isArray(payload.data.pricing_waterfall), true);
        assert.equal(payload.data.pricing_waterfall.length, 4);
        assert.equal(payload.data.pricing_waterfall[2].key, 'discount');
        assert.equal(payload.data.pricing_waterfall[2].amount, 20);
        assert.equal(payload.data.pricing_waterfall[2].display_amount, -20);
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

test('shop purchase rejects manual-delivery products before purchase RPC', async () => {
    let rpcCalled = false;
    const rateLimitKeys = [];
    const availabilityClient = {
        from(table) {
            assert.equal(table, 'shop_products');
            return {
                select(selectClause) {
                    assert.match(selectClause, /manual_delivery/);
                    return this;
                },
                eq(field, value) {
                    assert.equal(field, 'id');
                    assert.equal(value, 'product-manual');
                    return this;
                },
                maybeSingle() {
                    return Promise.resolve({
                        data: {
                            id: 'product-manual',
                            is_active: true,
                            manual_delivery: true
                        },
                        error: null
                    });
                }
            };
        }
    };

    await withShopPurchaseHandler({
        async requireAuthenticatedUser() {
            return {
                user: {
                    id: 'user-manual',
                    email: 'manual@example.com'
                },
                requestSupabase: {
                    rpc() {
                        rpcCalled = true;
                        throw new Error('manual products should not reach RPC');
                    }
                },
                adminSupabase: availabilityClient,
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
                'x-forwarded-for': '203.0.113.44'
            },
            body: {
                productId: 'product-manual',
                quantity: 1,
                site: 'cn',
                idempotencyKey: 'manual-click'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 409);
        assert.equal(payload.success, false);
        assert.equal(payload.code, 'manual_delivery_unavailable');
        assert.equal(rpcCalled, false);
        assert.deepEqual(rateLimitKeys, ['shop-purchase:ip:203.0.113.44']);
    }, {
        resolveClientIp() {
            return '203.0.113.44';
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

test('shop purchase responds before slow post-purchase follow-ups finish', async () => {
    const rpcCalls = [];
    let releaseFollowups = () => {};
    let affiliateStarted = false;
    let affiliateFinished = false;
    let tagStarted = false;
    let tagFinished = false;
    const slowFollowup = new Promise((resolve) => {
        releaseFollowups = resolve;
    });
    const systemSupabase = {
        from() {
            return {};
        }
    };

    await withShopPurchaseHandler({
        async requireAuthenticatedUser() {
            return {
                user: {
                    id: 'user-fast-followup',
                    email: 'member@example.com'
                },
                requestSupabase: {
                    rpc(name, params) {
                        rpcCalls.push({ name, params });
                        return Promise.resolve({
                            data: {
                                success: true,
                                data: {
                                    order_id: 'order-fast-followup-1',
                                    remaining_points: 42,
                                    content: 'KEY-FAST-001'
                                }
                            },
                            error: null
                        });
                    }
                },
                adminSupabase: systemSupabase,
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
                'x-forwarded-for': '203.0.113.39'
            },
            body: {
                productId: 'product-fast-followup-1',
                quantity: 1,
                site: 'cn',
                idempotencyKey: 'fast-followup-click-1'
            }
        };
        const res = createMockResponse();
        const handlerPromise = handler(req, res);
        const raceResult = await Promise.race([
            handlerPromise.then(() => 'responded'),
            new Promise((resolve) => setTimeout(() => resolve('blocked'), 30))
        ]);

        if (raceResult !== 'responded') {
            releaseFollowups();
        }

        assert.equal(raceResult, 'responded');
        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(rpcCalls.length, 1);
        assert.equal(affiliateStarted, false);
        assert.equal(tagStarted, false);
        assert.equal(affiliateFinished, false);
        assert.equal(tagFinished, false);

        releaseFollowups();
        await handlerPromise;
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(affiliateFinished, true);
        assert.equal(tagFinished, true);
    }, {
        resolveClientIp() {
            return '203.0.113.39';
        },
        takeRateLimitToken() {
            return {
                allowed: true,
                limit: 10,
                remaining: 9,
                resetAt: Date.now() + 60_000,
                retryAfterSeconds: 60
            };
        },
        applyRateLimitHeaders() {}
    }, {
        '../../../api/_lib/discount-trigger-linkage': {
            async maybeIssueAffiliateDiscountAssetsForShopOrder() {
                affiliateStarted = true;
                await slowFollowup;
                affiliateFinished = true;
                return { success: true };
            }
        },
        '../../../api/_lib/user-tags': {
            async markUserAsPaid() {
                tagStarted = true;
                await slowFollowup;
                tagFinished = true;
                return { ok: true };
            }
        }
    });
});

test('shop purchase forwards discount asset id to the purchase rpc', async () => {
    const rpcCalls = [];

    await withShopPurchaseHandler({
        async requireAuthenticatedUser() {
            return {
                user: {
                    id: 'user-asset',
                    email: 'member@example.com'
                },
                requestSupabase: {
                    rpc(name, params) {
                        rpcCalls.push({ name, params });
                        return Promise.resolve({
                            data: {
                                success: true,
                                data: {
                                    order_id: 'order-asset-1',
                                    remaining_points: 66,
                                    content: 'KEY-ASSET-001',
                                    discount_code: 'WALLET20',
                                    subtotal: 120,
                                    discount_amount: 20,
                                    final_total: 100,
                                    is_exclusive: true,
                                    stack_priority: 100,
                                    pricing_apply_stage: 'order_discount'
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
                'x-forwarded-for': '203.0.113.77'
            },
            body: {
                productId: 'product-wallet-1',
                quantity: 1,
                site: 'cn',
                discountCode: 'wallet20',
                discountAssetId: ' asset-9 ',
                idempotencyKey: 'wallet-click-1'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(rpcCalls.length, 1);
        assert.equal(payload.data.stacking_policy.exclusivity_label, '排他券');
        assert.equal(payload.data.pricing_waterfall[3].amount, 100);
        assert.deepEqual(rpcCalls[0], {
            name: 'fn_purchase_shop_item',
            params: {
                p_product_id: 'product-wallet-1',
                p_user_id: 'user-asset',
                p_site: 'cn',
                p_quantity: 1,
                p_discount_code: 'WALLET20',
                p_discount_asset_id: 'asset-9',
                p_agent_id: null
            }
        });
    }, {
        resolveClientIp() {
            return '203.0.113.77';
        },
        takeRateLimitToken() {
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

test('shop purchase forwards selected product sku id to the purchase rpc', async () => {
    const rpcCalls = [];
    const productSkuId = '33333333-3333-4333-8333-333333333333';

    await withShopPurchaseHandler({
        async requireAuthenticatedUser() {
            return {
                user: {
                    id: 'user-sku',
                    email: 'member@example.com'
                },
                requestSupabase: {
                    rpc(name, params) {
                        rpcCalls.push({ name, params });
                        return Promise.resolve({
                            data: {
                                success: true,
                                data: {
                                    order_id: 'order-sku-1',
                                    remaining_points: 21,
                                    content: 'KEY-SKU-001',
                                    sku_id: productSkuId,
                                    sku_name: '套餐 A'
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
                'x-forwarded-for': '203.0.113.79'
            },
            body: {
                productId: 'product-sku-1',
                productSkuId,
                quantity: 1,
                site: 'cn',
                idempotencyKey: 'sku-submit-1'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.deepEqual(rpcCalls[0], {
            name: 'fn_purchase_shop_item',
            params: {
                p_product_id: 'product-sku-1',
                p_user_id: 'user-sku',
                p_site: 'cn',
                p_quantity: 1,
                p_discount_code: null,
                p_discount_asset_id: null,
                p_agent_id: null,
                p_sku_id: productSkuId
            }
        });
    }, {
        resolveClientIp() {
            return '203.0.113.79';
        },
        takeRateLimitToken() {
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

test('shop purchase routes multiple selected coupons through the multi-discount rpc', async () => {
    const rpcCalls = [];
    const productSkuId = '44444444-4444-4444-8444-444444444444';

    await withShopPurchaseHandler({
        async requireAuthenticatedUser() {
            return {
                user: {
                    id: 'user-stack',
                    email: 'member@example.com'
                },
                requestSupabase: {
                    rpc(name, params) {
                        rpcCalls.push({ name, params });
                        if (name !== 'fn_purchase_shop_item_with_discounts') {
                            return Promise.resolve({
                                data: null,
                                error: {
                                    message: `Unexpected RPC ${name}`
                                }
                            });
                        }

                        return Promise.resolve({
                            data: {
                                success: true,
                                data: {
                                    order_id: 'order-stack-1',
                                    remaining_points: 44,
                                    content: 'KEY-STACK-001',
                                    discount_code: 'WELCOME10 + WALLET5',
                                    discount_codes: ['WELCOME10', 'WALLET5'],
                                    subtotal: 120,
                                    discount_amount: 15,
                                    final_total: 105,
                                    applied_discounts: [
                                        {
                                            code: 'WELCOME10',
                                            discount_type: 'fixed',
                                            discount_value: 10,
                                            discount_amount: 10,
                                            final_total_after_apply: 110,
                                            is_exclusive: false,
                                            stack_priority: 8,
                                            pricing_apply_stage: 'catalog_price'
                                        },
                                        {
                                            code: 'WALLET5',
                                            discount_asset_id: 'asset-stack-2',
                                            discount_type: 'fixed',
                                            discount_value: 5,
                                            discount_amount: 5,
                                            final_total_after_apply: 105,
                                            is_exclusive: false,
                                            stack_priority: 16,
                                            pricing_apply_stage: 'order_discount'
                                        }
                                    ]
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
                'x-forwarded-for': '203.0.113.88'
            },
            body: {
                productId: 'product-stack-1',
                productSkuId,
                quantity: 1,
                site: 'cn',
                discountSelections: [
                    { code: ' welcome10 ' },
                    { code: ' wallet5 ', assetId: ' asset-stack-2 ' }
                ],
                idempotencyKey: 'stack-submit-1'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(rpcCalls.length, 1);
        assert.deepEqual(rpcCalls[0], {
            name: 'fn_purchase_shop_item_with_discounts',
            params: {
                p_product_id: 'product-stack-1',
                p_user_id: 'user-stack',
                p_site: 'cn',
                p_quantity: 1,
                p_discount_inputs: [
                    { discount_code: 'WELCOME10', discount_asset_id: null },
                    { discount_code: 'WALLET5', discount_asset_id: 'asset-stack-2' }
                ],
                p_agent_id: null,
                p_sku_id: productSkuId
            }
        });
        assert.equal(payload.data.benefit_label, '已叠加 2 张卡券');
        assert.equal(payload.data.discount_amount, 15);
        assert.equal(payload.data.final_total, 105);
        assert.equal(payload.data.pricing_waterfall.length, 5);
        assert.equal(payload.data.stacking_policy.exclusivity_label, '已叠加 2 张');
    }, {
        resolveClientIp() {
            return '203.0.113.88';
        },
        takeRateLimitToken() {
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

test('shop purchase skips the discount-asset rpc signature when no asset is selected', async () => {
    const rpcCalls = [];

    await withShopPurchaseHandler({
        getOptionalSupabaseAdmin() {
            return null;
        },
        async requireAuthenticatedUser() {
            return {
                user: {
                    id: 'user-legacy',
                    email: 'member@example.com'
                },
                requestSupabase: {
                    rpc(name, params) {
                        rpcCalls.push({ name, params });
                        if (Object.prototype.hasOwnProperty.call(params, 'p_discount_asset_id')) {
                            return Promise.resolve({
                                data: null,
                                error: {
                                    code: 'PGRST202',
                                    message: "Could not find the function public.fn_purchase_shop_item(p_product_id, p_user_id, p_site, p_quantity, p_discount_code, p_discount_asset_id, p_agent_id) in the schema cache"
                                }
                            });
                        }

                        return Promise.resolve({
                            data: {
                                success: true,
                                data: {
                                    order_id: 'order-legacy-1',
                                    remaining_points: 17,
                                    content: 'KEY-LEGACY-001'
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
                'x-forwarded-for': '203.0.113.51'
            },
            body: {
                productId: 'product-legacy-1',
                quantity: 1,
                site: 'cn',
                idempotencyKey: 'legacy-rpc-click-1'
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
                p_product_id: 'product-legacy-1',
                p_user_id: 'user-legacy',
                p_site: 'cn',
                p_quantity: 1,
                p_discount_code: null,
                p_agent_id: null
            }
        });
    }, {
        resolveClientIp() {
            return '203.0.113.51';
        },
        takeRateLimitToken() {
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

test('shop purchase avoids the ambiguous 7-arg overload when no discount asset is selected', async () => {
    const rpcCalls = [];

    await withShopPurchaseHandler({
        getOptionalSupabaseAdmin() {
            return null;
        },
        async requireAuthenticatedUser() {
            return {
                user: {
                    id: 'user-ambiguous',
                    email: 'member@example.com'
                },
                requestSupabase: {
                    rpc(name, params) {
                        rpcCalls.push({ name, params });
                        if (Object.prototype.hasOwnProperty.call(params, 'p_discount_asset_id')) {
                            return Promise.resolve({
                                data: null,
                                error: {
                                    code: '42725',
                                    message: 'function public.fn_purchase_shop_item(uuid, uuid, character varying, integer, character varying, uuid) is not unique'
                                }
                            });
                        }

                        return Promise.resolve({
                            data: {
                                success: true,
                                data: {
                                    order_id: 'order-legacy-ambiguous-1',
                                    remaining_points: 15,
                                    content: 'KEY-LEGACY-AMB-001'
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
                'x-forwarded-for': '203.0.113.52'
            },
            body: {
                productId: 'product-legacy-ambiguous-1',
                quantity: 1,
                site: 'cn',
                idempotencyKey: 'legacy-rpc-ambiguous-click-1'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(rpcCalls.length, 1);
        assert.equal(Object.prototype.hasOwnProperty.call(rpcCalls[0].params, 'p_discount_asset_id'), false);
    }, {
        resolveClientIp() {
            return '203.0.113.52';
        },
        takeRateLimitToken() {
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

test('shop purchase can fall back to the admin client when authenticated legacy rpc access is revoked', async () => {
    const requestRpcCalls = [];
    const adminRpcCalls = [];
    const adminClient = {
        rpc(name, params) {
            adminRpcCalls.push({ name, params });
            return Promise.resolve({
                data: {
                    success: true,
                    data: {
                        order_id: 'order-admin-fallback-1',
                        remaining_points: 29,
                        content: 'KEY-ADMIN-001'
                    }
                },
                error: null
            });
        }
    };

    await withShopPurchaseHandler({
        getOptionalSupabaseAdmin() {
            return adminClient;
        },
        async requireAuthenticatedUser() {
            return {
                user: {
                    id: 'user-admin-fallback',
                    email: 'member@example.com'
                },
                requestSupabase: {
                    rpc(name, params) {
                        requestRpcCalls.push({ name, params });
                        if (Object.prototype.hasOwnProperty.call(params, 'p_discount_asset_id')) {
                            return Promise.resolve({
                                data: null,
                                error: {
                                    code: 'PGRST202',
                                    message: "Could not find the function public.fn_purchase_shop_item(p_product_id, p_user_id, p_site, p_quantity, p_discount_code, p_discount_asset_id, p_agent_id) in the schema cache"
                                }
                            });
                        }

                        return Promise.resolve({
                            data: null,
                            error: {
                                code: '42501',
                                message: 'permission denied for function fn_purchase_shop_item'
                            }
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
                'x-forwarded-for': '203.0.113.57'
            },
            body: {
                productId: 'product-admin-fallback-1',
                quantity: 1,
                site: 'cn',
                idempotencyKey: 'admin-fallback-click-1'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(requestRpcCalls.length, 1);
        assert.equal(adminRpcCalls.length, 1);
        assert.deepEqual(adminRpcCalls[0], {
            name: 'fn_purchase_shop_item',
            params: {
                p_product_id: 'product-admin-fallback-1',
                p_user_id: 'user-admin-fallback',
                p_site: 'cn',
                p_quantity: 1,
                p_discount_code: null,
                p_agent_id: null
            }
        });

        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(adminRpcCalls.length, 2);
        assert.deepEqual(adminRpcCalls[1], {
            name: 'fn_process_shop_purchase_rewards',
            params: {
                p_order_id: 'order-admin-fallback-1',
                p_site: 'cn'
            }
        });
    }, {
        resolveClientIp() {
            return '203.0.113.57';
        },
        takeRateLimitToken() {
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

test('shop purchase returns a diagnostic error when the purchase rpc yields no payload', async () => {
    const rpcCalls = [];

    await withShopPurchaseHandler({
        async requireAuthenticatedUser() {
            return {
                user: {
                    id: 'user-empty',
                    email: 'member@example.com'
                },
                requestSupabase: {
                    rpc(name, params) {
                        rpcCalls.push({ name, params });
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
                'x-forwarded-for': '203.0.113.61'
            },
            body: {
                productId: 'product-empty-1',
                quantity: 1,
                site: 'cn',
                idempotencyKey: 'empty-rpc-click-1'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 502);
        assert.equal(payload.success, false);
        assert.equal(payload.message, '商城购买服务未返回结果，请检查 fn_purchase_shop_item RPC 配置');
        assert.equal(rpcCalls.length, 1);
        assert.equal(Object.prototype.hasOwnProperty.call(rpcCalls[0].params, 'p_discount_asset_id'), false);
    }, {
        resolveClientIp() {
            return '203.0.113.61';
        },
        takeRateLimitToken() {
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
