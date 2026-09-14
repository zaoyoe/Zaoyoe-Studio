'use strict';

/**
 * Payment adapter for the unauthenticated shop cash channel.
 *
 * This module is deliberately separate from provider-adapters.js.  The latter
 * is coupled to logged-in credit purchases and its webhook paths can credit a
 * user's wallet.  A guest checkout must never carry a user id, points amount,
 * claim secret, or a payment_checkout_session reference to a provider.
 *
 * The adapter only deals with provider protocol concerns.  Inventory, order
 * state transitions, and fulfilment remain in the guest-shop RPC/worker.
 */

const crypto = require('node:crypto');
const {
    buildZpayOutTradeNo,
    createZpayPayment,
    normalizeZpayConfig,
    normalizeZpayDevice,
    normalizeZpayPaymentStatus,
    parseZpayParam,
    queryZpayPayment,
    refundZpayPayment,
    verifyZpaySign
} = require('./zpay');
const {
    buildNowpaymentsOrderId,
    convertCnyAmountToPriceAmount,
    createNowpaymentsPayment,
    formatNowpaymentsPayAmount,
    normalizeNowpaymentsConfig,
    normalizeNowpaymentsPaymentStatus,
    queryNowpaymentsPayment,
    verifyNowpaymentsIpnSignature,
    sortObject
} = require('./nowpayments');
const {
    loadStoredPaymentConfigs,
    normalizePaymentChannelsConfig,
    resolvePaymentProviderSecrets
} = require('./providers');
const {
    classifyManagedSite,
    resolveSiteRequestOrigin
} = require('./site-origins');

const SUPPORTED_PROVIDERS = Object.freeze(['zpay', 'nowpayments']);
const FORBIDDEN_PROVIDER_NAMES = new Set(['mock', 'test', 'fake']);
const MAX_ORDER_REFERENCE_LENGTH = 200;
const MAX_PROVIDER_REFERENCE_LENGTH = 300;
const GUEST_PURPOSE = 'shop_direct';
const ZPAY_SIGN_TYPE = 'MD5';
const NOWPAYMENTS_GUEST_PAY_CURRENCY = 'usdtbsc';
// Keep this envelope byte-for-byte compatible with the database RPC's
// guest_payment_channels check.  The allowlist is configuration, not an
// opt-out: every element must be a lower-case-able ASCII token (or an
// explicit provider:channel pair), and wildcard/structured values are never
// accepted.
const PAYMENT_CHANNEL_TOKEN_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,159}$/u;
const FORBIDDEN_CHANNEL_TOKENS = new Set(['mock', 'test', 'fake']);

class GuestShopPaymentError extends Error {
    constructor(message, {
        code = 'guest_payment_error',
        statusCode = 503,
        expose = true,
        cause
    } = {}) {
        super(String(message || '游客支付失败'));
        this.name = 'GuestShopPaymentError';
        this.code = code;
        this.statusCode = statusCode;
        this.expose = expose;
        if (cause) this.cause = cause;
    }
}

function text(value, fallback = '', maxLength = 500) {
    if (typeof value !== 'string' && typeof value !== 'number') return fallback;
    const normalized = String(value).trim();
    return normalized ? normalized.slice(0, maxLength) : fallback;
}

function lowerText(value, fallback = '', maxLength = 200) {
    return text(value, fallback, maxLength).toLowerCase();
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function cloneObject(value) {
    if (!isPlainObject(value)) return {};
    return { ...value };
}

function normalizeProvider(value) {
    const provider = lowerText(value, '', 80);
    if (!provider || !SUPPORTED_PROVIDERS.includes(provider) || FORBIDDEN_PROVIDER_NAMES.has(provider)) {
        throw new GuestShopPaymentError('支付通道不可用', {
            code: 'guest_invalid_payment_provider',
            statusCode: 400
        });
    }
    return provider;
}

function normalizeSite(value) {
    const site = lowerText(value, '', 16);
    if (!['cn', 'intl'].includes(site)) {
        throw new GuestShopPaymentError('站点参数无效', {
            code: 'guest_invalid_site',
            statusCode: 400
        });
    }
    return site;
}

function currencyForSite(site) {
    return normalizeSite(site) === 'cn' ? 'CNY' : 'USD';
}

function normalizeCurrency(value) {
    return text(value, '', 16).toUpperCase();
}

function normalizeReference(value, fieldName = '订单号', maxLength = MAX_ORDER_REFERENCE_LENGTH) {
    const normalized = text(value, '', maxLength);
    if (!normalized || /[\u0000-\u0020\u007f]/u.test(normalized)) {
        throw new GuestShopPaymentError(`${fieldName}无效`, {
            code: 'guest_invalid_payment_reference',
            statusCode: 400
        });
    }
    return normalized;
}

function normalizeDecimalAmount(value, fieldName = '金额', { allowZero = false } = {}) {
    // Provider payloads are untrusted strings.  Reject exponent notation,
    // NaN/Infinity, signs, and more than two decimal places at this boundary.
    const source = typeof value === 'number'
        ? (Number.isFinite(value) ? String(value) : '')
        : text(value, '', 80);
    if (!source || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(source)) {
        throw new GuestShopPaymentError(`${fieldName}无效`, {
            code: 'guest_invalid_payment_amount',
            statusCode: 400
        });
    }
    const minor = Math.round(Number(source) * 100);
    if (!Number.isSafeInteger(minor) || (allowZero ? minor < 0 : minor <= 0)) {
        throw new GuestShopPaymentError(`${fieldName}无效`, {
            code: 'guest_invalid_payment_amount',
            statusCode: 400
        });
    }
    return {
        minor,
        amount: minor / 100,
        text: (minor / 100).toFixed(2)
    };
}

function safeNumber(value) {
    const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    return Number.isFinite(parsed) ? parsed : null;
}

function safePositiveNumber(value) {
    const parsed = safeNumber(value);
    return parsed !== null && parsed > 0 ? parsed : null;
}

function safeUrl(value, {
    allowHttp = false,
    allowData = false,
    maxLength = 1000
} = {}) {
    const normalized = text(value, '', maxLength);
    if (!normalized) return '';
    if (allowData && /^data:image\/(?:png|jpeg|jpg|webp);base64,[a-z0-9+/=]+$/iu.test(normalized)) {
        return normalized;
    }
    try {
        const parsed = new URL(normalized);
        if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) return '';
        return parsed.toString();
    } catch (_) {
        return '';
    }
}

function isProductionLikeRuntime(env = process.env) {
    const values = [env?.VERCEL_ENV, env?.RAILWAY_ENVIRONMENT_NAME, env?.DEPLOYMENT_TIER, env?.APP_ENV]
        .map((value) => lowerText(value));
    return values.includes('production');
}

function looksLikePlaceholderSecret(value) {
    const normalized = lowerText(value, '', 500);
    if (!normalized) return true;
    return /^(?:__configured__|mock|test|fake|changeme|replace[-_ ]?me|your[-_ ]?)/iu.test(normalized);
}

function unwrapSecret(value) {
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (value && typeof value === 'object') return text(value.value, '', 500);
    return '';
}

function extractHeaders(headers = {}) {
    const result = {};
    Object.entries(headers || {}).forEach(([key, value]) => {
        result[String(key).toLowerCase()] = Array.isArray(value) ? String(value[0] || '') : String(value || '');
    });
    return result;
}

function resolveWebhookUrl(origin, provider, env = process.env) {
    const envKey = provider === 'zpay'
        ? 'GUEST_SHOP_ZPAY_WEBHOOK_URL'
        : 'GUEST_SHOP_NOWPAYMENTS_WEBHOOK_URL';
    const configured = text(env?.[envKey], '', 1000);
    if (configured) return configured;
    return `${String(origin || '').replace(/\/+$/u, '')}/api/shop/guest/webhooks/${provider}`;
}

function buildGuestReturnUrl(origin, orderNo = '') {
    const base = String(origin || '').replace(/\/+$/u, '');
    const normalizedOrderNo = text(orderNo, '', MAX_ORDER_REFERENCE_LENGTH);
    if (!normalizedOrderNo) return `${base}/shop.html`;
    // The provider only receives a non-sensitive order handle.  The claim
    // proof remains in the encrypted HttpOnly cookie issued by our API.
    return `${base}/shop.html?order_no=${encodeURIComponent(normalizedOrderNo)}`;
}

function originForSite({ site, requestOrigin = '', requestHost = '', env = process.env } = {}) {
    const normalizedSite = normalizeSite(site);
    const candidate = resolveSiteRequestOrigin({
        site: normalizedSite,
        requestHost,
        appBaseUrl: requestOrigin || env?.APP_BASE_URL
    });
    let parsed;
    try {
        parsed = new URL(candidate);
    } catch (_) {
        throw new GuestShopPaymentError('支付回调站点无效', {
            code: 'guest_payment_origin_invalid',
            statusCode: 503,
            expose: false
        });
    }

    const managedSite = classifyManagedSite(parsed.hostname);
    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase());
    if (!isLocal && managedSite && managedSite !== normalizedSite) {
        throw new GuestShopPaymentError('支付回调站点与订单站点不匹配', {
            code: 'guest_payment_site_mismatch',
            statusCode: 503,
            expose: false
        });
    }

    // Unknown external origins are not accepted for a cash callback.  The
    // canonical managed origin is used instead, which prevents an attacker
    // from making a provider redirect/callback to an arbitrary host.
    if (!isLocal && !managedSite) {
        return resolveSiteRequestOrigin({ site: normalizedSite });
    }
    return parsed.origin;
}

function assertSafeCallbackUrl(url, label, env) {
    const normalized = safeUrl(url, { allowHttp: !isProductionLikeRuntime(env) });
    if (!normalized || (isProductionLikeRuntime(env) && !normalized.startsWith('https://'))) {
        throw new GuestShopPaymentError(`${label}必须使用 HTTPS`, {
            code: 'guest_payment_callback_invalid',
            statusCode: 503,
            expose: false
        });
    }
    return normalized;
}

function normalizeAllowedChannels(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    for (const entry of value) {
        // The SQL RPC intentionally rejects numbers and objects rather than
        // coercing them into channel names. Doing the same here prevents a
        // preview/create request from being accepted by the API and rejected
        // later (or, worse, interpreted differently by another layer).
        if (typeof entry !== 'string') {
            throw new GuestShopPaymentError('商品支付通道配置无效', {
                code: 'guest_payment_channel_allowlist_invalid',
                statusCode: 409
            });
        }
        const candidate = entry.trim().toLowerCase();
        if (!PAYMENT_CHANNEL_TOKEN_PATTERN.test(candidate)
            || FORBIDDEN_CHANNEL_TOKENS.has(candidate)) {
            throw new GuestShopPaymentError('商品支付通道配置无效', {
                code: 'guest_payment_channel_allowlist_invalid',
                statusCode: 409
            });
        }
        if (!result.includes(candidate)) result.push(candidate);
    }
    return result;
}

function channelMatchesAllowlist(provider, channel, allowlist) {
    let values;
    try {
        values = normalizeAllowedChannels(allowlist);
    } catch (_) {
        // This predicate is also exported for read-only readiness checks. An
        // invalid configuration must never match a channel, while the
        // mutating create path gets the explicit *_invalid error from
        // assertChannelAllowed below.
        return false;
    }
    if (!values.length) return false;
    const normalizedProvider = lowerText(provider);
    const normalizedChannel = lowerText(channel || provider);
    if (!PAYMENT_CHANNEL_TOKEN_PATTERN.test(normalizedProvider)
        || !PAYMENT_CHANNEL_TOKEN_PATTERN.test(normalizedChannel)
        || FORBIDDEN_CHANNEL_TOKENS.has(normalizedProvider)
        || FORBIDDEN_CHANNEL_TOKENS.has(normalizedChannel)) {
        return false;
    }
    const candidates = new Set([
        normalizedProvider,
        normalizedChannel,
        `${normalizedProvider}:${normalizedChannel}`
    ]);
    // No wildcard branch: the database allowlist uses exact equality and
    // rejects '*' at the constraint boundary.
    return values.some((entry) => candidates.has(entry));
}

function assertChannelAllowed(provider, channel, allowlist, { required = true } = {}) {
    const normalized = normalizeAllowedChannels(allowlist);
    if (!normalized.length) {
        if (required) {
            throw new GuestShopPaymentError('商品未配置可用的游客支付通道', {
                code: 'guest_payment_channel_allowlist_empty',
                statusCode: 409
            });
        }
        return false;
    }
    if (!channelMatchesAllowlist(provider, channel, normalized)) {
        throw new GuestShopPaymentError('当前支付通道未被商品允许', {
            code: 'guest_payment_channel_unavailable',
            statusCode: 409
        });
    }
    return true;
}

function sanitizeProviderConfig(provider, channelConfig = {}) {
    const result = cloneObject(channelConfig);
    // Secrets must come from the secret resolver/environment, never from a
    // public product or payment-channel JSON object.
    if (provider === 'zpay') {
        delete result.pkey;
        delete result.key;
    }
    if (provider === 'nowpayments') {
        delete result.api_key;
        delete result.ipn_secret;
    }
    return result;
}

function buildMerchantOrderReference(order = {}, provider = '') {
    const explicit = order.merchant_order_no || order.merchantOrderNo || order.order_no || order.orderNo;
    if (explicit) return normalizeReference(explicit, '商户订单号');
    const source = text(order.id || order.order_id, '', 120);
    if (!source) {
        throw new GuestShopPaymentError('订单引用缺失', {
            code: 'guest_order_reference_missing',
            statusCode: 500,
            expose: false
        });
    }
    // This fallback is deterministic and independent of any logged-in order
    // namespace.  In normal operation the RPC's order_no is always used.
    const digest = crypto.createHash('sha256').update(`${GUEST_PURPOSE}:${provider}:${source}`).digest('hex').slice(0, 40).toUpperCase();
    return `GS${digest}`.slice(0, MAX_ORDER_REFERENCE_LENGTH);
}

function buildProviderOrderReference(merchantOrderNo, provider) {
    const normalized = normalizeReference(merchantOrderNo, '商户订单号');
    // Keeping the provider order id equal to the immutable merchant order id
    // lets callbacks be looked up without carrying any secret in `param` or
    // provider metadata.  The prefix is generated by the RPC, not the client.
    if (provider === 'zpay') return normalized.slice(0, 120);
    if (provider === 'nowpayments') return normalized.slice(0, 120);
    return normalized;
}

function buildSafeMetadata(provider, metadata = {}) {
    const source = isPlainObject(metadata) ? metadata : {};
    const allowed = provider === 'zpay'
        ? ['provider_order_no', 'trade_no', 'gateway_order_id', 'payment_type', 'checkout_url', 'qrcode_url', 'qrcode_image_url']
        : ['provider_order_no', 'payment_id', 'pay_address', 'pay_amount', 'pay_amount_text', 'pay_currency', 'price_amount', 'price_currency', 'network_name', 'quote_expires_at', 'is_fixed_rate', 'is_fee_paid_by_user'];
    const result = {};
    allowed.forEach((key) => {
        const value = source[key];
        if (value === undefined || value === null || value === '') return;
        if (typeof value === 'string') result[key] = value.slice(0, 1000);
        else if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
        else if (typeof value === 'boolean') result[key] = value;
    });
    result.purpose = GUEST_PURPOSE;
    result.provider = provider;
    return result;
}

function deriveZpayPaymentType(channel, integration) {
    const normalizedChannel = lowerText(channel, '', 100);
    const suffix = normalizedChannel.includes(':')
        ? normalizedChannel.split(':').pop()
        : normalizedChannel;
    if (suffix === 'alipay' || suffix === 'wxpay') return suffix;
    return lowerText(integration?.paymentType, 'alipay', 20) === 'wxpay' ? 'wxpay' : 'alipay';
}

function extractNowpaymentsPaymentId(payload = {}) {
    return text(payload.payment_id || payload.id, '', 120);
}

function getNowpaymentsQuoteAmount(payload = {}) {
    return safePositiveNumber(payload.price_amount);
}

function getNowpaymentsActuallyPaid(payload = {}) {
    // NOWPayments exposes pay_amount as the checkout quote.  It is not proof
    // of what reached the wallet.  The guest channel must only use the
    // explicitly reported settlement field and must fail closed when it is
    // absent or malformed.
    if (!Object.prototype.hasOwnProperty.call(payload, 'actually_paid')) return null;
    const amountText = getNowpaymentsActuallyPaidText(payload);
    if (!amountText) return null;
    return safePositiveNumber(amountText);
}

function getNowpaymentsActuallyPaidText(payload = {}) {
    if (!Object.prototype.hasOwnProperty.call(payload, 'actually_paid')) return null;
    const source = typeof payload.actually_paid === 'number'
        ? (Number.isFinite(payload.actually_paid) ? String(payload.actually_paid) : '')
        : text(payload.actually_paid, '', 120);
    return /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(source) && Number(source) > 0
        ? source
        : null;
}

function normalizeNowpaymentsCurrency(value) {
    return lowerText(value, '', 40);
}

function getNowpaymentsActuallyPaidCurrency(payload = {}) {
    // pay_currency is the requested asset, not the settled asset.  Never
    // substitute it for actually_paid_currency during verification.
    if (!Object.prototype.hasOwnProperty.call(payload, 'actually_paid_currency')) return '';
    return normalizeNowpaymentsCurrency(payload.actually_paid_currency);
}

function normalizeNowpaymentsSettlement(payload = {}, status = 'unknown') {
    const actuallyPaid = getNowpaymentsActuallyPaid(payload);
    const actuallyPaidText = getNowpaymentsActuallyPaidText(payload);
    const paidCurrency = getNowpaymentsActuallyPaidCurrency(payload);
    const networkVerified = paidCurrency === NOWPAYMENTS_GUEST_PAY_CURRENCY;
    const actualPaymentVerified = actuallyPaid !== null
        && actuallyPaidText !== null
        && networkVerified;
    let effectiveStatus = status;
    if (status === 'paid' && !actualPaymentVerified) {
        effectiveStatus = paidCurrency && !networkVerified ? 'wrong_asset' : 'review';
    }
    return {
        actuallyPaid,
        actuallyPaidText,
        paidCurrency,
        networkVerified,
        actualPaymentVerified,
        effectiveStatus
    };
}

function nowpaymentsSettlementFailureReason(payload = {}, settlement, status = 'unknown') {
    if (status !== 'paid') return '';
    if (!Object.prototype.hasOwnProperty.call(payload, 'actually_paid')) return 'missing_actually_paid';
    if (!(settlement?.actuallyPaid > 0) || !settlement?.actuallyPaidText) return 'invalid_actually_paid';
    if (!Object.prototype.hasOwnProperty.call(payload, 'actually_paid_currency')) return 'missing_actually_paid_currency';
    if (!settlement?.paidCurrency) return 'invalid_actually_paid_currency';
    if (!settlement.networkVerified) return 'wrong_asset';
    return '';
}

function eventKey(provider, payload, status = '') {
    const primary = provider === 'nowpayments'
        ? (payload.payment_id || payload.id || payload.order_id)
        : (payload.trade_no || payload.out_trade_no);
    const source = `${provider}:${text(primary, 'unknown', 160)}:${lowerText(status || payload.payment_status || payload.trade_status || payload.status, 'unknown', 80)}`;
    return `${source}:${crypto.createHash('sha256').update(JSON.stringify(sortObject(payload || {}))).digest('hex').slice(0, 24)}`;
}

function parseZpayRawBody(rawBody) {
    if (rawBody === undefined || rawBody === null) return null;
    const buffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
    const params = new URLSearchParams(buffer.toString('utf8'));
    const result = {};
    for (const [key, value] of params.entries()) {
        if (Object.prototype.hasOwnProperty.call(result, key)) {
            // Duplicate form keys are ambiguous for signature/lookup purposes.
            return null;
        }
        result[key] = value;
    }
    return result;
}

function parseJsonRawBody(rawBody) {
    if (rawBody === undefined || rawBody === null) return null;
    try {
        const source = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
        const parsed = JSON.parse(source);
        return isPlainObject(parsed) ? parsed : null;
    } catch (_) {
        return null;
    }
}

function canonicalJson(value) {
    try {
        return JSON.stringify(sortObject(value || {}));
    } catch (_) {
        return '';
    }
}

function ensureRawBodyMatchesPayload(provider, payload, rawBody) {
    if (rawBody === undefined || rawBody === null) return;
    const parsed = provider === 'zpay' ? parseZpayRawBody(rawBody) : parseJsonRawBody(rawBody);
    if (!parsed) {
        throw new GuestShopPaymentError('无法取得可验签的原始回调内容', {
            code: 'guest_webhook_raw_body_unavailable',
            statusCode: 400
        });
    }
    if (provider === 'nowpayments') {
        if (canonicalJson(parsed) !== canonicalJson(payload)) {
            throw new GuestShopPaymentError('回调内容与原始签名载荷不一致', {
                code: 'guest_webhook_payload_mismatch',
                statusCode: 401
            });
        }
        return;
    }
    const left = Object.entries(parsed).sort();
    const right = Object.entries(payload || {}).reduce((result, [key, value]) => {
        result.push([String(key), String(value)]);
        return result;
    }, []).sort();
    if (JSON.stringify(left) !== JSON.stringify(right)) {
        throw new GuestShopPaymentError('回调内容与原始签名载荷不一致', {
            code: 'guest_webhook_payload_mismatch',
            statusCode: 401
        });
    }
}

function toSecretValues(provider, values = {}) {
    if (provider === 'zpay') {
        return { zpay_pkey: unwrapSecret(values.zpay_pkey || values.pkey || values.key) };
    }
    return {
        nowpayments_api_key: unwrapSecret(values.nowpayments_api_key || values.api_key),
        nowpayments_ipn_secret: unwrapSecret(values.nowpayments_ipn_secret || values.ipn_secret)
    };
}

function getProviderConfigFromInput(config, provider) {
    if (!config || typeof config !== 'object') return null;
    if (config.providers && typeof config.providers === 'object') {
        return config.providers[provider] || null;
    }
    return config[provider] || null;
}

function getTrustedOrderAmount(order, suppliedAmount) {
    const source = order?.total_amount ?? order?.totalAmount ?? order?.expected_amount ?? order?.expectedAmount;
    const trusted = normalizeDecimalAmount(source, '订单金额');
    if (suppliedAmount !== undefined && suppliedAmount !== null && suppliedAmount !== '') {
        const supplied = normalizeDecimalAmount(suppliedAmount, '订单金额');
        if (supplied.minor !== trusted.minor) {
            throw new GuestShopPaymentError('订单金额与服务端快照不一致', {
                code: 'guest_payment_amount_snapshot_mismatch',
                statusCode: 409
            });
        }
    }
    return trusted;
}

function getOrderSite(order, suppliedSite) {
    const value = order?.site || suppliedSite;
    const site = normalizeSite(value);
    if (suppliedSite && normalizeSite(suppliedSite) !== site) {
        throw new GuestShopPaymentError('订单站点与请求不一致', {
            code: 'guest_payment_site_mismatch',
            statusCode: 409
        });
    }
    return site;
}

function getOrderCurrency(order, suppliedCurrency, site) {
    const expected = currencyForSite(site);
    const fromOrder = normalizeCurrency(order?.currency || order?.currency_code);
    if (fromOrder && fromOrder !== expected) {
        throw new GuestShopPaymentError('订单币种与站点不一致', {
            code: 'guest_payment_currency_mismatch',
            statusCode: 409
        });
    }
    if (suppliedCurrency && normalizeCurrency(suppliedCurrency) !== expected) {
        throw new GuestShopPaymentError('订单币种与请求不一致', {
            code: 'guest_payment_currency_mismatch',
            statusCode: 409
        });
    }
    return expected;
}

function createGuestShopPaymentAdapter({
    supabase = null,
    env: defaultEnv = process.env,
    config: defaultConfig = null,
    fetchImpl: defaultFetchImpl = globalThis.fetch,
    loadConfigs = loadStoredPaymentConfigs,
    resolveSecrets = resolvePaymentProviderSecrets
} = {}) {
    async function resolveRuntime({
        provider: providerInput,
        site: siteInput,
        requestOrigin = '',
        requestHost = '',
        returnOrderNo = '',
        env = defaultEnv,
        config = defaultConfig,
        secretValues = null
    } = {}) {
        const provider = normalizeProvider(providerInput);
        const site = normalizeSite(siteInput);
        const origin = originForSite({ site, requestOrigin, requestHost, env });

        let loadedConfig = getProviderConfigFromInput(config, provider);
        if (!loadedConfig) {
            if (!supabase || typeof loadConfigs !== 'function') {
                throw new GuestShopPaymentError('支付配置暂不可用', {
                    code: 'guest_payment_config_unavailable',
                    statusCode: 503,
                    expose: false
                });
            }
            const loaded = await loadConfigs(supabase, {
                site,
                origin,
                requestOrigin: origin,
                requestHost,
                appBaseUrl: env?.APP_BASE_URL,
                afdianCheckoutUrl: env?.PAYMENT_AFDIAN_URL
            });
            loadedConfig = loaded?.paymentChannels?.providers?.[provider];
        }
        if (!loadedConfig || typeof loadedConfig !== 'object') {
            throw new GuestShopPaymentError('支付通道配置不存在', {
                code: 'guest_payment_provider_unavailable',
                statusCode: 503
            });
        }
        const channelConfig = sanitizeProviderConfig(provider, loadedConfig);
        if (channelConfig.enabled !== true) {
            throw new GuestShopPaymentError('支付通道未启用', {
                code: 'guest_payment_provider_disabled',
                statusCode: 503
            });
        }

        let resolvedSecrets = secretValues;
        if (!resolvedSecrets) {
            if (typeof resolveSecrets !== 'function' || !supabase) {
                resolvedSecrets = {};
            } else {
                resolvedSecrets = await resolveSecrets(supabase, provider, env, { site });
            }
        }
        const normalizedSecrets = toSecretValues(provider, resolvedSecrets || {});
        Object.values(normalizedSecrets).forEach((value) => {
            if (looksLikePlaceholderSecret(value)) {
                throw new GuestShopPaymentError('支付密钥未配置或仍为测试值', {
                    code: 'guest_payment_live_secret_unavailable',
                    statusCode: 503,
                    expose: false
                });
            }
        });

        const callbackUrl = assertSafeCallbackUrl(resolveWebhookUrl(origin, provider, env), '游客支付回调地址', env);
        let integration;
        let effectiveChannelConfig = { ...channelConfig };
        if (provider === 'zpay') {
            effectiveChannelConfig.notify_url = callbackUrl;
            // The guest return is intentionally an origin, not a URL carrying
            // an order token or claim secret.
            effectiveChannelConfig.return_url = buildGuestReturnUrl(origin, returnOrderNo);
            integration = normalizeZpayConfig({
                channelConfig: effectiveChannelConfig,
                secretValues: normalizedSecrets,
                requestOrigin: origin
            });
            if (integration.missingFields.length) {
                throw new GuestShopPaymentError(`易支付配置不完整：${integration.missingFields.join(', ')}`, {
                    code: 'guest_payment_provider_not_ready',
                    statusCode: 503,
                    expose: false
                });
            }
            if (isProductionLikeRuntime(env)) {
                assertSafeCallbackUrl(integration.notifyUrl, '易支付回调地址', env);
            }
        } else {
            effectiveChannelConfig.ipn_callback_url = callbackUrl;
            effectiveChannelConfig.success_url = buildGuestReturnUrl(origin, returnOrderNo);
            effectiveChannelConfig.cancel_url = buildGuestReturnUrl(origin, returnOrderNo);
            integration = normalizeNowpaymentsConfig({
                channelConfig: effectiveChannelConfig,
                secretValues: normalizedSecrets,
                requestOrigin: origin,
                env
            });
            if (integration.missingFields.length) {
                throw new GuestShopPaymentError(`NOWPayments 配置不完整：${integration.missingFields.join(', ')}`, {
                    code: 'guest_payment_provider_not_ready',
                    statusCode: 503,
                    expose: false
                });
            }
            if (normalizeNowpaymentsCurrency(integration.payCurrency) !== NOWPAYMENTS_GUEST_PAY_CURRENCY) {
                throw new GuestShopPaymentError('游客 NOWPayments 仅允许 USDT-BEP20（usdtbsc）', {
                    code: 'guest_payment_network_unsupported',
                    statusCode: 503,
                    expose: false
                });
            }
            if (isProductionLikeRuntime(env)) {
                assertSafeCallbackUrl(integration.ipnCallbackUrl, 'NOWPayments 回调地址', env);
                if (!safeUrl(integration.apiBaseUrl) || !integration.apiBaseUrl.startsWith('https://')) {
                    throw new GuestShopPaymentError('NOWPayments API 地址必须使用 HTTPS', {
                        code: 'guest_payment_api_url_invalid',
                        statusCode: 503,
                        expose: false
                    });
                }
            }
        }

        return {
            provider,
            site,
            origin,
            channelConfig: effectiveChannelConfig,
            secretValues: normalizedSecrets,
            integration,
            env
        };
    }

    async function isProviderReady({
        provider,
        channel = provider,
        site,
        allowedChannels = [],
        requireChannelAllowlist = true,
        ...options
    } = {}) {
        try {
            const context = await resolveRuntime({ provider, site, ...options });
            const channelAllowed = assertChannelAllowed(
                context.provider,
                channel,
                allowedChannels,
                { required: requireChannelAllowlist }
            );
            return {
                ready: true,
                provider: context.provider,
                channel: lowerText(channel || context.provider),
                site: context.site,
                currency: currencyForSite(context.site),
                channel_allowed: channelAllowed,
                reason: ''
            };
        } catch (error) {
            return {
                ready: false,
                provider: lowerText(provider),
                channel: lowerText(channel || provider),
                site: lowerText(site),
                currency: '',
                channel_allowed: false,
                code: error?.code || 'guest_payment_provider_not_ready',
                reason: error?.message || '支付通道不可用'
            };
        }
    }

    async function createGuestPayment({
        order,
        provider: providerInput,
        channel = providerInput,
        site: siteInput,
        currency: currencyInput,
        amount,
        allowedChannels = order?.guest_payment_channels || order?.payment_channels || [],
        requestOrigin = '',
        requestHost = '',
        req = null,
        env = defaultEnv,
        config = defaultConfig,
        secretValues = null,
        fetchImpl = defaultFetchImpl
    } = {}) {
        const provider = normalizeProvider(providerInput);
        const channelName = lowerText(channel || provider, provider, 100);
        const site = getOrderSite(order, siteInput);
        const currency = getOrderCurrency(order, currencyInput, site);
        const amountSnapshot = getTrustedOrderAmount(order, amount);
        assertChannelAllowed(provider, channelName, allowedChannels, { required: true });
        if (order?.provider && lowerText(order.provider) !== provider) {
            throw new GuestShopPaymentError('订单支付通道与请求不一致', {
                code: 'guest_payment_provider_mismatch',
                statusCode: 409
            });
        }
        if (order?.channel && lowerText(order.channel) !== channelName) {
            throw new GuestShopPaymentError('订单支付子通道与请求不一致', {
                code: 'guest_payment_channel_mismatch',
                statusCode: 409
            });
        }
        const merchantOrderNo = buildMerchantOrderReference(order, provider);
        const context = await resolveRuntime({
            provider,
            site,
            requestOrigin,
            requestHost,
            env,
            config,
            secretValues,
            returnOrderNo: merchantOrderNo
        });
        const providerOrderNo = buildProviderOrderReference(merchantOrderNo, provider);
        const fetchDependencies = typeof fetchImpl === 'function' ? { fetchImpl } : {};
        const productName = text(order?.snapshot_product_name || order?.product_name || order?.name, '商品', 80);
        const skuName = text(order?.snapshot_sku_name || order?.sku_name, '', 80);
        const title = skuName ? `${productName} - ${skuName}` : productName;

        if (provider === 'zpay') {
            const paymentType = deriveZpayPaymentType(channelName, context.integration);
            const zpayConfig = {
                ...context.channelConfig,
                payment_type: paymentType,
                notify_url: context.integration.notifyUrl,
                return_url: context.integration.returnUrl
            };
            const result = await createZpayPayment({
                channelConfig: zpayConfig,
                secretValues: context.secretValues,
                requestOrigin: context.origin,
                outTradeNo: providerOrderNo,
                amount: amountSnapshot.text,
                name: title,
                clientIp: text(req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress, '127.0.0.1', 80),
                device: normalizeZpayDevice(req?.headers?.['user-agent'] || '', context.channelConfig.device),
                // This attach value is signed and contains no claim/user data.
                param: `guest:${merchantOrderNo}`
            }, fetchDependencies);
            const payload = result.response?.data && typeof result.response.data === 'object' ? result.response.data : {};
            const gatewayCode = String(payload.code ?? '').trim();
            if (gatewayCode !== '1') {
                throw new GuestShopPaymentError(text(payload.msg, '易支付下单失败，请稍后重试', 240), {
                    code: 'guest_provider_create_failed',
                    statusCode: 502
                });
            }
            const checkoutUrl = safeUrl(payload.payurl || payload.qrcode || payload.img || '', {
                allowHttp: !isProductionLikeRuntime(env),
                allowData: false
            });
            if (!checkoutUrl) {
                throw new GuestShopPaymentError('易支付未返回可用支付链接', {
                    code: 'guest_provider_checkout_missing',
                    statusCode: 502
                });
            }
            const tradeNo = text(payload.trade_no, '', MAX_PROVIDER_REFERENCE_LENGTH) || null;
            const gatewayOrderId = text(payload.O_id || payload.order_id, '', MAX_PROVIDER_REFERENCE_LENGTH) || null;
            const qrcodeUrl = safeUrl(payload.qrcode, { allowHttp: !isProductionLikeRuntime(env) }) || null;
            const imageUrl = safeUrl(payload.img, { allowHttp: !isProductionLikeRuntime(env) }) || null;
            const metadata = buildSafeMetadata('zpay', {
                provider_order_no: providerOrderNo,
                trade_no: tradeNo,
                gateway_order_id: gatewayOrderId,
                payment_type: paymentType,
                checkout_url: checkoutUrl,
                qrcode_url: qrcodeUrl,
                qrcode_image_url: imageUrl
            });
            return {
                supported: true,
                provider,
                channel: channelName,
                purpose: GUEST_PURPOSE,
                merchant_order_no: merchantOrderNo,
                provider_order_no: providerOrderNo,
                provider_trade_no: tradeNo,
                checkout_url: checkoutUrl,
                payment_url: checkoutUrl,
                qrcode_url: qrcodeUrl,
                qrcode_image_url: imageUrl,
                amount: amountSnapshot.amount,
                amount_text: amountSnapshot.text,
                currency,
                status: 'created',
                provider_metadata: metadata,
                payment_order_patch: {
                    provider_order_no: providerOrderNo,
                    checkout_reference: checkoutUrl,
                    provider_metadata: metadata
                },
                checkout: {
                    provider,
                    channel: channelName,
                    checkout_url: checkoutUrl,
                    qrcode_url: qrcodeUrl,
                    qrcode_image_url: imageUrl,
                    amount: amountSnapshot.amount,
                    currency
                }
            };
        }

        let priceAmount;
        const priceCurrency = normalizeCurrency(context.integration.priceCurrency).toLowerCase();
        if (priceCurrency === 'usd' && site === 'cn') {
            priceAmount = convertCnyAmountToPriceAmount(amountSnapshot.amount, context.integration);
        } else if (priceCurrency === currency.toLowerCase()) {
            priceAmount = amountSnapshot.amount;
        } else if (priceCurrency === 'usd' && currency === 'USD') {
            priceAmount = amountSnapshot.amount;
        } else {
            throw new GuestShopPaymentError('NOWPayments 计价币种与订单不兼容', {
                code: 'guest_payment_currency_unsupported',
                statusCode: 503,
                expose: false
            });
        }
        if (!(Number.isFinite(priceAmount) && priceAmount > 0)) {
            throw new GuestShopPaymentError('NOWPayments 报价无效', {
                code: 'guest_provider_quote_invalid',
                statusCode: 502
            });
        }
        const result = await createNowpaymentsPayment({
            channelConfig: context.channelConfig,
            secretValues: context.secretValues,
            requestOrigin: context.origin,
            orderId: providerOrderNo,
            priceAmount: Number(priceAmount).toFixed(2),
            orderDescription: title
        }, fetchDependencies);
        const payload = result.response?.data && typeof result.response.data === 'object' ? result.response.data : {};
        const paymentId = extractNowpaymentsPaymentId(payload);
        const payAddress = text(payload.pay_address || payload.payment_address || payload.address, '', 240);
        const payAmountRaw = safePositiveNumber(payload.pay_amount);
        const payCurrency = normalizeNowpaymentsCurrency(payload.pay_currency || context.integration.payCurrency);
        if (!paymentId || !payAddress || !(payAmountRaw > 0) || payCurrency !== NOWPAYMENTS_GUEST_PAY_CURRENCY) {
            throw new GuestShopPaymentError('NOWPayments 未返回完整的 USDT-BEP20 付款信息', {
                code: 'guest_provider_checkout_missing',
                statusCode: 502
            });
        }
        const payAmountText = formatNowpaymentsPayAmount(payAmountRaw, context.integration.payAmountPrecision || 2);
        const quoteExpiresAt = text(
            payload.expiration_estimate_date || payload.expiration_date || payload.valid_until || payload.quote_expires_at,
            '',
            80
        ) || null;
        const metadata = buildSafeMetadata('nowpayments', {
            provider_order_no: providerOrderNo,
            payment_id: paymentId,
            pay_address: payAddress,
            pay_amount: Number(payAmountText || payAmountRaw),
            pay_amount_text: payAmountText || String(payAmountRaw),
            pay_currency: payCurrency,
            price_amount: Number(priceAmount),
            price_currency: priceCurrency,
            network_name: context.channelConfig.network_name || 'BNB Smart Chain',
            quote_expires_at: quoteExpiresAt,
            is_fixed_rate: context.integration.isFixedRate,
            is_fee_paid_by_user: context.integration.isFeePaidByUser
        });
        return {
            supported: true,
            provider,
            channel: channelName,
            purpose: GUEST_PURPOSE,
            merchant_order_no: merchantOrderNo,
            provider_order_no: providerOrderNo,
            provider_payment_id: paymentId,
            payment_id: paymentId,
            checkout_url: '',
            payment_url: '',
            qr_data: payAddress,
            pay_address: payAddress,
            pay_amount: Number(payAmountText || payAmountRaw),
            pay_amount_text: payAmountText || String(payAmountRaw),
            pay_currency: payCurrency,
            price_amount: Number(priceAmount),
            price_currency: priceCurrency,
            amount: amountSnapshot.amount,
            amount_text: amountSnapshot.text,
            currency,
            quote_expires_at: quoteExpiresAt,
            status: 'created',
            provider_metadata: metadata,
            payment_order_patch: {
                provider_order_no: providerOrderNo,
                checkout_reference: paymentId,
                provider_metadata: metadata
            },
            checkout: {
                provider,
                channel: channelName,
                payment_id: paymentId,
                pay_address: payAddress,
                pay_amount: Number(payAmountText || payAmountRaw),
                pay_amount_text: payAmountText || String(payAmountRaw),
                pay_currency: payCurrency,
                price_amount: Number(priceAmount),
                price_currency: priceCurrency,
                qr_data: payAddress,
                quote_expires_at: quoteExpiresAt,
                amount: amountSnapshot.amount,
                currency
            }
        };
    }

    async function verifyGuestWebhook({
        provider: providerInput,
        payload = {},
        rawBody = null,
        headers = {},
        signature = '',
        site: siteInput,
        expectedPayment = null,
        requestOrigin = '',
        requestHost = '',
        env = defaultEnv,
        config = defaultConfig,
        secretValues = null
    } = {}) {
        const provider = normalizeProvider(providerInput);
        const site = normalizeSite(siteInput || expectedPayment?.site || 'cn');
        if (!isPlainObject(payload)) {
            return { supported: true, valid: false, provider, reason: 'invalid_payload' };
        }
        let context;
        try {
            context = await resolveRuntime({ provider, site, requestOrigin, requestHost, env, config, secretValues });
            ensureRawBodyMatchesPayload(provider, payload, rawBody);
        } catch (error) {
            return {
                supported: true,
                valid: false,
                provider,
                reason: error?.code || 'provider_not_ready',
                message: error?.message || '回调验签配置不可用'
            };
        }
        const headerMap = extractHeaders(headers);
        if (provider === 'zpay') {
            const received = text(signature || payload.sign, '', 160).toLowerCase();
            const signType = lowerText(payload.sign_type, '', 20);
            if (signType && signType !== 'md5') {
                return { supported: true, valid: false, provider, reason: 'unsupported_sign_type', received_signature: received };
            }
            if (payload.pid && text(payload.pid, '', 80) !== context.integration.pid) {
                return { supported: true, valid: false, provider, reason: 'merchant_mismatch', received_signature: received };
            }
            const verification = verifyZpaySign(payload, context.integration.pkey, received);
            return {
                supported: true,
                valid: verification.valid === true,
                provider,
                reason: verification.valid ? '' : (received ? 'signature_mismatch' : 'missing_signature'),
                received_signature: received,
                signature_version: ZPAY_SIGN_TYPE
            };
        }
        const received = text(
            signature || headerMap['x-nowpayments-sig'] || headerMap['x-nowpayments-signature'],
            '',
            200
        ).toLowerCase();
        const verification = verifyNowpaymentsIpnSignature(
            payload,
            context.integration.ipnSecret,
            received
        );
        const status = normalizeNowpaymentsPaymentStatus(payload.payment_status || payload.status);
        const settlement = normalizeNowpaymentsSettlement(payload, status);
        const settlementReason = nowpaymentsSettlementFailureReason(payload, settlement, status);
        const valid = verification.valid === true && !settlementReason;
        return {
            supported: true,
            valid,
            provider,
            reason: verification.valid !== true
                ? (verification.reason || 'signature_mismatch')
                : settlementReason,
            received_signature: received,
            signature_version: 'HMAC-SHA512',
            actual_payment_verified: settlement.actualPaymentVerified
        };
    }

    async function parseGuestWebhook({
        provider: providerInput,
        payload = {},
        site: siteInput = '',
        requestOrigin = '',
        requestHost = '',
        env = defaultEnv,
        config = defaultConfig,
        secretValues = null
    } = {}) {
        const provider = normalizeProvider(providerInput);
        if (!isPlainObject(payload)) {
            throw new GuestShopPaymentError('回调载荷无效', { code: 'guest_webhook_payload_invalid', statusCode: 400 });
        }
        const status = provider === 'zpay'
            ? normalizeZpayPaymentStatus(payload.trade_status, payload.status)
            : normalizeNowpaymentsPaymentStatus(payload.payment_status || payload.status);
        const merchantOrderNo = provider === 'zpay'
            ? text(payload.out_trade_no, '', MAX_ORDER_REFERENCE_LENGTH)
            : text(payload.order_id, '', MAX_ORDER_REFERENCE_LENGTH);
        const providerOrderNo = merchantOrderNo;
        const transactionId = provider === 'zpay'
            ? text(payload.trade_no, '', MAX_PROVIDER_REFERENCE_LENGTH)
            : text(payload.outcome_transaction_hash || payload.payin_hash || payload.transaction_id || payload.txid, '', MAX_PROVIDER_REFERENCE_LENGTH);
        const normalizedSite = siteInput ? normalizeSite(siteInput) : '';
        if (provider === 'zpay') {
            const amount = safeNumber(payload.money);
            return {
                provider,
                purpose: GUEST_PURPOSE,
                merchant_order_no: merchantOrderNo,
                provider_order_no: providerOrderNo,
                transaction_id: transactionId || null,
                event_id: eventKey(provider, payload, status),
                event_key: eventKey(provider, payload, status),
                amount,
                paid_amount: amount,
                provider_amount: amount,
                currency: normalizedSite ? currencyForSite(normalizedSite) : normalizeCurrency(payload.currency),
                provider_currency: normalizedSite ? currencyForSite(normalizedSite) : normalizeCurrency(payload.currency),
                site: normalizedSite,
                status,
                final_status: status,
                status_raw: text(payload.trade_status || payload.status, '', 64),
                response_payload: payload
            };
        }
        const quoteAmount = getNowpaymentsQuoteAmount(payload);
        const settlement = normalizeNowpaymentsSettlement(payload, status);
        const priceCurrency = normalizeCurrency(payload.price_currency);
        const paymentId = extractNowpaymentsPaymentId(payload);
        return {
            provider,
            purpose: GUEST_PURPOSE,
            merchant_order_no: merchantOrderNo,
            provider_order_no: providerOrderNo,
            provider_payment_id: paymentId || null,
            payment_id: paymentId || null,
            transaction_id: transactionId || null,
            event_id: eventKey(provider, payload, settlement.effectiveStatus),
            event_key: eventKey(provider, payload, settlement.effectiveStatus),
            amount: quoteAmount,
            paid_amount: quoteAmount,
            provider_amount: quoteAmount,
            actually_paid: settlement.actuallyPaid,
            actually_paid_text: settlement.actuallyPaidText,
            crypto_paid_amount: settlement.actuallyPaid,
            currency: priceCurrency,
            provider_currency: priceCurrency,
            paid_currency: settlement.paidCurrency,
            pay_currency: settlement.paidCurrency,
            site: normalizedSite,
            network: settlement.paidCurrency,
            network_verified: settlement.networkVerified,
            actual_payment_verified: settlement.actualPaymentVerified,
            status: settlement.effectiveStatus,
            final_status: settlement.effectiveStatus,
            status_raw: text(payload.payment_status || payload.status, '', 64),
            response_payload: payload
        };
    }

    async function queryGuestPayment({
        provider: providerInput,
        channel = providerInput,
        site,
        allowedChannels = [],
        requireChannelAllowlist = false,
        providerOrderNo = '',
        merchantOrderNo = '',
        tradeNo = '',
        paymentId = '',
        providerPaymentId = '',
        metadata = {},
        ...options
    } = {}) {
        const provider = normalizeProvider(providerInput);
        const channelName = lowerText(channel || provider, provider);
        assertChannelAllowed(provider, channelName, allowedChannels, { required: requireChannelAllowlist });
        const context = await resolveRuntime({ provider, site, ...options });
        const orderNo = text(providerOrderNo || merchantOrderNo, '', MAX_PROVIDER_REFERENCE_LENGTH);
        if (provider === 'zpay') {
            if (!orderNo && !tradeNo) throw new GuestShopPaymentError('易支付查单缺少订单号', { code: 'guest_provider_reference_missing', statusCode: 400 });
            const result = await queryZpayPayment({
                channelConfig: context.channelConfig,
                secretValues: context.secretValues,
                requestOrigin: context.origin,
                outTradeNo: orderNo,
                tradeNo
            }, typeof options.fetchImpl === 'function' ? { fetchImpl: options.fetchImpl } : { fetchImpl: defaultFetchImpl });
            const payload = result.response?.data && typeof result.response.data === 'object' ? result.response.data : {};
            const status = normalizeZpayPaymentStatus(payload.trade_status, payload.status);
            const amount = safeNumber(payload.money);
            return {
                supported: true,
                provider,
                purpose: GUEST_PURPOSE,
                merchant_order_no: text(payload.out_trade_no || merchantOrderNo, '', MAX_ORDER_REFERENCE_LENGTH) || null,
                provider_order_no: text(payload.out_trade_no || orderNo, '', MAX_PROVIDER_REFERENCE_LENGTH) || null,
                transaction_id: text(payload.trade_no || tradeNo, '', MAX_PROVIDER_REFERENCE_LENGTH) || null,
                trade_no: text(payload.trade_no || tradeNo, '', MAX_PROVIDER_REFERENCE_LENGTH) || null,
                status,
                status_raw: text(payload.trade_status || payload.status, '', 64),
                amount,
                paid_amount: amount,
                currency: currencyForSite(site),
                response_payload: payload
            };
        }
        const resolvedPaymentId = text(paymentId || providerPaymentId || metadata?.payment_id || metadata?.provider_payment_id, '', 120);
        if (!resolvedPaymentId) throw new GuestShopPaymentError('NOWPayments 查单缺少 payment_id', { code: 'guest_provider_reference_missing', statusCode: 400 });
        const result = await queryNowpaymentsPayment({
            channelConfig: context.channelConfig,
            secretValues: context.secretValues,
            requestOrigin: context.origin,
            paymentId: resolvedPaymentId
        }, typeof options.fetchImpl === 'function' ? { fetchImpl: options.fetchImpl } : { fetchImpl: defaultFetchImpl });
        const payload = result.response?.data && typeof result.response.data === 'object' ? result.response.data : {};
        const statusRaw = text(payload.payment_status || payload.status, '', 64).toLowerCase();
        const status = normalizeNowpaymentsPaymentStatus(statusRaw);
        const quoteAmount = getNowpaymentsQuoteAmount(payload);
        const settlement = normalizeNowpaymentsSettlement(payload, status);
        return {
            supported: true,
            provider,
            purpose: GUEST_PURPOSE,
            merchant_order_no: text(payload.order_id || merchantOrderNo, '', MAX_ORDER_REFERENCE_LENGTH) || null,
            provider_order_no: text(payload.order_id || orderNo, '', MAX_PROVIDER_REFERENCE_LENGTH) || null,
            provider_payment_id: text(payload.payment_id || payload.id || resolvedPaymentId, '', 120) || null,
            payment_id: text(payload.payment_id || payload.id || resolvedPaymentId, '', 120) || null,
            transaction_id: text(payload.outcome_transaction_hash || payload.payin_hash || payload.transaction_id || payload.txid, '', MAX_PROVIDER_REFERENCE_LENGTH) || null,
            status: settlement.effectiveStatus,
            status_raw: statusRaw,
            amount: quoteAmount,
            paid_amount: quoteAmount,
            actually_paid: settlement.actuallyPaid,
            actually_paid_text: settlement.actuallyPaidText,
            crypto_paid_amount: settlement.actuallyPaid,
            currency: normalizeCurrency(payload.price_currency || context.integration.priceCurrency),
            paid_currency: settlement.paidCurrency,
            pay_currency: settlement.paidCurrency,
            network_verified: settlement.networkVerified,
            actual_payment_verified: settlement.actualPaymentVerified,
            effective_status: settlement.effectiveStatus,
            response_payload: payload
        };
    }

    async function refundGuestPayment({
        provider: providerInput,
        site,
        providerOrderNo = '',
        merchantOrderNo = '',
        tradeNo = '',
        paymentId = '',
        money,
        ...options
    } = {}) {
        const provider = normalizeProvider(providerInput);
        const context = await resolveRuntime({ provider, site, ...options });
        if (provider === 'nowpayments') {
            return {
                supported: false,
                success: false,
                provider,
                status: 'blocked',
                code: 'guest_refund_not_supported',
                message: 'NOWPayments 游客订单退款需要人工核验收款地址和出款凭证，当前未启用自动退款。'
            };
        }
        const amount = normalizeDecimalAmount(money, '退款金额');
        const orderNo = text(providerOrderNo || merchantOrderNo, '', MAX_PROVIDER_REFERENCE_LENGTH);
        if (!orderNo && !tradeNo) throw new GuestShopPaymentError('易支付退款缺少订单号', { code: 'guest_provider_reference_missing', statusCode: 400 });
        const result = await refundZpayPayment({
            channelConfig: context.channelConfig,
            secretValues: context.secretValues,
            requestOrigin: context.origin,
            outTradeNo: orderNo,
            tradeNo,
            money: amount.amount
        }, typeof options.fetchImpl === 'function' ? { fetchImpl: options.fetchImpl } : { fetchImpl: defaultFetchImpl });
        const payload = result.response?.data && typeof result.response.data === 'object' ? result.response.data : {};
        const success = String(payload.code ?? '').trim() === '1';
        return {
            supported: true,
            success,
            provider,
            purpose: GUEST_PURPOSE,
            status: success ? 'refunded' : 'unknown',
            merchant_order_no: text(payload.out_trade_no || merchantOrderNo, '', MAX_ORDER_REFERENCE_LENGTH) || null,
            provider_order_no: text(payload.out_trade_no || orderNo, '', MAX_PROVIDER_REFERENCE_LENGTH) || null,
            transaction_id: text(payload.trade_no || tradeNo, '', MAX_PROVIDER_REFERENCE_LENGTH) || null,
            message: text(payload.msg, success ? '退款成功' : '易支付退款失败', 240),
            response_payload: payload
        };
    }

    return {
        createGuestPayment,
        verifyGuestWebhook,
        parseGuestWebhook,
        queryGuestPayment,
        refundGuestPayment,
        isProviderReady,
        // Compatibility aliases used by the first draft guest handlers.
        verifyWebhook: verifyGuestWebhook,
        parseWebhook: parseGuestWebhook,
        queryPayment: queryGuestPayment,
        refundPayment: refundGuestPayment,
        resolveRuntime
    };
}

// A factory is preferred so tests and serverless requests can inject config,
// secrets and fetch.  The default instance is intentionally lazy and does not
// touch Supabase until a method is called.
const defaultAdapter = createGuestShopPaymentAdapter();

module.exports = {
    GUEST_PURPOSE,
    NOWPAYMENTS_GUEST_PAY_CURRENCY,
    SUPPORTED_PROVIDERS,
    GuestShopPaymentError,
    buildMerchantOrderReference,
    buildProviderOrderReference,
    channelMatchesAllowlist,
    createGuestShopPaymentAdapter,
    createGuestPaymentAdapter: createGuestShopPaymentAdapter,
    defaultGuestShopPaymentAdapter: defaultAdapter,
    isProductionLikeRuntime,
    normalizeAllowedChannels,
    normalizeDecimalAmount,
    normalizeProvider,
    normalizeSite,
    safeUrl
};
