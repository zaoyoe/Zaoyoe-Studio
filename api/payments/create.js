const {
    parseJsonBody,
    requireAuthenticatedUser,
    sendJson
} = require('../_lib/admin');
const {
    createPaymentRequest
} = require('../_lib/payments/orders');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase, requestSupabase, adminSupabase, user } = await requireAuthenticatedUser(req);
        const body = await parseJsonBody(req);
        const payload = await createPaymentRequest({
            supabase: requestSupabase || supabase,
            adminSupabase,
            user,
            body,
            env: process.env,
            requestHost: req.headers.host || req.headers.Host || ''
        });

        return sendJson(res, 200, payload);
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || '创建支付请求失败'
        });
    }
};
