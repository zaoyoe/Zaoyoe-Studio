(function (root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root && typeof root === 'object') {
        root.AdminTicketLinks = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const OPS_ALERT_TICKET_PREFIX = '[站内代办转工单]';
    const CHAT_SESSION_TICKET_PREFIX = '[客服会话转工单]';
    const COMMENT_TICKET_PREFIX = '[评论管理转工单]';

    function sanitizeText(value, maxLength = 4000) {
        return String(value || '').trim().slice(0, Math.max(0, maxLength));
    }

    function normalizeSource(value) {
        return sanitizeText(value, 80).toLowerCase();
    }

    function normalizeAlertType(value) {
        return sanitizeText(value, 120).toLowerCase();
    }

    function normalizeCommentTicketView(value) {
        const normalized = sanitizeText(value, 40).toLowerCase();
        if (normalized === 'gallery') return 'gallery';
        if (normalized === 'guestbook') return 'guestbook';
        return '';
    }

    function inferLinkedOpsAlertCategoryKey(context = {}) {
        const targetId = sanitizeText(context.target_id || context.targetId, 200).toLowerCase();
        if (targetId.startsWith('shop_order_risk:')) {
            return 'shop_risk';
        }

        const alertType = normalizeAlertType(context.alert_type || context.alertType);
        if (alertType.startsWith('payment_')) return 'payments';
        if (alertType.startsWith('ticket_')) return 'tickets';
        if (alertType.startsWith('shop_inventory_')) return 'inventory';
        if (alertType.startsWith('shop_order_delivery_')) return 'fulfillment';
        if (alertType === 'shop_order_risk_anomaly' || alertType === 'shop_order_risk_recovered') return 'shop_risk';
        if (alertType.startsWith('verify_')) return 'verify';
        if (alertType.startsWith('security_')) return 'security';
        if (alertType.startsWith('customer_chat_message_')) return 'customer_engagement';
        if (alertType.startsWith('shop_purchase_') || alertType.startsWith('wallet_recharge_')) return 'commerce';
        return '';
    }

    function parseLinkedOpsAlertContext(description = '') {
        const normalizedDescription = sanitizeText(description, 4000);
        if (!normalizedDescription.includes(OPS_ALERT_TICKET_PREFIX)) {
            return null;
        }

        const lines = normalizedDescription
            .split(/\r?\n/)
            .map((line) => sanitizeText(line, 4000))
            .filter(Boolean);

        const context = {
            alert_type: '',
            target_id: '',
            title: '',
            reference_label: '',
            reference_value: ''
        };

        for (const line of lines) {
            if (line.startsWith('告警类型：')) {
                context.alert_type = normalizeAlertType(line.slice('告警类型：'.length));
                continue;
            }
            if (line.startsWith('告警标识：')) {
                context.target_id = sanitizeText(line.slice('告警标识：'.length), 200);
                continue;
            }
            if (line.startsWith('告警标题：')) {
                context.title = sanitizeText(line.slice('告警标题：'.length), 240);
                continue;
            }
            const matchedReference = line.match(/^(订单号|支付单号|用户ID|会话ID|消息ID|工单号)：(.+)$/);
            if (matchedReference && !context.reference_label && !context.reference_value) {
                context.reference_label = sanitizeText(matchedReference[1], 120);
                context.reference_value = sanitizeText(matchedReference[2], 240);
            }
        }

        context.category_key = inferLinkedOpsAlertCategoryKey(context);
        return context.category_key && context.target_id ? context : null;
    }

    function parseLinkedChatSessionContext(description = '') {
        const normalizedDescription = sanitizeText(description, 4000);
        if (!normalizedDescription.includes(CHAT_SESSION_TICKET_PREFIX)) {
            return null;
        }

        const lines = normalizedDescription
            .split(/\r?\n/)
            .map((line) => sanitizeText(line, 4000))
            .filter(Boolean);

        const context = {
            title: '',
            session_id: '',
            user_email: ''
        };

        for (const line of lines) {
            if (line.startsWith('告警标题：')) {
                context.title = sanitizeText(line.slice('告警标题：'.length), 240);
                continue;
            }
            if (line.startsWith('会话标识：')) {
                context.session_id = sanitizeText(line.slice('会话标识：'.length), 160);
                continue;
            }
            if (line.startsWith('用户邮箱：')) {
                context.user_email = sanitizeText(line.slice('用户邮箱：'.length), 255);
            }
        }

        if (!context.session_id && context.user_email) {
            context.session_id = context.user_email;
        }

        return context.session_id || context.user_email ? context : null;
    }

    function parseLinkedCommentContext(description = '') {
        const normalizedDescription = sanitizeText(description, 4000);
        if (!normalizedDescription.includes(COMMENT_TICKET_PREFIX)) {
            return null;
        }

        const lines = normalizedDescription
            .split(/\r?\n/)
            .map((line) => sanitizeText(line, 4000))
            .filter(Boolean);

        const context = {
            view: '',
            entity_type: '',
            entity_label: '',
            comment_id: '',
            prompt_id: '',
            message_id: '',
            context_title: '',
            author: '',
            site: ''
        };

        for (const line of lines) {
            if (line.startsWith('评论视图：')) {
                context.view = normalizeCommentTicketView(line.slice('评论视图：'.length));
                continue;
            }
            if (line.startsWith('实体类型：')) {
                context.entity_type = sanitizeText(line.slice('实体类型：'.length), 80).toLowerCase();
                continue;
            }
            if (line.startsWith('评论类型：')) {
                context.entity_label = sanitizeText(line.slice('评论类型：'.length), 120);
                continue;
            }
            if (line.startsWith('评论来源：') && !context.entity_label) {
                context.entity_label = sanitizeText(line.slice('评论来源：'.length), 120);
                continue;
            }
            if (line.startsWith('评论ID：')) {
                context.comment_id = sanitizeText(line.slice('评论ID：'.length), 160);
                continue;
            }
            if (line.startsWith('Prompt ID：')) {
                context.prompt_id = sanitizeText(line.slice('Prompt ID：'.length), 160);
                continue;
            }
            if (line.startsWith('留言主贴 ID：')) {
                context.message_id = sanitizeText(line.slice('留言主贴 ID：'.length), 160);
                continue;
            }
            if (line.startsWith('上下文：')) {
                context.context_title = sanitizeText(line.slice('上下文：'.length), 240);
                continue;
            }
            if (line.startsWith('评论作者：')) {
                context.author = sanitizeText(line.slice('评论作者：'.length), 255);
                continue;
            }
            if (line.startsWith('站点：')) {
                context.site = sanitizeText(line.slice('站点：'.length), 20).toLowerCase();
            }
        }

        if (!context.view) {
            if (context.prompt_id || context.entity_type === 'prompt_comment') {
                context.view = 'gallery';
            } else if (context.comment_id) {
                context.view = 'guestbook';
            }
        }

        return context.comment_id ? context : null;
    }

    function buildLinkedTicketDescription(body = {}, actorLabel = '') {
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

        const lines = [source === 'chat_session' ? CHAT_SESSION_TICKET_PREFIX : OPS_ALERT_TICKET_PREFIX];
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
        if (actorLabel) lines.push(`转单管理员：${sanitizeText(actorLabel, 255)}`);
        if (note) lines.push(`${source === 'chat_session' ? '客服备注' : '补充说明'}：${note}`);
        if (content) {
            lines.push(source === 'chat_session' ? '会话摘要：' : '原始告警：');
            lines.push(content);
        }

        return sanitizeText(lines.join('\n'), 1500);
    }

    return {
        OPS_ALERT_TICKET_PREFIX,
        CHAT_SESSION_TICKET_PREFIX,
        COMMENT_TICKET_PREFIX,
        sanitizeText,
        normalizeSource,
        normalizeAlertType,
        inferLinkedOpsAlertCategoryKey,
        parseLinkedOpsAlertContext,
        parseLinkedChatSessionContext,
        parseLinkedCommentContext,
        buildLinkedTicketDescription
    };
}));
