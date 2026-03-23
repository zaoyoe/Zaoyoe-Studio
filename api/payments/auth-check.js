const {
    requireAuthenticatedUser,
    sendJson
} = require('../_lib/admin');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { user, requestSupabase } = await requireAuthenticatedUser(req);

        return sendJson(res, 200, {
            success: true,
            user: {
                id: user.id,
                email: user.email || ''
            },
            auth: {
                session_mode: requestSupabase ? 'request_client' : 'admin_fallback'
            }
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Auth session missing!'
        });
    }
};
