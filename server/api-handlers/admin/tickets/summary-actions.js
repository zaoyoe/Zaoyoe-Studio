const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

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
        .map((item) => normalizeText(item, 80))
        .filter(Boolean);
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

async function updateSummaryJob(supabase, jobId = '', patch = {}) {
    const { data, error } = await supabase
        .from('ops_alert_jobs')
        .update({
            ...patch,
            updated_at: new Date().toISOString()
        })
        .eq('id', jobId)
        .select('id, alert_type, severity, title, payload, channels, remaining_channels, status, attempt_count, max_attempts, next_retry_at, last_attempt_at, delivered_at, last_error, worker_name, created_at, updated_at')
        .single();

    if (error) {
        throw error;
    }

    return data || null;
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
        attempt_count: Math.max(0, Math.round(Number(job.attempt_count || 0) || 0)),
        max_attempts: Math.max(0, Math.round(Number(job.max_attempts || 0) || 0)),
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

function buildSummaryJobAuditContext(job = null) {
    const payload = normalizeJsonObject(job?.payload);
    const channels = normalizeStringArray(job?.channels);

    return {
        job_id: normalizeText(job?.id, 120) || null,
        alert_type: normalizeText(job?.alert_type, 120).toLowerCase() || null,
        queue_previous_status: normalizeText(job?.status, 40).toLowerCase() || null,
        queue_next_status: normalizeText(job?.status, 40).toLowerCase() || null,
        queue_channel_count: channels.length,
        summary_schedule_mode: normalizeText(payload.summary_schedule_mode, 40).toLowerCase() || null,
        summary_window_minutes: Number.isFinite(Number(payload.summary_window_minutes))
            ? Math.max(0, Math.round(Number(payload.summary_window_minutes)))
            : null,
        item_count: Number.isFinite(Number(payload.item_count))
            ? Math.max(0, Math.round(Number(payload.item_count)))
            : null
    };
}

async function applySummaryJobAction(supabase, job = null, action = '', options = {}) {
    const normalizedAction = normalizeText(action, 40).toLowerCase();
    const normalizedStatus = normalizeText(job?.status, 40).toLowerCase();
    const channels = normalizeStringArray(job?.channels);
    const remainingChannels = normalizeStringArray(job?.remaining_channels);
    const retryChannels = remainingChannels.length ? remainingChannels : channels;
    const nowIso = new Date().toISOString();
    const normalizedNote = normalizeText(options?.note, 2000);

    if (normalizedAction === 'add_note') {
        if (!normalizedNote) {
            const error = new Error('note is required');
            error.statusCode = 400;
            throw error;
        }

        return {
            job,
            message: '已记录人工备注',
            auditDetails: {
                ...buildSummaryJobAuditContext(job),
                action: 'add_note',
                note: normalizedNote,
                note_length: normalizedNote.length
            }
        };
    }

    if (normalizedAction !== 'request_retry') {
        const error = new Error('Unsupported summary job action');
        error.statusCode = 400;
        throw error;
    }

    if (!['retry', 'dead_letter'].includes(normalizedStatus)) {
        const error = new Error('只有重试中或死信状态的汇总任务才能人工重试');
        error.statusCode = 409;
        throw error;
    }

    if (!retryChannels.length) {
        const error = new Error('该汇总任务缺少可重试通道，无法重新投递');
        error.statusCode = 409;
        throw error;
    }

    const patch = normalizedStatus === 'dead_letter'
        ? {
            status: 'retry',
            remaining_channels: retryChannels,
            next_retry_at: nowIso,
            delivered_at: null,
            last_attempt_at: null,
            last_error: null,
            worker_name: null,
            attempt_count: 0
        }
        : {
            status: 'retry',
            remaining_channels: retryChannels,
            next_retry_at: nowIso,
            worker_name: null
        };
    const updatedJob = await updateSummaryJob(supabase, normalizeText(job?.id, 120), patch);

    return {
        job: updatedJob,
        message: normalizedStatus === 'dead_letter'
            ? '已将失败汇总重新加入重试队列'
            : '已提前触发这条汇总的下一次重试',
        auditDetails: {
            ...buildSummaryJobAuditContext(job),
            action: 'request_retry',
            queue_previous_status: normalizedStatus || null,
            queue_next_status: 'retry',
            queue_channel_count: retryChannels.length,
            manual_retry_mode: normalizedStatus === 'dead_letter' ? 'requeue' : 'expedite'
        }
    };
}

module.exports = async function adminTicketSummaryActionsHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'tickets.manage' });
        const body = await parseJsonBody(req);
        const jobId = normalizeText(body.jobId, 120);
        const action = normalizeText(body.action, 40).toLowerCase();
        const note = normalizeText(body.note || body.internalNote, 2000);

        if (!jobId) {
            return sendJson(res, 400, {
                success: false,
                message: 'jobId is required'
            });
        }

        if (!action) {
            return sendJson(res, 400, {
                success: false,
                message: 'action is required'
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

        const result = await applySummaryJobAction(supabase, job, action, {
            note
        });
        await writeAdminAuditLog({
            supabase,
            adminId: user?.id,
            actionType: 'ticket.summary_job_action',
            details: {
                ...result.auditDetails,
                title: normalizeText(job.title, 200) || null
            }
        });

        return sendJson(res, 200, {
            success: true,
            message: result.message,
            summary_job: buildSummaryJobResponse(result.job)
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to handle summary job action'
        });
    }
};
