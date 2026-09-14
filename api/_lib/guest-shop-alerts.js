const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');

const DEFAULT_GUEST_SHOP_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 60 * 1000,
    lookback_days: 14,
    paid_unfulfilled_persist_minutes: 10,
    fulfillment_p95_seconds: 120,
    fulfillment_p99_seconds: 300,
    fulfillment_min_samples: 5,
    refund_pending_warn_minutes: 30,
    refund_pending_critical_minutes: 120,
    reservation_expired_window_minutes: 15,
    reservation_expired_count_threshold: 5,
    dedupe_window_minutes: 15,
    page_size: 500,
    max_pages: 10
});

const GUEST_SHOP_ALERT_TYPES = Object.freeze([
    'guest_shop_paid_unfulfilled',
    'guest_shop_fulfillment_latency',
    'guest_shop_amount_mismatch',
    'guest_shop_payment_review',
    'guest_shop_dead_letter',
    'guest_shop_refund_hanging',
    'guest_shop_reservation_expired'
]);

const GUEST_SHOP_ORDER_MONITOR_COLUMNS = [
    'id',
    'order_no',
    'site',
    'currency',
    'product_id',
    'sku_id',
    'snapshot_product_name',
    'snapshot_sku_name',
    'quantity',
    'unit_amount',
    'total_amount',
    'payment_status',
    'reservation_status',
    'fulfillment_status',
    'refund_status',
    'expires_at',
    'paid_at',
    'fulfilled_at',
    'cancelled_at',
    'last_error_code',
    'last_error_message',
    'metadata',
    'created_at',
    'updated_at'
].join(', ');

const GUEST_SHOP_PAYMENT_MONITOR_COLUMNS = [
    'id',
    'guest_order_id',
    'merchant_order_no',
    'purpose',
    'provider',
    'channel',
    'provider_order_no',
    'site',
    'currency',
    'expected_amount',
    'paid_amount',
    'status',
    'sign_verified',
    'amount_verified',
    'currency_verified',
    'final_status_verified',
    'last_error_code',
    'last_error_message',
    'paid_at',
    'verified_at',
    'created_at',
    'updated_at'
].join(', ');

const GUEST_SHOP_RESERVATION_MONITOR_COLUMNS = [
    'id',
    'order_id',
    'site',
    'status',
    'reserved_at',
    'reserved_until',
    'released_at',
    'consumed_at',
    'release_reason',
    'created_at',
    'updated_at'
].join(', ');

const FORBIDDEN_FIELD_PATTERN = /(claim_secret|recovery_code|card_secret|inventory_content|response_payload)/i;
const AMOUNT_MISMATCH_STATUSES = new Set(['amount_mismatch', 'overpaid', 'partial']);
const SAMPLE_LIMIT = 5;
const DUTY_ENTRY = 'docs/guest-shop-payment-fulfillment-runbook.md';
const ADMIN_ENTRY = 'Admin Studio -> 商城 -> 游客异常订单';

function normalizeText(value, maxLength = 500) {
    if (value === undefined || value === null) return '';
    return String(value).trim().slice(0, Math.max(0, Number(maxLength) || 0));
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = normalizeText(value, 40).toLowerCase();
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

function parseDate(value) {
    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value : null;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function asMillis(value, fallbackNow) {
    const parsed = parseDate(value);
    if (parsed) return parsed.getTime();
    return Number.isFinite(fallbackNow) ? fallbackNow : Date.now();
}

function normalizeGuestShopMonitorConfig(rawConfig = {}, env = process.env) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    return {
        enabled: normalizeBoolean(
            source.enabled,
            normalizeBoolean(env?.GUEST_SHOP_MONITOR_ENABLED, DEFAULT_GUEST_SHOP_MONITOR_CONFIG.enabled)
        ),
        sweep_interval_ms: normalizeNumber(
            source.sweep_interval_ms,
            normalizeNumber(env?.GUEST_SHOP_MONITOR_SWEEP_INTERVAL_MS, DEFAULT_GUEST_SHOP_MONITOR_CONFIG.sweep_interval_ms, 10000, 15 * 60 * 1000),
            10000,
            15 * 60 * 1000
        ),
        lookback_days: normalizeNumber(
            source.lookback_days,
            normalizeNumber(env?.GUEST_SHOP_MONITOR_LOOKBACK_DAYS, DEFAULT_GUEST_SHOP_MONITOR_CONFIG.lookback_days, 1, 90),
            1,
            90
        ),
        paid_unfulfilled_persist_minutes: normalizeNumber(
            source.paid_unfulfilled_persist_minutes,
            normalizeNumber(env?.GUEST_SHOP_MONITOR_PAID_UNFULFILLED_PERSIST_MINUTES, DEFAULT_GUEST_SHOP_MONITOR_CONFIG.paid_unfulfilled_persist_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        fulfillment_p95_seconds: normalizeNumber(
            source.fulfillment_p95_seconds,
            normalizeNumber(env?.GUEST_SHOP_MONITOR_FULFILLMENT_P95_SECONDS, DEFAULT_GUEST_SHOP_MONITOR_CONFIG.fulfillment_p95_seconds, 1, 3600),
            1,
            3600
        ),
        fulfillment_p99_seconds: normalizeNumber(
            source.fulfillment_p99_seconds,
            normalizeNumber(env?.GUEST_SHOP_MONITOR_FULFILLMENT_P99_SECONDS, DEFAULT_GUEST_SHOP_MONITOR_CONFIG.fulfillment_p99_seconds, 1, 7200),
            1,
            7200
        ),
        fulfillment_min_samples: normalizeNumber(
            source.fulfillment_min_samples,
            normalizeNumber(env?.GUEST_SHOP_MONITOR_FULFILLMENT_MIN_SAMPLES, DEFAULT_GUEST_SHOP_MONITOR_CONFIG.fulfillment_min_samples, 1, 1000),
            1,
            1000
        ),
        refund_pending_warn_minutes: normalizeNumber(
            source.refund_pending_warn_minutes,
            normalizeNumber(env?.GUEST_SHOP_MONITOR_REFUND_PENDING_WARN_MINUTES, DEFAULT_GUEST_SHOP_MONITOR_CONFIG.refund_pending_warn_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        refund_pending_critical_minutes: normalizeNumber(
            source.refund_pending_critical_minutes,
            normalizeNumber(env?.GUEST_SHOP_MONITOR_REFUND_PENDING_CRITICAL_MINUTES, DEFAULT_GUEST_SHOP_MONITOR_CONFIG.refund_pending_critical_minutes, 1, 48 * 60),
            1,
            48 * 60
        ),
        reservation_expired_window_minutes: normalizeNumber(
            source.reservation_expired_window_minutes,
            normalizeNumber(env?.GUEST_SHOP_MONITOR_RESERVATION_EXPIRED_WINDOW_MINUTES, DEFAULT_GUEST_SHOP_MONITOR_CONFIG.reservation_expired_window_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        reservation_expired_count_threshold: normalizeNumber(
            source.reservation_expired_count_threshold,
            normalizeNumber(env?.GUEST_SHOP_MONITOR_RESERVATION_EXPIRED_COUNT_THRESHOLD, DEFAULT_GUEST_SHOP_MONITOR_CONFIG.reservation_expired_count_threshold, 1, 1000),
            1,
            1000
        ),
        dedupe_window_minutes: normalizeNumber(
            source.dedupe_window_minutes,
            normalizeNumber(env?.GUEST_SHOP_MONITOR_DEDUPE_WINDOW_MINUTES, DEFAULT_GUEST_SHOP_MONITOR_CONFIG.dedupe_window_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        page_size: normalizeNumber(
            source.page_size,
            normalizeNumber(env?.GUEST_SHOP_MONITOR_PAGE_SIZE, DEFAULT_GUEST_SHOP_MONITOR_CONFIG.page_size, 50, 5000),
            50,
            5000
        ),
        max_pages: normalizeNumber(
            source.max_pages,
            normalizeNumber(env?.GUEST_SHOP_MONITOR_MAX_PAGES, DEFAULT_GUEST_SHOP_MONITOR_CONFIG.max_pages, 1, 100),
            1,
            100
        )
    };
}

function assertSafeSelect(columns) {
    if (FORBIDDEN_FIELD_PATTERN.test(String(columns || ''))) {
        throw new Error('guest shop monitor select must not include secrets or card content');
    }
}

function percentile(values = [], p = 95) {
    const numeric = (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .sort((left, right) => left - right);
    if (!numeric.length) return null;
    const clamped = Math.min(100, Math.max(0, Number(p) || 0));
    if (numeric.length === 1) return numeric[0];
    const rank = Math.ceil((clamped / 100) * numeric.length);
    return numeric[Math.min(numeric.length, Math.max(1, rank)) - 1];
}

function sampleOrderNos(rows = [], limit = SAMPLE_LIMIT) {
    return (rows || [])
        .map((row) => normalizeText(row?.order_no, 80))
        .filter(Boolean)
        .slice(0, Math.max(1, Number(limit) || SAMPLE_LIMIT));
}

function sortByAgeAscending(rows = [], field = 'paid_at') {
    return (rows || []).slice().sort((left, right) => asMillis(left?.[field] || left?.updated_at, 0) - asMillis(right?.[field] || right?.updated_at, 0));
}

function getMetadata(row = {}) {
    return row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata
        : {};
}

function getRefundQueuedAt(order = {}) {
    const metadata = getMetadata(order);
    return parseDate(metadata.refund_queued_at || metadata.queued_at || metadata.refund_requested_at)
        || parseDate(order.updated_at)
        || parseDate(order.created_at);
}

function getPaidAt(order = {}, payment = null) {
    return parseDate(order.paid_at) || parseDate(payment?.paid_at) || parseDate(order.updated_at);
}

function getFulfillmentLatencySeconds(order = {}) {
    const paidAt = parseDate(order.paid_at);
    const fulfilledAt = parseDate(order.fulfilled_at);
    if (!paidAt || !fulfilledAt) return null;
    return Math.max(0, (fulfilledAt.getTime() - paidAt.getTime()) / 1000);
}

function buildDedupeKey(alertType, parts = []) {
    return crypto
        .createHash('sha256')
        .update([alertType, ...(parts || []).map((part) => normalizeText(part, 200))].join(':'))
        .digest('hex');
}

function buildAlert({
    alertType,
    severity,
    title,
    lines,
    count,
    sampleOrders = [],
    extraPayload = {},
    dedupeParts = [],
    config
}) {
    const orderNos = sampleOrderNos(sampleOrders);
    const contentLines = [
        ...(Array.isArray(lines) ? lines : [String(lines || '')]),
        orderNos.length ? `样例订单号：${orderNos.join('、')}` : '样例订单号：无',
        `值班入口：${DUTY_ENTRY}`,
        `处理入口：${ADMIN_ENTRY}`
    ].filter(Boolean);

    return {
        alertType,
        severity,
        title,
        content: contentLines.join('\n'),
        payload: {
            target_id: alertType,
            count: Math.max(0, Math.round(Number(count || 0))),
            order_nos: orderNos,
            duty_entry: DUTY_ENTRY,
            entry_path: ADMIN_ENTRY,
            ...extraPayload
        },
        source: 'guest_shop_monitor',
        dedupeKey: buildDedupeKey(alertType, dedupeParts.length ? dedupeParts : [severity, String(count || 0), orderNos.join(',')]),
        dedupeWindowMinutes: Number(config?.dedupe_window_minutes || DEFAULT_GUEST_SHOP_MONITOR_CONFIG.dedupe_window_minutes)
    };
}

function indexPaymentsByOrderId(payments = []) {
    const map = new Map();
    for (const payment of payments || []) {
        const orderId = normalizeText(payment?.guest_order_id, 80);
        if (!orderId) continue;
        map.set(orderId, payment);
    }
    return map;
}

function classifyGuestShopMonitorOrder(order = {}, payment = null, now = Date.now(), rawConfig = {}) {
    const config = normalizeGuestShopMonitorConfig(rawConfig);
    const paymentStatus = normalizeText(order?.payment_status, 40).toLowerCase();
    const paymentRowStatus = normalizeText(payment?.status || order?.payment_row_status, 40).toLowerCase();
    const fulfillmentStatus = normalizeText(order?.fulfillment_status, 40).toLowerCase();
    const refundStatus = normalizeText(order?.refund_status, 40).toLowerCase();
    const flags = {
        dead_letter: fulfillmentStatus === 'dead_letter',
        amount_mismatch: AMOUNT_MISMATCH_STATUSES.has(paymentStatus) || AMOUNT_MISMATCH_STATUSES.has(paymentRowStatus),
        payment_review: paymentStatus === 'review' || paymentRowStatus === 'review',
        paid_unfulfilled: paymentStatus === 'confirmed' && !['delivered', 'refunded'].includes(fulfillmentStatus),
        paid_unfulfillable: fulfillmentStatus === 'paid_unfulfillable',
        refund_hanging: false,
        refund_severity: null
    };

    if (refundStatus === 'failed' || refundStatus === 'manual_review') {
        flags.refund_hanging = true;
        flags.refund_severity = 'critical';
    } else if (refundStatus === 'pending') {
        const queuedAt = getRefundQueuedAt(order);
        const ageMinutes = queuedAt ? (now - queuedAt.getTime()) / 60000 : 0;
        flags.refund_age_minutes = ageMinutes;
        if (ageMinutes >= Number(config.refund_pending_warn_minutes)) {
            flags.refund_hanging = true;
            flags.refund_severity = ageMinutes >= Number(config.refund_pending_critical_minutes)
                ? 'critical'
                : 'warning';
        }
    }

    return flags;
}

function computeGuestShopMonitorMetrics(orders = [], payments = [], reservations = [], rawConfig = {}, options = {}) {
    const config = normalizeGuestShopMonitorConfig(rawConfig);
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const now = nowDate.getTime();
    const paymentMap = indexPaymentsByOrderId(payments);
    const persistMs = Number(config.paid_unfulfilled_persist_minutes) * 60 * 1000;
    const reservationWindowMs = Number(config.reservation_expired_window_minutes) * 60 * 1000;
    const latencyWindowMs = 24 * 60 * 60 * 1000;
    const classified = [];

    const buckets = {
        paid_unfulfilled: [],
        amount_mismatch: [],
        payment_review: [],
        dead_letter: [],
        refund_hanging: [],
        refund_hanging_critical: [],
        latency_samples: []
    };

    for (const order of orders || []) {
        const payment = paymentMap.get(normalizeText(order?.id, 80)) || null;
        const flags = classifyGuestShopMonitorOrder(order, payment, now, config);
        const paidAt = getPaidAt(order, payment);
        const persistReady = flags.paid_unfulfilled && paidAt && (now - paidAt.getTime()) >= persistMs;
        classified.push({ order, payment, flags, persistReady });

        if (persistReady) buckets.paid_unfulfilled.push(order);
        if (flags.amount_mismatch) buckets.amount_mismatch.push(order);
        if (flags.payment_review) buckets.payment_review.push(order);
        if (flags.dead_letter) buckets.dead_letter.push(order);
        if (flags.refund_hanging) {
            buckets.refund_hanging.push(order);
            if (flags.refund_severity === 'critical') buckets.refund_hanging_critical.push(order);
        }

        const fulfilledAt = parseDate(order?.fulfilled_at);
        if (normalizeText(order?.fulfillment_status, 40).toLowerCase() === 'delivered' && fulfilledAt && (now - fulfilledAt.getTime()) <= latencyWindowMs) {
            const latency = getFulfillmentLatencySeconds(order);
            if (Number.isFinite(latency)) buckets.latency_samples.push(latency);
        }
    }

    const expiredReservations = (reservations || []).filter((row) => {
        if (normalizeText(row?.status, 20).toLowerCase() !== 'held') return false;
        const reservedUntil = parseDate(row?.reserved_until);
        return Boolean(reservedUntil && reservedUntil.getTime() < now);
    });
    const recentlyExpiredReservations = expiredReservations.filter((row) => {
        const reservedUntil = parseDate(row?.reserved_until);
        return Boolean(reservedUntil && (now - reservedUntil.getTime()) <= reservationWindowMs);
    });

    const p95 = percentile(buckets.latency_samples, 95);
    const p99 = percentile(buckets.latency_samples, 99);

    return {
        now: nowDate,
        config,
        classified,
        buckets,
        paid_unfulfilled_count: buckets.paid_unfulfilled.length,
        amount_mismatch_count: buckets.amount_mismatch.length,
        payment_review_count: buckets.payment_review.length,
        dead_letter_count: buckets.dead_letter.length,
        refund_hanging_count: buckets.refund_hanging.length,
        refund_hanging_critical_count: buckets.refund_hanging_critical.length,
        reservation_expired_count: recentlyExpiredReservations.length,
        reservation_expired_total: expiredReservations.length,
        recently_expired_reservations: recentlyExpiredReservations,
        fulfillment_sample_count: buckets.latency_samples.length,
        fulfillment_p95_seconds: p95,
        fulfillment_p99_seconds: p99
    };
}

function buildGuestShopMonitorAlerts(orders = [], payments = [], reservations = [], rawConfig = {}, options = {}) {
    const metrics = computeGuestShopMonitorMetrics(orders, payments, reservations, rawConfig, options);
    const config = metrics.config;
    const alerts = [];

    if (metrics.paid_unfulfilled_count > 0) {
        const samples = sortByAgeAscending(metrics.buckets.paid_unfulfilled, 'paid_at');
        alerts.push(buildAlert({
            alertType: 'guest_shop_paid_unfulfilled',
            severity: 'critical',
            title: `游客已付款未履约 ${metrics.paid_unfulfilled_count} 笔（持续≥${config.paid_unfulfilled_persist_minutes}分钟）`,
            lines: [
                `paid_unfulfilled_count=${metrics.paid_unfulfilled_count}，已持续至少 ${config.paid_unfulfilled_persist_minutes} 分钟。`,
                '支付已确认但尚未 delivered/refunded，含 paid_unfulfillable。立即核对 worker、库存锁和死信队列。'
            ],
            count: metrics.paid_unfulfilled_count,
            sampleOrders: samples,
            extraPayload: {
                persist_minutes: config.paid_unfulfilled_persist_minutes
            },
            dedupeParts: ['critical', String(metrics.paid_unfulfilled_count), sampleOrderNos(samples).join(',')],
            config
        }));
    }

    if (metrics.amount_mismatch_count > 0) {
        const samples = sortByAgeAscending(metrics.buckets.amount_mismatch, 'updated_at');
        alerts.push(buildAlert({
            alertType: 'guest_shop_amount_mismatch',
            severity: 'critical',
            title: `游客支付金额不匹配 ${metrics.amount_mismatch_count} 笔`,
            lines: [
                '出现 amount_mismatch/overpaid/partial。保持 review，不得自动发货。'
            ],
            count: metrics.amount_mismatch_count,
            sampleOrders: samples,
            config
        }));
    }

    if (metrics.payment_review_count > 0) {
        const samples = sortByAgeAscending(metrics.buckets.payment_review, 'updated_at');
        alerts.push(buildAlert({
            alertType: 'guest_shop_payment_review',
            severity: 'warning',
            title: `游客支付待人工复核 ${metrics.payment_review_count} 笔`,
            lines: [
                '支付状态为 review，未满足自动确认条件。provider 查询失败时继续保持 review。'
            ],
            count: metrics.payment_review_count,
            sampleOrders: samples,
            config
        }));
    }

    if (metrics.dead_letter_count > 0) {
        const samples = sortByAgeAscending(metrics.buckets.dead_letter, 'updated_at');
        alerts.push(buildAlert({
            alertType: 'guest_shop_dead_letter',
            severity: 'critical',
            title: `游客履约死信 ${metrics.dead_letter_count} 笔`,
            lines: [
                'dead_letter 任意新增即告警。只允许单笔解锁，禁止批量重放。'
            ],
            count: metrics.dead_letter_count,
            sampleOrders: samples,
            config
        }));
    }

    if (metrics.refund_hanging_count > 0) {
        const samples = sortByAgeAscending(metrics.buckets.refund_hanging, 'updated_at');
        const severity = metrics.refund_hanging_critical_count > 0 ? 'critical' : 'warning';
        alerts.push(buildAlert({
            alertType: 'guest_shop_refund_hanging',
            severity,
            title: severity === 'critical'
                ? `游客退款悬挂/失败 ${metrics.refund_hanging_count} 笔，需升级财务`
                : `游客退款悬挂 ${metrics.refund_hanging_count} 笔（超过${config.refund_pending_warn_minutes}分钟）`,
            lines: [
                `refund_pending 超过 ${config.refund_pending_warn_minutes} 分钟告警，超过 ${config.refund_pending_critical_minutes} 分钟或 failed/manual_review 升级。`,
                'NOWPayments 退款仍走人工队列；网关超时不得盲目重复退款。'
            ],
            count: metrics.refund_hanging_count,
            sampleOrders: samples,
            extraPayload: {
                critical_count: metrics.refund_hanging_critical_count,
                warn_minutes: config.refund_pending_warn_minutes,
                critical_minutes: config.refund_pending_critical_minutes
            },
            config
        }));
    }

    if (metrics.reservation_expired_count > Number(config.reservation_expired_count_threshold)) {
        const orderNoById = new Map((orders || []).map((order) => [normalizeText(order?.id, 80), normalizeText(order?.order_no, 80)]));
        const samples = (metrics.recently_expired_reservations || [])
            .map((row) => ({
                order_no: orderNoById.get(normalizeText(row.order_id, 80)) || normalizeText(row.order_no, 80) || normalizeText(row.order_id, 80),
                reserved_until: row.reserved_until
            }));
        alerts.push(buildAlert({
            alertType: 'guest_shop_reservation_expired',
            severity: 'warning',
            title: `游客预占过期 ${metrics.reservation_expired_count} 笔（${config.reservation_expired_window_minutes}分钟窗口）`,
            lines: [
                `${config.reservation_expired_window_minutes} 分钟内 held 过期 ${metrics.reservation_expired_count} 笔，阈值 ${config.reservation_expired_count_threshold}。`,
                '检查释放 worker 与库存锁，不要手工把库存改成 sold。'
            ],
            count: metrics.reservation_expired_count,
            sampleOrders: samples,
            extraPayload: {
                window_minutes: config.reservation_expired_window_minutes,
                threshold: config.reservation_expired_count_threshold,
                total_expired_held: metrics.reservation_expired_total
            },
            config
        }));
    }

    const sampleCount = metrics.fulfillment_sample_count;
    const p95 = metrics.fulfillment_p95_seconds;
    const p99 = metrics.fulfillment_p99_seconds;
    if (sampleCount >= Number(config.fulfillment_min_samples)) {
        const p99Breach = Number.isFinite(p99) && p99 > Number(config.fulfillment_p99_seconds);
        const p95Breach = Number.isFinite(p95) && p95 > Number(config.fulfillment_p95_seconds);
        if (p95Breach || p99Breach) {
            const severity = p99Breach ? 'critical' : 'warning';
            alerts.push(buildAlert({
                alertType: 'guest_shop_fulfillment_latency',
                severity,
                title: p99Breach
                    ? `游客履约 P99 ${Math.round(p99)}s 超过 ${config.fulfillment_p99_seconds}s`
                    : `游客履约 P95 ${Math.round(p95)}s 超过 ${config.fulfillment_p95_seconds}s`,
                lines: [
                    `近 24 小时 delivered 样本 ${sampleCount} 笔。`,
                    `P95=${Number.isFinite(p95) ? Math.round(p95) : 'n/a'}s（阈值 ${config.fulfillment_p95_seconds}s），P99=${Number.isFinite(p99) ? Math.round(p99) : 'n/a'}s（阈值 ${config.fulfillment_p99_seconds}s）。`
                ],
                count: sampleCount,
                extraPayload: {
                    fulfillment_p95_seconds: p95,
                    fulfillment_p99_seconds: p99,
                    sample_count: sampleCount
                },
                dedupeParts: [severity, String(Math.round(p95 || 0)), String(Math.round(p99 || 0)), String(sampleCount)],
                config
            }));
        }
    }

    return { metrics, alerts };
}

async function fetchPagedRows(buildQuery, pageSize = 500, maxPages = 10) {
    const rows = [];
    for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await buildQuery().range(from, to);
        if (error) throw error;
        const batch = Array.isArray(data) ? data : [];
        rows.push(...batch);
        if (batch.length < pageSize) break;
    }
    return rows;
}

async function fetchGuestShopMonitorOrders(client, sinceIso, config) {
    assertSafeSelect(GUEST_SHOP_ORDER_MONITOR_COLUMNS);
    return fetchPagedRows(() => client
        .from('guest_shop_orders')
        .select(GUEST_SHOP_ORDER_MONITOR_COLUMNS)
        .gte('updated_at', sinceIso)
        .order('updated_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchGuestShopMonitorPayments(client, sinceIso, config) {
    assertSafeSelect(GUEST_SHOP_PAYMENT_MONITOR_COLUMNS);
    return fetchPagedRows(() => client
        .from('guest_shop_payment_orders')
        .select(GUEST_SHOP_PAYMENT_MONITOR_COLUMNS)
        .gte('updated_at', sinceIso)
        .order('updated_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchGuestShopMonitorReservations(client, nowIso, config) {
    assertSafeSelect(GUEST_SHOP_RESERVATION_MONITOR_COLUMNS);
    return fetchPagedRows(() => client
        .from('guest_shop_inventory_reservations')
        .select(GUEST_SHOP_RESERVATION_MONITOR_COLUMNS)
        .eq('status', 'held')
        .lte('reserved_until', nowIso)
        .order('reserved_until', { ascending: true }), config.page_size, config.max_pages);
}

function emptySweepResult(skipped, extra = {}) {
    return {
        skipped,
        source: 'guest_shop_monitor',
        paid_unfulfilled_count: 0,
        amount_mismatch_count: 0,
        payment_review_count: 0,
        dead_letter_count: 0,
        refund_hanging_count: 0,
        reservation_expired_count: 0,
        fulfillment_sample_count: 0,
        fulfillment_p95_seconds: null,
        fulfillment_p99_seconds: null,
        alert_count: 0,
        queued: 0,
        deduped: 0,
        skipped_no_channels: 0,
        skipped_enqueue: 0,
        results: [],
        ...extra
    };
}

async function runGuestShopAlertSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const config = normalizeGuestShopMonitorConfig(
        options.config && typeof options.config === 'object' ? options.config : {},
        env
    );

    if (!config.enabled) {
        return emptySweepResult('monitor_disabled');
    }

    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const sinceIso = new Date(nowDate.getTime() - Number(config.lookback_days) * 24 * 60 * 60 * 1000).toISOString();
    const [orders, payments, reservations] = await Promise.all([
        fetchGuestShopMonitorOrders(supabase, sinceIso, config),
        fetchGuestShopMonitorPayments(supabase, sinceIso, config),
        fetchGuestShopMonitorReservations(supabase, nowDate.toISOString(), config)
    ]);
    const { metrics, alerts } = buildGuestShopMonitorAlerts(orders, payments, reservations, config, { now: nowDate });

    const summary = {
        skipped: null,
        source: 'guest_shop_monitor',
        paid_unfulfilled_count: metrics.paid_unfulfilled_count,
        amount_mismatch_count: metrics.amount_mismatch_count,
        payment_review_count: metrics.payment_review_count,
        dead_letter_count: metrics.dead_letter_count,
        refund_hanging_count: metrics.refund_hanging_count,
        reservation_expired_count: metrics.reservation_expired_count,
        fulfillment_sample_count: metrics.fulfillment_sample_count,
        fulfillment_p95_seconds: metrics.fulfillment_p95_seconds,
        fulfillment_p99_seconds: metrics.fulfillment_p99_seconds,
        alert_count: alerts.length,
        queued: 0,
        deduped: 0,
        skipped_no_channels: 0,
        skipped_enqueue: 0,
        results: []
    };

    const shouldLog = alerts.length > 0
        || metrics.paid_unfulfilled_count > 0
        || metrics.dead_letter_count > 0
        || metrics.amount_mismatch_count > 0
        || metrics.payment_review_count > 0
        || metrics.refund_hanging_count > 0
        || metrics.reservation_expired_count > 0;
    if (shouldLog) {
        console.log('[GuestShopMonitor] Metrics:', JSON.stringify({
            paid_unfulfilled_count: summary.paid_unfulfilled_count,
            amount_mismatch_count: summary.amount_mismatch_count,
            payment_review_count: summary.payment_review_count,
            dead_letter_count: summary.dead_letter_count,
            refund_hanging_count: summary.refund_hanging_count,
            reservation_expired_count: summary.reservation_expired_count,
            fulfillment_p95_seconds: summary.fulfillment_p95_seconds,
            fulfillment_p99_seconds: summary.fulfillment_p99_seconds,
            alert_count: summary.alert_count,
            ops_alerts_enabled: runtime?.config?.enabled === true
        }));
    }

    if (!runtime?.config?.enabled) {
        summary.skipped = 'ops_alerts_disabled';
        return summary;
    }

    for (const alert of alerts) {
        let result = { queued: false, reason: 'skipped' };
        try {
            result = await enqueueOpsAlertJob(supabase, {
                ...alert,
                createdAt: nowDate.toISOString(),
                source: 'guest_shop_monitor'
            }, {
                runtime,
                env,
                now: nowDate,
                skipSummary: true
            });
        } catch (error) {
            result = {
                queued: false,
                reason: 'enqueue_failed',
                error: normalizeText(error?.message || error, 180)
            };
            summary.skipped_enqueue += 1;
        }

        if (result?.queued === true) {
            summary.queued += 1;
        } else if (result?.reason === 'deduped') {
            summary.deduped += 1;
        } else if (result?.reason === 'no_active_channels') {
            summary.skipped_no_channels += 1;
        } else if (result?.reason && result.reason !== 'enqueue_failed') {
            summary.skipped_enqueue += 1;
        }

        summary.results.push({
            alert_type: alert.alertType,
            severity: alert.severity,
            count: alert.payload?.count || 0,
            order_nos: alert.payload?.order_nos || [],
            queued: result?.queued === true,
            reason: result?.reason || null
        });
    }

    return summary;
}

module.exports = {
    DEFAULT_GUEST_SHOP_MONITOR_CONFIG,
    GUEST_SHOP_ALERT_TYPES,
    GUEST_SHOP_ORDER_MONITOR_COLUMNS,
    GUEST_SHOP_PAYMENT_MONITOR_COLUMNS,
    GUEST_SHOP_RESERVATION_MONITOR_COLUMNS,
    buildGuestShopMonitorAlerts,
    classifyGuestShopMonitorOrder,
    computeGuestShopMonitorMetrics,
    normalizeGuestShopMonitorConfig,
    percentile,
    runGuestShopAlertSweep,
    __testUtils: {
        fetchGuestShopMonitorOrders,
        fetchGuestShopMonitorPayments,
        fetchGuestShopMonitorReservations,
        getFulfillmentLatencySeconds,
        getRefundQueuedAt,
        sampleOrderNos
    }
};
