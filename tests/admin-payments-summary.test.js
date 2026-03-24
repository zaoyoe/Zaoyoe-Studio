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

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
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

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return mockAdminModule;
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
        assert.equal(payload.refund_alert_topics.some((topic) => topic.key === 'refund_compensation_failures' && topic.count === 1), true);
        assert.equal(payload.refund_alert_items.some((item) => item.title === '退款积分回滚失败' && item.ops_status === 'handled'), true);
        assert.equal((payload.exception_topics || []).length, 0);
    });
});

test('payments runtime summary UI keeps refund anomaly indicators wired in source', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-payments.js'), 'utf8');

    assert.match(source, /refund_failures/);
    assert.match(source, /refund_reclaim_failures/);
    assert.match(source, /refund_compensation_failures/);
    assert.match(source, /refund_alert_topics/);
    assert.match(source, /退款异常/);
    assert.match(source, /退款积分回滚失败/);
    assert.match(source, /payments-focus-exception-topic/);
    assert.match(source, /paymentsRefundAlertsPanel/);
});
