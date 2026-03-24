const crypto = require('crypto');
const {
    requireAdmin,
    parseJsonBody,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    applyPaymentOrderReview
} = require('../../../../api/_lib/payments/rpc');
const {
    getPaymentProviderAdapter
} = require('../../../../api/_lib/payments/provider-adapters');

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
    payload = null
}) {
    const existingMetadata = normalizeJsonObject(target.provider_metadata);
    const existingRawPayload = normalizeJsonObject(target.raw_payload);
    const nowIso = new Date().toISOString();
    const normalizedRefundStatus = normalizeText(refundStatus).toLowerCase() || 'refunded';
    const orderPatch = {
        status: normalizedRefundStatus === 'refunded' ? 'refunded' : target.status,
        last_error: normalizedRefundStatus === 'refunded' ? null : (target.last_error || null),
        provider_metadata: mergeJsonObjects(existingMetadata, {
            provider_order_no: providerOrderNo || existingMetadata.provider_order_no || target.provider_order_no || null,
            gateway_open_order_id: openOrderId || existingMetadata.gateway_open_order_id || null,
            payment_status: normalizedRefundStatus,
            payment_status_raw: refundStatusRaw || existingMetadata.payment_status_raw || null,
            refund_status: normalizedRefundStatus,
            refund_requested_at: nowIso,
            refund_requested_by: actorId || null,
            refund_note: note || null,
            refund_source: refundSource
        }),
        raw_payload: mergeJsonObjects(existingRawPayload, {
            admin_refund: {
                requested_at: nowIso,
                requested_by: actorId || null,
                note: note || null,
                source: refundSource,
                payload: payload && typeof payload === 'object' ? payload : null
            }
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

    if (snapshot.credited) {
        const error = new Error('当前仅开放未入账的虎皮椒退款；已入账订单需先走人工扣回闭环');
        error.statusCode = 409;
        throw error;
    }

    if (!['pending_review', 'amount_mismatch', 'paid'].includes(snapshot.status)) {
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
                }
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
                    gateway_open_order_id: liveOrder.openOrderId || snapshot.openOrderId || null
                }
            };
        }
    }

    const refundResult = await adapter.refundOrder({
        runtimeContext,
        providerOrderNo: snapshot.providerOrderNo,
        openOrderId: snapshot.openOrderId,
        reason: note
    });

    if (refundResult?.supported === false) {
        const error = new Error(refundResult.message || '虎皮椒退款能力不可用');
        error.statusCode = 503;
        throw error;
    }

    if (!refundResult?.success) {
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
                response: refundResult || null,
                note: note || null
            },
            processing_result: 'admin_refund_failed',
            error_message: refundResult?.message || '虎皮椒退款失败',
            response_status: 502,
            processed_at: new Date().toISOString()
        });

        const error = new Error(refundResult?.message || '虎皮椒退款失败');
        error.statusCode = 502;
        throw error;
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
        }
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
            gateway_open_order_id: refundResult.openOrderId || snapshot.openOrderId || null
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
