const {
    normalizeAdminSite,
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const BATCH_RESTORE_AUDIT_ACTION = 'discount.batch_restore.run';
const MAX_RUN_ITEMS = 50;

function normalizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

function normalizeAdminAuditSite(value) {
    return normalizeAdminSite(value, { defaultValue: 'all' }) || 'all';
}

function normalizeBoolean(value) {
    return value === true;
}

function normalizeInteger(value, fallback = 0, { min = 0, max = 100000 } = {}) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, parsed));
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

function normalizeBatchRestoreItem(value = {}, options = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        id: normalizeText(source.id, 160) || null,
        code: normalizeText(source.code, 160).toUpperCase() || null,
        case_status: normalizeText(source.case_status, 80).toLowerCase() || null,
        signal_type: normalizeText(source.signal_type, 120).toLowerCase() || null,
        risk_score: Number.isFinite(Number(source.risk_score))
            ? Math.max(0, Math.round(Number(source.risk_score)))
            : null,
        message: normalizeText(source.message, 2000) || null,
        skipped: normalizeBoolean(source.skipped),
        retry_count: normalizeInteger(source.retry_count, 0, { min: 0, max: 99 }),
        source: normalizeText(options.source, 40) || null
    };
}

function normalizeBatchRestoreSummaryPayload(source = {}) {
    const payload = normalizeJsonObject(source);
    const restored = Array.isArray(payload.restored) ? payload.restored : [];
    const failed = Array.isArray(payload.failed) ? payload.failed : [];

    return {
        batch_run_id: normalizeText(payload.batch_run_id || payload.run_id, 160) || null,
        retry_of_run_id: normalizeText(payload.retry_of_run_id, 160) || null,
        operation_source: normalizeText(payload.operation_source, 120).toLowerCase() || null,
        generated_at: normalizeText(payload.generated_at, 80) || new Date().toISOString(),
        site: normalizeAdminAuditSite(payload.site || payload.batch_site),
        status_filter: normalizeText(payload.status_filter, 80).toLowerCase() || 'all',
        search_filter: normalizeText(payload.search_filter, 255) || '',
        resolution: normalizeText(payload.resolution, 4000) || null,
        should_resolve_cases: normalizeBoolean(payload.should_resolve_cases),
        total_candidate_count: normalizeInteger(payload.total_candidate_count, 0),
        total_attempted_count: normalizeInteger(payload.total_attempted_count, restored.length + failed.length),
        truncated_count: normalizeInteger(payload.truncated_count, 0),
        restored: restored.slice(0, MAX_RUN_ITEMS).map((item) => normalizeBatchRestoreItem(item, { source: 'restored' })),
        failed: failed.slice(0, MAX_RUN_ITEMS).map((item) => normalizeBatchRestoreItem(item, { source: 'failed' })),
        case_sync_warning: normalizeText(payload.case_sync_warning, 2000) || null
    };
}

function buildBatchRestoreRunResponse(row = {}) {
    const details = normalizeBatchRestoreSummaryPayload(row?.details);
    return {
        run_id: details.batch_run_id || normalizeText(row?.id, 160) || null,
        retry_of_run_id: details.retry_of_run_id,
        operation_source: details.operation_source,
        generated_at: details.generated_at,
        created_at: normalizeText(row?.created_at, 80) || details.generated_at,
        actor_label: normalizeText(row?.admin_email, 255) || normalizeText(row?.admin_id, 160) || null,
        site: details.site,
        status_filter: details.status_filter,
        search_filter: details.search_filter,
        resolution: details.resolution,
        should_resolve_cases: details.should_resolve_cases,
        total_candidate_count: details.total_candidate_count,
        total_attempted_count: details.total_attempted_count,
        truncated_count: details.truncated_count,
        restored: details.restored,
        failed: details.failed,
        restored_count: details.restored.length,
        failed_count: details.failed.filter((item) => item.skipped !== true).length,
        skipped_count: details.failed.filter((item) => item.skipped === true).length,
        case_sync_warning: details.case_sync_warning
    };
}

async function fetchAuditRows(supabase, tableName = 'admin_audit_logs_view', selection = 'id, action_type, details, created_at, admin_id, admin_email') {
    const { data, error } = await supabase
        .from(tableName)
        .select(selection)
        .eq('action_type', BATCH_RESTORE_AUDIT_ACTION)
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function fetchBatchRestoreAuditRows(supabase, site = 'all') {
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

    return rows
        .map((row) => buildBatchRestoreRunResponse(row))
        .filter((row) => site === 'all' || row.site === site)
        .sort((left, right) => Date.parse(normalizeText(right.created_at, 80)) - Date.parse(normalizeText(left.created_at, 80)));
}

module.exports = async function adminDiscountBatchHistoryHandler(req, res) {
    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'discounts.manage' });

        if (req.method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const site = normalizeAdminAuditSite(url.searchParams.get('site') || req.adminSite);
            const runs = await fetchBatchRestoreAuditRows(supabase, site);

            return sendJson(res, 200, {
                success: true,
                site,
                runs
            });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const body = await parseJsonBody(req);
        const summary = normalizeBatchRestoreSummaryPayload(body);

        if (!summary.batch_run_id) {
            return sendJson(res, 400, {
                success: false,
                message: 'batch_run_id is required'
            });
        }

        if (!summary.total_attempted_count) {
            return sendJson(res, 400, {
                success: false,
                message: 'total_attempted_count is required'
            });
        }

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            actionType: BATCH_RESTORE_AUDIT_ACTION,
            site: summary.site,
            module: 'discounts',
            details: summary
        });

        return sendJson(res, 200, {
            success: true,
            recorded: true,
            run: {
                ...summary,
                run_id: summary.batch_run_id,
                created_at: summary.generated_at,
                actor_label: normalizeText(user.email, 255) || normalizeText(user.id, 160) || null,
                restored_count: summary.restored.length,
                failed_count: summary.failed.filter((item) => item.skipped !== true).length,
                skipped_count: summary.failed.filter((item) => item.skipped === true).length
            }
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to handle discount batch history'
        });
    }
};
