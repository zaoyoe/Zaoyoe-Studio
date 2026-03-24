const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        payload: null,
        single: false
    };

    const builder = {
        select() {
            return builder;
        },
        eq(column, value) {
            state.filters.push({ column, value });
            return builder;
        },
        single() {
            state.single = true;
            return builder;
        },
        upsert(payload) {
            state.mode = 'upsert';
            state.payload = payload;
            return builder;
        },
        update(payload) {
            state.mode = 'update';
            state.payload = payload;
            return builder;
        },
        insert(payload) {
            state.mode = 'insert';
            state.payload = payload;
            return builder;
        },
        then(resolve, reject) {
            return Promise.resolve(executor(state)).then(resolve, reject);
        },
        catch(reject) {
            return builder.then(undefined, reject);
        }
    };

    return builder;
}

function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every(({ column, value }) => row[column] === value));
}

function createSupabaseStub(state = {}) {
    const orders = state.orders || [];
    const anomalyCases = state.anomalyCases || [];
    const paymentEvents = state.paymentEvents || [];
    state.anomalyCases = anomalyCases;
    state.paymentEvents = paymentEvents;
    state.metrics = state.metrics || {};
    state.metrics.reviewRpcCalls = state.metrics.reviewRpcCalls || [];

    return {
        rpc(name, args = {}) {
            if (name === 'fn_apply_payment_order_review') {
                state.metrics.reviewRpcCalls.push(args);
                return Promise.resolve({
                    data: state.reviewRpcData || { ok: true },
                    error: state.reviewRpcError || null
                });
            }

            throw new Error(`Unexpected RPC: ${name}`);
        },
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'payment_orders' && query.mode === 'select') {
                    const rows = applyFilters(orders, query.filters);
                    return {
                        data: query.single ? (rows[0] || null) : rows,
                        error: rows.length ? null : { message: 'Order not found' }
                    };
                }

                if (table === 'payment_orders' && query.mode === 'update') {
                    const rows = applyFilters(orders, query.filters);
                    if (!rows.length) {
                        return {
                            data: query.single ? null : [],
                            error: { message: 'Order not found' }
                        };
                    }

                    rows.forEach((row) => {
                        Object.assign(row, query.payload || {});
                    });

                    return {
                        data: query.single ? rows[0] : rows,
                        error: null
                    };
                }

                if (table === 'payment_anomaly_cases' && query.mode === 'upsert') {
                    const payload = query.payload || {};
                    const existingIndex = anomalyCases.findIndex((item) => (
                        item.target_type === payload.target_type && item.target_id === payload.target_id
                    ));
                    const nextRow = {
                        id: existingIndex >= 0 ? anomalyCases[existingIndex].id : `anomaly-${anomalyCases.length + 1}`,
                        ...payload
                    };

                    if (existingIndex >= 0) {
                        anomalyCases[existingIndex] = nextRow;
                    } else {
                        anomalyCases.push(nextRow);
                    }

                    return {
                        data: query.single ? nextRow : [nextRow],
                        error: null
                    };
                }

                if (table === 'payment_events' && query.mode === 'insert') {
                    const payload = Array.isArray(query.payload)
                        ? query.payload
                        : [query.payload];
                    payload.forEach((entry, index) => {
                        paymentEvents.push({
                            id: entry.id || `payment-event-${paymentEvents.length + index + 1}`,
                            ...entry
                        });
                    });
                    return {
                        data: query.single ? paymentEvents[paymentEvents.length - 1] : payload,
                        error: null
                    };
                }

                if (table === 'admin_audit_logs' && query.mode === 'insert') {
                    return { data: null, error: null };
                }

                throw new Error(`Unexpected table access: ${table}/${query.mode}`);
            });
        }
    };
}

function createMockAdminModule(state = {}) {
    const supabase = createSupabaseStub(state);
    state.auditLogs = state.auditLogs || [];

    return {
        async requireAdmin() {
            return {
                supabase,
                requestSupabase: supabase,
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
            state.auditLogs.push(entry);
        }
    };
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

async function withPaymentsActionHandler(state, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/payments/actions.js');
    const originalLoad = Module._load;
    const mockAdminModule = createMockAdminModule(state);
    const providerAdaptersModule = state.providerAdaptersModule || null;

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return mockAdminModule;
        }

        if (request === '../../../../api/_lib/payments/provider-adapters' && providerAdaptersModule) {
            return providerAdaptersModule;
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

test('approve_review applies review RPC, writes anomaly case, and records audit log', async () => {
    const state = {
        orders: [
            {
                id: 'order-1',
                provider: 'afdian',
                provider_order_no: 'AFD-REVIEW-1',
                status: 'pending_review',
                paid_at: null,
                verified_at: null,
                last_error: 'signature mismatch',
                provider_metadata: {}
            }
        ]
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'order',
                targetId: 'order-1',
                action: 'approve_review',
                note: '人工复核后确认放行'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.anomaly_case.status, 'approved');
        assert.equal(payload.anomaly_case.last_action, 'approve_review');
        assert.equal(state.metrics.reviewRpcCalls.length, 1);
        assert.deepEqual(state.metrics.reviewRpcCalls[0], {
            p_payment_order_id: 'order-1',
            p_action: 'approve',
            p_note: '人工复核后确认放行',
            p_actor_id: 'admin-1'
        });
        assert.equal(state.anomalyCases.length, 1);
        assert.equal(state.anomalyCases[0].resolution, '人工复核后确认放行');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'payments.anomaly.action');
    });
});

test('approve_review is rejected when order is not pending_review', async () => {
    const state = {
        orders: [
            {
                id: 'order-2',
                provider: 'afdian',
                provider_order_no: 'AFD-REVIEW-2',
                status: 'amount_mismatch',
                paid_at: null,
                verified_at: null,
                last_error: 'amount mismatch',
                provider_metadata: {}
            }
        ]
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'order',
                targetId: 'order-2',
                action: 'approve_review',
                note: '不应允许'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 409);
        assert.equal(payload.success, false);
        assert.match(payload.message, /Only pending_review orders can use this review action/);
        assert.equal(state.metrics.reviewRpcCalls.length, 0);
        assert.equal(state.anomalyCases.length, 0);
        assert.equal(state.auditLogs.length, 0);
    });
});

test('sensitive review actions require an operator note', async () => {
    const state = {
        orders: [
            {
                id: 'order-3',
                provider: 'afdian',
                provider_order_no: 'AFD-REVIEW-3',
                status: 'pending_review',
                paid_at: null,
                verified_at: null,
                last_error: 'signature mismatch',
                provider_metadata: {}
            }
        ]
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'order',
                targetId: 'order-3',
                action: 'reject_review',
                note: '   '
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 400);
        assert.equal(payload.success, false);
        assert.match(payload.message, /请填写处理备注/);
        assert.equal(state.metrics.reviewRpcCalls.length, 0);
        assert.equal(state.anomalyCases.length, 0);
        assert.equal(state.auditLogs.length, 0);
    });
});

test('refund_hupijiao refunds an uncredited order, syncs local state, and records audit data', async () => {
    const state = {
        orders: [
            {
                id: 'order-hj-1',
                user_id: 'user-1',
                provider: 'hupijiao',
                provider_order_no: 'HJ_ORDER_1',
                checkout_session_id: 'session-1',
                site: 'cn',
                expected_amount: 20,
                paid_amount: 20,
                points_amount: 1000,
                status: 'pending_review',
                claimed_at: null,
                paid_at: '2026-03-24T08:00:00.000Z',
                verified_at: null,
                last_error: 'amount_mismatch_expected_20',
                provider_metadata: {
                    gateway_open_order_id: 'OPEN_ORDER_1'
                },
                raw_payload: {}
            }
        ],
        providerAdaptersModule: {
            getPaymentProviderAdapter(providerKey) {
                assert.equal(providerKey, 'hupijiao');
                return {
                    async resolveRuntimeContext() {
                        return {
                            provider: 'hupijiao'
                        };
                    },
                    async queryOrder() {
                        return {
                            supported: true,
                            success: true,
                            providerOrderNo: 'HJ_ORDER_1',
                            openOrderId: 'OPEN_ORDER_1',
                            status: 'paid',
                            statusRaw: 'OD',
                            message: 'success'
                        };
                    },
                    async refundOrder() {
                        return {
                            supported: true,
                            success: true,
                            providerOrderNo: 'HJ_ORDER_1',
                            openOrderId: 'OPEN_ORDER_1',
                            status: 'refunded',
                            statusRaw: 'CD',
                            message: 'success',
                            responsePayload: {
                                errcode: 0,
                                errmsg: 'success'
                            }
                        };
                    }
                };
            }
        }
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'order',
                targetId: 'order-hj-1',
                action: 'refund_hupijiao',
                note: '重复支付，原路退款'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.anomaly_case.status, 'handled');
        assert.equal(payload.anomaly_case.last_action, 'refund_hupijiao');
        assert.equal(state.orders[0].status, 'refunded');
        assert.equal(state.orders[0].provider_metadata.refund_status, 'refunded');
        assert.equal(state.orders[0].provider_metadata.payment_status, 'refunded');
        assert.equal(state.orders[0].provider_metadata.refund_source, 'admin_action');
        assert.equal(state.orders[0].raw_payload.admin_refund.note, '重复支付，原路退款');
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].event_type, 'admin_refund');
        assert.equal(state.paymentEvents[0].processing_result, 'admin_refund_processed');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'payments.anomaly.action');
        assert.equal(state.auditLogs[0].details.refund_status, 'refunded');
    });
});

test('refund_hupijiao fails closed for already credited orders', async () => {
    let adapterCalled = false;
    const state = {
        orders: [
            {
                id: 'order-hj-2',
                user_id: 'user-2',
                provider: 'hupijiao',
                provider_order_no: 'HJ_ORDER_2',
                checkout_session_id: 'session-2',
                site: 'cn',
                expected_amount: 20,
                paid_amount: 20,
                points_amount: 1000,
                status: 'redeemed',
                claimed_at: '2026-03-24T08:10:00.000Z',
                paid_at: '2026-03-24T08:00:00.000Z',
                verified_at: '2026-03-24T08:05:00.000Z',
                last_error: null,
                provider_metadata: {
                    gateway_open_order_id: 'OPEN_ORDER_2'
                },
                raw_payload: {}
            }
        ],
        providerAdaptersModule: {
            getPaymentProviderAdapter() {
                adapterCalled = true;
                throw new Error('adapter should not be called for credited orders');
            }
        }
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'order',
                targetId: 'order-hj-2',
                action: 'refund_hupijiao',
                note: '已入账订单不应直接退款'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 409);
        assert.equal(payload.success, false);
        assert.match(payload.message, /仅开放未入账的虎皮椒退款/);
        assert.equal(adapterCalled, false);
        assert.equal(state.paymentEvents.length, 0);
        assert.equal(state.anomalyCases.length, 0);
        assert.equal(state.auditLogs.length, 0);
    });
});
