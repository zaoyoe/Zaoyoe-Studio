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

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'tickets.manage' });
        const body = await parseJsonBody(req);
        const ticketId = String(body.ticketId || '').trim();
        const newStatus = String(body.newStatus || '').trim().toUpperCase();
        const adminReply = String(body.adminReply || '').trim();
        const doRefund = Boolean(body.doRefund);

        if (!ticketId || !newStatus) {
            return sendJson(res, 400, { success: false, message: 'ticketId and newStatus are required' });
        }

        if (!['RESOLVED', 'REJECTED'].includes(newStatus)) {
            return sendJson(res, 400, { success: false, message: 'Unsupported ticket status' });
        }

        if (!adminReply && newStatus === 'REJECTED') {
            return sendJson(res, 400, { success: false, message: '拒绝工单时请填写回复理由' });
        }

        const { data: ticket, error: ticketError } = await supabase
            .from('shop_tickets')
            .select('*')
            .eq('id', ticketId)
            .single();

        if (ticketError || !ticket) {
            return sendJson(res, 404, { success: false, message: '找不到该工单数据' });
        }

        let refundAmount = 0;
        let refundDuplicate = false;

        if (doRefund) {
            if (!ticket.order_id) {
                return sendJson(res, 400, {
                    success: false,
                    message: '当前工单没有关联订单，无法执行退款'
                });
            }

            const refundResult = await applyShopOrderRefund({
                supabase,
                adminId: user.id,
                orderId: ticket.order_id,
                targetStatus: 'frozen',
                remark: adminReply || `工单处理退款 (${String(ticketId).substring(0, 8)})`
            });

            refundAmount = refundResult.refundedAmount;
            refundDuplicate = refundResult.duplicate === true;
        }

        const { data: updatedRows, error: updateError } = await supabase
            .from('shop_tickets')
            .update({
                status: newStatus,
                admin_notes: adminReply || null,
                updated_at: new Date().toISOString()
            })
            .eq('id', ticketId)
            .select('*');

        if (updateError || !updatedRows?.length) {
            return sendJson(res, 400, {
                success: false,
                message: updateError?.message || '更新失败：工单不存在或您没有管理员权限修改它'
            });
        }

        const notifTitle = newStatus === 'RESOLVED' ? '工单已解决' : '工单已被拒绝';
        const notifType = newStatus === 'RESOLVED' ? 'success' : 'warning';
        const ticketSubject = ticket.order_id
            ? `您的提问 (订单ID: ${String(ticket.order_id || '').substring(0, 8)})`
            : `您的售后工单 (${String(ticketId || '').substring(0, 8)})`;
        let notifContent = `${ticketSubject} 已经处理完毕。\n`;
        if (adminReply) {
            notifContent += `管理员回复: ${adminReply}`;
        }
        if (doRefund && !refundDuplicate && refundAmount > 0) {
            notifContent += `${adminReply ? '\n' : ''}已退回 ${Math.max(0, Math.round(refundAmount))} 积分。`;
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
                ticket: updatedRows[0],
                ticketId,
                newStatus,
                adminReply,
                doRefund: doRefund && !refundDuplicate,
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
                ticket: updatedRows[0],
                ticketId,
                newStatus,
                adminReply,
                doRefund: doRefund && !refundDuplicate,
                refundAmount
            });
        } catch (chatSyncError) {
            console.warn('[AdminAPI] Failed to sync linked chat session:', chatSyncError.message || chatSyncError);
        }

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            targetUserId: ticket.user_id,
            actionType: 'ticket.process',
            details: {
                ticket_id: ticketId,
                order_id: ticket.order_id,
                new_status: newStatus,
                admin_reply: adminReply || null,
                refunded: doRefund && !refundDuplicate,
                refund_amount: refundAmount,
                refund_duplicate: refundDuplicate,
                linked_ops_alert_case: linkedOpsAlertCase,
                linked_chat_session: linkedChatSession
            }
        });

        return sendJson(res, 200, {
            success: true,
            ticket: updatedRows[0],
            refundAmount,
            refundDuplicate,
            linkedOpsAlertCase,
            linkedChatSession
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Ticket processing failed'
        });
    }
};
