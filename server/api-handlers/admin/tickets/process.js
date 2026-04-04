const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    applyShopOrderRefund
} = require('../../../../api/_lib/shop/admin-refunds');
const {
    parseLinkedOpsAlertContext,
    parseLinkedChatSessionContext
} = require('../../../../js/admin-ticket-links');
const {
    insertOpsAlertCaseEvents
} = require('../settings/_ops-alert-case-events');
const {
    sanitizeText,
    normalizeJsonObject,
    fetchExistingCase,
    applyCaseAction,
    persistCase,
    isMissingOpsAlertCasesTableError
} = require('../settings/_ops-alert-cases');

function isMissingNotificationColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    return error?.code === '42703'
        || error?.code === '42P01'
        || (message.includes('column') && message.includes('does not exist'))
        || (message.includes('schema cache') && message.includes('scope'))
        || (message.includes('schema cache') && message.includes('category'));
}

function normalizeTicketStatus(status) {
    const normalized = String(status || '').trim().toUpperCase();
    return !normalized || normalized === 'OPEN' ? 'PENDING' : normalized;
}

function getTicketStatusLabel(status) {
    const normalized = normalizeTicketStatus(status);
    if (normalized === 'PENDING') return '待处理';
    if (normalized === 'RESOLVED') return '已解决';
    if (normalized === 'REJECTED') return '已拒绝';
    return normalized;
}

function buildTicketProcessError(statusCode, message, extra = {}) {
    const error = new Error(message || 'Ticket processing failed');
    error.statusCode = Number(statusCode) || 500;
    Object.assign(error, extra || {});
    return error;
}

function buildLinkedOpsAlertResolution({ ticketId = '', newStatus = '', adminReply = '', doRefund = false, refundAmount = 0 }) {
    const shortTicketId = sanitizeText(ticketId, 120) || 'unknown';
    const statusLabel = String(newStatus || '').trim().toUpperCase() === 'REJECTED' ? '已拒绝' : '已解决';
    const parts = [`关联工单 ${shortTicketId} ${statusLabel}`];

    if (adminReply) {
        parts.push(`处理说明：${sanitizeText(adminReply, 1200)}`);
    }
    if (doRefund && Number(refundAmount || 0) > 0) {
        parts.push(`已退款 ${Math.max(0, Math.round(Number(refundAmount || 0)))} 积分`);
    }

    return sanitizeText(parts.join('；'), 2000);
}

function buildLinkedChatSessionMessage({ ticketId = '', newStatus = '', adminReply = '', doRefund = false, refundAmount = 0 }) {
    const shortTicketId = sanitizeText(ticketId, 120) || 'unknown';
    const statusLabel = String(newStatus || '').trim().toUpperCase() === 'REJECTED' ? '已拒绝' : '已解决';
    const lines = [`[工单处理结果同步] 售后工单 ${shortTicketId} ${statusLabel}`];

    if (adminReply) {
        lines.push(`处理说明：${sanitizeText(adminReply, 1200)}`);
    }
    if (doRefund && Number(refundAmount || 0) > 0) {
        lines.push(`已退回 ${Math.max(0, Math.round(Number(refundAmount || 0)))} 积分`);
    }
    lines.push('如果还有其他问题，可以继续在这里留言。');

    return sanitizeText(lines.join('\n'), 2000);
}

async function syncLinkedChatSessionConversation({
    supabase,
    ticket = {},
    ticketId = '',
    newStatus = '',
    adminReply = '',
    doRefund = false,
    refundAmount = 0
}) {
    const linkedContext = parseLinkedChatSessionContext(ticket.description);
    if (!linkedContext?.session_id) {
        return null;
    }

    const content = buildLinkedChatSessionMessage({
        ticketId,
        newStatus,
        adminReply,
        doRefund,
        refundAmount
    });

    const { error } = await supabase
        .from('chat_messages')
        .insert({
            session_id: linkedContext.session_id,
            user_id: sanitizeText(ticket.user_id, 120) || null,
            content,
            message_type: 'ticket_update',
            is_admin: true
        });

    if (error) {
        throw error;
    }

    return {
        session_id: linkedContext.session_id,
        user_email: linkedContext.user_email || null,
        content
    };
}

async function insertTicketResultNotification(supabase, payload = {}) {
    let response = await supabase
        .from('system_notifications')
        .insert(payload);

    if (!response.error || !isMissingNotificationColumnError(response.error)) {
        return response;
    }

    const legacyPayload = { ...payload };
    delete legacyPayload.scope;
    delete legacyPayload.category;
    response = await supabase
        .from('system_notifications')
        .insert(legacyPayload);

    return response;
}

async function syncLinkedOpsAlertCase({
    supabase,
    user,
    ticket = {},
    ticketId = '',
    newStatus = '',
    adminReply = '',
    doRefund = false,
    refundAmount = 0
}) {
    const linkedContext = parseLinkedOpsAlertContext(ticket.description);
    if (!linkedContext?.category_key || !linkedContext?.target_id) {
        return null;
    }

    const nowIso = new Date().toISOString();
    const existingCase = await fetchExistingCase(supabase, linkedContext.category_key, linkedContext.target_id);
    const resolution = buildLinkedOpsAlertResolution({
        ticketId,
        newStatus,
        adminReply,
        doRefund,
        refundAmount
    });
    const nextRecord = applyCaseAction(existingCase, 'resolve', {
        category_key: linkedContext.category_key,
        target_id: linkedContext.target_id,
        alert_type: linkedContext.alert_type,
        title: linkedContext.title,
        reference_label: linkedContext.reference_label,
        reference_value: linkedContext.reference_value,
        metadata: {
            alert_type: linkedContext.alert_type,
            title: linkedContext.title,
            reference_label: linkedContext.reference_label,
            reference_value: linkedContext.reference_value,
            linked_ticket_id: sanitizeText(ticketId, 120) || null,
            linked_ticket_status: sanitizeText(newStatus, 40).toUpperCase() || null
        }
    }, {
        resolution,
        metadata: {
            linked_ticket_id: sanitizeText(ticketId, 120) || null,
            linked_ticket_status: sanitizeText(newStatus, 40).toUpperCase() || null
        },
        user,
        nowIso
    });
    const persisted = await persistCase(supabase, nextRecord);

    await insertOpsAlertCaseEvents(supabase, [{
        action: 'resolve',
        item: {
            category_key: linkedContext.category_key,
            target_id: linkedContext.target_id,
            alert_type: linkedContext.alert_type,
            title: linkedContext.title,
            reference_label: linkedContext.reference_label,
            reference_value: linkedContext.reference_value,
            metadata: normalizeJsonObject(persisted?.metadata)
        },
        record: persisted,
        user,
        resolution,
        metadata: {
            linked_ticket_id: sanitizeText(ticketId, 120) || null,
            linked_ticket_status: sanitizeText(newStatus, 40).toUpperCase() || null
        },
        nowIso
    }]);

    return {
        category_key: linkedContext.category_key,
        target_id: linkedContext.target_id,
        resolution
    };
}

async function processTicketWithContext({
    supabase,
    user,
    ticketId = '',
    newStatus = '',
    adminReply = '',
    internalNote = '',
    doRefund = false,
    source = 'ticket.process'
} = {}) {
    const normalizedTicketId = String(ticketId || '').trim();
    const normalizedNewStatus = String(newStatus || '').trim().toUpperCase();
    const normalizedAdminReply = String(adminReply || '').trim();
    const normalizedInternalNote = String(internalNote || '').trim();
    const normalizedDoRefund = Boolean(doRefund);

    if (!supabase || !user?.id) {
        throw buildTicketProcessError(500, '缺少工单处理上下文');
    }

    if (!normalizedTicketId || !normalizedNewStatus) {
        throw buildTicketProcessError(400, 'ticketId and newStatus are required');
    }

    if (!['RESOLVED', 'REJECTED'].includes(normalizedNewStatus)) {
        throw buildTicketProcessError(400, 'Unsupported ticket status');
    }

    if (!normalizedAdminReply && normalizedNewStatus === 'REJECTED') {
        throw buildTicketProcessError(400, '拒绝工单时请填写回复理由');
    }

    if (normalizedDoRefund && normalizedNewStatus !== 'RESOLVED') {
        throw buildTicketProcessError(400, '只有解决工单时才能执行退款');
    }

    const { data: ticket, error: ticketError } = await supabase
        .from('shop_tickets')
        .select('*')
        .eq('id', normalizedTicketId)
        .single();

    if (ticketError || !ticket) {
        throw buildTicketProcessError(404, '找不到该工单数据');
    }

    const currentStatus = normalizeTicketStatus(ticket.status);
    if (currentStatus !== 'PENDING') {
        throw buildTicketProcessError(409, `工单当前状态为${getTicketStatusLabel(currentStatus)}，不能重复处理`, {
            ticket
        });
    }

    let refundAmount = 0;
    let refundDuplicate = false;

    if (normalizedDoRefund) {
        if (!ticket.order_id) {
            throw buildTicketProcessError(400, '当前工单没有关联订单，无法执行退款');
        }

        const refundResult = await applyShopOrderRefund({
            supabase,
            adminId: user.id,
            orderId: ticket.order_id,
            targetStatus: 'frozen',
            remark: normalizedAdminReply || `工单处理退款 (${String(normalizedTicketId).substring(0, 8)})`
        });

        refundAmount = refundResult.refundedAmount;
        refundDuplicate = refundResult.duplicate === true;
    }

    const { data: updatedRows, error: updateError } = await supabase
        .from('shop_tickets')
        .update({
            status: normalizedNewStatus,
            admin_notes: normalizedAdminReply || null,
            updated_at: new Date().toISOString()
        })
        .eq('id', normalizedTicketId)
        .select('*');

    if (updateError || !updatedRows?.length) {
        throw buildTicketProcessError(400, updateError?.message || '更新失败：工单不存在或您没有管理员权限修改它');
    }

    const updatedTicket = updatedRows[0];
    const notifTitle = normalizedNewStatus === 'RESOLVED' ? '工单已解决' : '工单已被拒绝';
    const notifType = normalizedNewStatus === 'RESOLVED' ? 'success' : 'warning';
    const ticketSubject = ticket.order_id
        ? `您的提问 (订单ID: ${String(ticket.order_id || '').substring(0, 8)})`
        : `您的售后工单 (${String(normalizedTicketId || '').substring(0, 8)})`;
    let notifContent = `${ticketSubject} 已经处理完毕。\n`;
    if (normalizedAdminReply) {
        notifContent += `管理员回复: ${normalizedAdminReply}`;
    }
    if (normalizedDoRefund && !refundDuplicate && refundAmount > 0) {
        notifContent += `${normalizedAdminReply ? '\n' : ''}已退回 ${Math.max(0, Math.round(refundAmount))} 积分。`;
    }

    try {
        await insertTicketResultNotification(supabase, {
            user_id: ticket.user_id,
            title: notifTitle,
            content: notifContent,
            type: notifType,
            is_read: false,
            scope: 'user_personal',
            category: 'ticket_result'
        });
    } catch (notificationError) {
        console.warn('[AdminAPI] Failed to insert notification:', notificationError.message);
    }

    let linkedOpsAlertCase = null;
    try {
        linkedOpsAlertCase = await syncLinkedOpsAlertCase({
            supabase,
            user,
            ticket: updatedTicket,
            ticketId: normalizedTicketId,
            newStatus: normalizedNewStatus,
            adminReply: normalizedAdminReply,
            doRefund: normalizedDoRefund && !refundDuplicate,
            refundAmount
        });
    } catch (opsAlertSyncError) {
        if (isMissingOpsAlertCasesTableError(opsAlertSyncError)) {
            console.warn('[AdminAPI] Ops alert case table is unavailable, skip ticket backfill');
        } else {
            console.warn('[AdminAPI] Failed to sync linked ops alert case:', opsAlertSyncError.message || opsAlertSyncError);
        }
    }

    let linkedChatSession = null;
    try {
        linkedChatSession = await syncLinkedChatSessionConversation({
            supabase,
            ticket: updatedTicket,
            ticketId: normalizedTicketId,
            newStatus: normalizedNewStatus,
            adminReply: normalizedAdminReply,
            doRefund: normalizedDoRefund && !refundDuplicate,
            refundAmount
        });
    } catch (chatSyncError) {
        console.warn('[AdminAPI] Failed to sync linked chat session:', chatSyncError.message || chatSyncError);
    }

    if (normalizedInternalNote) {
        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            targetUserId: ticket.user_id,
            actionType: 'ticket.internal_note',
            details: {
                ticket_id: normalizedTicketId,
                order_id: ticket.order_id,
                ticket_status: normalizedNewStatus,
                ticket_status_label: getTicketStatusLabel(normalizedNewStatus),
                note: normalizedInternalNote,
                public_reply: normalizedAdminReply || null,
                source
            }
        });
    }

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        targetUserId: ticket.user_id,
        actionType: 'ticket.process',
        details: {
            ticket_id: normalizedTicketId,
            order_id: ticket.order_id,
            previous_status: currentStatus,
            previous_status_label: getTicketStatusLabel(currentStatus),
            new_status: normalizedNewStatus,
            new_status_label: getTicketStatusLabel(normalizedNewStatus),
            admin_reply: normalizedAdminReply || null,
            public_reply: normalizedAdminReply || null,
            has_public_reply: Boolean(normalizedAdminReply),
            has_internal_note: Boolean(normalizedInternalNote),
            refunded: normalizedDoRefund && !refundDuplicate,
            refund_amount: refundAmount,
            refund_duplicate: refundDuplicate,
            refund_outcome: refundDuplicate
                ? 'duplicate'
                : (normalizedDoRefund && refundAmount > 0 ? 'refunded' : 'not_requested'),
            linked_ops_alert_case: linkedOpsAlertCase,
            linked_chat_session: linkedChatSession,
            synced_linked_ops_alert_case: Boolean(linkedOpsAlertCase),
            synced_linked_chat_session: Boolean(linkedChatSession),
            source
        }
    });

    return {
        success: true,
        ticket: updatedTicket,
        refundAmount,
        refundDuplicate,
        linkedOpsAlertCase,
        linkedChatSession
    };
}

async function adminTicketsProcessHandler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'tickets.manage' });
        const body = await parseJsonBody(req);
        const result = await processTicketWithContext({
            supabase,
            user,
            ticketId: body.ticketId,
            newStatus: body.newStatus,
            adminReply: body.adminReply,
            internalNote: body.internalNote,
            doRefund: body.doRefund,
            source: 'ticket.process'
        });

        return sendJson(res, 200, result);
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Ticket processing failed',
            ...(error?.ticket ? { ticket: error.ticket } : {})
        });
    }
}

module.exports = adminTicketsProcessHandler;
module.exports.processTicketWithContext = processTicketWithContext;
