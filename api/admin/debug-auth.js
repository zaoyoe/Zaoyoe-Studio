const {
    getBearerToken,
    getSupabaseAdmin,
    getSupabasePublicClient,
    getSupabasePublishableKey,
    getSupabaseUrl,
    sendJson
} = require('../_lib/admin');

module.exports = async function handler(req, res) {
    if (!['GET'].includes(req.method)) {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    const token = getBearerToken(req);
    const payload = {
        success: true,
        has_authorization_header: Boolean(req.headers.authorization || req.headers.Authorization),
        has_bearer_token: Boolean(token),
        supabase_url: getSupabaseUrl(),
        publishable_key_prefix: getSupabasePublishableKey().slice(0, 18),
        has_service_role_key: false,
        request_client_user_ok: false,
        admin_client_user_ok: false,
        request_client_error: null,
        admin_client_error: null
    };

    if (!token) {
        return sendJson(res, 200, payload);
    }

    try {
        const publicClient = getSupabasePublicClient();
        const { data, error } = await publicClient.auth.getUser(token);
        payload.request_client_user_ok = Boolean(data?.user);
        payload.request_client_error = error?.message || null;
    } catch (error) {
        payload.request_client_error = error?.message || 'request_client_exception';
    }

    try {
        const adminClient = getSupabaseAdmin();
        payload.has_service_role_key = true;
        const { data, error } = await adminClient.auth.getUser(token);
        payload.admin_client_user_ok = Boolean(data?.user);
        payload.admin_client_error = error?.message || null;
    } catch (error) {
        payload.admin_client_error = error?.message || 'admin_client_exception';
    }

    return sendJson(res, 200, payload);
};
