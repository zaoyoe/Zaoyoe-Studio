const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');

const DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    window_minutes: 30,
    state_lookback_minutes: 24 * 60,
    sweep_interval_ms: 5 * 60 * 1000,
    dedupe_window_minutes: 60,
    min_order_volume: 6,
    min_review_orders: 4,
    min_failed_orders: 3,
    min_webhook_volume: 5,
    min_query_volume: 5,
    max_paid_rate_percent: 65,
    min_review_ratio_percent: 45,
    min_failed_ratio_percent: 25,
    max_webhook_success_rate_percent: 70,
    max_query_success_rate_percent: 60,
    min_webhook_5xx_count: 3,
    min_query_5xx_count: 3,
    page_size: 500,
    max_pages: 20
});
const PAYMENT_GATEWAY_STATE_TYPES = Object.freeze([
    'payment_gateway_degraded',
    'payment_gateway_recovered'
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

function roundNumber(value, digits = 2) {
    const multiplier = 10 ** digits;
    return Math.round(normalizeNumber(value, 0) * multiplier) / multiplier;
}

function isMissingColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    return error?.code === '42703'
        || error?.code === '42P01'
        || (message.includes('column') && message.includes('does not exist'));
}

function getProviderLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    const labels = {
        hupijiao: '虎皮椒',
        afdian: '爱发电',
        mock: '模拟支付'
    };
    return labels[normalized] || normalized || '未知通道';
}

function formatPercent(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toFixed(2)}%` : '';
}

function formatSiteLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return '';
    if (normalized === 'mixed') return 'MIXED';
    return normalized.toUpperCase();
}

function createEmptyProviderStats(provider) {
    return {
        provider,
        total_orders: 0,
        paid_orders: 0,
        review_orders: 0,
        failed_orders: 0,
        webhook_total: 0,
        webhook_success: 0,
        webhook_failed: 0,
        webhook_4xx: 0,
        webhook_5xx: 0,
        query_total: 0,
        query_success: 0,
        query_failed: 0,
        query_4xx: 0,
        query_5xx: 0,
        site_counts: {}
    };
}

function registerSiteCount(stats, site) {
    const normalized = normalizeText(site).toLowerCase();
    if (!normalized) return;
    stats.site_counts[normalized] = Number(stats.site_counts[normalized] || 0) + 1;
}

function detectScopeSite(siteCounts = {}) {
    const entries = Object.entries(siteCounts).filter(([, count]) => Number(count || 0) > 0);
    if (!entries.length) return '';
    if (entries.length === 1) return entries[0][0];

    const total = entries.reduce((sum, [, count]) => sum + Number(count || 0), 0);
    const [topSite, topCount] = entries.sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))[0];
    if (total > 0 && (Number(topCount || 0) / total) >= 0.8) {
        return topSite;
    }

    return 'mixed';
}

function isSuccessfulWebhookEvent(event) {
    const processingResult = normalizeText(event?.processing_result);
    const responseStatus = Number(event?.response_status || 0);
    const hasBadResponse = Number.isFinite(responseStatus) && responseStatus >= 400;
    const okResults = new Set([
        'processed_paid',
        'received',
        'ignored_non_success_ec',
        'ignored_non_order_event',
        'ignored_non_paid_status',
        'admin_refund_processed',
        'admin_refund_synced_refunded'
    ]);

    return !hasBadResponse
        && event?.signature_valid !== false
        && event?.amount_valid !== false
        && !normalizeText(event?.error_message)
        && (!processingResult || okResults.has(processingResult));
}

function normalizePaymentGatewayMonitorConfig(rawConfig = {}, env = process.env) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    return {
        enabled: normalizeBoolean(source.enabled, normalizeBoolean(env?.PAYMENT_GATEWAY_MONITOR_ENABLED, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.enabled)),
        window_minutes: normalizeNumber(source.window_minutes, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_WINDOW_MINUTES, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.window_minutes, 5, 24 * 60), 5, 24 * 60),
        state_lookback_minutes: normalizeNumber(source.state_lookback_minutes, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_STATE_LOOKBACK_MINUTES, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.state_lookback_minutes, 30, 7 * 24 * 60), 30, 7 * 24 * 60),
        sweep_interval_ms: normalizeNumber(source.sweep_interval_ms, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_SWEEP_INTERVAL_MS, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.sweep_interval_ms, 10000, 60 * 60 * 1000), 10000, 60 * 60 * 1000),
        dedupe_window_minutes: normalizeNumber(source.dedupe_window_minutes, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_DEDUPE_WINDOW_MINUTES, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.dedupe_window_minutes, 1, 24 * 60), 1, 24 * 60),
        min_order_volume: normalizeNumber(source.min_order_volume, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_ORDER_VOLUME, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.min_order_volume, 1, 200), 1, 200),
        min_review_orders: normalizeNumber(source.min_review_orders, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_REVIEW_ORDERS, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.min_review_orders, 1, 100), 1, 100),
        min_failed_orders: normalizeNumber(source.min_failed_orders, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_FAILED_ORDERS, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.min_failed_orders, 1, 100), 1, 100),
        min_webhook_volume: normalizeNumber(source.min_webhook_volume, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_WEBHOOK_VOLUME, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.min_webhook_volume, 1, 500), 1, 500),
        min_query_volume: normalizeNumber(source.min_query_volume, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_QUERY_VOLUME, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.min_query_volume, 1, 500), 1, 500),
        max_paid_rate_percent: normalizeNumber(source.max_paid_rate_percent, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MAX_PAID_RATE_PERCENT, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.max_paid_rate_percent, 1, 100), 1, 100),
        min_review_ratio_percent: normalizeNumber(source.min_review_ratio_percent, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_REVIEW_RATIO_PERCENT, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.min_review_ratio_percent, 1, 100), 1, 100),
        min_failed_ratio_percent: normalizeNumber(source.min_failed_ratio_percent, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_FAILED_RATIO_PERCENT, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.min_failed_ratio_percent, 1, 100), 1, 100),
        max_webhook_success_rate_percent: normalizeNumber(source.max_webhook_success_rate_percent, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MAX_WEBHOOK_SUCCESS_RATE_PERCENT, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.max_webhook_success_rate_percent, 1, 100), 1, 100),
        max_query_success_rate_percent: normalizeNumber(source.max_query_success_rate_percent, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MAX_QUERY_SUCCESS_RATE_PERCENT, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.max_query_success_rate_percent, 1, 100), 1, 100),
        min_webhook_5xx_count: normalizeNumber(source.min_webhook_5xx_count, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_WEBHOOK_5XX_COUNT, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.min_webhook_5xx_count, 1, 100), 1, 100),
        min_query_5xx_count: normalizeNumber(source.min_query_5xx_count, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_QUERY_5XX_COUNT, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.min_query_5xx_count, 1, 100), 1, 100),
        page_size: normalizeNumber(source.page_size, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_PAGE_SIZE, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.page_size, 50, 5000), 50, 5000),
        max_pages: normalizeNumber(source.max_pages, normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MAX_PAGES, DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.max_pages, 1, 100), 1, 100)
    };
}

function buildGatewayProviderStats({ orders = [], events = [], queryAttempts = [] } = {}) {
    const statsMap = new Map();

    function ensureProviderStats(provider) {
        const normalized = normalizeText(provider).toLowerCase();
        if (!normalized) return null;
        if (!statsMap.has(normalized)) {
            statsMap.set(normalized, createEmptyProviderStats(normalized));
        }
        return statsMap.get(normalized);
    }

    (orders || []).forEach((order) => {
        const stats = ensureProviderStats(order?.provider);
        if (!stats) return;

        stats.total_orders += 1;
        registerSiteCount(stats, order?.site);

        const status = normalizeText(order?.status).toLowerCase();
        if (status === 'paid' || status === 'redeemed') {
            stats.paid_orders += 1;
        }
        if (status === 'pending_review') {
            stats.review_orders += 1;
        }
        if (status === 'rejected' || status === 'amount_mismatch') {
            stats.failed_orders += 1;
        }
    });

    (events || []).forEach((event) => {
        const stats = ensureProviderStats(event?.provider);
        if (!stats) return;

        const responseStatus = Number(event?.response_status || 0);
        const success = isSuccessfulWebhookEvent(event);

        stats.webhook_total += 1;
        stats.webhook_success += success ? 1 : 0;
        stats.webhook_failed += success ? 0 : 1;
        stats.webhook_4xx += responseStatus >= 400 && responseStatus < 500 ? 1 : 0;
        stats.webhook_5xx += responseStatus >= 500 ? 1 : 0;
    });

    (queryAttempts || []).forEach((attempt) => {
        const stats = ensureProviderStats(attempt?.provider);
        if (!stats) return;

        const responseStatus = Number(attempt?.response_status || 0);
        registerSiteCount(stats, attempt?.site);

        stats.query_total += 1;
        stats.query_success += attempt?.success === true ? 1 : 0;
        stats.query_failed += attempt?.success === true ? 0 : 1;
        stats.query_4xx += responseStatus >= 400 && responseStatus < 500 ? 1 : 0;
        stats.query_5xx += responseStatus >= 500 ? 1 : 0;
    });

    return Array.from(statsMap.values())
        .map((item) => {
            const paidRate = item.total_orders > 0 ? roundNumber((item.paid_orders / item.total_orders) * 100, 2) : 0;
            const reviewRatio = item.total_orders > 0 ? roundNumber((item.review_orders / item.total_orders) * 100, 2) : 0;
            const failedRatio = item.total_orders > 0 ? roundNumber((item.failed_orders / item.total_orders) * 100, 2) : 0;
            const webhookSuccessRate = item.webhook_total > 0 ? roundNumber((item.webhook_success / item.webhook_total) * 100, 2) : 0;
            const querySuccessRate = item.query_total > 0 ? roundNumber((item.query_success / item.query_total) * 100, 2) : 0;

            return {
                ...item,
                site: detectScopeSite(item.site_counts),
                paid_rate: paidRate,
                review_ratio: reviewRatio,
                failed_ratio: failedRatio,
                webhook_success_rate: webhookSuccessRate,
                query_success_rate: querySuccessRate
            };
        })
        .sort((left, right) => (
            Number(right.total_orders || 0) - Number(left.total_orders || 0)
            || Number(right.webhook_total || 0) - Number(left.webhook_total || 0)
            || Number(right.query_total || 0) - Number(left.query_total || 0)
        ));
}

function buildGatewayDegradedReasons(stats, config) {
    const reasons = [];

    if (
        Number(stats.total_orders || 0) >= Number(config.min_order_volume || 0)
        && Number(stats.paid_rate || 0) <= Number(config.max_paid_rate_percent || 0)
    ) {
        reasons.push(`支付成功率仅 ${formatPercent(stats.paid_rate)}（${Number(stats.paid_orders || 0)}/${Number(stats.total_orders || 0)}）`);
    }

    if (
        Number(stats.review_orders || 0) >= Number(config.min_review_orders || 0)
        && Number(stats.review_ratio || 0) >= Number(config.min_review_ratio_percent || 0)
    ) {
        reasons.push(`待审核订单占比 ${formatPercent(stats.review_ratio)}（${Number(stats.review_orders || 0)}/${Number(stats.total_orders || 0)}）`);
    }

    if (
        Number(stats.failed_orders || 0) >= Number(config.min_failed_orders || 0)
        && Number(stats.failed_ratio || 0) >= Number(config.min_failed_ratio_percent || 0)
    ) {
        reasons.push(`失败订单占比 ${formatPercent(stats.failed_ratio)}（${Number(stats.failed_orders || 0)}/${Number(stats.total_orders || 0)}）`);
    }

    if (
        Number(stats.webhook_total || 0) >= Number(config.min_webhook_volume || 0)
        && Number(stats.webhook_success_rate || 0) <= Number(config.max_webhook_success_rate_percent || 0)
    ) {
        reasons.push(`回调成功率仅 ${formatPercent(stats.webhook_success_rate)}（失败 ${Number(stats.webhook_failed || 0)}，5xx ${Number(stats.webhook_5xx || 0)}）`);
    }

    if (Number(stats.webhook_5xx || 0) >= Number(config.min_webhook_5xx_count || 0)) {
        reasons.push(`回调 5xx 已累计 ${Number(stats.webhook_5xx || 0)} 次`);
    }

    if (
        Number(stats.query_total || 0) >= Number(config.min_query_volume || 0)
        && Number(stats.query_success_rate || 0) <= Number(config.max_query_success_rate_percent || 0)
    ) {
        reasons.push(`查码成功率仅 ${formatPercent(stats.query_success_rate)}（失败 ${Number(stats.query_failed || 0)}，5xx ${Number(stats.query_5xx || 0)}）`);
    }

    if (Number(stats.query_5xx || 0) >= Number(config.min_query_5xx_count || 0)) {
        reasons.push(`查码 5xx 已累计 ${Number(stats.query_5xx || 0)} 次`);
    }

    return reasons;
}

function buildPaymentGatewayDegradedAlerts(providerStats = [], config = {}) {
    const monitorConfig = normalizePaymentGatewayMonitorConfig(config);

    return (providerStats || [])
        .filter((stats) => {
            const provider = normalizeText(stats?.provider).toLowerCase();
            return provider && provider !== 'mock';
        })
        .map((stats) => {
            const reasons = buildGatewayDegradedReasons(stats, monitorConfig);
            if (!reasons.length) {
                return null;
            }

            const providerLabel = getProviderLabel(stats.provider);
            const siteLabel = formatSiteLabel(stats.site);
            const title = `${providerLabel} 支付通道异常波动${siteLabel ? `（${siteLabel}）` : ''}`;
            const lines = [
                `${providerLabel} 在最近 ${monitorConfig.window_minutes} 分钟出现异常波动。`,
                `判定信号：${reasons.join('；')}`
            ];

            if (Number(stats.total_orders || 0) > 0) {
                lines.push(`订单概览：总 ${Number(stats.total_orders || 0)} 笔 / 成功 ${Number(stats.paid_orders || 0)} 笔 / 待审核 ${Number(stats.review_orders || 0)} 笔 / 失败 ${Number(stats.failed_orders || 0)} 笔`);
            }
            if (Number(stats.webhook_total || 0) > 0) {
                lines.push(`回调概览：总 ${Number(stats.webhook_total || 0)} 次 / 成功 ${Number(stats.webhook_success || 0)} 次 / 失败 ${Number(stats.webhook_failed || 0)} 次 / 5xx ${Number(stats.webhook_5xx || 0)} 次`);
            }
            if (Number(stats.query_total || 0) > 0) {
                lines.push(`查码概览：总 ${Number(stats.query_total || 0)} 次 / 成功 ${Number(stats.query_success || 0)} 次 / 失败 ${Number(stats.query_failed || 0)} 次 / 5xx ${Number(stats.query_5xx || 0)} 次`);
            }

            lines.push('处理入口：支付对账 -> 支付总览 -> 通道表现 / 最近24小时异常趋势');

            const payload = {
                provider: stats.provider,
                site: stats.site || null,
                target_id: `payment_gateway:${stats.provider}:${stats.site || 'all'}`,
                monitor_window_minutes: monitorConfig.window_minutes,
                degraded_reasons: reasons,
                total_orders: Number(stats.total_orders || 0),
                paid_orders: Number(stats.paid_orders || 0),
                review_orders: Number(stats.review_orders || 0),
                failed_orders: Number(stats.failed_orders || 0),
                paid_rate: Number(stats.paid_rate || 0),
                review_ratio: Number(stats.review_ratio || 0),
                failed_ratio: Number(stats.failed_ratio || 0),
                webhook_total: Number(stats.webhook_total || 0),
                webhook_success: Number(stats.webhook_success || 0),
                webhook_failed: Number(stats.webhook_failed || 0),
                webhook_4xx: Number(stats.webhook_4xx || 0),
                webhook_5xx: Number(stats.webhook_5xx || 0),
                webhook_success_rate: Number(stats.webhook_success_rate || 0),
                query_total: Number(stats.query_total || 0),
                query_success: Number(stats.query_success || 0),
                query_failed: Number(stats.query_failed || 0),
                query_4xx: Number(stats.query_4xx || 0),
                query_5xx: Number(stats.query_5xx || 0),
                query_success_rate: Number(stats.query_success_rate || 0),
                entry_path: '支付对账 -> 支付总览 -> 通道表现 / 最近24小时异常趋势'
            };

            return {
                alertType: 'payment_gateway_degraded',
                severity: 'critical',
                title,
                content: lines.join('\n'),
                payload,
                dedupeKey: crypto
                    .createHash('sha256')
                    .update(`payment_gateway_degraded:${stats.provider}:${stats.site || 'all'}`)
                    .digest('hex'),
                dedupeWindowMinutes: Number(monitorConfig.dedupe_window_minutes || DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.dedupe_window_minutes)
            };
        })
        .filter(Boolean);
}

function getGatewayTargetId(value = {}) {
    if (!value || typeof value !== 'object') {
        return 'payment_gateway:unknown:all';
    }

    if (normalizeText(value.target_id)) {
        return normalizeText(value.target_id);
    }

    const provider = normalizeText(value.provider).toLowerCase() || 'unknown';
    const site = normalizeText(value.site).toLowerCase() || 'all';
    return `payment_gateway:${provider}:${site}`;
}

function hasGatewayActivity(stats = {}) {
    return Number(stats.total_orders || 0) > 0
        || Number(stats.webhook_total || 0) > 0
        || Number(stats.query_total || 0) > 0;
}

function getLatestGatewayStateJob(stateJobs = [], alertType, targetId = '') {
    const normalizedType = normalizeText(alertType).toLowerCase();
    const normalizedTargetId = normalizeText(targetId);

    return (stateJobs || [])
        .filter((job) => normalizeText(job.alert_type).toLowerCase() === normalizedType)
        .filter((job) => !normalizedTargetId || getGatewayTargetId(job.payload) === normalizedTargetId)
        .sort((left, right) => Date.parse(normalizeText(right.created_at)) - Date.parse(normalizeText(left.created_at)))
        [0] || null;
}

function buildGatewayStatsMap(providerStats = []) {
    const map = new Map();
    for (const stats of providerStats || []) {
        map.set(getGatewayTargetId(stats), stats);
    }
    return map;
}

function buildPaymentGatewayRecoveredAlerts(providerStats = [], stateJobs = [], config = {}, options = {}) {
    const monitorConfig = normalizePaymentGatewayMonitorConfig(config);
    const activeDegradedAlerts = buildPaymentGatewayDegradedAlerts(providerStats, monitorConfig);
    const activeTargetIds = new Set(activeDegradedAlerts.map((alert) => getGatewayTargetId(alert.payload)));
    const statsMap = buildGatewayStatsMap(providerStats);
    const degradedTargets = Array.from(new Set(
        (stateJobs || [])
            .filter((job) => normalizeText(job.alert_type).toLowerCase() === 'payment_gateway_degraded')
            .map((job) => getGatewayTargetId(job.payload))
            .filter(Boolean)
    ));
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());

    return degradedTargets.map((targetId) => {
        const latestDegraded = getLatestGatewayStateJob(stateJobs, 'payment_gateway_degraded', targetId);
        if (!latestDegraded) {
            return null;
        }

        const latestRecovered = getLatestGatewayStateJob(stateJobs, 'payment_gateway_recovered', targetId);
        const latestDegradedAt = Date.parse(normalizeText(latestDegraded.created_at));
        const latestRecoveredAt = Date.parse(normalizeText(latestRecovered?.created_at));
        if (Number.isFinite(latestRecoveredAt) && Number.isFinite(latestDegradedAt) && latestRecoveredAt >= latestDegradedAt) {
            return null;
        }
        if (activeTargetIds.has(targetId)) {
            return null;
        }

        const currentStats = statsMap.get(targetId);
        if (!currentStats || !hasGatewayActivity(currentStats)) {
            return null;
        }

        const degradedPayload = latestDegraded.payload && typeof latestDegraded.payload === 'object' ? latestDegraded.payload : {};
        const provider = normalizeText(currentStats.provider || degradedPayload.provider).toLowerCase();
        const site = normalizeText(currentStats.site || degradedPayload.site).toLowerCase() || null;
        const providerLabel = getProviderLabel(provider);
        const siteLabel = formatSiteLabel(site);
        const incidentRecoveredAt = nowDate.toISOString();
        const incidentDurationMinutes = Number.isFinite(latestDegradedAt)
            ? Math.max(0, Math.round((nowDate.getTime() - latestDegradedAt) / 60000))
            : 0;
        const previousReasons = Array.isArray(degradedPayload.degraded_reasons)
            ? degradedPayload.degraded_reasons.map((item) => normalizeText(item)).filter(Boolean)
            : [];
        const lines = [
            `${providerLabel} 在最近 ${monitorConfig.window_minutes} 分钟内未再命中支付通道异常阈值，可从应急处理切回观察状态。`,
            '恢复结论：支付通道异常阈值已解除'
        ];

        if (siteLabel) {
            lines.push(`站点：${siteLabel}`);
        }
        if (normalizeText(latestDegraded.created_at)) {
            lines.push(`上次异常：${normalizeText(latestDegraded.created_at)}`);
        }
        lines.push(`恢复时间：${incidentRecoveredAt}`);
        lines.push(`持续时长：${incidentDurationMinutes} 分钟`);
        if (previousReasons.length) {
            lines.push(`上次异常信号：${previousReasons.join('；')}`);
        }
        if (Number(currentStats.total_orders || 0) > 0) {
            lines.push(`当前订单概览：总 ${Number(currentStats.total_orders || 0)} 笔 / 成功 ${Number(currentStats.paid_orders || 0)} 笔 / 待审核 ${Number(currentStats.review_orders || 0)} 笔 / 失败 ${Number(currentStats.failed_orders || 0)} 笔 / 成功率 ${formatPercent(currentStats.paid_rate)}`);
        }
        if (Number(currentStats.webhook_total || 0) > 0) {
            lines.push(`当前回调概览：总 ${Number(currentStats.webhook_total || 0)} 次 / 成功 ${Number(currentStats.webhook_success || 0)} 次 / 失败 ${Number(currentStats.webhook_failed || 0)} 次 / 5xx ${Number(currentStats.webhook_5xx || 0)} 次 / 成功率 ${formatPercent(currentStats.webhook_success_rate)}`);
        }
        if (Number(currentStats.query_total || 0) > 0) {
            lines.push(`当前查码概览：总 ${Number(currentStats.query_total || 0)} 次 / 成功 ${Number(currentStats.query_success || 0)} 次 / 失败 ${Number(currentStats.query_failed || 0)} 次 / 5xx ${Number(currentStats.query_5xx || 0)} 次 / 成功率 ${formatPercent(currentStats.query_success_rate)}`);
        }
        lines.push('处理入口：支付对账 -> 支付总览 -> 通道表现 / 最近24小时异常趋势');

        return {
            alertType: 'payment_gateway_recovered',
            severity: 'warning',
            title: `${providerLabel} 支付通道已恢复${siteLabel ? `（${siteLabel}）` : ''}`,
            content: lines.join('\n'),
            payload: {
                provider,
                site,
                target_id: targetId,
                monitor_window_minutes: monitorConfig.window_minutes,
                gateway_alert_job_id: normalizeText(latestDegraded.id) || null,
                incident_started_at: normalizeText(latestDegraded.created_at) || null,
                incident_recovered_at: incidentRecoveredAt,
                incident_duration_minutes: incidentDurationMinutes,
                recovery_summary: '支付通道异常阈值已解除',
                previous_degraded_reasons: previousReasons,
                total_orders: Number(currentStats.total_orders || 0),
                paid_orders: Number(currentStats.paid_orders || 0),
                review_orders: Number(currentStats.review_orders || 0),
                failed_orders: Number(currentStats.failed_orders || 0),
                paid_rate: Number(currentStats.paid_rate || 0),
                webhook_total: Number(currentStats.webhook_total || 0),
                webhook_success: Number(currentStats.webhook_success || 0),
                webhook_failed: Number(currentStats.webhook_failed || 0),
                webhook_5xx: Number(currentStats.webhook_5xx || 0),
                webhook_success_rate: Number(currentStats.webhook_success_rate || 0),
                query_total: Number(currentStats.query_total || 0),
                query_success: Number(currentStats.query_success || 0),
                query_failed: Number(currentStats.query_failed || 0),
                query_5xx: Number(currentStats.query_5xx || 0),
                query_success_rate: Number(currentStats.query_success_rate || 0),
                entry_path: '支付对账 -> 支付总览 -> 通道表现 / 最近24小时异常趋势'
            },
            allowedChannels: ['feishu'],
            dedupeKey: crypto
                .createHash('sha256')
                .update(`payment_gateway_recovered:${targetId}:${normalizeText(latestDegraded.id) || normalizeText(latestDegraded.created_at) || 'unknown'}`)
                .digest('hex'),
            dedupeWindowMinutes: Number(monitorConfig.dedupe_window_minutes || DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.dedupe_window_minutes)
        };
    }).filter(Boolean);
}

async function fetchPagedRows(buildQuery, pageSize = 500, maxPages = 20) {
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

async function fetchRecentPaymentOrders(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('payment_orders')
        .select('id, provider, status, user_id, site, created_at')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchRecentPaymentEvents(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('payment_events')
        .select('id, provider, response_status, signature_valid, amount_valid, processing_result, error_message, created_at')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchRecentPaymentQueryAttempts(client, sinceIso, config) {
    try {
        return await fetchPagedRows(() => client
            .from('payment_query_attempts')
            .select('id, provider, site, success, response_status, outcome_code, created_at')
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false }), config.page_size, config.max_pages);
    } catch (error) {
        if (isMissingColumnError(error)) {
            return [];
        }
        throw error;
    }
}

async function fetchRecentPaymentGatewayStateJobs(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('ops_alert_jobs')
        .select('id, alert_type, severity, title, payload, created_at')
        .in('alert_type', PAYMENT_GATEWAY_STATE_TYPES)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

async function runPaymentGatewayDegradationSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    const runtimeMonitorConfig = runtime?.config?.payment_gateway && typeof runtime.config.payment_gateway === 'object'
        ? runtime.config.payment_gateway
        : {};
    const config = normalizePaymentGatewayMonitorConfig({
        ...(options.config && typeof options.config === 'object' ? options.config : {}),
        ...runtimeMonitorConfig
    }, env);

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            degraded_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    if (!runtime?.config?.enabled) {
        return {
            skipped: 'ops_alerts_disabled',
            degraded_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const sinceIso = new Date(nowDate.getTime() - Number(config.window_minutes || DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.window_minutes) * 60 * 1000).toISOString();
    const stateSinceIso = new Date(nowDate.getTime() - Number(config.state_lookback_minutes || DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG.state_lookback_minutes) * 60 * 1000).toISOString();

    const [orders, events, queryAttempts, stateJobs] = await Promise.all([
        fetchRecentPaymentOrders(supabase, sinceIso, config),
        fetchRecentPaymentEvents(supabase, sinceIso, config),
        fetchRecentPaymentQueryAttempts(supabase, sinceIso, config),
        fetchRecentPaymentGatewayStateJobs(supabase, stateSinceIso, config)
    ]);

    const providerStats = buildGatewayProviderStats({
        orders,
        events,
        queryAttempts
    });
    const alerts = buildPaymentGatewayDegradedAlerts(providerStats, config);
    const recoveryAlerts = buildPaymentGatewayRecoveredAlerts(providerStats, stateJobs, config, {
        now: nowDate
    });

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
            createdAt: nowDate.toISOString()
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
            provider: alert.payload?.provider || null,
            site: alert.payload?.site || null,
            title: alert.title,
            queued: result?.queued === true,
            reason: result?.reason || null
        });
    }

    for (const alert of recoveryAlerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            createdAt: nowDate.toISOString()
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

        results.push({
            provider: alert.payload?.provider || null,
            site: alert.payload?.site || null,
            title: alert.title,
            queued: result?.queued === true,
            reason: result?.reason || null,
            admin_notification_created: 0,
            admin_notification_error: null
        });
    }

    return {
        window_minutes: Number(config.window_minutes || 0),
        provider_count: providerStats.length,
        degraded_count: alerts.length,
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
    DEFAULT_PAYMENT_GATEWAY_MONITOR_CONFIG,
    PAYMENT_GATEWAY_STATE_TYPES,
    buildGatewayProviderStats,
    buildPaymentGatewayDegradedAlerts,
    buildPaymentGatewayRecoveredAlerts,
    normalizePaymentGatewayMonitorConfig,
    runPaymentGatewayDegradationSweep,
    __testUtils: {
        buildGatewayDegradedReasons,
        buildGatewayStatsMap,
        detectScopeSite,
        fetchPagedRows,
        getGatewayTargetId,
        getLatestGatewayStateJob,
        getProviderLabel,
        hasGatewayActivity,
        isSuccessfulWebhookEvent
    }
};
