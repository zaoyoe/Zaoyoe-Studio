'use strict';

const crypto = require('node:crypto');
const defaultSecurity = require('../../../api/_lib/guest-shop/security');
const defaultGuestPricing = require('../../../api/_lib/guest-shop/pricing');
const defaultRequestSecurity = require('../../../api/_lib/request-security');

const GUEST_WEBHOOK_PROVIDERS = new Set(['zpay', 'nowpayments']);
const FINAL_PAYMENT_STATUSES = new Set(['paid', 'confirmed', 'finished', 'success', 'succeeded', 'completed', 'captured']);
const NOWPAYMENTS_GUEST_PAY_CURRENCY = 'usdtbsc';
// Payment provider calls are external side effects.  Keep a short-lived
// creation lease in the existing payment row so two HTTP instances cannot
// both call createGuestPayment for the same idempotent order.  The lease is
// deliberately persisted in last_error_* (there is no extra schema change in
// this rollout); an expired lease is treated as an unknown provider outcome,
// never as permission to blindly create a second payment.
const PAYMENT_CREATION_LEASE_CODE = 'payment_creation_in_progress';
const PAYMENT_CREATION_LEASE_VERSION = 'v1';
const DEFAULT_PAYMENT_CREATION_LEASE_MS = 2 * 60 * 1000;
const GUEST_CLAIM_COOKIE_NAME = 'guest_claim_proof';
const GUEST_CLAIM_COOKIE_VERSION = 'v1';
const GUEST_CLAIM_COOKIE_MAX_ITEMS = 4;
const GUEST_CLAIM_COOKIE_MAX_AGE_SECONDS = 2 * 60 * 60;
const MAX_CLAIM_FAILURE_ATTEMPTS = 20;
const CLAIM_FAILURE_UPDATE_RETRIES = 4;
const INVALID_WEBHOOK_AUDIT_BUCKET_MS = 5 * 60 * 1000;
const DEFAULT_GUEST_WEBHOOK_IP_LIMIT = 120;
const DEFAULT_GUEST_WEBHOOK_GLOBAL_LIMIT = 1200;
// Keep the HTTP-layer bounds in lock-step with the guest-shop SQL contract.
// The API validates these values before doing any inventory/provider side
// effect so a malformed deployment variable cannot create an order with an
// unexpected lifetime or disable webhook abuse controls.
const MIN_GUEST_ORDER_TTL_SECONDS = 300;
const MAX_GUEST_ORDER_TTL_SECONDS = 7200;
const MIN_PAYMENT_CREATION_LEASE_MS = 30_000;
const MAX_PAYMENT_CREATION_LEASE_MS = 15 * 60 * 1000;
const MAX_GUEST_WEBHOOK_GLOBAL_LIMIT = 100_000;
const MAX_GUEST_WEBHOOK_IP_LIMIT = 10_000;
// NUMERIC(14,2) in the migration has a maximum of 999999999999.99.
const MAX_GUEST_CASH_PRICE_MINOR = 99_999_999_999_999;

// Active status-query self-healing (webhook + throttled provider poll). The
// throttle values mirror the logged-in wallet recharge flow so a lost callback
// cannot leave a paid guest order stuck on `pending` indefinitely.
// Confirmed orders use a shorter throttle (3s) to accelerate fulfillment,
// while unpaid orders remain conservative (8s) to protect provider APIs.
const GUEST_STATUS_QUERY_EVENT_TYPE = 'status_query';
const GUEST_STATUS_QUERY_THROTTLE_MS = 8 * 1000;
const GUEST_STATUS_QUERY_CONFIRMED_THROTTLE_MS = 3 * 1000;
const GUEST_STATUS_QUERY_FORCE_THROTTLE_MS = 1200;
// Payment-row statuses that already represent a resolved provider outcome.
// They never need a live provider query from the buyer status endpoint.
const GUEST_STATUS_QUERY_RESOLVED_PAYMENT_STATUSES = new Set([
    'confirmed', 'refunded', 'chargeback', 'paid_unfulfillable',
    'failed', 'expired', 'amount_mismatch', 'overpaid', 'partial'
]);

function guestRuntimeConfigError(name, range = '') {
    const suffix = range ? ` (${range})` : '';
    const error = new Error(`invalid guest runtime configuration: ${String(name || 'unknown')}${suffix}`);
    error.statusCode = 503;
    error.code = 'guest_runtime_config_invalid';
    error.expose = false;
    error.configName = String(name || 'unknown');
    return error;
}

/**
 * Parse an environment integer without Number() coercion surprises.  Empty
 * values intentionally use the documented default; an explicitly supplied
 * malformed value fails closed instead of being silently clamped.
 */
function parseGuestRuntimeInteger(env, name, { defaultValue, min, max } = {}) {
    const rawValue = env?.[name];
    const raw = rawValue === undefined || rawValue === null ? '' : String(rawValue).trim();
    if (!raw) return defaultValue;
    if (!/^\d+$/u.test(raw)) throw guestRuntimeConfigError(name, `${min}-${max}`);
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
        throw guestRuntimeConfigError(name, `${min}-${max}`);
    }
    return parsed;
}

function paymentCreationLeaseMs(env = process.env) {
    return parseGuestRuntimeInteger(env, 'GUEST_SHOP_PAYMENT_CREATE_LEASE_MS', {
        defaultValue: DEFAULT_PAYMENT_CREATION_LEASE_MS,
        min: MIN_PAYMENT_CREATION_LEASE_MS,
        max: MAX_PAYMENT_CREATION_LEASE_MS
    });
}

function guestOrderTtlSeconds(env = process.env) {
    return parseGuestRuntimeInteger(env, 'GUEST_SHOP_ORDER_TTL_SECONDS', {
        defaultValue: 1800,
        min: MIN_GUEST_ORDER_TTL_SECONDS,
        max: MAX_GUEST_ORDER_TTL_SECONDS
    });
}

function guestWebhookLimits(env = process.env) {
    const globalLimit = parseGuestRuntimeInteger(env, 'GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT', {
        defaultValue: DEFAULT_GUEST_WEBHOOK_GLOBAL_LIMIT,
        min: 10,
        max: MAX_GUEST_WEBHOOK_GLOBAL_LIMIT
    });
    const ipLimit = parseGuestRuntimeInteger(env, 'GUEST_SHOP_WEBHOOK_IP_LIMIT', {
        defaultValue: DEFAULT_GUEST_WEBHOOK_IP_LIMIT,
        min: 5,
        max: MAX_GUEST_WEBHOOK_IP_LIMIT
    });
    if (globalLimit < ipLimit) {
        throw guestRuntimeConfigError(
            'GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT/GUEST_SHOP_WEBHOOK_IP_LIMIT',
            'global>=ip'
        );
    }
    return Object.freeze({ global: globalLimit, ip: ipLimit });
}

function createPaymentCreationLease(nowMs = Date.now(), randomBytes = crypto.randomBytes) {
    let token;
    try {
        token = randomBytes(18).toString('hex');
    } catch (_) {
        token = crypto.createHash('sha256').update(`${nowMs}:${Math.random()}`).digest('hex').slice(0, 36);
    }
    return {
        token,
        message: `${PAYMENT_CREATION_LEASE_VERSION}:${nowMs}:${token}`,
        issuedAtMs: nowMs
    };
}

function parsePaymentCreationLease(value) {
    const source = String(value || '').trim();
    const match = source.match(/^v1:(\d{10,16}):([a-f0-9]{36})$/u);
    if (!match) return null;
    const issuedAtMs = Number(match[1]);
    if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0) return null;
    return { issuedAtMs, token: match[2], message: source };
}

function isFreshPaymentCreationLease(value, nowMs, leaseMs) {
    const lease = parsePaymentCreationLease(value);
    if (!lease) return false;
    return nowMs >= lease.issuedAtMs && nowMs - lease.issuedAtMs < leaseMs;
}

function storedPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null ? value : {};
}

function storedGuestPaymentPricing(order, payment, computed = null) {
    const metadata = storedPlainObject(order?.metadata);
    const stored = storedPlainObject(metadata.payment_pricing);
    const total = order?.total_amount;
    if (stored.payable_amount != null
        && defaultGuestPricing.moneyAmountsEqual(stored.payable_amount, total)
        && (!payment || defaultGuestPricing.moneyAmountsEqual(payment.expected_amount, stored.payable_amount))) {
        return stored;
    }
    if (computed
        && defaultGuestPricing.moneyAmountsEqual(computed.payableAmount, total)
        && (!payment || defaultGuestPricing.moneyAmountsEqual(payment.expected_amount, computed.payableAmount))) {
        return computed.payload || defaultGuestPricing.buildGuestPaymentPricingPayload(computed);
    }
    return null;
}

function applyPayableSnapshot(order, payment, computed, metadata = null) {
    const payable = computed.payableAmount;
    const surcharge = computed.surchargeAmount || 0;
    const nextMetadata = {
        ...storedPlainObject(metadata || order?.metadata),
        credit_unit_amount: computed.baseAmount,
        payment_pricing: computed.payload || defaultGuestPricing.buildGuestPaymentPricingPayload(computed)
    };
    if (order && typeof order === 'object') {
        order.unit_amount = payable;
        order.total_amount = payable;
        order.expected_amount = payable;
        order.metadata = nextMetadata;
    }
    if (payment && typeof payment === 'object') {
        payment.expected_amount = payable;
        payment.payment_fee = surcharge;
    }
    return nextMetadata;
}

function storedText(value, maxLength = 1000) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const result = String(value).trim();
    if (!result || /[\u0000-\u0020\u007f]/u.test(result)) return '';
    return result.slice(0, maxLength);
}

function storedHttpsUrl(value, env = process.env) {
    const source = storedText(value, 2000);
    if (!source) return '';
    try {
        const parsed = new URL(source);
        // A checkout URL persisted by the server must remain an HTTPS URL in
        // production.  Even in local/test mode, reject javascript/data URLs.
        if (parsed.protocol !== 'https:'
            && !(parsed.protocol === 'http:' && !['production'].includes(String(env?.VERCEL_ENV || '').toLowerCase()))) {
            return '';
        }
        return parsed.toString();
    } catch (_) {
        return '';
    }
}

function webhookHeader(req, name) {
    const wanted = String(name || '').toLowerCase();
    for (const [key, value] of Object.entries(req?.headers || {})) {
        if (String(key).toLowerCase() !== wanted) continue;
        return Array.isArray(value) ? String(value[0] || '') : String(value || '');
    }
    return '';
}

function setWebhookSecurityHeaders(res) {
    res?.setHeader?.('Cache-Control', 'no-store');
    res?.setHeader?.('Referrer-Policy', 'no-referrer');
    res?.setHeader?.('X-Content-Type-Options', 'nosniff');
}

function setGuestSensitiveHeaders(res) {
    res?.setHeader?.('Cache-Control', 'no-store, max-age=0');
    res?.setHeader?.('Pragma', 'no-cache');
    res?.setHeader?.('X-Content-Type-Options', 'nosniff');
    res?.setHeader?.('Referrer-Policy', 'no-referrer');
}

function cookieHeaderValue(req, name) {
    const wanted = String(name || '').trim();
    if (!wanted) return '';
    const raw = String(webhookHeader(req, 'cookie') || '');
    for (const part of raw.split(';')) {
        const index = part.indexOf('=');
        if (index < 0 || part.slice(0, index).trim() !== wanted) continue;
        try {
            return decodeURIComponent(part.slice(index + 1).trim());
        } catch (_) {
            return '';
        }
    }
    return '';
}

function claimCookieKey(security, env) {
    try {
        const pepper = security.getGuestClaimPepper(env, { required: true });
        return crypto.createHash('sha256')
            .update(`guest-shop-claim-cookie\0${pepper}`, 'utf8')
            .digest();
    } catch (_) {
        return null;
    }
}

function decryptClaimCookie(value, security, env) {
    const source = String(value || '').trim();
    const parts = source.split('.');
    if (parts.length !== 4 || parts[0] !== GUEST_CLAIM_COOKIE_VERSION) return [];
    const key = claimCookieKey(security, env);
    if (!key) return [];
    try {
        const iv = Buffer.from(parts[1], 'base64url');
        const tag = Buffer.from(parts[2], 'base64url');
        const ciphertext = Buffer.from(parts[3], 'base64url');
        if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length || ciphertext.length > 4096) return [];
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        const parsed = JSON.parse(plaintext);
        if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.proofs)) return [];
        return parsed.proofs.filter((item) => item && typeof item === 'object')
            .slice(0, GUEST_CLAIM_COOKIE_MAX_ITEMS)
            .map((item) => ({
                orderNo: String(item.orderNo || '').trim(),
                secret: String(item.secret || '').trim(),
                expiresAt: String(item.expiresAt || '').trim()
            }))
            .filter((item) => item.orderNo && item.secret);
    } catch (_) {
        return [];
    }
}

function encryptClaimCookie(proofs, security, env) {
    const key = claimCookieKey(security, env);
    if (!key) return '';
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const plaintext = Buffer.from(JSON.stringify({ v: 1, proofs }), 'utf8');
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const tag = cipher.getAuthTag();
        return [
            GUEST_CLAIM_COOKIE_VERSION,
            iv.toString('base64url'),
            tag.toString('base64url'),
            ciphertext.toString('base64url')
        ].join('.');
    } catch (_) {
        return '';
    }
}

function claimCookieMaxAge(order) {
    const expiry = Date.parse(String(order?.expires_at || ''));
    if (!Number.isFinite(expiry)) return GUEST_CLAIM_COOKIE_MAX_AGE_SECONDS;
    return Math.max(60, Math.min(
        GUEST_CLAIM_COOKIE_MAX_AGE_SECONDS,
        Math.floor((expiry - Date.now()) / 1000)
    ));
}

function setClaimProofCookie(req, res, order, claimSecret, security, env) {
    const orderNo = String(order?.order_no || '').trim();
    const secret = String(claimSecret || '').trim();
    if (!orderNo || !secret || !res?.setHeader) return;
    const existing = decryptClaimCookie(cookieHeaderValue(req, GUEST_CLAIM_COOKIE_NAME), security, env)
        .filter((item) => item.orderNo !== orderNo && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()));
    const proofs = [{ orderNo, secret, expiresAt: String(order?.expires_at || '') }, ...existing]
        .slice(0, GUEST_CLAIM_COOKIE_MAX_ITEMS);
    const token = encryptClaimCookie(proofs, security, env);
    if (!token) return;
    const maxAge = claimCookieMaxAge(order);
    const cookie = `${GUEST_CLAIM_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
    let current = res.getHeader?.('Set-Cookie');
    if (!Array.isArray(current)) current = current ? [String(current)] : [];
    res.setHeader('Set-Cookie', [...current, cookie]);
}

function claimSecretFromCookie(req, order, security, env) {
    const orderNo = String(order?.order_no || '').trim();
    if (!orderNo) return '';
    const encoded = cookieHeaderValue(req, GUEST_CLAIM_COOKIE_NAME);
    const proofs = decryptClaimCookie(encoded, security, env);
    const proof = proofs.find((item) => item.orderNo === orderNo
        && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()));
    return String(proof?.secret || '').trim();
}

function webhookError(message, code, statusCode = 400, expose = true) {
    const error = new Error(String(message || '回调请求无效'));
    error.code = String(code || 'guest_webhook_invalid');
    error.statusCode = statusCode;
    error.expose = expose;
    return error;
}

function normalizeWebhookReference(value, maxLength = 300) {
    const normalized = String(value ?? '').trim();
    if (!normalized || /[\u0000-\u0020\u007f]/u.test(normalized)) return '';
    return normalized.slice(0, maxLength);
}

function normalizeWebhookEventKey(value, fallback, provider, bodyHash) {
    const candidate = normalizeWebhookReference(value, 300) || normalizeWebhookReference(fallback, 300);
    if (candidate && candidate.length <= 300) return candidate;
    const digest = crypto.createHash('sha256').update(`${provider}:${bodyHash}`).digest('hex');
    return `${provider}:body:${digest}`.slice(0, 300);
}

function invalidWebhookAuditBucketKey(provider, clientIp, nowMs = Date.now(), env = process.env) {
    const normalizedProvider = normalizeWebhookReference(provider, 80) || 'unknown';
    const principal = normalizeWebhookReference(clientIp, 160) || 'unknown';
    const pepper = String(
        env?.GUEST_SHOP_REQUEST_HASH_PEPPER
        || env?.GUEST_SHOP_CLAIM_PEPPER
        || 'guest-shop-webhook-audit'
    );
    const principalHash = crypto.createHmac('sha256', pepper)
        .update(principal, 'utf8')
        .digest('hex')
        .slice(0, 32);
    const bucket = Math.floor(Number(nowMs) / INVALID_WEBHOOK_AUDIT_BUCKET_MS);
    return `${normalizedProvider}:invalid-bucket:${bucket}:${principalHash}`.slice(0, 300);
}

/**
 * Deterministic, provider-scoped event key for an active status query. The
 * payment id is already globally unique, so one payment can only ever own one
 * query event and retries collapse onto the same row instead of accumulating
 * duplicates.
 */
function statusQueryEventKey(provider, { paymentId } = {}) {
    const normalizedProvider = normalizeWebhookReference(provider, 80).toLowerCase() || 'unknown';
    const normalizedPaymentId = normalizeWebhookReference(paymentId, 80) || 'unknown';
    return `${normalizedProvider}:status-query:${normalizedPaymentId}`.slice(0, 300);
}

function toRawBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (typeof value === 'string') return Buffer.from(value, 'utf8');
    return null;
}

async function readStrictWebhookBody(req, security) {
    // A parsed object is not an acceptable substitute for signed wire bytes.
    // Vercel's body parser must be disabled on both provider routes.
    const suppliedRaw = toRawBuffer(req?.rawBody);
    if (suppliedRaw) return suppliedRaw;

    if (req?.body !== undefined && req?.body !== null) {
        const body = toRawBuffer(req.body);
        if (!body) throw webhookError('无法取得可验签的原始回调内容', 'guest_webhook_raw_body_unavailable', 400);
        return body;
    }

    if (typeof security?.readRawBodyWithLimit !== 'function') {
        throw webhookError('回调原始请求体读取器不可用', 'guest_webhook_raw_body_unavailable', 503, false);
    }
    const rawBody = await security.readRawBodyWithLimit(req, {
        maxBytes: security.DEFAULT_WEBHOOK_BODY_LIMIT
    });
    const buffer = toRawBuffer(rawBody);
    if (!buffer || !buffer.length) throw webhookError('回调请求体不能为空', 'guest_webhook_body_empty', 400);
    return buffer;
}

function decodeWebhookBody(rawBody) {
    try {
        if (typeof TextDecoder === 'function') {
            return new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
        }
        return rawBody.toString('utf8');
    } catch (_) {
        throw webhookError('回调请求体编码无效', 'guest_webhook_invalid_utf8', 400);
    }
}

function parseWebhookPayload(provider, rawBody, req) {
    const source = decodeWebhookBody(rawBody);
    const contentType = webhookHeader(req, 'content-type').split(';', 1)[0].trim().toLowerCase();
    if (provider === 'zpay') {
        if (contentType === 'application/json' || contentType.endsWith('+json')) {
            throw webhookError('易支付回调必须使用表单格式', 'guest_webhook_content_type_invalid', 415);
        }
        const params = new URLSearchParams(source);
        const payload = {};
        for (const [key, value] of params.entries()) {
            if (Object.prototype.hasOwnProperty.call(payload, key)) {
                throw webhookError('回调字段重复', 'guest_webhook_duplicate_field', 400);
            }
            payload[key] = value;
        }
        if (!Object.keys(payload).length) throw webhookError('回调载荷为空', 'guest_webhook_payload_invalid', 400);
        return payload;
    }

    if (contentType && !contentType.includes('json') && contentType !== 'text/plain') {
        throw webhookError('NOWPayments 回调必须使用 JSON 格式', 'guest_webhook_content_type_invalid', 415);
    }
    let payload;
    try {
        payload = JSON.parse(source);
    } catch (_) {
        throw webhookError('回调不是有效 JSON', 'guest_webhook_payload_invalid', 400);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw webhookError('回调载荷必须是 JSON 对象', 'guest_webhook_payload_invalid', 400);
    }
    return payload;
}

function rawBodyHash(security, rawBody) {
    if (typeof security?.hashRawBody === 'function') return security.hashRawBody(rawBody);
    return crypto.createHash('sha256').update(rawBody).digest('hex');
}

function isUniqueViolation(error) {
    return String(error?.code || '').trim() === '23505';
}

function normalizeObservedAmount(value) {
    const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function amountMinorMatches(security, expected, received, currency) {
    if (typeof security?.moneyMinorEqual === 'function') {
        return security.moneyMinorEqual(Math.round(Number(expected) * 100), received, { currency });
    }
    const expectedMinor = Math.round(Number(expected) * 100);
    const receivedMinor = Math.round(Number(received) * 100);
    return Number.isSafeInteger(expectedMinor) && expectedMinor === receivedMinor;
}

function isFinalPaymentStatus(value) {
    return FINAL_PAYMENT_STATUSES.has(String(value || '').trim().toLowerCase());
}

function isProductionLikeRuntime(env = process.env) {
    return [env?.VERCEL_ENV, env?.RAILWAY_ENVIRONMENT_NAME, env?.DEPLOYMENT_TIER, env?.APP_ENV]
        .map((value) => String(value || '').trim().toLowerCase())
        .includes('production');
}

function parsePositiveDecimal(value) {
    const source = typeof value === 'number'
        ? (Number.isFinite(value) ? String(value) : '')
        : String(value ?? '').trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(source)) return null;
    const [wholeText, fractionText = ''] = source.split('.');
    const fraction = fractionText.replace(/0+$/u, '');
    const scale = fraction.length;
    const numerator = BigInt(wholeText) * (10n ** BigInt(scale)) + BigInt(fraction || '0');
    return numerator > 0n ? { numerator, scale } : null;
}

function decimalAtLeast(actual, expected) {
    const actualValue = parsePositiveDecimal(actual);
    const expectedValue = parsePositiveDecimal(expected);
    if (!actualValue || !expectedValue) return false;
    const scale = Math.max(actualValue.scale, expectedValue.scale);
    return actualValue.numerator * (10n ** BigInt(scale - actualValue.scale))
        >= expectedValue.numerator * (10n ** BigInt(scale - expectedValue.scale));
}

function decimalEqual(actual, expected) {
    const actualValue = parsePositiveDecimal(actual);
    const expectedValue = parsePositiveDecimal(expected);
    if (!actualValue || !expectedValue) return false;
    const scale = Math.max(actualValue.scale, expectedValue.scale);
    return actualValue.numerator * (10n ** BigInt(scale - actualValue.scale))
        === expectedValue.numerator * (10n ** BigInt(scale - expectedValue.scale));
}

/**
 * Normalize a server-owned fiat price to integer minor units.  Database
 * numeric values can arrive as strings, so using Number() directly here
 * would admit Infinity, exponent notation, unsafe cents, or a value that
 * rounds down to zero.  Return null rather than throwing: callers expose the
 * same generic product-unavailable response and never reserve inventory for a
 * malformed price.
 */
function normalizeGuestCashPrice(value, security = defaultSecurity, currency = '') {
    const parser = typeof security?.parseMoneyMinor === 'function'
        ? security.parseMoneyMinor
        : defaultSecurity.parseMoneyMinor;
    if (typeof parser !== 'function') return null;
    try {
        const minor = parser(value, {
            currency,
            field: 'guest_cash_price',
            maxMinor: MAX_GUEST_CASH_PRICE_MINOR
        });
        if (!Number.isSafeInteger(minor) || minor <= 0 || minor > MAX_GUEST_CASH_PRICE_MINOR) return null;
        return {
            minor,
            amount: Number((minor / 100).toFixed(2)),
            text: `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`
        };
    } catch (_) {
        return null;
    }
}

function normalizeStoredPositiveDecimal(value, { maxScale = 18, maxDigits = 40 } = {}) {
    const parsed = parsePositiveDecimal(value);
    if (!parsed || parsed.scale > maxScale || parsed.numerator.toString().length > maxDigits) return null;
    const numeric = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return { numeric, value: parsed };
}

function providerQuoteChecks(provider, normalized, expected, security = defaultSecurity) {
    const failures = [];
    if (provider !== 'nowpayments') return { valid: true, failures };

    const paidCurrency = String(normalized?.pay_currency || normalized?.paid_currency || '').trim().toLowerCase();
    if (paidCurrency !== NOWPAYMENTS_GUEST_PAY_CURRENCY || normalized?.network_verified !== true) {
        failures.push('network');
    }

    const metadata = expected?.provider_metadata && typeof expected.provider_metadata === 'object'
        ? expected.provider_metadata
        : {};
    const expectedQuote = normalizeObservedAmount(metadata.price_amount);
    const receivedQuote = normalizeObservedAmount(normalized?.price_amount ?? normalized?.paid_amount ?? normalized?.amount);
    const quoteCurrency = String(metadata.price_currency || '').trim().toLowerCase();
    const receivedQuoteCurrency = String(normalized?.provider_currency || normalized?.currency || '').trim().toLowerCase();
    if (!(expectedQuote > 0) || !(receivedQuote > 0) || !quoteCurrency || receivedQuoteCurrency !== quoteCurrency
        || !amountMinorMatches(security, expectedQuote, receivedQuote, quoteCurrency)) {
        failures.push('quote');
    }

    const expectedPayAmount = metadata.pay_amount_text ?? metadata.pay_amount;
    const actuallyPaid = normalized?.actually_paid_text
        ?? normalized?.actually_paid
        ?? normalized?.crypto_paid_amount;
    // A final NOWPayments notification must contain a positive crypto amount
    // no smaller than the immutable checkout quote.
    if (!decimalAtLeast(actuallyPaid, expectedPayAmount)) {
        failures.push('actually_paid');
    }
    return { valid: failures.length === 0, failures };
}

const ALLOWED_ORDER_FIELDS = new Set([
    'site', 'productId', 'product_id', 'skuId', 'sku_id', 'quantity',
    'idempotencyKey', 'idempotency_key', 'email', 'provider', 'providerKey',
    'provider_key', 'channel', 'paymentChannel', 'payment_channel'
]);

function createGuestShopHandlers({
    admin = {},
    requestSecurity = {},
    security = defaultSecurity,
    site = {},
    paymentAdapter = null,
    kickFulfillment = null,
    env = process.env
} = {}) {
    const sendJson = admin.sendJson || ((res, status, payload) => {
        res.statusCode = status;
        res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(payload));
    });
    const getSupabase = () => {
        try {
            return admin.getOptionalSupabaseAdmin?.() || admin.getSupabaseAdmin?.() || null;
        } catch (_) {
            return null;
        }
    };
    // Keep dependency injection useful in tests, but never let a partial or
    // missing security module turn a production guest endpoint into an
    // unprotected allow-all path. The shared implementation returns a
    // fail-closed result when production persistence is unavailable.
    const takeRateLimitToken = typeof requestSecurity.takeRateLimitToken === 'function'
        ? requestSecurity.takeRateLimitToken
        : defaultRequestSecurity.takeRateLimitToken;
    const applyRateLimitHeaders = typeof requestSecurity.applyRateLimitHeaders === 'function'
        ? requestSecurity.applyRateLimitHeaders
        : defaultRequestSecurity.applyRateLimitHeaders;
    const resolveClientIp = typeof requestSecurity.resolveClientIp === 'function'
        ? requestSecurity.resolveClientIp
        : defaultRequestSecurity.resolveClientIp;

    function kickConfirmedOrder(orderId) {
        const id = String(orderId || '').trim();
        if (!id || typeof kickFulfillment !== 'function') return;
        try {
            // Fulfillment is an optimization over the durable worker timer.
            // Do not hold a webhook/status response open on inventory work.
            Promise.resolve(kickFulfillment(id)).catch(() => {});
        } catch (_) {
            // A malformed/inactive kicker must never turn a confirmed payment
            // into a failed buyer-facing response.
        }
    }

    function failResponse(res, error, fallback = '游客购买请求失败') {
        const status = Number(error?.statusCode) || 500;
        const expose = error?.expose !== false && status < 500;
        return sendJson(res, status, {
            success: false,
            code: String(error?.code || (status === 429 ? 'rate_limited' : 'guest_shop_request_failed')),
            message: expose ? String(error?.message || fallback) : fallback
        });
    }

    function rateLimitUnavailable(res) {
        return sendJson(res, 503, {
            success: false,
            code: 'rate_limit_unavailable',
            message: '请求保护服务暂不可用，请稍后重试',
            retry_after_seconds: 60
        });
    }

    function clientIpForRateLimit(req) {
        try {
            return resolveClientIp(req, { env }) || 'unknown';
        } catch (_) {
            // Losing an IP hint must collapse traffic into the conservative
            // shared bucket; it must not bypass the limiter altogether.
            return 'unknown';
        }
    }

    function applyGuestRateLimitHeaders(res, result) {
        try {
            applyRateLimitHeaders(res, result);
            return true;
        } catch (_) {
            rateLimitUnavailable(res);
            return false;
        }
    }

    async function limit(req, res, scope, options = {}) {
        const ip = clientIpForRateLimit(req);
        let result;
        try {
            result = await takeRateLimitToken({
                supabase: getSupabase(),
                key: `guest-shop:${scope}:${ip}`,
                limit: Number(options.limit || 30),
                windowMs: Number(options.windowMs || 60_000),
                env,
                // A production guest checkout cannot silently fall back to a
                // per-instance memory bucket: a horizontally scaled deployment
                // would then lose the abuse-control boundary. Local/test runs may
                // still use the in-memory implementation explicitly.
                requirePersistent: isProductionLikeRuntime(env)
            });
        } catch (_) {
            // The limiter is part of the authorization boundary. Treat an
            // implementation failure exactly like an unavailable persistent
            // store, before reading the request body or touching business data.
            rateLimitUnavailable(res);
            return false;
        }
        if (!result || typeof result !== 'object' || typeof result.allowed !== 'boolean') {
            rateLimitUnavailable(res);
            return false;
        }
        if (!applyGuestRateLimitHeaders(res, result)) return false;
        if (!result.allowed) {
            sendJson(res, result.unavailable ? 503 : 429, {
                success: false,
                code: result.unavailable ? 'rate_limit_unavailable' : 'rate_limited',
                message: result.unavailable ? '请求保护服务暂不可用，请稍后重试' : '请求过于频繁，请稍后重试',
                retry_after_seconds: result.retryAfterSeconds || 1
            });
            return false;
        }
        return true;
    }

    async function webhookLimit(req, res, provider) {
        // Webhook endpoints are internet-facing and also write audit rows.
        // Enforce both a provider-wide bucket and a source-IP bucket before
        // reading/parsing the body, so invalid traffic cannot amplify storage
        // or CPU. In production, an unavailable persistent limiter is a hard
        // failure rather than a per-instance memory fallback.
        if (typeof takeRateLimitToken !== 'function') {
            if (isProductionLikeRuntime(env)) {
                rateLimitUnavailable(res);
                return false;
            }
            return true;
        }
        const normalizedProvider = normalizeWebhookReference(provider, 80) || 'unknown';
        const ip = clientIpForRateLimit(req);
        // Parse before taking either token.  Besides rejecting malformed
        // values, this avoids consuming one bucket when the second value is
        // invalid and makes a bad deploy fail closed before raw-body work.
        const configuredLimits = guestWebhookLimits(env);
        const checks = [
            {
                key: `guest-shop:webhook:${normalizedProvider}:global`,
                limit: configuredLimits.global,
                windowMs: 60_000
            },
            {
                key: `guest-shop:webhook:${normalizedProvider}:ip:${ip}`,
                limit: configuredLimits.ip,
                windowMs: 60_000
            }
        ];
        for (const check of checks) {
            let result;
            try {
                result = await takeRateLimitToken({
                    supabase: getSupabase(),
                    key: check.key,
                    limit: check.limit,
                    windowMs: check.windowMs,
                    env,
                    requirePersistent: isProductionLikeRuntime(env)
                });
            } catch (_) {
                rateLimitUnavailable(res);
                return false;
            }
            if (!result || typeof result !== 'object' || typeof result.allowed !== 'boolean') {
                rateLimitUnavailable(res);
                return false;
            }
            if (!applyGuestRateLimitHeaders(res, result)) return false;
            if (!result.allowed) {
                sendJson(res, result.unavailable ? 503 : 429, {
                    success: false,
                    code: result.unavailable ? 'rate_limit_unavailable' : 'rate_limited',
                    message: result.unavailable ? '请求保护服务暂不可用，请稍后重试' : '请求过于频繁，请稍后重试',
                    retry_after_seconds: result.retryAfterSeconds || 1
                });
                return false;
            }
        }
        return true;
    }

    function normalizeSiteValue(value) {
        if (typeof site.requireSupportedSite === 'function') {
            return site.requireSupportedSite(value);
        }
        return security.normalizeGuestSite(value);
    }

    function queryValue(req, name) {
        const value = req?.query?.[name];
        if (Array.isArray(value)) return value[0];
        return value;
    }

    function ensureAllowlist(body) {
        for (const key of Object.keys(body || {})) {
            if (!ALLOWED_ORDER_FIELDS.has(key)) {
                const error = new security.GuestShopSecurityError(`${key} 不允许由客户端提供`, {
                    field: key,
                    code: 'unknown_field'
                });
                throw error;
            }
        }
    }

    function hashContact(value) {
        if (!value) return null;
        const pepper = String(env.GUEST_SHOP_CONTACT_HASH_PEPPER || env.GUEST_SHOP_CLAIM_PEPPER || '').trim();
        if (!pepper) return null;
        return crypto.createHmac('sha256', pepper).update(String(value).trim().toLowerCase()).digest('hex');
    }

    function hashRequestAttribute(value) {
        const pepper = String(env.GUEST_SHOP_REQUEST_HASH_PEPPER || env.GUEST_SHOP_CLAIM_PEPPER || '').trim();
        if (!pepper || !value) return null;
        return crypto.createHmac('sha256', pepper).update(String(value)).digest('hex');
    }

    async function loadGuestSkuPricing({ supabase, productId, skuId, siteName }) {
        if (!supabase?.from) throw Object.assign(new Error('数据库服务不可用'), { statusCode: 503, expose: false });
        const productQuery = await supabase.from('shop_products')
            .select('id,name,is_active,allow_guest_purchase,delivery_type,manual_delivery,guest_payment_channels,quantity_rules,quantity_rules_intl,flash_sale_price,flash_sale_price_intl,flash_sale_end,flash_sale_end_intl')
            .eq('id', productId).maybeSingle();
        if (productQuery.error) throw productQuery.error;
        const product = productQuery.data;
        const skuQuery = await supabase.from('shop_product_skus')
            .select('id,product_id,sku_name,is_active,allow_guest_purchase,manual_delivery,guest_payment_channels,price_points,price_points_intl,quantity_rules,quantity_rules_intl,is_default')
            .eq('id', skuId).eq('product_id', productId).maybeSingle();
        if (skuQuery.error) throw skuQuery.error;
        const sku = skuQuery.data;
        const enabled = Boolean(sku?.allow_guest_purchase ?? product?.allow_guest_purchase);
        const currency = security.currencyForSite(siteName);
        const creditAmount = defaultGuestPricing.resolveGuestCreditUnitAmount({
            site: siteName,
            skuPricePoints: sku?.price_points,
            skuPricePointsIntl: sku?.price_points_intl,
            skuQuantityRules: sku?.quantity_rules,
            skuQuantityRulesIntl: sku?.quantity_rules_intl,
            skuIsDefault: sku?.is_default === true,
            productQuantityRules: product?.quantity_rules,
            productQuantityRulesIntl: product?.quantity_rules_intl,
            productFlashSalePrice: product?.flash_sale_price,
            productFlashSalePriceIntl: product?.flash_sale_price_intl,
            productFlashSaleEnd: product?.flash_sale_end,
            productFlashSaleEndIntl: product?.flash_sale_end_intl
        });
        const price = creditAmount == null
            ? null
            : normalizeGuestCashPrice(creditAmount, security, currency);
        const deliveryType = String(product?.delivery_type || 'KEY').trim().toUpperCase();
        if (!product?.is_active || !sku?.is_active || !enabled || deliveryType !== 'KEY' || product?.manual_delivery || sku?.manual_delivery || !price) {
            const error = new security.GuestShopSecurityError('商品暂不支持游客购买', { statusCode: 409, code: 'guest_product_unavailable' });
            throw error;
        }
        return {
            product,
            sku,
            unitAmount: price.amount,
            unitAmountMinor: price.minor,
            currency,
            channels: sku?.guest_payment_channels ?? product?.guest_payment_channels ?? []
        };
    }

    async function parseJson(req) {
        if (typeof security.readJsonBodyWithLimit === 'function') {
            return security.readJsonBodyWithLimit(req, {
                maxBytes: security.DEFAULT_JSON_BODY_LIMIT,
                requireContentType: true
            });
        }
        return admin.parseJsonBody(req);
    }

    function paymentIdentity(order, payment) {
        const paymentId = String(order?.payment_order_id || '').trim();
        const orderId = String(order?.order_id || '').trim();
        const merchantOrderNo = String(order?.merchant_order_no || order?.order_no || '').trim();
        if (!paymentId || !orderId || !merchantOrderNo) {
            throw Object.assign(new Error('支付订单引用缺失'), {
                statusCode: 503,
                code: 'guest_payment_reference_missing',
                expose: false
            });
        }
        if (!payment || String(payment.id || '') !== paymentId
            || String(payment.guest_order_id || '') !== orderId
            || String(payment.merchant_order_no || '') !== merchantOrderNo
            || String(payment.purpose || '') !== 'shop_direct') {
            throw Object.assign(new Error('支付订单绑定不一致'), {
                statusCode: 409,
                code: 'guest_payment_binding_mismatch'
            });
        }
        return { paymentId, orderId, merchantOrderNo };
    }

    async function loadPaymentIntent(order) {
        const db = getSupabase();
        if (!db?.from) {
            throw Object.assign(new Error('数据库服务不可用'), {
                statusCode: 503,
                code: 'guest_database_unavailable',
                expose: false
            });
        }
        // The create-order RPC returns payment_order_id/order_id, while a
        // status lookup loads the persisted guest order row (which only has
        // its own `id`). Support both shapes without relaxing the binding:
        // status recovery still requires the unique guest_order_id and exact
        // merchant order number, and create retries still pin the payment id.
        const orderId = String(order?.order_id || order?.id || '').trim();
        const merchantOrderNo = String(order?.merchant_order_no || order?.order_no || '').trim();
        const paymentId = String(order?.payment_order_id || '').trim();
        if (!orderId || !merchantOrderNo) {
            throw Object.assign(new Error('支付订单引用缺失'), {
                statusCode: 503,
                code: 'guest_payment_reference_missing',
                expose: false
            });
        }
        let query = db.from('guest_shop_payment_orders').select('*')
            .eq('guest_order_id', orderId)
            .eq('merchant_order_no', merchantOrderNo)
            .eq('purpose', 'shop_direct');
        if (paymentId) query = query.eq('id', paymentId);
        if (typeof query.maybeSingle === 'function') query = query.maybeSingle();
        const result = await query;
        if (result?.error) throw result.error;
        if (!result?.data) {
            throw Object.assign(new Error('支付订单不存在'), {
                statusCode: 503,
                code: 'guest_payment_order_missing',
                expose: false
            });
        }
        paymentIdentity({
            payment_order_id: result.data.id,
            order_id: orderId,
            merchant_order_no: merchantOrderNo
        }, result.data);
        return result.data;
    }

    function paymentStatusIsTerminal(status) {
        return ['confirmed', 'refunded', 'chargeback', 'expired', 'failed', 'amount_mismatch', 'overpaid', 'partial']
            .includes(String(status || '').trim().toLowerCase());
    }

    function buildStoredCheckout(order, payment) {
        const provider = String(payment?.provider || '').trim().toLowerCase();
        const channel = String(payment?.channel || provider).trim().toLowerCase();
        const metadata = storedPlainObject(payment?.provider_metadata);
        const providerOrderNo = storedText(payment?.provider_order_no, 300);
        if (!provider || !providerOrderNo || metadata.provider && String(metadata.provider).toLowerCase() !== provider
            || metadata.purpose && String(metadata.purpose) !== 'shop_direct') {
            return null;
        }
        if (metadata.provider_order_no && storedText(metadata.provider_order_no, 300) !== providerOrderNo) {
            return null;
        }
        const currency = String(order?.currency || payment?.currency || '').trim().toUpperCase();
        const amountSnapshot = normalizeGuestCashPrice(order?.total_amount, security, currency);
        if (!amountSnapshot || currency !== 'CNY') return null;
        const amount = amountSnapshot.amount;

        if (provider === 'zpay') {
            const checkoutUrl = storedHttpsUrl(metadata.checkout_url || payment.checkout_reference, env);
            if (!checkoutUrl) return null;
            const qrcodeUrl = storedHttpsUrl(metadata.qrcode_url, env) || null;
            const imageUrl = storedHttpsUrl(metadata.qrcode_image_url, env) || null;
            return {
                supported: true,
                provider,
                channel,
                purpose: 'shop_direct',
                merchant_order_no: String(payment.merchant_order_no),
                provider_order_no: providerOrderNo,
                checkout_url: checkoutUrl,
                payment_url: checkoutUrl,
                qrcode_url: qrcodeUrl,
                qrcode_image_url: imageUrl,
                amount,
                amount_text: amount.toFixed(2),
                currency,
                status: 'created',
                checkout: {
                    provider,
                    channel,
                    checkout_url: checkoutUrl,
                    qrcode_url: qrcodeUrl,
                    qrcode_image_url: imageUrl,
                    amount,
                    currency
                }
            };
        }

        if (provider === 'nowpayments') {
            const paymentId = storedText(metadata.payment_id || payment.checkout_reference, 120);
            const payAddress = storedText(metadata.pay_address, 240);
            const payCurrency = storedText(metadata.pay_currency, 40).toLowerCase();
            const payAmountText = storedText(metadata.pay_amount_text, 80);
            const priceCurrency = storedText(metadata.price_currency, 16).toLowerCase();
            const payAmountSnapshot = normalizeStoredPositiveDecimal(
                payAmountText || metadata.pay_amount,
                { maxScale: 18, maxDigits: 40 }
            );
            const storedNumericPayAmount = metadata.pay_amount === undefined || metadata.pay_amount === null
                ? null
                : normalizeStoredPositiveDecimal(metadata.pay_amount, { maxScale: 18, maxDigits: 40 });
            const priceAmountSnapshot = normalizeGuestCashPrice(metadata.price_amount, security, priceCurrency.toUpperCase());
            if (!paymentId || !payAddress || !payAmountSnapshot
                || (payAmountText && !storedNumericPayAmount)
                || (payAmountText && !decimalEqual(payAmountText, metadata.pay_amount))
                || payCurrency !== NOWPAYMENTS_GUEST_PAY_CURRENCY
                || !priceAmountSnapshot || !['cny', 'usd'].includes(priceCurrency)) return null;
            const payAmount = payAmountSnapshot.numeric;
            const priceAmount = priceAmountSnapshot.amount;
            return {
                supported: true,
                provider,
                channel,
                purpose: 'shop_direct',
                merchant_order_no: String(payment.merchant_order_no),
                provider_order_no: providerOrderNo,
                provider_payment_id: paymentId,
                payment_id: paymentId,
                checkout_url: '',
                payment_url: '',
                qr_data: payAddress,
                pay_address: payAddress,
                pay_amount: payAmount,
                pay_amount_text: payAmountText || String(payAmount),
                pay_currency: payCurrency,
                price_amount: priceAmount,
                price_currency: priceCurrency,
                amount,
                amount_text: amount.toFixed(2),
                currency,
                quote_expires_at: storedText(metadata.quote_expires_at, 80) || null,
                status: 'created',
                checkout: {
                    provider,
                    channel,
                    payment_id: paymentId,
                    pay_address: payAddress,
                    pay_amount: payAmount,
                    pay_amount_text: payAmountText || String(payAmount),
                    pay_currency: payCurrency,
                    price_amount: priceAmount,
                    price_currency: priceCurrency,
                    qr_data: payAddress,
                    quote_expires_at: storedText(metadata.quote_expires_at, 80) || null,
                    amount,
                    currency
                }
            };
        }
        return null;
    }

function responseOrder(order, claimSecret, extras = {}) {
        const result = {
            order_no: order.order_no,
            payment_order_id: order.payment_order_id,
            amount: extras.amount ?? order.total_amount,
            currency: order.currency,
            expires_at: order.expires_at
        };
        const paymentPricing = extras.payment_pricing
            || storedGuestPaymentPricing(order, extras.payment, extras.computed);
        if (paymentPricing) result.payment_pricing = paymentPricing;
        // The recovery code is a high-entropy bearer credential.  It is
        // returned only in the order-creation response (never in status,
        // webhook, logs or provider metadata) so a buyer may move to another
        // device.  The client must display it once and never persist it.
        if (typeof claimSecret === 'string' && /^[A-Za-z0-9_-]{40,200}$/u.test(claimSecret.trim())) {
            result.recovery_code = claimSecret.trim();
        }
        return result;
    }

    function publicOrderSnapshot(order, extras = {}) {
        const snapshot = {
            order_no: order.order_no,
            payment_status: order.payment_status,
            fulfillment_status: order.fulfillment_status,
            refund_status: order.refund_status,
            amount: order.total_amount,
            currency: order.currency,
            expires_at: order.expires_at
        };
        const paymentPricing = storedGuestPaymentPricing(order, extras.payment, extras.computed);
        if (paymentPricing) snapshot.payment_pricing = paymentPricing;
        return snapshot;
    }

    async function acquirePaymentCreationLease(order, payment) {
        const status = String(payment?.status || '').trim().toLowerCase();
        if (status !== 'pending') return { acquired: false, reason: 'status', payment };
        const nowMs = Date.now();
        const leaseMs = paymentCreationLeaseMs(env);
        const currentCode = String(payment?.last_error_code || '').trim();
        const currentMessage = String(payment?.last_error_message || '').trim();
        if (currentCode === PAYMENT_CREATION_LEASE_CODE) {
            if (isFreshPaymentCreationLease(currentMessage, nowMs, leaseMs)) {
                return { acquired: false, reason: 'in_progress', payment };
            }
            // A stale marker means an earlier provider request may have been
            // accepted but its response was lost.  Do not take over and issue
            // a second charge; reconciliation must query the provider first.
            return { acquired: false, reason: 'stale', payment };
        }
        // Any other error marker on a pending row is a prior failed/unknown
        // attempt.  Creating a new provider order would be unsafe and could
        // duplicate a charge, so leave it for reconciliation.
        if (currentCode || currentMessage) return { acquired: false, reason: 'blocked', payment };

        const lease = createPaymentCreationLease(nowMs);
        const db = getSupabase();
        let query = db.from('guest_shop_payment_orders').update({
            last_error_code: PAYMENT_CREATION_LEASE_CODE,
            last_error_message: lease.message,
            updated_at: new Date(nowMs).toISOString()
        }).eq('id', String(order.payment_order_id))
            .eq('guest_order_id', String(order.order_id))
            .eq('merchant_order_no', String(order.merchant_order_no || order.order_no))
            .eq('purpose', 'shop_direct')
            .eq('status', 'pending');
        if (typeof query.is === 'function') {
            query = query.is('last_error_code', null).is('last_error_message', null);
        } else {
            query = query.eq('last_error_code', null).eq('last_error_message', null);
        }
        if (typeof query.select === 'function') query = query.select('*').maybeSingle();
        const result = await query;
        if (result?.error) throw result.error;
        if (result?.data) return { acquired: true, lease, payment: result.data };
        const refreshed = await loadPaymentIntent(order);
        const refreshedCode = String(refreshed.last_error_code || '').trim();
        if (refreshedCode === PAYMENT_CREATION_LEASE_CODE
            && isFreshPaymentCreationLease(refreshed.last_error_message, Date.now(), leaseMs)) {
            return { acquired: false, reason: 'in_progress', payment: refreshed };
        }
        return { acquired: false, reason: refreshedCode ? 'blocked' : 'race_lost', payment: refreshed };
    }

    async function updatePaymentForLease(order, lease, patch, { status = null } = {}) {
        const db = getSupabase();
        let query = db.from('guest_shop_payment_orders').update({
            ...patch,
            ...(status ? { status } : {}),
            updated_at: new Date().toISOString()
        }).eq('id', String(order.payment_order_id))
            .eq('guest_order_id', String(order.order_id))
            .eq('merchant_order_no', String(order.merchant_order_no || order.order_no))
            .eq('purpose', 'shop_direct')
            .eq('status', 'pending')
            .eq('last_error_code', PAYMENT_CREATION_LEASE_CODE)
            .eq('last_error_message', lease.message);
        if (typeof query.select === 'function') query = query.select('id,provider_order_no,status,provider_metadata,checkout_reference').maybeSingle();
        const result = await query;
        if (result?.error) throw result.error;
        return result?.data || null;
    }

    async function clearPaymentCreationLease(order, lease) {
        if (!lease) return null;
        try {
            return await updatePaymentForLease(order, lease, {
                last_error_code: null,
                last_error_message: null
            });
        } catch (_) {
            return null;
        }
    }

    async function loadGuestOrderAmountRow(order) {
        const db = getSupabase();
        const orderId = String(order?.order_id || order?.id || '').trim();
        if (!db?.from || !orderId) return null;
        let query = db.from('guest_shop_orders')
            .select('id,unit_amount,total_amount,metadata,payment_status')
            .eq('id', orderId);
        if (typeof query.maybeSingle === 'function') query = query.maybeSingle();
        const result = await query;
        if (result?.error) throw result.error;
        return result?.data || null;
    }

    async function persistGuestPayableAmounts({
        order,
        payment,
        creditAmount,
        provider,
        lease,
        summaries = {}
    }) {
        const computed = defaultGuestPricing.resolveGuestPayablePricing(
            creditAmount,
            provider,
            summaries
        );
        const payableSnapshot = normalizeGuestCashPrice(
            computed.payableAmount,
            security,
            String(order?.currency || 'CNY')
        );
        if (!payableSnapshot || !(payableSnapshot.amount > 0)) {
            throw Object.assign(new Error('应付金额无效'), {
                statusCode: 503,
                code: 'guest_payable_amount_invalid',
                expose: false
            });
        }
        computed.payableAmount = payableSnapshot.amount;
        computed.payload = defaultGuestPricing.buildGuestPaymentPricingPayload(computed);

        const current = await loadGuestOrderAmountRow(order);
        const currentUnit = current?.unit_amount ?? order?.unit_amount ?? order?.total_amount;
        const currentTotal = current?.total_amount ?? order?.total_amount;
        const alreadyOrder = defaultGuestPricing.moneyAmountsEqual(currentUnit, payableSnapshot.amount)
            && defaultGuestPricing.moneyAmountsEqual(currentTotal, payableSnapshot.amount);
        const alreadyPayment = defaultGuestPricing.moneyAmountsEqual(
            payment?.expected_amount,
            payableSnapshot.amount
        );
        const orderId = String(order?.order_id || order?.id || '').trim();
        const db = getSupabase();
        const metadata = applyPayableSnapshot(order, alreadyPayment ? payment : null, computed, current?.metadata);

        if (!alreadyOrder) {
            if (!db?.from || !orderId) return { ok: false, computed };
            let query = db.from('guest_shop_orders').update({
                unit_amount: payableSnapshot.amount,
                total_amount: payableSnapshot.amount,
                metadata,
                updated_at: new Date().toISOString()
            }).eq('id', orderId).eq('payment_status', 'pending');
            if (typeof query.select === 'function') {
                query = query.select('id,unit_amount,total_amount,metadata').maybeSingle();
            }
            const result = await query;
            if (result?.error) throw result.error;
            if (!result?.data) return { ok: false, computed };
        }

        if (!alreadyPayment) {
            const patched = await updatePaymentForLease(order, lease, {
                expected_amount: payableSnapshot.amount,
                payment_fee: computed.surchargeAmount || 0
            });
            if (!patched) return { ok: false, computed };
            payment.expected_amount = payableSnapshot.amount;
            payment.payment_fee = computed.surchargeAmount || 0;
        }

        applyPayableSnapshot(order, payment, computed, metadata);
        return { ok: true, computed };
    }

    async function markPaymentCreationReview(order, code, message, lease = null) {
        const db = getSupabase();
        if (!db?.from) return null;
        const errorCode = String(code || '').trim() || 'payment_creation_unknown';
        const errorMessage = String(message || '支付创建结果未知，请对账确认').slice(0, 500);
        const nowIso = new Date().toISOString();
        const orderId = String(order?.order_id || order?.id || '').trim();
        let query = db.from('guest_shop_payment_orders').update({
            status: 'review',
            last_error_code: errorCode,
            last_error_message: errorMessage,
            updated_at: nowIso
        }).eq('id', String(order.payment_order_id))
            .eq('guest_order_id', orderId)
            .eq('merchant_order_no', String(order.merchant_order_no || order.order_no))
            .eq('purpose', 'shop_direct');
        if (lease) {
            query = query.eq('status', 'pending')
                .eq('last_error_code', PAYMENT_CREATION_LEASE_CODE)
                .eq('last_error_message', lease.message);
        } else if (typeof query.in === 'function') {
            query = query.in('status', ['pending', 'created']);
        }
        if (typeof query.select === 'function') query = query.select('id,status').maybeSingle();
        const result = await query;
        if (result?.error) return null;
        // PostgREST builders are thenable but do not implement Promise.catch().
        // Calling `.catch()` on the builder threw before the PATCH left the
        // process, so payment rows could enter review while the order row
        // stayed pending. Await the request; never mask the provider error.
        if (orderId) {
            try {
                let orderQuery = db.from('guest_shop_orders').update({
                    payment_status: 'review',
                    last_error_code: errorCode,
                    last_error_message: errorMessage,
                    updated_at: nowIso
                }).eq('id', orderId);
                if (typeof orderQuery.in === 'function') {
                    orderQuery = orderQuery.in('payment_status', ['pending', 'review']);
                } else {
                    orderQuery = orderQuery.eq('payment_status', 'pending');
                }
                if (typeof orderQuery.select === 'function') {
                    orderQuery = orderQuery.select('id,payment_status,last_error_code').maybeSingle();
                }
                await orderQuery;
            } catch (_) {
                // Payment is already review, so retries stay 503.
            }
        }
        return result?.data || null;
    }

    async function markPaymentCreationFailed(order, lease, code, message) {
        const db = getSupabase();
        if (!db?.from) return null;
        let query = db.from('guest_shop_payment_orders').update({
            status: 'failed',
            last_error_code: code,
            last_error_message: String(message || '支付创建失败').slice(0, 500),
            updated_at: new Date().toISOString()
        }).eq('id', String(order.payment_order_id))
            .eq('guest_order_id', String(order.order_id))
            .eq('merchant_order_no', String(order.merchant_order_no || order.order_no))
            .eq('purpose', 'shop_direct')
            .eq('status', 'pending')
            .eq('last_error_code', PAYMENT_CREATION_LEASE_CODE)
            .eq('last_error_message', lease.message);
        if (typeof query.select === 'function') query = query.select('id,status').maybeSingle();
        const result = await query;
        if (result?.error) return null;
        return result?.data || null;
    }

    async function preview(req, res) {
        setGuestSensitiveHeaders(res);
        if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
        if (!(await limit(req, res, 'preview', { limit: 60 }))) return;
        try {
            const siteName = normalizeSiteValue(queryValue(req, 'site'));
            const productId = security.normalizeUuid(queryValue(req, 'productId') || queryValue(req, 'product_id'), 'productId');
            const skuId = security.normalizeUuid(queryValue(req, 'skuId') || queryValue(req, 'sku_id'), 'skuId');
            const pricing = await loadGuestSkuPricing({ supabase: getSupabase(), productId, skuId, siteName });
            const paymentProviders = defaultGuestPricing.publicGuestPaymentProviderSummaries(
                await defaultGuestPricing.loadGuestPaymentProviderSummaries({
                    supabase: getSupabase(),
                    siteName
                })
            );
            return sendJson(res, 200, {
                success: true,
                product: { id: pricing.product.id, name: pricing.product.name || '', sku_id: pricing.sku.id, sku_name: pricing.sku.sku_name || '' },
                price: { amount: pricing.unitAmount, currency: pricing.currency, quantity: 1 },
                payment_channels: Array.isArray(pricing.channels) ? pricing.channels : [],
                payment_providers: paymentProviders
            });
        } catch (error) { return failResponse(res, error); }
    }

    async function orders(req, res) {
        setGuestSensitiveHeaders(res);
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
        if (!(await limit(req, res, 'orders', { limit: 12 }))) return;
        try {
            // Validate all deployment-controlled timing values before parsing
            // or mutating an order.  In particular, a malformed TTL must not
            // reach the create RPC after it has acquired inventory.
            const orderTtlSeconds = guestOrderTtlSeconds(env);
            paymentCreationLeaseMs(env);
            const body = await parseJson(req);
            ensureAllowlist(body);
            const siteName = normalizeSiteValue(body.site);
            const provider = String(body.provider || body.providerKey || body.provider_key || '').trim().toLowerCase();
            const channel = String(body.channel || body.paymentChannel || body.payment_channel || provider).trim().toLowerCase();
            if (!provider || !channel || ['mock', 'test', 'fake'].includes(provider) || ['mock', 'test', 'fake'].includes(channel)) {
                throw new security.GuestShopSecurityError('支付通道不可用', { statusCode: 400, code: 'guest_invalid_payment_provider' });
            }
            const orderBody = { ...body };
            for (const field of ['provider', 'providerKey', 'provider_key', 'channel', 'paymentChannel', 'payment_channel']) delete orderBody[field];
            const normalized = security.normalizeGuestOrderInput(orderBody, { site: siteName, quantityMax: 1, allowOptionalContact: true });
            const pricing = await loadGuestSkuPricing({ supabase: getSupabase(), productId: normalized.productId, skuId: normalized.skuId, siteName });
            const fingerprint = security.buildGuestRequestFingerprint({
                ...normalized,
                unitAmount: pricing.unitAmount,
                pricingVersion: defaultGuestPricing.GUEST_CREDIT_PRICING_VERSION,
                provider,
                channel
            });
            // Derive the credential from the high-entropy idempotency key. The
            // client still receives it only in the creation response, but a
            // retry after a lost response derives the same value and therefore
            // can safely replay the idempotent create RPC. The derivation
            // pepper is server-only and must be configured in production.
            const claimSecret = security.deriveClaimSecretFromIdempotencyKey(
                normalized.idempotencyKey,
                { site: siteName, env }
            );
            const claimHash = security.hashClaimSecret(claimSecret, { env });
            const ipHash = hashRequestAttribute(resolveClientIp(req, { env }));
            const deviceHash = hashRequestAttribute(req?.headers?.['user-agent'] || '');
            const { data, error } = await getSupabase().rpc('fn_guest_shop_create_order', {
                p_site: siteName, p_product_id: normalized.productId, p_sku_id: normalized.skuId,
                p_idempotency_key: normalized.idempotencyKey, p_request_fingerprint: fingerprint,
                p_claim_secret_hash: claimHash, p_provider: provider, p_channel: channel,
                p_buyer_contact_hash: hashContact(normalized.email), p_request_ip_hash: ipHash,
                p_request_device_hash: deviceHash, p_ttl_seconds: orderTtlSeconds
            });
            if (error) throw error;
            const order = Array.isArray(data) ? data[0] : data;
            if (!order?.order_id) throw new Error('订单创建失败');

            // The create RPC is idempotent, but it intentionally does not
            // perform an external provider call.  Always reload and bind the
            // exact payment intent before deciding whether this request may
            // create a provider order.  This is the boundary that prevents a
            // lost HTTP response/retry from creating a second gateway order.
            const payment = await loadPaymentIntent(order);
            if (String(payment.provider || '').trim().toLowerCase() !== provider
                || String(payment.channel || '').trim().toLowerCase() !== channel) {
                throw Object.assign(new Error('支付通道与订单不一致'), {
                    statusCode: 409,
                    code: 'guest_payment_provider_mismatch'
                });
            }

            async function releaseCreatedReservation(reason) {
                const db = getSupabase();
                if (!db?.from || !db?.rpc) return false;
                const reservationResult = await db.from('guest_shop_inventory_reservations')
                    .select('id')
                    .eq('order_id', order.order_id)
                    .eq('status', 'held')
                    .maybeSingle();
                if (reservationResult.error || !reservationResult.data?.id) return false;
                const released = await db.rpc('fn_guest_shop_release_reservation', {
                    p_reservation_id: reservationResult.data.id,
                    p_order_id: order.order_id,
                    p_reason: String(reason || 'payment_create_failed').slice(0, 120)
                });
                return !released?.error;
            }

            const paymentProviderSummaries = await defaultGuestPricing.loadGuestPaymentProviderSummaries({
                supabase: getSupabase(),
                siteName
            });
            const computedPayable = defaultGuestPricing.resolveGuestPayablePricing(
                pricing.unitAmount,
                provider,
                paymentProviderSummaries
            );
            const replayResponse = (checkout, statusCode = 200, extra = {}) => {
                setClaimProofCookie(req, res, order, claimSecret, security, env);
                return sendJson(res, statusCode, {
                    success: true,
                    replayed: true,
                    order: responseOrder(order, claimSecret, { payment, computed: computedPayable }),
                    checkout,
                    ...extra
                });
            };

            const normalizedPaymentStatus = String(payment.status || '').trim().toLowerCase();
            const normalizedOrderPaymentStatus = String(order.payment_status || '').trim().toLowerCase();

            // A confirmed order has already crossed the webhook/fulfilment
            // boundary.  It is safe to replay the deterministic claim secret,
            // but never create or expose another checkout.
            if (normalizedOrderPaymentStatus === 'confirmed' || normalizedPaymentStatus === 'confirmed') {
                return replayResponse(null, 200, { payment_status: 'confirmed' });
            }

            // If a provider reference was persisted, reconstruct the checkout
            // from the server-owned allowlisted metadata.  No provider call is
            // made on this path, including for review rows.
            if (payment.provider_order_no
                && ['created', 'review', 'pending'].includes(normalizedPaymentStatus)) {
                const storedCheckout = buildStoredCheckout(order, payment);
                if (storedCheckout) return replayResponse(storedCheckout, 200, { payment_status: normalizedPaymentStatus });
                await markPaymentCreationReview(
                    order,
                    'payment_creation_checkout_unrecoverable',
                    '支付引用已存在但支付页面信息无法安全恢复'
                );
                throw Object.assign(new Error('支付订单暂需人工对账'), {
                    statusCode: 503,
                    code: 'guest_payment_reconciliation_required',
                    expose: true
                });
            }

            if (['review', 'created', 'failed', 'expired', 'refunded', 'chargeback', 'partial', 'overpaid', 'amount_mismatch']
                .includes(normalizedPaymentStatus)
                || normalizedOrderPaymentStatus === 'review') {
                // Review/created without a provider reference means the prior
                // external call may have succeeded before the response was
                // lost.  Do not “try one more time”; an operator/reconciler
                // must query the gateway and attach the reference first.
                throw Object.assign(new Error('支付订单暂需对账确认，请稍后重试'), {
                    statusCode: 503,
                    code: 'guest_payment_reconciliation_required',
                    expose: true
                });
            }

            const leaseResult = await acquirePaymentCreationLease(order, payment);
            if (!leaseResult.acquired) {
                if (leaseResult.reason === 'in_progress') {
                    throw Object.assign(new Error('支付订单正在创建，请稍后重试'), {
                        statusCode: 409,
                        code: 'guest_payment_creation_in_progress',
                        expose: true
                    });
                }
                if (leaseResult.reason === 'stale' || leaseResult.reason === 'blocked') {
                    throw Object.assign(new Error('支付创建结果未知，请对账确认后重试'), {
                        statusCode: 503,
                        code: 'guest_payment_reconciliation_required',
                        expose: true
                    });
                }
                throw Object.assign(new Error('支付订单状态不可创建'), {
                    statusCode: 409,
                    code: 'guest_payment_not_creatable',
                    expose: true
                });
            }
            const creationLease = leaseResult.lease;
            const persistResult = await persistGuestPayableAmounts({
                order,
                payment,
                creditAmount: pricing.unitAmount,
                provider,
                lease: creationLease,
                summaries: paymentProviderSummaries
            });
            if (!persistResult.ok) {
                await clearPaymentCreationLease(order, creationLease);
                throw Object.assign(new Error('应付金额写入失败，请稍后重试'), {
                    statusCode: 503,
                    code: 'guest_payable_amount_persist_failed',
                    expose: true
                });
            }

            let checkout = null;
            if (typeof paymentAdapter?.createGuestPayment === 'function') {
                try {
                    checkout = await paymentAdapter.createGuestPayment({
                        order,
                        provider,
                        channel,
                        site: siteName,
                        currency: pricing.currency,
                        amount: order.total_amount,
                        allowedChannels: pricing.channels,
                        req,
                        env
                    });
                } catch (error) {
                    // A definitive gateway rejection means no money can have
                    // been accepted, so release the held inventory. Network
                    // timeouts and 5xx responses are deliberately retained for
                    // reconciliation: releasing them could create a paid
                    // order whose card is sold to somebody else.
                    const code = String(error?.code || '').toLowerCase();
                    const definitive = code === 'guest_provider_create_failed'
                        || code === 'guest_payment_channel_unavailable'
                        || code === 'guest_payment_provider_disabled'
                        || code === 'guest_payment_provider_not_ready';
                    if (definitive) {
                        await markPaymentCreationFailed(order, creationLease, code || 'guest_provider_create_failed', '支付通道拒绝创建');
                        await releaseCreatedReservation(`payment_create_failed:${code || 'provider_rejected'}`);
                    } else {
                        await markPaymentCreationReview(order, 'payment_creation_unknown', '支付创建结果未知，请对账确认', creationLease);
                    }
                    throw error;
                }
            } else {
                await markPaymentCreationFailed(order, creationLease, 'guest_payment_provider_unavailable', '游客支付通道尚未配置');
                await releaseCreatedReservation('payment_provider_unavailable');
                throw Object.assign(new Error('游客支付通道尚未配置'), { statusCode: 503, code: 'guest_payment_provider_unavailable', expose: true });
            }
            // Bind provider references only to the exact payment row created by
            // the RPC. A failed patch is reviewable and must never silently
            // return a checkout that cannot be reconciled later.
            const patch = checkout?.payment_order_patch;
            if (!patch || !patch.provider_order_no) {
                await markPaymentCreationReview(order, 'payment_creation_patch_missing', '支付已创建但缺少可对账的支付引用', creationLease);
                throw Object.assign(new Error('支付订单引用缺失'), { statusCode: 502, code: 'guest_provider_reference_missing' });
            }
            const patchResult = await updatePaymentForLease(order, creationLease, {
                provider_order_no: patch.provider_order_no,
                checkout_reference: patch.checkout_reference || null,
                provider_metadata: patch.provider_metadata || {},
                last_error_code: null,
                last_error_message: null
            }, { status: 'created' });
            if (!patchResult) {
                // The provider may already have accepted payment. Keep the
                // reservation and mark the order for reconciliation.
                const refreshed = await loadPaymentIntent(order).catch(() => null);
                if (refreshed?.provider_order_no && refreshed.status === 'created') {
                    const recovered = buildStoredCheckout(order, refreshed);
                    if (recovered) return replayResponse(recovered, 200, { payment_status: 'created' });
                }
                await markPaymentCreationReview(order, 'payment_creation_patch_failed', '支付已创建但订单回写失败，请对账确认', creationLease);
                throw Object.assign(new Error('支付订单暂需人工对账'), { statusCode: 503, code: 'guest_payment_reconciliation_required', expose: true });
            }
            setClaimProofCookie(req, res, order, claimSecret, security, env);
            return sendJson(res, 201, {
                success: true,
                order: responseOrder(order, claimSecret, { payment, computed: persistResult.computed }),
                checkout
            });
        } catch (error) { return failResponse(res, error); }
    }

    async function loadOrderByNo(orderNo) {
        const result = await getSupabase().from('guest_shop_orders').select('*').eq('order_no', String(orderNo || '').trim()).maybeSingle();
        if (result.error) throw result.error;
        // Do not disclose whether an order number exists. This prevents an
        // attacker from using the status/claim endpoints as an order oracle.
        if (!result.data) throw Object.assign(new Error('取货凭证无效'), { statusCode: 403, code: 'guest_claim_invalid' });
        return result.data;
    }

    async function recordClaimFailure(order) {
        const db = getSupabase();
        const orderId = String(order?.id || '').trim();
        if (!db?.from || !orderId) return;
        const normalizeCount = (value) => {
            const numeric = Number(value);
            return Number.isSafeInteger(numeric)
                ? Math.min(MAX_CLAIM_FAILURE_ATTEMPTS, Math.max(0, numeric))
                : 0;
        };
        const normalizeErrorCode = (value) => {
            const code = String(value || '').trim();
            return code || null;
        };
        const normalizeErrorMessage = (value) => {
            const message = String(value || '').trim();
            return message || null;
        };

        let current = normalizeCount(order.claim_attempt_count);
        let currentErrorCode = normalizeErrorCode(order.last_error_code);
        let currentErrorMessage = normalizeErrorMessage(order.last_error_message);

        // Keep the counter bounded and increment it with an optimistic
        // compare-and-swap. A plain read-then-update loses increments when
        // several invalid attempts arrive at once. The conditional predicate
        // makes the update retry against the newest row without requiring a
        // new database RPC or migration.
        for (let attempt = 0; attempt < CLAIM_FAILURE_UPDATE_RETRIES; attempt += 1) {
            if (current >= MAX_CLAIM_FAILURE_ATTEMPTS) return;

            const preserveOperationalError = Boolean(
                currentErrorCode && currentErrorCode !== 'guest_claim_invalid'
            );
            const nextErrorCode = preserveOperationalError
                ? currentErrorCode
                : 'guest_claim_invalid';
            const nextErrorMessage = preserveOperationalError
                ? currentErrorMessage
                : '取货凭证校验失败';

            try {
                let query = db.from('guest_shop_orders').update({
                    claim_attempt_count: Math.min(MAX_CLAIM_FAILURE_ATTEMPTS, current + 1),
                    last_error_code: nextErrorCode,
                    last_error_message: nextErrorMessage,
                    updated_at: new Date().toISOString()
                }).eq('id', orderId).eq('claim_attempt_count', current);
                if (currentErrorCode && typeof query.eq === 'function') {
                    query = query.eq('last_error_code', currentErrorCode);
                } else if (typeof query.is === 'function') {
                    query = query.is('last_error_code', null);
                } else if (typeof query.eq === 'function') {
                    query = query.eq('last_error_code', null);
                }
                if (currentErrorMessage && typeof query.eq === 'function') {
                    query = query.eq('last_error_message', currentErrorMessage);
                } else if (typeof query.is === 'function') {
                    query = query.is('last_error_message', null);
                }

                // Supabase returns data:null for a compare-and-swap miss when
                // the update is followed by select(). Older test doubles or
                // alternate adapters may not expose select; their conditional
                // update is still safe, so treat completion as successful.
                if (typeof query.select === 'function'
                    && typeof query.maybeSingle === 'function') {
                    const result = await query.select('id,claim_attempt_count').maybeSingle();
                    if (result?.error || result?.data) return;
                } else {
                    const result = await query;
                    if (!result?.error) return;
                    return;
                }
            } catch (_) {
                // Never turn an invalid credential into a database availability
                // oracle or expose an internal update failure to the caller.
                return;
            }

            if (attempt >= CLAIM_FAILURE_UPDATE_RETRIES - 1) return;
            try {
                const latest = await db.from('guest_shop_orders')
                    .select('claim_attempt_count,last_error_code,last_error_message')
                    .eq('id', orderId)
                    .maybeSingle();
                if (latest?.error || !latest?.data) return;
                current = normalizeCount(latest.data.claim_attempt_count);
                currentErrorCode = normalizeErrorCode(latest.data.last_error_code);
                currentErrorMessage = normalizeErrorMessage(latest.data.last_error_message);
            } catch (_) {
                return;
            }
        }
    }

    async function authorizeClaim(req, order) {
        const supplied = String(req?.headers?.['x-guest-claim-secret'] || req?.headers?.['X-Guest-Claim-Secret'] || '').trim()
            || claimSecretFromCookie(req, order, security, env);
        if (!supplied || !security.verifyClaimSecret(supplied, order.claim_secret_hash, { env })) {
            await recordClaimFailure(order);
            throw Object.assign(new Error('取货凭证无效'), { statusCode: 403, code: 'guest_claim_invalid' });
        }
    }

    function guestInventoryConsistencyError() {
        return Object.assign(new Error('库存状态异常'), {
            statusCode: 409,
            code: 'guest_inventory_inconsistent'
        });
    }

    async function loadClaimedContent(order) {
        const db = getSupabase();
        if (!db) throw Object.assign(new Error('游客履约数据库不可用'), {
            statusCode: 503,
            code: 'guest_database_unavailable',
            expose: false
        });

        // The worker already uses this service-role RPC to atomically verify
        // the consumed reservation and sold, non-shared inventory. Reusing it
        // here collapses the old reservation-read + inventory-read sequence
        // into one database round-trip and keeps the delivery read under the
        // same row locks/state contract as fulfillment.
        if (typeof db.rpc === 'function') {
            const result = await db.rpc('fn_guest_shop_claim_fulfillment', {
                p_order_id: order.id,
                p_reservation_id: null
            });
            if (result?.error) throw result.error;
            const row = Array.isArray(result?.data) ? result.data[0] : result?.data;
            const orderId = String(row?.order_id || '').trim();
            const reservationStatus = String(row?.reservation_status || '').trim().toLowerCase();
            const fulfillmentStatus = String(row?.fulfillment_status || '').trim().toLowerCase();
            if (!row
                || orderId !== String(order.id || '').trim()
                || reservationStatus !== 'consumed'
                || fulfillmentStatus !== 'delivered'
                || typeof row.content !== 'string') {
                throw guestInventoryConsistencyError();
            }
            return row.content;
        }

        // Keep a compatibility path for thin local/test adapters that do not
        // expose RPCs. Production service-role clients have `.rpc` because
        // the worker and payment confirmation already depend on it.
        const reservation = await db.from('guest_shop_inventory_reservations')
            .select('inventory_id,status').eq('order_id', order.id).maybeSingle();
        if (reservation.error) throw reservation.error;
        if (!reservation.data || reservation.data.status !== 'consumed') throw guestInventoryConsistencyError();
        const inventory = await db.from('shop_inventory')
            .select('content,is_shared,status').eq('id', reservation.data.inventory_id).maybeSingle();
        if (inventory.error) throw inventory.error;
        if (!inventory.data || inventory.data.status !== 'sold' || inventory.data.is_shared) throw guestInventoryConsistencyError();
        return inventory.data.content;
    }

    function forceProviderRefreshRequested(req) {
        const raw = queryValue(req, 'force_provider_refresh')
            ?? queryValue(req, 'forceProviderRefresh')
            ?? queryValue(req, 'force')
            ?? '';
        const value = String(Array.isArray(raw) ? raw[0] : raw).trim().toLowerCase();
        return value === '1' || value === 'true' || value === 'yes';
    }

    async function persistStatusQueryMetadata(payment, patch) {
        const db = getSupabase();
        if (!db?.from || !payment?.id) return;
        const next = { ...storedPlainObject(payment.provider_metadata) };
        for (const [key, value] of Object.entries(patch || {})) {
            if (value === undefined) continue;
            next[key] = value;
        }
        try {
            await db.from('guest_shop_payment_orders').update({
                provider_metadata: next,
                updated_at: new Date().toISOString()
            }).eq('id', payment.id);
        } catch (_) {
            // Throttle bookkeeping is best effort; a failed metadata write must
            // never break the buyer-facing status response.
        }
    }

    /**
     * Actively query the payment provider from the buyer status endpoint. This
     * mirrors the logged-in wallet recharge flow, which keeps a webhook plus a
     * throttled status-poll closed loop so a dropped callback cannot leave a
     * genuinely paid guest order stuck on `pending` forever.
     *
     * The function is deliberately conservative: it never throws, never flips
     * order state directly, and only confirms through the same
     * fn_guest_shop_confirm_payment RPC used by verified webhooks.
     */
    async function attemptGuestPaymentStatusQuery({ order, payment, forceProviderRefresh = false } = {}) {
        const db = getSupabase();
        if (!db?.from || !payment?.id) return { refreshed: false, reason: 'missing_payment_order' };
        const provider = String(payment.provider || '').trim().toLowerCase();
        if (!GUEST_WEBHOOK_PROVIDERS.has(provider)) return { refreshed: false, reason: 'unsupported_provider' };
        if (typeof paymentAdapter?.queryGuestPayment !== 'function') return { refreshed: false, reason: 'adapter_unavailable' };
        if (GUEST_STATUS_QUERY_RESOLVED_PAYMENT_STATUSES.has(String(payment.status || '').trim().toLowerCase())) {
            return { refreshed: false, reason: 'already_resolved' };
        }

        const metadata = storedPlainObject(payment.provider_metadata);
        const lastQueryMs = Date.parse(String(metadata.query_verified_at || metadata.status_poll_query_at || ''));

        // Use adaptive throttle: aggressive after payment confirmation, conservative before
        const isPaymentConfirmed = String(order?.payment_status || '').trim().toLowerCase() === 'confirmed';
        let throttleMs;

        if (forceProviderRefresh === true) {
            throttleMs = GUEST_STATUS_QUERY_FORCE_THROTTLE_MS;  // 1.2s - user-initiated
        } else if (isPaymentConfirmed) {
            throttleMs = GUEST_STATUS_QUERY_CONFIRMED_THROTTLE_MS;  // 3s - aggressive post-payment
        } else {
            throttleMs = GUEST_STATUS_QUERY_THROTTLE_MS;  // 8s - conservative pre-payment
        }

        if (Number.isFinite(lastQueryMs) && (Date.now() - lastQueryMs) < throttleMs) {
            return { refreshed: false, reason: 'query_throttled', nextAllowedMs: lastQueryMs + throttleMs };
        }

        const merchantOrderNo = normalizeWebhookReference(payment.merchant_order_no || order?.order_no, 200);
        const providerOrderNo = normalizeWebhookReference(payment.provider_order_no || merchantOrderNo, 300);
        const tradeNo = normalizeWebhookReference(metadata.trade_no || metadata.query_trade_no, 120);
        const providerPaymentId = normalizeWebhookReference(metadata.payment_id || metadata.provider_payment_id, 120);
        const observedSite = normalizeWebhookReference(payment.site, 16).toLowerCase();
        const observedCurrency = normalizeWebhookReference(payment.currency, 8).toUpperCase();
        const expectedAmount = normalizeGuestCashPrice(payment.expected_amount, security, observedCurrency);
        if (!merchantOrderNo || !providerOrderNo || !expectedAmount
            || !['cn', 'intl'].includes(observedSite)
            || !['CNY', 'USD'].includes(observedCurrency)) {
            return { refreshed: false, reason: 'invalid_payment_binding' };
        }

        let live = null;
        try {
            live = await paymentAdapter.queryGuestPayment({
                provider,
                channel: normalizeWebhookReference(payment.channel, 80).toLowerCase() || provider,
                site: observedSite,
                providerOrderNo,
                merchantOrderNo,
                tradeNo,
                paymentId: providerPaymentId,
                providerPaymentId,
                metadata
            });
        } catch (error) {
            const nowIso = new Date().toISOString();
            await persistStatusQueryMetadata(payment, {
                query_status: null,
                query_error_code: normalizeWebhookReference(error?.code, 120) || 'guest_status_query_failed',
                query_verified_at: nowIso,
                status_poll_query_at: nowIso
            });
            return { refreshed: false, reason: 'query_error' };
        }
        if (!live || live.supported === false) {
            const nowIso = new Date().toISOString();
            await persistStatusQueryMetadata(payment, {
                query_status: null,
                query_error_code: 'guest_status_query_unsupported',
                query_verified_at: nowIso,
                status_poll_query_at: nowIso
            });
            return { refreshed: false, reason: 'query_unavailable' };
        }

        const observedStatus = String(live.final_status || live.status || '').trim().toLowerCase();
        const observedAmount = normalizeObservedAmount(live.paid_amount ?? live.amount);
        const liveProviderOrderNo = normalizeWebhookReference(live.provider_order_no || providerOrderNo, 300);
        const liveTradeNo = normalizeWebhookReference(live.trade_no || live.transaction_id || tradeNo, 120);
        const quote = providerQuoteChecks(provider, live, payment, security);
        const binding = security.verifyPaymentBinding({
            expectedMerchantOrderNo: merchantOrderNo,
            expectedProvider: provider,
            expectedPurpose: 'shop_direct',
            expectedSite: observedSite,
            expectedCurrency: observedCurrency,
            expectedAmountMinor: expectedAmount.minor,
            received: {
                merchantOrderNo: normalizeWebhookReference(live.merchant_order_no, 200) || merchantOrderNo,
                provider,
                purpose: String(live.purpose || 'shop_direct').trim().toLowerCase(),
                site: observedSite,
                currency: observedCurrency,
                // NOWPayments settles in crypto and is validated by the quote
                // checks above; ZPay reports the fiat amount it actually took.
                paidAmount: provider === 'nowpayments' ? expectedAmount.amount : observedAmount,
                finalStatus: observedStatus
            }
        });
        const verified = binding.valid === true && quote.valid === true && isFinalPaymentStatus(observedStatus);
        const nowIso = new Date().toISOString();
        await persistStatusQueryMetadata(payment, {
            query_status: observedStatus || null,
            query_status_raw: normalizeWebhookReference(live.status_raw, 80) || null,
            query_trade_no: liveTradeNo || null,
            query_error_code: verified ? null : 'guest_status_query_not_confirmed',
            query_verified_at: nowIso,
            status_poll_query_at: nowIso
        });
        if (!verified || !liveProviderOrderNo) return { refreshed: false, reason: 'not_verified' };

        const eventKey = statusQueryEventKey(provider, { paymentId: payment.id });
        const bodyHash = crypto.createHash('sha256').update(JSON.stringify({
            event_key: eventKey,
            provider,
            payment_order_id: payment.id,
            provider_order_no: liveProviderOrderNo,
            merchant_order_no: merchantOrderNo,
            status: observedStatus,
            amount: expectedAmount.amount
        })).digest('hex');
        const redactedPayload = typeof security.redactGuestPaymentPayload === 'function'
            ? security.redactGuestPaymentPayload(live.response_payload || {})
            : {};
        const eventRow = {
            payment_order_id: payment.id,
            merchant_order_no: merchantOrderNo,
            provider,
            event_key: eventKey,
            provider_event_id: eventKey,
            provider_order_no: liveProviderOrderNo,
            event_type: GUEST_STATUS_QUERY_EVENT_TYPE,
            observed_status: observedStatus,
            observed_site: observedSite,
            observed_currency: observedCurrency,
            observed_amount: expectedAmount.amount,
            observed_purpose: 'shop_direct',
            payload_redacted: { provider, status: observedStatus, query: storedPlainObject(redactedPayload) },
            body_sha256: bodyHash,
            signature_version: 'query_api',
            signature_verified: true,
            amount_verified: true,
            currency_verified: true,
            final_status_verified: true,
            processing_status: 'verified',
            error_code: null
        };

        let eventId = null;
        let alreadyProcessed = false;
        try {
            const existing = await db.from('guest_shop_payment_events')
                .select('*').eq('provider', provider).eq('event_key', eventKey).maybeSingle();
            if (existing?.error) return { refreshed: false, reason: 'event_lookup_failed' };
            if (existing?.data) {
                eventId = existing.data.id || null;
                alreadyProcessed = ['processed', 'duplicate']
                    .includes(String(existing.data.processing_status || '').trim().toLowerCase());
            } else {
                const inserted = await db.from('guest_shop_payment_events').insert(eventRow).select('*').single();
                if (inserted?.error) {
                    if (!isUniqueViolation(inserted.error)) return { refreshed: false, reason: 'event_insert_failed' };
                    const raced = await db.from('guest_shop_payment_events')
                        .select('*').eq('provider', provider).eq('event_key', eventKey).maybeSingle();
                    eventId = raced?.data?.id || null;
                    alreadyProcessed = ['processed', 'duplicate']
                        .includes(String(raced?.data?.processing_status || '').trim().toLowerCase());
                } else {
                    eventId = inserted.data?.id || null;
                }
            }
        } catch (_) {
            return { refreshed: false, reason: 'event_write_failed' };
        }
        if (!eventId) return { refreshed: false, reason: 'event_reference_missing' };

        let kickRequested = false;
        if (!alreadyProcessed) {
            try {
                const confirmed = await db.rpc('fn_guest_shop_confirm_payment', {
                    p_payment_order_id: payment.id,
                    p_event_id: eventId,
                    p_provider: provider,
                    p_provider_order_no: liveProviderOrderNo,
                    p_observed_site: observedSite,
                    p_observed_currency: observedCurrency,
                    p_observed_amount: expectedAmount.amount,
                    p_observed_purpose: 'shop_direct',
                    p_observed_status: observedStatus,
                    p_signature_verified: true,
                    p_amount_verified: true,
                    p_currency_verified: true,
                    p_final_status_verified: true
                });
                if (confirmed?.error) return { refreshed: false, reason: 'confirm_failed' };
                kickConfirmedOrder(
                    order?.id
                    || payment.guest_order_id
                    || confirmed?.data?.guest_order_id
                    || confirmed?.data?.order_id
                );
                kickRequested = true;
            } catch (_) {
                return { refreshed: false, reason: 'confirm_failed' };
            }
        }

        const refreshedOrder = await loadOrderByNo(order?.order_no || merchantOrderNo).catch(() => null);
        return { refreshed: true, order: refreshedOrder || order, kickRequested };
    }

    async function buildThrottleHint(order) {
        // Provide frontend with throttle state to optimize polling intervals
        if (!order?.payment_order_id) return null;
        try {
            const payment = await loadPaymentIntent({
                payment_order_id: order.payment_order_id,
                order_id: order.id,
                merchant_order_no: order.order_no
            });
            const metadata = storedPlainObject(payment?.provider_metadata);
            const queryVerifiedAt = metadata?.query_verified_at;
            if (!queryVerifiedAt) return null;
            return {
                query_verified_at: queryVerifiedAt,
                // Frontend can calculate next_allowed_ms from query_verified_at + throttle window
            };
        } catch (_) {
            // Throttle hint is best-effort; never break the status response
            return null;
        }
    }

    async function status(req, res) {
        setGuestSensitiveHeaders(res);
        if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
        if (!(await limit(req, res, 'status', { limit: 60 }))) return;
        try {
            let order = await loadOrderByNo(queryValue(req, 'orderNo') || queryValue(req, 'order_no'));
            await authorizeClaim(req, order);
            // A prior webhook/status request may have confirmed payment while
            // its in-process kick was unavailable or failed. Re-kick any
            // confirmed order that is still not delivered; the worker's
            // persisted lease/CAS keeps this safe across concurrent callers.
            let kickedConfirmedOrder = false;
            if (String(order.payment_status || '').trim().toLowerCase() === 'confirmed'
                && String(order.fulfillment_status || '').trim().toLowerCase() !== 'delivered') {
                kickConfirmedOrder(order.id);
                kickedConfirmedOrder = true;
            }
            let checkout = null;
            // A refreshed tab may have only the non-sensitive order handle in
            // sessionStorage. Reconstruct the checkout from server-owned,
            // allowlisted provider metadata after the claim cookie has been
            // verified. This never returns the claim secret, raw webhook
            // payload, or arbitrary provider metadata.
            if (!paymentStatusIsTerminal(String(order.payment_status || '').trim().toLowerCase())) {
                let payment = null;
                try {
                    payment = await loadPaymentIntent({
                        payment_order_id: order.payment_order_id,
                        order_id: order.id,
                        merchant_order_no: order.order_no
                    });
                    checkout = buildStoredCheckout(order, payment);
                } catch (_) {
                    // Status polling remains useful when payment creation is
                    // still pending; provider reconstruction is best effort
                    // and must not turn a valid status response into an
                    // information oracle.
                    payment = null;
                    checkout = null;
                }
                // A provider callback can be lost, delayed, or dropped. Mirror
                // the logged-in wallet recharge flow and actively query the
                // provider from this endpoint so a genuinely paid order can
                // self-heal without an operator touching the row.
                if (payment) {
                    const refresh = await attemptGuestPaymentStatusQuery({
                        order,
                        payment,
                        forceProviderRefresh: forceProviderRefreshRequested(req)
                    });
                    if (refresh?.refreshed && refresh.order) {
                        order = refresh.order;
                        if (refresh.kickRequested === true) kickedConfirmedOrder = true;
                        if (paymentStatusIsTerminal(String(order.payment_status || '').trim().toLowerCase())) {
                            checkout = null;
                        }
                    }
                }
            }
            if (!kickedConfirmedOrder
                && String(order.payment_status || '').trim().toLowerCase() === 'confirmed'
                && String(order.fulfillment_status || '').trim().toLowerCase() !== 'delivered') {
                kickConfirmedOrder(order.id);
            }
            // Include throttle hint for frontend smart polling optimization
            const throttleHint = await buildThrottleHint(order);
            return sendJson(res, 200, {
                success: true,
                order: publicOrderSnapshot(order),
                ...(checkout ? { checkout } : {}),
                ...(throttleHint ? { throttle_hint: throttleHint } : {})
            });
        } catch (error) { return failResponse(res, error); }
    }

    async function recover(req, res) {
        setGuestSensitiveHeaders(res);
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
        if (!(await limit(req, res, 'recover', { limit: 8 }))) return;
        try {
            const body = await parseJson(req);
            for (const key of Object.keys(body || {})) {
                if (!['orderNo', 'order_no', 'recoveryCode', 'recovery_code'].includes(key)) {
                    throw new security.GuestShopSecurityError('找回请求字段不允许', { field: key, code: 'unknown_field' });
                }
            }
            const orderNo = String(body.orderNo || body.order_no || '').trim();
            const recoveryCode = String(body.recoveryCode || body.recovery_code || '').trim();
            if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u.test(orderNo)
                || !/^[A-Za-z0-9_-]{40,200}$/u.test(recoveryCode)) {
                throw new security.GuestShopSecurityError('订单号或取货口令无效', { code: 'guest_claim_invalid', statusCode: 403 });
            }
            const order = await loadOrderByNo(orderNo);
            if (!security.verifyClaimSecret(recoveryCode, order.claim_secret_hash, { env })) {
                await recordClaimFailure(order);
                throw Object.assign(new Error('取货凭证无效'), { statusCode: 403, code: 'guest_claim_invalid' });
            }
            setClaimProofCookie(req, res, order, recoveryCode, security, env);
            const paymentStatus = String(order.payment_status || '').trim().toLowerCase();
            let checkout = null;
            if (!paymentStatusIsTerminal(paymentStatus)) {
                try {
                    const payment = await loadPaymentIntent({
                        payment_order_id: order.payment_order_id,
                        order_id: order.id,
                        merchant_order_no: order.order_no
                    });
                    checkout = buildStoredCheckout(order, payment);
                } catch (_) { checkout = null; }
            }
            return sendJson(res, 200, {
                success: true,
                recovered: true,
                order: publicOrderSnapshot(order),
                ...(checkout ? { checkout } : {})
            });
        } catch (error) { return failResponse(res, error); }
    }

    async function claim(req, res) {
        setGuestSensitiveHeaders(res);
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
        if (!(await limit(req, res, 'claim', { limit: 10 }))) return;
        try {
            const body = await parseJson(req);
            for (const key of Object.keys(body || {})) {
                if (!['orderNo', 'order_no'].includes(key)) {
                    throw new security.GuestShopSecurityError('领取请求字段不允许', {
                        field: key,
                        code: 'unknown_field'
                    });
                }
            }
            const order = await loadOrderByNo(body.orderNo || body.order_no || queryValue(req, 'orderNo'));
            await authorizeClaim(req, order);
            if (order.fulfillment_status !== 'delivered' || order.payment_status !== 'confirmed') {
                return sendJson(res, 409, { success: false, code: 'guest_order_not_delivered', message: '订单尚未完成发货' });
            }
            const content = await loadClaimedContent(order);
            return sendJson(res, 200, { success: true, order_no: order.order_no, content });
        } catch (error) { return failResponse(res, error); }
    }

    async function webhook(req, res, providerOverride = '') {
        setWebhookSecurityHeaders(res);
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
        try {
            const routeProvider = String(providerOverride || '').trim().toLowerCase();
            const queryProvider = String(queryValue(req, 'provider') || '').trim().toLowerCase();
            if (!GUEST_WEBHOOK_PROVIDERS.has(routeProvider) || (queryProvider && queryProvider !== routeProvider)) throw webhookError('支付通道无效', 'guest_invalid_payment_provider');
            const provider = routeProvider;
            if (!(await webhookLimit(req, res, provider))) return;
            const rawBody = await readStrictWebhookBody(req, security);
            const payload = parseWebhookPayload(provider, rawBody, req);
            const merchantHint = provider === 'zpay' ? payload.out_trade_no : payload.order_id;
            const db = getSupabase();
            if (!db) throw webhookError('数据库服务不可用', 'guest_database_unavailable', 503, false);
            const lookupReference = String(merchantHint || '').trim();
            let payment = null;
            if (lookupReference) {
                payment = await db.from('guest_shop_payment_orders')
                    .select('*').eq('merchant_order_no', lookupReference).maybeSingle();
                if (payment.error) throw payment.error;
            }
            // Providers are allowed to return a provider-side order id in the
            // callback even when the merchant id is omitted or rewritten. The
            // reference was persisted before the checkout was returned, so a
            // provider-scoped fallback is safe and still fails closed on an
            // ambiguous/missing row.
            const providerCallbackReference = provider === 'nowpayments'
                ? String(payload.payment_id || payload.id || '').trim()
                : '';
            const fallbackReferences = [...new Set([lookupReference, providerCallbackReference].filter(Boolean))];
            for (const reference of fallbackReferences) {
                if (payment?.data) break;
                payment = await db.from('guest_shop_payment_orders')
                    .select('*').eq('provider', provider).eq('provider_order_no', reference).maybeSingle();
                if (payment.error) throw payment.error;
            }
            if (!payment?.data && providerCallbackReference) {
                payment = await db.from('guest_shop_payment_orders')
                    .select('*').eq('provider', provider).eq('checkout_reference', providerCallbackReference).maybeSingle();
                if (payment.error) throw payment.error;
            }
            // Merchant-order lookup is not provider-scoped, so a NOWPayments
            // IPN can hit a ZPay row (and vice versa). Binding that row to a
            // cross-provider event trips guest_shop_validate_payment_event
            // (P0001) because NEW.provider <> payment.provider. Treat the
            // mismatch as an unknown order: audit with payment_order_id=null
            // and never confirm.
            const matchedPayment = payment?.data || null;
            const expected = matchedPayment
                && String(matchedPayment.provider || '').trim().toLowerCase() === provider
                ? matchedPayment
                : null;
            const verifier = paymentAdapter?.verifyGuestWebhook || paymentAdapter?.verifyWebhook;
            if (typeof verifier !== 'function') throw webhookError('支付通道未配置', 'guest_payment_provider_unavailable', 503, false);
            const verification = await verifier({ provider, payload, rawBody, headers: req.headers || {}, signature: provider === 'zpay' ? payload.sign : webhookHeader(req, 'x-nowpayments-sig'), site: expected?.site || 'cn', expectedPayment: expected, requestOrigin: '', requestHost: webhookHeader(req, 'host'), env });
            const parser = paymentAdapter?.parseGuestWebhook || paymentAdapter?.parseWebhook;
            const normalized = typeof parser === 'function' ? await parser({ provider, payload, site: expected?.site || 'cn', env }) : null;
            const bodySha256 = rawBodyHash(security, rawBody);
            const merchantOrderNo = normalizeWebhookReference(normalized?.merchant_order_no || merchantHint);
            const providerOrderNo = normalizeWebhookReference(normalized?.provider_order_no || normalized?.provider_payment_id || merchantOrderNo);
            const observedStatus = String(normalized?.final_status || normalized?.status || '').trim().toLowerCase();
            const observedAmount = normalizeObservedAmount(normalized?.amount ?? normalized?.paid_amount);
            const businessEventKey = normalizeWebhookEventKey(normalized?.event_key || normalized?.event_id, providerOrderNo || merchantOrderNo, provider, bodySha256);
            const quote = providerQuoteChecks(provider, normalized, expected, security);
            const binding = expected && normalized ? security.verifyPaymentBinding({ expectedMerchantOrderNo: expected.merchant_order_no, expectedProvider: expected.provider, expectedPurpose: 'shop_direct', expectedSite: expected.site, expectedCurrency: expected.currency, expectedAmountMinor: Math.round(Number(expected.expected_amount) * 100), received: { merchantOrderNo, provider, purpose: normalized.purpose, site: expected.site, currency: expected.currency, paidAmount: provider === 'nowpayments' ? expected.expected_amount : observedAmount, finalStatus: observedStatus } }) : { valid: false, checks: {} };
            const valid = verification?.valid === true && binding.valid && quote.valid && isFinalPaymentStatus(observedStatus);
            // Invalid signatures, mismatched orders, amounts or final status
            // are audit events only.  They use a body-hash namespace so an
            // attacker cannot pre-claim the normal provider/order key and
            // make the later legitimate callback look like a duplicate.
            const eventKey = valid
                ? businessEventKey
                : invalidWebhookAuditBucketKey(provider, resolveClientIp(req, { env }) || 'unknown', Date.now(), env);
            const existing = await db.from('guest_shop_payment_events').select('*').eq('provider', provider).eq('event_key', eventKey).maybeSingle();
            if (existing.error) throw existing.error;
            if (existing.data) {
                if (existing.data.body_sha256 !== bodySha256) return sendJson(res, 202, { success: true, accepted: false, code: 'event_key_body_conflict' });
                if (['processed', 'duplicate'].includes(existing.data.processing_status)) {
                    // A duplicate callback can be the first request after a
                    // transient kick failure. Reusing the verified event is
                    // safe; the worker remains idempotent and lease-guarded.
                    kickConfirmedOrder(expected?.guest_order_id);
                    return sendJson(res, 200, { success: true, accepted: true, duplicate: true });
                }
                if (['rejected', 'dead_letter'].includes(existing.data.processing_status)) return sendJson(res, 202, { success: true, accepted: false });
            }
            const redacted = typeof security.redactGuestPaymentPayload === 'function' ? security.redactGuestPaymentPayload(payload) : {};
            const eventRow = { payment_order_id: expected?.id || null, merchant_order_no: merchantOrderNo || `unknown:${bodySha256.slice(0, 24)}`, provider, event_key: eventKey, provider_event_id: normalized?.event_id || eventKey, provider_order_no: providerOrderNo || null, event_type: 'payment', observed_status: observedStatus || null, observed_site: expected?.site || null, observed_currency: expected?.currency || null, observed_amount: provider === 'nowpayments' ? expected?.expected_amount || null : observedAmount, observed_purpose: normalized?.purpose || 'shop_direct', payload_redacted: redacted, body_sha256: bodySha256, signature_version: verification?.signature_version || null, signature_verified: verification?.valid === true, amount_verified: Boolean(binding.checks?.amount && quote.valid), currency_verified: Boolean(binding.checks?.currency && quote.valid), final_status_verified: Boolean(binding.checks?.finalStatus && isFinalPaymentStatus(observedStatus)), processing_status: valid ? 'verified' : 'rejected', error_code: valid ? null : 'guest_webhook_verification_failed' };
            const inserted = existing.data ? { data: existing.data, error: null } : await db.from('guest_shop_payment_events').insert(eventRow).select('*').single();
            if (inserted.error) { if (isUniqueViolation(inserted.error)) return sendJson(res, 200, { success: true, accepted: true, duplicate: true }); throw inserted.error; }
            if (!valid || !expected) return sendJson(res, 202, { success: true, accepted: false });
            const confirmed = await db.rpc('fn_guest_shop_confirm_payment', { p_payment_order_id: expected.id, p_event_id: inserted.data.id, p_provider: provider, p_provider_order_no: providerOrderNo, p_observed_site: expected.site, p_observed_currency: expected.currency, p_observed_amount: expected.expected_amount, p_observed_purpose: 'shop_direct', p_observed_status: observedStatus, p_signature_verified: true, p_amount_verified: true, p_currency_verified: true, p_final_status_verified: true });
            if (confirmed.error) throw confirmed.error;
            kickConfirmedOrder(
                expected.guest_order_id
                || confirmed?.data?.guest_order_id
                || confirmed?.data?.order_id
            );
            return sendJson(res, 200, { success: true, accepted: true, result: Array.isArray(confirmed.data) ? confirmed.data[0] : confirmed.data });
        } catch (error) { return failResponse(res, error, '回调处理失败'); }
    }

    return {
        preview,
        orders,
        status,
        recover,
        claim,
        webhook,
        // Kept out of the public route modules (which select one handler),
        // but useful for contract tests to exercise server-owned checkout
        // normalization without making a provider call.
        _private: { buildStoredCheckout }
    };
}

module.exports = {
    createGuestShopHandlers,
    _private: {
        MAX_GUEST_CASH_PRICE_MINOR,
        MAX_GUEST_ORDER_TTL_SECONDS,
        MAX_PAYMENT_CREATION_LEASE_MS,
        guestOrderTtlSeconds,
        guestRuntimeConfigError,
        guestWebhookLimits,
        normalizeGuestCashPrice,
        normalizeStoredPositiveDecimal,
        paymentCreationLeaseMs,
        parseGuestRuntimeInteger,
        parsePositiveDecimal,
        providerQuoteChecks
    }
};
