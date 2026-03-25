const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');

const DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 15 * 60 * 1000,
    low_stock_threshold: 5,
    sales_window_days: 7,
    dedupe_window_minutes: 6 * 60,
    page_size: 500,
    max_pages: 10
});

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
    const [products, recentOrders] = await Promise.all([
        fetchActiveInventoryProducts(supabase, config),
        fetchRecentShopOrders(supabase, sinceIso, config)
    ]);
    const alerts = buildShopInventoryLowAlerts(products, recentOrders, config, { now: nowDate });

    let queued = 0;
    let deduped = 0;
    let skippedNoChannels = 0;
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

    return {
        low_stock_count: alerts.filter((item) => item.alertType === 'shop_inventory_low').length,
        empty_stock_count: alerts.filter((item) => item.alertType === 'shop_inventory_empty').length,
        queued,
        deduped,
        skipped_no_channels: skippedNoChannels,
        results
    };
}

module.exports = {
    DEFAULT_SHOP_INVENTORY_MONITOR_CONFIG,
    buildShopInventoryLowAlerts,
    normalizeShopInventoryMonitorConfig,
    runShopInventoryLowSweep,
    __testUtils: {
        buildRecentSalesMap,
        fetchActiveInventoryProducts,
        fetchRecentShopOrders,
        shouldCountOrderTowardsSales
    }
};
