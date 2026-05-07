const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const adminLib = require('../api/_lib/admin');

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

function createShopOrdersQueryMock(state) {
    return {
        select() {
            return this;
        },
        eq(field, value) {
            state.queryFilters.push({ field, value });
            return this;
        },
        async single() {
            return {
                data: state.order,
                error: state.order ? null : new Error('not found')
            };
        }
    };
}

async function withShopRefundHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/payments/shop-refund.js');
    const originalLoad = Module._load;
    const state = {
        order: options.order || null,
        rpcResult: options.rpcResult || { data: { success: true, message: '退款完成' }, error: null },
        requireAdminCalls: [],
        queryFilters: [],
        fromCalls: [],
        rpcCalls: [],
        auditCalls: [],
        notifications: []
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        supabase: {
                            from(table) {
                                state.fromCalls.push(table);
                                if (table === 'shop_orders') {
                                    return createShopOrdersQueryMock(state);
                                }
                                if (table === 'system_notifications') {
                                    return {
                                        async insert(payload) {
                                            state.notifications.push(payload);
                                            return { data: null, error: null };
                                        }
                                    };
                                }
                                throw new Error(`Unexpected table mock request: ${table}`);
                            },
                            async rpc(fn, params) {
                                state.rpcCalls.push({ fn, params });
                                return state.rpcResult;
                            }
                        },
                        user: { id: 'admin_1' }
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                requireWritableAdminSite: adminLib.requireWritableAdminSite,
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    state.auditCalls.push(entry);
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

test('shop refund handler rejects all-site writes before loading order data', async () => {
    await withShopRefundHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                orderId: 'order_1',
                site: 'all',
                targetStatus: 'available'
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.json().message, /Writable admin site must be cn or intl/i);
        assert.deepEqual(state.fromCalls, []);
        assert.deepEqual(state.rpcCalls, []);
        assert.equal(state.auditCalls.length, 0);
    });
});

test('shop refund handler blocks cross-site refunds before invoking rpc', async () => {
    await withShopRefundHandler({
        order: {
            id: 'order_1',
            user_id: 'user_1',
            site: 'cn',
            refund_status: 'none',
            price_paid: 100,
            total_price: 100
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                orderId: 'order_1',
                site: 'intl',
                targetStatus: 'available'
            }
        }, res);

        assert.equal(res.statusCode, 409);
        assert.match(res.json().message, /订单属于 CN 站点/i);
        assert.deepEqual(state.fromCalls, ['shop_orders']);
        assert.deepEqual(state.rpcCalls, []);
        assert.equal(state.auditCalls.length, 0);
    });
});

test('shop refund handler proxies rpc refund through admin api and writes audit context', async () => {
    await withShopRefundHandler({
        order: {
            id: 'order_2',
            user_id: 'user_9',
            site: 'intl',
            refund_status: 'none',
            price_paid: 250,
            total_price: 250
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                orderId: 'order_2',
                site: 'intl',
                targetStatus: 'fault',
                remark: 'manual review'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.deepEqual(state.fromCalls, ['shop_orders', 'system_notifications']);
        assert.equal(state.rpcCalls.length, 1);
        assert.equal(state.rpcCalls[0].fn, 'fn_admin_refund_order');
        assert.deepEqual(state.rpcCalls[0].params, {
            p_order_id: 'order_2',
            p_admin_id: 'admin_1',
            p_target_status: 'fault',
            p_remark: 'manual review'
        });
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0].site, 'intl');
        assert.equal(state.auditCalls[0].module, 'shop');
        assert.equal(state.auditCalls[0].actionType, 'shop.order.refund');
        assert.equal(state.notifications.length, 1);
        assert.equal(state.notifications[0].category, 'refund_status');
        assert.equal(state.notifications[0].metadata.event_type, 'refund_status');
        assert.equal(state.notifications[0].source_event_id, 'refund_status:order_2:refunded');
    });
});

test('shop refund handler short-circuits duplicate refunds before rpc and audit writes', async () => {
    await withShopRefundHandler({
        order: {
            id: 'order_3',
            user_id: 'user_3',
            site: 'cn',
            refund_status: 'refunded',
            price_paid: 88,
            total_price: 88
        },
        rpcResult: {
            data: { success: true, duplicate: true, message: '该订单已退款' },
            error: null
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                orderId: 'order_3',
                site: 'cn',
                targetStatus: 'reserve'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().duplicate, true);
        assert.equal(state.rpcCalls.length, 0);
        assert.equal(state.auditCalls.length, 0);
    });
});
