const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildShopInventoryLowAlerts,
    buildShopInventoryRecoveredAlerts,
    normalizeShopInventoryMonitorConfig,
    runShopInventoryLowSweep
} = require('../api/_lib/shop-inventory-alerts');

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        order: null,
        payload: null,
        range: null,
        single: false,
        maybeSingle: false
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
            state.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [] });
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
        update(payload) {
            state.mode = 'update';
            state.payload = payload;
            return builder;
        },
        single() {
            state.single = true;
            return builder;
        },
        maybeSingle() {
            state.single = true;
            state.maybeSingle = true;
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
        if (op === 'in') return Array.isArray(value) && value.includes(row[column]);
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
    const products = state.products || [];
    const orders = state.orders || [];
    const adminRoles = state.adminRoles || [];
    const systemNotifications = state.systemNotifications || [];

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'shop_products' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(products, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'shop_orders' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(orders, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'ops_alert_jobs' && query.mode === 'select') {
                    const rows = applyRange(sortRows(applyFilters(jobs, query.filters), query.order), query.range);
                    return {
                        data: query.single ? (rows[0] || null) : rows,
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

                if (table === 'ops_alert_jobs' && query.mode === 'update') {
                    const rows = applyRange(sortRows(applyFilters(jobs, query.filters), query.order), query.range);
                    rows.forEach((row) => {
                        Object.assign(row, query.payload || {});
                    });

                    return {
                        data: query.single ? (rows[0] || null) : rows,
                        error: rows.length ? null : { message: 'Job not found' }
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
            },
            shop_inventory: {
                enabled: true,
                low_stock_threshold: 5,
                sweep_interval_ms: 15 * 60 * 1000,
                sales_window_days: 7,
                dedupe_window_minutes: 6 * 60,
                recovery_notification_enabled: true
            }
        }),
        secrets: {
            telegram_bot_token: 'telegram-token',
            feishu_webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo'
        }
    };
}

test('buildShopInventoryLowAlerts flags low stock and sold-out key products with recent sales context', () => {
    const alerts = buildShopInventoryLowAlerts([
        {
            id: 'product-low',
            name: 'Prompt Pro 月卡',
            category: '提示词',
            stock_count: 3,
            delivery_type: 'KEY'
        },
        {
            id: 'product-empty',
            name: '账号季卡',
            category: '账号',
            stock_count: 0,
            delivery_type: null
        },
        {
            id: 'product-api',
            name: 'API 自动发货商品',
            category: '接口',
            stock_count: 0,
            delivery_type: 'API'
        }
    ], [
        {
            id: 'order-1',
            product_id: 'product-low',
            item_count: 2,
            refund_status: 'none',
            created_at: '2026-03-25T09:00:00.000Z'
        },
        {
            id: 'order-2',
            product_id: 'product-empty',
            item_count: 5,
            refund_status: 'none',
            created_at: '2026-03-24T09:00:00.000Z'
        },
        {
            id: 'order-3',
            product_id: 'product-empty',
            item_count: 1,
            refund_status: 'full_refund',
            created_at: '2026-03-24T10:00:00.000Z'
        }
    ], normalizeShopInventoryMonitorConfig());

    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].alertType, 'shop_inventory_low');
    assert.equal(alerts[0].payload.recent_sales_count, 2);
    assert.match(alerts[0].content, /最近销量：近 7 天售出 2 件/);
    assert.equal(alerts[1].alertType, 'shop_inventory_empty');
    assert.equal(alerts[1].severity, 'critical');
    assert.equal(alerts[1].payload.recent_sales_count, 5);
});

test('runShopInventoryLowSweep enqueues key-product low stock alerts with stable dedupe', async () => {
    const state = {
        jobs: [],
        products: [
            {
                id: 'product-low',
                name: 'Prompt Pro 月卡',
                category: '提示词',
                stock_count: 3,
                is_active: true,
                delivery_type: 'KEY',
                updated_at: '2026-03-25T09:00:00.000Z'
            },
            {
                id: 'product-api',
                name: '接口自动发货',
                category: '接口',
                stock_count: 0,
                is_active: true,
                delivery_type: 'API',
                updated_at: '2026-03-25T09:00:00.000Z'
            }
        ],
        orders: [
            {
                id: 'order-1',
                product_id: 'product-low',
                item_count: 6,
                refund_status: 'none',
                created_at: '2026-03-24T09:00:00.000Z'
            }
        ]
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runShopInventoryLowSweep(supabase, {
        runtime,
        now: '2026-03-25T10:00:00.000Z'
    });

    assert.equal(first.low_stock_count, 1);
    assert.equal(first.empty_stock_count, 0);
    assert.equal(first.queued, 1);
    assert.equal(first.deduped, 0);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'shop_inventory_low');
    assert.equal(state.jobs[0].payload.recent_sales_count, 6);
    assert.equal(state.jobs[0].payload.product_name, 'Prompt Pro 月卡');

    const second = await runShopInventoryLowSweep(supabase, {
        runtime,
        now: '2026-03-25T10:05:00.000Z'
    });

    assert.equal(second.low_stock_count, 1);
    assert.equal(second.queued, 0);
    assert.equal(second.deduped, 1);
    assert.equal(state.jobs.length, 1);
});

test('runShopInventoryLowSweep sends the first inventory alert immediately and keeps hourly summaries for follow-up', async () => {
    const state = {
        jobs: [],
        products: [
            {
                id: 'product-empty',
                name: 'gemini',
                category: '账号',
                stock_count: 0,
                is_active: true,
                delivery_type: 'KEY',
                updated_at: '2026-03-29T01:10:00.000Z'
            }
        ],
        orders: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = {
        ...createOpsRuntime(),
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
            },
            shop_inventory: {
                enabled: true,
                low_stock_threshold: 5,
                sweep_interval_ms: 15 * 60 * 1000,
                sales_window_days: 7,
                dedupe_window_minutes: 60,
                recovery_notification_enabled: true,
                summary_enabled: true,
                summary_schedule_mode: 'hourly',
                summary_window_minutes: 60,
                summary_hourly_minute: 0,
                summary_max_items: 10
            }
        })
    };

    const first = await runShopInventoryLowSweep(supabase, {
        runtime,
        now: '2026-03-29T01:15:00.000Z'
    });

    assert.equal(first.empty_stock_count, 1);
    assert.equal(first.queued, 1);
    assert.equal(first.summary_queued, 1);
    assert.equal(state.jobs.length, 2);
    assert.equal(state.jobs[0].alert_type, 'shop_inventory_empty');
    assert.equal(state.jobs[1].alert_type, 'shop_inventory_summary');
    assert.equal(state.jobs[1].payload.item_count, 1);

    const second = await runShopInventoryLowSweep(supabase, {
        runtime,
        now: '2026-03-29T01:35:00.000Z'
    });

    assert.equal(second.empty_stock_count, 1);
    assert.equal(second.queued, 0);
    assert.equal(second.summary_queued, 0);
    assert.equal(second.summary_deduped, 1);
    assert.equal(state.jobs.length, 2);

    const third = await runShopInventoryLowSweep(supabase, {
        runtime,
        now: '2026-03-29T02:10:00.000Z'
    });

    assert.equal(third.empty_stock_count, 1);
    assert.equal(third.queued, 0);
    assert.equal(third.summary_queued, 1);
    assert.equal(state.jobs.length, 3);
    assert.equal(state.jobs[2].alert_type, 'shop_inventory_summary');
    assert.equal(state.jobs[2].payload.item_count, 1);
});

test('buildShopInventoryRecoveredAlerts emits a recovery notice after a product is replenished', () => {
    const alerts = buildShopInventoryRecoveredAlerts([
        {
            id: 'product-low',
            name: 'Prompt Pro 月卡',
            category: '提示词',
            stock_count: 18,
            is_active: true,
            delivery_type: 'KEY',
            updated_at: '2026-03-25T10:54:00.000Z'
        }
    ], [
        {
            id: 'order-1',
            product_id: 'product-low',
            item_count: 12,
            refund_status: 'none',
            created_at: '2026-03-24T09:00:00.000Z'
        }
    ], [
        {
            id: 'inventory-low-1',
            alert_type: 'shop_inventory_low',
            severity: 'warning',
            title: 'Prompt Pro 月卡 库存不足',
            created_at: '2026-03-25T10:00:00.000Z',
            payload: {
                target_id: 'product-low',
                product_id: 'product-low',
                product_name: 'Prompt Pro 月卡',
                stock_count: 3,
                low_stock_threshold: 5
            }
        }
    ], normalizeShopInventoryMonitorConfig(), {
        now: '2026-03-25T10:54:00.000Z'
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'shop_inventory_recovered');
    assert.equal(alerts[0].severity, 'warning');
    assert.deepEqual(alerts[0].allowedChannels, ['feishu']);
    assert.match(alerts[0].content, /恢复结论：商品库存已高于阈值，当前可售库存 18 件/);
    assert.equal(alerts[0].payload.incident_alert_job_id, 'inventory-low-1');
    assert.equal(alerts[0].payload.previous_stock_count, 3);
    assert.equal(alerts[0].payload.incident_duration_minutes, 54);
});

test('buildShopInventoryRecoveredAlerts respects recovery notification switch', () => {
    const alerts = buildShopInventoryRecoveredAlerts([
        {
            id: 'product-low',
            name: 'Prompt Pro 月卡',
            category: '提示词',
            stock_count: 18,
            is_active: true,
            delivery_type: 'KEY',
            updated_at: '2026-03-25T10:54:00.000Z'
        }
    ], [], [
        {
            id: 'inventory-low-1',
            alert_type: 'shop_inventory_low',
            severity: 'warning',
            title: 'Prompt Pro 月卡 库存不足',
            created_at: '2026-03-25T10:00:00.000Z',
            payload: {
                target_id: 'product-low',
                product_id: 'product-low',
                product_name: 'Prompt Pro 月卡',
                stock_count: 3,
                low_stock_threshold: 5
            }
        }
    ], {
        recovery_notification_enabled: false
    }, {
        now: '2026-03-25T10:54:00.000Z'
    });

    assert.equal(alerts.length, 0);
});

test('runShopInventoryLowSweep enqueues recovery notices and writes admin notifications once', async () => {
    const state = {
        jobs: [
            {
                id: 'inventory-low-1',
                alert_type: 'shop_inventory_low',
                severity: 'warning',
                title: 'Prompt Pro 月卡 库存不足',
                created_at: '2026-03-25T10:00:00.000Z',
                payload: {
                    target_id: 'product-low',
                    product_id: 'product-low',
                    product_name: 'Prompt Pro 月卡',
                    stock_count: 3,
                    low_stock_threshold: 5
                }
            }
        ],
        products: [
            {
                id: 'product-low',
                name: 'Prompt Pro 月卡',
                category: '提示词',
                stock_count: 18,
                is_active: true,
                delivery_type: 'KEY',
                updated_at: '2026-03-25T10:54:00.000Z'
            }
        ],
        orders: [
            {
                id: 'order-1',
                product_id: 'product-low',
                item_count: 12,
                refund_status: 'none',
                created_at: '2026-03-24T09:00:00.000Z'
            }
        ],
        adminRoles: [
            { user_id: 'admin-1', role_name: 'admin', expires_at: null },
            { user_id: 'admin-2', role_name: 'super_admin', expires_at: null }
        ],
        systemNotifications: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runShopInventoryLowSweep(supabase, {
        runtime,
        now: '2026-03-25T10:54:00.000Z'
    });

    assert.equal(first.low_stock_count, 0);
    assert.equal(first.empty_stock_count, 0);
    assert.equal(first.recovered_count, 1);
    assert.equal(first.recovered_queued, 1);
    assert.equal(first.admin_notifications_created, 2);
    assert.equal(state.jobs.length, 2);
    assert.equal(state.jobs[1].alert_type, 'shop_inventory_recovered');
    assert.deepEqual(state.jobs[1].channels, ['feishu']);
    assert.equal(state.systemNotifications.length, 2);
    assert.match(state.systemNotifications[0].title, /库存已恢复/);

    const second = await runShopInventoryLowSweep(supabase, {
        runtime,
        now: '2026-03-25T10:55:00.000Z'
    });

    assert.equal(second.recovered_count, 0);
    assert.equal(second.recovered_queued, 0);
    assert.equal(second.admin_notifications_created, 0);
    assert.equal(state.jobs.length, 2);
    assert.equal(state.systemNotifications.length, 2);
});

test('runShopInventoryLowSweep prefers runtime inventory config and can disable recovery notifications', async () => {
    const state = {
        jobs: [
            {
                id: 'inventory-low-1',
                alert_type: 'shop_inventory_low',
                severity: 'warning',
                title: 'Prompt Pro 月卡 库存不足',
                created_at: '2026-03-25T10:00:00.000Z',
                payload: {
                    target_id: 'product-low',
                    product_id: 'product-low',
                    product_name: 'Prompt Pro 月卡',
                    stock_count: 4,
                    low_stock_threshold: 8
                }
            }
        ],
        products: [
            {
                id: 'product-low',
                name: 'Prompt Pro 月卡',
                category: '提示词',
                stock_count: 12,
                is_active: true,
                delivery_type: 'KEY',
                updated_at: '2026-03-25T10:54:00.000Z'
            }
        ],
        orders: [],
        adminRoles: [
            { user_id: 'admin-1', role_name: 'admin', expires_at: null }
        ],
        systemNotifications: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = {
        ...createOpsRuntime(),
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
            },
            shop_inventory: {
                enabled: true,
                low_stock_threshold: 8,
                sweep_interval_ms: 20 * 60 * 1000,
                sales_window_days: 5,
                dedupe_window_minutes: 180,
                recovery_notification_enabled: false
            }
        })
    };

    const result = await runShopInventoryLowSweep(supabase, {
        runtime,
        now: '2026-03-25T10:54:00.000Z'
    });

    assert.equal(result.recovered_count, 0);
    assert.equal(result.recovered_queued, 0);
    assert.equal(result.admin_notifications_created, 0);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.systemNotifications.length, 0);
});
