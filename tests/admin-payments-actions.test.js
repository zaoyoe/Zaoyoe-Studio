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
    const checkoutSessions = state.checkoutSessions || [];
    const adminRoles = state.adminRoles || [];
    const systemConfigs = state.systemConfigs || [];
    const adminSecretStore = state.adminSecretStore || [];
    const systemNotifications = state.systemNotifications || [];
    state.anomalyCases = anomalyCases;
    state.opsAlertJobs = opsAlertJobs;
    state.paymentEvents = paymentEvents;
    state.pointsLedger = pointsLedger;
    state.checkoutSessions = checkoutSessions;
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
                    if (state.anomalyUpsertError) {
                        return {
                            data: query.single ? null : [],
                            error: state.anomalyUpsertError
                        };
                    }

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

                if (table === 'payment_anomaly_cases' && query.mode === 'select') {
                    const rows = sortRows(applyFilters(anomalyCases, query.filters), query.order);
                    return {
                        data: query.single ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'points_ledger' && query.mode === 'select') {
                    const rows = sortRows(applyFilters(pointsLedger, query.filters), query.order);
                    return {
                        data: query.single ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'payment_checkout_sessions' && query.mode === 'select') {
                    const rows = sortRows(applyFilters(checkoutSessions, query.filters), query.order);
                    return {
                        data: query.single ? (rows[0] || null) : rows,
                        error: rows.length ? null : { message: 'Checkout session not found' }
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

                if (table === 'payment_events' && query.mode === 'select') {
                    const rows = sortRows(applyFilters(paymentEvents, query.filters), query.order);
                    return {
                        data: query.single ? (rows[0] || null) : rows,
                        error: rows.length ? null : { message: 'Payment event not found' }
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
    state.metrics = state.metrics || {};
    state.metrics.requireAdminCalls = state.metrics.requireAdminCalls || 0;

    return {
        async requireAdmin() {
            state.metrics.requireAdminCalls += 1;
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

async function withPaymentsBatchActionHandler(state, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/payments/batch-actions.js');
    const actionsHandlerPath = path.resolve(__dirname, '../server/api-handlers/admin/payments/actions.js');
    const originalLoad = Module._load;
    const mockAdminModule = createMockAdminModule(state);
    const providerAdaptersModule = state.providerAdaptersModule || null;
    const opsAlertsModule = state.opsAlertsModule || null;
    const paymentsOrdersModule = state.paymentsOrdersModule || null;
    const discountTriggerLinkageModule = state.discountTriggerLinkageModule || null;

    delete require.cache[handlerPath];
    delete require.cache[actionsHandlerPath];
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
        delete require.cache[actionsHandlerPath];
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

test('approve_review settles nowpayments orders into wallet ledger', async () => {
    const state = {
        orders: [
            {
                id: 'order-np-review-1',
                user_id: 'user-nowpayments-1',
                provider: 'nowpayments',
                provider_order_no: 'NP_REVIEW_1',
                checkout_session_id: 'session-np-review-1',
                package_id: 'pkg-np-review-1',
                package_name: '进阶',
                site: 'cn',
                expected_amount: 0,
                paid_amount: 0,
                points_amount: 66,
                status: 'pending_review',
                paid_at: null,
                verified_at: null,
                claimed_at: null,
                last_error: 'wrong_asset_confirmed',
                provider_metadata: {
                    price_amount: 9.5,
                    price_currency: 'usd',
                    pay_amount: 9.595,
                    pay_currency: 'usdtbsc'
                }
            }
        ],
        paymentsOrdersModule: {
            async reconcileCheckoutSessionForPaymentOrder(payload) {
                state.reconcilePayload = payload;
                return { sessionId: 'session-np-review-1' };
            }
        },
        discountTriggerLinkageModule: {
            async maybeIssueRechargeDiscountAssets(payload) {
                state.discountPayload = payload;
                return { issued_count: 1 };
            },
            async maybeIssueAffiliateDiscountAssetsForRecharge(payload) {
                state.affiliatePayload = payload;
                return { issued_count: 1 };
            }
        }
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'order',
                targetId: 'order-np-review-1',
                action: 'approve_review',
                note: '链上到账确认'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.order.status, 'redeemed');
        assert.equal(state.metrics.reviewRpcCalls.length, 1);
        assert.equal(state.metrics.rechargeRpcCalls.length, 1);
        assert.deepEqual(state.metrics.rechargeRpcCalls[0], {
            target_user_id: 'user-nowpayments-1',
            p_paid: 66,
            p_bonus: 0,
            p_reason: 'USDT-BEP20充值: 进阶',
            p_reference_id: 'nowpayments_NP_REVIEW_1',
            p_site: 'cn'
        });
        assert.equal(state.pointsLedger.length, 1);
        assert.equal(state.pointsLedger[0].reference_id, 'nowpayments_NP_REVIEW_1');
        assert.equal(state.pointsLedger[0].amount, 66);
        assert.equal(state.orders[0].status, 'redeemed');
        assert.equal(state.orders[0].claimed_at.length > 0, true);
        assert.equal(state.orders[0].provider_metadata.admin_review_settlement_reference_id, 'nowpayments_NP_REVIEW_1');
        assert.equal(state.reconcilePayload.providerKey, 'nowpayments');
        assert.equal(state.discountPayload.paymentProvider, 'nowpayments');
        assert.equal(state.affiliatePayload.rechargeReferenceId, 'nowpayments_NP_REVIEW_1');
        assert.equal(state.auditLogs[0].details.nowpayments_review_settlement, 'credited');
        assert.equal(state.auditLogs[0].details.recharge_paid_points, 66);
    });
});

test('approve_review skips nowpayments recharge when matching ledger already exists', async () => {
    const state = {
        orders: [
            {
                id: 'order-np-review-2',
                user_id: 'user-nowpayments-2',
                provider: 'nowpayments',
                provider_order_no: 'NP_REVIEW_2',
                package_name: '进阶',
                site: 'cn',
                expected_amount: 0,
                paid_amount: 0,
                points_amount: 66,
                status: 'pending_review',
                paid_at: null,
                verified_at: null,
                claimed_at: null,
                provider_metadata: {}
            }
        ],
        pointsLedger: [
            {
                id: 'ledger-existing-np-2',
                user_id: 'user-nowpayments-2',
                reference_id: 'nowpayments_NP_REVIEW_2',
                site: 'cn',
                amount: 66
            }
        ],
        paymentsOrdersModule: {
            async reconcileCheckoutSessionForPaymentOrder(payload) {
                state.reconcilePayload = payload;
                return { sessionId: 'session-existing-np-2' };
            }
        },
        discountTriggerLinkageModule: {
            async maybeIssueRechargeDiscountAssets() {
                throw new Error('discounts should not be issued for existing ledger');
            },
            async maybeIssueAffiliateDiscountAssetsForRecharge() {
                throw new Error('affiliate discounts should not be issued for existing ledger');
            }
        }
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'order',
                targetId: 'order-np-review-2',
                action: 'approve_review',
                note: '重复审核确认'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.order.status, 'redeemed');
        assert.equal(state.metrics.rechargeRpcCalls.length, 0);
        assert.equal(state.pointsLedger.length, 1);
        assert.equal(state.orders[0].status, 'redeemed');
        assert.equal(state.auditLogs[0].details.nowpayments_review_settlement, 'existing_ledger');
        assert.equal(state.auditLogs[0].details.recharge_reference_id, 'nowpayments_NP_REVIEW_2');
    });
});

test('archive event anomaly stores archived status so summary can hide it from topic counts', async () => {
    const state = {
        paymentEvents: [
            {
                id: 'event-archive-1',
                provider: 'zpay',
                provider_order_no: 'ZP_ARCHIVE_1',
                processing_result: 'webhook_exception',
                error_message: 'duplicate callback already handled'
            }
        ],
        anomalyCases: [
            {
                id: 'case-event-archive-1',
                target_type: 'event',
                target_id: 'event-archive-1',
                status: 'handled',
                resolution: '已人工确认并标记处理完成。',
                last_action: 'mark_handled',
                last_action_at: '2026-04-19T02:04:00.000Z'
            }
        ]
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'event',
                targetId: 'event-archive-1',
                action: 'archive'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.anomaly_case.status, 'archived');
        assert.equal(payload.anomaly_case.last_action, 'archive');
        assert.equal(payload.anomaly_case.resolution, '该异常已归档，不再进入专题计数。');
        assert.equal(state.anomalyCases.length, 1);
        assert.equal(state.auditLogs[0].details.action, 'archive');
    });
});

test('archive rejects open anomaly items before they are handled', async () => {
    const state = {
        paymentEvents: [
            {
                id: 'event-archive-blocked-1',
                provider: 'zpay',
                provider_order_no: 'ZP_ARCHIVE_BLOCKED_1',
                processing_result: 'webhook_exception',
                error_message: 'duplicate callback still open'
            }
        ]
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'event',
                targetId: 'event-archive-blocked-1',
                action: 'archive'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 409);
        assert.equal(payload.success, false);
        assert.equal(payload.message, '只有已处理或已审核通过的异常项才能归档');
        assert.equal(state.anomalyCases.length, 0);
    });
});

test('archive returns a friendly message when the archived status migration is missing', async () => {
    const state = {
        paymentEvents: [
            {
                id: 'event-archive-migration-missing-1',
                provider: 'zpay',
                provider_order_no: 'ZP_ARCHIVE_MIGRATION_MISSING_1',
                processing_result: 'webhook_exception',
                error_message: 'duplicate callback already handled'
            }
        ],
        anomalyCases: [
            {
                id: 'case-event-archive-migration-missing-1',
                target_type: 'event',
                target_id: 'event-archive-migration-missing-1',
                status: 'handled',
                resolution: '已人工确认并标记处理完成。',
                last_action: 'mark_handled',
                last_action_at: '2026-04-19T02:14:00.000Z'
            }
        ],
        anomalyUpsertError: {
            code: '23514',
            message: 'new row for relation "payment_anomaly_cases" violates check constraint "payment_anomaly_cases_status_check"'
        }
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'event',
                targetId: 'event-archive-migration-missing-1',
                action: 'archive'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 409);
        assert.equal(payload.success, false);
        assert.equal(
            payload.message,
            '当前数据库还没有应用“异常归档”所需迁移，请先执行 20260419_allow_archived_payment_anomaly_cases.sql。'
        );
    });
});

test('shop profit audit action returns a friendly message when target type migration is missing', async () => {
    const state = {
        anomalyUpsertError: {
            code: '23514',
            message: 'new row for relation "payment_anomaly_cases" violates check constraint "payment_anomaly_cases_target_type_check"'
        }
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'shop_profit_audit',
                targetId: '11111111-1111-4111-8111-111111111111',
                action: 'ignore'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 409);
        assert.equal(payload.success, false);
        assert.equal(
            payload.message,
            '当前数据库还没有应用“商城利润审计异常处理”所需迁移，请先执行 20260610_allow_shop_profit_audit_anomaly_cases.sql。'
        );
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

test('query_zpay_order returns live gateway status without mutating anomaly state', async () => {
    const state = {
        orders: [
            {
                id: 'order-zp-query-1',
                user_id: 'user-zp-query-1',
                provider: 'zpay',
                provider_order_no: 'ZPAY_QUERY_1',
                checkout_session_id: 'session-zp-query-1',
                package_id: 'pkg-zp-1',
                package_name: '易支付查询套餐',
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
                created_at: '2026-04-16T10:00:00.000Z',
                last_error: 'missing_webhook',
                provider_metadata: {
                    trade_no: 'ZPAY_TRADE_QUERY_1'
                },
                raw_payload: {}
            }
        ],
        providerAdaptersModule: {
            getPaymentProviderAdapter(providerKey) {
                assert.equal(providerKey, 'zpay');
                return {
                    async resolveRuntimeContext() {
                        return { provider: 'zpay' };
                    },
                    async queryOrder() {
                        return {
                            supported: true,
                            success: true,
                            providerOrderNo: 'ZPAY_QUERY_1',
                            tradeNo: 'ZPAY_TRADE_QUERY_1',
                            status: 'paid',
                            statusRaw: 'TRADE_SUCCESS',
                            paidAmount: 20,
                            transactionId: 'ZPAY_TRADE_QUERY_1',
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
                targetId: 'order-zp-query-1',
                action: 'query_zpay_order'
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
        assert.equal(payload.live_order.transactionId, 'ZPAY_TRADE_QUERY_1');
        assert.match(payload.message, /易支付实时状态：已支付/);
        assert.equal(state.anomalyCases.length, 0);
        assert.equal(state.orders[0].status, 'pending_review');
        assert.equal(state.paymentEvents.length, 0);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'payments.order.query');
        assert.equal(state.auditLogs[0].details.query_provider, 'zpay');
        assert.equal(state.auditLogs[0].details.query_paid_amount, 20);
    });
});

test('query_nowpayments_order returns live payment status by payment id', async () => {
    const state = {
        orders: [
            {
                id: 'order-np-query-1',
                user_id: 'user-np-query-1',
                provider: 'nowpayments',
                provider_order_no: 'NP_QUERY_1',
                checkout_session_id: 'session-np-query-1',
                package_id: 'pkg-np-1',
                package_name: 'NOWPayments 查询套餐',
                site: 'cn',
                expected_amount: 0,
                paid_amount: null,
                points_amount: 66,
                status: 'pending_review',
                claimed_at: null,
                paid_at: null,
                verified_at: null,
                sign_verified: false,
                amount_verified: false,
                created_at: '2026-06-09T10:00:00.000Z',
                last_error: 'missing_webhook',
                provider_metadata: {
                    payment_id: '5731943810',
                    pay_currency: 'usdtbsc'
                },
                raw_payload: {}
            }
        ],
        providerAdaptersModule: {
            getPaymentProviderAdapter(providerKey) {
                assert.equal(providerKey, 'nowpayments');
                return {
                    async resolveRuntimeContext() {
                        return { provider: 'nowpayments' };
                    },
                    async queryOrder(input) {
                        assert.equal(input.providerOrderNo, 'NP_QUERY_1');
                        assert.equal(input.paymentId, '5731943810');
                        assert.equal(input.metadata.payment_id, '5731943810');
                        return {
                            supported: true,
                            success: true,
                            providerOrderNo: 'NP_QUERY_1',
                            openOrderId: '5731943810',
                            paymentId: '5731943810',
                            status: 'paid',
                            statusRaw: 'finished',
                            paidAmount: 9.595,
                            paidCurrency: 'USDT',
                            paidAmountLabel: '9.595 USDT',
                            transactionId: '0xnpqueryhash',
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
                targetId: 'order-np-query-1',
                action: 'query_nowpayments_order'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.reload, false);
        assert.equal(payload.live_order.status, 'paid');
        assert.equal(payload.live_order.paidAmount, 9.595);
        assert.equal(payload.live_order.paymentId, '5731943810');
        assert.match(payload.message, /NOWPayments实时状态：已支付/);
        assert.match(payload.message, /9\.595 USDT/);
        assert.equal(state.anomalyCases.length, 0);
        assert.equal(state.orders[0].status, 'pending_review');
        assert.equal(state.paymentEvents.length, 0);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'payments.order.query');
        assert.equal(state.auditLogs[0].details.query_provider, 'nowpayments');
        assert.equal(state.auditLogs[0].details.query_paid_amount, 9.595);
        assert.equal(state.auditLogs[0].details.query_paid_currency, 'USDT');
    });
});

test('query_nowpayments_order recovers payment id from checkout session before querying', async () => {
    const state = {
        orders: [
            {
                id: 'order-np-query-recover-1',
                user_id: 'user-np-query-recover-1',
                provider: 'nowpayments',
                provider_order_no: 'NP_QUERY_RECOVER_1',
                checkout_session_id: 'session-np-query-recover-1',
                site: 'cn',
                expected_amount: 0,
                paid_amount: 0,
                points_amount: 66,
                status: 'redeemed',
                claimed_at: '2026-06-09T11:00:00.000Z',
                created_at: '2026-06-09T10:30:00.000Z',
                provider_metadata: {
                    purchase_id: 'purchase-is-not-payment-id'
                },
                raw_payload: {}
            }
        ],
        checkoutSessions: [
            {
                id: 'session-np-query-recover-1',
                provider_metadata: {
                    payment_id: '5731943810'
                }
            }
        ],
        providerAdaptersModule: {
            getPaymentProviderAdapter(providerKey) {
                assert.equal(providerKey, 'nowpayments');
                return {
                    async resolveRuntimeContext() {
                        return { provider: 'nowpayments' };
                    },
                    async queryOrder(input) {
                        assert.equal(input.paymentId, '5731943810');
                        assert.equal(input.metadata.payment_id, '5731943810');
                        assert.equal(input.metadata.purchase_id, 'purchase-is-not-payment-id');
                        return {
                            supported: true,
                            success: true,
                            providerOrderNo: 'NP_QUERY_RECOVER_1',
                            paymentId: '5731943810',
                            openOrderId: '5731943810',
                            status: 'paid',
                            statusRaw: 'finished',
                            paidAmount: 9.595,
                            paidCurrency: 'USDT',
                            paidAmountLabel: '9.595 USDT',
                            transactionId: '0xrecover',
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
                targetId: 'order-np-query-recover-1',
                action: 'query_nowpayments_order'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.live_order.paymentId, '5731943810');
        assert.match(payload.message, /9\.595 USDT/);
        assert.equal(state.auditLogs[0].details.query_provider, 'nowpayments');
    });
});

test('query_zpay_order syncs externally refunded orders back to local refunded state', async () => {
    const state = {
        defaultUserBalance: 5,
        orders: [
            {
                id: 'order-zp-query-refunded-1',
                user_id: 'user-zp-query-refunded-1',
                provider: 'zpay',
                provider_order_no: 'ZPAY_QUERY_REFUNDED_1',
                checkout_session_id: 'session-zp-query-refunded-1',
                package_id: null,
                package_name: '易支付退款查询套餐',
                site: 'cn',
                expected_amount: 0.01,
                paid_amount: 0.01,
                points_amount: 0.01,
                status: 'redeemed',
                claimed_at: '2026-04-16T10:05:00.000Z',
                paid_at: '2026-04-16T10:02:00.000Z',
                verified_at: '2026-04-16T10:03:00.000Z',
                sign_verified: true,
                amount_verified: true,
                created_at: '2026-04-16T10:00:00.000Z',
                last_error: null,
                provider_metadata: {
                    trade_no: 'ZPAY_TRADE_REFUNDED_1',
                    payment_type: 'alipay'
                },
                raw_payload: {}
            }
        ],
        providerAdaptersModule: {
            getPaymentProviderAdapter(providerKey) {
                assert.equal(providerKey, 'zpay');
                return {
                    async resolveRuntimeContext() {
                        return { provider: 'zpay' };
                    },
                    async queryOrder() {
                        return {
                            supported: true,
                            success: true,
                            providerOrderNo: 'ZPAY_QUERY_REFUNDED_1',
                            tradeNo: 'ZPAY_TRADE_REFUNDED_1',
                            status: 'refunded',
                            statusRaw: '2',
                            paidAmount: 0.01,
                            transactionId: 'ZPAY_TRADE_REFUNDED_1',
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
                targetId: 'order-zp-query-refunded-1',
                action: 'query_zpay_order'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.reload, true);
        assert.equal(payload.live_order.status, 'refunded');
        assert.match(payload.message, /已退款/);
        assert.match(payload.message, /已同步本地退款状态/);
        assert.equal(state.orders[0].status, 'refunded');
        assert.equal(state.orders[0].provider_metadata.refund_status, 'refunded');
        assert.equal(state.orders[0].provider_metadata.payment_status, 'refunded');
        assert.equal(state.orders[0].provider_metadata.refund_source, 'gateway_query_sync');
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].processing_result, 'admin_refund_synced_refunded');
        assert.equal(state.pointsLedger.length, 1);
        assert.equal(state.pointsLedger[0].amount, -0.01);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'payments.order.query');
        assert.equal(state.auditLogs[0].details.refund_status, 'refunded');
        assert.equal(state.auditLogs[0].details.refund_reclaimed_points, 0.01);
    });
});

test('refund_nowpayments blocks before point reclaim when payout prerequisites are missing', async () => {
    const state = {
        defaultUserBalance: 66,
        orders: [
            {
                id: 'order-np-refund-blocked-1',
                user_id: 'user-np-refund-blocked-1',
                provider: 'nowpayments',
                provider_order_no: 'NP_REFUND_BLOCKED_1',
                checkout_session_id: 'session-np-refund-blocked-1',
                site: 'cn',
                expected_amount: 0,
                paid_amount: 0,
                points_amount: 66,
                status: 'redeemed',
                claimed_at: '2026-06-09T10:05:00.000Z',
                paid_at: '2026-06-09T10:03:00.000Z',
                verified_at: '2026-06-09T10:04:00.000Z',
                provider_metadata: {
                    payment_id: '5731943810',
                    pay_address: '0xmerchantreceiveaddress',
                    paid_points: 66,
                    bonus_points: 0
                },
                raw_payload: {}
            }
        ]
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'order',
                targetId: 'order-np-refund-blocked-1',
                action: 'refund_nowpayments',
                note: '用户申请退款'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 409);
        assert.equal(payload.success, false);
        assert.match(payload.message, /NOWPayments 官方退款需要通过 Payout 出款/);
        assert.match(payload.message, /pay_address 是商户收款地址/);
        assert.equal(state.metrics.refundReclaimRpcCalls.length, 0);
        assert.equal(state.pointsLedger.length, 0);
        assert.equal(state.orders[0].status, 'redeemed');
        assert.equal(state.paymentEvents.length, 0);
        assert.equal(state.auditLogs.length, 0);
    });
});

test('query_zpay_order explains that the decimal refund reclaim migration is still missing when legacy integer RPC rejects 0.01', async () => {
    const state = {
        orders: [
            {
                id: 'order-zp-query-refunded-legacy-rpc',
                user_id: 'user-zp-query-refunded-legacy-rpc',
                provider: 'zpay',
                provider_order_no: 'ZPAY_QUERY_REFUNDED_LEGACY_RPC',
                checkout_session_id: 'session-zp-query-refunded-legacy-rpc',
                site: 'cn',
                expected_amount: 0.01,
                paid_amount: 0.01,
                points_amount: 0.01,
                status: 'redeemed',
                claimed_at: '2026-04-18T13:30:00.000Z',
                paid_at: '2026-04-18T13:25:00.000Z',
                verified_at: '2026-04-18T13:25:10.000Z',
                provider_metadata: {
                    trade_no: 'ZPAY_TRADE_REFUNDED_LEGACY_RPC',
                    paid_points: 0.01,
                    bonus_points: 0
                },
                raw_payload: {}
            }
        ],
        userBalances: {
            'user-zp-query-refunded-legacy-rpc': {
                total_balance: 0.01,
                paid_balance: 0.01,
                bonus_balance: 0
            }
        },
        refundReclaimRpcError: {
            message: 'invalid input syntax for type integer: "0.01"'
        },
        providerAdaptersModule: {
            getPaymentProviderAdapter(providerKey) {
                assert.equal(providerKey, 'zpay');
                return {
                    async resolveRuntimeContext() {
                        return { provider: 'zpay' };
                    },
                    async queryOrder() {
                        return {
                            supported: true,
                            success: true,
                            providerOrderNo: 'ZPAY_QUERY_REFUNDED_LEGACY_RPC',
                            tradeNo: 'ZPAY_TRADE_REFUNDED_LEGACY_RPC',
                            status: 'refunded',
                            statusRaw: '2',
                            paidAmount: 0.01,
                            transactionId: 'ZPAY_TRADE_REFUNDED_LEGACY_RPC',
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
                targetId: 'order-zp-query-refunded-legacy-rpc',
                action: 'query_zpay_order'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 409);
        assert.equal(payload.success, false);
        assert.match(payload.message, /退款扣回 RPC 仍是整数版本/);
        assert.match(payload.message, /20260418_enable_decimal_refund_reclaim_rpc\.sql/);
        assert.equal(state.orders[0].status, 'redeemed');
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].processing_result, 'admin_refund_reclaim_failed');
        assert.equal(state.auditLogs.length, 0);
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

test('reconcile_zpay_order credits the order, links checkout session, and records zpay metadata', async () => {
    const state = {
        orders: [
            {
                id: 'order-zp-reconcile-1',
                user_id: 'user-zp-reconcile-1',
                provider: 'zpay',
                provider_order_no: 'ZPAY_RECONCILE_1',
                checkout_session_id: 'session-zp-reconcile-1',
                package_id: 'pkg-zp-2',
                package_name: '易支付补单套餐',
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
                created_at: '2026-04-16T10:20:00.000Z',
                last_error: 'webhook_timeout',
                provider_metadata: {
                    trade_no: 'ZPAY_TRADE_RECONCILE_1',
                    paid_points: 950,
                    bonus_points: 50
                },
                raw_payload: {
                    request: {
                        points_amount: 950,
                        bonus_points: 50
                    }
                }
            }
        ],
        providerAdaptersModule: {
            getPaymentProviderAdapter(providerKey) {
                assert.equal(providerKey, 'zpay');
                return {
                    async resolveRuntimeContext() {
                        return { provider: 'zpay' };
                    },
                    async queryOrder() {
                        return {
                            supported: true,
                            success: true,
                            providerOrderNo: 'ZPAY_RECONCILE_1',
                            tradeNo: 'ZPAY_TRADE_RECONCILE_1',
                            status: 'paid',
                            statusRaw: 'TRADE_SUCCESS',
                            paidAmount: 20,
                            transactionId: 'ZPAY_TRADE_RECONCILE_1',
                            message: 'success'
                        };
                    }
                };
            }
        },
        paymentsOrdersModule: {
            async reconcileCheckoutSessionForPaymentOrder() {
                return {
                    id: 'session-zp-reconcile-1',
                    payment_order_id: 'order-zp-reconcile-1'
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
                targetId: 'order-zp-reconcile-1',
                action: 'reconcile_zpay_order',
                note: '易支付查单确认已支付，执行人工补单'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /后台已完成补单并同步入账/);
        assert.equal(payload.anomaly_case.status, 'handled');
        assert.equal(payload.anomaly_case.last_action, 'reconcile_zpay_order');
        assert.equal(state.orders[0].status, 'redeemed');
        assert.equal(state.orders[0].paid_amount, 20);
        assert.equal(state.orders[0].amount_verified, true);
        assert.equal(state.orders[0].sign_verified, true);
        assert.equal(state.orders[0].provider_metadata.trade_no, 'ZPAY_TRADE_RECONCILE_1');
        assert.equal(state.orders[0].provider_metadata.transaction_id, 'ZPAY_TRADE_RECONCILE_1');
        assert.equal(state.orders[0].provider_metadata.admin_reconcile_note, '易支付查单确认已支付，执行人工补单');
        assert.equal(state.orders[0].raw_payload.admin_reconcile.live_order.transactionId, 'ZPAY_TRADE_RECONCILE_1');
        assert.equal(state.metrics.rechargeRpcCalls.length, 1);
        assert.equal(state.metrics.rechargeRpcCalls[0].target_user_id, 'user-zp-reconcile-1');
        assert.equal(state.metrics.rechargeRpcCalls[0].p_reference_id, 'zpay_ZPAY_RECONCILE_1');
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].provider, 'zpay');
        assert.equal(state.paymentEvents[0].event_type, 'admin_reconcile');
        assert.equal(state.paymentEvents[0].processing_result, 'admin_reconcile_processed');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'payments.order.reconcile');
        assert.equal(state.auditLogs[0].details.reconcile_provider, 'zpay');
        assert.equal(state.auditLogs[0].details.gateway_transaction_id, 'ZPAY_TRADE_RECONCILE_1');
        assert.equal(state.auditLogs[0].details.checkout_session_id, 'session-zp-reconcile-1');
    });
});

test('reconcile_checkout_session links a redeemed order without recharging points', async () => {
    const state = {
        orders: [
            {
                id: 'order-session-backfill-1',
                user_id: 'user-session-backfill-1',
                provider: 'zpay',
                provider_order_no: 'ZPAY_SESSION_BACKFILL_1',
                checkout_session_id: null,
                package_id: 'pkg-session-backfill',
                package_name: '易支付自定义充值',
                site: 'cn',
                expected_amount: 0.01,
                paid_amount: 0.01,
                points_amount: 0.01,
                status: 'redeemed',
                claimed_at: '2026-04-18T12:02:00.000Z',
                paid_at: '2026-04-18T12:01:00.000Z',
                verified_at: '2026-04-18T12:02:00.000Z',
                sign_verified: true,
                amount_verified: true,
                created_at: '2026-04-18T12:00:00.000Z',
                last_error: null,
                provider_metadata: {
                    trade_no: 'ZPAY_SESSION_BACKFILL_TRADE_1'
                },
                raw_payload: {}
            }
        ],
        paymentsOrdersModule: {
            async reconcileCheckoutSessionForPaymentOrder(args) {
                assert.equal(args.paymentOrderId, 'order-session-backfill-1');
                assert.equal(args.providerKey, 'zpay');
                assert.equal(args.linkedBy, 'admin_checkout_session_reconcile');
                state.orders[0].checkout_session_id = 'session-backfill-1';
                state.orders[0].provider_metadata = {
                    ...state.orders[0].provider_metadata,
                    checkout_session_id: 'session-backfill-1',
                    checkout_session_status: 'completed',
                    checkout_session_linked_by: 'admin_checkout_session_reconcile'
                };
                return {
                    sessionId: 'session-backfill-1',
                    checkoutSession: {
                        id: 'session-backfill-1',
                        status: 'completed'
                    },
                    paymentOrderId: 'order-session-backfill-1'
                };
            }
        }
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'order',
                targetId: 'order-session-backfill-1',
                action: 'reconcile_checkout_session'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.message, '已补回支付意图关联，不会重复入账。');
        assert.equal(payload.anomaly_case.status, 'handled');
        assert.equal(payload.anomaly_case.last_action, 'reconcile_checkout_session');
        assert.equal(state.orders[0].checkout_session_id, 'session-backfill-1');
        assert.equal(state.orders[0].provider_metadata.checkout_session_linked_by, 'admin_checkout_session_reconcile');
        assert.equal(state.metrics.rechargeRpcCalls.length, 0);
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].processing_result, 'admin_checkout_session_reconciled');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'payments.order.reconcile');
        assert.equal(state.auditLogs[0].details.checkout_session_id, 'session-backfill-1');
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

test('refund_zpay refunds an uncredited order, syncs local state, and records audit data', async () => {
    let refundArgs = null;
    const state = {
        orders: [
            {
                id: 'order-zp-refund-1',
                user_id: 'user-zp-refund-1',
                provider: 'zpay',
                provider_order_no: 'ZPAY_ORDER_1',
                checkout_session_id: 'session-zp-refund-1',
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
                    trade_no: 'ZPAY_TRADE_1'
                },
                raw_payload: {}
            }
        ],
        providerAdaptersModule: {
            getPaymentProviderAdapter(providerKey) {
                assert.equal(providerKey, 'zpay');
                return {
                    async resolveRuntimeContext() {
                        return {
                            provider: 'zpay'
                        };
                    },
                    async queryOrder() {
                        return {
                            supported: true,
                            success: true,
                            providerOrderNo: 'ZPAY_ORDER_1',
                            tradeNo: 'ZPAY_TRADE_1',
                            status: 'paid',
                            statusRaw: 'TRADE_SUCCESS',
                            message: 'success',
                            transactionId: 'ZPAY_TRADE_1'
                        };
                    },
                    async refundOrder(args) {
                        refundArgs = args;
                        return {
                            supported: true,
                            success: true,
                            providerOrderNo: 'ZPAY_ORDER_1',
                            tradeNo: 'ZPAY_TRADE_1',
                            status: 'refunded',
                            statusRaw: 'REFUNDED',
                            message: 'success',
                            responsePayload: {
                                code: 1,
                                msg: '退款成功'
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
                targetId: 'order-zp-refund-1',
                action: 'refund_zpay',
                note: '易支付原路退款'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.anomaly_case.status, 'handled');
        assert.equal(payload.anomaly_case.last_action, 'refund_zpay');
        assert.equal(refundArgs.providerOrderNo, 'ZPAY_ORDER_1');
        assert.equal(refundArgs.tradeNo, 'ZPAY_TRADE_1');
        assert.equal(refundArgs.money, 20);
        assert.equal(state.orders[0].status, 'refunded');
        assert.equal(state.orders[0].provider_metadata.refund_status, 'refunded');
        assert.equal(state.orders[0].provider_metadata.payment_status, 'refunded');
        assert.equal(state.orders[0].provider_metadata.refund_source, 'admin_action');
        assert.equal(state.orders[0].provider_metadata.trade_no, 'ZPAY_TRADE_1');
        assert.equal(state.orders[0].provider_metadata.transaction_id, 'ZPAY_TRADE_1');
        assert.equal(state.orders[0].raw_payload.admin_refund.note, '易支付原路退款');
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].provider, 'zpay');
        assert.equal(state.paymentEvents[0].event_type, 'admin_refund');
        assert.equal(state.paymentEvents[0].processing_result, 'admin_refund_processed');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'payments.anomaly.action');
        assert.equal(state.auditLogs[0].details.refund_provider, 'zpay');
        assert.equal(state.auditLogs[0].details.gateway_transaction_id, 'ZPAY_TRADE_1');
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

        assert.equal(res.statusCode, 409);
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
        assert.equal(firstRes.statusCode, 409);
        assert.equal(state.systemNotifications.length, 2);

        const secondRes = createMockResponse();
        await handler(req, secondRes);
        assert.equal(secondRes.statusCode, 409);
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

test('payments batch actions process ops alert jobs through one admin request', async () => {
    const state = {
        opsAlertJobs: [
            {
                id: 'ops-job-batch-1',
                alert_type: 'payment_refund_ops',
                severity: 'critical',
                title: '支付退款积分回滚失败',
                content: '站点：CN\n订单号：BATCH_1',
                payload: { provider: 'hupijiao', provider_order_no: 'BATCH_1', site: 'cn' },
                channels: ['telegram'],
                remaining_channels: ['telegram'],
                status: 'dead_letter',
                attempt_count: 6,
                max_attempts: 6
            },
            {
                id: 'ops-job-batch-2',
                alert_type: 'payment_refund_ops',
                severity: 'warning',
                title: '支付退款失败',
                content: '站点：CN\n订单号：BATCH_2',
                payload: { provider: 'zpay', provider_order_no: 'BATCH_2', site: 'cn' },
                channels: ['feishu'],
                remaining_channels: ['feishu'],
                status: 'retry',
                attempt_count: 1,
                max_attempts: 6
            }
        ]
    };

    await withPaymentsBatchActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                action: 'mark_handled',
                targets: [
                    { targetType: 'ops_alert_job', targetId: 'ops-job-batch-1' },
                    { targetType: 'ops_alert_job', targetId: 'ops-job-batch-2' },
                    { targetType: 'ops_alert_job', targetId: 'ops-job-batch-2' }
                ]
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.completed, true);
        assert.equal(payload.total_count, 2);
        assert.equal(payload.success_count, 2);
        assert.equal(payload.fail_count, 0);
        assert.equal(state.opsAlertJobs[0].status, 'handled');
        assert.equal(state.opsAlertJobs[1].status, 'handled');
        assert.equal(state.auditLogs.length, 2);
        assert.equal(state.auditLogs.every((entry) => entry.actionType === 'payments.ops_alert.action'), true);
        assert.equal(state.metrics.requireAdminCalls, 1);
    });
});

test('payments batch actions can ignore shop profit audit items', async () => {
    const state = {};

    await withPaymentsBatchActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                action: 'ignore',
                targets: [
                    { targetType: 'shop_profit_audit', targetId: '11111111-1111-4111-8111-111111111111' },
                    { targetType: 'shop_profit_audit', targetId: '22222222-2222-4222-8222-222222222222' }
                ]
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.completed, true);
        assert.equal(payload.total_count, 2);
        assert.equal(payload.success_count, 2);
        assert.equal(state.anomalyCases.length, 2);
        assert.equal(state.anomalyCases.every((item) => item.target_type === 'shop_profit_audit'), true);
        assert.equal(state.anomalyCases.every((item) => item.status === 'ignored'), true);
        assert.equal(state.anomalyCases.every((item) => item.last_action === 'ignore'), true);
        assert.equal(state.auditLogs.length, 2);
        assert.equal(state.auditLogs.every((entry) => entry.actionType === 'payments.anomaly.action'), true);
    });
});

test('payments batch actions return per-target failures without dropping successful items', async () => {
    const state = {
        opsAlertJobs: [
            {
                id: 'ops-job-batch-retry-1',
                alert_type: 'payment_refund_ops',
                severity: 'critical',
                title: '支付退款积分回滚失败',
                content: '站点：CN\n订单号：RETRY_1',
                payload: { provider: 'hupijiao', provider_order_no: 'RETRY_1', site: 'cn' },
                channels: ['telegram'],
                remaining_channels: ['telegram'],
                status: 'dead_letter',
                attempt_count: 6,
                max_attempts: 6
            },
            {
                id: 'ops-job-batch-retry-2',
                alert_type: 'payment_refund_ops',
                severity: 'warning',
                title: '支付退款失败',
                content: '站点：CN\n订单号：RETRY_2',
                payload: { provider: 'zpay', provider_order_no: 'RETRY_2', site: 'cn' },
                channels: ['feishu'],
                remaining_channels: ['feishu'],
                status: 'handled',
                attempt_count: 1,
                max_attempts: 6
            }
        ]
    };

    await withPaymentsBatchActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                action: 'request_retry',
                targets: [
                    { targetType: 'ops_alert_job', targetId: 'ops-job-batch-retry-1' },
                    { targetType: 'ops_alert_job', targetId: 'ops-job-batch-retry-2' }
                ]
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.completed, false);
        assert.equal(payload.partial, true);
        assert.equal(payload.total_count, 2);
        assert.equal(payload.success_count, 1);
        assert.equal(payload.fail_count, 1);
        assert.equal(payload.results[0].success, true);
        assert.equal(payload.results[1].success, false);
        assert.match(payload.results[1].message, /只有死信状态/);
        assert.equal(state.opsAlertJobs[0].status, 'retry');
        assert.equal(state.opsAlertJobs[1].status, 'handled');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.metrics.requireAdminCalls, 1);
    });
});
