const crypto = require('crypto');
const {
    requireAdmin,
    parseJsonBody,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    notifyActiveAdmins
} = require('../../../../api/_lib/admin-notifications');
const {
    enqueueOpsAlertJob
} = require('../../../../api/_lib/ops-alerts');
const {
    applyPaymentOrderReview,
    deductPointsForRefundReclaim,
    getUserBalance,
    rechargePointsForPayment
} = require('../../../../api/_lib/payments/rpc');
const {
    amountsMatch,
    getPaymentProviderAdapter,
    roundCurrencyAmount
} = require('../../../../api/_lib/payments/provider-adapters');
const {
    reconcileCheckoutSessionForPaymentOrder
} = require('../../../../api/_lib/payments/orders');
const {
    maybeIssueAffiliateDiscountAssetsForRecharge,
    maybeIssueRechargeDiscountAssets
} = require('../../../../api/_lib/discount-trigger-linkage');
const {
    deriveHupijiaoPointBreakdown
} = require('../../../../api/_lib/payments/hupijiao-points');
const {
    deriveZpayPointBreakdown
} = require('../../../../api/_lib/payments/zpay-points');

const VALID_TARGET_TYPES = new Set(['order', 'event', 'session', 'ops_alert_job']);
const VALID_ACTIONS = new Set([
    'mark_handled',
    'ignore',
    'request_retry',
    'reopen',
    'approve_review',
    'reject_review',
    'approve_amount_mismatch',
    'reject_amount_mismatch',
    'refund_hupijiao',
    'query_hupijiao_order',
    'reconcile_hupijiao_order',
    'refund_zpay',
    'query_zpay_order',
    'reconcile_zpay_order'
]);
const NOTE_REQUIRED_ACTIONS = new Set([
    'approve_review',
    'reject_review',
    'approve_amount_mismatch',
    'reject_amount_mismatch',
    'refund_hupijiao',
    'reconcile_hupijiao_order',
    'refund_zpay',
    'reconcile_zpay_order'
]);
const ORDER_ONLY_ACTIONS = new Set([
    'query_hupijiao_order',
    'reconcile_hupijiao_order',
    'refund_hupijiao',
    'query_zpay_order',
    'reconcile_zpay_order',
    'refund_zpay'
]);
const SENSITIVE_REVIEW_ACTIONS = new Set([
    'approve_review',
    'reject_review',
    'approve_amount_mismatch',
    'reject_amount_mismatch'
]);
const REFUNDABLE_GATEWAY_STATUSES = new Set([
    'pending_review',
    'amount_mismatch',
    'paid',
    'redeemed'
]);
const RECONCILABLE_GATEWAY_STATUSES = new Set([
    'pending',
    'pending_review',
    'amount_mismatch'
]);
const GATEWAY_PROVIDER_META = Object.freeze({
    hupijiao: Object.freeze({
        key: 'hupijiao',
        label: '虎皮椒',
        queryAction: 'query_hupijiao_order',
        reconcileAction: 'reconcile_hupijiao_order',
        refundAction: 'refund_hupijiao',
        paidStatusRaw: 'OD',
        refundStatusRaw: 'CD',
        pointBreakdown: deriveHupijiaoPointBreakdown
    }),
    zpay: Object.freeze({
        key: 'zpay',
        label: '易支付',
        queryAction: 'query_zpay_order',
        reconcileAction: 'reconcile_zpay_order',
        refundAction: 'refund_zpay',
        paidStatusRaw: 'TRADE_SUCCESS',
        refundStatusRaw: 'REFUNDED',
        pointBreakdown: deriveZpayPointBreakdown
    })
});
const GATEWAY_ACTION_PROVIDER_MAP = Object.freeze({
    query_hupijiao_order: 'hupijiao',
    reconcile_hupijiao_order: 'hupijiao',
    refund_hupijiao: 'hupijiao',
    query_zpay_order: 'zpay',
    reconcile_zpay_order: 'zpay',
    refund_zpay: 'zpay'
});
const REFUND_ALERT_CONFIG = Object.freeze({
    admin_refund_failed: {
        title: '支付退款失败（已补回）',
        type: 'warning',
        severity: 'warning',
        topicLabel: '退款失败',
        detail: '网关退款失败，但系统已自动补回积分，请尽快复核通道状态并确认是否需要人工跟进。'
    },
    admin_refund_reclaim_failed: {
        title: '支付退款积分扣回失败',
        type: 'alert',
        severity: 'critical',
        topicLabel: '扣回失败',
        detail: '已入账订单在退款前无法安全扣回积分，系统已停止继续退款，请先处理余额或扣回链路。'
    },
    admin_refund_compensation_failed: {
        title: '支付退款积分回滚失败',
        type: 'alert',
        severity: 'critical',
        topicLabel: '回滚失败',
        detail: '网关退款失败后，系统自动补回积分也失败了，需要立即人工核对账务并修复。'
    }
});
const DECIMAL_REFUND_RECLAIM_MIGRATION = '20260418_enable_decimal_refund_reclaim_rpc.sql';

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

function mergeJsonObjects(...values) {
    return values.reduce((result, value) => ({
        ...result,
        ...normalizeJsonObject(value)
    }), {});
}

function normalizePointAmount(value, fallback = 0) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.max(0, Math.round(numericValue * 100) / 100);
}

function getGatewayProviderMeta(providerKey = '') {
    return GATEWAY_PROVIDER_META[normalizeText(providerKey).toLowerCase()] || null;
}

function getGatewayProviderKeyForAction(action = '') {
    return GATEWAY_ACTION_PROVIDER_MAP[normalizeText(action).toLowerCase()] || '';
}

function getGatewayProviderLabel(providerKey = '') {
    return getGatewayProviderMeta(providerKey)?.label || '支付通道';
}

function getBalanceTotal(balanceData = {}) {
    const totalBalance = Number(balanceData?.total_balance);
    if (Number.isFinite(totalBalance)) {
        return normalizePointAmount(totalBalance, 0);
    }

    return normalizePointAmount(
        Number(balanceData?.paid_balance || 0) + Number(balanceData?.bonus_balance || 0),
        0
    );
}

function mapActionToStatus(action) {
    switch (action) {
    case 'mark_handled':
    case 'refund_hupijiao':
    case 'refund_zpay':
    case 'reconcile_hupijiao_order':
    case 'reconcile_zpay_order':
        return 'handled';
    case 'ignore':
        return 'ignored';
    case 'request_retry':
        return 'retry_requested';
    case 'approve_review':
    case 'approve_amount_mismatch':
        return 'approved';
    case 'reject_review':
    case 'reject_amount_mismatch':
        return 'rejected';
    case 'reopen':
    default:
        return 'open';
    }
}

function getResolutionText(action, note) {
    const trimmedNote = normalizeText(note);
    if (trimmedNote) return trimmedNote;
    const gatewayProviderKey = getGatewayProviderKeyForAction(action);
    const gatewayLabel = getGatewayProviderLabel(gatewayProviderKey);

    switch (action) {
    case 'mark_handled':
        return '已人工确认并标记处理完成。';
    case 'ignore':
        return '该异常已人工忽略。';
    case 'request_retry':
        return '已登记重试申请，等待后续履约链路接管。';
    case 'approve_review':
        return '已人工审核通过。';
    case 'approve_amount_mismatch':
        return '已人工放行金额异常订单。';
    case 'reject_review':
        return '已人工审核驳回。';
    case 'reject_amount_mismatch':
        return '已人工驳回金额异常订单。';
    case 'refund_hupijiao':
    case 'refund_zpay':
        return `已通过后台执行${gatewayLabel}退款。`;
    case 'reconcile_hupijiao_order':
    case 'reconcile_zpay_order':
        return `已根据${gatewayLabel}实时查单结果完成人工补单。`;
    case 'reopen':
        return '已重新打开异常项。';
    default:
        return '';
    }
}

function normalizeStringArray(value) {
    return Array.isArray(value)
        ? value.map((item) => normalizeText(item)).filter(Boolean)
        : [];
}

async function updateOpsAlertJob(supabase, jobId, patch) {
    const { data, error } = await supabase
        .from('ops_alert_jobs')
        .update({
            ...patch,
            updated_at: new Date().toISOString()
        })
        .eq('id', jobId)
        .select('*')
        .single();

    if (error) throw error;
    return data;
}

async function applyOpsAlertJobAction(supabase, target, action, note) {
    const status = normalizeText(target?.status).toLowerCase();
    const payload = normalizeJsonObject(target?.payload);
    const channels = normalizeStringArray(target?.channels);
    const remainingChannels = normalizeStringArray(target?.remaining_channels);
    const nowIso = new Date().toISOString();

    if (!['request_retry', 'mark_handled', 'ignore', 'reopen'].includes(action)) {
        const error = new Error('该操作不适用于站外告警任务');
        error.statusCode = 400;
        throw error;
    }

    if (action === 'request_retry') {
        if (status !== 'dead_letter') {
            const error = new Error('只有死信状态的站外告警才能人工重试');
            error.statusCode = 409;
            throw error;
        }

        const retryChannels = remainingChannels.length ? remainingChannels : channels;
        if (!retryChannels.length) {
            const error = new Error('该站外告警缺少可重试通道，无法重新投递');
            error.statusCode = 409;
            throw error;
        }

        const job = await updateOpsAlertJob(supabase, target.id, {
            status: 'retry',
            remaining_channels: retryChannels,
            next_retry_at: nowIso,
            delivered_at: null,
            last_attempt_at: null,
            last_error: null,
            worker_name: null,
            attempt_count: 0
        });

        return {
            job,
            resolution: normalizeText(note) || '已人工重新加入站外告警重试队列。',
            auditDetails: {
                queue_previous_status: status,
                queue_next_status: 'retry',
                queue_channel_count: retryChannels.length,
                provider_order_no: normalizeText(payload.provider_order_no) || null,
                site: normalizeText(payload.site).toLowerCase() || null
            }
        };
    }

    if (action === 'mark_handled') {
        const job = await updateOpsAlertJob(supabase, target.id, {
            status: 'handled',
            next_retry_at: null,
            worker_name: null
        });

        return {
            job,
            resolution: normalizeText(note) || '已人工确认并结束该站外告警。',
            auditDetails: {
                queue_previous_status: status,
                queue_next_status: 'handled',
                provider_order_no: normalizeText(payload.provider_order_no) || null,
                site: normalizeText(payload.site).toLowerCase() || null
            }
        };
    }

    if (action === 'ignore') {
        const job = await updateOpsAlertJob(supabase, target.id, {
            status: 'ignored',
            next_retry_at: null,
            worker_name: null
        });

        return {
            job,
            resolution: normalizeText(note) || '已人工忽略该站外告警。',
            auditDetails: {
                queue_previous_status: status,
                queue_next_status: 'ignored',
                provider_order_no: normalizeText(payload.provider_order_no) || null,
                site: normalizeText(payload.site).toLowerCase() || null
            }
        };
    }

    if (!['handled', 'ignored'].includes(status)) {
        const error = new Error('只有已处理或已忽略的站外告警才能重新打开');
        error.statusCode = 409;
        throw error;
    }

    const job = await updateOpsAlertJob(supabase, target.id, {
        status: 'dead_letter',
        next_retry_at: null,
        worker_name: null
    });

    return {
        job,
        resolution: normalizeText(note) || '已重新打开该站外告警，等待人工决定是否重试。',
        auditDetails: {
            queue_previous_status: status,
            queue_next_status: 'dead_letter',
            provider_order_no: normalizeText(payload.provider_order_no) || null,
            site: normalizeText(payload.site).toLowerCase() || null
        }
    };
}

async function fetchTargetRecord(supabase, targetType, targetId) {
    if (targetType === 'order') {
        const { data, error } = await supabase
            .from('payment_orders')
            .select('id, user_id, provider, provider_order_no, checkout_session_id, package_id, package_name, site, expected_amount, paid_amount, points_amount, status, claimed_at, paid_at, verified_at, sign_verified, amount_verified, created_at, last_error, provider_metadata, raw_payload')
            .eq('id', targetId)
            .single();
        if (error) throw error;
        return data;
    }

    if (targetType === 'event') {
        const { data, error } = await supabase
            .from('payment_events')
            .select('id, provider, provider_order_no, processing_result, error_message')
            .eq('id', targetId)
            .single();
        if (error) throw error;
        return data;
    }

    if (targetType === 'ops_alert_job') {
        const { data, error } = await supabase
            .from('ops_alert_jobs')
            .select('id, alert_type, severity, title, content, payload, channels, remaining_channels, status, attempt_count, max_attempts, next_retry_at, last_attempt_at, delivered_at, last_error, worker_name, created_at, updated_at')
            .eq('id', targetId)
            .single();
        if (error) throw error;
        return data;
    }

    const { data, error } = await supabase
        .from('payment_checkout_sessions')
        .select('id, provider, session_key, provider_metadata, status, error_message, payment_order_id')
        .eq('id', targetId)
        .single();
    if (error) throw error;
    return data;
}

function normalizeReviewRpcAction(action) {
    if (action === 'approve_review' || action === 'approve_amount_mismatch') {
        return 'approve';
    }
    return 'reject';
}

async function applyOrderReviewDecision(supabase, target, action, note, actorId) {
    const status = normalizeText(target.status).toLowerCase();
    const expectsPendingReview = action === 'approve_review' || action === 'reject_review';
    const expectedStatus = expectsPendingReview ? 'pending_review' : 'amount_mismatch';

    if (status !== expectedStatus) {
        const error = new Error(`Only ${expectedStatus} orders can use this review action`);
        error.statusCode = 409;
        throw error;
    }

    const { data, error } = await applyPaymentOrderReview({
        supabase,
        paymentOrderId: target.id,
        action: normalizeReviewRpcAction(action),
        note: normalizeText(note) || null,
        actorId: actorId || null
    });

    if (error) {
        const reviewError = new Error(error.message || 'Failed to apply payment review');
        reviewError.statusCode = /only pending_review|only amount_mismatch|only pending_review or amount_mismatch/i.test(error.message || '')
            ? 409
            : 400;
        throw reviewError;
    }

    return data;
}

async function upsertAnomalyCase(supabase, {
    targetType,
    targetId,
    targetProvider,
    targetProviderOrderNo,
    status,
    note,
    resolution,
    action,
    actorId
}) {
    const payload = {
        target_type: targetType,
        target_id: targetId,
        target_provider: targetProvider || null,
        target_provider_order_no: targetProviderOrderNo || null,
        status,
        note: normalizeText(note) || null,
        resolution: normalizeText(resolution) || null,
        last_action: action,
        last_action_by: actorId,
        last_action_at: new Date().toISOString(),
        metadata: {
            updated_via: 'admin_payments_actions'
        }
    };

    const { data, error } = await supabase
        .from('payment_anomaly_cases')
        .upsert(payload, {
            onConflict: 'target_type,target_id'
        })
        .select('*')
        .single();

    if (error) throw error;
    return data;
}

function buildAdminReconcileEventKey(targetId, providerOrderNo, actorId, providerKey = 'hupijiao') {
    const meta = getGatewayProviderMeta(providerKey);
    const digest = crypto
        .createHash('sha256')
        .update([
            String(targetId || '').trim(),
            String(providerOrderNo || '').trim(),
            String(actorId || '').trim(),
            String(meta?.key || '').trim(),
            new Date().toISOString()
        ].join(':'))
        .digest('hex')
        .slice(0, 24);

    return `admin-reconcile:${meta?.key || 'payment'}:${digest}`;
}

function buildRechargeReferenceId(providerOrderNo = '', providerKey = 'hupijiao') {
    const normalizedProviderOrderNo = normalizeText(providerOrderNo).slice(0, 140);
    const meta = getGatewayProviderMeta(providerKey);
    return normalizedProviderOrderNo ? `${meta?.key || 'payment'}_${normalizedProviderOrderNo}` : '';
}

function formatAdminCurrencyAmount(value) {
    const amount = roundCurrencyAmount(value);
    const digits = Number.isInteger(amount) ? 0 : 2;
    return `¥${amount.toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: 2
    })}`;
}

function getPaymentStatusLabel(status = '') {
    const map = {
        pending: '待支付',
        paid: '已支付',
        redeemed: '已入账',
        refunded: '已退款',
        refund_pending: '退款处理中',
        amount_mismatch: '金额异常',
        pending_review: '待审核',
        rejected: '已拒绝',
        unknown: '未知状态'
    };
    return map[String(status || '').trim().toLowerCase()] || (String(status || '').trim() || '未知状态');
}

function getGatewayTransactionId(snapshot = {}, liveOrder = {}) {
    return normalizeText(
        liveOrder.tradeNo
        || liveOrder.transactionId
        || snapshot.tradeNo
    ) || null;
}

function buildGatewayLiveOrderMessage(providerKey, liveOrder = {}) {
    const parts = [`${getGatewayProviderLabel(providerKey)}实时状态：${getPaymentStatusLabel(liveOrder.status)}`];
    if (roundCurrencyAmount(liveOrder.paidAmount) > 0) {
        parts.push(`实付 ${formatAdminCurrencyAmount(liveOrder.paidAmount)}`);
    }
    const transactionId = getGatewayTransactionId({}, liveOrder);
    if (transactionId) {
        parts.push(`流水号 ${transactionId}`);
    }
    return `${parts.join('，')}。`;
}

async function queryGatewayOrder(supabase, target, providerKey, env = process.env) {
    const meta = getGatewayProviderMeta(providerKey);
    if (!meta) {
        const error = new Error('当前支付通道暂不支持后台查单');
        error.statusCode = 400;
        throw error;
    }

    const provider = normalizeText(target?.provider).toLowerCase();
    if (provider !== meta.key) {
        const error = new Error(`当前只支持对${meta.label}订单执行实时查单`);
        error.statusCode = 400;
        throw error;
    }

    const snapshot = getGatewayRefundSnapshot(target, meta.key);
    if (!snapshot.providerOrderNo && !snapshot.openOrderId && !snapshot.tradeNo) {
        const error = new Error(`缺少${meta.label}订单号，暂时无法发起实时查单`);
        error.statusCode = 400;
        throw error;
    }

    const adapter = getPaymentProviderAdapter(meta.key);
    if (!adapter || typeof adapter.resolveRuntimeContext !== 'function' || typeof adapter.queryOrder !== 'function') {
        const error = new Error(`${meta.label}查单适配器尚未完成接入`);
        error.statusCode = 503;
        throw error;
    }

    const runtimeContext = await adapter.resolveRuntimeContext({
        supabase,
        env
    });
    const liveOrder = await adapter.queryOrder({
        runtimeContext,
        providerOrderNo: snapshot.providerOrderNo,
        openOrderId: snapshot.openOrderId,
        tradeNo: snapshot.tradeNo
    });

    if (liveOrder?.supported === false) {
        const error = new Error(liveOrder.message || `${meta.label}查单能力当前不可用`);
        error.statusCode = 503;
        throw error;
    }

    if (liveOrder?.success === false) {
        const error = new Error(liveOrder.message || `${meta.label}查单失败`);
        error.statusCode = 502;
        throw error;
    }

    return {
        snapshot,
        liveOrder: {
            ...liveOrder,
            paidAmount: roundCurrencyAmount(liveOrder?.paidAmount)
        }
    };
}

async function applyGatewayOrderQuery(supabase, target, actorId, env = process.env, providerKey = '') {
    const meta = getGatewayProviderMeta(providerKey);
    const { snapshot, liveOrder } = await queryGatewayOrder(supabase, target, meta?.key, env);
    const transactionId = getGatewayTransactionId(snapshot, liveOrder);
    const liveStatus = normalizeText(liveOrder.status).toLowerCase();

    if (liveStatus === 'refunded') {
        const targetStatus = normalizeText(target?.status).toLowerCase();
        if (targetStatus !== 'refunded') {
            const attemptId = buildAdminRefundAttemptId(
                target.id,
                liveOrder.providerOrderNo || snapshot.providerOrderNo,
                actorId,
                meta.key
            );
            let reclaimSummary = null;

            if (snapshot.credited) {
                try {
                    reclaimSummary = await reclaimCreditedGatewayPoints(supabase, target, attemptId, meta.key);
                } catch (reclaimError) {
                    await tryRecordPaymentEvent(supabase, {
                        payment_order_id: target.id,
                        provider: meta.key,
                        provider_order_no: liveOrder.providerOrderNo || snapshot.providerOrderNo || null,
                        event_key: buildAdminRefundEventKey(target.id, liveOrder.providerOrderNo || snapshot.providerOrderNo, actorId, meta.key),
                        event_type: 'admin_refund',
                        signature_valid: true,
                        amount_valid: null,
                        payload: {
                            action: meta.queryAction,
                            source: 'gateway_query_sync',
                            query: liveOrder,
                            reclaim: reclaimError?.reclaimDetails || null,
                            note: '后台实时查单确认外部已退款'
                        },
                        processing_result: 'admin_refund_reclaim_failed',
                        error_message: reclaimError.message || `${meta.label}退款积分扣回失败`,
                        response_status: reclaimError?.statusCode || 409,
                        processed_at: new Date().toISOString()
                    });
                    await tryNotifyRefundOpsAlert(supabase, target, 'admin_refund_reclaim_failed', {
                        note: '后台实时查单确认外部已退款',
                        failureMessage: reclaimError.message,
                        responseStatus: reclaimError?.statusCode || 409,
                        liveOrder,
                        reclaimDetails: reclaimError?.reclaimDetails || null
                    });
                    throw reclaimError;
                }
            }

            const syncedOrder = await syncRefundedPaymentOrder(supabase, target, {
                actorId,
                note: '后台实时查单确认外部已退款，系统自动同步本地状态。',
                providerOrderNo: liveOrder.providerOrderNo || snapshot.providerOrderNo,
                openOrderId: liveOrder.openOrderId || snapshot.openOrderId,
                tradeNo: transactionId,
                refundStatus: 'refunded',
                refundStatusRaw: liveOrder.statusRaw || meta.refundStatusRaw,
                refundSource: 'gateway_query_sync',
                payload: {
                    query: liveOrder
                },
                reclaimSummary,
                providerKey: meta.key
            });

            await tryRecordPaymentEvent(supabase, {
                payment_order_id: target.id,
                provider: meta.key,
                provider_order_no: liveOrder.providerOrderNo || snapshot.providerOrderNo || null,
                event_key: buildAdminRefundEventKey(target.id, liveOrder.providerOrderNo || snapshot.providerOrderNo, actorId, meta.key),
                event_type: 'admin_refund',
                signature_valid: true,
                amount_valid: null,
                payload: {
                    action: meta.queryAction,
                    source: 'gateway_query_sync',
                    query: liveOrder,
                    reclaim: reclaimSummary,
                    note: '后台实时查单确认外部已退款'
                },
                processing_result: 'admin_refund_synced_refunded',
                response_status: 200,
                processed_at: new Date().toISOString()
            });

            return {
                liveOrder,
                order: syncedOrder,
                reload: true,
                message: `${buildGatewayLiveOrderMessage(meta.key, liveOrder).replace(/。$/, '')}，已同步本地退款状态。`,
                auditDetails: {
                    query_provider: meta.key,
                    query_status: liveStatus,
                    query_status_raw: normalizeText(liveOrder.statusRaw) || null,
                    query_paid_amount: roundCurrencyAmount(liveOrder.paidAmount),
                    provider_order_no: liveOrder.providerOrderNo || snapshot.providerOrderNo || null,
                    gateway_open_order_id: liveOrder.openOrderId || snapshot.openOrderId || null,
                    gateway_transaction_id: transactionId,
                    query_actor_id: actorId || null,
                    refund_status: 'refunded',
                    refund_source: 'gateway_query_sync',
                    refund_reclaimed_points: reclaimSummary?.reclaimedPoints || 0,
                    refund_reclaimed_paid_points: reclaimSummary?.reclaimedPaidPoints || 0,
                    refund_reclaimed_bonus_points: reclaimSummary?.reclaimedBonusPoints || 0
                }
            };
        }
    }

    return {
        liveOrder,
        reload: false,
        message: buildGatewayLiveOrderMessage(meta.key, liveOrder),
        auditDetails: {
            query_provider: meta.key,
            query_status: liveStatus || null,
            query_status_raw: normalizeText(liveOrder.statusRaw) || null,
            query_paid_amount: roundCurrencyAmount(liveOrder.paidAmount),
            provider_order_no: liveOrder.providerOrderNo || snapshot.providerOrderNo || null,
            gateway_open_order_id: liveOrder.openOrderId || snapshot.openOrderId || null,
            gateway_transaction_id: transactionId,
            query_actor_id: actorId || null
        }
    };
}

async function applyGatewayReconcileDecision(supabase, target, note, actorId, env = process.env, providerKey = '') {
    const meta = getGatewayProviderMeta(providerKey);
    const normalizedStatus = normalizeText(target?.status).toLowerCase();
    if (!RECONCILABLE_GATEWAY_STATUSES.has(normalizedStatus)) {
        const error = new Error('当前订单状态不适合执行人工补单');
        error.statusCode = 409;
        throw error;
    }

    const normalizedUserId = normalizeText(target?.user_id);
    if (!normalizedUserId) {
        const error = new Error('该订单尚未绑定用户，暂时不能人工补单，请先完成认领或关联用户');
        error.statusCode = 409;
        throw error;
    }

    const { snapshot, liveOrder } = await queryGatewayOrder(supabase, target, meta?.key, env);
    const liveStatus = normalizeText(liveOrder.status).toLowerCase();
    if (liveStatus !== 'paid') {
        const error = new Error(`${meta.label}实时状态为${getPaymentStatusLabel(liveStatus)}，暂时不能执行人工补单`);
        error.statusCode = 409;
        throw error;
    }

    const expectedAmount = roundCurrencyAmount(target?.expected_amount);
    if (!(expectedAmount > 0)) {
        const error = new Error('本地订单缺少有效的期望金额，暂时无法安全补单');
        error.statusCode = 409;
        throw error;
    }

    const livePaidAmount = roundCurrencyAmount(liveOrder.paidAmount);
    if (!(livePaidAmount > 0)) {
        const error = new Error(`${meta.label}查单未返回实付金额，暂时无法安全补单`);
        error.statusCode = 502;
        throw error;
    }

    if (!amountsMatch(expectedAmount, livePaidAmount)) {
        const error = new Error(`${meta.label}实时金额为 ${formatAdminCurrencyAmount(livePaidAmount)}，与本地期望金额 ${formatAdminCurrencyAmount(expectedAmount)} 不一致，已停止补单`);
        error.statusCode = 409;
        throw error;
    }

    const resolvedProviderOrderNo = liveOrder.providerOrderNo || snapshot.providerOrderNo || target.provider_order_no;
    const transactionId = getGatewayTransactionId(snapshot, liveOrder);
    const attemptId = buildAdminRefundAttemptId(target.id, resolvedProviderOrderNo, actorId, meta.key);
    const rechargeReferenceId = buildRechargeReferenceId(resolvedProviderOrderNo, meta.key);
    const providerMetadata = normalizeJsonObject(target.provider_metadata);
    const rechargeBreakdown = meta.pointBreakdown(target, providerMetadata);
    const nowIso = new Date().toISOString();

    const { error: rechargeError } = await rechargePointsForPayment({
        supabase,
        userId: normalizedUserId,
        paidPoints: normalizePointAmount(rechargeBreakdown.paidPoints, 0),
        bonusPoints: normalizePointAmount(rechargeBreakdown.bonusPoints, 0),
        reason: `${meta.label}补单: ${normalizeText(target.package_name) || normalizeText(target.provider_order_no) || '充值订单'}`,
        referenceId: rechargeReferenceId || `${meta.key}_${attemptId}`,
        site: target.site || 'cn'
    });

    if (rechargeError) {
        const error = new Error(rechargeError.message || '人工补单入账失败');
        error.statusCode = 502;
        throw error;
    }

    const nextProviderMetadata = mergeJsonObjects(providerMetadata, {
        provider_order_no: resolvedProviderOrderNo || null,
        gateway_open_order_id: liveOrder.openOrderId || snapshot.openOrderId || providerMetadata.gateway_open_order_id || null,
        transaction_id: transactionId || providerMetadata.transaction_id || providerMetadata.trade_no || null,
        trade_no: transactionId || providerMetadata.trade_no || providerMetadata.transaction_id || null,
        payment_status: 'paid',
        payment_status_raw: normalizeText(liveOrder.statusRaw) || providerMetadata.payment_status_raw || meta.paidStatusRaw,
        admin_reconciled_at: nowIso,
        admin_reconciled_by: actorId || null,
        admin_reconcile_note: normalizeText(note) || null
    });
    const nextRawPayload = mergeJsonObjects(normalizeJsonObject(target.raw_payload), {
        admin_reconcile: {
            reconciled_at: nowIso,
            reconciled_by: actorId || null,
            note: normalizeText(note) || null,
            live_order: liveOrder,
            recharge_reference_id: rechargeReferenceId || null
        }
    });

    const { data: reconciledOrder, error: orderUpdateError } = await supabase
        .from('payment_orders')
        .update({
            status: 'redeemed',
            sign_verified: true,
            amount_verified: true,
            paid_amount: livePaidAmount,
            expected_amount: expectedAmount,
            paid_at: target.paid_at || nowIso,
            verified_at: target.verified_at || nowIso,
            claimed_at: target.claimed_at || nowIso,
            last_error: null,
            provider_metadata: nextProviderMetadata,
            raw_payload: nextRawPayload
        })
        .eq('id', target.id)
        .select('*')
        .single();

    if (orderUpdateError) {
        const error = new Error(orderUpdateError.message || '更新人工补单后的支付订单失败');
        error.statusCode = 500;
        throw error;
    }

    let linkedSession = null;
    try {
        linkedSession = await reconcileCheckoutSessionForPaymentOrder({
            supabase,
            providerKey: meta.key,
            paymentOrderId: reconciledOrder.id,
            providerOrderNo: resolvedProviderOrderNo,
            userId: reconciledOrder.user_id,
            site: reconciledOrder.site || target.site || 'cn',
            packageId: reconciledOrder.package_id || target.package_id,
            packageName: reconciledOrder.package_name || target.package_name,
            expectedAmount,
            paidAmount: livePaidAmount,
            pointsAmount: reconciledOrder.points_amount || target.points_amount || 0,
            orderStatus: 'redeemed',
            linkedBy: `admin_${meta.key}_reconcile`,
            allowHeuristic: true,
            lookbackMinutes: 1440
        });
    } catch (linkError) {
        console.warn('[admin/payments/actions] failed to reconcile checkout session after admin reconcile:', linkError.message);
    }

    const linkedDiscountSummary = await maybeIssueRechargeDiscountAssets({
        supabase,
        userId: reconciledOrder.user_id,
        site: reconciledOrder.site || target.site || 'cn',
        paidPoints: normalizePointAmount(rechargeBreakdown.paidPoints, 0),
        bonusPoints: normalizePointAmount(rechargeBreakdown.bonusPoints, 0),
        paidAmount: livePaidAmount,
        paymentOrderId: reconciledOrder.id,
        paymentProvider: meta.key,
        paymentOrderNo: resolvedProviderOrderNo
    });
    const linkedAffiliateDiscountSummary = await maybeIssueAffiliateDiscountAssetsForRecharge({
        supabase,
        site: reconciledOrder.site || target.site || 'cn',
        rechargeReferenceId: rechargeReferenceId || ''
    });

    await tryRecordPaymentEvent(supabase, {
        payment_order_id: reconciledOrder.id,
        provider: meta.key,
        provider_order_no: resolvedProviderOrderNo || null,
        event_key: buildAdminReconcileEventKey(reconciledOrder.id, resolvedProviderOrderNo, actorId, meta.key),
        event_type: 'admin_reconcile',
        signature_valid: true,
        amount_valid: true,
        payload: {
            action: meta.reconcileAction,
            source: 'admin_action',
            query: liveOrder,
            note: note || null,
            checkout_session_id: linkedSession?.id || null,
            linked_discount_summary: linkedDiscountSummary,
            linked_affiliate_discount_summary: linkedAffiliateDiscountSummary
        },
        processing_result: 'admin_reconcile_processed',
        response_status: 200,
        processed_at: nowIso
    });

    return {
        order: reconciledOrder,
        anomalyStatus: 'handled',
        resolution: normalizeText(note) || `已根据${meta.label}实时查单结果完成人工补单。`,
        message: `${buildGatewayLiveOrderMessage(meta.key, liveOrder)} 后台已完成补单并同步入账。`,
        auditDetails: {
            reconcile_provider: meta.key,
            reconcile_status: 'processed',
            reconcile_paid_amount: livePaidAmount,
            provider_order_no: resolvedProviderOrderNo || null,
            gateway_open_order_id: liveOrder.openOrderId || snapshot.openOrderId || null,
            gateway_transaction_id: transactionId,
            recharge_reference_id: rechargeReferenceId || null,
            recharge_paid_points: normalizePointAmount(rechargeBreakdown.paidPoints, 0),
            recharge_bonus_points: normalizePointAmount(rechargeBreakdown.bonusPoints, 0),
            checkout_session_id: linkedSession?.id || null,
            linked_discount_count: normalizePointAmount(linkedDiscountSummary?.issued_count, 0),
            linked_affiliate_discount_count: normalizePointAmount(linkedAffiliateDiscountSummary?.issued_count, 0)
        },
        liveOrder
    };
}

function buildHupijiaoLiveOrderMessage(liveOrder = {}) {
    return buildGatewayLiveOrderMessage('hupijiao', liveOrder);
}

async function queryHupijiaoGatewayOrder(supabase, target, env = process.env) {
    return queryGatewayOrder(supabase, target, 'hupijiao', env);
}

async function applyHupijiaoOrderQuery(supabase, target, actorId, env = process.env) {
    return applyGatewayOrderQuery(supabase, target, actorId, env, 'hupijiao');
}

async function applyHupijiaoReconcileDecision(supabase, target, note, actorId, env = process.env) {
    return applyGatewayReconcileDecision(supabase, target, note, actorId, env, 'hupijiao');
}

async function applyZpayOrderQuery(supabase, target, actorId, env = process.env) {
    return applyGatewayOrderQuery(supabase, target, actorId, env, 'zpay');
}

async function applyZpayReconcileDecision(supabase, target, note, actorId, env = process.env) {
    return applyGatewayReconcileDecision(supabase, target, note, actorId, env, 'zpay');
}

function buildAdminRefundEventKey(targetId, providerOrderNo, actorId, providerKey = 'hupijiao') {
    const meta = getGatewayProviderMeta(providerKey);
    const digest = crypto
        .createHash('sha256')
        .update([
            String(targetId || '').trim(),
            String(providerOrderNo || '').trim(),
            String(actorId || '').trim(),
            new Date().toISOString()
        ].join(':'))
        .digest('hex')
        .slice(0, 24);

    return `admin-refund:${meta?.key || 'payment'}:${digest}`;
}

function buildAdminRefundAttemptId(targetId, providerOrderNo, actorId, providerKey = 'hupijiao') {
    const meta = getGatewayProviderMeta(providerKey);
    return crypto
        .createHash('sha256')
        .update([
            String(targetId || '').trim(),
            String(providerOrderNo || '').trim(),
            String(actorId || '').trim(),
            String(meta?.key || '').trim(),
            new Date().toISOString()
        ].join(':'))
        .digest('hex')
        .slice(0, 20);
}

function buildRefundReclaimReference(attemptId, providerKey = 'hupijiao') {
    const meta = getGatewayProviderMeta(providerKey);
    return `admin-refund-reclaim:${meta?.key || 'payment'}:${String(attemptId || '').trim()}`;
}

function buildRefundCompensationReference(attemptId, providerKey = 'hupijiao') {
    const meta = getGatewayProviderMeta(providerKey);
    return `admin-refund-compensate:${meta?.key || 'payment'}:${String(attemptId || '').trim()}`;
}

function buildRefundReclaimReason(target = {}, providerKey = '') {
    return `${getGatewayProviderLabel(providerKey)}退款扣回 ${normalizeText(target.provider_order_no || target.id) || '未知订单'}`;
}

function buildRefundCompensationReason(target = {}, providerKey = '') {
    return `${getGatewayProviderLabel(providerKey)}退款回滚 ${normalizeText(target.provider_order_no || target.id) || '未知订单'}`;
}

function buildRefundAlertContent(target = {}, topicLabel = '', detail = '') {
    const providerOrderNo = normalizeText(target.provider_order_no) || '未知订单号';
    const site = normalizeText(target.site).toUpperCase() || 'CN';
    const orderId = normalizeText(target.id) || '未知订单ID';

    return [
        `站点：${site}`,
        `订单号：${providerOrderNo}`,
        `订单ID：${orderId}`,
        `处理入口：支付对账 -> 异常运维 -> ${topicLabel || '退款专题'}`,
        detail || '请尽快复核这笔退款异常。'
    ].join('\n');
}

function normalizeCurrencyAmount(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function buildRefundOpsAlertPayload(target = {}, config = {}, processingResult = '', context = {}) {
    const snapshot = getGatewayRefundSnapshot(target, normalizeText(target?.provider));
    const metadata = snapshot.metadata;
    const reclaimDetails = normalizeJsonObject(context.reclaimSummary || context.reclaimDetails);
    const compensation = normalizeJsonObject(context.compensation);
    const liveOrder = normalizeJsonObject(context.liveOrder);
    const response = normalizeJsonObject(context.response);
    const failureMessage = normalizeText(context.failureMessage || context.message);

    return {
        processing_result: normalizeText(processingResult),
        target_type: 'order',
        target_id: normalizeText(target.id) || null,
        provider: normalizeText(target.provider) || null,
        provider_order_no: normalizeText(snapshot.providerOrderNo || target.provider_order_no) || null,
        site: normalizeText(target.site).toLowerCase() || 'cn',
        topic_label: normalizeText(config.topicLabel) || null,
        detail: normalizeText(config.detail) || null,
        entry_path: `支付对账 -> 异常运维 -> ${normalizeText(config.topicLabel) || '退款专题'}`,
        order_status: normalizeText(target.status).toLowerCase() || null,
        refund_status: normalizeText(snapshot.refundStatus || metadata.refund_status) || null,
        user_id: normalizeText(target.user_id) || null,
        checkout_session_id: normalizeText(target.checkout_session_id) || null,
        expected_amount: normalizeCurrencyAmount(target.expected_amount),
        paid_amount: normalizeCurrencyAmount(target.paid_amount),
        points_amount: normalizePointAmount(target.points_amount, 0),
        credited: snapshot.credited === true,
        claimed_at: normalizeText(target.claimed_at) || null,
        paid_at: normalizeText(target.paid_at) || null,
        verified_at: normalizeText(target.verified_at) || null,
        gateway_open_order_id: normalizeText(snapshot.openOrderId) || null,
        gateway_transaction_id: normalizeText(snapshot.tradeNo || liveOrder.tradeNo || liveOrder.transactionId) || null,
        note: normalizeText(context.note) || null,
        last_error: failureMessage || normalizeText(target.last_error) || null,
        response_status: Number.isFinite(Number(context.responseStatus)) ? Number(context.responseStatus) : null,
        query_status: normalizeText(liveOrder.status) || null,
        query_status_raw: normalizeText(liveOrder.statusRaw) || null,
        gateway_message: normalizeText(response.message || liveOrder.message) || null,
        refund_reclaimed_points: normalizePointAmount(reclaimDetails.reclaimedPoints, 0),
        refund_reclaimed_paid_points: normalizePointAmount(reclaimDetails.reclaimedPaidPoints, 0),
        refund_reclaimed_bonus_points: normalizePointAmount(reclaimDetails.reclaimedBonusPoints, 0),
        compensation_restored_paid_points: normalizePointAmount(compensation.restoredPaidPoints, 0),
        compensation_restored_bonus_points: normalizePointAmount(compensation.restoredBonusPoints, 0)
    };
}

function extractRefundReclaimSummary(payload = {}) {
    return {
        reclaimedPoints: normalizePointAmount(payload?.deducted, 0),
        reclaimedPaidPoints: normalizePointAmount(payload?.deducted_paid, 0),
        reclaimedBonusPoints: normalizePointAmount(payload?.deducted_bonus, 0),
        duplicate: Boolean(payload?.duplicate),
        site: normalizeText(payload?.site).toLowerCase() || null
    };
}

function isMissingRefundReclaimRpc(error) {
    const message = [
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(' ').toLowerCase();

    return (
        message.includes('fn_deduct_points_admin_site_with_breakdown')
        || message.includes('schema cache')
        || message.includes('could not find the function')
    );
}

function isLegacyIntegerRefundReclaimRpc(error) {
    const message = [
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(' ').toLowerCase();

    return message.includes('invalid input syntax for type integer');
}

function normalizeActionResponseStatus(statusCode = 500) {
    const numericStatus = Number(statusCode);
    if (!Number.isFinite(numericStatus)) return 500;

    // Cloudflare will replace origin 502/503/504 bodies with its own generic
    // error page, which hides the actionable JSON message from the admin UI.
    // For admin actions, preserve the detailed business error while keeping the
    // original gateway status inside logs/payment events.
    if (numericStatus >= 502 && numericStatus <= 504) {
        return 409;
    }

    return numericStatus;
}

function getGatewayRefundSnapshot(target = {}, providerKey = '') {
    const metadata = normalizeJsonObject(target.provider_metadata);
    const status = normalizeText(target.status).toLowerCase();
    const refundStatus = normalizeText(
        metadata.refund_status
        || (status === 'refunded' ? 'refunded' : '')
    ).toLowerCase();

    return {
        metadata,
        status,
        refundStatus,
        providerOrderNo: normalizeText(target.provider_order_no || metadata.provider_order_no),
        openOrderId: normalizeText(metadata.gateway_open_order_id || metadata.open_order_id),
        tradeNo: normalizeText(metadata.trade_no || metadata.transaction_id),
        credited: status === 'redeemed' || Boolean(normalizeText(target.claimed_at)),
        providerKey: normalizeText(providerKey || target.provider).toLowerCase()
    };
}

async function compensateRefundReclaim(supabase, target, reclaimSummary, attemptId, providerKey = '') {
    if (!reclaimSummary || reclaimSummary.reclaimedPoints <= 0) {
        return {
            success: true,
            referenceId: null,
            restoredPaidPoints: 0,
            restoredBonusPoints: 0,
            data: null,
            error: null
        };
    }

    const referenceId = buildRefundCompensationReference(attemptId, providerKey);
    const { data, error } = await rechargePointsForPayment({
        supabase,
        userId: target.user_id,
        paidPoints: reclaimSummary.reclaimedPaidPoints,
        bonusPoints: reclaimSummary.reclaimedBonusPoints,
        reason: buildRefundCompensationReason(target, providerKey),
        referenceId,
        site: target.site || 'cn'
    });

    return {
        success: !error,
        referenceId,
        restoredPaidPoints: reclaimSummary.reclaimedPaidPoints,
        restoredBonusPoints: reclaimSummary.reclaimedBonusPoints,
        data: data || null,
        error: error || null
    };
}

async function tryNotifyRefundOpsAlert(supabase, target, processingResult, context = {}) {
    const config = REFUND_ALERT_CONFIG[String(processingResult || '').trim()];
    if (!config || !supabase) {
        return;
    }

    try {
        await notifyActiveAdmins(supabase, {
            title: config.title,
            content: buildRefundAlertContent(target, config.topicLabel, config.detail),
            type: config.type,
            category: 'admin_notice',
            dedupeWindowMinutes: 45
        });
    } catch (error) {
        console.warn('[admin/payments/actions] failed to create refund ops alert:', error.message);
    }

    try {
        await enqueueOpsAlertJob(supabase, {
            alertType: 'payment_refund_ops',
            severity: config.severity || 'warning',
            title: config.title,
            content: buildRefundAlertContent(target, config.topicLabel, config.detail),
            payload: buildRefundOpsAlertPayload(target, config, processingResult, context),
            source: 'admin_refund_ops',
            dedupeWindowMinutes: 45
        });
    } catch (error) {
        console.warn('[admin/payments/actions] failed to enqueue external refund ops alert:', error.message);
    }
}

async function reclaimCreditedGatewayPoints(supabase, target, attemptId, providerKey = '') {
    const meta = getGatewayProviderMeta(providerKey);
    const userId = normalizeText(target.user_id);
    if (!userId) {
        const error = new Error(`该${meta.label}订单缺少用户归属，无法自动扣回已入账积分`);
        error.statusCode = 409;
        throw error;
    }

    const pointBreakdown = meta.pointBreakdown(target, normalizeJsonObject(target.provider_metadata));
    const pointsToReclaim = normalizePointAmount(
        pointBreakdown.grantedPoints ?? target.points_amount,
        normalizePointAmount(target.points_amount, 0)
    );
    const site = normalizeText(target.site).toLowerCase() || 'cn';

    if (!(pointsToReclaim > 0)) {
        return {
            reclaimReference: null,
            compensationReference: null,
            reclaimedPoints: 0,
            reclaimedPaidPoints: 0,
            reclaimedBonusPoints: 0,
            originalPaidPoints: normalizePointAmount(pointBreakdown.paidPoints, 0),
            originalBonusPoints: normalizePointAmount(pointBreakdown.bonusPoints, 0),
            originalGrantedPoints: pointsToReclaim,
            balanceBefore: 0
        };
    }

    const balanceResult = await getUserBalance({
        supabase,
        userId,
        site
    });
    if (balanceResult?.error) {
        const error = new Error(balanceResult.error.message || '读取用户积分余额失败，已停止退款');
        error.statusCode = 502;
        throw error;
    }

    const balanceBefore = getBalanceTotal(balanceResult?.data);
    if (balanceBefore < pointsToReclaim) {
        const error = new Error(`用户当前仅剩 ${balanceBefore} 点，无法原子扣回这笔订单的 ${pointsToReclaim} 点积分`);
        error.statusCode = 409;
        throw error;
    }

    const reclaimReference = buildRefundReclaimReference(attemptId, meta.key);
    const reclaimResult = await deductPointsForRefundReclaim({
        supabase,
        userId,
        amount: pointsToReclaim,
        reason: buildRefundReclaimReason(target, meta.key),
        referenceId: reclaimReference,
        site
    });

    if (reclaimResult?.error) {
        const missingRpc = isMissingRefundReclaimRpc(reclaimResult.error);
        const legacyIntegerRpc = isLegacyIntegerRefundReclaimRpc(reclaimResult.error);
        const error = new Error(
            missingRpc
                ? `退款扣回 RPC 尚未部署，请先执行 ${DECIMAL_REFUND_RECLAIM_MIGRATION}`
                : (legacyIntegerRpc
                    ? `退款扣回 RPC 仍是整数版本，请先执行 ${DECIMAL_REFUND_RECLAIM_MIGRATION}`
                : (reclaimResult.error.message || '执行退款积分扣回失败')
                )
        );
        error.statusCode = missingRpc || legacyIntegerRpc ? 503 : 502;
        throw error;
    }

    const reclaimSummary = extractRefundReclaimSummary(reclaimResult?.data);
    if (reclaimSummary.reclaimedPoints !== pointsToReclaim) {
        const compensation = await compensateRefundReclaim(supabase, target, reclaimSummary, attemptId);
        const error = new Error(
            compensation.success
                ? `积分扣回未完整执行，系统已自动补回；预期扣回 ${pointsToReclaim} 点，实际仅扣回 ${reclaimSummary.reclaimedPoints} 点`
                : `积分扣回异常且自动补回失败；预期扣回 ${pointsToReclaim} 点，实际仅扣回 ${reclaimSummary.reclaimedPoints} 点`
        );
        error.statusCode = compensation.success ? 409 : 500;
        error.reclaimDetails = {
            ...reclaimSummary,
            compensation
        };
        throw error;
    }

    return {
        reclaimReference,
        compensationReference: buildRefundCompensationReference(attemptId, meta.key),
        reclaimedPoints: reclaimSummary.reclaimedPoints,
        reclaimedPaidPoints: reclaimSummary.reclaimedPaidPoints,
        reclaimedBonusPoints: reclaimSummary.reclaimedBonusPoints,
        originalPaidPoints: normalizePointAmount(pointBreakdown.paidPoints, 0),
        originalBonusPoints: normalizePointAmount(pointBreakdown.bonusPoints, 0),
        originalGrantedPoints: pointsToReclaim,
        balanceBefore
    };
}

async function reclaimCreditedHupijiaoPoints(supabase, target, attemptId) {
    return reclaimCreditedGatewayPoints(supabase, target, attemptId, 'hupijiao');
}

function buildNoopRefundCompensation() {
    return {
        success: true,
        referenceId: null,
        restoredPaidPoints: 0,
        restoredBonusPoints: 0,
        data: null,
        error: null
    };
}

async function failGatewayRefundAfterReclaim({
    supabase,
    target,
    snapshot,
    actorId,
    note,
    liveOrder,
    reclaimSummary,
    attemptId,
    message,
    response = null,
    responseStatus = 502,
    providerKey = ''
}) {
    const meta = getGatewayProviderMeta(providerKey);
    const compensation = snapshot.credited
        ? await compensateRefundReclaim(supabase, target, reclaimSummary, attemptId, meta.key)
        : buildNoopRefundCompensation();

    await tryRecordPaymentEvent(supabase, {
        payment_order_id: target.id,
        provider: meta.key,
        provider_order_no: snapshot.providerOrderNo || null,
        event_key: buildAdminRefundEventKey(target.id, snapshot.providerOrderNo, actorId, meta.key),
        event_type: 'admin_refund',
        signature_valid: true,
        amount_valid: null,
        payload: {
            action: meta.refundAction,
            source: 'admin_action',
            query: liveOrder,
            response: response,
            reclaim: reclaimSummary,
            compensation,
            note: note || null
        },
        processing_result: compensation.success ? 'admin_refund_failed' : 'admin_refund_compensation_failed',
        error_message: compensation.success
            ? message
            : `${message}；积分补回失败，需要人工修复`,
        response_status: compensation.success ? responseStatus : 500,
        processed_at: new Date().toISOString()
    });
    await tryNotifyRefundOpsAlert(
        supabase,
        target,
        compensation.success ? 'admin_refund_failed' : 'admin_refund_compensation_failed',
        {
            note,
            failureMessage: message,
            responseStatus,
            liveOrder,
            reclaimSummary,
            compensation,
            response
        }
    );

    const error = new Error(
        compensation.success
            ? message
            : `${message}，且积分补回失败，需要人工修复`
    );
    error.statusCode = compensation.success ? responseStatus : 500;
    throw error;
}

async function failHupijiaoRefundAfterReclaim(payload = {}) {
    return failGatewayRefundAfterReclaim({
        ...payload,
        providerKey: 'hupijiao'
    });
}

async function tryRecordPaymentEvent(supabase, payload = {}) {
    if (!supabase) return;

    try {
        await supabase
            .from('payment_events')
            .insert(payload);
    } catch (error) {
        console.warn('[admin/payments/actions] failed to record payment event:', error.message);
    }
}

async function syncRefundedPaymentOrder(supabase, target, {
    actorId,
    note,
    providerOrderNo,
    openOrderId,
    tradeNo = '',
    refundStatus = 'refunded',
    refundStatusRaw = 'CD',
    refundSource = 'admin_action',
    payload = null,
    reclaimSummary = null,
    providerKey = ''
}) {
    const meta = getGatewayProviderMeta(providerKey || target?.provider || '');
    const existingMetadata = normalizeJsonObject(target.provider_metadata);
    const existingRawPayload = normalizeJsonObject(target.raw_payload);
    const existingAdminRefund = normalizeJsonObject(existingRawPayload.admin_refund);
    const nowIso = new Date().toISOString();
    const normalizedRefundStatus = normalizeText(refundStatus).toLowerCase() || 'refunded';
    const normalizedReclaimSummary = reclaimSummary && typeof reclaimSummary === 'object'
        ? reclaimSummary
        : null;
    const nextProviderMetadata = mergeJsonObjects(existingMetadata, {
        provider_order_no: providerOrderNo || existingMetadata.provider_order_no || target.provider_order_no || null,
        gateway_open_order_id: openOrderId || existingMetadata.gateway_open_order_id || null,
        transaction_id: normalizeText(tradeNo) || existingMetadata.transaction_id || existingMetadata.trade_no || null,
        trade_no: normalizeText(tradeNo) || existingMetadata.trade_no || existingMetadata.transaction_id || null,
        payment_status: normalizedRefundStatus,
        payment_status_raw: refundStatusRaw || existingMetadata.payment_status_raw || meta?.refundStatusRaw || null,
        refund_status: normalizedRefundStatus,
        refund_requested_at: nowIso,
        refund_requested_by: actorId || null,
        refund_note: note || null,
        refund_source: refundSource
    });

    if (normalizedReclaimSummary) {
        Object.assign(nextProviderMetadata, {
            refund_reclaimed_points: normalizedReclaimSummary.reclaimedPoints,
            refund_reclaimed_paid_points: normalizedReclaimSummary.reclaimedPaidPoints,
            refund_reclaimed_bonus_points: normalizedReclaimSummary.reclaimedBonusPoints,
            refund_reclaimed_at: nowIso,
            refund_reclaim_reference: normalizedReclaimSummary.reclaimReference || null
        });
    }

    const orderPatch = {
        status: normalizedRefundStatus === 'refunded' ? 'refunded' : target.status,
        last_error: normalizedRefundStatus === 'refunded' ? null : (target.last_error || null),
        provider_metadata: nextProviderMetadata,
        raw_payload: mergeJsonObjects(existingRawPayload, {
            admin_refund: mergeJsonObjects(existingAdminRefund, {
                requested_at: nowIso,
                requested_by: actorId || null,
                note: note || null,
                source: refundSource,
                payload: payload && typeof payload === 'object' ? payload : null,
                reclaim: normalizedReclaimSummary
            })
        })
    };

    const { data, error } = await supabase
        .from('payment_orders')
        .update(orderPatch)
        .eq('id', target.id)
        .select('*')
        .single();

    if (error) throw error;
    return data;
}

async function applyGatewayRefundDecision(supabase, target, note, actorId, env = process.env, providerKey = '') {
    const meta = getGatewayProviderMeta(providerKey);
    const provider = normalizeText(target?.provider).toLowerCase();
    if (provider !== meta.key) {
        const error = new Error(`仅支持对${meta.label}支付订单执行该退款操作`);
        error.statusCode = 400;
        throw error;
    }

    const snapshot = getGatewayRefundSnapshot(target, meta.key);
    if (!snapshot.providerOrderNo && !snapshot.openOrderId && !snapshot.tradeNo) {
        const error = new Error(`缺少${meta.label}订单号，暂时无法执行退款`);
        error.statusCode = 400;
        throw error;
    }

    if (snapshot.refundStatus === 'refunded') {
        const error = new Error('该订单已完成退款，无需重复操作');
        error.statusCode = 409;
        throw error;
    }

    if (snapshot.refundStatus === 'refund_pending') {
        const error = new Error('该订单已有退款请求在处理中，请稍后再查单确认');
        error.statusCode = 409;
        throw error;
    }

    if (!REFUNDABLE_GATEWAY_STATUSES.has(snapshot.status)) {
        const error = new Error(`当前订单状态不允许执行${meta.label}退款`);
        error.statusCode = 409;
        throw error;
    }

    const adapter = getPaymentProviderAdapter(meta.key);
    if (!adapter || typeof adapter.resolveRuntimeContext !== 'function' || typeof adapter.refundOrder !== 'function') {
        const error = new Error(`${meta.label}退款适配器尚未完成接入`);
        error.statusCode = 503;
        throw error;
    }

    const runtimeContext = await adapter.resolveRuntimeContext({
        supabase,
        env
    });
    const resolvedProviderOrderNo = snapshot.providerOrderNo || target.provider_order_no;
    const attemptId = buildAdminRefundAttemptId(target.id, resolvedProviderOrderNo, actorId, meta.key);
    const refundAmount = roundCurrencyAmount(target?.paid_amount ?? target?.expected_amount);

    let liveOrder = null;
    if (typeof adapter.queryOrder === 'function') {
        liveOrder = await adapter.queryOrder({
            runtimeContext,
            providerOrderNo: snapshot.providerOrderNo,
            openOrderId: snapshot.openOrderId,
            tradeNo: snapshot.tradeNo
        });

        if (liveOrder?.supported === false) {
            const error = new Error(liveOrder.message || `${meta.label}查单能力不可用，已停止退款`);
            error.statusCode = 503;
            throw error;
        }

        if (liveOrder?.success === false) {
            const error = new Error(liveOrder.message || `${meta.label}退款前查单失败`);
            error.statusCode = 502;
            throw error;
        }

        const liveStatus = normalizeText(liveOrder?.status).toLowerCase();
        if (liveStatus === 'refund_pending') {
            const error = new Error(`${meta.label}网关显示该订单退款处理中，请稍后再确认结果`);
            error.statusCode = 409;
            throw error;
        }

        if (liveStatus === 'refunded') {
            let reclaimSummary = null;
            if (snapshot.credited) {
                try {
                    reclaimSummary = await reclaimCreditedGatewayPoints(supabase, target, attemptId, meta.key);
                } catch (reclaimError) {
                    await tryRecordPaymentEvent(supabase, {
                        payment_order_id: target.id,
                        provider: meta.key,
                        provider_order_no: liveOrder.providerOrderNo || snapshot.providerOrderNo || null,
                        event_key: buildAdminRefundEventKey(target.id, liveOrder.providerOrderNo || snapshot.providerOrderNo, actorId, meta.key),
                        event_type: 'admin_refund',
                        signature_valid: true,
                        amount_valid: null,
                        payload: {
                            action: meta.refundAction,
                            source: 'gateway_query_sync',
                            query: liveOrder,
                            reclaim: reclaimError?.reclaimDetails || null,
                            note: note || null
                        },
                        processing_result: 'admin_refund_reclaim_failed',
                        error_message: reclaimError.message || `${meta.label}退款积分扣回失败`,
                        response_status: reclaimError?.statusCode || 409,
                        processed_at: new Date().toISOString()
                    });
                    await tryNotifyRefundOpsAlert(supabase, target, 'admin_refund_reclaim_failed', {
                        note,
                        failureMessage: reclaimError.message,
                        responseStatus: reclaimError?.statusCode || 409,
                        liveOrder,
                        reclaimDetails: reclaimError?.reclaimDetails || null
                    });
                    throw reclaimError;
                }
            }

            const transactionId = getGatewayTransactionId(snapshot, liveOrder);
            const syncedOrder = await syncRefundedPaymentOrder(supabase, target, {
                actorId,
                note,
                providerOrderNo: liveOrder.providerOrderNo || snapshot.providerOrderNo,
                openOrderId: liveOrder.openOrderId || snapshot.openOrderId,
                tradeNo: transactionId,
                refundStatus: 'refunded',
                refundStatusRaw: liveOrder.statusRaw || meta.refundStatusRaw,
                refundSource: 'gateway_query_sync',
                payload: {
                    query: liveOrder
                },
                reclaimSummary,
                providerKey: meta.key
            });

            await tryRecordPaymentEvent(supabase, {
                payment_order_id: target.id,
                provider: meta.key,
                provider_order_no: liveOrder.providerOrderNo || snapshot.providerOrderNo || null,
                event_key: buildAdminRefundEventKey(target.id, liveOrder.providerOrderNo || snapshot.providerOrderNo, actorId, meta.key),
                event_type: 'admin_refund',
                signature_valid: true,
                amount_valid: null,
                payload: {
                    action: meta.refundAction,
                    source: 'gateway_query_sync',
                    query: liveOrder,
                    reclaim: reclaimSummary,
                    note: note || null
                },
                processing_result: 'admin_refund_synced_refunded',
                response_status: 200,
                processed_at: new Date().toISOString()
            });

            return {
                order: syncedOrder,
                anomalyStatus: 'handled',
                resolution: '网关已完成退款，后台已同步本地状态。',
                auditDetails: {
                    refund_provider: meta.key,
                    refund_status: 'refunded',
                    refund_source: 'gateway_query_sync',
                    provider_order_no: liveOrder.providerOrderNo || snapshot.providerOrderNo || null,
                    gateway_open_order_id: liveOrder.openOrderId || snapshot.openOrderId || null,
                    gateway_transaction_id: transactionId,
                    refund_reclaimed_points: reclaimSummary?.reclaimedPoints || 0,
                    refund_reclaimed_paid_points: reclaimSummary?.reclaimedPaidPoints || 0,
                    refund_reclaimed_bonus_points: reclaimSummary?.reclaimedBonusPoints || 0
                }
            };
        }
    }

    let reclaimSummary = null;
    if (snapshot.credited) {
        try {
            reclaimSummary = await reclaimCreditedGatewayPoints(supabase, target, attemptId, meta.key);
        } catch (reclaimError) {
            await tryRecordPaymentEvent(supabase, {
                payment_order_id: target.id,
                provider: meta.key,
                provider_order_no: snapshot.providerOrderNo || null,
                event_key: buildAdminRefundEventKey(target.id, snapshot.providerOrderNo, actorId, meta.key),
                event_type: 'admin_refund',
                signature_valid: true,
                amount_valid: null,
                payload: {
                    action: meta.refundAction,
                    source: 'admin_action',
                    query: liveOrder,
                    reclaim: reclaimError?.reclaimDetails || null,
                    note: note || null
                },
                processing_result: 'admin_refund_reclaim_failed',
                error_message: reclaimError.message || `${meta.label}退款积分扣回失败`,
                response_status: reclaimError?.statusCode || 409,
                processed_at: new Date().toISOString()
            });
            await tryNotifyRefundOpsAlert(supabase, target, 'admin_refund_reclaim_failed', {
                note,
                failureMessage: reclaimError.message,
                responseStatus: reclaimError?.statusCode || 409,
                liveOrder,
                reclaimDetails: reclaimError?.reclaimDetails || null
            });
            throw reclaimError;
        }
    }

    let refundResult = null;
    try {
        refundResult = await adapter.refundOrder({
            runtimeContext,
            providerOrderNo: snapshot.providerOrderNo,
            openOrderId: snapshot.openOrderId,
            tradeNo: snapshot.tradeNo,
            reason: note,
            money: refundAmount
        });
    } catch (refundError) {
        await failGatewayRefundAfterReclaim({
            supabase,
            target,
            snapshot,
            actorId,
            note,
            liveOrder,
            reclaimSummary,
            attemptId,
            message: refundError?.message || `${meta.label}退款请求异常`,
            response: {
                error: refundError?.message || `${meta.label}退款请求异常`
            },
            responseStatus: 502,
            providerKey: meta.key
        });
    }

    if (refundResult?.supported === false) {
        await failGatewayRefundAfterReclaim({
            supabase,
            target,
            snapshot,
            actorId,
            note,
            liveOrder,
            reclaimSummary,
            attemptId,
            message: refundResult.message || `${meta.label}退款能力不可用`,
            response: refundResult,
            responseStatus: 503,
            providerKey: meta.key
        });
    }

    if (!refundResult?.success) {
        await failGatewayRefundAfterReclaim({
            supabase,
            target,
            snapshot,
            actorId,
            note,
            liveOrder,
            reclaimSummary,
            attemptId,
            message: refundResult?.message || `${meta.label}退款失败`,
            response: refundResult || null,
            responseStatus: 502,
            providerKey: meta.key
        });
    }

    const transactionId = normalizeText(
        refundResult?.tradeNo
        || refundResult?.transactionId
        || liveOrder?.tradeNo
        || liveOrder?.transactionId
        || snapshot.tradeNo
    ) || null;
    const refundedOrder = await syncRefundedPaymentOrder(supabase, target, {
        actorId,
        note,
        providerOrderNo: refundResult.providerOrderNo || snapshot.providerOrderNo,
        openOrderId: refundResult.openOrderId || snapshot.openOrderId,
        tradeNo: transactionId,
        refundStatus: normalizeText(refundResult.status).toLowerCase() || 'refunded',
        refundStatusRaw: refundResult.statusRaw || meta.refundStatusRaw,
        refundSource: 'admin_action',
        payload: {
            query: liveOrder,
            response: refundResult
        },
        reclaimSummary,
        providerKey: meta.key
    });

    await tryRecordPaymentEvent(supabase, {
        payment_order_id: target.id,
        provider: meta.key,
        provider_order_no: refundResult.providerOrderNo || snapshot.providerOrderNo || null,
        event_key: buildAdminRefundEventKey(target.id, refundResult.providerOrderNo || snapshot.providerOrderNo, actorId, meta.key),
        event_type: 'admin_refund',
        signature_valid: true,
        amount_valid: null,
        payload: {
            action: meta.refundAction,
            source: 'admin_action',
            query: liveOrder,
            response: refundResult,
            reclaim: reclaimSummary,
            note: note || null
        },
        processing_result: 'admin_refund_processed',
        response_status: 200,
        processed_at: new Date().toISOString()
    });

    return {
        order: refundedOrder,
        anomalyStatus: 'handled',
        resolution: getResolutionText(meta.refundAction, note),
        auditDetails: {
            refund_provider: meta.key,
            refund_status: normalizeText(refundResult.status).toLowerCase() || 'refunded',
            refund_source: 'admin_action',
            provider_order_no: refundResult.providerOrderNo || snapshot.providerOrderNo || null,
            gateway_open_order_id: refundResult.openOrderId || snapshot.openOrderId || null,
            gateway_transaction_id: transactionId,
            refund_reclaimed_points: reclaimSummary?.reclaimedPoints || 0,
            refund_reclaimed_paid_points: reclaimSummary?.reclaimedPaidPoints || 0,
            refund_reclaimed_bonus_points: reclaimSummary?.reclaimedBonusPoints || 0
        }
    };
}

async function applyHupijiaoRefundDecision(supabase, target, note, actorId, env = process.env) {
    return applyGatewayRefundDecision(supabase, target, note, actorId, env, 'hupijiao');
}

async function applyZpayRefundDecision(supabase, target, note, actorId, env = process.env) {
    return applyGatewayRefundDecision(supabase, target, note, actorId, env, 'zpay');
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, requestSupabase, user } = await requireAdmin(req, { permission: 'payments.manage' });
        const body = await parseJsonBody(req);
        const targetType = normalizeText(body.targetType).toLowerCase();
        const targetId = normalizeText(body.targetId);
        const action = normalizeText(body.action).toLowerCase();
        const note = normalizeText(body.note);

        if (!VALID_TARGET_TYPES.has(targetType)) {
            return sendJson(res, 400, { success: false, message: 'Invalid target type' });
        }
        if (!targetId) {
            return sendJson(res, 400, { success: false, message: 'Missing target id' });
        }
        if (!VALID_ACTIONS.has(action)) {
            return sendJson(res, 400, { success: false, message: 'Invalid action' });
        }

        const target = await fetchTargetRecord(supabase, targetType, targetId);
        const targetPayload = targetType === 'ops_alert_job' ? normalizeJsonObject(target?.payload) : {};
        const targetProvider = normalizeText(target?.provider || targetPayload.provider);
        const targetProviderOrderNo = normalizeText(target?.provider_order_no || targetPayload.provider_order_no || target?.session_key);

        if (NOTE_REQUIRED_ACTIONS.has(action) && !note) {
            return sendJson(res, 400, {
                success: false,
                message: '请填写处理备注后再执行该操作'
            });
        }

        if (SENSITIVE_REVIEW_ACTIONS.has(action) && targetType !== 'order') {
            return sendJson(res, 400, {
                success: false,
                message: '该操作仅适用于支付订单'
            });
        }

        if (ORDER_ONLY_ACTIONS.has(action) && targetType !== 'order') {
            return sendJson(res, 400, {
                success: false,
                message: '该操作仅适用于支付订单'
            });
        }

        if (targetType === 'order' && SENSITIVE_REVIEW_ACTIONS.has(action)) {
            await applyOrderReviewDecision(supabase, target, action, note, user.id);
        }

        if (targetType === 'order' && (action === 'query_hupijiao_order' || action === 'query_zpay_order')) {
            const queryDecision = action === 'query_zpay_order'
                ? await applyZpayOrderQuery(supabase, target, user.id, process.env)
                : await applyHupijiaoOrderQuery(supabase, target, user.id, process.env);

            await writeAdminAuditLog({
                supabase: requestSupabase || supabase,
                adminId: user.id,
                actionType: 'payments.order.query',
                details: {
                    targetType,
                    targetId,
                    targetProvider,
                    targetProviderOrderNo,
                    action,
                    status: normalizeText(queryDecision.liveOrder?.status).toLowerCase() || 'unknown',
                    ...queryDecision.auditDetails
                }
            });

            return sendJson(res, 200, {
                success: true,
                message: queryDecision.message,
                live_order: queryDecision.liveOrder,
                order: queryDecision.order,
                reload: queryDecision.reload === true
            });
        }

        let resolvedTarget = target;
        let resolvedStatus = mapActionToStatus(action);
        let resolvedResolution = getResolutionText(action, note);
        let auditDetails = {};
        let anomalyCase = null;
        let responseMessage = '';

        if (targetType === 'order' && (action === 'refund_hupijiao' || action === 'refund_zpay')) {
            const refundDecision = action === 'refund_zpay'
                ? await applyZpayRefundDecision(supabase, target, note, user.id, process.env)
                : await applyHupijiaoRefundDecision(supabase, target, note, user.id, process.env);
            resolvedTarget = refundDecision.order || target;
            resolvedStatus = refundDecision.anomalyStatus || resolvedStatus;
            resolvedResolution = refundDecision.resolution || resolvedResolution;
            auditDetails = refundDecision.auditDetails || {};
            responseMessage = normalizeText(refundDecision.message);
        }

        if (targetType === 'order' && (action === 'reconcile_hupijiao_order' || action === 'reconcile_zpay_order')) {
            const reconcileDecision = action === 'reconcile_zpay_order'
                ? await applyZpayReconcileDecision(supabase, target, note, user.id, process.env)
                : await applyHupijiaoReconcileDecision(supabase, target, note, user.id, process.env);
            resolvedTarget = reconcileDecision.order || target;
            resolvedStatus = reconcileDecision.anomalyStatus || resolvedStatus;
            resolvedResolution = reconcileDecision.resolution || resolvedResolution;
            auditDetails = reconcileDecision.auditDetails || {};
            responseMessage = normalizeText(reconcileDecision.message);
        }

        if (targetType === 'ops_alert_job') {
            const opsAlertDecision = await applyOpsAlertJobAction(supabase, target, action, note, user.id);
            resolvedTarget = opsAlertDecision.job || target;
            resolvedStatus = normalizeText(opsAlertDecision.job?.status) || resolvedStatus;
            resolvedResolution = opsAlertDecision.resolution || resolvedResolution;
            auditDetails = opsAlertDecision.auditDetails || {};
        } else {
            anomalyCase = await upsertAnomalyCase(supabase, {
                targetType,
                targetId,
                targetProvider: normalizeText(resolvedTarget?.provider || targetProvider),
                targetProviderOrderNo: normalizeText(resolvedTarget?.provider_order_no || targetProviderOrderNo),
                status: resolvedStatus,
                note,
                resolution: resolvedResolution,
                action,
                actorId: user.id
            });
            resolvedStatus = anomalyCase.status;
        }

        await writeAdminAuditLog({
            supabase: requestSupabase || supabase,
            adminId: user.id,
            actionType: targetType === 'ops_alert_job'
                ? 'payments.ops_alert.action'
                : (action.startsWith('reconcile_') ? 'payments.order.reconcile' : 'payments.anomaly.action'),
            details: {
                targetType,
                targetId,
                targetProvider,
                targetProviderOrderNo,
                action,
                note: note || null,
                status: resolvedStatus,
                ...auditDetails
            }
        });

        return sendJson(res, 200, {
            success: true,
            message: responseMessage || undefined,
            anomaly_case: anomalyCase,
            order: targetType === 'order' ? resolvedTarget : undefined,
            ops_alert_job: targetType === 'ops_alert_job' ? resolvedTarget : undefined
        });
    } catch (error) {
        return sendJson(res, normalizeActionResponseStatus(error?.statusCode || 500), {
            success: false,
            message: error?.message || 'Failed to apply anomaly action'
        });
    }
};
