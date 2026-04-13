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
        filters: [],
        order: null,
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
    state.profileRows = Array.isArray(state.profileRows) ? state.profileRows : [];
    state.assetRows = Array.isArray(state.assetRows) ? state.assetRows : [];
    state.eventRows = Array.isArray(state.eventRows) ? state.eventRows : [];
    state.opsAlertJobs = Array.isArray(state.opsAlertJobs) ? state.opsAlertJobs : [];
    state.opsAlertCases = Array.isArray(state.opsAlertCases) ? state.opsAlertCases : [];
    state.opsAlertCaseEvents = Array.isArray(state.opsAlertCaseEvents) ? state.opsAlertCaseEvents : [];
    state.auditLogsView = Array.isArray(state.auditLogsView) ? state.auditLogsView : [];
    state.auditLogs = Array.isArray(state.auditLogs) ? state.auditLogs : [];

    return {
        from(table) {
            return createQueryBuilder((query) => {
                let rows;
                if (table === 'discount_codes') rows = state.discountRows.slice().map(cloneRow);
                else if (table === 'shop_orders') rows = state.orderRows.slice().map(cloneRow);
                else if (table === 'profiles') rows = state.profileRows.slice().map(cloneRow);
                else if (table === 'discount_user_assets') rows = state.assetRows.slice().map(cloneRow);
                else if (table === 'discount_event_logs') rows = state.eventRows.slice().map(cloneRow);
                else if (table === 'ops_alert_jobs') rows = state.opsAlertJobs.slice().map(cloneRow);
                else if (table === 'ops_alert_cases') rows = state.opsAlertCases.slice().map(cloneRow);
                else if (table === 'ops_alert_case_events') rows = state.opsAlertCaseEvents.slice().map(cloneRow);
                else if (table === 'admin_audit_logs_view') rows = state.auditLogsView.slice().map(cloneRow);
                else if (table === 'admin_audit_logs') rows = state.auditLogs.slice().map(cloneRow);
                else throw new Error(`Unexpected table request: ${table}`);

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

                if (query.single) {
                    const first = rows[0] || null;
                    return {
                        data: first,
                        error: first ? null : { status: 406, message: 'Not found' }
                    };
                }

                return {
                    data: rows,
                    error: null
                };
            });
        }
    };
}

async function withDiscountsDetailHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/discounts/detail.js');
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

test('discount detail handler returns recent usage, users, and risk timeline for a coupon', async () => {
    const baseTime = Date.now();
    const discountCreatedAt = offsetIso(baseTime, { days: -12 });
    const asset1AssignedAt = offsetIso(baseTime, { days: -2, hours: -2 });
    const asset2AssignedAt = offsetIso(baseTime, { days: -2, hours: -1, minutes: -30 });
    const order2CreatedAt = offsetIso(baseTime, { days: -2, hours: -1 });
    const order1CreatedAt = offsetIso(baseTime, { days: -2 });
    const alertCreatedAt = offsetIso(baseTime, { days: -2, hours: 1 });
    const caseUpdatedAt = offsetIso(baseTime, { days: -2, hours: 1, minutes: 2 });
    const auditCreatedAt = offsetIso(baseTime, { days: -2, hours: 1, minutes: 5 });

    await withDiscountsDetailHandler({
        discountRows: [
            {
                id: 'discount_cn',
                code: 'FLASH0',
                applicable_site: 'cn',
                discount_type: 'percent',
                discount_value: 80,
                max_uses: 100,
                max_uses_per_user: 1,
                allow_zero_total: false,
                scope_type: 'product',
                scope_product_id: 'prod_1',
                created_at: discountCreatedAt,
                is_active: true,
                used_count: 3,
                starts_at: null,
                expires_at: null,
                lifecycle_status: 'active',
                status_reason: 'manual_active',
                recovery_strategy: 'observation_then_restore',
                observation_window_hours: 24,
                observation_ends_at: null,
                version_no: 2
            }
        ],
        orderRows: [
            {
                id: 'order_1',
                discount_code: 'FLASH0',
                user_id: 'user_1',
                created_at: order1CreatedAt,
                price_paid: 0,
                total_price: 99,
                site: 'cn',
                snapshot_product_name: 'Product A',
                item_count: 1,
                discount_amount: 99,
                refund_status: 'none'
            },
            {
                id: 'order_2',
                discount_code: 'FLASH0',
                user_id: 'user_2',
                created_at: order2CreatedAt,
                price_paid: 50,
                total_price: 99,
                site: 'cn',
                snapshot_product_name: 'Product A',
                item_count: 2,
                discount_amount: 49,
                refund_status: 'refunded',
                discount_version: 2
            }
        ],
        profileRows: [
            { id: 'user_1', username: 'risk-buyer-1', display_name: 'Risk Buyer 1', avatar_url: 'https://img/1.png' },
            { id: 'user_2', username: 'risk-buyer-2', display_name: 'Risk Buyer 2', avatar_url: 'https://img/2.png' }
        ],
        assetRows: [
            {
                id: 'asset_1',
                discount_id: 'discount_cn',
                user_id: 'user_1',
                asset_status: 'used',
                assigned_at: asset1AssignedAt,
                claimed_at: asset1AssignedAt,
                consumed_at: order1CreatedAt,
                source_channel: 'vip_recall',
                audience_segment: 'vip'
            },
            {
                id: 'asset_2',
                discount_id: 'discount_cn',
                user_id: 'user_2',
                asset_status: 'available',
                assigned_at: asset2AssignedAt,
                claimed_at: asset2AssignedAt,
                source_channel: 'cs_compensation',
                audience_segment: 'appeasement'
            }
        ],
        eventRows: [
            {
                id: 'evt_claim_1',
                discount_id: 'discount_cn',
                user_id: 'user_1',
                discount_asset_id: 'asset_1',
                event_type: 'claim',
                site: 'cn',
                source_channel: 'vip_recall',
                event_source: 'shop_claim_center',
                audience_segment: 'vip',
                created_at: asset1AssignedAt
            },
            {
                id: 'evt_apply_1',
                discount_id: 'discount_cn',
                user_id: 'user_1',
                discount_asset_id: 'asset_1',
                event_type: 'apply_attempt',
                site: 'cn',
                source_channel: 'vip_recall',
                event_source: 'shop_apply_discount',
                audience_segment: 'vip',
                created_at: offsetIso(baseTime, { days: -2, hours: -1, minutes: -1 })
            }
        ],
        opsAlertJobs: [
            {
                id: 'job_1',
                alert_type: 'shop_order_risk_anomaly',
                severity: 'critical',
                title: '优惠码高频使用异常（FLASH0）',
                content: '优惠码 FLASH0 在最近 30 分钟内被高频使用。\n0 价订单：1 笔',
                payload: {
                    target_id: 'shop_order_risk:coupon:FLASH0',
                    signal_type: 'discount_code_spike',
                    discount_code: 'FLASH0',
                    risk_level: 'critical',
                    risk_score: 97,
                    auto_response_action: 'disable-coupon',
                    auto_response_status: 'applied',
                    auto_response_summary: '系统已自动停用优惠码 FLASH0，请继续复核最近命中订单与关联账号。'
                },
                created_at: alertCreatedAt
            }
        ],
        opsAlertCases: [
            {
                category_key: 'shop_risk',
                target_id: 'shop_order_risk:coupon:FLASH0',
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
                id: 'evt_1',
                category_key: 'shop_risk',
                target_id: 'shop_order_risk:coupon:FLASH0',
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
        auditLogsView: [
            {
                id: 'audit_1',
                action_type: 'discount.code.toggle',
                details: {
                    discount_id: 'discount_cn',
                    code: 'FLASH0',
                    previous_active: false,
                    next_active: true,
                    review_note: '已人工复核最近命中订单与账号，确认活动配置正常，现恢复该优惠码。',
                    risk_reviewed: true,
                    resolve_case_requested: true,
                    operation_source: 'risk_restore_modal'
                },
                created_at: auditCreatedAt,
                admin_id: 'admin_1',
                admin_email: 'ops@example.com'
            }
        ]
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin/discounts/detail?id=discount_cn&site=cn'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.discount.code, 'FLASH0');
        assert.equal(payload.discount.lifecycle_summary.key, 'active');
        assert.equal(payload.discount.usage_summary.recent_order_count, 2);
        assert.equal(payload.discount.usage_summary.recent_net_order_count, 1);
        assert.equal(payload.discount.usage_summary.recent_refund_count, 1);
        assert.equal(payload.discount.usage_summary.recent_zero_total_count, 1);
        assert.equal(payload.discount.usage_summary.recent_revenue_gross, 50);
        assert.equal(payload.discount.usage_summary.recent_revenue_net, 0);
        assert.equal(payload.discount.usage_summary.new_customer_order_count, 1);
        assert.equal(payload.discount.asset_summary.issued_count, 2);
        assert.equal(payload.discount.funnel_summary.length > 0, true);
        assert.equal(payload.discount.segment_summary.source_channels[0].label, 'vip_recall');
        assert.equal(payload.discount.risk_summary.has_recent_alert, true);
        assert.equal(payload.discount.risk_summary.case_status, 'claimed');
        assert.equal(payload.discount.risk_summary.case_owner_label, 'ops@example.com');
        assert.equal(payload.recent_orders.length, 2);
        assert.equal(payload.recent_orders[0].user_label, 'Risk Buyer 1');
        assert.equal(payload.recent_orders[0].is_zero_total_risk, true);
        assert.equal(payload.recent_orders[1].discount_version, 2);
        assert.equal(payload.recent_users.length, 2);
        assert.equal(payload.recent_users[0].usage_count, 1);
        assert.equal(payload.recent_assets.length, 2);
        assert.equal(payload.risk_timeline.length, 3);
        assert.equal(payload.risk_timeline[0].is_restore_action, true);
        assert.equal(payload.risk_timeline[0].title, '恢复启用优惠券');
        assert.match(payload.risk_timeline[0].summary, /复核结论/);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'discounts.manage' });
    });
});

test('discount detail handler hides discounts outside the current site view', async () => {
    await withDiscountsDetailHandler({
        discountRows: [
            {
                id: 'discount_intl',
                code: 'INTL50',
                applicable_site: 'intl',
                created_at: '2026-04-01T08:00:00.000Z'
            }
        ]
    }, async ({ handler }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin/discounts/detail?id=discount_intl&site=cn'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 404);
        assert.equal(payload.success, false);
        assert.match(payload.message, /当前站点视图/);
    });
});

test('discount detail handler rejects non-GET methods', async () => {
    await withDiscountsDetailHandler({}, async ({ handler }) => {
        const req = { method: 'POST', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
