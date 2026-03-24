const {
    getOptionalSupabaseAdmin,
    requireAuthenticatedUser,
    sendJson
} = require('../_lib/admin');
const {
    applyRateLimitHeaders,
    resolveClientIp,
    takeRateLimitToken
} = require('../_lib/request-security');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    const rateLimit = await takeRateLimitToken({
        supabase: getOptionalSupabaseAdmin(),
        key: `payments-auth-check:${resolveClientIp(req, { env: process.env }) || 'unknown'}`,
        limit: Math.max(1, Number(process.env.PAYMENTS_AUTH_CHECK_RATE_LIMIT_MAX || 60)),
        windowMs: Math.max(10_000, Number(process.env.PAYMENTS_AUTH_CHECK_RATE_LIMIT_WINDOW_MS || 60_000))
    });
    applyRateLimitHeaders(res, rateLimit);
    if (!rateLimit.allowed) {
        return sendJson(res, 429, {
            success: false,
            code: 'rate_limited',
            message: 'Too many auth-check requests',
            retry_after_seconds: rateLimit.retryAfterSeconds
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
