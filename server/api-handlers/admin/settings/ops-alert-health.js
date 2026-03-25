const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    buildOpsAlertSecretStatus,
    loadOpsAlertsRuntimeConfig
} = require('../../../../api/_lib/ops-alerts');

const OPS_ALERT_HEALTH_LOOKBACK_DAYS = 7;
const OPS_ALERT_HEALTH_PAGE_SIZE = 200;
const OPS_ALERT_HEALTH_MAX_PAGES = 5;
const HEALTH_CHANNELS = Object.freeze(['telegram', 'feishu', 'email']);

function sanitizeText(value, maxLength = 240) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeStringArray(value) {
    if (Array.isArray(value)) {
        return Array.from(new Set(value.map((item) => sanitizeText(item, 320)).filter(Boolean)));
    }
    if (typeof value === 'string') {
        return Array.from(new Set(
            value
                .split(/[\n,]/)
                .map((item) => sanitizeText(item, 320))
                .filter(Boolean)
        ));
    }
    return [];
}

function normalizeJobChannels(job = {}) {
    const source = Array.isArray(job.channels) && job.channels.length
        ? job.channels
        : job.remaining_channels;
    return normalizeStringArray(source).map((item) => item.toLowerCase());
}

function channelLabel(channel) {
    if (channel === 'telegram') return 'Telegram';
    if (channel === 'feishu') return '飞书';
    if (channel === 'email') return '邮件';
    return channel;
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
        if (error) throw error;
        const batch = Array.isArray(data) ? data : [];
        rows.push(...batch);
        if (batch.length < pageSize) break;
    }

    return rows;
}

async function fetchRecentOpsAlertJobs(supabase, sinceIso) {
    return fetchPagedRows(() => supabase
        .from('ops_alert_jobs')
        .select('id, alert_type, status, channels, remaining_channels, created_at, delivered_at, updated_at')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }));
}

async function fetchRecentOpsAlertAttempts(supabase, sinceIso) {
    return fetchPagedRows(() => supabase
        .from('ops_alert_job_attempts')
        .select('id, job_id, channel, status, response_status, error_message, response_body, created_at')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }));
}

function pickTopErrors(attempts = []) {
    const counts = new Map();
    for (const attempt of attempts) {
        const key = sanitizeText(attempt.error_message || attempt.response_body, 240) || `HTTP ${Number(attempt.response_status || 0) || 0}`;
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    return Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1] || compareValue(left[0], right[0]))
        .slice(0, 3)
        .map(([message, count]) => ({ message, count }));
}

function buildChannelHealthSummary({
    enabled,
    configured,
    deliveredCount,
    failedCount,
    retryJobCount,
    deadLetterJobCount,
    attemptCount
}) {
    if (!enabled) {
        return { tone: 'neutral', summary: '当前未启用该通道。' };
    }

    if (!configured) {
        return { tone: 'warning', summary: '通道已启用，但关键密钥或目标配置尚未补齐。' };
    }

    if (deadLetterJobCount > 0) {
        return { tone: 'danger', summary: `存在 ${deadLetterJobCount} 条死信任务，需要人工排查。` };
    }

    if (failedCount > 0 && deliveredCount === 0) {
        return { tone: 'danger', summary: '最近时间窗内投递全部失败，请优先排查通道配置与上游可用性。' };
    }

    if (retryJobCount > 0 || failedCount > deliveredCount) {
        return { tone: 'warning', summary: '最近存在重试或失败放大，建议复核错误原因与目标配置。' };
    }

    if (attemptCount > 0 && failedCount === 0) {
        return { tone: 'success', summary: '最近投递稳定，未发现失败或重试。' };
    }

    return { tone: 'neutral', summary: '最近暂无足够投递样本。' };
}

function buildChannelSnapshot(channel, runtime, secretStatus, attempts, jobs) {
    const channelConfig = runtime?.config?.channels?.[channel] || {};
    const status = secretStatus?.[channel === 'email' ? 'email_api_key' : `${channel}${channel === 'telegram' ? '_bot_token' : '_webhook_url'}`];
    const enabled = channelConfig.enabled === true;
    const configured = Boolean(status?.configured);
    const deliveredAttempts = attempts.filter((item) => sanitizeText(item.status, 40).toLowerCase() === 'delivered');
    const failedAttempts = attempts.filter((item) => sanitizeText(item.status, 40).toLowerCase() !== 'delivered');
    const pendingJobCount = jobs.filter((job) => sanitizeText(job.status, 40).toLowerCase() === 'pending').length;
    const retryJobCount = jobs.filter((job) => sanitizeText(job.status, 40).toLowerCase() === 'retry').length;
    const processingJobCount = jobs.filter((job) => sanitizeText(job.status, 40).toLowerCase() === 'processing').length;
    const deadLetterJobCount = jobs.filter((job) => sanitizeText(job.status, 40).toLowerCase() === 'dead_letter').length;
    const lastDeliveredAt = deliveredAttempts[0]?.created_at || '';
    const lastFailedAt = failedAttempts[0]?.created_at || '';
    const deliveryRate = attempts.length
        ? Math.round((deliveredAttempts.length / attempts.length) * 1000) / 10
        : null;
    const recipients = normalizeStringArray(channelConfig.recipients);
    const { tone, summary } = buildChannelHealthSummary({
        enabled,
        configured,
        deliveredCount: deliveredAttempts.length,
        failedCount: failedAttempts.length,
        retryJobCount,
        deadLetterJobCount,
        attemptCount: attempts.length
    });

    return {
        key: channel,
        label: channelLabel(channel),
        enabled,
        configured,
        source: sanitizeText(status?.source, 40) || 'missing',
        updated_at: status?.updatedAt || null,
        minimum_severity: sanitizeText(channelConfig.minimum_severity, 20) || 'warning',
        chat_count: channel === 'telegram' ? normalizeStringArray(channelConfig.chat_ids).length : 0,
        recipient_count: channel === 'email' ? recipients.length : 0,
        recipients_preview: channel === 'email' ? recipients.slice(0, 3) : [],
        from_address: channel === 'email' ? sanitizeText(channelConfig.from_address, 240) : '',
        attempt_count: attempts.length,
        delivered_count: deliveredAttempts.length,
        failed_count: failedAttempts.length,
        delivery_rate: deliveryRate,
        pending_job_count: pendingJobCount,
        retry_job_count: retryJobCount,
        processing_job_count: processingJobCount,
        dead_letter_job_count: deadLetterJobCount,
        last_delivered_at: lastDeliveredAt || null,
        last_failed_at: lastFailedAt || null,
        top_errors: pickTopErrors(failedAttempts),
        health_tone: tone,
        health_summary: summary
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

        const now = new Date();
        const sinceIso = new Date(now.getTime() - OPS_ALERT_HEALTH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const [runtime, jobs, attempts] = await Promise.all([
            loadOpsAlertsRuntimeConfig(supabase),
            fetchRecentOpsAlertJobs(supabase, sinceIso),
            fetchRecentOpsAlertAttempts(supabase, sinceIso)
        ]);
        const secretStatus = buildOpsAlertSecretStatus(runtime);
        const channels = HEALTH_CHANNELS.map((channel) => {
            const channelAttempts = attempts.filter((item) => sanitizeText(item.channel, 40).toLowerCase() === channel);
            const channelJobs = jobs.filter((job) => normalizeJobChannels(job).includes(channel));
            return buildChannelSnapshot(channel, runtime, secretStatus, channelAttempts, channelJobs);
        });
        const recentFailures = attempts
            .filter((item) => sanitizeText(item.status, 40).toLowerCase() !== 'delivered')
            .slice(0, 8)
            .map((item) => ({
                id: sanitizeText(item.id, 160),
                channel: sanitizeText(item.channel, 40).toLowerCase(),
                channel_label: channelLabel(sanitizeText(item.channel, 40).toLowerCase()),
                job_id: sanitizeText(item.job_id, 160),
                response_status: Number.isFinite(Number(item.response_status)) ? Number(item.response_status) : null,
                error_message: sanitizeText(item.error_message || item.response_body, 320),
                created_at: sanitizeText(item.created_at, 80) || null
            }));

        return sendJson(res, 200, {
            success: true,
            fetched_at: now.toISOString(),
            summary: {
                lookback_days: OPS_ALERT_HEALTH_LOOKBACK_DAYS,
                total_job_count: jobs.length,
                total_attempt_count: attempts.length,
                enabled_channel_count: channels.filter((item) => item.enabled).length,
                configured_channel_count: channels.filter((item) => item.configured).length
            },
            channels,
            recent_failures: recentFailures
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Ops alert health settings failed'
        });
    }
};
