const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../_lib/admin');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, user } = await requireAdmin(req);
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

        if (doRefund) {
            const { data: orderData, error: orderError } = await supabase
                .from('shop_orders')
                .select('total_price')
                .eq('id', ticket.order_id)
                .single();

            if (orderError || !orderData) {
                return sendJson(res, 400, {
                    success: false,
                    message: `未找到对应的订单号来提取退款积分额: ${orderError?.message || '订单不存在'}`
                });
            }

            refundAmount = Number(orderData.total_price || 0);
            if (refundAmount > 0) {
                const { data: balanceData, error: balanceError } = await supabase
                    .from('points_balance')
                    .select('bonus_balance')
                    .eq('user_id', ticket.user_id)
                    .single();

                if (balanceError || !balanceData) {
                    return sendJson(res, 400, {
                        success: false,
                        message: `无法读取用户积分余额: ${balanceError?.message || '余额不存在'}`
                    });
                }

                const newBalance = Number(balanceData.bonus_balance || 0) + refundAmount;
                const { error: updateBalanceError } = await supabase
                    .from('points_balance')
                    .update({
                        bonus_balance: newBalance,
                        updated_at: new Date().toISOString()
                    })
                    .eq('user_id', ticket.user_id);

                if (updateBalanceError) {
                    return sendJson(res, 400, {
                        success: false,
                        message: `退款失败: ${updateBalanceError.message}`
                    });
                }

                await supabase.from('points_ledger').insert({
                    user_id: ticket.user_id,
                    amount: refundAmount,
                    reason: `工单退款 (订单号: ${String(ticket.order_id || '').substring(0, 8)})`,
                    reference_id: `TICKET_REFUND_${String(ticketId).substring(0, 8)}`
                });
            }
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
        let notifContent = `您的提问 (订单ID: ${String(ticket.order_id || '').substring(0, 8)}) 已经处理完毕。\n`;
        if (adminReply) {
            notifContent += `管理员回复: ${adminReply}`;
        }

        try {
            await supabase.from('system_notifications').insert({
                user_id: ticket.user_id,
                title: notifTitle,
                content: notifContent,
                type: notifType,
                is_read: false
            });
        } catch (notificationError) {
            console.warn('[AdminAPI] Failed to insert notification:', notificationError.message);
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
                refunded: doRefund,
                refund_amount: refundAmount
            }
        });

        return sendJson(res, 200, {
            success: true,
            ticket: updatedRows[0],
            refundAmount
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Ticket processing failed'
        });
    }
};
