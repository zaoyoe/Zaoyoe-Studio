const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    runAiImageTaskBatch
} = require('../../_ai-image-runtime');
const {
    createOpenAiCompatibleImageExecutor
} = require('../../_ai-image-models');

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeSite(value = '') {
    const normalized = sanitizeText(value, 20).toLowerCase();
    return normalized === 'cn' || normalized === 'intl' ? normalized : '';
}

function normalizeLimit(value, fallback = 5) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(20, Math.max(1, parsed));
}

function serializeRunResult(result = {}) {
    return {
        task_id: result.task?.id || '',
        status: result.task?.status || '',
        charged_points: Number(result.chargedPoints || result.task?.charged_points || 0) || 0,
        result_count: Array.isArray(result.results) ? result.results.length : 0,
        error_code: result.error?.code || result.task?.error_code || '',
        error_message: result.error?.message || result.task?.error_message || ''
    };
}

module.exports = async function aiImageRunHandler(req, res) {
    try {
        const { supabase, user } = await requireAdmin(req, {
            anyOf: ['settings.manage', 'prompts.manage']
        });

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const body = await parseJsonBody(req);
        const taskId = sanitizeText(body.taskId || body.task_id, 160);
        const site = normalizeSite(body.site);
        const limit = normalizeLimit(body.limit, taskId ? 1 : 5);
        const executor = createOpenAiCompatibleImageExecutor({ supabase });
        const result = await runAiImageTaskBatch({
            supabase,
            taskId,
            site,
            limit,
            executor
        });

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            module: 'ai-image',
            site: site || 'all',
            actionType: taskId ? 'ai_image.task.run_one' : 'ai_image.task.run_batch',
            details: {
                task_id: taskId || null,
                limit,
                processed: result.processed,
                results: result.results.map(serializeRunResult)
            }
        });

        return sendJson(res, 200, {
            success: true,
            processed: result.processed,
            results: result.results.map(serializeRunResult)
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'AI image task runner failed',
            code: error.code || 'ai_image_run_failed'
        });
    }
};
