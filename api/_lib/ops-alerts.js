const crypto = require('crypto');
const {
    OPS_ALERT_SECRET_KEYS: CONFIGURED_OPS_ALERT_SECRET_KEYS,
    getStoredAdminSecret
} = require('./secrets');
const {
    formatAlertTimestamp,
    formatAlertTimestampsInsideText
} = require('./alert-time');
const {
    emitExternalMonitoringEventFailOpen
} = require('./external-monitoring');
const {
    normalizeSiteValue
} = require('./site');
const {
    DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG
} = require('./admin-login-anomaly-defaults');

const OPS_ALERTS_CONFIG_KEY = 'ops_alerts';
const OPS_ALERTS_SITE_SCOPED_CONFIG_MARKER = '__site_scoped';
const DEFAULT_OPS_ALERT_SECRET_KEYS = Object.freeze({
    telegram_bot_token: 'ops_alert_telegram_bot_token',
    feishu_webhook_url: 'ops_alert_feishu_webhook_url',
    email_api_key: 'ops_alert_email_api_key'
});
const DEFAULT_OPS_ALERTS_TIMEOUT_MS = 15000;
const DEFAULT_TELEGRAM_FETCH_RETRY_COUNT = 2;
const DEFAULT_TELEGRAM_FETCH_RETRY_DELAY_MS = 750;
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
    'shop_inventory',
    'payment_refund_ops',
    'payment_config',
    'shop_order_risk',
    'admin_login_anomaly',
    'tickets',
    'shop_order_delivery',
    'payment_gateway',
    'verify_quota',
    'verify_queue',
    'verify_failure',
    'kvm4_watchdog'
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
const SUPPORTED_CUSTOMER_CHAT_QUICK_REPLY_BUSINESS_TYPES = Object.freeze([
    'general',
    'order',
    'payment',
    'verification',
    'ticket'
]);
const SUPPORTED_TICKET_REPLY_TEMPLATE_ACTIONS = Object.freeze([
    'resolved',
    'rejected'
]);
const SUPPORTED_TICKET_REPLY_TEMPLATE_ISSUE_TYPES = Object.freeze([
    'all',
    'refund',
    'delivery',
    'account',
    'verification',
    'payment',
    'other'
]);
const DEFAULT_CUSTOMER_CHAT_QUICK_REPLY_TEMPLATES = Object.freeze([
    Object.freeze({
        id: 'ack',
        business_type: 'general',
        enabled: true,
        label: '先接手',
        hint: '先稳住用户预期',
        text: '这边已看到你的消息，我先帮你核对一下当前记录，稍后给你明确处理结果。'
    }),
    Object.freeze({
        id: 'order',
        business_type: 'order',
        enabled: true,
        label: '订单说明',
        hint: '最近订单 {{order_status}}',
        text: '我这边看到你最近的订单「{{order_name}}」当前状态是{{order_status}}，我先继续帮你核对处理进度，稍后给你明确反馈。'
    }),
    Object.freeze({
        id: 'payment',
        business_type: 'payment',
        enabled: true,
        label: '充值核对',
        hint: '最近充值 {{payment_status}}',
        text: '我这边看到你最近的充值记录当前是{{payment_status}}，先帮你核对到账和处理链路，稍后回复你。'
    }),
    Object.freeze({
        id: 'verify',
        business_type: 'verification',
        enabled: true,
        label: '验证跟进',
        hint: '最近验证 {{verification_status}}',
        text: '我这边看到最近验证任务状态是{{verification_status}}，先帮你核对当前提示和处理进度，稍后给你更新。'
    }),
    Object.freeze({
        id: 'ticket',
        business_type: 'ticket',
        enabled: true,
        label: '工单跟进',
        hint: '售后工单 {{ticket_status}}',
        text: '我这边看到最近售后工单目前是{{ticket_status}}，已经接手继续跟进，有结果会第一时间回复你。'
    })
]);
const DEFAULT_TICKET_REPLY_TEMPLATES = Object.freeze([
    Object.freeze({
        id: 'resolved_refund',
        action: 'resolved',
        issue_type: 'refund',
        enabled: true,
        title: '退款处理通知',
        tag: '退款',
        body: '已核实本次情况，工单已处理完成。如涉及订单退款或补偿结果，请以系统到账记录为准；若仍有异常，请继续回复本工单。'
    }),
    Object.freeze({
        id: 'resolved_generic',
        action: 'resolved',
        issue_type: 'all',
        enabled: true,
        title: '通用处理完成',
        tag: '推荐',
        body: '已收到你的反馈，当前问题已处理完成。如后续仍有异常，请直接回复本工单并补充具体情况，我们会继续协助你处理。'
    }),
    Object.freeze({
        id: 'resolved_delivery',
        action: 'resolved',
        issue_type: 'delivery',
        enabled: true,
        title: '履约跟进完成',
        tag: '履约',
        body: '已收到你的履约反馈，我们已经完成本次问题登记与处理。如后续仍未收到货物或状态没有更新，请继续回复本工单。'
    }),
    Object.freeze({
        id: 'resolved_account',
        action: 'resolved',
        issue_type: 'account',
        enabled: true,
        title: '账号核查完成',
        tag: '账号',
        body: '已核实你的账号情况，当前问题已完成处理。如后续仍遇到同类异常，请补充截图或具体时间点，我们会继续排查。'
    }),
    Object.freeze({
        id: 'resolved_verification',
        action: 'resolved',
        issue_type: 'verification',
        enabled: true,
        title: '验证核查完成',
        tag: '验证',
        body: '已核实你的验证情况，当前问题已完成处理。如后续仍遇到同类异常，请补充截图或具体时间点，我们会继续排查。'
    }),
    Object.freeze({
        id: 'resolved_payment',
        action: 'resolved',
        issue_type: 'payment',
        enabled: true,
        title: '支付问题处理',
        tag: '支付',
        body: '已收到你的支付反馈，当前问题已完成核查与处理。如后续仍有重复扣费、未到账或状态异常，请继续回复本工单。'
    }),
    Object.freeze({
        id: 'rejected_need_more_context',
        action: 'rejected',
        issue_type: 'all',
        enabled: true,
        title: '补充资料后再提交',
        tag: '推荐',
        body: '已收到你的反馈。当前信息还不足以完成处理，请补充订单号、异常截图、发生时间或操作步骤后重新提交，我们会继续跟进。'
    }),
    Object.freeze({
        id: 'rejected_duplicate_ticket',
        action: 'rejected',
        issue_type: 'all',
        enabled: true,
        title: '重复工单说明',
        tag: '去重',
        body: '已核查到相同问题已有工单在处理中，本工单先为你关闭。后续请以原工单为准，避免重复提交影响跟进效率。'
    }),
    Object.freeze({
        id: 'rejected_out_of_scope',
        action: 'rejected',
        issue_type: 'all',
        enabled: true,
        title: '不在售后范围',
        tag: '说明',
        body: '经核查，当前情况暂不属于售后直接处理范围，因此本工单先为你关闭。如你有新的订单信息或补充证据，可重新提交。'
    })
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
    shop_inventory_recovered: 'shop_inventory',
    payment_refund_ops: 'payment_refund_ops',
    payment_refund_alert: 'payment_refund_ops',
    payment_config_changed: 'payment_config',
    payment_config_recovered: 'payment_config',
    payment_config_incident: 'payment_config',
    payment_config_incident_recovered: 'payment_config',
    shop_order_risk_anomaly: 'shop_order_risk',
    shop_order_risk_recovered: 'shop_order_risk',
    security_admin_login_anomaly: 'admin_login_anomaly',
    ticket_new: 'tickets',
    ticket_sla_summary: 'tickets',
    ticket_sla_overdue: 'tickets',
    ticket_sla_recovered: 'tickets',
    shop_order_delivery_summary: 'shop_order_delivery',
    shop_order_delivery_failed: 'shop_order_delivery',
    shop_order_delivery_recovered: 'shop_order_delivery',
    shop_order_delivery_incident: 'shop_order_delivery',
    shop_order_delivery_incident_recovered: 'shop_order_delivery',
    payment_gateway_summary: 'payment_gateway',
    payment_gateway_degraded: 'payment_gateway',
    payment_gateway_recovered: 'payment_gateway',
    verify_quota_summary: 'verify_quota',
    verify_quota_low: 'verify_quota',
    verify_service_disabled: 'verify_quota',
    verify_queue_summary: 'verify_queue',
    verify_queue_backlog: 'verify_queue',
    verify_failure_summary: 'verify_failure',
    verify_failure_rate_spike: 'verify_failure',
    verify_incident_escalated: 'verify_failure',
    verify_incident_recovered: 'verify_failure',
    kvm4_watchdog_incident: 'kvm4_watchdog',
    kvm4_watchdog_recovered: 'kvm4_watchdog'
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
    payment_gateway_summary: 'payments',
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
    verify_quota_summary: 'verify',
    verify_quota_low: 'verify',
    verify_service_disabled: 'verify',
    verify_failure_summary: 'verify',
    verify_failure_rate_spike: 'verify',
    verify_queue_summary: 'verify',
    verify_queue_backlog: 'verify',
    verify_incident_escalated: 'verify',
    verify_incident_recovered: 'verify',
    ticket_new: 'tickets',
    ticket_sla_summary: 'tickets',
    ticket_sla_overdue: 'tickets',
    ticket_sla_recovered: 'tickets',
    shop_order_delivery_summary: 'fulfillment',
    shop_order_delivery_failed: 'fulfillment',
    shop_order_delivery_recovered: 'fulfillment',
    shop_order_delivery_incident: 'fulfillment',
    shop_order_delivery_incident_recovered: 'fulfillment',
    security_admin_login_anomaly: 'security',
    kvm4_watchdog_incident: 'security',
    kvm4_watchdog_recovered: 'security'
});
const AUTO_REOPEN_SUMMARY_ALERT_TYPES = new Set([
    'shop_inventory_summary',
    'payment_gateway_summary',
    'verify_quota_summary',
    'verify_queue_summary',
    'verify_failure_summary',
    'ticket_sla_summary',
    'shop_order_delivery_summary'
]);
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
    }),
    ticket_sla_overdue: Object.freeze({
        config_key: 'tickets',
        summary_alert_type: 'ticket_sla_summary',
        default_title: '工单超时汇总',
        unit: '条超时工单'
    }),
    shop_order_delivery_failed: Object.freeze({
        config_key: 'shop_order_delivery',
        summary_alert_type: 'shop_order_delivery_summary',
        default_title: '履约失败汇总',
        unit: '条履约异常'
    }),
    payment_gateway_degraded: Object.freeze({
        config_key: 'payment_gateway',
        summary_alert_type: 'payment_gateway_summary',
        default_title: '支付通道异常汇总',
        unit: '条通道异常'
    }),
    verify_quota_low: Object.freeze({
        config_key: 'verify_quota',
        summary_alert_type: 'verify_quota_summary',
        default_title: '验证额度告警汇总',
        unit: '条额度告警'
    }),
    verify_queue_backlog: Object.freeze({
        config_key: 'verify_queue',
        summary_alert_type: 'verify_queue_summary',
        default_title: '验证堆积告警汇总',
        unit: '条堆积告警'
    }),
    verify_failure_rate_spike: Object.freeze({
        config_key: 'verify_failure',
        summary_alert_type: 'verify_failure_summary',
        default_title: '验证失败率告警汇总',
        unit: '条失败率告警'
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
    timeout_ms: DEFAULT_OPS_ALERTS_TIMEOUT_MS,
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
            }),
            payment_refund_ops: Object.freeze({
                until: '',
                allow_critical: true
            }),
            payment_config: Object.freeze({
                until: '',
                allow_critical: true
            }),
            shop_order_risk: Object.freeze({
                until: '',
                allow_critical: true
            }),
            admin_login_anomaly: Object.freeze({
                until: '',
                allow_critical: true
            }),
            tickets: Object.freeze({
                until: '',
                allow_critical: true
            }),
            shop_order_delivery: Object.freeze({
                until: '',
                allow_critical: true
            }),
            payment_gateway: Object.freeze({
                until: '',
                allow_critical: true
            }),
            verify_quota: Object.freeze({
                until: '',
                allow_critical: true
            }),
            verify_queue: Object.freeze({
                until: '',
                allow_critical: true
            }),
            verify_failure: Object.freeze({
                until: '',
                allow_critical: true
            }),
            kvm4_watchdog: Object.freeze({
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
        }),
        payment_refund_ops: Object.freeze({
            telegram: true,
            feishu: true,
            email: true
        }),
        payment_config: Object.freeze({
            telegram: true,
            feishu: true,
            email: true
        }),
        shop_order_risk: Object.freeze({
            telegram: true,
            feishu: true,
            email: true
        }),
        admin_login_anomaly: Object.freeze({
            telegram: true,
            feishu: true,
            email: true
        }),
        tickets: Object.freeze({
            telegram: true,
            feishu: true,
            email: true
        }),
        shop_order_delivery: Object.freeze({
            telegram: true,
            feishu: true,
            email: true
        }),
        payment_gateway: Object.freeze({
            telegram: true,
            feishu: true,
            email: true
        }),
        verify_quota: Object.freeze({
            telegram: true,
            feishu: true,
            email: true
        }),
        verify_queue: Object.freeze({
            telegram: true,
            feishu: true,
            email: true
        }),
        verify_failure: Object.freeze({
            telegram: true,
            feishu: true,
            email: true
        }),
        kvm4_watchdog: Object.freeze({
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
        summary_daily_minute: 0,
        quick_reply_templates: DEFAULT_CUSTOMER_CHAT_QUICK_REPLY_TEMPLATES
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
    }),
    admin_login_anomaly: Object.freeze({
        enabled: DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.enabled,
        sweep_interval_ms: DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.sweep_interval_ms,
        recent_window_minutes: DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.recent_window_minutes,
        baseline_lookback_days: DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.baseline_lookback_days,
        dedupe_window_minutes: DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.dedupe_window_minutes,
        ip_grouping_enabled: DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.ip_grouping_enabled,
        ipv4_group_prefix_bits: DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.ipv4_group_prefix_bits,
        ipv6_group_prefix_bits: DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.ipv6_group_prefix_bits,
        recent_distinct_ip_group_threshold: DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.recent_distinct_ip_group_threshold,
        user_agent_family_grouping_enabled: DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.user_agent_family_grouping_enabled,
        recent_distinct_user_agent_family_threshold: DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.recent_distinct_user_agent_family_threshold,
        page_size: DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.page_size,
        max_pages: DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.max_pages
    }),
    tickets: Object.freeze({
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
        summary_schedule_mode: DEFAULT_SUMMARY_SCHEDULE_MODE,
        summary_hourly_minute: 0,
        summary_daily_hour: 9,
        summary_daily_minute: 0,
        reply_templates: getDefaultTicketReplyTemplates()
    }),
    shop_order_delivery: Object.freeze({
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
        summary_schedule_mode: DEFAULT_SUMMARY_SCHEDULE_MODE,
        summary_hourly_minute: 0,
        summary_daily_hour: 9,
        summary_daily_minute: 0
    }),
    verify_quota: Object.freeze({
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
        summary_schedule_mode: DEFAULT_SUMMARY_SCHEDULE_MODE,
        summary_hourly_minute: 0,
        summary_daily_hour: 9,
        summary_daily_minute: 0
    }),
    verify_queue: Object.freeze({
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
        summary_schedule_mode: DEFAULT_SUMMARY_SCHEDULE_MODE,
        summary_hourly_minute: 0,
        summary_daily_hour: 9,
        summary_daily_minute: 0
    }),
    verify_failure: Object.freeze({
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
        summary_schedule_mode: DEFAULT_SUMMARY_SCHEDULE_MODE,
        summary_hourly_minute: 0,
        summary_daily_hour: 9,
        summary_daily_minute: 0
    }),
    payment_gateway: Object.freeze({
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

function normalizeOpsAlertConfigSite(value, options = {}) {
    const allowAll = options.allowAll === true;
    const fallbackInput = String(options.fallback ?? 'cn').trim().toLowerCase();
    const fallback = allowAll && fallbackInput === 'all'
        ? 'all'
        : (fallbackInput === ''
            ? ''
            : normalizeSiteValue(fallbackInput, { fallback: 'cn' }));
    const normalized = normalizeText(value).toLowerCase();

    if (!normalized) {
        return fallback;
    }

    if (allowAll && normalized === 'all') {
        return 'all';
    }

    return normalizeSiteValue(normalized, {
        fallback: fallback === 'all' ? 'cn' : fallback,
        allowEmpty: fallback === ''
    });
}

function isOpsAlertsSiteScopedConfigEnvelope(value) {
    return Boolean(value)
        && typeof value === 'object'
        && !Array.isArray(value)
        && value[OPS_ALERTS_SITE_SCOPED_CONFIG_MARKER] === true;
}

function getOpsAlertsSiteScopedConfigDefaultValue(value) {
    if (!isOpsAlertsSiteScopedConfigEnvelope(value)) {
        return value ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'default')) {
        return value.default;
    }

    return null;
}

function resolveOpsAlertsConfigValueForSite(value, site = 'all') {
    if (!isOpsAlertsSiteScopedConfigEnvelope(value)) {
        return value ?? null;
    }

    const normalizedSite = normalizeOpsAlertConfigSite(site, {
        allowAll: true,
        fallback: 'all'
    });
    if (normalizedSite === 'all') {
        return getOpsAlertsSiteScopedConfigDefaultValue(value);
    }

    const sites = value.sites && typeof value.sites === 'object' && !Array.isArray(value.sites)
        ? value.sites
        : {};
    if (Object.prototype.hasOwnProperty.call(sites, normalizedSite)) {
        return sites[normalizedSite];
    }

    return getOpsAlertsSiteScopedConfigDefaultValue(value);
}

function resolveOpsAlertInputSite(input = {}, options = {}) {
    const payload = normalizeJsonObject(input.payload);
    const candidates = [
        options.site,
        input.site,
        input.site_context,
        payload.site
    ];
    const siteLabels = Array.isArray(payload.site_labels)
        ? payload.site_labels.map((item) => normalizeOpsAlertConfigSite(item, { fallback: '' })).filter(Boolean)
        : [];
    if (siteLabels.length === 1) {
        candidates.push(siteLabels[0]);
    }

    const explicitSite = candidates.find((item) => normalizeText(item));
    return {
        site: normalizeOpsAlertConfigSite(explicitSite, { fallback: 'cn' }),
        explicit: Boolean(explicitSite)
    };
}

function withOpsAlertSitePayload(payload = {}, siteContext = {}) {
    const normalizedPayload = normalizeJsonObject(payload);
    if (!siteContext?.explicit) {
        return normalizedPayload;
    }

    return {
        ...normalizedPayload,
        site: normalizeOpsAlertConfigSite(siteContext.site, { fallback: 'cn' })
    };
}

function getOpsAlertSiteBadgeLabel(input = {}) {
    const siteContext = resolveOpsAlertInputSite(input);
    const site = normalizeOpsAlertConfigSite(siteContext.site, { fallback: 'cn' });
    if (site === 'intl') {
        return '[INTL站]';
    }
    if (site === 'all') {
        return '[全站]';
    }
    return '[CN站]';
}

function isMissingTableAccessError(error, tableName = '') {
    const normalizedTableName = normalizeText(tableName).toLowerCase();
    const code = normalizeText(error?.code).toUpperCase();
    const message = [
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(' ').toLowerCase();
    if (!normalizedTableName || !message.includes(normalizedTableName)) {
        return false;
    }

    return (
        code === '42P01'
        || code === 'PGRST205'
        || message.includes('does not exist')
        || message.includes('undefined table')
        || message.includes('unexpected table access')
        || message.includes('schema cache')
        || message.includes('could not find the table')
    );
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

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, Math.max(0, Number(ms || 0) || 0));
    });
}

function isRetryableFetchError(error = {}) {
    const name = normalizeText(error?.name).toLowerCase();
    const message = normalizeText(error?.message).toLowerCase();
    if (name === 'aborterror' || message.includes('aborted') || message.includes('abort')) {
        return false;
    }

    return (
        message.includes('fetch failed')
        || message.includes('network')
        || message.includes('socket')
        || message.includes('econnreset')
        || message.includes('etimedout')
        || message.includes('econnrefused')
        || message.includes('enotfound')
        || message.includes('tls')
    );
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

function normalizeOpsAlertCaseCategoryKey(value, targetId = '') {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized) {
        return normalized;
    }

    if (normalizeText(targetId).toLowerCase().startsWith('shop_order_risk:')) {
        return 'shop_risk';
    }

    return '';
}

function inferOpsAlertCaseCategoryKey(alertType = '', targetId = '') {
    return normalizeOpsAlertCaseCategoryKey(ALERT_TYPE_MODULE_MAP[normalizeText(alertType).toLowerCase()] || '', targetId);
}

function shouldAutoReopenOpsAlertCase(alertType = '') {
    const normalized = normalizeText(alertType).toLowerCase();
    if (!normalized) {
        return false;
    }

    if (normalized.endsWith('_recovered')) {
        return false;
    }
    if (normalized.endsWith('_summary')) {
        return AUTO_REOPEN_SUMMARY_ALERT_TYPES.has(normalized);
    }
    return true;
}

function buildOpsAlertCaseMetadata(existingCase = {}, input = {}) {
    const payload = normalizeJsonObject(input.payload);
    const siteContext = resolveOpsAlertInputSite(input, {
        site: existingCase.site || input.site
    });
    const existingMetadata = normalizeJsonObject(existingCase.metadata);
    const nextMetadata = {
        ...existingMetadata,
        ...normalizeJsonObject(payload.metadata)
    };
    const alertType = normalizeText(input.alertType || input.alert_type || existingCase.alert_type).toLowerCase();
    const title = normalizeText(input.title || existingMetadata.title);
    const referenceLabel = normalizeText(payload.reference_label || existingMetadata.reference_label);
    const referenceValue = normalizeText(payload.reference_value || existingMetadata.reference_value);
    const alertJobId = normalizeText(input.alert_job_id || input.alertJobId || payload.alert_job_id || payload.alertJobId || payload.job_id || payload.jobId);
    const alertCreatedAt = normalizeText(input.alert_created_at || input.alertCreatedAt || input.createdAt || input.created_at || payload.alert_created_at || payload.alertCreatedAt);
    const summaryWindowStartAt = normalizeText(input.summary_window_start_at || input.summaryWindowStartAt || payload.summary_window_start_at || payload.summaryWindowStartAt || payload.window_start_at);
    const summaryWindowEndAt = normalizeText(input.summary_window_end_at || input.summaryWindowEndAt || payload.summary_window_end_at || payload.summaryWindowEndAt || payload.window_end_at);

    if (alertType) {
        nextMetadata.alert_type = alertType;
    }
    if (title) {
        nextMetadata.title = title;
    }
    if (referenceLabel) {
        nextMetadata.reference_label = referenceLabel;
    }
    if (referenceValue) {
        nextMetadata.reference_value = referenceValue;
    }
    if (alertJobId) {
        nextMetadata.alert_job_id = alertJobId;
    }
    if (alertCreatedAt) {
        nextMetadata.alert_created_at = alertCreatedAt;
    }
    if (summaryWindowStartAt) {
        nextMetadata.summary_window_start_at = summaryWindowStartAt;
    }
    if (summaryWindowEndAt) {
        nextMetadata.summary_window_end_at = summaryWindowEndAt;
    }
    nextMetadata.site = siteContext.site;

    return nextMetadata;
}

function parseOpsAlertTimestampMs(value = '') {
    const timestamp = Date.parse(normalizeText(value));
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function getOpsAlertCaseClosedAtMs(caseRecord = {}) {
    const status = normalizeText(caseRecord?.status).toLowerCase();
    const lastAction = normalizeText(caseRecord?.last_action).toLowerCase();
    if (status !== 'resolved' && lastAction !== 'resolved') {
        return 0;
    }

    return parseOpsAlertTimestampMs(caseRecord?.last_action_at)
        || parseOpsAlertTimestampMs(caseRecord?.updated_at);
}

function getOpsAlertInputCreatedAtMs(input = {}) {
    const payload = normalizeJsonObject(input.payload);
    return parseOpsAlertTimestampMs(input.createdAt || input.created_at)
        || parseOpsAlertTimestampMs(input.alert_created_at || input.alertCreatedAt)
        || parseOpsAlertTimestampMs(payload.alert_created_at || payload.alertCreatedAt);
}

function getOpsAlertResolvedCoveredAlertMs(caseRecord = {}) {
    const metadata = normalizeJsonObject(caseRecord?.metadata);
    return parseOpsAlertTimestampMs(metadata.resolved_alert_created_at)
        || parseOpsAlertTimestampMs(metadata.alert_created_at);
}

function getOpsAlertInputSummaryWindowEndMs(input = {}) {
    const payload = normalizeJsonObject(input.payload);
    const metadata = normalizeJsonObject(input.metadata);
    return parseOpsAlertTimestampMs(input.summary_window_end_at || input.summaryWindowEndAt)
        || parseOpsAlertTimestampMs(payload.summary_window_end_at || payload.summaryWindowEndAt || payload.window_end_at)
        || parseOpsAlertTimestampMs(metadata.summary_window_end_at || metadata.summaryWindowEndAt || metadata.window_end_at);
}

function getOpsAlertResolvedSummaryWindowEndMs(caseRecord = {}) {
    const metadata = normalizeJsonObject(caseRecord?.metadata);
    return parseOpsAlertTimestampMs(metadata.resolved_summary_window_end_at)
        || parseOpsAlertTimestampMs(metadata.summary_window_end_at);
}

function isOpsAlertSummaryCaseInput(input = {}) {
    const payload = normalizeJsonObject(input.payload);
    const alertType = normalizeText(input.alertType || input.alert_type || payload.summary_type).toLowerCase();
    const targetId = normalizeText(payload.target_id || input.target_id || input.targetId).toLowerCase();
    return alertType.endsWith('_summary') || targetId.startsWith('ops_summary:');
}

function getResolvedOpsAlertCaseInputCoverage(caseRecord = {}, input = {}) {
    const triggerTime = getOpsAlertInputCreatedAtMs(input);
    const coveredAlertTime = getOpsAlertResolvedCoveredAlertMs(caseRecord);
    if (coveredAlertTime > 0 && triggerTime > 0 && triggerTime <= coveredAlertTime) {
        return {
            covered: true,
            reason: 'case_closed_after_alert'
        };
    }

    if (!isOpsAlertSummaryCaseInput(input)) {
        return {
            covered: false,
            reason: ''
        };
    }

    const inputWindowEnd = getOpsAlertInputSummaryWindowEndMs(input);
    const coveredWindowEnd = getOpsAlertResolvedSummaryWindowEndMs(caseRecord);
    if (inputWindowEnd > 0 && coveredWindowEnd > 0 && inputWindowEnd <= coveredWindowEnd) {
        return {
            covered: true,
            reason: 'case_closed_after_summary_window'
        };
    }

    return {
        covered: false,
        reason: ''
    };
}

async function reopenResolvedOpsAlertCaseForJob(supabase, input = {}, options = {}) {
    if (!supabase?.from) {
        return {
            reopened: false,
            reason: 'supabase_unavailable'
        };
    }

    const alertType = normalizeText(input.alertType || input.alert_type).toLowerCase();
    if (!shouldAutoReopenOpsAlertCase(alertType)) {
        return {
            reopened: false,
            reason: 'alert_type_ignored'
        };
    }

    const payload = normalizeJsonObject(input.payload);
    const targetId = normalizeText(payload.target_id || input.target_id);
    const categoryKey = inferOpsAlertCaseCategoryKey(alertType, targetId);
    const siteContext = resolveOpsAlertInputSite(input, options);
    const site = siteContext.site;
    if (!categoryKey || !targetId) {
        return {
            reopened: false,
            reason: 'missing_case_target'
        };
    }

    let existingCase = null;
    try {
        const { data, error } = await supabase
            .from('ops_alert_cases')
            .select('*')
            .eq('site', site)
            .eq('category_key', categoryKey)
            .eq('target_id', targetId)
            .maybeSingle();

        if (error) {
            throw error;
        }

        existingCase = data || null;
    } catch (error) {
        if (isMissingTableAccessError(error, 'ops_alert_cases')) {
            return {
                reopened: false,
                reason: 'missing_case_table'
            };
        }
        throw error;
    }

    if (!existingCase) {
        return {
            reopened: false,
            reason: 'missing_case'
        };
    }

    if (normalizeText(existingCase.status).toLowerCase() !== 'resolved') {
        return {
            reopened: false,
            reason: 'case_not_resolved'
        };
    }

    const nowIso = normalizeText(input.createdAt || input.created_at) || new Date(options.now || Date.now()).toISOString();
    const triggerTime = parseOpsAlertTimestampMs(nowIso);
    const caseClosedAt = getOpsAlertCaseClosedAtMs(existingCase);
    if (caseClosedAt > 0 && triggerTime > 0 && triggerTime <= caseClosedAt) {
        return {
            reopened: false,
            reason: 'case_closed_after_alert',
            site,
            category_key: categoryKey,
            target_id: targetId
        };
    }
    const coverage = getResolvedOpsAlertCaseInputCoverage(existingCase, input);
    if (coverage.covered) {
        return {
            reopened: false,
            reason: coverage.reason,
            site,
            category_key: categoryKey,
            target_id: targetId
        };
    }

    const metadata = buildOpsAlertCaseMetadata(existingCase, input);
    metadata.reopened_at = nowIso;
    delete metadata.resolved_at;
    delete metadata.resolved_alert_job_id;
    delete metadata.resolved_alert_created_at;
    delete metadata.resolved_summary_window_start_at;
    delete metadata.resolved_summary_window_end_at;
    const nextRecord = {
        ...existingCase,
        site,
        category_key: categoryKey,
        target_id: targetId,
        alert_type: alertType || normalizeText(existingCase.alert_type).toLowerCase() || null,
        status: 'open',
        resolution: null,
        metadata,
        last_action: 'reopened',
        last_action_by: null,
        last_action_at: nowIso
    };

    try {
        const { error } = await supabase
            .from('ops_alert_cases')
            .upsert(nextRecord, { onConflict: 'site,category_key,target_id' })
            .select('*')
            .single();

        if (error) {
            throw error;
        }
    } catch (error) {
        if (isMissingTableAccessError(error, 'ops_alert_cases')) {
            return {
                reopened: false,
                reason: 'missing_case_table'
            };
        }
        throw error;
    }

    try {
        const { error } = await supabase
            .from('ops_alert_case_events')
            .insert({
                site,
                category_key: categoryKey,
                target_id: targetId,
                alert_type: nextRecord.alert_type,
                action: 'reopen',
                status: 'open',
                owner_admin_id: normalizeText(nextRecord.owner_admin_id) || null,
                owner_label: normalizeText(nextRecord.owner_label) || null,
                actor_admin_id: null,
                actor_label: '系统告警',
                note: '同目标出现新的站外告警，系统已自动重新打开该告警。',
                resolution: null,
                metadata: {
                    ...metadata,
                    trigger_alert_type: alertType || null,
                    trigger_source: normalizeText(input.source) || null
                },
                created_at: nowIso
            });

        if (error) {
            throw error;
        }
    } catch (error) {
        if (!isMissingTableAccessError(error, 'ops_alert_case_events')) {
            throw error;
        }
    }

    return {
        reopened: true,
        reason: 'auto_reopened',
        site,
        category_key: categoryKey,
        target_id: targetId
    };
}

function cloneCustomerChatQuickReplyTemplates(templates = DEFAULT_CUSTOMER_CHAT_QUICK_REPLY_TEMPLATES) {
    return (Array.isArray(templates) ? templates : DEFAULT_CUSTOMER_CHAT_QUICK_REPLY_TEMPLATES).map((template, index) => ({
        id: normalizeText(template?.id || template?.key) || `template_${index + 1}`,
        business_type: SUPPORTED_CUSTOMER_CHAT_QUICK_REPLY_BUSINESS_TYPES.includes(normalizeText(template?.business_type).toLowerCase())
            ? normalizeText(template?.business_type).toLowerCase()
            : 'general',
        enabled: template?.enabled !== false,
        label: normalizeText(template?.label),
        hint: normalizeText(template?.hint),
        text: normalizeText(template?.text)
    }));
}

function getDefaultCustomerChatQuickReplyTemplates() {
    return cloneCustomerChatQuickReplyTemplates(DEFAULT_CUSTOMER_CHAT_QUICK_REPLY_TEMPLATES);
}

function normalizeCustomerChatQuickReplyBusinessType(value, fallback = 'general') {
    const normalized = normalizeText(value).toLowerCase();
    return SUPPORTED_CUSTOMER_CHAT_QUICK_REPLY_BUSINESS_TYPES.includes(normalized)
        ? normalized
        : fallback;
}

function normalizeCustomerChatQuickReplyTemplateId(value, fallbackIndex = 0, fallbackId = '') {
    const normalized = normalizeText(value)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);

    if (normalized) {
        return normalized;
    }

    const fallback = normalizeText(fallbackId)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
    if (fallback) {
        return fallback;
    }

    return `template_${Math.max(1, fallbackIndex + 1)}`;
}

function getCustomerChatQuickReplyTypeLabel(businessType = 'general') {
    const labels = {
        general: '通用回复',
        order: '订单回复',
        payment: '充值回复',
        verification: '验证回复',
        ticket: '工单回复'
    };
    return labels[normalizeCustomerChatQuickReplyBusinessType(businessType)] || labels.general;
}

function cloneTicketReplyTemplates(templates = DEFAULT_TICKET_REPLY_TEMPLATES) {
    return (Array.isArray(templates) ? templates : DEFAULT_TICKET_REPLY_TEMPLATES).map((template, index) => ({
        id: normalizeText(template?.id || template?.key) || `template_${index + 1}`,
        action: SUPPORTED_TICKET_REPLY_TEMPLATE_ACTIONS.includes(normalizeText(template?.action).toLowerCase())
            ? normalizeText(template?.action).toLowerCase()
            : 'resolved',
        issue_type: SUPPORTED_TICKET_REPLY_TEMPLATE_ISSUE_TYPES.includes(normalizeText(template?.issue_type || template?.issueType).toLowerCase())
            ? normalizeText(template?.issue_type || template?.issueType).toLowerCase()
            : 'all',
        enabled: template?.enabled !== false,
        title: normalizeText(template?.title, 80),
        tag: normalizeText(template?.tag, 40),
        body: normalizeText(template?.body || template?.text, 2000)
    }));
}

function getDefaultTicketReplyTemplates() {
    return cloneTicketReplyTemplates(DEFAULT_TICKET_REPLY_TEMPLATES);
}

function normalizeTicketReplyTemplateAction(value, fallback = 'resolved') {
    const normalized = normalizeText(value).toLowerCase();
    return SUPPORTED_TICKET_REPLY_TEMPLATE_ACTIONS.includes(normalized)
        ? normalized
        : fallback;
}

function normalizeTicketReplyTemplateIssueType(value, fallback = 'all') {
    const normalized = normalizeText(value).toLowerCase();
    return SUPPORTED_TICKET_REPLY_TEMPLATE_ISSUE_TYPES.includes(normalized)
        ? normalized
        : fallback;
}

function normalizeTicketReplyTemplateId(value, fallbackIndex = 0, fallbackId = '') {
    const normalized = normalizeText(value)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);

    if (normalized) {
        return normalized;
    }

    const fallback = normalizeText(fallbackId)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
    if (fallback) {
        return fallback;
    }

    return `template_${Math.max(1, fallbackIndex + 1)}`;
}

function getTicketReplyTemplateActionLabel(action = 'resolved') {
    const labels = {
        resolved: '解决工单',
        rejected: '拒绝工单'
    };
    return labels[normalizeTicketReplyTemplateAction(action)] || labels.resolved;
}

function getTicketReplyTemplateIssueTypeLabel(issueType = 'all') {
    const labels = {
        all: '通用',
        refund: '退款',
        delivery: '履约',
        account: '账号',
        verification: '验证',
        payment: '支付',
        other: '其他'
    };
    return labels[normalizeTicketReplyTemplateIssueType(issueType)] || labels.all;
}

function normalizeTicketReplyTemplates(value) {
    if (!Array.isArray(value)) {
        return getDefaultTicketReplyTemplates();
    }
    if (!value.length) {
        return [];
    }

    const defaults = getDefaultTicketReplyTemplates();
    const normalized = [];

    (Array.isArray(value) ? value : []).forEach((item, index) => {
        const template = normalizeJsonObject(item);
        const action = normalizeTicketReplyTemplateAction(template.action, 'resolved');
        const issueType = normalizeTicketReplyTemplateIssueType(
            template.issue_type || template.issueType,
            'all'
        );
        const fallback = defaults.find((candidate) => candidate.id === normalizeText(template.id))
            || defaults.find((candidate) => candidate.action === action && candidate.issue_type === issueType)
            || null;
        const body = normalizeText(template.body || template.text, 2000);
        if (!body) {
            return;
        }

        normalized.push({
            id: normalizeTicketReplyTemplateId(template.id || template.key, normalized.length, fallback?.id),
            action,
            issue_type: issueType,
            enabled: template.enabled !== false,
            title: normalizeText(template.title, 80)
                || fallback?.title
                || `${getTicketReplyTemplateActionLabel(action)} · ${getTicketReplyTemplateIssueTypeLabel(issueType)}`,
            tag: normalizeText(template.tag, 40) || fallback?.tag || getTicketReplyTemplateIssueTypeLabel(issueType),
            body
        });
    });

    return normalized.slice(0, 20);
}

function normalizeCustomerChatQuickReplyTemplates(value) {
    if (!Array.isArray(value)) {
        return getDefaultCustomerChatQuickReplyTemplates();
    }
    if (!value.length) {
        return [];
    }

    const defaults = getDefaultCustomerChatQuickReplyTemplates();
    const normalized = [];

    (Array.isArray(value) ? value : []).forEach((item, index) => {
        const template = normalizeJsonObject(item);
        const businessType = normalizeCustomerChatQuickReplyBusinessType(
            template.business_type || template.businessType || template.type,
            'general'
        );
        const fallback = defaults.find((candidate) => candidate.id === normalizeText(template.id))
            || defaults.find((candidate) => candidate.business_type === businessType)
            || null;
        const text = normalizeText(template.text);
        if (!text) {
            return;
        }

        normalized.push({
            id: normalizeCustomerChatQuickReplyTemplateId(template.id || template.key, normalized.length, fallback?.id),
            business_type: businessType,
            enabled: normalizeBoolean(template.enabled, fallback ? fallback.enabled !== false : true),
            label: normalizeText(template.label) || fallback?.label || getCustomerChatQuickReplyTypeLabel(businessType),
            hint: normalizeText(template.hint),
            text
        });
    });

    return normalized.slice(0, 12);
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
        content: formatAlertTimestampsInsideText(content),
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
                },
                payment_refund_ops: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.payment_refund_ops.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.payment_refund_ops.allow_critical
                },
                payment_config: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.payment_config.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.payment_config.allow_critical
                },
                shop_order_risk: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.shop_order_risk.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.shop_order_risk.allow_critical
                },
                admin_login_anomaly: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.admin_login_anomaly.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.admin_login_anomaly.allow_critical
                },
                tickets: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.tickets.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.tickets.allow_critical
                },
                shop_order_delivery: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.shop_order_delivery.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.shop_order_delivery.allow_critical
                },
                payment_gateway: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.payment_gateway.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.payment_gateway.allow_critical
                },
                verify_quota: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.verify_quota.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.verify_quota.allow_critical
                },
                verify_queue: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.verify_queue.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.verify_queue.allow_critical
                },
                verify_failure: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.verify_failure.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.verify_failure.allow_critical
                },
                kvm4_watchdog: {
                    until: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.kvm4_watchdog.until,
                    allow_critical: DEFAULT_OPS_ALERTS_CONFIG.mute_rules.types.kvm4_watchdog.allow_critical
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
            },
            payment_refund_ops: {
                telegram: DEFAULT_OPS_ALERTS_CONFIG.routing.payment_refund_ops.telegram,
                feishu: DEFAULT_OPS_ALERTS_CONFIG.routing.payment_refund_ops.feishu,
                email: DEFAULT_OPS_ALERTS_CONFIG.routing.payment_refund_ops.email
            },
            payment_config: {
                telegram: DEFAULT_OPS_ALERTS_CONFIG.routing.payment_config.telegram,
                feishu: DEFAULT_OPS_ALERTS_CONFIG.routing.payment_config.feishu,
                email: DEFAULT_OPS_ALERTS_CONFIG.routing.payment_config.email
            },
            shop_order_risk: {
                telegram: DEFAULT_OPS_ALERTS_CONFIG.routing.shop_order_risk.telegram,
                feishu: DEFAULT_OPS_ALERTS_CONFIG.routing.shop_order_risk.feishu,
                email: DEFAULT_OPS_ALERTS_CONFIG.routing.shop_order_risk.email
            },
            admin_login_anomaly: {
                telegram: DEFAULT_OPS_ALERTS_CONFIG.routing.admin_login_anomaly.telegram,
                feishu: DEFAULT_OPS_ALERTS_CONFIG.routing.admin_login_anomaly.feishu,
                email: DEFAULT_OPS_ALERTS_CONFIG.routing.admin_login_anomaly.email
            },
            tickets: {
                telegram: DEFAULT_OPS_ALERTS_CONFIG.routing.tickets.telegram,
                feishu: DEFAULT_OPS_ALERTS_CONFIG.routing.tickets.feishu,
                email: DEFAULT_OPS_ALERTS_CONFIG.routing.tickets.email
            },
            shop_order_delivery: {
                telegram: DEFAULT_OPS_ALERTS_CONFIG.routing.shop_order_delivery.telegram,
                feishu: DEFAULT_OPS_ALERTS_CONFIG.routing.shop_order_delivery.feishu,
                email: DEFAULT_OPS_ALERTS_CONFIG.routing.shop_order_delivery.email
            },
            payment_gateway: {
                telegram: DEFAULT_OPS_ALERTS_CONFIG.routing.payment_gateway.telegram,
                feishu: DEFAULT_OPS_ALERTS_CONFIG.routing.payment_gateway.feishu,
                email: DEFAULT_OPS_ALERTS_CONFIG.routing.payment_gateway.email
            },
            verify_quota: {
                telegram: DEFAULT_OPS_ALERTS_CONFIG.routing.verify_quota.telegram,
                feishu: DEFAULT_OPS_ALERTS_CONFIG.routing.verify_quota.feishu,
                email: DEFAULT_OPS_ALERTS_CONFIG.routing.verify_quota.email
            },
            verify_queue: {
                telegram: DEFAULT_OPS_ALERTS_CONFIG.routing.verify_queue.telegram,
                feishu: DEFAULT_OPS_ALERTS_CONFIG.routing.verify_queue.feishu,
                email: DEFAULT_OPS_ALERTS_CONFIG.routing.verify_queue.email
            },
            verify_failure: {
                telegram: DEFAULT_OPS_ALERTS_CONFIG.routing.verify_failure.telegram,
                feishu: DEFAULT_OPS_ALERTS_CONFIG.routing.verify_failure.feishu,
                email: DEFAULT_OPS_ALERTS_CONFIG.routing.verify_failure.email
            },
            kvm4_watchdog: {
                telegram: DEFAULT_OPS_ALERTS_CONFIG.routing.kvm4_watchdog.telegram,
                feishu: DEFAULT_OPS_ALERTS_CONFIG.routing.kvm4_watchdog.feishu,
                email: DEFAULT_OPS_ALERTS_CONFIG.routing.kvm4_watchdog.email
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
            summary_daily_minute: DEFAULT_OPS_ALERTS_CONFIG.customer_chat_message.summary_daily_minute,
            quick_reply_templates: getDefaultCustomerChatQuickReplyTemplates()
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
        },
        admin_login_anomaly: {
            enabled: DEFAULT_OPS_ALERTS_CONFIG.admin_login_anomaly.enabled,
            sweep_interval_ms: DEFAULT_OPS_ALERTS_CONFIG.admin_login_anomaly.sweep_interval_ms,
            recent_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.admin_login_anomaly.recent_window_minutes,
            baseline_lookback_days: DEFAULT_OPS_ALERTS_CONFIG.admin_login_anomaly.baseline_lookback_days,
            dedupe_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.admin_login_anomaly.dedupe_window_minutes,
            ip_grouping_enabled: DEFAULT_OPS_ALERTS_CONFIG.admin_login_anomaly.ip_grouping_enabled,
            ipv4_group_prefix_bits: DEFAULT_OPS_ALERTS_CONFIG.admin_login_anomaly.ipv4_group_prefix_bits,
            ipv6_group_prefix_bits: DEFAULT_OPS_ALERTS_CONFIG.admin_login_anomaly.ipv6_group_prefix_bits,
            recent_distinct_ip_group_threshold: DEFAULT_OPS_ALERTS_CONFIG.admin_login_anomaly.recent_distinct_ip_group_threshold,
            user_agent_family_grouping_enabled: DEFAULT_OPS_ALERTS_CONFIG.admin_login_anomaly.user_agent_family_grouping_enabled,
            recent_distinct_user_agent_family_threshold: DEFAULT_OPS_ALERTS_CONFIG.admin_login_anomaly.recent_distinct_user_agent_family_threshold,
            page_size: DEFAULT_OPS_ALERTS_CONFIG.admin_login_anomaly.page_size,
            max_pages: DEFAULT_OPS_ALERTS_CONFIG.admin_login_anomaly.max_pages
        },
        tickets: {
            enabled: DEFAULT_OPS_ALERTS_CONFIG.tickets.enabled,
            sweep_interval_ms: DEFAULT_OPS_ALERTS_CONFIG.tickets.sweep_interval_ms,
            pending_overdue_minutes: DEFAULT_OPS_ALERTS_CONFIG.tickets.pending_overdue_minutes,
            critical_overdue_minutes: DEFAULT_OPS_ALERTS_CONFIG.tickets.critical_overdue_minutes,
            state_lookback_minutes: DEFAULT_OPS_ALERTS_CONFIG.tickets.state_lookback_minutes,
            dedupe_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.tickets.dedupe_window_minutes,
            page_size: DEFAULT_OPS_ALERTS_CONFIG.tickets.page_size,
            max_pages: DEFAULT_OPS_ALERTS_CONFIG.tickets.max_pages,
            work_hours_only_enabled: DEFAULT_OPS_ALERTS_CONFIG.tickets.work_hours_only_enabled,
            summary_enabled: DEFAULT_OPS_ALERTS_CONFIG.tickets.summary_enabled,
            summary_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.tickets.summary_window_minutes,
            summary_max_items: DEFAULT_OPS_ALERTS_CONFIG.tickets.summary_max_items,
            summary_schedule_mode: DEFAULT_OPS_ALERTS_CONFIG.tickets.summary_schedule_mode,
            summary_hourly_minute: DEFAULT_OPS_ALERTS_CONFIG.tickets.summary_hourly_minute,
            summary_daily_hour: DEFAULT_OPS_ALERTS_CONFIG.tickets.summary_daily_hour,
            summary_daily_minute: DEFAULT_OPS_ALERTS_CONFIG.tickets.summary_daily_minute,
            reply_templates: getDefaultTicketReplyTemplates()
        },
        shop_order_delivery: {
            enabled: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.enabled,
            sweep_interval_ms: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.sweep_interval_ms,
            lookback_days: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.lookback_days,
            state_lookback_minutes: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.state_lookback_minutes,
            retry_waiting_min_attempts: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.retry_waiting_min_attempts,
            dedupe_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.dedupe_window_minutes,
            incident_enabled: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.incident_enabled,
            incident_min_order_count: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.incident_min_order_count,
            incident_min_dead_letter_count: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.incident_min_dead_letter_count,
            incident_min_distinct_users: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.incident_min_distinct_users,
            incident_dedupe_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.incident_dedupe_window_minutes,
            page_size: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.page_size,
            max_pages: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.max_pages,
            work_hours_only_enabled: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.work_hours_only_enabled,
            summary_enabled: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.summary_enabled,
            summary_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.summary_window_minutes,
            summary_max_items: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.summary_max_items,
            summary_schedule_mode: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.summary_schedule_mode,
            summary_hourly_minute: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.summary_hourly_minute,
            summary_daily_hour: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.summary_daily_hour,
            summary_daily_minute: DEFAULT_OPS_ALERTS_CONFIG.shop_order_delivery.summary_daily_minute
        },
        verify_quota: {
            enabled: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.enabled,
            sweep_interval_ms: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.sweep_interval_ms,
            request_timeout_ms: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.request_timeout_ms,
            low_balance_threshold: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.low_balance_threshold,
            low_remaining_jobs_threshold: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.low_remaining_jobs_threshold,
            critical_balance_threshold: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.critical_balance_threshold,
            critical_remaining_jobs_threshold: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.critical_remaining_jobs_threshold,
            min_queue_buffer_jobs: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.min_queue_buffer_jobs,
            dedupe_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.dedupe_window_minutes,
            work_hours_only_enabled: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.work_hours_only_enabled,
            summary_enabled: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.summary_enabled,
            summary_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.summary_window_minutes,
            summary_max_items: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.summary_max_items,
            summary_schedule_mode: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.summary_schedule_mode,
            summary_hourly_minute: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.summary_hourly_minute,
            summary_daily_hour: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.summary_daily_hour,
            summary_daily_minute: DEFAULT_OPS_ALERTS_CONFIG.verify_quota.summary_daily_minute
        },
        verify_queue: {
            enabled: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.enabled,
            sweep_interval_ms: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.sweep_interval_ms,
            request_timeout_ms: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.request_timeout_ms,
            recent_activity_lookback_hours: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.recent_activity_lookback_hours,
            recent_failure_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.recent_failure_window_minutes,
            queue_size_threshold: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.queue_size_threshold,
            active_job_threshold: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.active_job_threshold,
            oldest_pending_minutes_threshold: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.oldest_pending_minutes_threshold,
            recent_failure_threshold: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.recent_failure_threshold,
            dedupe_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.dedupe_window_minutes,
            page_size: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.page_size,
            max_pages: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.max_pages,
            work_hours_only_enabled: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.work_hours_only_enabled,
            summary_enabled: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.summary_enabled,
            summary_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.summary_window_minutes,
            summary_max_items: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.summary_max_items,
            summary_schedule_mode: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.summary_schedule_mode,
            summary_hourly_minute: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.summary_hourly_minute,
            summary_daily_hour: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.summary_daily_hour,
            summary_daily_minute: DEFAULT_OPS_ALERTS_CONFIG.verify_queue.summary_daily_minute
        },
        verify_failure: {
            enabled: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.enabled,
            sweep_interval_ms: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.sweep_interval_ms,
            recent_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.recent_window_minutes,
            min_total_jobs_threshold: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.min_total_jobs_threshold,
            failure_rate_threshold: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.failure_rate_threshold,
            affected_user_threshold: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.affected_user_threshold,
            dedupe_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.dedupe_window_minutes,
            page_size: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.page_size,
            max_pages: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.max_pages,
            work_hours_only_enabled: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.work_hours_only_enabled,
            summary_enabled: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.summary_enabled,
            summary_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.summary_window_minutes,
            summary_max_items: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.summary_max_items,
            summary_schedule_mode: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.summary_schedule_mode,
            summary_hourly_minute: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.summary_hourly_minute,
            summary_daily_hour: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.summary_daily_hour,
            summary_daily_minute: DEFAULT_OPS_ALERTS_CONFIG.verify_failure.summary_daily_minute
        },
        payment_gateway: {
            enabled: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.enabled,
            window_minutes: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.window_minutes,
            state_lookback_minutes: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.state_lookback_minutes,
            sweep_interval_ms: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.sweep_interval_ms,
            dedupe_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.dedupe_window_minutes,
            min_order_volume: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.min_order_volume,
            min_review_orders: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.min_review_orders,
            min_failed_orders: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.min_failed_orders,
            min_webhook_volume: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.min_webhook_volume,
            min_query_volume: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.min_query_volume,
            max_paid_rate_percent: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.max_paid_rate_percent,
            min_review_ratio_percent: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.min_review_ratio_percent,
            min_failed_ratio_percent: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.min_failed_ratio_percent,
            max_webhook_success_rate_percent: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.max_webhook_success_rate_percent,
            max_query_success_rate_percent: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.max_query_success_rate_percent,
            min_webhook_5xx_count: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.min_webhook_5xx_count,
            min_query_5xx_count: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.min_query_5xx_count,
            page_size: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.page_size,
            max_pages: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.max_pages,
            work_hours_only_enabled: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.work_hours_only_enabled,
            summary_enabled: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.summary_enabled,
            summary_window_minutes: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.summary_window_minutes,
            summary_max_items: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.summary_max_items,
            summary_schedule_mode: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.summary_schedule_mode,
            summary_hourly_minute: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.summary_hourly_minute,
            summary_daily_hour: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.summary_daily_hour,
            summary_daily_minute: DEFAULT_OPS_ALERTS_CONFIG.payment_gateway.summary_daily_minute
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
    const adminLoginAnomalyConfig = source.admin_login_anomaly && typeof source.admin_login_anomaly === 'object'
        ? source.admin_login_anomaly
        : {};
    const ticketsConfig = source.tickets && typeof source.tickets === 'object'
        ? source.tickets
        : {};
    const shopOrderDeliveryConfig = source.shop_order_delivery && typeof source.shop_order_delivery === 'object'
        ? source.shop_order_delivery
        : {};
    const verifyQuotaConfig = source.verify_quota && typeof source.verify_quota === 'object'
        ? source.verify_quota
        : {};
    const verifyQueueConfig = source.verify_queue && typeof source.verify_queue === 'object'
        ? source.verify_queue
        : {};
    const verifyFailureConfig = source.verify_failure && typeof source.verify_failure === 'object'
        ? source.verify_failure
        : {};
    const paymentGatewayConfig = source.payment_gateway && typeof source.payment_gateway === 'object'
        ? source.payment_gateway
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
    config.customer_chat_message.quick_reply_templates = normalizeCustomerChatQuickReplyTemplates(
        customerChatMessageConfig.quick_reply_templates
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

    config.admin_login_anomaly.enabled = normalizeBoolean(
        adminLoginAnomalyConfig.enabled,
        normalizeBoolean(env?.ADMIN_LOGIN_ANOMALY_MONITOR_ENABLED, config.admin_login_anomaly.enabled)
    );
    config.admin_login_anomaly.sweep_interval_ms = normalizeNumber(
        adminLoginAnomalyConfig.sweep_interval_ms,
        normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_SWEEP_INTERVAL_MS, config.admin_login_anomaly.sweep_interval_ms, 10000, 60 * 60 * 1000),
        10000,
        60 * 60 * 1000
    );
    config.admin_login_anomaly.recent_window_minutes = normalizeNumber(
        adminLoginAnomalyConfig.recent_window_minutes,
        normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_RECENT_WINDOW_MINUTES, config.admin_login_anomaly.recent_window_minutes, 5, 24 * 60),
        5,
        24 * 60
    );
    config.admin_login_anomaly.baseline_lookback_days = normalizeNumber(
        adminLoginAnomalyConfig.baseline_lookback_days,
        normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_BASELINE_LOOKBACK_DAYS, config.admin_login_anomaly.baseline_lookback_days, 1, 180),
        1,
        180
    );
    config.admin_login_anomaly.dedupe_window_minutes = normalizeNumber(
        adminLoginAnomalyConfig.dedupe_window_minutes,
        normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_DEDUPE_WINDOW_MINUTES, config.admin_login_anomaly.dedupe_window_minutes, 1, 24 * 60),
        1,
        24 * 60
    );
    config.admin_login_anomaly.ip_grouping_enabled = normalizeBoolean(
        adminLoginAnomalyConfig.ip_grouping_enabled,
        normalizeBoolean(env?.ADMIN_LOGIN_ANOMALY_MONITOR_IP_GROUPING_ENABLED, config.admin_login_anomaly.ip_grouping_enabled)
    );
    config.admin_login_anomaly.ipv4_group_prefix_bits = Math.round(normalizeNumber(
        adminLoginAnomalyConfig.ipv4_group_prefix_bits,
        normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_IPV4_GROUP_PREFIX_BITS, config.admin_login_anomaly.ipv4_group_prefix_bits, 8, 32),
        8,
        32
    ));
    config.admin_login_anomaly.ipv6_group_prefix_bits = Math.round(normalizeNumber(
        adminLoginAnomalyConfig.ipv6_group_prefix_bits,
        normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_IPV6_GROUP_PREFIX_BITS, config.admin_login_anomaly.ipv6_group_prefix_bits, 16, 128),
        16,
        128
    ));
    config.admin_login_anomaly.recent_distinct_ip_group_threshold = Math.round(normalizeNumber(
        adminLoginAnomalyConfig.recent_distinct_ip_group_threshold,
        normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_RECENT_DISTINCT_IP_GROUP_THRESHOLD, config.admin_login_anomaly.recent_distinct_ip_group_threshold, 2, 20),
        2,
        20
    ));
    config.admin_login_anomaly.user_agent_family_grouping_enabled = normalizeBoolean(
        adminLoginAnomalyConfig.user_agent_family_grouping_enabled,
        normalizeBoolean(env?.ADMIN_LOGIN_ANOMALY_MONITOR_UA_FAMILY_GROUPING_ENABLED, config.admin_login_anomaly.user_agent_family_grouping_enabled)
    );
    config.admin_login_anomaly.recent_distinct_user_agent_family_threshold = Math.round(normalizeNumber(
        adminLoginAnomalyConfig.recent_distinct_user_agent_family_threshold,
        normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_RECENT_DISTINCT_UA_FAMILY_THRESHOLD, config.admin_login_anomaly.recent_distinct_user_agent_family_threshold, 2, 20),
        2,
        20
    ));
    config.admin_login_anomaly.page_size = normalizeNumber(
        adminLoginAnomalyConfig.page_size,
        normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_PAGE_SIZE, config.admin_login_anomaly.page_size, 50, 5000),
        50,
        5000
    );
    config.admin_login_anomaly.max_pages = normalizeNumber(
        adminLoginAnomalyConfig.max_pages,
        normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_MAX_PAGES, config.admin_login_anomaly.max_pages, 1, 100),
        1,
        100
    );

    config.tickets.enabled = normalizeBoolean(
        ticketsConfig.enabled,
        normalizeBoolean(env?.TICKET_SLA_MONITOR_ENABLED, config.tickets.enabled)
    );
    config.tickets.sweep_interval_ms = normalizeNumber(
        ticketsConfig.sweep_interval_ms,
        normalizeNumber(env?.TICKET_SLA_MONITOR_SWEEP_INTERVAL_MS, config.tickets.sweep_interval_ms, 10000, 60 * 60 * 1000),
        10000,
        60 * 60 * 1000
    );
    config.tickets.pending_overdue_minutes = normalizeNumber(
        ticketsConfig.pending_overdue_minutes,
        normalizeNumber(env?.TICKET_SLA_MONITOR_PENDING_OVERDUE_MINUTES, config.tickets.pending_overdue_minutes, 5, 14 * 24 * 60),
        5,
        14 * 24 * 60
    );
    config.tickets.critical_overdue_minutes = normalizeNumber(
        ticketsConfig.critical_overdue_minutes,
        normalizeNumber(env?.TICKET_SLA_MONITOR_CRITICAL_OVERDUE_MINUTES, config.tickets.critical_overdue_minutes, 30, 30 * 24 * 60),
        30,
        30 * 24 * 60
    );
    config.tickets.state_lookback_minutes = normalizeNumber(
        ticketsConfig.state_lookback_minutes,
        normalizeNumber(env?.TICKET_SLA_MONITOR_STATE_LOOKBACK_MINUTES, config.tickets.state_lookback_minutes, 30, 7 * 24 * 60),
        30,
        7 * 24 * 60
    );
    config.tickets.dedupe_window_minutes = normalizeNumber(
        ticketsConfig.dedupe_window_minutes,
        normalizeNumber(env?.TICKET_SLA_MONITOR_DEDUPE_WINDOW_MINUTES, config.tickets.dedupe_window_minutes, 1, 24 * 60),
        1,
        24 * 60
    );
    config.tickets.page_size = normalizeNumber(
        ticketsConfig.page_size,
        normalizeNumber(env?.TICKET_SLA_MONITOR_PAGE_SIZE, config.tickets.page_size, 50, 5000),
        50,
        5000
    );
    config.tickets.max_pages = normalizeNumber(
        ticketsConfig.max_pages,
        normalizeNumber(env?.TICKET_SLA_MONITOR_MAX_PAGES, config.tickets.max_pages, 1, 100),
        1,
        100
    );
    config.tickets.work_hours_only_enabled = normalizeBoolean(
        ticketsConfig.work_hours_only_enabled,
        config.tickets.work_hours_only_enabled
    );
    config.tickets.summary_enabled = normalizeBoolean(
        ticketsConfig.summary_enabled,
        config.tickets.summary_enabled
    );
    config.tickets.summary_window_minutes = normalizeNumber(
        ticketsConfig.summary_window_minutes,
        config.tickets.summary_window_minutes,
        5,
        24 * 60
    );
    config.tickets.summary_max_items = normalizeNumber(
        ticketsConfig.summary_max_items,
        config.tickets.summary_max_items,
        1,
        50
    );
    config.tickets.summary_schedule_mode = normalizeSummaryScheduleMode(
        ticketsConfig.summary_schedule_mode,
        config.tickets.summary_schedule_mode
    );
    config.tickets.summary_hourly_minute = normalizeNumber(
        ticketsConfig.summary_hourly_minute,
        config.tickets.summary_hourly_minute,
        0,
        59
    );
    config.tickets.summary_daily_hour = normalizeNumber(
        ticketsConfig.summary_daily_hour,
        config.tickets.summary_daily_hour,
        0,
        23
    );
    config.tickets.summary_daily_minute = normalizeNumber(
        ticketsConfig.summary_daily_minute,
        config.tickets.summary_daily_minute,
        0,
        59
    );
    config.tickets.reply_templates = normalizeTicketReplyTemplates(
        ticketsConfig.reply_templates
    );

    config.shop_order_delivery.enabled = normalizeBoolean(
        shopOrderDeliveryConfig.enabled,
        normalizeBoolean(env?.SHOP_ORDER_DELIVERY_MONITOR_ENABLED, config.shop_order_delivery.enabled)
    );
    config.shop_order_delivery.sweep_interval_ms = normalizeNumber(
        shopOrderDeliveryConfig.sweep_interval_ms,
        normalizeNumber(env?.SHOP_ORDER_DELIVERY_MONITOR_SWEEP_INTERVAL_MS, config.shop_order_delivery.sweep_interval_ms, 10000, 60 * 60 * 1000),
        10000,
        60 * 60 * 1000
    );
    config.shop_order_delivery.lookback_days = normalizeNumber(
        shopOrderDeliveryConfig.lookback_days,
        normalizeNumber(env?.SHOP_ORDER_DELIVERY_MONITOR_LOOKBACK_DAYS, config.shop_order_delivery.lookback_days, 1, 90),
        1,
        90
    );
    config.shop_order_delivery.state_lookback_minutes = normalizeNumber(
        shopOrderDeliveryConfig.state_lookback_minutes,
        normalizeNumber(env?.SHOP_ORDER_DELIVERY_MONITOR_STATE_LOOKBACK_MINUTES, config.shop_order_delivery.state_lookback_minutes, 30, 7 * 24 * 60),
        30,
        7 * 24 * 60
    );
    config.shop_order_delivery.retry_waiting_min_attempts = normalizeNumber(
        shopOrderDeliveryConfig.retry_waiting_min_attempts,
        normalizeNumber(env?.SHOP_ORDER_DELIVERY_MONITOR_RETRY_WAITING_MIN_ATTEMPTS, config.shop_order_delivery.retry_waiting_min_attempts, 1, 50),
        1,
        50
    );
    config.shop_order_delivery.dedupe_window_minutes = normalizeNumber(
        shopOrderDeliveryConfig.dedupe_window_minutes,
        normalizeNumber(env?.SHOP_ORDER_DELIVERY_MONITOR_DEDUPE_WINDOW_MINUTES, config.shop_order_delivery.dedupe_window_minutes, 1, 24 * 60),
        1,
        24 * 60
    );
    config.shop_order_delivery.incident_enabled = normalizeBoolean(
        shopOrderDeliveryConfig.incident_enabled,
        normalizeBoolean(env?.SHOP_ORDER_DELIVERY_INCIDENT_ENABLED, config.shop_order_delivery.incident_enabled)
    );
    config.shop_order_delivery.incident_min_order_count = normalizeNumber(
        shopOrderDeliveryConfig.incident_min_order_count,
        normalizeNumber(env?.SHOP_ORDER_DELIVERY_INCIDENT_MIN_ORDER_COUNT, config.shop_order_delivery.incident_min_order_count, 2, 50),
        2,
        50
    );
    config.shop_order_delivery.incident_min_dead_letter_count = normalizeNumber(
        shopOrderDeliveryConfig.incident_min_dead_letter_count,
        normalizeNumber(env?.SHOP_ORDER_DELIVERY_INCIDENT_MIN_DEAD_LETTER_COUNT, config.shop_order_delivery.incident_min_dead_letter_count, 0, 50),
        0,
        50
    );
    config.shop_order_delivery.incident_min_distinct_users = normalizeNumber(
        shopOrderDeliveryConfig.incident_min_distinct_users,
        normalizeNumber(env?.SHOP_ORDER_DELIVERY_INCIDENT_MIN_DISTINCT_USERS, config.shop_order_delivery.incident_min_distinct_users, 1, 50),
        1,
        50
    );
    config.shop_order_delivery.incident_dedupe_window_minutes = normalizeNumber(
        shopOrderDeliveryConfig.incident_dedupe_window_minutes,
        normalizeNumber(env?.SHOP_ORDER_DELIVERY_INCIDENT_DEDUPE_WINDOW_MINUTES, config.shop_order_delivery.incident_dedupe_window_minutes, 1, 24 * 60),
        1,
        24 * 60
    );
    config.shop_order_delivery.page_size = normalizeNumber(
        shopOrderDeliveryConfig.page_size,
        normalizeNumber(env?.SHOP_ORDER_DELIVERY_MONITOR_PAGE_SIZE, config.shop_order_delivery.page_size, 50, 5000),
        50,
        5000
    );
    config.shop_order_delivery.max_pages = normalizeNumber(
        shopOrderDeliveryConfig.max_pages,
        normalizeNumber(env?.SHOP_ORDER_DELIVERY_MONITOR_MAX_PAGES, config.shop_order_delivery.max_pages, 1, 100),
        1,
        100
    );
    config.shop_order_delivery.work_hours_only_enabled = normalizeBoolean(
        shopOrderDeliveryConfig.work_hours_only_enabled,
        config.shop_order_delivery.work_hours_only_enabled
    );
    config.shop_order_delivery.summary_enabled = normalizeBoolean(
        shopOrderDeliveryConfig.summary_enabled,
        config.shop_order_delivery.summary_enabled
    );
    config.shop_order_delivery.summary_window_minutes = normalizeNumber(
        shopOrderDeliveryConfig.summary_window_minutes,
        config.shop_order_delivery.summary_window_minutes,
        5,
        24 * 60
    );
    config.shop_order_delivery.summary_max_items = normalizeNumber(
        shopOrderDeliveryConfig.summary_max_items,
        config.shop_order_delivery.summary_max_items,
        1,
        50
    );
    config.shop_order_delivery.summary_schedule_mode = normalizeSummaryScheduleMode(
        shopOrderDeliveryConfig.summary_schedule_mode,
        config.shop_order_delivery.summary_schedule_mode
    );
    config.shop_order_delivery.summary_hourly_minute = normalizeNumber(
        shopOrderDeliveryConfig.summary_hourly_minute,
        config.shop_order_delivery.summary_hourly_minute,
        0,
        59
    );
    config.shop_order_delivery.summary_daily_hour = normalizeNumber(
        shopOrderDeliveryConfig.summary_daily_hour,
        config.shop_order_delivery.summary_daily_hour,
        0,
        23
    );
    config.shop_order_delivery.summary_daily_minute = normalizeNumber(
        shopOrderDeliveryConfig.summary_daily_minute,
        config.shop_order_delivery.summary_daily_minute,
        0,
        59
    );

    config.verify_quota.enabled = normalizeBoolean(
        verifyQuotaConfig.enabled,
        normalizeBoolean(env?.VERIFY_QUOTA_MONITOR_ENABLED, config.verify_quota.enabled)
    );
    config.verify_quota.sweep_interval_ms = normalizeNumber(
        verifyQuotaConfig.sweep_interval_ms,
        normalizeNumber(env?.VERIFY_QUOTA_MONITOR_SWEEP_INTERVAL_MS, config.verify_quota.sweep_interval_ms, 10000, 60 * 60 * 1000),
        10000,
        60 * 60 * 1000
    );
    config.verify_quota.request_timeout_ms = normalizeNumber(
        verifyQuotaConfig.request_timeout_ms,
        normalizeNumber(env?.VERIFY_QUOTA_MONITOR_REQUEST_TIMEOUT_MS, config.verify_quota.request_timeout_ms, 1000, 60 * 1000),
        1000,
        60 * 1000
    );
    config.verify_quota.low_balance_threshold = normalizeNumber(
        verifyQuotaConfig.low_balance_threshold,
        normalizeNumber(env?.VERIFY_QUOTA_MONITOR_LOW_BALANCE_THRESHOLD, config.verify_quota.low_balance_threshold, 0, 1000000),
        0,
        1000000
    );
    config.verify_quota.low_remaining_jobs_threshold = normalizeNumber(
        verifyQuotaConfig.low_remaining_jobs_threshold,
        normalizeNumber(env?.VERIFY_QUOTA_MONITOR_LOW_REMAINING_JOBS_THRESHOLD, config.verify_quota.low_remaining_jobs_threshold, 0, 1000000),
        0,
        1000000
    );
    config.verify_quota.critical_balance_threshold = normalizeNumber(
        verifyQuotaConfig.critical_balance_threshold,
        normalizeNumber(env?.VERIFY_QUOTA_MONITOR_CRITICAL_BALANCE_THRESHOLD, config.verify_quota.critical_balance_threshold, 0, 1000000),
        0,
        1000000
    );
    config.verify_quota.critical_remaining_jobs_threshold = normalizeNumber(
        verifyQuotaConfig.critical_remaining_jobs_threshold,
        normalizeNumber(env?.VERIFY_QUOTA_MONITOR_CRITICAL_REMAINING_JOBS_THRESHOLD, config.verify_quota.critical_remaining_jobs_threshold, 0, 1000000),
        0,
        1000000
    );
    config.verify_quota.min_queue_buffer_jobs = normalizeNumber(
        verifyQuotaConfig.min_queue_buffer_jobs,
        normalizeNumber(env?.VERIFY_QUOTA_MONITOR_MIN_QUEUE_BUFFER_JOBS, config.verify_quota.min_queue_buffer_jobs, 0, 1000000),
        0,
        1000000
    );
    config.verify_quota.dedupe_window_minutes = normalizeNumber(
        verifyQuotaConfig.dedupe_window_minutes,
        normalizeNumber(env?.VERIFY_QUOTA_MONITOR_DEDUPE_WINDOW_MINUTES, config.verify_quota.dedupe_window_minutes, 1, 24 * 60),
        1,
        24 * 60
    );
    config.verify_quota.work_hours_only_enabled = normalizeBoolean(
        verifyQuotaConfig.work_hours_only_enabled,
        config.verify_quota.work_hours_only_enabled
    );
    config.verify_quota.summary_enabled = normalizeBoolean(
        verifyQuotaConfig.summary_enabled,
        config.verify_quota.summary_enabled
    );
    config.verify_quota.summary_window_minutes = normalizeNumber(
        verifyQuotaConfig.summary_window_minutes,
        config.verify_quota.summary_window_minutes,
        5,
        24 * 60
    );
    config.verify_quota.summary_max_items = normalizeNumber(
        verifyQuotaConfig.summary_max_items,
        config.verify_quota.summary_max_items,
        1,
        50
    );
    config.verify_quota.summary_schedule_mode = normalizeSummaryScheduleMode(
        verifyQuotaConfig.summary_schedule_mode,
        config.verify_quota.summary_schedule_mode
    );
    config.verify_quota.summary_hourly_minute = normalizeNumber(
        verifyQuotaConfig.summary_hourly_minute,
        config.verify_quota.summary_hourly_minute,
        0,
        59
    );
    config.verify_quota.summary_daily_hour = normalizeNumber(
        verifyQuotaConfig.summary_daily_hour,
        config.verify_quota.summary_daily_hour,
        0,
        23
    );
    config.verify_quota.summary_daily_minute = normalizeNumber(
        verifyQuotaConfig.summary_daily_minute,
        config.verify_quota.summary_daily_minute,
        0,
        59
    );

    config.verify_queue.enabled = normalizeBoolean(
        verifyQueueConfig.enabled,
        normalizeBoolean(env?.VERIFY_QUEUE_MONITOR_ENABLED, config.verify_queue.enabled)
    );
    config.verify_queue.sweep_interval_ms = normalizeNumber(
        verifyQueueConfig.sweep_interval_ms,
        normalizeNumber(env?.VERIFY_QUEUE_MONITOR_SWEEP_INTERVAL_MS, config.verify_queue.sweep_interval_ms, 10000, 60 * 60 * 1000),
        10000,
        60 * 60 * 1000
    );
    config.verify_queue.request_timeout_ms = normalizeNumber(
        verifyQueueConfig.request_timeout_ms,
        normalizeNumber(env?.VERIFY_QUEUE_MONITOR_REQUEST_TIMEOUT_MS, config.verify_queue.request_timeout_ms, 1000, 60 * 1000),
        1000,
        60 * 1000
    );
    config.verify_queue.recent_activity_lookback_hours = normalizeNumber(
        verifyQueueConfig.recent_activity_lookback_hours,
        normalizeNumber(env?.VERIFY_QUEUE_MONITOR_RECENT_ACTIVITY_LOOKBACK_HOURS, config.verify_queue.recent_activity_lookback_hours, 1, 72),
        1,
        72
    );
    config.verify_queue.recent_failure_window_minutes = normalizeNumber(
        verifyQueueConfig.recent_failure_window_minutes,
        normalizeNumber(env?.VERIFY_QUEUE_MONITOR_RECENT_FAILURE_WINDOW_MINUTES, config.verify_queue.recent_failure_window_minutes, 5, 24 * 60),
        5,
        24 * 60
    );
    config.verify_queue.queue_size_threshold = normalizeNumber(
        verifyQueueConfig.queue_size_threshold,
        normalizeNumber(env?.VERIFY_QUEUE_MONITOR_QUEUE_SIZE_THRESHOLD, config.verify_queue.queue_size_threshold, 1, 100000),
        1,
        100000
    );
    config.verify_queue.active_job_threshold = normalizeNumber(
        verifyQueueConfig.active_job_threshold,
        normalizeNumber(env?.VERIFY_QUEUE_MONITOR_ACTIVE_JOB_THRESHOLD, config.verify_queue.active_job_threshold, 1, 100000),
        1,
        100000
    );
    config.verify_queue.oldest_pending_minutes_threshold = normalizeNumber(
        verifyQueueConfig.oldest_pending_minutes_threshold,
        normalizeNumber(env?.VERIFY_QUEUE_MONITOR_OLDEST_PENDING_MINUTES_THRESHOLD, config.verify_queue.oldest_pending_minutes_threshold, 1, 24 * 60),
        1,
        24 * 60
    );
    config.verify_queue.recent_failure_threshold = normalizeNumber(
        verifyQueueConfig.recent_failure_threshold,
        normalizeNumber(env?.VERIFY_QUEUE_MONITOR_RECENT_FAILURE_THRESHOLD, config.verify_queue.recent_failure_threshold, 1, 100000),
        1,
        100000
    );
    config.verify_queue.dedupe_window_minutes = normalizeNumber(
        verifyQueueConfig.dedupe_window_minutes,
        normalizeNumber(env?.VERIFY_QUEUE_MONITOR_DEDUPE_WINDOW_MINUTES, config.verify_queue.dedupe_window_minutes, 1, 24 * 60),
        1,
        24 * 60
    );
    config.verify_queue.page_size = normalizeNumber(
        verifyQueueConfig.page_size,
        normalizeNumber(env?.VERIFY_QUEUE_MONITOR_PAGE_SIZE, config.verify_queue.page_size, 50, 5000),
        50,
        5000
    );
    config.verify_queue.max_pages = normalizeNumber(
        verifyQueueConfig.max_pages,
        normalizeNumber(env?.VERIFY_QUEUE_MONITOR_MAX_PAGES, config.verify_queue.max_pages, 1, 100),
        1,
        100
    );
    config.verify_queue.work_hours_only_enabled = normalizeBoolean(
        verifyQueueConfig.work_hours_only_enabled,
        config.verify_queue.work_hours_only_enabled
    );
    config.verify_queue.summary_enabled = normalizeBoolean(
        verifyQueueConfig.summary_enabled,
        config.verify_queue.summary_enabled
    );
    config.verify_queue.summary_window_minutes = normalizeNumber(
        verifyQueueConfig.summary_window_minutes,
        config.verify_queue.summary_window_minutes,
        5,
        24 * 60
    );
    config.verify_queue.summary_max_items = normalizeNumber(
        verifyQueueConfig.summary_max_items,
        config.verify_queue.summary_max_items,
        1,
        50
    );
    config.verify_queue.summary_schedule_mode = normalizeSummaryScheduleMode(
        verifyQueueConfig.summary_schedule_mode,
        config.verify_queue.summary_schedule_mode
    );
    config.verify_queue.summary_hourly_minute = normalizeNumber(
        verifyQueueConfig.summary_hourly_minute,
        config.verify_queue.summary_hourly_minute,
        0,
        59
    );
    config.verify_queue.summary_daily_hour = normalizeNumber(
        verifyQueueConfig.summary_daily_hour,
        config.verify_queue.summary_daily_hour,
        0,
        23
    );
    config.verify_queue.summary_daily_minute = normalizeNumber(
        verifyQueueConfig.summary_daily_minute,
        config.verify_queue.summary_daily_minute,
        0,
        59
    );

    config.verify_failure.enabled = normalizeBoolean(
        verifyFailureConfig.enabled,
        normalizeBoolean(env?.VERIFY_FAILURE_MONITOR_ENABLED, config.verify_failure.enabled)
    );
    config.verify_failure.sweep_interval_ms = normalizeNumber(
        verifyFailureConfig.sweep_interval_ms,
        normalizeNumber(env?.VERIFY_FAILURE_MONITOR_SWEEP_INTERVAL_MS, config.verify_failure.sweep_interval_ms, 10000, 60 * 60 * 1000),
        10000,
        60 * 60 * 1000
    );
    config.verify_failure.recent_window_minutes = normalizeNumber(
        verifyFailureConfig.recent_window_minutes,
        normalizeNumber(env?.VERIFY_FAILURE_MONITOR_RECENT_WINDOW_MINUTES, config.verify_failure.recent_window_minutes, 5, 24 * 60),
        5,
        24 * 60
    );
    config.verify_failure.min_total_jobs_threshold = normalizeNumber(
        verifyFailureConfig.min_total_jobs_threshold,
        normalizeNumber(env?.VERIFY_FAILURE_MONITOR_MIN_TOTAL_JOBS_THRESHOLD, config.verify_failure.min_total_jobs_threshold, 1, 100000),
        1,
        100000
    );
    config.verify_failure.failure_rate_threshold = normalizeNumber(
        verifyFailureConfig.failure_rate_threshold,
        normalizeNumber(env?.VERIFY_FAILURE_MONITOR_FAILURE_RATE_THRESHOLD, config.verify_failure.failure_rate_threshold, 1, 100),
        1,
        100
    );
    config.verify_failure.affected_user_threshold = normalizeNumber(
        verifyFailureConfig.affected_user_threshold,
        normalizeNumber(env?.VERIFY_FAILURE_MONITOR_AFFECTED_USER_THRESHOLD, config.verify_failure.affected_user_threshold, 1, 100000),
        1,
        100000
    );
    config.verify_failure.dedupe_window_minutes = normalizeNumber(
        verifyFailureConfig.dedupe_window_minutes,
        normalizeNumber(env?.VERIFY_FAILURE_MONITOR_DEDUPE_WINDOW_MINUTES, config.verify_failure.dedupe_window_minutes, 1, 24 * 60),
        1,
        24 * 60
    );
    config.verify_failure.page_size = normalizeNumber(
        verifyFailureConfig.page_size,
        normalizeNumber(env?.VERIFY_FAILURE_MONITOR_PAGE_SIZE, config.verify_failure.page_size, 50, 5000),
        50,
        5000
    );
    config.verify_failure.max_pages = normalizeNumber(
        verifyFailureConfig.max_pages,
        normalizeNumber(env?.VERIFY_FAILURE_MONITOR_MAX_PAGES, config.verify_failure.max_pages, 1, 100),
        1,
        100
    );
    config.verify_failure.work_hours_only_enabled = normalizeBoolean(
        verifyFailureConfig.work_hours_only_enabled,
        config.verify_failure.work_hours_only_enabled
    );
    config.verify_failure.summary_enabled = normalizeBoolean(
        verifyFailureConfig.summary_enabled,
        config.verify_failure.summary_enabled
    );
    config.verify_failure.summary_window_minutes = normalizeNumber(
        verifyFailureConfig.summary_window_minutes,
        config.verify_failure.summary_window_minutes,
        5,
        24 * 60
    );
    config.verify_failure.summary_max_items = normalizeNumber(
        verifyFailureConfig.summary_max_items,
        config.verify_failure.summary_max_items,
        1,
        50
    );
    config.verify_failure.summary_schedule_mode = normalizeSummaryScheduleMode(
        verifyFailureConfig.summary_schedule_mode,
        config.verify_failure.summary_schedule_mode
    );
    config.verify_failure.summary_hourly_minute = normalizeNumber(
        verifyFailureConfig.summary_hourly_minute,
        config.verify_failure.summary_hourly_minute,
        0,
        59
    );
    config.verify_failure.summary_daily_hour = normalizeNumber(
        verifyFailureConfig.summary_daily_hour,
        config.verify_failure.summary_daily_hour,
        0,
        23
    );
    config.verify_failure.summary_daily_minute = normalizeNumber(
        verifyFailureConfig.summary_daily_minute,
        config.verify_failure.summary_daily_minute,
        0,
        59
    );

    config.payment_gateway.enabled = normalizeBoolean(
        paymentGatewayConfig.enabled,
        normalizeBoolean(env?.PAYMENT_GATEWAY_MONITOR_ENABLED, config.payment_gateway.enabled)
    );
    config.payment_gateway.window_minutes = normalizeNumber(
        paymentGatewayConfig.window_minutes,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_WINDOW_MINUTES, config.payment_gateway.window_minutes, 5, 24 * 60),
        5,
        24 * 60
    );
    config.payment_gateway.state_lookback_minutes = normalizeNumber(
        paymentGatewayConfig.state_lookback_minutes,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_STATE_LOOKBACK_MINUTES, config.payment_gateway.state_lookback_minutes, 30, 7 * 24 * 60),
        30,
        7 * 24 * 60
    );
    config.payment_gateway.sweep_interval_ms = normalizeNumber(
        paymentGatewayConfig.sweep_interval_ms,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_SWEEP_INTERVAL_MS, config.payment_gateway.sweep_interval_ms, 10000, 60 * 60 * 1000),
        10000,
        60 * 60 * 1000
    );
    config.payment_gateway.dedupe_window_minutes = normalizeNumber(
        paymentGatewayConfig.dedupe_window_minutes,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_DEDUPE_WINDOW_MINUTES, config.payment_gateway.dedupe_window_minutes, 1, 24 * 60),
        1,
        24 * 60
    );
    config.payment_gateway.min_order_volume = normalizeNumber(
        paymentGatewayConfig.min_order_volume,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_ORDER_VOLUME, config.payment_gateway.min_order_volume, 1, 200),
        1,
        200
    );
    config.payment_gateway.min_review_orders = normalizeNumber(
        paymentGatewayConfig.min_review_orders,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_REVIEW_ORDERS, config.payment_gateway.min_review_orders, 1, 100),
        1,
        100
    );
    config.payment_gateway.min_failed_orders = normalizeNumber(
        paymentGatewayConfig.min_failed_orders,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_FAILED_ORDERS, config.payment_gateway.min_failed_orders, 1, 100),
        1,
        100
    );
    config.payment_gateway.min_webhook_volume = normalizeNumber(
        paymentGatewayConfig.min_webhook_volume,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_WEBHOOK_VOLUME, config.payment_gateway.min_webhook_volume, 1, 500),
        1,
        500
    );
    config.payment_gateway.min_query_volume = normalizeNumber(
        paymentGatewayConfig.min_query_volume,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_QUERY_VOLUME, config.payment_gateway.min_query_volume, 1, 500),
        1,
        500
    );
    config.payment_gateway.max_paid_rate_percent = normalizeNumber(
        paymentGatewayConfig.max_paid_rate_percent,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MAX_PAID_RATE_PERCENT, config.payment_gateway.max_paid_rate_percent, 1, 100),
        1,
        100
    );
    config.payment_gateway.min_review_ratio_percent = normalizeNumber(
        paymentGatewayConfig.min_review_ratio_percent,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_REVIEW_RATIO_PERCENT, config.payment_gateway.min_review_ratio_percent, 1, 100),
        1,
        100
    );
    config.payment_gateway.min_failed_ratio_percent = normalizeNumber(
        paymentGatewayConfig.min_failed_ratio_percent,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_FAILED_RATIO_PERCENT, config.payment_gateway.min_failed_ratio_percent, 1, 100),
        1,
        100
    );
    config.payment_gateway.max_webhook_success_rate_percent = normalizeNumber(
        paymentGatewayConfig.max_webhook_success_rate_percent,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MAX_WEBHOOK_SUCCESS_RATE_PERCENT, config.payment_gateway.max_webhook_success_rate_percent, 1, 100),
        1,
        100
    );
    config.payment_gateway.max_query_success_rate_percent = normalizeNumber(
        paymentGatewayConfig.max_query_success_rate_percent,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MAX_QUERY_SUCCESS_RATE_PERCENT, config.payment_gateway.max_query_success_rate_percent, 1, 100),
        1,
        100
    );
    config.payment_gateway.min_webhook_5xx_count = normalizeNumber(
        paymentGatewayConfig.min_webhook_5xx_count,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_WEBHOOK_5XX_COUNT, config.payment_gateway.min_webhook_5xx_count, 1, 100),
        1,
        100
    );
    config.payment_gateway.min_query_5xx_count = normalizeNumber(
        paymentGatewayConfig.min_query_5xx_count,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MIN_QUERY_5XX_COUNT, config.payment_gateway.min_query_5xx_count, 1, 100),
        1,
        100
    );
    config.payment_gateway.page_size = normalizeNumber(
        paymentGatewayConfig.page_size,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_PAGE_SIZE, config.payment_gateway.page_size, 50, 5000),
        50,
        5000
    );
    config.payment_gateway.max_pages = normalizeNumber(
        paymentGatewayConfig.max_pages,
        normalizeNumber(env?.PAYMENT_GATEWAY_MONITOR_MAX_PAGES, config.payment_gateway.max_pages, 1, 100),
        1,
        100
    );
    config.payment_gateway.work_hours_only_enabled = normalizeBoolean(
        paymentGatewayConfig.work_hours_only_enabled,
        config.payment_gateway.work_hours_only_enabled
    );
    config.payment_gateway.summary_enabled = normalizeBoolean(
        paymentGatewayConfig.summary_enabled,
        config.payment_gateway.summary_enabled
    );
    config.payment_gateway.summary_window_minutes = normalizeNumber(
        paymentGatewayConfig.summary_window_minutes,
        config.payment_gateway.summary_window_minutes,
        5,
        24 * 60
    );
    config.payment_gateway.summary_max_items = normalizeNumber(
        paymentGatewayConfig.summary_max_items,
        config.payment_gateway.summary_max_items,
        1,
        50
    );
    config.payment_gateway.summary_schedule_mode = normalizeSummaryScheduleMode(
        paymentGatewayConfig.summary_schedule_mode,
        config.payment_gateway.summary_schedule_mode
    );
    config.payment_gateway.summary_hourly_minute = normalizeNumber(
        paymentGatewayConfig.summary_hourly_minute,
        config.payment_gateway.summary_hourly_minute,
        0,
        59
    );
    config.payment_gateway.summary_daily_hour = normalizeNumber(
        paymentGatewayConfig.summary_daily_hour,
        config.payment_gateway.summary_daily_hour,
        0,
        23
    );
    config.payment_gateway.summary_daily_minute = normalizeNumber(
        paymentGatewayConfig.summary_daily_minute,
        config.payment_gateway.summary_daily_minute,
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

function getOpsAlertSecretDisplayLabel(secretKey = '', envName = '') {
    const normalizedSecretKey = normalizeText(secretKey, 120).toLowerCase();
    if (normalizedSecretKey === 'ops_alert_telegram_bot_token') {
        return 'Telegram Bot Token';
    }
    if (normalizedSecretKey === 'ops_alert_feishu_webhook_url') {
        return '飞书 Webhook';
    }
    if (normalizedSecretKey === 'ops_alert_email_api_key') {
        return '邮件 API Key';
    }

    const normalizedEnvName = normalizeText(envName, 120).toUpperCase();
    if (normalizedEnvName === 'OPS_ALERTS_TELEGRAM_BOT_TOKEN') {
        return 'Telegram Bot Token';
    }
    if (normalizedEnvName === 'OPS_ALERTS_FEISHU_WEBHOOK_URL') {
        return '飞书 Webhook';
    }
    if (normalizedEnvName === 'OPS_ALERTS_EMAIL_API_KEY') {
        return '邮件 API Key';
    }

    return '告警通道密钥';
}

function buildOpsAlertSecretLoadErrorMessage(error, secretKey = '', envName = '') {
    const rawMessage = normalizeText(error?.message, 400);
    const secretLabel = getOpsAlertSecretDisplayLabel(secretKey, envName);

    if (!rawMessage) {
        return `${secretLabel} 读取失败，请检查后台密钥仓配置。`;
    }

    if (rawMessage === 'Unsupported state or unable to authenticate data') {
        return `${secretLabel} 无法解密，请检查 ADMIN_CONFIG_ENCRYPTION_KEY 是否与写入该密钥时一致，或重新保存该密钥。`;
    }

    return rawMessage;
}

async function loadSecretValue(supabase, secretKey, envName, env = process.env) {
    const envValue = normalizeText(env?.[envName]);
    let storedSecret = null;
    let errorMessage = '';

    try {
        if (supabase?.from) {
            storedSecret = await getStoredAdminSecret(supabase, secretKey);
        }
    } catch (error) {
        if (envValue) {
            console.warn(`[OpsAlerts] Failed to load stored secret ${secretKey}, falling back to ${envName}:`, error?.message || error);
        } else {
            errorMessage = buildOpsAlertSecretLoadErrorMessage(error, secretKey, envName);
        }
    }

    return {
        value: normalizeText(storedSecret?.value) || envValue,
        source: storedSecret?.value
            ? 'stored'
            : (envValue
                ? 'environment'
                : (errorMessage ? 'error' : 'missing')),
        updatedAt: storedSecret?.updated_at || null,
        errorMessage
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
        telegram_bot_token_error_message: telegram.errorMessage,
        feishu_webhook_url: feishu.value,
        feishu_webhook_url_source: feishu.source,
        feishu_webhook_url_updated_at: feishu.updatedAt,
        feishu_webhook_url_error_message: feishu.errorMessage,
        email_api_key: email.value,
        email_api_key_source: email.source,
        email_api_key_updated_at: email.updatedAt,
        email_api_key_error_message: email.errorMessage
    };
}

async function loadOpsAlertsRuntimeConfig(supabase, env = process.env, options = {}) {
    const storedConfig = await loadStoredSystemConfig(supabase, OPS_ALERTS_CONFIG_KEY).catch(() => null);
    const site = normalizeOpsAlertConfigSite(options.site, {
        allowAll: true,
        fallback: 'all'
    });
    const configValue = resolveOpsAlertsConfigValueForSite(storedConfig, site);
    const config = normalizeOpsAlertsConfig(configValue || {}, env);
    const secrets = await resolveOpsAlertSecrets(supabase, env);

    return {
        config,
        secrets,
        site
    };
}

function buildOpsAlertSecretStatus(runtime = {}) {
    const secrets = runtime.secrets || {};
    return {
        telegram_bot_token: {
            configured: Boolean(normalizeText(secrets.telegram_bot_token)),
            source: normalizeText(secrets.telegram_bot_token_source) || 'missing',
            updatedAt: secrets.telegram_bot_token_updated_at || null,
            errorMessage: normalizeText(secrets.telegram_bot_token_error_message, 500)
        },
        feishu_webhook_url: {
            configured: Boolean(normalizeText(secrets.feishu_webhook_url)),
            source: normalizeText(secrets.feishu_webhook_url_source) || 'missing',
            updatedAt: secrets.feishu_webhook_url_updated_at || null,
            errorMessage: normalizeText(secrets.feishu_webhook_url_error_message, 500)
        },
        email_api_key: {
            configured: Boolean(normalizeText(secrets.email_api_key)),
            source: normalizeText(secrets.email_api_key_source) || 'missing',
            updatedAt: secrets.email_api_key_updated_at || null,
            errorMessage: normalizeText(secrets.email_api_key_error_message, 500)
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
    const windowLabel = `${formatTimestamp(bucket.start_at)} - ${formatTimestamp(bucket.end_at)}`;
    if (summaryConfig.summary_schedule_mode === WORK_HOURS_SUMMARY_SCHEDULE_MODE) {
        return `当前非工作时段累计 ${itemCount} ${summaryConfig.unit}，将在下一个${getOpsAlertSummaryScheduleLabel(summaryConfig)}开始后统一外发。窗口：${windowLabel}`;
    }
    if (summaryConfig.summary_schedule_mode === DEFAULT_SUMMARY_SCHEDULE_MODE) {
        return `最近 ${summaryConfig.summary_window_minutes} 分钟内累计 ${itemCount} ${summaryConfig.unit}，将在窗口结束后统一外发。窗口：${windowLabel}`;
    }
    return `当前固定时点汇总窗口内累计 ${itemCount} ${summaryConfig.unit}，将按 ${getOpsAlertSummaryScheduleLabel(summaryConfig)} 统一外发。窗口：${windowLabel}`;
}

function buildOpsAlertSummaryTargetId({ alertType = '' } = {}) {
    const normalizedAlertType = normalizeText(alertType, 120).toLowerCase();
    if (!normalizedAlertType || !normalizedAlertType.endsWith('_summary')) {
        return '';
    }
    return `ops_summary:${normalizedAlertType}`;
}

async function loadExistingOpsAlertSummaryJob(supabase, alertType, dedupeKey) {
    const query = supabase
        .from('ops_alert_jobs')
        .select('*')
        .eq('alert_type', alertType)
        .eq('dedupe_key', dedupeKey);
    const { data, error } = await (typeof query.maybeSingle === 'function'
        ? query.maybeSingle()
        : query.single());

    if (error) {
        const errorCode = normalizeText(error.code, 40).toUpperCase();
        const errorMessage = normalizeText(error.message, 240).toLowerCase();
        const errorDetails = normalizeText(error.details, 240).toLowerCase();
        const isNoRows = errorCode === 'PGRST116'
            || errorMessage.includes('0 rows')
            || errorMessage.includes('no rows')
            || errorDetails.includes('0 rows')
            || errorDetails.includes('no rows');
        if (isNoRows) {
            return null;
        }
        throw error;
    }

    return data || null;
}

async function queueOpsAlertSummaryJob(supabase, input = {}, options = {}) {
    const siteContext = resolveOpsAlertInputSite(input, options);
    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, options.env, {
        site: siteContext.site
    });
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
        payload: withOpsAlertSitePayload(input.payload, siteContext)
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
            siteContext.site,
            bucket.start_at,
            bucket.end_at
        ].join(':'))
        .digest('hex');
    const summaryTargetId = buildOpsAlertSummaryTargetId({
        alertType: summaryConfig.summary_alert_type
    });
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
            ...withOpsAlertSitePayload(input.payload, siteContext),
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
            site: siteContext.site,
            site_labels: [siteContext.site],
            target_id: summaryTargetId,
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

        let caseSync = null;
        try {
            caseSync = await reopenResolvedOpsAlertCaseForJob(supabase, {
                ...input,
                alertType: summaryConfig.summary_alert_type,
                alert_type: summaryConfig.summary_alert_type,
                title: updateRow.title,
                content: updateRow.content,
                payload: nextPayload,
                createdAt: nowIso,
                created_at: nowIso
            }, {
                now: itemCreatedAt
            });
        } catch (caseError) {
            console.warn('[OpsAlerts] Failed to sync case state for summary alert:', caseError?.message || caseError);
        }

        return {
            queued: true,
            dedupeKey: itemDedupeKey,
            job: data || { ...existing, ...updateRow },
            channels: nextChannels,
            summary: true,
            caseSync
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
            site: siteContext.site,
            site_labels: [siteContext.site],
            target_id: summaryTargetId,
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

    let caseSync = null;
    try {
        caseSync = await reopenResolvedOpsAlertCaseForJob(supabase, {
            ...input,
            alertType: row.alert_type,
            alert_type: row.alert_type,
            title: row.title,
            content: row.content,
            payload: row.payload,
            createdAt: nowIso,
            created_at: nowIso
        }, {
            now: itemCreatedAt
        });
    } catch (caseError) {
        console.warn('[OpsAlerts] Failed to sync case state for summary alert:', caseError?.message || caseError);
    }

    return {
        queued: true,
        dedupeKey: itemDedupeKey,
        job: data || row,
        channels,
        summary: true,
        caseSync
    };
}

async function enqueueOpsAlertJob(supabase, input = {}, options = {}) {
    const siteContext = resolveOpsAlertInputSite(input, options);
    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, options.env, {
        site: siteContext.site
    });
    const alertType = normalizeText(input.alertType || input.alert_type);
    const title = normalizeText(input.title);
    const content = formatTimestampsInsideText(input.content);
    const severity = normalizeSeverity(input.severity, 'warning');
    const payload = withOpsAlertSitePayload(input.payload, siteContext);
    const requestedChannels = Array.isArray(input.allowedChannels)
        ? input.allowedChannels.map((item) => normalizeChannelName(item)).filter(Boolean)
        : [];

    if (!supabase?.from) {
        return { queued: false, reason: 'supabase_unavailable' };
    }

    if (!alertType || !title || !content) {
        return { queued: false, reason: 'missing_fields' };
    }

    if (options.skipSummary !== true) {
        const summaryResult = await queueOpsAlertSummaryJob(supabase, input, {
            ...options,
            runtime
        });
        if (summaryResult) {
            return summaryResult;
        }
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

    let caseSync = null;
    try {
        caseSync = await reopenResolvedOpsAlertCaseForJob(supabase, {
            ...input,
            alertType,
            alert_type: alertType,
            createdAt: nowIso,
            created_at: nowIso
        }, {
            now: dedupeReferenceDate
        });
    } catch (caseError) {
        console.warn('[OpsAlerts] Failed to sync case state for queued alert:', caseError?.message || caseError);
    }

    return {
        queued: true,
        dedupeKey,
        job: data || row,
        channels,
        caseSync
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
    const siteBadge = getOpsAlertSiteBadgeLabel(job);
    const refundOpsText = buildRefundOpsAlertText(job);
    if (refundOpsText) {
        return `${siteBadge} ${refundOpsText}`;
    }
    const customerChatSummaryText = buildCustomerChatMessageSummaryAlertText(job);
    if (customerChatSummaryText) {
        return `${siteBadge} ${customerChatSummaryText}`;
    }
    const customerChatText = buildCustomerChatMessageReceivedAlertText(job);
    if (customerChatText) {
        return `${siteBadge} ${customerChatText}`;
    }
    const shopPurchaseSummaryText = buildShopPurchaseSummaryAlertText(job);
    if (shopPurchaseSummaryText) {
        return `${siteBadge} ${shopPurchaseSummaryText}`;
    }
    const shopPurchaseText = buildShopPurchaseSucceededAlertText(job);
    if (shopPurchaseText) {
        return `${siteBadge} ${shopPurchaseText}`;
    }
    const walletRechargeSummaryText = buildWalletRechargeSummaryAlertText(job);
    if (walletRechargeSummaryText) {
        return `${siteBadge} ${walletRechargeSummaryText}`;
    }
    const ticketSlaSummaryText = buildTicketSlaSummaryAlertText(job);
    if (ticketSlaSummaryText) {
        return `${siteBadge} ${ticketSlaSummaryText}`;
    }
    const ticketCreatedText = buildTicketCreatedAlertText(job);
    if (ticketCreatedText) {
        return `${siteBadge} ${ticketCreatedText}`;
    }
    const shopInventorySummaryText = buildShopInventorySummaryAlertText(job);
    if (shopInventorySummaryText) {
        return `${siteBadge} ${shopInventorySummaryText}`;
    }
    const paymentGatewaySummaryText = buildPaymentGatewaySummaryAlertText(job);
    if (paymentGatewaySummaryText) {
        return `${siteBadge} ${paymentGatewaySummaryText}`;
    }
    const verifyQuotaSummaryText = buildVerifyQuotaSummaryAlertText(job);
    if (verifyQuotaSummaryText) {
        return `${siteBadge} ${verifyQuotaSummaryText}`;
    }
    const verifyQueueSummaryText = buildVerifyQueueSummaryAlertText(job);
    if (verifyQueueSummaryText) {
        return `${siteBadge} ${verifyQueueSummaryText}`;
    }
    const verifyFailureSummaryText = buildVerifyFailureSummaryAlertText(job);
    if (verifyFailureSummaryText) {
        return `${siteBadge} ${verifyFailureSummaryText}`;
    }
    const shopOrderDeliverySummaryText = buildShopOrderDeliverySummaryAlertText(job);
    if (shopOrderDeliverySummaryText) {
        return `${siteBadge} ${shopOrderDeliverySummaryText}`;
    }
    const walletRechargeText = buildWalletRechargeSucceededAlertText(job);
    if (walletRechargeText) {
        return `${siteBadge} ${walletRechargeText}`;
    }
    const paymentConfigIncidentRecoveredText = buildPaymentConfigIncidentRecoveredAlertText(job);
    if (paymentConfigIncidentRecoveredText) {
        return `${siteBadge} ${paymentConfigIncidentRecoveredText}`;
    }
    const paymentConfigIncidentText = buildPaymentConfigIncidentAlertText(job);
    if (paymentConfigIncidentText) {
        return `${siteBadge} ${paymentConfigIncidentText}`;
    }
    const paymentConfigRecoveredText = buildPaymentConfigRecoveredAlertText(job);
    if (paymentConfigRecoveredText) {
        return `${siteBadge} ${paymentConfigRecoveredText}`;
    }
    const paymentConfigChangedText = buildPaymentConfigChangedAlertText(job);
    if (paymentConfigChangedText) {
        return `${siteBadge} ${paymentConfigChangedText}`;
    }
    const gatewayAlertText = buildPaymentGatewayDegradedAlertText(job);
    if (gatewayAlertText) {
        return `${siteBadge} ${gatewayAlertText}`;
    }
    const gatewayRecoveredText = buildPaymentGatewayRecoveredAlertText(job);
    if (gatewayRecoveredText) {
        return `${siteBadge} ${gatewayRecoveredText}`;
    }
    const verifyServiceText = buildVerifyServiceDisabledAlertText(job);
    if (verifyServiceText) {
        return `${siteBadge} ${verifyServiceText}`;
    }
    const verifyFailureText = buildVerifyFailureRateSpikeAlertText(job);
    if (verifyFailureText) {
        return `${siteBadge} ${verifyFailureText}`;
    }
    const verifyIncidentText = buildVerifyIncidentEscalatedAlertText(job);
    if (verifyIncidentText) {
        return `${siteBadge} ${verifyIncidentText}`;
    }
    const verifyIncidentRecoveredText = buildVerifyIncidentRecoveredAlertText(job);
    if (verifyIncidentRecoveredText) {
        return `${siteBadge} ${verifyIncidentRecoveredText}`;
    }
    const verifyQueueText = buildVerifyQueueBacklogAlertText(job);
    if (verifyQueueText) {
        return `${siteBadge} ${verifyQueueText}`;
    }
    const verifyQuotaText = buildVerifyQuotaLowAlertText(job);
    if (verifyQuotaText) {
        return `${siteBadge} ${verifyQuotaText}`;
    }
    const kvm4IncidentText = buildKvm4WatchdogIncidentAlertText(job);
    if (kvm4IncidentText) {
        return `${siteBadge} ${kvm4IncidentText}`;
    }
    const kvm4RecoveredText = buildKvm4WatchdogRecoveredAlertText(job);
    if (kvm4RecoveredText) {
        return `${siteBadge} ${kvm4RecoveredText}`;
    }
    const ticketSlaText = buildTicketSlaOverdueAlertText(job);
    if (ticketSlaText) {
        return `${siteBadge} ${ticketSlaText}`;
    }
    const ticketSlaRecoveredText = buildTicketSlaRecoveredAlertText(job);
    if (ticketSlaRecoveredText) {
        return `${siteBadge} ${ticketSlaRecoveredText}`;
    }
    const shopInventoryText = buildShopInventoryAlertText(job);
    if (shopInventoryText) {
        return `${siteBadge} ${shopInventoryText}`;
    }
    const shopInventoryRecoveredText = buildShopInventoryRecoveredAlertText(job);
    if (shopInventoryRecoveredText) {
        return `${siteBadge} ${shopInventoryRecoveredText}`;
    }
    const shopOrderDeliveryText = buildShopOrderDeliveryFailedAlertText(job);
    if (shopOrderDeliveryText) {
        return `${siteBadge} ${shopOrderDeliveryText}`;
    }
    const shopOrderDeliveryIncidentText = buildShopOrderDeliveryIncidentAlertText(job);
    if (shopOrderDeliveryIncidentText) {
        return `${siteBadge} ${shopOrderDeliveryIncidentText}`;
    }
    const shopOrderDeliveryIncidentRecoveredText = buildShopOrderDeliveryIncidentRecoveredAlertText(job);
    if (shopOrderDeliveryIncidentRecoveredText) {
        return `${siteBadge} ${shopOrderDeliveryIncidentRecoveredText}`;
    }
    const shopOrderDeliveryRecoveredText = buildShopOrderDeliveryRecoveredAlertText(job);
    if (shopOrderDeliveryRecoveredText) {
        return `${siteBadge} ${shopOrderDeliveryRecoveredText}`;
    }
    const shopOrderRiskText = buildShopOrderRiskAlertText(job);
    if (shopOrderRiskText) {
        return `${siteBadge} ${shopOrderRiskText}`;
    }
    const shopOrderRiskRecoveredText = buildShopOrderRiskRecoveredAlertText(job);
    if (shopOrderRiskRecoveredText) {
        return `${siteBadge} ${shopOrderRiskRecoveredText}`;
    }
    const adminLoginAnomalyText = buildAdminLoginAnomalyAlertText(job);
    if (adminLoginAnomalyText) {
        return `${siteBadge} ${adminLoginAnomalyText}`;
    }

    const lines = [
        `[站外告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '系统通知'}`,
        normalizeText(job.content)
    ].filter(Boolean);
    return `${siteBadge} ${lines.join('\n\n')}`;
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
    return formatAlertTimestamp(value);
}

function formatTimestampsInsideText(value) {
    return formatAlertTimestampsInsideText(value);
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

function buildTicketSlaSummaryAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'ticket_sla_summary') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const items = getSummaryItems(payload).slice(0, Math.max(1, normalizeNumber(payload.summary_max_items, 10, 1, 50)));
    const lines = [buildSummaryHeader(job, '工单超时汇总')];

    if (normalizeText(payload.window_start_at) || normalizeText(payload.window_end_at)) {
        lines.push(`时间窗口：${formatTimestamp(payload.window_start_at)} - ${formatTimestamp(payload.window_end_at)}`);
    }
    if (Number.isFinite(Number(payload.item_count))) {
        lines.push(`累计超时工单：${Math.max(0, Math.round(Number(payload.item_count || 0)))} 条`);
    }
    items.forEach((item, index) => {
        const itemPayload = normalizeJsonObject(item?.payload);
        const ticketId = normalizeText(itemPayload.ticket_id) || normalizeText(itemPayload.target_id) || `ticket-${index + 1}`;
        const waitLabel = normalizeText(itemPayload.wait_label)
            || (Number.isFinite(Number(itemPayload.wait_minutes)) ? `${Math.max(0, Math.round(Number(itemPayload.wait_minutes || 0)))} 分钟` : '');
        const statusLabel = normalizeText(itemPayload.ticket_status_label) || getTicketStatusLabel(itemPayload.ticket_status);
        const updatedAt = formatTimestamp(itemPayload.updated_at || itemPayload.created_at || item?.created_at);
        lines.push(`${index + 1}. ${ticketId}${waitLabel ? ` · 已等待 ${waitLabel}` : ''}`);
        if (normalizeText(itemPayload.order_id)) lines.push(`   订单号：${normalizeText(itemPayload.order_id)}`);
        if (normalizeText(itemPayload.user_email)) lines.push(`   用户邮箱：${normalizeText(itemPayload.user_email)}`);
        if (normalizeText(itemPayload.user_id)) lines.push(`   用户ID：${normalizeText(itemPayload.user_id)}`);
        if (statusLabel) lines.push(`   当前状态：${statusLabel}`);
        if (normalizeText(itemPayload.reason)) lines.push(`   原因：${normalizeText(itemPayload.reason)}`);
        if (normalizeText(itemPayload.responsible_label)) lines.push(`   当前负责人：${normalizeText(itemPayload.responsible_label)}`);
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

function buildPaymentGatewaySummaryAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'payment_gateway_summary') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const items = getSummaryItems(payload).slice(0, Math.max(1, normalizeNumber(payload.summary_max_items, 10, 1, 50)));
    const lines = [buildSummaryHeader(job, '支付通道异常汇总')];

    if (normalizeText(payload.window_start_at) || normalizeText(payload.window_end_at)) {
        lines.push(`时间窗口：${formatTimestamp(payload.window_start_at)} - ${formatTimestamp(payload.window_end_at)}`);
    }
    if (Number.isFinite(Number(payload.item_count))) {
        lines.push(`累计通道异常：${Math.max(0, Math.round(Number(payload.item_count || 0)))} 条`);
    }
    items.forEach((item, index) => {
        const itemPayload = normalizeJsonObject(item?.payload);
        const providerLabel = getProviderLabel(itemPayload.provider) || normalizeText(itemPayload.provider) || '未知通道';
        const siteLabel = normalizeText(itemPayload.site).toUpperCase();
        const reasons = Array.isArray(itemPayload.degraded_reasons)
            ? itemPayload.degraded_reasons.map((entry) => normalizeText(entry)).filter(Boolean)
            : [];
        lines.push(`${index + 1}. ${providerLabel}${siteLabel ? `（${siteLabel}）` : ''}`);
        if (reasons.length) lines.push(`   判定信号：${reasons.join('；')}`);
        if (Number(itemPayload.total_orders || 0) > 0) {
            lines.push(`   订单概览：总 ${Number(itemPayload.total_orders || 0)} 笔 / 成功 ${Number(itemPayload.paid_orders || 0)} 笔 / 待审核 ${Number(itemPayload.review_orders || 0)} 笔 / 失败 ${Number(itemPayload.failed_orders || 0)} 笔`);
        }
        if (Number(itemPayload.webhook_total || 0) > 0 || Number(itemPayload.query_total || 0) > 0) {
            lines.push(`   回调/查码：回调 5xx ${Number(itemPayload.webhook_5xx || 0)} 次 / 查码 5xx ${Number(itemPayload.query_5xx || 0)} 次`);
        }
        const checkedAt = formatTimestamp(itemPayload.checked_at || itemPayload.created_at || item?.created_at);
        if (checkedAt) lines.push(`   时间：${checkedAt}`);
    });
    if (Number.isFinite(Number(payload.item_count)) && Number(payload.item_count) > items.length) {
        lines.push(`其余 ${Number(payload.item_count) - items.length} 条请前往后台查看。`);
    }
    if (normalizeText(payload.entry_path)) {
        lines.push(`处理入口：${normalizeText(payload.entry_path)}`);
    }

    return lines.filter(Boolean).join('\n');
}

function buildVerifyQuotaSummaryAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'verify_quota_summary') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const items = getSummaryItems(payload).slice(0, Math.max(1, normalizeNumber(payload.summary_max_items, 10, 1, 50)));
    const lines = [buildSummaryHeader(job, '验证额度告警汇总')];

    if (normalizeText(payload.window_start_at) || normalizeText(payload.window_end_at)) {
        lines.push(`时间窗口：${formatTimestamp(payload.window_start_at)} - ${formatTimestamp(payload.window_end_at)}`);
    }
    if (Number.isFinite(Number(payload.item_count))) {
        lines.push(`累计额度告警：${Math.max(0, Math.round(Number(payload.item_count || 0)))} 条`);
    }
    items.forEach((item, index) => {
        const itemPayload = normalizeJsonObject(item?.payload);
        const keyLabel = normalizeText(itemPayload.key_name) || 'default';
        const balanceText = Number.isFinite(Number(itemPayload.balance))
            ? `${Number(itemPayload.balance).toFixed(2)} 点`
            : '';
        const remainingJobs = Number.isFinite(Number(itemPayload.remaining_jobs))
            ? `${Math.max(0, Math.round(Number(itemPayload.remaining_jobs || 0)))} 次`
            : '';
        const reasons = Array.isArray(itemPayload.degraded_reasons)
            ? itemPayload.degraded_reasons.map((entry) => normalizeText(entry)).filter(Boolean)
            : [];
        lines.push(`${index + 1}. ${keyLabel}`);
        if (balanceText || remainingJobs) {
            lines.push(`   剩余能力：${[balanceText, remainingJobs ? `预计 ${remainingJobs}` : ''].filter(Boolean).join(' / ')}`);
        }
        if (reasons.length) lines.push(`   判定信号：${reasons.join('；')}`);
        if (Number.isFinite(Number(itemPayload.queue_size)) || Number.isFinite(Number(itemPayload.running_jobs))) {
            lines.push(`   队列概览：排队 ${Math.max(0, Math.round(Number(itemPayload.queue_size || 0)))} 个 / 运行中 ${Math.max(0, Math.round(Number(itemPayload.running_jobs || 0)))} 个`);
        }
        const checkedAt = formatTimestamp(itemPayload.checked_at || itemPayload.created_at || item?.created_at);
        if (checkedAt) lines.push(`   时间：${checkedAt}`);
    });
    if (Number.isFinite(Number(payload.item_count)) && Number(payload.item_count) > items.length) {
        lines.push(`其余 ${Number(payload.item_count) - items.length} 条请前往后台查看。`);
    }
    if (normalizeText(payload.entry_path)) {
        lines.push(`处理入口：${normalizeText(payload.entry_path)}`);
    }

    return lines.filter(Boolean).join('\n');
}

function buildVerifyQueueSummaryAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'verify_queue_summary') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const items = getSummaryItems(payload).slice(0, Math.max(1, normalizeNumber(payload.summary_max_items, 10, 1, 50)));
    const lines = [buildSummaryHeader(job, '验证堆积告警汇总')];

    if (normalizeText(payload.window_start_at) || normalizeText(payload.window_end_at)) {
        lines.push(`时间窗口：${formatTimestamp(payload.window_start_at)} - ${formatTimestamp(payload.window_end_at)}`);
    }
    if (Number.isFinite(Number(payload.item_count))) {
        lines.push(`累计堆积告警：${Math.max(0, Math.round(Number(payload.item_count || 0)))} 条`);
    }
    items.forEach((item, index) => {
        const itemPayload = normalizeJsonObject(item?.payload);
        const keyLabel = normalizeText(itemPayload.key_name) || 'default';
        const reasons = Array.isArray(itemPayload.degraded_reasons)
            ? itemPayload.degraded_reasons.map((entry) => normalizeText(entry)).filter(Boolean)
            : [];
        const hotErrors = Array.isArray(itemPayload.hot_errors)
            ? itemPayload.hot_errors.map((entry) => normalizeText(entry)).filter(Boolean)
            : [];
        lines.push(`${index + 1}. ${keyLabel}`);
        lines.push(`   队列概览：上游排队 ${Math.max(0, Math.round(Number(itemPayload.queue_size || 0)))} 个 / 运行中 ${Math.max(0, Math.round(Number(itemPayload.running_jobs || 0)))} 个 / 本地活跃 ${Math.max(0, Math.round(Number(itemPayload.active_job_count || 0)))} 个`);
        if (normalizeText(itemPayload.oldest_pending_label)) lines.push(`   最老活跃任务：${normalizeText(itemPayload.oldest_pending_label)}`);
        if (reasons.length) lines.push(`   判定信号：${reasons.join('；')}`);
        if (hotErrors.length) lines.push(`   最近错误：${hotErrors.join('；')}`);
        const checkedAt = formatTimestamp(itemPayload.checked_at || itemPayload.created_at || item?.created_at);
        if (checkedAt) lines.push(`   时间：${checkedAt}`);
    });
    if (Number.isFinite(Number(payload.item_count)) && Number(payload.item_count) > items.length) {
        lines.push(`其余 ${Number(payload.item_count) - items.length} 条请前往后台查看。`);
    }
    if (normalizeText(payload.entry_path)) {
        lines.push(`处理入口：${normalizeText(payload.entry_path)}`);
    }

    return lines.filter(Boolean).join('\n');
}

function buildVerifyFailureSummaryAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'verify_failure_summary') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const items = getSummaryItems(payload).slice(0, Math.max(1, normalizeNumber(payload.summary_max_items, 10, 1, 50)));
    const lines = [buildSummaryHeader(job, '验证失败率告警汇总')];

    if (normalizeText(payload.window_start_at) || normalizeText(payload.window_end_at)) {
        lines.push(`时间窗口：${formatTimestamp(payload.window_start_at)} - ${formatTimestamp(payload.window_end_at)}`);
    }
    if (Number.isFinite(Number(payload.item_count))) {
        lines.push(`累计失败率告警：${Math.max(0, Math.round(Number(payload.item_count || 0)))} 条`);
    }
    items.forEach((item, index) => {
        const itemPayload = normalizeJsonObject(item?.payload);
        const keyLabel = normalizeText(itemPayload.key_name) || 'default';
        const reasons = Array.isArray(itemPayload.degraded_reasons)
            ? itemPayload.degraded_reasons.map((entry) => normalizeText(entry)).filter(Boolean)
            : [];
        const hotErrors = Array.isArray(itemPayload.hot_errors)
            ? itemPayload.hot_errors.map((entry) => normalizeText(entry)).filter(Boolean)
            : [];
        lines.push(`${index + 1}. ${keyLabel}`);
        lines.push(`   任务概览：总 ${Math.max(0, Math.round(Number(itemPayload.total_jobs || 0)))} 次 / 失败 ${Math.max(0, Math.round(Number(itemPayload.failed_jobs || 0)))} 次 / 成功 ${Math.max(0, Math.round(Number(itemPayload.success_jobs || 0)))} 次 / 失败率 ${formatPercent(itemPayload.failure_rate)}`);
        if (Number.isFinite(Number(itemPayload.affected_user_count))) {
            lines.push(`   受影响用户：${Math.max(0, Math.round(Number(itemPayload.affected_user_count || 0)))} 人`);
        }
        if (reasons.length) lines.push(`   判定信号：${reasons.join('；')}`);
        if (hotErrors.length) lines.push(`   最近错误：${hotErrors.join('；')}`);
        const checkedAt = formatTimestamp(itemPayload.checked_at || itemPayload.created_at || item?.created_at);
        if (checkedAt) lines.push(`   时间：${checkedAt}`);
    });
    if (Number.isFinite(Number(payload.item_count)) && Number(payload.item_count) > items.length) {
        lines.push(`其余 ${Number(payload.item_count) - items.length} 条请前往后台查看。`);
    }
    if (normalizeText(payload.entry_path)) {
        lines.push(`处理入口：${normalizeText(payload.entry_path)}`);
    }

    return lines.filter(Boolean).join('\n');
}

function buildShopOrderDeliverySummaryAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'shop_order_delivery_summary') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const items = getSummaryItems(payload).slice(0, Math.max(1, normalizeNumber(payload.summary_max_items, 10, 1, 50)));
    const lines = [buildSummaryHeader(job, '履约失败汇总')];

    if (normalizeText(payload.window_start_at) || normalizeText(payload.window_end_at)) {
        lines.push(`时间窗口：${formatTimestamp(payload.window_start_at)} - ${formatTimestamp(payload.window_end_at)}`);
    }
    if (Number.isFinite(Number(payload.item_count))) {
        lines.push(`累计履约异常：${Math.max(0, Math.round(Number(payload.item_count || 0)))} 条`);
    }
    items.forEach((item, index) => {
        const itemPayload = normalizeJsonObject(item?.payload);
        const orderId = normalizeText(itemPayload.order_id) || normalizeText(itemPayload.target_id) || `shop-order-${index + 1}`;
        const productName = normalizeText(itemPayload.product_name) || '商城商品';
        const deliveryStatus = normalizeText(itemPayload.delivery_status_label) || normalizeText(itemPayload.delivery_status) || '异常';
        const deliveryError = normalizeText(itemPayload.delivery_last_error);
        const updatedAt = formatTimestamp(itemPayload.delivery_updated_at || itemPayload.created_at || item?.created_at);
        lines.push(`${index + 1}. ${orderId} · ${productName}`);
        lines.push(`   当前状态：${deliveryStatus}`);
        if (Number.isFinite(Number(itemPayload.delivery_attempt_count))) {
            lines.push(`   失败次数：${Math.max(0, Math.round(Number(itemPayload.delivery_attempt_count || 0)))}`);
        }
        if (normalizeText(itemPayload.user_id)) lines.push(`   用户ID：${normalizeText(itemPayload.user_id)}`);
        if (deliveryError) lines.push(`   最近错误：${deliveryError}`);
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

    if (normalizeText(payload.site)) lines.push(`站点：${normalizeText(payload.site).toUpperCase()}`);
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

    if (normalizeText(payload.site)) lines.push(`站点：${normalizeText(payload.site).toUpperCase()}`);
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

    if (normalizeText(payload.site)) lines.push(`站点：${normalizeText(payload.site).toUpperCase()}`);
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

    if (normalizeText(payload.site)) lines.push(`站点：${normalizeText(payload.site).toUpperCase()}`);
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
        const normalizedSecretSource = normalizeText(payload.restored_secret_source);
        const sourceLabel = normalizedSecretSource === 'stored'
            || normalizedSecretSource === 'stored_site'
            ? '后台密钥库'
            : (normalizedSecretSource === 'environment' ? '环境变量' : normalizedSecretSource);
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

function normalizeVerifyServiceRequestEndpoint(value) {
    const normalized = normalizeText(value).replace(/\/+$/, '');
    if (!normalized) {
        return '';
    }
    return /\/openapi$/i.test(normalized) ? normalized : `${normalized}/openapi`;
}

function buildVerifyServiceDisabledAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'verify_service_disabled') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const upstreamEndpoint = normalizeText(payload.upstream_endpoint)
        || normalizeVerifyServiceRequestEndpoint(payload.api_base_url);
    const lines = [
        `[验证服务告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '验证服务不可用'}`
    ];
    const responseStatus = Number(payload.response_status);

    if (normalizeText(payload.service_status_label)) lines.push(`当前状态：${normalizeText(payload.service_status_label)}`);
    if (normalizeText(payload.key_name)) lines.push(`API Key：${normalizeText(payload.key_name)}`);
    if (normalizeText(payload.api_base_url)) lines.push(`API Base：${normalizeText(payload.api_base_url)}`);
    if (upstreamEndpoint) lines.push(`请求地址：${upstreamEndpoint}`);
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
        ? payload.signal_timeline.map((item) => formatTimestampsInsideText(item)).filter(Boolean)
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

function buildTicketCreatedAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'ticket_new') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const lines = [
        `[新售后工单][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '新售后工单'}`
    ];

    if (normalizeText(payload.ticket_id)) lines.push(`工单号：${normalizeText(payload.ticket_id)}`);
    if (normalizeText(payload.order_id)) lines.push(`订单号：${normalizeText(payload.order_id)}`);
    if (normalizeText(payload.user_email)) lines.push(`用户邮箱：${normalizeText(payload.user_email)}`);
    if (normalizeText(payload.user_id)) lines.push(`用户ID：${normalizeText(payload.user_id)}`);
    if (normalizeText(payload.ticket_status)) lines.push(`当前状态：${getTicketStatusLabel(payload.ticket_status)}`);
    if (normalizeText(payload.reason)) lines.push(`问题描述：${normalizeText(payload.reason)}`);
    if (normalizeText(payload.created_at)) lines.push(`创建时间：${formatTimestamp(payload.created_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
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
    if (normalizeText(payload.user_email)) lines.push(`用户邮箱：${normalizeText(payload.user_email)}`);
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
    if (normalizeText(payload.user_email)) lines.push(`用户邮箱：${normalizeText(payload.user_email)}`);
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
    if (normalizeText(payload.client_ip_group)) lines.push(`登录 IP 段：${normalizeText(payload.client_ip_group)}`);
    if (normalizeText(payload.user_agent)) lines.push(`设备指纹：${normalizeText(payload.user_agent)}`);
    if (normalizeText(payload.user_agent_fingerprint)) lines.push(`设备家族：${normalizeText(payload.user_agent_fingerprint)}`);
    if (reasons.length) lines.push(`判定信号：${reasons.join('；')}`);
    if (Number.isFinite(Number(payload.recent_distinct_ip_count))) lines.push(`最近窗口内 IP 段数：${Math.max(0, Math.round(Number(payload.recent_distinct_ip_count || 0)))}`);
    if (Number.isFinite(Number(payload.recent_distinct_user_agent_count))) lines.push(`最近窗口内设备家族数：${Math.max(0, Math.round(Number(payload.recent_distinct_user_agent_count || 0)))}`);
    if (previousIps.length) lines.push(`历史常用 IP：${previousIps.join('、')}`);
    if (normalizeText(payload.origin)) lines.push(`Origin：${normalizeText(payload.origin)}`);
    if (normalizeText(payload.referer)) lines.push(`Referer：${normalizeText(payload.referer)}`);
    if (normalizeText(payload.occurred_at)) lines.push(`发生时间：${formatTimestamp(payload.occurred_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildKvm4WatchdogIncidentAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'kvm4_watchdog_incident') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const lines = [
        `[KVM4 运维告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || 'KVM4 watchdog 触发告警'}`
    ];

    if (normalizeText(payload.guard_label)) lines.push(`巡检项：${normalizeText(payload.guard_label)}`);
    if (normalizeText(payload.service_name)) lines.push(`服务：${normalizeText(payload.service_name)}`);
    if (normalizeText(payload.container_name)) lines.push(`容器：${normalizeText(payload.container_name)}`);
    if (normalizeText(payload.host)) lines.push(`主机：${normalizeText(payload.host)}`);
    if (normalizeText(payload.state)) lines.push(`状态：${normalizeText(payload.state)}`);
    if (Number.isFinite(Number(payload.children))) lines.push(`子进程数：${Math.max(0, Math.round(Number(payload.children || 0)))}`);
    if (Number.isFinite(Number(payload.zombies))) lines.push(`僵尸进程：${Math.max(0, Math.round(Number(payload.zombies || 0)))}`);
    if (Number.isFinite(Number(payload.cpu_percent))) lines.push(`CPU：${Math.max(0, Number(payload.cpu_percent || 0))}%`);
    if (normalizeText(payload.incident_started_at)) lines.push(`触发时间：${formatTimestamp(payload.incident_started_at)}`);
    if (normalizeText(payload.entry_path)) lines.push(`处理入口：${normalizeText(payload.entry_path)}`);

    return lines.filter(Boolean).join('\n');
}

function buildKvm4WatchdogRecoveredAlertText(job = {}) {
    if (normalizeText(job.alert_type).toLowerCase() !== 'kvm4_watchdog_recovered') {
        return '';
    }

    const payload = normalizeJsonObject(job.payload);
    const lines = [
        `[KVM4 运维恢复][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || 'KVM4 watchdog 已恢复'}`
    ];

    if (normalizeText(payload.guard_label)) lines.push(`巡检项：${normalizeText(payload.guard_label)}`);
    if (normalizeText(payload.service_name)) lines.push(`服务：${normalizeText(payload.service_name)}`);
    if (normalizeText(payload.container_name)) lines.push(`容器：${normalizeText(payload.container_name)}`);
    if (normalizeText(payload.host)) lines.push(`主机：${normalizeText(payload.host)}`);
    if (normalizeText(payload.state)) lines.push(`状态：${normalizeText(payload.state)}`);
    if (Number.isFinite(Number(payload.children))) lines.push(`当前子进程数：${Math.max(0, Math.round(Number(payload.children || 0)))}`);
    if (Number.isFinite(Number(payload.zombies))) lines.push(`当前僵尸进程：${Math.max(0, Math.round(Number(payload.zombies || 0)))}`);
    if (normalizeText(payload.incident_started_at)) lines.push(`异常开始：${formatTimestamp(payload.incident_started_at)}`);
    if (normalizeText(payload.incident_recovered_at)) lines.push(`恢复时间：${formatTimestamp(payload.incident_recovered_at)}`);
    if (Number.isFinite(Number(payload.incident_duration_minutes))) lines.push(`持续时长：${Math.max(0, Math.round(Number(payload.incident_duration_minutes || 0)))} 分钟`);
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

function resolveOpsAlertDeliveryTimeoutMs(runtime = {}, options = {}) {
    if (Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0) {
        return Number(options.timeoutMs);
    }

    return normalizeNumber(
        runtime?.config?.timeout_ms,
        DEFAULT_OPS_ALERTS_CONFIG.timeout_ms,
        DEFAULT_OPS_ALERTS_TIMEOUT_MS,
        30000
    );
}

function resolveTelegramFetchRetryCount(options = {}) {
    if (Number.isFinite(Number(options.telegramFetchRetryCount))) {
        return Math.max(0, Math.min(4, Math.round(Number(options.telegramFetchRetryCount))));
    }
    return DEFAULT_TELEGRAM_FETCH_RETRY_COUNT;
}

function resolveTelegramFetchRetryDelayMs(options = {}) {
    if (Number.isFinite(Number(options.telegramFetchRetryDelayMs))) {
        return Math.max(0, Math.min(5000, Math.round(Number(options.telegramFetchRetryDelayMs))));
    }
    return DEFAULT_TELEGRAM_FETCH_RETRY_DELAY_MS;
}

async function postJsonWithRetry(url, body, options = {}) {
    const maxRetries = resolveTelegramFetchRetryCount(options);
    const retryDelayMs = resolveTelegramFetchRetryDelayMs(options);
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            return await postJson(url, body, options);
        } catch (error) {
            lastError = error;
            if (attempt >= maxRetries || !isRetryableFetchError(error)) {
                throw error;
            }
            await sleep(retryDelayMs * (attempt + 1));
        }
    }

    throw lastError || new Error('fetch failed');
}

function buildEmailAlertSubject(job = {}, runtime = {}) {
    const prefix = normalizeText(runtime?.config?.channels?.email?.subject_prefix)
        || DEFAULT_OPS_ALERTS_CONFIG.channels.email.subject_prefix;
    const siteBadge = getOpsAlertSiteBadgeLabel(job);
    const severity = normalizeSeverity(job?.severity, 'warning').toUpperCase();
    const title = normalizeText(job?.title) || normalizeText(job?.alert_type) || '系统告警';
    return [prefix, siteBadge, `[${severity}]`, title].filter(Boolean).join(' ');
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
    const deliveryOptions = {
        ...options,
        timeoutMs: resolveOpsAlertDeliveryTimeoutMs(runtime, options)
    };
    for (const chatId of chatIds) {
        try {
            const result = await postJsonWithRetry(
                `https://api.telegram.org/bot${token}/sendMessage`,
                {
                    chat_id: chatId,
                    text,
                    disable_web_page_preview: true
                },
                deliveryOptions
            );
            results.push({
                chatId,
                ...result
            });
        } catch (error) {
            if (!isRetryableFetchError(error)) {
                throw error;
            }
            const failedResult = {
                chatId,
                ok: false,
                status: 0,
                receipt_uncertain: true,
                error: normalizeText(error?.message || error?.name) || 'fetch failed'
            };
            results.push(failedResult);
        }
    }

    const deliveredCount = results.filter((item) => item.ok === true).length;
    const receiptUncertainCount = results.filter((item) => item.receipt_uncertain === true).length;
    const failedCount = results.length - deliveredCount;
    const hasFailures = failedCount > 0 || results.some((item) => item.ok !== true);
    return {
        ok: !hasFailures,
        partial: hasFailures && (deliveredCount > 0 || receiptUncertainCount > 0),
        receipt_uncertain: receiptUncertainCount > 0,
        delivered_count: deliveredCount,
        receipt_uncertain_count: receiptUncertainCount,
        failed_count: Math.max(0, results.length - deliveredCount),
        status: !hasFailures ? 200 : Math.max(...results.map((item) => Number(item.status || 0))),
        body: JSON.stringify(results),
        error: hasFailures
            ? results
                .filter((item) => item.ok !== true)
                .map((item) => normalizeText(item.error) || `HTTP ${Number(item.status || 0) || 0}`)
                .filter(Boolean)
                .join('；')
            : ''
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
        {
            ...options,
            timeoutMs: resolveOpsAlertDeliveryTimeoutMs(runtime, options)
        }
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
            timeoutMs: resolveOpsAlertDeliveryTimeoutMs(runtime, options),
            headers: {
                ...(options.headers || {}),
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

async function mirrorOpsAlertAttemptToExternalMonitoring(job = {}, channel = '', result = {}, options = {}) {
    const status = result?.ok ? 'delivered' : 'failed';
    const event = {
        type: 'ops_alert_delivery_attempt',
        level: result?.ok ? 'info' : 'warning',
        message: `Ops alert ${status}: ${normalizeText(job.alert_type, 120) || 'unknown'} via ${normalizeText(channel, 40) || 'unknown'}`,
        tags: {
            source: 'ops_alert_jobs',
            alert_type: normalizeText(job.alert_type, 120) || 'unknown',
            severity: normalizeSeverity(job.severity, 'warning'),
            channel: normalizeChannelName(channel) || normalizeText(channel, 40) || 'unknown',
            status
        },
        extra: {
            job_id: normalizeText(job.id, 160),
            title: normalizeText(job.title, 240),
            response_status: Number.isFinite(Number(result?.status)) ? Number(result.status) : null,
            error_message: normalizeText(result?.error, 1000) || null,
            payload: job.payload || {}
        }
    };
    const emitPromise = emitExternalMonitoringEventFailOpen(event, {
        env: options.env || process.env,
        fetchImpl: options.fetchImpl || global.fetch,
        timeoutMs: Math.max(250, Number(options.externalMonitoringTimeoutMs || 900) || 900)
    });

    if (options.awaitExternalMonitoring === true) {
        return emitPromise;
    }

    void emitPromise;
    return null;
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

async function markOpsAlertJobSuppressed(supabase, job, reason) {
    const { error } = await supabase
        .from('ops_alert_jobs')
        .update({
            status: 'suppressed',
            remaining_channels: [],
            last_error: normalizeText(reason).slice(0, 1000) || null,
            updated_at: new Date().toISOString()
        })
        .eq('id', job.id);

    if (error) {
        throw error;
    }
}

async function shouldSuppressResolvedOpsAlertJob(supabase, job = {}) {
    const alertType = normalizeText(job.alert_type).toLowerCase();
    if (alertType !== 'verify_service_disabled') {
        return {
            suppressed: false,
            reason: 'alert_type_not_guarded'
        };
    }

    const payload = normalizeJsonObject(job.payload);
    const targetId = normalizeText(payload.target_id);
    const categoryKey = inferOpsAlertCaseCategoryKey(alertType, targetId);
    const siteContext = resolveOpsAlertInputSite({
        payload
    });
    if (!supabase?.from || !categoryKey || !targetId) {
        return {
            suppressed: false,
            reason: 'missing_case_target'
        };
    }

    try {
        const { data, error } = await supabase
            .from('ops_alert_cases')
            .select('status,last_action,last_action_at,resolution')
            .eq('site', siteContext.site)
            .eq('category_key', categoryKey)
            .eq('target_id', targetId)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (normalizeText(data?.status).toLowerCase() === 'resolved') {
            return {
                suppressed: true,
                reason: 'case_already_resolved'
            };
        }
    } catch (error) {
        if (!isMissingTableAccessError(error, 'ops_alert_cases')) {
            throw error;
        }
    }

    return {
        suppressed: false,
        reason: 'case_active_or_missing'
    };
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

    const suppression = await shouldSuppressResolvedOpsAlertJob(supabase, job);
    if (suppression?.suppressed) {
        await markOpsAlertJobSuppressed(supabase, job, suppression.reason);
        return {
            delivered: false,
            suppressed: true,
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
        await mirrorOpsAlertAttemptToExternalMonitoring(job, channel, result, options);

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
    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, options.env, {
        site: options.site || 'all'
    });
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
    let suppressed = 0;
    const runtimeBySite = new Map();

    async function resolveRuntimeForJob(job = {}) {
        if (options.runtime) {
            return runtime;
        }

        const siteContext = resolveOpsAlertInputSite({
            payload: job.payload
        }, options);
        if (!siteContext.explicit) {
            return runtime;
        }

        const site = siteContext.site;
        if (!runtimeBySite.has(site)) {
            runtimeBySite.set(site, loadOpsAlertsRuntimeConfig(supabase, options.env, { site }));
        }
        return runtimeBySite.get(site);
    }

    for (const job of claimedJobs) {
        const jobRuntime = await resolveRuntimeForJob(job);
        const result = await processOpsAlertJob(supabase, job, jobRuntime, options);
        if (result.suppressed) {
            suppressed += 1;
        } else if (result.delivered) {
            delivered += 1;
        } else {
            retried += 1;
        }
    }

    return {
        claimed: claimedJobs.length,
        delivered,
        retried,
        suppressed
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
        buildOpsAlertSummaryTargetId,
        getOpsAlertSecretKeys,
        getNextRetryAt,
        getRetryDelayMs,
        hasRecentOpsAlertJob,
        isOpsAlertsSiteScopedConfigEnvelope,
        mirrorOpsAlertAttemptToExternalMonitoring,
        normalizeChannelName,
        normalizeOpsAlertConfigSite,
        normalizeCustomerChatQuickReplyTemplates,
        normalizeTicketReplyTemplates,
        isRetryableFetchError,
        postJsonWithRetry,
        resolveOpsAlertDeliveryTimeoutMs,
        resolveTelegramFetchRetryCount,
        resolveTelegramFetchRetryDelayMs,
        resolveEnabledChannels,
        resolveOpsAlertInputSite,
        resolveOpsAlertsConfigValueForSite,
        normalizeSeverity,
        normalizeStringArray,
        recordOpsAlertAttempt,
        resolveOpsAlertSecrets,
        sendEmailAlert,
        sendFeishuAlert,
        sendTelegramAlert
    }
};
