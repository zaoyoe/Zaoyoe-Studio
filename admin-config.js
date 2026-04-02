/**
 * System Config Management
 * 系统配置管理 - 定价配置
 */

// Config cache
let systemConfigCache = {};
let paymentChannelSecretStatus = getDefaultPaymentChannelSecretStatus();
let paymentChannelRuntimeState = getDefaultPaymentChannelRuntimeState();
let opsAlertSecretStatus = getDefaultOpsAlertSecretStatus();
let opsAlertHealthState = getDefaultOpsAlertHealthState();
let opsAlertMonitorState = getDefaultOpsAlertMonitorState();
let opsAlertMonitorViewState = getDefaultOpsAlertMonitorViewState();
let opsAlertMonitorShiftReportViewState = getDefaultOpsAlertMonitorShiftReportViewState();
let shopRiskCaseComposerState = getDefaultShopRiskCaseComposerState();
let opsAlertBatchMuteState = getDefaultOpsAlertBatchMuteState();
let opsAlertStrategySaveInFlight = false;
let opsAlertUnifiedSummaryDraftDirty = false;
let opsAlertStrategyBeforeUnloadReady = false;
let verifyMonitorState = getDefaultVerifyMonitorState();
let adminAuditMonitorState = getDefaultAdminAuditMonitorState();
let paymentChannelAccordionState = {
    mock: false,
    afdian: false,
    hupijiao: false
};
const ADMIN_CONFIG_TOGGLE_PULSE_CLASS = 'status-toggle--pulse';
const ADMIN_CONFIG_SAVE_VISIBLE_CLASS = 'visible';
const ADMIN_CONFIG_VERIFY_QUOTA_TONE_CLASSES = [
    'verify-quota-badge--neutral',
    'verify-quota-badge--success',
    'verify-quota-badge--warning',
    'verify-quota-badge--danger'
];
const VERIFY_MONITOR_ACTIVE_STATUSES = new Set(['queued', 'running', 'processing', 'pending']);
const VERIFY_MONITOR_STATUS_META = Object.freeze({
    idle: { label: '待检测', tone: 'neutral' },
    queued: { label: '排队中', tone: 'neutral' },
    running: { label: '运行中', tone: 'neutral' },
    processing: { label: '处理中', tone: 'neutral' },
    pending: { label: '待处理', tone: 'warning' },
    success: { label: '成功', tone: 'success' },
    failed: { label: '失败', tone: 'danger' },
    error: { label: '异常', tone: 'danger' },
    cancelled: { label: '已取消', tone: 'warning' },
    timeout: { label: '超时', tone: 'danger' },
    unknown: { label: '未知', tone: 'warning' }
});
const VERIFY_MONITOR_CARD_TONE_CLASSES = [
    'verify-monitor-card--neutral',
    'verify-monitor-card--success',
    'verify-monitor-card--warning',
    'verify-monitor-card--danger'
];
const ADMIN_AUDIT_MONITOR_CARD_TONE_CLASSES = [
    'admin-audit-monitor-card--neutral',
    'admin-audit-monitor-card--success',
    'admin-audit-monitor-card--warning',
    'admin-audit-monitor-card--danger'
];
const OPS_ALERT_MONITOR_CARD_TONE_CLASSES = [
    'ops-alert-monitor-card--neutral',
    'ops-alert-monitor-card--success',
    'ops-alert-monitor-card--warning',
    'ops-alert-monitor-card--danger'
];
const OPS_ALERT_MONITOR_SHIFT_REPORT_VIEW_DEFINITIONS = Object.freeze([
    Object.freeze({
        key: 'all',
        label: '全览',
        description: '同时查看积压模块、人员工作量、关闭原因和积压走势。',
        sections: Object.freeze(['categories', 'admins', 'close_reasons', 'trend'])
    }),
    Object.freeze({
        key: 'handoff',
        label: '交接优先',
        description: '优先查看待认领积压、接班负载和积压走势。',
        sections: Object.freeze(['categories', 'admins', 'trend'])
    }),
    Object.freeze({
        key: 'review',
        label: '闭环复盘',
        description: '优先查看本班处理产出、关闭原因和积压变化。',
        sections: Object.freeze(['admins', 'close_reasons', 'trend'])
    }),
    Object.freeze({
        key: 'mine',
        label: '我的接班',
        description: '只看当前值班管理员名下积压和个人处理量，更适合接班自检。',
        sections: Object.freeze(['categories', 'admins'])
    })
]);
const OPS_ALERT_HEALTH_CARD_TONE_CLASSES = [
    'ops-alert-health-card--neutral',
    'ops-alert-health-card--success',
    'ops-alert-health-card--warning',
    'ops-alert-health-card--danger'
];
const OPS_ALERT_OVERVIEW_CARD_TONE_CLASSES = [
    'ops-alert-overview-card--success',
    'ops-alert-overview-card--warning',
    'ops-alert-overview-card--danger'
];
const OPS_ALERT_OVERVIEW_BANNER_TONE_CLASSES = [
    'ops-alert-overview-banner--neutral',
    'ops-alert-overview-banner--success',
    'ops-alert-overview-banner--warning',
    'ops-alert-overview-banner--danger'
];
const OPS_ALERT_STRATEGY_PANEL_KEYS = Object.freeze(['mute', 'routing', 'work-hours']);
const OPS_ALERT_STRATEGY_MUTE_TAB_KEYS = Object.freeze(['types', 'modules']);
const OPS_ALERT_SUMMARY_PANEL_KEYS = Object.freeze(['overview']);
const OPS_ALERT_DATE_PICKER_MONTH_NAMES = Object.freeze([
    '一月',
    '二月',
    '三月',
    '四月',
    '五月',
    '六月',
    '七月',
    '八月',
    '九月',
    '十月',
    '十一月',
    '十二月'
]);
const OPS_ALERT_DATE_PICKER_WEEKDAY_NAMES = Object.freeze(['日', '一', '二', '三', '四', '五', '六']);
const OPS_ALERT_DATE_PICKER_PRESETS = Object.freeze([
    Object.freeze({ key: '1h', label: '1 小时', hours: 1 }),
    Object.freeze({ key: '6h', label: '6 小时', hours: 6 }),
    Object.freeze({ key: '24h', label: '24 小时', hours: 24 }),
    Object.freeze({ key: 'tonight', label: '今天结束', mode: 'end_of_day' })
]);
const OPS_ALERT_CUSTOMER_CHAT_QUICK_REPLY_BUSINESS_TYPES = Object.freeze([
    Object.freeze({ value: 'general', label: '通用接手', description: '任何客服会话都展示' }),
    Object.freeze({ value: 'order', label: '订单会话', description: '只有命中订单上下文时展示' }),
    Object.freeze({ value: 'payment', label: '充值会话', description: '只有命中充值上下文时展示' }),
    Object.freeze({ value: 'verification', label: '验证会话', description: '只有命中验证上下文时展示' }),
    Object.freeze({ value: 'ticket', label: '工单会话', description: '只有命中售后工单时展示' })
]);
const opsAlertDatePickerState = Object.create(null);
let opsAlertDatePickerEventsReady = false;
const OPS_ALERT_SUMMARY_ORCHESTRATION_DEFINITIONS = Object.freeze([
    Object.freeze({
        key: 'customer_chat_message',
        label: '客服消息',
        preset_group: 'low_priority',
        supports_work_hours_only: true,
        target_checkbox_id: 'opsAlertSummaryTargetCustomerChatMessage',
        monitor_status_id: 'opsAlertSummaryStatusCustomerChatMessageMonitor',
        work_hours_status_id: 'opsAlertSummaryStatusCustomerChatMessageWorkHours',
        summary_status_id: 'opsAlertSummaryStatusCustomerChatMessageSummary',
        enabled_toggle_id: 'opsAlertCustomerChatMessageEnabledToggle',
        work_hours_toggle_id: 'opsAlertCustomerChatMessageWorkHoursOnlyEnabledToggle',
        summary_toggle_id: 'opsAlertCustomerChatMessageSummaryEnabledToggle',
        summary_schedule_mode_id: 'opsAlertCustomerChatMessageSummaryScheduleMode',
        summary_window_minutes_id: 'opsAlertCustomerChatMessageSummaryWindowMinutes',
        summary_hourly_minute_id: 'opsAlertCustomerChatMessageSummaryHourlyMinute',
        summary_daily_hour_id: 'opsAlertCustomerChatMessageSummaryDailyHour',
        summary_daily_minute_id: 'opsAlertCustomerChatMessageSummaryDailyMinute',
        summary_max_items_id: 'opsAlertCustomerChatMessageSummaryMaxItems'
    }),
    Object.freeze({
        key: 'shop_purchase_success',
        label: '购买成功',
        preset_group: 'success',
        supports_work_hours_only: true,
        target_checkbox_id: 'opsAlertSummaryTargetShopPurchaseSuccess',
        monitor_status_id: 'opsAlertSummaryStatusShopPurchaseSuccessMonitor',
        work_hours_status_id: 'opsAlertSummaryStatusShopPurchaseSuccessWorkHours',
        summary_status_id: 'opsAlertSummaryStatusShopPurchaseSuccessSummary',
        enabled_toggle_id: 'opsAlertShopPurchaseSuccessEnabledToggle',
        work_hours_toggle_id: 'opsAlertShopPurchaseSuccessWorkHoursOnlyEnabledToggle',
        summary_toggle_id: 'opsAlertShopPurchaseSuccessSummaryEnabledToggle',
        summary_schedule_mode_id: 'opsAlertShopPurchaseSuccessSummaryScheduleMode',
        summary_window_minutes_id: 'opsAlertShopPurchaseSuccessSummaryWindowMinutes',
        summary_hourly_minute_id: 'opsAlertShopPurchaseSuccessSummaryHourlyMinute',
        summary_daily_hour_id: 'opsAlertShopPurchaseSuccessSummaryDailyHour',
        summary_daily_minute_id: 'opsAlertShopPurchaseSuccessSummaryDailyMinute',
        summary_max_items_id: 'opsAlertShopPurchaseSuccessSummaryMaxItems'
    }),
    Object.freeze({
        key: 'wallet_recharge_success',
        label: '充值成功',
        preset_group: 'success',
        supports_work_hours_only: true,
        target_checkbox_id: 'opsAlertSummaryTargetWalletRechargeSuccess',
        monitor_status_id: 'opsAlertSummaryStatusWalletRechargeSuccessMonitor',
        work_hours_status_id: 'opsAlertSummaryStatusWalletRechargeSuccessWorkHours',
        summary_status_id: 'opsAlertSummaryStatusWalletRechargeSuccessSummary',
        enabled_toggle_id: 'opsAlertWalletRechargeSuccessEnabledToggle',
        work_hours_toggle_id: 'opsAlertWalletRechargeSuccessWorkHoursOnlyEnabledToggle',
        summary_toggle_id: 'opsAlertWalletRechargeSuccessSummaryEnabledToggle',
        summary_schedule_mode_id: 'opsAlertWalletRechargeSuccessSummaryScheduleMode',
        summary_window_minutes_id: 'opsAlertWalletRechargeSuccessSummaryWindowMinutes',
        summary_hourly_minute_id: 'opsAlertWalletRechargeSuccessSummaryHourlyMinute',
        summary_daily_hour_id: 'opsAlertWalletRechargeSuccessSummaryDailyHour',
        summary_daily_minute_id: 'opsAlertWalletRechargeSuccessSummaryDailyMinute',
        summary_max_items_id: 'opsAlertWalletRechargeSuccessSummaryMaxItems'
    }),
    Object.freeze({
        key: 'shop_inventory',
        label: '库存与补货',
        preset_group: 'low_priority',
        supports_work_hours_only: false,
        target_checkbox_id: 'opsAlertSummaryTargetShopInventory',
        monitor_status_id: 'opsAlertSummaryStatusShopInventoryMonitor',
        work_hours_status_id: 'opsAlertSummaryStatusShopInventoryWorkHours',
        summary_status_id: 'opsAlertSummaryStatusShopInventorySummary',
        enabled_toggle_id: 'opsAlertShopInventoryEnabledToggle',
        work_hours_toggle_id: '',
        summary_toggle_id: 'opsAlertShopInventorySummaryEnabledToggle',
        summary_schedule_mode_id: 'opsAlertShopInventorySummaryScheduleMode',
        summary_window_minutes_id: 'opsAlertShopInventorySummaryWindowMinutes',
        summary_hourly_minute_id: 'opsAlertShopInventorySummaryHourlyMinute',
        summary_daily_hour_id: 'opsAlertShopInventorySummaryDailyHour',
        summary_daily_minute_id: 'opsAlertShopInventorySummaryDailyMinute',
        summary_max_items_id: 'opsAlertShopInventorySummaryMaxItems'
    }),
    Object.freeze({
        key: 'tickets',
        label: '工单与售后',
        preset_group: 'low_priority',
        supports_work_hours_only: true,
        target_checkbox_id: 'opsAlertSummaryTargetTickets',
        monitor_status_id: 'opsAlertSummaryStatusTicketsMonitor',
        work_hours_status_id: 'opsAlertSummaryStatusTicketsWorkHours',
        summary_status_id: 'opsAlertSummaryStatusTicketsSummary',
        enabled_toggle_id: 'opsAlertTicketsEnabledToggle',
        work_hours_toggle_id: 'opsAlertTicketsWorkHoursOnlyEnabledToggle',
        summary_toggle_id: 'opsAlertTicketsSummaryEnabledToggle',
        summary_schedule_mode_id: 'opsAlertTicketsSummaryScheduleMode',
        summary_window_minutes_id: 'opsAlertTicketsSummaryWindowMinutes',
        summary_hourly_minute_id: 'opsAlertTicketsSummaryHourlyMinute',
        summary_daily_hour_id: 'opsAlertTicketsSummaryDailyHour',
        summary_daily_minute_id: 'opsAlertTicketsSummaryDailyMinute',
        summary_max_items_id: 'opsAlertTicketsSummaryMaxItems'
    }),
    Object.freeze({
        key: 'shop_order_delivery',
        label: '履约失败 / 死信',
        preset_group: 'operations',
        supports_work_hours_only: true,
        target_checkbox_id: 'opsAlertSummaryTargetShopOrderDelivery',
        monitor_status_id: 'opsAlertSummaryStatusShopOrderDeliveryMonitor',
        work_hours_status_id: 'opsAlertSummaryStatusShopOrderDeliveryWorkHours',
        summary_status_id: 'opsAlertSummaryStatusShopOrderDeliverySummary',
        enabled_toggle_id: 'opsAlertShopOrderDeliveryEnabledToggle',
        work_hours_toggle_id: 'opsAlertShopOrderDeliveryWorkHoursOnlyEnabledToggle',
        summary_toggle_id: 'opsAlertShopOrderDeliverySummaryEnabledToggle',
        summary_schedule_mode_id: 'opsAlertShopOrderDeliverySummaryScheduleMode',
        summary_window_minutes_id: 'opsAlertShopOrderDeliverySummaryWindowMinutes',
        summary_hourly_minute_id: 'opsAlertShopOrderDeliverySummaryHourlyMinute',
        summary_daily_hour_id: 'opsAlertShopOrderDeliverySummaryDailyHour',
        summary_daily_minute_id: 'opsAlertShopOrderDeliverySummaryDailyMinute',
        summary_max_items_id: 'opsAlertShopOrderDeliverySummaryMaxItems'
    }),
    Object.freeze({
        key: 'payment_gateway',
        label: '支付通道异常',
        preset_group: 'operations',
        supports_work_hours_only: true,
        target_checkbox_id: 'opsAlertSummaryTargetPaymentGateway',
        monitor_status_id: 'opsAlertSummaryStatusPaymentGatewayMonitor',
        work_hours_status_id: 'opsAlertSummaryStatusPaymentGatewayWorkHours',
        summary_status_id: 'opsAlertSummaryStatusPaymentGatewaySummary',
        enabled_toggle_id: 'opsAlertPaymentGatewayEnabledToggle',
        work_hours_toggle_id: 'opsAlertPaymentGatewayWorkHoursOnlyEnabledToggle',
        summary_toggle_id: 'opsAlertPaymentGatewaySummaryEnabledToggle',
        summary_schedule_mode_id: 'opsAlertPaymentGatewaySummaryScheduleMode',
        summary_window_minutes_id: 'opsAlertPaymentGatewaySummaryWindowMinutes',
        summary_hourly_minute_id: 'opsAlertPaymentGatewaySummaryHourlyMinute',
        summary_daily_hour_id: 'opsAlertPaymentGatewaySummaryDailyHour',
        summary_daily_minute_id: 'opsAlertPaymentGatewaySummaryDailyMinute',
        summary_max_items_id: 'opsAlertPaymentGatewaySummaryMaxItems'
    }),
    Object.freeze({
        key: 'verify_quota',
        label: '验证额度',
        preset_group: 'operations',
        supports_work_hours_only: true,
        target_checkbox_id: 'opsAlertSummaryTargetVerifyQuota',
        monitor_status_id: 'opsAlertSummaryStatusVerifyQuotaMonitor',
        work_hours_status_id: 'opsAlertSummaryStatusVerifyQuotaWorkHours',
        summary_status_id: 'opsAlertSummaryStatusVerifyQuotaSummary',
        enabled_toggle_id: 'opsAlertVerifyQuotaEnabledToggle',
        work_hours_toggle_id: 'opsAlertVerifyQuotaWorkHoursOnlyEnabledToggle',
        summary_toggle_id: 'opsAlertVerifyQuotaSummaryEnabledToggle',
        summary_schedule_mode_id: 'opsAlertVerifyQuotaSummaryScheduleMode',
        summary_window_minutes_id: 'opsAlertVerifyQuotaSummaryWindowMinutes',
        summary_hourly_minute_id: 'opsAlertVerifyQuotaSummaryHourlyMinute',
        summary_daily_hour_id: 'opsAlertVerifyQuotaSummaryDailyHour',
        summary_daily_minute_id: 'opsAlertVerifyQuotaSummaryDailyMinute',
        summary_max_items_id: 'opsAlertVerifyQuotaSummaryMaxItems'
    }),
    Object.freeze({
        key: 'verify_queue',
        label: '验证堆积',
        preset_group: 'operations',
        supports_work_hours_only: true,
        target_checkbox_id: 'opsAlertSummaryTargetVerifyQueue',
        monitor_status_id: 'opsAlertSummaryStatusVerifyQueueMonitor',
        work_hours_status_id: 'opsAlertSummaryStatusVerifyQueueWorkHours',
        summary_status_id: 'opsAlertSummaryStatusVerifyQueueSummary',
        enabled_toggle_id: 'opsAlertVerifyQueueEnabledToggle',
        work_hours_toggle_id: 'opsAlertVerifyQueueWorkHoursOnlyEnabledToggle',
        summary_toggle_id: 'opsAlertVerifyQueueSummaryEnabledToggle',
        summary_schedule_mode_id: 'opsAlertVerifyQueueSummaryScheduleMode',
        summary_window_minutes_id: 'opsAlertVerifyQueueSummaryWindowMinutes',
        summary_hourly_minute_id: 'opsAlertVerifyQueueSummaryHourlyMinute',
        summary_daily_hour_id: 'opsAlertVerifyQueueSummaryDailyHour',
        summary_daily_minute_id: 'opsAlertVerifyQueueSummaryDailyMinute',
        summary_max_items_id: 'opsAlertVerifyQueueSummaryMaxItems'
    }),
    Object.freeze({
        key: 'verify_failure',
        label: '验证失败率',
        preset_group: 'operations',
        supports_work_hours_only: true,
        target_checkbox_id: 'opsAlertSummaryTargetVerifyFailure',
        monitor_status_id: 'opsAlertSummaryStatusVerifyFailureMonitor',
        work_hours_status_id: 'opsAlertSummaryStatusVerifyFailureWorkHours',
        summary_status_id: 'opsAlertSummaryStatusVerifyFailureSummary',
        enabled_toggle_id: 'opsAlertVerifyFailureEnabledToggle',
        work_hours_toggle_id: 'opsAlertVerifyFailureWorkHoursOnlyEnabledToggle',
        summary_toggle_id: 'opsAlertVerifyFailureSummaryEnabledToggle',
        summary_schedule_mode_id: 'opsAlertVerifyFailureSummaryScheduleMode',
        summary_window_minutes_id: 'opsAlertVerifyFailureSummaryWindowMinutes',
        summary_hourly_minute_id: 'opsAlertVerifyFailureSummaryHourlyMinute',
        summary_daily_hour_id: 'opsAlertVerifyFailureSummaryDailyHour',
        summary_daily_minute_id: 'opsAlertVerifyFailureSummaryDailyMinute',
        summary_max_items_id: 'opsAlertVerifyFailureSummaryMaxItems'
    })
]);
const OPS_ALERT_UNIFIED_SUMMARY_DRAFT_FIELD_IDS = Object.freeze({
    summaryScheduleMode: 'opsAlertUnifiedSummaryDraftScheduleMode',
    summaryWindowMinutes: 'opsAlertUnifiedSummaryDraftWindowMinutes',
    summaryHourlyMinute: 'opsAlertUnifiedSummaryDraftHourlyMinute',
    summaryDailyHour: 'opsAlertUnifiedSummaryDraftDailyHour',
    summaryDailyMinute: 'opsAlertUnifiedSummaryDraftDailyMinute',
    summaryMaxItems: 'opsAlertUnifiedSummaryDraftMaxItems',
    summaryModeHint: 'opsAlertUnifiedSummaryDraftModeHint'
});
const OPS_ALERT_MONITOR_CARD_CONFIG_IDS = Object.freeze([
    'ops-alerts-customer-chat-message',
    'ops-alerts-shop-purchase-success',
    'ops-alerts-wallet-recharge-success',
    'ops-alerts-shop-inventory',
    'ops-alerts-tickets',
    'ops-alerts-shop-order-delivery',
    'ops-alerts-payment-gateway',
    'ops-alerts-verify-quota',
    'ops-alerts-verify-queue',
    'ops-alerts-verify-failure',
    'ops-alerts-shop-risk'
]);
const OPS_ALERT_HEALTH_FETCH_TIMEOUT_MS = 8000;
const OPS_ALERT_MONITOR_FETCH_TIMEOUT_MS = 8000;
const VERIFY_MONITOR_FETCH_TIMEOUT_MS = 8000;
const ADMIN_CONFIG_RICH_TEXT_COLOR_SWATCH_CLASS_MAP = Object.freeze({
    '#ffffff': 'color-swatch--white',
    '#ffeb3b': 'color-swatch--yellow',
    '#ff9800': 'color-swatch--orange',
    '#4caf50': 'color-swatch--green',
    '#e57373': 'color-swatch--red',
    '#6b9ece': 'color-swatch--blue'
});
const ADMIN_CONFIG_AFFILIATE_POSTER_PRESET_CLASS_MAP = Object.freeze({
    midnight: 'affiliate-poster-preview--midnight',
    sunset: 'affiliate-poster-preview--sunset',
    crystal: 'affiliate-poster-preview--crystal'
});

function pulseAdminConfigToggle(toggleEl) {
    if (!toggleEl) return;
    toggleEl.classList.remove(ADMIN_CONFIG_TOGGLE_PULSE_CLASS);
    void toggleEl.offsetWidth;
    toggleEl.classList.add(ADMIN_CONFIG_TOGGLE_PULSE_CLASS);
    clearTimeout(toggleEl._adminConfigPulseTimer);
    toggleEl._adminConfigPulseTimer = setTimeout(() => {
        toggleEl.classList.remove(ADMIN_CONFIG_TOGGLE_PULSE_CLASS);
    }, 160);
}

function setAdminConfigHiddenState(target, hidden) {
    if (!target) return;
    target.hidden = !!hidden;
}

function showAdminConfigSaveIndicator(indicator, text = '✓ 已保存', durationMs = 1500) {
    if (!indicator) return;
    indicator.textContent = text;
    indicator.classList.add(ADMIN_CONFIG_SAVE_VISIBLE_CLASS);
    clearTimeout(indicator._adminConfigSaveTimer);
    indicator._adminConfigSaveTimer = setTimeout(() => {
        indicator.classList.remove(ADMIN_CONFIG_SAVE_VISIBLE_CLASS);
    }, durationMs);
}

function getAdminConfigRichTextColorClass(color) {
    return ADMIN_CONFIG_RICH_TEXT_COLOR_SWATCH_CLASS_MAP[color] || ADMIN_CONFIG_RICH_TEXT_COLOR_SWATCH_CLASS_MAP['#6b9ece'];
}

function applyAdminConfigRichTextColorSwatch(target, color, options = {}) {
    if (!target) return;
    const previewClass = options.preview ? 'preview' : '';
    target.className = ['color-swatch', previewClass, getAdminConfigRichTextColorClass(color)].filter(Boolean).join(' ');
}

function getAffiliatePosterPreviewClass(templateId) {
    return ADMIN_CONFIG_AFFILIATE_POSTER_PRESET_CLASS_MAP[templateId] || ADMIN_CONFIG_AFFILIATE_POSTER_PRESET_CLASS_MAP.midnight;
}

function renderVerifyQuotaState(quotaEl, tone, iconClass, message, options = {}) {
    if (!quotaEl) return;
    ADMIN_CONFIG_VERIFY_QUOTA_TONE_CLASSES.forEach((className) => quotaEl.classList.remove(className));
    quotaEl.classList.add('verify-quota-badge', `verify-quota-badge--${tone}`);
    const safeMessage = escapeConfigHtml(message);
    const textTag = options.emphasized ? 'strong' : 'span';
    quotaEl.innerHTML = `<i class="${iconClass} verify-quota-badge__icon" aria-hidden="true"></i> <${textTag} class="verify-quota-badge__text">${safeMessage}</${textTag}>`;
}

function normalizeVerifyMonitorStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || 'idle';
}

function getVerifyMonitorStatusMeta(status) {
    const normalized = normalizeVerifyMonitorStatus(status);
    return VERIFY_MONITOR_STATUS_META[normalized] || VERIFY_MONITOR_STATUS_META.unknown;
}

function formatVerifyMonitorDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

function formatDateTimeLocalInputValue(value) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ];
    const timeParts = [
        String(date.getHours()).padStart(2, '0'),
        String(date.getMinutes()).padStart(2, '0')
    ];
    return `${parts.join('-')}T${timeParts.join(':')}`;
}

function normalizeDateTimeLocalInputValue(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function formatVerifyMonitorMinutes(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return '—';
    if (num < 60) return `${Math.round(num)} 分钟`;
    const hours = Math.floor(num / 60);
    const minutes = Math.round(num % 60);
    return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

function formatVerifyMonitorInteger(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num.toLocaleString('zh-CN') : '—';
}

function formatVerifyMonitorDecimal(value, digits = 1) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return num.toLocaleString('zh-CN', {
        minimumFractionDigits: Number.isInteger(num) ? 0 : digits,
        maximumFractionDigits: digits
    });
}

function setVerifyMonitorCardTone(card, tone = 'neutral') {
    if (!card) return;
    VERIFY_MONITOR_CARD_TONE_CLASSES.forEach((className) => card.classList.remove(className));
    card.classList.add(`verify-monitor-card--${tone}`);
}

function updateVerifyMonitorOverviewCard(panelId, valueId, metaId, tone, valueText, metaText) {
    const panel = document.getElementById(panelId);
    const valueEl = document.getElementById(valueId);
    const metaEl = document.getElementById(metaId);
    setVerifyMonitorCardTone(panel, tone);
    if (valueEl) valueEl.textContent = valueText;
    if (metaEl) metaEl.textContent = metaText;
}

function renderVerifyMonitorEmptyState(target, message) {
    if (!target) return;
    target.innerHTML = `<div class="verify-monitor-empty">${escapeConfigHtml(message)}</div>`;
}

function getVerifySettingsSnapshot() {
    const config = systemConfigCache['verify_settings'] || {};
    const apiKeyInput = document.getElementById('cfgVerifyApiKey');
    const hasKey = Boolean(String(config.verify_api_key || '').trim())
        || String(apiKeyInput?.dataset?.hasKey || '').toLowerCase() === 'true';

    return {
        enabled: config.enabled !== false,
        hasKey,
        pricePerVerify: parseInt(config.price_per_verify, 10) || 10
    };
}

function renderVerifyMonitorHeaderTimestamp() {
    const target = document.getElementById('verifyMonitorLastRefresh');
    if (!target) return;

    if (verifyMonitorState.recent?.status === 'loading'
        || verifyMonitorState.queue?.status === 'loading'
        || verifyMonitorState.quota?.status === 'loading') {
        target.textContent = '正在刷新...';
        return;
    }

    const candidates = [
        verifyMonitorState.recent?.fetched_at,
        verifyMonitorState.queue?.checked_at,
        verifyMonitorState.quota?.checked_at
    ].filter(Boolean);
    const latest = candidates[0];
    target.textContent = latest
        ? `上次刷新 ${formatVerifyMonitorDateTime(latest)}`
        : '等待首次刷新';
}

function renderVerifyMonitorOverview() {
    const quotaState = verifyMonitorState.quota || getDefaultVerifyMonitorState().quota;
    const queueState = verifyMonitorState.queue || getDefaultVerifyMonitorState().queue;
    const recentState = verifyMonitorState.recent || getDefaultVerifyMonitorState().recent;
    const verifyConfig = getVerifySettingsSnapshot();

    if (quotaState.status === 'ready') {
        const balance = Number(quotaState.balance || 0);
        const tone = balance > 10 ? 'success' : balance > 0 ? 'warning' : 'danger';
        updateVerifyMonitorOverviewCard(
            'verifyMonitorQuotaPanel',
            'verifyMonitorQuotaValue',
            'verifyMonitorQuotaMeta',
            tone,
            `${formatVerifyMonitorDecimal(balance)} 点`,
            `API Key：${quotaState.key_name || '未命名'} · 已用 ${formatVerifyMonitorInteger(quotaState.total_used)} 次 · 单次成本 ${formatVerifyMonitorDecimal(quotaState.cost_per_job)}`
        );
    } else if (quotaState.status === 'loading') {
        updateVerifyMonitorOverviewCard(
            'verifyMonitorQuotaPanel',
            'verifyMonitorQuotaValue',
            'verifyMonitorQuotaMeta',
            'neutral',
            '查询中...',
            '正在读取 API 余额与单次成本。'
        );
    } else if (quotaState.status === 'error') {
        updateVerifyMonitorOverviewCard(
            'verifyMonitorQuotaPanel',
            'verifyMonitorQuotaValue',
            'verifyMonitorQuotaMeta',
            'danger',
            '查询失败',
            quotaState.message || '额度接口暂时不可用。'
        );
    } else {
        updateVerifyMonitorOverviewCard(
            'verifyMonitorQuotaPanel',
            'verifyMonitorQuotaValue',
            'verifyMonitorQuotaMeta',
            'neutral',
            '等待检测',
            '保存配置后会自动读取当前额度。'
        );
    }

    let serviceTone = 'neutral';
    let serviceValue = '待检测';
    let serviceMeta = '会综合启用状态、API Key 配置和最近一次接口探测结果。';
    if (!verifyConfig.enabled) {
        serviceTone = 'warning';
        serviceValue = '已关闭';
        serviceMeta = '前台验证模块已关闭，用户当前无法发起新的验证请求。';
    } else if (!verifyConfig.hasKey) {
        serviceTone = 'danger';
        serviceValue = '未配置 API Key';
        serviceMeta = '请先填写 ak_ 密钥，否则额度查询和实际验证都会失败。';
    } else if (quotaState.status === 'error' || queueState.status === 'error') {
        serviceTone = 'danger';
        serviceValue = '接口异常';
        serviceMeta = quotaState.status === 'error'
            ? (quotaState.message || '额度接口探测失败')
            : (queueState.message || '队列接口探测失败');
    } else if (quotaState.status === 'ready' || queueState.status === 'ready') {
        serviceTone = 'success';
        serviceValue = '运行正常';
        serviceMeta = `验证服务已启用 · 已配置 API Key · 每次验证 ${formatVerifyMonitorInteger(verifyConfig.pricePerVerify)} 积分`;
    } else if (quotaState.status === 'loading' || queueState.status === 'loading') {
        serviceTone = 'neutral';
        serviceValue = '检测中...';
        serviceMeta = '正在检查额度接口与队列接口状态。';
    }
    updateVerifyMonitorOverviewCard(
        'verifyMonitorServicePanel',
        'verifyMonitorServiceValue',
        'verifyMonitorServiceMeta',
        serviceTone,
        serviceValue,
        serviceMeta
    );

    if (queueState.status === 'ready') {
        const oldestLabel = recentState.summary?.oldest_active_minutes != null
            ? formatVerifyMonitorMinutes(recentState.summary.oldest_active_minutes)
            : '—';
        updateVerifyMonitorOverviewCard(
            'verifyMonitorQueuePanel',
            'verifyMonitorQueueValue',
            'verifyMonitorQueueMeta',
            Number(queueState.queue_size || 0) > 0 || Number(recentState.summary?.active_task_count || 0) > 0
                ? 'warning'
                : 'success',
            `排队 ${formatVerifyMonitorInteger(queueState.queue_size)} / 运行 ${formatVerifyMonitorInteger(queueState.running_jobs)}`,
            `本地活跃 ${formatVerifyMonitorInteger(recentState.summary?.active_task_count)} 个 · 最老任务 ${oldestLabel} · API Key ${queueState.key_name || quotaState.key_name || '未命名'}`
        );
    } else if (queueState.status === 'loading') {
        updateVerifyMonitorOverviewCard(
            'verifyMonitorQueuePanel',
            'verifyMonitorQueueValue',
            'verifyMonitorQueueMeta',
            'neutral',
            '查询中...',
            '正在读取上游排队、运行中任务和本地活跃任务。'
        );
    } else if (queueState.status === 'error') {
        updateVerifyMonitorOverviewCard(
            'verifyMonitorQueuePanel',
            'verifyMonitorQueueValue',
            'verifyMonitorQueueMeta',
            'danger',
            '查询失败',
            queueState.message || '队列接口暂时不可用。'
        );
    } else {
        updateVerifyMonitorOverviewCard(
            'verifyMonitorQueuePanel',
            'verifyMonitorQueueValue',
            'verifyMonitorQueueMeta',
            'neutral',
            '等待检测',
            '首次刷新后会显示上游排队、运行中任务和本地活跃任务。'
        );
    }
}

function buildVerifyMonitorRowMarkup(row) {
    const statusMeta = getVerifyMonitorStatusMeta(row.status);
    const rawJobLabel = String(row.verification_id || row.id || 'unknown').trim() || 'unknown';
    const jobLabel = escapeConfigHtml(summarizeAdminAuditMonitorText(rawJobLabel, 40));
    const identityParts = [
        row.email ? summarizeAdminAuditMonitorText(row.email, 32) : '',
        row.user_id ? summarizeAdminAuditMonitorText(row.user_id, 18) : '',
        row.site ? String(row.site).toUpperCase() : ''
    ].filter(Boolean).map((item) => escapeConfigHtml(item));
    const detailChips = [];
    const summaryText = String(row.summary || row.error_message || '暂无更多细节').trim() || '暂无更多细节';
    const identitySummary = identityParts.length ? identityParts.join(' · ') : '未记录身份信息';

    if (row.stage_label) {
        detailChips.push(buildAdminAuditMonitorInfoChip(
            '阶段',
            row.stage_label,
            { displayValue: summarizeAdminAuditMonitorText(row.stage_label, 20) }
        ));
    }

    if (row.raw_status && row.raw_status !== row.stage_label) {
        detailChips.push(buildAdminAuditMonitorInfoChip(
            '状态',
            row.raw_status,
            { displayValue: summarizeAdminAuditMonitorText(row.raw_status, 18) }
        ));
    }

    if (row.site) {
        detailChips.push(buildAdminAuditMonitorInfoChip('站点', row.site, { displayValue: String(row.site).toUpperCase() }));
    }

    if (Number(row.points_deducted) > 0) {
        detailChips.push(buildAdminAuditMonitorInfoChip('积分', formatVerifyMonitorInteger(row.points_deducted)));
    }

    if (row.error_code) {
        detailChips.push(buildAdminAuditMonitorInfoChip(
            '错误码',
            row.error_code,
            { displayValue: summarizeAdminAuditMonitorText(row.error_code, 18), tone: 'warning' }
        ));
    }

    if (row.url) {
        detailChips.push(buildAdminAuditMonitorInfoChip(
            '链接',
            row.url,
            { displayValue: formatAdminAuditMonitorUrlLabel(row.url) }
        ));
    }

    return `
        <article class="verify-monitor-item">
            <div class="verify-monitor-item__top">
                <span class="verify-monitor-status-badge verify-monitor-status-badge--${escapeConfigHtml(statusMeta.tone)}">${escapeConfigHtml(statusMeta.label)}</span>
                <strong class="verify-monitor-item__job" title="${escapeConfigHtml(rawJobLabel)}">${jobLabel}</strong>
                <span class="verify-monitor-item__time">${escapeConfigHtml(formatVerifyMonitorDateTime(row.created_at))}</span>
            </div>
            <div class="verify-monitor-item__summary" title="${escapeConfigHtml(summaryText)}">${escapeConfigHtml(summaryText)}</div>
            <div class="verify-monitor-item__meta" title="${escapeConfigHtml(identitySummary)}">${identitySummary}</div>
            ${detailChips.length ? `<div class="verify-monitor-item__chips">${detailChips.join('')}</div>` : ''}
        </article>
    `;
}

function renderVerifyMonitorLists() {
    const recentState = verifyMonitorState.recent || getDefaultVerifyMonitorState().recent;
    const tasksTarget = document.getElementById('verifyMonitorRecentTasks');
    const failuresTarget = document.getElementById('verifyMonitorRecentFailures');
    const tasksMeta = document.getElementById('verifyMonitorTasksMeta');
    const failuresMeta = document.getElementById('verifyMonitorFailuresMeta');

    if (tasksMeta) {
        tasksMeta.textContent = recentState.status === 'ready'
            ? `最近去重 ${formatVerifyMonitorInteger(recentState.summary?.deduped_task_count)} 条任务样本`
            : (recentState.status === 'loading' ? '正在同步...' : '等待加载');
    }

    if (failuresMeta) {
        failuresMeta.textContent = recentState.status === 'ready'
            ? `最近失败 ${formatVerifyMonitorInteger(recentState.summary?.failure_task_count)} 条`
            : (recentState.status === 'loading' ? '正在同步...' : '等待加载');
    }

    if (recentState.status === 'loading') {
        renderVerifyMonitorEmptyState(tasksTarget, '正在加载最近任务...');
        renderVerifyMonitorEmptyState(failuresTarget, '正在加载最近失败...');
        return;
    }

    if (recentState.status === 'error') {
        const message = recentState.message || '验证运维数据加载失败。';
        renderVerifyMonitorEmptyState(tasksTarget, message);
        renderVerifyMonitorEmptyState(failuresTarget, message);
        return;
    }

    const tasks = Array.isArray(recentState.recent_tasks) ? recentState.recent_tasks : [];
    const failures = Array.isArray(recentState.recent_failures) ? recentState.recent_failures : [];

    if (!tasks.length) {
        renderVerifyMonitorEmptyState(tasksTarget, '最近还没有可展示的验证任务。');
    } else if (tasksTarget) {
        tasksTarget.innerHTML = tasks.map(buildVerifyMonitorRowMarkup).join('');
    }

    if (!failures.length) {
        renderVerifyMonitorEmptyState(failuresTarget, '最近没有新的失败结果，可以继续保持观察。');
    } else if (failuresTarget) {
        failuresTarget.innerHTML = failures.map(buildVerifyMonitorRowMarkup).join('');
    }
}

function renderVerifyMonitorPanel() {
    renderVerifyMonitorHeaderTimestamp();
    renderVerifyMonitorOverview();
    renderVerifyMonitorLists();
}

function setAdminAuditMonitorCardTone(card, tone = 'neutral') {
    if (!card) return;
    ADMIN_AUDIT_MONITOR_CARD_TONE_CLASSES.forEach((className) => card.classList.remove(className));
    card.classList.add(`admin-audit-monitor-card--${tone}`);
}

function updateAdminAuditMonitorOverviewCard(panelId, valueId, metaId, tone, valueText, metaText) {
    const panel = document.getElementById(panelId);
    const valueEl = document.getElementById(valueId);
    const metaEl = document.getElementById(metaId);
    setAdminAuditMonitorCardTone(panel, tone);
    if (valueEl) valueEl.textContent = valueText;
    if (metaEl) metaEl.textContent = metaText;
}

function renderAdminAuditMonitorEmptyState(target, message) {
    if (!target) return;
    target.innerHTML = `<div class="admin-audit-monitor-empty">${escapeConfigHtml(message)}</div>`;
}

function getAdminAuditMonitorBadgeTone(type) {
    const normalized = String(type || '').trim().toLowerCase();
    if (['success', 'resolved', 'recovered'].includes(normalized)) return 'success';
    if (['warning', 'pending', 'open'].includes(normalized)) return 'warning';
    if (['critical', 'danger', 'failed', 'error'].includes(normalized)) return 'danger';
    return 'neutral';
}

function buildAdminAuditMonitorBadge(label, tone = 'neutral') {
    return `<span class="admin-audit-monitor-badge admin-audit-monitor-badge--${escapeConfigHtml(tone)}">${escapeConfigHtml(label)}</span>`;
}

function summarizeAdminAuditMonitorText(value, maxLength = 48) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatAdminAuditMonitorUrlLabel(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';

    try {
        const parsed = new URL(normalized);
        const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
        return summarizeAdminAuditMonitorText(`${parsed.hostname}${path}`, 44);
    } catch (error) {
        return summarizeAdminAuditMonitorText(normalized, 44);
    }
}

function buildAdminAuditMonitorInfoChip(label, value, options = {}) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) return '';

    const displayValue = String(options.displayValue || normalizedValue).trim() || normalizedValue;
    const toneClass = options.tone ? ` admin-audit-monitor-chip--${escapeConfigHtml(options.tone)}` : '';

    return `
        <span class="admin-audit-monitor-chip${toneClass}" title="${escapeConfigHtml(`${label}：${normalizedValue}`)}">
            <span class="admin-audit-monitor-chip__label">${escapeConfigHtml(label)}</span>
            <span class="admin-audit-monitor-chip__value">${escapeConfigHtml(displayValue)}</span>
        </span>
    `;
}

function summarizeAdminAuditMonitorList(values = [], maxItems = 2) {
    if (!Array.isArray(values) || !values.length) return '';
    const normalized = values
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    if (!normalized.length) return '';
    const visibleItems = normalized.slice(0, maxItems);
    const suffix = normalized.length > maxItems ? ` +${normalized.length - maxItems}` : '';
    return summarizeAdminAuditMonitorText(`${visibleItems.join('、')}${suffix}`, 48);
}

function renderAdminAuditMonitorTimestamp() {
    const target = document.getElementById('adminAuditMonitorLastRefresh');
    if (!target) return;

    if (adminAuditMonitorState.status === 'loading') {
        target.textContent = '正在刷新...';
        return;
    }

    target.textContent = adminAuditMonitorState.fetched_at
        ? `上次刷新 ${formatVerifyMonitorDateTime(adminAuditMonitorState.fetched_at)}`
        : '等待首次刷新';
}

function renderAdminAuditMonitorOverview() {
    const state = adminAuditMonitorState || getDefaultAdminAuditMonitorState();
    const accessSummary = state.access_summary || getDefaultAdminAuditMonitorState().access_summary;
    const configSummary = state.config_summary || getDefaultAdminAuditMonitorState().config_summary;
    const anomalies = Array.isArray(state.access_anomalies) ? state.access_anomalies : [];
    const latestAnomaly = anomalies[0] || null;

    if (state.status === 'loading') {
        updateAdminAuditMonitorOverviewCard(
            'adminAuditMonitorAccessCard',
            'adminAuditMonitorAccessValue',
            'adminAuditMonitorAccessMeta',
            'neutral',
            '查询中...',
            '正在读取最近后台访问。'
        );
        updateAdminAuditMonitorOverviewCard(
            'adminAuditMonitorAnomalyCard',
            'adminAuditMonitorAnomalyValue',
            'adminAuditMonitorAnomalyMeta',
            'neutral',
            '查询中...',
            '正在分析最近异常登录信号。'
        );
        updateAdminAuditMonitorOverviewCard(
            'adminAuditMonitorConfigCard',
            'adminAuditMonitorConfigValue',
            'adminAuditMonitorConfigMeta',
            'neutral',
            '查询中...',
            '正在同步支付配置审计。'
        );
        return;
    }

    if (state.status === 'error') {
        const message = state.message || '管理员访问审计加载失败。';
        updateAdminAuditMonitorOverviewCard(
            'adminAuditMonitorAccessCard',
            'adminAuditMonitorAccessValue',
            'adminAuditMonitorAccessMeta',
            'danger',
            '加载失败',
            message
        );
        updateAdminAuditMonitorOverviewCard(
            'adminAuditMonitorAnomalyCard',
            'adminAuditMonitorAnomalyValue',
            'adminAuditMonitorAnomalyMeta',
            'danger',
            '加载失败',
            message
        );
        updateAdminAuditMonitorOverviewCard(
            'adminAuditMonitorConfigCard',
            'adminAuditMonitorConfigValue',
            'adminAuditMonitorConfigMeta',
            'danger',
            '加载失败',
            message
        );
        return;
    }

    updateAdminAuditMonitorOverviewCard(
        'adminAuditMonitorAccessCard',
        'adminAuditMonitorAccessValue',
        'adminAuditMonitorAccessMeta',
        accessSummary.access_count > 0 ? 'success' : 'neutral',
        accessSummary.access_count > 0 ? `${formatVerifyMonitorInteger(accessSummary.access_count)} 次访问` : '暂无访问',
        accessSummary.access_count > 0
            ? `${formatVerifyMonitorInteger(accessSummary.distinct_admin_count)} 位管理员 · ${formatVerifyMonitorInteger(accessSummary.distinct_ip_count)} 个 IP`
            : '最近没有新的后台访问记录。'
    );

    updateAdminAuditMonitorOverviewCard(
        'adminAuditMonitorAnomalyCard',
        'adminAuditMonitorAnomalyValue',
        'adminAuditMonitorAnomalyMeta',
        accessSummary.anomaly_count > 0 ? 'danger' : 'success',
        accessSummary.anomaly_count > 0 ? `${formatVerifyMonitorInteger(accessSummary.anomaly_count)} 条异常信号` : '暂无异常信号',
        latestAnomaly
            ? `${latestAnomaly.admin_email || latestAnomaly.admin_id || 'unknown-admin'} · ${latestAnomaly.client_ip || '未知 IP'} · ${formatVerifyMonitorDateTime(latestAnomaly.created_at)}`
            : '最近窗口内没有发现新的 IP / 设备漂移。'
    );

    const configTone = configSummary.secret_delete_count > 0 || configSummary.mock_switch_count > 0
        ? 'warning'
        : (configSummary.config_change_count > 0 ? 'success' : 'neutral');
    updateAdminAuditMonitorOverviewCard(
        'adminAuditMonitorConfigCard',
        'adminAuditMonitorConfigValue',
        'adminAuditMonitorConfigMeta',
        configTone,
        configSummary.config_change_count > 0 ? `${formatVerifyMonitorInteger(configSummary.config_change_count)} 条配置审计` : '暂无配置变更',
        configSummary.config_change_count > 0
            ? `删密钥 ${formatVerifyMonitorInteger(configSummary.secret_delete_count)} 次 · mock 切换 ${formatVerifyMonitorInteger(configSummary.mock_switch_count)} 次`
            : '最近没有新的支付通道配置变更。'
    );
}

function buildAdminAuditAccessRowMarkup(row) {
    const summaryParts = [
        row.client_ip ? `IP ${escapeConfigHtml(row.client_ip)}` : '未记录来源 IP',
        row.granted ? '凭证已签发' : '仅记录访问'
    ];
    const detailChips = [
        row.user_agent_summary
            ? buildAdminAuditMonitorInfoChip('设备', row.user_agent_summary, {
                displayValue: summarizeAdminAuditMonitorText(row.user_agent_summary, 38)
            })
            : '',
        row.origin
            ? buildAdminAuditMonitorInfoChip('Origin', row.origin, {
                displayValue: formatAdminAuditMonitorUrlLabel(row.origin)
            })
            : '',
        row.referer
            ? buildAdminAuditMonitorInfoChip('Referer', row.referer, {
                displayValue: formatAdminAuditMonitorUrlLabel(row.referer)
            })
            : ''
    ].filter(Boolean);

    return `
        <article class="admin-audit-monitor-item">
            <div class="admin-audit-monitor-item__top">
                ${buildAdminAuditMonitorBadge(row.granted ? '已签发' : '记录', row.granted ? 'success' : 'neutral')}
                <strong class="admin-audit-monitor-item__title">${escapeConfigHtml(row.admin_email || row.admin_id || 'unknown-admin')}</strong>
                <span class="admin-audit-monitor-item__time">${escapeConfigHtml(formatVerifyMonitorDateTime(row.created_at))}</span>
            </div>
            <div class="admin-audit-monitor-item__summary">${summaryParts.join(' · ')}</div>
            ${detailChips.length ? `<div class="admin-audit-monitor-item__chips">${detailChips.join('')}</div>` : ''}
        </article>
    `;
}

function buildAdminAuditAnomalyRowMarkup(row) {
    const reasons = Array.isArray(row.anomaly_reasons) ? row.anomaly_reasons : [];
    const detailParts = [];
    if (row.client_ip) detailParts.push(`登录 IP：${escapeConfigHtml(row.client_ip)}`);
    if (row.user_agent_summary) detailParts.push(`设备：${escapeConfigHtml(row.user_agent_summary)}`);
    if (row.origin) detailParts.push(`Origin：${escapeConfigHtml(row.origin)}`);

    return `
        <article class="admin-audit-monitor-item">
            <div class="admin-audit-monitor-item__top">
                ${buildAdminAuditMonitorBadge('异常登录', 'danger')}
                <strong class="admin-audit-monitor-item__title">${escapeConfigHtml(row.admin_email || row.admin_id || 'unknown-admin')}</strong>
                <span class="admin-audit-monitor-item__time">${escapeConfigHtml(formatVerifyMonitorDateTime(row.created_at))}</span>
            </div>
            <div class="admin-audit-monitor-item__summary">${escapeConfigHtml(row.title || '管理员异常登录')}</div>
            <div class="admin-audit-monitor-item__meta">${reasons.length ? reasons.map((item) => escapeConfigHtml(item)).join('；') : '未记录详细判定信号'}</div>
            ${detailParts.length ? `<div class="admin-audit-monitor-item__detail">${detailParts.join(' · ')}</div>` : ''}
        </article>
    `;
}

function buildAdminAuditConfigRowMarkup(row) {
    const summaryParts = [
        row.action_label ? escapeConfigHtml(row.action_label) : '配置变更',
        row.severity ? escapeConfigHtml(row.severity.toUpperCase()) : 'INFO'
    ];
    const detailChips = [
        row.updated_provider_labels?.length
            ? buildAdminAuditMonitorInfoChip('通道', row.updated_provider_labels.join('、'), {
                displayValue: summarizeAdminAuditMonitorList(row.updated_provider_labels, 2)
            })
            : (row.active_provider_label
                ? buildAdminAuditMonitorInfoChip('当前', row.active_provider_label, {
                    displayValue: summarizeAdminAuditMonitorText(row.active_provider_label, 24)
                })
                : ''),
        row.secret_name
            ? buildAdminAuditMonitorInfoChip('删密钥', row.secret_name, {
                displayValue: summarizeAdminAuditMonitorText(row.secret_name, 26)
            })
            : (row.updated_secrets?.length
                ? buildAdminAuditMonitorInfoChip('更密钥', row.updated_secrets.join('、'), {
                    displayValue: summarizeAdminAuditMonitorList(row.updated_secrets, 2)
                })
                : ''),
        row.risk_flags?.length
            ? buildAdminAuditMonitorInfoChip('风险', row.risk_flags.join('；'), {
                displayValue: summarizeAdminAuditMonitorList(row.risk_flags, 1),
                tone: 'warning'
            })
            : ''
    ].filter(Boolean);
    const tone = getAdminAuditMonitorBadgeTone(
        row.risk_flags?.length ? 'warning' : row.severity
    );

    return `
        <article class="admin-audit-monitor-item">
            <div class="admin-audit-monitor-item__top">
                ${buildAdminAuditMonitorBadge(row.action_label || '配置变更', tone)}
                <strong class="admin-audit-monitor-item__title">${escapeConfigHtml(row.admin_email || row.admin_id || 'unknown-admin')}</strong>
                <span class="admin-audit-monitor-item__time">${escapeConfigHtml(formatVerifyMonitorDateTime(row.created_at))}</span>
            </div>
            <div class="admin-audit-monitor-item__summary">${escapeConfigHtml(row.title || '支付配置审计')}</div>
            <div class="admin-audit-monitor-item__meta">${summaryParts.join(' · ')}</div>
            ${detailChips.length ? `<div class="admin-audit-monitor-item__chips">${detailChips.join('')}</div>` : ''}
        </article>
    `;
}

function renderAdminAuditMonitorLists() {
    const state = adminAuditMonitorState || getDefaultAdminAuditMonitorState();
    const accessTarget = document.getElementById('adminAuditMonitorRecentAccess');
    const anomalyTarget = document.getElementById('adminAuditMonitorAnomalyList');
    const configTarget = document.getElementById('adminAuditMonitorConfigList');

    if (state.status === 'loading') {
        renderAdminAuditMonitorEmptyState(accessTarget, '正在加载最近后台访问...');
        renderAdminAuditMonitorEmptyState(anomalyTarget, '正在加载异常登录信号...');
        renderAdminAuditMonitorEmptyState(configTarget, '正在加载支付配置审计...');
        return;
    }

    if (state.status === 'error') {
        const message = state.message || '管理员访问审计加载失败。';
        renderAdminAuditMonitorEmptyState(accessTarget, message);
        renderAdminAuditMonitorEmptyState(anomalyTarget, message);
        renderAdminAuditMonitorEmptyState(configTarget, message);
        return;
    }

    const accessRows = Array.isArray(state.recent_accesses) ? state.recent_accesses : [];
    const anomalies = Array.isArray(state.access_anomalies) ? state.access_anomalies : [];
    const configEvents = Array.isArray(state.payment_config_events) ? state.payment_config_events : [];

    if (!accessRows.length) {
        renderAdminAuditMonitorEmptyState(accessTarget, '最近没有新的后台访问记录。');
    } else if (accessTarget) {
        accessTarget.innerHTML = accessRows.map(buildAdminAuditAccessRowMarkup).join('');
    }

    if (!anomalies.length) {
        renderAdminAuditMonitorEmptyState(anomalyTarget, '最近窗口内没有新的异常登录信号。');
    } else if (anomalyTarget) {
        anomalyTarget.innerHTML = anomalies.map(buildAdminAuditAnomalyRowMarkup).join('');
    }

    if (!configEvents.length) {
        renderAdminAuditMonitorEmptyState(configTarget, '最近没有新的支付配置审计记录。');
    } else if (configTarget) {
        configTarget.innerHTML = configEvents.map(buildAdminAuditConfigRowMarkup).join('');
    }
}

function renderAdminAuditMonitorPanel() {
    renderAdminAuditMonitorTimestamp();
    renderAdminAuditMonitorOverview();
    renderAdminAuditMonitorLists();
}

function getDefaultCheckinConfig() {
    return {
        base_points: 5,
        consecutive_7_points: 50,
        perfect_month_points: 200,
        makeup_cost_points: 10
    };
}

function getDefaultRechargeOptionsConfig() {
    return {
        custom_amount_enabled: false,
        mock_payment_enabled: false,
        custom_amount_min_points: 1,
        custom_amount_max_points: 50000,
        custom_amount_step: 1,
        custom_amount_points_per_cny: 50,
        custom_amount_quote_ttl_seconds: 1800
    };
}

function getDefaultPaymentChannelSecretStatus() {
    return {
        afdian_token: { configured: false, source: 'missing', updatedAt: null },
        hupijiao_api_key: { configured: false, source: 'missing', updatedAt: null },
        hupijiao_secret_key: { configured: false, source: 'missing', updatedAt: null }
    };
}

function getDefaultPaymentChannelRuntimeState() {
    return {
        mock_payment: {
            allowed: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
            reason: 'unknown',
            message: '暂时无法确认当前环境是否允许模拟支付。',
            override_configured: false,
            override_active: false,
            override_env_name: '',
            override_mode: 'none',
            cleanup_message: ''
        }
    };
}

function getDefaultOpsAlertSecretStatus() {
    return {
        telegram_bot_token: { configured: false, source: 'missing', updatedAt: null },
        feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null },
        email_api_key: { configured: false, source: 'missing', updatedAt: null }
    };
}

function getDefaultOpsAlertHealthState() {
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

function getDefaultOpsAlertMonitorShiftReport() {
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

function normalizeOpsAlertMonitorShiftReport(raw) {
    const defaults = getDefaultOpsAlertMonitorShiftReport();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
        ...defaults,
        ...source,
        totals: {
            ...defaults.totals,
            ...(source.totals && typeof source.totals === 'object' && !Array.isArray(source.totals)
                ? source.totals
                : {})
        },
        close_reasons: Array.isArray(source.close_reasons) ? source.close_reasons : [],
        admin_stats: Array.isArray(source.admin_stats) ? source.admin_stats : [],
        categories: Array.isArray(source.categories) ? source.categories : [],
        trend: Array.isArray(source.trend) ? source.trend : []
    };
}

function getDefaultOpsAlertMonitorState() {
    return {
        status: 'idle',
        fetched_at: '',
        summary: {
            lookback_hours: 7 * 24,
            total_job_count: 0,
            total_active_count: 0,
            total_critical_count: 0,
            active_category_count: 0,
            shift_report: getDefaultOpsAlertMonitorShiftReport()
        },
        assignable_admins: [],
        current_admin_id: '',
        current_admin_label: '',
        categories: [],
        message: '等待加载'
    };
}

function getDefaultOpsAlertMonitorViewState() {
    return {
        scope: 'all',
        severity: 'all',
        category: 'all'
    };
}

function getDefaultOpsAlertMonitorShiftReportViewState() {
    return 'all';
}

function getDefaultShopRiskCaseComposerState() {
    return {
        open: false,
        action: '',
        mode: 'single',
        context: {},
        items: [],
        selectedOwnerAdminId: '',
        selectedOwnerLabel: '',
        submitting: false
    };
}

function getDefaultOpsAlertBatchMuteState() {
    return {
        open: false,
        items: [],
        moduleKeys: [],
        categoryKey: '',
        filters: getDefaultOpsAlertMonitorViewState(),
        allowCritical: true,
        submitting: false
    };
}

function getDefaultVerifyMonitorState() {
    return {
        quota: {
            status: 'idle',
            balance: null,
            total_used: null,
            cost_per_job: null,
            key_name: '',
            message: '等待检测'
        },
        queue: {
            status: 'idle',
            queue_size: null,
            running_jobs: null,
            key_name: '',
            message: '等待检测'
        },
        recent: {
            status: 'idle',
            fetched_at: '',
            summary: {
                sample_size: 80,
                deduped_task_count: 0,
                active_task_count: 0,
                failure_task_count: 0,
                oldest_active_at: null,
                oldest_active_minutes: null
            },
            recent_tasks: [],
            recent_failures: [],
            message: '等待加载'
        }
    };
}

function getDefaultAdminAuditMonitorState() {
    return {
        status: 'idle',
        fetched_at: '',
        access_summary: {
            access_count: 0,
            distinct_admin_count: 0,
            distinct_ip_count: 0,
            anomaly_count: 0,
            latest_access_at: null
        },
        config_summary: {
            config_change_count: 0,
            secret_delete_count: 0,
            mock_switch_count: 0,
            latest_config_change_at: null
        },
        recent_accesses: [],
        access_anomalies: [],
        payment_config_events: [],
        message: '等待加载'
    };
}

function getDefaultOpsAlertConfig() {
    return {
        enabled: false,
        dedupe_window_minutes: 45,
        batch_size: 10,
        sweep_interval_ms: 15000,
        max_attempts: 6,
        retry_base_delay_ms: 60000,
        retry_max_delay_ms: 1800000,
        timeout_ms: 5000,
        temporary_mute: {
            until: '',
            allow_critical: true
        },
        quiet_hours: {
            enabled: false,
            start_hour: 23,
            end_hour: 8,
            timezone: 'Asia/Shanghai',
            allow_critical: true
        },
        work_hours: {
            enabled: false,
            start_hour: 9,
            end_hour: 18,
            timezone: 'Asia/Shanghai'
        },
        mute_rules: {
            types: {
                customer_chat_message: {
                    until: '',
                    allow_critical: true
                },
                shop_purchase_success: {
                    until: '',
                    allow_critical: true
                },
                wallet_recharge_success: {
                    until: '',
                    allow_critical: true
                },
                shop_inventory: {
                    until: '',
                    allow_critical: true
                },
                payment_refund_ops: {
                    until: '',
                    allow_critical: true
                },
                payment_config: {
                    until: '',
                    allow_critical: true
                },
                shop_order_risk: {
                    until: '',
                    allow_critical: true
                },
                admin_login_anomaly: {
                    until: '',
                    allow_critical: true
                },
                tickets: {
                    until: '',
                    allow_critical: true
                },
                shop_order_delivery: {
                    until: '',
                    allow_critical: true
                },
                payment_gateway: {
                    until: '',
                    allow_critical: true
                },
                verify_quota: {
                    until: '',
                    allow_critical: true
                },
                verify_queue: {
                    until: '',
                    allow_critical: true
                },
                verify_failure: {
                    until: '',
                    allow_critical: true
                }
            },
            modules: {
                customer_engagement: {
                    until: '',
                    allow_critical: true
                },
                commerce: {
                    until: '',
                    allow_critical: true
                },
                inventory: {
                    until: '',
                    allow_critical: true
                },
                payments: {
                    until: '',
                    allow_critical: true
                },
                shop_risk: {
                    until: '',
                    allow_critical: true
                },
                verify: {
                    until: '',
                    allow_critical: true
                },
                tickets: {
                    until: '',
                    allow_critical: true
                },
                fulfillment: {
                    until: '',
                    allow_critical: true
                },
                security: {
                    until: '',
                    allow_critical: true
                }
            }
        },
        channels: {
            telegram: {
                enabled: false,
                minimum_severity: 'warning',
                chat_ids: []
            },
            feishu: {
                enabled: false,
                minimum_severity: 'warning'
            },
            email: {
                enabled: false,
                minimum_severity: 'warning',
                recipients: [],
                from_address: '',
                reply_to: '',
                subject_prefix: '[Zaoyoe告警]'
            }
        },
        routing: {
            customer_chat_message: {
                telegram: true,
                feishu: true,
                email: true
            },
            shop_purchase_success: {
                telegram: true,
                feishu: true,
                email: true
            },
            wallet_recharge_success: {
                telegram: true,
                feishu: true,
                email: true
            },
            shop_inventory: {
                telegram: true,
                feishu: true,
                email: true
            },
            payment_refund_ops: {
                telegram: true,
                feishu: true,
                email: true
            },
            payment_config: {
                telegram: true,
                feishu: true,
                email: true
            },
            shop_order_risk: {
                telegram: true,
                feishu: true,
                email: true
            },
            admin_login_anomaly: {
                telegram: true,
                feishu: true,
                email: true
            },
            tickets: {
                telegram: true,
                feishu: true,
                email: true
            },
            shop_order_delivery: {
                telegram: true,
                feishu: true,
                email: true
            },
            payment_gateway: {
                telegram: true,
                feishu: true,
                email: true
            },
            verify_quota: {
                telegram: true,
                feishu: true,
                email: true
            },
            verify_queue: {
                telegram: true,
                feishu: true,
                email: true
            },
            verify_failure: {
                telegram: true,
                feishu: true,
                email: true
            }
        },
        shop_order_risk: {
            auto_response_enabled: true,
            auto_disable_coupon_min_risk_score: 90,
            auto_ban_user_min_risk_score: 96,
            auto_ban_user_duration_days: 7,
            auto_suspend_product_min_risk_score: 97
        },
        shop_inventory: {
            enabled: true,
            low_stock_threshold: 5,
            sweep_interval_ms: 15 * 60 * 1000,
            sales_window_days: 7,
            dedupe_window_minutes: 6 * 60,
            recovery_notification_enabled: true,
            summary_enabled: false,
            summary_window_minutes: 60,
            summary_max_items: 10,
            summary_schedule_mode: 'rolling_window',
            summary_hourly_minute: 0,
            summary_daily_hour: 9,
            summary_daily_minute: 0
        },
        customer_chat_message: {
            enabled: true,
            sweep_interval_ms: 60 * 1000,
            lookback_minutes: 15,
            dedupe_window_minutes: 12 * 60,
            work_hours_only_enabled: false,
            summary_enabled: false,
            summary_window_minutes: 60,
            summary_max_items: 10,
            summary_schedule_mode: 'rolling_window',
            summary_hourly_minute: 0,
            summary_daily_hour: 9,
            summary_daily_minute: 0,
            quick_reply_templates: getDefaultOpsAlertCustomerChatQuickReplyTemplates()
        },
        shop_purchase_success: {
            enabled: true,
            sweep_interval_ms: 2 * 60 * 1000,
            lookback_minutes: 30,
            dedupe_window_minutes: 24 * 60,
            work_hours_only_enabled: false,
            summary_enabled: false,
            summary_window_minutes: 60,
            summary_max_items: 10,
            summary_schedule_mode: 'rolling_window',
            summary_hourly_minute: 0,
            summary_daily_hour: 9,
            summary_daily_minute: 0
        },
        wallet_recharge_success: {
            enabled: true,
            sweep_interval_ms: 2 * 60 * 1000,
            lookback_minutes: 30,
            dedupe_window_minutes: 24 * 60,
            work_hours_only_enabled: false,
            summary_enabled: false,
            summary_window_minutes: 60,
            summary_max_items: 10,
            summary_schedule_mode: 'rolling_window',
            summary_hourly_minute: 0,
            summary_daily_hour: 9,
            summary_daily_minute: 0
        },
        tickets: {
            enabled: true,
            sweep_interval_ms: 10 * 60 * 1000,
            pending_overdue_minutes: 120,
            critical_overdue_minutes: 12 * 60,
            state_lookback_minutes: 24 * 60,
            dedupe_window_minutes: 60,
            page_size: 500,
            max_pages: 10,
            work_hours_only_enabled: false,
            summary_enabled: false,
            summary_window_minutes: 60,
            summary_max_items: 10,
            summary_schedule_mode: 'rolling_window',
            summary_hourly_minute: 0,
            summary_daily_hour: 9,
            summary_daily_minute: 0
        },
        shop_order_delivery: {
            enabled: true,
            sweep_interval_ms: 10 * 60 * 1000,
            lookback_days: 14,
            state_lookback_minutes: 24 * 60,
            retry_waiting_min_attempts: 2,
            dedupe_window_minutes: 30,
            incident_enabled: true,
            incident_min_order_count: 3,
            incident_min_dead_letter_count: 1,
            incident_min_distinct_users: 2,
            incident_dedupe_window_minutes: 20,
            page_size: 500,
            max_pages: 10,
            work_hours_only_enabled: false,
            summary_enabled: false,
            summary_window_minutes: 60,
            summary_max_items: 10,
            summary_schedule_mode: 'rolling_window',
            summary_hourly_minute: 0,
            summary_daily_hour: 9,
            summary_daily_minute: 0
        },
        verify_quota: {
            enabled: true,
            sweep_interval_ms: 15 * 60 * 1000,
            request_timeout_ms: 10000,
            low_balance_threshold: 20,
            low_remaining_jobs_threshold: 20,
            critical_balance_threshold: 5,
            critical_remaining_jobs_threshold: 5,
            min_queue_buffer_jobs: 5,
            dedupe_window_minutes: 6 * 60,
            work_hours_only_enabled: false,
            summary_enabled: false,
            summary_window_minutes: 60,
            summary_max_items: 10,
            summary_schedule_mode: 'rolling_window',
            summary_hourly_minute: 0,
            summary_daily_hour: 9,
            summary_daily_minute: 0
        },
        verify_queue: {
            enabled: true,
            sweep_interval_ms: 10 * 60 * 1000,
            request_timeout_ms: 10000,
            recent_activity_lookback_hours: 12,
            recent_failure_window_minutes: 30,
            queue_size_threshold: 10,
            active_job_threshold: 8,
            oldest_pending_minutes_threshold: 20,
            recent_failure_threshold: 4,
            dedupe_window_minutes: 30,
            page_size: 500,
            max_pages: 10,
            work_hours_only_enabled: false,
            summary_enabled: false,
            summary_window_minutes: 60,
            summary_max_items: 10,
            summary_schedule_mode: 'rolling_window',
            summary_hourly_minute: 0,
            summary_daily_hour: 9,
            summary_daily_minute: 0
        },
        verify_failure: {
            enabled: true,
            sweep_interval_ms: 10 * 60 * 1000,
            recent_window_minutes: 30,
            min_total_jobs_threshold: 6,
            failure_rate_threshold: 60,
            affected_user_threshold: 3,
            dedupe_window_minutes: 15,
            page_size: 500,
            max_pages: 10,
            work_hours_only_enabled: false,
            summary_enabled: false,
            summary_window_minutes: 60,
            summary_max_items: 10,
            summary_schedule_mode: 'rolling_window',
            summary_hourly_minute: 0,
            summary_daily_hour: 9,
            summary_daily_minute: 0
        },
        payment_gateway: {
            enabled: true,
            window_minutes: 30,
            state_lookback_minutes: 24 * 60,
            sweep_interval_ms: 5 * 60 * 1000,
            dedupe_window_minutes: 60,
            min_order_volume: 6,
            min_review_orders: 4,
            min_failed_orders: 3,
            min_webhook_volume: 5,
            min_query_volume: 5,
            max_paid_rate_percent: 65,
            min_review_ratio_percent: 45,
            min_failed_ratio_percent: 25,
            max_webhook_success_rate_percent: 70,
            max_query_success_rate_percent: 60,
            min_webhook_5xx_count: 3,
            min_query_5xx_count: 3,
            page_size: 500,
            max_pages: 20,
            work_hours_only_enabled: false,
            summary_enabled: false,
            summary_window_minutes: 60,
            summary_max_items: 10,
            summary_schedule_mode: 'rolling_window',
            summary_hourly_minute: 0,
            summary_daily_hour: 9,
            summary_daily_minute: 0
        }
    };
}

function normalizeConfigBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
}

function normalizeConfigStringArray(value) {
    if (Array.isArray(value)) {
        return Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean)));
    }

    if (typeof value === 'string') {
        return Array.from(new Set(
            value
                .split(/[\n,]/)
                .map((item) => String(item ?? '').trim())
                .filter(Boolean)
        ));
    }

    return [];
}

function normalizeOpsAlertSeverity(value, fallback = 'warning') {
    const normalized = String(value ?? '').trim().toLowerCase();
    return ['info', 'warning', 'critical'].includes(normalized) ? normalized : fallback;
}

function normalizeOpsAlertSummaryScheduleMode(value, fallback = 'rolling_window') {
    const normalized = String(value ?? '').trim().toLowerCase();
    return ['rolling_window', 'hourly', 'daily'].includes(normalized) ? normalized : fallback;
}

function formatOpsAlertTimeNumber(value, fallback = 0, max = 59) {
    return String(clamp(toWholeNumber(value, fallback), 0, max)).padStart(2, '0');
}

function formatOpsAlertHourMinute(hour, minute) {
    return `${formatOpsAlertTimeNumber(hour, 0, 23)}:${formatOpsAlertTimeNumber(minute, 0, 59)}`;
}

function formatOpsAlertHourRangePreview(startHour, endHour, options = {}) {
    const startLabel = formatOpsAlertHourMinute(startHour, 0);
    const endLabel = formatOpsAlertHourMinute(endHour, 0);
    const timezone = String(options.timezone || '').trim();

    if (startLabel === endLabel) {
        return timezone
            ? `每天全天生效（${timezone}）`
            : '每天全天生效';
    }

    const crossesMidnight = clamp(toWholeNumber(startHour, 0), 0, 23) > clamp(toWholeNumber(endHour, 0), 0, 23);
    const rangeLabel = crossesMidnight
        ? `每天 ${startLabel} 开始，次日 ${endLabel} 结束`
        : `每天 ${startLabel} - ${endLabel}`;
    return timezone ? `${rangeLabel}（${timezone}）` : rangeLabel;
}

function formatOpsAlertRelativeDuration(targetDate, referenceDate = new Date()) {
    const targetTime = targetDate instanceof Date ? targetDate.getTime() : Number(targetDate);
    const referenceTime = referenceDate instanceof Date ? referenceDate.getTime() : Number(referenceDate);
    const deltaMs = Math.max(0, targetTime - referenceTime);
    const totalMinutes = Math.max(0, Math.round(deltaMs / 60000));
    const totalHours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    const totalDays = Math.floor(totalHours / 24);
    const remainingHours = totalHours % 24;

    if (totalDays > 0) {
        return remainingHours > 0
            ? `${totalDays} 天 ${remainingHours} 小时`
            : `${totalDays} 天`;
    }
    if (totalHours > 0) {
        return remainingMinutes > 0
            ? `${totalHours} 小时 ${remainingMinutes} 分钟`
            : `${totalHours} 小时`;
    }
    return `${Math.max(1, totalMinutes)} 分钟`;
}

function formatOpsAlertSummaryScheduleDescription(section = {}) {
    const scheduleMode = normalizeOpsAlertSummaryScheduleMode(section.summary_schedule_mode, 'rolling_window');
    if (scheduleMode === 'hourly') {
        return `每小时 ${formatOpsAlertTimeNumber(section.summary_hourly_minute, 0, 59)} 分`;
    }
    if (scheduleMode === 'daily') {
        return `每天 ${formatOpsAlertHourMinute(section.summary_daily_hour, section.summary_daily_minute)}`;
    }
    return `滚动窗口 ${formatVerifyMonitorInteger(section.summary_window_minutes || 0)} 分钟`;
}

function buildOpsAlertSummaryOrchestrationBadgeHtml(label, tone = 'neutral') {
    return `<span class="ops-alert-summary-orchestration-badge ops-alert-summary-orchestration-badge--${escapeConfigHtml(tone)}">${escapeConfigHtml(label)}</span>`;
}

function setOpsAlertSummaryOrchestrationCell(cellId, tone, label, text) {
    const cell = document.getElementById(cellId);
    if (!cell) return;

    const normalizedText = String(text || '').trim();
    cell.innerHTML = `${buildOpsAlertSummaryOrchestrationBadgeHtml(label, tone)}${normalizedText ? `<div>${escapeConfigHtml(normalizedText)}</div>` : ''}`;
}

function getOpsAlertSummaryOrchestrationSelectedDefinitions() {
    return OPS_ALERT_SUMMARY_ORCHESTRATION_DEFINITIONS.filter((definition) => (
        document.getElementById(definition.target_checkbox_id)?.checked === true
    ));
}

function setOpsAlertUnifiedSummaryDraftFieldValues(draft = {}) {
    const summaryEnabledInput = document.getElementById('opsAlertUnifiedSummaryDraftEnabled');
    if (summaryEnabledInput instanceof HTMLInputElement) {
        summaryEnabledInput.checked = draft.summary_enabled === true;
    }

    const workHoursOnlyInput = document.getElementById('opsAlertUnifiedSummaryDraftWorkHoursOnlyEnabled');
    if (workHoursOnlyInput instanceof HTMLInputElement) {
        workHoursOnlyInput.checked = draft.work_hours_only_enabled === true;
    }

    const scheduleModeInput = document.getElementById('opsAlertUnifiedSummaryDraftScheduleMode');
    if (scheduleModeInput instanceof HTMLSelectElement) {
        scheduleModeInput.value = normalizeOpsAlertSummaryScheduleMode(
            draft.summary_schedule_mode,
            'rolling_window'
        );
    }

    const windowMinutesInput = document.getElementById('opsAlertUnifiedSummaryDraftWindowMinutes');
    if (windowMinutesInput instanceof HTMLInputElement) {
        windowMinutesInput.value = String(clamp(toWholeNumber(draft.summary_window_minutes, 60), 5, 24 * 60));
    }

    const hourlyMinuteInput = document.getElementById('opsAlertUnifiedSummaryDraftHourlyMinute');
    if (hourlyMinuteInput instanceof HTMLInputElement) {
        hourlyMinuteInput.value = String(clamp(toWholeNumber(draft.summary_hourly_minute, 0), 0, 59));
    }

    const dailyHourInput = document.getElementById('opsAlertUnifiedSummaryDraftDailyHour');
    if (dailyHourInput instanceof HTMLInputElement) {
        dailyHourInput.value = String(clamp(toWholeNumber(draft.summary_daily_hour, 9), 0, 23));
    }

    const dailyMinuteInput = document.getElementById('opsAlertUnifiedSummaryDraftDailyMinute');
    if (dailyMinuteInput instanceof HTMLInputElement) {
        dailyMinuteInput.value = String(clamp(toWholeNumber(draft.summary_daily_minute, 0), 0, 59));
    }

    const maxItemsInput = document.getElementById('opsAlertUnifiedSummaryDraftMaxItems');
    if (maxItemsInput instanceof HTMLInputElement) {
        maxItemsInput.value = String(clamp(toWholeNumber(draft.summary_max_items, 10), 1, 50));
    }
}

function resolveOpsAlertSharedRuntimeMethod(methodName = '') {
    const normalizedMethodName = String(methodName || '').trim();
    if (!normalizedMethodName) {
        return null;
    }
    const candidate = window[normalizedMethodName];
    return typeof candidate === 'function' ? candidate : null;
}

function resolveOpsAlertSharedCallable(methodName = '', localCallable = null, optionsBuilder = null) {
    const sharedMethod = resolveOpsAlertSharedRuntimeMethod(methodName);
    if (!sharedMethod) {
        return localCallable;
    }
    return (...args) => {
        const options = typeof optionsBuilder === 'function' ? optionsBuilder(...args) : undefined;
        return options === undefined ? sharedMethod(...args) : sharedMethod(...args, options);
    };
}

function requireOpsAlertWorkbenchMethod(methodName = '') {
    const sharedMethod = resolveOpsAlertSharedRuntimeMethod(methodName);
    if (typeof sharedMethod !== 'function') {
        throw new Error(`[Config] Missing admin workbench method: ${methodName}`);
    }
    return sharedMethod;
}

function resolveOpsAlertUnifiedSummaryDraftConsensus(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts']), selectedDefinitions = getOpsAlertSummaryOrchestrationSelectedDefinitions()) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    if (!selectedDefinitions.length) {
        return null;
    }
    return requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertUnifiedSummaryConsensus')(normalizedConfig, {
        definitions: OPS_ALERT_SUMMARY_ORCHESTRATION_DEFINITIONS,
        selectedDefinitions,
        defaults: getDefaultOpsAlertConfig(),
        normalizeScheduleMode: normalizeOpsAlertSummaryScheduleMode,
        clamp,
        toWholeNumber
    });
}

function syncOpsAlertUnifiedSummaryDraftFromSelection(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts']), options = {}) {
    if (opsAlertUnifiedSummaryDraftDirty && options.force !== true) {
        return;
    }

    const consensus = resolveOpsAlertUnifiedSummaryDraftConsensus(config);
    if (!consensus) {
        return;
    }

    const nextDraft = {
        ...collectOpsAlertUnifiedSummaryDraftFromForm()
    };
    Object.entries(consensus).forEach(([key, value]) => {
        if (value !== undefined) {
            nextDraft[key] = value;
        }
    });

    setOpsAlertUnifiedSummaryDraftFieldValues(nextDraft);
    opsAlertUnifiedSummaryDraftDirty = false;
}

function resolveOpsAlertUnifiedSummaryDraft() {
    return requireOpsAlertWorkbenchMethod('collectAdminWorkbenchOpsAlertUnifiedSummaryDraft')({}, {
        document,
        ids: {
            summaryEnabled: 'opsAlertUnifiedSummaryDraftEnabled',
            workHoursOnlyEnabled: 'opsAlertUnifiedSummaryDraftWorkHoursOnlyEnabled',
            summaryScheduleMode: 'opsAlertUnifiedSummaryDraftScheduleMode',
            summaryWindowMinutes: 'opsAlertUnifiedSummaryDraftWindowMinutes',
            summaryHourlyMinute: 'opsAlertUnifiedSummaryDraftHourlyMinute',
            summaryDailyHour: 'opsAlertUnifiedSummaryDraftDailyHour',
            summaryDailyMinute: 'opsAlertUnifiedSummaryDraftDailyMinute',
            summaryMaxItems: 'opsAlertUnifiedSummaryDraftMaxItems'
        },
        normalizeScheduleMode: normalizeOpsAlertSummaryScheduleMode,
        clamp,
        toWholeNumber
    });
}

function collectOpsAlertUnifiedSummaryDraftFromForm() {
    return resolveOpsAlertUnifiedSummaryDraft();
}

function setOpsAlertSummaryModeRowVisibility(inputId, isVisible) {
    const row = document.getElementById(inputId)?.closest('.config-row');
    if (row) {
        row.hidden = !isVisible;
    }
}

function ensureOpsAlertSummaryModeHintElement(ids = {}) {
    const hintId = ids.summaryModeHint || `${ids.summaryScheduleMode || 'opsAlertSummaryMode'}Hint`;
    let hintEl = document.getElementById(hintId);
    const anchorRow = document.getElementById(ids.summaryMaxItems)?.closest('.config-row');
    if (!anchorRow) {
        return null;
    }

    if (!hintEl) {
        hintEl = document.createElement('div');
        hintEl.id = hintId;
        hintEl.className = 'config-inline-note ops-alert-summary-mode-note';
        hintEl.innerHTML = '<i class="fas fa-circle-info" aria-hidden="true"></i><span></span>';
        anchorRow.parentNode?.insertBefore(hintEl, anchorRow);
    }

    return hintEl;
}

function applyOpsAlertSummaryModeControlStateToDom(controlState = {}, ids = {}, options = {}) {
    const normalizedIds = {
        ...ids,
        summaryModeHint: ids.summaryModeHint || `${ids.summaryScheduleMode || 'opsAlertSummaryMode'}Hint`
    };
    const valueSource = options.valueSource && typeof options.valueSource === 'object'
        ? options.valueSource
        : null;

    const scheduleModeInput = document.getElementById(normalizedIds.summaryScheduleMode);
    if (scheduleModeInput) {
        if (valueSource && valueSource.summary_schedule_mode !== undefined) {
            scheduleModeInput.value = String(valueSource.summary_schedule_mode || 'rolling_window');
        }
        scheduleModeInput.disabled = controlState.scheduleModeDisabled === true;
    }

    if (options.populateAllValues === true && valueSource) {
        const inputValuePairs = [
            [normalizedIds.summaryWindowMinutes, valueSource.summary_window_minutes],
            [normalizedIds.summaryHourlyMinute, valueSource.summary_hourly_minute],
            [normalizedIds.summaryDailyHour, valueSource.summary_daily_hour],
            [normalizedIds.summaryDailyMinute, valueSource.summary_daily_minute],
            [normalizedIds.summaryMaxItems, valueSource.summary_max_items]
        ];
        inputValuePairs.forEach(([id, value]) => {
            const input = document.getElementById(id);
            if (input && value !== undefined && value !== null) {
                input.value = String(value);
            }
        });
    }

    const rollingWindowInput = document.getElementById(normalizedIds.summaryWindowMinutes);
    if (rollingWindowInput) {
        rollingWindowInput.disabled = controlState.summaryWindowMinutesDisabled === true;
    }
    const hourlyMinuteInput = document.getElementById(normalizedIds.summaryHourlyMinute);
    if (hourlyMinuteInput) {
        hourlyMinuteInput.disabled = controlState.summaryHourlyMinuteDisabled === true;
    }
    const dailyHourInput = document.getElementById(normalizedIds.summaryDailyHour);
    if (dailyHourInput) {
        dailyHourInput.disabled = controlState.summaryDailyHourDisabled === true;
    }
    const dailyMinuteInput = document.getElementById(normalizedIds.summaryDailyMinute);
    if (dailyMinuteInput) {
        dailyMinuteInput.disabled = controlState.summaryDailyMinuteDisabled === true;
    }
    const summaryMaxItemsInput = document.getElementById(normalizedIds.summaryMaxItems);
    if (summaryMaxItemsInput) {
        summaryMaxItemsInput.disabled = controlState.summaryMaxItemsDisabled === true;
    }

    setOpsAlertSummaryModeRowVisibility(normalizedIds.summaryWindowMinutes, controlState.rows?.summaryWindowMinutesVisible === true);
    setOpsAlertSummaryModeRowVisibility(normalizedIds.summaryHourlyMinute, controlState.rows?.summaryHourlyMinuteVisible === true);
    setOpsAlertSummaryModeRowVisibility(normalizedIds.summaryDailyHour, controlState.rows?.summaryDailyHourVisible === true);
    setOpsAlertSummaryModeRowVisibility(normalizedIds.summaryDailyMinute, controlState.rows?.summaryDailyMinuteVisible === true);

    const hintEl = ensureOpsAlertSummaryModeHintElement(normalizedIds);
    const hintCopyEl = hintEl?.querySelector('span');
    if (hintCopyEl) {
        hintCopyEl.textContent = controlState.hintText || '';
    }
    if (hintEl) {
        hintEl.classList.toggle('is-disabled', controlState.hintDisabled === true);
    }
}

function resolveOpsAlertSummaryModeControlState(monitorConfig = {}, options = {}) {
    const monitorEnabled = options.monitorEnabled === undefined
        ? monitorConfig.enabled === true
        : options.monitorEnabled === true;
    const summaryEnabled = options.summaryEnabled === undefined
        ? monitorConfig.summary_enabled === true
        : options.summaryEnabled === true;
    return requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertSummaryModeControlState')(monitorConfig, {
        normalizeScheduleMode: normalizeOpsAlertSummaryScheduleMode,
        getHintText: (section, hintOptions = {}) => requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertSummaryModeHintText')(section, {
            normalizeScheduleMode: normalizeOpsAlertSummaryScheduleMode,
            formatCount: typeof hintOptions.formatCount === 'function' ? hintOptions.formatCount : formatVerifyMonitorInteger,
            formatTimeNumber: typeof hintOptions.formatTimeNumber === 'function' ? hintOptions.formatTimeNumber : formatOpsAlertTimeNumber,
            formatHourMinute: typeof hintOptions.formatHourMinute === 'function' ? hintOptions.formatHourMinute : formatOpsAlertHourMinute,
            monitorEnabled: hintOptions.monitorEnabled,
            summaryEnabled: hintOptions.summaryEnabled
        }),
        formatCount: formatVerifyMonitorInteger,
        formatTimeNumber: formatOpsAlertTimeNumber,
        formatHourMinute: formatOpsAlertHourMinute,
        monitorEnabled,
        summaryEnabled
    });
}

function buildOpsAlertUnifiedSummaryDraftUiState(draft = {}, options = {}) {
    const selectedCount = Math.max(0, Number(options.selectedCount || 0));
    const controlState = requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertUnifiedSummaryDraftControlState')(draft, {
        selectedCount,
        formatCount: formatVerifyMonitorInteger,
        buildSummaryModeControlState: (section, sectionOptions = {}) => resolveOpsAlertSummaryModeControlState(section, sectionOptions)
    });
    return {
        draft,
        selectedCount,
        controlState,
        applyButtonHtml: `<i class="fas fa-wand-magic-sparkles"></i> ${escapeConfigHtml(controlState.applyLabel || '应用到所选告警')}`
    };
}

function resolveOpsAlertUnifiedSummaryDraftUiState(draft = {}, options = {}) {
    return buildOpsAlertUnifiedSummaryDraftUiState(draft, options);
}

function applyOpsAlertUnifiedSummaryDraftControls() {
    const draft = collectOpsAlertUnifiedSummaryDraftFromForm();
    const selectedCount = getOpsAlertSummaryOrchestrationSelectedDefinitions().length;
    const applyButton = document.querySelector('[data-admin-action="settings-apply-ops-alert-unified-summary-draft"]');
    const uiState = resolveOpsAlertUnifiedSummaryDraftUiState(draft, {
        selectedCount
    });

    applyOpsAlertSummaryModeControlStateToDom(uiState.controlState.summaryModeControlState, OPS_ALERT_UNIFIED_SUMMARY_DRAFT_FIELD_IDS, {
        valueSource: uiState.draft,
        populateAllValues: true
    });
    if (applyButton) {
        applyButton.disabled = uiState.controlState.applyDisabled === true;
        applyButton.innerHTML = uiState.applyButtonHtml;
    }
}

function resolveOpsAlertSummaryOrchestrationRenderState(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts']), selectedDefinitions = getOpsAlertSummaryOrchestrationSelectedDefinitions()) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    return requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertSummaryOrchestrationRenderState')(normalizedConfig, {
        definitions: OPS_ALERT_SUMMARY_ORCHESTRATION_DEFINITIONS,
        defaults: getDefaultOpsAlertConfig(),
        selectedDefinitions,
        formatCount: formatVerifyMonitorInteger,
        formatHourMinute: formatOpsAlertHourMinute,
        formatSummaryScheduleDescription: formatOpsAlertSummaryScheduleDescription
    });
}

function applyOpsAlertSummaryOrchestrationRenderState(renderState = {}) {
    const definitionStates = Array.isArray(renderState.definitionStates) ? renderState.definitionStates : [];
    definitionStates.forEach((definitionState) => {
        [definitionState?.monitorState, definitionState?.workHoursState, definitionState?.summaryState]
            .filter(Boolean)
            .forEach((cellState) => {
                setOpsAlertSummaryOrchestrationCell(
                    cellState.cellId,
                    cellState.tone,
                    cellState.label,
                    cellState.text
                );
            });
    });

    const metaEl = document.getElementById('opsAlertSummaryOrchestrationMeta');
    const overviewSelectionMetaEl = document.getElementById('opsAlertSummaryOverviewSelectionMeta');
    if (metaEl) {
        metaEl.innerHTML = `
            <i class="fas fa-layer-group"></i>
            <span>${escapeConfigHtml(renderState.metaText || '暂无统一汇总编排状态。')}</span>
        `;
    }
    if (overviewSelectionMetaEl) {
        overviewSelectionMetaEl.textContent = renderState.overviewSelectionText || '已勾选 0 类';
    }
}

function buildOpsAlertSummaryOrchestrationMarkupState(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const selectedDefinitions = getOpsAlertSummaryOrchestrationSelectedDefinitions();
    const renderState = resolveOpsAlertSummaryOrchestrationRenderState(normalizedConfig, selectedDefinitions);
    return {
        config: normalizedConfig,
        renderState
    };
}

function applyOpsAlertSummaryOrchestrationMarkupState(markupState = {}) {
    const renderState = markupState.renderState || {};
    applyOpsAlertSummaryOrchestrationRenderState(renderState);
    syncOpsAlertUnifiedSummaryDraftFromSelection(markupState.config || normalizeOpsAlertConfig(systemConfigCache['ops_alerts']));
    applyOpsAlertUnifiedSummaryDraftControls();
    return markupState;
}

function renderOpsAlertSummaryOrchestration(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    applyOpsAlertSummaryOrchestrationMarkupState(
        buildOpsAlertSummaryOrchestrationMarkupState(config)
    );
}

function selectOpsAlertUnifiedSummaryTargets(preset = 'all') {
    OPS_ALERT_SUMMARY_ORCHESTRATION_DEFINITIONS.forEach((definition) => {
        const checkbox = document.getElementById(definition.target_checkbox_id);
        if (!checkbox) return;

        switch (preset) {
            case 'none':
                checkbox.checked = false;
                break;
            case 'success':
            case 'low_priority':
            case 'operations':
                checkbox.checked = definition.preset_group === preset;
                break;
            case 'all':
            default:
                checkbox.checked = true;
                break;
        }
    });
    renderOpsAlertSummaryOrchestration(collectOpsAlertConfigFromForm());
}

function handleOpsAlertUnifiedSummaryTargetChange() {
    renderOpsAlertSummaryOrchestration(collectOpsAlertConfigFromForm());
}

function handleOpsAlertUnifiedSummaryDraftChange() {
    opsAlertUnifiedSummaryDraftDirty = true;
    applyOpsAlertUnifiedSummaryDraftControls();
}

function setOpsAlertToggleElementState(toggleEl, isActive) {
    if (!toggleEl) return;
    const nextActive = isActive === true;
    const changed = toggleEl.classList.contains('active') !== nextActive;
    toggleEl.classList.toggle('active', nextActive);
    if (changed) {
        pulseAdminConfigToggle(toggleEl);
    }
}

function applyOpsAlertUnifiedSummaryDraft() {
    const selectedDefinitions = getOpsAlertSummaryOrchestrationSelectedDefinitions();
    if (!selectedDefinitions.length) {
        showToast('请先勾选至少 1 类告警，再批量应用统一汇总编排。', 'warning');
        return false;
    }

    const draft = collectOpsAlertUnifiedSummaryDraftFromForm();
    selectedDefinitions.forEach((definition) => {
        setOpsAlertToggleElementState(
            document.getElementById(definition.summary_toggle_id),
            draft.summary_enabled
        );

        if (definition.supports_work_hours_only && definition.work_hours_toggle_id) {
            setOpsAlertToggleElementState(
                document.getElementById(definition.work_hours_toggle_id),
                draft.work_hours_only_enabled
            );
        }

        const scheduleModeInput = document.getElementById(definition.summary_schedule_mode_id);
        if (scheduleModeInput) {
            scheduleModeInput.value = draft.summary_schedule_mode;
        }

        const summaryWindowInput = document.getElementById(definition.summary_window_minutes_id);
        if (summaryWindowInput) {
            summaryWindowInput.value = String(draft.summary_window_minutes);
        }

        const hourlyMinuteInput = document.getElementById(definition.summary_hourly_minute_id);
        if (hourlyMinuteInput) {
            hourlyMinuteInput.value = String(draft.summary_hourly_minute);
        }

        const dailyHourInput = document.getElementById(definition.summary_daily_hour_id);
        if (dailyHourInput) {
            dailyHourInput.value = String(draft.summary_daily_hour);
        }

        const dailyMinuteInput = document.getElementById(definition.summary_daily_minute_id);
        if (dailyMinuteInput) {
            dailyMinuteInput.value = String(draft.summary_daily_minute);
        }

        const summaryMaxItemsInput = document.getElementById(definition.summary_max_items_id);
        if (summaryMaxItemsInput) {
            summaryMaxItemsInput.value = String(draft.summary_max_items);
        }
    });

    opsAlertUnifiedSummaryDraftDirty = false;
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
    showToast(`已把统一汇总编排应用到 ${selectedDefinitions.length} 类告警，保存站外告警配置后生效。`, 'success');
    return true;
}

function normalizePaymentChannelRuntimeState(raw) {
    const defaults = getDefaultPaymentChannelRuntimeState();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const mockSource = source.mock_payment && typeof source.mock_payment === 'object' && !Array.isArray(source.mock_payment)
        ? source.mock_payment
        : {};

    return {
        mock_payment: {
            allowed: mockSource.allowed === true || String(mockSource.allowed) === 'true'
                ? true
                : (mockSource.allowed === false || String(mockSource.allowed) === 'false'
                    ? false
                    : defaults.mock_payment.allowed),
            reason: String(mockSource.reason || defaults.mock_payment.reason).trim() || defaults.mock_payment.reason,
            message: String(mockSource.message || defaults.mock_payment.message).trim() || defaults.mock_payment.message,
            override_configured: mockSource.override_configured === true || String(mockSource.override_configured) === 'true',
            override_active: mockSource.override_active === true || String(mockSource.override_active) === 'true',
            override_env_name: String(mockSource.override_env_name || defaults.mock_payment.override_env_name).trim(),
            override_mode: String(mockSource.override_mode || defaults.mock_payment.override_mode).trim() || defaults.mock_payment.override_mode,
            cleanup_message: String(mockSource.cleanup_message || defaults.mock_payment.cleanup_message).trim()
        }
    };
}

function getDefaultPaymentChannelsConfig() {
    const rechargeOptions = normalizeRechargeOptionsConfig(systemConfigCache['recharge_options']);
    const activeProvider = rechargeOptions.mock_payment_enabled ? 'mock' : 'afdian';

    return {
        active_provider: activeProvider,
        providers: {
            mock: {
                enabled: true,
                display_name: '模拟支付',
                description: '仅建议在正式支付接入前短期使用，开启后将直接到账积分。'
            },
            afdian: {
                enabled: true,
                display_name: '爱发电',
                checkout_url: 'https://afdian.com/a/zaoyoe',
                package_hint: '请在爱发电完成支付后，返回钱包输入订单号领取兑换码。',
                custom_amount_hint: '钱包会先生成本次应付金额，请按报价完成支付后返回输入订单号领取兑换码。'
            },
            hupijiao: {
                enabled: false,
                display_name: '虎皮椒',
                checkout_url: '',
                gateway_url: '',
                merchant_id: '',
                return_url: 'https://www.zaoyoe.com',
                notify_url: '',
                package_hint: '虎皮椒通道已启用，正式回调与自动发货接入后即可完整使用。',
                custom_amount_hint: '虎皮椒通道已启用。自定义金额订单能力接入后，这里会直接拉起真实支付。'
            }
        }
    };
}

function getDefaultAnalyticsPreferencesConfig() {
    return {
        refresh_interval_ms: 300000
    };
}

function normalizeAnalyticsPreferencesConfig(raw) {
    const defaults = getDefaultAnalyticsPreferencesConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const refreshInterval = parseInt(source.refresh_interval_ms, 10);

    return {
        refresh_interval_ms: Number.isFinite(refreshInterval) && refreshInterval > 0
            ? refreshInterval
            : defaults.refresh_interval_ms
    };
}

function getDefaultIntegrationsConfig() {
    return {
        google_login_enabled: true,
        wechat_login_enabled: false,
        supabase_realtime_enabled: true,
        ai_service: 'gemini'
    };
}

function normalizeIntegrationsConfig(raw) {
    const defaults = getDefaultIntegrationsConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const aiService = ['gemini', 'openai', 'claude'].includes(source.ai_service)
        ? source.ai_service
        : defaults.ai_service;

    return {
        google_login_enabled: source.google_login_enabled !== false,
        wechat_login_enabled: source.wechat_login_enabled === true,
        supabase_realtime_enabled: source.supabase_realtime_enabled !== false,
        ai_service: aiService
    };
}

function getDefaultSeoConfig() {
    return {
        site_title: '我的提示词画廊',
        site_description: '精选AI生成图片提示词，一键复制使用...',
        site_keywords: 'AI图片, 提示词, Midjourney, Stable Diffusion'
    };
}

function normalizeSeoConfig(raw) {
    const defaults = getDefaultSeoConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

    return {
        site_title: typeof source.site_title === 'string' && source.site_title.trim()
            ? source.site_title.trim()
            : defaults.site_title,
        site_description: typeof source.site_description === 'string' && source.site_description.trim()
            ? source.site_description.trim()
            : defaults.site_description,
        site_keywords: typeof source.site_keywords === 'string' && source.site_keywords.trim()
            ? source.site_keywords.trim()
            : defaults.site_keywords
    };
}

function getDefaultPerformanceConfig() {
    return {
        lazy_load_enabled: true,
        image_quality: 85,
        cache_duration_seconds: 86400
    };
}

function normalizePerformanceConfig(raw) {
    const defaults = getDefaultPerformanceConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const imageQuality = parseInt(source.image_quality, 10);
    const cacheDuration = parseInt(source.cache_duration_seconds, 10);

    return {
        lazy_load_enabled: source.lazy_load_enabled !== false,
        image_quality: Number.isFinite(imageQuality)
            ? Math.min(100, Math.max(60, imageQuality))
            : defaults.image_quality,
        cache_duration_seconds: Number.isFinite(cacheDuration) && cacheDuration > 0
            ? cacheDuration
            : defaults.cache_duration_seconds
    };
}

function getDefaultAffiliateProgramConfig() {
    return {
        commission_rate_shop: 0.10,
        commission_rate_agent: 0.10,
        registration_reward_points: 0,
        registration_reward_requires_purchase: true,
        reward_notice: '拉新固定奖励与持续返佣可叠加发放；异常流量、作弊注册、退款订单与刷单行为不计入奖励统计。',
        legal_disclaimer: '活动最终解释权归平台所有'
    };
}

function getAffiliatePosterPresetDefinitions() {
    return [
        {
            id: 'midnight',
            name: '星幕邀请函',
            description: '深色高级感，适合作为默认分享海报。',
            preview_background: 'linear-gradient(160deg, #020617 0%, #0f172a 42%, #134e4a 100%)'
        },
        {
            id: 'sunset',
            name: '暖金品牌卡',
            description: '暖色氛围更强，适合活动档期与节庆传播。',
            preview_background: 'linear-gradient(160deg, #431407 0%, #9a3412 38%, #f59e0b 100%)'
        },
        {
            id: 'crystal',
            name: '清透极简版',
            description: '浅色留白更多，适合搭配自定义品牌底图。',
            preview_background: 'linear-gradient(160deg, #e2e8f0 0%, #cbd5e1 45%, #f8fafc 100%)'
        }
    ];
}

function getDefaultAffiliatePosterConfig() {
    return {
        chip_label: '推广',
        title: '专属邀请函',
        subtitle: '扫码注册 · 即享专属奖励',
        reward_badge_text: '',
        invite_code_label: '邀请码',
        qr_label: '扫码注册领取新人福利',
        footer: '邀请好友注册，享受固定奖励与持续返佣',
        active_template_id: 'midnight',
        templates: getAffiliatePosterPresetDefinitions().map(template => ({
            id: template.id,
            name: template.name,
            description: template.description,
            custom_background_url: ''
        }))
    };
}

function toWholeNumber(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toPointNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : fallback;
}

function toDecimal(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function escapeConfigHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getDefaultOpsAlertCustomerChatQuickReplyTemplates() {
    return [
        {
            id: 'ack',
            business_type: 'general',
            enabled: true,
            label: '先接手',
            hint: '先稳住用户预期',
            text: '这边已看到你的消息，我先帮你核对一下当前记录，稍后给你明确处理结果。'
        },
        {
            id: 'order',
            business_type: 'order',
            enabled: true,
            label: '订单说明',
            hint: '最近订单 {{order_status}}',
            text: '我这边看到你最近的订单「{{order_name}}」当前状态是{{order_status}}，我先继续帮你核对处理进度，稍后给你明确反馈。'
        },
        {
            id: 'payment',
            business_type: 'payment',
            enabled: true,
            label: '充值核对',
            hint: '最近充值 {{payment_status}}',
            text: '我这边看到你最近的充值记录当前是{{payment_status}}，先帮你核对到账和处理链路，稍后回复你。'
        },
        {
            id: 'verify',
            business_type: 'verification',
            enabled: true,
            label: '验证跟进',
            hint: '最近验证 {{verification_status}}',
            text: '我这边看到最近验证任务状态是{{verification_status}}，先帮你核对当前提示和处理进度，稍后给你更新。'
        },
        {
            id: 'ticket',
            business_type: 'ticket',
            enabled: true,
            label: '工单跟进',
            hint: '售后工单 {{ticket_status}}',
            text: '我这边看到最近售后工单目前是{{ticket_status}}，已经接手继续跟进，有结果会第一时间回复你。'
        }
    ];
}

function getOpsAlertCustomerChatQuickReplyBusinessTypeMeta(value = 'general') {
    const normalized = String(value || '').trim().toLowerCase();
    return OPS_ALERT_CUSTOMER_CHAT_QUICK_REPLY_BUSINESS_TYPES.find((item) => item.value === normalized)
        || OPS_ALERT_CUSTOMER_CHAT_QUICK_REPLY_BUSINESS_TYPES[0];
}

function normalizeOpsAlertCustomerChatQuickReplyTemplateId(value, fallbackIndex = 0, fallbackId = '') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);

    if (normalized) {
        return normalized;
    }

    const fallback = String(fallbackId || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);

    if (fallback) {
        return fallback;
    }

    return `template_${Math.max(1, fallbackIndex + 1)}`;
}

function createOpsAlertCustomerChatQuickReplyTemplateDraft(businessType = 'general') {
    const meta = getOpsAlertCustomerChatQuickReplyBusinessTypeMeta(businessType);
    const seed = Date.now().toString(36);
    return {
        id: `template_${seed}_${Math.random().toString(36).slice(2, 6)}`,
        business_type: meta.value,
        enabled: true,
        label: `新${meta.label}`,
        hint: '',
        text: ''
    };
}

function normalizeOpsAlertCustomerChatQuickReplyTemplates(value, options = {}) {
    const preserveDrafts = options && options.preserveDrafts === true;
    if (!Array.isArray(value)) {
        return getDefaultOpsAlertCustomerChatQuickReplyTemplates();
    }
    if (!value.length) {
        return [];
    }

    const defaults = getDefaultOpsAlertCustomerChatQuickReplyTemplates();
    const normalized = [];

    value.forEach((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return;
        }

        const businessType = getOpsAlertCustomerChatQuickReplyBusinessTypeMeta(
            item.business_type || item.businessType || item.type
        ).value;
        const fallback = defaults.find((candidate) => candidate.id === String(item.id || '').trim())
            || defaults.find((candidate) => candidate.business_type === businessType)
            || null;
        const text = String(item.text || '').trim();
        if (!text && !preserveDrafts) {
            return;
        }

        normalized.push({
            id: normalizeOpsAlertCustomerChatQuickReplyTemplateId(item.id || item.key, normalized.length, fallback?.id),
            business_type: businessType,
            enabled: normalizeConfigBoolean(item.enabled, fallback ? fallback.enabled !== false : true),
            label: String(item.label || '').trim() || fallback?.label || getOpsAlertCustomerChatQuickReplyBusinessTypeMeta(businessType).label,
            hint: String(item.hint || '').trim(),
            text
        });
    });

    return normalized.slice(0, 12);
}

function normalizeCheckinConfig(raw) {
    const defaults = getDefaultCheckinConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
        base_points: Math.max(0, toPointNumber(source.base_points, defaults.base_points)),
        consecutive_7_points: Math.max(0, toPointNumber(source.consecutive_7_points, defaults.consecutive_7_points)),
        perfect_month_points: Math.max(0, toPointNumber(source.perfect_month_points, defaults.perfect_month_points)),
        makeup_cost_points: Math.max(0, toPointNumber(source.makeup_cost_points, defaults.makeup_cost_points))
    };
}

function normalizeRechargeOptionsConfig(raw) {
    const defaults = getDefaultRechargeOptionsConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

    return {
        custom_amount_enabled: source.custom_amount_enabled === true || String(source.custom_amount_enabled) === 'true',
        mock_payment_enabled: source.mock_payment_enabled === true || String(source.mock_payment_enabled) === 'true',
        custom_amount_min_points: Math.max(1, Math.round(toPointNumber(source.custom_amount_min_points, defaults.custom_amount_min_points))),
        custom_amount_max_points: Math.max(
            Math.max(1, Math.round(toPointNumber(source.custom_amount_min_points, defaults.custom_amount_min_points))),
            Math.round(toPointNumber(source.custom_amount_max_points, defaults.custom_amount_max_points))
        ),
        custom_amount_step: Math.max(1, Math.round(toPointNumber(source.custom_amount_step, defaults.custom_amount_step))),
        custom_amount_points_per_cny: Math.max(0.01, toPointNumber(source.custom_amount_points_per_cny, defaults.custom_amount_points_per_cny)),
        custom_amount_quote_ttl_seconds: Math.max(60, Math.round(toPointNumber(source.custom_amount_quote_ttl_seconds, defaults.custom_amount_quote_ttl_seconds)))
    };
}

function normalizePaymentChannelsConfig(raw) {
    const defaults = getDefaultPaymentChannelsConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const sourceProviders = source.providers && typeof source.providers === 'object' && !Array.isArray(source.providers)
        ? source.providers
        : {};

    const normalized = {
        active_provider: ['mock', 'afdian', 'hupijiao'].includes(source.active_provider)
            ? source.active_provider
            : defaults.active_provider,
        providers: {
            mock: {
                enabled: sourceProviders.mock?.enabled !== undefined
                    ? (sourceProviders.mock.enabled === true || String(sourceProviders.mock.enabled) === 'true')
                    : defaults.providers.mock.enabled,
                display_name: String(sourceProviders.mock?.display_name || defaults.providers.mock.display_name).trim() || defaults.providers.mock.display_name,
                description: String(sourceProviders.mock?.description || defaults.providers.mock.description).trim() || defaults.providers.mock.description
            },
            afdian: {
                enabled: sourceProviders.afdian?.enabled !== undefined
                    ? (sourceProviders.afdian.enabled === true || String(sourceProviders.afdian.enabled) === 'true')
                    : defaults.providers.afdian.enabled,
                display_name: String(sourceProviders.afdian?.display_name || defaults.providers.afdian.display_name).trim() || defaults.providers.afdian.display_name,
                checkout_url: String(sourceProviders.afdian?.checkout_url || defaults.providers.afdian.checkout_url).trim() || defaults.providers.afdian.checkout_url,
                package_hint: String(sourceProviders.afdian?.package_hint || defaults.providers.afdian.package_hint).trim() || defaults.providers.afdian.package_hint,
                custom_amount_hint: String(sourceProviders.afdian?.custom_amount_hint || defaults.providers.afdian.custom_amount_hint).trim() || defaults.providers.afdian.custom_amount_hint
            },
            hupijiao: {
                enabled: sourceProviders.hupijiao?.enabled === true || String(sourceProviders.hupijiao?.enabled) === 'true',
                display_name: String(sourceProviders.hupijiao?.display_name || defaults.providers.hupijiao.display_name).trim() || defaults.providers.hupijiao.display_name,
                checkout_url: String(sourceProviders.hupijiao?.checkout_url || defaults.providers.hupijiao.checkout_url).trim(),
                gateway_url: String(sourceProviders.hupijiao?.gateway_url || defaults.providers.hupijiao.gateway_url).trim(),
                merchant_id: String(sourceProviders.hupijiao?.merchant_id || defaults.providers.hupijiao.merchant_id).trim(),
                return_url: String(sourceProviders.hupijiao?.return_url || defaults.providers.hupijiao.return_url).trim() || defaults.providers.hupijiao.return_url,
                notify_url: String(sourceProviders.hupijiao?.notify_url || defaults.providers.hupijiao.notify_url).trim(),
                package_hint: String(sourceProviders.hupijiao?.package_hint || defaults.providers.hupijiao.package_hint).trim() || defaults.providers.hupijiao.package_hint,
                custom_amount_hint: String(sourceProviders.hupijiao?.custom_amount_hint || defaults.providers.hupijiao.custom_amount_hint).trim() || defaults.providers.hupijiao.custom_amount_hint
            }
        }
    };

    if (!normalized.providers[normalized.active_provider]?.enabled) {
        normalized.providers[normalized.active_provider].enabled = true;
    }

    return normalized;
}

function normalizeOpsAlertConfig(raw) {
    const defaults = getDefaultOpsAlertConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const temporaryMuteSource = source.temporary_mute && typeof source.temporary_mute === 'object' && !Array.isArray(source.temporary_mute)
        ? source.temporary_mute
        : {};
    const quietHoursSource = source.quiet_hours && typeof source.quiet_hours === 'object' && !Array.isArray(source.quiet_hours)
        ? source.quiet_hours
        : {};
    const workHoursSource = source.work_hours && typeof source.work_hours === 'object' && !Array.isArray(source.work_hours)
        ? source.work_hours
        : {};
    const muteRulesSource = source.mute_rules && typeof source.mute_rules === 'object' && !Array.isArray(source.mute_rules)
        ? source.mute_rules
        : {};
    const typeMuteRulesSource = muteRulesSource.types && typeof muteRulesSource.types === 'object' && !Array.isArray(muteRulesSource.types)
        ? muteRulesSource.types
        : {};
    const moduleMuteRulesSource = muteRulesSource.modules && typeof muteRulesSource.modules === 'object' && !Array.isArray(muteRulesSource.modules)
        ? muteRulesSource.modules
        : {};
    const sourceChannels = source.channels && typeof source.channels === 'object' && !Array.isArray(source.channels)
        ? source.channels
        : {};
    const telegramSource = sourceChannels.telegram && typeof sourceChannels.telegram === 'object' && !Array.isArray(sourceChannels.telegram)
        ? sourceChannels.telegram
        : {};
    const feishuSource = sourceChannels.feishu && typeof sourceChannels.feishu === 'object' && !Array.isArray(sourceChannels.feishu)
        ? sourceChannels.feishu
        : {};
    const emailSource = sourceChannels.email && typeof sourceChannels.email === 'object' && !Array.isArray(sourceChannels.email)
        ? sourceChannels.email
        : {};
    const shopRiskSource = source.shop_order_risk && typeof source.shop_order_risk === 'object' && !Array.isArray(source.shop_order_risk)
        ? source.shop_order_risk
        : {};
    const shopInventorySource = source.shop_inventory && typeof source.shop_inventory === 'object' && !Array.isArray(source.shop_inventory)
        ? source.shop_inventory
        : {};
    const customerChatMessageSource = source.customer_chat_message && typeof source.customer_chat_message === 'object' && !Array.isArray(source.customer_chat_message)
        ? source.customer_chat_message
        : {};
    const shopPurchaseSuccessSource = source.shop_purchase_success && typeof source.shop_purchase_success === 'object' && !Array.isArray(source.shop_purchase_success)
        ? source.shop_purchase_success
        : {};
    const walletRechargeSuccessSource = source.wallet_recharge_success && typeof source.wallet_recharge_success === 'object' && !Array.isArray(source.wallet_recharge_success)
        ? source.wallet_recharge_success
        : {};
    const ticketsSource = source.tickets && typeof source.tickets === 'object' && !Array.isArray(source.tickets)
        ? source.tickets
        : {};
    const shopOrderDeliverySource = source.shop_order_delivery && typeof source.shop_order_delivery === 'object' && !Array.isArray(source.shop_order_delivery)
        ? source.shop_order_delivery
        : {};
    const verifyQuotaSource = source.verify_quota && typeof source.verify_quota === 'object' && !Array.isArray(source.verify_quota)
        ? source.verify_quota
        : {};
    const verifyQueueSource = source.verify_queue && typeof source.verify_queue === 'object' && !Array.isArray(source.verify_queue)
        ? source.verify_queue
        : {};
    const verifyFailureSource = source.verify_failure && typeof source.verify_failure === 'object' && !Array.isArray(source.verify_failure)
        ? source.verify_failure
        : {};
    const paymentGatewaySource = source.payment_gateway && typeof source.payment_gateway === 'object' && !Array.isArray(source.payment_gateway)
        ? source.payment_gateway
        : {};
    const routingSource = source.routing && typeof source.routing === 'object' && !Array.isArray(source.routing)
        ? source.routing
        : {};
    const routingCustomerChatSource = routingSource.customer_chat_message && typeof routingSource.customer_chat_message === 'object' && !Array.isArray(routingSource.customer_chat_message)
        ? routingSource.customer_chat_message
        : {};
    const routingShopPurchaseSource = routingSource.shop_purchase_success && typeof routingSource.shop_purchase_success === 'object' && !Array.isArray(routingSource.shop_purchase_success)
        ? routingSource.shop_purchase_success
        : {};
    const routingWalletRechargeSource = routingSource.wallet_recharge_success && typeof routingSource.wallet_recharge_success === 'object' && !Array.isArray(routingSource.wallet_recharge_success)
        ? routingSource.wallet_recharge_success
        : {};
    const routingShopInventorySource = routingSource.shop_inventory && typeof routingSource.shop_inventory === 'object' && !Array.isArray(routingSource.shop_inventory)
        ? routingSource.shop_inventory
        : {};
    const routingPaymentRefundOpsSource = routingSource.payment_refund_ops && typeof routingSource.payment_refund_ops === 'object' && !Array.isArray(routingSource.payment_refund_ops)
        ? routingSource.payment_refund_ops
        : {};
    const routingPaymentConfigSource = routingSource.payment_config && typeof routingSource.payment_config === 'object' && !Array.isArray(routingSource.payment_config)
        ? routingSource.payment_config
        : {};
    const routingShopOrderRiskSource = routingSource.shop_order_risk && typeof routingSource.shop_order_risk === 'object' && !Array.isArray(routingSource.shop_order_risk)
        ? routingSource.shop_order_risk
        : {};
    const routingAdminLoginAnomalySource = routingSource.admin_login_anomaly && typeof routingSource.admin_login_anomaly === 'object' && !Array.isArray(routingSource.admin_login_anomaly)
        ? routingSource.admin_login_anomaly
        : {};
    const routingTicketsSource = routingSource.tickets && typeof routingSource.tickets === 'object' && !Array.isArray(routingSource.tickets)
        ? routingSource.tickets
        : {};
    const routingShopOrderDeliverySource = routingSource.shop_order_delivery && typeof routingSource.shop_order_delivery === 'object' && !Array.isArray(routingSource.shop_order_delivery)
        ? routingSource.shop_order_delivery
        : {};
    const routingPaymentGatewaySource = routingSource.payment_gateway && typeof routingSource.payment_gateway === 'object' && !Array.isArray(routingSource.payment_gateway)
        ? routingSource.payment_gateway
        : {};
    const routingVerifyQuotaSource = routingSource.verify_quota && typeof routingSource.verify_quota === 'object' && !Array.isArray(routingSource.verify_quota)
        ? routingSource.verify_quota
        : {};
    const routingVerifyQueueSource = routingSource.verify_queue && typeof routingSource.verify_queue === 'object' && !Array.isArray(routingSource.verify_queue)
        ? routingSource.verify_queue
        : {};
    const routingVerifyFailureSource = routingSource.verify_failure && typeof routingSource.verify_failure === 'object' && !Array.isArray(routingSource.verify_failure)
        ? routingSource.verify_failure
        : {};

    return {
        enabled: normalizeConfigBoolean(source.enabled, defaults.enabled),
        dedupe_window_minutes: clamp(toWholeNumber(source.dedupe_window_minutes, defaults.dedupe_window_minutes), 1, 1440),
        batch_size: clamp(toWholeNumber(source.batch_size, defaults.batch_size), 1, 50),
        sweep_interval_ms: clamp(toWholeNumber(source.sweep_interval_ms, defaults.sweep_interval_ms), 1000, 10 * 60 * 1000),
        max_attempts: clamp(toWholeNumber(source.max_attempts, defaults.max_attempts), 1, 20),
        retry_base_delay_ms: clamp(toWholeNumber(source.retry_base_delay_ms, defaults.retry_base_delay_ms), 1000, 60 * 60 * 1000),
        retry_max_delay_ms: clamp(
            toWholeNumber(source.retry_max_delay_ms, defaults.retry_max_delay_ms),
            Math.max(1000, toWholeNumber(source.retry_base_delay_ms, defaults.retry_base_delay_ms)),
            24 * 60 * 60 * 1000
        ),
        timeout_ms: clamp(toWholeNumber(source.timeout_ms, defaults.timeout_ms), 1000, 30000),
        temporary_mute: {
            until: normalizeDateTimeLocalInputValue(temporaryMuteSource.until || '') || '',
            allow_critical: normalizeConfigBoolean(temporaryMuteSource.allow_critical, defaults.temporary_mute.allow_critical)
        },
        quiet_hours: {
            enabled: normalizeConfigBoolean(quietHoursSource.enabled, defaults.quiet_hours.enabled),
            start_hour: clamp(toWholeNumber(quietHoursSource.start_hour, defaults.quiet_hours.start_hour), 0, 23),
            end_hour: clamp(toWholeNumber(quietHoursSource.end_hour, defaults.quiet_hours.end_hour), 0, 23),
            timezone: String(quietHoursSource.timezone || defaults.quiet_hours.timezone).trim() || defaults.quiet_hours.timezone,
            allow_critical: normalizeConfigBoolean(quietHoursSource.allow_critical, defaults.quiet_hours.allow_critical)
        },
        work_hours: {
            enabled: normalizeConfigBoolean(workHoursSource.enabled, defaults.work_hours.enabled),
            start_hour: clamp(toWholeNumber(workHoursSource.start_hour, defaults.work_hours.start_hour), 0, 23),
            end_hour: clamp(toWholeNumber(workHoursSource.end_hour, defaults.work_hours.end_hour), 0, 23),
            timezone: String(workHoursSource.timezone || defaults.work_hours.timezone).trim() || defaults.work_hours.timezone
        },
        mute_rules: {
            types: {
                customer_chat_message: {
                    until: normalizeDateTimeLocalInputValue(typeMuteRulesSource.customer_chat_message?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(typeMuteRulesSource.customer_chat_message?.allow_critical, defaults.mute_rules.types.customer_chat_message.allow_critical)
                },
                shop_purchase_success: {
                    until: normalizeDateTimeLocalInputValue(typeMuteRulesSource.shop_purchase_success?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(typeMuteRulesSource.shop_purchase_success?.allow_critical, defaults.mute_rules.types.shop_purchase_success.allow_critical)
                },
                wallet_recharge_success: {
                    until: normalizeDateTimeLocalInputValue(typeMuteRulesSource.wallet_recharge_success?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(typeMuteRulesSource.wallet_recharge_success?.allow_critical, defaults.mute_rules.types.wallet_recharge_success.allow_critical)
                },
                shop_inventory: {
                    until: normalizeDateTimeLocalInputValue(typeMuteRulesSource.shop_inventory?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(typeMuteRulesSource.shop_inventory?.allow_critical, defaults.mute_rules.types.shop_inventory.allow_critical)
                },
                payment_refund_ops: {
                    until: normalizeDateTimeLocalInputValue(typeMuteRulesSource.payment_refund_ops?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(typeMuteRulesSource.payment_refund_ops?.allow_critical, defaults.mute_rules.types.payment_refund_ops.allow_critical)
                },
                payment_config: {
                    until: normalizeDateTimeLocalInputValue(typeMuteRulesSource.payment_config?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(typeMuteRulesSource.payment_config?.allow_critical, defaults.mute_rules.types.payment_config.allow_critical)
                },
                shop_order_risk: {
                    until: normalizeDateTimeLocalInputValue(typeMuteRulesSource.shop_order_risk?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(typeMuteRulesSource.shop_order_risk?.allow_critical, defaults.mute_rules.types.shop_order_risk.allow_critical)
                },
                admin_login_anomaly: {
                    until: normalizeDateTimeLocalInputValue(typeMuteRulesSource.admin_login_anomaly?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(typeMuteRulesSource.admin_login_anomaly?.allow_critical, defaults.mute_rules.types.admin_login_anomaly.allow_critical)
                },
                tickets: {
                    until: normalizeDateTimeLocalInputValue(typeMuteRulesSource.tickets?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(typeMuteRulesSource.tickets?.allow_critical, defaults.mute_rules.types.tickets.allow_critical)
                },
                shop_order_delivery: {
                    until: normalizeDateTimeLocalInputValue(typeMuteRulesSource.shop_order_delivery?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(typeMuteRulesSource.shop_order_delivery?.allow_critical, defaults.mute_rules.types.shop_order_delivery.allow_critical)
                },
                payment_gateway: {
                    until: normalizeDateTimeLocalInputValue(typeMuteRulesSource.payment_gateway?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(typeMuteRulesSource.payment_gateway?.allow_critical, defaults.mute_rules.types.payment_gateway.allow_critical)
                },
                verify_quota: {
                    until: normalizeDateTimeLocalInputValue(typeMuteRulesSource.verify_quota?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(typeMuteRulesSource.verify_quota?.allow_critical, defaults.mute_rules.types.verify_quota.allow_critical)
                },
                verify_queue: {
                    until: normalizeDateTimeLocalInputValue(typeMuteRulesSource.verify_queue?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(typeMuteRulesSource.verify_queue?.allow_critical, defaults.mute_rules.types.verify_queue.allow_critical)
                },
                verify_failure: {
                    until: normalizeDateTimeLocalInputValue(typeMuteRulesSource.verify_failure?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(typeMuteRulesSource.verify_failure?.allow_critical, defaults.mute_rules.types.verify_failure.allow_critical)
                }
            },
            modules: {
                customer_engagement: {
                    until: normalizeDateTimeLocalInputValue(moduleMuteRulesSource.customer_engagement?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(moduleMuteRulesSource.customer_engagement?.allow_critical, defaults.mute_rules.modules.customer_engagement.allow_critical)
                },
                commerce: {
                    until: normalizeDateTimeLocalInputValue(moduleMuteRulesSource.commerce?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(moduleMuteRulesSource.commerce?.allow_critical, defaults.mute_rules.modules.commerce.allow_critical)
                },
                inventory: {
                    until: normalizeDateTimeLocalInputValue(moduleMuteRulesSource.inventory?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(moduleMuteRulesSource.inventory?.allow_critical, defaults.mute_rules.modules.inventory.allow_critical)
                },
                payments: {
                    until: normalizeDateTimeLocalInputValue(moduleMuteRulesSource.payments?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(moduleMuteRulesSource.payments?.allow_critical, defaults.mute_rules.modules.payments.allow_critical)
                },
                shop_risk: {
                    until: normalizeDateTimeLocalInputValue(moduleMuteRulesSource.shop_risk?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(moduleMuteRulesSource.shop_risk?.allow_critical, defaults.mute_rules.modules.shop_risk.allow_critical)
                },
                verify: {
                    until: normalizeDateTimeLocalInputValue(moduleMuteRulesSource.verify?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(moduleMuteRulesSource.verify?.allow_critical, defaults.mute_rules.modules.verify.allow_critical)
                },
                tickets: {
                    until: normalizeDateTimeLocalInputValue(moduleMuteRulesSource.tickets?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(moduleMuteRulesSource.tickets?.allow_critical, defaults.mute_rules.modules.tickets.allow_critical)
                },
                fulfillment: {
                    until: normalizeDateTimeLocalInputValue(moduleMuteRulesSource.fulfillment?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(moduleMuteRulesSource.fulfillment?.allow_critical, defaults.mute_rules.modules.fulfillment.allow_critical)
                },
                security: {
                    until: normalizeDateTimeLocalInputValue(moduleMuteRulesSource.security?.until || '') || '',
                    allow_critical: normalizeConfigBoolean(moduleMuteRulesSource.security?.allow_critical, defaults.mute_rules.modules.security.allow_critical)
                }
            }
        },
        channels: {
            telegram: {
                enabled: normalizeConfigBoolean(telegramSource.enabled, defaults.channels.telegram.enabled),
                minimum_severity: normalizeOpsAlertSeverity(telegramSource.minimum_severity, defaults.channels.telegram.minimum_severity),
                chat_ids: normalizeConfigStringArray(telegramSource.chat_ids)
            },
            feishu: {
                enabled: normalizeConfigBoolean(feishuSource.enabled, defaults.channels.feishu.enabled),
                minimum_severity: normalizeOpsAlertSeverity(feishuSource.minimum_severity, defaults.channels.feishu.minimum_severity)
            },
            email: {
                enabled: normalizeConfigBoolean(emailSource.enabled, defaults.channels.email.enabled),
                minimum_severity: normalizeOpsAlertSeverity(emailSource.minimum_severity, defaults.channels.email.minimum_severity),
                recipients: normalizeConfigStringArray(emailSource.recipients),
                from_address: String(emailSource.from_address || defaults.channels.email.from_address).trim(),
                reply_to: String(emailSource.reply_to || defaults.channels.email.reply_to).trim(),
                subject_prefix: String(emailSource.subject_prefix || defaults.channels.email.subject_prefix).trim() || defaults.channels.email.subject_prefix
            }
        },
        routing: {
            customer_chat_message: {
                telegram: normalizeConfigBoolean(routingCustomerChatSource.telegram, defaults.routing.customer_chat_message.telegram),
                feishu: normalizeConfigBoolean(routingCustomerChatSource.feishu, defaults.routing.customer_chat_message.feishu),
                email: normalizeConfigBoolean(routingCustomerChatSource.email, defaults.routing.customer_chat_message.email)
            },
            shop_purchase_success: {
                telegram: normalizeConfigBoolean(routingShopPurchaseSource.telegram, defaults.routing.shop_purchase_success.telegram),
                feishu: normalizeConfigBoolean(routingShopPurchaseSource.feishu, defaults.routing.shop_purchase_success.feishu),
                email: normalizeConfigBoolean(routingShopPurchaseSource.email, defaults.routing.shop_purchase_success.email)
            },
            wallet_recharge_success: {
                telegram: normalizeConfigBoolean(routingWalletRechargeSource.telegram, defaults.routing.wallet_recharge_success.telegram),
                feishu: normalizeConfigBoolean(routingWalletRechargeSource.feishu, defaults.routing.wallet_recharge_success.feishu),
                email: normalizeConfigBoolean(routingWalletRechargeSource.email, defaults.routing.wallet_recharge_success.email)
            },
            shop_inventory: {
                telegram: normalizeConfigBoolean(routingShopInventorySource.telegram, defaults.routing.shop_inventory.telegram),
                feishu: normalizeConfigBoolean(routingShopInventorySource.feishu, defaults.routing.shop_inventory.feishu),
                email: normalizeConfigBoolean(routingShopInventorySource.email, defaults.routing.shop_inventory.email)
            },
            payment_refund_ops: {
                telegram: normalizeConfigBoolean(routingPaymentRefundOpsSource.telegram, defaults.routing.payment_refund_ops.telegram),
                feishu: normalizeConfigBoolean(routingPaymentRefundOpsSource.feishu, defaults.routing.payment_refund_ops.feishu),
                email: normalizeConfigBoolean(routingPaymentRefundOpsSource.email, defaults.routing.payment_refund_ops.email)
            },
            payment_config: {
                telegram: normalizeConfigBoolean(routingPaymentConfigSource.telegram, defaults.routing.payment_config.telegram),
                feishu: normalizeConfigBoolean(routingPaymentConfigSource.feishu, defaults.routing.payment_config.feishu),
                email: normalizeConfigBoolean(routingPaymentConfigSource.email, defaults.routing.payment_config.email)
            },
            shop_order_risk: {
                telegram: normalizeConfigBoolean(routingShopOrderRiskSource.telegram, defaults.routing.shop_order_risk.telegram),
                feishu: normalizeConfigBoolean(routingShopOrderRiskSource.feishu, defaults.routing.shop_order_risk.feishu),
                email: normalizeConfigBoolean(routingShopOrderRiskSource.email, defaults.routing.shop_order_risk.email)
            },
            admin_login_anomaly: {
                telegram: normalizeConfigBoolean(routingAdminLoginAnomalySource.telegram, defaults.routing.admin_login_anomaly.telegram),
                feishu: normalizeConfigBoolean(routingAdminLoginAnomalySource.feishu, defaults.routing.admin_login_anomaly.feishu),
                email: normalizeConfigBoolean(routingAdminLoginAnomalySource.email, defaults.routing.admin_login_anomaly.email)
            },
            tickets: {
                telegram: normalizeConfigBoolean(routingTicketsSource.telegram, defaults.routing.tickets.telegram),
                feishu: normalizeConfigBoolean(routingTicketsSource.feishu, defaults.routing.tickets.feishu),
                email: normalizeConfigBoolean(routingTicketsSource.email, defaults.routing.tickets.email)
            },
            shop_order_delivery: {
                telegram: normalizeConfigBoolean(routingShopOrderDeliverySource.telegram, defaults.routing.shop_order_delivery.telegram),
                feishu: normalizeConfigBoolean(routingShopOrderDeliverySource.feishu, defaults.routing.shop_order_delivery.feishu),
                email: normalizeConfigBoolean(routingShopOrderDeliverySource.email, defaults.routing.shop_order_delivery.email)
            },
            payment_gateway: {
                telegram: normalizeConfigBoolean(routingPaymentGatewaySource.telegram, defaults.routing.payment_gateway.telegram),
                feishu: normalizeConfigBoolean(routingPaymentGatewaySource.feishu, defaults.routing.payment_gateway.feishu),
                email: normalizeConfigBoolean(routingPaymentGatewaySource.email, defaults.routing.payment_gateway.email)
            },
            verify_quota: {
                telegram: normalizeConfigBoolean(routingVerifyQuotaSource.telegram, defaults.routing.verify_quota.telegram),
                feishu: normalizeConfigBoolean(routingVerifyQuotaSource.feishu, defaults.routing.verify_quota.feishu),
                email: normalizeConfigBoolean(routingVerifyQuotaSource.email, defaults.routing.verify_quota.email)
            },
            verify_queue: {
                telegram: normalizeConfigBoolean(routingVerifyQueueSource.telegram, defaults.routing.verify_queue.telegram),
                feishu: normalizeConfigBoolean(routingVerifyQueueSource.feishu, defaults.routing.verify_queue.feishu),
                email: normalizeConfigBoolean(routingVerifyQueueSource.email, defaults.routing.verify_queue.email)
            },
            verify_failure: {
                telegram: normalizeConfigBoolean(routingVerifyFailureSource.telegram, defaults.routing.verify_failure.telegram),
                feishu: normalizeConfigBoolean(routingVerifyFailureSource.feishu, defaults.routing.verify_failure.feishu),
                email: normalizeConfigBoolean(routingVerifyFailureSource.email, defaults.routing.verify_failure.email)
            }
        },
        shop_order_risk: {
            auto_response_enabled: normalizeConfigBoolean(shopRiskSource.auto_response_enabled, defaults.shop_order_risk.auto_response_enabled),
            auto_disable_coupon_min_risk_score: clamp(
                toWholeNumber(shopRiskSource.auto_disable_coupon_min_risk_score, defaults.shop_order_risk.auto_disable_coupon_min_risk_score),
                65,
                99
            ),
            auto_ban_user_min_risk_score: clamp(
                toWholeNumber(shopRiskSource.auto_ban_user_min_risk_score, defaults.shop_order_risk.auto_ban_user_min_risk_score),
                80,
                99
            ),
            auto_ban_user_duration_days: clamp(
                toWholeNumber(shopRiskSource.auto_ban_user_duration_days, defaults.shop_order_risk.auto_ban_user_duration_days),
                1,
                30
            ),
            auto_suspend_product_min_risk_score: clamp(
                toWholeNumber(shopRiskSource.auto_suspend_product_min_risk_score, defaults.shop_order_risk.auto_suspend_product_min_risk_score),
                85,
                99
            )
        },
        shop_inventory: {
            enabled: normalizeConfigBoolean(shopInventorySource.enabled, defaults.shop_inventory.enabled),
            low_stock_threshold: clamp(
                toWholeNumber(shopInventorySource.low_stock_threshold, defaults.shop_inventory.low_stock_threshold),
                0,
                10000
            ),
            sweep_interval_ms: clamp(
                toWholeNumber(shopInventorySource.sweep_interval_ms, defaults.shop_inventory.sweep_interval_ms),
                10000,
                60 * 60 * 1000
            ),
            sales_window_days: clamp(
                toWholeNumber(shopInventorySource.sales_window_days, defaults.shop_inventory.sales_window_days),
                1,
                30
            ),
            dedupe_window_minutes: clamp(
                toWholeNumber(shopInventorySource.dedupe_window_minutes, defaults.shop_inventory.dedupe_window_minutes),
                1,
                24 * 60
            ),
            recovery_notification_enabled: normalizeConfigBoolean(
                shopInventorySource.recovery_notification_enabled,
                defaults.shop_inventory.recovery_notification_enabled
            ),
            summary_enabled: normalizeConfigBoolean(
                shopInventorySource.summary_enabled,
                defaults.shop_inventory.summary_enabled
            ),
            summary_window_minutes: clamp(
                toWholeNumber(shopInventorySource.summary_window_minutes, defaults.shop_inventory.summary_window_minutes),
                5,
                24 * 60
            ),
            summary_max_items: clamp(
                toWholeNumber(shopInventorySource.summary_max_items, defaults.shop_inventory.summary_max_items),
                1,
                50
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                shopInventorySource.summary_schedule_mode,
                defaults.shop_inventory.summary_schedule_mode
            ),
            summary_hourly_minute: clamp(
                toWholeNumber(shopInventorySource.summary_hourly_minute, defaults.shop_inventory.summary_hourly_minute),
                0,
                59
            ),
            summary_daily_hour: clamp(
                toWholeNumber(shopInventorySource.summary_daily_hour, defaults.shop_inventory.summary_daily_hour),
                0,
                23
            ),
            summary_daily_minute: clamp(
                toWholeNumber(shopInventorySource.summary_daily_minute, defaults.shop_inventory.summary_daily_minute),
                0,
                59
            )
        },
        customer_chat_message: {
            enabled: normalizeConfigBoolean(customerChatMessageSource.enabled, defaults.customer_chat_message.enabled),
            sweep_interval_ms: clamp(
                toWholeNumber(customerChatMessageSource.sweep_interval_ms, defaults.customer_chat_message.sweep_interval_ms),
                10000,
                60 * 60 * 1000
            ),
            lookback_minutes: clamp(
                toWholeNumber(customerChatMessageSource.lookback_minutes, defaults.customer_chat_message.lookback_minutes),
                1,
                24 * 60
            ),
            dedupe_window_minutes: clamp(
                toWholeNumber(customerChatMessageSource.dedupe_window_minutes, defaults.customer_chat_message.dedupe_window_minutes),
                1,
                7 * 24 * 60
            ),
            work_hours_only_enabled: normalizeConfigBoolean(
                customerChatMessageSource.work_hours_only_enabled,
                defaults.customer_chat_message.work_hours_only_enabled
            ),
            summary_enabled: normalizeConfigBoolean(customerChatMessageSource.summary_enabled, defaults.customer_chat_message.summary_enabled),
            summary_window_minutes: clamp(
                toWholeNumber(customerChatMessageSource.summary_window_minutes, defaults.customer_chat_message.summary_window_minutes),
                5,
                24 * 60
            ),
            summary_max_items: clamp(
                toWholeNumber(customerChatMessageSource.summary_max_items, defaults.customer_chat_message.summary_max_items),
                1,
                50
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                customerChatMessageSource.summary_schedule_mode,
                defaults.customer_chat_message.summary_schedule_mode
            ),
            summary_hourly_minute: clamp(
                toWholeNumber(customerChatMessageSource.summary_hourly_minute, defaults.customer_chat_message.summary_hourly_minute),
                0,
                59
            ),
            summary_daily_hour: clamp(
                toWholeNumber(customerChatMessageSource.summary_daily_hour, defaults.customer_chat_message.summary_daily_hour),
                0,
                23
            ),
            summary_daily_minute: clamp(
                toWholeNumber(customerChatMessageSource.summary_daily_minute, defaults.customer_chat_message.summary_daily_minute),
                0,
                59
            ),
            quick_reply_templates: normalizeOpsAlertCustomerChatQuickReplyTemplates(customerChatMessageSource.quick_reply_templates)
        },
        shop_purchase_success: {
            enabled: normalizeConfigBoolean(shopPurchaseSuccessSource.enabled, defaults.shop_purchase_success.enabled),
            sweep_interval_ms: clamp(
                toWholeNumber(shopPurchaseSuccessSource.sweep_interval_ms, defaults.shop_purchase_success.sweep_interval_ms),
                10000,
                60 * 60 * 1000
            ),
            lookback_minutes: clamp(
                toWholeNumber(shopPurchaseSuccessSource.lookback_minutes, defaults.shop_purchase_success.lookback_minutes),
                1,
                24 * 60
            ),
            dedupe_window_minutes: clamp(
                toWholeNumber(shopPurchaseSuccessSource.dedupe_window_minutes, defaults.shop_purchase_success.dedupe_window_minutes),
                1,
                30 * 24 * 60
            ),
            work_hours_only_enabled: normalizeConfigBoolean(
                shopPurchaseSuccessSource.work_hours_only_enabled,
                defaults.shop_purchase_success.work_hours_only_enabled
            ),
            summary_enabled: normalizeConfigBoolean(shopPurchaseSuccessSource.summary_enabled, defaults.shop_purchase_success.summary_enabled),
            summary_window_minutes: clamp(
                toWholeNumber(shopPurchaseSuccessSource.summary_window_minutes, defaults.shop_purchase_success.summary_window_minutes),
                5,
                24 * 60
            ),
            summary_max_items: clamp(
                toWholeNumber(shopPurchaseSuccessSource.summary_max_items, defaults.shop_purchase_success.summary_max_items),
                1,
                50
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                shopPurchaseSuccessSource.summary_schedule_mode,
                defaults.shop_purchase_success.summary_schedule_mode
            ),
            summary_hourly_minute: clamp(
                toWholeNumber(shopPurchaseSuccessSource.summary_hourly_minute, defaults.shop_purchase_success.summary_hourly_minute),
                0,
                59
            ),
            summary_daily_hour: clamp(
                toWholeNumber(shopPurchaseSuccessSource.summary_daily_hour, defaults.shop_purchase_success.summary_daily_hour),
                0,
                23
            ),
            summary_daily_minute: clamp(
                toWholeNumber(shopPurchaseSuccessSource.summary_daily_minute, defaults.shop_purchase_success.summary_daily_minute),
                0,
                59
            )
        },
        wallet_recharge_success: {
            enabled: normalizeConfigBoolean(walletRechargeSuccessSource.enabled, defaults.wallet_recharge_success.enabled),
            sweep_interval_ms: clamp(
                toWholeNumber(walletRechargeSuccessSource.sweep_interval_ms, defaults.wallet_recharge_success.sweep_interval_ms),
                10000,
                60 * 60 * 1000
            ),
            lookback_minutes: clamp(
                toWholeNumber(walletRechargeSuccessSource.lookback_minutes, defaults.wallet_recharge_success.lookback_minutes),
                1,
                24 * 60
            ),
            dedupe_window_minutes: clamp(
                toWholeNumber(walletRechargeSuccessSource.dedupe_window_minutes, defaults.wallet_recharge_success.dedupe_window_minutes),
                1,
                30 * 24 * 60
            ),
            work_hours_only_enabled: normalizeConfigBoolean(
                walletRechargeSuccessSource.work_hours_only_enabled,
                defaults.wallet_recharge_success.work_hours_only_enabled
            ),
            summary_enabled: normalizeConfigBoolean(walletRechargeSuccessSource.summary_enabled, defaults.wallet_recharge_success.summary_enabled),
            summary_window_minutes: clamp(
                toWholeNumber(walletRechargeSuccessSource.summary_window_minutes, defaults.wallet_recharge_success.summary_window_minutes),
                5,
                24 * 60
            ),
            summary_max_items: clamp(
                toWholeNumber(walletRechargeSuccessSource.summary_max_items, defaults.wallet_recharge_success.summary_max_items),
                1,
                50
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                walletRechargeSuccessSource.summary_schedule_mode,
                defaults.wallet_recharge_success.summary_schedule_mode
            ),
            summary_hourly_minute: clamp(
                toWholeNumber(walletRechargeSuccessSource.summary_hourly_minute, defaults.wallet_recharge_success.summary_hourly_minute),
                0,
                59
            ),
            summary_daily_hour: clamp(
                toWholeNumber(walletRechargeSuccessSource.summary_daily_hour, defaults.wallet_recharge_success.summary_daily_hour),
                0,
                23
            ),
            summary_daily_minute: clamp(
                toWholeNumber(walletRechargeSuccessSource.summary_daily_minute, defaults.wallet_recharge_success.summary_daily_minute),
                0,
                59
            )
        },
        tickets: {
            enabled: normalizeConfigBoolean(ticketsSource.enabled, defaults.tickets.enabled),
            sweep_interval_ms: clamp(
                toWholeNumber(ticketsSource.sweep_interval_ms, defaults.tickets.sweep_interval_ms),
                10000,
                60 * 60 * 1000
            ),
            pending_overdue_minutes: clamp(
                toWholeNumber(ticketsSource.pending_overdue_minutes, defaults.tickets.pending_overdue_minutes),
                5,
                14 * 24 * 60
            ),
            critical_overdue_minutes: clamp(
                toWholeNumber(ticketsSource.critical_overdue_minutes, defaults.tickets.critical_overdue_minutes),
                30,
                30 * 24 * 60
            ),
            state_lookback_minutes: clamp(
                toWholeNumber(ticketsSource.state_lookback_minutes, defaults.tickets.state_lookback_minutes),
                30,
                7 * 24 * 60
            ),
            dedupe_window_minutes: clamp(
                toWholeNumber(ticketsSource.dedupe_window_minutes, defaults.tickets.dedupe_window_minutes),
                1,
                24 * 60
            ),
            page_size: clamp(
                toWholeNumber(ticketsSource.page_size, defaults.tickets.page_size),
                50,
                5000
            ),
            max_pages: clamp(
                toWholeNumber(ticketsSource.max_pages, defaults.tickets.max_pages),
                1,
                100
            ),
            work_hours_only_enabled: normalizeConfigBoolean(
                ticketsSource.work_hours_only_enabled,
                defaults.tickets.work_hours_only_enabled
            ),
            summary_enabled: normalizeConfigBoolean(ticketsSource.summary_enabled, defaults.tickets.summary_enabled),
            summary_window_minutes: clamp(
                toWholeNumber(ticketsSource.summary_window_minutes, defaults.tickets.summary_window_minutes),
                5,
                24 * 60
            ),
            summary_max_items: clamp(
                toWholeNumber(ticketsSource.summary_max_items, defaults.tickets.summary_max_items),
                1,
                50
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                ticketsSource.summary_schedule_mode,
                defaults.tickets.summary_schedule_mode
            ),
            summary_hourly_minute: clamp(
                toWholeNumber(ticketsSource.summary_hourly_minute, defaults.tickets.summary_hourly_minute),
                0,
                59
            ),
            summary_daily_hour: clamp(
                toWholeNumber(ticketsSource.summary_daily_hour, defaults.tickets.summary_daily_hour),
                0,
                23
            ),
            summary_daily_minute: clamp(
                toWholeNumber(ticketsSource.summary_daily_minute, defaults.tickets.summary_daily_minute),
                0,
                59
            )
        },
        shop_order_delivery: {
            enabled: normalizeConfigBoolean(shopOrderDeliverySource.enabled, defaults.shop_order_delivery.enabled),
            sweep_interval_ms: clamp(
                toWholeNumber(shopOrderDeliverySource.sweep_interval_ms, defaults.shop_order_delivery.sweep_interval_ms),
                10000,
                60 * 60 * 1000
            ),
            lookback_days: clamp(
                toWholeNumber(shopOrderDeliverySource.lookback_days, defaults.shop_order_delivery.lookback_days),
                1,
                90
            ),
            state_lookback_minutes: clamp(
                toWholeNumber(shopOrderDeliverySource.state_lookback_minutes, defaults.shop_order_delivery.state_lookback_minutes),
                30,
                7 * 24 * 60
            ),
            retry_waiting_min_attempts: clamp(
                toWholeNumber(shopOrderDeliverySource.retry_waiting_min_attempts, defaults.shop_order_delivery.retry_waiting_min_attempts),
                1,
                50
            ),
            dedupe_window_minutes: clamp(
                toWholeNumber(shopOrderDeliverySource.dedupe_window_minutes, defaults.shop_order_delivery.dedupe_window_minutes),
                1,
                24 * 60
            ),
            incident_enabled: normalizeConfigBoolean(
                shopOrderDeliverySource.incident_enabled,
                defaults.shop_order_delivery.incident_enabled
            ),
            incident_min_order_count: clamp(
                toWholeNumber(shopOrderDeliverySource.incident_min_order_count, defaults.shop_order_delivery.incident_min_order_count),
                2,
                50
            ),
            incident_min_dead_letter_count: clamp(
                toWholeNumber(shopOrderDeliverySource.incident_min_dead_letter_count, defaults.shop_order_delivery.incident_min_dead_letter_count),
                0,
                50
            ),
            incident_min_distinct_users: clamp(
                toWholeNumber(shopOrderDeliverySource.incident_min_distinct_users, defaults.shop_order_delivery.incident_min_distinct_users),
                1,
                50
            ),
            incident_dedupe_window_minutes: clamp(
                toWholeNumber(shopOrderDeliverySource.incident_dedupe_window_minutes, defaults.shop_order_delivery.incident_dedupe_window_minutes),
                1,
                24 * 60
            ),
            page_size: clamp(
                toWholeNumber(shopOrderDeliverySource.page_size, defaults.shop_order_delivery.page_size),
                50,
                5000
            ),
            max_pages: clamp(
                toWholeNumber(shopOrderDeliverySource.max_pages, defaults.shop_order_delivery.max_pages),
                1,
                100
            ),
            work_hours_only_enabled: normalizeConfigBoolean(
                shopOrderDeliverySource.work_hours_only_enabled,
                defaults.shop_order_delivery.work_hours_only_enabled
            ),
            summary_enabled: normalizeConfigBoolean(
                shopOrderDeliverySource.summary_enabled,
                defaults.shop_order_delivery.summary_enabled
            ),
            summary_window_minutes: clamp(
                toWholeNumber(shopOrderDeliverySource.summary_window_minutes, defaults.shop_order_delivery.summary_window_minutes),
                5,
                24 * 60
            ),
            summary_max_items: clamp(
                toWholeNumber(shopOrderDeliverySource.summary_max_items, defaults.shop_order_delivery.summary_max_items),
                1,
                50
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                shopOrderDeliverySource.summary_schedule_mode,
                defaults.shop_order_delivery.summary_schedule_mode
            ),
            summary_hourly_minute: clamp(
                toWholeNumber(shopOrderDeliverySource.summary_hourly_minute, defaults.shop_order_delivery.summary_hourly_minute),
                0,
                59
            ),
            summary_daily_hour: clamp(
                toWholeNumber(shopOrderDeliverySource.summary_daily_hour, defaults.shop_order_delivery.summary_daily_hour),
                0,
                23
            ),
            summary_daily_minute: clamp(
                toWholeNumber(shopOrderDeliverySource.summary_daily_minute, defaults.shop_order_delivery.summary_daily_minute),
                0,
                59
            )
        },
        verify_quota: {
            enabled: normalizeConfigBoolean(verifyQuotaSource.enabled, defaults.verify_quota.enabled),
            sweep_interval_ms: clamp(
                toWholeNumber(verifyQuotaSource.sweep_interval_ms, defaults.verify_quota.sweep_interval_ms),
                10000,
                60 * 60 * 1000
            ),
            request_timeout_ms: clamp(
                toWholeNumber(verifyQuotaSource.request_timeout_ms, defaults.verify_quota.request_timeout_ms),
                1000,
                60 * 1000
            ),
            low_balance_threshold: clamp(
                toWholeNumber(verifyQuotaSource.low_balance_threshold, defaults.verify_quota.low_balance_threshold),
                0,
                1000000
            ),
            low_remaining_jobs_threshold: clamp(
                toWholeNumber(verifyQuotaSource.low_remaining_jobs_threshold, defaults.verify_quota.low_remaining_jobs_threshold),
                0,
                1000000
            ),
            critical_balance_threshold: clamp(
                toWholeNumber(verifyQuotaSource.critical_balance_threshold, defaults.verify_quota.critical_balance_threshold),
                0,
                1000000
            ),
            critical_remaining_jobs_threshold: clamp(
                toWholeNumber(verifyQuotaSource.critical_remaining_jobs_threshold, defaults.verify_quota.critical_remaining_jobs_threshold),
                0,
                1000000
            ),
            min_queue_buffer_jobs: clamp(
                toWholeNumber(verifyQuotaSource.min_queue_buffer_jobs, defaults.verify_quota.min_queue_buffer_jobs),
                0,
                1000000
            ),
            dedupe_window_minutes: clamp(
                toWholeNumber(verifyQuotaSource.dedupe_window_minutes, defaults.verify_quota.dedupe_window_minutes),
                1,
                24 * 60
            ),
            work_hours_only_enabled: normalizeConfigBoolean(
                verifyQuotaSource.work_hours_only_enabled,
                defaults.verify_quota.work_hours_only_enabled
            ),
            summary_enabled: normalizeConfigBoolean(
                verifyQuotaSource.summary_enabled,
                defaults.verify_quota.summary_enabled
            ),
            summary_window_minutes: clamp(
                toWholeNumber(verifyQuotaSource.summary_window_minutes, defaults.verify_quota.summary_window_minutes),
                5,
                24 * 60
            ),
            summary_max_items: clamp(
                toWholeNumber(verifyQuotaSource.summary_max_items, defaults.verify_quota.summary_max_items),
                1,
                50
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                verifyQuotaSource.summary_schedule_mode,
                defaults.verify_quota.summary_schedule_mode
            ),
            summary_hourly_minute: clamp(
                toWholeNumber(verifyQuotaSource.summary_hourly_minute, defaults.verify_quota.summary_hourly_minute),
                0,
                59
            ),
            summary_daily_hour: clamp(
                toWholeNumber(verifyQuotaSource.summary_daily_hour, defaults.verify_quota.summary_daily_hour),
                0,
                23
            ),
            summary_daily_minute: clamp(
                toWholeNumber(verifyQuotaSource.summary_daily_minute, defaults.verify_quota.summary_daily_minute),
                0,
                59
            )
        },
        verify_queue: {
            enabled: normalizeConfigBoolean(verifyQueueSource.enabled, defaults.verify_queue.enabled),
            sweep_interval_ms: clamp(
                toWholeNumber(verifyQueueSource.sweep_interval_ms, defaults.verify_queue.sweep_interval_ms),
                10000,
                60 * 60 * 1000
            ),
            request_timeout_ms: clamp(
                toWholeNumber(verifyQueueSource.request_timeout_ms, defaults.verify_queue.request_timeout_ms),
                1000,
                60 * 1000
            ),
            recent_activity_lookback_hours: clamp(
                toWholeNumber(verifyQueueSource.recent_activity_lookback_hours, defaults.verify_queue.recent_activity_lookback_hours),
                1,
                72
            ),
            recent_failure_window_minutes: clamp(
                toWholeNumber(verifyQueueSource.recent_failure_window_minutes, defaults.verify_queue.recent_failure_window_minutes),
                5,
                24 * 60
            ),
            queue_size_threshold: clamp(
                toWholeNumber(verifyQueueSource.queue_size_threshold, defaults.verify_queue.queue_size_threshold),
                1,
                100000
            ),
            active_job_threshold: clamp(
                toWholeNumber(verifyQueueSource.active_job_threshold, defaults.verify_queue.active_job_threshold),
                1,
                100000
            ),
            oldest_pending_minutes_threshold: clamp(
                toWholeNumber(verifyQueueSource.oldest_pending_minutes_threshold, defaults.verify_queue.oldest_pending_minutes_threshold),
                1,
                24 * 60
            ),
            recent_failure_threshold: clamp(
                toWholeNumber(verifyQueueSource.recent_failure_threshold, defaults.verify_queue.recent_failure_threshold),
                1,
                100000
            ),
            dedupe_window_minutes: clamp(
                toWholeNumber(verifyQueueSource.dedupe_window_minutes, defaults.verify_queue.dedupe_window_minutes),
                1,
                24 * 60
            ),
            page_size: clamp(
                toWholeNumber(verifyQueueSource.page_size, defaults.verify_queue.page_size),
                50,
                5000
            ),
            max_pages: clamp(
                toWholeNumber(verifyQueueSource.max_pages, defaults.verify_queue.max_pages),
                1,
                100
            ),
            work_hours_only_enabled: normalizeConfigBoolean(
                verifyQueueSource.work_hours_only_enabled,
                defaults.verify_queue.work_hours_only_enabled
            ),
            summary_enabled: normalizeConfigBoolean(
                verifyQueueSource.summary_enabled,
                defaults.verify_queue.summary_enabled
            ),
            summary_window_minutes: clamp(
                toWholeNumber(verifyQueueSource.summary_window_minutes, defaults.verify_queue.summary_window_minutes),
                5,
                24 * 60
            ),
            summary_max_items: clamp(
                toWholeNumber(verifyQueueSource.summary_max_items, defaults.verify_queue.summary_max_items),
                1,
                50
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                verifyQueueSource.summary_schedule_mode,
                defaults.verify_queue.summary_schedule_mode
            ),
            summary_hourly_minute: clamp(
                toWholeNumber(verifyQueueSource.summary_hourly_minute, defaults.verify_queue.summary_hourly_minute),
                0,
                59
            ),
            summary_daily_hour: clamp(
                toWholeNumber(verifyQueueSource.summary_daily_hour, defaults.verify_queue.summary_daily_hour),
                0,
                23
            ),
            summary_daily_minute: clamp(
                toWholeNumber(verifyQueueSource.summary_daily_minute, defaults.verify_queue.summary_daily_minute),
                0,
                59
            )
        },
        verify_failure: {
            enabled: normalizeConfigBoolean(verifyFailureSource.enabled, defaults.verify_failure.enabled),
            sweep_interval_ms: clamp(
                toWholeNumber(verifyFailureSource.sweep_interval_ms, defaults.verify_failure.sweep_interval_ms),
                10000,
                60 * 60 * 1000
            ),
            recent_window_minutes: clamp(
                toWholeNumber(verifyFailureSource.recent_window_minutes, defaults.verify_failure.recent_window_minutes),
                5,
                24 * 60
            ),
            min_total_jobs_threshold: clamp(
                toWholeNumber(verifyFailureSource.min_total_jobs_threshold, defaults.verify_failure.min_total_jobs_threshold),
                1,
                100000
            ),
            failure_rate_threshold: clamp(
                toWholeNumber(verifyFailureSource.failure_rate_threshold, defaults.verify_failure.failure_rate_threshold),
                1,
                100
            ),
            affected_user_threshold: clamp(
                toWholeNumber(verifyFailureSource.affected_user_threshold, defaults.verify_failure.affected_user_threshold),
                1,
                100000
            ),
            dedupe_window_minutes: clamp(
                toWholeNumber(verifyFailureSource.dedupe_window_minutes, defaults.verify_failure.dedupe_window_minutes),
                1,
                24 * 60
            ),
            page_size: clamp(
                toWholeNumber(verifyFailureSource.page_size, defaults.verify_failure.page_size),
                50,
                5000
            ),
            max_pages: clamp(
                toWholeNumber(verifyFailureSource.max_pages, defaults.verify_failure.max_pages),
                1,
                100
            ),
            work_hours_only_enabled: normalizeConfigBoolean(
                verifyFailureSource.work_hours_only_enabled,
                defaults.verify_failure.work_hours_only_enabled
            ),
            summary_enabled: normalizeConfigBoolean(
                verifyFailureSource.summary_enabled,
                defaults.verify_failure.summary_enabled
            ),
            summary_window_minutes: clamp(
                toWholeNumber(verifyFailureSource.summary_window_minutes, defaults.verify_failure.summary_window_minutes),
                5,
                24 * 60
            ),
            summary_max_items: clamp(
                toWholeNumber(verifyFailureSource.summary_max_items, defaults.verify_failure.summary_max_items),
                1,
                50
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                verifyFailureSource.summary_schedule_mode,
                defaults.verify_failure.summary_schedule_mode
            ),
            summary_hourly_minute: clamp(
                toWholeNumber(verifyFailureSource.summary_hourly_minute, defaults.verify_failure.summary_hourly_minute),
                0,
                59
            ),
            summary_daily_hour: clamp(
                toWholeNumber(verifyFailureSource.summary_daily_hour, defaults.verify_failure.summary_daily_hour),
                0,
                23
            ),
            summary_daily_minute: clamp(
                toWholeNumber(verifyFailureSource.summary_daily_minute, defaults.verify_failure.summary_daily_minute),
                0,
                59
            )
        },
        payment_gateway: {
            enabled: normalizeConfigBoolean(paymentGatewaySource.enabled, defaults.payment_gateway.enabled),
            window_minutes: clamp(
                toWholeNumber(paymentGatewaySource.window_minutes, defaults.payment_gateway.window_minutes),
                5,
                24 * 60
            ),
            state_lookback_minutes: clamp(
                toWholeNumber(paymentGatewaySource.state_lookback_minutes, defaults.payment_gateway.state_lookback_minutes),
                30,
                7 * 24 * 60
            ),
            sweep_interval_ms: clamp(
                toWholeNumber(paymentGatewaySource.sweep_interval_ms, defaults.payment_gateway.sweep_interval_ms),
                10000,
                60 * 60 * 1000
            ),
            dedupe_window_minutes: clamp(
                toWholeNumber(paymentGatewaySource.dedupe_window_minutes, defaults.payment_gateway.dedupe_window_minutes),
                1,
                24 * 60
            ),
            min_order_volume: clamp(
                toWholeNumber(paymentGatewaySource.min_order_volume, defaults.payment_gateway.min_order_volume),
                1,
                200
            ),
            min_review_orders: clamp(
                toWholeNumber(paymentGatewaySource.min_review_orders, defaults.payment_gateway.min_review_orders),
                1,
                100
            ),
            min_failed_orders: clamp(
                toWholeNumber(paymentGatewaySource.min_failed_orders, defaults.payment_gateway.min_failed_orders),
                1,
                100
            ),
            min_webhook_volume: clamp(
                toWholeNumber(paymentGatewaySource.min_webhook_volume, defaults.payment_gateway.min_webhook_volume),
                1,
                500
            ),
            min_query_volume: clamp(
                toWholeNumber(paymentGatewaySource.min_query_volume, defaults.payment_gateway.min_query_volume),
                1,
                500
            ),
            max_paid_rate_percent: clamp(
                toWholeNumber(paymentGatewaySource.max_paid_rate_percent, defaults.payment_gateway.max_paid_rate_percent),
                1,
                100
            ),
            min_review_ratio_percent: clamp(
                toWholeNumber(paymentGatewaySource.min_review_ratio_percent, defaults.payment_gateway.min_review_ratio_percent),
                1,
                100
            ),
            min_failed_ratio_percent: clamp(
                toWholeNumber(paymentGatewaySource.min_failed_ratio_percent, defaults.payment_gateway.min_failed_ratio_percent),
                1,
                100
            ),
            max_webhook_success_rate_percent: clamp(
                toWholeNumber(paymentGatewaySource.max_webhook_success_rate_percent, defaults.payment_gateway.max_webhook_success_rate_percent),
                1,
                100
            ),
            max_query_success_rate_percent: clamp(
                toWholeNumber(paymentGatewaySource.max_query_success_rate_percent, defaults.payment_gateway.max_query_success_rate_percent),
                1,
                100
            ),
            min_webhook_5xx_count: clamp(
                toWholeNumber(paymentGatewaySource.min_webhook_5xx_count, defaults.payment_gateway.min_webhook_5xx_count),
                1,
                100
            ),
            min_query_5xx_count: clamp(
                toWholeNumber(paymentGatewaySource.min_query_5xx_count, defaults.payment_gateway.min_query_5xx_count),
                1,
                100
            ),
            page_size: clamp(
                toWholeNumber(paymentGatewaySource.page_size, defaults.payment_gateway.page_size),
                50,
                5000
            ),
            max_pages: clamp(
                toWholeNumber(paymentGatewaySource.max_pages, defaults.payment_gateway.max_pages),
                1,
                100
            ),
            work_hours_only_enabled: normalizeConfigBoolean(
                paymentGatewaySource.work_hours_only_enabled,
                defaults.payment_gateway.work_hours_only_enabled
            ),
            summary_enabled: normalizeConfigBoolean(
                paymentGatewaySource.summary_enabled,
                defaults.payment_gateway.summary_enabled
            ),
            summary_window_minutes: clamp(
                toWholeNumber(paymentGatewaySource.summary_window_minutes, defaults.payment_gateway.summary_window_minutes),
                5,
                24 * 60
            ),
            summary_max_items: clamp(
                toWholeNumber(paymentGatewaySource.summary_max_items, defaults.payment_gateway.summary_max_items),
                1,
                50
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                paymentGatewaySource.summary_schedule_mode,
                defaults.payment_gateway.summary_schedule_mode
            ),
            summary_hourly_minute: clamp(
                toWholeNumber(paymentGatewaySource.summary_hourly_minute, defaults.payment_gateway.summary_hourly_minute),
                0,
                59
            ),
            summary_daily_hour: clamp(
                toWholeNumber(paymentGatewaySource.summary_daily_hour, defaults.payment_gateway.summary_daily_hour),
                0,
                23
            ),
            summary_daily_minute: clamp(
                toWholeNumber(paymentGatewaySource.summary_daily_minute, defaults.payment_gateway.summary_daily_minute),
                0,
                59
            )
        }
    };
}

function normalizeAffiliateProgramConfig(raw) {
    const defaults = getDefaultAffiliateProgramConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const rewardNotice = typeof source.reward_notice === 'string' ? source.reward_notice : defaults.reward_notice;
    const legalDisclaimer = typeof source.legal_disclaimer === 'string' ? source.legal_disclaimer : defaults.legal_disclaimer;

    return {
        commission_rate_shop: clamp(toDecimal(source.commission_rate_shop, defaults.commission_rate_shop), 0, 1),
        commission_rate_agent: clamp(toDecimal(source.commission_rate_agent, defaults.commission_rate_agent), 0, 1),
        registration_reward_points: Math.max(0, toPointNumber(source.registration_reward_points, defaults.registration_reward_points)),
        registration_reward_requires_purchase: source.registration_reward_requires_purchase !== undefined
            ? String(source.registration_reward_requires_purchase) !== 'false'
            : defaults.registration_reward_requires_purchase,
        reward_notice: rewardNotice.trim() || defaults.reward_notice,
        legal_disclaimer: legalDisclaimer.trim() || defaults.legal_disclaimer
    };
}

function normalizeAffiliatePosterConfig(raw) {
    const defaults = getDefaultAffiliatePosterConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const sourceTemplates = Array.isArray(source.templates) ? source.templates : [];

    const templates = defaults.templates.map(defaultTemplate => {
        const match = sourceTemplates.find(template => template && template.id === defaultTemplate.id) || {};
        return {
            ...defaultTemplate,
            name: typeof match.name === 'string' && match.name.trim() ? match.name.trim() : defaultTemplate.name,
            description: typeof match.description === 'string' && match.description.trim() ? match.description.trim() : defaultTemplate.description,
            custom_background_url: typeof match.custom_background_url === 'string' ? match.custom_background_url.trim() : ''
        };
    });

    const activeTemplateId = templates.some(template => template.id === source.active_template_id)
        ? source.active_template_id
        : defaults.active_template_id;

    return {
        chip_label: typeof source.chip_label === 'string' && source.chip_label.trim() ? source.chip_label.trim() : defaults.chip_label,
        title: typeof source.title === 'string' && source.title.trim() ? source.title.trim() : defaults.title,
        subtitle: typeof source.subtitle === 'string' && source.subtitle.trim() ? source.subtitle.trim() : defaults.subtitle,
        reward_badge_text: typeof source.reward_badge_text === 'string' ? source.reward_badge_text.trim() : defaults.reward_badge_text,
        invite_code_label: typeof source.invite_code_label === 'string' && source.invite_code_label.trim() ? source.invite_code_label.trim() : defaults.invite_code_label,
        qr_label: typeof source.qr_label === 'string' && source.qr_label.trim() ? source.qr_label.trim() : defaults.qr_label,
        footer: typeof source.footer === 'string' && source.footer.trim() ? source.footer.trim() : defaults.footer,
        active_template_id: activeTemplateId,
        templates
    };
}

// ============================================
// INIT & LOAD
// ============================================

async function initSystemConfig() {
    console.log('[Config] Initializing system config...');
    try {
        await loadAllSystemConfig();
        setupConfigEventListeners();
        console.log('[Config] Initialized successfully');
    } catch (err) {
        console.error('[Config] Init error:', err);
    }
}

async function loadAllSystemConfig() {
    try {
        const { data, error } = await supabaseClient.rpc('get_all_system_config');

        if (error) throw error;

        // Cache configs
        (data || []).forEach(item => {
            systemConfigCache[item.config_key] = item.config_value;
        });

        // Render UI
        renderUnlockPricingConfig();
        renderPackagesConfig();
        renderPaymentChannelsConfig();
        renderOpsAlertSettings();
        renderOpsAlertHealthPanel();
        renderOpsAlertMonitorPanel();
        renderChannelsConfig();
        renderRewardsConfig();
        renderGeneralSettingsConfig();
        renderSecurityConfig();
        renderNotificationsConfig();
        renderModerationConfig();
        renderGalleryConfig();
        renderCommentRulesConfig();
        renderVerifyConfig();
        loadAffiliateSettings();
        loadPaymentChannelSettings();
        loadOpsAlertSettings();
        loadOpsAlertHealth();
        loadOpsAlertMonitor();

    } catch (err) {
        console.warn('[Config] Load error:', err.message);
        // Use defaults on error
    }
}

// ============================================
// RENDER FUNCTIONS
// ============================================

function renderUnlockPricingConfig() {
    const config = systemConfigCache['unlock_pricing'] || { default_points: 1, vip_discount: 0.9 };

    const pointsInput = document.getElementById('cfgUnlockPoints');
    const discountInput = document.getElementById('cfgVipDiscount');

    if (pointsInput) pointsInput.value = config.default_points || 1;
    if (discountInput) discountInput.value = (config.vip_discount || 0.9) * 100;
}

function renderPackagesConfig() {
    const rechargeOptions = normalizeRechargeOptionsConfig(systemConfigCache['recharge_options']);
    const customRechargeToggle = document.getElementById('customRechargeStatusToggle');
    if (customRechargeToggle) {
        customRechargeToggle.classList.toggle('active', rechargeOptions.custom_amount_enabled);
    }

    const mockPaymentToggle = document.getElementById('mockPaymentStatusToggle');
    if (mockPaymentToggle) {
        mockPaymentToggle.classList.toggle('active', rechargeOptions.mock_payment_enabled);
    }
}

function getPaymentSecretStatusMessage(secretName) {
    const status = paymentChannelSecretStatus?.[secretName];
    if (status?.configured) {
        return `已配置后台安全密钥${status.updatedAt ? ` · 更新于 ${new Date(status.updatedAt).toLocaleString('zh-CN')}` : ''}`;
    }
    return '未配置后台安全密钥';
}

function getOpsAlertSecretStatusMessage(secretName) {
    const status = opsAlertSecretStatus?.[secretName];
    if (!status?.configured) {
        return '未配置后台安全密钥';
    }

    const sourceLabel = status.source === 'environment' ? '环境变量' : '后台密钥仓';
    return `已配置${sourceLabel}${status.updatedAt ? ` · 更新于 ${new Date(status.updatedAt).toLocaleString('zh-CN')}` : ''}`;
}

function setOpsAlertDeleteButtonState(secretName, status) {
    const button = document.querySelector(`[data-admin-action="settings-delete-ops-alert-secret"][data-secret-name="${secretName}"]`);
    if (!button) return;

    if (status?.configured && status.source === 'stored') {
        button.disabled = false;
        button.title = '';
        return;
    }

    button.disabled = true;
    button.title = status?.source === 'environment'
        ? '当前密钥来自环境变量，请在 Vercel / Railway 中删除或修改。'
        : '当前没有可删除的后台密钥。';
}

function buildLocalOpsAlertChannelOverviewState(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts']), overviewStatus = getOpsAlertOverviewStatus(config)) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const normalizedOverviewStatus = overviewStatus && typeof overviewStatus === 'object' && !Array.isArray(overviewStatus)
        ? overviewStatus
        : {};

    return {
        masterEnabled: normalizedConfig.enabled === true,
        channels: [
            {
                toggleId: 'opsAlertTelegramEnabledToggle',
                enabled: normalizedConfig.channels.telegram.enabled === true,
                inputIds: [
                    'opsAlertTelegramChatIds',
                    'opsAlertTelegramSeverity',
                    'opsAlertTelegramBotToken'
                ],
                statusId: 'opsAlertTelegramBotTokenStatus',
                secretName: 'telegram_bot_token',
                secretStatus: normalizedOverviewStatus.telegramSecret || null
            },
            {
                toggleId: 'opsAlertFeishuEnabledToggle',
                enabled: normalizedConfig.channels.feishu.enabled === true,
                inputIds: [
                    'opsAlertFeishuSeverity',
                    'opsAlertFeishuWebhookUrl'
                ],
                statusId: 'opsAlertFeishuWebhookStatus',
                secretName: 'feishu_webhook_url',
                secretStatus: normalizedOverviewStatus.feishuSecret || null
            },
            {
                toggleId: 'opsAlertEmailEnabledToggle',
                enabled: normalizedConfig.channels.email.enabled === true,
                inputIds: [
                    'opsAlertEmailSeverity',
                    'opsAlertEmailRecipients',
                    'opsAlertEmailFromAddress',
                    'opsAlertEmailReplyTo',
                    'opsAlertEmailSubjectPrefix',
                    'opsAlertEmailApiKey'
                ],
                statusId: 'opsAlertEmailApiKeyStatus',
                secretName: 'email_api_key',
                secretStatus: normalizedOverviewStatus.emailSecret || null
            }
        ]
    };
}

function applyOpsAlertChannelOverviewState(channelOverviewState = {}) {
    const masterToggle = document.getElementById('opsAlertEnabledToggle');
    if (masterToggle) {
        masterToggle.classList.toggle('active', channelOverviewState.masterEnabled === true);
    }

    (Array.isArray(channelOverviewState.channels) ? channelOverviewState.channels : []).forEach((channel) => {
        const toggle = document.getElementById(channel.toggleId);
        if (toggle) {
            toggle.classList.toggle('active', channel.enabled === true);
        }

        (Array.isArray(channel.inputIds) ? channel.inputIds : []).forEach((id) => {
            const input = document.getElementById(id);
            if (input) {
                input.disabled = channel.enabled !== true;
            }
        });

        const statusEl = document.getElementById(channel.statusId);
        if (statusEl) {
            statusEl.textContent = getOpsAlertSecretStatusMessage(channel.secretName);
        }

        setOpsAlertDeleteButtonState(channel.secretName, channel.secretStatus || null);
    });
}

const OPS_ALERT_SECTION_CONTROL_APPLIERS = [
    applyOpsAlertStrategyControls,
    applyOpsAlertShopRiskControls,
    applyOpsAlertShopInventoryControls,
    applyOpsAlertCustomerChatControls,
    applyOpsAlertShopPurchaseSuccessControls,
    applyOpsAlertWalletRechargeSuccessControls,
    applyOpsAlertTicketsControls,
    applyOpsAlertShopOrderDeliveryControls,
    applyOpsAlertVerifyQuotaControls,
    applyOpsAlertVerifyQueueControls,
    applyOpsAlertVerifyFailureControls,
    applyOpsAlertPaymentGatewayControls
];

function applyOpsAlertSectionControlAppliers(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    OPS_ALERT_SECTION_CONTROL_APPLIERS.forEach((applyControls) => {
        if (typeof applyControls === 'function') {
            applyControls(normalizedConfig);
        }
    });
}

function getPaymentProviderDomRefs(providerKey) {
    const suffixMap = {
        mock: 'Mock',
        afdian: 'Afdian',
        hupijiao: 'Hupijiao'
    };
    const suffix = suffixMap[providerKey];
    if (!suffix) return null;

    return {
        accordion: document.getElementById(`paymentProviderAccordion${suffix}`),
        title: document.getElementById(`paymentProviderHeaderName${suffix}`),
        status: document.getElementById(`paymentProviderHeaderStatus${suffix}`),
        desc: document.getElementById(`paymentProviderHeaderDesc${suffix}`),
        panel: document.getElementById(`paymentProviderPanel${suffix}`),
        chevron: document.getElementById(`paymentProviderChevron${suffix}`)
    };
}

function setPaymentProviderPanelExpanded(providerKey, expanded) {
    if (!(providerKey in paymentChannelAccordionState)) return;
    paymentChannelAccordionState[providerKey] = !!expanded;

    const refs = getPaymentProviderDomRefs(providerKey);
    if (!refs) return;

    refs.accordion?.classList.toggle('expanded', !!expanded);
    refs.panel?.classList.toggle('expanded', !!expanded);
    refs.chevron?.classList.toggle('expanded', !!expanded);
}

function togglePaymentProviderPanel(providerKey) {
    const nextState = !paymentChannelAccordionState[providerKey];
    setPaymentProviderPanelExpanded(providerKey, nextState);
}

function applyPaymentChannelOverview(config) {
    const activeProvider = config.providers[config.active_provider];
    const mockRuntime = normalizePaymentChannelRuntimeState(paymentChannelRuntimeState).mock_payment;
    const isMockCurrentlyEnabled = config.active_provider === 'mock';
    const isMockActiveButBlocked = config.active_provider === 'mock' && mockRuntime.allowed !== true;
    const hasMockOverrideCleanupNotice = !isMockCurrentlyEnabled
        && mockRuntime.override_configured === true
        && Boolean(mockRuntime.cleanup_message);
    const summaryMessage = isMockActiveButBlocked
        ? mockRuntime.message
        : (hasMockOverrideCleanupNotice
            ? mockRuntime.cleanup_message
            : '公开配置保存在系统设置中；敏感密钥会通过服务端加密保存，不再存浏览器。');
    const summaryIcon = (isMockActiveButBlocked || hasMockOverrideCleanupNotice) ? 'fa-exclamation-triangle' : 'fa-plug';
    const activeSelect = document.getElementById('paymentChannelActiveSelect');
    if (activeSelect && activeSelect.value !== config.active_provider) {
        activeSelect.value = config.active_provider;
    }

    const summary = document.getElementById('paymentChannelSummary');
    if (summary) {
        summary.innerHTML = `
            <i class="fas ${summaryIcon}"></i>
            <span>当前主通道：${escapeConfigHtml(activeProvider.display_name)}。${escapeConfigHtml(summaryMessage)}</span>
        `;
    }

    const toggleMap = {
        mock: 'paymentProviderMockToggle',
        afdian: 'paymentProviderAfdianToggle',
        hupijiao: 'paymentProviderHupijiaoToggle'
    };

    const descriptionMap = {
        mock: isMockActiveButBlocked
            ? `当前已选择为主通道，但 ${mockRuntime.message}`
            : (hasMockOverrideCleanupNotice
                ? mockRuntime.cleanup_message
                : (config.providers.mock.description || '直接到账，适合短期过渡验证。')),
        afdian: `${config.providers.afdian.package_hint || '支付后输入订单号领取兑换码'} · ${paymentChannelSecretStatus?.afdian_token?.configured ? 'Token 已配置' : 'Token 待配置'}`,
        hupijiao: `${config.providers.hupijiao.merchant_id ? `商户号 ${config.providers.hupijiao.merchant_id}` : '商户号待填写'} · ${(paymentChannelSecretStatus?.hupijiao_api_key?.configured && paymentChannelSecretStatus?.hupijiao_secret_key?.configured) ? '密钥已配置' : '密钥待配置'}`
    };

    Object.keys(toggleMap).forEach((providerKey) => {
        const provider = config.providers[providerKey];
        const toggleEl = document.getElementById(toggleMap[providerKey]);
        const refs = getPaymentProviderDomRefs(providerKey);
        const isActiveProvider = providerKey === config.active_provider;
        const statusText = isActiveProvider
            ? (provider.enabled ? '主通道 · 已启用' : '主通道')
            : (provider.enabled ? '已启用' : '已停用');

        if (toggleEl) {
            toggleEl.classList.toggle('active', provider.enabled === true);
        }

        if (refs?.title) refs.title.textContent = provider.display_name || '未命名通道';
        if (refs?.desc) refs.desc.textContent = descriptionMap[providerKey];
        if (refs?.status) {
            refs.status.textContent = statusText;
            refs.status.className = `payment-provider-accordion-status ${isActiveProvider ? 'is-current' : (provider.enabled ? 'is-enabled' : 'is-disabled')}`;
        }
        if (refs?.accordion) {
            refs.accordion.classList.toggle('active-provider', isActiveProvider);
            refs.accordion.classList.toggle('is-disabled', !provider.enabled);
        }
    });
}

function handlePaymentChannelActiveChange(providerKey) {
    const toggleMap = {
        mock: 'paymentProviderMockToggle',
        afdian: 'paymentProviderAfdianToggle',
        hupijiao: 'paymentProviderHupijiaoToggle'
    };
    const toggleEl = document.getElementById(toggleMap[providerKey]);
    if (toggleEl && !toggleEl.classList.contains('active')) {
        toggleEl.classList.add('active');
    }
    setPaymentProviderPanelExpanded(providerKey, true);
    applyPaymentChannelOverview(collectPaymentChannelsConfigFromForm());
}

function renderPaymentChannelsConfig() {
    const config = normalizePaymentChannelsConfig(systemConfigCache['payment_channels']);

    const setValue = (id, value) => {
        const input = document.getElementById(id);
        if (input) input.value = value || '';
    };

    setValue('paymentProviderMockDisplayName', config.providers.mock.display_name);
    setValue('paymentProviderMockDescription', config.providers.mock.description);
    setValue('paymentProviderAfdianDisplayName', config.providers.afdian.display_name);
    setValue('paymentProviderAfdianCheckoutUrl', config.providers.afdian.checkout_url);
    setValue('paymentProviderAfdianPackageHint', config.providers.afdian.package_hint);
    setValue('paymentProviderAfdianCustomHint', config.providers.afdian.custom_amount_hint);
    setValue('paymentProviderHupijiaoDisplayName', config.providers.hupijiao.display_name);
    setValue('paymentProviderHupijiaoCheckoutUrl', config.providers.hupijiao.checkout_url);
    setValue('paymentProviderHupijiaoGatewayUrl', config.providers.hupijiao.gateway_url);
    setValue('paymentProviderHupijiaoMerchantId', config.providers.hupijiao.merchant_id);
    setValue('paymentProviderHupijiaoReturnUrl', config.providers.hupijiao.return_url);
    setValue('paymentProviderHupijiaoNotifyUrl', config.providers.hupijiao.notify_url);
    setValue('paymentProviderHupijiaoPackageHint', config.providers.hupijiao.package_hint);
    setValue('paymentProviderHupijiaoCustomHint', config.providers.hupijiao.custom_amount_hint);

    const afdianStatus = document.getElementById('paymentProviderAfdianTokenStatus');
    if (afdianStatus) afdianStatus.textContent = getPaymentSecretStatusMessage('afdian_token');

    const hupijiaoApiKeyStatus = document.getElementById('paymentProviderHupijiaoApiKeyStatus');
    if (hupijiaoApiKeyStatus) hupijiaoApiKeyStatus.textContent = getPaymentSecretStatusMessage('hupijiao_api_key');

    const hupijiaoSecretStatus = document.getElementById('paymentProviderHupijiaoSecretKeyStatus');
    if (hupijiaoSecretStatus) hupijiaoSecretStatus.textContent = getPaymentSecretStatusMessage('hupijiao_secret_key');

    applyPaymentChannelOverview(config);
    Object.entries(paymentChannelAccordionState).forEach(([providerKey, expanded]) => {
        setPaymentProviderPanelExpanded(providerKey, expanded);
    });
}

function applyOpsAlertOverview(config) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const overviewStatus = getOpsAlertOverviewStatus(normalizedConfig);
    applyOpsAlertChannelOverviewState(
        buildLocalOpsAlertChannelOverviewState(normalizedConfig, overviewStatus)
    );
    ensureOpsAlertMonitorCards();
    applyOpsAlertSectionControlAppliers(normalizedConfig);
    renderOpsAlertSummaryOrchestration(normalizedConfig);
    renderOpsAlertOverview(normalizedConfig);
    updateOpsAlertStrategyDraftIndicators(normalizedConfig);
}

function getOpsAlertRoutingCheckboxId(routingKey, channelKey) {
    const routingIdMap = {
        customer_chat_message: 'CustomerChatMessage',
        shop_purchase_success: 'ShopPurchaseSuccess',
        wallet_recharge_success: 'WalletRechargeSuccess',
        shop_inventory: 'ShopInventory',
        payment_refund_ops: 'PaymentRefundOps',
        payment_config: 'PaymentConfig',
        shop_order_risk: 'ShopOrderRisk',
        admin_login_anomaly: 'AdminLoginAnomaly',
        tickets: 'Tickets',
        shop_order_delivery: 'ShopOrderDelivery',
        payment_gateway: 'PaymentGateway',
        verify_quota: 'VerifyQuota',
        verify_queue: 'VerifyQueue',
        verify_failure: 'VerifyFailure'
    };
    const channelIdMap = {
        telegram: 'Telegram',
        feishu: 'Feishu',
        email: 'Email'
    };

    return `opsAlertRouting${routingIdMap[routingKey] || ''}${channelIdMap[channelKey] || ''}`;
}

const OPS_ALERT_ROUTING_DEFINITIONS = Object.freeze([
    {
        key: 'customer_chat_message',
        label: '客服消息',
        description: '用户给客服机器人发新消息时触发。'
    },
    {
        key: 'shop_purchase_success',
        label: '购买成功',
        description: '商城订单支付完成并创建成功后触发。'
    },
    {
        key: 'wallet_recharge_success',
        label: '充值成功',
        description: '钱包充值入账成功后触发。'
    },
    {
        key: 'shop_inventory',
        label: '库存与补货',
        description: '低库存、售罄和库存恢复都使用同一组路由。'
    },
    {
        key: 'payment_refund_ops',
        label: '退款运营',
        description: '退款失败、补偿失败和积分回滚异常使用同一组路由。'
    },
    {
        key: 'payment_config',
        label: '支付配置变更',
        description: '支付配置变更、事故升级和恢复通知使用同一组路由。'
    },
    {
        key: 'shop_order_risk',
        label: '商城风控',
        description: '商城风控异常和恢复通知使用同一组路由。'
    },
    {
        key: 'admin_login_anomaly',
        label: '管理员异常登录',
        description: '管理员异常登录安全告警使用单独一组路由。'
    },
    {
        key: 'tickets',
        label: '工单超时',
        description: '工单超时提醒、汇总和恢复通知共用同一组路由。'
    },
    {
        key: 'shop_order_delivery',
        label: '履约失败 / 死信',
        description: '履约失败、死信、集中事故和恢复通知使用同一组路由。'
    },
    {
        key: 'payment_gateway',
        label: '支付通道异常',
        description: '支付通道退化、恢复和汇总通知使用同一组路由。'
    },
    {
        key: 'verify_quota',
        label: '验证额度 / 停摆',
        description: '验证额度不足、服务停摆和对应汇总通知使用同一组路由。'
    },
    {
        key: 'verify_queue',
        label: '验证堆积',
        description: '验证队列堆积和对应汇总通知使用同一组路由。'
    },
    {
        key: 'verify_failure',
        label: '验证失败率 / 综合事故',
        description: '验证失败率异常、综合事故升级和恢复通知使用同一组路由。'
    }
]);

const OPS_ALERT_MUTE_RULE_TYPE_DEFINITIONS = Object.freeze([
    {
        key: 'customer_chat_message',
        id: 'CustomerChatMessage',
        label: '客服消息',
        description: '仅静默用户给客服机器人发新消息这类通知。'
    },
    {
        key: 'shop_purchase_success',
        id: 'ShopPurchaseSuccess',
        label: '购买成功',
        description: '仅静默商城订单支付成功并创建成功后的通知。'
    },
    {
        key: 'wallet_recharge_success',
        id: 'WalletRechargeSuccess',
        label: '充值成功',
        description: '仅静默钱包充值入账成功后的通知。'
    },
    {
        key: 'shop_inventory',
        id: 'ShopInventory',
        label: '库存与补货',
        description: '静默低库存、售罄和库存恢复相关通知。'
    },
    {
        key: 'payment_refund_ops',
        id: 'PaymentRefundOps',
        label: '退款运营',
        description: '静默退款失败、退款补偿和积分回滚异常通知。'
    },
    {
        key: 'payment_config',
        id: 'PaymentConfig',
        label: '支付配置变更',
        description: '静默支付配置变更、事故升级和恢复通知。'
    },
    {
        key: 'shop_order_risk',
        id: 'ShopOrderRisk',
        label: '商城风控',
        description: '静默商城风控异常与恢复通知。'
    },
    {
        key: 'admin_login_anomaly',
        id: 'AdminLoginAnomaly',
        label: '管理员异常登录',
        description: '静默管理员异常登录安全告警。'
    },
    {
        key: 'tickets',
        id: 'Tickets',
        label: '工单超时',
        description: '静默工单超时汇总、超时提醒和恢复通知。'
    },
    {
        key: 'shop_order_delivery',
        id: 'ShopOrderDelivery',
        label: '履约失败 / 死信',
        description: '静默履约失败、死信、集中事故和恢复通知。'
    },
    {
        key: 'payment_gateway',
        id: 'PaymentGateway',
        label: '支付通道异常',
        description: '静默支付通道退化、恢复与异常汇总通知。'
    },
    {
        key: 'verify_quota',
        id: 'VerifyQuota',
        label: '验证额度 / 停摆',
        description: '静默验证额度不足、服务停摆与对应汇总通知。'
    },
    {
        key: 'verify_queue',
        id: 'VerifyQueue',
        label: '验证堆积',
        description: '静默验证队列堆积和对应汇总通知。'
    },
    {
        key: 'verify_failure',
        id: 'VerifyFailure',
        label: '验证失败率 / 综合事故',
        description: '静默验证失败率异常、综合事故升级/恢复和对应汇总通知。'
    }
]);

const OPS_ALERT_MUTE_RULE_MODULE_DEFINITIONS = Object.freeze([
    {
        key: 'customer_engagement',
        id: 'CustomerEngagement',
        label: '客服互动',
        description: '统一静默客服消息等用户互动类通知。'
    },
    {
        key: 'commerce',
        id: 'Commerce',
        label: '交易成功',
        description: '统一静默购买成功、充值成功等交易完成通知。'
    },
    {
        key: 'inventory',
        id: 'Inventory',
        label: '库存与补货',
        description: '统一静默库存预警、售罄与库存恢复。'
    },
    {
        key: 'payments',
        id: 'Payments',
        label: '支付与退款',
        description: '统一静默支付通道、退款、支付配置相关告警。'
    },
    {
        key: 'shop_risk',
        id: 'ShopRisk',
        label: '商城风控',
        description: '统一静默优惠码异常、短时扫货、共享登录等商城风控告警。'
    },
    {
        key: 'verify',
        id: 'Verify',
        label: '验证服务',
        description: '统一静默验证额度、停摆、堆积、失败率与综合事故。'
    },
    {
        key: 'tickets',
        id: 'Tickets',
        label: '工单与售后',
        description: '统一静默工单超时与恢复通知。'
    },
    {
        key: 'fulfillment',
        id: 'Fulfillment',
        label: '履约与死信',
        description: '统一静默履约失败、集中事故和恢复通知。'
    },
    {
        key: 'security',
        id: 'Security',
        label: '安全与审计',
        description: '统一静默管理员异常登录等安全审计通知。'
    }
]);

function getOpsAlertMuteRuleDefinitions(scope) {
    return scope === 'modules'
        ? OPS_ALERT_MUTE_RULE_MODULE_DEFINITIONS
        : OPS_ALERT_MUTE_RULE_TYPE_DEFINITIONS;
}

function getOpsAlertMuteRuleElementId(scope, key, suffix) {
    const definition = getOpsAlertMuteRuleDefinitions(scope).find((item) => item.key === key);
    const scopeId = scope === 'modules' ? 'Module' : 'Type';
    return `opsAlert${scopeId}Mute${definition?.id || ''}${suffix}`;
}

function getOpsAlertStrategyLayoutRoot() {
    return document.querySelector('[data-config="ops-alerts-strategy"] .config-card-body');
}

function ensureOpsAlertMonitorCards() {
    const monitorsView = document.getElementById('ops-alerts-view-monitors');
    if (!monitorsView) {
        return;
    }

    const cards = OPS_ALERT_MONITOR_CARD_CONFIG_IDS
        .map((configId) => monitorsView.querySelector(`[data-config="${configId}"]`))
        .filter(Boolean);
    if (!cards.length) {
        return;
    }

    const firstPass = monitorsView.dataset.opsAlertMonitorCardsReady !== 'true';
    cards.forEach((card) => {
        const header = card.querySelector('.config-card-header');
        if (!header) {
            return;
        }

        header.dataset.adminAction = 'settings-toggle-config-card';
        header.classList.add('config-card-header--interactive');
        if (!header.querySelector('.config-card-arrow')) {
            const arrow = document.createElement('i');
            arrow.className = 'fas fa-chevron-down config-card-arrow';
            arrow.setAttribute('aria-hidden', 'true');
            header.appendChild(arrow);
        }

        if (firstPass) {
            card.classList.add('collapsed');
        }
        header.setAttribute('aria-expanded', String(!card.classList.contains('collapsed')));
    });

    if (!firstPass) {
        return;
    }

    monitorsView.addEventListener('input', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
            return;
        }
        updateOpsAlertStrategyDraftIndicators(collectOpsAlertConfigFromForm());
    });

    monitorsView.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
            return;
        }
        applyOpsAlertOverview(collectOpsAlertConfigFromForm());
    });

    monitorsView.dataset.opsAlertMonitorCardsReady = 'true';
}

function getOpsAlertSavedConfigSnapshot() {
    return normalizeOpsAlertConfig(systemConfigCache['ops_alerts']);
}

function hasOpsAlertUnsavedChanges(config = null) {
    const savedSnapshot = JSON.stringify(getOpsAlertSavedConfigSnapshot());
    const draftSnapshot = JSON.stringify(
        normalizeOpsAlertConfig(config || collectOpsAlertConfigFromForm())
    );
    return savedSnapshot !== draftSnapshot;
}

function updateOpsAlertStrategyDraftIndicators(config = null) {
    const dirty = hasOpsAlertUnsavedChanges(config);
    const saveBar = document.getElementById('opsAlertStrategySaveBar');
    const stateEl = document.getElementById('opsAlertStrategySaveState');
    const hintEl = document.getElementById('opsAlertStrategySaveHint');
    const saveButton = document.getElementById('opsAlertStrategyInlineSaveButton');
    const dirtyBadge = document.getElementById('opsAlertStrategyDirtyBadge');

    if (saveBar) {
        saveBar.classList.toggle('is-dirty', dirty);
        saveBar.classList.toggle('is-saving', opsAlertStrategySaveInFlight);
    }

    if (stateEl) {
        if (opsAlertStrategySaveInFlight) {
            stateEl.textContent = '保存中';
            stateEl.dataset.tone = 'neutral';
        } else if (dirty) {
            stateEl.textContent = '有未保存变更';
            stateEl.dataset.tone = 'warning';
        } else {
            stateEl.textContent = '当前配置已保存';
            stateEl.dataset.tone = 'success';
        }
    }
    if (hintEl) {
        if (opsAlertStrategySaveInFlight) {
            hintEl.textContent = '正在把当前页改动写回站外告警配置。';
        } else if (dirty) {
            hintEl.textContent = '当前页里的改动会先停留在浏览器里，点击右侧按钮即可直接保存。';
        } else {
            hintEl.textContent = '在这里改完就能就近保存，不用再切回概览。';
        }
    }

    if (saveButton) {
        saveButton.disabled = opsAlertStrategySaveInFlight || !dirty;
        saveButton.textContent = opsAlertStrategySaveInFlight
            ? '保存中...'
            : '保存站外告警配置';
    }

    if (dirtyBadge) {
        dirtyBadge.hidden = !dirty;
    }
}

function setOpsAlertStrategySaveBusy(isSaving) {
    opsAlertStrategySaveInFlight = isSaving === true;
    updateOpsAlertStrategyDraftIndicators();
}

function ensureOpsAlertStrategyBeforeUnloadPrompt() {
    if (opsAlertStrategyBeforeUnloadReady) return;

    window.addEventListener('beforeunload', (event) => {
        if (!hasOpsAlertUnsavedChanges()) {
            return;
        }
        event.preventDefault();
        event.returnValue = '';
    });

    opsAlertStrategyBeforeUnloadReady = true;
}

function confirmOpsAlertStrategyNavigation(currentViewName, nextViewName) {
    const currentView = String(currentViewName || '').trim();
    const nextView = String(nextViewName || '').trim();
    const guardedViews = {
        strategy: '策略中心'
    };
    if (!guardedViews[currentView] || !nextView || nextView === currentView || !hasOpsAlertUnsavedChanges()) {
        return true;
    }

    return window.confirm(`${guardedViews[currentView]}里还有未保存变更。现在切换标签后改动仍会保留在当前页面，但刷新或重新打开后会丢失。要继续切换吗？`);
}

function formatOpsAlertHourRange(startHour, endHour) {
    return `${formatOpsAlertTimeNumber(startHour, 0, 23)}:00 - ${formatOpsAlertTimeNumber(endHour, 0, 23)}:00`;
}

function buildOpsAlertInlineNumberInputHtml(id, placeholder, min = 0, max = 23) {
    return `<input type="text" inputmode="numeric" class="config-input ops-alert-inline-number-input" id="${escapeConfigHtml(id)}" data-number-min="${escapeConfigHtml(String(min))}" data-number-max="${escapeConfigHtml(String(max))}" maxlength="2" placeholder="${escapeConfigHtml(String(placeholder))}" autocomplete="off">`;
}

function buildOpsAlertDateTimeFieldHtml(inputId) {
    const weekdaysHtml = OPS_ALERT_DATE_PICKER_WEEKDAY_NAMES.map((label) => `<span>${escapeConfigHtml(label)}</span>`).join('');
    return `
        <div class="ops-alert-date-picker" data-picker-shell="${escapeConfigHtml(inputId)}">
            <input type="hidden" class="ops-alert-datetime-hidden" id="${escapeConfigHtml(inputId)}">
            <button type="button" class="ops-alert-date-picker__trigger" data-admin-action="settings-toggle-ops-alert-date-picker" data-picker-input-id="${escapeConfigHtml(inputId)}" aria-expanded="false" aria-label="选择日期和时间" title="选择日期和时间">
                <i class="far fa-calendar-alt" aria-hidden="true"></i>
            </button>
            <div class="ops-alert-date-picker__menu" data-picker-menu-for="${escapeConfigHtml(inputId)}" hidden>
                <div class="ops-alert-date-picker__presets">
                    ${OPS_ALERT_DATE_PICKER_PRESETS.map((preset) => `
                        <button type="button" class="ops-alert-date-picker__preset" data-admin-action="settings-set-ops-alert-date-picker-preset" data-picker-input-id="${escapeConfigHtml(inputId)}" data-picker-preset="${escapeConfigHtml(preset.key)}">${escapeConfigHtml(preset.label)}</button>
                    `).join('')}
                </div>
                <div class="ops-alert-date-picker__panel">
                    <div class="ops-alert-date-picker__calendar">
                        <div class="ops-alert-date-picker__calendar-head">
                            <button type="button" class="ops-alert-date-picker__nav" data-admin-action="settings-change-ops-alert-date-picker-month" data-picker-input-id="${escapeConfigHtml(inputId)}" data-month-delta="-1">
                                <i class="fas fa-chevron-left"></i>
                            </button>
                            <span class="ops-alert-date-picker__title" data-picker-title-for="${escapeConfigHtml(inputId)}"></span>
                            <button type="button" class="ops-alert-date-picker__nav" data-admin-action="settings-change-ops-alert-date-picker-month" data-picker-input-id="${escapeConfigHtml(inputId)}" data-month-delta="1">
                                <i class="fas fa-chevron-right"></i>
                            </button>
                        </div>
                        <div class="ops-alert-date-picker__weekdays">${weekdaysHtml}</div>
                        <div class="ops-alert-date-picker__days" data-picker-days-for="${escapeConfigHtml(inputId)}"></div>
                    </div>
                    <div class="ops-alert-date-picker__sidebar">
                        <div class="ops-alert-date-picker__selection">
                            <span>静默到</span>
                            <strong data-picker-selection-for="${escapeConfigHtml(inputId)}">未设置</strong>
                            <p class="ops-alert-date-picker__range" data-picker-range-for="${escapeConfigHtml(inputId)}">从现在起开始静默，请先选日期，再补全小时和分钟。</p>
                        </div>
                        <div class="ops-alert-date-picker__time-grid">
                            <label class="ops-alert-date-picker__time-field">
                                <span>小时</span>
                                <input type="text" inputmode="numeric" maxlength="2" class="config-input ops-alert-inline-number-input ops-alert-date-picker__time-input" data-picker-input-id="${escapeConfigHtml(inputId)}" data-picker-time-part="hour" data-number-min="0" data-number-max="23" placeholder="09" autocomplete="off">
                            </label>
                            <label class="ops-alert-date-picker__time-field">
                                <span>分钟</span>
                                <input type="text" inputmode="numeric" maxlength="2" class="config-input ops-alert-inline-number-input ops-alert-date-picker__time-input" data-picker-input-id="${escapeConfigHtml(inputId)}" data-picker-time-part="minute" data-number-min="0" data-number-max="59" placeholder="30" autocomplete="off">
                            </label>
                        </div>
                        <div class="ops-alert-date-picker__footer">
                            <button type="button" class="btn-add-config btn-add-config--compact btn-add-config--ghost" data-admin-action="settings-clear-ops-alert-date-picker" data-picker-input-id="${escapeConfigHtml(inputId)}">清除</button>
                            <button type="button" class="btn-add-config btn-add-config--compact" data-admin-action="settings-apply-ops-alert-date-picker" data-picker-input-id="${escapeConfigHtml(inputId)}">确定</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function parseOpsAlertDateTimeLocalParts(value = '') {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) {
        return {
            valid: false,
            date: null,
            year: '',
            month: '',
            day: '',
            hour: '',
            minute: ''
        };
    }

    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const day = Number.parseInt(match[3], 10);
    const hour = Number.parseInt(match[4], 10);
    const minute = Number.parseInt(match[5], 10);
    const candidate = new Date(year, month - 1, day, hour, minute, 0, 0);
    const valid = (
        candidate.getFullYear() === year
        && candidate.getMonth() === month - 1
        && candidate.getDate() === day
        && candidate.getHours() === hour
        && candidate.getMinutes() === minute
    );

    return {
        valid,
        date: valid ? candidate : null,
        year: match[1],
        month: match[2],
        day: match[3],
        hour: match[4],
        minute: match[5]
    };
}

function getOpsAlertDatePickerShell(inputId) {
    return document.querySelector(`.ops-alert-date-picker[data-picker-shell="${inputId}"]`);
}

function getOpsAlertDatePickerMenu(inputId) {
    return document.querySelector(`.ops-alert-date-picker__menu[data-picker-menu-for="${inputId}"]`);
}

function getOpsAlertDatePickerDefaultDate() {
    const nextDate = new Date();
    nextDate.setSeconds(0, 0);
    nextDate.setMinutes(0);
    nextDate.setHours(nextDate.getHours() + 1);
    return nextDate;
}

function getOpsAlertDatePickerState(inputId) {
    if (!opsAlertDatePickerState[inputId]) {
        const initialDate = getOpsAlertDatePickerDefaultDate();
        opsAlertDatePickerState[inputId] = {
            year: initialDate.getFullYear(),
            month: initialDate.getMonth(),
            day: null,
            hour: String(initialDate.getHours()).padStart(2, '0'),
            minute: String(initialDate.getMinutes()).padStart(2, '0')
        };
    }
    return opsAlertDatePickerState[inputId];
}

function updateOpsAlertDateTimeFieldState(inputId, options = {}) {
    const shell = getOpsAlertDatePickerShell(inputId);
    if (!shell) return;

    shell.classList.toggle('is-filled', options.filled === true);
    shell.classList.toggle('is-open', options.open === true);
}

function syncOpsAlertDatePickerStateFromInput(inputId, options = {}) {
    const state = getOpsAlertDatePickerState(inputId);
    const hiddenInput = document.getElementById(inputId);
    const parsed = parseOpsAlertDateTimeLocalParts(hiddenInput?.value || '');

    if (parsed.valid && parsed.date) {
        state.year = parsed.date.getFullYear();
        state.month = parsed.date.getMonth();
        state.day = parsed.date.getDate();
        state.hour = parsed.hour;
        state.minute = parsed.minute;
        return state;
    }

    if (options.keepSelection) {
        return state;
    }

    const fallbackDate = getOpsAlertDatePickerDefaultDate();
    state.year = fallbackDate.getFullYear();
    state.month = fallbackDate.getMonth();
    state.day = null;
    state.hour = String(fallbackDate.getHours()).padStart(2, '0');
    state.minute = String(fallbackDate.getMinutes()).padStart(2, '0');
    return state;
}

function getOpsAlertDatePickerDraftDate(inputId) {
    const state = getOpsAlertDatePickerState(inputId);
    const hourText = String(state.hour || '').trim();
    const minuteText = String(state.minute || '').trim();
    if (!Number.isInteger(state.day) || !/^\d{1,2}$/.test(hourText) || !/^\d{1,2}$/.test(minuteText)) return null;

    const hour = clamp(Number.parseInt(hourText, 10), 0, 23);
    const minute = clamp(Number.parseInt(minuteText, 10), 0, 59);
    const candidate = new Date(state.year, state.month, state.day, hour, minute, 0, 0);
    const valid = (
        candidate.getFullYear() === state.year
        && candidate.getMonth() === state.month
        && candidate.getDate() === state.day
        && candidate.getHours() === hour
        && candidate.getMinutes() === minute
    );
    return valid ? candidate : null;
}

function formatOpsAlertDatePickerDisplayLabel(value = '') {
    const parsed = parseOpsAlertDateTimeLocalParts(value);
    return parsed.valid && parsed.date
        ? formatVerifyMonitorDateTime(parsed.date.getTime())
        : '选择日期和时间';
}

function renderOpsAlertDatePickerSelection(inputId) {
    const shell = getOpsAlertDatePickerShell(inputId);
    if (!shell) return;

    const state = getOpsAlertDatePickerState(inputId);
    const selectionEl = shell.querySelector(`[data-picker-selection-for="${inputId}"]`);
    const rangeEl = shell.querySelector(`[data-picker-range-for="${inputId}"]`);
    const hourInput = shell.querySelector(`.ops-alert-date-picker__time-input[data-picker-input-id="${inputId}"][data-picker-time-part="hour"]`);
    const minuteInput = shell.querySelector(`.ops-alert-date-picker__time-input[data-picker-input-id="${inputId}"][data-picker-time-part="minute"]`);
    if (hourInput instanceof HTMLInputElement) {
        hourInput.value = state.hour || '';
    }
    if (minuteInput instanceof HTMLInputElement) {
        minuteInput.value = state.minute || '';
    }

    const draftDate = getOpsAlertDatePickerDraftDate(inputId);
    if (selectionEl) {
        selectionEl.textContent = draftDate
            ? formatVerifyMonitorDateTime(draftDate.getTime())
            : '未设置';
    }
    if (rangeEl) {
        if (draftDate) {
            const now = new Date();
            rangeEl.textContent = draftDate.getTime() > now.getTime()
                ? `从现在开始静默，至 ${formatVerifyMonitorDateTime(draftDate.getTime())} 结束，约 ${formatOpsAlertRelativeDuration(draftDate, now)}。`
                : '所选结束时间早于当前时间，保存后会立即视为已到期。';
        } else {
            rangeEl.textContent = '从现在起开始静默，请先选日期，再补全小时和分钟。';
        }
    }
}

function renderOpsAlertDatePicker(inputId) {
    const shell = getOpsAlertDatePickerShell(inputId);
    if (!shell) return;

    const state = getOpsAlertDatePickerState(inputId);
    const titleEl = shell.querySelector(`[data-picker-title-for="${inputId}"]`);
    const daysEl = shell.querySelector(`[data-picker-days-for="${inputId}"]`);
    if (titleEl) {
        titleEl.textContent = `${OPS_ALERT_DATE_PICKER_MONTH_NAMES[state.month]} ${state.year}`;
    }
    if (!(daysEl instanceof HTMLElement)) {
        renderOpsAlertDatePickerSelection(inputId);
        return;
    }

    const selectedDate = Number.isInteger(state.day)
        ? new Date(state.year, state.month, state.day, 0, 0, 0, 0)
        : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const buildDayButton = (date, options = {}) => {
        const classes = ['ops-alert-date-picker__day'];
        if (options.otherMonth) classes.push('is-other-month');
        if (date.getTime() === today.getTime()) classes.push('is-today');
        if (selectedDate && date.getTime() === selectedDate.getTime()) classes.push('is-selected');
        return `
            <button
                type="button"
                class="${classes.join(' ')}"
                data-admin-action="settings-select-ops-alert-date-picker-day"
                data-picker-input-id="${escapeConfigHtml(inputId)}"
                data-picker-year="${escapeConfigHtml(String(date.getFullYear()))}"
                data-picker-month="${escapeConfigHtml(String(date.getMonth()))}"
                data-picker-day="${escapeConfigHtml(String(date.getDate()))}"
            >${escapeConfigHtml(String(date.getDate()))}</button>
        `;
    };

    const firstDay = new Date(state.year, state.month, 1);
    const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
    let daysHtml = '';
    for (let offset = firstDay.getDay() - 1; offset >= 0; offset -= 1) {
        daysHtml += buildDayButton(new Date(state.year, state.month, -offset), { otherMonth: true });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
        daysHtml += buildDayButton(new Date(state.year, state.month, day));
    }
    const totalCells = firstDay.getDay() + daysInMonth;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let day = 1; day <= remainingCells; day += 1) {
        daysHtml += buildDayButton(new Date(state.year, state.month + 1, day), { otherMonth: true });
    }
    daysEl.innerHTML = daysHtml;
    renderOpsAlertDatePickerSelection(inputId);
}

function closeAllOpsAlertDatePickers(exceptInputId = '') {
    document.querySelectorAll('.ops-alert-date-picker.is-open').forEach((shell) => {
        if (!(shell instanceof HTMLElement)) return;
        if (exceptInputId && shell.dataset.pickerShell === exceptInputId) return;

        shell.classList.remove('is-open');
        const menu = shell.querySelector('.ops-alert-date-picker__menu');
        const trigger = shell.querySelector('.ops-alert-date-picker__trigger');
        if (menu instanceof HTMLElement) menu.hidden = true;
        if (trigger instanceof HTMLElement) trigger.setAttribute('aria-expanded', 'false');
    });
}

function ensureOpsAlertDatePickerEvents() {
    if (opsAlertDatePickerEventsReady) return;

    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [];
        const clickedInsideDatePicker = target?.closest('.ops-alert-date-picker')
            || eventPath.some((node) => (
                node instanceof Element
                && (node.classList.contains('ops-alert-date-picker') || node.classList.contains('ops-alert-date-picker__menu'))
            ));
        if (clickedInsideDatePicker) {
            return;
        }
        closeAllOpsAlertDatePickers();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeAllOpsAlertDatePickers();
        }
    });
    opsAlertDatePickerEventsReady = true;
}

function toggleOpsAlertDatePicker(inputId) {
    const shell = getOpsAlertDatePickerShell(inputId);
    const menu = getOpsAlertDatePickerMenu(inputId);
    if (!shell || !menu) return;

    const shouldOpen = !shell.classList.contains('is-open');
    closeAllOpsAlertDatePickers(shouldOpen ? inputId : '');

    if (!shouldOpen) {
        shell.classList.remove('is-open');
        menu.hidden = true;
        shell.querySelector('.ops-alert-date-picker__trigger')?.setAttribute('aria-expanded', 'false');
        return;
    }

    syncOpsAlertDatePickerStateFromInput(inputId);
    renderOpsAlertDatePicker(inputId);
    shell.classList.add('is-open');
    menu.hidden = false;
    shell.querySelector('.ops-alert-date-picker__trigger')?.setAttribute('aria-expanded', 'true');
}

function changeOpsAlertDatePickerMonth(inputId, delta) {
    const state = getOpsAlertDatePickerState(inputId);
    state.month += delta;
    if (state.month > 11) {
        state.month = 0;
        state.year += 1;
    } else if (state.month < 0) {
        state.month = 11;
        state.year -= 1;
    }
    renderOpsAlertDatePicker(inputId);
}

function selectOpsAlertDatePickerDay(inputId, year, month, day) {
    const state = getOpsAlertDatePickerState(inputId);
    state.year = year;
    state.month = month;
    state.day = day;
    renderOpsAlertDatePicker(inputId);
}

function applyOpsAlertDatePickerValue(inputId, value, options = {}) {
    const input = document.getElementById(inputId);
    if (!(input instanceof HTMLInputElement)) return;

    input.value = value;
    syncOpsAlertDateTimeFieldDisplay(inputId);
    closeAllOpsAlertDatePickers();
    refreshOpsAlertStrategyDraftViews();
    if (options.toast) {
        showToast(options.toast, options.tone || 'info');
    }
}

function applyOpsAlertDatePicker(inputId) {
    const draftDate = getOpsAlertDatePickerDraftDate(inputId);
    if (!draftDate) {
        showToast('请先选择有效的日期和时间', 'warning');
        return;
    }
    applyOpsAlertDatePickerValue(inputId, formatDateTimeLocalInputValue(draftDate));
}

function clearOpsAlertDatePicker(inputId) {
    syncOpsAlertDatePickerStateFromInput(inputId);
    applyOpsAlertDatePickerValue(inputId, '');
}

function setOpsAlertDatePickerPreset(inputId, presetKey) {
    const preset = OPS_ALERT_DATE_PICKER_PRESETS.find((item) => item.key === presetKey);
    if (!preset) return;

    const baseDate = new Date();
    baseDate.setSeconds(0, 0);
    if (preset.mode === 'end_of_day') {
        baseDate.setHours(23, 59, 0, 0);
    } else {
        baseDate.setMinutes(0, 0, 0);
        baseDate.setHours(baseDate.getHours() + Math.max(1, Number(preset.hours) || 0));
    }
    applyOpsAlertDatePickerValue(inputId, formatDateTimeLocalInputValue(baseDate));
}

function syncOpsAlertDateTimeFieldDisplay(inputId) {
    const hiddenInput = document.getElementById(inputId);
    const shell = getOpsAlertDatePickerShell(inputId);
    if (!(hiddenInput instanceof HTMLInputElement) || !shell) return;

    const parsed = parseOpsAlertDateTimeLocalParts(hiddenInput.value);
    const trigger = shell.querySelector('.ops-alert-date-picker__trigger');
    if (trigger instanceof HTMLElement) {
        const triggerLabel = parsed.valid
            ? `当前静默到 ${formatOpsAlertDatePickerDisplayLabel(hiddenInput.value)}，点击重新调整`
            : '选择日期和时间';
        trigger.setAttribute('aria-label', triggerLabel);
        trigger.setAttribute('title', triggerLabel);
    }
    updateOpsAlertDateTimeFieldState(inputId, {
        filled: parsed.valid,
        open: shell.classList.contains('is-open')
    });
    if (!shell.classList.contains('is-open')) {
        syncOpsAlertDatePickerStateFromInput(inputId, { keepSelection: false });
    }
    renderOpsAlertDatePickerSelection(inputId);
}

function syncAllOpsAlertDateTimeFields(root = document) {
    root.querySelectorAll('.ops-alert-datetime-hidden').forEach((input) => {
        if (input instanceof HTMLInputElement && input.id) {
            syncOpsAlertDateTimeFieldDisplay(input.id);
        }
    });
}

function sanitizeOpsAlertInlineNumberInput(inputEl) {
    inputEl.value = String(inputEl.value || '').replace(/\D+/g, '').slice(0, 2);
    return inputEl.value;
}

function normalizeOpsAlertInlineNumberInput(inputEl, options = {}) {
    const valueText = sanitizeOpsAlertInlineNumberInput(inputEl);
    if (!valueText) return '';

    const min = Number.parseInt(inputEl.dataset.numberMin || '0', 10);
    const max = Number.parseInt(inputEl.dataset.numberMax || '59', 10);
    const value = clamp(Number.parseInt(valueText, 10), min, max);
    inputEl.value = options.pad === true
        ? String(value).padStart(2, '0')
        : String(value);
    return inputEl.value;
}

function syncOpsAlertDatePickerTimeInput(inputEl, options = {}) {
    const normalizedValue = options.commit === true
        ? normalizeOpsAlertInlineNumberInput(inputEl, { pad: true })
        : sanitizeOpsAlertInlineNumberInput(inputEl);
    const inputId = inputEl.dataset.pickerInputId;
    const part = inputEl.dataset.pickerTimePart;
    if (!inputId || !part) return;

    const state = getOpsAlertDatePickerState(inputId);
    state[part] = normalizedValue || '';
    renderOpsAlertDatePickerSelection(inputId);
}

function buildOpsAlertInfoTipHtml(text, options = {}) {
    const normalizedText = String(text || '').trim();
    const normalizedId = String(options.id || '').trim();
    const tooltipAttr = normalizedText ? ` data-tooltip="${escapeConfigHtml(normalizedText)}" aria-label="${escapeConfigHtml(normalizedText)}"` : '';
    const idAttr = normalizedId ? ` id="${escapeConfigHtml(normalizedId)}"` : '';
    return `<span class="ops-alert-info-tip"${idAttr}${tooltipAttr}><i class="fas fa-circle-info" aria-hidden="true"></i></span>`;
}

function setOpsAlertInfoTipText(elementId, text) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const normalizedText = String(text || '').trim();
    if (normalizedText) {
        element.setAttribute('data-tooltip', normalizedText);
        element.setAttribute('aria-label', normalizedText);
        element.hidden = false;
    } else {
        element.removeAttribute('data-tooltip');
        element.removeAttribute('aria-label');
        element.hidden = true;
    }
}

function buildOpsAlertMuteTableHtml(scope) {
    return `
        <div class="ops-alert-mute-table__body">
            ${getOpsAlertMuteRuleDefinitions(scope).map((definition) => {
                const statusId = getOpsAlertMuteRuleElementId(scope, definition.key, 'Status');
                const untilId = getOpsAlertMuteRuleElementId(scope, definition.key, 'Until');
                const toggleId = getOpsAlertMuteRuleElementId(scope, definition.key, 'AllowCriticalToggle');
                const clearButtonId = getOpsAlertMuteRuleElementId(scope, definition.key, 'Clear');
                return `
                    <div class="ops-alert-mute-table__row" data-mute-rule-row="${escapeConfigHtml(scope)}:${escapeConfigHtml(definition.key)}">
                        <div class="ops-alert-mute-table__main">
                            <div class="ops-alert-mute-table__subject">
                                <strong>${escapeConfigHtml(definition.label)}${buildOpsAlertInfoTipHtml(definition.description)}</strong>
                            </div>
                            <div class="ops-alert-mute-field ops-alert-mute-field--picker ops-alert-mute-field--actions">
                                <span>静默至</span>
                                <div class="ops-alert-mute-picker-actions">
                                    ${buildOpsAlertDateTimeFieldHtml(untilId)}
                                    <button type="button" class="ops-alert-mute-clear-btn" id="${escapeConfigHtml(clearButtonId)}" data-admin-action="settings-clear-ops-alert-mute-rule" data-rule-scope="${escapeConfigHtml(scope)}" data-rule-key="${escapeConfigHtml(definition.key)}" aria-label="清除此条静默" title="清除">
                                        <i class="fas fa-xmark" aria-hidden="true"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="ops-alert-mute-table__aside">
                            <div class="ops-alert-mute-status ops-alert-mute-status--compact" id="${escapeConfigHtml(statusId)}">当前未设置单独静默。</div>
                            <div class="ops-alert-mute-toggle-field">
                                <div class="ops-alert-mute-toggle-field__copy">
                                    <span>critical 继续通知${buildOpsAlertInfoTipHtml('只压住普通噪音，保留真正高危的异常继续外发。')}</span>
                                </div>
                                <div class="status-toggle" id="${escapeConfigHtml(toggleId)}" data-admin-action="settings-toggle-ops-alert-mute-rule-allow-critical" data-rule-scope="${escapeConfigHtml(scope)}" data-rule-key="${escapeConfigHtml(definition.key)}"></div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function buildOpsAlertRoutingMatrixHtml() {
    const channelLabels = {
        telegram: 'Telegram',
        feishu: '飞书',
        email: '邮件'
    };
    const channelOrder = ['telegram', 'feishu', 'email'];

    return `
        <div class="ops-alert-routing-matrix__head" aria-hidden="true">
            <span>事件类型</span>
            ${channelOrder.map((channelKey) => `<span>${escapeConfigHtml(channelLabels[channelKey])}</span>`).join('')}
        </div>
        <div class="ops-alert-routing-matrix__body">
            ${OPS_ALERT_ROUTING_DEFINITIONS.map((definition) => `
                <div class="ops-alert-routing-matrix__row">
                    <div class="ops-alert-routing-matrix__subject">
                        <strong>${escapeConfigHtml(definition.label)}${buildOpsAlertInfoTipHtml(definition.description)}</strong>
                    </div>
                    ${channelOrder.map((channelKey) => `
                        <label class="ops-alert-routing-matrix__cell" data-channel-label="${escapeConfigHtml(channelLabels[channelKey])}">
                            <input type="checkbox" class="ops-alert-selection-checkbox" id="${escapeConfigHtml(getOpsAlertRoutingCheckboxId(definition.key, channelKey))}">
                            <span class="ops-alert-routing-matrix__cell-label">${escapeConfigHtml(channelLabels[channelKey])}</span>
                        </label>
                    `).join('')}
                </div>
            `).join('')}
        </div>
    `;
}

function buildOpsAlertStrategyLayoutHtml() {
    return `
        <div class="ops-alert-strategy-layout">
            <div class="ops-alert-strategy-savebar" id="opsAlertStrategySaveBar">
                <div class="ops-alert-strategy-savebar__copy">
                    <span class="ops-alert-strategy-savebar__eyebrow">策略中心</span>
                    <div class="ops-alert-strategy-savebar__summary">
                        <strong class="ops-alert-strategy-savebar__state" id="opsAlertStrategySaveState" data-tone="success">当前配置已保存</strong>
                        <p class="ops-alert-strategy-savebar__hint" id="opsAlertStrategySaveHint">在这里改完就能就近保存，不用再切回概览。</p>
                    </div>
                </div>
                <div class="ops-alert-strategy-savebar__actions">
                    <button type="button" class="btn-add-config btn-add-config--compact btn-add-config--ghost" data-admin-action="switch-ops-alerts-view" data-ops-alerts-view="overview">查看概览</button>
                    <button type="button" class="btn-add-config btn-add-config--compact" id="opsAlertStrategyInlineSaveButton" data-admin-action="settings-save-ops-alerts" disabled>保存站外告警配置</button>
                </div>
            </div>

            <div class="ops-alert-strategy-summary-grid">
                <article class="ops-alert-strategy-summary-card">
                    <div class="ops-alert-strategy-summary-card__head">
                        <div>
                            <p class="ops-alert-strategy-summary-card__eyebrow">策略摘要</p>
                            <h4>静默与降噪${buildOpsAlertInfoTipHtml('维护窗口、夜间降噪和单类静默会汇总在这里。', { id: 'opsAlertStrategySummaryMuteTip' })}</h4>
                        </div>
                        <span class="ops-alert-strategy-badge" id="opsAlertStrategySummaryMuteBadge" data-tone="neutral">按需启用</span>
                    </div>
                    <div class="ops-alert-strategy-summary-card__metrics">
                        <div class="ops-alert-strategy-summary-card__metric">
                            <span>临时静默</span>
                            <strong id="opsAlertStrategySummaryMuteTemporary">未设置</strong>
                        </div>
                        <div class="ops-alert-strategy-summary-card__metric">
                            <span>静默时段</span>
                            <strong id="opsAlertStrategySummaryMuteQuietHours">已关闭</strong>
                        </div>
                        <div class="ops-alert-strategy-summary-card__metric">
                            <span>单类 / 模块</span>
                            <strong id="opsAlertStrategySummaryMuteRules">0 / 0 生效</strong>
                        </div>
                    </div>
                    <button type="button" class="btn-add-config btn-add-config--compact btn-add-config--ghost" data-admin-action="settings-open-ops-alert-strategy-panel" data-strategy-panel="mute" data-strategy-tab="types">管理静默</button>
                </article>

                <article class="ops-alert-strategy-summary-card">
                    <div class="ops-alert-strategy-summary-card__head">
                        <div>
                            <p class="ops-alert-strategy-summary-card__eyebrow">策略摘要</p>
                            <h4>分类型路由${buildOpsAlertInfoTipHtml('每类事件都可以单独选择 Telegram、飞书和邮件。', { id: 'opsAlertStrategySummaryRoutingTip' })}</h4>
                        </div>
                        <span class="ops-alert-strategy-badge" id="opsAlertStrategySummaryRoutingBadge" data-tone="neutral">全通道默认</span>
                    </div>
                    <div class="ops-alert-strategy-summary-card__metrics">
                        <div class="ops-alert-strategy-summary-card__metric">
                            <span>Telegram</span>
                            <strong id="opsAlertStrategySummaryRoutingTelegram">0 / 0</strong>
                        </div>
                        <div class="ops-alert-strategy-summary-card__metric">
                            <span>飞书</span>
                            <strong id="opsAlertStrategySummaryRoutingFeishu">0 / 0</strong>
                        </div>
                        <div class="ops-alert-strategy-summary-card__metric">
                            <span>邮件</span>
                            <strong id="opsAlertStrategySummaryRoutingEmail">0 / 0</strong>
                        </div>
                    </div>
                    <button type="button" class="btn-add-config btn-add-config--compact btn-add-config--ghost" data-admin-action="settings-open-ops-alert-strategy-panel" data-strategy-panel="routing">配置路由</button>
                </article>

                <article class="ops-alert-strategy-summary-card">
                    <div class="ops-alert-strategy-summary-card__head">
                        <div>
                            <p class="ops-alert-strategy-summary-card__eyebrow">策略摘要</p>
                            <h4>工作时段${buildOpsAlertInfoTipHtml('只影响开启“仅工作时间通知”的低优先级告警。', { id: 'opsAlertStrategySummaryWorkHoursTip' })}</h4>
                        </div>
                        <span class="ops-alert-strategy-badge" id="opsAlertStrategySummaryWorkHoursBadge" data-tone="neutral">未启用</span>
                    </div>
                    <div class="ops-alert-strategy-summary-card__metrics">
                        <div class="ops-alert-strategy-summary-card__metric">
                            <span>工作时间</span>
                            <strong id="opsAlertStrategySummaryWorkHoursRange">09:00 - 18:00</strong>
                        </div>
                        <div class="ops-alert-strategy-summary-card__metric">
                            <span>时区</span>
                            <strong id="opsAlertStrategySummaryWorkHoursTimezone">Asia/Shanghai</strong>
                        </div>
                        <div class="ops-alert-strategy-summary-card__metric">
                            <span>影响规则</span>
                            <strong id="opsAlertStrategySummaryWorkHoursRules">0 类</strong>
                        </div>
                    </div>
                    <button type="button" class="btn-add-config btn-add-config--compact btn-add-config--ghost" data-admin-action="settings-open-ops-alert-strategy-panel" data-strategy-panel="work-hours">编辑时段</button>
                </article>
            </div>

            <div class="ops-alert-strategy-panels">
                <section class="ops-alert-strategy-panel" data-strategy-panel="mute">
                    <button type="button" class="ops-alert-strategy-panel__header" data-admin-action="settings-toggle-ops-alert-strategy-panel" data-strategy-panel="mute">
                        <div class="ops-alert-strategy-panel__copy">
                            <span class="ops-alert-strategy-panel__eyebrow">分类编辑</span>
                            <h4>静默与降噪${buildOpsAlertInfoTipHtml('集中管理临时静默、夜间静默和分组降噪。', { id: 'opsAlertStrategyPanelMuteTip' })}</h4>
                        </div>
                        <div class="ops-alert-strategy-panel__meta">
                            <span class="ops-alert-strategy-badge" id="opsAlertStrategyPanelMuteBadge" data-tone="neutral">按需启用</span>
                            <i class="fas fa-chevron-down"></i>
                        </div>
                    </button>
                    <div class="ops-alert-strategy-panel__body" hidden>
                        <div class="ops-alert-strategy-card-grid ops-alert-strategy-card-grid--dual">
                            <section class="ops-alert-strategy-card">
                                <div class="ops-alert-strategy-card__head">
                                    <div>
                                        <h4>临时静默${buildOpsAlertInfoTipHtml('适合维护窗口或短时降噪。设置到期时间后保存配置即可暂停外发。预设按钮会直接填入时间；点击“保存站外告警配置”后才会真正生效。')}</h4>
                                    </div>
                                </div>
                                <div class="ops-alert-mute-status" id="opsAlertTemporaryMuteStatus">当前未设置临时静默。</div>
                                <div class="ops-alert-strategy-stack">
                                    <div class="ops-alert-strategy-field ops-alert-strategy-field--picker ops-alert-mute-field--actions">
                                        <span>静默至</span>
                                        <div class="ops-alert-mute-picker-actions">
                                            ${buildOpsAlertDateTimeFieldHtml('opsAlertTemporaryMuteUntil')}
                                            <button type="button" class="ops-alert-mute-clear-btn" id="opsAlertTemporaryMuteInlineClear" data-admin-action="settings-clear-ops-alert-temporary-mute" aria-label="清除临时静默" title="清除">
                                                <i class="fas fa-xmark" aria-hidden="true"></i>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="ops-alert-mute-toggle-field">
                                        <div class="ops-alert-mute-toggle-field__copy">
                                            <span>critical 继续通知${buildOpsAlertInfoTipHtml('维护期间保留真正高危的告警外发。')}</span>
                                        </div>
                                        <div class="status-toggle" id="opsAlertTemporaryMuteAllowCriticalToggle" data-admin-action="settings-toggle-ops-alert-temporary-mute-allow-critical"></div>
                                    </div>
                                </div>
                                <div class="ops-alert-mute-actions">
                                    <button type="button" class="btn-add-config btn-add-config--compact" data-admin-action="settings-set-ops-alert-temporary-mute" data-mute-hours="1">静默 1 小时</button>
                                    <button type="button" class="btn-add-config btn-add-config--compact" data-admin-action="settings-set-ops-alert-temporary-mute" data-mute-hours="6">静默 6 小时</button>
                                    <button type="button" class="btn-add-config btn-add-config--compact" data-admin-action="settings-set-ops-alert-temporary-mute" data-mute-hours="24">静默 24 小时</button>
                                </div>
                            </section>

                            <section class="ops-alert-strategy-card">
                                <div class="ops-alert-strategy-card__head">
                                    <div>
                                        <h4>静默时段${buildOpsAlertInfoTipHtml('适合夜间降噪。启用后，非 critical 告警会在指定时段内暂停外发。')}</h4>
                                    </div>
                                    <div class="status-toggle" id="opsAlertQuietHoursEnabledToggle" data-admin-action="settings-toggle-ops-alert-quiet-hours-enabled"></div>
                                </div>
                                <div class="ops-alert-strategy-inline-grid ops-alert-strategy-inline-grid--triple">
                                    <label class="ops-alert-strategy-field">
                                        <span>开始小时</span>
                                        ${buildOpsAlertInlineNumberInputHtml('opsAlertQuietHoursStartHour', 23)}
                                    </label>
                                    <label class="ops-alert-strategy-field">
                                        <span>结束小时</span>
                                        ${buildOpsAlertInlineNumberInputHtml('opsAlertQuietHoursEndHour', 8)}
                                    </label>
                                    <label class="ops-alert-strategy-field">
                                        <span>时区</span>
                                        <input type="text" class="config-input ops-alert-inline-text-input" id="opsAlertQuietHoursTimezone" placeholder="Asia/Shanghai" autocomplete="off" spellcheck="false">
                                    </label>
                                </div>
                                <div class="ops-alert-strategy-range-hint" id="opsAlertQuietHoursRangeHint">每天 23:00 开始，次日 08:00 结束（Asia/Shanghai）</div>
                                <div class="ops-alert-mute-toggle-field ops-alert-mute-toggle-field--inline">
                                    <div class="ops-alert-mute-toggle-field__copy">
                                        <span>critical 继续通知${buildOpsAlertInfoTipHtml('静默时段里只屏蔽普通告警，保留真正高危的异常。')}</span>
                                    </div>
                                    <div class="status-toggle" id="opsAlertQuietHoursAllowCriticalToggle" data-admin-action="settings-toggle-ops-alert-quiet-hours-allow-critical"></div>
                                </div>
                            </section>
                        </div>

                        <div class="ops-alert-strategy-subpanels">
                            <section class="ops-alert-strategy-subpanel" data-strategy-tab-panel="types">
                                <button type="button" class="ops-alert-strategy-subpanel__header" data-admin-action="settings-switch-ops-alert-strategy-tab" data-strategy-tab="types" aria-expanded="false">
                                    <div class="ops-alert-strategy-subpanel__copy">
                                        <h4>按单类静默${buildOpsAlertInfoTipHtml('把长列表收成表格，优先处理当前真正需要降噪的单类事件。')}</h4>
                                    </div>
                                    <div class="ops-alert-strategy-subpanel__meta">
                                        <div class="ops-alert-strategy-inline-meta" id="opsAlertMuteTabTypesCount">0 生效</div>
                                        <i class="fas fa-chevron-down" aria-hidden="true"></i>
                                    </div>
                                </button>
                                <div class="ops-alert-strategy-subpanel__body" hidden>
                                    <div class="ops-alert-strategy-inline-meta" id="opsAlertTypeMutePanelMeta">共 14 类</div>
                                    <div class="ops-alert-mute-table" id="opsAlertTypeMuteTable">${buildOpsAlertMuteTableHtml('types')}</div>
                                </div>
                            </section>

                            <section class="ops-alert-strategy-subpanel" data-strategy-tab-panel="modules">
                                <button type="button" class="ops-alert-strategy-subpanel__header" data-admin-action="settings-switch-ops-alert-strategy-tab" data-strategy-tab="modules" aria-expanded="false">
                                    <div class="ops-alert-strategy-subpanel__copy">
                                        <h4>按模块静默${buildOpsAlertInfoTipHtml('以模块为单位批量降噪，适合维护窗口、集中排障或阶段性静默。')}</h4>
                                    </div>
                                    <div class="ops-alert-strategy-subpanel__meta">
                                        <div class="ops-alert-strategy-inline-meta" id="opsAlertMuteTabModulesCount">0 生效</div>
                                        <i class="fas fa-chevron-down" aria-hidden="true"></i>
                                    </div>
                                </button>
                                <div class="ops-alert-strategy-subpanel__body" hidden>
                                    <div class="ops-alert-strategy-inline-meta" id="opsAlertModuleMutePanelMeta">共 9 类</div>
                                    <div class="ops-alert-mute-table" id="opsAlertModuleMuteTable">${buildOpsAlertMuteTableHtml('modules')}</div>
                                </div>
                            </section>
                        </div>
                    </div>
                </section>

                <section class="ops-alert-strategy-panel" data-strategy-panel="routing">
                    <button type="button" class="ops-alert-strategy-panel__header" data-admin-action="settings-toggle-ops-alert-strategy-panel" data-strategy-panel="routing">
                        <div class="ops-alert-strategy-panel__copy">
                            <span class="ops-alert-strategy-panel__eyebrow">分类编辑</span>
                            <h4>分类型通道路由${buildOpsAlertInfoTipHtml('把路由改成矩阵后，可以更快看清哪类告警发到哪个通道。', { id: 'opsAlertStrategyPanelRoutingTip' })}</h4>
                        </div>
                        <div class="ops-alert-strategy-panel__meta">
                            <span class="ops-alert-strategy-badge" id="opsAlertStrategyPanelRoutingBadge" data-tone="neutral">全通道默认</span>
                            <i class="fas fa-chevron-down"></i>
                        </div>
                    </button>
                    <div class="ops-alert-strategy-panel__body" hidden>
                        <section class="ops-alert-strategy-card ops-alert-strategy-card--table">
                            <div class="ops-alert-strategy-card__head">
                                <div>
                                    <h4>事件路由矩阵${buildOpsAlertInfoTipHtml('行是事件类型，列是目标通道。取消勾选即可把该类事件从对应通道移除。默认所有事件都会走三条通道；矩阵更适合快速收敛噪音或做分流。')}</h4>
                                </div>
                                <div class="ops-alert-strategy-inline-meta" id="opsAlertRoutingMatrixMeta">共 14 类事件</div>
                            </div>
                            <div class="ops-alert-routing-matrix" id="opsAlertRoutingMatrix">${buildOpsAlertRoutingMatrixHtml()}</div>
                        </section>
                    </div>
                </section>

                <section class="ops-alert-strategy-panel" data-strategy-panel="work-hours">
                    <button type="button" class="ops-alert-strategy-panel__header" data-admin-action="settings-toggle-ops-alert-strategy-panel" data-strategy-panel="work-hours">
                        <div class="ops-alert-strategy-panel__copy">
                            <span class="ops-alert-strategy-panel__eyebrow">分类编辑</span>
                            <h4>工作时段${buildOpsAlertInfoTipHtml('这组时间只影响开启“仅工作时间通知”的低优先级告警。', { id: 'opsAlertStrategyPanelWorkHoursTip' })}</h4>
                        </div>
                        <div class="ops-alert-strategy-panel__meta">
                            <span class="ops-alert-strategy-badge" id="opsAlertStrategyPanelWorkHoursBadge" data-tone="neutral">未启用</span>
                            <i class="fas fa-chevron-down"></i>
                        </div>
                    </button>
                    <div class="ops-alert-strategy-panel__body" hidden>
                        <section class="ops-alert-strategy-card">
                            <div class="ops-alert-strategy-card__head">
                                <div>
                                    <h4>工作时段${buildOpsAlertInfoTipHtml('适合低优先级通知只在白天处理。非工作时间会先汇总，等到下一个工作开始时再统一外发。这组时间不会替代静默时段或单独静默规则，只控制“仅工作时间通知”的那部分告警。')}</h4>
                                </div>
                                <div class="status-toggle" id="opsAlertWorkHoursEnabledToggle" data-admin-action="settings-toggle-ops-alert-work-hours-enabled"></div>
                            </div>
                            <div class="ops-alert-strategy-inline-grid ops-alert-strategy-inline-grid--triple">
                                <label class="ops-alert-strategy-field">
                                    <span>开始小时</span>
                                    ${buildOpsAlertInlineNumberInputHtml('opsAlertWorkHoursStartHour', 9)}
                                </label>
                                <label class="ops-alert-strategy-field">
                                    <span>结束小时</span>
                                    ${buildOpsAlertInlineNumberInputHtml('opsAlertWorkHoursEndHour', 18)}
                                </label>
                                <label class="ops-alert-strategy-field">
                                    <span>时区</span>
                                    <input type="text" class="config-input ops-alert-inline-text-input" id="opsAlertWorkHoursTimezone" placeholder="Asia/Shanghai" autocomplete="off" spellcheck="false">
                                </label>
                            </div>
                            <div class="ops-alert-strategy-range-hint" id="opsAlertWorkHoursRangeHint">每天 09:00 - 18:00（Asia/Shanghai）</div>
                        </section>
                    </div>
                </section>
            </div>
        </div>
    `;
}

function ensureOpsAlertStrategyLayout() {
    const root = getOpsAlertStrategyLayoutRoot();
    if (!root || root.dataset.opsAlertStrategyLayoutReady === 'true') {
        return;
    }

    root.innerHTML = buildOpsAlertStrategyLayoutHtml();
    root.dataset.opsAlertStrategyLayoutReady = 'true';
    ensureOpsAlertDatePickerEvents();
    ensureOpsAlertStrategyBeforeUnloadPrompt();
    root.addEventListener('change', (event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target || !target.closest('.ops-alert-strategy-layout')) {
            return;
        }
        refreshOpsAlertStrategyDraftViews();
    });
    root.addEventListener('input', (event) => {
        const target = event.target instanceof HTMLInputElement ? event.target : null;
        if (!target || !target.closest('.ops-alert-strategy-layout')) {
            return;
        }
        if (target.classList.contains('ops-alert-date-picker__time-input')) {
            syncOpsAlertDatePickerTimeInput(target, { commit: false });
            return;
        }
        if (target.classList.contains('ops-alert-inline-number-input')) {
            sanitizeOpsAlertInlineNumberInput(target);
        }
        updateOpsAlertStrategyDraftIndicators();
    });
    root.addEventListener('blur', (event) => {
        const target = event.target instanceof HTMLInputElement ? event.target : null;
        if (!target || !target.closest('.ops-alert-strategy-layout')) {
            return;
        }
        if (target.classList.contains('ops-alert-date-picker__time-input')) {
            syncOpsAlertDatePickerTimeInput(target, { commit: true });
            return;
        }
        if (target.classList.contains('ops-alert-inline-number-input')) {
            normalizeOpsAlertInlineNumberInput(target);
        }
        refreshOpsAlertStrategyDraftViews();
    }, true);
    syncAllOpsAlertDateTimeFields(root);
    setOpsAlertStrategyPanelExpanded('mute', false, { immediate: true });
    setOpsAlertStrategyPanelExpanded('routing', false, { immediate: true });
    setOpsAlertStrategyPanelExpanded('work-hours', false, { immediate: true });
    setOpsAlertStrategyMuteSubpanelExpanded('types', false, { immediate: true });
    setOpsAlertStrategyMuteSubpanelExpanded('modules', false, { immediate: true });
    updateOpsAlertStrategyDraftIndicators(getOpsAlertSavedConfigSnapshot());
}

function setOpsAlertStrategyBadgeState(elementId, label, tone = 'neutral') {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.textContent = label;
    element.dataset.tone = tone;
}

function buildLocalOpsAlertStrategySummaryState(normalizedConfig = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const defaults = getDefaultOpsAlertConfig();
    const temporaryMuteState = getOpsAlertTemporaryMuteState(normalizedConfig);
    const quietHours = normalizedConfig.quiet_hours || defaults.quiet_hours;
    const workHours = normalizedConfig.work_hours || defaults.work_hours;

    const typeStates = OPS_ALERT_MUTE_RULE_TYPE_DEFINITIONS.map((definition) => (
        getOpsAlertMuteRuleState(normalizedConfig.mute_rules?.types?.[definition.key] || {})
    ));
    const moduleStates = OPS_ALERT_MUTE_RULE_MODULE_DEFINITIONS.map((definition) => (
        getOpsAlertMuteRuleState(normalizedConfig.mute_rules?.modules?.[definition.key] || {})
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
    OPS_ALERT_ROUTING_DEFINITIONS.forEach((definition) => {
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

    const workHoursOnlyCount = OPS_ALERT_SUMMARY_ORCHESTRATION_DEFINITIONS.filter((definition) => (
        definition.supports_work_hours_only && normalizedConfig[definition.key]?.work_hours_only_enabled === true
    )).length;
    const totalRoutingCount = OPS_ALERT_ROUTING_DEFINITIONS.length;

    return {
        mute: {
            badgeLabel: temporaryMuteState.active
                ? '临时静默中'
                : totalActiveMuteCount > 0
                    ? `生效 ${formatVerifyMonitorInteger(totalActiveMuteCount)} 项`
                    : quietHours.enabled
                        ? '夜间静默开启'
                        : '按需启用',
            badgeTone: totalActiveMuteCount > 0 || quietHours.enabled ? 'warning' : 'neutral',
            summaryTipText: temporaryMuteState.active
                ? `当前外发已静默到 ${temporaryMuteState.untilLabel}，适合维护窗口快速止噪。`
                : totalActiveMuteCount > 0
                    ? `当前有 ${formatVerifyMonitorInteger(totalActiveMuteCount)} 项静默策略生效，建议只保留真正需要降噪的规则。`
                    : totalExpiredMuteCount > 0
                        ? `检测到 ${formatVerifyMonitorInteger(totalExpiredMuteCount)} 条过期静默记录，建议清理旧时间，减少误判。`
                        : '维护窗口、夜间降噪和单类静默会汇总在这里。',
            panelTipText: totalActiveMuteCount > 0
                ? `当前有 ${formatVerifyMonitorInteger(totalActiveMuteCount)} 项静默策略生效，优先处理仍在生效的规则。`
                : '集中管理临时静默、夜间静默和分组降噪。',
            temporaryLabel: temporaryMuteState.active
                ? `至 ${temporaryMuteState.untilLabel}`
                : temporaryMuteState.expired
                    ? '已过期'
                    : '未设置',
            quietHoursLabel: quietHours.enabled
                ? formatOpsAlertHourRange(quietHours.start_hour, quietHours.end_hour)
                : '已关闭',
            rulesLabel: `${formatVerifyMonitorInteger(activeTypeCount)} / ${formatVerifyMonitorInteger(activeModuleCount)} 生效`,
            typeMetaLabel: `共 ${formatVerifyMonitorInteger(OPS_ALERT_MUTE_RULE_TYPE_DEFINITIONS.length)} 类，${formatVerifyMonitorInteger(activeTypeCount)} 类生效`,
            moduleMetaLabel: `共 ${formatVerifyMonitorInteger(OPS_ALERT_MUTE_RULE_MODULE_DEFINITIONS.length)} 类，${formatVerifyMonitorInteger(activeModuleCount)} 类生效`,
            typeTabLabel: `${formatVerifyMonitorInteger(activeTypeCount)} 生效`,
            moduleTabLabel: `${formatVerifyMonitorInteger(activeModuleCount)} 生效`
        },
        routing: {
            badgeLabel: routingCustomizedCount > 0
                ? `已定制 ${formatVerifyMonitorInteger(routingCustomizedCount)} 类`
                : '全通道默认',
            badgeTone: routingCustomizedCount > 0 ? 'success' : 'neutral',
            summaryTipText: routingCustomizedCount > 0
                ? `已有 ${formatVerifyMonitorInteger(routingCustomizedCount)} 类事件被改成非默认路由，矩阵更适合快速复核。`
                : '当前 14 类事件都保留 Telegram、飞书、邮件三通道默认投递。',
            panelTipText: routingCustomizedCount > 0
                ? `已对 ${formatVerifyMonitorInteger(routingCustomizedCount)} 类事件做了分流，建议重点检查核心告警是否还保留至少一条主通道。`
                : '把路由改成矩阵后，可以更快看清哪类告警发到哪个通道。',
            matrixMetaLabel: `共 ${formatVerifyMonitorInteger(totalRoutingCount)} 类事件，已定制 ${formatVerifyMonitorInteger(routingCustomizedCount)} 类`,
            telegramLabel: `${formatVerifyMonitorInteger(routingChannelCounts.telegram)} / ${formatVerifyMonitorInteger(totalRoutingCount)}`,
            feishuLabel: `${formatVerifyMonitorInteger(routingChannelCounts.feishu)} / ${formatVerifyMonitorInteger(totalRoutingCount)}`,
            emailLabel: `${formatVerifyMonitorInteger(routingChannelCounts.email)} / ${formatVerifyMonitorInteger(totalRoutingCount)}`
        },
        work_hours: {
            badgeLabel: workHours.enabled
                ? '已启用'
                : workHoursOnlyCount > 0
                    ? '待启用'
                    : '未启用',
            badgeTone: workHours.enabled ? 'success' : (workHoursOnlyCount > 0 ? 'warning' : 'neutral'),
            summaryTipText: workHoursOnlyCount > 0
                ? `当前有 ${formatVerifyMonitorInteger(workHoursOnlyCount)} 类告警启用了“仅工作时间通知”。`
                : '只影响开启“仅工作时间通知”的低优先级告警。',
            panelTipText: workHours.enabled
                ? `当前工作时段为 ${formatOpsAlertHourRange(workHours.start_hour, workHours.end_hour)}，会影响 ${formatVerifyMonitorInteger(workHoursOnlyCount)} 类告警。`
                : '这组时间只影响开启“仅工作时间通知”的低优先级告警。',
            rangeLabel: formatOpsAlertHourRange(workHours.start_hour, workHours.end_hour),
            timezoneLabel: workHours.timezone || defaults.work_hours.timezone,
            rulesLabel: `${formatVerifyMonitorInteger(workHoursOnlyCount)} 类`
        }
    };
}

function resolveOpsAlertStrategySummaryStateBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertStrategySummaryState',
        buildLocalOpsAlertStrategySummaryState,
        (config = {}) => ({
            normalizeConfig: normalizeOpsAlertConfig,
            getDefaultConfig: getDefaultOpsAlertConfig,
            getTemporaryMuteState: getOpsAlertTemporaryMuteState,
            getMuteRuleState: getOpsAlertMuteRuleState,
            typeDefinitions: OPS_ALERT_MUTE_RULE_TYPE_DEFINITIONS,
            moduleDefinitions: OPS_ALERT_MUTE_RULE_MODULE_DEFINITIONS,
            routingDefinitions: OPS_ALERT_ROUTING_DEFINITIONS,
            summaryDefinitions: OPS_ALERT_SUMMARY_ORCHESTRATION_DEFINITIONS,
            formatCount: formatVerifyMonitorInteger,
            formatHourRange: formatOpsAlertHourRange
        })
    );
}

function resolveOpsAlertStrategySummaryState(normalizedConfig = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    return resolveOpsAlertStrategySummaryStateBuilder()(normalizedConfig);
}

function renderOpsAlertStrategySummary(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const summaryState = resolveOpsAlertStrategySummaryState(normalizedConfig);
    const fallbackSummaryState = buildLocalOpsAlertStrategySummaryState(normalizedConfig);
    const muteSummary = summaryState?.mute || fallbackSummaryState.mute;
    const routingSummary = summaryState?.routing || fallbackSummaryState.routing;
    const workHoursSummary = summaryState?.work_hours || fallbackSummaryState.work_hours;

    setOpsAlertStrategyBadgeState('opsAlertStrategySummaryMuteBadge', muteSummary.badgeLabel, muteSummary.badgeTone);
    setOpsAlertStrategyBadgeState('opsAlertStrategyPanelMuteBadge', muteSummary.badgeLabel, muteSummary.badgeTone);
    setOpsAlertInfoTipText('opsAlertStrategySummaryMuteTip', muteSummary.summaryTipText);
    setOpsAlertInfoTipText('opsAlertStrategyPanelMuteTip', muteSummary.panelTipText);
    const muteTemporaryEl = document.getElementById('opsAlertStrategySummaryMuteTemporary');
    if (muteTemporaryEl) {
        muteTemporaryEl.textContent = muteSummary.temporaryLabel;
    }
    const muteQuietHoursEl = document.getElementById('opsAlertStrategySummaryMuteQuietHours');
    if (muteQuietHoursEl) {
        muteQuietHoursEl.textContent = muteSummary.quietHoursLabel;
    }
    const muteRulesEl = document.getElementById('opsAlertStrategySummaryMuteRules');
    if (muteRulesEl) {
        muteRulesEl.textContent = muteSummary.rulesLabel;
    }
    const typeMuteMetaEl = document.getElementById('opsAlertTypeMutePanelMeta');
    if (typeMuteMetaEl) {
        typeMuteMetaEl.textContent = muteSummary.typeMetaLabel;
    }
    const moduleMuteMetaEl = document.getElementById('opsAlertModuleMutePanelMeta');
    if (moduleMuteMetaEl) {
        moduleMuteMetaEl.textContent = muteSummary.moduleMetaLabel;
    }
    const typeTabCountEl = document.getElementById('opsAlertMuteTabTypesCount');
    if (typeTabCountEl) {
        typeTabCountEl.textContent = muteSummary.typeTabLabel;
    }
    const moduleTabCountEl = document.getElementById('opsAlertMuteTabModulesCount');
    if (moduleTabCountEl) {
        moduleTabCountEl.textContent = muteSummary.moduleTabLabel;
    }

    setOpsAlertStrategyBadgeState('opsAlertStrategySummaryRoutingBadge', routingSummary.badgeLabel, routingSummary.badgeTone);
    setOpsAlertStrategyBadgeState('opsAlertStrategyPanelRoutingBadge', routingSummary.badgeLabel, routingSummary.badgeTone);
    setOpsAlertInfoTipText('opsAlertStrategySummaryRoutingTip', routingSummary.summaryTipText);
    setOpsAlertInfoTipText('opsAlertStrategyPanelRoutingTip', routingSummary.panelTipText);
    const routingMatrixMetaEl = document.getElementById('opsAlertRoutingMatrixMeta');
    if (routingMatrixMetaEl) {
        routingMatrixMetaEl.textContent = routingSummary.matrixMetaLabel;
    }
    const routingTelegramEl = document.getElementById('opsAlertStrategySummaryRoutingTelegram');
    if (routingTelegramEl) {
        routingTelegramEl.textContent = routingSummary.telegramLabel;
    }
    const routingFeishuEl = document.getElementById('opsAlertStrategySummaryRoutingFeishu');
    if (routingFeishuEl) {
        routingFeishuEl.textContent = routingSummary.feishuLabel;
    }
    const routingEmailEl = document.getElementById('opsAlertStrategySummaryRoutingEmail');
    if (routingEmailEl) {
        routingEmailEl.textContent = routingSummary.emailLabel;
    }

    setOpsAlertStrategyBadgeState('opsAlertStrategySummaryWorkHoursBadge', workHoursSummary.badgeLabel, workHoursSummary.badgeTone);
    setOpsAlertStrategyBadgeState('opsAlertStrategyPanelWorkHoursBadge', workHoursSummary.badgeLabel, workHoursSummary.badgeTone);
    setOpsAlertInfoTipText('opsAlertStrategySummaryWorkHoursTip', workHoursSummary.summaryTipText);
    setOpsAlertInfoTipText('opsAlertStrategyPanelWorkHoursTip', workHoursSummary.panelTipText);
    const workHoursRangeEl = document.getElementById('opsAlertStrategySummaryWorkHoursRange');
    if (workHoursRangeEl) {
        workHoursRangeEl.textContent = workHoursSummary.rangeLabel;
    }
    const workHoursTimezoneEl = document.getElementById('opsAlertStrategySummaryWorkHoursTimezone');
    if (workHoursTimezoneEl) {
        workHoursTimezoneEl.textContent = workHoursSummary.timezoneLabel;
    }
    const workHoursRulesEl = document.getElementById('opsAlertStrategySummaryWorkHoursRules');
    if (workHoursRulesEl) {
        workHoursRulesEl.textContent = workHoursSummary.rulesLabel;
    }
}

function setOpsAlertCollapsibleBodyExpanded(body, expanded, options = {}) {
    if (!(body instanceof HTMLElement)) {
        return;
    }

    const nextExpanded = expanded === true;
    const immediate = options.immediate === true
        || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const transitionToken = String((Number.parseInt(body.dataset.opsAlertCollapseToken || '0', 10) || 0) + 1);

    body.dataset.opsAlertCollapseToken = transitionToken;
    body.hidden = false;
    body.setAttribute('aria-hidden', nextExpanded ? 'false' : 'true');
    body.style.willChange = 'height, opacity, padding-bottom';

    const finalize = () => {
        if (body.dataset.opsAlertCollapseToken !== transitionToken) {
            return;
        }
        body.classList.toggle('is-open', nextExpanded);
        body.dataset.opsAlertExpanded = nextExpanded ? 'true' : 'false';
        body.style.height = nextExpanded ? 'auto' : '0px';
        body.style.overflow = nextExpanded ? 'visible' : 'hidden';
        body.style.visibility = nextExpanded ? 'visible' : 'hidden';
        body.style.willChange = '';
    };

    if (immediate) {
        finalize();
        return;
    }

    const startHeight = body.getBoundingClientRect().height;
    body.style.height = `${Math.max(0, startHeight)}px`;
    body.style.overflow = 'hidden';
    body.style.visibility = 'visible';
    body.classList.toggle('is-open', nextExpanded);

    const targetHeight = nextExpanded ? body.scrollHeight : 0;
    if (Math.abs(targetHeight - startHeight) < 1) {
        finalize();
        return;
    }

    const handleTransitionEnd = (event) => {
        if (event.target !== body || event.propertyName !== 'height') {
            return;
        }
        body.removeEventListener('transitionend', handleTransitionEnd);
        finalize();
    };

    body.addEventListener('transitionend', handleTransitionEnd);
    void body.offsetHeight;
    requestAnimationFrame(() => {
        if (body.dataset.opsAlertCollapseToken !== transitionToken) {
            return;
        }
        body.style.height = `${Math.max(0, targetHeight)}px`;
    });
}

function setOpsAlertStrategyPanelExpanded(panelKey, expanded, options = {}) {
    const panel = document.querySelector(`.ops-alert-strategy-panel[data-strategy-panel="${panelKey}"]`);
    if (!panel) return;

    panel.classList.toggle('is-expanded', expanded);
    const body = panel.querySelector('.ops-alert-strategy-panel__body');
    const header = panel.querySelector('.ops-alert-strategy-panel__header');
    if (body) {
        setOpsAlertCollapsibleBodyExpanded(body, expanded, options);
    }
    if (header) {
        header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
}

function setOpsAlertStrategyMuteSubpanelExpanded(tabKey, expanded, options = {}) {
    const panel = document.querySelector(`.ops-alert-strategy-subpanel[data-strategy-tab-panel="${tabKey}"]`);
    if (!panel) return;

    panel.classList.toggle('is-expanded', expanded);
    const body = panel.querySelector('.ops-alert-strategy-subpanel__body');
    const header = panel.querySelector('.ops-alert-strategy-subpanel__header');
    if (body) {
        setOpsAlertCollapsibleBodyExpanded(body, expanded, options);
    }
    if (header) {
        header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
}

function toggleOpsAlertStrategyPanel(panelKey) {
    ensureOpsAlertStrategyLayout();
    const targetPanel = document.querySelector(`.ops-alert-strategy-panel[data-strategy-panel="${panelKey}"]`);
    if (!targetPanel) return;

    const shouldExpand = !targetPanel.classList.contains('is-expanded');
    OPS_ALERT_STRATEGY_PANEL_KEYS.forEach((key) => {
        setOpsAlertStrategyPanelExpanded(key, shouldExpand && key === panelKey);
    });
}

function switchOpsAlertStrategyMuteTab(tabKey = 'types') {
    ensureOpsAlertStrategyLayout();
    const nextTabKey = OPS_ALERT_STRATEGY_MUTE_TAB_KEYS.includes(tabKey) ? tabKey : 'types';
    const targetPanel = document.querySelector(`.ops-alert-strategy-subpanel[data-strategy-tab-panel="${nextTabKey}"]`);
    const shouldExpand = !targetPanel?.classList.contains('is-expanded');
    OPS_ALERT_STRATEGY_MUTE_TAB_KEYS.forEach((key) => {
        setOpsAlertStrategyMuteSubpanelExpanded(key, shouldExpand && key === nextTabKey);
    });
}

function openOpsAlertStrategyPanel(panelKey, tabKey = '') {
    ensureOpsAlertStrategyLayout();
    const nextPanelKey = OPS_ALERT_STRATEGY_PANEL_KEYS.includes(panelKey) ? panelKey : 'mute';
    OPS_ALERT_STRATEGY_PANEL_KEYS.forEach((key) => {
        setOpsAlertStrategyPanelExpanded(key, key === nextPanelKey);
    });
    if (nextPanelKey === 'mute' && tabKey) {
        OPS_ALERT_STRATEGY_MUTE_TAB_KEYS.forEach((key) => {
            setOpsAlertStrategyMuteSubpanelExpanded(key, key === tabKey);
        });
    }

    const targetSubpanel = nextPanelKey === 'mute' && tabKey
        ? document.querySelector(`.ops-alert-strategy-subpanel[data-strategy-tab-panel="${tabKey}"]`)
        : null;
    const panel = targetSubpanel || document.querySelector(`.ops-alert-strategy-panel[data-strategy-panel="${nextPanelKey}"]`);
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setOpsAlertSummaryPanelExpanded(panelKey, expanded, options = {}) {
    const panel = document.querySelector(`.ops-alert-summary-orchestration-panel[data-ops-alert-summary-panel="${panelKey}"]`);
    if (!panel) return;

    panel.classList.toggle('is-expanded', expanded);
    const body = panel.querySelector('.ops-alert-summary-orchestration-panel__body');
    const header = panel.querySelector('.ops-alert-summary-orchestration-panel__toggle');
    if (body) {
        setOpsAlertCollapsibleBodyExpanded(body, expanded, options);
    }
    if (header) {
        header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
}

function toggleOpsAlertSummaryPanel(panelKey = 'overview') {
    const nextPanelKey = OPS_ALERT_SUMMARY_PANEL_KEYS.includes(panelKey) ? panelKey : 'overview';
    const panel = document.querySelector(`.ops-alert-summary-orchestration-panel[data-ops-alert-summary-panel="${nextPanelKey}"]`);
    if (!panel) return;

    setOpsAlertSummaryPanelExpanded(nextPanelKey, !panel.classList.contains('is-expanded'));
}

function refreshOpsAlertStrategyDraftViews() {
    ensureOpsAlertStrategyLayout();
    const nextConfig = collectOpsAlertConfigFromForm();
    applyOpsAlertStrategyControls(nextConfig);
    applyOpsAlertOverview(nextConfig);
}

function getOpsAlertMuteRuleState(rule = {}, options = {}) {
    const normalizedUntil = String(rule?.until || '').trim();
    const parsedUntil = normalizedUntil ? Date.parse(normalizedUntil) : Number.NaN;
    const referenceDate = options.now instanceof Date
        ? options.now
        : new Date(options.now || Date.now());
    const isValid = Number.isFinite(parsedUntil);
    const isActive = isValid && parsedUntil > referenceDate.getTime();

    return {
        active: isActive,
        expired: isValid && !isActive,
        until: isValid ? new Date(parsedUntil).toISOString() : '',
        untilLabel: isValid ? formatVerifyMonitorDateTime(parsedUntil) : '—',
        allowCritical: rule?.allow_critical !== false
    };
}

function getOpsAlertTemporaryMuteState(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts']), options = {}) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const temporaryMute = normalizedConfig.temporary_mute || getDefaultOpsAlertConfig().temporary_mute;
    const normalizedUntil = String(temporaryMute.until || '').trim();
    const parsedUntil = normalizedUntil ? Date.parse(normalizedUntil) : Number.NaN;
    const referenceDate = options.now instanceof Date
        ? options.now
        : new Date(options.now || Date.now());
    const isValid = Number.isFinite(parsedUntil);
    const isActive = isValid && parsedUntil > referenceDate.getTime();

    return {
        active: isActive,
        expired: isValid && !isActive,
        until: isValid ? new Date(parsedUntil).toISOString() : '',
        untilLabel: isValid ? formatVerifyMonitorDateTime(parsedUntil) : '—',
        allowCritical: temporaryMute.allow_critical !== false
    };
}

function buildLocalOpsAlertStrategyControlState(normalizedConfig = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const resolvedConfig = normalizeOpsAlertConfig(normalizedConfig);
    const defaults = getDefaultOpsAlertConfig() || {};
    const temporaryMute = resolvedConfig.temporary_mute || defaults.temporary_mute || {};
    const quietHours = resolvedConfig.quiet_hours || defaults.quiet_hours || {};
    const workHours = resolvedConfig.work_hours || defaults.work_hours || {};
    const temporaryMuteState = getOpsAlertTemporaryMuteState(resolvedConfig);
    const muteRules = ['types', 'modules'].reduce((result, scope) => {
        const scopeConfig = resolvedConfig.mute_rules?.[scope] || {};
        result[scope] = getOpsAlertMuteRuleDefinitions(scope).reduce((scopeResult, definition) => {
            const rule = scopeConfig?.[definition.key] || {};
            const state = getOpsAlertMuteRuleState(rule);
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
        ...(resolvedConfig.routing || {})
    }).reduce((result, routingKey) => {
        const currentRoute = resolvedConfig.routing?.[routingKey] || defaults.routing?.[routingKey] || {};
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
            rangeHint: formatOpsAlertHourRangePreview(quietHours.start_hour, quietHours.end_hour, {
                timezone: quietHours.timezone
            })
        },
        workHours: {
            enabledActive: workHours.enabled === true,
            inputsDisabled: workHours.enabled !== true,
            rangeHint: formatOpsAlertHourRangePreview(workHours.start_hour, workHours.end_hour, {
                timezone: workHours.timezone
            })
        },
        muteRules,
        routingMatrix
    };
}

function resolveOpsAlertStrategyControlStateBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertStrategyControlState',
        buildLocalOpsAlertStrategyControlState,
        (config = {}) => ({
            normalizeConfig: normalizeOpsAlertConfig,
            getDefaultConfig: getDefaultOpsAlertConfig,
            getTemporaryMuteState: getOpsAlertTemporaryMuteState,
            formatDateTimeLocalInputValue,
            formatHourRangePreview: formatOpsAlertHourRangePreview
        })
    );
}

function resolveOpsAlertStrategyControlState(normalizedConfig = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    return resolveOpsAlertStrategyControlStateBuilder()(normalizedConfig);
}

function applyOpsAlertStrategyControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    ensureOpsAlertStrategyLayout();
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const temporaryMute = normalizedConfig.temporary_mute || getDefaultOpsAlertConfig().temporary_mute;
    const temporaryMuteState = getOpsAlertTemporaryMuteState(normalizedConfig);
    const sharedControlState = resolveOpsAlertStrategyControlState(normalizedConfig);
    const temporaryMuteUntilInput = document.getElementById('opsAlertTemporaryMuteUntil');
    if (temporaryMuteUntilInput) {
        temporaryMuteUntilInput.value = sharedControlState?.temporaryMute?.untilValue || formatDateTimeLocalInputValue(temporaryMute.until || '');
    }

    const temporaryMuteAllowCriticalToggle = document.getElementById('opsAlertTemporaryMuteAllowCriticalToggle');
    if (temporaryMuteAllowCriticalToggle) {
        temporaryMuteAllowCriticalToggle.classList.toggle('active', sharedControlState?.temporaryMute?.allowCriticalActive ?? (temporaryMute.allow_critical !== false));
    }

    const temporaryMuteStatus = document.getElementById('opsAlertTemporaryMuteStatus');
    if (temporaryMuteStatus) {
        if (sharedControlState?.temporaryMute) {
            temporaryMuteStatus.textContent = sharedControlState.temporaryMute.statusText || '';
            temporaryMuteStatus.hidden = sharedControlState.temporaryMute.statusHidden === true;
        } else {
            if (temporaryMuteState.active) {
                temporaryMuteStatus.textContent = `当前已静默至 ${temporaryMuteState.untilLabel}，${temporaryMuteState.allowCritical ? 'critical 仍继续通知。' : '所有级别暂停外发。'}`;
                temporaryMuteStatus.hidden = false;
            } else if (temporaryMuteState.expired) {
                temporaryMuteStatus.textContent = `上次静默已于 ${temporaryMuteState.untilLabel} 到期。点击“清除静默”可清掉旧时间。`;
                temporaryMuteStatus.hidden = false;
            } else {
                temporaryMuteStatus.textContent = '';
                temporaryMuteStatus.hidden = true;
            }
        }
    }
    const temporaryMuteInlineClear = document.getElementById('opsAlertTemporaryMuteInlineClear');
    if (temporaryMuteInlineClear) {
        temporaryMuteInlineClear.hidden = sharedControlState?.temporaryMute
            ? sharedControlState.temporaryMute.clearHidden
            : !(temporaryMuteState.active || temporaryMuteState.expired);
    }

    const quietHours = normalizedConfig.quiet_hours || getDefaultOpsAlertConfig().quiet_hours;
    const quietHoursEnabledToggle = document.getElementById('opsAlertQuietHoursEnabledToggle');
    if (quietHoursEnabledToggle) {
        quietHoursEnabledToggle.classList.toggle('active', sharedControlState?.quietHours?.enabledActive ?? quietHours.enabled);
    }

    const allowCriticalToggle = document.getElementById('opsAlertQuietHoursAllowCriticalToggle');
    if (allowCriticalToggle) {
        allowCriticalToggle.classList.toggle('active', sharedControlState?.quietHours?.allowCriticalActive ?? quietHours.allow_critical);
        allowCriticalToggle.classList.toggle('disabled', sharedControlState?.quietHours?.allowCriticalDisabled ?? !quietHours.enabled);
    }

    [
        'opsAlertQuietHoursStartHour',
        'opsAlertQuietHoursEndHour',
        'opsAlertQuietHoursTimezone'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = sharedControlState?.quietHours?.inputsDisabled ?? !quietHours.enabled;
    });
    const quietHoursRangeHint = document.getElementById('opsAlertQuietHoursRangeHint');
    if (quietHoursRangeHint) {
        quietHoursRangeHint.textContent = sharedControlState?.quietHours?.rangeHint || formatOpsAlertHourRangePreview(
            quietHours.start_hour,
            quietHours.end_hour,
            { timezone: quietHours.timezone }
        );
    }

    const workHours = normalizedConfig.work_hours || getDefaultOpsAlertConfig().work_hours;
    const workHoursEnabledToggle = document.getElementById('opsAlertWorkHoursEnabledToggle');
    if (workHoursEnabledToggle) {
        workHoursEnabledToggle.classList.toggle('active', sharedControlState?.workHours?.enabledActive ?? workHours.enabled);
    }

    [
        'opsAlertWorkHoursStartHour',
        'opsAlertWorkHoursEndHour',
        'opsAlertWorkHoursTimezone'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = sharedControlState?.workHours?.inputsDisabled ?? !workHours.enabled;
    });
    const workHoursRangeHint = document.getElementById('opsAlertWorkHoursRangeHint');
    if (workHoursRangeHint) {
        workHoursRangeHint.textContent = sharedControlState?.workHours?.rangeHint || formatOpsAlertHourRangePreview(
            workHours.start_hour,
            workHours.end_hour,
            { timezone: workHours.timezone }
        );
    }

    ['types', 'modules'].forEach((scope) => {
        const scopeConfig = normalizedConfig.mute_rules?.[scope] || {};
        getOpsAlertMuteRuleDefinitions(scope).forEach((definition) => {
            const rule = scopeConfig[definition.key] || {};
            const state = getOpsAlertMuteRuleState(rule);
            const sharedRuleState = sharedControlState?.muteRules?.[scope]?.[definition.key] || null;
            const input = document.getElementById(getOpsAlertMuteRuleElementId(scope, definition.key, 'Until'));
            if (input) {
                input.value = sharedRuleState?.untilValue || formatDateTimeLocalInputValue(rule.until || '');
            }

            const allowCriticalToggle = document.getElementById(getOpsAlertMuteRuleElementId(scope, definition.key, 'AllowCriticalToggle'));
            if (allowCriticalToggle) {
                allowCriticalToggle.classList.toggle('active', sharedRuleState?.allowCriticalActive ?? (rule.allow_critical !== false));
            }

            const statusEl = document.getElementById(getOpsAlertMuteRuleElementId(scope, definition.key, 'Status'));
            if (statusEl) {
                if (sharedRuleState) {
                    statusEl.textContent = sharedRuleState.statusText || '';
                    statusEl.hidden = sharedRuleState.statusHidden === true;
                } else if (state.active) {
                    statusEl.textContent = `${state.untilLabel} 前静默${state.allowCritical ? '，critical 继续通知。' : '，全部级别暂停。'}`;
                    statusEl.hidden = false;
                } else if (state.expired) {
                    statusEl.textContent = `已于 ${state.untilLabel} 到期，可清除旧时间。`;
                    statusEl.hidden = false;
                } else {
                    statusEl.textContent = '';
                    statusEl.hidden = true;
                }
            }
            const clearButton = document.getElementById(getOpsAlertMuteRuleElementId(scope, definition.key, 'Clear'));
            if (clearButton) {
                clearButton.hidden = sharedRuleState ? sharedRuleState.clearHidden : !(state.active || state.expired);
            }

            const row = document.querySelector(`[data-mute-rule-row="${scope}:${definition.key}"]`);
            if (row instanceof HTMLElement) {
                row.dataset.ruleState = sharedRuleState?.rowState || (state.active ? 'active' : (state.expired ? 'expired' : 'inactive'));
            }
        });
    });

    const routingKeys = Object.keys(normalizedConfig.routing || getDefaultOpsAlertConfig().routing || {});
    const channelKeys = ['telegram', 'feishu', 'email'];
    routingKeys.forEach((routingKey) => {
        channelKeys.forEach((channelKey) => {
            const checkbox = document.getElementById(getOpsAlertRoutingCheckboxId(routingKey, channelKey));
            if (!checkbox) return;
            checkbox.checked = sharedControlState?.routingMatrix?.[routingKey]?.[channelKey] ?? (normalizedConfig.routing?.[routingKey]?.[channelKey] !== false);
        });
    });

    syncAllOpsAlertDateTimeFields();
    renderOpsAlertStrategySummary(normalizedConfig);
}

function getOpsAlertCustomerChatQuickReplyVariableTokens(businessType = 'general') {
    switch (getOpsAlertCustomerChatQuickReplyBusinessTypeMeta(businessType).value) {
        case 'order':
            return ['{{order_name}}', '{{order_status}}'];
        case 'payment':
            return ['{{payment_status}}'];
        case 'verification':
            return ['{{verification_status}}'];
        case 'ticket':
            return ['{{ticket_status}}'];
        default:
            return [];
    }
}

function getOpsAlertCustomerChatQuickReplyPreviewPlaceholders(businessType = 'general') {
    switch (getOpsAlertCustomerChatQuickReplyBusinessTypeMeta(businessType).value) {
        case 'order':
            return {
                order_name: '示例订单',
                order_status: '待确认'
            };
        case 'payment':
            return {
                payment_status: '处理中'
            };
        case 'verification':
            return {
                verification_status: '排队中'
            };
        case 'ticket':
            return {
                ticket_status: '已受理'
            };
        default:
            return {};
    }
}

function interpolateOpsAlertCustomerChatQuickReplyPreviewText(templateText = '', businessType = 'general') {
    const placeholders = getOpsAlertCustomerChatQuickReplyPreviewPlaceholders(businessType);
    return String(templateText || '').replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_match, rawKey) => {
        const normalizedKey = String(rawKey || '').trim().toLowerCase();
        return Object.prototype.hasOwnProperty.call(placeholders, normalizedKey)
            ? String(placeholders[normalizedKey] || '')
            : `{{${normalizedKey}}}`;
    });
}

function buildOpsAlertCustomerChatQuickReplyPreviewMarkup(template = {}) {
    const businessType = getOpsAlertCustomerChatQuickReplyBusinessTypeMeta(template.business_type).value;
    const previewLabel = interpolateOpsAlertCustomerChatQuickReplyPreviewText(template.label || '', businessType) || '未填写按钮文案';
    const previewHint = interpolateOpsAlertCustomerChatQuickReplyPreviewText(template.hint || '', businessType) || '可在这里预览按钮下方提示';
    const previewText = interpolateOpsAlertCustomerChatQuickReplyPreviewText(template.text || '', businessType) || '可在这里预览填入发送框的正文';

    return `
        <div class="ops-alert-quick-reply-template__preview">
            <div class="ops-alert-quick-reply-template__preview-pill" data-ops-alert-quick-reply-role="preview-label">${escapeConfigHtml(previewLabel)}</div>
            <div class="ops-alert-quick-reply-template__preview-hint" data-ops-alert-quick-reply-role="preview-hint">${escapeConfigHtml(previewHint)}</div>
            <div class="ops-alert-quick-reply-template__preview-body" data-ops-alert-quick-reply-role="preview-text">${escapeConfigHtml(previewText)}</div>
        </div>
    `;
}

function buildOpsAlertCustomerChatQuickReplyVariableChipsHtml(businessType = 'general') {
    const tokens = getOpsAlertCustomerChatQuickReplyVariableTokens(businessType);
    if (!tokens.length) {
        return '<span class="ops-alert-quick-reply-template__chip ops-alert-quick-reply-template__chip--muted">无需额外变量</span>';
    }

    return tokens.map((token) => (
        `
            <button
                type="button"
                class="ops-alert-quick-reply-template__chip ops-alert-quick-reply-template__chip--action"
                data-ops-alert-quick-reply-token="${escapeConfigHtml(token)}"
                title="插入 ${escapeConfigHtml(token)}"
            >
                ${escapeConfigHtml(token)}
            </button>
        `
    )).join('');
}

function getOpsAlertCustomerChatQuickReplyBusinessTypeTone(businessType = 'general') {
    switch (getOpsAlertCustomerChatQuickReplyBusinessTypeMeta(businessType).value) {
        case 'order':
            return 'order';
        case 'payment':
            return 'payment';
        case 'verification':
            return 'verification';
        case 'ticket':
            return 'ticket';
        default:
            return 'general';
    }
}

function summarizeOpsAlertCustomerChatQuickReplyText(value = '', fallback = '', maxLength = 72) {
    const normalizedValue = String(value || '').replace(/\s+/g, ' ').trim();
    const resolvedValue = normalizedValue || String(fallback || '').trim();
    if (resolvedValue.length <= maxLength) {
        return resolvedValue;
    }
    return `${resolvedValue.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildOpsAlertCustomerChatQuickReplyCollapsedSummaryMarkup(template = {}) {
    const businessType = getOpsAlertCustomerChatQuickReplyBusinessTypeMeta(template.business_type).value;
    const labelText = summarizeOpsAlertCustomerChatQuickReplyText(
        interpolateOpsAlertCustomerChatQuickReplyPreviewText(template.label || '', businessType),
        '未填写按钮文案',
        24
    );
    const hintText = summarizeOpsAlertCustomerChatQuickReplyText(
        interpolateOpsAlertCustomerChatQuickReplyPreviewText(template.hint || '', businessType),
        '未填写提示文案',
        72
    );
    const bodyText = summarizeOpsAlertCustomerChatQuickReplyText(
        interpolateOpsAlertCustomerChatQuickReplyPreviewText(template.text || '', businessType),
        '未填写回复正文',
        120
    );

    return `
        <div class="ops-alert-quick-reply-template__collapsed-summary" data-ops-alert-quick-reply-role="collapsed-summary">
            <div class="ops-alert-quick-reply-template__collapsed-top">
                <span class="ops-alert-quick-reply-template__collapsed-pill" data-ops-alert-quick-reply-role="collapsed-label">${escapeConfigHtml(labelText)}</span>
                <span class="ops-alert-quick-reply-template__collapsed-hint" data-ops-alert-quick-reply-role="collapsed-hint">${escapeConfigHtml(hintText)}</span>
            </div>
            <div class="ops-alert-quick-reply-template__collapsed-text" data-ops-alert-quick-reply-role="collapsed-text">${escapeConfigHtml(bodyText)}</div>
        </div>
    `;
}

function buildOpsAlertCustomerChatQuickReplyTemplateRowHtml(template = {}, index = 0, total = 0, options = {}) {
    const businessTypeMeta = getOpsAlertCustomerChatQuickReplyBusinessTypeMeta(template.business_type);
    const businessType = businessTypeMeta.value;
    const isEnabled = template.enabled !== false;
    const isExpanded = options && options.expanded === true;
    const templateId = escapeConfigHtml(template.id || `template_${index + 1}`);
    const isFirst = index === 0;
    const isLast = index >= Math.max(0, Number(total || 0) - 1);
    const businessTypeOptions = OPS_ALERT_CUSTOMER_CHAT_QUICK_REPLY_BUSINESS_TYPES.map((item) => (
        `<option value="${escapeConfigHtml(item.value)}"${item.value === businessType ? ' selected' : ''}>${escapeConfigHtml(item.label)}</option>`
    )).join('');

    return `
        <article
            class="ops-alert-quick-reply-template${isEnabled ? ' is-enabled' : ' is-disabled'}${isExpanded ? ' is-expanded' : ' is-collapsed'}"
            data-ops-alert-quick-reply-index="${index}"
            data-ops-alert-quick-reply-id="${templateId}"
            data-ops-alert-quick-reply-expanded="${isExpanded ? 'true' : 'false'}"
        >
            <div class="ops-alert-quick-reply-template__header">
                <div class="ops-alert-quick-reply-template__header-copy">
                    <div class="ops-alert-quick-reply-template__eyebrow">快捷回复 ${index + 1}</div>
                    <div class="ops-alert-quick-reply-template__title-row">
                        <div class="ops-alert-quick-reply-template__title">模板 ID: ${templateId}</div>
                        <div class="ops-alert-quick-reply-template__badges">
                            <span
                                class="ops-alert-quick-reply-template__badge"
                                data-ops-alert-quick-reply-role="business-badge"
                                data-tone="${escapeConfigHtml(getOpsAlertCustomerChatQuickReplyBusinessTypeTone(businessType))}"
                            >
                                ${escapeConfigHtml(businessTypeMeta.label)}
                            </span>
                            <span
                                class="ops-alert-quick-reply-template__badge"
                                data-ops-alert-quick-reply-role="status-badge"
                                data-tone="${isEnabled ? 'success' : 'muted'}"
                            >
                                ${isEnabled ? '启用中' : '已停用'}
                            </span>
                        </div>
                    </div>
                    <div class="ops-alert-quick-reply-template__meta" data-ops-alert-quick-reply-role="business-meta">把这条模板展示给 ${escapeConfigHtml(businessTypeMeta.label)} 场景，用来给管理员快速接手和回复。</div>
                </div>
                <div class="ops-alert-quick-reply-template__actions">
                    <button
                        type="button"
                        class="btn-add-config btn-add-config--compact btn-add-config--ghost ops-alert-quick-reply-template__toggle"
                        data-ops-alert-quick-reply-toggle="${index}"
                        data-ops-alert-quick-reply-role="toggle-button"
                        aria-expanded="${isExpanded ? 'true' : 'false'}"
                        title="${isExpanded ? '收起模板' : '展开模板'}"
                    >
                        <i class="fas fa-chevron-${isExpanded ? 'up' : 'down'}" data-ops-alert-quick-reply-role="toggle-icon"></i>
                        <span data-ops-alert-quick-reply-role="toggle-label">${isExpanded ? '收起' : '展开'}</span>
                    </button>
                    <button
                        type="button"
                        class="btn-add-config btn-add-config--compact btn-add-config--ghost ops-alert-quick-reply-template__move"
                        data-ops-alert-quick-reply-move="up"
                        data-ops-alert-quick-reply-move-index="${index}"
                        ${isFirst ? 'disabled' : ''}
                        aria-label="上移模板"
                        title="上移模板"
                    >
                        <i class="fas fa-arrow-up"></i>
                    </button>
                    <button
                        type="button"
                        class="btn-add-config btn-add-config--compact btn-add-config--ghost ops-alert-quick-reply-template__move"
                        data-ops-alert-quick-reply-move="down"
                        data-ops-alert-quick-reply-move-index="${index}"
                        ${isLast ? 'disabled' : ''}
                        aria-label="下移模板"
                        title="下移模板"
                    >
                        <i class="fas fa-arrow-down"></i>
                    </button>
                    <button
                        type="button"
                        class="btn-add-config btn-add-config--compact btn-add-config--ghost ops-alert-quick-reply-template__remove"
                        data-ops-alert-quick-reply-remove="${index}"
                    >
                        删除
                    </button>
                </div>
            </div>
            ${buildOpsAlertCustomerChatQuickReplyCollapsedSummaryMarkup(template).replace(
                'data-ops-alert-quick-reply-role="collapsed-summary"',
                `data-ops-alert-quick-reply-role="collapsed-summary"${isExpanded ? ' hidden' : ''}`
            )}
            <div class="ops-alert-quick-reply-template__layout" data-ops-alert-quick-reply-role="body"${isExpanded ? '' : ' hidden'}>
                <div class="ops-alert-quick-reply-template__summary">
                    <div class="ops-alert-quick-reply-template__panel">
                        <span class="ops-alert-quick-reply-template__panel-label">使用场景</span>
                        <p data-ops-alert-quick-reply-role="business-panel-copy">${escapeConfigHtml(businessTypeMeta.description)}</p>
                    </div>
                    <div class="ops-alert-quick-reply-template__panel">
                        <span class="ops-alert-quick-reply-template__panel-label">可用变量</span>
                        <div class="ops-alert-quick-reply-template__chips" data-ops-alert-quick-reply-role="variable-chips">
                            ${buildOpsAlertCustomerChatQuickReplyVariableChipsHtml(businessType)}
                        </div>
                    </div>
                    <div class="ops-alert-quick-reply-template__panel">
                        <span class="ops-alert-quick-reply-template__panel-label">发送预览</span>
                        ${buildOpsAlertCustomerChatQuickReplyPreviewMarkup(template)}
                    </div>
                    <label class="ops-alert-quick-reply-template__toggle-card">
                        <div class="ops-alert-quick-reply-template__toggle-copy">
                            <span>启用模板</span>
                            <small>关闭后不会出现在客服工作台的快捷回复栏里。</small>
                        </div>
                        <span class="ops-alert-quick-reply-template__toggle-control">
                            <input type="checkbox" data-ops-alert-quick-reply-field="enabled"${isEnabled ? ' checked' : ''}>
                            <span class="ops-alert-quick-reply-template__switch" aria-hidden="true"></span>
                        </span>
                    </label>
                </div>
                <div class="ops-alert-quick-reply-template__editor">
                    <div class="ops-alert-quick-reply-template__grid">
                        <label class="ops-alert-quick-reply-template__field" data-ops-alert-quick-reply-field-wrap="business_type">
                            <span>业务类型</span>
                            <select class="config-input" data-ops-alert-quick-reply-field="business_type">
                                ${businessTypeOptions}
                            </select>
                            <small data-ops-alert-quick-reply-role="business-description">${escapeConfigHtml(businessTypeMeta.description)}</small>
                        </label>
                        <label class="ops-alert-quick-reply-template__field" data-ops-alert-quick-reply-field-wrap="label">
                            <span>按钮文案</span>
                            <input type="text" class="config-input" maxlength="24" data-ops-alert-quick-reply-field="label" value="${escapeConfigHtml(template.label || '')}" placeholder="例如：订单说明">
                            <small>显示在快捷回复按钮上的短文案。</small>
                        </label>
                        <label class="ops-alert-quick-reply-template__field ops-alert-quick-reply-template__field--full" data-ops-alert-quick-reply-field-wrap="hint">
                            <span>提示文案</span>
                            <input type="text" class="config-input" maxlength="40" data-ops-alert-quick-reply-field="hint" value="${escapeConfigHtml(template.hint || '')}" placeholder="例如：最近订单 {{order_status}}">
                            <small>显示在按钮下方的辅助说明，可插入当前会话的上下文变量。</small>
                        </label>
                    </div>
                    <label class="ops-alert-quick-reply-template__field ops-alert-quick-reply-template__field--full" data-ops-alert-quick-reply-field-wrap="text">
                        <span>回复正文</span>
                        <textarea class="config-input ops-alert-quick-reply-template__textarea" rows="4" maxlength="240" data-ops-alert-quick-reply-field="text" placeholder="支持插入上下文字段，例如 {{order_name}}、{{order_status}}。">${escapeConfigHtml(template.text || '')}</textarea>
                        <small>会直接填入管理员发送框，建议写成可快速确认、接手或同步进度的短句。</small>
                    </label>
                    <div class="ops-alert-quick-reply-template__validation" data-ops-alert-quick-reply-role="validation" hidden></div>
                </div>
            </div>
        </article>
    `;
}

function collectOpsAlertCustomerChatQuickReplyExpansionState(container = document.getElementById('opsAlertCustomerChatQuickReplyTemplates')) {
    if (!(container instanceof HTMLElement)) {
        return {};
    }

    const previousState = container.__opsAlertQuickReplyExpansionState
        && typeof container.__opsAlertQuickReplyExpansionState === 'object'
        ? { ...container.__opsAlertQuickReplyExpansionState }
        : {};

    container.querySelectorAll('[data-ops-alert-quick-reply-index]').forEach((row, index) => {
        if (!(row instanceof HTMLElement)) {
            return;
        }

        const templateId = normalizeOpsAlertCustomerChatQuickReplyTemplateId(
            row.getAttribute('data-ops-alert-quick-reply-id') || '',
            index
        );
        previousState[templateId] = row.dataset.opsAlertQuickReplyExpanded === 'true';
    });

    return previousState;
}

function setOpsAlertCustomerChatQuickReplyRowExpanded(row, expanded) {
    if (!(row instanceof HTMLElement)) {
        return false;
    }

    const isExpanded = expanded === true;
    row.dataset.opsAlertQuickReplyExpanded = isExpanded ? 'true' : 'false';
    row.classList.toggle('is-expanded', isExpanded);
    row.classList.toggle('is-collapsed', !isExpanded);

    const body = row.querySelector('[data-ops-alert-quick-reply-role="body"]');
    if (body instanceof HTMLElement) {
        body.hidden = !isExpanded;
    }

    const collapsedSummary = row.querySelector('[data-ops-alert-quick-reply-role="collapsed-summary"]');
    if (collapsedSummary instanceof HTMLElement) {
        collapsedSummary.hidden = isExpanded;
    }

    const toggleButton = row.querySelector('[data-ops-alert-quick-reply-role="toggle-button"]');
    if (toggleButton instanceof HTMLElement) {
        toggleButton.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        toggleButton.setAttribute('title', isExpanded ? '收起模板' : '展开模板');
    }

    const toggleLabel = row.querySelector('[data-ops-alert-quick-reply-role="toggle-label"]');
    if (toggleLabel instanceof HTMLElement) {
        toggleLabel.textContent = isExpanded ? '收起' : '展开';
    }

    const toggleIcon = row.querySelector('[data-ops-alert-quick-reply-role="toggle-icon"]');
    if (toggleIcon instanceof HTMLElement) {
        toggleIcon.classList.toggle('fa-chevron-up', isExpanded);
        toggleIcon.classList.toggle('fa-chevron-down', !isExpanded);
    }

    return isExpanded;
}

function renderOpsAlertCustomerChatQuickReplyTemplates(templates = [], options = {}) {
    const container = document.getElementById('opsAlertCustomerChatQuickReplyTemplates');
    if (!container) {
        return;
    }

    const normalizedTemplates = normalizeOpsAlertCustomerChatQuickReplyTemplates(templates, { preserveDrafts: true });
    const expansionState = {
        ...collectOpsAlertCustomerChatQuickReplyExpansionState(container),
        ...((options && options.expansionState && typeof options.expansionState === 'object') ? options.expansionState : {})
    };
    if (!normalizedTemplates.length) {
        container.dataset.opsAlertQuickReplyValidationVisible = 'false';
        container.__opsAlertQuickReplyExpansionState = {};
        container.innerHTML = `
            <div class="ops-alert-quick-reply-empty">
                <i class="fas fa-comment-slash"></i>
                <span>当前没有快捷回复模板。可按业务类型新增一条。</span>
            </div>
        `;
        return;
    }

    container.innerHTML = normalizedTemplates
        .map((template, index) => buildOpsAlertCustomerChatQuickReplyTemplateRowHtml(
            template,
            index,
            normalizedTemplates.length,
            {
                expanded: expansionState[normalizeOpsAlertCustomerChatQuickReplyTemplateId(template.id, index)] === true
            }
        ))
        .join('');

    container.__opsAlertQuickReplyExpansionState = normalizedTemplates.reduce((state, template, index) => {
        const templateId = normalizeOpsAlertCustomerChatQuickReplyTemplateId(template.id, index);
        state[templateId] = expansionState[templateId] === true;
        return state;
    }, {});

    container.querySelectorAll('[data-ops-alert-quick-reply-index]').forEach((row, index) => {
        if (!(row instanceof HTMLElement)) {
            return;
        }
        const templateId = normalizeOpsAlertCustomerChatQuickReplyTemplateId(
            row.getAttribute('data-ops-alert-quick-reply-id') || '',
            index
        );
        setOpsAlertCustomerChatQuickReplyRowExpanded(row, container.__opsAlertQuickReplyExpansionState[templateId] === true);
    });

    if (container.dataset.opsAlertQuickReplyValidationVisible === 'true') {
        syncOpsAlertCustomerChatQuickReplyTemplateValidationState();
    }
}

function collectOpsAlertCustomerChatQuickReplyTemplatesFromForm(options = {}) {
    const preserveDrafts = options && options.preserveDrafts === true;
    const container = document.getElementById('opsAlertCustomerChatQuickReplyTemplates');
    if (!container) {
        return normalizeOpsAlertCustomerChatQuickReplyTemplates(undefined);
    }

    const templates = Array.from(container.querySelectorAll('[data-ops-alert-quick-reply-index]')).map((row, index) => ({
        id: normalizeOpsAlertCustomerChatQuickReplyTemplateId(
            row.getAttribute('data-ops-alert-quick-reply-id') || '',
            index
        ),
        business_type: row.querySelector('[data-ops-alert-quick-reply-field="business_type"]')?.value || 'general',
        enabled: row.querySelector('[data-ops-alert-quick-reply-field="enabled"]')?.checked !== false,
        label: row.querySelector('[data-ops-alert-quick-reply-field="label"]')?.value || '',
        hint: row.querySelector('[data-ops-alert-quick-reply-field="hint"]')?.value || '',
        text: row.querySelector('[data-ops-alert-quick-reply-field="text"]')?.value || ''
    }));

    return normalizeOpsAlertCustomerChatQuickReplyTemplates(templates, { preserveDrafts });
}

function getOpsAlertCustomerChatQuickReplyEditableFieldNames() {
    return new Set(['label', 'hint', 'text']);
}

function getOpsAlertCustomerChatQuickReplyRowDraft(row, index = 0) {
    if (!(row instanceof HTMLElement)) {
        return null;
    }

    return {
        index,
        id: normalizeOpsAlertCustomerChatQuickReplyTemplateId(
            row.getAttribute('data-ops-alert-quick-reply-id') || '',
            index
        ),
        business_type: row.querySelector('[data-ops-alert-quick-reply-field="business_type"]')?.value || 'general',
        enabled: row.querySelector('[data-ops-alert-quick-reply-field="enabled"]')?.checked !== false,
        label: row.querySelector('[data-ops-alert-quick-reply-field="label"]')?.value || '',
        hint: row.querySelector('[data-ops-alert-quick-reply-field="hint"]')?.value || '',
        text: row.querySelector('[data-ops-alert-quick-reply-field="text"]')?.value || ''
    };
}

function focusOpsAlertCustomerChatQuickReplyField(row, fieldName = 'text') {
    if (!(row instanceof HTMLElement)) {
        return;
    }

    setOpsAlertCustomerChatQuickReplyRowExpanded(row, true);
    const normalizedFieldName = row.querySelector(`[data-ops-alert-quick-reply-field="${fieldName}"]`)
        ? fieldName
        : 'text';
    const target = row.querySelector(`[data-ops-alert-quick-reply-field="${normalizedFieldName}"]`);
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (target instanceof HTMLElement) {
        window.setTimeout(() => target.focus(), 60);
    }
}

function getOpsAlertCustomerChatQuickReplyFieldLabel(fieldName = '') {
    switch (String(fieldName || '').trim().toLowerCase()) {
        case 'business_type':
            return '业务类型';
        case 'label':
            return '按钮文案';
        case 'hint':
            return '提示文案';
        case 'text':
            return '回复正文';
        default:
            return '当前模板';
    }
}

function getOpsAlertCustomerChatQuickReplyTemplateTokenViolations(template = {}) {
    const allowedKeys = new Set(
        getOpsAlertCustomerChatQuickReplyVariableTokens(template.business_type)
            .map((token) => String(token || '').replace(/[{}]/g, '').trim().toLowerCase())
            .filter(Boolean)
    );
    const violations = [];

    ['label', 'hint', 'text'].forEach((fieldName) => {
        const fieldValue = String(template[fieldName] || '');
        const matchedTokens = fieldValue.match(/{{\s*([a-z0-9_]+)\s*}}/gi) || [];
        const unknownTokens = [];
        matchedTokens.forEach((token) => {
            const normalizedKey = token.replace(/[{}]/g, '').trim().toLowerCase();
            if (!allowedKeys.has(normalizedKey) && !unknownTokens.includes(token)) {
                unknownTokens.push(token);
            }
        });

        if (unknownTokens.length) {
            violations.push({
                field: fieldName,
                tokens: unknownTokens
            });
        }
    });

    return violations;
}

function getOpsAlertCustomerChatQuickReplyTemplateUnknownTokens(template = {}) {
    return getOpsAlertCustomerChatQuickReplyTemplateTokenViolations(template)
        .flatMap((violation) => violation.tokens || [])
        .filter((token, index, source) => source.indexOf(token) === index);
}

function getOpsAlertCustomerChatQuickReplyTemplateValidationErrors(template = {}, options = {}) {
    const errors = [];
    const supportedTokens = getOpsAlertCustomerChatQuickReplyVariableTokens(template.business_type);

    if (options.duplicateId === true) {
        errors.push({
            field: 'label',
            message: '这张模板和另一张卡片的模板 ID 冲突了，请删除重复模板后再保存。'
        });
    }

    if (!String(template.text || '').trim()) {
        errors.push({
            field: 'text',
            message: '请补全回复正文，或者删除这张草稿卡片。'
        });
    }

    getOpsAlertCustomerChatQuickReplyTemplateTokenViolations(template).forEach((violation) => {
        const fieldLabel = getOpsAlertCustomerChatQuickReplyFieldLabel(violation.field);
        errors.push({
            field: violation.field,
            message: supportedTokens.length
                ? `${fieldLabel}里使用了当前业务类型不支持的变量：${violation.tokens.join('、')}。当前可用：${supportedTokens.join('、')}`
                : `${fieldLabel}当前不支持变量 ${violation.tokens.join('、')}。这个业务类型下无需额外变量。`
        });
    });

    return errors;
}

function renderOpsAlertCustomerChatQuickReplyTemplateValidation(row, errors = [], options = {}) {
    if (!(row instanceof HTMLElement)) {
        return false;
    }

    const validationEl = row.querySelector('[data-ops-alert-quick-reply-role="validation"]');
    const shouldReveal = options.reveal === true;
    const invalidFields = new Set(
        (Array.isArray(errors) ? errors : [])
            .map((error) => String(error?.field || '').trim())
            .filter(Boolean)
    );

    row.classList.toggle('has-validation-error', shouldReveal && invalidFields.size > 0);

    row.querySelectorAll('[data-ops-alert-quick-reply-field-wrap]').forEach((fieldWrap) => {
        if (!(fieldWrap instanceof HTMLElement)) {
            return;
        }

        const fieldName = String(fieldWrap.getAttribute('data-ops-alert-quick-reply-field-wrap') || '').trim();
        const isInvalid = shouldReveal && invalidFields.has(fieldName);
        fieldWrap.classList.toggle('is-invalid', isInvalid);

        const input = fieldWrap.querySelector('[data-ops-alert-quick-reply-field]');
        if (input instanceof HTMLElement) {
            if (isInvalid) {
                input.setAttribute('aria-invalid', 'true');
            } else {
                input.removeAttribute('aria-invalid');
            }
        }
    });

    if (validationEl instanceof HTMLElement) {
        if (shouldReveal && errors.length) {
            validationEl.hidden = false;
            validationEl.innerHTML = errors.map((error) => `
                <div class="ops-alert-quick-reply-template__validation-item">
                    <i class="fas fa-circle-exclamation"></i>
                    <span>${escapeConfigHtml(error.message || '')}</span>
                </div>
            `).join('');
        } else {
            validationEl.hidden = true;
            validationEl.innerHTML = '';
        }
    }

    return errors.length > 0;
}

function syncOpsAlertCustomerChatQuickReplyTemplateValidationState(options = {}) {
    const container = document.getElementById('opsAlertCustomerChatQuickReplyTemplates');
    if (!container) {
        return { invalidCount: 0, firstInvalid: null };
    }

    const rows = Array.from(container.querySelectorAll('[data-ops-alert-quick-reply-index]'));
    const drafts = rows.map((row, index) => getOpsAlertCustomerChatQuickReplyRowDraft(row, index));
    const firstIndexById = new Map();
    const duplicateIndexes = new Set();
    let firstInvalid = null;
    let invalidCount = 0;
    const shouldReveal = options.revealAll === true || container.dataset.opsAlertQuickReplyValidationVisible === 'true';

    drafts.forEach((draft, index) => {
        if (!draft) {
            return;
        }

        if (firstIndexById.has(draft.id)) {
            duplicateIndexes.add(index);
            duplicateIndexes.add(firstIndexById.get(draft.id));
            return;
        }

        firstIndexById.set(draft.id, index);
    });

    rows.forEach((row, index) => {
        const draft = drafts[index];
        const errors = draft
            ? getOpsAlertCustomerChatQuickReplyTemplateValidationErrors(draft, {
                duplicateId: duplicateIndexes.has(index)
            })
            : [];
        const hasErrors = renderOpsAlertCustomerChatQuickReplyTemplateValidation(row, errors, { reveal: shouldReveal });
        if (!hasErrors) {
            return;
        }

        invalidCount += errors.length;
        if (!firstInvalid) {
            firstInvalid = {
                row,
                errors
            };
        }
    });

    container.dataset.opsAlertQuickReplyValidationVisible = invalidCount > 0 && shouldReveal
        ? 'true'
        : 'false';

    return {
        invalidCount,
        firstInvalid
    };
}

function validateOpsAlertCustomerChatQuickReplyTemplatesBeforeSave() {
    const container = document.getElementById('opsAlertCustomerChatQuickReplyTemplates');
    if (!container) {
        return true;
    }

    container.dataset.opsAlertQuickReplyValidationVisible = 'true';
    const validationResult = syncOpsAlertCustomerChatQuickReplyTemplateValidationState({ revealAll: true });
    if (validationResult.invalidCount > 0) {
        if (typeof showToast === 'function') {
            showToast(`快捷回复模板里还有 ${validationResult.invalidCount} 处待修正项，已在卡片内标出`, 'warning');
        }
        const preferredField = validationResult.firstInvalid?.errors?.[0]?.field || 'text';
        focusOpsAlertCustomerChatQuickReplyField(validationResult.firstInvalid?.row, preferredField);
        return false;
    }

    return true;
}

function getOpsAlertCustomerChatQuickReplyInsertionTarget(row) {
    if (!(row instanceof HTMLElement)) {
        return null;
    }

    const editableFieldNames = getOpsAlertCustomerChatQuickReplyEditableFieldNames();
    const preferredField = String(row.dataset.opsAlertQuickReplyActiveField || '').trim();
    if (editableFieldNames.has(preferredField)) {
        const preferredInput = row.querySelector(`[data-ops-alert-quick-reply-field="${preferredField}"]`);
        if (preferredInput instanceof HTMLInputElement || preferredInput instanceof HTMLTextAreaElement) {
            return preferredInput;
        }
    }

    const fallbackInput = row.querySelector('[data-ops-alert-quick-reply-field="text"]');
    return (fallbackInput instanceof HTMLInputElement || fallbackInput instanceof HTMLTextAreaElement)
        ? fallbackInput
        : null;
}

function insertOpsAlertCustomerChatQuickReplyToken(row, token) {
    const normalizedToken = String(token || '').trim();
    if (!(row instanceof HTMLElement) || !normalizedToken) {
        return false;
    }

    const input = getOpsAlertCustomerChatQuickReplyInsertionTarget(row);
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
        return false;
    }

    const currentValue = String(input.value || '');
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : currentValue.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : currentValue.length;
    input.value = `${currentValue.slice(0, start)}${normalizedToken}${currentValue.slice(end)}`;
    const nextCaret = start + normalizedToken.length;
    input.setSelectionRange(nextCaret, nextCaret);
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

function syncOpsAlertCustomerChatQuickReplyTemplateState(row) {
    if (!(row instanceof HTMLElement)) {
        return;
    }

    const businessType = row.querySelector('[data-ops-alert-quick-reply-field="business_type"]')?.value || 'general';
    const enabled = row.querySelector('[data-ops-alert-quick-reply-field="enabled"]')?.checked !== false;
    const businessTypeMeta = getOpsAlertCustomerChatQuickReplyBusinessTypeMeta(businessType);
    const businessTone = getOpsAlertCustomerChatQuickReplyBusinessTypeTone(businessType);

    row.classList.toggle('is-enabled', enabled);
    row.classList.toggle('is-disabled', !enabled);

    const businessBadge = row.querySelector('[data-ops-alert-quick-reply-role="business-badge"]');
    if (businessBadge instanceof HTMLElement) {
        businessBadge.dataset.tone = businessTone;
        businessBadge.textContent = businessTypeMeta.label;
    }

    const statusBadge = row.querySelector('[data-ops-alert-quick-reply-role="status-badge"]');
    if (statusBadge instanceof HTMLElement) {
        statusBadge.dataset.tone = enabled ? 'success' : 'muted';
        statusBadge.textContent = enabled ? '启用中' : '已停用';
    }

    const businessMeta = row.querySelector('[data-ops-alert-quick-reply-role="business-meta"]');
    if (businessMeta instanceof HTMLElement) {
        businessMeta.textContent = `把这条模板展示给 ${businessTypeMeta.label} 场景，用来给管理员快速接手和回复。`;
    }

    const businessPanelCopy = row.querySelector('[data-ops-alert-quick-reply-role="business-panel-copy"]');
    if (businessPanelCopy instanceof HTMLElement) {
        businessPanelCopy.textContent = businessTypeMeta.description;
    }

    const variableChips = row.querySelector('[data-ops-alert-quick-reply-role="variable-chips"]');
    if (variableChips instanceof HTMLElement) {
        variableChips.innerHTML = buildOpsAlertCustomerChatQuickReplyVariableChipsHtml(businessType);
    }

    const labelValue = row.querySelector('[data-ops-alert-quick-reply-field="label"]')?.value || '';
    const hintValue = row.querySelector('[data-ops-alert-quick-reply-field="hint"]')?.value || '';
    const textValue = row.querySelector('[data-ops-alert-quick-reply-field="text"]')?.value || '';
    const previewLabel = row.querySelector('[data-ops-alert-quick-reply-role="preview-label"]');
    if (previewLabel instanceof HTMLElement) {
        previewLabel.textContent = interpolateOpsAlertCustomerChatQuickReplyPreviewText(labelValue, businessType) || '未填写按钮文案';
    }

    const previewHint = row.querySelector('[data-ops-alert-quick-reply-role="preview-hint"]');
    if (previewHint instanceof HTMLElement) {
        previewHint.textContent = interpolateOpsAlertCustomerChatQuickReplyPreviewText(hintValue, businessType) || '可在这里预览按钮下方提示';
    }

    const previewText = row.querySelector('[data-ops-alert-quick-reply-role="preview-text"]');
    if (previewText instanceof HTMLElement) {
        previewText.textContent = interpolateOpsAlertCustomerChatQuickReplyPreviewText(textValue, businessType) || '可在这里预览填入发送框的正文';
    }

    const businessDescription = row.querySelector('[data-ops-alert-quick-reply-role="business-description"]');
    if (businessDescription instanceof HTMLElement) {
        businessDescription.textContent = businessTypeMeta.description;
    }

    const collapsedLabel = row.querySelector('[data-ops-alert-quick-reply-role="collapsed-label"]');
    if (collapsedLabel instanceof HTMLElement) {
        collapsedLabel.textContent = summarizeOpsAlertCustomerChatQuickReplyText(
            interpolateOpsAlertCustomerChatQuickReplyPreviewText(labelValue, businessType),
            '未填写按钮文案',
            24
        );
    }

    const collapsedHint = row.querySelector('[data-ops-alert-quick-reply-role="collapsed-hint"]');
    if (collapsedHint instanceof HTMLElement) {
        collapsedHint.textContent = summarizeOpsAlertCustomerChatQuickReplyText(
            interpolateOpsAlertCustomerChatQuickReplyPreviewText(hintValue, businessType),
            '未填写提示文案',
            72
        );
    }

    const collapsedText = row.querySelector('[data-ops-alert-quick-reply-role="collapsed-text"]');
    if (collapsedText instanceof HTMLElement) {
        collapsedText.textContent = summarizeOpsAlertCustomerChatQuickReplyText(
            interpolateOpsAlertCustomerChatQuickReplyPreviewText(textValue, businessType),
            '未填写回复正文',
            120
        );
    }
}

function refreshOpsAlertQuickReplyDraftIndicators() {
    updateOpsAlertStrategyDraftIndicators();
}

function addOpsAlertCustomerChatQuickReplyTemplate(options = {}) {
    const container = document.getElementById('opsAlertCustomerChatQuickReplyTemplates');
    const currentTemplates = collectOpsAlertCustomerChatQuickReplyTemplatesFromForm({ preserveDrafts: true });
    if (currentTemplates.length >= 12) {
        if (typeof showToast === 'function') {
            showToast('快捷回复模板最多保留 12 条', 'warning');
        }
        return false;
    }

    const draft = createOpsAlertCustomerChatQuickReplyTemplateDraft(options?.businessType || 'general');
    const expansionState = collectOpsAlertCustomerChatQuickReplyExpansionState(container);
    currentTemplates.forEach((template, index) => {
        const templateId = normalizeOpsAlertCustomerChatQuickReplyTemplateId(template.id, index);
        expansionState[templateId] = expansionState[templateId] === true;
    });
    expansionState[draft.id] = true;
    currentTemplates.push(draft);
    renderOpsAlertCustomerChatQuickReplyTemplates(currentTemplates, { expansionState });
    refreshOpsAlertQuickReplyDraftIndicators();

    const nextRow = container?.querySelector(`[data-ops-alert-quick-reply-id="${draft.id}"]`);
    if (nextRow instanceof HTMLElement) {
        focusOpsAlertCustomerChatQuickReplyField(nextRow, 'label');
    }

    if (typeof showToast === 'function') {
        showToast('已新增快捷回复模板草稿', 'info');
    }

    return true;
}

function ensureOpsAlertCustomerChatQuickReplyTemplateEvents() {
    const container = document.getElementById('opsAlertCustomerChatQuickReplyTemplates');
    if (!container || container.dataset.quickReplyReady === 'true') {
        return;
    }

    container.dataset.quickReplyReady = 'true';
    container.addEventListener('click', (event) => {
        const toggleTrigger = event.target instanceof HTMLElement
            ? event.target.closest('[data-ops-alert-quick-reply-toggle]')
            : null;
        if (toggleTrigger instanceof HTMLElement) {
            const row = toggleTrigger.closest('[data-ops-alert-quick-reply-index]');
            if (row instanceof HTMLElement) {
                const nextExpanded = row.dataset.opsAlertQuickReplyExpanded !== 'true';
                setOpsAlertCustomerChatQuickReplyRowExpanded(row, nextExpanded);
                container.__opsAlertQuickReplyExpansionState = collectOpsAlertCustomerChatQuickReplyExpansionState(container);
            }
            return;
        }

        const tokenTrigger = event.target instanceof HTMLElement
            ? event.target.closest('[data-ops-alert-quick-reply-token]')
            : null;
        if (tokenTrigger instanceof HTMLElement) {
            const row = tokenTrigger.closest('[data-ops-alert-quick-reply-index]');
            insertOpsAlertCustomerChatQuickReplyToken(row, tokenTrigger.getAttribute('data-ops-alert-quick-reply-token'));
            refreshOpsAlertQuickReplyDraftIndicators();
            return;
        }

        const moveTrigger = event.target instanceof HTMLElement
            ? event.target.closest('[data-ops-alert-quick-reply-move]')
            : null;
        if (moveTrigger instanceof HTMLElement) {
            const index = toWholeNumber(moveTrigger.getAttribute('data-ops-alert-quick-reply-move-index'), -1);
            const direction = String(moveTrigger.getAttribute('data-ops-alert-quick-reply-move') || '').trim().toLowerCase();
            const currentTemplates = collectOpsAlertCustomerChatQuickReplyTemplatesFromForm({ preserveDrafts: true });
            const targetIndex = direction === 'up'
                ? index - 1
                : direction === 'down'
                    ? index + 1
                    : -1;
            const expansionState = collectOpsAlertCustomerChatQuickReplyExpansionState(container);

            if (index < 0 || targetIndex < 0 || targetIndex >= currentTemplates.length) {
                return;
            }

            [currentTemplates[index], currentTemplates[targetIndex]] = [currentTemplates[targetIndex], currentTemplates[index]];
            renderOpsAlertCustomerChatQuickReplyTemplates(currentTemplates, { expansionState });
            refreshOpsAlertQuickReplyDraftIndicators();
            return;
        }

        const trigger = event.target instanceof HTMLElement
            ? event.target.closest('[data-ops-alert-quick-reply-remove]')
            : null;
        if (!(trigger instanceof HTMLElement)) {
            return;
        }

        const index = toWholeNumber(trigger.getAttribute('data-ops-alert-quick-reply-remove'), -1);
        if (index < 0) {
            return;
        }

        const currentTemplates = collectOpsAlertCustomerChatQuickReplyTemplatesFromForm({ preserveDrafts: true });
        const expansionState = collectOpsAlertCustomerChatQuickReplyExpansionState(container);
        currentTemplates.splice(index, 1);
        renderOpsAlertCustomerChatQuickReplyTemplates(currentTemplates, { expansionState });
        refreshOpsAlertQuickReplyDraftIndicators();
    });
    container.addEventListener('focusin', (event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const row = target?.closest('[data-ops-alert-quick-reply-index]');
        const field = target?.getAttribute('data-ops-alert-quick-reply-field') || '';
        if (!(row instanceof HTMLElement) || !getOpsAlertCustomerChatQuickReplyEditableFieldNames().has(field)) {
            return;
        }
        row.dataset.opsAlertQuickReplyActiveField = field;
    });
    container.addEventListener('input', (event) => {
        event.stopPropagation();
        const target = event.target instanceof HTMLElement
            ? event.target
            : null;
        const row = target?.closest('[data-ops-alert-quick-reply-index]');
        syncOpsAlertCustomerChatQuickReplyTemplateState(row);
        syncOpsAlertCustomerChatQuickReplyTemplateValidationState();
        refreshOpsAlertQuickReplyDraftIndicators();
    });
    container.addEventListener('change', (event) => {
        event.stopPropagation();
        const target = event.target instanceof HTMLElement
            ? event.target
            : null;
        const row = target?.closest('[data-ops-alert-quick-reply-index]');
        syncOpsAlertCustomerChatQuickReplyTemplateState(row);
        syncOpsAlertCustomerChatQuickReplyTemplateValidationState();
        refreshOpsAlertQuickReplyDraftIndicators();
    });
}

function buildLocalOpsAlertShopRiskControlState(shopRiskConfig = {}) {
    return {
        autoResponseToggle: {
            active: shopRiskConfig?.auto_response_enabled === true
        },
        thresholdInputsDisabled: shopRiskConfig?.auto_response_enabled !== true
    };
}

function resolveOpsAlertShopRiskControlStateBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertShopRiskControlState',
        buildLocalOpsAlertShopRiskControlState
    );
}

function resolveOpsAlertShopRiskControlState(shopRiskConfig = {}) {
    return resolveOpsAlertShopRiskControlStateBuilder()(shopRiskConfig);
}

function applyOpsAlertShopRiskControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const shopRiskConfig = normalizedConfig.shop_order_risk || getDefaultOpsAlertConfig().shop_order_risk;
    const sharedControlState = resolveOpsAlertShopRiskControlState(shopRiskConfig);
    const toggleEl = document.getElementById('opsAlertShopRiskAutoResponseEnabledToggle');
    if (toggleEl) {
        toggleEl.classList.toggle('active', sharedControlState?.autoResponseToggle?.active ?? shopRiskConfig.auto_response_enabled);
    }

    [
        'opsAlertShopRiskAutoDisableCouponMinRiskScore',
        'opsAlertShopRiskAutoBanUserMinRiskScore',
        'opsAlertShopRiskAutoBanUserDurationDays',
        'opsAlertShopRiskAutoSuspendProductMinRiskScore'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = sharedControlState?.thresholdInputsDisabled ?? !shopRiskConfig.auto_response_enabled;
    });
}

function applyOpsAlertShopInventoryControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const inventoryConfig = normalizedConfig.shop_inventory || getDefaultOpsAlertConfig().shop_inventory;
    applyOpsAlertMonitorSectionControls(inventoryConfig, {
        enabledToggleId: 'opsAlertShopInventoryEnabledToggle',
        summaryToggleId: 'opsAlertShopInventorySummaryEnabledToggle',
        extraToggles: [
            {
                key: 'recovery_notification_enabled',
                id: 'opsAlertShopInventoryRecoveryNotificationEnabledToggle'
            }
        ],
        inputIds: [
            'opsAlertShopInventoryLowStockThreshold',
            'opsAlertShopInventorySweepIntervalMinutes',
            'opsAlertShopInventorySalesWindowDays',
            'opsAlertShopInventoryDedupeWindowMinutes'
        ],
        summaryFieldIds: {
            summaryScheduleMode: 'opsAlertShopInventorySummaryScheduleMode',
            summaryWindowMinutes: 'opsAlertShopInventorySummaryWindowMinutes',
            summaryHourlyMinute: 'opsAlertShopInventorySummaryHourlyMinute',
            summaryDailyHour: 'opsAlertShopInventorySummaryDailyHour',
            summaryDailyMinute: 'opsAlertShopInventorySummaryDailyMinute',
            summaryMaxItems: 'opsAlertShopInventorySummaryMaxItems'
        },
        sharedOptions: {
            summaryToggleDisabledWhenMonitorDisabled: true,
            extraToggleKeys: ['recovery_notification_enabled'],
            extraToggleDisabledWhenMonitorDisabledKeys: ['recovery_notification_enabled']
        }
    });
}

function applyOpsAlertSummaryModeControls(monitorConfig = {}, ids = {}) {
    const controlState = resolveOpsAlertSummaryModeControlState(monitorConfig);
    applyOpsAlertSummaryModeControlStateToDom(controlState, {
        ...ids,
        summaryModeHint: ids.summaryModeHint || `${ids.summaryScheduleMode || 'opsAlertSummaryMode'}Hint`
    }, {
        valueSource: {
            summary_schedule_mode: controlState.scheduleMode
        }
    });
}

function buildLocalOpsAlertMonitorControlState(monitorConfig = {}, sharedOptions = {}) {
    const monitorEnabled = monitorConfig?.enabled === true;
    const summaryToggleDisabledWhenMonitorDisabled = sharedOptions.summaryToggleDisabledWhenMonitorDisabled === true;
    const workHoursOnlyToggleDisabledWhenMonitorDisabled = sharedOptions.workHoursOnlyToggleDisabledWhenMonitorDisabled !== false;
    const extraToggleDisabledKeys = new Set(
        Array.isArray(sharedOptions.extraToggleDisabledWhenMonitorDisabledKeys)
            ? sharedOptions.extraToggleDisabledWhenMonitorDisabledKeys.filter(Boolean)
            : []
    );
    const extraToggleKeys = Array.isArray(sharedOptions.extraToggleKeys)
        ? sharedOptions.extraToggleKeys.filter(Boolean)
        : [];
    const extraToggles = {};
    extraToggleKeys.forEach((key) => {
        extraToggles[key] = {
            active: monitorConfig?.[key] === true,
            disabled: extraToggleDisabledKeys.has(key) ? !monitorEnabled : false
        };
    });

    return {
        enabledActive: monitorEnabled,
        inputsDisabled: !monitorEnabled,
        summaryToggle: {
            active: monitorConfig?.summary_enabled === true,
            disabled: summaryToggleDisabledWhenMonitorDisabled ? !monitorEnabled : false
        },
        workHoursOnlyToggle: {
            active: monitorConfig?.work_hours_only_enabled === true,
            disabled: workHoursOnlyToggleDisabledWhenMonitorDisabled ? !monitorEnabled : false
        },
        extraToggles
    };
}

function resolveOpsAlertMonitorControlStateBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertMonitorControlState',
        buildLocalOpsAlertMonitorControlState
    );
}

function resolveOpsAlertMonitorControlState(monitorConfig = {}, sharedOptions = {}) {
    return resolveOpsAlertMonitorControlStateBuilder()(monitorConfig, sharedOptions);
}

function applyOpsAlertMonitorToggleState(elementId, toggleState = {}, options = {}) {
    if (!elementId) {
        return;
    }
    const element = document.getElementById(elementId);
    if (!element) {
        return;
    }

    const resolvedActive = Object.prototype.hasOwnProperty.call(toggleState || {}, 'active')
        ? toggleState.active === true
        : options.fallbackActive === true;
    element.classList.toggle('active', resolvedActive);

    const hasDisabledState = Object.prototype.hasOwnProperty.call(toggleState || {}, 'disabled')
        || Object.prototype.hasOwnProperty.call(options, 'fallbackDisabled');
    if (hasDisabledState) {
        const resolvedDisabled = Object.prototype.hasOwnProperty.call(toggleState || {}, 'disabled')
            ? toggleState.disabled === true
            : options.fallbackDisabled === true;
        element.classList.toggle('disabled', resolvedDisabled);
    }
}

function applyOpsAlertMonitorInputsDisabled(inputIds = [], disabled = false) {
    inputIds.forEach((id) => {
        const input = document.getElementById(id);
        if (input) {
            input.disabled = disabled === true;
        }
    });
}

function applyOpsAlertMonitorSectionControls(monitorConfig = {}, options = {}) {
    const sharedOptions = options.sharedOptions && typeof options.sharedOptions === 'object'
        ? options.sharedOptions
        : {};
    const monitorEnabled = monitorConfig.enabled === true;
    const sharedMonitorState = resolveOpsAlertMonitorControlState(monitorConfig, sharedOptions);
    const extraToggleDisabledKeys = new Set(
        Array.isArray(sharedOptions.extraToggleDisabledWhenMonitorDisabledKeys)
            ? sharedOptions.extraToggleDisabledWhenMonitorDisabledKeys.filter(Boolean)
            : []
    );

    applyOpsAlertMonitorToggleState(options.enabledToggleId, {
        active: sharedMonitorState?.enabledActive
    }, {
        fallbackActive: monitorEnabled
    });
    applyOpsAlertMonitorToggleState(options.summaryToggleId, sharedMonitorState?.summaryToggle || {}, {
        fallbackActive: monitorConfig.summary_enabled === true,
        fallbackDisabled: sharedOptions.summaryToggleDisabledWhenMonitorDisabled === true ? !monitorEnabled : undefined
    });
    applyOpsAlertMonitorToggleState(options.workHoursOnlyToggleId, sharedMonitorState?.workHoursOnlyToggle || {}, {
        fallbackActive: monitorConfig.work_hours_only_enabled === true,
        fallbackDisabled: sharedOptions.workHoursOnlyToggleDisabledWhenMonitorDisabled !== false ? !monitorEnabled : undefined
    });

    (Array.isArray(options.extraToggles) ? options.extraToggles : []).forEach((entry) => {
        if (!entry?.id || !entry?.key) {
            return;
        }
        applyOpsAlertMonitorToggleState(entry.id, sharedMonitorState?.extraToggles?.[entry.key] || {}, {
            fallbackActive: monitorConfig[entry.key] === true,
            fallbackDisabled: extraToggleDisabledKeys.has(entry.key) ? !monitorEnabled : undefined
        });
    });

    applyOpsAlertMonitorInputsDisabled(options.inputIds, sharedMonitorState?.inputsDisabled ?? !monitorEnabled);

    if (options.summaryFieldIds) {
        applyOpsAlertSummaryModeControls(monitorConfig, options.summaryFieldIds);
    }

    return sharedMonitorState;
}

function applyAdminConfigFieldValue(field = {}) {
    const normalizedField = field && typeof field === 'object' && !Array.isArray(field) ? field : {};
    if (!normalizedField.id) return false;
    const input = document.getElementById(normalizedField.id);
    if (!input) return false;

    const transform = typeof normalizedField.transform === 'function'
        ? normalizedField.transform
        : ((value) => value);
    const fallback = Object.prototype.hasOwnProperty.call(normalizedField, 'fallback')
        ? normalizedField.fallback
        : '';
    const resolvedValue = transform(
        Object.prototype.hasOwnProperty.call(normalizedField, 'value') ? normalizedField.value : fallback,
        normalizedField
    );

    input.value = resolvedValue == null ? '' : String(resolvedValue);
    return true;
}

function applyAdminConfigFieldValues(fields = []) {
    (Array.isArray(fields) ? fields : []).forEach((field) => applyAdminConfigFieldValue(field));
}

function getOpsAlertMinutesFieldValue(value) {
    return Math.max(1, Math.round(Number(value || 0) / 60000));
}

function applyOpsAlertCustomerChatControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.customer_chat_message || getDefaultOpsAlertConfig().customer_chat_message;
    ensureOpsAlertCustomerChatQuickReplyTemplateEvents();
    renderOpsAlertCustomerChatQuickReplyTemplates(monitorConfig.quick_reply_templates);
    applyOpsAlertMonitorSectionControls(monitorConfig, {
        enabledToggleId: 'opsAlertCustomerChatMessageEnabledToggle',
        summaryToggleId: 'opsAlertCustomerChatMessageSummaryEnabledToggle',
        workHoursOnlyToggleId: 'opsAlertCustomerChatMessageWorkHoursOnlyEnabledToggle',
        inputIds: [
            'opsAlertCustomerChatMessageSweepIntervalMinutes',
            'opsAlertCustomerChatMessageLookbackMinutes',
            'opsAlertCustomerChatMessageDedupeWindowMinutes'
        ],
        summaryFieldIds: {
        summaryScheduleMode: 'opsAlertCustomerChatMessageSummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertCustomerChatMessageSummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertCustomerChatMessageSummaryHourlyMinute',
        summaryDailyHour: 'opsAlertCustomerChatMessageSummaryDailyHour',
        summaryDailyMinute: 'opsAlertCustomerChatMessageSummaryDailyMinute',
        summaryMaxItems: 'opsAlertCustomerChatMessageSummaryMaxItems'
        }
    });
}

function applyOpsAlertShopPurchaseSuccessControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.shop_purchase_success || getDefaultOpsAlertConfig().shop_purchase_success;
    applyOpsAlertMonitorSectionControls(monitorConfig, {
        enabledToggleId: 'opsAlertShopPurchaseSuccessEnabledToggle',
        summaryToggleId: 'opsAlertShopPurchaseSuccessSummaryEnabledToggle',
        workHoursOnlyToggleId: 'opsAlertShopPurchaseSuccessWorkHoursOnlyEnabledToggle',
        inputIds: [
            'opsAlertShopPurchaseSuccessSweepIntervalMinutes',
            'opsAlertShopPurchaseSuccessLookbackMinutes',
            'opsAlertShopPurchaseSuccessDedupeWindowMinutes'
        ],
        summaryFieldIds: {
        summaryScheduleMode: 'opsAlertShopPurchaseSuccessSummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertShopPurchaseSuccessSummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertShopPurchaseSuccessSummaryHourlyMinute',
        summaryDailyHour: 'opsAlertShopPurchaseSuccessSummaryDailyHour',
        summaryDailyMinute: 'opsAlertShopPurchaseSuccessSummaryDailyMinute',
        summaryMaxItems: 'opsAlertShopPurchaseSuccessSummaryMaxItems'
        }
    });
}

function applyOpsAlertWalletRechargeSuccessControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.wallet_recharge_success || getDefaultOpsAlertConfig().wallet_recharge_success;
    applyOpsAlertMonitorSectionControls(monitorConfig, {
        enabledToggleId: 'opsAlertWalletRechargeSuccessEnabledToggle',
        summaryToggleId: 'opsAlertWalletRechargeSuccessSummaryEnabledToggle',
        workHoursOnlyToggleId: 'opsAlertWalletRechargeSuccessWorkHoursOnlyEnabledToggle',
        inputIds: [
            'opsAlertWalletRechargeSuccessSweepIntervalMinutes',
            'opsAlertWalletRechargeSuccessLookbackMinutes',
            'opsAlertWalletRechargeSuccessDedupeWindowMinutes'
        ],
        summaryFieldIds: {
        summaryScheduleMode: 'opsAlertWalletRechargeSuccessSummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertWalletRechargeSuccessSummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertWalletRechargeSuccessSummaryHourlyMinute',
        summaryDailyHour: 'opsAlertWalletRechargeSuccessSummaryDailyHour',
        summaryDailyMinute: 'opsAlertWalletRechargeSuccessSummaryDailyMinute',
        summaryMaxItems: 'opsAlertWalletRechargeSuccessSummaryMaxItems'
        }
    });
}

function applyOpsAlertTicketsControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.tickets || getDefaultOpsAlertConfig().tickets;
    applyOpsAlertMonitorSectionControls(monitorConfig, {
        enabledToggleId: 'opsAlertTicketsEnabledToggle',
        summaryToggleId: 'opsAlertTicketsSummaryEnabledToggle',
        workHoursOnlyToggleId: 'opsAlertTicketsWorkHoursOnlyEnabledToggle',
        inputIds: [
            'opsAlertTicketsSweepIntervalMinutes',
            'opsAlertTicketsPendingOverdueMinutes',
            'opsAlertTicketsCriticalOverdueMinutes',
            'opsAlertTicketsStateLookbackMinutes',
            'opsAlertTicketsDedupeWindowMinutes'
        ],
        summaryFieldIds: {
        summaryScheduleMode: 'opsAlertTicketsSummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertTicketsSummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertTicketsSummaryHourlyMinute',
        summaryDailyHour: 'opsAlertTicketsSummaryDailyHour',
        summaryDailyMinute: 'opsAlertTicketsSummaryDailyMinute',
        summaryMaxItems: 'opsAlertTicketsSummaryMaxItems'
        }
    });
}

function applyOpsAlertShopOrderDeliveryControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.shop_order_delivery || getDefaultOpsAlertConfig().shop_order_delivery;
    applyOpsAlertMonitorSectionControls(monitorConfig, {
        enabledToggleId: 'opsAlertShopOrderDeliveryEnabledToggle',
        summaryToggleId: 'opsAlertShopOrderDeliverySummaryEnabledToggle',
        workHoursOnlyToggleId: 'opsAlertShopOrderDeliveryWorkHoursOnlyEnabledToggle',
        extraToggles: [
            {
                key: 'incident_enabled',
                id: 'opsAlertShopOrderDeliveryIncidentEnabledToggle'
            }
        ],
        inputIds: [
            'opsAlertShopOrderDeliveryLookbackDays',
            'opsAlertShopOrderDeliveryStateLookbackMinutes',
            'opsAlertShopOrderDeliveryRetryWaitingMinAttempts',
            'opsAlertShopOrderDeliverySweepIntervalMinutes',
            'opsAlertShopOrderDeliveryDedupeWindowMinutes',
            'opsAlertShopOrderDeliveryIncidentMinOrderCount',
            'opsAlertShopOrderDeliveryIncidentMinDeadLetterCount',
            'opsAlertShopOrderDeliveryIncidentMinDistinctUsers',
            'opsAlertShopOrderDeliveryIncidentDedupeWindowMinutes'
        ],
        summaryFieldIds: {
            summaryScheduleMode: 'opsAlertShopOrderDeliverySummaryScheduleMode',
            summaryWindowMinutes: 'opsAlertShopOrderDeliverySummaryWindowMinutes',
            summaryHourlyMinute: 'opsAlertShopOrderDeliverySummaryHourlyMinute',
            summaryDailyHour: 'opsAlertShopOrderDeliverySummaryDailyHour',
            summaryDailyMinute: 'opsAlertShopOrderDeliverySummaryDailyMinute',
            summaryMaxItems: 'opsAlertShopOrderDeliverySummaryMaxItems'
        },
        sharedOptions: {
            extraToggleKeys: ['incident_enabled'],
            extraToggleDisabledWhenMonitorDisabledKeys: ['incident_enabled']
        }
    });
}

function applyOpsAlertVerifyQuotaControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.verify_quota || getDefaultOpsAlertConfig().verify_quota;
    applyOpsAlertMonitorSectionControls(monitorConfig, {
        enabledToggleId: 'opsAlertVerifyQuotaEnabledToggle',
        summaryToggleId: 'opsAlertVerifyQuotaSummaryEnabledToggle',
        workHoursOnlyToggleId: 'opsAlertVerifyQuotaWorkHoursOnlyEnabledToggle',
        inputIds: [
            'opsAlertVerifyQuotaLowBalanceThreshold',
            'opsAlertVerifyQuotaLowRemainingJobsThreshold',
            'opsAlertVerifyQuotaCriticalBalanceThreshold',
            'opsAlertVerifyQuotaCriticalRemainingJobsThreshold',
            'opsAlertVerifyQuotaMinQueueBufferJobs',
            'opsAlertVerifyQuotaSweepIntervalMinutes',
            'opsAlertVerifyQuotaDedupeWindowMinutes'
        ],
        summaryFieldIds: {
        summaryScheduleMode: 'opsAlertVerifyQuotaSummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertVerifyQuotaSummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertVerifyQuotaSummaryHourlyMinute',
        summaryDailyHour: 'opsAlertVerifyQuotaSummaryDailyHour',
        summaryDailyMinute: 'opsAlertVerifyQuotaSummaryDailyMinute',
        summaryMaxItems: 'opsAlertVerifyQuotaSummaryMaxItems'
        }
    });
}

function applyOpsAlertVerifyQueueControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.verify_queue || getDefaultOpsAlertConfig().verify_queue;
    applyOpsAlertMonitorSectionControls(monitorConfig, {
        enabledToggleId: 'opsAlertVerifyQueueEnabledToggle',
        summaryToggleId: 'opsAlertVerifyQueueSummaryEnabledToggle',
        workHoursOnlyToggleId: 'opsAlertVerifyQueueWorkHoursOnlyEnabledToggle',
        inputIds: [
            'opsAlertVerifyQueueRecentActivityLookbackHours',
            'opsAlertVerifyQueueRecentFailureWindowMinutes',
            'opsAlertVerifyQueueSizeThreshold',
            'opsAlertVerifyQueueActiveJobThreshold',
            'opsAlertVerifyQueueOldestPendingMinutesThreshold',
            'opsAlertVerifyQueueRecentFailureThreshold',
            'opsAlertVerifyQueueSweepIntervalMinutes',
            'opsAlertVerifyQueueDedupeWindowMinutes'
        ],
        summaryFieldIds: {
        summaryScheduleMode: 'opsAlertVerifyQueueSummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertVerifyQueueSummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertVerifyQueueSummaryHourlyMinute',
        summaryDailyHour: 'opsAlertVerifyQueueSummaryDailyHour',
        summaryDailyMinute: 'opsAlertVerifyQueueSummaryDailyMinute',
        summaryMaxItems: 'opsAlertVerifyQueueSummaryMaxItems'
        }
    });
}

function applyOpsAlertVerifyFailureControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.verify_failure || getDefaultOpsAlertConfig().verify_failure;
    applyOpsAlertMonitorSectionControls(monitorConfig, {
        enabledToggleId: 'opsAlertVerifyFailureEnabledToggle',
        summaryToggleId: 'opsAlertVerifyFailureSummaryEnabledToggle',
        workHoursOnlyToggleId: 'opsAlertVerifyFailureWorkHoursOnlyEnabledToggle',
        inputIds: [
            'opsAlertVerifyFailureRecentWindowMinutes',
            'opsAlertVerifyFailureMinTotalJobsThreshold',
            'opsAlertVerifyFailureRateThreshold',
            'opsAlertVerifyFailureAffectedUserThreshold',
            'opsAlertVerifyFailureSweepIntervalMinutes',
            'opsAlertVerifyFailureDedupeWindowMinutes'
        ],
        summaryFieldIds: {
        summaryScheduleMode: 'opsAlertVerifyFailureSummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertVerifyFailureSummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertVerifyFailureSummaryHourlyMinute',
        summaryDailyHour: 'opsAlertVerifyFailureSummaryDailyHour',
        summaryDailyMinute: 'opsAlertVerifyFailureSummaryDailyMinute',
        summaryMaxItems: 'opsAlertVerifyFailureSummaryMaxItems'
        }
    });
}

function applyOpsAlertPaymentGatewayControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.payment_gateway || getDefaultOpsAlertConfig().payment_gateway;
    applyOpsAlertMonitorSectionControls(monitorConfig, {
        enabledToggleId: 'opsAlertPaymentGatewayEnabledToggle',
        summaryToggleId: 'opsAlertPaymentGatewaySummaryEnabledToggle',
        workHoursOnlyToggleId: 'opsAlertPaymentGatewayWorkHoursOnlyEnabledToggle',
        inputIds: [
            'opsAlertPaymentGatewayWindowMinutes',
            'opsAlertPaymentGatewayFailedOrdersThreshold',
            'opsAlertPaymentGatewayFailedRatioThreshold',
            'opsAlertPaymentGatewayWebhookSuccessRateThreshold',
            'opsAlertPaymentGatewayQuerySuccessRateThreshold',
            'opsAlertPaymentGatewayWebhook5xxThreshold',
            'opsAlertPaymentGatewayQuery5xxThreshold',
            'opsAlertPaymentGatewaySweepIntervalMinutes',
            'opsAlertPaymentGatewayDedupeWindowMinutes'
        ],
        summaryFieldIds: {
        summaryScheduleMode: 'opsAlertPaymentGatewaySummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertPaymentGatewaySummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertPaymentGatewaySummaryHourlyMinute',
        summaryDailyHour: 'opsAlertPaymentGatewaySummaryDailyHour',
        summaryDailyMinute: 'opsAlertPaymentGatewaySummaryDailyMinute',
        summaryMaxItems: 'opsAlertPaymentGatewaySummaryMaxItems'
        }
    });
}

function buildOpsAlertSettingsFieldGroups(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    return [
        [
            { id: 'opsAlertQuietHoursStartHour', value: normalizedConfig.quiet_hours.start_hour },
            { id: 'opsAlertQuietHoursEndHour', value: normalizedConfig.quiet_hours.end_hour },
            { id: 'opsAlertQuietHoursTimezone', value: normalizedConfig.quiet_hours.timezone },
            { id: 'opsAlertWorkHoursStartHour', value: normalizedConfig.work_hours.start_hour },
            { id: 'opsAlertWorkHoursEndHour', value: normalizedConfig.work_hours.end_hour },
            { id: 'opsAlertWorkHoursTimezone', value: normalizedConfig.work_hours.timezone },
            { id: 'opsAlertTelegramChatIds', value: normalizedConfig.channels.telegram.chat_ids, transform: (value) => (Array.isArray(value) ? value.join('\n') : '') },
            { id: 'opsAlertTelegramSeverity', value: normalizedConfig.channels.telegram.minimum_severity },
            { id: 'opsAlertFeishuSeverity', value: normalizedConfig.channels.feishu.minimum_severity },
            { id: 'opsAlertEmailSeverity', value: normalizedConfig.channels.email.minimum_severity },
            { id: 'opsAlertEmailRecipients', value: normalizedConfig.channels.email.recipients, transform: (value) => (Array.isArray(value) ? value.join('\n') : '') },
            { id: 'opsAlertEmailFromAddress', value: normalizedConfig.channels.email.from_address },
            { id: 'opsAlertEmailReplyTo', value: normalizedConfig.channels.email.reply_to },
            { id: 'opsAlertEmailSubjectPrefix', value: normalizedConfig.channels.email.subject_prefix },
            { id: 'opsAlertShopRiskAutoDisableCouponMinRiskScore', value: normalizedConfig.shop_order_risk.auto_disable_coupon_min_risk_score },
            { id: 'opsAlertShopRiskAutoBanUserMinRiskScore', value: normalizedConfig.shop_order_risk.auto_ban_user_min_risk_score },
            { id: 'opsAlertShopRiskAutoBanUserDurationDays', value: normalizedConfig.shop_order_risk.auto_ban_user_duration_days },
            { id: 'opsAlertShopRiskAutoSuspendProductMinRiskScore', value: normalizedConfig.shop_order_risk.auto_suspend_product_min_risk_score }
        ],
        [
            { id: 'opsAlertShopInventoryLowStockThreshold', value: normalizedConfig.shop_inventory.low_stock_threshold },
            { id: 'opsAlertShopInventorySweepIntervalMinutes', value: normalizedConfig.shop_inventory.sweep_interval_ms, transform: getOpsAlertMinutesFieldValue },
            { id: 'opsAlertShopInventorySalesWindowDays', value: normalizedConfig.shop_inventory.sales_window_days },
            { id: 'opsAlertShopInventoryDedupeWindowMinutes', value: normalizedConfig.shop_inventory.dedupe_window_minutes },
            { id: 'opsAlertShopInventorySummaryWindowMinutes', value: normalizedConfig.shop_inventory.summary_window_minutes },
            { id: 'opsAlertShopInventorySummaryScheduleMode', value: normalizedConfig.shop_inventory.summary_schedule_mode },
            { id: 'opsAlertShopInventorySummaryHourlyMinute', value: normalizedConfig.shop_inventory.summary_hourly_minute },
            { id: 'opsAlertShopInventorySummaryDailyHour', value: normalizedConfig.shop_inventory.summary_daily_hour },
            { id: 'opsAlertShopInventorySummaryDailyMinute', value: normalizedConfig.shop_inventory.summary_daily_minute },
            { id: 'opsAlertShopInventorySummaryMaxItems', value: normalizedConfig.shop_inventory.summary_max_items }
        ],
        [
            { id: 'opsAlertCustomerChatMessageSweepIntervalMinutes', value: normalizedConfig.customer_chat_message.sweep_interval_ms, transform: getOpsAlertMinutesFieldValue },
            { id: 'opsAlertCustomerChatMessageLookbackMinutes', value: normalizedConfig.customer_chat_message.lookback_minutes },
            { id: 'opsAlertCustomerChatMessageDedupeWindowMinutes', value: normalizedConfig.customer_chat_message.dedupe_window_minutes },
            { id: 'opsAlertCustomerChatMessageSummaryWindowMinutes', value: normalizedConfig.customer_chat_message.summary_window_minutes },
            { id: 'opsAlertCustomerChatMessageSummaryScheduleMode', value: normalizedConfig.customer_chat_message.summary_schedule_mode },
            { id: 'opsAlertCustomerChatMessageSummaryHourlyMinute', value: normalizedConfig.customer_chat_message.summary_hourly_minute },
            { id: 'opsAlertCustomerChatMessageSummaryDailyHour', value: normalizedConfig.customer_chat_message.summary_daily_hour },
            { id: 'opsAlertCustomerChatMessageSummaryDailyMinute', value: normalizedConfig.customer_chat_message.summary_daily_minute },
            { id: 'opsAlertCustomerChatMessageSummaryMaxItems', value: normalizedConfig.customer_chat_message.summary_max_items }
        ],
        [
            { id: 'opsAlertShopPurchaseSuccessSweepIntervalMinutes', value: normalizedConfig.shop_purchase_success.sweep_interval_ms, transform: getOpsAlertMinutesFieldValue },
            { id: 'opsAlertShopPurchaseSuccessLookbackMinutes', value: normalizedConfig.shop_purchase_success.lookback_minutes },
            { id: 'opsAlertShopPurchaseSuccessDedupeWindowMinutes', value: normalizedConfig.shop_purchase_success.dedupe_window_minutes },
            { id: 'opsAlertShopPurchaseSuccessSummaryWindowMinutes', value: normalizedConfig.shop_purchase_success.summary_window_minutes },
            { id: 'opsAlertShopPurchaseSuccessSummaryScheduleMode', value: normalizedConfig.shop_purchase_success.summary_schedule_mode },
            { id: 'opsAlertShopPurchaseSuccessSummaryHourlyMinute', value: normalizedConfig.shop_purchase_success.summary_hourly_minute },
            { id: 'opsAlertShopPurchaseSuccessSummaryDailyHour', value: normalizedConfig.shop_purchase_success.summary_daily_hour },
            { id: 'opsAlertShopPurchaseSuccessSummaryDailyMinute', value: normalizedConfig.shop_purchase_success.summary_daily_minute },
            { id: 'opsAlertShopPurchaseSuccessSummaryMaxItems', value: normalizedConfig.shop_purchase_success.summary_max_items }
        ],
        [
            { id: 'opsAlertWalletRechargeSuccessSweepIntervalMinutes', value: normalizedConfig.wallet_recharge_success.sweep_interval_ms, transform: getOpsAlertMinutesFieldValue },
            { id: 'opsAlertWalletRechargeSuccessLookbackMinutes', value: normalizedConfig.wallet_recharge_success.lookback_minutes },
            { id: 'opsAlertWalletRechargeSuccessDedupeWindowMinutes', value: normalizedConfig.wallet_recharge_success.dedupe_window_minutes },
            { id: 'opsAlertWalletRechargeSuccessSummaryWindowMinutes', value: normalizedConfig.wallet_recharge_success.summary_window_minutes },
            { id: 'opsAlertWalletRechargeSuccessSummaryScheduleMode', value: normalizedConfig.wallet_recharge_success.summary_schedule_mode },
            { id: 'opsAlertWalletRechargeSuccessSummaryHourlyMinute', value: normalizedConfig.wallet_recharge_success.summary_hourly_minute },
            { id: 'opsAlertWalletRechargeSuccessSummaryDailyHour', value: normalizedConfig.wallet_recharge_success.summary_daily_hour },
            { id: 'opsAlertWalletRechargeSuccessSummaryDailyMinute', value: normalizedConfig.wallet_recharge_success.summary_daily_minute },
            { id: 'opsAlertWalletRechargeSuccessSummaryMaxItems', value: normalizedConfig.wallet_recharge_success.summary_max_items }
        ],
        [
            { id: 'opsAlertTicketsSweepIntervalMinutes', value: normalizedConfig.tickets.sweep_interval_ms, transform: getOpsAlertMinutesFieldValue },
            { id: 'opsAlertTicketsPendingOverdueMinutes', value: normalizedConfig.tickets.pending_overdue_minutes },
            { id: 'opsAlertTicketsCriticalOverdueMinutes', value: normalizedConfig.tickets.critical_overdue_minutes },
            { id: 'opsAlertTicketsStateLookbackMinutes', value: normalizedConfig.tickets.state_lookback_minutes },
            { id: 'opsAlertTicketsDedupeWindowMinutes', value: normalizedConfig.tickets.dedupe_window_minutes },
            { id: 'opsAlertTicketsSummaryWindowMinutes', value: normalizedConfig.tickets.summary_window_minutes },
            { id: 'opsAlertTicketsSummaryScheduleMode', value: normalizedConfig.tickets.summary_schedule_mode },
            { id: 'opsAlertTicketsSummaryHourlyMinute', value: normalizedConfig.tickets.summary_hourly_minute },
            { id: 'opsAlertTicketsSummaryDailyHour', value: normalizedConfig.tickets.summary_daily_hour },
            { id: 'opsAlertTicketsSummaryDailyMinute', value: normalizedConfig.tickets.summary_daily_minute },
            { id: 'opsAlertTicketsSummaryMaxItems', value: normalizedConfig.tickets.summary_max_items }
        ],
        [
            { id: 'opsAlertShopOrderDeliveryLookbackDays', value: normalizedConfig.shop_order_delivery.lookback_days },
            { id: 'opsAlertShopOrderDeliveryStateLookbackMinutes', value: normalizedConfig.shop_order_delivery.state_lookback_minutes },
            { id: 'opsAlertShopOrderDeliveryRetryWaitingMinAttempts', value: normalizedConfig.shop_order_delivery.retry_waiting_min_attempts },
            { id: 'opsAlertShopOrderDeliverySweepIntervalMinutes', value: normalizedConfig.shop_order_delivery.sweep_interval_ms, transform: getOpsAlertMinutesFieldValue },
            { id: 'opsAlertShopOrderDeliveryDedupeWindowMinutes', value: normalizedConfig.shop_order_delivery.dedupe_window_minutes },
            { id: 'opsAlertShopOrderDeliveryIncidentMinOrderCount', value: normalizedConfig.shop_order_delivery.incident_min_order_count },
            { id: 'opsAlertShopOrderDeliveryIncidentMinDeadLetterCount', value: normalizedConfig.shop_order_delivery.incident_min_dead_letter_count },
            { id: 'opsAlertShopOrderDeliveryIncidentMinDistinctUsers', value: normalizedConfig.shop_order_delivery.incident_min_distinct_users },
            { id: 'opsAlertShopOrderDeliveryIncidentDedupeWindowMinutes', value: normalizedConfig.shop_order_delivery.incident_dedupe_window_minutes },
            { id: 'opsAlertShopOrderDeliverySummaryWindowMinutes', value: normalizedConfig.shop_order_delivery.summary_window_minutes },
            { id: 'opsAlertShopOrderDeliverySummaryScheduleMode', value: normalizedConfig.shop_order_delivery.summary_schedule_mode },
            { id: 'opsAlertShopOrderDeliverySummaryHourlyMinute', value: normalizedConfig.shop_order_delivery.summary_hourly_minute },
            { id: 'opsAlertShopOrderDeliverySummaryDailyHour', value: normalizedConfig.shop_order_delivery.summary_daily_hour },
            { id: 'opsAlertShopOrderDeliverySummaryDailyMinute', value: normalizedConfig.shop_order_delivery.summary_daily_minute },
            { id: 'opsAlertShopOrderDeliverySummaryMaxItems', value: normalizedConfig.shop_order_delivery.summary_max_items }
        ],
        [
            { id: 'opsAlertVerifyQuotaLowBalanceThreshold', value: normalizedConfig.verify_quota.low_balance_threshold },
            { id: 'opsAlertVerifyQuotaLowRemainingJobsThreshold', value: normalizedConfig.verify_quota.low_remaining_jobs_threshold },
            { id: 'opsAlertVerifyQuotaCriticalBalanceThreshold', value: normalizedConfig.verify_quota.critical_balance_threshold },
            { id: 'opsAlertVerifyQuotaCriticalRemainingJobsThreshold', value: normalizedConfig.verify_quota.critical_remaining_jobs_threshold },
            { id: 'opsAlertVerifyQuotaMinQueueBufferJobs', value: normalizedConfig.verify_quota.min_queue_buffer_jobs },
            { id: 'opsAlertVerifyQuotaSweepIntervalMinutes', value: normalizedConfig.verify_quota.sweep_interval_ms, transform: getOpsAlertMinutesFieldValue },
            { id: 'opsAlertVerifyQuotaDedupeWindowMinutes', value: normalizedConfig.verify_quota.dedupe_window_minutes },
            { id: 'opsAlertVerifyQuotaSummaryWindowMinutes', value: normalizedConfig.verify_quota.summary_window_minutes },
            { id: 'opsAlertVerifyQuotaSummaryScheduleMode', value: normalizedConfig.verify_quota.summary_schedule_mode },
            { id: 'opsAlertVerifyQuotaSummaryHourlyMinute', value: normalizedConfig.verify_quota.summary_hourly_minute },
            { id: 'opsAlertVerifyQuotaSummaryDailyHour', value: normalizedConfig.verify_quota.summary_daily_hour },
            { id: 'opsAlertVerifyQuotaSummaryDailyMinute', value: normalizedConfig.verify_quota.summary_daily_minute },
            { id: 'opsAlertVerifyQuotaSummaryMaxItems', value: normalizedConfig.verify_quota.summary_max_items }
        ],
        [
            { id: 'opsAlertVerifyQueueRecentActivityLookbackHours', value: normalizedConfig.verify_queue.recent_activity_lookback_hours },
            { id: 'opsAlertVerifyQueueRecentFailureWindowMinutes', value: normalizedConfig.verify_queue.recent_failure_window_minutes },
            { id: 'opsAlertVerifyQueueSizeThreshold', value: normalizedConfig.verify_queue.queue_size_threshold },
            { id: 'opsAlertVerifyQueueActiveJobThreshold', value: normalizedConfig.verify_queue.active_job_threshold },
            { id: 'opsAlertVerifyQueueOldestPendingMinutesThreshold', value: normalizedConfig.verify_queue.oldest_pending_minutes_threshold },
            { id: 'opsAlertVerifyQueueRecentFailureThreshold', value: normalizedConfig.verify_queue.recent_failure_threshold },
            { id: 'opsAlertVerifyQueueSweepIntervalMinutes', value: normalizedConfig.verify_queue.sweep_interval_ms, transform: getOpsAlertMinutesFieldValue },
            { id: 'opsAlertVerifyQueueDedupeWindowMinutes', value: normalizedConfig.verify_queue.dedupe_window_minutes },
            { id: 'opsAlertVerifyQueueSummaryWindowMinutes', value: normalizedConfig.verify_queue.summary_window_minutes },
            { id: 'opsAlertVerifyQueueSummaryScheduleMode', value: normalizedConfig.verify_queue.summary_schedule_mode },
            { id: 'opsAlertVerifyQueueSummaryHourlyMinute', value: normalizedConfig.verify_queue.summary_hourly_minute },
            { id: 'opsAlertVerifyQueueSummaryDailyHour', value: normalizedConfig.verify_queue.summary_daily_hour },
            { id: 'opsAlertVerifyQueueSummaryDailyMinute', value: normalizedConfig.verify_queue.summary_daily_minute },
            { id: 'opsAlertVerifyQueueSummaryMaxItems', value: normalizedConfig.verify_queue.summary_max_items }
        ],
        [
            { id: 'opsAlertVerifyFailureRecentWindowMinutes', value: normalizedConfig.verify_failure.recent_window_minutes },
            { id: 'opsAlertVerifyFailureMinTotalJobsThreshold', value: normalizedConfig.verify_failure.min_total_jobs_threshold },
            { id: 'opsAlertVerifyFailureRateThreshold', value: normalizedConfig.verify_failure.failure_rate_threshold },
            { id: 'opsAlertVerifyFailureAffectedUserThreshold', value: normalizedConfig.verify_failure.affected_user_threshold },
            { id: 'opsAlertVerifyFailureSweepIntervalMinutes', value: normalizedConfig.verify_failure.sweep_interval_ms, transform: getOpsAlertMinutesFieldValue },
            { id: 'opsAlertVerifyFailureDedupeWindowMinutes', value: normalizedConfig.verify_failure.dedupe_window_minutes },
            { id: 'opsAlertVerifyFailureSummaryWindowMinutes', value: normalizedConfig.verify_failure.summary_window_minutes },
            { id: 'opsAlertVerifyFailureSummaryScheduleMode', value: normalizedConfig.verify_failure.summary_schedule_mode },
            { id: 'opsAlertVerifyFailureSummaryHourlyMinute', value: normalizedConfig.verify_failure.summary_hourly_minute },
            { id: 'opsAlertVerifyFailureSummaryDailyHour', value: normalizedConfig.verify_failure.summary_daily_hour },
            { id: 'opsAlertVerifyFailureSummaryDailyMinute', value: normalizedConfig.verify_failure.summary_daily_minute },
            { id: 'opsAlertVerifyFailureSummaryMaxItems', value: normalizedConfig.verify_failure.summary_max_items }
        ],
        [
            { id: 'opsAlertPaymentGatewayWindowMinutes', value: normalizedConfig.payment_gateway.window_minutes },
            { id: 'opsAlertPaymentGatewayFailedOrdersThreshold', value: normalizedConfig.payment_gateway.min_failed_orders },
            { id: 'opsAlertPaymentGatewayFailedRatioThreshold', value: normalizedConfig.payment_gateway.min_failed_ratio_percent },
            { id: 'opsAlertPaymentGatewayWebhookSuccessRateThreshold', value: normalizedConfig.payment_gateway.max_webhook_success_rate_percent },
            { id: 'opsAlertPaymentGatewayQuerySuccessRateThreshold', value: normalizedConfig.payment_gateway.max_query_success_rate_percent },
            { id: 'opsAlertPaymentGatewayWebhook5xxThreshold', value: normalizedConfig.payment_gateway.min_webhook_5xx_count },
            { id: 'opsAlertPaymentGatewayQuery5xxThreshold', value: normalizedConfig.payment_gateway.min_query_5xx_count },
            { id: 'opsAlertPaymentGatewaySweepIntervalMinutes', value: normalizedConfig.payment_gateway.sweep_interval_ms, transform: getOpsAlertMinutesFieldValue },
            { id: 'opsAlertPaymentGatewayDedupeWindowMinutes', value: normalizedConfig.payment_gateway.dedupe_window_minutes },
            { id: 'opsAlertPaymentGatewaySummaryWindowMinutes', value: normalizedConfig.payment_gateway.summary_window_minutes },
            { id: 'opsAlertPaymentGatewaySummaryScheduleMode', value: normalizedConfig.payment_gateway.summary_schedule_mode },
            { id: 'opsAlertPaymentGatewaySummaryHourlyMinute', value: normalizedConfig.payment_gateway.summary_hourly_minute },
            { id: 'opsAlertPaymentGatewaySummaryDailyHour', value: normalizedConfig.payment_gateway.summary_daily_hour },
            { id: 'opsAlertPaymentGatewaySummaryDailyMinute', value: normalizedConfig.payment_gateway.summary_daily_minute },
            { id: 'opsAlertPaymentGatewaySummaryMaxItems', value: normalizedConfig.payment_gateway.summary_max_items }
        ]
    ];
}

function applyOpsAlertSettingsFieldGroups(fieldGroups = []) {
    (Array.isArray(fieldGroups) ? fieldGroups : []).forEach((fieldGroup) => {
        applyAdminConfigFieldValues(fieldGroup);
    });
    return fieldGroups;
}

function renderOpsAlertSettings() {
    ensureOpsAlertStrategyLayout();
    opsAlertUnifiedSummaryDraftDirty = false;
    const config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts']);
    applyOpsAlertSettingsFieldGroups(buildOpsAlertSettingsFieldGroups(config));

    applyOpsAlertOverview(config);
}

function setOpsAlertOverviewCardTone(card, tone = 'neutral') {
    if (!card) return;
    OPS_ALERT_OVERVIEW_CARD_TONE_CLASSES.forEach((className) => card.classList.remove(className));
    if (tone !== 'neutral') {
        card.classList.add(`ops-alert-overview-card--${tone}`);
    }
}

function setOpsAlertOverviewBannerTone(banner, tone = 'neutral') {
    if (!banner) return;
    banner.classList.add('ops-alert-overview-banner');
    OPS_ALERT_OVERVIEW_BANNER_TONE_CLASSES.forEach((className) => banner.classList.remove(className));
    banner.classList.add(`ops-alert-overview-banner--${tone}`);
}

function buildOpsAlertOverviewEmptyMarkup(message) {
    return `<div class="ops-alert-overview-empty">${escapeConfigHtml(message || '暂无数据')}</div>`;
}

function buildOpsAlertOverviewListMarkup(items = [], options = {}) {
    const normalizedItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!normalizedItems.length) {
        return buildOpsAlertOverviewEmptyMarkup(options.emptyMessage || '暂无数据');
    }

    return `
        <div class="ops-alert-overview-list${options.compact ? ' ops-alert-overview-list--compact' : ''}">
            ${normalizedItems.map((item) => {
                const tone = String(item?.tone || 'neutral').trim().toLowerCase();
                const toneClass = tone && tone !== 'neutral'
                    ? ` ops-alert-overview-list__item--${escapeConfigHtml(tone)}`
                    : '';
                const badges = [];
                if (item?.severityLabel) {
                    badges.push(buildOpsAlertHealthBadge(item.severityLabel, 'neutral'));
                }
                if (item?.statusLabel) {
                    badges.push(buildOpsAlertHealthBadge(item.statusLabel, item.statusTone || tone || 'neutral'));
                }

                return `
                    <div class="ops-alert-overview-list__item${toneClass}">
                        <div class="ops-alert-overview-list__top">
                            <strong class="ops-alert-overview-list__label">${escapeConfigHtml(item?.label || '—')}</strong>
                            ${badges.length ? `<div class="ops-alert-overview-list__badges">${badges.join('')}</div>` : ''}
                        </div>
                        ${item?.value ? `<div class="ops-alert-overview-list__value" title="${escapeConfigHtml(item.value)}">${escapeConfigHtml(item.value)}</div>` : ''}
                        ${item?.meta ? `<div class="ops-alert-overview-list__meta">${escapeConfigHtml(item.meta)}</div>` : ''}
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function buildOpsAlertOverviewMetricMarkup(items = []) {
    const normalizedItems = Array.isArray(items)
        ? items.filter((item) => item && item.label && item.value != null && item.value !== '')
        : [];
    if (!normalizedItems.length) {
        return '';
    }

    return `
        <div class="ops-alert-overview-metrics">
            ${normalizedItems.map((item) => `
                <div class="ops-alert-overview-metric">
                    <span>${escapeConfigHtml(item.label)}</span>
                    <strong title="${escapeConfigHtml(item.value)}">${escapeConfigHtml(item.value)}</strong>
                </div>
            `).join('')}
        </div>
    `;
}

function buildOpsAlertOverviewKeyValueMarkup(items = [], options = {}) {
    const normalizedItems = Array.isArray(items)
        ? items.filter((item) => item && (item.label || item.value))
        : [];
    if (!normalizedItems.length) {
        return options.emptyMessage ? buildOpsAlertOverviewEmptyMarkup(options.emptyMessage) : '';
    }

    return `
        <div class="ops-alert-overview-kv-list${options.compact ? ' ops-alert-overview-kv-list--compact' : ''}">
            ${normalizedItems.map((item) => {
                const tone = String(item?.tone || 'neutral').trim().toLowerCase();
                const toneClass = tone && tone !== 'neutral'
                    ? ` ops-alert-overview-kv--${escapeConfigHtml(tone)}`
                    : '';
                return `
                    <div class="ops-alert-overview-kv${toneClass}">
                        <span class="ops-alert-overview-kv__label">${escapeConfigHtml(item?.label || '—')}</span>
                        <strong class="ops-alert-overview-kv__value" title="${escapeConfigHtml(item?.value || '—')}">${escapeConfigHtml(item?.value || '—')}</strong>
                        ${item?.meta ? `<em class="ops-alert-overview-kv__meta">${escapeConfigHtml(item.meta)}</em>` : ''}
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function buildOpsAlertOverviewBannerMarkupFromState(sharedBannerState = {}, healthState = opsAlertHealthState || getDefaultOpsAlertHealthState()) {
    const tone = sharedBannerState.tone || 'neutral';
    const icon = sharedBannerState.icon || 'fa-bell-slash';
    const headline = sharedBannerState.headline || '站外告警未启用';
    const detailText = sharedBannerState.detailText || '';
    const badgeItems = Array.isArray(sharedBannerState.badgeItems) ? sharedBannerState.badgeItems : [];
    const canSendTest = sharedBannerState.canSendTest === true;
    const testButtonTitle = sharedBannerState.testButtonTitle || '请先启用站外告警';
    const badges = badgeItems.map((item) => buildOpsAlertHealthBadge(item?.label || '—', item?.tone || 'neutral'));
    const fetchedAt = sharedBannerState.fetchedAt || healthState?.fetched_at || '';

    return {
        tone,
        markup: `
            <div class="ops-alert-overview-banner__icon">
                <i class="fas ${escapeConfigHtml(icon)}"></i>
            </div>
            <div class="ops-alert-overview-banner__content">
                <div class="ops-alert-overview-banner__headline">${escapeConfigHtml(headline)}</div>
                <div class="ops-alert-overview-banner__meta">${badges.join('')}</div>
                <div class="ops-alert-overview-banner__detail">${escapeConfigHtml(detailText)}</div>
                ${fetchedAt ? `<div class="ops-alert-overview-banner__stamp">刷新于 ${escapeConfigHtml(formatVerifyMonitorDateTime(fetchedAt))}</div>` : ''}
            </div>
            <div class="ops-alert-overview-banner__actions">
                <button type="button" class="btn-add-config btn-add-config--compact btn-add-config--ghost" data-admin-action="settings-scroll-ops-alert-health">
                    查看健康页
                </button>
                <button
                    type="button"
                    class="btn-add-config btn-add-config--compact"
                    data-admin-action="settings-send-ops-alert-telegram-test"
                    title="${escapeConfigHtml(testButtonTitle)}"
                    ${canSendTest ? '' : 'disabled'}
                >
                    发送测试告警
                </button>
            </div>
        `
    };
}

function applyOpsAlertOverviewBannerMarkupState(markupState = {}, summaryEl = null) {
    if (!summaryEl) return markupState;
    setOpsAlertOverviewBannerTone(summaryEl, markupState.tone || 'neutral');
    summaryEl.innerHTML = markupState.markup || '';
    return markupState;
}

function renderOpsAlertOverviewBanner(overviewStatus, healthState = opsAlertHealthState || getDefaultOpsAlertHealthState(), precomputedBannerState = null) {
    const summaryEl = document.getElementById('opsAlertSummary');
    if (!summaryEl) {
        return;
    }

    const sharedBannerState = precomputedBannerState || resolveOpsAlertOverviewBannerState(overviewStatus, healthState);
    applyOpsAlertOverviewBannerMarkupState(
        buildOpsAlertOverviewBannerMarkupFromState(sharedBannerState, healthState),
        summaryEl
    );
}

function updateOpsAlertOverviewCard(cardId, titleId, bodyId, tone, titleText, bodyMarkup) {
    const card = document.getElementById(cardId);
    const titleEl = document.getElementById(titleId);
    const bodyEl = document.getElementById(bodyId);
    setOpsAlertOverviewCardTone(card, tone);
    if (titleEl) titleEl.textContent = titleText;
    if (bodyEl) bodyEl.innerHTML = bodyMarkup;
}

function buildOpsAlertOverviewCardBodyMarkup(cardState = {}, options = {}) {
    const normalizedCardState = cardState && typeof cardState === 'object' && !Array.isArray(cardState)
        ? cardState
        : {};
    const parts = [];
    const listItems = Array.isArray(normalizedCardState.items) ? normalizedCardState.items.filter(Boolean) : [];
    const metrics = Array.isArray(normalizedCardState.metrics) ? normalizedCardState.metrics.filter(Boolean) : [];
    const detailRows = Array.isArray(normalizedCardState.detailRows) ? normalizedCardState.detailRows.filter(Boolean) : [];

    if (listItems.length || options.renderListWhenEmpty === true) {
        parts.push(buildOpsAlertOverviewListMarkup(listItems, {
            compact: normalizedCardState.compact !== false,
            emptyMessage: options.listEmptyMessage || options.emptyMessage || '暂无数据'
        }));
    }
    if (metrics.length) {
        parts.push(buildOpsAlertOverviewMetricMarkup(metrics));
    }
    if (detailRows.length) {
        parts.push(buildOpsAlertOverviewKeyValueMarkup(detailRows, {
            compact: normalizedCardState.detailRowsCompact === true
        }));
    }
    if (normalizedCardState.emptyMessage) {
        parts.push(buildOpsAlertOverviewEmptyMarkup(normalizedCardState.emptyMessage));
    }

    return parts.join('') || buildOpsAlertOverviewEmptyMarkup(options.emptyMessage || '暂无数据');
}

function buildLocalOpsAlertOverviewRenderState(overviewStatus = {}, healthState = opsAlertHealthState || getDefaultOpsAlertHealthState()) {
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
    const normalizedHealthState = healthState && typeof healthState === 'object' && !Array.isArray(healthState)
        ? healthState
        : {};
    const summary = normalizedHealthState.summary && typeof normalizedHealthState.summary === 'object' && !Array.isArray(normalizedHealthState.summary)
        ? normalizedHealthState.summary
        : getDefaultOpsAlertHealthState().summary;
    const totalAttemptCount = Math.max(0, Number(summary.total_attempt_count || 0));
    const failedCount = Math.max(0, Number(summary.failed_count || 0));
    const deadLetterCount = Math.max(0, Number(summary.dead_letter_count || 0));

    let bannerTone = 'neutral';
    let bannerIcon = 'fa-bell-slash';
    let bannerHeadline = '站外告警未启用';
    if (normalizedConfig.enabled === true && enabledChannelCount === 0) {
        bannerTone = 'warning';
        bannerIcon = 'fa-triangle-exclamation';
        bannerHeadline = '站外告警已启用，但还没有打开外部通道';
    } else if (deadLetterCount > 0) {
        bannerTone = 'danger';
        bannerIcon = 'fa-circle-exclamation';
        bannerHeadline = '站外告警存在死信，建议优先处理异常通道';
    } else if (normalizedConfig.enabled === true && (failedCount > 0 || deliveryIssues.length > 0 || readyChannelCount < enabledChannelCount)) {
        bannerTone = 'warning';
        bannerIcon = 'fa-triangle-exclamation';
        bannerHeadline = '站外告警已启用，但部分通道仍需要关注';
    } else if (normalizedConfig.enabled === true && enabledChannelCount > 0) {
        bannerTone = 'success';
        bannerIcon = 'fa-satellite-dish';
        bannerHeadline = '站外告警已启用，当前通道可正常投递';
    }

    return {
        bannerState: {
            tone: bannerTone,
            icon: bannerIcon,
            headline: bannerHeadline,
            detailText: normalizedConfig.enabled === true
                ? '发送采用异步队列，不阻塞退款主流程。'
                : '退款和异常消息仍会保留在站内后台。',
            badgeItems: [
                {
                    label: normalizedConfig.enabled ? '已启用' : '未启用',
                    tone: normalizedConfig.enabled ? (bannerTone === 'neutral' ? 'success' : bannerTone) : 'neutral'
                },
                {
                    label: enabledChannelCount > 0 ? `${readyChannelCount} / ${enabledChannelCount} 通道就绪` : '0 / 0 通道就绪',
                    tone: enabledChannelCount > 0
                        ? (readyChannelCount === enabledChannelCount ? 'success' : 'warning')
                        : 'neutral'
                },
                {
                    label: `已配置 ${configuredTargetChannelCount || 0} / 3`,
                    tone: configuredTargetChannelCount > 0 ? 'success' : 'neutral'
                }
            ],
            canSendTest: normalizedConfig.enabled === true && enabledChannelCount > 0 && deliveryIssues.length === 0,
            testButtonTitle: normalizedConfig.enabled === true
                ? (enabledChannelCount > 0 ? '向已启用的站外通道发送测试告警' : '请先打开至少一个通道')
                : '请先启用站外告警',
            fetchedAt: normalizedHealthState.fetched_at || ''
        },
        cardStates: {
            channelsCard: {
                tone: normalizedConfig.enabled === true && enabledChannelCount === 0
                    ? 'warning'
                    : (enabledChannelCount > 0 && normalizedConfig.enabled ? (deliveryIssues.length > 0 ? 'warning' : 'success') : 'neutral'),
                title: normalizedConfig.enabled === true && enabledChannelCount === 0
                    ? '0 / 3 已打开'
                    : (enabledChannelCount > 0 ? `${readyChannelCount} / ${enabledChannelCount} 已就绪` : '未启用'),
                compact: !(enabledChannelCount > 0),
                items: channelOverviewItems
            },
            targetsCard: {
                tone: targetOverviewItems.length > 0
                    ? (configuredTargetChannelCount > 0 ? (deliveryIssues.length > 0 ? 'warning' : 'success') : (normalizedConfig.enabled ? 'warning' : 'neutral'))
                    : 'neutral',
                title: targetOverviewItems.length > 0 ? `已配置 ${configuredTargetChannelCount || 0} / 3` : '等待配置',
                compact: true,
                items: targetOverviewItems,
                detailRows: targetDetailRows,
                detailRowsCompact: true,
                includeTargetDetails: targetOverviewItems.length > 0 && targetDetailRows.length > 0
            },
            recentCard: {
                tone: normalizedHealthState.status === 'error'
                    ? 'danger'
                    : (deadLetterCount > 0 ? 'danger' : (failedCount > 0 ? 'warning' : (totalAttemptCount > 0 ? 'success' : 'neutral'))),
                title: normalizedHealthState.status === 'loading'
                    ? '正在刷新'
                    : (normalizedHealthState.status === 'error'
                        ? '查询失败'
                        : (totalAttemptCount > 0 ? `近 ${formatVerifyMonitorInteger(summary.lookback_hours || 0)} 小时` : '等待刷新')),
                metrics: totalAttemptCount > 0
                    ? [
                        { label: '总投递', value: formatVerifyMonitorInteger(totalAttemptCount) },
                        {
                            label: '送达率',
                            value: totalAttemptCount > 0
                                ? `${Math.round((Math.max(0, Number(summary.delivered_count || 0)) / totalAttemptCount) * 100)}%`
                                : '—'
                        },
                        { label: '刷新于', value: normalizedHealthState.fetched_at ? formatVerifyMonitorDateTime(normalizedHealthState.fetched_at) : '—' }
                    ]
                    : [],
                detailRows: [],
                emptyMessage: normalizedHealthState.status === 'loading'
                    ? (normalizedHealthState.message || '正在加载站外告警通道健康状态...')
                    : (normalizedHealthState.status === 'error'
                        ? (normalizedHealthState.message || '加载站外告警通道健康状态失败。')
                        : '告警通道健康页加载后，会在这里显示最近投递摘要。')
            }
        },
        recentVisualState: {
            trendMeta: '',
            trendBuckets: [],
            trendFooterLabels: [],
            segmentMeta: '分段统计',
            segments: []
        }
    };
}

function resolveOpsAlertOverviewRenderStateBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertOverviewRenderState',
        buildLocalOpsAlertOverviewRenderState,
        (overviewStatus = {}, healthState = {}) => ({
            defaultHealthState: getDefaultOpsAlertHealthState(),
            getTemporaryMuteState: getOpsAlertTemporaryMuteState,
            getEnabledSeveritySummary: buildOpsAlertEnabledSeveritySummary,
            formatCount: formatVerifyMonitorInteger,
            formatDateTime: formatVerifyMonitorDateTime,
            formatBucketLabel: formatOpsAlertTrendBucketLabel,
            buildGradient: buildOpsAlertTrendGradient
        })
    );
}

function resolveOpsAlertOverviewRenderState(overviewStatus = {}, healthState = opsAlertHealthState || getDefaultOpsAlertHealthState()) {
    return resolveOpsAlertOverviewRenderStateBuilder()(overviewStatus, healthState);
}

function buildLocalOpsAlertOverviewBannerState(overviewStatus = {}, healthState = opsAlertHealthState || getDefaultOpsAlertHealthState()) {
    return buildLocalOpsAlertOverviewRenderState(overviewStatus, healthState).bannerState;
}

function resolveOpsAlertOverviewBannerState(overviewStatus = {}, healthState = opsAlertHealthState || getDefaultOpsAlertHealthState()) {
    const renderState = resolveOpsAlertOverviewRenderState(overviewStatus, healthState);
    return renderState?.bannerState || buildLocalOpsAlertOverviewBannerState(overviewStatus, healthState);
}

function buildLocalOpsAlertOverviewCardStates(overviewStatus = {}, healthState = opsAlertHealthState || getDefaultOpsAlertHealthState()) {
    return buildLocalOpsAlertOverviewRenderState(overviewStatus, healthState).cardStates;
}

function resolveOpsAlertOverviewCardStates(overviewStatus = {}, healthState = opsAlertHealthState || getDefaultOpsAlertHealthState()) {
    const renderState = resolveOpsAlertOverviewRenderState(overviewStatus, healthState);
    return renderState?.cardStates || buildLocalOpsAlertOverviewCardStates(overviewStatus, healthState);
}

function buildLocalOpsAlertOverviewRecentVisualState(summary = {}, status = 'idle') {
    return buildLocalOpsAlertOverviewRenderState({}, {
        status,
        summary
    }).recentVisualState;
}

function resolveOpsAlertOverviewRecentVisualState(summary = {}, status = 'idle') {
    const renderState = resolveOpsAlertOverviewRenderState({}, {
        status,
        summary
    });
    return renderState?.recentVisualState || buildLocalOpsAlertOverviewRecentVisualState(summary, status);
}

function formatOpsAlertTrendBucketLabel(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    return `${month}/${day} ${hour}:00`;
}

function buildOpsAlertTrendGradient(bucket = {}) {
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

function buildLocalOpsAlertOverviewRecentVisualsMarkupState(sharedVisualState = {}) {
    const normalizedVisualState = sharedVisualState && typeof sharedVisualState === 'object' && !Array.isArray(sharedVisualState)
        ? sharedVisualState
        : {};
    let trendMarkup = '';
    let trendHidden = true;
    let segmentsMarkup = '';
    let segmentsHidden = true;

    if (Array.isArray(normalizedVisualState.trendBuckets) && normalizedVisualState.trendBuckets.length) {
        const bars = normalizedVisualState.trendBuckets.map((bucket) => `
            <div class="ops-alert-overview-trend__bucket" title="${escapeConfigHtml(bucket?.tooltip || '')}">
                <div class="ops-alert-overview-trend__track">
                    <div class="ops-alert-overview-trend__fill${bucket?.fillEmpty ? ' ops-alert-overview-trend__fill--empty' : ''}" style="${escapeConfigHtml(bucket?.backgroundStyle || '')}"></div>
                </div>
            </div>
        `).join('');

        trendMarkup = `
            <div class="ops-alert-overview-trend">
                <div class="ops-alert-overview-trend__meta">${escapeConfigHtml(normalizedVisualState.trendMeta || '')}</div>
                <div class="ops-alert-overview-trend__bars">${bars}</div>
                <div class="ops-alert-overview-trend__footer">
                    ${(Array.isArray(normalizedVisualState.trendFooterLabels) ? normalizedVisualState.trendFooterLabels : []).map((label) => `<span>${escapeConfigHtml(label || '—')}</span>`).join('')}
                </div>
            </div>
        `;
        trendHidden = false;
    }

    if (Array.isArray(normalizedVisualState.segments) && normalizedVisualState.segments.length) {
        const segments = normalizedVisualState.segments.map((segment) => `
            <div class="ops-alert-overview-segment ops-alert-overview-segment--${escapeConfigHtml(segment?.tone || 'neutral')}">
                <span>${escapeConfigHtml(segment?.label || '—')}</span>
                <strong>${escapeConfigHtml(segment?.valueText || '0')}</strong>
                <em>${escapeConfigHtml(segment?.shareText || '0%')}</em>
            </div>
        `).join('');

        segmentsMarkup = `
            <div class="ops-alert-overview-segments__meta">${escapeConfigHtml(normalizedVisualState.segmentMeta || '分段统计')}</div>
            <div class="ops-alert-overview-segments">${segments}</div>
        `;
        segmentsHidden = false;
    }

    return {
        trendHidden,
        trendMarkup,
        segmentsHidden,
        segmentsMarkup
    };
}

function applyOpsAlertOverviewRecentVisualsMarkupState(markupState = {}, elements = {}) {
    const trendEl = elements.trendEl;
    const segmentsEl = elements.segmentsEl;
    if (!trendEl || !segmentsEl) return markupState;

    trendEl.hidden = markupState.trendHidden !== false;
    trendEl.innerHTML = markupState.trendMarkup || '';
    segmentsEl.hidden = markupState.segmentsHidden !== false;
    segmentsEl.innerHTML = markupState.segmentsMarkup || '';
    return markupState;
}

function buildLocalOpsAlertOverviewCardsApplyState(markupState = {}) {
    const normalizedMarkupState = markupState && typeof markupState === 'object' && !Array.isArray(markupState)
        ? markupState
        : {};
    const channelsCardState = normalizedMarkupState.cardStates?.channelsCard || {};
    const targetsCardState = normalizedMarkupState.cardStates?.targetsCard || {};
    const recentCardState = normalizedMarkupState.cardStates?.recentCard || {};

    return {
        bannerMarkupState: buildOpsAlertOverviewBannerMarkupFromState(
            normalizedMarkupState.bannerState || {},
            normalizedMarkupState.healthState || getDefaultOpsAlertHealthState()
        ),
        cards: [
            {
                cardId: 'opsAlertOverviewChannelsCard',
                titleId: 'opsAlertOverviewChannelsTitle',
                bodyId: 'opsAlertOverviewChannels',
                tone: channelsCardState.tone || 'neutral',
                titleText: channelsCardState.title || '未启用',
                bodyMarkup: buildOpsAlertOverviewCardBodyMarkup(channelsCardState, {
                    renderListWhenEmpty: true,
                    listEmptyMessage: '暂无数据'
                })
            },
            {
                cardId: 'opsAlertOverviewTargetsCard',
                titleId: 'opsAlertOverviewTargetsTitle',
                bodyId: 'opsAlertOverviewTargets',
                tone: targetsCardState.tone || 'neutral',
                titleText: targetsCardState.title || '等待配置',
                bodyMarkup: buildOpsAlertOverviewCardBodyMarkup({
                    ...targetsCardState,
                    detailRows: targetsCardState.includeTargetDetails ? (targetsCardState.detailRows || []) : []
                }, {
                    renderListWhenEmpty: true,
                    listEmptyMessage: '暂无数据'
                })
            },
            {
                cardId: 'opsAlertOverviewRecentCard',
                titleId: 'opsAlertOverviewRecentTitle',
                bodyId: 'opsAlertOverviewRecent',
                tone: recentCardState.tone || 'neutral',
                titleText: recentCardState.title || '等待刷新',
                bodyMarkup: buildOpsAlertOverviewCardBodyMarkup(recentCardState, {
                    emptyMessage: '告警通道健康页加载后，会在这里显示最近投递摘要。'
                })
            }
        ],
        recentVisualMarkupState: buildLocalOpsAlertOverviewRecentVisualsMarkupState(
            normalizedMarkupState.recentVisualState || {}
        )
    };
}

function applyOpsAlertOverviewCardsMarkupState(applyState = {}) {
    return applyOpsAlertOverviewMarkupState(applyState);
}

function buildLocalOpsAlertOverviewMarkupState(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const markupState = resolveOpsAlertOverviewCardsMarkupState(config);
    return buildLocalOpsAlertOverviewCardsApplyState(markupState);
}

function resolveOpsAlertOverviewMarkupState(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    return buildLocalOpsAlertOverviewMarkupState(config);
}

function applyOpsAlertOverviewMarkupState(applyState = {}) {
    applyOpsAlertOverviewBannerMarkupState(
        applyState.bannerMarkupState || {},
        document.getElementById('opsAlertSummary')
    );
    (Array.isArray(applyState.cards) ? applyState.cards : []).forEach((card) => {
        updateOpsAlertOverviewCard(
            card.cardId,
            card.titleId,
            card.bodyId,
            card.tone,
            card.titleText,
            card.bodyMarkup
        );
    });
    applyOpsAlertOverviewRecentVisualsMarkupState(
        applyState.recentVisualMarkupState || {},
        {
            trendEl: document.getElementById('opsAlertOverviewRecentTrend'),
            segmentsEl: document.getElementById('opsAlertOverviewRecentSegments')
        }
    );
    return applyState;
}

function renderOpsAlertOverviewRecentVisuals(summary = {}, status = 'idle', precomputedVisualState = null) {
    const trendEl = document.getElementById('opsAlertOverviewRecentTrend');
    const segmentsEl = document.getElementById('opsAlertOverviewRecentSegments');
    if (!trendEl || !segmentsEl) {
        return;
    }

    const sharedVisualState = precomputedVisualState || resolveOpsAlertOverviewRecentVisualState(summary, status);
    applyOpsAlertOverviewRecentVisualsMarkupState(
        buildLocalOpsAlertOverviewRecentVisualsMarkupState(sharedVisualState),
        { trendEl, segmentsEl }
    );
}

function resolveOpsAlertOverviewStatus(config) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    return requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertOverviewStatus')(normalizedConfig, opsAlertSecretStatus, {
        normalizeConfig: normalizeOpsAlertConfig,
        getDefaultSecretStatus: getDefaultOpsAlertSecretStatus,
        getTemporaryMuteState: getOpsAlertTemporaryMuteState
    });
}

function getOpsAlertOverviewStatus(config) {
    return resolveOpsAlertOverviewStatus(config);
}

function resolveOpsAlertOverviewCardsMarkupState(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const {
        normalizedConfig,
        channelStates,
        deliveryIssues,
        channelOverviewItems,
        targetOverviewItems,
        targetDetailRows,
        enabledChannelCount,
        readyChannelCount,
        configuredTargetChannelCount
    } = getOpsAlertOverviewStatus(config);
    const healthState = opsAlertHealthState || getDefaultOpsAlertHealthState();
    const summary = healthState.summary || getDefaultOpsAlertHealthState().summary;
    const overviewStatus = {
        normalizedConfig,
        channelStates,
        deliveryIssues,
        channelOverviewItems,
        targetOverviewItems,
        targetDetailRows,
        enabledChannelCount,
        readyChannelCount,
        configuredTargetChannelCount
    };
    const sharedOverviewRenderState = resolveOpsAlertOverviewRenderState(overviewStatus, healthState);
    const sharedCardStates = sharedOverviewRenderState?.cardStates || resolveOpsAlertOverviewCardStates(overviewStatus, healthState);

    return {
        normalizedConfig,
        healthState,
        summary,
        overviewStatus,
        bannerState: sharedOverviewRenderState?.bannerState || resolveOpsAlertOverviewBannerState(overviewStatus, healthState),
        cardStates: {
            channelsCard: sharedCardStates?.channelsCard || {
                tone: normalizedConfig.enabled && enabledChannelCount === 0
                    ? 'warning'
                    : (enabledChannelCount > 0 && deliveryIssues.length > 0
                        ? (normalizedConfig.enabled ? 'warning' : 'neutral')
                        : (enabledChannelCount > 0 && normalizedConfig.enabled ? 'success' : 'neutral')),
                title: normalizedConfig.enabled && enabledChannelCount === 0
                    ? '0 / 3 已打开'
                    : (enabledChannelCount > 0 ? `${readyChannelCount} / ${enabledChannelCount} 已就绪` : '未启用'),
                compact: !(enabledChannelCount > 0),
                items: channelOverviewItems
            },
            targetsCard: sharedCardStates?.targetsCard || {
                tone: targetOverviewItems.length > 0
                    ? (configuredTargetChannelCount > 0
                        ? (deliveryIssues.length > 0 ? 'warning' : 'success')
                        : (normalizedConfig.enabled ? 'warning' : 'neutral'))
                    : 'neutral',
                title: targetOverviewItems.length > 0 ? `已配置 ${configuredTargetChannelCount || 0} / 3` : '等待配置',
                compact: true,
                items: targetOverviewItems,
                detailRows: targetDetailRows,
                detailRowsCompact: true,
                includeTargetDetails: targetOverviewItems.length > 0 && targetDetailRows.length > 0
            },
            recentCard: sharedCardStates?.recentCard || {
                tone: 'neutral',
                title: '等待刷新',
                metrics: [],
                detailRows: [],
                emptyMessage: healthState.status === 'loading'
                    ? (healthState.message || '正在加载站外告警通道健康状态...')
                    : (healthState.status === 'error'
                        ? (healthState.message || '加载站外告警通道健康状态失败。')
                        : '告警通道健康页加载后，会在这里显示最近投递摘要。')
            }
        },
        recentVisualState: sharedOverviewRenderState?.recentVisualState || resolveOpsAlertOverviewRecentVisualState(summary, healthState.status)
    };
}

function renderOpsAlertOverviewCards(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    return renderOpsAlertOverview(config);
}

function renderOpsAlertOverview(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    applyOpsAlertOverviewMarkupState(resolveOpsAlertOverviewMarkupState(config));
}

function buildOpsAlertEnabledSeveritySummary(config = {}) {
    const normalizedConfig = config && typeof config === 'object' ? config : {};
    const channels = [
        { label: 'Telegram', key: 'telegram' },
        { label: '飞书', key: 'feishu' },
        { label: '邮件', key: 'email' }
    ];

    return channels
        .map((channel) => {
            const channelConfig = normalizedConfig?.channels?.[channel.key];
            if (!channelConfig || channelConfig.enabled !== true) {
                return '';
            }
            const minimumSeverity = String(channelConfig.minimum_severity || 'warning').trim().toLowerCase() || 'warning';
            return `${channel.label} ${minimumSeverity}`;
        })
        .filter(Boolean)
        .join('；');
}

function setOpsAlertHealthCardTone(card, tone = 'neutral') {
    if (!card) return;
    OPS_ALERT_HEALTH_CARD_TONE_CLASSES.forEach((className) => card.classList.remove(className));
    card.classList.add(`ops-alert-health-card--${tone}`);
}

function buildOpsAlertPanelMetaMarkup(panelState = {}, fallbackText = '') {
    const normalizedPanelState = panelState && typeof panelState === 'object' && !Array.isArray(panelState)
        ? panelState
        : {};
    return `<i class="${escapeConfigHtml(normalizedPanelState.metaIcon || 'fas fa-circle-info')}"></i><span>${escapeConfigHtml(normalizedPanelState.metaText || fallbackText || '暂无数据')}</span>`;
}

function buildOpsAlertPanelEmptyMarkup(message = '', className = 'ops-alert-monitor-empty') {
    return `<div class="${escapeConfigHtml(className || 'ops-alert-monitor-empty')}">${escapeConfigHtml(message || '暂无数据')}</div>`;
}

function applyOpsAlertBodyMarkupState(markupState = {}, target = null, fallbackBody = '') {
    if (!target) return markupState;
    target.innerHTML = markupState.bodyMarkup || fallbackBody || '';
    return markupState;
}

function applyOpsAlertPanelMarkupElements(markupState = {}, elements = {}, options = {}) {
    const panel = elements.panel;
    const meta = elements.meta;
    const grid = elements.grid;
    if (!panel || !meta || !grid) return markupState;

    panel.hidden = false;
    if (typeof options.beforeApply === 'function') {
        options.beforeApply(markupState, elements);
    }

    meta.innerHTML = markupState.metaMarkup || buildOpsAlertPanelMetaMarkup(
        markupState.panelState,
        options.fallbackMetaText || ''
    );
    grid.innerHTML = markupState.bodyMarkup || buildOpsAlertPanelEmptyMarkup(
        options.fallbackEmptyText || markupState.panelState?.emptyMessage || '暂无数据'
    );
    return markupState;
}

function renderOpsAlertHealthEmptyState(target, message) {
    if (!target) return;
    target.innerHTML = buildOpsAlertPanelEmptyMarkup(message);
}

function buildOpsAlertHealthBadge(label, tone = 'neutral') {
    return `<span class="ops-alert-monitor-badge ops-alert-monitor-badge--${escapeConfigHtml(tone)}">${escapeConfigHtml(label)}</span>`;
}

function resolveOpsAlertHealthCardStates(state = {}) {
    const renderState = resolveOpsAlertHealthRenderState(state);
    return Array.isArray(renderState?.channelCardStates) ? renderState.channelCardStates : [];
}

function buildOpsAlertHealthCardMarkupFromState(resolvedCardState = {}) {
    const normalizedCardState = resolvedCardState && typeof resolvedCardState === 'object' && !Array.isArray(resolvedCardState)
        ? resolvedCardState
        : {};
    const configMarkup = Array.isArray(normalizedCardState.configDetails) && normalizedCardState.configDetails.length
        ? `
            <div class="ops-alert-health-card__config">
                ${normalizedCardState.configDetails.map((item) => `
                    <div class="ops-alert-health-card__config-item">
                        <span>${escapeConfigHtml(item.label || '')}</span>
                        <strong>${escapeConfigHtml(item.value || '—')}</strong>
                    </div>
                `).join('')}
            </div>
        `
        : '';
    const recentErrors = Array.isArray(normalizedCardState.recentErrors) ? normalizedCardState.recentErrors : [];
    const recentErrorsMarkup = recentErrors.length
        ? `
            <div class="ops-alert-health-card__errors">
                ${recentErrors.map((item) => `
                    <div class="ops-alert-health-card__error-item">
                        <strong>${escapeConfigHtml(item.message || '未知错误')}</strong>
                        <span>${escapeConfigHtml(item.meta || '时间未知')}</span>
                    </div>
                `).join('')}
            </div>
        `
        : `<div class="ops-alert-health-card__errors empty">${escapeConfigHtml(normalizedCardState.recentErrorsEmptyText || '最近没有失败明细。')}</div>`;

    return `
        <article class="ops-alert-health-card ops-alert-health-card--${escapeConfigHtml(normalizedCardState.tone || 'neutral')}">
            <div class="ops-alert-health-card__head">
                <div>
                    <div class="ops-alert-health-card__title">${escapeConfigHtml(normalizedCardState.label || '通道')}</div>
                    <div class="ops-alert-health-card__meta">${escapeConfigHtml(normalizedCardState.metaLine || '')}</div>
                </div>
                <div class="ops-alert-health-card__status">
                    ${(Array.isArray(normalizedCardState.statusBadges) ? normalizedCardState.statusBadges : []).map((badge) => buildOpsAlertHealthBadge(badge?.label || '—', badge?.tone || 'neutral')).join('')}
                </div>
            </div>
            <div class="ops-alert-health-card__stats">
                ${(Array.isArray(normalizedCardState.stats) ? normalizedCardState.stats : []).map((item) => `
                    <div><strong>${escapeConfigHtml(item?.value || '—')}</strong><span>${escapeConfigHtml(item?.label || '')}</span></div>
                `).join('')}
            </div>
            ${configMarkup}
            <div class="ops-alert-health-card__summary">${escapeConfigHtml(normalizedCardState.summaryText || '')}</div>
            ${recentErrorsMarkup}
        </article>
    `;
}

function resolveOpsAlertHealthPanelState(state = {}) {
    const renderState = resolveOpsAlertHealthRenderState(state);
    return renderState?.panelState || {};
}

function resolveOpsAlertHealthRenderState(state = {}) {
    return requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertHealthRenderState')(state, {
        defaultHealthState: getDefaultOpsAlertHealthState(),
        formatCount: formatVerifyMonitorInteger,
        formatDateTime: formatVerifyMonitorDateTime
    });
}

function buildLocalOpsAlertHealthPanelMarkupState(state = opsAlertHealthState || getDefaultOpsAlertHealthState()) {
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : getDefaultOpsAlertHealthState();
    const summary = normalizedState.summary || getDefaultOpsAlertHealthState().summary;
    const sharedHealthRenderState = resolveOpsAlertHealthRenderState(normalizedState);
    const panelState = sharedHealthRenderState?.panelState || resolveOpsAlertHealthPanelState(normalizedState);
    const channelCardStates = Array.isArray(sharedHealthRenderState?.channelCardStates)
        ? sharedHealthRenderState.channelCardStates
        : resolveOpsAlertHealthCardStates(normalizedState);
    const emptyMessage = panelState.status === 'error'
        ? (panelState.emptyMessage || normalizedState.message || '加载告警通道健康状态失败。')
        : (panelState.emptyMessage || '最近没有可用于评估的站外告警通道数据。');

    return {
        state: normalizedState,
        summary,
        panelState,
        channelCardStates,
        metaMarkup: buildOpsAlertPanelMetaMarkup(panelState, '最近没有可用于评估的站外告警通道数据。'),
        bodyMarkup: panelState.status === 'ready'
            ? channelCardStates.map((cardState) => buildOpsAlertHealthCardMarkupFromState(cardState)).join('')
            : buildOpsAlertPanelEmptyMarkup(
                panelState.status === 'loading'
                    ? (panelState.emptyMessage || '正在加载站外告警通道健康状态...')
                    : emptyMessage
            )
    };
}

function resolveOpsAlertHealthPanelMarkupState(state = opsAlertHealthState || getDefaultOpsAlertHealthState()) {
    return buildLocalOpsAlertHealthPanelMarkupState(state);
}

function applyOpsAlertHealthPanelMarkupState(markupState = {}, elements = {}) {
    return applyOpsAlertPanelMarkupElements(markupState, elements, {
        beforeApply: () => renderOpsAlertOverviewCards(),
        fallbackMetaText: '最近没有可用于评估的站外告警通道数据。',
        fallbackEmptyText: '最近没有可用于评估的站外告警通道数据。'
    });
}

function renderOpsAlertBodyMarkupTarget(targetId, resolveMarkupState) {
    const target = document.getElementById(targetId);
    if (!target || typeof resolveMarkupState !== 'function') return null;
    const markupState = resolveMarkupState();
    applyOpsAlertBodyMarkupState(markupState, target);
    return markupState;
}

function renderOpsAlertPanelMarkupTarget(options = {}) {
    const panel = document.getElementById(options.panelId || '');
    const meta = document.getElementById(options.metaId || '');
    const grid = document.getElementById(options.gridId || '');
    if (!panel || !meta || !grid) return null;
    if (typeof options.resolveMarkupState !== 'function' || typeof options.applyMarkupState !== 'function') {
        return null;
    }
    const markupState = options.resolveMarkupState();
    options.applyMarkupState(markupState, { panel, meta, grid });
    return markupState;
}

function renderOpsAlertHealthPanel() {
    renderOpsAlertPanelMarkupTarget({
        panelId: 'opsAlertHealthPanel',
        metaId: 'opsAlertHealthMeta',
        gridId: 'opsAlertHealthGrid',
        resolveMarkupState: () => resolveOpsAlertHealthPanelMarkupState(opsAlertHealthState || getDefaultOpsAlertHealthState()),
        applyMarkupState: applyOpsAlertHealthPanelMarkupState
    });
}

function buildLocalOpsAlertMonitorCategoryActions(categoryKey) {
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
        ]
    };
    return actionMap[normalizedKey] || [];
}

function resolveOpsAlertMonitorCategoryActions(categoryKey) {
    return resolveOpsAlertMonitorCategoryActionsResolver()(categoryKey);
}

function getOpsAlertMonitorCategoryActions(categoryKey) {
    return resolveOpsAlertMonitorCategoryActions(categoryKey);
}

function resolveOpsAlertMonitorCategoryActionsResolver() {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertMonitorCategoryActions',
        buildLocalOpsAlertMonitorCategoryActions
    );
}

function normalizeOpsAlertMonitorFilterValue(kind, value) {
    const normalizedKind = String(kind || '').trim().toLowerCase();
    const normalizedValue = String(value || '').trim().toLowerCase();

    if (normalizedKind === 'scope') {
        return ['all', 'active', 'recovered'].includes(normalizedValue) ? normalizedValue : 'all';
    }
    if (normalizedKind === 'severity') {
        return ['all', 'critical', 'warning'].includes(normalizedValue) ? normalizedValue : 'all';
    }
    if (normalizedKind === 'category') {
        return ['all', 'payments', 'tickets', 'inventory', 'fulfillment', 'shop_risk'].includes(normalizedValue)
            ? normalizedValue
            : 'all';
    }

    return 'all';
}

function getOpsAlertMonitorViewFilters() {
    const defaults = getDefaultOpsAlertMonitorViewState();
    const current = opsAlertMonitorViewState || defaults;
    return {
        scope: normalizeOpsAlertMonitorFilterValue('scope', current.scope),
        severity: normalizeOpsAlertMonitorFilterValue('severity', current.severity),
        category: normalizeOpsAlertMonitorFilterValue('category', current.category)
    };
}

function getOpsAlertMonitorPreparedCategories(filters = getOpsAlertMonitorViewFilters()) {
    return (Array.isArray(opsAlertMonitorState?.categories) ? opsAlertMonitorState.categories : [])
        .map((category) => buildOpsAlertMonitorCategoryView(category, filters))
        .filter(Boolean);
}

function syncOpsAlertMonitorFilterToolbar(filters = getOpsAlertMonitorViewFilters(), toolbarState = null) {
    applyOpsAlertMonitorFilterToolbarState(
        Array.isArray(toolbarState) ? toolbarState : resolveOpsAlertMonitorFilterToolbarState(filters),
        filters
    );
}

function buildLocalOpsAlertMonitorFilterToolbarState(filters = getOpsAlertMonitorViewFilters()) {
    const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters)
        ? filters
        : getDefaultOpsAlertMonitorViewState();
    const definitions = Array.from(document.querySelectorAll('[data-ops-alert-monitor-filter-kind]')).map((button) => ({
        kind: button.dataset.opsAlertMonitorFilterKind,
        value: button.dataset.opsAlertMonitorFilterValue
    }));
    return definitions.map((item) => {
        const kind = String(item.kind || '').trim().toLowerCase();
        const value = String(item.value || '').trim().toLowerCase();
        return {
            kind,
            value,
            active: normalizedFilters[kind] === value
        };
    });
}

function resolveOpsAlertMonitorFilterToolbarStateBuilder() {
    const definitions = Array.from(document.querySelectorAll('[data-ops-alert-monitor-filter-kind]')).map((button) => ({
        kind: button.dataset.opsAlertMonitorFilterKind,
        value: button.dataset.opsAlertMonitorFilterValue
    }));
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertMonitorFilterToolbarState',
        buildLocalOpsAlertMonitorFilterToolbarState,
        (filters = getOpsAlertMonitorViewFilters()) => ({
            definitions
        })
    );
}

function resolveOpsAlertMonitorFilterToolbarState(filters = getOpsAlertMonitorViewFilters()) {
    return resolveOpsAlertMonitorFilterToolbarStateBuilder()(filters);
}

function buildLocalOpsAlertMonitorDisplayActiveCount(category = {}) {
    return Number(category.display_active_count ?? category.active_count ?? 0);
}

function resolveOpsAlertMonitorDisplayActiveCount(category = {}) {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertMonitorDisplayActiveCount',
        buildLocalOpsAlertMonitorDisplayActiveCount
    )(category);
}

function getOpsAlertMonitorDisplayActiveCount(category = {}) {
    return resolveOpsAlertMonitorDisplayActiveCount(category);
}

function buildLocalOpsAlertMonitorDisplayCriticalCount(category = {}) {
    return Number(category.display_critical_count ?? category.critical_count ?? 0);
}

function resolveOpsAlertMonitorDisplayCriticalCount(category = {}) {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertMonitorDisplayCriticalCount',
        buildLocalOpsAlertMonitorDisplayCriticalCount
    )(category);
}

function getOpsAlertMonitorDisplayCriticalCount(category = {}) {
    return resolveOpsAlertMonitorDisplayCriticalCount(category);
}

function buildLocalOpsAlertMonitorCardTone(category = {}) {
    if (getOpsAlertMonitorDisplayCriticalCount(category) > 0) return 'danger';
    if (getOpsAlertMonitorDisplayActiveCount(category) > 0) return 'warning';
    if (String(category.latest_state || '').toLowerCase() === 'recovered') return 'success';
    return 'neutral';
}

function resolveOpsAlertMonitorCardTone(category = {}) {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertMonitorCardTone',
        buildLocalOpsAlertMonitorCardTone
    )(category);
}

function getOpsAlertMonitorCardTone(category = {}) {
    return resolveOpsAlertMonitorCardTone(category);
}

function renderOpsAlertMonitorEmptyState(target, message) {
    if (!target) return;
    target.innerHTML = buildOpsAlertPanelEmptyMarkup(message);
}

function buildOpsAlertMonitorBadge(label, tone = 'neutral') {
    return `<span class="ops-alert-monitor-badge ops-alert-monitor-badge--${escapeConfigHtml(tone)}">${escapeConfigHtml(label)}</span>`;
}

function getOpsAlertMonitorSeverityTone(severity) {
    const normalizedSeverity = String(severity || 'warning').trim().toLowerCase();
    return normalizedSeverity === 'critical' ? 'danger' : (normalizedSeverity === 'warning' ? 'warning' : 'neutral');
}

function getOpsAlertMonitorRiskTone(riskLevel) {
    const normalizedRiskLevel = String(riskLevel || '').trim().toLowerCase();
    if (normalizedRiskLevel === 'critical') return 'danger';
    if (normalizedRiskLevel === 'high') return 'warning';
    if (normalizedRiskLevel === 'medium') return 'neutral';
    return 'neutral';
}

function getOpsAlertMonitorRiskLevelLabel(riskLevel) {
    const normalizedRiskLevel = String(riskLevel || '').trim().toLowerCase();
    const labelMap = {
        medium: '中',
        high: '高',
        critical: '紧急'
    };
    return labelMap[normalizedRiskLevel] || normalizedRiskLevel || '中';
}

function buildLocalOpsAlertCaseStatusTone(status) {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (normalizedStatus === 'resolved') return 'success';
    if (normalizedStatus === 'claimed') return 'neutral';
    return 'warning';
}

function resolveOpsAlertCaseStatusTone(status) {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertCaseStatusTone',
        buildLocalOpsAlertCaseStatusTone,
        () => ({ variant: 'monitor' })
    )(status);
}

function getOpsAlertCaseStatusTone(status) {
    return resolveOpsAlertCaseStatusTone(status);
}

function buildLocalOpsAlertCaseStatusLabel(status) {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    const labelMap = {
        open: '待处理',
        claimed: '处理中',
        resolved: '已关闭'
    };
    return labelMap[normalizedStatus] || '待处理';
}

function resolveOpsAlertCaseStatusLabel(status) {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertCaseStatusLabel',
        buildLocalOpsAlertCaseStatusLabel
    )(status);
}

function getOpsAlertCaseStatusLabel(status) {
    return resolveOpsAlertCaseStatusLabel(status);
}

function buildLocalOpsAlertMonitorAssignableAdmins(state = opsAlertMonitorState || getDefaultOpsAlertMonitorState()) {
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : getDefaultOpsAlertMonitorState();
    const admins = Array.isArray(normalizedState.assignable_admins) ? normalizedState.assignable_admins : [];
    if (admins.length) {
        return admins.map((admin) => ({
            id: String(admin.id || '').trim(),
            label: String(admin.label || admin.display_name || admin.email || admin.username || admin.id || '').trim(),
            email: String(admin.email || '').trim(),
            roleName: String(admin.role_name || '').trim().toLowerCase(),
            isCurrent: admin.is_current === true
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
        roleName: 'admin',
        isCurrent: true
    }];
}

function resolveOpsAlertMonitorAssignableAdmins(state = opsAlertMonitorState || getDefaultOpsAlertMonitorState()) {
    return resolveOpsAlertMonitorAssignableAdminsNormalizer()(state);
}

function getOpsAlertMonitorAssignableAdmins() {
    return resolveOpsAlertMonitorAssignableAdmins(opsAlertMonitorState || getDefaultOpsAlertMonitorState());
}

function resolveOpsAlertMonitorAssignableAdminsNormalizer() {
    return resolveOpsAlertSharedCallable(
        'normalizeAdminWorkbenchOpsAlertMonitorAssignableAdmins',
        buildLocalOpsAlertMonitorAssignableAdmins,
        (state) => ({
            fallbackRoleName: 'admin'
        })
    );
}

function buildLocalOpsAlertCaseRecentEvents(item = {}) {
    return (Array.isArray(item.case_recent_events) ? item.case_recent_events : [])
        .map((event) => ({
            action: String(event.action || '').trim().toLowerCase(),
            actionLabel: String(event.action_label || '').trim(),
            summary: String(event.summary || '').trim(),
            ownerLabel: String(event.owner_label || '').trim(),
            actorLabel: String(event.actor_label || '').trim(),
            createdAt: String(event.created_at || '').trim(),
            metadata: event && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
                ? event.metadata
                : {}
        }))
        .filter((event) => event.action || event.actionLabel || event.summary || event.createdAt);
}

function resolveOpsAlertCaseRecentEvents(item = {}) {
    return resolveOpsAlertCaseRecentEventsNormalizer()(item);
}

function getOpsAlertCaseRecentEvents(item = {}) {
    return resolveOpsAlertCaseRecentEvents(item);
}

function resolveOpsAlertCaseRecentEventsNormalizer() {
    return resolveOpsAlertSharedCallable(
        'normalizeAdminWorkbenchOpsAlertCaseRecentEvents',
        buildLocalOpsAlertCaseRecentEvents,
        (item = {}) => item.case_recent_events
    );
}

function buildLocalOpsAlertCaseRecentEventText(event = {}) {
    const actionLabel = String(event.actionLabel || '').trim() || String(event.action || '').trim();
    const muteUntil = String(event.metadata?.mute_until || '').trim();
    const summary = String(event.action || '').trim().toLowerCase() === 'batch_mute' && muteUntil
        ? `已静默至 ${formatVerifyMonitorDateTime(muteUntil)}`
        : String(event.summary || '').trim();
    const actorLabel = String(event.actorLabel || '').trim();
    const ownerLabel = String(event.ownerLabel || '').trim();
    const parts = [];

    if (actionLabel) {
        parts.push(actionLabel);
    }
    if (summary) {
        parts.push(summary);
    } else if (ownerLabel && ['assign', 'claim'].includes(String(event.action || '').trim().toLowerCase())) {
        parts.push(`负责人 ${ownerLabel}`);
    }
    if (actorLabel) {
        parts.push(`操作人 ${actorLabel}`);
    }
    if (event.createdAt) {
        parts.push(formatVerifyMonitorDateTime(event.createdAt));
    }

    return parts.join(' · ');
}

function resolveOpsAlertCaseRecentEventText(event = {}) {
    return resolveOpsAlertCaseRecentEventTextFormatter()(event);
}

function getOpsAlertCaseRecentEventText(event = {}) {
    return resolveOpsAlertCaseRecentEventText(event);
}

function resolveOpsAlertCaseRecentEventTextFormatter() {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertCaseRecentEventText',
        buildLocalOpsAlertCaseRecentEventText,
        (event = {}) => ({
            formatTime: formatVerifyMonitorDateTime,
            muteVerb: '已静默至'
        })
    );
}

function buildLocalOpsAlertCaseSummaryText(item = {}) {
    const status = String(item.case_status || '').trim().toLowerCase() || 'open';
    const statusLabel = getOpsAlertCaseStatusLabel(status);
    const ownerLabel = String(item.case_owner_label || '').trim();
    const resolution = String(item.case_resolution || '').trim();
    const note = String(item.case_recent_note || item.case_note || '').trim();
    const latestEvent = getOpsAlertCaseRecentEvents(item)[0] || null;
    const latestEventLabel = String(item.case_latest_event_label || '').trim();
    const latestEventSummary = String(item.case_latest_event_action || '').trim().toLowerCase() === 'batch_mute' && latestEvent?.metadata?.mute_until
        ? `已静默至 ${formatVerifyMonitorDateTime(latestEvent.metadata.mute_until)}`
        : String(item.case_latest_event_summary || '').trim();
    const latestEventAt = String(item.case_latest_event_at || item.case_last_action_at || '').trim();
    const summaryParts = [statusLabel];

    if (ownerLabel) {
        summaryParts.push(`负责人 ${ownerLabel}`);
    }

    if (status === 'resolved' && resolution) {
        summaryParts.push(`关闭：${resolution}`);
    } else if (note) {
        summaryParts.push(`备注：${note}`);
    }

    if (latestEventLabel && !['resolve', 'add_note'].includes(String(item.case_latest_event_action || '').trim().toLowerCase())) {
        summaryParts.push(`最近 ${latestEventLabel}${latestEventSummary ? `：${latestEventSummary}` : ''}`);
    }

    if (latestEventAt) {
        summaryParts.push(formatVerifyMonitorDateTime(latestEventAt));
    }

    return summaryParts.join(' · ');
}

function resolveOpsAlertCaseSummaryText(item = {}) {
    return resolveOpsAlertCaseSummaryTextFormatter()(item);
}

function getOpsAlertCaseSummaryText(item = {}) {
    return resolveOpsAlertCaseSummaryText(item);
}

function resolveOpsAlertCaseSummaryTextFormatter() {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertCaseSummaryText',
        buildLocalOpsAlertCaseSummaryText,
        (item = {}) => ({
            formatTime: formatVerifyMonitorDateTime,
            muteVerb: '已静默至'
        })
    );
}

function getShopRiskCaseStatusTone(status) {
    return getOpsAlertCaseStatusTone(status);
}

function getShopRiskCaseStatusLabel(status) {
    return getOpsAlertCaseStatusLabel(status);
}

function getShopRiskCaseSummaryText(item = {}) {
    return getOpsAlertCaseSummaryText(item);
}

function buildLocalOpsAlertMonitorItemDisplayState(item = {}, category = {}) {
    const normalizedItem = item && typeof item === 'object' && !Array.isArray(item)
        ? item
        : {};
    const normalizedCategory = category && typeof category === 'object' && !Array.isArray(category)
        ? category
        : {};
    const categoryKey = String(normalizedCategory.key || '').trim().toLowerCase();
    const severity = String(normalizedItem.severity || 'warning').trim().toLowerCase() || 'warning';
    const severityTone = getOpsAlertMonitorSeverityTone(severity);
    const riskLevel = String(normalizedItem.risk_level || '').trim().toLowerCase();
    const riskTone = getOpsAlertMonitorRiskTone(riskLevel);
    const workspaceAction = getOpsAlertMonitorItemAction(normalizedCategory, normalizedItem);
    const quickAction = getOpsAlertMonitorItemQuickAction(normalizedCategory, normalizedItem);
    const caseActions = getOpsAlertMonitorItemCaseActions(normalizedCategory, normalizedItem);
    const caseStatus = String(normalizedItem.case_status || '').trim().toLowerCase() || 'open';
    const caseTone = getOpsAlertCaseStatusTone(caseStatus);
    const recentEvents = getOpsAlertCaseRecentEvents(normalizedItem);
    const metaParts = [
        normalizedItem.reference_label && normalizedItem.reference_value
            ? `${normalizedItem.reference_label}：${normalizedItem.reference_value}`
            : '',
        normalizedItem.created_at ? formatVerifyMonitorDateTime(normalizedItem.created_at) : ''
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
                    label: `风险 ${getOpsAlertMonitorRiskLevelLabel(riskLevel)}${Number.isFinite(Number(normalizedItem.risk_score)) ? ` · ${formatVerifyMonitorInteger(normalizedItem.risk_score)}` : ''}`,
                    tone: riskTone
                }
                : null,
            hasCaseContext
                ? { label: `处置 ${getOpsAlertCaseStatusLabel(caseStatus)}`, tone: caseTone }
                : null
        ].filter(Boolean),
        progressPrefix: categoryKey === 'shop_risk' ? '值班处理' : '处理进度',
        progressText: hasCaseContext ? getOpsAlertCaseSummaryText(normalizedItem) : '',
        historyItems: recentEvents.map((event) => getOpsAlertCaseRecentEventText(event)).filter(Boolean),
        autoResponseSummary: String(normalizedItem.auto_response_summary || '').trim(),
        responseSummary: String(normalizedItem.response_summary || '').trim(),
        metaText: metaParts.join(' · ') || '等待更多上下文',
        hasActions: Boolean(workspaceAction || quickAction || caseActions.length),
        caseActions,
        quickAction: quickAction || null,
        workspaceAction: workspaceAction || null
    };
}

function resolveOpsAlertMonitorItemDisplayStateBuilder() {
    return buildLocalOpsAlertMonitorItemDisplayState;
}

function resolveOpsAlertMonitorItemDisplayState(item = {}, category = {}, sharedOptions = {}) {
    return resolveOpsAlertMonitorItemDisplayStateBuilder()(item, category, sharedOptions);
}

function buildLocalOpsAlertMonitorItemAction(category = {}, item = {}) {
    return resolveOpsAlertWorkspaceActionResolver()({
        categoryKey: String(category.key || '').trim().toLowerCase(),
        alertType: String(item.alert_type || '').trim().toLowerCase(),
        targetId: String(item.target_id || '').trim().toLowerCase()
    }, {
        labelVariant: 'monitor'
    });
}

function resolveOpsAlertMonitorItemAction(category = {}, item = {}) {
    return resolveOpsAlertMonitorWorkspaceActionResolver()(category, item);
}

function getOpsAlertMonitorItemAction(category = {}, item = {}) {
    return resolveOpsAlertMonitorItemAction(category, item);
}

function resolveOpsAlertMonitorWorkspaceActionResolver() {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertMonitorWorkspaceAction',
        buildLocalOpsAlertMonitorItemAction,
        (category = {}, item = {}) => ({
            labelVariant: 'monitor'
        })
    );
}

function buildLocalOpsAlertMonitorItemQuickAction(category = {}, item = {}) {
    const alertType = String(item.alert_type || '').trim().toLowerCase();
    const primaryAction = String(item.primary_action || '').trim().toLowerCase();
    const autoResponseStatus = String(item.auto_response_status || '').trim().toLowerCase();

    if (String(category.key || '').trim().toLowerCase() !== 'shop_risk') {
        return null;
    }

    if (alertType !== 'shop_order_risk_anomaly') {
        return null;
    }

    if (
        primaryAction === 'disable-coupon'
        && item.discount_code
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
        && item.user_id
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

function resolveOpsAlertMonitorItemQuickAction(category = {}, item = {}) {
    return resolveOpsAlertMonitorQuickActionResolver()(category, item);
}

function getOpsAlertMonitorItemQuickAction(category = {}, item = {}) {
    return resolveOpsAlertMonitorItemQuickAction(category, item);
}

function resolveOpsAlertMonitorQuickActionResolver() {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertMonitorQuickAction',
        buildLocalOpsAlertMonitorItemQuickAction
    );
}

function buildLocalOpsAlertMonitorItemCaseActions(category = {}, item = {}) {
    const categoryKey = String(category.key || '').trim().toLowerCase();
    if (!categoryKey || !String(item.target_id || '').trim()) {
        return [];
    }

    const status = String(item.case_status || '').trim().toLowerCase() || 'open';
    const actions = [];

    if (status !== 'resolved') {
        actions.push({
            action: 'assign',
            label: status === 'claimed' ? '转交负责人' : '指派负责人',
            icon: 'fas fa-user-check'
        });

        actions.push({
            action: 'add_note',
            label: '备注',
            icon: 'fas fa-note-sticky'
        });
        actions.push({
            action: 'resolve',
            label: '关闭',
            icon: 'fas fa-circle-check'
        });
    } else {
        actions.push({
            action: 'reopen',
            label: '重新打开',
            icon: 'fas fa-arrow-rotate-left'
        });
        actions.push({
            action: 'add_note',
            label: '补充备注',
            icon: 'fas fa-note-sticky'
        });
    }

    return actions;
}

function resolveOpsAlertMonitorItemCaseActions(category = {}, item = {}) {
    return resolveOpsAlertMonitorCaseActionsResolver()(category, item);
}

function getOpsAlertMonitorItemCaseActions(category = {}, item = {}) {
    return resolveOpsAlertMonitorItemCaseActions(category, item);
}

function resolveOpsAlertMonitorCaseActionsResolver() {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertMonitorCaseActions',
        buildLocalOpsAlertMonitorItemCaseActions
    );
}

function buildLocalOpsAlertMonitorActionContext(category = {}, item = {}) {
    return {
        title: item.title || '',
        alertType: item.alert_type || '',
        category: category.key || '',
        referenceLabel: item.reference_label || '',
        referenceValue: item.reference_value || '',
        targetId: item.target_id || '',
        userId: item.user_id || '',
        clientIp: item.client_ip || '',
        discountCode: item.discount_code || '',
        signalType: item.signal_type || '',
        sessionId: item.session_id || '',
        caseStatus: item.case_status || '',
        caseOwnerAdminId: item.case_owner_admin_id || '',
        caseOwnerLabel: item.case_owner_label || ''
    };
}

function resolveOpsAlertMonitorActionContext(category = {}, item = {}) {
    return resolveOpsAlertMonitorActionContextBuilder()(category, item);
}

function resolveOpsAlertMonitorActionContextBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertMonitorActionContext',
        buildLocalOpsAlertMonitorActionContext
    );
}

function buildLocalOpsAlertWorkspaceContextAttrs(context = {}) {
    const normalizedContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    return {
        title: normalizedContext.title || '',
        alertType: normalizedContext.alertType || normalizedContext.alert_type || '',
        category: normalizedContext.category || '',
        referenceLabel: normalizedContext.referenceLabel || normalizedContext.reference_label || '',
        referenceValue: normalizedContext.referenceValue || normalizedContext.reference_value || '',
        targetId: normalizedContext.targetId || normalizedContext.target_id || '',
        userId: normalizedContext.userId || normalizedContext.user_id || '',
        clientIp: normalizedContext.clientIp || normalizedContext.client_ip || '',
        discountCode: normalizedContext.discountCode || normalizedContext.discount_code || '',
        signalType: normalizedContext.signalType || normalizedContext.signal_type || '',
        sessionId: normalizedContext.sessionId || normalizedContext.session_id || '',
        caseStatus: normalizedContext.caseStatus || normalizedContext.case_status || '',
        caseOwnerAdminId: normalizedContext.caseOwnerAdminId || normalizedContext.case_owner_admin_id || '',
        caseOwnerLabel: normalizedContext.caseOwnerLabel || normalizedContext.case_owner_label || ''
    };
}

function resolveOpsAlertWorkspaceContextAttrs(context = {}) {
    return resolveOpsAlertWorkspaceContextAttrsBuilder()(context);
}

function resolveOpsAlertWorkspaceContextAttrsBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertWorkspaceContextAttrs',
        buildLocalOpsAlertWorkspaceContextAttrs
    );
}

function buildLocalOpsAlertMonitorContextAttrs(category = {}, item = {}) {
    return buildLocalOpsAlertWorkspaceContextAttrs(buildLocalOpsAlertMonitorActionContext(category, item));
}

function resolveOpsAlertMonitorContextAttrs(category = {}, item = {}) {
    return resolveOpsAlertWorkspaceContextAttrs(resolveOpsAlertMonitorActionContext(category, item));
}

function buildOpsAlertMonitorContextAttrs(category = {}, item = {}) {
    return resolveOpsAlertMonitorContextAttrs(category, item);
}

function buildOpsAlertMonitorWorkspaceAttrs(action = {}, category = {}, item = {}) {
    const attrs = {
        'data-admin-action': 'settings-open-ops-alert-workspace',
        'data-workspace-target': action.target || '',
        ...buildOpsAlertMonitorContextAttrs(category, item)
    };

    return Object.entries(attrs)
        .filter(([, value]) => String(value || '').length > 0)
        .map(([name, value]) => `${name}="${escapeConfigHtml(value)}"`)
        .join(' ');
}

function buildOpsAlertMonitorQuickActionAttrs(action = {}, category = {}, item = {}) {
    const attrs = {
        'data-admin-action': 'settings-handle-shop-risk-action',
        'data-shop-risk-action': action.action || '',
        ...buildOpsAlertMonitorContextAttrs(category, item)
    };

    return Object.entries(attrs)
        .filter(([, value]) => String(value || '').length > 0)
        .map(([name, value]) => `${name}="${escapeConfigHtml(value)}"`)
        .join(' ');
}

function buildOpsAlertMonitorCaseActionAttrs(action = {}, category = {}, item = {}) {
    const attrs = {
        'data-admin-action': 'settings-handle-shop-risk-case',
        'data-shop-risk-case-action': action.action || '',
        ...buildOpsAlertMonitorContextAttrs(category, item)
    };

    return Object.entries(attrs)
        .filter(([, value]) => String(value || '').length > 0)
        .map(([name, value]) => `${name}="${escapeConfigHtml(value)}"`)
        .join(' ');
}

function buildLocalOpsAlertMonitorItemMarkupState(item = {}, category = {}, precomputedState = null) {
    const displayState = precomputedState && typeof precomputedState === 'object' && !Array.isArray(precomputedState)
        ? precomputedState
        : resolveOpsAlertMonitorItemDisplayState(item, category);
    const caseActionStates = (Array.isArray(displayState?.caseActions) ? displayState.caseActions : []).map((action) => ({
        ...action,
        attrs: buildOpsAlertMonitorCaseActionAttrs(action, category, item)
    }));
    const quickActionState = displayState?.quickAction
        ? {
            ...displayState.quickAction,
            attrs: buildOpsAlertMonitorQuickActionAttrs(displayState.quickAction, category, item)
        }
        : null;
    const workspaceActionState = displayState?.workspaceAction
        ? {
            ...displayState.workspaceAction,
            attrs: buildOpsAlertMonitorWorkspaceAttrs(displayState.workspaceAction, category, item)
        }
        : null;
    const messageText = String(displayState?.message || item.message || '').trim();
    const autoResponseText = String(displayState?.autoResponseSummary || item.auto_response_summary || '').trim();
    const responseText = String(displayState?.responseSummary || item.response_summary || '').trim();
    const historyItems = Array.isArray(displayState?.historyItems) ? displayState.historyItems : [];

    return {
        ...displayState,
        titleText: String(displayState?.title || item.title || '系统告警').trim() || '系统告警',
        messageText,
        autoResponseText,
        responseText,
        historyItems,
        hasHistoryItems: historyItems.length > 0,
        caseActionStates,
        quickActionState,
        workspaceActionState,
        hasActions: caseActionStates.length > 0 || Boolean(quickActionState) || Boolean(workspaceActionState),
        metaText: String(displayState?.metaText || '等待更多上下文').trim() || '等待更多上下文'
    };
}

function resolveOpsAlertMonitorItemMarkupState(item = {}, category = {}, precomputedState = null) {
    return buildLocalOpsAlertMonitorItemMarkupState(item, category, precomputedState);
}

function buildOpsAlertMonitorItemMarkup(item = {}, category = {}, precomputedState = null) {
    const itemState = resolveOpsAlertMonitorItemMarkupState(item, category, precomputedState);

    return `
        <article class="ops-alert-monitor-item">
            <div class="ops-alert-monitor-item__top">
                ${(Array.isArray(itemState?.topBadges) ? itemState.topBadges : [])
        .map((badge) => buildOpsAlertMonitorBadge(badge.label, badge.tone)).join('')}
                <strong class="ops-alert-monitor-item__title">${escapeConfigHtml(itemState?.titleText || '系统告警')}</strong>
            </div>
            ${itemState?.messageText ? `<div class="ops-alert-monitor-item__summary">${escapeConfigHtml(itemState.messageText)}</div>` : ''}
            ${itemState?.progressText
        ? `<div class="ops-alert-monitor-item__summary"><strong>${escapeConfigHtml(itemState?.progressPrefix || '处理进度')}：</strong> ${escapeConfigHtml(itemState.progressText)}</div>`
        : ''}
            ${itemState?.hasHistoryItems ? `
                <div class="ops-alert-monitor-item__history">
                    ${itemState.historyItems.map((eventText) => `
                        <div class="ops-alert-monitor-item__history-item">${escapeConfigHtml(eventText)}</div>
                    `).join('')}
                </div>
            ` : ''}
            ${itemState?.autoResponseText ? `<div class="ops-alert-monitor-item__summary"><strong>自动处置：</strong> ${escapeConfigHtml(itemState.autoResponseText)}</div>` : ''}
            ${itemState?.responseText ? `<div class="ops-alert-monitor-item__summary">${escapeConfigHtml(itemState.responseText)}</div>` : ''}
            <div class="ops-alert-monitor-item__meta">${escapeConfigHtml(itemState?.metaText || '等待更多上下文')}</div>
            ${itemState?.hasActions ? `
                <div class="ops-alert-monitor-item__actions">
                    ${(Array.isArray(itemState?.caseActionStates) ? itemState.caseActionStates : []).map((action) => `
                        <button
                            type="button"
                            class="btn-add-config btn-add-config--compact"
                            ${action.attrs}
                        >
                            <i class="${escapeConfigHtml(action.icon)}"></i> ${escapeConfigHtml(action.label)}
                        </button>
                    `).join('')}
                    ${itemState?.quickActionState ? `
                        <button
                            type="button"
                            class="btn-add-config btn-add-config--compact"
                            ${itemState.quickActionState.attrs}
                        >
                            <i class="${escapeConfigHtml(itemState.quickActionState.icon)}"></i> ${escapeConfigHtml(itemState.quickActionState.label)}
                        </button>
                    ` : ''}
                    ${itemState?.workspaceActionState ? `
                        <button
                            type="button"
                            class="btn-add-config btn-add-config--compact"
                            ${itemState.workspaceActionState.attrs}
                        >
                            <i class="${escapeConfigHtml(itemState.workspaceActionState.icon)}"></i> ${escapeConfigHtml(itemState.workspaceActionState.label)}
                        </button>
                    ` : ''}
                </div>
            ` : ''}
        </article>
    `;
}

function buildLocalOpsAlertMonitorCategoryView(category = {}, filters = getOpsAlertMonitorViewFilters()) {
    const normalizedCategory = category && typeof category === 'object' && !Array.isArray(category)
        ? category
        : {};
    const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters)
        ? filters
        : getDefaultOpsAlertMonitorViewState();
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
        const severityMatchedItems = allItems.filter((item) => String(item.severity || '').trim().toLowerCase() === normalizedFilters.severity);
        if (!severityMatchedItems.length) {
            return null;
        }
    }

    const visibleItems = normalizedFilters.scope === 'recovered'
        ? []
        : allItems.filter((item) => (
            normalizedFilters.severity === 'all'
                ? true
                : String(item.severity || '').trim().toLowerCase() === normalizedFilters.severity
        ));
    const previewItems = visibleItems.slice(0, 3);
    const displayActiveCount = normalizedFilters.scope === 'recovered'
        ? 0
        : (normalizedFilters.severity === 'all' ? activeCount : visibleItems.length);
    const displayCriticalCount = normalizedFilters.scope === 'recovered'
        ? 0
        : (normalizedFilters.severity === 'all'
            ? criticalCount
            : visibleItems.filter((item) => String(item.severity || '').trim().toLowerCase() === 'critical').length);
    const filteredNote = !isRecoveredOnly
        && normalizedFilters.severity !== 'all'
        && activeCount > visibleItems.length
        ? `当前筛出 ${formatVerifyMonitorInteger(visibleItems.length)} 项 ${normalizedFilters.severity} 告警；模块原始待关注共 ${formatVerifyMonitorInteger(activeCount)} 项。`
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

function resolveOpsAlertMonitorCategoryView(category = {}, filters = getOpsAlertMonitorViewFilters()) {
    return resolveOpsAlertMonitorCategoryViewBuilder()(category, filters);
}

function buildOpsAlertMonitorCategoryView(category = {}, filters = getOpsAlertMonitorViewFilters()) {
    return resolveOpsAlertMonitorCategoryView(category, filters);
}

function resolveOpsAlertMonitorCategoryViewBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertMonitorCategoryView',
        buildLocalOpsAlertMonitorCategoryView,
        (category = {}, filters = getOpsAlertMonitorViewFilters()) => ({
            formatCount: formatVerifyMonitorInteger
        })
    );
}

function buildLocalOpsAlertMonitorFilterSummaryLabel(filters = getOpsAlertMonitorViewFilters()) {
    const scopeLabels = { all: '全部状态', active: '仅待处理', recovered: '仅已恢复' };
    const severityLabels = { all: '全部级别', critical: '仅 critical', warning: '仅 warning' };
    const categoryLabels = {
        all: '全部模块',
        payments: '支付与退款',
        tickets: '工单与售后',
        inventory: '库存与补货',
        fulfillment: '履约与死信',
        shop_risk: '商城风控'
    };

    return [scopeLabels[filters.scope], severityLabels[filters.severity], categoryLabels[filters.category]]
        .filter(Boolean)
        .join(' · ');
}

function resolveOpsAlertMonitorFilterSummaryLabel(filters = getOpsAlertMonitorViewFilters()) {
    return resolveOpsAlertMonitorFilterSummaryLabelBuilder()(filters);
}

function getOpsAlertMonitorFilterSummaryLabel(filters = getOpsAlertMonitorViewFilters()) {
    return resolveOpsAlertMonitorFilterSummaryLabel(filters);
}

function resolveOpsAlertMonitorFilterSummaryLabelBuilder() {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertMonitorFilterSummaryLabel',
        buildLocalOpsAlertMonitorFilterSummaryLabel
    );
}

function buildLocalOpsAlertMonitorRecoveryRow(category = {}) {
    const fallbackAction = getOpsAlertMonitorCategoryActions(category.key)[0] || {};
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
        处理入口: workspaceTarget ? getOpsAlertWorkspaceSuccessLabel(workspaceTarget) : '',
        入口标识: workspaceTarget,
        创建时间: category.latest_at || '',
        目标标识: ''
    };
}

function resolveOpsAlertMonitorRecoveryRow(category = {}) {
    return resolveOpsAlertMonitorRecoveryRowBuilder()(category);
}

function buildOpsAlertMonitorRecoveryRow(category = {}) {
    return resolveOpsAlertMonitorRecoveryRow(category);
}

function resolveOpsAlertMonitorRecoveryRowBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertMonitorRecoveryRow',
        buildLocalOpsAlertMonitorRecoveryRow,
        (category = {}) => ({
            resolveCategoryFallbackAction: (currentCategory) => getOpsAlertMonitorCategoryActions(currentCategory?.key)[0] || {},
            getWorkspaceLabel: (workspaceTarget) => getOpsAlertWorkspaceSuccessLabel(workspaceTarget)
        })
    );
}

function buildLocalOpsAlertMonitorBatchRows(categories = [], filters = getOpsAlertMonitorViewFilters(), categoryKey = '') {
    const normalizedCategoryKey = String(categoryKey || '').trim().toLowerCase();
    const selectedCategories = normalizedCategoryKey
        ? categories.filter((category) => String(category.key || '').trim().toLowerCase() === normalizedCategoryKey)
        : categories;

    return selectedCategories.flatMap((category) => {
        const visibleItems = Array.isArray(category.visible_items) ? category.visible_items : [];
        if (visibleItems.length > 0) {
            return visibleItems.map((item) => {
                const action = getOpsAlertMonitorItemAction(category, item) || {};
                const workspaceTarget = String(action.target || '').trim();
                return {
                    模块: category.label || '告警分类',
                    状态: '待处理',
                    级别: String(item.severity || 'warning').trim().toLowerCase() || 'warning',
                    告警类型: item.alert_type || '',
                    标题: item.title || '系统告警',
                    摘要: item.message || '',
                    引用标签: item.reference_label || '',
                    引用值: item.reference_value || '',
                    处理动作: action.label || '进入处理页',
                    处理入口: workspaceTarget ? getOpsAlertWorkspaceSuccessLabel(workspaceTarget) : '',
                    入口标识: workspaceTarget,
                    创建时间: item.created_at || '',
                    目标标识: item.target_id || ''
                };
            });
        }

        if (String(category.latest_state || '').trim().toLowerCase() === 'recovered') {
            return [buildLocalOpsAlertMonitorRecoveryRow(category)];
        }

        return [];
    });
}

function resolveOpsAlertMonitorBatchRows(categories = [], filters = getOpsAlertMonitorViewFilters(), categoryKey = '') {
    return resolveOpsAlertMonitorBatchRowsBuilder()(categories, filters, categoryKey);
}

function buildOpsAlertMonitorBatchRows(categories = [], filters = getOpsAlertMonitorViewFilters(), categoryKey = '') {
    return resolveOpsAlertMonitorBatchRows(categories, filters, categoryKey);
}

function resolveOpsAlertMonitorBatchRowsBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertMonitorBatchRows',
        buildLocalOpsAlertMonitorBatchRows,
        (categories = [], filters = getOpsAlertMonitorViewFilters(), categoryKey = '') => ({
            resolveCategoryFallbackAction: (category) => getOpsAlertMonitorCategoryActions(category?.key)[0] || {},
            resolveItemAction: (category, item) => getOpsAlertMonitorItemAction(category, item) || {},
            getWorkspaceLabel: (workspaceTarget) => getOpsAlertWorkspaceSuccessLabel(workspaceTarget)
        })
    );
}

async function writeAdminConfigClipboard(text) {
    const normalizedText = String(text || '');
    if (!normalizedText) {
        throw new Error('没有可复制的内容');
    }

    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalizedText);
        return true;
    }

    const textarea = document.createElement('textarea');
    textarea.value = normalizedText;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, normalizedText.length);

    try {
        const succeeded = document.execCommand('copy');
        if (!succeeded) {
            throw new Error('浏览器不支持复制到剪贴板');
        }
        return true;
    } finally {
        document.body.removeChild(textarea);
    }
}

function buildLocalOpsAlertMonitorChecklistText(rows = [], filters = getOpsAlertMonitorViewFilters(), categoryKey = '') {
    const normalizedCategoryKey = String(categoryKey || '').trim().toLowerCase();
    const categoryLabelMap = {
        payments: '支付与退款',
        tickets: '工单与售后',
        inventory: '库存与补货',
        fulfillment: '履约与死信',
        shop_risk: '商城风控'
    };
    const lines = [
        '第一阶段集中告警处理清单',
        `生成时间：${formatVerifyMonitorDateTime(new Date().toISOString())}`,
        `当前筛选：${getOpsAlertMonitorFilterSummaryLabel(filters)}`
    ];

    if (normalizedCategoryKey && categoryLabelMap[normalizedCategoryKey]) {
        lines.push(`当前模块：${categoryLabelMap[normalizedCategoryKey]}`);
    }

    lines.push(`命中记录：${formatVerifyMonitorInteger(rows.length)} 条`, '');

    rows.forEach((row, index) => {
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
            lines.push(`   时间：${formatVerifyMonitorDateTime(row.创建时间)}`);
        }
        lines.push('');
    });

    return lines.join('\n').trim();
}

function resolveOpsAlertMonitorChecklistText(rows = [], filters = getOpsAlertMonitorViewFilters(), categoryKey = '') {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertMonitorChecklistText',
        buildLocalOpsAlertMonitorChecklistText,
        () => ({
            now: new Date().toISOString(),
            formatDateTime: formatVerifyMonitorDateTime,
            formatCount: formatVerifyMonitorInteger,
            getFilterSummaryLabel: getOpsAlertMonitorFilterSummaryLabel
        })
    )(rows, filters, categoryKey);
}

function buildOpsAlertMonitorChecklistText(rows = [], filters = getOpsAlertMonitorViewFilters(), categoryKey = '') {
    return resolveOpsAlertMonitorChecklistText(rows, filters, categoryKey);
}

function getOpsAlertRiskSpotlightCategory(filters = getOpsAlertMonitorViewFilters()) {
    const rawCategory = (Array.isArray(opsAlertMonitorState?.categories) ? opsAlertMonitorState.categories : [])
        .find((category) => String(category?.key || '').trim().toLowerCase() === 'shop_risk');
    if (!rawCategory) {
        return null;
    }

    return buildOpsAlertMonitorCategoryView(rawCategory, {
        ...filters,
        category: 'all'
    });
}

function getOpsAlertMonitorAutoResponseTone(status) {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (['applied', 'already_inactive', 'already_blocked'].includes(normalizedStatus)) return 'success';
    if (['failed', 'not_found'].includes(normalizedStatus)) return 'danger';
    if (normalizedStatus === 'auto_response_disabled') return 'neutral';
    return 'warning';
}

function buildOpsAlertRiskThresholdBadges(category = {}) {
    const badgeItems = Array.isArray(category)
        ? category
        : null;
    const thresholds = !badgeItems && category?.thresholds && typeof category.thresholds === 'object'
        ? category.thresholds
        : null;
    const normalizedBadges = badgeItems || (thresholds ? [
        {
            label: thresholds.auto_response_enabled ? '自动处置开启' : '自动处置关闭',
            tone: thresholds.auto_response_enabled ? 'warning' : 'neutral'
        },
        {
            label: `停券 ≥ ${formatVerifyMonitorInteger(thresholds.auto_disable_coupon_min_risk_score || 0)}`,
            tone: 'neutral'
        },
        {
            label: `封禁 ≥ ${formatVerifyMonitorInteger(thresholds.auto_ban_user_min_risk_score || 0)}`,
            tone: 'neutral'
        },
        {
            label: `封禁 ${formatVerifyMonitorInteger(thresholds.auto_ban_user_duration_days || 0)} 天`,
            tone: 'neutral'
        },
        {
            label: `下架 ≥ ${formatVerifyMonitorInteger(thresholds.auto_suspend_product_min_risk_score || 0)}`,
            tone: 'neutral'
        }
    ] : []);
    if (!normalizedBadges.length) {
        return '';
    }

    return `
        <div class="ops-alert-risk-spotlight__thresholds">
            ${normalizedBadges.map((badge) => buildOpsAlertMonitorBadge(badge.label, badge.tone)).join('')}
        </div>
    `;
}

function buildOpsAlertRiskSpotlightActivityItem(item = {}, kind = 'threshold') {
    if (item && typeof item === 'object' && item.title && item.statusLabel && item.statusTone) {
        return `
            <div class="ops-alert-risk-spotlight__entry">
                <div class="ops-alert-risk-spotlight__entry-top">
                    <strong class="ops-alert-risk-spotlight__entry-title">${escapeConfigHtml(item.title)}</strong>
                    ${buildOpsAlertMonitorBadge(item.statusLabel, item.statusTone)}
                </div>
                <div class="ops-alert-risk-spotlight__entry-summary">${escapeConfigHtml(item.summary || '等待更多上下文')}</div>
                <div class="ops-alert-risk-spotlight__entry-meta">${escapeConfigHtml(item.meta || '等待更多上下文')}</div>
            </div>
        `;
    }

    const normalizedKind = String(kind || 'threshold').trim().toLowerCase();
    const statusLabel = item.status_label || '待人工确认';
    const statusTone = getOpsAlertMonitorAutoResponseTone(item.status);
    const title = normalizedKind === 'auto'
        ? `${item.action_label || '自动处置'} · ${item.target || item.reference_value || item.title || '未知目标'}`
        : `${item.action_label || '阈值命中'} · ${item.reference_value || item.title || '未知目标'}`;
    const referenceValue = String(item.reference_value || '').trim();
    const metaParts = [];

    if (normalizedKind === 'threshold' && Number.isFinite(Number(item.risk_score)) && Number.isFinite(Number(item.threshold))) {
        metaParts.push(`分数 ${formatVerifyMonitorInteger(item.risk_score)} / 阈值 ${formatVerifyMonitorInteger(item.threshold)}`);
    }

    if (item.reference_label && referenceValue && !title.includes(referenceValue)) {
        metaParts.push(`${item.reference_label}：${referenceValue}`);
    }

    if (item.created_at) {
        metaParts.push(formatVerifyMonitorDateTime(item.created_at));
    }

    return `
        <div class="ops-alert-risk-spotlight__entry">
            <div class="ops-alert-risk-spotlight__entry-top">
                <strong class="ops-alert-risk-spotlight__entry-title">${escapeConfigHtml(title)}</strong>
                ${buildOpsAlertMonitorBadge(statusLabel, statusTone)}
            </div>
            <div class="ops-alert-risk-spotlight__entry-summary">${escapeConfigHtml(item.summary || item.title || '等待更多上下文')}</div>
            <div class="ops-alert-risk-spotlight__entry-meta">${escapeConfigHtml(metaParts.join(' · ') || '等待更多上下文')}</div>
        </div>
    `;
}

function buildOpsAlertRiskSpotlightActivitySection(title, items = [], emptyMessage = '', kind = 'threshold') {
    const normalizedItems = Array.isArray(items) ? items : [];
    return `
        <section class="ops-alert-risk-spotlight__panel">
            <div class="ops-alert-risk-spotlight__panel-title">${escapeConfigHtml(title)}</div>
            <div class="ops-alert-risk-spotlight__panel-list">
                ${normalizedItems.length
        ? normalizedItems.map((item) => buildOpsAlertRiskSpotlightActivityItem(item, kind)).join('')
        : `<div class="ops-alert-risk-spotlight__panel-empty">${escapeConfigHtml(emptyMessage || '暂无记录')}</div>`}
            </div>
        </section>
    `;
}

function buildLocalOpsAlertRiskSpotlightRenderState(category = null, filters = getOpsAlertMonitorViewFilters()) {
    const spotlightCategory = category && typeof category === 'object' && !Array.isArray(category)
        ? category
        : null;
    const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters)
        ? filters
        : {};

    return {
        tone: spotlightCategory ? getOpsAlertMonitorCardTone(spotlightCategory) : 'neutral',
        eyebrow: '商城风控优先处理',
        title: '当前没有可展示的商城风控快照',
        summary: spotlightCategory
            ? '最近没有持续中的商城风控告警，下面保留订单、优惠券码和用户处理入口。'
            : (
                normalizedFilters.severity !== 'all' || normalizedFilters.scope !== 'all'
                    ? '当前筛选条件下没有命中的商城风控信号，可以切回“全部状态 / 全部级别”查看全量快照。'
                    : '最近没有持续中的商城风控告警，下面保留订单、优惠券码和用户处理入口。'
            ),
        statBadges: [{ label: '等待更多上下文', tone: 'neutral' }],
        thresholdBadges: [],
        sections: {
            threshold: {
                title: '最近阈值命中',
                emptyMessage: '最近没有新的风控阈值命中记录。',
                items: []
            },
            auto: {
                title: '最近自动处置',
                emptyMessage: '最近没有新的自动停券、封禁或下架记录。',
                items: []
            }
        },
        actions: [
            {
                actionName: 'settings-copy-ops-alert-monitor-category',
                icon: 'fas fa-list-check',
                label: '复制商城风控清单',
                attrs: {
                    'data-ops-alert-monitor-category-key': 'shop_risk'
                }
            },
            ...getOpsAlertMonitorCategoryActions('shop_risk').map((action) => ({
                actionName: 'settings-open-ops-alert-workspace',
                icon: action.icon,
                label: action.label,
                attrs: {
                    'data-workspace-target': action.target
                }
            }))
        ]
    };
}

function resolveOpsAlertRiskSpotlightRenderStateBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertRiskSpotlightRenderState',
        buildLocalOpsAlertRiskSpotlightRenderState,
        () => ({
            getCardTone: getOpsAlertMonitorCardTone,
            getDisplayActiveCount: getOpsAlertMonitorDisplayActiveCount,
            getDisplayCriticalCount: getOpsAlertMonitorDisplayCriticalCount,
            getAutoResponseTone: getOpsAlertMonitorAutoResponseTone,
            getCategoryActions: () => getOpsAlertMonitorCategoryActions('shop_risk'),
            getQuickAction: getOpsAlertMonitorItemQuickAction,
            formatCount: formatVerifyMonitorInteger,
            formatDateTime: formatVerifyMonitorDateTime
        })
    );
}

function resolveOpsAlertRiskSpotlightRenderState(category = null, filters = getOpsAlertMonitorViewFilters()) {
    return resolveOpsAlertRiskSpotlightRenderStateBuilder()(category, filters);
}

function buildLocalOpsAlertRiskSpotlightShellState(status = 'loading', options = {}) {
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
            { label: isError ? '加载失败' : '等待加载', tone: isError ? 'danger' : 'neutral' }
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

function resolveOpsAlertRiskSpotlightShellStateBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertRiskSpotlightShellState',
        buildLocalOpsAlertRiskSpotlightShellState,
        (status = 'loading', options = {}) => ({
            message: options.message
        })
    );
}

function resolveOpsAlertRiskSpotlightShellState(status = 'loading', options = {}) {
    return resolveOpsAlertRiskSpotlightShellStateBuilder()(status, options);
}

function buildOpsAlertRiskSpotlightMarkupFromState(resolvedState = {}, options = {}) {
    const normalizedState = resolvedState && typeof resolvedState === 'object' && !Array.isArray(resolvedState)
        ? resolvedState
        : {};
    const fallbackCategory = options.fallbackCategory && typeof options.fallbackCategory === 'object' && !Array.isArray(options.fallbackCategory)
        ? options.fallbackCategory
        : null;
    const stats = (Array.isArray(normalizedState.statBadges) ? normalizedState.statBadges : [])
        .map((badge) => buildOpsAlertMonitorBadge(badge?.label || '—', badge?.tone || 'neutral'));
    const thresholdSection = normalizedState.sections?.threshold || null;
    const autoSection = normalizedState.sections?.auto || null;
    const thresholdBadgeMarkup = (Array.isArray(normalizedState.thresholdBadges) && normalizedState.thresholdBadges.length)
        ? buildOpsAlertRiskThresholdBadges(normalizedState.thresholdBadges)
        : (fallbackCategory ? buildOpsAlertRiskThresholdBadges(fallbackCategory) : '');
    const resolvedActions = Array.isArray(normalizedState.actions) && normalizedState.actions.length
        ? normalizedState.actions
        : [];
    const shouldRenderPanels = options.includePanels !== false && (thresholdSection || autoSection);

    return `
        <div class="ops-alert-risk-spotlight ops-alert-risk-spotlight--${escapeConfigHtml(normalizedState.tone || 'neutral')}">
            <div class="ops-alert-risk-spotlight__copy">
                <div class="ops-alert-risk-spotlight__eyebrow">${escapeConfigHtml(normalizedState.eyebrow || '商城风控优先处理')}</div>
                <div class="ops-alert-risk-spotlight__title">${escapeConfigHtml(normalizedState.title || '')}</div>
                <div class="ops-alert-risk-spotlight__summary">${escapeConfigHtml(normalizedState.summary || '')}</div>
            </div>
            <div class="ops-alert-risk-spotlight__stats">
                ${stats.join('')}
            </div>
            ${thresholdBadgeMarkup}
            ${shouldRenderPanels ? `
                <div class="ops-alert-risk-spotlight__panels">
                    ${buildOpsAlertRiskSpotlightActivitySection(
        thresholdSection?.title || '最近阈值命中',
        thresholdSection?.items || [],
        thresholdSection?.emptyMessage || '最近没有新的风控阈值命中记录。',
        'threshold'
    )}
                    ${buildOpsAlertRiskSpotlightActivitySection(
        autoSection?.title || '最近自动处置',
        autoSection?.items || [],
        autoSection?.emptyMessage || '最近没有新的自动停券、封禁或下架记录。',
        'auto'
    )}
                </div>
            ` : ''}
            ${resolvedActions.length ? `
                <div class="ops-alert-risk-spotlight__actions">
                    ${resolvedActions.map((action) => `
                        <button
                            type="button"
                            class="btn-add-config btn-add-config--compact"
                            data-admin-action="${escapeConfigHtml(action.actionName || '')}"
                            ${Object.entries(action.attrs || {})
        .filter(([, value]) => String(value || '').length > 0)
        .map(([name, value]) => `${name}="${escapeConfigHtml(value)}"`).join(' ')}
                        >
                            <i class="${escapeConfigHtml(action.icon || 'fas fa-circle-dot')}"></i> ${escapeConfigHtml(action.label || '操作')}
                        </button>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

function buildOpsAlertRiskSpotlightShellMarkup(shellState = {}) {
    return buildOpsAlertRiskSpotlightMarkupFromState(shellState, {
        includePanels: false
    });
}

function buildOpsAlertRiskSpotlightMarkup(category = null, filters = getOpsAlertMonitorViewFilters()) {
    const spotlightCategory = category && typeof category === 'object' && !Array.isArray(category) ? category : null;
    return buildOpsAlertRiskSpotlightMarkupFromState(
        resolveOpsAlertRiskSpotlightRenderState(category, filters),
        { fallbackCategory: spotlightCategory }
    );
}

function buildLocalOpsAlertRiskSpotlightMarkupState(state = opsAlertMonitorState || getDefaultOpsAlertMonitorState(), filters = getOpsAlertMonitorViewFilters()) {
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : getDefaultOpsAlertMonitorState();
    const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters)
        ? filters
        : getDefaultOpsAlertMonitorViewState();

    if (normalizedState.status === 'loading') {
        return {
            bodyMarkup: buildOpsAlertRiskSpotlightMarkup(null, normalizedFilters)
        };
    }

    if (normalizedState.status === 'error') {
        return {
            bodyMarkup: buildOpsAlertRiskSpotlightShellMarkup(
                resolveOpsAlertRiskSpotlightShellState(normalizedState.status, {
                    message: normalizedState.message
                })
            )
        };
    }

    return {
        bodyMarkup: buildOpsAlertRiskSpotlightMarkup(getOpsAlertRiskSpotlightCategory(normalizedFilters), normalizedFilters)
    };
}

function resolveOpsAlertRiskSpotlightMarkupState(state = opsAlertMonitorState || getDefaultOpsAlertMonitorState(), filters = getOpsAlertMonitorViewFilters()) {
    return buildLocalOpsAlertRiskSpotlightMarkupState(state, filters);
}

function applyOpsAlertRiskSpotlightMarkupState(markupState = {}, target = null) {
    return applyOpsAlertBodyMarkupState(markupState, target);
}

function renderOpsAlertRiskSpotlight(filters = getOpsAlertMonitorViewFilters()) {
    renderOpsAlertBodyMarkupTarget(
        'opsAlertRiskSpotlight',
        () => resolveOpsAlertRiskSpotlightMarkupState(
            opsAlertMonitorState || getDefaultOpsAlertMonitorState(),
            filters
        )
    );
}

function buildLocalOpsAlertMonitorSignedCount(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num === 0) return '0';
    return `${num > 0 ? '+' : ''}${formatVerifyMonitorInteger(num)}`;
}

function resolveOpsAlertMonitorSignedCount(value) {
    return resolveOpsAlertSharedCallable(
        'formatAdminWorkbenchOpsAlertSignedCount',
        buildLocalOpsAlertMonitorSignedCount,
        () => ({
            formatCount: formatVerifyMonitorInteger
        })
    )(value);
}

function formatOpsAlertMonitorSignedCount(value) {
    return resolveOpsAlertMonitorSignedCount(value);
}

function buildLocalOpsAlertMonitorTimeShort(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

function resolveOpsAlertMonitorTimeShort(value) {
    return resolveOpsAlertSharedCallable(
        'formatAdminWorkbenchOpsAlertTimeShort',
        buildLocalOpsAlertMonitorTimeShort,
        () => ({
            locale: 'zh-CN'
        })
    )(value);
}

function formatOpsAlertMonitorTimeShort(value) {
    return resolveOpsAlertMonitorTimeShort(value);
}

function buildLocalOpsAlertMonitorBacklogDeltaTone(delta) {
    const numericDelta = Number(delta || 0);
    if (numericDelta < 0) return 'success';
    if (numericDelta > 0) return 'warning';
    return 'neutral';
}

function resolveOpsAlertMonitorBacklogDeltaTone(delta) {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertBacklogDeltaTone',
        buildLocalOpsAlertMonitorBacklogDeltaTone
    )(delta);
}

function getOpsAlertMonitorBacklogDeltaTone(delta) {
    return resolveOpsAlertMonitorBacklogDeltaTone(delta);
}

function buildLocalOpsAlertMonitorShiftReportView(value = 'all') {
    const normalized = String(value || '').trim().toLowerCase();
    return OPS_ALERT_MONITOR_SHIFT_REPORT_VIEW_DEFINITIONS.some((item) => item.key === normalized)
        ? normalized
        : getDefaultOpsAlertMonitorShiftReportViewState();
}

function resolveOpsAlertMonitorShiftReportViewNormalizer() {
    return resolveOpsAlertSharedCallable(
        'normalizeAdminWorkbenchOpsAlertMonitorShiftReportView',
        buildLocalOpsAlertMonitorShiftReportView,
        () => ({
            viewDefinitions: OPS_ALERT_MONITOR_SHIFT_REPORT_VIEW_DEFINITIONS,
            defaultView: getDefaultOpsAlertMonitorShiftReportViewState()
        })
    );
}

function resolveOpsAlertMonitorShiftReportView(value = 'all') {
    return resolveOpsAlertMonitorShiftReportViewNormalizer()(value);
}

function normalizeOpsAlertMonitorShiftReportView(value = 'all') {
    return resolveOpsAlertMonitorShiftReportView(value);
}

function buildLocalOpsAlertMonitorShiftReportViewMeta(value = opsAlertMonitorShiftReportViewState) {
    const normalized = resolveOpsAlertMonitorShiftReportView(value);
    return OPS_ALERT_MONITOR_SHIFT_REPORT_VIEW_DEFINITIONS.find((item) => item.key === normalized)
        || OPS_ALERT_MONITOR_SHIFT_REPORT_VIEW_DEFINITIONS[0];
}

function resolveOpsAlertMonitorShiftReportViewMeta(value = opsAlertMonitorShiftReportViewState) {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertMonitorShiftReportViewMeta',
        buildLocalOpsAlertMonitorShiftReportViewMeta,
        () => ({
            viewDefinitions: OPS_ALERT_MONITOR_SHIFT_REPORT_VIEW_DEFINITIONS,
            defaultView: getDefaultOpsAlertMonitorShiftReportViewState()
        })
    )(value);
}

function getOpsAlertMonitorShiftReportViewMeta(value = opsAlertMonitorShiftReportViewState) {
    return resolveOpsAlertMonitorShiftReportViewMeta(value);
}

function buildLocalOpsAlertMonitorShiftReportCurrentAdminId() {
    return String(opsAlertMonitorState?.current_admin_id || '').trim();
}

function resolveOpsAlertMonitorShiftReportCurrentAdminId() {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertMonitorCurrentAdminId',
        buildLocalOpsAlertMonitorShiftReportCurrentAdminId
    )(opsAlertMonitorState);
}

function getOpsAlertMonitorShiftReportCurrentAdminId() {
    return resolveOpsAlertMonitorShiftReportCurrentAdminId();
}

function buildLocalOpsAlertMonitorShiftOwnedCategoryItems(categories = [], currentAdminId = resolveOpsAlertMonitorShiftReportCurrentAdminId()) {
    const normalizedCurrentAdminId = String(currentAdminId || '').trim();
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
            return String(left.label || '').localeCompare(String(right.label || ''), 'zh-CN');
        });
}

function resolveOpsAlertMonitorShiftOwnedCategoryItemsBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertMonitorShiftOwnedCategoryItems',
        buildLocalOpsAlertMonitorShiftOwnedCategoryItems,
        () => ({
            locale: 'zh-CN'
        })
    );
}

function resolveOpsAlertMonitorShiftOwnedCategoryItems(categories = [], currentAdminId = resolveOpsAlertMonitorShiftReportCurrentAdminId()) {
    return resolveOpsAlertMonitorShiftOwnedCategoryItemsBuilder()(categories, currentAdminId);
}

function buildOpsAlertMonitorShiftReportOwnedCategoryItems(categories = [], currentAdminId = resolveOpsAlertMonitorShiftReportCurrentAdminId()) {
    return resolveOpsAlertMonitorShiftOwnedCategoryItems(categories, currentAdminId);
}

function getOpsAlertMonitorShiftResolvedViewLabel(value = opsAlertMonitorShiftReportViewState) {
    return String(getOpsAlertMonitorShiftReportViewMeta(value)?.label || '全部视角').trim() || '全部视角';
}

function buildOpsAlertMonitorShiftSharedRuntimeState(currentAdminLabel = '') {
    const options = arguments[1] && typeof arguments[1] === 'object' && !Array.isArray(arguments[1])
        ? arguments[1]
        : {};
    const currentAdminId = getOpsAlertMonitorShiftReportCurrentAdminId();
    const runtimeState = {
        currentView: opsAlertMonitorShiftReportViewState,
        currentAdminId,
        currentAdminLabel,
        ownedCategoryItems: buildOpsAlertMonitorShiftReportOwnedCategoryItems(opsAlertMonitorState?.categories, currentAdminId)
    };
    if (options.includeGeneratedAt === true) {
        runtimeState.generatedAt = String(options.generatedAt || new Date().toISOString()).trim();
    }
    return runtimeState;
}

function buildOpsAlertMonitorShiftSharedOptions(overrides = {}) {
    return {
        viewDefinitions: OPS_ALERT_MONITOR_SHIFT_REPORT_VIEW_DEFINITIONS,
        defaultView: getDefaultOpsAlertMonitorShiftReportViewState(),
        defaultReport: getDefaultOpsAlertMonitorShiftReport(),
        ...overrides
    };
}

function resolveOpsAlertMonitorShiftRuntimeSharedBuilder(methodName = '', localCallable = null, optionsBuilder = null, runtimeStateBuilder = null) {
    const sharedMethod = resolveOpsAlertSharedRuntimeMethod(methodName);
    if (typeof sharedMethod === 'function') {
        return (...args) => {
            const shiftRuntimeState = typeof runtimeStateBuilder === 'function'
                ? runtimeStateBuilder(...args)
                : buildOpsAlertMonitorShiftSharedRuntimeState(args[1] || '');
            const options = typeof optionsBuilder === 'function'
                ? (optionsBuilder(...args, shiftRuntimeState) || {})
                : {};
            return sharedMethod(args[0], shiftRuntimeState, options);
        };
    }
    return typeof localCallable === 'function' ? localCallable : (() => undefined);
}

function buildLocalOpsAlertMonitorShiftShellState(status = 'loading', options = {}) {
    const normalizedStatus = String(status || 'loading').trim().toLowerCase();
    if (normalizedStatus === 'error') {
        return {
            status: 'error',
            eyebrow: '本班处理统计 / 交班视图',
            title: '交班报表加载失败',
            summary: String(options.message || '请刷新面板后重试。'),
            badges: [{ label: '加载失败', tone: 'danger' }],
            metrics: []
        };
    }
    return {
        status: 'loading',
        eyebrow: '本班处理统计 / 交班视图',
        title: '正在汇总认领、转交、关闭和积压趋势...',
        summary: '会优先给出本班处理量、当前积压和交班时最值得说明的几块模块。',
        badges: [{ label: '等待加载', tone: 'neutral' }],
        metrics: [
            { label: '本班认领', value: '—' },
            { label: '转交 / 接手', value: '—' },
            { label: '本班关闭', value: '—' },
            { label: '平均闭环', value: '—' },
            { label: '当前积压', value: '—' },
            { label: '最长等待', value: '—' }
        ]
    };
}

function resolveOpsAlertMonitorShiftShellStateBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertMonitorShiftShellState',
        buildLocalOpsAlertMonitorShiftShellState,
        (status = 'loading', options = {}) => ({
            message: options.message
        })
    );
}

function resolveOpsAlertMonitorShiftShellState(status = 'loading', options = {}) {
    return resolveOpsAlertMonitorShiftShellStateBuilder()(status, options);
}

function buildOpsAlertMonitorShiftShellMarkup(shellState = {}) {
    const resolvedShellState = shellState && typeof shellState === 'object' && !Array.isArray(shellState)
        ? shellState
        : buildLocalOpsAlertMonitorShiftShellState();
    return `
        <div class="ops-alert-shift-report${resolvedShellState.status === 'error' ? ' ops-alert-shift-report--danger' : ''}">
            <div class="ops-alert-shift-report__head">
                <div class="ops-alert-shift-report__copy">
                    <div class="ops-alert-shift-report__eyebrow">${escapeConfigHtml(resolvedShellState.eyebrow || '本班处理统计 / 交班视图')}</div>
                    <div class="ops-alert-shift-report__title">${escapeConfigHtml(resolvedShellState.title || '')}</div>
                    <div class="ops-alert-shift-report__summary">${escapeConfigHtml(resolvedShellState.summary || '')}</div>
                </div>
                <div class="ops-alert-shift-report__stats">
                    ${(Array.isArray(resolvedShellState.badges) ? resolvedShellState.badges : [])
        .map((badge) => buildOpsAlertMonitorBadge(badge.label, badge.tone))
        .join('')}
                </div>
            </div>
            ${Array.isArray(resolvedShellState.metrics) && resolvedShellState.metrics.length ? `
                <div class="ops-alert-shift-report__metrics">
                    ${resolvedShellState.metrics.map((metric) => buildOpsAlertMonitorShiftMetricMarkup(metric)).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

function buildLocalOpsAlertMonitorShiftRenderState(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = '') {
    return {
        normalizedReport: normalizeOpsAlertMonitorShiftReport(report),
        currentView: normalizeOpsAlertMonitorShiftReportView(opsAlertMonitorShiftReportViewState),
        actionButtons: [
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
        ],
        viewSwitchState: null,
        trendState: null,
        reportState: {
            headline: '交班报表暂不可用',
            summary: '共享工作台运行时尚未就绪，请刷新页面后重试。',
            headerBadges: [{ label: '降级模式', tone: 'warning' }],
            metrics: [],
            panelTitles: {
                categories: '当前积压模块',
                admins: '人员工作量',
                trend: '积压趋势',
                closeReasons: '关闭原因分布'
            }
        },
        panelStates: { sections: {} },
        shiftRuntimeState: buildOpsAlertMonitorShiftSharedRuntimeState(currentAdminLabel)
    };
}

function resolveOpsAlertMonitorShiftRenderStateBuilder() {
    return resolveOpsAlertMonitorShiftRuntimeSharedBuilder(
        'buildAdminWorkbenchOpsAlertMonitorShiftRenderState',
        buildLocalOpsAlertMonitorShiftRenderState,
        (report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = '', shiftRuntimeState = buildOpsAlertMonitorShiftSharedRuntimeState(currentAdminLabel)) => buildOpsAlertMonitorShiftSharedOptions({
            viewDefinitions: OPS_ALERT_MONITOR_SHIFT_REPORT_VIEW_DEFINITIONS,
            defaultView: getDefaultOpsAlertMonitorShiftReportViewState(),
            defaultReport: getDefaultOpsAlertMonitorShiftReport(),
            formatCount: formatVerifyMonitorInteger,
            formatMinutes: formatVerifyMonitorMinutes,
            formatSignedCount: formatOpsAlertMonitorSignedCount,
            formatTimeShort: formatOpsAlertMonitorTimeShort,
            getBacklogDeltaTone: getOpsAlertMonitorBacklogDeltaTone
        }),
        (report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = '') => buildOpsAlertMonitorShiftSharedRuntimeState(currentAdminLabel)
    );
}

function resolveOpsAlertMonitorShiftRenderState(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = '') {
    return resolveOpsAlertMonitorShiftRenderStateBuilder()(report, currentAdminLabel);
}

function buildLocalOpsAlertMonitorShiftViewSwitchState(currentView = opsAlertMonitorShiftReportViewState) {
    const normalizedView = normalizeOpsAlertMonitorShiftReportView(currentView);
    const viewMeta = getOpsAlertMonitorShiftReportViewMeta(normalizedView);
    return {
        currentView: normalizedView,
        label: '交班视角',
        chips: OPS_ALERT_MONITOR_SHIFT_REPORT_VIEW_DEFINITIONS.map((item) => ({
            key: item.key,
            label: item.label,
            active: item.key === normalizedView
        })),
        summaryText: viewMeta.description || ''
    };
}

function resolveOpsAlertMonitorShiftViewSwitchStateBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertMonitorShiftViewSwitchState',
        buildLocalOpsAlertMonitorShiftViewSwitchState,
        () => ({
            viewDefinitions: OPS_ALERT_MONITOR_SHIFT_REPORT_VIEW_DEFINITIONS,
            defaultView: getDefaultOpsAlertMonitorShiftReportViewState()
        })
    );
}

function resolveOpsAlertMonitorShiftViewSwitchState(currentView = opsAlertMonitorShiftReportViewState) {
    return resolveOpsAlertMonitorShiftViewSwitchStateBuilder()(currentView);
}

function buildOpsAlertMonitorShiftReportViewSwitchMarkup(currentView = opsAlertMonitorShiftReportViewState, precomputedState = null) {
    const sharedViewSwitchState = precomputedState || resolveOpsAlertMonitorShiftViewSwitchState(currentView);

    return `
        <div class="ops-alert-shift-report__view-switch">
            <span class="ops-alert-shift-report__view-label">${escapeConfigHtml(sharedViewSwitchState.label)}</span>
            <div class="ops-alert-shift-report__view-chips">
                ${sharedViewSwitchState.chips.map((item) => `
                    <button
                        type="button"
                        class="ops-alert-shift-report__view-chip${item.active ? ' is-active' : ''}"
                        data-admin-action="settings-set-ops-alert-shift-report-view"
                        data-ops-alert-shift-report-view="${escapeConfigHtml(item.key)}"
                    >
                        ${escapeConfigHtml(item.label)}
                    </button>
                `).join('')}
            </div>
            <div class="ops-alert-shift-report__view-summary">${escapeConfigHtml(sharedViewSwitchState.summaryText || '')}</div>
        </div>
    `;
}

function buildOpsAlertMonitorShiftMetricMarkup({ label = '', value = '—', detail = '', tone = 'neutral' } = {}) {
    return `
        <article class="ops-alert-shift-report__metric ops-alert-shift-report__metric--${escapeConfigHtml(tone)}">
            <span class="ops-alert-shift-report__metric-label">${escapeConfigHtml(label)}</span>
            <strong class="ops-alert-shift-report__metric-value">${escapeConfigHtml(value)}</strong>
            <span class="ops-alert-shift-report__metric-detail">${escapeConfigHtml(detail || '等待更多上下文')}</span>
        </article>
    `;
}

function buildOpsAlertMonitorShiftListItemMarkup(title = '', meta = '', badges = []) {
    const renderedBadges = (Array.isArray(badges) ? badges : []).filter(Boolean).join('');
    return `
        <div class="ops-alert-shift-report__list-item">
            <div class="ops-alert-shift-report__list-item-top">
                <strong class="ops-alert-shift-report__list-item-title">${escapeConfigHtml(title || '未命名项')}</strong>
                ${renderedBadges ? `<div class="ops-alert-shift-report__list-item-badges">${renderedBadges}</div>` : ''}
            </div>
            <div class="ops-alert-shift-report__list-item-meta">${escapeConfigHtml(meta || '等待更多上下文')}</div>
        </div>
    `;
}

function buildLocalOpsAlertMonitorShiftTrendState(report = normalizeOpsAlertMonitorShiftReport()) {
    const normalizedReport = normalizeOpsAlertMonitorShiftReport(report);
    const trend = Array.isArray(normalizedReport.trend) ? normalizedReport.trend : [];
    const maxBacklog = Math.max(1, ...trend.map((entry) => Number(entry.backlog_count || 0)));
    const bucketHours = Math.max(1, Number(normalizedReport.bucket_hours || 0));
    return {
        items: trend.map((entry) => {
            const backlogCount = Math.max(0, Number(entry.backlog_count || 0));
            const claimedCount = Math.max(0, Number(entry.claimed_count || 0));
            const assignedCount = Math.max(0, Number(entry.assigned_count || 0));
            const resolvedCount = Math.max(0, Number(entry.resolved_count || 0));
            const metaParts = [];
            if (claimedCount > 0) metaParts.push(`认领 ${formatVerifyMonitorInteger(claimedCount)}`);
            if (assignedCount > 0) metaParts.push(`转交 ${formatVerifyMonitorInteger(assignedCount)}`);
            if (resolvedCount > 0) metaParts.push(`关闭 ${formatVerifyMonitorInteger(resolvedCount)}`);
            return {
                backlogText: formatVerifyMonitorInteger(backlogCount),
                heightPercent: Math.max(16, Math.round((backlogCount / maxBacklog) * 100)),
                labelText: formatOpsAlertMonitorTimeShort(entry.bucket_end),
                metaText: metaParts.join(' · ') || '无动作'
            };
        }),
        emptyMessage: '本班还没有形成可展示的积压变化。',
        footerText: `按 ${formatVerifyMonitorInteger(bucketHours)} 小时时间桶回看本班积压走势。`
    };
}

function resolveOpsAlertMonitorShiftTrendStateBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertMonitorShiftTrendState',
        buildLocalOpsAlertMonitorShiftTrendState,
        () => ({
            normalizeShiftReport: normalizeOpsAlertMonitorShiftReport,
            formatCount: formatVerifyMonitorInteger,
            formatTimeShort: formatOpsAlertMonitorTimeShort
        })
    );
}

function resolveOpsAlertMonitorShiftTrendState(report = normalizeOpsAlertMonitorShiftReport()) {
    return resolveOpsAlertMonitorShiftTrendStateBuilder()(report);
}

function buildOpsAlertMonitorShiftTrendMarkup(report = normalizeOpsAlertMonitorShiftReport(), precomputedState = null) {
    const sharedTrendState = precomputedState || resolveOpsAlertMonitorShiftTrendState(report);

    return `
        <div class="ops-alert-shift-report__trend">
            <div class="ops-alert-shift-report__trend-bars">
                ${sharedTrendState.items.length ? sharedTrendState.items.map((item) => `
                        <div class="ops-alert-shift-report__trend-bar">
                            <div class="ops-alert-shift-report__trend-bar-value">${escapeConfigHtml(item.backlogText)}</div>
                            <div class="ops-alert-shift-report__trend-bar-track">
                                <span class="ops-alert-shift-report__trend-bar-fill" style="height:${escapeConfigHtml(String(item.heightPercent))}%"></span>
                            </div>
                            <div class="ops-alert-shift-report__trend-bar-label">${escapeConfigHtml(item.labelText)}</div>
                            <div class="ops-alert-shift-report__trend-bar-meta">${escapeConfigHtml(item.metaText)}</div>
                        </div>
                    `).join('') : `<div class="ops-alert-shift-report__panel-empty">${escapeConfigHtml(sharedTrendState.emptyMessage)}</div>`}
            </div>
            <div class="ops-alert-shift-report__trend-footer">${escapeConfigHtml(sharedTrendState.footerText)}</div>
        </div>
    `;
}

function buildOpsAlertMonitorShiftReportMarkup(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = '') {
    const shiftRenderState = resolveOpsAlertMonitorShiftRenderState(report, currentAdminLabel);
    const normalizedReport = shiftRenderState.normalizedReport || normalizeOpsAlertMonitorShiftReport(report);
    const currentView = shiftRenderState.currentView || normalizeOpsAlertMonitorShiftReportView(opsAlertMonitorShiftReportViewState);
    const resolvedActionButtons = Array.isArray(shiftRenderState.actionButtons) ? shiftRenderState.actionButtons : [];
    const sharedViewSwitchState = shiftRenderState.viewSwitchState || null;
    const sharedTrendState = shiftRenderState.trendState || null;
    const resolvedReportState = shiftRenderState.reportState || {};
    const resolvedSections = shiftRenderState.panelStates?.sections || {};
    const renderBadgeList = (badges = []) => (Array.isArray(badges) ? badges : [])
        .map((badge) => buildOpsAlertMonitorBadge(badge?.label || '—', badge?.tone || 'neutral'))
        .join('');
    const renderListSection = (section, extraClass = '') => {
        if (!section?.visible) {
            return '';
        }
        const items = Array.isArray(section.items) ? section.items : [];
        return `
            <section class="ops-alert-shift-report__panel${extraClass}">
                <div class="ops-alert-shift-report__panel-title">${escapeConfigHtml(section.title || '交班视图')}</div>
                <div class="ops-alert-shift-report__panel-list">
                    ${items.length
        ? items.map((item) => buildOpsAlertMonitorShiftListItemMarkup(
            item?.title,
            item?.meta,
            (Array.isArray(item?.badges) ? item.badges : []).map((badge) => buildOpsAlertMonitorBadge(badge?.label, badge?.tone))
        )).join('')
        : `<div class="ops-alert-shift-report__panel-empty">${escapeConfigHtml(section.emptyMessage || '暂无数据')}</div>`}
                </div>
            </section>
        `;
    };

    return `
        <div class="ops-alert-shift-report">
            <div class="ops-alert-shift-report__head">
                <div class="ops-alert-shift-report__copy">
                    <div class="ops-alert-shift-report__eyebrow">本班处理统计 / 交班视图</div>
                    <div class="ops-alert-shift-report__title">${escapeConfigHtml(resolvedReportState.headline || '')}</div>
                    <div class="ops-alert-shift-report__summary">${escapeConfigHtml(resolvedReportState.summary || '')}</div>
                </div>
                <div class="ops-alert-shift-report__stats">
                    ${renderBadgeList(resolvedReportState.headerBadges)}
                </div>
                <div class="ops-alert-shift-report__actions">
                    ${resolvedActionButtons.map((button) => `
                        <button
                            type="button"
                            class="btn-add-config btn-add-config--compact${button.variant === 'ghost' ? ' btn-add-config--ghost' : ''}"
                            data-admin-action="${escapeConfigHtml(button.actionName)}"
                        >
                            <i class="${escapeConfigHtml(button.icon)}"></i> ${escapeConfigHtml(button.label)}
                        </button>
                    `).join('')}
                </div>
            </div>
            ${buildOpsAlertMonitorShiftReportViewSwitchMarkup(currentView, sharedViewSwitchState)}
            <div class="ops-alert-shift-report__metrics">
                ${(Array.isArray(resolvedReportState.metrics) ? resolvedReportState.metrics : [])
        .map((metric) => buildOpsAlertMonitorShiftMetricMarkup(metric))
        .join('')}
            </div>
            <div class="ops-alert-shift-report__panels">
                ${renderListSection(resolvedSections.categories)}
                ${renderListSection(resolvedSections.admins)}
                ${resolvedSections.trend?.visible ? `
                <section class="ops-alert-shift-report__panel ops-alert-shift-report__panel--wide">
                    <div class="ops-alert-shift-report__panel-title">${escapeConfigHtml(resolvedSections.trend.title || resolvedReportState.panelTitles?.trend || '积压趋势')}</div>
                    ${buildOpsAlertMonitorShiftTrendMarkup(normalizedReport, sharedTrendState)}
                </section>
                ` : ''}
                ${renderListSection(resolvedSections.closeReasons)}
            </div>
        </div>
    `;
}

function buildLocalOpsAlertMonitorShiftReportSummaryText(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = '') {
    const normalizedReport = normalizeOpsAlertMonitorShiftReport(report);
    const shiftRuntimeState = buildOpsAlertMonitorShiftSharedRuntimeState(currentAdminLabel, {
        includeGeneratedAt: true
    });
    const lines = [
        '第一阶段集中告警交班摘要',
        `生成时间：${formatVerifyMonitorDateTime(shiftRuntimeState.generatedAt)}`,
        `交班视角：${getOpsAlertMonitorShiftResolvedViewLabel(shiftRuntimeState.currentView)}`,
        `班次时长：${formatVerifyMonitorInteger(Math.max(1, Number(normalizedReport.shift_hours || 0)))} 小时`
    ];
    if (shiftRuntimeState.currentAdminLabel) {
        lines.push(`当前值班：${shiftRuntimeState.currentAdminLabel}`);
    }
    if (normalizedReport.window_start || normalizedReport.window_end) {
        lines.push(`班次区间：${formatVerifyMonitorDateTime(normalizedReport.window_start)} 至 ${formatVerifyMonitorDateTime(normalizedReport.window_end)}`);
    }
    return lines.join('\n');
}

function resolveOpsAlertMonitorShiftReportSummaryTextBuilder() {
    return resolveOpsAlertMonitorShiftRuntimeSharedBuilder(
        'buildAdminWorkbenchOpsAlertMonitorShiftReportSummaryText',
        buildLocalOpsAlertMonitorShiftReportSummaryText,
        () => buildOpsAlertMonitorShiftSharedOptions({
            formatDateTime: formatVerifyMonitorDateTime,
            formatCount: formatVerifyMonitorInteger,
            formatMinutes: formatVerifyMonitorMinutes,
            formatSignedCount: formatOpsAlertMonitorSignedCount,
            formatTimeShort: formatOpsAlertMonitorTimeShort
        }),
        (report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = '') => buildOpsAlertMonitorShiftSharedRuntimeState(currentAdminLabel, {
            includeGeneratedAt: true
        })
    );
}

function resolveOpsAlertMonitorShiftReportSummaryText(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = '') {
    return resolveOpsAlertMonitorShiftReportSummaryTextBuilder()(report, currentAdminLabel);
}

function buildOpsAlertMonitorShiftReportSummaryText(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = '') {
    return resolveOpsAlertMonitorShiftReportSummaryText(report, currentAdminLabel);
}

function buildLocalOpsAlertMonitorShiftReportCsvRows(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = '') {
    const normalizedReport = normalizeOpsAlertMonitorShiftReport(report);
    const shiftRuntimeState = buildOpsAlertMonitorShiftSharedRuntimeState(currentAdminLabel);
    return [{
        section: 'summary',
        item: '班次概览',
        current_admin: shiftRuntimeState.currentAdminLabel || '',
        view_mode: normalizeOpsAlertMonitorShiftReportView(shiftRuntimeState.currentView),
        view_label: getOpsAlertMonitorShiftResolvedViewLabel(shiftRuntimeState.currentView),
        shift_hours: Math.max(1, Number(normalizedReport.shift_hours || 0)),
        bucket_hours: Math.max(1, Number(normalizedReport.bucket_hours || 0)),
        window_start: normalizedReport.window_start || '',
        window_end: normalizedReport.window_end || ''
    }];
}

function resolveOpsAlertMonitorShiftReportCsvRowsBuilder() {
    return resolveOpsAlertMonitorShiftRuntimeSharedBuilder(
        'buildAdminWorkbenchOpsAlertMonitorShiftReportCsvRows',
        buildLocalOpsAlertMonitorShiftReportCsvRows,
        () => buildOpsAlertMonitorShiftSharedOptions({
            formatTimeShort: formatOpsAlertMonitorTimeShort
        }),
        (report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = '') => buildOpsAlertMonitorShiftSharedRuntimeState(currentAdminLabel)
    );
}

function resolveOpsAlertMonitorShiftReportCsvRows(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = '') {
    return resolveOpsAlertMonitorShiftReportCsvRowsBuilder()(report, currentAdminLabel);
}

function buildOpsAlertMonitorShiftReportCsvRows(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = '') {
    return resolveOpsAlertMonitorShiftReportCsvRows(report, currentAdminLabel);
}

function buildLocalOpsAlertMonitorShiftExportState(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = '') {
    const normalizedReport = normalizeOpsAlertMonitorShiftReport(report);
    const currentView = normalizeOpsAlertMonitorShiftReportView(opsAlertMonitorShiftReportViewState);
    const currentViewLabel = getOpsAlertMonitorShiftResolvedViewLabel(currentView);
    return {
        currentView,
        currentViewLabel,
        summaryText: buildOpsAlertMonitorShiftReportSummaryText(normalizedReport, currentAdminLabel),
        csvRows: buildOpsAlertMonitorShiftReportCsvRows(normalizedReport, currentAdminLabel)
    };
}

function resolveOpsAlertMonitorShiftExportState(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = '') {
    return buildLocalOpsAlertMonitorShiftExportState(report, currentAdminLabel);
}

function setOpsAlertMonitorShiftReportView(value = 'all') {
    opsAlertMonitorShiftReportViewState = normalizeOpsAlertMonitorShiftReportView(value);
    renderOpsAlertMonitorShiftReport();
    return opsAlertMonitorShiftReportViewState;
}

function buildLocalOpsAlertMonitorShiftReportMarkupState(state = opsAlertMonitorState || getDefaultOpsAlertMonitorState()) {
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : getDefaultOpsAlertMonitorState();
    if (normalizedState.status === 'loading' || normalizedState.status === 'error') {
        return {
            status: normalizedState.status,
            bodyMarkup: buildOpsAlertMonitorShiftShellMarkup(resolveOpsAlertMonitorShiftShellState(normalizedState.status, {
                message: normalizedState.message
            }))
        };
    }

    return {
        status: 'ready',
        bodyMarkup: buildOpsAlertMonitorShiftReportMarkup(
            normalizedState.summary?.shift_report,
            normalizedState.current_admin_label || ''
        )
    };
}

function resolveOpsAlertMonitorShiftReportMarkupState(state = opsAlertMonitorState || getDefaultOpsAlertMonitorState()) {
    return buildLocalOpsAlertMonitorShiftReportMarkupState(state);
}

function applyOpsAlertMonitorShiftReportMarkupState(markupState = {}, target = null) {
    return applyOpsAlertBodyMarkupState(markupState, target);
}

function renderOpsAlertMonitorShiftReport() {
    renderOpsAlertBodyMarkupTarget(
        'opsAlertMonitorShiftReport',
        () => resolveOpsAlertMonitorShiftReportMarkupState(opsAlertMonitorState || getDefaultOpsAlertMonitorState())
    );
}

function buildLocalOpsAlertMonitorPanelState(state = {}, filters = getOpsAlertMonitorViewFilters(), categories = []) {
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
    const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters) ? filters : getDefaultOpsAlertMonitorViewState();
    const normalizedCategories = Array.isArray(categories) ? categories : [];
    const summary = normalizedState.summary && typeof normalizedState.summary === 'object' && !Array.isArray(normalizedState.summary)
        ? normalizedState.summary
        : getDefaultOpsAlertMonitorState().summary;

    if (normalizedState.status === 'loading') {
        return {
            status: 'loading',
            metaIcon: 'fas fa-rotate fa-spin',
            metaText: '正在汇总支付、工单、库存、履约与商城风控五类告警...',
            emptyMessage: '正在加载集中告警处理面板...'
        };
    }

    if (normalizedState.status === 'error') {
        return {
            status: 'error',
            metaIcon: 'fas fa-triangle-exclamation',
            metaText: normalizedState.message || '集中告警处理面板加载失败。',
            emptyMessage: normalizedState.message || '集中告警处理面板加载失败。'
        };
    }

    const filteredActiveCount = normalizedCategories.reduce((sum, category) => sum + Number(category.display_active_count || 0), 0);
    const filteredCriticalCount = normalizedCategories.reduce((sum, category) => sum + Number(category.display_critical_count || 0), 0);
    const filteredSummaryLabel = getOpsAlertMonitorFilterSummaryLabel(normalizedFilters);

    if (!normalizedCategories.length) {
        return {
            status: 'empty',
            metaIcon: 'fas fa-filter-circle-xmark',
            metaText: `当前筛选：${filteredSummaryLabel}。这组条件下没有命中的集中告警，请调整筛选后重试。`,
            emptyMessage: '当前筛选条件下没有可展示的集中告警卡片。'
        };
    }

    return {
        status: 'ready',
        metaIcon: filteredActiveCount > 0 ? 'fas fa-siren-on' : 'fas fa-circle-check',
        metaText: filteredActiveCount > 0
            ? `当前筛选：${filteredSummaryLabel}。命中 ${formatVerifyMonitorInteger(filteredActiveCount)} 项待关注告警，覆盖 ${formatVerifyMonitorInteger(normalizedCategories.length)} 个模块，其中 ${formatVerifyMonitorInteger(filteredCriticalCount)} 项为 critical。`
            : `当前筛选：${filteredSummaryLabel}。最近 ${formatVerifyMonitorInteger(summary.lookback_hours || 0)} 小时内没有持续中的待关注告警，下面保留可复核的恢复轨迹。`,
        emptyMessage: ''
    };
}

function resolveOpsAlertMonitorPanelStateBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertMonitorPanelState',
        buildLocalOpsAlertMonitorPanelState,
        () => ({
            formatCount: formatVerifyMonitorInteger,
            getFilterSummaryLabel: getOpsAlertMonitorFilterSummaryLabel
        })
    );
}

function resolveOpsAlertMonitorPanelState(state = {}, filters = getOpsAlertMonitorViewFilters(), categories = []) {
    return resolveOpsAlertMonitorPanelStateBuilder()(state, filters, categories);
}

function buildLocalOpsAlertMonitorCategoryRenderState(category = {}, filters = getOpsAlertMonitorViewFilters()) {
    const normalizedCategory = category && typeof category === 'object' && !Array.isArray(category) ? category : {};
    const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters) ? filters : getDefaultOpsAlertMonitorViewState();
    const items = Array.isArray(normalizedCategory.items) ? normalizedCategory.items : [];
    return {
        tone: getOpsAlertMonitorCardTone(normalizedCategory),
        title: normalizedCategory.label || '告警分类',
        description: normalizedCategory.description || '',
        latestSummary: normalizedCategory.latest_title
            ? `${normalizedCategory.latest_title}${normalizedCategory.latest_at ? ` · ${formatVerifyMonitorDateTime(normalizedCategory.latest_at)}` : ''}`
            : '最近还没有收集到这类告警。',
        latestMessage: normalizedCategory.filtered_note
            || normalizedCategory.latest_message
            || (getOpsAlertMonitorDisplayActiveCount(normalizedCategory) > 0
                ? `当前有 ${formatVerifyMonitorInteger(getOpsAlertMonitorDisplayActiveCount(normalizedCategory))} 项待关注告警。`
                : '当前没有持续中的待关注告警。'),
        emptyMessage: String(normalizedCategory.latest_state || '').toLowerCase() === 'recovered'
            ? '最近一条同类告警已经恢复，可进入对应模块做一次复核。'
            : (String(normalizedFilters.severity || 'all') === 'all'
                ? '当前没有持续中的待处理告警。'
                : `当前筛选条件下没有命中的 ${normalizedFilters.severity} 告警。`),
        hiddenHint: Number(normalizedCategory.hidden_item_count || 0) > 0
            ? `当前卡片仅展示前 3 项，另有 ${formatVerifyMonitorInteger(Number(normalizedCategory.hidden_item_count || 0))} 项可通过“复制清单 / 导出 CSV”带走处理。`
            : '',
        statBadges: [
            { label: `${formatVerifyMonitorInteger(getOpsAlertMonitorDisplayActiveCount(normalizedCategory))} 待关注`, tone: getOpsAlertMonitorDisplayActiveCount(normalizedCategory) > 0 ? 'warning' : 'neutral' },
            normalizedCategory?.case_summary?.claimed > 0 ? { label: `${formatVerifyMonitorInteger(normalizedCategory.case_summary.claimed || 0)} 处理中`, tone: 'neutral' } : null,
            getOpsAlertMonitorDisplayCriticalCount(normalizedCategory) > 0 ? { label: `${formatVerifyMonitorInteger(getOpsAlertMonitorDisplayCriticalCount(normalizedCategory))} critical`, tone: 'danger' } : null,
            String(normalizedFilters.scope || 'all') === 'recovered' || (getOpsAlertMonitorDisplayActiveCount(normalizedCategory) === 0 && String(normalizedCategory.latest_state || '').toLowerCase() === 'recovered')
                ? { label: '已恢复', tone: 'success' }
                : null
        ].filter(Boolean),
        items: items.map((item) => ({
            item,
            state: buildLocalOpsAlertMonitorItemDisplayState(item, normalizedCategory)
        })),
        actions: [
            {
                actionName: 'settings-copy-ops-alert-monitor-category',
                icon: 'fas fa-list-check',
                label: '复制清单',
                attrs: { 'data-ops-alert-monitor-category-key': String(normalizedCategory.key || '').trim() }
            },
            ...getOpsAlertMonitorCategoryActions(normalizedCategory.key).map((action) => ({
                actionName: 'settings-open-ops-alert-workspace',
                icon: action.icon,
                label: action.label,
                attrs: { 'data-workspace-target': action.target }
            }))
        ]
    };
}

function resolveOpsAlertMonitorCategoryRenderStateBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertMonitorCategoryRenderState',
        buildLocalOpsAlertMonitorCategoryRenderState,
        () => ({
            formatCount: formatVerifyMonitorInteger,
            formatDateTime: formatVerifyMonitorDateTime,
            getCategoryActions: (categoryKey) => getOpsAlertMonitorCategoryActions(categoryKey),
            getDisplayActiveCount: getOpsAlertMonitorDisplayActiveCount,
            getDisplayCriticalCount: getOpsAlertMonitorDisplayCriticalCount,
            getCardTone: getOpsAlertMonitorCardTone,
            getItemDisplayState: resolveOpsAlertMonitorItemDisplayState
        })
    );
}

function resolveOpsAlertMonitorCategoryRenderState(category = {}, filters = getOpsAlertMonitorViewFilters()) {
    return resolveOpsAlertMonitorCategoryRenderStateBuilder()(category, filters);
}

function resolveOpsAlertMonitorCategoryMarkupState(category = {}, filters = getOpsAlertMonitorViewFilters()) {
    const fallbackState = buildLocalOpsAlertMonitorCategoryRenderState(category, filters);
    const resolvedState = resolveOpsAlertMonitorCategoryRenderState(category, filters);
    const mergedItems = Array.isArray(resolvedState?.items) && resolvedState.items.length
        ? resolvedState.items
        : fallbackState.items;
    return {
        ...fallbackState,
        ...resolvedState,
        tone: resolvedState?.tone || fallbackState.tone || 'neutral',
        title: resolvedState?.title || fallbackState.title || '告警分类',
        description: resolvedState?.description || fallbackState.description || '',
        latestSummary: resolvedState?.latestSummary || fallbackState.latestSummary || '',
        latestMessage: resolvedState?.latestMessage || fallbackState.latestMessage || '',
        emptyMessage: resolvedState?.emptyMessage || fallbackState.emptyMessage || '',
        hiddenHint: resolvedState?.hiddenHint || fallbackState.hiddenHint || '',
        statBadges: Array.isArray(resolvedState?.statBadges) && resolvedState.statBadges.length
            ? resolvedState.statBadges
            : fallbackState.statBadges,
        actions: Array.isArray(resolvedState?.actions) && resolvedState.actions.length
            ? resolvedState.actions
            : fallbackState.actions,
        items: Array.isArray(mergedItems)
            ? mergedItems.map((entry) => {
                const currentItem = entry?.item || {};
                return {
                    ...entry,
                    state: resolveOpsAlertMonitorItemMarkupState(
                        currentItem,
                        category,
                        entry?.state || null
                    )
                };
            })
            : []
    };
}

function buildOpsAlertMonitorCategoryMarkup(category = {}, filters = getOpsAlertMonitorViewFilters()) {
    const resolvedState = resolveOpsAlertMonitorCategoryMarkupState(category, filters);

    return `
        <article class="ops-alert-monitor-card ops-alert-monitor-card--${escapeConfigHtml(resolvedState.tone || 'neutral')}">
            <div class="ops-alert-monitor-card__head">
                <div class="ops-alert-monitor-card__copy">
                    <div class="ops-alert-monitor-card__title">${escapeConfigHtml(resolvedState.title || '告警分类')}</div>
                    <div class="ops-alert-monitor-card__desc">${escapeConfigHtml(resolvedState.description || '')}</div>
                </div>
                <div class="ops-alert-monitor-card__stats">
                    ${(Array.isArray(resolvedState.statBadges) ? resolvedState.statBadges : [])
        .map((badge) => buildOpsAlertMonitorBadge(badge.label, badge.tone)).join('')}
                </div>
            </div>
            <div class="ops-alert-monitor-card__latest">
                <strong>${escapeConfigHtml(resolvedState.latestSummary || '')}</strong>
                <span>${escapeConfigHtml(resolvedState.latestMessage || '')}</span>
            </div>
            <div class="ops-alert-monitor-card__items">
                ${resolvedState.items.length
        ? resolvedState.items.map((entry) => buildOpsAlertMonitorItemMarkup(entry.item, category, entry.state)).join('')
        : `<div class="ops-alert-monitor-empty">${escapeConfigHtml(resolvedState.emptyMessage || '')}</div>`}
            </div>
            ${resolvedState.hiddenHint ? `
                <div class="ops-alert-monitor-card__hint">${escapeConfigHtml(resolvedState.hiddenHint)}</div>
            ` : ''}
            <div class="ops-alert-monitor-card__actions">
                ${resolvedState.actions.map((action) => `
                    <button
                        type="button"
                        class="btn-add-config btn-add-config--compact"
                        data-admin-action="${escapeConfigHtml(action.actionName || '')}"
                        ${Object.entries(action.attrs || {})
            .filter(([, value]) => String(value || '').length > 0)
            .map(([name, value]) => `${name}="${escapeConfigHtml(value)}"`).join(' ')}
                    >
                        <i class="${escapeConfigHtml(action.icon || 'fas fa-circle-dot')}"></i> ${escapeConfigHtml(action.label || '操作')}
                    </button>
                `).join('')}
            </div>
        </article>
    `;
}

function setOpsAlertMonitorFilter(kind, value) {
    const normalizedKind = String(kind || '').trim().toLowerCase();
    if (!['scope', 'severity', 'category'].includes(normalizedKind)) {
        return false;
    }

    opsAlertMonitorViewState = {
        ...getOpsAlertMonitorViewFilters(),
        [normalizedKind]: normalizeOpsAlertMonitorFilterValue(normalizedKind, value)
    };
    renderOpsAlertMonitorPanel();
    return true;
}

function buildLocalOpsAlertCaseMutationItems(items = [], categoryKey = '') {
    const normalizedCategoryKey = String(categoryKey || '').trim().toLowerCase();
    return (Array.isArray(items) ? items : [])
        .map((item) => ({
            category_key: normalizedCategoryKey || String(item.category_key || item.category || '').trim().toLowerCase(),
            target_id: String(item.target_id || item.targetId || '').trim(),
            alert_type: String(item.alert_type || item.alertType || '').trim().toLowerCase(),
            title: String(item.title || '').trim(),
            reference_label: String(item.reference_label || item.referenceLabel || '').trim(),
            reference_value: String(item.reference_value || item.referenceValue || '').trim()
        }))
        .filter((item) => item.category_key && item.target_id);
}

function resolveOpsAlertCaseMutationItemsBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertCaseMutationItems',
        buildLocalOpsAlertCaseMutationItems
    );
}

function resolveOpsAlertCaseMutationItems(items = [], categoryKey = '') {
    return resolveOpsAlertCaseMutationItemsBuilder()(items, categoryKey);
}

function buildOpsAlertCaseMutationItems(items = [], categoryKey = '') {
    return resolveOpsAlertCaseMutationItems(items, categoryKey);
}

function buildLocalOpsAlertMonitorBatchMuteModuleKeysFromCategories(categories = [], categoryKey = '') {
    const normalizedCategoryKey = String(categoryKey || '').trim().toLowerCase();
    const categoryToModuleKey = {
        payments: 'payments',
        tickets: 'tickets',
        inventory: 'inventory',
        fulfillment: 'fulfillment',
        shop_risk: 'shop_risk'
    };

    return Array.from(new Set(
        categories
            .filter((category) => {
                const currentCategoryKey = String(category.key || '').trim().toLowerCase();
                if (normalizedCategoryKey && currentCategoryKey !== normalizedCategoryKey) {
                    return false;
                }
                return Array.isArray(category.visible_items) && category.visible_items.length > 0;
            })
            .map((category) => categoryToModuleKey[String(category.key || '').trim().toLowerCase()])
            .filter(Boolean)
    ));
}

function resolveOpsAlertMonitorBatchMuteModuleKeysFromCategories(categories = [], categoryKey = '') {
    return resolveOpsAlertSharedCallable(
        'getAdminWorkbenchOpsAlertMonitorBatchMuteModuleKeys',
        buildLocalOpsAlertMonitorBatchMuteModuleKeysFromCategories
    )(categories, categoryKey);
}

function getOpsAlertMonitorBatchMuteModuleKeysFromCategories(categories = [], categoryKey = '') {
    return resolveOpsAlertMonitorBatchMuteModuleKeysFromCategories(categories, categoryKey);
}

function getOpsAlertMonitorBatchMuteModuleKeys(filters = getOpsAlertMonitorViewFilters(), categoryKey = '') {
    const categories = getOpsAlertMonitorPreparedCategories(filters);
    return getOpsAlertMonitorBatchMuteModuleKeysFromCategories(categories, categoryKey);
}

function getOpsAlertMuteModuleLabel(moduleKey = '') {
    const definition = OPS_ALERT_MUTE_RULE_MODULE_DEFINITIONS.find((item) => item.key === String(moduleKey || '').trim().toLowerCase());
    return definition?.label || String(moduleKey || '').trim() || '模块';
}

function buildLocalOpsAlertMonitorBatchItemsFromCategories(categories = [], action = '', categoryKey = '') {
    const normalizedAction = String(action || '').trim().toLowerCase();
    const normalizedCategoryKey = String(categoryKey || '').trim().toLowerCase();

    return categories.flatMap((category) => {
        const currentCategoryKey = String(category.key || '').trim().toLowerCase();
        if (normalizedCategoryKey && currentCategoryKey !== normalizedCategoryKey) {
            return [];
        }

        return buildLocalOpsAlertCaseMutationItems(category.visible_items || [], currentCategoryKey);
    }).filter((item) => {
        const matchingCategory = categories.find((category) => String(category.key || '').trim().toLowerCase() === item.category_key);
        const sourceItem = Array.isArray(matchingCategory?.visible_items)
            ? matchingCategory.visible_items.find((candidate) => String(candidate.target_id || '').trim() === item.target_id)
            : null;
        const status = String(sourceItem?.case_status || '').trim().toLowerCase() || 'open';

        if (normalizedAction === 'claim' || normalizedAction === 'assign') {
            return status !== 'resolved';
        }
        if (normalizedAction === 'resolve') {
            return status !== 'resolved';
        }
        if (normalizedAction === 'reopen') {
            return status === 'resolved';
        }
        return true;
    });
}

function resolveOpsAlertMonitorBatchItemsBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertMonitorBatchItems',
        buildLocalOpsAlertMonitorBatchItemsFromCategories
    );
}

function resolveOpsAlertMonitorBatchItemsFromCategories(categories = [], action = '', categoryKey = '') {
    return resolveOpsAlertMonitorBatchItemsBuilder()(categories, action, categoryKey);
}

function getOpsAlertMonitorBatchItemsFromCategories(categories = [], action = '', categoryKey = '') {
    return resolveOpsAlertMonitorBatchItemsFromCategories(categories, action, categoryKey);
}

function getOpsAlertMonitorBatchItems(filters = getOpsAlertMonitorViewFilters(), action = '', categoryKey = '') {
    const categories = getOpsAlertMonitorPreparedCategories(filters);
    return getOpsAlertMonitorBatchItemsFromCategories(categories, action, categoryKey);
}

function resolveOpsAlertMonitorBatchActionStatesFromCategories(categories = [], filters = getOpsAlertMonitorViewFilters()) {
    const normalizedCategories = Array.isArray(categories) ? categories : [];
    return requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertMonitorBatchActionStates')(normalizedCategories, filters, {
        buildBatchItems: (preparedCategories, action) => getOpsAlertMonitorBatchItemsFromCategories(preparedCategories, action),
        getBatchMuteModuleKeys: (preparedCategories) => getOpsAlertMonitorBatchMuteModuleKeysFromCategories(preparedCategories),
        formatCount: formatVerifyMonitorInteger
    });
}

function resolveOpsAlertMonitorBatchActionStates(filters = getOpsAlertMonitorViewFilters()) {
    const categories = getOpsAlertMonitorPreparedCategories(filters);
    return resolveOpsAlertMonitorBatchActionStatesFromCategories(categories, filters);
}

function resolveOpsAlertMonitorViewState(state = {}, filters = getOpsAlertMonitorViewFilters(), categories = getOpsAlertMonitorPreparedCategories(filters)) {
    const filterDefinitions = Array.from(document.querySelectorAll('[data-ops-alert-monitor-filter-kind]')).map((button) => ({
        kind: button.dataset.opsAlertMonitorFilterKind,
        value: button.dataset.opsAlertMonitorFilterValue
    }));
    return requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertMonitorViewState')(state, filters, categories, {
        filterDefinitions,
        formatCount: formatVerifyMonitorInteger,
        getFilterSummaryLabel: getOpsAlertMonitorFilterSummaryLabel,
        buildBatchItems: (preparedCategories, action) => getOpsAlertMonitorBatchItemsFromCategories(preparedCategories, action),
        getBatchMuteModuleKeys: (preparedCategories) => getOpsAlertMonitorBatchMuteModuleKeysFromCategories(preparedCategories)
    });
}

function buildLocalOpsAlertMonitorPanelMarkupState(state = {}, filters = getOpsAlertMonitorViewFilters(), categories = [], viewState = null) {
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : getDefaultOpsAlertMonitorState();
    const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters)
        ? filters
        : getDefaultOpsAlertMonitorViewState();
    const normalizedCategories = Array.isArray(categories) ? categories : [];
    const resolvedViewState = viewState && typeof viewState === 'object' && !Array.isArray(viewState)
        ? viewState
        : resolveOpsAlertMonitorViewState(normalizedState, normalizedFilters, normalizedCategories);
    const panelState = resolvedViewState?.panelState || resolveOpsAlertMonitorPanelState(normalizedState, normalizedFilters, normalizedCategories);
    const toolbarState = Array.isArray(resolvedViewState?.toolbarState)
        ? resolvedViewState.toolbarState
        : resolveOpsAlertMonitorFilterToolbarState(normalizedFilters);
    const batchActionStates = Array.isArray(resolvedViewState?.batchActionStates)
        ? resolvedViewState.batchActionStates
        : resolveOpsAlertMonitorBatchActionStatesFromCategories(normalizedCategories, normalizedFilters);

    return {
        state: normalizedState,
        filters: normalizedFilters,
        categories: normalizedCategories,
        toolbarState,
        batchActionStates,
        panelState,
        metaMarkup: buildOpsAlertPanelMetaMarkup(panelState),
        bodyMarkup: panelState.status === 'ready' && normalizedCategories.length
            ? normalizedCategories.map((category) => buildOpsAlertMonitorCategoryMarkup(category, normalizedFilters)).join('')
            : buildOpsAlertPanelEmptyMarkup(panelState.emptyMessage)
    };
}

function resolveOpsAlertMonitorPanelMarkupState(state = {}, filters = getOpsAlertMonitorViewFilters(), categories = [], viewState = null) {
    return buildLocalOpsAlertMonitorPanelMarkupState(state, filters, categories, viewState);
}

function applyOpsAlertMonitorFilterToolbarState(toolbarState = [], filters = getOpsAlertMonitorViewFilters()) {
    document.querySelectorAll('[data-ops-alert-monitor-filter-kind]').forEach((button) => {
        const kind = String(button.dataset.opsAlertMonitorFilterKind || '').trim().toLowerCase();
        const value = String(button.dataset.opsAlertMonitorFilterValue || '').trim().toLowerCase();
        const matched = Array.isArray(toolbarState)
            ? toolbarState.find((item) => item.kind === kind && item.value === value)
            : null;
        const isActive = matched ? matched.active === true : filters[kind] === value;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function applyOpsAlertMonitorBatchActionStates(buttonStates = [], filters = getOpsAlertMonitorViewFilters()) {
    const panel = document.getElementById('opsAlertMonitorPanel');
    if (!panel) return;
    const setButtonState = (actionName, disabled, title) => {
        const button = document.querySelector(`[data-admin-action="${actionName}"]`);
        if (!button) return;
        button.disabled = disabled;
        button.title = title;
    };

    if (Array.isArray(buttonStates)) {
        buttonStates.forEach((item) => setButtonState(item.actionName, item.disabled, item.title));
        return;
    }

    const fallbackStates = resolveOpsAlertMonitorBatchActionStates(filters);
    if (Array.isArray(fallbackStates)) {
        fallbackStates.forEach((item) => setButtonState(item.actionName, item.disabled, item.title));
    }
}

function renderOpsAlertMonitorBatchActions(filters = getOpsAlertMonitorViewFilters(), buttonStates = null) {
    applyOpsAlertMonitorBatchActionStates(buttonStates, filters);
}

function applyOpsAlertMonitorPanelMarkupState(markupState = {}, elements = {}) {
    return applyOpsAlertPanelMarkupElements(markupState, elements, {
        beforeApply: (resolvedMarkupState) => {
            const filters = resolvedMarkupState.filters || getOpsAlertMonitorViewFilters();
            syncOpsAlertMonitorFilterToolbar(filters, resolvedMarkupState.toolbarState || null);
            renderOpsAlertRiskSpotlight(filters);
            renderOpsAlertMonitorShiftReport();
            renderOpsAlertMonitorBatchActions(filters, resolvedMarkupState.batchActionStates || null);
        },
        fallbackEmptyText: '暂无数据'
    });
}

function renderOpsAlertMonitorPanel() {
    const shiftReport = document.getElementById('opsAlertMonitorShiftReport');
    if (!shiftReport) return;

    renderOpsAlertPanelMarkupTarget({
        panelId: 'opsAlertMonitorPanel',
        metaId: 'opsAlertMonitorMeta',
        gridId: 'opsAlertMonitorGrid',
        resolveMarkupState: () => {
            const state = opsAlertMonitorState || getDefaultOpsAlertMonitorState();
            const filters = getOpsAlertMonitorViewFilters();
            const categories = state.status === 'ready' ? getOpsAlertMonitorPreparedCategories(filters) : [];
            const viewState = resolveOpsAlertMonitorViewState(state, filters, categories);
            return resolveOpsAlertMonitorPanelMarkupState(state, filters, categories, viewState);
        },
        applyMarkupState: applyOpsAlertMonitorPanelMarkupState
    });
}

async function copyOpsAlertMonitorChecklist(categoryKey = '') {
    const filters = getOpsAlertMonitorViewFilters();
    const categories = getOpsAlertMonitorPreparedCategories(filters);
    const rows = buildOpsAlertMonitorBatchRows(categories, filters, categoryKey);
    if (!rows.length) {
        showToast('当前筛选条件下没有可复制的告警清单', 'info');
        return false;
    }

    try {
        const text = buildOpsAlertMonitorChecklistText(rows, filters, categoryKey);
        await writeAdminConfigClipboard(text);
        showToast(`已复制 ${rows.length} 条集中告警清单`, 'success');
        return true;
    } catch (error) {
        console.error('[Config] Copy ops alert checklist failed:', error);
        showToast('复制失败，请稍后重试', 'error');
        return false;
    }
}

async function copyOpsAlertMonitorShiftReportSummary() {
    const state = opsAlertMonitorState || getDefaultOpsAlertMonitorState();
    if (state.status !== 'ready') {
        showToast('交班报表仍在加载，请稍后再试', 'info');
        return false;
    }

    try {
        const exportState = resolveOpsAlertMonitorShiftExportState(state.summary?.shift_report, state.current_admin_label || '');
        await writeAdminConfigClipboard(exportState.summaryText);
        showToast(`已复制${exportState.currentViewLabel}交班摘要`, 'success');
        return true;
    } catch (error) {
        console.error('[Config] Copy ops alert shift report failed:', error);
        showToast('复制交班摘要失败，请稍后重试', 'error');
        return false;
    }
}

function exportOpsAlertMonitorCsv(categoryKey = '') {
    const filters = getOpsAlertMonitorViewFilters();
    const categories = getOpsAlertMonitorPreparedCategories(filters);
    const rows = buildOpsAlertMonitorBatchRows(categories, filters, categoryKey);
    if (!rows.length) {
        showToast('当前筛选条件下没有可导出的集中告警', 'info');
        return false;
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    const suffix = String(categoryKey || '').trim().toLowerCase() || 'all';
    const csv = convertRowsToCsv(rows);
    downloadExportBlob(
        new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }),
        `ops_alert_monitor_${suffix}_${timestamp}.csv`
    );
    showToast(`已导出 ${rows.length} 条集中告警清单`, 'success');
    return true;
}

function exportOpsAlertMonitorShiftReportCsv() {
    const state = opsAlertMonitorState || getDefaultOpsAlertMonitorState();
    if (state.status !== 'ready') {
        showToast('交班报表仍在加载，请稍后再试', 'info');
        return false;
    }

    const exportState = resolveOpsAlertMonitorShiftExportState(state.summary?.shift_report, state.current_admin_label || '');
    const rows = exportState.csvRows;
    if (!rows.length) {
        showToast('当前没有可导出的交班报表', 'info');
        return false;
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    const viewKey = exportState.currentView;
    const csv = convertRowsToCsv(rows);
    downloadExportBlob(
        new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }),
        `ops_alert_shift_report_${viewKey}_${timestamp}.csv`
    );
    showToast(`已导出${exportState.currentViewLabel}交班报表`, 'success');
    return true;
}

function renderChannelsConfig() {
    const channels = systemConfigCache['channels'] || [];
    const container = document.getElementById('channelTags');
    if (!container) return;

    container.innerHTML = channels.map((ch, index) => `
        <div class="channel-tag ${ch.is_default ? 'default' : ''}" data-index="${index}">
            <span>${ch.name}</span>
            <button class="remove-tag" type="button" data-admin-action="settings-delete-channel" data-channel-index="${index}">✕</button>
        </div>
    `).join('');
}

function renderRewardsConfig() {
    const rewardsConfig = systemConfigCache['rewards'] || {};
    const checkinConfig = normalizeCheckinConfig(systemConfigCache['checkin_system']);

    const fields = {
        'cfgSignupBonus': Math.max(0, toPointNumber(rewardsConfig.signup_bonus, 50)),
        'cfgDailyCheckin': checkinConfig.base_points,
        'cfgCheckinStreakBonus': checkinConfig.consecutive_7_points,
        'cfgCheckinPerfectBonus': checkinConfig.perfect_month_points,
        'cfgCheckinMakeupCost': checkinConfig.makeup_cost_points,
        'cfgCommentReward': Math.max(0, toPointNumber(rewardsConfig.comment_reward, 2))
    };

    Object.entries(fields).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = value;
    });
}

function loadAffiliateSettings() {
    const affiliateConfig = normalizeAffiliateProgramConfig(systemConfigCache['affiliate_program']);
    const posterConfig = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster']);

    const affiliateFieldMap = {
        affiliate_setting_commission_rate_shop: affiliateConfig.commission_rate_shop,
        affiliate_setting_commission_rate_agent: affiliateConfig.commission_rate_agent,
        affiliate_setting_registration_reward_points: affiliateConfig.registration_reward_points,
        affiliate_setting_reward_notice: affiliateConfig.reward_notice,
        affiliate_setting_legal_disclaimer: affiliateConfig.legal_disclaimer
    };

    Object.entries(affiliateFieldMap).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = value;
    });

    const requiresPurchaseInput = document.getElementById('affiliate_setting_registration_reward_requires_purchase');
    if (requiresPurchaseInput) requiresPurchaseInput.checked = !!affiliateConfig.registration_reward_requires_purchase;

    const posterFieldMap = {
        affiliate_poster_chip_label: posterConfig.chip_label,
        affiliate_poster_title: posterConfig.title,
        affiliate_poster_subtitle: posterConfig.subtitle,
        affiliate_poster_reward_badge_text: posterConfig.reward_badge_text,
        affiliate_poster_invite_code_label: posterConfig.invite_code_label,
        affiliate_poster_qr_label: posterConfig.qr_label,
        affiliate_poster_footer: posterConfig.footer
    };

    Object.entries(posterFieldMap).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = value;
    });

    renderAffiliatePosterTemplates(posterConfig);
}

function renderAffiliatePosterTemplates(config = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster'])) {
    const container = document.getElementById('affiliatePosterTemplateGrid');
    if (!container) return;

    const presets = getAffiliatePosterPresetDefinitions();

    container.innerHTML = config.templates.map(template => {
        const preset = presets.find(item => item.id === template.id) || presets[0];
        const isActive = config.active_template_id === template.id;
        const previewMedia = template.custom_background_url
            ? `<img class="affiliate-poster-preview-media" src="${escapeConfigHtml(template.custom_background_url)}" alt="">`
            : '';

        return `
            <div class="affiliate-poster-card ${isActive ? 'active' : ''}">
                <div class="affiliate-poster-preview ${getAffiliatePosterPreviewClass(preset.id)}">
                    ${previewMedia}
                    <div class="affiliate-poster-chip">${escapeConfigHtml(config.chip_label || '推广')}</div>
                    <div class="affiliate-poster-preview-content">
                        <div class="affiliate-poster-preview-title">${escapeConfigHtml(config.title)}</div>
                        <div class="affiliate-poster-preview-subtitle">${escapeConfigHtml(config.subtitle)}</div>
                        <div class="affiliate-poster-preview-footer">${escapeConfigHtml(config.footer)}</div>
                    </div>
                </div>
                <div class="affiliate-poster-card-body">
                    <div class="affiliate-poster-card-header-row">
                        <div>
                            <div class="affiliate-poster-card-title">${escapeConfigHtml(template.name)}</div>
                            <div class="affiliate-poster-card-desc">${escapeConfigHtml(template.description)}</div>
                        </div>
                        <span class="affiliate-poster-status ${isActive ? 'active' : ''}">${isActive ? '已启用' : '未启用'}</span>
                    </div>
                    <div class="affiliate-poster-asset-state">
                        ${template.custom_background_url ? '已上传自定义底图' : '使用内置背景'}
                    </div>
                    <div class="affiliate-poster-actions">
                        <button type="button" class="poster-action-btn primary" data-admin-action="settings-select-affiliate-poster-template" data-poster-template-id="${template.id}">
                            ${isActive ? '当前模板' : '设为默认'}
                        </button>
                        <label class="poster-action-btn upload">
                            上传底图
                            <input type="file" accept="image/*" data-admin-change-action="settings-affiliate-poster-upload" data-poster-template-id="${template.id}">
                        </label>
                        <button type="button" class="poster-action-btn" ${template.custom_background_url ? '' : 'disabled'} data-admin-action="settings-reset-affiliate-poster-background" data-poster-template-id="${template.id}">
                            恢复默认
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================
// UPDATE FUNCTIONS
// ============================================

async function saveConfig(key, value) {
    try {
        const { error } = await supabaseClient.rpc('update_system_config', {
            p_key: key,
            p_value: value
        });

        if (error) throw error;

        systemConfigCache[key] = value;

        return true;
    } catch (err) {
        console.error('[Config] Save error:', err);
        if (typeof showToast === 'function') {
            showToast('保存失败: ' + err.message, 'error');
        }
        return false;
    }
}

async function resolveAdminConfigAccessToken() {
    if (window.AdminApi?.getAccessToken) {
        try {
            const accessToken = await window.AdminApi.getAccessToken();
            if (accessToken) {
                return String(accessToken).trim();
            }
        } catch (_) {
            // Fall through to runtime auth client.
        }
    }

    if (window.supabaseClient?.accessToken) {
        try {
            const accessToken = await Promise.race([
                Promise.resolve().then(() => window.supabaseClient.accessToken()),
                new Promise((resolve) => {
                    window.setTimeout(() => resolve(''), 1800);
                })
            ]);
            if (accessToken) {
                return String(accessToken).trim();
            }
        } catch (_) {
            // Fall through to direct auth lookup.
        }
    }

    if (window.supabaseClient?.auth?.getSession) {
        try {
            const sessionResult = await Promise.race([
                Promise.resolve().then(() => window.supabaseClient.auth.getSession()),
                new Promise((resolve) => {
                    window.setTimeout(() => resolve(null), 1800);
                })
            ]);
            const accessToken = String(sessionResult?.data?.session?.access_token || '').trim();
            if (accessToken) {
                return accessToken;
            }
        } catch (_) {
            return '';
        }
    }

    return '';
}

async function getAdminConfigApiHeaders() {
    const headers = {
        'Content-Type': 'application/json'
    };

    const accessToken = await resolveAdminConfigAccessToken();
    if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
    }

    return headers;
}

function isMissingScopedSystemNotificationColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    return error?.code === '42703'
        || error?.code === '42P01'
        || (message.includes('column') && message.includes('does not exist'))
        || (message.includes('schema cache') && message.includes('scope'))
        || (message.includes('schema cache') && message.includes('category'));
}

async function insertClientSystemNotificationWithScope(payload = {}) {
    let response = await window.supabaseClient
        .from('system_notifications')
        .insert(payload);

    if (!response?.error || !isMissingScopedSystemNotificationColumnError(response.error)) {
        return response;
    }

    const legacyPayload = { ...payload };
    delete legacyPayload.scope;
    delete legacyPayload.category;

    response = await window.supabaseClient
        .from('system_notifications')
        .insert(legacyPayload);

    return response;
}

function isActiveAdminRoleForClientNotification(role = {}, nowMs = Date.now()) {
    const roleName = String(role?.role_name || '').trim().toLowerCase();
    if (!['admin', 'super_admin'].includes(roleName)) {
        return false;
    }

    const expiresAt = String(role?.expires_at || '').trim();
    if (!expiresAt) {
        return true;
    }

    const expiresMs = Date.parse(expiresAt);
    return Number.isFinite(expiresMs) && expiresMs > nowMs;
}

async function listActiveAdminUserIdsForClientNotifications(excludeUserId = '') {
    const { data, error } = await window.supabaseClient
        .from('admin_roles')
        .select('user_id, role_name, expires_at');

    if (error) {
        throw error;
    }

    const normalizedExcludeUserId = String(excludeUserId || '').trim();
    const nowMs = Date.now();
    return Array.from(new Set(
        (data || [])
            .filter((row) => isActiveAdminRoleForClientNotification(row, nowMs))
            .map((row) => String(row?.user_id || '').trim())
            .filter((userId) => userId && userId !== normalizedExcludeUserId)
    ));
}

async function hasRecentClientSystemNotification({
    userId = '',
    title = '',
    content = '',
    scope = 'admin_personal',
    category = 'general',
    dedupeWindowMinutes = 30
} = {}) {
    const normalizedUserId = String(userId || '').trim();
    const normalizedTitle = String(title || '').trim();
    const normalizedContent = String(content || '').trim();
    if (!normalizedUserId || !normalizedTitle || !normalizedContent || !(dedupeWindowMinutes > 0)) {
        return false;
    }

    const sinceIso = new Date(Date.now() - dedupeWindowMinutes * 60 * 1000).toISOString();
    let response = await window.supabaseClient
        .from('system_notifications')
        .select('id, title, content, created_at, scope, category')
        .eq('user_id', normalizedUserId)
        .eq('title', normalizedTitle)
        .eq('scope', String(scope || '').trim() || 'admin_personal')
        .eq('category', String(category || '').trim() || 'general')
        .gte('created_at', sinceIso);

    if (response?.error && isMissingScopedSystemNotificationColumnError(response.error)) {
        response = await window.supabaseClient
            .from('system_notifications')
            .select('id, title, content, created_at')
            .eq('user_id', normalizedUserId)
            .eq('title', normalizedTitle)
            .gte('created_at', sinceIso);
    }

    if (response?.error) {
        console.warn('[Config] Announcement reminder dedupe lookup failed:', response.error.message || response.error);
        return false;
    }

    return (response?.data || []).some((row) => String(row?.content || '').trim() === normalizedContent);
}

function getAnnouncementTypeLabel(type = 'banner') {
    const normalized = String(type || '').trim().toLowerCase();
    if (normalized === 'modal') {
        return '弹窗公告';
    }
    if (normalized === 'toast') {
        return '浮层提示';
    }
    return '横幅公告';
}

function getAnnouncementPageLabels(pages = []) {
    const pageLabelMap = {
        all: '全部页面',
        prompts: '图库',
        index: '主页',
        shop: '商城',
        verify: '验证',
        guestbook: '留言'
    };

    const normalizedPages = Array.isArray(pages) ? pages : [];
    if (!normalizedPages.length || normalizedPages.includes('all')) {
        return [pageLabelMap.all];
    }

    return normalizedPages
        .map((page) => pageLabelMap[String(page || '').trim().toLowerCase()] || String(page || '').trim())
        .filter(Boolean);
}

function extractAnnouncementPreviewText(content = '', maxLength = 72) {
    const raw = String(content || '').trim();
    if (!raw) {
        return '';
    }

    let plainText = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n');
    if (typeof document !== 'undefined' && document.createElement) {
        const container = document.createElement('div');
        container.innerHTML = plainText;
        plainText = container.textContent || container.innerText || '';
    } else {
        plainText = plainText.replace(/<[^>]+>/g, ' ');
    }

    plainText = plainText.replace(/\s+/g, ' ').trim();
    if (!plainText) {
        return '';
    }

    return plainText.length > maxLength
        ? `${plainText.slice(0, Math.max(1, maxLength - 1)).trim()}…`
        : plainText;
}

async function notifyActiveAdminsAboutAnnouncement(previousConfig = {}, nextConfig = {}) {
    if (!window.supabaseClient?.from || !window.supabaseClient?.auth) {
        return { recipients: 0, created: 0, skipped: 0 };
    }

    const { data: { user } = {} } = await window.supabaseClient.auth.getUser();
    const actorUserId = String(user?.id || '').trim();
    const actorLabel = String(user?.email || '').trim() || '某位管理员';
    const recipientIds = await listActiveAdminUserIdsForClientNotifications(actorUserId);
    if (!recipientIds.length) {
        return { recipients: 0, created: 0, skipped: 0 };
    }

    const previousEnabled = previousConfig?.announcement_enabled === true;
    const nextEnabled = nextConfig?.announcement_enabled === true;
    const announcementTypeLabel = getAnnouncementTypeLabel(nextConfig?.announcement_type);
    const pageLabels = getAnnouncementPageLabels(nextConfig?.announcement_pages);
    const previewText = extractAnnouncementPreviewText(nextConfig?.announcement_content);
    const dedupeWindowMinutes = 20;

    let title = '站内公告已更新';
    let actionLabel = '更新';
    if (nextEnabled && !previousEnabled) {
        title = '站内公告已发布';
        actionLabel = '发布';
    } else if (!nextEnabled && previousEnabled) {
        title = '站内公告已下线';
        actionLabel = '下线';
    } else if (!nextEnabled) {
        title = '站内公告设置已更新';
        actionLabel = '调整';
    }

    const lines = [
        `${actorLabel} 刚刚${actionLabel}了站内公告。`,
        `当前状态：${nextEnabled ? '已启用' : '已关闭'}`,
        `展示形态：${announcementTypeLabel}`,
        `显示页面：${pageLabels.join(' / ')}`
    ];
    if (previewText) {
        lines.push(`公告摘要：${previewText}`);
    }

    const content = lines.join('\n');
    let created = 0;
    let skipped = 0;

    for (const userId of recipientIds) {
        const exists = await hasRecentClientSystemNotification({
            userId,
            title,
            content,
            scope: 'admin_personal',
            category: 'announcement',
            dedupeWindowMinutes
        });
        if (exists) {
            skipped += 1;
            continue;
        }

        const { error } = await insertClientSystemNotificationWithScope({
            user_id: userId,
            title,
            content,
            type: nextEnabled ? 'info' : 'warning',
            is_read: false,
            scope: 'admin_personal',
            category: 'announcement'
        });

        if (error) {
            throw error;
        }

        created += 1;
    }

    return {
        recipients: recipientIds.length,
        created,
        skipped
    };
}

async function loadPaymentChannelSettings(force = false) {
    if (loadPaymentChannelSettings._loadingPromise && !force) {
        return loadPaymentChannelSettings._loadingPromise;
    }

    loadPaymentChannelSettings._loadingPromise = (async () => {
        try {
            const headers = await getAdminConfigApiHeaders();
            const response = await fetch('/api/admin/settings/payment-channels', {
                method: 'GET',
                headers
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) {
                throw new Error(payload.message || '加载支付通道配置失败');
            }

            systemConfigCache['payment_channels'] = normalizePaymentChannelsConfig(payload.config);
            paymentChannelSecretStatus = payload.secrets || getDefaultPaymentChannelSecretStatus();
            paymentChannelRuntimeState = normalizePaymentChannelRuntimeState(payload.runtime);
            const rechargeOptions = normalizeRechargeOptionsConfig(systemConfigCache['recharge_options']);
            rechargeOptions.mock_payment_enabled = systemConfigCache['payment_channels'].active_provider === 'mock';
            systemConfigCache['recharge_options'] = rechargeOptions;
            renderPaymentChannelsConfig();
            renderPackagesConfig();
            return payload;
        } catch (error) {
            console.warn('[Config] Payment channel settings load failed:', error.message);
            paymentChannelSecretStatus = getDefaultPaymentChannelSecretStatus();
            paymentChannelRuntimeState = getDefaultPaymentChannelRuntimeState();
            renderPaymentChannelsConfig();
            renderPackagesConfig();
            return null;
        }
    })();

    try {
        return await loadPaymentChannelSettings._loadingPromise;
    } finally {
        loadPaymentChannelSettings._loadingPromise = null;
    }
}

async function fetchOpsAlertSettingsPayload(headers = {}) {
    return requireOpsAlertWorkbenchMethod('fetchAdminWorkbenchOpsAlertSettings')(headers, {
        errorMessage: '加载站外告警配置失败'
    });
}

function resolveOpsAlertSettingsPayload(payload = {}) {
    return requireOpsAlertWorkbenchMethod('normalizeAdminWorkbenchOpsAlertSettingsPayload')(payload, {
        normalizeConfig: normalizeOpsAlertConfig,
        defaultSecrets: getDefaultOpsAlertSecretStatus()
    });
}

function resolveLocalOpsAlertRuntimeState(mode = 'ready', value = null, builders = {}, currentState = null) {
    const normalizedMode = String(mode || 'ready').trim().toLowerCase();
    if (normalizedMode === 'loading' && typeof builders.loading === 'function') {
        return builders.loading(currentState);
    }
    if (normalizedMode === 'error' && typeof builders.error === 'function') {
        return builders.error(value);
    }
    if (typeof builders.ready === 'function') {
        return builders.ready(value || {});
    }
    return value || currentState || {};
}

function applyLocalOpsAlertRuntimeState(nextState = {}, options = {}) {
    const warningMessage = typeof options.getWarningMessage === 'function'
        ? String(options.getWarningMessage(nextState) || '').trim()
        : '';

    if (warningMessage) {
        console.warn(warningMessage);
    }

    if (typeof options.applyState === 'function') {
        options.applyState(nextState);
    }
    if (typeof options.render === 'function') {
        options.render(nextState);
    }

    return typeof options.shouldReturnNull === 'function' && options.shouldReturnNull(nextState)
        ? null
        : nextState;
}

async function runOpsAlertSingletonLoad(target = null, force = false, executor = null) {
    if (!target || typeof executor !== 'function') {
        return null;
    }
    if (target._loadingPromise && !force) {
        return target._loadingPromise;
    }

    target._loadingPromise = (async () => executor())();

    try {
        return await target._loadingPromise;
    } finally {
        target._loadingPromise = null;
    }
}

function buildLocalOpsAlertSettingsReadyState(payload = {}) {
    const normalizedPayload = resolveOpsAlertSettingsPayload(payload);
    return {
        config: normalizedPayload.config,
        secrets: normalizedPayload.secrets,
        errorMessage: ''
    };
}

function buildLocalOpsAlertSettingsErrorState(error = null) {
    return {
        config: normalizeOpsAlertConfig(systemConfigCache['ops_alerts']),
        secrets: getDefaultOpsAlertSecretStatus(),
        errorMessage: error?.message || '未知错误'
    };
}

function resolveOpsAlertSettingsRuntimeState(mode = 'ready', value = null) {
    return resolveLocalOpsAlertRuntimeState(mode, value, {
        ready: buildLocalOpsAlertSettingsReadyState,
        error: buildLocalOpsAlertSettingsErrorState
    });
}

function applyOpsAlertSettingsRuntimeState(runtimeState = {}) {
    return applyLocalOpsAlertRuntimeState(runtimeState, {
        getWarningMessage: (state = {}) => state.errorMessage
            ? `[Config] Ops alert settings load failed: ${state.errorMessage}`
            : '',
        applyState: (state = {}) => {
            systemConfigCache['ops_alerts'] = normalizeOpsAlertConfig(state.config);
            opsAlertSecretStatus = state.secrets || getDefaultOpsAlertSecretStatus();
        },
        render: () => renderOpsAlertSettings(),
        shouldReturnNull: (state = {}) => Boolean(state.errorMessage)
    });
}

async function loadOpsAlertSettings(force = false) {
    return runOpsAlertSingletonLoad(loadOpsAlertSettings, force, async () => {
        try {
            const headers = await getAdminConfigApiHeaders();
            const payload = await fetchOpsAlertSettingsPayload(headers);
            applyOpsAlertSettingsRuntimeState(resolveOpsAlertSettingsRuntimeState('ready', payload));
            return payload;
        } catch (error) {
            return applyOpsAlertSettingsRuntimeState(resolveOpsAlertSettingsRuntimeState('error', error));
        }
    });
}

async function fetchOpsAlertHealthPayload(headers = {}) {
    return requireOpsAlertWorkbenchMethod('fetchAdminWorkbenchOpsAlertHealth')(headers, {
        timeoutMs: OPS_ALERT_HEALTH_FETCH_TIMEOUT_MS,
        errorMessage: '加载站外告警通道健康状态失败'
    });
}

function resolveOpsAlertHealthPayload(payload = {}) {
    return requireOpsAlertWorkbenchMethod('normalizeAdminWorkbenchOpsAlertHealthPayload')(payload, {
        defaultSummary: getDefaultOpsAlertHealthState().summary
    });
}

function buildLocalOpsAlertHealthLoadingState(state = opsAlertHealthState || getDefaultOpsAlertHealthState()) {
    return {
        ...(state || getDefaultOpsAlertHealthState()),
        status: 'loading',
        message: '正在加载站外告警通道健康状态...'
    };
}

function resolveOpsAlertHealthReadyState(payload = {}) {
    return {
        status: 'ready',
        ...resolveOpsAlertHealthPayload(payload)
    };
}

function buildLocalOpsAlertHealthErrorState(error = null) {
    return {
        ...getDefaultOpsAlertHealthState(),
        status: 'error',
        message: error?.name === 'AbortError'
            ? '加载站外告警通道健康状态超时，请稍后重试'
            : (error?.message || '加载站外告警通道健康状态失败')
    };
}

function resolveOpsAlertHealthRuntimeState(mode = 'ready', value = null, currentState = opsAlertHealthState || getDefaultOpsAlertHealthState()) {
    return resolveLocalOpsAlertRuntimeState(mode, value, {
        loading: buildLocalOpsAlertHealthLoadingState,
        error: buildLocalOpsAlertHealthErrorState,
        ready: resolveOpsAlertHealthReadyState
    }, currentState);
}

function applyOpsAlertHealthRuntimeState(nextState = getDefaultOpsAlertHealthState()) {
    return applyLocalOpsAlertRuntimeState(nextState, {
        applyState: (state = {}) => {
            opsAlertHealthState = state;
        },
        render: () => renderOpsAlertHealthPanel()
    });
}

async function loadOpsAlertHealth(force = false) {
    applyOpsAlertHealthRuntimeState(resolveOpsAlertHealthRuntimeState('loading'));
    return runOpsAlertSingletonLoad(loadOpsAlertHealth, force, async () => {
        try {
            const headers = await getAdminConfigApiHeaders();
            const payload = await fetchOpsAlertHealthPayload(headers);
            applyOpsAlertHealthRuntimeState(resolveOpsAlertHealthRuntimeState('ready', payload));
            return payload;
        } catch (error) {
            const errorState = resolveOpsAlertHealthRuntimeState('error', error);
            console.warn('[Config] Ops alert health load failed:', errorState.message);
            applyOpsAlertHealthRuntimeState(errorState);
            return null;
        }
    });
}

async function fetchOpsAlertMonitorPayload(headers = {}) {
    return requireOpsAlertWorkbenchMethod('fetchAdminWorkbenchOpsAlertMonitor')(headers, {
        timeoutMs: OPS_ALERT_MONITOR_FETCH_TIMEOUT_MS,
        errorMessage: '加载集中告警处理面板失败'
    });
}

function resolveOpsAlertMonitorPayload(payload = {}) {
    const defaultSummary = getDefaultOpsAlertMonitorState().summary;
    return requireOpsAlertWorkbenchMethod('normalizeAdminWorkbenchOpsAlertMonitorPayload')(payload, {
        defaultSummary,
        normalizeShiftReport: normalizeOpsAlertMonitorShiftReport
    });
}

function buildLocalOpsAlertMonitorLoadingState(state = opsAlertMonitorState || getDefaultOpsAlertMonitorState()) {
    return {
        ...(state || getDefaultOpsAlertMonitorState()),
        status: 'loading',
        message: '正在加载集中告警处理面板...'
    };
}

function resolveOpsAlertMonitorReadyState(payload = {}) {
    return {
        status: 'ready',
        ...resolveOpsAlertMonitorPayload(payload)
    };
}

function buildLocalOpsAlertMonitorErrorState(error = null) {
    return {
        ...getDefaultOpsAlertMonitorState(),
        status: 'error',
        message: error?.name === 'AbortError'
            ? '加载集中告警处理面板超时，请稍后重试'
            : (error?.message || '加载集中告警处理面板失败')
    };
}

function resolveOpsAlertMonitorRuntimeState(mode = 'ready', value = null, currentState = opsAlertMonitorState || getDefaultOpsAlertMonitorState()) {
    return resolveLocalOpsAlertRuntimeState(mode, value, {
        loading: buildLocalOpsAlertMonitorLoadingState,
        error: buildLocalOpsAlertMonitorErrorState,
        ready: resolveOpsAlertMonitorReadyState
    }, currentState);
}

function applyOpsAlertMonitorRuntimeState(nextState = getDefaultOpsAlertMonitorState()) {
    return applyLocalOpsAlertRuntimeState(nextState, {
        applyState: (state = {}) => {
            opsAlertMonitorState = state;
        },
        render: () => renderOpsAlertMonitorPanel()
    });
}

async function loadOpsAlertMonitor(force = false) {
    applyOpsAlertMonitorRuntimeState(resolveOpsAlertMonitorRuntimeState('loading'));
    return runOpsAlertSingletonLoad(loadOpsAlertMonitor, force, async () => {
        try {
            const headers = await getAdminConfigApiHeaders();
            const payload = await fetchOpsAlertMonitorPayload(headers);
            applyOpsAlertMonitorRuntimeState(resolveOpsAlertMonitorRuntimeState('ready', payload));
            return payload;
        } catch (error) {
            const errorState = resolveOpsAlertMonitorRuntimeState('error', error);
            console.warn('[Config] Ops alert monitor load failed:', errorState.message);
            applyOpsAlertMonitorRuntimeState(errorState);
            return null;
        }
    });
}

function showConfigSavedToast(message) {
    if (typeof showToast === 'function') {
        showToast(message, 'success');
    }
}

async function saveAffiliateSetting(field, rawValue) {
    const config = normalizeAffiliateProgramConfig(systemConfigCache['affiliate_program']);

    switch (field) {
        case 'commission_rate_shop':
        case 'commission_rate_agent':
            config[field] = clamp(toDecimal(rawValue, config[field]), 0, 1);
            break;
        case 'registration_reward_points':
            config[field] = Math.max(0, toPointNumber(rawValue, config[field]));
            break;
        case 'registration_reward_requires_purchase':
            config[field] = String(rawValue) !== 'false';
            break;
        case 'reward_notice':
        case 'legal_disclaimer':
            config[field] = String(rawValue || '').trim() || getDefaultAffiliateProgramConfig()[field];
            break;
        default:
            return false;
    }

    if (await saveConfig('affiliate_program', config)) {
        loadAffiliateSettings();
        showConfigSavedToast('推广返现设置已保存');
        return true;
    }

    return false;
}

async function saveAffiliatePosterField(field, rawValue) {
    const config = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster']);
    const allowedFields = new Set(['chip_label', 'title', 'subtitle', 'reward_badge_text', 'invite_code_label', 'qr_label', 'footer']);
    if (!allowedFields.has(field)) return false;

    if (field === 'reward_badge_text') {
        config[field] = String(rawValue || '').trim();
    } else {
        config[field] = String(rawValue || '').trim() || getDefaultAffiliatePosterConfig()[field];
    }

    if (await saveConfig('affiliate_poster', config)) {
        renderAffiliatePosterTemplates(config);
        showConfigSavedToast('海报文案已保存');
        return true;
    }

    return false;
}

async function selectAffiliatePosterTemplate(templateId) {
    const config = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster']);
    if (!config.templates.some(template => template.id === templateId)) return false;

    config.active_template_id = templateId;

    if (await saveConfig('affiliate_poster', config)) {
        renderAffiliatePosterTemplates(config);
        showConfigSavedToast('默认海报模板已更新');
        return true;
    }

    return false;
}

function compressConfigImage(file, options = {}) {
    const maxWidth = options.maxWidth || 1600;
    const maxHeight = options.maxHeight || 2400;
    const quality = options.quality || 0.9;

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;

                if (width > height && width > maxWidth) {
                    height = Math.round(height * (maxWidth / width));
                    width = maxWidth;
                } else if (height >= width && height > maxHeight) {
                    width = Math.round(width * (maxHeight / height));
                    height = maxHeight;
                }

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = width;
                canvas.height = height;

                if (!ctx) {
                    reject(new Error('无法初始化图片画布'));
                    return;
                }

                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => reject(new Error('图片解析失败'));
            img.src = reader.result;
        };
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
    });
}

async function uploadAffiliatePosterBackgroundToR2(templateId, file) {
    const accessToken = await resolveAdminConfigAccessToken();
    const userId = String(window.supabaseClient?.auth?.user?.()?.id || '').trim()
        || String(window.__adminStudioAccess?.user?.id || '').trim();

    if (!accessToken || !userId) {
        throw new Error('请先登录');
    }

    const imageData = await compressConfigImage(file, {
        maxWidth: 1800,
        maxHeight: 2600,
        quality: 0.92
    });

    const response = await fetch(
        window.getZaoyoeSupabaseFunctionUrl('upload-avatar'),
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId,
                type: 'poster',
                posterId: `affiliate_${templateId}`,
                imageData
            })
        }
    );

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.imageUrl) {
        throw new Error(result?.error || '海报底图上传失败');
    }

    return result.imageUrl;
}

async function handleAffiliatePosterUpload(templateId, inputEl) {
    const file = inputEl?.files?.[0];
    if (!file) return false;

    const config = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster']);
    const template = config.templates.find(item => item.id === templateId);
    if (!template) return false;

    const labelEl = inputEl.closest('.poster-action-btn.upload');
    if (labelEl) labelEl.classList.add('uploading');

    try {
        const imageUrl = await uploadAffiliatePosterBackgroundToR2(templateId, file);
        template.custom_background_url = imageUrl;

        if (await saveConfig('affiliate_poster', config)) {
            renderAffiliatePosterTemplates(config);
            showConfigSavedToast('海报底图已上传');
            return true;
        }
    } catch (err) {
        console.error('[Config] Affiliate poster upload failed:', err);
        if (typeof showToast === 'function') {
            showToast('上传失败: ' + err.message, 'error');
        }
    } finally {
        if (labelEl) labelEl.classList.remove('uploading');
        if (inputEl) inputEl.value = '';
    }

    return false;
}

async function resetAffiliatePosterBackground(templateId) {
    const config = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster']);
    const template = config.templates.find(item => item.id === templateId);
    if (!template) return false;

    template.custom_background_url = '';

    if (await saveConfig('affiliate_poster', config)) {
        renderAffiliatePosterTemplates(config);
        showConfigSavedToast('已恢复内置海报背景');
        return true;
    }

    return false;
}

// Show save indicator animation
function showSaveIndicator(element) {
    const indicator = element.closest('.config-input-wrapper')?.querySelector('.config-save-indicator');
    if (indicator) {
        indicator.classList.add('visible');
        setTimeout(() => indicator.classList.remove('visible'), 1500);
    }
}

// Debounce helper
let saveTimeouts = {};
function debouncedSave(key, fn, delay = 500) {
    clearTimeout(saveTimeouts[key]);
    saveTimeouts[key] = setTimeout(fn, delay);
}

// ============================================
// EVENT HANDLERS
// ============================================

function setupConfigEventListeners() {
    // Unlock pricing
    const unlockPointsInput = document.getElementById('cfgUnlockPoints');
    const vipDiscountInput = document.getElementById('cfgVipDiscount');

    if (unlockPointsInput) {
        unlockPointsInput.addEventListener('change', async (e) => {
            const config = systemConfigCache['unlock_pricing'] || {};
            config.default_points = parseInt(e.target.value) || 1;
            if (await saveConfig('unlock_pricing', config)) {
                showSaveIndicator(e.target);
            }
        });
    }

    if (vipDiscountInput) {
        vipDiscountInput.addEventListener('change', async (e) => {
            const config = systemConfigCache['unlock_pricing'] || {};
            config.vip_discount = (parseInt(e.target.value) || 90) / 100;
            if (await saveConfig('unlock_pricing', config)) {
                showSaveIndicator(e.target);
            }
        });
    }

    // Rewards config
    ['cfgSignupBonus', 'cfgCommentReward'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', async (e) => {
                const config = systemConfigCache['rewards'] || {};
                const fieldMap = {
                    'cfgSignupBonus': 'signup_bonus',
                    'cfgCommentReward': 'comment_reward'
                };
                const normalizedValue = Math.max(0, toPointNumber(e.target.value, 0));
                e.target.value = normalizedValue;
                config[fieldMap[id]] = normalizedValue;
                if (await saveConfig('rewards', config)) {
                    showSaveIndicator(e.target);
                }
            });
        }
    });

    ['cfgDailyCheckin', 'cfgCheckinStreakBonus', 'cfgCheckinPerfectBonus', 'cfgCheckinMakeupCost'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', async (e) => {
                const config = normalizeCheckinConfig(systemConfigCache['checkin_system']);
                const fieldMap = {
                    'cfgDailyCheckin': 'base_points',
                    'cfgCheckinStreakBonus': 'consecutive_7_points',
                    'cfgCheckinPerfectBonus': 'perfect_month_points',
                    'cfgCheckinMakeupCost': 'makeup_cost_points'
                };
                const normalizedValue = Math.max(0, toPointNumber(e.target.value, config[fieldMap[id]]));
                e.target.value = normalizedValue;
                config[fieldMap[id]] = normalizedValue;
                if (await saveConfig('checkin_system', config)) {
                    showSaveIndicator(e.target);
                }
            });
        }
    });

    setupGeneralSettingsEventListeners();

    // Setup security event listeners
    setupSecurityEventListeners();

    // Setup notifications event listeners
    setupNotificationsEventListeners();

    // Setup moderation event listeners
    setupModerationEventListeners();
}

function setupGeneralSettingsEventListeners() {
    const bindToggle = (elementId, configKey, field) => {
        const element = document.getElementById(elementId);
        if (!element || element.dataset.configBound === '1') {
            return;
        }

        element.dataset.configBound = '1';
        element.addEventListener('change', async (event) => {
            const config = configKey === 'integrations'
                ? normalizeIntegrationsConfig(systemConfigCache[configKey])
                : normalizePerformanceConfig(systemConfigCache[configKey]);

            config[field] = event.target.checked;
            await saveConfig(configKey, config);
        });
    };

    bindToggle('cfgGoogleLogin', 'integrations', 'google_login_enabled');
    bindToggle('cfgWechatLogin', 'integrations', 'wechat_login_enabled');
    bindToggle('cfgSupabaseRealtime', 'integrations', 'supabase_realtime_enabled');
    bindToggle('cfgLazyLoad', 'performance', 'lazy_load_enabled');

    const imageQualityInput = document.getElementById('cfgImageQuality');
    if (imageQualityInput && imageQualityInput.dataset.configBound !== '1') {
        imageQualityInput.dataset.configBound = '1';

        imageQualityInput.addEventListener('input', (event) => {
            const output = document.getElementById('cfgImageQualityValue');
            if (output) output.textContent = `${event.target.value}%`;
        });

        imageQualityInput.addEventListener('change', (event) => {
            const normalizedValue = Math.min(100, Math.max(60, parseInt(event.target.value, 10) || 85));
            event.target.value = normalizedValue;
            const output = document.getElementById('cfgImageQualityValue');
            if (output) output.textContent = `${normalizedValue}%`;

            debouncedSave('performance.image_quality', async () => {
                const config = normalizePerformanceConfig(systemConfigCache['performance']);
                config.image_quality = normalizedValue;
                await saveConfig('performance', config);
            }, 150);
        });
    }
}

// Toggle card collapse
function toggleConfigCard(headerEl) {
    const card = headerEl.closest('.config-card');
    if (card) {
        const isCollapsed = card.classList.toggle('collapsed');
        if (headerEl instanceof HTMLElement) {
            headerEl.setAttribute('aria-expanded', String(!isCollapsed));
        }
    }
}

async function toggleCustomRechargeEntryStatus() {
    const config = normalizeRechargeOptionsConfig(systemConfigCache['recharge_options']);
    const toggleEl = document.getElementById('customRechargeStatusToggle');
    const nextValue = !config.custom_amount_enabled;

    config.custom_amount_enabled = nextValue;

    if (toggleEl) {
        toggleEl.classList.toggle('active', nextValue);
        pulseAdminConfigToggle(toggleEl);
    }

    const success = await saveConfig('recharge_options', config);
    if (!success) {
        config.custom_amount_enabled = !nextValue;
        if (toggleEl) {
            toggleEl.classList.toggle('active', config.custom_amount_enabled);
        }
        return false;
    }

    showConfigSavedToast(nextValue ? '已开启自定义充值入口' : '已关闭自定义充值入口');
    return true;
}

function collectPaymentChannelsConfigFromForm() {
    const currentConfig = normalizePaymentChannelsConfig(systemConfigCache['payment_channels']);
    const activeSelect = document.getElementById('paymentChannelActiveSelect');
    const activeProvider = ['mock', 'afdian', 'hupijiao'].includes(activeSelect?.value)
        ? activeSelect.value
        : currentConfig.active_provider;

    const config = {
        active_provider: activeProvider,
        providers: {
            mock: {
                enabled: document.getElementById('paymentProviderMockToggle')?.classList.contains('active') ?? currentConfig.providers.mock.enabled,
                display_name: document.getElementById('paymentProviderMockDisplayName')?.value?.trim() || currentConfig.providers.mock.display_name,
                description: document.getElementById('paymentProviderMockDescription')?.value?.trim() || currentConfig.providers.mock.description
            },
            afdian: {
                enabled: document.getElementById('paymentProviderAfdianToggle')?.classList.contains('active') ?? currentConfig.providers.afdian.enabled,
                display_name: document.getElementById('paymentProviderAfdianDisplayName')?.value?.trim() || currentConfig.providers.afdian.display_name,
                checkout_url: document.getElementById('paymentProviderAfdianCheckoutUrl')?.value?.trim() || currentConfig.providers.afdian.checkout_url,
                package_hint: document.getElementById('paymentProviderAfdianPackageHint')?.value?.trim() || currentConfig.providers.afdian.package_hint,
                custom_amount_hint: document.getElementById('paymentProviderAfdianCustomHint')?.value?.trim() || currentConfig.providers.afdian.custom_amount_hint
            },
            hupijiao: {
                enabled: document.getElementById('paymentProviderHupijiaoToggle')?.classList.contains('active') ?? currentConfig.providers.hupijiao.enabled,
                display_name: document.getElementById('paymentProviderHupijiaoDisplayName')?.value?.trim() || currentConfig.providers.hupijiao.display_name,
                checkout_url: document.getElementById('paymentProviderHupijiaoCheckoutUrl')?.value?.trim() || currentConfig.providers.hupijiao.checkout_url,
                gateway_url: document.getElementById('paymentProviderHupijiaoGatewayUrl')?.value?.trim() || currentConfig.providers.hupijiao.gateway_url,
                merchant_id: document.getElementById('paymentProviderHupijiaoMerchantId')?.value?.trim() || currentConfig.providers.hupijiao.merchant_id,
                return_url: document.getElementById('paymentProviderHupijiaoReturnUrl')?.value?.trim() || currentConfig.providers.hupijiao.return_url,
                notify_url: document.getElementById('paymentProviderHupijiaoNotifyUrl')?.value?.trim() || currentConfig.providers.hupijiao.notify_url,
                package_hint: document.getElementById('paymentProviderHupijiaoPackageHint')?.value?.trim() || currentConfig.providers.hupijiao.package_hint,
                custom_amount_hint: document.getElementById('paymentProviderHupijiaoCustomHint')?.value?.trim() || currentConfig.providers.hupijiao.custom_amount_hint
            }
        }
    };

    if (!config.providers[config.active_provider]?.enabled) {
        config.providers[config.active_provider].enabled = true;
    }

    return normalizePaymentChannelsConfig(config);
}

function clearPaymentChannelSecretInputs() {
    [
        'paymentProviderAfdianToken',
        'paymentProviderHupijiaoApiKey',
        'paymentProviderHupijiaoSecretKey'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });
}

async function savePaymentChannelSettings(options = {}) {
    try {
        const config = options.configOverride
            ? normalizePaymentChannelsConfig(options.configOverride)
            : collectPaymentChannelsConfigFromForm();
        const headers = await getAdminConfigApiHeaders();
        const body = {
            config,
            secrets: {
                afdian_token: document.getElementById('paymentProviderAfdianToken')?.value?.trim() || '',
                hupijiao_api_key: document.getElementById('paymentProviderHupijiaoApiKey')?.value?.trim() || '',
                hupijiao_secret_key: document.getElementById('paymentProviderHupijiaoSecretKey')?.value?.trim() || ''
            }
        };

        const response = await fetch('/api/admin/settings/payment-channels', {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '保存支付通道配置失败');
        }

        systemConfigCache['payment_channels'] = normalizePaymentChannelsConfig(payload.config);
        paymentChannelSecretStatus = payload.secrets || getDefaultPaymentChannelSecretStatus();
        paymentChannelRuntimeState = normalizePaymentChannelRuntimeState(payload.runtime);

        const rechargeOptions = normalizeRechargeOptionsConfig(systemConfigCache['recharge_options']);
        rechargeOptions.mock_payment_enabled = systemConfigCache['payment_channels'].active_provider === 'mock';
        systemConfigCache['recharge_options'] = rechargeOptions;

        renderPaymentChannelsConfig();
        renderPackagesConfig();
        clearPaymentChannelSecretInputs();
        showConfigSavedToast(options.successMessage || payload.message || '支付通道配置已保存');
        return true;
    } catch (err) {
        console.error('[Config] Save payment channels failed:', err);
        showToast('保存失败: ' + (err.message || '未知错误'), 'error');
        renderPaymentChannelsConfig();
        renderPackagesConfig();
        return false;
    }
}

async function togglePaymentProviderEnabled(providerKey) {
    const toggleMap = {
        mock: 'paymentProviderMockToggle',
        afdian: 'paymentProviderAfdianToggle',
        hupijiao: 'paymentProviderHupijiaoToggle'
    };
    const toggleEl = document.getElementById(toggleMap[providerKey]);
    if (!toggleEl) return;

    const nextValue = !toggleEl.classList.contains('active');
    toggleEl.classList.toggle('active', nextValue);
    pulseAdminConfigToggle(toggleEl);

    if (nextValue) {
        setPaymentProviderPanelExpanded(providerKey, true);
    } else {
        setPaymentProviderPanelExpanded(providerKey, false);
    }

    const activeSelect = document.getElementById('paymentChannelActiveSelect');
    if (!nextValue && activeSelect?.value === providerKey) {
        const fallback = ['mock', 'afdian', 'hupijiao'].find((key) => key !== providerKey && document.getElementById(toggleMap[key])?.classList.contains('active'));
        if (fallback) {
            activeSelect.value = fallback;
        } else {
            toggleEl.classList.add('active');
            showToast('至少需要保留一个可用的支付通道', 'warning');
        }
    }

    applyPaymentChannelOverview(collectPaymentChannelsConfigFromForm());
}

async function toggleMockPaymentStatus() {
    const currentConfig = normalizePaymentChannelsConfig(systemConfigCache['payment_channels']);
    const nextValue = !(normalizeRechargeOptionsConfig(systemConfigCache['recharge_options']).mock_payment_enabled);

    if (nextValue) {
        currentConfig.active_provider = 'mock';
        currentConfig.providers.mock.enabled = true;
    } else if (currentConfig.active_provider === 'mock') {
        currentConfig.active_provider = currentConfig.providers.afdian.enabled ? 'afdian' : 'hupijiao';
        if (!currentConfig.providers[currentConfig.active_provider]?.enabled) {
            currentConfig.providers.afdian.enabled = true;
            currentConfig.active_provider = 'afdian';
        }
    }

    return savePaymentChannelSettings({
        configOverride: currentConfig,
        successMessage: nextValue ? '已开启临时模拟支付' : '已关闭临时模拟支付'
    });
}

function buildLocalOpsAlertConfigDraft(currentConfig = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    return {
        ...currentConfig,
        temporary_mute: {
            ...currentConfig.temporary_mute
        },
        quiet_hours: {
            ...currentConfig.quiet_hours
        },
        work_hours: {
            ...currentConfig.work_hours
        },
        mute_rules: {
            types: {
                ...currentConfig.mute_rules.types
            },
            modules: {
                ...currentConfig.mute_rules.modules
            }
        },
        channels: {
            telegram: {
                ...currentConfig.channels.telegram
            },
            feishu: {
                ...currentConfig.channels.feishu
            },
            email: {
                ...currentConfig.channels.email
            }
        },
        routing: {
            customer_chat_message: {
                ...currentConfig.routing.customer_chat_message
            },
            shop_purchase_success: {
                ...currentConfig.routing.shop_purchase_success
            },
            wallet_recharge_success: {
                ...currentConfig.routing.wallet_recharge_success
            },
            shop_inventory: {
                ...currentConfig.routing.shop_inventory
            },
            payment_refund_ops: {
                ...currentConfig.routing.payment_refund_ops
            },
            payment_config: {
                ...currentConfig.routing.payment_config
            },
            shop_order_risk: {
                ...currentConfig.routing.shop_order_risk
            },
            admin_login_anomaly: {
                ...currentConfig.routing.admin_login_anomaly
            },
            tickets: {
                ...currentConfig.routing.tickets
            },
            shop_order_delivery: {
                ...currentConfig.routing.shop_order_delivery
            },
            payment_gateway: {
                ...currentConfig.routing.payment_gateway
            },
            verify_quota: {
                ...currentConfig.routing.verify_quota
            },
            verify_queue: {
                ...currentConfig.routing.verify_queue
            },
            verify_failure: {
                ...currentConfig.routing.verify_failure
            }
        },
        shop_order_risk: {
            ...currentConfig.shop_order_risk
        },
        shop_inventory: {
            ...currentConfig.shop_inventory
        },
        customer_chat_message: {
            ...currentConfig.customer_chat_message,
            quick_reply_templates: normalizeOpsAlertCustomerChatQuickReplyTemplates(currentConfig.customer_chat_message?.quick_reply_templates)
        },
        shop_purchase_success: {
            ...currentConfig.shop_purchase_success
        },
        wallet_recharge_success: {
            ...currentConfig.wallet_recharge_success
        },
        tickets: {
            ...currentConfig.tickets
        },
        shop_order_delivery: {
            ...currentConfig.shop_order_delivery
        },
        verify_quota: {
            ...currentConfig.verify_quota
        },
        verify_queue: {
            ...currentConfig.verify_queue
        },
        verify_failure: {
            ...currentConfig.verify_failure
        },
        payment_gateway: {
            ...currentConfig.payment_gateway
        }
    };
}

function resolveOpsAlertConfigDraft(currentConfig = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertConfigDraft',
        buildLocalOpsAlertConfigDraft,
        () => ({
            normalizeQuickReplyTemplates: normalizeOpsAlertCustomerChatQuickReplyTemplates
        })
    )(currentConfig);
}

function buildLocalOpsAlertStrategyDraft(currentConfig = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const nextRouting = { ...(currentConfig.routing || {}) };

    Object.keys(nextRouting).forEach((routingKey) => {
        nextRouting[routingKey] = {
            telegram: nextRouting[routingKey]?.telegram !== false,
            feishu: nextRouting[routingKey]?.feishu !== false,
            email: nextRouting[routingKey]?.email !== false
        };
    });

    const nextMuteRules = {
        types: { ...(currentConfig.mute_rules?.types || {}) },
        modules: { ...(currentConfig.mute_rules?.modules || {}) }
    };

    ['types', 'modules'].forEach((scope) => {
        getOpsAlertMuteRuleDefinitions(scope).forEach((definition) => {
            const currentRule = currentConfig.mute_rules?.[scope]?.[definition.key] || {
                until: '',
                allow_critical: true
            };
            nextMuteRules[scope][definition.key] = {
                ...currentRule,
                until: normalizeDateTimeLocalInputValue(
                    document.getElementById(getOpsAlertMuteRuleElementId(scope, definition.key, 'Until'))?.value ?? currentRule.until
                ),
                allow_critical: document.getElementById(getOpsAlertMuteRuleElementId(scope, definition.key, 'AllowCriticalToggle'))?.classList.contains('active')
                    ?? currentRule.allow_critical
            };
        });
    });

    Object.keys(nextRouting).forEach((routingKey) => {
        ['telegram', 'feishu', 'email'].forEach((channelKey) => {
            const checkbox = document.getElementById(getOpsAlertRoutingCheckboxId(routingKey, channelKey));
            if (!checkbox) return;
            nextRouting[routingKey][channelKey] = checkbox.checked;
        });
    });

    return {
        enabled: document.getElementById('opsAlertEnabledToggle')?.classList.contains('active') ?? currentConfig.enabled,
        temporary_mute: {
            ...(currentConfig.temporary_mute || {}),
            until: normalizeDateTimeLocalInputValue(
                document.getElementById('opsAlertTemporaryMuteUntil')?.value ?? currentConfig.temporary_mute.until
            ),
            allow_critical: document.getElementById('opsAlertTemporaryMuteAllowCriticalToggle')?.classList.contains('active')
                ?? currentConfig.temporary_mute.allow_critical
        },
        quiet_hours: {
            ...(currentConfig.quiet_hours || {}),
            enabled: document.getElementById('opsAlertQuietHoursEnabledToggle')?.classList.contains('active')
                ?? currentConfig.quiet_hours.enabled,
            start_hour: clamp(
                toWholeNumber(
                    document.getElementById('opsAlertQuietHoursStartHour')?.value,
                    currentConfig.quiet_hours.start_hour
                ),
                0,
                23
            ),
            end_hour: clamp(
                toWholeNumber(
                    document.getElementById('opsAlertQuietHoursEndHour')?.value,
                    currentConfig.quiet_hours.end_hour
                ),
                0,
                23
            ),
            timezone: String(
                document.getElementById('opsAlertQuietHoursTimezone')?.value ?? currentConfig.quiet_hours.timezone
            ).trim() || currentConfig.quiet_hours.timezone,
            allow_critical: document.getElementById('opsAlertQuietHoursAllowCriticalToggle')?.classList.contains('active')
                ?? currentConfig.quiet_hours.allow_critical
        },
        work_hours: {
            ...(currentConfig.work_hours || {}),
            enabled: document.getElementById('opsAlertWorkHoursEnabledToggle')?.classList.contains('active')
                ?? currentConfig.work_hours.enabled,
            start_hour: clamp(
                toWholeNumber(
                    document.getElementById('opsAlertWorkHoursStartHour')?.value,
                    currentConfig.work_hours.start_hour
                ),
                0,
                23
            ),
            end_hour: clamp(
                toWholeNumber(
                    document.getElementById('opsAlertWorkHoursEndHour')?.value,
                    currentConfig.work_hours.end_hour
                ),
                0,
                23
            ),
            timezone: String(
                document.getElementById('opsAlertWorkHoursTimezone')?.value ?? currentConfig.work_hours.timezone
            ).trim() || currentConfig.work_hours.timezone
        },
        mute_rules: nextMuteRules,
        channels: {
            telegram: {
                ...(currentConfig.channels?.telegram || {}),
                enabled: document.getElementById('opsAlertTelegramEnabledToggle')?.classList.contains('active')
                    ?? currentConfig.channels.telegram.enabled,
                chat_ids: normalizeConfigStringArray(
                    document.getElementById('opsAlertTelegramChatIds')?.value ?? currentConfig.channels.telegram.chat_ids
                ),
                minimum_severity: normalizeOpsAlertSeverity(
                    document.getElementById('opsAlertTelegramSeverity')?.value,
                    currentConfig.channels.telegram.minimum_severity
                )
            },
            feishu: {
                ...(currentConfig.channels?.feishu || {}),
                enabled: document.getElementById('opsAlertFeishuEnabledToggle')?.classList.contains('active')
                    ?? currentConfig.channels.feishu.enabled,
                minimum_severity: normalizeOpsAlertSeverity(
                    document.getElementById('opsAlertFeishuSeverity')?.value,
                    currentConfig.channels.feishu.minimum_severity
                )
            },
            email: {
                ...(currentConfig.channels?.email || {}),
                enabled: document.getElementById('opsAlertEmailEnabledToggle')?.classList.contains('active')
                    ?? currentConfig.channels.email.enabled,
                minimum_severity: normalizeOpsAlertSeverity(
                    document.getElementById('opsAlertEmailSeverity')?.value,
                    currentConfig.channels.email.minimum_severity
                ),
                recipients: normalizeConfigStringArray(
                    document.getElementById('opsAlertEmailRecipients')?.value ?? currentConfig.channels.email.recipients
                ),
                from_address: String(
                    document.getElementById('opsAlertEmailFromAddress')?.value ?? currentConfig.channels.email.from_address
                ).trim(),
                reply_to: String(
                    document.getElementById('opsAlertEmailReplyTo')?.value ?? currentConfig.channels.email.reply_to
                ).trim(),
                subject_prefix: String(
                    document.getElementById('opsAlertEmailSubjectPrefix')?.value ?? currentConfig.channels.email.subject_prefix
                ).trim() || currentConfig.channels.email.subject_prefix
            }
        },
        routing: nextRouting
    };
}

function resolveOpsAlertStrategyDraft(currentConfig = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    return resolveOpsAlertSharedCallable(
        'collectAdminWorkbenchOpsAlertStrategyDraft',
        buildLocalOpsAlertStrategyDraft,
        () => ({
            document,
            normalizeDateTimeLocalInputValue,
            clamp,
            toWholeNumber,
            normalizeConfigStringArray,
            normalizeOpsAlertSeverity,
            getMuteRuleDefinitions: getOpsAlertMuteRuleDefinitions,
            getMuteRuleElementId: getOpsAlertMuteRuleElementId,
            getRoutingCheckboxId: getOpsAlertRoutingCheckboxId
        })
    )(currentConfig);
}

function buildLocalOpsAlertOperationalThresholdDrafts(currentConfig = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    return {
        shop_order_risk: {
            ...currentConfig.shop_order_risk,
            auto_response_enabled: document.getElementById('opsAlertShopRiskAutoResponseEnabledToggle')?.classList.contains('active')
                ?? currentConfig.shop_order_risk.auto_response_enabled,
            auto_disable_coupon_min_risk_score: toWholeNumber(
                document.getElementById('opsAlertShopRiskAutoDisableCouponMinRiskScore')?.value,
                currentConfig.shop_order_risk.auto_disable_coupon_min_risk_score
            ),
            auto_ban_user_min_risk_score: toWholeNumber(
                document.getElementById('opsAlertShopRiskAutoBanUserMinRiskScore')?.value,
                currentConfig.shop_order_risk.auto_ban_user_min_risk_score
            ),
            auto_ban_user_duration_days: toWholeNumber(
                document.getElementById('opsAlertShopRiskAutoBanUserDurationDays')?.value,
                currentConfig.shop_order_risk.auto_ban_user_duration_days
            ),
            auto_suspend_product_min_risk_score: toWholeNumber(
                document.getElementById('opsAlertShopRiskAutoSuspendProductMinRiskScore')?.value,
                currentConfig.shop_order_risk.auto_suspend_product_min_risk_score
            )
        },
        shop_inventory: {
            ...currentConfig.shop_inventory,
            enabled: document.getElementById('opsAlertShopInventoryEnabledToggle')?.classList.contains('active')
                ?? currentConfig.shop_inventory.enabled,
            low_stock_threshold: toWholeNumber(
                document.getElementById('opsAlertShopInventoryLowStockThreshold')?.value,
                currentConfig.shop_inventory.low_stock_threshold
            ),
            sweep_interval_ms: Math.max(
                10000,
                toWholeNumber(
                    document.getElementById('opsAlertShopInventorySweepIntervalMinutes')?.value,
                    Math.max(1, Math.round(Number(currentConfig.shop_inventory.sweep_interval_ms || 0) / 60000))
                ) * 60 * 1000
            ),
            sales_window_days: toWholeNumber(
                document.getElementById('opsAlertShopInventorySalesWindowDays')?.value,
                currentConfig.shop_inventory.sales_window_days
            ),
            dedupe_window_minutes: toWholeNumber(
                document.getElementById('opsAlertShopInventoryDedupeWindowMinutes')?.value,
                currentConfig.shop_inventory.dedupe_window_minutes
            ),
            recovery_notification_enabled: document.getElementById('opsAlertShopInventoryRecoveryNotificationEnabledToggle')?.classList.contains('active')
                ?? currentConfig.shop_inventory.recovery_notification_enabled,
            summary_enabled: document.getElementById('opsAlertShopInventorySummaryEnabledToggle')?.classList.contains('active')
                ?? currentConfig.shop_inventory.summary_enabled,
            summary_window_minutes: toWholeNumber(
                document.getElementById('opsAlertShopInventorySummaryWindowMinutes')?.value,
                currentConfig.shop_inventory.summary_window_minutes
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                document.getElementById('opsAlertShopInventorySummaryScheduleMode')?.value,
                currentConfig.shop_inventory.summary_schedule_mode
            ),
            summary_hourly_minute: toWholeNumber(
                document.getElementById('opsAlertShopInventorySummaryHourlyMinute')?.value,
                currentConfig.shop_inventory.summary_hourly_minute
            ),
            summary_daily_hour: toWholeNumber(
                document.getElementById('opsAlertShopInventorySummaryDailyHour')?.value,
                currentConfig.shop_inventory.summary_daily_hour
            ),
            summary_daily_minute: toWholeNumber(
                document.getElementById('opsAlertShopInventorySummaryDailyMinute')?.value,
                currentConfig.shop_inventory.summary_daily_minute
            ),
            summary_max_items: toWholeNumber(
                document.getElementById('opsAlertShopInventorySummaryMaxItems')?.value,
                currentConfig.shop_inventory.summary_max_items
            )
        },
        customer_chat_message: {
            ...currentConfig.customer_chat_message,
            enabled: document.getElementById('opsAlertCustomerChatMessageEnabledToggle')?.classList.contains('active')
                ?? currentConfig.customer_chat_message.enabled,
            sweep_interval_ms: Math.max(
                10000,
                toWholeNumber(
                    document.getElementById('opsAlertCustomerChatMessageSweepIntervalMinutes')?.value,
                    Math.max(1, Math.round(Number(currentConfig.customer_chat_message.sweep_interval_ms || 0) / 60000))
                ) * 60 * 1000
            ),
            lookback_minutes: toWholeNumber(
                document.getElementById('opsAlertCustomerChatMessageLookbackMinutes')?.value,
                currentConfig.customer_chat_message.lookback_minutes
            ),
            dedupe_window_minutes: toWholeNumber(
                document.getElementById('opsAlertCustomerChatMessageDedupeWindowMinutes')?.value,
                currentConfig.customer_chat_message.dedupe_window_minutes
            ),
            work_hours_only_enabled: document.getElementById('opsAlertCustomerChatMessageWorkHoursOnlyEnabledToggle')?.classList.contains('active')
                ?? currentConfig.customer_chat_message.work_hours_only_enabled,
            summary_enabled: document.getElementById('opsAlertCustomerChatMessageSummaryEnabledToggle')?.classList.contains('active')
                ?? currentConfig.customer_chat_message.summary_enabled,
            summary_window_minutes: toWholeNumber(
                document.getElementById('opsAlertCustomerChatMessageSummaryWindowMinutes')?.value,
                currentConfig.customer_chat_message.summary_window_minutes
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                document.getElementById('opsAlertCustomerChatMessageSummaryScheduleMode')?.value,
                currentConfig.customer_chat_message.summary_schedule_mode
            ),
            summary_hourly_minute: toWholeNumber(
                document.getElementById('opsAlertCustomerChatMessageSummaryHourlyMinute')?.value,
                currentConfig.customer_chat_message.summary_hourly_minute
            ),
            summary_daily_hour: toWholeNumber(
                document.getElementById('opsAlertCustomerChatMessageSummaryDailyHour')?.value,
                currentConfig.customer_chat_message.summary_daily_hour
            ),
            summary_daily_minute: toWholeNumber(
                document.getElementById('opsAlertCustomerChatMessageSummaryDailyMinute')?.value,
                currentConfig.customer_chat_message.summary_daily_minute
            ),
            summary_max_items: toWholeNumber(
                document.getElementById('opsAlertCustomerChatMessageSummaryMaxItems')?.value,
                currentConfig.customer_chat_message.summary_max_items
            )
        },
        shop_purchase_success: {
            ...currentConfig.shop_purchase_success,
            enabled: document.getElementById('opsAlertShopPurchaseSuccessEnabledToggle')?.classList.contains('active')
                ?? currentConfig.shop_purchase_success.enabled,
            sweep_interval_ms: Math.max(
                10000,
                toWholeNumber(
                    document.getElementById('opsAlertShopPurchaseSuccessSweepIntervalMinutes')?.value,
                    Math.max(1, Math.round(Number(currentConfig.shop_purchase_success.sweep_interval_ms || 0) / 60000))
                ) * 60 * 1000
            ),
            lookback_minutes: toWholeNumber(
                document.getElementById('opsAlertShopPurchaseSuccessLookbackMinutes')?.value,
                currentConfig.shop_purchase_success.lookback_minutes
            ),
            dedupe_window_minutes: toWholeNumber(
                document.getElementById('opsAlertShopPurchaseSuccessDedupeWindowMinutes')?.value,
                currentConfig.shop_purchase_success.dedupe_window_minutes
            ),
            work_hours_only_enabled: document.getElementById('opsAlertShopPurchaseSuccessWorkHoursOnlyEnabledToggle')?.classList.contains('active')
                ?? currentConfig.shop_purchase_success.work_hours_only_enabled,
            summary_enabled: document.getElementById('opsAlertShopPurchaseSuccessSummaryEnabledToggle')?.classList.contains('active')
                ?? currentConfig.shop_purchase_success.summary_enabled,
            summary_window_minutes: toWholeNumber(
                document.getElementById('opsAlertShopPurchaseSuccessSummaryWindowMinutes')?.value,
                currentConfig.shop_purchase_success.summary_window_minutes
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                document.getElementById('opsAlertShopPurchaseSuccessSummaryScheduleMode')?.value,
                currentConfig.shop_purchase_success.summary_schedule_mode
            ),
            summary_hourly_minute: toWholeNumber(
                document.getElementById('opsAlertShopPurchaseSuccessSummaryHourlyMinute')?.value,
                currentConfig.shop_purchase_success.summary_hourly_minute
            ),
            summary_daily_hour: toWholeNumber(
                document.getElementById('opsAlertShopPurchaseSuccessSummaryDailyHour')?.value,
                currentConfig.shop_purchase_success.summary_daily_hour
            ),
            summary_daily_minute: toWholeNumber(
                document.getElementById('opsAlertShopPurchaseSuccessSummaryDailyMinute')?.value,
                currentConfig.shop_purchase_success.summary_daily_minute
            ),
            summary_max_items: toWholeNumber(
                document.getElementById('opsAlertShopPurchaseSuccessSummaryMaxItems')?.value,
                currentConfig.shop_purchase_success.summary_max_items
            )
        },
        wallet_recharge_success: {
            ...currentConfig.wallet_recharge_success,
            enabled: document.getElementById('opsAlertWalletRechargeSuccessEnabledToggle')?.classList.contains('active')
                ?? currentConfig.wallet_recharge_success.enabled,
            sweep_interval_ms: Math.max(
                10000,
                toWholeNumber(
                    document.getElementById('opsAlertWalletRechargeSuccessSweepIntervalMinutes')?.value,
                    Math.max(1, Math.round(Number(currentConfig.wallet_recharge_success.sweep_interval_ms || 0) / 60000))
                ) * 60 * 1000
            ),
            lookback_minutes: toWholeNumber(
                document.getElementById('opsAlertWalletRechargeSuccessLookbackMinutes')?.value,
                currentConfig.wallet_recharge_success.lookback_minutes
            ),
            dedupe_window_minutes: toWholeNumber(
                document.getElementById('opsAlertWalletRechargeSuccessDedupeWindowMinutes')?.value,
                currentConfig.wallet_recharge_success.dedupe_window_minutes
            ),
            work_hours_only_enabled: document.getElementById('opsAlertWalletRechargeSuccessWorkHoursOnlyEnabledToggle')?.classList.contains('active')
                ?? currentConfig.wallet_recharge_success.work_hours_only_enabled,
            summary_enabled: document.getElementById('opsAlertWalletRechargeSuccessSummaryEnabledToggle')?.classList.contains('active')
                ?? currentConfig.wallet_recharge_success.summary_enabled,
            summary_window_minutes: toWholeNumber(
                document.getElementById('opsAlertWalletRechargeSuccessSummaryWindowMinutes')?.value,
                currentConfig.wallet_recharge_success.summary_window_minutes
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                document.getElementById('opsAlertWalletRechargeSuccessSummaryScheduleMode')?.value,
                currentConfig.wallet_recharge_success.summary_schedule_mode
            ),
            summary_hourly_minute: toWholeNumber(
                document.getElementById('opsAlertWalletRechargeSuccessSummaryHourlyMinute')?.value,
                currentConfig.wallet_recharge_success.summary_hourly_minute
            ),
            summary_daily_hour: toWholeNumber(
                document.getElementById('opsAlertWalletRechargeSuccessSummaryDailyHour')?.value,
                currentConfig.wallet_recharge_success.summary_daily_hour
            ),
            summary_daily_minute: toWholeNumber(
                document.getElementById('opsAlertWalletRechargeSuccessSummaryDailyMinute')?.value,
                currentConfig.wallet_recharge_success.summary_daily_minute
            ),
            summary_max_items: toWholeNumber(
                document.getElementById('opsAlertWalletRechargeSuccessSummaryMaxItems')?.value,
                currentConfig.wallet_recharge_success.summary_max_items
            )
        },
        tickets: {
            ...currentConfig.tickets,
            enabled: document.getElementById('opsAlertTicketsEnabledToggle')?.classList.contains('active')
                ?? currentConfig.tickets.enabled,
            sweep_interval_ms: Math.max(
                10000,
                toWholeNumber(
                    document.getElementById('opsAlertTicketsSweepIntervalMinutes')?.value,
                    Math.max(1, Math.round(Number(currentConfig.tickets.sweep_interval_ms || 0) / 60000))
                ) * 60 * 1000
            ),
            pending_overdue_minutes: toWholeNumber(
                document.getElementById('opsAlertTicketsPendingOverdueMinutes')?.value,
                currentConfig.tickets.pending_overdue_minutes
            ),
            critical_overdue_minutes: toWholeNumber(
                document.getElementById('opsAlertTicketsCriticalOverdueMinutes')?.value,
                currentConfig.tickets.critical_overdue_minutes
            ),
            state_lookback_minutes: toWholeNumber(
                document.getElementById('opsAlertTicketsStateLookbackMinutes')?.value,
                currentConfig.tickets.state_lookback_minutes
            ),
            dedupe_window_minutes: toWholeNumber(
                document.getElementById('opsAlertTicketsDedupeWindowMinutes')?.value,
                currentConfig.tickets.dedupe_window_minutes
            ),
            work_hours_only_enabled: document.getElementById('opsAlertTicketsWorkHoursOnlyEnabledToggle')?.classList.contains('active')
                ?? currentConfig.tickets.work_hours_only_enabled,
            summary_enabled: document.getElementById('opsAlertTicketsSummaryEnabledToggle')?.classList.contains('active')
                ?? currentConfig.tickets.summary_enabled,
            summary_window_minutes: toWholeNumber(
                document.getElementById('opsAlertTicketsSummaryWindowMinutes')?.value,
                currentConfig.tickets.summary_window_minutes
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                document.getElementById('opsAlertTicketsSummaryScheduleMode')?.value,
                currentConfig.tickets.summary_schedule_mode
            ),
            summary_hourly_minute: toWholeNumber(
                document.getElementById('opsAlertTicketsSummaryHourlyMinute')?.value,
                currentConfig.tickets.summary_hourly_minute
            ),
            summary_daily_hour: toWholeNumber(
                document.getElementById('opsAlertTicketsSummaryDailyHour')?.value,
                currentConfig.tickets.summary_daily_hour
            ),
            summary_daily_minute: toWholeNumber(
                document.getElementById('opsAlertTicketsSummaryDailyMinute')?.value,
                currentConfig.tickets.summary_daily_minute
            ),
            summary_max_items: toWholeNumber(
                document.getElementById('opsAlertTicketsSummaryMaxItems')?.value,
                currentConfig.tickets.summary_max_items
            )
        },
        shop_order_delivery: {
            ...currentConfig.shop_order_delivery,
            enabled: document.getElementById('opsAlertShopOrderDeliveryEnabledToggle')?.classList.contains('active')
                ?? currentConfig.shop_order_delivery.enabled,
            lookback_days: toWholeNumber(
                document.getElementById('opsAlertShopOrderDeliveryLookbackDays')?.value,
                currentConfig.shop_order_delivery.lookback_days
            ),
            state_lookback_minutes: toWholeNumber(
                document.getElementById('opsAlertShopOrderDeliveryStateLookbackMinutes')?.value,
                currentConfig.shop_order_delivery.state_lookback_minutes
            ),
            retry_waiting_min_attempts: toWholeNumber(
                document.getElementById('opsAlertShopOrderDeliveryRetryWaitingMinAttempts')?.value,
                currentConfig.shop_order_delivery.retry_waiting_min_attempts
            ),
            sweep_interval_ms: Math.max(
                10000,
                toWholeNumber(
                    document.getElementById('opsAlertShopOrderDeliverySweepIntervalMinutes')?.value,
                    Math.max(1, Math.round(Number(currentConfig.shop_order_delivery.sweep_interval_ms || 0) / 60000))
                ) * 60 * 1000
            ),
            dedupe_window_minutes: toWholeNumber(
                document.getElementById('opsAlertShopOrderDeliveryDedupeWindowMinutes')?.value,
                currentConfig.shop_order_delivery.dedupe_window_minutes
            ),
            incident_enabled: document.getElementById('opsAlertShopOrderDeliveryIncidentEnabledToggle')?.classList.contains('active')
                ?? currentConfig.shop_order_delivery.incident_enabled,
            incident_min_order_count: toWholeNumber(
                document.getElementById('opsAlertShopOrderDeliveryIncidentMinOrderCount')?.value,
                currentConfig.shop_order_delivery.incident_min_order_count
            ),
            incident_min_dead_letter_count: toWholeNumber(
                document.getElementById('opsAlertShopOrderDeliveryIncidentMinDeadLetterCount')?.value,
                currentConfig.shop_order_delivery.incident_min_dead_letter_count
            ),
            incident_min_distinct_users: toWholeNumber(
                document.getElementById('opsAlertShopOrderDeliveryIncidentMinDistinctUsers')?.value,
                currentConfig.shop_order_delivery.incident_min_distinct_users
            ),
            incident_dedupe_window_minutes: toWholeNumber(
                document.getElementById('opsAlertShopOrderDeliveryIncidentDedupeWindowMinutes')?.value,
                currentConfig.shop_order_delivery.incident_dedupe_window_minutes
            ),
            work_hours_only_enabled: document.getElementById('opsAlertShopOrderDeliveryWorkHoursOnlyEnabledToggle')?.classList.contains('active')
                ?? currentConfig.shop_order_delivery.work_hours_only_enabled,
            summary_enabled: document.getElementById('opsAlertShopOrderDeliverySummaryEnabledToggle')?.classList.contains('active')
                ?? currentConfig.shop_order_delivery.summary_enabled,
            summary_window_minutes: toWholeNumber(
                document.getElementById('opsAlertShopOrderDeliverySummaryWindowMinutes')?.value,
                currentConfig.shop_order_delivery.summary_window_minutes
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                document.getElementById('opsAlertShopOrderDeliverySummaryScheduleMode')?.value,
                currentConfig.shop_order_delivery.summary_schedule_mode
            ),
            summary_hourly_minute: toWholeNumber(
                document.getElementById('opsAlertShopOrderDeliverySummaryHourlyMinute')?.value,
                currentConfig.shop_order_delivery.summary_hourly_minute
            ),
            summary_daily_hour: toWholeNumber(
                document.getElementById('opsAlertShopOrderDeliverySummaryDailyHour')?.value,
                currentConfig.shop_order_delivery.summary_daily_hour
            ),
            summary_daily_minute: toWholeNumber(
                document.getElementById('opsAlertShopOrderDeliverySummaryDailyMinute')?.value,
                currentConfig.shop_order_delivery.summary_daily_minute
            ),
            summary_max_items: toWholeNumber(
                document.getElementById('opsAlertShopOrderDeliverySummaryMaxItems')?.value,
                currentConfig.shop_order_delivery.summary_max_items
            )
        },
        verify_quota: {
            ...currentConfig.verify_quota,
            enabled: document.getElementById('opsAlertVerifyQuotaEnabledToggle')?.classList.contains('active')
                ?? currentConfig.verify_quota.enabled,
            low_balance_threshold: toWholeNumber(
                document.getElementById('opsAlertVerifyQuotaLowBalanceThreshold')?.value,
                currentConfig.verify_quota.low_balance_threshold
            ),
            low_remaining_jobs_threshold: toWholeNumber(
                document.getElementById('opsAlertVerifyQuotaLowRemainingJobsThreshold')?.value,
                currentConfig.verify_quota.low_remaining_jobs_threshold
            ),
            critical_balance_threshold: toWholeNumber(
                document.getElementById('opsAlertVerifyQuotaCriticalBalanceThreshold')?.value,
                currentConfig.verify_quota.critical_balance_threshold
            ),
            critical_remaining_jobs_threshold: toWholeNumber(
                document.getElementById('opsAlertVerifyQuotaCriticalRemainingJobsThreshold')?.value,
                currentConfig.verify_quota.critical_remaining_jobs_threshold
            ),
            min_queue_buffer_jobs: toWholeNumber(
                document.getElementById('opsAlertVerifyQuotaMinQueueBufferJobs')?.value,
                currentConfig.verify_quota.min_queue_buffer_jobs
            ),
            sweep_interval_ms: Math.max(
                10000,
                toWholeNumber(
                    document.getElementById('opsAlertVerifyQuotaSweepIntervalMinutes')?.value,
                    Math.max(1, Math.round(Number(currentConfig.verify_quota.sweep_interval_ms || 0) / 60000))
                ) * 60 * 1000
            ),
            dedupe_window_minutes: toWholeNumber(
                document.getElementById('opsAlertVerifyQuotaDedupeWindowMinutes')?.value,
                currentConfig.verify_quota.dedupe_window_minutes
            ),
            work_hours_only_enabled: document.getElementById('opsAlertVerifyQuotaWorkHoursOnlyEnabledToggle')?.classList.contains('active')
                ?? currentConfig.verify_quota.work_hours_only_enabled,
            summary_enabled: document.getElementById('opsAlertVerifyQuotaSummaryEnabledToggle')?.classList.contains('active')
                ?? currentConfig.verify_quota.summary_enabled,
            summary_window_minutes: toWholeNumber(
                document.getElementById('opsAlertVerifyQuotaSummaryWindowMinutes')?.value,
                currentConfig.verify_quota.summary_window_minutes
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                document.getElementById('opsAlertVerifyQuotaSummaryScheduleMode')?.value,
                currentConfig.verify_quota.summary_schedule_mode
            ),
            summary_hourly_minute: toWholeNumber(
                document.getElementById('opsAlertVerifyQuotaSummaryHourlyMinute')?.value,
                currentConfig.verify_quota.summary_hourly_minute
            ),
            summary_daily_hour: toWholeNumber(
                document.getElementById('opsAlertVerifyQuotaSummaryDailyHour')?.value,
                currentConfig.verify_quota.summary_daily_hour
            ),
            summary_daily_minute: toWholeNumber(
                document.getElementById('opsAlertVerifyQuotaSummaryDailyMinute')?.value,
                currentConfig.verify_quota.summary_daily_minute
            ),
            summary_max_items: toWholeNumber(
                document.getElementById('opsAlertVerifyQuotaSummaryMaxItems')?.value,
                currentConfig.verify_quota.summary_max_items
            )
        },
        verify_queue: {
            ...currentConfig.verify_queue,
            enabled: document.getElementById('opsAlertVerifyQueueEnabledToggle')?.classList.contains('active')
                ?? currentConfig.verify_queue.enabled,
            recent_activity_lookback_hours: toWholeNumber(
                document.getElementById('opsAlertVerifyQueueRecentActivityLookbackHours')?.value,
                currentConfig.verify_queue.recent_activity_lookback_hours
            ),
            recent_failure_window_minutes: toWholeNumber(
                document.getElementById('opsAlertVerifyQueueRecentFailureWindowMinutes')?.value,
                currentConfig.verify_queue.recent_failure_window_minutes
            ),
            queue_size_threshold: toWholeNumber(
                document.getElementById('opsAlertVerifyQueueSizeThreshold')?.value,
                currentConfig.verify_queue.queue_size_threshold
            ),
            active_job_threshold: toWholeNumber(
                document.getElementById('opsAlertVerifyQueueActiveJobThreshold')?.value,
                currentConfig.verify_queue.active_job_threshold
            ),
            oldest_pending_minutes_threshold: toWholeNumber(
                document.getElementById('opsAlertVerifyQueueOldestPendingMinutesThreshold')?.value,
                currentConfig.verify_queue.oldest_pending_minutes_threshold
            ),
            recent_failure_threshold: toWholeNumber(
                document.getElementById('opsAlertVerifyQueueRecentFailureThreshold')?.value,
                currentConfig.verify_queue.recent_failure_threshold
            ),
            sweep_interval_ms: Math.max(
                10000,
                toWholeNumber(
                    document.getElementById('opsAlertVerifyQueueSweepIntervalMinutes')?.value,
                    Math.max(1, Math.round(Number(currentConfig.verify_queue.sweep_interval_ms || 0) / 60000))
                ) * 60 * 1000
            ),
            dedupe_window_minutes: toWholeNumber(
                document.getElementById('opsAlertVerifyQueueDedupeWindowMinutes')?.value,
                currentConfig.verify_queue.dedupe_window_minutes
            ),
            work_hours_only_enabled: document.getElementById('opsAlertVerifyQueueWorkHoursOnlyEnabledToggle')?.classList.contains('active')
                ?? currentConfig.verify_queue.work_hours_only_enabled,
            summary_enabled: document.getElementById('opsAlertVerifyQueueSummaryEnabledToggle')?.classList.contains('active')
                ?? currentConfig.verify_queue.summary_enabled,
            summary_window_minutes: toWholeNumber(
                document.getElementById('opsAlertVerifyQueueSummaryWindowMinutes')?.value,
                currentConfig.verify_queue.summary_window_minutes
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                document.getElementById('opsAlertVerifyQueueSummaryScheduleMode')?.value,
                currentConfig.verify_queue.summary_schedule_mode
            ),
            summary_hourly_minute: toWholeNumber(
                document.getElementById('opsAlertVerifyQueueSummaryHourlyMinute')?.value,
                currentConfig.verify_queue.summary_hourly_minute
            ),
            summary_daily_hour: toWholeNumber(
                document.getElementById('opsAlertVerifyQueueSummaryDailyHour')?.value,
                currentConfig.verify_queue.summary_daily_hour
            ),
            summary_daily_minute: toWholeNumber(
                document.getElementById('opsAlertVerifyQueueSummaryDailyMinute')?.value,
                currentConfig.verify_queue.summary_daily_minute
            ),
            summary_max_items: toWholeNumber(
                document.getElementById('opsAlertVerifyQueueSummaryMaxItems')?.value,
                currentConfig.verify_queue.summary_max_items
            )
        },
        verify_failure: {
            ...currentConfig.verify_failure,
            enabled: document.getElementById('opsAlertVerifyFailureEnabledToggle')?.classList.contains('active')
                ?? currentConfig.verify_failure.enabled,
            recent_window_minutes: toWholeNumber(
                document.getElementById('opsAlertVerifyFailureRecentWindowMinutes')?.value,
                currentConfig.verify_failure.recent_window_minutes
            ),
            min_total_jobs_threshold: toWholeNumber(
                document.getElementById('opsAlertVerifyFailureMinTotalJobsThreshold')?.value,
                currentConfig.verify_failure.min_total_jobs_threshold
            ),
            failure_rate_threshold: toWholeNumber(
                document.getElementById('opsAlertVerifyFailureRateThreshold')?.value,
                currentConfig.verify_failure.failure_rate_threshold
            ),
            affected_user_threshold: toWholeNumber(
                document.getElementById('opsAlertVerifyFailureAffectedUserThreshold')?.value,
                currentConfig.verify_failure.affected_user_threshold
            ),
            sweep_interval_ms: Math.max(
                10000,
                toWholeNumber(
                    document.getElementById('opsAlertVerifyFailureSweepIntervalMinutes')?.value,
                    Math.max(1, Math.round(Number(currentConfig.verify_failure.sweep_interval_ms || 0) / 60000))
                ) * 60 * 1000
            ),
            dedupe_window_minutes: toWholeNumber(
                document.getElementById('opsAlertVerifyFailureDedupeWindowMinutes')?.value,
                currentConfig.verify_failure.dedupe_window_minutes
            ),
            work_hours_only_enabled: document.getElementById('opsAlertVerifyFailureWorkHoursOnlyEnabledToggle')?.classList.contains('active')
                ?? currentConfig.verify_failure.work_hours_only_enabled,
            summary_enabled: document.getElementById('opsAlertVerifyFailureSummaryEnabledToggle')?.classList.contains('active')
                ?? currentConfig.verify_failure.summary_enabled,
            summary_window_minutes: toWholeNumber(
                document.getElementById('opsAlertVerifyFailureSummaryWindowMinutes')?.value,
                currentConfig.verify_failure.summary_window_minutes
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                document.getElementById('opsAlertVerifyFailureSummaryScheduleMode')?.value,
                currentConfig.verify_failure.summary_schedule_mode
            ),
            summary_hourly_minute: toWholeNumber(
                document.getElementById('opsAlertVerifyFailureSummaryHourlyMinute')?.value,
                currentConfig.verify_failure.summary_hourly_minute
            ),
            summary_daily_hour: toWholeNumber(
                document.getElementById('opsAlertVerifyFailureSummaryDailyHour')?.value,
                currentConfig.verify_failure.summary_daily_hour
            ),
            summary_daily_minute: toWholeNumber(
                document.getElementById('opsAlertVerifyFailureSummaryDailyMinute')?.value,
                currentConfig.verify_failure.summary_daily_minute
            ),
            summary_max_items: toWholeNumber(
                document.getElementById('opsAlertVerifyFailureSummaryMaxItems')?.value,
                currentConfig.verify_failure.summary_max_items
            )
        },
        payment_gateway: {
            ...currentConfig.payment_gateway,
            enabled: document.getElementById('opsAlertPaymentGatewayEnabledToggle')?.classList.contains('active')
                ?? currentConfig.payment_gateway.enabled,
            window_minutes: toWholeNumber(
                document.getElementById('opsAlertPaymentGatewayWindowMinutes')?.value,
                currentConfig.payment_gateway.window_minutes
            ),
            min_failed_orders: toWholeNumber(
                document.getElementById('opsAlertPaymentGatewayFailedOrdersThreshold')?.value,
                currentConfig.payment_gateway.min_failed_orders
            ),
            min_failed_ratio_percent: toWholeNumber(
                document.getElementById('opsAlertPaymentGatewayFailedRatioThreshold')?.value,
                currentConfig.payment_gateway.min_failed_ratio_percent
            ),
            max_webhook_success_rate_percent: toWholeNumber(
                document.getElementById('opsAlertPaymentGatewayWebhookSuccessRateThreshold')?.value,
                currentConfig.payment_gateway.max_webhook_success_rate_percent
            ),
            max_query_success_rate_percent: toWholeNumber(
                document.getElementById('opsAlertPaymentGatewayQuerySuccessRateThreshold')?.value,
                currentConfig.payment_gateway.max_query_success_rate_percent
            ),
            min_webhook_5xx_count: toWholeNumber(
                document.getElementById('opsAlertPaymentGatewayWebhook5xxThreshold')?.value,
                currentConfig.payment_gateway.min_webhook_5xx_count
            ),
            min_query_5xx_count: toWholeNumber(
                document.getElementById('opsAlertPaymentGatewayQuery5xxThreshold')?.value,
                currentConfig.payment_gateway.min_query_5xx_count
            ),
            sweep_interval_ms: Math.max(
                10000,
                toWholeNumber(
                    document.getElementById('opsAlertPaymentGatewaySweepIntervalMinutes')?.value,
                    Math.max(1, Math.round(Number(currentConfig.payment_gateway.sweep_interval_ms || 0) / 60000))
                ) * 60 * 1000
            ),
            dedupe_window_minutes: toWholeNumber(
                document.getElementById('opsAlertPaymentGatewayDedupeWindowMinutes')?.value,
                currentConfig.payment_gateway.dedupe_window_minutes
            ),
            work_hours_only_enabled: document.getElementById('opsAlertPaymentGatewayWorkHoursOnlyEnabledToggle')?.classList.contains('active')
                ?? currentConfig.payment_gateway.work_hours_only_enabled,
            summary_enabled: document.getElementById('opsAlertPaymentGatewaySummaryEnabledToggle')?.classList.contains('active')
                ?? currentConfig.payment_gateway.summary_enabled,
            summary_window_minutes: toWholeNumber(
                document.getElementById('opsAlertPaymentGatewaySummaryWindowMinutes')?.value,
                currentConfig.payment_gateway.summary_window_minutes
            ),
            summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
                document.getElementById('opsAlertPaymentGatewaySummaryScheduleMode')?.value,
                currentConfig.payment_gateway.summary_schedule_mode
            ),
            summary_hourly_minute: toWholeNumber(
                document.getElementById('opsAlertPaymentGatewaySummaryHourlyMinute')?.value,
                currentConfig.payment_gateway.summary_hourly_minute
            ),
            summary_daily_hour: toWholeNumber(
                document.getElementById('opsAlertPaymentGatewaySummaryDailyHour')?.value,
                currentConfig.payment_gateway.summary_daily_hour
            ),
            summary_daily_minute: toWholeNumber(
                document.getElementById('opsAlertPaymentGatewaySummaryDailyMinute')?.value,
                currentConfig.payment_gateway.summary_daily_minute
            ),
            summary_max_items: toWholeNumber(
                document.getElementById('opsAlertPaymentGatewaySummaryMaxItems')?.value,
                currentConfig.payment_gateway.summary_max_items
            )
        }
    };
}

function resolveOpsAlertOperationalThresholdDrafts(currentConfig = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    return resolveOpsAlertSharedCallable(
        'collectAdminWorkbenchOpsAlertOperationalThresholdDrafts',
        buildLocalOpsAlertOperationalThresholdDrafts,
        () => ({
            document,
            toWholeNumber,
            normalizeOpsAlertSummaryScheduleMode
        })
    )(currentConfig);
}

function collectOpsAlertConfigFromForm() {
    const currentConfig = normalizeOpsAlertConfig(systemConfigCache['ops_alerts']);
    const nextConfig = resolveOpsAlertConfigDraft(currentConfig);
    const strategyDraft = resolveOpsAlertStrategyDraft(currentConfig);
    nextConfig.enabled = strategyDraft.enabled;
    nextConfig.temporary_mute = strategyDraft.temporary_mute;
    nextConfig.quiet_hours = strategyDraft.quiet_hours;
    nextConfig.work_hours = strategyDraft.work_hours;
    nextConfig.mute_rules = strategyDraft.mute_rules;
    nextConfig.channels = strategyDraft.channels;
    nextConfig.routing = strategyDraft.routing;
    const operationalThresholdDrafts = resolveOpsAlertOperationalThresholdDrafts(currentConfig);
    nextConfig.shop_order_risk = operationalThresholdDrafts.shop_order_risk;
    nextConfig.shop_inventory = operationalThresholdDrafts.shop_inventory;
    nextConfig.customer_chat_message = {
        ...operationalThresholdDrafts.customer_chat_message,
        quick_reply_templates: nextConfig.customer_chat_message.quick_reply_templates
    };
    nextConfig.customer_chat_message.quick_reply_templates = collectOpsAlertCustomerChatQuickReplyTemplatesFromForm();
    nextConfig.shop_purchase_success = operationalThresholdDrafts.shop_purchase_success;
    nextConfig.wallet_recharge_success = operationalThresholdDrafts.wallet_recharge_success;
    nextConfig.tickets = operationalThresholdDrafts.tickets;
    nextConfig.shop_order_delivery = operationalThresholdDrafts.shop_order_delivery;
    nextConfig.verify_quota = operationalThresholdDrafts.verify_quota;
    nextConfig.verify_queue = operationalThresholdDrafts.verify_queue;
    nextConfig.verify_failure = operationalThresholdDrafts.verify_failure;
    nextConfig.payment_gateway = operationalThresholdDrafts.payment_gateway;

    return normalizeOpsAlertConfig(nextConfig);
}

function buildLocalOpsAlertSecretInputs() {
    return {
        telegram_bot_token: document.getElementById('opsAlertTelegramBotToken')?.value?.trim() || '',
        feishu_webhook_url: document.getElementById('opsAlertFeishuWebhookUrl')?.value?.trim() || '',
        email_api_key: document.getElementById('opsAlertEmailApiKey')?.value?.trim() || ''
    };
}

function resolveOpsAlertSecretInputs() {
    return resolveOpsAlertSharedCallable(
        'readAdminWorkbenchOpsAlertSecretInputs',
        buildLocalOpsAlertSecretInputs
    )();
}

function buildLocalOpsAlertSecretInputsClearer() {
    return () => {
        [
            'opsAlertTelegramBotToken',
            'opsAlertFeishuWebhookUrl',
            'opsAlertEmailApiKey'
        ].forEach((id) => {
            const input = document.getElementById(id);
            if (input) input.value = '';
        });
    };
}

function resolveOpsAlertSecretInputsClearer() {
    return resolveOpsAlertSharedCallable(
        'clearAdminWorkbenchOpsAlertSecretInputs',
        buildLocalOpsAlertSecretInputsClearer()
    );
}

function clearOpsAlertSecretInputs() {
    resolveOpsAlertSecretInputsClearer()();
}

function buildLocalOpsAlertSettingsRequestBody(config, options = {}) {
    const body = {
        config,
        secrets: options.secrets && typeof options.secrets === 'object' && !Array.isArray(options.secrets)
            ? options.secrets
            : resolveOpsAlertSecretInputs()
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

function resolveOpsAlertSettingsRequestBody(config, options = {}) {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertSettingsRequestBody',
        buildLocalOpsAlertSettingsRequestBody
    )(config, options);
}

function buildOpsAlertSettingsRequestBody(config, options = {}) {
    return resolveOpsAlertSettingsRequestBody(config, options);
}

function buildLocalOpsAlertDispatchConfigValidation(config = {}, secretStatus = {}, secrets = {}) {
    const normalizedConfig = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
    const normalizedSecrets = secrets && typeof secrets === 'object' && !Array.isArray(secrets)
        ? secrets
        : {};
    const normalizedSecretStatus = secretStatus && typeof secretStatus === 'object' && !Array.isArray(secretStatus)
        ? secretStatus
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
        throw new Error('请先启用至少一个站外告警通道');
    }

    if (telegramEnabled) {
        if (!chatIds.length) {
            throw new Error('已启用 Telegram 告警，请先填写至少一个 Telegram Chat ID');
        }

        if (!providedTelegramToken && !hasStoredTelegramToken) {
            throw new Error('已启用 Telegram 告警，请先填写 Telegram Bot Token，或先保存已配置的后台密钥');
        }
    }

    if (feishuEnabled && !providedFeishuWebhook && !hasStoredFeishuWebhook) {
        throw new Error('已启用飞书告警，请先填写飞书 Webhook，或先保存已配置的后台密钥');
    }

    if (emailEnabled) {
        if (!recipients.length) {
            throw new Error('已启用邮件告警，请先填写至少一个收件人');
        }
        if (!normalizedConfig.channels?.email?.from_address) {
            throw new Error('已启用邮件告警，请先填写发件地址');
        }
        if (!providedEmailApiKey && !hasStoredEmailApiKey) {
            throw new Error('已启用邮件告警，请先填写 Email API Key，或先保存已配置的后台密钥');
        }
    }

    return normalizedSecrets;
}

function resolveOpsAlertDispatchConfigValidation(config = {}, secretStatus = {}, secrets = {}) {
    return resolveOpsAlertSharedCallable(
        'validateAdminWorkbenchOpsAlertDispatchConfig',
        buildLocalOpsAlertDispatchConfigValidation
    )(config, secretStatus, secrets);
}

async function submitLocalOpsAlertSettingsPayload(headers = {}, body = {}, options = {}) {
    const response = await fetch('/api/admin/settings/ops-alerts', {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
        throw new Error(payload.message || options.errorMessage || '保存站外告警配置失败');
    }
    return payload;
}

function resolveOpsAlertSettingsSubmitter(options = {}) {
    return resolveOpsAlertSharedCallable(
        'submitAdminWorkbenchOpsAlertSettings',
        (headers = {}, body = {}) => submitLocalOpsAlertSettingsPayload(headers, body, options),
        (headers = {}, body = {}) => ({
            errorMessage: options.errorMessage || '保存站外告警配置失败'
        })
    );
}

async function submitOpsAlertSettingsPayload(headers = {}, body = {}, options = {}) {
    return resolveOpsAlertSettingsSubmitter(options)(headers, body);
}

async function submitLocalOpsAlertSecretDeletion(headers = {}, secretName = '', options = {}) {
    const response = await fetch('/api/admin/settings/ops-alerts', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ secretName })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
        throw new Error(payload.message || options.errorMessage || '删除站外告警密钥失败');
    }
    return payload;
}

function resolveOpsAlertSecretDeletionSubmitter(options = {}) {
    return resolveOpsAlertSharedCallable(
        'deleteAdminWorkbenchOpsAlertSecret',
        (headers = {}, secretName = '') => submitLocalOpsAlertSecretDeletion(headers, secretName, options),
        (headers = {}, secretName = '') => ({
            errorMessage: options.errorMessage || '删除站外告警密钥失败'
        })
    );
}

async function submitOpsAlertSecretDeletion(headers = {}, secretName = '', options = {}) {
    return resolveOpsAlertSecretDeletionSubmitter(options)(headers, secretName);
}

function buildLocalOpsAlertSecretDeletionSubmissionContext(secretName = '', secretStatus = opsAlertSecretStatus || getDefaultOpsAlertSecretStatus()) {
    const deletionState = buildLocalOpsAlertSecretDeletionState(secretName, secretStatus);
    return {
        ...deletionState,
        canDelete: deletionState.isValid && !deletionState.isEnvironmentManaged
    };
}

function resolveOpsAlertSettingsSubmissionState(config, options = {}) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    return {
        config: normalizedConfig,
        body: buildOpsAlertSettingsRequestBody(normalizedConfig, options),
        successMessage: options.successMessage || '',
        errorMessage: options.errorMessage || '保存站外告警配置失败'
    };
}

function buildLocalOpsAlertSettingsSavedState(payload = {}, submissionState = {}) {
    const normalizedPayload = resolveOpsAlertSettingsPayload(payload);
    return {
        config: normalizedPayload.config,
        secrets: normalizedPayload.secrets,
        toastMessage: submissionState.successMessage
            || payload.message
            || '站外退款告警配置已保存'
    };
}

function applyOpsAlertSettingsSavedState(savedState = {}) {
    const normalizedConfig = normalizeOpsAlertConfig(savedState.config);
    systemConfigCache['ops_alerts'] = normalizedConfig;
    opsAlertSecretStatus = savedState.secrets || getDefaultOpsAlertSecretStatus();
    window.dispatchEvent(new CustomEvent('ops-alerts-config-updated', {
        detail: {
            config: normalizedConfig
        }
    }));
    renderOpsAlertSettings();
    clearOpsAlertSecretInputs();
    showConfigSavedToast(savedState.toastMessage || '站外退款告警配置已保存');
    return savedState;
}

function applyOpsAlertSettingsSavedPayload(payload = {}, submissionState = {}) {
    return applyOpsAlertSettingsSavedState(buildLocalOpsAlertSettingsSavedState(payload, submissionState));
}

function handleOpsAlertSettingsSaveError(error) {
    console.error('[Config] Save ops alert settings failed:', error);
    showToast('保存失败: ' + (error.message || '未知错误'), 'error');
    renderOpsAlertSettings();
    return false;
}

function buildLocalOpsAlertActionFeedbackState(payload = {}, options = {}) {
    return {
        message: options.successMessage || payload.message || ''
    };
}

function applyOpsAlertActionFeedback(payload = {}, options = {}) {
    const feedbackState = buildLocalOpsAlertActionFeedbackState(payload, options);
    showConfigSavedToast(feedbackState.message);
}

async function saveOpsAlertConfigOverride(config, options = {}) {
    setOpsAlertStrategySaveBusy(true);
    try {
        const headers = await getAdminConfigApiHeaders();
        const submissionState = resolveOpsAlertSettingsSubmissionState(config, {
            ...options,
            errorMessage: '保存站外告警配置失败'
        });
        const payload = await submitOpsAlertSettingsPayload(headers, submissionState.body, {
            errorMessage: submissionState.errorMessage
        });
        applyOpsAlertSettingsSavedPayload(payload, submissionState);
        return true;
    } catch (error) {
        return handleOpsAlertSettingsSaveError(error);
    } finally {
        setOpsAlertStrategySaveBusy(false);
    }
}

async function saveOpsAlertSettings() {
    if (!validateOpsAlertCustomerChatQuickReplyTemplatesBeforeSave()) {
        return false;
    }
    return saveOpsAlertConfigOverride(collectOpsAlertConfigFromForm());
}

async function sendOpsAlertTelegramRequest(action, fallbackMessage) {
    const config = collectOpsAlertConfigFromForm();
    const secrets = resolveOpsAlertSecretInputs();
    resolveOpsAlertDispatchConfigValidation(config, opsAlertSecretStatus, secrets);

    const headers = await getAdminConfigApiHeaders();
    const submissionState = resolveOpsAlertSettingsSubmissionState(config, {
        action,
        secrets,
        successMessage: fallbackMessage,
        errorMessage: fallbackMessage
    });
    const payload = await submitOpsAlertSettingsPayload(headers, submissionState.body, {
        errorMessage: submissionState.errorMessage
    });

    applyOpsAlertActionFeedback(payload, submissionState);
    return true;
}

function buildLocalOpsAlertRefreshFeedbackState(result = null, options = {}) {
    const success = result?.success === true;
    return {
        success,
        successMessage: options.successMessage || '已刷新',
        errorMessage: options.errorMessage || '刷新失败: 请稍后重试'
    };
}

function applyOpsAlertRefreshFeedback(feedbackState = {}) {
    if (feedbackState.success) {
        showConfigSavedToast(feedbackState.successMessage || '已刷新');
        return true;
    }
    showToast(feedbackState.errorMessage || '刷新失败: 请稍后重试', 'error');
    return false;
}

const OPS_ALERT_SAMPLE_REQUESTS = Object.freeze({
    telegramTest: {
        action: 'send_test_telegram',
        successMessage: '测试站外告警已发送',
        errorContext: 'Send ops alert test failed'
    },
    refundSample: {
        action: 'send_sample_refund_telegram',
        successMessage: '退款详情示例消息已发送',
        errorContext: 'Send Telegram refund sample failed'
    },
    customerChatMessageSample: {
        action: 'send_sample_customer_chat_message',
        successMessage: '客服消息示例已发送',
        errorContext: 'Send customer chat message sample failed'
    },
    shopPurchaseSucceededSample: {
        action: 'send_sample_shop_purchase_succeeded',
        successMessage: '购买成功示例消息已发送',
        errorContext: 'Send shop purchase succeeded sample failed'
    },
    walletRechargeSucceededSample: {
        action: 'send_sample_wallet_recharge_succeeded',
        successMessage: '充值成功示例消息已发送',
        errorContext: 'Send wallet recharge succeeded sample failed'
    },
    gatewaySample: {
        action: 'send_sample_gateway_degraded',
        successMessage: '支付通道异常示例消息已发送',
        errorContext: 'Send payment gateway degraded sample failed'
    },
    gatewayRecoveredSample: {
        action: 'send_sample_gateway_recovered',
        successMessage: '支付通道恢复示例消息已发送',
        errorContext: 'Send payment gateway recovery sample failed'
    },
    verifyServiceDisabledSample: {
        action: 'send_sample_verify_service_disabled',
        successMessage: '验证服务停摆示例消息已发送',
        errorContext: 'Send verify service disabled sample failed'
    },
    verifyQueueBacklogSample: {
        action: 'send_sample_verify_queue_backlog',
        successMessage: '验证任务堆积示例消息已发送',
        errorContext: 'Send verify queue backlog sample failed'
    },
    verifyFailureRateSpikeSample: {
        action: 'send_sample_verify_failure_rate_spike',
        successMessage: '验证失败率异常示例消息已发送',
        errorContext: 'Send verify failure rate spike sample failed'
    },
    verifyIncidentEscalatedSample: {
        action: 'send_sample_verify_incident_escalated',
        successMessage: '验证综合异常示例消息已发送',
        errorContext: 'Send verify incident escalation sample failed'
    },
    verifyIncidentRecoveredSample: {
        action: 'send_sample_verify_incident_recovered',
        successMessage: '验证恢复示例消息已发送',
        errorContext: 'Send verify incident recovered sample failed'
    },
    verifyQuotaSample: {
        action: 'send_sample_verify_quota_low',
        successMessage: '验证额度告警示例消息已发送',
        errorContext: 'Send verify quota sample failed'
    },
    ticketSlaSample: {
        action: 'send_sample_ticket_sla_overdue',
        successMessage: '工单超时示例消息已发送',
        errorContext: 'Send ticket SLA sample failed'
    },
    ticketSlaRecoveredSample: {
        action: 'send_sample_ticket_sla_recovered',
        successMessage: '工单恢复示例消息已发送',
        errorContext: 'Send ticket SLA recovery sample failed'
    },
    shopInventorySample: {
        action: 'send_sample_shop_inventory_low',
        successMessage: '库存预警示例消息已发送',
        errorContext: 'Send shop inventory sample failed'
    },
    shopInventoryRecoveredSample: {
        action: 'send_sample_shop_inventory_recovered',
        successMessage: '库存恢复示例消息已发送',
        errorContext: 'Send shop inventory recovery sample failed'
    },
    adminLoginAnomalySample: {
        action: 'send_sample_admin_login_anomaly',
        successMessage: '管理员异常登录示例消息已发送',
        errorContext: 'Send admin login anomaly sample failed'
    },
    shopOrderDeliveryFailedSample: {
        action: 'send_sample_shop_order_delivery_failed',
        successMessage: '履约失败示例消息已发送',
        errorContext: 'Send shop order delivery failed sample failed'
    },
    shopOrderDeliveryIncidentSample: {
        action: 'send_sample_shop_order_delivery_incident',
        successMessage: '履约异常升级示例消息已发送',
        errorContext: 'Send shop order delivery incident sample failed'
    },
    shopOrderDeliveryIncidentRecoveredSample: {
        action: 'send_sample_shop_order_delivery_incident_recovered',
        successMessage: '履约事故恢复示例消息已发送',
        errorContext: 'Send shop order delivery incident recovery sample failed'
    },
    shopOrderDeliveryRecoveredSample: {
        action: 'send_sample_shop_order_delivery_recovered',
        successMessage: '履约恢复示例消息已发送',
        errorContext: 'Send shop order delivery recovered sample failed'
    },
    paymentConfigChangedSample: {
        action: 'send_sample_payment_config_changed',
        successMessage: '支付配置变更示例消息已发送',
        errorContext: 'Send payment config changed sample failed'
    },
    paymentConfigIncidentSample: {
        action: 'send_sample_payment_config_incident',
        successMessage: '支付配置异常升级示例消息已发送',
        errorContext: 'Send payment config incident sample failed'
    },
    paymentConfigIncidentRecoveredSample: {
        action: 'send_sample_payment_config_incident_recovered',
        successMessage: '支付配置事故恢复示例消息已发送',
        errorContext: 'Send payment config incident recovered sample failed'
    },
    paymentConfigRecoveredSample: {
        action: 'send_sample_payment_config_recovered',
        successMessage: '支付配置恢复示例消息已发送',
        errorContext: 'Send payment config recovered sample failed'
    }
});

async function executeOpsAlertDispatchSample(sampleKey = '') {
    const definition = OPS_ALERT_SAMPLE_REQUESTS[String(sampleKey || '').trim()] || null;
    if (!definition) {
        showToast('未识别的站外告警示例动作', 'warning');
        return false;
    }

    try {
        return await sendOpsAlertTelegramRequest(definition.action, definition.successMessage);
    } catch (error) {
        console.error(`[Config] ${definition.errorContext}:`, error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

function createOpsAlertDispatchSampleHandler(sampleKey) {
    return async function opsAlertDispatchSampleHandler() {
        return executeOpsAlertDispatchSample(sampleKey);
    };
}

const sendOpsAlertTelegramTest = createOpsAlertDispatchSampleHandler('telegramTest');
const sendOpsAlertRefundSample = createOpsAlertDispatchSampleHandler('refundSample');
const sendOpsAlertCustomerChatMessageSample = createOpsAlertDispatchSampleHandler('customerChatMessageSample');
const sendOpsAlertShopPurchaseSucceededSample = createOpsAlertDispatchSampleHandler('shopPurchaseSucceededSample');
const sendOpsAlertWalletRechargeSucceededSample = createOpsAlertDispatchSampleHandler('walletRechargeSucceededSample');
const sendOpsAlertGatewaySample = createOpsAlertDispatchSampleHandler('gatewaySample');
const sendOpsAlertGatewayRecoveredSample = createOpsAlertDispatchSampleHandler('gatewayRecoveredSample');
const sendOpsAlertVerifyServiceDisabledSample = createOpsAlertDispatchSampleHandler('verifyServiceDisabledSample');
const sendOpsAlertVerifyQueueBacklogSample = createOpsAlertDispatchSampleHandler('verifyQueueBacklogSample');
const sendOpsAlertVerifyFailureRateSpikeSample = createOpsAlertDispatchSampleHandler('verifyFailureRateSpikeSample');
const sendOpsAlertVerifyIncidentEscalatedSample = createOpsAlertDispatchSampleHandler('verifyIncidentEscalatedSample');
const sendOpsAlertVerifyIncidentRecoveredSample = createOpsAlertDispatchSampleHandler('verifyIncidentRecoveredSample');
const sendOpsAlertVerifyQuotaSample = createOpsAlertDispatchSampleHandler('verifyQuotaSample');
const sendOpsAlertTicketSlaSample = createOpsAlertDispatchSampleHandler('ticketSlaSample');
const sendOpsAlertTicketSlaRecoveredSample = createOpsAlertDispatchSampleHandler('ticketSlaRecoveredSample');
const sendOpsAlertShopInventorySample = createOpsAlertDispatchSampleHandler('shopInventorySample');
const sendOpsAlertShopInventoryRecoveredSample = createOpsAlertDispatchSampleHandler('shopInventoryRecoveredSample');
const sendOpsAlertAdminLoginAnomalySample = createOpsAlertDispatchSampleHandler('adminLoginAnomalySample');
const sendOpsAlertShopOrderDeliveryFailedSample = createOpsAlertDispatchSampleHandler('shopOrderDeliveryFailedSample');
const sendOpsAlertShopOrderDeliveryIncidentSample = createOpsAlertDispatchSampleHandler('shopOrderDeliveryIncidentSample');
const sendOpsAlertShopOrderDeliveryIncidentRecoveredSample = createOpsAlertDispatchSampleHandler('shopOrderDeliveryIncidentRecoveredSample');
const sendOpsAlertShopOrderDeliveryRecoveredSample = createOpsAlertDispatchSampleHandler('shopOrderDeliveryRecoveredSample');
const sendOpsAlertPaymentConfigChangedSample = createOpsAlertDispatchSampleHandler('paymentConfigChangedSample');
const sendOpsAlertPaymentConfigIncidentSample = createOpsAlertDispatchSampleHandler('paymentConfigIncidentSample');
const sendOpsAlertPaymentConfigIncidentRecoveredSample = createOpsAlertDispatchSampleHandler('paymentConfigIncidentRecoveredSample');
const sendOpsAlertPaymentConfigRecoveredSample = createOpsAlertDispatchSampleHandler('paymentConfigRecoveredSample');

async function refreshOpsAlertWorkspacePanel(loader, successMessage) {
    const result = await loader(true);
    return applyOpsAlertRefreshFeedback(buildLocalOpsAlertRefreshFeedbackState(result, {
        successMessage
    }));
}

async function refreshOpsAlertHealthPanel() {
    return refreshOpsAlertWorkspacePanel(loadOpsAlertHealth, '告警通道健康页已刷新');
}

async function refreshOpsAlertMonitorPanel() {
    return refreshOpsAlertWorkspacePanel(loadOpsAlertMonitor, '集中告警处理面板已刷新');
}

function waitForOpsAlertWorkspacePaint() {
    return new Promise((resolve) => {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(resolve);
        });
    });
}

async function settleOpsAlertWorkspace(delayMs = 60) {
    await waitForOpsAlertWorkspacePaint();
    if (delayMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
}

function buildLocalOpsAlertsViewSwitcher(viewName = '') {
    const normalizedViewName = String(viewName || '').trim();
    if (!normalizedViewName) {
        return false;
    }

    const opsAlertsModule = document.getElementById('module-ops-alerts');
    if (!opsAlertsModule) {
        return false;
    }

    opsAlertsModule.querySelectorAll('.admin-tab[data-ops-alerts-view]').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.opsAlertsView === normalizedViewName);
    });

    opsAlertsModule.querySelectorAll('.view-section').forEach((section) => {
        section.classList.toggle('active', section.id === `ops-alerts-view-${normalizedViewName}`);
    });

    return true;
}

function resolveOpsAlertsViewSwitcher() {
    return resolveOpsAlertSharedCallable(
        'switchOpsAlertsView',
        buildLocalOpsAlertsViewSwitcher
    );
}

async function scrollToOpsAlertHealthPanel() {
    resolveOpsAlertsViewSwitcher()('health');
    await settleOpsAlertWorkspace(80);
    scrollToOpsAlertWorkspaceTarget('opsAlertHealthPanel');
}

function scrollToOpsAlertWorkspaceTarget(targetId) {
    const target = document.getElementById(String(targetId || '').trim());
    if (target && typeof target.scrollIntoView === 'function') {
        window.setTimeout(() => {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 40);
    }
}

function getOpsAlertCaseComposerTargetLabel(context = {}) {
    return resolveOpsAlertWorkspaceContextLabelResolver()(context, { fallback: '集中告警' });
}

function getOpsAlertCaseComposerBatchPreview(items = []) {
    return resolveOpsAlertWorkspaceBatchPreviewResolver()(items, {
        fallback: '告警',
        formatCount: formatVerifyMonitorInteger
    });
}

function buildLocalOpsAlertWorkspaceContextLabel(context = {}, options = {}) {
    const normalizedContext = normalizeOpsAlertWorkspaceContext(context);
    if (normalizedContext.referenceLabel && normalizedContext.referenceValue) {
        return `${normalizedContext.referenceLabel}：${normalizedContext.referenceValue}`;
    }
    return normalizedContext.title || normalizedContext.targetId || options.fallback || '集中告警';
}

function resolveOpsAlertWorkspaceContextLabelResolver() {
    return resolveOpsAlertSharedCallable(
        'getOpsAlertWorkspaceContextLabel',
        buildLocalOpsAlertWorkspaceContextLabel
    );
}

function buildLocalOpsAlertWorkspaceBatchPreview(items = [], options = {}) {
    const previewLabels = (Array.isArray(items) ? items : [])
        .slice(0, 3)
        .map((item) => {
            if (item.reference_label && item.reference_value) {
                return `${item.reference_label}：${item.reference_value}`;
            }
            return item.title || item.target_id || options.fallback || '告警';
        })
        .filter(Boolean);

    const overflowCount = Math.max(0, (Array.isArray(items) ? items.length : 0) - previewLabels.length);
    return `${previewLabels.join(' / ')}${overflowCount > 0 ? ` 等 ${formatVerifyMonitorInteger(overflowCount)} 条` : ''}`;
}

function resolveOpsAlertWorkspaceBatchPreviewResolver() {
    return resolveOpsAlertSharedCallable(
        'getOpsAlertWorkspaceBatchPreview',
        buildLocalOpsAlertWorkspaceBatchPreview
    );
}

function resolveOpsAlertWorkspaceActionResolver() {
    return resolveOpsAlertSharedCallable(
        'getOpsAlertWorkspaceAction',
        () => null
    );
}

function getDefaultOpsAlertCaseComposerOwner(state = {}) {
    const admins = getOpsAlertMonitorAssignableAdmins();
    const normalizedContext = normalizeOpsAlertWorkspaceContext(state.context || {});
    const preferredOwnerId = String(
        state.selectedOwnerAdminId
        || normalizedContext.caseOwnerAdminId
        || opsAlertMonitorState?.current_admin_id
        || ''
    ).trim();

    if (preferredOwnerId) {
        const matchedAdmin = admins.find((admin) => admin.id === preferredOwnerId);
        if (matchedAdmin) {
            return {
                id: matchedAdmin.id,
                label: matchedAdmin.label
            };
        }
    }

    const fallbackAdmin = admins.find((admin) => admin.isCurrent) || admins[0] || null;
    return {
        id: fallbackAdmin?.id || '',
        label: fallbackAdmin?.label || ''
    };
}

function getOpsAlertCaseComposerMeta(state = {}) {
    return resolveOpsAlertCaseComposerMetaResolver()(state, {
        formatCount: formatVerifyMonitorInteger,
        singleFallback: '集中告警',
        batchPreviewFallback: '告警'
    });
}

function buildLocalOpsAlertCaseComposerMeta(state = {}, options = {}) {
    const normalizedAction = String(state.action || '').trim().toLowerCase();
    const normalizedContext = normalizeOpsAlertWorkspaceContext(state.context || {});
    const items = Array.isArray(state.items) ? state.items : [];
    const isBatch = String(state.mode || 'single').trim().toLowerCase() === 'batch';
    const targetLabel = isBatch
        ? `当前筛选命中 ${formatVerifyMonitorInteger(items.length)} 条告警${items.length ? ` · ${resolveOpsAlertWorkspaceBatchPreviewResolver()(items, { fallback: options.batchPreviewFallback || '告警', formatCount: formatVerifyMonitorInteger })}` : ''}`
        : resolveOpsAlertWorkspaceContextLabelResolver()(normalizedContext, { fallback: options.singleFallback || '集中告警' });
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

function resolveOpsAlertCaseComposerMetaResolver() {
    return resolveOpsAlertSharedCallable(
        'getOpsAlertCaseComposerMeta',
        buildLocalOpsAlertCaseComposerMeta
    );
}

function setOpsAlertCaseComposerVisible(visible) {
    const modal = document.getElementById('shopRiskCaseComposerModal');
    if (!modal) return;
    modal.classList.toggle('is-visible', visible);
    modal.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function buildLocalOpsAlertCaseComposerViewState(state = shopRiskCaseComposerState || getDefaultShopRiskCaseComposerState()) {
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : getDefaultShopRiskCaseComposerState();
    const meta = getOpsAlertCaseComposerMeta(normalizedState);
    const isAssignAction = String(normalizedState.action || '').trim().toLowerCase() === 'assign';
    const ownerOptions = getOpsAlertMonitorAssignableAdmins();
    const selectedOwner = getDefaultOpsAlertCaseComposerOwner(normalizedState);

    return {
        open: normalizedState.open === true,
        submitting: normalizedState.submitting === true,
        title: meta.title,
        summary: meta.summary,
        description: meta.description,
        fieldLabel: meta.fieldLabel,
        placeholder: meta.placeholder,
        submitLabel: normalizedState.submitting ? '提交中...' : meta.submitLabel,
        isAssignAction,
        ownerOptionsMarkup: ownerOptions.length
            ? ownerOptions.map((admin) => `
                <option value="${escapeConfigHtml(admin.id)}">${escapeConfigHtml(admin.label)}${admin.email ? ` · ${escapeConfigHtml(admin.email)}` : ''}${admin.isCurrent ? '（我）' : ''}</option>
            `).join('')
            : '<option value="">暂无可选管理员</option>',
        selectedOwnerId: selectedOwner.id || '',
        ownerSelectDisabled: normalizedState.submitting === true || ownerOptions.length === 0,
        ownerHintText: isAssignAction
            ? (
                ownerOptions.length
                    ? '指派会写入统一处置事件，monitor 卡片会同步回显新的负责人。'
                    : '当前未加载到管理员列表，请先刷新集中告警处理面板。'
            )
            : '',
        submitDisabled: normalizedState.submitting === true || (isAssignAction && ownerOptions.length === 0),
        focusTarget: normalizedState.open === true && normalizedState.submitting !== true
            ? (isAssignAction ? 'owner' : 'textarea')
            : ''
    };
}

function applyOpsAlertCaseComposerViewState(viewState = {}, elements = {}) {
    const {
        titleEl,
        summaryEl,
        descEl,
        ownerFieldEl,
        ownerSelectEl,
        ownerHintEl,
        labelEl,
        textareaEl,
        submitBtn
    } = elements;

    titleEl.textContent = viewState.title || '';
    summaryEl.textContent = viewState.summary || '';
    descEl.textContent = viewState.description || '';
    ownerFieldEl.hidden = viewState.isAssignAction !== true;

    if (viewState.isAssignAction === true) {
        ownerSelectEl.innerHTML = viewState.ownerOptionsMarkup || '<option value="">暂无可选管理员</option>';
        ownerSelectEl.value = viewState.selectedOwnerId || ownerSelectEl.value || '';
        ownerSelectEl.disabled = viewState.ownerSelectDisabled === true;
        ownerHintEl.textContent = viewState.ownerHintText || '';
    } else {
        ownerSelectEl.innerHTML = '';
        ownerSelectEl.disabled = false;
        ownerHintEl.textContent = '';
    }

    labelEl.textContent = viewState.fieldLabel || '';
    textareaEl.placeholder = viewState.placeholder || '';
    submitBtn.textContent = viewState.submitLabel || '提交';
    submitBtn.disabled = viewState.submitDisabled === true;
}

function renderOpsAlertCaseComposer() {
    const modal = document.getElementById('shopRiskCaseComposerModal');
    const titleEl = document.getElementById('shopRiskCaseComposerTitle');
    const summaryEl = document.getElementById('shopRiskCaseComposerSummary');
    const descEl = document.getElementById('shopRiskCaseComposerDescription');
    const ownerFieldEl = document.getElementById('shopRiskCaseComposerOwnerField');
    const ownerSelectEl = document.getElementById('shopRiskCaseComposerOwnerSelect');
    const ownerHintEl = document.getElementById('shopRiskCaseComposerOwnerHint');
    const labelEl = document.getElementById('shopRiskCaseComposerLabel');
    const textareaEl = document.getElementById('shopRiskCaseComposerTextarea');
    const submitBtn = document.getElementById('shopRiskCaseComposerSubmit');

    if (!modal || !titleEl || !summaryEl || !descEl || !ownerFieldEl || !ownerSelectEl || !ownerHintEl || !labelEl || !textareaEl || !submitBtn) {
        return;
    }

    const viewState = buildLocalOpsAlertCaseComposerViewState(shopRiskCaseComposerState || getDefaultShopRiskCaseComposerState());

    applyOpsAlertCaseComposerViewState(viewState, {
        titleEl,
        summaryEl,
        descEl,
        ownerFieldEl,
        ownerSelectEl,
        ownerHintEl,
        labelEl,
        textareaEl,
        submitBtn
    });

    setOpsAlertCaseComposerVisible(viewState.open === true);
    if (viewState.focusTarget) {
        window.setTimeout(() => {
            if (viewState.focusTarget === 'owner') {
                ownerSelectEl.focus();
                return;
            }
            textareaEl.focus();
        }, 40);
    }
}

function closeOpsAlertCaseComposer() {
    shopRiskCaseComposerState = getDefaultShopRiskCaseComposerState();
    const textareaEl = document.getElementById('shopRiskCaseComposerTextarea');
    if (textareaEl) {
        textareaEl.value = '';
    }
    renderOpsAlertCaseComposer();
}

function openOpsAlertCaseComposer(action, context = {}, options = {}) {
    const nextState = {
        open: true,
        action: String(action || '').trim().toLowerCase(),
        mode: String(options.mode || 'single').trim().toLowerCase() || 'single',
        context: normalizeOpsAlertWorkspaceContext(context),
        items: buildOpsAlertCaseMutationItems(options.items || [], String(options.categoryKey || context.category || '').trim().toLowerCase()),
        selectedOwnerAdminId: String(options.ownerAdminId || '').trim(),
        selectedOwnerLabel: String(options.ownerLabel || '').trim(),
        submitting: false
    };
    const defaultOwner = getDefaultOpsAlertCaseComposerOwner(nextState);

    shopRiskCaseComposerState = {
        ...nextState,
        selectedOwnerAdminId: defaultOwner.id,
        selectedOwnerLabel: defaultOwner.label
    };

    const textareaEl = document.getElementById('shopRiskCaseComposerTextarea');
    if (textareaEl) {
        textareaEl.value = '';
    }

    renderOpsAlertCaseComposer();
}

function buildLocalOpsAlertCaseComposerSubmissionState(state = shopRiskCaseComposerState || getDefaultShopRiskCaseComposerState(), options = {}) {
    return {
        ...state,
        selectedOwnerAdminId: String(options.selectedOwnerAdminId || state.selectedOwnerAdminId || '').trim(),
        selectedOwnerLabel: String(options.selectedOwnerLabel || state.selectedOwnerLabel || '').trim(),
        submitting: options.submitting === true
    };
}

function applyOpsAlertCaseComposerSubmissionState(nextState = getDefaultShopRiskCaseComposerState()) {
    shopRiskCaseComposerState = nextState;
    renderOpsAlertCaseComposer();
}

function buildLocalOpsAlertCaseComposerSubmissionContext(state = shopRiskCaseComposerState || getDefaultShopRiskCaseComposerState(), elements = {}) {
    const textareaEl = elements.textareaEl || document.getElementById('shopRiskCaseComposerTextarea');
    const ownerSelectEl = elements.ownerSelectEl || document.getElementById('shopRiskCaseComposerOwnerSelect');
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : getDefaultShopRiskCaseComposerState();
    const textValue = String(textareaEl?.value || '').trim();
    const selectedOwnerAdminId = String(ownerSelectEl?.value || normalizedState.selectedOwnerAdminId || '').trim();
    const selectedOwner = getOpsAlertMonitorAssignableAdmins().find((admin) => admin.id === selectedOwnerAdminId) || null;
    const selectedOwnerLabel = selectedOwner?.label || String(normalizedState.selectedOwnerLabel || '').trim();
    const normalizedAction = String(normalizedState.action || '').trim().toLowerCase();

    if (!normalizedState.open || !normalizedAction) {
        return {
            state: normalizedState,
            textValue,
            selectedOwnerAdminId,
            selectedOwnerLabel,
            canSubmit: false,
            validationError: '',
            validationFocus: null
        };
    }

    if (normalizedAction === 'assign' && !selectedOwnerAdminId) {
        return {
            state: normalizedState,
            textValue,
            selectedOwnerAdminId,
            selectedOwnerLabel,
            canSubmit: false,
            validationError: '请先选择负责人',
            validationFocus: ownerSelectEl || null
        };
    }

    if ((normalizedAction === 'add_note' || normalizedAction === 'resolve') && !textValue) {
        return {
            state: normalizedState,
            textValue,
            selectedOwnerAdminId,
            selectedOwnerLabel,
            canSubmit: false,
            validationError: normalizedAction === 'resolve' ? '请先填写关闭结论' : '请先填写备注内容',
            validationFocus: textareaEl || null
        };
    }

    return {
        state: normalizedState,
        textValue,
        selectedOwnerAdminId,
        selectedOwnerLabel,
        canSubmit: true,
        validationError: '',
        validationFocus: null,
        nextSubmissionState: buildLocalOpsAlertCaseComposerSubmissionState(normalizedState, {
            selectedOwnerAdminId,
            selectedOwnerLabel,
            submitting: true
        })
    };
}

async function submitOpsAlertCaseMutation(action, context = {}, options = {}) {
    const headers = await getAdminConfigApiHeaders();
    return resolveOpsAlertCaseMutationRequestSubmitter()(
        headers,
        action,
        context,
        {
            ...options,
            errorMessage: '集中告警处理失败'
        }
    );
}

function buildLocalOpsAlertCaseMutationRequest(action, context = {}, options = {}) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    const normalizedContext = normalizeOpsAlertWorkspaceContext(context);
    const items = buildOpsAlertCaseMutationItems(options.items || [], String(options.categoryKey || normalizedContext.category || '').trim().toLowerCase());
    const body = {
        action: normalizedAction,
        note: String(options.note || '').trim(),
        resolution: String(options.resolution || '').trim(),
        metadata: {
            alert_type: normalizedContext.alertType || '',
            category: normalizedContext.category || '',
            reference_label: normalizedContext.referenceLabel || '',
            reference_value: normalizedContext.referenceValue || '',
            signal_type: normalizedContext.signalType || '',
            title: normalizedContext.title || ''
        }
    };
    const ownerAdminId = String(options.ownerAdminId || options.owner_admin_id || '').trim();
    const ownerLabel = String(options.ownerLabel || options.owner_label || '').trim();

    if (items.length) {
        body.items = items;
    } else {
        body.category_key = normalizedContext.category || '';
        body.target_id = normalizedContext.targetId;
        body.alert_type = normalizedContext.alertType || '';
        body.title = normalizedContext.title || '';
    }

    if (ownerAdminId) {
        body.owner_admin_id = ownerAdminId;
    }
    if (ownerLabel) {
        body.owner_label = ownerLabel;
    }

    return body;
}

function resolveOpsAlertCaseMutationRequestBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildOpsAlertCaseMutationRequest',
        buildLocalOpsAlertCaseMutationRequest
    );
}

async function submitLocalOpsAlertCaseMutationRequest(headers = {}, action, context = {}, options = {}) {
    const requestBody = resolveOpsAlertCaseMutationRequestBuilder()(action, context, options);
    const response = await fetch('/api/admin/settings/ops-alert-monitor-cases', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
        throw new Error(payload.message || options.errorMessage || '集中告警处理失败');
    }

    return payload;
}

function resolveOpsAlertCaseMutationRequestSubmitter() {
    return resolveOpsAlertSharedCallable(
        'submitOpsAlertCaseMutationRequest',
        submitLocalOpsAlertCaseMutationRequest
    );
}

async function handleOpsAlertCaseAction(action, context = {}) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    const normalizedContext = normalizeOpsAlertWorkspaceContext(context);

    if (!normalizedContext.targetId) {
        showToast('缺少集中告警标识', 'warning');
        return false;
    }

    try {
        if (normalizedAction === 'claim' || normalizedAction === 'reopen') {
            const payload = await submitOpsAlertCaseMutation(normalizedAction, normalizedContext);
            await refreshOpsAlertMonitorPanel?.();
            showToast(payload.message || '集中告警已更新', 'success');
            return true;
        }

        if (normalizedAction === 'assign' || normalizedAction === 'add_note' || normalizedAction === 'resolve') {
            openOpsAlertCaseComposer(normalizedAction, normalizedContext);
            return true;
        }

        throw new Error('未识别的集中告警动作');
    } catch (error) {
        console.error('[Config] Handle ops alert case action failed:', error);
        showToast('处理失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function handleOpsAlertMonitorBatchCaseAction(action, categoryKey = '') {
    const normalizedAction = String(action || '').trim().toLowerCase();
    const items = getOpsAlertMonitorBatchItems(getOpsAlertMonitorViewFilters(), normalizedAction, categoryKey);

    if (!items.length) {
        const emptyMessageMap = {
            claim: '当前筛选条件下没有可指派的告警',
            assign: '当前筛选条件下没有可指派的告警',
            add_note: '当前筛选条件下没有可备注的告警',
            resolve: '当前筛选条件下没有可关闭的告警'
        };
        showToast(emptyMessageMap[normalizedAction] || '当前筛选条件下没有可处理的告警', 'info');
        return false;
    }

    try {
        if (normalizedAction === 'claim' || normalizedAction === 'assign') {
            openOpsAlertCaseComposer('assign', {
                category: categoryKey || getOpsAlertMonitorViewFilters().category || ''
            }, {
                mode: 'batch',
                items,
                categoryKey
            });
            return true;
        }

        if (normalizedAction === 'add_note' || normalizedAction === 'resolve') {
            openOpsAlertCaseComposer(normalizedAction, {
                category: categoryKey || getOpsAlertMonitorViewFilters().category || ''
            }, {
                mode: 'batch',
                items,
                categoryKey
            });
            return true;
        }

        throw new Error('未识别的批量告警动作');
    } catch (error) {
        console.error('[Config] Handle ops alert batch action failed:', error);
        showToast('处理失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

function setOpsAlertBatchMuteModalVisible(visible) {
    const modal = document.getElementById('opsAlertBatchMuteModal');
    if (!modal) return;
    modal.classList.toggle('is-visible', visible);
    modal.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function getDefaultOpsAlertBatchMuteUntilInputValue() {
    return formatDateTimeLocalInputValue(new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString());
}

function buildLocalOpsAlertBatchMuteModalState(state = opsAlertBatchMuteState || getDefaultOpsAlertBatchMuteState()) {
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : getDefaultOpsAlertBatchMuteState();
    const moduleLabels = (Array.isArray(normalizedState.moduleKeys) ? normalizedState.moduleKeys : []).map((key) => getOpsAlertMuteModuleLabel(key));
    const filters = normalizedState.filters && typeof normalizedState.filters === 'object' && !Array.isArray(normalizedState.filters)
        ? normalizedState.filters
        : getOpsAlertMonitorViewFilters();
    return {
        summaryText: moduleLabels.length
            ? `静默 ${moduleLabels.join('、')}`
            : '集中告警模块静默',
        noteText: moduleLabels.length
            ? `当前筛选：${getOpsAlertMonitorFilterSummaryLabel(filters)}`
            : '',
        defaultUntilValue: getDefaultOpsAlertBatchMuteUntilInputValue(),
        allowCriticalActive: normalizedState.allowCritical !== false,
        submitDisabled: normalizedState.submitting === true,
        submitLabel: normalizedState.submitting ? '静默中...' : '保存静默',
        shouldFocusAfterOpen: normalizedState.open === true && normalizedState.submitting !== true
    };
}

function resolveOpsAlertBatchMuteModalStateBuilder() {
    return resolveOpsAlertSharedCallable(
        'buildAdminWorkbenchOpsAlertBatchMuteModalState',
        buildLocalOpsAlertBatchMuteModalState,
        () => ({
            getModuleLabel: getOpsAlertMuteModuleLabel,
            getFilterSummaryLabel: getOpsAlertMonitorFilterSummaryLabel,
            formatCount: formatVerifyMonitorInteger,
            getDefaultUntilValue: getDefaultOpsAlertBatchMuteUntilInputValue
        })
    );
}

function resolveOpsAlertBatchMuteModalState(state = opsAlertBatchMuteState || getDefaultOpsAlertBatchMuteState()) {
    return resolveOpsAlertBatchMuteModalStateBuilder()(state);
}

function resolveOpsAlertBatchMuteModalViewState(state = opsAlertBatchMuteState || getDefaultOpsAlertBatchMuteState()) {
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : getDefaultOpsAlertBatchMuteState();
    const modalState = resolveOpsAlertBatchMuteModalState(normalizedState);
    return {
        open: normalizedState.open === true,
        allowCritical: normalizedState.allowCritical !== false,
        submitting: normalizedState.submitting === true,
        summaryText: modalState?.summaryText || '集中告警模块静默',
        noteText: modalState?.noteText || '',
        defaultUntilValue: modalState?.defaultUntilValue || getDefaultOpsAlertBatchMuteUntilInputValue(),
        allowCriticalActive: modalState ? modalState.allowCriticalActive : normalizedState.allowCritical !== false,
        submitDisabled: modalState ? modalState.submitDisabled : normalizedState.submitting === true,
        submitLabel: modalState?.submitLabel || (normalizedState.submitting ? '静默中...' : '保存静默'),
        shouldFocusAfterOpen: modalState ? modalState.shouldFocusAfterOpen === true : (normalizedState.open && !normalizedState.submitting)
    };
}

function applyOpsAlertBatchMuteModalViewState(viewState = {}, elements = {}) {
    const {
        summaryEl,
        noteEl,
        untilInput,
        allowCriticalToggle,
        submitBtn
    } = elements;

    summaryEl.textContent = viewState.summaryText || '集中告警模块静默';
    noteEl.textContent = viewState.noteText || '';
    if (!untilInput.value) {
        untilInput.value = viewState.defaultUntilValue || '';
    }
    allowCriticalToggle.classList.toggle('active', viewState.allowCriticalActive === true);
    submitBtn.disabled = viewState.submitDisabled === true;
    submitBtn.textContent = viewState.submitLabel || '保存静默';
}

function renderOpsAlertBatchMuteModal() {
    const modal = document.getElementById('opsAlertBatchMuteModal');
    const summaryEl = document.getElementById('opsAlertBatchMuteSummary');
    const noteEl = document.getElementById('opsAlertBatchMuteDescription');
    const untilInput = document.getElementById('opsAlertBatchMuteUntil');
    const allowCriticalToggle = document.getElementById('opsAlertBatchMuteAllowCriticalToggle');
    const submitBtn = document.getElementById('opsAlertBatchMuteSubmit');

    if (!modal || !summaryEl || !noteEl || !untilInput || !allowCriticalToggle || !submitBtn) {
        return;
    }

    const viewState = resolveOpsAlertBatchMuteModalViewState(opsAlertBatchMuteState || getDefaultOpsAlertBatchMuteState());

    applyOpsAlertBatchMuteModalViewState(viewState, {
        summaryEl,
        noteEl,
        untilInput,
        allowCriticalToggle,
        submitBtn
    });

    setOpsAlertBatchMuteModalVisible(viewState.open);
    if (viewState.shouldFocusAfterOpen) {
        window.setTimeout(() => untilInput.focus(), 40);
    }
}

function closeOpsAlertBatchMuteModal() {
    opsAlertBatchMuteState = getDefaultOpsAlertBatchMuteState();
    const untilInput = document.getElementById('opsAlertBatchMuteUntil');
    if (untilInput) {
        untilInput.value = '';
    }
    renderOpsAlertBatchMuteModal();
}

function toggleOpsAlertBatchMuteAllowCritical() {
    const toggle = document.getElementById('opsAlertBatchMuteAllowCriticalToggle');
    if (!toggle) return false;
    const nextActive = !toggle.classList.contains('active');
    toggle.classList.toggle('active', nextActive);
    opsAlertBatchMuteState = {
        ...(opsAlertBatchMuteState || getDefaultOpsAlertBatchMuteState()),
        allowCritical: nextActive
    };
    return true;
}

function openOpsAlertBatchMuteModal(categoryKey = '') {
    const filters = getOpsAlertMonitorViewFilters();
    const moduleKeys = getOpsAlertMonitorBatchMuteModuleKeys(filters, categoryKey);
    const items = getOpsAlertMonitorBatchItems(filters, 'add_note', categoryKey);

    if (!moduleKeys.length || !items.length) {
        showToast('当前筛选条件下没有可静默的告警模块', 'info');
        return false;
    }

    opsAlertBatchMuteState = {
        open: true,
        items,
        moduleKeys,
        categoryKey: String(categoryKey || '').trim().toLowerCase(),
        filters,
        allowCritical: true,
        submitting: false
    };
    renderOpsAlertBatchMuteModal();
    return true;
}

function buildLocalOpsAlertBatchMuteSubmissionState(state = opsAlertBatchMuteState || getDefaultOpsAlertBatchMuteState(), options = {}) {
    return {
        ...state,
        allowCritical: options.allowCritical !== false,
        submitting: options.submitting === true
    };
}

function applyOpsAlertBatchMuteSubmissionState(nextState = getDefaultOpsAlertBatchMuteState()) {
    opsAlertBatchMuteState = nextState;
    renderOpsAlertBatchMuteModal();
}

function buildLocalOpsAlertBatchMuteSubmissionContext(state = opsAlertBatchMuteState || getDefaultOpsAlertBatchMuteState(), elements = {}) {
    const untilInput = elements.untilInput || document.getElementById('opsAlertBatchMuteUntil');
    const allowCriticalToggle = elements.allowCriticalToggle || document.getElementById('opsAlertBatchMuteAllowCriticalToggle');
    const normalizedState = state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : getDefaultOpsAlertBatchMuteState();
    const normalizedUntil = normalizeDateTimeLocalInputValue(String(untilInput?.value || '').trim());
    const allowCritical = allowCriticalToggle?.classList.contains('active') !== false;
    const moduleLabels = normalizedState.moduleKeys.map((key) => getOpsAlertMuteModuleLabel(key));

    if (!normalizedState.open || !normalizedState.moduleKeys.length) {
        return {
            state: normalizedState,
            normalizedUntil,
            allowCritical,
            moduleLabels,
            canSubmit: false,
            validationError: '',
            validationFocus: null
        };
    }

    if (!normalizedUntil) {
        return {
            state: normalizedState,
            normalizedUntil,
            allowCritical,
            moduleLabels,
            canSubmit: false,
            validationError: '请先选择静默截止时间',
            validationFocus: untilInput || null
        };
    }

    return {
        state: normalizedState,
        normalizedUntil,
        allowCritical,
        moduleLabels,
        canSubmit: true,
        validationError: '',
        validationFocus: null,
        nextSubmissionState: buildLocalOpsAlertBatchMuteSubmissionState(normalizedState, {
            allowCritical,
            submitting: true
        })
    };
}

async function submitOpsAlertBatchMuteModal() {
    const state = opsAlertBatchMuteState || getDefaultOpsAlertBatchMuteState();
    const submissionContext = buildLocalOpsAlertBatchMuteSubmissionContext(state);

    if (!submissionContext.canSubmit) {
        if (submissionContext.validationError) {
            showToast(submissionContext.validationError, 'warning');
            submissionContext.validationFocus?.focus?.();
        }
        return false;
    }

    try {
        applyOpsAlertBatchMuteSubmissionState(submissionContext.nextSubmissionState);

        const nextConfig = collectOpsAlertConfigFromForm();
        const caseEvents = state.items.length ? [{
            action: 'batch_mute',
            items: state.items,
            metadata: {
                mute_until: submissionContext.normalizedUntil,
                allow_critical: submissionContext.allowCritical,
                module_keys: state.moduleKeys,
                filter_scope: String(state.filters?.scope || 'all').trim().toLowerCase(),
                filter_severity: String(state.filters?.severity || 'all').trim().toLowerCase(),
                filter_category: String(state.filters?.category || 'all').trim().toLowerCase(),
                filter_summary: getOpsAlertMonitorFilterSummaryLabel(state.filters)
            }
        }] : [];
        state.moduleKeys.forEach((moduleKey) => {
            const currentRule = nextConfig.mute_rules?.modules?.[moduleKey] || {
                until: '',
                allow_critical: true
            };
            nextConfig.mute_rules.modules[moduleKey] = {
                ...currentRule,
                until: submissionContext.normalizedUntil,
                allow_critical: submissionContext.allowCritical
            };
        });

        const success = await saveOpsAlertConfigOverride(nextConfig, {
            successMessage: `已将 ${submissionContext.moduleLabels.join('、')} 静默至 ${formatVerifyMonitorDateTime(submissionContext.normalizedUntil)}`,
            caseEvents
        });
        if (!success) {
            applyOpsAlertBatchMuteSubmissionState(buildLocalOpsAlertBatchMuteSubmissionState(state, {
                allowCritical: submissionContext.allowCritical,
                submitting: false
            }));
            return false;
        }

        closeOpsAlertBatchMuteModal();
        await refreshOpsAlertMonitorPanel?.();
        return true;
    } catch (error) {
        console.error('[Config] Submit ops alert batch mute failed:', error);
        applyOpsAlertBatchMuteSubmissionState(buildLocalOpsAlertBatchMuteSubmissionState(state, {
            allowCritical: submissionContext.allowCritical,
            submitting: false
        }));
        showToast('静默失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function submitOpsAlertCaseComposer() {
    const state = shopRiskCaseComposerState || getDefaultShopRiskCaseComposerState();
    const submissionContext = buildLocalOpsAlertCaseComposerSubmissionContext(state);

    if (!submissionContext.canSubmit) {
        if (submissionContext.validationError) {
            showToast(submissionContext.validationError, 'warning');
            submissionContext.validationFocus?.focus?.();
        }
        return false;
    }

    try {
        applyOpsAlertCaseComposerSubmissionState(submissionContext.nextSubmissionState);

        const payload = await submitOpsAlertCaseMutation(state.action, state.context, {
            items: state.mode === 'batch' ? state.items : [],
            note: submissionContext.textValue,
            resolution: state.action === 'resolve' ? submissionContext.textValue : '',
            ownerAdminId: state.action === 'assign' ? submissionContext.selectedOwnerAdminId : '',
            ownerLabel: state.action === 'assign' ? submissionContext.selectedOwnerLabel : ''
        });

        closeOpsAlertCaseComposer();
        await refreshOpsAlertMonitorPanel?.();
        showToast(payload.message || '集中告警已更新', 'success');
        return true;
    } catch (error) {
        console.error('[Config] Submit ops alert case composer failed:', error);
        applyOpsAlertCaseComposerSubmissionState(buildLocalOpsAlertCaseComposerSubmissionState(state, {
            selectedOwnerAdminId: submissionContext.selectedOwnerAdminId,
            selectedOwnerLabel: submissionContext.selectedOwnerLabel,
            submitting: false
        }));
        showToast('处理失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

function getShopRiskCaseComposerTargetLabel(context = {}) {
    return getOpsAlertCaseComposerTargetLabel(context);
}

function getShopRiskCaseComposerMeta(action, context = {}) {
    return getOpsAlertCaseComposerMeta({
        action,
        context,
        mode: 'single',
        items: []
    });
}

function setShopRiskCaseComposerVisible(visible) {
    setOpsAlertCaseComposerVisible(visible);
}

function renderShopRiskCaseComposer() {
    renderOpsAlertCaseComposer();
}

function closeShopRiskCaseComposer() {
    closeOpsAlertCaseComposer();
}

function openShopRiskCaseComposer(action, context = {}) {
    openOpsAlertCaseComposer(action, context);
}

async function submitShopRiskCaseMutation(action, context = {}, options = {}) {
    return submitOpsAlertCaseMutation(action, context, options);
}

async function handleShopRiskCaseAction(action, context = {}) {
    return handleOpsAlertCaseAction(action, context);
}

async function submitShopRiskCaseComposer() {
    return submitOpsAlertCaseComposer();
}

function buildLocalOpsAlertSecretDeletionState(secretName = '', secretStatus = opsAlertSecretStatus || getDefaultOpsAlertSecretStatus()) {
    const secretLabels = {
        telegram_bot_token: 'Telegram Bot Token',
        feishu_webhook_url: '飞书 Webhook',
        email_api_key: 'Email API Key'
    };
    const normalizedSecretName = String(secretName || '').trim();
    const label = secretLabels[normalizedSecretName] || '';
    const currentStatus = secretStatus?.[normalizedSecretName];
    return {
        secretName: normalizedSecretName,
        label,
        isValid: Boolean(label),
        isEnvironmentManaged: currentStatus?.source === 'environment',
        confirmMessage: label
            ? `确定删除 ${label} 吗？删除后将无法继续通过该通道发送站外退款告警。`
            : '',
        successMessage: '站外告警密钥已删除',
        invalidMessage: '无效的站外告警密钥标识',
        envMessage: label
            ? `${label} 当前来自环境变量，请在部署平台里删除。`
            : '当前密钥来自环境变量，请在部署平台里删除。'
    };
}

async function handleShopRiskAction(action, context = {}) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    const normalizedContext = normalizeOpsAlertWorkspaceContext(context);

    try {
        if (normalizedAction === 'disable-coupon') {
            const discountCode = getOpsAlertWorkspaceDiscountCode(normalizedContext);
            if (!discountCode) {
                showToast('缺少可处理的优惠码', 'warning');
                return false;
            }

            if (!window.confirm(`确定要立即停用优惠码 ${discountCode} 吗？`)) {
                return false;
            }

            const { error } = await supabaseClient
                .from('discount_codes')
                .update({ is_active: false })
                .eq('code', discountCode);

            if (error) {
                throw error;
            }

            showToast(`已停用优惠码 ${discountCode}`, 'success');
            await Promise.allSettled([
                refreshOpsAlertMonitorPanel?.(),
                window.AdminDiscounts?.loadDiscounts?.()
            ]);
            return true;
        }

        if (normalizedAction === 'open-user-ban') {
            const userId = getOpsAlertWorkspaceRiskUserId(normalizedContext);
            if (!userId) {
                showToast('缺少可处理的用户', 'warning');
                return false;
            }

            await openOpsAlertWorkspace('shop-risk-users', {
                ...normalizedContext,
                userId
            });
            await settleOpsAlertWorkspace();

            if (typeof window.toggleUserBlock !== 'function') {
                throw new Error('用户封禁入口尚未就绪');
            }

            await window.toggleUserBlock(userId, false);
            showToast('已打开封禁处理弹窗', 'success');
            return true;
        }

        throw new Error('未识别的商城风控处理动作');
    } catch (error) {
        console.error('[Config] Handle shop risk action failed:', error);
        showToast('处理失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function deleteOpsAlertSecret(secretName) {
    const deletionContext = buildLocalOpsAlertSecretDeletionSubmissionContext(secretName, opsAlertSecretStatus || getDefaultOpsAlertSecretStatus());
    if (!deletionContext.isValid) {
        showToast(deletionContext.invalidMessage, 'warning');
        return false;
    }

    if (deletionContext.isEnvironmentManaged) {
        showToast(deletionContext.envMessage, 'warning');
        return false;
    }

    if (!confirm(deletionContext.confirmMessage)) {
        return false;
    }

    try {
        const headers = await getAdminConfigApiHeaders();
        const payload = await submitOpsAlertSecretDeletion(headers, deletionContext.secretName, {
            errorMessage: '删除站外告警密钥失败'
        });
        applyOpsAlertSettingsSavedPayload(payload, {
            successMessage: deletionContext.successMessage
        });
        return true;
    } catch (error) {
        console.error('[Config] Delete ops alert secret failed:', error);
        showToast('删除失败: ' + (error.message || '未知错误'), 'error');
        renderOpsAlertSettings();
        return false;
    }
}

function toggleOpsAlertsEnabled() {
    const toggleEl = document.getElementById('opsAlertEnabledToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertChannelEnabled(channelKey) {
    const toggleMap = {
        telegram: 'opsAlertTelegramEnabledToggle',
        feishu: 'opsAlertFeishuEnabledToggle',
        email: 'opsAlertEmailEnabledToggle'
    };
    const toggleEl = document.getElementById(toggleMap[channelKey]);
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertQuietHoursEnabled() {
    const toggleEl = document.getElementById('opsAlertQuietHoursEnabledToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    refreshOpsAlertStrategyDraftViews();
}

function toggleOpsAlertQuietHoursAllowCritical() {
    const quietHoursToggleEl = document.getElementById('opsAlertQuietHoursEnabledToggle');
    const toggleEl = document.getElementById('opsAlertQuietHoursAllowCriticalToggle');
    if (!toggleEl || !quietHoursToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    refreshOpsAlertStrategyDraftViews();
}

function toggleOpsAlertWorkHoursEnabled() {
    const toggleEl = document.getElementById('opsAlertWorkHoursEnabledToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    refreshOpsAlertStrategyDraftViews();
}

function toggleOpsAlertTemporaryMuteAllowCritical() {
    const toggleEl = document.getElementById('opsAlertTemporaryMuteAllowCriticalToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    refreshOpsAlertStrategyDraftViews();
}

function setOpsAlertTemporaryMutePreset(hours) {
    const numericHours = Math.max(1, Number(hours) || 0);
    const input = document.getElementById('opsAlertTemporaryMuteUntil');
    if (!input) return;

    const target = new Date(Date.now() + numericHours * 60 * 60 * 1000);
    input.value = formatDateTimeLocalInputValue(target);
    refreshOpsAlertStrategyDraftViews();
    showToast(`已设置临时静默 ${numericHours} 小时，保存站外告警配置后生效。`, 'info');
}

function clearOpsAlertTemporaryMute() {
    const input = document.getElementById('opsAlertTemporaryMuteUntil');
    if (!input) return;

    input.value = '';
    refreshOpsAlertStrategyDraftViews();
    showToast('已清除临时静默时间，保存站外告警配置后生效。', 'info');
}

function toggleOpsAlertMuteRuleAllowCritical(scope, key) {
    const toggleEl = document.getElementById(getOpsAlertMuteRuleElementId(scope, key, 'AllowCriticalToggle'));
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    refreshOpsAlertStrategyDraftViews();
}

function clearOpsAlertMuteRule(scope, key) {
    const input = document.getElementById(getOpsAlertMuteRuleElementId(scope, key, 'Until'));
    if (!input) return;

    input.value = '';
    refreshOpsAlertStrategyDraftViews();
    showToast('已清除该条静默时间，保存站外告警配置后生效。', 'info');
}

function applyOpsAlertSectionControlUpdates(applyControls) {
    if (typeof applyControls !== 'function') {
        return;
    }
    const nextConfig = collectOpsAlertConfigFromForm();
    applyControls(nextConfig);
    applyOpsAlertOverview(nextConfig);
}

function toggleOpsAlertSectionControl(toggleId, applyControls, options = {}) {
    const toggleEl = document.getElementById(toggleId);
    if (!toggleEl) return;

    const monitorToggleId = String(options.monitorToggleId || '').trim();
    if (monitorToggleId) {
        const monitorToggleEl = document.getElementById(monitorToggleId);
        if (!monitorToggleEl?.classList.contains('active')) {
            return;
        }
    }

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertSectionControlUpdates(applyControls);
}

function handleOpsAlertSectionSummaryScheduleModeChange(applyControls) {
    applyOpsAlertSectionControlUpdates(applyControls);
}

function createOpsAlertSectionToggleHandler(toggleId, applyControls, options = {}) {
    return function opsAlertSectionToggleHandler() {
        toggleOpsAlertSectionControl(toggleId, applyControls, options);
    };
}

function createOpsAlertSectionSummaryScheduleModeHandler(applyControls) {
    return function opsAlertSectionSummaryScheduleModeHandler() {
        handleOpsAlertSectionSummaryScheduleModeChange(applyControls);
    };
}

const toggleOpsAlertShopRiskAutoResponseEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertShopRiskAutoResponseEnabledToggle',
    applyOpsAlertShopRiskControls
);
const handleOpsAlertShopInventorySummaryScheduleModeChange = createOpsAlertSectionSummaryScheduleModeHandler(
    applyOpsAlertShopInventoryControls
);
const toggleOpsAlertShopInventoryEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertShopInventoryEnabledToggle',
    applyOpsAlertShopInventoryControls
);
const toggleOpsAlertShopInventoryRecoveryNotificationEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertShopInventoryRecoveryNotificationEnabledToggle',
    applyOpsAlertShopInventoryControls,
    { monitorToggleId: 'opsAlertShopInventoryEnabledToggle' }
);
const toggleOpsAlertShopInventorySummaryEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertShopInventorySummaryEnabledToggle',
    applyOpsAlertShopInventoryControls,
    { monitorToggleId: 'opsAlertShopInventoryEnabledToggle' }
);
const toggleOpsAlertCustomerChatMessageEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertCustomerChatMessageEnabledToggle',
    applyOpsAlertCustomerChatControls
);
const toggleOpsAlertCustomerChatMessageSummaryEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertCustomerChatMessageSummaryEnabledToggle',
    applyOpsAlertCustomerChatControls,
    { monitorToggleId: 'opsAlertCustomerChatMessageEnabledToggle' }
);
const toggleOpsAlertCustomerChatMessageWorkHoursOnlyEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertCustomerChatMessageWorkHoursOnlyEnabledToggle',
    applyOpsAlertCustomerChatControls,
    { monitorToggleId: 'opsAlertCustomerChatMessageEnabledToggle' }
);
const handleOpsAlertCustomerChatMessageSummaryScheduleModeChange = createOpsAlertSectionSummaryScheduleModeHandler(
    applyOpsAlertCustomerChatControls
);
const toggleOpsAlertShopPurchaseSuccessEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertShopPurchaseSuccessEnabledToggle',
    applyOpsAlertShopPurchaseSuccessControls
);
const toggleOpsAlertShopPurchaseSuccessSummaryEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertShopPurchaseSuccessSummaryEnabledToggle',
    applyOpsAlertShopPurchaseSuccessControls,
    { monitorToggleId: 'opsAlertShopPurchaseSuccessEnabledToggle' }
);
const toggleOpsAlertShopPurchaseSuccessWorkHoursOnlyEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertShopPurchaseSuccessWorkHoursOnlyEnabledToggle',
    applyOpsAlertShopPurchaseSuccessControls,
    { monitorToggleId: 'opsAlertShopPurchaseSuccessEnabledToggle' }
);
const handleOpsAlertShopPurchaseSuccessSummaryScheduleModeChange = createOpsAlertSectionSummaryScheduleModeHandler(
    applyOpsAlertShopPurchaseSuccessControls
);
const toggleOpsAlertWalletRechargeSuccessEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertWalletRechargeSuccessEnabledToggle',
    applyOpsAlertWalletRechargeSuccessControls
);
const toggleOpsAlertWalletRechargeSuccessSummaryEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertWalletRechargeSuccessSummaryEnabledToggle',
    applyOpsAlertWalletRechargeSuccessControls,
    { monitorToggleId: 'opsAlertWalletRechargeSuccessEnabledToggle' }
);
const toggleOpsAlertWalletRechargeSuccessWorkHoursOnlyEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertWalletRechargeSuccessWorkHoursOnlyEnabledToggle',
    applyOpsAlertWalletRechargeSuccessControls,
    { monitorToggleId: 'opsAlertWalletRechargeSuccessEnabledToggle' }
);
const handleOpsAlertWalletRechargeSuccessSummaryScheduleModeChange = createOpsAlertSectionSummaryScheduleModeHandler(
    applyOpsAlertWalletRechargeSuccessControls
);
const toggleOpsAlertTicketsEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertTicketsEnabledToggle',
    applyOpsAlertTicketsControls
);
const toggleOpsAlertTicketsSummaryEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertTicketsSummaryEnabledToggle',
    applyOpsAlertTicketsControls,
    { monitorToggleId: 'opsAlertTicketsEnabledToggle' }
);
const toggleOpsAlertTicketsWorkHoursOnlyEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertTicketsWorkHoursOnlyEnabledToggle',
    applyOpsAlertTicketsControls,
    { monitorToggleId: 'opsAlertTicketsEnabledToggle' }
);
const handleOpsAlertTicketsSummaryScheduleModeChange = createOpsAlertSectionSummaryScheduleModeHandler(
    applyOpsAlertTicketsControls
);
const toggleOpsAlertShopOrderDeliveryEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertShopOrderDeliveryEnabledToggle',
    applyOpsAlertShopOrderDeliveryControls
);
const toggleOpsAlertShopOrderDeliveryIncidentEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertShopOrderDeliveryIncidentEnabledToggle',
    applyOpsAlertShopOrderDeliveryControls,
    { monitorToggleId: 'opsAlertShopOrderDeliveryEnabledToggle' }
);
const toggleOpsAlertShopOrderDeliverySummaryEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertShopOrderDeliverySummaryEnabledToggle',
    applyOpsAlertShopOrderDeliveryControls,
    { monitorToggleId: 'opsAlertShopOrderDeliveryEnabledToggle' }
);
const toggleOpsAlertShopOrderDeliveryWorkHoursOnlyEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertShopOrderDeliveryWorkHoursOnlyEnabledToggle',
    applyOpsAlertShopOrderDeliveryControls,
    { monitorToggleId: 'opsAlertShopOrderDeliveryEnabledToggle' }
);
const handleOpsAlertShopOrderDeliverySummaryScheduleModeChange = createOpsAlertSectionSummaryScheduleModeHandler(
    applyOpsAlertShopOrderDeliveryControls
);
const toggleOpsAlertVerifyQuotaEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertVerifyQuotaEnabledToggle',
    applyOpsAlertVerifyQuotaControls
);
const toggleOpsAlertVerifyQuotaSummaryEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertVerifyQuotaSummaryEnabledToggle',
    applyOpsAlertVerifyQuotaControls,
    { monitorToggleId: 'opsAlertVerifyQuotaEnabledToggle' }
);
const toggleOpsAlertVerifyQuotaWorkHoursOnlyEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertVerifyQuotaWorkHoursOnlyEnabledToggle',
    applyOpsAlertVerifyQuotaControls,
    { monitorToggleId: 'opsAlertVerifyQuotaEnabledToggle' }
);
const handleOpsAlertVerifyQuotaSummaryScheduleModeChange = createOpsAlertSectionSummaryScheduleModeHandler(
    applyOpsAlertVerifyQuotaControls
);
const toggleOpsAlertVerifyQueueEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertVerifyQueueEnabledToggle',
    applyOpsAlertVerifyQueueControls
);
const toggleOpsAlertVerifyQueueSummaryEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertVerifyQueueSummaryEnabledToggle',
    applyOpsAlertVerifyQueueControls,
    { monitorToggleId: 'opsAlertVerifyQueueEnabledToggle' }
);
const toggleOpsAlertVerifyQueueWorkHoursOnlyEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertVerifyQueueWorkHoursOnlyEnabledToggle',
    applyOpsAlertVerifyQueueControls,
    { monitorToggleId: 'opsAlertVerifyQueueEnabledToggle' }
);
const handleOpsAlertVerifyQueueSummaryScheduleModeChange = createOpsAlertSectionSummaryScheduleModeHandler(
    applyOpsAlertVerifyQueueControls
);
const toggleOpsAlertVerifyFailureEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertVerifyFailureEnabledToggle',
    applyOpsAlertVerifyFailureControls
);
const toggleOpsAlertVerifyFailureSummaryEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertVerifyFailureSummaryEnabledToggle',
    applyOpsAlertVerifyFailureControls,
    { monitorToggleId: 'opsAlertVerifyFailureEnabledToggle' }
);
const toggleOpsAlertVerifyFailureWorkHoursOnlyEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertVerifyFailureWorkHoursOnlyEnabledToggle',
    applyOpsAlertVerifyFailureControls,
    { monitorToggleId: 'opsAlertVerifyFailureEnabledToggle' }
);
const handleOpsAlertVerifyFailureSummaryScheduleModeChange = createOpsAlertSectionSummaryScheduleModeHandler(
    applyOpsAlertVerifyFailureControls
);
const toggleOpsAlertPaymentGatewayEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertPaymentGatewayEnabledToggle',
    applyOpsAlertPaymentGatewayControls
);
const toggleOpsAlertPaymentGatewaySummaryEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertPaymentGatewaySummaryEnabledToggle',
    applyOpsAlertPaymentGatewayControls,
    { monitorToggleId: 'opsAlertPaymentGatewayEnabledToggle' }
);
const toggleOpsAlertPaymentGatewayWorkHoursOnlyEnabled = createOpsAlertSectionToggleHandler(
    'opsAlertPaymentGatewayWorkHoursOnlyEnabledToggle',
    applyOpsAlertPaymentGatewayControls,
    { monitorToggleId: 'opsAlertPaymentGatewayEnabledToggle' }
);
const handleOpsAlertPaymentGatewaySummaryScheduleModeChange = createOpsAlertSectionSummaryScheduleModeHandler(
    applyOpsAlertPaymentGatewayControls
);

// ============================================
// CHANNELS CRUD
// ============================================

async function deleteChannel(index) {
    const channels = systemConfigCache['channels'] || [];
    channels.splice(index, 1);
    await saveConfig('channels', channels);
    renderChannelsConfig();
}

async function addChannel() {
    const input = document.getElementById('newChannelName');
    const name = input?.value.trim();
    if (!name) return;

    const channels = systemConfigCache['channels'] || [];
    const newId = Math.max(...channels.map(c => c.id || 0), 0) + 1;

    channels.push({
        id: newId,
        name: name,
        icon: 'tag',
        is_default: false
    });

    await saveConfig('channels', channels);
    renderChannelsConfig();

    if (input) input.value = '';
}

// ============================================
// SECURITY SETTINGS
// ============================================

function renderSecurityConfig() {
    const config = systemConfigCache['security'] || {
        login_lockout_attempts: 5,
        lockout_duration: 900000,
        session_timeout: 3600000,
        ip_blacklist: []
    };

    // Login lockout attempts
    const lockoutInput = document.getElementById('cfgLoginLockoutAttempts');
    if (lockoutInput) lockoutInput.value = config.login_lockout_attempts || 5;

    // Lockout duration dropdown (now shows minutes only)
    const lockoutDurationValue = document.getElementById('lockoutDurationValue');
    if (lockoutDurationValue) {
        const duration = config.lockout_duration || 900000;
        const minutes = Math.round(duration / 60000);
        lockoutDurationValue.textContent = minutes;
    }

    // Session timeout dropdown (now shows minutes only)
    const sessionTimeoutValue = document.getElementById('sessionTimeoutValue');
    if (sessionTimeoutValue) {
        const timeout = config.session_timeout || 3600000;
        const minutes = Math.round(timeout / 60000);
        sessionTimeoutValue.textContent = minutes;
    }

    // IP blacklist
    const blacklistTextarea = document.getElementById('cfgIpBlacklist');
    if (blacklistTextarea) {
        const ips = config.ip_blacklist || [];
        blacklistTextarea.value = ips.join('\n');
    }

    renderAdminAuditMonitorPanel();
    refreshAdminAuditMonitor().catch((error) => {
        console.warn('[Config] Admin audit monitor refresh failed:', error.message);
    });
}

async function saveIpBlacklist() {
    const textarea = document.getElementById('cfgIpBlacklist');
    if (!textarea) return;

    const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l);
    const config = systemConfigCache['security'] || {};
    config.ip_blacklist = lines;

    const success = await saveConfig('security', config);

    const indicator = document.getElementById('ipBlacklistSaveIndicator');
    if (indicator && success) {
        showAdminConfigSaveIndicator(indicator, '✓ 已保存', 2000);
    }
}

function setupSecurityEventListeners() {
    // Login lockout attempts - no auto-save, user will click save button
    // We removed the auto-save to require explicit save button click

    // Load locked accounts when security settings view is shown
    document.querySelectorAll('[data-settings-view="security"]').forEach(btn => {
        btn.addEventListener('click', () => {
            setTimeout(() => {
                refreshLockedAccounts({ silent: true });
                refreshAdminAuditMonitor().catch((error) => {
                    console.warn('[Config] Admin audit monitor refresh on security switch failed:', error.message);
                });
            }, 300);
        });
    });
}

// ============================================
// LOGIN SECURITY FUNCTIONS
// ============================================

// Save all login security settings at once
async function saveLoginSecuritySettings() {
    try {
        const lockoutInput = document.getElementById('cfgLoginLockoutAttempts');
        const lockoutDurationValue = document.getElementById('lockoutDurationValue');
        const sessionTimeoutValue = document.getElementById('sessionTimeoutValue');

        // Map display values (minutes) to milliseconds
        const durationMinutes = parseInt(lockoutDurationValue?.textContent) || 15;
        const timeoutMinutes = parseInt(sessionTimeoutValue?.textContent) || 60;

        const config = systemConfigCache['security'] || {};
        config.login_lockout_attempts = parseInt(lockoutInput?.value) || 5;
        config.lockout_duration = durationMinutes * 60 * 1000; // minutes to ms
        config.session_timeout = timeoutMinutes * 60 * 1000; // minutes to ms

        const success = await saveConfig('security', config);

        if (success) {
            const indicator = document.getElementById('loginSecuritySaveIndicator');
            if (indicator) {
                showAdminConfigSaveIndicator(indicator, '✓ 已保存', 2000);
            }
            if (typeof showToast === 'function') {
                showToast('登录安全设置已保存', 'success');
            }
        }
    } catch (err) {
        console.error('保存登录安全设置失败:', err);
        if (typeof showToast === 'function') {
            showToast('保存失败: ' + err.message, 'error');
        }
    }
}

function setLockedAccountsRefreshButtonState(isLoading) {
    const button = document.getElementById('lockedAccountsRefreshButton');
    if (!button) return;

    if (!button.dataset.defaultLabel) {
        button.dataset.defaultLabel = button.innerHTML;
    }

    button.disabled = !!isLoading;
    button.innerHTML = isLoading
        ? '<i class="fas fa-sync-alt fa-spin"></i> 刷新中'
        : button.dataset.defaultLabel;
}

function showLockedAccountsRefreshIndicator(text = '已刷新', durationMs = 1800) {
    const indicator = document.getElementById('lockedAccountsRefreshIndicator');
    if (!indicator) return;
    showAdminConfigSaveIndicator(indicator, text, durationMs);
}

// Refresh locked accounts list
async function refreshLockedAccounts(options = {}) {
    const { silent = false } = options;
    const listEl = document.getElementById('lockedAccountsList');
    const badgeEl = document.getElementById('lockedCountBadge');
    const unlockAllBtn = document.getElementById('unlockAllBtn');
    const emptyMsg = document.getElementById('noLockedAccountsMsg');

    if (!listEl) return;

    setLockedAccountsRefreshButtonState(true);

    try {
        // Query profiles with locked_until > now
        const { data: lockedAccounts, error } = await supabaseClient
            .from('profiles')
            .select('id, username, failed_login_attempts, locked_until')
            .gt('locked_until', new Date().toISOString())
            .order('locked_until', { ascending: false });

        if (error) throw error;

        // Get emails from auth.users via admin view
        let accountsWithEmail = lockedAccounts || [];

        // Try to get emails if admin view exists
        try {
            const { data: usersData } = await supabaseClient
                .from('admin_users_view')
                .select('id, email')
                .in('id', accountsWithEmail.map(a => a.id));

            if (usersData) {
                const emailMap = {};
                usersData.forEach(u => emailMap[u.id] = u.email);
                accountsWithEmail = accountsWithEmail.map(a => ({
                    ...a,
                    email: emailMap[a.id] || a.username || a.id.substring(0, 8) + '...'
                }));
            }
        } catch (e) {
            // Fallback to username if admin view not available
            accountsWithEmail = accountsWithEmail.map(a => ({
                ...a,
                email: a.username || a.id.substring(0, 8) + '...'
            }));
        }

        // Update badge
        if (badgeEl) {
            badgeEl.textContent = accountsWithEmail.length;
            setAdminConfigHiddenState(badgeEl, accountsWithEmail.length === 0);
        }

        // Update unlock all button
        if (unlockAllBtn) {
            setAdminConfigHiddenState(unlockAllBtn, accountsWithEmail.length === 0);
        }

        // Render list
        if (accountsWithEmail.length === 0) {
            setAdminConfigHiddenState(emptyMsg, false);
            // Remove any account items
            listEl.querySelectorAll('.locked-account-item').forEach(el => el.remove());
        } else {
            setAdminConfigHiddenState(emptyMsg, true);

            // Clear existing items
            listEl.querySelectorAll('.locked-account-item').forEach(el => el.remove());

            // Render locked accounts
            accountsWithEmail.forEach(account => {
                const expiresAt = new Date(account.locked_until);
                const now = new Date();
                const remainingMs = expiresAt - now;
                const remainingMins = Math.ceil(remainingMs / 60000);
                const displayEmail = String(account.email || '').trim() || (account.username || `${account.id.substring(0, 8)}...`);
                const lockoutSummary = remainingMins >= 60
                    ? `${Math.ceil(remainingMins / 60)} 小时后解锁`
                    : `${remainingMins} 分钟后解锁`;

                const itemHtml = `
                    <div class="locked-account-item" data-user-id="${account.id}">
                        <div class="locked-account-info">
                            <div class="locked-account-email" title="${escapeHtml(displayEmail)}">${escapeHtml(displayEmail)}</div>
                            <div class="locked-account-meta">
                                <span class="attempts">${account.failed_login_attempts} 次失败</span>
                                <span class="expires"><i class="fas fa-clock"></i> ${lockoutSummary}</span>
                            </div>
                        </div>
                        <button class="btn-unlock"
                            type="button"
                            data-admin-action="settings-unlock-account"
                            data-user-id="${escapeHtml(account.id)}">
                            <i class="fas fa-unlock"></i> 解锁
                        </button>
                    </div>
                `;
                listEl.insertAdjacentHTML('beforeend', itemHtml);
            });
        }

        if (!silent) {
            showLockedAccountsRefreshIndicator(
                accountsWithEmail.length > 0 ? `已刷新 ${accountsWithEmail.length} 个` : '已刷新',
                1800
            );
        }

    } catch (err) {
        console.error('加载锁定账户失败:', err);
        if (typeof showToast === 'function') {
            showToast('加载失败: ' + err.message, 'error');
        }
    } finally {
        setLockedAccountsRefreshButtonState(false);
    }
}

// Unlock a single account
async function unlockAccount(userId) {
    try {
        // Use RPC to bypass RLS
        const { data, error } = await supabaseClient
            .rpc('admin_unlock_account', { target_user_id: userId });

        if (error) throw error;

        if (typeof showToast === 'function') {
            showToast('账户已解锁', 'success');
        }

        // Refresh list
        await refreshLockedAccounts({ silent: true });

    } catch (err) {
        console.error('解锁账户失败:', err);
        if (typeof showToast === 'function') {
            showToast('解锁失败: ' + err.message, 'error');
        }
    }
}

// Unlock all accounts
async function unlockAllAccounts() {
    if (!confirm('确定要解锁所有账户吗？')) return;

    try {
        // Use RPC to bypass RLS
        const { data, error } = await supabaseClient
            .rpc('admin_unlock_all_accounts');

        if (error) throw error;

        if (typeof showToast === 'function') {
            showToast(`已解锁 ${data || 0} 个账户`, 'success');
        }

        // Refresh list
        await refreshLockedAccounts({ silent: true });

    } catch (err) {
        console.error('批量解锁失败:', err);
        if (typeof showToast === 'function') {
            showToast('解锁失败: ' + err.message, 'error');
        }
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Expose to window
window.saveLoginSecuritySettings = saveLoginSecuritySettings;
window.refreshLockedAccounts = refreshLockedAccounts;
window.unlockAccount = unlockAccount;
window.unlockAllAccounts = unlockAllAccounts;

// ============================================
// NOTIFICATIONS SETTINGS
// ============================================

function renderNotificationsConfig() {
    const config = systemConfigCache['notifications'] || {
        new_user_notify: false,
        announcement_enabled: false,
        announcement_content: '',
        announcement_type: 'banner',
        announcement_color: 'purple',
        announcement_size: 'medium',
        announcement_decoration: 'none',
        announcement_pages: ['all']
    };

    // New user notification toggle
    const newUserNotify = document.getElementById('cfgNewUserNotify');
    if (newUserNotify) newUserNotify.checked = config.new_user_notify || false;

    // Announcement enabled toggle
    const announcementEnabled = document.getElementById('cfgAnnouncementEnabled');
    if (announcementEnabled) announcementEnabled.checked = config.announcement_enabled || false;

    // Announcement content (for contenteditable div, use innerHTML)
    const announcementContent = document.getElementById('cfgAnnouncementContent');
    if (announcementContent) {
        announcementContent.innerHTML = config.announcement_content || '';
    }

    // Announcement type (radio buttons)
    const typeRadios = document.querySelectorAll('input[name="announcementType"]');
    typeRadios.forEach(radio => {
        if (radio.value === (config.announcement_type || 'banner')) {
            radio.checked = true;
        }
    });

    // Announcement color (radio buttons)
    const colorRadios = document.querySelectorAll('input[name="announcementColor"]');
    colorRadios.forEach(radio => {
        if (radio.value === (config.announcement_color || 'purple')) {
            radio.checked = true;
        }
    });

    // Decoration theme
    const savedDecoration = config.announcement_decoration || 'none';
    const decorationEnabled = document.getElementById('decorationEnabled');
    const decorationSelector = document.getElementById('decorationSelector');

    if (savedDecoration !== 'none' && decorationEnabled && decorationSelector) {
        decorationEnabled.checked = true;
        decorationSelector.classList.add('active');
        selectDecoration(savedDecoration);
    }

    // Page target selector - restore saved pages
    const savedPages = config.announcement_pages || ['all'];
    restorePageSelector(savedPages);

    // Update preview
    updateAnnouncementPreview();
}

function updateAnnouncementPreview() {
    const preview = document.getElementById('announcementPreview');
    if (!preview) return;

    const contentEl = document.getElementById('cfgAnnouncementContent');
    const typeRadio = document.querySelector('input[name="announcementType"]:checked');

    // For contenteditable div, use innerHTML; for textarea, use value
    const content = contentEl?.innerHTML || contentEl?.value || '在此预览公告效果...';
    const type = typeRadio?.value || 'banner';

    // Update preview content - target the new announcement-text element
    const textContent = document.getElementById('previewTextContent');
    if (textContent) {
        textContent.innerHTML = content || '在此预览公告效果...';
    }

    // Update type style (currently only modal style is truly supported in preview)
    preview.classList.remove('modal-style', 'toast-style');
    if (type === 'modal') {
        preview.classList.add('modal-style');
    } else if (type === 'toast') {
        preview.classList.add('toast-style');
    }
}

async function saveAnnouncement() {
    const contentEl = document.getElementById('cfgAnnouncementContent');
    const enabledEl = document.getElementById('cfgAnnouncementEnabled');
    const typeRadio = document.querySelector('input[name="announcementType"]:checked');

    if (!contentEl) return;

    const previousConfig = {
        ...(systemConfigCache['notifications'] || {})
    };
    const config = {
        ...previousConfig
    };
    // For contenteditable div, use innerHTML
    config.announcement_content = contentEl.innerHTML || contentEl.value || '';
    config.announcement_enabled = enabledEl?.checked || false;
    config.announcement_type = typeRadio?.value || 'banner';
    // Save decoration theme
    config.announcement_decoration = getCurrentDecoration();
    // Save target pages
    config.announcement_pages = getSelectedPages();
    // Add timestamp so each publish generates a new ackKey
    config.announcement_updated_at = new Date().toISOString();

    const success = await saveConfig('notifications', config);

    // Get the save button
    const saveBtn = document.querySelector('.editor-actions .btn-primary');

    if (!success) {
        return;
    }

    try {
        await notifyActiveAdminsAboutAnnouncement(previousConfig, config);
    } catch (notificationError) {
        console.warn('[Config] Announcement admin reminder failed:', notificationError.message || notificationError);
    }

    if (saveBtn) {
        if (typeof showToast === 'function') {
            showToast(config.announcement_enabled ? '公告已发布' : '公告设置已保存', 'success');
        } else {
            console.warn('showToast function not found');
        }
    }
}

function setupNotificationsEventListeners() {
    // New user notification toggle
    const newUserNotify = document.getElementById('cfgNewUserNotify');
    if (newUserNotify) {
        newUserNotify.addEventListener('change', async (e) => {
            const config = systemConfigCache['notifications'] || {};
            config.new_user_notify = e.target.checked;
            await saveConfig('notifications', config);
        });
    }

    // Announcement enabled toggle
    const announcementEnabled = document.getElementById('cfgAnnouncementEnabled');
    if (announcementEnabled) {
        announcementEnabled.addEventListener('change', async (e) => {
            const config = systemConfigCache['notifications'] || {};
            config.announcement_enabled = e.target.checked;
            await saveConfig('notifications', config);
        });
    }

    // Type radio buttons - update preview
    const typeRadios = document.querySelectorAll('input[name="announcementType"]');
    typeRadios.forEach(radio => {
        radio.addEventListener('change', updateAnnouncementPreview);
    });

    // Color radio buttons - update preview
    const colorRadios = document.querySelectorAll('input[name="announcementColor"]');
    colorRadios.forEach(radio => {
        radio.addEventListener('change', updateAnnouncementPreview);
    });

    // Content editor - update preview on input
    const contentEl = document.getElementById('cfgAnnouncementContent');
    if (contentEl) {
        contentEl.addEventListener('input', updateAnnouncementPreview);
    }
}


// ============================================
// WYSIWYG TOOLBAR FUNCTIONS
// ============================================

const AdminRichTextEditor = (() => {
    const instances = new Map();
    const richTextTagPattern = /<\/?(?:a|b|strong|i|em|u|div|p|br|font|span|ul|ol|li)\b/i;
    const defaultEmojis = ['🎉', '📢', '⚠️', '✨', '🔥', '💡', '🎁', '❤️', '👍', '🚀', '🌟', '💯'];
    const defaultColors = [
        { value: '#ffffff', label: '白色' },
        { value: '#ffeb3b', label: '黄色' },
        { value: '#ff9800', label: '橙色' },
        { value: '#4caf50', label: '绿色' },
        { value: '#e57373', label: '红色' },
        { value: '#6b9ece', label: '蓝色' }
    ];
    const defaultSizes = [
        { value: '2', label: '小', className: 'small' },
        { value: '3', label: '中', className: 'medium' },
        { value: '5', label: '大', className: 'large' }
    ];

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function getInstance(key = 'announcement') {
        return instances.get(key) || null;
    }

    function isEditorEmpty(editor) {
        if (!editor) return true;
        const text = (editor.textContent || '').replace(/\u00a0/g, ' ').trim();
        return !text && !editor.querySelector('img, video, iframe, a, font, b, i, u, strong, em');
    }

    function serializeEditorHtml(editor) {
        return isEditorEmpty(editor) ? '' : editor.innerHTML;
    }

    function normalizeStoredContent(value) {
        if (typeof value !== 'string' || !value.trim()) return '';
        if (richTextTagPattern.test(value)) return value;
        return escapeHtml(value).replace(/\n/g, '<br>');
    }

    function placeCursorAtEnd(editor) {
        if (!editor) return;
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function saveSelection(instance) {
        if (!instance?.editor) return;
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (instance.editor.contains(range.commonAncestorContainer)) {
            instance.selection = range.cloneRange();
        }
    }

    function restoreSelection(instance) {
        if (!instance?.editor) return;
        const selection = window.getSelection();
        if (!selection) return;

        selection.removeAllRanges();
        if (instance.selection) {
            selection.addRange(instance.selection);
            return;
        }

        placeCursorAtEnd(instance.editor);
    }

    function syncHiddenInput(instance, invokeCallback = true) {
        if (!instance) return;
        if (instance.hiddenInput) {
            instance.hiddenInput.value = serializeEditorHtml(instance.editor);
        }
        if (invokeCallback && typeof instance.onInput === 'function') {
            instance.onInput(instance);
        }
    }

    function closeDropdownElement(dropdown) {
        if (!dropdown) return;
        dropdown.querySelector('.dropdown-trigger, .toolbar-btn')?.classList.remove('active');
        dropdown.querySelector('.dropdown-menu')?.classList.remove('show');
    }

    function closeFloatingPanels(exceptKey = null, exceptDropdownId = null) {
        instances.forEach(instance => {
            if (instance.key !== exceptKey) {
                instance.emojiPicker?.classList.remove('active');
                instance.alignPicker?.classList.remove('active');
            }

            Object.values(instance.dropdowns || {}).forEach(dropdown => {
                if (!dropdown) return;
                if (dropdown.id === exceptDropdownId) return;
                closeDropdownElement(dropdown);
            });
        });
    }

    function bindToolbarMouseDown(instance) {
        if (!instance?.toolbarRoot) return;
        instance.toolbarRoot.querySelectorAll('button').forEach(button => {
            if (button.dataset.rteMouseBound === '1') return;
            button.dataset.rteMouseBound = '1';
            button.addEventListener('mousedown', (event) => {
                event.preventDefault();
            });
        });
    }

    function updateColorUI(instance, color) {
        if (!instance) return;
        if (instance.colorPreview) {
            applyAdminConfigRichTextColorSwatch(instance.colorPreview, color, { preview: true });
        }
        const colorDropdown = instance.dropdowns?.color;
        colorDropdown?.querySelectorAll('.dropdown-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.colorOption === color);
        });
    }

    function updateSizeUI(instance, size, sizeClass) {
        if (!instance) return;
        if (instance.sizePreview) {
            instance.sizePreview.className = `size-indicator ${sizeClass}`;
        }
        const sizeDropdown = instance.dropdowns?.size;
        sizeDropdown?.querySelectorAll('.dropdown-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.sizeOption === size);
        });
    }

    function focusAndRestore(instance) {
        if (!instance?.editor) return false;
        instance.editor.focus();
        restoreSelection(instance);
        return true;
    }

    function execCommand(key, command, value = null) {
        const instance = getInstance(key);
        if (!focusAndRestore(instance)) return;

        document.execCommand(command, false, value);
        saveSelection(instance);
        syncHiddenInput(instance);
    }

    function createMarkup(config) {
        const colorItems = defaultColors.map(({ value, label }) => `
            <button type="button" class="dropdown-item${value === '#6b9ece' ? ' selected' : ''}"
                data-color-option="${value}"
                data-admin-action="settings-rich-text-select-color"
                data-rich-text-key="${config.key}"
                data-rich-text-color="${value}">
                <span class="color-swatch ${getAdminConfigRichTextColorClass(value)}"></span> ${label}
            </button>
        `).join('');

        const sizeItems = defaultSizes.map(({ value, label, className }) => `
            <button type="button" class="dropdown-item${value === '3' ? ' selected' : ''}"
                data-size-option="${value}"
                data-admin-action="settings-rich-text-select-font-size"
                data-rich-text-key="${config.key}"
                data-rich-text-size="${value}"
                data-rich-text-size-class="${className}">
                <span class="size-indicator ${className}">A</span> ${label}
            </button>
        `).join('');

        const emojiItems = defaultEmojis.map(emoji => `
            <button type="button" class="emoji-item"
                data-admin-action="settings-rich-text-select-emoji"
                data-rich-text-key="${config.key}"
                data-rich-text-emoji="${emoji}">${emoji}</button>
        `).join('');

        return `
            <div class="announcement-toolbar" id="${config.toolbarRootId}">
                <button type="button" class="toolbar-btn"
                    data-admin-action="settings-rich-text-format"
                    data-rich-text-key="${config.key}"
                    data-rich-text-format="b" title="加粗">
                    <i class="fas fa-bold"></i>
                </button>
                <button type="button" class="toolbar-btn"
                    data-admin-action="settings-rich-text-format"
                    data-rich-text-key="${config.key}"
                    data-rich-text-format="i" title="斜体">
                    <i class="fas fa-italic"></i>
                </button>
                <button type="button" class="toolbar-btn"
                    data-admin-action="settings-rich-text-format"
                    data-rich-text-key="${config.key}"
                    data-rich-text-format="u" title="下划线">
                    <i class="fas fa-underline"></i>
                </button>
                <div class="align-picker-container">
                    <button type="button" class="toolbar-btn" id="${config.alignButtonId}"
                        data-admin-action="settings-rich-text-toggle-align-picker"
                        data-rich-text-key="${config.key}" title="对齐">
                        <i class="fas fa-align-center"></i>
                    </button>
                    <div class="align-picker" id="${config.alignPickerId}">
                        <button type="button" class="align-item"
                            data-admin-action="settings-rich-text-apply-align"
                            data-rich-text-key="${config.key}"
                            data-rich-text-align="left" title="左对齐">
                            <i class="fas fa-align-left"></i>
                        </button>
                        <button type="button" class="align-item"
                            data-admin-action="settings-rich-text-apply-align"
                            data-rich-text-key="${config.key}"
                            data-rich-text-align="center" title="居中">
                            <i class="fas fa-align-center"></i>
                        </button>
                        <button type="button" class="align-item"
                            data-admin-action="settings-rich-text-apply-align"
                            data-rich-text-key="${config.key}"
                            data-rich-text-align="right" title="右对齐">
                            <i class="fas fa-align-right"></i>
                        </button>
                    </div>
                </div>
                <div class="toolbar-divider"></div>
                <button type="button" class="toolbar-btn"
                    data-admin-action="settings-rich-text-insert-link"
                    data-rich-text-key="${config.key}" title="链接">
                    <i class="fas fa-link"></i>
                </button>
                <div class="emoji-picker-container">
                    <button type="button" class="toolbar-btn" id="${config.emojiButtonId}"
                        data-admin-action="settings-rich-text-toggle-emoji-picker"
                        data-rich-text-key="${config.key}" title="表情">
                        <i class="fas fa-smile"></i>
                    </button>
                    <div class="emoji-picker" id="${config.emojiPickerId}">
                        <div class="emoji-picker-header">表情</div>
                        <div class="emoji-grid">
                            ${emojiItems}
                        </div>
                    </div>
                </div>
                <div class="toolbar-dropdown" id="${config.colorDropdownId}">
                    <button type="button" class="toolbar-btn"
                        data-admin-action="settings-rich-text-toggle-dropdown"
                        data-rich-text-key="${config.key}"
                        data-rich-text-dropdown="color" title="文字颜色">
                        <span class="color-swatch preview ${getAdminConfigRichTextColorClass('#6b9ece')}" id="${config.colorPreviewId}"></span>
                    </button>
                    <div class="dropdown-menu">
                        ${colorItems}
                    </div>
                </div>
                <div class="toolbar-dropdown" id="${config.sizeDropdownId}">
                    <button type="button" class="toolbar-btn"
                        data-admin-action="settings-rich-text-toggle-dropdown"
                        data-rich-text-key="${config.key}"
                        data-rich-text-dropdown="size" title="字号">
                        <span class="size-indicator medium" id="${config.sizePreviewId}">A</span>
                    </button>
                    <div class="dropdown-menu">
                        ${sizeItems}
                    </div>
                </div>
            </div>
            <div class="wysiwyg-editor" id="${config.editorId}" contenteditable="true"
                data-placeholder="${escapeHtml(config.placeholder || '请输入内容...')}"></div>
        `;
    }

    function register(config) {
        if (!config?.key || !config.editorId) return null;

        const existing = getInstance(config.key);
        if (existing) {
            Object.assign(existing, config);
            return existing;
        }

        const instance = {
            ...config,
            editor: document.getElementById(config.editorId),
            hiddenInput: config.hiddenInputId ? document.getElementById(config.hiddenInputId) : null,
            toolbarRoot: config.toolbarRootId ? document.getElementById(config.toolbarRootId) : null,
            emojiPicker: config.emojiPickerId ? document.getElementById(config.emojiPickerId) : null,
            emojiButton: config.emojiButtonId ? document.getElementById(config.emojiButtonId) : null,
            alignPicker: config.alignPickerId ? document.getElementById(config.alignPickerId) : null,
            alignButton: config.alignButtonId ? document.getElementById(config.alignButtonId) : null,
            colorPreview: config.colorPreviewId ? document.getElementById(config.colorPreviewId) : null,
            sizePreview: config.sizePreviewId ? document.getElementById(config.sizePreviewId) : null,
            dropdowns: {
                color: config.colorDropdownId ? document.getElementById(config.colorDropdownId) : null,
                size: config.sizeDropdownId ? document.getElementById(config.sizeDropdownId) : null
            },
            selection: null
        };

        if (!instance.editor) return null;

        if (instance.hiddenInput) {
            instance.hiddenInput.hidden = true;
        }

        bindToolbarMouseDown(instance);

        instance.editor.addEventListener('input', () => {
            saveSelection(instance);
            syncHiddenInput(instance);
        });

        ['mouseup', 'keyup', 'focus'].forEach(eventName => {
            instance.editor.addEventListener(eventName, () => saveSelection(instance));
        });

        instance.editor.addEventListener('blur', () => {
            setTimeout(() => saveSelection(instance), 0);
        });

        instances.set(instance.key, instance);

        if (instance.hiddenInput && !serializeEditorHtml(instance.editor) && instance.hiddenInput.value) {
            setContent(instance.key, instance.hiddenInput.value, { syncHiddenInput: false });
        }

        return instance;
    }

    function ensureInjectedEditor(config) {
        if (!config?.key || !config.hiddenInputId) return null;

        const hiddenInput = document.getElementById(config.hiddenInputId);
        if (!hiddenInput) return null;

        if (!document.getElementById(config.editorId)) {
            const shell = document.createElement('div');
            shell.className = 'rich-text-editor-shell';
            shell.innerHTML = createMarkup(config);
            hiddenInput.parentNode.insertBefore(shell, hiddenInput);
        }

        return register(config);
    }

    function setContent(key, value, options = {}) {
        const instance = getInstance(key);
        if (!instance?.editor) return;

        instance.editor.innerHTML = normalizeStoredContent(value || '');
        instance.selection = null;

        if (!options.syncHiddenInput && instance.hiddenInput && typeof value === 'string') {
            instance.hiddenInput.value = value;
        }

        if (options.syncHiddenInput) {
            syncHiddenInput(instance, options.invokeCallback !== false);
        } else if (typeof instance.onRender === 'function') {
            instance.onRender(instance);
        }
    }

    function togglePicker(key, pickerType) {
        const instance = getInstance(key);
        const picker = pickerType === 'emoji' ? instance?.emojiPicker : instance?.alignPicker;
        if (!picker) return;

        const shouldOpen = !picker.classList.contains('active');
        closeFloatingPanels(shouldOpen ? key : null);
        picker.classList.toggle('active', shouldOpen);
    }

    function toggleDropdown(key, dropdownType) {
        const instance = getInstance(key);
        const dropdown = instance?.dropdowns?.[dropdownType];
        if (!dropdown) return;

        const trigger = dropdown.querySelector('.dropdown-trigger, .toolbar-btn');
        const menu = dropdown.querySelector('.dropdown-menu');
        const shouldOpen = !menu?.classList.contains('show');

        closeFloatingPanels(shouldOpen ? key : null, shouldOpen ? dropdown.id : null);
        trigger?.classList.toggle('active', shouldOpen);
        menu?.classList.toggle('show', shouldOpen);
    }

    return {
        register,
        ensureInjectedEditor,
        setContent,
        getContent(key) {
            const instance = getInstance(key);
            return instance?.editor ? serializeEditorHtml(instance.editor) : '';
        },
        syncHiddenInput(key, invokeCallback = true) {
            syncHiddenInput(getInstance(key), invokeCallback);
        },
        insertFormat(key, tag) {
            execCommand(key, tag === 'b' ? 'bold' : tag === 'i' ? 'italic' : 'underline');
        },
        applyTextAlign(key, align) {
            const commands = {
                left: 'justifyLeft',
                center: 'justifyCenter',
                right: 'justifyRight'
            };
            execCommand(key, commands[align] || 'justifyCenter');
            getInstance(key)?.alignPicker?.classList.remove('active');
        },
        toggleAlignPicker(key) {
            togglePicker(key, 'align');
        },
        insertLink(key) {
            let url = prompt('请输入链接地址:', 'https://');
            if (!url) return;
            url = url.trim();
            if (!url || url === 'https://') return;
            if (!/^https?:\/\//i.test(url)) {
                url = `https://${url.replace(/^\/+/, '')}`;
            }
            execCommand(key, 'createLink', url);
        },
        selectEmoji(key, emoji) {
            execCommand(key, 'insertText', emoji);
            getInstance(key)?.emojiPicker?.classList.remove('active');
        },
        toggleEmojiPicker(key) {
            togglePicker(key, 'emoji');
        },
        toggleDropdown,
        selectColor(key, color) {
            execCommand(key, 'foreColor', color);
            const instance = getInstance(key);
            updateColorUI(instance, color);
            closeDropdownElement(instance?.dropdowns?.color);
        },
        selectFontSize(key, size, sizeClass) {
            execCommand(key, 'fontSize', size);
            const instance = getInstance(key);
            updateSizeUI(instance, size, sizeClass);
            closeDropdownElement(instance?.dropdowns?.size);
        }
    };
})();

window.AdminRichTextEditor = AdminRichTextEditor;

AdminRichTextEditor.register({
    key: 'announcement',
    editorId: 'cfgAnnouncementContent',
    toolbarRootId: 'announcementToolbar',
    emojiPickerId: 'emojiPicker',
    emojiButtonId: 'emojiPickerBtn',
    alignPickerId: 'alignPicker',
    alignButtonId: 'alignPickerBtn',
    colorDropdownId: 'colorDropdown',
    colorPreviewId: 'colorPreview',
    sizeDropdownId: 'sizeDropdown',
    sizePreviewId: 'sizePreview',
    onInput: () => updateAnnouncementPreview()
});

function insertFormat(tag) {
    AdminRichTextEditor.insertFormat('announcement', tag);
}

function applyTextColor(color) {
    if (!color) return;
    AdminRichTextEditor.selectColor('announcement', color);
}

function applyTextSize(size) {
    if (!size) return;
    const sizeClass = size === '2' ? 'small' : size === '5' ? 'large' : 'medium';
    AdminRichTextEditor.selectFontSize('announcement', size, sizeClass);
}

function applyTextAlign(align) {
    AdminRichTextEditor.applyTextAlign('announcement', align);
}

function toggleAlignPicker() {
    AdminRichTextEditor.toggleAlignPicker('announcement');
}

function insertLink() {
    AdminRichTextEditor.insertLink('announcement');
}

function selectEmoji(emoji) {
    AdminRichTextEditor.selectEmoji('announcement', emoji);
}

function toggleEmojiPicker() {
    AdminRichTextEditor.toggleEmojiPicker('announcement');
}

// ============================================
// CUSTOM DROPDOWN FUNCTIONS
// ============================================

function toggleDropdown(dropdownId) {
    if (dropdownId === 'colorDropdown') {
        AdminRichTextEditor.toggleDropdown('announcement', 'color');
        return;
    }
    if (dropdownId === 'sizeDropdown') {
        AdminRichTextEditor.toggleDropdown('announcement', 'size');
        return;
    }

    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const trigger = dropdown.querySelector('.dropdown-trigger, .toolbar-btn');
    const menu = dropdown.querySelector('.dropdown-menu');
    const shouldOpen = !menu?.classList.contains('show');

    document.querySelectorAll('.custom-dropdown, .toolbar-dropdown').forEach(dd => {
        if (dd.id !== dropdownId) {
            dd.querySelector('.dropdown-trigger, .toolbar-btn')?.classList.remove('active');
            dd.querySelector('.dropdown-menu')?.classList.remove('show');
        }
    });

    trigger?.classList.toggle('active', shouldOpen);
    menu?.classList.toggle('show', shouldOpen);
}

function selectColor(color) {
    AdminRichTextEditor.selectColor('announcement', color);
}

function selectFontSize(size, sizeClass) {
    AdminRichTextEditor.selectFontSize('announcement', size, sizeClass);
}

document.addEventListener('click', (e) => {
    document.querySelectorAll('.emoji-picker-container').forEach(container => {
        const picker = container.querySelector('.emoji-picker');
        const btn = container.querySelector('.toolbar-btn');
        if (picker && btn && !picker.contains(e.target) && !btn.contains(e.target)) {
            picker.classList.remove('active');
        }
    });

    document.querySelectorAll('.align-picker-container').forEach(container => {
        const picker = container.querySelector('.align-picker');
        const btn = container.querySelector('.toolbar-btn');
        if (picker && btn && !picker.contains(e.target) && !btn.contains(e.target)) {
            picker.classList.remove('active');
        }
    });

    document.querySelectorAll('.custom-dropdown, .toolbar-dropdown').forEach(dropdown => {
        if (!dropdown.contains(e.target)) {
            dropdown.querySelector('.dropdown-trigger, .toolbar-btn')?.classList.remove('active');
            dropdown.querySelector('.dropdown-menu')?.classList.remove('show');
        }
    });
});

// ============================================
// MODERATION SETTINGS
// ============================================

function renderModerationConfig() {
    const config = systemConfigCache['moderation'] || {
        auto_filter: false,
        sensitive_words: [],
        ai_content_detection: false
    };

    // Auto filter toggle
    const autoFilter = document.getElementById('cfgAutoFilter');
    if (autoFilter) autoFilter.checked = config.auto_filter || false;

    // Sensitive words
    const sensitiveWords = document.getElementById('cfgSensitiveWords');
    if (sensitiveWords) {
        const words = config.sensitive_words || [];
        sensitiveWords.value = words.join('\n');
    }

    // AI content detection toggle
    const aiDetection = document.getElementById('cfgAiContentDetection');
    if (aiDetection) aiDetection.checked = config.ai_content_detection || false;
}

function renderGalleryConfig() {
    const config = systemConfigCache['gallery'] || {
        items_per_page: 24,
        default_sort: 'newest'
    };

    // Per page dropdown
    const perPageValue = document.getElementById('perPageValue');
    if (perPageValue) perPageValue.textContent = config.items_per_page || 24;

    // Default sort dropdown
    const sortValue = document.getElementById('defaultSortValue');
    const sortLabels = { newest: '最新', popular: '最热', random: '随机' };
    if (sortValue) sortValue.textContent = sortLabels[config.default_sort] || '最新';
}

function renderCommentRulesConfig() {
    const config = systemConfigCache['comments'] || {
        allow_anonymous: false,
        max_comment_length: 500,
        max_nesting_level: 3
    };

    // Allow anonymous toggle
    const allowAnonymous = document.getElementById('cfgAllowAnonymous');
    if (allowAnonymous) allowAnonymous.checked = config.allow_anonymous || false;

    // Max comment length
    const maxLength = document.getElementById('cfgMaxCommentLength');
    if (maxLength) maxLength.value = config.max_comment_length || 500;

    // Max nesting level
    const maxNesting = document.getElementById('cfgMaxNestingLevel');
    if (maxNesting) maxNesting.value = config.max_nesting_level || 3;
}

// ============================================
// VERIFICATION SERVICE CONFIG
// ============================================

function renderVerifyConfig() {
    const config = systemConfigCache['verify_settings'] || {
        price_per_verify: 10,
        enabled: true,
        verify_api_key: '',
        verify_api_base_url: ''
    };

    // Price input
    const priceInput = document.getElementById('cfgVerifyPrice');
    if (priceInput) priceInput.value = config.price_per_verify || 10;

    // Enabled toggle
    const enabledToggle = document.getElementById('cfgVerifyEnabled');
    if (enabledToggle) enabledToggle.checked = config.enabled !== false;

    // API Key (show masked for security)
    const apiKeyInput = document.getElementById('cfgVerifyApiKey');
    if (apiKeyInput) {
        if (config.verify_api_key) {
            const key = config.verify_api_key;
            apiKeyInput.value = key.length > 8 ? key.slice(0, 8) + '...' : key;
            apiKeyInput.dataset.hasKey = 'true';
        } else {
            apiKeyInput.value = '';
            delete apiKeyInput.dataset.hasKey;
        }
    }

    const apiBaseInput = document.getElementById('cfgVerifyApiBase');
    if (apiBaseInput) {
        apiBaseInput.value = String(config.verify_api_base_url || '').trim().replace(/\/+$/, '');
    }

    renderVerifyMonitorPanel();
    refreshVerifyMonitor();
}

const REFRESH_INTERVAL_LABELS = {
    60000: '1 分钟',
    180000: '3 分钟',
    300000: '5 分钟',
    600000: '10 分钟',
    900000: '15 分钟',
    1800000: '30 分钟'
};

const AI_SERVICE_LABELS = {
    gemini: 'Gemini',
    openai: 'OpenAI',
    claude: 'Claude'
};

const CACHE_DURATION_LABELS = {
    3600: '1 小时',
    86400: '1 天',
    604800: '1 周'
};

function applyCustomDropdownValue(dropdownId, value, label) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const valueEl = dropdown.querySelector('.dropdown-value');
    if (valueEl) valueEl.textContent = label;

    dropdown.querySelectorAll('.dropdown-option').forEach((option) => {
        option.classList.toggle('selected', String(option.dataset.value) === String(value));
    });
}

function renderGeneralSettingsConfig() {
    const analyticsConfig = normalizeAnalyticsPreferencesConfig(systemConfigCache['analytics_preferences']);
    const integrationsConfig = normalizeIntegrationsConfig(systemConfigCache['integrations']);
    const seoConfig = normalizeSeoConfig(systemConfigCache['seo']);
    const performanceConfig = normalizePerformanceConfig(systemConfigCache['performance']);

    systemConfigCache['analytics_preferences'] = analyticsConfig;
    systemConfigCache['integrations'] = integrationsConfig;
    systemConfigCache['seo'] = seoConfig;
    systemConfigCache['performance'] = performanceConfig;

    applyCustomDropdownValue(
        'refreshIntervalDropdown',
        analyticsConfig.refresh_interval_ms,
        REFRESH_INTERVAL_LABELS[analyticsConfig.refresh_interval_ms] || REFRESH_INTERVAL_LABELS[300000]
    );

    const googleLoginToggle = document.getElementById('cfgGoogleLogin');
    if (googleLoginToggle) googleLoginToggle.checked = integrationsConfig.google_login_enabled;

    const wechatLoginToggle = document.getElementById('cfgWechatLogin');
    if (wechatLoginToggle) wechatLoginToggle.checked = integrationsConfig.wechat_login_enabled;

    const realtimeToggle = document.getElementById('cfgSupabaseRealtime');
    if (realtimeToggle) realtimeToggle.checked = integrationsConfig.supabase_realtime_enabled;

    applyCustomDropdownValue(
        'aiServiceDropdown',
        integrationsConfig.ai_service,
        AI_SERVICE_LABELS[integrationsConfig.ai_service] || AI_SERVICE_LABELS.gemini
    );

    const siteTitleInput = document.getElementById('cfgSiteTitle');
    if (siteTitleInput) siteTitleInput.value = seoConfig.site_title;

    const siteDescriptionInput = document.getElementById('cfgSiteDescription');
    if (siteDescriptionInput) siteDescriptionInput.value = seoConfig.site_description;

    const siteKeywordsInput = document.getElementById('cfgSiteKeywords');
    if (siteKeywordsInput) siteKeywordsInput.value = seoConfig.site_keywords;

    const lazyLoadToggle = document.getElementById('cfgLazyLoad');
    if (lazyLoadToggle) lazyLoadToggle.checked = performanceConfig.lazy_load_enabled;

    const imageQualityInput = document.getElementById('cfgImageQuality');
    if (imageQualityInput) imageQualityInput.value = performanceConfig.image_quality;

    const imageQualityValue = document.getElementById('cfgImageQualityValue');
    if (imageQualityValue) imageQualityValue.textContent = `${performanceConfig.image_quality}%`;

    applyCustomDropdownValue(
        'cacheDurationDropdown',
        performanceConfig.cache_duration_seconds,
        CACHE_DURATION_LABELS[performanceConfig.cache_duration_seconds] || CACHE_DURATION_LABELS[86400]
    );
}

async function saveVerifyConfig() {
    const priceInput = document.getElementById('cfgVerifyPrice');
    const enabledToggle = document.getElementById('cfgVerifyEnabled');
    const apiKeyInput = document.getElementById('cfgVerifyApiKey');
    const apiBaseInput = document.getElementById('cfgVerifyApiBase');

    const config = systemConfigCache['verify_settings'] || {};

    // Update price
    if (priceInput) {
        config.price_per_verify = parseInt(priceInput.value) || 10;
    }

    // Update enabled
    if (enabledToggle) {
        config.enabled = enabledToggle.checked;
    }

    // Update API key only if it was changed (not masked)
    if (apiKeyInput && !apiKeyInput.value.includes('...')) {
        const newKey = apiKeyInput.value.trim();
        if (newKey) {
            config.verify_api_key = newKey;
        }
    }

    if (apiBaseInput) {
        config.verify_api_base_url = String(apiBaseInput.value || '').trim().replace(/\/+$/, '');
        apiBaseInput.value = config.verify_api_base_url;
    }

    const success = await saveConfig('verify_settings', config);

    if (success && typeof showToast === 'function') {
        showToast('Google One API 配置已保存', 'success');
    }

    // Update cache
    systemConfigCache['verify_settings'] = config;
    renderVerifyMonitorPanel();
    refreshVerifyMonitor(true).catch((error) => {
        console.warn('[Config] Verify monitor refresh after save failed:', error.message);
    });
}

// Expose globally for HTML onclick handlers
window.saveVerifyConfig = saveVerifyConfig;

function showStandaloneSaveIndicator(elementId, text = '✓ 已保存') {
    const indicator = document.getElementById(elementId);
    if (!indicator) return;

    showAdminConfigSaveIndicator(indicator, text, 1500);
}

async function saveSeoSettings() {
    const defaults = getDefaultSeoConfig();
    const config = {
        site_title: document.getElementById('cfgSiteTitle')?.value.trim() || defaults.site_title,
        site_description: document.getElementById('cfgSiteDescription')?.value.trim() || defaults.site_description,
        site_keywords: document.getElementById('cfgSiteKeywords')?.value.trim() || defaults.site_keywords
    };

    if (await saveConfig('seo', config)) {
        renderGeneralSettingsConfig();
        showStandaloneSaveIndicator('seoSaveIndicator');
    }
}

function downloadExportBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function escapeCsvCell(value) {
    const normalized = value == null
        ? ''
        : (typeof value === 'string'
            ? value
            : JSON.stringify(value));
    return `"${String(normalized).replace(/"/g, '""')}"`;
}

function convertRowsToCsv(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return '';
    }

    const headers = [...rows.reduce((keys, row) => {
        Object.keys(row || {}).forEach((key) => keys.add(key));
        return keys;
    }, new Set())];

    const lines = [
        headers.join(','),
        ...rows.map((row) => headers.map((key) => escapeCsvCell(row?.[key])).join(','))
    ];

    return lines.join('\n');
}

async function fetchAllSupabaseRows(buildQuery, pageSize = 1000) {
    const rows = [];
    let from = 0;

    while (true) {
        const { data, error } = await buildQuery().range(from, from + pageSize - 1);
        if (error) throw error;

        rows.push(...(data || []));

        if (!data || data.length < pageSize) {
            break;
        }

        from += pageSize;
    }

    return rows;
}

function toUniqueExportIds(values = []) {
    return Array.from(new Set(
        (values || [])
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    ));
}

async function fetchSupabaseRowsByIds(table, idField, ids, selectFields, { siteScoped = false } = {}) {
    const normalizedIds = toUniqueExportIds(ids);
    if (!normalizedIds.length) {
        return [];
    }

    const results = [];
    const chunkSize = 200;

    for (let index = 0; index < normalizedIds.length; index += chunkSize) {
        const chunk = normalizedIds.slice(index, index + chunkSize);
        let query = window.supabaseClient
            .from(table)
            .select(selectFields)
            .in(idField, chunk);

        if (siteScoped) {
            query = window.AdminSiteFilter?.applySiteFilter?.(query) || query;
        }

        const { data, error } = await query;
        if (error) throw error;
        results.push(...(data || []));
    }

    return results;
}

async function fetchUsersExportRows() {
    let profiles = [];
    const { data: rpcData, error: rpcError } = await window.supabaseClient.rpc('get_admin_users');

    if (!rpcError && Array.isArray(rpcData)) {
        profiles = rpcData;
    } else {
        const { data: profileData, error: profileError } = await window.supabaseClient
            .from('profiles')
            .select('id, username, email, avatar_url, created_at, updated_at');

        if (profileError) throw profileError;
        profiles = profileData || [];
    }

    let balanceQuery = window.supabaseClient
        .from('points_balance')
        .select('user_id, total_balance');
    balanceQuery = window.AdminSiteFilter?.applySiteFilter?.(balanceQuery) || balanceQuery;

    const [{ data: pointsData, error: pointsError }, { data: rolesData, error: rolesError }] = await Promise.all([
        balanceQuery,
        window.supabaseClient.from('admin_roles').select('user_id, role_name, expires_at')
    ]);

    if (pointsError) throw pointsError;
    if (rolesError) throw rolesError;

    const siteFilter = window.AdminSiteFilter?.getSiteParam?.();
    if (siteFilter) {
        const [loginResult, commentResult, messageResult] = await Promise.all([
            window.supabaseClient.from('user_login_history').select('user_id').eq('site', siteFilter),
            window.supabaseClient.from('prompt_comments').select('user_id').eq('site', siteFilter).not('user_id', 'is', null),
            window.supabaseClient.from('guestbook_messages').select('user_id').eq('site', siteFilter).not('user_id', 'is', null)
        ]);

        const activeUserIds = new Set();
        (loginResult.data || []).forEach((row) => activeUserIds.add(row.user_id));
        (commentResult.data || []).forEach((row) => activeUserIds.add(row.user_id));
        (messageResult.data || []).forEach((row) => activeUserIds.add(row.user_id));
        (pointsData || []).forEach((row) => activeUserIds.add(row.user_id));

        profiles = profiles.filter((profile) => activeUserIds.has(profile.out_id || profile.id));
    }

    const pointsMap = new Map((pointsData || []).map((row) => [row.user_id, row.total_balance || 0]));
    const rolesMap = new Map(
        (rolesData || [])
            .filter((row) => !row.expires_at || new Date(row.expires_at) > new Date())
            .map((row) => [row.user_id, row.role_name || 'admin'])
    );

    return profiles.map((profile) => {
        const id = profile.out_id || profile.id;
        const email = profile.out_email || profile.email || '';
        const username = profile.out_username || profile.username || '';
        const avatarUrl = profile.out_avatar_url || profile.avatar_url || '';
        const lastActiveAt = profile.out_last_active_at || profile.out_last_sign_in_at || profile.last_sign_in_at || '';
        const createdAt = profile.out_created_at || profile.created_at || '';

        return {
            id,
            username,
            email,
            avatar_url: avatarUrl,
            current_points: pointsMap.get(id) || 0,
            admin_role: rolesMap.get(id) || '',
            last_active_at: lastActiveAt,
            created_at: createdAt
        };
    });
}

async function fetchCommentsExportRows() {
    const [guestbookRows, galleryRows] = await Promise.all([
        fetchAllSupabaseRows(() => {
            let query = window.supabaseClient
                .from('guestbook_messages')
                .select(`
                    id,
                    content,
                    user_id,
                    created_at,
                    image_url,
                    like_count,
                    site
                `)
                .order('created_at', { ascending: false });
            query = window.AdminSiteFilter?.applySiteFilter?.(query) || query;
            return query;
        }),
        fetchAllSupabaseRows(() => {
            let query = window.supabaseClient
                .from('prompt_comments')
                .select(`
                    id,
                    content,
                    user_id,
                    created_at,
                    image_url,
                    parent_id,
                    prompt_id,
                    is_pinned,
                    is_featured,
                    site
                `)
                .order('created_at', { ascending: false });
            query = window.AdminSiteFilter?.applySiteFilter?.(query) || query;
            return query;
        })
    ]);

    const guestbookUserIds = toUniqueExportIds((guestbookRows || []).map((row) => row.user_id));
    const galleryUserIds = toUniqueExportIds((galleryRows || []).map((row) => row.user_id));
    const promptIds = toUniqueExportIds((galleryRows || []).map((row) => row.prompt_id));
    const galleryCommentIds = toUniqueExportIds((galleryRows || []).map((row) => row.id));

    const [guestbookProfiles, galleryProfiles, prompts, commentLikes] = await Promise.all([
        fetchSupabaseRowsByIds('profiles', 'id', guestbookUserIds, 'id, username, avatar_url, email'),
        fetchSupabaseRowsByIds('profiles', 'id', galleryUserIds, 'id, username, avatar_url, email'),
        fetchSupabaseRowsByIds('prompts', 'id', promptIds, 'id, title'),
        fetchSupabaseRowsByIds('comment_likes', 'comment_id', galleryCommentIds, 'comment_id', { siteScoped: true })
    ]);

    const guestbookProfilesMap = new Map(guestbookProfiles.map((row) => [row.id, row]));
    const galleryProfilesMap = new Map(galleryProfiles.map((row) => [row.id, row]));
    const promptMap = new Map(prompts.map((row) => [row.id, row]));
    const commentLikesMap = (commentLikes || []).reduce((acc, row) => {
        const key = String(row?.comment_id || '').trim();
        if (!key) return acc;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    return [
        ...(guestbookRows || []).map((row) => ({
            id: row.id,
            type: 'guestbook',
            site: row.site || '',
            author: guestbookProfilesMap.get(row.user_id)?.username || '未知用户',
            email: guestbookProfilesMap.get(row.user_id)?.email || '',
            content: row.content || '',
            likes: row.like_count || 0,
            user_id: row.user_id || '',
            prompt_title: '',
            parent_id: '',
            image_url: row.image_url || '',
            created_at: row.created_at
        })),
        ...(galleryRows || []).map((row) => ({
            id: row.id,
            type: 'gallery',
            site: row.site || '',
            author: galleryProfilesMap.get(row.user_id)?.username || '未知用户',
            email: galleryProfilesMap.get(row.user_id)?.email || '',
            content: row.content || '',
            likes: commentLikesMap[row.id] || 0,
            user_id: row.user_id || '',
            prompt_title: promptMap.get(row.prompt_id)?.title || '',
            parent_id: row.parent_id || '',
            image_url: row.image_url || '',
            is_pinned: row.is_pinned === true,
            is_featured: row.is_featured === true,
            created_at: row.created_at
        }))
    ].sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
}

async function fetchPointsExportRows() {
    return fetchAllSupabaseRows(() => {
        let query = window.supabaseClient
            .from('points_ledger')
            .select('*')
            .order('created_at', { ascending: false });
        query = window.AdminSiteFilter?.applySiteFilter?.(query) || query;
        return query;
    });
}

async function exportSettingsData(dataset, format = 'json') {
    const normalizedDataset = String(dataset || '').trim();
    const normalizedFormat = String(format || 'json').trim().toLowerCase();

    const loaders = {
        users: fetchUsersExportRows,
        comments: fetchCommentsExportRows,
        points: fetchPointsExportRows
    };

    const loadRows = loaders[normalizedDataset];
    if (!loadRows) {
        throw new Error(`不支持的导出类型: ${normalizedDataset}`);
    }

    try {
        const rows = await loadRows();
        if (!Array.isArray(rows) || rows.length === 0) {
            window.showToast?.('暂无可导出的数据', 'info');
            return;
        }

        const timestamp = new Date().toISOString().slice(0, 10);
        if (normalizedFormat === 'csv') {
            const csv = convertRowsToCsv(rows);
            downloadExportBlob(
                new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }),
                `${normalizedDataset}_export_${timestamp}.csv`
            );
        } else {
            downloadExportBlob(
                new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }),
                `${normalizedDataset}_export_${timestamp}.json`
            );
        }

        window.showToast?.(`已导出 ${rows.length} 条${normalizedDataset === 'users' ? '用户' : (normalizedDataset === 'comments' ? '评论' : '积分')}数据`, 'success');
    } catch (err) {
        console.error('Export settings data failed:', err);
        window.showToast?.(`导出失败: ${err.message}`, 'error');
    }
}

async function checkVerifyQuota() {
    const quotaEl = document.getElementById('cfgVerifyQuota');
    if (!quotaEl) return;

    verifyMonitorState.quota = {
        ...(verifyMonitorState.quota || getDefaultVerifyMonitorState().quota),
        status: 'loading',
        message: '查询中...'
    };
    renderVerifyQuotaState(quotaEl, 'neutral', 'fas fa-spinner fa-spin', '查询中...');
    renderVerifyMonitorPanel();

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
        ? window.setTimeout(() => controller.abort(), VERIFY_MONITOR_FETCH_TIMEOUT_MS)
        : 0;

    try {
        const headers = await getAdminConfigApiHeaders();
        const res = await fetch('/api/admin/settings/verify-monitor/quota', {
            method: 'GET',
            headers,
            signal: controller?.signal
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success) {
            const balance = Number(data.balance ?? data.credits ?? 0);
            const tone = balance > 5 ? 'success' : balance > 0 ? 'warning' : 'danger';
            const display = Number.isInteger(balance) ? balance : balance.toFixed(1);
            renderVerifyQuotaState(quotaEl, tone, 'fas fa-gem', display, { emphasized: true });
            verifyMonitorState.quota = {
                status: 'ready',
                balance,
                total_used: Number(data.total_used || 0),
                cost_per_job: Number(data.cost_per_job || 0),
                key_name: String(data.key_name || '').trim(),
                checked_at: new Date().toISOString(),
                message: ''
            };
        } else {
            const message = data.message || '查询失败';
            renderVerifyQuotaState(quotaEl, 'danger', 'fas fa-exclamation-triangle', message);
            verifyMonitorState.quota = {
                ...(getDefaultVerifyMonitorState().quota),
                status: 'error',
                checked_at: new Date().toISOString(),
                message
            };
        }
    } catch (error) {
        const message = error?.name === 'AbortError'
            ? '查询超时'
            : (error.message || '网络错误');
        renderVerifyQuotaState(quotaEl, 'danger', 'fas fa-exclamation-triangle', message);
        verifyMonitorState.quota = {
            ...(getDefaultVerifyMonitorState().quota),
            status: 'error',
            checked_at: new Date().toISOString(),
            message
        };
    } finally {
        if (timeoutId) {
            window.clearTimeout(timeoutId);
        }
    }

    renderVerifyMonitorPanel();
    return verifyMonitorState.quota;
}

async function loadVerifyQueueState() {
    verifyMonitorState.queue = {
        ...(verifyMonitorState.queue || getDefaultVerifyMonitorState().queue),
        status: 'loading',
        message: '查询中...'
    };
    renderVerifyMonitorPanel();

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
        ? window.setTimeout(() => controller.abort(), VERIFY_MONITOR_FETCH_TIMEOUT_MS)
        : 0;

    try {
        const headers = await getAdminConfigApiHeaders();
        const response = await fetch('/api/admin/settings/verify-monitor/queue', {
            method: 'GET',
            headers,
            signal: controller?.signal
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '查询队列失败');
        }

        verifyMonitorState.queue = {
            status: 'ready',
            queue_size: Number(payload.queue_size || 0),
            running_jobs: Number(payload.running_jobs || 0),
            key_name: String(payload.key_name || '').trim(),
            api_base_url: String(payload.api_base_url || '').trim(),
            checked_at: new Date().toISOString(),
            message: ''
        };
    } catch (error) {
        const message = error?.name === 'AbortError'
            ? '查询队列超时，请稍后重试'
            : (error.message || '查询队列失败');
        verifyMonitorState.queue = {
            ...(getDefaultVerifyMonitorState().queue),
            status: 'error',
            checked_at: new Date().toISOString(),
            message
        };
    } finally {
        if (timeoutId) {
            window.clearTimeout(timeoutId);
        }
    }

    renderVerifyMonitorPanel();
    return verifyMonitorState.queue;
}

async function loadVerifyMonitor(force = false) {
    if (loadVerifyMonitor._loadingPromise && !force) {
        return loadVerifyMonitor._loadingPromise;
    }

    verifyMonitorState.recent = {
        ...(verifyMonitorState.recent || getDefaultVerifyMonitorState().recent),
        status: 'loading',
        message: '正在加载...'
    };
    renderVerifyMonitorPanel();

    loadVerifyMonitor._loadingPromise = (async () => {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeoutId = controller
            ? window.setTimeout(() => controller.abort(), VERIFY_MONITOR_FETCH_TIMEOUT_MS)
            : 0;
        try {
            const headers = await getAdminConfigApiHeaders();
            const response = await fetch('/api/admin/settings/verify-monitor', {
                method: 'GET',
                headers,
                signal: controller?.signal
            });
            const payload = await response.json().catch(() => ({}));

            if (!response.ok || !payload.success) {
                throw new Error(payload.message || '加载验证运维数据失败');
            }

            verifyMonitorState.recent = {
                status: 'ready',
                fetched_at: String(payload.fetched_at || '').trim(),
                summary: payload.summary || getDefaultVerifyMonitorState().recent.summary,
                recent_tasks: Array.isArray(payload.recent_tasks) ? payload.recent_tasks : [],
                recent_failures: Array.isArray(payload.recent_failures) ? payload.recent_failures : [],
                message: ''
            };
            renderVerifyMonitorPanel();
            return payload;
        } catch (error) {
            const message = error?.name === 'AbortError'
                ? '加载验证运维数据超时，请稍后重试'
                : (error.message || '加载验证运维数据失败');
            console.warn('[Config] Verify monitor load failed:', message);
            verifyMonitorState.recent = {
                ...getDefaultVerifyMonitorState().recent,
                status: 'error',
                message
            };
            renderVerifyMonitorPanel();
            return null;
        } finally {
            if (timeoutId) {
                window.clearTimeout(timeoutId);
            }
        }
    })();

    try {
        return await loadVerifyMonitor._loadingPromise;
    } finally {
        loadVerifyMonitor._loadingPromise = null;
    }
}

async function refreshVerifyMonitor(force = false) {
    if (refreshVerifyMonitor._loadingPromise && !force) {
        return refreshVerifyMonitor._loadingPromise;
    }

    refreshVerifyMonitor._loadingPromise = (async () => {
        await Promise.allSettled([
            checkVerifyQuota(),
            loadVerifyQueueState(),
            loadVerifyMonitor(force)
        ]);
        renderVerifyMonitorPanel();
        return verifyMonitorState;
    })();

    try {
        return await refreshVerifyMonitor._loadingPromise;
    } finally {
        refreshVerifyMonitor._loadingPromise = null;
    }
}

async function loadAdminAuditMonitor(force = false) {
    if (loadAdminAuditMonitor._loadingPromise && !force) {
        return loadAdminAuditMonitor._loadingPromise;
    }

    adminAuditMonitorState = {
        ...(adminAuditMonitorState || getDefaultAdminAuditMonitorState()),
        status: 'loading',
        message: '正在加载...'
    };
    renderAdminAuditMonitorPanel();

    loadAdminAuditMonitor._loadingPromise = (async () => {
        try {
            const headers = await getAdminConfigApiHeaders();
            const response = await fetch('/api/admin/settings/admin-audit-monitor', {
                method: 'GET',
                headers
            });
            const payload = await response.json().catch(() => ({}));

            if (!response.ok || !payload.success) {
                throw new Error(payload.message || '加载管理员访问审计失败');
            }

            adminAuditMonitorState = {
                status: 'ready',
                fetched_at: String(payload.fetched_at || '').trim(),
                access_summary: payload.access_summary || getDefaultAdminAuditMonitorState().access_summary,
                config_summary: payload.config_summary || getDefaultAdminAuditMonitorState().config_summary,
                recent_accesses: Array.isArray(payload.recent_accesses) ? payload.recent_accesses : [],
                access_anomalies: Array.isArray(payload.access_anomalies) ? payload.access_anomalies : [],
                payment_config_events: Array.isArray(payload.payment_config_events) ? payload.payment_config_events : [],
                message: ''
            };
            renderAdminAuditMonitorPanel();
            return payload;
        } catch (error) {
            console.warn('[Config] Admin audit monitor load failed:', error.message);
            adminAuditMonitorState = {
                ...getDefaultAdminAuditMonitorState(),
                status: 'error',
                message: error.message || '加载管理员访问审计失败'
            };
            renderAdminAuditMonitorPanel();
            return null;
        }
    })();

    try {
        return await loadAdminAuditMonitor._loadingPromise;
    } finally {
        loadAdminAuditMonitor._loadingPromise = null;
    }
}

async function refreshAdminAuditMonitor(force = false) {
    if (refreshAdminAuditMonitor._loadingPromise && !force) {
        return refreshAdminAuditMonitor._loadingPromise;
    }

    refreshAdminAuditMonitor._loadingPromise = (async () => {
        const result = await loadAdminAuditMonitor(force);
        renderAdminAuditMonitorPanel();
        return result;
    })();

    try {
        return await refreshAdminAuditMonitor._loadingPromise;
    } finally {
        refreshAdminAuditMonitor._loadingPromise = null;
    }
}

window.checkVerifyQuota = checkVerifyQuota;
window.loadVerifyMonitor = loadVerifyMonitor;
window.refreshVerifyMonitor = refreshVerifyMonitor;
window.loadAdminAuditMonitor = loadAdminAuditMonitor;
window.refreshAdminAuditMonitor = refreshAdminAuditMonitor;

async function saveSensitiveWords() {
    const textarea = document.getElementById('cfgSensitiveWords');
    if (!textarea) return;

    const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l);
    const config = systemConfigCache['moderation'] || {};
    config.sensitive_words = lines;

    const success = await saveConfig('moderation', config);

    if (success && typeof showToast === 'function') {
        showToast('敏感词列表已保存', 'success');
    }
}

function setupModerationEventListeners() {
    // Auto filter toggle
    const autoFilter = document.getElementById('cfgAutoFilter');
    if (autoFilter) {
        autoFilter.addEventListener('change', async (e) => {
            const config = systemConfigCache['moderation'] || {};
            config.auto_filter = e.target.checked;
            await saveConfig('moderation', config);
        });
    }

    // AI content detection toggle
    const aiDetection = document.getElementById('cfgAiContentDetection');
    if (aiDetection) {
        aiDetection.addEventListener('change', async (e) => {
            const config = systemConfigCache['moderation'] || {};
            config.ai_content_detection = e.target.checked;
            await saveConfig('moderation', config);
        });
    }

    // Gallery settings
    setupGalleryEventListeners();

    // Comment rules
    setupCommentRulesEventListeners();
}

// ============================================
// GALLERY SETTINGS
// ============================================

function loadGallerySettings(config) {
    // Per page dropdown
    const perPageValue = document.getElementById('perPageValue');
    if (perPageValue && config.items_per_page) {
        perPageValue.textContent = config.items_per_page;
    }
}

function setupGalleryEventListeners() {
    // Gallery settings are saved via dropdown selection override
    // No additional event listeners needed for now
}

// Override dropdown selection to save gallery settings
const originalSelectDropdownOption = window.selectDropdownOption;
window.selectDropdownOption = function (dropdownId, value, displayText) {
    // Call original
    if (typeof originalSelectDropdownOption === 'function') {
        originalSelectDropdownOption(dropdownId, value, displayText);
    }

    // Handle gallery dropdowns
    if (dropdownId === 'perPageDropdown') {
        const config = systemConfigCache['gallery'] || {};
        config.items_per_page = parseInt(value);
        saveConfig('gallery', config);
    } else if (dropdownId === 'defaultSortDropdown') {
        const config = systemConfigCache['gallery'] || {};
        config.default_sort = value;
        saveConfig('gallery', config);
    } else if (dropdownId === 'refreshIntervalDropdown') {
        const config = normalizeAnalyticsPreferencesConfig(systemConfigCache['analytics_preferences']);
        config.refresh_interval_ms = parseInt(value, 10) || getDefaultAnalyticsPreferencesConfig().refresh_interval_ms;
        saveConfig('analytics_preferences', config);
    } else if (dropdownId === 'aiServiceDropdown') {
        const config = normalizeIntegrationsConfig(systemConfigCache['integrations']);
        config.ai_service = value;
        saveConfig('integrations', config);
    } else if (dropdownId === 'cacheDurationDropdown') {
        const config = normalizePerformanceConfig(systemConfigCache['performance']);
        config.cache_duration_seconds = parseInt(value, 10) || getDefaultPerformanceConfig().cache_duration_seconds;
        saveConfig('performance', config);
    }
};

// ============================================
// COMMENT RULES
// ============================================

function loadCommentRules(config) {
    // Allow anonymous toggle
    const allowAnonymous = document.getElementById('cfgAllowAnonymous');
    if (allowAnonymous) allowAnonymous.checked = config.allow_anonymous || false;

    // Max comment length
    const maxLength = document.getElementById('cfgMaxCommentLength');
    if (maxLength) maxLength.value = config.max_comment_length || 500;

    // Max nesting level
    const maxNesting = document.getElementById('cfgMaxNestingLevel');
    if (maxNesting) maxNesting.value = config.max_nesting_level || 3;
}

function setupCommentRulesEventListeners() {
    // Allow anonymous toggle
    const allowAnonymous = document.getElementById('cfgAllowAnonymous');
    if (allowAnonymous) {
        allowAnonymous.addEventListener('change', async (e) => {
            const config = systemConfigCache['comments'] || {};
            config.allow_anonymous = e.target.checked;
            await saveConfig('comments', config);
        });
    }

    // Max comment length
    const maxLength = document.getElementById('cfgMaxCommentLength');
    if (maxLength) {
        maxLength.addEventListener('change', async (e) => {
            const config = systemConfigCache['comments'] || {};
            config.max_comment_length = parseInt(e.target.value) || 500;
            await saveConfig('comments', config);
        });
    }

    // Max nesting level
    const maxNesting = document.getElementById('cfgMaxNestingLevel');
    if (maxNesting) {
        maxNesting.addEventListener('change', async (e) => {
            const config = systemConfigCache['comments'] || {};
            config.max_nesting_level = parseInt(e.target.value) || 3;
            await saveConfig('comments', config);
        });
    }
}

// ============================================
// DECORATION SYSTEM
// ============================================

let currentDecoration = 'none';

function toggleDecoration() {
    const checkbox = document.getElementById('decorationEnabled');
    const selector = document.getElementById('decorationSelector');

    if (checkbox && selector) {
        if (checkbox.checked) {
            selector.classList.add('active');
        } else {
            selector.classList.remove('active');
            // Clear decoration when disabled
            selectDecoration('none');
        }
    }
}

function selectDecoration(theme) {
    currentDecoration = theme;

    // Update button states
    document.querySelectorAll('.decoration-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.decoration === theme);
    });

    // Apply decoration to preview
    applyDecorationToPreview(theme);
}

// Apply decoration to preview stage
function applyDecorationToPreview(theme) {
    const preview = document.getElementById('announcementPreview');
    if (!preview) return;

    // Remove existing particles container
    const existingParticles = preview.querySelector('.decoration-particles');
    if (existingParticles) {
        existingParticles.remove();
    }

    // Remove existing heart container (specific to hearts theme)
    const existingHearts = preview.querySelectorAll('.heart-container');
    existingHearts.forEach(h => h.remove());

    // If no decoration selected, exit
    if (theme === 'none') {
        // Also ensure any running particle system is stopped
        if (window.stopContinuousParticles) {
            window.stopContinuousParticles();
        }
        return;
    }

    // Use the shared generator from prompts-poetry.js
    if (window.generateDecorationParticles) {
        // Insert HTML
        preview.insertAdjacentHTML('afterbegin', window.generateDecorationParticles(theme));

        // Start animation based on theme
        if (theme === 'hearts') {
            if (window.startHeartFloat) {
                // Ensure the hearts are positioned relative to the preview container
                window.startHeartFloat(preview);
            }
        } else {
            // Only use active JS ParticleSystem for complex physics themes
            // Sakura and Leaves use the CSS-based particles we generated
            const activePhysicsThemes = ['snow', 'rain', 'fireworks'];

            if (activePhysicsThemes.includes(theme)) {
                const particleContainer = preview.querySelector('.decoration-particles');
                if (particleContainer && window.startContinuousParticles) {
                    // Slight delay to ensure DOM is rendered and dimensions are available
                    setTimeout(() => {
                        window.startContinuousParticles(particleContainer, theme);
                    }, 50);
                }
            }
        }
    } else {
        console.warn('generateDecorationParticles not found. Ensure prompts-poetry.js is loaded.');
    }
}

// Get current decoration for saving
function getCurrentDecoration() {
    const checkbox = document.getElementById('decorationEnabled');
    if (!checkbox || !checkbox.checked) return 'none';
    return currentDecoration;
}

// ============================================
// PAGE TARGET SELECTOR FUNCTIONS
// ============================================

// Toggle page target selection
function togglePageTarget(page) {
    const selector = document.getElementById('pageTargetSelector');
    if (!selector) return;

    const allBtn = selector.querySelector('[data-page="all"]');
    const pageBtns = selector.querySelectorAll('[data-page]:not([data-page="all"])');
    const clickedBtn = selector.querySelector(`[data-page="${page}"]`);

    if (page === 'all') {
        // Toggle "all" - if clicking "all", select only "all" and deselect others
        if (allBtn.classList.contains('active')) {
            // Already selected, do nothing (must have at least one page)
            return;
        }
        // Select "all", deselect individual pages
        allBtn.classList.add('active');
        pageBtns.forEach(btn => btn.classList.remove('active'));
    } else {
        // Toggle individual page
        clickedBtn.classList.toggle('active');

        // If any individual page is selected, deselect "all"
        const anyPageSelected = Array.from(pageBtns).some(btn => btn.classList.contains('active'));
        if (anyPageSelected) {
            allBtn.classList.remove('active');
        } else {
            // No individual pages selected, auto-select "all"
            allBtn.classList.add('active');
        }

        // If all individual pages are selected, switch to "all"
        const allPagesSelected = Array.from(pageBtns).every(btn => btn.classList.contains('active'));
        if (allPagesSelected) {
            allBtn.classList.add('active');
            pageBtns.forEach(btn => btn.classList.remove('active'));
        }
    }
}

// Get selected pages from UI
function getSelectedPages() {
    const selector = document.getElementById('pageTargetSelector');
    if (!selector) return ['all'];

    const allBtn = selector.querySelector('[data-page="all"]');
    if (allBtn && allBtn.classList.contains('active')) {
        return ['all'];
    }

    const selectedPages = [];
    selector.querySelectorAll('[data-page]:not([data-page="all"])').forEach(btn => {
        if (btn.classList.contains('active')) {
            selectedPages.push(btn.dataset.page);
        }
    });

    return selectedPages.length > 0 ? selectedPages : ['all'];
}

// Restore page selector state from saved config
function restorePageSelector(pages) {
    const selector = document.getElementById('pageTargetSelector');
    if (!selector) return;

    // Clear all active states
    selector.querySelectorAll('.page-btn').forEach(btn => btn.classList.remove('active'));

    if (!pages || pages.length === 0 || pages.includes('all')) {
        // Select "all" button
        const allBtn = selector.querySelector('[data-page="all"]');
        if (allBtn) allBtn.classList.add('active');
    } else {
        // Select individual pages
        pages.forEach(page => {
            const btn = selector.querySelector(`[data-page="${page}"]`);
            if (btn) btn.classList.add('active');
        });
    }
}

// ============================================
// EXPORTS
// ============================================

window.initSystemConfig = initSystemConfig;
window.toggleConfigCard = toggleConfigCard;
window.toggleCustomRechargeEntryStatus = toggleCustomRechargeEntryStatus;
window.toggleMockPaymentStatus = toggleMockPaymentStatus;
window.togglePaymentProviderEnabled = togglePaymentProviderEnabled;
window.togglePaymentProviderPanel = togglePaymentProviderPanel;
window.handlePaymentChannelActiveChange = handlePaymentChannelActiveChange;
window.savePaymentChannelSettings = savePaymentChannelSettings;
Object.assign(window, {
    loadOpsAlertSettings,
    loadOpsAlertHealth,
    loadOpsAlertMonitor,
    toggleOpsAlertsEnabled,
    toggleOpsAlertChannelEnabled,
    toggleOpsAlertTemporaryMuteAllowCritical,
    setOpsAlertTemporaryMutePreset,
    clearOpsAlertTemporaryMute,
    toggleOpsAlertMuteRuleAllowCritical,
    clearOpsAlertMuteRule,
    toggleOpsAlertQuietHoursEnabled,
    toggleOpsAlertQuietHoursAllowCritical,
    toggleOpsAlertWorkHoursEnabled,
    toggleOpsAlertStrategyPanel,
    toggleOpsAlertSummaryPanel,
    openOpsAlertStrategyPanel,
    switchOpsAlertStrategyMuteTab,
    toggleOpsAlertDatePicker,
    changeOpsAlertDatePickerMonth,
    selectOpsAlertDatePickerDay,
    setOpsAlertDatePickerPreset,
    applyOpsAlertDatePicker,
    clearOpsAlertDatePicker,
    toggleOpsAlertShopRiskAutoResponseEnabled,
    toggleOpsAlertShopInventoryEnabled,
    toggleOpsAlertShopInventoryRecoveryNotificationEnabled,
    toggleOpsAlertShopInventorySummaryEnabled,
    handleOpsAlertShopInventorySummaryScheduleModeChange,
    toggleOpsAlertCustomerChatMessageEnabled,
    toggleOpsAlertCustomerChatMessageSummaryEnabled,
    toggleOpsAlertCustomerChatMessageWorkHoursOnlyEnabled,
    handleOpsAlertCustomerChatMessageSummaryScheduleModeChange,
    addOpsAlertCustomerChatQuickReplyTemplate,
    toggleOpsAlertShopPurchaseSuccessEnabled,
    toggleOpsAlertShopPurchaseSuccessSummaryEnabled,
    toggleOpsAlertShopPurchaseSuccessWorkHoursOnlyEnabled,
    handleOpsAlertShopPurchaseSuccessSummaryScheduleModeChange,
    toggleOpsAlertWalletRechargeSuccessEnabled,
    toggleOpsAlertWalletRechargeSuccessSummaryEnabled,
    toggleOpsAlertWalletRechargeSuccessWorkHoursOnlyEnabled,
    handleOpsAlertWalletRechargeSuccessSummaryScheduleModeChange,
    toggleOpsAlertTicketsEnabled,
    toggleOpsAlertTicketsSummaryEnabled,
    toggleOpsAlertTicketsWorkHoursOnlyEnabled,
    handleOpsAlertTicketsSummaryScheduleModeChange,
    toggleOpsAlertShopOrderDeliveryEnabled,
    toggleOpsAlertShopOrderDeliveryIncidentEnabled,
    toggleOpsAlertShopOrderDeliverySummaryEnabled,
    toggleOpsAlertShopOrderDeliveryWorkHoursOnlyEnabled,
    handleOpsAlertShopOrderDeliverySummaryScheduleModeChange,
    toggleOpsAlertVerifyQuotaEnabled,
    toggleOpsAlertVerifyQuotaSummaryEnabled,
    toggleOpsAlertVerifyQuotaWorkHoursOnlyEnabled,
    handleOpsAlertVerifyQuotaSummaryScheduleModeChange,
    toggleOpsAlertVerifyQueueEnabled,
    toggleOpsAlertVerifyQueueSummaryEnabled,
    toggleOpsAlertVerifyQueueWorkHoursOnlyEnabled,
    handleOpsAlertVerifyQueueSummaryScheduleModeChange,
    toggleOpsAlertVerifyFailureEnabled,
    toggleOpsAlertVerifyFailureSummaryEnabled,
    toggleOpsAlertVerifyFailureWorkHoursOnlyEnabled,
    handleOpsAlertVerifyFailureSummaryScheduleModeChange,
    toggleOpsAlertPaymentGatewayEnabled,
    toggleOpsAlertPaymentGatewaySummaryEnabled,
    toggleOpsAlertPaymentGatewayWorkHoursOnlyEnabled,
    handleOpsAlertPaymentGatewaySummaryScheduleModeChange,
    selectOpsAlertUnifiedSummaryTargets,
    handleOpsAlertUnifiedSummaryTargetChange,
    handleOpsAlertUnifiedSummaryDraftChange,
    applyOpsAlertUnifiedSummaryDraft,
    confirmOpsAlertStrategyNavigation,
    saveOpsAlertSettings,
    sendOpsAlertTelegramTest,
    sendOpsAlertRefundSample,
    sendOpsAlertCustomerChatMessageSample,
    sendOpsAlertShopPurchaseSucceededSample,
    sendOpsAlertWalletRechargeSucceededSample,
    sendOpsAlertGatewaySample,
    sendOpsAlertGatewayRecoveredSample,
    sendOpsAlertVerifyServiceDisabledSample,
    sendOpsAlertVerifyQueueBacklogSample,
    sendOpsAlertVerifyFailureRateSpikeSample,
    sendOpsAlertVerifyIncidentEscalatedSample,
    sendOpsAlertVerifyIncidentRecoveredSample,
    sendOpsAlertVerifyQuotaSample,
    sendOpsAlertTicketSlaSample,
    sendOpsAlertTicketSlaRecoveredSample,
    sendOpsAlertShopInventorySample,
    sendOpsAlertShopInventoryRecoveredSample,
    sendOpsAlertAdminLoginAnomalySample,
    sendOpsAlertShopOrderDeliveryFailedSample,
    sendOpsAlertShopOrderDeliveryIncidentSample,
    sendOpsAlertShopOrderDeliveryIncidentRecoveredSample,
    sendOpsAlertShopOrderDeliveryRecoveredSample,
    sendOpsAlertPaymentConfigChangedSample,
    sendOpsAlertPaymentConfigIncidentSample,
    sendOpsAlertPaymentConfigIncidentRecoveredSample,
    sendOpsAlertPaymentConfigRecoveredSample,
    refreshOpsAlertHealthPanel,
    scrollToOpsAlertHealthPanel,
    refreshOpsAlertMonitorPanel,
    setOpsAlertMonitorFilter,
    setOpsAlertMonitorShiftReportView,
    copyOpsAlertMonitorChecklist,
    exportOpsAlertMonitorCsv,
    copyOpsAlertMonitorShiftReportSummary,
    exportOpsAlertMonitorShiftReportCsv
});

window.schedulePendingOpsAlertWorkspaceRestore?.();

Object.assign(window, {
    handleOpsAlertCaseAction,
    handleOpsAlertMonitorBatchCaseAction,
    openOpsAlertBatchMuteModal,
    toggleOpsAlertBatchMuteAllowCritical,
    closeOpsAlertBatchMuteModal,
    submitOpsAlertBatchMuteModal,
    closeOpsAlertCaseComposer,
    submitOpsAlertCaseComposer,
    handleShopRiskAction,
    handleShopRiskCaseAction,
    closeShopRiskCaseComposer,
    submitShopRiskCaseComposer,
    deleteOpsAlertSecret
});
window.loadVerifyMonitor = loadVerifyMonitor;
window.refreshVerifyMonitor = refreshVerifyMonitor;
window.loadAdminAuditMonitor = loadAdminAuditMonitor;
window.refreshAdminAuditMonitor = refreshAdminAuditMonitor;
window.deleteChannel = deleteChannel;
window.addChannel = addChannel;
window.saveIpBlacklist = saveIpBlacklist;
window.saveAnnouncement = saveAnnouncement;
window.saveSensitiveWords = saveSensitiveWords;
window.saveSeoSettings = saveSeoSettings;
window.exportSettingsData = exportSettingsData;
window.toggleDecoration = toggleDecoration;
window.selectDecoration = selectDecoration;
window.togglePageTarget = togglePageTarget;
window.loadAffiliateSettings = loadAffiliateSettings;
window.saveAffiliateSetting = saveAffiliateSetting;
window.saveAffiliatePosterField = saveAffiliatePosterField;
window.selectAffiliatePosterTemplate = selectAffiliatePosterTemplate;
window.handleAffiliatePosterUpload = handleAffiliatePosterUpload;
window.resetAffiliatePosterBackground = resetAffiliatePosterBackground;
