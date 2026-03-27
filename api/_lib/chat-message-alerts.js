const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');

const DEFAULT_CHAT_MESSAGE_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 60 * 1000,
    lookback_minutes: 15,
    state_lookback_minutes: 24 * 60,
    dedupe_window_minutes: 12 * 60,
    page_size: 500,
    max_pages: 10
});
const CHAT_MESSAGE_STATE_TYPES = Object.freeze([
    'customer_chat_message_received',
    'customer_chat_message_summary'
]);

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
}

function normalizeNumber(value, fallback = 0, min = null, max = null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    let next = parsed;
    if (Number.isFinite(min)) next = Math.max(min, next);
    if (Number.isFinite(max)) next = Math.min(max, next);
    return next;
}

function normalizeChatMessageMonitorConfig(rawConfig = {}, env = process.env) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    return {
        enabled: normalizeBoolean(
            source.enabled,
            normalizeBoolean(env?.CHAT_MESSAGE_MONITOR_ENABLED, DEFAULT_CHAT_MESSAGE_MONITOR_CONFIG.enabled)
        ),
        sweep_interval_ms: normalizeNumber(
            source.sweep_interval_ms,
            normalizeNumber(env?.CHAT_MESSAGE_MONITOR_SWEEP_INTERVAL_MS, DEFAULT_CHAT_MESSAGE_MONITOR_CONFIG.sweep_interval_ms, 10000, 60 * 60 * 1000),
            10000,
            60 * 60 * 1000
        ),
        lookback_minutes: normalizeNumber(
            source.lookback_minutes,
            normalizeNumber(env?.CHAT_MESSAGE_MONITOR_LOOKBACK_MINUTES, DEFAULT_CHAT_MESSAGE_MONITOR_CONFIG.lookback_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        state_lookback_minutes: normalizeNumber(
            source.state_lookback_minutes,
            normalizeNumber(env?.CHAT_MESSAGE_MONITOR_STATE_LOOKBACK_MINUTES, DEFAULT_CHAT_MESSAGE_MONITOR_CONFIG.state_lookback_minutes, 30, 7 * 24 * 60),
            30,
            7 * 24 * 60
        ),
        dedupe_window_minutes: normalizeNumber(
            source.dedupe_window_minutes,
            normalizeNumber(env?.CHAT_MESSAGE_MONITOR_DEDUPE_WINDOW_MINUTES, DEFAULT_CHAT_MESSAGE_MONITOR_CONFIG.dedupe_window_minutes, 1, 7 * 24 * 60),
            1,
            7 * 24 * 60
        ),
        page_size: normalizeNumber(
            source.page_size,
            normalizeNumber(env?.CHAT_MESSAGE_MONITOR_PAGE_SIZE, DEFAULT_CHAT_MESSAGE_MONITOR_CONFIG.page_size, 50, 5000),
            50,
            5000
        ),
        max_pages: normalizeNumber(
            source.max_pages,
            normalizeNumber(env?.CHAT_MESSAGE_MONITOR_MAX_PAGES, DEFAULT_CHAT_MESSAGE_MONITOR_CONFIG.max_pages, 1, 100),
            1,
            100
        )
    };
}

async function fetchPagedRows(buildQuery, pageSize = 500, maxPages = 10) {
    const rows = [];

    for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await buildQuery().range(from, to);

        if (error) {
            throw error;
        }

        const batch = Array.isArray(data) ? data : [];
        rows.push(...batch);

        if (batch.length < pageSize) {
            break;
        }
    }

    return rows;
}

async function fetchRecentCustomerMessages(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('chat_messages')
        .select('id, session_id, user_id, content, message_type, created_at, is_admin')
        .eq('is_admin', false)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchRecentChatMessageStateJobs(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('ops_alert_jobs')
        .select('id, alert_type, severity, title, payload, created_at')
        .in('alert_type', CHAT_MESSAGE_STATE_TYPES)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchProfilesByFilter(client, filterType, values = [], config = {}) {
    const normalizedValues = Array.from(new Set((values || []).map((value) => normalizeText(value)).filter(Boolean)));
    if (!normalizedValues.length) {
        return [];
    }

    const rows = [];
    const chunkSize = Math.max(1, Math.min(Number(config.page_size || DEFAULT_CHAT_MESSAGE_MONITOR_CONFIG.page_size), 200));

    for (let index = 0; index < normalizedValues.length; index += chunkSize) {
        const batch = normalizedValues.slice(index, index + chunkSize);
        const { data, error } = await client
            .from('profiles')
            .select('id, email, display_name, username')
            .in(filterType, batch);

        if (error) {
            throw error;
        }

        rows.push(...(Array.isArray(data) ? data : []));
    }

    return rows;
}

function buildProfilesContext(profiles = []) {
    const byId = new Map();
    const byEmail = new Map();

    for (const profile of profiles || []) {
        const id = normalizeText(profile?.id);
        const email = normalizeText(profile?.email).toLowerCase();
        if (id) {
            byId.set(id, profile);
        }
        if (email) {
            byEmail.set(email, profile);
        }
    }

    return { byId, byEmail };
}

function resolveMessageProfile(context = {}, message = {}) {
    const userId = normalizeText(message.user_id);
    if (userId && context.byId instanceof Map && context.byId.has(userId)) {
        return context.byId.get(userId) || null;
    }

    const sessionEmail = normalizeText(message.session_id).toLowerCase();
    if (sessionEmail && sessionEmail.includes('@') && context.byEmail instanceof Map && context.byEmail.has(sessionEmail)) {
        return context.byEmail.get(sessionEmail) || null;
    }

    return null;
}

function resolveSenderEmail(profile, message = {}) {
    const profileEmail = normalizeText(profile?.email);
    if (profileEmail) {
        return profileEmail;
    }

    const sessionId = normalizeText(message.session_id);
    if (sessionId.includes('@')) {
        return sessionId;
    }

    return '';
}

function resolveSenderLabel(profile, message = {}) {
    const displayName = normalizeText(profile?.display_name);
    const username = normalizeText(profile?.username);
    const senderEmail = resolveSenderEmail(profile, message);

    if (displayName) return displayName;
    if (username) return username;
    if (senderEmail.includes('@')) return senderEmail.split('@')[0];
    return '访客';
}

function getMessageTypeLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'image') {
        return '图片消息';
    }
    return '文本消息';
}

function getMessagePreview(message = {}) {
    const messageType = normalizeText(message.message_type).toLowerCase();
    const content = normalizeText(message.content);
    if (messageType === 'image') {
        return '[图片消息]';
    }
    if (!content) {
        return '[空消息]';
    }
    return content.length > 240 ? `${content.slice(0, 240)}...` : content;
}

function getMessageTargetId(value = {}) {
    if (!value || typeof value !== 'object') {
        return '';
    }

    if (normalizeText(value.target_id)) {
        return normalizeText(value.target_id);
    }

    return normalizeText(value.message_id || value.id);
}

function payloadContainsMessageTarget(value = {}, targetId = '') {
    const normalizedTargetId = normalizeText(targetId);
    if (!normalizedTargetId) {
        return true;
    }

    if (getMessageTargetId(value) === normalizedTargetId) {
        return true;
    }

    const items = Array.isArray(value?.items) ? value.items : [];
    return items.some((item) => getMessageTargetId(item?.payload || item) === normalizedTargetId);
}

function compareCreatedAtDescending(left = {}, right = {}) {
    const leftTime = Date.parse(normalizeText(left.created_at));
    const rightTime = Date.parse(normalizeText(right.created_at));
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

function getLatestChatMessageStateJob(stateJobs = [], alertType, targetId = '') {
    const normalizedType = normalizeText(alertType).toLowerCase();
    const normalizedTargetId = normalizeText(targetId);
    const candidateTypes = normalizedType === 'customer_chat_message_received'
        ? ['customer_chat_message_received', 'customer_chat_message_summary']
        : [normalizedType];
    return (stateJobs || [])
        .filter((job) => candidateTypes.includes(normalizeText(job.alert_type).toLowerCase()))
        .filter((job) => !normalizedTargetId || payloadContainsMessageTarget(job.payload, normalizedTargetId))
        .sort(compareCreatedAtDescending)[0] || null;
}

function buildCustomerChatMessageAlerts(messages = [], profilesContext = {}, rawConfig = {}, options = {}) {
    const config = normalizeChatMessageMonitorConfig(rawConfig);
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());

    return (messages || [])
        .filter((message) => normalizeBoolean(message?.is_admin, false) === false)
        .map((message) => {
            const messageId = normalizeText(message.id);
            if (!messageId) {
                return null;
            }

            const profile = resolveMessageProfile(profilesContext, message);
            const senderLabel = resolveSenderLabel(profile, message);
            const senderEmail = resolveSenderEmail(profile, message);
            const userId = normalizeText(message.user_id);
            const sessionId = normalizeText(message.session_id);
            const messageType = normalizeText(message.message_type).toLowerCase() || 'text';
            const messageTypeLabel = getMessageTypeLabel(messageType);
            const preview = getMessagePreview(message);
            const createdAt = normalizeText(message.created_at) || nowDate.toISOString();
            const shortSender = senderLabel.length > 16 ? `${senderLabel.slice(0, 16)}...` : senderLabel;
            const lines = [
                `客服机器人收到一条新的用户消息，请尽快查看并接管。`,
                `发送者：${senderLabel}`,
                userId ? `用户ID：${userId}` : '',
                sessionId ? `会话ID：${sessionId}` : '',
                senderEmail ? `联系邮箱：${senderEmail}` : '',
                `消息类型：${messageTypeLabel}`,
                `发送时间：${createdAt}`,
                `消息内容：${preview}`,
                messageType === 'image' && normalizeText(message.content) ? `附件地址：${normalizeText(message.content)}` : '',
                '处理入口：客服消息 -> 会话详情'
            ].filter(Boolean);

            return {
                alertType: 'customer_chat_message_received',
                severity: 'warning',
                title: `客服新消息（${shortSender || '访客'}）`,
                content: lines.join('\n'),
                payload: {
                    target_id: messageId,
                    message_id: messageId,
                    user_id: userId || null,
                    session_id: sessionId || null,
                    sender_label: senderLabel || '访客',
                    sender_email: senderEmail || null,
                    message_type: messageType,
                    message_type_label: messageTypeLabel,
                    content: normalizeText(message.content) || null,
                    content_preview: preview,
                    created_at: createdAt,
                    entry_path: '客服消息 -> 会话详情'
                },
                dedupeKey: crypto
                    .createHash('sha256')
                    .update(`customer_chat_message_received:${messageId}`)
                    .digest('hex'),
                dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_CHAT_MESSAGE_MONITOR_CONFIG.dedupe_window_minutes)
            };
        })
        .filter(Boolean);
}

async function runCustomerChatMessageSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    const runtimeConfig = runtime?.config?.customer_chat_message && typeof runtime.config.customer_chat_message === 'object'
        ? runtime.config.customer_chat_message
        : {};
    const config = normalizeChatMessageMonitorConfig({
        ...runtimeConfig,
        ...(options.config && typeof options.config === 'object' ? options.config : {})
    }, env);

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            message_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    if (!runtime?.config?.enabled) {
        return {
            skipped: 'ops_alerts_disabled',
            message_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const sinceIso = new Date(nowDate.getTime() - Number(config.lookback_minutes || DEFAULT_CHAT_MESSAGE_MONITOR_CONFIG.lookback_minutes) * 60 * 1000).toISOString();
    const stateSinceIso = new Date(nowDate.getTime() - Number(config.state_lookback_minutes || DEFAULT_CHAT_MESSAGE_MONITOR_CONFIG.state_lookback_minutes) * 60 * 1000).toISOString();

    const [messages, stateJobs] = await Promise.all([
        fetchRecentCustomerMessages(supabase, sinceIso, config),
        fetchRecentChatMessageStateJobs(supabase, stateSinceIso, config)
    ]);

    const userIds = Array.from(new Set((messages || []).map((message) => normalizeText(message.user_id)).filter(Boolean)));
    const emailSessionIds = Array.from(new Set(
        (messages || [])
            .map((message) => normalizeText(message.session_id).toLowerCase())
            .filter((value) => value.includes('@'))
    ));
    const [profilesById, profilesByEmail] = await Promise.all([
        fetchProfilesByFilter(supabase, 'id', userIds, config),
        fetchProfilesByFilter(supabase, 'email', emailSessionIds, config)
    ]);
    const profilesContext = buildProfilesContext([...(profilesById || []), ...(profilesByEmail || [])]);
    const alerts = buildCustomerChatMessageAlerts(messages, profilesContext, config, { now: nowDate });

    let queued = 0;
    let deduped = 0;
    let skippedNoChannels = 0;
    const results = [];

    for (const alert of alerts) {
        const latestJob = getLatestChatMessageStateJob(stateJobs, alert.alertType, alert.payload?.message_id);
        if (latestJob) {
            deduped += 1;
            results.push({
                message_id: alert.payload?.message_id || null,
                queued: false,
                reason: 'deduped'
            });
            continue;
        }

        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            createdAt: alert.payload?.created_at || nowDate.toISOString(),
            source: 'customer_chat_message_monitor'
        }, {
            runtime,
            env,
            now: nowDate
        });

        if (result?.queued === true) {
            queued += 1;
        } else if (result?.reason === 'deduped') {
            deduped += 1;
        } else if (result?.reason === 'no_active_channels') {
            skippedNoChannels += 1;
        }

        results.push({
            message_id: alert.payload?.message_id || null,
            sender_label: alert.payload?.sender_label || null,
            queued: result?.queued === true,
            reason: result?.reason || null
        });
    }

    return {
        message_count: alerts.length,
        queued,
        deduped,
        skipped_no_channels: skippedNoChannels,
        state_job_count: stateJobs.length,
        results
    };
}

module.exports = {
    CHAT_MESSAGE_STATE_TYPES,
    DEFAULT_CHAT_MESSAGE_MONITOR_CONFIG,
    buildCustomerChatMessageAlerts,
    normalizeChatMessageMonitorConfig,
    runCustomerChatMessageSweep,
    __testUtils: {
        buildProfilesContext,
        compareCreatedAtDescending,
        fetchPagedRows,
        getLatestChatMessageStateJob,
        getMessagePreview,
        getMessageTargetId,
        getMessageTypeLabel,
        resolveMessageProfile,
        resolveSenderEmail,
        resolveSenderLabel
    }
};
