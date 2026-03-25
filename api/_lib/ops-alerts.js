const crypto = require('crypto');
const {
    OPS_ALERT_SECRET_KEYS: CONFIGURED_OPS_ALERT_SECRET_KEYS,
    getStoredAdminSecret
} = require('./secrets');

const OPS_ALERTS_CONFIG_KEY = 'ops_alerts';
const DEFAULT_OPS_ALERT_SECRET_KEYS = Object.freeze({
    telegram_bot_token: 'ops_alert_telegram_bot_token',
    feishu_webhook_url: 'ops_alert_feishu_webhook_url'
});
const SUPPORTED_CHANNELS = Object.freeze(['telegram', 'feishu']);
const SEVERITY_RANK = Object.freeze({
    info: 10,
    warning: 20,
    critical: 30
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
    channels: Object.freeze({
        telegram: Object.freeze({
            enabled: false,
            minimum_severity: 'warning',
            chat_ids: Object.freeze([])
        }),
        feishu: Object.freeze({
            enabled: false,
            minimum_severity: 'warning'
        })
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
        channels: {
            telegram: {
                enabled: DEFAULT_OPS_ALERTS_CONFIG.channels.telegram.enabled,
                minimum_severity: DEFAULT_OPS_ALERTS_CONFIG.channels.telegram.minimum_severity,
                chat_ids: [...DEFAULT_OPS_ALERTS_CONFIG.channels.telegram.chat_ids]
            },
            feishu: {
                enabled: DEFAULT_OPS_ALERTS_CONFIG.channels.feishu.enabled,
                minimum_severity: DEFAULT_OPS_ALERTS_CONFIG.channels.feishu.minimum_severity
            }
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

    return {
        telegram_bot_token: telegram.value,
        telegram_bot_token_source: telegram.source,
        telegram_bot_token_updated_at: telegram.updatedAt,
        feishu_webhook_url: feishu.value,
        feishu_webhook_url_source: feishu.source,
        feishu_webhook_url_updated_at: feishu.updatedAt
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
        }
    };
}

function isSeverityAllowed(minimumSeverity, alertSeverity) {
    return (SEVERITY_RANK[normalizeSeverity(alertSeverity, 'warning')] || 0)
        >= (SEVERITY_RANK[normalizeSeverity(minimumSeverity, 'warning')] || 0);
}

function resolveEnabledChannels(runtime = {}, alertSeverity = 'warning') {
    const config = runtime.config || cloneDefaultConfig();
    const secrets = runtime.secrets || {};
    const channels = [];

    if (!config.enabled) {
        return channels;
    }

    if (
        config.channels.telegram.enabled
        && normalizeText(secrets.telegram_bot_token)
        && normalizeStringArray(config.channels.telegram.chat_ids).length
        && isSeverityAllowed(config.channels.telegram.minimum_severity, alertSeverity)
    ) {
        channels.push('telegram');
    }

    if (
        config.channels.feishu.enabled
        && normalizeText(secrets.feishu_webhook_url)
        && isSeverityAllowed(config.channels.feishu.minimum_severity, alertSeverity)
    ) {
        channels.push('feishu');
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

    const channels = resolveEnabledChannels(runtime, severity)
        .filter((channel) => !requestedChannels.length || requestedChannels.includes(channel));
    if (!channels.length) {
        return { queued: false, reason: 'no_active_channels' };
    }

    const explicitCreatedAt = normalizeText(input.createdAt || input.created_at);
    const dedupeReferenceDate = options.now instanceof Date
        ? options.now
        : new Date(options.now || explicitCreatedAt || Date.now());
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
    fetchImpl = global.fetch
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
                'Content-Type': 'application/json; charset=utf-8'
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
        normalizeSeverity,
        normalizeStringArray,
        recordOpsAlertAttempt,
        resolveOpsAlertSecrets,
        sendFeishuAlert,
        sendTelegramAlert
    }
};
