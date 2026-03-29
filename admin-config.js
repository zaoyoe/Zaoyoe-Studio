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

function getDefaultOpsAlertMonitorState() {
    return {
        status: 'idle',
        fetched_at: '',
        summary: {
            lookback_hours: 7 * 24,
            total_job_count: 0,
            total_active_count: 0,
            total_critical_count: 0,
            active_category_count: 0
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
            summary_daily_minute: 0
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

function getOpsAlertUnifiedSummaryDraftConsensus(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const selectedDefinitions = getOpsAlertSummaryOrchestrationSelectedDefinitions();
    if (!selectedDefinitions.length) {
        return null;
    }

    const normalizedConfig = normalizeOpsAlertConfig(config);
    const defaults = getDefaultOpsAlertConfig();
    const selectedSections = selectedDefinitions.map((definition) => (
        normalizedConfig[definition.key] || defaults[definition.key] || {}
    ));
    const pickConsensusValue = (definitions, sections, resolver) => {
        if (!definitions.length || !sections.length) {
            return undefined;
        }

        const values = sections.map((section, index) => resolver(section, definitions[index]));
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
            (section) => normalizeOpsAlertSummaryScheduleMode(section.summary_schedule_mode, 'rolling_window')
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

function syncOpsAlertUnifiedSummaryDraftFromSelection(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts']), options = {}) {
    if (opsAlertUnifiedSummaryDraftDirty && options.force !== true) {
        return;
    }

    const consensus = getOpsAlertUnifiedSummaryDraftConsensus(config);
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

function collectOpsAlertUnifiedSummaryDraftFromForm() {
    return {
        summary_enabled: document.getElementById('opsAlertUnifiedSummaryDraftEnabled')?.checked === true,
        work_hours_only_enabled: document.getElementById('opsAlertUnifiedSummaryDraftWorkHoursOnlyEnabled')?.checked === true,
        summary_schedule_mode: normalizeOpsAlertSummaryScheduleMode(
            document.getElementById('opsAlertUnifiedSummaryDraftScheduleMode')?.value,
            'rolling_window'
        ),
        summary_window_minutes: clamp(
            toWholeNumber(document.getElementById('opsAlertUnifiedSummaryDraftWindowMinutes')?.value, 60),
            5,
            24 * 60
        ),
        summary_hourly_minute: clamp(
            toWholeNumber(document.getElementById('opsAlertUnifiedSummaryDraftHourlyMinute')?.value, 0),
            0,
            59
        ),
        summary_daily_hour: clamp(
            toWholeNumber(document.getElementById('opsAlertUnifiedSummaryDraftDailyHour')?.value, 9),
            0,
            23
        ),
        summary_daily_minute: clamp(
            toWholeNumber(document.getElementById('opsAlertUnifiedSummaryDraftDailyMinute')?.value, 0),
            0,
            59
        ),
        summary_max_items: clamp(
            toWholeNumber(document.getElementById('opsAlertUnifiedSummaryDraftMaxItems')?.value, 10),
            1,
            50
        )
    };
}

function getOpsAlertSummaryModeHintText(section = {}, options = {}) {
    const monitorEnabled = options.monitorEnabled !== false;
    const summaryEnabled = options.summaryEnabled !== false;
    if (!monitorEnabled) {
        return '当前主监控未启用，开启后才会按这里的节奏统一发送。';
    }
    if (!summaryEnabled) {
        return '当前未启用定时汇总，开启后才会按这里的节奏统一发送。';
    }

    const scheduleMode = normalizeOpsAlertSummaryScheduleMode(section.summary_schedule_mode, 'rolling_window');
    if (scheduleMode === 'hourly') {
        return `当前会在每小时 ${formatOpsAlertTimeNumber(section.summary_hourly_minute, 0, 59)} 分统一发送。`;
    }
    if (scheduleMode === 'daily') {
        return `当前会在每天 ${formatOpsAlertHourMinute(section.summary_daily_hour, section.summary_daily_minute)} 统一发送。`;
    }
    return `当前会把 ${formatVerifyMonitorInteger(section.summary_window_minutes || 0)} 分钟内的告警先合并，在窗口结束后统一发送。`;
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

function applyOpsAlertSummaryModePresentation(section = {}, ids = {}, options = {}) {
    const scheduleMode = normalizeOpsAlertSummaryScheduleMode(section.summary_schedule_mode, 'rolling_window');
    setOpsAlertSummaryModeRowVisibility(ids.summaryWindowMinutes, scheduleMode === 'rolling_window');
    setOpsAlertSummaryModeRowVisibility(ids.summaryHourlyMinute, scheduleMode === 'hourly');
    setOpsAlertSummaryModeRowVisibility(ids.summaryDailyHour, scheduleMode === 'daily');
    setOpsAlertSummaryModeRowVisibility(ids.summaryDailyMinute, scheduleMode === 'daily');

    const hintEl = ensureOpsAlertSummaryModeHintElement(ids);
    const hintCopyEl = hintEl?.querySelector('span');
    if (hintCopyEl) {
        hintCopyEl.textContent = getOpsAlertSummaryModeHintText(section, options);
    }
    if (hintEl) {
        hintEl.classList.toggle('is-disabled', options.summaryEnabled === false || options.monitorEnabled === false);
    }
}

function applyOpsAlertUnifiedSummaryDraftControls() {
    const draft = collectOpsAlertUnifiedSummaryDraftFromForm();
    const summaryEnabled = draft.summary_enabled === true;
    const scheduleModeInput = document.getElementById(OPS_ALERT_UNIFIED_SUMMARY_DRAFT_FIELD_IDS.summaryScheduleMode);
    const rollingWindowInput = document.getElementById(OPS_ALERT_UNIFIED_SUMMARY_DRAFT_FIELD_IDS.summaryWindowMinutes);
    const hourlyMinuteInput = document.getElementById(OPS_ALERT_UNIFIED_SUMMARY_DRAFT_FIELD_IDS.summaryHourlyMinute);
    const dailyHourInput = document.getElementById(OPS_ALERT_UNIFIED_SUMMARY_DRAFT_FIELD_IDS.summaryDailyHour);
    const dailyMinuteInput = document.getElementById(OPS_ALERT_UNIFIED_SUMMARY_DRAFT_FIELD_IDS.summaryDailyMinute);
    const summaryMaxItemsInput = document.getElementById(OPS_ALERT_UNIFIED_SUMMARY_DRAFT_FIELD_IDS.summaryMaxItems);
    const selectedCount = getOpsAlertSummaryOrchestrationSelectedDefinitions().length;
    const applyButton = document.querySelector('[data-admin-action="settings-apply-ops-alert-unified-summary-draft"]');

    if (scheduleModeInput) {
        scheduleModeInput.value = draft.summary_schedule_mode;
        scheduleModeInput.disabled = !summaryEnabled;
    }
    if (rollingWindowInput) {
        rollingWindowInput.value = String(draft.summary_window_minutes);
        rollingWindowInput.disabled = !summaryEnabled || draft.summary_schedule_mode !== 'rolling_window';
    }
    if (hourlyMinuteInput) {
        hourlyMinuteInput.value = String(draft.summary_hourly_minute);
        hourlyMinuteInput.disabled = !summaryEnabled || draft.summary_schedule_mode !== 'hourly';
    }
    if (dailyHourInput) {
        dailyHourInput.value = String(draft.summary_daily_hour);
        dailyHourInput.disabled = !summaryEnabled || draft.summary_schedule_mode !== 'daily';
    }
    if (dailyMinuteInput) {
        dailyMinuteInput.value = String(draft.summary_daily_minute);
        dailyMinuteInput.disabled = !summaryEnabled || draft.summary_schedule_mode !== 'daily';
    }
    if (summaryMaxItemsInput) {
        summaryMaxItemsInput.value = String(draft.summary_max_items);
        summaryMaxItemsInput.disabled = !summaryEnabled;
    }
    applyOpsAlertSummaryModePresentation(draft, OPS_ALERT_UNIFIED_SUMMARY_DRAFT_FIELD_IDS, {
        monitorEnabled: true,
        summaryEnabled
    });
    if (applyButton) {
        applyButton.disabled = selectedCount <= 0;
        applyButton.innerHTML = `<i class="fas fa-wand-magic-sparkles"></i> 应用到所选告警${selectedCount > 0 ? `（${escapeConfigHtml(formatVerifyMonitorInteger(selectedCount))} 类）` : ''}`;
    }
}

function renderOpsAlertSummaryOrchestration(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const defaults = getDefaultOpsAlertConfig();
    const workHours = normalizedConfig.work_hours || defaults.work_hours;
    let enabledMonitorCount = 0;
    let summaryEnabledCount = 0;
    let workHoursOnlyCount = 0;

    OPS_ALERT_SUMMARY_ORCHESTRATION_DEFINITIONS.forEach((definition) => {
        const section = normalizedConfig[definition.key] || defaults[definition.key] || {};
        const sweepIntervalMinutes = Math.max(1, Math.round(Number(section.sweep_interval_ms || 0) / 60000));
        const summaryDescription = formatOpsAlertSummaryScheduleDescription(section);

        if (section.enabled) {
            enabledMonitorCount += 1;
        }
        if (section.summary_enabled === true) {
            summaryEnabledCount += 1;
        }
        if (definition.supports_work_hours_only && section.work_hours_only_enabled === true) {
            workHoursOnlyCount += 1;
        }

        if (definition.key === 'shop_inventory') {
            setOpsAlertSummaryOrchestrationCell(
                definition.monitor_status_id,
                section.enabled ? 'success' : 'neutral',
                section.enabled ? '已启用' : '已关闭',
                section.enabled
                    ? `巡检 ${formatVerifyMonitorInteger(sweepIntervalMinutes)} 分钟，低库存阈值 ${formatVerifyMonitorInteger(section.low_stock_threshold || 0)}。`
                    : `库存巡检参数仍保留，阈值 ${formatVerifyMonitorInteger(section.low_stock_threshold || 0)}。`
            );
        } else if (definition.key === 'tickets') {
            setOpsAlertSummaryOrchestrationCell(
                definition.monitor_status_id,
                section.enabled ? 'success' : 'neutral',
                section.enabled ? '已启用' : '已关闭',
                section.enabled
                    ? `巡检 ${formatVerifyMonitorInteger(sweepIntervalMinutes)} 分钟，超时阈值 ${formatVerifyMonitorInteger(section.pending_overdue_minutes || 0)} 分钟。`
                    : `工单 SLA 阈值仍保留为 ${formatVerifyMonitorInteger(section.pending_overdue_minutes || 0)} 分钟。`
            );
        } else if (definition.key === 'shop_order_delivery') {
            setOpsAlertSummaryOrchestrationCell(
                definition.monitor_status_id,
                section.enabled ? 'success' : 'neutral',
                section.enabled ? '已启用' : '已关闭',
                section.enabled
                    ? `巡检 ${formatVerifyMonitorInteger(sweepIntervalMinutes)} 分钟，重试阈值 ${formatVerifyMonitorInteger(section.retry_waiting_min_attempts || 0)} 次，事故阈值 ${formatVerifyMonitorInteger(section.incident_min_order_count || 0)} 笔。`
                    : `履约异常阈值仍保留，重试 ${formatVerifyMonitorInteger(section.retry_waiting_min_attempts || 0)} 次触发。`
            );
        } else if (definition.key === 'payment_gateway') {
            setOpsAlertSummaryOrchestrationCell(
                definition.monitor_status_id,
                section.enabled ? 'success' : 'neutral',
                section.enabled ? '已启用' : '已关闭',
                section.enabled
                    ? `巡检 ${formatVerifyMonitorInteger(sweepIntervalMinutes)} 分钟，异常窗口 ${formatVerifyMonitorInteger(section.window_minutes || 0)} 分钟，失败阈值 ${formatVerifyMonitorInteger(section.min_failed_orders || 0)} 笔。`
                    : `支付通道异常阈值仍保留，窗口 ${formatVerifyMonitorInteger(section.window_minutes || 0)} 分钟。`
            );
        } else if (definition.key === 'verify_quota') {
            setOpsAlertSummaryOrchestrationCell(
                definition.monitor_status_id,
                section.enabled ? 'success' : 'neutral',
                section.enabled ? '已启用' : '已关闭',
                section.enabled
                    ? `巡检 ${formatVerifyMonitorInteger(sweepIntervalMinutes)} 分钟，低余额 ${formatVerifyMonitorInteger(section.low_balance_threshold || 0)} 点 / 低剩余 ${formatVerifyMonitorInteger(section.low_remaining_jobs_threshold || 0)} 次。`
                    : `验证额度阈值仍保留，低余额 ${formatVerifyMonitorInteger(section.low_balance_threshold || 0)} 点。`
            );
        } else if (definition.key === 'verify_queue') {
            setOpsAlertSummaryOrchestrationCell(
                definition.monitor_status_id,
                section.enabled ? 'success' : 'neutral',
                section.enabled ? '已启用' : '已关闭',
                section.enabled
                    ? `巡检 ${formatVerifyMonitorInteger(sweepIntervalMinutes)} 分钟，队列阈值 ${formatVerifyMonitorInteger(section.queue_size_threshold || 0)} 个，最老待处理 ${formatVerifyMonitorInteger(section.oldest_pending_minutes_threshold || 0)} 分钟。`
                    : `验证堆积阈值仍保留，队列阈值 ${formatVerifyMonitorInteger(section.queue_size_threshold || 0)} 个。`
            );
        } else if (definition.key === 'verify_failure') {
            setOpsAlertSummaryOrchestrationCell(
                definition.monitor_status_id,
                section.enabled ? 'success' : 'neutral',
                section.enabled ? '已启用' : '已关闭',
                section.enabled
                    ? `巡检 ${formatVerifyMonitorInteger(sweepIntervalMinutes)} 分钟，失败率阈值 ${formatVerifyMonitorInteger(section.failure_rate_threshold || 0)}%，样本量至少 ${formatVerifyMonitorInteger(section.min_total_jobs_threshold || 0)} 次。`
                    : `验证失败率阈值仍保留，失败率 ${formatVerifyMonitorInteger(section.failure_rate_threshold || 0)}%。`
            );
        } else {
            setOpsAlertSummaryOrchestrationCell(
                definition.monitor_status_id,
                section.enabled ? 'success' : 'neutral',
                section.enabled ? '已启用' : '已关闭',
                section.enabled
                    ? `巡检 ${formatVerifyMonitorInteger(sweepIntervalMinutes)} 分钟，回看 ${formatVerifyMonitorInteger(section.lookback_minutes || 0)} 分钟。`
                    : `巡检参数仍保留，回看 ${formatVerifyMonitorInteger(section.lookback_minutes || 0)} 分钟。`
            );
        }

        if (!definition.supports_work_hours_only) {
            setOpsAlertSummaryOrchestrationCell(
                definition.work_hours_status_id,
                'neutral',
                '不适用',
                '当前库存类只支持定时汇总，不支持按工作时段顺延。'
            );
        } else if (!section.enabled) {
            setOpsAlertSummaryOrchestrationCell(
                definition.work_hours_status_id,
                'neutral',
                '主监控关闭',
                '开启主监控后才会应用工作时段顺延。'
            );
        } else if (section.work_hours_only_enabled === true && workHours.enabled) {
            setOpsAlertSummaryOrchestrationCell(
                definition.work_hours_status_id,
                'success',
                '已顺延',
                `非工作时段会顺延到 ${formatOpsAlertHourMinute(workHours.start_hour, 0)} 开始，工作时段 ${formatOpsAlertHourMinute(workHours.start_hour, 0)}-${formatOpsAlertHourMinute(workHours.end_hour, 0)}（${workHours.timezone || 'Asia/Shanghai'}）。`
            );
        } else if (section.work_hours_only_enabled === true) {
            setOpsAlertSummaryOrchestrationCell(
                definition.work_hours_status_id,
                'warning',
                '待开启工作时段',
                '已勾选顺延，但全局工作时段还没启用。'
            );
        } else if (workHours.enabled) {
            setOpsAlertSummaryOrchestrationCell(
                definition.work_hours_status_id,
                'neutral',
                '全天直发',
                `全局工作时段是 ${formatOpsAlertHourMinute(workHours.start_hour, 0)}-${formatOpsAlertHourMinute(workHours.end_hour, 0)}，但该告警仍全天直接外发。`
            );
        } else {
            setOpsAlertSummaryOrchestrationCell(
                definition.work_hours_status_id,
                'neutral',
                '全天直发',
                '当前未启用全局工作时段限制。'
            );
        }

        if (!section.enabled) {
            setOpsAlertSummaryOrchestrationCell(
                definition.summary_status_id,
                section.summary_enabled === true ? 'warning' : 'neutral',
                section.summary_enabled === true ? '等待主监控' : '即时通知',
                section.summary_enabled === true
                    ? `已预设 ${summaryDescription}，最多 ${formatVerifyMonitorInteger(section.summary_max_items || 0)} 条，开启主监控后生效。`
                    : '主监控关闭时不会出队汇总。'
            );
        } else if (section.summary_enabled === true) {
            setOpsAlertSummaryOrchestrationCell(
                definition.summary_status_id,
                'success',
                '已启用汇总',
                `${summaryDescription}，最多 ${formatVerifyMonitorInteger(section.summary_max_items || 0)} 条。${definition.supports_work_hours_only && section.work_hours_only_enabled === true && workHours.enabled ? ' 非工作时段仍会顺延到上班时间。' : ''}`
            );
        } else if (definition.supports_work_hours_only && section.work_hours_only_enabled === true && workHours.enabled) {
            setOpsAlertSummaryOrchestrationCell(
                definition.summary_status_id,
                'warning',
                '仅非工作时段汇总',
                '工作时段内仍即时通知，非工作时段会顺延到下个上班时间。'
            );
        } else {
            setOpsAlertSummaryOrchestrationCell(
                definition.summary_status_id,
                'neutral',
                '即时通知',
                '当前不走固定汇总，命中后按原节奏直接外发。'
            );
        }
    });

    const selectedCount = getOpsAlertSummaryOrchestrationSelectedDefinitions().length;
    const metaEl = document.getElementById('opsAlertSummaryOrchestrationMeta');
    const overviewSelectionMetaEl = document.getElementById('opsAlertSummaryOverviewSelectionMeta');
    if (metaEl) {
        metaEl.innerHTML = `
            <i class="fas fa-layer-group"></i>
            <span>共 ${escapeConfigHtml(formatVerifyMonitorInteger(OPS_ALERT_SUMMARY_ORCHESTRATION_DEFINITIONS.length))} 类告警：${escapeConfigHtml(formatVerifyMonitorInteger(enabledMonitorCount))} 类已启用主监控，${escapeConfigHtml(formatVerifyMonitorInteger(summaryEnabledCount))} 类已启用定时汇总，${escapeConfigHtml(formatVerifyMonitorInteger(workHoursOnlyCount))} 类启用工作时段顺延。当前已勾选 ${escapeConfigHtml(formatVerifyMonitorInteger(selectedCount))} 类用于批量应用。</span>
        `;
    }
    if (overviewSelectionMetaEl) {
        overviewSelectionMetaEl.textContent = `已勾选 ${formatVerifyMonitorInteger(selectedCount)} 类`;
    }

    syncOpsAlertUnifiedSummaryDraftFromSelection(normalizedConfig);
    applyOpsAlertUnifiedSummaryDraftControls();
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
            )
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
    const packages = systemConfigCache['packages'] || [];
    const rechargeOptions = normalizeRechargeOptionsConfig(systemConfigCache['recharge_options']);
    const tbody = document.getElementById('packagesTableBody');
    if (!tbody) return;

    tbody.innerHTML = packages.map((pkg, index) => `
        <tr data-index="${index}">
            <td>
                <input
                    type="text"
                    value="${escapeConfigHtml(pkg.name)}"
                    data-admin-change-action="settings-update-package-field"
                    data-package-index="${index}"
                    data-package-field="name"
                    data-package-value-type="string">
            </td>
            <td>
                <input
                    type="number"
                    value="${escapeConfigHtml(pkg.points)}"
                    data-admin-change-action="settings-update-package-field"
                    data-package-index="${index}"
                    data-package-field="points"
                    data-package-value-type="int">
            </td>
            <td>
                <input
                    type="number"
                    value="${escapeConfigHtml(pkg.bonus || 0)}"
                    placeholder="0"
                    data-admin-change-action="settings-update-package-field"
                    data-package-index="${index}"
                    data-package-field="bonus"
                    data-package-value-type="int">
            </td>
            <td>
                <input
                    type="number"
                    value="${pkg.price == null ? '' : escapeConfigHtml(pkg.price)}"
                    step="0.1"
                    data-admin-change-action="settings-update-package-field"
                    data-package-index="${index}"
                    data-package-field="price"
                    data-package-value-type="float">
            </td>
            <td>
                <div class="status-toggle ${pkg.enabled ? 'active' : ''}" data-admin-action="settings-toggle-package-status" data-package-index="${index}"></div>
            </td>
            <td>
                <button class="btn-delete" type="button" data-admin-action="settings-delete-package" data-package-index="${index}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');

    const customRechargeToggle = document.getElementById('customRechargeStatusToggle');
    if (customRechargeToggle) {
        customRechargeToggle.classList.toggle('active', rechargeOptions.custom_amount_enabled);
    }

    const mockPaymentToggle = document.getElementById('mockPaymentStatusToggle');
    if (mockPaymentToggle) {
        mockPaymentToggle.classList.toggle('active', rechargeOptions.mock_payment_enabled);
    }
}

function normalizePackageFieldValue(field, value, fallback) {
    switch (field) {
        case 'name':
            return String(value ?? '').trim();
        case 'points':
        case 'bonus': {
            const parsed = parseInt(value ?? '', 10);
            return Math.max(0, Number.isFinite(parsed) ? parsed : (Number.isFinite(fallback) ? fallback : 0));
        }
        case 'price': {
            const trimmed = String(value ?? '').trim();
            if (!trimmed) {
                return null;
            }

            const parsed = Number(trimmed);
            const normalized = Number.isFinite(parsed) ? parsed : fallback;
            return Number.isFinite(normalized) ? Math.max(0, Math.round(normalized * 100) / 100) : null;
        }
        default:
            return value;
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
    const { telegramSecret, feishuSecret, emailSecret } = overviewStatus;

    const masterToggle = document.getElementById('opsAlertEnabledToggle');
    if (masterToggle) {
        masterToggle.classList.toggle('active', normalizedConfig.enabled);
    }

    const telegramToggle = document.getElementById('opsAlertTelegramEnabledToggle');
    if (telegramToggle) {
        telegramToggle.classList.toggle('active', normalizedConfig.channels.telegram.enabled);
    }

    const feishuToggle = document.getElementById('opsAlertFeishuEnabledToggle');
    if (feishuToggle) {
        feishuToggle.classList.toggle('active', normalizedConfig.channels.feishu.enabled);
    }

    const emailToggle = document.getElementById('opsAlertEmailEnabledToggle');
    if (emailToggle) {
        emailToggle.classList.toggle('active', normalizedConfig.channels.email.enabled);
    }

    const telegramInputIds = [
        'opsAlertTelegramChatIds',
        'opsAlertTelegramSeverity',
        'opsAlertTelegramBotToken'
    ];
    telegramInputIds.forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !normalizedConfig.channels.telegram.enabled;
    });

    const feishuInputIds = [
        'opsAlertFeishuSeverity',
        'opsAlertFeishuWebhookUrl'
    ];
    feishuInputIds.forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !normalizedConfig.channels.feishu.enabled;
    });

    const emailInputIds = [
        'opsAlertEmailSeverity',
        'opsAlertEmailRecipients',
        'opsAlertEmailFromAddress',
        'opsAlertEmailReplyTo',
        'opsAlertEmailSubjectPrefix',
        'opsAlertEmailApiKey'
    ];
    emailInputIds.forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !normalizedConfig.channels.email.enabled;
    });

    const telegramStatus = document.getElementById('opsAlertTelegramBotTokenStatus');
    if (telegramStatus) {
        telegramStatus.textContent = getOpsAlertSecretStatusMessage('telegram_bot_token');
    }

    const feishuStatus = document.getElementById('opsAlertFeishuWebhookStatus');
    if (feishuStatus) {
        feishuStatus.textContent = getOpsAlertSecretStatusMessage('feishu_webhook_url');
    }

    const emailStatus = document.getElementById('opsAlertEmailApiKeyStatus');
    if (emailStatus) {
        emailStatus.textContent = getOpsAlertSecretStatusMessage('email_api_key');
    }

    setOpsAlertDeleteButtonState('telegram_bot_token', telegramSecret);
    setOpsAlertDeleteButtonState('feishu_webhook_url', feishuSecret);
    setOpsAlertDeleteButtonState('email_api_key', emailSecret);
    ensureOpsAlertMonitorCards();
    applyOpsAlertStrategyControls(normalizedConfig);
    applyOpsAlertShopRiskControls(normalizedConfig);
    applyOpsAlertShopInventoryControls(normalizedConfig);
    applyOpsAlertCustomerChatControls(normalizedConfig);
    applyOpsAlertShopPurchaseSuccessControls(normalizedConfig);
    applyOpsAlertWalletRechargeSuccessControls(normalizedConfig);
    applyOpsAlertTicketsControls(normalizedConfig);
    applyOpsAlertShopOrderDeliveryControls(normalizedConfig);
    applyOpsAlertVerifyQuotaControls(normalizedConfig);
    applyOpsAlertVerifyQueueControls(normalizedConfig);
    applyOpsAlertVerifyFailureControls(normalizedConfig);
    applyOpsAlertPaymentGatewayControls(normalizedConfig);
    renderOpsAlertSummaryOrchestration(normalizedConfig);
    renderOpsAlertOverviewCards(normalizedConfig);
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

function renderOpsAlertStrategySummary(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
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

    const muteBadgeLabel = temporaryMuteState.active
        ? '临时静默中'
        : totalActiveMuteCount > 0
            ? `生效 ${formatVerifyMonitorInteger(totalActiveMuteCount)} 项`
            : quietHours.enabled
                ? '夜间静默开启'
                : '按需启用';
    const muteBadgeTone = totalActiveMuteCount > 0 || quietHours.enabled ? 'warning' : 'neutral';
    const muteSummaryText = temporaryMuteState.active
        ? `当前外发已静默到 ${temporaryMuteState.untilLabel}，适合维护窗口快速止噪。`
        : totalActiveMuteCount > 0
            ? `当前有 ${formatVerifyMonitorInteger(totalActiveMuteCount)} 项静默策略生效，建议只保留真正需要降噪的规则。`
            : totalExpiredMuteCount > 0
                ? `检测到 ${formatVerifyMonitorInteger(totalExpiredMuteCount)} 条过期静默记录，建议清理旧时间，减少误判。`
                : '维护窗口、夜间降噪和单类静默会汇总在这里。';
    const mutePanelTipText = totalActiveMuteCount > 0
        ? `当前有 ${formatVerifyMonitorInteger(totalActiveMuteCount)} 项静默策略生效，优先处理仍在生效的规则。`
        : '集中管理临时静默、夜间静默和分组降噪。';

    setOpsAlertStrategyBadgeState('opsAlertStrategySummaryMuteBadge', muteBadgeLabel, muteBadgeTone);
    setOpsAlertStrategyBadgeState('opsAlertStrategyPanelMuteBadge', muteBadgeLabel, muteBadgeTone);
    setOpsAlertInfoTipText('opsAlertStrategySummaryMuteTip', muteSummaryText);
    setOpsAlertInfoTipText('opsAlertStrategyPanelMuteTip', mutePanelTipText);
    const muteTemporaryEl = document.getElementById('opsAlertStrategySummaryMuteTemporary');
    if (muteTemporaryEl) {
        muteTemporaryEl.textContent = temporaryMuteState.active
            ? `至 ${temporaryMuteState.untilLabel}`
            : temporaryMuteState.expired
                ? '已过期'
                : '未设置';
    }
    const muteQuietHoursEl = document.getElementById('opsAlertStrategySummaryMuteQuietHours');
    if (muteQuietHoursEl) {
        muteQuietHoursEl.textContent = quietHours.enabled
            ? formatOpsAlertHourRange(quietHours.start_hour, quietHours.end_hour)
            : '已关闭';
    }
    const muteRulesEl = document.getElementById('opsAlertStrategySummaryMuteRules');
    if (muteRulesEl) {
        muteRulesEl.textContent = `${formatVerifyMonitorInteger(activeTypeCount)} / ${formatVerifyMonitorInteger(activeModuleCount)} 生效`;
    }
    const typeMuteMetaEl = document.getElementById('opsAlertTypeMutePanelMeta');
    if (typeMuteMetaEl) {
        typeMuteMetaEl.textContent = `共 ${formatVerifyMonitorInteger(OPS_ALERT_MUTE_RULE_TYPE_DEFINITIONS.length)} 类，${formatVerifyMonitorInteger(activeTypeCount)} 类生效`;
    }
    const moduleMuteMetaEl = document.getElementById('opsAlertModuleMutePanelMeta');
    if (moduleMuteMetaEl) {
        moduleMuteMetaEl.textContent = `共 ${formatVerifyMonitorInteger(OPS_ALERT_MUTE_RULE_MODULE_DEFINITIONS.length)} 类，${formatVerifyMonitorInteger(activeModuleCount)} 类生效`;
    }
    const typeTabCountEl = document.getElementById('opsAlertMuteTabTypesCount');
    if (typeTabCountEl) {
        typeTabCountEl.textContent = `${formatVerifyMonitorInteger(activeTypeCount)} 生效`;
    }
    const moduleTabCountEl = document.getElementById('opsAlertMuteTabModulesCount');
    if (moduleTabCountEl) {
        moduleTabCountEl.textContent = `${formatVerifyMonitorInteger(activeModuleCount)} 生效`;
    }

    const routingBadgeLabel = routingCustomizedCount > 0
        ? `已定制 ${formatVerifyMonitorInteger(routingCustomizedCount)} 类`
        : '全通道默认';
    const routingBadgeTone = routingCustomizedCount > 0 ? 'success' : 'neutral';
    const routingSummaryTipText = routingCustomizedCount > 0
        ? `已有 ${formatVerifyMonitorInteger(routingCustomizedCount)} 类事件被改成非默认路由，矩阵更适合快速复核。`
        : '当前 14 类事件都保留 Telegram、飞书、邮件三通道默认投递。';
    const routingPanelTipText = routingCustomizedCount > 0
        ? `已对 ${formatVerifyMonitorInteger(routingCustomizedCount)} 类事件做了分流，建议重点检查核心告警是否还保留至少一条主通道。`
        : '把路由改成矩阵后，可以更快看清哪类告警发到哪个通道。';
    setOpsAlertStrategyBadgeState('opsAlertStrategySummaryRoutingBadge', routingBadgeLabel, routingBadgeTone);
    setOpsAlertStrategyBadgeState('opsAlertStrategyPanelRoutingBadge', routingBadgeLabel, routingBadgeTone);
    setOpsAlertInfoTipText('opsAlertStrategySummaryRoutingTip', routingSummaryTipText);
    setOpsAlertInfoTipText('opsAlertStrategyPanelRoutingTip', routingPanelTipText);
    const routingMatrixMetaEl = document.getElementById('opsAlertRoutingMatrixMeta');
    if (routingMatrixMetaEl) {
        routingMatrixMetaEl.textContent = `共 ${formatVerifyMonitorInteger(totalRoutingCount)} 类事件，已定制 ${formatVerifyMonitorInteger(routingCustomizedCount)} 类`;
    }
    const routingTelegramEl = document.getElementById('opsAlertStrategySummaryRoutingTelegram');
    if (routingTelegramEl) {
        routingTelegramEl.textContent = `${formatVerifyMonitorInteger(routingChannelCounts.telegram)} / ${formatVerifyMonitorInteger(totalRoutingCount)}`;
    }
    const routingFeishuEl = document.getElementById('opsAlertStrategySummaryRoutingFeishu');
    if (routingFeishuEl) {
        routingFeishuEl.textContent = `${formatVerifyMonitorInteger(routingChannelCounts.feishu)} / ${formatVerifyMonitorInteger(totalRoutingCount)}`;
    }
    const routingEmailEl = document.getElementById('opsAlertStrategySummaryRoutingEmail');
    if (routingEmailEl) {
        routingEmailEl.textContent = `${formatVerifyMonitorInteger(routingChannelCounts.email)} / ${formatVerifyMonitorInteger(totalRoutingCount)}`;
    }

    const workHoursBadgeTone = workHours.enabled ? 'success' : (workHoursOnlyCount > 0 ? 'warning' : 'neutral');
    const workHoursBadgeLabel = workHours.enabled
        ? '已启用'
        : workHoursOnlyCount > 0
            ? '待启用'
            : '未启用';
    const workHoursSummaryTipText = workHoursOnlyCount > 0
        ? `当前有 ${formatVerifyMonitorInteger(workHoursOnlyCount)} 类告警启用了“仅工作时间通知”。`
        : '只影响开启“仅工作时间通知”的低优先级告警。';
    const workHoursPanelTipText = workHours.enabled
        ? `当前工作时段为 ${formatOpsAlertHourRange(workHours.start_hour, workHours.end_hour)}，会影响 ${formatVerifyMonitorInteger(workHoursOnlyCount)} 类告警。`
        : '这组时间只影响开启“仅工作时间通知”的低优先级告警。';
    setOpsAlertStrategyBadgeState('opsAlertStrategySummaryWorkHoursBadge', workHoursBadgeLabel, workHoursBadgeTone);
    setOpsAlertStrategyBadgeState('opsAlertStrategyPanelWorkHoursBadge', workHoursBadgeLabel, workHoursBadgeTone);
    setOpsAlertInfoTipText('opsAlertStrategySummaryWorkHoursTip', workHoursSummaryTipText);
    setOpsAlertInfoTipText('opsAlertStrategyPanelWorkHoursTip', workHoursPanelTipText);
    const workHoursRangeEl = document.getElementById('opsAlertStrategySummaryWorkHoursRange');
    if (workHoursRangeEl) {
        workHoursRangeEl.textContent = formatOpsAlertHourRange(workHours.start_hour, workHours.end_hour);
    }
    const workHoursTimezoneEl = document.getElementById('opsAlertStrategySummaryWorkHoursTimezone');
    if (workHoursTimezoneEl) {
        workHoursTimezoneEl.textContent = workHours.timezone || defaults.work_hours.timezone;
    }
    const workHoursRulesEl = document.getElementById('opsAlertStrategySummaryWorkHoursRules');
    if (workHoursRulesEl) {
        workHoursRulesEl.textContent = `${formatVerifyMonitorInteger(workHoursOnlyCount)} 类`;
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

function applyOpsAlertStrategyControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    ensureOpsAlertStrategyLayout();
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const temporaryMute = normalizedConfig.temporary_mute || getDefaultOpsAlertConfig().temporary_mute;
    const temporaryMuteState = getOpsAlertTemporaryMuteState(normalizedConfig);
    const temporaryMuteUntilInput = document.getElementById('opsAlertTemporaryMuteUntil');
    if (temporaryMuteUntilInput) {
        temporaryMuteUntilInput.value = formatDateTimeLocalInputValue(temporaryMute.until || '');
    }

    const temporaryMuteAllowCriticalToggle = document.getElementById('opsAlertTemporaryMuteAllowCriticalToggle');
    if (temporaryMuteAllowCriticalToggle) {
        temporaryMuteAllowCriticalToggle.classList.toggle('active', temporaryMute.allow_critical !== false);
    }

    const temporaryMuteStatus = document.getElementById('opsAlertTemporaryMuteStatus');
    if (temporaryMuteStatus) {
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
    const temporaryMuteInlineClear = document.getElementById('opsAlertTemporaryMuteInlineClear');
    if (temporaryMuteInlineClear) {
        temporaryMuteInlineClear.hidden = !(temporaryMuteState.active || temporaryMuteState.expired);
    }

    const quietHours = normalizedConfig.quiet_hours || getDefaultOpsAlertConfig().quiet_hours;
    const quietHoursEnabledToggle = document.getElementById('opsAlertQuietHoursEnabledToggle');
    if (quietHoursEnabledToggle) {
        quietHoursEnabledToggle.classList.toggle('active', quietHours.enabled);
    }

    const allowCriticalToggle = document.getElementById('opsAlertQuietHoursAllowCriticalToggle');
    if (allowCriticalToggle) {
        allowCriticalToggle.classList.toggle('active', quietHours.allow_critical);
        allowCriticalToggle.classList.toggle('disabled', !quietHours.enabled);
    }

    [
        'opsAlertQuietHoursStartHour',
        'opsAlertQuietHoursEndHour',
        'opsAlertQuietHoursTimezone'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !quietHours.enabled;
    });
    const quietHoursRangeHint = document.getElementById('opsAlertQuietHoursRangeHint');
    if (quietHoursRangeHint) {
        quietHoursRangeHint.textContent = formatOpsAlertHourRangePreview(
            quietHours.start_hour,
            quietHours.end_hour,
            { timezone: quietHours.timezone }
        );
    }

    const workHours = normalizedConfig.work_hours || getDefaultOpsAlertConfig().work_hours;
    const workHoursEnabledToggle = document.getElementById('opsAlertWorkHoursEnabledToggle');
    if (workHoursEnabledToggle) {
        workHoursEnabledToggle.classList.toggle('active', workHours.enabled);
    }

    [
        'opsAlertWorkHoursStartHour',
        'opsAlertWorkHoursEndHour',
        'opsAlertWorkHoursTimezone'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !workHours.enabled;
    });
    const workHoursRangeHint = document.getElementById('opsAlertWorkHoursRangeHint');
    if (workHoursRangeHint) {
        workHoursRangeHint.textContent = formatOpsAlertHourRangePreview(
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
            const input = document.getElementById(getOpsAlertMuteRuleElementId(scope, definition.key, 'Until'));
            if (input) {
                input.value = formatDateTimeLocalInputValue(rule.until || '');
            }

            const allowCriticalToggle = document.getElementById(getOpsAlertMuteRuleElementId(scope, definition.key, 'AllowCriticalToggle'));
            if (allowCriticalToggle) {
                allowCriticalToggle.classList.toggle('active', rule.allow_critical !== false);
            }

            const statusEl = document.getElementById(getOpsAlertMuteRuleElementId(scope, definition.key, 'Status'));
            if (statusEl) {
                if (state.active) {
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
                clearButton.hidden = !(state.active || state.expired);
            }

            const row = document.querySelector(`[data-mute-rule-row="${scope}:${definition.key}"]`);
            if (row instanceof HTMLElement) {
                row.dataset.ruleState = state.active ? 'active' : (state.expired ? 'expired' : 'inactive');
            }
        });
    });

    const routingKeys = Object.keys(normalizedConfig.routing || getDefaultOpsAlertConfig().routing || {});
    const channelKeys = ['telegram', 'feishu', 'email'];
    routingKeys.forEach((routingKey) => {
        channelKeys.forEach((channelKey) => {
            const checkbox = document.getElementById(getOpsAlertRoutingCheckboxId(routingKey, channelKey));
            if (!checkbox) return;
            checkbox.checked = normalizedConfig.routing?.[routingKey]?.[channelKey] !== false;
        });
    });

    syncAllOpsAlertDateTimeFields();
    renderOpsAlertStrategySummary(normalizedConfig);
}

function applyOpsAlertShopRiskControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const shopRiskConfig = normalizedConfig.shop_order_risk || getDefaultOpsAlertConfig().shop_order_risk;
    const toggleEl = document.getElementById('opsAlertShopRiskAutoResponseEnabledToggle');
    if (toggleEl) {
        toggleEl.classList.toggle('active', shopRiskConfig.auto_response_enabled);
    }

    [
        'opsAlertShopRiskAutoDisableCouponMinRiskScore',
        'opsAlertShopRiskAutoBanUserMinRiskScore',
        'opsAlertShopRiskAutoBanUserDurationDays',
        'opsAlertShopRiskAutoSuspendProductMinRiskScore'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !shopRiskConfig.auto_response_enabled;
    });
}

function applyOpsAlertShopInventoryControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const inventoryConfig = normalizedConfig.shop_inventory || getDefaultOpsAlertConfig().shop_inventory;
    const toggleEl = document.getElementById('opsAlertShopInventoryEnabledToggle');
    if (toggleEl) {
        toggleEl.classList.toggle('active', inventoryConfig.enabled);
    }

    const recoveryToggleEl = document.getElementById('opsAlertShopInventoryRecoveryNotificationEnabledToggle');
    if (recoveryToggleEl) {
        recoveryToggleEl.classList.toggle('active', inventoryConfig.recovery_notification_enabled);
        recoveryToggleEl.classList.toggle('disabled', !inventoryConfig.enabled);
    }
    const summaryToggleEl = document.getElementById('opsAlertShopInventorySummaryEnabledToggle');
    if (summaryToggleEl) {
        summaryToggleEl.classList.toggle('active', inventoryConfig.summary_enabled === true);
        summaryToggleEl.classList.toggle('disabled', !inventoryConfig.enabled);
    }

    [
        'opsAlertShopInventoryLowStockThreshold',
        'opsAlertShopInventorySweepIntervalMinutes',
        'opsAlertShopInventorySalesWindowDays',
        'opsAlertShopInventoryDedupeWindowMinutes'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !inventoryConfig.enabled;
    });
    applyOpsAlertSummaryModeControls(inventoryConfig, {
        summaryScheduleMode: 'opsAlertShopInventorySummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertShopInventorySummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertShopInventorySummaryHourlyMinute',
        summaryDailyHour: 'opsAlertShopInventorySummaryDailyHour',
        summaryDailyMinute: 'opsAlertShopInventorySummaryDailyMinute',
        summaryMaxItems: 'opsAlertShopInventorySummaryMaxItems'
    });
}

function applyOpsAlertSummaryModeControls(monitorConfig = {}, ids = {}) {
    const summaryInputsEnabled = monitorConfig.enabled && monitorConfig.summary_enabled === true;
    const scheduleMode = normalizeOpsAlertSummaryScheduleMode(monitorConfig.summary_schedule_mode, 'rolling_window');
    const scheduleModeInput = document.getElementById(ids.summaryScheduleMode);
    if (scheduleModeInput) {
        scheduleModeInput.disabled = !summaryInputsEnabled;
        scheduleModeInput.value = scheduleMode;
    }

    const rollingWindowInput = document.getElementById(ids.summaryWindowMinutes);
    if (rollingWindowInput) {
        rollingWindowInput.disabled = !summaryInputsEnabled || scheduleMode !== 'rolling_window';
    }

    const hourlyMinuteInput = document.getElementById(ids.summaryHourlyMinute);
    if (hourlyMinuteInput) {
        hourlyMinuteInput.disabled = !summaryInputsEnabled || scheduleMode !== 'hourly';
    }

    const dailyHourInput = document.getElementById(ids.summaryDailyHour);
    if (dailyHourInput) {
        dailyHourInput.disabled = !summaryInputsEnabled || scheduleMode !== 'daily';
    }

    const dailyMinuteInput = document.getElementById(ids.summaryDailyMinute);
    if (dailyMinuteInput) {
        dailyMinuteInput.disabled = !summaryInputsEnabled || scheduleMode !== 'daily';
    }

    const summaryMaxItemsInput = document.getElementById(ids.summaryMaxItems);
    if (summaryMaxItemsInput) {
        summaryMaxItemsInput.disabled = !summaryInputsEnabled;
    }

    applyOpsAlertSummaryModePresentation(monitorConfig, {
        ...ids,
        summaryModeHint: ids.summaryModeHint || `${ids.summaryScheduleMode || 'opsAlertSummaryMode'}Hint`
    }, {
        monitorEnabled: monitorConfig.enabled === true,
        summaryEnabled: monitorConfig.summary_enabled === true
    });
}

function applyOpsAlertCustomerChatControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.customer_chat_message || getDefaultOpsAlertConfig().customer_chat_message;
    const toggleEl = document.getElementById('opsAlertCustomerChatMessageEnabledToggle');
    if (toggleEl) {
        toggleEl.classList.toggle('active', monitorConfig.enabled);
    }
    const summaryToggleEl = document.getElementById('opsAlertCustomerChatMessageSummaryEnabledToggle');
    if (summaryToggleEl) {
        summaryToggleEl.classList.toggle('active', monitorConfig.summary_enabled === true);
    }
    const workHoursOnlyToggleEl = document.getElementById('opsAlertCustomerChatMessageWorkHoursOnlyEnabledToggle');
    if (workHoursOnlyToggleEl) {
        workHoursOnlyToggleEl.classList.toggle('active', monitorConfig.work_hours_only_enabled === true);
        workHoursOnlyToggleEl.classList.toggle('disabled', !monitorConfig.enabled);
    }

    [
        'opsAlertCustomerChatMessageSweepIntervalMinutes',
        'opsAlertCustomerChatMessageLookbackMinutes',
        'opsAlertCustomerChatMessageDedupeWindowMinutes'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !monitorConfig.enabled;
    });
    applyOpsAlertSummaryModeControls(monitorConfig, {
        summaryScheduleMode: 'opsAlertCustomerChatMessageSummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertCustomerChatMessageSummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertCustomerChatMessageSummaryHourlyMinute',
        summaryDailyHour: 'opsAlertCustomerChatMessageSummaryDailyHour',
        summaryDailyMinute: 'opsAlertCustomerChatMessageSummaryDailyMinute',
        summaryMaxItems: 'opsAlertCustomerChatMessageSummaryMaxItems'
    });
}

function applyOpsAlertShopPurchaseSuccessControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.shop_purchase_success || getDefaultOpsAlertConfig().shop_purchase_success;
    const toggleEl = document.getElementById('opsAlertShopPurchaseSuccessEnabledToggle');
    if (toggleEl) {
        toggleEl.classList.toggle('active', monitorConfig.enabled);
    }
    const summaryToggleEl = document.getElementById('opsAlertShopPurchaseSuccessSummaryEnabledToggle');
    if (summaryToggleEl) {
        summaryToggleEl.classList.toggle('active', monitorConfig.summary_enabled === true);
    }
    const workHoursOnlyToggleEl = document.getElementById('opsAlertShopPurchaseSuccessWorkHoursOnlyEnabledToggle');
    if (workHoursOnlyToggleEl) {
        workHoursOnlyToggleEl.classList.toggle('active', monitorConfig.work_hours_only_enabled === true);
        workHoursOnlyToggleEl.classList.toggle('disabled', !monitorConfig.enabled);
    }

    [
        'opsAlertShopPurchaseSuccessSweepIntervalMinutes',
        'opsAlertShopPurchaseSuccessLookbackMinutes',
        'opsAlertShopPurchaseSuccessDedupeWindowMinutes'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !monitorConfig.enabled;
    });
    applyOpsAlertSummaryModeControls(monitorConfig, {
        summaryScheduleMode: 'opsAlertShopPurchaseSuccessSummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertShopPurchaseSuccessSummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertShopPurchaseSuccessSummaryHourlyMinute',
        summaryDailyHour: 'opsAlertShopPurchaseSuccessSummaryDailyHour',
        summaryDailyMinute: 'opsAlertShopPurchaseSuccessSummaryDailyMinute',
        summaryMaxItems: 'opsAlertShopPurchaseSuccessSummaryMaxItems'
    });
}

function applyOpsAlertWalletRechargeSuccessControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.wallet_recharge_success || getDefaultOpsAlertConfig().wallet_recharge_success;
    const toggleEl = document.getElementById('opsAlertWalletRechargeSuccessEnabledToggle');
    if (toggleEl) {
        toggleEl.classList.toggle('active', monitorConfig.enabled);
    }
    const summaryToggleEl = document.getElementById('opsAlertWalletRechargeSuccessSummaryEnabledToggle');
    if (summaryToggleEl) {
        summaryToggleEl.classList.toggle('active', monitorConfig.summary_enabled === true);
    }
    const workHoursOnlyToggleEl = document.getElementById('opsAlertWalletRechargeSuccessWorkHoursOnlyEnabledToggle');
    if (workHoursOnlyToggleEl) {
        workHoursOnlyToggleEl.classList.toggle('active', monitorConfig.work_hours_only_enabled === true);
        workHoursOnlyToggleEl.classList.toggle('disabled', !monitorConfig.enabled);
    }

    [
        'opsAlertWalletRechargeSuccessSweepIntervalMinutes',
        'opsAlertWalletRechargeSuccessLookbackMinutes',
        'opsAlertWalletRechargeSuccessDedupeWindowMinutes'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !monitorConfig.enabled;
    });
    applyOpsAlertSummaryModeControls(monitorConfig, {
        summaryScheduleMode: 'opsAlertWalletRechargeSuccessSummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertWalletRechargeSuccessSummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertWalletRechargeSuccessSummaryHourlyMinute',
        summaryDailyHour: 'opsAlertWalletRechargeSuccessSummaryDailyHour',
        summaryDailyMinute: 'opsAlertWalletRechargeSuccessSummaryDailyMinute',
        summaryMaxItems: 'opsAlertWalletRechargeSuccessSummaryMaxItems'
    });
}

function applyOpsAlertTicketsControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.tickets || getDefaultOpsAlertConfig().tickets;
    const toggleEl = document.getElementById('opsAlertTicketsEnabledToggle');
    if (toggleEl) {
        toggleEl.classList.toggle('active', monitorConfig.enabled);
    }
    const summaryToggleEl = document.getElementById('opsAlertTicketsSummaryEnabledToggle');
    if (summaryToggleEl) {
        summaryToggleEl.classList.toggle('active', monitorConfig.summary_enabled === true);
    }
    const workHoursOnlyToggleEl = document.getElementById('opsAlertTicketsWorkHoursOnlyEnabledToggle');
    if (workHoursOnlyToggleEl) {
        workHoursOnlyToggleEl.classList.toggle('active', monitorConfig.work_hours_only_enabled === true);
        workHoursOnlyToggleEl.classList.toggle('disabled', !monitorConfig.enabled);
    }

    [
        'opsAlertTicketsSweepIntervalMinutes',
        'opsAlertTicketsPendingOverdueMinutes',
        'opsAlertTicketsCriticalOverdueMinutes',
        'opsAlertTicketsStateLookbackMinutes',
        'opsAlertTicketsDedupeWindowMinutes'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !monitorConfig.enabled;
    });
    applyOpsAlertSummaryModeControls(monitorConfig, {
        summaryScheduleMode: 'opsAlertTicketsSummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertTicketsSummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertTicketsSummaryHourlyMinute',
        summaryDailyHour: 'opsAlertTicketsSummaryDailyHour',
        summaryDailyMinute: 'opsAlertTicketsSummaryDailyMinute',
        summaryMaxItems: 'opsAlertTicketsSummaryMaxItems'
    });
}

function applyOpsAlertShopOrderDeliveryControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.shop_order_delivery || getDefaultOpsAlertConfig().shop_order_delivery;
    const toggleEl = document.getElementById('opsAlertShopOrderDeliveryEnabledToggle');
    if (toggleEl) {
        toggleEl.classList.toggle('active', monitorConfig.enabled);
    }
    const incidentToggleEl = document.getElementById('opsAlertShopOrderDeliveryIncidentEnabledToggle');
    if (incidentToggleEl) {
        incidentToggleEl.classList.toggle('active', monitorConfig.incident_enabled === true);
        incidentToggleEl.classList.toggle('disabled', !monitorConfig.enabled);
    }
    const summaryToggleEl = document.getElementById('opsAlertShopOrderDeliverySummaryEnabledToggle');
    if (summaryToggleEl) {
        summaryToggleEl.classList.toggle('active', monitorConfig.summary_enabled === true);
    }
    const workHoursOnlyToggleEl = document.getElementById('opsAlertShopOrderDeliveryWorkHoursOnlyEnabledToggle');
    if (workHoursOnlyToggleEl) {
        workHoursOnlyToggleEl.classList.toggle('active', monitorConfig.work_hours_only_enabled === true);
        workHoursOnlyToggleEl.classList.toggle('disabled', !monitorConfig.enabled);
    }

    [
        'opsAlertShopOrderDeliveryLookbackDays',
        'opsAlertShopOrderDeliveryStateLookbackMinutes',
        'opsAlertShopOrderDeliveryRetryWaitingMinAttempts',
        'opsAlertShopOrderDeliverySweepIntervalMinutes',
        'opsAlertShopOrderDeliveryDedupeWindowMinutes',
        'opsAlertShopOrderDeliveryIncidentMinOrderCount',
        'opsAlertShopOrderDeliveryIncidentMinDeadLetterCount',
        'opsAlertShopOrderDeliveryIncidentMinDistinctUsers',
        'opsAlertShopOrderDeliveryIncidentDedupeWindowMinutes'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !monitorConfig.enabled;
    });
    applyOpsAlertSummaryModeControls(monitorConfig, {
        summaryScheduleMode: 'opsAlertShopOrderDeliverySummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertShopOrderDeliverySummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertShopOrderDeliverySummaryHourlyMinute',
        summaryDailyHour: 'opsAlertShopOrderDeliverySummaryDailyHour',
        summaryDailyMinute: 'opsAlertShopOrderDeliverySummaryDailyMinute',
        summaryMaxItems: 'opsAlertShopOrderDeliverySummaryMaxItems'
    });
}

function applyOpsAlertVerifyQuotaControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.verify_quota || getDefaultOpsAlertConfig().verify_quota;
    const toggleEl = document.getElementById('opsAlertVerifyQuotaEnabledToggle');
    if (toggleEl) {
        toggleEl.classList.toggle('active', monitorConfig.enabled);
    }
    const summaryToggleEl = document.getElementById('opsAlertVerifyQuotaSummaryEnabledToggle');
    if (summaryToggleEl) {
        summaryToggleEl.classList.toggle('active', monitorConfig.summary_enabled === true);
    }
    const workHoursOnlyToggleEl = document.getElementById('opsAlertVerifyQuotaWorkHoursOnlyEnabledToggle');
    if (workHoursOnlyToggleEl) {
        workHoursOnlyToggleEl.classList.toggle('active', monitorConfig.work_hours_only_enabled === true);
        workHoursOnlyToggleEl.classList.toggle('disabled', !monitorConfig.enabled);
    }

    [
        'opsAlertVerifyQuotaLowBalanceThreshold',
        'opsAlertVerifyQuotaLowRemainingJobsThreshold',
        'opsAlertVerifyQuotaCriticalBalanceThreshold',
        'opsAlertVerifyQuotaCriticalRemainingJobsThreshold',
        'opsAlertVerifyQuotaMinQueueBufferJobs',
        'opsAlertVerifyQuotaSweepIntervalMinutes',
        'opsAlertVerifyQuotaDedupeWindowMinutes'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !monitorConfig.enabled;
    });
    applyOpsAlertSummaryModeControls(monitorConfig, {
        summaryScheduleMode: 'opsAlertVerifyQuotaSummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertVerifyQuotaSummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertVerifyQuotaSummaryHourlyMinute',
        summaryDailyHour: 'opsAlertVerifyQuotaSummaryDailyHour',
        summaryDailyMinute: 'opsAlertVerifyQuotaSummaryDailyMinute',
        summaryMaxItems: 'opsAlertVerifyQuotaSummaryMaxItems'
    });
}

function applyOpsAlertVerifyQueueControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.verify_queue || getDefaultOpsAlertConfig().verify_queue;
    const toggleEl = document.getElementById('opsAlertVerifyQueueEnabledToggle');
    if (toggleEl) {
        toggleEl.classList.toggle('active', monitorConfig.enabled);
    }
    const summaryToggleEl = document.getElementById('opsAlertVerifyQueueSummaryEnabledToggle');
    if (summaryToggleEl) {
        summaryToggleEl.classList.toggle('active', monitorConfig.summary_enabled === true);
    }
    const workHoursOnlyToggleEl = document.getElementById('opsAlertVerifyQueueWorkHoursOnlyEnabledToggle');
    if (workHoursOnlyToggleEl) {
        workHoursOnlyToggleEl.classList.toggle('active', monitorConfig.work_hours_only_enabled === true);
        workHoursOnlyToggleEl.classList.toggle('disabled', !monitorConfig.enabled);
    }

    [
        'opsAlertVerifyQueueRecentActivityLookbackHours',
        'opsAlertVerifyQueueRecentFailureWindowMinutes',
        'opsAlertVerifyQueueSizeThreshold',
        'opsAlertVerifyQueueActiveJobThreshold',
        'opsAlertVerifyQueueOldestPendingMinutesThreshold',
        'opsAlertVerifyQueueRecentFailureThreshold',
        'opsAlertVerifyQueueSweepIntervalMinutes',
        'opsAlertVerifyQueueDedupeWindowMinutes'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !monitorConfig.enabled;
    });
    applyOpsAlertSummaryModeControls(monitorConfig, {
        summaryScheduleMode: 'opsAlertVerifyQueueSummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertVerifyQueueSummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertVerifyQueueSummaryHourlyMinute',
        summaryDailyHour: 'opsAlertVerifyQueueSummaryDailyHour',
        summaryDailyMinute: 'opsAlertVerifyQueueSummaryDailyMinute',
        summaryMaxItems: 'opsAlertVerifyQueueSummaryMaxItems'
    });
}

function applyOpsAlertVerifyFailureControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.verify_failure || getDefaultOpsAlertConfig().verify_failure;
    const toggleEl = document.getElementById('opsAlertVerifyFailureEnabledToggle');
    if (toggleEl) {
        toggleEl.classList.toggle('active', monitorConfig.enabled);
    }
    const summaryToggleEl = document.getElementById('opsAlertVerifyFailureSummaryEnabledToggle');
    if (summaryToggleEl) {
        summaryToggleEl.classList.toggle('active', monitorConfig.summary_enabled === true);
    }
    const workHoursOnlyToggleEl = document.getElementById('opsAlertVerifyFailureWorkHoursOnlyEnabledToggle');
    if (workHoursOnlyToggleEl) {
        workHoursOnlyToggleEl.classList.toggle('active', monitorConfig.work_hours_only_enabled === true);
        workHoursOnlyToggleEl.classList.toggle('disabled', !monitorConfig.enabled);
    }

    [
        'opsAlertVerifyFailureRecentWindowMinutes',
        'opsAlertVerifyFailureMinTotalJobsThreshold',
        'opsAlertVerifyFailureRateThreshold',
        'opsAlertVerifyFailureAffectedUserThreshold',
        'opsAlertVerifyFailureSweepIntervalMinutes',
        'opsAlertVerifyFailureDedupeWindowMinutes'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !monitorConfig.enabled;
    });
    applyOpsAlertSummaryModeControls(monitorConfig, {
        summaryScheduleMode: 'opsAlertVerifyFailureSummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertVerifyFailureSummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertVerifyFailureSummaryHourlyMinute',
        summaryDailyHour: 'opsAlertVerifyFailureSummaryDailyHour',
        summaryDailyMinute: 'opsAlertVerifyFailureSummaryDailyMinute',
        summaryMaxItems: 'opsAlertVerifyFailureSummaryMaxItems'
    });
}

function applyOpsAlertPaymentGatewayControls(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const monitorConfig = normalizedConfig.payment_gateway || getDefaultOpsAlertConfig().payment_gateway;
    const toggleEl = document.getElementById('opsAlertPaymentGatewayEnabledToggle');
    if (toggleEl) {
        toggleEl.classList.toggle('active', monitorConfig.enabled);
    }
    const summaryToggleEl = document.getElementById('opsAlertPaymentGatewaySummaryEnabledToggle');
    if (summaryToggleEl) {
        summaryToggleEl.classList.toggle('active', monitorConfig.summary_enabled === true);
    }
    const workHoursOnlyToggleEl = document.getElementById('opsAlertPaymentGatewayWorkHoursOnlyEnabledToggle');
    if (workHoursOnlyToggleEl) {
        workHoursOnlyToggleEl.classList.toggle('active', monitorConfig.work_hours_only_enabled === true);
        workHoursOnlyToggleEl.classList.toggle('disabled', !monitorConfig.enabled);
    }

    [
        'opsAlertPaymentGatewayWindowMinutes',
        'opsAlertPaymentGatewayFailedOrdersThreshold',
        'opsAlertPaymentGatewayFailedRatioThreshold',
        'opsAlertPaymentGatewayWebhookSuccessRateThreshold',
        'opsAlertPaymentGatewayQuerySuccessRateThreshold',
        'opsAlertPaymentGatewayWebhook5xxThreshold',
        'opsAlertPaymentGatewayQuery5xxThreshold',
        'opsAlertPaymentGatewaySweepIntervalMinutes',
        'opsAlertPaymentGatewayDedupeWindowMinutes'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !monitorConfig.enabled;
    });
    applyOpsAlertSummaryModeControls(monitorConfig, {
        summaryScheduleMode: 'opsAlertPaymentGatewaySummaryScheduleMode',
        summaryWindowMinutes: 'opsAlertPaymentGatewaySummaryWindowMinutes',
        summaryHourlyMinute: 'opsAlertPaymentGatewaySummaryHourlyMinute',
        summaryDailyHour: 'opsAlertPaymentGatewaySummaryDailyHour',
        summaryDailyMinute: 'opsAlertPaymentGatewaySummaryDailyMinute',
        summaryMaxItems: 'opsAlertPaymentGatewaySummaryMaxItems'
    });
}

function renderOpsAlertSettings() {
    ensureOpsAlertStrategyLayout();
    opsAlertUnifiedSummaryDraftDirty = false;
    const config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts']);

    const quietHoursStartHour = document.getElementById('opsAlertQuietHoursStartHour');
    if (quietHoursStartHour) {
        quietHoursStartHour.value = String(config.quiet_hours.start_hour);
    }

    const quietHoursEndHour = document.getElementById('opsAlertQuietHoursEndHour');
    if (quietHoursEndHour) {
        quietHoursEndHour.value = String(config.quiet_hours.end_hour);
    }

    const quietHoursTimezone = document.getElementById('opsAlertQuietHoursTimezone');
    if (quietHoursTimezone) {
        quietHoursTimezone.value = config.quiet_hours.timezone;
    }

    const workHoursStartHour = document.getElementById('opsAlertWorkHoursStartHour');
    if (workHoursStartHour) {
        workHoursStartHour.value = String(config.work_hours.start_hour);
    }

    const workHoursEndHour = document.getElementById('opsAlertWorkHoursEndHour');
    if (workHoursEndHour) {
        workHoursEndHour.value = String(config.work_hours.end_hour);
    }

    const workHoursTimezone = document.getElementById('opsAlertWorkHoursTimezone');
    if (workHoursTimezone) {
        workHoursTimezone.value = config.work_hours.timezone;
    }

    const telegramChatIds = document.getElementById('opsAlertTelegramChatIds');
    if (telegramChatIds) {
        telegramChatIds.value = config.channels.telegram.chat_ids.join('\n');
    }

    const telegramSeverity = document.getElementById('opsAlertTelegramSeverity');
    if (telegramSeverity) {
        telegramSeverity.value = config.channels.telegram.minimum_severity;
    }

    const feishuSeverity = document.getElementById('opsAlertFeishuSeverity');
    if (feishuSeverity) {
        feishuSeverity.value = config.channels.feishu.minimum_severity;
    }

    const emailSeverity = document.getElementById('opsAlertEmailSeverity');
    if (emailSeverity) {
        emailSeverity.value = config.channels.email.minimum_severity;
    }

    const emailRecipients = document.getElementById('opsAlertEmailRecipients');
    if (emailRecipients) {
        emailRecipients.value = config.channels.email.recipients.join('\n');
    }

    const emailFromAddress = document.getElementById('opsAlertEmailFromAddress');
    if (emailFromAddress) {
        emailFromAddress.value = config.channels.email.from_address;
    }

    const emailReplyTo = document.getElementById('opsAlertEmailReplyTo');
    if (emailReplyTo) {
        emailReplyTo.value = config.channels.email.reply_to;
    }

    const emailSubjectPrefix = document.getElementById('opsAlertEmailSubjectPrefix');
    if (emailSubjectPrefix) {
        emailSubjectPrefix.value = config.channels.email.subject_prefix;
    }

    const autoDisableCouponMinRiskScore = document.getElementById('opsAlertShopRiskAutoDisableCouponMinRiskScore');
    if (autoDisableCouponMinRiskScore) {
        autoDisableCouponMinRiskScore.value = String(config.shop_order_risk.auto_disable_coupon_min_risk_score);
    }

    const autoBanUserMinRiskScore = document.getElementById('opsAlertShopRiskAutoBanUserMinRiskScore');
    if (autoBanUserMinRiskScore) {
        autoBanUserMinRiskScore.value = String(config.shop_order_risk.auto_ban_user_min_risk_score);
    }

    const autoBanUserDurationDays = document.getElementById('opsAlertShopRiskAutoBanUserDurationDays');
    if (autoBanUserDurationDays) {
        autoBanUserDurationDays.value = String(config.shop_order_risk.auto_ban_user_duration_days);
    }

    const autoSuspendProductMinRiskScore = document.getElementById('opsAlertShopRiskAutoSuspendProductMinRiskScore');
    if (autoSuspendProductMinRiskScore) {
        autoSuspendProductMinRiskScore.value = String(config.shop_order_risk.auto_suspend_product_min_risk_score);
    }

    const inventoryLowStockThreshold = document.getElementById('opsAlertShopInventoryLowStockThreshold');
    if (inventoryLowStockThreshold) {
        inventoryLowStockThreshold.value = String(config.shop_inventory.low_stock_threshold);
    }

    const inventorySweepIntervalMinutes = document.getElementById('opsAlertShopInventorySweepIntervalMinutes');
    if (inventorySweepIntervalMinutes) {
        inventorySweepIntervalMinutes.value = String(Math.max(1, Math.round(Number(config.shop_inventory.sweep_interval_ms || 0) / 60000)));
    }

    const inventorySalesWindowDays = document.getElementById('opsAlertShopInventorySalesWindowDays');
    if (inventorySalesWindowDays) {
        inventorySalesWindowDays.value = String(config.shop_inventory.sales_window_days);
    }

    const inventoryDedupeWindowMinutes = document.getElementById('opsAlertShopInventoryDedupeWindowMinutes');
    if (inventoryDedupeWindowMinutes) {
        inventoryDedupeWindowMinutes.value = String(config.shop_inventory.dedupe_window_minutes);
    }
    const inventorySummaryWindowMinutes = document.getElementById('opsAlertShopInventorySummaryWindowMinutes');
    if (inventorySummaryWindowMinutes) {
        inventorySummaryWindowMinutes.value = String(config.shop_inventory.summary_window_minutes);
    }
    const inventorySummaryScheduleMode = document.getElementById('opsAlertShopInventorySummaryScheduleMode');
    if (inventorySummaryScheduleMode) {
        inventorySummaryScheduleMode.value = config.shop_inventory.summary_schedule_mode;
    }
    const inventorySummaryHourlyMinute = document.getElementById('opsAlertShopInventorySummaryHourlyMinute');
    if (inventorySummaryHourlyMinute) {
        inventorySummaryHourlyMinute.value = String(config.shop_inventory.summary_hourly_minute);
    }
    const inventorySummaryDailyHour = document.getElementById('opsAlertShopInventorySummaryDailyHour');
    if (inventorySummaryDailyHour) {
        inventorySummaryDailyHour.value = String(config.shop_inventory.summary_daily_hour);
    }
    const inventorySummaryDailyMinute = document.getElementById('opsAlertShopInventorySummaryDailyMinute');
    if (inventorySummaryDailyMinute) {
        inventorySummaryDailyMinute.value = String(config.shop_inventory.summary_daily_minute);
    }
    const inventorySummaryMaxItems = document.getElementById('opsAlertShopInventorySummaryMaxItems');
    if (inventorySummaryMaxItems) {
        inventorySummaryMaxItems.value = String(config.shop_inventory.summary_max_items);
    }

    const customerChatMessageSweepIntervalMinutes = document.getElementById('opsAlertCustomerChatMessageSweepIntervalMinutes');
    if (customerChatMessageSweepIntervalMinutes) {
        customerChatMessageSweepIntervalMinutes.value = String(Math.max(1, Math.round(Number(config.customer_chat_message.sweep_interval_ms || 0) / 60000)));
    }

    const customerChatMessageLookbackMinutes = document.getElementById('opsAlertCustomerChatMessageLookbackMinutes');
    if (customerChatMessageLookbackMinutes) {
        customerChatMessageLookbackMinutes.value = String(config.customer_chat_message.lookback_minutes);
    }

    const customerChatMessageDedupeWindowMinutes = document.getElementById('opsAlertCustomerChatMessageDedupeWindowMinutes');
    if (customerChatMessageDedupeWindowMinutes) {
        customerChatMessageDedupeWindowMinutes.value = String(config.customer_chat_message.dedupe_window_minutes);
    }
    const customerChatMessageSummaryWindowMinutes = document.getElementById('opsAlertCustomerChatMessageSummaryWindowMinutes');
    if (customerChatMessageSummaryWindowMinutes) {
        customerChatMessageSummaryWindowMinutes.value = String(config.customer_chat_message.summary_window_minutes);
    }
    const customerChatMessageSummaryScheduleMode = document.getElementById('opsAlertCustomerChatMessageSummaryScheduleMode');
    if (customerChatMessageSummaryScheduleMode) {
        customerChatMessageSummaryScheduleMode.value = config.customer_chat_message.summary_schedule_mode;
    }
    const customerChatMessageSummaryHourlyMinute = document.getElementById('opsAlertCustomerChatMessageSummaryHourlyMinute');
    if (customerChatMessageSummaryHourlyMinute) {
        customerChatMessageSummaryHourlyMinute.value = String(config.customer_chat_message.summary_hourly_minute);
    }
    const customerChatMessageSummaryDailyHour = document.getElementById('opsAlertCustomerChatMessageSummaryDailyHour');
    if (customerChatMessageSummaryDailyHour) {
        customerChatMessageSummaryDailyHour.value = String(config.customer_chat_message.summary_daily_hour);
    }
    const customerChatMessageSummaryDailyMinute = document.getElementById('opsAlertCustomerChatMessageSummaryDailyMinute');
    if (customerChatMessageSummaryDailyMinute) {
        customerChatMessageSummaryDailyMinute.value = String(config.customer_chat_message.summary_daily_minute);
    }
    const customerChatMessageSummaryMaxItems = document.getElementById('opsAlertCustomerChatMessageSummaryMaxItems');
    if (customerChatMessageSummaryMaxItems) {
        customerChatMessageSummaryMaxItems.value = String(config.customer_chat_message.summary_max_items);
    }

    const shopPurchaseSuccessSweepIntervalMinutes = document.getElementById('opsAlertShopPurchaseSuccessSweepIntervalMinutes');
    if (shopPurchaseSuccessSweepIntervalMinutes) {
        shopPurchaseSuccessSweepIntervalMinutes.value = String(Math.max(1, Math.round(Number(config.shop_purchase_success.sweep_interval_ms || 0) / 60000)));
    }

    const shopPurchaseSuccessLookbackMinutes = document.getElementById('opsAlertShopPurchaseSuccessLookbackMinutes');
    if (shopPurchaseSuccessLookbackMinutes) {
        shopPurchaseSuccessLookbackMinutes.value = String(config.shop_purchase_success.lookback_minutes);
    }

    const shopPurchaseSuccessDedupeWindowMinutes = document.getElementById('opsAlertShopPurchaseSuccessDedupeWindowMinutes');
    if (shopPurchaseSuccessDedupeWindowMinutes) {
        shopPurchaseSuccessDedupeWindowMinutes.value = String(config.shop_purchase_success.dedupe_window_minutes);
    }
    const shopPurchaseSuccessSummaryWindowMinutes = document.getElementById('opsAlertShopPurchaseSuccessSummaryWindowMinutes');
    if (shopPurchaseSuccessSummaryWindowMinutes) {
        shopPurchaseSuccessSummaryWindowMinutes.value = String(config.shop_purchase_success.summary_window_minutes);
    }
    const shopPurchaseSuccessSummaryScheduleMode = document.getElementById('opsAlertShopPurchaseSuccessSummaryScheduleMode');
    if (shopPurchaseSuccessSummaryScheduleMode) {
        shopPurchaseSuccessSummaryScheduleMode.value = config.shop_purchase_success.summary_schedule_mode;
    }
    const shopPurchaseSuccessSummaryHourlyMinute = document.getElementById('opsAlertShopPurchaseSuccessSummaryHourlyMinute');
    if (shopPurchaseSuccessSummaryHourlyMinute) {
        shopPurchaseSuccessSummaryHourlyMinute.value = String(config.shop_purchase_success.summary_hourly_minute);
    }
    const shopPurchaseSuccessSummaryDailyHour = document.getElementById('opsAlertShopPurchaseSuccessSummaryDailyHour');
    if (shopPurchaseSuccessSummaryDailyHour) {
        shopPurchaseSuccessSummaryDailyHour.value = String(config.shop_purchase_success.summary_daily_hour);
    }
    const shopPurchaseSuccessSummaryDailyMinute = document.getElementById('opsAlertShopPurchaseSuccessSummaryDailyMinute');
    if (shopPurchaseSuccessSummaryDailyMinute) {
        shopPurchaseSuccessSummaryDailyMinute.value = String(config.shop_purchase_success.summary_daily_minute);
    }
    const shopPurchaseSuccessSummaryMaxItems = document.getElementById('opsAlertShopPurchaseSuccessSummaryMaxItems');
    if (shopPurchaseSuccessSummaryMaxItems) {
        shopPurchaseSuccessSummaryMaxItems.value = String(config.shop_purchase_success.summary_max_items);
    }

    const walletRechargeSuccessSweepIntervalMinutes = document.getElementById('opsAlertWalletRechargeSuccessSweepIntervalMinutes');
    if (walletRechargeSuccessSweepIntervalMinutes) {
        walletRechargeSuccessSweepIntervalMinutes.value = String(Math.max(1, Math.round(Number(config.wallet_recharge_success.sweep_interval_ms || 0) / 60000)));
    }

    const walletRechargeSuccessLookbackMinutes = document.getElementById('opsAlertWalletRechargeSuccessLookbackMinutes');
    if (walletRechargeSuccessLookbackMinutes) {
        walletRechargeSuccessLookbackMinutes.value = String(config.wallet_recharge_success.lookback_minutes);
    }

    const walletRechargeSuccessDedupeWindowMinutes = document.getElementById('opsAlertWalletRechargeSuccessDedupeWindowMinutes');
    if (walletRechargeSuccessDedupeWindowMinutes) {
        walletRechargeSuccessDedupeWindowMinutes.value = String(config.wallet_recharge_success.dedupe_window_minutes);
    }
    const walletRechargeSuccessSummaryWindowMinutes = document.getElementById('opsAlertWalletRechargeSuccessSummaryWindowMinutes');
    if (walletRechargeSuccessSummaryWindowMinutes) {
        walletRechargeSuccessSummaryWindowMinutes.value = String(config.wallet_recharge_success.summary_window_minutes);
    }
    const walletRechargeSuccessSummaryScheduleMode = document.getElementById('opsAlertWalletRechargeSuccessSummaryScheduleMode');
    if (walletRechargeSuccessSummaryScheduleMode) {
        walletRechargeSuccessSummaryScheduleMode.value = config.wallet_recharge_success.summary_schedule_mode;
    }
    const walletRechargeSuccessSummaryHourlyMinute = document.getElementById('opsAlertWalletRechargeSuccessSummaryHourlyMinute');
    if (walletRechargeSuccessSummaryHourlyMinute) {
        walletRechargeSuccessSummaryHourlyMinute.value = String(config.wallet_recharge_success.summary_hourly_minute);
    }
    const walletRechargeSuccessSummaryDailyHour = document.getElementById('opsAlertWalletRechargeSuccessSummaryDailyHour');
    if (walletRechargeSuccessSummaryDailyHour) {
        walletRechargeSuccessSummaryDailyHour.value = String(config.wallet_recharge_success.summary_daily_hour);
    }
    const walletRechargeSuccessSummaryDailyMinute = document.getElementById('opsAlertWalletRechargeSuccessSummaryDailyMinute');
    if (walletRechargeSuccessSummaryDailyMinute) {
        walletRechargeSuccessSummaryDailyMinute.value = String(config.wallet_recharge_success.summary_daily_minute);
    }
    const walletRechargeSuccessSummaryMaxItems = document.getElementById('opsAlertWalletRechargeSuccessSummaryMaxItems');
    if (walletRechargeSuccessSummaryMaxItems) {
        walletRechargeSuccessSummaryMaxItems.value = String(config.wallet_recharge_success.summary_max_items);
    }

    const ticketsSweepIntervalMinutes = document.getElementById('opsAlertTicketsSweepIntervalMinutes');
    if (ticketsSweepIntervalMinutes) {
        ticketsSweepIntervalMinutes.value = String(Math.max(1, Math.round(Number(config.tickets.sweep_interval_ms || 0) / 60000)));
    }
    const ticketsPendingOverdueMinutes = document.getElementById('opsAlertTicketsPendingOverdueMinutes');
    if (ticketsPendingOverdueMinutes) {
        ticketsPendingOverdueMinutes.value = String(config.tickets.pending_overdue_minutes);
    }
    const ticketsCriticalOverdueMinutes = document.getElementById('opsAlertTicketsCriticalOverdueMinutes');
    if (ticketsCriticalOverdueMinutes) {
        ticketsCriticalOverdueMinutes.value = String(config.tickets.critical_overdue_minutes);
    }
    const ticketsStateLookbackMinutes = document.getElementById('opsAlertTicketsStateLookbackMinutes');
    if (ticketsStateLookbackMinutes) {
        ticketsStateLookbackMinutes.value = String(config.tickets.state_lookback_minutes);
    }

    const ticketsDedupeWindowMinutes = document.getElementById('opsAlertTicketsDedupeWindowMinutes');
    if (ticketsDedupeWindowMinutes) {
        ticketsDedupeWindowMinutes.value = String(config.tickets.dedupe_window_minutes);
    }
    const ticketsSummaryWindowMinutes = document.getElementById('opsAlertTicketsSummaryWindowMinutes');
    if (ticketsSummaryWindowMinutes) {
        ticketsSummaryWindowMinutes.value = String(config.tickets.summary_window_minutes);
    }
    const ticketsSummaryScheduleMode = document.getElementById('opsAlertTicketsSummaryScheduleMode');
    if (ticketsSummaryScheduleMode) {
        ticketsSummaryScheduleMode.value = config.tickets.summary_schedule_mode;
    }
    const ticketsSummaryHourlyMinute = document.getElementById('opsAlertTicketsSummaryHourlyMinute');
    if (ticketsSummaryHourlyMinute) {
        ticketsSummaryHourlyMinute.value = String(config.tickets.summary_hourly_minute);
    }
    const ticketsSummaryDailyHour = document.getElementById('opsAlertTicketsSummaryDailyHour');
    if (ticketsSummaryDailyHour) {
        ticketsSummaryDailyHour.value = String(config.tickets.summary_daily_hour);
    }
    const ticketsSummaryDailyMinute = document.getElementById('opsAlertTicketsSummaryDailyMinute');
    if (ticketsSummaryDailyMinute) {
        ticketsSummaryDailyMinute.value = String(config.tickets.summary_daily_minute);
    }
    const ticketsSummaryMaxItems = document.getElementById('opsAlertTicketsSummaryMaxItems');
    if (ticketsSummaryMaxItems) {
        ticketsSummaryMaxItems.value = String(config.tickets.summary_max_items);
    }

    const shopOrderDeliveryLookbackDays = document.getElementById('opsAlertShopOrderDeliveryLookbackDays');
    if (shopOrderDeliveryLookbackDays) {
        shopOrderDeliveryLookbackDays.value = String(config.shop_order_delivery.lookback_days);
    }
    const shopOrderDeliveryStateLookbackMinutes = document.getElementById('opsAlertShopOrderDeliveryStateLookbackMinutes');
    if (shopOrderDeliveryStateLookbackMinutes) {
        shopOrderDeliveryStateLookbackMinutes.value = String(config.shop_order_delivery.state_lookback_minutes);
    }
    const shopOrderDeliveryRetryWaitingMinAttempts = document.getElementById('opsAlertShopOrderDeliveryRetryWaitingMinAttempts');
    if (shopOrderDeliveryRetryWaitingMinAttempts) {
        shopOrderDeliveryRetryWaitingMinAttempts.value = String(config.shop_order_delivery.retry_waiting_min_attempts);
    }
    const shopOrderDeliverySweepIntervalMinutes = document.getElementById('opsAlertShopOrderDeliverySweepIntervalMinutes');
    if (shopOrderDeliverySweepIntervalMinutes) {
        shopOrderDeliverySweepIntervalMinutes.value = String(Math.max(1, Math.round(Number(config.shop_order_delivery.sweep_interval_ms || 0) / 60000)));
    }
    const shopOrderDeliveryDedupeWindowMinutes = document.getElementById('opsAlertShopOrderDeliveryDedupeWindowMinutes');
    if (shopOrderDeliveryDedupeWindowMinutes) {
        shopOrderDeliveryDedupeWindowMinutes.value = String(config.shop_order_delivery.dedupe_window_minutes);
    }
    const shopOrderDeliveryIncidentMinOrderCount = document.getElementById('opsAlertShopOrderDeliveryIncidentMinOrderCount');
    if (shopOrderDeliveryIncidentMinOrderCount) {
        shopOrderDeliveryIncidentMinOrderCount.value = String(config.shop_order_delivery.incident_min_order_count);
    }
    const shopOrderDeliveryIncidentMinDeadLetterCount = document.getElementById('opsAlertShopOrderDeliveryIncidentMinDeadLetterCount');
    if (shopOrderDeliveryIncidentMinDeadLetterCount) {
        shopOrderDeliveryIncidentMinDeadLetterCount.value = String(config.shop_order_delivery.incident_min_dead_letter_count);
    }
    const shopOrderDeliveryIncidentMinDistinctUsers = document.getElementById('opsAlertShopOrderDeliveryIncidentMinDistinctUsers');
    if (shopOrderDeliveryIncidentMinDistinctUsers) {
        shopOrderDeliveryIncidentMinDistinctUsers.value = String(config.shop_order_delivery.incident_min_distinct_users);
    }
    const shopOrderDeliveryIncidentDedupeWindowMinutes = document.getElementById('opsAlertShopOrderDeliveryIncidentDedupeWindowMinutes');
    if (shopOrderDeliveryIncidentDedupeWindowMinutes) {
        shopOrderDeliveryIncidentDedupeWindowMinutes.value = String(config.shop_order_delivery.incident_dedupe_window_minutes);
    }
    const shopOrderDeliverySummaryWindowMinutes = document.getElementById('opsAlertShopOrderDeliverySummaryWindowMinutes');
    if (shopOrderDeliverySummaryWindowMinutes) {
        shopOrderDeliverySummaryWindowMinutes.value = String(config.shop_order_delivery.summary_window_minutes);
    }
    const shopOrderDeliverySummaryScheduleMode = document.getElementById('opsAlertShopOrderDeliverySummaryScheduleMode');
    if (shopOrderDeliverySummaryScheduleMode) {
        shopOrderDeliverySummaryScheduleMode.value = config.shop_order_delivery.summary_schedule_mode;
    }
    const shopOrderDeliverySummaryHourlyMinute = document.getElementById('opsAlertShopOrderDeliverySummaryHourlyMinute');
    if (shopOrderDeliverySummaryHourlyMinute) {
        shopOrderDeliverySummaryHourlyMinute.value = String(config.shop_order_delivery.summary_hourly_minute);
    }
    const shopOrderDeliverySummaryDailyHour = document.getElementById('opsAlertShopOrderDeliverySummaryDailyHour');
    if (shopOrderDeliverySummaryDailyHour) {
        shopOrderDeliverySummaryDailyHour.value = String(config.shop_order_delivery.summary_daily_hour);
    }
    const shopOrderDeliverySummaryDailyMinute = document.getElementById('opsAlertShopOrderDeliverySummaryDailyMinute');
    if (shopOrderDeliverySummaryDailyMinute) {
        shopOrderDeliverySummaryDailyMinute.value = String(config.shop_order_delivery.summary_daily_minute);
    }
    const shopOrderDeliverySummaryMaxItems = document.getElementById('opsAlertShopOrderDeliverySummaryMaxItems');
    if (shopOrderDeliverySummaryMaxItems) {
        shopOrderDeliverySummaryMaxItems.value = String(config.shop_order_delivery.summary_max_items);
    }

    const verifyQuotaLowBalanceThreshold = document.getElementById('opsAlertVerifyQuotaLowBalanceThreshold');
    if (verifyQuotaLowBalanceThreshold) {
        verifyQuotaLowBalanceThreshold.value = String(config.verify_quota.low_balance_threshold);
    }
    const verifyQuotaLowRemainingJobsThreshold = document.getElementById('opsAlertVerifyQuotaLowRemainingJobsThreshold');
    if (verifyQuotaLowRemainingJobsThreshold) {
        verifyQuotaLowRemainingJobsThreshold.value = String(config.verify_quota.low_remaining_jobs_threshold);
    }
    const verifyQuotaCriticalBalanceThreshold = document.getElementById('opsAlertVerifyQuotaCriticalBalanceThreshold');
    if (verifyQuotaCriticalBalanceThreshold) {
        verifyQuotaCriticalBalanceThreshold.value = String(config.verify_quota.critical_balance_threshold);
    }
    const verifyQuotaCriticalRemainingJobsThreshold = document.getElementById('opsAlertVerifyQuotaCriticalRemainingJobsThreshold');
    if (verifyQuotaCriticalRemainingJobsThreshold) {
        verifyQuotaCriticalRemainingJobsThreshold.value = String(config.verify_quota.critical_remaining_jobs_threshold);
    }
    const verifyQuotaMinQueueBufferJobs = document.getElementById('opsAlertVerifyQuotaMinQueueBufferJobs');
    if (verifyQuotaMinQueueBufferJobs) {
        verifyQuotaMinQueueBufferJobs.value = String(config.verify_quota.min_queue_buffer_jobs);
    }
    const verifyQuotaSweepIntervalMinutes = document.getElementById('opsAlertVerifyQuotaSweepIntervalMinutes');
    if (verifyQuotaSweepIntervalMinutes) {
        verifyQuotaSweepIntervalMinutes.value = String(Math.max(1, Math.round(Number(config.verify_quota.sweep_interval_ms || 0) / 60000)));
    }
    const verifyQuotaDedupeWindowMinutes = document.getElementById('opsAlertVerifyQuotaDedupeWindowMinutes');
    if (verifyQuotaDedupeWindowMinutes) {
        verifyQuotaDedupeWindowMinutes.value = String(config.verify_quota.dedupe_window_minutes);
    }
    const verifyQuotaSummaryWindowMinutes = document.getElementById('opsAlertVerifyQuotaSummaryWindowMinutes');
    if (verifyQuotaSummaryWindowMinutes) {
        verifyQuotaSummaryWindowMinutes.value = String(config.verify_quota.summary_window_minutes);
    }
    const verifyQuotaSummaryScheduleMode = document.getElementById('opsAlertVerifyQuotaSummaryScheduleMode');
    if (verifyQuotaSummaryScheduleMode) {
        verifyQuotaSummaryScheduleMode.value = config.verify_quota.summary_schedule_mode;
    }
    const verifyQuotaSummaryHourlyMinute = document.getElementById('opsAlertVerifyQuotaSummaryHourlyMinute');
    if (verifyQuotaSummaryHourlyMinute) {
        verifyQuotaSummaryHourlyMinute.value = String(config.verify_quota.summary_hourly_minute);
    }
    const verifyQuotaSummaryDailyHour = document.getElementById('opsAlertVerifyQuotaSummaryDailyHour');
    if (verifyQuotaSummaryDailyHour) {
        verifyQuotaSummaryDailyHour.value = String(config.verify_quota.summary_daily_hour);
    }
    const verifyQuotaSummaryDailyMinute = document.getElementById('opsAlertVerifyQuotaSummaryDailyMinute');
    if (verifyQuotaSummaryDailyMinute) {
        verifyQuotaSummaryDailyMinute.value = String(config.verify_quota.summary_daily_minute);
    }
    const verifyQuotaSummaryMaxItems = document.getElementById('opsAlertVerifyQuotaSummaryMaxItems');
    if (verifyQuotaSummaryMaxItems) {
        verifyQuotaSummaryMaxItems.value = String(config.verify_quota.summary_max_items);
    }

    const verifyQueueRecentActivityLookbackHours = document.getElementById('opsAlertVerifyQueueRecentActivityLookbackHours');
    if (verifyQueueRecentActivityLookbackHours) {
        verifyQueueRecentActivityLookbackHours.value = String(config.verify_queue.recent_activity_lookback_hours);
    }
    const verifyQueueRecentFailureWindowMinutes = document.getElementById('opsAlertVerifyQueueRecentFailureWindowMinutes');
    if (verifyQueueRecentFailureWindowMinutes) {
        verifyQueueRecentFailureWindowMinutes.value = String(config.verify_queue.recent_failure_window_minutes);
    }
    const verifyQueueSizeThreshold = document.getElementById('opsAlertVerifyQueueSizeThreshold');
    if (verifyQueueSizeThreshold) {
        verifyQueueSizeThreshold.value = String(config.verify_queue.queue_size_threshold);
    }
    const verifyQueueActiveJobThreshold = document.getElementById('opsAlertVerifyQueueActiveJobThreshold');
    if (verifyQueueActiveJobThreshold) {
        verifyQueueActiveJobThreshold.value = String(config.verify_queue.active_job_threshold);
    }
    const verifyQueueOldestPendingMinutesThreshold = document.getElementById('opsAlertVerifyQueueOldestPendingMinutesThreshold');
    if (verifyQueueOldestPendingMinutesThreshold) {
        verifyQueueOldestPendingMinutesThreshold.value = String(config.verify_queue.oldest_pending_minutes_threshold);
    }
    const verifyQueueRecentFailureThreshold = document.getElementById('opsAlertVerifyQueueRecentFailureThreshold');
    if (verifyQueueRecentFailureThreshold) {
        verifyQueueRecentFailureThreshold.value = String(config.verify_queue.recent_failure_threshold);
    }
    const verifyQueueSweepIntervalMinutes = document.getElementById('opsAlertVerifyQueueSweepIntervalMinutes');
    if (verifyQueueSweepIntervalMinutes) {
        verifyQueueSweepIntervalMinutes.value = String(Math.max(1, Math.round(Number(config.verify_queue.sweep_interval_ms || 0) / 60000)));
    }
    const verifyQueueDedupeWindowMinutes = document.getElementById('opsAlertVerifyQueueDedupeWindowMinutes');
    if (verifyQueueDedupeWindowMinutes) {
        verifyQueueDedupeWindowMinutes.value = String(config.verify_queue.dedupe_window_minutes);
    }
    const verifyQueueSummaryWindowMinutes = document.getElementById('opsAlertVerifyQueueSummaryWindowMinutes');
    if (verifyQueueSummaryWindowMinutes) {
        verifyQueueSummaryWindowMinutes.value = String(config.verify_queue.summary_window_minutes);
    }
    const verifyQueueSummaryScheduleMode = document.getElementById('opsAlertVerifyQueueSummaryScheduleMode');
    if (verifyQueueSummaryScheduleMode) {
        verifyQueueSummaryScheduleMode.value = config.verify_queue.summary_schedule_mode;
    }
    const verifyQueueSummaryHourlyMinute = document.getElementById('opsAlertVerifyQueueSummaryHourlyMinute');
    if (verifyQueueSummaryHourlyMinute) {
        verifyQueueSummaryHourlyMinute.value = String(config.verify_queue.summary_hourly_minute);
    }
    const verifyQueueSummaryDailyHour = document.getElementById('opsAlertVerifyQueueSummaryDailyHour');
    if (verifyQueueSummaryDailyHour) {
        verifyQueueSummaryDailyHour.value = String(config.verify_queue.summary_daily_hour);
    }
    const verifyQueueSummaryDailyMinute = document.getElementById('opsAlertVerifyQueueSummaryDailyMinute');
    if (verifyQueueSummaryDailyMinute) {
        verifyQueueSummaryDailyMinute.value = String(config.verify_queue.summary_daily_minute);
    }
    const verifyQueueSummaryMaxItems = document.getElementById('opsAlertVerifyQueueSummaryMaxItems');
    if (verifyQueueSummaryMaxItems) {
        verifyQueueSummaryMaxItems.value = String(config.verify_queue.summary_max_items);
    }

    const verifyFailureRecentWindowMinutes = document.getElementById('opsAlertVerifyFailureRecentWindowMinutes');
    if (verifyFailureRecentWindowMinutes) {
        verifyFailureRecentWindowMinutes.value = String(config.verify_failure.recent_window_minutes);
    }
    const verifyFailureMinTotalJobsThreshold = document.getElementById('opsAlertVerifyFailureMinTotalJobsThreshold');
    if (verifyFailureMinTotalJobsThreshold) {
        verifyFailureMinTotalJobsThreshold.value = String(config.verify_failure.min_total_jobs_threshold);
    }
    const verifyFailureRateThreshold = document.getElementById('opsAlertVerifyFailureRateThreshold');
    if (verifyFailureRateThreshold) {
        verifyFailureRateThreshold.value = String(config.verify_failure.failure_rate_threshold);
    }
    const verifyFailureAffectedUserThreshold = document.getElementById('opsAlertVerifyFailureAffectedUserThreshold');
    if (verifyFailureAffectedUserThreshold) {
        verifyFailureAffectedUserThreshold.value = String(config.verify_failure.affected_user_threshold);
    }
    const verifyFailureSweepIntervalMinutes = document.getElementById('opsAlertVerifyFailureSweepIntervalMinutes');
    if (verifyFailureSweepIntervalMinutes) {
        verifyFailureSweepIntervalMinutes.value = String(Math.max(1, Math.round(Number(config.verify_failure.sweep_interval_ms || 0) / 60000)));
    }
    const verifyFailureDedupeWindowMinutes = document.getElementById('opsAlertVerifyFailureDedupeWindowMinutes');
    if (verifyFailureDedupeWindowMinutes) {
        verifyFailureDedupeWindowMinutes.value = String(config.verify_failure.dedupe_window_minutes);
    }
    const verifyFailureSummaryWindowMinutes = document.getElementById('opsAlertVerifyFailureSummaryWindowMinutes');
    if (verifyFailureSummaryWindowMinutes) {
        verifyFailureSummaryWindowMinutes.value = String(config.verify_failure.summary_window_minutes);
    }
    const verifyFailureSummaryScheduleMode = document.getElementById('opsAlertVerifyFailureSummaryScheduleMode');
    if (verifyFailureSummaryScheduleMode) {
        verifyFailureSummaryScheduleMode.value = config.verify_failure.summary_schedule_mode;
    }
    const verifyFailureSummaryHourlyMinute = document.getElementById('opsAlertVerifyFailureSummaryHourlyMinute');
    if (verifyFailureSummaryHourlyMinute) {
        verifyFailureSummaryHourlyMinute.value = String(config.verify_failure.summary_hourly_minute);
    }
    const verifyFailureSummaryDailyHour = document.getElementById('opsAlertVerifyFailureSummaryDailyHour');
    if (verifyFailureSummaryDailyHour) {
        verifyFailureSummaryDailyHour.value = String(config.verify_failure.summary_daily_hour);
    }
    const verifyFailureSummaryDailyMinute = document.getElementById('opsAlertVerifyFailureSummaryDailyMinute');
    if (verifyFailureSummaryDailyMinute) {
        verifyFailureSummaryDailyMinute.value = String(config.verify_failure.summary_daily_minute);
    }
    const verifyFailureSummaryMaxItems = document.getElementById('opsAlertVerifyFailureSummaryMaxItems');
    if (verifyFailureSummaryMaxItems) {
        verifyFailureSummaryMaxItems.value = String(config.verify_failure.summary_max_items);
    }
    const paymentGatewayWindowMinutes = document.getElementById('opsAlertPaymentGatewayWindowMinutes');
    if (paymentGatewayWindowMinutes) {
        paymentGatewayWindowMinutes.value = String(config.payment_gateway.window_minutes);
    }
    const paymentGatewayFailedOrdersThreshold = document.getElementById('opsAlertPaymentGatewayFailedOrdersThreshold');
    if (paymentGatewayFailedOrdersThreshold) {
        paymentGatewayFailedOrdersThreshold.value = String(config.payment_gateway.min_failed_orders);
    }
    const paymentGatewayFailedRatioThreshold = document.getElementById('opsAlertPaymentGatewayFailedRatioThreshold');
    if (paymentGatewayFailedRatioThreshold) {
        paymentGatewayFailedRatioThreshold.value = String(config.payment_gateway.min_failed_ratio_percent);
    }
    const paymentGatewayWebhookSuccessRateThreshold = document.getElementById('opsAlertPaymentGatewayWebhookSuccessRateThreshold');
    if (paymentGatewayWebhookSuccessRateThreshold) {
        paymentGatewayWebhookSuccessRateThreshold.value = String(config.payment_gateway.max_webhook_success_rate_percent);
    }
    const paymentGatewayQuerySuccessRateThreshold = document.getElementById('opsAlertPaymentGatewayQuerySuccessRateThreshold');
    if (paymentGatewayQuerySuccessRateThreshold) {
        paymentGatewayQuerySuccessRateThreshold.value = String(config.payment_gateway.max_query_success_rate_percent);
    }
    const paymentGatewayWebhook5xxThreshold = document.getElementById('opsAlertPaymentGatewayWebhook5xxThreshold');
    if (paymentGatewayWebhook5xxThreshold) {
        paymentGatewayWebhook5xxThreshold.value = String(config.payment_gateway.min_webhook_5xx_count);
    }
    const paymentGatewayQuery5xxThreshold = document.getElementById('opsAlertPaymentGatewayQuery5xxThreshold');
    if (paymentGatewayQuery5xxThreshold) {
        paymentGatewayQuery5xxThreshold.value = String(config.payment_gateway.min_query_5xx_count);
    }
    const paymentGatewaySweepIntervalMinutes = document.getElementById('opsAlertPaymentGatewaySweepIntervalMinutes');
    if (paymentGatewaySweepIntervalMinutes) {
        paymentGatewaySweepIntervalMinutes.value = String(Math.max(1, Math.round(Number(config.payment_gateway.sweep_interval_ms || 0) / 60000)));
    }
    const paymentGatewayDedupeWindowMinutes = document.getElementById('opsAlertPaymentGatewayDedupeWindowMinutes');
    if (paymentGatewayDedupeWindowMinutes) {
        paymentGatewayDedupeWindowMinutes.value = String(config.payment_gateway.dedupe_window_minutes);
    }
    const paymentGatewaySummaryWindowMinutes = document.getElementById('opsAlertPaymentGatewaySummaryWindowMinutes');
    if (paymentGatewaySummaryWindowMinutes) {
        paymentGatewaySummaryWindowMinutes.value = String(config.payment_gateway.summary_window_minutes);
    }
    const paymentGatewaySummaryScheduleMode = document.getElementById('opsAlertPaymentGatewaySummaryScheduleMode');
    if (paymentGatewaySummaryScheduleMode) {
        paymentGatewaySummaryScheduleMode.value = config.payment_gateway.summary_schedule_mode;
    }
    const paymentGatewaySummaryHourlyMinute = document.getElementById('opsAlertPaymentGatewaySummaryHourlyMinute');
    if (paymentGatewaySummaryHourlyMinute) {
        paymentGatewaySummaryHourlyMinute.value = String(config.payment_gateway.summary_hourly_minute);
    }
    const paymentGatewaySummaryDailyHour = document.getElementById('opsAlertPaymentGatewaySummaryDailyHour');
    if (paymentGatewaySummaryDailyHour) {
        paymentGatewaySummaryDailyHour.value = String(config.payment_gateway.summary_daily_hour);
    }
    const paymentGatewaySummaryDailyMinute = document.getElementById('opsAlertPaymentGatewaySummaryDailyMinute');
    if (paymentGatewaySummaryDailyMinute) {
        paymentGatewaySummaryDailyMinute.value = String(config.payment_gateway.summary_daily_minute);
    }
    const paymentGatewaySummaryMaxItems = document.getElementById('opsAlertPaymentGatewaySummaryMaxItems');
    if (paymentGatewaySummaryMaxItems) {
        paymentGatewaySummaryMaxItems.value = String(config.payment_gateway.summary_max_items);
    }

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

function renderOpsAlertOverviewBanner(overviewStatus, healthState = opsAlertHealthState || getDefaultOpsAlertHealthState()) {
    const summaryEl = document.getElementById('opsAlertSummary');
    if (!summaryEl) {
        return;
    }

    const {
        normalizedConfig,
        deliveryIssues,
        enabledChannelCount,
        readyChannelCount,
        configuredTargetChannelCount
    } = overviewStatus;
    const summary = healthState?.summary || getDefaultOpsAlertHealthState().summary;
    const temporaryMuteState = getOpsAlertTemporaryMuteState(normalizedConfig);
    const enabledSeveritySummary = buildOpsAlertEnabledSeveritySummary(normalizedConfig);
    const failedCount = Math.max(0, Number(summary.failed_count || 0));
    const deadLetterCount = Math.max(0, Number(summary.dead_letter_count || 0));
    const totalAttemptCount = Math.max(0, Number(summary.total_attempt_count || 0));
    const lookbackHours = formatVerifyMonitorInteger(summary.lookback_hours || 72);
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

    const badges = [
        buildOpsAlertHealthBadge(normalizedConfig.enabled ? '已启用' : '未启用', normalizedConfig.enabled ? (tone === 'neutral' ? 'success' : tone) : 'neutral'),
        buildOpsAlertHealthBadge(
            enabledChannelCount > 0 ? `${readyChannelCount} / ${enabledChannelCount} 通道就绪` : '0 / 0 通道就绪',
            enabledChannelCount > 0
                ? (readyChannelCount === enabledChannelCount ? 'success' : 'warning')
                : 'neutral'
        ),
        buildOpsAlertHealthBadge(
            `已配置 ${configuredTargetChannelCount} / 3`,
            configuredTargetChannelCount > 0 ? 'success' : 'neutral'
        )
    ];

    if (healthState?.status === 'loading') {
        badges.push(buildOpsAlertHealthBadge('健康页刷新中', 'neutral'));
    } else if (healthState?.status === 'error') {
        badges.push(buildOpsAlertHealthBadge('健康查询失败', 'danger'));
    } else if (normalizedConfig.enabled && totalAttemptCount > 0) {
        badges.push(
            buildOpsAlertHealthBadge(
                `近 ${lookbackHours}h 失败 ${formatVerifyMonitorInteger(failedCount)}`,
                deadLetterCount > 0 ? 'danger' : (failedCount > 0 ? 'warning' : 'success')
            )
        );
        if (deadLetterCount > 0) {
            badges.push(buildOpsAlertHealthBadge(`死信 ${formatVerifyMonitorInteger(deadLetterCount)}`, 'danger'));
        }
    }

    const canSendTest = normalizedConfig.enabled && enabledChannelCount > 0 && deliveryIssues.length === 0;
    const testButtonTitle = canSendTest
        ? '向已启用的站外通道发送测试告警'
        : (!normalizedConfig.enabled
            ? '请先启用站外告警'
            : (enabledChannelCount === 0 ? '请先打开至少一个通道' : '请先补齐通道配置'));

    setOpsAlertOverviewBannerTone(summaryEl, tone);
    summaryEl.innerHTML = `
        <div class="ops-alert-overview-banner__icon">
            <i class="fas ${escapeConfigHtml(icon)}"></i>
        </div>
        <div class="ops-alert-overview-banner__content">
            <div class="ops-alert-overview-banner__headline">${escapeConfigHtml(headline)}</div>
            <div class="ops-alert-overview-banner__meta">${badges.join('')}</div>
            <div class="ops-alert-overview-banner__detail">${escapeConfigHtml(detailParts.join(' '))}</div>
            ${healthState?.fetched_at ? `<div class="ops-alert-overview-banner__stamp">刷新于 ${escapeConfigHtml(formatVerifyMonitorDateTime(healthState.fetched_at))}</div>` : ''}
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
    `;
}

function updateOpsAlertOverviewCard(cardId, titleId, bodyId, tone, titleText, bodyMarkup) {
    const card = document.getElementById(cardId);
    const titleEl = document.getElementById(titleId);
    const bodyEl = document.getElementById(bodyId);
    setOpsAlertOverviewCardTone(card, tone);
    if (titleEl) titleEl.textContent = titleText;
    if (bodyEl) bodyEl.innerHTML = bodyMarkup;
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

function renderOpsAlertOverviewRecentVisuals(summary = {}, status = 'idle') {
    const trendEl = document.getElementById('opsAlertOverviewRecentTrend');
    const segmentsEl = document.getElementById('opsAlertOverviewRecentSegments');
    if (!trendEl || !segmentsEl) {
        return;
    }

    trendEl.hidden = true;
    trendEl.innerHTML = '';
    segmentsEl.hidden = true;
    segmentsEl.innerHTML = '';

    if (status !== 'ready') {
        return;
    }

    const trendBuckets = Array.isArray(summary.recent_trend_buckets) ? summary.recent_trend_buckets : [];
    const maxBucketTotal = trendBuckets.reduce((max, bucket) => (
        Math.max(max, Number(bucket?.total_count || 0))
    ), 0);

    if (trendBuckets.length > 0 && maxBucketTotal > 0) {
        const bars = trendBuckets.map((bucket) => {
            const delivered = Math.max(0, Number(bucket?.delivered_count || 0));
            const failed = Math.max(0, Number(bucket?.failed_count || 0));
            const deadLetter = Math.max(0, Number(bucket?.dead_letter_count || 0));
            const total = delivered + failed + deadLetter;
            const heightPercent = total > 0
                ? Math.max(10, Math.round((total / maxBucketTotal) * 100))
                : 0;
            const tooltip = [
                `${formatOpsAlertTrendBucketLabel(bucket?.bucket_start_at)} - ${formatOpsAlertTrendBucketLabel(bucket?.bucket_end_at)}`,
                `送达 ${formatVerifyMonitorInteger(delivered)} 次`,
                `失败 ${formatVerifyMonitorInteger(failed)} 次`,
                `死信 ${formatVerifyMonitorInteger(deadLetter)} 项`
            ].join(' · ');
            const backgroundStyle = total > 0
                ? `height:${heightPercent}%;background:${buildOpsAlertTrendGradient(bucket)};`
                : '';

            return `
                <div class="ops-alert-overview-trend__bucket" title="${escapeConfigHtml(tooltip)}">
                    <div class="ops-alert-overview-trend__track">
                        <div class="ops-alert-overview-trend__fill${total > 0 ? '' : ' ops-alert-overview-trend__fill--empty'}" style="${backgroundStyle}"></div>
                    </div>
                </div>
            `;
        }).join('');

        const middleIndex = Math.floor((trendBuckets.length - 1) / 2);
        trendEl.innerHTML = `
            <div class="ops-alert-overview-trend">
                <div class="ops-alert-overview-trend__meta">72 小时趋势 · 每 ${escapeConfigHtml(formatVerifyMonitorInteger(summary.trend_bucket_hours || 6))} 小时一段</div>
                <div class="ops-alert-overview-trend__bars">${bars}</div>
                <div class="ops-alert-overview-trend__footer">
                    <span>${escapeConfigHtml(formatOpsAlertTrendBucketLabel(trendBuckets[0]?.bucket_start_at))}</span>
                    <span>${escapeConfigHtml(formatOpsAlertTrendBucketLabel(trendBuckets[middleIndex]?.bucket_start_at))}</span>
                    <span>${escapeConfigHtml(formatOpsAlertTrendBucketLabel(trendBuckets[trendBuckets.length - 1]?.bucket_end_at))}</span>
                </div>
            </div>
        `;
        trendEl.hidden = false;
    }

    const deliveredCount = Math.max(0, Number(summary.delivered_count || 0));
    const failedCount = Math.max(0, Number(summary.failed_count || 0));
    const deadLetterCount = Math.max(0, Number(summary.dead_letter_count || 0));
    const segmentTotal = deliveredCount + failedCount + deadLetterCount;

    if (segmentTotal > 0) {
        const segments = [
            {
                label: '送达',
                value: deliveredCount,
                tone: 'success'
            },
            {
                label: '失败',
                value: failedCount,
                tone: 'warning'
            },
            {
                label: '死信',
                value: deadLetterCount,
                tone: 'danger'
            }
        ].map((segment) => {
            const share = segmentTotal > 0 ? Math.round((segment.value / segmentTotal) * 100) : 0;
            return `
                <div class="ops-alert-overview-segment ops-alert-overview-segment--${escapeConfigHtml(segment.tone)}">
                    <span>${escapeConfigHtml(segment.label)}</span>
                    <strong>${escapeConfigHtml(formatVerifyMonitorInteger(segment.value))}</strong>
                    <em>${escapeConfigHtml(formatVerifyMonitorInteger(share))}%</em>
                </div>
            `;
        }).join('');

        segmentsEl.innerHTML = `
            <div class="ops-alert-overview-segments__meta">分段统计</div>
            <div class="ops-alert-overview-segments">${segments}</div>
        `;
        segmentsEl.hidden = false;
    }
}

function getOpsAlertOverviewStatus(config) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const telegramSecret = opsAlertSecretStatus?.telegram_bot_token || getDefaultOpsAlertSecretStatus().telegram_bot_token;
    const feishuSecret = opsAlertSecretStatus?.feishu_webhook_url || getDefaultOpsAlertSecretStatus().feishu_webhook_url;
    const emailSecret = opsAlertSecretStatus?.email_api_key || getDefaultOpsAlertSecretStatus().email_api_key;
    const telegramChatCount = normalizedConfig.channels.telegram.chat_ids.length;
    const emailRecipientCount = normalizedConfig.channels.email.recipients.length;
    const channelStates = [];
    const deliveryIssues = [];
    const targetSummaries = [];
    const channelOverviewItems = [];
    const targetOverviewItems = [];
    const targetDetailRows = [];
    let enabledChannelCount = 0;
    let readyChannelCount = 0;
    let configuredTargetChannelCount = 0;
    const telegramEnabled = normalizedConfig.channels.telegram.enabled;
    const feishuEnabled = normalizedConfig.channels.feishu.enabled;
    const emailEnabled = normalizedConfig.channels.email.enabled;
    const telegramReady = telegramSecret.configured && telegramChatCount > 0;
    const feishuReady = feishuSecret.configured;
    const emailHasFromAddress = Boolean(normalizedConfig.channels.email.from_address);
    const emailReady = emailSecret.configured && emailRecipientCount > 0 && emailHasFromAddress;

    if (telegramEnabled) {
        enabledChannelCount += 1;
        const telegramSummary = `Telegram · ${normalizedConfig.channels.telegram.minimum_severity}+ · ${telegramChatCount || 0} 个 chat`;
        if (telegramReady) {
            readyChannelCount += 1;
            channelStates.push(`${telegramSummary} · 已就绪`);
        } else {
            channelStates.push(`${telegramSummary} · 待补充配置`);
            if (!telegramSecret.configured) deliveryIssues.push('Telegram Bot Token 未配置');
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
        value: telegramChatCount > 0 ? `${telegramChatCount} 个 chat` : (telegramSecret.configured ? '等待填写 chat' : '未配置目标'),
        meta: [
            telegramEnabled
                ? (telegramReady ? '可直接投递' : '启用中，仍需补齐配置')
                : ((telegramChatCount > 0 || telegramSecret.configured) ? '当前为预设' : '尚未打开'),
            telegramSecret.configured ? 'Bot Token 已配置' : 'Bot Token 未配置'
        ].join(' · '),
        tone: telegramEnabled ? (telegramReady ? 'success' : 'warning') : 'neutral',
        severityLabel: `${normalizedConfig.channels.telegram.minimum_severity}+`,
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
        const feishuSummary = `飞书 · ${normalizedConfig.channels.feishu.minimum_severity}+`;
        if (feishuReady) {
            readyChannelCount += 1;
            channelStates.push(`${feishuSummary} · 已就绪`);
        } else {
            channelStates.push(`${feishuSummary} · 待补充配置`);
            deliveryIssues.push('飞书 Webhook 未配置');
        }
    }
    if (feishuSecret.configured) {
        configuredTargetChannelCount += 1;
        targetSummaries.push('飞书：Webhook 已配置');
    }
    channelOverviewItems.push({
        key: 'feishu',
        label: '飞书',
        value: feishuSecret.configured ? 'Webhook 已配置' : '未配置 Webhook',
        meta: feishuEnabled
            ? (feishuReady ? '可直接投递' : '启用中，仍需补齐 Webhook')
            : (feishuSecret.configured ? '当前为预设' : '尚未打开'),
        tone: feishuEnabled ? (feishuReady ? 'success' : 'warning') : 'neutral',
        severityLabel: `${normalizedConfig.channels.feishu.minimum_severity}+`,
        statusLabel: feishuEnabled ? (feishuReady ? '已就绪' : '待补充') : '未打开',
        statusTone: feishuEnabled ? (feishuReady ? 'success' : 'warning') : 'neutral'
    });
    targetOverviewItems.push({
        key: 'feishu',
        label: '飞书',
        value: feishuSecret.configured ? 'Webhook 已配置' : '未配置 Webhook',
        meta: feishuEnabled ? '打开后会发往群机器人' : '当前为预设目标',
        tone: feishuSecret.configured ? 'success' : (feishuEnabled ? 'warning' : 'neutral'),
        statusLabel: feishuSecret.configured ? '已配置' : (feishuEnabled ? '待配置' : '未配置'),
        statusTone: feishuSecret.configured ? 'success' : (feishuEnabled ? 'warning' : 'neutral')
    });

    if (emailEnabled) {
        enabledChannelCount += 1;
        const emailSummary = `邮件 · ${normalizedConfig.channels.email.minimum_severity}+ · ${emailRecipientCount || 0} 个收件人`;
        if (emailReady) {
            readyChannelCount += 1;
            channelStates.push(`${emailSummary} · 已就绪`);
        } else {
            channelStates.push(`${emailSummary} · 待补充配置`);
            if (!emailSecret.configured) deliveryIssues.push('Email API Key 未配置');
            if (!emailRecipientCount) deliveryIssues.push('邮件收件人未填写');
            if (!emailHasFromAddress) deliveryIssues.push('邮件发件地址未填写');
        }
    }
    if (emailRecipientCount > 0) {
        configuredTargetChannelCount += 1;
        const recipientPreview = normalizedConfig.channels.email.recipients
            .slice(0, 2)
            .join('、');
        const recipientSuffix = emailRecipientCount > 2 ? ' 等' : '';
        targetSummaries.push(`邮件：${emailRecipientCount} 个收件人（${recipientPreview}${recipientSuffix}）`);
    }
    if (normalizedConfig.channels.email.from_address) {
        targetSummaries.push(`发件地址：${normalizedConfig.channels.email.from_address}`);
    }
    if (normalizedConfig.channels.email.reply_to) {
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
        severityLabel: `${normalizedConfig.channels.email.minimum_severity}+`,
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
    if (normalizedConfig.channels.email.from_address) {
        targetDetailRows.push({
            label: '发件地址',
            value: normalizedConfig.channels.email.from_address,
            tone: 'neutral'
        });
    }
    if (normalizedConfig.channels.email.reply_to) {
        targetDetailRows.push({
            label: 'Reply-To',
            value: normalizedConfig.channels.email.reply_to,
            tone: 'neutral'
        });
    }
    if (normalizedConfig.channels.email.subject_prefix) {
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
        configuredTargetChannelCount
    };
}

function renderOpsAlertOverviewCards(config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts'])) {
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
    renderOpsAlertOverviewBanner({
        normalizedConfig,
        channelStates,
        deliveryIssues,
        channelOverviewItems,
        targetOverviewItems,
        targetDetailRows,
        enabledChannelCount,
        readyChannelCount,
        configuredTargetChannelCount
    }, healthState);

    let channelsTone = 'neutral';
    let channelsTitle = '未启用';
    let channelsBody = buildOpsAlertOverviewListMarkup(channelOverviewItems, { compact: true });

    if (normalizedConfig.enabled && enabledChannelCount === 0) {
        channelsTone = 'warning';
        channelsTitle = '0 / 3 已打开';
        channelsBody = buildOpsAlertOverviewListMarkup(channelOverviewItems, { compact: true });
    } else if (enabledChannelCount > 0 && deliveryIssues.length > 0) {
        channelsTone = normalizedConfig.enabled ? 'warning' : 'neutral';
        channelsTitle = `${readyChannelCount} / ${enabledChannelCount} 已就绪`;
        channelsBody = buildOpsAlertOverviewListMarkup(channelOverviewItems);
    } else if (enabledChannelCount > 0) {
        channelsTone = normalizedConfig.enabled ? 'success' : 'neutral';
        channelsTitle = `${readyChannelCount} / ${enabledChannelCount} 已就绪`;
        channelsBody = buildOpsAlertOverviewListMarkup(channelOverviewItems);
    }
    updateOpsAlertOverviewCard(
        'opsAlertOverviewChannelsCard',
        'opsAlertOverviewChannelsTitle',
        'opsAlertOverviewChannels',
        channelsTone,
        channelsTitle,
        channelsBody
    );

    let targetsTone = 'neutral';
    let targetsTitle = '等待配置';
    let targetsBody = buildOpsAlertOverviewListMarkup(targetOverviewItems, { compact: true });
    if (targetOverviewItems.length > 0) {
        if (configuredTargetChannelCount > 0) {
            targetsTone = deliveryIssues.length > 0 ? 'warning' : 'success';
        } else if (normalizedConfig.enabled) {
            targetsTone = 'warning';
        }
        targetsTitle = `已配置 ${configuredTargetChannelCount || 0} / 3`;
        if (targetDetailRows.length) {
            targetsBody += buildOpsAlertOverviewKeyValueMarkup(targetDetailRows, { compact: true });
        }
    }
    updateOpsAlertOverviewCard(
        'opsAlertOverviewTargetsCard',
        'opsAlertOverviewTargetsTitle',
        'opsAlertOverviewTargets',
        targetsTone,
        targetsTitle,
        targetsBody
    );

    let recentTone = 'neutral';
    let recentTitle = '等待刷新';
    let recentBody = buildOpsAlertOverviewEmptyMarkup('告警通道健康页加载后，会在这里显示最近投递摘要。');

    if (healthState.status === 'loading') {
        recentTitle = '正在刷新';
        recentBody = buildOpsAlertOverviewEmptyMarkup(healthState.message || '正在加载站外告警通道健康状态...');
    } else if (healthState.status === 'error') {
        recentTone = 'danger';
        recentTitle = '查询失败';
        recentBody = buildOpsAlertOverviewEmptyMarkup(healthState.message || '加载站外告警通道健康状态失败。');
    } else if (healthState.status === 'ready') {
        const lookbackHours = formatVerifyMonitorInteger(summary.lookback_hours || 0);
        const recentDeliverySummary = buildOpsAlertRecentDeliverySummary(summary.recent_deliveries, {
            limit: 3,
            includeChannel: true
        });
        const recentErrorSummary = buildOpsAlertRecentErrorSummary(summary.recent_errors, 2);
        const recentErrorChannelSummary = buildOpsAlertErrorSourceSummary(summary.recent_error_channels, 3);
        const totalAttemptCount = Math.max(0, Number(summary.total_attempt_count || 0));
        const deliveredCount = Math.max(0, Number(summary.delivered_count || 0));
        const deliveryRateText = totalAttemptCount > 0
            ? `${Math.round((deliveredCount / totalAttemptCount) * 100)}%`
            : '—';
        if (Number(summary.total_attempt_count || 0) > 0) {
            if (Number(summary.dead_letter_count || 0) > 0) {
                recentTone = 'danger';
            } else if (Number(summary.failed_count || 0) > 0) {
                recentTone = 'warning';
            } else {
                recentTone = 'success';
            }
            recentTitle = `近 ${lookbackHours} 小时`;
            const metricsMarkup = buildOpsAlertOverviewMetricMarkup([
                { label: '总投递', value: formatVerifyMonitorInteger(totalAttemptCount) },
                { label: '送达率', value: deliveryRateText },
                { label: '刷新于', value: healthState.fetched_at ? formatVerifyMonitorDateTime(healthState.fetched_at) : '—' }
            ]);
            const detailsMarkup = buildOpsAlertOverviewKeyValueMarkup([
                recentDeliverySummary
                    ? { label: '最近投递', value: recentDeliverySummary, tone: 'neutral' }
                    : null,
                recentErrorSummary
                    ? {
                        label: '最近失败',
                        value: recentErrorSummary,
                        tone: Number(summary.dead_letter_count || 0) > 0 ? 'danger' : 'warning'
                    }
                    : { label: '最近失败', value: '最近没有失败明细', tone: 'success' },
                recentErrorChannelSummary
                    ? {
                        label: '异常来源',
                        value: recentErrorChannelSummary,
                        tone: Number(summary.dead_letter_count || 0) > 0 ? 'danger' : 'warning'
                    }
                    : {
                        label: '异常来源',
                        value: '当前没有集中失败来源',
                        tone: Number(summary.failed_count || 0) > 0 ? 'warning' : 'success'
                    }
            ]);
            recentBody = `${metricsMarkup}${detailsMarkup}`;
        } else if (Array.isArray(healthState.channels) && healthState.channels.length > 0) {
            recentTitle = `近 ${lookbackHours} 小时`;
            recentBody = [
                buildOpsAlertOverviewMetricMarkup([
                    { label: '总投递', value: '0' },
                    { label: '送达率', value: '—' },
                    { label: '刷新于', value: healthState.fetched_at ? formatVerifyMonitorDateTime(healthState.fetched_at) : '—' }
                ]),
                buildOpsAlertOverviewEmptyMarkup('最近没有新的站外投递记录，但通道健康信息已经刷新。')
            ].join('');
        } else {
            recentTitle = '暂无投递';
            recentBody = buildOpsAlertOverviewEmptyMarkup('最近没有可用于评估的站外告警通道数据。');
        }
    }
    updateOpsAlertOverviewCard(
        'opsAlertOverviewRecentCard',
        'opsAlertOverviewRecentTitle',
        'opsAlertOverviewRecent',
        recentTone,
        recentTitle,
        recentBody
    );
    renderOpsAlertOverviewRecentVisuals(summary, healthState.status);
}

function buildOpsAlertRecentDeliverySummary(items = [], options = {}) {
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

function buildOpsAlertRecentErrorSummary(items = [], limit = 2) {
    const normalizedItems = Array.isArray(items) ? items : [];
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
                parts.push(`· ${formatVerifyMonitorInteger(count)} 次`);
            }
            return parts.join(' ');
        })
        .filter(Boolean)
        .join('；');
}

function buildOpsAlertDeliveryTypeSummary(items = [], limit = 3) {
    const normalizedItems = Array.isArray(items) ? items : [];
    return normalizedItems
        .slice(0, Math.max(1, Number(limit) || 3))
        .map((item) => {
            const title = String(item?.title || item?.alert_type || '系统告警').trim();
            const count = Number(item?.count || 0);
            return count > 0 ? `${title} ${formatVerifyMonitorInteger(count)} 次` : title;
        })
        .filter(Boolean)
        .join('；');
}

function buildOpsAlertErrorSourceSummary(items = [], limit = 3) {
    const normalizedItems = Array.isArray(items) ? items : [];
    return normalizedItems
        .slice(0, Math.max(1, Number(limit) || 3))
        .map((item) => {
            const channelLabel = String(item?.channel_label || item?.channel || '未知通道').trim();
            const count = Number(item?.count || 0);
            return count > 0 ? `${channelLabel} ${formatVerifyMonitorInteger(count)} 次` : channelLabel;
        })
        .filter(Boolean)
        .join('；');
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

function renderOpsAlertHealthEmptyState(target, message) {
    if (!target) return;
    target.innerHTML = `<div class="ops-alert-monitor-empty">${escapeConfigHtml(message)}</div>`;
}

function buildOpsAlertHealthBadge(label, tone = 'neutral') {
    return `<span class="ops-alert-monitor-badge ops-alert-monitor-badge--${escapeConfigHtml(tone)}">${escapeConfigHtml(label)}</span>`;
}

function getOpsAlertHealthSourceLabel(source) {
    const normalizedSource = String(source || '').trim().toLowerCase();
    if (normalizedSource === 'stored') return '后台密钥仓';
    if (normalizedSource === 'environment') return '环境变量';
    return '未配置';
}

function getOpsAlertHealthMetaLine(channel = {}) {
    const metaParts = [
        `最小级别：${channel.minimum_severity || 'warning'}`,
        `配置来源：${getOpsAlertHealthSourceLabel(channel.source)}`
    ];

    if (channel.recipient_summary) {
        metaParts.push(channel.recipient_summary);
    }

    if (channel.updated_at) {
        metaParts.push(`更新于 ${formatVerifyMonitorDateTime(channel.updated_at)}`);
    }

    return metaParts.join(' · ');
}

function getOpsAlertHealthLastErrorLine(channel = {}) {
    if (channel.last_error) {
        return `最近错误：${channel.last_error}`;
    }
    if (channel.last_attempt_at) {
        return `最近投递：${formatVerifyMonitorDateTime(channel.last_attempt_at)}`;
    }
    return '最近 72 小时内暂无投递记录';
}

function buildOpsAlertHealthRecentErrorMarkup(channel = {}) {
    const recentErrors = Array.isArray(channel.recent_errors) ? channel.recent_errors : [];
    if (!recentErrors.length) {
        return '<div class="ops-alert-health-card__errors empty">最近没有失败明细。</div>';
    }

    return `
        <div class="ops-alert-health-card__errors">
            ${recentErrors.map((item) => `
                <div class="ops-alert-health-card__error-item">
                    <strong>${escapeConfigHtml(item.message || '未知错误')}</strong>
                    <span>${escapeConfigHtml(formatVerifyMonitorInteger(item.count || 0))} 次 · ${item.last_seen_at ? formatVerifyMonitorDateTime(item.last_seen_at) : '时间未知'}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function getOpsAlertHealthConfigDetails(channel = {}) {
    const details = [];

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

    const recentDeliverySummary = buildOpsAlertRecentDeliverySummary(channel.recent_deliveries, {
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
        details.push({ label: '最近投递', value: formatVerifyMonitorDateTime(channel.last_attempt_at) });
    }

    return details.slice(0, 5);
}

function buildOpsAlertHealthConfigMarkup(channel = {}) {
    const details = getOpsAlertHealthConfigDetails(channel);
    if (!details.length) {
        return '';
    }

    return `
        <div class="ops-alert-health-card__config">
            ${details.map((item) => `
                <div class="ops-alert-health-card__config-item">
                    <span>${escapeConfigHtml(item.label || '')}</span>
                    <strong>${escapeConfigHtml(item.value || '—')}</strong>
                </div>
            `).join('')}
        </div>
    `;
}

function buildOpsAlertHealthCardMarkup(channel = {}) {
    const tone = String(channel.tone || 'neutral').trim().toLowerCase() || 'neutral';
    const deliveryRate = Number(channel.delivery_rate);
    const deliveryRateText = Number.isFinite(deliveryRate) ? `${deliveryRate.toFixed(1)}%` : '—';

    return `
        <article class="ops-alert-health-card ops-alert-health-card--${escapeConfigHtml(tone)}">
            <div class="ops-alert-health-card__head">
                <div>
                    <div class="ops-alert-health-card__title">${escapeConfigHtml(channel.label || '通道')}</div>
                    <div class="ops-alert-health-card__meta">${escapeConfigHtml(getOpsAlertHealthMetaLine(channel))}</div>
                </div>
                <div class="ops-alert-health-card__status">
                    ${buildOpsAlertHealthBadge(channel.enabled ? '已启用' : '未启用', channel.enabled ? (channel.configured ? 'success' : 'warning') : 'neutral')}
                    ${buildOpsAlertHealthBadge(channel.health_label || '未启用', tone)}
                </div>
            </div>
            <div class="ops-alert-health-card__stats">
                <div><strong>${escapeConfigHtml(formatVerifyMonitorInteger(channel.total_attempts || 0))}</strong><span>近窗投递</span></div>
                <div><strong>${escapeConfigHtml(deliveryRateText)}</strong><span>送达率</span></div>
                <div><strong>${escapeConfigHtml(formatVerifyMonitorInteger(channel.dead_letter_count || 0))}</strong><span>死信</span></div>
                <div><strong>${escapeConfigHtml(formatVerifyMonitorInteger(channel.retry_count || 0))}</strong><span>重试</span></div>
            </div>
            ${buildOpsAlertHealthConfigMarkup(channel)}
            <div class="ops-alert-health-card__summary">${escapeConfigHtml(getOpsAlertHealthLastErrorLine(channel))}</div>
            ${buildOpsAlertHealthRecentErrorMarkup(channel)}
        </article>
    `;
}

function renderOpsAlertHealthPanel() {
    const panel = document.getElementById('opsAlertHealthPanel');
    const meta = document.getElementById('opsAlertHealthMeta');
    const grid = document.getElementById('opsAlertHealthGrid');
    if (!panel || !meta || !grid) return;

    const state = opsAlertHealthState || getDefaultOpsAlertHealthState();
    const summary = state.summary || getDefaultOpsAlertHealthState().summary;

    panel.hidden = false;

    if (state.status === 'loading') {
        renderOpsAlertOverviewCards();
        meta.innerHTML = '<i class="fas fa-rotate fa-spin"></i><span>正在加载站外告警通道健康状态...</span>';
        renderOpsAlertHealthEmptyState(grid, '正在加载站外告警通道健康状态...');
        return;
    }

    if (state.status === 'error') {
        renderOpsAlertOverviewCards();
        meta.innerHTML = `<i class="fas fa-triangle-exclamation"></i><span>${escapeConfigHtml(state.message || '加载告警通道健康状态失败。')}</span>`;
        renderOpsAlertHealthEmptyState(grid, state.message || '加载告警通道健康状态失败。');
        return;
    }

    const channels = Array.isArray(state.channels) ? state.channels : [];
    if (!channels.length) {
        renderOpsAlertOverviewCards();
        meta.innerHTML = '<i class="fas fa-circle-info"></i><span>最近没有可用于评估的站外告警通道数据。</span>';
        renderOpsAlertHealthEmptyState(grid, '最近没有可用于评估的站外告警通道数据。');
        return;
    }

    renderOpsAlertOverviewCards();
    meta.innerHTML = `<i class="fas fa-heart-pulse"></i><span>最近 ${escapeConfigHtml(formatVerifyMonitorInteger(summary.lookback_hours || 0))} 小时共记录 ${escapeConfigHtml(formatVerifyMonitorInteger(summary.total_attempt_count || 0))} 次投递，送达 ${escapeConfigHtml(formatVerifyMonitorInteger(summary.delivered_count || 0))} 次，失败 ${escapeConfigHtml(formatVerifyMonitorInteger(summary.failed_count || 0))} 次，死信 ${escapeConfigHtml(formatVerifyMonitorInteger(summary.dead_letter_count || 0))} 项。</span>`;
    grid.innerHTML = channels.map((channel) => buildOpsAlertHealthCardMarkup(channel)).join('');
}

function getOpsAlertMonitorCategoryActions(categoryKey) {
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

function syncOpsAlertMonitorFilterToolbar(filters = getOpsAlertMonitorViewFilters()) {
    document.querySelectorAll('[data-ops-alert-monitor-filter-kind]').forEach((button) => {
        const kind = String(button.dataset.opsAlertMonitorFilterKind || '').trim().toLowerCase();
        const value = String(button.dataset.opsAlertMonitorFilterValue || '').trim().toLowerCase();
        const isActive = filters[kind] === value;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function getOpsAlertMonitorDisplayActiveCount(category = {}) {
    return Number(category.display_active_count ?? category.active_count ?? 0);
}

function getOpsAlertMonitorDisplayCriticalCount(category = {}) {
    return Number(category.display_critical_count ?? category.critical_count ?? 0);
}

function getOpsAlertMonitorCardTone(category = {}) {
    if (getOpsAlertMonitorDisplayCriticalCount(category) > 0) return 'danger';
    if (getOpsAlertMonitorDisplayActiveCount(category) > 0) return 'warning';
    if (String(category.latest_state || '').toLowerCase() === 'recovered') return 'success';
    return 'neutral';
}

function renderOpsAlertMonitorEmptyState(target, message) {
    if (!target) return;
    target.innerHTML = `<div class="ops-alert-monitor-empty">${escapeConfigHtml(message)}</div>`;
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

function getOpsAlertCaseStatusTone(status) {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (normalizedStatus === 'resolved') return 'success';
    if (normalizedStatus === 'claimed') return 'neutral';
    return 'warning';
}

function getOpsAlertCaseStatusLabel(status) {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    const labelMap = {
        open: '待处理',
        claimed: '处理中',
        resolved: '已关闭'
    };
    return labelMap[normalizedStatus] || '待处理';
}

function getOpsAlertMonitorAssignableAdmins() {
    const state = opsAlertMonitorState || getDefaultOpsAlertMonitorState();
    const admins = Array.isArray(state.assignable_admins) ? state.assignable_admins : [];
    if (admins.length) {
        return admins.map((admin) => ({
            id: String(admin.id || '').trim(),
            label: String(admin.label || admin.display_name || admin.email || admin.username || admin.id || '').trim(),
            email: String(admin.email || '').trim(),
            roleName: String(admin.role_name || '').trim().toLowerCase(),
            isCurrent: admin.is_current === true
        })).filter((admin) => admin.id && admin.label);
    }

    const fallbackAdminId = String(state.current_admin_id || '').trim();
    const fallbackAdminLabel = String(state.current_admin_label || '').trim();
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

function getOpsAlertCaseRecentEvents(item = {}) {
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

function getOpsAlertCaseRecentEventText(event = {}) {
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

function getOpsAlertCaseSummaryText(item = {}) {
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

function getShopRiskCaseStatusTone(status) {
    return getOpsAlertCaseStatusTone(status);
}

function getShopRiskCaseStatusLabel(status) {
    return getOpsAlertCaseStatusLabel(status);
}

function getShopRiskCaseSummaryText(item = {}) {
    return getOpsAlertCaseSummaryText(item);
}

function getOpsAlertMonitorItemAction(category = {}, item = {}) {
    const alertType = String(item.alert_type || '').trim().toLowerCase();
    const categoryKey = String(category.key || '').trim().toLowerCase();
    const targetId = String(item.target_id || '').trim().toLowerCase();
    const perType = {
        payment_refund_ops: { target: 'payments-ops', label: '处理退款', icon: 'fas fa-arrow-rotate-left' },
        payment_gateway_degraded: { target: 'payments-overview', label: '查看通道', icon: 'fas fa-credit-card' },
        payment_config_changed: { target: 'admin-audit-monitor', label: '查看审计', icon: 'fas fa-user-shield' },
        payment_config_incident: { target: 'admin-audit-monitor', label: '排查配置风险', icon: 'fas fa-user-shield' },
        ticket_sla_overdue: { target: 'tickets-pending', label: '处理工单', icon: 'fas fa-ticket-alt' },
        ticket_sla_summary: { target: 'tickets-pending', label: '处理工单', icon: 'fas fa-ticket-alt' },
        shop_inventory_low: { target: 'shop-inventory', label: '去补货', icon: 'fas fa-box-open' },
        shop_inventory_empty: { target: 'shop-inventory', label: '去补货', icon: 'fas fa-box-open' },
        shop_order_delivery_summary: { target: 'shop-fulfillment', label: '处理履约', icon: 'fas fa-truck-ramp-box' },
        shop_order_delivery_failed: { target: 'shop-fulfillment', label: '处理履约', icon: 'fas fa-truck-ramp-box' },
        shop_order_delivery_incident: { target: 'shop-fulfillment', label: '处理事故', icon: 'fas fa-triangle-exclamation' }
    };
    if (alertType === 'shop_order_risk_anomaly' || alertType === 'shop_order_risk_recovered') {
        if (targetId.startsWith('shop_order_risk:coupon:')) {
            return { target: 'shop-risk-discounts', label: '查看优惠券码', icon: 'fas fa-ticket' };
        }
        if (targetId.startsWith('shop_order_risk:login_signature:')) {
            return { target: 'shop-risk-users', label: '查看关联账号', icon: 'fas fa-user-shield' };
        }
        if (targetId.startsWith('shop_order_risk:shared_ip:')) {
            return { target: 'shop-risk-users', label: '查看关联账号', icon: 'fas fa-user-shield' };
        }
        if (targetId.startsWith('shop_order_risk:user_velocity:')) {
            return { target: 'shop-risk-users', label: '查看用户详情', icon: 'fas fa-user-shield' };
        }
        return { target: 'shop-risk-orders', label: '查看风险订单', icon: 'fas fa-bag-shopping' };
    }
    const fallbackByCategory = {
        payments: { target: 'payments-ops', label: '进入处理页', icon: 'fas fa-shield-heart' },
        tickets: { target: 'tickets-pending', label: '进入处理页', icon: 'fas fa-ticket-alt' },
        inventory: { target: 'shop-inventory', label: '进入处理页', icon: 'fas fa-box-open' },
        fulfillment: { target: 'shop-fulfillment', label: '进入处理页', icon: 'fas fa-truck-ramp-box' },
        shop_risk: { target: 'shop-risk-orders', label: '进入处理页', icon: 'fas fa-bag-shopping' }
    };
    return perType[alertType] || fallbackByCategory[categoryKey] || null;
}

function getOpsAlertMonitorItemQuickAction(category = {}, item = {}) {
    const alertType = String(item.alert_type || '').trim().toLowerCase();
    const targetId = String(item.target_id || '').trim().toLowerCase();
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

function getOpsAlertMonitorItemCaseActions(category = {}, item = {}) {
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

function buildOpsAlertMonitorContextAttrs(category = {}, item = {}) {
    return {
        'data-workspace-title': item.title || '',
        'data-workspace-alert-type': item.alert_type || '',
        'data-workspace-category': category.key || '',
        'data-workspace-reference-label': item.reference_label || '',
        'data-workspace-reference-value': item.reference_value || '',
        'data-workspace-target-id': item.target_id || '',
        'data-workspace-user-id': item.user_id || '',
        'data-workspace-client-ip': item.client_ip || '',
        'data-workspace-discount-code': item.discount_code || '',
        'data-workspace-signal-type': item.signal_type || '',
        'data-workspace-case-status': item.case_status || '',
        'data-workspace-case-owner-admin-id': item.case_owner_admin_id || '',
        'data-workspace-case-owner-label': item.case_owner_label || ''
    };
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

function buildOpsAlertMonitorItemMarkup(item = {}, category = {}) {
    const categoryKey = String(category.key || '').trim().toLowerCase();
    const severity = String(item.severity || 'warning').trim().toLowerCase();
    const severityTone = getOpsAlertMonitorSeverityTone(severity);
    const riskLevel = String(item.risk_level || '').trim().toLowerCase();
    const riskTone = getOpsAlertMonitorRiskTone(riskLevel);
    const itemAction = getOpsAlertMonitorItemAction(category, item);
    const quickAction = getOpsAlertMonitorItemQuickAction(category, item);
    const caseActions = getOpsAlertMonitorItemCaseActions(category, item);
    const caseStatus = String(item.case_status || '').trim().toLowerCase() || 'open';
    const caseTone = getOpsAlertCaseStatusTone(caseStatus);
    const recentEvents = getOpsAlertCaseRecentEvents(item);
    const metaParts = [
        item.reference_label && item.reference_value
            ? `${escapeConfigHtml(item.reference_label)}：${escapeConfigHtml(item.reference_value)}`
            : '',
        item.created_at ? formatVerifyMonitorDateTime(item.created_at) : ''
    ].filter(Boolean);

    return `
        <article class="ops-alert-monitor-item">
            <div class="ops-alert-monitor-item__top">
                ${buildOpsAlertMonitorBadge(severity === 'critical' ? 'critical' : 'warning', severityTone)}
                ${riskLevel ? buildOpsAlertMonitorBadge(`风险 ${getOpsAlertMonitorRiskLevelLabel(riskLevel)}${Number.isFinite(Number(item.risk_score)) ? ` · ${formatVerifyMonitorInteger(item.risk_score)}` : ''}`, riskTone) : ''}
                ${caseActions.length || item.case_owner_label || item.case_note || item.case_resolution || recentEvents.length
        ? buildOpsAlertMonitorBadge(`处置 ${getOpsAlertCaseStatusLabel(caseStatus)}`, caseTone)
        : ''}
                <strong class="ops-alert-monitor-item__title">${escapeConfigHtml(item.title || '系统告警')}</strong>
            </div>
            ${item.message ? `<div class="ops-alert-monitor-item__summary">${escapeConfigHtml(item.message)}</div>` : ''}
            ${caseActions.length || item.case_owner_label || item.case_note || item.case_resolution || recentEvents.length
        ? `<div class="ops-alert-monitor-item__summary"><strong>${categoryKey === 'shop_risk' ? '值班处理' : '处理进度'}：</strong> ${escapeConfigHtml(getOpsAlertCaseSummaryText(item))}</div>`
        : ''}
            ${recentEvents.length ? `
                <div class="ops-alert-monitor-item__history">
                    ${recentEvents.map((event) => `
                        <div class="ops-alert-monitor-item__history-item">${escapeConfigHtml(getOpsAlertCaseRecentEventText(event))}</div>
                    `).join('')}
                </div>
            ` : ''}
            ${item.auto_response_summary ? `<div class="ops-alert-monitor-item__summary"><strong>自动处置：</strong> ${escapeConfigHtml(item.auto_response_summary)}</div>` : ''}
            ${item.response_summary ? `<div class="ops-alert-monitor-item__summary">${escapeConfigHtml(item.response_summary)}</div>` : ''}
            <div class="ops-alert-monitor-item__meta">${metaParts.length ? metaParts.join(' · ') : '等待更多上下文'}</div>
            ${(itemAction || quickAction || caseActions.length) ? `
                <div class="ops-alert-monitor-item__actions">
                    ${caseActions.map((action) => `
                        <button
                            type="button"
                            class="btn-add-config btn-add-config--compact"
                            ${buildOpsAlertMonitorCaseActionAttrs(action, category, item)}
                        >
                            <i class="${escapeConfigHtml(action.icon)}"></i> ${escapeConfigHtml(action.label)}
                        </button>
                    `).join('')}
                    ${quickAction ? `
                        <button
                            type="button"
                            class="btn-add-config btn-add-config--compact"
                            ${buildOpsAlertMonitorQuickActionAttrs(quickAction, category, item)}
                        >
                            <i class="${escapeConfigHtml(quickAction.icon)}"></i> ${escapeConfigHtml(quickAction.label)}
                        </button>
                    ` : ''}
                    ${itemAction ? `
                        <button
                            type="button"
                            class="btn-add-config btn-add-config--compact"
                            ${buildOpsAlertMonitorWorkspaceAttrs(itemAction, category, item)}
                        >
                            <i class="${escapeConfigHtml(itemAction.icon)}"></i> ${escapeConfigHtml(itemAction.label)}
                        </button>
                    ` : ''}
                </div>
            ` : ''}
        </article>
    `;
}

function buildOpsAlertMonitorCategoryView(category = {}, filters = getOpsAlertMonitorViewFilters()) {
    const normalizedCategoryKey = String(category.key || '').trim().toLowerCase();
    const latestState = String(category.latest_state || '').trim().toLowerCase() || 'idle';
    const allItems = Array.isArray(category.items) ? category.items : [];
    const categoryMatches = filters.category === 'all' || filters.category === normalizedCategoryKey;
    const activeCount = Number(category.active_count || 0);
    const criticalCount = Number(category.critical_count || 0);
    const isRecoveredOnly = activeCount === 0 && latestState === 'recovered';

    if (!categoryMatches) {
        return null;
    }

    if (filters.scope === 'active' && activeCount <= 0) {
        return null;
    }

    if (filters.scope === 'recovered' && latestState !== 'recovered') {
        return null;
    }

    if (filters.severity !== 'all') {
        const severityMatchedItems = allItems.filter((item) => String(item.severity || '').trim().toLowerCase() === filters.severity);
        if (!severityMatchedItems.length) {
            return null;
        }
    }

    const visibleItems = filters.scope === 'recovered'
        ? []
        : allItems.filter((item) => (
            filters.severity === 'all'
                ? true
                : String(item.severity || '').trim().toLowerCase() === filters.severity
        ));
    const previewItems = visibleItems.slice(0, 3);
    const displayActiveCount = filters.scope === 'recovered'
        ? 0
        : (filters.severity === 'all' ? activeCount : visibleItems.length);
    const displayCriticalCount = filters.scope === 'recovered'
        ? 0
        : (filters.severity === 'all'
            ? criticalCount
            : visibleItems.filter((item) => String(item.severity || '').trim().toLowerCase() === 'critical').length);
    const filteredNote = !isRecoveredOnly
        && filters.severity !== 'all'
        && activeCount > visibleItems.length
        ? `当前筛出 ${formatVerifyMonitorInteger(visibleItems.length)} 项 ${filters.severity} 告警；模块原始待关注共 ${formatVerifyMonitorInteger(activeCount)} 项。`
        : '';

    return {
        ...category,
        items: previewItems,
        visible_items: visibleItems,
        hidden_item_count: Math.max(0, visibleItems.length - previewItems.length),
        display_active_count: displayActiveCount,
        display_critical_count: displayCriticalCount,
        filtered_note: filteredNote
    };
}

function getOpsAlertMonitorFilterSummaryLabel(filters = getOpsAlertMonitorViewFilters()) {
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

function buildOpsAlertMonitorRecoveryRow(category = {}) {
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

function buildOpsAlertMonitorBatchRows(categories = [], filters = getOpsAlertMonitorViewFilters(), categoryKey = '') {
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
            return [buildOpsAlertMonitorRecoveryRow(category)];
        }

        return [];
    });
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

function buildOpsAlertMonitorChecklistText(rows = [], filters = getOpsAlertMonitorViewFilters(), categoryKey = '') {
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
    const thresholds = category?.thresholds && typeof category.thresholds === 'object'
        ? category.thresholds
        : null;
    if (!thresholds) {
        return '';
    }

    const badges = [
        buildOpsAlertMonitorBadge(
            thresholds.auto_response_enabled ? '自动处置开启' : '自动处置关闭',
            thresholds.auto_response_enabled ? 'warning' : 'neutral'
        ),
        buildOpsAlertMonitorBadge(`停券 ≥ ${formatVerifyMonitorInteger(thresholds.auto_disable_coupon_min_risk_score || 0)}`, 'neutral'),
        buildOpsAlertMonitorBadge(`封禁 ≥ ${formatVerifyMonitorInteger(thresholds.auto_ban_user_min_risk_score || 0)}`, 'neutral'),
        buildOpsAlertMonitorBadge(`封禁 ${formatVerifyMonitorInteger(thresholds.auto_ban_user_duration_days || 0)} 天`, 'neutral'),
        buildOpsAlertMonitorBadge(`下架 ≥ ${formatVerifyMonitorInteger(thresholds.auto_suspend_product_min_risk_score || 0)}`, 'neutral')
    ];

    return `
        <div class="ops-alert-risk-spotlight__thresholds">
            ${badges.join('')}
        </div>
    `;
}

function buildOpsAlertRiskSpotlightActivityItem(item = {}, kind = 'threshold') {
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

function buildOpsAlertRiskSpotlightMarkup(category = null, filters = getOpsAlertMonitorViewFilters()) {
    const actions = getOpsAlertMonitorCategoryActions('shop_risk');
    const spotlightCategory = category && typeof category === 'object' ? category : null;
    const tone = spotlightCategory ? getOpsAlertMonitorCardTone(spotlightCategory) : 'neutral';
    const latestItem = Array.isArray(spotlightCategory?.visible_items) && spotlightCategory.visible_items.length
        ? spotlightCategory.visible_items[0]
        : (Array.isArray(spotlightCategory?.items) && spotlightCategory.items.length ? spotlightCategory.items[0] : null);
    const latestQuickAction = latestItem ? getOpsAlertMonitorItemQuickAction(spotlightCategory || {}, latestItem) : null;
    const activeCount = spotlightCategory ? getOpsAlertMonitorDisplayActiveCount(spotlightCategory) : 0;
    const criticalCount = spotlightCategory ? getOpsAlertMonitorDisplayCriticalCount(spotlightCategory) : 0;
    const caseSummary = spotlightCategory && typeof spotlightCategory.case_summary === 'object'
        ? spotlightCategory.case_summary
        : { open: 0, claimed: 0, resolved: 0 };
    const title = spotlightCategory
        ? (
            activeCount > 0
                ? `当前有 ${formatVerifyMonitorInteger(activeCount)} 项商城风控信号待接手`
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
            filters.severity !== 'all' || filters.scope !== 'all'
                ? '当前筛选条件下没有命中的商城风控信号，可以切回“全部状态 / 全部级别”查看全量快照。'
                : '最近没有持续中的商城风控告警，下面保留订单、优惠券码和用户处理入口。'
        );
    const stats = [
        buildOpsAlertMonitorBadge(`${formatVerifyMonitorInteger(activeCount)} 待关注`, activeCount > 0 ? 'warning' : 'neutral')
    ];

    if (spotlightCategory) {
        stats.push(buildOpsAlertMonitorBadge(`${formatVerifyMonitorInteger(caseSummary.open || 0)} 待认领`, 'warning'));
        stats.push(buildOpsAlertMonitorBadge(`${formatVerifyMonitorInteger(caseSummary.claimed || 0)} 处理中`, 'neutral'));
    }

    if (criticalCount > 0) {
        stats.push(buildOpsAlertMonitorBadge(`${formatVerifyMonitorInteger(criticalCount)} critical`, 'danger'));
    }
    if (spotlightCategory && String(spotlightCategory.latest_state || '').toLowerCase() === 'recovered' && activeCount <= 0) {
        stats.push(buildOpsAlertMonitorBadge('已恢复', 'success'));
    }
    if (!spotlightCategory) {
        stats.push(buildOpsAlertMonitorBadge('等待更多上下文', 'neutral'));
    }

    const thresholdHits = Array.isArray(spotlightCategory?.recent_threshold_hits)
        ? spotlightCategory.recent_threshold_hits.slice(0, 4)
        : [];
    const autoResponses = Array.isArray(spotlightCategory?.recent_auto_responses)
        ? spotlightCategory.recent_auto_responses.slice(0, 4)
        : [];

    return `
        <div class="ops-alert-risk-spotlight ops-alert-risk-spotlight--${escapeConfigHtml(tone)}">
            <div class="ops-alert-risk-spotlight__copy">
                <div class="ops-alert-risk-spotlight__eyebrow">商城风控优先处理</div>
                <div class="ops-alert-risk-spotlight__title">${escapeConfigHtml(title)}</div>
                <div class="ops-alert-risk-spotlight__summary">${escapeConfigHtml(summary)}</div>
            </div>
            <div class="ops-alert-risk-spotlight__stats">
                ${stats.join('')}
            </div>
            ${spotlightCategory ? buildOpsAlertRiskThresholdBadges(spotlightCategory) : ''}
            <div class="ops-alert-risk-spotlight__panels">
                ${buildOpsAlertRiskSpotlightActivitySection(
        '最近阈值命中',
        thresholdHits,
        '最近没有新的风控阈值命中记录。',
        'threshold'
    )}
                ${buildOpsAlertRiskSpotlightActivitySection(
        '最近自动处置',
        autoResponses,
        '最近没有新的自动停券、封禁或下架记录。',
        'auto'
    )}
            </div>
            <div class="ops-alert-risk-spotlight__actions">
                <button
                    type="button"
                    class="btn-add-config btn-add-config--compact"
                    data-admin-action="settings-copy-ops-alert-monitor-category"
                    data-ops-alert-monitor-category-key="shop_risk"
                >
                    <i class="fas fa-list-check"></i> 复制商城风控清单
                </button>
                ${latestQuickAction && latestItem ? `
                    <button
                        type="button"
                        class="btn-add-config btn-add-config--compact"
                        ${buildOpsAlertMonitorQuickActionAttrs(latestQuickAction, spotlightCategory || {}, latestItem)}
                    >
                        <i class="${escapeConfigHtml(latestQuickAction.icon)}"></i> ${escapeConfigHtml(latestQuickAction.label)}
                    </button>
                ` : ''}
                ${actions.map((action) => `
                    <button
                        type="button"
                        class="btn-add-config btn-add-config--compact"
                        data-admin-action="settings-open-ops-alert-workspace"
                        data-workspace-target="${escapeConfigHtml(action.target)}"
                    >
                        <i class="${escapeConfigHtml(action.icon)}"></i> ${escapeConfigHtml(action.label)}
                    </button>
                `).join('')}
            </div>
        </div>
    `;
}

function renderOpsAlertRiskSpotlight(filters = getOpsAlertMonitorViewFilters()) {
    const target = document.getElementById('opsAlertRiskSpotlight');
    if (!target) return;

    const state = opsAlertMonitorState || getDefaultOpsAlertMonitorState();
    if (state.status === 'loading') {
        target.innerHTML = buildOpsAlertRiskSpotlightMarkup(null, filters);
        return;
    }

    if (state.status === 'error') {
        target.innerHTML = `
            <div class="ops-alert-risk-spotlight ops-alert-risk-spotlight--danger">
                <div class="ops-alert-risk-spotlight__copy">
                    <div class="ops-alert-risk-spotlight__eyebrow">商城风控优先处理</div>
                    <div class="ops-alert-risk-spotlight__title">商城风控快照加载失败</div>
                    <div class="ops-alert-risk-spotlight__summary">${escapeConfigHtml(state.message || '请刷新面板后重试。')}</div>
                </div>
                <div class="ops-alert-risk-spotlight__stats">
                    ${buildOpsAlertMonitorBadge('加载失败', 'danger')}
                </div>
                <div class="ops-alert-risk-spotlight__actions">
                    <button type="button" class="btn-add-config btn-add-config--compact" data-admin-action="settings-refresh-ops-alert-monitor">
                        <i class="fas fa-rotate"></i> 刷新面板
                    </button>
                    <button type="button" class="btn-add-config btn-add-config--compact" data-admin-action="settings-open-ops-alert-workspace" data-workspace-target="shop-risk-orders">
                        <i class="fas fa-bag-shopping"></i> 风险订单
                    </button>
                </div>
            </div>
        `;
        return;
    }

    target.innerHTML = buildOpsAlertRiskSpotlightMarkup(getOpsAlertRiskSpotlightCategory(filters), filters);
}

function buildOpsAlertMonitorCategoryMarkup(category = {}, filters = getOpsAlertMonitorViewFilters()) {
    const tone = getOpsAlertMonitorCardTone(category);
    const actions = getOpsAlertMonitorCategoryActions(category.key);
    const items = Array.isArray(category.items) ? category.items : [];
    const hiddenItemCount = Number(category.hidden_item_count || 0);
    const caseSummary = category && typeof category.case_summary === 'object'
        ? category.case_summary
        : { open: 0, claimed: 0, resolved: 0 };
    const latestSummary = category.latest_title
        ? `${category.latest_title}${category.latest_at ? ` · ${formatVerifyMonitorDateTime(category.latest_at)}` : ''}`
        : '最近还没有收集到这类告警。';
    const latestMessage = category.filtered_note
        || category.latest_message
        || (getOpsAlertMonitorDisplayActiveCount(category) > 0
            ? `当前有 ${formatVerifyMonitorInteger(getOpsAlertMonitorDisplayActiveCount(category))} 项待关注告警。`
            : '当前没有持续中的待关注告警。');

    return `
        <article class="ops-alert-monitor-card ops-alert-monitor-card--${escapeConfigHtml(tone)}">
            <div class="ops-alert-monitor-card__head">
                <div class="ops-alert-monitor-card__copy">
                    <div class="ops-alert-monitor-card__title">${escapeConfigHtml(category.label || '告警分类')}</div>
                    <div class="ops-alert-monitor-card__desc">${escapeConfigHtml(category.description || '')}</div>
                </div>
                <div class="ops-alert-monitor-card__stats">
                    ${buildOpsAlertMonitorBadge(`${formatVerifyMonitorInteger(getOpsAlertMonitorDisplayActiveCount(category))} 待关注`, getOpsAlertMonitorDisplayActiveCount(category) > 0 ? 'warning' : 'neutral')}
                    ${Number(caseSummary.claimed || 0) > 0 ? buildOpsAlertMonitorBadge(`${formatVerifyMonitorInteger(caseSummary.claimed || 0)} 处理中`, 'neutral') : ''}
                    ${getOpsAlertMonitorDisplayCriticalCount(category) > 0 ? buildOpsAlertMonitorBadge(`${formatVerifyMonitorInteger(getOpsAlertMonitorDisplayCriticalCount(category))} critical`, 'danger') : ''}
                    ${String(filters.scope || 'all') === 'recovered' || (getOpsAlertMonitorDisplayActiveCount(category) === 0 && String(category.latest_state || '').toLowerCase() === 'recovered')
        ? buildOpsAlertMonitorBadge('已恢复', 'success')
        : ''}
                </div>
            </div>
            <div class="ops-alert-monitor-card__latest">
                <strong>${escapeConfigHtml(latestSummary)}</strong>
                <span>${escapeConfigHtml(latestMessage)}</span>
            </div>
            <div class="ops-alert-monitor-card__items">
                ${items.length
        ? items.map((item) => buildOpsAlertMonitorItemMarkup(item, category)).join('')
        : `<div class="ops-alert-monitor-empty">${escapeConfigHtml(
            String(category.latest_state || '').toLowerCase() === 'recovered'
                ? '最近一条同类告警已经恢复，可进入对应模块做一次复核。'
                : (String(filters.severity || 'all') === 'all'
                    ? '当前没有持续中的待处理告警。'
                    : `当前筛选条件下没有命中的 ${filters.severity} 告警。`)
        )}</div>`}
            </div>
            ${hiddenItemCount > 0 ? `
                <div class="ops-alert-monitor-card__hint">当前卡片仅展示前 3 项，另有 ${escapeConfigHtml(formatVerifyMonitorInteger(hiddenItemCount))} 项可通过“复制清单 / 导出 CSV”带走处理。</div>
            ` : ''}
            <div class="ops-alert-monitor-card__actions">
                <button
                    type="button"
                    class="btn-add-config btn-add-config--compact"
                    data-admin-action="settings-copy-ops-alert-monitor-category"
                    data-ops-alert-monitor-category-key="${escapeConfigHtml(category.key || '')}"
                >
                    <i class="fas fa-list-check"></i> 复制清单
                </button>
                ${actions.map((action) => `
                    <button
                        type="button"
                        class="btn-add-config btn-add-config--compact"
                        data-admin-action="settings-open-ops-alert-workspace"
                        data-workspace-target="${escapeConfigHtml(action.target)}"
                    >
                        <i class="${escapeConfigHtml(action.icon)}"></i> ${escapeConfigHtml(action.label)}
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

function buildOpsAlertCaseMutationItems(items = [], categoryKey = '') {
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

function getOpsAlertMonitorBatchMuteModuleKeys(filters = getOpsAlertMonitorViewFilters(), categoryKey = '') {
    const normalizedCategoryKey = String(categoryKey || '').trim().toLowerCase();
    const categoryToModuleKey = {
        payments: 'payments',
        tickets: 'tickets',
        inventory: 'inventory',
        fulfillment: 'fulfillment',
        shop_risk: 'shop_risk'
    };

    return Array.from(new Set(
        getOpsAlertMonitorPreparedCategories(filters)
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

function getOpsAlertMuteModuleLabel(moduleKey = '') {
    const definition = OPS_ALERT_MUTE_RULE_MODULE_DEFINITIONS.find((item) => item.key === String(moduleKey || '').trim().toLowerCase());
    return definition?.label || String(moduleKey || '').trim() || '模块';
}

function getOpsAlertMonitorBatchItems(filters = getOpsAlertMonitorViewFilters(), action = '', categoryKey = '') {
    const normalizedAction = String(action || '').trim().toLowerCase();
    const normalizedCategoryKey = String(categoryKey || '').trim().toLowerCase();
    const categories = getOpsAlertMonitorPreparedCategories(filters);

    return categories.flatMap((category) => {
        const currentCategoryKey = String(category.key || '').trim().toLowerCase();
        if (normalizedCategoryKey && currentCategoryKey !== normalizedCategoryKey) {
            return [];
        }

        return buildOpsAlertCaseMutationItems(category.visible_items || [], currentCategoryKey);
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

function renderOpsAlertMonitorBatchActions(filters = getOpsAlertMonitorViewFilters()) {
    const setButtonState = (actionName, count, emptyTitle, activeTitle) => {
        const button = document.querySelector(`[data-admin-action="${actionName}"]`);
        if (!button) return;
        button.disabled = count <= 0;
        button.title = count > 0 ? activeTitle.replace('{count}', formatVerifyMonitorInteger(count)) : emptyTitle;
    };

    setButtonState(
        'settings-batch-claim-ops-alert-monitor',
        getOpsAlertMonitorBatchItems(filters, 'assign').length,
        '当前筛选条件下没有可指派的告警',
        '当前筛选将指派 {count} 条告警'
    );
    setButtonState(
        'settings-batch-note-ops-alert-monitor',
        getOpsAlertMonitorBatchItems(filters, 'add_note').length,
        '当前筛选条件下没有可备注的告警',
        '当前筛选将备注 {count} 条告警'
    );
    setButtonState(
        'settings-batch-resolve-ops-alert-monitor',
        getOpsAlertMonitorBatchItems(filters, 'resolve').length,
        '当前筛选条件下没有可关闭的告警',
        '当前筛选将关闭 {count} 条告警'
    );
    setButtonState(
        'settings-batch-mute-ops-alert-monitor',
        getOpsAlertMonitorBatchMuteModuleKeys(filters).length,
        '当前筛选条件下没有可静默的告警模块',
        '当前筛选将静默 {count} 个告警模块'
    );
}

function renderOpsAlertMonitorPanel() {
    const panel = document.getElementById('opsAlertMonitorPanel');
    const meta = document.getElementById('opsAlertMonitorMeta');
    const grid = document.getElementById('opsAlertMonitorGrid');
    if (!panel || !meta || !grid) return;

    const state = opsAlertMonitorState || getDefaultOpsAlertMonitorState();
    const summary = state.summary || getDefaultOpsAlertMonitorState().summary;
    const filters = getOpsAlertMonitorViewFilters();

    panel.hidden = false;
    syncOpsAlertMonitorFilterToolbar(filters);
    renderOpsAlertRiskSpotlight(filters);
    renderOpsAlertMonitorBatchActions(filters);

    if (state.status === 'loading') {
        meta.innerHTML = '<i class="fas fa-rotate fa-spin"></i><span>正在汇总支付、工单、库存、履约与商城风控五类告警...</span>';
        renderOpsAlertMonitorEmptyState(grid, '正在加载集中告警处理面板...');
        return;
    }

    if (state.status === 'error') {
        meta.innerHTML = `<i class="fas fa-triangle-exclamation"></i><span>${escapeConfigHtml(state.message || '集中告警处理面板加载失败。')}</span>`;
        renderOpsAlertMonitorEmptyState(grid, state.message || '集中告警处理面板加载失败。');
        return;
    }

    const categories = getOpsAlertMonitorPreparedCategories(filters);

    const filteredActiveCount = categories.reduce((sum, category) => sum + Number(category.display_active_count || 0), 0);
    const filteredCriticalCount = categories.reduce((sum, category) => sum + Number(category.display_critical_count || 0), 0);
    const filteredSummaryLabel = getOpsAlertMonitorFilterSummaryLabel(filters);

    meta.innerHTML = categories.length
        ? (
            Number(filteredActiveCount || 0) > 0
                ? `<i class="fas fa-siren-on"></i><span>当前筛选：${escapeConfigHtml(filteredSummaryLabel)}。命中 ${escapeConfigHtml(formatVerifyMonitorInteger(filteredActiveCount))} 项待关注告警，覆盖 ${escapeConfigHtml(formatVerifyMonitorInteger(categories.length))} 个模块，其中 ${escapeConfigHtml(formatVerifyMonitorInteger(filteredCriticalCount))} 项为 critical。</span>`
                : `<i class="fas fa-circle-check"></i><span>当前筛选：${escapeConfigHtml(filteredSummaryLabel)}。最近 ${escapeConfigHtml(formatVerifyMonitorInteger(summary.lookback_hours || 0))} 小时内没有持续中的待关注告警，下面保留可复核的恢复轨迹。</span>`
        )
        : `<i class="fas fa-filter-circle-xmark"></i><span>当前筛选：${escapeConfigHtml(filteredSummaryLabel)}。这组条件下没有命中的集中告警，请调整筛选后重试。</span>`;

    if (!categories.length) {
        renderOpsAlertMonitorEmptyState(grid, '当前筛选条件下没有可展示的集中告警卡片。');
        return;
    }

    grid.innerHTML = categories.map((category) => buildOpsAlertMonitorCategoryMarkup(category, filters)).join('');
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
        showToast(`复制失败: ${error.message || '未知错误'}`, 'error');
        return false;
    }
}

function exportOpsAlertMonitorCsv(categoryKey = '') {
    const filters = getOpsAlertMonitorViewFilters();
    const categories = getOpsAlertMonitorPreparedCategories(filters);
    const rows = buildOpsAlertMonitorBatchRows(categories, filters, categoryKey);

    if (!rows.length) {
        showToast('当前筛选条件下没有可导出的告警清单', 'info');
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

        // Sync packages to points_packages table
        if (key === 'packages') {
            await syncPackagesToDatabase(value);
        }

        return true;
    } catch (err) {
        console.error('[Config] Save error:', err);
        if (typeof showToast === 'function') {
            showToast('保存失败: ' + err.message, 'error');
        }
        return false;
    }
}

async function getAdminConfigApiHeaders() {
    const headers = {
        'Content-Type': 'application/json'
    };

    const { data: { session } = {} } = await window.supabaseClient.auth.getSession();
    if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
    }

    return headers;
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
            return null;
        }
    })();

    try {
        return await loadPaymentChannelSettings._loadingPromise;
    } finally {
        loadPaymentChannelSettings._loadingPromise = null;
    }
}

async function loadOpsAlertSettings(force = false) {
    if (loadOpsAlertSettings._loadingPromise && !force) {
        return loadOpsAlertSettings._loadingPromise;
    }

    loadOpsAlertSettings._loadingPromise = (async () => {
        try {
            const headers = await getAdminConfigApiHeaders();
            const response = await fetch('/api/admin/settings/ops-alerts', {
                method: 'GET',
                headers
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) {
                throw new Error(payload.message || '加载站外告警配置失败');
            }

            systemConfigCache['ops_alerts'] = normalizeOpsAlertConfig(payload.config);
            opsAlertSecretStatus = payload.secrets || getDefaultOpsAlertSecretStatus();
            renderOpsAlertSettings();
            return payload;
        } catch (error) {
            console.warn('[Config] Ops alert settings load failed:', error.message);
            systemConfigCache['ops_alerts'] = normalizeOpsAlertConfig(systemConfigCache['ops_alerts']);
            opsAlertSecretStatus = getDefaultOpsAlertSecretStatus();
            renderOpsAlertSettings();
            return null;
        }
    })();

    try {
        return await loadOpsAlertSettings._loadingPromise;
    } finally {
        loadOpsAlertSettings._loadingPromise = null;
    }
}

async function loadOpsAlertHealth(force = false) {
    if (loadOpsAlertHealth._loadingPromise && !force) {
        return loadOpsAlertHealth._loadingPromise;
    }

    opsAlertHealthState = {
        ...(opsAlertHealthState || getDefaultOpsAlertHealthState()),
        status: 'loading',
        message: '正在加载站外告警通道健康状态...'
    };
    renderOpsAlertHealthPanel();

    loadOpsAlertHealth._loadingPromise = (async () => {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeoutId = controller
            ? window.setTimeout(() => controller.abort(), OPS_ALERT_HEALTH_FETCH_TIMEOUT_MS)
            : 0;

        try {
            const headers = await getAdminConfigApiHeaders();
            const response = await fetch('/api/admin/settings/ops-alert-health', {
                method: 'GET',
                headers,
                signal: controller?.signal
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) {
                throw new Error(payload.message || '加载站外告警通道健康状态失败');
            }

            opsAlertHealthState = {
                status: 'ready',
                fetched_at: payload.fetched_at || '',
                summary: payload.summary || getDefaultOpsAlertHealthState().summary,
                channels: Array.isArray(payload.channels) ? payload.channels : [],
                message: ''
            };
            renderOpsAlertHealthPanel();
            return payload;
        } catch (error) {
            const message = error?.name === 'AbortError'
                ? '加载站外告警通道健康状态超时，请稍后重试'
                : (error.message || '加载站外告警通道健康状态失败');
            console.warn('[Config] Ops alert health load failed:', message);
            opsAlertHealthState = {
                ...getDefaultOpsAlertHealthState(),
                status: 'error',
                message
            };
            renderOpsAlertHealthPanel();
            return null;
        } finally {
            if (timeoutId) {
                window.clearTimeout(timeoutId);
            }
        }
    })();

    try {
        return await loadOpsAlertHealth._loadingPromise;
    } finally {
        loadOpsAlertHealth._loadingPromise = null;
    }
}

async function loadOpsAlertMonitor(force = false) {
    if (loadOpsAlertMonitor._loadingPromise && !force) {
        return loadOpsAlertMonitor._loadingPromise;
    }

    opsAlertMonitorState = {
        ...(opsAlertMonitorState || getDefaultOpsAlertMonitorState()),
        status: 'loading',
        message: '正在加载集中告警处理面板...'
    };
    renderOpsAlertMonitorPanel();

    loadOpsAlertMonitor._loadingPromise = (async () => {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeoutId = controller
            ? window.setTimeout(() => controller.abort(), OPS_ALERT_MONITOR_FETCH_TIMEOUT_MS)
            : 0;

        try {
            const headers = await getAdminConfigApiHeaders();
            const response = await fetch('/api/admin/settings/ops-alert-monitor', {
                method: 'GET',
                headers,
                signal: controller?.signal
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) {
                throw new Error(payload.message || '加载集中告警处理面板失败');
            }

            opsAlertMonitorState = {
                status: 'ready',
                fetched_at: payload.fetched_at || '',
                summary: payload.summary || getDefaultOpsAlertMonitorState().summary,
                assignable_admins: Array.isArray(payload.assignable_admins) ? payload.assignable_admins : [],
                current_admin_id: payload.current_admin_id || '',
                current_admin_label: payload.current_admin_label || '',
                categories: Array.isArray(payload.categories) ? payload.categories : [],
                message: ''
            };
            renderOpsAlertMonitorPanel();
            return payload;
        } catch (error) {
            const message = error?.name === 'AbortError'
                ? '加载集中告警处理面板超时，请稍后重试'
                : (error.message || '加载集中告警处理面板失败');
            console.warn('[Config] Ops alert monitor load failed:', message);
            opsAlertMonitorState = {
                ...getDefaultOpsAlertMonitorState(),
                status: 'error',
                message
            };
            renderOpsAlertMonitorPanel();
            return null;
        } finally {
            if (timeoutId) {
                window.clearTimeout(timeoutId);
            }
        }
    })();

    try {
        return await loadOpsAlertMonitor._loadingPromise;
    } finally {
        loadOpsAlertMonitor._loadingPromise = null;
    }
}

// Sync packages config to points_packages table
async function syncPackagesToDatabase(packages) {
    try {
        if (!packages || !Array.isArray(packages)) return;

        console.log('[Config] Syncing packages to database...');

        // Get existing packages from database
        const { data: existingPackages } = await supabaseClient
            .from('points_packages')
            .select('id, name');

        const existingMap = {};
        (existingPackages || []).forEach(p => {
            existingMap[p.name] = p.id;
        });

        // Track which names are in the config
        const configNames = new Set(packages.map(p => p.name));

        // Update or insert packages
        for (const pkg of packages) {
            const existingId = existingMap[pkg.name];

            const packageData = {
                name: pkg.name,
                points_amount: pkg.points || 0,
                bonus_points: pkg.bonus || 0,
                price_cny: pkg.price || 0,
                is_active: pkg.enabled !== false,
                sort_order: pkg.sort || 0
            };

            let error;

            if (existingId) {
                // Update existing
                const result = await supabaseClient
                    .from('points_packages')
                    .update(packageData)
                    .eq('id', existingId);
                error = result.error;
            } else {
                // Insert new
                const result = await supabaseClient
                    .from('points_packages')
                    .insert(packageData);
                error = result.error;
            }

            if (error) {
                console.warn('[Config] Sync package error:', error.message);
            }
        }

        // Delete packages that are not in config anymore
        for (const existing of (existingPackages || [])) {
            if (!configNames.has(existing.name)) {
                console.log('[Config] Deleting removed package:', existing.name);
                await supabaseClient
                    .from('points_packages')
                    .delete()
                    .eq('id', existing.id);
            }
        }

        console.log('[Config] Packages synced successfully');
        if (typeof showToast === 'function') {
            showToast('礼包已同步到数据库', 'success');
        }
    } catch (err) {
        console.error('[Config] Sync packages error:', err);
    }
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
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
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
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId: session.user.id,
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

// ============================================
// PACKAGES CRUD
// ============================================

async function updatePackage(index, field, value) {
    const packages = systemConfigCache['packages'] || [];
    if (packages[index]) {
        packages[index][field] = normalizePackageFieldValue(field, value, packages[index][field]);
        await saveConfig('packages', packages);
    }
}

async function togglePackageStatus(index) {
    const packages = systemConfigCache['packages'] || [];
    if (!packages[index]) return;

    // Immediately toggle and update UI (optimistic update)
    packages[index].enabled = !packages[index].enabled;

    // Instantly update the toggle visual
    const toggleEl = document.querySelector(`#packagesTableBody tr[data-index="${index}"] .status-toggle`);
    if (toggleEl) {
        toggleEl.classList.toggle('active', packages[index].enabled);
        pulseAdminConfigToggle(toggleEl);
    }

    // Save in background (don't wait)
    saveConfig('packages', packages).catch(err => {
        // Revert on error
        console.error('[Config] Toggle save failed:', err);
        packages[index].enabled = !packages[index].enabled;
        if (toggleEl) toggleEl.classList.toggle('active', packages[index].enabled);
    });
}

async function deletePackage(index) {
    if (!confirm('确定删除这个礼包吗？')) return;

    const packages = systemConfigCache['packages'] || [];
    packages.splice(index, 1);

    // Optimistic update - render immediately
    renderPackagesConfig();

    // Save in background
    saveConfig('packages', packages);
}

async function addPackageRow() {
    const packages = systemConfigCache['packages'] || [];
    const newId = Math.max(...packages.map(p => p.id || 0), 0) + 1;

    packages.push({
        id: newId,
        name: '新礼包',
        points: 100,
        bonus: 0,
        price: 9.9,
        enabled: true,
        sort: packages.length + 1
    });

    // Optimistic update - render immediately
    renderPackagesConfig();

    // Save in background
    saveConfig('packages', packages);
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

function collectOpsAlertConfigFromForm() {
    const currentConfig = normalizeOpsAlertConfig(systemConfigCache['ops_alerts']);
    const nextConfig = {
        ...currentConfig,
        temporary_mute: {
            ...currentConfig.temporary_mute
        },
        quiet_hours: {
            ...currentConfig.quiet_hours
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
            ...currentConfig.customer_chat_message
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

    nextConfig.enabled = document.getElementById('opsAlertEnabledToggle')?.classList.contains('active') ?? currentConfig.enabled;
    nextConfig.temporary_mute.until = normalizeDateTimeLocalInputValue(
        document.getElementById('opsAlertTemporaryMuteUntil')?.value ?? currentConfig.temporary_mute.until
    );
    nextConfig.temporary_mute.allow_critical = document.getElementById('opsAlertTemporaryMuteAllowCriticalToggle')?.classList.contains('active')
        ?? currentConfig.temporary_mute.allow_critical;
    nextConfig.quiet_hours.enabled = document.getElementById('opsAlertQuietHoursEnabledToggle')?.classList.contains('active')
        ?? currentConfig.quiet_hours.enabled;
    nextConfig.quiet_hours.start_hour = clamp(
        toWholeNumber(
            document.getElementById('opsAlertQuietHoursStartHour')?.value,
            currentConfig.quiet_hours.start_hour
        ),
        0,
        23
    );
    nextConfig.quiet_hours.end_hour = clamp(
        toWholeNumber(
            document.getElementById('opsAlertQuietHoursEndHour')?.value,
            currentConfig.quiet_hours.end_hour
        ),
        0,
        23
    );
    nextConfig.quiet_hours.timezone = String(
        document.getElementById('opsAlertQuietHoursTimezone')?.value ?? currentConfig.quiet_hours.timezone
    ).trim() || currentConfig.quiet_hours.timezone;
    nextConfig.quiet_hours.allow_critical = document.getElementById('opsAlertQuietHoursAllowCriticalToggle')?.classList.contains('active')
        ?? currentConfig.quiet_hours.allow_critical;
    nextConfig.work_hours.enabled = document.getElementById('opsAlertWorkHoursEnabledToggle')?.classList.contains('active')
        ?? currentConfig.work_hours.enabled;
    nextConfig.work_hours.start_hour = clamp(
        toWholeNumber(
            document.getElementById('opsAlertWorkHoursStartHour')?.value,
            currentConfig.work_hours.start_hour
        ),
        0,
        23
    );
    nextConfig.work_hours.end_hour = clamp(
        toWholeNumber(
            document.getElementById('opsAlertWorkHoursEndHour')?.value,
            currentConfig.work_hours.end_hour
        ),
        0,
        23
    );
    nextConfig.work_hours.timezone = String(
        document.getElementById('opsAlertWorkHoursTimezone')?.value ?? currentConfig.work_hours.timezone
    ).trim() || currentConfig.work_hours.timezone;
    ['types', 'modules'].forEach((scope) => {
        getOpsAlertMuteRuleDefinitions(scope).forEach((definition) => {
            const currentRule = currentConfig.mute_rules?.[scope]?.[definition.key] || {
                until: '',
                allow_critical: true
            };
            nextConfig.mute_rules[scope][definition.key] = {
                ...currentRule,
                until: normalizeDateTimeLocalInputValue(
                    document.getElementById(getOpsAlertMuteRuleElementId(scope, definition.key, 'Until'))?.value ?? currentRule.until
                ),
                allow_critical: document.getElementById(getOpsAlertMuteRuleElementId(scope, definition.key, 'AllowCriticalToggle'))?.classList.contains('active')
                    ?? currentRule.allow_critical
            };
        });
    });
    nextConfig.channels.telegram.enabled = document.getElementById('opsAlertTelegramEnabledToggle')?.classList.contains('active')
        ?? currentConfig.channels.telegram.enabled;
    nextConfig.channels.telegram.chat_ids = normalizeConfigStringArray(
        document.getElementById('opsAlertTelegramChatIds')?.value ?? currentConfig.channels.telegram.chat_ids
    );
    nextConfig.channels.telegram.minimum_severity = normalizeOpsAlertSeverity(
        document.getElementById('opsAlertTelegramSeverity')?.value,
        currentConfig.channels.telegram.minimum_severity
    );
    nextConfig.channels.feishu.enabled = document.getElementById('opsAlertFeishuEnabledToggle')?.classList.contains('active')
        ?? currentConfig.channels.feishu.enabled;
    nextConfig.channels.feishu.minimum_severity = normalizeOpsAlertSeverity(
        document.getElementById('opsAlertFeishuSeverity')?.value,
        currentConfig.channels.feishu.minimum_severity
    );
    nextConfig.channels.email.enabled = document.getElementById('opsAlertEmailEnabledToggle')?.classList.contains('active')
        ?? currentConfig.channels.email.enabled;
    nextConfig.channels.email.minimum_severity = normalizeOpsAlertSeverity(
        document.getElementById('opsAlertEmailSeverity')?.value,
        currentConfig.channels.email.minimum_severity
    );
    nextConfig.channels.email.recipients = normalizeConfigStringArray(
        document.getElementById('opsAlertEmailRecipients')?.value ?? currentConfig.channels.email.recipients
    );
    nextConfig.channels.email.from_address = String(
        document.getElementById('opsAlertEmailFromAddress')?.value ?? currentConfig.channels.email.from_address
    ).trim();
    nextConfig.channels.email.reply_to = String(
        document.getElementById('opsAlertEmailReplyTo')?.value ?? currentConfig.channels.email.reply_to
    ).trim();
    nextConfig.channels.email.subject_prefix = String(
        document.getElementById('opsAlertEmailSubjectPrefix')?.value ?? currentConfig.channels.email.subject_prefix
    ).trim() || currentConfig.channels.email.subject_prefix;
    Object.keys(nextConfig.routing || {}).forEach((routingKey) => {
        ['telegram', 'feishu', 'email'].forEach((channelKey) => {
            const checkbox = document.getElementById(getOpsAlertRoutingCheckboxId(routingKey, channelKey));
            if (!checkbox) return;
            nextConfig.routing[routingKey][channelKey] = checkbox.checked;
        });
    });
    nextConfig.shop_order_risk.auto_response_enabled = document.getElementById('opsAlertShopRiskAutoResponseEnabledToggle')?.classList.contains('active')
        ?? currentConfig.shop_order_risk.auto_response_enabled;
    nextConfig.shop_order_risk.auto_disable_coupon_min_risk_score = toWholeNumber(
        document.getElementById('opsAlertShopRiskAutoDisableCouponMinRiskScore')?.value,
        currentConfig.shop_order_risk.auto_disable_coupon_min_risk_score
    );
    nextConfig.shop_order_risk.auto_ban_user_min_risk_score = toWholeNumber(
        document.getElementById('opsAlertShopRiskAutoBanUserMinRiskScore')?.value,
        currentConfig.shop_order_risk.auto_ban_user_min_risk_score
    );
    nextConfig.shop_order_risk.auto_ban_user_duration_days = toWholeNumber(
        document.getElementById('opsAlertShopRiskAutoBanUserDurationDays')?.value,
        currentConfig.shop_order_risk.auto_ban_user_duration_days
    );
    nextConfig.shop_order_risk.auto_suspend_product_min_risk_score = toWholeNumber(
        document.getElementById('opsAlertShopRiskAutoSuspendProductMinRiskScore')?.value,
        currentConfig.shop_order_risk.auto_suspend_product_min_risk_score
    );
    nextConfig.shop_inventory.enabled = document.getElementById('opsAlertShopInventoryEnabledToggle')?.classList.contains('active')
        ?? currentConfig.shop_inventory.enabled;
    nextConfig.shop_inventory.low_stock_threshold = toWholeNumber(
        document.getElementById('opsAlertShopInventoryLowStockThreshold')?.value,
        currentConfig.shop_inventory.low_stock_threshold
    );
    nextConfig.shop_inventory.sweep_interval_ms = Math.max(
        10000,
        toWholeNumber(
            document.getElementById('opsAlertShopInventorySweepIntervalMinutes')?.value,
            Math.max(1, Math.round(Number(currentConfig.shop_inventory.sweep_interval_ms || 0) / 60000))
        ) * 60 * 1000
    );
    nextConfig.shop_inventory.sales_window_days = toWholeNumber(
        document.getElementById('opsAlertShopInventorySalesWindowDays')?.value,
        currentConfig.shop_inventory.sales_window_days
    );
    nextConfig.shop_inventory.dedupe_window_minutes = toWholeNumber(
        document.getElementById('opsAlertShopInventoryDedupeWindowMinutes')?.value,
        currentConfig.shop_inventory.dedupe_window_minutes
    );
    nextConfig.shop_inventory.recovery_notification_enabled = document.getElementById('opsAlertShopInventoryRecoveryNotificationEnabledToggle')?.classList.contains('active')
        ?? currentConfig.shop_inventory.recovery_notification_enabled;
    nextConfig.shop_inventory.summary_enabled = document.getElementById('opsAlertShopInventorySummaryEnabledToggle')?.classList.contains('active')
        ?? currentConfig.shop_inventory.summary_enabled;
    nextConfig.shop_inventory.summary_window_minutes = toWholeNumber(
        document.getElementById('opsAlertShopInventorySummaryWindowMinutes')?.value,
        currentConfig.shop_inventory.summary_window_minutes
    );
    nextConfig.shop_inventory.summary_schedule_mode = normalizeOpsAlertSummaryScheduleMode(
        document.getElementById('opsAlertShopInventorySummaryScheduleMode')?.value,
        currentConfig.shop_inventory.summary_schedule_mode
    );
    nextConfig.shop_inventory.summary_hourly_minute = toWholeNumber(
        document.getElementById('opsAlertShopInventorySummaryHourlyMinute')?.value,
        currentConfig.shop_inventory.summary_hourly_minute
    );
    nextConfig.shop_inventory.summary_daily_hour = toWholeNumber(
        document.getElementById('opsAlertShopInventorySummaryDailyHour')?.value,
        currentConfig.shop_inventory.summary_daily_hour
    );
    nextConfig.shop_inventory.summary_daily_minute = toWholeNumber(
        document.getElementById('opsAlertShopInventorySummaryDailyMinute')?.value,
        currentConfig.shop_inventory.summary_daily_minute
    );
    nextConfig.shop_inventory.summary_max_items = toWholeNumber(
        document.getElementById('opsAlertShopInventorySummaryMaxItems')?.value,
        currentConfig.shop_inventory.summary_max_items
    );
    nextConfig.customer_chat_message.enabled = document.getElementById('opsAlertCustomerChatMessageEnabledToggle')?.classList.contains('active')
        ?? currentConfig.customer_chat_message.enabled;
    nextConfig.customer_chat_message.sweep_interval_ms = Math.max(
        10000,
        toWholeNumber(
            document.getElementById('opsAlertCustomerChatMessageSweepIntervalMinutes')?.value,
            Math.max(1, Math.round(Number(currentConfig.customer_chat_message.sweep_interval_ms || 0) / 60000))
        ) * 60 * 1000
    );
    nextConfig.customer_chat_message.lookback_minutes = toWholeNumber(
        document.getElementById('opsAlertCustomerChatMessageLookbackMinutes')?.value,
        currentConfig.customer_chat_message.lookback_minutes
    );
    nextConfig.customer_chat_message.dedupe_window_minutes = toWholeNumber(
        document.getElementById('opsAlertCustomerChatMessageDedupeWindowMinutes')?.value,
        currentConfig.customer_chat_message.dedupe_window_minutes
    );
    nextConfig.customer_chat_message.work_hours_only_enabled = document.getElementById('opsAlertCustomerChatMessageWorkHoursOnlyEnabledToggle')?.classList.contains('active')
        ?? currentConfig.customer_chat_message.work_hours_only_enabled;
    nextConfig.customer_chat_message.summary_enabled = document.getElementById('opsAlertCustomerChatMessageSummaryEnabledToggle')?.classList.contains('active')
        ?? currentConfig.customer_chat_message.summary_enabled;
    nextConfig.customer_chat_message.summary_window_minutes = toWholeNumber(
        document.getElementById('opsAlertCustomerChatMessageSummaryWindowMinutes')?.value,
        currentConfig.customer_chat_message.summary_window_minutes
    );
    nextConfig.customer_chat_message.summary_schedule_mode = normalizeOpsAlertSummaryScheduleMode(
        document.getElementById('opsAlertCustomerChatMessageSummaryScheduleMode')?.value,
        currentConfig.customer_chat_message.summary_schedule_mode
    );
    nextConfig.customer_chat_message.summary_hourly_minute = toWholeNumber(
        document.getElementById('opsAlertCustomerChatMessageSummaryHourlyMinute')?.value,
        currentConfig.customer_chat_message.summary_hourly_minute
    );
    nextConfig.customer_chat_message.summary_daily_hour = toWholeNumber(
        document.getElementById('opsAlertCustomerChatMessageSummaryDailyHour')?.value,
        currentConfig.customer_chat_message.summary_daily_hour
    );
    nextConfig.customer_chat_message.summary_daily_minute = toWholeNumber(
        document.getElementById('opsAlertCustomerChatMessageSummaryDailyMinute')?.value,
        currentConfig.customer_chat_message.summary_daily_minute
    );
    nextConfig.customer_chat_message.summary_max_items = toWholeNumber(
        document.getElementById('opsAlertCustomerChatMessageSummaryMaxItems')?.value,
        currentConfig.customer_chat_message.summary_max_items
    );
    nextConfig.shop_purchase_success.enabled = document.getElementById('opsAlertShopPurchaseSuccessEnabledToggle')?.classList.contains('active')
        ?? currentConfig.shop_purchase_success.enabled;
    nextConfig.shop_purchase_success.sweep_interval_ms = Math.max(
        10000,
        toWholeNumber(
            document.getElementById('opsAlertShopPurchaseSuccessSweepIntervalMinutes')?.value,
            Math.max(1, Math.round(Number(currentConfig.shop_purchase_success.sweep_interval_ms || 0) / 60000))
        ) * 60 * 1000
    );
    nextConfig.shop_purchase_success.lookback_minutes = toWholeNumber(
        document.getElementById('opsAlertShopPurchaseSuccessLookbackMinutes')?.value,
        currentConfig.shop_purchase_success.lookback_minutes
    );
    nextConfig.shop_purchase_success.dedupe_window_minutes = toWholeNumber(
        document.getElementById('opsAlertShopPurchaseSuccessDedupeWindowMinutes')?.value,
        currentConfig.shop_purchase_success.dedupe_window_minutes
    );
    nextConfig.shop_purchase_success.work_hours_only_enabled = document.getElementById('opsAlertShopPurchaseSuccessWorkHoursOnlyEnabledToggle')?.classList.contains('active')
        ?? currentConfig.shop_purchase_success.work_hours_only_enabled;
    nextConfig.shop_purchase_success.summary_enabled = document.getElementById('opsAlertShopPurchaseSuccessSummaryEnabledToggle')?.classList.contains('active')
        ?? currentConfig.shop_purchase_success.summary_enabled;
    nextConfig.shop_purchase_success.summary_window_minutes = toWholeNumber(
        document.getElementById('opsAlertShopPurchaseSuccessSummaryWindowMinutes')?.value,
        currentConfig.shop_purchase_success.summary_window_minutes
    );
    nextConfig.shop_purchase_success.summary_schedule_mode = normalizeOpsAlertSummaryScheduleMode(
        document.getElementById('opsAlertShopPurchaseSuccessSummaryScheduleMode')?.value,
        currentConfig.shop_purchase_success.summary_schedule_mode
    );
    nextConfig.shop_purchase_success.summary_hourly_minute = toWholeNumber(
        document.getElementById('opsAlertShopPurchaseSuccessSummaryHourlyMinute')?.value,
        currentConfig.shop_purchase_success.summary_hourly_minute
    );
    nextConfig.shop_purchase_success.summary_daily_hour = toWholeNumber(
        document.getElementById('opsAlertShopPurchaseSuccessSummaryDailyHour')?.value,
        currentConfig.shop_purchase_success.summary_daily_hour
    );
    nextConfig.shop_purchase_success.summary_daily_minute = toWholeNumber(
        document.getElementById('opsAlertShopPurchaseSuccessSummaryDailyMinute')?.value,
        currentConfig.shop_purchase_success.summary_daily_minute
    );
    nextConfig.shop_purchase_success.summary_max_items = toWholeNumber(
        document.getElementById('opsAlertShopPurchaseSuccessSummaryMaxItems')?.value,
        currentConfig.shop_purchase_success.summary_max_items
    );
    nextConfig.wallet_recharge_success.enabled = document.getElementById('opsAlertWalletRechargeSuccessEnabledToggle')?.classList.contains('active')
        ?? currentConfig.wallet_recharge_success.enabled;
    nextConfig.wallet_recharge_success.sweep_interval_ms = Math.max(
        10000,
        toWholeNumber(
            document.getElementById('opsAlertWalletRechargeSuccessSweepIntervalMinutes')?.value,
            Math.max(1, Math.round(Number(currentConfig.wallet_recharge_success.sweep_interval_ms || 0) / 60000))
        ) * 60 * 1000
    );
    nextConfig.wallet_recharge_success.lookback_minutes = toWholeNumber(
        document.getElementById('opsAlertWalletRechargeSuccessLookbackMinutes')?.value,
        currentConfig.wallet_recharge_success.lookback_minutes
    );
    nextConfig.wallet_recharge_success.dedupe_window_minutes = toWholeNumber(
        document.getElementById('opsAlertWalletRechargeSuccessDedupeWindowMinutes')?.value,
        currentConfig.wallet_recharge_success.dedupe_window_minutes
    );
    nextConfig.wallet_recharge_success.work_hours_only_enabled = document.getElementById('opsAlertWalletRechargeSuccessWorkHoursOnlyEnabledToggle')?.classList.contains('active')
        ?? currentConfig.wallet_recharge_success.work_hours_only_enabled;
    nextConfig.wallet_recharge_success.summary_enabled = document.getElementById('opsAlertWalletRechargeSuccessSummaryEnabledToggle')?.classList.contains('active')
        ?? currentConfig.wallet_recharge_success.summary_enabled;
    nextConfig.wallet_recharge_success.summary_window_minutes = toWholeNumber(
        document.getElementById('opsAlertWalletRechargeSuccessSummaryWindowMinutes')?.value,
        currentConfig.wallet_recharge_success.summary_window_minutes
    );
    nextConfig.wallet_recharge_success.summary_schedule_mode = normalizeOpsAlertSummaryScheduleMode(
        document.getElementById('opsAlertWalletRechargeSuccessSummaryScheduleMode')?.value,
        currentConfig.wallet_recharge_success.summary_schedule_mode
    );
    nextConfig.wallet_recharge_success.summary_hourly_minute = toWholeNumber(
        document.getElementById('opsAlertWalletRechargeSuccessSummaryHourlyMinute')?.value,
        currentConfig.wallet_recharge_success.summary_hourly_minute
    );
    nextConfig.wallet_recharge_success.summary_daily_hour = toWholeNumber(
        document.getElementById('opsAlertWalletRechargeSuccessSummaryDailyHour')?.value,
        currentConfig.wallet_recharge_success.summary_daily_hour
    );
    nextConfig.wallet_recharge_success.summary_daily_minute = toWholeNumber(
        document.getElementById('opsAlertWalletRechargeSuccessSummaryDailyMinute')?.value,
        currentConfig.wallet_recharge_success.summary_daily_minute
    );
    nextConfig.wallet_recharge_success.summary_max_items = toWholeNumber(
        document.getElementById('opsAlertWalletRechargeSuccessSummaryMaxItems')?.value,
        currentConfig.wallet_recharge_success.summary_max_items
    );
    nextConfig.tickets.enabled = document.getElementById('opsAlertTicketsEnabledToggle')?.classList.contains('active')
        ?? currentConfig.tickets.enabled;
    nextConfig.tickets.sweep_interval_ms = Math.max(
        10000,
        toWholeNumber(
            document.getElementById('opsAlertTicketsSweepIntervalMinutes')?.value,
            Math.max(1, Math.round(Number(currentConfig.tickets.sweep_interval_ms || 0) / 60000))
        ) * 60 * 1000
    );
    nextConfig.tickets.pending_overdue_minutes = toWholeNumber(
        document.getElementById('opsAlertTicketsPendingOverdueMinutes')?.value,
        currentConfig.tickets.pending_overdue_minutes
    );
    nextConfig.tickets.critical_overdue_minutes = toWholeNumber(
        document.getElementById('opsAlertTicketsCriticalOverdueMinutes')?.value,
        currentConfig.tickets.critical_overdue_minutes
    );
    nextConfig.tickets.state_lookback_minutes = toWholeNumber(
        document.getElementById('opsAlertTicketsStateLookbackMinutes')?.value,
        currentConfig.tickets.state_lookback_minutes
    );
    nextConfig.tickets.dedupe_window_minutes = toWholeNumber(
        document.getElementById('opsAlertTicketsDedupeWindowMinutes')?.value,
        currentConfig.tickets.dedupe_window_minutes
    );
    nextConfig.tickets.work_hours_only_enabled = document.getElementById('opsAlertTicketsWorkHoursOnlyEnabledToggle')?.classList.contains('active')
        ?? currentConfig.tickets.work_hours_only_enabled;
    nextConfig.tickets.summary_enabled = document.getElementById('opsAlertTicketsSummaryEnabledToggle')?.classList.contains('active')
        ?? currentConfig.tickets.summary_enabled;
    nextConfig.tickets.summary_window_minutes = toWholeNumber(
        document.getElementById('opsAlertTicketsSummaryWindowMinutes')?.value,
        currentConfig.tickets.summary_window_minutes
    );
    nextConfig.tickets.summary_schedule_mode = normalizeOpsAlertSummaryScheduleMode(
        document.getElementById('opsAlertTicketsSummaryScheduleMode')?.value,
        currentConfig.tickets.summary_schedule_mode
    );
    nextConfig.tickets.summary_hourly_minute = toWholeNumber(
        document.getElementById('opsAlertTicketsSummaryHourlyMinute')?.value,
        currentConfig.tickets.summary_hourly_minute
    );
    nextConfig.tickets.summary_daily_hour = toWholeNumber(
        document.getElementById('opsAlertTicketsSummaryDailyHour')?.value,
        currentConfig.tickets.summary_daily_hour
    );
    nextConfig.tickets.summary_daily_minute = toWholeNumber(
        document.getElementById('opsAlertTicketsSummaryDailyMinute')?.value,
        currentConfig.tickets.summary_daily_minute
    );
    nextConfig.tickets.summary_max_items = toWholeNumber(
        document.getElementById('opsAlertTicketsSummaryMaxItems')?.value,
        currentConfig.tickets.summary_max_items
    );
    nextConfig.shop_order_delivery.enabled = document.getElementById('opsAlertShopOrderDeliveryEnabledToggle')?.classList.contains('active')
        ?? currentConfig.shop_order_delivery.enabled;
    nextConfig.shop_order_delivery.lookback_days = toWholeNumber(
        document.getElementById('opsAlertShopOrderDeliveryLookbackDays')?.value,
        currentConfig.shop_order_delivery.lookback_days
    );
    nextConfig.shop_order_delivery.state_lookback_minutes = toWholeNumber(
        document.getElementById('opsAlertShopOrderDeliveryStateLookbackMinutes')?.value,
        currentConfig.shop_order_delivery.state_lookback_minutes
    );
    nextConfig.shop_order_delivery.retry_waiting_min_attempts = toWholeNumber(
        document.getElementById('opsAlertShopOrderDeliveryRetryWaitingMinAttempts')?.value,
        currentConfig.shop_order_delivery.retry_waiting_min_attempts
    );
    nextConfig.shop_order_delivery.sweep_interval_ms = Math.max(
        10000,
        toWholeNumber(
            document.getElementById('opsAlertShopOrderDeliverySweepIntervalMinutes')?.value,
            Math.max(1, Math.round(Number(currentConfig.shop_order_delivery.sweep_interval_ms || 0) / 60000))
        ) * 60 * 1000
    );
    nextConfig.shop_order_delivery.dedupe_window_minutes = toWholeNumber(
        document.getElementById('opsAlertShopOrderDeliveryDedupeWindowMinutes')?.value,
        currentConfig.shop_order_delivery.dedupe_window_minutes
    );
    nextConfig.shop_order_delivery.incident_enabled = document.getElementById('opsAlertShopOrderDeliveryIncidentEnabledToggle')?.classList.contains('active')
        ?? currentConfig.shop_order_delivery.incident_enabled;
    nextConfig.shop_order_delivery.incident_min_order_count = toWholeNumber(
        document.getElementById('opsAlertShopOrderDeliveryIncidentMinOrderCount')?.value,
        currentConfig.shop_order_delivery.incident_min_order_count
    );
    nextConfig.shop_order_delivery.incident_min_dead_letter_count = toWholeNumber(
        document.getElementById('opsAlertShopOrderDeliveryIncidentMinDeadLetterCount')?.value,
        currentConfig.shop_order_delivery.incident_min_dead_letter_count
    );
    nextConfig.shop_order_delivery.incident_min_distinct_users = toWholeNumber(
        document.getElementById('opsAlertShopOrderDeliveryIncidentMinDistinctUsers')?.value,
        currentConfig.shop_order_delivery.incident_min_distinct_users
    );
    nextConfig.shop_order_delivery.incident_dedupe_window_minutes = toWholeNumber(
        document.getElementById('opsAlertShopOrderDeliveryIncidentDedupeWindowMinutes')?.value,
        currentConfig.shop_order_delivery.incident_dedupe_window_minutes
    );
    nextConfig.shop_order_delivery.work_hours_only_enabled = document.getElementById('opsAlertShopOrderDeliveryWorkHoursOnlyEnabledToggle')?.classList.contains('active')
        ?? currentConfig.shop_order_delivery.work_hours_only_enabled;
    nextConfig.shop_order_delivery.summary_enabled = document.getElementById('opsAlertShopOrderDeliverySummaryEnabledToggle')?.classList.contains('active')
        ?? currentConfig.shop_order_delivery.summary_enabled;
    nextConfig.shop_order_delivery.summary_window_minutes = toWholeNumber(
        document.getElementById('opsAlertShopOrderDeliverySummaryWindowMinutes')?.value,
        currentConfig.shop_order_delivery.summary_window_minutes
    );
    nextConfig.shop_order_delivery.summary_schedule_mode = normalizeOpsAlertSummaryScheduleMode(
        document.getElementById('opsAlertShopOrderDeliverySummaryScheduleMode')?.value,
        currentConfig.shop_order_delivery.summary_schedule_mode
    );
    nextConfig.shop_order_delivery.summary_hourly_minute = toWholeNumber(
        document.getElementById('opsAlertShopOrderDeliverySummaryHourlyMinute')?.value,
        currentConfig.shop_order_delivery.summary_hourly_minute
    );
    nextConfig.shop_order_delivery.summary_daily_hour = toWholeNumber(
        document.getElementById('opsAlertShopOrderDeliverySummaryDailyHour')?.value,
        currentConfig.shop_order_delivery.summary_daily_hour
    );
    nextConfig.shop_order_delivery.summary_daily_minute = toWholeNumber(
        document.getElementById('opsAlertShopOrderDeliverySummaryDailyMinute')?.value,
        currentConfig.shop_order_delivery.summary_daily_minute
    );
    nextConfig.shop_order_delivery.summary_max_items = toWholeNumber(
        document.getElementById('opsAlertShopOrderDeliverySummaryMaxItems')?.value,
        currentConfig.shop_order_delivery.summary_max_items
    );
    nextConfig.verify_quota.enabled = document.getElementById('opsAlertVerifyQuotaEnabledToggle')?.classList.contains('active')
        ?? currentConfig.verify_quota.enabled;
    nextConfig.verify_quota.low_balance_threshold = toWholeNumber(
        document.getElementById('opsAlertVerifyQuotaLowBalanceThreshold')?.value,
        currentConfig.verify_quota.low_balance_threshold
    );
    nextConfig.verify_quota.low_remaining_jobs_threshold = toWholeNumber(
        document.getElementById('opsAlertVerifyQuotaLowRemainingJobsThreshold')?.value,
        currentConfig.verify_quota.low_remaining_jobs_threshold
    );
    nextConfig.verify_quota.critical_balance_threshold = toWholeNumber(
        document.getElementById('opsAlertVerifyQuotaCriticalBalanceThreshold')?.value,
        currentConfig.verify_quota.critical_balance_threshold
    );
    nextConfig.verify_quota.critical_remaining_jobs_threshold = toWholeNumber(
        document.getElementById('opsAlertVerifyQuotaCriticalRemainingJobsThreshold')?.value,
        currentConfig.verify_quota.critical_remaining_jobs_threshold
    );
    nextConfig.verify_quota.min_queue_buffer_jobs = toWholeNumber(
        document.getElementById('opsAlertVerifyQuotaMinQueueBufferJobs')?.value,
        currentConfig.verify_quota.min_queue_buffer_jobs
    );
    nextConfig.verify_quota.sweep_interval_ms = Math.max(
        10000,
        toWholeNumber(
            document.getElementById('opsAlertVerifyQuotaSweepIntervalMinutes')?.value,
            Math.max(1, Math.round(Number(currentConfig.verify_quota.sweep_interval_ms || 0) / 60000))
        ) * 60 * 1000
    );
    nextConfig.verify_quota.dedupe_window_minutes = toWholeNumber(
        document.getElementById('opsAlertVerifyQuotaDedupeWindowMinutes')?.value,
        currentConfig.verify_quota.dedupe_window_minutes
    );
    nextConfig.verify_quota.work_hours_only_enabled = document.getElementById('opsAlertVerifyQuotaWorkHoursOnlyEnabledToggle')?.classList.contains('active')
        ?? currentConfig.verify_quota.work_hours_only_enabled;
    nextConfig.verify_quota.summary_enabled = document.getElementById('opsAlertVerifyQuotaSummaryEnabledToggle')?.classList.contains('active')
        ?? currentConfig.verify_quota.summary_enabled;
    nextConfig.verify_quota.summary_window_minutes = toWholeNumber(
        document.getElementById('opsAlertVerifyQuotaSummaryWindowMinutes')?.value,
        currentConfig.verify_quota.summary_window_minutes
    );
    nextConfig.verify_quota.summary_schedule_mode = normalizeOpsAlertSummaryScheduleMode(
        document.getElementById('opsAlertVerifyQuotaSummaryScheduleMode')?.value,
        currentConfig.verify_quota.summary_schedule_mode
    );
    nextConfig.verify_quota.summary_hourly_minute = toWholeNumber(
        document.getElementById('opsAlertVerifyQuotaSummaryHourlyMinute')?.value,
        currentConfig.verify_quota.summary_hourly_minute
    );
    nextConfig.verify_quota.summary_daily_hour = toWholeNumber(
        document.getElementById('opsAlertVerifyQuotaSummaryDailyHour')?.value,
        currentConfig.verify_quota.summary_daily_hour
    );
    nextConfig.verify_quota.summary_daily_minute = toWholeNumber(
        document.getElementById('opsAlertVerifyQuotaSummaryDailyMinute')?.value,
        currentConfig.verify_quota.summary_daily_minute
    );
    nextConfig.verify_quota.summary_max_items = toWholeNumber(
        document.getElementById('opsAlertVerifyQuotaSummaryMaxItems')?.value,
        currentConfig.verify_quota.summary_max_items
    );
    nextConfig.verify_queue.enabled = document.getElementById('opsAlertVerifyQueueEnabledToggle')?.classList.contains('active')
        ?? currentConfig.verify_queue.enabled;
    nextConfig.verify_queue.recent_activity_lookback_hours = toWholeNumber(
        document.getElementById('opsAlertVerifyQueueRecentActivityLookbackHours')?.value,
        currentConfig.verify_queue.recent_activity_lookback_hours
    );
    nextConfig.verify_queue.recent_failure_window_minutes = toWholeNumber(
        document.getElementById('opsAlertVerifyQueueRecentFailureWindowMinutes')?.value,
        currentConfig.verify_queue.recent_failure_window_minutes
    );
    nextConfig.verify_queue.queue_size_threshold = toWholeNumber(
        document.getElementById('opsAlertVerifyQueueSizeThreshold')?.value,
        currentConfig.verify_queue.queue_size_threshold
    );
    nextConfig.verify_queue.active_job_threshold = toWholeNumber(
        document.getElementById('opsAlertVerifyQueueActiveJobThreshold')?.value,
        currentConfig.verify_queue.active_job_threshold
    );
    nextConfig.verify_queue.oldest_pending_minutes_threshold = toWholeNumber(
        document.getElementById('opsAlertVerifyQueueOldestPendingMinutesThreshold')?.value,
        currentConfig.verify_queue.oldest_pending_minutes_threshold
    );
    nextConfig.verify_queue.recent_failure_threshold = toWholeNumber(
        document.getElementById('opsAlertVerifyQueueRecentFailureThreshold')?.value,
        currentConfig.verify_queue.recent_failure_threshold
    );
    nextConfig.verify_queue.sweep_interval_ms = Math.max(
        10000,
        toWholeNumber(
            document.getElementById('opsAlertVerifyQueueSweepIntervalMinutes')?.value,
            Math.max(1, Math.round(Number(currentConfig.verify_queue.sweep_interval_ms || 0) / 60000))
        ) * 60 * 1000
    );
    nextConfig.verify_queue.dedupe_window_minutes = toWholeNumber(
        document.getElementById('opsAlertVerifyQueueDedupeWindowMinutes')?.value,
        currentConfig.verify_queue.dedupe_window_minutes
    );
    nextConfig.verify_queue.work_hours_only_enabled = document.getElementById('opsAlertVerifyQueueWorkHoursOnlyEnabledToggle')?.classList.contains('active')
        ?? currentConfig.verify_queue.work_hours_only_enabled;
    nextConfig.verify_queue.summary_enabled = document.getElementById('opsAlertVerifyQueueSummaryEnabledToggle')?.classList.contains('active')
        ?? currentConfig.verify_queue.summary_enabled;
    nextConfig.verify_queue.summary_window_minutes = toWholeNumber(
        document.getElementById('opsAlertVerifyQueueSummaryWindowMinutes')?.value,
        currentConfig.verify_queue.summary_window_minutes
    );
    nextConfig.verify_queue.summary_schedule_mode = normalizeOpsAlertSummaryScheduleMode(
        document.getElementById('opsAlertVerifyQueueSummaryScheduleMode')?.value,
        currentConfig.verify_queue.summary_schedule_mode
    );
    nextConfig.verify_queue.summary_hourly_minute = toWholeNumber(
        document.getElementById('opsAlertVerifyQueueSummaryHourlyMinute')?.value,
        currentConfig.verify_queue.summary_hourly_minute
    );
    nextConfig.verify_queue.summary_daily_hour = toWholeNumber(
        document.getElementById('opsAlertVerifyQueueSummaryDailyHour')?.value,
        currentConfig.verify_queue.summary_daily_hour
    );
    nextConfig.verify_queue.summary_daily_minute = toWholeNumber(
        document.getElementById('opsAlertVerifyQueueSummaryDailyMinute')?.value,
        currentConfig.verify_queue.summary_daily_minute
    );
    nextConfig.verify_queue.summary_max_items = toWholeNumber(
        document.getElementById('opsAlertVerifyQueueSummaryMaxItems')?.value,
        currentConfig.verify_queue.summary_max_items
    );
    nextConfig.verify_failure.enabled = document.getElementById('opsAlertVerifyFailureEnabledToggle')?.classList.contains('active')
        ?? currentConfig.verify_failure.enabled;
    nextConfig.verify_failure.recent_window_minutes = toWholeNumber(
        document.getElementById('opsAlertVerifyFailureRecentWindowMinutes')?.value,
        currentConfig.verify_failure.recent_window_minutes
    );
    nextConfig.verify_failure.min_total_jobs_threshold = toWholeNumber(
        document.getElementById('opsAlertVerifyFailureMinTotalJobsThreshold')?.value,
        currentConfig.verify_failure.min_total_jobs_threshold
    );
    nextConfig.verify_failure.failure_rate_threshold = toWholeNumber(
        document.getElementById('opsAlertVerifyFailureRateThreshold')?.value,
        currentConfig.verify_failure.failure_rate_threshold
    );
    nextConfig.verify_failure.affected_user_threshold = toWholeNumber(
        document.getElementById('opsAlertVerifyFailureAffectedUserThreshold')?.value,
        currentConfig.verify_failure.affected_user_threshold
    );
    nextConfig.verify_failure.sweep_interval_ms = Math.max(
        10000,
        toWholeNumber(
            document.getElementById('opsAlertVerifyFailureSweepIntervalMinutes')?.value,
            Math.max(1, Math.round(Number(currentConfig.verify_failure.sweep_interval_ms || 0) / 60000))
        ) * 60 * 1000
    );
    nextConfig.verify_failure.dedupe_window_minutes = toWholeNumber(
        document.getElementById('opsAlertVerifyFailureDedupeWindowMinutes')?.value,
        currentConfig.verify_failure.dedupe_window_minutes
    );
    nextConfig.verify_failure.work_hours_only_enabled = document.getElementById('opsAlertVerifyFailureWorkHoursOnlyEnabledToggle')?.classList.contains('active')
        ?? currentConfig.verify_failure.work_hours_only_enabled;
    nextConfig.verify_failure.summary_enabled = document.getElementById('opsAlertVerifyFailureSummaryEnabledToggle')?.classList.contains('active')
        ?? currentConfig.verify_failure.summary_enabled;
    nextConfig.verify_failure.summary_window_minutes = toWholeNumber(
        document.getElementById('opsAlertVerifyFailureSummaryWindowMinutes')?.value,
        currentConfig.verify_failure.summary_window_minutes
    );
    nextConfig.verify_failure.summary_schedule_mode = normalizeOpsAlertSummaryScheduleMode(
        document.getElementById('opsAlertVerifyFailureSummaryScheduleMode')?.value,
        currentConfig.verify_failure.summary_schedule_mode
    );
    nextConfig.verify_failure.summary_hourly_minute = toWholeNumber(
        document.getElementById('opsAlertVerifyFailureSummaryHourlyMinute')?.value,
        currentConfig.verify_failure.summary_hourly_minute
    );
    nextConfig.verify_failure.summary_daily_hour = toWholeNumber(
        document.getElementById('opsAlertVerifyFailureSummaryDailyHour')?.value,
        currentConfig.verify_failure.summary_daily_hour
    );
    nextConfig.verify_failure.summary_daily_minute = toWholeNumber(
        document.getElementById('opsAlertVerifyFailureSummaryDailyMinute')?.value,
        currentConfig.verify_failure.summary_daily_minute
    );
    nextConfig.verify_failure.summary_max_items = toWholeNumber(
        document.getElementById('opsAlertVerifyFailureSummaryMaxItems')?.value,
        currentConfig.verify_failure.summary_max_items
    );
    nextConfig.payment_gateway.enabled = document.getElementById('opsAlertPaymentGatewayEnabledToggle')?.classList.contains('active')
        ?? currentConfig.payment_gateway.enabled;
    nextConfig.payment_gateway.window_minutes = toWholeNumber(
        document.getElementById('opsAlertPaymentGatewayWindowMinutes')?.value,
        currentConfig.payment_gateway.window_minutes
    );
    nextConfig.payment_gateway.min_failed_orders = toWholeNumber(
        document.getElementById('opsAlertPaymentGatewayFailedOrdersThreshold')?.value,
        currentConfig.payment_gateway.min_failed_orders
    );
    nextConfig.payment_gateway.min_failed_ratio_percent = toWholeNumber(
        document.getElementById('opsAlertPaymentGatewayFailedRatioThreshold')?.value,
        currentConfig.payment_gateway.min_failed_ratio_percent
    );
    nextConfig.payment_gateway.max_webhook_success_rate_percent = toWholeNumber(
        document.getElementById('opsAlertPaymentGatewayWebhookSuccessRateThreshold')?.value,
        currentConfig.payment_gateway.max_webhook_success_rate_percent
    );
    nextConfig.payment_gateway.max_query_success_rate_percent = toWholeNumber(
        document.getElementById('opsAlertPaymentGatewayQuerySuccessRateThreshold')?.value,
        currentConfig.payment_gateway.max_query_success_rate_percent
    );
    nextConfig.payment_gateway.min_webhook_5xx_count = toWholeNumber(
        document.getElementById('opsAlertPaymentGatewayWebhook5xxThreshold')?.value,
        currentConfig.payment_gateway.min_webhook_5xx_count
    );
    nextConfig.payment_gateway.min_query_5xx_count = toWholeNumber(
        document.getElementById('opsAlertPaymentGatewayQuery5xxThreshold')?.value,
        currentConfig.payment_gateway.min_query_5xx_count
    );
    nextConfig.payment_gateway.sweep_interval_ms = Math.max(
        10000,
        toWholeNumber(
            document.getElementById('opsAlertPaymentGatewaySweepIntervalMinutes')?.value,
            Math.max(1, Math.round(Number(currentConfig.payment_gateway.sweep_interval_ms || 0) / 60000))
        ) * 60 * 1000
    );
    nextConfig.payment_gateway.dedupe_window_minutes = toWholeNumber(
        document.getElementById('opsAlertPaymentGatewayDedupeWindowMinutes')?.value,
        currentConfig.payment_gateway.dedupe_window_minutes
    );
    nextConfig.payment_gateway.work_hours_only_enabled = document.getElementById('opsAlertPaymentGatewayWorkHoursOnlyEnabledToggle')?.classList.contains('active')
        ?? currentConfig.payment_gateway.work_hours_only_enabled;
    nextConfig.payment_gateway.summary_enabled = document.getElementById('opsAlertPaymentGatewaySummaryEnabledToggle')?.classList.contains('active')
        ?? currentConfig.payment_gateway.summary_enabled;
    nextConfig.payment_gateway.summary_window_minutes = toWholeNumber(
        document.getElementById('opsAlertPaymentGatewaySummaryWindowMinutes')?.value,
        currentConfig.payment_gateway.summary_window_minutes
    );
    nextConfig.payment_gateway.summary_schedule_mode = normalizeOpsAlertSummaryScheduleMode(
        document.getElementById('opsAlertPaymentGatewaySummaryScheduleMode')?.value,
        currentConfig.payment_gateway.summary_schedule_mode
    );
    nextConfig.payment_gateway.summary_hourly_minute = toWholeNumber(
        document.getElementById('opsAlertPaymentGatewaySummaryHourlyMinute')?.value,
        currentConfig.payment_gateway.summary_hourly_minute
    );
    nextConfig.payment_gateway.summary_daily_hour = toWholeNumber(
        document.getElementById('opsAlertPaymentGatewaySummaryDailyHour')?.value,
        currentConfig.payment_gateway.summary_daily_hour
    );
    nextConfig.payment_gateway.summary_daily_minute = toWholeNumber(
        document.getElementById('opsAlertPaymentGatewaySummaryDailyMinute')?.value,
        currentConfig.payment_gateway.summary_daily_minute
    );
    nextConfig.payment_gateway.summary_max_items = toWholeNumber(
        document.getElementById('opsAlertPaymentGatewaySummaryMaxItems')?.value,
        currentConfig.payment_gateway.summary_max_items
    );

    return normalizeOpsAlertConfig(nextConfig);
}

function clearOpsAlertSecretInputs() {
    [
        'opsAlertTelegramBotToken',
        'opsAlertFeishuWebhookUrl',
        'opsAlertEmailApiKey'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });
}

function buildOpsAlertSettingsRequestBody(config, options = {}) {
    const body = {
        config,
        secrets: {
            telegram_bot_token: document.getElementById('opsAlertTelegramBotToken')?.value?.trim() || '',
            feishu_webhook_url: document.getElementById('opsAlertFeishuWebhookUrl')?.value?.trim() || '',
            email_api_key: document.getElementById('opsAlertEmailApiKey')?.value?.trim() || ''
        }
    };

    if (Array.isArray(options.caseEvents) && options.caseEvents.length) {
        body.case_events = options.caseEvents;
    }

    return body;
}

async function saveOpsAlertConfigOverride(config, options = {}) {
    setOpsAlertStrategySaveBusy(true);
    try {
        const headers = await getAdminConfigApiHeaders();
        const body = buildOpsAlertSettingsRequestBody(normalizeOpsAlertConfig(config), options);

        const response = await fetch('/api/admin/settings/ops-alerts', {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '保存站外退款告警配置失败');
        }

        systemConfigCache['ops_alerts'] = normalizeOpsAlertConfig(payload.config);
        opsAlertSecretStatus = payload.secrets || getDefaultOpsAlertSecretStatus();
        renderOpsAlertSettings();
        clearOpsAlertSecretInputs();
        if (options.successMessage) {
            showConfigSavedToast(options.successMessage);
        } else {
            showConfigSavedToast(payload.message || '站外退款告警配置已保存');
        }
        return true;
    } catch (error) {
        console.error('[Config] Save ops alert settings failed:', error);
        showToast('保存失败: ' + (error.message || '未知错误'), 'error');
        renderOpsAlertSettings();
        return false;
    } finally {
        setOpsAlertStrategySaveBusy(false);
    }
}

async function saveOpsAlertSettings() {
    return saveOpsAlertConfigOverride(collectOpsAlertConfigFromForm());
}

async function sendOpsAlertTelegramRequest(action, fallbackMessage) {
    const config = collectOpsAlertConfigFromForm();
    const telegramEnabled = config.channels?.telegram?.enabled === true;
    const feishuEnabled = config.channels?.feishu?.enabled === true;
    const emailEnabled = config.channels?.email?.enabled === true;
    const chatIds = Array.isArray(config.channels?.telegram?.chat_ids)
        ? config.channels.telegram.chat_ids
        : [];
    const hasStoredTelegramToken = Boolean(opsAlertSecretStatus?.telegram_bot_token?.configured);
    const hasStoredFeishuWebhook = Boolean(opsAlertSecretStatus?.feishu_webhook_url?.configured);
    const hasStoredEmailApiKey = Boolean(opsAlertSecretStatus?.email_api_key?.configured);
    const providedTelegramToken = document.getElementById('opsAlertTelegramBotToken')?.value?.trim() || '';
    const providedFeishuWebhook = document.getElementById('opsAlertFeishuWebhookUrl')?.value?.trim() || '';
    const providedEmailApiKey = document.getElementById('opsAlertEmailApiKey')?.value?.trim() || '';

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
        const recipients = Array.isArray(config.channels?.email?.recipients) ? config.channels.email.recipients : [];
        if (!recipients.length) {
            throw new Error('已启用邮件告警，请先填写至少一个收件人');
        }
        if (!config.channels?.email?.from_address) {
            throw new Error('已启用邮件告警，请先填写发件地址');
        }
        if (!providedEmailApiKey && !hasStoredEmailApiKey) {
            throw new Error('已启用邮件告警，请先填写 Email API Key，或先保存已配置的后台密钥');
        }
    }

    const headers = await getAdminConfigApiHeaders();
    const response = await fetch('/api/admin/settings/ops-alerts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            action,
            config,
            secrets: {
                telegram_bot_token: providedTelegramToken,
                feishu_webhook_url: providedFeishuWebhook,
                email_api_key: providedEmailApiKey
            }
        })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
        throw new Error(payload.message || fallbackMessage);
    }

    showConfigSavedToast(payload.message || fallbackMessage);
    return true;
}

async function sendOpsAlertTelegramTest() {
    try {
        return await sendOpsAlertTelegramRequest('send_test_telegram', '测试站外告警已发送');
    } catch (error) {
        console.error('[Config] Send ops alert test failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertRefundSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_refund_telegram', '退款详情示例消息已发送');
    } catch (error) {
        console.error('[Config] Send Telegram refund sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertCustomerChatMessageSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_customer_chat_message', '客服消息示例已发送');
    } catch (error) {
        console.error('[Config] Send customer chat message sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertShopPurchaseSucceededSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_shop_purchase_succeeded', '购买成功示例消息已发送');
    } catch (error) {
        console.error('[Config] Send shop purchase succeeded sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertWalletRechargeSucceededSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_wallet_recharge_succeeded', '充值成功示例消息已发送');
    } catch (error) {
        console.error('[Config] Send wallet recharge succeeded sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertGatewaySample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_gateway_degraded', '支付通道异常示例消息已发送');
    } catch (error) {
        console.error('[Config] Send payment gateway degraded sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertGatewayRecoveredSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_gateway_recovered', '支付通道恢复示例消息已发送');
    } catch (error) {
        console.error('[Config] Send payment gateway recovery sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertVerifyServiceDisabledSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_verify_service_disabled', '验证服务停摆示例消息已发送');
    } catch (error) {
        console.error('[Config] Send verify service disabled sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertVerifyQueueBacklogSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_verify_queue_backlog', '验证任务堆积示例消息已发送');
    } catch (error) {
        console.error('[Config] Send verify queue backlog sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertVerifyFailureRateSpikeSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_verify_failure_rate_spike', '验证失败率异常示例消息已发送');
    } catch (error) {
        console.error('[Config] Send verify failure rate spike sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertVerifyIncidentEscalatedSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_verify_incident_escalated', '验证综合异常示例消息已发送');
    } catch (error) {
        console.error('[Config] Send verify incident escalation sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertVerifyIncidentRecoveredSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_verify_incident_recovered', '验证恢复示例消息已发送');
    } catch (error) {
        console.error('[Config] Send verify incident recovered sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertVerifyQuotaSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_verify_quota_low', '验证额度告警示例消息已发送');
    } catch (error) {
        console.error('[Config] Send verify quota sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertTicketSlaSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_ticket_sla_overdue', '工单超时示例消息已发送');
    } catch (error) {
        console.error('[Config] Send ticket SLA sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertTicketSlaRecoveredSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_ticket_sla_recovered', '工单恢复示例消息已发送');
    } catch (error) {
        console.error('[Config] Send ticket SLA recovery sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertShopInventorySample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_shop_inventory_low', '库存预警示例消息已发送');
    } catch (error) {
        console.error('[Config] Send shop inventory sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertShopInventoryRecoveredSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_shop_inventory_recovered', '库存恢复示例消息已发送');
    } catch (error) {
        console.error('[Config] Send shop inventory recovery sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertAdminLoginAnomalySample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_admin_login_anomaly', '管理员异常登录示例消息已发送');
    } catch (error) {
        console.error('[Config] Send admin login anomaly sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertShopOrderDeliveryFailedSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_shop_order_delivery_failed', '履约失败示例消息已发送');
    } catch (error) {
        console.error('[Config] Send shop order delivery failed sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertShopOrderDeliveryIncidentSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_shop_order_delivery_incident', '履约异常升级示例消息已发送');
    } catch (error) {
        console.error('[Config] Send shop order delivery incident sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertShopOrderDeliveryIncidentRecoveredSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_shop_order_delivery_incident_recovered', '履约事故恢复示例消息已发送');
    } catch (error) {
        console.error('[Config] Send shop order delivery incident recovery sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertShopOrderDeliveryRecoveredSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_shop_order_delivery_recovered', '履约恢复示例消息已发送');
    } catch (error) {
        console.error('[Config] Send shop order delivery recovered sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertPaymentConfigChangedSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_payment_config_changed', '支付配置变更示例消息已发送');
    } catch (error) {
        console.error('[Config] Send payment config changed sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertPaymentConfigIncidentSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_payment_config_incident', '支付配置异常升级示例消息已发送');
    } catch (error) {
        console.error('[Config] Send payment config incident sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertPaymentConfigIncidentRecoveredSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_payment_config_incident_recovered', '支付配置事故恢复示例消息已发送');
    } catch (error) {
        console.error('[Config] Send payment config incident recovered sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertPaymentConfigRecoveredSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_payment_config_recovered', '支付配置恢复示例消息已发送');
    } catch (error) {
        console.error('[Config] Send payment config recovered sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function refreshOpsAlertHealthPanel() {
    const result = await loadOpsAlertHealth(true);
    if (result?.success) {
        showConfigSavedToast('告警通道健康页已刷新');
        return true;
    }
    showToast('刷新失败: 请稍后重试', 'error');
    return false;
}

async function refreshOpsAlertMonitorPanel() {
    const result = await loadOpsAlertMonitor(true);
    if (result?.success) {
        showConfigSavedToast('集中告警处理面板已刷新');
        return true;
    }
    showToast('刷新失败: 请稍后重试', 'error');
    return false;
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

async function scrollToOpsAlertHealthPanel() {
    if (typeof window.switchOpsAlertsView === 'function') {
        window.switchOpsAlertsView('health');
    }
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

function normalizeOpsAlertWorkspaceContext(context = {}) {
    return {
        title: String(context.title || context.workspaceTitle || '').trim(),
        alertType: String(context.alertType || context.alert_type || '').trim().toLowerCase(),
        category: String(context.category || context.workspaceCategory || '').trim().toLowerCase(),
        referenceLabel: String(context.referenceLabel || context.reference_label || '').trim(),
        referenceValue: String(context.referenceValue || context.reference_value || '').trim(),
        targetId: String(context.targetId || context.target_id || '').trim(),
        userId: String(context.userId || context.user_id || context.workspaceUserId || '').trim(),
        clientIp: String(context.clientIp || context.client_ip || context.workspaceClientIp || '').trim(),
        discountCode: String(context.discountCode || context.discount_code || context.workspaceDiscountCode || '').trim(),
        signalType: String(context.signalType || context.signal_type || context.workspaceSignalType || '').trim().toLowerCase(),
        caseStatus: String(context.caseStatus || context.case_status || context.workspaceCaseStatus || '').trim().toLowerCase(),
        caseOwnerAdminId: String(context.caseOwnerAdminId || context.case_owner_admin_id || context.workspaceCaseOwnerAdminId || '').trim(),
        caseOwnerLabel: String(context.caseOwnerLabel || context.case_owner_label || context.workspaceCaseOwnerLabel || '').trim()
    };
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

async function tryOpenOpsAlertWorkspaceUserModal(userId, attemptCount = 6, delayMs = 140) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
        return false;
    }

    const encodedUserId = encodeURIComponent(normalizedUserId);
    for (let attempt = 0; attempt < attemptCount; attempt += 1) {
        const row = document.querySelector(`[data-admin-action="users-open-drawer"][data-user-id="${encodedUserId}"]`);
        if (row instanceof HTMLElement) {
            row.click();
            return true;
        }
        await settleOpsAlertWorkspace(delayMs);
    }

    return false;
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
    const topicMap = {
        payment_refund_ops: 'all',
        payment_gateway_degraded: 'all',
        payment_config_changed: 'all',
        payment_config_incident: 'all'
    };
    return topicMap[alertType] || 'all';
}

function getOpsAlertWorkspaceSuccessLabel(workspaceKey) {
    const normalizedKey = String(workspaceKey || '').trim().toLowerCase();
    const labels = {
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
    };
    return labels[normalizedKey] || '告警处理入口';
}

async function openOpsAlertWorkspace(workspaceKey, context = {}) {
    const normalizedKey = String(workspaceKey || '').trim().toLowerCase();
    const normalizedContext = normalizeOpsAlertWorkspaceContext(context);
    const workspaceSearchValue = getOpsAlertWorkspaceSearchValue(normalizedContext);
    if (!normalizedKey) {
        showToast('缺少告警处理入口标识', 'warning');
        return false;
    }

    try {
        if (normalizedKey === 'verify-monitor') {
            window.switchModule?.('settings');
            await settleOpsAlertWorkspace();
            window.switchSettingsView?.('security');
            await settleOpsAlertWorkspace();
            await window.refreshVerifyMonitor?.(true);
            scrollToOpsAlertWorkspaceTarget('verifyMonitorPanel');
        } else if (normalizedKey === 'admin-audit-monitor') {
            window.switchModule?.('settings');
            await settleOpsAlertWorkspace();
            window.switchSettingsView?.('security');
            await settleOpsAlertWorkspace();
            await window.refreshAdminAuditMonitor?.(true);
            scrollToOpsAlertWorkspaceTarget('adminAuditMonitorSection');
        } else if (normalizedKey === 'payments-overview') {
            window.switchModule?.('payments');
            await settleOpsAlertWorkspace();
            await window.AdminPayments?.init?.();
            window.AdminPayments?.switchTab?.('overview', { reload: false });
            await settleOpsAlertWorkspace();
            scrollToOpsAlertWorkspaceTarget('paymentsProviderStats');
        } else if (normalizedKey === 'payments-ops') {
            window.switchModule?.('payments');
            await settleOpsAlertWorkspace();
            await window.AdminPayments?.init?.();
            await window.AdminPayments?.focusExceptionTopic?.(getOpsAlertWorkspacePaymentsTopic(normalizedContext));
        } else if (normalizedKey === 'tickets-pending' || normalizedKey === 'tickets-resolved') {
            const nextStatus = normalizedKey === 'tickets-pending' ? 'pending' : 'resolved';
            window.switchModule?.('tickets');
            await settleOpsAlertWorkspace();
            await window.AdminTickets?.init?.();
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
            await settleOpsAlertWorkspace();
            scrollToOpsAlertWorkspaceTarget('module-tickets');
        } else if (normalizedKey === 'shop-inventory') {
            window.switchModule?.('shop');
            await settleOpsAlertWorkspace();
            await window.ShopAdmin?.init?.();
            window.ShopAdmin?.switchTab?.('inventory');
            await settleOpsAlertWorkspace();
            scrollToOpsAlertWorkspaceTarget('shop-view-inventory');
        } else if (normalizedKey === 'shop-fulfillment') {
            window.switchModule?.('shop');
            await settleOpsAlertWorkspace();
            await window.ShopAdmin?.init?.();
            window.ShopAdmin?.switchTab?.('fulfillment');
            await settleOpsAlertWorkspace();
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
            scrollToOpsAlertWorkspaceTarget('deliveryDeadLetterSummary');
        } else if (normalizedKey === 'shop-risk-orders') {
            const orderSearchValue = ['订单号', '订单'].includes(normalizedContext.referenceLabel)
                ? workspaceSearchValue
                : '';
            window.switchModule?.('shop');
            await settleOpsAlertWorkspace();
            await window.ShopAdmin?.init?.();
            window.ShopAdmin?.switchTab?.('orders');
            await settleOpsAlertWorkspace();
            const orderSearchInput = document.getElementById('orderSearchInput');
            if (orderSearchInput) {
                orderSearchInput.value = orderSearchValue || '';
            }
            await window.ShopAdmin?.searchOrders?.(1);
            scrollToOpsAlertWorkspaceTarget('shop-view-orders');
        } else if (normalizedKey === 'shop-risk-discounts') {
            const discountSearchValue = getOpsAlertWorkspaceDiscountCode(normalizedContext) || workspaceSearchValue || '';
            window.switchModule?.('discounts');
            await settleOpsAlertWorkspace();
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
            scrollToOpsAlertWorkspaceTarget('module-discounts');
        } else if (normalizedKey === 'shop-risk-users') {
            const riskUserId = getOpsAlertWorkspaceRiskUserId(normalizedContext);
            const userSearchValue = riskUserId || workspaceSearchValue || '';
            window.switchModule?.('users');
            await settleOpsAlertWorkspace();
            const userSearchInput = document.getElementById('userSearchInput');
            if (userSearchInput) {
                userSearchInput.value = userSearchValue;
                userSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            await settleOpsAlertWorkspace();
            if (riskUserId) {
                await tryOpenOpsAlertWorkspaceUserModal(riskUserId);
            } else {
                scrollToOpsAlertWorkspaceTarget('module-users');
            }
        } else {
            throw new Error('未识别的告警处理入口');
        }

        showToast(`已打开${getOpsAlertWorkspaceSuccessLabel(normalizedKey)}`, 'success');
        return true;
    } catch (error) {
        console.error('[Config] Open ops alert workspace failed:', error);
        showToast('打开失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

function getOpsAlertCaseComposerTargetLabel(context = {}) {
    const normalizedContext = normalizeOpsAlertWorkspaceContext(context);
    if (normalizedContext.referenceLabel && normalizedContext.referenceValue) {
        return `${normalizedContext.referenceLabel}：${normalizedContext.referenceValue}`;
    }
    return normalizedContext.title || normalizedContext.targetId || '集中告警';
}

function getOpsAlertCaseComposerBatchPreview(items = []) {
    const previewLabels = (Array.isArray(items) ? items : [])
        .slice(0, 3)
        .map((item) => {
            if (item.reference_label && item.reference_value) {
                return `${item.reference_label}：${item.reference_value}`;
            }
            return item.title || item.target_id || '告警';
        })
        .filter(Boolean);

    const overflowCount = Math.max(0, (Array.isArray(items) ? items.length : 0) - previewLabels.length);
    return `${previewLabels.join(' / ')}${overflowCount > 0 ? ` 等 ${formatVerifyMonitorInteger(overflowCount)} 条` : ''}`;
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
    const normalizedAction = String(state.action || '').trim().toLowerCase();
    const normalizedContext = normalizeOpsAlertWorkspaceContext(state.context || {});
    const items = Array.isArray(state.items) ? state.items : [];
    const isBatch = String(state.mode || 'single').trim().toLowerCase() === 'batch';
    const targetLabel = isBatch
        ? `当前筛选命中 ${formatVerifyMonitorInteger(items.length)} 条告警${items.length ? ` · ${getOpsAlertCaseComposerBatchPreview(items)}` : ''}`
        : getOpsAlertCaseComposerTargetLabel(normalizedContext);
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

function setOpsAlertCaseComposerVisible(visible) {
    const modal = document.getElementById('shopRiskCaseComposerModal');
    if (!modal) return;
    modal.classList.toggle('is-visible', visible);
    modal.setAttribute('aria-hidden', visible ? 'false' : 'true');
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

    const state = shopRiskCaseComposerState || getDefaultShopRiskCaseComposerState();
    const meta = getOpsAlertCaseComposerMeta(state);
    const isAssignAction = String(state.action || '').trim().toLowerCase() === 'assign';
    const ownerOptions = getOpsAlertMonitorAssignableAdmins();
    const selectedOwner = getDefaultOpsAlertCaseComposerOwner(state);

    titleEl.textContent = meta.title;
    summaryEl.textContent = meta.summary;
    descEl.textContent = meta.description;
    ownerFieldEl.hidden = !isAssignAction;
    if (isAssignAction) {
        ownerSelectEl.innerHTML = ownerOptions.length
            ? ownerOptions.map((admin) => `
                <option value="${escapeConfigHtml(admin.id)}">${escapeConfigHtml(admin.label)}${admin.email ? ` · ${escapeConfigHtml(admin.email)}` : ''}${admin.isCurrent ? '（我）' : ''}</option>
            `).join('')
            : '<option value="">暂无可选管理员</option>';
        ownerSelectEl.value = selectedOwner.id || ownerSelectEl.value || '';
        ownerSelectEl.disabled = state.submitting || ownerOptions.length === 0;
        ownerHintEl.textContent = ownerOptions.length
            ? '指派会写入统一处置事件，monitor 卡片会同步回显新的负责人。'
            : '当前未加载到管理员列表，请先刷新集中告警处理面板。';
    } else {
        ownerSelectEl.innerHTML = '';
        ownerSelectEl.disabled = false;
        ownerHintEl.textContent = '';
    }
    labelEl.textContent = meta.fieldLabel;
    textareaEl.placeholder = meta.placeholder;
    submitBtn.textContent = state.submitting ? '提交中...' : meta.submitLabel;
    submitBtn.disabled = state.submitting || (isAssignAction && ownerOptions.length === 0);

    setOpsAlertCaseComposerVisible(Boolean(state.open));
    if (state.open && !state.submitting) {
        window.setTimeout(() => {
            if (isAssignAction) {
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

async function submitOpsAlertCaseMutation(action, context = {}, options = {}) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    const normalizedContext = normalizeOpsAlertWorkspaceContext(context);
    const items = buildOpsAlertCaseMutationItems(options.items || [], String(options.categoryKey || normalizedContext.category || '').trim().toLowerCase());
    const headers = await getAdminConfigApiHeaders();
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
            title: normalizedContext.title || ''
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

    const response = await fetch('/api/admin/settings/ops-alert-monitor-cases', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
        throw new Error(payload.message || '集中告警处理失败');
    }

    return payload;
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

    const state = opsAlertBatchMuteState || getDefaultOpsAlertBatchMuteState();
    const moduleLabels = state.moduleKeys.map((key) => getOpsAlertMuteModuleLabel(key));
    const severityScopedNote = String(state.filters?.severity || 'all') !== 'all'
        ? '当前筛选里的级别条件只用于确定命中模块；本次静默会作用到对应模块的全部告警。'
        : '本次静默会直接写入模块级策略，命中的同类告警都会一起暂停外发。';

    summaryEl.textContent = state.open
        ? `当前筛选：${getOpsAlertMonitorFilterSummaryLabel(state.filters)} · 命中 ${formatVerifyMonitorInteger(state.moduleKeys.length)} 个模块（${moduleLabels.join('、') || '无'}）`
        : '集中告警模块静默';
    noteEl.textContent = severityScopedNote;
    if (!untilInput.value) {
        untilInput.value = getDefaultOpsAlertBatchMuteUntilInputValue();
    }
    allowCriticalToggle.classList.toggle('active', state.allowCritical !== false);
    submitBtn.disabled = state.submitting;
    submitBtn.textContent = state.submitting ? '静默中...' : '保存静默';

    setOpsAlertBatchMuteModalVisible(Boolean(state.open));
    if (state.open && !state.submitting) {
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

async function submitOpsAlertBatchMuteModal() {
    const state = opsAlertBatchMuteState || getDefaultOpsAlertBatchMuteState();
    const untilInput = document.getElementById('opsAlertBatchMuteUntil');
    const allowCriticalToggle = document.getElementById('opsAlertBatchMuteAllowCriticalToggle');
    const untilValue = String(untilInput?.value || '').trim();
    const normalizedUntil = normalizeDateTimeLocalInputValue(untilValue);
    const moduleLabels = state.moduleKeys.map((key) => getOpsAlertMuteModuleLabel(key));

    if (!state.open || !state.moduleKeys.length) {
        return false;
    }

    if (!normalizedUntil) {
        showToast('请先选择静默截止时间', 'warning');
        untilInput?.focus?.();
        return false;
    }

    try {
        opsAlertBatchMuteState = {
            ...state,
            allowCritical: allowCriticalToggle?.classList.contains('active') !== false,
            submitting: true
        };
        renderOpsAlertBatchMuteModal();

        const nextConfig = collectOpsAlertConfigFromForm();
        const allowCritical = allowCriticalToggle?.classList.contains('active') !== false;
        const caseEvents = state.items.length ? [{
            action: 'batch_mute',
            items: state.items,
            metadata: {
                mute_until: normalizedUntil,
                allow_critical: allowCritical,
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
                until: normalizedUntil,
                allow_critical: allowCritical
            };
        });

        const success = await saveOpsAlertConfigOverride(nextConfig, {
            successMessage: `已将 ${moduleLabels.join('、')} 静默至 ${formatVerifyMonitorDateTime(normalizedUntil)}`,
            caseEvents
        });
        if (!success) {
            opsAlertBatchMuteState = {
                ...state,
                allowCritical,
                submitting: false
            };
            renderOpsAlertBatchMuteModal();
            return false;
        }

        closeOpsAlertBatchMuteModal();
        await refreshOpsAlertMonitorPanel?.();
        return true;
    } catch (error) {
        console.error('[Config] Submit ops alert batch mute failed:', error);
        opsAlertBatchMuteState = {
            ...state,
            allowCritical: allowCriticalToggle?.classList.contains('active') !== false,
            submitting: false
        };
        renderOpsAlertBatchMuteModal();
        showToast('静默失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function submitOpsAlertCaseComposer() {
    const state = shopRiskCaseComposerState || getDefaultShopRiskCaseComposerState();
    const textareaEl = document.getElementById('shopRiskCaseComposerTextarea');
    const ownerSelectEl = document.getElementById('shopRiskCaseComposerOwnerSelect');
    const textValue = String(textareaEl?.value || '').trim();
    const selectedOwnerAdminId = String(ownerSelectEl?.value || state.selectedOwnerAdminId || '').trim();
    const selectedOwner = getOpsAlertMonitorAssignableAdmins().find((admin) => admin.id === selectedOwnerAdminId) || null;
    const selectedOwnerLabel = selectedOwner?.label || String(state.selectedOwnerLabel || '').trim();

    if (!state.open || !state.action) {
        return false;
    }

    if (state.action === 'assign' && !selectedOwnerAdminId) {
        showToast('请先选择负责人', 'warning');
        ownerSelectEl?.focus?.();
        return false;
    }

    if (['add_note', 'resolve'].includes(String(state.action || '').trim().toLowerCase()) && !textValue) {
        showToast(state.action === 'resolve' ? '请先填写关闭结论' : '请先填写备注内容', 'warning');
        textareaEl?.focus?.();
        return false;
    }

    try {
        shopRiskCaseComposerState = {
            ...state,
            selectedOwnerAdminId,
            selectedOwnerLabel,
            submitting: true
        };
        renderOpsAlertCaseComposer();

        const payload = await submitOpsAlertCaseMutation(state.action, state.context, {
            items: state.mode === 'batch' ? state.items : [],
            note: textValue,
            resolution: state.action === 'resolve' ? textValue : '',
            ownerAdminId: state.action === 'assign' ? selectedOwnerAdminId : '',
            ownerLabel: state.action === 'assign' ? selectedOwnerLabel : ''
        });

        closeOpsAlertCaseComposer();
        await refreshOpsAlertMonitorPanel?.();
        showToast(payload.message || '集中告警已更新', 'success');
        return true;
    } catch (error) {
        console.error('[Config] Submit ops alert case composer failed:', error);
        shopRiskCaseComposerState = {
            ...state,
            selectedOwnerAdminId,
            selectedOwnerLabel,
            submitting: false
        };
        renderOpsAlertCaseComposer();
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
    const secretLabels = {
        telegram_bot_token: 'Telegram Bot Token',
        feishu_webhook_url: '飞书 Webhook',
        email_api_key: 'Email API Key'
    };
    const normalizedSecretName = String(secretName || '').trim();
    if (!secretLabels[normalizedSecretName]) {
        showToast('无效的站外告警密钥标识', 'warning');
        return false;
    }

    const currentStatus = opsAlertSecretStatus?.[normalizedSecretName];
    if (currentStatus?.source === 'environment') {
        showToast(`${secretLabels[normalizedSecretName]} 当前来自环境变量，请在部署平台里删除。`, 'warning');
        return false;
    }

    if (!confirm(`确定删除 ${secretLabels[normalizedSecretName]} 吗？删除后将无法继续通过该通道发送站外退款告警。`)) {
        return false;
    }

    try {
        const headers = await getAdminConfigApiHeaders();
        const response = await fetch('/api/admin/settings/ops-alerts', {
            method: 'DELETE',
            headers,
            body: JSON.stringify({ secretName: normalizedSecretName })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '删除站外告警密钥失败');
        }

        systemConfigCache['ops_alerts'] = normalizeOpsAlertConfig(payload.config);
        opsAlertSecretStatus = payload.secrets || getDefaultOpsAlertSecretStatus();
        renderOpsAlertSettings();
        clearOpsAlertSecretInputs();
        showConfigSavedToast(payload.message || '站外告警密钥已删除');
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

function toggleOpsAlertShopRiskAutoResponseEnabled() {
    const toggleEl = document.getElementById('opsAlertShopRiskAutoResponseEnabledToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertShopInventoryEnabled() {
    const toggleEl = document.getElementById('opsAlertShopInventoryEnabledToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertShopInventoryControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertShopInventoryRecoveryNotificationEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertShopInventoryEnabledToggle');
    const toggleEl = document.getElementById('opsAlertShopInventoryRecoveryNotificationEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertShopInventoryControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertShopInventorySummaryEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertShopInventoryEnabledToggle');
    const toggleEl = document.getElementById('opsAlertShopInventorySummaryEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertShopInventoryControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function handleOpsAlertShopInventorySummaryScheduleModeChange() {
    applyOpsAlertShopInventoryControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertCustomerChatMessageEnabled() {
    const toggleEl = document.getElementById('opsAlertCustomerChatMessageEnabledToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertCustomerChatControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertCustomerChatMessageSummaryEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertCustomerChatMessageEnabledToggle');
    const toggleEl = document.getElementById('opsAlertCustomerChatMessageSummaryEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertCustomerChatControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertCustomerChatMessageWorkHoursOnlyEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertCustomerChatMessageEnabledToggle');
    const toggleEl = document.getElementById('opsAlertCustomerChatMessageWorkHoursOnlyEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertCustomerChatControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function handleOpsAlertCustomerChatMessageSummaryScheduleModeChange() {
    applyOpsAlertCustomerChatControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertShopPurchaseSuccessEnabled() {
    const toggleEl = document.getElementById('opsAlertShopPurchaseSuccessEnabledToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertShopPurchaseSuccessControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertShopPurchaseSuccessSummaryEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertShopPurchaseSuccessEnabledToggle');
    const toggleEl = document.getElementById('opsAlertShopPurchaseSuccessSummaryEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertShopPurchaseSuccessControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertShopPurchaseSuccessWorkHoursOnlyEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertShopPurchaseSuccessEnabledToggle');
    const toggleEl = document.getElementById('opsAlertShopPurchaseSuccessWorkHoursOnlyEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertShopPurchaseSuccessControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function handleOpsAlertShopPurchaseSuccessSummaryScheduleModeChange() {
    applyOpsAlertShopPurchaseSuccessControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertWalletRechargeSuccessEnabled() {
    const toggleEl = document.getElementById('opsAlertWalletRechargeSuccessEnabledToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertWalletRechargeSuccessControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertWalletRechargeSuccessSummaryEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertWalletRechargeSuccessEnabledToggle');
    const toggleEl = document.getElementById('opsAlertWalletRechargeSuccessSummaryEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertWalletRechargeSuccessControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertWalletRechargeSuccessWorkHoursOnlyEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertWalletRechargeSuccessEnabledToggle');
    const toggleEl = document.getElementById('opsAlertWalletRechargeSuccessWorkHoursOnlyEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertWalletRechargeSuccessControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function handleOpsAlertWalletRechargeSuccessSummaryScheduleModeChange() {
    applyOpsAlertWalletRechargeSuccessControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertTicketsEnabled() {
    const toggleEl = document.getElementById('opsAlertTicketsEnabledToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertTicketsControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertTicketsSummaryEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertTicketsEnabledToggle');
    const toggleEl = document.getElementById('opsAlertTicketsSummaryEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertTicketsControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertTicketsWorkHoursOnlyEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertTicketsEnabledToggle');
    const toggleEl = document.getElementById('opsAlertTicketsWorkHoursOnlyEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertTicketsControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function handleOpsAlertTicketsSummaryScheduleModeChange() {
    applyOpsAlertTicketsControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertShopOrderDeliveryEnabled() {
    const toggleEl = document.getElementById('opsAlertShopOrderDeliveryEnabledToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertShopOrderDeliveryControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertShopOrderDeliveryIncidentEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertShopOrderDeliveryEnabledToggle');
    const toggleEl = document.getElementById('opsAlertShopOrderDeliveryIncidentEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertShopOrderDeliveryControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertShopOrderDeliverySummaryEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertShopOrderDeliveryEnabledToggle');
    const toggleEl = document.getElementById('opsAlertShopOrderDeliverySummaryEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertShopOrderDeliveryControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertShopOrderDeliveryWorkHoursOnlyEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertShopOrderDeliveryEnabledToggle');
    const toggleEl = document.getElementById('opsAlertShopOrderDeliveryWorkHoursOnlyEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertShopOrderDeliveryControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function handleOpsAlertShopOrderDeliverySummaryScheduleModeChange() {
    applyOpsAlertShopOrderDeliveryControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertVerifyQuotaEnabled() {
    const toggleEl = document.getElementById('opsAlertVerifyQuotaEnabledToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertVerifyQuotaControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertVerifyQuotaSummaryEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertVerifyQuotaEnabledToggle');
    const toggleEl = document.getElementById('opsAlertVerifyQuotaSummaryEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertVerifyQuotaControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertVerifyQuotaWorkHoursOnlyEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertVerifyQuotaEnabledToggle');
    const toggleEl = document.getElementById('opsAlertVerifyQuotaWorkHoursOnlyEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertVerifyQuotaControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function handleOpsAlertVerifyQuotaSummaryScheduleModeChange() {
    applyOpsAlertVerifyQuotaControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertVerifyQueueEnabled() {
    const toggleEl = document.getElementById('opsAlertVerifyQueueEnabledToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertVerifyQueueControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertVerifyQueueSummaryEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertVerifyQueueEnabledToggle');
    const toggleEl = document.getElementById('opsAlertVerifyQueueSummaryEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertVerifyQueueControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertVerifyQueueWorkHoursOnlyEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertVerifyQueueEnabledToggle');
    const toggleEl = document.getElementById('opsAlertVerifyQueueWorkHoursOnlyEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertVerifyQueueControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function handleOpsAlertVerifyQueueSummaryScheduleModeChange() {
    applyOpsAlertVerifyQueueControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertVerifyFailureEnabled() {
    const toggleEl = document.getElementById('opsAlertVerifyFailureEnabledToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertVerifyFailureControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertVerifyFailureSummaryEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertVerifyFailureEnabledToggle');
    const toggleEl = document.getElementById('opsAlertVerifyFailureSummaryEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertVerifyFailureControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertVerifyFailureWorkHoursOnlyEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertVerifyFailureEnabledToggle');
    const toggleEl = document.getElementById('opsAlertVerifyFailureWorkHoursOnlyEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertVerifyFailureControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function handleOpsAlertVerifyFailureSummaryScheduleModeChange() {
    applyOpsAlertVerifyFailureControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertPaymentGatewayEnabled() {
    const toggleEl = document.getElementById('opsAlertPaymentGatewayEnabledToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertPaymentGatewayControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertPaymentGatewaySummaryEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertPaymentGatewayEnabledToggle');
    const toggleEl = document.getElementById('opsAlertPaymentGatewaySummaryEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertPaymentGatewayControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertPaymentGatewayWorkHoursOnlyEnabled() {
    const monitorToggleEl = document.getElementById('opsAlertPaymentGatewayEnabledToggle');
    const toggleEl = document.getElementById('opsAlertPaymentGatewayWorkHoursOnlyEnabledToggle');
    if (!toggleEl || !monitorToggleEl?.classList.contains('active')) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertPaymentGatewayControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function handleOpsAlertPaymentGatewaySummaryScheduleModeChange() {
    applyOpsAlertPaymentGatewayControls(collectOpsAlertConfigFromForm());
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

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

    const config = systemConfigCache['notifications'] || {};
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

    if (success && saveBtn) {
        if (typeof showToast === 'function') {
            showToast('公告已发布', 'success');
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
                    site,
                    profiles:user_id (username, avatar_url, email)
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
                    site,
                    profiles:user_id (username, avatar_url, email),
                    prompts:prompt_id (title),
                    comment_likes (count)
                `)
                .order('created_at', { ascending: false });
            query = window.AdminSiteFilter?.applySiteFilter?.(query) || query;
            return query;
        })
    ]);

    return [
        ...(guestbookRows || []).map((row) => ({
            id: row.id,
            type: 'guestbook',
            site: row.site || '',
            author: row.profiles?.username || '未知用户',
            email: row.profiles?.email || '',
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
            author: row.profiles?.username || '未知用户',
            email: row.profiles?.email || '',
            content: row.content || '',
            likes: row.comment_likes?.[0]?.count || 0,
            user_id: row.user_id || '',
            prompt_title: row.prompts?.title || '',
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
window.updatePackage = updatePackage;
window.togglePackageStatus = togglePackageStatus;
window.deletePackage = deletePackage;
window.addPackageRow = addPackageRow;
window.toggleCustomRechargeEntryStatus = toggleCustomRechargeEntryStatus;
window.toggleMockPaymentStatus = toggleMockPaymentStatus;
window.togglePaymentProviderEnabled = togglePaymentProviderEnabled;
window.togglePaymentProviderPanel = togglePaymentProviderPanel;
window.handlePaymentChannelActiveChange = handlePaymentChannelActiveChange;
window.savePaymentChannelSettings = savePaymentChannelSettings;
window.loadOpsAlertSettings = loadOpsAlertSettings;
window.loadOpsAlertHealth = loadOpsAlertHealth;
window.loadOpsAlertMonitor = loadOpsAlertMonitor;
window.toggleOpsAlertsEnabled = toggleOpsAlertsEnabled;
window.toggleOpsAlertChannelEnabled = toggleOpsAlertChannelEnabled;
window.toggleOpsAlertTemporaryMuteAllowCritical = toggleOpsAlertTemporaryMuteAllowCritical;
window.setOpsAlertTemporaryMutePreset = setOpsAlertTemporaryMutePreset;
window.clearOpsAlertTemporaryMute = clearOpsAlertTemporaryMute;
window.toggleOpsAlertMuteRuleAllowCritical = toggleOpsAlertMuteRuleAllowCritical;
window.clearOpsAlertMuteRule = clearOpsAlertMuteRule;
window.toggleOpsAlertQuietHoursEnabled = toggleOpsAlertQuietHoursEnabled;
window.toggleOpsAlertQuietHoursAllowCritical = toggleOpsAlertQuietHoursAllowCritical;
window.toggleOpsAlertWorkHoursEnabled = toggleOpsAlertWorkHoursEnabled;
window.toggleOpsAlertStrategyPanel = toggleOpsAlertStrategyPanel;
window.toggleOpsAlertSummaryPanel = toggleOpsAlertSummaryPanel;
window.openOpsAlertStrategyPanel = openOpsAlertStrategyPanel;
window.switchOpsAlertStrategyMuteTab = switchOpsAlertStrategyMuteTab;
window.toggleOpsAlertDatePicker = toggleOpsAlertDatePicker;
window.changeOpsAlertDatePickerMonth = changeOpsAlertDatePickerMonth;
window.selectOpsAlertDatePickerDay = selectOpsAlertDatePickerDay;
window.setOpsAlertDatePickerPreset = setOpsAlertDatePickerPreset;
window.applyOpsAlertDatePicker = applyOpsAlertDatePicker;
window.clearOpsAlertDatePicker = clearOpsAlertDatePicker;
window.toggleOpsAlertShopRiskAutoResponseEnabled = toggleOpsAlertShopRiskAutoResponseEnabled;
window.toggleOpsAlertShopInventoryEnabled = toggleOpsAlertShopInventoryEnabled;
window.toggleOpsAlertShopInventoryRecoveryNotificationEnabled = toggleOpsAlertShopInventoryRecoveryNotificationEnabled;
window.toggleOpsAlertShopInventorySummaryEnabled = toggleOpsAlertShopInventorySummaryEnabled;
window.handleOpsAlertShopInventorySummaryScheduleModeChange = handleOpsAlertShopInventorySummaryScheduleModeChange;
window.toggleOpsAlertCustomerChatMessageEnabled = toggleOpsAlertCustomerChatMessageEnabled;
window.toggleOpsAlertCustomerChatMessageSummaryEnabled = toggleOpsAlertCustomerChatMessageSummaryEnabled;
window.toggleOpsAlertCustomerChatMessageWorkHoursOnlyEnabled = toggleOpsAlertCustomerChatMessageWorkHoursOnlyEnabled;
window.handleOpsAlertCustomerChatMessageSummaryScheduleModeChange = handleOpsAlertCustomerChatMessageSummaryScheduleModeChange;
window.toggleOpsAlertShopPurchaseSuccessEnabled = toggleOpsAlertShopPurchaseSuccessEnabled;
window.toggleOpsAlertShopPurchaseSuccessSummaryEnabled = toggleOpsAlertShopPurchaseSuccessSummaryEnabled;
window.toggleOpsAlertShopPurchaseSuccessWorkHoursOnlyEnabled = toggleOpsAlertShopPurchaseSuccessWorkHoursOnlyEnabled;
window.handleOpsAlertShopPurchaseSuccessSummaryScheduleModeChange = handleOpsAlertShopPurchaseSuccessSummaryScheduleModeChange;
window.toggleOpsAlertWalletRechargeSuccessEnabled = toggleOpsAlertWalletRechargeSuccessEnabled;
window.toggleOpsAlertWalletRechargeSuccessSummaryEnabled = toggleOpsAlertWalletRechargeSuccessSummaryEnabled;
window.toggleOpsAlertWalletRechargeSuccessWorkHoursOnlyEnabled = toggleOpsAlertWalletRechargeSuccessWorkHoursOnlyEnabled;
window.handleOpsAlertWalletRechargeSuccessSummaryScheduleModeChange = handleOpsAlertWalletRechargeSuccessSummaryScheduleModeChange;
window.toggleOpsAlertTicketsEnabled = toggleOpsAlertTicketsEnabled;
window.toggleOpsAlertTicketsSummaryEnabled = toggleOpsAlertTicketsSummaryEnabled;
window.toggleOpsAlertTicketsWorkHoursOnlyEnabled = toggleOpsAlertTicketsWorkHoursOnlyEnabled;
window.handleOpsAlertTicketsSummaryScheduleModeChange = handleOpsAlertTicketsSummaryScheduleModeChange;
window.toggleOpsAlertShopOrderDeliveryEnabled = toggleOpsAlertShopOrderDeliveryEnabled;
window.toggleOpsAlertShopOrderDeliveryIncidentEnabled = toggleOpsAlertShopOrderDeliveryIncidentEnabled;
window.toggleOpsAlertShopOrderDeliverySummaryEnabled = toggleOpsAlertShopOrderDeliverySummaryEnabled;
window.toggleOpsAlertShopOrderDeliveryWorkHoursOnlyEnabled = toggleOpsAlertShopOrderDeliveryWorkHoursOnlyEnabled;
window.handleOpsAlertShopOrderDeliverySummaryScheduleModeChange = handleOpsAlertShopOrderDeliverySummaryScheduleModeChange;
window.toggleOpsAlertVerifyQuotaEnabled = toggleOpsAlertVerifyQuotaEnabled;
window.toggleOpsAlertVerifyQuotaSummaryEnabled = toggleOpsAlertVerifyQuotaSummaryEnabled;
window.toggleOpsAlertVerifyQuotaWorkHoursOnlyEnabled = toggleOpsAlertVerifyQuotaWorkHoursOnlyEnabled;
window.handleOpsAlertVerifyQuotaSummaryScheduleModeChange = handleOpsAlertVerifyQuotaSummaryScheduleModeChange;
window.toggleOpsAlertVerifyQueueEnabled = toggleOpsAlertVerifyQueueEnabled;
window.toggleOpsAlertVerifyQueueSummaryEnabled = toggleOpsAlertVerifyQueueSummaryEnabled;
window.toggleOpsAlertVerifyQueueWorkHoursOnlyEnabled = toggleOpsAlertVerifyQueueWorkHoursOnlyEnabled;
window.handleOpsAlertVerifyQueueSummaryScheduleModeChange = handleOpsAlertVerifyQueueSummaryScheduleModeChange;
window.toggleOpsAlertVerifyFailureEnabled = toggleOpsAlertVerifyFailureEnabled;
window.toggleOpsAlertVerifyFailureSummaryEnabled = toggleOpsAlertVerifyFailureSummaryEnabled;
window.toggleOpsAlertVerifyFailureWorkHoursOnlyEnabled = toggleOpsAlertVerifyFailureWorkHoursOnlyEnabled;
window.handleOpsAlertVerifyFailureSummaryScheduleModeChange = handleOpsAlertVerifyFailureSummaryScheduleModeChange;
window.toggleOpsAlertPaymentGatewayEnabled = toggleOpsAlertPaymentGatewayEnabled;
window.toggleOpsAlertPaymentGatewaySummaryEnabled = toggleOpsAlertPaymentGatewaySummaryEnabled;
window.toggleOpsAlertPaymentGatewayWorkHoursOnlyEnabled = toggleOpsAlertPaymentGatewayWorkHoursOnlyEnabled;
window.handleOpsAlertPaymentGatewaySummaryScheduleModeChange = handleOpsAlertPaymentGatewaySummaryScheduleModeChange;
window.selectOpsAlertUnifiedSummaryTargets = selectOpsAlertUnifiedSummaryTargets;
window.handleOpsAlertUnifiedSummaryTargetChange = handleOpsAlertUnifiedSummaryTargetChange;
window.handleOpsAlertUnifiedSummaryDraftChange = handleOpsAlertUnifiedSummaryDraftChange;
window.applyOpsAlertUnifiedSummaryDraft = applyOpsAlertUnifiedSummaryDraft;
window.confirmOpsAlertStrategyNavigation = confirmOpsAlertStrategyNavigation;
window.saveOpsAlertSettings = saveOpsAlertSettings;
window.sendOpsAlertTelegramTest = sendOpsAlertTelegramTest;
window.sendOpsAlertRefundSample = sendOpsAlertRefundSample;
window.sendOpsAlertCustomerChatMessageSample = sendOpsAlertCustomerChatMessageSample;
window.sendOpsAlertShopPurchaseSucceededSample = sendOpsAlertShopPurchaseSucceededSample;
window.sendOpsAlertWalletRechargeSucceededSample = sendOpsAlertWalletRechargeSucceededSample;
window.sendOpsAlertGatewaySample = sendOpsAlertGatewaySample;
window.sendOpsAlertGatewayRecoveredSample = sendOpsAlertGatewayRecoveredSample;
window.sendOpsAlertVerifyServiceDisabledSample = sendOpsAlertVerifyServiceDisabledSample;
window.sendOpsAlertVerifyQueueBacklogSample = sendOpsAlertVerifyQueueBacklogSample;
window.sendOpsAlertVerifyFailureRateSpikeSample = sendOpsAlertVerifyFailureRateSpikeSample;
window.sendOpsAlertVerifyIncidentEscalatedSample = sendOpsAlertVerifyIncidentEscalatedSample;
window.sendOpsAlertVerifyIncidentRecoveredSample = sendOpsAlertVerifyIncidentRecoveredSample;
window.sendOpsAlertVerifyQuotaSample = sendOpsAlertVerifyQuotaSample;
window.sendOpsAlertTicketSlaSample = sendOpsAlertTicketSlaSample;
window.sendOpsAlertTicketSlaRecoveredSample = sendOpsAlertTicketSlaRecoveredSample;
window.sendOpsAlertShopInventorySample = sendOpsAlertShopInventorySample;
window.sendOpsAlertShopInventoryRecoveredSample = sendOpsAlertShopInventoryRecoveredSample;
window.sendOpsAlertAdminLoginAnomalySample = sendOpsAlertAdminLoginAnomalySample;
window.sendOpsAlertShopOrderDeliveryFailedSample = sendOpsAlertShopOrderDeliveryFailedSample;
window.sendOpsAlertShopOrderDeliveryIncidentSample = sendOpsAlertShopOrderDeliveryIncidentSample;
window.sendOpsAlertShopOrderDeliveryIncidentRecoveredSample = sendOpsAlertShopOrderDeliveryIncidentRecoveredSample;
window.sendOpsAlertShopOrderDeliveryRecoveredSample = sendOpsAlertShopOrderDeliveryRecoveredSample;
window.sendOpsAlertPaymentConfigChangedSample = sendOpsAlertPaymentConfigChangedSample;
window.sendOpsAlertPaymentConfigIncidentSample = sendOpsAlertPaymentConfigIncidentSample;
window.sendOpsAlertPaymentConfigIncidentRecoveredSample = sendOpsAlertPaymentConfigIncidentRecoveredSample;
window.sendOpsAlertPaymentConfigRecoveredSample = sendOpsAlertPaymentConfigRecoveredSample;
window.refreshOpsAlertHealthPanel = refreshOpsAlertHealthPanel;
window.scrollToOpsAlertHealthPanel = scrollToOpsAlertHealthPanel;
window.refreshOpsAlertMonitorPanel = refreshOpsAlertMonitorPanel;
window.setOpsAlertMonitorFilter = setOpsAlertMonitorFilter;
window.copyOpsAlertMonitorChecklist = copyOpsAlertMonitorChecklist;
window.exportOpsAlertMonitorCsv = exportOpsAlertMonitorCsv;
window.openOpsAlertWorkspace = openOpsAlertWorkspace;
window.handleOpsAlertCaseAction = handleOpsAlertCaseAction;
window.handleOpsAlertMonitorBatchCaseAction = handleOpsAlertMonitorBatchCaseAction;
window.openOpsAlertBatchMuteModal = openOpsAlertBatchMuteModal;
window.toggleOpsAlertBatchMuteAllowCritical = toggleOpsAlertBatchMuteAllowCritical;
window.closeOpsAlertBatchMuteModal = closeOpsAlertBatchMuteModal;
window.submitOpsAlertBatchMuteModal = submitOpsAlertBatchMuteModal;
window.closeOpsAlertCaseComposer = closeOpsAlertCaseComposer;
window.submitOpsAlertCaseComposer = submitOpsAlertCaseComposer;
window.handleShopRiskAction = handleShopRiskAction;
window.handleShopRiskCaseAction = handleShopRiskCaseAction;
window.closeShopRiskCaseComposer = closeShopRiskCaseComposer;
window.submitShopRiskCaseComposer = submitShopRiskCaseComposer;
window.deleteOpsAlertSecret = deleteOpsAlertSecret;
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
