const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');

const SUMMARY_HISTORY_ACTION_TYPES = Object.freeze([
    'ticket.summary_job_action'
]);

function normalizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => normalizeText(item, 80).toLowerCase())
        .filter(Boolean);
}

function normalizeWholeNumber(value, fallback = 0, min = 0, max = Number.POSITIVE_INFINITY) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
}

function isMissingRelationError(error, relationName = '') {
    const normalizedMessage = normalizeText(error?.message, 600).toLowerCase();
    const normalizedRelation = normalizeText(relationName, 120).toLowerCase();

    if (!normalizedMessage) {
        return false;
    }

    const mentionsRelation = normalizedRelation
        ? normalizedMessage.includes(normalizedRelation)
        : normalizedMessage.includes('relation') || normalizedMessage.includes('table');

    return mentionsRelation && (
        normalizedMessage.includes('does not exist')
        || normalizedMessage.includes('not exist')
        || normalizedMessage.includes('could not find')
        || normalizedMessage.includes('undefined table')
    );
}

function getChannelLabel(channel = '') {
    const normalized = normalizeText(channel, 80).toLowerCase();
    if (normalized === 'feishu') return '飞书';
    if (normalized === 'email') return '邮件';
    if (normalized === 'telegram') return 'Telegram';
    if (normalized === 'sms') return '短信';
    if (normalized === 'webhook') return 'Webhook';
    return normalized || '未知通道';
}

function getQueueStatusLabel(status = '') {
    const normalized = normalizeText(status, 40).toLowerCase();
    if (normalized === 'delivered') return '已送达';
    if (normalized === 'retry') return '重试中';
    if (normalized === 'dead_letter') return '进入死信';
    if (normalized === 'pending' || normalized === 'processing') return '发送中';
    return normalized ? normalized.toUpperCase() : '未知状态';
}

function formatScheduleLabel(payload = {}) {
    const mode = normalizeText(payload.summary_schedule_mode, 40).toLowerCase();
    if (mode === 'hourly') {
        return `每小时 ${String(normalizeWholeNumber(payload.summary_hourly_minute, 0, 0, 59)).padStart(2, '0')} 分`;
    }
    if (mode === 'daily') {
        return `每天 ${String(normalizeWholeNumber(payload.summary_daily_hour, 9, 0, 23)).padStart(2, '0')}:${String(normalizeWholeNumber(payload.summary_daily_minute, 0, 0, 59)).padStart(2, '0')}`;
    }
    return `滚动 ${normalizeWholeNumber(payload.summary_window_minutes, 60, 5, 24 * 60)} 分钟窗口`;
}

function formatWindowLabel(payload = {}) {
    const start = normalizeText(payload.window_start_at, 80);
    const end = normalizeText(payload.window_end_at, 80);
    if (start || end) {
        return `${start || '未知'} -> ${end || '未知'}`;
    }
    return formatScheduleLabel(payload);
}

function buildSummaryJobResponse(job = null) {
    if (!job || typeof job !== 'object') {
        return null;
    }

    return {
        id: normalizeText(job.id, 120),
        alert_type: normalizeText(job.alert_type, 120).toLowerCase(),
        severity: normalizeText(job.severity, 40).toLowerCase(),
        title: normalizeText(job.title, 200),
        status: normalizeText(job.status, 40).toLowerCase(),
        attempt_count: normalizeWholeNumber(job.attempt_count, 0, 0, 1000),
        max_attempts: normalizeWholeNumber(job.max_attempts, 0, 0, 1000),
        channels: normalizeStringArray(job.channels),
        remaining_channels: normalizeStringArray(job.remaining_channels),
        next_retry_at: normalizeText(job.next_retry_at, 80) || '',
        last_attempt_at: normalizeText(job.last_attempt_at, 80) || '',
        delivered_at: normalizeText(job.delivered_at, 80) || '',
        last_error: normalizeText(job.last_error, 400) || '',
        worker_name: normalizeText(job.worker_name, 120) || '',
        created_at: normalizeText(job.created_at, 80) || '',
        updated_at: normalizeText(job.updated_at, 80) || ''
    };
}

async function fetchSummaryJob(supabase, jobId = '') {
    const { data, error } = await supabase
        .from('ops_alert_jobs')
        .select('id, alert_type, severity, title, payload, channels, remaining_channels, status, attempt_count, max_attempts, next_retry_at, last_attempt_at, delivered_at, last_error, worker_name, created_at, updated_at')
        .eq('id', jobId)
        .single();

    if (error) {
        throw error;
    }

    return data || null;
}

async function fetchSummaryAttempts(supabase, jobId = '') {
    try {
        const { data, error } = await supabase
            .from('ops_alert_job_attempts')
            .select('job_id, channel, status, response_status, error_message, created_at')
            .eq('job_id', jobId)
            .order('created_at', { ascending: true })
            .limit(200);

        if (error) {
            throw error;
        }

        return Array.isArray(data) ? data : [];
    } catch (error) {
        if (isMissingRelationError(error, 'ops_alert_job_attempts')) {
            return [];
        }
        throw error;
    }
}

async function fetchAuditRows(supabase, tableName = 'admin_audit_logs_view', selection = 'id, action_type, details, created_at, admin_id, admin_email') {
    const { data, error } = await supabase
        .from(tableName)
        .select(selection)
        .in('action_type', SUMMARY_HISTORY_ACTION_TYPES)
        .order('created_at', { ascending: true })
        .limit(200);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function fetchSummaryAuditRows(supabase, jobId = '') {
    let rows = [];

    try {
        rows = await fetchAuditRows(supabase, 'admin_audit_logs_view', 'id, action_type, details, created_at, admin_id, admin_email');
    } catch (error) {
        if (!isMissingRelationError(error, 'admin_audit_logs_view')) {
            throw error;
        }

        try {
            rows = await fetchAuditRows(supabase, 'admin_audit_logs', 'id, action_type, details, created_at, admin_id');
        } catch (fallbackError) {
            if (isMissingRelationError(fallbackError, 'admin_audit_logs')) {
                return [];
            }
            throw fallbackError;
        }
    }

    return rows.filter((row) => normalizeText(normalizeJsonObject(row.details).job_id, 120) === jobId);
}

function buildTimelineItem(overrides = {}) {
    return {
        id: normalizeText(overrides.id, 160) || null,
        title: normalizeText(overrides.title, 200) || null,
        detail: normalizeText(overrides.detail, 4000) || '',
        time: normalizeText(overrides.time || overrides.created_at, 80) || null,
        created_at: normalizeText(overrides.created_at || overrides.time, 80) || null,
        icon: normalizeText(overrides.icon, 80) || 'fa-clock-rotate-left',
        tone: normalizeText(overrides.tone, 40).toLowerCase() || '',
        actor: normalizeText(overrides.actor, 255) || null,
        _sortKey: Number.isFinite(Date.parse(normalizeText(overrides.created_at || overrides.time, 80)))
            ? Date.parse(normalizeText(overrides.created_at || overrides.time, 80))
            : Number.POSITIVE_INFINITY,
        _sortIndex: normalizeWholeNumber(overrides.sortIndex, 0, 0, 10000)
    };
}

function buildCreatedHistoryItem(job = null) {
    if (!job || typeof job !== 'object') {
        return null;
    }

    const payload = normalizeJsonObject(job.payload);
    const detailLines = [
        `汇总策略：${formatScheduleLabel(payload)}`,
        `统计窗口：${formatWindowLabel(payload)}`,
        `累计工单：${normalizeWholeNumber(payload.item_count, 0, 0, 5000)} 单`,
        `投递通道：${normalizeStringArray(job.channels).map((channel) => getChannelLabel(channel)).join(' / ') || '未配置通道'}`,
        normalizeText(payload.entry_path, 160) ? `入口：${normalizeText(payload.entry_path, 160)}` : ''
    ].filter(Boolean);

    return buildTimelineItem({
        id: `summary-created:${normalizeText(job.id, 120)}`,
        title: '生成 SLA 汇总任务',
        detail: detailLines.join('\n'),
        time: normalizeText(job.created_at, 80),
        icon: 'fa-file-waveform',
        sortIndex: 0
    });
}

function getAttemptTitle(status = '') {
    const normalized = normalizeText(status, 40).toLowerCase();
    if (normalized === 'delivered') return '汇总投递成功';
    if (normalized === 'failed') return '汇总投递失败';
    if (normalized === 'skipped') return '汇总投递已跳过';
    if (normalized === 'processing' || normalized === 'pending') return '汇总投递处理中';
    if (normalized === 'retry') return '汇总投递等待重试';
    return '汇总投递更新';
}

function getAttemptIcon(status = '') {
    const normalized = normalizeText(status, 40).toLowerCase();
    if (normalized === 'delivered') return 'fa-circle-check';
    if (normalized === 'failed') return 'fa-triangle-exclamation';
    if (normalized === 'processing' || normalized === 'pending') return 'fa-hourglass-half';
    if (normalized === 'retry') return 'fa-rotate-right';
    return 'fa-paper-plane';
}

function getAttemptTone(status = '') {
    const normalized = normalizeText(status, 40).toLowerCase();
    if (normalized === 'delivered') return 'success';
    if (normalized === 'failed') return 'danger';
    if (normalized === 'retry') return 'warning';
    if (normalized === 'processing' || normalized === 'pending') return 'info';
    return '';
}

function buildAttemptHistoryItem(attempt = {}, index = 0) {
    const detailLines = [
        `投递通道：${getChannelLabel(attempt.channel)}`,
        `结果状态：${getQueueStatusLabel(attempt.status)}`,
        Number.isFinite(Number(attempt.response_status)) ? `HTTP 状态：${Number(attempt.response_status)}` : '',
        normalizeText(attempt.error_message, 400) ? `错误信息：${normalizeText(attempt.error_message, 400)}` : ''
    ].filter(Boolean);

    return buildTimelineItem({
        id: `summary-attempt:${normalizeText(attempt.job_id, 120)}:${index}`,
        title: getAttemptTitle(attempt.status),
        detail: detailLines.join('\n'),
        time: normalizeText(attempt.created_at, 80),
        icon: getAttemptIcon(attempt.status),
        tone: getAttemptTone(attempt.status),
        sortIndex: 10 + index
    });
}

function resolveSummaryAction(details = {}) {
    const normalizedAction = normalizeText(details.action, 80).toLowerCase();
    if (normalizedAction === 'request_retry' || normalizedAction === 'add_note') {
        return normalizedAction;
    }
    if (normalizeText(details.note || details.internal_note, 2000)) {
        return 'add_note';
    }
    if (normalizeText(details.manual_retry_mode, 80) || normalizeText(details.queue_next_status, 80) === 'retry') {
        return 'request_retry';
    }
    return '';
}

function buildAuditHistoryItem(row = {}, index = 0) {
    const details = normalizeJsonObject(row.details);
    const action = resolveSummaryAction(details);
    const actor = normalizeText(row.admin_email, 255) || normalizeText(row.admin_id, 120);
    const lines = [];
    let title = '人工更新汇总任务';
    let icon = 'fa-user-gear';
    let tone = '';

    if (action === 'add_note') {
        title = '记录人工备注';
        icon = 'fa-note-sticky';
        if (actor) {
            lines.push(`记录人：${actor}`);
        }
        if (normalizeText(details.note || details.internal_note, 2000)) {
            lines.push(`内部备注：${normalizeText(details.note || details.internal_note, 2000)}`);
        }
    } else if (action === 'request_retry') {
        const retryMode = normalizeText(details.manual_retry_mode, 40).toLowerCase();
        title = retryMode === 'requeue'
            ? '人工重新加入重试队列'
            : '人工立即重试汇总';
        icon = retryMode === 'requeue' ? 'fa-rotate-left' : 'fa-bolt';
        tone = 'warning';
        if (actor) {
            lines.push(`操作人：${actor}`);
        }
        if (normalizeText(details.queue_previous_status, 80) || normalizeText(details.queue_next_status, 80)) {
            lines.push(`队列状态：${getQueueStatusLabel(details.queue_previous_status)} -> ${getQueueStatusLabel(details.queue_next_status)}`);
        }
        if (Number.isFinite(Number(details.queue_channel_count))) {
            lines.push(`涉及通道：${Math.max(0, Number(details.queue_channel_count))} 个`);
        }
        if (normalizeText(details.manual_retry_mode, 80)) {
            lines.push(`重试方式：${retryMode === 'requeue' ? '重新入队' : '立即催促下一次重试'}`);
        }
    } else {
        if (actor) {
            lines.push(`操作人：${actor}`);
        }
        if (normalizeText(details.queue_previous_status, 80) || normalizeText(details.queue_next_status, 80)) {
            lines.push(`队列状态：${getQueueStatusLabel(details.queue_previous_status)} -> ${getQueueStatusLabel(details.queue_next_status)}`);
        }
    }

    if (Number.isFinite(Number(details.item_count)) && Number(details.item_count) > 0) {
        lines.push(`累计工单：${Math.max(0, Number(details.item_count))} 单`);
    }

    return buildTimelineItem({
        id: normalizeText(row.id, 160) || `summary-audit:${index}`,
        title,
        detail: lines.join('\n'),
        time: normalizeText(row.created_at, 80),
        created_at: normalizeText(row.created_at, 80),
        icon,
        tone,
        actor,
        sortIndex: 100 + index
    });
}

function buildQueueSnapshotHistoryItem(job = null, attempts = []) {
    if (!job || typeof job !== 'object') {
        return null;
    }

    const status = normalizeText(job.status, 40).toLowerCase();
    const latestAttempt = Array.isArray(attempts) && attempts.length ? attempts[attempts.length - 1] : null;
    const hasDeliveredAttempt = Array.isArray(attempts)
        && attempts.some((attempt) => normalizeText(attempt?.status, 40).toLowerCase() === 'delivered');

    let title = '';
    let tone = '';
    let icon = 'fa-clock-rotate-left';
    if (status === 'retry') {
        title = '汇总任务等待自动重试';
        tone = 'warning';
        icon = 'fa-rotate-right';
    } else if (status === 'dead_letter') {
        title = '汇总任务进入死信队列';
        tone = 'danger';
        icon = 'fa-circle-exclamation';
    } else if (status === 'pending' || status === 'processing') {
        title = '汇总任务排队处理中';
        tone = 'info';
        icon = 'fa-hourglass-half';
    } else if (status === 'delivered' && !hasDeliveredAttempt) {
        title = '汇总任务已送达';
        tone = 'success';
        icon = 'fa-circle-check';
    }

    if (!title) {
        return null;
    }

    const detailLines = [
        `当前状态：${getQueueStatusLabel(status)}`,
        Array.isArray(job.remaining_channels) && job.remaining_channels.length
            ? `待重试通道：${normalizeStringArray(job.remaining_channels).map((channel) => getChannelLabel(channel)).join(' / ')}`
            : '',
        normalizeText(job.next_retry_at, 80) ? `下次重试：${normalizeText(job.next_retry_at, 80)}` : '',
        Number.isFinite(Number(job.attempt_count))
            ? `尝试次数：${Math.max(0, Number(job.attempt_count))}${Number.isFinite(Number(job.max_attempts)) && Number(job.max_attempts) > 0 ? ` / ${Math.max(0, Number(job.max_attempts))}` : ''}`
            : '',
        normalizeText(latestAttempt?.error_message || job.last_error, 400)
            ? `最近错误：${normalizeText(latestAttempt?.error_message || job.last_error, 400)}`
            : ''
    ].filter(Boolean);

    return buildTimelineItem({
        id: `summary-status:${normalizeText(job.id, 120)}`,
        title,
        detail: detailLines.join('\n'),
        time: normalizeText(job.updated_at || job.delivered_at || job.next_retry_at, 80),
        icon,
        tone,
        sortIndex: 900
    });
}

function buildSummaryHistoryItems(job = null, attempts = [], auditRows = []) {
    const items = [];
    const createdItem = buildCreatedHistoryItem(job);
    if (createdItem) {
        items.push(createdItem);
    }

    (Array.isArray(attempts) ? attempts : []).forEach((attempt, index) => {
        items.push(buildAttemptHistoryItem(attempt, index));
    });

    (Array.isArray(auditRows) ? auditRows : []).forEach((row, index) => {
        items.push(buildAuditHistoryItem(row, index));
    });

    const snapshotItem = buildQueueSnapshotHistoryItem(job, attempts);
    if (snapshotItem) {
        items.push(snapshotItem);
    }

    return items
        .filter((item) => normalizeText(item?.title, 200))
        .sort((left, right) => {
            if (left._sortKey !== right._sortKey) {
                return left._sortKey - right._sortKey;
            }
            return left._sortIndex - right._sortIndex;
        })
        .map((item) => ({
            id: item.id,
            title: item.title,
            detail: item.detail,
            time: item.time,
            created_at: item.created_at,
            icon: item.icon,
            tone: item.tone,
            actor: item.actor
        }));
}

module.exports = async function adminTicketSummaryHistoryHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'tickets.manage' });
        const url = new URL(req.url || '', 'http://localhost');
        const jobId = normalizeText(url.searchParams.get('jobId'), 120);

        if (!jobId) {
            return sendJson(res, 400, {
                success: false,
                message: 'jobId is required'
            });
        }

        const job = await fetchSummaryJob(supabase, jobId);
        if (!job) {
            return sendJson(res, 404, {
                success: false,
                message: 'Summary job not found'
            });
        }

        if (normalizeText(job.alert_type, 120).toLowerCase() !== 'ticket_sla_summary') {
            return sendJson(res, 400, {
                success: false,
                message: 'Only ticket summary jobs are supported'
            });
        }

        const [attempts, auditRows] = await Promise.all([
            fetchSummaryAttempts(supabase, jobId),
            fetchSummaryAuditRows(supabase, jobId)
        ]);

        return sendJson(res, 200, {
            success: true,
            jobId,
            summary_job: buildSummaryJobResponse(job),
            items: buildSummaryHistoryItems(job, attempts, auditRows)
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load summary job history'
        });
    }
};

module.exports.__testUtils = {
    buildSummaryHistoryItems,
    resolveSummaryAction
};
