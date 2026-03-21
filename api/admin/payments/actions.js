const {
    requireAdmin,
    parseJsonBody,
    sendJson,
    writeAdminAuditLog
} = require('../../_lib/admin');

const VALID_TARGET_TYPES = new Set(['order', 'event', 'session']);
const VALID_ACTIONS = new Set([
    'mark_handled',
    'ignore',
    'request_retry',
    'reopen',
    'approve_review',
    'reject_review'
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
        return 'approved';
    case 'reject_review':
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
    case 'reject_review':
        return '已人工审核驳回。';
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

async function applyOrderReviewDecision(supabase, target, action, note) {
    if (target.status !== 'pending_review') {
        const error = new Error('Only pending_review orders can be approved or rejected');
        error.statusCode = 409;
        throw error;
    }

    const nextStatus = action === 'approve_review' ? 'paid' : 'rejected';
    const nextValues = {
        status: nextStatus,
        updated_at: new Date().toISOString()
    };

    if (action === 'approve_review') {
        nextValues.paid_at = target.paid_at || nextValues.updated_at;
        nextValues.verified_at = nextValues.updated_at;
        nextValues.last_error = null;
    } else {
        nextValues.last_error = normalizeText(note) || '已人工审核驳回';
    }

    const { error: orderError } = await supabase
        .from('payment_orders')
        .update(nextValues)
        .eq('id', target.id);

    if (orderError) throw orderError;

    if (normalizeText(target.provider).toLowerCase() === 'afdian' && normalizeText(target.provider_order_no)) {
        await supabase
            .from('afdian_orders')
            .update({
                payment_status: nextStatus,
                updated_at: new Date().toISOString()
            })
            .eq('out_trade_no', target.provider_order_no);
    }
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

        if (targetType === 'order' && (action === 'approve_review' || action === 'reject_review')) {
            await applyOrderReviewDecision(supabase, target, action, note);
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
