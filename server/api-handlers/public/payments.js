const {
    createZpayWebhookHandler
} = require('../../../api/_lib/payments/zpay-webhook');
const {
    createNowpaymentsWebhookHandler
} = require('../../../api/_lib/payments/nowpayments-webhook');

function createPaymentsHandlers({
    admin,
    requestSecurity,
    paymentProviders,
    paymentOrders,
    zpayWebhook,
    nowpaymentsWebhook,
    env = process.env
} = {}) {
    const {
        getSupabaseAdmin,
        getOptionalSupabaseAdmin,
        getSupabasePublicClient,
        parseJsonBody,
        requireAuthenticatedUser,
        sendJson
    } = admin || {};
    const {
        applyRateLimitHeaders,
        resolveClientIp,
        takeRateLimitToken
    } = requestSecurity || {};
    const {
        buildPublicPaymentConfig,
        buildPublicPaymentRuntime,
        loadStoredPaymentConfigs
    } = paymentProviders || {};
    const {
        completeMockPayment,
        createPaymentRequest,
        getPaymentRequestStatus,
        getMockPaymentRuntimeState
    } = paymentOrders || {};
    const resolvedZpayWebhook = zpayWebhook || {
        createZpayWebhookHandler
    };
    const resolvedNowpaymentsWebhook = nowpaymentsWebhook || {
        createNowpaymentsWebhookHandler
    };

    const parseBody = typeof parseJsonBody === 'function'
        ? parseJsonBody
        : async function defaultParseJsonBody() {
            return {};
        };

    function getConfigSupabaseClient() {
        const hasServiceRole = Boolean(
            env.SUPABASE_SERVICE_ROLE_KEY
            || env.SUPABASE_SERVICE_KEY
        );
        return hasServiceRole ? getSupabaseAdmin?.() : getSupabasePublicClient?.();
    }

    function getWebhookSupabaseClient() {
        try {
            return getOptionalSupabaseAdmin?.() || getSupabaseAdmin?.() || null;
        } catch (_) {
            return null;
        }
    }

    const zpayWebhookHandler = resolvedZpayWebhook.createZpayWebhookHandler({
        getSupabase: getWebhookSupabaseClient,
        env
    });
    const nowpaymentsWebhookHandler = resolvedNowpaymentsWebhook.createNowpaymentsWebhookHandler({
        getSupabase: getWebhookSupabaseClient,
        env
    });

    return {
        'auth-check': async function paymentsAuthCheckHandler(req, res) {
            if (req.method !== 'GET') {
                res.setHeader('Allow', 'GET');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }

            const rateLimit = await takeRateLimitToken({
                supabase: getOptionalSupabaseAdmin(),
                key: `payments-auth-check:${resolveClientIp(req, { env }) || 'unknown'}`,
                limit: Math.max(1, Number(env.PAYMENTS_AUTH_CHECK_RATE_LIMIT_MAX || 60)),
                windowMs: Math.max(10_000, Number(env.PAYMENTS_AUTH_CHECK_RATE_LIMIT_WINDOW_MS || 60_000))
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
        },
        config: async function paymentsConfigHandler(req, res) {
            if (req.method !== 'GET') {
                res.setHeader('Allow', 'GET');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }

            const rateLimit = await takeRateLimitToken({
                supabase: getOptionalSupabaseAdmin(),
                key: `payments-config:${resolveClientIp(req, { env }) || 'unknown'}`,
                limit: Math.max(1, Number(env.PAYMENTS_CONFIG_RATE_LIMIT_MAX || 120)),
                windowMs: Math.max(10_000, Number(env.PAYMENTS_CONFIG_RATE_LIMIT_WINDOW_MS || 60_000))
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
                        env
                    })
                };
                const publicConfig = buildPublicPaymentConfig(paymentChannels, rechargeOptions, runtime);
                const publicRuntime = buildPublicPaymentRuntime(runtime);

                return sendJson(res, 200, {
                    success: true,
                    config: publicConfig.paymentChannels,
                    recharge_options: publicConfig.rechargeOptions,
                    runtime: publicRuntime
                });
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || '加载支付配置失败'
                });
            }
        },
        create: async function paymentsCreateHandler(req, res) {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }

            const rateLimit = await takeRateLimitToken({
                supabase: getOptionalSupabaseAdmin(),
                key: `payments-create:${resolveClientIp(req, { env }) || 'unknown'}`,
                limit: Math.max(1, Number(env.PAYMENTS_CREATE_RATE_LIMIT_MAX || 12)),
                windowMs: Math.max(10_000, Number(env.PAYMENTS_CREATE_RATE_LIMIT_WINDOW_MS || 60_000))
            });
            applyRateLimitHeaders(res, rateLimit);
            if (!rateLimit.allowed) {
                return sendJson(res, 429, {
                    success: false,
                    code: 'rate_limited',
                    message: 'Too many payment creation requests',
                    retry_after_seconds: rateLimit.retryAfterSeconds
                });
            }

            try {
                const { supabase, requestSupabase, adminSupabase, user } = await requireAuthenticatedUser(req);
                const body = await parseBody(req);
                const payload = await createPaymentRequest({
                    supabase: requestSupabase || supabase,
                    adminSupabase,
                    user,
                    body,
                    env,
                    requestHost: req.headers.host || req.headers.Host || '',
                    clientIp: resolveClientIp(req, { env }) || '',
                    userAgent: String(req.headers['user-agent'] || '').trim()
                });

                return sendJson(res, 200, payload);
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || '创建支付请求失败'
                });
            }
        },
        status: async function paymentsStatusHandler(req, res) {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }

            const rateLimit = await takeRateLimitToken({
                supabase: getOptionalSupabaseAdmin(),
                key: `payments-status:${resolveClientIp(req, { env }) || 'unknown'}`,
                limit: Math.max(1, Number(env.PAYMENTS_STATUS_RATE_LIMIT_MAX || 60)),
                windowMs: Math.max(10_000, Number(env.PAYMENTS_STATUS_RATE_LIMIT_WINDOW_MS || 60_000))
            });
            applyRateLimitHeaders(res, rateLimit);
            if (!rateLimit.allowed) {
                return sendJson(res, 429, {
                    success: false,
                    code: 'rate_limited',
                    message: 'Too many payment status requests',
                    retry_after_seconds: rateLimit.retryAfterSeconds
                });
            }

            try {
                if (typeof getPaymentRequestStatus !== 'function') {
                    const unavailableError = new Error('支付状态查询能力暂未完成接入');
                    unavailableError.statusCode = 503;
                    throw unavailableError;
                }

                const { requestSupabase, adminSupabase, user } = await requireAuthenticatedUser(req);
                const body = await parseBody(req);
                const payload = await getPaymentRequestStatus({
                    supabase: adminSupabase || requestSupabase,
                    user,
                    body,
                    env
                });

                return sendJson(res, 200, payload);
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || '查询支付状态失败'
                });
            }
        },
        'mock/complete': async function paymentsMockCompleteHandler(req, res) {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }

            const rateLimit = await takeRateLimitToken({
                supabase: getOptionalSupabaseAdmin(),
                key: `payments-mock-complete:${resolveClientIp(req, { env }) || 'unknown'}`,
                limit: Math.max(1, Number(env.PAYMENTS_MOCK_COMPLETE_RATE_LIMIT_MAX || 10)),
                windowMs: Math.max(10_000, Number(env.PAYMENTS_MOCK_COMPLETE_RATE_LIMIT_WINDOW_MS || 60_000))
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
                const body = await parseBody(req);
                const payload = await completeMockPayment({
                    supabase: adminSupabase || supabase,
                    user,
                    body,
                    env,
                    requestHost: req.headers.host || req.headers.Host || ''
                });

                return sendJson(res, 200, payload);
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || '模拟支付失败'
                });
            }
        },
        'zpay/webhook': async function paymentsZpayWebhookHandler(req, res) {
            return zpayWebhookHandler(req, res);
        },
        'nowpayments/webhook': async function paymentsNowpaymentsWebhookHandler(req, res) {
            return nowpaymentsWebhookHandler(req, res);
        }
    };
}

module.exports = {
    createPaymentsHandlers
};
