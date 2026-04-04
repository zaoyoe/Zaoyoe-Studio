const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    loadOpsAlertsRuntimeConfig
} = require('../../../../api/_lib/ops-alerts');
const {
    DEFAULT_TICKET_SLA_MONITOR_CONFIG
} = require('../../../../api/_lib/ticket-sla-alerts');
const ticketListHandler = require('./list');

const CLOSED_LOOKBACK_DAYS = 30;
const TOUCH_LOOKBACK_DAYS = 90;
const REMINDER_ACTIVITY_LOOKBACK_DAYS = 7;
const TICKET_METRICS_ACTION_TYPES = Object.freeze([
    'ticket.assign',
    'ticket.process',
    'ticket.internal_note'
]);
const TICKET_REMINDER_ACTIVITY_ALERT_TYPES = Object.freeze([
    'ticket_sla_overdue',
    'ticket_sla_recovered'
]);
const TICKET_REMINDER_SUMMARY_ALERT_TYPES = Object.freeze([
    'ticket_sla_summary'
]);
const TICKET_REMINDER_SUMMARY_AUDIT_ACTION_TYPES = Object.freeze([
    'ticket.summary_job_action'
]);
const TICKET_REMINDER_SUMMARY_HISTORY_LIMIT = 4;

const {
    normalizeText,
    normalizeTicketStatus,
    isMissingRelationError,
    getIssueTypeLabel,
    loadProfilesByIds,
    loadOrdersByIds,
    loadTicketAssignmentMap,
    inferTicketSourceMeta,
    buildTicketTimingMeta,
    buildRefundMeta,
    buildPriorityMeta
} = ticketListHandler;

function normalizeWholeNumber(value, fallback = 0, min = 0, max = Number.POSITIVE_INFINITY) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
}

function normalizeScheduleMode(value, fallback = 'rolling_window') {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (normalized === 'hourly' || normalized === 'daily' || normalized === 'rolling_window') {
        return normalized;
    }
    return fallback;
}

function averageNumbers(values = []) {
    const numbers = (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0);

    if (!numbers.length) {
        return null;
    }

    return Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}

function buildBreakdownItems(entries = []) {
    const normalizedEntries = Array.isArray(entries) ? entries : [];
    const total = normalizedEntries.reduce((sum, item) => sum + Math.max(0, Number(item?.count || 0)), 0);

    return normalizedEntries
        .map((item) => {
            const count = Math.max(0, Number(item?.count || 0));
            return {
                key: normalizeText(item?.key, 80) || 'other',
                label: normalizeText(item?.label, 80) || '其他',
                count,
                share_percent: total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0
            };
        })
        .sort((left, right) => {
            if (left.count !== right.count) {
                return right.count - left.count;
            }
            return left.label.localeCompare(right.label, 'zh-CN');
        });
}

function getComparableValue(value) {
    const dateValue = Date.parse(normalizeText(value, 120));
    if (Number.isFinite(dateValue)) {
        return dateValue;
    }

    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
        return numericValue;
    }

    return normalizeText(value, 240);
}

async function fetchPagedRows(buildQuery, pageSize = 500, maxPages = 10) {
    const rows = [];
    const normalizedPageSize = Math.max(1, normalizeWholeNumber(pageSize, 500, 1, 5000));
    const normalizedMaxPages = Math.max(1, normalizeWholeNumber(maxPages, 10, 1, 100));

    for (let pageIndex = 0; pageIndex < normalizedMaxPages; pageIndex += 1) {
        const from = pageIndex * normalizedPageSize;
        const to = from + normalizedPageSize - 1;
        const { data, error } = await buildQuery().range(from, to);

        if (error) {
            throw error;
        }

        const batch = Array.isArray(data) ? data : [];
        rows.push(...batch);

        if (batch.length < normalizedPageSize) {
            break;
        }
    }

    return rows;
}

async function fetchPendingTickets(supabase, { pageSize, maxPages }) {
    return fetchPagedRows(() => supabase
        .from('shop_tickets')
        .select('id, user_id, order_id, issue_type, status, description, admin_notes, created_at, updated_at')
        .in('status', ['PENDING', 'OPEN'])
        .order('created_at', { ascending: false }), pageSize, maxPages);
}

async function fetchRecentClosedTickets(supabase, sinceIso = '', { pageSize, maxPages }) {
    return fetchPagedRows(() => supabase
        .from('shop_tickets')
        .select('id, user_id, order_id, issue_type, status, description, admin_notes, created_at, updated_at')
        .in('status', ['RESOLVED', 'REJECTED'])
        .gte('updated_at', sinceIso)
        .order('updated_at', { ascending: false }), pageSize, maxPages);
}

async function fetchRecentAuditRows(supabase, sinceIso = '', { pageSize, maxPages }) {
    async function queryTable(tableName = 'admin_audit_logs_view', selection = 'id, action_type, details, created_at, admin_id, admin_email') {
        return fetchPagedRows(() => supabase
            .from(tableName)
            .select(selection)
            .in('action_type', TICKET_METRICS_ACTION_TYPES)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false }), pageSize, maxPages);
    }

    try {
        return await queryTable('admin_audit_logs_view', 'id, action_type, details, created_at, admin_id, admin_email');
    } catch (error) {
        if (!isMissingRelationError(error, 'admin_audit_logs_view')) {
            throw error;
        }

        try {
            return await queryTable('admin_audit_logs', 'id, action_type, details, created_at, admin_id');
        } catch (fallbackError) {
            if (isMissingRelationError(fallbackError, 'admin_audit_logs')) {
                return [];
            }
            throw fallbackError;
        }
    }
}

async function fetchRecentSummaryAuditRows(supabase, sinceIso = '', { pageSize, maxPages }) {
    async function queryTable(tableName = 'admin_audit_logs_view', selection = 'id, action_type, details, created_at, admin_id, admin_email') {
        return fetchPagedRows(() => supabase
            .from(tableName)
            .select(selection)
            .in('action_type', TICKET_REMINDER_SUMMARY_AUDIT_ACTION_TYPES)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false }), pageSize, maxPages);
    }

    try {
        return await queryTable('admin_audit_logs_view', 'id, action_type, details, created_at, admin_id, admin_email');
    } catch (error) {
        if (!isMissingRelationError(error, 'admin_audit_logs_view')) {
            throw error;
        }

        try {
            return await queryTable('admin_audit_logs', 'id, action_type, details, created_at, admin_id');
        } catch (fallbackError) {
            if (isMissingRelationError(fallbackError, 'admin_audit_logs')) {
                return [];
            }
            throw fallbackError;
        }
    }
}

async function fetchRecentReminderJobs(supabase, sinceIso = '', { pageSize, maxPages }, alertTypes = TICKET_REMINDER_ACTIVITY_ALERT_TYPES) {
    const normalizedAlertTypes = Array.from(new Set(
        (Array.isArray(alertTypes) ? alertTypes : [])
            .map((alertType) => normalizeText(alertType, 80))
            .filter(Boolean)
    ));
    if (!normalizedAlertTypes.length) {
        return [];
    }

    try {
        return await fetchPagedRows(() => supabase
            .from('ops_alert_jobs')
            .select('id, alert_type, severity, title, payload, channels, remaining_channels, status, attempt_count, max_attempts, next_retry_at, last_error, created_at, updated_at, delivered_at')
            .in('alert_type', normalizedAlertTypes)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false }), pageSize, maxPages);
    } catch (error) {
        if (isMissingRelationError(error, 'ops_alert_jobs')) {
            return [];
        }
        throw error;
    }
}

async function fetchRecentReminderAttempts(supabase, sinceIso = '', jobIds = [], { pageSize, maxPages }) {
    const normalizedJobIds = Array.from(new Set((jobIds || []).map((jobId) => normalizeText(jobId, 120)).filter(Boolean)));
    if (!normalizedJobIds.length) {
        return [];
    }

    try {
        return await fetchPagedRows(() => supabase
            .from('ops_alert_job_attempts')
            .select('job_id, channel, status, response_status, error_message, created_at')
            .in('job_id', normalizedJobIds)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false }), pageSize, maxPages);
    } catch (error) {
        if (isMissingRelationError(error, 'ops_alert_job_attempts')) {
            return [];
        }
        throw error;
    }
}

function normalizeChannelList(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => normalizeText(item, 80).toLowerCase())
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        const normalized = normalizeText(value, 400);
        if (!normalized) {
            return [];
        }

        try {
            const parsed = JSON.parse(normalized);
            if (Array.isArray(parsed)) {
                return parsed
                    .map((item) => normalizeText(item, 80).toLowerCase())
                    .filter(Boolean);
            }
        } catch (_) {
            // Fall back to comma-split below.
        }

        return normalized
            .split(',')
            .map((item) => normalizeText(item, 80).toLowerCase())
            .filter(Boolean);
    }

    return [];
}

function compareCreatedAtDescending(left = {}, right = {}) {
    return (Date.parse(normalizeText(right?.created_at, 120)) || 0) - (Date.parse(normalizeText(left?.created_at, 120)) || 0);
}

function buildAttemptsByJobId(reminderAttempts = []) {
    const attemptsByJobId = new Map();

    (Array.isArray(reminderAttempts) ? reminderAttempts : []).forEach((attempt) => {
        const jobId = normalizeText(attempt?.job_id, 120);
        if (!jobId) {
            return;
        }

        if (!attemptsByJobId.has(jobId)) {
            attemptsByJobId.set(jobId, []);
        }
        attemptsByJobId.get(jobId).push(attempt);
    });

    attemptsByJobId.forEach((items, jobId) => {
        attemptsByJobId.set(jobId, items.slice().sort(compareCreatedAtDescending));
    });

    return attemptsByJobId;
}

function buildReminderActivityEntry(job = null, attemptsByJobId = new Map()) {
    if (!job || typeof job !== 'object') {
        return null;
    }

    const payload = job?.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
        ? job.payload
        : {};
    const latestAttempt = Array.isArray(attemptsByJobId.get(normalizeText(job.id, 120)))
        ? attemptsByJobId.get(normalizeText(job.id, 120))[0]
        : null;
    const normalizedAlertType = normalizeText(job.alert_type, 80).toLowerCase();
    const kind = normalizedAlertType === 'ticket_sla_recovered' ? 'recovered' : 'overdue';

    return {
        kind,
        status: normalizeText(job.status, 40).toLowerCase() || 'unknown',
        severity: normalizeText(job.severity, 40).toLowerCase() || 'warning',
        title: normalizeText(job.title, 200) || (kind === 'recovered' ? '工单超时已恢复' : '工单超时提醒'),
        ticket_id: normalizeText(payload.ticket_id || payload.target_id, 120) || null,
        target_id: normalizeText(payload.target_id || payload.ticket_id, 120) || null,
        wait_label: normalizeText(payload.wait_label || payload.previous_wait_label, 120) || null,
        created_at: normalizeText(job.created_at, 80) || '',
        delivered_at: normalizeText(job.delivered_at, 80) || '',
        attempt_count: normalizeWholeNumber(job.attempt_count, 0, 0, 1000),
        channels: normalizeChannelList(job.channels),
        remaining_channels: normalizeChannelList(job.remaining_channels),
        last_error: normalizeText(latestAttempt?.error_message || job.last_error, 400) || '',
        latest_attempt: latestAttempt
            ? {
                channel: normalizeText(latestAttempt.channel, 80).toLowerCase() || '',
                status: normalizeText(latestAttempt.status, 40).toLowerCase() || '',
                response_status: Number.isFinite(Number(latestAttempt.response_status)) ? Number(latestAttempt.response_status) : null,
                error_message: normalizeText(latestAttempt.error_message, 240) || '',
                created_at: normalizeText(latestAttempt.created_at, 80) || ''
            }
            : null
    };
}

function buildReminderActivityOverview(reminderJobs = [], reminderAttempts = []) {
    const jobs = (Array.isArray(reminderJobs) ? reminderJobs : []).slice().sort(compareCreatedAtDescending);
    const attemptsByJobId = buildAttemptsByJobId(reminderAttempts);

    const overdueJobs = jobs.filter((job) => normalizeText(job?.alert_type, 80).toLowerCase() === 'ticket_sla_overdue');
    const recoveredJobs = jobs.filter((job) => normalizeText(job?.alert_type, 80).toLowerCase() === 'ticket_sla_recovered');
    let deliveredCount = 0;
    let activeCount = 0;
    let retryCount = 0;
    let deadLetterCount = 0;

    jobs.forEach((job) => {
        const status = normalizeText(job?.status, 40).toLowerCase();
        if (status === 'delivered') {
            deliveredCount += 1;
        } else if (status === 'dead_letter') {
            deadLetterCount += 1;
        } else if (status === 'retry') {
            retryCount += 1;
            activeCount += 1;
        } else if (status === 'pending' || status === 'processing') {
            activeCount += 1;
        }
    });

    return {
        lookback_days: REMINDER_ACTIVITY_LOOKBACK_DAYS,
        total_job_count: jobs.length,
        overdue_job_count: overdueJobs.length,
        recovered_job_count: recoveredJobs.length,
        delivered_count: deliveredCount,
        active_count: activeCount,
        retry_count: retryCount,
        dead_letter_count: deadLetterCount,
        latest_job: buildReminderActivityEntry(jobs[0] || null, attemptsByJobId),
        latest_overdue: buildReminderActivityEntry(overdueJobs[0] || null, attemptsByJobId),
        latest_recovered: buildReminderActivityEntry(recoveredJobs[0] || null, attemptsByJobId)
    };
}

function buildReminderSummaryPreviewItem(item = {}) {
    const payload = item?.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
        ? item.payload
        : {};
    const ticketStatus = normalizeTicketStatus(payload.ticket_status);
    const ticketId = normalizeText(payload.ticket_id || payload.target_id, 120);
    if (!ticketId) {
        return null;
    }

    return {
        ticket_id: ticketId,
        order_id: normalizeText(payload.order_id, 120) || '',
        user_id: normalizeText(payload.user_id, 120) || '',
        user_email: normalizeText(payload.user_email, 255) || '',
        wait_label: normalizeText(payload.wait_label, 120) || '',
        responsible_label: normalizeText(payload.responsible_label, 120) || '',
        ticket_status: ticketStatus,
        ticket_status_label: ticketStatus ? (ticketStatus === 'PENDING' ? '待处理' : ticketStatus === 'RESOLVED' ? '已解决' : ticketStatus === 'REJECTED' ? '已拒绝' : ticketStatus) : '',
        reason: normalizeText(payload.reason, 240) || '',
        updated_at: normalizeText(payload.updated_at || payload.created_at || item?.created_at, 80) || ''
    };
}

function resolveSummaryManualAction(details = {}) {
    const normalizedAction = normalizeText(details.action, 80).toLowerCase();
    if (normalizedAction === 'request_retry' || normalizedAction === 'add_note') {
        return normalizedAction;
    }
    if (normalizeText(details.note || details.internal_note, 2000)) {
        return 'add_note';
    }
    if (normalizeText(details.manual_retry_mode, 80) || normalizeText(details.queue_next_status, 80).toLowerCase() === 'retry') {
        return 'request_retry';
    }
    return '';
}

function buildSummaryManualEvent(row = {}) {
    const details = row?.details && typeof row.details === 'object' && !Array.isArray(row.details)
        ? row.details
        : {};
    const action = resolveSummaryManualAction(details);
    const actor = normalizeText(row?.admin_email, 255) || normalizeText(row?.admin_id, 120) || '';
    let title = '人工更新汇总任务';

    if (action === 'add_note') {
        title = '记录人工备注';
    } else if (action === 'request_retry') {
        title = normalizeText(details.manual_retry_mode, 40).toLowerCase() === 'requeue'
            ? '人工重新加入重试队列'
            : '人工立即重试汇总';
    }

    return {
        action: action || 'update',
        title,
        actor,
        created_at: normalizeText(row?.created_at, 80) || '',
        note_excerpt: normalizeText(details.note || details.internal_note, 240) || ''
    };
}

function buildSummaryAuditMetaByJobId(auditRows = []) {
    const metaByJobId = new Map();

    (Array.isArray(auditRows) ? auditRows : []).forEach((row) => {
        const details = row?.details && typeof row.details === 'object' && !Array.isArray(row.details)
            ? row.details
            : {};
        const jobId = normalizeText(details.job_id, 120);
        if (!jobId) {
            return;
        }

        const event = buildSummaryManualEvent(row);
        const existingMeta = metaByJobId.get(jobId) || {
            manual_event_count: 0,
            latest_manual_event: null
        };
        existingMeta.manual_event_count += 1;

        const existingTimeMs = Date.parse(normalizeText(existingMeta.latest_manual_event?.created_at, 80));
        const eventTimeMs = Date.parse(normalizeText(event?.created_at, 80));
        if (!existingMeta.latest_manual_event || (Number.isFinite(eventTimeMs) && (!Number.isFinite(existingTimeMs) || eventTimeMs > existingTimeMs))) {
            existingMeta.latest_manual_event = event;
        }

        metaByJobId.set(jobId, existingMeta);
    });

    return metaByJobId;
}

function buildReminderSummaryDigestEntry(job = null, attemptsByJobId = new Map(), summaryAuditMetaByJobId = new Map()) {
    if (!job || typeof job !== 'object') {
        return null;
    }

    const payload = job?.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
        ? job.payload
        : {};
    const latestAttempt = Array.isArray(attemptsByJobId.get(normalizeText(job.id, 120)))
        ? attemptsByJobId.get(normalizeText(job.id, 120))[0]
        : null;
    const previewItems = (Array.isArray(payload.items) ? payload.items : [])
        .map((item) => buildReminderSummaryPreviewItem(item))
        .filter(Boolean)
        .slice(0, Math.max(1, normalizeWholeNumber(payload.summary_max_items, 10, 1, 50)));
    const summaryAuditMeta = summaryAuditMetaByJobId instanceof Map
        ? (summaryAuditMetaByJobId.get(normalizeText(job.id, 120)) || null)
        : null;

    return {
        id: normalizeText(job.id, 120) || '',
        status: normalizeText(job.status, 40).toLowerCase() || 'unknown',
        severity: normalizeText(job.severity, 40).toLowerCase() || 'warning',
        title: normalizeText(job.title, 200) || '工单超时汇总',
        created_at: normalizeText(job.created_at, 80) || '',
        updated_at: normalizeText(job.updated_at, 80) || '',
        delivered_at: normalizeText(job.delivered_at, 80) || '',
        attempt_count: normalizeWholeNumber(job.attempt_count, 0, 0, 1000),
        max_attempts: normalizeWholeNumber(job.max_attempts, 0, 0, 1000),
        next_retry_at: normalizeText(job.next_retry_at, 80) || '',
        channels: normalizeChannelList(job.channels),
        remaining_channels: normalizeChannelList(job.remaining_channels),
        last_error: normalizeText(latestAttempt?.error_message || job.last_error, 400) || '',
        latest_attempt: latestAttempt
            ? {
                channel: normalizeText(latestAttempt.channel, 80).toLowerCase() || '',
                status: normalizeText(latestAttempt.status, 40).toLowerCase() || '',
                response_status: Number.isFinite(Number(latestAttempt.response_status)) ? Number(latestAttempt.response_status) : null,
                error_message: normalizeText(latestAttempt.error_message, 240) || '',
                created_at: normalizeText(latestAttempt.created_at, 80) || ''
            }
            : null,
        summary_schedule_mode: normalizeScheduleMode(payload.summary_schedule_mode, 'rolling_window'),
        summary_window_minutes: normalizeWholeNumber(payload.summary_window_minutes, 60, 5, 24 * 60),
        summary_max_items: normalizeWholeNumber(payload.summary_max_items, 10, 1, 50),
        summary_hourly_minute: normalizeWholeNumber(payload.summary_hourly_minute, 0, 0, 59),
        summary_daily_hour: normalizeWholeNumber(payload.summary_daily_hour, 9, 0, 23),
        summary_daily_minute: normalizeWholeNumber(payload.summary_daily_minute, 0, 0, 59),
        summary_timezone: normalizeText(payload.summary_timezone, 80) || '',
        window_start_at: normalizeText(payload.window_start_at, 80) || '',
        window_end_at: normalizeText(payload.window_end_at, 80) || '',
        item_count: normalizeWholeNumber(payload.item_count, previewItems.length, 0, 5000),
        entry_path: normalizeText(payload.entry_path, 160) || '',
        manual_event_count: normalizeWholeNumber(summaryAuditMeta?.manual_event_count, 0, 0, 1000),
        latest_manual_event: summaryAuditMeta?.latest_manual_event
            ? {
                action: normalizeText(summaryAuditMeta.latest_manual_event.action, 80).toLowerCase() || '',
                title: normalizeText(summaryAuditMeta.latest_manual_event.title, 200) || '',
                actor: normalizeText(summaryAuditMeta.latest_manual_event.actor, 255) || '',
                created_at: normalizeText(summaryAuditMeta.latest_manual_event.created_at, 80) || '',
                note_excerpt: normalizeText(summaryAuditMeta.latest_manual_event.note_excerpt, 240) || ''
            }
            : null,
        preview_items: previewItems
    };
}

function buildReminderSummaryDigest(summaryJobs = [], reminderAttempts = [], summaryAuditRows = []) {
    const jobs = (Array.isArray(summaryJobs) ? summaryJobs : []).slice().sort(compareCreatedAtDescending);
    const attemptsByJobId = buildAttemptsByJobId(reminderAttempts);
    const summaryAuditMetaByJobId = buildSummaryAuditMetaByJobId(summaryAuditRows);
    const dailyJobs = jobs.filter((job) => {
        const payload = job?.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
            ? job.payload
            : {};
        return normalizeScheduleMode(payload.summary_schedule_mode, 'rolling_window') === 'daily';
    });
    const failedJobs = jobs.filter((job) => {
        const status = normalizeText(job?.status, 40).toLowerCase();
        return status === 'retry' || status === 'dead_letter';
    });
    let deliveredCount = 0;
    let activeCount = 0;
    let retryCount = 0;
    let deadLetterCount = 0;

    jobs.forEach((job) => {
        const status = normalizeText(job?.status, 40).toLowerCase();
        if (status === 'delivered') {
            deliveredCount += 1;
        } else if (status === 'dead_letter') {
            deadLetterCount += 1;
        } else if (status === 'retry') {
            retryCount += 1;
            activeCount += 1;
        } else if (status === 'pending' || status === 'processing') {
            activeCount += 1;
        }
    });

    return {
        lookback_days: REMINDER_ACTIVITY_LOOKBACK_DAYS,
        total_job_count: jobs.length,
        daily_job_count: dailyJobs.length,
        delivered_count: deliveredCount,
        active_count: activeCount,
        retry_count: retryCount,
        dead_letter_count: deadLetterCount,
        failure_job_count: failedJobs.length,
        latest_job: buildReminderSummaryDigestEntry(jobs[0] || null, attemptsByJobId, summaryAuditMetaByJobId),
        latest_daily_job: buildReminderSummaryDigestEntry(dailyJobs[0] || null, attemptsByJobId, summaryAuditMetaByJobId),
        latest_problem_job: buildReminderSummaryDigestEntry(failedJobs[0] || null, attemptsByJobId, summaryAuditMetaByJobId),
        recent_jobs: jobs
            .slice(0, TICKET_REMINDER_SUMMARY_HISTORY_LIMIT)
            .map((job) => buildReminderSummaryDigestEntry(job, attemptsByJobId, summaryAuditMetaByJobId))
            .filter(Boolean)
    };
}

function buildPendingOverview(pendingRows = [], context = {}) {
    const profilesById = context.profilesById instanceof Map ? context.profilesById : new Map();
    const ordersById = context.ordersById instanceof Map ? context.ordersById : new Map();
    const assignmentByTicketId = context.assignmentByTicketId instanceof Map ? context.assignmentByTicketId : new Map();
    const pendingOverdueMinutes = normalizeWholeNumber(
        context.pendingOverdueMinutes,
        DEFAULT_TICKET_SLA_MONITOR_CONFIG.pending_overdue_minutes,
        5
    );
    const criticalOverdueMinutes = normalizeWholeNumber(
        context.criticalOverdueMinutes,
        DEFAULT_TICKET_SLA_MONITOR_CONFIG.critical_overdue_minutes,
        30
    );
    const nowDate = context.nowDate instanceof Date ? context.nowDate : new Date();

    const sourceCounts = new Map();
    const issueTypeCounts = new Map();
    let assignedCount = 0;
    let unassignedCount = 0;
    let overdueCount = 0;
    let criticalOverdueCount = 0;
    let highPriorityCount = 0;
    let refundableCount = 0;
    let oldestWaitMinutes = 0;

    (Array.isArray(pendingRows) ? pendingRows : []).forEach((ticket) => {
        const ticketId = normalizeText(ticket?.id, 120);
        const orderId = normalizeText(ticket?.order_id, 120);
        const userId = normalizeText(ticket?.user_id, 120);
        const order = ordersById.get(orderId) || null;
        const sourceMeta = inferTicketSourceMeta(ticket);
        const timingMeta = buildTicketTimingMeta(ticket, pendingOverdueMinutes, nowDate);
        const refundMeta = buildRefundMeta(ticket, order);
        const priorityMeta = buildPriorityMeta(ticket, sourceMeta, timingMeta, refundMeta);
        const assignmentMeta = assignmentByTicketId.get(ticketId) || {
            assigned_to_id: '',
            assigned_to_label: ''
        };
        const assigned = Boolean(
            normalizeText(assignmentMeta.assigned_to_id, 120)
            || normalizeText(assignmentMeta.assigned_to_label, 255)
        );
        const sourceKey = normalizeText(sourceMeta.source_type || sourceMeta.sourceType, 80) || 'user_ticket';
        const sourceLabel = normalizeText(sourceMeta.source_label || sourceMeta.sourceLabel, 80) || '用户提交';
        const issueTypeKey = normalizeText(ticket?.issue_type, 80).toUpperCase() || 'OTHER';
        const issueTypeLabel = getIssueTypeLabel(issueTypeKey);
        const isCriticalOverdue = normalizeTicketStatus(ticket?.status) === 'PENDING'
            && Number(timingMeta.ticket_age_minutes || 0) >= criticalOverdueMinutes;

        sourceCounts.set(sourceKey, {
            key: sourceKey,
            label: sourceLabel,
            count: Number(sourceCounts.get(sourceKey)?.count || 0) + 1
        });
        issueTypeCounts.set(issueTypeKey, {
            key: issueTypeKey,
            label: issueTypeLabel,
            count: Number(issueTypeCounts.get(issueTypeKey)?.count || 0) + 1
        });

        if (assigned) {
            assignedCount += 1;
        } else {
            unassignedCount += 1;
        }
        if (timingMeta.is_overdue === true) {
            overdueCount += 1;
        }
        if (isCriticalOverdue) {
            criticalOverdueCount += 1;
        }
        if (priorityMeta.is_high_priority === true) {
            highPriorityCount += 1;
        }
        if (refundMeta.can_refund === true) {
            refundableCount += 1;
        }
        oldestWaitMinutes = Math.max(oldestWaitMinutes, Math.max(0, Number(timingMeta.ticket_age_minutes || 0)));

        if (!profilesById.has(userId)) {
            profilesById.set(userId, {
                id: userId,
                email: normalizeText(ticket?.user_email, 255)
            });
        }
    });

    return {
        backlog: {
            total_pending: Array.isArray(pendingRows) ? pendingRows.length : 0,
            assigned_count: assignedCount,
            unassigned_count: unassignedCount,
            overdue_count: overdueCount,
            critical_overdue_count: criticalOverdueCount,
            high_priority_count: highPriorityCount,
            refundable_count: refundableCount,
            oldest_wait_minutes: oldestWaitMinutes
        },
        sources: buildBreakdownItems(Array.from(sourceCounts.values())),
        issue_types: buildBreakdownItems(Array.from(issueTypeCounts.values()))
    };
}

function buildEfficiencyOverview(closedRows = [], auditRows = []) {
    const closedTickets = Array.isArray(closedRows) ? closedRows : [];
    const ticketIds = new Set(closedTickets.map((ticket) => normalizeText(ticket?.id, 120)).filter(Boolean));
    const firstTouchByTicketId = new Map();
    const firstProcessByTicketId = new Map();
    const refundRelatedByTicketId = new Set();
    const processStatusByTicketId = new Map();

    (Array.isArray(auditRows) ? auditRows : []).forEach((row) => {
        const details = row?.details && typeof row.details === 'object' && !Array.isArray(row.details) ? row.details : {};
        const ticketId = normalizeText(details.ticket_id, 120);
        if (!ticketId || !ticketIds.has(ticketId)) {
            return;
        }

        const actionType = normalizeText(row?.action_type, 120).toLowerCase();
        const createdAt = normalizeText(row?.created_at, 80);
        const createdAtMs = Date.parse(createdAt);
        if (Number.isFinite(createdAtMs)) {
            const existingFirstTouch = firstTouchByTicketId.get(ticketId);
            if (!existingFirstTouch || createdAtMs < existingFirstTouch.timeMs) {
                firstTouchByTicketId.set(ticketId, {
                    time: createdAt,
                    timeMs: createdAtMs,
                    actionType
                });
            }
        }

        if (actionType !== 'ticket.process') {
            return;
        }

        const existingProcess = firstProcessByTicketId.get(ticketId);
        if (Number.isFinite(createdAtMs) && (!existingProcess || createdAtMs < existingProcess.timeMs)) {
            firstProcessByTicketId.set(ticketId, {
                time: createdAt,
                timeMs: createdAtMs
            });
        }

        processStatusByTicketId.set(ticketId, normalizeTicketStatus(details.new_status));

        const refundOutcome = normalizeText(details.refund_outcome, 80).toLowerCase();
        if (
            details.refunded === true
            || details.refund_duplicate === true
            || (refundOutcome && refundOutcome !== 'not_requested')
        ) {
            refundRelatedByTicketId.add(ticketId);
        }
    });

    let resolvedCount = 0;
    let rejectedCount = 0;
    let refundRelatedCount = 0;
    const resolutionMinutes = [];
    const firstTouchMinutes = [];

    closedTickets.forEach((ticket) => {
        const ticketId = normalizeText(ticket?.id, 120);
        const createdAtMs = Date.parse(normalizeText(ticket?.created_at, 80));
        const normalizedStatus = processStatusByTicketId.get(ticketId) || normalizeTicketStatus(ticket?.status);

        if (normalizedStatus === 'RESOLVED') {
            resolvedCount += 1;
        } else if (normalizedStatus === 'REJECTED') {
            rejectedCount += 1;
        }
        if (refundRelatedByTicketId.has(ticketId)) {
            refundRelatedCount += 1;
        }

        const resolutionTime = firstProcessByTicketId.get(ticketId)?.time || normalizeText(ticket?.updated_at, 80);
        const resolutionTimeMs = Date.parse(resolutionTime);
        if (Number.isFinite(createdAtMs) && Number.isFinite(resolutionTimeMs) && resolutionTimeMs >= createdAtMs) {
            resolutionMinutes.push(Math.round((resolutionTimeMs - createdAtMs) / 60000));
        }

        const firstTouchTimeMs = firstTouchByTicketId.get(ticketId)?.timeMs;
        if (Number.isFinite(createdAtMs) && Number.isFinite(firstTouchTimeMs) && firstTouchTimeMs >= createdAtMs) {
            firstTouchMinutes.push(Math.round((firstTouchTimeMs - createdAtMs) / 60000));
        }
    });

    const closedCount = closedTickets.length;
    return {
        lookback_days: CLOSED_LOOKBACK_DAYS,
        closed_count: closedCount,
        resolved_count: resolvedCount,
        rejected_count: rejectedCount,
        refund_related_count: refundRelatedCount,
        resolved_rate_percent: closedCount > 0 ? Number(((resolvedCount / closedCount) * 100).toFixed(1)) : 0,
        rejected_rate_percent: closedCount > 0 ? Number(((rejectedCount / closedCount) * 100).toFixed(1)) : 0,
        refund_related_rate_percent: closedCount > 0 ? Number(((refundRelatedCount / closedCount) * 100).toFixed(1)) : 0,
        avg_first_touch_minutes: averageNumbers(firstTouchMinutes),
        first_touch_sample_count: firstTouchMinutes.length,
        avg_resolution_minutes: averageNumbers(resolutionMinutes),
        resolution_sample_count: resolutionMinutes.length
    };
}

function buildReminderOverview(runtime = null, ticketsConfig = {}) {
    const runtimeConfig = runtime?.config && typeof runtime.config === 'object' ? runtime.config : {};
    const normalizedTicketsConfig = ticketsConfig && typeof ticketsConfig === 'object' ? ticketsConfig : {};

    return {
        ops_alerts_enabled: runtimeConfig.enabled !== false,
        monitor_enabled: normalizedTicketsConfig.enabled !== false,
        enabled: runtimeConfig.enabled !== false && normalizedTicketsConfig.enabled !== false,
        work_hours_only_enabled: normalizedTicketsConfig.work_hours_only_enabled === true,
        summary_enabled: normalizedTicketsConfig.summary_enabled === true,
        sweep_interval_minutes: Math.max(
            1,
            Math.round(Number(normalizedTicketsConfig.sweep_interval_ms || DEFAULT_TICKET_SLA_MONITOR_CONFIG.sweep_interval_ms) / 60000)
        ),
        pending_overdue_minutes: normalizeWholeNumber(
            normalizedTicketsConfig.pending_overdue_minutes,
            DEFAULT_TICKET_SLA_MONITOR_CONFIG.pending_overdue_minutes,
            5
        ),
        critical_overdue_minutes: normalizeWholeNumber(
            normalizedTicketsConfig.critical_overdue_minutes,
            DEFAULT_TICKET_SLA_MONITOR_CONFIG.critical_overdue_minutes,
            30
        ),
        summary_window_minutes: normalizeWholeNumber(
            normalizedTicketsConfig.summary_window_minutes,
            60,
            5,
            1440
        ),
        summary_schedule_mode: normalizeScheduleMode(normalizedTicketsConfig.summary_schedule_mode, 'rolling_window'),
        summary_hourly_minute: normalizeWholeNumber(normalizedTicketsConfig.summary_hourly_minute, 0, 0, 59),
        summary_daily_hour: normalizeWholeNumber(normalizedTicketsConfig.summary_daily_hour, 9, 0, 23),
        summary_daily_minute: normalizeWholeNumber(normalizedTicketsConfig.summary_daily_minute, 0, 0, 59),
        activity: buildReminderActivityOverview(),
        summary_digest: buildReminderSummaryDigest()
    };
}

async function loadTicketMetricsOverview({ supabase, nowDate = new Date(), runtime = null } = {}) {
    const effectiveRuntime = runtime || await loadOpsAlertsRuntimeConfig(supabase).catch(() => null);
    const runtimeTicketsConfig = effectiveRuntime?.config?.tickets && typeof effectiveRuntime.config.tickets === 'object'
        ? effectiveRuntime.config.tickets
        : {};
    const pageSize = normalizeWholeNumber(
        runtimeTicketsConfig.page_size,
        DEFAULT_TICKET_SLA_MONITOR_CONFIG.page_size,
        50,
        5000
    );
    const maxPages = normalizeWholeNumber(
        runtimeTicketsConfig.max_pages,
        DEFAULT_TICKET_SLA_MONITOR_CONFIG.max_pages,
        1,
        100
    );
    const pendingOverdueMinutes = normalizeWholeNumber(
        runtimeTicketsConfig.pending_overdue_minutes,
        DEFAULT_TICKET_SLA_MONITOR_CONFIG.pending_overdue_minutes,
        5
    );
    const closedSinceIso = new Date(nowDate.getTime() - CLOSED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const auditSinceIso = new Date(nowDate.getTime() - TOUCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const reminderSinceIso = new Date(nowDate.getTime() - REMINDER_ACTIVITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const [pendingRows, closedRows, auditRows, reminderJobs, reminderSummaryJobs, summaryAuditRows] = await Promise.all([
        fetchPendingTickets(supabase, { pageSize, maxPages }),
        fetchRecentClosedTickets(supabase, closedSinceIso, { pageSize, maxPages }),
        fetchRecentAuditRows(supabase, auditSinceIso, { pageSize, maxPages }),
        fetchRecentReminderJobs(supabase, reminderSinceIso, { pageSize, maxPages }, TICKET_REMINDER_ACTIVITY_ALERT_TYPES),
        fetchRecentReminderJobs(supabase, reminderSinceIso, { pageSize, maxPages }, TICKET_REMINDER_SUMMARY_ALERT_TYPES),
        fetchRecentSummaryAuditRows(supabase, reminderSinceIso, { pageSize, maxPages })
    ]);
    const reminderAttempts = await fetchRecentReminderAttempts(
        supabase,
        reminderSinceIso,
        [
            ...reminderJobs.map((job) => job?.id),
            ...reminderSummaryJobs.map((job) => job?.id)
        ],
        { pageSize, maxPages }
    );

    const [profilesById, ordersById, assignmentByTicketId] = await Promise.all([
        loadProfilesByIds(supabase, pendingRows.map((ticket) => ticket?.user_id)),
        loadOrdersByIds(supabase, pendingRows.map((ticket) => ticket?.order_id)),
        loadTicketAssignmentMap(supabase, pendingRows.map((ticket) => ticket?.id)).catch(() => new Map())
    ]);

    const pendingOverview = buildPendingOverview(pendingRows, {
        profilesById,
        ordersById,
        assignmentByTicketId,
        pendingOverdueMinutes,
        criticalOverdueMinutes: runtimeTicketsConfig.critical_overdue_minutes,
        nowDate
    });

    return {
        generated_at: nowDate.toISOString(),
        backlog: pendingOverview.backlog,
        efficiency: buildEfficiencyOverview(closedRows, auditRows),
        sources: pendingOverview.sources,
        issue_types: pendingOverview.issue_types,
        reminder: {
            ...buildReminderOverview(effectiveRuntime, runtimeTicketsConfig),
            activity: buildReminderActivityOverview(reminderJobs, reminderAttempts),
            summary_digest: buildReminderSummaryDigest(reminderSummaryJobs, reminderAttempts, summaryAuditRows)
        }
    };
}

async function adminTicketsMetricsHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'tickets.manage' });
        const nowDate = req?.now instanceof Date ? req.now : new Date();
        const overview = await loadTicketMetricsOverview({
            supabase,
            nowDate
        });

        return sendJson(res, 200, {
            success: true,
            overview
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load ticket metrics'
        });
    }
}

module.exports = adminTicketsMetricsHandler;
module.exports.loadTicketMetricsOverview = loadTicketMetricsOverview;
module.exports.__testUtils = {
    averageNumbers,
    buildBreakdownItems,
    buildEfficiencyOverview,
    buildPendingOverview,
    buildReminderActivityEntry,
    buildReminderActivityOverview,
    buildReminderSummaryDigest,
    buildReminderSummaryDigestEntry,
    buildSummaryAuditMetaByJobId,
    buildReminderOverview,
    fetchPagedRows,
    getComparableValue
};
