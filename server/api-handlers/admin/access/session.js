const {
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const { resolveClientIp } = require('../../../../api/_lib/request-security');

async function loadAdminStudioAccessHelpers() {
    return import('../../../../api/_lib/admin-studio-access.mjs');
}

module.exports = async function adminAccessSessionHandler(req, res) {
    try {
        const method = String(req.method || 'GET').toUpperCase();
        const {
            buildAdminStudioSetCookie,
            buildClearAdminStudioCookie,
            getAdminStudioTtlSeconds,
            issueAdminStudioToken
        } = await loadAdminStudioAccessHelpers();

        if (method === 'DELETE') {
            res.setHeader('Set-Cookie', buildClearAdminStudioCookie());
            return sendJson(res, 200, {
                success: true,
                cleared: true
            });
        }

        if (method !== 'POST') {
            res.setHeader('Allow', 'POST, DELETE');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const { user, supabase } = await requireAdmin(req);
        const token = await issueAdminStudioToken({ sub: user.id });

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            actionType: 'admin.access.session.issue',
            details: {
                admin_email: String(user.email || '').trim() || null,
                client_ip: resolveClientIp(req, { env: process.env }) || null,
                user_agent: String(req.headers?.['user-agent'] || '').trim() || null,
                origin: String(req.headers?.origin || '').trim() || null,
                referer: String(req.headers?.referer || '').trim() || null,
                granted: true
            }
        });

        res.setHeader('Set-Cookie', buildAdminStudioSetCookie(token));
        return sendJson(res, 200, {
            success: true,
            granted: true,
            expiresInSeconds: getAdminStudioTtlSeconds()
        });
    } catch (error) {
        const statusCode = Number(error?.statusCode) || 500;
        return sendJson(res, statusCode, {
            success: false,
            message: error?.message || 'Failed to issue admin studio session'
        });
    }
};
