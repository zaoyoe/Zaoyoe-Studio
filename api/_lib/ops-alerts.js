const crypto = require('crypto');
const {
    OPS_ALERT_SECRET_KEYS: CONFIGURED_OPS_ALERT_SECRET_KEYS,
    getStoredAdminSecret
} = require('./secrets');

const OPS_ALERTS_CONFIG_KEY = 'ops_alerts';
const DEFAULT_OPS_ALERT_SECRET_KEYS = Object.freeze({
    telegram_bot_token: 'ops_alert_telegram_bot_token',
    feishu_webhook_url: 'ops_alert_feishu_webhook_url',
    email_api_key: 'ops_alert_email_api_key'
});
const SUPPORTED_CHANNELS = Object.freeze(['telegram', 'feishu', 'email']);
const DEFAULT_QUIET_HOURS_TIMEZONE = 'Asia/Shanghai';
const DEFAULT_SUMMARY_SCHEDULE_MODE = 'rolling_window';
const WORK_HOURS_SUMMARY_SCHEDULE_MODE = 'work_hours';
const SUPPORTED_SUMMARY_SCHEDULE_MODES = Object.freeze([
    DEFAULT_SUMMARY_SCHEDULE_MODE,
    'hourly',
    'daily',
    WORK_HOURS_SUMMARY_SCHEDULE_MODE
]);
const SUPPORTED_ROUTING_KEYS = Object.freeze([
    'customer_chat_message',
    'shop_purchase_success',
    'wallet_recharge_success',
    'shop_inventory'
]);
const SUPPORTED_MUTE_RULE_MODULE_KEYS = Object.freeze([
    'customer_engagement',
    'commerce',
    'inventory',
    'payments',
    'shop_risk',
    'verify',
    'tickets',
    'fulfillment',
    'security'
]);
const ALERT_TYPE_ROUTING_MAP = Object.freeze({
    customer_chat_message_received: 'customer_chat_message',
    customer_chat_message_summary: 'customer_chat_message',
    shop_purchase_succeeded: 'shop_purchase_success',
    shop_purchase_summary: 'shop_purchase_success',
    wallet_recharge_succeeded: 'wallet_recharge_success',
    wallet_recharge_summary: 'wallet_recharge_success',
    shop_inventory_summary: 'shop_inventory',
    shop_inventory_low: 'shop_inventory',
    shop_inventory_empty: 'shop_inventory',
    shop_inventory_recovered: 'shop_inventory'
});
const ALERT_TYPE_MODULE_MAP = Object.freeze({
    customer_chat_message_received: 'customer_engagement',
    customer_chat_message_summary: 'customer_engagement',
    shop_purchase_succeeded: 'commerce',
    shop_purchase_summary: 'commerce',
    wallet_recharge_succeeded: 'commerce',
    wallet_recharge_summary: 'commerce',
    shop_inventory_summary: 'inventory',
    shop_inventory_low: 'inventory',
    shop_inventory_empty: 'inventory',
    shop_inventory_recovered: 'inventory',
    payment_gateway_degraded: 'payments',
    payment_gateway_recovered: 'payments',
    payment_refund_ops: 'payments',
    payment_refund_alert: 'payments',
    payment_config_changed: 'payments',
    payment_config_recovered: 'payments',
    payment_config_incident: 'payments',
    payment_config_incident_recovered: 'payments',
    shop_order_risk_anomaly: 'shop_risk',
    shop_order_risk_recovered: 'shop_risk',
    verify_quota_low: 'verify',
    verify_service_disabled: 'verify',
    verify_failure_rate_spike: 'verify',
    verify_queue_backlog: 'verify',
    verify_incident_escalated: 'verify',
    verify_incident_recovered: 'verify',
    ticket_sla_overdue: 'tickets',
    ticket_sla_recovered: 'tickets',
    shop_order_delivery_failed: 'fulfillment',
    shop_order_delivery_recovered: 'fulfillment',
    shop_order_delivery_incident: 'fulfillment',
    shop_order_delivery_incident_recovered: 'fulfillment',
    security_admin_login_anomaly: 'security'
});
const SEVERITY_RANK = Object.freeze({
    info: 10,
    warning: 20,
    critical: 30
});
const SUMMARY_ALERT_DEFINITIONS = Object.freeze({
    customer_chat_message_received: Object.freeze({
        config_key: 'customer_chat_message',
        summary_alert_type: 'customer_chat_message_summary',
        default_title: '客服消息汇总',
        unit: '条新消息'
    }),
    shop_purchase_succeeded: Object.freeze({
        config_key: 'shop_purchase_success',
        summary_alert_type: 'shop_purchase_summary',
        default_title: '购买成功汇总',
        unit: '笔订单'
    }),
    wallet_recharge_succeeded: Object.freeze({
        config_key: 'wallet_recharge_success',
        summary_alert_type: 'wallet_recharge_summary',
        default_title: '充值成功汇总',
        unit: '笔充值'
    }),
    shop_inventory_low: Object.freeze({
        config_key: 'shop_inventory',
        summary_alert_type: 'shop_inventory_summary',
        default_title: '库存与补货汇总',
        unit: '条库存告警'
    }),
    shop_inventory_empty: Object.freeze({
        config_key: 'shop_inventory',
        summary_alert_type: 'shop_inventory_summary',
        default_title: '库存与补货汇总',
        unit: '条库存告警'
    })
});
const DEFAULT_OPS_ALERTS_CONFIG = Object.freeze({
    enabled: false,
    dedupe_window_minutes: 45,
    batch_size: 10,
    sweep_interval_ms: 15000,
    max_attempts: 6,
    retry_base_delay_ms: 60000,
    retry_max_delay_ms: 1800000,
    timeout_ms: 5000,
    temporary_mute: Object.freeze({
        until: '',
        allow_critical: true
    }),
    quiet_hours: Object.freeze({
        enabled: false,
        start_hour: 23,
        end_hour: 8,
        timezone: DEFAULT_QUIET_HOURS_TIMEZONE,
        allow_critical: true
    }),
    work_hours: Object.freeze({
        enabled: false,
        start_hour: 9,
        end_hour: 18,
        timezone: DEFAULT_QUIET_HOURS_TIMEZONE
    }),
    mute_rules: Object.freeze({
        types: Object.freeze({
            customer_chat_message: Object.freeze({
                until: '',
                allow_critical: true
            }),
            shop_purchase_success: Object.freeze({
                until: '',
                allow_critical: true
            }),
            wallet_recharge_success: Object.freeze({
                until: '',
                allow_critical: true
            }),
            shop_inventory: Object.freeze({
                until: '',
                allow_critical: true
            })
        }),
        modules: Object.freeze({
            customer_engagement: Object.freeze({
                until: '',
                allow_critical: true
            }),
            commerce: Object.freeze({
                until: '',
                allow_critical: true
            }),
            inventory: Object.freeze({
                until: '',
                allow_critical: true
            }),
            payments: Object.freeze({
                until: '',
                allow_critical: true
            }),
            shop_risk: Object.freeze({
                until: '',
                allow_critical: true
            }),
            verify: Object.freeze({
                until: '',
                allow_critical: true
            }),
            tickets: Object.freeze({
                until: '',
                allow_critical: true
            }),
            fulfillment: Object.freeze({
                until: '',
                allow_critical: true
            }),
            security: Object.freeze({
                until: '',
                allow_critical: true
            })
        })
    }),
    channels: Object.freeze({
        telegram: Object.freeze({
            enabled: false,
            minimum_severity: 'warning',
            chat_ids: Object.freeze([])
        }),
        feishu: Object.freeze({
            enabled: false,
            minimum_severity: 'warning'
        }),
        email: Object.freeze({
            enabled: false,
            minimum_severity: 'warning',
            recipients: Object.freeze([]),
            from_address: '',
            reply_to: '',
            subject_prefix: '[Zaoyoe告警]'
        })
    }),
    shop_order_risk: Object.freeze({
        auto_response_enabled: true,
        auto_disable_coupon_min_risk_score: 90,
        auto_ban_user_min_risk_score: 96,
        auto_ban_user_duration_days: 7,
        auto_suspend_product_min_risk_score: 97
    }),
    routing: Object.freeze({
        customer_chat_message: Object.freeze({
            telegram: true,
            feishu: true,
            email: true
        }),
        shop_purchase_success: Object.freeze({
            telegram: true,
            feishu: true,
            email: true
        }),
        wallet_recharge_success: Object.freeze({
            telegram: true,
            feishu: true,
            email: true
        }),
        shop_inventory: Object.freeze({
            telegram: true,
            feishu: true,
            email: true
        })
    }),
    customer_chat_message: Object.freeze({
        enabled: true,
        sweep_interval_ms: 60 * 1000,
        lookback_minutes: 15,
        dedupe_window_minutes: 12 * 60,
        work_hours_only_enabled: false,
        summary_enabled: false,
        summary_window_minutes: 60,
        summary_max_items: 10,
        summary_schedule_mode: DEFAULT_SUMMARY_SCHEDULE_MODE,
        summary_hourly_minute: 0,
        summary_daily_hour: 9,
        summary_daily_minute: 0
    }),
    shop_purchase_success: Object.freeze({
        enabled: true,
        sweep_interval_ms: 2 * 60 * 1000,
        lookback_minutes: 30,
        dedupe_window_minutes: 24 * 60,
        work_hours_only_enabled: false,
        summary_enabled: false,
        summary_window_minutes: 60,
        summary_max_items: 10,
        summary_schedule_mode: DEFAULT_SUMMARY_SCHEDULE_MODE,
        summary_hourly_minute: 0,
        summary_daily_hour: 9,
        summary_daily_minute: 0
    }),
    wallet_recharge_success: Object.freeze({
        enabled: true,
        sweep_interval_ms: 2 * 60 * 1000,
        lookback_minutes: 30,
        dedupe_window_minutes: 24 * 60,
        work_hours_only_enabled: false,
        summary_enabled: false,
        summary_window_minutes: 60,
        summary_max_items: 10,
        summary_schedule_mode: DEFAULT_SUMMARY_SCHEDULE_MODE,
        summary_hourly_minute: 0,
        summary_daily_hour: 9,
        summary_daily_minute: 0
    }),
    shop_inventory: Object.freeze({
        enabled: true,
        low_stock_threshold: 5,
        sweep_interval_ms: 15 * 60 * 1000,
        sales_window_days: 7,
        dedupe_window_minutes: 6 * 60,
        recovery_notification_enabled: true,
        summary_enabled: false,
        summary_window_minutes: 60,
        summary_max_items: 10,
        summary_schedule_mode: DEFAULT_SUMMARY_SCHEDULE_MODE,
        summary_hourly_minute: 0,
        summary_daily_hour: 9,
        summary_daily_minute: 0
    })
});

function getOpsAlertSecretKeys() {
    const secretKeys = CONFIGURED_OPS_ALERT_SECRET_KEYS;
    if (secretKeys && typeof secretKeys === 'object' && !Array.isArray(secretKeys)) {
        return secretKeys;
    }

    return DEFAULT_OPS_ALERT_SECRET_KEYS;
}

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
}

function normalizeNumber(value, fallback, min = null, max = null) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    let next = numeric;
    if (Number.isFinite(min)) next = Math.max(min, next);
    if (Number.isFinite(max)) next = Math.min(max, next);
    return next;
}

function normalizeSeverity(value, fallback = 'warning') {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized && SEVERITY_RANK[normalized]) {
        return normalized;
    }
    return fallback;
}

function normalizeChannelName(value) {
    const normalized = normalizeText(value).toLowerCase();
    return SUPPORTED_CHANNELS.includes(normalized) ? normalized : '';
}

function normalizeStringArray(value) {
    if (Array.isArray(value)) {
        return Array.from(new Set(value.map((item) => normalizeText(item)).filter(Boolean)));
    }

    if (typeof value === 'string') {
        return Array.from(new Set(
            value
                .split(/[\n,]/)
                .map((item) => normalizeText(item))
                .filter(Boolean)
        ));
    }

    return [];
}

function normalizeTimeZone(value, fallback = DEFAULT_QUIET_HOURS_TIMEZONE) {
    const normalized = normalizeText(value);
    if (!normalized) {
        return fallback;
    }

    try {
        Intl.DateTimeFormat('en-US', {
            timeZone: normalized,
            hour: '2-digit'
        }).format(new Date());
        return normalized;
    } catch (_error) {
        return fallback;
    }
}

function normalizeSummaryScheduleMode(value, fallback = DEFAULT_SUMMARY_SCHEDULE_MODE) {
    const normalized = normalizeText(value).toLowerCase();
    return SUPPORTED_SUMMARY_SCHEDULE_MODES.includes(normalized)
        ? normalized
        : fallback;
}

function getOpsAlertSummaryDefinition(alertType = '') {
    return SUMMARY_ALERT_DEFINITIONS[normalizeText(alertType).toLowerCase()] || null;
}

function getTimeZoneDateParts(referenceDate, timeZone) {
    const safeDate = referenceDate instanceof Date ? referenceDate : new Date(referenceDate || Date.now());
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: normalizeTimeZone(timeZone),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(safeDate);
    const getPart = (type) => Number.parseInt(parts.find((part) => part.type === type)?.value || '', 10);

    return {
        year: getPart('year'),
        month: getPart('month'),
        day: getPart('day'),
        hour: getPart('hour') % 24,
        minute: getPart('minute'),
        second: getPart('second')
    };
}

function getCurrentMinuteInTimeZone(referenceDate, timeZone) {
    const parts = getTimeZoneDateParts(referenceDate, timeZone);
    if (!Number.isInteger(parts.hour) || !Number.isInteger(parts.minute)) {
        return null;
    }
    return (parts.hour * 60) + parts.minute;
}

function getTimeZoneOffsetMs(referenceDate, timeZone) {
    const safeDate = referenceDate instanceof Date ? referenceDate : new Date(referenceDate || Date.now());
    const referenceTimestamp = Number.isFinite(safeDate.getTime()) ? safeDate.getTime() : Date.now();
    const parts = getTimeZoneDateParts(safeDate, timeZone);
    const pseudoUtc = Date.UTC(
        parts.year,
        Math.max(0, parts.month - 1),
        parts.day,
        parts.hour,
        parts.minute,
        parts.second
    );
    return pseudoUtc - referenceTimestamp;
}

function getUtcDateFromTimeZoneParts(parts = {}, timeZone = DEFAULT_QUIET_HOURS_TIMEZONE) {
    const guess = new Date(Date.UTC(
        Number(parts.year) || 1970,
        Math.max(0, (Number(parts.month) || 1) - 1),
        Number(parts.day) || 1,
        Number(parts.hour) || 0,
        Number(parts.minute) || 0,
        Number(parts.second) || 0
    ));
    if (!Number.isFinite(guess.getTime())) {
        return new Date();
    }

    let offsetMs = getTimeZoneOffsetMs(guess, timeZone);
    let resolvedDate = new Date(guess.getTime() - offsetMs);
    const adjustedOffsetMs = getTimeZoneOffsetMs(resolvedDate, timeZone);
    if (adjustedOffsetMs !== offsetMs) {
        resolvedDate = new Date(guess.getTime() - adjustedOffsetMs);
    }

    return resolvedDate;
}

function shiftTimeZoneParts(parts = {}, { days = 0, hours = 0, minutes = 0 } = {}) {
    const pseudoDate = new Date(Date.UTC(
        Number(parts.year) || 1970,
        Math.max(0, (Number(parts.month) || 1) - 1),
        Number(parts.day) || 1,
        Number(parts.hour) || 0,
        Number(parts.minute) || 0,
        Number(parts.second) || 0
    ));
    pseudoDate.setUTCDate(pseudoDate.getUTCDate() + Number(days || 0));
    pseudoDate.setUTCHours(pseudoDate.getUTCHours() + Number(hours || 0));
    pseudoDate.setUTCMinutes(pseudoDate.getUTCMinutes() + Number(minutes || 0));

    return {
        year: pseudoDate.getUTCFullYear(),
        month: pseudoDate.getUTCMonth() + 1,
        day: pseudoDate.getUTCDate(),
        hour: pseudoDate.getUTCHours(),
        minute: pseudoDate.getUTCMinutes(),
        second: pseudoDate.getUTCSeconds()
    };
}

function isMinuteWithinWorkWindow(currentMinute, startMinute, endMinute) {
    if (!Number.isInteger(currentMinute)) {
        return false;
    }
    if (startMinute === endMinute) {
        return true;
    }
    if (startMinute < endMinute) {
        return currentMinute >= startMinute && currentMinute < endMinute;
    }
    return currentMinute >= startMinute || currentMinute < endMinute;
}

function getRollingOpsAlertSummaryBucket(referenceDate, windowMinutes) {
    const safeDate = referenceDate instanceof Date ? referenceDate : new Date(referenceDate || Date.now());
    const referenceTimestamp = Number.isFinite(safeDate.getTime()) ? safeDate.getTime() : Date.now();
    const intervalMs = Math.max(5, normalizeNumber(windowMinutes, 60, 5, 24 * 60)) * 60 * 1000;
    const bucketStart = Math.floor(referenceTimestamp / intervalMs) * intervalMs;
    return {
        schedule_mode: DEFAULT_SUMMARY_SCHEDULE_MODE,
        window_minutes: intervalMs / (60 * 1000),
        start_at: new Date(bucketStart).toISOString(),
        end_at: new Date(bucketStart + intervalMs).toISOString()
    };
}

function getHourlyOpsAlertSummaryBucket(referenceDate, summaryConfig = {}) {
    const timeZone = normalizeTimeZone(summaryConfig.summary_timezone, DEFAULT_QUIET_HOURS_TIMEZONE);
    const parts = getTimeZoneDateParts(referenceDate, timeZone);
    const targetMinute = Math.round(normalizeNumber(summaryConfig.summary_hourly_minute, 0, 0, 59));
    const currentBoundary = {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour,
        minute: targetMinute,
        second: 0
    };
    const startBoundary = parts.minute < targetMinute
        ? shiftTimeZoneParts(currentBoundary, { hours: -1 })
        : currentBoundary;
    const endBoundary = shiftTimeZoneParts(startBoundary, { hours: 1 });

    return {
        schedule_mode: 'hourly',
        window_minutes: 60,
        start_at: getUtcDateFromTimeZoneParts(startBoundary, timeZone).toISOString(),
        end_at: getUtcDateFromTimeZoneParts(endBoundary, timeZone).toISOString()
    };
}

function getDailyOpsAlertSummaryBucket(referenceDate, summaryConfig = {}) {
    const timeZone = normalizeTimeZone(summaryConfig.summary_timezone, DEFAULT_QUIET_HOURS_TIMEZONE);
    const parts = getTimeZoneDateParts(referenceDate, timeZone);
    const targetHour = Math.round(normalizeNumber(summaryConfig.summary_daily_hour, 9, 0, 23));
    const targetMinute = Math.round(normalizeNumber(summaryConfig.summary_daily_minute, 0, 0, 59));
    const currentMinuteOfDay = (parts.hour * 60) + parts.minute;
    const targetMinuteOfDay = (targetHour * 60) + targetMinute;
    const currentBoundary = {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: targetHour,
        minute: targetMinute,
        second: 0
    };
    const startBoundary = currentMinuteOfDay < targetMinuteOfDay
        ? shiftTimeZoneParts(currentBoundary, { days: -1 })
        : currentBoundary;
    const endBoundary = shiftTimeZoneParts(startBoundary, { days: 1 });

    return {
        schedule_mode: 'daily',
        window_minutes: 24 * 60,
        start_at: getUtcDateFromTimeZoneParts(startBoundary, timeZone).toISOString(),
        end_at: getUtcDateFromTimeZoneParts(endBoundary, timeZone).toISOString()
    };
}

function getWorkHoursSummaryBucket(referenceDate, workHoursConfig = {}) {
    const timeZone = normalizeTimeZone(workHoursConfig.timezone, DEFAULT_QUIET_HOURS_TIMEZONE);
    const startHour = Math.round(normalizeNumber(workHoursConfig.start_hour, 9, 0, 23));
    const endHour = Math.round(normalizeNumber(workHoursConfig.end_hour, 18, 0, 23));
    const startMinuteOfDay = startHour * 60;
    const endMinuteOfDay = endHour * 60;
    const currentParts = getTimeZoneDateParts(referenceDate, timeZone);
    const currentMinuteOfDay = getCurrentMinuteInTimeZone(referenceDate, timeZone);
    if (isMinuteWithinWorkWindow(currentMinuteOfDay, startMinuteOfDay, endMinuteOfDay)) {
        return null;
    }

    const buildBoundary = (hour, minute = 0, shift = {}) => {
        const boundaryParts = shiftTimeZoneParts({
            year: currentParts.year,
            month: currentParts.month,
            day: currentParts.day,
            hour,
            minute,
            second: 0
        }, shift);
        return getUtcDateFromTimeZoneParts(boundaryParts, timeZone);
    };

    let startDate;
    let endDate;
    if (startMinuteOfDay < endMinuteOfDay) {
        if (currentMinuteOfDay < startMinuteOfDay) {
            startDate = buildBoundary(endHour, 0, { days: -1 });
            endDate = buildBoundary(startHour, 0);
        } else {
            startDate = buildBoundary(endHour, 0);
            endDate = buildBoundary(startHour, 0, { days: 1 });
        }
    } else {
        startDate = buildBoundary(endHour, 0);
        endDate = buildBoundary(startHour, 0);
    }

    return {
        schedule_mode: WORK_HOURS_SUMMARY_SCHEDULE_MODE,
        window_minutes: Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 60000)),
        start_at: startDate.toISOString(),
        end_at: endDate.toISOString()
    };
}

function getOpsAlertSummaryBucket(referenceDate, summaryConfig = {}) {
    const scheduleMode = normalizeSummaryScheduleMode(summaryConfig.summary_schedule_mode, DEFAULT_SUMMARY_SCHEDULE_MODE);
    if (scheduleMode === 'hourly') {
        return getHourlyOpsAlertSummaryBucket(referenceDate, summaryConfig);
    }
    if (scheduleMode === 'daily') {
        return getDailyOpsAlertSummaryBucket(referenceDate, summaryConfig);
    }
    if (scheduleMode === WORK_HOURS_SUMMARY_SCHEDULE_MODE) {
        return getWorkHoursSummaryBucket(referenceDate, summaryConfig.work_hours);
    }
    return getRollingOpsAlertSummaryBucket(referenceDate, summaryConfig.summary_window_minutes);
}

function getHigherSeverity(left = 'warning', right = 'warning') {
    const normalizedLeft = normalizeSeverity(left, 'warning');
    const normalizedRight = normalizeSeverity(right, 'warning');
    return (SEVERITY_RANK[normalizedLeft] || 0) >= (SEVERITY_RANK[normalizedRight] || 0)
        ? normalizedLeft
        : normalizedRight;
}

function buildOpsAlertSummaryItem({ dedupeKey = '', payload = {}, title = '', content = '', createdAt = '' } = {}) {
    return {
        dedupe_key: normalizeText(dedupeKey),
        target_id: normalizeText(payload?.target_id || payload?.order_id || payload?.payment_order_id || payload?.message_id || payload?.id),
        alert_type: normalizeText(payload?.summary_source_alert_type || ''),
        title: normalizeText(title),
        content: normalizeText(content),
        created_at: normalizeText(createdAt) || new Date().toISOString(),
        payload: normalizeJsonObject(payload)
    };
}

function cloneDefaultConfig() {
    return {
        enabled: DEFAULT_OPS_ALERTS_CONFIG.enabled,
        dedupe_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.dedupe_window_minutes,
        batch_size: DEFAULT_OPS_ALERTS_CONFIG.batch_size,
        sweep_interval_ms: DEFAULT_OPS_ALERTS_CONFIG.sweep_interval_ms,
        max_attempts: DEFAULT_OPS_ALERTS_CONFIG.max_attempts,
        retry_base_delay_ms: DEFAULT_OPS_ALERTS_CONFIG.retry_base_delay_ms,
        retry_max_delay_ms: DEFAULT_OPS_ALERTS_CONFIG.retry_max_delay_ms,
        timeout_ms: DEFAULT_OPS_ALERTS_CONFIG.timeout_ms,
        temporary_mute: {
            until: DEFAULT_OPS_ALERTS_CONFIG.temporary_mute.until,
            allow_critical: DEFAULT_OPS_ALERTS_CONFIG.temporary_mute.allow_critical
        },
        quiet_hours: {
            enabled: DEFAULT_OPS_ALERTS_CONFIG.quiet_hours.enabled,
            start_hour: DEFAULT_OPS_ALERTS_CONFIG.quiet_hours.start_hour,
            end_hour: DEFAULT_OPS_ALERTS_CONFIG.quiet_hours.end_hour,
            timezone: DEFAULT_OPS_ALERTS_CONFIG.quiet_hours.timezone,
            allow_critical: DEFAULT_OPS_ALERTS_CONFIG.quiet_hours.allow_critical
        },
        work_hours: {
            enabled: DEFAULT_OPS_ALERTS_CONFIG.work_hours.enabled,
            start_hour: DEFAULT_OPS_ALERTS_CONFIG.work_hours.start_hour,
            end_hour: DEFAULT_OPS_ALERTS_CONFIG.work_hours.end_hour,
            timezone: DEFAULT_OPS_ALERTS_CONFIG.work_hours.timezone
        },
        mute_rules: {
            types: {
                customer_chat_message: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.customer_chat_message.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.customer_chat_message.allow_critical
                },
                shop_purchase_success: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.shop_purchase_success.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.shop_purchase_success.allow_critical
                },
                wallet_recharge_success: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.wallet_recharge_success.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.wallet_recharge_success.allow_critical
                },
                shop_inventory: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.shop_inventory.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.shop_inventory.allow_critical
                }
            },
            modules: {
                customer_engagement: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.customer_engagement.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.customer_engagement.allow_critical
                },
                commerce: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.commerce.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.commerce.allow_critical
                },
                inventory: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.inventory.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.inventory.allow_critical
                },
                payments: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.payments.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.payments.allow_critical
                },
                shop_risk: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.shop_risk.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.shop_risk.allow_critical
                },
                verify: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.verify.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.verify.allow_critical
                },
                tickets: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.tickets.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.tickets.allow_critical
                },
                fulfillment: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.fulfillment.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.fulfillment.allow_critical
                },
                security: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.security.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.modules.security.allow_critical
                }
            }
        },
        channels: {
            telegram: {
                enabled: DEFAULT_OPS_ALERTS_CONFIG.channels.telegram.enabled,
                minimum_severity: DEFAULT_OPS_ALERTS_CONFIG.channels.telegram.minimum_severity,
                chat_ids: [...DEFAULT_OPS_ALERTS_CONFIG.channels.telegram.chat_ids]
            },
            feishu: {
                enabled: DEFAULT_OPS_ALERTS_CONFIG.channels.feishu.enabled,
                minimum_severity: DEFAULT_OPS_ALERTS_CONFIG.channels.feishu.minimum_severity
            },
            email: {
                enabled: DEFAULT_OPS_ALERTS_CONFIG.channels.email.enabled,
                minimum_severity: DEFAULT_OPS_ALERTS_CONFIG.channels.email.minimum_severity,
                recipients: [...DEFAULT_OPS_ALERTS_CONFIG.channels.email.recipients],
                from_address: DEFAULT_OPS_ALERTS_CONFIG.channels.email.from_address,
                reply_to: DEFAULT_OPS_ALERTS_CONFIG.channels.email.reply_to,
                subject_prefix: DEFAULT_OPS_ALERTS_CONFIG.channels.email.subject_prefix
            }
        },
        shop_order_risk: {
            auto_response_enabled: DEFAULT_OPS_ALERTS_CONFIG.shop_order_risk.auto_response_enabled,
            auto_disable_coupon_min_risk_score: DEFAULT_OPS_ALERTS_CONFIG.shop_order_risk.auto_disable_coupon_min_risk_score,
            auto_ban_user_min_risk_score: DEFAULT_OPS_ALERTS_CONFIG.shop_order_risk.auto_ban_user_min_risk_score,
            auto_ban_user_duration_days: DEFAULT_OPS_ALERTS_CONFIG.shop_order_risk.auto_ban_user_duration_days,
            auto_suspend_product_min_risk_score: DEFAULT_OPS_ALERTS_CONFIG.shop_order_risk.auto_suspend_product_min_risk_score
        },
        routing: {
            customer_chat_message: {
                telegram: DEFAULT_OPS_ALERTS_CONFIG.routing.customer_chat_message.telegram,
                feishu: DEFAULT_OPS_ALERTS_CONFIG.routing.customer_chat_message.feishu,
                email: DEFAULT_OPS_ALERTS_CONFIG.routing.customer_chat_message.email
            },
            shop_purchase_success: {
                telegram: DEFAULT_OPS_ALERTS_CONFIG.routing.shop_purchase_success.telegram,
                feishu: DEFAULT_OPS_ALERTS_CONFIG.routing.shop_purchase_success.feishu,
                email: DEFAULT_OPS_ALERTS_CONFIG.routing.shop_purchase_success.email
            },
            wallet_recharge_success: {
                telegram: DEFAULT_OPS_ALERTS_CONFIG.routing.wallet_recharge_success.telegram,
                feishu: DEFAULT_OPS_ALERTS_CONFIG.routing.wallet_recharge_success.feishu,
                email: DEFAULT_OPS_ALERTS_CONFIG.routing.wallet_recharge_success.email
            },
            shop_inventory: {
                telegram: DEFAULT_OPS_ALERTS_CONFIG.routing.shop_inventory.telegram,
                feishu: DEFAULT_OPS_ALERTS_CONFIG.routing.shop_inventory.feishu,
                email: DEFAULT_OPS_ALERTS_CONFIG.routing.shop_inventory.email
            }
        },
        customer_chat_message: {
            enabled: DEFAULT_OPS_ALERTS_CONFIG.customer_chat_message.enabled,
            sweep_interval_ms: DEFAULT_OPS_ALERTS_CONFIG.customer_chat_message.sweep_interval_ms,
            lookback_minutes: DEFAULT_OPS_ALERTS_CONFIG.customer_chat_message.lookback_minutes,
            dedupe_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.customer_chat_message.dedupe_window_minutes,
            work_hours_only_enabled: DEFAULT_OPS_ALERTS_CONFIG.customer_chat_message.work_hours_only_enabled,
            summary_enabled: DEFAULT_OPS_ALERTS_CONFIG.customer_chat_message.summary_enabled,
            summary_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.customer_chat_message.summary_window_minutes,
            summary_max_items: DEFAULT_OPS_ALERTS_CONFIG.customer_chat_message.summary_max_items,
            summary_schedule_mode: DEFAULT_OPS_ALERTS_CONFIG.customer_chat_message.summary_schedule_mode,
            summary_hourly_minute: DEFAULT_OPS_ALERTS_CONFIG.customer_chat_message.summary_hourly_minute,
            summary_daily_hour: DEFAULT_OPS_ALERTS_CONFIG.customer_chat_message.summary_daily_hour,
            summary_daily_minute: DEFAULT_OPS_ALERTS_CONFIG.customer_chat_message.summary_daily_minute
        },
        shop_purchase_success: {
            enabled: DEFAULT_OPS_ALERTS_CONFIG.shop_purchase_success.enabled,
            sweep_interval_ms: DEFAULT_OPS_ALERTS_CONFIG.shop_purchase_success.sweep_interval_ms,
            lookback_minutes: DEFAULT_OPS_ALERTS_CONFIG.shop_purchase_success.lookback_minutes,
            dedupe_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.shop_purchase_success.dedupe_window_minutes,
            work_hours_only_enabled: DEFAULT_OPS_ALERTS_CONFIG.shop_purchase_success.work_hours_only_enabled,
            summary_enabled: DEFAULT_OPS_ALERTS_CONFIG.shop_purchase_success.summary_enabled,
            summary_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.shop_purchase_success.summary_window_minutes,
            summary_max_items: DEFAULT_OPS_ALERTS_CONFIG.shop_purchase_success.summary_max_items,
            summary_schedule_mode: DEFAULT_OPS_ALERTS_CONFIG.shop_purchase_success.summary_schedule_mode,
            summary_hourly_minute: DEFAULT_OPS_ALERTS_CONFIG.shop_purchase_success.summary_hourly_minute,
            summary_daily_hour: DEFAULT_OPS_ALERTS_CONFIG.shop_purchase_success.summary_daily_hour,
            summary_daily_minute: DEFAULT_OPS_ALERTS_CONFIG.shop_purchase_success.summary_daily_minute
        },
        wallet_recharge_success: {
            enabled: DEFAULT_OPS_ALERTS_CONFIG.wallet_recharge_success.enabled,
            sweep_interval_ms: DEFAULT_OPS_ALERTS_CONFIG.wallet_recharge_success.sweep_interval_ms,
            lookback_minutes: DEFAULT_OPS_ALERTS_CONFIG.wallet_recharge_success.lookback_minutes,
            dedupe_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.wallet_recharge_success.dedupe_window_minutes,
            work_hours_only_enabled: DEFAULT_OPS_ALERTS_CONFIG.wallet_recharge_success.work_hours_only_enabled,
            summary_enabled: DEFAULT_OPS_ALERTS_CONFIG.wallet_recharge_success.summary_enabled,
            summary_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.wallet_recharge_success.summary_window_minutes,
            summary_max_items: DEFAULT_OPS_ALERTS_CONFIG.wallet_recharge_success.summary_max_items,
            summary_schedule_mode: DEFAULT_OPS_ALERTS_CONFIG.wallet_recharge_success.summary_schedule_mode,
            summary_hourly_minute: DEFAULT_OPS_ALERTS_CONFIG.wallet_recharge_success.summary_hourly_minute,
            summary_daily_hour: DEFAULT_OPS_ALERTS_CONFIG.wallet_recharge_success.summary_daily_hour,
            summary_daily_minute: DEFAULT_OPS_ALERTS_CONFIG.wallet_recharge_success.summary_daily_minute
        },
        shop_inventory: {
            enabled: DEFAULT_OPS_ALERTS_CONFIG.shop_inventory.enabled,
            low_stock_threshold: DEFAULT_OPS_ALERTS_CONFIG.shop_inventory.low_stock_threshold,
            sweep_interval_ms: DEFAULT_OPS_ALERTS_CONFIG.shop_inventory.sweep_interval_ms,
            sales_window_days: DEFAULT_OPS_ALERTS_CONFIG.shop_inventory.sales_window_days,
            dedupe_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.shop_inventory.dedupe_window_minutes,
            recovery_notification_enabled: DEFAULT_OPS_ALERTS_CONFIG.shop_inventory.recovery_notification_enabled,
            summary_enabled: DEFAULT_OPS_ALERTS_CONFIG.shop_inventory.summary_enabled,
            summary_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.shop_inventory.summary_window_minutes,
            summary_max_items: DEFAULT_OPS_ALERTS_CONFIG.shop_inventory.summary_max_items,
            summary_schedule_mode: DEFAULT_OPS_ALERTS_CONFIG.shop_inventory.summary_schedule_mode,
            summary_hourly_minute: DEFAULT_OPS_ALERTS_CONFIG.shop_inventory.summary_hourly_minute,
            summary_daily_hour: DEFAULT_OPS_ALERTS_CONFIG.shop_inventory.summary_daily_hour,
            summary_daily_minute: DEFAULT_OPS_ALERTS_CONFIG.shop_inventory.summary_daily_minute
        }
    };
}

function normalizeOpsAlertsConfig(rawConfig = {}, env = process.env) {
    const config = cloneDefaultConfig();
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const channelConfig = source.channels && typeof source.channels === 'object' ? source.channels : {};
    const telegramConfig = channelConfig.telegram && typeof channelConfig.telegram === 'object'
        ? channelConfig.telegram
        : {};
    const feishuConfig = channelConfig.feishu && typeof channelConfig.feishu === 'object'
        ? channelConfig.feishu
        : {};
    const emailConfig = channelConfig.email && typeof channelConfig.email === 'object'
        ? channelConfig.email
        : {};
    const shopOrderRiskConfig = source.shop_order_risk && typeof source.shop_order_risk === 'object'
        ? source.shop_order_risk
        : {};
    const temporaryMuteConfig = source.temporary_mute && typeof source.temporary_mute === 'object'
        ? source.temporary_mute
        : {};
    const quietHoursConfig = source.quiet_hours && typeof source.quiet_hours === 'object'
        ? source.quiet_hours
        : {};
    const workHoursConfig = source.work_hours && typeof source.work_hours === 'object'
        ? source.work_hours
        : {};
    const muteRulesConfig = source.mute_rules && typeof source.mute_rules === 'object'
        ? source.mute_rules
        : {};
    const typeMuteRulesConfig = muteRulesConfig.types && typeof muteRulesConfig.types === 'object'
        ? muteRulesConfig.types
        : {};
    const moduleMuteRulesConfig = muteRulesConfig.modules && typeof muteRulesConfig.modules === 'object'
        ? muteRulesConfig.modules
        : {};
    const routingConfig = source.routing && typeof source.routing === 'object'
        ? source.routing
        : {};
    const customerChatMessageConfig = source.customer_chat_message && typeof source.customer_chat_message === 'object'
        ? source.customer_chat_message
        : {};
    const shopPurchaseSuccessConfig = source.shop_purchase_success && typeof source.shop_purchase_success === 'object'
        ? source.shop_purchase_success
        : {};
    const walletRechargeSuccessConfig = source.wallet_recharge_success && typeof source.wallet_recharge_success === 'object'
        ? source.wallet_recharge_success
        : {};
    const shopInventoryConfig = source.shop_inventory && typeof source.shop_inventory === 'object'
        ? source.shop_inventory
        : {};

    config.enabled = normalizeBoolean(source.enabled, normalizeBoolean(env?.OPS_ALERTS_ENABLED, config.enabled));
    config.dedupe_window_minutes = normalizeNumber(
        source.dedupe_window_minutes,
        normalizeNumber(env?.OPS_ALERTS_DEDUPE_WINDOW_MINUTES, config.dedupe_window_minutes, 1, 24 * 60),
        1,
        24 * 60
    );
    config.batch_size = normalizeNumber(
        source.batch_size,
        normalizeNumber(env?.OPS_ALERTS_BATCH_SIZE, config.batch_size, 1, 50),
        1,
        50
    );
    config.sweep_interval_ms = normalizeNumber(
        source.sweep_interval_ms,
        normalizeNumber(env?.OPS_ALERTS_SWEEP_INTERVAL_MS, config.sweep_interval_ms, 1000, 10 * 60 * 1000),
        1000,
        10 * 60 * 1000
    );
    config.max_attempts = normalizeNumber(
        source.max_attempts,
        normalizeNumber(env?.OPS_ALERTS_MAX_ATTEMPTS, config.max_attempts, 1, 20),
        1,
        20
    );
    config.retry_base_delay_ms = normalizeNumber(
        source.retry_base_delay_ms,
        normalizeNumber(env?.OPS_ALERTS_RETRY_BASE_DELAY_MS, config.retry_base_delay_ms, 1000, 60 * 60 * 1000),
        1000,
        60 * 60 * 1000
    );
    config.retry_max_delay_ms = normalizeNumber(
        source.retry_max_delay_ms,
        normalizeNumber(env?.OPS_ALERTS_RETRY_MAX_DELAY_MS, config.retry_max_delay_ms, config.retry_base_delay_ms, 24 * 60 * 60 * 1000),
        config.retry_base_delay_ms,
        24 * 60 * 60 * 1000
    );
    config.timeout_ms = normalizeNumber(
        source.timeout_ms,
        normalizeNumber(env?.OPS_ALERTS_TIMEOUT_MS, config.timeout_ms, 1000, 30000),
        1000,
        30000
    );
    config.temporary_mute.until = normalizeText(temporaryMuteConfig.until);
    config.temporary_mute.allow_critical = normalizeBoolean(
        temporaryMuteConfig.allow_critical,
        config.temporary_mute.allow_critical
    );
    config.quiet_hours.enabled = normalizeBoolean(quietHoursConfig.enabled, config.quiet_hours.enabled);
    config.quiet_hours.start_hour = normalizeNumber(
        quietHoursConfig.start_hour,
        config.quiet_hours.start_hour,
        0,
        23
    );
    config.quiet_hours.end_hour = normalizeNumber(
        quietHoursConfig.end_hour,
        config.quiet_hours.end_hour,
        0,
        23
    );
    config.quiet_hours.timezone = normalizeTimeZone(quietHoursConfig.timezone, config.quiet_hours.timezone);
    config.quiet_hours.allow_critical = normalizeBoolean(
        quietHoursConfig.allow_critical,
        config.quiet_hours.allow_critical
    );
    config.work_hours.enabled = normalizeBoolean(workHoursConfig.enabled, config.work_hours.enabled);
    config.work_hours.start_hour = normalizeNumber(
        workHoursConfig.start_hour,
        config.work_hours.start_hour,
        0,
        23
    );
    config.work_hours.end_hour = normalizeNumber(
        workHoursConfig.end_hour,
        config.work_hours.end_hour,
        0,
        23
    );
    config.work_hours.timezone = normalizeTimeZone(workHoursConfig.timezone, config.work_hours.timezone);
    for (const routingKey of SUPPORTED_ROUTING_KEYS) {
        const muteRuleSource = typeMuteRulesConfig[routingKey] && typeof typeMuteRulesConfig[routingKey] === 'object'
            ? typeMuteRulesConfig[routingKey]
            : {};
        config.mute_rules.types[routingKey].until = normalizeText(muteRuleSource.until);
        config.mute_rules.types[routingKey].allow_critical = normalizeBoolean(
            muteRuleSource.allow_critical,
            config.mute_rules.types[routingKey].allow_critical
        );
    }
    for (const moduleKey of SUPPORTED_MUTE_RULE_MODULE_KEYS) {
        const muteRuleSource = moduleMuteRulesConfig[moduleKey] && typeof moduleMuteRulesConfig[moduleKey] === 'object'
            ? moduleMuteRulesConfig[moduleKey]
            : {};
        config.mute_rules.modules[moduleKey].until = normalizeText(muteRuleSource.until);
        config.mute_rules.modules[moduleKey].allow_critical = normalizeBoolean(
            muteRuleSource.allow_critical,
            config.mute_rules.modules[moduleKey].allow_critical
        );
    }

    config.channels.telegram.enabled = normalizeBoolean(
        telegramConfig.enabled,
        normalizeBoolean(env?.OPS_ALERTS_TELEGRAM_ENABLED, config.channels.telegram.enabled)
    );
    config.channels.telegram.minimum_severity = normalizeSeverity(
        telegramConfig.minimum_severity,
        normalizeSeverity(env?.OPS_ALERTS_TELEGRAM_MINIMUM_SEVERITY, config.channels.telegram.minimum_severity)
    );
    config.channels.telegram.chat_ids = normalizeStringArray(
        telegramConfig.chat_ids && telegramConfig.chat_ids.length
            ? telegramConfig.chat_ids
            : env?.OPS_ALERTS_TELEGRAM_CHAT_IDS
    );

    config.channels.feishu.enabled = normalizeBoolean(
        feishuConfig.enabled,
        normalizeBoolean(env?.OPS_ALERTS_FEISHU_ENABLED, config.channels.feishu.enabled)
    );
    config.channels.feishu.minimum_severity = normalizeSeverity(
        feishuConfig.minimum_severity,
        normalizeSeverity(env?.OPS_ALERTS_FEISHU_MINIMUM_SEVERITY, config.channels.feishu.minimum_severity)
    );

    config.channels.email.enabled = normalizeBoolean(
        emailConfig.enabled,
        normalizeBoolean(env?.OPS_ALERTS_EMAIL_ENABLED, config.channels.email.enabled)
    );
    config.channels.email.minimum_severity = normalizeSeverity(
        emailConfig.minimum_severity,
        normalizeSeverity(env?.OPS_ALERTS_EMAIL_MINIMUM_SEVERITY, config.channels.email.minimum_severity)
    );
    config.channels.email.recipients = normalizeStringArray(
        emailConfig.recipients && emailConfig.recipients.length
            ? emailConfig.recipients
            : env?.OPS_ALERTS_EMAIL_RECIPIENTS
    );
    config.channels.email.from_address = normalizeText(
        emailConfig.from_address || env?.OPS_ALERTS_EMAIL_FROM_ADDRESS || config.channels.email.from_address
    );
    config.channels.email.reply_to = normalizeText(
        emailConfig.reply_to || env?.OPS_ALERTS_EMAIL_REPLY_TO || config.channels.email.reply_to
    );
    config.channels.email.subject_prefix = normalizeText(
        emailConfig.subject_prefix || env?.OPS_ALERTS_EMAIL_SUBJECT_PREFIX || config.channels.email.subject_prefix
    ) || DEFAULT_OPS_ALERTS_CONFIG.channels.email.subject_prefix;

    config.shop_order_risk.auto_response_enabled = normalizeBoolean(
        shopOrderRiskConfig.auto_response_enabled,
        normalizeBoolean(env?.SHOP_ORDER_RISK_AUTO_RESPONSE_ENABLED, config.shop_order_risk.auto_response_enabled)
    );
    config.shop_order_risk.auto_disable_coupon_min_risk_score = normalizeNumber(
        shopOrderRiskConfig.auto_disable_coupon_min_risk_score,
        normalizeNumber(
            env?.SHOP_ORDER_RISK_AUTO_DISABLE_COUPON_MIN_RISK_SCORE,
            config.shop_order_risk.auto_disable_coupon_min_risk_score,
            65,
            99
        ),
        65,
        99
    );
    config.shop_order_risk.auto_ban_user_min_risk_score = normalizeNumber(
        shopOrderRiskConfig.auto_ban_user_min_risk_score,
        normalizeNumber(
            env?.SHOP_ORDER_RISK_AUTO_BAN_USER_MIN_RISK_SCORE,
            config.shop_order_risk.auto_ban_user_min_risk_score,
            80,
            99
        ),
        80,
        99
    );
    config.shop_order_risk.auto_ban_user_duration_days = normalizeNumber(
        shopOrderRiskConfig.auto_ban_user_duration_days,
        normalizeNumber(
            env?.SHOP_ORDER_RISK_AUTO_BAN_USER_DURATION_DAYS,
            config.shop_order_risk.auto_ban_user_duration_days,
            1,
            30
        ),
        1,
        30
    );
    config.shop_order_risk.auto_suspend_product_min_risk_score = normalizeNumber(
        shopOrderRiskConfig.auto_suspend_product_min_risk_score,
        normalizeNumber(
            env?.SHOP_ORDER_RISK_AUTO_SUSPEND_PRODUCT_MIN_RISK_SCORE,
            config.shop_order_risk.auto_suspend_product_min_risk_score,
            85,
            99
        ),
        85,
        99
    );
    for (const routingKey of SUPPORTED_ROUTING_KEYS) {
        const routingSource = routingConfig[routingKey] && typeof routingConfig[routingKey] === 'object'
            ? routingConfig[routingKey]
            : {};
        const channels = normalizeStringArray(routingSource.channels)
            .map((item) => normalizeChannelName(item))
            .filter(Boolean);
        for (const channel of SUPPORTED_CHANNELS) {
            config.routing[routingKey][channel] = channels.length
                ? channels.includes(channel)
                : normalizeBoolean(routingSource[channel], DEFAULT_OPS_ALERTS_CONFIG.routing[routingKey][channel]);
        }
    }

    config.customer_chat_message.enabled = normalizeBoolean(
        customerChatMessageConfig.enabled,
        normalizeBoolean(env?.CHAT_MESSAGE_MONITOR_ENABLED, config.customer_chat_message.enabled)
    );
    config.customer_chat_message.sweep_interval_ms = normalizeNumber(
        customerChatMessageConfig.sweep_interval_ms,
        normalizeNumber(env?.CHAT_MESSAGE_MONITOR_SWEEP_INTERVAL_MS, config.customer_chat_message.sweep_interval_ms, 10000, 60 * 60 * 1000),
        10000,
        60 * 60 * 1000
    );
    config.customer_chat_message.lookback_minutes = normalizeNumber(
        customerChatMessageConfig.lookback_minutes,
        normalizeNumber(env?.CHAT_MESSAGE_MONITOR_LOOKBACK_MINUTES, config.customer_chat_message.lookback_minutes, 1, 24 * 60),
        1,
        24 * 60
    );
    config.customer_chat_message.dedupe_window_minutes = normalizeNumber(
        customerChatMessageConfig.dedupe_window_minutes,
        normalizeNumber(env?.CHAT_MESSAGE_MONITOR_DEDUPE_WINDOW_MINUTES, config.customer_chat_message.dedupe_window_minutes, 1, 7 * 24 * 60),
        1,
        7 * 24 * 60
    );
    config.customer_chat_message.work_hours_only_enabled = normalizeBoolean(
        customerChatMessageConfig.work_hours_only_enabled,
        config.customer_chat_message.work_hours_only_enabled
    );
    config.customer_chat_message.summary_enabled = normalizeBoolean(
        customerChatMessageConfig.summary_enabled,
        config.customer_chat_message.summary_enabled
    );
    config.customer_chat_message.summary_window_minutes = normalizeNumber(
        customerChatMessageConfig.summary_window_minutes,
        config.customer_chat_message.summary_window_minutes,
        5,
        24 * 60
    );
    config.customer_chat_message.summary_max_items = normalizeNumber(
        customerChatMessageConfig.summary_max_items,
        config.customer_chat_message.summary_max_items,
        1,
        50
    );
    config.customer_chat_message.summary_schedule_mode = normalizeSummaryScheduleMode(
        customerChatMessageConfig.summary_schedule_mode,
        config.customer_chat_message.summary_schedule_mode
    );
    config.customer_chat_message.summary_hourly_minute = normalizeNumber(
        customerChatMessageConfig.summary_hourly_minute,
        config.customer_chat_message.summary_hourly_minute,
        0,
        59
    );
    config.customer_chat_message.summary_daily_hour = normalizeNumber(
        customerChatMessageConfig.summary_daily_hour,
        config.customer_chat_message.summary_daily_hour,
        0,
        23
    );
    config.customer_chat_message.summary_daily_minute = normalizeNumber(
        customerChatMessageConfig.summary_daily_minute,
        config.customer_chat_message.summary_daily_minute,
        0,
        59
    );

    config.shop_purchase_success.enabled = normalizeBoolean(
        shopPurchaseSuccessConfig.enabled,
        normalizeBoolean(env?.COMMERCE_SUCCESS_MONITOR_ENABLED, config.shop_purchase_success.enabled)
    );
    config.shop_purchase_success.sweep_interval_ms = normalizeNumber(
        shopPurchaseSuccessConfig.sweep_interval_ms,
        normalizeNumber(env?.COMMERCE_SUCCESS_MONITOR_SWEEP_INTERVAL_MS, config.shop_purchase_success.sweep_interval_ms, 10000, 60 * 60 * 1000),
        10000,
        60 * 60 * 1000
    );
    config.shop_purchase_success.lookback_minutes = normalizeNumber(
        shopPurchaseSuccessConfig.lookback_minutes,
        normalizeNumber(env?.COMMERCE_SUCCESS_MONITOR_LOOKBACK_MINUTES, config.shop_purchase_success.lookback_minutes, 1, 24 * 60),
        1,
        24 * 60
    );
    config.shop_purchase_success.dedupe_window_minutes = normalizeNumber(
        shopPurchaseSuccessConfig.dedupe_window_minutes,
        normalizeNumber(env?.COMMERCE_SUCCESS_MONITOR_DEDUPE_WINDOW_MINUTES, config.shop_purchase_success.dedupe_window_minutes, 1, 30 * 24 * 60),
        1,
        30 * 24 * 60
    );
    config.shop_purchase_success.work_hours_only_enabled = normalizeBoolean(
        shopPurchaseSuccessConfig.work_hours_only_enabled,
        config.shop_purchase_success.work_hours_only_enabled
    );
    config.shop_purchase_success.summary_enabled = normalizeBoolean(
        shopPurchaseSuccessConfig.summary_enabled,
        config.shop_purchase_success.summary_enabled
    );
    config.shop_purchase_success.summary_window_minutes = normalizeNumber(
        shopPurchaseSuccessConfig.summary_window_minutes,
        config.shop_purchase_success.summary_window_minutes,
        5,
        24 * 60
    );
    config.shop_purchase_success.summary_max_items = normalizeNumber(
        shopPurchaseSuccessConfig.summary_max_items,
        config.shop_purchase_success.summary_max_items,
        1,
        50
    );
    config.shop_purchase_success.summary_schedule_mode = normalizeSummaryScheduleMode(
        shopPurchaseSuccessConfig.summary_schedule_mode,
        config.shop_purchase_success.summary_schedule_mode
    );
    config.shop_purchase_success.summary_hourly_minute = normalizeNumber(
        shopPurchaseSuccessConfig.summary_hourly_minute,
        config.shop_purchase_success.summary_hourly_minute,
        0,
        59
    );
    config.shop_purchase_success.summary_daily_hour = normalizeNumber(
        shopPurchaseSuccessConfig.summary_daily_hour,
        config.shop_purchase_success.summary_daily_hour,
        0,
        23
    );
    config.shop_purchase_success.summary_daily_minute = normalizeNumber(
        shopPurchaseSuccessConfig.summary_daily_minute,
        config.shop_purchase_success.summary_daily_minute,
        0,
        59
    );

    config.wallet_recharge_success.enabled = normalizeBoolean(
        walletRechargeSuccessConfig.enabled,
        normalizeBoolean(env?.COMMERCE_SUCCESS_MONITOR_ENABLED, config.wallet_recharge_success.enabled)
    );
    config.wallet_recharge_success.sweep_interval_ms = normalizeNumber(
        walletRechargeSuccessConfig.sweep_interval_ms,
        normalizeNumber(env?.COMMERCE_SUCCESS_MONITOR_SWEEP_INTERVAL_MS, config.wallet_recharge_success.sweep_interval_ms, 10000, 60 * 60 * 1000),
        10000,
        60 * 60 * 1000
    );
    config.wallet_recharge_success.lookback_minutes = normalizeNumber(
        walletRechargeSuccessConfig.lookback_minutes,
        normalizeNumber(env?.COMMERCE_SUCCESS_MONITOR_LOOKBACK_MINUTES, config.wallet_recharge_success.lookback_minutes, 1, 24 * 60),
        1,
        24 * 60
    );
    config.wallet_recharge_success.dedupe_window_minutes = normalizeNumber(
        walletRechargeSuccessConfig.dedupe_window_minutes,
        normalizeNumber(env?.COMMERCE_SUCCESS_MONITOR_DEDUPE_WINDOW_MINUTES, config.wallet_recharge_success.dedupe_window_minutes, 1, 30 * 24 * 60),
        1,
        30 * 24 * 60
    );
    config.wallet_recharge_success.work_hours_only_enabled = normalizeBoolean(
        walletRechargeSuccessConfig.work_hours_only_enabled,
        config.wallet_recharge_success.work_hours_only_enabled
    );
    config.wallet_recharge_success.summary_enabled = normalizeBoolean(
        walletRechargeSuccessConfig.summary_enabled,
        config.wallet_recharge_success.summary_enabled
    );
    config.wallet_recharge_success.summary_window_minutes = normalizeNumber(
        walletRechargeSuccessConfig.summary_window_minutes,
        config.wallet_recharge_success.summary_window_minutes,
        5,
        24 * 60
    );
    config.wallet_recharge_success.summary_max_items = normalizeNumber(
        walletRechargeSuccessConfig.summary_max_items,
        config.wallet_recharge_success.summary_max_items,
        1,
        50
    );
    config.wallet_recharge_success.summary_schedule_mode = normalizeSummaryScheduleMode(
        walletRechargeSuccessConfig.summary_schedule_mode,
        config.wallet_recharge_success.summary_schedule_mode
    );
    config.wallet_recharge_success.summary_hourly_minute = normalizeNumber(
        walletRechargeSuccessConfig.summary_hourly_minute,
        config.wallet_recharge_success.summary_hourly_minute,
        0,
        59
    );
    config.wallet_recharge_success.summary_daily_hour = normalizeNumber(
        walletRechargeSuccessConfig.summary_daily_hour,
        config.wallet_recharge_success.summary_daily_hour,
        0,
        23
    );
    config.wallet_recharge_success.summary_daily_minute = normalizeNumber(
        walletRechargeSuccessConfig.summary_daily_minute,
        config.wallet_recharge_success.summary_daily_minute,
        0,
        59
    );

    config.shop_inventory.enabled = normalizeBoolean(
        shopInventoryConfig.enabled,
        normalizeBoolean(env?.SHOP_INVENTORY_MONITOR_ENABLED, config.shop_inventory.enabled)
    );
    config.shop_inventory.low_stock_threshold = normalizeNumber(
        shopInventoryConfig.low_stock_threshold,
        normalizeNumber(
            env?.SHOP_INVENTORY_MONITOR_LOW_STOCK_THRESHOLD,
            config.shop_inventory.low_stock_threshold,
            0,
            10000
        ),
        0,
        10000
    );
    config.shop_inventory.sweep_interval_ms = normalizeNumber(
        shopInventoryConfig.sweep_interval_ms,
        normalizeNumber(
            env?.SHOP_INVENTORY_MONITOR_SWEEP_INTERVAL_MS,
            config.shop_inventory.sweep_interval_ms,
            10000,
            60 * 60 * 1000
        ),
        10000,
        60 * 60 * 1000
    );
    config.shop_inventory.sales_window_days = normalizeNumber(
        shopInventoryConfig.sales_window_days,
        normalizeNumber(
            env?.SHOP_INVENTORY_MONITOR_SALES_WINDOW_DAYS,
            config.shop_inventory.sales_window_days,
            1,
            30
        ),
        1,
        30
    );
    config.shop_inventory.dedupe_window_minutes = normalizeNumber(
        shopInventoryConfig.dedupe_window_minutes,
        normalizeNumber(
            env?.SHOP_INVENTORY_MONITOR_DEDUPE_WINDOW_MINUTES,
            config.shop_inventory.dedupe_window_minutes,
            1,
            24 * 60
        ),
        1,
        24 * 60
    );
    config.shop_inventory.recovery_notification_enabled = normalizeBoolean(
        shopInventoryConfig.recovery_notification_enabled,
        normalizeBoolean(
            env?.SHOP_INVENTORY_MONITOR_RECOVERY_NOTIFICATION_ENABLED,
            config.shop_inventory.recovery_notification_enabled
        )
    );
    config.shop_inventory.summary_enabled = normalizeBoolean(
        shopInventoryConfig.summary_enabled,
        config.shop_inventory.summary_enabled
    );
    config.shop_inventory.summary_window_minutes = normalizeNumber(
        shopInventoryConfig.summary_window_minutes,
        config.shop_inventory.summary_window_minutes,
        5,
        24 * 60
    );
    config.shop_inventory.summary_max_items = normalizeNumber(
        shopInventoryConfig.summary_max_items,
        config.shop_inventory.summary_max_items,
        1,
        50
    );
    config.shop_inventory.summary_schedule_mode = normalizeSummaryScheduleMode(
        shopInventoryConfig.summary_schedule_mode,
        config.shop_inventory.summary_schedule_mode
    );
    config.shop_inventory.summary_hourly_minute = normalizeNumber(
        shopInventoryConfig.summary_hourly_minute,
        config.shop_inventory.summary_hourly_minute,
        0,
        59
    );
    config.shop_inventory.summary_daily_hour = normalizeNumber(
        shopInventoryConfig.summary_daily_hour,
        config.shop_inventory.summary_daily_hour,
        0,
        23
    );
    config.shop_inventory.summary_daily_minute = normalizeNumber(
        shopInventoryConfig.summary_daily_minute,
        config.shop_inventory.summary_daily_minute,
        0,
        59
    );

    return config;
}

async function loadStoredSystemConfig(supabase, configKey) {
    if (!supabase?.from) return null;

    const { data, error } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', configKey);

    if (error) {
        throw error;
    }

    if (!Array.isArray(data) || !data.length) {
        return null;
    }

    return data[0]?.config_value || null;
}

async function loadSecretValue(supabase, secretKey, envName, env = process.env) {
    const envValue = normalizeText(env?.[envName]);
    let storedSecret = null;

    try {
        if (supabase?.from) {
            storedSecret = await getStoredAdminSecret(supabase, secretKey);
        }
    } catch (error) {
        if (!envValue) {
            throw error;
        }
    }

    return {
        value: normalizeText(storedSecret?.value) || envValue,
        source: storedSecret?.value ? 'stored' : (envValue ? 'environment' : 'missing'),
        updatedAt: storedSecret?.updated_at || null
    };
}

async function resolveOpsAlertSecrets(supabase, env = process.env) {
    const secretKeys = getOpsAlertSecretKeys();
    const telegram = await loadSecretValue(
        supabase,
        secretKeys.telegram_bot_token,
        'OPS_ALERTS_TELEGRAM_BOT_TOKEN',
        env
    );
    const feishu = await loadSecretValue(
        supabase,
        secretKeys.feishu_webhook_url,
        'OPS_ALERTS_FEISHU_WEBHOOK_URL',
        env
    );
    const email = await loadSecretValue(
        supabase,
        secretKeys.email_api_key,
        'OPS_ALERTS_EMAIL_API_KEY',
        env
    );

    return {
        telegram_bot_token: telegram.value,
        telegram_bot_token_source: telegram.source,
        telegram_bot_token_updated_at: telegram.updatedAt,
        feishu_webhook_url: feishu.value,
        feishu_webhook_url_source: feishu.source,
        feishu_webhook_url_updated_at: feishu.updatedAt,
        email_api_key: email.value,
        email_api_key_source: email.source,
        email_api_key_updated_at: email.updatedAt
    };
}

async function loadOpsAlertsRuntimeConfig(supabase, env = process.env) {
    const storedConfig = await loadStoredSystemConfig(supabase, OPS_ALERTS_CONFIG_KEY).catch(() => null);
    const config = normalizeOpsAlertsConfig(storedConfig || {}, env);
    const secrets = await resolveOpsAlertSecrets(supabase, env);

    return {
        config,
        secrets
    };
}

function buildOpsAlertSecretStatus(runtime = {}) {
    const secrets = runtime.secrets || {};
    return {
        telegram_bot_token: {
            configured: Boolean(normalizeText(secrets.telegram_bot_token)),
            source: normalizeText(secrets.telegram_bot_token_source) || 'missing',
            updatedAt: secrets.telegram_bot_token_updated_at || null
        },
        feishu_webhook_url: {
            configured: Boolean(normalizeText(secrets.feishu_webhook_url)),
            source: normalizeText(secrets.feishu_webhook_url_source) || 'missing',
            updatedAt: secrets.feishu_webhook_url_updated_at || null
        },
        email_api_key: {
            configured: Boolean(normalizeText(secrets.email_api_key)),
            source: normalizeText(secrets.email_api_key_source) || 'missing',
            updatedAt: secrets.email_api_key_updated_at || null
        }
    };
}

function isSeverityAllowed(minimumSeverity, alertSeverity) {
    return (SEVERITY_RANK[normalizeSeverity(alertSeverity, 'warning')] || 0)
        >= (SEVERITY_RANK[normalizeSeverity(minimumSeverity, 'warning')] || 0);
}

function mapAlertTypeToRoutingKey(alertType = '') {
    return ALERT_TYPE_ROUTING_MAP[normalizeText(alertType).toLowerCase()] || '';
}

function mapAlertTypeToModuleKey(alertType = '') {
    return ALERT_TYPE_MODULE_MAP[normalizeText(alertType).toLowerCase()] || '';
}

function isHourWithinQuietWindow(hour, startHour, endHour) {
    if (!Number.isInteger(hour) || !Number.isInteger(startHour) || !Number.isInteger(endHour)) {
        return false;
    }

    if (startHour === endHour) {
        return false;
    }

    if (startHour < endHour) {
        return hour >= startHour && hour < endHour;
    }

    return hour >= startHour || hour < endHour;
}

function getHourInTimeZone(now, timeZone) {
    const referenceDate = now instanceof Date
        ? now
        : new Date(now || Date.now());
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: normalizeTimeZone(timeZone),
        hour: '2-digit',
        hour12: false
    });
    const hourPart = formatter.formatToParts(referenceDate).find((part) => part.type === 'hour');
    const hour = Number.parseInt(hourPart?.value || '', 10);
    return Number.isInteger(hour) ? hour : null;
}

function isAlertSuppressedByQuietHours(config = {}, alertSeverity = 'warning', options = {}) {
    const quietHours = normalizeJsonObject(config.quiet_hours);
    if (!quietHours.enabled) {
        return false;
    }

    if (quietHours.allow_critical && normalizeSeverity(alertSeverity, 'warning') === 'critical') {
        return false;
    }

    const hour = getHourInTimeZone(options.now, quietHours.timezone || DEFAULT_QUIET_HOURS_TIMEZONE);
    if (!Number.isInteger(hour)) {
        return false;
    }

    return isHourWithinQuietWindow(
        hour,
        normalizeNumber(quietHours.start_hour, DEFAULT_OPS_ALERTS_CONFIG.quiet_hours.start_hour, 0, 23),
        normalizeNumber(quietHours.end_hour, DEFAULT_OPS_ALERTS_CONFIG.quiet_hours.end_hour, 0, 23)
    );
}

function isAlertSuppressedByTemporaryMute(config = {}, alertSeverity = 'warning', options = {}) {
    const temporaryMute = normalizeJsonObject(config.temporary_mute);
    const until = normalizeText(temporaryMute.until);
    if (!until) {
        return false;
    }

    if (temporaryMute.allow_critical && normalizeSeverity(alertSeverity, 'warning') === 'critical') {
        return false;
    }

    const parsedUntil = Date.parse(until);
    if (!Number.isFinite(parsedUntil)) {
        return false;
    }

    const now = options.now instanceof Date
        ? options.now
        : new Date(options.now || Date.now());
    return parsedUntil > now.getTime();
}

function isAlertSuppressedByMuteRule(rule = {}, alertSeverity = 'warning', options = {}) {
    const until = normalizeText(rule.until);
    if (!until) {
        return false;
    }

    if (rule.allow_critical && normalizeSeverity(alertSeverity, 'warning') === 'critical') {
        return false;
    }

    const parsedUntil = Date.parse(until);
    if (!Number.isFinite(parsedUntil)) {
        return false;
    }

    const now = options.now instanceof Date
        ? options.now
        : new Date(options.now || Date.now());
    return parsedUntil > now.getTime();
}

function isAlertSuppressedByScopedMute(config = {}, alertSeverity = 'warning', alertType = '', options = {}) {
    const normalizedOptions = normalizeJsonObject(options);
    const routingKey = normalizeText(normalizedOptions.routingKey) || mapAlertTypeToRoutingKey(alertType);
    const moduleKey = normalizeText(normalizedOptions.moduleKey) || mapAlertTypeToModuleKey(alertType);

    if (routingKey && isAlertSuppressedByMuteRule(config.mute_rules?.types?.[routingKey], alertSeverity, normalizedOptions)) {
        return true;
    }

    if (moduleKey && isAlertSuppressedByMuteRule(config.mute_rules?.modules?.[moduleKey], alertSeverity, normalizedOptions)) {
        return true;
    }

    return false;
}

function resolveEnabledChannels(runtime = {}, alertSeverity = 'warning', alertTypeOrOptions = '', maybeOptions = {}) {
    const config = runtime.config || cloneDefaultConfig();
    const secrets = runtime.secrets || {};
    const alertType = alertTypeOrOptions && typeof alertTypeOrOptions === 'object' && !Array.isArray(alertTypeOrOptions)
        ? ''
        : normalizeText(alertTypeOrOptions);
    const options = alertTypeOrOptions && typeof alertTypeOrOptions === 'object' && !Array.isArray(alertTypeOrOptions)
        ? alertTypeOrOptions
        : normalizeJsonObject(maybeOptions);
    const channels = [];

    if (!config.enabled) {
        return channels;
    }

    if (isAlertSuppressedByTemporaryMute(config, alertSeverity, options)) {
        return channels;
    }

    if (!options.ignoreQuietHours && isAlertSuppressedByQuietHours(config, alertSeverity, options)) {
        return channels;
    }

    if (isAlertSuppressedByScopedMute(config, alertSeverity, alertType, options)) {
        return channels;
    }

    const routingKey = mapAlertTypeToRoutingKey(alertType);
    const allowedChannels = routingKey
        ? SUPPORTED_CHANNELS.filter((channel) => normalizeBoolean(config.routing?.[routingKey]?.[channel], true))
        : [];
    const isChannelAllowed = (channel) => !routingKey || allowedChannels.includes(channel);

    if (
        config.channels.telegram.enabled
        && normalizeText(secrets.telegram_bot_token)
        && normalizeStringArray(config.channels.telegram.chat_ids).length
        && isSeverityAllowed(config.channels.telegram.minimum_severity, alertSeverity)
        && isChannelAllowed('telegram')
    ) {
        channels.push('telegram');
    }

    if (
        config.channels.feishu.enabled
        && normalizeText(secrets.feishu_webhook_url)
        && isSeverityAllowed(config.channels.feishu.minimum_severity, alertSeverity)
        && isChannelAllowed('feishu')
    ) {
        channels.push('feishu');
    }

    if (
        config.channels.email.enabled
        && normalizeText(secrets.email_api_key)
        && normalizeStringArray(config.channels.email.recipients).length
        && normalizeText(config.channels.email.from_address)
        && isSeverityAllowed(config.channels.email.minimum_severity, alertSeverity)
        && isChannelAllowed('email')
    ) {
        channels.push('email');
    }

    return channels;
}

function buildOpsAlertDedupeKey({ alertType = '', title = '', content = '', payload = {} } = {}) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify({
            alertType: normalizeText(alertType),
            title: normalizeText(title),
            content: normalizeText(content),
            targetId: normalizeText(payload?.target_id),
            providerOrderNo: normalizeText(payload?.provider_order_no),
            processingResult: normalizeText(payload?.processing_result)
        }))
        .digest('hex');
}

async function hasRecentOpsAlertJob(supabase, {
    dedupeKey,
    dedupeWindowMinutes = DEFAULT_OPS_ALERTS_CONFIG.dedupe_window_minutes,
    now = null
}) {
    if (!supabase?.from || !normalizeText(dedupeKey)) {
        return false;
    }

    const referenceNow = now instanceof Date
        ? now
        : new Date(now || Date.now());
    const referenceTimestamp = Number.isFinite(referenceNow.getTime())
        ? referenceNow.getTime()
        : Date.now();
    const sinceIso = new Date(referenceTimestamp - Math.max(1, dedupeWindowMinutes) * 60 * 1000).toISOString();
    const { data, error } = await supabase
        .from('ops_alert_jobs')
        .select('id, status, created_at')
        .eq('dedupe_key', dedupeKey)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false });

    if (error) {
        throw error;
    }

    return Array.isArray(data) && data.length > 0;
}

function getNormalizedOpsAlertWorkHoursConfig(runtimeConfig = {}) {
    const workHours = normalizeJsonObject(runtimeConfig.work_hours);
    return {
        enabled: normalizeBoolean(workHours.enabled, DEFAULT_OPS_ALERTS_CONFIG.work_hours.enabled),
        start_hour: Math.round(normalizeNumber(workHours.start_hour, DEFAULT_OPS_ALERTS_CONFIG.work_hours.start_hour, 0, 23)),
        end_hour: Math.round(normalizeNumber(workHours.end_hour, DEFAULT_OPS_ALERTS_CONFIG.work_hours.end_hour, 0, 23)),
        timezone: normalizeTimeZone(workHours.timezone, DEFAULT_OPS_ALERTS_CONFIG.work_hours.timezone)
    };
}

function isWithinOpsAlertWorkHours(runtimeConfig = {}, referenceDate = new Date()) {
    const workHours = getNormalizedOpsAlertWorkHoursConfig(runtimeConfig);
    if (!workHours.enabled) {
        return true;
    }

    const currentMinute = getCurrentMinuteInTimeZone(referenceDate, workHours.timezone);
    return isMinuteWithinWorkWindow(
        currentMinute,
        workHours.start_hour * 60,
        workHours.end_hour * 60
    );
}

function getOpsAlertSummaryBaseConfig(runtimeConfig = {}, alertType = '') {
    const definition = getOpsAlertSummaryDefinition(alertType);
    if (!definition) {
        return null;
    }

    const section = runtimeConfig?.[definition.config_key];
    if (!section) {
        return null;
    }

    const defaultSection = DEFAULT_OPS_ALERTS_CONFIG[definition.config_key] || {};
    return {
        ...definition,
        summary_enabled: section.summary_enabled === true,
        work_hours_only_enabled: normalizeBoolean(section.work_hours_only_enabled, defaultSection.work_hours_only_enabled === true),
        summary_window_minutes: Math.max(5, normalizeNumber(section.summary_window_minutes, 60, 5, 24 * 60)),
        summary_max_items: Math.max(1, normalizeNumber(section.summary_max_items, 10, 1, 50)),
        summary_schedule_mode: normalizeSummaryScheduleMode(
            section.summary_schedule_mode,
            defaultSection.summary_schedule_mode || DEFAULT_SUMMARY_SCHEDULE_MODE
        ),
        summary_hourly_minute: Math.round(normalizeNumber(
            section.summary_hourly_minute,
            defaultSection.summary_hourly_minute ?? 0,
            0,
            59
        )),
        summary_daily_hour: Math.round(normalizeNumber(
            section.summary_daily_hour,
            defaultSection.summary_daily_hour ?? 9,
            0,
            23
        )),
        summary_daily_minute: Math.round(normalizeNumber(
            section.summary_daily_minute,
            defaultSection.summary_daily_minute ?? 0,
            0,
            59
        )),
        summary_timezone: normalizeTimeZone(runtimeConfig?.quiet_hours?.timezone, DEFAULT_QUIET_HOURS_TIMEZONE),
        work_hours: getNormalizedOpsAlertWorkHoursConfig(runtimeConfig)
    };
}

function getOpsAlertSummaryConfig(runtimeConfig = {}, alertType = '') {
    const summaryConfig = getOpsAlertSummaryBaseConfig(runtimeConfig, alertType);
    return summaryConfig?.summary_enabled === true ? summaryConfig : null;
}

function buildOpsAlertSummaryTitle(summaryConfig, itemCount) {
    return `${summaryConfig.default_title}（${itemCount} ${summaryConfig.unit}）`;
}

function getOpsAlertSummaryScheduleLabel(summaryConfig = {}) {
    if (summaryConfig.summary_schedule_mode === WORK_HOURS_SUMMARY_SCHEDULE_MODE) {
        const workHours = summaryConfig.work_hours || getNormalizedOpsAlertWorkHoursConfig();
        return `工作时段 ${String(workHours.start_hour || 0).padStart(2, '0')}:00-${String(workHours.end_hour || 0).padStart(2, '0')}:00（${normalizeTimeZone(workHours.timezone, DEFAULT_QUIET_HOURS_TIMEZONE)}）`;
    }
    if (summaryConfig.summary_schedule_mode === 'hourly') {
        return `每小时 ${String(summaryConfig.summary_hourly_minute || 0).padStart(2, '0')} 分`;
    }
    if (summaryConfig.summary_schedule_mode === 'daily') {
        return `每天 ${String(summaryConfig.summary_daily_hour || 0).padStart(2, '0')}:${String(summaryConfig.summary_daily_minute || 0).padStart(2, '0')}（${normalizeTimeZone(summaryConfig.summary_timezone, DEFAULT_QUIET_HOURS_TIMEZONE)}）`;
    }
    return `最近 ${summaryConfig.summary_window_minutes} 分钟`;
}

function buildOpsAlertSummaryContent(summaryConfig, itemCount, bucket) {
    if (summaryConfig.summary_schedule_mode === WORK_HOURS_SUMMARY_SCHEDULE_MODE) {
        return `当前非工作时段累计 ${itemCount} ${summaryConfig.unit}，将在下一个${getOpsAlertSummaryScheduleLabel(summaryConfig)}开始后统一外发。窗口：${bucket.start_at} - ${bucket.end_at}`;
    }
    if (summaryConfig.summary_schedule_mode === DEFAULT_SUMMARY_SCHEDULE_MODE) {
        return `最近 ${summaryConfig.summary_window_minutes} 分钟内累计 ${itemCount} ${summaryConfig.unit}，将在窗口结束后统一外发。窗口：${bucket.start_at} - ${bucket.end_at}`;
    }
    return `当前固定时点汇总窗口内累计 ${itemCount} ${summaryConfig.unit}，将按 ${getOpsAlertSummaryScheduleLabel(summaryConfig)} 统一外发。窗口：${bucket.start_at} - ${bucket.end_at}`;
}

async function loadExistingOpsAlertSummaryJob(supabase, alertType, dedupeKey) {
    const { data, error } = await supabase
        .from('ops_alert_jobs')
        .select('*')
        .eq('alert_type', alertType)
        .eq('dedupe_key', dedupeKey)
        .single();

    if (error) {
        throw error;
    }

    return data || null;
}

async function queueOpsAlertSummaryJob(supabase, input = {}, options = {}) {
    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, options.env);
    const alertType = normalizeText(input.alertType || input.alert_type);
    const explicitCreatedAt = normalizeText(input.createdAt || input.created_at);
    const referenceDate = options.now instanceof Date
        ? options.now
        : new Date(options.now || explicitCreatedAt || Date.now());
    const baseSummaryConfig = getOpsAlertSummaryBaseConfig(runtime.config, alertType);
    if (!baseSummaryConfig) {
        return null;
    }

    const shouldUseWorkHoursSummary = baseSummaryConfig.work_hours_only_enabled === true
        && baseSummaryConfig.work_hours?.enabled === true
        && !isWithinOpsAlertWorkHours(runtime.config, referenceDate);
    const shouldUseConfiguredSummary = baseSummaryConfig.summary_enabled === true;

    if (!shouldUseWorkHoursSummary && !shouldUseConfiguredSummary) {
        return null;
    }

    const summaryConfig = shouldUseWorkHoursSummary
        ? {
            ...baseSummaryConfig,
            summary_schedule_mode: WORK_HOURS_SUMMARY_SCHEDULE_MODE,
            summary_timezone: baseSummaryConfig.work_hours?.timezone || baseSummaryConfig.summary_timezone
        }
        : baseSummaryConfig;
    const bucket = getOpsAlertSummaryBucket(referenceDate, summaryConfig);
    if (!bucket?.start_at || !bucket?.end_at) {
        return null;
    }
    const itemCreatedAt = explicitCreatedAt || (Number.isFinite(referenceDate.getTime()) ? referenceDate.toISOString() : new Date().toISOString());
    const itemDedupeKey = normalizeText(input.dedupeKey) || buildOpsAlertDedupeKey({
        alertType,
        title: input.title,
        content: input.content,
        payload: input.payload
    });
    const summaryDedupeKey = crypto
        .createHash('sha256')
        .update([
            summaryConfig.summary_alert_type,
            summaryConfig.summary_schedule_mode,
            summaryConfig.summary_window_minutes,
            summaryConfig.summary_hourly_minute,
            summaryConfig.summary_daily_hour,
            summaryConfig.summary_daily_minute,
            summaryConfig.summary_timezone,
            summaryConfig.work_hours?.start_hour,
            summaryConfig.work_hours?.end_hour,
            summaryConfig.work_hours?.timezone,
            bucket.start_at,
            bucket.end_at
        ].join(':'))
        .digest('hex');
    const channels = resolveEnabledChannels(runtime, input.severity, summaryConfig.summary_alert_type, {
        now: referenceDate,
        ignoreQuietHours: true
    })
        .filter((channel) => {
            const requestedChannels = Array.isArray(input.allowedChannels)
                ? input.allowedChannels.map((item) => normalizeChannelName(item)).filter(Boolean)
                : [];
            return !requestedChannels.length || requestedChannels.includes(channel);
        });

    if (!channels.length) {
        return {
            queued: false,
            reason: 'no_active_channels'
        };
    }

    const newItem = buildOpsAlertSummaryItem({
        alertType,
        dedupeKey: itemDedupeKey,
        payload: {
            ...normalizeJsonObject(input.payload),
            summary_source_alert_type: alertType
        },
        title: input.title,
        content: input.content,
        createdAt: itemCreatedAt
    });
    const existing = await loadExistingOpsAlertSummaryJob(supabase, summaryConfig.summary_alert_type, summaryDedupeKey);
    const nowIso = itemCreatedAt;

    if (existing) {
        const existingPayload = normalizeJsonObject(existing.payload);
        const existingItems = Array.isArray(existingPayload.items) ? existingPayload.items.slice() : [];
        if (existingItems.some((item) => normalizeText(item?.dedupe_key) === itemDedupeKey)) {
            return {
                queued: false,
                reason: 'deduped',
                dedupeKey: itemDedupeKey,
                summaryJob: existing
            };
        }

        existingItems.push(newItem);
        const nextSeverity = getHigherSeverity(existing.severity, input.severity);
        const nextChannels = Array.from(new Set([
            ...normalizeStringArray(existing.channels || []),
            ...channels
        ]));
        const nextPayload = {
            ...existingPayload,
            summary_type: summaryConfig.summary_alert_type,
            source_alert_type: alertType,
            summary_window_minutes: summaryConfig.summary_window_minutes,
            summary_max_items: summaryConfig.summary_max_items,
            summary_schedule_mode: summaryConfig.summary_schedule_mode,
            summary_hourly_minute: summaryConfig.summary_hourly_minute,
            summary_daily_hour: summaryConfig.summary_daily_hour,
            summary_daily_minute: summaryConfig.summary_daily_minute,
            summary_timezone: summaryConfig.summary_timezone,
            work_hours_start_hour: summaryConfig.work_hours?.start_hour,
            work_hours_end_hour: summaryConfig.work_hours?.end_hour,
            work_hours_timezone: summaryConfig.work_hours?.timezone,
            window_start_at: bucket.start_at,
            window_end_at: bucket.end_at,
            item_count: existingItems.length,
            items: existingItems,
            entry_path: normalizeText(existingPayload.entry_path || input.payload?.entry_path)
        };
        const updateRow = {
            severity: nextSeverity,
            title: buildOpsAlertSummaryTitle(summaryConfig, existingItems.length),
            content: buildOpsAlertSummaryContent(summaryConfig, existingItems.length, bucket),
            payload: nextPayload,
            channels: nextChannels,
            remaining_channels: nextChannels,
            next_retry_at: bucket.end_at,
            updated_at: nowIso
        };

        const { data, error } = await supabase
            .from('ops_alert_jobs')
            .update(updateRow)
            .eq('id', existing.id)
            .select('*')
            .single();

        if (error) {
            throw error;
        }

        return {
            queued: true,
            dedupeKey: itemDedupeKey,
            job: data || { ...existing, ...updateRow },
            channels: nextChannels,
            summary: true
        };
    }

    const row = {
        alert_type: summaryConfig.summary_alert_type,
        severity: normalizeSeverity(input.severity, 'warning'),
        dedupe_key: summaryDedupeKey,
        title: buildOpsAlertSummaryTitle(summaryConfig, 1),
        content: buildOpsAlertSummaryContent(summaryConfig, 1, bucket),
        payload: {
            summary_type: summaryConfig.summary_alert_type,
            source_alert_type: alertType,
            summary_window_minutes: summaryConfig.summary_window_minutes,
            summary_max_items: summaryConfig.summary_max_items,
            summary_schedule_mode: summaryConfig.summary_schedule_mode,
            summary_hourly_minute: summaryConfig.summary_hourly_minute,
            summary_daily_hour: summaryConfig.summary_daily_hour,
            summary_daily_minute: summaryConfig.summary_daily_minute,
            summary_timezone: summaryConfig.summary_timezone,
            work_hours_start_hour: summaryConfig.work_hours?.start_hour,
            work_hours_end_hour: summaryConfig.work_hours?.end_hour,
            work_hours_timezone: summaryConfig.work_hours?.timezone,
            window_start_at: bucket.start_at,
            window_end_at: bucket.end_at,
            item_count: 1,
            items: [newItem],
            entry_path: normalizeText(input.payload?.entry_path)
        },
        channels,
        remaining_channels: channels,
        status: 'pending',
        attempt_count: 0,
        max_attempts: normalizeNumber(
            input.maxAttempts,
            runtime.config?.max_attempts || DEFAULT_OPS_ALERTS_CONFIG.max_attempts,
            1,
            20
        ),
        next_retry_at: bucket.end_at,
        source: normalizeText(input.source) || 'admin_refund_ops',
        created_by: normalizeText(input.createdBy) || null,
        updated_at: nowIso,
        created_at: nowIso
    };

    const { data, error } = await supabase
        .from('ops_alert_jobs')
        .insert(row)
        .select('*')
        .single();

    if (error) {
        throw error;
    }

    return {
        queued: true,
        dedupeKey: itemDedupeKey,
        job: data || row,
        channels,
        summary: true
    };
}

async function enqueueOpsAlertJob(supabase, input = {}, options = {}) {
    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, options.env);
    const alertType = normalizeText(input.alertType || input.alert_type);
    const title = normalizeText(input.title);
    const content = normalizeText(input.content);
    const severity = normalizeSeverity(input.severity, 'warning');
    const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
    const requestedChannels = Array.isArray(input.allowedChannels)
        ? input.allowedChannels.map((item) => normalizeChannelName(item)).filter(Boolean)
        : [];

    if (!supabase?.from) {
        return { queued: false, reason: 'supabase_unavailable' };
    }

    if (!alertType || !title || !content) {
        return { queued: false, reason: 'missing_fields' };
    }

    const summaryResult = await queueOpsAlertSummaryJob(supabase, input, {
        ...options,
        runtime
    });
    if (summaryResult) {
        return summaryResult;
    }

    const explicitCreatedAt = normalizeText(input.createdAt || input.created_at);
    const dedupeReferenceDate = options.now instanceof Date
        ? options.now
        : new Date(options.now || explicitCreatedAt || Date.now());
    const channels = resolveEnabledChannels(runtime, severity, alertType, { now: dedupeReferenceDate })
        .filter((channel) => !requestedChannels.length || requestedChannels.includes(channel));
    if (!channels.length) {
        return { queued: false, reason: 'no_active_channels' };
    }

    const dedupeWindowMinutes = normalizeNumber(
        input.dedupeWindowMinutes,
        runtime.config?.dedupe_window_minutes || DEFAULT_OPS_ALERTS_CONFIG.dedupe_window_minutes,
        1,
        24 * 60
    );
    const dedupeKey = normalizeText(input.dedupeKey) || buildOpsAlertDedupeKey({
        alertType,
        title,
        content,
        payload
    });
    const exists = await hasRecentOpsAlertJob(supabase, {
        dedupeKey,
        dedupeWindowMinutes,
        now: dedupeReferenceDate
    });

    if (exists) {
        return {
            queued: false,
            reason: 'deduped',
            dedupeKey
        };
    }

    const nowIso = explicitCreatedAt || new Date().toISOString();
    const row = {
        alert_type: alertType,
        severity,
        dedupe_key: dedupeKey,
        title,
        content,
        payload,
        channels,
        remaining_channels: channels,
        status: 'pending',
        attempt_count: 0,
        max_attempts: normalizeNumber(
            input.maxAttempts,
            runtime.config?.max_attempts || DEFAULT_OPS_ALERTS_CONFIG.max_attempts,
            1,
            20
        ),
        next_retry_at: nowIso,
        source: normalizeText(input.source) || 'admin_refund_ops',
        created_by: normalizeText(input.createdBy) || null,
        updated_at: nowIso
    };
    if (explicitCreatedAt) {
        row.created_at = explicitCreatedAt;
    }

    const { data, error } = await supabase
        .from('ops_alert_jobs')
        .insert(row)
        .select('*')
        .single();

    if (error) {
        throw error;
    }

    return {
        queued: true,
        dedupeKey,
        job: data || row,
        channels
    };
}

function getRetryDelayMs(attemptCount, config = {}) {
    const baseDelay = normalizeNumber(
        config.retry_base_delay_ms,
        DEFAULT_OPS_ALERTS_CONFIG.retry_base_delay_ms,
        1000,
        60 * 60 * 1000
    );
    const maxDelay = normalizeNumber(
        config.retry_max_delay_ms,
        DEFAULT_OPS_ALERTS_CONFIG.retry_max_delay_ms,
        baseDelay,
        24 * 60 * 60 * 1000
    );

    const exponent = Math.max(0, Number(attemptCount || 1) - 1);
    return Math.min(maxDelay, baseDelay * (2 ** exponent));
}

function getNextRetryAt(attemptCount, config = {}) {
    return new Date(Date.now() + getRetryDelayMs(attemptCount, config)).toISOString();
}

function buildExternalAlertText(job = {}) {
    const refundOpsText = buildRefundOpsAlertText(job);
    if (refundOpsText) {
        return refundOpsText;
    }
    const customerChatSummaryText = buildCustomerChatMessageSummaryAlertText(job);
    if (customerChatSummaryText) {
        return customerChatSummaryText;
    }
    const customerChatText = buildCustomerChatMessageReceivedAlertText(job);
    if (customerChatText) {
        return customerChatText;
    }
    const shopPurchaseSummaryText = buildShopPurchaseSummaryAlertText(job);
    if (shopPurchaseSummaryText) {
        return shopPurchaseSummaryText;
    }
    const shopPurchaseText = buildShopPurchaseSucceededAlertText(job);
    if (shopPurchaseText) {
        return shopPurchaseText;
    }
    const walletRechargeSummaryText = buildWalletRechargeSummaryAlertText(job);
    if (walletRechargeSummaryText) {
        return walletRechargeSummaryText;
    }
    const shopInventorySummaryText = buildShopInventorySummaryAlertText(job);
    if (shopInventorySummaryText) {
        return shopInventorySummaryText;
    }
    const walletRechargeText = buildWalletRechargeSucceededAlertText(job);
    if (walletRechargeText) {
        return walletRechargeText;
    }
    const paymentConfigIncidentRecoveredText = buildPaymentConfigIncidentRecoveredAlertText(job);
    if (paymentConfigIncidentRecoveredText) {
        return paymentConfigIncidentRecoveredText;
    }
    const paymentConfigIncidentText = buildPaymentConfigIncidentAlertText(job);
    if (paymentConfigIncidentText) {
        return paymentConfigIncidentText;
    }
    const paymentConfigRecoveredText = buildPaymentConfigRecoveredAlertText(job);
    if (paymentConfigRecoveredText) {
        return paymentConfigRecoveredText;
    }
    const paymentConfigChangedText = buildPaymentConfigChangedAlertText(job);
    if (paymentConfigChangedText) {
        return paymentConfigChangedText;
    }
    const gatewayAlertText = buildPaymentGatewayDegradedAlertText(job);
    if (gatewayAlertText) {
        return gatewayAlertText;
    }
    const gatewayRecoveredText = buildPaymentGatewayRecoveredAlertText(job);
    if (gatewayRecoveredText) {
        return gatewayRecoveredText;
    }
    const verifyServiceText = buildVerifyServiceDisabledAlertText(job);
    if (verifyServiceText) {
        return verifyServiceText;
    }
    const verifyFailureText = buildVerifyFailureRateSpikeAlertText(job);
    if (verifyFailureText) {
        return verifyFailureText;
    }
    const verifyIncidentText = buildVerifyIncidentEscalatedAlertText(job);
    if (verifyIncidentText) {
        return verifyIncidentText;
    }
    const verifyIncidentRecoveredText = buildVerifyIncidentRecoveredAlertText(job);
    if (verifyIncidentRecoveredText) {
        return verifyIncidentRecoveredText;
    }
    const verifyQueueText = buildVerifyQueueBacklogAlertText(job);
    if (verifyQueueText) {
        return verifyQueueText;
    }
    const verifyQuotaText = buildVerifyQuotaLowAlertText(job);
    if (verifyQuotaText) {
        return verifyQuotaText;
    }
    const ticketSlaText = buildTicketSlaOverdueAlertText(job);
    if (ticketSlaText) {
        return ticketSlaText;
    }
    const ticketSlaRecoveredText = buildTicketSlaRecoveredAlertText(job);
    if (ticketSlaRecoveredText) {
        return ticketSlaRecoveredText;
    }
    const shopInventoryText = buildShopInventoryAlertText(job);
    if (shopInventoryText) {
        return shopInventoryText;
    }
    const shopInventoryRecoveredText = buildShopInventoryRecoveredAlertText(job);
    if (shopInventoryRecoveredText) {
        return shopInventoryRecoveredText;
    }
    const shopOrderDeliveryText = buildShopOrderDeliveryFailedAlertText(job);
    if (shopOrderDeliveryText) {
        return shopOrderDeliveryText;
    }
    const shopOrderDeliveryIncidentText = buildShopOrderDeliveryIncidentAlertText(job);
    if (shopOrderDeliveryIncidentText) {
        return shopOrderDeliveryIncidentText;
    }
    const shopOrderDeliveryIncidentRecoveredText = buildShopOrderDeliveryIncidentRecoveredAlertText(job);
    if (shopOrderDeliveryIncidentRecoveredText) {
        return shopOrderDeliveryIncidentRecoveredText;
    }
    const shopOrderDeliveryRecoveredText = buildShopOrderDeliveryRecoveredAlertText(job);
    if (shopOrderDeliveryRecoveredText) {
        return shopOrderDeliveryRecoveredText;
    }
    const shopOrderRiskText = buildShopOrderRiskAlertText(job);
    if (shopOrderRiskText) {
        return shopOrderRiskText;
    }
    const shopOrderRiskRecoveredText = buildShopOrderRiskRecoveredAlertText(job);
    if (shopOrderRiskRecoveredText) {
        return shopOrderRiskRecoveredText;
    }
    const adminLoginAnomalyText = buildAdminLoginAnomalyAlertText(job);
    if (adminLoginAnomalyText) {
        return adminLoginAnomalyText;
    }

    const lines = [
        `[站外告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '系统通知'}`,
        normalizeText(job.content)
    ].filter(Boolean);
    return lines.join('\n\n');
}

function getProviderLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return '';
    const providerMap = {
        hupijiao: '虎皮椒',
        afdian: '爱发电',
        mock: '模拟支付'
    };
    return providerMap[normalized] || normalized;
}

function getRefundProcessingLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return '';
    const labelMap = {
        admin_refund_failed: '退款失败（积分已补回）',
        admin_refund_reclaim_failed: '退款前积分扣回失败',
        admin_refund_compensation_failed: '退款失败后积分回滚失败'
    };
    return labelMap[normalized] || normalized;
}

function getOrderStatusLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return '';
    const statusMap = {
        pending_review: '待复核',
        amount_mismatch: '金额异常',
        paid: '已支付',
        redeemed: '已入账',
        refunded: '已退款',
        refund_pending: '退款处理中'
    };
    return statusMap[normalized] || normalized;
}

function formatCurrencyAmount(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? `${numericValue.toFixed(2)} 元` : '';
}

function formatPercent(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? `${numericValue.toFixed(2)}%` : '';
}

function formatPointsAmount(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '';
    return `${Math.max(0, Math.round(numericValue))} 点`;
}

function formatBooleanLabel(value) {
    if (value === true) return '是';
    if (value === false) return '否';
    return '';
}

function formatTimestamp(value) {
    const normalized = normalizeText(value);
    if (!normalized) return '';
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : normalized;
}

function getChatMessageTypeLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'image') {
        return '图片消息';
    }
    return '文本消息';
}

function buildSummaryHeader(job = {}, fallbackTitle = '站外告警汇总') {
    return `[站外告警汇总][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || fallbackTitle}`;
}

function getSummaryItems(payload = {}) {
    return Array.isArray(payload?.items) ? payload.items : [];
}

function buildCustomerChatMessageSummaryAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'customer_chat_message_summary') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const items = getSummaryItems(payload).slice(0, Math.max(1, normalizeNumber(payload.summary_max_items, 10, 1, 50)));
    const lines = [buildSummaryHeader(job, '客服消息汇总')];

    if (normalizeText(payload.window_start_at) || normalizeText(payload.window_end_at)) {
        lines.push(`时间窗口：${formatTimestamp(payload.window_start_at)} - ${formatTimestamp(payload.window_end_at)}`);
    }
    if (Number.isFinite(Number(payload.item_count))) {
        lines.push(`累计消息：${Math.max(0, Math.round(Number(payload.item_count || 0)))} 条`);
    }
    items.forEach((item, index) => {
        const itemPayload = normalizeJsonObject(item?.payload);
        const sender = normalizeText(itemPayload.sender_label) || '访客';
        const sentAt = formatTimestamp(itemPayload.created_at || item?.created_at);
        const preview = normalizeText(itemPayload.content_preview || item?.content) || '[空消息]';
        lines.push(`${index + 1}. ${sender}${sentAt ? ` · ${sentAt}` : ''}`);
        if (normalizeText(itemPayload.user_id)) lines.push(`   用户ID：${normalizeText(itemPayload.user_id)}`);
        if (preview) lines.push(`   内容：${preview}`);
    });
    if (Number.isFinite(Number(payload.item_count)) && Number(payload.item_count) > items.length) {
        lines.push(`其余 ${Number(payload.item_count) - items.length} 条请前往后台查看。`);
    }
    if (normalizeText(payload.entry_path)) {
        lines.push(`处理入口：${normalizeText(payload.entry_path)}`);
    }

    return lines.filter(Boolean).join('\n');
}

function buildShopPurchaseSummaryAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'shop_purchase_summary') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const items = getSummaryItems(payload).slice(0, Math.max(1, normalizeNumber(payload.summary_max_items, 10, 1, 50)));
    const lines = [buildSummaryHeader(job, '购买成功汇总')];

    if (normalizeText(payload.window_start_at) || normalizeText(payload.window_end_at)) {
        lines.push(`时间窗口：${formatTimestamp(payload.window_start_at)} - ${formatTimestamp(payload.window_end_at)}`);
    }
    if (Number.isFinite(Number(payload.item_count))) {
        lines.push(`累计订单：${Math.max(0, Math.round(Number(payload.item_count || 0)))} 笔`);
    }
    items.forEach((item, index) => {
        const itemPayload = normalizeJsonObject(item?.payload);
        const buyer = normalizeText(itemPayload.buyer_label) || '未知用户';
        const productName = normalizeText(itemPayload.product_name) || '商城商品';
        const amount = formatCurrencyAmount(itemPayload.total_price ?? itemPayload.price_paid);
        const createdAt = formatTimestamp(itemPayload.created_at || item?.created_at);
        lines.push(`${index + 1}. ${buyer} · ${productName}`);
        if (normalizeText(itemPayload.order_id)) lines.push(`   订单号：${normalizeText(itemPayload.order_id)}`);
        if (amount) lines.push(`   金额：${amount}`);
        if (createdAt) lines.push(`   时间：${createdAt}`);
    });
    if (Number.isFinite(Number(payload.item_count)) && Number(payload.item_count) > items.length) {
        lines.push(`其余 ${Number(payload.item_count) - items.length} 笔请前往后台查看。`);
    }
    if (normalizeText(payload.entry_path)) {
        lines.push(`处理入口：${normalizeText(payload.entry_path)}`);
    }

    return lines.filter(Boolean).join('\n');
}

function buildWalletRechargeSummaryAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'wallet_recharge_summary') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const items = getSummaryItems(payload).slice(0, Math.max(1, normalizeNumber(payload.summary_max_items, 10, 1, 50)));
    const lines = [buildSummaryHeader(job, '充值成功汇总')];

    if (normalizeText(payload.window_start_at) || normalizeText(payload.window_end_at)) {
        lines.push(`时间窗口：${formatTimestamp(payload.window_start_at)} - ${formatTimestamp(payload.window_end_at)}`);
    }
    if (Number.isFinite(Number(payload.item_count))) {
        lines.push(`累计充值：${Math.max(0, Math.round(Number(payload.item_count || 0)))} 笔`);
    }
    items.forEach((item, index) => {
        const itemPayload = normalizeJsonObject(item?.payload);
        const buyer = normalizeText(itemPayload.buyer_label) || '未知用户';
        const packageName = normalizeText(itemPayload.package_name) || '钱包充值';
        const amount = formatCurrencyAmount(itemPayload.paid_amount ?? itemPayload.expected_amount);
        const claimedAt = formatTimestamp(itemPayload.claimed_at || itemPayload.created_at || item?.created_at);
        lines.push(`${index + 1}. ${buyer} · ${packageName}`);
        if (normalizeText(itemPayload.payment_order_id)) lines.push(`   充值单号：${normalizeText(itemPayload.payment_order_id)}`);
        if (amount) lines.push(`   金额：${amount}`);
        if (claimedAt) lines.push(`   时间：${claimedAt}`);
    });
    if (Number.isFinite(Number(payload.item_count)) && Number(payload.item_count) > items.length) {
        lines.push(`其余 ${Number(payload.item_count) - items.length} 笔请前往后台查看。`);
    }
    if (normalizeText(payload.entry_path)) {
        lines.push(`处理入口：${normalizeText(payload.entry_path)}`);
    }

    return lines.filter(Boolean).join('\n');
}

function getShopInventorySummaryStatusLabel(item = {}, itemPayload = {}) {
    const alertType = normalizeText(item?.alert_type || itemPayload.summary_source_alert_type || itemPayload.alert_type).toLowerCase();
    if (alertType === 'shop_inventory_empty') {
        return '已售罄';
    }
    if (alertType === 'shop_inventory_low') {
        return '低库存';
    }

    return Number(itemPayload.stock_count) <= 0 ? '已售罄' : '低库存';
}

function buildShopInventorySummaryAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'shop_inventory_summary') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const items = getSummaryItems(payload).slice(0, Math.max(1, normalizeNumber(payload.summary_max_items, 10, 1, 50)));
    const lines = [buildSummaryHeader(job, '库存与补货汇总')];

    if (normalizeText(payload.window_start_at) || normalizeText(payload.window_end_at)) {
        lines.push(`时间窗口：${formatTimestamp(payload.window_start_at)} - ${formatTimestamp(payload.window_end_at)}`);
    }
    if (Number.isFinite(Number(payload.item_count))) {
        lines.push(`累计库存告警：${Math.max(0, Math.round(Number(payload.item_count || 0)))} 条`);
    }
    items.forEach((item, index) => {
        const itemPayload = normalizeJsonObject(item?.payload);
        const productName = normalizeText(itemPayload.product_name) || normalizeText(item?.title) || '未命名商品';
        const statusLabel = getShopInventorySummaryStatusLabel(item, itemPayload);
        lines.push(`${index + 1}. ${productName}${statusLabel ? ` · ${statusLabel}` : ''}`);
        if (normalizeText(itemPayload.category)) lines.push(`   分类：${normalizeText(itemPayload.category)}`);
        if (Number.isFinite(Number(itemPayload.stock_count))) {
            const stockCount = Math.max(0, Math.round(Number(itemPayload.stock_count || 0)));
            const threshold = Math.max(0, Math.round(Number(itemPayload.low_stock_threshold || 0)));
            lines.push(
                stockCount <= 0
                    ? '   当前库存：0 件（已售罄）'
                    : `   当前库存：${stockCount} 件（阈值 ${threshold} 件）`
            );
        }
        if (Number.isFinite(Number(itemPayload.recent_sales_count))) {
            const salesWindow = Math.max(1, Math.round(Number(itemPayload.recent_sales_days || 7)));
            lines.push(`   近 ${salesWindow} 天销量：${Math.max(0, Math.round(Number(itemPayload.recent_sales_count || 0)))} 件`);
        }
        const updatedAt = formatTimestamp(itemPayload.updated_at || item?.created_at);
        if (updatedAt) lines.push(`   时间：${updatedAt}`);
    });
    if (Number.isFinite(Number(payload.item_count)) && Number(payload.item_count) > items.length) {
        lines.push(`其余 ${Number(payload.item_count) - items.length} 条请前往后台查看。`);
    }
    if (normalizeText(payload.entry_path)) {
        lines.push(`处理入口：${normalizeText(payload.entry_path)}`);
    }

    return lines.filter(Boolean).join('\n');
}

function buildCustomerChatMessageReceivedAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'customer_chat_message_received') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const lines = [
        `[客服消息提醒][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '客服机器人收到新消息'}`
    ];

    if (normalizeText(payload.sender_label)) lines.push(`发送者：${normalizeText(payload.sender_label)}`);
    if (normalizeText(payload.user_id)) lines.push(`用户ID：${normalizeText(payload.user_id)}`);
    if (normalizeText(payload.session_id)) lines.push(`会话ID：${normalizeText(payload.session_id)}`);
    if (normalizeText(payload.sender_email)) lines.push(`联系邮箱：${normalizeText(payload.sender_email)}`);
    if (normalizeText(payload.message_type)) lines.push(`消息类型：${normalizeText(payload.message_type_label) || getChatMessageTypeLabel(payload.message_type)}`);
    if (normalizeText(payload.created_at)) lines.push(`发送时间：${formatTimestamp(payload.created_at)}`);
    if (normalizeText(payload.content_preview)) lines.push(`消息内容：${normalizeText(payload.content_preview)}`);
    if (normalizeText(payload.message_type).toLowerCase() === 'image' && normalizeText(payload.content)) {
        lines.push(`附件地址：${normalizeText(payload.content)}`);
    }
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildShopPurchaseSucceededAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'shop_purchase_succeeded') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const lines = [
        `[商城购买成功][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '商城购买成功'}`
    ];

    if (normalizeText(payload.order_id)) lines.push(`订单号：${normalizeText(payload.order_id)}`);
    if (normalizeText(payload.buyer_label)) lines.push(`购买者：${normalizeText(payload.buyer_label)}`);
    if (normalizeText(payload.user_id)) lines.push(`用户ID：${normalizeText(payload.user_id)}`);
    if (normalizeText(payload.site)) lines.push(`站点：${normalizeText(payload.site).toUpperCase()}`);
    if (normalizeText(payload.product_name)) lines.push(`商品：${normalizeText(payload.product_name)}`);
    if (Number.isFinite(Number(payload.item_count))) lines.push(`数量：${Math.max(1, Math.round(Number(payload.item_count || 1)))} 件`);
    if (Number.isFinite(Number(payload.total_price)) || Number.isFinite(Number(payload.price_paid))) {
        lines.push(`订单金额：${formatCurrencyAmount(payload.total_price ?? payload.price_paid)}`);
    }
    if (normalizeText(payload.delivery_status)) lines.push(`履约状态：${normalizeText(payload.delivery_status_label) || getShopDeliveryStatusLabel(payload.delivery_status)}`);
    if (normalizeText(payload.refund_status)) lines.push(`退款状态：${normalizeText(payload.refund_status_label) || getRefundStatusLabel(payload.refund_status)}`);
    if (normalizeText(payload.created_at)) lines.push(`购买时间：${formatTimestamp(payload.created_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildWalletRechargeSucceededAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'wallet_recharge_succeeded') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const lines = [
        `[充值成功][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '充值成功'}`
    ];

    if (normalizeText(payload.payment_order_id)) lines.push(`充值单号：${normalizeText(payload.payment_order_id)}`);
    if (normalizeText(payload.provider_order_no)) lines.push(`支付单号：${normalizeText(payload.provider_order_no)}`);
    if (normalizeText(payload.buyer_label)) lines.push(`付款者：${normalizeText(payload.buyer_label)}`);
    if (normalizeText(payload.user_id)) lines.push(`用户ID：${normalizeText(payload.user_id)}`);
    if (normalizeText(payload.site)) lines.push(`站点：${normalizeText(payload.site).toUpperCase()}`);
    if (normalizeText(payload.provider)) lines.push(`支付通道：${getProviderLabel(payload.provider) || normalizeText(payload.provider)}`);
    if (normalizeText(payload.package_name)) lines.push(`充值档位：${normalizeText(payload.package_name)}`);
    if (Number.isFinite(Number(payload.expected_amount)) || Number.isFinite(Number(payload.paid_amount))) {
        const amountLine = [formatCurrencyAmount(payload.expected_amount), formatCurrencyAmount(payload.paid_amount)].filter(Boolean);
        if (amountLine.length === 2) {
            lines.push(`金额：应付 ${amountLine[0]} / 实付 ${amountLine[1]}`);
        } else if (amountLine.length === 1) {
            lines.push(`金额：${amountLine[0]}`);
        }
    }
    if (Number.isFinite(Number(payload.points_amount))) lines.push(`到账积分：${formatPointsAmount(payload.points_amount)}`);
    if (normalizeText(payload.status)) lines.push(`订单状态：${getOrderStatusLabel(payload.status) || normalizeText(payload.status)}`);
    if (normalizeText(payload.paid_at)) lines.push(`支付时间：${formatTimestamp(payload.paid_at)}`);
    if (normalizeText(payload.claimed_at)) lines.push(`入账时间：${formatTimestamp(payload.claimed_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildRefundOpsAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'payment_refund_ops') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    if (!Object.keys(payload).length) {
        return '';
    }

    const lines = [
        `[支付退款告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '退款异常'}`
    ];
    const topicLabel = normalizeText(payload.topic_label);
    const processingLabel = getRefundProcessingLabel(payload.processing_result);
    const site = normalizeText(payload.site).toUpperCase();
    const providerLabel = getProviderLabel(payload.provider);
    const orderStatusLabel = getOrderStatusLabel(payload.order_status);
    const refundStatusLabel = getOrderStatusLabel(payload.refund_status);
    const amountLine = [formatCurrencyAmount(payload.expected_amount), formatCurrencyAmount(payload.paid_amount)]
        .filter(Boolean);
    const reclaimTotal = Number(payload.refund_reclaimed_points || 0);
    const compensationPaid = Number(payload.compensation_restored_paid_points || 0);
    const compensationBonus = Number(payload.compensation_restored_bonus_points || 0);

    if (topicLabel) lines.push(`专题：${topicLabel}`);
    if (processingLabel) lines.push(`异常类型：${processingLabel}`);
    if (site) lines.push(`站点：${site}`);
    if (providerLabel) lines.push(`支付通道：${providerLabel}`);
    if (normalizeText(payload.provider_order_no)) lines.push(`订单号：${normalizeText(payload.provider_order_no)}`);
    if (normalizeText(payload.target_id)) lines.push(`订单ID：${normalizeText(payload.target_id)}`);
    if (normalizeText(payload.user_id)) lines.push(`付款者/用户ID：${normalizeText(payload.user_id)}`);
    if (orderStatusLabel) lines.push(`订单状态：${orderStatusLabel}`);
    if (refundStatusLabel) lines.push(`退款状态：${refundStatusLabel}`);
    if (amountLine.length === 2) {
        lines.push(`金额：应付 ${amountLine[0]} / 实付 ${amountLine[1]}`);
    } else if (amountLine.length === 1) {
        lines.push(`金额：${amountLine[0]}`);
    }
    if (Number(payload.points_amount || 0) > 0) {
        const creditedLabel = formatBooleanLabel(payload.credited);
        lines.push(`积分：${formatPointsAmount(payload.points_amount)}${creditedLabel ? `（已入账：${creditedLabel}）` : ''}`);
    }
    if (reclaimTotal > 0) {
        const reclaimParts = [
            `总 ${formatPointsAmount(payload.refund_reclaimed_points)}`,
            Number(payload.refund_reclaimed_paid_points || 0) > 0 ? `本金 ${formatPointsAmount(payload.refund_reclaimed_paid_points)}` : '',
            Number(payload.refund_reclaimed_bonus_points || 0) > 0 ? `赠送 ${formatPointsAmount(payload.refund_reclaimed_bonus_points)}` : ''
        ].filter(Boolean);
        lines.push(`扣回积分：${reclaimParts.join(' / ')}`);
    }
    if (compensationPaid > 0 || compensationBonus > 0) {
        const compensationParts = [
            compensationPaid > 0 ? `本金 ${formatPointsAmount(compensationPaid)}` : '',
            compensationBonus > 0 ? `赠送 ${formatPointsAmount(compensationBonus)}` : ''
        ].filter(Boolean);
        lines.push(`补回积分：${compensationParts.join(' / ')}`);
    }
    if (normalizeText(payload.gateway_open_order_id)) lines.push(`网关单号：${normalizeText(payload.gateway_open_order_id)}`);
    if (normalizeText(payload.query_status)) lines.push(`查单状态：${getOrderStatusLabel(payload.query_status)}`);
    if (normalizeText(payload.note)) lines.push(`操作备注：${normalizeText(payload.note)}`);
    if (normalizeText(payload.last_error)) lines.push(`最近错误：${normalizeText(payload.last_error)}`);
    if (normalizeText(payload.gateway_message) && normalizeText(payload.gateway_message) !== normalizeText(payload.last_error)) {
        lines.push(`网关提示：${normalizeText(payload.gateway_message)}`);
    }
    if (Number.isFinite(Number(payload.response_status))) lines.push(`响应状态：${Number(payload.response_status)}`);
    if (normalizeText(payload.detail)) lines.push(`告警说明：${normalizeText(payload.detail)}`);
    if (normalizeText(payload.claimed_at)) lines.push(`入账时间：${formatTimestamp(payload.claimed_at)}`);
    if (normalizeText(payload.paid_at)) lines.push(`支付时间：${formatTimestamp(payload.paid_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildPaymentGatewayDegradedAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'payment_gateway_degraded') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const providerLabel = getProviderLabel(payload.provider);
    const siteLabel = normalizeText(payload.site).toUpperCase();
    const reasons = Array.isArray(payload.degraded_reasons)
        ? payload.degraded_reasons.map((item) => normalizeText(item)).filter(Boolean)
        : [];

    const lines = [
        `[支付通道告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '支付通道异常'}`
    ];

    if (providerLabel) lines.push(`支付通道：${providerLabel}`);
    if (siteLabel) lines.push(`站点：${siteLabel}`);
    if (Number.isFinite(Number(payload.monitor_window_minutes))) lines.push(`巡检窗口：最近 ${Number(payload.monitor_window_minutes)} 分钟`);
    if (reasons.length) lines.push(`判定信号：${reasons.join('；')}`);
    if (Number(payload.total_orders || 0) > 0) {
        lines.push(`订单概览：总 ${Number(payload.total_orders || 0)} 笔 / 成功 ${Number(payload.paid_orders || 0)} 笔 / 待审核 ${Number(payload.review_orders || 0)} 笔 / 失败 ${Number(payload.failed_orders || 0)} 笔 / 成功率 ${formatPercent(payload.paid_rate)}`);
    }
    if (Number(payload.webhook_total || 0) > 0) {
        lines.push(`回调概览：总 ${Number(payload.webhook_total || 0)} 次 / 成功 ${Number(payload.webhook_success || 0)} 次 / 失败 ${Number(payload.webhook_failed || 0)} 次 / 4xx ${Number(payload.webhook_4xx || 0)} 次 / 5xx ${Number(payload.webhook_5xx || 0)} 次 / 成功率 ${formatPercent(payload.webhook_success_rate)}`);
    }
    if (Number(payload.query_total || 0) > 0) {
        lines.push(`查码概览：总 ${Number(payload.query_total || 0)} 次 / 成功 ${Number(payload.query_success || 0)} 次 / 失败 ${Number(payload.query_failed || 0)} 次 / 4xx ${Number(payload.query_4xx || 0)} 次 / 5xx ${Number(payload.query_5xx || 0)} 次 / 成功率 ${formatPercent(payload.query_success_rate)}`);
    }
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildPaymentGatewayRecoveredAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'payment_gateway_recovered') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const providerLabel = getProviderLabel(payload.provider);
    const siteLabel = normalizeText(payload.site).toUpperCase();
    const previousReasons = Array.isArray(payload.previous_degraded_reasons)
        ? payload.previous_degraded_reasons.map((item) => normalizeText(item)).filter(Boolean)
        : [];

    const lines = [
        `[支付通道恢复][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '支付通道已恢复'}`
    ];

    if (providerLabel) lines.push(`支付通道：${providerLabel}`);
    if (siteLabel) lines.push(`站点：${siteLabel}`);
    if (normalizeText(payload.recovery_summary)) lines.push(`恢复结论：${normalizeText(payload.recovery_summary)}`);
    if (normalizeText(payload.incident_started_at)) lines.push(`上次异常：${formatTimestamp(payload.incident_started_at)}`);
    if (normalizeText(payload.incident_recovered_at)) lines.push(`恢复时间：${formatTimestamp(payload.incident_recovered_at)}`);
    if (Number.isFinite(Number(payload.incident_duration_minutes))) {
        lines.push(`持续时长：${Math.max(0, Math.round(Number(payload.incident_duration_minutes || 0)))} 分钟`);
    }
    if (previousReasons.length) lines.push(`上次异常信号：${previousReasons.join('；')}`);
    if (Number(payload.total_orders || 0) > 0) {
        lines.push(`当前订单概览：总 ${Number(payload.total_orders || 0)} 笔 / 成功 ${Number(payload.paid_orders || 0)} 笔 / 待审核 ${Number(payload.review_orders || 0)} 笔 / 失败 ${Number(payload.failed_orders || 0)} 笔 / 成功率 ${formatPercent(payload.paid_rate)}`);
    }
    if (Number(payload.webhook_total || 0) > 0) {
        lines.push(`当前回调概览：总 ${Number(payload.webhook_total || 0)} 次 / 成功 ${Number(payload.webhook_success || 0)} 次 / 失败 ${Number(payload.webhook_failed || 0)} 次 / 5xx ${Number(payload.webhook_5xx || 0)} 次 / 成功率 ${formatPercent(payload.webhook_success_rate)}`);
    }
    if (Number(payload.query_total || 0) > 0) {
        lines.push(`当前查码概览：总 ${Number(payload.query_total || 0)} 次 / 成功 ${Number(payload.query_success || 0)} 次 / 失败 ${Number(payload.query_failed || 0)} 次 / 5xx ${Number(payload.query_5xx || 0)} 次 / 成功率 ${formatPercent(payload.query_success_rate)}`);
    }
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildPaymentConfigChangedAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'payment_config_changed') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const riskFlags = Array.isArray(payload.risk_flags)
        ? payload.risk_flags.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const updatedProviders = Array.isArray(payload.updated_provider_labels)
        ? payload.updated_provider_labels.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const updatedSecrets = Array.isArray(payload.updated_secrets)
        ? payload.updated_secrets.map((item) => normalizeText(item)).filter(Boolean)
        : [];

    const lines = [
        `[支付配置告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '支付配置变更'}`
    ];

    if (normalizeText(payload.admin_email)) lines.push(`操作人：${normalizeText(payload.admin_email)}`);
    if (normalizeText(payload.action_label)) lines.push(`变更类型：${normalizeText(payload.action_label)}`);
    if (normalizeText(payload.active_provider)) lines.push(`当前生效通道：${normalizeText(payload.active_provider_label) || getProviderLabel(payload.active_provider)}`);
    if (updatedProviders.length) lines.push(`启用通道：${updatedProviders.join('、')}`);
    if (updatedSecrets.length) lines.push(`更新密钥：${updatedSecrets.join('、')}`);
    if (normalizeText(payload.secret_name)) lines.push(`删除密钥：${normalizeText(payload.secret_name)}`);
    if (riskFlags.length) lines.push(`风险提示：${riskFlags.join('；')}`);
    if (normalizeText(payload.created_at)) lines.push(`发生时间：${formatTimestamp(payload.created_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildPaymentConfigIncidentAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'payment_config_incident') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const adminEmails = Array.isArray(payload.admin_emails)
        ? payload.admin_emails.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const actionLabels = Array.isArray(payload.action_labels)
        ? payload.action_labels.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const riskSignals = Array.isArray(payload.risk_signals)
        ? payload.risk_signals.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const providerLabels = Array.isArray(payload.provider_labels)
        ? payload.provider_labels.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const secretLabels = Array.isArray(payload.secret_labels)
        ? payload.secret_labels.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const signalLabels = Array.isArray(payload.signal_labels)
        ? payload.signal_labels.map((item) => normalizeText(item)).filter(Boolean)
        : [];

    const lines = [
        `[支付配置事故][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '支付配置异常升级'}`
    ];

    if (Number.isFinite(Number(payload.lookback_minutes))) {
        lines.push(`观察窗口：最近 ${Math.max(1, Math.round(Number(payload.lookback_minutes || 0)))} 分钟`);
    }
    if (Number.isFinite(Number(payload.incident_change_count))) {
        lines.push(`命中次数：${Math.max(0, Math.round(Number(payload.incident_change_count || 0)))} 次`);
    }
    if (Number.isFinite(Number(payload.distinct_admin_count))) {
        lines.push(`涉及管理员：${Math.max(0, Math.round(Number(payload.distinct_admin_count || 0)))} 位`);
    }
    if (adminEmails.length) lines.push(`操作人：${adminEmails.join('、')}`);
    if (actionLabels.length) lines.push(`变更类型：${actionLabels.join('；')}`);
    if (signalLabels.length) lines.push(`升级信号：${signalLabels.join('；')}`);
    if (riskSignals.length) lines.push(`风险信号：${riskSignals.join('；')}`);
    if (providerLabels.length) lines.push(`涉及通道：${providerLabels.join('、')}`);
    if (secretLabels.length) lines.push(`涉及密钥：${secretLabels.join('、')}`);
    if (normalizeText(payload.latest_change_at)) lines.push(`最近时间：${formatTimestamp(payload.latest_change_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildPaymentConfigIncidentRecoveredAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'payment_config_incident_recovered') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const activeAdminEmails = Array.isArray(payload.active_admin_emails)
        ? payload.active_admin_emails.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const activeActionLabels = Array.isArray(payload.active_action_labels)
        ? payload.active_action_labels.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const activeRiskSignals = Array.isArray(payload.active_risk_signals)
        ? payload.active_risk_signals.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const activeProviderLabels = Array.isArray(payload.active_provider_labels)
        ? payload.active_provider_labels.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const activeSecretLabels = Array.isArray(payload.active_secret_labels)
        ? payload.active_secret_labels.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const lines = [
        `[支付配置事故恢复][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '支付配置事故已恢复'}`
    ];

    if (normalizeText(payload.recovery_summary)) lines.push(`恢复结论：${normalizeText(payload.recovery_summary)}`);
    if (normalizeText(payload.incident_started_at)) lines.push(`上次升级：${formatTimestamp(payload.incident_started_at)}`);
    if (normalizeText(payload.incident_recovered_at)) lines.push(`恢复时间：${formatTimestamp(payload.incident_recovered_at)}`);
    if (Number.isFinite(Number(payload.incident_duration_minutes))) {
        lines.push(`持续时长：${Math.max(0, Math.round(Number(payload.incident_duration_minutes || 0)))} 分钟`);
    }
    if (Number.isFinite(Number(payload.previous_incident_change_count))) {
        lines.push(`上次事故规模：${Math.max(0, Math.round(Number(payload.previous_incident_change_count || 0)))} 次高风险改动`);
    }
    if (Number.isFinite(Number(payload.active_change_count))) {
        lines.push(`当前剩余高风险改动：${Math.max(0, Math.round(Number(payload.active_change_count || 0)))} 次`);
    }
    if (activeAdminEmails.length) lines.push(`当前涉及管理员：${activeAdminEmails.join('、')}`);
    if (activeActionLabels.length) lines.push(`当前动作：${activeActionLabels.join('；')}`);
    if (activeRiskSignals.length) lines.push(`当前风险信号：${activeRiskSignals.join('；')}`);
    if (activeProviderLabels.length) lines.push(`当前涉及通道：${activeProviderLabels.join('、')}`);
    if (activeSecretLabels.length) lines.push(`当前涉及密钥：${activeSecretLabels.join('、')}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildPaymentConfigRecoveredAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'payment_config_recovered') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const previousRiskFlags = Array.isArray(payload.previous_risk_flags)
        ? payload.previous_risk_flags.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const currentEnabledProviders = Array.isArray(payload.current_enabled_provider_labels)
        ? payload.current_enabled_provider_labels.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const lines = [
        `[支付配置恢复][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '支付配置风险已恢复'}`
    ];

    if (normalizeText(payload.recovery_summary)) lines.push(`恢复结论：${normalizeText(payload.recovery_summary)}`);
    if (normalizeText(payload.previous_admin_email)) lines.push(`上次操作人：${normalizeText(payload.previous_admin_email)}`);
    if (normalizeText(payload.recovery_admin_email)) lines.push(`修复人：${normalizeText(payload.recovery_admin_email)}`);
    if (normalizeText(payload.previous_action_label)) lines.push(`上次风险动作：${normalizeText(payload.previous_action_label)}`);
    if (normalizeText(payload.recovery_action_label)) lines.push(`修复动作：${normalizeText(payload.recovery_action_label)}`);
    if (normalizeText(payload.current_active_provider)) {
        lines.push(`当前生效通道：${normalizeText(payload.current_active_provider_label) || getProviderLabel(payload.current_active_provider)}`);
    }
    if (currentEnabledProviders.length) lines.push(`当前启用通道：${currentEnabledProviders.join('、')}`);
    if (normalizeText(payload.restored_secret_label)) lines.push(`恢复密钥：${normalizeText(payload.restored_secret_label)}`);
    if (normalizeText(payload.restored_secret_source)) {
        const sourceLabel = normalizeText(payload.restored_secret_source) === 'stored'
            ? '后台密钥库'
            : (normalizeText(payload.restored_secret_source) === 'environment' ? '环境变量' : normalizeText(payload.restored_secret_source));
        lines.push(`当前密钥来源：${sourceLabel}`);
    }
    if (normalizeText(payload.restored_secret_updated_at)) lines.push(`密钥更新时间：${formatTimestamp(payload.restored_secret_updated_at)}`);
    if (normalizeText(payload.incident_started_at)) lines.push(`上次风险：${formatTimestamp(payload.incident_started_at)}`);
    if (normalizeText(payload.incident_recovered_at)) lines.push(`恢复时间：${formatTimestamp(payload.incident_recovered_at)}`);
    if (Number.isFinite(Number(payload.incident_duration_minutes))) {
        lines.push(`持续时长：${Math.max(0, Math.round(Number(payload.incident_duration_minutes || 0)))} 分钟`);
    }
    if (previousRiskFlags.length) lines.push(`上次风险提示：${previousRiskFlags.join('；')}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildVerifyQuotaLowAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'verify_quota_low') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const reasons = Array.isArray(payload.degraded_reasons)
        ? payload.degraded_reasons.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const lines = [
        `[验证额度告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '验证额度不足'}`
    ];

    if (normalizeText(payload.key_name)) lines.push(`API Key：${normalizeText(payload.key_name)}`);
    if (Number.isFinite(Number(payload.balance))) lines.push(`剩余额度：${Number(payload.balance).toFixed(2)} 点`);
    if (Number.isFinite(Number(payload.cost_per_job))) lines.push(`单次成本：${Number(payload.cost_per_job).toFixed(2)} 点`);
    if (Number.isFinite(Number(payload.remaining_jobs))) lines.push(`预计剩余：${Math.max(0, Math.floor(Number(payload.remaining_jobs)))} 次`);
    if (Number.isFinite(Number(payload.total_used))) lines.push(`累计消耗：${Number(payload.total_used).toFixed(2)} 点`);
    if (reasons.length) lines.push(`判定信号：${reasons.join('；')}`);
    if (Number.isFinite(Number(payload.queue_size)) || Number.isFinite(Number(payload.running_jobs))) {
        lines.push(`队列概览：排队 ${Math.max(0, Math.round(Number(payload.queue_size || 0)))} 个 / 运行中 ${Math.max(0, Math.round(Number(payload.running_jobs || 0)))} 个`);
    }
    if (normalizeText(payload.queue_error)) lines.push(`队列查询：${normalizeText(payload.queue_error)}`);
    if (normalizeText(payload.checked_at)) lines.push(`检查时间：${formatTimestamp(payload.checked_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildVerifyServiceDisabledAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'verify_service_disabled') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const lines = [
        `[验证服务告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '验证服务不可用'}`
    ];
    const responseStatus = Number(payload.response_status);

    if (normalizeText(payload.service_status_label)) lines.push(`当前状态：${normalizeText(payload.service_status_label)}`);
    if (normalizeText(payload.key_name)) lines.push(`API Key：${normalizeText(payload.key_name)}`);
    if (normalizeText(payload.api_base_url)) lines.push(`API Base：${normalizeText(payload.api_base_url)}`);
    if (normalizeText(payload.last_error)) lines.push(`最近错误：${normalizeText(payload.last_error)}`);
    if (Number.isFinite(responseStatus) && responseStatus > 0) lines.push(`响应状态：${responseStatus}`);
    if (normalizeText(payload.checked_at)) lines.push(`检查时间：${formatTimestamp(payload.checked_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildVerifyFailureRateSpikeAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'verify_failure_rate_spike') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const reasons = Array.isArray(payload.degraded_reasons)
        ? payload.degraded_reasons.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const affectedUsers = Array.isArray(payload.affected_user_labels)
        ? payload.affected_user_labels.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const hotErrors = Array.isArray(payload.hot_errors)
        ? payload.hot_errors.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const lines = [
        `[验证失败率告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '验证失败率异常'}`
    ];

    if (normalizeText(payload.key_name)) lines.push(`API Key：${normalizeText(payload.key_name)}`);
    if (Number.isFinite(Number(payload.monitor_window_minutes))) lines.push(`时间窗：最近 ${Math.max(1, Math.round(Number(payload.monitor_window_minutes)))} 分钟`);
    if (reasons.length) lines.push(`判定信号：${reasons.join('；')}`);
    if (
        Number.isFinite(Number(payload.total_jobs))
        || Number.isFinite(Number(payload.failed_jobs))
        || Number.isFinite(Number(payload.success_jobs))
    ) {
        lines.push(`任务概览：总 ${Math.max(0, Math.round(Number(payload.total_jobs || 0)))} 次 / 失败 ${Math.max(0, Math.round(Number(payload.failed_jobs || 0)))} 次 / 成功 ${Math.max(0, Math.round(Number(payload.success_jobs || 0)))} 次 / 失败率 ${formatPercent(payload.failure_rate)}`);
    }
    if (Number.isFinite(Number(payload.affected_user_count))) {
        lines.push(`受影响用户数：${Math.max(0, Math.round(Number(payload.affected_user_count || 0)))} 人`);
    }
    if (affectedUsers.length) lines.push(`受影响用户：${affectedUsers.join('、')}`);
    if (hotErrors.length) lines.push(`最近错误：${hotErrors.join('；')}`);
    if (normalizeText(payload.checked_at)) lines.push(`检查时间：${formatTimestamp(payload.checked_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildVerifyIncidentEscalatedAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'verify_incident_escalated') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const signalLabels = Array.isArray(payload.signal_labels)
        ? payload.signal_labels.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const signalSummaries = Array.isArray(payload.signal_summaries)
        ? payload.signal_summaries.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const signalTimeline = Array.isArray(payload.signal_timeline)
        ? payload.signal_timeline.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const lines = [
        `[验证综合告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '验证异常升级'}`
    ];

    if (normalizeText(payload.key_name)) lines.push(`API Key：${normalizeText(payload.key_name)}`);
    if (normalizeText(payload.api_base_url)) lines.push(`API Base：${normalizeText(payload.api_base_url)}`);
    if (Number.isFinite(Number(payload.lookback_minutes))) lines.push(`时间窗：最近 ${Math.max(1, Math.round(Number(payload.lookback_minutes)))} 分钟`);
    if (signalLabels.length) lines.push(`升级信号：${signalLabels.join('、')}`);
    if (Number.isFinite(Number(payload.triggered_signal_count))) lines.push(`命中数量：${Math.max(0, Math.round(Number(payload.triggered_signal_count || 0)))} 类`);
    if (signalSummaries.length) lines.push(`关键摘要：${signalSummaries.join('；')}`);
    if (signalTimeline.length) lines.push(`最近触发：${signalTimeline.join('；')}`);
    if (normalizeText(payload.latest_signal_at)) lines.push(`最新时间：${formatTimestamp(payload.latest_signal_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildVerifyIncidentRecoveredAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'verify_incident_recovered') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const activeSignalLabels = Array.isArray(payload.active_signal_labels)
        ? payload.active_signal_labels.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const activeSignalSummaries = Array.isArray(payload.active_signal_summaries)
        ? payload.active_signal_summaries.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const lines = [
        `[验证恢复通知][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '验证综合异常已恢复'}`
    ];

    if (normalizeText(payload.key_name)) lines.push(`API Key：${normalizeText(payload.key_name)}`);
    if (normalizeText(payload.api_base_url)) lines.push(`API Base：${normalizeText(payload.api_base_url)}`);
    if (normalizeText(payload.recovery_summary)) lines.push(`恢复结论：${normalizeText(payload.recovery_summary)}`);
    if (normalizeText(payload.incident_started_at)) lines.push(`上次升级：${formatTimestamp(payload.incident_started_at)}`);
    if (normalizeText(payload.incident_recovered_at)) lines.push(`恢复时间：${formatTimestamp(payload.incident_recovered_at)}`);
    if (Number.isFinite(Number(payload.incident_duration_minutes))) {
        lines.push(`持续时长：${Math.max(0, Math.round(Number(payload.incident_duration_minutes || 0)))} 分钟`);
    }
    if (activeSignalLabels.length) lines.push(`当前仍有信号：${activeSignalLabels.join('、')}`);
    if (activeSignalSummaries.length) lines.push(`当前摘要：${activeSignalSummaries.join('；')}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildVerifyQueueBacklogAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'verify_queue_backlog') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const reasons = Array.isArray(payload.degraded_reasons)
        ? payload.degraded_reasons.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const hotTargets = Array.isArray(payload.hot_targets)
        ? payload.hot_targets.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const hotErrors = Array.isArray(payload.hot_errors)
        ? payload.hot_errors.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const lines = [
        `[验证队列告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '验证任务堆积'}`
    ];

    if (normalizeText(payload.key_name)) lines.push(`API Key：${normalizeText(payload.key_name)}`);
    if (reasons.length) lines.push(`判定信号：${reasons.join('；')}`);
    if (
        Number.isFinite(Number(payload.queue_size))
        || Number.isFinite(Number(payload.running_jobs))
        || Number.isFinite(Number(payload.active_job_count))
    ) {
        lines.push(`队列概览：上游排队 ${Math.max(0, Math.round(Number(payload.queue_size || 0)))} 个 / 运行中 ${Math.max(0, Math.round(Number(payload.running_jobs || 0)))} 个 / 本地活跃 ${Math.max(0, Math.round(Number(payload.active_job_count || 0)))} 个`);
    }
    if (normalizeText(payload.oldest_pending_label)) lines.push(`最老活跃任务：${normalizeText(payload.oldest_pending_label)}`);
    if (hotTargets.length) lines.push(`热点目标：${hotTargets.join('、')}`);
    if (hotErrors.length) lines.push(`最近错误：${hotErrors.join('；')}`);
    if (normalizeText(payload.queue_error)) lines.push(`队列查询：${normalizeText(payload.queue_error)}`);
    if (normalizeText(payload.checked_at)) lines.push(`检查时间：${formatTimestamp(payload.checked_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function getTicketStatusLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return '';
    const labelMap = {
        pending: '待处理',
        open: '待处理',
        resolved: '已解决',
        rejected: '已拒绝'
    };
    return labelMap[normalized] || normalized;
}

function getShopDeliveryStatusLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return '';
    const labelMap = {
        pending: '待发货',
        processing: '处理中',
        retry_waiting: '重试中',
        requeued: '已重排队',
        dead_letter: '死信待处理',
        delivered: '已发货'
    };
    return labelMap[normalized] || normalized;
}

function getRefundStatusLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return '';
    const labelMap = {
        none: '正常',
        no_refund: '正常',
        refunded: '已退款',
        full_refund: '已全额退款',
        partial_refund: '部分退款',
        refund_pending: '退款处理中'
    };
    return labelMap[normalized] || normalized;
}

function buildTicketSlaOverdueAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'ticket_sla_overdue') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const lines = [
        `[工单 SLA 告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '工单超时未处理'}`
    ];

    if (normalizeText(payload.ticket_id)) lines.push(`工单号：${normalizeText(payload.ticket_id)}`);
    if (normalizeText(payload.order_id)) lines.push(`订单号：${normalizeText(payload.order_id)}`);
    if (normalizeText(payload.user_id)) lines.push(`用户ID：${normalizeText(payload.user_id)}`);
    if (Number.isFinite(Number(payload.wait_minutes))) lines.push(`等待时长：${normalizeText(payload.wait_label) || `${Math.max(0, Math.round(Number(payload.wait_minutes || 0)))} 分钟`}`);
    if (normalizeText(payload.responsible_label)) lines.push(`责任人：${normalizeText(payload.responsible_label)}`);
    if (normalizeText(payload.ticket_status)) lines.push(`当前状态：${getTicketStatusLabel(payload.ticket_status)}`);
    if (normalizeText(payload.reason)) lines.push(`问题描述：${normalizeText(payload.reason)}`);
    if (normalizeText(payload.created_at)) lines.push(`创建时间：${formatTimestamp(payload.created_at)}`);
    if (normalizeText(payload.updated_at)) lines.push(`最近更新时间：${formatTimestamp(payload.updated_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildTicketSlaRecoveredAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'ticket_sla_recovered') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const lines = [
        `[工单 SLA 恢复][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '工单超时已恢复'}`
    ];

    if (normalizeText(payload.ticket_id)) lines.push(`工单号：${normalizeText(payload.ticket_id)}`);
    if (normalizeText(payload.order_id)) lines.push(`订单号：${normalizeText(payload.order_id)}`);
    if (normalizeText(payload.user_id)) lines.push(`用户ID：${normalizeText(payload.user_id)}`);
    if (normalizeText(payload.recovery_summary)) lines.push(`恢复结论：${normalizeText(payload.recovery_summary)}`);
    if (normalizeText(payload.previous_wait_label)) lines.push(`上次超时等待：${normalizeText(payload.previous_wait_label)}`);
    if (normalizeText(payload.ticket_status)) lines.push(`当前状态：${getTicketStatusLabel(payload.ticket_status)}`);
    if (normalizeText(payload.incident_started_at)) lines.push(`上次超时：${formatTimestamp(payload.incident_started_at)}`);
    if (normalizeText(payload.updated_at)) lines.push(`最近更新时间：${formatTimestamp(payload.updated_at)}`);
    if (normalizeText(payload.incident_recovered_at)) lines.push(`恢复时间：${formatTimestamp(payload.incident_recovered_at)}`);
    if (Number.isFinite(Number(payload.incident_duration_minutes))) {
        lines.push(`持续时长：${Math.max(0, Math.round(Number(payload.incident_duration_minutes || 0)))} 分钟`);
    }
    if (normalizeText(payload.reason)) lines.push(`问题描述：${normalizeText(payload.reason)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function getDeliveryTypeLabel(value) {
    const normalized = normalizeText(value).toUpperCase();
    if (!normalized || normalized === 'KEY') {
        return '卡密直发';
    }
    if (normalized === 'API') {
        return '接口发货';
    }
    return normalized;
}

function buildShopInventoryAlertText(job = {}) {
    const alertType = normalizeText(job.alert_type).toLowerCase();
    if (alertType !== 'shop_inventory_low' && alertType !== 'shop_inventory_empty') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const lines = [
        `[商城库存告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '库存预警'}`
    ];

    if (normalizeText(payload.product_name)) lines.push(`商品：${normalizeText(payload.product_name)}`);
    if (normalizeText(payload.category)) lines.push(`分类：${normalizeText(payload.category)}`);
    if (Number.isFinite(Number(payload.stock_count))) {
        const stockCount = Math.max(0, Math.round(Number(payload.stock_count || 0)));
        const threshold = Math.max(0, Math.round(Number(payload.low_stock_threshold || 0)));
        lines.push(
            stockCount <= 0
                ? '当前库存：0 件（已售罄）'
                : `当前库存：${stockCount} 件（阈值 ${threshold} 件）`
        );
    }
    if (Number.isFinite(Number(payload.recent_sales_count))) {
        const salesWindow = Math.max(1, Math.round(Number(payload.recent_sales_days || 7)));
        lines.push(`近 ${salesWindow} 天销量：${Math.max(0, Math.round(Number(payload.recent_sales_count || 0)))} 件`);
    }
    if (normalizeText(payload.delivery_type)) lines.push(`发货模式：${getDeliveryTypeLabel(payload.delivery_type)}`);
    if (normalizeText(payload.updated_at)) lines.push(`最近更新时间：${formatTimestamp(payload.updated_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildShopInventoryRecoveredAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'shop_inventory_recovered') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const lines = [
        `[商城库存恢复][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '库存已恢复'}`
    ];

    if (normalizeText(payload.product_name)) lines.push(`商品：${normalizeText(payload.product_name)}`);
    if (normalizeText(payload.category)) lines.push(`分类：${normalizeText(payload.category)}`);
    if (normalizeText(payload.recovery_summary)) lines.push(`恢复结论：${normalizeText(payload.recovery_summary)}`);
    if (Number.isFinite(Number(payload.stock_count))) {
        const stockCount = Math.max(0, Math.round(Number(payload.stock_count || 0)));
        const threshold = Math.max(0, Math.round(Number(payload.low_stock_threshold || 0)));
        lines.push(`当前库存：${stockCount} 件（阈值 ${threshold} 件）`);
    }
    if (Number.isFinite(Number(payload.previous_stock_count))) {
        lines.push(`上次告警库存：${Math.max(0, Math.round(Number(payload.previous_stock_count || 0)))} 件`);
    }
    if (Number.isFinite(Number(payload.recent_sales_count))) {
        const salesWindow = Math.max(1, Math.round(Number(payload.recent_sales_days || 7)));
        lines.push(`近 ${salesWindow} 天销量：${Math.max(0, Math.round(Number(payload.recent_sales_count || 0)))} 件`);
    }
    if (normalizeText(payload.delivery_type)) lines.push(`发货模式：${getDeliveryTypeLabel(payload.delivery_type)}`);
    if (normalizeText(payload.incident_started_at)) lines.push(`上次告警：${formatTimestamp(payload.incident_started_at)}`);
    if (normalizeText(payload.updated_at)) lines.push(`最近更新时间：${formatTimestamp(payload.updated_at)}`);
    if (normalizeText(payload.incident_recovered_at)) lines.push(`恢复时间：${formatTimestamp(payload.incident_recovered_at)}`);
    if (Number.isFinite(Number(payload.incident_duration_minutes))) {
        lines.push(`持续时长：${Math.max(0, Math.round(Number(payload.incident_duration_minutes || 0)))} 分钟`);
    }
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildShopOrderDeliveryFailedAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'shop_order_delivery_failed') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const lines = [
        `[商城履约告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '订单履约失败'}`
    ];

    if (normalizeText(payload.order_id)) lines.push(`订单号：${normalizeText(payload.order_id)}`);
    if (normalizeText(payload.product_name)) lines.push(`商品：${normalizeText(payload.product_name)}`);
    if (normalizeText(payload.user_id)) lines.push(`用户ID：${normalizeText(payload.user_id)}`);
    if (Number.isFinite(Number(payload.item_count))) lines.push(`购买数量：${Math.max(1, Math.round(Number(payload.item_count || 1)))} 件`);
    if (Number.isFinite(Number(payload.total_price)) || Number.isFinite(Number(payload.price_paid))) {
        lines.push(`订单金额：${formatCurrencyAmount(payload.total_price ?? payload.price_paid)}`);
    }
    if (normalizeText(payload.delivery_status)) lines.push(`履约状态：${normalizeText(payload.delivery_status_label) || getShopDeliveryStatusLabel(payload.delivery_status)}`);
    if (Number.isFinite(Number(payload.delivery_attempt_count))) lines.push(`失败次数：${Math.max(0, Math.round(Number(payload.delivery_attempt_count || 0)))}`);
    if (normalizeText(payload.refund_status)) lines.push(`退款状态：${normalizeText(payload.refund_status_label) || getRefundStatusLabel(payload.refund_status)}`);
    if (normalizeText(payload.delivery_last_error)) lines.push(`最近错误：${normalizeText(payload.delivery_last_error)}`);
    if (normalizeText(payload.created_at)) lines.push(`下单时间：${formatTimestamp(payload.created_at)}`);
    if (normalizeText(payload.delivery_updated_at)) lines.push(`最近履约更新时间：${formatTimestamp(payload.delivery_updated_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildShopOrderDeliveryIncidentAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'shop_order_delivery_incident') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const signalLabels = Array.isArray(payload.signal_labels)
        ? payload.signal_labels.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const hotProducts = Array.isArray(payload.hot_products)
        ? payload.hot_products.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const hotErrors = Array.isArray(payload.hot_errors)
        ? payload.hot_errors.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const orderRefs = Array.isArray(payload.order_refs)
        ? payload.order_refs.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const lines = [
        `[商城履约事故][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '商城履约异常升级'}`
    ];

    if (signalLabels.length) lines.push(`升级信号：${signalLabels.join('；')}`);
    if (
        Number.isFinite(Number(payload.incident_order_count))
        || Number.isFinite(Number(payload.dead_letter_count))
        || Number.isFinite(Number(payload.retry_waiting_count))
    ) {
        lines.push(`异常订单：${Math.max(0, Math.round(Number(payload.incident_order_count || 0)))} 笔（死信 ${Math.max(0, Math.round(Number(payload.dead_letter_count || 0)))} / 重试 ${Math.max(0, Math.round(Number(payload.retry_waiting_count || 0)))}）`);
    }
    if (Number.isFinite(Number(payload.distinct_user_count))) {
        lines.push(`受影响用户：${Math.max(0, Math.round(Number(payload.distinct_user_count || 0)))} 位`);
    }
    if (Number.isFinite(Number(payload.distinct_product_count))) {
        lines.push(`涉及商品：${Math.max(0, Math.round(Number(payload.distinct_product_count || 0)))} 个`);
    }
    if (hotProducts.length) lines.push(`热点商品：${hotProducts.join('、')}`);
    if (hotErrors.length) lines.push(`热点错误：${hotErrors.join('；')}`);
    if (orderRefs.length) lines.push(`示例订单：${orderRefs.join('、')}`);
    if (normalizeText(payload.latest_failure_at)) lines.push(`最近异常时间：${formatTimestamp(payload.latest_failure_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildShopOrderDeliveryIncidentRecoveredAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'shop_order_delivery_incident_recovered') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const activeProducts = Array.isArray(payload.active_products)
        ? payload.active_products.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const activeErrors = Array.isArray(payload.active_errors)
        ? payload.active_errors.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const lines = [
        `[商城履约事故恢复][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '商城履约事故已恢复'}`
    ];

    if (normalizeText(payload.recovery_summary)) lines.push(`恢复结论：${normalizeText(payload.recovery_summary)}`);
    if (normalizeText(payload.incident_started_at)) lines.push(`上次升级：${formatTimestamp(payload.incident_started_at)}`);
    if (normalizeText(payload.incident_recovered_at)) lines.push(`恢复时间：${formatTimestamp(payload.incident_recovered_at)}`);
    if (Number.isFinite(Number(payload.incident_duration_minutes))) {
        lines.push(`持续时长：${Math.max(0, Math.round(Number(payload.incident_duration_minutes || 0)))} 分钟`);
    }
    if (
        Number.isFinite(Number(payload.previous_incident_order_count))
        || Number.isFinite(Number(payload.previous_dead_letter_count))
        || Number.isFinite(Number(payload.previous_retry_waiting_count))
    ) {
        lines.push(`上次事故规模：${Math.max(0, Math.round(Number(payload.previous_incident_order_count || 0)))} 笔（死信 ${Math.max(0, Math.round(Number(payload.previous_dead_letter_count || 0)))} / 重试 ${Math.max(0, Math.round(Number(payload.previous_retry_waiting_count || 0)))}）`);
    }
    if (
        Number.isFinite(Number(payload.active_order_count))
        || Number.isFinite(Number(payload.active_dead_letter_count))
        || Number.isFinite(Number(payload.active_retry_waiting_count))
    ) {
        lines.push(`当前剩余异常：${Math.max(0, Math.round(Number(payload.active_order_count || 0)))} 笔（死信 ${Math.max(0, Math.round(Number(payload.active_dead_letter_count || 0)))} / 重试 ${Math.max(0, Math.round(Number(payload.active_retry_waiting_count || 0)))}）`);
    }
    if (Number.isFinite(Number(payload.active_user_count))) {
        lines.push(`当前受影响用户：${Math.max(0, Math.round(Number(payload.active_user_count || 0)))} 位`);
    }
    if (activeProducts.length) lines.push(`当前热点商品：${activeProducts.join('、')}`);
    if (activeErrors.length) lines.push(`当前热点错误：${activeErrors.join('；')}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildShopOrderDeliveryRecoveredAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'shop_order_delivery_recovered') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const lines = [
        `[商城履约恢复][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '订单履约已恢复'}`
    ];

    if (normalizeText(payload.order_id)) lines.push(`订单号：${normalizeText(payload.order_id)}`);
    if (normalizeText(payload.product_name)) lines.push(`商品：${normalizeText(payload.product_name)}`);
    if (normalizeText(payload.user_id)) lines.push(`用户ID：${normalizeText(payload.user_id)}`);
    if (Number.isFinite(Number(payload.item_count))) lines.push(`购买数量：${Math.max(1, Math.round(Number(payload.item_count || 1)))} 件`);
    if (Number.isFinite(Number(payload.total_price)) || Number.isFinite(Number(payload.price_paid))) {
        lines.push(`订单金额：${formatCurrencyAmount(payload.total_price ?? payload.price_paid)}`);
    }
    if (normalizeText(payload.recovery_summary)) lines.push(`恢复结论：${normalizeText(payload.recovery_summary)}`);
    if (normalizeText(payload.previous_delivery_status)) {
        lines.push(`上次异常状态：${normalizeText(payload.previous_delivery_status_label) || getShopDeliveryStatusLabel(payload.previous_delivery_status)}`);
    }
    if (Number.isFinite(Number(payload.previous_delivery_attempt_count))) {
        lines.push(`上次失败次数：${Math.max(0, Math.round(Number(payload.previous_delivery_attempt_count || 0)))}`);
    }
    if (normalizeText(payload.delivery_status)) lines.push(`当前履约状态：${normalizeText(payload.delivery_status_label) || getShopDeliveryStatusLabel(payload.delivery_status)}`);
    if (normalizeText(payload.refund_status)) lines.push(`退款状态：${normalizeText(payload.refund_status_label) || getRefundStatusLabel(payload.refund_status)}`);
    if (normalizeText(payload.incident_started_at)) lines.push(`上次异常：${formatTimestamp(payload.incident_started_at)}`);
    if (normalizeText(payload.delivery_updated_at)) lines.push(`最近履约更新时间：${formatTimestamp(payload.delivery_updated_at)}`);
    if (normalizeText(payload.incident_recovered_at)) lines.push(`恢复时间：${formatTimestamp(payload.incident_recovered_at)}`);
    if (Number.isFinite(Number(payload.incident_duration_minutes))) {
        lines.push(`持续时长：${Math.max(0, Math.round(Number(payload.incident_duration_minutes || 0)))} 分钟`);
    }
    if (normalizeText(payload.previous_delivery_last_error)) lines.push(`上次错误：${normalizeText(payload.previous_delivery_last_error)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function getShopOrderRiskSignalLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    const labelMap = {
        discount_code_spike: '优惠码高频使用',
        zero_total_cluster: '0 价订单聚集',
        user_velocity: '账号短时扫货',
        shared_login_ip_cluster: '共享登录 IP 多账号下单',
        shared_login_signature_cluster: '共享登录签名多账号下单'
    };
    return labelMap[normalized] || normalized;
}

function getShopOrderRiskLevelLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    const labelMap = {
        medium: '中',
        high: '高',
        critical: '紧急'
    };
    return labelMap[normalized] || normalized || '中';
}

function getShopOrderRiskActionLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    const labelMap = {
        'disable-coupon': '停用优惠码',
        'open-user-ban': '发起封禁处理',
        'review-orders': '复核风险订单'
    };
    return labelMap[normalized] || normalized;
}

function buildShopOrderRiskAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'shop_order_risk_anomaly') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const sampleProducts = normalizeStringArray(payload.sample_products);
    const sampleUsers = normalizeStringArray(payload.sample_users);
    const siteLabels = normalizeStringArray(payload.site_labels);
    const hotDiscountCodes = normalizeStringArray(payload.hot_discount_codes);
    const orderRefs = normalizeStringArray(payload.order_refs);
    const lines = [
        `[商城风控告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '商城风险异常'}`
    ];

    if (normalizeText(payload.signal_type)) lines.push(`风险类型：${getShopOrderRiskSignalLabel(payload.signal_type)}`);
    if (normalizeText(payload.risk_level)) {
        const riskScore = Number(payload.risk_score);
        lines.push(`风险等级：${getShopOrderRiskLevelLabel(payload.risk_level)}${Number.isFinite(riskScore) ? ` (${Math.round(riskScore)} 分)` : ''}`);
    }
    if (normalizeText(payload.discount_code)) lines.push(`优惠码：${normalizeText(payload.discount_code)}`);
    if (normalizeText(payload.buyer_label)) {
        lines.push(`账号：${normalizeText(payload.buyer_label)}`);
    } else if (normalizeText(payload.user_id)) {
        lines.push(`用户ID：${normalizeText(payload.user_id)}`);
    }
    if (normalizeText(payload.client_ip)) {
        lines.push(`共享登录 IP：${normalizeText(payload.client_ip)}`);
    }
    if (normalizeText(payload.login_signature_label)) {
        lines.push(`共享登录签名：${normalizeText(payload.login_signature_label)}`);
    } else if (normalizeText(payload.user_agent_summary)) {
        lines.push(`设备摘要：${normalizeText(payload.user_agent_summary)}`);
    }
    if (Number.isFinite(Number(payload.order_count))) {
        lines.push(`命中订单：${Math.max(0, Math.round(Number(payload.order_count || 0)))} 笔`);
    }
    if (Number.isFinite(Number(payload.distinct_user_count))) {
        lines.push(`涉及账号：${Math.max(0, Math.round(Number(payload.distinct_user_count || 0)))} 个`);
    }
    if (Number.isFinite(Number(payload.total_quantity))) {
        lines.push(`累计数量：${Math.max(0, Math.round(Number(payload.total_quantity || 0)))} 件`);
    }
    if (Number.isFinite(Number(payload.distinct_product_count))) {
        lines.push(`涉及商品：${Math.max(0, Math.round(Number(payload.distinct_product_count || 0)))} 个`);
    }
    if (Number.isFinite(Number(payload.zero_total_count))) {
        lines.push(`0 价订单：${Math.max(0, Math.round(Number(payload.zero_total_count || 0)))} 笔`);
    }
    if (Number.isFinite(Number(payload.total_order_value))) {
        lines.push(`窗口原价合计：${formatCurrencyAmount(payload.total_order_value)}`);
    }
    if (Number.isFinite(Number(payload.window_minutes))) {
        lines.push(`统计窗口：${Math.max(1, Math.round(Number(payload.window_minutes || 0)))} 分钟`);
    }
    if (normalizeText(payload.auto_response_summary)) lines.push(`自动处置：${normalizeText(payload.auto_response_summary)}`);
    if (normalizeText(payload.response_summary)) lines.push(`建议动作：${normalizeText(payload.response_summary)}`);
    if (normalizeText(payload.primary_action)) lines.push(`首选处置：${getShopOrderRiskActionLabel(payload.primary_action)}`);
    if (siteLabels.length) lines.push(`涉及站点：${siteLabels.join('、')}`);
    if (hotDiscountCodes.length) lines.push(`热点优惠码：${hotDiscountCodes.join('、')}`);
    if (sampleProducts.length) lines.push(`热点商品：${sampleProducts.join('、')}`);
    if (sampleUsers.length) lines.push(`示例账号：${sampleUsers.join('、')}`);
    if (orderRefs.length) lines.push(`示例订单：${orderRefs.join('、')}`);
    if (normalizeText(payload.latest_order_at)) lines.push(`最近下单时间：${formatTimestamp(payload.latest_order_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildShopOrderRiskRecoveredAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'shop_order_risk_recovered') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const hotDiscountCodes = normalizeStringArray(payload.previous_hot_discount_codes);
    const sampleProducts = normalizeStringArray(payload.previous_sample_products);
    const lines = [
        `[商城风控恢复][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '商城风险已恢复'}`
    ];

    if (normalizeText(payload.signal_type)) lines.push(`风险类型：${getShopOrderRiskSignalLabel(payload.signal_type)}`);
    if (normalizeText(payload.recovery_summary)) lines.push(`恢复结论：${normalizeText(payload.recovery_summary)}`);
    if (normalizeText(payload.discount_code)) lines.push(`优惠码：${normalizeText(payload.discount_code)}`);
    if (normalizeText(payload.buyer_label)) {
        lines.push(`账号：${normalizeText(payload.buyer_label)}`);
    } else if (normalizeText(payload.user_id)) {
        lines.push(`用户ID：${normalizeText(payload.user_id)}`);
    }
    if (normalizeText(payload.previous_risk_level)) {
        const previousRiskScore = Number(payload.previous_risk_score);
        lines.push(`上次风险等级：${getShopOrderRiskLevelLabel(payload.previous_risk_level)}${Number.isFinite(previousRiskScore) ? ` (${Math.round(previousRiskScore)} 分)` : ''}`);
    }
    if (normalizeText(payload.client_ip)) {
        lines.push(`共享登录 IP：${normalizeText(payload.client_ip)}`);
    }
    if (normalizeText(payload.login_signature_label)) {
        lines.push(`共享登录签名：${normalizeText(payload.login_signature_label)}`);
    } else if (normalizeText(payload.user_agent_summary)) {
        lines.push(`设备摘要：${normalizeText(payload.user_agent_summary)}`);
    }
    if (Number.isFinite(Number(payload.previous_order_count))) {
        lines.push(`上次命中订单：${Math.max(0, Math.round(Number(payload.previous_order_count || 0)))} 笔`);
    }
    if (Number.isFinite(Number(payload.previous_distinct_user_count))) {
        lines.push(`上次涉及账号：${Math.max(0, Math.round(Number(payload.previous_distinct_user_count || 0)))} 个`);
    }
    if (Number.isFinite(Number(payload.previous_total_quantity))) {
        lines.push(`上次累计数量：${Math.max(0, Math.round(Number(payload.previous_total_quantity || 0)))} 件`);
    }
    if (Number.isFinite(Number(payload.previous_zero_total_count))) {
        lines.push(`上次 0 价订单：${Math.max(0, Math.round(Number(payload.previous_zero_total_count || 0)))} 笔`);
    }
    if (hotDiscountCodes.length) lines.push(`上次热点优惠码：${hotDiscountCodes.join('、')}`);
    if (sampleProducts.length) lines.push(`上次热点商品：${sampleProducts.join('、')}`);
    if (normalizeText(payload.previous_auto_response_summary)) lines.push(`上次自动处置：${normalizeText(payload.previous_auto_response_summary)}`);
    if (normalizeText(payload.previous_response_summary)) lines.push(`上次建议动作：${normalizeText(payload.previous_response_summary)}`);
    if (normalizeText(payload.previous_primary_action)) lines.push(`上次首选处置：${getShopOrderRiskActionLabel(payload.previous_primary_action)}`);
    if (normalizeText(payload.incident_started_at)) lines.push(`上次异常：${formatTimestamp(payload.incident_started_at)}`);
    if (normalizeText(payload.incident_recovered_at)) lines.push(`恢复时间：${formatTimestamp(payload.incident_recovered_at)}`);
    if (Number.isFinite(Number(payload.incident_duration_minutes))) {
        lines.push(`持续时长：${Math.max(0, Math.round(Number(payload.incident_duration_minutes || 0)))} 分钟`);
    }
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildAdminLoginAnomalyAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'security_admin_login_anomaly') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const reasons = Array.isArray(payload.detected_reasons)
        ? payload.detected_reasons.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const previousIps = Array.isArray(payload.previous_ips)
        ? payload.previous_ips.map((item) => normalizeText(item)).filter(Boolean)
        : [];
    const lines = [
        `[管理员安全告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '管理员异常登录'}`
    ];

    if (normalizeText(payload.admin_email)) lines.push(`管理员：${normalizeText(payload.admin_email)}`);
    if (normalizeText(payload.client_ip)) lines.push(`登录 IP：${normalizeText(payload.client_ip)}`);
    if (normalizeText(payload.user_agent)) lines.push(`设备指纹：${normalizeText(payload.user_agent)}`);
    if (reasons.length) lines.push(`判定信号：${reasons.join('；')}`);
    if (Number.isFinite(Number(payload.recent_distinct_ip_count))) lines.push(`最近窗口内 IP 数：${Math.max(0, Math.round(Number(payload.recent_distinct_ip_count || 0)))}`);
    if (Number.isFinite(Number(payload.recent_distinct_user_agent_count))) lines.push(`最近窗口内设备数：${Math.max(0, Math.round(Number(payload.recent_distinct_user_agent_count || 0)))}`);
    if (previousIps.length) lines.push(`历史常用 IP：${previousIps.join('、')}`);
    if (normalizeText(payload.origin)) lines.push(`Origin：${normalizeText(payload.origin)}`);
    if (normalizeText(payload.referer)) lines.push(`Referer：${normalizeText(payload.referer)}`);
    if (normalizeText(payload.occurred_at)) lines.push(`发生时间：${formatTimestamp(payload.occurred_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

async function postJson(url, body, {
    timeoutMs = DEFAULT_OPS_ALERTS_CONFIG.timeout_ms,
    fetchImpl = global.fetch,
    headers = {}
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Fetch is unavailable');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || DEFAULT_OPS_ALERTS_CONFIG.timeout_ms)));

    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                ...headers
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        const rawText = await response.text().catch(() => '');
        return {
            ok: response.ok,
            status: response.status,
            body: rawText
        };
    } finally {
        clearTimeout(timer);
    }
}

function buildEmailAlertSubject(job = {}, runtime = {}) {
    const prefix = normalizeText(runtime?.config?.channels?.email?.subject_prefix)
        || DEFAULT_OPS_ALERTS_CONFIG.channels.email.subject_prefix;
    const severity = normalizeSeverity(job?.severity, 'warning').toUpperCase();
    const title = normalizeText(job?.title) || normalizeText(job?.alert_type) || '系统告警';
    return [prefix, `[${severity}]`, title].filter(Boolean).join(' ');
}

async function sendTelegramAlert(job, runtime, options = {}) {
    const token = normalizeText(runtime?.secrets?.telegram_bot_token);
    const chatIds = normalizeStringArray(runtime?.config?.channels?.telegram?.chat_ids);
    if (!token || !chatIds.length) {
        return {
            ok: false,
            status: 0,
            error: 'telegram_not_configured'
        };
    }

    const text = buildExternalAlertText(job);
    const results = [];
    for (const chatId of chatIds) {
        const result = await postJson(
            `https://api.telegram.org/bot${token}/sendMessage`,
            {
                chat_id: chatId,
                text,
                disable_web_page_preview: true
            },
            options
        );
        results.push({
            chatId,
            ...result
        });
    }

    return {
        ok: results.every((item) => item.ok),
        status: results.every((item) => item.ok) ? 200 : Math.max(...results.map((item) => Number(item.status || 0))),
        body: JSON.stringify(results)
    };
}

async function sendFeishuAlert(job, runtime, options = {}) {
    const webhookUrl = normalizeText(runtime?.secrets?.feishu_webhook_url);
    if (!webhookUrl) {
        return {
            ok: false,
            status: 0,
            error: 'feishu_not_configured'
        };
    }

    const result = await postJson(
        webhookUrl,
        {
            msg_type: 'text',
            content: {
                text: buildExternalAlertText(job)
            }
        },
        options
    );

    if (result.ok) {
        const body = normalizeText(result.body, 4000);
        if (body) {
            try {
                const parsed = JSON.parse(body);
                const code = Number(parsed?.code ?? parsed?.StatusCode);
                if (Number.isFinite(code) && code !== 0) {
                    return {
                        ok: false,
                        status: result.status,
                        body: result.body,
                        error: normalizeText(parsed?.msg || parsed?.StatusMessage || parsed?.message) || `feishu_error_${code}`
                    };
                }
            } catch (error) {
                // Keep HTTP success semantics for non-JSON webhook responses.
            }
        }
    }

    return result;
}

async function sendEmailAlert(job, runtime, options = {}) {
    const apiKey = normalizeText(runtime?.secrets?.email_api_key);
    const recipients = normalizeStringArray(runtime?.config?.channels?.email?.recipients);
    const fromAddress = normalizeText(runtime?.config?.channels?.email?.from_address);
    const replyTo = normalizeText(runtime?.config?.channels?.email?.reply_to);

    if (!apiKey || !recipients.length || !fromAddress) {
        return {
            ok: false,
            status: 0,
            error: 'email_not_configured'
        };
    }

    const payload = {
        from: fromAddress,
        to: recipients,
        subject: buildEmailAlertSubject(job, runtime),
        text: buildExternalAlertText(job)
    };
    if (replyTo) {
        payload.reply_to = replyTo;
    }

    return postJson(
        'https://api.resend.com/emails',
        payload,
        {
            ...options,
            headers: {
                Authorization: `Bearer ${apiKey}`
            }
        }
    );
}

async function recordOpsAlertAttempt(supabase, {
    jobId,
    channel,
    status,
    responseStatus,
    responseBody,
    errorMessage
}) {
    if (!supabase?.from || !normalizeText(jobId) || !normalizeText(channel)) {
        return;
    }

    try {
        await supabase
            .from('ops_alert_job_attempts')
            .insert({
                job_id: jobId,
                channel: normalizeChannelName(channel) || normalizeText(channel),
                status: normalizeText(status) || 'failed',
                response_status: Number.isFinite(Number(responseStatus)) ? Number(responseStatus) : null,
                response_body: normalizeText(responseBody).slice(0, 2000) || null,
                error_message: normalizeText(errorMessage).slice(0, 1000) || null
            });
    } catch (error) {
        console.warn('[ops-alerts] failed to record attempt:', error.message);
    }
}

async function claimOpsAlertJobs(supabase, options = {}) {
    if (!supabase?.from) return [];

    const batchSize = normalizeNumber(
        options.batchSize,
        DEFAULT_OPS_ALERTS_CONFIG.batch_size,
        1,
        50
    );
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
        .from('ops_alert_jobs')
        .select('*')
        .in('status', ['pending', 'retry'])
        .lte('next_retry_at', nowIso)
        .order('created_at', { ascending: true })
        .limit(batchSize);

    if (error) {
        throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    const claimed = [];

    for (const row of rows) {
        const nextAttemptCount = normalizeNumber(row.attempt_count, 0, 0, 1000) + 1;
        const { data: updated, error: updateError } = await supabase
            .from('ops_alert_jobs')
            .update({
                status: 'processing',
                attempt_count: nextAttemptCount,
                last_attempt_at: nowIso,
                last_error: null,
                updated_at: nowIso,
                worker_name: normalizeText(options.workerName) || null
            })
            .eq('id', row.id)
            .in('status', ['pending', 'retry'])
            .select('*')
            .single();

        if (updateError) {
            continue;
        }

        claimed.push(updated || {
            ...row,
            status: 'processing',
            attempt_count: nextAttemptCount,
            last_attempt_at: nowIso
        });
    }

    return claimed;
}

async function markOpsAlertJobDelivered(supabase, job) {
    const nowIso = new Date().toISOString();
    const { error } = await supabase
        .from('ops_alert_jobs')
        .update({
            status: 'delivered',
            remaining_channels: [],
            delivered_at: nowIso,
            last_error: null,
            updated_at: nowIso
        })
        .eq('id', job.id);

    if (error) {
        throw error;
    }
}

async function markOpsAlertJobRetry(supabase, job, failedChannels, errorMessage, config = {}) {
    const attempts = normalizeNumber(job.attempt_count, 1, 1, 1000);
    const maxAttempts = normalizeNumber(job.max_attempts, DEFAULT_OPS_ALERTS_CONFIG.max_attempts, 1, 1000);
    const exhausted = attempts >= maxAttempts;
    const { error } = await supabase
        .from('ops_alert_jobs')
        .update({
            status: exhausted ? 'dead_letter' : 'retry',
            remaining_channels: failedChannels,
            next_retry_at: exhausted ? null : getNextRetryAt(attempts, config),
            last_error: normalizeText(errorMessage).slice(0, 1000) || null,
            updated_at: new Date().toISOString()
        })
        .eq('id', job.id);

    if (error) {
        throw error;
    }
}

async function processOpsAlertJob(supabase, job, runtime, options = {}) {
    const remainingChannels = normalizeStringArray(
        Array.isArray(job.remaining_channels) && job.remaining_channels.length
            ? job.remaining_channels
            : job.channels
    );
    if (!remainingChannels.length) {
        await markOpsAlertJobDelivered(supabase, job);
        return {
            delivered: true,
            remaining: []
        };
    }

    const failedChannels = [];
    const failureMessages = [];

    for (const channel of remainingChannels) {
        let result = null;

        try {
            if (channel === 'telegram') {
                result = await sendTelegramAlert(job, runtime, options);
            } else if (channel === 'feishu') {
                result = await sendFeishuAlert(job, runtime, options);
            } else if (channel === 'email') {
                result = await sendEmailAlert(job, runtime, options);
            } else {
                result = {
                    ok: false,
                    status: 0,
                    error: 'unsupported_channel'
                };
            }
        } catch (error) {
            result = {
                ok: false,
                status: 0,
                error: error.message || 'delivery_failed'
            };
        }

        await recordOpsAlertAttempt(supabase, {
            jobId: job.id,
            channel,
            status: result?.ok ? 'delivered' : 'failed',
            responseStatus: result?.status || null,
            responseBody: result?.body || null,
            errorMessage: result?.error || null
        });

        if (!result?.ok) {
            failedChannels.push(channel);
            failureMessages.push(`${channel}: ${normalizeText(result?.error) || `HTTP ${result?.status || 0}`}`);
        }
    }

    if (!failedChannels.length) {
        await markOpsAlertJobDelivered(supabase, job);
        return {
            delivered: true,
            remaining: []
        };
    }

    await markOpsAlertJobRetry(
        supabase,
        job,
        failedChannels,
        failureMessages.join(' | '),
        runtime?.config || {}
    );

    return {
        delivered: false,
        remaining: failedChannels
    };
}

async function sweepOpsAlertJobs(supabase, options = {}) {
    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, options.env);
    if (!runtime.config.enabled) {
        return {
            claimed: 0,
            delivered: 0,
            retried: 0
        };
    }

    const claimedJobs = await claimOpsAlertJobs(supabase, {
        batchSize: runtime.config.batch_size,
        workerName: options.workerName
    });
    let delivered = 0;
    let retried = 0;

    for (const job of claimedJobs) {
        const result = await processOpsAlertJob(supabase, job, runtime, options);
        if (result.delivered) {
            delivered += 1;
        } else {
            retried += 1;
        }
    }

    return {
        claimed: claimedJobs.length,
        delivered,
        retried
    };
}

module.exports = {
    DEFAULT_OPS_ALERTS_CONFIG,
    OPS_ALERTS_CONFIG_KEY,
    OPS_ALERT_SECRET_KEYS: getOpsAlertSecretKeys(),
    buildOpsAlertDedupeKey,
    buildOpsAlertSecretStatus,
    claimOpsAlertJobs,
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig,
    normalizeOpsAlertsConfig,
    processOpsAlertJob,
    resolveEnabledChannels,
    sendEmailAlert,
    sendFeishuAlert,
    sendTelegramAlert,
    sweepOpsAlertJobs,
    __testUtils: {
        buildExternalAlertText,
        getOpsAlertSecretKeys,
        getNextRetryAt,
        getRetryDelayMs,
        hasRecentOpsAlertJob,
        normalizeChannelName,
        resolveEnabledChannels,
        normalizeSeverity,
        normalizeStringArray,
        recordOpsAlertAttempt,
        resolveOpsAlertSecrets,
        sendEmailAlert,
        sendFeishuAlert,
        sendTelegramAlert
    }
};
