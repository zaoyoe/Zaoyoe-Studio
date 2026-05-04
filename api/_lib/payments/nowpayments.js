const crypto = require('crypto');
const {
    rewriteManagedUrlForOrigin
} = require('./site-origins');

const NOWPAYMENTS_DEFAULT_API_BASE_URL = 'https://api.nowpayments.io';
const NOWPAYMENTS_INVOICE_PATH = '/v1/invoice';
const NOWPAYMENTS_PAYMENT_PATH = '/v1/payment';
const NOWPAYMENTS_DEFAULT_PAY_CURRENCY = 'usdtbsc';
const NOWPAYMENTS_DEFAULT_PRICE_CURRENCY = 'usd';
const NOWPAYMENTS_DEFAULT_CNY_TO_USD_RATE = 0.14;
const NOWPAYMENTS_DEFAULT_QUOTE_TTL_SECONDS = 300;

function sanitizeText(value, fallback = '', maxLength = 500) {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim();
    return normalized ? normalized.slice(0, maxLength) : fallback;
}

function normalizeUrl(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    const candidate = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
    return candidate.replace(/\/+$/, '');
}

function resolveNowpaymentsEndpointUrl(baseValue = '', path = '') {
    const normalizedBase = normalizeUrl(baseValue) || NOWPAYMENTS_DEFAULT_API_BASE_URL;
    const normalizedPath = String(path || '').trim() || '/';

    try {
        const parsed = new URL(normalizedBase);
        return `${parsed.origin}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
    } catch (_) {
        return `${NOWPAYMENTS_DEFAULT_API_BASE_URL}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
    }
}

function coerceBoolean(value, fallback = false) {
    if (value === true || value === false) return value;
    const normalized = String(value || '').trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function coercePositiveNumber(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function coercePositiveInteger(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function roundCurrencyAmount(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : fallback;
}

function roundUpCurrency(value, fallback = null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.ceil(parsed * 100) / 100;
}

function resolveCnyToUsdRate(channelConfig = {}, env = process.env) {
    const explicitRate = coercePositiveNumber(
        channelConfig.cny_to_usd_rate
        || channelConfig.cny_usd_rate
        || env?.NOWPAYMENTS_CNY_TO_USD_RATE,
        null
    );
    if (explicitRate) return explicitRate;

    const usdCnyRate = coercePositiveNumber(
        channelConfig.usd_to_cny_rate
        || channelConfig.usd_cny_rate
        || env?.NOWPAYMENTS_USD_CNY_RATE,
        null
    );
    if (usdCnyRate) return 1 / usdCnyRate;

    return NOWPAYMENTS_DEFAULT_CNY_TO_USD_RATE;
}

function normalizeCurrencyTicker(value, fallback) {
    return sanitizeText(value, fallback, 40).toLowerCase() || fallback;
}

function normalizeNowpaymentsConfig({
    channelConfig = {},
    secretValues = {},
    requestOrigin = '',
    env = process.env
} = {}) {
    const apiKey = sanitizeText(
        secretValues.nowpayments_api_key
        || channelConfig.api_key
        || env?.NOWPAYMENTS_API_KEY,
        '',
        300
    );
    const ipnSecret = sanitizeText(
        secretValues.nowpayments_ipn_secret
        || channelConfig.ipn_secret
        || env?.NOWPAYMENTS_IPN_SECRET,
        '',
        300
    );
    const apiBaseUrl = sanitizeText(
        channelConfig.api_base_url || env?.NOWPAYMENTS_API_BASE_URL,
        NOWPAYMENTS_DEFAULT_API_BASE_URL,
        500
    );
    const payCurrency = normalizeCurrencyTicker(
        channelConfig.pay_currency || env?.NOWPAYMENTS_PAY_CURRENCY,
        NOWPAYMENTS_DEFAULT_PAY_CURRENCY
    );
    const priceCurrency = normalizeCurrencyTicker(
        channelConfig.price_currency || env?.NOWPAYMENTS_PRICE_CURRENCY,
        NOWPAYMENTS_DEFAULT_PRICE_CURRENCY
    );
    const ipnCallbackUrl = rewriteManagedUrlForOrigin(
        channelConfig.ipn_callback_url || channelConfig.notify_url || env?.NOWPAYMENTS_IPN_CALLBACK_URL,
        requestOrigin,
        '/api/payments/nowpayments/webhook'
    );
    const successUrl = rewriteManagedUrlForOrigin(
        channelConfig.success_url || env?.NOWPAYMENTS_SUCCESS_URL,
        requestOrigin
    ) || normalizeUrl(requestOrigin);
    const cancelUrl = rewriteManagedUrlForOrigin(
        channelConfig.cancel_url || env?.NOWPAYMENTS_CANCEL_URL,
        requestOrigin
    ) || normalizeUrl(requestOrigin);
    const cnyToUsdRate = resolveCnyToUsdRate(channelConfig, env);
    const quoteTtlSeconds = Math.min(
        1800,
        Math.max(
            60,
            coercePositiveInteger(
                channelConfig.quote_ttl_seconds
                || channelConfig.fixed_rate_ttl_seconds
                || env?.NOWPAYMENTS_QUOTE_TTL_SECONDS,
                NOWPAYMENTS_DEFAULT_QUOTE_TTL_SECONDS
            )
        )
    );
    const missingFields = [];

    if (!apiKey) missingFields.push('api_key');
    if (!ipnSecret) missingFields.push('ipn_secret');
    if (!ipnCallbackUrl) missingFields.push('ipn_callback_url');
    if (priceCurrency === 'usd' && !cnyToUsdRate) missingFields.push('cny_to_usd_rate');

    return {
        apiKey,
        ipnSecret,
        apiBaseUrl,
        invoiceUrl: resolveNowpaymentsEndpointUrl(apiBaseUrl, NOWPAYMENTS_INVOICE_PATH),
        paymentUrl: resolveNowpaymentsEndpointUrl(apiBaseUrl, NOWPAYMENTS_PAYMENT_PATH),
        ipnCallbackUrl,
        successUrl,
        cancelUrl,
        payCurrency,
        priceCurrency,
        cnyToUsdRate,
        quoteTtlSeconds,
        isFixedRate: coerceBoolean(channelConfig.is_fixed_rate, true),
        isFeePaidByUser: coerceBoolean(channelConfig.is_fee_paid_by_user, true),
        missingFields,
        createReady: missingFields.length === 0
    };
}

function resolveNowpaymentsPaymentEstimateUrl(apiBaseUrl = '', paymentId = '') {
    const normalizedPaymentId = encodeURIComponent(String(paymentId || '').trim());
    if (!normalizedPaymentId) return '';
    return resolveNowpaymentsEndpointUrl(
        apiBaseUrl,
        `/v1/payment/${normalizedPaymentId}/update-merchant-estimate`
    );
}

function buildNowpaymentsOrderId(checkoutSessionKey = '') {
    const digest = crypto
        .createHash('sha1')
        .update(String(checkoutSessionKey || '').trim() || crypto.randomBytes(8))
        .digest('hex')
        .slice(0, 30)
        .toUpperCase();

    return `NP${digest}`.slice(0, 32);
}

function convertCnyAmountToPriceAmount(localAmount, config = {}) {
    const normalizedAmount = roundCurrencyAmount(localAmount, 0);
    if (!(normalizedAmount > 0)) {
        throw new Error('NOWPayments 订单金额无效');
    }

    const priceCurrency = normalizeCurrencyTicker(config.priceCurrency, NOWPAYMENTS_DEFAULT_PRICE_CURRENCY);
    if (priceCurrency === 'usd') {
        return roundUpCurrency(normalizedAmount * Number(config.cnyToUsdRate || 0), null);
    }

    return roundUpCurrency(normalizedAmount, null);
}

function normalizeNowpaymentsPaymentStatus(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'finished') return 'paid';
    if (normalized === 'partially_paid') return 'partially_paid';
    if (normalized === 'wrong_asset_confirmed') return 'wrong_asset';
    if (['waiting', 'confirming', 'confirmed', 'sending'].includes(normalized)) return 'pending';
    if (['failed', 'expired', 'cancelled', 'refunded'].includes(normalized)) return normalized;
    return normalized || 'unknown';
}

function sortObject(value) {
    if (Array.isArray(value)) {
        return value.map((item) => sortObject(item));
    }
    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => {
                result[key] = sortObject(value[key]);
                return result;
            }, {});
    }
    return value;
}

function buildNowpaymentsIpnSignature(payload = {}, ipnSecret = '') {
    const normalizedSecret = String(ipnSecret || '').trim();
    if (!normalizedSecret) {
        throw new Error('NOWPayments IPN Secret 未配置');
    }

    return crypto
        .createHmac('sha512', normalizedSecret)
        .update(JSON.stringify(sortObject(payload || {})))
        .digest('hex');
}

function verifyNowpaymentsIpnSignature(payload = {}, ipnSecret = '', receivedSignature = '') {
    const normalizedReceivedSignature = String(receivedSignature || '').trim().toLowerCase();
    if (!normalizedReceivedSignature) {
        return {
            valid: false,
            expectedSignature: '',
            receivedSignature: '',
            reason: 'missing_signature'
        };
    }

    const expectedSignature = buildNowpaymentsIpnSignature(payload, ipnSecret);
    return {
        valid: expectedSignature === normalizedReceivedSignature,
        expectedSignature,
        receivedSignature: normalizedReceivedSignature,
        reason: expectedSignature === normalizedReceivedSignature ? '' : 'signature_mismatch'
    };
}

async function requestNowpaymentsJson(url, payload, {
    apiKey = '',
    fetchImpl = globalThis.fetch,
    method = 'POST'
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('fetch is unavailable in this runtime');
    }

    const normalizedMethod = String(method || 'POST').trim().toUpperCase() || 'POST';
    const headers = {
        'x-api-key': String(apiKey || '').trim(),
        'Content-Type': 'application/json'
    };

    let response;
    try {
        response = await fetchImpl(String(url || '').trim(), {
            method: normalizedMethod,
            headers,
            body: normalizedMethod === 'GET' ? undefined : JSON.stringify(payload || {})
        });
    } catch (error) {
        const wrappedError = new Error('NOWPayments 网关请求失败，请稍后重试');
        wrappedError.cause = error;
        throw wrappedError;
    }

    const text = await response.text();
    let data = null;

    try {
        data = JSON.parse(text);
    } catch (_) {
        data = null;
    }

    return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        text,
        data
    };
}

async function createNowpaymentsInvoice(options = {}, dependencies = {}) {
    const config = normalizeNowpaymentsConfig(options);
    if (!config.createReady) {
        throw new Error(`NOWPayments 配置不完整，缺少：${config.missingFields.join(', ') || 'unknown'}`);
    }

    const payload = {
        price_amount: String(options.priceAmount),
        price_currency: config.priceCurrency,
        pay_currency: config.payCurrency,
        ipn_callback_url: config.ipnCallbackUrl,
        order_id: String(options.orderId || '').trim(),
        order_description: sanitizeText(options.orderDescription, 'Zaoyoe digital credits', 240),
        success_url: config.successUrl,
        cancel_url: config.cancelUrl,
        is_fixed_rate: config.isFixedRate,
        is_fee_paid_by_user: config.isFeePaidByUser
    };
    const response = await requestNowpaymentsJson(config.invoiceUrl, payload, {
        ...dependencies,
        apiKey: config.apiKey
    });

    if (!response.data || typeof response.data !== 'object') {
        throw new Error(`NOWPayments 下单返回非 JSON：HTTP ${response.status}`);
    }
    if (!response.ok) {
        throw new Error(
            sanitizeText(response.data.message || response.data.error, '', 240)
            || `NOWPayments 下单失败：HTTP ${response.status}`
        );
    }

    return {
        config,
        requestPayload: payload,
        response
    };
}

async function createNowpaymentsPayment(options = {}, dependencies = {}) {
    const config = normalizeNowpaymentsConfig(options);
    if (!config.createReady) {
        throw new Error(`NOWPayments 配置不完整，缺少：${config.missingFields.join(', ') || 'unknown'}`);
    }

    const payload = {
        price_amount: String(options.priceAmount),
        price_currency: config.priceCurrency,
        pay_currency: config.payCurrency,
        ipn_callback_url: config.ipnCallbackUrl,
        order_id: String(options.orderId || '').trim(),
        order_description: sanitizeText(options.orderDescription, 'Zaoyoe digital credits', 240),
        is_fixed_rate: config.isFixedRate,
        is_fee_paid_by_user: config.isFeePaidByUser
    };
    const response = await requestNowpaymentsJson(config.paymentUrl, payload, {
        ...dependencies,
        apiKey: config.apiKey
    });

    if (!response.data || typeof response.data !== 'object') {
        throw new Error(`NOWPayments 下单返回非 JSON：HTTP ${response.status}`);
    }
    if (!response.ok) {
        throw new Error(
            sanitizeText(response.data.message || response.data.error, '', 240)
            || `NOWPayments 下单失败：HTTP ${response.status}`
        );
    }

    return {
        config,
        requestPayload: payload,
        response
    };
}

async function updateNowpaymentsPaymentEstimate(options = {}, dependencies = {}) {
    const config = normalizeNowpaymentsConfig(options);
    if (!config.createReady) {
        throw new Error(`NOWPayments 配置不完整，缺少：${config.missingFields.join(', ') || 'unknown'}`);
    }

    const paymentId = sanitizeText(options.paymentId, '', 120);
    const estimateUrl = resolveNowpaymentsPaymentEstimateUrl(config.apiBaseUrl, paymentId);
    if (!estimateUrl) {
        throw new Error('NOWPayments 支付单号缺失，无法更新报价倒计时');
    }

    const response = await requestNowpaymentsJson(estimateUrl, {}, {
        ...dependencies,
        apiKey: config.apiKey
    });

    if (!response.data || typeof response.data !== 'object') {
        throw new Error(`NOWPayments 更新报价返回非 JSON：HTTP ${response.status}`);
    }
    if (!response.ok) {
        throw new Error(
            sanitizeText(response.data.message || response.data.error, '', 240)
            || `NOWPayments 更新报价失败：HTTP ${response.status}`
        );
    }

    return {
        config,
        requestPayload: {},
        response
    };
}

module.exports = {
    NOWPAYMENTS_DEFAULT_API_BASE_URL,
    NOWPAYMENTS_DEFAULT_CNY_TO_USD_RATE,
    NOWPAYMENTS_DEFAULT_PAY_CURRENCY,
    NOWPAYMENTS_DEFAULT_PRICE_CURRENCY,
    NOWPAYMENTS_DEFAULT_QUOTE_TTL_SECONDS,
    buildNowpaymentsIpnSignature,
    buildNowpaymentsOrderId,
    convertCnyAmountToPriceAmount,
    createNowpaymentsInvoice,
    createNowpaymentsPayment,
    normalizeNowpaymentsConfig,
    normalizeNowpaymentsPaymentStatus,
    requestNowpaymentsJson,
    resolveNowpaymentsPaymentEstimateUrl,
    sortObject,
    updateNowpaymentsPaymentEstimate,
    verifyNowpaymentsIpnSignature
};
