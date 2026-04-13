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

function createQueryBuilder(executor) {
    const state = {
        order: null,
        filters: [],
        range: null
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
            state.filters.push({ op: 'in', column, values: Array.isArray(values) ? values.slice() : [] });
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
        range(from, to) {
            state.range = { from, to };
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

function cloneRow(row) {
    return JSON.parse(JSON.stringify(row));
}

function offsetIso(baseTime, { days = 0, hours = 0, minutes = 0 } = {}) {
    const totalMinutes = (((days * 24) + hours) * 60) + minutes;
    return new Date(baseTime + totalMinutes * 60 * 1000).toISOString();
}

function applyFilters(rows, filters = []) {
    return rows.filter((row) => filters.every((filter) => {
        if (filter.op === 'eq') {
            return row[filter.column] === filter.value;
        }

        if (filter.op === 'in') {
            return filter.values.includes(row[filter.column]);
        }

        if (filter.op === 'gte') {
            const rowTime = Date.parse(row[filter.column] || '');
            const filterTime = Date.parse(filter.value || '');
            if (!Number.isFinite(filterTime)) return true;
            return Number.isFinite(rowTime) ? rowTime >= filterTime : false;
        }

        return true;
    }));
}

function createSupabaseStub(state) {
    state.discountRows = Array.isArray(state.discountRows) ? state.discountRows : [];
    state.orderRows = Array.isArray(state.orderRows) ? state.orderRows : [];
    state.assetRows = Array.isArray(state.assetRows) ? state.assetRows : [];
    state.opsAlertJobs = Array.isArray(state.opsAlertJobs) ? state.opsAlertJobs : [];
    state.opsAlertCases = Array.isArray(state.opsAlertCases) ? state.opsAlertCases : [];
    state.opsAlertCaseEvents = Array.isArray(state.opsAlertCaseEvents) ? state.opsAlertCaseEvents : [];

    return {
        from(table) {
            return createQueryBuilder((query) => {
                let rows;
                if (table === 'discount_codes') {
                    rows = state.discountRows.slice().map((row) => cloneRow(row));
                } else if (table === 'shop_orders') {
                    rows = state.orderRows.slice().map((row) => cloneRow(row));
                } else if (table === 'discount_user_assets') {
                    rows = state.assetRows.slice().map((row) => cloneRow(row));
                } else if (table === 'ops_alert_jobs') {
                    rows = state.opsAlertJobs.slice().map((row) => cloneRow(row));
                } else if (table === 'ops_alert_cases') {
                    rows = state.opsAlertCases.slice().map((row) => cloneRow(row));
                } else if (table === 'ops_alert_case_events') {
                    rows = state.opsAlertCaseEvents.slice().map((row) => cloneRow(row));
                } else {
                    throw new Error(`Unexpected table request: ${table}`);
                }

                rows = applyFilters(rows, query.filters);
                if (query.order?.column) {
                    const { column, ascending } = query.order;
                    rows.sort((left, right) => {
                        const leftValue = Date.parse(left[column] || '') || 0;
                        const rightValue = Date.parse(right[column] || '') || 0;
                        return ascending ? leftValue - rightValue : rightValue - leftValue;
                    });
                }

                if (query.range) {
                    rows = rows.slice(query.range.from, query.range.to + 1);
                }

                return {
                    data: rows,
                    error: null
                };
            });
        }
    };
}

async function withDiscountsListHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/discounts/list.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        ...initialState
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite: adminLib.normalizeAdminSite,
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    return {
                        supabase: createSupabaseStub(state),
                        user: { id: 'admin_1' }
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
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

test('discounts list handler returns site-specific and global discount codes in site view', async () => {
    const baseTime = Date.now();
    const orderPrevUser1At = offsetIso(baseTime, { days: -23 });
    const orderPrevUser2At = offsetIso(baseTime, { days: -22 });
    const orderPrevUser3At = offsetIso(baseTime, { days: -21, hours: -1 });
    const orderGlobalCnAt = offsetIso(baseTime, { days: -4, hours: -2 });
    const orderGlobalIntlAt = offsetIso(baseTime, { days: -4, hours: -1 });
    const orderCnOlderAt = offsetIso(baseTime, { days: -2, hours: -1 });
    const orderCnLatestAt = offsetIso(baseTime, { days: -2 });
    const alertCreatedAt = offsetIso(baseTime, { days: -2, hours: 1 });
    const caseUpdatedAt = offsetIso(baseTime, { days: -2, hours: 1, minutes: 3 });
    const assetAssignedAt = offsetIso(baseTime, { days: -2, hours: -2 });

    await withDiscountsListHandler({
        discountRows: [
            {
                id: 'discount_cn',
                code: 'CNSITE',
                applicable_site: 'cn',
                created_at: offsetIso(baseTime, { days: -9 }),
                is_active: true,
                starts_at: null,
                expires_at: null,
                lifecycle_status: 'active',
                status_reason: 'manual_active',
                recovery_strategy: 'manual_only',
                observation_window_hours: 24,
                used_count: 2
            },
            {
                id: 'discount_global',
                code: 'ALLSITE',
                applicable_site: null,
                created_at: offsetIso(baseTime, { days: -9, hours: -1 }),
                is_active: true,
                starts_at: '2099-01-01T00:00:00.000Z',
                expires_at: null,
                lifecycle_status: 'scheduled',
                status_reason: 'scheduled_start',
                recovery_strategy: 'manual_only',
                observation_window_hours: 24,
                used_count: 0
            },
            {
                id: 'discount_intl',
                code: 'INTLSITE',
                applicable_site: 'intl',
                created_at: offsetIso(baseTime, { days: -9, hours: -2 }),
                is_active: false,
                starts_at: null,
                expires_at: null,
                lifecycle_status: 'paused_risk',
                status_reason: 'risk_auto_pause',
                recovery_strategy: 'auto_restore',
                observation_window_hours: 24,
                used_count: 0
            }
        ],
        orderRows: [
            {
                id: 'order_prev_user_1',
                discount_code: null,
                user_id: 'user_1',
                created_at: orderPrevUser1At,
                price_paid: 45,
                total_price: 45,
                site: 'cn',
                snapshot_product_name: 'Earlier CN Product',
                refund_status: 'none',
                discount_amount: 0
            },
            {
                id: 'order_prev_user_2',
                discount_code: null,
                user_id: 'user_2',
                created_at: orderPrevUser2At,
                price_paid: 65,
                total_price: 65,
                site: 'cn',
                snapshot_product_name: 'Earlier CN Product',
                refund_status: 'none',
                discount_amount: 0
            },
            {
                id: 'order_prev_user_3',
                discount_code: null,
                user_id: 'user_3',
                created_at: orderPrevUser3At,
                price_paid: 80,
                total_price: 80,
                site: 'cn',
                snapshot_product_name: 'Earlier Global Product',
                refund_status: 'none',
                discount_amount: 0
            },
            {
                discount_code: 'CNSITE',
                user_id: 'user_1',
                created_at: orderCnOlderAt,
                price_paid: 0,
                total_price: 99,
                site: 'cn',
                snapshot_product_name: 'CN Product'
            },
            {
                discount_code: 'CNSITE',
                user_id: 'user_2',
                created_at: orderCnLatestAt,
                price_paid: 66,
                total_price: 99,
                site: 'cn',
                snapshot_product_name: 'CN Product',
                refund_status: 'refunded',
                discount_amount: 33
            },
            {
                discount_code: 'ALLSITE',
                user_id: 'user_3',
                created_at: orderGlobalCnAt,
                price_paid: 80,
                total_price: 100,
                site: 'cn',
                snapshot_product_name: 'Global Product',
                refund_status: 'none',
                discount_amount: 20
            },
            {
                discount_code: 'ALLSITE',
                user_id: 'user_9',
                created_at: orderGlobalIntlAt,
                price_paid: 70,
                total_price: 100,
                site: 'intl',
                snapshot_product_name: 'Global Product'
            }
        ],
        opsAlertJobs: [
            {
                id: 'job_coupon_risk',
                alert_type: 'shop_order_risk_anomaly',
                severity: 'critical',
                title: '优惠码高频使用异常（CNSITE）',
                content: '优惠码 CNSITE 在最近 30 分钟内被高频使用。\n0 价订单：1 笔',
                payload: {
                    target_id: 'shop_order_risk:coupon:CNSITE',
                    signal_type: 'discount_code_spike',
                    discount_code: 'CNSITE',
                    risk_level: 'critical',
                    risk_score: 96,
                    auto_response_action: 'disable-coupon',
                    auto_response_status: 'applied',
                    auto_response_summary: '系统已自动停用优惠码 CNSITE，请继续复核最近命中订单与关联账号。'
                },
                created_at: alertCreatedAt
            }
        ],
        opsAlertCases: [
            {
                category_key: 'shop_risk',
                target_id: 'shop_order_risk:coupon:CNSITE',
                alert_type: 'shop_order_risk_anomaly',
                status: 'claimed',
                owner_admin_id: 'admin_1',
                owner_label: 'ops@example.com',
                note: '已接手排查',
                resolution: null,
                metadata: {},
                last_action: 'claimed',
                last_action_at: caseUpdatedAt,
                updated_at: caseUpdatedAt
            }
        ],
        opsAlertCaseEvents: [
            {
                id: 'event_coupon_risk',
                category_key: 'shop_risk',
                target_id: 'shop_order_risk:coupon:CNSITE',
                alert_type: 'shop_order_risk_anomaly',
                action: 'claim',
                status: 'claimed',
                owner_admin_id: 'admin_1',
                owner_label: 'ops@example.com',
                actor_admin_id: 'admin_1',
                actor_label: 'ops@example.com',
                note: '已接手排查',
                resolution: null,
                metadata: {},
                created_at: caseUpdatedAt
            }
        ],
        assetRows: [
            {
                id: 'asset_1',
                discount_id: 'discount_cn',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: assetAssignedAt,
                claimed_at: assetAssignedAt
            }
        ]
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            adminSite: 'cn'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'cn');
        assert.deepEqual(payload.rows.map((row) => row.id), ['discount_cn', 'discount_global']);
        assert.equal(payload.usage_window_days, 30);
        assert.deepEqual(payload.scope_summary, {
            mode: 'site_plus_global',
            site: 'cn',
            other_site: 'intl',
            visible_count: 2,
            global_count: 1,
            site_specific_count: 1,
            other_site_count: 1
        });
        assert.deepEqual(payload.rows[0].usage_summary, {
            window_days: 30,
            recent_order_count: 2,
            recent_net_order_count: 1,
            recent_refund_count: 1,
            recent_distinct_user_count: 2,
            recent_zero_total_count: 1,
            last_used_at: orderCnLatestAt,
            top_product_names: ['CN Product'],
            recent_discount_cost_gross: 33,
            recent_discount_cost_net: 0,
            recent_revenue_gross: 66,
            recent_revenue_net: 0,
            new_customer_order_count: 0
        });
        assert.equal(payload.rows[0].asset_summary.issued_count, 1);
        assert.equal(payload.rows[0].lifecycle_summary.key, 'active');
        assert.equal(payload.rows[0].risk_summary.has_recent_alert, true);
        assert.equal(payload.rows[0].risk_summary.latest_alert_state, 'problem');
        assert.equal(payload.rows[0].risk_summary.risk_score, 96);
        assert.equal(payload.rows[0].risk_summary.auto_response_status, 'applied');
        assert.match(payload.rows[0].risk_summary.auto_response_summary, /CNSITE/);
        assert.equal(payload.rows[0].risk_summary.case_status, 'claimed');
        assert.equal(payload.rows[0].risk_summary.case_owner_label, 'ops@example.com');
        assert.deepEqual(payload.rows[1].usage_summary, {
            window_days: 30,
            recent_order_count: 1,
            recent_net_order_count: 1,
            recent_refund_count: 0,
            recent_distinct_user_count: 1,
            recent_zero_total_count: 0,
            last_used_at: orderGlobalCnAt,
            top_product_names: ['Global Product'],
            recent_discount_cost_gross: 20,
            recent_discount_cost_net: 20,
            recent_revenue_gross: 80,
            recent_revenue_net: 80,
            new_customer_order_count: 0
        });
        assert.equal(payload.rows[1].lifecycle_summary.key, 'scheduled');
        assert.equal(payload.rows[1].risk_summary.has_recent_alert, false);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'discounts.manage' });
    });
});

test('discounts list handler keeps aggregate counts in all-site view', async () => {
    await withDiscountsListHandler({
        discountRows: [
            {
                id: 'discount_cn',
                code: 'CNSITE',
                applicable_site: 'cn',
                created_at: '2026-04-03T10:00:00.000Z',
                is_active: true,
                used_count: 0
            },
            {
                id: 'discount_global',
                code: 'ALLSITE',
                applicable_site: null,
                created_at: '2026-04-03T09:00:00.000Z',
                is_active: true,
                used_count: 0
            },
            {
                id: 'discount_intl',
                code: 'INTLSITE',
                applicable_site: 'intl',
                created_at: '2026-04-03T08:00:00.000Z',
                is_active: false,
                lifecycle_status: 'paused_risk',
                status_reason: 'risk_auto_pause',
                used_count: 0
            }
        ],
        orderRows: [
            {
                id: 'order_prev_user_intl',
                discount_code: null,
                user_id: 'user_intl',
                created_at: '2026-03-18T08:00:00.000Z',
                price_paid: 55,
                total_price: 55,
                site: 'intl',
                snapshot_product_name: 'Earlier INTL Product',
                refund_status: 'none',
                discount_amount: 0
            },
            {
                discount_code: 'INTLSITE',
                user_id: 'user_intl',
                created_at: '2026-04-06T08:00:00.000Z',
                price_paid: 50,
                total_price: 70,
                site: 'intl',
                snapshot_product_name: 'INTL Product',
                refund_status: 'none',
                discount_amount: 20
            }
        ]
    }, async ({ handler }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin/discounts/list?site=all'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'all');
        assert.deepEqual(payload.rows.map((row) => row.id), ['discount_cn', 'discount_global', 'discount_intl']);
        assert.deepEqual(payload.rows[2].usage_summary, {
            window_days: 30,
            recent_order_count: 1,
            recent_net_order_count: 1,
            recent_refund_count: 0,
            recent_distinct_user_count: 1,
            recent_zero_total_count: 0,
            last_used_at: '2026-04-06T08:00:00.000Z',
            top_product_names: ['INTL Product'],
            recent_discount_cost_gross: 20,
            recent_discount_cost_net: 20,
            recent_revenue_gross: 50,
            recent_revenue_net: 50,
            new_customer_order_count: 0
        });
        assert.equal(payload.rows[2].lifecycle_summary.key, 'paused_risk');
        assert.deepEqual(payload.scope_summary, {
            mode: 'aggregate',
            visible_count: 3,
            global_count: 1,
            cn_count: 1,
            intl_count: 1
        });
    });
});

test('discounts list handler rejects non-GET methods', async () => {
    await withDiscountsListHandler({}, async ({ handler }) => {
        const req = { method: 'POST', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
