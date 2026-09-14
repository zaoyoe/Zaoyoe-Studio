const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

const ADMIN_UUID = '11111111-1111-4111-8111-111111111111';
const ORDER_UUID = '22222222-2222-4222-8222-222222222222';

async function withGuestOrdersHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/guest-orders.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        tableCalls: [],
        rpcCalls: [],
        auditLogs: [],
        queryResult: {
            data: [],
            count: 0,
            error: null
        },
        rpcResult: {
            data: [{
                order_id: ORDER_UUID,
                order_no: 'GUEST-20260914-001',
                payment_status: 'confirmed',
                fulfillment_status: 'delivered',
                refund_status: 'pending',
                reservation_status: 'consumed',
                inventory_id: '33333333-3333-4333-8333-333333333333',
                content: 'secret-card-content',
                claim_secret_hash: 'should-not-leak'
            }],
            error: null
        },
        user: { id: ADMIN_UUID },
        requireAdminError: null,
        ...initialState
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            const supabase = {
                from(table) {
                    state.tableCalls.push({ table, operations: [] });
                    const call = state.tableCalls[state.tableCalls.length - 1];
                    const builder = {
                        select(...args) {
                            call.operations.push({ method: 'select', args });
                            return builder;
                        },
                        order(...args) {
                            call.operations.push({ method: 'order', args });
                            return builder;
                        },
                        range(...args) {
                            call.operations.push({ method: 'range', args });
                            return builder;
                        },
                        eq(...args) {
                            call.operations.push({ method: 'eq', args });
                            return builder;
                        },
                        ilike(...args) {
                            call.operations.push({ method: 'ilike', args });
                            return builder;
                        },
                        then(resolve, reject) {
                            return Promise.resolve(state.queryResult).then(resolve, reject);
                        }
                    };
                    return builder;
                }
            };
            const adminSupabase = {
                ...supabase,
                async rpc(name, params) {
                    state.rpcCalls.push({ name, params });
                    return state.rpcResult;
                }
            };
            return {
                normalizeAdminSite(value) {
                    const normalized = String(value || '').trim().toLowerCase();
                    return normalized === 'global' ? 'all' : normalized;
                },
                async parseJsonBody(req) {
                    if (typeof state.parseJsonBody === 'function') {
                        return state.parseJsonBody(req);
                    }
                    if (req?.body && typeof req.body === 'object') return req.body;
                    throw new Error('invalid json');
                },
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    if (state.requireAdminError) throw state.requireAdminError;
                    return {
                        supabase,
                        adminSupabase: state.adminSupabase === undefined ? adminSupabase : state.adminSupabase,
                        user: state.user
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    state.auditLogs.push(entry);
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

function buildRow(overrides = {}) {
    return {
        id: 'order-id-1',
        order_no: 'GUEST-20260913-001',
        site: 'cn',
        currency: 'CNY',
        product_id: 'product-id-1',
        sku_id: 'sku-id-1',
        snapshot_product_name: 'Test Product',
        snapshot_sku_name: 'Default',
        quantity: 1,
        unit_amount: '9.90',
        total_amount: '9.90',
        payment_status: 'confirmed',
        reservation_status: 'consumed',
        fulfillment_status: 'delivered',
        refund_status: 'none',
        expires_at: '2026-09-13T01:00:00.000Z',
        paid_at: '2026-09-13T01:01:00.000Z',
        fulfilled_at: '2026-09-13T01:02:00.000Z',
        last_error_code: null,
        last_error_message: null,
        reservation_id: 'reservation-id-1',
        inventory_id: 'inventory-id-1',
        reservation_row_status: 'consumed',
        reserved_until: '2026-09-13T01:01:30.000Z',
        payment_order_id: 'payment-id-1',
        provider: 'zpay',
        channel: 'alipay',
        provider_order_no: 'provider-order-1',
        payment_row_status: 'confirmed',
        expected_amount: '9.90',
        paid_amount: '9.90',
        sign_verified: true,
        amount_verified: true,
        currency_verified: true,
        final_status_verified: true,
        last_event_at: '2026-09-13T01:01:00.000Z',
        payment_last_error_code: null,
        payment_last_error_message: null,
        created_at: '2026-09-13T01:00:00.000Z',
        updated_at: '2026-09-13T01:02:00.000Z',
        ...overrides
    };
}

test('guest order handler reads the content-free admin view and returns only anomalies by default', async () => {
    await withGuestOrdersHandler({
        queryResult: {
            data: [
                buildRow({
                    id: 'normal',
                    order_no: 'GUEST-NORMAL',
                    updated_at: '2026-09-13T02:00:00.000Z'
                }),
                buildRow({
                    id: 'paid-unfulfilled',
                    order_no: 'GUEST-PAID',
                    fulfillment_status: 'pending',
                    reservation_status: 'held',
                    reservation_row_status: 'held',
                    updated_at: '2026-09-13T03:00:00.000Z'
                }),
                buildRow({
                    id: 'mismatch',
                    order_no: 'GUEST-MISMATCH',
                    payment_status: 'amount_mismatch',
                    payment_row_status: 'amount_mismatch',
                    fulfillment_status: 'pending',
                    updated_at: '2026-09-13T01:30:00.000Z'
                })
            ],
            count: 3,
            error: null
        }
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin?route=shop/guest-orders&page=1&pageSize=10'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.exception, 'any');
        assert.equal(payload.count, 2);
        assert.deepEqual(payload.rows.map((row) => row.order_no), ['GUEST-PAID', 'GUEST-MISMATCH']);
        assert.equal(payload.rows[0].exception_key, 'paid_unfulfilled');
        assert.equal(payload.rows[1].exception_key, 'amount_mismatch');
        assert.equal(payload.summary.total, 2);
        assert.equal(payload.summary.paid_unfulfilled, 1);
        assert.equal(payload.summary.amount_mismatch, 1);
        assert.equal(payload.summary.normal, 0);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
        assert.equal(state.tableCalls[0]?.table, 'admin_guest_shop_orders');
        const selectOperation = state.tableCalls[0].operations.find((entry) => entry.method === 'select');
        assert.equal(selectOperation.args[1].count, 'exact');
        assert.equal(selectOperation.args[0].includes('claim_secret_hash'), false);
        assert.equal(selectOperation.args[0].includes('content'), false);
    });
});

test('guest order handler supports explicit all filter, safe site/provider/order filters, and pagination', async () => {
    await withGuestOrdersHandler({
        queryResult: {
            data: [
                buildRow({
                    order_no: 'GUEST-CN-002',
                    updated_at: '2026-09-13T02:00:00.000Z'
                }),
                buildRow({
                    order_no: 'GUEST-CN-001',
                    updated_at: '2026-09-13T01:00:00.000Z'
                })
            ],
            count: 2,
            error: null
        }
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin?route=shop/guest-orders&site=cn&provider=ZPAY&orderNo=guest-cn&page=2&pageSize=1&exception=all'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.site, 'cn');
        assert.equal(payload.exception, 'all');
        assert.equal(payload.page, 2);
        assert.equal(payload.pageSize, 1);
        assert.equal(payload.count, 2);
        assert.deepEqual(payload.rows.map((row) => row.order_no), ['GUEST-CN-001']);
        const operations = state.tableCalls[0].operations;
        assert.deepEqual(operations.find((entry) => entry.method === 'eq' && entry.args[0] === 'site')?.args, ['site', 'cn']);
        assert.deepEqual(operations.find((entry) => entry.method === 'eq' && entry.args[0] === 'provider')?.args, ['provider', 'zpay']);
        assert.deepEqual(operations.find((entry) => entry.method === 'ilike' && entry.args[0] === 'order_no')?.args, ['order_no', 'guest-cn%']);
    });
});

test('guest order handler rejects invalid filters without issuing a database query', async () => {
    await withGuestOrdersHandler({}, async ({ handler, state }) => {
        for (const url of [
            '/api/admin?route=shop/guest-orders&site=cn%27%20or%201%3D1',
            '/api/admin?route=shop/guest-orders&provider=zpay%27%20or%201%3D1',
            '/api/admin?route=shop/guest-orders&exception=not-a-real-filter'
        ]) {
            const req = { method: 'GET', headers: {}, url };
            const res = createMockResponse();
            await handler(req, res);
            assert.equal(res.statusCode, 400);
            assert.equal(res.json().success, false);
        }

        assert.equal(state.tableCalls.length, 0);
    });
});

test('guest order handler rejects methods other than GET and POST', async () => {
    await withGuestOrdersHandler({}, async ({ handler, state }) => {
        for (const method of ['PUT', 'DELETE', 'PATCH']) {
            const res = createMockResponse();
            await handler({ method, headers: {}, url: '/api/admin?route=shop/guest-orders' }, res);
            assert.equal(res.statusCode, 405);
            assert.equal(res.json().success, false);
        }
        assert.equal(state.requireAdminCalls.length, 0);
        assert.equal(state.rpcCalls.length, 0);
    });
});

test('guest order handler does not expose sensitive fields and hides database errors', async () => {
    await withGuestOrdersHandler({
        queryResult: {
            data: [buildRow({
                claim_secret_hash: 'should-not-leak',
                content: 'secret-card-content',
                raw_payload: { card: 'secret' },
                last_error_message: 'x'.repeat(800)
            })],
            count: 1,
            error: null
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {}, url: '/api/admin?route=shop/guest-orders&exception=all' }, res);
        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.rows[0].claim_secret_hash, undefined);
        assert.equal(payload.rows[0].content, undefined);
        assert.equal(payload.rows[0].raw_payload, undefined);
        assert.equal(payload.rows[0].last_error_message.length, 500);
    });

    await withGuestOrdersHandler({
        queryResult: {
            data: [],
            count: null,
            error: { message: 'postgres internal details should not leak' }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {}, url: '/api/admin?route=shop/guest-orders' }, res);
        const payload = res.json();
        assert.equal(res.statusCode, 500);
        assert.equal(payload.message, 'Failed to load guest shop orders');
        assert.equal(payload.message.includes('postgres'), false);
    });
});

test('guest order handler returns an empty anomaly queue with a complete summary', async () => {
    await withGuestOrdersHandler({}, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {}, url: '/api/admin?route=shop/guest-orders' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.deepEqual(payload.rows, []);
        assert.equal(payload.count, 0);
        assert.equal(payload.summary.total, 0);
        for (const key of ['paid_unfulfilled', 'reservation_expired', 'payment_review', 'payment_failed', 'amount_mismatch', 'refund_failed', 'inventory_inconsistent', 'dead_letter']) {
            assert.equal(payload.summary[key], 0);
        }
    });
});

test('central admin router registers the guest order anomaly route', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../api/admin.js'), 'utf8');
    assert.match(source, /shopGuestOrdersHandler\s*=\s*require\(['"]\.\.\/server\/api-handlers\/admin\/shop\/guest-orders['"]\)/);
    assert.match(source, /['"]shop\/guest-orders['"]\s*:\s*shopGuestOrdersHandler/);
});

test('guest order write requires shop.manage and rejects missing confirm or reason', async () => {
    const forbidden = new Error('Admin access required');
    forbidden.statusCode = 403;
    await withGuestOrdersHandler({ requireAdminError: forbidden }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            url: '/api/admin?route=shop/guest-orders',
            body: {
                action: 'request_refund',
                orderId: ORDER_UUID,
                confirm: true,
                reason: '沙箱订单需要退款处理'
            }
        }, res);
        assert.equal(res.statusCode, 403);
        assert.equal(state.rpcCalls.length, 0);
    });

    await withGuestOrdersHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            url: '/api/admin?route=shop/guest-orders',
            body: {
                action: 'request_refund',
                orderId: ORDER_UUID,
                reason: '沙箱订单需要退款处理'
            }
        }, res);
        assert.equal(res.statusCode, 400);
        assert.equal(res.json().code, 'guest_admin_confirm_required');
        assert.equal(state.rpcCalls.length, 0);
    });

    await withGuestOrdersHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            url: '/api/admin?route=shop/guest-orders',
            body: {
                action: 'request_refund',
                orderId: ORDER_UUID,
                confirm: true,
                reason: '太短'
            }
        }, res);
        assert.equal(res.statusCode, 400);
        assert.equal(res.json().code, 'guest_admin_reason_required');
        assert.equal(state.rpcCalls.length, 0);
    });
});

test('guest order write queues refund through admin RPC, audits, and never returns secrets', async () => {
    await withGuestOrdersHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            url: '/api/admin?route=shop/guest-orders',
            body: {
                action: 'request_refund',
                orderId: ORDER_UUID,
                confirm: true,
                reason: '沙箱订单需要退款处理',
                site: 'cn'
            }
        }, res);
        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.action, 'request_refund');
        assert.equal(payload.orderId, ORDER_UUID);
        assert.equal(payload.refund, 'pending');
        assert.equal(payload.content, undefined);
        assert.equal(payload.claim_secret_hash, undefined);
        assert.equal(payload.inventory_id, undefined);
        assert.equal(payload.inventoryId, undefined);
        assert.deepEqual(state.rpcCalls[0], {
            name: 'fn_guest_shop_admin_queue_refund',
            params: {
                p_order_id: ORDER_UUID,
                p_reason: '沙箱订单需要退款处理',
                p_admin_id: ADMIN_UUID,
                p_expected_site: 'cn'
            }
        });
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'shop.guest_order.request_refund');
        assert.equal(state.auditLogs[0].details.order_id, ORDER_UUID);
        assert.equal(JSON.stringify(payload).includes('secret-card-content'), false);
        assert.equal(JSON.stringify(state.auditLogs).includes('secret-card-content'), false);
    });
});

test('guest order write maps active lease and missing RPC to fail-closed statuses', async () => {
    await withGuestOrdersHandler({
        rpcResult: { data: null, error: { message: 'guest_admin_active_lease' } }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            url: '/api/admin?route=shop/guest-orders',
            body: {
                action: 'unlock_dead_letter',
                orderId: ORDER_UUID,
                confirm: true,
                reason: '确认无活动租约后解锁死信'
            }
        }, res);
        assert.equal(res.statusCode, 409);
        assert.equal(res.json().code, 'guest_admin_active_lease');
    });

    await withGuestOrdersHandler({
        rpcResult: { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fn_guest_shop_admin_manual_fulfill' } }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            url: '/api/admin?route=shop/guest-orders',
            body: {
                action: 'manual_fulfill',
                orderId: ORDER_UUID,
                confirm: true,
                reason: '已付款无库存，准备补发'
            }
        }, res);
        assert.equal(res.statusCode, 503);
        assert.equal(res.json().code, 'guest_admin_ops_unavailable');
    });

    await withGuestOrdersHandler({
        rpcResult: { data: null, error: { code: '42883', message: 'function fn_guest_shop_admin_queue_refund does not exist' } }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            url: '/api/admin?route=shop/guest-orders',
            body: {
                action: 'request_refund',
                orderId: ORDER_UUID,
                confirm: true,
                reason: '沙箱订单需要退款处理'
            }
        }, res);
        assert.equal(res.statusCode, 503);
        assert.equal(res.json().code, 'guest_admin_ops_unavailable');
        assert.match(res.json().message, /尚未启用/);
    });
});
