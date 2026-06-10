const crypto = require('crypto');
const {
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    getPaymentProviderAdapter
} = require('../../../../api/_lib/payments/provider-adapters');
const {
    loadOrderItemsByOrderIds,
    loadInventoryRecordsByIds,
    collectLinkedInventoryIds,
    buildLinkedInventoryItems
} = require('../shop/_order-linkage');
const {
    buildOrderProfitAttribution,
    isRefundedOrder
} = require('../shop/_profit');
const {
    loadPointLotConsumptionsByOrderIds,
    summarizePointLotConsumptions
} = require('../shop/_point-lots');

const EVENT_OK_RESULTS = new Set([
    'processed_paid',
    'received',
    'ignored_pending',
    'ignored_non_success_ec',
    'ignored_non_order_event',
    'ignored_non_paid_status',
    'admin_refund_processed',
    'admin_refund_synced_refunded'
]);
const SESSION_OPEN_STATUSES = new Set(['created', 'redirect_ready']);
const SESSION_FAILURE_STATUSES = new Set(['failed', 'expired', 'cancelled']);
const SESSION_LINK_FEATURE_START_ISO = '2026-03-21T00:00:00.000Z';
const PENDING_PROVIDER_ORDER_PREFIX = 'PENDING_';
const REFUNDABLE_GATEWAY_ORDER_STATUSES = new Set(['pending_review', 'amount_mismatch', 'paid', 'redeemed']);
const RECONCILABLE_GATEWAY_ORDER_STATUSES = new Set(['pending', 'pending_review', 'amount_mismatch']);
const GATEWAY_ACTION_META = Object.freeze({
    hupijiao: Object.freeze({
        key: 'hupijiao',
        queryAction: 'query_hupijiao_order',
        reconcileAction: 'reconcile_hupijiao_order',
        refundAction: 'refund_hupijiao',
        queryMetadataKeys: ['provider_order_no', 'gateway_open_order_id', 'open_order_id']
    }),
    zpay: Object.freeze({
        key: 'zpay',
        queryAction: 'query_zpay_order',
        reconcileAction: 'reconcile_zpay_order',
        refundAction: 'refund_zpay',
        queryMetadataKeys: ['provider_order_no', 'trade_no']
    }),
    nowpayments: Object.freeze({
        key: 'nowpayments',
        queryAction: 'query_nowpayments_order',
        reconcileAction: '',
        refundAction: 'refund_nowpayments',
        queryMetadataKeys: ['payment_id', 'nowpayments_payment_id', 'provider_payment_id']
    })
});
const QUERY_OUTCOME_META = Object.freeze({
    success: { label: '查码成功', severity: 'info' },
    missing_order_no: { label: '未填写订单号', severity: 'info' },
    unauthenticated: { label: '未登录查询', severity: 'warning' },
    access_denied: { label: '订单归属冲突', severity: 'critical' },
    query_rpc_failed: { label: '查码 RPC 失败', severity: 'critical' },
    not_found: { label: '未找到订单', severity: 'warning' },
    rejected: { label: '订单已被拦截', severity: 'critical' },
    amount_mismatch: { label: '订单金额异常', severity: 'critical' },
    code_pending: { label: '兑换码未就绪', severity: 'warning' },
    query_exception: { label: '查码接口异常', severity: 'critical' }
});
const REFUND_FAILURE_EVENT_META = Object.freeze({
    admin_refund_failed: {
        title: '退款失败已补回',
        message: '网关退款失败，但系统已自动补回之前扣回的积分，请复核退款通道返回值。',
        severity: 'warning',
        topicKey: 'refund_failures',
        topicLabel: '退款失败'
    },
    admin_refund_reclaim_failed: {
        title: '退款积分扣回失败',
        message: '已入账订单在退款前无法安全扣回积分，系统已停止继续发起网关退款。',
        severity: 'critical',
        topicKey: 'refund_reclaim_failures',
        topicLabel: '扣回失败'
    },
    admin_refund_compensation_failed: {
        title: '退款积分回滚失败',
        message: '网关退款失败后，系统自动补回积分也失败了，需要立即人工修复账务。',
        severity: 'critical',
        topicKey: 'refund_compensation_failures',
        topicLabel: '回滚失败'
    }
});
const REFUND_EXCEPTION_TOPIC_META = Object.freeze([
    {
        key: 'refund_failures',
        label: '退款失败',
        severity: 'warning',
        description: '网关退款失败，但系统已自动补回积分，仍需复核通道响应和重复提交风险。'
    },
    {
        key: 'refund_reclaim_failures',
        label: '扣回失败',
        severity: 'critical',
        description: '已入账订单在退款前无法安全扣回积分，当前退款已 fail-closed 停止。'
    },
    {
        key: 'refund_compensation_failures',
        label: '回滚失败',
        severity: 'critical',
        description: '退款失败后自动补回积分也失败了，需要立刻人工对账修复。'
    }
]);
const OPS_ALERT_JOB_OPEN_STATUSES = new Set(['pending', 'retry', 'processing', 'dead_letter']);
const OPS_ALERT_JOB_QUEUE_VISIBLE_STATUSES = new Set(['pending', 'retry', 'processing', 'dead_letter', 'handled', 'ignored']);
const OPS_ALERT_JOB_STATUS_PRIORITY = Object.freeze({
    dead_letter: 0,
    retry: 1,
    pending: 2,
    processing: 3,
    handled: 4,
    ignored: 5,
    delivered: 6
});
const TREND_FAILED_EVENT_RESULTS = new Set([
    'webhook_exception',
    'process_rpc_failed',
    'missing_signature',
    'invalid_order_no',
    'missing_afdian_token',
    'missing_zpay_pkey',
    'admin_refund_failed',
    'admin_refund_reclaim_failed',
    'admin_refund_compensation_failed'
]);
const SUMMARY_PAGE_SIZES = Object.freeze({
    default: 1000,
    heavy: 5000,
    anomalyCases: 2000,
    opsAlertJobs: 5000
});

function getIsoDaysAgo(days) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - Math.max(1, days));
    return date.toISOString();
}

function getIsoHoursAgo(hours) {
    const date = new Date();
    date.setUTCHours(date.getUTCHours() - Math.max(1, hours));
    return date.toISOString();
}

function parseIsoQueryDate(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return null;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

function formatHourBucket(dateLike) {
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) return '';
    const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${date.getUTCDate()}`.padStart(2, '0');
    const hour = `${date.getUTCHours()}`.padStart(2, '0');
    return `${month}-${day} ${hour}:00`;
}

function formatDayBucket(dateLike) {
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) return '';
    const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${date.getUTCDate()}`.padStart(2, '0');
    return `${month}-${day}`;
}

function getUtcDayKey(dateLike) {
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
}

function buildUtcDayBuckets(startIso, endIso) {
    const startDate = new Date(startIso);
    const endDate = new Date(endIso || Date.now());

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return [];
    }

    const cursor = new Date(Date.UTC(
        startDate.getUTCFullYear(),
        startDate.getUTCMonth(),
        startDate.getUTCDate()
    ));
    const last = new Date(Date.UTC(
        endDate.getUTCFullYear(),
        endDate.getUTCMonth(),
        endDate.getUTCDate()
    ));
    const buckets = [];

    while (cursor.getTime() <= last.getTime()) {
        const key = cursor.toISOString().slice(0, 10);
        buckets.push({
            key,
            label: formatDayBucket(cursor)
        });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return buckets;
}

function isEventAnomaly(event) {
    if (!event) return false;
    const processingResult = String(event.processing_result || '').trim();
    return (
        event.signature_valid === false
        || event.amount_valid === false
        || Boolean(String(event.error_message || '').trim())
        || (processingResult && !EVENT_OK_RESULTS.has(processingResult))
    );
}

function isOrderAnomaly(order) {
    if (!order) return false;
    return (
        ['pending_review', 'rejected', 'amount_mismatch'].includes(order.status)
        || (order.status === 'paid' && !order.user_id)
        || (order.checkout_session_required && !order.checkout_session_matched)
        || Boolean(String(order.last_error || '').trim())
    );
}

function buildOrderAnomaly(order) {
    let title = '订单待人工处理';
    let message = '请检查订单状态、金额和认领情况。';
    let severity = 'warning';

    if (order.status === 'amount_mismatch') {
        title = '订单金额不匹配';
        message = '支付金额与套餐期望金额不一致，建议人工复核。';
        severity = 'critical';
    } else if (order.status === 'rejected') {
        title = '订单签名校验失败';
        message = '该订单被系统拒绝，请检查回调签名和来源。';
        severity = 'critical';
    } else if (order.status === 'pending_review') {
        title = '订单待审核';
        message = order.last_error ? String(order.last_error) : '套餐匹配、金额校验或回调参数存在异常。';
        severity = 'warning';
    } else if (order.checkout_session_required && !order.checkout_session_matched) {
        title = '支付意图未回填';
        message = '该订单已进入标准支付流，但尚未回填对应的 checkout session，建议检查会话关联。';
        severity = 'warning';
    } else if (order.status === 'paid' && !order.user_id) {
        title = '已支付但未认领';
        message = '用户尚未在钱包输入订单号完成认领。';
        severity = 'info';
    }

    return {
        type: 'order',
        id: order.id,
        provider: order.provider,
        provider_order_no: order.provider_order_no,
        status: order.status,
        user_id: order.user_id || null,
        claimed_at: order.claimed_at || null,
        checkout_session_id: order.checkout_session_id || null,
        checkout_session_required: Boolean(order.checkout_session_required),
        checkout_session_matched: Boolean(order.checkout_session_matched),
        provider_metadata: normalizeJsonObject(order.provider_metadata),
        severity,
        title,
        message,
        created_at: order.created_at,
        site: order.site || null
    };
}

function buildEventAnomaly(event) {
    let title = '回调异常';
    let message = String(event.error_message || '').trim() || String(event.processing_result || '').trim() || '支付回调需要人工检查。';
    let severity = 'warning';
    const processingResult = String(event.processing_result || '').trim();
    const refundMeta = REFUND_FAILURE_EVENT_META[processingResult];

    if (event.signature_valid === false) {
        title = '回调签名异常';
        message = message || '签名校验失败。';
        severity = 'critical';
    } else if (event.amount_valid === false) {
        title = '回调金额异常';
        message = message || '回调金额与订单期望不一致。';
        severity = 'critical';
    } else if (String(event.processing_result || '').trim() === 'webhook_exception') {
        title = '回调处理异常';
        severity = 'critical';
    } else if (refundMeta) {
        title = refundMeta.title;
        message = String(event.error_message || '').trim() || refundMeta.message;
        severity = refundMeta.severity;
    }

    return {
        type: 'event',
        id: event.id,
        provider: event.provider,
        provider_order_no: event.provider_order_no,
        status: event.processing_result || event.event_type || 'webhook',
        severity,
        title,
        message,
        created_at: event.created_at
    };
}

function normalizeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

function isPendingProviderOrderNo(value) {
    return String(value || '').trim().toUpperCase().startsWith(PENDING_PROVIDER_ORDER_PREFIX);
}

function isIntentOnlyPaymentOrder(order) {
    const metadata = normalizeJsonObject(order?.provider_metadata);
    const status = String(order?.status || '').trim().toLowerCase();
    return status === 'pending' && (
        metadata.provider_order_resolved === false
        || metadata.provider_order_pending === true
        || metadata.order_origin === 'payment_checkout_session'
        || isPendingProviderOrderNo(order?.provider_order_no)
    );
}

function filterVisiblePaymentOrders(orders) {
    return (orders || []).filter((order) => !isIntentOnlyPaymentOrder(order));
}

function getQueryOutcomeMeta(outcomeCode) {
    return QUERY_OUTCOME_META[String(outcomeCode || '').trim().toLowerCase()] || {
        label: String(outcomeCode || '查码异常'),
        severity: 'warning'
    };
}

function getSessionLinkedBy(session) {
    const metadata = normalizeJsonObject(session?.provider_metadata);
    return String(metadata.linked_by || '').trim() || null;
}

function getSessionProviderOrderNo(session) {
    const metadata = normalizeJsonObject(session?.provider_metadata);
    return String(metadata.provider_order_no || metadata.order_no || '').trim() || null;
}

function getSessionAgeMinutes(session) {
    const createdAt = Number(new Date(session?.created_at || 0).getTime());
    if (!Number.isFinite(createdAt) || createdAt <= 0) return 0;
    return Math.max(0, Math.round((Date.now() - createdAt) / 60000));
}

function isCheckoutSessionEligibleOrder(order) {
    if (!order) return false;
    const provider = String(order.provider || '').trim().toLowerCase();
    if (!['mock', 'afdian', 'hupijiao', 'zpay', 'nowpayments'].includes(provider)) return false;

    const metadata = normalizeJsonObject(order.provider_metadata);
    if (order.checkout_session_id) return true;
    if (metadata.checkout_session_id || metadata.checkout_session_key) return true;

    const createdAt = Number(new Date(order.created_at || 0).getTime());
    const featureStart = Number(new Date(SESSION_LINK_FEATURE_START_ISO).getTime());
    return Number.isFinite(createdAt) && createdAt >= featureStart;
}

function buildCheckoutSessionAnomaly(session) {
    if (!session) return null;

    const status = String(session.status || '').trim().toLowerCase();
    const ageMinutes = getSessionAgeMinutes(session);
    const providerOrderNo = getSessionProviderOrderNo(session);
    const sessionRef = providerOrderNo || session.session_key || String(session.id || '');
    const linkedBy = getSessionLinkedBy(session);

    if (SESSION_FAILURE_STATUSES.has(status)) {
        return {
            type: 'session',
            id: session.id,
            provider: session.provider,
            provider_order_no: sessionRef,
            session_key: session.session_key || null,
            status,
            user_id: session.user_id || null,
            severity: 'warning',
            title: '支付意图失败',
            message: String(session.error_message || '').trim() || '支付意图创建后未能顺利完成，请检查通道配置与跳转链路。',
            created_at: session.created_at,
            site: session.site || null,
            linked_by: linkedBy
        };
    }

    if (!session.payment_order_id && status === 'completed') {
        return {
            type: 'session',
            id: session.id,
            provider: session.provider,
            provider_order_no: sessionRef,
            session_key: session.session_key || null,
            status,
            user_id: session.user_id || null,
            severity: 'critical',
            title: '支付意图已完成但未回填',
            message: '支付意图已进入完成态，但最终 payment_order 尚未建立关联，建议人工复核。',
            created_at: session.created_at,
            site: session.site || null,
            linked_by: linkedBy
        };
    }

    if (!session.payment_order_id && SESSION_OPEN_STATUSES.has(status) && ageMinutes >= 30) {
        return {
            type: 'session',
            id: session.id,
            provider: session.provider,
            provider_order_no: sessionRef,
            session_key: session.session_key || null,
            status,
            user_id: session.user_id || null,
            severity: ageMinutes >= 180 ? 'critical' : 'warning',
            title: '支付意图待回填',
            message: `支付入口已创建 ${ageMinutes} 分钟，但仍未匹配最终订单，建议检查 webhook 或认领链路。`,
            created_at: session.created_at,
            site: session.site || null,
            linked_by: linkedBy
        };
    }

    return null;
}

const PAYMENT_INTENT_EXCEPTION_TOPIC_META = [
    {
        key: 'payment_intent_failed',
        label: '支付意图失败',
        severity: 'warning',
        description: '支付意图创建或拉起失败，请检查通道参数、跳转结果与 checkout session 状态。'
    },
    {
        key: 'payment_intent_unlinked',
        label: '支付意图未回填',
        severity: 'critical',
        description: '支付意图已完成，但最终订单尚未建立关联，建议优先补查回填链路。'
    },
    {
        key: 'payment_intent_stale',
        label: '支付意图待回填',
        severity: 'warning',
        description: '支付意图长时间未匹配正式订单，需要检查 webhook、认领或兜底链路。'
    }
];

function buildPaymentIntentTopicItems(sessions) {
    return (sessions || [])
        .map((session) => {
            const anomaly = buildCheckoutSessionAnomaly(session);
            if (!anomaly) return null;

            let topicMeta = null;
            if (anomaly.title === '支付意图失败') {
                topicMeta = PAYMENT_INTENT_EXCEPTION_TOPIC_META[0];
            } else if (anomaly.title === '支付意图已完成但未回填') {
                topicMeta = PAYMENT_INTENT_EXCEPTION_TOPIC_META[1];
            } else if (anomaly.title === '支付意图待回填') {
                topicMeta = PAYMENT_INTENT_EXCEPTION_TOPIC_META[2];
            }
            if (!topicMeta) return null;

            return {
                ...anomaly,
                topic_key: topicMeta.key,
                topic_label: topicMeta.label
            };
        })
        .filter(Boolean)
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
}

function buildCheckoutSessionTrace(session) {
    if (!session) return null;

    const metadata = normalizeJsonObject(session.provider_metadata);
    return {
        id: session.id || null,
        provider: session.provider || null,
        provider_order_no: getSessionProviderOrderNo(session),
        session_key: session.session_key || null,
        user_id: session.user_id || null,
        site: session.site || null,
        package_name: session.package_name || null,
        requested_points: normalizeNumber(session.requested_points, 0),
        bonus_points: normalizeNumber(session.bonus_points, 0),
        granted_points: normalizeNumber(session.granted_points, 0),
        expected_amount: normalizeNumber(session.expected_amount, 0),
        status: String(session.status || '').trim().toLowerCase() || 'created',
        payment_order_id: session.payment_order_id || null,
        linked_by: getSessionLinkedBy(session),
        linked_at: metadata.linked_at || null,
        query_mode: session.query_mode || null,
        has_checkout_url: Boolean(String(session.checkout_url || '').trim()),
        error_message: String(session.error_message || '').trim() || null,
        expires_at: session.expires_at || null,
        completed_at: session.completed_at || null,
        created_at: session.created_at || null,
        updated_at: session.updated_at || null
    };
}

function buildAnomalyCaseKey(targetType, targetId) {
    return `${String(targetType || '').trim().toLowerCase()}:${String(targetId || '').trim()}`;
}

function isArchivedOpsStatus(status) {
    return String(status || '').trim().toLowerCase() === 'archived';
}

function isResolvedOpsStatus(status) {
    return ['handled', 'ignored', 'approved', 'rejected', 'archived'].includes(String(status || '').trim().toLowerCase());
}

function getGatewayActionMeta(providerKey = '') {
    return GATEWAY_ACTION_META[String(providerKey || '').trim().toLowerCase()] || null;
}

function getGatewayActionMetaFromItem(item) {
    return getGatewayActionMeta(item?.provider);
}

function pickNowpaymentsPaymentId(...values) {
    for (const value of values) {
        const normalized = String(value || '').trim().slice(0, 120);
        if (!normalized) continue;
        if (/^np[a-z0-9]+$/i.test(normalized)) continue;
        return normalized;
    }
    return '';
}

function canRefundGatewayOrder(item, providerKey = '') {
    if (!item) return false;
    if ((item?.type && item.type !== 'order')) return false;
    const meta = getGatewayActionMeta(providerKey);
    if (!meta) return false;
    if (String(item?.provider || '').trim().toLowerCase() !== meta.key) return false;
    // NOWPayments refunds require a separate payout workflow, so hide the action until that flow exists.
    if (meta.key === 'nowpayments') return false;

    const status = String(item?.status || '').trim().toLowerCase();
    if (!REFUNDABLE_GATEWAY_ORDER_STATUSES.has(status)) return false;
    if ((status === 'redeemed' || Boolean(String(item?.claimed_at || '').trim())) && !item?.user_id) return false;

    const metadata = normalizeJsonObject(item?.provider_metadata);
    const refundStatus = String(metadata.refund_status || '').trim().toLowerCase();
    return !['refunded', 'refund_pending'].includes(refundStatus);
}

function canQueryGatewayOrder(item, providerKey = '') {
    if (!item) return false;
    if ((item?.type && item.type !== 'order')) return false;
    const meta = getGatewayActionMeta(providerKey);
    if (!meta) return false;
    if (String(item?.provider || '').trim().toLowerCase() !== meta.key) return false;

    const metadata = normalizeJsonObject(item?.provider_metadata);
    if (meta.key === 'nowpayments') {
        return Boolean(pickNowpaymentsPaymentId(
            metadata.payment_id,
            metadata.nowpayments_payment_id,
            metadata.provider_payment_id
        ));
    }

    if (String(item?.provider_order_no || metadata.provider_order_no || '').trim()) {
        return true;
    }

    return meta.queryMetadataKeys.some((field) => Boolean(String(metadata[field] || '').trim()));
}

function canReconcileGatewayOrder(item, providerKey = '') {
    if (!canQueryGatewayOrder(item, providerKey)) return false;
    if (!String(item?.user_id || '').trim()) return false;

    const status = String(item?.status || '').trim().toLowerCase();
    return RECONCILABLE_GATEWAY_ORDER_STATUSES.has(status);
}

function canReconcileCheckoutSession(item) {
    if (!item || (item?.type && item.type !== 'order')) return false;
    if (!String(item?.user_id || '').trim()) return false;
    if (!item.checkout_session_required || item.checkout_session_matched || item.checkout_session_id) return false;
    const metadata = normalizeJsonObject(item?.provider_metadata);
    const refundStatus = String(metadata.refund_status || '').trim().toLowerCase();
    if (['refunded', 'refund_pending'].includes(refundStatus)) return false;

    const status = String(item?.status || '').trim().toLowerCase();
    return ['paid', 'redeemed'].includes(status);
}

function canRefundHupijiaoOrder(item) {
    return canRefundGatewayOrder(item, 'hupijiao');
}

function canQueryHupijiaoOrder(item) {
    return canQueryGatewayOrder(item, 'hupijiao');
}

function canReconcileHupijiaoOrder(item) {
    return canReconcileGatewayOrder(item, 'hupijiao');
}

function canRefundZpayOrder(item) {
    return canRefundGatewayOrder(item, 'zpay');
}

function canQueryZpayOrder(item) {
    return canQueryGatewayOrder(item, 'zpay');
}

function canReconcileZpayOrder(item) {
    return canReconcileGatewayOrder(item, 'zpay');
}

async function enrichRecentOrdersWithGatewayRefundHints(orders = [], supabase, env = process.env) {
    if (!Array.isArray(orders) || !orders.length || !supabase) {
        return Array.isArray(orders) ? orders : [];
    }

    const runtimeContextPromises = new Map();

    return Promise.all(orders.map(async (order) => {
        const meta = getGatewayActionMetaFromItem(order);
        if (!meta || !canRefundGatewayOrder(order, meta.key)) {
            return order;
        }

        const adapter = getPaymentProviderAdapter(meta.key);
        if (!adapter || typeof adapter.resolveRuntimeContext !== 'function' || typeof adapter.queryOrder !== 'function') {
            return order;
        }

        const metadata = normalizeJsonObject(order?.provider_metadata);
        const orderSite = String(order?.site || metadata.site || '').trim().toLowerCase();
        const runtimeContextKey = `${meta.key}:${orderSite || 'cn'}`;

        try {
            if (!runtimeContextPromises.has(runtimeContextKey)) {
                runtimeContextPromises.set(runtimeContextKey, Promise.resolve(adapter.resolveRuntimeContext({
                    supabase,
                    env,
                    site: orderSite
                })));
            }

            const runtimeContext = await runtimeContextPromises.get(runtimeContextKey);
            const liveOrder = await adapter.queryOrder({
                runtimeContext,
                providerOrderNo: String(order?.provider_order_no || metadata.provider_order_no || '').trim(),
                openOrderId: String(metadata.gateway_open_order_id || metadata.open_order_id || '').trim(),
                tradeNo: String(metadata.trade_no || metadata.transaction_id || '').trim(),
                paymentId: pickNowpaymentsPaymentId(
                    metadata.payment_id,
                    metadata.nowpayments_payment_id,
                    metadata.provider_payment_id
                ),
                metadata
            });

            if (liveOrder?.supported === false || liveOrder?.success === false) {
                return order;
            }

            const liveStatus = String(liveOrder?.status || '').trim().toLowerCase();
            if (!['refunded', 'refund_pending'].includes(liveStatus)) {
                return order;
            }

            return {
                ...order,
                provider_metadata: {
                    ...metadata,
                    refund_status: liveStatus,
                    payment_status: liveStatus,
                    payment_status_raw: String(liveOrder?.statusRaw || metadata.payment_status_raw || '').trim() || undefined,
                    trade_no: String(liveOrder?.tradeNo || metadata.trade_no || metadata.transaction_id || '').trim() || undefined,
                    transaction_id: String(liveOrder?.transactionId || liveOrder?.tradeNo || metadata.transaction_id || metadata.trade_no || '').trim() || undefined
                }
            };
        } catch (error) {
            return order;
        }
    }));
}

function getOrderAvailableActions(order) {
    const meta = getGatewayActionMetaFromItem(order);
    if (!meta) return [];

    const actions = [];
    if (canQueryGatewayOrder(order, meta.key)) {
        actions.push(meta.queryAction);
    }
    if (canReconcileGatewayOrder(order, meta.key)) {
        if (meta.reconcileAction) actions.push(meta.reconcileAction);
    }
    if (canReconcileCheckoutSession(order)) {
        actions.push('reconcile_checkout_session');
    }
    if (canRefundGatewayOrder(order, meta.key)) {
        actions.push(meta.refundAction);
    }
    return actions;
}

function normalizeStringArray(value) {
    return Array.isArray(value)
        ? value.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
}

function getOpsAlertJobAvailableActions(job) {
    const status = String(job?.status || '').trim().toLowerCase();

    if (status === 'dead_letter') {
        return ['request_retry', 'mark_handled'];
    }

    if (status === 'handled' || status === 'ignored') {
        return ['reopen'];
    }

    if (status === 'pending' || status === 'retry' || status === 'processing') {
        return ['mark_handled', 'ignore'];
    }

    return [];
}

function matchesOpsAlertJobSite(job, site) {
    if (!site) return true;
    const payload = normalizeJsonObject(job?.payload);
    return String(payload.site || '').trim().toLowerCase() === String(site || '').trim().toLowerCase();
}

function buildOpsAlertJobMessage(job, payload) {
    const status = String(job?.status || '').trim().toLowerCase();
    const lastError = String(job?.last_error || '').trim();
    const nextRetryAt = job?.next_retry_at || null;
    const deliveredAt = job?.delivered_at || null;

    if (status === 'dead_letter') {
        return lastError
            ? `站外告警已进入死信队列：${lastError}`
            : '站外告警已进入死信队列，请人工确认渠道配置、网络连通性和重试策略。';
    }
    if (status === 'retry') {
        return nextRetryAt
            ? `站外告警已进入重试队列，计划于 ${new Date(nextRetryAt).toLocaleString('zh-CN')} 再次投递。`
            : '站外告警已进入重试队列，等待下一次投递。';
    }
    if (status === 'processing') {
        return '站外告警正在由后台 worker 投递，请留意是否持续卡在处理中。';
    }
    if (status === 'delivered') {
        return deliveredAt
            ? `站外告警已于 ${new Date(deliveredAt).toLocaleString('zh-CN')} 投递完成。`
            : '站外告警已投递完成。';
    }
    if (status === 'handled') {
        return '该站外告警已人工处理，不会继续自动投递。';
    }
    if (status === 'ignored') {
        return '该站外告警已人工忽略。';
    }

    return String(job?.content || '').trim() || String(payload?.topic_label || '').trim() || '站外告警等待处理。';
}

function buildOpsAlertJobItem(job) {
    const payload = normalizeJsonObject(job?.payload);
    const status = String(job?.status || '').trim().toLowerCase() || 'pending';
    const channels = normalizeStringArray(job?.channels);
    const remainingChannels = normalizeStringArray(job?.remaining_channels);

    return {
        type: 'ops_alert_job',
        id: job.id,
        provider: String(payload.provider || '').trim() || null,
        provider_order_no: String(payload.provider_order_no || '').trim() || null,
        site: String(payload.site || '').trim().toLowerCase() || null,
        severity: status === 'dead_letter'
            ? 'critical'
            : (status === 'retry' ? 'warning' : String(job?.severity || 'warning').trim().toLowerCase()),
        title: String(job?.title || '').trim() || '站外告警',
        message: buildOpsAlertJobMessage(job, payload),
        created_at: job?.created_at || null,
        queue_status: status,
        channels,
        remaining_channels: remainingChannels,
        attempt_count: Number(job?.attempt_count || 0),
        max_attempts: Number(job?.max_attempts || 0),
        next_retry_at: job?.next_retry_at || null,
        delivered_at: job?.delivered_at || null,
        last_error: String(job?.last_error || '').trim() || null,
        ops_status: status,
        ops_resolution: String(job?.last_error || '').trim() || null,
        ops_last_action_at: job?.updated_at || job?.last_attempt_at || job?.created_at || null,
        ops_available_actions: getOpsAlertJobAvailableActions(job)
    };
}

function buildOpsAlertSummary(jobs) {
    const items = (jobs || []).map(buildOpsAlertJobItem);

    return {
        total: items.length,
        pending: items.filter((item) => item.queue_status === 'pending').length,
        retry: items.filter((item) => item.queue_status === 'retry').length,
        processing: items.filter((item) => item.queue_status === 'processing').length,
        delivered: items.filter((item) => item.queue_status === 'delivered').length,
        dead_letter: items.filter((item) => item.queue_status === 'dead_letter').length,
        handled: items.filter((item) => item.queue_status === 'handled').length,
        ignored: items.filter((item) => item.queue_status === 'ignored').length,
        actionable_count: items.filter((item) => OPS_ALERT_JOB_OPEN_STATUSES.has(item.queue_status)).length,
        latest_dead_letter_at: items
            .filter((item) => item.queue_status === 'dead_letter' && item.created_at)
            .map((item) => item.created_at)
            .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null,
        latest_delivered_at: items
            .filter((item) => item.queue_status === 'delivered' && item.delivered_at)
            .map((item) => item.delivered_at)
            .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null
    };
}

function formatShopProfitAuditAmount(value) {
    const amount = roundNumber(value, 2);
    return `¥${amount.toLocaleString('zh-CN', {
        minimumFractionDigits: Math.abs(amount % 1) > 0 ? 2 : 0,
        maximumFractionDigits: 2
    })}`;
}

function formatShopProfitAuditMetric(alert = {}) {
    const metricLabel = String(alert.metric_label || '').trim();
    if (metricLabel) return metricLabel;

    const amount = normalizeNumber(alert.amount_cny, 0);
    const points = normalizeNumber(alert.points, 0);
    if (points > 0) return `${roundNumber(points, 2).toLocaleString('zh-CN')} 积分`;
    if (amount > 0) return formatShopProfitAuditAmount(amount);
    return `${roundNumber(alert.order_count || alert.affected_order_count || 0, 0).toLocaleString('zh-CN')} 笔`;
}

function buildStableUuidFromText(value = '') {
    const hash = crypto
        .createHash('sha256')
        .update(String(value || '').trim())
        .digest('hex');
    const variant = ((Number.parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80)
        .toString(16)
        .padStart(2, '0');

    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        `4${hash.slice(13, 16)}`,
        `${variant}${hash.slice(18, 20)}`,
        hash.slice(20, 32)
    ].join('-');
}

function buildShopProfitOrderFingerprint(orderIds = []) {
    const normalizedIds = Array.from(orderIds instanceof Set ? orderIds : (Array.isArray(orderIds) ? orderIds : []))
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .sort();

    if (!normalizedIds.length) return null;
    return buildStableUuidFromText(`shop-profit-orders:${JSON.stringify(normalizedIds)}`);
}

function getShopProfitAuditSampleOrderKeys(alert = {}) {
    return (Array.isArray(alert.sample_orders) ? alert.sample_orders : [])
        .map((item) => (
            String(item?.order_id || item?.provider_order_no || item?.order_no || item?.id || '').trim()
        ))
        .filter(Boolean)
        .sort();
}

function buildShopProfitAuditTargetFingerprint(alert = {}, site = '') {
    const normalizedType = String(alert.type || '').trim().toLowerCase() || 'unknown';
    const normalizedSite = String(site || '').trim().toLowerCase() || 'all';
    return JSON.stringify({
        site: normalizedSite,
        type: normalizedType,
        case_target_id: String(alert.case_target_id || normalizedType).trim().toLowerCase() || normalizedType,
        affected_order_fingerprint: String(alert.affected_order_fingerprint || '').trim(),
        affected_order_count: roundNumber(alert.order_count ?? alert.affected_order_count ?? 0, 0),
        amount_cny: roundNumber(alert.amount_cny, 4),
        points: roundNumber(alert.points, 2),
        metric_label: String(alert.metric_label || '').trim(),
        sample_orders: getShopProfitAuditSampleOrderKeys(alert)
    });
}

function buildShopProfitAuditTargetId(alert = {}, site = '') {
    return buildStableUuidFromText(`shop-profit-audit:${buildShopProfitAuditTargetFingerprint(alert, site)}`);
}

function getShopProfitAuditAvailableActions(status = '') {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (isArchivedOpsStatus(normalizedStatus)) return [];
    if (isResolvedOpsStatus(normalizedStatus)) return ['reopen'];
    return ['mark_handled', 'ignore'];
}

function resolveShopProfitAuditQueueStatus(status = '') {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (normalizedStatus === 'handled' || normalizedStatus === 'ignored' || normalizedStatus === 'archived') {
        return normalizedStatus;
    }
    return 'pending';
}

function buildShopProfitOpsAlertItems(shopProfitSummary = {}, site = '', anomalyCases = []) {
    const alerts = normalizeJsonObject(shopProfitSummary.shop_profit_audit_alerts);
    const items = Array.isArray(alerts.items) ? alerts.items.filter(Boolean) : [];
    const nowIso = new Date().toISOString();
    const caseMap = new Map(
        (Array.isArray(anomalyCases) ? anomalyCases : [])
            .filter((item) => String(item?.target_type || '').trim().toLowerCase() === 'shop_profit_audit')
            .map((item) => [buildAnomalyCaseKey(item.target_type, item.target_id), item])
    );

    return items
        .filter((item) => item.action_required)
        .map((alert) => {
            const type = String(alert.type || '').trim().toLowerCase() || 'unknown';
            const orderCount = roundNumber(alert.order_count || alert.affected_order_count || 0, 0);
            const metric = formatShopProfitAuditMetric(alert);
            const id = buildShopProfitAuditTargetId(alert, site);
            const linkedCase = caseMap.get(buildAnomalyCaseKey('shop_profit_audit', id));
            const opsStatus = String(linkedCase?.status || 'open').trim().toLowerCase() || 'open';
            const queueStatus = resolveShopProfitAuditQueueStatus(opsStatus);
            return {
                type: 'shop_profit_audit',
                id,
                provider: 'shop_profit',
                provider_order_no: String(alert.case_target_id || type).trim() || type,
                site: String(site || '').trim().toLowerCase() || null,
                severity: normalizeShopProfitAuditSeverity(alert.severity || alert.tone),
                title: String(alert.title || '商城利润审计').trim(),
                message: String(alert.description || '').trim() || '商城净利润审计发现需要处理的风险项。',
                created_at: nowIso,
                queue_status: queueStatus,
                channels: ['shop_profit_audit'],
                remaining_channels: [],
                attempt_count: 0,
                max_attempts: 0,
                next_retry_at: null,
                delivered_at: null,
                last_error: null,
                ops_status: opsStatus,
                ops_note: linkedCase?.note || null,
                ops_resolution: linkedCase?.resolution || `影响 ${orderCount.toLocaleString('zh-CN')} 笔订单 · ${metric}`,
                ops_last_action: linkedCase?.last_action || null,
                ops_last_action_at: linkedCase?.last_action_at || null,
                ops_available_actions: getShopProfitAuditAvailableActions(opsStatus),
                action_label: alert.action_label || null,
                audit_alert_type: type,
                audit_metric: metric,
                affected_order_count: orderCount,
                amount_cny: roundNumber(alert.amount_cny, 4),
                points: roundNumber(alert.points, 2),
                sample_orders: Array.isArray(alert.sample_orders) ? alert.sample_orders.filter(Boolean).slice(0, 4) : []
            };
        });
}

function mergeOpsAlertQueueWithShopProfit(opsAlertJobs = [], shopProfitSummary = {}, site = '', anomalyCases = []) {
    const jobItems = buildOpsAlertQueueItems(opsAlertJobs);
    const shopProfitItems = buildShopProfitOpsAlertItems(shopProfitSummary, site, anomalyCases);
    const combinedItems = [...shopProfitItems, ...jobItems].sort((left, right) => {
        const leftStatusPriority = OPS_ALERT_JOB_STATUS_PRIORITY[left.queue_status] ?? 99;
        const rightStatusPriority = OPS_ALERT_JOB_STATUS_PRIORITY[right.queue_status] ?? 99;
        if (leftStatusPriority !== rightStatusPriority) {
            return leftStatusPriority - rightStatusPriority;
        }

        const severityWeight = { critical: 3, warning: 2, info: 1 };
        const severityDiff = (severityWeight[right.severity] || 0) - (severityWeight[left.severity] || 0);
        if (severityDiff !== 0) return severityDiff;

        return new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
    });

    const jobSummary = buildOpsAlertSummary(opsAlertJobs);
    const activeShopProfitItems = shopProfitItems.filter((item) => OPS_ALERT_JOB_OPEN_STATUSES.has(item.queue_status));
    return {
        summary: {
            ...jobSummary,
            total: jobSummary.total + shopProfitItems.length,
            pending: jobSummary.pending + activeShopProfitItems.length,
            handled: jobSummary.handled + shopProfitItems.filter((item) => item.queue_status === 'handled').length,
            ignored: jobSummary.ignored + shopProfitItems.filter((item) => item.queue_status === 'ignored').length,
            actionable_count: jobSummary.actionable_count + activeShopProfitItems.length,
            shop_profit_audit: shopProfitItems.length,
            shop_profit_audit_critical: shopProfitItems.filter((item) => item.severity === 'critical').length,
            shop_profit_audit_warning: shopProfitItems.filter((item) => item.severity === 'warning').length
        },
        items: combinedItems
    };
}

function buildOpsAlertQueueItems(jobs) {
    return (jobs || [])
        .map(buildOpsAlertJobItem)
        .filter((item) => OPS_ALERT_JOB_QUEUE_VISIBLE_STATUSES.has(item.queue_status))
        .sort((left, right) => {
            const leftPriority = OPS_ALERT_JOB_STATUS_PRIORITY[left.queue_status] ?? 99;
            const rightPriority = OPS_ALERT_JOB_STATUS_PRIORITY[right.queue_status] ?? 99;
            if (leftPriority !== rightPriority) {
                return leftPriority - rightPriority;
            }
            return new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
        });
}

function getAnomalyAvailableActions(item, caseStatus) {
    const normalizedStatus = String(caseStatus || '').trim().toLowerCase();
    const gatewayMeta = getGatewayActionMetaFromItem(item);

    if (isArchivedOpsStatus(normalizedStatus)) {
        return [];
    }

    if (isResolvedOpsStatus(normalizedStatus)) {
        if (normalizedStatus === 'handled' || normalizedStatus === 'approved') {
            return ['reopen', 'archive'];
        }
        return ['reopen'];
    }

    if (item?.type === 'query') {
        return [];
    }

    if (item?.type === 'order' && String(item?.status || '').trim().toLowerCase() === 'amount_mismatch') {
        const actions = [];
        if (gatewayMeta && canQueryGatewayOrder(item, gatewayMeta.key)) actions.push(gatewayMeta.queryAction);
        if (gatewayMeta?.reconcileAction && canReconcileGatewayOrder(item, gatewayMeta.key)) actions.push(gatewayMeta.reconcileAction);
        actions.push('approve_amount_mismatch', 'reject_amount_mismatch');
        if (gatewayMeta && canRefundGatewayOrder(item, gatewayMeta.key)) actions.push(gatewayMeta.refundAction);
        actions.push('ignore');
        return actions;
    }

    if (item?.type === 'order' && String(item?.status || '').trim().toLowerCase() === 'pending_review') {
        const actions = [];
        if (gatewayMeta && canQueryGatewayOrder(item, gatewayMeta.key)) actions.push(gatewayMeta.queryAction);
        if (gatewayMeta?.reconcileAction && canReconcileGatewayOrder(item, gatewayMeta.key)) actions.push(gatewayMeta.reconcileAction);
        actions.push('approve_review', 'reject_review');
        if (gatewayMeta && canRefundGatewayOrder(item, gatewayMeta.key)) actions.push(gatewayMeta.refundAction);
        actions.push('ignore');
        return actions;
    }

    if (gatewayMeta && canRefundGatewayOrder(item, gatewayMeta.key)) {
        const actions = [];
        if (canQueryGatewayOrder(item, gatewayMeta.key)) actions.push(gatewayMeta.queryAction);
        if (gatewayMeta.reconcileAction && canReconcileGatewayOrder(item, gatewayMeta.key)) actions.push(gatewayMeta.reconcileAction);
        if (canReconcileCheckoutSession(item)) actions.push('reconcile_checkout_session');
        actions.push(gatewayMeta.refundAction, 'mark_handled', 'ignore', 'request_retry');
        return actions;
    }

    if (gatewayMeta && canQueryGatewayOrder(item, gatewayMeta.key)) {
        const actions = [gatewayMeta.queryAction];
        if (gatewayMeta.reconcileAction && canReconcileGatewayOrder(item, gatewayMeta.key)) {
            actions.push(gatewayMeta.reconcileAction);
        }
        if (canReconcileCheckoutSession(item)) {
            actions.push('reconcile_checkout_session');
        }
        actions.push('mark_handled', 'ignore', 'request_retry');
        return actions;
    }

    return ['mark_handled', 'ignore', 'request_retry'];
}

function enrichAnomaliesWithCases(anomalies, cases) {
    const caseMap = new Map(
        (cases || []).map((item) => [buildAnomalyCaseKey(item.target_type, item.target_id), item])
    );

    return (anomalies || []).map((item) => {
        const linkedCase = caseMap.get(buildAnomalyCaseKey(item.type, item.id));
        const opsStatus = String(linkedCase?.status || 'open').trim().toLowerCase() || 'open';

        return {
            ...item,
            ops_status: opsStatus,
            ops_note: linkedCase?.note || null,
            ops_resolution: linkedCase?.resolution || null,
            ops_last_action: linkedCase?.last_action || null,
            ops_last_action_at: linkedCase?.last_action_at || null,
            ops_available_actions: getAnomalyAvailableActions(item, opsStatus)
        };
    });
}

function filterActiveAnomalyItems(items) {
    return (items || []).filter((item) => !isResolvedOpsStatus(item?.ops_status));
}

function filterUnarchivedAnomalyItems(items) {
    return (items || []).filter((item) => !isArchivedOpsStatus(item?.ops_status));
}

function buildDisplayExceptionTopicItems(items, archivedLimitPerTopic = 12) {
    const groupedItems = new Map();

    (items || []).forEach((item) => {
        const topicKey = String(item?.topic_key || '').trim().toLowerCase() || '__untagged__';
        const bucket = groupedItems.get(topicKey) || [];
        bucket.push(item);
        groupedItems.set(topicKey, bucket);
    });

    return Array.from(groupedItems.values())
        .flatMap((groupItems) => {
            const sortedItems = groupItems
                .slice()
                .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
            const visibleItems = sortedItems.filter((item) => !isArchivedOpsStatus(item?.ops_status));
            const archivedItems = sortedItems
                .filter((item) => isArchivedOpsStatus(item?.ops_status))
                .slice(0, Math.max(0, Number(archivedLimitPerTopic) || 0));

            return [...visibleItems, ...archivedItems];
        })
        .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
}

function countTopicItems(items, key) {
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (!normalizedKey) return 0;
    return (items || []).filter((item) => String(item?.topic_key || '').trim().toLowerCase() === normalizedKey).length;
}

function recalculateTopicCounts(topics, items) {
    return (topics || [])
        .map((topic) => ({
            ...topic,
            count: countTopicItems(items, topic.key)
        }))
        .filter((topic) => Number(topic.count || 0) > 0);
}

function buildTrend24h(events) {
    const now = new Date();
    const buckets = [];
    const bucketMap = new Map();

    for (let i = 23; i >= 0; i -= 1) {
        const date = new Date(now.getTime() - i * 60 * 60 * 1000);
        date.setUTCMinutes(0, 0, 0);
        const key = date.toISOString();
        const bucket = {
            bucket: key,
            label: formatHourBucket(key),
            total_events: 0,
            anomaly_events: 0,
            failed_events: 0
        };
        buckets.push(bucket);
        bucketMap.set(key, bucket);
    }

    (events || []).forEach((event) => {
        const date = new Date(event.created_at);
        if (Number.isNaN(date.getTime())) return;
        date.setUTCMinutes(0, 0, 0);
        const key = date.toISOString();
        const bucket = bucketMap.get(key);
        if (!bucket) return;

        bucket.total_events += 1;

        if (isEventAnomaly(event)) {
            bucket.anomaly_events += 1;
        }

        if (
            event.signature_valid === false
            || event.amount_valid === false
            || TREND_FAILED_EVENT_RESULTS.has(String(event.processing_result || '').trim())
        ) {
            bucket.failed_events += 1;
        }
    });

    return buckets;
}

function isSuccessfulWebhookEvent(event) {
    const processingResult = String(event?.processing_result || '').trim();
    const responseStatus = Number(event?.response_status || 0);
    const hasBadResponse = Number.isFinite(responseStatus) && responseStatus >= 400;
    return !hasBadResponse
        && event?.signature_valid !== false
        && event?.amount_valid !== false
        && !String(event?.error_message || '').trim()
        && (!processingResult || EVENT_OK_RESULTS.has(processingResult));
}

function buildProviderStats(orders, sessions, events, queryAttempts) {
    const statsMap = new Map();

    (orders || []).forEach((order) => {
        const provider = String(order.provider || 'unknown');
        if (!statsMap.has(provider)) {
            statsMap.set(provider, {
                provider,
                total_orders: 0,
                paid_orders: 0,
                claimed_orders: 0,
                review_orders: 0,
                failed_orders: 0
            });
        }

        const row = statsMap.get(provider);
        row.total_orders += 1;

        if (['paid', 'redeemed'].includes(order.status)) {
            row.paid_orders += 1;
        }
        if (order.user_id) {
            row.claimed_orders += 1;
        }
        if (order.status === 'pending_review') {
            row.review_orders += 1;
        }
        if (['rejected', 'amount_mismatch'].includes(order.status)) {
            row.failed_orders += 1;
        }
        row.total_amount = Number((Number(row.total_amount || 0) + Number(order.paid_amount || order.expected_amount || 0)).toFixed(2));
        row.total_points = Number((Number(row.total_points || 0) + Number(order.points_amount || 0)).toFixed(1));
        row.eligible_orders = Number(row.eligible_orders || 0) + (order.checkout_session_required ? 1 : 0);
        row.matched_orders = Number(row.matched_orders || 0) + (order.checkout_session_matched ? 1 : 0);
        row.unmatched_orders = Number(row.unmatched_orders || 0) + (order.checkout_session_required && !order.checkout_session_matched ? 1 : 0);
    });

    (sessions || []).forEach((session) => {
        const provider = String(session.provider || 'unknown');
        if (!statsMap.has(provider)) {
            statsMap.set(provider, {
                provider,
                total_orders: 0,
                paid_orders: 0,
                claimed_orders: 0,
                review_orders: 0,
                failed_orders: 0
            });
        }

        const row = statsMap.get(provider);
        const status = String(session.status || '').trim().toLowerCase();
        const linkedBy = getSessionLinkedBy(session) || '';

        row.session_total = Number(row.session_total || 0) + 1;
        row.session_matched = Number(row.session_matched || 0) + (session.payment_order_id ? 1 : 0);
        row.session_stale = Number(row.session_stale || 0)
            + (!session.payment_order_id && SESSION_OPEN_STATUSES.has(status) && getSessionAgeMinutes(session) >= 30 ? 1 : 0);
        row.session_failed = Number(row.session_failed || 0)
            + (SESSION_FAILURE_STATUSES.has(status) ? 1 : 0);
        row.session_completed_unlinked = Number(row.session_completed_unlinked || 0)
            + (!session.payment_order_id && status === 'completed' ? 1 : 0);
        row.webhook_links = Number(row.webhook_links || 0)
            + (linkedBy.includes('webhook') ? 1 : 0);
        row.fallback_links = Number(row.fallback_links || 0)
            + (linkedBy.includes('query') || linkedBy.includes('claim') || linkedBy.includes('fallback') ? 1 : 0);
        row.direct_links = Number(row.direct_links || 0)
            + (linkedBy && !linkedBy.includes('webhook') && !linkedBy.includes('query') && !linkedBy.includes('claim') && !linkedBy.includes('fallback') ? 1 : 0);
    });

    (events || []).forEach((event) => {
        const provider = String(event.provider || 'unknown');
        if (!statsMap.has(provider)) {
            statsMap.set(provider, {
                provider,
                total_orders: 0,
                paid_orders: 0,
                claimed_orders: 0,
                review_orders: 0,
                failed_orders: 0
            });
        }

        const row = statsMap.get(provider);
        const responseStatus = Number(event.response_status || 0);
        row.webhook_total = Number(row.webhook_total || 0) + 1;
        row.webhook_success = Number(row.webhook_success || 0) + (isSuccessfulWebhookEvent(event) ? 1 : 0);
        row.webhook_failed = Number(row.webhook_failed || 0) + (isSuccessfulWebhookEvent(event) ? 0 : 1);
        row.webhook_4xx = Number(row.webhook_4xx || 0) + (responseStatus >= 400 && responseStatus < 500 ? 1 : 0);
        row.webhook_5xx = Number(row.webhook_5xx || 0) + (responseStatus >= 500 ? 1 : 0);
    });

    (queryAttempts || []).forEach((attempt) => {
        const provider = String(attempt.provider || 'unknown');
        if (!statsMap.has(provider)) {
            statsMap.set(provider, {
                provider,
                total_orders: 0,
                paid_orders: 0,
                claimed_orders: 0,
                review_orders: 0,
                failed_orders: 0
            });
        }

        const row = statsMap.get(provider);
        const responseStatus = Number(attempt.response_status || 0);
        row.query_total = Number(row.query_total || 0) + 1;
        row.query_success = Number(row.query_success || 0) + (attempt.success === true ? 1 : 0);
        row.query_failed = Number(row.query_failed || 0) + (attempt.success === true ? 0 : 1);
        row.query_4xx = Number(row.query_4xx || 0) + (responseStatus >= 400 && responseStatus < 500 ? 1 : 0);
        row.query_5xx = Number(row.query_5xx || 0) + (responseStatus >= 500 ? 1 : 0);
    });

    return Array.from(statsMap.values()).map((item) => ({
        ...item,
        paid_rate: item.total_orders > 0 ? Number(((item.paid_orders / item.total_orders) * 100).toFixed(2)) : 0,
        claim_rate: item.paid_orders > 0 ? Number(((item.claimed_orders / item.paid_orders) * 100).toFixed(2)) : 0,
        session_match_rate: Number(item.session_total || 0) > 0
            ? Number((((Number(item.session_matched || 0) / Number(item.session_total || 0)) * 100)).toFixed(2))
            : 0,
        order_match_rate: Number(item.eligible_orders || 0) > 0
            ? Number((((Number(item.matched_orders || 0) / Number(item.eligible_orders || 0)) * 100)).toFixed(2))
            : 0,
        webhook_success_rate: Number(item.webhook_total || 0) > 0
            ? Number((((Number(item.webhook_success || 0) / Number(item.webhook_total || 0)) * 100)).toFixed(2))
            : 0,
        query_success_rate: Number(item.query_total || 0) > 0
            ? Number((((Number(item.query_success || 0) / Number(item.query_total || 0)) * 100)).toFixed(2))
            : 0,
        auto_link_rate: Number(item.session_matched || 0) > 0
            ? Number((((Number(item.webhook_links || 0) / Number(item.session_matched || 0)) * 100)).toFixed(2))
            : 0,
        fallback_link_rate: Number(item.session_matched || 0) > 0
            ? Number((((Number(item.fallback_links || 0) / Number(item.session_matched || 0)) * 100)).toFixed(2))
            : 0
    })).sort((left, right) => (
        Number(right.total_orders || 0) - Number(left.total_orders || 0)
        || Number(right.total_amount || 0) - Number(left.total_amount || 0)
    ));
}

function normalizeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function roundNumber(value, digits = 1) {
    const multiplier = 10 ** digits;
    return Math.round(normalizeNumber(value, 0) * multiplier) / multiplier;
}

function formatCurrencyNumber(value, currency = 'CNY') {
    const amount = roundNumber(value, 2);
    const normalizedCurrency = String(currency || '').trim().toUpperCase();
    const digits = Math.abs(amount % 1) > 0 ? 2 : 0;
    const formatted = amount.toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: 2
    });

    if (normalizedCurrency === 'USD') return `$${formatted}`;
    if (normalizedCurrency === 'CNY') return `¥${formatted}`;
    return `${formatted} ${normalizedCurrency || 'CNY'}`;
}

function normalizeCurrencyCode(value = '') {
    return String(value || '').trim().toUpperCase();
}

function normalizeNowpaymentsDisplayCurrency(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    if (normalized.startsWith('usdt')) return 'USDT';
    return normalized.toUpperCase();
}

function firstPositiveNumber(...values) {
    for (const value of values) {
        const amount = normalizeNumber(value, 0);
        if (amount > 0) return roundNumber(amount, 8);
    }
    return 0;
}

function buildPaymentDisplayAmount(order = {}) {
    const provider = String(order.provider || '').trim().toLowerCase();
    const metadata = normalizeJsonObject(order.provider_metadata);

    if (provider === 'nowpayments') {
        const priceAmount = firstPositiveNumber(
            metadata.price_amount,
            metadata.price_amount_webhook,
            metadata.amount_verification?.expected_price_amount,
            metadata.amount_verification?.webhook_price_amount
        );
        const priceCurrency = normalizeCurrencyCode(metadata.price_currency) || 'USD';
        const payAmount = firstPositiveNumber(
            metadata.actually_paid,
            metadata.pay_amount,
            metadata.outcome_amount,
            metadata.amount_verification?.actual_amount
        );
        const payCurrency = normalizeNowpaymentsDisplayCurrency(
            metadata.pay_currency
            || metadata.outcome_currency
            || metadata.amount_verification?.actual_currency
        ) || 'USDT';

        if (priceAmount > 0) {
            return {
                amount: roundNumber(priceAmount, 2),
                currency: priceCurrency,
                label: formatCurrencyNumber(priceAmount, priceCurrency),
                source: 'nowpayments_price_amount',
                settlement_amount: payAmount || null,
                settlement_currency: payAmount > 0 ? payCurrency : null,
                settlement_label: payAmount > 0 ? `${roundNumber(payAmount, 8).toLocaleString('zh-CN', { maximumFractionDigits: 8 })} ${payCurrency}` : null
            };
        }

        if (payAmount > 0) {
            return {
                amount: payAmount,
                currency: payCurrency,
                label: `${roundNumber(payAmount, 8).toLocaleString('zh-CN', { maximumFractionDigits: 8 })} ${payCurrency}`,
                source: 'nowpayments_pay_amount',
                settlement_amount: payAmount,
                settlement_currency: payCurrency,
                settlement_label: `${roundNumber(payAmount, 8).toLocaleString('zh-CN', { maximumFractionDigits: 8 })} ${payCurrency}`
            };
        }
    }

    const localAmount = normalizeNumber(order.paid_amount, normalizeNumber(order.expected_amount, 0));
    return {
        amount: roundNumber(localAmount, 2),
        currency: 'CNY',
        label: formatCurrencyNumber(localAmount, 'CNY'),
        source: 'local_amount',
        settlement_amount: null,
        settlement_currency: null,
        settlement_label: null
    };
}

function isMissingColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    return error?.code === '42703'
        || error?.code === '42P01'
        || (message.includes('column') && message.includes('does not exist'));
}

function isMissingFunctionError(error) {
    const message = String(error?.message || '').toLowerCase();
    return error?.code === '42883'
        || (message.includes('function') && message.includes('does not exist'));
}

function normalizeJsonArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeBusinessBreakdownTrendSeries(value) {
    return normalizeJsonArray(value)
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => ({
            key: String(item.key || '').trim().toLowerCase(),
            tone: String(item.tone || '').trim().toLowerCase(),
            metric_kind: String(item.metric_kind || item.metricKind || '').trim().toLowerCase(),
            points: normalizeJsonArray(item.points)
                .filter((point) => point && typeof point === 'object' && !Array.isArray(point))
                .map((point) => ({
                    label: String(point.label || '').trim(),
                    value: roundNumber(point.value, 2)
                }))
        }))
        .filter((item) => item.key);
}

function normalizePointsBreakdownTrendSeries(value) {
    return normalizeJsonArray(value)
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => ({
            key: String(item.key || '').trim().toLowerCase(),
            label: String(item.label || '').trim(),
            points: normalizeJsonArray(item.points || item.trend)
                .filter((point) => point && typeof point === 'object' && !Array.isArray(point))
                .map((point) => ({
                    label: String(point.label || '').trim(),
                    value: roundNumber(point.value, 1)
                }))
        }))
        .filter((item) => item.key);
}

function attachPointsBreakdownTrend(items, trendSeries) {
    const normalizedTrendSeries = normalizePointsBreakdownTrendSeries(trendSeries);
    const trendMap = new Map(normalizedTrendSeries.map((series) => [series.key, series]));
    const seenKeys = new Set();

    const mergedItems = normalizeJsonArray(items)
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => {
            const key = String(item.key || '').trim().toLowerCase();
            const existingTrend = normalizeJsonArray(item.trend).length
                ? normalizePointsBreakdownTrendSeries([{ key, points: item.trend }])[0]?.points || []
                : [];
            const trend = existingTrend.length ? existingTrend : (trendMap.get(key)?.points || []);
            seenKeys.add(key);
            return {
                ...item,
                key,
                trend
            };
        });

    normalizedTrendSeries.forEach((series) => {
        if (seenKeys.has(series.key)) return;
        const inflow = roundNumber(series.points
            .filter((point) => normalizeNumber(point.value, 0) > 0)
            .reduce((sum, point) => sum + normalizeNumber(point.value, 0), 0), 1);
        const outflow = roundNumber(series.points
            .filter((point) => normalizeNumber(point.value, 0) < 0)
            .reduce((sum, point) => sum + Math.abs(normalizeNumber(point.value, 0)), 0), 1);
        mergedItems.push({
            key: series.key,
            label: series.label || series.key,
            inflow,
            outflow,
            net: roundNumber(inflow - outflow, 1),
            trend: series.points
        });
    });

    return mergedItems.sort((left, right) => Math.abs(normalizeNumber(right.net, 0)) - Math.abs(normalizeNumber(left.net, 0)));
}

function normalizeFinanceAggregatePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return null;
    }

    const overview = normalizeJsonObject(payload.overview);
    const anomalySummary = normalizeJsonObject(payload.anomaly_summary);
    const sitewideSummary = normalizeJsonObject(payload.sitewide_summary);
    const providerStats = normalizeJsonArray(payload.provider_stats)
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    const pointsBreakdown = normalizeJsonArray(payload.points_breakdown)
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    const businessBreakdownTrend = Object.prototype.hasOwnProperty.call(payload, 'business_breakdown_trend')
        ? normalizeBusinessBreakdownTrendSeries(payload.business_breakdown_trend)
        : null;
    const pointsBreakdownTrend = Object.prototype.hasOwnProperty.call(payload, 'points_breakdown_trend')
        ? normalizePointsBreakdownTrendSeries(payload.points_breakdown_trend)
        : null;

    return {
        overview,
        anomaly_summary: anomalySummary,
        provider_stats: providerStats,
        sitewide_summary: sitewideSummary,
        points_breakdown: pointsBreakdown,
        points_breakdown_trend: pointsBreakdownTrend,
        business_breakdown_trend: businessBreakdownTrend
    };
}

function normalizeOverviewAggregatePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return null;
    }

    return {
        overview: normalizeJsonObject(payload.overview),
        session_summary: normalizeJsonObject(payload.session_summary),
        query_summary: {
            ...normalizeJsonObject(payload.query_summary),
            outcome_breakdown: normalizeJsonArray(payload?.query_summary?.outcome_breakdown)
        },
        anomaly_summary: normalizeJsonObject(payload.anomaly_summary),
        provider_stats: normalizeJsonArray(payload.provider_stats)
            .filter((item) => item && typeof item === 'object' && !Array.isArray(item)),
        trend_24h: normalizeJsonArray(payload.trend_24h),
        refund_alert_topics: normalizeJsonArray(payload.refund_alert_topics)
            .filter((item) => item && typeof item === 'object' && !Array.isArray(item)),
        refund_alert_items: normalizeJsonArray(payload.refund_alert_items)
            .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    };
}

async function fetchPaymentFinanceAggregate(client, sinceIso, untilIso, site) {
    if (!client?.rpc) {
        return null;
    }

    try {
        const { data, error } = await client.rpc('fn_admin_get_payment_finance_summary', {
            p_start_at: sinceIso,
            p_end_at: untilIso || null,
            p_site: site || null
        });

        if (error) {
            throw error;
        }

        return normalizeFinanceAggregatePayload(data);
    } catch (error) {
        if (!isMissingFunctionError(error)) {
            console.warn('[AdminPayments] Failed to fetch finance aggregate RPC:', error.message || error);
        }
        return null;
    }
}

async function fetchPaymentOverviewAggregate(client, sinceIso, untilIso, trendSinceIso, site) {
    if (!client?.rpc) {
        return null;
    }

    try {
        const { data, error } = await client.rpc('fn_admin_get_payment_overview_summary', {
            p_start_at: sinceIso,
            p_end_at: untilIso || null,
            p_trend_start_at: trendSinceIso || null,
            p_site: site || null
        });

        if (error) {
            throw error;
        }

        return normalizeOverviewAggregatePayload(data);
    } catch (error) {
        if (!isMissingFunctionError(error)) {
            console.warn('[AdminPayments] Failed to fetch overview aggregate RPC:', error.message || error);
        }
        return null;
    }
}

function isSuccessOrder(order) {
    return ['paid', 'redeemed'].includes(String(order?.status || '').trim());
}

function classifyLedgerCategory(entry) {
    const reason = String(entry?.reason || '').trim().toLowerCase();
    const amount = normalizeNumber(entry?.amount, 0);

    if (amount >= 0) {
        if (
            reason.includes('充值')
            || reason.includes('recharge')
            || reason.includes('package_purchase')
            || reason.includes('模拟充值')
            || reason.includes('afdian')
        ) {
            return { key: 'recharge', label: '充值入账' };
        }
        if (reason.includes('兑换码') || reason.includes('redeem')) {
            return { key: 'redeem_code', label: '兑换码入账' };
        }
        if (
            reason.includes('返佣')
            || reason.includes('奖励')
            || reason.includes('reward')
            || reason.includes('signup')
            || reason.includes('checkin')
        ) {
            return { key: 'rewards', label: '奖励 / 返佣' };
        }
        if (reason.includes('refund') || reason.includes('退款')) {
            return { key: 'refund', label: '退款返还' };
        }
        if (reason.includes('admin') || reason.includes('manual') || reason.includes('系统')) {
            return { key: 'admin_in', label: '管理入账' };
        }
        return { key: 'other_in', label: '其他入账' };
    }

    if (reason.includes('商城购买') || reason.includes('shop_purchase')) {
        return { key: 'shop_purchase', label: '商城消费' };
    }
    if (reason.includes('unlock') || reason.includes('解锁')) {
        return { key: 'content_unlock', label: '内容解锁' };
    }
    if (reason.includes('验证') || reason.includes('gemini') || reason.includes('verify')) {
        return { key: 'verification', label: '验证消耗' };
    }
    if (reason.includes('refund') || reason.includes('退款')) {
        return { key: 'refund_out', label: '退款扣回' };
    }
    if (reason.includes('deduct') || reason.includes('扣除') || reason.includes('admin')) {
        return { key: 'admin_deduct', label: '管理扣减' };
    }
    return { key: 'other_out', label: '其他支出' };
}

async function fetchPagedRows(buildQuery, pageSize = 1000, maxPages = 50) {
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

function buildPaymentOrderSelect(view = 'overview') {
    const fields = [
        'id',
        'provider',
        'provider_order_no',
        'paid_amount',
        'expected_amount',
        'points_amount',
        'status',
        'user_id',
        'created_at',
        'paid_at',
        'claimed_at',
        'checkout_session_id',
        'site',
        'provider_metadata'
    ];

    if (view === 'ops') {
        fields.push('package_name', 'last_error');
    }

    return fields.join(', ');
}

async function fetchPaymentOrders(client, sinceIso, untilIso, site, view = 'overview') {
    return fetchPagedRows(() => {
        let query = client
            .from('payment_orders')
            .select(buildPaymentOrderSelect(view))
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false });

        if (untilIso) {
            query = query.lte('created_at', untilIso);
        }
        if (site) {
            query = query.eq('site', site);
        }

        return query;
    }, SUMMARY_PAGE_SIZES.heavy, 50);
}

async function fetchProfilesByIds(client, userIds = []) {
    const ids = Array.from(new Set(
        (Array.isArray(userIds) ? userIds : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    ));
    if (!ids.length || !client) {
        return new Map();
    }

    let data = null;
    let error = null;

    ({ data, error } = await client
        .from('profiles')
        .select('id, email, username')
        .in('id', ids));

    if (error && isMissingColumnError(error)) {
        ({ data, error } = await client
            .from('profiles')
            .select('id, username')
            .in('id', ids));
    }

    if (error && isMissingColumnError(error)) {
        return new Map();
    }

    if (error) {
        throw error;
    }

    return new Map(
        (Array.isArray(data) ? data : [])
            .filter((row) => row?.id)
            .map((row) => [String(row.id).trim(), row])
    );
}

function enrichItemsWithProfileEmails(items = [], profileMap = new Map()) {
    if (!Array.isArray(items) || !items.length) {
        return [];
    }

    return items.map((item) => {
        const userId = String(item?.user_id || '').trim();
        if (!userId) {
            return item;
        }

        const existingEmail = String(item?.user_email || '').trim();
        if (existingEmail) {
            return item;
        }

        const profile = profileMap.get(userId) || null;
        const email = String(profile?.email || '').trim();
        return {
            ...item,
            user_email: email || null
        };
    });
}

async function fetchCheckoutSessions(client, sinceIso, untilIso, site) {
    try {
        return await fetchPagedRows(() => {
            let query = client
                .from('payment_checkout_sessions')
                .select('id, session_key, provider, user_id, site, package_id, package_name, requested_points, bonus_points, granted_points, expected_amount, status, checkout_url, query_mode, payment_order_id, provider_metadata, error_message, expires_at, completed_at, created_at, updated_at')
                .gte('created_at', sinceIso)
                .order('created_at', { ascending: false });

            if (untilIso) {
                query = query.lte('created_at', untilIso);
            }

            if (site) {
                query = query.eq('site', site);
            }

            return query;
        }, SUMMARY_PAGE_SIZES.heavy, 50);
    } catch (error) {
        if (isMissingColumnError(error)) {
            return [];
        }
        throw error;
    }
}

function buildOpsAlertJobSelect(view = 'overview') {
    const fields = [
        'id',
        'severity',
        'title',
        'payload',
        'channels',
        'remaining_channels',
        'status',
        'attempt_count',
        'max_attempts',
        'next_retry_at',
        'delivered_at',
        'last_error',
        'created_at',
        'updated_at'
    ];

    if (view === 'ops') {
        fields.push('alert_type', 'content', 'last_attempt_at', 'worker_name');
    }

    return fields.join(', ');
}

async function fetchOpsAlertJobs(client, sinceIso, untilIso, view = 'overview') {
    try {
        return await fetchPagedRows(() => {
            let query = client
                .from('ops_alert_jobs')
                .select(buildOpsAlertJobSelect(view))
                .gte('created_at', sinceIso)
                .order('created_at', { ascending: false });

            if (untilIso) {
                query = query.lte('created_at', untilIso);
            }

            return query;
        }, SUMMARY_PAGE_SIZES.opsAlertJobs, 20);
    } catch (error) {
        if (isMissingColumnError(error)) {
            return [];
        }
        throw error;
    }
}

async function fetchAnomalyCasesByTargets(client, anomalies) {
    const groupedIds = {
        order: new Set(),
        event: new Set(),
        session: new Set(),
        shop_profit_audit: new Set()
    };

    (anomalies || []).forEach((item) => {
        const type = String(item?.type || '').trim().toLowerCase();
        const id = String(item?.id || '').trim();
        if (!id || !Object.prototype.hasOwnProperty.call(groupedIds, type)) return;
        groupedIds[type].add(id);
    });

    const results = [];

    for (const [targetType, idSet] of Object.entries(groupedIds)) {
        const targetIds = Array.from(idSet);
        if (!targetIds.length) continue;

        try {
            const rows = await fetchPagedRows(() => client
                .from('payment_anomaly_cases')
                .select('id, target_type, target_id, status, note, resolution, last_action, last_action_at')
                .eq('target_type', targetType)
                .in('target_id', targetIds)
                .order('updated_at', { ascending: false }), SUMMARY_PAGE_SIZES.anomalyCases, 10);

            results.push(...rows);
        } catch (error) {
            if (isMissingColumnError(error)) {
                return [];
            }
            throw error;
        }
    }

    return results;
}

async function fetchPaymentEvents(client, sinceIso, untilIso) {
    return fetchPagedRows(() => {
        let query = client
            .from('payment_events')
            .select('id, payment_order_id, provider, provider_order_no, event_type, signature_valid, amount_valid, processing_result, error_message, response_status, created_at')
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false });

        if (untilIso) {
            query = query.lte('created_at', untilIso);
        }

        return query;
    }, SUMMARY_PAGE_SIZES.heavy, 50);
}

async function fetchPaymentQueryAttempts(client, sinceIso, untilIso, site) {
    try {
        return await fetchPagedRows(() => {
            let query = client
                .from('payment_query_attempts')
                .select('id, provider, site, order_no, user_id, payment_order_id, checkout_session_id, success, response_status, outcome_code, message, created_at')
                .gte('created_at', sinceIso)
                .order('created_at', { ascending: false });

            if (untilIso) {
                query = query.lte('created_at', untilIso);
            }
            if (site) {
                query = query.eq('site', site);
            }

            return query;
        }, SUMMARY_PAGE_SIZES.heavy, 50);
    } catch (error) {
        if (isMissingColumnError(error)) {
            return [];
        }
        throw error;
    }
}

function buildQuerySummary(rows) {
    const attempts = rows || [];
    const successfulAttempts = attempts.filter((item) => item.success === true);
    const failedAttempts = attempts.filter((item) => item.success !== true);
    const breakdownMap = new Map();

    failedAttempts.forEach((item) => {
        const outcomeCode = String(item.outcome_code || 'unknown').trim().toLowerCase() || 'unknown';
        const meta = getQueryOutcomeMeta(outcomeCode);
        if (!breakdownMap.has(outcomeCode)) {
            breakdownMap.set(outcomeCode, {
                outcome_code: outcomeCode,
                label: meta.label,
                severity: meta.severity,
                count: 0
            });
        }
        breakdownMap.get(outcomeCode).count += 1;
    });

    return {
        total_attempts: attempts.length,
        success_attempts: successfulAttempts.length,
        failed_attempts: failedAttempts.length,
        success_rate: attempts.length > 0
            ? roundNumber((successfulAttempts.length / attempts.length) * 100, 2)
            : 0,
        outcome_breakdown: Array.from(breakdownMap.values())
            .sort((left, right) => right.count - left.count)
            .slice(0, 6)
    };
}

function buildDuplicateWebhookTopicItems(events) {
    const grouped = new Map();

    (events || []).forEach((event) => {
        if (isBenignNowpaymentsLifecycleEvent(event)) {
            return;
        }
        const orderNo = String(event.provider_order_no || '').trim();
        if (!orderNo) return;
        if (!grouped.has(orderNo)) {
            grouped.set(orderNo, {
                count: 0,
                latest: null
            });
        }
        const row = grouped.get(orderNo);
        row.count += 1;
        if (!row.latest || new Date(event.created_at).getTime() > new Date(row.latest.created_at).getTime()) {
            row.latest = event;
        }
    });

    return Array.from(grouped.entries())
        .filter(([, row]) => row.count > 1 && row.latest)
        .map(([orderNo, row]) => ({
            topic_key: 'duplicate_webhook',
            topic_label: '重复回调',
            type: 'event',
            id: row.latest.id,
            provider: row.latest.provider,
            provider_order_no: orderNo,
            status: 'duplicate_webhook',
            severity: row.count >= 3 ? 'critical' : 'warning',
            title: '重复回调',
            message: `同一订单在当前时间范围内收到了 ${row.count} 次回调，请核查幂等保护和重复入账风险。`,
            created_at: row.latest.created_at,
            duplicate_count: row.count
        }))
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
}

function isBenignNowpaymentsLifecycleEvent(event = {}) {
    const provider = String(event.provider || '').trim().toLowerCase();
    if (provider !== 'nowpayments') return false;
    const eventType = String(event.event_type || '').trim().toLowerCase();
    if (eventType && eventType !== 'webhook') return false;
    const responseStatus = Number(event.response_status);
    if (Number.isFinite(responseStatus) && (responseStatus < 200 || responseStatus >= 300)) {
        return false;
    }
    if (event.signature_valid === false || event.amount_valid === false) {
        return false;
    }
    const result = String(event.processing_result || '').trim().toLowerCase();
    return result === 'ignored_pending' || result === 'processed_paid' || result === 'received';
}

function buildQueryFailureTopicItems(rows) {
    return (rows || [])
        .filter((item) => item.success !== true)
        .map((item) => {
            const meta = getQueryOutcomeMeta(item.outcome_code);
            return {
                topic_key: 'query_failures',
                topic_label: '查码失败',
                type: 'query',
                id: item.id,
                provider: item.provider,
                provider_order_no: item.order_no,
                user_id: item.user_id || null,
                status: item.outcome_code,
                severity: meta.severity,
                title: `查码失败 · ${meta.label}`,
                message: String(item.message || '').trim() || '订单查码未成功，请检查订单落单状态与钱包兜底链路。',
                created_at: item.created_at,
                response_status: item.response_status
            };
        })
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
}

function buildRefundFailureTopicItems(events) {
    return (events || [])
        .filter((event) => Object.prototype.hasOwnProperty.call(REFUND_FAILURE_EVENT_META, String(event?.processing_result || '').trim()))
        .map((event) => {
            const processingResult = String(event.processing_result || '').trim();
            const refundMeta = REFUND_FAILURE_EVENT_META[processingResult];
            return {
                ...buildEventAnomaly(event),
                topic_key: refundMeta.topicKey,
                topic_label: refundMeta.topicLabel
            };
        })
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
}

function buildRefundExceptionTopics(events) {
    const refundItems = buildRefundFailureTopicItems(events);
    const topicItems = REFUND_EXCEPTION_TOPIC_META
        .flatMap((topic) => refundItems.filter((item) => item.topic_key === topic.key).slice(0, 12))
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

    return {
        topics: REFUND_EXCEPTION_TOPIC_META
            .map((topic) => ({
                ...topic,
                count: refundItems.filter((item) => item.topic_key === topic.key).length
            }))
            .filter((topic) => Number(topic.count || 0) > 0),
        items: topicItems,
        countItems: refundItems
    };
}

function buildExceptionTopics({ orders, events, queryAttempts, sessions }) {
    const amountMismatchItems = (orders || [])
        .filter((order) => order.status === 'amount_mismatch')
        .map((order) => ({
            ...buildOrderAnomaly(order),
            topic_key: 'amount_mismatch',
            topic_label: '金额异常'
        }));
    const reviewItems = (orders || [])
        .filter((order) => order.status === 'pending_review')
        .map((order) => ({
            ...buildOrderAnomaly(order),
            topic_key: 'manual_review',
            topic_label: '待审核'
        }));
    const duplicateItems = buildDuplicateWebhookTopicItems(events);
    const paymentIntentItems = buildPaymentIntentTopicItems(sessions);
    const queryFailureItems = buildQueryFailureTopicItems(queryAttempts);
    const refundTopics = buildRefundExceptionTopics(events);
    const countItems = [
        ...amountMismatchItems,
        ...reviewItems,
        ...duplicateItems,
        ...paymentIntentItems,
        ...queryFailureItems,
        ...(refundTopics.countItems || refundTopics.items || [])
    ].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

    const topicItems = [
        ...amountMismatchItems.slice(0, 12),
        ...reviewItems.slice(0, 12),
        ...duplicateItems.slice(0, 12),
        ...paymentIntentItems.slice(0, 12),
        ...queryFailureItems.slice(0, 12),
        ...(refundTopics.items || [])
    ].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

    return {
        topics: [
            {
                key: 'amount_mismatch',
                label: '金额异常',
                severity: 'critical',
                description: '支付金额与套餐金额不一致，需要人工复核后决定放行或驳回。',
                count: amountMismatchItems.length
            },
            {
                key: 'manual_review',
                label: '待审核',
                severity: 'warning',
                description: '套餐映射、签名或金额仍需人工确认，避免直接放过异常订单。',
                count: reviewItems.length
            },
            {
                key: 'duplicate_webhook',
                label: '重复回调',
                severity: 'warning',
                description: '重点关注是否只是重复通知，还是已经造成重复入账、重复回填。',
                count: duplicateItems.length
            },
            ...PAYMENT_INTENT_EXCEPTION_TOPIC_META.map((topic) => ({
                ...topic,
                count: paymentIntentItems.filter((item) => item.topic_key === topic.key).length
            })),
            {
                key: 'query_failures',
                label: '查码失败',
                severity: 'warning',
                description: '追踪钱包查码失败原因，判断是用户误输、订单未落单还是接口异常。',
                count: queryFailureItems.length
            },
            ...(refundTopics.topics || [])
        ].filter((topic) => Number(topic.count || 0) > 0),
        items: topicItems,
        countItems
    };
}

async function fetchShopOrders(client, sinceIso, untilIso, site) {
    const variants = [
        {
            select: 'id, user_id, product_id, inventory_id, sku_id, price_paid, paid_points_spent, bonus_points_spent, points_spend_breakdown, total_price, discount_amount, discount_refund_amount, snapshot_product_name, refund_status, created_at, site',
            hasSite: true
        },
        {
            select: 'id, user_id, product_id, inventory_id, sku_id, price_paid, paid_points_spent, bonus_points_spent, points_spend_breakdown, total_price, discount_amount, discount_refund_amount, snapshot_product_name, refund_status, created_at',
            hasSite: false
        },
        {
            select: 'id, user_id, price_paid, snapshot_product_name, refund_status, created_at',
            hasSite: false,
            legacy: true
        }
    ];

    for (const variant of variants) {
        try {
            const rows = await fetchPagedRows(() => {
                let query = client
                    .from('shop_orders')
                    .select(variant.select)
                    .gte('created_at', sinceIso)
                    .order('created_at', { ascending: false });

                if (untilIso) {
                    query = query.lte('created_at', untilIso);
                }
                if (site && variant.hasSite) {
                    query = query.eq('site', site);
                }

                return query;
            }, SUMMARY_PAGE_SIZES.heavy, 50);

            if (site && !variant.hasSite && site !== 'cn') {
                return [];
            }

            return rows.map((row) => ({
                ...row,
                site: variant.hasSite ? (row.site || 'cn') : 'cn'
            }));
        } catch (error) {
            if (isMissingColumnError(error) && variant === variants[variants.length - 1]) {
                return [];
            }

            if (!isMissingColumnError(error) || variant === variants[variants.length - 1]) {
                throw error;
            }
        }
    }

    return [];
}

async function fetchPointsLedger(client, sinceIso, untilIso, site) {
    const variants = [
        {
            select: 'id, user_id, amount, reason, reference_id, created_at, site',
            hasSite: true
        },
        {
            select: 'id, user_id, amount, reason, reference_id, created_at',
            hasSite: false
        }
    ];

    for (const variant of variants) {
        try {
            const rows = await fetchPagedRows(() => {
                let query = client
                    .from('points_ledger')
                    .select(variant.select)
                    .gte('created_at', sinceIso)
                    .order('created_at', { ascending: false });

                if (untilIso) {
                    query = query.lte('created_at', untilIso);
                }
                if (site && variant.hasSite) {
                    query = query.eq('site', site);
                }

                return query;
            }, SUMMARY_PAGE_SIZES.heavy, 50);

            if (site && !variant.hasSite && site !== 'cn') {
                return [];
            }

            return rows.map((row) => ({
                ...row,
                site: variant.hasSite ? (row.site || 'cn') : 'cn'
            }));
        } catch (error) {
            if (isMissingColumnError(error) && variant === variants[variants.length - 1]) {
                return [];
            }

            if (!isMissingColumnError(error) || variant === variants[variants.length - 1]) {
                throw error;
            }
        }
    }

    return [];
}

async function fetchPointsBalances(client, site) {
    const variants = [
        {
            select: 'user_id, paid_balance, bonus_balance, total_balance, site',
            hasSite: true
        },
        {
            select: 'user_id, paid_balance, bonus_balance, total_balance',
            hasSite: false
        }
    ];

    for (const variant of variants) {
        try {
            const rows = await fetchPagedRows(() => {
                let query = client
                    .from('points_balance')
                    .select(variant.select)
                    .order('updated_at', { ascending: false });

                if (site && variant.hasSite) {
                    query = query.eq('site', site);
                }

                return query;
            }, SUMMARY_PAGE_SIZES.heavy, 50);

            if (site && !variant.hasSite && site !== 'cn') {
                return [];
            }

            return rows.map((row) => ({
                ...row,
                site: variant.hasSite ? (row.site || 'cn') : 'cn'
            }));
        } catch (error) {
            if (isMissingColumnError(error) && variant === variants[variants.length - 1]) {
                return [];
            }

            if (!isMissingColumnError(error) || variant === variants[variants.length - 1]) {
                throw error;
            }
        }
    }

    return [];
}

async function fetchShopProfitLedgerRows(client, sinceIso, untilIso, site) {
    if (!client) return [];

    try {
        const rows = await fetchPagedRows(() => {
            let query = client
                .from('shop_order_profit_ledger')
                .select('id, site, order_id, order_item_id, inventory_id, source_batch_id, dedupe_key, entry_type, entry_group, direction, amount, currency, cash_value_cny, points_amount, status, confidence, occurred_at, settled_at, snapshot')
                .gte('occurred_at', sinceIso)
                .order('occurred_at', { ascending: false });

            if (untilIso) {
                query = query.lte('occurred_at', untilIso);
            }
            if (site) {
                query = query.eq('site', site);
            }

            return query;
        }, SUMMARY_PAGE_SIZES.heavy, 50);

        return rows.map((row) => ({
            ...row,
            site: row.site || 'cn'
        }));
    } catch (error) {
        const text = [
            error?.message,
            error?.details,
            error?.hint,
            error?.code
        ].filter(Boolean).join(' ').toLowerCase();
        if (
            text.includes('shop_order_profit_ledger')
            && (
                text.includes('does not exist')
                || text.includes('undefined table')
                || text.includes('could not find')
                || text.includes('schema cache')
                || text.includes('42p01')
                || text.includes('pgrst205')
            )
        ) {
            return [];
        }
        throw error;
    }
}

function getSessionSortValue(session) {
    const value = Number(new Date(session?.updated_at || session?.created_at || 0).getTime());
    return Number.isFinite(value) ? value : 0;
}

function mergeCheckoutSessionsWithOrderFallback(orders, sessions) {
    const mergedSessions = [];
    const indexById = new Map();
    const indexByKey = new Map();

    (sessions || []).forEach((session) => {
        const normalizedSession = {
            ...session,
            provider_metadata: normalizeJsonObject(session?.provider_metadata)
        };
        const position = mergedSessions.push(normalizedSession) - 1;
        const sessionId = String(normalizedSession.id || '').trim();
        const sessionKey = String(normalizedSession.session_key || '').trim();
        if (sessionId) indexById.set(sessionId, position);
        if (sessionKey) indexByKey.set(sessionKey, position);
    });

    (orders || []).forEach((order) => {
        const metadata = normalizeJsonObject(order?.provider_metadata);
        const sessionId = String(order?.checkout_session_id || metadata.checkout_session_id || '').trim();
        const sessionKey = String(metadata.checkout_session_key || '').trim();

        if (!sessionId && !sessionKey) {
            return;
        }

        const existingIndex = sessionId && indexById.has(sessionId)
            ? indexById.get(sessionId)
            : (sessionKey && indexByKey.has(sessionKey) ? indexByKey.get(sessionKey) : -1);

        const providerMetadata = {
            ...normalizeJsonObject(mergedSessions[existingIndex]?.provider_metadata),
            provider_order_no: String(metadata.provider_order_no || order.provider_order_no || '').trim() || null,
            payment_status: String(metadata.checkout_session_status || order.status || '').trim().toLowerCase() || null,
            linked_by: String(metadata.checkout_session_linked_by || '').trim() || null,
            linked_at: metadata.checkout_session_linked_at || null
        };

        if (existingIndex >= 0) {
            const current = mergedSessions[existingIndex];
            mergedSessions[existingIndex] = {
                ...current,
                payment_order_id: current.payment_order_id || order.id,
                status: current.status || metadata.checkout_session_status || (isSuccessOrder(order) ? 'completed' : 'created'),
                provider_metadata: providerMetadata,
                completed_at: current.completed_at || (isSuccessOrder(order) ? (order.paid_at || order.claimed_at || order.created_at) : null),
                updated_at: current.updated_at || order.created_at
            };
            return;
        }

        const syntheticSession = {
            id: sessionId || `synthetic_${order.id}`,
            session_key: sessionKey || null,
            provider: order.provider,
            user_id: order.user_id || null,
            site: order.site || null,
            package_id: null,
            package_name: order.package_name || null,
            requested_points: normalizeNumber(order.points_amount, 0),
            bonus_points: 0,
            granted_points: normalizeNumber(order.points_amount, 0),
            expected_amount: normalizeNumber(order.expected_amount, normalizeNumber(order.paid_amount, 0)),
            status: String(metadata.checkout_session_status || (isSuccessOrder(order) ? 'completed' : 'created')).trim().toLowerCase() || 'created',
            checkout_url: null,
            query_mode: null,
            payment_order_id: order.id,
            provider_metadata: providerMetadata,
            error_message: String(order.last_error || '').trim() || null,
            expires_at: null,
            completed_at: isSuccessOrder(order) ? (order.paid_at || order.claimed_at || order.created_at) : null,
            created_at: order.created_at,
            updated_at: order.created_at
        };

        const position = mergedSessions.push(syntheticSession) - 1;
        if (sessionId) indexById.set(sessionId, position);
        if (sessionKey) indexByKey.set(sessionKey, position);
    });

    return mergedSessions;
}

function enrichPaymentOrdersWithCheckoutSessions(orders, sessions) {
    const sessionMap = new Map();

    (sessions || []).forEach((session) => {
        const paymentOrderId = String(session?.payment_order_id || '').trim();
        if (!paymentOrderId) return;

        const existing = sessionMap.get(paymentOrderId);
        if (!existing || getSessionSortValue(session) > getSessionSortValue(existing)) {
            sessionMap.set(paymentOrderId, session);
        }
    });

    return (orders || []).map((order) => {
        const metadata = normalizeJsonObject(order.provider_metadata);
        const linkedSession = sessionMap.get(order.id);
        const linkedSessionMetadata = normalizeJsonObject(linkedSession?.provider_metadata);
        const recoveredNowpaymentsPaymentId = String(order?.provider || '').trim().toLowerCase() === 'nowpayments'
            ? pickNowpaymentsPaymentId(
                metadata.payment_id,
                metadata.nowpayments_payment_id,
                metadata.provider_payment_id,
                linkedSessionMetadata.payment_id,
                linkedSessionMetadata.nowpayments_payment_id,
                linkedSessionMetadata.provider_payment_id,
                normalizeJsonObject(linkedSessionMetadata.summary).payment_id,
                normalizeJsonObject(linkedSessionMetadata.summary).nowpayments_payment_id
            )
            : '';
        const providerMetadata = recoveredNowpaymentsPaymentId && !pickNowpaymentsPaymentId(
            metadata.payment_id,
            metadata.nowpayments_payment_id,
            metadata.provider_payment_id
        )
            ? {
                ...metadata,
                payment_id: recoveredNowpaymentsPaymentId,
                payment_id_recovered_from: 'checkout_session'
            }
            : metadata;
        const sessionId = linkedSession?.id || order.checkout_session_id || metadata.checkout_session_id || null;
        const sessionKey = linkedSession?.session_key || metadata.checkout_session_key || null;
        const sessionStatus = linkedSession?.status || metadata.checkout_session_status || null;
        const sessionLinkedBy = getSessionLinkedBy(linkedSession) || String(metadata.checkout_session_linked_by || '').trim() || null;
        const sessionLinkedAt = linkedSession
            ? normalizeJsonObject(linkedSession.provider_metadata).linked_at || null
            : (metadata.checkout_session_linked_at || null);
        const sessionProviderOrderNo = linkedSession
            ? getSessionProviderOrderNo(linkedSession)
            : String(metadata.provider_order_no || '').trim() || null;
        const sessionRequired = isCheckoutSessionEligibleOrder(order);
        const sessionMatched = Boolean(sessionId || linkedSession?.payment_order_id);

        return {
            ...order,
            provider_metadata: providerMetadata,
            checkout_session_id: sessionId,
            checkout_session_key: sessionKey,
            checkout_session_status: sessionStatus,
            checkout_session_linked_by: sessionLinkedBy,
            checkout_session_linked_at: sessionLinkedAt,
            checkout_session_provider_order_no: sessionProviderOrderNo,
            checkout_session_required: sessionRequired,
            checkout_session_matched: sessionMatched
        };
    });
}

function buildSessionSummary(sessions, orders) {
    const rows = sessions || [];
    const eligibleOrders = (orders || []).filter((order) => order.checkout_session_required);
    const matchedOrders = eligibleOrders.filter((order) => order.checkout_session_matched);
    const openSessions = rows.filter((session) => SESSION_OPEN_STATUSES.has(String(session.status || '').trim().toLowerCase()));
    const staleSessions = rows.filter((session) => {
        const status = String(session.status || '').trim().toLowerCase();
        return !session.payment_order_id
            && SESSION_OPEN_STATUSES.has(status)
            && getSessionAgeMinutes(session) >= 30;
    });
    const failedSessions = rows.filter((session) => SESSION_FAILURE_STATUSES.has(String(session.status || '').trim().toLowerCase()));
    const completedUnlinkedSessions = rows.filter((session) => !session.payment_order_id && String(session.status || '').trim().toLowerCase() === 'completed');
    const matchedSessions = rows.filter((session) => Boolean(session.payment_order_id));
    const webhookLinkedSessions = matchedSessions.filter((session) => (getSessionLinkedBy(session) || '').includes('webhook'));
    const fallbackLinkedSessions = matchedSessions.filter((session) => {
        const linkedBy = getSessionLinkedBy(session) || '';
        return linkedBy.includes('query') || linkedBy.includes('claim') || linkedBy.includes('fallback');
    });
    const directLinkedSessions = matchedSessions.filter((session) => {
        const linkedBy = getSessionLinkedBy(session) || '';
        return linkedBy && !linkedBy.includes('webhook') && !linkedBy.includes('query') && !linkedBy.includes('claim') && !linkedBy.includes('fallback');
    });
    const unmatchedOrders = eligibleOrders.filter((order) => !order.checkout_session_matched);

    return {
        total_sessions: rows.length,
        matched_sessions: matchedSessions.length,
        open_sessions: openSessions.length,
        stale_sessions: staleSessions.length,
        failed_sessions: failedSessions.length,
        completed_unlinked_sessions: completedUnlinkedSessions.length,
        webhook_linked_sessions: webhookLinkedSessions.length,
        fallback_linked_sessions: fallbackLinkedSessions.length,
        direct_linked_sessions: directLinkedSessions.length,
        unmatched_orders: unmatchedOrders.length,
        eligible_orders: eligibleOrders.length,
        matched_orders: matchedOrders.length,
        match_rate: rows.length > 0 ? roundNumber((matchedSessions.length / rows.length) * 100, 2) : 0,
        order_match_rate: eligibleOrders.length > 0 ? roundNumber((matchedOrders.length / eligibleOrders.length) * 100, 2) : 0,
        anomaly_count: staleSessions.length + failedSessions.length + completedUnlinkedSessions.length + unmatchedOrders.length
    };
}

function buildOverview(orders) {
    const successfulOrders = (orders || []).filter(isSuccessOrder);
    const paidOrders = successfulOrders.length;
    const claimedOrders = (orders || []).filter((order) => Boolean(order.user_id)).length;
    const totalOrders = (orders || []).length;

    return {
        total_orders: totalOrders,
        paid_orders: paidOrders,
        redeemed_orders: (orders || []).filter((order) => order.status === 'redeemed').length,
        claimed_orders: claimedOrders,
        review_orders: (orders || []).filter((order) => order.status === 'pending_review').length,
        failed_orders: (orders || []).filter((order) => ['rejected', 'amount_mismatch'].includes(order.status)).length,
        total_amount: roundNumber(successfulOrders.reduce((sum, order) => sum + normalizeNumber(order.paid_amount, normalizeNumber(order.expected_amount, 0)), 0), 2),
        total_points: roundNumber(successfulOrders.reduce((sum, order) => sum + normalizeNumber(order.points_amount, 0), 0), 1),
        paid_rate: totalOrders > 0 ? roundNumber((paidOrders / totalOrders) * 100, 2) : 0,
        claim_rate: paidOrders > 0 ? roundNumber((claimedOrders / paidOrders) * 100, 2) : 0
    };
}

function buildFinanceSummary(paymentOrders, shopOrders, ledgerRows, balanceRows) {
    const successfulPayments = (paymentOrders || []).filter(isSuccessOrder);
    const nonRefundedShopOrders = (shopOrders || []).filter((order) => !isRefundedOrder(order));
    const refundedShopOrders = (shopOrders || []).filter((order) => isRefundedOrder(order));

    const pointsInflow = roundNumber((ledgerRows || [])
        .filter((entry) => normalizeNumber(entry.amount, 0) > 0)
        .reduce((sum, entry) => sum + normalizeNumber(entry.amount, 0), 0), 1);
    const pointsOutflow = roundNumber((ledgerRows || [])
        .filter((entry) => normalizeNumber(entry.amount, 0) < 0)
        .reduce((sum, entry) => sum + Math.abs(normalizeNumber(entry.amount, 0)), 0), 1);

    return {
        recharge_amount: roundNumber(successfulPayments.reduce((sum, order) => sum + normalizeNumber(order.paid_amount, normalizeNumber(order.expected_amount, 0)), 0), 2),
        recharge_points: roundNumber(successfulPayments.reduce((sum, order) => sum + normalizeNumber(order.points_amount, 0), 0), 1),
        recharge_order_count: successfulPayments.length,
        shop_points_spent: roundNumber(nonRefundedShopOrders.reduce((sum, order) => sum + normalizeNumber(order.price_paid, 0), 0), 1),
        shop_order_count: nonRefundedShopOrders.length,
        refunded_shop_points: roundNumber(refundedShopOrders.reduce((sum, order) => sum + normalizeNumber(order.price_paid, 0), 0), 1),
        refunded_shop_order_count: refundedShopOrders.length,
        points_inflow: pointsInflow,
        points_outflow: pointsOutflow,
        net_points_flow: roundNumber(pointsInflow - pointsOutflow, 1),
        circulating_points: roundNumber((balanceRows || []).reduce((sum, row) => sum + normalizeNumber(row.total_balance, 0), 0), 1),
        paid_balance: roundNumber((balanceRows || []).reduce((sum, row) => sum + normalizeNumber(row.paid_balance, 0), 0), 1),
        bonus_balance: roundNumber((balanceRows || []).reduce((sum, row) => sum + normalizeNumber(row.bonus_balance, 0), 0), 1)
    };
}

function createEmptyShopProfitAdjustmentSummary() {
    return {
        status: 'none',
        item_count: 0,
        total_amount_cny: 0,
        total_points: 0,
        affected_order_fingerprint: null,
        review_order_fingerprint: null,
        coupon_discount_cny: 0,
        bonus_points_excluded_cny: 0,
        untracked_points_estimated_cny: 0,
        refunded_revenue_reversal_cny: 0,
        items: []
    };
}

function createEmptyShopProfitAdjustmentBreakdown() {
    return {
        status: 'ready',
        item_count: 0,
        action_required_count: 0,
        tracked_count: 0,
        excluded_count: 0,
        review_count: 0,
        extension_count: 0,
        total_amount_cny: 0,
        total_points: 0,
        items: []
    };
}

function createEmptyShopProfitLedgerPreview() {
    return {
        status: 'none',
        entry_count: 0,
        order_count: 0,
        affected_order_fingerprint: null,
        net_amount_cny: 0,
        revenue_amount_cny: 0,
        cost_amount_cny: 0,
        reversal_amount_cny: 0,
        informational_points: 0,
        incomplete_entry_count: 0,
        estimated_entry_count: 0,
        entries_by_type: [],
        sample_entries: []
    };
}

function createEmptyShopProfitPointSourceCoverage() {
    return {
        status: 'none',
        tone: 'neutral',
        label: '暂无订单',
        order_count: 0,
        affected_order_fingerprint: null,
        action_required_order_fingerprint: null,
        source_lot_order_count: 0,
        exact_order_count: 0,
        partial_order_count: 0,
        balance_split_order_count: 0,
        legacy_untracked_order_count: 0,
        action_required_order_count: 0,
        expected_points: 0,
        source_lot_points: 0,
        cash_backed_points: 0,
        non_cash_points: 0,
        unknown_points: 0,
        untracked_points: 0,
        migration_points: 0,
        migration_order_count: 0,
        coverage_rate: 0,
        exact_order_rate: 0,
        source_type_count: 0,
        source_types: []
    };
}

function createEmptyShopProfitAuditAlerts() {
    return {
        status: 'ready',
        alert_count: 0,
        critical_count: 0,
        warning_count: 0,
        info_count: 0,
        action_required_count: 0,
        items: []
    };
}

function createEmptyShopProfitReconciliationClosure() {
    return {
        status: 'ready',
        item_count: 0,
        ready_count: 0,
        warning_count: 0,
        critical_count: 0,
        action_required_count: 0,
        items: []
    };
}

function createEmptyShopSourceProcurementRecommendations() {
    return {
        status: 'ready',
        source_count: 0,
        action_required_count: 0,
        pause_count: 0,
        complete_cost_count: 0,
        reorder_count: 0,
        observe_count: 0,
        items: []
    };
}

function createEmptyShopProfitReadinessSummary() {
    return {
        status: 'ready',
        label: '可结算',
        score: 100,
        blocker_count: 0,
        warning_count: 0,
        review_count: 0,
        action_required_count: 0,
        settlement_ready: true,
        items: []
    };
}

function createEmptyShopProfitHistoricalDisposition() {
    return {
        status: 'ready',
        label: '历史订单已收口',
        action_required_count: 0,
        completable_count: 0,
        estimated_count: 0,
        archive_candidate_count: 0,
        lanes: []
    };
}

function createEmptyShopProfitSummary() {
    return {
        basis: 'points_to_cny_parity',
        currency: 'CNY',
        order_count: 0,
        refunded_order_count: 0,
        gross_points: 0,
        revenue_points: 0,
        paid_points_spent: 0,
        bonus_points_spent: 0,
        untracked_revenue_points: 0,
        non_cash_points: 0,
        discount_points: 0,
        refunded_points: 0,
        recognized_revenue_cny: 0,
        purchase_cost_cny: 0,
        recognized_cost_cny: 0,
        net_profit_cny: 0,
        margin_rate: null,
        inventory_item_count: 0,
        costed_item_count: 0,
        missing_cost_item_count: 0,
        cost_coverage_rate: 0,
        cost_coverage_breakdown: {
            complete: 0,
            partial: 0,
            no_cost: 0,
            no_inventory: 0
        },
        reconciliation_status: 'ready',
        reconciliation_issue_count: 0,
        reconciliation_affected_order_count: 0,
        reconciliation_issues: [],
        historical_order_disposition: createEmptyShopProfitHistoricalDisposition(),
        order_risk_list: {
            status: 'ready',
            order_count: 0,
            critical_count: 0,
            warning_count: 0,
            review_count: 0,
            items: []
        },
        dimension_breakdown: {
            products: [],
            skus: [],
            source_batches: [],
            sources: []
        },
        profit_adjustments: createEmptyShopProfitAdjustmentSummary(),
        profit_adjustment_breakdown: createEmptyShopProfitAdjustmentBreakdown(),
        profit_ledger_preview: createEmptyShopProfitLedgerPreview(),
        point_source_coverage: createEmptyShopProfitPointSourceCoverage(),
        shop_profit_audit_alerts: createEmptyShopProfitAuditAlerts(),
        profit_reconciliation_closure: createEmptyShopProfitReconciliationClosure(),
        source_procurement_recommendations: createEmptyShopSourceProcurementRecommendations(),
        profit_readiness: createEmptyShopProfitReadinessSummary(),
        notes: [
            '优先按订单付费积分确认现金收入；历史未拆分订单仍按 1 积分≈1 元估算。'
        ]
    };
}

const SHOP_PROFIT_RECONCILIATION_ISSUE_META = Object.freeze({
    negative_profit: Object.freeze({
        tone: 'critical',
        title: '负利润订单',
        description: '确认收入低于采购成本，需要核对售价、成本、优惠和补发记录。'
    }),
    missing_cost: Object.freeze({
        tone: 'warning',
        title: '采购成本未闭环',
        description: '关联库存存在缺失采购成本，当前净利润可能被高估。'
    }),
    no_inventory: Object.freeze({
        tone: 'warning',
        title: '订单未关联库存',
        description: '订单无法追溯到具体库存，采购成本和货源表现无法归因。'
    }),
    untracked_points: Object.freeze({
        tone: 'warning',
        title: '积分来源未拆分',
        description: '历史订单缺少付费/赠送积分来源拆分，现金收入仍按旧口径估算。'
    }),
    bonus_points: Object.freeze({
        tone: 'info',
        title: '非现金积分消耗',
        description: '奖励、赠送或活动积分已从现金收入确认中剔除，需纳入营销成本口径。'
    }),
    refunded: Object.freeze({
        tone: 'info',
        title: '退款订单冲销',
        description: '退款订单不确认本单收入和成本，需与库存状态、补发和退款流水一起核对。'
    })
});

function getShopProfitIssueOrderLabel(order = {}) {
    const metadata = normalizeJsonObject(order?.metadata);
    return String(
        order?.order_no
        || order?.order_number
        || order?.order_id
        || metadata.order_no
        || metadata.provider_order_no
        || order?.id
        || ''
    ).trim() || '未知订单';
}

function getShopProfitOrderRiskStatusLabel({ severity = '', missingCostItemCount = 0, coverage = '', traceability = {}, untrackedPoints = 0, adjustments = {} } = {}) {
    const normalizedSeverity = String(severity || '').trim().toLowerCase();
    const normalizedCoverage = String(coverage || '').trim().toLowerCase();
    if (normalizedSeverity === 'critical') {
        return '负利润待复核';
    }
    if (normalizeNumber(missingCostItemCount, 0) > 0) {
        return '采购成本待补齐';
    }
    if (normalizedCoverage === 'no_inventory') {
        return '库存关联待补齐';
    }
    if (Boolean(traceability?.action_required) || normalizeNumber(untrackedPoints || traceability?.untracked_points, 0) > 0) {
        return '积分来源待补齐';
    }
    if (adjustments?.status === 'review_required') {
        return '利润调整待复核';
    }
    if (normalizedSeverity === 'warning') {
        return '归因信息待补齐';
    }
    if (normalizedSeverity === 'review') {
        return '订单利润待复核';
    }
    return '正常';
}

function buildShopProfitIssueSample(row = {}) {
    const order = row?.order || {};
    const attribution = row?.attribution || {};
    const traceability = normalizeJsonObject(attribution.point_source_traceability);

    return {
        order_id: String(order?.id || '').trim() || null,
        order_no: getShopProfitIssueOrderLabel(order),
        product_name: String(order?.snapshot_product_name || order?.product_name || '').trim() || null,
        created_at: order?.created_at || null,
        net_profit_cny: roundNumber(attribution.net_profit_cny, 4),
        recognized_revenue_cny: roundNumber(attribution.recognized_revenue_cny, 4),
        recognized_cost_cny: roundNumber(attribution.recognized_cost_cny, 4),
        missing_cost_item_count: roundNumber(attribution.missing_cost_item_count, 0),
        cost_coverage: String(attribution.cost_coverage || '').trim().toLowerCase() || null,
        untracked_revenue_points: roundNumber(attribution.untracked_revenue_points, 2),
        bonus_points_spent: roundNumber(attribution.bonus_points_spent, 2),
        point_source_traceability_status: String(traceability.status || '').trim() || null,
        point_source_traceability_label: String(traceability.label || '').trim() || null,
        point_source_traceability_tone: String(traceability.tone || '').trim() || null,
        point_source_traceability_action_required: Boolean(traceability.action_required),
        refunded: Boolean(attribution.refunded)
    };
}

function createShopProfitResolutionOption(key, label, description, nextState = '') {
    return {
        key,
        label,
        description,
        next_state: nextState || null
    };
}

function buildShopProfitResolutionPlan({ type = '', severity = '', coverage = '', missingCostItemCount = 0, traceability = {}, untrackedPoints = 0, adjustments = {}, netProfitCny = 0 } = {}) {
    const normalizedType = String(type || '').trim().toLowerCase();
    const normalizedCoverage = String(coverage || '').trim().toLowerCase();
    const traceabilityStatus = String(traceability?.status || '').trim().toLowerCase();
    const unresolvedPoints = normalizeNumber(untrackedPoints || traceability?.untracked_points, 0);
    const hasCostGap = normalizeNumber(missingCostItemCount, 0) > 0 || normalizedCoverage === 'no_inventory';
    const hasPointHistoryGap = unresolvedPoints > 0
        || Boolean(traceability?.action_required)
        || ['legacy_untracked', 'balance_split_gap', 'partial_lot_gap'].includes(traceabilityStatus);
    const hasIrrecoverableHistoryGap = traceabilityStatus === 'legacy_untracked' && unresolvedPoints > 0;
    const isArchiveCandidate = normalizedCoverage === 'no_inventory' && hasIrrecoverableHistoryGap;
    const hasAdjustmentGap = String(adjustments?.status || '').trim().toLowerCase() === 'review_required'
        || normalizedType === 'profit_adjustments_review';
    const isNegativeProfit = Number(netProfitCny || 0) < 0 || normalizedType === 'negative_profit' || String(severity || '').trim().toLowerCase() === 'critical';
    const options = [];

    if (hasCostGap) {
        options.push(createShopProfitResolutionOption(
            normalizedCoverage === 'no_inventory' ? 'bind_inventory' : 'complete_cost',
            normalizedCoverage === 'no_inventory' ? '绑定库存/批次' : '补齐采购成本',
            normalizedCoverage === 'no_inventory'
                ? '能找到发货库存时先绑定订单与库存，再回算采购成本。'
                : '能追溯采购记录时补录批次单价、汇率和凭证。',
            '已补齐'
        ));
    }

    if (hasPointHistoryGap) {
        options.push(createShopProfitResolutionOption(
            'historical_estimate',
            '标记历史估算',
            '无法还原逐笔积分来源但可确认旧口径时，保留估算标记并从精确净利润中单独披露。',
            '历史估算'
        ));
    }

    if (isArchiveCandidate) {
        options.push(createShopProfitResolutionOption(
            'historical_untraceable',
            '历史不可追溯',
            '库存和积分来源都无法补齐时，归档到历史未归因汇总，不再反复进入新风险队列。',
            '历史不可追溯'
        ));
    }

    if (hasAdjustmentGap) {
        options.push(createShopProfitResolutionOption(
            'append_adjustment',
            '追加调整分录',
            '优惠、退款、补发或人工调整通过反向/调整分录收口，不覆盖原始利润。',
            '调整已入账'
        ));
    }

    if (isNegativeProfit) {
        options.unshift(createShopProfitResolutionOption(
            'manual_profit_review',
            '逐单复核',
            '先核对售价、成本、优惠、补发和退款，确认是真亏损还是缺数据造成的假亏损。',
            '已复核'
        ));
    }

    if (!options.length) {
        options.push(createShopProfitResolutionOption(
            'monitor',
            '继续观察',
            '当前只影响口径展示，后续有新退款、补发或调整时再进入复核。',
            '观察中'
        ));
    }

    let status = 'manual_review';
    let label = '逐单复核';
    let tone = isNegativeProfit ? 'critical' : 'review';
    let primaryAction = isNegativeProfit ? '核对售价、采购成本、优惠和补发记录' : '复核订单利润归因';
    let description = '按订单查看收入、成本、优惠、退款和积分来源，确认是否需要补录或调整。';

    if (isNegativeProfit) {
        status = 'manual_review';
        label = '逐单复核';
        tone = 'critical';
        primaryAction = '核对售价、采购成本、优惠和补发记录';
        description = '负利润订单先确认是真亏损还是缺成本、优惠、退款或补发造成的口径偏差，再决定补齐、估算或归档。';
    } else if (isArchiveCandidate) {
        status = 'historical_archive_candidate';
        label = '历史不可追溯候选';
        tone = 'warning';
        primaryAction = '先尝试补齐库存/成本和积分来源，无法追溯时归档到历史未归因汇总';
        description = '这类旧订单不应永久阻塞新风险处理；能补齐则补齐，不能补齐则以历史不可追溯口径收口。';
    } else if (hasCostGap) {
        status = 'data_completion';
        label = normalizedCoverage === 'no_inventory' ? '补齐库存关联' : '补齐采购成本';
        tone = 'warning';
        primaryAction = normalizedCoverage === 'no_inventory' ? '补齐订单与库存/批次关联' : '补齐采购成本或采购批次';
        description = '优先补齐可追溯的库存和采购信息，补齐后重新生成利润分录。';
    } else if (hasPointHistoryGap) {
        status = 'historical_estimation';
        label = '历史积分估算';
        tone = 'warning';
        primaryAction = '补齐积分来源；无法还原时标记历史估算';
        description = '旧订单缺少积分批次消耗明细时，不按 0 收入处理，保留旧口径估算并单独披露。';
    } else if (hasAdjustmentGap) {
        status = 'adjustment_review';
        label = '调整分录复核';
        tone = 'warning';
        primaryAction = '追加优惠、退款、补发或人工调整分录';
        description = '通过追加分录解释净利润变化，避免覆盖原始订单收入和成本。';
    }

    return {
        status,
        label,
        tone,
        primary_action: primaryAction,
        description,
        settlement_treatment: status === 'historical_archive_candidate'
            ? '不进入精确净利润，进入历史未归因金额汇总'
            : (status === 'historical_estimation' ? '进入估算净利润，需与精确净利润分开展示' : '补齐后进入精确净利润'),
        options
    };
}

function buildShopProfitReconciliationIssues(shopProfitRows = []) {
    const buckets = new Map(Object.entries(SHOP_PROFIT_RECONCILIATION_ISSUE_META).map(([type, meta]) => [type, {
        type,
        ...meta,
        count: 0,
        order_count: 0,
        amount_cny: 0,
        points: 0,
        sample_orders: [],
        _orderIds: new Set()
    }]));
    const affectedOrderIds = new Set();
    const sampleLimit = 4;

    function addIssue(type, row, metrics = {}) {
        const bucket = buckets.get(type);
        if (!bucket) return;

        bucket.count += Math.max(0, normalizeNumber(metrics.count, 1));
        bucket.order_count += 1;
        bucket.amount_cny += Math.max(0, normalizeNumber(metrics.amount_cny, 0));
        bucket.points += Math.max(0, normalizeNumber(metrics.points, 0));

        const orderId = String(row?.order?.id || '').trim();
        if (orderId) {
            affectedOrderIds.add(orderId);
            bucket._orderIds.add(orderId);
        }

        if (bucket.sample_orders.length < sampleLimit) {
            bucket.sample_orders.push(buildShopProfitIssueSample(row));
        }
    }

    (Array.isArray(shopProfitRows) ? shopProfitRows : []).forEach((row) => {
        const attribution = row?.attribution || null;
        if (!attribution) return;

        const revenueCny = normalizeNumber(attribution.recognized_revenue_cny, 0);
        const netProfitCny = normalizeNumber(attribution.net_profit_cny, 0);
        const missingCostItemCount = normalizeNumber(attribution.missing_cost_item_count, 0);
        const coverage = String(attribution.cost_coverage || '').trim().toLowerCase();
        const untrackedPoints = normalizeNumber(attribution.untracked_revenue_points, 0);
        const bonusPoints = normalizeNumber(attribution.bonus_points_spent, 0);
        const refundedPoints = normalizeNumber(attribution.refunded_points, 0);

        if (!attribution.refunded && netProfitCny < 0) {
            addIssue('negative_profit', row, {
                count: 1,
                amount_cny: Math.abs(netProfitCny)
            });
        }
        if (missingCostItemCount > 0) {
            addIssue('missing_cost', row, {
                count: missingCostItemCount,
                amount_cny: revenueCny
            });
        }
        if (coverage === 'no_inventory') {
            addIssue('no_inventory', row, {
                count: 1,
                amount_cny: revenueCny
            });
        }
        if (untrackedPoints > 0) {
            addIssue('untracked_points', row, {
                count: 1,
                points: untrackedPoints
            });
        }
        if (bonusPoints > 0) {
            addIssue('bonus_points', row, {
                count: 1,
                points: bonusPoints
            });
        }
        if (attribution.refunded) {
            addIssue('refunded', row, {
                count: 1,
                points: refundedPoints
            });
        }
    });

    const order = ['negative_profit', 'missing_cost', 'no_inventory', 'untracked_points', 'bonus_points', 'refunded'];
    const issues = order
        .map((type) => buckets.get(type))
        .filter((issue) => issue && issue.order_count > 0)
        .map((issue) => {
            const { _orderIds, ...item } = issue;
            return {
                ...item,
                count: roundNumber(item.count, 2),
                amount_cny: roundNumber(item.amount_cny, 4),
                points: roundNumber(item.points, 2),
                affected_order_fingerprint: buildShopProfitOrderFingerprint(_orderIds)
            };
        });
    const hasCritical = issues.some((issue) => issue.tone === 'critical');
    const hasWarning = issues.some((issue) => issue.tone === 'warning');

    return {
        status: hasCritical ? 'critical' : (hasWarning ? 'warning' : (issues.length ? 'review' : 'ready')),
        issue_count: issues.length,
        affected_order_count: affectedOrderIds.size,
        issues
    };
}

function createShopProfitOrderRiskItem(row = {}) {
    const order = row?.order || {};
    const attribution = row?.attribution || {};
    const traceability = normalizeJsonObject(attribution.point_source_traceability);
    const adjustments = normalizeJsonObject(attribution.profit_adjustments);
    const orderId = String(order?.id || '').trim();
    const netProfitCny = normalizeNumber(attribution.net_profit_cny, 0);
    const missingCostItemCount = normalizeNumber(attribution.missing_cost_item_count, 0);
    const coverage = String(attribution.cost_coverage || '').trim().toLowerCase();
    const untrackedPoints = normalizeNumber(attribution.untracked_revenue_points, 0);
    const bonusPoints = normalizeNumber(attribution.bonus_points_spent, 0);
    const refunded = Boolean(attribution.refunded);
    const reasons = [];
    let severity = 'ready';
    let priority = 0;

    function addReason(type, label, tone = 'warning', weight = 10) {
        reasons.push({ type, label, tone });
        if (tone === 'critical') {
            severity = 'critical';
        } else if (severity !== 'critical' && tone === 'warning') {
            severity = 'warning';
        } else if (severity === 'ready') {
            severity = 'review';
        }
        priority = Math.max(priority, weight);
    }

    if (!refunded && netProfitCny < 0) {
        addReason('negative_profit', '负利润', 'critical', 100);
    }
    if (missingCostItemCount > 0) {
        addReason('missing_cost', `缺成本 ${roundNumber(missingCostItemCount, 0)} 件`, 'warning', 90);
    }
    if (coverage === 'no_inventory') {
        addReason('no_inventory', '未关联库存', 'warning', 85);
    }
    if (Boolean(traceability.action_required) || untrackedPoints > 0) {
        addReason('point_source_gap', `积分来源需复核 ${roundNumber(untrackedPoints || traceability.untracked_points, 2).toLocaleString('zh-CN')}`, 'warning', 80);
    }
    if (adjustments.status === 'review_required') {
        addReason('adjustment_review', '利润调整需复核', 'warning', 70);
    }
    if (bonusPoints > 0) {
        addReason('non_cash_points', `非现金积分 ${roundNumber(bonusPoints, 2).toLocaleString('zh-CN')}`, 'review', 45);
    }
    if (refunded) {
        addReason('refunded', '退款冲销', 'review', 40);
    }

    if (!reasons.length || !orderId) {
        return null;
    }

    const actionLabel = severity === 'critical'
        ? '优先核对售价、采购成本和补发记录'
        : (missingCostItemCount > 0 || coverage === 'no_inventory'
            ? '补齐库存采购成本或订单库存关联'
            : (untrackedPoints > 0 || traceability.action_required
                ? '补齐积分来源批次消耗明细'
                : '复核优惠、非现金积分或退款调整'));
    const resolutionPlan = buildShopProfitResolutionPlan({
        severity,
        coverage,
        missingCostItemCount,
        traceability,
        untrackedPoints,
        adjustments,
        netProfitCny
    });

    return {
        order_id: orderId,
        order_no: getShopProfitIssueOrderLabel(order),
        product_name: String(order?.snapshot_product_name || order?.product_name || '').trim() || null,
        created_at: order?.created_at || null,
        severity,
        tone: severity,
        priority,
        status_label: getShopProfitOrderRiskStatusLabel({
            severity,
            missingCostItemCount,
            coverage,
            traceability,
            untrackedPoints,
            adjustments
        }),
        reasons,
        action_label: actionLabel,
        resolution_plan: resolutionPlan,
        recognized_revenue_cny: roundNumber(attribution.recognized_revenue_cny, 4),
        recognized_cost_cny: roundNumber(attribution.recognized_cost_cny, 4),
        net_profit_cny: roundNumber(netProfitCny, 4),
        missing_cost_item_count: roundNumber(missingCostItemCount, 0),
        cost_coverage: coverage || null,
        paid_points_spent: roundNumber(attribution.paid_points_spent, 2),
        bonus_points_spent: roundNumber(bonusPoints, 2),
        untracked_revenue_points: roundNumber(untrackedPoints, 2),
        point_source_traceability_status: String(traceability.status || '').trim() || null,
        point_source_traceability_label: String(traceability.label || '').trim() || null,
        refunded
    };
}

function buildShopProfitHistoricalDisposition(riskItems = []) {
    const summary = createEmptyShopProfitHistoricalDisposition();
    const lanes = new Map([
        ['data_completion', {
            key: 'data_completion',
            label: '可补齐',
            tone: 'warning',
            count: 0,
            description: '有库存、采购批次或积分线索的订单，优先补齐后重新结算。',
            action_label: '补齐成本、库存关联或积分来源'
        }],
        ['historical_estimation', {
            key: 'historical_estimation',
            label: '历史估算',
            tone: 'warning',
            count: 0,
            description: '只缺旧积分来源拆分但收入口径可确认的订单，保留估算标记单独披露。',
            action_label: '标记历史估算并分开展示'
        }],
        ['historical_archive_candidate', {
            key: 'historical_archive_candidate',
            label: '不可追溯归档',
            tone: 'review',
            count: 0,
            description: '库存和积分来源都无法还原的旧订单，进入历史未归因汇总，不继续污染新风险。',
            action_label: '归档为历史不可追溯'
        }],
        ['manual_review', {
            key: 'manual_review',
            label: '逐单复核',
            tone: 'critical',
            count: 0,
            description: '负利润或存在退款/补发争议的订单，需要管理员逐单确认。',
            action_label: '核对售价、成本、优惠和退款'
        }],
        ['adjustment_review', {
            key: 'adjustment_review',
            label: '调整分录',
            tone: 'warning',
            count: 0,
            description: '优惠、赠送积分、退款、补发或人工调整通过追加分录解释。',
            action_label: '追加反向或调整分录'
        }]
    ]);

    (Array.isArray(riskItems) ? riskItems : []).forEach((item) => {
        const plan = normalizeJsonObject(item?.resolution_plan);
        const status = String(plan.status || '').trim().toLowerCase();
        if (!status) return;
        const laneKey = lanes.has(status) ? status : (status === 'historical_untraceable' ? 'historical_archive_candidate' : 'manual_review');
        const lane = lanes.get(laneKey);
        if (!lane) return;
        lane.count += 1;
    });

    summary.lanes = [...lanes.values()].filter((lane) => lane.count > 0);
    summary.action_required_count = summary.lanes.reduce((total, lane) => total + lane.count, 0);
    summary.completable_count = normalizeNumber(lanes.get('data_completion')?.count, 0);
    summary.estimated_count = normalizeNumber(lanes.get('historical_estimation')?.count, 0);
    summary.archive_candidate_count = normalizeNumber(lanes.get('historical_archive_candidate')?.count, 0);
    summary.status = summary.archive_candidate_count > 0
        ? 'review'
        : (summary.action_required_count > 0 ? 'warning' : 'ready');
    summary.label = summary.action_required_count > 0 ? '历史风险待收口' : '历史订单已收口';
    return summary;
}

function buildShopProfitOrderRiskList(shopProfitRows = []) {
    const items = (Array.isArray(shopProfitRows) ? shopProfitRows : [])
        .map(createShopProfitOrderRiskItem)
        .filter(Boolean)
        .sort((left, right) => (
            Number(right.priority || 0) - Number(left.priority || 0)
            || ({ critical: 3, warning: 2, review: 1, ready: 0 }[right.severity] || 0) - ({ critical: 3, warning: 2, review: 1, ready: 0 }[left.severity] || 0)
            || Math.abs(Number(right.net_profit_cny || 0)) - Math.abs(Number(left.net_profit_cny || 0))
            || new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime()
        ));

    return {
        status: items.some((item) => item.severity === 'critical')
            ? 'critical'
            : (items.some((item) => item.severity === 'warning') ? 'warning' : (items.length ? 'review' : 'ready')),
        order_count: items.length,
        critical_count: items.filter((item) => item.severity === 'critical').length,
        warning_count: items.filter((item) => item.severity === 'warning').length,
        review_count: items.filter((item) => item.severity === 'review').length,
        items: items.slice(0, 12)
    };
}

async function loadShopProcurementBatchesByIds(client, batchIds = []) {
    const ids = [...new Set((Array.isArray(batchIds) ? batchIds : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean))];

    if (!client || !ids.length) {
        return new Map();
    }

    try {
        const rows = await fetchPagedRows(() => client
            .from('shop_procurement_batches')
            .select('id, batch_code, source_id, unit_cost_cny, total_cost_cny, quality_status, quality_score, cost_status')
            .in('id', ids), SUMMARY_PAGE_SIZES.default, 10);

        return new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row?.id || '').trim(), row]));
    } catch (error) {
        if (isMissingColumnError(error) || String(error?.code || '') === '42P01' || String(error?.code || '').toUpperCase() === 'PGRST205') {
            return new Map();
        }
        throw error;
    }
}

async function loadShopInventorySourcesByIds(client, sourceIds = []) {
    const ids = [...new Set((Array.isArray(sourceIds) ? sourceIds : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean))];

    if (!client || !ids.length) {
        return new Map();
    }

    try {
        const rows = await fetchPagedRows(() => client
            .from('shop_inventory_sources')
            .select('id, source_name, source_url, platform, risk_tier, quality_grade')
            .in('id', ids), SUMMARY_PAGE_SIZES.default, 10);

        return new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row?.id || '').trim(), row]));
    } catch (error) {
        if (isMissingColumnError(error) || String(error?.code || '') === '42P01' || String(error?.code || '').toUpperCase() === 'PGRST205') {
            return new Map();
        }
        throw error;
    }
}

function enrichShopProfitRowsWithProcurementSources(rows = [], batchesById = new Map(), sourcesById = new Map()) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
        const attribution = row?.attribution || {};
        const itemCosts = Array.isArray(attribution.item_costs) ? attribution.item_costs : [];
        const enrichedItemCosts = itemCosts.map((item) => {
            const batchId = String(item?.source_batch_id || '').trim();
            const batch = batchId ? batchesById.get(batchId) || null : null;
            const sourceId = String(batch?.source_id || '').trim();
            const source = sourceId ? sourcesById.get(sourceId) || null : null;
            return {
                ...item,
                source_id: sourceId || null,
                source_name: source?.source_name || null,
                source_platform: source?.platform || null,
                source_risk_tier: source?.risk_tier || null,
                source_quality_grade: source?.quality_grade || null,
                procurement_batch_code: batch?.batch_code || null,
                procurement_quality_status: batch?.quality_status || null,
                procurement_quality_score: batch?.quality_score ?? null,
                procurement_cost_status: batch?.cost_status || null
            };
        });

        return {
            ...row,
            attribution: {
                ...attribution,
                item_costs: enrichedItemCosts
            }
        };
    });
}

function normalizeShopProfitDimensionKey(value, fallback = 'unknown') {
    const text = String(value || '').trim();
    return (text || fallback).slice(0, 180).toLowerCase();
}

function getShopProfitSkuDimensionLabel(primary = {}, fallback = {}) {
    const skuName = String(primary?.sku_name || primary?.skuName || fallback?.sku_name || fallback?.skuName || '').trim();
    const skuCode = String(primary?.sku_code || primary?.skuCode || fallback?.sku_code || fallback?.skuCode || '').trim();

    if (skuName && skuCode && !skuName.toLowerCase().includes(skuCode.toLowerCase())) {
        return `${skuName} (${skuCode})`;
    }
    return skuName || (skuCode ? `规格 ${skuCode}` : '未记录规格');
}

function createShopProfitDimensionAccumulator(type, key, label) {
    return {
        type,
        key,
        label,
        order_count: 0,
        refunded_order_count: 0,
        negative_profit_order_count: 0,
        missing_cost_order_count: 0,
        no_inventory_order_count: 0,
        inventory_item_count: 0,
        costed_item_count: 0,
        missing_cost_item_count: 0,
        recognized_revenue_cny: 0,
        recognized_cost_cny: 0,
        net_profit_cny: 0,
        bonus_points_spent: 0,
        untracked_revenue_points: 0,
        sample_orders: [],
        _orderIds: new Set(),
        _refundedOrderIds: new Set(),
        _negativeOrderIds: new Set(),
        _missingCostOrderIds: new Set(),
        _noInventoryOrderIds: new Set()
    };
}

function addShopProfitDimensionContribution(map, identity, contribution) {
    const normalizedKey = normalizeShopProfitDimensionKey(identity?.key, 'unknown');
    if (!map.has(normalizedKey)) {
        map.set(normalizedKey, {
            key: normalizedKey,
            label: String(identity?.label || '').trim() || '未命名',
            recognized_revenue_cny: 0,
            recognized_cost_cny: 0,
            bonus_points_spent: 0,
            untracked_revenue_points: 0,
            inventory_item_count: 0,
            costed_item_count: 0,
            missing_cost_item_count: 0,
            no_inventory: false
        });
    }

    const row = map.get(normalizedKey);
    if (Object.prototype.hasOwnProperty.call(identity || {}, 'source_id')) {
        row.source_id = identity.source_id || row.source_id || null;
    }
    if (Object.prototype.hasOwnProperty.call(identity || {}, 'source_name')) {
        row.source_name = identity.source_name || row.source_name || null;
    }
    if (Object.prototype.hasOwnProperty.call(identity || {}, 'source_platform')) {
        row.source_platform = identity.source_platform || row.source_platform || null;
    }
    if (Object.prototype.hasOwnProperty.call(identity || {}, 'source_risk_tier')) {
        row.source_risk_tier = identity.source_risk_tier || row.source_risk_tier || null;
    }
    if (Object.prototype.hasOwnProperty.call(identity || {}, 'source_quality_grade')) {
        row.source_quality_grade = identity.source_quality_grade || row.source_quality_grade || null;
    }
    row.recognized_revenue_cny += normalizeNumber(contribution.recognized_revenue_cny, 0);
    row.recognized_cost_cny += normalizeNumber(contribution.recognized_cost_cny, 0);
    row.bonus_points_spent += normalizeNumber(contribution.bonus_points_spent, 0);
    row.untracked_revenue_points += normalizeNumber(contribution.untracked_revenue_points, 0);
    row.inventory_item_count += normalizeNumber(contribution.inventory_item_count, 0);
    row.costed_item_count += normalizeNumber(contribution.costed_item_count, 0);
    row.missing_cost_item_count += normalizeNumber(contribution.missing_cost_item_count, 0);
    row.no_inventory = row.no_inventory || Boolean(contribution.no_inventory);
}

function buildShopProfitRowDimensionContributions(row = {}) {
    const order = row?.order || {};
    const attribution = row?.attribution || {};
    const itemCosts = Array.isArray(attribution.item_costs) ? attribution.item_costs.filter(Boolean) : [];
    const productMap = new Map();
    const skuMap = new Map();
    const sourceBatchMap = new Map();
    const sourceMap = new Map();
    const recognizedRevenueCny = normalizeNumber(attribution.recognized_revenue_cny, 0);
    const bonusPoints = normalizeNumber(attribution.bonus_points_spent, 0);
    const untrackedPoints = normalizeNumber(attribution.untracked_revenue_points, 0);

    if (!itemCosts.length) {
        const productLabel = String(order?.snapshot_product_name || order?.product_name || '').trim() || '未命名商品';
        const contribution = {
            recognized_revenue_cny: recognizedRevenueCny,
            recognized_cost_cny: 0,
            bonus_points_spent: bonusPoints,
            untracked_revenue_points: untrackedPoints,
            inventory_item_count: 0,
            costed_item_count: 0,
            missing_cost_item_count: 0,
            no_inventory: true
        };
        const skuId = String(order?.sku_id || '').trim();
        const skuLabel = getShopProfitSkuDimensionLabel(order);
        addShopProfitDimensionContribution(productMap, { key: productLabel, label: productLabel }, contribution);
        addShopProfitDimensionContribution(skuMap, {
            key: skuId || `unlinked:${productLabel}`,
            label: skuId ? skuLabel : '未记录规格'
        }, contribution);
        addShopProfitDimensionContribution(sourceBatchMap, { key: 'unlinked_inventory', label: '未关联库存' }, contribution);
        addShopProfitDimensionContribution(sourceMap, { key: 'unlinked_inventory', label: '未归因货源' }, contribution);
        return {
            products: [...productMap.values()],
            skus: [...skuMap.values()],
            source_batches: [...sourceBatchMap.values()],
            sources: [...sourceMap.values()]
        };
    }

    const itemRevenuePoints = itemCosts.map((item) => Math.max(0, normalizeNumber(item.item_revenue_points, 0)));
    const totalItemRevenuePoints = itemRevenuePoints.reduce((sum, value) => sum + value, 0);
    const fallbackShare = itemCosts.length ? 1 / itemCosts.length : 0;

    itemCosts.forEach((item, index) => {
        const share = totalItemRevenuePoints > 0
            ? itemRevenuePoints[index] / totalItemRevenuePoints
            : fallbackShare;
        const costCny = item.cost_status === 'costed'
            ? normalizeNumber(item.purchase_unit_cost_cny, 0)
            : 0;
        const productLabel = String(item.product_name || order?.snapshot_product_name || '').trim() || '未命名商品';
        const skuId = String(item.sku_id || order?.sku_id || '').trim();
        const skuLabel = getShopProfitSkuDimensionLabel(item, order);
        const sourceBatchId = String(item.source_batch_id || '').trim();
        const contribution = {
            recognized_revenue_cny: recognizedRevenueCny * share,
            recognized_cost_cny: attribution.refunded ? 0 : costCny,
            bonus_points_spent: bonusPoints * share,
            untracked_revenue_points: untrackedPoints * share,
            inventory_item_count: 1,
            costed_item_count: item.cost_status === 'costed' ? 1 : 0,
            missing_cost_item_count: item.cost_status === 'costed' ? 0 : 1,
            no_inventory: false
        };

        addShopProfitDimensionContribution(productMap, { key: productLabel, label: productLabel }, contribution);
        addShopProfitDimensionContribution(skuMap, {
            key: skuId || `unattributed_sku:${productLabel}`,
            label: skuId ? skuLabel : '未记录规格'
        }, contribution);
        addShopProfitDimensionContribution(sourceBatchMap, {
            key: sourceBatchId || 'unattributed_batch',
            label: sourceBatchId ? `批次 ${sourceBatchId}` : '未记录批次'
        }, contribution);
        const sourceId = String(item.source_id || '').trim();
        const sourceName = String(item.source_name || '').trim();
        const sourceLabel = sourceName || (sourceId ? `货源 ${sourceId}` : '未归因货源');
        addShopProfitDimensionContribution(sourceMap, {
            key: sourceId || sourceLabel,
            label: sourceLabel,
            source_id: sourceId || null,
            source_name: sourceName || null,
            source_platform: item.source_platform || null,
            source_risk_tier: item.source_risk_tier || null,
            source_quality_grade: item.source_quality_grade || null
        }, contribution);
    });

    return {
        products: [...productMap.values()],
        skus: [...skuMap.values()],
        source_batches: [...sourceBatchMap.values()],
        sources: [...sourceMap.values()]
    };
}

function buildShopProfitDimensionSample(row = {}, contribution = {}) {
    const order = row?.order || {};
    const netProfitCny = roundNumber(
        normalizeNumber(contribution.recognized_revenue_cny, 0) - normalizeNumber(contribution.recognized_cost_cny, 0),
        4
    );

    return {
        order_id: String(order?.id || '').trim() || null,
        order_no: getShopProfitIssueOrderLabel(order),
        product_name: String(order?.snapshot_product_name || order?.product_name || contribution.label || '').trim() || null,
        created_at: order?.created_at || null,
        recognized_revenue_cny: roundNumber(contribution.recognized_revenue_cny, 4),
        recognized_cost_cny: roundNumber(contribution.recognized_cost_cny, 4),
        net_profit_cny: netProfitCny,
        missing_cost_item_count: roundNumber(contribution.missing_cost_item_count, 0),
        no_inventory: Boolean(contribution.no_inventory)
    };
}

function applyShopProfitDimensionContribution(bucket, row = {}, contribution = {}) {
    const attribution = row?.attribution || {};
    const orderId = String(row?.order?.id || '').trim() || getShopProfitIssueOrderLabel(row?.order || {});
    const netProfitCny = normalizeNumber(contribution.recognized_revenue_cny, 0) - normalizeNumber(contribution.recognized_cost_cny, 0);

    if (!bucket._orderIds.has(orderId)) {
        bucket._orderIds.add(orderId);
        bucket.order_count += 1;
    }
    if (attribution.refunded && !bucket._refundedOrderIds.has(orderId)) {
        bucket._refundedOrderIds.add(orderId);
        bucket.refunded_order_count += 1;
    }
    if (!attribution.refunded && netProfitCny < 0 && !bucket._negativeOrderIds.has(orderId)) {
        bucket._negativeOrderIds.add(orderId);
        bucket.negative_profit_order_count += 1;
    }
    if (normalizeNumber(contribution.missing_cost_item_count, 0) > 0 && !bucket._missingCostOrderIds.has(orderId)) {
        bucket._missingCostOrderIds.add(orderId);
        bucket.missing_cost_order_count += 1;
    }
    if (contribution.no_inventory && !bucket._noInventoryOrderIds.has(orderId)) {
        bucket._noInventoryOrderIds.add(orderId);
        bucket.no_inventory_order_count += 1;
    }

    bucket.inventory_item_count += normalizeNumber(contribution.inventory_item_count, 0);
    bucket.costed_item_count += normalizeNumber(contribution.costed_item_count, 0);
    bucket.missing_cost_item_count += normalizeNumber(contribution.missing_cost_item_count, 0);
    bucket.recognized_revenue_cny += normalizeNumber(contribution.recognized_revenue_cny, 0);
    bucket.recognized_cost_cny += normalizeNumber(contribution.recognized_cost_cny, 0);
    bucket.net_profit_cny += netProfitCny;
    bucket.bonus_points_spent += normalizeNumber(contribution.bonus_points_spent, 0);
    bucket.untracked_revenue_points += normalizeNumber(contribution.untracked_revenue_points, 0);

    if (bucket.sample_orders.length < 3) {
        bucket.sample_orders.push(buildShopProfitDimensionSample(row, contribution));
    }
}

function serializeShopProfitDimensionBucket(bucket) {
    const recognizedRevenueCny = roundNumber(bucket.recognized_revenue_cny, 4);
    const recognizedCostCny = roundNumber(bucket.recognized_cost_cny, 4);
    const netProfitCny = roundNumber(bucket.net_profit_cny, 4);
    const riskTone = bucket.negative_profit_order_count > 0
        ? 'critical'
        : (bucket.missing_cost_order_count > 0 || bucket.no_inventory_order_count > 0 ? 'warning' : 'ready');
    const riskLabel = riskTone === 'critical'
        ? '负利润'
        : (riskTone === 'warning' ? '需补齐' : '正常');

    return {
        type: bucket.type,
        key: bucket.key,
        label: bucket.label,
        order_count: bucket.order_count,
        refunded_order_count: bucket.refunded_order_count,
        negative_profit_order_count: bucket.negative_profit_order_count,
        missing_cost_order_count: bucket.missing_cost_order_count,
        no_inventory_order_count: bucket.no_inventory_order_count,
        inventory_item_count: roundNumber(bucket.inventory_item_count, 0),
        costed_item_count: roundNumber(bucket.costed_item_count, 0),
        missing_cost_item_count: roundNumber(bucket.missing_cost_item_count, 0),
        recognized_revenue_cny: recognizedRevenueCny,
        recognized_cost_cny: recognizedCostCny,
        net_profit_cny: netProfitCny,
        margin_rate: recognizedRevenueCny > 0 ? roundNumber(netProfitCny / recognizedRevenueCny, 4) : null,
        cost_coverage_rate: bucket.inventory_item_count > 0
            ? roundNumber(bucket.costed_item_count / bucket.inventory_item_count, 4)
            : 0,
        bonus_points_spent: roundNumber(bucket.bonus_points_spent, 2),
        untracked_revenue_points: roundNumber(bucket.untracked_revenue_points, 2),
        risk_tone: riskTone,
        risk_label: riskLabel,
        sample_orders: bucket.sample_orders
    };
}

function buildShopProfitDimensionBreakdown(shopProfitRows = []) {
    const productBuckets = new Map();
    const skuBuckets = new Map();
    const sourceBatchBuckets = new Map();
    const sourceBuckets = new Map();

    function getBucket(map, type, key, label) {
        const normalizedKey = normalizeShopProfitDimensionKey(key, 'unknown');
        if (!map.has(normalizedKey)) {
            map.set(normalizedKey, createShopProfitDimensionAccumulator(type, normalizedKey, label));
        }
        return map.get(normalizedKey);
    }

    (Array.isArray(shopProfitRows) ? shopProfitRows : []).forEach((row) => {
        if (!row?.attribution) return;
        const rowDimensions = buildShopProfitRowDimensionContributions(row);
        rowDimensions.products.forEach((contribution) => {
            const bucket = getBucket(productBuckets, 'product', contribution.key, contribution.label);
            applyShopProfitDimensionContribution(bucket, row, contribution);
        });
        rowDimensions.skus.forEach((contribution) => {
            const bucket = getBucket(skuBuckets, 'sku', contribution.key, contribution.label);
            applyShopProfitDimensionContribution(bucket, row, contribution);
        });
        rowDimensions.source_batches.forEach((contribution) => {
            const bucket = getBucket(sourceBatchBuckets, 'source_batch', contribution.key, contribution.label);
            applyShopProfitDimensionContribution(bucket, row, contribution);
        });
        rowDimensions.sources.forEach((contribution) => {
            const bucket = getBucket(sourceBuckets, 'source', contribution.key, contribution.label);
            applyShopProfitDimensionContribution(bucket, row, contribution);
            bucket.source_id = contribution.source_id || null;
            bucket.source_name = contribution.source_name || contribution.label || '未归因货源';
            bucket.source_platform = contribution.source_platform || null;
            bucket.source_risk_tier = contribution.source_risk_tier || null;
            bucket.source_quality_grade = contribution.source_quality_grade || null;
        });
    });

    const sorter = (left, right) => (
        Number(right.negative_profit_order_count || 0) - Number(left.negative_profit_order_count || 0)
        || Number(right.missing_cost_order_count || 0) - Number(left.missing_cost_order_count || 0)
        || Number(right.no_inventory_order_count || 0) - Number(left.no_inventory_order_count || 0)
        || Number(right.order_count || 0) - Number(left.order_count || 0)
        || Number(right.recognized_revenue_cny || 0) - Number(left.recognized_revenue_cny || 0)
        || Number(left.net_profit_cny || 0) - Number(right.net_profit_cny || 0)
    );

    return {
        products: [...productBuckets.values()]
            .map(serializeShopProfitDimensionBucket)
            .sort(sorter)
            .slice(0, 8),
        skus: [...skuBuckets.values()]
            .map(serializeShopProfitDimensionBucket)
            .sort(sorter)
            .slice(0, 8),
        source_batches: [...sourceBatchBuckets.values()]
            .map(serializeShopProfitDimensionBucket)
            .sort(sorter)
            .slice(0, 8),
        sources: [...sourceBuckets.values()]
            .map((bucket) => ({
                ...serializeShopProfitDimensionBucket(bucket),
                source_id: bucket.source_id || null,
                source_name: bucket.source_name || bucket.label,
                source_platform: bucket.source_platform || null,
                source_risk_tier: bucket.source_risk_tier || null,
                source_quality_grade: bucket.source_quality_grade || null,
                procurement_suggestion: bucket.negative_profit_order_count > 0
                    ? '暂停复采并核对售价、质量和成本'
                    : (bucket.missing_cost_order_count > 0 || bucket.no_inventory_order_count > 0
                        ? '补齐成本和订单关联后再评估复采'
                        : (bucket.order_count >= 3 && bucket.net_profit_cny > 0 ? '可继续观察复采' : '继续观察'))
            }))
            .sort(sorter)
            .slice(0, 8)
    };
}

function createShopSourceProcurementRecommendation(source = {}) {
    const negativeProfitOrderCount = normalizeNumber(source.negative_profit_order_count, 0);
    const missingCostOrderCount = normalizeNumber(source.missing_cost_order_count, 0);
    const noInventoryOrderCount = normalizeNumber(source.no_inventory_order_count, 0);
    const orderCount = normalizeNumber(source.order_count, 0);
    const netProfitCny = normalizeNumber(source.net_profit_cny, 0);
    const marginRate = source.margin_rate === null || source.margin_rate === undefined
        ? null
        : normalizeNumber(source.margin_rate, 0);
    const costCoverageRate = normalizeNumber(source.cost_coverage_rate, 0);
    const refundedOrderCount = normalizeNumber(source.refunded_order_count, 0);
    const refundRate = orderCount > 0 ? refundedOrderCount / orderCount : 0;
    let action_type = 'observe';
    let severity = 'review';
    let priority = 20;
    let action_label = '继续观察表现，等待更多订单样本';
    let reason_label = '样本较少';

    if (negativeProfitOrderCount > 0 || (orderCount > 0 && netProfitCny < 0)) {
        action_type = 'pause_reorder';
        severity = 'critical';
        priority = 100;
        action_label = '暂停复采，核对售价、采购成本、质量和售后记录';
        reason_label = negativeProfitOrderCount > 0 ? '存在负利润订单' : '累计净利润为负';
    } else if (missingCostOrderCount > 0 || noInventoryOrderCount > 0 || costCoverageRate < 1) {
        action_type = 'complete_cost';
        severity = 'warning';
        priority = 80;
        action_label = '补齐采购成本和订单库存关联后再评估复采';
        reason_label = noInventoryOrderCount > 0 ? '存在未关联库存订单' : '成本覆盖未完整';
    } else if (orderCount >= 3 && netProfitCny > 0 && (marginRate === null || marginRate >= 0.15) && refundRate <= 0.2) {
        action_type = 'reorder_candidate';
        severity = 'ready';
        priority = 45;
        action_label = '可作为优先复采候选，继续监控退款和售后表现';
        reason_label = '净利润和成本覆盖表现稳定';
    }

    return {
        source_id: source.source_id || null,
        source_name: source.source_name || source.label || '未归因货源',
        source_platform: source.source_platform || null,
        source_risk_tier: source.source_risk_tier || null,
        source_quality_grade: source.source_quality_grade || null,
        action_type,
        severity,
        priority,
        action_label,
        reason_label,
        order_count: roundNumber(orderCount, 0),
        refunded_order_count: roundNumber(refundedOrderCount, 0),
        negative_profit_order_count: roundNumber(negativeProfitOrderCount, 0),
        missing_cost_order_count: roundNumber(missingCostOrderCount, 0),
        no_inventory_order_count: roundNumber(noInventoryOrderCount, 0),
        inventory_item_count: roundNumber(source.inventory_item_count, 0),
        missing_cost_item_count: roundNumber(source.missing_cost_item_count, 0),
        recognized_revenue_cny: roundNumber(source.recognized_revenue_cny, 4),
        recognized_cost_cny: roundNumber(source.recognized_cost_cny, 4),
        net_profit_cny: roundNumber(netProfitCny, 4),
        margin_rate: marginRate === null ? null : roundNumber(marginRate, 4),
        cost_coverage_rate: roundNumber(costCoverageRate, 4),
        refund_rate: roundNumber(refundRate, 4),
        sample_orders: Array.isArray(source.sample_orders) ? source.sample_orders.slice(0, 3) : []
    };
}

function buildShopSourceProcurementRecommendations(dimensionBreakdown = {}) {
    const summary = createEmptyShopSourceProcurementRecommendations();
    const sources = Array.isArray(dimensionBreakdown?.sources) ? dimensionBreakdown.sources.filter(Boolean) : [];
    const items = sources
        .map(createShopSourceProcurementRecommendation)
        .sort((left, right) => (
            Number(right.priority || 0) - Number(left.priority || 0)
            || Number(right.order_count || 0) - Number(left.order_count || 0)
            || Math.abs(Number(right.net_profit_cny || 0)) - Math.abs(Number(left.net_profit_cny || 0))
            || String(left.source_name || '').localeCompare(String(right.source_name || ''), 'zh-CN')
        ));

    summary.items = items.slice(0, 10);
    summary.source_count = sources.length;
    summary.pause_count = items.filter((item) => item.action_type === 'pause_reorder').length;
    summary.complete_cost_count = items.filter((item) => item.action_type === 'complete_cost').length;
    summary.reorder_count = items.filter((item) => item.action_type === 'reorder_candidate').length;
    summary.observe_count = items.filter((item) => item.action_type === 'observe').length;
    summary.action_required_count = summary.pause_count + summary.complete_cost_count;
    summary.status = summary.pause_count > 0
        ? 'critical'
        : (summary.complete_cost_count > 0 ? 'warning' : 'ready');

    return summary;
}

function buildShopProfitAdjustmentSummary(shopProfitRows = []) {
    const summary = createEmptyShopProfitAdjustmentSummary();
    const buckets = new Map();
    const affectedOrderIds = new Set();
    const reviewOrderIds = new Set();

    (Array.isArray(shopProfitRows) ? shopProfitRows : []).forEach((row) => {
        const attribution = row?.attribution || {};
        const orderId = String(row?.order?.id || '').trim() || getShopProfitIssueOrderLabel(row?.order || {});
        const adjustments = attribution?.profit_adjustments || {};

        summary.coupon_discount_cny += normalizeNumber(adjustments.coupon_discount_cny, 0);
        summary.bonus_points_excluded_cny += normalizeNumber(adjustments.bonus_points_excluded_cny, 0);
        summary.untracked_points_estimated_cny += normalizeNumber(adjustments.untracked_points_estimated_cny, 0);
        summary.refunded_revenue_reversal_cny += normalizeNumber(adjustments.refunded_revenue_reversal_cny, 0);

        (Array.isArray(adjustments.items) ? adjustments.items : []).forEach((item) => {
            const type = String(item?.type || '').trim().toLowerCase();
            if (!type) return;
            if (!buckets.has(type)) {
                buckets.set(type, {
                    type,
                    title: String(item?.title || '').trim() || type,
                    status: String(item?.status || '').trim().toLowerCase() || 'tracked',
                    tone: String(item?.tone || '').trim().toLowerCase() || 'info',
                    treatment: String(item?.treatment || '').trim() || null,
                    description: String(item?.description || '').trim() || null,
                    amount_cny: 0,
                    points: 0,
                    order_count: 0,
                    affects_net_profit: Boolean(item?.affects_net_profit),
                    _orderIds: new Set()
                });
            }

            const bucket = buckets.get(type);
            bucket.amount_cny += normalizeNumber(item.amount_cny, 0);
            bucket.points += normalizeNumber(item.points, 0);
            bucket.affects_net_profit = bucket.affects_net_profit || Boolean(item?.affects_net_profit);
            if (orderId && !bucket._orderIds.has(orderId)) {
                bucket._orderIds.add(orderId);
                affectedOrderIds.add(orderId);
                bucket.order_count += 1;
            }
            if (String(item?.status || '').trim().toLowerCase() === 'review_required') {
                bucket.status = 'review_required';
                bucket.tone = 'warning';
                if (orderId) {
                    reviewOrderIds.add(orderId);
                }
            }
        });
    });

    const order = ['coupon_discount', 'bonus_points_excluded', 'untracked_points_estimated', 'refund_reversal'];
    summary.items = [...buckets.values()]
        .map((bucket) => {
            const { _orderIds, ...item } = bucket;
            return {
                ...item,
                amount_cny: roundNumber(item.amount_cny, 4),
                points: roundNumber(item.points, 2),
                order_count: roundNumber(item.order_count, 0)
            };
        })
        .sort((left, right) => {
            const leftIndex = order.indexOf(left.type);
            const rightIndex = order.indexOf(right.type);
            return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex)
                || Number(right.amount_cny || 0) - Number(left.amount_cny || 0);
        });

    summary.item_count = summary.items.length;
    summary.affected_order_fingerprint = buildShopProfitOrderFingerprint(affectedOrderIds);
    summary.review_order_fingerprint = buildShopProfitOrderFingerprint(reviewOrderIds);
    summary.total_amount_cny = roundNumber(summary.items.reduce((sum, item) => sum + normalizeNumber(item.amount_cny, 0), 0), 4);
    summary.total_points = roundNumber(summary.items.reduce((sum, item) => sum + normalizeNumber(item.points, 0), 0), 2);
    summary.coupon_discount_cny = roundNumber(summary.coupon_discount_cny, 4);
    summary.bonus_points_excluded_cny = roundNumber(summary.bonus_points_excluded_cny, 4);
    summary.untracked_points_estimated_cny = roundNumber(summary.untracked_points_estimated_cny, 4);
    summary.refunded_revenue_reversal_cny = roundNumber(summary.refunded_revenue_reversal_cny, 4);
    summary.status = summary.items.some((item) => item.status === 'review_required')
        ? 'review'
        : (summary.items.length ? 'tracked' : 'none');

    return summary;
}

const SHOP_PROFIT_ADJUSTMENT_BREAKDOWN_META = Object.freeze({
    coupon_discount: Object.freeze({
        category: 'discount',
        label: '优惠券/折扣',
        net_profit_treatment: '已通过实付积分减少收入，不重复扣减',
        closure_status: 'tracked'
    }),
    bonus_points_excluded: Object.freeze({
        category: 'non_cash_points',
        label: '非现金积分',
        net_profit_treatment: '已从现金收入中剔除，后续可转入营销成本',
        closure_status: 'excluded'
    }),
    untracked_points_estimated: Object.freeze({
        category: 'point_source_gap',
        label: '历史未拆分积分',
        net_profit_treatment: '暂按旧口径估算，需补齐积分来源',
        closure_status: 'review'
    }),
    refund_reversal: Object.freeze({
        category: 'refund',
        label: '退款冲销',
        net_profit_treatment: '收入与成本按退款状态冲销',
        closure_status: 'tracked'
    }),
    affiliate_commission: Object.freeze({
        category: 'affiliate',
        label: '推广返佣',
        net_profit_treatment: '预留扩展项，待接入推广返佣分录',
        closure_status: 'extension'
    }),
    manual_adjustment: Object.freeze({
        category: 'manual',
        label: '人工调整',
        net_profit_treatment: '预留扩展项，待接入人工调整分录',
        closure_status: 'extension'
    })
});

function normalizeShopProfitAdjustmentClosureStatus(status = '') {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'review_required' || normalized === 'review') return 'review';
    if (normalized === 'tracked_revenue_exclusion' || normalized === 'excluded') return 'excluded';
    if (normalized === 'extension' || normalized === 'pending_extension') return 'extension';
    return 'tracked';
}

function buildShopProfitAdjustmentBreakdown(adjustments = {}) {
    const summary = createEmptyShopProfitAdjustmentBreakdown();
    const rows = (Array.isArray(adjustments?.items) ? adjustments.items : [])
        .filter(Boolean)
        .map((item) => {
            const type = String(item.type || '').trim().toLowerCase();
            const meta = SHOP_PROFIT_ADJUSTMENT_BREAKDOWN_META[type] || {};
            const closureStatus = normalizeShopProfitAdjustmentClosureStatus(meta.closure_status || item.status);
            return {
                type,
                category: meta.category || 'other',
                label: meta.label || item.title || type || '其它影响项',
                title: item.title || meta.label || type || '其它影响项',
                closure_status: closureStatus,
                action_required: closureStatus === 'review',
                net_profit_treatment: meta.net_profit_treatment || item.treatment || item.description || '已纳入利润影响项观察。',
                amount_cny: roundNumber(item.amount_cny, 4),
                points: roundNumber(item.points, 2),
                order_count: roundNumber(item.order_count, 0),
                affects_net_profit: Boolean(item.affects_net_profit),
                status: item.status || null,
                tone: closureStatus === 'review' ? 'warning' : (closureStatus === 'extension' ? 'review' : 'info')
            };
        });

    ['affiliate_commission', 'manual_adjustment'].forEach((type) => {
        if (rows.some((item) => item.type === type)) return;
        const meta = SHOP_PROFIT_ADJUSTMENT_BREAKDOWN_META[type];
        rows.push({
            type,
            category: meta.category,
            label: meta.label,
            title: meta.label,
            closure_status: meta.closure_status,
            action_required: false,
            net_profit_treatment: meta.net_profit_treatment,
            amount_cny: 0,
            points: 0,
            order_count: 0,
            affects_net_profit: false,
            status: 'pending_extension',
            tone: 'review'
        });
    });

    summary.items = rows;
    summary.item_count = rows.length;
    summary.action_required_count = rows.filter((item) => item.action_required).length;
    summary.tracked_count = rows.filter((item) => item.closure_status === 'tracked').length;
    summary.excluded_count = rows.filter((item) => item.closure_status === 'excluded').length;
    summary.review_count = rows.filter((item) => item.closure_status === 'review').length;
    summary.extension_count = rows.filter((item) => item.closure_status === 'extension').length;
    summary.total_amount_cny = roundNumber(rows.reduce((sum, item) => sum + normalizeNumber(item.amount_cny, 0), 0), 4);
    summary.total_points = roundNumber(rows.reduce((sum, item) => sum + normalizeNumber(item.points, 0), 0), 2);
    summary.status = summary.review_count > 0 ? 'warning' : 'ready';

    return summary;
}

function buildShopProfitReadinessSummary(summary = {}) {
    const readiness = createEmptyShopProfitReadinessSummary();
    const items = [];
    const closure = normalizeJsonObject(summary.profit_reconciliation_closure);
    const alerts = normalizeJsonObject(summary.shop_profit_audit_alerts);
    const risks = normalizeJsonObject(summary.order_risk_list);
    const procurement = normalizeJsonObject(summary.source_procurement_recommendations);
    const adjustmentBreakdown = normalizeJsonObject(summary.profit_adjustment_breakdown);
    const ledgerPreview = normalizeJsonObject(summary.profit_ledger_preview);
    const costCoverageRate = normalizeNumber(summary.cost_coverage_rate, 0);
    const pointCoverage = normalizeJsonObject(summary.point_source_coverage);

    function addItem(input = {}) {
        const severity = String(input.severity || 'ready').trim().toLowerCase();
        const actionRequired = ['critical', 'warning'].includes(severity) || Boolean(input.action_required);
        items.push({
            key: String(input.key || '').trim().toLowerCase() || `item_${items.length + 1}`,
            label: String(input.label || '').trim() || '审计项',
            severity,
            status: severity,
            action_required: actionRequired,
            value_label: String(input.value_label || '').trim() || null,
            action_label: String(input.action_label || '').trim() || null,
            description: String(input.description || '').trim() || null
        });
    }

    if (normalizeNumber(alerts.critical_count, 0) > 0) {
        addItem({
            key: 'critical_alerts',
            label: '高优先级审计告警',
            severity: 'critical',
            value_label: `${roundNumber(alerts.critical_count, 0).toLocaleString('zh-CN')} 个`,
            action_label: '先处理红色审计告警',
            description: '存在负利润等高风险告警，暂不建议进入结算口径。'
        });
    }
    if (normalizeNumber(closure.action_required_count, 0) > 0) {
        addItem({
            key: 'closure_actions',
            label: '对账闭环待处理',
            severity: normalizeNumber(closure.critical_count, 0) > 0 ? 'critical' : 'warning',
            value_label: `${roundNumber(closure.action_required_count, 0).toLocaleString('zh-CN')} 项`,
            action_label: '按对账闭环链路逐项收口',
            description: '支付、积分、订单、采购、分录或审计链路仍有待处理项。'
        });
    }
    if (normalizeNumber(risks.critical_count, 0) > 0 || normalizeNumber(risks.warning_count, 0) > 0) {
        addItem({
            key: 'risk_orders',
            label: '风险订单',
            severity: normalizeNumber(risks.critical_count, 0) > 0 ? 'critical' : 'warning',
            value_label: `${roundNumber(risks.order_count, 0).toLocaleString('zh-CN')} 笔`,
            action_label: '先处理风险订单清单',
            description: '风险订单会影响净利润可信度。'
        });
    }
    if (normalizeNumber(procurement.action_required_count, 0) > 0) {
        addItem({
            key: 'procurement_actions',
            label: '采购建议待处理',
            severity: normalizeNumber(procurement.pause_count, 0) > 0 ? 'critical' : 'warning',
            value_label: `${roundNumber(procurement.action_required_count, 0).toLocaleString('zh-CN')} 个货源`,
            action_label: '处理暂停复采和补齐成本项',
            description: '货源维度仍有影响复采或成本归因的待处理项。'
        });
    }
    if (normalizeNumber(adjustmentBreakdown.review_count, 0) > 0) {
        addItem({
            key: 'adjustment_review',
            label: '利润影响项需复核',
            severity: 'warning',
            value_label: `${roundNumber(adjustmentBreakdown.review_count, 0).toLocaleString('zh-CN')} 项`,
            action_label: '复核历史未拆分积分或其它影响项',
            description: '利润影响构成里仍有待复核口径。'
        });
    }
    if (String(ledgerPreview.status || '').trim().toLowerCase() === 'incomplete') {
        addItem({
            key: 'ledger_incomplete',
            label: '利润分录未完整',
            severity: 'warning',
            value_label: `${roundNumber(ledgerPreview.incomplete_entry_count, 0).toLocaleString('zh-CN')} 条`,
            action_label: '补齐利润分录缺口',
            description: '利润分录存在缺成本或未完整结算项。'
        });
    }
    if (costCoverageRate < 0.9999 && normalizeNumber(summary.inventory_item_count, 0) > 0) {
        addItem({
            key: 'cost_coverage',
            label: '采购成本覆盖不足',
            severity: 'warning',
            value_label: `${roundNumber(costCoverageRate * 100, 2).toLocaleString('zh-CN')}%`,
            action_label: '补齐库存采购成本',
            description: '成本覆盖不足会高估净利润。'
        });
    }
    if (normalizeNumber(pointCoverage.action_required_order_count, 0) > 0) {
        addItem({
            key: 'point_source_gap',
            label: '积分来源待补齐',
            severity: 'warning',
            value_label: `${roundNumber(pointCoverage.action_required_order_count, 0).toLocaleString('zh-CN')} 笔`,
            action_label: '补齐积分来源批次',
            description: '积分来源缺口会影响现金/非现金收入归因。'
        });
    }

    readiness.items = items.slice(0, 8);
    readiness.blocker_count = items.filter((item) => item.severity === 'critical').length;
    readiness.warning_count = items.filter((item) => item.severity === 'warning').length;
    readiness.review_count = items.filter((item) => item.severity === 'review').length;
    readiness.action_required_count = items.filter((item) => item.action_required).length;
    readiness.score = Math.max(0, roundNumber(100 - (readiness.blocker_count * 30) - (readiness.warning_count * 12) - (readiness.review_count * 5), 0));
    readiness.status = readiness.blocker_count > 0
        ? 'critical'
        : (readiness.warning_count > 0 ? 'warning' : 'ready');
    readiness.label = readiness.status === 'critical'
        ? '暂不可结算'
        : (readiness.status === 'warning' ? '待复核后结算' : '可结算');
    readiness.settlement_ready = readiness.status === 'ready';

    if (!readiness.items.length) {
        readiness.items = [{
            key: 'ready',
            label: '利润对账已闭环',
            severity: 'ready',
            status: 'ready',
            action_required: false,
            value_label: '0 项待处理',
            action_label: null,
            description: '当前支付、积分、订单、采购、分录和告警链路均可进入结算口径。'
        }];
    }

    return readiness;
}

function buildShopProfitLedgerPreview(shopProfitRows = []) {
    const preview = createEmptyShopProfitLedgerPreview();
    const typeBuckets = new Map();
    const orderIds = new Set();
    const sampleLimit = 8;

    (Array.isArray(shopProfitRows) ? shopProfitRows : []).forEach((row) => {
        const orderId = String(row?.order?.id || '').trim() || getShopProfitIssueOrderLabel(row?.order || {});
        const entries = Array.isArray(row?.attribution?.profit_ledger_entries)
            ? row.attribution.profit_ledger_entries.filter(Boolean)
            : [];

        if (entries.length && orderId) {
            orderIds.add(orderId);
        }

        entries.forEach((entry) => {
            const type = String(entry?.entry_type || '').trim().toLowerCase();
            if (!type) return;

            const amountCny = normalizeNumber(entry.amount_cny, 0);
            const pointsAmount = normalizeNumber(entry.points_amount, 0);
            const status = String(entry.status || '').trim().toLowerCase();
            const confidence = String(entry.confidence || '').trim().toLowerCase();
            const group = String(entry.group || '').trim().toLowerCase();

            preview.entry_count += 1;
            preview.net_amount_cny += amountCny;
            if (group === 'revenue') {
                preview.revenue_amount_cny += Math.max(0, amountCny);
            } else if (group === 'cost') {
                preview.cost_amount_cny += Math.abs(Math.min(0, amountCny));
            } else if (group === 'reversal') {
                preview.reversal_amount_cny += Math.abs(amountCny);
            } else {
                preview.informational_points += Math.max(0, pointsAmount);
            }
            if (['incomplete', 'missing', 'review_required'].includes(status) || confidence === 'missing') {
                preview.incomplete_entry_count += 1;
            }
            if (confidence === 'estimated' || status.includes('estimated')) {
                preview.estimated_entry_count += 1;
            }

            if (!typeBuckets.has(type)) {
                typeBuckets.set(type, {
                    type,
                    title: String(entry.title || '').trim() || type,
                    group: group || 'adjustment',
                    status: status || 'settled',
                    tone: String(entry.tone || '').trim().toLowerCase() || 'info',
                    amount_cny: 0,
                    points_amount: 0,
                    entry_count: 0,
                    order_count: 0,
                    _orderIds: new Set()
                });
            }

            const bucket = typeBuckets.get(type);
            bucket.amount_cny += amountCny;
            bucket.points_amount += pointsAmount;
            bucket.entry_count += 1;
            if (orderId && !bucket._orderIds.has(orderId)) {
                bucket._orderIds.add(orderId);
                bucket.order_count += 1;
            }
            if (['incomplete', 'missing', 'review_required'].includes(status) || confidence === 'missing') {
                bucket.status = 'incomplete';
                bucket.tone = 'warning';
            } else if (confidence === 'estimated' || status.includes('estimated')) {
                bucket.status = 'estimated';
                bucket.tone = bucket.tone === 'warning' ? bucket.tone : 'warning';
            }

            if (preview.sample_entries.length < sampleLimit && (amountCny !== 0 || ['incomplete', 'estimated'].includes(bucket.status))) {
                preview.sample_entries.push({
                    order_id: String(row?.order?.id || '').trim() || null,
                    order_no: getShopProfitIssueOrderLabel(row?.order || {}),
                    entry_type: type,
                    title: bucket.title,
                    amount_cny: roundNumber(amountCny, 4),
                    status: status || 'settled',
                    confidence: confidence || 'exact',
                    product_name: String(row?.order?.snapshot_product_name || row?.order?.product_name || '').trim() || null,
                    created_at: row?.order?.created_at || null
                });
            }
        });
    });

    const typeOrder = [
        'revenue_points_paid',
        'revenue_points_untracked',
        'inventory_cost',
        'inventory_cost_missing',
        'refund_reversal',
        'inventory_cost_reversal',
        'revenue_points_bonus',
        'coupon_cost'
    ];
    preview.entries_by_type = [...typeBuckets.values()]
        .map((bucket) => {
            const { _orderIds, ...item } = bucket;
            return {
                ...item,
                amount_cny: roundNumber(item.amount_cny, 4),
                points_amount: roundNumber(item.points_amount, 2),
                entry_count: roundNumber(item.entry_count, 0),
                order_count: roundNumber(item.order_count, 0)
            };
        })
        .sort((left, right) => {
            const leftIndex = typeOrder.indexOf(left.type);
            const rightIndex = typeOrder.indexOf(right.type);
            return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex)
                || Math.abs(Number(right.amount_cny || 0)) - Math.abs(Number(left.amount_cny || 0));
        });

    preview.order_count = orderIds.size;
    preview.affected_order_fingerprint = buildShopProfitOrderFingerprint(orderIds);
    preview.net_amount_cny = roundNumber(preview.net_amount_cny, 4);
    preview.revenue_amount_cny = roundNumber(preview.revenue_amount_cny, 4);
    preview.cost_amount_cny = roundNumber(preview.cost_amount_cny, 4);
    preview.reversal_amount_cny = roundNumber(preview.reversal_amount_cny, 4);
    preview.informational_points = roundNumber(preview.informational_points, 2);
    preview.status = preview.incomplete_entry_count > 0
        ? 'incomplete'
        : (preview.estimated_entry_count > 0 ? 'estimated' : (preview.entry_count ? 'balanced' : 'none'));

    return preview;
}

function normalizePersistedShopProfitLedgerEntry(row = {}) {
    const snapshot = normalizeJsonObject(row.snapshot);
    return {
        entry_type: String(row.entry_type || '').trim().toLowerCase(),
        title: String(snapshot.title || row.entry_type || '').trim(),
        amount_cny: roundNumber(row.cash_value_cny ?? row.amount, 4),
        points_amount: row.points_amount === null || row.points_amount === undefined
            ? null
            : roundNumber(row.points_amount, 2),
        status: String(row.status || '').trim().toLowerCase() || 'estimated',
        confidence: String(row.confidence || '').trim().toLowerCase() || 'exact',
        group: String(row.entry_group || '').trim().toLowerCase() || 'adjustment',
        tone: String(snapshot.tone || '').trim().toLowerCase() || (row.status === 'incomplete' ? 'warning' : 'info'),
        order_id: String(row.order_id || '').trim(),
        product_name: String(snapshot.product_name || '').trim() || null,
        created_at: row.occurred_at || null
    };
}

function buildPersistedShopProfitLedgerPreview(ledgerRows = []) {
    const rows = (Array.isArray(ledgerRows) ? ledgerRows : []).map(normalizePersistedShopProfitLedgerEntry).filter((row) => row.entry_type);
    if (!rows.length) {
        return null;
    }

    return buildShopProfitLedgerPreview(rows.map((entry) => ({
        order: {
            id: entry.order_id,
            snapshot_product_name: entry.product_name,
            created_at: entry.created_at
        },
        attribution: {
            profit_ledger_entries: [entry]
        }
    })));
}

function buildShopProfitPointSourceCoverage(shopProfitRows = []) {
    const summary = createEmptyShopProfitPointSourceCoverage();
    const typeBuckets = new Map();
    const affectedOrderIds = new Set();
    const actionRequiredOrderIds = new Set();

    function ensureTypeBucket(sourceType, sourceLabel = '') {
        const normalizedType = String(sourceType || '').trim().toLowerCase() || 'unknown';
        if (!typeBuckets.has(normalizedType)) {
            typeBuckets.set(normalizedType, {
                source_type: normalizedType,
                source_label: String(sourceLabel || '').trim() || normalizedType,
                points: 0,
                cash_value_cny: 0,
                order_count: 0,
                _orderIds: new Set()
            });
        }
        return typeBuckets.get(normalizedType);
    }

    (Array.isArray(shopProfitRows) ? shopProfitRows : []).forEach((row) => {
        const attribution = row?.attribution || {};
        const traceability = normalizeJsonObject(attribution.point_source_traceability);
        const expectedPoints = roundNumber(Math.max(0, normalizeNumber(
            traceability.expected_points,
            attribution.revenue_points
        )), 2);

        if (expectedPoints <= 0) {
            return;
        }

        const orderId = String(row?.order?.id || '').trim() || getShopProfitIssueOrderLabel(row?.order || {});
        const status = String(traceability.status || '').trim().toLowerCase();
        const sourceLotPoints = roundNumber(Math.max(0, normalizeNumber(traceability.source_lot_points, 0)), 2);
        const cashBackedPoints = roundNumber(Math.max(0, normalizeNumber(traceability.cash_backed_points, 0)), 2);
        const nonCashPoints = roundNumber(Math.max(0, normalizeNumber(traceability.non_cash_points, 0)), 2);
        const unknownPoints = roundNumber(Math.max(0, normalizeNumber(traceability.unknown_points, 0)), 2);
        const untrackedPoints = roundNumber(Math.max(0, normalizeNumber(traceability.untracked_points, 0)), 2);
        const lotSummary = normalizeJsonObject(attribution.point_lot_consumption_summary);
        const lotItems = Array.isArray(lotSummary.items) ? lotSummary.items.filter(Boolean) : [];

        summary.order_count += 1;
        if (orderId) {
            affectedOrderIds.add(orderId);
        }
        summary.expected_points += expectedPoints;
        summary.source_lot_points += sourceLotPoints;
        summary.cash_backed_points += cashBackedPoints;
        summary.non_cash_points += nonCashPoints;
        summary.unknown_points += unknownPoints;
        summary.untracked_points += untrackedPoints;

        if (status === 'source_lot_exact') {
            summary.source_lot_order_count += 1;
            summary.exact_order_count += 1;
        } else if (status === 'partial_lot_gap') {
            summary.source_lot_order_count += 1;
            summary.partial_order_count += 1;
        } else if (status === 'balance_split_only' || status === 'balance_split_gap') {
            summary.balance_split_order_count += 1;
            if (status === 'balance_split_gap') {
                summary.partial_order_count += 1;
            }
        } else if (status === 'legacy_untracked') {
            summary.legacy_untracked_order_count += 1;
        }

        if (traceability.action_required) {
            summary.action_required_order_count += 1;
            if (orderId) {
                actionRequiredOrderIds.add(orderId);
            }
        }

        if (lotItems.length) {
            lotItems.forEach((item) => {
                const bucket = ensureTypeBucket(item.source_type, item.source_label);
                const points = roundNumber(Math.max(0, normalizeNumber(item.points_amount, 0)), 2);
                bucket.points += points;
                bucket.cash_value_cny += normalizeNumber(item.cash_value_cny, 0);
                if (orderId && !bucket._orderIds.has(orderId)) {
                    bucket._orderIds.add(orderId);
                    bucket.order_count += 1;
                }
            });
            return;
        }

        (Array.isArray(traceability.source_types) ? traceability.source_types : [])
            .filter(Boolean)
            .forEach((sourceType) => {
                const bucket = ensureTypeBucket(sourceType);
                if (orderId && !bucket._orderIds.has(orderId)) {
                    bucket._orderIds.add(orderId);
                    bucket.order_count += 1;
                }
            });
    });

    summary.expected_points = roundNumber(summary.expected_points, 2);
    summary.affected_order_fingerprint = buildShopProfitOrderFingerprint(affectedOrderIds);
    summary.action_required_order_fingerprint = buildShopProfitOrderFingerprint(actionRequiredOrderIds);
    summary.source_lot_points = roundNumber(summary.source_lot_points, 2);
    summary.cash_backed_points = roundNumber(summary.cash_backed_points, 2);
    summary.non_cash_points = roundNumber(summary.non_cash_points, 2);
    summary.unknown_points = roundNumber(summary.unknown_points, 2);
    summary.untracked_points = roundNumber(summary.untracked_points, 2);
    summary.coverage_rate = summary.expected_points > 0
        ? roundNumber(summary.source_lot_points / summary.expected_points, 4)
        : 0;
    summary.exact_order_rate = summary.order_count > 0
        ? roundNumber(summary.exact_order_count / summary.order_count, 4)
        : 0;
    summary.source_types = [...typeBuckets.values()]
        .map((bucket) => {
            const { _orderIds, ...item } = bucket;
            return {
                ...item,
                points: roundNumber(item.points, 2),
                cash_value_cny: roundNumber(item.cash_value_cny, 4),
                order_count: roundNumber(item.order_count, 0)
            };
        })
        .sort((left, right) => Number(right.points || 0) - Number(left.points || 0)
            || Number(right.order_count || 0) - Number(left.order_count || 0)
            || String(left.source_type || '').localeCompare(String(right.source_type || '')));
    summary.source_type_count = summary.source_types.length;

    const migrationBucket = summary.source_types.find((item) => item.source_type === 'migration') || null;
    if (migrationBucket) {
        summary.migration_points = roundNumber(migrationBucket.points, 2);
        summary.migration_order_count = roundNumber(migrationBucket.order_count, 0);
    }

    if (summary.order_count <= 0) {
        return summary;
    }

    if (summary.action_required_order_count > 0 || summary.untracked_points > 0 || summary.unknown_points > 0) {
        summary.status = 'warning';
        summary.tone = 'warning';
        summary.label = '需要复核';
    } else if (summary.exact_order_count === summary.order_count && summary.source_lot_order_count === summary.order_count) {
        summary.status = 'ready';
        summary.tone = 'ready';
        summary.label = '批次完整';
    } else if (summary.source_lot_order_count > 0) {
        summary.status = 'improving';
        summary.tone = 'info';
        summary.label = '部分批次化';
    } else if (summary.balance_split_order_count > 0) {
        summary.status = 'balance_split';
        summary.tone = 'info';
        summary.label = '仅余额拆分';
    } else {
        summary.status = 'warning';
        summary.tone = 'warning';
        summary.label = '历史未拆分';
    }

    return summary;
}

const SHOP_PROFIT_AUDIT_ALERT_META = Object.freeze({
    negative_profit: Object.freeze({
        priority: 100,
        action_label: '核对售价、采购成本、优惠和补发记录'
    }),
    missing_cost: Object.freeze({
        priority: 90,
        action_label: '补齐库存采购成本或采购批次'
    }),
    no_inventory: Object.freeze({
        priority: 85,
        action_label: '补齐订单与库存的精确关联'
    }),
    point_source_coverage: Object.freeze({
        priority: 80,
        action_label: '回填历史余额批次或复核来源类型'
    }),
    untracked_points: Object.freeze({
        priority: 75,
        action_label: '补齐积分来源批次消耗明细'
    }),
    profit_ledger_incomplete: Object.freeze({
        priority: 70,
        action_label: '补齐分录缺口后再确认净利润'
    }),
    profit_adjustments_review: Object.freeze({
        priority: 60,
        action_label: '复核优惠、赠送积分和退款调整项'
    }),
    bonus_points: Object.freeze({
        priority: 30,
        action_label: '确认营销成本归属口径'
    }),
    refunded: Object.freeze({
        priority: 20,
        action_label: '核对退款流水、库存状态和成本冲销'
    })
});

function normalizeShopProfitAuditSeverity(tone = '') {
    const normalized = String(tone || '').trim().toLowerCase();
    if (normalized === 'critical') return 'critical';
    if (normalized === 'warning' || normalized === 'review') return 'warning';
    return 'info';
}

function buildShopProfitAuditAlerts(summary = {}) {
    const alerts = createEmptyShopProfitAuditAlerts();
    const items = [];
    const coverage = normalizeJsonObject(summary.point_source_coverage);
    const ledgerPreview = normalizeJsonObject(summary.profit_ledger_preview);
    const adjustments = normalizeJsonObject(summary.profit_adjustments);

    function addAlert(input = {}) {
        const type = String(input.type || '').trim().toLowerCase();
        if (!type) return;
        const meta = SHOP_PROFIT_AUDIT_ALERT_META[type] || {};
        const severity = normalizeShopProfitAuditSeverity(input.severity || input.tone);
        const actionRequired = severity !== 'info' || Boolean(input.action_required);
        const orderCount = roundNumber(input.order_count ?? input.affected_order_count ?? 0, 0);
        const amountCny = roundNumber(input.amount_cny, 4);
        const points = roundNumber(input.points, 2);

        items.push({
            id: `shop_profit:${type}`,
            source: 'shop_profit_audit',
            type,
            severity,
            tone: severity,
            priority: normalizeNumber(input.priority, meta.priority || 10),
            title: String(input.title || type).trim(),
            description: String(input.description || '').trim() || null,
            action_label: String(input.action_label || meta.action_label || '').trim() || null,
            action_required: actionRequired,
            order_count: orderCount,
            affected_order_count: orderCount,
            affected_order_fingerprint: String(input.affected_order_fingerprint || '').trim() || null,
            amount_cny: amountCny,
            points,
            metric_label: String(input.metric_label || '').trim() || null,
            sample_orders: Array.isArray(input.sample_orders) ? input.sample_orders.filter(Boolean).slice(0, 4) : [],
            resolution_plan: buildShopProfitResolutionPlan({
                type,
                severity,
                coverage: type === 'no_inventory' ? 'no_inventory' : '',
                missingCostItemCount: type === 'missing_cost' ? orderCount || 1 : 0,
                traceability: {
                    status: ['point_source_coverage', 'untracked_points'].includes(type) ? 'legacy_untracked' : '',
                    action_required: ['point_source_coverage', 'untracked_points'].includes(type),
                    untracked_points: points
                },
                untrackedPoints: points,
                adjustments: type === 'profit_adjustments_review' ? { status: 'review_required' } : {},
                netProfitCny: type === 'negative_profit' ? -Math.abs(amountCny || 1) : 0
            }),
            case_category_key: 'shop_profit_audit',
            case_target_id: type,
            alert_type: `shop_profit_${type}`
        });
    }

    (Array.isArray(summary.reconciliation_issues) ? summary.reconciliation_issues : [])
        .filter(Boolean)
        .forEach((issue) => {
            addAlert({
                type: issue.type,
                tone: issue.tone,
                title: issue.title,
                description: issue.description,
                order_count: issue.order_count,
                amount_cny: issue.amount_cny,
                points: issue.points,
                sample_orders: issue.sample_orders,
                affected_order_fingerprint: issue.affected_order_fingerprint,
                metric_label: issue.points > 0
                    ? `${roundNumber(issue.points, 2)} 积分`
                    : (issue.amount_cny > 0 ? `¥${roundNumber(issue.amount_cny, 2)}` : `${roundNumber(issue.count, 0)} 项`)
            });
        });

    if (Number(coverage.order_count || 0) > 0 && Number(coverage.coverage_rate || 0) < 0.9999) {
        addAlert({
            type: 'point_source_coverage',
            severity: Number(coverage.action_required_order_count || 0) > 0 ? 'warning' : 'info',
            title: '积分批次覆盖不足',
            description: '部分商城订单尚未匹配到完整积分来源批次，现金/非现金收入归因需要继续复核。',
            order_count: coverage.action_required_order_count || coverage.order_count || 0,
            points: coverage.untracked_points || 0,
            affected_order_fingerprint: coverage.action_required_order_fingerprint || coverage.affected_order_fingerprint,
            metric_label: `覆盖率 ${roundNumber(Number(coverage.coverage_rate || 0) * 100, 2)}%`
        });
    }

    if (String(ledgerPreview.status || '').trim().toLowerCase() === 'incomplete') {
        addAlert({
            type: 'profit_ledger_incomplete',
            severity: 'warning',
            title: '利润分录待补齐',
            description: '商城利润分录存在缺成本或未完整结算项，当前净利润仍需复核。',
            order_count: ledgerPreview.order_count || 0,
            amount_cny: Math.abs(normalizeNumber(ledgerPreview.net_amount_cny, 0)),
            affected_order_fingerprint: ledgerPreview.affected_order_fingerprint,
            metric_label: `${roundNumber(ledgerPreview.incomplete_entry_count, 0)} 条缺口`
        });
    } else if (String(ledgerPreview.status || '').trim().toLowerCase() === 'estimated') {
        addAlert({
            type: 'profit_ledger_incomplete',
            severity: 'warning',
            title: '利润分录含估算',
            description: '商城利润分录仍包含估算项，建议在结算前确认来源和成本。',
            order_count: ledgerPreview.order_count || 0,
            amount_cny: Math.abs(normalizeNumber(ledgerPreview.net_amount_cny, 0)),
            affected_order_fingerprint: ledgerPreview.affected_order_fingerprint,
            metric_label: `${roundNumber(ledgerPreview.estimated_entry_count, 0)} 条估算`
        });
    }

    if (String(adjustments.status || '').trim().toLowerCase() === 'review') {
        addAlert({
            type: 'profit_adjustments_review',
            severity: 'warning',
            title: '利润调整项需复核',
            description: '优惠、赠送积分、未拆分积分或退款调整项需要进入最终净利润口径前复核。',
            order_count: Math.max(...(Array.isArray(adjustments.items) ? adjustments.items : [])
                .map((item) => normalizeNumber(item.order_count, 0)), 0),
            amount_cny: Math.abs(normalizeNumber(adjustments.total_amount_cny, 0)),
            points: adjustments.total_points || 0,
            affected_order_fingerprint: adjustments.review_order_fingerprint || adjustments.affected_order_fingerprint,
            metric_label: `${roundNumber(adjustments.item_count, 0)} 类调整`
        });
    }

    items.sort((left, right) => (
        Number(right.priority || 0) - Number(left.priority || 0)
        || ({ critical: 3, warning: 2, info: 1 }[right.severity] || 0) - ({ critical: 3, warning: 2, info: 1 }[left.severity] || 0)
        || Number(right.order_count || 0) - Number(left.order_count || 0)
    ));

    alerts.items = items.slice(0, 12);
    alerts.alert_count = alerts.items.length;
    alerts.critical_count = alerts.items.filter((item) => item.severity === 'critical').length;
    alerts.warning_count = alerts.items.filter((item) => item.severity === 'warning').length;
    alerts.info_count = alerts.items.filter((item) => item.severity === 'info').length;
    alerts.action_required_count = alerts.items.filter((item) => item.action_required).length;
    alerts.status = alerts.critical_count > 0
        ? 'critical'
        : (alerts.warning_count > 0 ? 'warning' : (alerts.info_count > 0 ? 'info' : 'ready'));

    return alerts;
}

function normalizeShopProfitClosureStatus(status = '') {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'critical') return 'critical';
    if (normalized === 'warning' || normalized === 'review' || normalized === 'estimated' || normalized === 'incomplete') return 'warning';
    return 'ready';
}

function buildShopProfitReconciliationClosure(summary = {}) {
    const closure = createEmptyShopProfitReconciliationClosure();
    const items = [];
    const costBreakdown = normalizeJsonObject(summary.cost_coverage_breakdown);
    const pointCoverage = normalizeJsonObject(summary.point_source_coverage);
    const adjustments = normalizeJsonObject(summary.profit_adjustments);
    const ledgerPreview = normalizeJsonObject(summary.profit_ledger_preview);
    const alerts = normalizeJsonObject(summary.shop_profit_audit_alerts);
    const procurementRecommendations = normalizeJsonObject(summary.source_procurement_recommendations);
    const financeContext = normalizeJsonObject(summary.finance_reconciliation_context);
    const rechargeOrderCount = normalizeNumber(financeContext.recharge_order_count, 0);
    const rechargePoints = normalizeNumber(financeContext.recharge_points, 0);
    const pointsInflow = normalizeNumber(financeContext.points_inflow, 0);
    const pointsOutflow = normalizeNumber(financeContext.points_outflow, 0);
    const shopOrderContextCount = normalizeNumber(financeContext.shop_order_count, 0);
    const refundedShopOrderCount = normalizeNumber(financeContext.refunded_shop_order_count, 0);
    const shopPointsSpent = normalizeNumber(financeContext.shop_points_spent, 0);

    function addItem(input = {}) {
        const key = String(input.key || '').trim().toLowerCase();
        if (!key) return;
        const status = normalizeShopProfitClosureStatus(input.status);
        items.push({
            key,
            category: String(input.category || 'reconciliation').trim().toLowerCase() || 'reconciliation',
            label: String(input.label || key).trim(),
            status,
            tone: status,
            value_label: String(input.value_label || '').trim() || null,
            description: String(input.description || '').trim() || null,
            action_label: String(input.action_label || '').trim() || null,
            action_required: status !== 'ready' || Boolean(input.action_required),
            order_count: roundNumber(input.order_count ?? 0, 0),
            amount_cny: roundNumber(input.amount_cny ?? 0, 4),
            points: roundNumber(input.points ?? 0, 2)
        });
    }

    const orderCount = normalizeNumber(summary.order_count, 0);
    const recognizedRevenue = normalizeNumber(summary.recognized_revenue_cny, 0);
    const paidPoints = normalizeNumber(summary.paid_points_spent, 0);
    const paymentSettlementStatus = rechargeOrderCount > 0 && rechargePoints <= 0 ? 'warning' : 'ready';
    addItem({
        key: 'payment_settlement',
        category: 'payment',
        label: '支付到账闭环',
        status: paymentSettlementStatus,
        value_label: formatShopProfitAuditAmount(financeContext.recharge_amount || 0),
        description: `支付成功 ${roundNumber(rechargeOrderCount, 0).toLocaleString('zh-CN')} 笔，充值积分 ${roundNumber(rechargePoints, 2).toLocaleString('zh-CN')}。`,
        action_label: paymentSettlementStatus === 'warning' ? '核对支付成功订单与积分发放流水' : null,
        order_count: rechargeOrderCount,
        amount_cny: financeContext.recharge_amount || 0,
        points: rechargePoints
    });

    const pointIssuanceStatus = rechargePoints > 0 && pointsInflow <= 0 ? 'warning' : 'ready';
    addItem({
        key: 'point_issuance',
        category: 'points',
        label: '积分发放闭环',
        status: pointIssuanceStatus,
        value_label: `${roundNumber(pointsInflow || rechargePoints, 2).toLocaleString('zh-CN')} 积分`,
        description: `积分流入 ${roundNumber(pointsInflow, 2).toLocaleString('zh-CN')}，充值应发 ${roundNumber(rechargePoints, 2).toLocaleString('zh-CN')}。`,
        action_label: pointIssuanceStatus === 'warning' ? '核对 points_ledger 中的充值入账流水' : null,
        order_count: rechargeOrderCount,
        points: pointsInflow || rechargePoints
    });

    addItem({
        key: 'cash_revenue',
        category: 'revenue',
        label: '现金收入确认',
        status: orderCount > 0 && paidPoints > 0 && recognizedRevenue <= 0 ? 'warning' : 'ready',
        value_label: formatShopProfitAuditAmount(recognizedRevenue),
        description: `按付费积分确认现金收入，已识别 ${roundNumber(paidPoints, 2).toLocaleString('zh-CN')} 付费积分。`,
        action_label: recognizedRevenue <= 0 && paidPoints > 0 ? '复核付费积分现金价值' : null,
        order_count: orderCount,
        amount_cny: recognizedRevenue,
        points: paidPoints
    });

    const pointCoverageRate = normalizeNumber(pointCoverage.coverage_rate, 0);
    const pointCoverageStatus = normalizeNumber(pointCoverage.action_required_order_count, 0) > 0 || pointCoverageRate < 0.9999
        ? 'warning'
        : 'ready';
    addItem({
        key: 'point_sources',
        category: 'points',
        label: '积分来源追踪',
        status: pointCoverageStatus,
        value_label: `${roundNumber(pointCoverageRate * 100, 2).toLocaleString('zh-CN')}%`,
        description: `付费、赠送、迁移期余额按积分批次归因，未追踪 ${roundNumber(pointCoverage.untracked_points, 2).toLocaleString('zh-CN')} 积分。`,
        action_label: pointCoverageStatus === 'warning' ? '补齐积分来源批次或复核来源类型' : null,
        order_count: pointCoverage.action_required_order_count || pointCoverage.order_count || 0,
        points: pointCoverage.untracked_points || 0
    });

    const pointConsumptionStatus = shopOrderContextCount > 0 && pointsOutflow <= 0 ? 'warning' : 'ready';
    addItem({
        key: 'point_consumption',
        category: 'points',
        label: '积分消耗闭环',
        status: pointConsumptionStatus,
        value_label: `${roundNumber(pointsOutflow || shopPointsSpent, 2).toLocaleString('zh-CN')} 积分`,
        description: `商城消费 ${roundNumber(shopOrderContextCount, 0).toLocaleString('zh-CN')} 笔，积分流出 ${roundNumber(pointsOutflow, 2).toLocaleString('zh-CN')}。`,
        action_label: pointConsumptionStatus === 'warning' ? '核对商城订单扣减与积分流水出账' : null,
        order_count: shopOrderContextCount,
        points: pointsOutflow || shopPointsSpent
    });

    const orderLinkStatus = orderCount > 0 && (summary.inventory_item_count <= 0 || costBreakdown.no_inventory > 0) ? 'warning' : 'ready';
    addItem({
        key: 'shop_order_linkage',
        category: 'shop_order',
        label: '商城订单闭环',
        status: orderLinkStatus,
        value_label: `${roundNumber(orderCount, 0).toLocaleString('zh-CN')} 笔`,
        description: `利润审计订单 ${roundNumber(orderCount, 0).toLocaleString('zh-CN')} 笔，站点商城消费 ${roundNumber(shopOrderContextCount, 0).toLocaleString('zh-CN')} 笔，退款 ${roundNumber(refundedShopOrderCount, 0).toLocaleString('zh-CN')} 笔。`,
        action_label: orderLinkStatus === 'warning' ? '补齐订单与库存明细关联' : null,
        order_count: orderCount,
        points: shopPointsSpent
    });

    const missingCostCount = normalizeNumber(summary.missing_cost_item_count, 0);
    const costGapOrders = normalizeNumber(costBreakdown.partial, 0)
        + normalizeNumber(costBreakdown.no_cost, 0)
        + normalizeNumber(costBreakdown.no_inventory, 0);
    const costStatus = missingCostCount > 0 || costGapOrders > 0 ? 'warning' : 'ready';
    addItem({
        key: 'inventory_cost',
        category: 'procurement',
        label: '采购成本归因',
        status: costStatus,
        value_label: `${roundNumber(normalizeNumber(summary.cost_coverage_rate, 0) * 100, 2).toLocaleString('zh-CN')}%`,
        description: `已成本化 ${roundNumber(summary.costed_item_count, 0).toLocaleString('zh-CN')} 件库存，缺成本 ${roundNumber(missingCostCount, 0).toLocaleString('zh-CN')} 件。`,
        action_label: costStatus === 'warning' ? '补齐库存采购成本或订单库存关联' : null,
        order_count: costGapOrders,
        amount_cny: summary.recognized_cost_cny || 0
    });

    const procurementStatus = normalizeNumber(procurementRecommendations.pause_count, 0) > 0
        ? 'critical'
        : (normalizeNumber(procurementRecommendations.complete_cost_count, 0) > 0 ? 'warning' : 'ready');
    addItem({
        key: 'procurement_recommendations',
        category: 'procurement',
        label: '采购建议闭环',
        status: procurementStatus,
        value_label: `${roundNumber(procurementRecommendations.source_count, 0).toLocaleString('zh-CN')} 个货源`,
        description: `暂停复采 ${roundNumber(procurementRecommendations.pause_count, 0).toLocaleString('zh-CN')} 个，待补成本 ${roundNumber(procurementRecommendations.complete_cost_count, 0).toLocaleString('zh-CN')} 个。`,
        action_label: procurementStatus === 'ready' ? null : '按货源采购建议处理复采与成本补齐',
        order_count: procurementRecommendations.action_required_count || 0
    });

    const adjustmentStatus = String(adjustments.status || '').trim().toLowerCase() === 'review' ? 'warning' : 'ready';
    addItem({
        key: 'profit_adjustments',
        category: 'adjustment',
        label: '优惠与退款调整',
        status: adjustmentStatus,
        value_label: `${roundNumber(adjustments.item_count, 0).toLocaleString('zh-CN')} 类`,
        description: '优惠券、赠送积分、未拆分积分和退款冲销已进入净利润调整口径。',
        action_label: adjustmentStatus === 'warning' ? '复核优惠、赠送积分和退款调整项' : null,
        order_count: Math.max(...(Array.isArray(adjustments.items) ? adjustments.items : [])
            .map((item) => normalizeNumber(item.order_count, 0)), 0),
        amount_cny: adjustments.total_amount_cny || 0,
        points: adjustments.total_points || 0
    });

    const ledgerStatus = String(ledgerPreview.status || '').trim().toLowerCase();
    const ledgerClosureStatus = ['incomplete', 'estimated'].includes(ledgerStatus) || (orderCount > 0 && !ledgerStatus)
        ? 'warning'
        : 'ready';
    addItem({
        key: 'profit_ledger',
        category: 'ledger',
        label: '利润分录闭环',
        status: ledgerClosureStatus,
        value_label: `${roundNumber(ledgerPreview.entry_count, 0).toLocaleString('zh-CN')} 条`,
        description: `利润分录合计 ${formatShopProfitAuditAmount(ledgerPreview.net_amount_cny || 0)}，状态 ${ledgerStatus || '未生成'}。`,
        action_label: ledgerClosureStatus === 'warning' ? '补齐分录缺口后再确认净利润' : null,
        order_count: ledgerPreview.order_count || 0,
        amount_cny: ledgerPreview.net_amount_cny || 0
    });

    const alertStatus = normalizeNumber(alerts.critical_count, 0) > 0
        ? 'critical'
        : (normalizeNumber(alerts.action_required_count, 0) > 0 ? 'warning' : 'ready');
    addItem({
        key: 'audit_alerts',
        category: 'audit',
        label: '审计告警收口',
        status: alertStatus,
        value_label: `${roundNumber(alerts.action_required_count, 0).toLocaleString('zh-CN')} 项待处理`,
        description: '负利润、缺成本、来源未闭环和分录缺口会汇总为审计告警。',
        action_label: alertStatus === 'ready' ? null : '按审计告警优先级逐项处理',
        order_count: summary.reconciliation_affected_order_count || 0
    });

    closure.items = items;
    closure.item_count = items.length;
    closure.ready_count = items.filter((item) => item.status === 'ready').length;
    closure.warning_count = items.filter((item) => item.status === 'warning').length;
    closure.critical_count = items.filter((item) => item.status === 'critical').length;
    closure.action_required_count = items.filter((item) => item.action_required).length;
    closure.status = closure.critical_count > 0
        ? 'critical'
        : (closure.warning_count > 0 ? 'warning' : 'ready');

    return closure;
}

function summarizeShopProfitAttributions(rows = [], options = {}) {
    const summary = createEmptyShopProfitSummary();
    const safeRows = Array.isArray(rows) ? rows.filter((row) => row?.attribution) : [];
    const persistedLedgerPreview = buildPersistedShopProfitLedgerPreview(options.persistedLedgerRows || []);
    summary.finance_reconciliation_context = normalizeJsonObject(options.financeSummary || {});

    safeRows.forEach(({ attribution }) => {
        summary.order_count += 1;
        summary.refunded_order_count += attribution.refunded ? 1 : 0;
        summary.gross_points += normalizeNumber(attribution.gross_points, 0);
        summary.revenue_points += normalizeNumber(attribution.revenue_points, 0);
        summary.paid_points_spent += normalizeNumber(attribution.paid_points_spent, 0);
        summary.bonus_points_spent += normalizeNumber(attribution.bonus_points_spent, 0);
        summary.untracked_revenue_points += normalizeNumber(attribution.untracked_revenue_points, 0);
        summary.non_cash_points += normalizeNumber(attribution.non_cash_points, 0);
        summary.discount_points += normalizeNumber(attribution.discount_points, 0);
        summary.refunded_points += normalizeNumber(attribution.refunded_points, 0);
        summary.recognized_revenue_cny += normalizeNumber(attribution.recognized_revenue_cny, 0);
        summary.purchase_cost_cny += normalizeNumber(attribution.purchase_cost_cny, 0);
        summary.recognized_cost_cny += normalizeNumber(attribution.recognized_cost_cny, 0);
        summary.net_profit_cny += normalizeNumber(attribution.net_profit_cny, 0);
        summary.inventory_item_count += normalizeNumber(attribution.inventory_item_count, 0);
        summary.costed_item_count += normalizeNumber(attribution.costed_item_count, 0);
        summary.missing_cost_item_count += normalizeNumber(attribution.missing_cost_item_count, 0);
        const coverage = String(attribution.cost_coverage || '').trim().toLowerCase();
        if (Object.prototype.hasOwnProperty.call(summary.cost_coverage_breakdown, coverage)) {
            summary.cost_coverage_breakdown[coverage] += 1;
        }
    });

    summary.gross_points = roundNumber(summary.gross_points, 2);
    summary.revenue_points = roundNumber(summary.revenue_points, 2);
    summary.paid_points_spent = roundNumber(summary.paid_points_spent, 2);
    summary.bonus_points_spent = roundNumber(summary.bonus_points_spent, 2);
    summary.untracked_revenue_points = roundNumber(summary.untracked_revenue_points, 2);
    summary.non_cash_points = roundNumber(summary.non_cash_points, 2);
    summary.discount_points = roundNumber(summary.discount_points, 2);
    summary.refunded_points = roundNumber(summary.refunded_points, 2);
    summary.recognized_revenue_cny = roundNumber(summary.recognized_revenue_cny, 4);
    summary.purchase_cost_cny = roundNumber(summary.purchase_cost_cny, 4);
    summary.recognized_cost_cny = roundNumber(summary.recognized_cost_cny, 4);
    summary.net_profit_cny = roundNumber(summary.net_profit_cny, 4);
    summary.margin_rate = summary.recognized_revenue_cny > 0
        ? roundNumber(summary.net_profit_cny / summary.recognized_revenue_cny, 4)
        : null;
    summary.cost_coverage_rate = summary.inventory_item_count > 0
        ? roundNumber(summary.costed_item_count / summary.inventory_item_count, 4)
        : 0;

    if (summary.missing_cost_item_count > 0) {
        summary.notes.push(`有 ${summary.missing_cost_item_count} 个关联库存缺少采购成本，净利润可能被高估。`);
    }
    if (summary.untracked_revenue_points > 0) {
        summary.notes.push(`有 ${summary.untracked_revenue_points.toLocaleString('zh-CN')} 积分来自未拆分历史订单，收入仍按旧口径估算。`);
    }
    if (summary.bonus_points_spent > 0) {
        summary.notes.push(`已剔除 ${summary.bonus_points_spent.toLocaleString('zh-CN')} 奖励/赠送积分对现金收入的直接确认。`);
    }
    if (summary.cost_coverage_breakdown.no_inventory > 0) {
        summary.notes.push(`有 ${summary.cost_coverage_breakdown.no_inventory} 笔订单没有精确关联库存，无法归因采购成本。`);
    }

    summary.point_source_coverage = buildShopProfitPointSourceCoverage(safeRows);
    if (summary.point_source_coverage.migration_points > 0) {
        summary.notes.push(`有 ${summary.point_source_coverage.migration_points.toLocaleString('zh-CN')} 积分来自迁移期余额批次，已按付费/赠送余额属性进入收入归因。`);
    }

    const reconciliation = buildShopProfitReconciliationIssues(safeRows);
    summary.reconciliation_status = reconciliation.status;
    summary.reconciliation_issue_count = reconciliation.issue_count;
    summary.reconciliation_affected_order_count = reconciliation.affected_order_count;
    summary.reconciliation_issues = reconciliation.issues;
    summary.order_risk_list = buildShopProfitOrderRiskList(safeRows);
    summary.historical_order_disposition = buildShopProfitHistoricalDisposition(summary.order_risk_list.items);
    summary.dimension_breakdown = buildShopProfitDimensionBreakdown(safeRows);
    summary.source_procurement_recommendations = buildShopSourceProcurementRecommendations(summary.dimension_breakdown);
    summary.profit_adjustments = buildShopProfitAdjustmentSummary(safeRows);
    summary.profit_adjustment_breakdown = buildShopProfitAdjustmentBreakdown(summary.profit_adjustments);
    summary.profit_ledger_preview = persistedLedgerPreview || buildShopProfitLedgerPreview(safeRows);
    summary.profit_ledger_preview.source = persistedLedgerPreview ? 'persisted' : 'preview';
    summary.shop_profit_audit_alerts = buildShopProfitAuditAlerts(summary);
    summary.profit_reconciliation_closure = buildShopProfitReconciliationClosure(summary);
    summary.profit_readiness = buildShopProfitReadinessSummary(summary);

    return summary;
}

async function loadShopProductSkusByIds(client, skuIds = []) {
    const ids = [...new Set((Array.isArray(skuIds) ? skuIds : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean))];

    if (!client || !ids.length) {
        return new Map();
    }

    try {
        const { data, error } = await client
            .from('shop_product_skus')
            .select('id, product_id, sku_name, sku_code, inventory_sku_id')
            .in('id', ids);

        if (error) {
            if (isMissingColumnError(error) || String(error?.code || '') === '42P01') {
                return new Map();
            }
            throw error;
        }

        return new Map((Array.isArray(data) ? data : [])
            .map((row) => [String(row?.id || '').trim(), row])
            .filter(([id]) => id));
    } catch (error) {
        if (isMissingColumnError(error) || String(error?.code || '') === '42P01') {
            return new Map();
        }
        throw error;
    }
}

function enrichShopProfitOrderWithSku(order = {}, skusById = new Map()) {
    const skuId = String(order?.sku_id || '').trim();
    if (!skuId) {
        return order;
    }
    const sku = skusById.get(skuId) || null;
    if (!sku) {
        return order;
    }
    return {
        ...order,
        sku_name: sku.sku_name || null,
        sku_code: sku.sku_code || null,
        inventory_sku_id: sku.inventory_sku_id || null
    };
}

function enrichShopProfitLinkedItemsWithSkus(linkedItems = [], skusById = new Map()) {
    return (Array.isArray(linkedItems) ? linkedItems : []).map((item) => {
        const skuId = String(item?.sku_id || '').trim();
        if (!skuId) {
            return item;
        }
        const sku = skusById.get(skuId) || null;
        if (!sku) {
            return item;
        }
        return {
            ...item,
            sku_name: sku.sku_name || null,
            sku_code: sku.sku_code || null,
            inventory_sku_id: sku.inventory_sku_id || null
        };
    });
}

async function buildShopProfitAttributionRows(client, shopOrders = []) {
    const orders = Array.isArray(shopOrders) ? shopOrders.filter(Boolean) : [];
    if (!client || !orders.length) {
        return [];
    }

    const orderIds = orders.map((order) => String(order?.id || '').trim()).filter(Boolean);
    const [orderItemsByOrderId, pointLotConsumptionsByOrderId] = await Promise.all([
        loadOrderItemsByOrderIds(client, orderIds),
        loadPointLotConsumptionsByOrderIds(client, orderIds)
    ]);
    const linkedInventoryIds = orders.flatMap((order) => (
        collectLinkedInventoryIds(order, orderItemsByOrderId.get(String(order?.id || '').trim()) || [])
    ));
    const inventoryRecordsById = await loadInventoryRecordsByIds(client, linkedInventoryIds);
    const skuIds = [
        ...orders.map((order) => order?.sku_id),
        ...[...inventoryRecordsById.values()].map((inventory) => inventory?.sku_id)
    ];
    const skusById = await loadShopProductSkusByIds(client, skuIds);

    const baseRows = orders.map((order) => {
        const orderId = String(order?.id || '').trim();
        const orderItems = orderItemsByOrderId.get(orderId) || [];
        const enrichedOrder = enrichShopProfitOrderWithSku(order, skusById);
        const linkedItems = enrichShopProfitLinkedItemsWithSkus(
            buildLinkedInventoryItems(enrichedOrder, orderItems, inventoryRecordsById),
            skusById
        );
        const pointLotSummary = summarizePointLotConsumptions(
            pointLotConsumptionsByOrderId.get(orderId) || [],
            Number(order?.price_paid || order?.total_price || 0) || 0
        );
        return {
            order: enrichedOrder,
            attribution: buildOrderProfitAttribution(enrichedOrder, linkedItems, {
                pointLotSummary
            })
        };
    });
    const sourceBatchIds = [...new Set(baseRows
        .flatMap((row) => Array.isArray(row?.attribution?.item_costs) ? row.attribution.item_costs : [])
        .map((item) => String(item?.source_batch_id || '').trim())
        .filter(Boolean))];
    const batchesById = await loadShopProcurementBatchesByIds(client, sourceBatchIds);
    const sourcesById = await loadShopInventorySourcesByIds(
        client,
        [...batchesById.values()].map((batch) => batch?.source_id)
    );

    return enrichShopProfitRowsWithProcurementSources(baseRows, batchesById, sourcesById);
}

function buildShopProfitBusinessTrend(shopProfitRows = [], sinceIso, untilIso) {
    const rangeStart = new Date(sinceIso);
    const rangeEnd = new Date(untilIso || Date.now());

    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime()) || rangeStart.getTime() > rangeEnd.getTime()) {
        return {
            key: 'shop_profit',
            tone: 'profit',
            metric_kind: 'currency',
            points: []
        };
    }

    const buckets = buildUtcDayBuckets(rangeStart.toISOString(), rangeEnd.toISOString());
    const bucketMap = new Map(buckets.map((bucket) => [bucket.key, {
        label: bucket.label,
        value: 0
    }]));

    (Array.isArray(shopProfitRows) ? shopProfitRows : []).forEach(({ order, attribution }) => {
        const createdAt = new Date(order?.created_at);
        if (Number.isNaN(createdAt.getTime()) || createdAt.getTime() < rangeStart.getTime() || createdAt.getTime() > rangeEnd.getTime()) {
            return;
        }
        const bucket = bucketMap.get(getUtcDayKey(createdAt));
        if (!bucket) return;
        bucket.value += normalizeNumber(attribution?.net_profit_cny, 0);
    });

    return {
        key: 'shop_profit',
        tone: 'profit',
        metric_kind: 'currency',
        points: buckets.map((bucket) => {
            const row = bucketMap.get(bucket.key) || { label: bucket.label, value: 0 };
            return {
                label: row.label,
                value: roundNumber(row.value, 4)
            };
        })
    };
}

function attachShopProfitTrend(trendSeries = [], shopProfitTrend = null) {
    const normalized = normalizeBusinessBreakdownTrendSeries(trendSeries)
        .filter((series) => String(series?.key || '').trim().toLowerCase() !== 'shop_profit');
    if (shopProfitTrend && Array.isArray(shopProfitTrend.points)) {
        normalized.push(shopProfitTrend);
    }
    return normalized;
}

function buildPointsBreakdown(ledgerRows, trendSeries = []) {
    const categoryMap = new Map();

    (ledgerRows || []).forEach((entry) => {
        const category = classifyLedgerCategory(entry);
        if (!categoryMap.has(category.key)) {
            categoryMap.set(category.key, {
                key: category.key,
                label: category.label,
                inflow: 0,
                outflow: 0
            });
        }

        const row = categoryMap.get(category.key);
        const amount = normalizeNumber(entry.amount, 0);
        if (amount >= 0) {
            row.inflow += amount;
        } else {
            row.outflow += Math.abs(amount);
        }
    });

    return Array.from(categoryMap.values())
        .map((item) => ({
            ...item,
            inflow: roundNumber(item.inflow, 1),
            outflow: roundNumber(item.outflow, 1),
            net: roundNumber(item.inflow - item.outflow, 1),
            trend: normalizePointsBreakdownTrendSeries(trendSeries)
                .find((series) => series.key === item.key)?.points || []
        }))
        .sort((left, right) => Math.abs(right.net) - Math.abs(left.net));
}

function buildPointsBreakdownTrend({ pointsLedgerRows, sinceIso, untilIso }) {
    const rangeStart = new Date(sinceIso);
    const rangeEnd = new Date(untilIso || Date.now());

    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime()) || rangeStart.getTime() > rangeEnd.getTime()) {
        return [];
    }

    const buckets = buildUtcDayBuckets(rangeStart.toISOString(), rangeEnd.toISOString());
    if (!buckets.length) {
        return [];
    }

    const seriesMap = new Map();
    const ensureSeries = (category) => {
        if (!seriesMap.has(category.key)) {
            seriesMap.set(category.key, {
                key: category.key,
                label: category.label,
                points: buckets.map((bucket) => ({
                    key: bucket.key,
                    label: bucket.label,
                    value: 0
                }))
            });
        }
        return seriesMap.get(category.key);
    };

    (pointsLedgerRows || []).forEach((entry) => {
        const createdAt = new Date(entry?.created_at);
        if (
            Number.isNaN(createdAt.getTime())
            || createdAt.getTime() < rangeStart.getTime()
            || createdAt.getTime() > rangeEnd.getTime()
        ) {
            return;
        }

        const category = classifyLedgerCategory(entry);
        const bucketKey = getUtcDayKey(createdAt);
        const series = ensureSeries(category);
        const point = series.points.find((item) => item.key === bucketKey);
        if (point) {
            point.value += normalizeNumber(entry.amount, 0);
        }
    });

    return Array.from(seriesMap.values()).map((series) => ({
        key: series.key,
        label: series.label,
        points: series.points.map((point) => ({
            label: point.label,
            value: roundNumber(point.value, 1)
        }))
    }));
}

function formatBusinessCurrency(value) {
    const amount = normalizeNumber(value, 0);
    return `¥${amount.toLocaleString('zh-CN', {
        minimumFractionDigits: amount % 1 ? 2 : 0,
        maximumFractionDigits: 2
    })}`;
}

function buildBusinessBreakdownTrend({
    paymentOrders,
    shopOrders,
    pointsLedgerRows,
    pointsBalanceRows,
    sitewideSummary,
    sinceIso,
    untilIso
}) {
    const rangeStart = new Date(sinceIso);
    const rangeEnd = new Date(untilIso || Date.now());

    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime()) || rangeStart.getTime() > rangeEnd.getTime()) {
        return [];
    }

    const buckets = buildUtcDayBuckets(rangeStart.toISOString(), rangeEnd.toISOString());
    if (!buckets.length) {
        return [];
    }

    const bucketMap = new Map(
        buckets.map((bucket) => [bucket.key, {
            key: bucket.key,
            label: bucket.label,
            recharge: 0,
            shop: 0,
            mock: 0,
            ledgerNet: 0
        }])
    );

    (paymentOrders || []).forEach((order) => {
        if (!isSuccessOrder(order)) return;
        const bucket = bucketMap.get(getUtcDayKey(order.created_at));
        if (!bucket) return;

        bucket.recharge += normalizeNumber(order.paid_amount, normalizeNumber(order.expected_amount, 0));
        if (String(order.provider || '').trim().toLowerCase() === 'mock') {
            bucket.mock += 1;
        }
    });

    (shopOrders || []).forEach((order) => {
        if (String(order.refund_status || '').trim().toLowerCase() === 'refunded') return;
        const bucket = bucketMap.get(getUtcDayKey(order.created_at));
        if (!bucket) return;
        bucket.shop += normalizeNumber(order.price_paid, 0);
    });

    const ledgerRows = (pointsLedgerRows || []).filter((row) => {
        const createdAt = new Date(row?.created_at);
        return !Number.isNaN(createdAt.getTime()) && createdAt.getTime() >= rangeStart.getTime();
    });

    ledgerRows.forEach((entry) => {
        const createdAt = new Date(entry.created_at);
        if (Number.isNaN(createdAt.getTime())) return;
        const key = getUtcDayKey(createdAt);
        const bucket = bucketMap.get(key);
        if (bucket && createdAt.getTime() <= rangeEnd.getTime()) {
            bucket.ledgerNet += normalizeNumber(entry.amount, 0);
        }
    });

    const currentCirculatingPoints = normalizeNumber(
        sitewideSummary?.circulating_points,
        roundNumber((pointsBalanceRows || []).reduce((sum, row) => sum + normalizeNumber(row.total_balance, 0), 0), 1)
    );
    const postRangeLedgerNet = ledgerRows
        .filter((entry) => new Date(entry.created_at).getTime() > rangeEnd.getTime())
        .reduce((sum, entry) => sum + normalizeNumber(entry.amount, 0), 0);
    const selectedLedgerNet = buckets.reduce((sum, bucket) => sum + normalizeNumber(bucketMap.get(bucket.key)?.ledgerNet, 0), 0);
    const rangeEndBalance = currentCirculatingPoints - postRangeLedgerNet;
    let runningBalance = rangeEndBalance - selectedLedgerNet;

    const rechargePoints = [];
    const shopPoints = [];
    const mockPoints = [];
    const balancePoints = [];

    buckets.forEach((bucket) => {
        const row = bucketMap.get(bucket.key) || {
            label: bucket.label,
            recharge: 0,
            shop: 0,
            mock: 0,
            ledgerNet: 0
        };

        runningBalance += normalizeNumber(row.ledgerNet, 0);

        rechargePoints.push({
            label: row.label,
            value: roundNumber(row.recharge, 2)
        });
        shopPoints.push({
            label: row.label,
            value: roundNumber(row.shop, 1)
        });
        mockPoints.push({
            label: row.label,
            value: roundNumber(row.mock, 1)
        });
        balancePoints.push({
            label: row.label,
            value: roundNumber(runningBalance, 1)
        });
    });

    return [
        {
            key: 'recharge',
            tone: 'recharge',
            metric_kind: 'currency',
            points: rechargePoints
        },
        {
            key: 'shop',
            tone: 'shop',
            metric_kind: 'points',
            points: shopPoints
        },
        {
            key: 'mock',
            tone: 'mock',
            metric_kind: 'count',
            points: mockPoints
        },
        {
            key: 'balance',
            tone: 'balance',
            metric_kind: 'points',
            points: balancePoints
        }
    ];
}

function getBusinessBreakdownTrendPoints(trendSeries, key) {
    const series = normalizeBusinessBreakdownTrendSeries(trendSeries)
        .find((item) => item.key === String(key || '').trim().toLowerCase());
    return series ? series.points : [];
}

function buildBusinessBreakdown({ paymentOrders, shopOrders, balanceRows, sitewideSummary, trendSeries }) {
    const mockOrders = (paymentOrders || []).filter((order) => order.provider === 'mock');
    const successfulMockOrders = mockOrders.filter(isSuccessOrder);
    const orderCount = (paymentOrders || []).length;
    const shopProfitSummary = normalizeJsonObject(sitewideSummary?.shop_profit_summary);
    const shopNetProfitCny = normalizeNumber(shopProfitSummary.net_profit_cny, 0);
    const shopMissingCostCount = normalizeNumber(shopProfitSummary.missing_cost_item_count, 0);

    return [
        {
            key: 'recharge',
            tone: 'recharge',
            metric_kind: 'currency',
            title: '充值收入',
            description: `近期开出的支付订单 ${orderCount} 笔，成功 ${sitewideSummary.recharge_order_count} 笔。`,
            metric: formatBusinessCurrency(sitewideSummary.recharge_amount),
            meta: `${sitewideSummary.recharge_points.toLocaleString('zh-CN')} 已入账`,
            help: '统计标准支付订单的成功入账金额和对应到账点数。',
            trend: getBusinessBreakdownTrendPoints(trendSeries, 'recharge')
        },
        {
            key: 'shop',
            tone: 'shop',
            metric_kind: 'points',
            title: '商城消费',
            description: `商城已消费 ${sitewideSummary.shop_order_count} 笔，退款 ${sitewideSummary.refunded_shop_order_count} 笔。`,
            metric: sitewideSummary.shop_points_spent.toLocaleString('zh-CN'),
            meta: sitewideSummary.refunded_shop_points > 0
                ? `已退款 ${sitewideSummary.refunded_shop_points.toLocaleString('zh-CN')}`
                : '当前无退款冲销',
            help: '统计商城订单消耗的点数，不含已退款冲销部分。',
            trend: getBusinessBreakdownTrendPoints(trendSeries, 'shop')
        },
        {
            key: 'shop_profit',
            tone: 'profit',
            metric_kind: 'currency',
            title: '商城净利润估算',
            description: `按采购成本归因 ${normalizeNumber(shopProfitSummary.costed_item_count, 0).toLocaleString('zh-CN')} 件库存，缺成本 ${shopMissingCostCount.toLocaleString('zh-CN')} 件。`,
            metric: formatBusinessCurrency(shopNetProfitCny),
            meta: `现金收入 ${formatBusinessCurrency(shopProfitSummary.recognized_revenue_cny)} · 奖励/未拆分 ${roundNumber(normalizeNumber(shopProfitSummary.non_cash_points, 0), 2).toLocaleString('zh-CN')} 积分`,
            help: '优先按订单付费积分确认现金收入；奖励/赠送积分不直接确认为现金收入，历史未拆分订单按旧口径估算。',
            trend: getBusinessBreakdownTrendPoints(trendSeries, 'shop_profit')
        },
        {
            key: 'mock',
            tone: 'mock',
            metric_kind: 'count',
            title: '模拟支付',
            description: '用于临时直到账的充值记录，也会进入标准支付订单。',
            metric: `${successfulMockOrders.length.toLocaleString('zh-CN')} 笔`,
            meta: `${roundNumber(successfulMockOrders.reduce((sum, order) => sum + normalizeNumber(order.points_amount, 0), 0), 1).toLocaleString('zh-CN')} 已入账`,
            help: '用于统计当前启用的模拟充值通道，方便和真实支付分开核对。',
            trend: getBusinessBreakdownTrendPoints(trendSeries, 'mock')
        },
        {
            key: 'balance',
            tone: 'balance',
            metric_kind: 'points',
            title: '当前积分存量',
            description: `活跃余额分布在 ${(balanceRows || []).length.toLocaleString('zh-CN')} 个用户/站点账户中。`,
            metric: sitewideSummary.circulating_points.toLocaleString('zh-CN'),
            meta: `付费 ${sitewideSummary.paid_balance.toLocaleString('zh-CN')} · 奖励 ${sitewideSummary.bonus_balance.toLocaleString('zh-CN')}`,
            help: '展示当前仍在用户账户中流通的总余额，以及付费与奖励余额的拆分。',
            trend: getBusinessBreakdownTrendPoints(trendSeries, 'balance')
        }
    ];
}

function buildBusinessBreakdownFromFinanceSummary({ overview, sitewideSummary, trendSeries }) {
    const normalizedOverview = normalizeJsonObject(overview);
    const summary = normalizeJsonObject(sitewideSummary);
    const rechargeAmount = normalizeNumber(summary.recharge_amount, 0);
    const rechargePoints = roundNumber(summary.recharge_points, 1);
    const rechargeOrderCount = normalizeNumber(summary.recharge_order_count, 0);
    const totalOrderCount = normalizeNumber(normalizedOverview.total_orders, 0);
    const shopOrderCount = normalizeNumber(summary.shop_order_count, 0);
    const refundedShopOrderCount = normalizeNumber(summary.refunded_shop_order_count, 0);
    const refundedShopPoints = roundNumber(summary.refunded_shop_points, 1);
    const shopPointsSpent = roundNumber(summary.shop_points_spent, 1);
    const mockRechargeOrderCount = normalizeNumber(summary.mock_recharge_order_count, 0);
    const mockRechargePoints = roundNumber(summary.mock_recharge_points, 1);
    const balanceAccountCount = normalizeNumber(summary.balance_account_count, 0);
    const circulatingPoints = roundNumber(summary.circulating_points, 1);
    const paidBalance = roundNumber(summary.paid_balance, 1);
    const bonusBalance = roundNumber(summary.bonus_balance, 1);
    const shopProfitSummary = normalizeJsonObject(summary.shop_profit_summary);
    const shopNetProfitCny = normalizeNumber(shopProfitSummary.net_profit_cny, 0);
    const shopMissingCostCount = normalizeNumber(shopProfitSummary.missing_cost_item_count, 0);

    return [
        {
            key: 'recharge',
            tone: 'recharge',
            metric_kind: 'currency',
            title: '充值收入',
            description: `近期开出的支付订单 ${totalOrderCount.toLocaleString('zh-CN')} 笔，成功 ${rechargeOrderCount.toLocaleString('zh-CN')} 笔。`,
            metric: formatBusinessCurrency(rechargeAmount),
            meta: `${rechargePoints.toLocaleString('zh-CN')} 已入账`,
            help: '统计标准支付订单的成功入账金额和对应到账点数。',
            trend: getBusinessBreakdownTrendPoints(trendSeries, 'recharge')
        },
        {
            key: 'shop',
            tone: 'shop',
            metric_kind: 'points',
            title: '商城消费',
            description: `商城已消费 ${shopOrderCount.toLocaleString('zh-CN')} 笔，退款 ${refundedShopOrderCount.toLocaleString('zh-CN')} 笔。`,
            metric: shopPointsSpent.toLocaleString('zh-CN'),
            meta: refundedShopPoints > 0
                ? `已退款 ${refundedShopPoints.toLocaleString('zh-CN')}`
                : '当前无退款冲销',
            help: '统计商城订单消耗的点数，不含已退款冲销部分。',
            trend: getBusinessBreakdownTrendPoints(trendSeries, 'shop')
        },
        {
            key: 'shop_profit',
            tone: 'profit',
            metric_kind: 'currency',
            title: '商城净利润估算',
            description: `按采购成本归因 ${normalizeNumber(shopProfitSummary.costed_item_count, 0).toLocaleString('zh-CN')} 件库存，缺成本 ${shopMissingCostCount.toLocaleString('zh-CN')} 件。`,
            metric: formatBusinessCurrency(shopNetProfitCny),
            meta: `现金收入 ${formatBusinessCurrency(shopProfitSummary.recognized_revenue_cny)} · 奖励/未拆分 ${roundNumber(normalizeNumber(shopProfitSummary.non_cash_points, 0), 2).toLocaleString('zh-CN')} 积分`,
            help: '优先按订单付费积分确认现金收入；奖励/赠送积分不直接确认为现金收入，历史未拆分订单按旧口径估算。',
            trend: getBusinessBreakdownTrendPoints(trendSeries, 'shop_profit')
        },
        {
            key: 'mock',
            tone: 'mock',
            metric_kind: 'count',
            title: '模拟支付',
            description: '用于临时直到账的充值记录，也会进入标准支付订单。',
            metric: `${mockRechargeOrderCount.toLocaleString('zh-CN')} 笔`,
            meta: `${mockRechargePoints.toLocaleString('zh-CN')} 已入账`,
            help: '用于统计当前启用的模拟充值通道，方便和真实支付分开核对。',
            trend: getBusinessBreakdownTrendPoints(trendSeries, 'mock')
        },
        {
            key: 'balance',
            tone: 'balance',
            metric_kind: 'points',
            title: '当前积分存量',
            description: `活跃余额分布在 ${balanceAccountCount.toLocaleString('zh-CN')} 个用户/站点账户中。`,
            metric: circulatingPoints.toLocaleString('zh-CN'),
            meta: `付费 ${paidBalance.toLocaleString('zh-CN')} · 奖励 ${bonusBalance.toLocaleString('zh-CN')}`,
            help: '展示当前仍在用户账户中流通的总余额，以及付费与奖励余额的拆分。',
            trend: getBusinessBreakdownTrendPoints(trendSeries, 'balance')
        }
    ];
}

module.exports = async function handler(req, res) {
    if (!['GET'].includes(req.method)) {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const {
            supabase,
            requestSupabase,
            adminSupabase,
            user
        } = await requireAdmin(req, { anyOf: ['payments.manage', 'analytics.view'] });
        const scopedClient = supabase || requestSupabase;
        const site = typeof req.query?.site === 'string' && req.query.site.trim() ? req.query.site.trim() : null;
        const view = ['overview', 'finance', 'ops'].includes(String(req.query?.view || '').trim())
            ? String(req.query.view).trim()
            : 'overview';
        const requestedScope = String(req.query?.scope || '').trim().toLowerCase();
        const summaryScope = view === 'overview' && ['core', 'secondary', 'ops'].includes(requestedScope)
            ? requestedScope
            : 'full';
        const isOverviewCoreScope = view === 'overview' && summaryScope === 'core';
        const isOverviewSecondaryScope = view === 'overview' && summaryScope === 'secondary';
        const isOverviewOpsScope = view === 'overview' && summaryScope === 'ops';
        const isOverviewPartialScope = view === 'overview' && summaryScope !== 'full';
        const needsOverviewPrimaryData = view !== 'overview' || !isOverviewOpsScope;
        const needsOverviewSecondaryData = view === 'overview' && (summaryScope === 'secondary' || summaryScope === 'full');
        const needsOverviewOpsData = view === 'overview' && (summaryScope === 'ops' || summaryScope === 'full');
        const days = Number.parseInt(req.query?.days, 10);
        const normalizedDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30;
        const customStartIso = parseIsoQueryDate(req.query?.startDate);
        const customEndIso = parseIsoQueryDate(req.query?.endDate);
        const isPrefetchRequest = ['1', 'true'].includes(String(req.query?.prefetch || '').trim().toLowerCase());
        const hasCustomRange = Boolean(customStartIso && customEndIso && new Date(customStartIso).getTime() <= new Date(customEndIso).getTime());
        const sinceIso = hasCustomRange ? customStartIso : getIsoDaysAgo(normalizedDays);
        const untilIso = hasCustomRange ? customEndIso : null;
        const trendSinceIso = hasCustomRange ? customStartIso : getIsoHoursAgo(24);
        const needsOrders = view === 'finance' || view === 'ops' || (view === 'overview' && !isOverviewOpsScope);
        const needsEvents = view === 'ops' || needsOverviewSecondaryData;
        const needsSessions = view === 'ops' || (view === 'overview' && !isOverviewOpsScope);
        const needsQueries = view === 'ops' || (view === 'overview' && !isOverviewOpsScope);
        const needsFinance = view === 'finance';
        const needsOpsAlerts = view === 'ops' || needsOverviewOpsData;
        const needsShopProfitOpsAudit = needsOpsAlerts && !isOverviewCoreScope;
        const overviewAggregate = needsOverviewSecondaryData
            ? await fetchPaymentOverviewAggregate(adminSupabase || null, sinceIso, untilIso, trendSinceIso, site)
            : null;
        const useOverviewAggregate = needsOverviewSecondaryData && Boolean(overviewAggregate);
        const financeAggregate = needsFinance
            ? await fetchPaymentFinanceAggregate(adminSupabase || null, sinceIso, untilIso, site)
            : null;
        const useFinanceAggregate = needsFinance && Boolean(financeAggregate);
        const financeAggregateHasBusinessTrend = useFinanceAggregate
            && Array.isArray(financeAggregate?.business_breakdown_trend);
        const financeAggregateHasPointsTrend = useFinanceAggregate
            && Array.isArray(financeAggregate?.points_breakdown_trend);
        const needsBusinessTrendFallback = needsFinance && (!useFinanceAggregate || !financeAggregateHasBusinessTrend);
        const needsPointsTrendFallback = needsFinance && (!useFinanceAggregate || !financeAggregateHasPointsTrend);
        const needsShopProfitSummary = needsFinance || needsShopProfitOpsAudit;
        const shouldFetchPointsLedgerTrendRows = needsFinance && (
            (needsBusinessTrendFallback && (useFinanceAggregate || Boolean(untilIso)))
            || (useFinanceAggregate && needsPointsTrendFallback)
        );

        const [
            orderRows,
            eventRows,
            queryRows,
            rawCheckoutSessions,
            rawOpsAlertJobs,
            shopOrders,
            shopProfitLedgerRows,
            pointsLedgerRows,
            pointsBalanceRows,
            pointsLedgerTrendRows
        ] = await Promise.all([
            !needsOrders || useOverviewAggregate || (useFinanceAggregate && !needsBusinessTrendFallback)
                ? Promise.resolve([])
                : fetchPaymentOrders(scopedClient, sinceIso, untilIso, site, view),
            needsEvents && !useOverviewAggregate ? fetchPaymentEvents(scopedClient, sinceIso, untilIso) : Promise.resolve([]),
            needsQueries && !useOverviewAggregate ? fetchPaymentQueryAttempts(scopedClient, sinceIso, untilIso, site) : Promise.resolve([]),
            needsSessions && !useOverviewAggregate ? fetchCheckoutSessions(scopedClient, sinceIso, untilIso, site) : Promise.resolve([]),
            needsOpsAlerts ? fetchOpsAlertJobs(scopedClient, sinceIso, untilIso, view) : Promise.resolve([]),
            (needsBusinessTrendFallback || needsShopProfitSummary) ? fetchShopOrders(scopedClient, sinceIso, untilIso, site) : Promise.resolve([]),
            needsShopProfitSummary ? fetchShopProfitLedgerRows(scopedClient, sinceIso, untilIso, site) : Promise.resolve([]),
            needsFinance && !useFinanceAggregate ? fetchPointsLedger(scopedClient, sinceIso, untilIso, site) : Promise.resolve([]),
            needsBusinessTrendFallback ? fetchPointsBalances(scopedClient, site) : Promise.resolve([]),
            shouldFetchPointsLedgerTrendRows
                ? fetchPointsLedger(scopedClient, sinceIso, needsBusinessTrendFallback ? null : untilIso, site)
                : Promise.resolve([])
        ]);

        const checkoutSessions = needsSessions
            ? mergeCheckoutSessionsWithOrderFallback(orderRows || [], rawCheckoutSessions || [])
            : [];
        const shopProfitRows = needsShopProfitSummary
            ? await buildShopProfitAttributionRows(scopedClient, shopOrders || [])
            : [];
        const financeSummaryBase = needsFinance
            ? (
                useFinanceAggregate
                    ? normalizeJsonObject(financeAggregate?.sitewide_summary)
                    : buildFinanceSummary(visibleOrders || [], shopOrders || [], pointsLedgerRows || [], pointsBalanceRows || [])
            )
            : {};
        const shopProfitSummary = needsShopProfitSummary
            ? summarizeShopProfitAttributions(shopProfitRows, {
                persistedLedgerRows: shopProfitLedgerRows || [],
                financeSummary: financeSummaryBase
            })
            : undefined;
        const shopProfitTrend = needsShopProfitSummary
            ? buildShopProfitBusinessTrend(shopProfitRows, sinceIso, untilIso)
            : null;
        const enrichedOrders = enrichPaymentOrdersWithCheckoutSessions(orderRows || [], checkoutSessions || []);
        const visibleOrders = filterVisiblePaymentOrders(enrichedOrders || []);
        const opsAlertJobs = needsOpsAlerts
            ? (rawOpsAlertJobs || []).filter((job) => matchesOpsAlertJobSite(job, site))
            : [];
        const querySummary = needsOverviewPrimaryData
            ? (
                useOverviewAggregate
                    ? {
                        ...normalizeJsonObject(overviewAggregate?.query_summary),
                        outcome_breakdown: normalizeJsonArray(overviewAggregate?.query_summary?.outcome_breakdown)
                    }
                    : (needsQueries ? buildQuerySummary(queryRows || []) : undefined)
            )
            : undefined;
        const overview = needsOverviewPrimaryData
            ? (
                useFinanceAggregate
                    ? normalizeJsonObject(financeAggregate?.overview)
                    : useOverviewAggregate
                        ? normalizeJsonObject(overviewAggregate?.overview)
                        : buildOverview(visibleOrders || [])
            )
            : undefined;
        const sessionSummary = needsOverviewPrimaryData && needsSessions
            ? (
                useOverviewAggregate
                    ? normalizeJsonObject(overviewAggregate?.session_summary)
                    : buildSessionSummary(checkoutSessions || [], visibleOrders || [])
            )
            : undefined;
        let opsAlertSummary;
        let opsAlertItems = [];
        const siteOrderIds = useOverviewAggregate
            ? new Set()
            : new Set((visibleOrders || []).map((order) => order.id).filter(Boolean));
        const siteOrderNumbers = useOverviewAggregate
            ? new Set()
            : new Set((visibleOrders || []).map((order) => order.provider_order_no).filter(Boolean));
        const scopedEvents = useOverviewAggregate
            ? []
            : (eventRows || []).filter((event) => {
                if (!site) return true;
                return (
                    (event.payment_order_id && siteOrderIds.has(event.payment_order_id))
                    || (event.provider_order_no && siteOrderNumbers.has(event.provider_order_no))
                );
            });
        const scopedTrendEvents = useOverviewAggregate
            ? []
            : scopedEvents.filter((event) => new Date(event.created_at).getTime() >= new Date(trendSinceIso).getTime());

        const recentOrderCandidates = view === 'ops'
            ? (visibleOrders || []).slice(0, 20)
            : [];
        const recentCheckoutSessionCandidates = view === 'ops'
            ? (checkoutSessions || [])
                .filter((session) => {
                    const status = String(session?.status || '').trim().toLowerCase();
                    return (
                        !session?.payment_order_id
                        || SESSION_OPEN_STATUSES.has(status)
                        || SESSION_FAILURE_STATUSES.has(status)
                    );
                })
                .sort((left, right) => getSessionSortValue(right) - getSessionSortValue(left))
                .slice(0, 20)
            : [];
        const recentProfileMap = view === 'ops'
            ? await fetchProfilesByIds(scopedClient, [
                ...recentOrderCandidates.map((order) => order?.user_id),
                ...recentCheckoutSessionCandidates.map((session) => session?.user_id),
                ...(checkoutSessions || []).map((session) => session?.user_id)
            ])
            : new Map();
        const recentOrders = view === 'ops'
            ? (await enrichRecentOrdersWithGatewayRefundHints(recentOrderCandidates, adminSupabase || scopedClient, process.env))
                .map((order) => {
                    const displayAmount = buildPaymentDisplayAmount(order);
                    return {
                        ...order,
                        display_amount: displayAmount.amount,
                        display_currency: displayAmount.currency,
                        display_amount_label: displayAmount.label,
                        display_amount_source: displayAmount.source,
                        settlement_amount: displayAmount.settlement_amount,
                        settlement_currency: displayAmount.settlement_currency,
                        settlement_amount_label: displayAmount.settlement_label,
                        user_email: (() => {
                        const userId = String(order?.user_id || '').trim();
                        const profile = userId ? recentProfileMap.get(userId) || null : null;
                        const email = String(profile?.email || '').trim();
                        return email || null;
                        })(),
                        order_available_actions: getOrderAvailableActions(order)
                    };
                })
            : [];
        const recentCheckoutSessions = view === 'ops'
            ? recentCheckoutSessionCandidates
                .map((session) => {
                    const trace = buildCheckoutSessionTrace(session);
                    if (!trace) {
                        return null;
                    }
                    const userId = String(trace.user_id || '').trim();
                    const profile = userId ? recentProfileMap.get(userId) || null : null;
                    const email = String(profile?.email || '').trim();
                    return {
                        ...trace,
                        user_email: email || null
                    };
                })
                .filter(Boolean)
            : [];
        const recentOrderAnomalies = view === 'ops'
            ? (visibleOrders || [])
                .filter(isOrderAnomaly)
                .slice(0, 24)
                .map(buildOrderAnomaly)
            : [];

        const duplicateWebhookTopicItems = buildDuplicateWebhookTopicItems(scopedEvents || []);
        const recentEventAnomalies = needsEvents
            ? (
                useOverviewAggregate
                    ? []
                    : scopedEvents
                        .filter(isEventAnomaly)
                        .slice(0, 24)
                        .map(buildEventAnomaly)
            )
            : [];
        const recentSessionAnomalies = view === 'ops'
            ? (checkoutSessions || [])
                .map(buildCheckoutSessionAnomaly)
                .filter(Boolean)
                .slice(0, 24)
            : [];
        const refundAlertSummary = needsEvents
            ? (
                useOverviewAggregate
                    ? {
                        topics: normalizeJsonArray(overviewAggregate?.refund_alert_topics),
                        items: normalizeJsonArray(overviewAggregate?.refund_alert_items),
                        countItems: normalizeJsonArray(overviewAggregate?.refund_alert_items)
                    }
                    : buildRefundExceptionTopics(scopedEvents || [])
            )
            : { topics: [], items: [], countItems: [] };
        const exceptionTopics = view === 'ops'
            ? buildExceptionTopics({
                orders: visibleOrders || [],
                events: scopedEvents || [],
                queryAttempts: queryRows || [],
                sessions: checkoutSessions || []
            })
            : { topics: [], items: [], countItems: [] };

        const combinedRecentAnomalies = view === 'ops'
            ? [...recentOrderAnomalies, ...recentEventAnomalies, ...recentSessionAnomalies]
                .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
            : [];
        const shopProfitCaseTargets = needsOpsAlerts && needsShopProfitOpsAudit
            ? buildShopProfitOpsAlertItems(shopProfitSummary, site)
            : [];
        const anomalyCaseTargets = [
            ...(view === 'ops'
                ? [...combinedRecentAnomalies, ...(exceptionTopics.countItems || exceptionTopics.items || [])]
                : [
                ...(refundAlertSummary.countItems || refundAlertSummary.items || []),
                ...duplicateWebhookTopicItems
                ]),
            ...shopProfitCaseTargets
        ];
        const anomalyCases = anomalyCaseTargets.length
            ? await fetchAnomalyCasesByTargets(scopedClient, anomalyCaseTargets)
            : [];
        const opsAlertPayload = needsOpsAlerts
            ? mergeOpsAlertQueueWithShopProfit(
                opsAlertJobs,
                needsShopProfitOpsAudit ? shopProfitSummary : undefined,
                site,
                anomalyCases
            )
            : { summary: undefined, items: [] };
        opsAlertSummary = opsAlertPayload.summary;
        opsAlertItems = opsAlertPayload.items;
        const enrichedRefundAlertItems = needsEvents
            ? enrichAnomaliesWithCases(refundAlertSummary.items || [], anomalyCases)
            : [];
        const enrichedRefundAlertCountItems = needsEvents
            ? enrichAnomaliesWithCases(refundAlertSummary.countItems || refundAlertSummary.items || [], anomalyCases)
            : [];
        const enrichedDuplicateWebhookCountItems = needsEvents && duplicateWebhookTopicItems.length
            ? enrichAnomaliesWithCases(duplicateWebhookTopicItems, anomalyCases)
            : [];
        const enrichedRecentAnomalies = view === 'ops'
            ? enrichAnomaliesWithCases(enrichItemsWithProfileEmails(combinedRecentAnomalies, recentProfileMap), anomalyCases)
            : [];
        const enrichedExceptionTopicItems = view === 'ops'
            ? enrichAnomaliesWithCases(enrichItemsWithProfileEmails(exceptionTopics.items || [], recentProfileMap), anomalyCases)
            : [];
        const enrichedExceptionTopicCountItems = view === 'ops'
            ? enrichAnomaliesWithCases(enrichItemsWithProfileEmails(exceptionTopics.countItems || exceptionTopics.items || [], recentProfileMap), anomalyCases)
            : [];
        const displayExceptionTopicItems = view === 'ops'
            ? buildDisplayExceptionTopicItems(enrichedExceptionTopicCountItems)
            : [];
        const unarchivedExceptionTopicCountItems = filterUnarchivedAnomalyItems(enrichedExceptionTopicCountItems);
        const visibleExceptionTopics = view === 'ops'
            ? recalculateTopicCounts(exceptionTopics.topics || [], unarchivedExceptionTopicCountItems)
            : [];
        const activeRefundAlertItems = needsEvents
            ? filterActiveAnomalyItems(enrichedRefundAlertItems)
            : [];
        const activeRefundAlertCountItems = needsEvents
            ? filterActiveAnomalyItems(enrichedRefundAlertCountItems)
            : [];
        const aggregateAnomalySummary = normalizeJsonObject(overviewAggregate?.anomaly_summary);
        const duplicateWebhookOrders = useOverviewAggregate
            ? Math.max(0, Number(aggregateAnomalySummary.duplicate_webhook_orders || 0) || 0)
            : filterUnarchivedAnomalyItems(enrichedDuplicateWebhookCountItems).length;
        const shouldTrustAggregateRefundCounts = useOverviewAggregate && !normalizeJsonArray(refundAlertSummary.items).length;
        const activeRefundFailureCount = shouldTrustAggregateRefundCounts
            ? Number(aggregateAnomalySummary.refund_failures || 0)
            : countTopicItems(activeRefundAlertCountItems, 'refund_failures');
        const activeRefundReclaimFailureCount = shouldTrustAggregateRefundCounts
            ? Number(aggregateAnomalySummary.refund_reclaim_failures || 0)
            : countTopicItems(activeRefundAlertCountItems, 'refund_reclaim_failures');
        const activeRefundCompensationFailureCount = shouldTrustAggregateRefundCounts
            ? Number(aggregateAnomalySummary.refund_compensation_failures || 0)
            : countTopicItems(activeRefundAlertCountItems, 'refund_compensation_failures');
        const refundAlertTopics = needsEvents
            ? (refundAlertSummary.topics || []).map((topic) => ({
                ...topic,
                count: countTopicItems(activeRefundAlertCountItems, topic.key)
            })).filter((topic) => Number(topic.count || 0) > 0)
            : [];
        const recentAnomalies = view === 'ops'
            ? enrichedRecentAnomalies
                .filter((item) => !isResolvedOpsStatus(item.ops_status))
                .slice(0, 20)
            : [];
        const handledCaseCount = (anomalyCases || []).filter((item) => String(item.status || '').trim().toLowerCase() === 'handled').length;
        const ignoredCaseCount = (anomalyCases || []).filter((item) => String(item.status || '').trim().toLowerCase() === 'ignored').length;
        const retryRequestedCaseCount = (anomalyCases || []).filter((item) => String(item.status || '').trim().toLowerCase() === 'retry_requested').length;
        const openAnomalyCount = view === 'ops'
            ? recentAnomalies.length
            : recentOrderAnomalies.length + recentEventAnomalies.length + recentSessionAnomalies.length;

        const anomalySummary = needsOverviewPrimaryData
            ? (
                useFinanceAggregate
                    ? normalizeJsonObject(financeAggregate?.anomaly_summary)
                    : useOverviewAggregate
                        ? {
                            ...normalizeJsonObject(overviewAggregate?.anomaly_summary),
                            refund_failures: activeRefundFailureCount,
                            refund_reclaim_failures: activeRefundReclaimFailureCount,
                            refund_compensation_failures: activeRefundCompensationFailureCount,
                            open_cases: activeRefundAlertItems.length,
                            handled_cases: handledCaseCount,
                            ignored_cases: ignoredCaseCount,
                            retry_requested_cases: retryRequestedCaseCount
                        }
                        : {
                            review_orders: Number(overview.review_orders || 0),
                            failed_orders: Number(overview.failed_orders || 0),
                            unclaimed_paid_orders: (visibleOrders || []).filter((order) => order.status === 'paid' && !order.user_id).length,
                            recent_event_anomalies: recentEventAnomalies.length,
                            duplicate_webhook_orders: duplicateWebhookOrders,
                            refund_failures: activeRefundFailureCount,
                            refund_reclaim_failures: activeRefundReclaimFailureCount,
                            refund_compensation_failures: activeRefundCompensationFailureCount,
                            query_failures: Number(querySummary?.failed_attempts || 0),
                            stale_checkout_sessions: Number(sessionSummary?.stale_sessions || 0),
                            failed_checkout_sessions: Number(sessionSummary?.failed_sessions || 0),
                            completed_unlinked_sessions: Number(sessionSummary?.completed_unlinked_sessions || 0),
                            unmatched_session_orders: Number(sessionSummary?.unmatched_orders || 0),
                            webhook_linked_sessions: Number(sessionSummary?.webhook_linked_sessions || 0),
                            fallback_linked_sessions: Number(sessionSummary?.fallback_linked_sessions || 0),
                            session_anomalies: Number(sessionSummary?.anomaly_count || 0),
                            open_cases: view === 'ops' ? openAnomalyCount : activeRefundAlertItems.length,
                            handled_cases: handledCaseCount,
                            ignored_cases: ignoredCaseCount,
                            retry_requested_cases: retryRequestedCaseCount
                        }
            )
            : undefined;

        const provider_stats = isOverviewCoreScope
            ? null
            : isOverviewOpsScope
                ? undefined
            : useFinanceAggregate
            ? normalizeJsonArray(financeAggregate?.provider_stats)
            : useOverviewAggregate
                ? normalizeJsonArray(overviewAggregate?.provider_stats)
                : buildProviderStats(visibleOrders || [], checkoutSessions || [], scopedEvents || [], queryRows || []);
        const trend_24h = isOverviewCoreScope
            ? null
            : isOverviewOpsScope
                ? undefined
            : view === 'overview'
            ? (
                useOverviewAggregate
                    ? normalizeJsonArray(overviewAggregate?.trend_24h)
                    : buildTrend24h(scopedTrendEvents)
            )
            : undefined;
        const sitewide_summary = needsFinance
            ? (
                useFinanceAggregate
                    ? {
                        ...financeSummaryBase,
                        shop_profit_summary: shopProfitSummary,
                        shop_net_profit_cny: shopProfitSummary?.net_profit_cny ?? 0,
                        shop_purchase_cost_cny: shopProfitSummary?.recognized_cost_cny ?? 0,
                        shop_revenue_cny: shopProfitSummary?.recognized_revenue_cny ?? 0
                    }
                    : {
                        ...financeSummaryBase,
                        shop_profit_summary: shopProfitSummary,
                        shop_net_profit_cny: shopProfitSummary?.net_profit_cny ?? 0,
                        shop_purchase_cost_cny: shopProfitSummary?.recognized_cost_cny ?? 0,
                        shop_revenue_cny: shopProfitSummary?.recognized_revenue_cny ?? 0
                    }
            )
            : undefined;
        const pointsBreakdownTrend = needsFinance
            ? (
                useFinanceAggregate && financeAggregateHasPointsTrend
                    ? normalizePointsBreakdownTrendSeries(financeAggregate?.points_breakdown_trend)
                    : buildPointsBreakdownTrend({
                        pointsLedgerRows: useFinanceAggregate
                            ? (pointsLedgerTrendRows || [])
                            : ((pointsLedgerTrendRows && pointsLedgerTrendRows.length) ? pointsLedgerTrendRows : (pointsLedgerRows || [])),
                        sinceIso,
                        untilIso
                    })
            )
            : undefined;
        const points_breakdown = needsFinance
            ? (
                useFinanceAggregate
                    ? attachPointsBreakdownTrend(financeAggregate?.points_breakdown, pointsBreakdownTrend)
                    : buildPointsBreakdown(pointsLedgerRows || [], pointsBreakdownTrend)
            )
            : undefined;
        const baseBusinessBreakdownTrend = needsFinance
            ? (
                useFinanceAggregate && financeAggregateHasBusinessTrend
                    ? normalizeBusinessBreakdownTrendSeries(financeAggregate?.business_breakdown_trend)
                    : buildBusinessBreakdownTrend({
                        paymentOrders: visibleOrders || [],
                        shopOrders: shopOrders || [],
                        pointsLedgerRows: useFinanceAggregate
                            ? (pointsLedgerTrendRows || [])
                            : ((pointsLedgerTrendRows && pointsLedgerTrendRows.length) ? pointsLedgerTrendRows : (pointsLedgerRows || [])),
                        pointsBalanceRows: pointsBalanceRows || [],
                        sitewideSummary: sitewide_summary,
                        sinceIso,
                        untilIso
                    })
            )
            : undefined;
        const businessBreakdownTrend = needsFinance
            ? attachShopProfitTrend(baseBusinessBreakdownTrend || [], shopProfitTrend)
            : undefined;
        const business_breakdown = needsFinance
            ? (
                useFinanceAggregate
                    ? buildBusinessBreakdownFromFinanceSummary({
                        overview,
                        sitewideSummary: sitewide_summary,
                        trendSeries: businessBreakdownTrend
                    })
                    : buildBusinessBreakdown({
                        paymentOrders: visibleOrders || [],
                        shopOrders: shopOrders || [],
                        balanceRows: pointsBalanceRows || [],
                        sitewideSummary: sitewide_summary,
                        trendSeries: businessBreakdownTrend
                    })
            )
            : undefined;

        if (!isPrefetchRequest && !(view === 'overview' && isOverviewPartialScope)) {
            await writeAdminAuditLog({
                supabase: requestSupabase || scopedClient,
                adminId: user.id,
                actionType: 'payments.summary.view',
                details: {
                    site,
                    days: normalizedDays,
                    startDate: hasCustomRange ? customStartIso : null,
                    endDate: hasCustomRange ? customEndIso : null,
                    view
                }
            });
        }

        return sendJson(res, 200, {
            success: true,
            overview_scope: view === 'overview' ? summaryScope : undefined,
            overview,
            session_summary: sessionSummary,
            query_summary: querySummary,
            anomaly_summary: anomalySummary,
            provider_stats,
            trend_24h,
            sitewide_summary,
            points_breakdown,
            business_breakdown,
            refund_alert_topics: needsEvents ? refundAlertTopics : (isOverviewCoreScope ? null : undefined),
            refund_alert_items: needsEvents ? activeRefundAlertItems : (isOverviewCoreScope ? null : undefined),
            ops_alert_summary: needsOpsAlerts ? opsAlertSummary : (isOverviewCoreScope ? null : undefined),
            ops_alert_items: needsOpsAlerts ? opsAlertItems : (isOverviewCoreScope ? null : undefined),
            exception_topics: visibleExceptionTopics,
            exception_topic_items: displayExceptionTopicItems,
            recent_anomalies: recentAnomalies,
            recent_checkout_sessions: recentCheckoutSessions,
            recent_orders: recentOrders || []
        });
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        return sendJson(res, statusCode, {
            success: false,
            message: error.message || 'Failed to load payment summary'
        });
    }
};
