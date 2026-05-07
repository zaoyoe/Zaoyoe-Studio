const {
    createZpayWebhookHandler
} = require('../../../api/_lib/payments/zpay-webhook');
const {
    createNowpaymentsWebhookHandler
} = require('../../../api/_lib/payments/nowpayments-webhook');

const PAYMENT_CREATION_ERROR_PATTERNS = Object.freeze([
    {
        code: 'payment_amount_too_small',
        pattern: /amount\s*to\s+is\s+too\s+small|amountto\s+is\s+too\s+small|amount(?:\s+\w+)?\s+is\s+too\s+small|amount\s+too\s+small|min(?:imum)?[_\s-]*amount|below\s+minimum|less\s+than\s+(?:the\s+)?minimum|金额(?:过低|太低|低于)|低于.*最低/i
    },
    {
        code: 'payment_amount_too_large',
        pattern: /amount(?:\s+\w+)?\s+is\s+too\s+large|amount\s+too\s+large|max(?:imum)?[_\s-]*amount|above\s+maximum|exceeds\s+(?:the\s+)?maximum|金额(?:过高|太高|超出|超过)/i
    },
    {
        code: 'payment_invalid_amount',
        pattern: /invalid\s+amount|amount\s+invalid|invalid\s+price|price_amount|pay_amount|订单金额无效|支付金额无效|金额无效|汇率配置无效/i
    },
    {
        code: 'payment_currency_unsupported',
        pattern: /unsupported\s+(?:currency|coin|network)|(?:currency|coin|network)\s+(?:is\s+)?not\s+supported|pay_currency|price_currency|币种.*不支持|网络.*不支持|当前币种|当前网络/i
    },
    {
        code: 'payment_gateway_config',
        pattern: /config(?:uration)?\s+(?:missing|invalid|incomplete)|api\s*key|ipn|webhook|secret|配置不完整|缺少|未配置|密钥/i
    },
    {
        code: 'payment_gateway_unavailable',
        pattern: /service\s+unavailable|bad\s+gateway|gateway\s+timeout|temporarily\s+unavailable|timeout|rate\s+limit|too\s+many\s+requests|暂时无法|稍后重试|通道.*不可用|网关.*异常/i
    }
]);

function classifyPaymentCreationErrorMessage(message = '') {
    const rawMessage = String(message || '').trim();
    if (!rawMessage) return '';

    const match = PAYMENT_CREATION_ERROR_PATTERNS.find((item) => item.pattern.test(rawMessage));
    return match?.code || '';
}

function isStablePaymentCreationErrorCode(code = '') {
    const normalizedCode = String(code || '').trim();
    return normalizedCode === 'rate_limited' || normalizedCode.startsWith('payment_');
}

function normalizePaymentCreationError(error, fallbackMessage = '创建支付请求失败') {
    const rawMessage = String(error?.message || '').trim();
    const rawCode = String(error?.code || '').trim();
    const code = classifyPaymentCreationErrorMessage(rawMessage)
        || (isStablePaymentCreationErrorCode(rawCode) ? rawCode : '')
        || 'payment_create_failed';
    const message = rawMessage || fallbackMessage;

    return {
        code,
        message,
        raw_message: rawMessage || null,
        payment_error: {
            code,
            raw_message: rawMessage || null
        }
    };
}

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
                    ...normalizePaymentCreationError(error, '创建支付请求失败')
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
    __testUtils: {
        classifyPaymentCreationErrorMessage,
        isStablePaymentCreationErrorCode,
        normalizePaymentCreationError
    },
    createPaymentsHandlers
};
