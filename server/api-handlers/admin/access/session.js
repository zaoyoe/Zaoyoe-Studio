const { requireAdmin, sendJson } = require('../../../../api/_lib/admin');

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

        const { user } = await requireAdmin(req);
        const token = await issueAdminStudioToken({ sub: user.id });

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
