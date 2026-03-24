const {
    getSupabaseAdmin,
    getOptionalSupabaseAdmin,
    getSupabasePublicClient,
    sendJson
} = require('../_lib/admin');
const {
    applyRateLimitHeaders,
    resolveClientIp,
    takeRateLimitToken
} = require('../_lib/request-security');
const {
    buildPublicPaymentConfig,
    loadStoredPaymentConfigs
} = require('../_lib/payments/providers');
const {
    getMockPaymentRuntimeState
} = require('../_lib/payments/orders');

function getConfigSupabaseClient() {
    const hasServiceRole = Boolean(
        process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.SUPABASE_SERVICE_KEY
    );
    return hasServiceRole ? getSupabaseAdmin() : getSupabasePublicClient();
}

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
        key: `payments-config:${resolveClientIp(req, { env: process.env }) || 'unknown'}`,
        limit: Math.max(1, Number(process.env.PAYMENTS_CONFIG_RATE_LIMIT_MAX || 120)),
        windowMs: Math.max(10_000, Number(process.env.PAYMENTS_CONFIG_RATE_LIMIT_WINDOW_MS || 60_000))
    });
    applyRateLimitHeaders(res, rateLimit);
    if (!rateLimit.allowed) {
        return sendJson(res, 429, {
            success: false,
            code: 'rate_limited',
            message: 'Too many payment config requests',
            retry_after_seconds: rateLimit.retryAfterSeconds
        });
    }

    try {
        const supabase = getConfigSupabaseClient();
        const { paymentChannels, rechargeOptions } = await loadStoredPaymentConfigs(supabase);
        const runtime = {
            mock_payment: getMockPaymentRuntimeState({
                requestHost: req.headers.host || req.headers.Host || '',
                env: process.env
            })
        };
        const publicConfig = buildPublicPaymentConfig(paymentChannels, rechargeOptions, runtime);

        return sendJson(res, 200, {
            success: true,
            config: publicConfig.paymentChannels,
            recharge_options: publicConfig.rechargeOptions,
            runtime
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || '加载支付配置失败'
        });
    }
};
