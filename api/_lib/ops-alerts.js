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
    dedupeWindowMinutes = DEFAULT_OPS_ALERTS_CONFIG.dedupe_window_minutes
}) {
    if (!supabase?.from || !normalizeText(dedupeKey)) {
        return false;
    }

    const sinceIso = new Date(Date.now() - Math.max(1, dedupeWindowMinutes) * 60 * 1000).toISOString();
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

    if (!supabase?.from) {
        return { queued: false, reason: 'supabase_unavailable' };
    }

    if (!alertType || !title || !content) {
        return { queued: false, reason: 'missing_fields' };
    }

    const channels = resolveEnabledChannels(runtime, severity);
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
        dedupeWindowMinutes
    });

    if (exists) {
        return {
            queued: false,
            reason: 'deduped',
            dedupeKey
        };
    }

    const nowIso = new Date().toISOString();
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

    const lines = [
        `[支付退款告警][${normalizeSeverity(job.severity, 'warning').toUpperCase()}] ${normalizeText(job.title) || '退款异常'}`,
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
    if (normalizeText(payload.user_id)) lines.push(`用户ID：${normalizeText(payload.user_id)}`);
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
