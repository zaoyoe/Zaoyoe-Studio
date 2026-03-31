const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function normalizeAlertType(value) {
    return sanitizeText(value, 120).toLowerCase();
}

function normalizeSource(value) {
    return sanitizeText(value, 80).toLowerCase();
}

function buildTicketDescription(body = {}, actorLabel = '') {
    const source = normalizeSource(body.source || body.source_type || body.sourceType);
    const title = sanitizeText(body.title, 240);
    const alertType = normalizeAlertType(body.alert_type || body.alertType);
    const referenceLabel = sanitizeText(body.reference_label || body.referenceLabel, 120);
    const referenceValue = sanitizeText(body.reference_value || body.referenceValue, 240);
    const content = sanitizeText(body.content, 900);
    const targetId = sanitizeText(body.target_id || body.targetId, 200);
    const orderId = sanitizeText(body.order_id || body.orderId, 120);
    const paymentOrderId = sanitizeText(body.payment_order_id || body.paymentOrderId, 120);
    const userEmail = sanitizeText(body.user_email || body.userEmail, 255);
    const sessionId = sanitizeText(body.session_id || body.sessionId, 160);
    const note = sanitizeText(body.note || body.admin_note || body.adminNote, 800);
    const entryPath = sanitizeText(body.entry_path || body.entryPath, 160);

    const lines = [source === 'chat_session' ? '[客服会话转工单]' : '[站内代办转工单]'];
    if (title) lines.push(`告警标题：${title}`);
    if (source === 'chat_session') {
        if (userEmail) lines.push(`用户邮箱：${userEmail}`);
        if (sessionId) lines.push(`会话标识：${sessionId}`);
    } else if (alertType) {
        lines.push(`告警类型：${alertType}`);
    }
    if (referenceLabel && referenceValue) {
        lines.push(`${referenceLabel}：${referenceValue}`);
    }
    if (orderId) lines.push(`订单号：${orderId}`);
    if (paymentOrderId) lines.push(`支付单号：${paymentOrderId}`);
    if (targetId) lines.push(`告警标识：${targetId}`);
    if (entryPath) lines.push(`处理入口：${entryPath}`);
    if (actorLabel) lines.push(`转单管理员：${actorLabel}`);
    if (note) lines.push(`${source === 'chat_session' ? '客服备注' : '补充说明'}：${note}`);
    if (content) {
        lines.push(source === 'chat_session' ? '会话摘要：' : '原始告警：');
        lines.push(content);
    }

    return sanitizeText(lines.join('\n'), 1500);
}

async function resolveTicketUserId(supabase, body = {}) {
    const explicitUserId = sanitizeText(body.user_id || body.userId, 120);
    if (explicitUserId) {
        return {
            userId: explicitUserId,
            orderId: sanitizeText(body.order_id || body.orderId, 120),
            paymentOrderId: sanitizeText(body.payment_order_id || body.paymentOrderId, 120)
        };
    }

    const explicitOrderId = sanitizeText(body.order_id || body.orderId, 120);
    if (explicitOrderId && isUuid(explicitOrderId)) {
        const { data, error } = await supabase
            .from('shop_orders')
            .select('id, user_id')
            .eq('id', explicitOrderId)
            .maybeSingle();

        if (error) {
            throw new Error(error.message || '读取订单归属失败');
        }

        if (data?.user_id) {
            return {
                userId: sanitizeText(data.user_id, 120),
                orderId: sanitizeText(data.id, 120),
                paymentOrderId: sanitizeText(body.payment_order_id || body.paymentOrderId, 120)
            };
        }
    }

    const explicitPaymentOrderId = sanitizeText(body.payment_order_id || body.paymentOrderId, 120);
    if (explicitPaymentOrderId && isUuid(explicitPaymentOrderId)) {
        const { data, error } = await supabase
            .from('payment_orders')
            .select('id, user_id')
            .eq('id', explicitPaymentOrderId)
            .maybeSingle();

        if (error) {
            throw new Error(error.message || '读取支付单归属失败');
        }

        if (data?.user_id) {
            return {
                userId: sanitizeText(data.user_id, 120),
                orderId: explicitOrderId,
                paymentOrderId: sanitizeText(data.id, 120)
            };
        }
    }

    return {
        userId: '',
        orderId: explicitOrderId,
        paymentOrderId: explicitPaymentOrderId
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
        const source = normalizeSource(body.source || body.source_type || body.sourceType);
        const actorLabel = sanitizeText(user?.email, 255) || sanitizeText(user?.id, 120) || 'unknown';
        const resolved = await resolveTicketUserId(supabase, body);
        const userId = sanitizeText(resolved.userId, 120);

        if (!userId) {
            return sendJson(res, 400, {
                success: false,
                message: '当前告警缺少可归属用户，暂不支持直接转为售后工单'
            });
        }

        const description = buildTicketDescription(body, actorLabel);
        if (!description) {
            return sendJson(res, 400, {
                success: false,
                message: '缺少工单描述'
            });
        }

        const insertPayload = {
            user_id: userId,
            issue_type: 'OTHER',
            status: 'PENDING',
            description
        };

        if (resolved.orderId && isUuid(resolved.orderId)) {
            insertPayload.order_id = resolved.orderId;
        }

        const { data, error } = await supabase
            .from('shop_tickets')
            .insert(insertPayload)
            .select('id, user_id, order_id, issue_type, status, description, created_at, updated_at')
            .single();

        if (error || !data) {
            return sendJson(res, 400, {
                success: false,
                message: error?.message || '工单创建失败'
            });
        }

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            targetUserId: data.user_id,
            actionType: source === 'chat_session' ? 'ticket.create_from_chat_session' : 'ticket.create_from_ops_alert',
            details: {
                ticket_id: data.id,
                order_id: data.order_id || null,
                source,
                source_alert_type: normalizeAlertType(body.alert_type || body.alertType),
                source_target_id: sanitizeText(body.target_id || body.targetId, 200) || null,
                source_reference_label: sanitizeText(body.reference_label || body.referenceLabel, 120) || null,
                source_reference_value: sanitizeText(body.reference_value || body.referenceValue, 240) || null
            }
        });

        return sendJson(res, 200, {
            success: true,
            message: '已从站内代办创建售后工单',
            ticket: data,
            ticket_id: data.id
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Ticket creation failed'
        });
    }
};
