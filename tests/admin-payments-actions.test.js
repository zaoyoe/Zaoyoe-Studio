const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        order: null,
        payload: null,
        single: false
    };

    const builder = {
        select() {
            return builder;
        },
        eq(column, value) {
            state.filters.push({ op: 'eq', column, value });
            return builder;
        },
        gte(column, value) {
            state.filters.push({ op: 'gte', column, value });
            return builder;
        },
        order(column, options = {}) {
            state.order = {
                column,
                ascending: options.ascending !== false
            };
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

function createRpcResult(data, error = null) {
    return {
        single() {
            return Promise.resolve({ data, error });
        },
        then(resolve, reject) {
            return Promise.resolve({ data, error }).then(resolve, reject);
        },
        catch(reject) {
            return Promise.resolve({ data, error }).catch(reject);
        }
    };
}

function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every(({ op, column, value }) => {
        if (op === 'gte') {
            return new Date(row[column] || 0).getTime() >= new Date(value || 0).getTime();
        }

        return row[column] === value;
    }));
}

function sortRows(rows, order) {
    if (!order?.column) return rows.slice();

    const sorted = rows.slice().sort((left, right) => {
        const leftValue = left?.[order.column];
        const rightValue = right?.[order.column];
        return String(leftValue || '').localeCompare(String(rightValue || ''));
    });

    return order.ascending === false ? sorted.reverse() : sorted;
}

function createSupabaseStub(state = {}) {
    const orders = state.orders || [];
    const opsAlertJobs = state.opsAlertJobs || [];
    const anomalyCases = state.anomalyCases || [];
    const paymentEvents = state.paymentEvents || [];
    const pointsLedger = state.pointsLedger || [];
    const adminRoles = state.adminRoles || [];
    const systemConfigs = state.systemConfigs || [];
    const adminSecretStore = state.adminSecretStore || [];
    const systemNotifications = state.systemNotifications || [];
    state.anomalyCases = anomalyCases;
    state.opsAlertJobs = opsAlertJobs;
    state.paymentEvents = paymentEvents;
    state.pointsLedger = pointsLedger;
    state.adminRoles = adminRoles;
    state.systemConfigs = systemConfigs;
    state.adminSecretStore = adminSecretStore;
    state.systemNotifications = systemNotifications;
    state.metrics = state.metrics || {};
    state.metrics.reviewRpcCalls = state.metrics.reviewRpcCalls || [];
    state.metrics.balanceRpcCalls = state.metrics.balanceRpcCalls || [];
    state.metrics.refundReclaimRpcCalls = state.metrics.refundReclaimRpcCalls || [];
    state.metrics.rechargeRpcCalls = state.metrics.rechargeRpcCalls || [];

    return {
        rpc(name, args = {}) {
            if (name === 'fn_apply_payment_order_review') {
                state.metrics.reviewRpcCalls.push(args);
                return createRpcResult(
                    state.reviewRpcData || { ok: true },
                    state.reviewRpcError || null
                );
            }

            if (name === 'fn_get_user_balance') {
                state.metrics.balanceRpcCalls.push(args);
                const configuredBalance = state.userBalances?.[args.p_user_id];
                const data = configuredBalance && typeof configuredBalance === 'object'
                    ? configuredBalance
                    : { total_balance: Number(configuredBalance ?? state.defaultUserBalance ?? 0) };
                return createRpcResult(data, state.balanceRpcError || null);
            }

            if (name === 'fn_deduct_points_admin_site_with_breakdown') {
                state.metrics.refundReclaimRpcCalls.push(args);
                if (state.refundReclaimRpcError) {
                    return createRpcResult(null, state.refundReclaimRpcError);
                }

                const configuredResult = state.refundReclaimRpcData && typeof state.refundReclaimRpcData === 'object'
                    ? state.refundReclaimRpcData
                    : {};
                const deducted = Number(configuredResult.deducted ?? args.p_amount) || 0;
                const deductedPaid = Number(configuredResult.deducted_paid ?? deducted) || 0;
                const deductedBonus = Number(configuredResult.deducted_bonus ?? Math.max(0, deducted - deductedPaid)) || 0;
                const data = {
                    deducted,
                    deducted_paid: deductedPaid,
                    deducted_bonus: deductedBonus,
                    site: args.p_site || 'cn',
                    ...configuredResult
                };

                if (deducted > 0) {
                    pointsLedger.push({
                        id: `ledger-${pointsLedger.length + 1}`,
                        user_id: args.p_target_user_id,
                        amount: -Math.abs(deducted),
                        paid_points: deductedPaid,
                        bonus_points: deductedBonus,
                        reference_id: args.p_reference_id,
                        site: args.p_site || 'cn',
                        created_at: new Date().toISOString()
                    });
                }

                return createRpcResult(data, null);
            }

            if (name === 'fn_recharge_points') {
                state.metrics.rechargeRpcCalls.push(args);
                if (state.rechargeRpcError) {
                    return createRpcResult(null, state.rechargeRpcError);
                }

                const data = state.rechargeRpcData || {
                    paid: Number(args.p_paid) || 0,
                    bonus: Number(args.p_bonus) || 0
                };
                pointsLedger.push({
                    id: `ledger-${pointsLedger.length + 1}`,
                    user_id: args.target_user_id,
                    amount: Math.abs(Number(args.p_paid) || 0) + Math.abs(Number(args.p_bonus) || 0),
                    paid_points: Math.abs(Number(args.p_paid) || 0),
                    bonus_points: Math.abs(Number(args.p_bonus) || 0),
                    reference_id: args.p_reference_id,
                    site: args.p_site || 'cn',
                    created_at: new Date().toISOString()
                });
                return createRpcResult(data, null);
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

                if (table === 'admin_roles' && query.mode === 'select') {
                    const rows = sortRows(applyFilters(adminRoles, query.filters), query.order);
                    return {
                        data: query.single ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'system_notifications' && query.mode === 'select') {
                    const rows = sortRows(applyFilters(systemNotifications, query.filters), query.order);
                    return {
                        data: query.single ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'system_notifications' && query.mode === 'insert') {
                    const payload = Array.isArray(query.payload)
                        ? query.payload
                        : [query.payload];
                    payload.forEach((entry, index) => {
                        systemNotifications.push({
                            id: entry.id || `notification-${systemNotifications.length + index + 1}`,
                            created_at: entry.created_at || new Date().toISOString(),
                            ...entry
                        });
                    });
                    return {
                        data: query.single ? systemNotifications[systemNotifications.length - 1] : payload,
                        error: null
                    };
                }

                if (table === 'system_config' && query.mode === 'select') {
                    const rows = sortRows(applyFilters(systemConfigs, query.filters), query.order);
                    return {
                        data: query.single ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'admin_secret_store' && query.mode === 'select') {
                    const rows = sortRows(applyFilters(adminSecretStore, query.filters), query.order);
                    return {
                        data: query.single ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'ops_alert_jobs' && query.mode === 'select') {
                    const rows = sortRows(applyFilters(opsAlertJobs, query.filters), query.order);
                    return {
                        data: query.single ? (rows[0] || null) : rows,
                        error: rows.length ? null : { message: 'Ops alert job not found' }
                    };
                }

                if (table === 'ops_alert_jobs' && query.mode === 'update') {
                    const rows = applyFilters(opsAlertJobs, query.filters);
                    if (!rows.length) {
                        return {
                            data: query.single ? null : [],
                            error: { message: 'Ops alert job not found' }
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
    const opsAlertsModule = state.opsAlertsModule || null;
    const paymentsOrdersModule = state.paymentsOrdersModule || null;
    const discountTriggerLinkageModule = state.discountTriggerLinkageModule || null;

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return mockAdminModule;
        }

        if (request === '../../../../api/_lib/payments/provider-adapters' && providerAdaptersModule) {
            return {
                ...originalLoad.call(this, request, parent, isMain),
                ...providerAdaptersModule
            };
        }

        if (request === '../../../../api/_lib/ops-alerts' && opsAlertsModule) {
            return opsAlertsModule;
        }

        if (request === '../../../../api/_lib/payments/orders' && paymentsOrdersModule) {
            return paymentsOrdersModule;
        }

        if (request === '../../../../api/_lib/discount-trigger-linkage' && discountTriggerLinkageModule) {
            return discountTriggerLinkageModule;
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

test('query_hupijiao_order returns live gateway status without mutating anomaly state', async () => {
    const state = {
        orders: [
            {
                id: 'order-hj-query-1',
                user_id: 'user-query-1',
                provider: 'hupijiao',
                provider_order_no: 'HJ_QUERY_1',
                checkout_session_id: 'session-query-1',
                package_id: 'pkg-1',
                package_name: '查询套餐',
                site: 'cn',
                expected_amount: 20,
                paid_amount: null,
                points_amount: 1000,
                status: 'pending_review',
                claimed_at: null,
                paid_at: null,
                verified_at: null,
                sign_verified: false,
                amount_verified: false,
                created_at: '2026-04-16T09:00:00.000Z',
                last_error: 'missing_webhook',
                provider_metadata: {
                    gateway_open_order_id: 'OPEN_QUERY_1'
                },
                raw_payload: {}
            }
        ],
        providerAdaptersModule: {
            getPaymentProviderAdapter(providerKey) {
                assert.equal(providerKey, 'hupijiao');
                return {
                    async resolveRuntimeContext() {
                        return { provider: 'hupijiao' };
                    },
                    async queryOrder() {
                        return {
                            supported: true,
                            success: true,
                            providerOrderNo: 'HJ_QUERY_1',
                            openOrderId: 'OPEN_QUERY_1',
                            status: 'paid',
                            statusRaw: 'OD',
                            paidAmount: 20,
                            transactionId: 'TXN_QUERY_1',
                            message: 'success'
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
                targetId: 'order-hj-query-1',
                action: 'query_hupijiao_order'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.reload, false);
        assert.equal(payload.live_order.status, 'paid');
        assert.equal(payload.live_order.paidAmount, 20);
        assert.equal(payload.live_order.transactionId, 'TXN_QUERY_1');
        assert.match(payload.message, /虎皮椒实时状态：已支付/);
        assert.equal(state.anomalyCases.length, 0);
        assert.equal(state.orders[0].status, 'pending_review');
        assert.equal(state.paymentEvents.length, 0);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'payments.order.query');
        assert.equal(state.auditLogs[0].details.query_paid_amount, 20);
    });
});

test('reconcile_hupijiao_order credits the order, links checkout session, and issues linked discounts', async () => {
    const state = {
        orders: [
            {
                id: 'order-hj-reconcile-1',
                user_id: 'user-reconcile-1',
                provider: 'hupijiao',
                provider_order_no: 'HJ_RECONCILE_1',
                checkout_session_id: 'session-reconcile-1',
                package_id: 'pkg-1',
                package_name: '补单套餐',
                site: 'cn',
                expected_amount: 20,
                paid_amount: null,
                points_amount: 1000,
                status: 'pending_review',
                claimed_at: null,
                paid_at: null,
                verified_at: null,
                sign_verified: false,
                amount_verified: false,
                created_at: '2026-04-16T09:00:00.000Z',
                last_error: 'webhook_timeout',
                provider_metadata: {
                    gateway_open_order_id: 'OPEN_RECONCILE_1',
                    paid_points: 900,
                    bonus_points: 100
                },
                raw_payload: {
                    request: {
                        points_amount: 900,
                        bonus_points: 100
                    }
                }
            }
        ],
        providerAdaptersModule: {
            getPaymentProviderAdapter(providerKey) {
                assert.equal(providerKey, 'hupijiao');
                return {
                    async resolveRuntimeContext() {
                        return { provider: 'hupijiao' };
                    },
                    async queryOrder() {
                        return {
                            supported: true,
                            success: true,
                            providerOrderNo: 'HJ_RECONCILE_1',
                            openOrderId: 'OPEN_RECONCILE_1',
                            status: 'paid',
                            statusRaw: 'OD',
                            paidAmount: 20,
                            transactionId: 'TXN_RECONCILE_1',
                            message: 'success'
                        };
                    }
                };
            }
        },
        paymentsOrdersModule: {
            async reconcileCheckoutSessionForPaymentOrder() {
                return {
                    id: 'session-reconcile-1',
                    payment_order_id: 'order-hj-reconcile-1'
                };
            }
        },
        discountTriggerLinkageModule: {
            async maybeIssueRechargeDiscountAssets() {
                return {
                    success: true,
                    issued_count: 1
                };
            },
            async maybeIssueAffiliateDiscountAssetsForRecharge() {
                return {
                    success: true,
                    issued_count: 1
                };
            }
        }
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'order',
                targetId: 'order-hj-reconcile-1',
                action: 'reconcile_hupijiao_order',
                note: '网关显示已支付，执行人工补单'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /后台已完成补单并同步入账/);
        assert.equal(payload.anomaly_case.status, 'handled');
        assert.equal(payload.anomaly_case.last_action, 'reconcile_hupijiao_order');
        assert.equal(state.orders[0].status, 'redeemed');
        assert.equal(state.orders[0].paid_amount, 20);
        assert.equal(state.orders[0].amount_verified, true);
        assert.equal(state.orders[0].sign_verified, true);
        assert.equal(state.orders[0].provider_metadata.transaction_id, 'TXN_RECONCILE_1');
        assert.equal(state.orders[0].provider_metadata.admin_reconcile_note, '网关显示已支付，执行人工补单');
        assert.equal(state.orders[0].raw_payload.admin_reconcile.live_order.transactionId, 'TXN_RECONCILE_1');
        assert.equal(state.metrics.rechargeRpcCalls.length, 1);
        assert.equal(state.metrics.rechargeRpcCalls[0].target_user_id, 'user-reconcile-1');
        assert.equal(state.metrics.rechargeRpcCalls[0].p_reference_id, 'hupijiao_HJ_RECONCILE_1');
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].event_type, 'admin_reconcile');
        assert.equal(state.paymentEvents[0].processing_result, 'admin_reconcile_processed');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'payments.order.reconcile');
        assert.equal(state.auditLogs[0].details.checkout_session_id, 'session-reconcile-1');
        assert.equal(state.auditLogs[0].details.linked_discount_count, 1);
        assert.equal(state.auditLogs[0].details.linked_affiliate_discount_count, 1);
    });
});

test('reconcile_hupijiao_order fails closed when live amount mismatches the local expectation', async () => {
    const state = {
        orders: [
            {
                id: 'order-hj-reconcile-2',
                user_id: 'user-reconcile-2',
                provider: 'hupijiao',
                provider_order_no: 'HJ_RECONCILE_2',
                checkout_session_id: 'session-reconcile-2',
                package_id: 'pkg-2',
                package_name: '补单套餐',
                site: 'cn',
                expected_amount: 20,
                paid_amount: null,
                points_amount: 1000,
                status: 'pending_review',
                claimed_at: null,
                paid_at: null,
                verified_at: null,
                sign_verified: false,
                amount_verified: false,
                created_at: '2026-04-16T09:00:00.000Z',
                last_error: 'webhook_timeout',
                provider_metadata: {
                    gateway_open_order_id: 'OPEN_RECONCILE_2'
                },
                raw_payload: {}
            }
        ],
        providerAdaptersModule: {
            getPaymentProviderAdapter() {
                return {
                    async resolveRuntimeContext() {
                        return { provider: 'hupijiao' };
                    },
                    async queryOrder() {
                        return {
                            supported: true,
                            success: true,
                            providerOrderNo: 'HJ_RECONCILE_2',
                            openOrderId: 'OPEN_RECONCILE_2',
                            status: 'paid',
                            statusRaw: 'OD',
                            paidAmount: 19.5,
                            transactionId: 'TXN_RECONCILE_2',
                            message: 'success'
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
                targetId: 'order-hj-reconcile-2',
                action: 'reconcile_hupijiao_order',
                note: '尝试补单'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 409);
        assert.equal(payload.success, false);
        assert.match(payload.message, /与本地期望金额/);
        assert.equal(state.orders[0].status, 'pending_review');
        assert.equal(state.metrics.rechargeRpcCalls.length, 0);
        assert.equal(state.paymentEvents.length, 0);
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

test('refund_hupijiao reclaims credited points before refunding an already credited order', async () => {
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
                    gateway_open_order_id: 'OPEN_ORDER_2',
                    paid_points: 900,
                    bonus_points: 100
                },
                raw_payload: {
                    request: {
                        points_amount: 900,
                        bonus_points: 100
                    }
                }
            }
        ],
        userBalances: {
            'user-2': {
                total_balance: 1400,
                paid_balance: 1000,
                bonus_balance: 400
            }
        },
        refundReclaimRpcData: {
            deducted: 1000,
            deducted_paid: 900,
            deducted_bonus: 100,
            site: 'cn'
        },
        providerAdaptersModule: {
            getPaymentProviderAdapter() {
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
                            providerOrderNo: 'HJ_ORDER_2',
                            openOrderId: 'OPEN_ORDER_2',
                            status: 'paid',
                            statusRaw: 'OD',
                            message: 'success'
                        };
                    },
                    async refundOrder() {
                        return {
                            supported: true,
                            success: true,
                            providerOrderNo: 'HJ_ORDER_2',
                            openOrderId: 'OPEN_ORDER_2',
                            status: 'refunded',
                            statusRaw: 'CD',
                            message: 'success'
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
                targetId: 'order-hj-2',
                action: 'refund_hupijiao',
                note: '已入账订单不应直接退款'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.orders[0].status, 'refunded');
        assert.equal(state.orders[0].provider_metadata.refund_reclaimed_points, 1000);
        assert.equal(state.orders[0].provider_metadata.refund_reclaimed_paid_points, 900);
        assert.equal(state.orders[0].provider_metadata.refund_reclaimed_bonus_points, 100);
        assert.equal(state.orders[0].raw_payload.admin_refund.reclaim.reclaimedPaidPoints, 900);
        assert.equal(state.metrics.balanceRpcCalls.length, 1);
        assert.equal(state.metrics.refundReclaimRpcCalls.length, 1);
        assert.equal(state.metrics.rechargeRpcCalls.length, 0);
        assert.equal(state.pointsLedger.length, 1);
        assert.match(state.pointsLedger[0].reference_id, /admin-refund-reclaim:hupijiao:/);
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].processing_result, 'admin_refund_processed');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].details.refund_reclaimed_points, 1000);
    });
});

test('refund_hupijiao compensates reclaimed points when credited-order refund fails', async () => {
    const state = {
        orders: [
            {
                id: 'order-hj-3',
                user_id: 'user-3',
                provider: 'hupijiao',
                provider_order_no: 'HJ_ORDER_3',
                checkout_session_id: 'session-3',
                site: 'cn',
                expected_amount: 30,
                paid_amount: 30,
                points_amount: 1200,
                status: 'redeemed',
                claimed_at: '2026-03-24T08:15:00.000Z',
                paid_at: '2026-03-24T08:00:00.000Z',
                verified_at: '2026-03-24T08:05:00.000Z',
                last_error: null,
                provider_metadata: {
                    gateway_open_order_id: 'OPEN_ORDER_3',
                    paid_points: 1000,
                    bonus_points: 200
                },
                raw_payload: {
                    request: {
                        points_amount: 1000,
                        bonus_points: 200
                    }
                }
            }
        ],
        userBalances: {
            'user-3': {
                total_balance: 1800,
                paid_balance: 1200,
                bonus_balance: 600
            }
        },
        adminRoles: [
            { user_id: 'admin-1', role_name: 'admin', expires_at: null },
            { user_id: 'admin-2', role_name: 'super_admin', expires_at: null }
        ],
        refundReclaimRpcData: {
            deducted: 1200,
            deducted_paid: 1000,
            deducted_bonus: 200,
            site: 'cn'
        },
        providerAdaptersModule: {
            getPaymentProviderAdapter() {
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
                            providerOrderNo: 'HJ_ORDER_3',
                            openOrderId: 'OPEN_ORDER_3',
                            status: 'paid',
                            statusRaw: 'OD',
                            message: 'success'
                        };
                    },
                    async refundOrder() {
                        return {
                            supported: true,
                            success: false,
                            providerOrderNo: 'HJ_ORDER_3',
                            openOrderId: 'OPEN_ORDER_3',
                            status: 'paid',
                            statusRaw: 'OD',
                            message: 'gateway busy'
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
                targetId: 'order-hj-3',
                action: 'refund_hupijiao',
                note: '已入账售后退款'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 502);
        assert.equal(payload.success, false);
        assert.match(payload.message, /gateway busy/);
        assert.equal(state.orders[0].status, 'redeemed');
        assert.equal(state.metrics.refundReclaimRpcCalls.length, 1);
        assert.equal(state.metrics.rechargeRpcCalls.length, 1);
        assert.equal(state.pointsLedger.length, 2);
        assert.match(state.pointsLedger[0].reference_id, /admin-refund-reclaim:hupijiao:/);
        assert.match(state.pointsLedger[1].reference_id, /admin-refund-compensate:hupijiao:/);
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].processing_result, 'admin_refund_failed');
        assert.equal(state.systemNotifications.length, 2);
        assert.equal(state.systemNotifications.every((item) => item.title === '支付退款失败（已补回）'), true);
        assert.equal(state.systemNotifications.every((item) => item.type === 'warning'), true);
        assert.equal(state.systemNotifications.every((item) => String(item.content || '').includes('HJ_ORDER_3')), true);
        assert.equal(state.anomalyCases.length, 0);
        assert.equal(state.auditLogs.length, 0);
    });
});

test('refund_hupijiao fails closed when credited-order balance is insufficient for reclaim', async () => {
    let refundOrderCalled = false;
    const state = {
        orders: [
            {
                id: 'order-hj-4',
                user_id: 'user-4',
                provider: 'hupijiao',
                provider_order_no: 'HJ_ORDER_4',
                checkout_session_id: 'session-4',
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
                    gateway_open_order_id: 'OPEN_ORDER_4',
                    paid_points: 1000,
                    bonus_points: 0
                },
                raw_payload: {
                    request: {
                        points_amount: 1000,
                        bonus_points: 0
                    }
                }
            }
        ],
        userBalances: {
            'user-4': {
                total_balance: 300,
                paid_balance: 300,
                bonus_balance: 0
            }
        },
        adminRoles: [
            { user_id: 'admin-1', role_name: 'admin', expires_at: null }
        ],
        providerAdaptersModule: {
            getPaymentProviderAdapter() {
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
                            providerOrderNo: 'HJ_ORDER_4',
                            openOrderId: 'OPEN_ORDER_4',
                            status: 'paid',
                            statusRaw: 'OD',
                            message: 'success'
                        };
                    },
                    async refundOrder() {
                        refundOrderCalled = true;
                        return {
                            supported: true,
                            success: true
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
                targetId: 'order-hj-4',
                action: 'refund_hupijiao',
                note: '余额不足时应阻止退款'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 409);
        assert.equal(payload.success, false);
        assert.match(payload.message, /无法原子扣回/);
        assert.equal(refundOrderCalled, false);
        assert.equal(state.metrics.refundReclaimRpcCalls.length, 0);
        assert.equal(state.pointsLedger.length, 0);
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].processing_result, 'admin_refund_reclaim_failed');
        assert.equal(state.systemNotifications.length, 1);
        assert.equal(state.systemNotifications[0].title, '支付退款积分扣回失败');
        assert.equal(state.systemNotifications[0].type, 'alert');
        assert.equal(state.anomalyCases.length, 0);
        assert.equal(state.auditLogs.length, 0);
    });
});

test('refund_hupijiao dedupes repeated admin refund alerts within the recent window', async () => {
    const state = {
        orders: [
            {
                id: 'order-hj-5',
                user_id: 'user-5',
                provider: 'hupijiao',
                provider_order_no: 'HJ_ORDER_5',
                checkout_session_id: 'session-5',
                site: 'cn',
                expected_amount: 30,
                paid_amount: 30,
                points_amount: 1200,
                status: 'redeemed',
                claimed_at: '2026-03-24T08:15:00.000Z',
                paid_at: '2026-03-24T08:00:00.000Z',
                verified_at: '2026-03-24T08:05:00.000Z',
                last_error: null,
                provider_metadata: {
                    gateway_open_order_id: 'OPEN_ORDER_5',
                    paid_points: 1000,
                    bonus_points: 200
                },
                raw_payload: {
                    request: {
                        points_amount: 1000,
                        bonus_points: 200
                    }
                }
            }
        ],
        userBalances: {
            'user-5': {
                total_balance: 1800,
                paid_balance: 1200,
                bonus_balance: 600
            }
        },
        adminRoles: [
            { user_id: 'admin-1', role_name: 'admin', expires_at: null },
            { user_id: 'admin-2', role_name: 'admin', expires_at: null }
        ],
        refundReclaimRpcData: {
            deducted: 1200,
            deducted_paid: 1000,
            deducted_bonus: 200,
            site: 'cn'
        },
        providerAdaptersModule: {
            getPaymentProviderAdapter() {
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
                            providerOrderNo: 'HJ_ORDER_5',
                            openOrderId: 'OPEN_ORDER_5',
                            status: 'paid',
                            statusRaw: 'OD',
                            message: 'success'
                        };
                    },
                    async refundOrder() {
                        return {
                            supported: true,
                            success: false,
                            providerOrderNo: 'HJ_ORDER_5',
                            openOrderId: 'OPEN_ORDER_5',
                            status: 'paid',
                            statusRaw: 'OD',
                            message: 'gateway busy'
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
                targetId: 'order-hj-5',
                action: 'refund_hupijiao',
                note: '重复重试时不应刷爆通知'
            }
        };

        const firstRes = createMockResponse();
        await handler(req, firstRes);
        assert.equal(firstRes.statusCode, 502);
        assert.equal(state.systemNotifications.length, 2);

        const secondRes = createMockResponse();
        await handler(req, secondRes);
        assert.equal(secondRes.statusCode, 502);
        assert.equal(state.systemNotifications.length, 2);
        assert.equal(state.systemNotifications.every((item) => item.title === '支付退款失败（已补回）'), true);
    });
});

test('refund_hupijiao enqueues external ops alerts for critical refund failures', async () => {
    const state = {
        orders: [
            {
                id: 'order-hj-6',
                user_id: 'user-6',
                provider: 'hupijiao',
                provider_order_no: 'HJ_ORDER_6',
                checkout_session_id: 'session-6',
                site: 'cn',
                expected_amount: 30,
                paid_amount: 30,
                points_amount: 1000,
                status: 'redeemed',
                claimed_at: '2026-03-24T08:15:00.000Z',
                paid_at: '2026-03-24T08:00:00.000Z',
                verified_at: '2026-03-24T08:05:00.000Z',
                last_error: null,
                provider_metadata: {
                    gateway_open_order_id: 'OPEN_ORDER_6',
                    paid_points: 1000,
                    bonus_points: 0
                },
                raw_payload: {
                    request: {
                        points_amount: 1000,
                        bonus_points: 0
                    }
                }
            }
        ],
        userBalances: {
            'user-6': {
                total_balance: 100,
                paid_balance: 100,
                bonus_balance: 0
            }
        },
        adminRoles: [
            { user_id: 'admin-1', role_name: 'admin', expires_at: null }
        ],
        opsAlertEnqueues: [],
        providerAdaptersModule: {
            getPaymentProviderAdapter() {
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
                            providerOrderNo: 'HJ_ORDER_6',
                            openOrderId: 'OPEN_ORDER_6',
                            status: 'paid',
                            statusRaw: 'OD',
                            message: 'success'
                        };
                    },
                    async refundOrder() {
                        return {
                            supported: true,
                            success: true
                        };
                    }
                };
            }
        },
        opsAlertsModule: {
            async enqueueOpsAlertJob(_supabase, payload) {
                state.opsAlertEnqueues.push(payload);
                return { queued: true };
            }
        }
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'order',
                targetId: 'order-hj-6',
                action: 'refund_hupijiao',
                note: '扣回失败应进入站外告警'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 409);
        assert.equal(payload.success, false);
        assert.equal(state.opsAlertEnqueues.length, 1);
        assert.equal(state.opsAlertEnqueues[0].severity, 'critical');
        assert.equal(state.opsAlertEnqueues[0].payload.processing_result, 'admin_refund_reclaim_failed');
        assert.equal(state.opsAlertEnqueues[0].payload.provider_order_no, 'HJ_ORDER_6');
        assert.equal(state.opsAlertEnqueues[0].payload.topic_label, '扣回失败');
        assert.equal(state.opsAlertEnqueues[0].payload.order_status, 'redeemed');
        assert.equal(state.opsAlertEnqueues[0].payload.points_amount, 1000);
        assert.equal(state.opsAlertEnqueues[0].payload.note, '扣回失败应进入站外告警');
        assert.match(state.opsAlertEnqueues[0].payload.last_error, /无法原子扣回这笔订单的 1000 点积分/);
    });
});

test('ops_alert_job request_retry requeues a dead-letter alert job and records audit details', async () => {
    const state = {
        opsAlertJobs: [
            {
                id: 'ops-job-1',
                alert_type: 'payment_refund_ops',
                severity: 'critical',
                title: '支付退款积分回滚失败',
                content: '站点：CN\n订单号：HJ_ALERT_1',
                payload: {
                    provider: 'hupijiao',
                    provider_order_no: 'HJ_ALERT_1',
                    site: 'cn'
                },
                channels: ['telegram', 'feishu'],
                remaining_channels: ['telegram', 'feishu'],
                status: 'dead_letter',
                attempt_count: 6,
                max_attempts: 6,
                next_retry_at: null,
                delivered_at: null,
                last_error: 'telegram timeout',
                worker_name: 'worker-a',
                created_at: '2026-03-24T10:00:00.000Z',
                updated_at: '2026-03-24T10:10:00.000Z'
            }
        ]
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'ops_alert_job',
                targetId: 'ops-job-1',
                action: 'request_retry'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.ops_alert_job.status, 'retry');
        assert.equal(payload.ops_alert_job.attempt_count, 0);
        assert.equal(payload.ops_alert_job.last_error, null);
        assert.deepEqual(payload.ops_alert_job.remaining_channels, ['telegram', 'feishu']);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'payments.ops_alert.action');
        assert.equal(state.auditLogs[0].details.queue_previous_status, 'dead_letter');
        assert.equal(state.auditLogs[0].details.queue_next_status, 'retry');
    });
});
