const {
    getOptionalSupabaseAdmin,
    parseJsonBody,
    requireAuthenticatedUser,
    sendJson
} = require('../../_lib/admin');
const {
    applyRateLimitHeaders,
    resolveClientIp,
    takeRateLimitToken
} = require('../../_lib/request-security');
const {
    completeMockPayment
} = require('../../_lib/payments/orders');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    const rateLimit = await takeRateLimitToken({
        supabase: getOptionalSupabaseAdmin(),
        key: `payments-mock-complete:${resolveClientIp(req, { env: process.env }) || 'unknown'}`,
        limit: Math.max(1, Number(process.env.PAYMENTS_MOCK_COMPLETE_RATE_LIMIT_MAX || 10)),
        windowMs: Math.max(10_000, Number(process.env.PAYMENTS_MOCK_COMPLETE_RATE_LIMIT_WINDOW_MS || 60_000))
    });
    applyRateLimitHeaders(res, rateLimit);
    if (!rateLimit.allowed) {
        return sendJson(res, 429, {
            success: false,
            code: 'rate_limited',
            message: 'Too many mock payment requests',
            retry_after_seconds: rateLimit.retryAfterSeconds
        });
    }

    try {
        const { supabase, adminSupabase, user } = await requireAuthenticatedUser(req);
        const body = await parseJsonBody(req);
        const payload = await completeMockPayment({
            supabase: adminSupabase || supabase,
            user,
            body,
            env: process.env,
            requestHost: req.headers.host || req.headers.Host || ''
        });

        return sendJson(res, 200, payload);
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || '模拟支付失败'
        });
    }
};
