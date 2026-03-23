const crypto = require('crypto');

const HUPIJIAO_DEFAULT_BASE_URL = 'https://api.xunhupay.com';
const HUPIJIAO_PAYMENT_PATH = '/payment/do.html';
const HUPIJIAO_QUERY_PATH = '/payment/query.html';
const HUPIJIAO_REFUND_PATH = '/payment/refund.html';
const HUPIJIAO_PLUGIN_ID = 'zaoyoe-node-adapter';
const HUPIJIAO_API_VERSION = '1.1';
const HUPIJIAO_STATUS_LABELS = Object.freeze({
    OD: 'paid',
    CD: 'refunded',
    RD: 'refund_pending',
    UD: 'refund_failed'
});

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

function resolveHupijiaoEndpointUrl(gatewayValue = '', path = HUPIJIAO_PAYMENT_PATH) {
    const normalizedGateway = normalizeUrl(gatewayValue);
    const normalizedPath = String(path || HUPIJIAO_PAYMENT_PATH).trim() || HUPIJIAO_PAYMENT_PATH;

    if (!normalizedGateway) {
        return `${HUPIJIAO_DEFAULT_BASE_URL}${normalizedPath}`;
    }

    try {
        const parsed = new URL(normalizedGateway);
        if (parsed.pathname.endsWith('.html')) {
            return `${parsed.origin}${normalizedPath}`;
        }
        return `${parsed.origin}${normalizedPath}`;
    } catch (_) {
        return `${HUPIJIAO_DEFAULT_BASE_URL}${normalizedPath}`;
    }
}

function sanitizeHupijiaoTitle(value = '', fallback = '充值订单') {
    const normalized = String(value || '').trim();
    const base = normalized || fallback;
    return base
        .replace(/%/g, '')
        .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
        .trim()
        .slice(0, 127) || fallback;
}

function stringifyAttachValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    try {
        return JSON.stringify(value);
    } catch (_) {
        return String(value || '').trim();
    }
}

function parseHupijiaoAttach(value = '') {
    const normalized = stringifyAttachValue(value);
    if (!normalized) {
        return {};
    }

    try {
        const parsed = JSON.parse(normalized);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch (_) {
        // Fall through to the raw fallback below.
    }

    return {
        raw: normalized
    };
}

function normalizeHashSource(payload = {}) {
    const result = {};

    Object.keys(payload || {})
        .sort((left, right) => left.localeCompare(right))
        .forEach((key) => {
            if (key === 'hash' || key === 'sign') return;
            const value = payload[key];
            if (value === null || value === undefined || value === '') return;
            result[key] = String(value);
        });

    return result;
}

function buildHupijiaoHash(payload = {}, secret = '') {
    const normalizedSecret = String(secret || '').trim();
    if (!normalizedSecret) {
        throw new Error('虎皮椒签名密钥未配置');
    }

    const normalizedPayload = normalizeHashSource(payload);
    const canonical = Object.entries(normalizedPayload)
        .map(([key, value]) => `${key}=${value}`)
        .join('&');

    return crypto
        .createHash('md5')
        .update(`${canonical}${normalizedSecret}`)
        .digest('hex');
}

function verifyHupijiaoHash(payload = {}, secret = '', receivedHash = '') {
    const remoteHash = String(receivedHash || payload?.hash || payload?.sign || '').trim().toLowerCase();
    if (!remoteHash) {
        return {
            valid: false,
            expectedHash: '',
            receivedHash: ''
        };
    }

    const expectedHash = buildHupijiaoHash(payload, secret);
    return {
        valid: expectedHash === remoteHash,
        expectedHash,
        receivedHash: remoteHash
    };
}

function normalizeHupijiaoPaymentStatus(status = '') {
    const normalized = String(status || '').trim().toUpperCase();
    return HUPIJIAO_STATUS_LABELS[normalized] || (normalized ? 'pending' : 'unknown');
}

function getHupijiaoGatewayOrderId(payload = {}) {
    return sanitizeText(
        payload?.open_order_id || payload?.openid || payload?.orderid,
        '',
        120
    );
}

function buildHupijiaoTradeOrderId(checkoutSessionKey = '') {
    const normalizedKey = String(checkoutSessionKey || '').trim();
    const digest = crypto
        .createHash('sha1')
        .update(normalizedKey || crypto.randomBytes(8))
        .digest('hex')
        .slice(0, 26)
        .toUpperCase();

    return `HJ_${digest}`;
}

function buildNonceString(length = 16) {
    return crypto.randomBytes(Math.max(8, Math.ceil(length / 2)))
        .toString('hex')
        .slice(0, Math.max(8, length));
}

function normalizeAmount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('虎皮椒订单金额无效');
    }

    return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2);
}

function normalizeHupijiaoConfig({
    channelConfig = {},
    secretValues = {},
    requestOrigin = ''
} = {}) {
    const appId = sanitizeText(
        channelConfig.appid || channelConfig.app_id || channelConfig.merchant_id,
        '',
        64
    );
    const appSecret = sanitizeText(
        secretValues.hupijiao_secret_key || channelConfig.app_secret || channelConfig.secret_key,
        '',
        200
    );
    const gatewaySeed = sanitizeText(
        channelConfig.gateway_url || channelConfig.checkout_url,
        '',
        500
    );
    const notifyUrl = normalizeUrl(channelConfig.notify_url);
    const returnUrl = normalizeUrl(channelConfig.return_url || requestOrigin);
    const callbackUrl = normalizeUrl(channelConfig.callback_url || returnUrl || requestOrigin);
    const pluginId = sanitizeText(channelConfig.plugins || channelConfig.plugin_id, HUPIJIAO_PLUGIN_ID, 120);
    const missingFields = [];

    if (!appId) missingFields.push('appid');
    if (!appSecret) missingFields.push('appsecret');
    if (!notifyUrl) missingFields.push('notify_url');

    return {
        appId,
        appSecret,
        paymentUrl: resolveHupijiaoEndpointUrl(gatewaySeed, HUPIJIAO_PAYMENT_PATH),
        queryUrl: resolveHupijiaoEndpointUrl(gatewaySeed, HUPIJIAO_QUERY_PATH),
        refundUrl: resolveHupijiaoEndpointUrl(gatewaySeed, HUPIJIAO_REFUND_PATH),
        notifyUrl,
        returnUrl,
        callbackUrl,
        pluginId,
        missingFields,
        createReady: missingFields.length === 0
    };
}

function buildHupijiaoPaymentPayload({
    config,
    tradeOrderId,
    amount,
    title,
    attach = '',
    now = Date.now()
} = {}) {
    if (!config?.createReady) {
        throw new Error(`虎皮椒配置不完整，缺少：${(config?.missingFields || []).join(', ') || 'unknown'}`);
    }

    const payload = {
        version: HUPIJIAO_API_VERSION,
        appid: config.appId,
        trade_order_id: String(tradeOrderId || '').trim() || buildHupijiaoTradeOrderId(''),
        total_fee: normalizeAmount(amount),
        title: sanitizeHupijiaoTitle(title),
        time: Math.floor(Number(now) / 1000),
        notify_url: config.notifyUrl,
        nonce_str: buildNonceString(24),
        plugins: config.pluginId
    };

    if (config.returnUrl) {
        payload.return_url = config.returnUrl;
    }
    if (config.callbackUrl) {
        payload.callback_url = config.callbackUrl;
    }

    const normalizedAttach = stringifyAttachValue(attach);
    if (normalizedAttach) {
        payload.attach = normalizedAttach;
    }

    payload.hash = buildHupijiaoHash(payload, config.appSecret);
    return payload;
}

function buildHupijiaoQueryPayload({
    config,
    tradeOrderId = '',
    openOrderId = '',
    now = Date.now()
} = {}) {
    const normalizedTradeOrderId = String(tradeOrderId || '').trim();
    const normalizedOpenOrderId = String(openOrderId || '').trim();

    if (!config?.appId || !config?.appSecret) {
        throw new Error('虎皮椒查询配置不完整');
    }
    if (!normalizedTradeOrderId && !normalizedOpenOrderId) {
        throw new Error('虎皮椒查单至少需要 trade_order_id 或 open_order_id');
    }

    const payload = {
        appid: config.appId,
        time: Math.floor(Number(now) / 1000),
        nonce_str: buildNonceString(24)
    };
    if (normalizedTradeOrderId) {
        payload.out_trade_order = normalizedTradeOrderId;
    }
    if (normalizedOpenOrderId) {
        payload.open_order_id = normalizedOpenOrderId;
    }

    payload.hash = buildHupijiaoHash(payload, config.appSecret);
    return payload;
}

function buildHupijiaoRefundPayload({
    config,
    tradeOrderId = '',
    openOrderId = '',
    reason = '',
    now = Date.now()
} = {}) {
    const normalizedTradeOrderId = String(tradeOrderId || '').trim();
    const normalizedOpenOrderId = String(openOrderId || '').trim();

    if (!config?.appId || !config?.appSecret) {
        throw new Error('虎皮椒退款配置不完整');
    }
    if (!normalizedTradeOrderId && !normalizedOpenOrderId) {
        throw new Error('虎皮椒退款至少需要 trade_order_id 或 open_order_id');
    }

    const payload = {
        appid: config.appId,
        time: Math.floor(Number(now) / 1000),
        nonce_str: buildNonceString(24)
    };
    if (normalizedTradeOrderId) {
        payload.trade_order_id = normalizedTradeOrderId;
    }
    if (normalizedOpenOrderId) {
        payload.open_order_id = normalizedOpenOrderId;
    }
    const normalizedReason = sanitizeText(reason, '', 80);
    if (normalizedReason) {
        payload.reason = normalizedReason;
    }

    payload.hash = buildHupijiaoHash(payload, config.appSecret);
    return payload;
}

async function requestHupijiaoJson(url, payload, {
    fetchImpl = globalThis.fetch
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('fetch is unavailable in this runtime');
    }

    const body = new URLSearchParams();
    Object.entries(payload || {}).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') return;
        body.set(key, String(value));
    });

    const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            accept: 'application/json,text/plain,*/*'
        },
        body: body.toString()
    });

    const text = await response.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
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

async function createHupijiaoPayment(options = {}, dependencies = {}) {
    const config = normalizeHupijiaoConfig(options);
    const payload = buildHupijiaoPaymentPayload({
        config,
        tradeOrderId: options.tradeOrderId,
        amount: options.amount,
        title: options.title,
        attach: options.attach,
        now: options.now
    });
    const response = await requestHupijiaoJson(config.paymentUrl, payload, dependencies);

    if (!response.data || typeof response.data !== 'object') {
        throw new Error(`虎皮椒下单返回非 JSON：HTTP ${response.status}`);
    }

    const verification = verifyHupijiaoHash(response.data, config.appSecret);
    if (response.data.hash && !verification.valid) {
        throw new Error('虎皮椒下单响应签名校验失败');
    }

    return {
        config,
        requestPayload: payload,
        response,
        verification
    };
}

async function queryHupijiaoPayment(options = {}, dependencies = {}) {
    const config = normalizeHupijiaoConfig(options);
    const payload = buildHupijiaoQueryPayload({
        config,
        tradeOrderId: options.tradeOrderId,
        openOrderId: options.openOrderId,
        now: options.now
    });
    const response = await requestHupijiaoJson(config.queryUrl, payload, dependencies);

    if (!response.data || typeof response.data !== 'object') {
        throw new Error(`虎皮椒查单返回非 JSON：HTTP ${response.status}`);
    }

    const verification = verifyHupijiaoHash(response.data, config.appSecret);
    if (response.data.hash && !verification.valid) {
        throw new Error('虎皮椒查单响应签名校验失败');
    }

    return {
        config,
        requestPayload: payload,
        response,
        verification
    };
}

async function refundHupijiaoPayment(options = {}, dependencies = {}) {
    const config = normalizeHupijiaoConfig(options);
    const payload = buildHupijiaoRefundPayload({
        config,
        tradeOrderId: options.tradeOrderId,
        openOrderId: options.openOrderId,
        reason: options.reason,
        now: options.now
    });
    const response = await requestHupijiaoJson(config.refundUrl, payload, dependencies);

    if (!response.data || typeof response.data !== 'object') {
        throw new Error(`虎皮椒退款返回非 JSON：HTTP ${response.status}`);
    }

    const verification = verifyHupijiaoHash(response.data, config.appSecret);
    if (response.data.hash && !verification.valid) {
        throw new Error('虎皮椒退款响应签名校验失败');
    }

    return {
        config,
        requestPayload: payload,
        response,
        verification
    };
}

module.exports = {
    HUPIJIAO_API_VERSION,
    HUPIJIAO_DEFAULT_BASE_URL,
    HUPIJIAO_PAYMENT_PATH,
    HUPIJIAO_PLUGIN_ID,
    HUPIJIAO_QUERY_PATH,
    HUPIJIAO_REFUND_PATH,
    buildHupijiaoHash,
    buildHupijiaoPaymentPayload,
    buildHupijiaoQueryPayload,
    buildHupijiaoRefundPayload,
    buildHupijiaoTradeOrderId,
    createHupijiaoPayment,
    getHupijiaoGatewayOrderId,
    normalizeHupijiaoConfig,
    normalizeHupijiaoPaymentStatus,
    parseHupijiaoAttach,
    queryHupijiaoPayment,
    refundHupijiaoPayment,
    requestHupijiaoJson,
    resolveHupijiaoEndpointUrl,
    sanitizeHupijiaoTitle,
    verifyHupijiaoHash
};
