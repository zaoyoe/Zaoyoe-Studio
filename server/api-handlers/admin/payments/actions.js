const {
    requireAdmin,
    parseJsonBody,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const VALID_TARGET_TYPES = new Set(['order', 'event', 'session']);
const VALID_ACTIONS = new Set([
    'mark_handled',
    'ignore',
    'request_retry',
    'reopen',
    'approve_review',
    'reject_review',
    'approve_amount_mismatch',
    'reject_amount_mismatch'
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

function mapActionToStatus(action) {
    switch (action) {
    case 'mark_handled':
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
            .select('id, provider, provider_order_no, status, paid_at, verified_at, last_error, provider_metadata')
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

    const { data, error } = await supabase.rpc('fn_apply_payment_order_review', {
        p_payment_order_id: target.id,
        p_action: normalizeReviewRpcAction(action),
        p_note: normalizeText(note) || null,
        p_actor_id: actorId || null
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

        if (SENSITIVE_REVIEW_ACTIONS.has(action) && !note) {
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

        const anomalyCase = await upsertAnomalyCase(supabase, {
            targetType,
            targetId,
            targetProvider,
            targetProviderOrderNo,
            status: mapActionToStatus(action),
            note,
            resolution: getResolutionText(action, note),
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
                status: anomalyCase.status
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
