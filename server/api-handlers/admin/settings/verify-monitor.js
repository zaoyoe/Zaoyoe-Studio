const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');

const ACTIVE_VERIFY_STATUSES = new Set(['queued', 'running', 'processing', 'pending']);
const SUCCESS_VERIFY_STATUSES = new Set(['success']);
const VERIFY_MONITOR_SAMPLE_LIMIT = 80;
const VERIFY_MONITOR_RECENT_TASK_LIMIT = 8;
const VERIFY_MONITOR_RECENT_FAILURE_LIMIT = 6;

function sanitizeText(value, maxLength = 240) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
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

function buildMonitorLogKey(row) {
    const site = sanitizeText(row.site, 20) || 'cn';
    const jobId = sanitizeText(row.job_id, 120)
        || sanitizeText(row.verification_id, 120)
        || sanitizeText(row.id, 120)
        || 'unknown';
    return `${site}:${jobId}`;
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
        stage_label: sanitizeText(payload.stage_label, 120),
        raw_status: sanitizeText(payload.raw_status || payload.status, 120),
        error_code: sanitizeText(payload.error_code, 120),
        error_message: sanitizeText(payload.error_message || payload.message, 300),
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

        const { data, error } = await supabase
            .from('verification_logs')
            .select('id, user_id, verification_id, status, message, points_deducted, site, created_at')
            .order('created_at', { ascending: false })
            .limit(VERIFY_MONITOR_SAMPLE_LIMIT);

        if (error) {
            throw new Error(error.message || '加载验证运维面板失败');
        }

        const now = new Date();
        const nowMs = now.getTime();
        const dedupedRows = dedupeLatestMonitorRows(data || []);
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

        return sendJson(res, 200, {
            success: true,
            fetched_at: now.toISOString(),
            summary: {
                sample_size: VERIFY_MONITOR_SAMPLE_LIMIT,
                deduped_task_count: dedupedRows.length,
                active_task_count: activeRows.length,
                failure_task_count: failureRows.length,
                oldest_active_at: sanitizeText(oldestActive?.created_at, 80) || null,
                oldest_active_minutes: formatMinutesSince(oldestActive?.created_at, nowMs)
            },
            recent_tasks: dedupedRows.slice(0, VERIFY_MONITOR_RECENT_TASK_LIMIT),
            recent_failures: failureRows.slice(0, VERIFY_MONITOR_RECENT_FAILURE_LIMIT)
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Verify monitor settings failed'
        });
    }
};
