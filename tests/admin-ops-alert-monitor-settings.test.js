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
        cases: [],
        events: [],
        legacyCases: null,
        tableErrors: {},
        adminRoles: [
            {
                user_id: 'admin-user-1',
                role_name: 'super_admin',
                expires_at: null
            },
            {
                user_id: 'admin-user-2',
                role_name: 'admin',
                expires_at: null
            }
        ],
        profiles: [
            {
                id: 'admin-user-1',
                email: 'admin@example.com',
                username: 'admin',
                display_name: '当前值班',
                avatar_url: ''
            },
            {
                id: 'admin-user-2',
                email: 'ops@example.com',
                username: 'ops',
                display_name: '支付值班',
                avatar_url: ''
            }
        ],
        authUsers: [
            {
                id: 'admin-user-1',
                email: 'admin@example.com'
            },
            {
                id: 'admin-user-2',
                email: 'ops@example.com'
            }
        ],
        runtimeConfig: {
            shop_order_risk: {
                auto_response_enabled: true,
                auto_disable_coupon_min_risk_score: 90,
                auto_ban_user_min_risk_score: 96,
                auto_ban_user_duration_days: 7,
                auto_suspend_product_min_risk_score: 97
            }
        },
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
            if (!['ops_alert_jobs', 'ops_alert_cases', 'shop_risk_cases', 'ops_alert_case_events', 'admin_roles', 'profiles'].includes(table)) {
                throw new Error(`Unexpected table access: ${table}`);
            }

            const queryState = {
                filters: [],
                order: null,
                range: null,
                maybeSingle: false
            };

            function execute(rangeOverride = queryState.range) {
                const tableError = state.tableErrors?.[table] || null;
                if (tableError) {
                    return {
                        data: queryState.maybeSingle ? null : [],
                        error: tableError
                    };
                }

                const sourceRows = table === 'ops_alert_jobs'
                    ? (state.jobs || [])
                    : table === 'ops_alert_case_events'
                        ? (state.events || [])
                        : table === 'shop_risk_cases'
                            ? (state.legacyCases || state.cases || [])
                        : table === 'admin_roles'
                            ? (state.adminRoles || [])
                            : table === 'profiles'
                                ? (state.profiles || [])
                                : (state.cases || []);
                let rows = sortRows(applyFilters(sourceRows, queryState.filters), queryState.order);
                if (rangeOverride) {
                    rows = applyRange(rows, rangeOverride);
                }
                return {
                    data: queryState.maybeSingle ? (rows[0] || null) : rows,
                    error: null
                };
            }

            const query = {
                select() {
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
                maybeSingle() {
                    queryState.maybeSingle = true;
                    return query;
                },
                async range(from, to) {
                    return execute({ from, to });
                },
                then(resolve, reject) {
                    return Promise.resolve(execute()).then(resolve, reject);
                },
                catch(reject) {
                    return query.then(undefined, reject);
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
                adminSupabase: {
                    auth: {
                        admin: {
                            async listUsers() {
                                return {
                                    data: {
                                        users: state.authUsers || []
                                    },
                                    error: null
                                };
                            }
                        }
                    }
                },
                user: state.user
            };
        },
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        }
    };
}

function createOpsAlertsModule(state) {
    return {
        async loadOpsAlertsRuntimeConfig() {
            return {
                config: state.runtimeConfig || createState().runtimeConfig,
                secrets: {}
            };
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
        if (request === '../../../../api/_lib/ops-alerts') {
            return createOpsAlertsModule(state);
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

test('ops alert monitor handler summarizes payment, ticket, inventory, fulfillment, and shop risk categories', async () => {
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
            }),
            buildJob('shop_order_risk_anomaly', {
                id: 'shop-risk-1',
                severity: 'critical',
                title: '优惠码高频使用异常（FLASH0）',
                content: '商城风控告警\n优惠码：FLASH0',
                payload: {
                    target_id: 'shop_order_risk:coupon:FLASH0',
                    signal_type: 'discount_code_spike',
                    discount_code: 'FLASH0',
                    risk_level: 'critical',
                    risk_score: 94,
                    primary_action: 'disable-coupon',
                    response_summary: '建议立即停用优惠码 FLASH0，并复核最近命中订单。',
                    auto_response_action: 'disable-coupon',
                    auto_response_status: 'applied',
                    auto_response_summary: '系统已自动停用优惠码 FLASH0，请继续复核最近命中订单与关联账号。',
                    auto_response_applied_at: hoursAgo(1.4)
                },
                created_at: hoursAgo(1.5)
            })
        ]
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.current_admin_id, 'admin-user-1');
        assert.equal(payload.current_admin_label, '当前值班');
        assert.equal(payload.assignable_admins.length, 2);
        assert.equal(payload.summary.total_active_count, 5);
        assert.equal(payload.summary.total_critical_count, 4);
        assert.equal(payload.summary.active_category_count, 4);
        assert.equal(Array.isArray(payload.categories), true);
        assert.equal(payload.categories.length, 5);

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

        const shopRisk = payload.categories.find((item) => item.key === 'shop_risk');
        assert.equal(shopRisk.active_count, 1);
        assert.equal(shopRisk.critical_count, 1);
        assert.equal(shopRisk.items[0].reference_label, '优惠码');
        assert.equal(shopRisk.items[0].reference_value, 'FLASH0');
        assert.equal(shopRisk.items[0].risk_level, 'critical');
        assert.equal(shopRisk.items[0].risk_score, 94);
        assert.equal(shopRisk.items[0].primary_action, 'disable-coupon');
        assert.equal(shopRisk.thresholds.auto_disable_coupon_min_risk_score, 90);
        assert.equal(shopRisk.recent_threshold_hits[0].action, 'disable-coupon');
        assert.equal(shopRisk.recent_threshold_hits[0].status, 'applied');
        assert.equal(shopRisk.recent_auto_responses[0].action, 'disable-coupon');
        assert.equal(shopRisk.recent_auto_responses[0].status, 'applied');
    });
});

test('ops alert monitor handler rejects non-GET methods', async () => {
    await withHandler({}, async (handler) => {
        const req = { method: 'POST', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});

test('ops alert monitor handler merges shop risk case ownership and case summary into shop risk items', async () => {
    await withHandler({
        jobs: [
            buildJob('shop_order_risk_anomaly', {
                id: 'shop-risk-case-1',
                severity: 'critical',
                title: '优惠码高频使用（FLASH0）',
                content: '商城风控告警\n优惠码：FLASH0',
                payload: {
                    target_id: 'shop_order_risk:coupon:FLASH0',
                    signal_type: 'discount_code_spike',
                    discount_code: 'FLASH0',
                    risk_level: 'critical',
                    risk_score: 93,
                    primary_action: 'disable-coupon',
                    response_summary: '建议先停用优惠码并复核关联订单。'
                },
                created_at: hoursAgo(1)
            })
        ],
        cases: [
            {
                category_key: 'shop_risk',
                target_id: 'shop_order_risk:coupon:FLASH0',
                alert_type: 'shop_order_risk_anomaly',
                status: 'claimed',
                owner_admin_id: 'admin-user-2',
                owner_label: 'ops@example.com',
                note: '已认领，正在核对近 24 小时关联订单。',
                resolution: null,
                last_action: 'claimed',
                last_action_at: hoursAgo(0.6),
                updated_at: hoursAgo(0.6)
            }
        ],
        events: [
            {
                id: 'event-1',
                category_key: 'shop_risk',
                target_id: 'shop_order_risk:coupon:FLASH0',
                alert_type: 'shop_order_risk_anomaly',
                action: 'assign',
                status: 'claimed',
                owner_admin_id: 'admin-user-2',
                owner_label: 'ops@example.com',
                actor_admin_id: 'admin-user-1',
                actor_label: 'admin@example.com',
                note: '已交接给支付值班。',
                resolution: null,
                metadata: {
                    title: '优惠码高频使用（FLASH0）'
                },
                created_at: hoursAgo(0.4)
            }
        ]
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);

        const shopRisk = payload.categories.find((item) => item.key === 'shop_risk');
        assert.equal(shopRisk.items[0].case_status, 'claimed');
        assert.equal(shopRisk.items[0].case_owner_label, 'ops@example.com');
        assert.equal(shopRisk.items[0].case_note, '已认领，正在核对近 24 小时关联订单。');
        assert.equal(shopRisk.items[0].case_latest_event_action, 'assign');
        assert.equal(shopRisk.items[0].case_latest_event_label, '转交负责人');
        assert.equal(shopRisk.items[0].case_latest_event_summary, '已交接给支付值班。');
        assert.equal(shopRisk.items[0].case_recent_events.length, 1);
        assert.equal(shopRisk.case_summary.open, 0);
        assert.equal(shopRisk.case_summary.claimed, 1);
        assert.equal(shopRisk.case_summary.resolved, 0);
        assert.equal(shopRisk.recent_threshold_hits[0].case_status, 'claimed');
        assert.equal(shopRisk.recent_auto_responses.length, 0);
    });
});

test('ops alert monitor handler falls back to legacy shop risk cases when ops_alert_cases is missing from schema cache', async () => {
    await withHandler({
        jobs: [
            buildJob('shop_order_risk_anomaly', {
                id: 'shop-risk-legacy-1',
                severity: 'critical',
                title: '优惠码高频使用（FLASH0）',
                content: '商城风控告警\n优惠码：FLASH0',
                payload: {
                    target_id: 'shop_order_risk:coupon:FLASH0',
                    signal_type: 'discount_code_spike',
                    discount_code: 'FLASH0',
                    risk_level: 'critical',
                    risk_score: 93
                },
                created_at: hoursAgo(1)
            })
        ],
        legacyCases: [
            {
                id: 'legacy-case-1',
                target_id: 'shop_order_risk:coupon:FLASH0',
                status: 'claimed',
                owner_admin_id: 'admin-user-2',
                owner_label: 'ops@example.com',
                note: '旧版 case 表里已认领。',
                resolution: null,
                metadata: {
                    alert_type: 'shop_order_risk_anomaly'
                },
                last_action: 'claimed',
                last_action_at: hoursAgo(0.5),
                updated_at: hoursAgo(0.5)
            }
        ],
        tableErrors: {
            ops_alert_cases: {
                code: 'PGRST205',
                message: "Could not find the table 'public.ops_alert_cases' in the schema cache"
            }
        }
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);

        const shopRisk = payload.categories.find((item) => item.key === 'shop_risk');
        assert.equal(shopRisk.items[0].case_status, 'claimed');
        assert.equal(shopRisk.items[0].case_owner_label, 'ops@example.com');
        assert.equal(shopRisk.items[0].case_note, '旧版 case 表里已认领。');
        assert.equal(shopRisk.case_summary.claimed, 1);
    });
});

test('ops alert monitor handler merges generic ops alert cases into non-shop-risk items', async () => {
    await withHandler({
        jobs: [
            buildJob('payment_gateway_degraded', {
                id: 'gateway-problem-1',
                severity: 'critical',
                title: '虎皮椒支付通道异常',
                content: '支付通道告警\n判定信号：成功率下降',
                payload: {
                    target_id: 'payment_gateway:hupijiao:cn'
                },
                created_at: hoursAgo(1)
            })
        ],
        cases: [
            {
                category_key: 'payments',
                target_id: 'payment_gateway:hupijiao:cn',
                alert_type: 'payment_gateway_degraded',
                status: 'claimed',
                owner_admin_id: 'admin-user-3',
                owner_label: 'payments-ops@example.com',
                note: '已联系支付通道同学排查成功率下降原因。',
                resolution: null,
                last_action: 'claimed',
                last_action_at: hoursAgo(0.5),
                updated_at: hoursAgo(0.5)
            }
        ]
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);

        const payments = payload.categories.find((item) => item.key === 'payments');
        assert.equal(payments.items[0].case_status, 'claimed');
        assert.equal(payments.items[0].case_owner_label, 'payments-ops@example.com');
        assert.equal(payments.items[0].case_note, '已联系支付通道同学排查成功率下降原因。');
        assert.equal(payments.case_summary.open, 0);
        assert.equal(payments.case_summary.claimed, 1);
        assert.equal(payments.case_summary.resolved, 0);
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

test('ops alert monitor handler exposes shared login ip shop risk context', async () => {
    await withHandler({
        jobs: [
            buildJob('shop_order_risk_anomaly', {
                id: 'shop-risk-shared-ip-1',
                severity: 'critical',
                title: '共享登录 IP 异常（203.0.113.88）',
                content: '商城风控告警\n共享登录 IP：203.0.113.88',
                payload: {
                    target_id: 'shop_order_risk:shared_ip:203.0.113.88',
                    signal_type: 'shared_login_ip_cluster',
                    client_ip: '203.0.113.88',
                    user_id: 'buyer-anchor-1',
                    buyer_label: 'Alpha',
                    risk_level: 'critical',
                    risk_score: 91,
                    primary_action: 'open-user-ban',
                    response_summary: '建议先查看关联账号，再对风险锚点账号发起封禁处理。'
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

        const shopRisk = payload.categories.find((item) => item.key === 'shop_risk');
        assert.equal(shopRisk.active_count, 1);
        assert.equal(shopRisk.items[0].reference_label, '共享登录 IP');
        assert.equal(shopRisk.items[0].reference_value, '203.0.113.88');
        assert.equal(shopRisk.items[0].signal_type, 'shared_login_ip_cluster');
        assert.equal(shopRisk.items[0].user_id, 'buyer-anchor-1');
        assert.equal(shopRisk.items[0].risk_score, 91);
        assert.equal(shopRisk.items[0].primary_action, 'open-user-ban');
    });
});

test('ops alert monitor handler exposes shared login signature shop risk context', async () => {
    await withHandler({
        jobs: [
            buildJob('shop_order_risk_anomaly', {
                id: 'shop-risk-signature-1',
                severity: 'critical',
                title: '共享登录签名异常（Chrome/124）',
                content: '商城风控告警\n共享登录签名：203.0.113.88 · Mozilla/5.0 Chrome/124',
                payload: {
                    target_id: 'shop_order_risk:login_signature:abc123',
                    signal_type: 'shared_login_signature_cluster',
                    client_ip: '203.0.113.88',
                    user_agent_summary: 'Mozilla/5.0 Chrome/124',
                    login_signature_label: '203.0.113.88 · Mozilla/5.0 Chrome/124',
                    user_id: 'buyer-anchor-2',
                    buyer_label: 'Beta',
                    risk_level: 'critical',
                    risk_score: 95,
                    primary_action: 'open-user-ban',
                    response_summary: '建议优先核查关联账号与共用设备，再对风险锚点账号发起封禁处理。'
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

        const shopRisk = payload.categories.find((item) => item.key === 'shop_risk');
        assert.equal(shopRisk.active_count, 1);
        assert.equal(shopRisk.items[0].reference_label, '共享登录签名');
        assert.equal(shopRisk.items[0].reference_value, '203.0.113.88 · Mozilla/5.0 Chrome/124');
        assert.equal(shopRisk.items[0].signal_type, 'shared_login_signature_cluster');
        assert.equal(shopRisk.items[0].user_id, 'buyer-anchor-2');
        assert.equal(shopRisk.items[0].login_signature_label, '203.0.113.88 · Mozilla/5.0 Chrome/124');
        assert.equal(shopRisk.items[0].risk_level, 'critical');
        assert.equal(shopRisk.items[0].primary_action, 'open-user-ban');
    });
});

test('ops alert monitor handler includes recent shop risk threshold hits and auto-response history', async () => {
    await withHandler({
        jobs: [
            buildJob('shop_order_risk_anomaly', {
                id: 'shop-risk-zero-total-1',
                severity: 'critical',
                title: '0 价订单聚集（商品 A）',
                content: '商城风控告警\n商品：商品 A',
                payload: {
                    target_id: 'shop_order_risk:zero_total:global',
                    signal_type: 'zero_total_cluster',
                    primary_product_id: 'product-a',
                    primary_product_name: '商品 A',
                    primary_product_order_count: 4,
                    primary_product_order_share: 0.75,
                    risk_level: 'critical',
                    risk_score: 98,
                    primary_action: 'review-orders',
                    response_summary: '建议先复核风险订单，再决定是否需要处置账号或优惠码。',
                    auto_response_action: 'suspend-product',
                    auto_response_status: 'applied',
                    auto_response_summary: '系统已自动下架商品 商品 A，请尽快复核最近 0 价订单与商品配置。',
                    auto_response_target: '商品 A',
                    auto_response_target_type: 'product',
                    auto_response_applied_at: hoursAgo(0.8)
                },
                created_at: hoursAgo(1)
            }),
            buildJob('shop_order_risk_anomaly', {
                id: 'shop-risk-velocity-1',
                severity: 'critical',
                title: '账号短时扫货（Gamma）',
                content: '商城风控告警\n账号：Gamma',
                payload: {
                    target_id: 'shop_order_risk:user_velocity:user-gamma',
                    signal_type: 'user_velocity',
                    user_id: 'user-gamma',
                    buyer_label: 'Gamma',
                    risk_level: 'critical',
                    risk_score: 97,
                    primary_action: 'open-user-ban',
                    response_summary: '建议立即发起封禁处理，并复核该账号最近订单与库存消耗。',
                    auto_response_action: 'ban-user',
                    auto_response_status: 'applied',
                    auto_response_summary: '系统已自动封禁账号 Gamma 7 天，请继续复核其近期订单与库存消耗。',
                    auto_response_target: 'Gamma',
                    auto_response_target_type: 'user',
                    auto_response_applied_at: hoursAgo(0.6)
                },
                created_at: hoursAgo(0.7)
            })
        ]
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);

        const shopRisk = payload.categories.find((item) => item.key === 'shop_risk');
        assert.equal(shopRisk.recent_threshold_hits.length, 2);
        assert.equal(shopRisk.recent_threshold_hits[0].action, 'ban-user');
        assert.equal(shopRisk.recent_threshold_hits[0].status, 'applied');
        assert.equal(shopRisk.recent_threshold_hits[1].action, 'suspend-product');
        assert.equal(shopRisk.recent_threshold_hits[1].reference_value, '商品 A');
        assert.equal(shopRisk.recent_auto_responses.length, 2);
        assert.equal(shopRisk.recent_auto_responses[0].action, 'ban-user');
        assert.equal(shopRisk.recent_auto_responses[0].target, 'Gamma');
        assert.equal(shopRisk.recent_auto_responses[1].action, 'suspend-product');
        assert.equal(shopRisk.recent_auto_responses[1].target, '商品 A');
    });
});
