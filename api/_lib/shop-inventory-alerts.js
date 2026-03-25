const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');
const {
    notifyActiveAdmins
} = require('./admin-notifications');

const DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 15 * 60 * 1000,
    low_stock_threshold: 5,
    sales_window_days: 7,
    state_lookback_minutes: 24 * 60,
    dedupe_window_minutes: 6 * 60,
    page_size: 500,
    max_pages: 10
});
const SHOP_INVENTORY_STATE_TYPES = Object.freeze([
    'shop_inventory_low',
    'shop_inventory_empty',
    'shop_inventory_recovered'
]);

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
}

function normalizeNumber(value, fallback = 0, min = null, max = null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    let next = parsed;
    if (Number.isFinite(min)) next = Math.max(min, next);
    if (Number.isFinite(max)) next = Math.min(max, next);
    return next;
}

function normalizeShopInventoryMonitorConfig(rawConfig = {}, env = process.env) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    return {
        enabled: normalizeBoolean(
            source.enabled,
            normalizeBoolean(env?.SHOP_INVENTORY_MONITOR_ENABLED, DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.enabled)
        ),
        sweep_interval_ms: normalizeNumber(
            source.sweep_interval_ms,
            normalizeNumber(env?.SHOP_INVENTORY_MONITOR_SWEEP_INTERVAL_MS, DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.sweep_interval_ms, 10000, 60 * 60 * 1000),
            10000,
            60 * 60 * 1000
        ),
        low_stock_threshold: normalizeNumber(
            source.low_stock_threshold,
            normalizeNumber(env?.SHOP_INVENTORY_MONITOR_LOW_STOCK_THRESHOLD, DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.low_stock_threshold, 0, 10000),
            0,
            10000
        ),
        sales_window_days: normalizeNumber(
            source.sales_window_days,
            normalizeNumber(env?.SHOP_INVENTORY_MONITOR_SALES_WINDOW_DAYS, DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.sales_window_days, 1, 30),
            1,
            30
        ),
        state_lookback_minutes: normalizeNumber(
            source.state_lookback_minutes,
            normalizeNumber(env?.SHOP_INVENTORY_MONITOR_STATE_LOOKBACK_MINUTES, DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.state_lookback_minutes, 30, 7 * 24 * 60),
            30,
            7 * 24 * 60
        ),
        dedupe_window_minutes: normalizeNumber(
            source.dedupe_window_minutes,
            normalizeNumber(env?.SHOP_INVENTORY_MONITOR_DEDUPE_WINDOW_MINUTES, DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.dedupe_window_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        page_size: normalizeNumber(
            source.page_size,
            normalizeNumber(env?.SHOP_INVENTORY_MONITOR_PAGE_SIZE, DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.page_size, 50, 5000),
            50,
            5000
        ),
        max_pages: normalizeNumber(
            source.max_pages,
            normalizeNumber(env?.SHOP_INVENTORY_MONITOR_MAX_PAGES, DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.max_pages, 1, 100),
            1,
            100
        )
    };
}

function normalizeDeliveryType(value) {
    const normalized = normalizeText(value).toUpperCase();
    return normalized === 'API' ? 'API' : 'KEY';
}

function formatCount(value) {
    return `${Math.max(0, Math.round(Number(value || 0)))} 件`;
}

function formatSiteSalesWindow(days) {
    return `近 ${Math.max(1, Math.round(Number(days || DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.sales_window_days)))} 天`;
}

function getInventoryTargetId(value = {}) {
    if (!value || typeof value !== 'object') {
        return '';
    }

    if (normalizeText(value.target_id)) {
        return normalizeText(value.target_id);
    }

    return normalizeText(value.product_id || value.id);
}

function compareCreatedAtDescending(left = {}, right = {}) {
    const leftTime = Date.parse(normalizeText(left.created_at));
    const rightTime = Date.parse(normalizeText(right.created_at));
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

function getLatestInventoryStateJob(stateJobs = [], alertType, targetId = '') {
    const normalizedType = normalizeText(alertType).toLowerCase();
    const normalizedTargetId = normalizeText(targetId);
    return (stateJobs || [])
        .filter((job) => normalizeText(job.alert_type).toLowerCase() === normalizedType)
        .filter((job) => !normalizedTargetId || getInventoryTargetId(job.payload) === normalizedTargetId)
        .sort(compareCreatedAtDescending)[0] || null;
}

async function fetchPagedRows(buildQuery, pageSize = 500, maxPages = 10) {
    const rows = [];

    for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await buildQuery().range(from, to);

        if (error) {
            throw error;
        }

        const batch = Array.isArray(data) ? data : [];
        rows.push(...batch);

        if (batch.length < pageSize) {
            break;
        }
    }

    return rows;
}

async function fetchActiveInventoryProducts(client, config) {
    const rows = await fetchPagedRows(() => client
        .from('shop_products')
        .select('id, name, category, stock_count, is_active, delivery_type, updated_at')
        .eq('is_active', true)
        .order('stock_count', { ascending: true }), config.page_size, config.max_pages);

    return rows.filter((row) => normalizeDeliveryType(row?.delivery_type) === 'KEY');
}

async function fetchRecentShopOrders(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('shop_orders')
        .select('id, product_id, item_count, refund_status, delivery_status, created_at')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchRecentInventoryStateJobs(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('ops_alert_jobs')
        .select('id, alert_type, severity, title, payload, created_at')
        .in('alert_type', SHOP_INVENTORY_STATE_TYPES)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchProductsByIds(client, productIds = [], config = {}) {
    const normalizedIds = Array.from(new Set((productIds || []).map((productId) => normalizeText(productId)).filter(Boolean)));
    if (!normalizedIds.length) {
        return [];
    }

    const chunkSize = Math.max(1, Math.min(Number(config.page_size || DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.page_size), 200));
    const rows = [];

    for (let index = 0; index < normalizedIds.length; index += chunkSize) {
        const batch = normalizedIds.slice(index, index + chunkSize);
        const { data, error } = await client
            .from('shop_products')
            .select('id, name, category, stock_count, is_active, delivery_type, updated_at')
            .in('id', batch);

        if (error) {
            throw error;
        }

        rows.push(...(Array.isArray(data) ? data : []));
    }

    return rows;
}

function shouldCountOrderTowardsSales(order = {}) {
    const refundStatus = normalizeText(order.refund_status).toLowerCase();
    return refundStatus !== 'refunded' && refundStatus !== 'full_refund';
}

function buildRecentSalesMap(orders = []) {
    const salesMap = new Map();

    for (const order of orders) {
        if (!shouldCountOrderTowardsSales(order)) continue;
        const productId = normalizeText(order.product_id);
        if (!productId) continue;
        const quantity = Math.max(1, Math.round(Number(order.item_count || 1)));
        salesMap.set(productId, Number(salesMap.get(productId) || 0) + quantity);
    }

    return salesMap;
}

function buildShopInventoryLowAlerts(products = [], recentOrders = [], rawConfig = {}, options = {}) {
    const config = normalizeShopInventoryMonitorConfig(rawConfig);
    const salesMap = buildRecentSalesMap(recentOrders);

    return (products || [])
        .map((product) => {
            const productId = normalizeText(product?.id);
            if (!productId) {
                return null;
            }

            if (normalizeDeliveryType(product?.delivery_type) !== 'KEY') {
                return null;
            }

            const stockCount = Math.max(0, Math.round(Number(product?.stock_count || 0)));
            const threshold = Number(config.low_stock_threshold || 0);
            if (stockCount > threshold) {
                return null;
            }

            const productName = normalizeText(product?.name) || '未命名商品';
            const category = normalizeText(product?.category);
            const recentSalesCount = Math.max(0, Math.round(Number(salesMap.get(productId) || 0)));
            const isEmpty = stockCount <= 0;
            const alertType = isEmpty ? 'shop_inventory_empty' : 'shop_inventory_low';
            const severity = isEmpty ? 'critical' : 'warning';
            const title = isEmpty
                ? `${productName} 已售罄`
                : `${productName} 库存不足`;
            const lines = [
                isEmpty
                    ? `${productName} 当前已无可售库存，请尽快补货。`
                    : `${productName} 当前库存仅剩 ${formatCount(stockCount)}，已低于阈值 ${formatCount(threshold)}。`,
                `最近销量：${formatSiteSalesWindow(config.sales_window_days)}售出 ${formatCount(recentSalesCount)}`,
                '处理入口：商城管理 -> 商品列表 -> 库存 / 补货'
            ];

            if (category) {
                lines.splice(1, 0, `商品分类：${category}`);
            }

            return {
                alertType,
                severity,
                title,
                content: lines.join('\n'),
                payload: {
                    target_id: productId,
                    product_id: productId,
                    product_name: productName,
                    category: category || null,
                    stock_count: stockCount,
                    low_stock_threshold: threshold,
                    recent_sales_days: Number(config.sales_window_days || DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.sales_window_days),
                    recent_sales_count: recentSalesCount,
                    delivery_type: 'KEY',
                    updated_at: normalizeText(product?.updated_at) || null,
                    entry_path: '商城管理 -> 商品列表 -> 库存 / 补货'
                },
                dedupeKey: crypto
                    .createHash('sha256')
                    .update(`${alertType}:${productId}`)
                    .digest('hex'),
                dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.dedupe_window_minutes)
            };
        })
        .filter(Boolean);
}

function buildShopInventoryRecoveredAlerts(products = [], recentOrders = [], stateJobs = [], rawConfig = {}, options = {}) {
    const config = normalizeShopInventoryMonitorConfig(rawConfig);
    const activeAlerts = buildShopInventoryLowAlerts(products, recentOrders, config, options);
    const activeTargetIds = new Set(activeAlerts.map((alert) => getInventoryTargetId(alert.payload)));
    const stateTargetIds = Array.from(new Set(
        (stateJobs || [])
            .filter((job) => ['shop_inventory_low', 'shop_inventory_empty'].includes(normalizeText(job.alert_type).toLowerCase()))
            .map((job) => getInventoryTargetId(job.payload))
            .filter(Boolean)
    ));
    const productsById = new Map((products || []).map((product) => [normalizeText(product.id), product]));
    const salesMap = buildRecentSalesMap(recentOrders);
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());

    return stateTargetIds.map((targetId) => {
        const latestLow = getLatestInventoryStateJob(stateJobs, 'shop_inventory_low', targetId);
        const latestEmpty = getLatestInventoryStateJob(stateJobs, 'shop_inventory_empty', targetId);
        const latestAlert = [latestLow, latestEmpty].filter(Boolean).sort(compareCreatedAtDescending)[0] || null;
        if (!latestAlert) {
            return null;
        }

        const latestRecovered = getLatestInventoryStateJob(stateJobs, 'shop_inventory_recovered', targetId);
        const latestAlertAt = Date.parse(normalizeText(latestAlert.created_at));
        const latestRecoveredAt = Date.parse(normalizeText(latestRecovered?.created_at));
        if (Number.isFinite(latestAlertAt) && Number.isFinite(latestRecoveredAt) && latestRecoveredAt >= latestAlertAt) {
            return null;
        }
        if (activeTargetIds.has(targetId)) {
            return null;
        }

        const currentProduct = productsById.get(targetId);
        if (!currentProduct) {
            return null;
        }
        if (normalizeDeliveryType(currentProduct.delivery_type) !== 'KEY' || currentProduct.is_active !== true) {
            return null;
        }

        const stockCount = Math.max(0, Math.round(Number(currentProduct.stock_count || 0)));
        const threshold = Number(config.low_stock_threshold || 0);
        if (stockCount <= threshold) {
            return null;
        }

        const alertPayload = latestAlert.payload && typeof latestAlert.payload === 'object' ? latestAlert.payload : {};
        const productName = normalizeText(currentProduct.name || alertPayload.product_name) || '未命名商品';
        const category = normalizeText(currentProduct.category || alertPayload.category);
        const recentSalesCount = Math.max(0, Math.round(Number(salesMap.get(targetId) || 0)));
        const incidentRecoveredAt = nowDate.toISOString();
        const incidentDurationMinutes = Number.isFinite(latestAlertAt)
            ? Math.max(0, Math.round((nowDate.getTime() - latestAlertAt) / 60000))
            : 0;
        const previousStockCount = Math.max(0, Math.round(Number(alertPayload.stock_count || 0)));
        const recoverySummary = previousStockCount <= 0
            ? `商品已完成补货，库存恢复到 ${formatCount(stockCount)}`
            : `商品库存已高于阈值，当前可售库存 ${formatCount(stockCount)}`;
        const lines = [
            `${productName} 已退出库存预警状态，可从补货应急切回日常观察。`,
            `恢复结论：${recoverySummary}`
        ];

        if (category) {
            lines.push(`分类：${category}`);
        }
        lines.push(`当前库存：${formatCount(stockCount)}（阈值 ${formatCount(threshold)}）`);
        if (Number.isFinite(Number(alertPayload.stock_count))) {
            lines.push(`上次告警库存：${formatCount(previousStockCount)}`);
        }
        lines.push(`近 ${Math.max(1, Math.round(Number(config.sales_window_days || DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.sales_window_days)))} 天销量：${formatCount(recentSalesCount)}`);
        if (normalizeText(latestAlert.created_at)) {
            lines.push(`上次告警：${normalizeText(latestAlert.created_at)}`);
        }
        if (normalizeText(currentProduct.updated_at)) {
            lines.push(`最近更新时间：${normalizeText(currentProduct.updated_at)}`);
        }
        lines.push(`恢复时间：${incidentRecoveredAt}`);
        lines.push(`持续时长：${Math.max(0, Math.round(incidentDurationMinutes))} 分钟`);
        lines.push('处理入口：商城管理 -> 商品列表 -> 库存 / 补货');

        return {
            alertType: 'shop_inventory_recovered',
            severity: 'warning',
            title: `${productName} 库存已恢复`,
            content: lines.join('\n'),
            payload: {
                target_id: targetId,
                product_id: targetId,
                product_name: productName,
                category: category || null,
                stock_count: stockCount,
                low_stock_threshold: threshold,
                recent_sales_days: Number(config.sales_window_days || DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.sales_window_days),
                recent_sales_count: recentSalesCount,
                previous_alert_type: normalizeText(latestAlert.alert_type).toLowerCase(),
                previous_stock_count: previousStockCount,
                incident_alert_job_id: normalizeText(latestAlert.id) || null,
                incident_started_at: normalizeText(latestAlert.created_at) || null,
                incident_recovered_at: incidentRecoveredAt,
                incident_duration_minutes: incidentDurationMinutes,
                recovery_summary: recoverySummary,
                delivery_type: 'KEY',
                updated_at: normalizeText(currentProduct.updated_at) || null,
                entry_path: '商城管理 -> 商品列表 -> 库存 / 补货'
            },
            allowedChannels: ['feishu'],
            dedupeKey: crypto
                .createHash('sha256')
                .update(`shop_inventory_recovered:${targetId}:${normalizeText(latestAlert.id) || normalizeText(latestAlert.created_at) || 'unknown'}`)
                .digest('hex'),
            dedupeWindowMinutes: Math.max(
                Number(config.dedupe_window_minutes || DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.dedupe_window_minutes),
                60
            )
        };
    }).filter(Boolean);
}

async function runShopInventoryLowSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const config = normalizeShopInventoryMonitorConfig(options.config, env);

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            low_stock_count: 0,
            empty_stock_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    if (!runtime?.config?.enabled) {
        return {
            skipped: 'ops_alerts_disabled',
            low_stock_count: 0,
            empty_stock_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const sinceIso = new Date(nowDate.getTime() - Number(config.sales_window_days || DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.sales_window_days) * 24 * 60 * 60 * 1000).toISOString();
    const stateSinceIso = new Date(nowDate.getTime() - Number(config.state_lookback_minutes || DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG.state_lookback_minutes) * 60 * 1000).toISOString();
    const [products, recentOrders, stateJobs] = await Promise.all([
        fetchActiveInventoryProducts(supabase, config),
        fetchRecentShopOrders(supabase, sinceIso, config),
        fetchRecentInventoryStateJobs(supabase, stateSinceIso, config)
    ]);
    const alerts = buildShopInventoryLowAlerts(products, recentOrders, config, { now: nowDate });
    const trackedProductIds = Array.from(new Set(
        (stateJobs || [])
            .filter((job) => ['shop_inventory_low', 'shop_inventory_empty'].includes(normalizeText(job.alert_type).toLowerCase()))
            .map((job) => getInventoryTargetId(job.payload))
            .filter(Boolean)
    ));
    const trackedProducts = await fetchProductsByIds(supabase, trackedProductIds, config);
    const recoveryAlerts = buildShopInventoryRecoveredAlerts(trackedProducts, recentOrders, stateJobs, config, { now: nowDate });

    let queued = 0;
    let deduped = 0;
    let skippedNoChannels = 0;
    let recoveredQueued = 0;
    let recoveredDeduped = 0;
    let recoveredSkippedNoChannels = 0;
    let adminNotificationsCreated = 0;
    let adminNotificationsSkipped = 0;
    const results = [];

    for (const alert of alerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            source: 'shop_inventory_monitor'
        }, {
            runtime,
            env
        });

        if (result?.queued === true) {
            queued += 1;
        } else if (result?.reason === 'deduped') {
            deduped += 1;
        } else if (result?.reason === 'no_active_channels') {
            skippedNoChannels += 1;
        }

        results.push({
            product_id: alert.payload?.product_id || null,
            alert_type: alert.alertType,
            severity: alert.severity,
            queued: result?.queued === true,
            reason: result?.reason || null
        });
    }

    for (const alert of recoveryAlerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            createdAt: nowDate.toISOString(),
            source: 'shop_inventory_monitor'
        }, {
            runtime,
            env
        });

        if (result?.queued === true) {
            recoveredQueued += 1;
        } else if (result?.reason === 'deduped') {
            recoveredDeduped += 1;
        } else if (result?.reason === 'no_active_channels') {
            recoveredSkippedNoChannels += 1;
        }

        const adminNotificationResult = await notifyActiveAdmins(supabase, {
            title: alert.title,
            content: alert.content,
            type: 'success',
            dedupeWindowMinutes: Math.max(Number(alert.dedupeWindowMinutes || 0), 60)
        }).catch((error) => ({
            error: error.message || 'notify_failed'
        }));

        adminNotificationsCreated += Number(adminNotificationResult?.created || 0);
        adminNotificationsSkipped += Number(adminNotificationResult?.skipped || 0);

        results.push({
            product_id: alert.payload?.product_id || null,
            alert_type: alert.alertType,
            severity: alert.severity,
            queued: result?.queued === true,
            reason: result?.reason || null,
            admin_notification_created: Number(adminNotificationResult?.created || 0),
            admin_notification_error: normalizeText(adminNotificationResult?.error) || null
        });
    }

    return {
        low_stock_count: alerts.filter((item) => item.alertType === 'shop_inventory_low').length,
        empty_stock_count: alerts.filter((item) => item.alertType === 'shop_inventory_empty').length,
        recovered_count: recoveryAlerts.length,
        queued,
        deduped,
        recovered_queued: recoveredQueued,
        recovered_deduped: recoveredDeduped,
        skipped_no_channels: skippedNoChannels,
        recovered_skipped_no_channels: recoveredSkippedNoChannels,
        admin_notifications_created: adminNotificationsCreated,
        admin_notifications_skipped: adminNotificationsSkipped,
        state_job_count: stateJobs.length,
        results
    };
}

module.exports = {
    DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG,
    SHOP_INVENTORY_STATE_TYPES,
    buildShopInventoryLowAlerts,
    buildShopInventoryRecoveredAlerts,
    normalizeShopInventoryMonitorConfig,
    runShopInventoryLowSweep,
    __testUtils: {
        buildRecentSalesMap,
        compareCreatedAtDescending,
        fetchActiveInventoryProducts,
        fetchRecentShopOrders,
        getInventoryTargetId,
        getLatestInventoryStateJob,
        shouldCountOrderTowardsSales
    }
};
