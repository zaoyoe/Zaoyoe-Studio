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
    applyPaymentOrderReview,
    deductPointsForRefundReclaim,
    getUserBalance,
    rechargePointsForPayment
} = require('../../../../api/_lib/payments/rpc');
const {
    getPaymentProviderAdapter
} = require('../../../../api/_lib/payments/provider-adapters');
const {
    deriveHupijiaoPointBreakdown
} = require('../../../../api/_lib/payments/hupijiao-points');

const VALID_TARGET_TYPES = new Set(['order', 'event', 'session']);
const VALID_ACTIONS = new Set([
    'mark_handled',
    'ignore',
    'request_retry',
    'reopen',
    'approve_review',
    'reject_review',
    'approve_amount_mismatch',
    'reject_amount_mismatch',
    'refund_hupijiao'
]);
const NOTE_REQUIRED_ACTIONS = new Set([
    'approve_review',
    'reject_review',
    'approve_amount_mismatch',
    'reject_amount_mismatch',
    'refund_hupijiao'
]);
const SENSITIVE_REVIEW_ACTIONS = new Set([
    'approve_review',
    'reject_review',
    'approve_amount_mismatch',
    'reject_amount_mismatch'
]);
const REFUNDABLE_HUPIJIAO_STATUSES = new Set([
    'pending_review',
    'amount_mismatch',
    'paid',
    'redeemed'
]);
const REFUND_ALERT_CONFIG = Object.freeze({
    admin_refund_failed: {
        title: '支付退款失败（已补回）',
        type: 'warning',
        topicLabel: '退款失败',
        detail: '网关退款失败，但系统已自动补回积分，请尽快复核通道状态并确认是否需要人工跟进。'
    },
    admin_refund_reclaim_failed: {
        title: '支付退款积分扣回失败',
        type: 'alert',
        topicLabel: '扣回失败',
        detail: '已入账订单在退款前无法安全扣回积分，系统已停止继续退款，请先处理余额或扣回链路。'
    },
    admin_refund_compensation_failed: {
        title: '支付退款积分回滚失败',
        type: 'alert',
        topicLabel: '回滚失败',
        detail: '网关退款失败后，系统自动补回积分也失败了，需要立即人工核对账务并修复。'
    }
});

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
    return Math.max(0, Math.round(numericValue));
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
        return '已通过后台执行虎皮椒退款。';
    case 'reopen':
        return '已重新打开异常项。';
    default:
        return '';
    }
}

async function fetchTargetRecord(supabase, targetType, targetId) {
    if (targetType === 'order') {
        const { data, error } = await supabase
            .from('payment_orders')
            .select('id, user_id, provider, provider_order_no, checkout_session_id, site, expected_amount, paid_amount, points_amount, status, claimed_at, paid_at, verified_at, last_error, provider_metadata, raw_payload')
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

function buildAdminRefundEventKey(targetId, providerOrderNo, actorId) {
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

    return `admin-refund:hupijiao:${digest}`;
}

function buildAdminRefundAttemptId(targetId, providerOrderNo, actorId) {
    return crypto
        .createHash('sha256')
        .update([
            String(targetId || '').trim(),
            String(providerOrderNo || '').trim(),
            String(actorId || '').trim(),
            new Date().toISOString()
        ].join(':'))
        .digest('hex')
        .slice(0, 20);
}

function buildRefundReclaimReference(attemptId) {
    return `admin-refund-reclaim:hupijiao:${String(attemptId || '').trim()}`;
}

function buildRefundCompensationReference(attemptId) {
    return `admin-refund-compensate:hupijiao:${String(attemptId || '').trim()}`;
}

function buildRefundReclaimReason(target = {}) {
    return `支付退款扣回 ${normalizeText(target.provider_order_no || target.id) || '未知订单'}`;
}

function buildRefundCompensationReason(target = {}) {
    return `支付退款回滚 ${normalizeText(target.provider_order_no || target.id) || '未知订单'}`;
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

function getHupijiaoRefundSnapshot(target = {}) {
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
        credited: status === 'redeemed' || Boolean(normalizeText(target.claimed_at))
    };
}

async function compensateRefundReclaim(supabase, target, reclaimSummary, attemptId) {
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

    const referenceId = buildRefundCompensationReference(attemptId);
    const { data, error } = await rechargePointsForPayment({
        supabase,
        userId: target.user_id,
        paidPoints: reclaimSummary.reclaimedPaidPoints,
        bonusPoints: reclaimSummary.reclaimedBonusPoints,
        reason: buildRefundCompensationReason(target),
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

async function tryNotifyRefundOpsAlert(supabase, target, processingResult) {
    const config = REFUND_ALERT_CONFIG[String(processingResult || '').trim()];
    if (!config || !supabase) {
        return;
    }

    try {
        await notifyActiveAdmins(supabase, {
            title: config.title,
            content: buildRefundAlertContent(target, config.topicLabel, config.detail),
            type: config.type,
            dedupeWindowMinutes: 45
        });
    } catch (error) {
        console.warn('[admin/payments/actions] failed to create refund ops alert:', error.message);
    }
}

async function reclaimCreditedHupijiaoPoints(supabase, target, attemptId) {
    const userId = normalizeText(target.user_id);
    if (!userId) {
        const error = new Error('该虎皮椒订单缺少用户归属，无法自动扣回已入账积分');
        error.statusCode = 409;
        throw error;
    }

    const pointBreakdown = deriveHupijiaoPointBreakdown(target, normalizeJsonObject(target.provider_metadata));
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

    const reclaimReference = buildRefundReclaimReference(attemptId);
    const reclaimResult = await deductPointsForRefundReclaim({
        supabase,
        userId,
        amount: pointsToReclaim,
        reason: buildRefundReclaimReason(target),
        referenceId: reclaimReference,
        site
    });

    if (reclaimResult?.error) {
        const error = new Error(
            isMissingRefundReclaimRpc(reclaimResult.error)
                ? '退款扣回 RPC 尚未部署，请先执行 20260324_add_admin_refund_reclaim_rpc.sql'
                : (reclaimResult.error.message || '执行退款积分扣回失败')
        );
        error.statusCode = isMissingRefundReclaimRpc(reclaimResult.error) ? 503 : 502;
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
        compensationReference: buildRefundCompensationReference(attemptId),
        reclaimedPoints: reclaimSummary.reclaimedPoints,
        reclaimedPaidPoints: reclaimSummary.reclaimedPaidPoints,
        reclaimedBonusPoints: reclaimSummary.reclaimedBonusPoints,
        originalPaidPoints: normalizePointAmount(pointBreakdown.paidPoints, 0),
        originalBonusPoints: normalizePointAmount(pointBreakdown.bonusPoints, 0),
        originalGrantedPoints: pointsToReclaim,
        balanceBefore
    };
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

async function failHupijiaoRefundAfterReclaim({
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
    responseStatus = 502
}) {
    const compensation = snapshot.credited
        ? await compensateRefundReclaim(supabase, target, reclaimSummary, attemptId)
        : buildNoopRefundCompensation();

    await tryRecordPaymentEvent(supabase, {
        payment_order_id: target.id,
        provider: 'hupijiao',
        provider_order_no: snapshot.providerOrderNo || null,
        event_key: buildAdminRefundEventKey(target.id, snapshot.providerOrderNo, actorId),
        event_type: 'admin_refund',
        signature_valid: true,
        amount_valid: null,
        payload: {
            action: 'refund_hupijiao',
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
        compensation.success ? 'admin_refund_failed' : 'admin_refund_compensation_failed'
    );

    const error = new Error(
        compensation.success
            ? message
            : `${message}，且积分补回失败，需要人工修复`
    );
    error.statusCode = compensation.success ? responseStatus : 500;
    throw error;
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
    refundStatus = 'refunded',
    refundStatusRaw = 'CD',
    refundSource = 'admin_action',
    payload = null,
    reclaimSummary = null
}) {
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
        payment_status: normalizedRefundStatus,
        payment_status_raw: refundStatusRaw || existingMetadata.payment_status_raw || null,
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

async function applyHupijiaoRefundDecision(supabase, target, note, actorId, env = process.env) {
    const provider = normalizeText(target?.provider).toLowerCase();
    if (provider !== 'hupijiao') {
        const error = new Error('仅支持对虎皮椒支付订单执行该退款操作');
        error.statusCode = 400;
        throw error;
    }

    const snapshot = getHupijiaoRefundSnapshot(target);
    if (!snapshot.providerOrderNo && !snapshot.openOrderId) {
        const error = new Error('缺少虎皮椒订单号，暂时无法执行退款');
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

    if (!REFUNDABLE_HUPIJIAO_STATUSES.has(snapshot.status)) {
        const error = new Error('当前订单状态不允许执行虎皮椒退款');
        error.statusCode = 409;
        throw error;
    }

    const adapter = getPaymentProviderAdapter('hupijiao');
    if (!adapter || typeof adapter.resolveRuntimeContext !== 'function' || typeof adapter.refundOrder !== 'function') {
        const error = new Error('虎皮椒退款适配器尚未完成接入');
        error.statusCode = 503;
        throw error;
    }

    const runtimeContext = await adapter.resolveRuntimeContext({
        supabase,
        env
    });
    const attemptId = buildAdminRefundAttemptId(target.id, snapshot.providerOrderNo, actorId);

    let liveOrder = null;
    if (typeof adapter.queryOrder === 'function') {
        liveOrder = await adapter.queryOrder({
            runtimeContext,
            providerOrderNo: snapshot.providerOrderNo,
            openOrderId: snapshot.openOrderId
        });

        if (liveOrder?.supported === false) {
            const error = new Error(liveOrder.message || '虎皮椒查单能力不可用，已停止退款');
            error.statusCode = 503;
            throw error;
        }

        if (liveOrder?.success === false) {
            const error = new Error(liveOrder.message || '虎皮椒退款前查单失败');
            error.statusCode = 502;
            throw error;
        }

        const liveStatus = normalizeText(liveOrder?.status).toLowerCase();
        if (liveStatus === 'refund_pending') {
            const error = new Error('虎皮椒网关显示该订单退款处理中，请稍后再确认结果');
            error.statusCode = 409;
            throw error;
        }

        if (liveStatus === 'refunded') {
            let reclaimSummary = null;
            if (snapshot.credited) {
                try {
                    reclaimSummary = await reclaimCreditedHupijiaoPoints(supabase, target, attemptId);
                } catch (reclaimError) {
                    await tryRecordPaymentEvent(supabase, {
                        payment_order_id: target.id,
                        provider: 'hupijiao',
                        provider_order_no: liveOrder.providerOrderNo || snapshot.providerOrderNo || null,
                        event_key: buildAdminRefundEventKey(target.id, liveOrder.providerOrderNo || snapshot.providerOrderNo, actorId),
                        event_type: 'admin_refund',
                        signature_valid: true,
                        amount_valid: null,
                        payload: {
                            action: 'refund_hupijiao',
                            source: 'gateway_query_sync',
                            query: liveOrder,
                            reclaim: reclaimError?.reclaimDetails || null,
                            note: note || null
                        },
                        processing_result: 'admin_refund_reclaim_failed',
                        error_message: reclaimError.message || '虎皮椒退款积分扣回失败',
                        response_status: reclaimError?.statusCode || 409,
                        processed_at: new Date().toISOString()
                    });
                    await tryNotifyRefundOpsAlert(supabase, target, 'admin_refund_reclaim_failed');
                    throw reclaimError;
                }
            }

            const syncedOrder = await syncRefundedPaymentOrder(supabase, target, {
                actorId,
                note,
                providerOrderNo: liveOrder.providerOrderNo || snapshot.providerOrderNo,
                openOrderId: liveOrder.openOrderId || snapshot.openOrderId,
                refundStatus: 'refunded',
                refundStatusRaw: liveOrder.statusRaw || 'CD',
                refundSource: 'gateway_query_sync',
                payload: {
                    query: liveOrder
                },
                reclaimSummary
            });

            await tryRecordPaymentEvent(supabase, {
                payment_order_id: target.id,
                provider: 'hupijiao',
                provider_order_no: liveOrder.providerOrderNo || snapshot.providerOrderNo || null,
                event_key: buildAdminRefundEventKey(target.id, liveOrder.providerOrderNo || snapshot.providerOrderNo, actorId),
                event_type: 'admin_refund',
                signature_valid: true,
                amount_valid: null,
                payload: {
                    action: 'refund_hupijiao',
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
                    refund_provider: 'hupijiao',
                    refund_status: 'refunded',
                    refund_source: 'gateway_query_sync',
                    provider_order_no: liveOrder.providerOrderNo || snapshot.providerOrderNo || null,
                    gateway_open_order_id: liveOrder.openOrderId || snapshot.openOrderId || null,
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
            reclaimSummary = await reclaimCreditedHupijiaoPoints(supabase, target, attemptId);
        } catch (reclaimError) {
            await tryRecordPaymentEvent(supabase, {
                payment_order_id: target.id,
                provider: 'hupijiao',
                provider_order_no: snapshot.providerOrderNo || null,
                event_key: buildAdminRefundEventKey(target.id, snapshot.providerOrderNo, actorId),
                event_type: 'admin_refund',
                signature_valid: true,
                amount_valid: null,
                payload: {
                    action: 'refund_hupijiao',
                    source: 'admin_action',
                    query: liveOrder,
                    reclaim: reclaimError?.reclaimDetails || null,
                    note: note || null
                },
                processing_result: 'admin_refund_reclaim_failed',
                error_message: reclaimError.message || '虎皮椒退款积分扣回失败',
                response_status: reclaimError?.statusCode || 409,
                processed_at: new Date().toISOString()
            });
            await tryNotifyRefundOpsAlert(supabase, target, 'admin_refund_reclaim_failed');
            throw reclaimError;
        }
    }

    let refundResult = null;
    try {
        refundResult = await adapter.refundOrder({
            runtimeContext,
            providerOrderNo: snapshot.providerOrderNo,
            openOrderId: snapshot.openOrderId,
            reason: note
        });
    } catch (refundError) {
        await failHupijiaoRefundAfterReclaim({
            supabase,
            target,
            snapshot,
            actorId,
            note,
            liveOrder,
            reclaimSummary,
            attemptId,
            message: refundError?.message || '虎皮椒退款请求异常',
            response: {
                error: refundError?.message || '虎皮椒退款请求异常'
            },
            responseStatus: 502
        });
    }

    if (refundResult?.supported === false) {
        await failHupijiaoRefundAfterReclaim({
            supabase,
            target,
            snapshot,
            actorId,
            note,
            liveOrder,
            reclaimSummary,
            attemptId,
            message: refundResult.message || '虎皮椒退款能力不可用',
            response: refundResult,
            responseStatus: 503
        });
    }

    if (!refundResult?.success) {
        await failHupijiaoRefundAfterReclaim({
            supabase,
            target,
            snapshot,
            actorId,
            note,
            liveOrder,
            reclaimSummary,
            attemptId,
            message: refundResult?.message || '虎皮椒退款失败',
            response: refundResult || null,
            responseStatus: 502
        });
    }

    const refundedOrder = await syncRefundedPaymentOrder(supabase, target, {
        actorId,
        note,
        providerOrderNo: refundResult.providerOrderNo || snapshot.providerOrderNo,
        openOrderId: refundResult.openOrderId || snapshot.openOrderId,
        refundStatus: normalizeText(refundResult.status).toLowerCase() || 'refunded',
        refundStatusRaw: refundResult.statusRaw || 'CD',
        refundSource: 'admin_action',
        payload: {
            query: liveOrder,
            response: refundResult
        },
        reclaimSummary
    });

    await tryRecordPaymentEvent(supabase, {
        payment_order_id: target.id,
        provider: 'hupijiao',
        provider_order_no: refundResult.providerOrderNo || snapshot.providerOrderNo || null,
        event_key: buildAdminRefundEventKey(target.id, refundResult.providerOrderNo || snapshot.providerOrderNo, actorId),
        event_type: 'admin_refund',
        signature_valid: true,
        amount_valid: null,
        payload: {
            action: 'refund_hupijiao',
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
        resolution: getResolutionText('refund_hupijiao', note),
        auditDetails: {
            refund_provider: 'hupijiao',
            refund_status: normalizeText(refundResult.status).toLowerCase() || 'refunded',
            refund_source: 'admin_action',
            provider_order_no: refundResult.providerOrderNo || snapshot.providerOrderNo || null,
            gateway_open_order_id: refundResult.openOrderId || snapshot.openOrderId || null,
            refund_reclaimed_points: reclaimSummary?.reclaimedPoints || 0,
            refund_reclaimed_paid_points: reclaimSummary?.reclaimedPaidPoints || 0,
            refund_reclaimed_bonus_points: reclaimSummary?.reclaimedBonusPoints || 0
        }
    };
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, requestSupabase, user } = await requireAdmin(req);
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
        const targetProvider = normalizeText(target?.provider);
        const targetProviderOrderNo = normalizeText(target?.provider_order_no || target?.session_key);

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

        if (targetType === 'order' && SENSITIVE_REVIEW_ACTIONS.has(action)) {
            await applyOrderReviewDecision(supabase, target, action, note, user.id);
        }

        let resolvedTarget = target;
        let resolvedStatus = mapActionToStatus(action);
        let resolvedResolution = getResolutionText(action, note);
        let auditDetails = {};

        if (targetType === 'order' && action === 'refund_hupijiao') {
            const refundDecision = await applyHupijiaoRefundDecision(supabase, target, note, user.id, process.env);
            resolvedTarget = refundDecision.order || target;
            resolvedStatus = refundDecision.anomalyStatus || resolvedStatus;
            resolvedResolution = refundDecision.resolution || resolvedResolution;
            auditDetails = refundDecision.auditDetails || {};
        }

        const anomalyCase = await upsertAnomalyCase(supabase, {
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

        await writeAdminAuditLog({
            supabase: requestSupabase || supabase,
            adminId: user.id,
            actionType: 'payments.anomaly.action',
            details: {
                targetType,
                targetId,
                targetProvider,
                targetProviderOrderNo,
                action,
                note: note || null,
                status: anomalyCase.status,
                ...auditDetails
            }
        });

        return sendJson(res, 200, {
            success: true,
            anomaly_case: anomalyCase
        });
    } catch (error) {
        return sendJson(res, error?.statusCode || 500, {
            success: false,
            message: error?.message || 'Failed to apply anomaly action'
        });
    }
};
