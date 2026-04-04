const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');

const TICKET_HISTORY_ACTION_TYPES = Object.freeze([
    'ticket.assign',
    'ticket.create_from_chat_session',
    'ticket.create_from_ops_alert',
    'ticket.process',
    'ticket.internal_note'
]);

function normalizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeTicketStatus(value) {
    const normalized = normalizeText(value, 40).toUpperCase();
    return !normalized || normalized === 'OPEN' ? 'PENDING' : normalized;
}

function getTicketStatusLabel(value) {
    const normalized = normalizeTicketStatus(value);
    if (normalized === 'PENDING') return '待处理';
    if (normalized === 'RESOLVED') return '已解决';
    if (normalized === 'REJECTED') return '已拒绝';
    return normalized || '待处理';
}

function isMissingRelationError(error, relationName = '') {
    const normalizedMessage = normalizeText(error?.message, 600).toLowerCase();
    const normalizedRelation = normalizeText(relationName, 120).toLowerCase();

    if (!normalizedMessage) {
        return false;
    }

    const mentionsRelation = normalizedRelation
        ? normalizedMessage.includes(normalizedRelation)
        : normalizedMessage.includes('relation') || normalizedMessage.includes('table');

    return mentionsRelation && (
        normalizedMessage.includes('does not exist')
        || normalizedMessage.includes('not exist')
        || normalizedMessage.includes('could not find')
        || normalizedMessage.includes('undefined table')
    );
}

async function fetchAuditRows(supabase, tableName = 'admin_audit_logs_view', selection = 'id, action_type, details, created_at, admin_id, admin_email') {
    const { data, error } = await supabase
        .from(tableName)
        .select(selection)
        .in('action_type', TICKET_HISTORY_ACTION_TYPES)
        .order('created_at', { ascending: false })
        .limit(200);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function fetchTicketAuditRows(supabase, ticketId = '') {
    const normalizedTicketId = normalizeText(ticketId, 120);
    if (!normalizedTicketId) {
        return [];
    }

    let rows = [];
    try {
        rows = await fetchAuditRows(supabase, 'admin_audit_logs_view', 'id, action_type, details, created_at, admin_id, admin_email');
    } catch (error) {
        if (!isMissingRelationError(error, 'admin_audit_logs_view')) {
            throw error;
        }

        try {
            rows = await fetchAuditRows(supabase, 'admin_audit_logs', 'id, action_type, details, created_at, admin_id');
        } catch (fallbackError) {
            if (isMissingRelationError(fallbackError, 'admin_audit_logs')) {
                return [];
            }
            throw fallbackError;
        }
    }

    return rows
        .filter((row) => normalizeText(normalizeJsonObject(row.details).ticket_id, 120) === normalizedTicketId)
        .sort((left, right) => Date.parse(normalizeText(left?.created_at, 80)) - Date.parse(normalizeText(right?.created_at, 80)));
}

function buildHistoryTitle(actionType = '', details = {}) {
    const normalizedAction = normalizeText(actionType, 120).toLowerCase();

    if (normalizedAction === 'ticket.create_from_chat_session') {
        return '从客服会话创建工单';
    }
    if (normalizedAction === 'ticket.create_from_ops_alert') {
        return '从站内代办创建工单';
    }
    if (normalizedAction === 'ticket.assign') {
        return details.assigned === false ? '取消负责人' : '指派负责人';
    }
    if (normalizedAction === 'ticket.process') {
        const status = normalizeTicketStatus(details.new_status);
        if (status === 'RESOLVED') {
            return '管理员解决工单';
        }
        if (status === 'REJECTED') {
            return '管理员拒绝工单';
        }
        return '管理员处理工单';
    }
    if (normalizedAction === 'ticket.internal_note') {
        return '添加内部备注';
    }

    return normalizedAction || '工单历史';
}

function buildHistoryIcon(actionType = '', details = {}) {
    const normalizedAction = normalizeText(actionType, 120).toLowerCase();

    if (normalizedAction === 'ticket.create_from_chat_session') {
        return 'fa-comments';
    }
    if (normalizedAction === 'ticket.create_from_ops_alert') {
        return 'fa-sitemap';
    }
    if (normalizedAction === 'ticket.assign') {
        return details.assigned === false ? 'fa-user-slash' : 'fa-user-check';
    }
    if (normalizedAction === 'ticket.process') {
        const status = normalizeTicketStatus(details.new_status);
        if (status === 'RESOLVED') {
            return 'fa-circle-check';
        }
        if (status === 'REJECTED') {
            return 'fa-circle-xmark';
        }
        return 'fa-headset';
    }
    if (normalizedAction === 'ticket.internal_note') {
        return 'fa-note-sticky';
    }

    return 'fa-clock-rotate-left';
}

function buildHistoryTone(actionType = '', details = {}) {
    const normalizedAction = normalizeText(actionType, 120).toLowerCase();
    if (normalizedAction === 'ticket.assign') {
        return details.assigned === false ? 'warning' : '';
    }
    if (normalizedAction !== 'ticket.process') {
        return '';
    }

    const status = normalizeTicketStatus(details.new_status);
    if (status === 'RESOLVED') {
        return 'success';
    }
    if (status === 'REJECTED') {
        return 'danger';
    }
    return '';
}

function buildHistoryDetail(row = {}) {
    const details = normalizeJsonObject(row.details);
    const normalizedAction = normalizeText(row.action_type, 120).toLowerCase();
    const actor = normalizeText(row.admin_email, 255) || normalizeText(row.admin_id, 120);
    const publicReply = normalizeText(details.public_reply || details.admin_reply, 2000);
    const lines = [];

    if (normalizedAction === 'ticket.create_from_chat_session' || normalizedAction === 'ticket.create_from_ops_alert') {
        if (actor) {
            lines.push(`操作人：${actor}`);
        }
        if (normalizeText(details.order_id, 120)) {
            lines.push(`关联订单：${normalizeText(details.order_id, 120)}`);
        }
        if (normalizeText(details.source, 80)) {
            lines.push(`来源类型：${normalizeText(details.source, 80)}`);
        }
        if (normalizeText(details.source_reference_label, 120) && normalizeText(details.source_reference_value, 240)) {
            lines.push(`${normalizeText(details.source_reference_label, 120)}：${normalizeText(details.source_reference_value, 240)}`);
        }
        if (normalizeText(details.source_alert_type, 160)) {
            lines.push(`告警类型：${normalizeText(details.source_alert_type, 160)}`);
        }
    } else if (normalizedAction === 'ticket.assign') {
        if (actor) {
            lines.push(`操作人：${actor}`);
        }
        if (normalizeText(details.previous_assignee_label, 255) || normalizeText(details.previous_assignee_id, 120)) {
            lines.push(`之前负责人：${normalizeText(details.previous_assignee_label, 255) || normalizeText(details.previous_assignee_id, 120)}`);
        }
        if (details.assigned === false) {
            lines.push('当前负责人：未指派');
        } else if (normalizeText(details.assignee_label, 255) || normalizeText(details.assignee_id, 120)) {
            lines.push(`当前负责人：${normalizeText(details.assignee_label, 255) || normalizeText(details.assignee_id, 120)}`);
        }
        if (normalizeText(details.ticket_status, 40)) {
            lines.push(`工单状态：${getTicketStatusLabel(details.ticket_status)}`);
        }
    } else if (normalizedAction === 'ticket.process') {
        if (actor) {
            lines.push(`处理人：${actor}`);
        }
        if (normalizeText(details.previous_status, 40)) {
            lines.push(`状态流转：${getTicketStatusLabel(details.previous_status)} -> ${getTicketStatusLabel(details.new_status)}`);
        }
        lines.push(`处理结果：${getTicketStatusLabel(details.new_status)}`);
        if (publicReply) {
            lines.push(`管理员回复：${publicReply}`);
        }
        if (details.refunded === true) {
            lines.push(`退款结果：已退回 ${Math.max(0, Math.round(Number(details.refund_amount || 0)))} 积分`);
        } else if (details.refund_duplicate === true) {
            lines.push('退款结果：关联订单此前已退款，无需重复退回');
        } else if (normalizeText(details.order_id, 120)) {
            lines.push(`关联订单：${normalizeText(details.order_id, 120)}`);
        }
        if (details.synced_linked_chat_session === true || normalizeText(normalizeJsonObject(details.linked_chat_session).session_id, 120)) {
            lines.push('同步客服会话：已回写处理结果');
        }
        if (details.synced_linked_ops_alert_case === true || normalizeText(normalizeJsonObject(details.linked_ops_alert_case).target_id, 120)) {
            lines.push('同步站内代办：已回写处理结果');
        }
    } else if (normalizedAction === 'ticket.internal_note') {
        if (actor) {
            lines.push(`记录人：${actor}`);
        }
        if (normalizeText(details.ticket_status || details.new_status, 40)) {
            lines.push(`工单状态：${getTicketStatusLabel(details.ticket_status || details.new_status)}`);
        }
        if (publicReply) {
            lines.push(`关联回复：${publicReply}`);
        }
        if (normalizeText(details.note || details.internal_note, 2000)) {
            lines.push(`内部备注：${normalizeText(details.note || details.internal_note, 2000)}`);
        }
    }

    return lines.join('\n');
}

function mapHistoryRow(row = {}) {
    const details = normalizeJsonObject(row.details);
    return {
        id: normalizeText(row.id, 120) || null,
        action_type: normalizeText(row.action_type, 120) || null,
        title: buildHistoryTitle(row.action_type, details),
        detail: buildHistoryDetail(row),
        time: normalizeText(row.created_at, 80) || null,
        created_at: normalizeText(row.created_at, 80) || null,
        icon: buildHistoryIcon(row.action_type, details),
        tone: buildHistoryTone(row.action_type, details),
        actor: normalizeText(row.admin_email, 255) || normalizeText(row.admin_id, 120) || null
    };
}

module.exports = async function adminTicketsHistoryHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'tickets.manage' });
        const url = new URL(req.url || '', 'http://localhost');
        const ticketId = normalizeText(url.searchParams.get('ticketId'), 120);

        if (!ticketId) {
            return sendJson(res, 400, {
                success: false,
                message: 'ticketId is required'
            });
        }

        const rows = await fetchTicketAuditRows(supabase, ticketId);
        return sendJson(res, 200, {
            success: true,
            ticketId,
            items: rows.map((row) => mapHistoryRow(row))
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load ticket history'
        });
    }
};
