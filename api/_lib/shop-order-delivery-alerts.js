const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');
const {
    notifyActiveAdmins
} = require('./admin-notifications');

const DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 10 * 60 * 1000,
    lookback_days: 14,
    state_lookback_minutes: 24 * 60,
    retry_waiting_min_attempts: 2,
    dedupe_window_minutes: 30,
    page_size: 500,
    max_pages: 10
});
const SHOP_ORDER_DELIVERY_STATE_TYPES = Object.freeze([
    'shop_order_delivery_failed',
    'shop_order_delivery_recovered'
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
        state_lookback_minutes: normalizeNumber(
            source.state_lookback_minutes,
            normalizeNumber(env?.SHOP_ORDER_DELIVERY_MONITOR_STATE_LOOKBACK_MINUTES, DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG.state_lookback_minutes, 30, 7 * 24 * 60),
            30,
            7 * 24 * 60
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

async function fetchRecentShopOrderDeliveryStateJobs(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('ops_alert_jobs')
        .select('id, alert_type, severity, title, payload, created_at')
        .in('alert_type', SHOP_ORDER_DELIVERY_STATE_TYPES)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchOrdersByIds(client, orderIds = [], config = {}) {
    const normalizedIds = Array.from(new Set((orderIds || []).map((orderId) => normalizeText(orderId)).filter(Boolean)));
    if (!normalizedIds.length) {
        return [];
    }

    const chunkSize = Math.max(1, Math.min(Number(config.page_size || DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG.page_size), 200));
    const rows = [];

    for (let index = 0; index < normalizedIds.length; index += chunkSize) {
        const batch = normalizedIds.slice(index, index + chunkSize);
        const { data, error } = await client
            .from('shop_orders')
            .select('id, user_id, snapshot_product_name, price_paid, total_price, item_count, delivery_status, delivery_attempt_count, delivery_last_error, delivery_updated_at, created_at, refund_status')
            .in('id', batch);

        if (error) {
            throw error;
        }

        rows.push(...(Array.isArray(data) ? data : []));
    }

    return rows;
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

function isRecoveredOrderState(order = {}) {
    const deliveryStatus = getDeliveryStatus(order.delivery_status);
    const refundStatus = getRefundStatus(order.refund_status);
    return deliveryStatus === 'delivered'
        || refundStatus === 'refunded'
        || refundStatus === 'full_refund';
}

function getOrderTargetId(value = {}) {
    if (!value || typeof value !== 'object') {
        return '';
    }

    if (normalizeText(value.target_id)) {
        return normalizeText(value.target_id);
    }

    return normalizeText(value.order_id || value.id);
}

function compareCreatedAtDescending(left = {}, right = {}) {
    const leftTime = Date.parse(normalizeText(left.created_at));
    const rightTime = Date.parse(normalizeText(right.created_at));
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

function getLatestShopOrderDeliveryStateJob(stateJobs = [], alertType, targetId = '') {
    const normalizedType = normalizeText(alertType).toLowerCase();
    const normalizedTargetId = normalizeText(targetId);
    return (stateJobs || [])
        .filter((job) => normalizeText(job.alert_type).toLowerCase() === normalizedType)
        .filter((job) => !normalizedTargetId || getOrderTargetId(job.payload) === normalizedTargetId)
        .sort(compareCreatedAtDescending)[0] || null;
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

function buildShopOrderDeliveryRecoveredAlerts(orders = [], stateJobs = [], rawConfig = {}, options = {}) {
    const config = normalizeShopOrderDeliveryMonitorConfig(rawConfig);
    const activeAlerts = buildShopOrderDeliveryFailedAlerts(orders, config, options);
    const activeTargetIds = new Set(activeAlerts.map((alert) => getOrderTargetId(alert.payload)));
    const stateTargetIds = Array.from(new Set(
        (stateJobs || [])
            .filter((job) => normalizeText(job.alert_type).toLowerCase() === 'shop_order_delivery_failed')
            .map((job) => getOrderTargetId(job.payload))
            .filter(Boolean)
    ));
    const ordersById = new Map((orders || []).map((order) => [normalizeText(order.id), order]));
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());

    return stateTargetIds.map((targetId) => {
        const latestFailed = getLatestShopOrderDeliveryStateJob(stateJobs, 'shop_order_delivery_failed', targetId);
        if (!latestFailed) {
            return null;
        }

        const latestRecovered = getLatestShopOrderDeliveryStateJob(stateJobs, 'shop_order_delivery_recovered', targetId);
        const latestFailedAt = Date.parse(normalizeText(latestFailed.created_at));
        const latestRecoveredAt = Date.parse(normalizeText(latestRecovered?.created_at));
        if (Number.isFinite(latestFailedAt) && Number.isFinite(latestRecoveredAt) && latestRecoveredAt >= latestFailedAt) {
            return null;
        }
        if (activeTargetIds.has(targetId)) {
            return null;
        }

        const currentOrder = ordersById.get(targetId);
        if (!currentOrder) {
            return null;
        }
        if (shouldAlertForOrder(currentOrder, config) || !isRecoveredOrderState(currentOrder)) {
            return null;
        }

        const failedPayload = latestFailed.payload && typeof latestFailed.payload === 'object' ? latestFailed.payload : {};
        const orderId = normalizeText(currentOrder.id || targetId);
        const shortOrderId = orderId.slice(0, 8) || 'unknown';
        const deliveryStatus = getDeliveryStatus(currentOrder.delivery_status);
        const deliveryStatusLabel = getDeliveryStatusLabel(deliveryStatus);
        const refundStatus = getRefundStatus(currentOrder.refund_status);
        const refundStatusLabel = getRefundStatusLabel(refundStatus);
        const productName = normalizeText(currentOrder.snapshot_product_name || failedPayload.product_name) || '未命名商品';
        const userId = normalizeText(currentOrder.user_id || failedPayload.user_id);
        const priceLabel = formatCurrency(currentOrder.total_price ?? currentOrder.price_paid ?? failedPayload.total_price ?? failedPayload.price_paid);
        const createdAt = normalizeText(currentOrder.created_at || failedPayload.created_at);
        const updatedAt = normalizeText(currentOrder.delivery_updated_at || failedPayload.delivery_updated_at);
        const incidentRecoveredAt = nowDate.toISOString();
        const incidentDurationMinutes = Number.isFinite(latestFailedAt)
            ? Math.max(0, Math.round((nowDate.getTime() - latestFailedAt) / 60000))
            : 0;
        const previousStatusLabel = normalizeText(failedPayload.delivery_status_label) || getDeliveryStatusLabel(failedPayload.delivery_status);
        const previousAttemptCount = Math.max(0, Math.round(Number(failedPayload.delivery_attempt_count || 0)));
        const recoverySummary = deliveryStatus === 'delivered'
            ? '订单已成功履约，已退出履约异常状态'
            : '订单已退款关闭，已退出履约异常状态';
        const lines = [
            `订单 ${shortOrderId} 已退出履约异常状态，可从应急处理切回日常观察。`,
            `恢复结论：${recoverySummary}`,
            `订单号：${orderId}`,
            `商品：${productName}`
        ];

        if (userId) {
            lines.push(`用户ID：${userId}`);
        }
        lines.push(`购买数量：${formatItemCount(currentOrder.item_count || failedPayload.item_count)}`);
        if (priceLabel) {
            lines.push(`订单金额：${priceLabel}`);
        }
        if (previousStatusLabel) {
            lines.push(`上次异常状态：${previousStatusLabel}`);
        }
        if (previousAttemptCount > 0) {
            lines.push(`上次失败次数：${previousAttemptCount}`);
        }
        if (deliveryStatusLabel) {
            lines.push(`当前履约状态：${deliveryStatusLabel}`);
        }
        if (refundStatusLabel) {
            lines.push(`退款状态：${refundStatusLabel}`);
        }
        if (normalizeText(latestFailed.created_at)) {
            lines.push(`上次异常：${normalizeText(latestFailed.created_at)}`);
        }
        if (updatedAt) {
            lines.push(`最近履约更新时间：${updatedAt}`);
        }
        lines.push(`恢复时间：${incidentRecoveredAt}`);
        lines.push(`持续时长：${Math.max(0, Math.round(incidentDurationMinutes))} 分钟`);
        if (normalizeText(failedPayload.delivery_last_error)) {
            lines.push(`上次错误：${normalizeText(failedPayload.delivery_last_error)}`);
        }
        lines.push('处理入口：商城管理 -> 履约任务 / 异常订单');

        return {
            alertType: 'shop_order_delivery_recovered',
            severity: 'warning',
            title: `商城履约已恢复（${shortOrderId}）`,
            content: lines.join('\n'),
            payload: {
                target_id: orderId,
                order_id: orderId,
                user_id: userId || null,
                product_name: productName,
                item_count: Math.max(1, Math.round(Number(currentOrder.item_count || failedPayload.item_count || 1))),
                total_price: Number.isFinite(Number(currentOrder.total_price)) ? Number(currentOrder.total_price) : (Number.isFinite(Number(failedPayload.total_price)) ? Number(failedPayload.total_price) : null),
                price_paid: Number.isFinite(Number(currentOrder.price_paid)) ? Number(currentOrder.price_paid) : (Number.isFinite(Number(failedPayload.price_paid)) ? Number(failedPayload.price_paid) : null),
                previous_delivery_status: normalizeText(failedPayload.delivery_status).toLowerCase() || null,
                previous_delivery_status_label: previousStatusLabel || null,
                previous_delivery_attempt_count: previousAttemptCount,
                previous_delivery_last_error: normalizeText(failedPayload.delivery_last_error) || null,
                delivery_status: deliveryStatus || null,
                delivery_status_label: deliveryStatusLabel || null,
                refund_status: refundStatus || null,
                refund_status_label: refundStatusLabel || null,
                incident_alert_job_id: normalizeText(latestFailed.id) || null,
                incident_started_at: normalizeText(latestFailed.created_at) || null,
                incident_recovered_at: incidentRecoveredAt,
                incident_duration_minutes: incidentDurationMinutes,
                recovery_summary: recoverySummary,
                created_at: createdAt || null,
                delivery_updated_at: updatedAt || null,
                entry_path: '商城管理 -> 履约任务 / 异常订单'
            },
            allowedChannels: ['feishu'],
            dedupeKey: crypto
                .createHash('sha256')
                .update(`shop_order_delivery_recovered:${orderId}:${normalizeText(latestFailed.id) || normalizeText(latestFailed.created_at) || 'unknown'}`)
                .digest('hex'),
            dedupeWindowMinutes: Math.max(
                Number(config.dedupe_window_minutes || DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG.dedupe_window_minutes),
                60
            )
        };
    }).filter(Boolean);
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
    const stateSinceIso = new Date(nowDate.getTime() - Number(config.state_lookback_minutes || DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG.state_lookback_minutes) * 60 * 1000).toISOString();
    const [orders, stateJobs] = await Promise.all([
        fetchRecentShopOrders(supabase, sinceIso, config),
        fetchRecentShopOrderDeliveryStateJobs(supabase, stateSinceIso, config)
    ]);
    const alerts = buildShopOrderDeliveryFailedAlerts(orders, config, { now: nowDate });
    const trackedOrderIds = Array.from(new Set(
        (stateJobs || [])
            .filter((job) => normalizeText(job.alert_type).toLowerCase() === 'shop_order_delivery_failed')
            .map((job) => getOrderTargetId(job.payload))
            .filter(Boolean)
    ));
    const trackedOrders = await fetchOrdersByIds(supabase, trackedOrderIds, config);
    const recoveryAlerts = buildShopOrderDeliveryRecoveredAlerts(trackedOrders, stateJobs, config, { now: nowDate });

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

    for (const alert of recoveryAlerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            createdAt: nowDate.toISOString(),
            source: 'shop_delivery_monitor'
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
            order_id: alert.payload?.order_id || null,
            severity: alert.severity,
            queued: result?.queued === true,
            reason: result?.reason || null,
            admin_notification_created: Number(adminNotificationResult?.created || 0),
            admin_notification_error: normalizeText(adminNotificationResult?.error) || null
        });
    }

    return {
        failure_count: alerts.length,
        recovered_count: recoveryAlerts.length,
        dead_letter_count: alerts.filter((alert) => normalizeText(alert.payload?.delivery_status).toLowerCase() === 'dead_letter').length,
        retry_waiting_count: alerts.filter((alert) => normalizeText(alert.payload?.delivery_status).toLowerCase() === 'retry_waiting').length,
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
    DEFAULT_SHOP_ORDER_DELIVERY_MONITOR_CONFIG,
    SHOP_ORDER_DELIVERY_STATE_TYPES,
    buildShopOrderDeliveryFailedAlerts,
    buildShopOrderDeliveryRecoveredAlerts,
    normalizeShopOrderDeliveryMonitorConfig,
    runShopOrderDeliveryFailedSweep,
    __testUtils: {
        compareCreatedAtDescending,
        getLatestShopOrderDeliveryStateJob,
        getOrderTargetId,
        getRefundStatus,
        getDeliveryStatus,
        isRecoveredOrderState,
        shouldAlertForOrder
    }
};
