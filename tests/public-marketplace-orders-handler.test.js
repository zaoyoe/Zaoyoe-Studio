const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createMarketplaceHandlers
} = require('../server/api-handlers/public/marketplace');

function createMockResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            state.statusCode = Number(code) || 200;
            return this;
        },
        setHeader(name, value) {
            state.headers[String(name || '').toLowerCase()] = value;
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

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createMarketplaceConfig() {
    return {
        enabled: true,
        default_channel_key: 'website',
        inventory_mode: 'shared',
        channels: [
            {
                key: 'website',
                type: 'website',
                label: '网站',
                enabled: true,
                inventory_mode: 'shared',
                delivery_mode: 'manual',
                source_channel: 'website',
                default_account_key: '',
                multi_account: false,
                accounts: []
            },
            {
                key: 'xianyu',
                type: 'xianyu',
                label: '闲鱼',
                enabled: true,
                inventory_mode: 'shared',
                delivery_mode: 'auto',
                source_channel: 'xianyu',
                default_account_key: 'main',
                multi_account: true,
                product_mappings: [
                    {
                        label: 'Hostinger 闲鱼商品',
                        xianyu_item_id: '1051635270711',
                        product_id: '22222222-2222-4222-8222-222222222222'
                    }
                ],
                accounts: [
                    {
                        key: 'main',
                        label: '主号',
                        enabled: true,
                        role: 'primary',
                        secret_names: ['session_cookie', 'refresh_token', 'ingest_token']
                    },
                    {
                        key: 'backup-1',
                        label: '备用号',
                        enabled: true,
                        role: 'backup',
                        secret_names: ['ingest_token']
                    }
                ]
            }
        ]
    };
}

function createSupabaseStub(state) {
    return {
        rpc(name, params) {
            state.rpcCalls.push({ name, params: clone(params) });
            return Promise.resolve({
                data: clone(state.rpcResult || {
                    success: true,
                    duplicate: false,
                    message: 'marketplace order created',
                    data: {
                        order_id: 'order-1',
                        delivery_status: 'delivered',
                        content: 'card-secret'
                    }
                }),
                error: null
            });
        }
    };
}

function createHandlers(stateOverrides = {}) {
    const state = {
        marketplaceConfig: createMarketplaceConfig(),
        secretsByKey: {
            marketplace__xianyu__main__ingest_token: 'main-token',
            'marketplace__xianyu__backup-1__ingest_token': 'backup-token'
        },
        rpcCalls: [],
        secretReads: [],
        ...stateOverrides
    };
    const supabase = state.supabase || createSupabaseStub(state);
    state.supabase = supabase;

    const handlers = createMarketplaceHandlers({
        admin: {
            getSupabaseAdmin() {
                return supabase;
            },
            async parseJsonBody(req) {
                return req.body || {};
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
                return payload;
            }
        },
        requestSecurity: {
            resolveClientIp() {
                return '127.0.0.1';
            },
            async takeRateLimitToken() {
                return {
                    allowed: true,
                    limit: 120,
                    remaining: 119,
                    resetAt: Date.now() + 60_000
                };
            },
            applyRateLimitHeaders(res, result) {
                res.setHeader('X-RateLimit-Limit', String(result.limit || 0));
            }
        },
        marketplaceChannels: {
            async loadMarketplaceChannelsConfig() {
                return state.marketplaceConfig;
            }
        },
        secrets: {
            async getStoredAdminSecret(_supabase, secretKey) {
                state.secretReads.push(secretKey);
                const value = state.secretsByKey[secretKey];
                return value ? { secret_key: secretKey, value } : null;
            }
        },
        env: {
            MARKETPLACE_INGEST_RATE_LIMIT_MAX: '120',
            MARKETPLACE_INGEST_RATE_LIMIT_WINDOW_MS: '60000'
        }
    });

    return { handlers, state };
}

test('public marketplace orders handler rejects missing or invalid ingest token before RPC', async () => {
    const { handlers, state } = createHandlers();
    const res = createMockResponse();

    await handlers.orders({
        method: 'POST',
        url: '/api/marketplace/orders',
        headers: {
            authorization: 'Bearer wrong-token'
        },
        body: {
            product_id: '11111111-1111-4111-8111-111111111111',
            channel: 'xianyu',
            account: 'main',
            external_order_id: 'XY-ORDER-1001'
        }
    }, res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.json().code, 'marketplace_ingest_token_invalid');
    assert.deepEqual(state.secretReads, ['marketplace__xianyu__main__ingest_token']);
    assert.deepEqual(state.rpcCalls, []);
});

test('public marketplace orders handler accepts account token and creates shared-inventory order', async () => {
    const { handlers, state } = createHandlers();
    const res = createMockResponse();
    const productId = '11111111-1111-4111-8111-111111111111';

    await handlers.orders({
        method: 'POST',
        url: '/api/marketplace/orders',
        headers: {
            authorization: 'Bearer backup-token'
        },
        body: {
            product_id: productId,
            channel: 'xianyu',
            account: 'backup-1',
            external_order_id: 'XY-ORDER-1002',
            quantity: 2,
            buyerNick: '闲鱼买家',
            snapshot: { pay_status: 'paid' }
        }
    }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.request.channel_key, 'xianyu');
    assert.equal(payload.request.channel_account_key, 'backup-1');
    assert.equal(state.secretReads[0], 'marketplace__xianyu__backup-1__ingest_token');
    assert.equal(state.rpcCalls.length, 1);
    assert.deepEqual(state.rpcCalls[0], {
        name: 'fn_create_marketplace_shop_order',
        params: {
            p_product_id: productId,
            p_quantity: 2,
            p_source_channel: 'xianyu',
            p_channel_account_key: 'backup-1',
            p_external_order_id: 'XY-ORDER-1002',
            p_external_order_snapshot: { pay_status: 'paid' },
            p_site: 'cn',
            p_user_id: null,
            p_price_paid: null,
            p_total_price: null,
            p_external_buyer_id: '',
            p_external_buyer_name: '闲鱼买家'
        }
    });
});

test('public marketplace orders handler pins order channel to the authenticated token account', async () => {
    const { handlers, state } = createHandlers();
    const res = createMockResponse();

    await handlers.orders({
        method: 'POST',
        url: '/api/marketplace/orders?channel=xianyu&account=main',
        headers: {
            'x-marketplace-ingest-token': 'main-token'
        },
        body: {
            product_id: '11111111-1111-4111-8111-111111111111',
            source_channel: 'website',
            channel_account_key: 'backup-1',
            external_order_id: 'XY-ORDER-1003'
        }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(state.secretReads[0], 'marketplace__xianyu__main__ingest_token');
    assert.equal(state.rpcCalls[0].params.p_source_channel, 'xianyu');
    assert.equal(state.rpcCalls[0].params.p_channel_account_key, 'main');
});

test('public xianyu API-card delivery handler maps item to shared inventory and returns top-level content', async () => {
    const { handlers, state } = createHandlers();
    const res = createMockResponse();
    const productId = '22222222-2222-4222-8222-222222222222';

    await handlers['xianyu/deliver']({
        method: 'POST',
        url: '/api/marketplace/xianyu/deliver',
        headers: {
            authorization: 'Bearer main-token'
        },
        body: {
            account: 'main',
            order_id: '3303158667140030764',
            item_id: '1051635270711',
            buyer_id: '2993568887',
            buyerNick: '起个什么名字呢',
            quantity: '1',
            title: 'Hostinger 全场再打8折',
            spec_name: '套餐',
            spec_value: '主机优惠'
        }
    }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.content, 'card-secret');
    assert.equal(payload.data, undefined);
    assert.equal(payload.meta.request.product_id, productId);
    assert.equal(payload.meta.request.channel_key, 'xianyu');
    assert.equal(payload.meta.request.channel_account_key, 'main');
    assert.equal(payload.meta.request.external_order_id, '3303158667140030764');
    assert.equal(state.secretReads[0], 'marketplace__xianyu__main__ingest_token');
    assert.equal(state.rpcCalls.length, 1);
    assert.deepEqual(state.rpcCalls[0], {
        name: 'fn_create_marketplace_shop_order',
        params: {
            p_product_id: productId,
            p_quantity: 1,
            p_source_channel: 'xianyu',
            p_channel_account_key: 'main',
            p_external_order_id: '3303158667140030764',
            p_external_order_snapshot: {
                adapter: 'xianyu-api-card',
                pay_status: 'paid',
                xianyu_item_id: '1051635270711',
                sku_id: '',
                sku_text: '主机优惠',
                item_title: 'Hostinger 全场再打8折',
                mapping: {
                    index: 0,
                    label: 'Hostinger 闲鱼商品'
                },
                raw: {
                    account: 'main',
                    order_id: '3303158667140030764',
                    item_id: '1051635270711',
                    buyer_id: '2993568887',
                    buyerNick: '起个什么名字呢',
                    quantity: '1',
                    title: 'Hostinger 全场再打8折',
                    spec_name: '套餐',
                    spec_value: '主机优惠',
                    spec_name_2: '',
                    spec_value_2: '',
                    cookie_id: '',
                    order: {}
                },
                spec_name: '套餐',
                spec_value: '主机优惠',
                spec_name_2: '',
                spec_value_2: '',
                cookie_id: ''
            },
            p_site: 'cn',
            p_user_id: null,
            p_price_paid: null,
            p_total_price: null,
            p_external_buyer_id: '2993568887',
            p_external_buyer_name: '起个什么名字呢'
        }
    });
});

test('public xianyu API-card delivery handler reports missing product mapping before RPC', async () => {
    const { handlers, state } = createHandlers();
    const res = createMockResponse();

    await handlers['xianyu/deliver']({
        method: 'POST',
        url: '/api/marketplace/xianyu/deliver',
        headers: {
            authorization: 'Bearer main-token'
        },
        body: {
            account: 'main',
            order_id: 'XY-NO-MAPPING',
            item_id: 'missing-item'
        }
    }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 404);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'xianyu_product_mapping_not_found');
    assert.deepEqual(state.rpcCalls, []);
});
