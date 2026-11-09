const { requireAdmin, sendJson, parseJsonBody, getOptionalSupabaseAdmin } = require('../../../../api/_lib/admin');
const { createActivationService, errorResponse } = require('../../_google-one-activation-runtime');

// No generic verify-monitor permission: these operations reveal accounts and settle money.
module.exports = async function verifyActivationJobs(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) {
        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }
    let context;
    try { context = await requireAdmin(req, { permission: 'settings.manage' }); }
    catch (error) { return sendJson(res, error.statusCode || 403, { success: false, message: '需要设置管理权限。' }); }
    const admin = context.adminSupabase || getOptionalSupabaseAdmin();
    if (!admin?.rpc) return sendJson(res, 503, { success: false, code: 'activation_unavailable', message: '开通服务暂不可用。' });
    try {
        const service = createActivationService({ supabase: admin });
        if (req.method === 'GET') return sendJson(res, 200, { success: true, jobs: await service.list({ req, user: context.user, admin: true }) });
        const body = await parseJsonBody(req);
        // Site hints are honored only for exact local hosts, never for production callers.
        const job = body.action === 'refresh'
            ? await service.status({ req, user: context.user, id: body.job_id, admin: true })
            : await service.resolve({ req, user: context.user, body });
        return sendJson(res, 200, { success: true, ...job });
    } catch (error) {
        const response = errorResponse(error);
        return sendJson(res, response.status, response.body);
    }
};
