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
        }
    };
}

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createSupabaseStub(state) {
    return {
        from(table) {
            return {
                select() {
                    const query = {
                        _eq: [],
                        eq(field, value) {
                            query._eq.push([String(field || ''), value]);
                            return query;
                        },
                        maybeSingle() {
                            state.tableReads.push({ table, eq: clone(query._eq) });
                            if (table === 'system_config') {
                                return Promise.resolve({
                                    data: {
                                        config_key: 'marketplace_channels',
                                        config_value: state.marketplaceConfig
                                    },
                                    error: null
                                });
                            }
                            return Promise.resolve({ data: null, error: null });
                        }
                    };
                    return query;
                }
            };
        },
        async rpc(name, params) {
            state.rpcCalls.push({ name, params: clone(params) });
            return {
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
                error: state.rpcError || null
            };
        }
    };
}

async function withMarketplaceOrdersHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/marketplace-orders.js');
    const originalLoad = Module._load;
    const state = {
        auditLogs: [],
        tableReads: [],
        rpcCalls: [],
        marketplaceConfig: {
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
                    accounts: [
                        {
                            key: 'main',
                            label: '主号',
                            enabled: true,
                            role: 'primary',
                            secret_names: ['session_cookie']
                        },
                        {
                            key: 'backup-1',
                            label: '备用号',
                            enabled: true,
                            role: 'backup',
                            secret_names: ['session_cookie']
                        }
                    ]
                }
            ]
        },
        ...stateOverrides
    };
    state.supabase = state.supabase || createSupabaseStub(state);

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, options = {}) {
                    state.requireAdminCall = { req, options };
                    return {
                        supabase: state.supabase,
                        user: { id: 'admin-1', email: 'admin@example.com' }
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    state.auditLogs.push(clone(entry));
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

test('marketplace order helper validates channel account and builds shared-inventory RPC params', () => {
    const {
        buildMarketplaceOrderRpcParams
    } = require('../api/_lib/marketplace-orders');
    const productId = '11111111-1111-4111-8111-111111111111';

    const { normalized, rpcParams } = buildMarketplaceOrderRpcParams({
        productId,
        channel: 'xianyu',
        accountKey: 'backup-1',
        externalOrderId: 'XY-ORDER-1001',
        quantity: 2,
        buyerNick: '闲鱼买家',
        snapshot: { pay_status: 'paid' }
    }, {
        enabled: true,
        default_channel_key: 'website',
        inventory_mode: 'shared',
        channels: [
            {
                key: 'xianyu',
                type: 'xianyu',
                enabled: true,
                inventory_mode: 'shared',
                source_channel: 'xianyu',
                default_account_key: 'main',
                accounts: [
                    { key: 'main', enabled: true },
                    { key: 'backup-1', enabled: true }
                ]
            }
        ]
    });

    assert.equal(normalized.product_id, productId);
    assert.equal(normalized.source_channel, 'xianyu');
    assert.equal(normalized.channel_account_key, 'backup-1');
    assert.equal(normalized.external_order_id, 'XY-ORDER-1001');
    assert.equal(normalized.quantity, 2);
    assert.deepEqual(rpcParams, {
        p_product_id: productId,
        p_quantity: 2,
        p_source_channel: 'xianyu',
        p_channel_account_key: 'backup-1',
        p_external_order_id: 'XY-ORDER-1001',
        p_external_order_snapshot: { pay_status: 'paid' },
        p_site: 'cn',
        p_user_id: null,
        p_price_paid: null,
        p_total_price: null,
        p_external_buyer_id: '',
        p_external_buyer_name: '闲鱼买家'
    });
});

test('marketplace order helper rejects disabled accounts before touching inventory RPC', () => {
    const {
        buildMarketplaceOrderRpcParams
    } = require('../api/_lib/marketplace-orders');

    assert.throws(
        () => buildMarketplaceOrderRpcParams({
            product_id: '11111111-1111-4111-8111-111111111111',
            channel: 'xianyu',
            account: 'main',
            external_order_id: 'XY-ORDER-1002'
        }, {
            enabled: true,
            channels: [
                {
                    key: 'xianyu',
                    type: 'xianyu',
                    enabled: true,
                    inventory_mode: 'shared',
                    source_channel: 'xianyu',
                    default_account_key: 'main',
                    accounts: [{ key: 'main', enabled: false }]
                }
            ]
        }),
        /渠道账号未启用/
    );
});

test('admin marketplace orders handler creates a marketplace order through the shared inventory RPC', async () => {
    await withMarketplaceOrdersHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            body: {
                product_id: '11111111-1111-4111-8111-111111111111',
                channel: 'xianyu',
                account: 'main',
                external_order_id: 'XY-ORDER-1003',
                quantity: 1,
                external_buyer_name: 'buyer-a'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.duplicate, false);
        assert.equal(payload.data.order_id, 'order-1');
        assert.deepEqual(state.requireAdminCall.options, { permission: 'shop.manage' });
        assert.equal(state.rpcCalls.length, 1);
        assert.equal(state.rpcCalls[0].name, 'fn_create_marketplace_shop_order');
        assert.equal(state.rpcCalls[0].params.p_source_channel, 'xianyu');
        assert.equal(state.rpcCalls[0].params.p_channel_account_key, 'main');
        assert.equal(state.rpcCalls[0].params.p_external_order_id, 'XY-ORDER-1003');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'shop.marketplace_order.create');
    });
});

test('admin marketplace orders handler returns duplicate marketplace orders idempotently', async () => {
    await withMarketplaceOrdersHandler({
        rpcResult: {
            success: true,
            duplicate: true,
            message: 'marketplace order already exists',
            data: {
                order_id: 'order-existing',
                delivery_status: 'delivered'
            }
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            body: {
                product_id: '11111111-1111-4111-8111-111111111111',
                channel: 'xianyu',
                account: 'main',
                external_order_id: 'XY-ORDER-1004'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.duplicate, true);
        assert.equal(payload.data.order_id, 'order-existing');
        assert.equal(state.auditLogs[0].actionType, 'shop.marketplace_order.duplicate');
    });
});

test('admin route dispatcher exposes marketplace order ingestion route', () => {
    const adminApiSource = require('node:fs').readFileSync(
        path.resolve(__dirname, '../api/admin.js'),
        'utf8'
    );

    assert.match(
        adminApiSource,
        /shopMarketplaceOrdersHandler = require\('\.\.\/server\/api-handlers\/admin\/shop\/marketplace-orders'\)/,
        'admin dispatcher should import the marketplace orders handler'
    );
    assert.match(
        adminApiSource,
        /'shop\/marketplace-orders': shopMarketplaceOrdersHandler/,
        'admin dispatcher should expose shop/marketplace-orders'
    );
});

test('marketplace order ingest migration defines idempotent shared-inventory RPC', () => {
    const migrationSource = require('node:fs').readFileSync(
        path.resolve(__dirname, '../supabase/migrations/20260521_add_marketplace_order_ingest_rpc.sql'),
        'utf8'
    );

    const markers = [
        'CREATE OR REPLACE FUNCTION public.fn_create_marketplace_shop_order(',
        'PERFORM pg_advisory_xact_lock(',
        'WHERE source_channel = v_source_channel',
        'FOR UPDATE SKIP LOCKED',
        'INSERT INTO public.shop_orders (',
        'source_channel,',
        'channel_account_key,',
        'external_order_id,',
        'external_order_snapshot',
        'INSERT INTO public.shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)',
        'INSERT INTO public.shop_webhook_tasks (',
        'marketplace_delivery:',
        'GRANT EXECUTE ON FUNCTION public.fn_create_marketplace_shop_order'
    ];

    for (const marker of markers) {
        assert.equal(migrationSource.includes(marker), true, `migration should contain ${marker}`);
    }
});
