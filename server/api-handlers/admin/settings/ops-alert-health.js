const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    buildOpsAlertSecretStatus,
    loadOpsAlertsRuntimeConfig
} = require('../../../../api/_lib/ops-alerts');

const OPS_ALERT_HEALTH_LOOKBACK_HOURS = 72;
const OPS_ALERT_HEALTH_PAGE_SIZE = 200;
const OPS_ALERT_HEALTH_MAX_PAGES = 5;
const OPS_ALERT_HEALTH_CHANNELS = Object.freeze([
    { key: 'telegram', label: 'Telegram' },
    { key: 'feishu', label: '飞书' },
    { key: 'email', label: '邮件' }
]);

function normalizeText(value, maxLength = 400) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeChannelList(value) {
    if (Array.isArray(value)) {
        return Array.from(new Set(value.map((item) => normalizeText(item, 80).toLowerCase()).filter(Boolean)));
    }

    if (typeof value === 'string') {
        return Array.from(new Set(
            value
                .split(/[,\n]/)
                .map((item) => normalizeText(item, 80).toLowerCase())
                .filter(Boolean)
        ));
    }

    return [];
}

function compareValue(left, right) {
    const leftDate = Date.parse(left);
    const rightDate = Date.parse(right);

    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) {
        return leftDate - rightDate;
    }

    return String(left || '').localeCompare(String(right || ''));
}

async function fetchPagedRows(buildQuery, pageSize = OPS_ALERT_HEALTH_PAGE_SIZE, maxPages = OPS_ALERT_HEALTH_MAX_PAGES) {
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

async function fetchRecentJobs(supabase, sinceIso) {
    return fetchPagedRows(() => supabase
        .from('ops_alert_jobs')
        .select('id, status, channels, remaining_channels, created_at, last_error, alert_type, title, payload')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }));
}

async function fetchRecentAttempts(supabase, sinceIso) {
    return fetchPagedRows(() => supabase
        .from('ops_alert_job_attempts')
        .select('job_id, channel, status, response_status, error_message, created_at')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }));
}

function groupRecentErrors(attempts = []) {
    const errorMap = new Map();

    for (const attempt of attempts) {
        const status = normalizeText(attempt.status, 80).toLowerCase();
        if (status === 'delivered') continue;

        const key = normalizeText(attempt.error_message, 240)
            || (Number.isFinite(Number(attempt.response_status)) ? `HTTP ${Number(attempt.response_status)}` : '')
            || '未知错误';
        const current = errorMap.get(key) || {
            message: key,
            count: 0,
            last_seen_at: ''
        };

        current.count += 1;
        const createdAt = normalizeText(attempt.created_at, 80);
        if (!current.last_seen_at || compareValue(current.last_seen_at, createdAt) < 0) {
            current.last_seen_at = createdAt;
        }

        errorMap.set(key, current);
    }

    return Array.from(errorMap.values())
        .sort((left, right) => {
            if (right.count !== left.count) {
                return right.count - left.count;
            }
            return compareValue(right.last_seen_at, left.last_seen_at);
        })
        .slice(0, 3);
}

function buildChannelRecipientSummary(channelKey, config = {}) {
    if (channelKey === 'telegram') {
        const chatIds = normalizeChannelList(config.chat_ids);
        return chatIds.length ? `${chatIds.length} 个 chat` : '未配置 Chat ID';
    }

    if (channelKey === 'feishu') {
        return 'Webhook 通道';
    }

    if (channelKey === 'email') {
        const recipients = normalizeChannelList(config.recipients);
        return recipients.length ? `${recipients.length} 个收件人` : '未配置收件人';
    }

    return '未配置';
}

function buildEmailRecipientPreview(config = {}) {
    const recipients = normalizeChannelList(config.recipients);
    if (!recipients.length) {
        return '';
    }

    const preview = recipients.slice(0, 2).join('、');
    return recipients.length > 2
        ? `${preview} 等 ${recipients.length} 人`
        : preview;
}

function buildRecentDeliveryTarget(job = {}) {
    const payload = job && typeof job.payload === 'object' && job.payload
        ? job.payload
        : {};
    const alertType = normalizeText(job.alert_type, 80).toLowerCase();

    if (alertType === 'customer_chat_message_received') {
        return normalizeText(payload.sender_label || payload.user_id || payload.session_id, 120);
    }

    if (alertType === 'shop_purchase_succeeded') {
        return normalizeText(payload.buyer_label || payload.user_id || payload.order_id, 120);
    }

    if (alertType === 'wallet_recharge_succeeded') {
        return normalizeText(payload.buyer_label || payload.user_id || payload.payment_order_id, 120);
    }

    return normalizeText(
        payload.buyer_label
        || payload.sender_label
        || payload.user_id
        || payload.order_id
        || payload.payment_order_id
        || payload.target_id,
        120
    );
}

function buildRecentDeliveryEntries(jobs = [], attempts = [], limit = 5) {
    const jobsById = new Map(
        (Array.isArray(jobs) ? jobs : []).map((job) => [normalizeText(job.id, 120), job])
    );

    return (Array.isArray(attempts) ? attempts : [])
        .filter((attempt) => normalizeText(attempt.status, 80).toLowerCase() === 'delivered')
        .map((attempt) => {
            const job = jobsById.get(normalizeText(attempt.job_id, 120)) || {};
            return {
                job_id: normalizeText(attempt.job_id, 120),
                channel: normalizeText(attempt.channel, 40).toLowerCase(),
                alert_type: normalizeText(job.alert_type, 120).toLowerCase(),
                title: normalizeText(job.title, 160) || normalizeText(job.alert_type, 120) || '系统告警',
                target_summary: buildRecentDeliveryTarget(job),
                created_at: normalizeText(attempt.created_at || job.created_at, 80) || ''
            };
        })
        .sort((left, right) => compareValue(right.created_at, left.created_at))
        .slice(0, Math.max(0, limit));
}

function buildRecentErrorEntries(channels = [], limit = 5) {
    const normalizedChannels = Array.isArray(channels) ? channels : [];
    const errorMap = new Map();

    for (const channel of normalizedChannels) {
        const channelLabel = normalizeText(channel.label, 40) || normalizeText(channel.key, 40) || '通道';
        const recentErrors = Array.isArray(channel.recent_errors) ? channel.recent_errors : [];
        for (const item of recentErrors) {
            const message = normalizeText(item.message, 240) || '未知错误';
            const key = `${normalizeText(channel.key, 40)}::${message}`;
            const current = errorMap.get(key) || {
                channel: normalizeText(channel.key, 40).toLowerCase(),
                channel_label: channelLabel,
                message,
                count: 0,
                last_seen_at: ''
            };

            current.count += Number(item.count || 0) || 0;
            const lastSeenAt = normalizeText(item.last_seen_at, 80);
            if (!current.last_seen_at || compareValue(current.last_seen_at, lastSeenAt) < 0) {
                current.last_seen_at = lastSeenAt;
            }

            errorMap.set(key, current);
        }
    }

    return Array.from(errorMap.values())
        .sort((left, right) => {
            if (right.count !== left.count) {
                return right.count - left.count;
            }
            return compareValue(right.last_seen_at, left.last_seen_at);
        })
        .slice(0, Math.max(0, limit));
}

function buildRecentDeliveryTypeStats(entries = [], limit = 5) {
    const normalizedEntries = Array.isArray(entries) ? entries : [];
    const stats = new Map();

    for (const entry of normalizedEntries) {
        const alertType = normalizeText(entry.alert_type, 120).toLowerCase() || 'system_alert';
        const title = normalizeText(entry.title, 160) || alertType || '系统告警';
        const current = stats.get(alertType) || {
            alert_type: alertType,
            title,
            count: 0
        };
        current.count += 1;
        stats.set(alertType, current);
    }

    return Array.from(stats.values())
        .sort((left, right) => {
            if (right.count !== left.count) {
                return right.count - left.count;
            }
            return String(left.title || '').localeCompare(String(right.title || ''));
        })
        .slice(0, Math.max(0, limit));
}

function buildRecentErrorChannelStats(entries = [], limit = 5) {
    const normalizedEntries = Array.isArray(entries) ? entries : [];
    const stats = new Map();

    for (const entry of normalizedEntries) {
        const channel = normalizeText(entry.channel, 40).toLowerCase() || 'unknown';
        const channelLabel = normalizeText(entry.channel_label, 40) || channel || '未知通道';
        const current = stats.get(channel) || {
            channel,
            channel_label: channelLabel,
            count: 0
        };
        current.count += Number(entry.count || 0) || 0;
        stats.set(channel, current);
    }

    return Array.from(stats.values())
        .sort((left, right) => {
            if (right.count !== left.count) {
                return right.count - left.count;
            }
            return String(left.channel_label || '').localeCompare(String(right.channel_label || ''));
        })
        .slice(0, Math.max(0, limit));
}

function buildChannelStatus(channelKey, config = {}, secretStatus = {}, jobs = [], attempts = []) {
    const enabled = config.enabled === true;
    const configured = secretStatus.configured === true;
    const hasDestinations = channelKey === 'telegram'
        ? normalizeChannelList(config.chat_ids).length > 0
        : (channelKey === 'email'
            ? (normalizeChannelList(config.recipients).length > 0 && Boolean(normalizeText(config.from_address)))
            : true);
    const ready = configured && hasDestinations;
    const minimumSeverity = normalizeText(config.minimum_severity, 40).toLowerCase() || 'warning';
    const deliveredCount = attempts.filter((attempt) => normalizeText(attempt.status, 80).toLowerCase() === 'delivered').length;
    const failedCount = attempts.length - deliveredCount;
    const retryCount = jobs.filter((job) => normalizeText(job.status, 80).toLowerCase() === 'retry').length;
    const deadLetterCount = jobs.filter((job) => normalizeText(job.status, 80).toLowerCase() === 'dead_letter').length;
    const pendingCount = jobs.filter((job) => ['pending', 'retry'].includes(normalizeText(job.status, 80).toLowerCase())).length;
    const deliveryRate = attempts.length > 0
        ? Math.round((deliveredCount / attempts.length) * 1000) / 10
        : null;
    const lastAttemptAt = attempts[0]?.created_at || '';
    const lastFailureAt = attempts.find((attempt) => normalizeText(attempt.status, 80).toLowerCase() !== 'delivered')?.created_at || '';
    const recentErrors = groupRecentErrors(attempts);
    const recentDeliveries = buildRecentDeliveryEntries(jobs, attempts, 3);
    const lastError = recentErrors[0]?.message
        || jobs.find((job) => normalizeText(job.last_error, 400))?.last_error
        || '';

    let tone = 'neutral';
    let healthLabel = '未启用';

    if (enabled && ready) {
        if (deadLetterCount > 0) {
            tone = 'danger';
            healthLabel = '存在死信';
        } else if (failedCount > 0 || retryCount > 0) {
            tone = 'warning';
            healthLabel = '存在失败 / 重试';
        } else if (attempts.length > 0) {
            tone = 'success';
            healthLabel = '最近投递正常';
        } else {
            tone = 'neutral';
            healthLabel = '已启用，等待投递';
        }
    } else if (enabled && !ready) {
        tone = 'warning';
        healthLabel = '已启用，但配置不完整';
    }

    return {
        key: channelKey,
        enabled,
        configured,
        source: normalizeText(secretStatus.source, 40) || 'missing',
        updated_at: secretStatus.updatedAt || null,
        minimum_severity: minimumSeverity,
        recipient_summary: buildChannelRecipientSummary(channelKey, config),
        tone,
        health_label: healthLabel,
        total_attempts: attempts.length,
        delivered_count: deliveredCount,
        failed_count: failedCount,
        retry_count: retryCount,
        dead_letter_count: deadLetterCount,
        pending_count: pendingCount,
        delivery_rate: deliveryRate,
        last_attempt_at: normalizeText(lastAttemptAt, 80) || null,
        last_failure_at: normalizeText(lastFailureAt, 80) || null,
        last_error: normalizeText(lastError, 500) || '',
        recent_errors: recentErrors,
        recent_deliveries: recentDeliveries,
        recipient_preview: channelKey === 'email' ? buildEmailRecipientPreview(config) : '',
        from_address: channelKey === 'email' ? normalizeText(config.from_address, 200) : '',
        reply_to: channelKey === 'email' ? normalizeText(config.reply_to, 200) : '',
        subject_prefix: channelKey === 'email' ? normalizeText(config.subject_prefix, 120) : ''
    };
}

module.exports = async (req, res) => {
    try {
        const { supabase } = await requireAdmin(req);

        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const runtime = await loadOpsAlertsRuntimeConfig(supabase);
        const secretStatus = buildOpsAlertSecretStatus(runtime);
        const now = new Date();
        const sinceIso = new Date(now.getTime() - OPS_ALERT_HEALTH_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
        const [jobs, attempts] = await Promise.all([
            fetchRecentJobs(supabase, sinceIso),
            fetchRecentAttempts(supabase, sinceIso)
        ]);

        const channels = OPS_ALERT_HEALTH_CHANNELS.map((channel) => {
            const channelKey = channel.key;
            const channelJobs = jobs.filter((job) => (
                normalizeChannelList(job.remaining_channels).includes(channelKey)
                || normalizeChannelList(job.channels).includes(channelKey)
            ));
            const channelAttempts = attempts.filter((attempt) => normalizeText(attempt.channel, 80).toLowerCase() === channelKey);
            return {
                key: channelKey,
                label: channel.label,
                ...buildChannelStatus(
                    channelKey,
                    runtime.config?.channels?.[channelKey] || {},
                    secretStatus[channelKey === 'telegram' ? 'telegram_bot_token' : (channelKey === 'feishu' ? 'feishu_webhook_url' : 'email_api_key')] || {},
                    channelJobs,
                    channelAttempts
                )
            };
        });

        const recentDeliveries = buildRecentDeliveryEntries(jobs, attempts, 5);
        const recentErrors = buildRecentErrorEntries(channels, 5);
        const summary = {
            lookback_hours: OPS_ALERT_HEALTH_LOOKBACK_HOURS,
            total_job_count: jobs.length,
            total_attempt_count: attempts.length,
            delivered_count: channels.reduce((sum, channel) => sum + Number(channel.delivered_count || 0), 0),
            failed_count: channels.reduce((sum, channel) => sum + Number(channel.failed_count || 0), 0),
            dead_letter_count: channels.reduce((sum, channel) => sum + Number(channel.dead_letter_count || 0), 0),
            enabled_channel_count: channels.filter((channel) => channel.enabled).length,
            recent_deliveries: recentDeliveries,
            recent_delivery_types: buildRecentDeliveryTypeStats(recentDeliveries, 5),
            recent_errors: recentErrors,
            recent_error_channels: buildRecentErrorChannelStats(recentErrors, 5)
        };

        return sendJson(res, 200, {
            success: true,
            fetched_at: now.toISOString(),
            summary,
            channels
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Ops alert health settings failed'
        });
    }
};
