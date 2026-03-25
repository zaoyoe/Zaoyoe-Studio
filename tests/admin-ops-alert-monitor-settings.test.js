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
        }
    };
}

function createState(overrides = {}) {
    return {
        user: { id: 'admin-user-1', email: 'admin@example.com' },
        jobs: [],
        auditLogs: [],
        ...overrides
    };
}

function compareValue(left, right) {
    const leftDate = Date.parse(left);
    const rightDate = Date.parse(right);

    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) {
        return leftDate - rightDate;
    }

    return String(left || '').localeCompare(String(right || ''));
}

function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every(({ op, column, value }) => {
        if (op === 'eq') {
            return row[column] === value;
        }
        if (op === 'in') {
            return Array.isArray(value) ? value.includes(row[column]) : false;
        }
        if (op === 'gte') {
            return compareValue(row[column], value) >= 0;
        }
        return true;
    }));
}

function sortRows(rows, order) {
    if (!order?.column) return rows.slice();

    return rows.slice().sort((left, right) => (
        order.ascending
            ? compareValue(left[order.column], right[order.column])
            : compareValue(right[order.column], left[order.column])
    ));
}

function applyRange(rows, range) {
    if (!range) return rows;
    return rows.slice(range.from, range.to + 1);
}

function createSupabaseStub(state) {
    return {
        from(table) {
            if (table !== 'ops_alert_jobs') {
                throw new Error(`Unexpected table access: ${table}`);
            }

            const queryState = {
                mode: 'select',
                filters: [],
                order: null,
                range: null,
                payload: null
            };

            const query = {
                select() {
                    return query;
                },
                update(payload) {
                    queryState.mode = 'update';
                    queryState.payload = payload;
                    return query;
                },
                eq(column, value) {
                    queryState.filters.push({ op: 'eq', column, value });
                    return query;
                },
                in(column, value) {
                    queryState.filters.push({ op: 'in', column, value });
                    return query;
                },
                gte(column, value) {
                    queryState.filters.push({ op: 'gte', column, value });
                    return query;
                },
                order(column, options = {}) {
                    queryState.order = {
                        column,
                        ascending: options.ascending !== false
                    };
                    return query;
                },
                async range(from, to) {
                    if (queryState.mode !== 'select') {
                        throw new Error('range is only supported for select queries');
                    }
                    return {
                        data: applyRange(sortRows(applyFilters(state.jobs || [], queryState.filters), queryState.order), { from, to }),
                        error: null
                    };
                },
                then(resolve, reject) {
                    if (queryState.mode === 'update') {
                        const rows = applyFilters(state.jobs || [], queryState.filters);
                        rows.forEach((row) => {
                            Object.assign(row, queryState.payload || {});
                        });
                        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
                    }
                    return Promise.resolve({ data: [], error: null }).then(resolve, reject);
                }
            };

            return query;
        }
    };
}

function createAdminModule(state) {
    return {
        async requireAdmin() {
            return {
                supabase: createSupabaseStub(state),
                user: state.user
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
            state.auditLogs = state.auditLogs || [];
            state.auditLogs.push(entry);
        }
    };
}

async function withHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/ops-alert-monitor.js');
    const originalLoad = Module._load;
    const state = createState(stateOverrides);

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return createAdminModule(state);
        }
        return originalLoad(request, parent, isMain);
    };

    try {
        const handler = require(handlerPath);
        await callback(handler, state);
    } finally {
        Module._load = originalLoad;
        delete require.cache[handlerPath];
    }
}

function hoursAgo(hours) {
    return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function buildJob(alertType, overrides = {}) {
    return {
        id: overrides.id || `${alertType}-1`,
        alert_type: alertType,
        severity: overrides.severity || 'warning',
        title: overrides.title || `${alertType} title`,
        content: overrides.content || `${alertType} content`,
        payload: overrides.payload || {},
        status: overrides.status || 'delivered',
        created_at: overrides.created_at || hoursAgo(1)
    };
}

test('ops alert monitor handler summarizes payment, ticket, inventory, and fulfillment categories', async () => {
    await withHandler({
        jobs: [
            buildJob('payment_refund_ops', {
                id: 'refund-1',
                severity: 'critical',
                title: '退款失败（订单 1001）',
                content: '支付退款告警\n订单号：HP-1001',
                payload: {
                    target_id: 'payment_refund:1001',
                    provider_order_no: 'HP-1001'
                },
                created_at: hoursAgo(2)
            }),
            buildJob('payment_gateway_degraded', {
                id: 'gateway-problem',
                severity: 'warning',
                title: '虎皮椒支付通道异常',
                content: '支付通道告警\n判定信号：成功率下降',
                payload: {
                    target_id: 'payment_gateway:hupijiao:cn'
                },
                created_at: hoursAgo(3)
            }),
            buildJob('payment_gateway_recovered', {
                id: 'gateway-recovered',
                severity: 'warning',
                title: '虎皮椒支付通道已恢复',
                content: '支付通道恢复通知',
                payload: {
                    target_id: 'payment_gateway:hupijiao:cn'
                },
                created_at: hoursAgo(1)
            }),
            buildJob('ticket_sla_overdue', {
                id: 'ticket-overdue',
                title: '工单超时',
                content: '工单超时告警\n工单号：ticket-1',
                payload: {
                    target_id: 'ticket_sla:ticket-1',
                    ticket_id: 'ticket-1'
                },
                created_at: hoursAgo(5)
            }),
            buildJob('ticket_sla_recovered', {
                id: 'ticket-recovered',
                title: '工单恢复',
                content: '工单恢复通知',
                payload: {
                    target_id: 'ticket_sla:ticket-1',
                    ticket_id: 'ticket-1'
                },
                created_at: hoursAgo(1)
            }),
            buildJob('shop_inventory_low', {
                id: 'inventory-low',
                severity: 'warning',
                title: '库存预警（A 商品）',
                content: '库存不足\n商品：A 商品',
                payload: {
                    target_id: 'shop_inventory:product-a',
                    product_name: 'A 商品'
                },
                created_at: hoursAgo(4)
            }),
            buildJob('shop_order_delivery_failed', {
                id: 'delivery-failed',
                severity: 'critical',
                title: '履约失败（订单 order-1）',
                content: '履约失败\n订单：order-1',
                payload: {
                    target_id: 'shop_order_delivery:order-1',
                    order_id: 'order-1'
                },
                created_at: hoursAgo(2)
            }),
            buildJob('shop_order_delivery_incident', {
                id: 'delivery-incident',
                severity: 'critical',
                title: '履约事故升级',
                content: '履约异常升级\n影响多单',
                payload: {
                    target_id: 'shop_order_delivery_incident:global'
                },
                created_at: hoursAgo(1)
            })
        ]
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.summary.total_active_count, 4);
        assert.equal(payload.summary.total_critical_count, 3);
        assert.equal(payload.summary.active_category_count, 3);
        assert.equal(Array.isArray(payload.categories), true);
        assert.equal(payload.categories.length, 4);

        const payments = payload.categories.find((item) => item.key === 'payments');
        assert.equal(payments.active_count, 1);
        assert.equal(payments.latest_state, 'recovered');
        assert.equal(payments.items[0].reference_value, 'HP-1001');

        const tickets = payload.categories.find((item) => item.key === 'tickets');
        assert.equal(tickets.active_count, 0);
        assert.equal(tickets.latest_state, 'recovered');

        const inventory = payload.categories.find((item) => item.key === 'inventory');
        assert.equal(inventory.active_count, 1);
        assert.equal(inventory.items[0].reference_label, '商品');
        assert.equal(inventory.items[0].reference_value, 'A 商品');

        const fulfillment = payload.categories.find((item) => item.key === 'fulfillment');
        assert.equal(fulfillment.active_count, 2);
        assert.equal(fulfillment.critical_count, 2);
    });
});

test('ops alert monitor handler rejects unsupported methods', async () => {
    await withHandler({}, async (handler) => {
        const req = { method: 'PATCH', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});

test('ops alert monitor handler includes payment config incidents in payments category', async () => {
    await withHandler({
        jobs: [
            buildJob('payment_config_incident', {
                id: 'payment-config-incident-1',
                severity: 'critical',
                title: '支付配置异常升级（3 次）',
                content: '支付配置事故\n风险信号：当前活动通道已切换为模拟支付',
                payload: {
                    target_id: 'payment_config_incident:global'
                },
                created_at: hoursAgo(1)
            })
        ]
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);

        const payments = payload.categories.find((item) => item.key === 'payments');
        assert.equal(payments.active_count, 1);
        assert.equal(payments.critical_count, 1);
        assert.equal(payments.latest_state, 'problem');
        assert.equal(payments.items[0].title, '支付配置异常升级（3 次）');
    });
});

test('ops alert monitor handler treats payment config incident recovery as a payments recovery state', async () => {
    await withHandler({
        jobs: [
            buildJob('payment_config_incident_recovered', {
                id: 'payment-config-incident-recovered-1',
                severity: 'warning',
                title: '支付配置事故已恢复',
                content: '支付配置事故恢复\n恢复结论：阈值已解除',
                payload: {
                    target_id: 'payment_config_incident:global'
                },
                created_at: hoursAgo(1)
            })
        ]
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);

        const payments = payload.categories.find((item) => item.key === 'payments');
        assert.equal(payments.active_count, 0);
        assert.equal(payments.latest_state, 'recovered');
        assert.equal(payments.latest_title, '支付配置事故已恢复');
    });
});

test('ops alert monitor handler excludes handled alerts from active counts and supports mark_handled', async () => {
    await withHandler({
        jobs: [
            buildJob('payment_refund_ops', {
                id: 'refund-active-1',
                severity: 'critical',
                title: '退款失败（订单 2001）',
                payload: {
                    target_id: 'payment_refund:2001',
                    provider_order_no: 'HP-2001'
                },
                status: 'delivered',
                created_at: hoursAgo(1)
            }),
            buildJob('payment_refund_ops', {
                id: 'refund-handled-1',
                severity: 'warning',
                title: '退款失败（订单 2002）',
                payload: {
                    target_id: 'payment_refund:2002',
                    provider_order_no: 'HP-2002'
                },
                status: 'handled',
                created_at: hoursAgo(2)
            })
        ]
    }, async (handler, state) => {
        const getReq = { method: 'GET', headers: {} };
        const getRes = createMockResponse();

        await handler(getReq, getRes);
        const initialPayload = getRes.json();
        const payments = initialPayload.categories.find((item) => item.key === 'payments');
        assert.equal(payments.active_count, 1);

        const postReq = {
            method: 'POST',
            headers: {},
            body: {
                action: 'mark_handled',
                jobIds: ['refund-active-1'],
                category: 'payments',
                scope: 'active',
                severity: 'all'
            }
        };
        const postRes = createMockResponse();

        await handler(postReq, postRes);
        const postPayload = postRes.json();

        assert.equal(postRes.statusCode, 200);
        assert.equal(postPayload.success, true);
        assert.equal(postPayload.updated_count, 1);
        assert.equal(state.jobs.find((item) => item.id === 'refund-active-1').status, 'handled');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin_ops_alert_monitor_mark_handled');

        const refreshedRes = createMockResponse();
        await handler(getReq, refreshedRes);
        const refreshedPayload = refreshedRes.json();
        const refreshedPayments = refreshedPayload.categories.find((item) => item.key === 'payments');
        assert.equal(refreshedPayments.active_count, 0);
        assert.equal(refreshedPayments.latest_state, 'handled');
    });
});
