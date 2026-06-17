const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    isMissingTableAccessError
} = require('./_ops-alert-case-events');
const {
    normalizeText,
    normalizePayload,
    buildOpsAlertCaseKey,
    fetchOpsAlertCasesByTargets,
    fetchOpsAlertCaseEventsByTargets,
    buildOpsAlertItemCaseState
} = require('./_ops-alert-case-state');

const ACTIVE_VERIFY_STATUSES = new Set(['queued', 'running', 'processing', 'pending', 'assigned']);
const SUCCESS_VERIFY_STATUSES = new Set(['success']);
const VERIFY_MONITOR_RAW_SCAN_PAGE_SIZE = 200;
const VERIFY_MONITOR_RAW_SCAN_MAX_PAGES = 5;
const VERIFY_MONITOR_DEFAULT_TASK_PAGE_SIZE = 8;
const VERIFY_MONITOR_DEFAULT_FAILURE_PAGE_SIZE = 6;
const VERIFY_MONITOR_MAX_PAGE_SIZE = 40;
const VERIFY_MONITOR_ALERT_LOOKBACK_DAYS = 7;
const VERIFY_MONITOR_ALERT_LIMIT = 80;
const VERIFY_MONITOR_WORKSPACE_LIMIT = 8;
const VERIFY_MONITOR_STALLED_TASK_THRESHOLD_MINUTES = 15;
const VERIFY_MONITOR_FACT_BUCKET_LIMIT = 4;
const VERIFY_MONITOR_ALERT_TYPES = Object.freeze([
    'verify_quota_low',
    'verify_service_disabled',
    'verify_queue_backlog',
    'verify_failure_rate_spike',
    'verify_incident_escalated',
    'verify_incident_recovered'
]);
const VERIFY_MONITOR_PROBLEM_TYPES = new Set([
    'verify_quota_low',
    'verify_service_disabled',
    'verify_queue_backlog',
    'verify_failure_rate_spike',
    'verify_incident_escalated'
]);
const VERIFY_MONITOR_RECOVERY_TYPES = new Set(['verify_incident_recovered']);

function sanitizeText(value, maxLength = 240) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeVerifyMonitorSite(value = '', fallback = 'all') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'intl') return 'intl';
    if (normalized === 'cn') return 'cn';
    if (normalized === 'all') return 'all';
    return fallback === 'intl' || fallback === 'cn' || fallback === 'all' ? fallback : 'all';
}

function normalizePageNumber(value, fallback = 1) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePageSize(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return Math.min(parsed, VERIFY_MONITOR_MAX_PAGE_SIZE);
}

function parseHistoryMessage(message) {
    if (typeof message !== 'string' || !message.trim().startsWith('{')) {
        return null;
    }

    try {
        const parsed = JSON.parse(message);
        if (parsed?.kind === 'google_one_job') {
            return parsed;
        }
    } catch (_) {
        return null;
    }

    return null;
}

function normalizeVerifyStatus(status) {
    return sanitizeText(status, 60).toLowerCase() || 'unknown';
}

function getVerifyAlertTypeState(alertType = '') {
    const normalizedAlertType = sanitizeText(alertType, 120).toLowerCase();
    if (VERIFY_MONITOR_PROBLEM_TYPES.has(normalizedAlertType)) {
        return 'problem';
    }
    if (VERIFY_MONITOR_RECOVERY_TYPES.has(normalizedAlertType)) {
        return 'recovered';
    }
    return 'unknown';
}

function buildMonitorLogKey(row) {
    const site = sanitizeText(row.site, 20) || 'cn';
    const jobId = sanitizeText(row.job_id, 120)
        || sanitizeText(row.verification_id, 120)
        || sanitizeText(row.id, 120)
        || 'unknown';
    return `${site}:${jobId}`;
}

function isGenericVerifyMonitorFailureText(value = '') {
    const normalized = sanitizeText(value, 300).toLowerCase();
    return [
        '任务失败',
        '失败',
        'failed',
        'fail',
        'error',
        'task failed',
        'unknown'
    ].includes(normalized);
}

function pickVerifyMonitorFailureText(candidates = []) {
    let fallback = '';

    for (const candidate of candidates) {
        const value = sanitizeText(candidate, 300);
        if (!value) continue;
        if (!isGenericVerifyMonitorFailureText(value)) {
            return value;
        }
        if (!fallback) {
            fallback = value;
        }
    }

    return fallback;
}

function buildMonitorSummary(row) {
    if (sanitizeText(row.error_message, 300)) {
        return sanitizeText(row.error_message, 300);
    }

    if (sanitizeText(row.stage_label, 120)) {
        return sanitizeText(row.stage_label, 120);
    }

    if (sanitizeText(row.raw_status, 120)) {
        return sanitizeText(row.raw_status, 120);
    }

    return row.status === 'success'
        ? '验证完成'
        : (ACTIVE_VERIFY_STATUSES.has(row.status) ? '等待上游处理' : '等待人工复核');
}

function normalizeMonitorRow(row = {}) {
    const payload = parseHistoryMessage(row.message) || {};
    const status = normalizeVerifyStatus(row.status || payload.status);
    const failureMessage = pickVerifyMonitorFailureText([
        payload.failure_reason,
        row.error_message,
        payload.error_message,
        payload.message,
        payload.reason,
        payload.error,
        payload.error_code
    ]);
    const normalized = {
        id: sanitizeText(row.id, 120),
        verification_id: sanitizeText(payload.job_id, 120) || sanitizeText(row.verification_id, 120),
        user_id: sanitizeText(row.user_id, 120),
        email: sanitizeText(payload.email, 180),
        site: sanitizeText(row.site, 20) || 'cn',
        status,
        created_at: sanitizeText(row.created_at, 80),
        points_deducted: Number.isFinite(Number(row.points_deducted))
            ? Number(row.points_deducted)
            : 0,
        task_type: sanitizeText(payload.task_type, 40),
        stage_label: sanitizeText(payload.stage_label, 120),
        raw_status: sanitizeText(payload.raw_status || payload.status, 120),
        error_code: sanitizeText(payload.error_code, 120),
        error_message: failureMessage,
        url: sanitizeText(payload.url, 400)
    };

    normalized.summary = buildMonitorSummary(normalized);
    return normalized;
}

function dedupeLatestMonitorRows(rows = []) {
    const seen = new Set();
    const deduped = [];

    for (const row of rows) {
        const normalized = normalizeMonitorRow(row);
        const key = buildMonitorLogKey(normalized);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(normalized);
    }

    return deduped;
}

function formatMinutesSince(isoString, nowMs) {
    const createdMs = Date.parse(isoString);
    if (!Number.isFinite(createdMs) || !Number.isFinite(nowMs)) {
        return null;
    }

    return Math.max(0, Math.round((nowMs - createdMs) / 60000));
}

function buildPagedCollection(rows = [], page = 1, pageSize = VERIFY_MONITOR_DEFAULT_TASK_PAGE_SIZE) {
    const totalItems = Array.isArray(rows) ? rows.length : 0;
    const normalizedPageSize = normalizePageSize(pageSize, VERIFY_MONITOR_DEFAULT_TASK_PAGE_SIZE);
    const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
    const currentPage = Math.min(Math.max(normalizePageNumber(page, 1), 1), totalPages);
    const from = (currentPage - 1) * normalizedPageSize;
    const to = from + normalizedPageSize;

    return {
        items: (Array.isArray(rows) ? rows : []).slice(from, to),
        pagination: {
            page: currentPage,
            page_size: normalizedPageSize,
            total_items: totalItems,
            total_pages: totalPages,
            has_prev_page: currentPage > 1,
            has_next_page: currentPage < totalPages,
            returned_items: Math.max(0, Math.min(totalItems, to) - from)
        }
    };
}

function buildVerifyFactBuckets(rows = [], getKey, getLabel = null, limit = VERIFY_MONITOR_FACT_BUCKET_LIMIT) {
    const counts = new Map();

    for (const row of Array.isArray(rows) ? rows : []) {
        const key = sanitizeText(getKey(row), 160);
        if (!key) {
            continue;
        }

        const current = counts.get(key) || {
            key,
            label: sanitizeText(typeof getLabel === 'function' ? getLabel(row, key) : key, 160) || key,
            count: 0
        };
        current.count += 1;
        counts.set(key, current);
    }

    return Array.from(counts.values())
        .sort((left, right) => {
            if (right.count !== left.count) {
                return right.count - left.count;
            }
            return left.label.localeCompare(right.label, 'zh-CN');
        })
        .slice(0, Math.max(1, Number(limit) || VERIFY_MONITOR_FACT_BUCKET_LIMIT));
}

function getVerifyFailureReason(row = {}) {
    return sanitizeText(row.error_code, 120)
        || sanitizeText(row.summary, 120)
        || sanitizeText(row.raw_status, 120)
        || 'unknown';
}

function buildVerifyMonitorFacts(dedupedRows = [], activeRows = [], failureRows = [], nowMs = Date.now()) {
    const stalledTaskCount = activeRows.filter((row) => {
        const minutesSince = formatMinutesSince(row.created_at, nowMs);
        return minutesSince != null && minutesSince >= VERIFY_MONITOR_STALLED_TASK_THRESHOLD_MINUTES;
    }).length;

    return {
        success_task_count: dedupedRows.filter((row) => SUCCESS_VERIFY_STATUSES.has(row.status)).length,
        stalled_task_count: stalledTaskCount,
        stalled_threshold_minutes: VERIFY_MONITOR_STALLED_TASK_THRESHOLD_MINUTES,
        status_breakdown: buildVerifyFactBuckets(
            dedupedRows,
            (row) => row.status,
            (row) => normalizeVerifyStatus(row.status)
        ),
        site_breakdown: buildVerifyFactBuckets(
            dedupedRows,
            (row) => row.site,
            (row) => String(row.site || '').toUpperCase()
        ),
        top_failure_reasons: buildVerifyFactBuckets(
            failureRows,
            (row) => getVerifyFailureReason(row),
            (_row, key) => key
        )
    };
}

async function fetchRecentVerifyLogRows(supabase) {
    const rows = [];

    for (let page = 0; page < VERIFY_MONITOR_RAW_SCAN_MAX_PAGES; page += 1) {
        const from = page * VERIFY_MONITOR_RAW_SCAN_PAGE_SIZE;
        const to = from + VERIFY_MONITOR_RAW_SCAN_PAGE_SIZE - 1;
        const { data, error } = await supabase
            .from('verification_logs')
            .select('id, user_id, verification_id, status, message, points_deducted, site, created_at')
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            throw new Error(error.message || '加载验证运维面板失败');
        }

        const batch = Array.isArray(data) ? data : [];
        rows.push(...batch);
        if (batch.length < VERIFY_MONITOR_RAW_SCAN_PAGE_SIZE) {
            break;
        }
    }

    return rows;
}

function collectVerifyReferenceIds(rows = []) {
    return [...new Set((Array.isArray(rows) ? rows : [])
        .map((row) => sanitizeText(row.verification_id, 120))
        .filter(Boolean))]
        .slice(0, 500);
}

function collectVerifySubmitterUserIds(rows = []) {
    return [...new Set((Array.isArray(rows) ? rows : [])
        .map((row) => sanitizeText(row.user_id, 120))
        .filter(Boolean))]
        .slice(0, 500);
}

function isUuid(value = '') {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function buildVerifySubmitterProfileFromAuthUser(user = {}) {
    const metadata = user?.user_metadata && typeof user.user_metadata === 'object' && !Array.isArray(user.user_metadata)
        ? user.user_metadata
        : {};
    return {
        id: sanitizeText(user.id, 120),
        email: sanitizeText(user.email, 180),
        username: sanitizeText(metadata.username || metadata.name, 120),
        display_name: sanitizeText(metadata.display_name || metadata.full_name || metadata.name, 120)
    };
}

async function fetchVerifyLedgerSubmitterRows(supabase, rows = []) {
    const referenceIds = collectVerifyReferenceIds(rows);
    if (!referenceIds.length) {
        return [];
    }

    try {
        const { data, error } = await supabase
            .from('points_ledger')
            .select('id, user_id, reference_id, created_at')
            .in('reference_id', referenceIds);

        if (error) {
            return [];
        }

        return Array.isArray(data) ? data : [];
    } catch (_error) {
        return [];
    }
}

async function fetchVerifySubmitterProfiles(supabase, rows = []) {
    const userIds = collectVerifySubmitterUserIds(rows);
    const profilesById = new Map();
    if (!userIds.length) {
        return profilesById;
    }

    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, email, username, display_name')
            .in('id', userIds);

        if (!error) {
            (Array.isArray(data) ? data : []).forEach((profile) => {
                const id = sanitizeText(profile.id, 120);
                if (id) {
                    profilesById.set(id, profile);
                }
            });
        }
    } catch (_error) {
        // Auth fallback below can still recover the website email for UUID users.
    }

    const missingEmailIds = userIds
        .filter((id) => isUuid(id))
        .filter((id) => !sanitizeText(profilesById.get(id)?.email, 180));
    if (!missingEmailIds.length || !supabase?.auth?.admin?.getUserById) {
        return profilesById;
    }

    const authProfiles = await Promise.all(missingEmailIds.map(async (id) => {
        try {
            const { data, error } = await supabase.auth.admin.getUserById(id);
            if (error || !data?.user) return null;
            return buildVerifySubmitterProfileFromAuthUser(data.user);
        } catch (_error) {
            return null;
        }
    }));

    authProfiles.forEach((profile) => {
        const id = sanitizeText(profile?.id, 120);
        const email = sanitizeText(profile?.email, 180);
        if (!id || !email) return;
        profilesById.set(id, {
            ...(profilesById.get(id) || {}),
            ...profile
        });
    });

    return profilesById;
}

function enrichVerifyRowsWithLedgerAndProfiles(rows = [], ledgerRows = [], profilesById = new Map()) {
    const ledgerSubmitters = new Map();
    (Array.isArray(ledgerRows) ? ledgerRows : []).forEach((row) => {
        const referenceId = sanitizeText(row.reference_id, 120);
        const userId = sanitizeText(row.user_id, 120);
        if (referenceId && userId && !ledgerSubmitters.has(referenceId)) {
            ledgerSubmitters.set(referenceId, userId);
        }
    });

    return (Array.isArray(rows) ? rows : []).map((row) => {
        const referenceId = sanitizeText(row.verification_id, 120);
        const ledgerUserId = referenceId ? ledgerSubmitters.get(referenceId) : '';
        const userId = sanitizeText(row.user_id, 120) || ledgerUserId || '';
        const profile = profilesById instanceof Map ? profilesById.get(userId) : null;
        return {
            ...row,
            user_id: userId || row.user_id,
            submitter_email: sanitizeText(profile?.email, 180),
            submitter_username: sanitizeText(profile?.username, 120),
            submitter_display_name: sanitizeText(profile?.display_name, 120)
        };
    });
}

async function fetchRecentVerifyAlertJobs(supabase, sinceIso) {
    try {
        const { data, error } = await supabase
            .from('ops_alert_jobs')
            .select('id, alert_type, severity, title, content, payload, created_at')
            .in('alert_type', VERIFY_MONITOR_ALERT_TYPES)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(VERIFY_MONITOR_ALERT_LIMIT);

        if (error) {
            throw error;
        }

        return Array.isArray(data) ? data : [];
    } catch (error) {
        if (isMissingTableAccessError(error, 'ops_alert_jobs')) {
            return [];
        }
        throw error;
    }
}

function getVerifyAlertExcerpt(job = {}) {
    const title = sanitizeText(job.title, 240);
    const lines = sanitizeText(job.content, 1200)
        .split('\n')
        .map((line) => sanitizeText(line, 240))
        .filter(Boolean)
        .filter((line) => line !== title);

    return lines[0] || '';
}

function getVerifyAlertTargetId(job = {}) {
    const payload = normalizePayload(job.payload);
    return normalizeText(payload.target_id, 160)
        || normalizeText(payload.key_name, 160)
        || normalizeText(payload.api_base_url, 240)
        || sanitizeText(job.id, 160)
        || 'unknown';
}

function getVerifyAlertSite(job = {}) {
    const payload = normalizePayload(job.payload);
    return normalizeVerifyMonitorSite(payload.site || 'cn', 'cn');
}

function getVerifyAlertReference(job = {}) {
    const payload = normalizePayload(job.payload);
    if (normalizeText(payload.key_name, 160)) {
        return {
            label: 'API Key',
            value: normalizeText(payload.key_name, 160)
        };
    }
    if (normalizeText(payload.api_base_url, 240)) {
        return {
            label: 'API Base',
            value: normalizeText(payload.api_base_url, 240)
        };
    }
    if (normalizeText(payload.target_id, 160)) {
        return {
            label: '目标',
            value: normalizeText(payload.target_id, 160)
        };
    }

    return {
        label: '记录',
        value: sanitizeText(job.id, 160) || 'unknown'
    };
}

function normalizeVerifyUpstreamEndpoint(value = '') {
    const normalized = normalizeText(value, 240).replace(/\/+$/, '');
    if (!normalized) {
        return '';
    }
    return /\/openapi$/i.test(normalized) ? normalized : `${normalized}/openapi`;
}

function buildVerifyAlertDetailSummary(job = {}) {
    const payload = normalizePayload(job.payload);
    const upstreamEndpoint = normalizeText(payload.upstream_endpoint, 240)
        || normalizeVerifyUpstreamEndpoint(payload.api_base_url);
    const parts = [];

    if (normalizeText(payload.api_base_url, 240)) {
        parts.push(`API Base：${normalizeText(payload.api_base_url, 240)}`);
    }
    if (upstreamEndpoint) {
        parts.push(`请求地址：${upstreamEndpoint}`);
    }
    if (Number.isFinite(Number(payload.balance))) {
        parts.push(`余额：${Number(payload.balance)}`);
    }
    if (Number.isFinite(Number(payload.remaining_jobs))) {
        parts.push(`剩余任务：${Number(payload.remaining_jobs)}`);
    }
    if (Number.isFinite(Number(payload.queue_size))) {
        parts.push(`队列：${Number(payload.queue_size)}`);
    }
    if (Number.isFinite(Number(payload.running_jobs))) {
        parts.push(`运行中：${Number(payload.running_jobs)}`);
    }
    if (Number.isFinite(Number(payload.failure_rate_percent))) {
        parts.push(`失败率：${Number(payload.failure_rate_percent)}%`);
    }

    return parts.join(' · ');
}

function buildVerifyAlertWorkspaceItem(job = {}, caseRecord = null, caseEventsByKey = new Map()) {
    const payload = normalizePayload(job.payload);
    const targetId = getVerifyAlertTargetId(job);
    const reference = getVerifyAlertReference(job);
    const site = getVerifyAlertSite(job);
    const caseKey = buildOpsAlertCaseKey('verify', targetId, site);
    const caseState = buildOpsAlertItemCaseState('verify', targetId, caseRecord, caseEventsByKey, { site });
    const hasCaseRecord = Boolean(caseRecord || (caseEventsByKey instanceof Map && Array.isArray(caseEventsByKey.get(caseKey)) && caseEventsByKey.get(caseKey).length));

    return {
        id: sanitizeText(job.id, 160) || null,
        site,
        category_key: 'verify',
        alert_type: sanitizeText(job.alert_type, 120).toLowerCase() || null,
        severity: sanitizeText(job.severity, 40).toLowerCase() || 'warning',
        title: sanitizeText(job.title, 240) || '验证服务告警',
        message: getVerifyAlertExcerpt(job),
        response_summary: buildVerifyAlertDetailSummary(job) || null,
        created_at: sanitizeText(job.created_at, 80) || null,
        target_id: targetId,
        reference_label: reference.label,
        reference_value: reference.value,
        key_name: normalizeText(payload.key_name, 160) || null,
        api_base_url: normalizeText(payload.api_base_url, 240) || null,
        alert_state: getVerifyAlertTypeState(job.alert_type),
        has_case_record: hasCaseRecord,
        ...caseState
    };
}

function buildVerifyMonitorWorkspaceItems(alertJobs = [], caseMap = new Map(), caseEventsByKey = new Map()) {
    const latestByTarget = new Map();

    for (const job of Array.isArray(alertJobs) ? alertJobs : []) {
        const targetId = getVerifyAlertTargetId(job);
        const site = getVerifyAlertSite(job);
        const caseRecord = caseMap instanceof Map ? caseMap.get(buildOpsAlertCaseKey('verify', targetId, site)) || null : null;
        const item = buildVerifyAlertWorkspaceItem(job, caseRecord, caseEventsByKey);
        const itemKey = buildOpsAlertCaseKey('verify', item.target_id, item.site);
        if (!latestByTarget.has(itemKey)) {
            latestByTarget.set(itemKey, item);
        }
    }

    return Array.from(latestByTarget.values())
        .filter((item) => item.alert_state === 'problem' || item.has_case_record)
        .sort((left, right) => {
            const leftOpen = left.alert_state === 'problem' ? 1 : 0;
            const rightOpen = right.alert_state === 'problem' ? 1 : 0;
            if (leftOpen !== rightOpen) {
                return rightOpen - leftOpen;
            }

            const leftClaimed = left.case_status === 'claimed' ? 1 : 0;
            const rightClaimed = right.case_status === 'claimed' ? 1 : 0;
            if (leftClaimed !== rightClaimed) {
                return rightClaimed - leftClaimed;
            }

            return Date.parse(sanitizeText(right.created_at, 80)) - Date.parse(sanitizeText(left.created_at, 80));
        })
        .slice(0, VERIFY_MONITOR_WORKSPACE_LIMIT);
}

function buildVerifyMonitorWorkspaceSummary(items = []) {
    const rows = Array.isArray(items) ? items : [];
    return {
        visible_count: rows.length,
        active_problem_count: rows.filter((item) => item.alert_state === 'problem').length,
        claimed_count: rows.filter((item) => sanitizeText(item.case_status, 40).toLowerCase() === 'claimed').length,
        pending_recovery_count: rows.filter((item) => item.alert_state === 'recovered' && sanitizeText(item.case_status, 40).toLowerCase() !== 'resolved').length
    };
}

module.exports = async (req, res) => {
    try {
        const accessRequirement = String(req.method || '').toUpperCase() === 'GET'
            ? { anyOf: ['settings.manage', 'analytics.view'] }
            : { permission: 'settings.manage' };
        const { supabase } = await requireAdmin(req, accessRequirement);

        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const now = new Date();
        const nowMs = now.getTime();
        const searchParams = getQueryParams(req);
        const taskPage = normalizePageNumber(searchParams.get('taskPage'), 1);
        const taskPageSize = normalizePageSize(searchParams.get('taskPageSize'), VERIFY_MONITOR_DEFAULT_TASK_PAGE_SIZE);
        const failurePage = normalizePageNumber(searchParams.get('failurePage'), 1);
        const failurePageSize = normalizePageSize(searchParams.get('failurePageSize'), VERIFY_MONITOR_DEFAULT_FAILURE_PAGE_SIZE);
        const site = normalizeVerifyMonitorSite(searchParams.get('site') || req.adminSite, 'all');
        const verifyAlertSinceIso = new Date(now.getTime() - VERIFY_MONITOR_ALERT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const [
            verificationLogs,
            verifyAlertJobs
        ] = await Promise.all([
            fetchRecentVerifyLogRows(supabase),
            fetchRecentVerifyAlertJobs(supabase, verifyAlertSinceIso)
        ]);

        const scopedVerificationLogs = site === 'all'
            ? (verificationLogs || [])
            : (verificationLogs || []).filter((row) => normalizeVerifyMonitorSite(row.site || 'cn', 'cn') === site);
        const scopedVerifyAlertJobs = site === 'all'
            ? (verifyAlertJobs || [])
            : (verifyAlertJobs || []).filter((job) => getVerifyAlertSite(job) === site);
        const rawDedupedRows = dedupeLatestMonitorRows(scopedVerificationLogs);
        const verifyLedgerSubmitters = await fetchVerifyLedgerSubmitterRows(supabase, rawDedupedRows);
        const rowsWithLedgerSubmitters = enrichVerifyRowsWithLedgerAndProfiles(
            rawDedupedRows,
            verifyLedgerSubmitters,
            new Map()
        );
        const verifySubmitterProfiles = await fetchVerifySubmitterProfiles(supabase, rowsWithLedgerSubmitters);
        const dedupedRows = enrichVerifyRowsWithLedgerAndProfiles(
            rawDedupedRows,
            verifyLedgerSubmitters,
            verifySubmitterProfiles
        );
        const activeRows = dedupedRows.filter((row) => ACTIVE_VERIFY_STATUSES.has(row.status));
        const failureRows = dedupedRows.filter((row) => (
            !SUCCESS_VERIFY_STATUSES.has(row.status)
            && !ACTIVE_VERIFY_STATUSES.has(row.status)
        ));
        const oldestActive = activeRows.reduce((oldest, row) => {
            if (!row.created_at) return oldest;
            if (!oldest) return row;
            const currentMs = Date.parse(row.created_at);
            const oldestMs = Date.parse(oldest.created_at);
            if (!Number.isFinite(currentMs)) return oldest;
            if (!Number.isFinite(oldestMs)) return row;
            return currentMs < oldestMs ? row : oldest;
        }, null);
        const verifyAlertTargets = scopedVerifyAlertJobs.map((job) => ({
            site: getVerifyAlertSite(job),
            category_key: 'verify',
            target_id: getVerifyAlertTargetId(job)
        }));
        const [
            verifyCaseMap,
            verifyCaseEventsByKey
        ] = await Promise.all([
            fetchOpsAlertCasesByTargets(supabase, verifyAlertTargets),
            fetchOpsAlertCaseEventsByTargets(supabase, verifyAlertTargets)
        ]);
        const alertItems = buildVerifyMonitorWorkspaceItems(scopedVerifyAlertJobs, verifyCaseMap, verifyCaseEventsByKey);
        const facts = buildVerifyMonitorFacts(dedupedRows, activeRows, failureRows, nowMs);
        const taskCollection = buildPagedCollection(dedupedRows, taskPage, taskPageSize);
        const failureCollection = buildPagedCollection(failureRows, failurePage, failurePageSize);

        return sendJson(res, 200, {
            success: true,
            fetched_at: now.toISOString(),
            summary: {
                sample_size: verificationLogs.length,
                site,
                scan_page_size: VERIFY_MONITOR_RAW_SCAN_PAGE_SIZE,
                scan_max_pages: VERIFY_MONITOR_RAW_SCAN_MAX_PAGES,
                deduped_task_count: dedupedRows.length,
                active_task_count: activeRows.length,
                failure_task_count: failureRows.length,
                oldest_active_at: sanitizeText(oldestActive?.created_at, 80) || null,
                oldest_active_minutes: formatMinutesSince(oldestActive?.created_at, nowMs)
            },
            facts,
            alert_summary: buildVerifyMonitorWorkspaceSummary(alertItems),
            alert_items: alertItems,
            recent_tasks: taskCollection.items,
            recent_task_pagination: taskCollection.pagination,
            recent_failures: failureCollection.items,
            recent_failure_pagination: failureCollection.pagination
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Verify monitor settings failed'
        });
    }
};
