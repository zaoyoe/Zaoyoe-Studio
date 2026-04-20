const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        order: null,
        range: null,
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
        in(column, values) {
            state.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [values] });
            return builder;
        },
        gte(column, value) {
            state.filters.push({ op: 'gte', column, value });
            return builder;
        },
        lte(column, value) {
            state.filters.push({ op: 'lte', column, value });
            return builder;
        },
        order(column, options = {}) {
            state.order = { column, ascending: options.ascending !== false };
            return builder;
        },
        range(from, to) {
            state.range = { from, to };
            return builder;
        },
        insert(payload) {
            state.mode = 'insert';
            state.payload = payload;
            return builder;
        },
        single() {
            state.single = true;
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

function compareValue(left, right) {
    const leftDate = Date.parse(left);
    const rightDate = Date.parse(right);

    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) {
        return leftDate - rightDate;
    }

    if (typeof left === 'number' && typeof right === 'number') {
        return left - right;
    }

    return String(left || '').localeCompare(String(right || ''));
}

function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every(({ op, column, value }) => {
        if (op === 'eq') return row[column] === value;
        if (op === 'in') return value.includes(row[column]);
        if (op === 'gte') return compareValue(row[column], value) >= 0;
        if (op === 'lte') return compareValue(row[column], value) <= 0;
        return true;
    }));
}

function createSupabaseStub(state = {}) {
    const paymentOrders = state.paymentOrders || [];
    const paymentEvents = state.paymentEvents || [];
    const checkoutSessions = state.checkoutSessions || [];
    const paymentQueryAttempts = state.paymentQueryAttempts || [];
    const paymentAnomalyCases = state.paymentAnomalyCases || [];
    const opsAlertJobs = state.opsAlertJobs || [];
    const profiles = state.profiles || [];
    const shopOrders = state.shopOrders || [];
    const pointsLedger = state.pointsLedger || [];
    const pointsBalance = state.pointsBalance || [];
    state.rpcCalls = state.rpcCalls || [];
    state.tableAccesses = state.tableAccesses || [];

    return {
        async rpc(name, args = {}) {
            state.rpcCalls.push({ name, args });

            if (name === 'fn_admin_get_payment_overview_summary') {
                return {
                    data: state.overviewSummaryRpc || null,
                    error: state.overviewSummaryRpcError || null
                };
            }

            if (name === 'fn_admin_get_payment_finance_summary') {
                return {
                    data: state.financeSummaryRpc || null,
                    error: state.financeSummaryRpcError || null
                };
            }

            return {
                data: null,
                error: { message: `Unexpected rpc: ${name}`, code: '42883' }
            };
        },
        from(table) {
            return createQueryBuilder(async (query) => {
                state.tableAccesses.push({ table, mode: query.mode });

                if (table === 'payment_orders' && query.mode === 'select') {
                    let rows = applyFilters(paymentOrders, query.filters);
                    if (query.order) {
                        const { column, ascending } = query.order;
                        rows = rows.slice().sort((left, right) => (
                            ascending
                                ? compareValue(left[column], right[column])
                                : compareValue(right[column], left[column])
                        ));
                    }
                    const from = query.range?.from ?? 0;
                    const to = query.range?.to ?? (rows.length ? rows.length - 1 : -1);
                    return {
                        data: rows.slice(from, to + 1),
                        error: null
                    };
                }

                if (table === 'payment_events' && query.mode === 'select') {
                    let rows = applyFilters(paymentEvents, query.filters);
                    if (query.order) {
                        const { column, ascending } = query.order;
                        rows = rows.slice().sort((left, right) => (
                            ascending
                                ? compareValue(left[column], right[column])
                                : compareValue(right[column], left[column])
                        ));
                    }
                    const from = query.range?.from ?? 0;
                    const to = query.range?.to ?? (rows.length ? rows.length - 1 : -1);
                    return {
                        data: rows.slice(from, to + 1),
                        error: null
                    };
                }

                if (table === 'payment_checkout_sessions' && query.mode === 'select') {
                    let rows = applyFilters(checkoutSessions, query.filters);
                    if (query.order) {
                        const { column, ascending } = query.order;
                        rows = rows.slice().sort((left, right) => (
                            ascending
                                ? compareValue(left[column], right[column])
                                : compareValue(right[column], left[column])
                        ));
                    }
                    const from = query.range?.from ?? 0;
                    const to = query.range?.to ?? (rows.length ? rows.length - 1 : -1);
                    return {
                        data: rows.slice(from, to + 1),
                        error: null
                    };
                }

                if (table === 'payment_query_attempts' && query.mode === 'select') {
                    let rows = applyFilters(paymentQueryAttempts, query.filters);
                    if (query.order) {
                        const { column, ascending } = query.order;
                        rows = rows.slice().sort((left, right) => (
                            ascending
                                ? compareValue(left[column], right[column])
                                : compareValue(right[column], left[column])
                        ));
                    }
                    const from = query.range?.from ?? 0;
                    const to = query.range?.to ?? (rows.length ? rows.length - 1 : -1);
                    return {
                        data: rows.slice(from, to + 1),
                        error: null
                    };
                }

                if (table === 'payment_anomaly_cases' && query.mode === 'select') {
                    let rows = applyFilters(paymentAnomalyCases, query.filters);
                    if (query.order) {
                        const { column, ascending } = query.order;
                        rows = rows.slice().sort((left, right) => (
                            ascending
                                ? compareValue(left[column], right[column])
                                : compareValue(right[column], left[column])
                        ));
                    }
                    const from = query.range?.from ?? 0;
                    const to = query.range?.to ?? (rows.length ? rows.length - 1 : -1);
                    return {
                        data: rows.slice(from, to + 1),
                        error: null
                    };
                }

                if (table === 'ops_alert_jobs' && query.mode === 'select') {
                    let rows = applyFilters(opsAlertJobs, query.filters);
                    if (query.order) {
                        const { column, ascending } = query.order;
                        rows = rows.slice().sort((left, right) => (
                            ascending
                                ? compareValue(left[column], right[column])
                                : compareValue(right[column], left[column])
                        ));
                    }
                    const from = query.range?.from ?? 0;
                    const to = query.range?.to ?? (rows.length ? rows.length - 1 : -1);
                    return {
                        data: rows.slice(from, to + 1),
                        error: null
                    };
                }

                if (table === 'profiles' && query.mode === 'select') {
                    const rows = applyFilters(profiles, query.filters);
                    return {
                        data: rows,
                        error: null
                    };
                }

                if (table === 'shop_orders' && query.mode === 'select') {
                    let rows = applyFilters(shopOrders, query.filters);
                    if (query.order) {
                        const { column, ascending } = query.order;
                        rows = rows.slice().sort((left, right) => (
                            ascending
                                ? compareValue(left[column], right[column])
                                : compareValue(right[column], left[column])
                        ));
                    }
                    const from = query.range?.from ?? 0;
                    const to = query.range?.to ?? (rows.length ? rows.length - 1 : -1);
                    return {
                        data: rows.slice(from, to + 1),
                        error: null
                    };
                }

                if (table === 'points_ledger' && query.mode === 'select') {
                    let rows = applyFilters(pointsLedger, query.filters);
                    if (query.order) {
                        const { column, ascending } = query.order;
                        rows = rows.slice().sort((left, right) => (
                            ascending
                                ? compareValue(left[column], right[column])
                                : compareValue(right[column], left[column])
                        ));
                    }
                    const from = query.range?.from ?? 0;
                    const to = query.range?.to ?? (rows.length ? rows.length - 1 : -1);
                    return {
                        data: rows.slice(from, to + 1),
                        error: null
                    };
                }

                if (table === 'points_balance' && query.mode === 'select') {
                    let rows = applyFilters(pointsBalance, query.filters);
                    if (query.order) {
                        const { column, ascending } = query.order;
                        rows = rows.slice().sort((left, right) => (
                            ascending
                                ? compareValue(left[column], right[column])
                                : compareValue(right[column], left[column])
                        ));
                    }
                    const from = query.range?.from ?? 0;
                    const to = query.range?.to ?? (rows.length ? rows.length - 1 : -1);
                    return {
                        data: rows.slice(from, to + 1),
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
                adminSupabase: supabase,
                user: { id: 'admin-1', email: 'admin@example.com' }
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

async function withPaymentsSummaryHandler(state, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/payments/summary.js');
    const originalLoad = Module._load;
    const mockAdminModule = createMockAdminModule(state);
    const mockProviderAdaptersModule = state.providerAdaptersModule || null;

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return mockAdminModule;
        }
        if (request === '../../../../api/_lib/payments/provider-adapters' && mockProviderAdaptersModule) {
            return mockProviderAdaptersModule;
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

test('payments summary groups refund failure events into dedicated ops topics and counters', async () => {
    const now = new Date('2026-03-24T09:00:00.000Z').toISOString();
    const state = {
        paymentOrders: [
            {
                id: 'order-1',
                provider: 'hupijiao',
                provider_order_no: 'HJ_SUMMARY_1',
                package_name: '积分充值 1000 点',
                paid_amount: 20,
                expected_amount: 20,
                points_amount: 1000,
                status: 'redeemed',
                user_id: 'user-1',
                created_at: now,
                paid_at: now,
                claimed_at: now,
                site: 'cn',
                last_error: null,
                sign_verified: true,
                amount_verified: true,
                provider_metadata: {}
            }
        ],
        paymentEvents: [
            {
                id: 'event-1',
                payment_order_id: 'order-1',
                provider: 'hupijiao',
                provider_order_no: 'HJ_SUMMARY_1',
                event_type: 'admin_refund',
                signature_valid: true,
                amount_valid: null,
                processing_result: 'admin_refund_failed',
                error_message: 'gateway busy',
                response_status: 502,
                created_at: '2026-03-24T09:10:00.000Z'
            },
            {
                id: 'event-2',
                payment_order_id: 'order-1',
                provider: 'hupijiao',
                provider_order_no: 'HJ_SUMMARY_1',
                event_type: 'admin_refund',
                signature_valid: true,
                amount_valid: null,
                processing_result: 'admin_refund_reclaim_failed',
                error_message: 'insufficient balance',
                response_status: 409,
                created_at: '2026-03-24T09:20:00.000Z'
            },
            {
                id: 'event-3',
                payment_order_id: 'order-1',
                provider: 'hupijiao',
                provider_order_no: 'HJ_SUMMARY_1',
                event_type: 'admin_refund',
                signature_valid: true,
                amount_valid: null,
                processing_result: 'admin_refund_compensation_failed',
                error_message: 'points compensation failed',
                response_status: 500,
                created_at: '2026-03-24T09:30:00.000Z'
            }
        ]
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'ops',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.anomaly_summary.refund_failures, 1);
        assert.equal(payload.anomaly_summary.refund_reclaim_failures, 1);
        assert.equal(payload.anomaly_summary.refund_compensation_failures, 1);

        const topicMap = new Map((payload.exception_topics || []).map((topic) => [topic.key, topic]));
        assert.equal(topicMap.get('refund_failures')?.count, 1);
        assert.equal(topicMap.get('refund_reclaim_failures')?.count, 1);
        assert.equal(topicMap.get('refund_compensation_failures')?.count, 1);

        const topicItems = payload.exception_topic_items || [];
        assert.equal(topicItems.some((item) => item.topic_key === 'refund_failures' && item.title === '退款失败已补回'), true);
        assert.equal(topicItems.some((item) => item.topic_key === 'refund_reclaim_failures' && item.title === '退款积分扣回失败'), true);
        assert.equal(topicItems.some((item) => item.topic_key === 'refund_compensation_failures' && item.title === '退款积分回滚失败'), true);

        const recentAnomalies = payload.recent_anomalies || [];
        assert.equal(recentAnomalies.some((item) => item.title === '退款失败已补回'), true);
        assert.equal(recentAnomalies.some((item) => item.title === '退款积分扣回失败'), true);
        assert.equal(recentAnomalies.some((item) => item.title === '退款积分回滚失败'), true);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'payments.summary.view');
    });
});

test('payments summary excludes archived exception topic items from card counts while keeping archived history visible', async () => {
    const state = {
        paymentEvents: [
            {
                id: 'event-dup-handled-old',
                provider: 'zpay',
                provider_order_no: 'ZP_DUP_HANDLED',
                event_type: 'webhook',
                processing_result: 'success',
                response_status: 200,
                created_at: '2026-03-24T09:00:00.000Z'
            },
            {
                id: 'event-dup-handled-latest',
                provider: 'zpay',
                provider_order_no: 'ZP_DUP_HANDLED',
                event_type: 'webhook',
                processing_result: 'success',
                response_status: 200,
                created_at: '2026-03-24T09:05:00.000Z'
            },
            {
                id: 'event-dup-archived-old',
                provider: 'zpay',
                provider_order_no: 'ZP_DUP_ARCHIVED',
                event_type: 'webhook',
                processing_result: 'success',
                response_status: 200,
                created_at: '2026-03-24T09:10:00.000Z'
            },
            {
                id: 'event-dup-archived-latest',
                provider: 'zpay',
                provider_order_no: 'ZP_DUP_ARCHIVED',
                event_type: 'webhook',
                processing_result: 'success',
                response_status: 200,
                created_at: '2026-03-24T09:15:00.000Z'
            }
        ],
        paymentAnomalyCases: [
            {
                id: 'case-handled',
                target_type: 'event',
                target_id: 'event-dup-handled-latest',
                status: 'handled',
                resolution: '已人工确认并标记处理完成。',
                last_action: 'mark_handled',
                last_action_at: '2026-03-24T09:20:00.000Z'
            },
            {
                id: 'case-archived',
                target_type: 'event',
                target_id: 'event-dup-archived-latest',
                status: 'archived',
                resolution: '该异常已归档，不再进入专题计数。',
                last_action: 'archive',
                last_action_at: '2026-03-24T09:25:00.000Z'
            }
        ]
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'ops',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        const topicMap = new Map((payload.exception_topics || []).map((topic) => [topic.key, topic]));
        assert.equal(topicMap.get('duplicate_webhook')?.count, 1);
        const topicItems = payload.exception_topic_items || [];
        const handledItem = topicItems.find((item) => item.provider_order_no === 'ZP_DUP_HANDLED');
        const archivedItem = topicItems.find((item) => item.provider_order_no === 'ZP_DUP_ARCHIVED');
        assert.equal(Boolean(handledItem), true);
        assert.equal(handledItem.ops_status, 'handled');
        assert.equal(handledItem.ops_available_actions.includes('reopen'), true);
        assert.equal(handledItem.ops_available_actions.includes('archive'), true);
        assert.equal(Boolean(archivedItem), true);
        assert.equal(archivedItem.ops_status, 'archived');
        assert.deepEqual(archivedItem.ops_available_actions, []);
    });
});

test('payments overview counts only unarchived duplicate callback topics when aggregate RPC is unavailable', async () => {
    const state = {
        paymentEvents: [
            {
                id: 'event-dup-open-old',
                provider: 'zpay',
                provider_order_no: 'ZP_DUP_OPEN',
                event_type: 'webhook',
                processing_result: 'received',
                response_status: 200,
                created_at: '2026-03-24T09:00:00.000Z'
            },
            {
                id: 'event-dup-open-latest',
                provider: 'zpay',
                provider_order_no: 'ZP_DUP_OPEN',
                event_type: 'webhook',
                processing_result: 'received',
                response_status: 200,
                created_at: '2026-03-24T09:05:00.000Z'
            },
            {
                id: 'event-dup-archived-old',
                provider: 'zpay',
                provider_order_no: 'ZP_DUP_ARCHIVED',
                event_type: 'webhook',
                processing_result: 'received',
                response_status: 200,
                created_at: '2026-03-24T09:10:00.000Z'
            },
            {
                id: 'event-dup-archived-latest',
                provider: 'zpay',
                provider_order_no: 'ZP_DUP_ARCHIVED',
                event_type: 'webhook',
                processing_result: 'received',
                response_status: 200,
                created_at: '2026-03-24T09:15:00.000Z'
            }
        ],
        paymentAnomalyCases: [
            {
                id: 'case-archived-duplicate',
                target_type: 'event',
                target_id: 'event-dup-archived-latest',
                status: 'archived',
                resolution: '该重复回调已归档，不再进入总览计数。',
                last_action: 'archive',
                last_action_at: '2026-03-24T09:25:00.000Z'
            }
        ]
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'overview',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.anomaly_summary.duplicate_webhook_orders, 1);
        assert.equal(payload.anomaly_summary.session_anomalies, 0);
        assert.equal(
            state.tableAccesses.some((entry) => entry.table === 'payment_anomaly_cases'),
            true
        );
    });
});

test('payments summary keeps older unarchived refund failures visible even when newer archived history exceeds the topic preview cap', async () => {
    const paymentEvents = [];
    const paymentAnomalyCases = [];

    for (let index = 0; index < 12; index += 1) {
        const suffix = String(index + 1).padStart(2, '0');
        paymentEvents.push({
            id: `event-refund-archived-${suffix}`,
            provider: 'zpay',
            provider_order_no: `ZP_REFUND_ARCHIVED_${suffix}`,
            event_type: 'admin_refund',
            processing_result: 'admin_refund_failed',
            response_status: 500,
            created_at: `2026-03-24T10:${suffix}:00.000Z`
        });
        paymentAnomalyCases.push({
            id: `case-refund-archived-${suffix}`,
            target_type: 'event',
            target_id: `event-refund-archived-${suffix}`,
            status: 'archived',
            resolution: '该异常已归档，不再进入专题计数。',
            last_action: 'archive',
            last_action_at: `2026-03-24T11:${suffix}:00.000Z`
        });
    }

    for (let index = 0; index < 4; index += 1) {
        const suffix = String(index + 1).padStart(2, '0');
        paymentEvents.push({
            id: `event-refund-open-${suffix}`,
            provider: 'zpay',
            provider_order_no: `ZP_REFUND_OPEN_${suffix}`,
            event_type: 'admin_refund',
            processing_result: 'admin_refund_failed',
            response_status: 500,
            created_at: `2026-03-24T09:${suffix}:00.000Z`
        });
    }

    const state = {
        paymentEvents,
        paymentAnomalyCases
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'ops',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        const topicMap = new Map((payload.exception_topics || []).map((topic) => [topic.key, topic]));
        assert.equal(topicMap.get('refund_failures')?.count, 4);
        const refundItems = (payload.exception_topic_items || []).filter((item) => item.topic_key === 'refund_failures');
        assert.equal(refundItems.filter((item) => item.ops_status === 'archived').length, 12);
        assert.equal(refundItems.filter((item) => item.ops_status === 'open').length, 4);
        assert.equal(refundItems.some((item) => item.provider_order_no === 'ZP_REFUND_OPEN_01'), true);
        assert.equal(refundItems.some((item) => item.provider_order_no === 'ZP_REFUND_OPEN_04'), true);
    });
});

test('payments summary exposes payment intent failures as dedicated exception topics', async () => {
    const state = {
        checkoutSessions: [
            {
                id: 'session-failed-1',
                session_key: 'PCS_ZPAY_FAILED_1',
                provider: 'zpay',
                site: 'cn',
                status: 'failed',
                error_message: 'TypeError: fetch failed',
                payment_order_id: null,
                created_at: '2026-03-24T10:00:00.000Z'
            }
        ]
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'ops',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        const topicMap = new Map((payload.exception_topics || []).map((topic) => [topic.key, topic]));
        assert.equal(topicMap.get('payment_intent_failed')?.count, 1);
        const intentTopicItem = (payload.exception_topic_items || []).find((item) => item.topic_key === 'payment_intent_failed');
        assert.equal(Boolean(intentTopicItem), true);
        assert.equal(intentTopicItem.title, '支付意图失败');
        assert.match(intentTopicItem.message, /fetch failed/);
        assert.equal((payload.recent_anomalies || []).some((item) => item.title === '支付意图失败'), true);
    });
});

test('payments overview summary exposes refund alerts for admin-studio visibility panel', async () => {
    const now = new Date('2026-03-24T10:00:00.000Z').toISOString();
    const state = {
        paymentOrders: [
            {
                id: 'order-2',
                provider: 'hupijiao',
                provider_order_no: 'HJ_OVERVIEW_1',
                package_name: '积分充值 500 点',
                paid_amount: 10,
                expected_amount: 10,
                points_amount: 500,
                status: 'redeemed',
                user_id: 'user-2',
                created_at: now,
                paid_at: now,
                claimed_at: now,
                site: 'cn',
                last_error: null,
                sign_verified: true,
                amount_verified: true,
                provider_metadata: {}
            }
        ],
        paymentEvents: [
            {
                id: 'event-overview-1',
                payment_order_id: 'order-2',
                provider: 'hupijiao',
                provider_order_no: 'HJ_OVERVIEW_1',
                event_type: 'admin_refund',
                signature_valid: true,
                amount_valid: null,
                processing_result: 'admin_refund_compensation_failed',
                error_message: 'points compensation failed',
                response_status: 500,
                created_at: '2026-03-24T10:10:00.000Z'
            }
        ],
        paymentAnomalyCases: [
            {
                id: 'case-overview-1',
                target_type: 'event',
                target_id: 'event-overview-1',
                status: 'handled',
                note: 'ops handled',
                resolution: '已人工补回积分',
                last_action: 'mark_handled',
                last_action_at: '2026-03-24T10:20:00.000Z'
            }
        ]
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'overview',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(Array.isArray(payload.refund_alert_topics), true);
        assert.equal(Array.isArray(payload.refund_alert_items), true);
        assert.equal(payload.anomaly_summary.refund_compensation_failures, 0);
        assert.equal(payload.refund_alert_topics.length, 0);
        assert.equal(payload.refund_alert_items.length, 0);
        assert.equal((payload.exception_topics || []).length, 0);
    });
});

test('payments overview view can use aggregated rpc payload instead of scanning overview tables', async () => {
    const state = {
        overviewSummaryRpc: {
            overview: {
                total_orders: 20,
                paid_orders: 16,
                redeemed_orders: 9,
                claimed_orders: 15,
                review_orders: 2,
                failed_orders: 1,
                total_amount: 320,
                total_points: 16000,
                paid_rate: 80,
                claim_rate: 93.75
            },
            session_summary: {
                total_sessions: 18,
                matched_sessions: 16,
                open_sessions: 2,
                stale_sessions: 1,
                failed_sessions: 1,
                completed_unlinked_sessions: 0,
                webhook_linked_sessions: 10,
                fallback_linked_sessions: 4,
                direct_linked_sessions: 2,
                unmatched_orders: 1,
                eligible_orders: 17,
                matched_orders: 16,
                match_rate: 88.89,
                order_match_rate: 94.12,
                anomaly_count: 2
            },
            query_summary: {
                total_attempts: 9,
                success_attempts: 7,
                failed_attempts: 2,
                success_rate: 77.78,
                outcome_breakdown: [
                    {
                        outcome_code: 'query_exception',
                        label: '查码接口异常',
                        severity: 'critical',
                        count: 2
                    }
                ]
            },
            anomaly_summary: {
                review_orders: 2,
                failed_orders: 1,
                unclaimed_paid_orders: 1,
                recent_event_anomalies: 3,
                duplicate_webhook_orders: 1,
                refund_failures: 1,
                refund_reclaim_failures: 0,
                refund_compensation_failures: 0,
                query_failures: 2,
                stale_checkout_sessions: 1,
                failed_checkout_sessions: 1,
                completed_unlinked_sessions: 0,
                unmatched_session_orders: 1,
                webhook_linked_sessions: 10,
                fallback_linked_sessions: 4,
                session_anomalies: 2,
                open_cases: 1
            },
            provider_stats: [
                {
                    provider: 'hupijiao',
                    total_orders: 20,
                    paid_orders: 16,
                    claimed_orders: 15,
                    review_orders: 2,
                    failed_orders: 1,
                    total_amount: 320,
                    total_points: 16000,
                    eligible_orders: 17,
                    matched_orders: 16,
                    unmatched_orders: 1,
                    session_total: 18,
                    session_matched: 16,
                    session_stale: 1,
                    session_failed: 1,
                    session_completed_unlinked: 0,
                    webhook_links: 10,
                    fallback_links: 4,
                    direct_links: 2,
                    webhook_total: 12,
                    webhook_success: 9,
                    webhook_failed: 3,
                    webhook_4xx: 1,
                    webhook_5xx: 1,
                    query_total: 9,
                    query_success: 7,
                    query_failed: 2,
                    query_4xx: 1,
                    query_5xx: 1,
                    paid_rate: 80,
                    claim_rate: 93.75,
                    session_match_rate: 88.89,
                    order_match_rate: 94.12,
                    webhook_success_rate: 75,
                    query_success_rate: 77.78,
                    auto_link_rate: 62.5,
                    fallback_link_rate: 25
                }
            ],
            trend_24h: [
                {
                    bucket: '2026-03-24T09:00:00.000Z',
                    label: '03-24 09:00',
                    total_events: 4,
                    anomaly_events: 1,
                    failed_events: 1
                }
            ],
            refund_alert_topics: [
                {
                    key: 'refund_failures',
                    label: '退款失败',
                    severity: 'warning',
                    description: '网关退款失败，但系统已自动补回积分，仍需复核通道响应和重复提交风险。',
                    count: 1
                }
            ],
            refund_alert_items: [
                {
                    type: 'event',
                    id: 'event-rpc-1',
                    provider: 'hupijiao',
                    provider_order_no: 'HJ_RPC_1',
                    status: 'admin_refund_failed',
                    severity: 'warning',
                    title: '退款失败已补回',
                    message: 'gateway busy',
                    created_at: '2026-03-24T10:10:00.000Z',
                    topic_key: 'refund_failures',
                    topic_label: '退款失败'
                }
            ]
        },
        paymentAnomalyCases: [
            {
                id: 'case-rpc-1',
                target_type: 'event',
                target_id: 'event-rpc-1',
                status: 'handled',
                note: 'rpc handled',
                resolution: '已人工确认',
                last_action: 'mark_handled',
                last_action_at: '2026-03-24T10:15:00.000Z'
            }
        ]
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'overview',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.overview.total_orders, 20);
        assert.equal(payload.query_summary.failed_attempts, 2);
        assert.equal(payload.session_summary.total_sessions, 18);
        assert.equal(payload.provider_stats[0].provider, 'hupijiao');
        assert.equal(payload.anomaly_summary.refund_failures, 0);
        assert.equal(payload.refund_alert_topics.length, 0);
        assert.equal(payload.refund_alert_items.length, 0);
        assert.equal(Array.isArray(payload.trend_24h), true);
        assert.equal(state.rpcCalls.some((call) => call.name === 'fn_admin_get_payment_overview_summary'), true);
        assert.equal(
            state.tableAccesses.some((entry) => ['payment_orders', 'payment_events', 'payment_query_attempts', 'payment_checkout_sessions'].includes(entry.table)),
            false
        );
    });
});

test('payments finance view can use aggregated rpc payload instead of scanning finance tables', async () => {
    const state = {
        financeSummaryRpc: {
            overview: {
                total_orders: 12,
                paid_orders: 9,
                redeemed_orders: 4,
                claimed_orders: 8,
                review_orders: 2,
                failed_orders: 1,
                total_amount: 188,
                total_points: 9400,
                paid_rate: 75,
                claim_rate: 88.89
            },
            anomaly_summary: {
                review_orders: 2,
                failed_orders: 1,
                unclaimed_paid_orders: 1,
                recent_event_anomalies: 0,
                duplicate_webhook_orders: 0,
                refund_failures: 0,
                refund_reclaim_failures: 0,
                refund_compensation_failures: 0,
                query_failures: 0,
                stale_checkout_sessions: 0,
                failed_checkout_sessions: 0,
                completed_unlinked_sessions: 0,
                unmatched_session_orders: 0,
                webhook_linked_sessions: 0,
                fallback_linked_sessions: 0,
                session_anomalies: 0,
                open_cases: 0,
                handled_cases: 0,
                ignored_cases: 0,
                retry_requested_cases: 0
            },
            provider_stats: [
                {
                    provider: 'hupijiao',
                    total_orders: 12,
                    paid_orders: 9,
                    claimed_orders: 8,
                    review_orders: 2,
                    failed_orders: 1,
                    total_amount: 188,
                    total_points: 9400,
                    paid_rate: 75,
                    claim_rate: 88.89
                }
            ],
            sitewide_summary: {
                recharge_amount: 188,
                recharge_points: 9400,
                recharge_order_count: 9,
                shop_points_spent: 2300,
                shop_order_count: 6,
                refunded_shop_points: 200,
                refunded_shop_order_count: 1,
                points_inflow: 9500,
                points_outflow: 2600,
                net_points_flow: 6900,
                circulating_points: 32000,
                paid_balance: 21000,
                bonus_balance: 11000,
                balance_account_count: 18,
                mock_recharge_order_count: 2,
                mock_recharge_points: 1200
            },
            points_breakdown: [
                {
                    key: 'recharge',
                    label: '充值入账',
                    inflow: 9400,
                    outflow: 0,
                    net: 9400
                },
                {
                    key: 'shop_purchase',
                    label: '商城消费',
                    inflow: 0,
                    outflow: 2300,
                    net: -2300
                }
            ],
            points_breakdown_trend: [
                {
                    key: 'recharge',
                    label: '充值入账',
                    points: [
                        { label: '03-22', value: 2400 },
                        { label: '03-23', value: 3000 },
                        { label: '03-24', value: 4000 }
                    ]
                },
                {
                    key: 'shop_purchase',
                    label: '商城消费',
                    points: [
                        { label: '03-22', value: -600 },
                        { label: '03-23', value: -800 },
                        { label: '03-24', value: -900 }
                    ]
                }
            ],
            business_breakdown_trend: [
                {
                    key: 'recharge',
                    tone: 'recharge',
                    metric_kind: 'currency',
                    points: [
                        { label: '03-22', value: 36 },
                        { label: '03-23', value: 48 },
                        { label: '03-24', value: 104 }
                    ]
                },
                {
                    key: 'shop',
                    tone: 'shop',
                    metric_kind: 'points',
                    points: [
                        { label: '03-22', value: 400 },
                        { label: '03-23', value: 820 },
                        { label: '03-24', value: 1080 }
                    ]
                },
                {
                    key: 'mock',
                    tone: 'mock',
                    metric_kind: 'count',
                    points: [
                        { label: '03-22', value: 0 },
                        { label: '03-23', value: 1 },
                        { label: '03-24', value: 1 }
                    ]
                },
                {
                    key: 'balance',
                    tone: 'balance',
                    metric_kind: 'points',
                    points: [
                        { label: '03-22', value: 30120 },
                        { label: '03-23', value: 31220 },
                        { label: '03-24', value: 32000 }
                    ]
                }
            ]
        }
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'finance',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.overview.total_orders, 12);
        assert.equal(payload.sitewide_summary.recharge_amount, 188);
        assert.equal(payload.points_breakdown.length, 2);
        assert.equal(payload.provider_stats[0].provider, 'hupijiao');
        assert.equal(payload.points_breakdown[0].trend.length, 3);
        assert.equal(payload.points_breakdown[1].trend[2].value, -900);
        assert.equal(payload.business_breakdown[2].metric, '2 笔');
        assert.equal(payload.business_breakdown[0].trend.length, 3);
        assert.equal(payload.business_breakdown[3].trend[2].value, 32000);
        assert.equal(state.rpcCalls.some((call) => call.name === 'fn_admin_get_payment_finance_summary'), true);
        assert.equal(
            state.tableAccesses.some((entry) => ['payment_orders', 'shop_orders', 'points_ledger', 'points_balance'].includes(entry.table)),
            false,
            JSON.stringify(state.tableAccesses)
        );
    });
});

test('payments finance view falls back to finance tables for business trends when aggregate payload has no trend series', async () => {
    const state = {
        financeSummaryRpc: {
            overview: {
                total_orders: 2,
                paid_orders: 2,
                redeemed_orders: 0,
                claimed_orders: 2,
                review_orders: 0,
                failed_orders: 0,
                total_amount: 30,
                total_points: 300,
                paid_rate: 100,
                claim_rate: 100
            },
            anomaly_summary: {
                review_orders: 0,
                failed_orders: 0,
                unclaimed_paid_orders: 0,
                recent_event_anomalies: 0,
                duplicate_webhook_orders: 0,
                refund_failures: 0,
                refund_reclaim_failures: 0,
                refund_compensation_failures: 0,
                query_failures: 0,
                stale_checkout_sessions: 0,
                failed_checkout_sessions: 0,
                completed_unlinked_sessions: 0,
                unmatched_session_orders: 0,
                webhook_linked_sessions: 0,
                fallback_linked_sessions: 0,
                session_anomalies: 0,
                open_cases: 0,
                handled_cases: 0,
                ignored_cases: 0,
                retry_requested_cases: 0
            },
            provider_stats: [
                {
                    provider: 'hupijiao',
                    total_orders: 1,
                    paid_orders: 1,
                    claimed_orders: 1,
                    review_orders: 0,
                    failed_orders: 0,
                    total_amount: 20,
                    total_points: 200,
                    paid_rate: 100,
                    claim_rate: 100
                }
            ],
            sitewide_summary: {
                recharge_amount: 30,
                recharge_points: 300,
                recharge_order_count: 2,
                shop_points_spent: 30,
                shop_order_count: 1,
                refunded_shop_points: 15,
                refunded_shop_order_count: 1,
                points_inflow: 150,
                points_outflow: 30,
                net_points_flow: 120,
                circulating_points: 1000,
                paid_balance: 700,
                bonus_balance: 300,
                balance_account_count: 2,
                mock_recharge_order_count: 1,
                mock_recharge_points: 100
            },
            points_breakdown: [
                {
                    key: 'recharge',
                    label: '充值入账',
                    inflow: 150,
                    outflow: 0,
                    net: 150
                }
            ]
        },
        paymentOrders: [
            {
                id: 'order-f-trend-1',
                provider: 'hupijiao',
                provider_order_no: 'HJ_TREND_1',
                paid_amount: 20,
                expected_amount: 20,
                points_amount: 200,
                status: 'paid',
                user_id: 'user-1',
                created_at: '2026-03-19T08:00:00.000Z',
                paid_at: '2026-03-19T08:00:00.000Z',
                claimed_at: '2026-03-19T08:05:00.000Z',
                checkout_session_id: null,
                site: 'cn',
                provider_metadata: {}
            },
            {
                id: 'order-f-trend-2',
                provider: 'mock',
                provider_order_no: 'MOCK_TREND_1',
                paid_amount: 10,
                expected_amount: 10,
                points_amount: 100,
                status: 'paid',
                user_id: 'user-2',
                created_at: '2026-03-20T09:00:00.000Z',
                paid_at: '2026-03-20T09:00:00.000Z',
                claimed_at: '2026-03-20T09:10:00.000Z',
                checkout_session_id: null,
                site: 'cn',
                provider_metadata: {}
            }
        ],
        shopOrders: [
            {
                id: 'shop-f-trend-1',
                user_id: 'user-1',
                price_paid: 30,
                snapshot_product_name: '权益卡',
                refund_status: 'none',
                created_at: '2026-03-20T10:00:00.000Z',
                site: 'cn'
            },
            {
                id: 'shop-f-trend-2',
                user_id: 'user-1',
                price_paid: 15,
                snapshot_product_name: '权益卡退款',
                refund_status: 'refunded',
                created_at: '2026-03-21T11:00:00.000Z',
                site: 'cn'
            }
        ],
        pointsLedger: [
            {
                id: 'ledger-f-trend-1',
                user_id: 'user-1',
                amount: 100,
                reason: '充值入账',
                reference_id: 'order-f-trend-1',
                created_at: '2026-03-19T08:00:00.000Z',
                site: 'cn'
            },
            {
                id: 'ledger-f-trend-2',
                user_id: 'user-1',
                amount: -30,
                reason: '商城购买',
                reference_id: 'shop-f-trend-1',
                created_at: '2026-03-20T10:00:00.000Z',
                site: 'cn'
            },
            {
                id: 'ledger-f-trend-3',
                user_id: 'user-2',
                amount: 50,
                reason: '奖励入账',
                reference_id: 'reward-f-trend-1',
                created_at: '2026-03-21T12:00:00.000Z',
                site: 'cn'
            },
            {
                id: 'ledger-f-trend-4',
                user_id: 'user-1',
                amount: 80,
                reason: '充值入账',
                reference_id: 'order-future',
                created_at: '2026-03-22T09:00:00.000Z',
                site: 'cn'
            }
        ],
        pointsBalance: [
            {
                user_id: 'user-1',
                paid_balance: 700,
                bonus_balance: 300,
                total_balance: 1000,
                site: 'cn'
            }
        ]
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'finance',
                startDate: '2026-03-19T00:00:00.000Z',
                endDate: '2026-03-21T23:59:59.999Z'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.deepEqual(
            payload.business_breakdown[0].trend.map((point) => point.value),
            [20, 10, 0]
        );
        assert.deepEqual(
            payload.business_breakdown[2].trend.map((point) => point.value),
            [0, 1, 0]
        );
        assert.deepEqual(
            payload.business_breakdown[3].trend.map((point) => point.value),
            [900, 870, 920]
        );
        const pointsTrendByKey = new Map(payload.points_breakdown.map((item) => [item.key, item.trend.map((point) => point.value)]));
        assert.deepEqual(pointsTrendByKey.get('recharge'), [100, 0, 0]);
        assert.deepEqual(pointsTrendByKey.get('shop_purchase'), [0, -30, 0]);
        assert.deepEqual(pointsTrendByKey.get('rewards'), [0, 0, 50]);
        assert.equal(
            state.tableAccesses.some((entry) => ['payment_orders', 'shop_orders', 'points_ledger', 'points_balance'].includes(entry.table)),
            true
        );
    });
});

test('payments overview core scope skips heavy event and ops scans while returning first-paint metrics', async () => {
    const now = new Date('2026-03-24T10:00:00.000Z').toISOString();
    const state = {
        paymentOrders: [
            {
                id: 'order-core-1',
                provider: 'hupijiao',
                provider_order_no: 'HJ_CORE_1',
                package_name: '积分充值 1000 点',
                paid_amount: 20,
                expected_amount: 20,
                points_amount: 1000,
                status: 'paid',
                user_id: 'user-core-1',
                created_at: now,
                paid_at: now,
                claimed_at: now,
                site: 'cn',
                last_error: null,
                sign_verified: true,
                amount_verified: true,
                provider_metadata: {
                    checkout_session_id: 'session-core-1',
                    checkout_session_status: 'completed',
                    checkout_session_linked_by: 'webhook'
                }
            }
        ],
        checkoutSessions: [
            {
                id: 'session-core-1',
                session_key: 'checkout_core_1',
                provider: 'hupijiao',
                user_id: 'user-core-1',
                site: 'cn',
                package_id: 'pkg-1',
                package_name: '积分充值 1000 点',
                requested_points: 1000,
                bonus_points: 0,
                granted_points: 1000,
                expected_amount: 20,
                status: 'completed',
                checkout_url: 'https://example.com/pay',
                query_mode: 'manual',
                payment_order_id: 'order-core-1',
                provider_metadata: {
                    provider_order_no: 'HJ_CORE_1',
                    linked_by: 'webhook'
                },
                error_message: null,
                expires_at: null,
                completed_at: now,
                created_at: now,
                updated_at: now
            }
        ],
        paymentQueryAttempts: [
            {
                id: 'query-core-1',
                provider: 'hupijiao',
                site: 'cn',
                order_no: 'HJ_CORE_1',
                user_id: 'user-core-1',
                payment_order_id: 'order-core-1',
                checkout_session_id: 'session-core-1',
                success: false,
                response_status: 500,
                outcome_code: 'query_exception',
                message: 'network timeout',
                created_at: now
            }
        ],
        paymentEvents: [
            {
                id: 'event-core-1',
                payment_order_id: 'order-core-1',
                provider: 'hupijiao',
                provider_order_no: 'HJ_CORE_1',
                event_type: 'admin_refund',
                signature_valid: true,
                amount_valid: null,
                processing_result: 'admin_refund_compensation_failed',
                error_message: 'points compensation failed',
                response_status: 500,
                created_at: now
            }
        ],
        opsAlertJobs: [
            {
                id: 'ops-core-1',
                alert_type: 'payment_refund_ops',
                severity: 'critical',
                title: '支付退款积分回滚失败',
                content: '站点：CN\n订单号：HJ_CORE_1',
                payload: {
                    provider: 'hupijiao',
                    provider_order_no: 'HJ_CORE_1',
                    site: 'cn'
                },
                channels: ['telegram'],
                remaining_channels: ['telegram'],
                status: 'dead_letter',
                attempt_count: 6,
                max_attempts: 6,
                next_retry_at: null,
                delivered_at: null,
                last_error: 'telegram timeout',
                created_at: now,
                updated_at: now
            }
        ]
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'overview',
                days: '30',
                scope: 'core'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.overview_scope, 'core');
        assert.equal(payload.overview.total_orders, 1);
        assert.equal(payload.session_summary.total_sessions, 1);
        assert.equal(payload.query_summary.failed_attempts, 1);
        assert.equal(payload.anomaly_summary.query_failures, 1);
        assert.equal(payload.provider_stats, null);
        assert.equal(payload.refund_alert_topics, null);
        assert.equal(payload.refund_alert_items, null);
        assert.equal(payload.ops_alert_summary, null);
        assert.equal(payload.ops_alert_items, null);
        assert.equal(state.rpcCalls.some((call) => call.name === 'fn_admin_get_payment_overview_summary'), false);
        assert.equal(
            state.tableAccesses.some((entry) => ['payment_events', 'ops_alert_jobs', 'payment_anomaly_cases'].includes(entry.table)),
            false
        );
        assert.equal(
            state.tableAccesses.some((entry) => ['payment_orders', 'payment_query_attempts', 'payment_checkout_sessions'].includes(entry.table)),
            true
        );
        assert.equal(state.auditLogs.length, 0);
    });
});

test('payments overview secondary scope returns trend and refund panels without reading ops alerts', async () => {
    const state = {
        overviewSummaryRpc: {
            overview: {
                total_orders: 20,
                paid_orders: 16,
                redeemed_orders: 9,
                claimed_orders: 15,
                review_orders: 2,
                failed_orders: 1,
                total_amount: 320,
                total_points: 16000,
                paid_rate: 80,
                claim_rate: 93.75
            },
            session_summary: {
                total_sessions: 18,
                matched_sessions: 16,
                open_sessions: 2,
                stale_sessions: 1,
                failed_sessions: 1,
                completed_unlinked_sessions: 0,
                webhook_linked_sessions: 10,
                fallback_linked_sessions: 4,
                direct_linked_sessions: 2,
                unmatched_orders: 1,
                eligible_orders: 17,
                matched_orders: 16,
                match_rate: 88.89,
                order_match_rate: 94.12,
                anomaly_count: 2
            },
            query_summary: {
                total_attempts: 9,
                success_attempts: 7,
                failed_attempts: 2,
                success_rate: 77.78,
                outcome_breakdown: [
                    {
                        outcome_code: 'query_exception',
                        label: '查码接口异常',
                        severity: 'critical',
                        count: 2
                    }
                ]
            },
            anomaly_summary: {
                review_orders: 2,
                failed_orders: 1,
                unclaimed_paid_orders: 1,
                recent_event_anomalies: 3,
                duplicate_webhook_orders: 1,
                refund_failures: 1,
                refund_reclaim_failures: 0,
                refund_compensation_failures: 0,
                query_failures: 2,
                stale_checkout_sessions: 1,
                failed_checkout_sessions: 1,
                completed_unlinked_sessions: 0,
                unmatched_session_orders: 1,
                webhook_linked_sessions: 10,
                fallback_linked_sessions: 4,
                session_anomalies: 2,
                open_cases: 1
            },
            provider_stats: [
                {
                    provider: 'hupijiao',
                    total_orders: 20,
                    paid_orders: 16,
                    claimed_orders: 15,
                    review_orders: 2,
                    failed_orders: 1,
                    total_amount: 320,
                    total_points: 16000,
                    eligible_orders: 17,
                    matched_orders: 16,
                    unmatched_orders: 1,
                    session_total: 18,
                    session_matched: 16,
                    session_stale: 1,
                    session_failed: 1,
                    session_completed_unlinked: 0,
                    webhook_links: 10,
                    fallback_links: 4,
                    direct_links: 2,
                    webhook_total: 12,
                    webhook_success: 9,
                    webhook_failed: 3,
                    webhook_4xx: 1,
                    webhook_5xx: 1,
                    query_total: 9,
                    query_success: 7,
                    query_failed: 2,
                    query_4xx: 1,
                    query_5xx: 1,
                    paid_rate: 80,
                    claim_rate: 93.75,
                    session_match_rate: 88.89,
                    order_match_rate: 94.12,
                    webhook_success_rate: 75,
                    query_success_rate: 77.78,
                    auto_link_rate: 62.5,
                    fallback_link_rate: 25
                }
            ],
            trend_24h: [
                {
                    bucket: '2026-03-24T09:00:00.000Z',
                    label: '03-24 09:00',
                    total_events: 4,
                    anomaly_events: 1,
                    failed_events: 1
                }
            ],
            refund_alert_topics: [
                {
                    key: 'refund_failures',
                    label: '退款失败',
                    severity: 'warning',
                    description: '网关退款失败，但系统已自动补回积分，仍需复核通道响应和重复提交风险。',
                    count: 1
                }
            ],
            refund_alert_items: [
                {
                    type: 'event',
                    id: 'event-secondary-1',
                    provider: 'hupijiao',
                    provider_order_no: 'HJ_SECONDARY_1',
                    status: 'admin_refund_failed',
                    severity: 'warning',
                    title: '退款失败已补回',
                    message: 'gateway busy',
                    created_at: '2026-03-24T10:10:00.000Z',
                    topic_key: 'refund_failures',
                    topic_label: '退款失败'
                }
            ]
        },
        paymentAnomalyCases: [
            {
                id: 'case-secondary-1',
                target_type: 'event',
                target_id: 'event-secondary-1',
                status: 'handled',
                note: 'secondary handled',
                resolution: '已人工确认',
                last_action: 'mark_handled',
                last_action_at: '2026-03-24T10:15:00.000Z'
            }
        ],
        opsAlertJobs: [
            {
                id: 'ops-secondary-1',
                alert_type: 'payment_refund_ops',
                severity: 'critical',
                title: 'should not be queried',
                content: 'noop',
                payload: {},
                channels: [],
                remaining_channels: [],
                status: 'dead_letter',
                attempt_count: 1,
                max_attempts: 1,
                next_retry_at: null,
                delivered_at: null,
                last_error: 'noop',
                created_at: '2026-03-24T10:00:00.000Z',
                updated_at: '2026-03-24T10:00:00.000Z'
            }
        ]
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'overview',
                days: '30',
                scope: 'secondary'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.overview_scope, 'secondary');
        assert.equal(Array.isArray(payload.provider_stats), true);
        assert.equal(Array.isArray(payload.trend_24h), true);
        assert.equal(payload.anomaly_summary.refund_failures, 0);
        assert.equal(payload.refund_alert_topics.length, 0);
        assert.equal(payload.refund_alert_items.length, 0);
        assert.equal(payload.ops_alert_summary, undefined);
        assert.equal(payload.ops_alert_items, undefined);
        assert.equal(state.rpcCalls.some((call) => call.name === 'fn_admin_get_payment_overview_summary'), true);
        assert.equal(state.tableAccesses.some((entry) => entry.table === 'ops_alert_jobs'), false);
        assert.equal(state.auditLogs.length, 0);
    });
});

test('payments overview ops scope only reads ops alert health', async () => {
    const state = {
        opsAlertJobs: [
            {
                id: 'ops-scope-1',
                alert_type: 'payment_refund_ops',
                severity: 'critical',
                title: '支付退款积分回滚失败',
                content: '站点：CN\n订单号：HJ_OPS_1',
                payload: {
                    provider: 'hupijiao',
                    provider_order_no: 'HJ_OPS_1',
                    site: 'cn'
                },
                channels: ['telegram'],
                remaining_channels: ['telegram'],
                status: 'dead_letter',
                attempt_count: 6,
                max_attempts: 6,
                next_retry_at: null,
                delivered_at: null,
                last_error: 'telegram timeout',
                created_at: '2026-03-24T11:00:00.000Z',
                updated_at: '2026-03-24T11:10:00.000Z'
            }
        ]
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'overview',
                days: '30',
                scope: 'ops'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.overview_scope, 'ops');
        assert.equal(payload.ops_alert_summary.dead_letter, 1);
        assert.equal(payload.ops_alert_items.some((item) => item.provider_order_no === 'HJ_OPS_1'), true);
        assert.equal(payload.provider_stats, undefined);
        assert.equal(payload.trend_24h, undefined);
        assert.equal(payload.refund_alert_items, undefined);
        assert.equal(state.rpcCalls.some((call) => call.name === 'fn_admin_get_payment_overview_summary'), false);
        assert.equal(
            state.tableAccesses.some((entry) => ['payment_orders', 'payment_events', 'payment_query_attempts', 'payment_checkout_sessions', 'payment_anomaly_cases'].includes(entry.table)),
            false
        );
        assert.equal(state.tableAccesses.some((entry) => entry.table === 'ops_alert_jobs'), true);
        assert.equal(state.auditLogs.length, 0);
    });
});

test('payments summary exposes outbound ops alert queue health and actionable dead-letter jobs', async () => {
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
                created_at: '2026-03-24T11:00:00.000Z',
                updated_at: '2026-03-24T11:10:00.000Z'
            },
            {
                id: 'ops-job-2',
                alert_type: 'payment_refund_ops',
                severity: 'warning',
                title: '支付退款失败（已补回）',
                content: '站点：CN\n订单号：HJ_ALERT_2',
                payload: {
                    provider: 'hupijiao',
                    provider_order_no: 'HJ_ALERT_2',
                    site: 'cn'
                },
                channels: ['telegram'],
                remaining_channels: ['telegram'],
                status: 'retry',
                attempt_count: 2,
                max_attempts: 6,
                next_retry_at: '2026-03-24T12:00:00.000Z',
                delivered_at: null,
                last_error: 'feishu 502',
                created_at: '2026-03-24T11:30:00.000Z',
                updated_at: '2026-03-24T11:40:00.000Z'
            },
            {
                id: 'ops-job-3',
                alert_type: 'payment_refund_ops',
                severity: 'info',
                title: '支付回调异常已人工处理',
                content: '站点：CN\n订单号：HJ_ALERT_3',
                payload: {
                    provider: 'hupijiao',
                    provider_order_no: 'HJ_ALERT_3',
                    site: 'cn'
                },
                channels: ['telegram'],
                remaining_channels: [],
                status: 'handled',
                attempt_count: 1,
                max_attempts: 6,
                next_retry_at: null,
                delivered_at: null,
                last_error: '',
                created_at: '2026-03-24T11:20:00.000Z',
                updated_at: '2026-03-24T11:50:00.000Z'
            }
        ]
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'overview',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.ops_alert_summary.dead_letter, 1);
        assert.equal(payload.ops_alert_summary.retry, 1);
        assert.equal(payload.ops_alert_summary.handled, 1);
        assert.equal(payload.ops_alert_summary.actionable_count, 2);
        assert.equal(payload.ops_alert_items.some((item) => item.type === 'ops_alert_job' && item.queue_status === 'dead_letter'), true);
        assert.equal(payload.ops_alert_items.some((item) => item.type === 'ops_alert_job' && item.queue_status === 'handled'), true);
        assert.equal(payload.ops_alert_items.some((item) => item.type === 'ops_alert_job' && Array.isArray(item.ops_available_actions) && item.ops_available_actions.includes('request_retry')), true);
    });
});

test('payments summary exposes hupijiao query and reconcile actions on recent orders', async () => {
    const state = {
        paymentOrders: [
            {
                id: 'order-hj-summary-1',
                user_id: 'user-summary-1',
                provider: 'hupijiao',
                provider_order_no: 'HJ_SUMMARY_1',
                site: 'cn',
                package_id: 'pkg-1',
                package_name: '虎皮椒补单套餐',
                points_amount: 1000,
                expected_amount: 20,
                paid_amount: null,
                status: 'pending_review',
                created_at: '2026-04-16T09:00:00.000Z',
                updated_at: '2026-04-16T09:05:00.000Z',
                paid_at: null,
                claimed_at: null,
                verified_at: null,
                last_error: 'webhook_timeout',
                provider_metadata: {
                    gateway_open_order_id: 'OPEN_SUMMARY_1'
                }
            }
        ],
        profiles: [
            {
                id: 'user-summary-1',
                email: 'buyer-summary@example.com',
                username: 'buyer-summary'
            }
        ],
        paymentEvents: [],
        checkoutSessions: [],
        paymentQueryAttempts: [],
        paymentAnomalyCases: [],
        opsAlertJobs: []
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'ops',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();
        const order = Array.isArray(payload.recent_orders) ? payload.recent_orders[0] : null;

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.ok(order);
        assert.equal(order.provider_order_no, 'HJ_SUMMARY_1');
        assert.equal(order.user_email, 'buyer-summary@example.com');
        assert.deepEqual(order.order_available_actions, [
            'query_hupijiao_order',
            'reconcile_hupijiao_order',
            'refund_hupijiao'
        ]);
    });
});

test('payments summary exposes zpay query and reconcile actions on recent orders', async () => {
    const state = {
        paymentOrders: [
            {
                id: 'order-zp-summary-1',
                provider: 'zpay',
                provider_order_no: 'ZPAY_SUMMARY_1',
                user_id: 'user-zp-summary-1',
                site: 'cn',
                status: 'pending_review',
                expected_amount: 20,
                paid_amount: null,
                package_name: '易支付套餐',
                created_at: '2026-04-16T12:00:00.000Z',
                paid_at: null,
                claimed_at: null,
                verified_at: null,
                last_error: 'webhook_timeout',
                provider_metadata: {
                    trade_no: 'ZPAY_TRADE_SUMMARY_1'
                }
            }
        ],
        paymentEvents: [],
        checkoutSessions: [],
        paymentQueryAttempts: [],
        paymentAnomalyCases: [],
        opsAlertJobs: []
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'ops',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();
        const order = Array.isArray(payload.recent_orders) ? payload.recent_orders[0] : null;

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.ok(order);
        assert.equal(order.provider_order_no, 'ZPAY_SUMMARY_1');
        assert.deepEqual(order.order_available_actions, [
            'query_zpay_order',
            'reconcile_zpay_order',
            'refund_zpay'
        ]);
    });
});

test('payments summary exposes checkout-session backfill action on redeemed unmatched orders', async () => {
    const state = {
        paymentOrders: [
            {
                id: 'order-zp-session-backfill-1',
                provider: 'zpay',
                provider_order_no: 'ZPAY_SESSION_BACKFILL_1',
                user_id: 'user-zp-session-backfill-1',
                site: 'cn',
                status: 'redeemed',
                expected_amount: 0.01,
                paid_amount: 0.01,
                points_amount: 0.01,
                package_name: '易支付自定义充值',
                created_at: '2026-04-18T12:00:00.000Z',
                paid_at: '2026-04-18T12:01:00.000Z',
                claimed_at: '2026-04-18T12:02:00.000Z',
                verified_at: '2026-04-18T12:02:00.000Z',
                last_error: null,
                provider_metadata: {
                    trade_no: 'ZPAY_SESSION_BACKFILL_TRADE_1'
                }
            }
        ],
        paymentEvents: [],
        checkoutSessions: [],
        paymentQueryAttempts: [],
        paymentAnomalyCases: [],
        opsAlertJobs: []
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'ops',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();
        const order = Array.isArray(payload.recent_orders) ? payload.recent_orders[0] : null;

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.ok(order);
        assert.equal(order.checkout_session_required, true);
        assert.equal(order.checkout_session_matched, false);
        assert.deepEqual(order.order_available_actions, [
            'query_zpay_order',
            'reconcile_checkout_session',
            'refund_zpay'
        ]);
    });
});

test('payments summary treats order checkout_session_id column as matched even when metadata is stale', async () => {
    const state = {
        paymentOrders: [
            {
                id: 'order-zp-session-column-1',
                provider: 'zpay',
                provider_order_no: 'ZPAY_SESSION_COLUMN_1',
                checkout_session_id: 'session-column-1',
                user_id: 'user-zp-session-column-1',
                site: 'cn',
                status: 'redeemed',
                expected_amount: 0.01,
                paid_amount: 0.01,
                points_amount: 0.01,
                package_name: '易支付自定义充值',
                created_at: '2026-04-18T12:00:00.000Z',
                paid_at: '2026-04-18T12:01:00.000Z',
                claimed_at: '2026-04-18T12:02:00.000Z',
                verified_at: '2026-04-18T12:02:00.000Z',
                last_error: null,
                provider_metadata: {
                    trade_no: 'ZPAY_SESSION_COLUMN_TRADE_1'
                }
            }
        ],
        paymentEvents: [],
        checkoutSessions: [],
        paymentQueryAttempts: [],
        paymentAnomalyCases: [],
        opsAlertJobs: []
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'ops',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();
        const order = Array.isArray(payload.recent_orders) ? payload.recent_orders[0] : null;

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.ok(order);
        assert.equal(order.checkout_session_id, 'session-column-1');
        assert.equal(order.checkout_session_required, true);
        assert.equal(order.checkout_session_matched, true);
        assert.equal(order.checkout_session_status, 'completed');
        assert.deepEqual(order.order_available_actions, [
            'query_zpay_order',
            'refund_zpay'
        ]);
    });
});

test('payments summary hides refund actions for recent zpay orders that are already refunded upstream', async () => {
    const state = {
        paymentOrders: [
            {
                id: 'order-zp-summary-refunded-live-1',
                provider: 'zpay',
                provider_order_no: 'ZPAY_SUMMARY_REFUNDED_LIVE_1',
                user_id: 'user-zp-summary-refunded-live-1',
                site: 'cn',
                status: 'redeemed',
                expected_amount: 0.01,
                paid_amount: 0.01,
                points_amount: 0.01,
                package_name: '易支付退款测试单',
                created_at: '2026-04-18T12:00:00.000Z',
                paid_at: '2026-04-18T12:01:00.000Z',
                claimed_at: '2026-04-18T12:02:00.000Z',
                verified_at: '2026-04-18T12:02:00.000Z',
                last_error: null,
                provider_metadata: {
                    trade_no: 'ZPAY_TRADE_SUMMARY_REFUNDED_LIVE_1'
                }
            }
        ],
        paymentEvents: [],
        checkoutSessions: [],
        paymentQueryAttempts: [],
        paymentAnomalyCases: [],
        opsAlertJobs: [],
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
                            providerOrderNo: 'ZPAY_SUMMARY_REFUNDED_LIVE_1',
                            tradeNo: 'ZPAY_TRADE_SUMMARY_REFUNDED_LIVE_1',
                            status: 'refunded',
                            statusRaw: '2',
                            paidAmount: 0.01,
                            transactionId: 'ZPAY_TRADE_SUMMARY_REFUNDED_LIVE_1',
                            message: 'success'
                        };
                    }
                };
            }
        }
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'ops',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();
        const order = Array.isArray(payload.recent_orders) ? payload.recent_orders[0] : null;

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.ok(order);
        assert.equal(order.provider_order_no, 'ZPAY_SUMMARY_REFUNDED_LIVE_1');
        assert.equal(order.provider_metadata.refund_status, 'refunded');
        assert.deepEqual(order.order_available_actions, [
            'query_zpay_order'
        ]);
    });
});

test('payments summary skips audit log writes for background prefetch requests', async () => {
    const state = {
        paymentOrders: []
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'overview',
                days: '30',
                prefetch: '1'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.auditLogs.length, 0);
    });
});

test('payments summary keeps ignored ops alert items visible even when queue has more than twelve records', async () => {
    const opsAlertJobs = [];

    for (let index = 0; index < 12; index += 1) {
        opsAlertJobs.push({
            id: `ops-job-open-${index}`,
            alert_type: 'payment_refund_ops',
            severity: 'warning',
            title: `待处理告警 ${index + 1}`,
            content: `站点：CN\n订单号：OPEN_${index + 1}`,
            payload: {
                provider: 'hupijiao',
                provider_order_no: `OPEN_${index + 1}`,
                site: 'cn'
            },
            channels: ['telegram'],
            remaining_channels: ['telegram'],
            status: index % 2 === 0 ? 'retry' : 'pending',
            attempt_count: 1,
            max_attempts: 6,
            next_retry_at: '2026-03-24T12:00:00.000Z',
            delivered_at: null,
            last_error: '',
            created_at: `2026-03-24T11:${String(index).padStart(2, '0')}:00.000Z`,
            updated_at: `2026-03-24T11:${String(index).padStart(2, '0')}:30.000Z`
        });
    }

    opsAlertJobs.push({
        id: 'ops-job-ignored-1',
        alert_type: 'payment_refund_ops',
        severity: 'info',
        title: '已忽略告警 1',
        content: '站点：CN\n订单号：IGNORED_1',
        payload: {
            provider: 'hupijiao',
            provider_order_no: 'IGNORED_1',
            site: 'cn'
        },
        channels: ['telegram'],
        remaining_channels: [],
        status: 'ignored',
        attempt_count: 1,
        max_attempts: 6,
        next_retry_at: null,
        delivered_at: null,
        last_error: '',
        created_at: '2026-03-24T10:00:00.000Z',
        updated_at: '2026-03-24T10:10:00.000Z'
    });

    const state = { opsAlertJobs };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'overview',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.ops_alert_summary.ignored, 1);
        assert.equal(payload.ops_alert_items.some((item) => item.queue_status === 'ignored' && item.provider_order_no === 'IGNORED_1'), true);
    });
});

test('payments summary exposes unmatched checkout session traces for ops visibility', async () => {
    const state = {
        paymentOrders: [
            {
                id: 'order-linked-session-1',
                provider: 'zpay',
                provider_order_no: 'ZPAY_LINKED_SESSION_1',
                user_id: 'user-linked-session-1',
                site: 'cn',
                status: 'redeemed',
                expected_amount: 10,
                paid_amount: 10,
                points_amount: 10,
                package_name: '已回填套餐',
                created_at: '2026-04-18T19:00:00.000Z',
                paid_at: '2026-04-18T19:01:00.000Z',
                claimed_at: '2026-04-18T19:02:00.000Z',
                verified_at: '2026-04-18T19:02:00.000Z',
                last_error: null,
                provider_metadata: {}
            }
        ],
        paymentEvents: [],
        checkoutSessions: [
            {
                id: 'session-open-zpay-1',
                session_key: 'PCS_ZPAY_OPEN_1',
                provider: 'zpay',
                user_id: 'user-open-session-1',
                site: 'cn',
                package_id: null,
                package_name: '自定义充值',
                requested_points: 0.01,
                bonus_points: 0,
                granted_points: 0.01,
                expected_amount: 0.01,
                status: 'redirect_ready',
                checkout_url: 'https://zpayz.cn/pay/open-1',
                query_mode: 'polling',
                payment_order_id: null,
                provider_metadata: {
                    provider_order_no: 'ZP_SESSION_TRACE_1'
                },
                error_message: null,
                expires_at: '2026-04-18T21:30:00.000Z',
                completed_at: null,
                created_at: '2026-04-18T21:00:00.000Z',
                updated_at: '2026-04-18T21:01:00.000Z'
            },
            {
                id: 'session-completed-unlinked-1',
                session_key: 'PCS_ZPAY_COMPLETED_UNLINKED_1',
                provider: 'zpay',
                user_id: 'user-completed-session-1',
                site: 'cn',
                package_id: null,
                package_name: '积分充值 0.01 点',
                requested_points: 0.01,
                bonus_points: 0,
                granted_points: 0.01,
                expected_amount: 0.01,
                status: 'completed',
                checkout_url: 'https://zpayz.cn/pay/completed-1',
                query_mode: 'polling',
                payment_order_id: null,
                provider_metadata: {
                    provider_order_no: 'ZP_SESSION_TRACE_2'
                },
                error_message: null,
                expires_at: null,
                completed_at: '2026-04-18T20:02:00.000Z',
                created_at: '2026-04-18T20:00:00.000Z',
                updated_at: '2026-04-18T20:02:00.000Z'
            },
            {
                id: 'session-linked-zpay-1',
                session_key: 'PCS_ZPAY_LINKED_1',
                provider: 'zpay',
                user_id: 'user-linked-session-1',
                site: 'cn',
                package_id: null,
                package_name: '已回填套餐',
                requested_points: 10,
                bonus_points: 0,
                granted_points: 10,
                expected_amount: 10,
                status: 'completed',
                checkout_url: 'https://zpayz.cn/pay/linked-1',
                query_mode: 'polling',
                payment_order_id: 'order-linked-session-1',
                provider_metadata: {
                    provider_order_no: 'ZPAY_LINKED_SESSION_1',
                    linked_by: 'webhook',
                    linked_at: '2026-04-18T19:02:00.000Z'
                },
                error_message: null,
                expires_at: null,
                completed_at: '2026-04-18T19:01:00.000Z',
                created_at: '2026-04-18T19:00:00.000Z',
                updated_at: '2026-04-18T19:02:00.000Z'
            }
        ],
        profiles: [
            {
                id: 'user-open-session-1',
                email: 'open-session@example.com',
                username: 'open-session'
            },
            {
                id: 'user-completed-session-1',
                email: 'completed-session@example.com',
                username: 'completed-session'
            }
        ],
        paymentQueryAttempts: [],
        paymentAnomalyCases: [],
        opsAlertJobs: []
    };

    await withPaymentsSummaryHandler(state, async (handler) => {
        const req = {
            method: 'GET',
            query: {
                view: 'ops',
                days: '30'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();
        const sessions = Array.isArray(payload.recent_checkout_sessions) ? payload.recent_checkout_sessions : [];

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(sessions.length, 2);
        assert.equal(sessions[0].session_key, 'PCS_ZPAY_OPEN_1');
        assert.equal(sessions[0].status, 'redirect_ready');
        assert.equal(sessions[0].provider_order_no, 'ZP_SESSION_TRACE_1');
        assert.equal(sessions[0].has_checkout_url, true);
        assert.equal(sessions[0].payment_order_id, null);
        assert.equal(sessions[0].user_email, 'open-session@example.com');
        assert.equal(sessions[1].session_key, 'PCS_ZPAY_COMPLETED_UNLINKED_1');
        assert.equal(sessions[1].user_email, 'completed-session@example.com');
        assert.equal(sessions.some((session) => session.session_key === 'PCS_ZPAY_LINKED_1'), false);
    });
});

test('payments runtime summary UI keeps refund anomaly indicators wired in source', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-payments.js'), 'utf8');
    const summarySource = fs.readFileSync(path.join(__dirname, '..', 'server', 'api-handlers', 'admin', 'payments', 'summary.js'), 'utf8');
    const adminStudioSource = fs.readFileSync(path.join(__dirname, '..', 'admin-studio.js'), 'utf8');
    const adminStudioHtml = fs.readFileSync(path.join(__dirname, '..', 'admin-studio.html'), 'utf8');
    const activeOverviewMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260419_fix_payment_overview_summary_active_anomalies.sql'), 'utf8');

    assert.match(source, /refund_failures/);
    assert.match(source, /refund_reclaim_failures/);
    assert.match(source, /refund_compensation_failures/);
    assert.match(source, /refund_alert_topics/);
    assert.match(source, /退款异常/);
    assert.match(source, /退款积分回滚失败/);
    assert.match(source, /payments-focus-exception-topic/);
    assert.match(source, /paymentsRefundAlertsPanel/);
    assert.match(source, /paymentsOpsAlertQueuePanel/);
    assert.match(source, /ops_alert_summary/);
    assert.match(source, /ops_alert_items/);
    assert.match(source, /renderOverviewSecondarySkeletons/);
    assert.match(source, /overview_scope/);
    assert.match(source, /scope: 'secondary'/);
    assert.match(source, /scope: 'ops'/);
    assert.match(source, /Promise\.allSettled/);
    assert.match(source, /首屏摘要已加载，正在并行补充趋势与专题/);
    assert.match(source, /buildPaymentsRefundAlertItemSkeleton/);
    assert.match(source, /buildPaymentsTrendLegendSkeleton/);
    assert.match(source, /Array\.from\(\{ length: 24 \}, \(_, index\) =>/);
    assert.match(summarySource, /'checkout_session_id'/);
    assert.match(summarySource, /order\?\.checkout_session_id \|\| metadata\.checkout_session_id/);
    assert.match(activeOverviewMigration, /duplicate_webhooks/);
    assert.match(activeOverviewMigration, /duplicate_webhook_orders/);
    assert.doesNotMatch(activeOverviewMigration, /'session_anomalies',\s*0/);
    assert.match(adminStudioSource, /payments-focus-ops-alert-queue/);
    assert.doesNotMatch(adminStudioHtml, /paymentsOpsAlertHealthPanel/);
    assert.match(adminStudioHtml, /paymentsOpsAlertQueuePanel/);
});
