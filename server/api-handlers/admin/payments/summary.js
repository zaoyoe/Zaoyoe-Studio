const {
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const EVENT_OK_RESULTS = new Set([
    'processed_paid',
    'received',
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
    'admin_refund_failed',
    'admin_refund_reclaim_failed',
    'admin_refund_compensation_failed'
]);

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
    if (!['mock', 'afdian', 'hupijiao'].includes(provider)) return false;

    const metadata = normalizeJsonObject(order.provider_metadata);
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

function buildAnomalyCaseKey(targetType, targetId) {
    return `${String(targetType || '').trim().toLowerCase()}:${String(targetId || '').trim()}`;
}

function isResolvedOpsStatus(status) {
    return ['handled', 'ignored', 'approved', 'rejected'].includes(String(status || '').trim().toLowerCase());
}

function canRefundHupijiaoOrder(item) {
    if (!item) return false;
    if ((item?.type && item.type !== 'order')) return false;
    if (String(item?.provider || '').trim().toLowerCase() !== 'hupijiao') return false;

    const status = String(item?.status || '').trim().toLowerCase();
    if (!['pending_review', 'amount_mismatch', 'paid', 'redeemed'].includes(status)) return false;
    if ((status === 'redeemed' || Boolean(String(item?.claimed_at || '').trim())) && !item?.user_id) return false;

    const metadata = normalizeJsonObject(item?.provider_metadata);
    const refundStatus = String(metadata.refund_status || '').trim().toLowerCase();
    return !['refunded', 'refund_pending'].includes(refundStatus);
}

function getOrderAvailableActions(order) {
    return canRefundHupijiaoOrder(order)
        ? ['refund_hupijiao']
        : [];
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

    if (isResolvedOpsStatus(normalizedStatus)) {
        return ['reopen'];
    }

    if (item?.type === 'query') {
        return [];
    }

    if (item?.type === 'order' && String(item?.status || '').trim().toLowerCase() === 'amount_mismatch') {
        return canRefundHupijiaoOrder(item)
            ? ['approve_amount_mismatch', 'reject_amount_mismatch', 'refund_hupijiao', 'ignore']
            : ['approve_amount_mismatch', 'reject_amount_mismatch', 'ignore'];
    }

    if (item?.type === 'order' && String(item?.status || '').trim().toLowerCase() === 'pending_review') {
        return canRefundHupijiaoOrder(item)
            ? ['approve_review', 'reject_review', 'refund_hupijiao', 'ignore']
            : ['approve_review', 'reject_review', 'ignore'];
    }

    if (canRefundHupijiaoOrder(item)) {
        return ['refund_hupijiao', 'mark_handled', 'ignore', 'request_retry'];
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

function isMissingColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    return error?.code === '42703'
        || error?.code === '42P01'
        || (message.includes('column') && message.includes('does not exist'));
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

async function fetchPaymentOrders(client, sinceIso, untilIso, site) {
    return fetchPagedRows(() => {
        let query = client
            .from('payment_orders')
            .select('id, provider, provider_order_no, package_name, paid_amount, expected_amount, points_amount, status, user_id, created_at, paid_at, claimed_at, site, last_error, sign_verified, amount_verified, provider_metadata')
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false });

        if (untilIso) {
            query = query.lte('created_at', untilIso);
        }
        if (site) {
            query = query.eq('site', site);
        }

        return query;
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
        });
    } catch (error) {
        if (isMissingColumnError(error)) {
            return [];
        }
        throw error;
    }
}

async function fetchOpsAlertJobs(client, sinceIso, untilIso) {
    try {
        return await fetchPagedRows(() => {
            let query = client
                .from('ops_alert_jobs')
                .select('id, alert_type, severity, title, content, payload, channels, remaining_channels, status, attempt_count, max_attempts, next_retry_at, last_attempt_at, delivered_at, last_error, worker_name, created_at, updated_at')
                .gte('created_at', sinceIso)
                .order('created_at', { ascending: false });

            if (untilIso) {
                query = query.lte('created_at', untilIso);
            }

            return query;
        }, 200, 10);
    } catch (error) {
        if (isMissingColumnError(error)) {
            return [];
        }
        throw error;
    }
}

async function fetchAnomalyCasesByTargets(client, anomalies) {
    const groupedIds = {
        order: [],
        event: [],
        session: []
    };

    (anomalies || []).forEach((item) => {
        const type = String(item?.type || '').trim().toLowerCase();
        const id = String(item?.id || '').trim();
        if (!id || !Object.prototype.hasOwnProperty.call(groupedIds, type)) return;
        groupedIds[type].push(id);
    });

    const results = [];

    for (const [targetType, targetIds] of Object.entries(groupedIds)) {
        if (!targetIds.length) continue;

        try {
            const rows = await fetchPagedRows(() => client
                .from('payment_anomaly_cases')
                .select('id, target_type, target_id, status, note, resolution, last_action, last_action_at')
                .eq('target_type', targetType)
                .in('target_id', targetIds)
                .order('updated_at', { ascending: false }));

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
    });
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
        });
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
        items: topicItems
    };
}

function buildExceptionTopics({ orders, events, queryAttempts }) {
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
    const queryFailureItems = buildQueryFailureTopicItems(queryAttempts);
    const refundTopics = buildRefundExceptionTopics(events);

    const topicItems = [
        ...amountMismatchItems.slice(0, 12),
        ...reviewItems.slice(0, 12),
        ...duplicateItems.slice(0, 12),
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
            {
                key: 'query_failures',
                label: '查码失败',
                severity: 'warning',
                description: '追踪钱包查码失败原因，判断是用户误输、订单未落单还是接口异常。',
                count: queryFailureItems.length
            },
            ...(refundTopics.topics || [])
        ].filter((topic) => Number(topic.count || 0) > 0),
        items: topicItems
    };
}

async function fetchShopOrders(client, sinceIso, untilIso, site) {
    const variants = [
        {
            select: 'id, user_id, price_paid, snapshot_product_name, refund_status, created_at, site',
            hasSite: true
        },
        {
            select: 'id, user_id, price_paid, snapshot_product_name, refund_status, created_at',
            hasSite: false
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
            });

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
            });

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
            });

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
        const sessionId = String(metadata.checkout_session_id || '').trim();
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
        const sessionId = linkedSession?.id || metadata.checkout_session_id || null;
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
    const nonRefundedShopOrders = (shopOrders || []).filter((order) => String(order.refund_status || 'none') !== 'refunded');
    const refundedShopOrders = (shopOrders || []).filter((order) => String(order.refund_status || 'none') === 'refunded');

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

function buildPointsBreakdown(ledgerRows) {
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
            net: roundNumber(item.inflow - item.outflow, 1)
        }))
        .sort((left, right) => Math.abs(right.net) - Math.abs(left.net));
}

function buildBusinessBreakdown({ paymentOrders, shopOrders, balanceRows, sitewideSummary }) {
    const mockOrders = (paymentOrders || []).filter((order) => order.provider === 'mock');
    const successfulMockOrders = mockOrders.filter(isSuccessOrder);
    const orderCount = (paymentOrders || []).length;

    return [
        {
            title: '充值收入',
            description: `近期开出的支付订单 ${orderCount} 笔，成功 ${sitewideSummary.recharge_order_count} 笔。`,
            metric: `¥${sitewideSummary.recharge_amount.toLocaleString('zh-CN', { minimumFractionDigits: sitewideSummary.recharge_amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}`,
            meta: `${sitewideSummary.recharge_points.toLocaleString('zh-CN')} 已入账`,
            help: '统计标准支付订单的成功入账金额和对应到账点数。'
        },
        {
            title: '商城消费',
            description: `商城已消费 ${sitewideSummary.shop_order_count} 笔，退款 ${sitewideSummary.refunded_shop_order_count} 笔。`,
            metric: sitewideSummary.shop_points_spent.toLocaleString('zh-CN'),
            meta: sitewideSummary.refunded_shop_points > 0
                ? `已退款 ${sitewideSummary.refunded_shop_points.toLocaleString('zh-CN')}`
                : '当前无退款冲销',
            help: '统计商城订单消耗的点数，不含已退款冲销部分。'
        },
        {
            title: '模拟支付',
            description: '用于临时直到账的充值记录，也会进入标准支付订单。',
            metric: `${successfulMockOrders.length.toLocaleString('zh-CN')} 笔`,
            meta: `${roundNumber(successfulMockOrders.reduce((sum, order) => sum + normalizeNumber(order.points_amount, 0), 0), 1).toLocaleString('zh-CN')} 已入账`,
            help: '用于统计当前启用的模拟充值通道，方便和真实支付分开核对。'
        },
        {
            title: '当前积分存量',
            description: `活跃余额分布在 ${(balanceRows || []).length.toLocaleString('zh-CN')} 个用户/站点账户中。`,
            metric: sitewideSummary.circulating_points.toLocaleString('zh-CN'),
            meta: `付费 ${sitewideSummary.paid_balance.toLocaleString('zh-CN')} · 奖励 ${sitewideSummary.bonus_balance.toLocaleString('zh-CN')}`,
            help: '展示当前仍在用户账户中流通的总余额，以及付费与奖励余额的拆分。'
        }
    ];
}

module.exports = async function handler(req, res) {
    if (!['GET'].includes(req.method)) {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, requestSupabase, user } = await requireAdmin(req);
        const scopedClient = supabase || requestSupabase;
        const site = typeof req.query?.site === 'string' && req.query.site.trim() ? req.query.site.trim() : null;
        const view = ['overview', 'finance', 'ops'].includes(String(req.query?.view || '').trim())
            ? String(req.query.view).trim()
            : 'overview';
        const days = Number.parseInt(req.query?.days, 10);
        const normalizedDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30;
        const customStartIso = parseIsoQueryDate(req.query?.startDate);
        const customEndIso = parseIsoQueryDate(req.query?.endDate);
        const hasCustomRange = Boolean(customStartIso && customEndIso && new Date(customStartIso).getTime() <= new Date(customEndIso).getTime());
        const sinceIso = hasCustomRange ? customStartIso : getIsoDaysAgo(normalizedDays);
        const untilIso = hasCustomRange ? customEndIso : null;
        const trendSinceIso = hasCustomRange ? customStartIso : getIsoHoursAgo(24);
        const needsEvents = view === 'overview' || view === 'ops';
        const needsSessions = view === 'overview' || view === 'ops';
        const needsQueries = view === 'overview' || view === 'ops';
        const needsFinance = view === 'finance';
        const needsOpsAlerts = view === 'overview' || view === 'ops';

        const [
            orderRows,
            eventRows,
            queryRows,
            rawCheckoutSessions,
            rawOpsAlertJobs,
            shopOrders,
            pointsLedgerRows,
            pointsBalanceRows
        ] = await Promise.all([
            fetchPaymentOrders(scopedClient, sinceIso, untilIso, site),
            needsEvents ? fetchPaymentEvents(scopedClient, sinceIso, untilIso) : Promise.resolve([]),
            needsQueries ? fetchPaymentQueryAttempts(scopedClient, sinceIso, untilIso, site) : Promise.resolve([]),
            needsSessions ? fetchCheckoutSessions(scopedClient, sinceIso, untilIso, site) : Promise.resolve([]),
            needsOpsAlerts ? fetchOpsAlertJobs(scopedClient, sinceIso, untilIso) : Promise.resolve([]),
            needsFinance ? fetchShopOrders(scopedClient, sinceIso, untilIso, site) : Promise.resolve([]),
            needsFinance ? fetchPointsLedger(scopedClient, sinceIso, untilIso, site) : Promise.resolve([]),
            needsFinance ? fetchPointsBalances(scopedClient, site) : Promise.resolve([])
        ]);

        const checkoutSessions = needsSessions
            ? mergeCheckoutSessionsWithOrderFallback(orderRows || [], rawCheckoutSessions || [])
            : [];
        const enrichedOrders = enrichPaymentOrdersWithCheckoutSessions(orderRows || [], checkoutSessions || []);
        const visibleOrders = filterVisiblePaymentOrders(enrichedOrders || []);
        const opsAlertJobs = needsOpsAlerts
            ? (rawOpsAlertJobs || []).filter((job) => matchesOpsAlertJobSite(job, site))
            : [];
        const querySummary = needsQueries ? buildQuerySummary(queryRows || []) : undefined;
        const overview = buildOverview(visibleOrders || []);
        const sessionSummary = needsSessions
            ? buildSessionSummary(checkoutSessions || [], visibleOrders || [])
            : undefined;
        const opsAlertSummary = needsOpsAlerts ? buildOpsAlertSummary(opsAlertJobs) : undefined;
        const opsAlertItems = needsOpsAlerts ? buildOpsAlertQueueItems(opsAlertJobs) : [];

        const siteOrderIds = new Set((visibleOrders || []).map((order) => order.id).filter(Boolean));
        const siteOrderNumbers = new Set((visibleOrders || []).map((order) => order.provider_order_no).filter(Boolean));
        const scopedEvents = (eventRows || []).filter((event) => {
            if (!site) return true;
            return (
                (event.payment_order_id && siteOrderIds.has(event.payment_order_id))
                || (event.provider_order_no && siteOrderNumbers.has(event.provider_order_no))
            );
        });
        const scopedTrendEvents = scopedEvents.filter((event) => new Date(event.created_at).getTime() >= new Date(trendSinceIso).getTime());

        const recentOrders = view === 'ops'
            ? (visibleOrders || [])
                .slice(0, 20)
                .map((order) => ({
                    ...order,
                    order_available_actions: getOrderAvailableActions(order)
                }))
            : [];
        const recentOrderAnomalies = view === 'ops'
            ? (visibleOrders || [])
                .filter(isOrderAnomaly)
                .slice(0, 24)
                .map(buildOrderAnomaly)
            : [];

        const duplicateMap = new Map();
        scopedEvents.forEach((event) => {
            const orderNo = String(event.provider_order_no || '').trim();
            if (!orderNo) return;
            duplicateMap.set(orderNo, (duplicateMap.get(orderNo) || 0) + 1);
        });
        const duplicateWebhookOrders = Array.from(duplicateMap.values()).filter((count) => count > 1).length;
        const refundGatewayFailures = scopedEvents.filter((event) => String(event.processing_result || '').trim() === 'admin_refund_failed').length;
        const refundReclaimFailures = scopedEvents.filter((event) => String(event.processing_result || '').trim() === 'admin_refund_reclaim_failed').length;
        const refundCompensationFailures = scopedEvents.filter((event) => String(event.processing_result || '').trim() === 'admin_refund_compensation_failed').length;

        const recentEventAnomalies = needsEvents
            ? scopedEvents
                .filter(isEventAnomaly)
                .slice(0, 24)
                .map(buildEventAnomaly)
            : [];
        const recentSessionAnomalies = view === 'ops'
            ? (checkoutSessions || [])
                .map(buildCheckoutSessionAnomaly)
                .filter(Boolean)
                .slice(0, 24)
            : [];
        const refundAlertSummary = needsEvents
            ? buildRefundExceptionTopics(scopedEvents || [])
            : { topics: [], items: [] };
        const exceptionTopics = view === 'ops'
            ? buildExceptionTopics({
                orders: visibleOrders || [],
                events: scopedEvents || [],
                queryAttempts: queryRows || []
            })
            : { topics: [], items: [] };

        const combinedRecentAnomalies = view === 'ops'
            ? [...recentOrderAnomalies, ...recentEventAnomalies, ...recentSessionAnomalies]
                .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
            : [];
        const anomalyCaseTargets = view === 'ops'
            ? [...combinedRecentAnomalies, ...(exceptionTopics.items || [])]
            : (refundAlertSummary.items || []);
        const anomalyCases = anomalyCaseTargets.length
            ? await fetchAnomalyCasesByTargets(scopedClient, anomalyCaseTargets)
            : [];
        const enrichedRefundAlertItems = needsEvents
            ? enrichAnomaliesWithCases(refundAlertSummary.items || [], anomalyCases)
            : [];
        const enrichedRecentAnomalies = view === 'ops'
            ? enrichAnomaliesWithCases(combinedRecentAnomalies, anomalyCases)
            : [];
        const enrichedExceptionTopicItems = view === 'ops'
            ? enrichAnomaliesWithCases(exceptionTopics.items || [], anomalyCases)
            : [];
        const refundAlertTopics = needsEvents
            ? (refundAlertSummary.topics || []).map((topic) => ({
                ...topic,
                count: enrichedRefundAlertItems.filter((item) => item.topic_key === topic.key).length
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

        const anomalySummary = {
            review_orders: Number(overview.review_orders || 0),
            failed_orders: Number(overview.failed_orders || 0),
            unclaimed_paid_orders: (visibleOrders || []).filter((order) => order.status === 'paid' && !order.user_id).length,
            recent_event_anomalies: recentEventAnomalies.length,
            duplicate_webhook_orders: duplicateWebhookOrders,
            refund_failures: refundGatewayFailures,
            refund_reclaim_failures: refundReclaimFailures,
            refund_compensation_failures: refundCompensationFailures,
            query_failures: Number(querySummary?.failed_attempts || 0),
            stale_checkout_sessions: Number(sessionSummary?.stale_sessions || 0),
            failed_checkout_sessions: Number(sessionSummary?.failed_sessions || 0),
            completed_unlinked_sessions: Number(sessionSummary?.completed_unlinked_sessions || 0),
            unmatched_session_orders: Number(sessionSummary?.unmatched_orders || 0),
            webhook_linked_sessions: Number(sessionSummary?.webhook_linked_sessions || 0),
            fallback_linked_sessions: Number(sessionSummary?.fallback_linked_sessions || 0),
            session_anomalies: Number(sessionSummary?.anomaly_count || 0),
            open_cases: openAnomalyCount,
            handled_cases: handledCaseCount,
            ignored_cases: ignoredCaseCount,
            retry_requested_cases: retryRequestedCaseCount
        };

        const provider_stats = buildProviderStats(visibleOrders || [], checkoutSessions || [], scopedEvents || [], queryRows || []);
        const trend_24h = view === 'overview' ? buildTrend24h(scopedTrendEvents) : undefined;
        const sitewide_summary = needsFinance
            ? buildFinanceSummary(visibleOrders || [], shopOrders || [], pointsLedgerRows || [], pointsBalanceRows || [])
            : undefined;
        const points_breakdown = needsFinance ? buildPointsBreakdown(pointsLedgerRows || []) : undefined;
        const business_breakdown = needsFinance
            ? buildBusinessBreakdown({
                paymentOrders: visibleOrders || [],
                shopOrders: shopOrders || [],
                balanceRows: pointsBalanceRows || [],
                sitewideSummary: sitewide_summary
            })
            : undefined;

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

        return sendJson(res, 200, {
            success: true,
            overview,
            session_summary: sessionSummary,
            query_summary: querySummary,
            anomaly_summary: anomalySummary,
            provider_stats,
            trend_24h,
            sitewide_summary,
            points_breakdown,
            business_breakdown,
            refund_alert_topics: needsEvents ? refundAlertTopics : undefined,
            refund_alert_items: needsEvents ? enrichedRefundAlertItems : undefined,
            ops_alert_summary: needsOpsAlerts ? opsAlertSummary : undefined,
            ops_alert_items: needsOpsAlerts ? opsAlertItems : undefined,
            exception_topics: exceptionTopics.topics || [],
            exception_topic_items: enrichedExceptionTopicItems,
            recent_anomalies: recentAnomalies,
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
