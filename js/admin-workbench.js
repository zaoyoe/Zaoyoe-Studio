const ADMIN_WORKBENCH_MODULE_MAP = Object.freeze({
    'payments-overview': 'payments',
    'payments-ops': 'payments',
    'verify-monitor': 'settings',
    'admin-audit-monitor': 'settings',
    'tickets-pending': 'tickets',
    'tickets-resolved': 'tickets',
    'shop-inventory': 'shop',
    'shop-fulfillment': 'shop',
    'shop-risk-orders': 'shop',
    'shop-risk-discounts': 'discounts',
    'shop-risk-users': 'users'
});

const ADMIN_WORKBENCH_SUCCESS_LABELS = Object.freeze({
    'chat-session': '客服会话',
    'payments-overview': '支付总览',
    'payments-ops': '支付异常运维',
    'verify-monitor': '验证服务运维面板',
    'admin-audit-monitor': '管理员访问审计面板',
    'tickets-pending': '待处理工单',
    'tickets-resolved': '已处理工单',
    'shop-inventory': '库存 / 补货',
    'shop-fulfillment': '履约异常订单',
    'shop-risk-orders': '商城风险订单',
    'shop-risk-discounts': '优惠券码列表',
    'shop-risk-users': '用户详情'
});

const ADMIN_WORKBENCH_PAYMENTS_TOPICS = Object.freeze({
    payment_refund_ops: 'all',
    payment_gateway_degraded: 'all',
    payment_config_changed: 'all',
    payment_config_incident: 'all'
});

const ADMIN_WORKBENCH_OPS_ALERT_ACTIONS = Object.freeze({
    payment_refund_ops: {
        target: 'payments-ops',
        icon: 'fas fa-arrow-rotate-left',
        monitorLabel: '处理退款',
        ticketLabel: '退款运维'
    },
    payment_gateway_degraded: {
        target: 'payments-overview',
        icon: 'fas fa-credit-card',
        monitorLabel: '查看通道',
        ticketLabel: '支付总览'
    },
    payment_config_changed: {
        target: 'admin-audit-monitor',
        icon: 'fas fa-user-shield',
        monitorLabel: '查看审计',
        ticketLabel: '配置审计'
    },
    payment_config_incident: {
        target: 'admin-audit-monitor',
        icon: 'fas fa-user-shield',
        monitorLabel: '排查配置风险',
        ticketLabel: '配置审计'
    },
    payment_config_recovered: {
        target: 'admin-audit-monitor',
        icon: 'fas fa-user-shield',
        monitorLabel: '收口配置恢复',
        ticketLabel: '配置审计'
    },
    payment_config_incident_recovered: {
        target: 'admin-audit-monitor',
        icon: 'fas fa-user-shield',
        monitorLabel: '收口配置事故',
        ticketLabel: '配置审计'
    },
    security_admin_login_anomaly: {
        target: 'admin-audit-monitor',
        icon: 'fas fa-user-shield',
        monitorLabel: '排查异常登录',
        ticketLabel: '访问审计'
    },
    verify_quota_low: {
        target: 'verify-monitor',
        icon: 'fas fa-wave-square',
        monitorLabel: '处理验证额度',
        ticketLabel: '验证运维'
    },
    verify_service_disabled: {
        target: 'verify-monitor',
        icon: 'fas fa-wave-square',
        monitorLabel: '排查服务停摆',
        ticketLabel: '验证运维'
    },
    verify_queue_backlog: {
        target: 'verify-monitor',
        icon: 'fas fa-wave-square',
        monitorLabel: '处理队列堆积',
        ticketLabel: '验证运维'
    },
    verify_failure_rate_spike: {
        target: 'verify-monitor',
        icon: 'fas fa-wave-square',
        monitorLabel: '排查失败率',
        ticketLabel: '验证运维'
    },
    verify_incident_escalated: {
        target: 'verify-monitor',
        icon: 'fas fa-wave-square',
        monitorLabel: '处理验证事故',
        ticketLabel: '验证运维'
    },
    verify_incident_recovered: {
        target: 'verify-monitor',
        icon: 'fas fa-wave-square',
        monitorLabel: '收口验证恢复',
        ticketLabel: '验证运维'
    },
    ticket_sla_overdue: {
        target: 'tickets-pending',
        icon: 'fas fa-ticket-alt',
        monitorLabel: '处理工单',
        ticketLabel: '待处理工单'
    },
    ticket_sla_summary: {
        target: 'tickets-pending',
        icon: 'fas fa-ticket-alt',
        monitorLabel: '处理工单',
        ticketLabel: '待处理工单'
    },
    shop_inventory_low: {
        target: 'shop-inventory',
        icon: 'fas fa-box-open',
        monitorLabel: '去补货',
        ticketLabel: '库存 / 补货'
    },
    shop_inventory_empty: {
        target: 'shop-inventory',
        icon: 'fas fa-box-open',
        monitorLabel: '去补货',
        ticketLabel: '库存 / 补货'
    },
    shop_order_delivery_summary: {
        target: 'shop-fulfillment',
        icon: 'fas fa-truck-ramp-box',
        monitorLabel: '处理履约',
        ticketLabel: '履约死信'
    },
    shop_order_delivery_failed: {
        target: 'shop-fulfillment',
        icon: 'fas fa-truck-ramp-box',
        monitorLabel: '处理履约',
        ticketLabel: '履约死信'
    },
    shop_order_delivery_incident: {
        target: 'shop-fulfillment',
        icon: 'fas fa-triangle-exclamation',
        monitorLabel: '处理事故',
        ticketLabel: '履约事故'
    }
});

const ADMIN_WORKBENCH_OPS_ALERT_CATEGORY_FALLBACKS = Object.freeze({
    payments: {
        target: 'payments-ops',
        icon: 'fas fa-shield-heart',
        monitorLabel: '进入处理页',
        ticketLabel: '支付运维'
    },
    tickets: {
        target: 'tickets-pending',
        icon: 'fas fa-ticket-alt',
        monitorLabel: '进入处理页',
        ticketLabel: '待处理工单'
    },
    inventory: {
        target: 'shop-inventory',
        icon: 'fas fa-box-open',
        monitorLabel: '进入处理页',
        ticketLabel: '库存 / 补货'
    },
    fulfillment: {
        target: 'shop-fulfillment',
        icon: 'fas fa-truck-ramp-box',
        monitorLabel: '进入处理页',
        ticketLabel: '履约死信'
    },
    shop_risk: {
        target: 'shop-risk-orders',
        icon: 'fas fa-bag-shopping',
        monitorLabel: '进入处理页',
        ticketLabel: '风险订单'
    },
    verify: {
        target: 'verify-monitor',
        icon: 'fas fa-wave-square',
        monitorLabel: '进入处理页',
        ticketLabel: '验证运维'
    },
    security: {
        target: 'admin-audit-monitor',
        icon: 'fas fa-user-shield',
        monitorLabel: '进入处理页',
        ticketLabel: '访问审计'
    }
});

const ADMIN_WORKBENCH_OPS_ALERT_MONITOR_MODULE_MAP = Object.freeze({
    payments: 'payments',
    tickets: 'tickets',
    inventory: 'inventory',
    fulfillment: 'fulfillment',
    shop_risk: 'shop_risk'
});

const ADMIN_WORKBENCH_OPS_ALERT_MONITOR_CATEGORY_LABELS = Object.freeze({
    payments: '支付与退款',
    tickets: '工单与售后',
    inventory: '库存与补货',
    fulfillment: '履约与死信',
    shop_risk: '商城风控',
    verify: '验证服务',
    security: '安全与审计'
});

const ADMIN_WORKBENCH_PENDING_WORKSPACE_STORAGE_KEY = 'zaoyoe_pending_ops_alert_workspace';
const ADMIN_WORKBENCH_URL_PARAM_KEY = 'workbench';
const ADMIN_WORKBENCH_URL_PARAM_CONTEXT = 'workbench_context';

function waitForAdminWorkbenchPaint() {
    return new Promise((resolve) => {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(resolve);
        });
    });
}

async function settleAdminWorkbench(delayMs = 60) {
    const normalizedDelayMs = Number(delayMs) > 0 ? Number(delayMs) : 0;
    const fallbackWaitMs = Math.max(360, normalizedDelayMs + 360);

    const settlePromise = (async () => {
        if (typeof settleOpsAlertWorkspace === 'function') {
            await settleOpsAlertWorkspace(normalizedDelayMs);
            return true;
        }

        await waitForAdminWorkbenchPaint();
        if (normalizedDelayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, normalizedDelayMs));
        }
        return true;
    })().catch(() => false);

    await Promise.race([
        settlePromise,
        new Promise((resolve) => {
            window.setTimeout(resolve, fallbackWaitMs);
        })
    ]);
}

function scrollAdminWorkbenchTarget(targetId) {
    if (typeof scrollToOpsAlertWorkspaceTarget === 'function') {
        return scrollToOpsAlertWorkspaceTarget(targetId);
    }

    const target = document.getElementById(String(targetId || '').trim());
    if (!(target instanceof HTMLElement) || typeof target.scrollIntoView !== 'function') {
        return;
    }

    window.setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 40);
}

function notifyAdminWorkbench(message, tone = 'info') {
    if (typeof window.showToast === 'function') {
        window.showToast(message, tone);
    }
}

function normalizeOpsAlertWorkspaceContext(context = {}) {
    return {
        title: String(context.title || context.workspaceTitle || '').trim(),
        alertType: String(context.alertType || context.alert_type || '').trim().toLowerCase(),
        category: String(context.category || context.workspaceCategory || '').trim().toLowerCase(),
        tab: String(context.tab || context.defaultTab || context.workspaceTab || context.userTab || '').trim().toLowerCase(),
        email: String(context.email || context.userEmail || context.workspaceEmail || '').trim(),
        sessionId: String(context.sessionId || context.session_id || context.workspaceSessionId || '').trim(),
        referenceLabel: String(context.referenceLabel || context.reference_label || '').trim(),
        referenceValue: String(context.referenceValue || context.reference_value || '').trim(),
        targetId: String(context.targetId || context.target_id || '').trim(),
        orderId: String(context.orderId || context.order_id || '').trim(),
        ticketId: String(context.ticketId || context.ticket_id || '').trim(),
        ticketStatus: String(context.ticketStatus || context.ticket_status || '').trim().toLowerCase(),
        userId: String(context.userId || context.user_id || context.workspaceUserId || '').trim(),
        paymentOrderId: String(context.paymentOrderId || context.payment_order_id || '').trim(),
        clientIp: String(context.clientIp || context.client_ip || context.workspaceClientIp || '').trim(),
        discountCode: String(context.discountCode || context.discount_code || context.workspaceDiscountCode || '').trim(),
        signalType: String(context.signalType || context.signal_type || context.workspaceSignalType || '').trim().toLowerCase(),
        caseStatus: String(context.caseStatus || context.case_status || context.workspaceCaseStatus || '').trim().toLowerCase(),
        caseOwnerAdminId: String(context.caseOwnerAdminId || context.case_owner_admin_id || context.workspaceCaseOwnerAdminId || '').trim(),
        caseOwnerLabel: String(context.caseOwnerLabel || context.case_owner_label || context.workspaceCaseOwnerLabel || '').trim()
    };
}

function buildOpsAlertWorkspaceContextAttrs(context = {}) {
    const normalizedContext = normalizeOpsAlertWorkspaceContext(context);
    return {
        'data-workspace-title': normalizedContext.title || '',
        'data-workspace-alert-type': normalizedContext.alertType || '',
        'data-workspace-category': normalizedContext.category || '',
        'data-workspace-reference-label': normalizedContext.referenceLabel || '',
        'data-workspace-reference-value': normalizedContext.referenceValue || '',
        'data-workspace-target-id': normalizedContext.targetId || '',
        'data-workspace-user-id': normalizedContext.userId || '',
        'data-workspace-client-ip': normalizedContext.clientIp || '',
        'data-workspace-discount-code': normalizedContext.discountCode || '',
        'data-workspace-signal-type': normalizedContext.signalType || '',
        'data-workspace-session-id': normalizedContext.sessionId || '',
        'data-workspace-case-status': normalizedContext.caseStatus || '',
        'data-workspace-case-owner-admin-id': normalizedContext.caseOwnerAdminId || '',
        'data-workspace-case-owner-label': normalizedContext.caseOwnerLabel || ''
    };
}

function readOpsAlertWorkspaceContextDataset(dataset = {}) {
    return normalizeOpsAlertWorkspaceContext({
        title: dataset.workspaceTitle,
        alertType: dataset.workspaceAlertType,
        category: dataset.workspaceCategory,
        referenceLabel: dataset.workspaceReferenceLabel,
        referenceValue: dataset.workspaceReferenceValue,
        targetId: dataset.workspaceTargetId,
        userId: dataset.workspaceUserId,
        clientIp: dataset.workspaceClientIp,
        discountCode: dataset.workspaceDiscountCode,
        signalType: dataset.workspaceSignalType,
        sessionId: dataset.workspaceSessionId,
        caseStatus: dataset.workspaceCaseStatus,
        caseOwnerAdminId: dataset.workspaceCaseOwnerAdminId,
        caseOwnerLabel: dataset.workspaceCaseOwnerLabel
    });
}

function getOpsAlertWorkspaceTargetIdParts(context = {}) {
    return normalizeOpsAlertWorkspaceContext(context)
        .targetId
        .split(':')
        .map((part) => String(part || '').trim())
        .filter(Boolean);
}

function getOpsAlertWorkspaceDiscountCode(context = {}) {
    const normalizedContext = normalizeOpsAlertWorkspaceContext(context);
    if (normalizedContext.discountCode) {
        return normalizedContext.discountCode;
    }
    if (normalizedContext.referenceLabel === '优惠码' && normalizedContext.referenceValue) {
        return normalizedContext.referenceValue;
    }

    const parts = getOpsAlertWorkspaceTargetIdParts(normalizedContext);
    if (parts[0] === 'shop_order_risk' && parts[1] === 'coupon' && parts[2]) {
        return parts.slice(2).join(':');
    }

    return '';
}

function getOpsAlertWorkspaceRiskUserId(context = {}) {
    const normalizedContext = normalizeOpsAlertWorkspaceContext(context);
    if (normalizedContext.userId) {
        return normalizedContext.userId;
    }

    const parts = getOpsAlertWorkspaceTargetIdParts(normalizedContext);
    if (parts[0] === 'shop_order_risk' && parts[1] === 'user_velocity' && parts[2]) {
        return parts.slice(2).join(':');
    }

    return '';
}

function getOpsAlertWorkspaceSearchValue(context = {}) {
    const normalizedContext = normalizeOpsAlertWorkspaceContext(context);
    const normalizedLabel = String(normalizedContext.referenceLabel || '').trim().toLowerCase();

    if (['工单号', '订单号', '订单', '用户id', '记录', '目标'].includes(normalizedContext.referenceLabel)) {
        return normalizedContext.referenceValue;
    }

    if (['工单号', '订单号', '订单', '用户id'].includes(normalizedLabel)) {
        return normalizedContext.referenceValue;
    }

    if (!normalizedContext.referenceValue && normalizedContext.targetId) {
        return normalizedContext.targetId;
    }

    return normalizedContext.referenceValue;
}

function getOpsAlertWorkspacePaymentsTopic(context = {}) {
    const alertType = normalizeOpsAlertWorkspaceContext(context).alertType;
    return ADMIN_WORKBENCH_PAYMENTS_TOPICS[alertType] || 'all';
}

function getOpsAlertWorkspaceSuccessLabel(workspaceKey) {
    const normalizedKey = String(workspaceKey || '').trim().toLowerCase();
    return ADMIN_WORKBENCH_SUCCESS_LABELS[normalizedKey] || '告警处理入口';
}

function normalizeOpsAlertWorkspaceActionContext(context = {}) {
    return {
        categoryKey: String(context.categoryKey || context.category_key || context.category || '').trim().toLowerCase(),
        alertType: String(context.alertType || context.alert_type || '').trim().toLowerCase(),
        targetId: String(context.targetId || context.target_id || '').trim().toLowerCase()
    };
}

function getOpsAlertWorkspaceActionLabel(definition = {}, labelVariant = 'monitor') {
    const normalizedVariant = String(labelVariant || 'monitor').trim().toLowerCase();
    if (normalizedVariant === 'ticket') {
        return String(definition.ticketLabel || definition.monitorLabel || '').trim();
    }
    return String(definition.monitorLabel || definition.ticketLabel || '').trim();
}

function getOpsAlertCaseStatusLabel(status = '') {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    const labelMap = {
        open: '待处理',
        claimed: '处理中',
        resolved: '已关闭'
    };
    return labelMap[normalizedStatus] || '待处理';
}

function getOpsAlertCaseStatusTone(status = '', options = {}) {
    const normalizedStatus = String(status || '').trim().toLowerCase() || 'open';
    const variant = String(options.variant || 'monitor').trim().toLowerCase();

    if (variant === 'chat') {
        if (normalizedStatus === 'resolved') return 'resolved';
        if (normalizedStatus === 'claimed') return 'claimed';
        return 'open';
    }

    if (normalizedStatus === 'resolved') return 'success';
    if (normalizedStatus === 'claimed') return 'neutral';
    return 'warning';
}

function getOpsAlertCaseEventActionLabel(action = '') {
    const normalizedAction = String(action || '').trim().toLowerCase();
    const labelMap = {
        claim: '认领处理',
        assign: '转交负责人',
        add_note: '记录备注',
        resolve: '关闭告警',
        reopen: '重新打开',
        batch_mute: '批量静默'
    };
    return labelMap[normalizedAction] || normalizedAction || '处置更新';
}

function normalizeOpsAlertCaseDisplayEvent(event = {}) {
    const metadata = event && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
        ? event.metadata
        : {};
    const action = String(event.action || '').trim().toLowerCase();

    return {
        action,
        actionLabel: String(event.actionLabel || event.action_label || '').trim() || getOpsAlertCaseEventActionLabel(action),
        summary: String(event.summary || '').trim(),
        ownerLabel: String(event.ownerLabel || event.owner_label || '').trim(),
        actorLabel: String(event.actorLabel || event.actor_label || '').trim(),
        createdAt: String(event.createdAt || event.created_at || '').trim(),
        note: String(event.note || '').trim(),
        resolution: String(event.resolution || '').trim(),
        metadata
    };
}

function getOpsAlertCaseMuteSummary(muteUntil = '', options = {}) {
    const normalizedUntil = String(muteUntil || '').trim();
    if (!normalizedUntil) {
        return '';
    }

    const formatTime = typeof options.formatTime === 'function'
        ? options.formatTime
        : ((value) => String(value || '').trim());
    const allowCritical = options.allowCritical !== false;
    const muteVerb = String(options.muteVerb || '已静默至').trim() || '已静默至';
    const suffix = allowCritical && options.includeAllowCriticalSuffix === true
        ? '（紧急继续通知）'
        : '';

    return `${muteVerb} ${formatTime(normalizedUntil)}${suffix}`;
}

function normalizeAdminWorkbenchOpsAlertCaseRecentEvents(events = []) {
    return (Array.isArray(events) ? events : [])
        .map((event) => normalizeOpsAlertCaseDisplayEvent(event))
        .filter((event) => event.action || event.actionLabel || event.summary || event.createdAt);
}

function getOpsAlertCaseRecentEventText(event = {}, options = {}) {
    const normalizedEvent = normalizeOpsAlertCaseDisplayEvent(event);
    if (!normalizedEvent.action && !normalizedEvent.actionLabel && !normalizedEvent.summary && !normalizedEvent.createdAt) {
        return '';
    }

    const muteUntil = String(normalizedEvent.metadata?.mute_until || '').trim();
    const summary = normalizedEvent.action === 'batch_mute' && muteUntil
        ? getOpsAlertCaseMuteSummary(muteUntil, options)
        : String(normalizedEvent.summary || '').trim();
    const formatTime = typeof options.formatTime === 'function'
        ? options.formatTime
        : ((value) => String(value || '').trim());
    const parts = [];

    if (normalizedEvent.actionLabel) {
        parts.push(normalizedEvent.actionLabel);
    }
    if (summary) {
        parts.push(summary);
    } else if (normalizedEvent.ownerLabel && ['assign', 'claim'].includes(normalizedEvent.action)) {
        parts.push(`负责人 ${normalizedEvent.ownerLabel}`);
    }
    if (normalizedEvent.actorLabel) {
        parts.push(`操作人 ${normalizedEvent.actorLabel}`);
    }
    if (normalizedEvent.createdAt) {
        parts.push(formatTime(normalizedEvent.createdAt));
    }

    return parts.join(' · ');
}

function getOpsAlertCaseSummaryText(item = {}, options = {}) {
    const status = String(
        item.case_status
        || item.caseStatus
        || item.caseRecord?.status
        || ''
    ).trim().toLowerCase() || 'open';
    const ownerLabel = String(
        item.case_owner_label
        || item.caseOwnerLabel
        || item.caseRecord?.owner_label
        || item.caseRecord?.ownerLabel
        || ''
    ).trim();
    const resolution = String(
        item.case_resolution
        || item.caseResolution
        || item.caseRecord?.resolution
        || ''
    ).trim();
    const note = String(
        item.case_recent_note
        || item.caseRecentNote
        || item.case_note
        || item.caseNote
        || item.caseRecord?.note
        || ''
    ).trim();
    const latestEvents = Array.isArray(item.case_recent_events || item.caseRecentEvents)
        ? (item.case_recent_events || item.caseRecentEvents)
        : [];
    const latestEvent = normalizeOpsAlertCaseDisplayEvent(latestEvents[0] || {});
    const latestEventAction = String(
        item.case_latest_event_action
        || item.caseLatestEventAction
        || latestEvent.action
        || ''
    ).trim().toLowerCase();
    const latestEventLabel = String(
        item.case_latest_event_label
        || item.caseLatestEventLabel
        || latestEvent.actionLabel
        || ''
    ).trim();
    const latestEventMuteUntil = String(latestEvent.metadata?.mute_until || '').trim();
    const latestEventSummary = latestEventAction === 'batch_mute' && latestEventMuteUntil
        ? getOpsAlertCaseMuteSummary(latestEventMuteUntil, options)
        : String(
            item.case_latest_event_summary
            || item.caseLatestEventSummary
            || latestEvent.summary
            || ''
        ).trim();
    const latestEventAt = String(
        item.case_latest_event_at
        || item.caseLatestEventAt
        || item.case_last_action_at
        || item.caseLastActionAt
        || item.caseRecord?.last_action_at
        || item.caseRecord?.lastActionAt
        || ''
    ).trim();
    const formatTime = typeof options.formatTime === 'function'
        ? options.formatTime
        : ((value) => String(value || '').trim());
    const includeStatusLabel = options.includeStatusLabel !== false;
    const parts = [];

    if (String(item.moduleMuteActive || item.module_mute_active || '').trim() || item.moduleMuteActive === true || item.module_mute_active === true) {
        const muteUntil = String(item.moduleMuteUntil || item.module_mute_until || '').trim();
        if (muteUntil) {
            parts.push(getOpsAlertCaseMuteSummary(muteUntil, {
                ...options,
                allowCritical: item.moduleMuteAllowCritical !== false && item.module_mute_allow_critical !== false,
                includeAllowCriticalSuffix: options.includeModuleMuteAllowCriticalSuffix === true
            }));
        }
    }

    if (includeStatusLabel) {
        parts.push(getOpsAlertCaseStatusLabel(status));
    }
    if (ownerLabel) {
        parts.push(`负责人 ${ownerLabel}`);
    }

    if (status === 'resolved' && resolution) {
        parts.push(`${String(options.resolutionPrefix || '关闭：').trim() || '关闭：'}${resolution}`);
    } else if (note) {
        parts.push(`${String(options.notePrefix || '备注：').trim() || '备注：'}${note}`);
    }

    if (latestEventLabel && !['resolve', 'add_note'].includes(latestEventAction)) {
        const recentPrefix = String(options.recentEventPrefix || '最近 ').trim() || '最近 ';
        parts.push(`${recentPrefix}${latestEventLabel}${latestEventSummary ? `：${latestEventSummary}` : ''}`);
    }

    if (latestEventAt) {
        parts.push(formatTime(latestEventAt));
    }

    return parts.join(' · ');
}

function getOpsAlertWorkspaceContextLabel(context = {}, options = {}) {
    const normalizedContext = normalizeOpsAlertWorkspaceContext(context);
    if (normalizedContext.referenceLabel && normalizedContext.referenceValue) {
        return `${normalizedContext.referenceLabel}：${normalizedContext.referenceValue}`;
    }
    return String(
        normalizedContext.title
        || normalizedContext.targetId
        || options.fallback
        || '集中告警'
    ).trim();
}

function getOpsAlertWorkspaceBatchPreview(items = [], options = {}) {
    const normalizedItems = Array.isArray(items) ? items : [];
    const previewLabels = normalizedItems
        .slice(0, 3)
        .map((item) => getOpsAlertWorkspaceContextLabel(item, { fallback: options.fallback || '告警' }))
        .filter(Boolean);
    const overflowCount = Math.max(0, normalizedItems.length - previewLabels.length);
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(value || 0));

    return `${previewLabels.join(' / ')}${overflowCount > 0 ? ` 等 ${formatCount(overflowCount)} 条` : ''}`;
}

function normalizeOpsAlertCaseMutationMetadata(metadata = {}) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return {};
    }

    return Object.entries(metadata).reduce((result, [key, value]) => {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey) {
            return result;
        }

        if (value === undefined) {
            return result;
        }

        result[normalizedKey] = value;
        return result;
    }, {});
}

function buildOpsAlertCaseMutationContext(source = {}) {
    return normalizeOpsAlertWorkspaceContext({
        title: source.title || source.workspaceTitle || '',
        alertType: source.alertType || source.alert_type || '',
        category: source.category || source.category_key || source.caseCategoryKey || '',
        referenceLabel: source.referenceLabel || source.reference_label || '',
        referenceValue: source.referenceValue || source.reference_value || '',
        targetId: source.targetId || source.target_id || source.caseTargetId || '',
        userId: source.userId || source.user_id || source.payload?.user_id || '',
        clientIp: source.clientIp || source.client_ip || source.payload?.client_ip || '',
        discountCode: source.discountCode || source.discount_code || source.payload?.discount_code || '',
        signalType: source.signalType || source.signal_type || source.payload?.signal_type || '',
        sessionId: source.sessionId || source.session_id || source.payload?.session_id || '',
        caseStatus: source.caseStatus || source.case_status || '',
        caseOwnerAdminId: source.caseOwnerAdminId || source.case_owner_admin_id || '',
        caseOwnerLabel: source.caseOwnerLabel || source.case_owner_label || ''
    });
}

function buildOpsAlertCaseMutationItem(item = {}, categoryKey = '') {
    const normalizedContext = buildOpsAlertCaseMutationContext({
        ...item,
        category: categoryKey || item.category || item.category_key || item.caseCategoryKey || ''
    });
    if (!normalizedContext.category || !normalizedContext.targetId) {
        return null;
    }

    const metadata = normalizeOpsAlertCaseMutationMetadata(item.metadata);
    const nextItem = {
        category_key: normalizedContext.category,
        target_id: normalizedContext.targetId,
        alert_type: normalizedContext.alertType,
        title: normalizedContext.title,
        reference_label: normalizedContext.referenceLabel,
        reference_value: normalizedContext.referenceValue
    };

    if (Object.keys(metadata).length) {
        nextItem.metadata = metadata;
    }

    return nextItem;
}

function normalizeOpsAlertCaseMutationItem(item = {}, categoryKey = '') {
    return buildOpsAlertCaseMutationItem(item, categoryKey);
}

function buildOpsAlertCaseMutationItems(items = [], categoryKey = '') {
    return (Array.isArray(items) ? items : [])
        .map((item) => buildOpsAlertCaseMutationItem(item, categoryKey))
        .filter(Boolean);
}

function buildOpsAlertMonitorBatchItems(categories = [], action = '', categoryKey = '') {
    const normalizedAction = String(action || '').trim().toLowerCase();
    const normalizedCategoryKey = String(categoryKey || '').trim().toLowerCase();
    const normalizedCategories = Array.isArray(categories) ? categories : [];

    return normalizedCategories.flatMap((category) => {
        const currentCategoryKey = String(category?.key || category?.category_key || '').trim().toLowerCase();
        if (normalizedCategoryKey && currentCategoryKey !== normalizedCategoryKey) {
            return [];
        }

        return buildOpsAlertCaseMutationItems(category?.visible_items || [], currentCategoryKey)
            .filter((item) => {
                const sourceItem = Array.isArray(category?.visible_items)
                    ? category.visible_items.find((candidate) => String(candidate?.target_id || candidate?.targetId || '').trim() === item.target_id)
                    : null;
                const status = String(sourceItem?.case_status || sourceItem?.caseStatus || '').trim().toLowerCase() || 'open';

                if (normalizedAction === 'claim' || normalizedAction === 'assign' || normalizedAction === 'resolve') {
                    return status !== 'resolved';
                }
                if (normalizedAction === 'reopen') {
                    return status === 'resolved';
                }
                return true;
            });
    });
}

function getOpsAlertMonitorBatchMuteModuleKeys(categories = [], categoryKey = '') {
    const normalizedCategoryKey = String(categoryKey || '').trim().toLowerCase();
    const normalizedCategories = Array.isArray(categories) ? categories : [];

    return Array.from(new Set(
        normalizedCategories
            .filter((category) => {
                const currentCategoryKey = String(category?.key || category?.category_key || '').trim().toLowerCase();
                if (normalizedCategoryKey && currentCategoryKey !== normalizedCategoryKey) {
                    return false;
                }
                return Array.isArray(category?.visible_items) && category.visible_items.length > 0;
            })
            .map((category) => ADMIN_WORKBENCH_OPS_ALERT_MONITOR_MODULE_MAP[String(category?.key || category?.category_key || '').trim().toLowerCase()])
            .filter(Boolean)
    ));
}

function getAdminWorkbenchOpsAlertMonitorCategoryLabel(categoryKey = '', options = {}) {
    const categoryLabelMap = {
        ...ADMIN_WORKBENCH_OPS_ALERT_MONITOR_CATEGORY_LABELS,
        ...(options.categoryLabelMap && typeof options.categoryLabelMap === 'object' && !Array.isArray(options.categoryLabelMap)
            ? options.categoryLabelMap
            : {})
    };
    const normalizedCategoryKey = String(categoryKey || '').trim().toLowerCase();
    return categoryLabelMap[normalizedCategoryKey] || normalizedCategoryKey || '告警模块';
}

function getAdminWorkbenchOpsAlertMonitorFilterSummaryLabel(filters = {}, options = {}) {
    const scopeLabels = {
        all: '全部状态',
        active: '仅待处理',
        recovered: '仅已恢复'
    };
    const severityLabels = {
        all: '全部级别',
        critical: '仅 critical',
        warning: '仅 warning'
    };
    const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters)
        ? filters
        : {};

    return [
        scopeLabels[String(normalizedFilters.scope || '').trim().toLowerCase()] || scopeLabels.all,
        severityLabels[String(normalizedFilters.severity || '').trim().toLowerCase()] || severityLabels.all,
        getAdminWorkbenchOpsAlertMonitorCategoryLabel(normalizedFilters.category || 'all', options)
    ].filter(Boolean).join(' · ');
}

function buildAdminWorkbenchOpsAlertMonitorCategoryView(category = {}, filters = {}, options = {}) {
    const normalizedCategory = category && typeof category === 'object' && !Array.isArray(category)
        ? category
        : {};
    const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters)
        ? filters
        : {};
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Number(value || 0)));
    const normalizedCategoryKey = String(normalizedCategory.key || '').trim().toLowerCase();
    const latestState = String(normalizedCategory.latest_state || '').trim().toLowerCase() || 'idle';
    const allItems = Array.isArray(normalizedCategory.items) ? normalizedCategory.items : [];
    const categoryMatches = normalizedFilters.category === 'all' || normalizedFilters.category === normalizedCategoryKey;
    const activeCount = Number(normalizedCategory.active_count || 0);
    const criticalCount = Number(normalizedCategory.critical_count || 0);
    const isRecoveredOnly = activeCount === 0 && latestState === 'recovered';

    if (!categoryMatches) {
        return null;
    }

    if (normalizedFilters.scope === 'active' && activeCount <= 0) {
        return null;
    }

    if (normalizedFilters.scope === 'recovered' && latestState !== 'recovered') {
        return null;
    }

    if (normalizedFilters.severity !== 'all') {
        const severityMatchedItems = allItems.filter((item) => String(item?.severity || '').trim().toLowerCase() === normalizedFilters.severity);
        if (!severityMatchedItems.length) {
            return null;
        }
    }

    const visibleItems = normalizedFilters.scope === 'recovered'
        ? []
        : allItems.filter((item) => (
            normalizedFilters.severity === 'all'
                ? true
                : String(item?.severity || '').trim().toLowerCase() === normalizedFilters.severity
        ));
    const previewItems = visibleItems.slice(0, 3);
    const displayActiveCount = normalizedFilters.scope === 'recovered'
        ? 0
        : (normalizedFilters.severity === 'all' ? activeCount : visibleItems.length);
    const displayCriticalCount = normalizedFilters.scope === 'recovered'
        ? 0
        : (normalizedFilters.severity === 'all'
            ? criticalCount
            : visibleItems.filter((item) => String(item?.severity || '').trim().toLowerCase() === 'critical').length);
    const filteredNote = !isRecoveredOnly
        && normalizedFilters.severity !== 'all'
        && activeCount > visibleItems.length
        ? `当前筛出 ${formatCount(visibleItems.length)} 项 ${normalizedFilters.severity} 告警；模块原始待关注共 ${formatCount(activeCount)} 项。`
        : '';

    return {
        ...normalizedCategory,
        items: previewItems,
        visible_items: visibleItems,
        hidden_item_count: Math.max(0, visibleItems.length - previewItems.length),
        display_active_count: displayActiveCount,
        display_critical_count: displayCriticalCount,
        filtered_note: filteredNote
    };
}

function getAdminWorkbenchOpsAlertMonitorDisplayActiveCount(category = {}) {
    return Number(category?.display_active_count ?? category?.active_count ?? 0);
}

function getAdminWorkbenchOpsAlertMonitorDisplayCriticalCount(category = {}) {
    return Number(category?.display_critical_count ?? category?.critical_count ?? 0);
}

function getAdminWorkbenchOpsAlertMonitorCardTone(category = {}, options = {}) {
    const getDisplayActiveCount = typeof options.getDisplayActiveCount === 'function'
        ? options.getDisplayActiveCount
        : getAdminWorkbenchOpsAlertMonitorDisplayActiveCount;
    const getDisplayCriticalCount = typeof options.getDisplayCriticalCount === 'function'
        ? options.getDisplayCriticalCount
        : getAdminWorkbenchOpsAlertMonitorDisplayCriticalCount;

    if (getDisplayCriticalCount(category) > 0) return 'danger';
    if (getDisplayActiveCount(category) > 0) return 'warning';
    if (String(category?.latest_state || '').trim().toLowerCase() === 'recovered') return 'success';
    return 'neutral';
}

function buildAdminWorkbenchOpsAlertMonitorCategoryCardState(category = {}, filters = {}, options = {}) {
    const normalizedCategory = category && typeof category === 'object' && !Array.isArray(category)
        ? category
        : {};
    const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters)
        ? filters
        : {};
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Number(value || 0)));
    const formatDateTime = typeof options.formatDateTime === 'function'
        ? options.formatDateTime
        : ((value) => String(value || '').trim() || '—');
    const getCategoryActions = typeof options.getCategoryActions === 'function'
        ? options.getCategoryActions
        : (() => []);
    const getDisplayActiveCount = typeof options.getDisplayActiveCount === 'function'
        ? options.getDisplayActiveCount
        : getAdminWorkbenchOpsAlertMonitorDisplayActiveCount;
    const getDisplayCriticalCount = typeof options.getDisplayCriticalCount === 'function'
        ? options.getDisplayCriticalCount
        : getAdminWorkbenchOpsAlertMonitorDisplayCriticalCount;
    const getCardTone = typeof options.getCardTone === 'function'
        ? options.getCardTone
        : getAdminWorkbenchOpsAlertMonitorCardTone;
    const tone = getCardTone(normalizedCategory, {
        getDisplayActiveCount,
        getDisplayCriticalCount
    });
    const displayActiveCount = getDisplayActiveCount(normalizedCategory);
    const displayCriticalCount = getDisplayCriticalCount(normalizedCategory);
    const hiddenItemCount = Number(normalizedCategory.hidden_item_count || 0);
    const caseSummary = normalizedCategory.case_summary && typeof normalizedCategory.case_summary === 'object' && !Array.isArray(normalizedCategory.case_summary)
        ? normalizedCategory.case_summary
        : { open: 0, claimed: 0, resolved: 0 };
    const latestSummary = normalizedCategory.latest_title
        ? `${normalizedCategory.latest_title}${normalizedCategory.latest_at ? ` · ${formatDateTime(normalizedCategory.latest_at)}` : ''}`
        : '最近还没有收集到这类告警。';
    const latestMessage = normalizedCategory.filtered_note
        || normalizedCategory.latest_message
        || (displayActiveCount > 0
            ? `当前有 ${formatCount(displayActiveCount)} 项待关注告警。`
            : '当前没有持续中的待关注告警。');
    const emptyMessage = String(normalizedCategory.latest_state || '').trim().toLowerCase() === 'recovered'
        ? '最近一条同类告警已经恢复，可进入对应模块做一次复核。'
        : (String(normalizedFilters.severity || 'all').trim().toLowerCase() === 'all'
            ? '当前没有持续中的待处理告警。'
            : `当前筛选条件下没有命中的 ${normalizedFilters.severity} 告警。`);

    return {
        tone,
        title: normalizedCategory.label || '告警分类',
        description: normalizedCategory.description || '',
        latestSummary,
        latestMessage,
        emptyMessage,
        hiddenHint: hiddenItemCount > 0
            ? `当前卡片仅展示前 3 项，另有 ${formatCount(hiddenItemCount)} 项可通过“复制清单 / 导出 CSV”带走处理。`
            : '',
        statBadges: [
            { label: `${formatCount(displayActiveCount)} 待关注`, tone: displayActiveCount > 0 ? 'warning' : 'neutral' },
            Number(caseSummary.claimed || 0) > 0
                ? { label: `${formatCount(caseSummary.claimed || 0)} 处理中`, tone: 'neutral' }
                : null,
            displayCriticalCount > 0
                ? { label: `${formatCount(displayCriticalCount)} critical`, tone: 'danger' }
                : null,
            String(normalizedFilters.scope || 'all').trim().toLowerCase() === 'recovered'
                || (displayActiveCount === 0 && String(normalizedCategory.latest_state || '').trim().toLowerCase() === 'recovered')
                ? { label: '已恢复', tone: 'success' }
                : null
        ].filter(Boolean),
        actions: getCategoryActions(normalizedCategory.key || '')
    };
}

function buildAdminWorkbenchOpsAlertMonitorRecoveryRow(category = {}, options = {}) {
    const resolveCategoryFallbackAction = typeof options.resolveCategoryFallbackAction === 'function'
        ? options.resolveCategoryFallbackAction
        : (() => ({}));
    const getWorkspaceLabel = typeof options.getWorkspaceLabel === 'function'
        ? options.getWorkspaceLabel
        : ((value) => String(value || '').trim());
    const fallbackAction = resolveCategoryFallbackAction(category) || {};
    const workspaceTarget = String(fallbackAction.target || '').trim();

    return {
        模块: category.label || '告警分类',
        状态: '已恢复',
        级别: 'recovered',
        告警类型: 'recovered',
        标题: category.latest_title || `${category.label || '模块'}已恢复`,
        摘要: category.latest_message || '',
        引用标签: '',
        引用值: '',
        处理动作: fallbackAction.label || '进入复核页',
        处理入口: workspaceTarget ? getWorkspaceLabel(workspaceTarget) : '',
        入口标识: workspaceTarget,
        创建时间: category.latest_at || '',
        目标标识: ''
    };
}

function buildAdminWorkbenchOpsAlertMonitorBatchRows(categories = [], filters = {}, categoryKey = '', options = {}) {
    const normalizedCategoryKey = String(categoryKey || '').trim().toLowerCase();
    const normalizedCategories = Array.isArray(categories) ? categories : [];
    const resolveItemAction = typeof options.resolveItemAction === 'function'
        ? options.resolveItemAction
        : (() => null);
    const selectedCategories = normalizedCategoryKey
        ? normalizedCategories.filter((category) => String(category?.key || '').trim().toLowerCase() === normalizedCategoryKey)
        : normalizedCategories;
    const getWorkspaceLabel = typeof options.getWorkspaceLabel === 'function'
        ? options.getWorkspaceLabel
        : ((value) => String(value || '').trim());

    return selectedCategories.flatMap((category) => {
        const visibleItems = Array.isArray(category?.visible_items) ? category.visible_items : [];
        if (visibleItems.length > 0) {
            return visibleItems.map((item) => {
                const action = resolveItemAction(category, item) || {};
                const workspaceTarget = String(action.target || '').trim();
                return {
                    模块: category.label || '告警分类',
                    状态: '待处理',
                    级别: String(item?.severity || 'warning').trim().toLowerCase() || 'warning',
                    告警类型: item?.alert_type || '',
                    标题: item?.title || '系统告警',
                    摘要: item?.message || '',
                    引用标签: item?.reference_label || '',
                    引用值: item?.reference_value || '',
                    处理动作: action.label || '进入处理页',
                    处理入口: workspaceTarget ? getWorkspaceLabel(workspaceTarget) : '',
                    入口标识: workspaceTarget,
                    创建时间: item?.created_at || '',
                    目标标识: item?.target_id || ''
                };
            });
        }

        if (String(category?.latest_state || '').trim().toLowerCase() === 'recovered') {
            return [buildAdminWorkbenchOpsAlertMonitorRecoveryRow(category, options)];
        }

        return [];
    });
}

function buildAdminWorkbenchOpsAlertMonitorChecklistText(rows = [], filters = {}, categoryKey = '', options = {}) {
    const formatDateTime = typeof options.formatDateTime === 'function'
        ? options.formatDateTime
        : ((value) => String(value || '').trim() || '—');
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Number(value || 0)));
    const getFilterSummaryLabel = typeof options.getFilterSummaryLabel === 'function'
        ? options.getFilterSummaryLabel
        : (() => '');
    const now = String(options.now || new Date().toISOString()).trim();
    const normalizedCategoryKey = String(categoryKey || '').trim().toLowerCase();
    const categoryLabel = getAdminWorkbenchOpsAlertMonitorCategoryLabel(normalizedCategoryKey, options);
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const lines = [
        '第一阶段集中告警处理清单',
        `生成时间：${formatDateTime(now)}`,
        `当前筛选：${getFilterSummaryLabel(filters)}`
    ];

    if (normalizedCategoryKey) {
        lines.push(`当前模块：${categoryLabel}`);
    }

    lines.push(`命中记录：${formatCount(normalizedRows.length)} 条`, '');

    normalizedRows.forEach((row, index) => {
        lines.push(`${index + 1}. [${row.模块}] ${row.标题}`);
        lines.push(`   状态：${row.状态} · 级别：${row.级别 || 'warning'} · 类型：${row.告警类型 || 'unknown'}`);
        if (row.引用标签 && row.引用值) {
            lines.push(`   ${row.引用标签}：${row.引用值}`);
        }
        if (row.摘要) {
            lines.push(`   摘要：${row.摘要}`);
        }
        if (row.处理入口 || row.处理动作) {
            lines.push(`   处理入口：${row.处理入口 || '—'}${row.处理动作 ? ` · ${row.处理动作}` : ''}`);
        }
        if (row.创建时间) {
            lines.push(`   时间：${formatDateTime(row.创建时间)}`);
        }
        lines.push('');
    });

    return lines.join('\n').trim();
}

function buildAdminWorkbenchOpsAlertMonitorShiftOwnedCategoryItems(categories = [], currentAdminId = '', options = {}) {
    const normalizedCurrentAdminId = String(currentAdminId || '').trim();
    const locale = String(options.locale || 'zh-CN').trim() || 'zh-CN';
    if (!normalizedCurrentAdminId) {
        return [];
    }

    return (Array.isArray(categories) ? categories : [])
        .map((category) => {
            const items = Array.isArray(category?.items) ? category.items : [];
            const ownedItems = items.filter((item) => {
                const status = String(item?.case_status || '').trim().toLowerCase() || 'open';
                if (status === 'resolved') {
                    return false;
                }
                return String(item?.case_owner_admin_id || '').trim() === normalizedCurrentAdminId;
            });

            if (!ownedItems.length) {
                return null;
            }

            const claimedCount = ownedItems.filter((item) => (String(item?.case_status || '').trim().toLowerCase() || 'open') === 'claimed').length;
            const criticalCount = ownedItems.filter((item) => String(item?.severity || '').trim().toLowerCase() === 'critical').length;

            return {
                key: category?.key || '',
                label: category?.label || category?.key || '告警模块',
                backlog_count: ownedItems.length,
                pending_count: Math.max(0, ownedItems.length - claimedCount),
                claimed_count: claimedCount,
                critical_count: criticalCount
            };
        })
        .filter(Boolean)
        .sort((left, right) => {
            const backlogDelta = Number(right.backlog_count || 0) - Number(left.backlog_count || 0);
            if (backlogDelta !== 0) return backlogDelta;
            const criticalDelta = Number(right.critical_count || 0) - Number(left.critical_count || 0);
            if (criticalDelta !== 0) return criticalDelta;
            return String(left.label || '').localeCompare(String(right.label || ''), locale);
        });
}

function buildAdminWorkbenchOpsAlertMonitorPanelState(state = {}, filters = {}, categories = [], options = {}) {
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : {};
    const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters)
        ? filters
        : {};
    const normalizedCategories = Array.isArray(categories) ? categories : [];
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Number(value || 0)));
    const getFilterSummaryLabel = typeof options.getFilterSummaryLabel === 'function'
        ? options.getFilterSummaryLabel
        : getAdminWorkbenchOpsAlertMonitorFilterSummaryLabel;
    const filteredActiveCount = normalizedCategories.reduce((sum, category) => sum + Number(category?.display_active_count || 0), 0);
    const filteredCriticalCount = normalizedCategories.reduce((sum, category) => sum + Number(category?.display_critical_count || 0), 0);
    const filteredSummaryLabel = getFilterSummaryLabel(normalizedFilters, options);
    const summary = normalizedState.summary && typeof normalizedState.summary === 'object' && !Array.isArray(normalizedState.summary)
        ? normalizedState.summary
        : {};

    if (normalizedState.status === 'loading') {
        return {
            status: 'loading',
            filteredActiveCount,
            filteredCriticalCount,
            filteredSummaryLabel,
            metaIcon: 'fas fa-rotate fa-spin',
            metaText: '正在汇总支付、工单、库存、履约与商城风控五类告警...',
            emptyMessage: '正在加载集中告警处理面板...'
        };
    }

    if (normalizedState.status === 'error') {
        return {
            status: 'error',
            filteredActiveCount,
            filteredCriticalCount,
            filteredSummaryLabel,
            metaIcon: 'fas fa-triangle-exclamation',
            metaText: String(normalizedState.message || '集中告警处理面板加载失败。'),
            emptyMessage: String(normalizedState.message || '集中告警处理面板加载失败。')
        };
    }

    if (!normalizedCategories.length) {
        return {
            status: 'ready',
            filteredActiveCount,
            filteredCriticalCount,
            filteredSummaryLabel,
            metaIcon: 'fas fa-filter-circle-xmark',
            metaText: `当前筛选：${filteredSummaryLabel}。这组条件下没有命中的集中告警，请调整筛选后重试。`,
            emptyMessage: '当前筛选条件下没有可展示的集中告警卡片。'
        };
    }

    return {
        status: 'ready',
        filteredActiveCount,
        filteredCriticalCount,
        filteredSummaryLabel,
        metaIcon: filteredActiveCount > 0 ? 'fas fa-siren-on' : 'fas fa-circle-check',
        metaText: filteredActiveCount > 0
            ? `当前筛选：${filteredSummaryLabel}。命中 ${formatCount(filteredActiveCount)} 项待关注告警，覆盖 ${formatCount(normalizedCategories.length)} 个模块，其中 ${formatCount(filteredCriticalCount)} 项为 critical。`
            : `当前筛选：${filteredSummaryLabel}。最近 ${formatCount(summary.lookback_hours || 0)} 小时内没有持续中的待关注告警，下面保留可复核的恢复轨迹。`,
        emptyMessage: ''
    };
}

function buildAdminWorkbenchOpsAlertBatchMuteModalState(state = {}, options = {}) {
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : {};
    const getModuleLabel = typeof options.getModuleLabel === 'function'
        ? options.getModuleLabel
        : ((value) => String(value || '').trim() || '模块');
    const getFilterSummaryLabel = typeof options.getFilterSummaryLabel === 'function'
        ? options.getFilterSummaryLabel
        : getAdminWorkbenchOpsAlertMonitorFilterSummaryLabel;
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Number(value || 0)));
    const getDefaultUntilValue = typeof options.getDefaultUntilValue === 'function'
        ? options.getDefaultUntilValue
        : (() => '');
    const moduleKeys = Array.isArray(normalizedState.moduleKeys) ? normalizedState.moduleKeys : [];
    const moduleLabels = moduleKeys.map((key) => getModuleLabel(key));
    const severityScopedNote = String(normalizedState.filters?.severity || 'all').trim().toLowerCase() !== 'all'
        ? '当前筛选里的级别条件只用于确定命中模块；本次静默会作用到对应模块的全部告警。'
        : '本次静默会直接写入模块级策略，命中的同类告警都会一起暂停外发。';

    return {
        summaryText: normalizedState.open
            ? `当前筛选：${getFilterSummaryLabel(normalizedState.filters || {}, options)} · 命中 ${formatCount(moduleKeys.length)} 个模块（${moduleLabels.join('、') || '无'}）`
            : '集中告警模块静默',
        noteText: severityScopedNote,
        allowCriticalActive: normalizedState.allowCritical !== false,
        submitDisabled: normalizedState.submitting === true,
        submitLabel: normalizedState.submitting ? '静默中...' : '保存静默',
        shouldSeedUntilValue: !normalizedState.submitting,
        defaultUntilValue: getDefaultUntilValue(),
        shouldFocusAfterOpen: normalizedState.open === true && normalizedState.submitting !== true
    };
}

function buildAdminWorkbenchOpsAlertMonitorItemDisplayState(item = {}, category = {}, options = {}) {
    const normalizedItem = item && typeof item === 'object' && !Array.isArray(item)
        ? item
        : {};
    const normalizedCategory = category && typeof category === 'object' && !Array.isArray(category)
        ? category
        : {};
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Number(value || 0)));
    const formatDateTime = typeof options.formatDateTime === 'function'
        ? options.formatDateTime
        : ((value) => String(value || '').trim() || '—');
    const getSeverityTone = typeof options.getSeverityTone === 'function'
        ? options.getSeverityTone
        : ((severity) => String(severity || '').trim().toLowerCase() === 'critical' ? 'danger' : 'warning');
    const getRiskTone = typeof options.getRiskTone === 'function'
        ? options.getRiskTone
        : (() => 'neutral');
    const getRiskLevelLabel = typeof options.getRiskLevelLabel === 'function'
        ? options.getRiskLevelLabel
        : ((value) => String(value || '').trim() || '中');
    const getItemAction = typeof options.getItemAction === 'function'
        ? options.getItemAction
        : (() => null);
    const getQuickAction = typeof options.getQuickAction === 'function'
        ? options.getQuickAction
        : (() => null);
    const getCaseActions = typeof options.getCaseActions === 'function'
        ? options.getCaseActions
        : (() => []);
    const getCaseStatusLabel = typeof options.getCaseStatusLabel === 'function'
        ? options.getCaseStatusLabel
        : ((value) => String(value || '').trim() || '待处理');
    const getCaseStatusTone = typeof options.getCaseStatusTone === 'function'
        ? options.getCaseStatusTone
        : (() => 'neutral');
    const getCaseSummaryText = typeof options.getCaseSummaryText === 'function'
        ? options.getCaseSummaryText
        : (() => '');
    const getRecentEvents = typeof options.getRecentEvents === 'function'
        ? options.getRecentEvents
        : (() => []);
    const getRecentEventText = typeof options.getRecentEventText === 'function'
        ? options.getRecentEventText
        : (() => '');
    const categoryKey = String(normalizedCategory.key || '').trim().toLowerCase();
    const severity = String(normalizedItem.severity || 'warning').trim().toLowerCase() || 'warning';
    const severityTone = getSeverityTone(severity);
    const riskLevel = String(normalizedItem.risk_level || '').trim().toLowerCase();
    const riskTone = getRiskTone(riskLevel);
    const itemAction = getItemAction(normalizedCategory, normalizedItem);
    const quickAction = getQuickAction(normalizedCategory, normalizedItem);
    const caseActions = getCaseActions(normalizedCategory, normalizedItem);
    const caseStatus = String(normalizedItem.case_status || '').trim().toLowerCase() || 'open';
    const caseTone = getCaseStatusTone(caseStatus);
    const recentEvents = getRecentEvents(normalizedItem);
    const metaParts = [
        normalizedItem.reference_label && normalizedItem.reference_value
            ? `${normalizedItem.reference_label}：${normalizedItem.reference_value}`
            : '',
        normalizedItem.created_at ? formatDateTime(normalizedItem.created_at) : ''
    ].filter(Boolean);
    const hasCaseContext = caseActions.length > 0
        || normalizedItem.case_owner_label
        || normalizedItem.case_note
        || normalizedItem.case_resolution
        || recentEvents.length > 0;

    return {
        title: normalizedItem.title || '系统告警',
        message: String(normalizedItem.message || '').trim(),
        topBadges: [
            { label: severity === 'critical' ? 'critical' : 'warning', tone: severityTone },
            riskLevel
                ? {
                    label: `风险 ${getRiskLevelLabel(riskLevel)}${Number.isFinite(Number(normalizedItem.risk_score)) ? ` · ${formatCount(normalizedItem.risk_score)}` : ''}`,
                    tone: riskTone
                }
                : null,
            hasCaseContext
                ? { label: `处置 ${getCaseStatusLabel(caseStatus)}`, tone: caseTone }
                : null
        ].filter(Boolean),
        progressPrefix: categoryKey === 'shop_risk' ? '值班处理' : '处理进度',
        progressText: hasCaseContext ? getCaseSummaryText(normalizedItem) : '',
        historyItems: recentEvents.map((event) => getRecentEventText(event)).filter(Boolean),
        autoResponseSummary: String(normalizedItem.auto_response_summary || '').trim(),
        responseSummary: String(normalizedItem.response_summary || '').trim(),
        metaText: metaParts.join(' · ') || '等待更多上下文',
        hasActions: Boolean(itemAction || quickAction || caseActions.length),
        caseActions,
        quickAction: quickAction || null,
        workspaceAction: itemAction || null
    };
}

function buildAdminWorkbenchOpsAlertMonitorCategoryRenderState(category = {}, filters = {}, options = {}) {
    const normalizedCategory = category && typeof category === 'object' && !Array.isArray(category)
        ? category
        : {};
    const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters)
        ? filters
        : {};
    const getCategoryCardState = typeof options.getCategoryCardState === 'function'
        ? options.getCategoryCardState
        : buildAdminWorkbenchOpsAlertMonitorCategoryCardState;
    const getItemDisplayState = typeof options.getItemDisplayState === 'function'
        ? options.getItemDisplayState
        : buildAdminWorkbenchOpsAlertMonitorItemDisplayState;
    const cardState = getCategoryCardState(normalizedCategory, normalizedFilters, options) || {};
    const items = Array.isArray(normalizedCategory.items) ? normalizedCategory.items : [];
    const categoryKey = String(normalizedCategory.key || '').trim();
    const workspaceActions = Array.isArray(cardState.actions) ? cardState.actions : [];

    return {
        key: categoryKey,
        tone: String(cardState.tone || '').trim() || 'neutral',
        title: String(cardState.title || normalizedCategory.label || '告警分类').trim(),
        description: String(cardState.description || normalizedCategory.description || '').trim(),
        latestSummary: String(cardState.latestSummary || '').trim(),
        latestMessage: String(cardState.latestMessage || '').trim(),
        emptyMessage: String(cardState.emptyMessage || '').trim(),
        hiddenHint: String(cardState.hiddenHint || '').trim(),
        statBadges: Array.isArray(cardState.statBadges) ? cardState.statBadges : [],
        items: items.map((item) => ({
            item,
            state: getItemDisplayState(item, normalizedCategory, options) || null
        })),
        actions: [
            {
                kind: 'checklist',
                actionName: 'settings-copy-ops-alert-monitor-category',
                icon: 'fas fa-list-check',
                label: '复制清单',
                attrs: {
                    'data-ops-alert-monitor-category-key': categoryKey
                }
            },
            ...workspaceActions.map((action) => ({
                kind: 'workspace',
                actionName: 'settings-open-ops-alert-workspace',
                icon: String(action?.icon || '').trim() || 'fas fa-circle-dot',
                label: String(action?.label || '').trim() || '打开工作台',
                attrs: {
                    'data-workspace-target': String(action?.target || '').trim()
                }
            }))
        ]
    };
}

function buildAdminWorkbenchOpsAlertMonitorBatchActionStates(categories = [], filters = {}, options = {}) {
    const normalizedCategories = Array.isArray(categories) ? categories : [];
    const buildBatchItems = typeof options.buildBatchItems === 'function'
        ? options.buildBatchItems
        : (() => []);
    const getBatchMuteModuleKeys = typeof options.getBatchMuteModuleKeys === 'function'
        ? options.getBatchMuteModuleKeys
        : (() => []);
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Number(value || 0)));

    return [
        {
            actionName: 'settings-batch-claim-ops-alert-monitor',
            count: buildBatchItems(normalizedCategories, 'assign', ''),
            emptyTitle: '当前筛选条件下没有可指派的告警',
            activeTitle: '当前筛选将指派 {count} 条告警'
        },
        {
            actionName: 'settings-batch-note-ops-alert-monitor',
            count: buildBatchItems(normalizedCategories, 'add_note', ''),
            emptyTitle: '当前筛选条件下没有可备注的告警',
            activeTitle: '当前筛选将备注 {count} 条告警'
        },
        {
            actionName: 'settings-batch-resolve-ops-alert-monitor',
            count: buildBatchItems(normalizedCategories, 'resolve', ''),
            emptyTitle: '当前筛选条件下没有可关闭的告警',
            activeTitle: '当前筛选将关闭 {count} 条告警'
        },
        {
            actionName: 'settings-batch-mute-ops-alert-monitor',
            count: getBatchMuteModuleKeys(normalizedCategories, ''),
            emptyTitle: '当前筛选条件下没有可静默的告警模块',
            activeTitle: '当前筛选将静默 {count} 个告警模块'
        }
    ].map((item) => {
        const rawCount = Array.isArray(item.count) ? item.count.length : Number(item.count || 0);
        return {
            actionName: item.actionName,
            count: rawCount,
            disabled: rawCount <= 0,
            title: rawCount > 0 ? item.activeTitle.replace('{count}', formatCount(rawCount)) : item.emptyTitle
        };
    });
}

function buildAdminWorkbenchOpsAlertMonitorViewState(state = {}, filters = {}, categories = [], options = {}) {
    const normalizedCategories = Array.isArray(categories) ? categories : [];
    const filterDefinitions = Array.isArray(options.filterDefinitions)
        ? options.filterDefinitions.filter(Boolean)
        : [];

    return {
        toolbarState: buildAdminWorkbenchOpsAlertMonitorFilterToolbarState(filters, {
            definitions: filterDefinitions
        }),
        panelState: buildAdminWorkbenchOpsAlertMonitorPanelState(state, filters, normalizedCategories, {
            formatCount: options.formatCount,
            getFilterSummaryLabel: options.getFilterSummaryLabel
        }),
        batchActionStates: buildAdminWorkbenchOpsAlertMonitorBatchActionStates(normalizedCategories, filters, {
            buildBatchItems: options.buildBatchItems,
            getBatchMuteModuleKeys: options.getBatchMuteModuleKeys,
            formatCount: options.formatCount
        })
    };
}

function formatAdminWorkbenchOpsAlertSignedCount(value, options = {}) {
    const numericValue = Number(value);
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((count) => String(Math.abs(Number(count || 0))));
    if (!Number.isFinite(numericValue) || numericValue === 0) {
        return '0';
    }
    return `${numericValue > 0 ? '+' : ''}${formatCount(numericValue)}`;
}

function formatAdminWorkbenchOpsAlertTimeShort(value, options = {}) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(String(options.locale || 'zh-CN'), {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

function getAdminWorkbenchOpsAlertBacklogDeltaTone(delta = 0) {
    const numericDelta = Number(delta || 0);
    if (numericDelta < 0) return 'success';
    if (numericDelta > 0) return 'warning';
    return 'neutral';
}

function getAdminWorkbenchOpsAlertMonitorCategoryActions(categoryKey = '') {
    const normalizedKey = String(categoryKey || '').trim().toLowerCase();
    const actionMap = {
        payments: [
            { target: 'payments-ops', label: '异常运维', icon: 'fas fa-shield-heart' },
            { target: 'payments-overview', label: '支付总览', icon: 'fas fa-credit-card' }
        ],
        tickets: [
            { target: 'tickets-pending', label: '待处理工单', icon: 'fas fa-ticket-alt' },
            { target: 'tickets-resolved', label: '已处理工单', icon: 'fas fa-ticket-simple' }
        ],
        inventory: [
            { target: 'shop-inventory', label: '库存 / 补货', icon: 'fas fa-box-open' }
        ],
        fulfillment: [
            { target: 'shop-fulfillment', label: '履约死信', icon: 'fas fa-truck-ramp-box' }
        ],
        shop_risk: [
            { target: 'shop-risk-orders', label: '风险订单', icon: 'fas fa-bag-shopping' },
            { target: 'shop-risk-discounts', label: '优惠券码', icon: 'fas fa-ticket' },
            { target: 'shop-risk-users', label: '用户详情', icon: 'fas fa-user-shield' }
        ],
        verify: [
            { target: 'verify-monitor', label: '验证运维', icon: 'fas fa-wave-square' }
        ],
        security: [
            { target: 'admin-audit-monitor', label: '访问审计', icon: 'fas fa-user-shield' }
        ]
    };

    return actionMap[normalizedKey] || [];
}

function normalizeAdminWorkbenchOpsAlertMonitorAssignableAdmins(state = {}, options = {}) {
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : {};
    const admins = Array.isArray(normalizedState.assignable_admins) ? normalizedState.assignable_admins : [];
    const fallbackRoleName = String(options.fallbackRoleName || 'admin').trim().toLowerCase() || 'admin';

    if (admins.length) {
        return admins.map((admin) => ({
            id: String(admin?.id || '').trim(),
            label: String(admin?.label || admin?.display_name || admin?.email || admin?.username || admin?.id || '').trim(),
            email: String(admin?.email || '').trim(),
            roleName: String(admin?.role_name || '').trim().toLowerCase(),
            isCurrent: admin?.is_current === true
        })).filter((admin) => admin.id && admin.label);
    }

    const fallbackAdminId = String(normalizedState.current_admin_id || '').trim();
    const fallbackAdminLabel = String(normalizedState.current_admin_label || '').trim();
    if (!fallbackAdminId || !fallbackAdminLabel) {
        return [];
    }

    return [{
        id: fallbackAdminId,
        label: fallbackAdminLabel,
        email: '',
        roleName: fallbackRoleName,
        isCurrent: true
    }];
}

function getAdminWorkbenchOpsAlertMonitorCurrentAdminId(state = {}) {
    return String(state?.current_admin_id || '').trim();
}

function buildAdminWorkbenchOpsAlertMonitorActionContext(category = {}, item = {}) {
    return normalizeOpsAlertWorkspaceContext({
        title: item?.title || '',
        alertType: item?.alert_type || '',
        category: category?.key || '',
        referenceLabel: item?.reference_label || '',
        referenceValue: item?.reference_value || '',
        targetId: item?.target_id || '',
        userId: item?.user_id || '',
        clientIp: item?.client_ip || '',
        discountCode: item?.discount_code || '',
        signalType: item?.signal_type || '',
        sessionId: item?.session_id || '',
        caseStatus: item?.case_status || '',
        caseOwnerAdminId: item?.case_owner_admin_id || '',
        caseOwnerLabel: item?.case_owner_label || ''
    });
}

function getAdminWorkbenchOpsAlertMonitorWorkspaceAction(category = {}, item = {}, options = {}) {
    const getWorkspaceAction = typeof options.getWorkspaceAction === 'function'
        ? options.getWorkspaceAction
        : getOpsAlertWorkspaceAction;
    const labelVariant = String(options.labelVariant || 'monitor').trim().toLowerCase() || 'monitor';

    if (typeof getWorkspaceAction !== 'function') {
        return null;
    }

    return getWorkspaceAction({
        categoryKey: String(category?.key || '').trim().toLowerCase(),
        alertType: String(item?.alert_type || '').trim().toLowerCase(),
        targetId: String(item?.target_id || '').trim().toLowerCase()
    }, {
        labelVariant
    });
}

function getAdminWorkbenchOpsAlertMonitorQuickAction(category = {}, item = {}) {
    const categoryKey = String(category?.key || '').trim().toLowerCase();
    const alertType = String(item?.alert_type || '').trim().toLowerCase();
    const primaryAction = String(item?.primary_action || '').trim().toLowerCase();
    const autoResponseStatus = String(item?.auto_response_status || '').trim().toLowerCase();

    if (categoryKey !== 'shop_risk' || alertType !== 'shop_order_risk_anomaly') {
        return null;
    }

    if (
        primaryAction === 'disable-coupon'
        && item?.discount_code
        && autoResponseStatus !== 'applied'
        && autoResponseStatus !== 'already_inactive'
    ) {
        return {
            action: 'disable-coupon',
            label: '一键停用优惠码',
            icon: 'fas fa-ban'
        };
    }

    if (
        primaryAction === 'open-user-ban'
        && item?.user_id
        && autoResponseStatus !== 'applied'
        && autoResponseStatus !== 'already_blocked'
    ) {
        return {
            action: 'open-user-ban',
            label: '发起封禁处理',
            icon: 'fas fa-user-lock'
        };
    }

    return null;
}

function getAdminWorkbenchOpsAlertMonitorCaseActions(category = {}, item = {}) {
    const categoryKey = String(category?.key || '').trim().toLowerCase();
    if (!categoryKey || !String(item?.target_id || '').trim()) {
        return [];
    }

    const status = String(item?.case_status || '').trim().toLowerCase() || 'open';
    if (status === 'resolved') {
        return [
            {
                action: 'reopen',
                label: '重新打开',
                icon: 'fas fa-arrow-rotate-left'
            },
            {
                action: 'add_note',
                label: '补充备注',
                icon: 'fas fa-note-sticky'
            }
        ];
    }

    return [
        {
            action: 'assign',
            label: status === 'claimed' ? '转交负责人' : '指派负责人',
            icon: 'fas fa-user-check'
        },
        {
            action: 'add_note',
            label: '备注',
            icon: 'fas fa-note-sticky'
        },
        {
            action: 'resolve',
            label: '关闭',
            icon: 'fas fa-circle-check'
        }
    ];
}

function getAdminWorkbenchDefaultOpsAlertMonitorShiftReport() {
    return {
        shift_hours: 12,
        bucket_hours: 2,
        window_start: '',
        window_end: '',
        previous_window_start: '',
        previous_window_end: '',
        totals: {
            claimed_count: 0,
            assigned_count: 0,
            resolved_count: 0,
            note_count: 0,
            reopened_count: 0,
            avg_resolution_minutes: null,
            active_backlog_count: 0,
            active_claimed_count: 0,
            active_pending_count: 0,
            previous_backlog_count: 0,
            backlog_delta: 0,
            longest_waiting_minutes: null
        },
        close_reasons: [],
        admin_stats: [],
        categories: [],
        trend: []
    };
}

function getAdminWorkbenchDefaultOpsAlertHealthState() {
    return {
        status: 'idle',
        fetched_at: '',
        summary: {
            lookback_hours: 72,
            total_job_count: 0,
            total_attempt_count: 0,
            delivered_count: 0,
            failed_count: 0,
            dead_letter_count: 0,
            enabled_channel_count: 0
        },
        channels: [],
        message: '等待加载'
    };
}

function getAdminWorkbenchOpsAlertSecretInputDocument(options = {}) {
    if (options.document && typeof options.document.getElementById === 'function') {
        return options.document;
    }
    if (typeof document !== 'undefined' && document && typeof document.getElementById === 'function') {
        return document;
    }
    return null;
}

function readAdminWorkbenchOpsAlertSecretInputs(options = {}) {
    const documentRef = getAdminWorkbenchOpsAlertSecretInputDocument(options);
    const readValue = (id) => {
        const input = documentRef?.getElementById?.(id);
        return String(input?.value || '').trim();
    };

    return {
        telegram_bot_token: readValue('opsAlertTelegramBotToken'),
        feishu_webhook_url: readValue('opsAlertFeishuWebhookUrl'),
        email_api_key: readValue('opsAlertEmailApiKey')
    };
}

function getAdminWorkbenchToggleState(documentRef, id, fallbackValue = false) {
    const element = documentRef?.getElementById?.(id);
    return element?.classList?.contains?.('active') ?? fallbackValue;
}

function getAdminWorkbenchInputValue(documentRef, id, fallbackValue = '') {
    const element = documentRef?.getElementById?.(id);
    return element?.value ?? fallbackValue;
}

function clearAdminWorkbenchOpsAlertSecretInputs(options = {}) {
    const documentRef = getAdminWorkbenchOpsAlertSecretInputDocument(options);
    [
        'opsAlertTelegramBotToken',
        'opsAlertFeishuWebhookUrl',
        'opsAlertEmailApiKey'
    ].forEach((id) => {
        const input = documentRef?.getElementById?.(id);
        if (input) input.value = '';
    });
}

function buildAdminWorkbenchOpsAlertSettingsRequestBody(config, options = {}) {
    const body = {
        config,
        secrets: options.secrets && typeof options.secrets === 'object' && !Array.isArray(options.secrets)
            ? options.secrets
            : readAdminWorkbenchOpsAlertSecretInputs(options)
    };
    const normalizedAction = String(options.action || '').trim();

    if (normalizedAction) {
        body.action = normalizedAction;
    }

    if (Array.isArray(options.caseEvents) && options.caseEvents.length) {
        body.case_events = options.caseEvents;
    }

    return body;
}

function buildAdminWorkbenchOpsAlertConfigDraft(currentConfig = {}, options = {}) {
    const normalizedCurrentConfig = currentConfig && typeof currentConfig === 'object' && !Array.isArray(currentConfig)
        ? currentConfig
        : {};
    const normalizeQuickReplyTemplates = typeof options.normalizeQuickReplyTemplates === 'function'
        ? options.normalizeQuickReplyTemplates
        : ((value) => Array.isArray(value) ? value.map((item) => ({ ...(item || {}) })) : []);

    return {
        ...normalizedCurrentConfig,
        temporary_mute: {
            ...(normalizedCurrentConfig.temporary_mute || {})
        },
        quiet_hours: {
            ...(normalizedCurrentConfig.quiet_hours || {})
        },
        work_hours: {
            ...(normalizedCurrentConfig.work_hours || {})
        },
        mute_rules: {
            types: {
                ...(normalizedCurrentConfig.mute_rules?.types || {})
            },
            modules: {
                ...(normalizedCurrentConfig.mute_rules?.modules || {})
            }
        },
        channels: {
            telegram: {
                ...(normalizedCurrentConfig.channels?.telegram || {})
            },
            feishu: {
                ...(normalizedCurrentConfig.channels?.feishu || {})
            },
            email: {
                ...(normalizedCurrentConfig.channels?.email || {})
            }
        },
        routing: Object.keys(normalizedCurrentConfig.routing || {}).reduce((result, routingKey) => {
            result[routingKey] = {
                ...(normalizedCurrentConfig.routing?.[routingKey] || {})
            };
            return result;
        }, {}),
        shop_order_risk: {
            ...(normalizedCurrentConfig.shop_order_risk || {})
        },
        shop_inventory: {
            ...(normalizedCurrentConfig.shop_inventory || {})
        },
        customer_chat_message: {
            ...(normalizedCurrentConfig.customer_chat_message || {}),
            quick_reply_templates: normalizeQuickReplyTemplates(normalizedCurrentConfig.customer_chat_message?.quick_reply_templates)
        },
        shop_purchase_success: {
            ...(normalizedCurrentConfig.shop_purchase_success || {})
        },
        wallet_recharge_success: {
            ...(normalizedCurrentConfig.wallet_recharge_success || {})
        },
        tickets: {
            ...(normalizedCurrentConfig.tickets || {})
        },
        shop_order_delivery: {
            ...(normalizedCurrentConfig.shop_order_delivery || {})
        },
        verify_quota: {
            ...(normalizedCurrentConfig.verify_quota || {})
        },
        verify_queue: {
            ...(normalizedCurrentConfig.verify_queue || {})
        },
        verify_failure: {
            ...(normalizedCurrentConfig.verify_failure || {})
        },
        payment_gateway: {
            ...(normalizedCurrentConfig.payment_gateway || {})
        }
    };
}

function buildAdminWorkbenchOpsAlertSummaryModeHintText(section = {}, options = {}) {
    const normalizedSection = section && typeof section === 'object' && !Array.isArray(section)
        ? section
        : {};
    const normalizeScheduleMode = typeof options.normalizeScheduleMode === 'function'
        ? options.normalizeScheduleMode
        : ((value, fallbackValue = 'rolling_window') => String(value || fallbackValue).trim().toLowerCase() || fallbackValue);
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Math.max(0, Number(value || 0))));
    const formatTimeNumber = typeof options.formatTimeNumber === 'function'
        ? options.formatTimeNumber
        : ((value, min = 0, max = 59) => {
            const normalizedValue = Math.min(max, Math.max(min, Number(value || 0)));
            return String(Math.round(normalizedValue)).padStart(2, '0');
        });
    const formatHourMinute = typeof options.formatHourMinute === 'function'
        ? options.formatHourMinute
        : ((hour, minute) => `${formatTimeNumber(hour, 0, 23)}:${formatTimeNumber(minute, 0, 59)}`);
    const monitorEnabled = options.monitorEnabled !== false;
    const summaryEnabled = options.summaryEnabled !== false;

    if (!monitorEnabled) {
        return '当前主监控未启用，开启后才会按这里的节奏统一发送。';
    }
    if (!summaryEnabled) {
        return '当前未启用定时汇总，开启后才会按这里的节奏统一发送。';
    }

    const scheduleMode = normalizeScheduleMode(normalizedSection.summary_schedule_mode, 'rolling_window');
    if (scheduleMode === 'hourly') {
        return `当前会在每小时 ${formatTimeNumber(normalizedSection.summary_hourly_minute, 0, 59)} 分统一发送。`;
    }
    if (scheduleMode === 'daily') {
        return `当前会在每天 ${formatHourMinute(normalizedSection.summary_daily_hour, normalizedSection.summary_daily_minute)} 统一发送。`;
    }
    return `当前会把 ${formatCount(normalizedSection.summary_window_minutes || 0)} 分钟内的告警先合并，在窗口结束后统一发送。`;
}

function collectAdminWorkbenchOpsAlertUnifiedSummaryDraft(currentDraft = {}, options = {}) {
    const documentRef = getAdminWorkbenchOpsAlertSecretInputDocument(options);
    const ids = options.ids && typeof options.ids === 'object' ? options.ids : {};
    const normalizeScheduleMode = typeof options.normalizeScheduleMode === 'function'
        ? options.normalizeScheduleMode
        : ((value, fallbackValue = 'rolling_window') => String(value || fallbackValue).trim().toLowerCase() || fallbackValue);
    const clamp = typeof options.clamp === 'function'
        ? options.clamp
        : ((value, min, max) => Math.min(max, Math.max(min, Number(value || 0))));
    const toWholeNumber = typeof options.toWholeNumber === 'function'
        ? options.toWholeNumber
        : ((value, fallbackValue = 0) => {
            const parsed = Number.parseInt(value, 10);
            return Number.isFinite(parsed) ? parsed : fallbackValue;
        });
    const readCheckbox = (id, fallbackValue = false) => {
        const input = documentRef?.getElementById?.(id);
        return input ? input.checked === true : fallbackValue === true;
    };

    return {
        ...currentDraft,
        summary_enabled: readCheckbox(ids.summaryEnabled || 'opsAlertUnifiedSummaryDraftEnabled', currentDraft.summary_enabled),
        work_hours_only_enabled: readCheckbox(ids.workHoursOnlyEnabled || 'opsAlertUnifiedSummaryDraftWorkHoursOnlyEnabled', currentDraft.work_hours_only_enabled),
        summary_schedule_mode: normalizeScheduleMode(
            getAdminWorkbenchInputValue(
                documentRef,
                ids.summaryScheduleMode || 'opsAlertUnifiedSummaryDraftScheduleMode',
                currentDraft.summary_schedule_mode || 'rolling_window'
            ),
            'rolling_window'
        ),
        summary_window_minutes: clamp(
            toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    ids.summaryWindowMinutes || 'opsAlertUnifiedSummaryDraftWindowMinutes',
                    currentDraft.summary_window_minutes ?? 60
                ),
                currentDraft.summary_window_minutes ?? 60
            ),
            5,
            24 * 60
        ),
        summary_hourly_minute: clamp(
            toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    ids.summaryHourlyMinute || 'opsAlertUnifiedSummaryDraftHourlyMinute',
                    currentDraft.summary_hourly_minute ?? 0
                ),
                currentDraft.summary_hourly_minute ?? 0
            ),
            0,
            59
        ),
        summary_daily_hour: clamp(
            toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    ids.summaryDailyHour || 'opsAlertUnifiedSummaryDraftDailyHour',
                    currentDraft.summary_daily_hour ?? 9
                ),
                currentDraft.summary_daily_hour ?? 9
            ),
            0,
            23
        ),
        summary_daily_minute: clamp(
            toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    ids.summaryDailyMinute || 'opsAlertUnifiedSummaryDraftDailyMinute',
                    currentDraft.summary_daily_minute ?? 0
                ),
                currentDraft.summary_daily_minute ?? 0
            ),
            0,
            59
        ),
        summary_max_items: clamp(
            toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    ids.summaryMaxItems || 'opsAlertUnifiedSummaryDraftMaxItems',
                    currentDraft.summary_max_items ?? 10
                ),
                currentDraft.summary_max_items ?? 10
            ),
            1,
            50
        )
    };
}

function buildAdminWorkbenchOpsAlertUnifiedSummaryConsensus(config = {}, options = {}) {
    const normalizedConfig = config && typeof config === 'object' && !Array.isArray(config)
        ? config
        : {};
    const definitions = Array.isArray(options.definitions)
        ? options.definitions.filter(Boolean)
        : [];
    const selectedDefinitions = Array.isArray(options.selectedDefinitions)
        ? options.selectedDefinitions.filter(Boolean)
        : [];
    const defaults = options.defaults && typeof options.defaults === 'object' && !Array.isArray(options.defaults)
        ? options.defaults
        : {};
    const normalizeScheduleMode = typeof options.normalizeScheduleMode === 'function'
        ? options.normalizeScheduleMode
        : ((value, fallbackValue = 'rolling_window') => String(value || fallbackValue).trim().toLowerCase() || fallbackValue);
    const clamp = typeof options.clamp === 'function'
        ? options.clamp
        : ((value, min, max) => Math.min(max, Math.max(min, Number(value || 0))));
    const toWholeNumber = typeof options.toWholeNumber === 'function'
        ? options.toWholeNumber
        : ((value, fallbackValue = 0) => {
            const parsed = Number.parseInt(value, 10);
            return Number.isFinite(parsed) ? parsed : fallbackValue;
        });
    const selectedSections = selectedDefinitions.map((definition) => (
        normalizedConfig[definition.key] || defaults[definition.key] || {}
    ));
    const pickConsensusValue = (consensusDefinitions, sections, resolver) => {
        if (!consensusDefinitions.length || !sections.length) {
            return undefined;
        }

        const values = sections.map((section, index) => resolver(section, consensusDefinitions[index]));
        const firstValue = values[0];
        return values.every((value) => value === firstValue) ? firstValue : undefined;
    };
    const workHoursDefinitions = selectedDefinitions.filter((definition) => definition.supports_work_hours_only);
    const workHoursSections = workHoursDefinitions.map((definition) => (
        normalizedConfig[definition.key] || defaults[definition.key] || {}
    ));

    return {
        summary_enabled: pickConsensusValue(
            selectedDefinitions,
            selectedSections,
            (section) => section.summary_enabled === true
        ),
        work_hours_only_enabled: workHoursDefinitions.length
            ? pickConsensusValue(
                workHoursDefinitions,
                workHoursSections,
                (section) => section.work_hours_only_enabled === true
            )
            : false,
        summary_schedule_mode: pickConsensusValue(
            selectedDefinitions,
            selectedSections,
            (section) => normalizeScheduleMode(section.summary_schedule_mode, 'rolling_window')
        ),
        summary_window_minutes: pickConsensusValue(
            selectedDefinitions,
            selectedSections,
            (section) => clamp(toWholeNumber(section.summary_window_minutes, 60), 5, 24 * 60)
        ),
        summary_hourly_minute: pickConsensusValue(
            selectedDefinitions,
            selectedSections,
            (section) => clamp(toWholeNumber(section.summary_hourly_minute, 0), 0, 59)
        ),
        summary_daily_hour: pickConsensusValue(
            selectedDefinitions,
            selectedSections,
            (section) => clamp(toWholeNumber(section.summary_daily_hour, 9), 0, 23)
        ),
        summary_daily_minute: pickConsensusValue(
            selectedDefinitions,
            selectedSections,
            (section) => clamp(toWholeNumber(section.summary_daily_minute, 0), 0, 59)
        ),
        summary_max_items: pickConsensusValue(
            selectedDefinitions,
            selectedSections,
            (section) => clamp(toWholeNumber(section.summary_max_items, 10), 1, 50)
        )
    };
}

function buildAdminWorkbenchOpsAlertUnifiedSummaryDraftControlState(draft = {}, options = {}) {
    const normalizedDraft = draft && typeof draft === 'object' && !Array.isArray(draft)
        ? draft
        : {};
    const selectedCount = Math.max(0, Number(options.selectedCount || 0));
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Math.max(0, Number(value || 0))));
    const summaryModeControlStateBuilder = typeof options.buildSummaryModeControlState === 'function'
        ? options.buildSummaryModeControlState
        : buildAdminWorkbenchOpsAlertSummaryModeControlState;

    return {
        selectedCount,
        applyDisabled: selectedCount <= 0,
        applyLabel: `应用到所选告警${selectedCount > 0 ? `（${formatCount(selectedCount)} 类）` : ''}`,
        summaryModeControlState: summaryModeControlStateBuilder(normalizedDraft, {
            monitorEnabled: true,
            summaryEnabled: normalizedDraft.summary_enabled === true
        })
    };
}

function collectAdminWorkbenchOpsAlertStrategyDraft(currentConfig = {}, options = {}) {
    const documentRef = getAdminWorkbenchOpsAlertSecretInputDocument(options);
    const normalizeDateTimeLocalInputValue = typeof options.normalizeDateTimeLocalInputValue === 'function'
        ? options.normalizeDateTimeLocalInputValue
        : ((value) => String(value || '').trim());
    const clamp = typeof options.clamp === 'function'
        ? options.clamp
        : ((value, min, max) => Math.min(max, Math.max(min, Number(value || 0))));
    const toWholeNumber = typeof options.toWholeNumber === 'function'
        ? options.toWholeNumber
        : ((value, fallbackValue = 0) => {
            const parsed = Number.parseInt(value, 10);
            return Number.isFinite(parsed) ? parsed : fallbackValue;
        });
    const normalizeConfigStringArray = typeof options.normalizeConfigStringArray === 'function'
        ? options.normalizeConfigStringArray
        : ((value) => Array.isArray(value)
            ? value.map((item) => String(item || '').trim()).filter(Boolean)
            : String(value || '').split('\n').map((item) => item.trim()).filter(Boolean));
    const normalizeOpsAlertSeverity = typeof options.normalizeOpsAlertSeverity === 'function'
        ? options.normalizeOpsAlertSeverity
        : ((value, fallbackValue = 'warning') => String(value || fallbackValue).trim().toLowerCase() || fallbackValue);
    const getMuteRuleDefinitions = typeof options.getMuteRuleDefinitions === 'function'
        ? options.getMuteRuleDefinitions
        : (() => []);
    const getMuteRuleElementId = typeof options.getMuteRuleElementId === 'function'
        ? options.getMuteRuleElementId
        : (() => '');
    const getRoutingCheckboxId = typeof options.getRoutingCheckboxId === 'function'
        ? options.getRoutingCheckboxId
        : (() => '');

    return {
        enabled: getAdminWorkbenchToggleState(documentRef, 'opsAlertEnabledToggle', currentConfig.enabled),
        temporary_mute: {
            ...(currentConfig.temporary_mute || {}),
            until: normalizeDateTimeLocalInputValue(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertTemporaryMuteUntil', currentConfig.temporary_mute?.until || '')
            ),
            allow_critical: getAdminWorkbenchToggleState(
                documentRef,
                'opsAlertTemporaryMuteAllowCriticalToggle',
                currentConfig.temporary_mute?.allow_critical
            )
        },
        quiet_hours: {
            ...(currentConfig.quiet_hours || {}),
            enabled: getAdminWorkbenchToggleState(documentRef, 'opsAlertQuietHoursEnabledToggle', currentConfig.quiet_hours?.enabled),
            start_hour: clamp(
                toWholeNumber(
                    getAdminWorkbenchInputValue(documentRef, 'opsAlertQuietHoursStartHour', currentConfig.quiet_hours?.start_hour),
                    currentConfig.quiet_hours?.start_hour
                ),
                0,
                23
            ),
            end_hour: clamp(
                toWholeNumber(
                    getAdminWorkbenchInputValue(documentRef, 'opsAlertQuietHoursEndHour', currentConfig.quiet_hours?.end_hour),
                    currentConfig.quiet_hours?.end_hour
                ),
                0,
                23
            ),
            timezone: String(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertQuietHoursTimezone', currentConfig.quiet_hours?.timezone || '')
            ).trim() || currentConfig.quiet_hours?.timezone || '',
            allow_critical: getAdminWorkbenchToggleState(
                documentRef,
                'opsAlertQuietHoursAllowCriticalToggle',
                currentConfig.quiet_hours?.allow_critical
            )
        },
        work_hours: {
            ...(currentConfig.work_hours || {}),
            enabled: getAdminWorkbenchToggleState(documentRef, 'opsAlertWorkHoursEnabledToggle', currentConfig.work_hours?.enabled),
            start_hour: clamp(
                toWholeNumber(
                    getAdminWorkbenchInputValue(documentRef, 'opsAlertWorkHoursStartHour', currentConfig.work_hours?.start_hour),
                    currentConfig.work_hours?.start_hour
                ),
                0,
                23
            ),
            end_hour: clamp(
                toWholeNumber(
                    getAdminWorkbenchInputValue(documentRef, 'opsAlertWorkHoursEndHour', currentConfig.work_hours?.end_hour),
                    currentConfig.work_hours?.end_hour
                ),
                0,
                23
            ),
            timezone: String(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertWorkHoursTimezone', currentConfig.work_hours?.timezone || '')
            ).trim() || currentConfig.work_hours?.timezone || ''
        },
        mute_rules: ['types', 'modules'].reduce((result, scope) => {
            const currentScope = currentConfig.mute_rules?.[scope] || {};
            result[scope] = { ...currentScope };
            getMuteRuleDefinitions(scope).forEach((definition) => {
                const currentRule = currentScope?.[definition.key] || {
                    until: '',
                    allow_critical: true
                };
                result[scope][definition.key] = {
                    ...currentRule,
                    until: normalizeDateTimeLocalInputValue(
                        getAdminWorkbenchInputValue(
                            documentRef,
                            getMuteRuleElementId(scope, definition.key, 'Until'),
                            currentRule.until
                        )
                    ),
                    allow_critical: getAdminWorkbenchToggleState(
                        documentRef,
                        getMuteRuleElementId(scope, definition.key, 'AllowCriticalToggle'),
                        currentRule.allow_critical
                    )
                };
            });
            return result;
        }, {}),
        channels: {
            telegram: {
                ...(currentConfig.channels?.telegram || {}),
                enabled: getAdminWorkbenchToggleState(documentRef, 'opsAlertTelegramEnabledToggle', currentConfig.channels?.telegram?.enabled),
                chat_ids: normalizeConfigStringArray(
                    getAdminWorkbenchInputValue(documentRef, 'opsAlertTelegramChatIds', currentConfig.channels?.telegram?.chat_ids || [])
                ),
                minimum_severity: normalizeOpsAlertSeverity(
                    getAdminWorkbenchInputValue(documentRef, 'opsAlertTelegramSeverity', currentConfig.channels?.telegram?.minimum_severity),
                    currentConfig.channels?.telegram?.minimum_severity
                )
            },
            feishu: {
                ...(currentConfig.channels?.feishu || {}),
                enabled: getAdminWorkbenchToggleState(documentRef, 'opsAlertFeishuEnabledToggle', currentConfig.channels?.feishu?.enabled),
                minimum_severity: normalizeOpsAlertSeverity(
                    getAdminWorkbenchInputValue(documentRef, 'opsAlertFeishuSeverity', currentConfig.channels?.feishu?.minimum_severity),
                    currentConfig.channels?.feishu?.minimum_severity
                )
            },
            email: {
                ...(currentConfig.channels?.email || {}),
                enabled: getAdminWorkbenchToggleState(documentRef, 'opsAlertEmailEnabledToggle', currentConfig.channels?.email?.enabled),
                minimum_severity: normalizeOpsAlertSeverity(
                    getAdminWorkbenchInputValue(documentRef, 'opsAlertEmailSeverity', currentConfig.channels?.email?.minimum_severity),
                    currentConfig.channels?.email?.minimum_severity
                ),
                recipients: normalizeConfigStringArray(
                    getAdminWorkbenchInputValue(documentRef, 'opsAlertEmailRecipients', currentConfig.channels?.email?.recipients || [])
                ),
                from_address: String(
                    getAdminWorkbenchInputValue(documentRef, 'opsAlertEmailFromAddress', currentConfig.channels?.email?.from_address || '')
                ).trim(),
                reply_to: String(
                    getAdminWorkbenchInputValue(documentRef, 'opsAlertEmailReplyTo', currentConfig.channels?.email?.reply_to || '')
                ).trim(),
                subject_prefix: String(
                    getAdminWorkbenchInputValue(documentRef, 'opsAlertEmailSubjectPrefix', currentConfig.channels?.email?.subject_prefix || '')
                ).trim() || currentConfig.channels?.email?.subject_prefix || ''
            }
        },
        routing: Object.keys(currentConfig.routing || {}).reduce((result, routingKey) => {
            result[routingKey] = {
                ...(currentConfig.routing?.[routingKey] || {})
            };
            ['telegram', 'feishu', 'email'].forEach((channelKey) => {
                const checkbox = documentRef?.getElementById?.(getRoutingCheckboxId(routingKey, channelKey));
                if (!checkbox) return;
                result[routingKey][channelKey] = checkbox.checked;
            });
            return result;
        }, {})
    };
}

function collectAdminWorkbenchOpsAlertOperationalThresholdDrafts(currentConfig = {}, options = {}) {
    const documentRef = getAdminWorkbenchOpsAlertSecretInputDocument(options);
    const toWholeNumber = typeof options.toWholeNumber === 'function'
        ? options.toWholeNumber
        : ((value, fallbackValue = 0) => {
            const parsed = Number.parseInt(value, 10);
            return Number.isFinite(parsed) ? parsed : fallbackValue;
        });
    const normalizeOpsAlertSummaryScheduleMode = typeof options.normalizeOpsAlertSummaryScheduleMode === 'function'
        ? options.normalizeOpsAlertSummaryScheduleMode
        : ((value, fallbackValue = 'hourly') => String(value || fallbackValue).trim().toLowerCase() || fallbackValue);
    const currentShopOrderRisk = currentConfig.shop_order_risk || {};
    const currentShopInventory = currentConfig.shop_inventory || {};
    const currentCustomerChatMessage = currentConfig.customer_chat_message || {};
    const currentShopPurchaseSuccess = currentConfig.shop_purchase_success || {};
    const currentWalletRechargeSuccess = currentConfig.wallet_recharge_success || {};
    const currentTickets = currentConfig.tickets || {};
    const currentShopOrderDelivery = currentConfig.shop_order_delivery || {};
    const currentVerifyQuota = currentConfig.verify_quota || {};
    const currentVerifyQueue = currentConfig.verify_queue || {};
    const currentVerifyFailure = currentConfig.verify_failure || {};
    const currentPaymentGateway = currentConfig.payment_gateway || {};
    const readSummaryDraft = (prefix, currentSection = {}) => ({
        summary_enabled: getAdminWorkbenchToggleState(documentRef, `${prefix}SummaryEnabledToggle`, currentSection.summary_enabled),
        summary_window_minutes: toWholeNumber(
            getAdminWorkbenchInputValue(documentRef, `${prefix}SummaryWindowMinutes`, currentSection.summary_window_minutes),
            currentSection.summary_window_minutes
        ),
        summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
            getAdminWorkbenchInputValue(documentRef, `${prefix}SummaryScheduleMode`, currentSection.summary_schedule_mode),
            currentSection.summary_schedule_mode
        ),
        summary_hourly_minute: toWholeNumber(
            getAdminWorkbenchInputValue(documentRef, `${prefix}SummaryHourlyMinute`, currentSection.summary_hourly_minute),
            currentSection.summary_hourly_minute
        ),
        summary_daily_hour: toWholeNumber(
            getAdminWorkbenchInputValue(documentRef, `${prefix}SummaryDailyHour`, currentSection.summary_daily_hour),
            currentSection.summary_daily_hour
        ),
        summary_daily_minute: toWholeNumber(
            getAdminWorkbenchInputValue(documentRef, `${prefix}SummaryDailyMinute`, currentSection.summary_daily_minute),
            currentSection.summary_daily_minute
        ),
        summary_max_items: toWholeNumber(
            getAdminWorkbenchInputValue(documentRef, `${prefix}SummaryMaxItems`, currentSection.summary_max_items),
            currentSection.summary_max_items
        )
    });
    const readSweepIntervalMs = (id, currentMs) => Math.max(
        10000,
        toWholeNumber(
            getAdminWorkbenchInputValue(
                documentRef,
                id,
                Math.max(1, Math.round(Number(currentMs || 0) / 60000))
            ),
            Math.max(1, Math.round(Number(currentMs || 0) / 60000))
        ) * 60 * 1000
    );
    const readSweepSummaryDraft = (prefix, currentSection = {}) => ({
        ...currentSection,
        enabled: getAdminWorkbenchToggleState(documentRef, `${prefix}EnabledToggle`, currentSection.enabled),
        sweep_interval_ms: readSweepIntervalMs(`${prefix}SweepIntervalMinutes`, currentSection.sweep_interval_ms),
        lookback_minutes: toWholeNumber(
            getAdminWorkbenchInputValue(documentRef, `${prefix}LookbackMinutes`, currentSection.lookback_minutes),
            currentSection.lookback_minutes
        ),
        dedupe_window_minutes: toWholeNumber(
            getAdminWorkbenchInputValue(documentRef, `${prefix}DedupeWindowMinutes`, currentSection.dedupe_window_minutes),
            currentSection.dedupe_window_minutes
        ),
        work_hours_only_enabled: getAdminWorkbenchToggleState(
            documentRef,
            `${prefix}WorkHoursOnlyEnabledToggle`,
            currentSection.work_hours_only_enabled
        ),
        ...readSummaryDraft(prefix, currentSection)
    });

    return {
        shop_order_risk: {
            ...currentShopOrderRisk,
            auto_response_enabled: getAdminWorkbenchToggleState(
                documentRef,
                'opsAlertShopRiskAutoResponseEnabledToggle',
                currentShopOrderRisk.auto_response_enabled
            ),
            auto_disable_coupon_min_risk_score: toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    'opsAlertShopRiskAutoDisableCouponMinRiskScore',
                    currentShopOrderRisk.auto_disable_coupon_min_risk_score
                ),
                currentShopOrderRisk.auto_disable_coupon_min_risk_score
            ),
            auto_ban_user_min_risk_score: toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    'opsAlertShopRiskAutoBanUserMinRiskScore',
                    currentShopOrderRisk.auto_ban_user_min_risk_score
                ),
                currentShopOrderRisk.auto_ban_user_min_risk_score
            ),
            auto_ban_user_duration_days: toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    'opsAlertShopRiskAutoBanUserDurationDays',
                    currentShopOrderRisk.auto_ban_user_duration_days
                ),
                currentShopOrderRisk.auto_ban_user_duration_days
            ),
            auto_suspend_product_min_risk_score: toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    'opsAlertShopRiskAutoSuspendProductMinRiskScore',
                    currentShopOrderRisk.auto_suspend_product_min_risk_score
                ),
                currentShopOrderRisk.auto_suspend_product_min_risk_score
            )
        },
        shop_inventory: {
            ...currentShopInventory,
            enabled: getAdminWorkbenchToggleState(documentRef, 'opsAlertShopInventoryEnabledToggle', currentShopInventory.enabled),
            low_stock_threshold: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertShopInventoryLowStockThreshold', currentShopInventory.low_stock_threshold),
                currentShopInventory.low_stock_threshold
            ),
            sweep_interval_ms: readSweepIntervalMs('opsAlertShopInventorySweepIntervalMinutes', currentShopInventory.sweep_interval_ms),
            sales_window_days: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertShopInventorySalesWindowDays', currentShopInventory.sales_window_days),
                currentShopInventory.sales_window_days
            ),
            dedupe_window_minutes: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertShopInventoryDedupeWindowMinutes', currentShopInventory.dedupe_window_minutes),
                currentShopInventory.dedupe_window_minutes
            ),
            recovery_notification_enabled: getAdminWorkbenchToggleState(
                documentRef,
                'opsAlertShopInventoryRecoveryNotificationEnabledToggle',
                currentShopInventory.recovery_notification_enabled
            ),
            ...readSummaryDraft('opsAlertShopInventory', currentShopInventory)
        },
        customer_chat_message: {
            ...readSweepSummaryDraft('opsAlertCustomerChatMessage', currentCustomerChatMessage)
        },
        shop_purchase_success: {
            ...readSweepSummaryDraft('opsAlertShopPurchaseSuccess', currentShopPurchaseSuccess)
        },
        wallet_recharge_success: {
            ...readSweepSummaryDraft('opsAlertWalletRechargeSuccess', currentWalletRechargeSuccess)
        },
        tickets: {
            ...currentTickets,
            enabled: getAdminWorkbenchToggleState(documentRef, 'opsAlertTicketsEnabledToggle', currentTickets.enabled),
            sweep_interval_ms: readSweepIntervalMs('opsAlertTicketsSweepIntervalMinutes', currentTickets.sweep_interval_ms),
            pending_overdue_minutes: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertTicketsPendingOverdueMinutes', currentTickets.pending_overdue_minutes),
                currentTickets.pending_overdue_minutes
            ),
            critical_overdue_minutes: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertTicketsCriticalOverdueMinutes', currentTickets.critical_overdue_minutes),
                currentTickets.critical_overdue_minutes
            ),
            state_lookback_minutes: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertTicketsStateLookbackMinutes', currentTickets.state_lookback_minutes),
                currentTickets.state_lookback_minutes
            ),
            dedupe_window_minutes: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertTicketsDedupeWindowMinutes', currentTickets.dedupe_window_minutes),
                currentTickets.dedupe_window_minutes
            ),
            work_hours_only_enabled: getAdminWorkbenchToggleState(
                documentRef,
                'opsAlertTicketsWorkHoursOnlyEnabledToggle',
                currentTickets.work_hours_only_enabled
            ),
            ...readSummaryDraft('opsAlertTickets', currentTickets)
        },
        shop_order_delivery: {
            ...currentShopOrderDelivery,
            enabled: getAdminWorkbenchToggleState(documentRef, 'opsAlertShopOrderDeliveryEnabledToggle', currentShopOrderDelivery.enabled),
            lookback_days: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertShopOrderDeliveryLookbackDays', currentShopOrderDelivery.lookback_days),
                currentShopOrderDelivery.lookback_days
            ),
            state_lookback_minutes: toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    'opsAlertShopOrderDeliveryStateLookbackMinutes',
                    currentShopOrderDelivery.state_lookback_minutes
                ),
                currentShopOrderDelivery.state_lookback_minutes
            ),
            retry_waiting_min_attempts: toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    'opsAlertShopOrderDeliveryRetryWaitingMinAttempts',
                    currentShopOrderDelivery.retry_waiting_min_attempts
                ),
                currentShopOrderDelivery.retry_waiting_min_attempts
            ),
            sweep_interval_ms: readSweepIntervalMs('opsAlertShopOrderDeliverySweepIntervalMinutes', currentShopOrderDelivery.sweep_interval_ms),
            dedupe_window_minutes: toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    'opsAlertShopOrderDeliveryDedupeWindowMinutes',
                    currentShopOrderDelivery.dedupe_window_minutes
                ),
                currentShopOrderDelivery.dedupe_window_minutes
            ),
            incident_enabled: getAdminWorkbenchToggleState(
                documentRef,
                'opsAlertShopOrderDeliveryIncidentEnabledToggle',
                currentShopOrderDelivery.incident_enabled
            ),
            incident_min_order_count: toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    'opsAlertShopOrderDeliveryIncidentMinOrderCount',
                    currentShopOrderDelivery.incident_min_order_count
                ),
                currentShopOrderDelivery.incident_min_order_count
            ),
            incident_min_dead_letter_count: toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    'opsAlertShopOrderDeliveryIncidentMinDeadLetterCount',
                    currentShopOrderDelivery.incident_min_dead_letter_count
                ),
                currentShopOrderDelivery.incident_min_dead_letter_count
            ),
            incident_min_distinct_users: toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    'opsAlertShopOrderDeliveryIncidentMinDistinctUsers',
                    currentShopOrderDelivery.incident_min_distinct_users
                ),
                currentShopOrderDelivery.incident_min_distinct_users
            ),
            incident_dedupe_window_minutes: toWholeNumber(
                getAdminWorkbenchInputValue(
                    documentRef,
                    'opsAlertShopOrderDeliveryIncidentDedupeWindowMinutes',
                    currentShopOrderDelivery.incident_dedupe_window_minutes
                ),
                currentShopOrderDelivery.incident_dedupe_window_minutes
            ),
            work_hours_only_enabled: getAdminWorkbenchToggleState(
                documentRef,
                'opsAlertShopOrderDeliveryWorkHoursOnlyEnabledToggle',
                currentShopOrderDelivery.work_hours_only_enabled
            ),
            ...readSummaryDraft('opsAlertShopOrderDelivery', currentShopOrderDelivery)
        },
        verify_quota: {
            ...currentVerifyQuota,
            enabled: getAdminWorkbenchToggleState(documentRef, 'opsAlertVerifyQuotaEnabledToggle', currentVerifyQuota.enabled),
            low_balance_threshold: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyQuotaLowBalanceThreshold', currentVerifyQuota.low_balance_threshold),
                currentVerifyQuota.low_balance_threshold
            ),
            low_remaining_jobs_threshold: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyQuotaLowRemainingJobsThreshold', currentVerifyQuota.low_remaining_jobs_threshold),
                currentVerifyQuota.low_remaining_jobs_threshold
            ),
            critical_balance_threshold: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyQuotaCriticalBalanceThreshold', currentVerifyQuota.critical_balance_threshold),
                currentVerifyQuota.critical_balance_threshold
            ),
            critical_remaining_jobs_threshold: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyQuotaCriticalRemainingJobsThreshold', currentVerifyQuota.critical_remaining_jobs_threshold),
                currentVerifyQuota.critical_remaining_jobs_threshold
            ),
            min_queue_buffer_jobs: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyQuotaMinQueueBufferJobs', currentVerifyQuota.min_queue_buffer_jobs),
                currentVerifyQuota.min_queue_buffer_jobs
            ),
            sweep_interval_ms: readSweepIntervalMs('opsAlertVerifyQuotaSweepIntervalMinutes', currentVerifyQuota.sweep_interval_ms),
            dedupe_window_minutes: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyQuotaDedupeWindowMinutes', currentVerifyQuota.dedupe_window_minutes),
                currentVerifyQuota.dedupe_window_minutes
            ),
            work_hours_only_enabled: getAdminWorkbenchToggleState(
                documentRef,
                'opsAlertVerifyQuotaWorkHoursOnlyEnabledToggle',
                currentVerifyQuota.work_hours_only_enabled
            ),
            ...readSummaryDraft('opsAlertVerifyQuota', currentVerifyQuota)
        },
        verify_queue: {
            ...currentVerifyQueue,
            enabled: getAdminWorkbenchToggleState(documentRef, 'opsAlertVerifyQueueEnabledToggle', currentVerifyQueue.enabled),
            recent_activity_lookback_hours: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyQueueRecentActivityLookbackHours', currentVerifyQueue.recent_activity_lookback_hours),
                currentVerifyQueue.recent_activity_lookback_hours
            ),
            recent_failure_window_minutes: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyQueueRecentFailureWindowMinutes', currentVerifyQueue.recent_failure_window_minutes),
                currentVerifyQueue.recent_failure_window_minutes
            ),
            queue_size_threshold: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyQueueSizeThreshold', currentVerifyQueue.queue_size_threshold),
                currentVerifyQueue.queue_size_threshold
            ),
            active_job_threshold: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyQueueActiveJobThreshold', currentVerifyQueue.active_job_threshold),
                currentVerifyQueue.active_job_threshold
            ),
            oldest_pending_minutes_threshold: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyQueueOldestPendingMinutesThreshold', currentVerifyQueue.oldest_pending_minutes_threshold),
                currentVerifyQueue.oldest_pending_minutes_threshold
            ),
            recent_failure_threshold: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyQueueRecentFailureThreshold', currentVerifyQueue.recent_failure_threshold),
                currentVerifyQueue.recent_failure_threshold
            ),
            sweep_interval_ms: readSweepIntervalMs('opsAlertVerifyQueueSweepIntervalMinutes', currentVerifyQueue.sweep_interval_ms),
            dedupe_window_minutes: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyQueueDedupeWindowMinutes', currentVerifyQueue.dedupe_window_minutes),
                currentVerifyQueue.dedupe_window_minutes
            ),
            work_hours_only_enabled: getAdminWorkbenchToggleState(
                documentRef,
                'opsAlertVerifyQueueWorkHoursOnlyEnabledToggle',
                currentVerifyQueue.work_hours_only_enabled
            ),
            ...readSummaryDraft('opsAlertVerifyQueue', currentVerifyQueue)
        },
        verify_failure: {
            ...currentVerifyFailure,
            enabled: getAdminWorkbenchToggleState(documentRef, 'opsAlertVerifyFailureEnabledToggle', currentVerifyFailure.enabled),
            recent_window_minutes: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyFailureRecentWindowMinutes', currentVerifyFailure.recent_window_minutes),
                currentVerifyFailure.recent_window_minutes
            ),
            min_total_jobs_threshold: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyFailureMinTotalJobsThreshold', currentVerifyFailure.min_total_jobs_threshold),
                currentVerifyFailure.min_total_jobs_threshold
            ),
            failure_rate_threshold: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyFailureRateThreshold', currentVerifyFailure.failure_rate_threshold),
                currentVerifyFailure.failure_rate_threshold
            ),
            affected_user_threshold: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyFailureAffectedUserThreshold', currentVerifyFailure.affected_user_threshold),
                currentVerifyFailure.affected_user_threshold
            ),
            sweep_interval_ms: readSweepIntervalMs('opsAlertVerifyFailureSweepIntervalMinutes', currentVerifyFailure.sweep_interval_ms),
            dedupe_window_minutes: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertVerifyFailureDedupeWindowMinutes', currentVerifyFailure.dedupe_window_minutes),
                currentVerifyFailure.dedupe_window_minutes
            ),
            work_hours_only_enabled: getAdminWorkbenchToggleState(
                documentRef,
                'opsAlertVerifyFailureWorkHoursOnlyEnabledToggle',
                currentVerifyFailure.work_hours_only_enabled
            ),
            ...readSummaryDraft('opsAlertVerifyFailure', currentVerifyFailure)
        },
        payment_gateway: {
            ...currentPaymentGateway,
            enabled: getAdminWorkbenchToggleState(documentRef, 'opsAlertPaymentGatewayEnabledToggle', currentPaymentGateway.enabled),
            window_minutes: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertPaymentGatewayWindowMinutes', currentPaymentGateway.window_minutes),
                currentPaymentGateway.window_minutes
            ),
            min_failed_orders: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertPaymentGatewayFailedOrdersThreshold', currentPaymentGateway.min_failed_orders),
                currentPaymentGateway.min_failed_orders
            ),
            min_failed_ratio_percent: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertPaymentGatewayFailedRatioThreshold', currentPaymentGateway.min_failed_ratio_percent),
                currentPaymentGateway.min_failed_ratio_percent
            ),
            max_webhook_success_rate_percent: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertPaymentGatewayWebhookSuccessRateThreshold', currentPaymentGateway.max_webhook_success_rate_percent),
                currentPaymentGateway.max_webhook_success_rate_percent
            ),
            max_query_success_rate_percent: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertPaymentGatewayQuerySuccessRateThreshold', currentPaymentGateway.max_query_success_rate_percent),
                currentPaymentGateway.max_query_success_rate_percent
            ),
            min_webhook_5xx_count: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertPaymentGatewayWebhook5xxThreshold', currentPaymentGateway.min_webhook_5xx_count),
                currentPaymentGateway.min_webhook_5xx_count
            ),
            min_query_5xx_count: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertPaymentGatewayQuery5xxThreshold', currentPaymentGateway.min_query_5xx_count),
                currentPaymentGateway.min_query_5xx_count
            ),
            sweep_interval_ms: readSweepIntervalMs('opsAlertPaymentGatewaySweepIntervalMinutes', currentPaymentGateway.sweep_interval_ms),
            dedupe_window_minutes: toWholeNumber(
                getAdminWorkbenchInputValue(documentRef, 'opsAlertPaymentGatewayDedupeWindowMinutes', currentPaymentGateway.dedupe_window_minutes),
                currentPaymentGateway.dedupe_window_minutes
            ),
            work_hours_only_enabled: getAdminWorkbenchToggleState(
                documentRef,
                'opsAlertPaymentGatewayWorkHoursOnlyEnabledToggle',
                currentPaymentGateway.work_hours_only_enabled
            ),
            ...readSummaryDraft('opsAlertPaymentGateway', currentPaymentGateway)
        }
    };
}

function buildAdminWorkbenchOpsAlertStrategySummaryState(config = {}, options = {}) {
    const normalizeConfig = typeof options.normalizeConfig === 'function'
        ? options.normalizeConfig
        : ((value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}));
    const getDefaultConfig = typeof options.getDefaultConfig === 'function'
        ? options.getDefaultConfig
        : (() => ({}));
    const getTemporaryMuteState = typeof options.getTemporaryMuteState === 'function'
        ? options.getTemporaryMuteState
        : (() => ({ active: false, expired: false, untilLabel: '—', allowCritical: true }));
    const getMuteRuleState = typeof options.getMuteRuleState === 'function'
        ? options.getMuteRuleState
        : ((rule = {}) => ({
            active: rule?.active === true,
            expired: rule?.expired === true,
            untilLabel: String(rule?.untilLabel || '—').trim() || '—',
            allowCritical: rule?.allowCritical !== false
        }));
    const typeDefinitions = Array.isArray(options.typeDefinitions) ? options.typeDefinitions : [];
    const moduleDefinitions = Array.isArray(options.moduleDefinitions) ? options.moduleDefinitions : [];
    const routingDefinitions = Array.isArray(options.routingDefinitions) ? options.routingDefinitions : [];
    const summaryDefinitions = Array.isArray(options.summaryDefinitions) ? options.summaryDefinitions : [];
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Number(value || 0)));
    const formatHourRange = typeof options.formatHourRange === 'function'
        ? options.formatHourRange
        : ((startHour, endHour) => `${String(Number(startHour || 0)).padStart(2, '0')}:00 - ${String(Number(endHour || 0)).padStart(2, '0')}:00`);

    const normalizedConfig = normalizeConfig(config);
    const defaults = getDefaultConfig() || {};
    const quietHours = normalizedConfig.quiet_hours || defaults.quiet_hours || {};
    const workHours = normalizedConfig.work_hours || defaults.work_hours || {};
    const temporaryMuteState = getTemporaryMuteState(normalizedConfig);

    const typeStates = typeDefinitions.map((definition) => (
        getMuteRuleState(normalizedConfig.mute_rules?.types?.[definition.key] || {})
    ));
    const moduleStates = moduleDefinitions.map((definition) => (
        getMuteRuleState(normalizedConfig.mute_rules?.modules?.[definition.key] || {})
    ));
    const activeTypeCount = typeStates.filter((state) => state.active).length;
    const activeModuleCount = moduleStates.filter((state) => state.active).length;
    const expiredTypeCount = typeStates.filter((state) => state.expired).length;
    const expiredModuleCount = moduleStates.filter((state) => state.expired).length;
    const totalActiveMuteCount = activeTypeCount + activeModuleCount + (temporaryMuteState.active ? 1 : 0) + (quietHours.enabled ? 1 : 0);
    const totalExpiredMuteCount = expiredTypeCount + expiredModuleCount + (temporaryMuteState.expired ? 1 : 0);

    let routingCustomizedCount = 0;
    const routingChannelCounts = {
        telegram: 0,
        feishu: 0,
        email: 0
    };
    routingDefinitions.forEach((definition) => {
        const route = normalizedConfig.routing?.[definition.key] || defaults.routing?.[definition.key] || {};
        const telegramEnabled = route.telegram !== false;
        const feishuEnabled = route.feishu !== false;
        const emailEnabled = route.email !== false;
        if (telegramEnabled) routingChannelCounts.telegram += 1;
        if (feishuEnabled) routingChannelCounts.feishu += 1;
        if (emailEnabled) routingChannelCounts.email += 1;
        if (!(telegramEnabled && feishuEnabled && emailEnabled)) {
            routingCustomizedCount += 1;
        }
    });

    const workHoursOnlyCount = summaryDefinitions.filter((definition) => (
        definition.supports_work_hours_only && normalizedConfig[definition.key]?.work_hours_only_enabled === true
    )).length;
    const totalRoutingCount = routingDefinitions.length;

    const muteBadgeLabel = temporaryMuteState.active
        ? '临时静默中'
        : totalActiveMuteCount > 0
            ? `生效 ${formatCount(totalActiveMuteCount)} 项`
            : quietHours.enabled
                ? '夜间静默开启'
                : '按需启用';
    const muteBadgeTone = totalActiveMuteCount > 0 || quietHours.enabled ? 'warning' : 'neutral';
    const muteSummaryTipText = temporaryMuteState.active
        ? `当前外发已静默到 ${temporaryMuteState.untilLabel}，适合维护窗口快速止噪。`
        : totalActiveMuteCount > 0
            ? `当前有 ${formatCount(totalActiveMuteCount)} 项静默策略生效，建议只保留真正需要降噪的规则。`
            : totalExpiredMuteCount > 0
                ? `检测到 ${formatCount(totalExpiredMuteCount)} 条过期静默记录，建议清理旧时间，减少误判。`
                : '维护窗口、夜间降噪和单类静默会汇总在这里。';
    const mutePanelTipText = totalActiveMuteCount > 0
        ? `当前有 ${formatCount(totalActiveMuteCount)} 项静默策略生效，优先处理仍在生效的规则。`
        : '集中管理临时静默、夜间静默和分组降噪。';

    const routingBadgeLabel = routingCustomizedCount > 0
        ? `已定制 ${formatCount(routingCustomizedCount)} 类`
        : '全通道默认';
    const routingBadgeTone = routingCustomizedCount > 0 ? 'success' : 'neutral';
    const routingSummaryTipText = routingCustomizedCount > 0
        ? `已有 ${formatCount(routingCustomizedCount)} 类事件被改成非默认路由，矩阵更适合快速复核。`
        : `当前 ${formatCount(totalRoutingCount)} 类事件都保留 Telegram、飞书、邮件三通道默认投递。`;
    const routingPanelTipText = routingCustomizedCount > 0
        ? `已对 ${formatCount(routingCustomizedCount)} 类事件做了分流，建议重点检查核心告警是否还保留至少一条主通道。`
        : '把路由改成矩阵后，可以更快看清哪类告警发到哪个通道。';

    const workHoursBadgeTone = workHours.enabled ? 'success' : (workHoursOnlyCount > 0 ? 'warning' : 'neutral');
    const workHoursBadgeLabel = workHours.enabled
        ? '已启用'
        : workHoursOnlyCount > 0
            ? '待启用'
            : '未启用';
    const workHoursSummaryTipText = workHoursOnlyCount > 0
        ? `当前有 ${formatCount(workHoursOnlyCount)} 类告警启用了“仅工作时间通知”。`
        : '只影响开启“仅工作时间通知”的低优先级告警。';
    const workHoursPanelTipText = workHours.enabled
        ? `当前工作时段为 ${formatHourRange(workHours.start_hour, workHours.end_hour)}，会影响 ${formatCount(workHoursOnlyCount)} 类告警。`
        : '这组时间只影响开启“仅工作时间通知”的低优先级告警。';

    return {
        mute: {
            badgeLabel: muteBadgeLabel,
            badgeTone: muteBadgeTone,
            summaryTipText: muteSummaryTipText,
            panelTipText: mutePanelTipText,
            temporaryLabel: temporaryMuteState.active
                ? `至 ${temporaryMuteState.untilLabel}`
                : temporaryMuteState.expired
                    ? '已过期'
                    : '未设置',
            quietHoursLabel: quietHours.enabled
                ? formatHourRange(quietHours.start_hour, quietHours.end_hour)
                : '已关闭',
            rulesLabel: `${formatCount(activeTypeCount)} / ${formatCount(activeModuleCount)} 生效`,
            typeMetaLabel: `共 ${formatCount(typeDefinitions.length)} 类，${formatCount(activeTypeCount)} 类生效`,
            moduleMetaLabel: `共 ${formatCount(moduleDefinitions.length)} 类，${formatCount(activeModuleCount)} 类生效`,
            typeTabLabel: `${formatCount(activeTypeCount)} 生效`,
            moduleTabLabel: `${formatCount(activeModuleCount)} 生效`
        },
        routing: {
            badgeLabel: routingBadgeLabel,
            badgeTone: routingBadgeTone,
            summaryTipText: routingSummaryTipText,
            panelTipText: routingPanelTipText,
            matrixMetaLabel: `共 ${formatCount(totalRoutingCount)} 类事件，已定制 ${formatCount(routingCustomizedCount)} 类`,
            telegramLabel: `${formatCount(routingChannelCounts.telegram)} / ${formatCount(totalRoutingCount)}`,
            feishuLabel: `${formatCount(routingChannelCounts.feishu)} / ${formatCount(totalRoutingCount)}`,
            emailLabel: `${formatCount(routingChannelCounts.email)} / ${formatCount(totalRoutingCount)}`
        },
        work_hours: {
            badgeLabel: workHoursBadgeLabel,
            badgeTone: workHoursBadgeTone,
            summaryTipText: workHoursSummaryTipText,
            panelTipText: workHoursPanelTipText,
            rangeLabel: formatHourRange(workHours.start_hour, workHours.end_hour),
            timezoneLabel: workHours.timezone || defaults.work_hours?.timezone || '',
            rulesLabel: `${formatCount(workHoursOnlyCount)} 类`
        }
    };
}

function buildAdminWorkbenchOpsAlertOverviewStatus(config = {}, secretStatus = {}, options = {}) {
    const normalizeConfig = typeof options.normalizeConfig === 'function'
        ? options.normalizeConfig
        : ((value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}));
    const getDefaultSecretStatus = typeof options.getDefaultSecretStatus === 'function'
        ? options.getDefaultSecretStatus
        : (() => ({
            telegram_bot_token: { configured: false, source: 'missing', updatedAt: null },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null },
            email_api_key: { configured: false, source: 'missing', updatedAt: null }
        }));
    const getTemporaryMuteState = typeof options.getTemporaryMuteState === 'function'
        ? options.getTemporaryMuteState
        : (() => ({ active: false, expired: false, untilLabel: '—', allowCritical: true }));
    const normalizedConfig = normalizeConfig(config);
    const defaultSecretStatus = getDefaultSecretStatus() || {};
    const normalizedSecretStatus = secretStatus && typeof secretStatus === 'object' && !Array.isArray(secretStatus)
        ? secretStatus
        : {};
    const telegramSecret = normalizedSecretStatus.telegram_bot_token || defaultSecretStatus.telegram_bot_token || { configured: false };
    const feishuSecret = normalizedSecretStatus.feishu_webhook_url || defaultSecretStatus.feishu_webhook_url || { configured: false };
    const emailSecret = normalizedSecretStatus.email_api_key || defaultSecretStatus.email_api_key || { configured: false };
    const telegramChatCount = Array.isArray(normalizedConfig.channels?.telegram?.chat_ids)
        ? normalizedConfig.channels.telegram.chat_ids.length
        : 0;
    const emailRecipients = Array.isArray(normalizedConfig.channels?.email?.recipients)
        ? normalizedConfig.channels.email.recipients
        : [];
    const emailRecipientCount = emailRecipients.length;
    const channelStates = [];
    const deliveryIssues = [];
    const targetSummaries = [];
    const channelOverviewItems = [];
    const targetOverviewItems = [];
    const targetDetailRows = [];
    let enabledChannelCount = 0;
    let readyChannelCount = 0;
    let configuredTargetChannelCount = 0;

    const telegramEnabled = normalizedConfig.channels?.telegram?.enabled === true;
    const feishuEnabled = normalizedConfig.channels?.feishu?.enabled === true;
    const emailEnabled = normalizedConfig.channels?.email?.enabled === true;
    const telegramMinimumSeverity = String(normalizedConfig.channels?.telegram?.minimum_severity || 'warning').trim().toLowerCase() || 'warning';
    const feishuMinimumSeverity = String(normalizedConfig.channels?.feishu?.minimum_severity || 'warning').trim().toLowerCase() || 'warning';
    const emailMinimumSeverity = String(normalizedConfig.channels?.email?.minimum_severity || 'warning').trim().toLowerCase() || 'warning';
    const telegramReady = telegramSecret.configured === true && telegramChatCount > 0;
    const feishuReady = feishuSecret.configured === true;
    const emailHasFromAddress = Boolean(String(normalizedConfig.channels?.email?.from_address || '').trim());
    const emailReady = emailSecret.configured === true && emailRecipientCount > 0 && emailHasFromAddress;

    const enabledSeveritySummary = [
        telegramEnabled ? `Telegram ${telegramMinimumSeverity}` : '',
        feishuEnabled ? `飞书 ${feishuMinimumSeverity}` : '',
        emailEnabled ? `邮件 ${emailMinimumSeverity}` : ''
    ].filter(Boolean).join('；');

    if (telegramEnabled) {
        enabledChannelCount += 1;
        const telegramSummary = `Telegram · ${telegramMinimumSeverity}+ · ${telegramChatCount || 0} 个 chat`;
        if (telegramReady) {
            readyChannelCount += 1;
            channelStates.push(`${telegramSummary} · 已就绪`);
        } else {
            channelStates.push(`${telegramSummary} · 待补充配置`);
            if (telegramSecret.configured !== true) deliveryIssues.push('Telegram Bot Token 未配置');
            if (!telegramChatCount) deliveryIssues.push('Telegram Chat ID 未填写');
        }
    }
    if (telegramChatCount > 0) {
        configuredTargetChannelCount += 1;
        targetSummaries.push(`Telegram：${telegramChatCount} 个 chat`);
    }
    channelOverviewItems.push({
        key: 'telegram',
        label: 'Telegram',
        value: telegramChatCount > 0 ? `${telegramChatCount} 个 chat` : (telegramSecret.configured === true ? '等待填写 chat' : '未配置目标'),
        meta: [
            telegramEnabled
                ? (telegramReady ? '可直接投递' : '启用中，仍需补齐配置')
                : ((telegramChatCount > 0 || telegramSecret.configured === true) ? '当前为预设' : '尚未打开'),
            telegramSecret.configured === true ? 'Bot Token 已配置' : 'Bot Token 未配置'
        ].join(' · '),
        tone: telegramEnabled ? (telegramReady ? 'success' : 'warning') : 'neutral',
        severityLabel: `${telegramMinimumSeverity}+`,
        statusLabel: telegramEnabled ? (telegramReady ? '已就绪' : '待补充') : '未打开',
        statusTone: telegramEnabled ? (telegramReady ? 'success' : 'warning') : 'neutral'
    });
    targetOverviewItems.push({
        key: 'telegram',
        label: 'Telegram',
        value: telegramChatCount > 0 ? `${telegramChatCount} 个 chat` : '未填写 chat',
        meta: telegramEnabled ? '打开后会投递到配置的 chat' : '当前为预设目标',
        tone: telegramChatCount > 0 ? 'success' : (telegramEnabled ? 'warning' : 'neutral'),
        statusLabel: telegramChatCount > 0 ? '已配置' : (telegramEnabled ? '待配置' : '未配置'),
        statusTone: telegramChatCount > 0 ? 'success' : (telegramEnabled ? 'warning' : 'neutral')
    });

    if (feishuEnabled) {
        enabledChannelCount += 1;
        const feishuSummary = `飞书 · ${feishuMinimumSeverity}+`;
        if (feishuReady) {
            readyChannelCount += 1;
            channelStates.push(`${feishuSummary} · 已就绪`);
        } else {
            channelStates.push(`${feishuSummary} · 待补充配置`);
            deliveryIssues.push('飞书 Webhook 未配置');
        }
    }
    if (feishuSecret.configured === true) {
        configuredTargetChannelCount += 1;
        targetSummaries.push('飞书：Webhook 已配置');
    }
    channelOverviewItems.push({
        key: 'feishu',
        label: '飞书',
        value: feishuSecret.configured === true ? 'Webhook 已配置' : '未配置 Webhook',
        meta: feishuEnabled
            ? (feishuReady ? '可直接投递' : '启用中，仍需补齐 Webhook')
            : (feishuSecret.configured === true ? '当前为预设' : '尚未打开'),
        tone: feishuEnabled ? (feishuReady ? 'success' : 'warning') : 'neutral',
        severityLabel: `${feishuMinimumSeverity}+`,
        statusLabel: feishuEnabled ? (feishuReady ? '已就绪' : '待补充') : '未打开',
        statusTone: feishuEnabled ? (feishuReady ? 'success' : 'warning') : 'neutral'
    });
    targetOverviewItems.push({
        key: 'feishu',
        label: '飞书',
        value: feishuSecret.configured === true ? 'Webhook 已配置' : '未配置 Webhook',
        meta: feishuEnabled ? '打开后会发往群机器人' : '当前为预设目标',
        tone: feishuSecret.configured === true ? 'success' : (feishuEnabled ? 'warning' : 'neutral'),
        statusLabel: feishuSecret.configured === true ? '已配置' : (feishuEnabled ? '待配置' : '未配置'),
        statusTone: feishuSecret.configured === true ? 'success' : (feishuEnabled ? 'warning' : 'neutral')
    });

    if (emailEnabled) {
        enabledChannelCount += 1;
        const emailSummary = `邮件 · ${emailMinimumSeverity}+ · ${emailRecipientCount || 0} 个收件人`;
        if (emailReady) {
            readyChannelCount += 1;
            channelStates.push(`${emailSummary} · 已就绪`);
        } else {
            channelStates.push(`${emailSummary} · 待补充配置`);
            if (emailSecret.configured !== true) deliveryIssues.push('Email API Key 未配置');
            if (!emailRecipientCount) deliveryIssues.push('邮件收件人未填写');
            if (!emailHasFromAddress) deliveryIssues.push('邮件发件地址未填写');
        }
    }
    if (emailRecipientCount > 0) {
        configuredTargetChannelCount += 1;
        const recipientPreview = emailRecipients.slice(0, 2).join('、');
        const recipientSuffix = emailRecipientCount > 2 ? ' 等' : '';
        targetSummaries.push(`邮件：${emailRecipientCount} 个收件人（${recipientPreview}${recipientSuffix}）`);
    }
    if (normalizedConfig.channels?.email?.from_address) {
        targetSummaries.push(`发件地址：${normalizedConfig.channels.email.from_address}`);
    }
    if (normalizedConfig.channels?.email?.reply_to) {
        targetSummaries.push(`Reply-To：${normalizedConfig.channels.email.reply_to}`);
    }
    channelOverviewItems.push({
        key: 'email',
        label: '邮件',
        value: emailRecipientCount > 0 ? `${emailRecipientCount} 个收件人` : '未填写收件人',
        meta: [
            emailEnabled
                ? (emailReady ? '可直接投递' : '启用中，仍需补齐发件配置')
                : ((emailRecipientCount > 0 || emailHasFromAddress) ? '当前为预设' : '尚未打开'),
            emailHasFromAddress ? '发件地址已配置' : '缺少发件地址'
        ].join(' · '),
        tone: emailEnabled ? (emailReady ? 'success' : 'warning') : 'neutral',
        severityLabel: `${emailMinimumSeverity}+`,
        statusLabel: emailEnabled ? (emailReady ? '已就绪' : '待补充') : '未打开',
        statusTone: emailEnabled ? (emailReady ? 'success' : 'warning') : 'neutral'
    });
    targetOverviewItems.push({
        key: 'email',
        label: '邮件',
        value: emailRecipientCount > 0 ? `${emailRecipientCount} 个收件人` : '未填写收件人',
        meta: emailEnabled ? '打开后会发往已配置邮箱' : '当前为预设目标',
        tone: (emailRecipientCount > 0 && emailHasFromAddress) ? 'success' : (emailEnabled ? 'warning' : 'neutral'),
        statusLabel: (emailRecipientCount > 0 && emailHasFromAddress) ? '已配置' : (emailEnabled ? '待配置' : '未配置'),
        statusTone: (emailRecipientCount > 0 && emailHasFromAddress) ? 'success' : (emailEnabled ? 'warning' : 'neutral')
    });
    if (normalizedConfig.channels?.email?.from_address) {
        targetDetailRows.push({
            label: '发件地址',
            value: normalizedConfig.channels.email.from_address,
            tone: 'neutral'
        });
    }
    if (normalizedConfig.channels?.email?.reply_to) {
        targetDetailRows.push({
            label: 'Reply-To',
            value: normalizedConfig.channels.email.reply_to,
            tone: 'neutral'
        });
    }
    if (normalizedConfig.channels?.email?.subject_prefix) {
        targetDetailRows.push({
            label: '主题前缀',
            value: normalizedConfig.channels.email.subject_prefix,
            tone: 'neutral'
        });
    }

    return {
        normalizedConfig,
        telegramSecret,
        feishuSecret,
        emailSecret,
        telegramChatCount,
        emailRecipientCount,
        channelStates,
        deliveryIssues,
        targetSummaries,
        channelOverviewItems,
        targetOverviewItems,
        targetDetailRows,
        enabledChannelCount,
        readyChannelCount,
        configuredTargetChannelCount,
        temporaryMuteState: getTemporaryMuteState(normalizedConfig),
        enabledSeveritySummary
    };
}

function buildAdminWorkbenchOpsAlertOverviewBannerState(overviewStatus = {}, healthState = {}, options = {}) {
    const normalizedOverviewStatus = overviewStatus && typeof overviewStatus === 'object' && !Array.isArray(overviewStatus)
        ? overviewStatus
        : {};
    const normalizedConfig = normalizedOverviewStatus.normalizedConfig && typeof normalizedOverviewStatus.normalizedConfig === 'object'
        ? normalizedOverviewStatus.normalizedConfig
        : {};
    const deliveryIssues = Array.isArray(normalizedOverviewStatus.deliveryIssues)
        ? normalizedOverviewStatus.deliveryIssues.filter(Boolean)
        : [];
    const enabledChannelCount = Math.max(0, Number(normalizedOverviewStatus.enabledChannelCount || 0));
    const readyChannelCount = Math.max(0, Number(normalizedOverviewStatus.readyChannelCount || 0));
    const configuredTargetChannelCount = Math.max(0, Number(normalizedOverviewStatus.configuredTargetChannelCount || 0));
    const defaultHealthState = options.defaultHealthState && typeof options.defaultHealthState === 'object' && !Array.isArray(options.defaultHealthState)
        ? options.defaultHealthState
        : getAdminWorkbenchDefaultOpsAlertHealthState();
    const normalizedHealthState = healthState && typeof healthState === 'object' && !Array.isArray(healthState)
        ? healthState
        : {};
    const summary = normalizedHealthState.summary && typeof normalizedHealthState.summary === 'object' && !Array.isArray(normalizedHealthState.summary)
        ? normalizedHealthState.summary
        : (defaultHealthState.summary || {});
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Math.max(0, Number(value || 0))));
    const getTemporaryMuteState = typeof options.getTemporaryMuteState === 'function'
        ? options.getTemporaryMuteState
        : (() => ({ active: false, expired: false, untilLabel: '—', allowCritical: true }));
    const getEnabledSeveritySummary = typeof options.getEnabledSeveritySummary === 'function'
        ? options.getEnabledSeveritySummary
        : (() => '');
    const temporaryMuteState = normalizedOverviewStatus.temporaryMuteState && typeof normalizedOverviewStatus.temporaryMuteState === 'object'
        ? normalizedOverviewStatus.temporaryMuteState
        : getTemporaryMuteState(normalizedConfig);
    const enabledSeveritySummary = normalizedOverviewStatus.enabledSeveritySummary || getEnabledSeveritySummary(normalizedConfig);
    const failedCount = Math.max(0, Number(summary.failed_count || 0));
    const deadLetterCount = Math.max(0, Number(summary.dead_letter_count || 0));
    const totalAttemptCount = Math.max(0, Number(summary.total_attempt_count || 0));
    const lookbackHours = formatCount(summary.lookback_hours || 72);
    const healthStatus = String(normalizedHealthState.status || defaultHealthState.status || 'idle').trim().toLowerCase() || 'idle';
    let tone = 'neutral';
    let icon = 'fa-bell-slash';
    let headline = '站外告警未启用';
    const detailParts = [];

    if (!normalizedConfig.enabled) {
        headline = enabledChannelCount > 0
            ? '站外告警尚未启用，当前通道仅保存为预设'
            : '站外告警未启用';
        detailParts.push(
            enabledChannelCount > 0
                ? '保存并启用后才会真正开始站外投递。'
                : '退款和异常消息仍会保留在站内后台。'
        );
    } else if (enabledChannelCount === 0) {
        tone = 'warning';
        icon = 'fa-triangle-exclamation';
        headline = '站外告警已启用，但还没有打开外部通道';
        detailParts.push('请至少打开一个外部通道，才会开始异步投递。');
    } else if (deadLetterCount > 0) {
        tone = 'danger';
        icon = 'fa-circle-exclamation';
        headline = '站外告警存在死信，建议优先处理异常通道';
    } else if (failedCount > 0 || deliveryIssues.length > 0 || readyChannelCount < enabledChannelCount) {
        tone = 'warning';
        icon = 'fa-triangle-exclamation';
        headline = '站外告警已启用，但部分通道仍需要关注';
    } else {
        tone = 'success';
        icon = 'fa-satellite-dish';
        headline = '站外告警已启用，当前通道可正常投递';
    }

    if (normalizedConfig.enabled) {
        detailParts.push('发送采用异步队列，不阻塞退款主流程。');
    }
    if (deliveryIssues.length) {
        detailParts.push(`待补充：${deliveryIssues.join('、')}。`);
    }
    if (enabledSeveritySummary) {
        detailParts.push(`当前级别：${enabledSeveritySummary}。`);
    }
    if (temporaryMuteState.active) {
        detailParts.push(
            `临时静默至 ${temporaryMuteState.untilLabel}，${temporaryMuteState.allowCritical ? 'critical 仍继续通知。' : '所有级别暂停外发。'}`
        );
    }

    const badgeItems = [
        {
            label: normalizedConfig.enabled ? '已启用' : '未启用',
            tone: normalizedConfig.enabled ? (tone === 'neutral' ? 'success' : tone) : 'neutral'
        },
        {
            label: enabledChannelCount > 0 ? `${readyChannelCount} / ${enabledChannelCount} 通道就绪` : '0 / 0 通道就绪',
            tone: enabledChannelCount > 0
                ? (readyChannelCount === enabledChannelCount ? 'success' : 'warning')
                : 'neutral'
        },
        {
            label: `已配置 ${configuredTargetChannelCount} / 3`,
            tone: configuredTargetChannelCount > 0 ? 'success' : 'neutral'
        }
    ];

    if (healthStatus === 'loading') {
        badgeItems.push({ label: '健康页刷新中', tone: 'neutral' });
    } else if (healthStatus === 'error') {
        badgeItems.push({ label: '健康查询失败', tone: 'danger' });
    } else if (normalizedConfig.enabled && totalAttemptCount > 0) {
        badgeItems.push({
            label: `近 ${lookbackHours}h 失败 ${formatCount(failedCount)}`,
            tone: deadLetterCount > 0 ? 'danger' : (failedCount > 0 ? 'warning' : 'success')
        });
        if (deadLetterCount > 0) {
            badgeItems.push({
                label: `死信 ${formatCount(deadLetterCount)}`,
                tone: 'danger'
            });
        }
    }

    const canSendTest = normalizedConfig.enabled === true && enabledChannelCount > 0 && deliveryIssues.length === 0;
    const testButtonTitle = canSendTest
        ? '向已启用的站外通道发送测试告警'
        : (!normalizedConfig.enabled
            ? '请先启用站外告警'
            : (enabledChannelCount === 0 ? '请先打开至少一个通道' : '请先补齐通道配置'));

    return {
        tone,
        icon,
        headline,
        detailParts,
        detailText: detailParts.join(' '),
        badgeItems,
        canSendTest,
        testButtonTitle,
        fetchedAt: normalizedHealthState.fetched_at || defaultHealthState.fetched_at || ''
    };
}

function getAdminWorkbenchOpsAlertRecentDeliverySummary(items = [], options = {}) {
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 2;
    const includeChannel = options.includeChannel === true;
    const normalizedItems = Array.isArray(items) ? items : [];

    return normalizedItems
        .slice(0, limit)
        .map((item) => {
            const title = String(item?.title || item?.alert_type || '系统告警').trim();
            const target = String(item?.target_summary || '').trim();
            const channel = includeChannel ? String(item?.channel || '').trim() : '';
            const parts = [title];
            if (target) {
                parts.push(`(${target})`);
            }
            if (channel) {
                parts.push(`· ${channel}`);
            }
            return parts.join(' ');
        })
        .filter(Boolean)
        .join('；');
}

function getAdminWorkbenchOpsAlertRecentErrorSummary(items = [], limit = 2, options = {}) {
    const normalizedItems = Array.isArray(items) ? items : [];
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Math.max(0, Number(value || 0))));

    return normalizedItems
        .slice(0, Math.max(1, Number(limit) || 2))
        .map((item) => {
            const message = String(item?.message || '未知错误').trim();
            const channelLabel = String(item?.channel_label || item?.channel || '').trim();
            const count = Number(item?.count || 0);
            const parts = [message];
            if (channelLabel) {
                parts.push(`(${channelLabel})`);
            }
            if (count > 0) {
                parts.push(`· ${formatCount(count)} 次`);
            }
            return parts.join(' ');
        })
        .filter(Boolean)
        .join('；');
}

function getAdminWorkbenchOpsAlertErrorSourceSummary(items = [], limit = 3, options = {}) {
    const normalizedItems = Array.isArray(items) ? items : [];
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Math.max(0, Number(value || 0))));

    return normalizedItems
        .slice(0, Math.max(1, Number(limit) || 3))
        .map((item) => {
            const channelLabel = String(item?.channel_label || item?.channel || '未知通道').trim();
            const count = Number(item?.count || 0);
            return count > 0 ? `${channelLabel} ${formatCount(count)} 次` : channelLabel;
        })
        .filter(Boolean)
        .join('；');
}

function buildAdminWorkbenchOpsAlertOverviewCardStates(overviewStatus = {}, healthState = {}, options = {}) {
    const normalizedOverviewStatus = overviewStatus && typeof overviewStatus === 'object' && !Array.isArray(overviewStatus)
        ? overviewStatus
        : {};
    const normalizedConfig = normalizedOverviewStatus.normalizedConfig && typeof normalizedOverviewStatus.normalizedConfig === 'object'
        ? normalizedOverviewStatus.normalizedConfig
        : {};
    const deliveryIssues = Array.isArray(normalizedOverviewStatus.deliveryIssues)
        ? normalizedOverviewStatus.deliveryIssues.filter(Boolean)
        : [];
    const channelOverviewItems = Array.isArray(normalizedOverviewStatus.channelOverviewItems)
        ? normalizedOverviewStatus.channelOverviewItems.filter(Boolean)
        : [];
    const targetOverviewItems = Array.isArray(normalizedOverviewStatus.targetOverviewItems)
        ? normalizedOverviewStatus.targetOverviewItems.filter(Boolean)
        : [];
    const targetDetailRows = Array.isArray(normalizedOverviewStatus.targetDetailRows)
        ? normalizedOverviewStatus.targetDetailRows.filter(Boolean)
        : [];
    const enabledChannelCount = Math.max(0, Number(normalizedOverviewStatus.enabledChannelCount || 0));
    const readyChannelCount = Math.max(0, Number(normalizedOverviewStatus.readyChannelCount || 0));
    const configuredTargetChannelCount = Math.max(0, Number(normalizedOverviewStatus.configuredTargetChannelCount || 0));
    const defaultHealthState = options.defaultHealthState && typeof options.defaultHealthState === 'object' && !Array.isArray(options.defaultHealthState)
        ? options.defaultHealthState
        : getAdminWorkbenchDefaultOpsAlertHealthState();
    const normalizedHealthState = healthState && typeof healthState === 'object' && !Array.isArray(healthState)
        ? healthState
        : {};
    const summary = normalizedHealthState.summary && typeof normalizedHealthState.summary === 'object' && !Array.isArray(normalizedHealthState.summary)
        ? normalizedHealthState.summary
        : (defaultHealthState.summary || {});
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Math.max(0, Number(value || 0))));
    const formatDateTime = typeof options.formatDateTime === 'function'
        ? options.formatDateTime
        : ((value) => String(value || '—'));
    const recentDeliverySummary = getAdminWorkbenchOpsAlertRecentDeliverySummary(summary.recent_deliveries, {
        limit: 3,
        includeChannel: true
    });
    const recentErrorSummary = getAdminWorkbenchOpsAlertRecentErrorSummary(summary.recent_errors, 2, {
        formatCount
    });
    const recentErrorChannelSummary = getAdminWorkbenchOpsAlertErrorSourceSummary(summary.recent_error_channels, 3, {
        formatCount
    });
    const totalAttemptCount = Math.max(0, Number(summary.total_attempt_count || 0));
    const deliveredCount = Math.max(0, Number(summary.delivered_count || 0));
    const failedCount = Math.max(0, Number(summary.failed_count || 0));
    const deadLetterCount = Math.max(0, Number(summary.dead_letter_count || 0));
    const lookbackHours = formatCount(summary.lookback_hours || 0);
    const deliveryRateText = totalAttemptCount > 0
        ? `${Math.round((deliveredCount / totalAttemptCount) * 100)}%`
        : '—';
    const healthStatus = String(normalizedHealthState.status || defaultHealthState.status || 'idle').trim().toLowerCase() || 'idle';

    let channelsTone = 'neutral';
    let channelsTitle = '未启用';
    if (normalizedConfig.enabled === true && enabledChannelCount === 0) {
        channelsTone = 'warning';
        channelsTitle = '0 / 3 已打开';
    } else if (enabledChannelCount > 0 && deliveryIssues.length > 0) {
        channelsTone = normalizedConfig.enabled === true ? 'warning' : 'neutral';
        channelsTitle = `${readyChannelCount} / ${enabledChannelCount} 已就绪`;
    } else if (enabledChannelCount > 0) {
        channelsTone = normalizedConfig.enabled === true ? 'success' : 'neutral';
        channelsTitle = `${readyChannelCount} / ${enabledChannelCount} 已就绪`;
    }

    let targetsTone = 'neutral';
    let targetsTitle = '等待配置';
    if (targetOverviewItems.length > 0) {
        if (configuredTargetChannelCount > 0) {
            targetsTone = deliveryIssues.length > 0 ? 'warning' : 'success';
        } else if (normalizedConfig.enabled === true) {
            targetsTone = 'warning';
        }
        targetsTitle = `已配置 ${configuredTargetChannelCount || 0} / 3`;
    }

    let recentTone = 'neutral';
    let recentTitle = '等待刷新';
    const recentMetrics = [];
    const recentDetailRows = [];
    let recentEmptyMessage = '告警通道健康页加载后，会在这里显示最近投递摘要。';

    if (healthStatus === 'loading') {
        recentTitle = '正在刷新';
        recentEmptyMessage = normalizedHealthState.message || '正在加载站外告警通道健康状态...';
    } else if (healthStatus === 'error') {
        recentTone = 'danger';
        recentTitle = '查询失败';
        recentEmptyMessage = normalizedHealthState.message || '加载站外告警通道健康状态失败。';
    } else if (healthStatus === 'ready') {
        if (totalAttemptCount > 0) {
            if (deadLetterCount > 0) {
                recentTone = 'danger';
            } else if (failedCount > 0) {
                recentTone = 'warning';
            } else {
                recentTone = 'success';
            }
            recentTitle = `近 ${lookbackHours} 小时`;
            recentMetrics.push(
                { label: '总投递', value: formatCount(totalAttemptCount) },
                { label: '送达率', value: deliveryRateText },
                { label: '刷新于', value: normalizedHealthState.fetched_at ? formatDateTime(normalizedHealthState.fetched_at) : '—' }
            );
            recentDetailRows.push(
                recentDeliverySummary
                    ? { label: '最近投递', value: recentDeliverySummary, tone: 'neutral' }
                    : null,
                recentErrorSummary
                    ? {
                        label: '最近失败',
                        value: recentErrorSummary,
                        tone: deadLetterCount > 0 ? 'danger' : 'warning'
                    }
                    : { label: '最近失败', value: '最近没有失败明细', tone: 'success' },
                recentErrorChannelSummary
                    ? {
                        label: '异常来源',
                        value: recentErrorChannelSummary,
                        tone: deadLetterCount > 0 ? 'danger' : 'warning'
                    }
                    : {
                        label: '异常来源',
                        value: '当前没有集中失败来源',
                        tone: failedCount > 0 ? 'warning' : 'success'
                    }
            );
            recentEmptyMessage = '';
        } else if (Array.isArray(normalizedHealthState.channels) && normalizedHealthState.channels.length > 0) {
            recentTitle = `近 ${lookbackHours} 小时`;
            recentMetrics.push(
                { label: '总投递', value: '0' },
                { label: '送达率', value: '—' },
                { label: '刷新于', value: normalizedHealthState.fetched_at ? formatDateTime(normalizedHealthState.fetched_at) : '—' }
            );
            recentEmptyMessage = '最近没有新的站外投递记录，但通道健康信息已经刷新。';
        } else {
            recentTitle = '暂无投递';
            recentEmptyMessage = '最近没有可用于评估的站外告警通道数据。';
        }
    }

    return {
        channelsCard: {
            tone: channelsTone,
            title: channelsTitle,
            compact: !(enabledChannelCount > 0),
            items: channelOverviewItems
        },
        targetsCard: {
            tone: targetsTone,
            title: targetsTitle,
            compact: true,
            items: targetOverviewItems,
            detailRows: targetOverviewItems.length > 0 && targetDetailRows.length > 0
                ? targetDetailRows
                : [],
            detailRowsCompact: true,
            includeTargetDetails: targetOverviewItems.length > 0 && targetDetailRows.length > 0
        },
        recentCard: {
            tone: recentTone,
            title: recentTitle,
            metrics: recentMetrics.filter(Boolean),
            detailRows: recentDetailRows.filter(Boolean),
            emptyMessage: recentEmptyMessage
        }
    };
}

function buildAdminWorkbenchOpsAlertOverviewRenderState(overviewStatus = {}, healthState = {}, options = {}) {
    const defaultHealthState = options.defaultHealthState && typeof options.defaultHealthState === 'object' && !Array.isArray(options.defaultHealthState)
        ? options.defaultHealthState
        : getAdminWorkbenchDefaultOpsAlertHealthState();
    const normalizedHealthState = healthState && typeof healthState === 'object' && !Array.isArray(healthState)
        ? healthState
        : {};
    const summary = normalizedHealthState.summary && typeof normalizedHealthState.summary === 'object' && !Array.isArray(normalizedHealthState.summary)
        ? normalizedHealthState.summary
        : (defaultHealthState.summary || {});
    const healthStatus = String(normalizedHealthState.status || defaultHealthState.status || 'idle').trim().toLowerCase() || 'idle';

    return {
        bannerState: buildAdminWorkbenchOpsAlertOverviewBannerState(overviewStatus, normalizedHealthState, options),
        cardStates: buildAdminWorkbenchOpsAlertOverviewCardStates(overviewStatus, normalizedHealthState, options),
        recentVisualState: buildAdminWorkbenchOpsAlertOverviewRecentVisualState(summary, healthStatus, options)
    };
}

function buildAdminWorkbenchOpsAlertRiskSpotlightState(category = null, filters = {}, options = {}) {
    const spotlightCategory = category && typeof category === 'object' && !Array.isArray(category)
        ? category
        : null;
    const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters)
        ? filters
        : {};
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Math.max(0, Number(value || 0))));
    const formatDateTime = typeof options.formatDateTime === 'function'
        ? options.formatDateTime
        : ((value) => String(value || '—'));
    const getCardTone = typeof options.getCardTone === 'function'
        ? options.getCardTone
        : (() => 'neutral');
    const getDisplayActiveCount = typeof options.getDisplayActiveCount === 'function'
        ? options.getDisplayActiveCount
        : (() => 0);
    const getDisplayCriticalCount = typeof options.getDisplayCriticalCount === 'function'
        ? options.getDisplayCriticalCount
        : (() => 0);
    const getAutoResponseTone = typeof options.getAutoResponseTone === 'function'
        ? options.getAutoResponseTone
        : (() => 'warning');

    const tone = spotlightCategory ? getCardTone(spotlightCategory) : 'neutral';
    const latestItem = Array.isArray(spotlightCategory?.visible_items) && spotlightCategory.visible_items.length
        ? spotlightCategory.visible_items[0]
        : (Array.isArray(spotlightCategory?.items) && spotlightCategory.items.length ? spotlightCategory.items[0] : null);
    const activeCount = spotlightCategory ? Math.max(0, Number(getDisplayActiveCount(spotlightCategory) || 0)) : 0;
    const criticalCount = spotlightCategory ? Math.max(0, Number(getDisplayCriticalCount(spotlightCategory) || 0)) : 0;
    const caseSummary = spotlightCategory && typeof spotlightCategory.case_summary === 'object'
        ? spotlightCategory.case_summary
        : { open: 0, claimed: 0, resolved: 0 };
    const title = spotlightCategory
        ? (
            activeCount > 0
                ? `当前有 ${formatCount(activeCount)} 项商城风控信号待接手`
                : (
                    String(spotlightCategory.latest_state || '').toLowerCase() === 'recovered'
                        ? '最近一轮商城风控信号已恢复'
                        : '当前没有持续中的商城风控信号'
                )
        )
        : '当前没有可展示的商城风控快照';
    const summary = spotlightCategory
        ? (
            latestItem?.response_summary
            || latestItem?.message
            || spotlightCategory.filtered_note
            || spotlightCategory.latest_message
            || '处理入口会直达订单列表、优惠券码和用户详情，避免只看到告警却还要手动找页签。'
        )
        : (
            normalizedFilters.severity !== 'all' || normalizedFilters.scope !== 'all'
                ? '当前筛选条件下没有命中的商城风控信号，可以切回“全部状态 / 全部级别”查看全量快照。'
                : '最近没有持续中的商城风控告警，下面保留订单、优惠券码和用户处理入口。'
        );
    const statBadges = [
        {
            label: `${formatCount(activeCount)} 待关注`,
            tone: activeCount > 0 ? 'warning' : 'neutral'
        }
    ];

    if (spotlightCategory) {
        statBadges.push(
            { label: `${formatCount(caseSummary.open || 0)} 待认领`, tone: 'warning' },
            { label: `${formatCount(caseSummary.claimed || 0)} 处理中`, tone: 'neutral' }
        );
    }
    if (criticalCount > 0) {
        statBadges.push({
            label: `${formatCount(criticalCount)} critical`,
            tone: 'danger'
        });
    }
    if (spotlightCategory && String(spotlightCategory.latest_state || '').toLowerCase() === 'recovered' && activeCount <= 0) {
        statBadges.push({ label: '已恢复', tone: 'success' });
    }
    if (!spotlightCategory) {
        statBadges.push({ label: '等待更多上下文', tone: 'neutral' });
    }

    const thresholds = spotlightCategory?.thresholds && typeof spotlightCategory.thresholds === 'object'
        ? spotlightCategory.thresholds
        : null;
    const thresholdBadges = thresholds ? [
        {
            label: thresholds.auto_response_enabled ? '自动处置开启' : '自动处置关闭',
            tone: thresholds.auto_response_enabled ? 'warning' : 'neutral'
        },
        { label: `停券 ≥ ${formatCount(thresholds.auto_disable_coupon_min_risk_score || 0)}`, tone: 'neutral' },
        { label: `封禁 ≥ ${formatCount(thresholds.auto_ban_user_min_risk_score || 0)}`, tone: 'neutral' },
        { label: `封禁 ${formatCount(thresholds.auto_ban_user_duration_days || 0)} 天`, tone: 'neutral' },
        { label: `下架 ≥ ${formatCount(thresholds.auto_suspend_product_min_risk_score || 0)}`, tone: 'neutral' }
    ] : [];

    const buildActivityItems = (items = [], kind = 'threshold') => (Array.isArray(items) ? items : [])
        .slice(0, 4)
        .map((item) => {
            const normalizedKind = String(kind || 'threshold').trim().toLowerCase();
            const referenceValue = String(item?.reference_value || '').trim();
            const titleText = normalizedKind === 'auto'
                ? `${item?.action_label || '自动处置'} · ${item?.target || referenceValue || item?.title || '未知目标'}`
                : `${item?.action_label || '阈值命中'} · ${referenceValue || item?.title || '未知目标'}`;
            const metaParts = [];
            if (normalizedKind === 'threshold' && Number.isFinite(Number(item?.risk_score)) && Number.isFinite(Number(item?.threshold))) {
                metaParts.push(`分数 ${formatCount(item.risk_score)} / 阈值 ${formatCount(item.threshold)}`);
            }
            if (item?.reference_label && referenceValue && !titleText.includes(referenceValue)) {
                metaParts.push(`${item.reference_label}：${referenceValue}`);
            }
            if (item?.created_at) {
                metaParts.push(formatDateTime(item.created_at));
            }
            return {
                title: titleText,
                statusLabel: item?.status_label || '待人工确认',
                statusTone: getAutoResponseTone(item?.status),
                summary: item?.summary || item?.title || '等待更多上下文',
                meta: metaParts.join(' · ') || '等待更多上下文'
            };
        });

    return {
        tone,
        title,
        summary,
        statBadges,
        thresholdBadges,
        sections: {
            threshold: {
                title: '最近阈值命中',
                emptyMessage: '最近没有新的风控阈值命中记录。',
                items: buildActivityItems(spotlightCategory?.recent_threshold_hits, 'threshold')
            },
            auto: {
                title: '最近自动处置',
                emptyMessage: '最近没有新的自动停券、封禁或下架记录。',
                items: buildActivityItems(spotlightCategory?.recent_auto_responses, 'auto')
            }
        }
    };
}

function buildAdminWorkbenchOpsAlertRiskSpotlightShellState(status = 'loading', options = {}) {
    const normalizedStatus = String(status || 'loading').trim().toLowerCase();
    const isError = normalizedStatus === 'error';
    return {
        status: isError ? 'error' : 'loading',
        tone: isError ? 'danger' : 'neutral',
        eyebrow: '商城风控优先处理',
        title: isError ? '商城风控快照加载失败' : '当前没有可展示的商城风控快照',
        summary: isError
            ? String(options.message || '请刷新面板后重试。')
            : String(options.message || '最近没有持续中的商城风控告警，下面保留订单、优惠券码和用户处理入口。'),
        statBadges: [
            {
                label: isError ? '加载失败' : '等待加载',
                tone: isError ? 'danger' : 'neutral'
            }
        ],
        actions: isError ? [
            {
                actionName: 'settings-refresh-ops-alert-monitor',
                icon: 'fas fa-rotate',
                label: '刷新面板',
                attrs: {}
            },
            {
                actionName: 'settings-open-ops-alert-workspace',
                icon: 'fas fa-bag-shopping',
                label: '风险订单',
                attrs: {
                    'data-workspace-target': 'shop-risk-orders'
                }
            }
        ] : []
    };
}

function buildAdminWorkbenchOpsAlertRiskSpotlightRenderState(category = null, filters = {}, options = {}) {
    const spotlightState = buildAdminWorkbenchOpsAlertRiskSpotlightState(category, filters, options);
    const spotlightCategory = category && typeof category === 'object' && !Array.isArray(category)
        ? category
        : null;
    const latestItem = Array.isArray(spotlightCategory?.visible_items) && spotlightCategory.visible_items.length
        ? spotlightCategory.visible_items[0]
        : (Array.isArray(spotlightCategory?.items) && spotlightCategory.items.length ? spotlightCategory.items[0] : null);
    const getCategoryActions = typeof options.getCategoryActions === 'function'
        ? options.getCategoryActions
        : (() => []);
    const getQuickAction = typeof options.getQuickAction === 'function'
        ? options.getQuickAction
        : (() => null);
    const actions = [
        {
            actionName: 'settings-copy-ops-alert-monitor-category',
            icon: 'fas fa-list-check',
            label: '复制商城风控清单',
            attrs: {
                'data-ops-alert-monitor-category-key': 'shop_risk'
            }
        }
    ];
    const latestQuickAction = latestItem ? getQuickAction(spotlightCategory || {}, latestItem) : null;
    if (latestQuickAction && latestItem) {
        actions.push({
            actionName: 'settings-handle-shop-risk-action',
            icon: String(latestQuickAction.icon || '').trim() || 'fas fa-circle-dot',
            label: String(latestQuickAction.label || '').trim() || '执行处置',
            attrs: {
                'data-shop-risk-action': String(latestQuickAction.action || '').trim(),
                'data-title': String(latestItem.title || '').trim(),
                'data-alert-type': String(latestItem.alert_type || '').trim(),
                'data-category': String((spotlightCategory || {}).key || '').trim(),
                'data-reference-label': String(latestItem.reference_label || '').trim(),
                'data-reference-value': String(latestItem.reference_value || '').trim(),
                'data-target-id': String(latestItem.target_id || '').trim(),
                'data-user-id': String(latestItem.user_id || '').trim(),
                'data-client-ip': String(latestItem.client_ip || '').trim(),
                'data-discount-code': String(latestItem.discount_code || '').trim(),
                'data-signal-type': String(latestItem.signal_type || '').trim(),
                'data-session-id': String(latestItem.session_id || '').trim(),
                'data-case-status': String(latestItem.case_status || '').trim(),
                'data-case-owner-admin-id': String(latestItem.case_owner_admin_id || '').trim(),
                'data-case-owner-label': String(latestItem.case_owner_label || '').trim()
            }
        });
    }
    getCategoryActions('shop_risk').forEach((action) => {
        actions.push({
            actionName: 'settings-open-ops-alert-workspace',
            icon: String(action?.icon || '').trim() || 'fas fa-circle-dot',
            label: String(action?.label || '').trim() || '打开工作台',
            attrs: {
                'data-workspace-target': String(action?.target || '').trim()
            }
        });
    });

    return {
        ...spotlightState,
        actions
    };
}

function buildAdminWorkbenchOpsAlertMonitorFilterToolbarState(filters = {}, options = {}) {
    const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters)
        ? filters
        : {};
    const definitions = Array.isArray(options.definitions) ? options.definitions : [];

    return definitions.map((item) => {
        const kind = String(item?.kind || '').trim().toLowerCase();
        const value = String(item?.value || '').trim().toLowerCase();
        return {
            kind,
            value,
            active: normalizedFilters[kind] === value
        };
    });
}

function formatAdminWorkbenchOpsAlertTrendBucketLabel(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    return `${month}/${day} ${hour}:00`;
}

function buildAdminWorkbenchOpsAlertTrendGradient(bucket = {}) {
    const delivered = Math.max(0, Number(bucket.delivered_count || 0));
    const failed = Math.max(0, Number(bucket.failed_count || 0));
    const deadLetter = Math.max(0, Number(bucket.dead_letter_count || 0));
    const total = delivered + failed + deadLetter;
    if (total <= 0) {
        return '';
    }

    const segments = [
        { value: delivered, color: 'rgba(52, 211, 153, 0.96)' },
        { value: failed, color: 'rgba(251, 191, 36, 0.96)' },
        { value: deadLetter, color: 'rgba(248, 113, 113, 0.96)' }
    ];
    const stops = [];
    let cursor = 0;

    segments.forEach((segment) => {
        if (segment.value <= 0) return;
        const next = cursor + ((segment.value / total) * 100);
        stops.push(`${segment.color} ${cursor.toFixed(2)}% ${next.toFixed(2)}%`);
        cursor = next;
    });

    if (cursor < 100) {
        stops.push(`rgba(107, 158, 206, 0.18) ${cursor.toFixed(2)}% 100%`);
    }

    return `linear-gradient(to top, ${stops.join(', ')})`;
}

function buildAdminWorkbenchOpsAlertOverviewRecentVisualState(summary = {}, status = 'idle', options = {}) {
    const normalizedSummary = summary && typeof summary === 'object' && !Array.isArray(summary) ? summary : {};
    const normalizedStatus = String(status || 'idle').trim().toLowerCase() || 'idle';
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Math.max(0, Number(value || 0))));
    const formatBucketLabel = typeof options.formatBucketLabel === 'function'
        ? options.formatBucketLabel
        : formatAdminWorkbenchOpsAlertTrendBucketLabel;
    const buildGradient = typeof options.buildGradient === 'function'
        ? options.buildGradient
        : buildAdminWorkbenchOpsAlertTrendGradient;

    if (normalizedStatus !== 'ready') {
        return {
            trendMeta: '',
            trendBuckets: [],
            trendFooterLabels: [],
            segmentMeta: '分段统计',
            segments: []
        };
    }

    const trendBuckets = Array.isArray(normalizedSummary.recent_trend_buckets)
        ? normalizedSummary.recent_trend_buckets
        : [];
    const maxBucketTotal = trendBuckets.reduce((max, bucket) => (
        Math.max(max, Number(bucket?.total_count || 0))
    ), 0);
    const trendItems = [];
    let trendMeta = '';
    let trendFooterLabels = [];

    if (trendBuckets.length > 0 && maxBucketTotal > 0) {
        trendItems.push(...trendBuckets.map((bucket) => {
            const delivered = Math.max(0, Number(bucket?.delivered_count || 0));
            const failed = Math.max(0, Number(bucket?.failed_count || 0));
            const deadLetter = Math.max(0, Number(bucket?.dead_letter_count || 0));
            const total = delivered + failed + deadLetter;
            const heightPercent = total > 0
                ? Math.max(10, Math.round((total / maxBucketTotal) * 100))
                : 0;
            const tooltip = [
                `${formatBucketLabel(bucket?.bucket_start_at)} - ${formatBucketLabel(bucket?.bucket_end_at)}`,
                `送达 ${formatCount(delivered)} 次`,
                `失败 ${formatCount(failed)} 次`,
                `死信 ${formatCount(deadLetter)} 项`
            ].join(' · ');
            const backgroundStyle = total > 0
                ? `height:${heightPercent}%;background:${buildGradient(bucket)};`
                : '';

            return {
                tooltip,
                total,
                heightPercent,
                backgroundStyle,
                fillEmpty: total <= 0
            };
        }));

        const middleIndex = Math.floor((trendBuckets.length - 1) / 2);
        trendMeta = `72 小时趋势 · 每 ${formatCount(normalizedSummary.trend_bucket_hours || 6)} 小时一段`;
        trendFooterLabels = [
            formatBucketLabel(trendBuckets[0]?.bucket_start_at),
            formatBucketLabel(trendBuckets[middleIndex]?.bucket_start_at),
            formatBucketLabel(trendBuckets[trendBuckets.length - 1]?.bucket_end_at)
        ];
    }

    const deliveredCount = Math.max(0, Number(normalizedSummary.delivered_count || 0));
    const failedCount = Math.max(0, Number(normalizedSummary.failed_count || 0));
    const deadLetterCount = Math.max(0, Number(normalizedSummary.dead_letter_count || 0));
    const segmentTotal = deliveredCount + failedCount + deadLetterCount;
    const segments = segmentTotal > 0
        ? [
            { label: '送达', value: deliveredCount, tone: 'success' },
            { label: '失败', value: failedCount, tone: 'warning' },
            { label: '死信', value: deadLetterCount, tone: 'danger' }
        ].map((segment) => {
            const share = segmentTotal > 0 ? Math.round((segment.value / segmentTotal) * 100) : 0;
            return {
                label: segment.label,
                tone: segment.tone,
                valueText: formatCount(segment.value),
                shareText: `${formatCount(share)}%`
            };
        })
        : [];

    return {
        trendMeta,
        trendBuckets: trendItems,
        trendFooterLabels,
        segmentMeta: '分段统计',
        segments
    };
}

function getAdminWorkbenchOpsAlertHealthSourceLabel(source = '') {
    const normalizedSource = String(source || '').trim().toLowerCase();
    if (normalizedSource === 'stored') return '后台密钥仓';
    if (normalizedSource === 'environment') return '环境变量';
    return '未配置';
}

function getAdminWorkbenchOpsAlertHealthMetaLine(channel = {}, options = {}) {
    const formatDateTime = typeof options.formatDateTime === 'function'
        ? options.formatDateTime
        : ((value) => String(value || '—'));
    const metaParts = [
        `最小级别：${channel.minimum_severity || 'warning'}`,
        `配置来源：${getAdminWorkbenchOpsAlertHealthSourceLabel(channel.source)}`
    ];

    if (channel.recipient_summary) {
        metaParts.push(channel.recipient_summary);
    }

    if (channel.updated_at) {
        metaParts.push(`更新于 ${formatDateTime(channel.updated_at)}`);
    }

    return metaParts.join(' · ');
}

function getAdminWorkbenchOpsAlertHealthLastSummary(channel = {}, options = {}) {
    const formatDateTime = typeof options.formatDateTime === 'function'
        ? options.formatDateTime
        : ((value) => String(value || '—'));
    if (channel.last_error) {
        return `最近错误：${channel.last_error}`;
    }
    if (channel.last_attempt_at) {
        return `最近投递：${formatDateTime(channel.last_attempt_at)}`;
    }
    return '最近 72 小时内暂无投递记录';
}

function getAdminWorkbenchOpsAlertHealthConfigDetails(channel = {}, options = {}) {
    const details = [];
    const formatDateTime = typeof options.formatDateTime === 'function'
        ? options.formatDateTime
        : ((value) => String(value || '—'));

    if (channel.key === 'telegram' && channel.recipient_summary) {
        details.push({ label: '投递目标', value: channel.recipient_summary });
    }

    if (channel.key === 'feishu') {
        details.push({ label: '投递方式', value: channel.recipient_summary || 'Webhook 通道' });
    }

    if (channel.key === 'email') {
        if (channel.recipient_preview) {
            details.push({ label: '收件人', value: channel.recipient_preview });
        } else if (channel.recipient_summary) {
            details.push({ label: '收件人', value: channel.recipient_summary });
        }

        if (channel.from_address) {
            details.push({ label: '发件地址', value: channel.from_address });
        }

        if (channel.reply_to) {
            details.push({ label: 'Reply-To', value: channel.reply_to });
        }
    }

    const recentDeliverySummary = getAdminWorkbenchOpsAlertRecentDeliverySummary(channel.recent_deliveries, {
        limit: 2,
        includeChannel: false
    });
    if (recentDeliverySummary) {
        details.push({ label: '最近类型', value: recentDeliverySummary });
    }

    if (channel.subject_prefix) {
        details.push({ label: '主题前缀', value: channel.subject_prefix });
    }

    if (channel.last_attempt_at) {
        details.push({ label: '最近投递', value: formatDateTime(channel.last_attempt_at) });
    }

    return details.slice(0, 5);
}

function buildAdminWorkbenchOpsAlertHealthCardState(channel = {}, options = {}) {
    const normalizedChannel = channel && typeof channel === 'object' && !Array.isArray(channel) ? channel : {};
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Math.max(0, Number(value || 0))));
    const formatDateTime = typeof options.formatDateTime === 'function'
        ? options.formatDateTime
        : ((value) => String(value || '—'));
    const tone = String(normalizedChannel.tone || 'neutral').trim().toLowerCase() || 'neutral';
    const deliveryRate = Number(normalizedChannel.delivery_rate);
    const deliveryRateText = Number.isFinite(deliveryRate) ? `${deliveryRate.toFixed(1)}%` : '—';
    const recentErrors = Array.isArray(normalizedChannel.recent_errors)
        ? normalizedChannel.recent_errors.filter(Boolean)
        : [];

    return {
        tone,
        label: normalizedChannel.label || '通道',
        metaLine: getAdminWorkbenchOpsAlertHealthMetaLine(normalizedChannel, { formatDateTime }),
        statusBadges: [
            {
                label: normalizedChannel.enabled ? '已启用' : '未启用',
                tone: normalizedChannel.enabled ? (normalizedChannel.configured ? 'success' : 'warning') : 'neutral'
            },
            {
                label: normalizedChannel.health_label || '未启用',
                tone
            }
        ],
        stats: [
            { value: formatCount(normalizedChannel.total_attempts || 0), label: '近窗投递' },
            { value: deliveryRateText, label: '送达率' },
            { value: formatCount(normalizedChannel.dead_letter_count || 0), label: '死信' },
            { value: formatCount(normalizedChannel.retry_count || 0), label: '重试' }
        ],
        configDetails: getAdminWorkbenchOpsAlertHealthConfigDetails(normalizedChannel, { formatDateTime }),
        summaryText: getAdminWorkbenchOpsAlertHealthLastSummary(normalizedChannel, { formatDateTime }),
        recentErrors: recentErrors.map((item) => ({
            message: item.message || '未知错误',
            meta: `${formatCount(item.count || 0)} 次 · ${item.last_seen_at ? formatDateTime(item.last_seen_at) : '时间未知'}`
        })),
        recentErrorsEmptyText: '最近没有失败明细。'
    };
}

function buildAdminWorkbenchOpsAlertHealthPanelState(state = {}, options = {}) {
    const defaultHealthState = options.defaultHealthState && typeof options.defaultHealthState === 'object' && !Array.isArray(options.defaultHealthState)
        ? options.defaultHealthState
        : getAdminWorkbenchDefaultOpsAlertHealthState();
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Math.max(0, Number(value || 0))));
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
    const summary = normalizedState.summary && typeof normalizedState.summary === 'object' && !Array.isArray(normalizedState.summary)
        ? normalizedState.summary
        : (defaultHealthState.summary || {});
    const channels = Array.isArray(normalizedState.channels) ? normalizedState.channels : [];
    const normalizedStatus = String(normalizedState.status || defaultHealthState.status || 'idle').trim().toLowerCase() || 'idle';

    if (normalizedStatus === 'loading') {
        return {
            status: 'loading',
            metaIcon: 'fas fa-rotate fa-spin',
            metaText: '正在加载站外告警通道健康状态...',
            emptyMessage: '正在加载站外告警通道健康状态...',
            shouldRenderCards: false
        };
    }

    if (normalizedStatus === 'error') {
        const message = normalizedState.message || '加载告警通道健康状态失败。';
        return {
            status: 'error',
            metaIcon: 'fas fa-triangle-exclamation',
            metaText: message,
            emptyMessage: message,
            shouldRenderCards: false
        };
    }

    if (!channels.length) {
        return {
            status: 'empty',
            metaIcon: 'fas fa-circle-info',
            metaText: '最近没有可用于评估的站外告警通道数据。',
            emptyMessage: '最近没有可用于评估的站外告警通道数据。',
            shouldRenderCards: false
        };
    }

    return {
        status: 'ready',
        metaIcon: 'fas fa-heart-pulse',
        metaText: `最近 ${formatCount(summary.lookback_hours || 0)} 小时共记录 ${formatCount(summary.total_attempt_count || 0)} 次投递，送达 ${formatCount(summary.delivered_count || 0)} 次，失败 ${formatCount(summary.failed_count || 0)} 次，死信 ${formatCount(summary.dead_letter_count || 0)} 项。`,
        emptyMessage: '',
        shouldRenderCards: true
    };
}

function buildAdminWorkbenchOpsAlertHealthRenderState(state = {}, options = {}) {
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
    const channels = Array.isArray(normalizedState.channels) ? normalizedState.channels.filter(Boolean) : [];
    const panelState = buildAdminWorkbenchOpsAlertHealthPanelState(normalizedState, options);

    return {
        panelState,
        channelCardStates: panelState.shouldRenderCards
            ? channels.map((channel) => buildAdminWorkbenchOpsAlertHealthCardState(channel, options))
            : []
    };
}

function buildAdminWorkbenchOpsAlertStrategyControlState(config = {}, options = {}) {
    const normalizeConfig = typeof options.normalizeConfig === 'function'
        ? options.normalizeConfig
        : ((value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}));
    const getDefaultConfig = typeof options.getDefaultConfig === 'function'
        ? options.getDefaultConfig
        : (() => ({
            temporary_mute: { until: '', allow_critical: true },
            quiet_hours: { enabled: false, start_hour: 22, end_hour: 8, timezone: 'Asia/Shanghai', allow_critical: true },
            work_hours: { enabled: false, start_hour: 9, end_hour: 18, timezone: 'Asia/Shanghai' }
        }));
    const getTemporaryMuteState = typeof options.getTemporaryMuteState === 'function'
        ? options.getTemporaryMuteState
        : (() => ({ active: false, expired: false, untilLabel: '—', allowCritical: true }));
    const getMuteRuleDefinitions = typeof options.getMuteRuleDefinitions === 'function'
        ? options.getMuteRuleDefinitions
        : (() => []);
    const getMuteRuleState = typeof options.getMuteRuleState === 'function'
        ? options.getMuteRuleState
        : ((rule = {}) => ({
            active: rule?.active === true,
            expired: rule?.expired === true,
            untilLabel: String(rule?.untilLabel || '—').trim() || '—',
            allowCritical: rule?.allowCritical !== false
        }));
    const formatDateTimeLocalInputValue = typeof options.formatDateTimeLocalInputValue === 'function'
        ? options.formatDateTimeLocalInputValue
        : ((value) => String(value || ''));
    const formatHourRangePreview = typeof options.formatHourRangePreview === 'function'
        ? options.formatHourRangePreview
        : ((startHour, endHour, previewOptions = {}) => `${startHour}-${endHour}${previewOptions.timezone ? ` (${previewOptions.timezone})` : ''}`);

    const normalizedConfig = normalizeConfig(config);
    const defaults = getDefaultConfig() || {};
    const temporaryMute = normalizedConfig.temporary_mute || defaults.temporary_mute || {};
    const quietHours = normalizedConfig.quiet_hours || defaults.quiet_hours || {};
    const workHours = normalizedConfig.work_hours || defaults.work_hours || {};
    const temporaryMuteState = getTemporaryMuteState(normalizedConfig);
    const muteRules = ['types', 'modules'].reduce((result, scope) => {
        const scopeConfig = normalizedConfig.mute_rules?.[scope] || {};
        result[scope] = getMuteRuleDefinitions(scope).reduce((scopeResult, definition) => {
            const rule = scopeConfig?.[definition.key] || {};
            const state = getMuteRuleState(rule);
            scopeResult[definition.key] = {
                untilValue: formatDateTimeLocalInputValue(rule.until || ''),
                allowCriticalActive: rule.allow_critical !== false,
                statusText: state.active
                    ? `${state.untilLabel} 前静默${state.allowCritical ? '，critical 继续通知。' : '，全部级别暂停。'}`
                    : (state.expired ? `已于 ${state.untilLabel} 到期，可清除旧时间。` : ''),
                statusHidden: !(state.active || state.expired),
                clearHidden: !(state.active || state.expired),
                rowState: state.active ? 'active' : (state.expired ? 'expired' : 'inactive')
            };
            return scopeResult;
        }, {});
        return result;
    }, {});
    const routingMatrix = Object.keys({
        ...(defaults.routing || {}),
        ...(normalizedConfig.routing || {})
    }).reduce((result, routingKey) => {
        const currentRoute = normalizedConfig.routing?.[routingKey] || defaults.routing?.[routingKey] || {};
        result[routingKey] = {
            telegram: currentRoute.telegram !== false,
            feishu: currentRoute.feishu !== false,
            email: currentRoute.email !== false
        };
        return result;
    }, {});

    return {
        temporaryMute: {
            untilValue: formatDateTimeLocalInputValue(temporaryMute.until || ''),
            allowCriticalActive: temporaryMute.allow_critical !== false,
            statusText: temporaryMuteState.active
                ? `当前已静默至 ${temporaryMuteState.untilLabel}，${temporaryMuteState.allowCritical ? 'critical 仍继续通知。' : '所有级别暂停外发。'}`
                : (temporaryMuteState.expired
                    ? `上次静默已于 ${temporaryMuteState.untilLabel} 到期。点击“清除静默”可清掉旧时间。`
                    : ''),
            statusHidden: !(temporaryMuteState.active || temporaryMuteState.expired),
            clearHidden: !(temporaryMuteState.active || temporaryMuteState.expired)
        },
        quietHours: {
            enabledActive: quietHours.enabled === true,
            allowCriticalActive: quietHours.allow_critical !== false,
            allowCriticalDisabled: quietHours.enabled !== true,
            inputsDisabled: quietHours.enabled !== true,
            rangeHint: formatHourRangePreview(quietHours.start_hour, quietHours.end_hour, {
                timezone: quietHours.timezone
            })
        },
        workHours: {
            enabledActive: workHours.enabled === true,
            inputsDisabled: workHours.enabled !== true,
            rangeHint: formatHourRangePreview(workHours.start_hour, workHours.end_hour, {
                timezone: workHours.timezone
            })
        },
        muteRules,
        routingMatrix
    };
}

function buildAdminWorkbenchOpsAlertSummaryModeControlState(section = {}, options = {}) {
    const normalizedSection = section && typeof section === 'object' && !Array.isArray(section)
        ? section
        : {};
    const normalizeScheduleMode = typeof options.normalizeScheduleMode === 'function'
        ? options.normalizeScheduleMode
        : ((value, fallbackValue = 'rolling_window') => String(value || fallbackValue).trim().toLowerCase() || fallbackValue);
    const getHintText = typeof options.getHintText === 'function'
        ? options.getHintText
        : buildAdminWorkbenchOpsAlertSummaryModeHintText;

    const monitorEnabled = options.monitorEnabled !== false && normalizedSection.enabled === true;
    const summaryEnabled = options.summaryEnabled !== false && normalizedSection.summary_enabled === true;
    const summaryInputsEnabled = monitorEnabled && summaryEnabled;
    const scheduleMode = normalizeScheduleMode(normalizedSection.summary_schedule_mode, 'rolling_window');

    return {
        scheduleMode,
        summaryInputsEnabled,
        scheduleModeDisabled: !summaryInputsEnabled,
        summaryMaxItemsDisabled: !summaryInputsEnabled,
        summaryWindowMinutesDisabled: !summaryInputsEnabled || scheduleMode !== 'rolling_window',
        summaryHourlyMinuteDisabled: !summaryInputsEnabled || scheduleMode !== 'hourly',
        summaryDailyHourDisabled: !summaryInputsEnabled || scheduleMode !== 'daily',
        summaryDailyMinuteDisabled: !summaryInputsEnabled || scheduleMode !== 'daily',
        rows: {
            summaryWindowMinutesVisible: scheduleMode === 'rolling_window',
            summaryHourlyMinuteVisible: scheduleMode === 'hourly',
            summaryDailyHourVisible: scheduleMode === 'daily',
            summaryDailyMinuteVisible: scheduleMode === 'daily'
        },
        hintText: getHintText(normalizedSection, {
            monitorEnabled,
            summaryEnabled
        }),
        hintDisabled: !summaryEnabled || !monitorEnabled
    };
}

function buildAdminWorkbenchOpsAlertSummaryOrchestrationMonitorState(definition = {}, section = {}, options = {}) {
    const normalizedDefinition = definition && typeof definition === 'object' && !Array.isArray(definition)
        ? definition
        : {};
    const normalizedSection = section && typeof section === 'object' && !Array.isArray(section)
        ? section
        : {};
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Math.max(0, Number(value || 0))));
    const sweepIntervalMinutes = Math.max(1, Math.round(Number(normalizedSection.sweep_interval_ms || 0) / 60000));
    const enabled = normalizedSection.enabled === true;
    let text = enabled
        ? `巡检 ${formatCount(sweepIntervalMinutes)} 分钟，回看 ${formatCount(normalizedSection.lookback_minutes || 0)} 分钟。`
        : `巡检参数仍保留，回看 ${formatCount(normalizedSection.lookback_minutes || 0)} 分钟。`;

    switch (normalizedDefinition.key) {
        case 'shop_inventory':
            text = enabled
                ? `巡检 ${formatCount(sweepIntervalMinutes)} 分钟，低库存阈值 ${formatCount(normalizedSection.low_stock_threshold || 0)}。`
                : `库存巡检参数仍保留，阈值 ${formatCount(normalizedSection.low_stock_threshold || 0)}。`;
            break;
        case 'tickets':
            text = enabled
                ? `巡检 ${formatCount(sweepIntervalMinutes)} 分钟，超时阈值 ${formatCount(normalizedSection.pending_overdue_minutes || 0)} 分钟。`
                : `工单 SLA 阈值仍保留为 ${formatCount(normalizedSection.pending_overdue_minutes || 0)} 分钟。`;
            break;
        case 'shop_order_delivery':
            text = enabled
                ? `巡检 ${formatCount(sweepIntervalMinutes)} 分钟，重试阈值 ${formatCount(normalizedSection.retry_waiting_min_attempts || 0)} 次，事故阈值 ${formatCount(normalizedSection.incident_min_order_count || 0)} 笔。`
                : `履约异常阈值仍保留，重试 ${formatCount(normalizedSection.retry_waiting_min_attempts || 0)} 次触发。`;
            break;
        case 'payment_gateway':
            text = enabled
                ? `巡检 ${formatCount(sweepIntervalMinutes)} 分钟，异常窗口 ${formatCount(normalizedSection.window_minutes || 0)} 分钟，失败阈值 ${formatCount(normalizedSection.min_failed_orders || 0)} 笔。`
                : `支付通道异常阈值仍保留，窗口 ${formatCount(normalizedSection.window_minutes || 0)} 分钟。`;
            break;
        case 'verify_quota':
            text = enabled
                ? `巡检 ${formatCount(sweepIntervalMinutes)} 分钟，低余额 ${formatCount(normalizedSection.low_balance_threshold || 0)} 点 / 低剩余 ${formatCount(normalizedSection.low_remaining_jobs_threshold || 0)} 次。`
                : `验证额度阈值仍保留，低余额 ${formatCount(normalizedSection.low_balance_threshold || 0)} 点。`;
            break;
        case 'verify_queue':
            text = enabled
                ? `巡检 ${formatCount(sweepIntervalMinutes)} 分钟，队列阈值 ${formatCount(normalizedSection.queue_size_threshold || 0)} 个，最老待处理 ${formatCount(normalizedSection.oldest_pending_minutes_threshold || 0)} 分钟。`
                : `验证堆积阈值仍保留，队列阈值 ${formatCount(normalizedSection.queue_size_threshold || 0)} 个。`;
            break;
        case 'verify_failure':
            text = enabled
                ? `巡检 ${formatCount(sweepIntervalMinutes)} 分钟，失败率阈值 ${formatCount(normalizedSection.failure_rate_threshold || 0)}%，样本量至少 ${formatCount(normalizedSection.min_total_jobs_threshold || 0)} 次。`
                : `验证失败率阈值仍保留，失败率 ${formatCount(normalizedSection.failure_rate_threshold || 0)}%。`;
            break;
        default:
            break;
    }

    return {
        cellId: normalizedDefinition.monitor_status_id || '',
        tone: enabled ? 'success' : 'neutral',
        label: enabled ? '已启用' : '已关闭',
        text
    };
}

function buildAdminWorkbenchOpsAlertSummaryOrchestrationWorkHoursState(definition = {}, section = {}, workHours = {}, options = {}) {
    const normalizedDefinition = definition && typeof definition === 'object' && !Array.isArray(definition)
        ? definition
        : {};
    const normalizedSection = section && typeof section === 'object' && !Array.isArray(section)
        ? section
        : {};
    const normalizedWorkHours = workHours && typeof workHours === 'object' && !Array.isArray(workHours)
        ? workHours
        : {};
    const formatHourMinute = typeof options.formatHourMinute === 'function'
        ? options.formatHourMinute
        : ((hour, minute) => `${String(Number(hour || 0)).padStart(2, '0')}:${String(Number(minute || 0)).padStart(2, '0')}`);
    const workHoursEnabled = normalizedWorkHours.enabled === true;
    const startLabel = formatHourMinute(normalizedWorkHours.start_hour, 0);
    const endLabel = formatHourMinute(normalizedWorkHours.end_hour, 0);
    const timezoneLabel = normalizedWorkHours.timezone || 'Asia/Shanghai';

    if (normalizedDefinition.supports_work_hours_only !== true) {
        return {
            cellId: normalizedDefinition.work_hours_status_id || '',
            tone: 'neutral',
            label: '不适用',
            text: '当前库存类只支持定时汇总，不支持按工作时段顺延。'
        };
    }
    if (normalizedSection.enabled !== true) {
        return {
            cellId: normalizedDefinition.work_hours_status_id || '',
            tone: 'neutral',
            label: '主监控关闭',
            text: '开启主监控后才会应用工作时段顺延。'
        };
    }
    if (normalizedSection.work_hours_only_enabled === true && workHoursEnabled) {
        return {
            cellId: normalizedDefinition.work_hours_status_id || '',
            tone: 'success',
            label: '已顺延',
            text: `非工作时段会顺延到 ${startLabel} 开始，工作时段 ${startLabel}-${endLabel}（${timezoneLabel}）。`
        };
    }
    if (normalizedSection.work_hours_only_enabled === true) {
        return {
            cellId: normalizedDefinition.work_hours_status_id || '',
            tone: 'warning',
            label: '待开启工作时段',
            text: '已勾选顺延，但全局工作时段还没启用。'
        };
    }
    if (workHoursEnabled) {
        return {
            cellId: normalizedDefinition.work_hours_status_id || '',
            tone: 'neutral',
            label: '全天直发',
            text: `全局工作时段是 ${startLabel}-${endLabel}，但该告警仍全天直接外发。`
        };
    }

    return {
        cellId: normalizedDefinition.work_hours_status_id || '',
        tone: 'neutral',
        label: '全天直发',
        text: '当前未启用全局工作时段限制。'
    };
}

function buildAdminWorkbenchOpsAlertSummaryOrchestrationSummaryState(definition = {}, section = {}, workHours = {}, options = {}) {
    const normalizedDefinition = definition && typeof definition === 'object' && !Array.isArray(definition)
        ? definition
        : {};
    const normalizedSection = section && typeof section === 'object' && !Array.isArray(section)
        ? section
        : {};
    const normalizedWorkHours = workHours && typeof workHours === 'object' && !Array.isArray(workHours)
        ? workHours
        : {};
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Math.max(0, Number(value || 0))));
    const formatSummaryScheduleDescription = typeof options.formatSummaryScheduleDescription === 'function'
        ? options.formatSummaryScheduleDescription
        : (() => '滚动窗口 60 分钟');
    const summaryDescription = formatSummaryScheduleDescription(normalizedSection);
    const workHoursEnabled = normalizedWorkHours.enabled === true;

    if (normalizedSection.enabled !== true) {
        return {
            cellId: normalizedDefinition.summary_status_id || '',
            tone: normalizedSection.summary_enabled === true ? 'warning' : 'neutral',
            label: normalizedSection.summary_enabled === true ? '等待主监控' : '即时通知',
            text: normalizedSection.summary_enabled === true
                ? `已预设 ${summaryDescription}，最多 ${formatCount(normalizedSection.summary_max_items || 0)} 条，开启主监控后生效。`
                : '主监控关闭时不会出队汇总。'
        };
    }
    if (normalizedSection.summary_enabled === true) {
        return {
            cellId: normalizedDefinition.summary_status_id || '',
            tone: 'success',
            label: '已启用汇总',
            text: `${summaryDescription}，最多 ${formatCount(normalizedSection.summary_max_items || 0)} 条。${normalizedDefinition.supports_work_hours_only === true && normalizedSection.work_hours_only_enabled === true && workHoursEnabled ? ' 非工作时段仍会顺延到上班时间。' : ''}`
        };
    }
    if (normalizedDefinition.supports_work_hours_only === true && normalizedSection.work_hours_only_enabled === true && workHoursEnabled) {
        return {
            cellId: normalizedDefinition.summary_status_id || '',
            tone: 'warning',
            label: '仅非工作时段汇总',
            text: '工作时段内仍即时通知，非工作时段会顺延到下个上班时间。'
        };
    }

    return {
        cellId: normalizedDefinition.summary_status_id || '',
        tone: 'neutral',
        label: '即时通知',
        text: '当前不走固定汇总，命中后按原节奏直接外发。'
    };
}

function buildAdminWorkbenchOpsAlertSummaryOrchestrationRenderState(config = {}, options = {}) {
    const normalizedConfig = config && typeof config === 'object' && !Array.isArray(config)
        ? config
        : {};
    const definitions = Array.isArray(options.definitions)
        ? options.definitions.filter(Boolean)
        : [];
    const defaults = options.defaults && typeof options.defaults === 'object' && !Array.isArray(options.defaults)
        ? options.defaults
        : {};
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Math.max(0, Number(value || 0))));
    const formatHourMinute = typeof options.formatHourMinute === 'function'
        ? options.formatHourMinute
        : ((hour, minute) => `${String(Number(hour || 0)).padStart(2, '0')}:${String(Number(minute || 0)).padStart(2, '0')}`);
    const formatSummaryScheduleDescription = typeof options.formatSummaryScheduleDescription === 'function'
        ? options.formatSummaryScheduleDescription
        : ((section = {}) => buildAdminWorkbenchOpsAlertSummaryModeHintText(section, {
            normalizeScheduleMode: options.normalizeScheduleMode,
            formatCount,
            formatTimeNumber: options.formatTimeNumber,
            formatHourMinute,
            monitorEnabled: true,
            summaryEnabled: true
        }).replace(/^当前会在/, '').replace(/统一发送。$/, ''));
    const selectedDefinitions = Array.isArray(options.selectedDefinitions)
        ? options.selectedDefinitions.filter(Boolean)
        : [];
    const selectedDefinitionKeys = new Set(
        selectedDefinitions.map((definition) => String(definition?.key || '').trim()).filter(Boolean)
    );
    const workHours = normalizedConfig.work_hours || defaults.work_hours || {};
    let enabledMonitorCount = 0;
    let summaryEnabledCount = 0;
    let workHoursOnlyCount = 0;

    const definitionStates = definitions.map((definition) => {
        const section = normalizedConfig[definition.key] || defaults[definition.key] || {};
        if (section.enabled === true) {
            enabledMonitorCount += 1;
        }
        if (section.summary_enabled === true) {
            summaryEnabledCount += 1;
        }
        if (definition.supports_work_hours_only === true && section.work_hours_only_enabled === true) {
            workHoursOnlyCount += 1;
        }

        return {
            key: definition.key || '',
            label: definition.label || '',
            selected: selectedDefinitionKeys.has(definition.key),
            monitorState: buildAdminWorkbenchOpsAlertSummaryOrchestrationMonitorState(definition, section, {
                formatCount
            }),
            workHoursState: buildAdminWorkbenchOpsAlertSummaryOrchestrationWorkHoursState(definition, section, workHours, {
                formatHourMinute
            }),
            summaryState: buildAdminWorkbenchOpsAlertSummaryOrchestrationSummaryState(definition, section, workHours, {
                formatCount,
                formatSummaryScheduleDescription
            })
        };
    });

    const selectedCount = Number.isFinite(options.selectedCount)
        ? Math.max(0, Number(options.selectedCount))
        : selectedDefinitionKeys.size;

    return {
        counts: {
            total: definitions.length,
            enabledMonitorCount,
            summaryEnabledCount,
            workHoursOnlyCount,
            selectedCount
        },
        metaText: `共 ${formatCount(definitions.length)} 类告警：${formatCount(enabledMonitorCount)} 类已启用主监控，${formatCount(summaryEnabledCount)} 类已启用定时汇总，${formatCount(workHoursOnlyCount)} 类启用工作时段顺延。当前已勾选 ${formatCount(selectedCount)} 类用于批量应用。`,
        overviewSelectionText: `已勾选 ${formatCount(selectedCount)} 类`,
        definitionStates
    };
}

function buildAdminWorkbenchOpsAlertMonitorControlState(section = {}, options = {}) {
    const normalizedSection = section && typeof section === 'object' && !Array.isArray(section)
        ? section
        : {};
    const monitorEnabled = normalizedSection.enabled === true;
    const extraToggleKeys = Array.isArray(options.extraToggleKeys)
        ? options.extraToggleKeys.filter(Boolean)
        : [];
    const extraToggleDisabledWhenMonitorDisabledKeys = new Set(
        Array.isArray(options.extraToggleDisabledWhenMonitorDisabledKeys)
            ? options.extraToggleDisabledWhenMonitorDisabledKeys.filter(Boolean)
            : []
    );

    return {
        enabledActive: monitorEnabled,
        inputsDisabled: !monitorEnabled,
        summaryToggle: {
            active: normalizedSection.summary_enabled === true,
            disabled: options.summaryToggleDisabledWhenMonitorDisabled === true ? !monitorEnabled : false
        },
        workHoursOnlyToggle: {
            active: normalizedSection.work_hours_only_enabled === true,
            disabled: options.workHoursOnlyToggleDisabledWhenMonitorDisabled !== false ? !monitorEnabled : false
        },
        extraToggles: extraToggleKeys.reduce((result, key) => {
            result[key] = {
                active: normalizedSection[key] === true,
                disabled: extraToggleDisabledWhenMonitorDisabledKeys.has(key) ? !monitorEnabled : false
            };
            return result;
        }, {})
    };
}

function buildAdminWorkbenchOpsAlertShopRiskControlState(section = {}) {
    const normalizedSection = section && typeof section === 'object' && !Array.isArray(section)
        ? section
        : {};
    const autoResponseEnabled = normalizedSection.auto_response_enabled === true;

    return {
        autoResponseToggle: {
            active: autoResponseEnabled
        },
        thresholdInputsDisabled: !autoResponseEnabled
    };
}

function validateAdminWorkbenchOpsAlertDispatchConfig(config = {}, secretStatus = {}, secrets = {}, options = {}) {
    const normalizedConfig = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
    const normalizedSecrets = secrets && typeof secrets === 'object' && !Array.isArray(secrets)
        ? secrets
        : {};
    const normalizedSecretStatus = secretStatus && typeof secretStatus === 'object' && !Array.isArray(secretStatus)
        ? secretStatus
        : {};
    const fallbackMessages = options.messages && typeof options.messages === 'object' && !Array.isArray(options.messages)
        ? options.messages
        : {};
    const telegramEnabled = normalizedConfig.channels?.telegram?.enabled === true;
    const feishuEnabled = normalizedConfig.channels?.feishu?.enabled === true;
    const emailEnabled = normalizedConfig.channels?.email?.enabled === true;
    const chatIds = Array.isArray(normalizedConfig.channels?.telegram?.chat_ids)
        ? normalizedConfig.channels.telegram.chat_ids
        : [];
    const recipients = Array.isArray(normalizedConfig.channels?.email?.recipients)
        ? normalizedConfig.channels.email.recipients
        : [];
    const providedTelegramToken = String(normalizedSecrets.telegram_bot_token || '').trim();
    const providedFeishuWebhook = String(normalizedSecrets.feishu_webhook_url || '').trim();
    const providedEmailApiKey = String(normalizedSecrets.email_api_key || '').trim();
    const hasStoredTelegramToken = Boolean(normalizedSecretStatus.telegram_bot_token?.configured);
    const hasStoredFeishuWebhook = Boolean(normalizedSecretStatus.feishu_webhook_url?.configured);
    const hasStoredEmailApiKey = Boolean(normalizedSecretStatus.email_api_key?.configured);

    if (!telegramEnabled && !feishuEnabled && !emailEnabled) {
        throw new Error(fallbackMessages.noChannels || '请先启用至少一个站外告警通道');
    }

    if (telegramEnabled) {
        if (!chatIds.length) {
            throw new Error(fallbackMessages.telegramChatIds || '已启用 Telegram 告警，请先填写至少一个 Telegram Chat ID');
        }

        if (!providedTelegramToken && !hasStoredTelegramToken) {
            throw new Error(fallbackMessages.telegramToken || '已启用 Telegram 告警，请先填写 Telegram Bot Token，或先保存已配置的后台密钥');
        }
    }

    if (feishuEnabled && !providedFeishuWebhook && !hasStoredFeishuWebhook) {
        throw new Error(fallbackMessages.feishuWebhook || '已启用飞书告警，请先填写飞书 Webhook，或先保存已配置的后台密钥');
    }

    if (emailEnabled) {
        if (!recipients.length) {
            throw new Error(fallbackMessages.emailRecipients || '已启用邮件告警，请先填写至少一个收件人');
        }
        if (!normalizedConfig.channels?.email?.from_address) {
            throw new Error(fallbackMessages.emailFromAddress || '已启用邮件告警，请先填写发件地址');
        }
        if (!providedEmailApiKey && !hasStoredEmailApiKey) {
            throw new Error(fallbackMessages.emailApiKey || '已启用邮件告警，请先填写 Email API Key，或先保存已配置的后台密钥');
        }
    }

    return normalizedSecrets;
}

async function fetchAdminWorkbenchOpsAlertSettings(headers = {}, options = {}) {
    const fetchImpl = typeof options.fetch === 'function'
        ? options.fetch
        : (typeof fetch === 'function' ? fetch.bind(window) : null);
    if (typeof fetchImpl !== 'function') {
        throw new Error('当前环境暂不支持加载站外告警配置');
    }

    const endpoint = String(options.endpoint || '/api/admin/settings/ops-alerts').trim()
        || '/api/admin/settings/ops-alerts';
    const response = await fetchImpl(endpoint, {
        method: 'GET',
        headers
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
        throw new Error(payload.message || options.errorMessage || '加载站外告警配置失败');
    }
    return payload;
}

async function submitAdminWorkbenchOpsAlertSettings(headers = {}, body = {}, options = {}) {
    const fetchImpl = typeof options.fetch === 'function'
        ? options.fetch
        : (typeof fetch === 'function' ? fetch.bind(window) : null);
    if (typeof fetchImpl !== 'function') {
        throw new Error('当前环境暂不支持保存站外告警配置');
    }

    const endpoint = String(options.endpoint || '/api/admin/settings/ops-alerts').trim()
        || '/api/admin/settings/ops-alerts';
    const requestBody = body && typeof body === 'object' && !Array.isArray(body)
        ? body
        : {};
    const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
        throw new Error(payload.message || options.errorMessage || '保存站外告警配置失败');
    }
    return payload;
}

async function deleteAdminWorkbenchOpsAlertSecret(headers = {}, secretName = '', options = {}) {
    const fetchImpl = typeof options.fetch === 'function'
        ? options.fetch
        : (typeof fetch === 'function' ? fetch.bind(window) : null);
    if (typeof fetchImpl !== 'function') {
        throw new Error('当前环境暂不支持删除站外告警密钥');
    }

    const endpoint = String(options.endpoint || '/api/admin/settings/ops-alerts').trim()
        || '/api/admin/settings/ops-alerts';
    const normalizedSecretName = String(secretName || '').trim();
    const response = await fetchImpl(endpoint, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ secretName: normalizedSecretName })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
        throw new Error(payload.message || options.errorMessage || '删除站外告警密钥失败');
    }
    return payload;
}

function normalizeAdminWorkbenchOpsAlertSettingsPayload(payload = {}, options = {}) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const normalizeConfig = typeof options.normalizeConfig === 'function'
        ? options.normalizeConfig
        : ((config) => config && typeof config === 'object' && !Array.isArray(config) ? config : {});
    const defaultSecrets = options.defaultSecrets && typeof options.defaultSecrets === 'object' && !Array.isArray(options.defaultSecrets)
        ? options.defaultSecrets
        : {};

    return {
        config: normalizeConfig(source.config),
        secrets: source.secrets && typeof source.secrets === 'object' && !Array.isArray(source.secrets)
            ? source.secrets
            : defaultSecrets
    };
}

async function fetchAdminWorkbenchOpsAlertHealth(headers = {}, options = {}) {
    const fetchImpl = typeof options.fetch === 'function'
        ? options.fetch
        : (typeof fetch === 'function' ? fetch.bind(window) : null);
    if (typeof fetchImpl !== 'function') {
        throw new Error('当前环境暂不支持加载站外告警通道健康状态');
    }

    const endpoint = String(options.endpoint || '/api/admin/settings/ops-alert-health').trim()
        || '/api/admin/settings/ops-alert-health';
    const timeoutMs = Number(options.timeoutMs || 0);
    const AbortControllerImpl = typeof options.AbortController === 'function'
        ? options.AbortController
        : (typeof AbortController === 'function' ? AbortController : null);
    const scheduleTimeout = typeof options.setTimeout === 'function'
        ? options.setTimeout
        : ((handler, delay) => window.setTimeout(handler, delay));
    const clearScheduledTimeout = typeof options.clearTimeout === 'function'
        ? options.clearTimeout
        : ((timeoutId) => window.clearTimeout(timeoutId));
    const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
    const timeoutId = controller && timeoutMs > 0
        ? scheduleTimeout(() => controller.abort(), timeoutMs)
        : 0;

    try {
        const response = await fetchImpl(endpoint, {
            method: 'GET',
            headers,
            signal: controller?.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
            throw new Error(payload.message || options.errorMessage || '加载站外告警通道健康状态失败');
        }
        return payload;
    } finally {
        if (timeoutId) {
            clearScheduledTimeout(timeoutId);
        }
    }
}

function normalizeAdminWorkbenchOpsAlertHealthPayload(payload = {}, options = {}) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const defaultSummary = options.defaultSummary && typeof options.defaultSummary === 'object' && !Array.isArray(options.defaultSummary)
        ? options.defaultSummary
        : getAdminWorkbenchDefaultOpsAlertHealthState().summary;

    return {
        fetched_at: source.fetched_at || '',
        summary: {
            ...defaultSummary,
            ...(source.summary && typeof source.summary === 'object' && !Array.isArray(source.summary)
                ? source.summary
                : {})
        },
        channels: Array.isArray(source.channels) ? source.channels : [],
        message: ''
    };
}

function normalizeAdminWorkbenchOpsAlertMonitorShiftReport(report = {}, options = {}) {
    const defaults = options.defaultReport && typeof options.defaultReport === 'object' && !Array.isArray(options.defaultReport)
        ? options.defaultReport
        : getAdminWorkbenchDefaultOpsAlertMonitorShiftReport();
    const source = report && typeof report === 'object' && !Array.isArray(report) ? report : {};
    return {
        ...defaults,
        ...source,
        totals: {
            ...(defaults.totals && typeof defaults.totals === 'object' && !Array.isArray(defaults.totals) ? defaults.totals : {}),
            ...(source.totals && typeof source.totals === 'object' && !Array.isArray(source.totals) ? source.totals : {})
        },
        close_reasons: Array.isArray(source.close_reasons) ? source.close_reasons : [],
        admin_stats: Array.isArray(source.admin_stats) ? source.admin_stats : [],
        categories: Array.isArray(source.categories) ? source.categories : [],
        trend: Array.isArray(source.trend) ? source.trend : []
    };
}

function normalizeAdminWorkbenchOpsAlertMonitorShiftReportView(value = 'all', options = {}) {
    const viewDefinitions = Array.isArray(options.viewDefinitions) ? options.viewDefinitions : [];
    const fallbackView = String(options.defaultView || 'all').trim().toLowerCase() || 'all';
    const normalizedValue = String(value || '').trim().toLowerCase();
    return viewDefinitions.some((item) => String(item?.key || '').trim().toLowerCase() === normalizedValue)
        ? normalizedValue
        : fallbackView;
}

function getAdminWorkbenchOpsAlertMonitorShiftReportViewMeta(value = 'all', options = {}) {
    const viewDefinitions = Array.isArray(options.viewDefinitions) ? options.viewDefinitions : [];
    const normalizedValue = normalizeAdminWorkbenchOpsAlertMonitorShiftReportView(value, options);
    return viewDefinitions.find((item) => String(item?.key || '').trim().toLowerCase() === normalizedValue)
        || viewDefinitions[0]
        || { key: normalizedValue, label: normalizedValue || '全部视角', sections: [] };
}

function getAdminWorkbenchOpsAlertMonitorShiftReportVisibleSections(value = 'all', options = {}) {
    return new Set(getAdminWorkbenchOpsAlertMonitorShiftReportViewMeta(value, options).sections || []);
}

function getAdminWorkbenchOpsAlertMonitorShiftReportCurrentAdminStat(report = {}, currentAdminId = '') {
    const normalizedReport = normalizeAdminWorkbenchOpsAlertMonitorShiftReport(report);
    const normalizedCurrentAdminId = String(currentAdminId || '').trim();
    const adminItems = Array.isArray(normalizedReport.admin_stats) ? normalizedReport.admin_stats : [];

    return adminItems.find((item) => normalizedCurrentAdminId && String(item?.admin_id || '').trim() === normalizedCurrentAdminId)
        || adminItems.find((item) => item?.is_current === true)
        || null;
}

function buildAdminWorkbenchOpsAlertMonitorShiftTrendState(report = {}, options = {}) {
    const normalizedReport = normalizeAdminWorkbenchOpsAlertMonitorShiftReport(report, options);
    const trend = Array.isArray(normalizedReport.trend) ? normalizedReport.trend : [];
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Math.max(0, Number(value || 0))));
    const formatTimeShort = typeof options.formatTimeShort === 'function'
        ? options.formatTimeShort
        : ((value) => String(value || '—'));
    const bucketHours = Math.max(1, Number(normalizedReport.bucket_hours || 0));
    const maxBacklog = Math.max(1, ...trend.map((entry) => Number(entry?.backlog_count || 0)));

    return {
        bucketHours,
        footerText: `按 ${formatCount(bucketHours)} 小时时间桶回看本班积压走势。`,
        emptyMessage: '本班还没有形成可展示的积压变化。',
        items: trend.map((entry) => {
            const backlogCount = Math.max(0, Number(entry?.backlog_count || 0));
            const claimedCount = Math.max(0, Number(entry?.claimed_count || 0));
            const assignedCount = Math.max(0, Number(entry?.assigned_count || 0));
            const resolvedCount = Math.max(0, Number(entry?.resolved_count || 0));
            const metaParts = [];
            if (claimedCount > 0) metaParts.push(`认领 ${formatCount(claimedCount)}`);
            if (assignedCount > 0) metaParts.push(`转交 ${formatCount(assignedCount)}`);
            if (resolvedCount > 0) metaParts.push(`关闭 ${formatCount(resolvedCount)}`);

            return {
                backlogText: formatCount(backlogCount),
                heightPercent: Math.max(16, Math.round((backlogCount / maxBacklog) * 100)),
                labelText: formatTimeShort(entry?.bucket_end),
                metaText: metaParts.join(' · ') || '无动作'
            };
        })
    };
}

function buildAdminWorkbenchOpsAlertMonitorShiftShellState(status = 'loading', options = {}) {
    const normalizedStatus = String(status || 'loading').trim().toLowerCase();
    const isError = normalizedStatus === 'error';
    const summaryText = String(options.message || '').trim();

    return {
        status: isError ? 'error' : 'loading',
        eyebrow: '本班处理统计 / 交班视图',
        title: isError ? '交班报表加载失败' : '正在汇总认领、转交、关闭和积压趋势...',
        summary: isError
            ? (summaryText || '请刷新面板后重试。')
            : '会优先给出本班处理量、当前积压和交班时最值得说明的几块模块。',
        badges: [
            {
                label: isError ? '加载失败' : '等待加载',
                tone: isError ? 'danger' : 'neutral'
            }
        ],
        metrics: isError ? [] : [
            { label: '本班认领', value: '—', detail: '等待更多上下文', tone: 'neutral' },
            { label: '转交 / 接手', value: '—', detail: '等待更多上下文', tone: 'neutral' },
            { label: '本班关闭', value: '—', detail: '等待更多上下文', tone: 'neutral' },
            { label: '平均闭环', value: '—', detail: '等待更多上下文', tone: 'neutral' },
            { label: '当前积压', value: '—', detail: '等待更多上下文', tone: 'neutral' },
            { label: '最长等待', value: '—', detail: '等待更多上下文', tone: 'neutral' }
        ]
    };
}

function buildAdminWorkbenchOpsAlertMonitorShiftViewSwitchState(currentView = 'all', options = {}) {
    const normalizedView = normalizeAdminWorkbenchOpsAlertMonitorShiftReportView(currentView, options);
    const viewMeta = getAdminWorkbenchOpsAlertMonitorShiftReportViewMeta(normalizedView, options);
    const viewDefinitions = Array.isArray(options.viewDefinitions) ? options.viewDefinitions : [];

    return {
        label: '交班视角',
        currentView: normalizedView,
        summaryText: String(viewMeta?.description || '').trim(),
        chips: viewDefinitions.map((item) => {
            const key = String(item?.key || '').trim().toLowerCase();
            return {
                key,
                label: String(item?.label || item?.key || '').trim() || key,
                active: key === normalizedView
            };
        })
    };
}

function buildAdminWorkbenchOpsAlertMonitorShiftReportState(report = {}, state = {}, options = {}) {
    const normalizedReport = normalizeAdminWorkbenchOpsAlertMonitorShiftReport(report, options);
    const totals = normalizedReport.totals || getAdminWorkbenchDefaultOpsAlertMonitorShiftReport().totals;
    const currentView = normalizeAdminWorkbenchOpsAlertMonitorShiftReportView(state.currentView || '', options);
    const viewMeta = getAdminWorkbenchOpsAlertMonitorShiftReportViewMeta(currentView, options);
    const currentAdminId = String(state.currentAdminId || '').trim();
    const currentAdminLabel = String(state.currentAdminLabel || '').trim();
    const currentAdminStat = getAdminWorkbenchOpsAlertMonitorShiftReportCurrentAdminStat(normalizedReport, currentAdminId);
    const shiftHours = Math.max(1, Number(normalizedReport.shift_hours || 0));
    const backlogDelta = Number(totals.backlog_delta || 0);
    const getBacklogDeltaTone = typeof options.getBacklogDeltaTone === 'function'
        ? options.getBacklogDeltaTone
        : ((delta) => {
            const numericDelta = Number(delta || 0);
            if (numericDelta < 0) return 'success';
            if (numericDelta > 0) return 'warning';
            return 'neutral';
        });
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Number(value || 0)));
    const formatMinutes = typeof options.formatMinutes === 'function'
        ? options.formatMinutes
        : ((value) => String(value || '—'));
    const formatSignedCount = typeof options.formatSignedCount === 'function'
        ? options.formatSignedCount
        : ((value) => String(value || 0));
    const ownedCategoryItems = Array.isArray(state.ownedCategoryItems) ? state.ownedCategoryItems : [];
    const categoryItems = currentView === 'mine'
        ? ownedCategoryItems
        : (Array.isArray(normalizedReport.categories) ? normalizedReport.categories : []);
    const closeReasons = Array.isArray(normalizedReport.close_reasons) ? normalizedReport.close_reasons : [];
    const mineLabel = currentAdminLabel || currentAdminStat?.label || '当前值班';
    const mineActiveCount = Number(currentAdminStat?.active_count || 0);
    const mineCriticalCount = Number(currentAdminStat?.critical_active_count || 0);
    const mineClaimedCount = Number(currentAdminStat?.claimed_count || 0);
    const mineAssignedCount = Number(currentAdminStat?.assigned_count || 0);
    const mineResolvedCount = Number(currentAdminStat?.resolved_count || 0);
    const mineAvgResolutionMinutes = currentAdminStat?.avg_resolution_minutes != null
        ? Number(currentAdminStat.avg_resolution_minutes || 0)
        : null;
    const backlogDeltaTone = getBacklogDeltaTone(backlogDelta);

    const headline = currentView === 'mine'
        ? (
            mineActiveCount > 0
                ? `${mineLabel} 当前名下有 ${formatCount(mineActiveCount)} 条处理中告警，覆盖 ${formatCount(categoryItems.length)} 个模块。`
                : `${mineLabel} 当前名下没有处理中告警，可优先接手待认领积压。`
        )
        : (
            Number(totals.claimed_count || 0) > 0
            || Number(totals.assigned_count || 0) > 0
            || Number(totals.resolved_count || 0) > 0
        )
            ? `近 ${formatCount(shiftHours)} 小时共认领 ${formatCount(totals.claimed_count || 0)}、转交 ${formatCount(totals.assigned_count || 0)}、关闭 ${formatCount(totals.resolved_count || 0)} 条告警。`
            : `近 ${formatCount(shiftHours)} 小时还没有新的认领、转交或关闭动作。`;
    const summary = currentView === 'mine'
        ? `本班你认领 ${formatCount(mineClaimedCount)}、接手 ${formatCount(mineAssignedCount)}、关闭 ${formatCount(mineResolvedCount)} 条告警${mineAvgResolutionMinutes != null ? `，平均闭环 ${formatMinutes(mineAvgResolutionMinutes)}` : ''}；当前名下 ${formatCount(mineCriticalCount)} 条 critical。`
        : `当前仍有 ${formatCount(totals.active_backlog_count || 0)} 条积压，较开班 ${formatSignedCount(backlogDelta)}；其中 ${formatCount(totals.active_claimed_count || 0)} 条已有人跟进，${formatCount(totals.active_pending_count || 0)} 条待认领。`;

    const metrics = currentView === 'mine' ? [
        {
            label: '我名下处理中',
            value: formatCount(mineActiveCount),
            detail: categoryItems.length > 0
                ? `覆盖 ${formatCount(categoryItems.length)} 个模块`
                : '当前没有名下积压',
            tone: mineActiveCount > 0 ? 'warning' : 'neutral'
        },
        {
            label: '我名下 critical',
            value: formatCount(mineCriticalCount),
            detail: mineCriticalCount > 0 ? '优先处理高优先级积压' : '当前没有 critical 积压',
            tone: mineCriticalCount > 0 ? 'danger' : 'neutral'
        },
        {
            label: '本班认领',
            value: formatCount(mineClaimedCount),
            detail: '本班你主动接手的告警',
            tone: 'neutral'
        },
        {
            label: '转交 / 接手',
            value: formatCount(mineAssignedCount),
            detail: '本班由你接手的告警',
            tone: mineAssignedCount > 0 ? 'warning' : 'neutral'
        },
        {
            label: '本班关闭',
            value: formatCount(mineResolvedCount),
            detail: mineResolvedCount > 0 ? '你本班完成闭环的告警' : '本班还没有关闭记录',
            tone: mineResolvedCount > 0 ? 'success' : 'neutral'
        },
        {
            label: '我的平均闭环',
            value: mineAvgResolutionMinutes != null ? formatMinutes(mineAvgResolutionMinutes) : '—',
            detail: mineResolvedCount > 0 ? `基于 ${formatCount(mineResolvedCount)} 条已关闭告警` : '等待更多关闭样本',
            tone: mineAvgResolutionMinutes != null ? 'success' : 'neutral'
        }
    ] : [
        {
            label: '本班认领',
            value: formatCount(totals.claimed_count || 0),
            detail: Number(totals.note_count || 0) > 0
                ? `另有 ${formatCount(totals.note_count || 0)} 条备注更新`
                : '本班新接手告警数',
            tone: 'neutral'
        },
        {
            label: '转交 / 接手',
            value: formatCount(totals.assigned_count || 0),
            detail: Number(totals.reopened_count || 0) > 0
                ? `重新打开 ${formatCount(totals.reopened_count || 0)} 条`
                : '跨人交接次数',
            tone: Number(totals.assigned_count || 0) > 0 ? 'warning' : 'neutral'
        },
        {
            label: '本班关闭',
            value: formatCount(totals.resolved_count || 0),
            detail: closeReasons.length
                ? `关闭原因已归类 ${formatCount(closeReasons.length)} 项`
                : '本班还没有关闭记录',
            tone: Number(totals.resolved_count || 0) > 0 ? 'success' : 'neutral'
        },
        {
            label: '平均闭环',
            value: totals.avg_resolution_minutes != null
                ? formatMinutes(totals.avg_resolution_minutes)
                : '—',
            detail: Number(totals.resolved_count || 0) > 0
                ? `基于 ${formatCount(totals.resolved_count || 0)} 条已关闭告警`
                : '等待更多关闭样本',
            tone: totals.avg_resolution_minutes != null ? 'success' : 'neutral'
        },
        {
            label: '当前积压',
            value: formatCount(totals.active_backlog_count || 0),
            detail: `较开班 ${formatSignedCount(backlogDelta)}`,
            tone: backlogDeltaTone
        },
        {
            label: '最长等待',
            value: totals.longest_waiting_minutes != null
                ? formatMinutes(totals.longest_waiting_minutes)
                : '—',
            detail: totals.longest_waiting_minutes != null
                ? '当前未关闭告警中等待最久的一条'
                : '当前没有待处理积压',
            tone: totals.longest_waiting_minutes != null && Number(totals.longest_waiting_minutes || 0) >= 180
                ? 'warning'
                : 'neutral'
        }
    ];

    const headerBadges = currentView === 'mine'
        ? [
            { label: `班次 ${formatCount(shiftHours)} 小时`, tone: 'neutral' },
            currentAdminLabel ? { label: `当前值班 ${currentAdminLabel}`, tone: 'neutral' } : null,
            { label: `我名下 ${formatCount(mineActiveCount)}`, tone: mineActiveCount > 0 ? 'warning' : 'neutral' },
            mineCriticalCount > 0 ? { label: `${formatCount(mineCriticalCount)} critical`, tone: 'danger' } : null
        ].filter(Boolean)
        : [
            { label: `班次 ${formatCount(shiftHours)} 小时`, tone: 'neutral' },
            {
                label: `当前积压 ${formatCount(totals.active_backlog_count || 0)}`,
                tone: Number(totals.active_backlog_count || 0) > 0 ? 'warning' : 'neutral'
            },
            { label: `较开班 ${formatSignedCount(backlogDelta)}`, tone: backlogDeltaTone },
            currentAdminLabel ? { label: `当前值班 ${currentAdminLabel}`, tone: 'neutral' } : null
        ].filter(Boolean);

    return {
        currentView,
        viewMeta: {
            key: String(viewMeta?.key || currentView || '').trim(),
            label: String(viewMeta?.label || currentView || '全部视角').trim(),
            description: String(viewMeta?.description || '').trim()
        },
        headline,
        summary,
        headerBadges,
        metrics,
        panelTitles: {
            categories: currentView === 'mine' ? '我名下积压模块' : currentView === 'handoff' ? '交接优先模块' : '当前积压模块',
            admins: currentView === 'mine' ? '我的处理量' : currentView === 'review' ? '人员处理产出' : '人员工作量',
            trend: currentView === 'review' ? '本班积压变化' : '积压趋势',
            closeReasons: String(viewMeta?.key || '').trim() === 'review' ? '闭环原因分布' : '关闭原因分布'
        }
    };
}

function buildAdminWorkbenchOpsAlertMonitorShiftPanelStates(report = {}, state = {}, options = {}) {
    const normalizedReport = normalizeAdminWorkbenchOpsAlertMonitorShiftReport(report, options);
    const reportState = buildAdminWorkbenchOpsAlertMonitorShiftReportState(normalizedReport, state, options);
    const currentView = reportState.currentView;
    const visibleSections = getAdminWorkbenchOpsAlertMonitorShiftReportVisibleSections(currentView, options);
    const currentAdminId = String(state.currentAdminId || '').trim();
    const currentAdminStat = getAdminWorkbenchOpsAlertMonitorShiftReportCurrentAdminStat(normalizedReport, currentAdminId);
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Number(value || 0)));
    const formatMinutes = typeof options.formatMinutes === 'function'
        ? options.formatMinutes
        : ((value) => String(value || '—'));
    const categoryItems = currentView === 'mine'
        ? (Array.isArray(state.ownedCategoryItems) ? state.ownedCategoryItems : [])
        : (Array.isArray(normalizedReport.categories) ? normalizedReport.categories : []);
    const adminItems = currentView === 'mine'
        ? (currentAdminStat ? [currentAdminStat] : [])
        : (Array.isArray(normalizedReport.admin_stats) ? normalizedReport.admin_stats : []);
    const closeReasons = Array.isArray(normalizedReport.close_reasons) ? normalizedReport.close_reasons : [];

    return {
        currentView,
        visibleSections: Array.from(visibleSections),
        sections: {
            categories: {
                visible: visibleSections.has('categories'),
                title: reportState.panelTitles.categories,
                emptyMessage: currentView === 'mine'
                    ? '当前没有分配到你名下的积压模块。'
                    : '当前没有需要交接的积压模块。',
                items: categoryItems.map((category) => ({
                    title: category.label || category.key || '告警模块',
                    meta: `积压 ${formatCount(category.backlog_count || 0)} · 待认领 ${formatCount(category.pending_count || 0)} · 处理中 ${formatCount(category.claimed_count || 0)}${Number(category.critical_count || 0) > 0 ? ` · critical ${formatCount(category.critical_count || 0)}` : ''}`,
                    badges: [
                        Number(category.critical_count || 0) > 0
                            ? { label: `${formatCount(category.critical_count || 0)} critical`, tone: 'danger' }
                            : null,
                        {
                            label: `${formatCount(category.backlog_count || 0)} 积压`,
                            tone: Number(category.pending_count || 0) > 0 ? 'warning' : 'neutral'
                        }
                    ].filter(Boolean)
                }))
            },
            admins: {
                visible: visibleSections.has('admins'),
                title: reportState.panelTitles.admins,
                emptyMessage: currentView === 'mine'
                    ? '当前还没有归属到你名下的处理动作。'
                    : '本班还没有可归因到负责人的处理动作。',
                items: adminItems.map((admin) => ({
                    title: admin.label || '未指定负责人',
                    meta: `认领 ${formatCount(admin.claimed_count || 0)} · 接手 ${formatCount(admin.assigned_count || 0)} · 关闭 ${formatCount(admin.resolved_count || 0)} · 手上 ${formatCount(admin.active_count || 0)}${admin.avg_resolution_minutes != null ? ` · 平均 ${formatMinutes(admin.avg_resolution_minutes)}` : ''}`,
                    badges: [
                        admin.is_current ? { label: '当前值班', tone: 'neutral' } : null,
                        Number(admin.critical_active_count || 0) > 0
                            ? { label: `${formatCount(admin.critical_active_count || 0)} critical`, tone: 'danger' }
                            : null
                    ].filter(Boolean)
                }))
            },
            trend: {
                visible: visibleSections.has('trend'),
                title: reportState.panelTitles.trend,
                wide: true
            },
            closeReasons: {
                visible: visibleSections.has('close_reasons'),
                title: reportState.panelTitles.closeReasons,
                emptyMessage: '本班还没有可归类的关闭原因。',
                items: closeReasons.map((reason) => ({
                    title: reason.label || '其他关闭原因',
                    meta: `本班关闭 ${formatCount(reason.count || 0)} 条`,
                    badges: [
                        {
                            label: `${formatCount(reason.count || 0)} 条`,
                            tone: Number(reason.count || 0) > 0 ? 'success' : 'neutral'
                        }
                    ]
                }))
            }
        }
    };
}

function buildAdminWorkbenchOpsAlertMonitorShiftReportSummaryText(report = {}, state = {}, options = {}) {
    const formatDateTime = typeof options.formatDateTime === 'function'
        ? options.formatDateTime
        : ((value) => String(value || '').trim() || '—');
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(Number(value || 0)));
    const formatMinutes = typeof options.formatMinutes === 'function'
        ? options.formatMinutes
        : ((value) => String(value || '—'));
    const formatSignedCount = typeof options.formatSignedCount === 'function'
        ? options.formatSignedCount
        : ((value) => String(value || 0));
    const formatTimeShort = typeof options.formatTimeShort === 'function'
        ? options.formatTimeShort
        : ((value) => String(value || '').trim() || '—');
    const normalizedReport = normalizeAdminWorkbenchOpsAlertMonitorShiftReport(report, options);
    const totals = normalizedReport.totals || getAdminWorkbenchDefaultOpsAlertMonitorShiftReport().totals;
    const currentView = normalizeAdminWorkbenchOpsAlertMonitorShiftReportView(state.currentView || '', options);
    const viewMeta = getAdminWorkbenchOpsAlertMonitorShiftReportViewMeta(currentView, options);
    const visibleSections = getAdminWorkbenchOpsAlertMonitorShiftReportVisibleSections(currentView, options);
    const currentAdminId = String(state.currentAdminId || '').trim();
    const currentAdminLabel = String(state.currentAdminLabel || '').trim();
    const currentAdminStat = getAdminWorkbenchOpsAlertMonitorShiftReportCurrentAdminStat(normalizedReport, currentAdminId);
    const shiftHours = Math.max(1, Number(normalizedReport.shift_hours || 0));
    const backlogDelta = Number(totals.backlog_delta || 0);
    const categoryItems = currentView === 'mine'
        ? (Array.isArray(state.ownedCategoryItems) ? state.ownedCategoryItems : [])
        : (Array.isArray(normalizedReport.categories) ? normalizedReport.categories : []);
    const adminItems = currentView === 'mine'
        ? (currentAdminStat ? [currentAdminStat] : [])
        : (Array.isArray(normalizedReport.admin_stats) ? normalizedReport.admin_stats : []);
    const closeReasons = Array.isArray(normalizedReport.close_reasons) ? normalizedReport.close_reasons : [];
    const trend = Array.isArray(normalizedReport.trend) ? normalizedReport.trend : [];
    const mineActiveCount = Number(currentAdminStat?.active_count || 0);
    const mineCriticalCount = Number(currentAdminStat?.critical_active_count || 0);
    const mineClaimedCount = Number(currentAdminStat?.claimed_count || 0);
    const mineAssignedCount = Number(currentAdminStat?.assigned_count || 0);
    const mineResolvedCount = Number(currentAdminStat?.resolved_count || 0);
    const mineAvgResolutionMinutes = currentAdminStat?.avg_resolution_minutes != null
        ? Number(currentAdminStat.avg_resolution_minutes || 0)
        : null;
    const windowLabel = normalizedReport.window_start || normalizedReport.window_end
        ? `${formatDateTime(normalizedReport.window_start)} 至 ${formatDateTime(normalizedReport.window_end)}`
        : '';
    const generatedAt = String(state.generatedAt || options.now || new Date().toISOString()).trim();
    const lines = [
        '第一阶段集中告警交班摘要',
        `生成时间：${formatDateTime(generatedAt)}`
    ];

    if (windowLabel) {
        lines.push(`班次区间：${windowLabel}`);
    }

    lines.push(`班次时长：${formatCount(shiftHours)} 小时`);
    lines.push(`交班视角：${viewMeta.label || currentView || '全部视角'}`);

    if (currentAdminLabel) {
        lines.push(`当前值班：${currentAdminLabel}`);
    }

    lines.push(
        '',
        `${currentView === 'mine' ? '我的概况' : '本班概况'}：`,
        currentView === 'mine'
            ? `你本班认领 ${formatCount(mineClaimedCount)}，接手 ${formatCount(mineAssignedCount)}，关闭 ${formatCount(mineResolvedCount)}。`
            : `认领 ${formatCount(totals.claimed_count || 0)}，转交 ${formatCount(totals.assigned_count || 0)}，关闭 ${formatCount(totals.resolved_count || 0)}，备注更新 ${formatCount(totals.note_count || 0)}。`,
        currentView === 'mine'
            ? `当前名下积压 ${formatCount(mineActiveCount)}，其中 critical ${formatCount(mineCriticalCount)}；覆盖 ${formatCount(categoryItems.length)} 个模块。`
            : `当前积压 ${formatCount(totals.active_backlog_count || 0)}，较开班 ${formatSignedCount(backlogDelta)}；已跟进 ${formatCount(totals.active_claimed_count || 0)}，待认领 ${formatCount(totals.active_pending_count || 0)}。`,
        currentView === 'mine'
            ? `我的平均闭环 ${mineAvgResolutionMinutes != null ? formatMinutes(mineAvgResolutionMinutes) : '暂无样本'}。`
            : `平均闭环 ${totals.avg_resolution_minutes != null ? formatMinutes(totals.avg_resolution_minutes) : '暂无样本'}；最长等待 ${totals.longest_waiting_minutes != null ? formatMinutes(totals.longest_waiting_minutes) : '暂无积压'}。`,
        ''
    );

    if (visibleSections.has('categories')) {
        lines.push(currentView === 'mine' ? '我名下积压模块：' : '重点积压模块：');
        if (categoryItems.length) {
            categoryItems.forEach((category, index) => {
                const label = category.label || category.key || `模块 ${index + 1}`;
                lines.push(
                    `${index + 1}. ${label}：积压 ${formatCount(category.backlog_count || 0)}，待认领 ${formatCount(category.pending_count || 0)}，处理中 ${formatCount(category.claimed_count || 0)}${Number(category.critical_count || 0) > 0 ? `，critical ${formatCount(category.critical_count || 0)}` : ''}`
                );
            });
        } else {
            lines.push(currentView === 'mine' ? '1. 当前没有分配到你名下的积压模块。' : '1. 当前没有需要重点交接的积压模块。');
        }
        lines.push('');
    }

    if (visibleSections.has('admins')) {
        lines.push(`${currentView === 'mine' ? '我的处理量' : currentView === 'review' ? '人员处理产出' : '人员工作量'}：`);
        if (adminItems.length) {
            adminItems.forEach((admin, index) => {
                const label = admin.label || '未指定负责人';
                lines.push(
                    `${index + 1}. ${label}：认领 ${formatCount(admin.claimed_count || 0)}，接手 ${formatCount(admin.assigned_count || 0)}，关闭 ${formatCount(admin.resolved_count || 0)}，手上 ${formatCount(admin.active_count || 0)}${admin.avg_resolution_minutes != null ? `，平均 ${formatMinutes(admin.avg_resolution_minutes)}` : ''}${admin.is_current ? '，当前值班' : ''}`
                );
            });
        } else {
            lines.push(currentView === 'mine' ? '1. 当前还没有归属到你名下的处理动作。' : '1. 本班还没有可归因到负责人的处理动作。');
        }
        lines.push('');
    }

    if (visibleSections.has('close_reasons')) {
        lines.push(`${currentView === 'review' ? '闭环原因' : '关闭原因'}：`);
        if (closeReasons.length) {
            closeReasons.forEach((reason, index) => {
                lines.push(`${index + 1}. ${reason.label || '其他关闭原因'}：${formatCount(reason.count || 0)} 条`);
            });
        } else {
            lines.push('1. 本班还没有可归类的关闭原因。');
        }
        lines.push('');
    }

    if (visibleSections.has('trend')) {
        lines.push(`${currentView === 'review' ? '本班积压变化' : '积压趋势'}：`);
        if (trend.length) {
            trend.forEach((entry, index) => {
                lines.push(
                    `${index + 1}. ${formatTimeShort(entry.bucket_end)}：积压 ${formatCount(entry.backlog_count || 0)}，认领 ${formatCount(entry.claimed_count || 0)}，转交 ${formatCount(entry.assigned_count || 0)}，关闭 ${formatCount(entry.resolved_count || 0)}`
                );
            });
        } else {
            lines.push('1. 本班还没有形成可展示的积压变化。');
        }
    }

    return lines.join('\n');
}

function buildAdminWorkbenchOpsAlertMonitorShiftReportCsvRows(report = {}, state = {}, options = {}) {
    const normalizedReport = normalizeAdminWorkbenchOpsAlertMonitorShiftReport(report, options);
    const totals = normalizedReport.totals || getAdminWorkbenchDefaultOpsAlertMonitorShiftReport().totals;
    const currentView = normalizeAdminWorkbenchOpsAlertMonitorShiftReportView(state.currentView || '', options);
    const viewMeta = getAdminWorkbenchOpsAlertMonitorShiftReportViewMeta(currentView, options);
    const visibleSections = getAdminWorkbenchOpsAlertMonitorShiftReportVisibleSections(currentView, options);
    const currentAdminId = String(state.currentAdminId || '').trim();
    const currentAdminLabel = String(state.currentAdminLabel || '').trim();
    const currentAdminStat = getAdminWorkbenchOpsAlertMonitorShiftReportCurrentAdminStat(normalizedReport, currentAdminId);
    const shiftHours = Math.max(1, Number(normalizedReport.shift_hours || 0));
    const formatTimeShort = typeof options.formatTimeShort === 'function'
        ? options.formatTimeShort
        : ((value) => String(value || '').trim() || '—');
    const rows = [{
        section: 'summary',
        item: '班次概览',
        current_admin: currentAdminLabel || '',
        view_mode: currentView,
        view_label: viewMeta.label || '',
        shift_hours: shiftHours,
        bucket_hours: Math.max(1, Number(normalizedReport.bucket_hours || 0)),
        window_start: normalizedReport.window_start || '',
        window_end: normalizedReport.window_end || '',
        claimed_count: Number(totals.claimed_count || 0),
        assigned_count: Number(totals.assigned_count || 0),
        resolved_count: Number(totals.resolved_count || 0),
        note_count: Number(totals.note_count || 0),
        reopened_count: Number(totals.reopened_count || 0),
        avg_resolution_minutes: totals.avg_resolution_minutes != null ? Number(totals.avg_resolution_minutes || 0) : '',
        active_backlog_count: Number(totals.active_backlog_count || 0),
        active_claimed_count: Number(totals.active_claimed_count || 0),
        active_pending_count: Number(totals.active_pending_count || 0),
        previous_backlog_count: Number(totals.previous_backlog_count || 0),
        backlog_delta: Number(totals.backlog_delta || 0),
        longest_waiting_minutes: totals.longest_waiting_minutes != null ? Number(totals.longest_waiting_minutes || 0) : '',
        current_admin_active_count: Number(currentAdminStat?.active_count || 0),
        current_admin_critical_active_count: Number(currentAdminStat?.critical_active_count || 0),
        current_admin_claimed_count: Number(currentAdminStat?.claimed_count || 0),
        current_admin_assigned_count: Number(currentAdminStat?.assigned_count || 0),
        current_admin_resolved_count: Number(currentAdminStat?.resolved_count || 0),
        current_admin_avg_resolution_minutes: currentAdminStat?.avg_resolution_minutes != null ? Number(currentAdminStat.avg_resolution_minutes || 0) : ''
    }];

    if (visibleSections.has('categories')) {
        const categoryItems = currentView === 'mine'
            ? (Array.isArray(state.ownedCategoryItems) ? state.ownedCategoryItems : [])
            : (Array.isArray(normalizedReport.categories) ? normalizedReport.categories : []);
        categoryItems.forEach((category) => {
            rows.push({
                section: 'categories',
                item: category.label || category.key || '告警模块',
                category_key: category.key || '',
                backlog_count: Number(category.backlog_count || 0),
                pending_count: Number(category.pending_count || 0),
                claimed_count: Number(category.claimed_count || 0),
                critical_count: Number(category.critical_count || 0)
            });
        });
    }

    if (visibleSections.has('admins')) {
        const adminItems = currentView === 'mine'
            ? (currentAdminStat ? [currentAdminStat] : [])
            : (Array.isArray(normalizedReport.admin_stats) ? normalizedReport.admin_stats : []);
        adminItems.forEach((admin) => {
            rows.push({
                section: 'admins',
                item: admin.label || '未指定负责人',
                admin_id: admin.admin_id || '',
                is_current: admin.is_current === true,
                claimed_count: Number(admin.claimed_count || 0),
                assigned_count: Number(admin.assigned_count || 0),
                resolved_count: Number(admin.resolved_count || 0),
                active_count: Number(admin.active_count || 0),
                critical_active_count: Number(admin.critical_active_count || 0),
                avg_resolution_minutes: admin.avg_resolution_minutes != null ? Number(admin.avg_resolution_minutes || 0) : ''
            });
        });
    }

    if (visibleSections.has('close_reasons')) {
        (Array.isArray(normalizedReport.close_reasons) ? normalizedReport.close_reasons : []).forEach((reason) => {
            rows.push({
                section: 'close_reasons',
                item: reason.label || '其他关闭原因',
                count: Number(reason.count || 0)
            });
        });
    }

    if (visibleSections.has('trend')) {
        (Array.isArray(normalizedReport.trend) ? normalizedReport.trend : []).forEach((entry) => {
            rows.push({
                section: 'trend',
                item: formatTimeShort(entry.bucket_end),
                bucket_end: entry.bucket_end || '',
                backlog_count: Number(entry.backlog_count || 0),
                claimed_count: Number(entry.claimed_count || 0),
                assigned_count: Number(entry.assigned_count || 0),
                resolved_count: Number(entry.resolved_count || 0)
            });
        });
    }

    return rows;
}

function buildAdminWorkbenchOpsAlertMonitorShiftRenderState(report = {}, state = {}, options = {}) {
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : {};
    const currentView = normalizeAdminWorkbenchOpsAlertMonitorShiftReportView(normalizedState.currentView || '', options);
    const currentAdminId = String(normalizedState.currentAdminId || '').trim();
    const currentAdminLabel = String(normalizedState.currentAdminLabel || '').trim();
    const ownedCategoryItems = Array.isArray(normalizedState.ownedCategoryItems)
        ? normalizedState.ownedCategoryItems
        : [];
    const normalizedRuntimeState = {
        ...normalizedState,
        currentView,
        currentAdminId,
        currentAdminLabel,
        ownedCategoryItems
    };
    const actionButtons = Array.isArray(options.actionButtons) && options.actionButtons.length
        ? options.actionButtons
        : [
            {
                actionName: 'settings-copy-ops-alert-shift-report',
                icon: 'fas fa-clipboard-list',
                label: '复制交班摘要',
                variant: 'ghost'
            },
            {
                actionName: 'settings-export-ops-alert-shift-report-csv',
                icon: 'fas fa-file-export',
                label: '导出交班 CSV',
                variant: 'primary'
            }
        ];

    return {
        currentView,
        currentAdminId,
        currentAdminLabel,
        reportState: buildAdminWorkbenchOpsAlertMonitorShiftReportState(report, normalizedRuntimeState, options),
        panelStates: buildAdminWorkbenchOpsAlertMonitorShiftPanelStates(report, normalizedRuntimeState, options),
        viewSwitchState: buildAdminWorkbenchOpsAlertMonitorShiftViewSwitchState(currentView, options),
        trendState: buildAdminWorkbenchOpsAlertMonitorShiftTrendState(report, options),
        actionButtons: actionButtons.map((item) => ({
            actionName: String(item?.actionName || '').trim(),
            icon: String(item?.icon || '').trim() || 'fas fa-circle-dot',
            label: String(item?.label || '').trim() || '执行操作',
            variant: String(item?.variant || '').trim().toLowerCase() || 'primary'
        }))
    };
}

async function fetchAdminWorkbenchOpsAlertMonitor(headers = {}, options = {}) {
    const fetchImpl = typeof options.fetch === 'function'
        ? options.fetch
        : (typeof fetch === 'function' ? fetch.bind(window) : null);
    if (typeof fetchImpl !== 'function') {
        throw new Error('当前环境暂不支持加载集中告警处理面板');
    }

    const endpoint = String(options.endpoint || '/api/admin/settings/ops-alert-monitor').trim()
        || '/api/admin/settings/ops-alert-monitor';
    const timeoutMs = Number(options.timeoutMs || 0);
    const AbortControllerImpl = typeof options.AbortController === 'function'
        ? options.AbortController
        : (typeof AbortController === 'function' ? AbortController : null);
    const scheduleTimeout = typeof options.setTimeout === 'function'
        ? options.setTimeout
        : ((handler, delay) => window.setTimeout(handler, delay));
    const clearScheduledTimeout = typeof options.clearTimeout === 'function'
        ? options.clearTimeout
        : ((timeoutId) => window.clearTimeout(timeoutId));
    const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
    const timeoutId = controller && timeoutMs > 0
        ? scheduleTimeout(() => controller.abort(), timeoutMs)
        : 0;

    try {
        const response = await fetchImpl(endpoint, {
            method: 'GET',
            headers,
            signal: controller?.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
            throw new Error(payload.message || options.errorMessage || '加载集中告警处理面板失败');
        }
        return payload;
    } finally {
        if (timeoutId) {
            clearScheduledTimeout(timeoutId);
        }
    }
}

function normalizeAdminWorkbenchOpsAlertMonitorPayload(payload = {}, options = {}) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const defaultSummary = options.defaultSummary && typeof options.defaultSummary === 'object' && !Array.isArray(options.defaultSummary)
        ? options.defaultSummary
        : {};
    const normalizeShiftReport = typeof options.normalizeShiftReport === 'function'
        ? options.normalizeShiftReport
        : ((report) => report && typeof report === 'object' && !Array.isArray(report) ? report : {});

    return {
        fetched_at: source.fetched_at || '',
        summary: {
            ...defaultSummary,
            ...(source.summary && typeof source.summary === 'object' && !Array.isArray(source.summary)
                ? source.summary
                : {}),
            shift_report: normalizeShiftReport(source.summary?.shift_report)
        },
        assignable_admins: Array.isArray(source.assignable_admins) ? source.assignable_admins : [],
        current_admin_id: source.current_admin_id || '',
        current_admin_label: source.current_admin_label || '',
        categories: Array.isArray(source.categories) ? source.categories : [],
        message: ''
    };
}

function getOpsAlertCaseComposerMeta(state = {}, options = {}) {
    const normalizedAction = String(state.action || '').trim().toLowerCase();
    const normalizedContext = normalizeOpsAlertWorkspaceContext(state.context || {});
    const items = Array.isArray(state.items) ? state.items : [];
    const isBatch = String(state.mode || 'single').trim().toLowerCase() === 'batch';
    const formatCount = typeof options.formatCount === 'function'
        ? options.formatCount
        : ((value) => String(value || 0));
    const batchPreview = getOpsAlertWorkspaceBatchPreview(items, {
        fallback: options.batchPreviewFallback || '告警',
        formatCount
    });
    const targetLabel = isBatch
        ? `当前筛选命中 ${formatCount(items.length)} 条告警${items.length ? ` · ${batchPreview}` : ''}`
        : getOpsAlertWorkspaceContextLabel(normalizedContext, { fallback: options.singleFallback || '集中告警' });
    const ownerLabel = normalizedContext.caseOwnerLabel || '';

    if (normalizedAction === 'assign') {
        return {
            title: isBatch ? '批量指派集中告警负责人' : '指派集中告警负责人',
            summary: isBatch ? targetLabel : `${targetLabel}${ownerLabel ? ` · 当前负责人 ${ownerLabel}` : ''}`,
            description: isBatch
                ? '为当前筛选结果选择统一负责人；可选填写交接备注，便于值班交班和后续跟踪。'
                : '选择新的负责人；可选填写交接备注，说明背景、排查进展或下一步动作。',
            fieldLabel: '交接备注（可选）',
            placeholder: '例如：已完成首轮排查，后续由新的值班同学继续跟进。',
            submitLabel: isBatch ? '批量指派' : '保存指派'
        };
    }

    if (normalizedAction === 'resolve') {
        return {
            title: isBatch ? '批量关闭集中告警' : '关闭集中告警',
            summary: isBatch ? targetLabel : `${targetLabel}${ownerLabel ? ` · 当前负责人 ${ownerLabel}` : ''}`,
            description: isBatch
                ? '填写统一的处理结论，当前筛选下尚未关闭的告警会一并写入处置记录。'
                : '填写本次处置结论，关闭后仍可重新打开继续跟进。',
            fieldLabel: '关闭结论',
            placeholder: '例如：已完成人工复核并安排后续处理，当前无需继续外发升级。',
            submitLabel: isBatch ? '批量关闭' : '关闭告警'
        };
    }

    return {
        title: isBatch ? '批量记录集中告警备注' : '记录集中告警备注',
        summary: isBatch ? targetLabel : `${targetLabel}${ownerLabel ? ` · 当前负责人 ${ownerLabel}` : ''}`,
        description: isBatch
            ? '适合为当前筛选结果补一条统一备注，记录交接说明、排查进展或下一步动作。'
            : '适合记录调查进展、证据链接、交接说明或下一步动作。',
        fieldLabel: '备注内容',
        placeholder: '例如：已完成首轮排查，待值班同学继续跟进处理。',
        submitLabel: isBatch ? '批量保存备注' : '保存备注'
    };
}

function buildOpsAlertCaseMutationRequest(action, context = {}, options = {}) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    const normalizedContext = normalizeOpsAlertWorkspaceContext(context);
    const requestMetadata = normalizeOpsAlertCaseMutationMetadata(options.metadata);
    const items = buildOpsAlertCaseMutationItems(
        options.items || [],
        String(options.categoryKey || normalizedContext.category || '').trim().toLowerCase()
    );
    const requestBody = {
        action: normalizedAction,
        note: String(options.note || '').trim(),
        resolution: String(options.resolution || '').trim(),
        metadata: {
            alert_type: normalizedContext.alertType || '',
            category: normalizedContext.category || '',
            reference_label: normalizedContext.referenceLabel || '',
            reference_value: normalizedContext.referenceValue || '',
            signal_type: normalizedContext.signalType || '',
            title: normalizedContext.title || '',
            ...requestMetadata
        }
    };
    const ownerAdminId = String(options.ownerAdminId || options.owner_admin_id || '').trim();
    const ownerLabel = String(options.ownerLabel || options.owner_label || '').trim();

    if (items.length) {
        requestBody.items = items;
    } else {
        requestBody.category_key = normalizedContext.category || '';
        requestBody.target_id = normalizedContext.targetId;
        requestBody.alert_type = normalizedContext.alertType || '';
        requestBody.title = normalizedContext.title || '';
    }

    if (ownerAdminId) {
        requestBody.owner_admin_id = ownerAdminId;
    }
    if (ownerLabel) {
        requestBody.owner_label = ownerLabel;
    }

    return requestBody;
}

async function submitOpsAlertCaseMutationRequest(headers = {}, action, context = {}, options = {}) {
    const fetchImpl = typeof options.fetch === 'function'
        ? options.fetch
        : (typeof fetch === 'function' ? fetch.bind(window) : null);
    if (typeof fetchImpl !== 'function') {
        throw new Error('当前环境暂不支持提交集中告警操作');
    }

    const endpoint = String(options.endpoint || '/api/admin/settings/ops-alert-monitor-cases').trim()
        || '/api/admin/settings/ops-alert-monitor-cases';
    const requestBody = buildOpsAlertCaseMutationRequest(action, context, options);
    const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
        throw new Error(payload.message || options.errorMessage || '集中告警处理失败');
    }

    return payload;
}

function getShopRiskWorkspaceActionDefinition(targetId = '') {
    const normalizedTargetId = String(targetId || '').trim().toLowerCase();
    if (normalizedTargetId.startsWith('shop_order_risk:coupon:')) {
        return {
            target: 'shop-risk-discounts',
            icon: 'fas fa-ticket',
            monitorLabel: '查看优惠券码',
            ticketLabel: '优惠券码'
        };
    }
    if (normalizedTargetId.startsWith('shop_order_risk:login_signature:')) {
        return {
            target: 'shop-risk-users',
            icon: 'fas fa-user-shield',
            monitorLabel: '查看关联账号',
            ticketLabel: '用户详情'
        };
    }
    if (normalizedTargetId.startsWith('shop_order_risk:shared_ip:')) {
        return {
            target: 'shop-risk-users',
            icon: 'fas fa-user-shield',
            monitorLabel: '查看关联账号',
            ticketLabel: '用户详情'
        };
    }
    if (normalizedTargetId.startsWith('shop_order_risk:user_velocity:')) {
        return {
            target: 'shop-risk-users',
            icon: 'fas fa-user-shield',
            monitorLabel: '查看用户详情',
            ticketLabel: '用户详情'
        };
    }
    return {
        target: 'shop-risk-orders',
        icon: 'fas fa-bag-shopping',
        monitorLabel: '查看风险订单',
        ticketLabel: '风险订单'
    };
}

function getOpsAlertWorkspaceAction(context = {}, options = {}) {
    const normalizedContext = normalizeOpsAlertWorkspaceActionContext(context);
    let definition = null;

    if (
        normalizedContext.alertType === 'shop_order_risk_anomaly'
        || normalizedContext.alertType === 'shop_order_risk_recovered'
        || normalizedContext.targetId.startsWith('shop_order_risk:')
    ) {
        definition = getShopRiskWorkspaceActionDefinition(normalizedContext.targetId);
    }

    if (!definition) {
        definition = ADMIN_WORKBENCH_OPS_ALERT_ACTIONS[normalizedContext.alertType]
            || ADMIN_WORKBENCH_OPS_ALERT_CATEGORY_FALLBACKS[normalizedContext.categoryKey]
            || null;
    }

    if (!definition?.target) {
        return null;
    }

    return {
        target: String(definition.target || '').trim(),
        label: getOpsAlertWorkspaceActionLabel(definition, options.labelVariant || options.variant || 'monitor'),
        icon: String(definition.icon || '').trim()
    };
}

function buildChatSessionWorkbenchEntry(context = {}) {
    const sessionId = String(context.sessionId || context.session_id || '').trim();
    const email = String(context.email || context.userEmail || context.user_email || '').trim();
    const userId = String(context.userId || context.user_id || '').trim();
    const ticketId = String(context.ticketId || context.ticket_id || '').trim();
    const ticketStatus = String(context.ticketStatus || context.ticket_status || '').trim();
    const referenceValue = String(
        context.referenceValue
        || context.reference_value
        || sessionId
        || email
        || userId
        || ''
    ).trim();

    if (!referenceValue) {
        return null;
    }

    const referenceLabel = String(context.referenceLabel || context.reference_label || '').trim()
        || (sessionId ? '会话ID' : (email ? '邮箱' : '用户ID'));
    const targetId = String(context.targetId || context.target_id || ticketId || referenceValue).trim();

    return {
        workspaceKey: 'chat-session',
        context: {
            sessionId,
            session_id: sessionId,
            email,
            userId,
            referenceLabel,
            referenceValue,
            targetId,
            target_id: targetId,
            ticketId,
            ticketStatus
        }
    };
}

function buildShopOrderWorkbenchEntry(context = {}) {
    const orderId = String(context.orderId || context.order_id || context.id || '').trim();
    if (!orderId) {
        return null;
    }

    const referenceLabel = String(context.referenceLabel || context.reference_label || '').trim() || '订单';
    const referenceValue = String(context.referenceValue || context.reference_value || orderId).trim() || orderId;

    return {
        workspaceKey: 'shop-risk-orders',
        context: {
            orderId,
            targetId: orderId,
            target_id: orderId,
            referenceLabel,
            referenceValue
        }
    };
}

function buildUserWorkbenchEntry(context = {}) {
    const userId = String(context.userId || context.user_id || '').trim();
    const email = String(context.email || context.userEmail || context.user_email || '').trim();
    const referenceValue = String(
        context.referenceValue
        || context.reference_value
        || userId
        || email
        || ''
    ).trim();
    const searchValue = userId || email || referenceValue;
    if (!searchValue) {
        return null;
    }

    const referenceLabel = String(context.referenceLabel || context.reference_label || '').trim()
        || (userId ? '用户' : '邮箱');
    const defaultTab = String(context.defaultTab || context.default_tab || context.tab || '').trim();
    const tab = String(context.tab || defaultTab).trim();
    const paymentOrderId = String(context.paymentOrderId || context.payment_order_id || '').trim();

    return {
        workspaceKey: 'shop-risk-users',
        context: {
            userId,
            email,
            paymentOrderId,
            targetId: searchValue,
            target_id: searchValue,
            referenceLabel,
            referenceValue: referenceValue || searchValue,
            defaultTab,
            tab
        }
    };
}

function buildTicketQueueWorkbenchEntry(context = {}) {
    const ticketId = String(context.ticketId || context.ticket_id || context.id || '').trim();
    if (!ticketId) {
        return null;
    }

    const ticketStatus = String(context.ticketStatus || context.ticket_status || context.status || '').trim().toLowerCase();
    const workspaceKey = String(context.workspaceKey || context.workspace_key || '').trim().toLowerCase()
        || (ticketStatus === 'resolved' ? 'tickets-resolved' : 'tickets-pending');
    const referenceLabel = String(context.referenceLabel || context.reference_label || '').trim() || '工单号';
    const referenceValue = String(context.referenceValue || context.reference_value || ticketId).trim() || ticketId;

    return {
        workspaceKey,
        context: {
            ticketId,
            ticketStatus,
            targetId: ticketId,
            target_id: ticketId,
            referenceLabel,
            referenceValue
        }
    };
}

function buildPaymentWorkbenchEntry(context = {}) {
    const paymentOrderId = String(context.paymentOrderId || context.payment_order_id || context.id || '').trim();
    const paymentLabel = String(context.packageName || context.package_name || '').trim();
    const userId = String(context.userId || context.user_id || '').trim();
    const email = String(context.email || context.userEmail || context.user_email || '').trim();

    if (userId || email) {
        return buildUserWorkbenchEntry({
            ...context,
            userId,
            email,
            paymentOrderId,
            defaultTab: 'payments',
            tab: 'payments',
            referenceLabel: context.referenceLabel || context.reference_label || (userId ? '支付单' : '邮箱'),
            referenceValue: context.referenceValue
                || context.reference_value
                || (userId ? (paymentOrderId || paymentLabel || '最近充值') : email)
        });
    }

    if (!paymentOrderId && !paymentLabel) {
        return null;
    }

    const referenceLabel = String(context.referenceLabel || context.reference_label || '').trim()
        || (paymentOrderId ? '支付单' : '充值');
    const referenceValue = String(
        context.referenceValue
        || context.reference_value
        || paymentOrderId
        || paymentLabel
        || '最近充值'
    ).trim();
    const targetId = String(context.targetId || context.target_id || paymentOrderId || '').trim() || referenceValue;

    return {
        workspaceKey: 'payments-overview',
        context: {
            paymentOrderId,
            targetId,
            target_id: targetId,
            referenceLabel,
            referenceValue
        }
    };
}

function buildVerifyWorkbenchEntry(context = {}) {
    const verificationId = String(context.verificationId || context.verification_id || '').trim();
    if (!verificationId) {
        return null;
    }

    const referenceLabel = String(context.referenceLabel || context.reference_label || '').trim() || '验证任务';
    const referenceValue = String(context.referenceValue || context.reference_value || verificationId).trim() || verificationId;

    return {
        workspaceKey: 'verify-monitor',
        context: {
            verificationId,
            targetId: verificationId,
            target_id: verificationId,
            referenceLabel,
            referenceValue
        }
    };
}

function buildLinkedOpsAlertSourceWorkbenchEntry(linkedContext = {}, options = {}) {
    if (!linkedContext || typeof linkedContext !== 'object') {
        return null;
    }

    const workspaceAction = options.workspaceAction
        || getOpsAlertWorkspaceAction({
            categoryKey: linkedContext.category_key,
            alertType: linkedContext.alert_type,
            targetId: linkedContext.target_id
        }, {
            labelVariant: options.labelVariant || 'ticket'
        });

    if (!workspaceAction?.target || ['tickets-pending', 'tickets-resolved'].includes(workspaceAction.target)) {
        return null;
    }

    return {
        workspaceKey: workspaceAction.target,
        label: String(workspaceAction.label || '').trim(),
        icon: String(workspaceAction.icon || '').trim(),
        context: {
            alertType: String(linkedContext.alert_type || '').trim(),
            targetId: String(linkedContext.target_id || '').trim(),
            target_id: String(linkedContext.target_id || '').trim(),
            referenceLabel: String(linkedContext.reference_label || '').trim(),
            referenceValue: String(linkedContext.reference_value || '').trim(),
            ticketId: String(options.ticketId || options.ticket_id || '').trim(),
            ticketStatus: String(options.ticketStatus || options.ticket_status || '').trim()
        }
    };
}

function buildTicketWorkbenchEntry(target = 'chat', ticket = {}, options = {}) {
    const normalizedTarget = String(target || 'chat').trim().toLowerCase();
    const normalizedTicket = ticket && typeof ticket === 'object' ? ticket : {};

    if (normalizedTarget === 'chat') {
        const linkedChatContext = options.linkedChatContext && typeof options.linkedChatContext === 'object'
            ? options.linkedChatContext
            : null;
        return buildChatSessionWorkbenchEntry({
            sessionId: linkedChatContext?.session_id || '',
            session_id: linkedChatContext?.session_id || '',
            email: linkedChatContext?.user_email || normalizedTicket.user_email || '',
            userId: normalizedTicket.user_id || '',
            referenceLabel: linkedChatContext?.session_id
                ? '会话ID'
                : ((linkedChatContext?.user_email || normalizedTicket.user_email) ? '邮箱' : '用户ID'),
            referenceValue: linkedChatContext?.session_id
                || linkedChatContext?.user_email
                || normalizedTicket.user_email
                || normalizedTicket.user_id
                || '',
            targetId: normalizedTicket.id || '',
            target_id: normalizedTicket.id || '',
            ticketId: normalizedTicket.id || '',
            ticketStatus: normalizedTicket.status || ''
        });
    }

    if (normalizedTarget === 'order') {
        return buildShopOrderWorkbenchEntry({
            orderId: normalizedTicket.order_id || '',
            referenceLabel: '订单号',
            referenceValue: normalizedTicket.order_id || ''
        });
    }

    if (normalizedTarget === 'user') {
        return buildUserWorkbenchEntry({
            userId: normalizedTicket.user_id || '',
            email: normalizedTicket.user_email || '',
            referenceLabel: normalizedTicket.user_id ? '用户' : '邮箱',
            referenceValue: normalizedTicket.user_id || normalizedTicket.user_email || ''
        });
    }

    if (normalizedTarget === 'source') {
        return buildLinkedOpsAlertSourceWorkbenchEntry(options.linkedOpsAlertContext || null, {
            workspaceAction: options.workspaceAction || null,
            labelVariant: 'ticket',
            ticketId: normalizedTicket.id || '',
            ticketStatus: normalizedTicket.status || ''
        });
    }

    return null;
}

function resolveOpsAlertEntryWorkspace(entryPath = '', baseContext = {}) {
    const normalizedEntryPath = String(entryPath || '').trim();
    if (!normalizedEntryPath) {
        return { kind: 'none' };
    }

    if (normalizedEntryPath.includes('客服消息')) {
        return {
            kind: 'chat-session',
            context: baseContext
        };
    }
    if (normalizedEntryPath.includes('订单列表 / 优惠券码')) {
        return {
            kind: 'ops-workspace',
            workspaceKey: 'shop-risk-discounts',
            context: baseContext
        };
    }
    if (normalizedEntryPath.includes('订单列表 / 用户详情') || normalizedEntryPath.includes('用户详情')) {
        return {
            kind: 'ops-workspace',
            workspaceKey: 'shop-risk-users',
            context: baseContext
        };
    }
    if (normalizedEntryPath.includes('履约任务') || normalizedEntryPath.includes('异常订单')) {
        return {
            kind: 'ops-workspace',
            workspaceKey: 'shop-fulfillment',
            context: baseContext
        };
    }
    if (normalizedEntryPath.includes('库存 / 补货') || normalizedEntryPath.includes('库存')) {
        return {
            kind: 'ops-workspace',
            workspaceKey: 'shop-inventory',
            context: baseContext
        };
    }
    if (normalizedEntryPath.includes('支付配置审计') || normalizedEntryPath.includes('异常登录信号')) {
        return {
            kind: 'ops-workspace',
            workspaceKey: 'admin-audit-monitor',
            context: baseContext
        };
    }
    if (normalizedEntryPath.includes('验证服务配置')) {
        return {
            kind: 'ops-workspace',
            workspaceKey: 'verify-monitor',
            context: baseContext
        };
    }
    if (normalizedEntryPath.includes('售后工单')) {
        return {
            kind: 'ops-workspace',
            workspaceKey: normalizedEntryPath.includes('已处理') ? 'tickets-resolved' : 'tickets-pending',
            context: baseContext
        };
    }
    if (normalizedEntryPath.includes('支付总览') || normalizedEntryPath.includes('异常运维')) {
        return {
            kind: 'ops-workspace',
            workspaceKey: 'payments-ops',
            context: baseContext
        };
    }
    if (normalizedEntryPath.includes('最近订单')) {
        return {
            kind: 'ops-workspace',
            workspaceKey: 'payments-overview',
            context: baseContext
        };
    }
    if (normalizedEntryPath.includes('订单列表')) {
        return {
            kind: 'shop-orders',
            context: baseContext
        };
    }

    return { kind: 'none' };
}

function resolveShopRiskWorkspace(baseContext = {}, payload = {}) {
    const signalType = String(payload?.signal_type || '').trim().toLowerCase();
    if (String(payload?.discount_code || '').trim()) {
        return {
            kind: 'ops-workspace',
            workspaceKey: 'shop-risk-discounts',
            context: baseContext
        };
    }
    if (String(payload?.user_id || '').trim() && signalType === 'user_velocity') {
        return {
            kind: 'ops-workspace',
            workspaceKey: 'shop-risk-users',
            context: baseContext
        };
    }
    return {
        kind: 'ops-workspace',
        workspaceKey: 'shop-risk-orders',
        context: baseContext
    };
}

function resolveOpsAlertWorkspace(alertType = '', payload = {}, baseContext = {}, entryPath = '') {
    switch (String(alertType || '').trim().toLowerCase()) {
        case 'customer_chat_message_received':
        case 'customer_chat_message_summary':
            return {
                kind: 'chat-session',
                context: baseContext
            };
        case 'shop_purchase_succeeded':
        case 'shop_purchase_summary':
            return {
                kind: 'shop-orders',
                context: baseContext
            };
        case 'wallet_recharge_succeeded':
        case 'wallet_recharge_summary':
            return {
                kind: 'ops-workspace',
                workspaceKey: 'payments-overview',
                context: baseContext
            };
        case 'shop_inventory_summary':
        case 'shop_inventory_low':
        case 'shop_inventory_empty':
        case 'shop_inventory_recovered':
            return {
                kind: 'ops-workspace',
                workspaceKey: 'shop-inventory',
                context: baseContext
            };
        case 'ticket_new':
        case 'ticket_sla_summary':
        case 'ticket_sla_overdue':
            return {
                kind: 'ops-workspace',
                workspaceKey: 'tickets-pending',
                context: baseContext
            };
        case 'ticket_sla_recovered':
            return {
                kind: 'ops-workspace',
                workspaceKey: 'tickets-resolved',
                context: baseContext
            };
        case 'shop_order_delivery_summary':
        case 'shop_order_delivery_failed':
        case 'shop_order_delivery_recovered':
        case 'shop_order_delivery_incident':
        case 'shop_order_delivery_incident_recovered':
            return {
                kind: 'ops-workspace',
                workspaceKey: 'shop-fulfillment',
                context: baseContext
            };
        case 'payment_gateway_summary':
        case 'payment_gateway_degraded':
        case 'payment_gateway_recovered':
        case 'payment_refund_ops':
        case 'payment_refund_alert':
            return {
                kind: 'ops-workspace',
                workspaceKey: 'payments-ops',
                context: baseContext
            };
        case 'payment_config_changed':
        case 'payment_config_recovered':
        case 'payment_config_incident':
        case 'payment_config_incident_recovered':
        case 'security_admin_login_anomaly':
            return {
                kind: 'ops-workspace',
                workspaceKey: 'admin-audit-monitor',
                context: baseContext
            };
        case 'verify_quota_summary':
        case 'verify_quota_low':
        case 'verify_service_disabled':
        case 'verify_queue_summary':
        case 'verify_queue_backlog':
        case 'verify_failure_summary':
        case 'verify_failure_rate_spike':
        case 'verify_incident_escalated':
        case 'verify_incident_recovered':
            return {
                kind: 'ops-workspace',
                workspaceKey: 'verify-monitor',
                context: baseContext
            };
        case 'shop_order_risk_anomaly':
        case 'shop_order_risk_recovered':
            return resolveShopRiskWorkspace(baseContext, payload);
        default:
            return resolveOpsAlertEntryWorkspace(entryPath, baseContext);
    }
}

function getAdminWorkbenchModuleForWorkspaceKey(workspaceKey = '') {
    const normalizedKey = String(workspaceKey || '').trim().toLowerCase();
    return ADMIN_WORKBENCH_MODULE_MAP[normalizedKey] || '';
}

function getAdminWorkbenchModuleAccessMessage(moduleName = '') {
    const normalizedModuleName = String(moduleName || '').trim().toLowerCase();
    const moduleLabel = window.getAdminModuleDefinition?.(normalizedModuleName)?.label || normalizedModuleName || '目标模块';
    const requirementText = String(window.getModulePermissionRequirementText?.(normalizedModuleName) || '').trim();
    return requirementText
        ? `当前账号未分配「${moduleLabel}」模块权限，需要 ${requirementText}`
        : `当前账号未分配「${moduleLabel}」模块权限`;
}

function canOpenAdminWorkbenchWorkspace(workspaceKey = '', context = {}) {
    const normalizedKey = String(workspaceKey || '').trim().toLowerCase();
    if (!normalizedKey) {
        return false;
    }

    const moduleName = getAdminWorkbenchModuleForWorkspaceKey(normalizedKey);
    if (!moduleName) {
        return true;
    }

    if (typeof window.hasModulePermission !== 'function') {
        return true;
    }

    return window.hasModulePermission(moduleName, context);
}

async function ensureAdminWorkbenchModule(moduleName, options = {}) {
    const normalizedModuleName = String(moduleName || '').trim().toLowerCase();
    if (!normalizedModuleName) {
        return true;
    }

    if (typeof window.switchModule !== 'function') {
        throw new Error('后台模块切换能力尚未就绪');
    }

    const switched = window.switchModule(normalizedModuleName, {
        fallback: false,
        silentDenied: true,
        ...((options && typeof options === 'object') ? options : {})
    });

    await settleAdminWorkbench();

    if (switched === false) {
        if (options.notifyDenied !== false) {
            notifyAdminWorkbench(getAdminWorkbenchModuleAccessMessage(normalizedModuleName), 'warning');
        }
        return false;
    }

    return true;
}

async function tryOpenOpsAlertWorkspaceUserModal(userId, options = {}) {
    const normalizedUserId = String(userId || '').trim();
    const normalizedEmail = String(options?.email || options?.userEmail || '').trim();
    const silentOnNotFound = options?.silentOnNotFound === true;
    const normalizedTab = String(options?.defaultTab || options?.tab || '').trim().toLowerCase();
    const normalizedPaymentOrderId = String(options?.paymentOrderId || options?.payment_order_id || '').trim();
    const attemptCount = Number(options?.attemptCount || 6);
    const delayMs = Number(options?.delayMs || 140);
    if (!normalizedUserId && !normalizedEmail) {
        return { opened: false, denied: false };
    }

    const usersOpened = await ensureAdminWorkbenchModule('users', {
        notifyDenied: options?.notifyDenied !== false
    });
    if (!usersOpened) {
        return { opened: false, denied: true };
    }

    if (typeof window.openUserModal === 'function') {
        const opened = await window.openUserModal(normalizedUserId, {
            defaultTab: normalizedTab,
            paymentOrderId: normalizedPaymentOrderId,
            fallbackEmail: normalizedEmail,
            silentOnNotFound
        });
        return { opened: Boolean(opened), denied: false };
    }

    if (!normalizedUserId) {
        return { opened: false, denied: false };
    }

    const encodedUserId = encodeURIComponent(normalizedUserId);
    for (let attempt = 0; attempt < attemptCount; attempt += 1) {
        const row = document.querySelector(`[data-admin-action="users-open-drawer"][data-user-id="${encodedUserId}"]`);
        if (row instanceof HTMLElement) {
            if (typeof window.openUserModal === 'function') {
                await window.openUserModal(normalizedUserId, {
                    defaultTab: normalizedTab,
                    paymentOrderId: normalizedPaymentOrderId,
                    fallbackEmail: normalizedEmail,
                    silentOnNotFound
                });
            } else {
                row.click();
            }
            return { opened: true, denied: false };
        }
        await settleAdminWorkbench(delayMs);
    }

    return { opened: false, denied: false };
}

async function focusOpsAlertWorkspacePaymentOrder(paymentOrderId) {
    const normalizedPaymentOrderId = String(paymentOrderId || '').trim();
    if (!normalizedPaymentOrderId) {
        return { opened: false, matched: false };
    }

    const paymentsOpened = await ensureAdminWorkbenchModule('payments');
    if (!paymentsOpened) {
        return { opened: false, matched: false, denied: true };
    }
    await window.AdminPayments?.init?.();

    if (window.AdminPayments?.focusOrder) {
        const result = await window.AdminPayments.focusOrder(normalizedPaymentOrderId, {
            switchTab: true,
            reload: true
        });
        await settleAdminWorkbench();
        return result && typeof result === 'object'
            ? result
            : { opened: Boolean(result), matched: Boolean(result) };
    }

    window.AdminPayments?.switchTab?.('overview', { reload: false });
    await settleAdminWorkbench();
    scrollAdminWorkbenchTarget('paymentsProviderStats');
    return { opened: true, matched: false };
}

async function openAdminWorkbenchEntry(workspaceKey, context = {}) {
    const normalizedKey = String(workspaceKey || '').trim().toLowerCase();
    const normalizedContext = normalizeOpsAlertWorkspaceContext(context);
    const workspaceSearchValue = getOpsAlertWorkspaceSearchValue(normalizedContext);
    if (!normalizedKey) {
        notifyAdminWorkbench('缺少告警处理入口标识', 'warning');
        return false;
    }

    try {
        if (normalizedKey === 'chat-session') {
            const chatSessionId = String(
                normalizedContext.sessionId
                || (normalizedContext.referenceLabel === '会话ID' ? normalizedContext.referenceValue : '')
                || ''
            ).trim();
            const chatSearchValue = String(
                chatSessionId
                || normalizedContext.email
                || normalizedContext.userId
                || workspaceSearchValue
                || normalizedContext.referenceValue
                || ''
            ).trim();

            const chatOpened = await ensureAdminWorkbenchModule('chat');
            if (!chatOpened) {
                return false;
            }

            let chatInstance = window.adminChatInstance || null;
            if (!chatInstance && typeof window.AdminChat === 'function') {
                chatInstance = new window.AdminChat();
                await settleAdminWorkbench();
            }

            if (!chatInstance) {
                throw new Error('客服工作台尚未就绪');
            }

            if (chatSessionId && typeof chatInstance.loadSession === 'function') {
                await chatInstance.loadSession(chatSessionId);
            } else {
                chatInstance.backToSessions?.();
                chatInstance.filterSessions?.(chatSearchValue);
                const chatSearchInput = document.getElementById('sessionSearch');
                if (chatSearchInput) {
                    chatSearchInput.value = chatSearchValue;
                }
            }

            await settleAdminWorkbench();
            scrollAdminWorkbenchTarget('module-chat');
        } else if (normalizedKey === 'verify-monitor') {
            const settingsOpened = await ensureAdminWorkbenchModule('settings');
            if (!settingsOpened) {
                return false;
            }
            window.switchSettingsView?.('content');
            await settleAdminWorkbench();
            const verifyMonitorRefresh = typeof window.refreshVerifyMonitor === 'function'
                ? window.refreshVerifyMonitor(true).catch((error) => {
                    console.warn('[AdminWorkbench] Verify monitor refresh failed:', error);
                    return null;
                })
                : Promise.resolve(null);
            await Promise.race([
                verifyMonitorRefresh,
                new Promise((resolve) => {
                    window.setTimeout(resolve, 1200);
                })
            ]);
            scrollAdminWorkbenchTarget('verifyMonitorPanel');
            window.focusVerifyMonitorWorkspace?.(normalizedContext);
        } else if (normalizedKey === 'admin-audit-monitor') {
            const settingsOpened = await ensureAdminWorkbenchModule('settings');
            if (!settingsOpened) {
                return false;
            }
            window.switchSettingsView?.('security');
            await settleAdminWorkbench();
            const adminAuditMonitorRefresh = typeof window.refreshAdminAuditMonitor === 'function'
                ? window.refreshAdminAuditMonitor(true).catch((error) => {
                    console.warn('[AdminWorkbench] Admin audit monitor refresh failed:', error);
                    return null;
                })
                : Promise.resolve(null);
            await Promise.race([
                adminAuditMonitorRefresh,
                new Promise((resolve) => {
                    window.setTimeout(resolve, 1200);
                })
            ]);
            scrollAdminWorkbenchTarget('adminAuditMonitorSection');
            window.focusAdminAuditMonitorWorkspace?.(normalizedContext);
        } else if (normalizedKey === 'payments-overview') {
            if (normalizedContext.paymentOrderId) {
                const paymentFocusResult = await focusOpsAlertWorkspacePaymentOrder(normalizedContext.paymentOrderId);
                if (paymentFocusResult.denied) {
                    return false;
                }
                if (!paymentFocusResult.opened || !paymentFocusResult.matched) {
                    scrollAdminWorkbenchTarget('paymentsProviderStats');
                }
            } else {
                const paymentsOpened = await ensureAdminWorkbenchModule('payments');
                if (!paymentsOpened) {
                    return false;
                }
                await window.AdminPayments?.init?.();
                window.AdminPayments?.switchTab?.('overview', { reload: false });
                await settleAdminWorkbench();
                scrollAdminWorkbenchTarget('paymentsProviderStats');
            }
        } else if (normalizedKey === 'payments-ops') {
            const paymentsOpened = await ensureAdminWorkbenchModule('payments');
            if (!paymentsOpened) {
                return false;
            }
            await window.AdminPayments?.init?.();
            await window.AdminPayments?.focusExceptionTopic?.(getOpsAlertWorkspacePaymentsTopic(normalizedContext));
        } else if (normalizedKey === 'tickets-pending' || normalizedKey === 'tickets-resolved') {
            const nextStatus = normalizedKey === 'tickets-pending' ? 'pending' : 'resolved';
            const normalizedTicketId = String(normalizedContext.ticketId || '').trim()
                || (normalizedContext.referenceLabel === '工单号' ? String(workspaceSearchValue || '').trim() : '');
            const ticketsOpened = await ensureAdminWorkbenchModule('tickets');
            if (!ticketsOpened) {
                return false;
            }
            await window.AdminTickets?.init?.();
            if (normalizedTicketId && window.AdminTickets?.focusTicket) {
                const ticketFocusResult = await window.AdminTickets.focusTicket(normalizedTicketId, {
                    status: normalizedContext.ticketStatus || nextStatus
                });
                if (!ticketFocusResult.matched) {
                    const searchInput = document.getElementById('ticketSearchInput');
                    if (searchInput) searchInput.value = workspaceSearchValue || '';
                    if (window.AdminTickets) {
                        window.AdminTickets.searchQuery = workspaceSearchValue || '';
                    }
                    const filterButton = document.querySelector(`[data-admin-action="tickets-filter"][data-ticket-status="${nextStatus}"]`);
                    window.AdminTickets?.filter?.(nextStatus, filterButton);
                    if (workspaceSearchValue) {
                        window.AdminTickets?.search?.();
                    }
                }
            } else {
                const searchInput = document.getElementById('ticketSearchInput');
                if (searchInput) searchInput.value = workspaceSearchValue || '';
                if (window.AdminTickets) {
                    window.AdminTickets.searchQuery = workspaceSearchValue || '';
                }
                const filterButton = document.querySelector(`[data-admin-action="tickets-filter"][data-ticket-status="${nextStatus}"]`);
                window.AdminTickets?.filter?.(nextStatus, filterButton);
                if (workspaceSearchValue) {
                    window.AdminTickets?.search?.();
                }
            }
            await settleAdminWorkbench();
            scrollAdminWorkbenchTarget('module-tickets');
        } else if (normalizedKey === 'shop-inventory') {
            const shopOpened = await ensureAdminWorkbenchModule('shop');
            if (!shopOpened) {
                return false;
            }
            await window.ShopAdmin?.init?.();
            window.ShopAdmin?.switchTab?.('inventory');
            await settleAdminWorkbench();
            scrollAdminWorkbenchTarget('shop-view-inventory');
        } else if (normalizedKey === 'shop-fulfillment') {
            const shopOpened = await ensureAdminWorkbenchModule('shop');
            if (!shopOpened) {
                return false;
            }
            await window.ShopAdmin?.init?.();
            window.ShopAdmin?.switchTab?.('fulfillment');
            await settleAdminWorkbench();
            if (window.ShopAdmin) {
                const nextStatus = normalizedContext.alertType === 'shop_order_delivery_failed' ? 'dead_letter' : 'all';
                window.ShopAdmin.deliveryTaskStatusFilter = nextStatus;
                window.ShopAdmin.deliveryTaskQuery = workspaceSearchValue || '';
                window.ShopAdmin.deliveryTaskQueryContext = workspaceSearchValue
                    ? {
                        type: 'manual',
                        label: workspaceSearchValue
                    }
                    : null;
                window.ShopAdmin.deliveryTaskIdentityFilter = workspaceSearchValue && normalizedContext.referenceLabel === '订单'
                    ? {
                        taskId: '',
                        orderId: workspaceSearchValue
                    }
                    : null;
                const taskFilter = document.getElementById('deliveryTaskStatusFilter');
                const taskQueryInput = document.getElementById('deliveryTaskQueryInput');
                if (taskFilter) taskFilter.value = nextStatus;
                if (taskQueryInput) taskQueryInput.value = workspaceSearchValue || '';
                await window.ShopAdmin.loadDeliveryTasks?.(1);
            }
            scrollAdminWorkbenchTarget('deliveryDeadLetterSummary');
        } else if (normalizedKey === 'shop-risk-orders') {
            const normalizedOrderId = String(normalizedContext.orderId || '').trim()
                || (['订单号', '订单'].includes(normalizedContext.referenceLabel)
                    ? String(workspaceSearchValue || '').trim()
                    : '');
            const shopOpened = await ensureAdminWorkbenchModule('shop');
            if (!shopOpened) {
                return false;
            }
            await window.ShopAdmin?.init?.();
            window.ShopAdmin?.switchTab?.('orders', { load: !normalizedOrderId });
            await settleAdminWorkbench();
            if (normalizedOrderId && window.ShopAdmin?.focusOrder) {
                await window.ShopAdmin.focusOrder(normalizedOrderId, { openDetails: true });
            } else {
                const orderSearchInput = document.getElementById('orderSearchInput');
                if (orderSearchInput) {
                    orderSearchInput.value = normalizedOrderId || '';
                }
                await window.ShopAdmin?.searchOrders?.(1);
            }
            scrollAdminWorkbenchTarget('shop-view-orders');
        } else if (normalizedKey === 'shop-risk-discounts') {
            const discountSearchValue = getOpsAlertWorkspaceDiscountCode(normalizedContext) || workspaceSearchValue || '';
            const discountsOpened = await ensureAdminWorkbenchModule('discounts');
            if (!discountsOpened) {
                return false;
            }
            if (window.AdminDiscounts) {
                window.AdminDiscounts.filters = {
                    ...(window.AdminDiscounts.filters || {}),
                    search: String(discountSearchValue || '').trim().toLowerCase()
                };
                window.AdminDiscounts.currentPage = 1;
            }
            const discountSearchInput = document.getElementById('discountSearchInput');
            if (discountSearchInput) {
                discountSearchInput.value = discountSearchValue || '';
            }
            await window.AdminDiscounts?.loadDiscounts?.();
            if (discountSearchValue) {
                window.AdminDiscounts?.search?.();
            }
            scrollAdminWorkbenchTarget('module-discounts');
        } else if (normalizedKey === 'shop-risk-users') {
            const riskUserId = getOpsAlertWorkspaceRiskUserId(normalizedContext);
            const riskUserEmail = String(normalizedContext.email || '').trim();
            const userSearchValue = riskUserId || workspaceSearchValue || '';
            if (riskUserId || riskUserEmail) {
                const modalResult = await tryOpenOpsAlertWorkspaceUserModal(riskUserId, {
                    defaultTab: normalizedContext.tab,
                    paymentOrderId: normalizedContext.paymentOrderId,
                    email: riskUserEmail,
                    silentOnNotFound: Boolean(normalizedContext.paymentOrderId)
                });
                if (modalResult?.denied) {
                    return false;
                }
                if (modalResult?.opened) {
                    await settleAdminWorkbench();
                } else {
                    const paymentFocusResult = await focusOpsAlertWorkspacePaymentOrder(normalizedContext.paymentOrderId);
                    if (paymentFocusResult.denied) {
                        return false;
                    }
                    if (paymentFocusResult.opened) {
                        notifyAdminWorkbench(
                            paymentFocusResult.matched
                                ? '未找到后台用户，已自动定位到这笔充值记录'
                                : '未找到后台用户，已打开支付总览',
                            'warning'
                        );
                        return true;
                    }
                    notifyAdminWorkbench('未找到该用户，无法打开详情', 'error');
                    return false;
                }
            } else {
                const usersOpened = await ensureAdminWorkbenchModule('users');
                if (!usersOpened) {
                    return false;
                }
                const userSearchInput = document.getElementById('userSearchInput');
                if (userSearchInput) {
                    userSearchInput.value = userSearchValue;
                    userSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
                await settleAdminWorkbench();
                scrollAdminWorkbenchTarget('module-users');
            }
        } else {
            throw new Error('未识别的告警处理入口');
        }

        notifyAdminWorkbench(`已打开${getOpsAlertWorkspaceSuccessLabel(normalizedKey)}`, 'success');
        return true;
    } catch (error) {
        console.error('[AdminWorkbench] Open workspace failed:', error);
        notifyAdminWorkbench('打开失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function openOpsAlertWorkspace(workspaceKey, context = {}) {
    return openAdminWorkbenchEntry(workspaceKey, context);
}

function savePendingOpsAlertWorkspace(workspaceKey = '', context = {}) {
    const normalizedWorkspaceKey = String(workspaceKey || '').trim();
    if (!normalizedWorkspaceKey || typeof window.localStorage === 'undefined') {
        return false;
    }

    const payload = {
        workspaceKey: normalizedWorkspaceKey,
        context: context && typeof context === 'object' ? context : {},
        createdAt: new Date().toISOString()
    };

    window.localStorage.setItem(ADMIN_WORKBENCH_PENDING_WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
    return true;
}

function consumePendingOpsAlertWorkspace() {
    const urlPending = consumePendingOpsAlertWorkspaceFromUrl();
    if (urlPending) {
        return urlPending;
    }

    if (typeof window.localStorage === 'undefined') {
        return null;
    }

    const raw = window.localStorage.getItem(ADMIN_WORKBENCH_PENDING_WORKSPACE_STORAGE_KEY);
    if (!raw) {
        return null;
    }

    window.localStorage.removeItem(ADMIN_WORKBENCH_PENDING_WORKSPACE_STORAGE_KEY);

    try {
        const parsed = JSON.parse(raw);
        const workspaceKey = String(parsed?.workspaceKey || '').trim();
        if (!workspaceKey) {
            return null;
        }

        const createdAt = parsed?.createdAt ? new Date(parsed.createdAt) : null;
        const maxAgeMs = 10 * 60 * 1000;
        if (createdAt && !Number.isNaN(createdAt.getTime()) && (Date.now() - createdAt.getTime()) > maxAgeMs) {
            return null;
        }

        return {
            workspaceKey,
            context: parsed?.context && typeof parsed.context === 'object' ? parsed.context : {}
        };
    } catch (error) {
        console.warn('[AdminWorkbench] Failed to parse pending ops alert workspace:', error);
        return null;
    }
}

function consumePendingOpsAlertWorkspaceFromUrl() {
    try {
        const url = new URL(window.location.href);
        const workspaceKey = String(url.searchParams.get(ADMIN_WORKBENCH_URL_PARAM_KEY) || '').trim();
        if (!workspaceKey) {
            return null;
        }

        let context = {};
        const rawContext = String(url.searchParams.get(ADMIN_WORKBENCH_URL_PARAM_CONTEXT) || '').trim();
        if (rawContext) {
            try {
                const parsed = JSON.parse(rawContext);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    context = parsed;
                }
            } catch (error) {
                console.warn('[AdminWorkbench] Failed to parse URL workspace context:', error);
            }
        }

        url.searchParams.delete(ADMIN_WORKBENCH_URL_PARAM_KEY);
        url.searchParams.delete(ADMIN_WORKBENCH_URL_PARAM_CONTEXT);
        const nextRelativeUrl = `${url.pathname}${url.search}${url.hash}`;
        const currentRelativeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (nextRelativeUrl !== currentRelativeUrl && typeof window.history?.replaceState === 'function') {
            window.history.replaceState(window.history.state, '', nextRelativeUrl);
        }

        return {
            workspaceKey,
            context
        };
    } catch (error) {
        console.warn('[AdminWorkbench] Failed to read pending workspace from URL:', error);
        return null;
    }
}

async function restorePendingOpsAlertWorkspace() {
    const pending = consumePendingOpsAlertWorkspace();
    if (!pending) {
        return false;
    }

    try {
        await openOpsAlertWorkspace(pending.workspaceKey, pending.context || {});
        return true;
    } catch (error) {
        console.error('[AdminWorkbench] Failed to restore pending ops alert workspace:', error);
        return false;
    }
}

function schedulePendingOpsAlertWorkspaceRestore() {
    if (window.__pendingOpsAlertWorkspaceRestoreScheduled) {
        return;
    }
    window.__pendingOpsAlertWorkspaceRestoreScheduled = true;

    const runRestore = () => {
        window.setTimeout(() => {
            restorePendingOpsAlertWorkspace()
                .finally(() => {
                    window.__pendingOpsAlertWorkspaceRestoreScheduled = false;
                });
        }, 120);
    };

    if (document.readyState === 'complete') {
        runRestore();
    } else {
        window.addEventListener('load', runRestore, { once: true });
    }
}

window.getAdminWorkbenchModuleForWorkspaceKey = getAdminWorkbenchModuleForWorkspaceKey;
window.normalizeOpsAlertWorkspaceContext = normalizeOpsAlertWorkspaceContext;
window.buildAdminWorkbenchOpsAlertWorkspaceContextAttrs = buildOpsAlertWorkspaceContextAttrs;
window.buildOpsAlertWorkspaceContextAttrs = buildOpsAlertWorkspaceContextAttrs;
window.readOpsAlertWorkspaceContextDataset = readOpsAlertWorkspaceContextDataset;
window.getOpsAlertWorkspaceTargetIdParts = getOpsAlertWorkspaceTargetIdParts;
window.getOpsAlertWorkspaceDiscountCode = getOpsAlertWorkspaceDiscountCode;
window.getOpsAlertWorkspaceRiskUserId = getOpsAlertWorkspaceRiskUserId;
window.getOpsAlertWorkspaceSearchValue = getOpsAlertWorkspaceSearchValue;
window.getOpsAlertWorkspacePaymentsTopic = getOpsAlertWorkspacePaymentsTopic;
window.getOpsAlertWorkspaceSuccessLabel = getOpsAlertWorkspaceSuccessLabel;
window.normalizeOpsAlertWorkspaceActionContext = normalizeOpsAlertWorkspaceActionContext;
window.getOpsAlertWorkspaceAction = getOpsAlertWorkspaceAction;
window.getAdminWorkbenchOpsAlertCaseStatusLabel = getOpsAlertCaseStatusLabel;
window.getAdminWorkbenchOpsAlertCaseStatusTone = getOpsAlertCaseStatusTone;
window.getOpsAlertCaseStatusLabel = getOpsAlertCaseStatusLabel;
window.getOpsAlertCaseStatusTone = getOpsAlertCaseStatusTone;
window.getOpsAlertCaseEventActionLabel = getOpsAlertCaseEventActionLabel;
window.normalizeOpsAlertCaseDisplayEvent = normalizeOpsAlertCaseDisplayEvent;
window.getOpsAlertCaseMuteSummary = getOpsAlertCaseMuteSummary;
window.normalizeAdminWorkbenchOpsAlertCaseRecentEvents = normalizeAdminWorkbenchOpsAlertCaseRecentEvents;
window.getAdminWorkbenchOpsAlertCaseRecentEventText = getOpsAlertCaseRecentEventText;
window.getAdminWorkbenchOpsAlertCaseSummaryText = getOpsAlertCaseSummaryText;
window.getOpsAlertCaseRecentEventText = getOpsAlertCaseRecentEventText;
window.getOpsAlertCaseSummaryText = getOpsAlertCaseSummaryText;
window.getOpsAlertWorkspaceContextLabel = getOpsAlertWorkspaceContextLabel;
window.getOpsAlertWorkspaceBatchPreview = getOpsAlertWorkspaceBatchPreview;
window.buildOpsAlertCaseMutationContext = buildOpsAlertCaseMutationContext;
window.normalizeOpsAlertCaseMutationItem = normalizeOpsAlertCaseMutationItem;
window.buildAdminWorkbenchOpsAlertCaseMutationItems = buildOpsAlertCaseMutationItems;
window.buildOpsAlertCaseMutationItems = buildOpsAlertCaseMutationItems;
window.buildAdminWorkbenchOpsAlertMonitorBatchItems = buildOpsAlertMonitorBatchItems;
window.getAdminWorkbenchOpsAlertMonitorBatchMuteModuleKeys = getOpsAlertMonitorBatchMuteModuleKeys;
window.getAdminWorkbenchOpsAlertMonitorCategoryLabel = getAdminWorkbenchOpsAlertMonitorCategoryLabel;
window.getAdminWorkbenchOpsAlertMonitorFilterSummaryLabel = getAdminWorkbenchOpsAlertMonitorFilterSummaryLabel;
window.buildAdminWorkbenchOpsAlertMonitorCategoryView = buildAdminWorkbenchOpsAlertMonitorCategoryView;
window.buildAdminWorkbenchOpsAlertMonitorFilterToolbarState = buildAdminWorkbenchOpsAlertMonitorFilterToolbarState;
window.buildAdminWorkbenchOpsAlertMonitorViewState = buildAdminWorkbenchOpsAlertMonitorViewState;
window.getAdminWorkbenchOpsAlertMonitorDisplayActiveCount = getAdminWorkbenchOpsAlertMonitorDisplayActiveCount;
window.getAdminWorkbenchOpsAlertMonitorDisplayCriticalCount = getAdminWorkbenchOpsAlertMonitorDisplayCriticalCount;
window.getAdminWorkbenchOpsAlertMonitorCardTone = getAdminWorkbenchOpsAlertMonitorCardTone;
window.buildAdminWorkbenchOpsAlertMonitorCategoryCardState = buildAdminWorkbenchOpsAlertMonitorCategoryCardState;
window.buildAdminWorkbenchOpsAlertMonitorCategoryRenderState = buildAdminWorkbenchOpsAlertMonitorCategoryRenderState;
window.buildAdminWorkbenchOpsAlertMonitorItemDisplayState = buildAdminWorkbenchOpsAlertMonitorItemDisplayState;
window.buildAdminWorkbenchOpsAlertMonitorBatchActionStates = buildAdminWorkbenchOpsAlertMonitorBatchActionStates;
window.formatAdminWorkbenchOpsAlertSignedCount = formatAdminWorkbenchOpsAlertSignedCount;
window.formatAdminWorkbenchOpsAlertTimeShort = formatAdminWorkbenchOpsAlertTimeShort;
window.getAdminWorkbenchOpsAlertBacklogDeltaTone = getAdminWorkbenchOpsAlertBacklogDeltaTone;
window.getAdminWorkbenchOpsAlertMonitorCategoryActions = getAdminWorkbenchOpsAlertMonitorCategoryActions;
window.normalizeAdminWorkbenchOpsAlertMonitorAssignableAdmins = normalizeAdminWorkbenchOpsAlertMonitorAssignableAdmins;
window.getAdminWorkbenchOpsAlertMonitorCurrentAdminId = getAdminWorkbenchOpsAlertMonitorCurrentAdminId;
window.buildAdminWorkbenchOpsAlertMonitorActionContext = buildAdminWorkbenchOpsAlertMonitorActionContext;
window.getAdminWorkbenchOpsAlertMonitorWorkspaceAction = getAdminWorkbenchOpsAlertMonitorWorkspaceAction;
window.getAdminWorkbenchOpsAlertMonitorQuickAction = getAdminWorkbenchOpsAlertMonitorQuickAction;
window.getAdminWorkbenchOpsAlertMonitorCaseActions = getAdminWorkbenchOpsAlertMonitorCaseActions;
window.buildAdminWorkbenchOpsAlertMonitorRecoveryRow = buildAdminWorkbenchOpsAlertMonitorRecoveryRow;
window.buildAdminWorkbenchOpsAlertMonitorBatchRows = buildAdminWorkbenchOpsAlertMonitorBatchRows;
window.buildAdminWorkbenchOpsAlertMonitorChecklistText = buildAdminWorkbenchOpsAlertMonitorChecklistText;
window.readAdminWorkbenchOpsAlertSecretInputs = readAdminWorkbenchOpsAlertSecretInputs;
window.clearAdminWorkbenchOpsAlertSecretInputs = clearAdminWorkbenchOpsAlertSecretInputs;
window.buildAdminWorkbenchOpsAlertSettingsRequestBody = buildAdminWorkbenchOpsAlertSettingsRequestBody;
window.buildAdminWorkbenchOpsAlertConfigDraft = buildAdminWorkbenchOpsAlertConfigDraft;
window.buildAdminWorkbenchOpsAlertSummaryModeHintText = buildAdminWorkbenchOpsAlertSummaryModeHintText;
window.collectAdminWorkbenchOpsAlertUnifiedSummaryDraft = collectAdminWorkbenchOpsAlertUnifiedSummaryDraft;
window.buildAdminWorkbenchOpsAlertUnifiedSummaryConsensus = buildAdminWorkbenchOpsAlertUnifiedSummaryConsensus;
window.buildAdminWorkbenchOpsAlertUnifiedSummaryDraftControlState = buildAdminWorkbenchOpsAlertUnifiedSummaryDraftControlState;
window.buildAdminWorkbenchOpsAlertSummaryModeControlState = buildAdminWorkbenchOpsAlertSummaryModeControlState;
window.buildAdminWorkbenchOpsAlertSummaryOrchestrationRenderState = buildAdminWorkbenchOpsAlertSummaryOrchestrationRenderState;
window.buildAdminWorkbenchOpsAlertMonitorControlState = buildAdminWorkbenchOpsAlertMonitorControlState;
window.buildAdminWorkbenchOpsAlertShopRiskControlState = buildAdminWorkbenchOpsAlertShopRiskControlState;
window.collectAdminWorkbenchOpsAlertStrategyDraft = collectAdminWorkbenchOpsAlertStrategyDraft;
window.collectAdminWorkbenchOpsAlertOperationalThresholdDrafts = collectAdminWorkbenchOpsAlertOperationalThresholdDrafts;
window.buildAdminWorkbenchOpsAlertStrategySummaryState = buildAdminWorkbenchOpsAlertStrategySummaryState;
window.buildAdminWorkbenchOpsAlertOverviewStatus = buildAdminWorkbenchOpsAlertOverviewStatus;
window.buildAdminWorkbenchOpsAlertOverviewBannerState = buildAdminWorkbenchOpsAlertOverviewBannerState;
window.buildAdminWorkbenchOpsAlertOverviewRenderState = buildAdminWorkbenchOpsAlertOverviewRenderState;
window.getAdminWorkbenchOpsAlertRecentDeliverySummary = getAdminWorkbenchOpsAlertRecentDeliverySummary;
window.getAdminWorkbenchOpsAlertRecentErrorSummary = getAdminWorkbenchOpsAlertRecentErrorSummary;
window.getAdminWorkbenchOpsAlertErrorSourceSummary = getAdminWorkbenchOpsAlertErrorSourceSummary;
window.buildAdminWorkbenchOpsAlertOverviewCardStates = buildAdminWorkbenchOpsAlertOverviewCardStates;
window.buildAdminWorkbenchOpsAlertRiskSpotlightState = buildAdminWorkbenchOpsAlertRiskSpotlightState;
window.buildAdminWorkbenchOpsAlertRiskSpotlightShellState = buildAdminWorkbenchOpsAlertRiskSpotlightShellState;
window.buildAdminWorkbenchOpsAlertRiskSpotlightRenderState = buildAdminWorkbenchOpsAlertRiskSpotlightRenderState;
window.buildAdminWorkbenchOpsAlertOverviewRecentVisualState = buildAdminWorkbenchOpsAlertOverviewRecentVisualState;
window.getAdminWorkbenchOpsAlertHealthSourceLabel = getAdminWorkbenchOpsAlertHealthSourceLabel;
window.getAdminWorkbenchOpsAlertHealthMetaLine = getAdminWorkbenchOpsAlertHealthMetaLine;
window.getAdminWorkbenchOpsAlertHealthLastSummary = getAdminWorkbenchOpsAlertHealthLastSummary;
window.buildAdminWorkbenchOpsAlertHealthCardState = buildAdminWorkbenchOpsAlertHealthCardState;
window.buildAdminWorkbenchOpsAlertHealthPanelState = buildAdminWorkbenchOpsAlertHealthPanelState;
window.buildAdminWorkbenchOpsAlertHealthRenderState = buildAdminWorkbenchOpsAlertHealthRenderState;
window.buildAdminWorkbenchOpsAlertStrategyControlState = buildAdminWorkbenchOpsAlertStrategyControlState;
window.validateAdminWorkbenchOpsAlertDispatchConfig = validateAdminWorkbenchOpsAlertDispatchConfig;
window.fetchAdminWorkbenchOpsAlertSettings = fetchAdminWorkbenchOpsAlertSettings;
window.submitAdminWorkbenchOpsAlertSettings = submitAdminWorkbenchOpsAlertSettings;
window.deleteAdminWorkbenchOpsAlertSecret = deleteAdminWorkbenchOpsAlertSecret;
window.normalizeAdminWorkbenchOpsAlertSettingsPayload = normalizeAdminWorkbenchOpsAlertSettingsPayload;
window.fetchAdminWorkbenchOpsAlertHealth = fetchAdminWorkbenchOpsAlertHealth;
window.normalizeAdminWorkbenchOpsAlertHealthPayload = normalizeAdminWorkbenchOpsAlertHealthPayload;
window.normalizeAdminWorkbenchOpsAlertMonitorShiftReport = normalizeAdminWorkbenchOpsAlertMonitorShiftReport;
window.normalizeAdminWorkbenchOpsAlertMonitorShiftReportView = normalizeAdminWorkbenchOpsAlertMonitorShiftReportView;
window.getAdminWorkbenchOpsAlertMonitorShiftReportViewMeta = getAdminWorkbenchOpsAlertMonitorShiftReportViewMeta;
window.getAdminWorkbenchOpsAlertMonitorShiftReportVisibleSections = getAdminWorkbenchOpsAlertMonitorShiftReportVisibleSections;
window.getAdminWorkbenchOpsAlertMonitorShiftReportCurrentAdminStat = getAdminWorkbenchOpsAlertMonitorShiftReportCurrentAdminStat;
window.buildAdminWorkbenchOpsAlertMonitorShiftOwnedCategoryItems = buildAdminWorkbenchOpsAlertMonitorShiftOwnedCategoryItems;
window.buildAdminWorkbenchOpsAlertMonitorPanelState = buildAdminWorkbenchOpsAlertMonitorPanelState;
window.buildAdminWorkbenchOpsAlertBatchMuteModalState = buildAdminWorkbenchOpsAlertBatchMuteModalState;
window.buildAdminWorkbenchOpsAlertMonitorShiftTrendState = buildAdminWorkbenchOpsAlertMonitorShiftTrendState;
window.buildAdminWorkbenchOpsAlertMonitorShiftShellState = buildAdminWorkbenchOpsAlertMonitorShiftShellState;
window.buildAdminWorkbenchOpsAlertMonitorShiftViewSwitchState = buildAdminWorkbenchOpsAlertMonitorShiftViewSwitchState;
window.buildAdminWorkbenchOpsAlertMonitorShiftReportState = buildAdminWorkbenchOpsAlertMonitorShiftReportState;
window.buildAdminWorkbenchOpsAlertMonitorShiftPanelStates = buildAdminWorkbenchOpsAlertMonitorShiftPanelStates;
window.buildAdminWorkbenchOpsAlertMonitorShiftReportSummaryText = buildAdminWorkbenchOpsAlertMonitorShiftReportSummaryText;
window.buildAdminWorkbenchOpsAlertMonitorShiftReportCsvRows = buildAdminWorkbenchOpsAlertMonitorShiftReportCsvRows;
window.buildAdminWorkbenchOpsAlertMonitorShiftRenderState = buildAdminWorkbenchOpsAlertMonitorShiftRenderState;
window.fetchAdminWorkbenchOpsAlertMonitor = fetchAdminWorkbenchOpsAlertMonitor;
window.normalizeAdminWorkbenchOpsAlertMonitorPayload = normalizeAdminWorkbenchOpsAlertMonitorPayload;
window.getOpsAlertCaseComposerMeta = getOpsAlertCaseComposerMeta;
window.buildOpsAlertCaseMutationRequest = buildOpsAlertCaseMutationRequest;
window.submitOpsAlertCaseMutationRequest = submitOpsAlertCaseMutationRequest;
window.buildChatSessionWorkbenchEntry = buildChatSessionWorkbenchEntry;
window.buildShopOrderWorkbenchEntry = buildShopOrderWorkbenchEntry;
window.buildUserWorkbenchEntry = buildUserWorkbenchEntry;
window.buildTicketQueueWorkbenchEntry = buildTicketQueueWorkbenchEntry;
window.buildPaymentWorkbenchEntry = buildPaymentWorkbenchEntry;
window.buildVerifyWorkbenchEntry = buildVerifyWorkbenchEntry;
window.buildLinkedOpsAlertSourceWorkbenchEntry = buildLinkedOpsAlertSourceWorkbenchEntry;
window.buildTicketWorkbenchEntry = buildTicketWorkbenchEntry;
window.resolveOpsAlertEntryWorkspace = resolveOpsAlertEntryWorkspace;
window.resolveShopRiskWorkspace = resolveShopRiskWorkspace;
window.resolveOpsAlertWorkspace = resolveOpsAlertWorkspace;
window.canOpenAdminWorkbenchWorkspace = canOpenAdminWorkbenchWorkspace;
window.tryOpenOpsAlertWorkspaceUserModal = tryOpenOpsAlertWorkspaceUserModal;
window.focusOpsAlertWorkspacePaymentOrder = focusOpsAlertWorkspacePaymentOrder;
window.openAdminWorkbenchEntry = openAdminWorkbenchEntry;
window.openOpsAlertWorkspace = openOpsAlertWorkspace;
window.savePendingOpsAlertWorkspace = savePendingOpsAlertWorkspace;
window.consumePendingOpsAlertWorkspace = consumePendingOpsAlertWorkspace;
window.restorePendingOpsAlertWorkspace = restorePendingOpsAlertWorkspace;
window.schedulePendingOpsAlertWorkspaceRestore = schedulePendingOpsAlertWorkspaceRestore;
