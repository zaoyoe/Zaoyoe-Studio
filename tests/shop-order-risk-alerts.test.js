const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildShopOrderRiskAnomalyAlerts,
    normalizeShopOrderRiskMonitorConfig,
    runShopOrderRiskSweep,
    __testUtils
} = require('../api/_lib/shop-order-risk-alerts');

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        order: null,
        payload: null,
        range: null,
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
        lte(column, value) {
            state.filters.push({ op: 'lte', column, value });
            return builder;
        },
        in(column, values) {
            state.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [values] });
            return builder;
        },
        order(column, options = {}) {
            state.order = {
                column,
                ascending: options.ascending !== false
            };
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

    return String(left || '').localeCompare(String(right || ''));
}

function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every(({ op, column, value }) => {
        if (op === 'eq') return row[column] === value;
        if (op === 'gte') return compareValue(row[column], value) >= 0;
        if (op === 'lte') return compareValue(row[column], value) <= 0;
        if (op === 'in') return Array.isArray(value) ? value.includes(row[column]) : false;
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

function createSupabaseStub(state = {}) {
    const jobs = state.jobs || [];
    const orders = state.orders || [];
    const profiles = state.profiles || [];
    const entitlements = state.entitlements || [];
    const loginHistory = state.loginHistory || [];
    const adminRoles = state.adminRoles || [];
    const systemNotifications = state.systemNotifications || [];

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'shop_orders' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(orders, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'ops_alert_jobs' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(jobs, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'ops_alert_jobs' && query.mode === 'insert') {
                    const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const inserted = payload.map((row, index) => ({
                        id: row.id || `job-${jobs.length + index + 1}`,
                        created_at: row.created_at || new Date().toISOString(),
                        ...row
                    }));

                    inserted.forEach((row) => {
                        jobs.push({ ...row });
                    });

                    return {
                        data: query.single ? inserted[0] : inserted,
                        error: null
                    };
                }

                if (table === 'profiles' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(profiles, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'user_purchase_entitlements' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(entitlements, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'user_login_history' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(loginHistory, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'admin_roles' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(adminRoles, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'system_notifications' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(systemNotifications, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'system_notifications' && query.mode === 'insert') {
                    const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const inserted = payload.map((row, index) => ({
                        id: row.id || `notification-${systemNotifications.length + index + 1}`,
                        created_at: row.created_at || new Date().toISOString(),
                        ...row
                    }));

                    inserted.forEach((row) => {
                        systemNotifications.push({ ...row });
                    });

                    return {
                        data: query.single ? inserted[0] : inserted,
                        error: null
                    };
                }

                throw new Error(`Unexpected table access: ${table}/${query.mode}`);
            });
        }
    };
}

function createOpsRuntime() {
    return {
        config: normalizeOpsAlertsConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['10001']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                }
            }
        }),
        secrets: {
            telegram_bot_token: 'telegram-token',
            feishu_webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo'
        }
    };
}

test('buildDiscountCodeSpikeAlerts flags coupon abuse across multiple users', () => {
    const alerts = __testUtils.buildDiscountCodeSpikeAlerts([
        {
            id: 'order-1',
            user_id: 'buyer-1',
            site: 'cn',
            snapshot_product_name: 'Prompt Pro 年卡',
            price_paid: 0,
            total_price: 19.9,
            discount_code: 'FLASH0',
            created_at: '2026-03-27T10:00:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'order-2',
            user_id: 'buyer-2',
            site: 'cn',
            snapshot_product_name: 'Prompt Pro 年卡',
            price_paid: 0,
            total_price: 19.9,
            discount_code: 'FLASH0',
            created_at: '2026-03-27T10:02:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'order-3',
            user_id: 'buyer-3',
            site: 'intl',
            snapshot_product_name: '卡密周卡',
            price_paid: 0,
            total_price: 9.9,
            discount_code: 'FLASH0',
            created_at: '2026-03-27T10:04:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'order-4',
            user_id: 'buyer-1',
            site: 'cn',
            snapshot_product_name: '卡密周卡',
            price_paid: 0,
            total_price: 9.9,
            discount_code: 'FLASH0',
            created_at: '2026-03-27T10:06:00.000Z',
            refund_status: 'none'
        }
    ], {
        byId: new Map([
            ['buyer-1', { id: 'buyer-1', display_name: 'Alpha' }],
            ['buyer-2', { id: 'buyer-2', display_name: 'Beta' }],
            ['buyer-3', { id: 'buyer-3', display_name: 'Gamma' }]
        ])
    }, normalizeShopOrderRiskMonitorConfig(), {
        now: '2026-03-27T10:10:00.000Z'
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'shop_order_risk_anomaly');
    assert.equal(alerts[0].payload.signal_type, 'discount_code_spike');
    assert.equal(alerts[0].payload.discount_code, 'FLASH0');
    assert.equal(alerts[0].payload.order_count, 4);
    assert.equal(alerts[0].payload.distinct_user_count, 3);
    assert.equal(alerts[0].payload.zero_total_count, 4);
    assert.match(alerts[0].content, /团伙扫货/);
});

test('buildZeroTotalClusterAlerts flags repeated zero-total orders', () => {
    const alerts = __testUtils.buildZeroTotalClusterAlerts([
        {
            id: 'zero-1',
            user_id: 'buyer-1',
            site: 'cn',
            snapshot_product_name: 'Prompt Pro 年卡',
            price_paid: 0,
            total_price: 19.9,
            discount_code: 'FLASH0',
            created_at: '2026-03-27T10:00:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'zero-2',
            user_id: 'buyer-2',
            site: 'cn',
            snapshot_product_name: '卡密周卡',
            price_paid: 0,
            total_price: 9.9,
            discount_code: 'FLASH0',
            created_at: '2026-03-27T10:03:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'zero-3',
            user_id: 'buyer-3',
            site: 'intl',
            snapshot_product_name: '卡密周卡',
            price_paid: 0,
            total_price: 9.9,
            discount_code: '',
            created_at: '2026-03-27T10:06:00.000Z',
            refund_status: 'none'
        }
    ], {
        byId: new Map([
            ['buyer-1', { id: 'buyer-1', display_name: 'Alpha' }],
            ['buyer-2', { id: 'buyer-2', display_name: 'Beta' }],
            ['buyer-3', { id: 'buyer-3', display_name: 'Gamma' }]
        ])
    }, normalizeShopOrderRiskMonitorConfig({
        zero_total_min_order_count: 3,
        zero_total_min_distinct_users: 2
    }), {
        now: '2026-03-27T10:10:00.000Z'
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].payload.signal_type, 'zero_total_cluster');
    assert.equal(alerts[0].severity, 'critical');
    assert.equal(alerts[0].payload.order_count, 3);
    assert.match(alerts[0].content, /连续 0 价商城订单/);
});

test('buildUserVelocityAlerts skips unlimited purchasers', () => {
    const alerts = __testUtils.buildUserVelocityAlerts([
        {
            id: 'bulk-1',
            user_id: 'buyer-unlimited',
            site: 'cn',
            snapshot_product_name: 'Prompt Pro 年卡',
            item_count: 3,
            total_price: 59.8,
            created_at: '2026-03-27T10:00:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'bulk-2',
            user_id: 'buyer-unlimited',
            site: 'cn',
            snapshot_product_name: 'Prompt Pro 年卡',
            item_count: 3,
            total_price: 59.8,
            created_at: '2026-03-27T10:03:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'bulk-3',
            user_id: 'buyer-unlimited',
            site: 'cn',
            snapshot_product_name: 'Prompt Pro 年卡',
            item_count: 3,
            total_price: 59.8,
            created_at: '2026-03-27T10:06:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'bulk-4',
            user_id: 'buyer-unlimited',
            site: 'cn',
            snapshot_product_name: 'Prompt Pro 年卡',
            item_count: 3,
            total_price: 59.8,
            created_at: '2026-03-27T10:08:00.000Z',
            refund_status: 'none'
        }
    ], {
        byId: new Map([
            ['buyer-unlimited', { id: 'buyer-unlimited', display_name: 'VIP 批发' }]
        ])
    }, {
        unlimitedUserIds: new Set(['buyer-unlimited'])
    }, normalizeShopOrderRiskMonitorConfig(), {
        now: '2026-03-27T10:10:00.000Z'
    });

    assert.equal(alerts.length, 0);
});

test('buildSharedLoginIpAlerts flags clustered orders from the same login ip', () => {
    const alerts = __testUtils.buildSharedLoginIpAlerts([
        {
            id: 'ip-1',
            user_id: 'buyer-1',
            site: 'cn',
            snapshot_product_name: 'Prompt Pro 年卡',
            item_count: 2,
            total_price: 19.9,
            created_at: '2026-03-27T10:00:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'ip-2',
            user_id: 'buyer-2',
            site: 'cn',
            snapshot_product_name: 'Apple 资格号',
            item_count: 2,
            total_price: 30,
            created_at: '2026-03-27T10:04:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'ip-3',
            user_id: 'buyer-3',
            site: 'intl',
            snapshot_product_name: '卡密周卡',
            item_count: 2,
            total_price: 9.9,
            created_at: '2026-03-27T10:06:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'ip-4',
            user_id: 'buyer-1',
            site: 'cn',
            snapshot_product_name: 'Prompt Pro 年卡',
            item_count: 2,
            total_price: 19.9,
            created_at: '2026-03-27T10:08:00.000Z',
            refund_status: 'none'
        }
    ], {
        byId: new Map([
            ['buyer-1', { id: 'buyer-1', display_name: 'Alpha', last_login_ip: '203.0.113.88' }],
            ['buyer-2', { id: 'buyer-2', display_name: 'Beta', last_login_ip: '203.0.113.88' }],
            ['buyer-3', { id: 'buyer-3', display_name: 'Gamma', last_login_ip: '203.0.113.88' }]
        ])
    }, normalizeShopOrderRiskMonitorConfig(), {
        now: '2026-03-27T10:10:00.000Z'
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].payload.signal_type, 'shared_login_ip_cluster');
    assert.equal(alerts[0].payload.client_ip, '203.0.113.88');
    assert.equal(alerts[0].payload.order_count, 4);
    assert.equal(alerts[0].payload.distinct_user_count, 3);
    assert.equal(alerts[0].payload.total_quantity, 8);
    assert.match(alerts[0].content, /共享登录 IP/);
});

test('buildSharedLoginSignatureAlerts flags clustered orders from the same ip and device signature', () => {
    const alerts = __testUtils.buildSharedLoginSignatureAlerts([
        {
            id: 'sig-1',
            user_id: 'buyer-1',
            site: 'cn',
            snapshot_product_name: 'Prompt Pro 年卡',
            item_count: 2,
            total_price: 19.9,
            created_at: '2026-03-27T10:00:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'sig-2',
            user_id: 'buyer-2',
            site: 'cn',
            snapshot_product_name: 'Apple 资格号',
            item_count: 2,
            total_price: 30,
            created_at: '2026-03-27T10:04:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'sig-3',
            user_id: 'buyer-3',
            site: 'intl',
            snapshot_product_name: '卡密周卡',
            item_count: 2,
            total_price: 9.9,
            created_at: '2026-03-27T10:06:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'sig-4',
            user_id: 'buyer-1',
            site: 'cn',
            snapshot_product_name: 'Prompt Pro 年卡',
            item_count: 2,
            total_price: 19.9,
            created_at: '2026-03-27T10:08:00.000Z',
            refund_status: 'none'
        }
    ], {
        byId: new Map([
            ['buyer-1', { id: 'buyer-1', display_name: 'Alpha' }],
            ['buyer-2', { id: 'buyer-2', display_name: 'Beta' }],
            ['buyer-3', { id: 'buyer-3', display_name: 'Gamma' }]
        ])
    }, {
        latestByUser: new Map([
            ['buyer-1', { user_id: 'buyer-1', ip_address: '203.0.113.88', user_agent: 'Mozilla/5.0 Chrome/124', created_at: '2026-03-27T10:01:00.000Z' }],
            ['buyer-2', { user_id: 'buyer-2', ip_address: '203.0.113.88', user_agent: 'Mozilla/5.0 Chrome/124', created_at: '2026-03-27T10:02:00.000Z' }],
            ['buyer-3', { user_id: 'buyer-3', ip_address: '203.0.113.88', user_agent: 'Mozilla/5.0 Chrome/124', created_at: '2026-03-27T10:03:00.000Z' }]
        ])
    }, normalizeShopOrderRiskMonitorConfig(), {
        now: '2026-03-27T10:10:00.000Z'
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].payload.signal_type, 'shared_login_signature_cluster');
    assert.equal(alerts[0].payload.client_ip, '203.0.113.88');
    assert.match(alerts[0].payload.login_signature_label, /203\.0\.113\.88/);
    assert.equal(alerts[0].payload.order_count, 4);
    assert.equal(alerts[0].payload.distinct_user_count, 3);
    assert.equal(alerts[0].payload.total_quantity, 8);
    assert.match(alerts[0].content, /共享登录签名/);
});

test('buildShopOrderRiskAnomalyAlerts enriches risk score and recommended actions', () => {
    const alerts = buildShopOrderRiskAnomalyAlerts([
        {
            id: 'coupon-1',
            user_id: 'buyer-1',
            site: 'cn',
            snapshot_product_name: 'Prompt Pro 年卡',
            price_paid: 0,
            total_price: 19.9,
            item_count: 2,
            discount_code: 'FLASH0',
            created_at: '2026-03-27T10:00:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'coupon-2',
            user_id: 'buyer-2',
            site: 'cn',
            snapshot_product_name: 'Prompt Pro 年卡',
            price_paid: 0,
            total_price: 19.9,
            item_count: 2,
            discount_code: 'FLASH0',
            created_at: '2026-03-27T10:01:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'coupon-3',
            user_id: 'buyer-3',
            site: 'intl',
            snapshot_product_name: '卡密周卡',
            price_paid: 0,
            total_price: 9.9,
            item_count: 2,
            discount_code: 'FLASH0',
            created_at: '2026-03-27T10:02:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'coupon-4',
            user_id: 'buyer-1',
            site: 'cn',
            snapshot_product_name: '卡密周卡',
            price_paid: 0,
            total_price: 9.9,
            item_count: 2,
            discount_code: 'FLASH0',
            created_at: '2026-03-27T10:03:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'bulk-1',
            user_id: 'buyer-bulk',
            site: 'cn',
            snapshot_product_name: 'Apple 资格号',
            price_paid: 30,
            total_price: 30,
            item_count: 2,
            discount_code: '',
            created_at: '2026-03-27T10:04:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'bulk-2',
            user_id: 'buyer-bulk',
            site: 'cn',
            snapshot_product_name: 'Apple 资格号',
            price_paid: 30,
            total_price: 30,
            item_count: 2,
            discount_code: '',
            created_at: '2026-03-27T10:05:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'bulk-3',
            user_id: 'buyer-bulk',
            site: 'cn',
            snapshot_product_name: 'Apple 资格号',
            price_paid: 30,
            total_price: 30,
            item_count: 2,
            discount_code: '',
            created_at: '2026-03-27T10:06:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'bulk-4',
            user_id: 'buyer-bulk',
            site: 'cn',
            snapshot_product_name: 'Apple 资格号',
            price_paid: 30,
            total_price: 30,
            item_count: 2,
            discount_code: '',
            created_at: '2026-03-27T10:07:00.000Z',
            refund_status: 'none'
        }
    ], {
        profilesContext: {
            byId: new Map([
                ['buyer-1', { id: 'buyer-1', display_name: 'Alpha', last_login_ip: '203.0.113.88' }],
                ['buyer-2', { id: 'buyer-2', display_name: 'Beta', last_login_ip: '203.0.113.88' }],
                ['buyer-3', { id: 'buyer-3', display_name: 'Gamma', last_login_ip: '203.0.113.88' }],
                ['buyer-bulk', { id: 'buyer-bulk', display_name: 'BulkBuyer', last_login_ip: '198.51.100.30' }]
            ])
        },
        entitlementContext: {
            unlimitedUserIds: new Set()
        },
        loginHistoryContext: {
            latestByUser: new Map([
                ['buyer-1', { user_id: 'buyer-1', ip_address: '203.0.113.88', user_agent: 'Mozilla/5.0 Chrome/124', created_at: '2026-03-27T10:01:00.000Z' }],
                ['buyer-2', { user_id: 'buyer-2', ip_address: '203.0.113.88', user_agent: 'Mozilla/5.0 Chrome/124', created_at: '2026-03-27T10:02:00.000Z' }],
                ['buyer-3', { user_id: 'buyer-3', ip_address: '203.0.113.88', user_agent: 'Mozilla/5.0 Chrome/124', created_at: '2026-03-27T10:03:00.000Z' }]
            ])
        }
    }, normalizeShopOrderRiskMonitorConfig(), {
        now: '2026-03-27T10:10:00.000Z'
    });

    const couponAlert = alerts.find((alert) => alert.payload.signal_type === 'discount_code_spike');
    const velocityAlert = alerts.find((alert) => alert.payload.signal_type === 'user_velocity');
    const topAlert = alerts[0];

    assert.ok(couponAlert);
    assert.ok(velocityAlert);
    assert.equal(typeof topAlert.payload.risk_score, 'number');
    assert.ok(topAlert.payload.risk_score >= 85);
    assert.equal(couponAlert.payload.primary_action, 'disable-coupon');
    assert.equal(couponAlert.payload.discount_code, 'FLASH0');
    assert.match(couponAlert.payload.response_summary, /停用优惠码 FLASH0/);
    assert.equal(velocityAlert.payload.primary_action, 'open-user-ban');
    assert.match(velocityAlert.payload.response_summary, /封禁/);
});

test('runShopOrderRiskSweep enqueues anomaly alerts with stable dedupe', async () => {
    const state = {
        jobs: [],
        orders: [
            {
                id: 'coupon-1',
                user_id: 'buyer-1',
                site: 'cn',
                snapshot_product_name: 'Prompt Pro 年卡',
                price_paid: 0,
                total_price: 19.9,
                item_count: 2,
                discount_code: 'FLASH0',
                discount_amount: 19.9,
                created_at: '2026-03-27T10:00:00.000Z',
                refund_status: 'none'
            },
            {
                id: 'coupon-2',
                user_id: 'buyer-2',
                site: 'cn',
                snapshot_product_name: 'Prompt Pro 年卡',
                price_paid: 0,
                total_price: 19.9,
                item_count: 2,
                discount_code: 'FLASH0',
                discount_amount: 19.9,
                created_at: '2026-03-27T10:01:00.000Z',
                refund_status: 'none'
            },
            {
                id: 'coupon-3',
                user_id: 'buyer-3',
                site: 'intl',
                snapshot_product_name: '卡密周卡',
                price_paid: 0,
                total_price: 9.9,
                item_count: 2,
                discount_code: 'FLASH0',
                discount_amount: 9.9,
                created_at: '2026-03-27T10:02:00.000Z',
                refund_status: 'none'
            },
            {
                id: 'coupon-4',
                user_id: 'buyer-1',
                site: 'cn',
                snapshot_product_name: '卡密周卡',
                price_paid: 0,
                total_price: 9.9,
                item_count: 2,
                discount_code: 'FLASH0',
                discount_amount: 9.9,
                created_at: '2026-03-27T10:03:00.000Z',
                refund_status: 'none'
            },
            {
                id: 'bulk-1',
                user_id: 'buyer-bulk',
                site: 'cn',
                snapshot_product_name: 'Apple 资格号',
                price_paid: 30,
                total_price: 30,
                item_count: 2,
                discount_code: '',
                discount_amount: 0,
                created_at: '2026-03-27T10:04:00.000Z',
                refund_status: 'none'
            },
            {
                id: 'bulk-2',
                user_id: 'buyer-bulk',
                site: 'cn',
                snapshot_product_name: 'Apple 资格号',
                price_paid: 30,
                total_price: 30,
                item_count: 2,
                discount_code: '',
                discount_amount: 0,
                created_at: '2026-03-27T10:05:00.000Z',
                refund_status: 'none'
            },
            {
                id: 'bulk-3',
                user_id: 'buyer-bulk',
                site: 'cn',
                snapshot_product_name: 'Apple 资格号',
                price_paid: 30,
                total_price: 30,
                item_count: 2,
                discount_code: '',
                discount_amount: 0,
                created_at: '2026-03-27T10:06:00.000Z',
                refund_status: 'none'
            },
            {
                id: 'bulk-4',
                user_id: 'buyer-bulk',
                site: 'cn',
                snapshot_product_name: 'Apple 资格号',
                price_paid: 30,
                total_price: 30,
                item_count: 2,
                discount_code: '',
                discount_amount: 0,
                created_at: '2026-03-27T10:07:00.000Z',
                refund_status: 'none'
            }
        ],
        profiles: [
            { id: 'buyer-1', display_name: 'Alpha', last_login_ip: '203.0.113.88' },
            { id: 'buyer-2', display_name: 'Beta', last_login_ip: '203.0.113.88' },
            { id: 'buyer-3', display_name: 'Gamma', last_login_ip: '203.0.113.88' },
            { id: 'buyer-bulk', display_name: 'BulkBuyer', last_login_ip: '198.51.100.30' }
        ],
        loginHistory: [
            { user_id: 'buyer-1', ip_address: '203.0.113.88', user_agent: 'Mozilla/5.0 Chrome/124', created_at: '2026-03-27T10:01:00.000Z', site: 'cn' },
            { user_id: 'buyer-2', ip_address: '203.0.113.88', user_agent: 'Mozilla/5.0 Chrome/124', created_at: '2026-03-27T10:02:00.000Z', site: 'cn' },
            { user_id: 'buyer-3', ip_address: '203.0.113.88', user_agent: 'Mozilla/5.0 Chrome/124', created_at: '2026-03-27T10:03:00.000Z', site: 'intl' },
            { user_id: 'buyer-bulk', ip_address: '198.51.100.30', user_agent: 'Mozilla/5.0 Safari/17', created_at: '2026-03-27T10:04:00.000Z', site: 'cn' }
        ],
        entitlements: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runShopOrderRiskSweep(supabase, {
        runtime,
        now: '2026-03-27T10:10:00.000Z'
    });

    assert.equal(first.anomaly_count, 5);
    assert.equal(first.discount_code_spike_count, 1);
    assert.equal(first.zero_total_cluster_count, 1);
    assert.equal(first.user_velocity_count, 1);
    assert.equal(first.shared_login_ip_cluster_count, 1);
    assert.equal(first.shared_login_signature_cluster_count, 1);
    assert.equal(first.queued, 5);
    assert.equal(first.deduped, 0);
    assert.equal(state.jobs.length, 5);
    assert.equal(state.jobs.every((job) => job.alert_type === 'shop_order_risk_anomaly'), true);
    assert.equal(state.jobs.every((job) => typeof job.payload?.risk_score === 'number'), true);
    assert.equal(state.jobs.every((job) => typeof job.payload?.response_summary === 'string' && job.payload.response_summary.length > 0), true);

    const second = await runShopOrderRiskSweep(supabase, {
        runtime,
        now: '2026-03-27T10:12:00.000Z'
    });

    assert.equal(second.anomaly_count, 5);
    assert.equal(second.queued, 0);
    assert.equal(second.deduped, 5);
    assert.equal(state.jobs.length, 5);
});

test('runShopOrderRiskSweep enqueues recovery notices and writes admin notifications once', async () => {
    const state = {
        jobs: [
            {
                id: 'risk-alert-1',
                alert_type: 'shop_order_risk_anomaly',
                severity: 'critical',
                title: '优惠码高频使用异常（FLASH0）',
                created_at: '2026-03-27T09:50:00.000Z',
                payload: {
                    target_id: 'shop_order_risk:coupon:FLASH0',
                    signal_type: 'discount_code_spike',
                    discount_code: 'FLASH0',
                    risk_score: 94,
                    risk_level: 'critical',
                    primary_action: 'disable-coupon',
                    response_summary: '建议立即停用优惠码 FLASH0，并复核最近命中订单。',
                    order_count: 4,
                    distinct_user_count: 3,
                    zero_total_count: 4,
                    sample_products: ['Prompt Pro 年卡 × 2', '卡密周卡 × 2'],
                    entry_path: '商城管理 -> 订单列表 / 优惠券码'
                }
            }
        ],
        orders: [],
        profiles: [],
        entitlements: [],
        adminRoles: [
            { user_id: 'admin-1', role_name: 'admin', expires_at: null },
            { user_id: 'admin-2', role_name: 'super_admin', expires_at: null }
        ],
        systemNotifications: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runShopOrderRiskSweep(supabase, {
        runtime,
        now: '2026-03-27T10:20:00.000Z'
    });

    assert.equal(first.anomaly_count, 0);
    assert.equal(first.recovered_count, 1);
    assert.equal(first.recovered_queued, 1);
    assert.equal(first.admin_notifications_created, 2);
    assert.equal(state.jobs.length, 2);
    assert.equal(state.jobs[1].alert_type, 'shop_order_risk_recovered');
    assert.deepEqual(state.jobs[1].channels, ['feishu']);
    assert.equal(state.jobs[1].payload.previous_risk_level, 'critical');
    assert.equal(state.jobs[1].payload.previous_primary_action, 'disable-coupon');
    assert.equal(state.systemNotifications.length, 2);
    assert.match(state.systemNotifications[0].title, /风险已恢复/);

    const second = await runShopOrderRiskSweep(supabase, {
        runtime,
        now: '2026-03-27T10:22:00.000Z'
    });

    assert.equal(second.recovered_count, 0);
    assert.equal(second.recovered_queued, 0);
    assert.equal(second.admin_notifications_created, 0);
    assert.equal(state.jobs.length, 2);
    assert.equal(state.systemNotifications.length, 2);
});
