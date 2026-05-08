const crypto = require('crypto');
const {
    formatAlertTimestamp
} = require('./alert-time');

function normalizeText(value, maxLength = 1000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeTicketStatus(value) {
    const normalized = normalizeText(value, 40).toUpperCase();
    if (!normalized || normalized === 'OPEN') {
        return 'PENDING';
    }
    return normalized;
}

function getTicketStatusLabel(value) {
    const normalized = normalizeTicketStatus(value);
    const labelMap = {
        PENDING: '待处理',
        RESOLVED: '已解决',
        REJECTED: '已拒绝'
    };
    return labelMap[normalized] || normalized || '待处理';
}

function buildTicketCreatedAlert(ticket = {}) {
    const ticketId = normalizeText(ticket.id, 120);
    const shortTicketId = ticketId ? ticketId.slice(0, 8) : 'unknown';
    const orderId = normalizeText(ticket.order_id, 120);
    const userId = normalizeText(ticket.user_id, 120);
    const userEmail = normalizeText(ticket.user_email, 255);
    const issueType = normalizeText(ticket.issue_type, 60).toUpperCase() || 'OTHER';
    const site = normalizeText(ticket.site, 20).toLowerCase() || 'cn';
    const status = normalizeTicketStatus(ticket.status);
    const description = normalizeText(ticket.reason || ticket.description, 1500);
    const createdAt = normalizeText(ticket.created_at, 80);
    const displayCreatedAt = formatAlertTimestamp(createdAt) || createdAt;
    const updatedAt = normalizeText(ticket.updated_at, 80) || createdAt || null;
    const lines = [
        `收到新的售后工单，请尽快跟进。`,
        `当前状态：${getTicketStatusLabel(status)}`
    ];

    if (orderId) {
        lines.push(`订单号：${orderId}`);
    }
    if (userEmail) {
        lines.push(`用户邮箱：${userEmail}`);
    }
    if (userId) {
        lines.push(`用户ID：${userId}`);
    }
    if (description) {
        lines.push(`问题描述：${description}`);
    }
    if (displayCreatedAt) {
        lines.push(`创建时间：${displayCreatedAt}`);
    }
    lines.push('处理入口：售后工单 -> 待处理 -> 工单详情');

    return {
        alertType: 'ticket_new',
        severity: 'warning',
        title: `新售后工单（${shortTicketId}）`,
        content: lines.join('\n'),
        payload: {
            target_id: ticketId || null,
            ticket_id: ticketId || null,
            order_id: orderId || null,
            user_id: userId || null,
            user_email: userEmail || null,
            site,
            issue_type: issueType,
            ticket_status: status,
            reason: description || null,
            created_at: createdAt || null,
            updated_at: updatedAt,
            entry_path: '售后工单 -> 待处理 -> 工单详情'
        },
        dedupeKey: crypto
            .createHash('sha256')
            .update(`ticket_new:${ticketId || shortTicketId}`)
            .digest('hex'),
        dedupeWindowMinutes: 24 * 60
    };
}

module.exports = {
    buildTicketCreatedAlert
};
