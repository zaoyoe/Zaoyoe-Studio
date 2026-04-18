const crypto = require('crypto');

const ZPAY_DEFAULT_BASE_URL = 'https://zpayz.cn';
const ZPAY_SUBMIT_PATH = '/submit.php';
const ZPAY_MAPI_PATH = '/mapi.php';
const ZPAY_API_PATH = '/api.php';
const ZPAY_SIGN_TYPE = 'MD5';
const ZPAY_PARAM_PREFIX = 'zp1';

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

function resolveZpayEndpointUrl(baseValue = '', path = '') {
    const normalizedBase = normalizeUrl(baseValue) || ZPAY_DEFAULT_BASE_URL;
    const normalizedPath = String(path || '').trim() || '/';

    try {
        const parsed = new URL(normalizedBase);
        return `${parsed.origin}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
    } catch (_) {
        return `${ZPAY_DEFAULT_BASE_URL}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
    }
}

function encodeBase64Url(value) {
    return Buffer.from(String(value || ''), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function decodeBase64Url(value) {
    const normalized = String(value || '').trim().replace(/-/g, '+').replace(/_/g, '/');
    if (!normalized) return '';
    const padding = normalized.length % 4 === 0
        ? ''
        : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

function normalizeZpayName(value = '', fallback = '站内积分充值') {
    const normalized = String(value || '').trim();
    return (normalized || fallback).replace(/\s+/g, ' ').slice(0, 100) || fallback;
}

function normalizeAmount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('易支付订单金额无效');
    }

    return parsed.toFixed(2);
}

function normalizeZpayPaymentType(value = '', fallback = 'alipay') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'wxpay' || normalized === 'wechat') return 'wxpay';
    if (normalized === 'alipay') return 'alipay';
    return fallback;
}

function normalizeClientIp(value = '', fallback = '127.0.0.1') {
    const normalized = String(value || '')
        .split(',')[0]
        .trim()
        .replace(/^::ffff:/i, '');

    return normalized || fallback;
}

function normalizeZpayDevice(userAgent = '', explicitValue = '') {
    const normalizedExplicit = String(explicitValue || '').trim().toLowerCase();
    if (normalizedExplicit === 'pc' || normalizedExplicit === 'mobile') {
        return normalizedExplicit;
    }

    const normalizedUa = String(userAgent || '').trim().toLowerCase();
    if (!normalizedUa) return 'pc';

    if (
        /android|iphone|ipad|ipod|mobile|micromessenger|wechat|harmonyos/.test(normalizedUa)
    ) {
        return 'mobile';
    }

    return 'pc';
}

function normalizeSignSource(payload = {}) {
    const result = {};

    Object.keys(payload || {})
        .sort((left, right) => left.localeCompare(right))
        .forEach((key) => {
            if (key === 'sign' || key === 'sign_type') return;
            const value = payload[key];
            if (value === null || value === undefined || value === '') return;
            result[key] = String(value);
        });

    return result;
}

function buildZpaySign(payload = {}, key = '') {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
        throw new Error('易支付商户密钥未配置');
    }

    const normalizedPayload = normalizeSignSource(payload);
    const canonical = Object.entries(normalizedPayload)
        .map(([field, value]) => `${field}=${value}`)
        .join('&');

    return crypto
        .createHash('md5')
        .update(`${canonical}${normalizedKey}`)
        .digest('hex');
}

function verifyZpaySign(payload = {}, key = '', receivedSign = '') {
    const remoteSign = String(receivedSign || payload?.sign || '').trim().toLowerCase();
    if (!remoteSign) {
        return {
            valid: false,
            expectedSign: '',
            receivedSign: ''
        };
    }

    const expectedSign = buildZpaySign(payload, key);
    return {
        valid: expectedSign === remoteSign,
        expectedSign,
        receivedSign: remoteSign
    };
}

function buildZpayOutTradeNo(checkoutSessionKey = '') {
    const digest = crypto
        .createHash('sha1')
        .update(String(checkoutSessionKey || '').trim() || crypto.randomBytes(8))
        .digest('hex')
        .slice(0, 30)
        .toUpperCase();

    return `ZP${digest}`.slice(0, 32);
}

function buildZpayParam(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return '';
    }

    return `${ZPAY_PARAM_PREFIX}.${encodeBase64Url(JSON.stringify(value))}`;
}

function parseZpayParam(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) return {};

    if (normalized.startsWith(`${ZPAY_PARAM_PREFIX}.`)) {
        const encoded = normalized.slice(ZPAY_PARAM_PREFIX.length + 1);
        try {
            const parsed = JSON.parse(decodeBase64Url(encoded));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch (_) {
            return {
                raw: normalized
            };
        }
    }

    try {
        const parsed = JSON.parse(normalized);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch (_) {
        // fall through
    }

    return {
        raw: normalized
    };
}

function normalizeZpayPaymentStatus(tradeStatus = '', status = null) {
    const normalizedTradeStatus = String(tradeStatus || '').trim().toUpperCase();
    if (normalizedTradeStatus === 'TRADE_SUCCESS') {
        return 'paid';
    }
    if (normalizedTradeStatus === 'REFUNDED') {
        return 'refunded';
    }
    if (normalizedTradeStatus) {
        return 'pending';
    }

    const numericStatus = Number(status);
    if (numericStatus === 1) return 'paid';
    if (numericStatus === 0) return 'pending';
    if (numericStatus === 2) return 'refunded';
    return 'unknown';
}

function normalizeZpayConfig({
    channelConfig = {},
    secretValues = {},
    requestOrigin = ''
} = {}) {
    const pid = sanitizeText(
        channelConfig.pid || channelConfig.merchant_id,
        '',
        64
    );
    const pkey = sanitizeText(
        secretValues.zpay_pkey || channelConfig.pkey || channelConfig.key,
        '',
        200
    );
    const baseSeed = sanitizeText(
        channelConfig.gateway_url || channelConfig.base_url || channelConfig.checkout_url,
        '',
        500
    );
    const notifyUrl = normalizeUrl(channelConfig.notify_url);
    const returnUrl = normalizeUrl(channelConfig.return_url || requestOrigin);
    const paymentType = normalizeZpayPaymentType(
        channelConfig.payment_type || channelConfig.default_type,
        'alipay'
    );
    const channelIds = sanitizeText(channelConfig.channel_ids || channelConfig.cid, '', 255);
    const missingFields = [];

    if (!pid) missingFields.push('pid');
    if (!pkey) missingFields.push('pkey');
    if (!notifyUrl) missingFields.push('notify_url');

    return {
        pid,
        pkey,
        submitUrl: resolveZpayEndpointUrl(baseSeed, ZPAY_SUBMIT_PATH),
        mapiUrl: resolveZpayEndpointUrl(baseSeed, ZPAY_MAPI_PATH),
        apiUrl: resolveZpayEndpointUrl(baseSeed, ZPAY_API_PATH),
        refundUrl: resolveZpayEndpointUrl(baseSeed, ZPAY_API_PATH),
        notifyUrl,
        returnUrl: returnUrl || normalizeUrl(requestOrigin) || ZPAY_DEFAULT_BASE_URL,
        paymentType,
        channelIds,
        missingFields,
        createReady: missingFields.length === 0
    };
}

function buildZpayMapiPayload({
    config,
    outTradeNo,
    amount,
    name,
    clientIp,
    device = 'pc',
    param = ''
} = {}) {
    if (!config?.createReady) {
        throw new Error(`易支付配置不完整，缺少：${(config?.missingFields || []).join(', ') || 'unknown'}`);
    }

    const payload = {
        pid: config.pid,
        type: normalizeZpayPaymentType(config.paymentType, 'alipay'),
        out_trade_no: String(outTradeNo || '').trim() || buildZpayOutTradeNo(''),
        notify_url: config.notifyUrl,
        return_url: config.returnUrl,
        name: normalizeZpayName(name),
        money: normalizeAmount(amount),
        clientip: normalizeClientIp(clientIp),
        device: normalizeZpayDevice('', device),
        sign_type: ZPAY_SIGN_TYPE
    };

    const normalizedChannelIds = sanitizeText(config.channelIds, '', 255);
    const normalizedParam = String(param || '').trim();
    if (normalizedChannelIds) {
        payload.cid = normalizedChannelIds;
    }
    if (normalizedParam) {
        payload.param = normalizedParam;
    }

    payload.sign = buildZpaySign(payload, config.pkey);
    return payload;
}

function buildZpayOrderQueryPayload({
    config,
    outTradeNo = '',
    tradeNo = ''
} = {}) {
    if (!config?.pid || !config?.pkey) {
        throw new Error('易支付查单配置不完整');
    }

    const normalizedOutTradeNo = String(outTradeNo || '').trim();
    const normalizedTradeNo = String(tradeNo || '').trim();
    if (!normalizedOutTradeNo && !normalizedTradeNo) {
        throw new Error('易支付查单至少需要 out_trade_no 或 trade_no');
    }

    const payload = {
        act: 'order',
        pid: config.pid,
        key: config.pkey
    };

    if (normalizedOutTradeNo) {
        payload.out_trade_no = normalizedOutTradeNo;
    } else if (normalizedTradeNo) {
        payload.trade_no = normalizedTradeNo;
    }

    return payload;
}

function buildZpayRefundPayload({
    config,
    outTradeNo = '',
    tradeNo = '',
    money
} = {}) {
    if (!config?.pid || !config?.pkey) {
        throw new Error('易支付退款配置不完整');
    }

    const normalizedOutTradeNo = String(outTradeNo || '').trim();
    const normalizedTradeNo = String(tradeNo || '').trim();
    if (!normalizedOutTradeNo && !normalizedTradeNo) {
        throw new Error('易支付退款至少需要 out_trade_no 或 trade_no');
    }

    const payload = {
        act: 'refund',
        pid: config.pid,
        key: config.pkey,
        money: normalizeAmount(money)
    };

    if (normalizedOutTradeNo) {
        payload.out_trade_no = normalizedOutTradeNo;
    } else if (normalizedTradeNo) {
        payload.trade_no = normalizedTradeNo;
    }

    return payload;
}

async function requestZpayJson(url, payload, {
    fetchImpl = globalThis.fetch,
    method = 'POST'
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('fetch is unavailable in this runtime');
    }

    const normalizedMethod = String(method || 'POST').trim().toUpperCase() || 'POST';
    const searchParams = new URLSearchParams();
    Object.entries(payload || {}).forEach(([key, value]) => {
        if (value === null || value === undefined) return;
        searchParams.append(key, String(value));
    });

    let response;
    try {
        response = await fetchImpl(
            normalizedMethod === 'GET'
                ? `${String(url || '').trim()}?${searchParams.toString()}`
                : String(url || '').trim(),
            normalizedMethod === 'GET'
                ? {
                    method: 'GET'
                }
                : {
                    method: normalizedMethod,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
                    },
                    body: searchParams.toString()
                }
        );
    } catch (error) {
        const wrappedError = new Error('易支付网关请求失败，请稍后重试');
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

async function createZpayPayment(options = {}, dependencies = {}) {
    const config = normalizeZpayConfig(options);
    const payload = buildZpayMapiPayload({
        config,
        outTradeNo: options.outTradeNo,
        amount: options.amount,
        name: options.name,
        clientIp: options.clientIp,
        device: options.device,
        param: options.param
    });
    const response = await requestZpayJson(config.mapiUrl, payload, dependencies);

    if (!response.data || typeof response.data !== 'object') {
        throw new Error(`易支付下单返回非 JSON：HTTP ${response.status}`);
    }

    return {
        config,
        requestPayload: payload,
        response
    };
}

async function queryZpayPayment(options = {}, dependencies = {}) {
    const config = normalizeZpayConfig(options);
    const payload = buildZpayOrderQueryPayload({
        config,
        outTradeNo: options.outTradeNo,
        tradeNo: options.tradeNo
    });
    const response = await requestZpayJson(config.apiUrl, payload, {
        ...dependencies,
        method: 'GET'
    });

    if (!response.data || typeof response.data !== 'object') {
        throw new Error(`易支付查单返回非 JSON：HTTP ${response.status}`);
    }

    return {
        config,
        requestPayload: payload,
        response
    };
}

async function refundZpayPayment(options = {}, dependencies = {}) {
    const config = normalizeZpayConfig(options);
    const payload = buildZpayRefundPayload({
        config,
        outTradeNo: options.outTradeNo,
        tradeNo: options.tradeNo,
        money: options.money
    });
    const response = await requestZpayJson(config.refundUrl, payload, dependencies);

    if (!response.data || typeof response.data !== 'object') {
        const rawText = String(response.text || '').trim();
        if (!rawText) {
            throw new Error('易支付退款接口返回空响应，请先到易支付后台确认是否已退款，避免重复提交');
        }
        throw new Error(`易支付退款返回非 JSON：HTTP ${response.status}`);
    }

    return {
        config,
        requestPayload: payload,
        response
    };
}

module.exports = {
    ZPAY_API_PATH,
    ZPAY_DEFAULT_BASE_URL,
    ZPAY_MAPI_PATH,
    ZPAY_PARAM_PREFIX,
    ZPAY_SIGN_TYPE,
    ZPAY_SUBMIT_PATH,
    buildZpayMapiPayload,
    buildZpayOrderQueryPayload,
    buildZpayOutTradeNo,
    buildZpayParam,
    buildZpayRefundPayload,
    buildZpaySign,
    createZpayPayment,
    normalizeZpayConfig,
    normalizeZpayDevice,
    normalizeZpayPaymentStatus,
    normalizeZpayPaymentType,
    parseZpayParam,
    queryZpayPayment,
    refundZpayPayment,
    requestZpayJson,
    resolveZpayEndpointUrl,
    verifyZpaySign
};
