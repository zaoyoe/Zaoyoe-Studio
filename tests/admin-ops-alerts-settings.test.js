const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function createMockResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
            return this;
        },
        end(payload = '') {
            state.body = String(payload || '');
            return this;
        },
        json() {
            return state.body ? JSON.parse(state.body) : {};
        },
        get statusCode() {
            return state.statusCode;
        },
        get headers() {
            return state.headers;
        }
    };
}

function createDefaultState() {
    return {
        user: { id: 'admin-user-1', email: 'admin@example.com' },
        config: {
            enabled: false,
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
                    customer_chat_message: { until: '', allow_critical: true },
                    shop_purchase_success: { until: '', allow_critical: true },
                    wallet_recharge_success: { until: '', allow_critical: true },
                    shop_inventory: { until: '', allow_critical: true }
                },
                modules: {
                    customer_engagement: { until: '', allow_critical: true },
                    commerce: { until: '', allow_critical: true },
                    inventory: { until: '', allow_critical: true },
                    payments: { until: '', allow_critical: true },
                    shop_risk: { until: '', allow_critical: true },
                    verify: { until: '', allow_critical: true },
                    tickets: { until: '', allow_critical: true },
                    fulfillment: { until: '', allow_critical: true },
                    security: { until: '', allow_critical: true }
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
            verify_quota: {
                enabled: true,
                sweep_interval_ms: 15 * 60 * 1000,
                request_timeout_ms: 10000,
                low_balance_threshold: 20,
                low_remaining_jobs_threshold: 20,
                critical_balance_threshold: 5,
                critical_remaining_jobs_threshold: 5,
                min_queue_buffer_jobs: 5,
                dedupe_window_minutes: 6 * 60
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
                max_pages: 10
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
                max_pages: 10
            }
        },
        secretStatus: {
            telegram_bot_token: { configured: false, source: 'missing', updatedAt: null },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null },
            email_api_key: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: '',
            feishu_webhook_url: '',
            email_api_key: ''
        },
        systemConfigUpserts: [],
        caseEvents: [],
        upsertedSecrets: [],
        deletedSecrets: [],
        auditLogs: [],
        telegramTests: [],
        feishuTests: [],
        emailTests: []
    };
}

function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
}

function normalizeSummaryScheduleMode(value, fallback = 'rolling_window') {
    const normalized = String(value ?? '').trim().toLowerCase();
    return ['rolling_window', 'hourly', 'daily'].includes(normalized) ? normalized : fallback;
}

function normalizeStringArray(value) {
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

function createNormalizedConfig(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const channels = source.channels && typeof source.channels === 'object' ? source.channels : {};
    const telegram = channels.telegram && typeof channels.telegram === 'object' ? channels.telegram : {};
    const feishu = channels.feishu && typeof channels.feishu === 'object' ? channels.feishu : {};
    const email = channels.email && typeof channels.email === 'object' ? channels.email : {};
    const temporaryMute = source.temporary_mute && typeof source.temporary_mute === 'object' ? source.temporary_mute : {};
    const quietHours = source.quiet_hours && typeof source.quiet_hours === 'object' ? source.quiet_hours : {};
    const muteRules = source.mute_rules && typeof source.mute_rules === 'object' ? source.mute_rules : {};
    const typeMuteRules = muteRules.types && typeof muteRules.types === 'object' ? muteRules.types : {};
    const moduleMuteRules = muteRules.modules && typeof muteRules.modules === 'object' ? muteRules.modules : {};
    const shopOrderRisk = source.shop_order_risk && typeof source.shop_order_risk === 'object' ? source.shop_order_risk : {};
    const shopInventory = source.shop_inventory && typeof source.shop_inventory === 'object' ? source.shop_inventory : {};
    const customerChatMessage = source.customer_chat_message && typeof source.customer_chat_message === 'object' ? source.customer_chat_message : {};
    const shopPurchaseSuccess = source.shop_purchase_success && typeof source.shop_purchase_success === 'object' ? source.shop_purchase_success : {};
    const walletRechargeSuccess = source.wallet_recharge_success && typeof source.wallet_recharge_success === 'object' ? source.wallet_recharge_success : {};
    const tickets = source.tickets && typeof source.tickets === 'object' ? source.tickets : {};
    const verifyQuota = source.verify_quota && typeof source.verify_quota === 'object' ? source.verify_quota : {};
    const verifyQueue = source.verify_queue && typeof source.verify_queue === 'object' ? source.verify_queue : {};
    const verifyFailure = source.verify_failure && typeof source.verify_failure === 'object' ? source.verify_failure : {};
    const routing = source.routing && typeof source.routing === 'object' ? source.routing : {};
    const routingCustomerChatMessage = routing.customer_chat_message && typeof routing.customer_chat_message === 'object' ? routing.customer_chat_message : {};
    const routingShopPurchaseSuccess = routing.shop_purchase_success && typeof routing.shop_purchase_success === 'object' ? routing.shop_purchase_success : {};
    const routingWalletRechargeSuccess = routing.wallet_recharge_success && typeof routing.wallet_recharge_success === 'object' ? routing.wallet_recharge_success : {};
    const routingShopInventory = routing.shop_inventory && typeof routing.shop_inventory === 'object' ? routing.shop_inventory : {};

    return {
        enabled: normalizeBoolean(source.enabled, false),
        temporary_mute: {
            until: typeof temporaryMute.until === 'string' ? temporaryMute.until.trim() : '',
            allow_critical: normalizeBoolean(temporaryMute.allow_critical, true)
        },
        quiet_hours: {
            enabled: normalizeBoolean(quietHours.enabled, false),
            start_hour: Math.min(23, Math.max(0, Number(quietHours.start_hour || 23) || 23)),
            end_hour: Math.min(23, Math.max(0, Number(quietHours.end_hour || 8) || 8)),
            timezone: String(quietHours.timezone || 'Asia/Shanghai').trim() || 'Asia/Shanghai',
            allow_critical: normalizeBoolean(quietHours.allow_critical, true)
        },
        work_hours: {
            enabled: normalizeBoolean(source.work_hours?.enabled, false),
            start_hour: Math.min(23, Math.max(0, Number(source.work_hours?.start_hour || 9) || 9)),
            end_hour: Math.min(23, Math.max(0, Number(source.work_hours?.end_hour || 18) || 18)),
            timezone: String(source.work_hours?.timezone || 'Asia/Shanghai').trim() || 'Asia/Shanghai'
        },
        mute_rules: {
            types: {
                customer_chat_message: {
                    until: typeof typeMuteRules.customer_chat_message?.until === 'string' ? typeMuteRules.customer_chat_message.until.trim() : '',
                    allow_critical: normalizeBoolean(typeMuteRules.customer_chat_message?.allow_critical, true)
                },
                shop_purchase_success: {
                    until: typeof typeMuteRules.shop_purchase_success?.until === 'string' ? typeMuteRules.shop_purchase_success.until.trim() : '',
                    allow_critical: normalizeBoolean(typeMuteRules.shop_purchase_success?.allow_critical, true)
                },
                wallet_recharge_success: {
                    until: typeof typeMuteRules.wallet_recharge_success?.until === 'string' ? typeMuteRules.wallet_recharge_success.until.trim() : '',
                    allow_critical: normalizeBoolean(typeMuteRules.wallet_recharge_success?.allow_critical, true)
                },
                shop_inventory: {
                    until: typeof typeMuteRules.shop_inventory?.until === 'string' ? typeMuteRules.shop_inventory.until.trim() : '',
                    allow_critical: normalizeBoolean(typeMuteRules.shop_inventory?.allow_critical, true)
                }
            },
            modules: {
                customer_engagement: {
                    until: typeof moduleMuteRules.customer_engagement?.until === 'string' ? moduleMuteRules.customer_engagement.until.trim() : '',
                    allow_critical: normalizeBoolean(moduleMuteRules.customer_engagement?.allow_critical, true)
                },
                commerce: {
                    until: typeof moduleMuteRules.commerce?.until === 'string' ? moduleMuteRules.commerce.until.trim() : '',
                    allow_critical: normalizeBoolean(moduleMuteRules.commerce?.allow_critical, true)
                },
                inventory: {
                    until: typeof moduleMuteRules.inventory?.until === 'string' ? moduleMuteRules.inventory.until.trim() : '',
                    allow_critical: normalizeBoolean(moduleMuteRules.inventory?.allow_critical, true)
                },
                payments: {
                    until: typeof moduleMuteRules.payments?.until === 'string' ? moduleMuteRules.payments.until.trim() : '',
                    allow_critical: normalizeBoolean(moduleMuteRules.payments?.allow_critical, true)
                },
                shop_risk: {
                    until: typeof moduleMuteRules.shop_risk?.until === 'string' ? moduleMuteRules.shop_risk.until.trim() : '',
                    allow_critical: normalizeBoolean(moduleMuteRules.shop_risk?.allow_critical, true)
                },
                verify: {
                    until: typeof moduleMuteRules.verify?.until === 'string' ? moduleMuteRules.verify.until.trim() : '',
                    allow_critical: normalizeBoolean(moduleMuteRules.verify?.allow_critical, true)
                },
                tickets: {
                    until: typeof moduleMuteRules.tickets?.until === 'string' ? moduleMuteRules.tickets.until.trim() : '',
                    allow_critical: normalizeBoolean(moduleMuteRules.tickets?.allow_critical, true)
                },
                fulfillment: {
                    until: typeof moduleMuteRules.fulfillment?.until === 'string' ? moduleMuteRules.fulfillment.until.trim() : '',
                    allow_critical: normalizeBoolean(moduleMuteRules.fulfillment?.allow_critical, true)
                },
                security: {
                    until: typeof moduleMuteRules.security?.until === 'string' ? moduleMuteRules.security.until.trim() : '',
                    allow_critical: normalizeBoolean(moduleMuteRules.security?.allow_critical, true)
                }
            }
        },
        channels: {
            telegram: {
                enabled: normalizeBoolean(telegram.enabled, false),
                minimum_severity: ['info', 'warning', 'critical'].includes(String(telegram.minimum_severity || '').trim())
                    ? String(telegram.minimum_severity).trim()
                    : 'warning',
                chat_ids: normalizeStringArray(telegram.chat_ids)
            },
            feishu: {
                enabled: normalizeBoolean(feishu.enabled, false),
                minimum_severity: ['info', 'warning', 'critical'].includes(String(feishu.minimum_severity || '').trim())
                    ? String(feishu.minimum_severity).trim()
                    : 'warning'
            },
            email: {
                enabled: normalizeBoolean(email.enabled, false),
                minimum_severity: ['info', 'warning', 'critical'].includes(String(email.minimum_severity || '').trim())
                    ? String(email.minimum_severity).trim()
                    : 'warning',
                recipients: normalizeStringArray(email.recipients),
                from_address: String(email.from_address || '').trim(),
                reply_to: String(email.reply_to || '').trim(),
                subject_prefix: String(email.subject_prefix || '').trim() || '[Zaoyoe告警]'
            }
        },
        routing: {
            customer_chat_message: {
                telegram: normalizeBoolean(routingCustomerChatMessage.telegram, true),
                feishu: normalizeBoolean(routingCustomerChatMessage.feishu, true),
                email: normalizeBoolean(routingCustomerChatMessage.email, true)
            },
            shop_purchase_success: {
                telegram: normalizeBoolean(routingShopPurchaseSuccess.telegram, true),
                feishu: normalizeBoolean(routingShopPurchaseSuccess.feishu, true),
                email: normalizeBoolean(routingShopPurchaseSuccess.email, true)
            },
            wallet_recharge_success: {
                telegram: normalizeBoolean(routingWalletRechargeSuccess.telegram, true),
                feishu: normalizeBoolean(routingWalletRechargeSuccess.feishu, true),
                email: normalizeBoolean(routingWalletRechargeSuccess.email, true)
            },
            shop_inventory: {
                telegram: normalizeBoolean(routingShopInventory.telegram, true),
                feishu: normalizeBoolean(routingShopInventory.feishu, true),
                email: normalizeBoolean(routingShopInventory.email, true)
            }
        },
        shop_order_risk: {
            auto_response_enabled: normalizeBoolean(shopOrderRisk.auto_response_enabled, true),
            auto_disable_coupon_min_risk_score: Math.min(99, Math.max(65, Number(shopOrderRisk.auto_disable_coupon_min_risk_score || 90) || 90)),
            auto_ban_user_min_risk_score: Math.min(99, Math.max(80, Number(shopOrderRisk.auto_ban_user_min_risk_score || 96) || 96)),
            auto_ban_user_duration_days: Math.min(30, Math.max(1, Number(shopOrderRisk.auto_ban_user_duration_days || 7) || 7)),
            auto_suspend_product_min_risk_score: Math.min(99, Math.max(85, Number(shopOrderRisk.auto_suspend_product_min_risk_score || 97) || 97))
        },
        shop_inventory: {
            enabled: normalizeBoolean(shopInventory.enabled, true),
            low_stock_threshold: Math.min(10000, Math.max(0, Number(shopInventory.low_stock_threshold || 5) || 5)),
            sweep_interval_ms: Math.min(60 * 60 * 1000, Math.max(10000, Number(shopInventory.sweep_interval_ms || 15 * 60 * 1000) || (15 * 60 * 1000))),
            sales_window_days: Math.min(30, Math.max(1, Number(shopInventory.sales_window_days || 7) || 7)),
            dedupe_window_minutes: Math.min(24 * 60, Math.max(1, Number(shopInventory.dedupe_window_minutes || 6 * 60) || (6 * 60))),
            recovery_notification_enabled: normalizeBoolean(shopInventory.recovery_notification_enabled, true),
            summary_enabled: normalizeBoolean(shopInventory.summary_enabled, false),
            summary_window_minutes: Math.min(24 * 60, Math.max(5, Number(shopInventory.summary_window_minutes || 60) || 60)),
            summary_max_items: Math.min(50, Math.max(1, Number(shopInventory.summary_max_items || 10) || 10)),
            summary_schedule_mode: normalizeSummaryScheduleMode(shopInventory.summary_schedule_mode, 'rolling_window'),
            summary_hourly_minute: Math.min(59, Math.max(0, Number(shopInventory.summary_hourly_minute || 0) || 0)),
            summary_daily_hour: Math.min(23, Math.max(0, Number(shopInventory.summary_daily_hour ?? 9) || 9)),
            summary_daily_minute: Math.min(59, Math.max(0, Number(shopInventory.summary_daily_minute || 0) || 0))
        },
        customer_chat_message: {
            enabled: normalizeBoolean(customerChatMessage.enabled, true),
            sweep_interval_ms: Math.min(60 * 60 * 1000, Math.max(10000, Number(customerChatMessage.sweep_interval_ms || 60 * 1000) || (60 * 1000))),
            lookback_minutes: Math.min(24 * 60, Math.max(1, Number(customerChatMessage.lookback_minutes || 15) || 15)),
            dedupe_window_minutes: Math.min(7 * 24 * 60, Math.max(1, Number(customerChatMessage.dedupe_window_minutes || 12 * 60) || (12 * 60))),
            work_hours_only_enabled: normalizeBoolean(customerChatMessage.work_hours_only_enabled, false),
            summary_enabled: normalizeBoolean(customerChatMessage.summary_enabled, false),
            summary_window_minutes: Math.min(24 * 60, Math.max(5, Number(customerChatMessage.summary_window_minutes || 60) || 60)),
            summary_max_items: Math.min(50, Math.max(1, Number(customerChatMessage.summary_max_items || 10) || 10)),
            summary_schedule_mode: normalizeSummaryScheduleMode(customerChatMessage.summary_schedule_mode, 'rolling_window'),
            summary_hourly_minute: Math.min(59, Math.max(0, Number(customerChatMessage.summary_hourly_minute || 0) || 0)),
            summary_daily_hour: Math.min(23, Math.max(0, Number(customerChatMessage.summary_daily_hour ?? 9) || 9)),
            summary_daily_minute: Math.min(59, Math.max(0, Number(customerChatMessage.summary_daily_minute || 0) || 0))
        },
        shop_purchase_success: {
            enabled: normalizeBoolean(shopPurchaseSuccess.enabled, true),
            sweep_interval_ms: Math.min(60 * 60 * 1000, Math.max(10000, Number(shopPurchaseSuccess.sweep_interval_ms || 2 * 60 * 1000) || (2 * 60 * 1000))),
            lookback_minutes: Math.min(24 * 60, Math.max(1, Number(shopPurchaseSuccess.lookback_minutes || 30) || 30)),
            dedupe_window_minutes: Math.min(30 * 24 * 60, Math.max(1, Number(shopPurchaseSuccess.dedupe_window_minutes || 24 * 60) || (24 * 60))),
            work_hours_only_enabled: normalizeBoolean(shopPurchaseSuccess.work_hours_only_enabled, false),
            summary_enabled: normalizeBoolean(shopPurchaseSuccess.summary_enabled, false),
            summary_window_minutes: Math.min(24 * 60, Math.max(5, Number(shopPurchaseSuccess.summary_window_minutes || 60) || 60)),
            summary_max_items: Math.min(50, Math.max(1, Number(shopPurchaseSuccess.summary_max_items || 10) || 10)),
            summary_schedule_mode: normalizeSummaryScheduleMode(shopPurchaseSuccess.summary_schedule_mode, 'rolling_window'),
            summary_hourly_minute: Math.min(59, Math.max(0, Number(shopPurchaseSuccess.summary_hourly_minute || 0) || 0)),
            summary_daily_hour: Math.min(23, Math.max(0, Number(shopPurchaseSuccess.summary_daily_hour ?? 9) || 9)),
            summary_daily_minute: Math.min(59, Math.max(0, Number(shopPurchaseSuccess.summary_daily_minute || 0) || 0))
        },
        wallet_recharge_success: {
            enabled: normalizeBoolean(walletRechargeSuccess.enabled, true),
            sweep_interval_ms: Math.min(60 * 60 * 1000, Math.max(10000, Number(walletRechargeSuccess.sweep_interval_ms || 2 * 60 * 1000) || (2 * 60 * 1000))),
            lookback_minutes: Math.min(24 * 60, Math.max(1, Number(walletRechargeSuccess.lookback_minutes || 30) || 30)),
            dedupe_window_minutes: Math.min(30 * 24 * 60, Math.max(1, Number(walletRechargeSuccess.dedupe_window_minutes || 24 * 60) || (24 * 60))),
            work_hours_only_enabled: normalizeBoolean(walletRechargeSuccess.work_hours_only_enabled, false),
            summary_enabled: normalizeBoolean(walletRechargeSuccess.summary_enabled, false),
            summary_window_minutes: Math.min(24 * 60, Math.max(5, Number(walletRechargeSuccess.summary_window_minutes || 60) || 60)),
            summary_max_items: Math.min(50, Math.max(1, Number(walletRechargeSuccess.summary_max_items || 10) || 10)),
            summary_schedule_mode: normalizeSummaryScheduleMode(walletRechargeSuccess.summary_schedule_mode, 'rolling_window'),
            summary_hourly_minute: Math.min(59, Math.max(0, Number(walletRechargeSuccess.summary_hourly_minute || 0) || 0)),
            summary_daily_hour: Math.min(23, Math.max(0, Number(walletRechargeSuccess.summary_daily_hour ?? 9) || 9)),
            summary_daily_minute: Math.min(59, Math.max(0, Number(walletRechargeSuccess.summary_daily_minute || 0) || 0))
        },
        tickets: {
            enabled: normalizeBoolean(tickets.enabled, true),
            sweep_interval_ms: Math.min(60 * 60 * 1000, Math.max(10000, Number(tickets.sweep_interval_ms || 10 * 60 * 1000) || (10 * 60 * 1000))),
            pending_overdue_minutes: Math.min(14 * 24 * 60, Math.max(5, Number(tickets.pending_overdue_minutes || 120) || 120)),
            critical_overdue_minutes: Math.min(30 * 24 * 60, Math.max(30, Number(tickets.critical_overdue_minutes || 12 * 60) || (12 * 60))),
            state_lookback_minutes: Math.min(7 * 24 * 60, Math.max(30, Number(tickets.state_lookback_minutes || 24 * 60) || (24 * 60))),
            dedupe_window_minutes: Math.min(24 * 60, Math.max(1, Number(tickets.dedupe_window_minutes || 60) || 60)),
            page_size: Math.min(5000, Math.max(50, Number(tickets.page_size || 500) || 500)),
            max_pages: Math.min(100, Math.max(1, Number(tickets.max_pages || 10) || 10)),
            work_hours_only_enabled: normalizeBoolean(tickets.work_hours_only_enabled, false),
            summary_enabled: normalizeBoolean(tickets.summary_enabled, false),
            summary_window_minutes: Math.min(24 * 60, Math.max(5, Number(tickets.summary_window_minutes || 60) || 60)),
            summary_max_items: Math.min(50, Math.max(1, Number(tickets.summary_max_items || 10) || 10)),
            summary_schedule_mode: normalizeSummaryScheduleMode(tickets.summary_schedule_mode, 'rolling_window'),
            summary_hourly_minute: Math.min(59, Math.max(0, Number(tickets.summary_hourly_minute || 0) || 0)),
            summary_daily_hour: Math.min(23, Math.max(0, Number(tickets.summary_daily_hour ?? 9) || 9)),
            summary_daily_minute: Math.min(59, Math.max(0, Number(tickets.summary_daily_minute || 0) || 0))
        },
        verify_quota: {
            enabled: normalizeBoolean(verifyQuota.enabled, true),
            sweep_interval_ms: Math.min(60 * 60 * 1000, Math.max(10000, Number(verifyQuota.sweep_interval_ms || 15 * 60 * 1000) || (15 * 60 * 1000))),
            request_timeout_ms: Math.min(60 * 1000, Math.max(1000, Number(verifyQuota.request_timeout_ms || 10000) || 10000)),
            low_balance_threshold: Math.min(1000000, Math.max(0, Number(verifyQuota.low_balance_threshold || 20) || 20)),
            low_remaining_jobs_threshold: Math.min(1000000, Math.max(0, Number(verifyQuota.low_remaining_jobs_threshold || 20) || 20)),
            critical_balance_threshold: Math.min(1000000, Math.max(0, Number(verifyQuota.critical_balance_threshold || 5) || 5)),
            critical_remaining_jobs_threshold: Math.min(1000000, Math.max(0, Number(verifyQuota.critical_remaining_jobs_threshold || 5) || 5)),
            min_queue_buffer_jobs: Math.min(1000000, Math.max(0, Number(verifyQuota.min_queue_buffer_jobs || 5) || 5)),
            dedupe_window_minutes: Math.min(24 * 60, Math.max(1, Number(verifyQuota.dedupe_window_minutes || 6 * 60) || (6 * 60)))
        },
        verify_queue: {
            enabled: normalizeBoolean(verifyQueue.enabled, true),
            sweep_interval_ms: Math.min(60 * 60 * 1000, Math.max(10000, Number(verifyQueue.sweep_interval_ms || 10 * 60 * 1000) || (10 * 60 * 1000))),
            request_timeout_ms: Math.min(60 * 1000, Math.max(1000, Number(verifyQueue.request_timeout_ms || 10000) || 10000)),
            recent_activity_lookback_hours: Math.min(72, Math.max(1, Number(verifyQueue.recent_activity_lookback_hours || 12) || 12)),
            recent_failure_window_minutes: Math.min(24 * 60, Math.max(5, Number(verifyQueue.recent_failure_window_minutes || 30) || 30)),
            queue_size_threshold: Math.min(100000, Math.max(1, Number(verifyQueue.queue_size_threshold || 10) || 10)),
            active_job_threshold: Math.min(100000, Math.max(1, Number(verifyQueue.active_job_threshold || 8) || 8)),
            oldest_pending_minutes_threshold: Math.min(24 * 60, Math.max(1, Number(verifyQueue.oldest_pending_minutes_threshold || 20) || 20)),
            recent_failure_threshold: Math.min(100000, Math.max(1, Number(verifyQueue.recent_failure_threshold || 4) || 4)),
            dedupe_window_minutes: Math.min(24 * 60, Math.max(1, Number(verifyQueue.dedupe_window_minutes || 30) || 30)),
            page_size: Math.min(5000, Math.max(50, Number(verifyQueue.page_size || 500) || 500)),
            max_pages: Math.min(100, Math.max(1, Number(verifyQueue.max_pages || 10) || 10))
        },
        verify_failure: {
            enabled: normalizeBoolean(verifyFailure.enabled, true),
            sweep_interval_ms: Math.min(60 * 60 * 1000, Math.max(10000, Number(verifyFailure.sweep_interval_ms || 10 * 60 * 1000) || (10 * 60 * 1000))),
            recent_window_minutes: Math.min(24 * 60, Math.max(5, Number(verifyFailure.recent_window_minutes || 30) || 30)),
            min_total_jobs_threshold: Math.min(100000, Math.max(1, Number(verifyFailure.min_total_jobs_threshold || 6) || 6)),
            failure_rate_threshold: Math.min(100, Math.max(1, Number(verifyFailure.failure_rate_threshold || 60) || 60)),
            affected_user_threshold: Math.min(100000, Math.max(1, Number(verifyFailure.affected_user_threshold || 3) || 3)),
            dedupe_window_minutes: Math.min(24 * 60, Math.max(1, Number(verifyFailure.dedupe_window_minutes || 15) || 15)),
            page_size: Math.min(5000, Math.max(50, Number(verifyFailure.page_size || 500) || 500)),
            max_pages: Math.min(100, Math.max(1, Number(verifyFailure.max_pages || 10) || 10))
        }
    };
}

function createMockSupabase(state) {
    return {
        from(table) {
            if (table === 'system_config') {
                return {
                    async upsert(payload) {
                        state.systemConfigUpserts.push(cloneValue(payload));
                        if (payload.config_key === 'ops_alerts') {
                            state.config = createNormalizedConfig(payload.config_value);
                        }
                        return { error: null };
                    }
                };
            }

            if (table === 'ops_alert_case_events') {
                return {
                    insert(payload) {
                        const rows = (Array.isArray(payload) ? payload : [payload]).map((item, index) => ({
                            id: item.id || `event-${state.caseEvents.length + index + 1}`,
                            created_at: item.created_at || '2026-03-28T09:00:00.000Z',
                            ...cloneValue(item)
                        }));
                        state.caseEvents.push(...rows);
                        return {
                            select() {
                                return Promise.resolve({
                                    data: rows,
                                    error: null
                                });
                            }
                        };
                    }
                };
            }

            throw new Error(`Unexpected table access: ${table}`);
        }
    };
}

function createMockAdminModule(state) {
    return {
        async requireAdmin() {
            return {
                supabase: createMockSupabase(state),
                user: state.user
            };
        },
        async parseJsonBody(req) {
            return req.body || {};
        },
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        },
        async writeAdminAuditLog(entry) {
            state.auditLogs.push(cloneValue(entry));
        }
    };
}

function buildSecretStatus(state) {
    return {
        telegram_bot_token: { configured: false, source: 'missing', updatedAt: null },
        feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null },
        email_api_key: { configured: false, source: 'missing', updatedAt: null },
        ...cloneValue(state.secretStatus)
    };
}

async function withOpsAlertsSettingsHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/ops-alerts.js');
    const originalLoad = Module._load;
    const state = Object.assign(createDefaultState(), cloneValue(stateOverrides || {}));

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return createMockAdminModule(state);
        }

        if (request === '../../../../api/_lib/secrets') {
            const secretKeyMap = state.omitSecretKeyMap
                ? undefined
                : {
                    telegram_bot_token: 'ops_alert_telegram_bot_token',
                    feishu_webhook_url: 'ops_alert_feishu_webhook_url',
                    email_api_key: 'ops_alert_email_api_key'
                };
            return {
                OPS_ALERT_SECRET_KEYS: secretKeyMap,
                async upsertStoredAdminSecret({ secretKey, secretValue }) {
                    state.upsertedSecrets.push({ secretKey, secretValue });
                    if (secretKey === 'ops_alert_telegram_bot_token') {
                        state.runtimeSecrets.telegram_bot_token = secretValue;
                        state.secretStatus.telegram_bot_token = {
                            configured: true,
                            source: 'stored',
                            updatedAt: '2026-03-24T10:00:00.000Z'
                        };
                    }
                    if (secretKey === 'ops_alert_feishu_webhook_url') {
                        state.runtimeSecrets.feishu_webhook_url = secretValue;
                        state.secretStatus.feishu_webhook_url = {
                            configured: true,
                            source: 'stored',
                            updatedAt: '2026-03-24T10:00:00.000Z'
                        };
                    }
                    if (secretKey === 'ops_alert_email_api_key') {
                        state.runtimeSecrets.email_api_key = secretValue;
                        state.secretStatus.email_api_key = {
                            configured: true,
                            source: 'stored',
                            updatedAt: '2026-03-24T10:00:00.000Z'
                        };
                    }
                },
                async deleteStoredAdminSecret(_supabase, secretKey) {
                    state.deletedSecrets.push(secretKey);
                    if (secretKey === 'ops_alert_telegram_bot_token') {
                        state.runtimeSecrets.telegram_bot_token = '';
                        state.secretStatus.telegram_bot_token = {
                            configured: false,
                            source: 'missing',
                            updatedAt: null
                        };
                    }
                    if (secretKey === 'ops_alert_feishu_webhook_url') {
                        state.runtimeSecrets.feishu_webhook_url = '';
                        state.secretStatus.feishu_webhook_url = {
                            configured: false,
                            source: 'missing',
                            updatedAt: null
                        };
                    }
                    if (secretKey === 'ops_alert_email_api_key') {
                        state.runtimeSecrets.email_api_key = '';
                        state.secretStatus.email_api_key = {
                            configured: false,
                            source: 'missing',
                            updatedAt: null
                        };
                    }
                }
            };
        }

        if (request === '../../../../api/_lib/ops-alerts') {
            return {
                OPS_ALERTS_CONFIG_KEY: 'ops_alerts',
                normalizeOpsAlertsConfig(raw) {
                    return createNormalizedConfig(raw);
                },
                async loadOpsAlertsRuntimeConfig() {
                    return {
                        config: cloneValue(state.config),
                        secrets: cloneValue(state.runtimeSecrets)
                    };
                },
                buildOpsAlertSecretStatus() {
                    return buildSecretStatus(state);
                },
                async sendTelegramAlert(job, runtime) {
                    state.telegramTests.push({
                        job: cloneValue(job),
                        runtime: cloneValue(runtime)
                    });

                    return {
                        ok: true,
                        status: 200,
                        body: JSON.stringify([{ chatId: '5104238366', ok: true, status: 200 }])
                    };
                },
                async sendFeishuAlert(job, runtime) {
                    state.feishuTests.push({
                        job: cloneValue(job),
                        runtime: cloneValue(runtime)
                    });

                    return {
                        ok: true,
                        status: 200,
                        body: JSON.stringify({ code: 0, msg: 'success' })
                    };
                },
                async sendEmailAlert(job, runtime) {
                    state.emailTests.push({
                        job: cloneValue(job),
                        runtime: cloneValue(runtime)
                    });

                    return {
                        ok: true,
                        status: 200,
                        body: JSON.stringify({ id: 'email_123' })
                    };
                },
                resolveEnabledChannels(runtime, severity) {
                    const channels = [];
                    const normalizedSeverity = String(severity || '').trim().toLowerCase() || 'warning';
                    const rank = { info: 10, warning: 20, critical: 30 };
                    if (runtime?.config?.channels?.telegram?.enabled) {
                        const min = String(runtime.config.channels.telegram.minimum_severity || 'warning').trim().toLowerCase();
                        if ((rank[normalizedSeverity] || 20) >= (rank[min] || 20)) channels.push('telegram');
                    }
                    if (runtime?.config?.channels?.feishu?.enabled) {
                        const min = String(runtime.config.channels.feishu.minimum_severity || 'warning').trim().toLowerCase();
                        if ((rank[normalizedSeverity] || 20) >= (rank[min] || 20)) channels.push('feishu');
                    }
                    if (runtime?.config?.channels?.email?.enabled) {
                        const min = String(runtime.config.channels.email.minimum_severity || 'warning').trim().toLowerCase();
                        if ((rank[normalizedSeverity] || 20) >= (rank[min] || 20)) channels.push('email');
                    }
                    return channels;
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let handler;
    try {
        handler = require(handlerPath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback(handler, state);
    } finally {
        delete require.cache[handlerPath];
    }
}

test('ops alert settings GET returns the current config and secret status', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: { enabled: true, minimum_severity: 'critical', chat_ids: ['123456'] },
                feishu: { enabled: false, minimum_severity: 'warning' }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-24T10:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler) => {
        const req = { method: 'GET', body: null };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.config.enabled, true);
        assert.equal(payload.config.temporary_mute.until, '');
        assert.equal(payload.config.temporary_mute.allow_critical, true);
        assert.equal(payload.config.quiet_hours.enabled, false);
        assert.equal(payload.config.quiet_hours.start_hour, 23);
        assert.equal(payload.config.quiet_hours.end_hour, 8);
        assert.equal(payload.config.quiet_hours.timezone, 'Asia/Shanghai');
        assert.equal(payload.config.quiet_hours.allow_critical, true);
        assert.equal(payload.config.work_hours.enabled, false);
        assert.equal(payload.config.work_hours.start_hour, 9);
        assert.equal(payload.config.work_hours.end_hour, 18);
        assert.equal(payload.config.work_hours.timezone, 'Asia/Shanghai');
        assert.equal(payload.config.channels.telegram.minimum_severity, 'critical');
        assert.deepEqual(payload.config.channels.telegram.chat_ids, ['123456']);
        assert.equal(payload.config.routing.customer_chat_message.telegram, true);
        assert.equal(payload.config.routing.customer_chat_message.feishu, true);
        assert.equal(payload.config.routing.customer_chat_message.email, true);
        assert.equal(payload.config.routing.shop_inventory.telegram, true);
        assert.equal(payload.config.routing.shop_inventory.feishu, true);
        assert.equal(payload.config.routing.shop_inventory.email, true);
        assert.equal(payload.config.shop_order_risk.auto_response_enabled, true);
        assert.equal(payload.config.shop_order_risk.auto_disable_coupon_min_risk_score, 90);
        assert.equal(payload.config.shop_order_risk.auto_ban_user_min_risk_score, 96);
        assert.equal(payload.config.shop_order_risk.auto_ban_user_duration_days, 7);
        assert.equal(payload.config.shop_order_risk.auto_suspend_product_min_risk_score, 97);
        assert.equal(payload.config.shop_inventory.enabled, true);
        assert.equal(payload.config.shop_inventory.low_stock_threshold, 5);
        assert.equal(payload.config.shop_inventory.sweep_interval_ms, 15 * 60 * 1000);
        assert.equal(payload.config.shop_inventory.sales_window_days, 7);
        assert.equal(payload.config.shop_inventory.dedupe_window_minutes, 6 * 60);
        assert.equal(payload.config.shop_inventory.recovery_notification_enabled, true);
        assert.equal(payload.config.shop_inventory.summary_enabled, false);
        assert.equal(payload.config.shop_inventory.summary_window_minutes, 60);
        assert.equal(payload.config.shop_inventory.summary_max_items, 10);
        assert.equal(payload.config.shop_inventory.summary_schedule_mode, 'rolling_window');
        assert.equal(payload.config.shop_inventory.summary_hourly_minute, 0);
        assert.equal(payload.config.shop_inventory.summary_daily_hour, 9);
        assert.equal(payload.config.shop_inventory.summary_daily_minute, 0);
        assert.equal(payload.config.customer_chat_message.enabled, true);
        assert.equal(payload.config.customer_chat_message.sweep_interval_ms, 60 * 1000);
        assert.equal(payload.config.customer_chat_message.lookback_minutes, 15);
        assert.equal(payload.config.customer_chat_message.dedupe_window_minutes, 12 * 60);
        assert.equal(payload.config.customer_chat_message.work_hours_only_enabled, false);
        assert.equal(payload.config.customer_chat_message.summary_enabled, false);
        assert.equal(payload.config.customer_chat_message.summary_window_minutes, 60);
        assert.equal(payload.config.customer_chat_message.summary_max_items, 10);
        assert.equal(payload.config.customer_chat_message.summary_schedule_mode, 'rolling_window');
        assert.equal(payload.config.customer_chat_message.summary_hourly_minute, 0);
        assert.equal(payload.config.customer_chat_message.summary_daily_hour, 9);
        assert.equal(payload.config.customer_chat_message.summary_daily_minute, 0);
        assert.equal(payload.config.shop_purchase_success.enabled, true);
        assert.equal(payload.config.shop_purchase_success.sweep_interval_ms, 2 * 60 * 1000);
        assert.equal(payload.config.shop_purchase_success.lookback_minutes, 30);
        assert.equal(payload.config.shop_purchase_success.dedupe_window_minutes, 24 * 60);
        assert.equal(payload.config.shop_purchase_success.work_hours_only_enabled, false);
        assert.equal(payload.config.shop_purchase_success.summary_enabled, false);
        assert.equal(payload.config.shop_purchase_success.summary_window_minutes, 60);
        assert.equal(payload.config.shop_purchase_success.summary_max_items, 10);
        assert.equal(payload.config.shop_purchase_success.summary_schedule_mode, 'rolling_window');
        assert.equal(payload.config.shop_purchase_success.summary_hourly_minute, 0);
        assert.equal(payload.config.shop_purchase_success.summary_daily_hour, 9);
        assert.equal(payload.config.shop_purchase_success.summary_daily_minute, 0);
        assert.equal(payload.config.wallet_recharge_success.enabled, true);
        assert.equal(payload.config.wallet_recharge_success.sweep_interval_ms, 2 * 60 * 1000);
        assert.equal(payload.config.wallet_recharge_success.lookback_minutes, 30);
        assert.equal(payload.config.wallet_recharge_success.dedupe_window_minutes, 24 * 60);
        assert.equal(payload.config.wallet_recharge_success.work_hours_only_enabled, false);
        assert.equal(payload.config.wallet_recharge_success.summary_enabled, false);
        assert.equal(payload.config.wallet_recharge_success.summary_window_minutes, 60);
        assert.equal(payload.config.wallet_recharge_success.summary_max_items, 10);
        assert.equal(payload.config.wallet_recharge_success.summary_schedule_mode, 'rolling_window');
        assert.equal(payload.config.wallet_recharge_success.summary_hourly_minute, 0);
        assert.equal(payload.config.wallet_recharge_success.summary_daily_hour, 9);
        assert.equal(payload.config.wallet_recharge_success.summary_daily_minute, 0);
        assert.equal(payload.config.tickets.enabled, true);
        assert.equal(payload.config.tickets.sweep_interval_ms, 10 * 60 * 1000);
        assert.equal(payload.config.tickets.pending_overdue_minutes, 120);
        assert.equal(payload.config.tickets.critical_overdue_minutes, 12 * 60);
        assert.equal(payload.config.tickets.state_lookback_minutes, 24 * 60);
        assert.equal(payload.config.tickets.dedupe_window_minutes, 60);
        assert.equal(payload.config.tickets.work_hours_only_enabled, false);
        assert.equal(payload.config.tickets.summary_enabled, false);
        assert.equal(payload.config.tickets.summary_window_minutes, 60);
        assert.equal(payload.config.tickets.summary_max_items, 10);
        assert.equal(payload.config.tickets.summary_schedule_mode, 'rolling_window');
        assert.equal(payload.config.tickets.summary_hourly_minute, 0);
        assert.equal(payload.config.tickets.summary_daily_hour, 9);
        assert.equal(payload.config.tickets.summary_daily_minute, 0);
        assert.equal(payload.config.verify_quota.enabled, true);
        assert.equal(payload.config.verify_quota.sweep_interval_ms, 15 * 60 * 1000);
        assert.equal(payload.config.verify_quota.low_balance_threshold, 20);
        assert.equal(payload.config.verify_quota.low_remaining_jobs_threshold, 20);
        assert.equal(payload.config.verify_quota.critical_balance_threshold, 5);
        assert.equal(payload.config.verify_quota.critical_remaining_jobs_threshold, 5);
        assert.equal(payload.config.verify_quota.min_queue_buffer_jobs, 5);
        assert.equal(payload.config.verify_quota.dedupe_window_minutes, 6 * 60);
        assert.equal(payload.config.verify_queue.enabled, true);
        assert.equal(payload.config.verify_queue.sweep_interval_ms, 10 * 60 * 1000);
        assert.equal(payload.config.verify_queue.recent_activity_lookback_hours, 12);
        assert.equal(payload.config.verify_queue.recent_failure_window_minutes, 30);
        assert.equal(payload.config.verify_queue.queue_size_threshold, 10);
        assert.equal(payload.config.verify_queue.active_job_threshold, 8);
        assert.equal(payload.config.verify_queue.oldest_pending_minutes_threshold, 20);
        assert.equal(payload.config.verify_queue.recent_failure_threshold, 4);
        assert.equal(payload.config.verify_queue.dedupe_window_minutes, 30);
        assert.equal(payload.config.verify_failure.enabled, true);
        assert.equal(payload.config.verify_failure.sweep_interval_ms, 10 * 60 * 1000);
        assert.equal(payload.config.verify_failure.recent_window_minutes, 30);
        assert.equal(payload.config.verify_failure.min_total_jobs_threshold, 6);
        assert.equal(payload.config.verify_failure.failure_rate_threshold, 60);
        assert.equal(payload.config.verify_failure.affected_user_threshold, 3);
        assert.equal(payload.config.verify_failure.dedupe_window_minutes, 15);
        assert.equal(payload.secrets.telegram_bot_token.configured, true);
        assert.equal(payload.secrets.telegram_bot_token.source, 'stored');
        assert.equal(payload.secrets.feishu_webhook_url.configured, false);
        assert.equal(payload.secrets.email_api_key.configured, false);
    });
});

test('ops alert settings POST saves config, stores secrets, and records an audit log', async () => {
    await withOpsAlertsSettingsHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                config: {
                    enabled: true,
                    temporary_mute: {
                        until: '2026-03-27T15:00:00.000Z',
                        allow_critical: false
                    },
                    quiet_hours: {
                        enabled: true,
                        start_hour: 22,
                        end_hour: 7,
                        timezone: 'Asia/Shanghai',
                        allow_critical: false
                    },
                    work_hours: {
                        enabled: true,
                        start_hour: 9,
                        end_hour: 18,
                        timezone: 'Asia/Shanghai'
                    },
                    mute_rules: {
                        types: {
                            customer_chat_message: {
                                until: '2026-03-27T18:00:00.000Z',
                                allow_critical: false
                            },
                            shop_inventory: {
                                until: '2026-03-28T09:30:00.000Z',
                                allow_critical: true
                            }
                        },
                        modules: {
                            commerce: {
                                until: '2026-03-27T20:00:00.000Z',
                                allow_critical: false
                            },
                            payments: {
                                until: '2026-03-28T08:00:00.000Z',
                                allow_critical: true
                            },
                            shop_risk: {
                                until: '2026-03-28T11:30:00.000Z',
                                allow_critical: false
                            }
                        }
                    },
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'critical',
                            chat_ids: ['123456', '789000']
                        },
                        feishu: {
                            enabled: true,
                            minimum_severity: 'warning'
                        }
                    },
                    routing: {
                        customer_chat_message: {
                            telegram: false,
                            feishu: true,
                            email: true
                        },
                        shop_purchase_success: {
                            telegram: true,
                            feishu: false,
                            email: true
                        },
                        wallet_recharge_success: {
                            telegram: true,
                            feishu: true,
                            email: false
                        },
                        shop_inventory: {
                            telegram: false,
                            feishu: true,
                            email: false
                        }
                    },
                    shop_order_risk: {
                        auto_response_enabled: true,
                        auto_disable_coupon_min_risk_score: 88,
                        auto_ban_user_min_risk_score: 95,
                        auto_ban_user_duration_days: 14,
                        auto_suspend_product_min_risk_score: 98
                    },
                    shop_inventory: {
                        enabled: true,
                        low_stock_threshold: 9,
                        sweep_interval_ms: 20 * 60 * 1000,
                        sales_window_days: 5,
                        dedupe_window_minutes: 180,
                        recovery_notification_enabled: false,
                        summary_enabled: true,
                        summary_window_minutes: 120,
                        summary_max_items: 7,
                        summary_schedule_mode: 'hourly',
                        summary_hourly_minute: 10,
                        summary_daily_hour: 9,
                        summary_daily_minute: 0
                    },
                    customer_chat_message: {
                        enabled: true,
                        sweep_interval_ms: 3 * 60 * 1000,
                        lookback_minutes: 20,
                        dedupe_window_minutes: 240,
                        work_hours_only_enabled: true,
                        summary_enabled: true,
                        summary_window_minutes: 90,
                        summary_max_items: 6,
                        summary_schedule_mode: 'hourly',
                        summary_hourly_minute: 0,
                        summary_daily_hour: 9,
                        summary_daily_minute: 0
                    },
                    shop_purchase_success: {
                        enabled: false,
                        sweep_interval_ms: 4 * 60 * 1000,
                        lookback_minutes: 45,
                        dedupe_window_minutes: 360,
                        work_hours_only_enabled: false,
                        summary_enabled: false,
                        summary_window_minutes: 120,
                        summary_max_items: 8,
                        summary_schedule_mode: 'rolling_window',
                        summary_hourly_minute: 15,
                        summary_daily_hour: 10,
                        summary_daily_minute: 30
                    },
                    wallet_recharge_success: {
                        enabled: true,
                        sweep_interval_ms: 5 * 60 * 1000,
                        lookback_minutes: 60,
                        dedupe_window_minutes: 480,
                        work_hours_only_enabled: true,
                        summary_enabled: true,
                        summary_window_minutes: 180,
                        summary_max_items: 12,
                        summary_schedule_mode: 'daily',
                        summary_hourly_minute: 30,
                        summary_daily_hour: 9,
                        summary_daily_minute: 30
                    },
                    tickets: {
                        enabled: true,
                        sweep_interval_ms: 15 * 60 * 1000,
                        pending_overdue_minutes: 135,
                        critical_overdue_minutes: 10 * 60,
                        state_lookback_minutes: 12 * 60,
                        dedupe_window_minutes: 90,
                        page_size: 500,
                        max_pages: 10,
                        work_hours_only_enabled: true,
                        summary_enabled: true,
                        summary_window_minutes: 75,
                        summary_max_items: 9,
                        summary_schedule_mode: 'hourly',
                        summary_hourly_minute: 20,
                        summary_daily_hour: 8,
                        summary_daily_minute: 15
                    },
                    verify_quota: {
                        enabled: true,
                        sweep_interval_ms: 12 * 60 * 1000,
                        low_balance_threshold: 24,
                        low_remaining_jobs_threshold: 28,
                        critical_balance_threshold: 6,
                        critical_remaining_jobs_threshold: 7,
                        min_queue_buffer_jobs: 9,
                        dedupe_window_minutes: 240
                    },
                    verify_queue: {
                        enabled: false,
                        sweep_interval_ms: 9 * 60 * 1000,
                        recent_activity_lookback_hours: 18,
                        recent_failure_window_minutes: 45,
                        queue_size_threshold: 16,
                        active_job_threshold: 12,
                        oldest_pending_minutes_threshold: 35,
                        recent_failure_threshold: 5,
                        dedupe_window_minutes: 40
                    },
                    verify_failure: {
                        enabled: true,
                        sweep_interval_ms: 8 * 60 * 1000,
                        recent_window_minutes: 40,
                        min_total_jobs_threshold: 10,
                        failure_rate_threshold: 72,
                        affected_user_threshold: 6,
                        dedupe_window_minutes: 25
                    }
                },
                secrets: {
                    telegram_bot_token: 'telegram-secret-token',
                    feishu_webhook_url: 'https://open.feishu.cn/webhook/test'
                }
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.config.enabled, true);
        assert.equal(payload.config.temporary_mute.until, '2026-03-27T15:00:00.000Z');
        assert.equal(payload.config.temporary_mute.allow_critical, false);
        assert.equal(payload.config.quiet_hours.enabled, true);
        assert.equal(payload.config.quiet_hours.start_hour, 22);
        assert.equal(payload.config.quiet_hours.end_hour, 7);
        assert.equal(payload.config.quiet_hours.timezone, 'Asia/Shanghai');
        assert.equal(payload.config.quiet_hours.allow_critical, false);
        assert.equal(payload.config.work_hours.enabled, true);
        assert.equal(payload.config.work_hours.start_hour, 9);
        assert.equal(payload.config.work_hours.end_hour, 18);
        assert.equal(payload.config.work_hours.timezone, 'Asia/Shanghai');
        assert.equal(payload.config.mute_rules.types.customer_chat_message.until, '2026-03-27T18:00:00.000Z');
        assert.equal(payload.config.mute_rules.types.customer_chat_message.allow_critical, false);
        assert.equal(payload.config.mute_rules.types.shop_inventory.until, '2026-03-28T09:30:00.000Z');
        assert.equal(payload.config.mute_rules.modules.commerce.until, '2026-03-27T20:00:00.000Z');
        assert.equal(payload.config.mute_rules.modules.commerce.allow_critical, false);
        assert.equal(payload.config.mute_rules.modules.payments.until, '2026-03-28T08:00:00.000Z');
        assert.equal(payload.config.mute_rules.modules.payments.allow_critical, true);
        assert.equal(payload.config.mute_rules.modules.shop_risk.until, '2026-03-28T11:30:00.000Z');
        assert.equal(payload.config.mute_rules.modules.shop_risk.allow_critical, false);
        assert.equal(payload.config.channels.telegram.enabled, true);
        assert.deepEqual(payload.config.channels.telegram.chat_ids, ['123456', '789000']);
        assert.deepEqual(payload.config.routing.customer_chat_message, {
            telegram: false,
            feishu: true,
            email: true
        });
        assert.deepEqual(payload.config.routing.shop_purchase_success, {
            telegram: true,
            feishu: false,
            email: true
        });
        assert.deepEqual(payload.config.routing.wallet_recharge_success, {
            telegram: true,
            feishu: true,
            email: false
        });
        assert.deepEqual(payload.config.routing.shop_inventory, {
            telegram: false,
            feishu: true,
            email: false
        });
        assert.equal(payload.config.shop_order_risk.auto_response_enabled, true);
        assert.equal(payload.config.shop_order_risk.auto_disable_coupon_min_risk_score, 88);
        assert.equal(payload.config.shop_order_risk.auto_ban_user_min_risk_score, 95);
        assert.equal(payload.config.shop_order_risk.auto_ban_user_duration_days, 14);
        assert.equal(payload.config.shop_order_risk.auto_suspend_product_min_risk_score, 98);
        assert.equal(payload.config.shop_inventory.enabled, true);
        assert.equal(payload.config.shop_inventory.low_stock_threshold, 9);
        assert.equal(payload.config.shop_inventory.sweep_interval_ms, 20 * 60 * 1000);
        assert.equal(payload.config.shop_inventory.sales_window_days, 5);
        assert.equal(payload.config.shop_inventory.dedupe_window_minutes, 180);
        assert.equal(payload.config.shop_inventory.recovery_notification_enabled, false);
        assert.equal(payload.config.shop_inventory.summary_enabled, true);
        assert.equal(payload.config.shop_inventory.summary_window_minutes, 120);
        assert.equal(payload.config.shop_inventory.summary_max_items, 7);
        assert.equal(payload.config.shop_inventory.summary_schedule_mode, 'hourly');
        assert.equal(payload.config.shop_inventory.summary_hourly_minute, 10);
        assert.equal(payload.config.shop_inventory.summary_daily_hour, 9);
        assert.equal(payload.config.shop_inventory.summary_daily_minute, 0);
        assert.equal(payload.config.customer_chat_message.enabled, true);
        assert.equal(payload.config.customer_chat_message.sweep_interval_ms, 3 * 60 * 1000);
        assert.equal(payload.config.customer_chat_message.lookback_minutes, 20);
        assert.equal(payload.config.customer_chat_message.dedupe_window_minutes, 240);
        assert.equal(payload.config.customer_chat_message.work_hours_only_enabled, true);
        assert.equal(payload.config.customer_chat_message.summary_enabled, true);
        assert.equal(payload.config.customer_chat_message.summary_window_minutes, 90);
        assert.equal(payload.config.customer_chat_message.summary_max_items, 6);
        assert.equal(payload.config.customer_chat_message.summary_schedule_mode, 'hourly');
        assert.equal(payload.config.customer_chat_message.summary_hourly_minute, 0);
        assert.equal(payload.config.customer_chat_message.summary_daily_hour, 9);
        assert.equal(payload.config.customer_chat_message.summary_daily_minute, 0);
        assert.equal(payload.config.shop_purchase_success.enabled, false);
        assert.equal(payload.config.shop_purchase_success.sweep_interval_ms, 4 * 60 * 1000);
        assert.equal(payload.config.shop_purchase_success.lookback_minutes, 45);
        assert.equal(payload.config.shop_purchase_success.dedupe_window_minutes, 360);
        assert.equal(payload.config.shop_purchase_success.work_hours_only_enabled, false);
        assert.equal(payload.config.shop_purchase_success.summary_enabled, false);
        assert.equal(payload.config.shop_purchase_success.summary_window_minutes, 120);
        assert.equal(payload.config.shop_purchase_success.summary_max_items, 8);
        assert.equal(payload.config.shop_purchase_success.summary_schedule_mode, 'rolling_window');
        assert.equal(payload.config.shop_purchase_success.summary_hourly_minute, 15);
        assert.equal(payload.config.shop_purchase_success.summary_daily_hour, 10);
        assert.equal(payload.config.shop_purchase_success.summary_daily_minute, 30);
        assert.equal(payload.config.wallet_recharge_success.enabled, true);
        assert.equal(payload.config.wallet_recharge_success.sweep_interval_ms, 5 * 60 * 1000);
        assert.equal(payload.config.wallet_recharge_success.lookback_minutes, 60);
        assert.equal(payload.config.wallet_recharge_success.dedupe_window_minutes, 480);
        assert.equal(payload.config.wallet_recharge_success.work_hours_only_enabled, true);
        assert.equal(payload.config.wallet_recharge_success.summary_enabled, true);
        assert.equal(payload.config.wallet_recharge_success.summary_window_minutes, 180);
        assert.equal(payload.config.wallet_recharge_success.summary_max_items, 12);
        assert.equal(payload.config.wallet_recharge_success.summary_schedule_mode, 'daily');
        assert.equal(payload.config.wallet_recharge_success.summary_hourly_minute, 30);
        assert.equal(payload.config.wallet_recharge_success.summary_daily_hour, 9);
        assert.equal(payload.config.wallet_recharge_success.summary_daily_minute, 30);
        assert.equal(payload.config.tickets.enabled, true);
        assert.equal(payload.config.tickets.sweep_interval_ms, 15 * 60 * 1000);
        assert.equal(payload.config.tickets.pending_overdue_minutes, 135);
        assert.equal(payload.config.tickets.critical_overdue_minutes, 10 * 60);
        assert.equal(payload.config.tickets.state_lookback_minutes, 12 * 60);
        assert.equal(payload.config.tickets.dedupe_window_minutes, 90);
        assert.equal(payload.config.tickets.work_hours_only_enabled, true);
        assert.equal(payload.config.tickets.summary_enabled, true);
        assert.equal(payload.config.tickets.summary_window_minutes, 75);
        assert.equal(payload.config.tickets.summary_max_items, 9);
        assert.equal(payload.config.tickets.summary_schedule_mode, 'hourly');
        assert.equal(payload.config.tickets.summary_hourly_minute, 20);
        assert.equal(payload.config.tickets.summary_daily_hour, 8);
        assert.equal(payload.config.tickets.summary_daily_minute, 15);
        assert.equal(payload.config.verify_quota.enabled, true);
        assert.equal(payload.config.verify_quota.sweep_interval_ms, 12 * 60 * 1000);
        assert.equal(payload.config.verify_quota.low_balance_threshold, 24);
        assert.equal(payload.config.verify_quota.low_remaining_jobs_threshold, 28);
        assert.equal(payload.config.verify_quota.critical_balance_threshold, 6);
        assert.equal(payload.config.verify_quota.critical_remaining_jobs_threshold, 7);
        assert.equal(payload.config.verify_quota.min_queue_buffer_jobs, 9);
        assert.equal(payload.config.verify_quota.dedupe_window_minutes, 240);
        assert.equal(payload.config.verify_queue.enabled, false);
        assert.equal(payload.config.verify_queue.sweep_interval_ms, 9 * 60 * 1000);
        assert.equal(payload.config.verify_queue.recent_activity_lookback_hours, 18);
        assert.equal(payload.config.verify_queue.recent_failure_window_minutes, 45);
        assert.equal(payload.config.verify_queue.queue_size_threshold, 16);
        assert.equal(payload.config.verify_queue.active_job_threshold, 12);
        assert.equal(payload.config.verify_queue.oldest_pending_minutes_threshold, 35);
        assert.equal(payload.config.verify_queue.recent_failure_threshold, 5);
        assert.equal(payload.config.verify_queue.dedupe_window_minutes, 40);
        assert.equal(payload.config.verify_failure.enabled, true);
        assert.equal(payload.config.verify_failure.sweep_interval_ms, 8 * 60 * 1000);
        assert.equal(payload.config.verify_failure.recent_window_minutes, 40);
        assert.equal(payload.config.verify_failure.min_total_jobs_threshold, 10);
        assert.equal(payload.config.verify_failure.failure_rate_threshold, 72);
        assert.equal(payload.config.verify_failure.affected_user_threshold, 6);
        assert.equal(payload.config.verify_failure.dedupe_window_minutes, 25);
        assert.equal(state.systemConfigUpserts.length, 1);
        assert.equal(state.systemConfigUpserts[0].config_key, 'ops_alerts');
        assert.equal(state.upsertedSecrets.length, 2);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.upsert');
        assert.equal(state.auditLogs[0].details.temporary_mute_until, '2026-03-27T15:00:00.000Z');
        assert.equal(state.auditLogs[0].details.temporary_mute_allow_critical, false);
        assert.equal(state.auditLogs[0].details.quiet_hours_enabled, true);
        assert.equal(state.auditLogs[0].details.quiet_hours_start_hour, 22);
        assert.equal(state.auditLogs[0].details.quiet_hours_end_hour, 7);
        assert.equal(state.auditLogs[0].details.quiet_hours_timezone, 'Asia/Shanghai');
        assert.equal(state.auditLogs[0].details.quiet_hours_allow_critical, false);
        assert.equal(state.auditLogs[0].details.work_hours_enabled, true);
        assert.equal(state.auditLogs[0].details.work_hours_start_hour, 9);
        assert.equal(state.auditLogs[0].details.work_hours_end_hour, 18);
        assert.equal(state.auditLogs[0].details.work_hours_timezone, 'Asia/Shanghai');
        assert.deepEqual(state.auditLogs[0].details.mute_type_keys_active, ['customer_chat_message', 'shop_inventory']);
        assert.deepEqual(state.auditLogs[0].details.mute_module_keys_active, ['commerce', 'payments', 'shop_risk']);
        assert.deepEqual(state.auditLogs[0].details.mute_type_rules, {
            customer_chat_message: {
                until: '2026-03-27T18:00:00.000Z',
                allow_critical: false
            },
            shop_inventory: {
                until: '2026-03-28T09:30:00.000Z',
                allow_critical: true
            }
        });
        assert.deepEqual(state.auditLogs[0].details.mute_module_rules, {
            commerce: {
                until: '2026-03-27T20:00:00.000Z',
                allow_critical: false
            },
            payments: {
                until: '2026-03-28T08:00:00.000Z',
                allow_critical: true
            },
            shop_risk: {
                until: '2026-03-28T11:30:00.000Z',
                allow_critical: false
            }
        });
        assert.deepEqual(state.auditLogs[0].details.routing_customer_chat_message_channels, ['feishu', 'email']);
        assert.deepEqual(state.auditLogs[0].details.routing_shop_purchase_success_channels, ['telegram', 'email']);
        assert.deepEqual(state.auditLogs[0].details.routing_wallet_recharge_success_channels, ['telegram', 'feishu']);
        assert.deepEqual(state.auditLogs[0].details.routing_shop_inventory_channels, ['feishu']);
        assert.equal(state.auditLogs[0].details.shop_risk_auto_response_enabled, true);
        assert.equal(state.auditLogs[0].details.shop_risk_auto_disable_coupon_min_risk_score, 88);
        assert.equal(state.auditLogs[0].details.shop_risk_auto_ban_user_min_risk_score, 95);
        assert.equal(state.auditLogs[0].details.shop_risk_auto_ban_user_duration_days, 14);
        assert.equal(state.auditLogs[0].details.shop_risk_auto_suspend_product_min_risk_score, 98);
        assert.equal(state.auditLogs[0].details.shop_inventory_enabled, true);
        assert.equal(state.auditLogs[0].details.shop_inventory_low_stock_threshold, 9);
        assert.equal(state.auditLogs[0].details.shop_inventory_sweep_interval_ms, 20 * 60 * 1000);
        assert.equal(state.auditLogs[0].details.shop_inventory_sales_window_days, 5);
        assert.equal(state.auditLogs[0].details.shop_inventory_dedupe_window_minutes, 180);
        assert.equal(state.auditLogs[0].details.shop_inventory_recovery_notification_enabled, false);
        assert.equal(state.auditLogs[0].details.shop_inventory_summary_enabled, true);
        assert.equal(state.auditLogs[0].details.shop_inventory_summary_window_minutes, 120);
        assert.equal(state.auditLogs[0].details.shop_inventory_summary_max_items, 7);
        assert.equal(state.auditLogs[0].details.shop_inventory_summary_schedule_mode, 'hourly');
        assert.equal(state.auditLogs[0].details.shop_inventory_summary_hourly_minute, 10);
        assert.equal(state.auditLogs[0].details.shop_inventory_summary_daily_hour, 9);
        assert.equal(state.auditLogs[0].details.shop_inventory_summary_daily_minute, 0);
        assert.equal(state.auditLogs[0].details.customer_chat_message_enabled, true);
        assert.equal(state.auditLogs[0].details.customer_chat_message_sweep_interval_ms, 3 * 60 * 1000);
        assert.equal(state.auditLogs[0].details.customer_chat_message_lookback_minutes, 20);
        assert.equal(state.auditLogs[0].details.customer_chat_message_dedupe_window_minutes, 240);
        assert.equal(state.auditLogs[0].details.customer_chat_message_work_hours_only_enabled, true);
        assert.equal(state.auditLogs[0].details.customer_chat_message_summary_enabled, true);
        assert.equal(state.auditLogs[0].details.customer_chat_message_summary_window_minutes, 90);
        assert.equal(state.auditLogs[0].details.customer_chat_message_summary_max_items, 6);
        assert.equal(state.auditLogs[0].details.customer_chat_message_summary_schedule_mode, 'hourly');
        assert.equal(state.auditLogs[0].details.customer_chat_message_summary_hourly_minute, 0);
        assert.equal(state.auditLogs[0].details.customer_chat_message_summary_daily_hour, 9);
        assert.equal(state.auditLogs[0].details.customer_chat_message_summary_daily_minute, 0);
        assert.equal(state.auditLogs[0].details.shop_purchase_success_enabled, false);
        assert.equal(state.auditLogs[0].details.shop_purchase_success_sweep_interval_ms, 4 * 60 * 1000);
        assert.equal(state.auditLogs[0].details.shop_purchase_success_lookback_minutes, 45);
        assert.equal(state.auditLogs[0].details.shop_purchase_success_dedupe_window_minutes, 360);
        assert.equal(state.auditLogs[0].details.shop_purchase_success_work_hours_only_enabled, false);
        assert.equal(state.auditLogs[0].details.shop_purchase_success_summary_enabled, false);
        assert.equal(state.auditLogs[0].details.shop_purchase_success_summary_window_minutes, 120);
        assert.equal(state.auditLogs[0].details.shop_purchase_success_summary_max_items, 8);
        assert.equal(state.auditLogs[0].details.shop_purchase_success_summary_schedule_mode, 'rolling_window');
        assert.equal(state.auditLogs[0].details.shop_purchase_success_summary_hourly_minute, 15);
        assert.equal(state.auditLogs[0].details.shop_purchase_success_summary_daily_hour, 10);
        assert.equal(state.auditLogs[0].details.shop_purchase_success_summary_daily_minute, 30);
        assert.equal(state.auditLogs[0].details.wallet_recharge_success_enabled, true);
        assert.equal(state.auditLogs[0].details.wallet_recharge_success_sweep_interval_ms, 5 * 60 * 1000);
        assert.equal(state.auditLogs[0].details.wallet_recharge_success_lookback_minutes, 60);
        assert.equal(state.auditLogs[0].details.wallet_recharge_success_dedupe_window_minutes, 480);
        assert.equal(state.auditLogs[0].details.wallet_recharge_success_work_hours_only_enabled, true);
        assert.equal(state.auditLogs[0].details.wallet_recharge_success_summary_enabled, true);
        assert.equal(state.auditLogs[0].details.wallet_recharge_success_summary_window_minutes, 180);
        assert.equal(state.auditLogs[0].details.wallet_recharge_success_summary_max_items, 12);
        assert.equal(state.auditLogs[0].details.wallet_recharge_success_summary_schedule_mode, 'daily');
        assert.equal(state.auditLogs[0].details.wallet_recharge_success_summary_hourly_minute, 30);
        assert.equal(state.auditLogs[0].details.wallet_recharge_success_summary_daily_hour, 9);
        assert.equal(state.auditLogs[0].details.wallet_recharge_success_summary_daily_minute, 30);
        assert.equal(state.auditLogs[0].details.tickets_enabled, true);
        assert.equal(state.auditLogs[0].details.tickets_sweep_interval_ms, 15 * 60 * 1000);
        assert.equal(state.auditLogs[0].details.tickets_pending_overdue_minutes, 135);
        assert.equal(state.auditLogs[0].details.tickets_critical_overdue_minutes, 10 * 60);
        assert.equal(state.auditLogs[0].details.tickets_state_lookback_minutes, 12 * 60);
        assert.equal(state.auditLogs[0].details.tickets_dedupe_window_minutes, 90);
        assert.equal(state.auditLogs[0].details.tickets_work_hours_only_enabled, true);
        assert.equal(state.auditLogs[0].details.tickets_summary_enabled, true);
        assert.equal(state.auditLogs[0].details.tickets_summary_window_minutes, 75);
        assert.equal(state.auditLogs[0].details.tickets_summary_max_items, 9);
        assert.equal(state.auditLogs[0].details.tickets_summary_schedule_mode, 'hourly');
        assert.equal(state.auditLogs[0].details.tickets_summary_hourly_minute, 20);
        assert.equal(state.auditLogs[0].details.tickets_summary_daily_hour, 8);
        assert.equal(state.auditLogs[0].details.tickets_summary_daily_minute, 15);
        assert.equal(state.auditLogs[0].details.verify_quota_enabled, true);
        assert.equal(state.auditLogs[0].details.verify_quota_sweep_interval_ms, 12 * 60 * 1000);
        assert.equal(state.auditLogs[0].details.verify_quota_low_balance_threshold, 24);
        assert.equal(state.auditLogs[0].details.verify_quota_low_remaining_jobs_threshold, 28);
        assert.equal(state.auditLogs[0].details.verify_quota_critical_balance_threshold, 6);
        assert.equal(state.auditLogs[0].details.verify_quota_critical_remaining_jobs_threshold, 7);
        assert.equal(state.auditLogs[0].details.verify_quota_min_queue_buffer_jobs, 9);
        assert.equal(state.auditLogs[0].details.verify_quota_dedupe_window_minutes, 240);
        assert.equal(state.auditLogs[0].details.verify_queue_enabled, false);
        assert.equal(state.auditLogs[0].details.verify_queue_sweep_interval_ms, 9 * 60 * 1000);
        assert.equal(state.auditLogs[0].details.verify_queue_recent_activity_lookback_hours, 18);
        assert.equal(state.auditLogs[0].details.verify_queue_recent_failure_window_minutes, 45);
        assert.equal(state.auditLogs[0].details.verify_queue_size_threshold, 16);
        assert.equal(state.auditLogs[0].details.verify_queue_active_job_threshold, 12);
        assert.equal(state.auditLogs[0].details.verify_queue_oldest_pending_minutes_threshold, 35);
        assert.equal(state.auditLogs[0].details.verify_queue_recent_failure_threshold, 5);
        assert.equal(state.auditLogs[0].details.verify_queue_dedupe_window_minutes, 40);
        assert.equal(state.auditLogs[0].details.verify_failure_enabled, true);
        assert.equal(state.auditLogs[0].details.verify_failure_sweep_interval_ms, 8 * 60 * 1000);
        assert.equal(state.auditLogs[0].details.verify_failure_recent_window_minutes, 40);
        assert.equal(state.auditLogs[0].details.verify_failure_min_total_jobs_threshold, 10);
        assert.equal(state.auditLogs[0].details.verify_failure_rate_threshold, 72);
        assert.equal(state.auditLogs[0].details.verify_failure_affected_user_threshold, 6);
        assert.equal(state.auditLogs[0].details.verify_failure_dedupe_window_minutes, 25);
        assert.deepEqual(state.auditLogs[0].details.updated_secrets, ['telegram_bot_token', 'feishu_webhook_url']);
        assert.equal(payload.secrets.telegram_bot_token.configured, true);
        assert.equal(payload.secrets.feishu_webhook_url.configured, true);
    });
});

test('ops alert settings POST records batch mute case events when provided', async () => {
    await withOpsAlertsSettingsHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                config: createNormalizedConfig({
                    mute_rules: {
                        modules: {
                            payments: {
                                until: '2026-03-28T12:00:00.000Z',
                                allow_critical: false
                            }
                        }
                    }
                }),
                secrets: {},
                case_events: [
                    {
                        action: 'batch_mute',
                        items: [
                            {
                                category_key: 'payments',
                                target_id: 'payment_gateway:hupijiao:cn',
                                alert_type: 'payment_gateway_degraded',
                                title: '虎皮椒支付通道异常',
                                reference_label: '目标',
                                reference_value: 'payment_gateway:hupijiao:cn'
                            }
                        ],
                        metadata: {
                            mute_until: '2026-03-28T12:00:00.000Z',
                            allow_critical: false,
                            module_keys: ['payments'],
                            filter_summary: '全部待关注'
                        }
                    }
                ]
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.caseEvents.length, 1);
        assert.equal(state.caseEvents[0].action, 'batch_mute');
        assert.equal(state.caseEvents[0].category_key, 'payments');
        assert.equal(state.caseEvents[0].target_id, 'payment_gateway:hupijiao:cn');
        assert.equal(state.caseEvents[0].metadata.mute_until, '2026-03-28T12:00:00.000Z');
        assert.equal(state.auditLogs[0].details.case_event_count, 1);
    });
});

test('ops alert settings POST falls back to default secret keys when the shared export is missing', async () => {
    await withOpsAlertsSettingsHandler({
        omitSecretKeyMap: true
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {
                    telegram_bot_token: 'telegram-secret-token'
                }
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.deepEqual(state.upsertedSecrets, [
            {
                secretKey: 'ops_alert_telegram_bot_token',
                secretValue: 'telegram-secret-token'
            }
        ]);
    });
});

test('ops alert settings POST can store the backend email alert secret without touching the frontend', async () => {
    await withOpsAlertsSettingsHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                config: {
                    enabled: true,
                    channels: {
                        email: {
                            enabled: true,
                            minimum_severity: 'critical',
                            recipients: ['ops@example.com', 'owner@example.com'],
                            from_address: 'Zaoyoe Ops <alerts@zaoyoe.com>',
                            reply_to: 'owner@zaoyoe.com',
                            subject_prefix: '[Zaoyoe告警]'
                        }
                    }
                },
                secrets: {
                    email_api_key: 're_email_key'
                }
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.config.channels.email.enabled, true);
        assert.deepEqual(payload.config.channels.email.recipients, ['ops@example.com', 'owner@example.com']);
        assert.equal(payload.config.channels.email.from_address, 'Zaoyoe Ops <alerts@zaoyoe.com>');
        assert.equal(payload.secrets.email_api_key.configured, true);
        assert.deepEqual(state.upsertedSecrets, [
            {
                secretKey: 'ops_alert_email_api_key',
                secretValue: 're_email_key'
            }
        ]);
        assert.equal(state.auditLogs[0].details.email_enabled, true);
        assert.deepEqual(state.auditLogs[0].details.updated_secrets, ['email_api_key']);
    });
});

test('ops alert settings DELETE removes a stored secret and returns refreshed status', async () => {
    await withOpsAlertsSettingsHandler({
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-24T10:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'DELETE',
            body: {
                secretName: 'telegram_bot_token'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.deepEqual(state.deletedSecrets, ['ops_alert_telegram_bot_token']);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.secret.delete');
        assert.equal(payload.secrets.telegram_bot_token.configured, false);
        assert.equal(payload.secrets.telegram_bot_token.source, 'missing');
    });
});

test('ops alert settings POST can send a Telegram self-check without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_test_telegram',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'critical',
                            chat_ids: ['5104238366', '5104238367']
                        }
                    }
                },
                secrets: {
                    telegram_bot_token: 'temporary-telegram-token'
                }
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.feishuTests.length, 0);
        assert.deepEqual(state.telegramTests[0].runtime.config.channels.telegram.chat_ids, ['5104238366', '5104238367']);
        assert.equal(state.telegramTests[0].runtime.secrets.telegram_bot_token, 'temporary-telegram-token');
        assert.match(state.telegramTests[0].job.title, /站外告警通道自检/);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.telegram_test');
    });
});

test('ops alert settings POST can send a preview self-check through email when the channel is enabled', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                email: {
                    enabled: true,
                    minimum_severity: 'warning',
                    recipients: ['ops@example.com'],
                    from_address: 'Zaoyoe Ops <alerts@zaoyoe.com>',
                    reply_to: 'support@zaoyoe.com',
                    subject_prefix: '[Zaoyoe告警]'
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: false, source: 'missing', updatedAt: null },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null },
            email_api_key: { configured: true, source: 'stored', updatedAt: '2026-03-26T09:00:00.000Z' }
        },
        runtimeSecrets: {
            telegram_bot_token: '',
            feishu_webhook_url: '',
            email_api_key: 'stored-email-key'
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_test_telegram',
                config: {
                    enabled: true,
                    channels: {
                        email: {
                            enabled: true,
                            minimum_severity: 'warning',
                            recipients: ['ops@example.com', 'owner@example.com'],
                            from_address: 'Zaoyoe Ops <alerts@zaoyoe.com>',
                            reply_to: 'support@zaoyoe.com',
                            subject_prefix: '[Zaoyoe告警]'
                        }
                    }
                },
                secrets: {
                    email_api_key: 'temporary-email-key'
                }
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /邮件/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 0);
        assert.equal(state.feishuTests.length, 0);
        assert.equal(state.emailTests.length, 1);
        assert.deepEqual(state.emailTests[0].runtime.config.channels.email.recipients, ['ops@example.com', 'owner@example.com']);
        assert.equal(state.emailTests[0].runtime.secrets.email_api_key, 'temporary-email-key');
        assert.match(state.emailTests[0].job.title, /站外告警通道自检/);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.telegram_test');
    });
});

test('ops alert settings POST can send a refund detail sample to Telegram without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_refund_telegram',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /退款详情示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'payment_refund_ops');
        assert.equal(state.telegramTests[0].job.payload.provider_order_no, 'DEMO_HJ_ORDER_20260325');
        assert.equal(state.telegramTests[0].job.payload.user_id, 'demo_buyer_001');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.telegram_refund_sample');
    });
});

test('ops alert settings POST can send a customer chat message sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_customer_chat_message',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /客服消息示例已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'customer_chat_message_received');
        assert.equal(state.telegramTests[0].job.payload.sender_label, '阿木');
        assert.equal(state.telegramTests[0].job.payload.message_type, 'text');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.customer_chat_message_sample');
    });
});

test('ops alert settings POST can send a shop purchase success sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_shop_purchase_succeeded',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /购买成功示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'shop_purchase_succeeded');
        assert.equal(state.telegramTests[0].job.payload.product_name, 'Prompt Pro 年卡');
        assert.equal(state.telegramTests[0].job.payload.user_id, 'user_demo_buyer_001');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.shop_purchase_succeeded_sample');
    });
});

test('ops alert settings POST can send a wallet recharge success sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_wallet_recharge_succeeded',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /充值成功示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'wallet_recharge_succeeded');
        assert.equal(state.telegramTests[0].job.payload.points_amount, 500);
        assert.equal(state.telegramTests[0].job.payload.user_id, 'user_demo_buyer_001');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.wallet_recharge_succeeded_sample');
    });
});

test('ops alert settings POST can send a payment gateway degradation sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_gateway_degraded',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /支付通道异常示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'payment_gateway_degraded');
        assert.equal(state.telegramTests[0].job.payload.provider, 'hupijiao');
        assert.equal(state.telegramTests[0].job.payload.site, 'cn');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.gateway_degraded_sample');
    });
});

test('ops alert settings POST can send a payment gateway recovery sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_gateway_recovered',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /支付通道恢复示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'payment_gateway_recovered');
        assert.equal(state.telegramTests[0].job.payload.provider, 'hupijiao');
        assert.equal(state.telegramTests[0].job.payload.site, 'cn');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.gateway_recovered_sample');
    });
});

test('ops alert settings POST can send a verify quota low sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_verify_quota_low',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /验证额度告警示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'verify_quota_low');
        assert.equal(state.telegramTests[0].job.payload.balance, 11);
        assert.equal(state.telegramTests[0].job.payload.queue_size, 7);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.verify_quota_sample');
    });
});

test('ops alert settings POST can send a verify service disabled sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_verify_service_disabled',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /验证服务停摆示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'verify_service_disabled');
        assert.equal(state.telegramTests[0].job.payload.service_status, 'unavailable');
        assert.equal(state.telegramTests[0].job.payload.response_status, 503);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.verify_service_disabled_sample');
    });
});

test('ops alert settings POST can send a verify queue backlog sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_verify_queue_backlog',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /验证任务堆积示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'verify_queue_backlog');
        assert.equal(state.telegramTests[0].job.payload.queue_size, 18);
        assert.equal(state.telegramTests[0].job.payload.active_job_count, 11);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.verify_queue_backlog_sample');
    });
});

test('ops alert settings POST can send a verify failure rate spike sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_verify_failure_rate_spike',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /验证失败率异常示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'verify_failure_rate_spike');
        assert.equal(state.telegramTests[0].job.payload.failed_jobs, 7);
        assert.equal(state.telegramTests[0].job.payload.affected_user_count, 5);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.verify_failure_rate_spike_sample');
    });
});

test('ops alert settings POST can send a verify incident escalation sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_verify_incident_escalated',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /验证综合异常示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'verify_incident_escalated');
        assert.equal(state.telegramTests[0].job.payload.triggered_signal_count, 3);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.verify_incident_escalated_sample');
    });
});

test('ops alert settings POST can send a verify incident recovery sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_verify_incident_recovered',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /验证恢复示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'verify_incident_recovered');
        assert.equal(state.telegramTests[0].job.payload.incident_duration_minutes, 18);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.verify_incident_recovered_sample');
    });
});

test('ops alert settings POST can send a ticket SLA overdue sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_ticket_sla_overdue',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /工单超时示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'ticket_sla_overdue');
        assert.equal(state.telegramTests[0].job.payload.ticket_status, 'PENDING');
        assert.equal(state.telegramTests[0].job.payload.wait_minutes, 195);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.ticket_sla_sample');
    });
});

test('ops alert settings POST can send a ticket SLA recovery sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_ticket_sla_recovered',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /工单恢复示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'ticket_sla_recovered');
        assert.equal(state.telegramTests[0].job.payload.ticket_status, 'RESOLVED');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.ticket_sla_recovered_sample');
    });
});

test('ops alert settings POST can send a shop inventory low sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_shop_inventory_low',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /库存预警示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'shop_inventory_low');
        assert.equal(state.telegramTests[0].job.payload.stock_count, 3);
        assert.equal(state.telegramTests[0].job.payload.recent_sales_count, 12);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.shop_inventory_sample');
    });
});

test('ops alert settings POST can send a shop inventory recovery sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_shop_inventory_recovered',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /库存恢复示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'shop_inventory_recovered');
        assert.equal(state.telegramTests[0].job.payload.stock_count, 18);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.shop_inventory_recovered_sample');
    });
});

test('ops alert settings POST can send an admin login anomaly sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_admin_login_anomaly',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /管理员异常登录示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'security_admin_login_anomaly');
        assert.equal(state.telegramTests[0].job.payload.client_ip, '203.0.113.88');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.admin_login_anomaly_sample');
    });
});

test('ops alert settings POST can send a shop order delivery failed sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_shop_order_delivery_failed',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /履约失败示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'shop_order_delivery_failed');
        assert.equal(state.telegramTests[0].job.payload.delivery_status, 'dead_letter');
        assert.equal(state.telegramTests[0].job.payload.delivery_attempt_count, 4);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.shop_delivery_failed_sample');
    });
});

test('ops alert settings POST can send a shop order delivery incident sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_shop_order_delivery_incident',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /履约异常升级示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'shop_order_delivery_incident');
        assert.equal(state.telegramTests[0].job.payload.incident_order_count, 4);
        assert.equal(state.telegramTests[0].job.payload.dead_letter_count, 2);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.shop_delivery_incident_sample');
    });
});

test('ops alert settings POST can send a shop order delivery incident recovery sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_shop_order_delivery_incident_recovered',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /履约事故恢复示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'shop_order_delivery_incident_recovered');
        assert.equal(state.telegramTests[0].job.payload.previous_incident_order_count, 4);
        assert.equal(state.telegramTests[0].job.payload.active_order_count, 1);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.shop_delivery_incident_recovered_sample');
    });
});

test('ops alert settings POST can send a shop order delivery recovered sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo'
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_shop_order_delivery_recovered',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        },
                        feishu: {
                            enabled: true,
                            minimum_severity: 'warning'
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /履约恢复示例消息已发送到 Telegram、飞书/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.feishuTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'shop_order_delivery_recovered');
        assert.equal(state.telegramTests[0].job.payload.delivery_status, 'delivered');
        assert.equal(state.telegramTests[0].job.payload.previous_delivery_status, 'dead_letter');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.shop_delivery_recovered_sample');
    });
});

test('ops alert settings POST can send a payment config changed sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_payment_config_changed',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /支付配置变更示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'payment_config_changed');
        assert.equal(state.telegramTests[0].job.payload.active_provider, 'mock');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.payment_config_changed_sample');
    });
});

test('ops alert settings POST can send a payment config incident sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo'
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_payment_config_incident',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        },
                        feishu: {
                            enabled: true,
                            minimum_severity: 'warning'
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /支付配置异常升级示例消息已发送到 Telegram、飞书/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.feishuTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'payment_config_incident');
        assert.equal(state.telegramTests[0].job.payload.incident_change_count, 3);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.payment_config_incident_sample');
    });
});

test('ops alert settings POST can send a payment config incident recovered sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo'
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_payment_config_incident_recovered',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        },
                        feishu: {
                            enabled: true,
                            minimum_severity: 'warning'
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /支付配置事故恢复示例消息已发送到 Telegram、飞书/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.feishuTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'payment_config_incident_recovered');
        assert.equal(state.telegramTests[0].job.payload.active_change_count, 1);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.payment_config_incident_recovered_sample');
    });
});

test('ops alert settings POST can send a payment config recovered sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo'
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_payment_config_recovered',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        },
                        feishu: {
                            enabled: true,
                            minimum_severity: 'warning'
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /支付配置恢复示例消息已发送到 Telegram、飞书/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.feishuTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'payment_config_recovered');
        assert.equal(state.telegramTests[0].job.payload.current_active_provider, 'afdian');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.payment_config_recovered_sample');
    });
});

test('ops alert settings preview actions fan out to Feishu when the channel is enabled', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: 'https://open.feishu.cn/webhook/demo'
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_test_telegram',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        },
                        feishu: {
                            enabled: true,
                            minimum_severity: 'warning'
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /Telegram、飞书/);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.feishuTests.length, 1);
    });
});
