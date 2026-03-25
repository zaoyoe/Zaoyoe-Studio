const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');

const DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 10 * 60 * 1000,
    lookback_days: 14,
    retry_waiting_min_attempts: 2,
    dedupe_window_minutes: 30,
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

function normalizeShopOrderDeliveryMonitorConfig(rawConfig = {}, env = process.env) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    return {
        enabled: normalizeBoolean(
            source.enabled,
            normalizeBoolean(env?.SHOP_ORDER_DELIVERY_MONITOR_ENABLED, DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG.enabled)
        ),
        sweep_interval_ms: normalizeNumber(
            source.sweep_interval_ms,
            normalizeNumber(env?.SHOP_ORDER_DELIVERY_MONITOR_SWEEP_INTERVAL_MS, DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG.sweep_interval_ms, 10000, 60 * 60 * 1000),
            10000,
            60 * 60 * 1000
        ),
        lookback_days: normalizeNumber(
            source.lookback_days,
            normalizeNumber(env?.SHOP_ORDER_DELIVERY_MONITOR_LOOKBACK_DAYS, DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG.lookback_days, 1, 90),
            1,
            90
        ),
        retry_waiting_min_attempts: normalizeNumber(
            source.retry_waiting_min_attempts,
            normalizeNumber(env?.SHOP_ORDER_DELIVERY_MONITOR_RETRY_WAITING_MIN_ATTEMPTS, DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG.retry_waiting_min_attempts, 1, 50),
            1,
            50
        ),
        dedupe_window_minutes: normalizeNumber(
            source.dedupe_window_minutes,
            normalizeNumber(env?.SHOP_ORDER_DELIVERY_MONITOR_DEDUPE_WINDOW_MINUTES, DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG.dedupe_window_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        page_size: normalizeNumber(
            source.page_size,
            normalizeNumber(env?.SHOP_ORDER_DELIVERY_MONITOR_PAGE_SIZE, DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG.page_size, 50, 5000),
            50,
            5000
        ),
        max_pages: normalizeNumber(
            source.max_pages,
            normalizeNumber(env?.SHOP_ORDER_DELIVERY_MONITOR_MAX_PAGES, DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG.max_pages, 1, 100),
            1,
            100
        )
    };
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

async function fetchRecentShopOrders(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('shop_orders')
        .select('id, user_id, snapshot_product_name, price_paid, total_price, item_count, delivery_status, delivery_attempt_count, delivery_last_error, delivery_updated_at, created_at, refund_status')
        .gte('created_at', sinceIso)
        .order('delivery_updated_at', { ascending: false }), config.page_size, config.max_pages);
}

function getDeliveryStatus(value) {
    return normalizeText(value).toLowerCase();
}

function getRefundStatus(value) {
    return normalizeText(value).toLowerCase();
}

function getDeliveryStatusLabel(value) {
    const normalized = getDeliveryStatus(value);
    if (!normalized) return '';

    const labelMap = {
        pending: '待发货',
        processing: '处理中',
        retry_waiting: '重试中',
        requeued: '已重排队',
        dead_letter: '死信待处理',
        delivered: '已发货'
    };

    return labelMap[normalized] || normalized;
}

function getRefundStatusLabel(value) {
    const normalized = getRefundStatus(value);
    if (!normalized) return '';

    const labelMap = {
        none: '正常',
        no_refund: '正常',
        refunded: '已退款',
        full_refund: '已全额退款',
        partial_refund: '部分退款',
        refund_pending: '退款处理中'
    };

    return labelMap[normalized] || normalized;
}

function shouldSkipRefundedOrder(order = {}) {
    const refundStatus = getRefundStatus(order.refund_status);
    return refundStatus === 'refunded' || refundStatus === 'full_refund';
}

function shouldAlertForOrder(order = {}, config = {}) {
    if (shouldSkipRefundedOrder(order)) {
        return false;
    }

    const deliveryStatus = getDeliveryStatus(order.delivery_status);
    const attemptCount = Math.max(0, Math.round(Number(order.delivery_attempt_count || 0)));

    if (deliveryStatus === 'dead_letter') {
        return true;
    }

    if (
        deliveryStatus === 'retry_waiting'
        && attemptCount >= Number(config.retry_waiting_min_attempts || DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG.retry_waiting_min_attempts)
        && normalizeText(order.delivery_last_error)
    ) {
        return true;
    }

    return false;
}

function formatCurrency(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? `${amount.toFixed(2)} 元` : '';
}

function formatItemCount(value) {
    return `${Math.max(1, Math.round(Number(value || 1)))} 件`;
}

function buildShopOrderDeliveryFailedAlerts(orders = [], rawConfig = {}, options = {}) {
    const config = normalizeShopOrderDeliveryMonitorConfig(rawConfig);
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());

    return (orders || [])
        .map((order) => {
            if (!shouldAlertForOrder(order, config)) {
                return null;
            }

            const orderId = normalizeText(order.id);
            if (!orderId) {
                return null;
            }

            const deliveryStatus = getDeliveryStatus(order.delivery_status);
            const deliveryStatusLabel = getDeliveryStatusLabel(deliveryStatus);
            const attemptCount = Math.max(0, Math.round(Number(order.delivery_attempt_count || 0)));
            const productName = normalizeText(order.snapshot_product_name) || '未命名商品';
            const userId = normalizeText(order.user_id);
            const priceLabel = formatCurrency(order.total_price ?? order.price_paid);
            const createdAt = normalizeText(order.created_at);
            const updatedAt = normalizeText(order.delivery_updated_at);
            const refundStatus = getRefundStatus(order.refund_status);
            const refundStatusLabel = getRefundStatusLabel(refundStatus);
            const shortOrderId = orderId.slice(0, 8);
            const severity = deliveryStatus === 'dead_letter' ? 'critical' : 'warning';
            const title = deliveryStatus === 'dead_letter'
                ? `商城履约失败（${shortOrderId}）`
                : `商城履约异常重试（${shortOrderId}）`;
            const lines = [
                deliveryStatus === 'dead_letter'
                    ? `订单 ${shortOrderId} 已进入履约死信队列，需要人工处理。`
                    : `订单 ${shortOrderId} 已连续履约失败 ${attemptCount} 次，当前仍在重试队列。`,
                `订单号：${orderId}`,
                `商品：${productName}`
            ];

            if (userId) {
                lines.push(`用户ID：${userId}`);
            }
            lines.push(`购买数量：${formatItemCount(order.item_count)}`);
            if (priceLabel) {
                lines.push(`订单金额：${priceLabel}`);
            }
            if (deliveryStatusLabel) {
                lines.push(`履约状态：${deliveryStatusLabel}`);
            }
            lines.push(`失败次数：${attemptCount}`);
            if (refundStatusLabel) {
                lines.push(`退款状态：${refundStatusLabel}`);
            }
            if (normalizeText(order.delivery_last_error)) {
                lines.push(`最近错误：${normalizeText(order.delivery_last_error)}`);
            }
            if (createdAt) {
                lines.push(`下单时间：${createdAt}`);
            }
            if (updatedAt) {
                lines.push(`最近履约更新时间：${updatedAt}`);
            }
            lines.push('处理入口：商城管理 -> 履约任务 / 异常订单');

            return {
                alertType: 'shop_order_delivery_failed',
                severity,
                title,
                content: lines.join('\n'),
                payload: {
                    target_id: orderId,
                    order_id: orderId,
                    user_id: userId || null,
                    product_name: productName,
                    item_count: Math.max(1, Math.round(Number(order.item_count || 1))),
                    total_price: Number.isFinite(Number(order.total_price)) ? Number(order.total_price) : null,
                    price_paid: Number.isFinite(Number(order.price_paid)) ? Number(order.price_paid) : null,
                    delivery_status: deliveryStatus || null,
                    delivery_status_label: deliveryStatusLabel || null,
                    delivery_attempt_count: attemptCount,
                    delivery_last_error: normalizeText(order.delivery_last_error) || null,
                    refund_status: refundStatus || null,
                    refund_status_label: refundStatusLabel || null,
                    created_at: createdAt || null,
                    delivery_updated_at: updatedAt || null,
                    detected_at: nowDate.toISOString(),
                    entry_path: '商城管理 -> 履约任务 / 异常订单'
                },
                dedupeKey: crypto
                    .createHash('sha256')
                    .update(`shop_order_delivery_failed:${orderId}:${deliveryStatus}`)
                    .digest('hex'),
                dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG.dedupe_window_minutes)
            };
        })
        .filter(Boolean);
}

async function runShopOrderDeliveryFailedSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const config = normalizeShopOrderDeliveryMonitorConfig(options.config, env);

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            failure_count: 0,
            dead_letter_count: 0,
            retry_waiting_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    if (!runtime?.config?.enabled) {
        return {
            skipped: 'ops_alerts_disabled',
            failure_count: 0,
            dead_letter_count: 0,
            retry_waiting_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const sinceIso = new Date(nowDate.getTime() - Number(config.lookback_days || DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG.lookback_days) * 24 * 60 * 60 * 1000).toISOString();
    const orders = await fetchRecentShopOrders(supabase, sinceIso, config);
    const alerts = buildShopOrderDeliveryFailedAlerts(orders, config, { now: nowDate });

    let queued = 0;
    let deduped = 0;
    let skippedNoChannels = 0;
    const results = [];

    for (const alert of alerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            source: 'shop_delivery_monitor'
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
            order_id: alert.payload?.order_id || null,
            severity: alert.severity,
            queued: result?.queued === true,
            reason: result?.reason || null
        });
    }

    return {
        failure_count: alerts.length,
        dead_letter_count: alerts.filter((alert) => normalizeText(alert.payload?.delivery_status).toLowerCase() === 'dead_letter').length,
        retry_waiting_count: alerts.filter((alert) => normalizeText(alert.payload?.delivery_status).toLowerCase() === 'retry_waiting').length,
        queued,
        deduped,
        skipped_no_channels: skippedNoChannels,
        results
    };
}

module.exports = {
    DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG,
    buildShopOrderDeliveryFailedAlerts,
    normalizeShopOrderDeliveryMonitorConfig,
    runShopOrderDeliveryFailedSweep
};
