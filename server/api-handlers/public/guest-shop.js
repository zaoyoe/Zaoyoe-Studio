'use strict';

const crypto = require('node:crypto');
const defaultSecurity = require('../../../api/_lib/guest-shop/security');
const defaultBuyerCredentials = require('../../../api/_lib/guest-shop/buyer-credentials');
const defaultBuyerAccessAdmin = require('../../../api/_lib/guest-shop/buyer-access-admin');
const defaultGuestPricing = require('../../../api/_lib/guest-shop/pricing');
// Promo L1/L2: switches, quantity normalization and the display breakdown.
// This module NEVER computes an amount - every price, discount and fee comes
// from the SQL functions (see its header comment).
const defaultGuestPromo = require('../../../api/_lib/guest-shop/promo');
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
// A create response can be lost after the database/provider side effects have
// committed. Keep the idempotency key in a distinct, encrypted HttpOnly cookie
// that is written *before* the side-effecting POST. It is deliberately not a
// claim cookie: an idempotency key can derive a claim secret, so it must never
// be exposed to JavaScript, URLs, browser storage, telemetry, or logs.
const GUEST_CHECKOUT_INTENT_COOKIE_NAME = '__Host-gs-checkout-intent';
const GUEST_CHECKOUT_INTENT_COOKIE_VERSION = 'v1';
const GUEST_CHECKOUT_INTENT_CREATE_DEADLINE_SECONDS = 5 * 60;
const GUEST_CHECKOUT_INTENT_MAX_AGE_SECONDS = 2 * 60 * 60
    + GUEST_CHECKOUT_INTENT_CREATE_DEADLINE_SECONDS;
const GUEST_CHECKOUT_INTENT_ACTIONS = new Set(['prepare', 'inspect', 'commit', 'ack']);
// Order Access 2.0 (§7.1 / §12): a short-lived session cookie issued by
// POST /guest/access/login so the list/detail/delivery endpoints do not have to
// re-send the query password on every request. The `__Host-` prefix is a browser
// contract: it forces Secure, forbids a Domain attribute, and REQUIRES Path=/.
// The spec's illustrative Path=/api/shop/guest is therefore invalid for a
// `__Host-` cookie; we use Path=/ and scope authorization server-side to the
// guest routes instead. The payload always carries buyer_id (the matched
// credential group) and NEVER degrades to contact_hash, which would leak across
// groups (§6.4). Keyed off the claim pepper with a distinct domain-separation
// label so it can never be confused with the claim-proof cookie key.
const GUEST_ACCESS_COOKIE_NAME = '__Host-gs-acc';
// v2 (A3): the payload carries `pv` (password_version) in addition to
// buyer_id/contact_hash/exp. v1 is NOT accepted, because a v1 cookie cannot be
// revoked: nothing in it changes when an admin issues a reset link or a buyer
// resets their own password, so a stolen cookie would stay valid for its full
// 30 minutes regardless. Dropping v1 outright is free — the credential switch
// has never been on in production, so no v1 cookie has ever been minted outside
// a test harness (§13.4 / §15.1).
const GUEST_ACCESS_COOKIE_VERSION = 'v2';
const GUEST_ACCESS_COOKIE_MAX_AGE_SECONDS = 30 * 60;
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

// Operator ceiling for one guest order (promo L1). Unparsable or out-of-range
// values degrade to 1, i.e. the pre-L1 behaviour, never to the maximum.
function guestMaxQuantity(env = process.env) {
    return defaultGuestPromo.resolveGuestMaxQuantity(env);
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
    // Promo L1: resolveGuestOrderPayablePricing carries the per-unit NET amount
    // in `unitAmount` and keeps the channel fee separate, so a multi-unit order
    // persists unit_amount = net unit, payment_fee_amount = surcharge and
    // total_amount = net + fee (the shape guest_shop_orders_amount_check now
    // requires). The legacy single-unit helper has no `unitAmount`, and for it
    // unit == total == payable with fee 0, which is exactly the pre-L1 shape.
    const unit = computed.unitAmount != null ? computed.unitAmount : payable;
    const nextMetadata = {
        ...storedPlainObject(metadata || order?.metadata),
        credit_unit_amount: computed.creditUnitAmount != null ? computed.creditUnitAmount : unit,
        payment_pricing: computed.payload || defaultGuestPricing.buildGuestPaymentPricingPayload(computed)
    };
    if (order && typeof order === 'object') {
        order.unit_amount = unit;
        order.total_amount = payable;
        order.expected_amount = payable;
        order.payment_fee_amount = surcharge;
        order.metadata = nextMetadata;
    }
    if (payment && typeof payment === 'object') {
        payment.expected_amount = payable;
        payment.payment_fee = surcharge;
    }
    return nextMetadata;
}

// Promo L1: a quantity is echoed only when the row actually carries a valid
// one. Rows loaded through a trimmed select (or written before the migration)
// have no quantity, and reporting 1 for an unknown count would mis-render a
// multi-unit order in the buyer's order list.
function guestSnapshotQuantity(order) {
    const raw = order?.quantity;
    if (raw === undefined || raw === null || raw === '') return null;
    const value = defaultGuestPromo.normalizeGuestQuantity(raw, {
        cap: defaultGuestPromo.GUEST_MAX_QUANTITY_CEILING
    });
    return value === null ? null : value;
}

// Promo L2: the coupon line of the order list. Only a row written by the promo
// create RPC (list_unit_amount NOT NULL) can carry a discount; a legacy row has
// no discount columns and must render nothing rather than "已优惠 ¥0.00".
function guestSnapshotDiscount(order) {
    const listUnit = order?.list_unit_amount;
    if (listUnit === null || listUnit === undefined) return null;
    const amount = defaultGuestPricing.roundMoneyAmount(order?.discount_amount, 0) || 0;
    return amount > 0 ? amount : null;
}

// Promo L1/L2: the amount breakdown is echoed ONLY for a row written by the
// promo create RPC (list_unit_amount NOT NULL). A legacy row baked the channel
// fee into unit_amount, so echoing payment_fee_amount: 0 for it would render a
// false "手续费 ¥0.00" line against a unit price that already contains the fee.
// Returning null makes the key disappear and the client falls back to the
// single stored amount, exactly as it did before L1/L2.
function guestSnapshotBreakdown(order) {
    const listUnit = order?.list_unit_amount;
    if (listUnit === null || listUnit === undefined || listUnit === '') return null;
    return defaultGuestPromo.buildGuestAmountBreakdown(order);
}

// A money-shape or money-state problem is always an internal 503: the buyer is
// told to retry, the operator gets a distinct code, and no amount is ever
// derived from the request to "fix" the row.
function guestPayableAmountError(message, code) {
    return Object.assign(new Error(message), { statusCode: 503, code, expose: false });
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

function checkoutIntentCookieKey(security, env) {
    try {
        const pepper = security.getGuestClaimPepper(env, { required: true });
        return crypto.createHash('sha256')
            .update(`guest-shop-checkout-intent-cookie\0${pepper}`, 'utf8')
            .digest();
    } catch (_) {
        return null;
    }
}

function checkoutIntentContactHash(email, security, env) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return '';
    const key = checkoutIntentCookieKey(security, env);
    if (!key) return '';
    return crypto.createHmac('sha256', key)
        .update(`guest-shop-checkout-intent-contact\0${normalized}`, 'utf8')
        .digest('hex');
}

function checkoutIntentPaymentKey(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._:-]{0,79}$/u.test(normalized)) return '';
    if (['mock', 'test', 'fake'].includes(normalized)) return '';
    return normalized;
}

function normalizeCheckoutIntentRecord(value, security) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const request = value.request;
    if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
    const intentId = String(value.intentId || '').trim();
    const idempotencyKey = String(value.idempotencyKey || '').trim();
    const issuedAt = String(value.issuedAt || '').trim();
    const createDeadlineAt = String(value.createDeadlineAt || '').trim();
    const expiresAt = String(value.expiresAt || '').trim();
    const contactHash = String(request.contactHash || '').trim();
    const credentialRequired = request.credentialRequired === true;
    const provider = checkoutIntentPaymentKey(request.provider);
    const channel = checkoutIntentPaymentKey(request.channel);
    const issuedAtMs = Date.parse(issuedAt);
    const createDeadlineMs = Date.parse(createDeadlineAt);
    const expiresAtMs = Date.parse(expiresAt);
    const validContactHash = !contactHash || /^[A-Fa-f0-9]{64}$/u.test(contactHash);
    if (value.v !== 1
        || !/^ci\.[A-Za-z0-9_-]{24,96}$/u.test(intentId)
        || !validContactHash
        || !provider
        || !channel
        || !Number.isFinite(issuedAtMs)
        || !Number.isFinite(createDeadlineMs)
        || !Number.isFinite(expiresAtMs)
        || createDeadlineMs <= issuedAtMs
        || expiresAtMs < createDeadlineMs
        || expiresAtMs - issuedAtMs > (GUEST_CHECKOUT_INTENT_MAX_AGE_SECONDS + 60) * 1000) {
        return null;
    }
    let normalized;
    try {
        normalized = security.normalizeGuestOrderInput({
            site: request.site,
            productId: request.productId,
            skuId: request.skuId,
            quantity: request.quantity,
            discountCode: request.discountCode || undefined,
            idempotencyKey
        }, {
            site: request.site,
            quantityMax: defaultGuestPromo.GUEST_MAX_QUANTITY_CEILING,
            allowOptionalContact: true,
            allowDiscountCode: true
        });
    } catch (_) {
        return null;
    }
    return {
        v: 1,
        intentId,
        idempotencyKey: normalized.idempotencyKey,
        issuedAt: new Date(issuedAtMs).toISOString(),
        createDeadlineAt: new Date(createDeadlineMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        request: {
            site: normalized.site,
            productId: normalized.productId,
            skuId: normalized.skuId,
            quantity: normalized.quantity,
            provider,
            channel,
            discountCode: normalized.discountCode || '',
            contactHash,
            credentialRequired
        }
    };
}

function decryptCheckoutIntentCookie(value, security, env) {
    const source = String(value || '').trim();
    const parts = source.split('.');
    if (parts.length !== 4 || parts[0] !== GUEST_CHECKOUT_INTENT_COOKIE_VERSION) return null;
    const key = checkoutIntentCookieKey(security, env);
    if (!key) return null;
    try {
        const iv = Buffer.from(parts[1], 'base64url');
        const tag = Buffer.from(parts[2], 'base64url');
        const ciphertext = Buffer.from(parts[3], 'base64url');
        if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length || ciphertext.length > 2048) return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        const parsed = JSON.parse(plaintext);
        return normalizeCheckoutIntentRecord(parsed, security);
    } catch (_) {
        return null;
    }
}

function encryptCheckoutIntentCookie(intent, security, env) {
    const key = checkoutIntentCookieKey(security, env);
    if (!key) return '';
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const plaintext = Buffer.from(JSON.stringify(intent), 'utf8');
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const tag = cipher.getAuthTag();
        return [
            GUEST_CHECKOUT_INTENT_COOKIE_VERSION,
            iv.toString('base64url'),
            tag.toString('base64url'),
            ciphertext.toString('base64url')
        ].join('.');
    } catch (_) {
        return '';
    }
}

function appendSetCookie(res, cookie) {
    if (!res?.setHeader || !cookie) return;
    let current = res.getHeader?.('Set-Cookie');
    if (!Array.isArray(current)) current = current ? [String(current)] : [];
    res.setHeader('Set-Cookie', [...current, cookie]);
}

function setCheckoutIntentCookie(res, intent, security, env) {
    const token = encryptCheckoutIntentCookie(intent, security, env);
    if (!token) return false;
    const remainingSeconds = Math.floor((Date.parse(intent.expiresAt) - Date.now()) / 1000);
    if (!Number.isFinite(remainingSeconds) || remainingSeconds < 1) return false;
    const maxAge = Math.min(GUEST_CHECKOUT_INTENT_MAX_AGE_SECONDS, Math.max(1, remainingSeconds));
    appendSetCookie(
        res,
        `${GUEST_CHECKOUT_INTENT_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`
    );
    return true;
}

function clearCheckoutIntentCookie(res) {
    appendSetCookie(
        res,
        `${GUEST_CHECKOUT_INTENT_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`
    );
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
    appendSetCookie(res, cookie);
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

function accessCookieKey(security, env) {
    try {
        const pepper = security.getGuestClaimPepper(env, { required: true });
        return crypto.createHash('sha256')
            .update(`guest-shop-access-cookie\0${pepper}`, 'utf8')
            .digest();
    } catch (_) {
        return null;
    }
}

function encryptAccessCookie(payload, security, env) {
    const key = accessCookieKey(security, env);
    if (!key) return '';
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const tag = cipher.getAuthTag();
        return [
            GUEST_ACCESS_COOKIE_VERSION,
            iv.toString('base64url'),
            tag.toString('base64url'),
            ciphertext.toString('base64url')
        ].join('.');
    } catch (_) {
        return '';
    }
}

function decryptAccessCookie(value, security, env) {
    const source = String(value || '').trim();
    const parts = source.split('.');
    if (parts.length !== 4 || parts[0] !== GUEST_ACCESS_COOKIE_VERSION) return null;
    const key = accessCookieKey(security, env);
    if (!key) return null;
    try {
        const iv = Buffer.from(parts[1], 'base64url');
        const tag = Buffer.from(parts[2], 'base64url');
        const ciphertext = Buffer.from(parts[3], 'base64url');
        if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length || ciphertext.length > 1024) return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        const parsed = JSON.parse(plaintext);
        if (!parsed || parsed.v !== 1) return null;
        const buyerId = String(parsed.buyer_id || '').trim();
        const contactHash = String(parsed.contact_hash || '').trim();
        const exp = Number(parsed.exp);
        const pv = Number(parsed.pv);
        // A session is only usable while it carries the group id AND the
        // password_version it was minted with, and has not expired. Never fall
        // back to contact_hash for authorization (§6.4).
        //
        // A missing/invalid `pv` makes the whole cookie invalid rather than
        // "pv unchecked": fail-closed. This is what turns password_version into
        // a real revocation handle — an admin reset link or a buyer password
        // reset moves the row's version and every outstanding cookie for that
        // group stops resolving (§10.5, deviation D-8).
        if (!buyerId || !Number.isFinite(exp) || exp <= Date.now()) return null;
        if (!Number.isSafeInteger(pv) || pv < 1) return null;
        return { buyerId, contactHash, pv, exp };
    } catch (_) {
        return null;
    }
}

function setAccessCookie(res, token) {
    if (!res?.setHeader || !token) return;
    const cookie = `${GUEST_ACCESS_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${GUEST_ACCESS_COOKIE_MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`;
    let current = res.getHeader?.('Set-Cookie');
    if (!Array.isArray(current)) current = current ? [String(current)] : [];
    res.setHeader('Set-Cookie', [...current, cookie]);
}

function clearAccessCookie(res) {
    if (!res?.setHeader) return;
    const cookie = `${GUEST_ACCESS_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
    let current = res.getHeader?.('Set-Cookie');
    if (!Array.isArray(current)) current = current ? [String(current)] : [];
    res.setHeader('Set-Cookie', [...current, cookie]);
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
    'idempotencyKey', 'idempotency_key', 'email', 'orderPassword', 'provider',
    'providerKey', 'provider_key', 'channel', 'paymentChannel', 'payment_channel',
    // Task 2.1: an unknown-result retry may ask the server to locate the order
    // created by this exact idempotency key before consulting mutable pricing.
    // This is a mode flag only; it is removed before order-input normalization.
    'resumeUnknown',
    // Task 2.1 P0: pre-commit intent controls. The opaque selector is not an
    // idempotency key and never reaches the create RPC.
    'checkoutAction', 'intentId',
    // Promo L2. The value is re-normalized (and rejected while the switch is
    // off) by security.normalizeGuestOrderInput, never trusted as an amount.
    'discountCode', 'discount_code'
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

    // Promo L1/L2 (plan §11.2 / C-E6). fn_guest_shop_create_order signals every
    // rejection as a bare `RAISE EXCEPTION 'guest_*'`, which arrives here as a
    // PostgREST error whose `code` is the SQLSTATE and whose `message` is the
    // machine code. Left alone that is a 500 `P0001` for a plain coupon typo, and
    // the checkout modal has no way to retract a discount line. The table lives in
    // api/_lib/guest-shop/promo.js so the frontend contract test can assert the
    // codes the client reacts to are codes this layer really emits.
    //
    // Two guarantees, both inherited from that table: every coupon-lifecycle
    // rejection collapses onto ONE public code/message (the granular SQL code and
    // the SQL DETAIL are never echoed, because either one is a coupon-existence
    // oracle), and an unmapped code returns null so the caller keeps the pre-L1
    // 500 instead of inventing a friendlier answer.
    function mapGuestCreateOrderError(error) {
        const mapped = defaultGuestPromo.resolveGuestCreateOrderError(error);
        if (mapped) {
            const mappedError = new security.GuestShopSecurityError(mapped.message, {
                statusCode: mapped.statusCode,
                code: mapped.code,
                expose: mapped.expose
            });
            // Internal only: failResponse serializes success/code/message and
            // nothing else, so this never reaches a response body.
            mappedError.internalCode = mapped.internalCode;
            return mappedError;
        }
        // Fail closed, but not leaky. A database rejection this batch does not
        // know about stays a 500 exactly as before L1/L2 - the generic message is
        // all a buyer gets. What it must NOT keep is the raw PostgREST shape:
        // `code: 'P0001'` and the SQL exception text are schema fingerprints, and
        // an unmapped `RAISE EXCEPTION 'guest_new_thing'` would otherwise be echoed
        // straight back as the response code.
        if (defaultGuestPromo.isOpaqueGuestDatabaseError(error)) {
            return new security.GuestShopSecurityError('游客购买请求失败', {
                statusCode: 500,
                code: 'guest_shop_request_failed',
                expose: false
            });
        }
        return error;
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

    // `quantity` is the caller-requested unit count (promo L1). It is only ever
    // used to (a) reject early against the effective per-order cap and (b) pick
    // the tier in the SAME resolver the database uses. It never scales an
    // amount here: resolveGuestCreditUnitAmount returns a per-unit price.
    async function loadGuestSkuPricing({ supabase, productId, skuId, siteName, quantity = null }) {
        if (!supabase?.from) throw Object.assign(new Error('数据库服务不可用'), { statusCode: 503, expose: false });
        const productQuery = await supabase.from('shop_products')
            .select('id,name,is_active,allow_guest_purchase,delivery_type,manual_delivery,guest_payment_channels,quantity_rules,quantity_rules_intl,flash_sale_price,flash_sale_price_intl,flash_sale_end,flash_sale_end_intl,guest_max_quantity,max_purchase_quantity')
            .eq('id', productId).maybeSingle();
        if (productQuery.error) throw productQuery.error;
        const product = productQuery.data;
        const skuQuery = await supabase.from('shop_product_skus')
            .select('id,product_id,sku_name,is_active,allow_guest_purchase,manual_delivery,guest_payment_channels,price_points,price_points_intl,quantity_rules,quantity_rules_intl,is_default,guest_max_quantity')
            .eq('id', skuId).eq('product_id', productId).maybeSingle();
        if (skuQuery.error) throw skuQuery.error;
        const sku = skuQuery.data;
        const enabled = Boolean(sku?.allow_guest_purchase ?? product?.allow_guest_purchase);
        const currency = security.currencyForSite(siteName);
        // Effective cap = min(operator env, sku.guest_max_quantity ??
        // product.guest_max_quantity ?? 1, product.max_purchase_quantity, 5),
        // mirroring the SQL expression in §6 of the L1/L2 migration. Missing
        // columns (a stub adapter, or a database that has not been migrated)
        // collapse the cap to 1, i.e. the pre-L1 behaviour.
        const quantityCap = defaultGuestPromo.resolveGuestQuantityCap({
            env,
            skuGuestMaxQuantity: sku?.guest_max_quantity ?? null,
            productGuestMaxQuantity: product?.guest_max_quantity ?? null,
            productMaxPurchaseQuantity: product?.max_purchase_quantity ?? null
        });
        const normalizedQuantity = defaultGuestPromo.normalizeGuestQuantity(quantity, { cap: quantityCap });
        if (normalizedQuantity === null) {
            // Fail closed with 400 rather than clamping: silently selling a
            // different quantity than the buyer asked for would mis-price the
            // tier and break the idempotency fingerprint contract.
            throw new security.GuestShopSecurityError('购买数量超出允许范围', {
                statusCode: 400, code: 'guest_quantity_not_allowed', field: 'quantity'
            });
        }
        const creditAmount = defaultGuestPricing.resolveGuestCreditUnitAmount({
            site: siteName,
            // L1: the tier loop picks the cheapest rule whose qty <= quantity and
            // the flash-sale branch ignores quantity, so this is exactly what
            // enables tiered/flash pricing on the guest channel.
            quantity: normalizedQuantity,
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
        // L1 display subtotal: the tiered/flash unit price above times the
        // validated quantity, rounded once. The browser never multiplies (§11.1),
        // so the preview response carries the number it should format. It stays
        // display-only - fn_guest_shop_create_order recomputes the list price in
        // SQL and the parity gate below rejects a row that disagrees.
        const listSubtotal = defaultGuestPricing.resolveGuestListSubtotal({
            unitAmount: price.amount,
            quantity: normalizedQuantity
        });
        return {
            product,
            sku,
            unitAmount: price.amount,
            unitAmountMinor: price.minor,
            currency,
            channels: sku?.guest_payment_channels ?? product?.guest_payment_channels ?? [],
            // Both are echo/UX values. fn_guest_shop_create_order re-applies the
            // same cap and raises guest_quantity_not_allowed itself, so a forged
            // or stale cap from the client can never enlarge an order.
            quantity: normalizedQuantity,
            quantityCap,
            // null only if the resolved unit amount fell outside the money
            // bounds; the client then renders '-' instead of guessing a total.
            subtotal: listSubtotal
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

    async function loadOrderForUnknownCreateResume(siteName, idempotencyKey) {
        const db = getSupabase();
        if (!db?.from) throw guestDatabaseUnavailableError();
        const fields = 'id,order_no,idempotency_key,request_fingerprint,site,currency,'
            + 'product_id,sku_id,snapshot_product_name,snapshot_sku_name,quantity,'
            + 'unit_amount,total_amount,payment_fee_amount,list_unit_amount,'
            + 'discount_amount,discount_code,metadata,payment_status,'
            + 'reservation_status,fulfillment_status,refund_status,claim_secret_hash,'
            + 'claim_secret_version,buyer_contact_hash,buyer_id,expires_at';
        const result = await db.from('guest_shop_orders').select(fields)
            .eq('site', siteName)
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle();
        if (result?.error) throw result.error;
        return result?.data || null;
    }

    function unknownCreateConflict() {
        return new security.GuestShopSecurityError('下单信息已变化，请重新提交', {
            statusCode: 409,
            code: 'guest_idempotency_conflict'
        });
    }

    function assertUnknownCreateOrderBinding(order, normalized, claimHash) {
        const storedQuantity = order?.quantity === undefined || order?.quantity === null
            ? 1
            : Number(order.quantity);
        const storedDiscount = String(order?.discount_code || '').trim().toUpperCase();
        const requestedDiscount = String(normalized?.discountCode || '').trim().toUpperCase();
        const claimMatches = security.constantTimeEqual(
            String(order?.claim_secret_hash || ''),
            String(claimHash || '')
        );
        if (String(order?.site || '').trim().toLowerCase() !== normalized.site
            || String(order?.product_id || '') !== normalized.productId
            || String(order?.sku_id || '') !== normalized.skuId
            || storedQuantity !== normalized.quantity
            || storedDiscount !== requestedDiscount
            || !claimMatches) {
            throw unknownCreateConflict();
        }
    }

    function checkoutIntentError(message, {
        statusCode = 409,
        code = 'guest_checkout_intent_invalid',
        expose = true
    } = {}) {
        return new security.GuestShopSecurityError(message, { statusCode, code, expose });
    }

    function checkoutIntentAction(body) {
        const hasAction = Object.prototype.hasOwnProperty.call(body || {}, 'checkoutAction');
        const hasIntentId = Object.prototype.hasOwnProperty.call(body || {}, 'intentId');
        if (!hasAction) {
            if (hasIntentId) {
                throw checkoutIntentError('结账恢复请求无效', {
                    statusCode: 400,
                    code: 'guest_checkout_intent_invalid'
                });
            }
            return '';
        }
        const action = String(body.checkoutAction || '').trim().toLowerCase();
        if (!GUEST_CHECKOUT_INTENT_ACTIONS.has(action)) {
            throw checkoutIntentError('结账恢复请求无效', {
                statusCode: 400,
                code: 'guest_checkout_intent_invalid'
            });
        }
        return action;
    }

    function checkoutIntentAlias(body, primary, aliases = []) {
        const keys = [primary, ...aliases]
            .filter((key) => Object.prototype.hasOwnProperty.call(body || {}, key));
        if (!keys.length) return undefined;
        const first = body[keys[0]];
        if (keys.slice(1).some((key) => body[key] !== first)) {
            throw checkoutIntentError('结账恢复请求字段不一致', {
                statusCode: 400,
                code: 'guest_checkout_intent_invalid'
            });
        }
        return first;
    }

    function ensureCheckoutIntentActionFields(body, action) {
        const fieldsByAction = {
            prepare: new Set([
                'checkoutAction', 'site', 'productId', 'product_id', 'skuId', 'sku_id', 'quantity',
                'email', 'provider', 'providerKey', 'provider_key', 'channel',
                'paymentChannel', 'payment_channel', 'discountCode', 'discount_code'
            ]),
            inspect: new Set(['checkoutAction']),
            commit: new Set(['checkoutAction', 'intentId', 'email', 'orderPassword']),
            ack: new Set(['checkoutAction', 'intentId'])
        };
        const allowed = fieldsByAction[action];
        for (const field of Object.keys(body || {})) {
            if (!allowed?.has(field)) {
                throw checkoutIntentError('结账恢复请求字段不允许', {
                    statusCode: 400,
                    code: 'guest_checkout_intent_invalid'
                });
            }
        }
    }

    function assertCheckoutIntentOrigin(req) {
        if (!isProductionLikeRuntime(env)) return;
        const origin = String(webhookHeader(req, 'origin') || '').trim().toLowerCase();
        const fetchSite = String(webhookHeader(req, 'sec-fetch-site') || '').trim().toLowerCase();
        const allowedOrigins = new Set([
            'https://fatherkey.com',
            'https://www.fatherkey.com',
            'https://zaoyoe.com',
            'https://www.zaoyoe.com',
            'https://zaoyoe.xyz',
            'https://www.zaoyoe.xyz'
        ]);
        if (!origin || !allowedOrigins.has(origin)
            || (fetchSite && !['same-origin', 'same-site'].includes(fetchSite))) {
            throw checkoutIntentError('结账安全校验失败', {
                statusCode: 403,
                code: 'guest_checkout_origin_invalid'
            });
        }
    }

    function readCheckoutIntent(req) {
        const intent = decryptCheckoutIntentCookie(
            cookieHeaderValue(req, GUEST_CHECKOUT_INTENT_COOKIE_NAME),
            security,
            env
        );
        if (!intent) return null;
        if (Date.parse(intent.expiresAt) <= Date.now()) return null;
        return intent;
    }

    function publicCheckoutIntent(intent, { pending = true } = {}) {
        if (!intent) return { pending: false };
        return {
            pending,
            intent_id: intent.intentId,
            state: Date.parse(intent.createDeadlineAt) > Date.now() ? 'ready' : 'resume_only',
            site: intent.request.site,
            product_id: intent.request.productId,
            sku_id: intent.request.skuId,
            quantity: intent.request.quantity,
            provider: intent.request.provider,
            channel: intent.request.channel,
            buyer_credential_required: intent.request.credentialRequired,
            contact_required: Boolean(intent.request.contactHash),
            has_discount_code: Boolean(intent.request.discountCode),
            create_deadline_at: intent.createDeadlineAt,
            expires_at: intent.expiresAt
        };
    }

    function sameCheckoutIntentRequest(intent, candidate) {
        const request = intent?.request || {};
        const storedContactHash = String(request.contactHash || '');
        const candidateContactHash = String(candidate.contactHash || '');
        const contactMatches = (!storedContactHash && !candidateContactHash)
            || (Boolean(storedContactHash) && Boolean(candidateContactHash)
                && security.constantTimeEqual(storedContactHash, candidateContactHash));
        return request.site === candidate.site
            && request.productId === candidate.productId
            && request.skuId === candidate.skuId
            && request.quantity === candidate.quantity
            && request.provider === candidate.provider
            && request.channel === candidate.channel
            && request.discountCode === candidate.discountCode
            && contactMatches;
    }

    function checkoutIntentId() {
        return `ci.${crypto.randomBytes(30).toString('base64url')}`;
    }

    function checkoutIntentIdempotencyKey() {
        return `ci.${crypto.randomBytes(30).toString('base64url')}`;
    }

    function normalizeCheckoutIntentPrepareRequest(body) {
        const siteName = normalizeSiteValue(body.site);
        const provider = checkoutIntentPaymentKey(
            checkoutIntentAlias(body, 'provider', ['providerKey', 'provider_key'])
        );
        const channel = checkoutIntentPaymentKey(
            checkoutIntentAlias(body, 'channel', ['paymentChannel', 'payment_channel']) || provider
        );
        if (!provider || !channel) {
            throw checkoutIntentError('支付通道不可用', {
                statusCode: 400,
                code: 'guest_invalid_payment_provider'
            });
        }
        const credentialRequired = defaultBuyerCredentials.isBuyerCredentialEnabled(env);
        const discountEnabled = defaultGuestPromo.isGuestDiscountEnabled(env) && credentialRequired;
        const normalized = security.normalizeGuestOrderInput({
            site: body.site,
            productId: checkoutIntentAlias(body, 'productId', ['product_id']),
            skuId: checkoutIntentAlias(body, 'skuId', ['sku_id']),
            quantity: body.quantity,
            email: body.email,
            discountCode: checkoutIntentAlias(body, 'discountCode', ['discount_code'])
        }, {
            site: siteName,
            requireIdempotencyKey: false,
            quantityMax: guestMaxQuantity(env),
            allowOptionalContact: true,
            allowDiscountCode: discountEnabled
        });
        if (credentialRequired && !normalized.email) {
            throw checkoutIntentError('请填写邮箱，用于查询订单', {
                statusCode: 400,
                code: 'guest_buyer_contact_required'
            });
        }
        const contactHash = checkoutIntentContactHash(normalized.email, security, env);
        if (normalized.email && !contactHash) {
            throw checkoutIntentError('结账安全服务不可用', {
                statusCode: 503,
                code: 'guest_checkout_intent_unavailable',
                expose: false
            });
        }
        return {
            site: normalized.site,
            productId: normalized.productId,
            skuId: normalized.skuId,
            quantity: normalized.quantity,
            provider,
            channel,
            discountCode: normalized.discountCode || '',
            contactHash,
            credentialRequired
        };
    }

    function issueCheckoutIntent(candidate, orderTtlSeconds) {
        const nowMs = Date.now();
        const createDeadlineAt = new Date(nowMs + GUEST_CHECKOUT_INTENT_CREATE_DEADLINE_SECONDS * 1000).toISOString();
        const expiresAt = new Date(nowMs + (GUEST_CHECKOUT_INTENT_CREATE_DEADLINE_SECONDS + orderTtlSeconds) * 1000).toISOString();
        return {
            v: 1,
            intentId: checkoutIntentId(),
            idempotencyKey: checkoutIntentIdempotencyKey(),
            issuedAt: new Date(nowMs).toISOString(),
            createDeadlineAt,
            expiresAt,
            request: candidate
        };
    }

    function assertCheckoutIntentSelector(intent, suppliedId) {
        const selector = String(suppliedId || '').trim();
        if (!intent || !/^ci\.[A-Za-z0-9_-]{24,96}$/u.test(selector)
            || !security.constantTimeEqual(intent.intentId, selector)) {
            throw checkoutIntentError('结账恢复请求无效', {
                statusCode: 403,
                code: 'guest_checkout_intent_invalid'
            });
        }
    }

    async function inspectCheckoutIntent(req, res) {
        const intent = readCheckoutIntent(req);
        if (!intent) {
            if (cookieHeaderValue(req, GUEST_CHECKOUT_INTENT_COOKIE_NAME)) clearCheckoutIntentCookie(res);
            return sendJson(res, 200, { success: true, intent: { pending: false } });
        }
        return sendJson(res, 200, { success: true, intent: publicCheckoutIntent(intent) });
    }

    async function prepareCheckoutIntent(req, res, body, orderTtlSeconds) {
        const candidate = normalizeCheckoutIntentPrepareRequest(body);
        let existing = readCheckoutIntent(req);
        // A prepare intent is a short create lease, not a two-hour checkout
        // reservation. Once the five-minute commit window has elapsed, retain
        // it only when the idempotent order is already present (the response
        // may have been lost). A stale, orderless intent is safe to rotate and
        // must not lock the buyer out of another SKU.
        if (existing && Date.parse(existing.createDeadlineAt) <= Date.now()) {
            let storedOrder;
            try {
                storedOrder = await loadOrderForUnknownCreateResume(
                    existing.request.site,
                    existing.idempotencyKey
                );
            } catch (_) {
                throw checkoutIntentError('暂时无法确认未完成订单，请稍后重试', {
                    statusCode: 503,
                    code: 'guest_checkout_intent_unavailable',
                    expose: false
                });
            }
            if (!storedOrder) {
                clearCheckoutIntentCookie(res);
                existing = null;
            }
        }
        if (existing) {
            if (sameCheckoutIntentRequest(existing, candidate)) {
                return sendJson(res, 200, {
                    success: true,
                    prepared: true,
                    reused: true,
                    intent: publicCheckoutIntent(existing)
                });
            }
            return sendJson(res, 409, {
                success: false,
                code: 'guest_checkout_intent_pending',
                message: '请先确认当前未完成订单，不要创建新的支付订单',
                intent: publicCheckoutIntent(existing)
            });
        }
        const intent = issueCheckoutIntent(candidate, orderTtlSeconds);
        if (!setCheckoutIntentCookie(res, intent, security, env)) {
            throw checkoutIntentError('结账安全服务不可用', {
                statusCode: 503,
                code: 'guest_checkout_intent_unavailable',
                expose: false
            });
        }
        return sendJson(res, 200, {
            success: true,
            prepared: true,
            intent: publicCheckoutIntent(intent)
        });
    }

    async function resolveCheckoutIntentCommit(req, body) {
        const intent = readCheckoutIntent(req);
        if (!intent) {
            throw checkoutIntentError('未找到可安全恢复的建单请求，请重新确认商品后再试', {
                statusCode: 409,
                code: 'guest_checkout_intent_missing'
            });
        }
        assertCheckoutIntentSelector(intent, body.intentId);
        const commitInput = {
            site: intent.request.site,
            productId: intent.request.productId,
            skuId: intent.request.skuId,
            quantity: intent.request.quantity,
            discountCode: intent.request.discountCode || undefined,
            idempotencyKey: intent.idempotencyKey,
            ...(Object.prototype.hasOwnProperty.call(body, 'email') ? { email: body.email } : {})
        };
        let normalized;
        try {
            normalized = security.normalizeGuestOrderInput(commitInput, {
                site: intent.request.site,
                quantityMax: defaultGuestPromo.GUEST_MAX_QUANTITY_CEILING,
                allowOptionalContact: true,
                allowDiscountCode: true
            });
        } catch (_) {
            throw checkoutIntentError('结账恢复请求无效', {
                statusCode: 400,
                code: 'guest_checkout_intent_invalid'
            });
        }
        const contactHash = checkoutIntentContactHash(normalized.email, security, env);
        const storedContactHash = String(intent.request.contactHash || '');
        const candidateContactHash = String(contactHash || '');
        const contactMatches = (!storedContactHash && !candidateContactHash)
            || (Boolean(storedContactHash) && Boolean(candidateContactHash)
                && security.constantTimeEqual(storedContactHash, candidateContactHash));
        if (!contactMatches) {
            throw checkoutIntentError('请使用创建该订单时填写的邮箱继续', {
                statusCode: 403,
                code: 'guest_checkout_intent_contact_mismatch'
            });
        }
        const storedOrder = await loadOrderForUnknownCreateResume(
            intent.request.site,
            intent.idempotencyKey
        );
        if (!storedOrder && Date.parse(intent.createDeadlineAt) <= Date.now()) {
            throw checkoutIntentError('该建单请求已过期，请重新确认商品后再试', {
                statusCode: 409,
                code: 'guest_checkout_intent_expired'
            });
        }
        return {
            body: {
                site: intent.request.site,
                productId: intent.request.productId,
                skuId: intent.request.skuId,
                quantity: intent.request.quantity,
                idempotencyKey: intent.idempotencyKey,
                provider: intent.request.provider,
                channel: intent.request.channel,
                ...(intent.request.discountCode ? { discountCode: intent.request.discountCode } : {}),
                ...(Object.prototype.hasOwnProperty.call(body, 'email') ? { email: body.email } : {}),
                ...(Object.prototype.hasOwnProperty.call(body, 'orderPassword') ? { orderPassword: body.orderPassword } : {}),
                // Existing-order lookup must happen before mutable pricing. This
                // is the safety property that turns a lost create response into
                // a replay, never a second reservation or provider payment intent.
                resumeUnknown: true
            },
            createDeadlineAt: intent.createDeadlineAt
        };
    }

    async function acknowledgeCheckoutIntent(req, res, body) {
        const intent = readCheckoutIntent(req);
        if (!intent) {
            throw checkoutIntentError('未找到可确认的建单请求', {
                statusCode: 409,
                code: 'guest_checkout_intent_missing'
            });
        }
        assertCheckoutIntentSelector(intent, body.intentId);
        const order = await loadOrderForUnknownCreateResume(intent.request.site, intent.idempotencyKey);
        if (!order) {
            throw checkoutIntentError('订单仍在确认中，暂不能清除恢复凭证', {
                statusCode: 409,
                code: 'guest_checkout_intent_unresolved'
            });
        }
        // Clearing the intent is destructive: it removes the only server-held
        // idempotency handle that can recover a response lost before the
        // browser received the order.  Require the claim proof minted by the
        // successful commit/recovery response as evidence that this browser
        // actually owns the persisted order.  The proof remains HttpOnly and
        // is verified against the bound order hash; an absent or forged proof
        // must leave the intent cookie untouched so the order can still be
        // recovered after a transient client failure.
        const claimProof = claimSecretFromCookie(req, order, security, env);
        if (!claimProof || !security.verifyClaimSecret(claimProof, order.claim_secret_hash, { env })) {
            throw checkoutIntentError('订单仍在确认中，暂不能清除恢复凭证', {
                statusCode: 409,
                code: 'guest_checkout_intent_unresolved'
            });
        }
        clearCheckoutIntentCookie(res);
        return sendJson(res, 200, { success: true, acknowledged: true });
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
        // Promo L1/L2: a guest order may now carry several units and a discount,
        // so the checkout modal renders 小计 / 优惠 / 手续费 / 应付 from the
        // DATABASE-committed amounts only. buildGuestAmountBreakdown returns null
        // (and the key is then omitted) whenever the row is not internally
        // consistent, so the client can never be handed a breakdown that does not
        // add up to the amount it is being asked to pay.
        const quantity = guestSnapshotQuantity(order);
        if (quantity !== null) result.quantity = quantity;
        const breakdown = guestSnapshotBreakdown(order);
        if (breakdown) result.amount_breakdown = breakdown;
        // The recovery code is a high-entropy bearer credential.  It is
        // returned only in the order-creation response (never in status,
        // webhook, logs or provider metadata) so a buyer may move to another
        // device.  The client must display it once and never persist it.
        if (typeof claimSecret === 'string' && /^[A-Za-z0-9_-]{40,200}$/u.test(claimSecret.trim())) {
            result.recovery_code = claimSecret.trim();
        }
        return result;
    }

    function boundPublicPaymentContext(order, payment) {
        if (!payment) return null;
        try {
            // Callers may only expose provider/channel from the exact payment
            // intent bound to this guest order. Keep this check local to the
            // serializer as defense in depth; arbitrary provider metadata is
            // never part of the public snapshot.
            paymentIdentity({
                // Persisted guest_shop_orders rows do not carry the payment id;
                // loadPaymentIntent obtains it from the uniquely bound payment
                // row. RPC create results may still include payment_order_id.
                payment_order_id: order?.payment_order_id || payment?.id,
                order_id: order?.order_id || order?.id,
                merchant_order_no: order?.order_no
            }, payment);
        } catch (_) {
            return null;
        }
        const normalizePaymentKey = (value) => {
            if (typeof value !== 'string') return '';
            const normalized = value.toLowerCase();
            return /^[a-z0-9][a-z0-9._:-]{0,79}$/u.test(normalized) ? normalized : '';
        };
        const provider = normalizePaymentKey(payment.provider);
        const channel = normalizePaymentKey(payment.channel);
        if (!provider || !channel) return null;
        return { provider, channel };
    }

    function publicOrderSnapshot(order, extras = {}) {
        const snapshot = {
            order_no: order.order_no,
            site: order.site,
            product_id: order.product_id,
            sku_id: order.sku_id,
            product_name: order.snapshot_product_name,
            sku_name: order.snapshot_sku_name,
            payment_status: order.payment_status,
            fulfillment_status: order.fulfillment_status,
            refund_status: order.refund_status,
            amount: order.total_amount,
            currency: order.currency,
            expires_at: order.expires_at
        };
        const paymentPricing = storedGuestPaymentPricing(order, extras.payment, extras.computed);
        if (paymentPricing) snapshot.payment_pricing = paymentPricing;
        // Promo L1/L2, same rule as responseOrder: echoed only when the committed
        // row carries a valid quantity and an internally consistent breakdown.
        const quantity = guestSnapshotQuantity(order);
        if (quantity !== null) snapshot.quantity = quantity;
        const breakdown = guestSnapshotBreakdown(order);
        if (breakdown) snapshot.amount_breakdown = breakdown;
        const paymentContext = boundPublicPaymentContext(order, extras.payment);
        if (paymentContext) Object.assign(snapshot, paymentContext);
        return snapshot;
    }

    async function respondToUnknownCreateResume({
        req,
        res,
        storedOrder,
        claimSecret,
        provider,
        channel
    }) {
        const order = {
            ...storedOrder,
            order_id: storedOrder.id,
            merchant_order_no: storedOrder.order_no
        };
        const payment = await loadPaymentIntent(order);
        order.payment_order_id = payment.id;
        paymentIdentity(order, payment);
        if (String(payment.provider || '').trim().toLowerCase() !== provider
            || String(payment.channel || '').trim().toLowerCase() !== channel) {
            throw unknownCreateConflict();
        }

        const paymentStatus = String(payment.status || '').trim().toLowerCase();
        const orderPaymentStatus = String(order.payment_status || '').trim().toLowerCase();
        let publicPaymentStatus = paymentStatus || orderPaymentStatus || 'review';
        let checkout = null;

        if (orderPaymentStatus === 'confirmed' || paymentStatus === 'confirmed') {
            publicPaymentStatus = 'confirmed';
        } else if (paymentStatusIsTerminal(orderPaymentStatus)) {
            publicPaymentStatus = orderPaymentStatus;
        } else if (paymentStatusIsTerminal(paymentStatus)) {
            publicPaymentStatus = paymentStatus;
        } else if (payment.provider_order_no
            && ['created', 'review', 'pending'].includes(paymentStatus)) {
            checkout = buildStoredCheckout(order, payment);
            if (!checkout) {
                // A provider reference without a reconstructable, allowlisted
                // checkout is not safe to show. Persist review when possible and
                // still return the order handle so the buyer can query it later.
                await markPaymentCreationReview(
                    order,
                    'payment_creation_checkout_unrecoverable',
                    '支付引用已存在但支付页面信息无法安全恢复'
                );
                publicPaymentStatus = 'review';
            }
        } else if (orderPaymentStatus === 'review' || paymentStatus === 'review') {
            // The prior provider request may have succeeded without returning a
            // reference. Never call the provider again from an unknown-result
            // resume; expose only the order handle and its review state.
            publicPaymentStatus = 'review';
        }

        setClaimProofCookie(req, res, order, claimSecret, security, env);
        return sendJson(res, 200, {
            success: true,
            replayed: true,
            resumed_unknown: true,
            order: responseOrder(order, claimSecret, { payment }),
            checkout,
            payment_status: publicPaymentStatus
        });
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
            // Promo L1/L2 columns are read (never written) here: list_unit_amount
            // identifies the amount regime of the row, quantity/discount_amount
            // let the fee base be re-checked against the committed discount math,
            // and payment_fee_amount tells a fee-pending row from a fee-written one.
            .select('id,unit_amount,total_amount,payment_fee_amount,quantity,'
                + 'list_unit_amount,discount_amount,metadata,payment_status')
            .eq('id', orderId);
        if (typeof query.maybeSingle === 'function') query = query.maybeSingle();
        const result = await query;
        if (result?.error) throw result.error;
        return result?.data || null;
    }

    /**
     * Write the channel surcharge onto a freshly created guest order.
     *
     * Promo L1/L2 introduced a second amount regime (migration §1) and this
     * function is the only place that decides which one applies:
     *
     *   list_unit_amount IS NOT NULL  ->  new regime. unit_amount is the NET
     *       (already discounted) unit price, payment_fee_amount carries the
     *       surcharge and total_amount = unit_amount*quantity + fee.
     *   list_unit_amount IS NULL      ->  legacy regime, unchanged: the fee is
     *       folded into unit_amount == total_amount and payment_fee_amount
     *       stays 0.
     *
     * Both shapes satisfy guest_shop_orders_amount_check, but only their own.
     * Writing the new shape onto a legacy row would charge the surcharge twice;
     * writing the legacy shape onto a new row would erase the discount and then
     * violate the CHECK. The regime is therefore read from the COMMITTED row,
     * never inferred from the request, and every amount written here is
     * re-derived from database-owned values and cross-checked against the
     * committed discount math before it is persisted. Nothing in this function
     * can lower an amount: it only adds the channel fee.
     */
    async function persistGuestPayableAmounts({
        order,
        payment,
        creditAmount,
        netUnitAmount = null,
        provider,
        lease,
        summaries = {}
    }) {
        const current = await loadGuestOrderAmountRow(order);
        const listUnitAmount = current?.list_unit_amount ?? order?.list_unit_amount ?? null;
        const quantity = defaultGuestPromo.normalizeGuestQuantity(
            current?.quantity ?? order?.quantity,
            { cap: defaultGuestPromo.GUEST_MAX_QUANTITY_CEILING }
        );
        const isNewRegime = listUnitAmount !== null && listUnitAmount !== undefined && quantity !== null;
        // Without the committed row the new regime cannot be verified at all, so
        // refuse to write anything and let the caller clear the creation lease
        // and return 503. The legacy regime keeps its pre-L1 fallbacks.
        if (isNewRegime && !current) return { ok: false, computed: null };

        // New regime: the database-committed NET unit price is authoritative (it
        // already carries the discount) and is stable across replays because the
        // fee lives in its own column. Legacy regime: the freshly resolved
        // catalogue unit price, exactly as before - a replayed legacy row stores
        // the fee-baked amount in unit_amount, so re-deriving from it would add
        // the surcharge a second time.
        const baseUnitAmount = isNewRegime
            ? (netUnitAmount ?? current?.unit_amount)
            : creditAmount;
        const computed = isNewRegime
            ? defaultGuestPricing.resolveGuestOrderPayablePricing({
                unitAmount: baseUnitAmount,
                quantity,
                providerKey: provider,
                summaries
            })
            : defaultGuestPricing.resolveGuestPayablePricing(baseUnitAmount, provider, summaries);
        if (!computed) {
            throw guestPayableAmountError('应付金额无效', 'guest_payable_amount_invalid');
        }
        const payableSnapshot = normalizeGuestCashPrice(
            computed.payableAmount,
            security,
            String(order?.currency || 'CNY')
        );
        if (!payableSnapshot || !(payableSnapshot.amount > 0)) {
            throw guestPayableAmountError('应付金额无效', 'guest_payable_amount_invalid');
        }
        computed.payableAmount = payableSnapshot.amount;
        computed.payload = defaultGuestPricing.buildGuestPaymentPricingPayload(computed);

        const targetUnit = isNewRegime ? computed.unitAmount : payableSnapshot.amount;
        const targetFee = isNewRegime ? (computed.surchargeAmount || 0) : 0;
        const targetTotal = payableSnapshot.amount;

        if (isNewRegime) {
            // Re-check the committed arithmetic before any money moves:
            //   list_unit * quantity - discount == net_unit * quantity == base
            //   base + fee == total
            // A row that does not agree with the amount we are about to charge is
            // a 503 for reconciliation, never a silent re-price.
            const listUnit = defaultGuestPricing.roundMoneyAmount(listUnitAmount, null);
            const discount = defaultGuestPricing.roundMoneyAmount(
                current.discount_amount ?? order?.discount_amount ?? 0, 0
            ) || 0;
            const netAmount = defaultGuestPricing.roundMoneyAmount(computed.baseAmount, null);
            const listAmount = listUnit === null
                ? null
                : defaultGuestPricing.roundMoneyAmount(listUnit * quantity, null);
            const unitTimesQuantity = defaultGuestPricing.roundMoneyAmount(targetUnit * quantity, null);
            const arithmeticTotal = netAmount === null
                ? null
                : defaultGuestPricing.roundMoneyAmount(netAmount + targetFee, null);
            const consistent = listUnit !== null && listAmount !== null && netAmount !== null
                && unitTimesQuantity !== null && arithmeticTotal !== null
                && discount >= 0 && discount < listAmount
                && defaultGuestPricing.moneyAmountsEqual(unitTimesQuantity, netAmount)
                && defaultGuestPricing.moneyAmountsEqual(listAmount - discount, netAmount)
                && defaultGuestPricing.moneyAmountsEqual(arithmeticTotal, targetTotal)
                && defaultGuestPricing.moneyAmountsEqual(current.unit_amount, targetUnit);
            if (!consistent) {
                throw guestPayableAmountError('订单金额与折扣不一致', 'guest_payable_amount_state_invalid');
            }
            // The row must be fee-pending (as the create RPC left it: fee 0 and
            // total == net) or already fee-written with exactly our target. Any
            // other combination means another writer moved the money.
            const feePending = defaultGuestPricing.moneyAmountsEqual(current.payment_fee_amount ?? 0, 0)
                && defaultGuestPricing.moneyAmountsEqual(current.total_amount, netAmount);
            const feeWritten = defaultGuestPricing.moneyAmountsEqual(current.payment_fee_amount, targetFee)
                && defaultGuestPricing.moneyAmountsEqual(current.total_amount, targetTotal);
            if (!feePending && !feeWritten) {
                throw guestPayableAmountError('订单金额状态异常', 'guest_payable_amount_state_invalid');
            }
        }

        const currentUnit = current?.unit_amount ?? order?.unit_amount ?? order?.total_amount;
        const currentTotal = current?.total_amount ?? order?.total_amount;
        const currentFee = current?.payment_fee_amount ?? order?.payment_fee_amount ?? 0;
        const alreadyOrder = defaultGuestPricing.moneyAmountsEqual(currentUnit, targetUnit)
            && defaultGuestPricing.moneyAmountsEqual(currentFee, targetFee)
            && defaultGuestPricing.moneyAmountsEqual(currentTotal, targetTotal);
        const alreadyPayment = defaultGuestPricing.moneyAmountsEqual(
            payment?.expected_amount,
            payableSnapshot.amount
        );
        const orderId = String(order?.order_id || order?.id || '').trim();
        const db = getSupabase();
        const metadata = applyPayableSnapshot(order, alreadyPayment ? payment : null, computed, current?.metadata);

        if (!alreadyOrder) {
            if (!db?.from || !orderId) return { ok: false, computed };
            const patch = {
                unit_amount: targetUnit,
                total_amount: targetTotal,
                metadata,
                updated_at: new Date().toISOString()
            };
            // Only the new regime writes the fee column; a legacy row must keep
            // payment_fee_amount = 0 with the surcharge folded into unit_amount.
            if (isNewRegime) patch.payment_fee_amount = targetFee;
            let query = db.from('guest_shop_orders').update(patch)
                .eq('id', orderId).eq('payment_status', 'pending');
            if (typeof query.select === 'function') {
                query = query.select('id,unit_amount,total_amount,payment_fee_amount,metadata').maybeSingle();
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
            // Promo L1: preview accepts a quantity so the modal can show the
            // tiered/flash unit price the buyer will actually be charged. It is
            // validated against the same per-SKU cap as the order itself (400
            // guest_quantity_not_allowed), and it only selects a tier - the
            // returned amount is still a per-unit price.
            const pricing = await loadGuestSkuPricing({
                supabase: getSupabase(),
                productId,
                skuId,
                siteName,
                quantity: queryValue(req, 'quantity')
            });
            const paymentProviders = defaultGuestPricing.publicGuestPaymentProviderSummaries(
                await defaultGuestPricing.loadGuestPaymentProviderSummaries({
                    supabase: getSupabase(),
                    siteName
                })
            );
            return sendJson(res, 200, {
                success: true,
                product: { id: pricing.product.id, name: pricing.product.name || '', sku_id: pricing.sku.id, sku_name: pricing.sku.sku_name || '' },
                // `amount` stays the PER-UNIT price (unchanged contract for
                // every existing consumer); `subtotal` is the L1 list total the
                // modal formats. Both come from the server resolver.
                price: {
                    amount: pricing.unitAmount,
                    currency: pricing.currency,
                    quantity: pricing.quantity,
                    subtotal: pricing.subtotal
                },
                // Promo L1/L2 UI switches. quantity_cap is the effective per-order
                // ceiling (1 while the switches are off, so the client keeps
                // hiding the stepper and the surface is unchanged); the database
                // re-applies the same cap on create. discount_enabled also
                // requires the buyer-credential switch because the database
                // refuses an unattributable discount (migration §5,
                // guest_discount_identity_required).
                quantity_cap: pricing.quantityCap,
                discount_enabled: defaultGuestPromo.isGuestDiscountEnabled(env)
                    && defaultBuyerCredentials.isBuyerCredentialEnabled(env),
                payment_channels: Array.isArray(pricing.channels) ? pricing.channels : [],
                payment_providers: paymentProviders,
                // Order Access 2.0 (§13.4): the order form only collects a query
                // password when the credential switch is on. The client toggles
                // the field from this flag, so no separate config channel is
                // needed and the switch-off path stays byte-identical to today.
                buyer_credential_required: defaultBuyerCredentials.isBuyerCredentialEnabled(env)
            });
        } catch (error) { return failResponse(res, error); }
    }

    async function orders(req, res, {
        skipRateLimit = false,
        internalBody = null,
        intentCreateDeadlineAt = ''
    } = {}) {
        setGuestSensitiveHeaders(res);
        // Order Access 2.0 (§12): GET on this same flat route lists the orders of
        // the authenticated buyer. The dispatcher has no path parameters
        // (resolveRoute lowercases and joins segments), so detail and delivery
        // live on their own flat keys with order_no in the query string. While
        // the credential switch is off the GET branch is unreachable and the
        // 405 below is exactly today's response.
        if (req.method === 'GET' && isGuestOrderAccessEnabled()) {
            return listOrders(req, res);
        }
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
        if (!skipRateLimit && !(await limit(req, res, 'orders', { limit: 12 }))) return;
        try {
            // Validate all deployment-controlled timing values before parsing
            // or mutating an order.  In particular, a malformed TTL must not
            // reach the create RPC after it has acquired inventory.
            const orderTtlSeconds = guestOrderTtlSeconds(env);
            paymentCreationLeaseMs(env);
            // A commit has already consumed the external request body before it
            // reaches the legacy order core. Only the action dispatcher below
            // can supply internalBody, so this is not a client-controllable way
            // to bypass parsing, allowlists, or rate limiting.
            const body = internalBody === null ? await parseJson(req) : internalBody;
            ensureAllowlist(body);
            const action = checkoutIntentAction(body);
            if (action) {
                ensureCheckoutIntentActionFields(body, action);
                assertCheckoutIntentOrigin(req);
                if (action === 'inspect') return await inspectCheckoutIntent(req, res);
                if (action === 'prepare') return await prepareCheckoutIntent(req, res, body, orderTtlSeconds);
                if (action === 'ack') return await acknowledgeCheckoutIntent(req, res, body);

                // `commit` carries only a public selector plus the current buyer
                // credentials. The sealed cookie supplies the product/payment
                // snapshot and server-generated idempotency key, then this
                // re-enters the established unknown-result path. Reusing that
                // path is what guarantees a lost commit response can only replay
                // the stored order, never initiate a second provider payment.
                const commit = await resolveCheckoutIntentCommit(req, body);
                return await orders(req, res, {
                    skipRateLimit: true,
                    internalBody: commit.body,
                    intentCreateDeadlineAt: commit.createDeadlineAt
                });
            }
            if (Object.prototype.hasOwnProperty.call(body, 'resumeUnknown')
                && typeof body.resumeUnknown !== 'boolean') {
                throw new security.GuestShopSecurityError('resumeUnknown 必须是布尔值', {
                    statusCode: 400,
                    code: 'invalid_field',
                    field: 'resumeUnknown'
                });
            }
            const resumeUnknown = body.resumeUnknown === true;
            const siteName = normalizeSiteValue(body.site);
            const provider = String(body.provider || body.providerKey || body.provider_key || '').trim().toLowerCase();
            const channel = String(body.channel || body.paymentChannel || body.payment_channel || provider).trim().toLowerCase();
            if (!provider || !channel || ['mock', 'test', 'fake'].includes(provider) || ['mock', 'test', 'fake'].includes(channel)) {
                throw new security.GuestShopSecurityError('支付通道不可用', { statusCode: 400, code: 'guest_invalid_payment_provider' });
            }
            const orderBody = { ...body };
            for (const field of ['provider', 'providerKey', 'provider_key', 'channel', 'paymentChannel', 'payment_channel']) delete orderBody[field];
            delete orderBody.resumeUnknown;
            // Order Access 2.0 (§6.1.4 / §12): the query password is collected on
            // the order form ONLY while the credential switch is on. It is never
            // an order input field, so lift it out before normalization and drop
            // it from the body that reaches normalizeGuestOrderInput.
            const credentialEnabled = defaultBuyerCredentials.isBuyerCredentialEnabled(env);
            const rawOrderPassword = orderBody.orderPassword;
            delete orderBody.orderPassword;
            // Promo L2: a discount code is only accepted while BOTH the discount
            // switch and the buyer-credential switch are on. The database will not
            // reserve a redemption it cannot attribute to a buyer group, and
            // silently dropping a submitted code would let a buyer believe they
            // got a discount the order does not carry - so normalizeGuestOrderInput
            // rejects it with 403 guest_discount_disabled instead.
            const discountEnabled = defaultGuestPromo.isGuestDiscountEnabled(env) && credentialEnabled;
            // Promo L1: quantityMax is the OPERATOR ceiling; the per-SKU cap from
            // loadGuestSkuPricing and the database cap are applied on top of it.
            // With GUEST_SHOP_MAX_QUANTITY unset this is 1, i.e. any quantity
            // other than 1 is rejected exactly as before L1.
            let normalized = security.normalizeGuestOrderInput(orderBody, {
                site: siteName,
                // Resume first performs syntax/bounds validation only. Current
                // operator caps and feature gates are re-applied below if no row
                // exists, so a committed quantity/code remains recoverable after
                // configuration changes without allowing a new order through.
                quantityMax: resumeUnknown
                    ? defaultGuestPromo.GUEST_MAX_QUANTITY_CEILING
                    : guestMaxQuantity(env),
                allowOptionalContact: true,
                allowDiscountCode: resumeUnknown || discountEnabled
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

            // Unknown-result retries are the one case where mutable catalogue
            // pricing must not participate in idempotency. The original order may
            // have committed immediately before the HTTP response was lost; a
            // later flash/tier price would otherwise create a new fingerprint and
            // strand the buyer behind guest_idempotency_conflict. Locate and bind
            // the existing row first, then return only persisted payment facts.
            const resumedOrder = resumeUnknown
                ? await loadOrderForUnknownCreateResume(siteName, normalized.idempotencyKey)
                : null;
            const resumeUnknownOrder = async (storedOrder) => {
                assertUnknownCreateOrderBinding(storedOrder, normalized, claimHash);
                if (credentialEnabled || Boolean(storedOrder.buyer_id)) {
                    const email = String(normalized.email || '').trim().toLowerCase();
                    const orderPassword = typeof rawOrderPassword === 'string' ? rawOrderPassword : '';
                    if (!email || !orderPassword) {
                        throw new security.GuestShopSecurityError('请填写邮箱和查询密码', {
                            statusCode: 400,
                            code: 'guest_buyer_contact_required'
                        });
                    }
                    // Authenticate without allocating another credential group.
                    // A wrong password on a resume must use the same lock/audit
                    // budget as the order-access login surface.
                    const auth = await resolveBuyerSessionFromPassword({
                        req,
                        email,
                        password: orderPassword,
                        siteName
                    });
                    if (String(storedOrder.buyer_id || '') !== String(auth.buyerId || '')
                        || !security.constantTimeEqual(
                            String(storedOrder.buyer_contact_hash || ''),
                            String(auth.contactHash || '')
                        )) {
                        throw guestCredentialsInvalidError();
                    }
                }
                return await respondToUnknownCreateResume({
                    req,
                    res,
                    storedOrder,
                    claimSecret,
                    provider,
                    channel
                });
            };
            if (resumedOrder) {
                return await resumeUnknownOrder(resumedOrder);
            }

            async function loadExpiredIntentOrderOrThrow() {
                if (!intentCreateDeadlineAt) return null;
                const deadlineMs = Date.parse(intentCreateDeadlineAt);
                if (!Number.isFinite(deadlineMs)) {
                    throw checkoutIntentError('结账恢复请求无效', {
                        statusCode: 400,
                        code: 'guest_checkout_intent_invalid'
                    });
                }
                if (deadlineMs > Date.now()) return null;
                const lateOrder = await loadOrderForUnknownCreateResume(siteName, normalized.idempotencyKey);
                if (lateOrder) return lateOrder;
                throw checkoutIntentError('该建单请求已过期，请重新确认商品后再试', {
                    statusCode: 409,
                    code: 'guest_checkout_intent_expired'
                });
            }

            const expiredBeforeCreate = await loadExpiredIntentOrderOrThrow();
            if (expiredBeforeCreate) return await resumeUnknownOrder(expiredBeforeCreate);

            // No row exists for this key. Continue the original creation path
            // with the SAME key; only this path consults current price/availability
            // and is allowed to acquire inventory or call the payment provider.
            if (resumeUnknown) {
                normalized = security.normalizeGuestOrderInput(orderBody, {
                    site: siteName,
                    quantityMax: guestMaxQuantity(env),
                    allowOptionalContact: true,
                    allowDiscountCode: discountEnabled
                });
            }
            const pricing = await loadGuestSkuPricing({
                supabase: getSupabase(),
                productId: normalized.productId,
                skuId: normalized.skuId,
                siteName,
                quantity: normalized.quantity
            });
            const fingerprint = security.buildGuestRequestFingerprint({
                ...normalized,
                unitAmount: pricing.unitAmount,
                pricingVersion: defaultGuestPricing.GUEST_CREDIT_PRICING_VERSION,
                provider,
                channel
            });
            const expiredAfterPricing = await loadExpiredIntentOrderOrThrow();
            if (expiredAfterPricing) return await resumeUnknownOrder(expiredAfterPricing);

            // Order Access 2.0 (§6.4): resolve the credential group that will own
            // this order. While the switch is OFF this is a no-op and the order
            // keeps the legacy non-strict contact hash (or null), so the path is
            // byte-identical to today. While ON, email + query password are
            // mandatory, the password is strength-checked server-side, and the
            // resolved buyer_id is bound to the order under the SAME strict
            // contact hash that keys the group (the create RPC re-verifies the
            // (buyer_id, site, contact_hash) triple and fails closed on mismatch).
            let buyerContactHash = hashContact(normalized.email);
            let buyerId = null;
            if (credentialEnabled) {
                const email = String(normalized.email || '').trim().toLowerCase();
                if (!email) {
                    throw new security.GuestShopSecurityError('请填写邮箱', {
                        statusCode: 400, code: 'guest_email_required', field: 'email'
                    });
                }
                const orderPassword = typeof rawOrderPassword === 'string' ? rawOrderPassword : '';
                // Server-authoritative strength check (§6.1.4). Safe to echo the
                // failing rule here: the buyer is present and no secret exists yet.
                defaultBuyerCredentials.assertBuyerQueryPasswordStrength(orderPassword, {
                    security, env, email, field: 'orderPassword'
                });
                buyerContactHash = security.hashGuestContact(email, { env, strict: true });
                const resolved = await defaultBuyerCredentials.resolveBuyerGroupForOrder({
                    supabase: getSupabase(),
                    security,
                    env,
                    site: siteName,
                    email,
                    password: orderPassword,
                    contactHash: buyerContactHash,
                    ipHash,
                    deviceHash
                });
                buyerId = resolved.buyerId;
            }

            // A prepared intent is allowed to create only inside its short
            // create window. Re-check immediately before the side-effecting RPC
            // because catalog and credential reads above may cross the deadline.
            // An order that appeared meanwhile takes the same authenticated
            // resume path as an order found at the start of this request.
            const expiredBeforeRpc = await loadExpiredIntentOrderOrThrow();
            if (expiredBeforeRpc) return await resumeUnknownOrder(expiredBeforeRpc);

            const { data, error } = await getSupabase().rpc('fn_guest_shop_create_order', {
                p_site: siteName, p_product_id: normalized.productId, p_sku_id: normalized.skuId,
                p_idempotency_key: normalized.idempotencyKey, p_request_fingerprint: fingerprint,
                p_claim_secret_hash: claimHash, p_provider: provider, p_channel: channel,
                p_buyer_contact_hash: buyerContactHash, p_buyer_id: buyerId, p_request_ip_hash: ipHash,
                p_request_device_hash: deviceHash, p_ttl_seconds: orderTtlSeconds,
                // Promo L1/L2. Both are re-validated inside the RPC (quantity cap,
                // code status/window/per-buyer limit, identity requirement), so a
                // value that slipped past this process still cannot widen an order.
                p_quantity: normalized.quantity,
                p_discount_code: normalized.discountCode || null
            });
            if (error) throw error;
            const order = Array.isArray(data) ? data[0] : data;
            if (!order?.order_id) throw new Error('订单创建失败');

            // Promo L1/L2 amount-regime detection and parity gate.
            //
            // list_unit_amount IS NOT NULL identifies a row written by the promo
            // create RPC; NULL identifies a pre-L1 row (or a replay of one), which
            // keeps the legacy fee-folded shape and is deliberately skipped here.
            //
            // For a new row the database must agree with the price this process
            // quoted and with the quantity the buyer asked for. A replay can only
            // reach this point with an identical request fingerprint, and that
            // fingerprint already pins quantity + unitAmountMinor, so the gate can
            // never trip on a legitimate retry: it only fires when the SQL and Node
            // resolvers disagree, in which case creating a payment would charge an
            // amount nobody quoted. Fail closed for reconciliation instead.
            const orderListUnitAmount = order?.list_unit_amount;
            const isNewRegimeOrder = orderListUnitAmount !== null && orderListUnitAmount !== undefined;
            if (isNewRegimeOrder
                && (Number(order.quantity) !== normalized.quantity
                    || !defaultGuestPricing.moneyAmountsEqual(orderListUnitAmount, pricing.unitAmount))) {
                throw guestPayableAmountError('订单定价与报价不一致', 'guest_pricing_parity_mismatch');
            }

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
                // Promo L1 holds up to 5 reservation rows per order, so a failed
                // payment creation must release ALL of them: a single leftover
                // held row would keep real stock locked until the TTL sweep and
                // would leave reservation_status inconsistent. The service-role
                // helper is idempotent, releases held rows only, recomputes the
                // order rollup and returns the released count. (The pre-L1 code
                // read one row with maybeSingle(), which now errors on a
                // multi-row order - the RPC removes that failure mode.)
                const released = await db.rpc('guest_shop_release_held_reservations', {
                    p_order_id: order.order_id,
                    p_reason: String(reason || 'payment_create_failed').slice(0, 120)
                });
                return !released?.error;
            }

            const paymentProviderSummaries = await defaultGuestPricing.loadGuestPaymentProviderSummaries({
                supabase: getSupabase(),
                siteName
            });
            // New-regime rows price the surcharge on the NET ORDER TOTAL
            // (unit*quantity, discount already applied by the database) and keep
            // unit_amount un-folded, so the replay/response payload must be built
            // from the committed row. Legacy rows keep the pre-L1 expression
            // byte-for-byte: their unit_amount already contains the fee once it
            // has been written, and re-deriving from it would double-charge.
            const computedPayable = (isNewRegimeOrder
                && defaultGuestPricing.resolveGuestOrderPayablePricing({
                    unitAmount: order.unit_amount,
                    quantity: order.quantity,
                    providerKey: provider,
                    summaries: paymentProviderSummaries
                }))
                || defaultGuestPricing.resolveGuestPayablePricing(
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
                // New-regime base: the database-committed NET unit price, which
                // already carries the L2 discount. persistGuestPayableAmounts
                // ignores it for legacy rows and re-checks it against the
                // committed discount math before writing anything.
                netUnitAmount: order.unit_amount,
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
        } catch (error) { return failResponse(res, mapGuestCreateOrderError(error)); }
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
            // Promo L1: an order can now hold up to 5 consumed reservations and
            // fn_guest_shop_claim_fulfillment returns exactly ONE row per call, so
            // the delivery read moved to the dedicated list helper. It re-validates
            // the WHOLE order under the same service-role contract (payment
            // confirmed, order delivered, every reservation consumed, every
            // inventory row sold and non-shared) and returns one
            // (reservation_id, item_index, content) row per item, ordered by
            // reservation creation. A partially delivered order therefore raises
            // instead of rendering as complete, and the buyer always receives all
            // of the cards they paid for.
            const result = await db.rpc('fn_guest_shop_list_delivered_content', {
                p_order_id: order.id
            });
            if (result?.error) throw mapDeliveredContentError(result.error);
            const rawRows = result?.data;
            const rows = Array.isArray(rawRows) ? rawRows : (rawRows ? [rawRows] : []);
            const contents = rows.map((row) => row?.content);
            // The pre-L1 contract is a single string; keep it for one card and
            // join multi-card orders so no client change is required to receive
            // every item. An empty list or a non-string content means the order is
            // not in a deliverable state.
            if (!rows.length || contents.some((text) => typeof text !== 'string')) {
                throw guestInventoryConsistencyError();
            }
            return contents.length === 1 ? contents[0] : contents.join('\n\n');
        }

        // Keep a compatibility path for thin local/test adapters that do not
        // expose RPCs. Production service-role clients have `.rpc` because
        // the worker and payment confirmation already depend on it. L1: read ALL
        // reservations of the order and apply the same all-consumed /
        // all-sold-non-shared rule the RPC enforces, so a partial delivery can
        // never be returned as complete.
        const reservations = await db.from('guest_shop_inventory_reservations')
            .select('inventory_id,status').eq('order_id', order.id);
        if (reservations.error) throw reservations.error;
        const rawReservations = reservations.data;
        const reservationRows = Array.isArray(rawReservations)
            ? rawReservations
            : (rawReservations ? [rawReservations] : []);
        if (!reservationRows.length
            || reservationRows.some((row) => String(row?.status || '') !== 'consumed')) {
            throw guestInventoryConsistencyError();
        }
        const contents = [];
        for (const row of reservationRows) {
            const inventory = await db.from('shop_inventory')
                .select('content,is_shared,status').eq('id', row.inventory_id).maybeSingle();
            if (inventory.error) throw inventory.error;
            if (!inventory.data || inventory.data.status !== 'sold' || inventory.data.is_shared) {
                throw guestInventoryConsistencyError();
            }
            contents.push(inventory.data.content);
        }
        return contents.length === 1 ? contents[0] : contents.join('\n\n');
    }

    // fn_guest_shop_list_delivered_content reports an undeliverable order as a
    // SQL exception. Map that family onto the pre-L1 409 so the delivery
    // endpoint keeps its existing response contract; anything unexpected
    // propagates unchanged instead of being disguised as an inventory problem.
    function mapDeliveredContentError(error) {
        const message = String(error?.message || '').trim();
        const code = String(error?.code || '').trim();
        const details = String(error?.details || '').trim();
        const known = new Set([
            'guest_order_required',
            'guest_order_not_found',
            'guest_payment_not_confirmed',
            'guest_order_not_delivered',
            'guest_reservation_not_consumed',
            'guest_consumed_inventory_inconsistent'
        ]);
        if (known.has(message) || known.has(code) || known.has(details)) {
            return guestInventoryConsistencyError();
        }
        return error;
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
        // Keep the object loaded by the status request in sync with the
        // best-effort persistence below so later response shaping can reuse
        // it without issuing a second payment-row query.
        payment.provider_metadata = next;
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

    async function buildThrottleHint(order, payment) {
        // Provide frontend with throttle state to optimize polling intervals
        // Delivered orders are fully terminal. Avoid reading the payment row
        // again after the status path has established that no stale checkout
        // or provider refresh can be relevant.
        if (!order?.payment_order_id
            || String(order.fulfillment_status || '').trim().toLowerCase() === 'delivered'
            || !payment) return null;
        try {
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
            const paymentStatus = String(order.payment_status || '').trim().toLowerCase();
            const fulfillmentStatus = String(order.fulfillment_status || '').trim().toLowerCase();
            // A refreshed tab may have only the non-sensitive order handle in
            // sessionStorage. Reconstruct the checkout from server-owned,
            // allowlisted provider metadata after the claim cookie has been
            // verified. This never returns the claim secret, raw webhook
            // payload, or arbitrary provider metadata.
            // The public order contract always includes the persisted payment
            // channel when the uniquely bound intent is available, including
            // after expiry, refund, chargeback, or delivery.  This is a local
            // database read only: terminal orders still must not reconstruct a
            // checkout or trigger a provider query merely to render that fact.
            const shouldReadPayment = true;
            let payment = null;
            if (shouldReadPayment) {
                try {
                    payment = await loadPaymentIntent({
                        payment_order_id: order.payment_order_id,
                        order_id: order.id,
                        merchant_order_no: order.order_no
                    });
                    if (!paymentStatusIsTerminal(paymentStatus)) {
                        checkout = buildStoredCheckout(order, payment);
                    }
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
                const shouldRefreshProvider = payment
                    && fulfillmentStatus !== 'delivered'
                    && (!paymentStatusIsTerminal(paymentStatus) || paymentStatus === 'confirmed');
                if (shouldRefreshProvider) {
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
            const throttleHint = await buildThrottleHint(order, payment);
            return sendJson(res, 200, {
                success: true,
                order: publicOrderSnapshot(order, { payment }),
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
            let payment = null;
            try {
                // A recovered terminal order still needs its bound payment
                // context in the allowlisted snapshot.  Reading the row is not
                // a provider operation, and checkout reconstruction remains
                // restricted to non-terminal orders below.
                payment = await loadPaymentIntent({
                    payment_order_id: order.payment_order_id,
                    order_id: order.id,
                    merchant_order_no: order.order_no
                });
                if (!paymentStatusIsTerminal(paymentStatus)) {
                    checkout = buildStoredCheckout(order, payment);
                }
            } catch (_) { checkout = null; }
            return sendJson(res, 200, {
                success: true,
                recovered: true,
                order: publicOrderSnapshot(order, { payment }),
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

    // ------------------------------------------------------------------
    // Order Access 2.0 (A2): buyer-credential session + list/detail/delivery.
    //
    // Everything in this block is gated behind BOTH the credential and
    // standalone-page switches. With either switch off each new route answers
    // 404 and the GET branch on /guest/orders is not even reachable, so the
    // deployed behaviour stays byte-identical to today (§13.4 / §15.1).
    // ------------------------------------------------------------------

    function buyerFeatureDisabledError() {
        // 404, not 403: an unreleased endpoint must not be distinguishable from
        // a route that never existed, otherwise the route map itself advertises
        // the rollout state of the credential feature.
        return Object.assign(new Error('接口不存在'), {
            statusCode: 404, code: 'guest_feature_disabled', expose: true
        });
    }

    function isGuestOrderAccessEnabled() {
        return defaultBuyerCredentials.isBuyerCredentialEnabled(env)
            && defaultBuyerCredentials.isGuestOrdersPageEnabled(env);
    }

    function ensureGuestOrderAccessEnabled() {
        if (!isGuestOrderAccessEnabled()) throw buyerFeatureDisabledError();
    }

    async function orderAccessAvailability(req, res) {
        setGuestSensitiveHeaders(res);
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }
        try {
            ensureGuestOrderAccessEnabled();
            // The page only needs a fail-closed capability acknowledgement; no
            // buyer, order, rollout detail or configuration values are exposed.
            return sendJson(res, 200, { success: true, enabled: true });
        } catch (error) { return failResponse(res, error); }
    }

    function guestCredentialsInvalidError() {
        // §9.1: ONE code and ONE message cover "unknown email", "wrong password"
        // and "this email has no guest order". The real reason only ever reaches
        // guest_shop_access_attempts.outcome, never the body, header or log.
        return new security.GuestShopSecurityError('邮箱或查询密码不正确', {
            statusCode: 403, code: 'guest_order_credentials_invalid'
        });
    }

    function guestOrderLockedError() {
        return new security.GuestShopSecurityError('尝试次数过多，请稍后再试', {
            statusCode: 423, code: 'guest_order_locked'
        });
    }

    function guestOrderRateLimitedError() {
        return new security.GuestShopSecurityError('操作过于频繁，请稍后再试', {
            statusCode: 429, code: 'guest_rate_limited'
        });
    }

    function guestOrderNotFoundError() {
        return new security.GuestShopSecurityError('未找到该订单', {
            statusCode: 404, code: 'guest_order_not_found'
        });
    }

    function guestDatabaseUnavailableError() {
        return Object.assign(new Error('游客订单数据库不可用'), {
            statusCode: 503, code: 'guest_database_unavailable', expose: false
        });
    }

    /**
     * §8.1 shared login path. POST /guest/access/login and the per-request
     * X-Guest-Order-Credential header both funnel through here, which is the
     * only reason the two channels share one lock budget, one audit stream and
     * one equal-cost scrypt. Bypassing it would hand an attacker a second,
     * uncounted guessing surface.
     */
    async function resolveBuyerSessionFromPassword({ req, email, password, siteName }) {
        const db = getSupabase();
        if (!db?.from) throw guestDatabaseUnavailableError();
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const rawPassword = typeof password === 'string' ? password : '';
        // Throws a 503 expose:false misconfiguration error on a malformed knob,
        // so a typo can never silently widen the budget to "unlimited".
        const settings = defaultBuyerCredentials.resolveBuyerCredentialSettings(env);
        const contactHash = security.hashGuestContact(normalizedEmail, { env, strict: true });
        const ipHash = hashRequestAttribute(clientIpForRateLimit(req));
        const deviceHash = hashRequestAttribute(req?.headers?.['user-agent'] || '');
        const audit = async (outcome, buyerId = null) => {
            // Evidence only. A failed insert must never flip an auth decision in
            // either direction, so this is isolated from the caller's outcome.
            try {
                await defaultBuyerCredentials.recordBuyerAccessAttempt({
                    supabase: db, site: siteName, contactHash, buyerId, ipHash, deviceHash, outcome
                });
            } catch (_) { /* best effort by contract */ }
        };

        // The IP budget is evaluated BEFORE any group read or scrypt: a spraying
        // attacker is cut off cheaply and cannot use latency as an email oracle.
        const ipFailures = await defaultBuyerCredentials.countRecentIpFailures({
            supabase: db,
            ipHash,
            windowSeconds: settings.loginWindowSeconds,
            budget: settings.ipMaxFailures
        });
        if (ipFailures >= settings.ipMaxFailures) {
            await audit('rate_limited');
            throw guestOrderRateLimitedError();
        }

        const rows = await defaultBuyerCredentials.loadBuyerGroups({
            supabase: db, site: siteName, contactHash
        });

        // A lock on ANY group of the contact locks the whole contact, and is
        // checked before scrypt so a locked contact is both cheap and free of a
        // timing side channel (§8.1).
        const lockedRow = defaultBuyerCredentials.findActiveBuyerLock(rows);
        if (lockedRow) {
            await audit('locked', lockedRow.id || null);
            throw guestOrderLockedError();
        }

        const { matched, needsRehash } = defaultBuyerCredentials
            .verifyBuyerPasswordAcrossGroups(rawPassword, rows, security);
        if (matched) {
            // §10.4 (A4) will retire guest access for a merged group. Nothing
            // writes merged_into_user_id yet, so this is the fail-closed guard:
            // a merged group answers exactly like a wrong password, reusing the
            // unified 403 and the existing outcome enum rather than inventing a
            // distinguishable signal.
            if (matched.mergedIntoUserId) {
                await audit('bad_password', matched.id);
                throw guestCredentialsInvalidError();
            }
            await defaultBuyerCredentials.resetBuyerLoginFailures({
                supabase: db, site: siteName, contactHash, rows
            });
            let rehashed = false;
            if (needsRehash) {
                rehashed = await defaultBuyerCredentials.rehashBuyerPasswordIfNeeded({
                    supabase: db, row: matched, password: rawPassword, security
                }) === true;
            }
            await audit('success', matched.id);
            // buyer_id (never contact_hash) is the authorization subject, so a
            // group=2 session cannot read group=1 orders or card content
            // (§6.4.2). The cookie payload below carries this same id.
            //
            // passwordVersion must reflect the value the row holds AFTER the
            // §6.2 transparent rehash, not the one we read: the rehash bumps it,
            // and a cookie minted with the stale number would be rejected by the
            // very next authenticated read. `rehashBuyerPasswordIfNeeded` is a
            // best-effort CAS (it returns false when the hash was already
            // current or when the write lost a race), so the version is derived
            // from its actual outcome through the SAME formula the writer used.
            return {
                buyerId: matched.id,
                contactHash,
                passwordVersion: rehashed
                    ? defaultBuyerCredentials.nextBuyerPasswordVersion(matched.passwordVersion)
                    : matched.passwordVersion
            };
        }

        const failure = await defaultBuyerCredentials.registerBuyerLoginFailure({
            supabase: db, site: siteName, contactHash, rows, settings
        });
        await audit(rows.length === 0 ? 'unknown_email' : 'bad_password');
        if (failure?.locked) throw guestOrderLockedError();
        throw guestCredentialsInvalidError();
    }

    /**
     * §9.2: ownership is proven by buyer_id and every non-match collapses to
     * 404 — never 403 — so detail/delivery cannot be used as an order-number
     * existence oracle.
     */
    async function loadOwnedGuestOrder(buyerId, orderNo) {
        const db = getSupabase();
        if (!db?.from) throw guestDatabaseUnavailableError();
        const normalized = String(orderNo || '').trim();
        if (!normalized) throw guestOrderNotFoundError();
        const result = await db.from('guest_shop_orders').select('*')
            .eq('order_no', normalized)
            .eq('buyer_id', String(buyerId))
            .maybeSingle();
        if (result?.error) throw result.error;
        if (!result?.data) throw guestOrderNotFoundError();
        return result.data;
    }

    /**
     * §10.5 / deviation D-8: the session cookie is a CACHED authorization, not
     * a standing one. Its AES-GCM tag proves we minted it; it cannot prove the
     * credential group is still in the state it was in when we minted it. So
     * every cookie-authenticated read re-validates four things against
     * `guest_shop_buyers`:
     *
     *   row exists            -> the group was not deleted
     *   merged_into_user_id   -> §10.4 retired guest access; fail closed
     *   locked_until          -> a lock raised on ANOTHER device after this
     *                            cookie was issued must still cut this one off,
     *                            otherwise §8.1's lock would only protect the
     *                            login endpoint and not the data it guards
     *   password_version == pv-> THE revocation handle. An admin issuing a reset
     *                            link, a buyer completing a reset, or a §6.2
     *                            transparent rehash all move it, and every
     *                            outstanding cookie for that group dies with it
     *
     * Cost: one indexed primary-key read per authenticated request, only while
     * the credential switch is on (with it off, order/delivery answer 404 before
     * authentication and the GET list branch is unreachable). That is the price
     * of making "revoke a guest session" mean something, and it is strictly
     * cheaper than the scrypt the header channel pays on every request.
     *
     * All four failures collapse to the SAME unified 403 as a wrong password
     * (§9.1), except the lock (423, matching login) and a database error (503,
     * retryable — an outage must not read as "your credentials are wrong").
     */
    async function validateSessionBuyer(session) {
        const db = getSupabase();
        if (!db?.from) throw guestDatabaseUnavailableError();
        const buyerId = String(session?.buyerId || '').trim();
        // A malformed id can only come from our own minting, so treat it as an
        // invalid session rather than letting a 404 escape the unified 403.
        if (!defaultBuyerAccessAdmin.isUuid(buyerId)) throw guestCredentialsInvalidError();
        let row = null;
        try {
            row = await defaultBuyerAccessAdmin.loadBuyerRowById({ supabase: db, buyerId });
        } catch (_) {
            // Past the UUID check the only throw is a database error.
            throw guestDatabaseUnavailableError();
        }
        if (!row) throw guestCredentialsInvalidError();
        if (row.mergedIntoUserId) throw guestCredentialsInvalidError();
        if (defaultBuyerAccessAdmin.isBuyerLocked(row)) throw guestOrderLockedError();
        if (Number(row.passwordVersion) !== Number(session.pv)) throw guestCredentialsInvalidError();
        return {
            buyerId: row.id,
            contactHash: row.contactHash,
            passwordVersion: row.passwordVersion
        };
    }

    /**
     * §7.1 transport rules for the credential endpoints:
     *   - query-string credentials are rejected outright, so they can never end
     *     up in an access log, a proxy log or a Referer header;
     *   - the session cookie wins when present, which is what lets a
     *     browser-native navigation (card download) work without a custom
     *     header;
     *   - otherwise the X-Guest-Order-Credential header is verified through the
     *     shared login path, keeping one lock budget.
     */
    async function authenticateGuestOrderAccess(req) {
        for (const name of ['email', 'order_password', 'orderPassword', 'password']) {
            const value = queryValue(req, name);
            if (value === undefined || value === null || String(value) === '') continue;
            // Audit the attempt with the real site when it parses; an unparseable
            // site is skipped rather than written as a row that the NOT NULL /
            // CHECK constraint would reject anyway. The 400 is returned either
            // way, so audit failure cannot weaken the rejection.
            let auditSite = '';
            try {
                auditSite = security.normalizeGuestSite(queryValue(req, 'site'));
            } catch (_) { auditSite = ''; }
            if (auditSite) {
                try {
                    await defaultBuyerCredentials.recordBuyerAccessAttempt({
                        supabase: getSupabase(),
                        site: auditSite,
                        contactHash: null,
                        buyerId: null,
                        ipHash: hashRequestAttribute(clientIpForRateLimit(req)),
                        deviceHash: hashRequestAttribute(req?.headers?.['user-agent'] || ''),
                        outcome: 'rate_limited'
                    });
                } catch (_) { /* best effort */ }
            }
            throw new security.GuestShopSecurityError('不支持通过 URL 传递查询凭证', {
                statusCode: 400, code: 'guest_credential_malformed', field: name
            });
        }

        const session = decryptAccessCookie(
            cookieHeaderValue(req, GUEST_ACCESS_COOKIE_NAME), security, env
        );
        // Cookie wins over the header (§7.1) but is NOT trusted on its own: see
        // validateSessionBuyer for the four re-validations and why a cookie
        // without them would make §8.1's lock and §10.5's reset unenforceable.
        if (session) return validateSessionBuyer(session);

        const header = req?.headers?.[security.GUEST_ORDER_CREDENTIAL_HEADER];
        if (header) {
            // parseGuestOrderCredentialHeader throws 400 guest_credential_malformed
            // for anything non-canonical, including the non-canonical base64url
            // re-encodings (§16.1).
            const parsed = security.parseGuestOrderCredentialHeader(header);
            return resolveBuyerSessionFromPassword({
                req,
                email: parsed.email,
                password: parsed.password,
                siteName: normalizeSiteValue(queryValue(req, 'site'))
            });
        }
        throw guestCredentialsInvalidError();
    }

    function guestOrderListSnapshot(order) {
        return {
            ...publicOrderSnapshot(order),
            site: order.site || '',
            quantity: Number(order.quantity) || 1,
            unit_amount: order.unit_amount === undefined || order.unit_amount === null
                ? null : order.unit_amount,
            created_at: order.created_at || null,
            // §11.2: the guest orders page renders two discount lines (coupon /
            // campaign). A2 shipped the container; L2 now fills the coupon line
            // from the database-committed discount_amount, and a legacy row stays
            // null so the client renders nothing instead of a misleading
            // "已优惠 0.00".
            coupon_discount: guestSnapshotDiscount(order),
            // L1 tier/flash pricing is committed AS the list unit price, not as a
            // separable amount, so there is nothing honest to render here. It
            // stays null until a campaign-discount column exists.
            promo_discount: null
        };
    }

    function parsePositiveQueryInt(value, { defaultValue, min, max }) {
        const raw = String(value ?? '').trim();
        if (!raw) return defaultValue;
        if (!/^\d+$/u.test(raw)) return defaultValue;
        const parsed = Number(raw);
        if (!Number.isSafeInteger(parsed)) return defaultValue;
        return Math.min(max, Math.max(min, parsed));
    }

    async function listOrders(req, res) {
        // Read budget 30/min (§8.1). Taken before authentication so an
        // unauthenticated spray still consumes the coarse limiter.
        if (!(await limit(req, res, 'guest-orders-read', { limit: 30 }))) return;
        try {
            const auth = await authenticateGuestOrderAccess(req);
            const db = getSupabase();
            if (!db?.from) throw guestDatabaseUnavailableError();
            const page = parsePositiveQueryInt(queryValue(req, 'page'), { defaultValue: 1, min: 1, max: 10_000 });
            const pageSize = parsePositiveQueryInt(queryValue(req, 'pageSize') ?? queryValue(req, 'page_size'), {
                defaultValue: 20, min: 1, max: 50
            });
            // Promo L1/L2 columns feed the §11.2 discount line and the amount
            // breakdown. They are database-owned values; the client only renders
            // them and never recomputes an amount from them.
            const fields = 'order_no,site,total_amount,currency,quantity,unit_amount,'
                + 'list_unit_amount,discount_amount,discount_code,payment_fee_amount,'
                + 'payment_status,fulfillment_status,refund_status,expires_at,created_at';
            let query = db.from('guest_shop_orders').select(fields, { count: 'exact' });
            // buyer_id is unique per (site, contact_hash), so it already implies
            // the site; no extra site filter is needed or wanted.
            query = query.eq('buyer_id', String(auth.buyerId));
            const orderNo = String(queryValue(req, 'order_no') || queryValue(req, 'orderNo') || '').trim();
            if (orderNo) query = query.eq('order_no', orderNo);
            if (typeof query.order === 'function') query = query.order('created_at', { ascending: false });
            if (typeof query.range === 'function') {
                query = query.range((page - 1) * pageSize, page * pageSize - 1);
            } else if (typeof query.limit === 'function') {
                query = query.limit(pageSize);
            }
            const result = await query;
            if (result?.error) throw result.error;
            const rows = Array.isArray(result?.data) ? result.data : [];
            const total = Number.isFinite(Number(result?.count)) && result?.count !== null
                ? Number(result.count) : rows.length;
            return sendJson(res, 200, {
                success: true,
                orders: rows.map(guestOrderListSnapshot),
                pagination: { page, page_size: pageSize, total }
            });
        } catch (error) { return failResponse(res, error); }
    }

    async function orderDetail(req, res) {
        setGuestSensitiveHeaders(res);
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }
        try {
            ensureGuestOrderAccessEnabled();
            if (!(await limit(req, res, 'guest-orders-read', { limit: 30 }))) return;
            const auth = await authenticateGuestOrderAccess(req);
            const order = await loadOwnedGuestOrder(
                auth.buyerId,
                queryValue(req, 'order_no') || queryValue(req, 'orderNo')
            );
            return sendJson(res, 200, { success: true, order: guestOrderListSnapshot(order) });
        } catch (error) { return failResponse(res, error); }
    }

    async function delivery(req, res) {
        setGuestSensitiveHeaders(res);
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }
        try {
            ensureGuestOrderAccessEnabled();
            // Card content is the highest-value payload on the guest surface, so
            // it gets a tighter budget than the list endpoint.
            if (!(await limit(req, res, 'guest-orders-delivery', { limit: 20 }))) return;
            const auth = await authenticateGuestOrderAccess(req);
            const order = await loadOwnedGuestOrder(
                auth.buyerId,
                queryValue(req, 'order_no') || queryValue(req, 'orderNo')
            );
            const paymentStatus = String(order.payment_status || '').trim().toLowerCase();
            const fulfillmentStatus = String(order.fulfillment_status || '').trim().toLowerCase();
            if (paymentStatus !== 'confirmed' || fulfillmentStatus !== 'delivered') {
                return sendJson(res, 409, {
                    success: false, code: 'guest_order_not_ready', message: '订单尚未完成发货'
                });
            }
            const content = await loadClaimedContent(order);
            return sendJson(res, 200, { success: true, order_no: order.order_no, content });
        } catch (error) { return failResponse(res, error); }
    }

    async function accessLogin(req, res) {
        setGuestSensitiveHeaders(res);
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }
        try {
            ensureGuestOrderAccessEnabled();
            // Write budget 10/min (§8.1), taken before the body is parsed so a
            // credential spray cannot amplify JSON work.
            if (!(await limit(req, res, 'guest-orders-write', { limit: 10 }))) return;
            const body = await parseJson(req);
            for (const key of Object.keys(body || {})) {
                if (!['email', 'password', 'orderPassword', 'order_password', 'site'].includes(key)) {
                    throw new security.GuestShopSecurityError('登录请求字段不允许', {
                        field: key, code: 'unknown_field'
                    });
                }
            }
            const email = String(body.email || '').trim().toLowerCase();
            const password = typeof body.password === 'string' && body.password
                ? body.password
                : (typeof body.orderPassword === 'string' && body.orderPassword
                    ? body.orderPassword
                    : String(body.order_password || ''));
            if (!email || !password) {
                throw new security.GuestShopSecurityError('请输入邮箱和查询密码', {
                    statusCode: 400, code: 'guest_credential_malformed', field: 'email'
                });
            }
            const siteName = normalizeSiteValue(body.site);
            const session = await resolveBuyerSessionFromPassword({ req, email, password, siteName });
            const token = encryptAccessCookie({
                v: 1,
                buyer_id: session.buyerId,
                contact_hash: session.contactHash,
                // `pv` is the revocation handle (§10.5 / D-8). decryptAccessCookie
                // rejects a cookie without it, so this can never be omitted by a
                // future edit without breaking login loudly in tests.
                pv: session.passwordVersion,
                exp: Date.now() + GUEST_ACCESS_COOKIE_MAX_AGE_SECONDS * 1000
            }, security, env);
            if (!token) {
                // A missing claim pepper must not silently degrade the buyer to
                // the header-only channel; fail closed with a retryable 503.
                throw Object.assign(new Error('会话签发失败'), {
                    statusCode: 503, code: 'guest_shop_misconfigured', expose: false
                });
            }
            setAccessCookie(res, token);
            return sendJson(res, 200, {
                success: true,
                authenticated: true,
                // Only the buyer's own email is echoed, for the "已保存 xxx 的查询
                // 凭证" hint. buyer_id stays server-side inside the cookie.
                email,
                session_expires_in_seconds: GUEST_ACCESS_COOKIE_MAX_AGE_SECONDS
            });
        } catch (error) { return failResponse(res, error); }
    }

    async function accessLogout(req, res) {
        setGuestSensitiveHeaders(res);
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }
        // Deliberately NOT gated on the credential switch: if the feature is
        // rolled back while a cookie is live, the buyer must still be able to
        // clear it. Logout exposes no data and grants nothing.
        clearAccessCookie(res);
        return sendJson(res, 200, { success: true, logged_out: true });
    }


    /**
     * §9.1 / §10.5: ONE code and ONE message for every failed reset — no such
     * link, expired, already used, revoked, wrong email, deleted group, merged
     * group. The real reason only ever reaches
     * `guest_shop_access_attempts.outcome = reset_invalid`.
     */
    function guestResetInvalidError() {
        return new security.GuestShopSecurityError('找回链接无效或已过期', {
            statusCode: 403, code: 'guest_reset_invalid'
        });
    }

    /**
     * §10.5 (A3): consume an admin-issued one-time link and set a new query
     * password. This is the "forgot my query password" path until OTP (§10.3)
     * ships; the admin verifies the buyer through a support channel and issues
     * the link, and the buyer completes it here without any support interaction.
     *
     * WHY THERE IS NO scrypt ON THE FAILURE PATHS (and why that is correct here
     * but would be a bug on the login path): the login path defends a 45-bit
     * guessable password, so §8.4 makes every answer cost the same. This path
     * defends a 256-bit CSPRNG token that cannot be guessed at all — there is no
     * brute force to slow down. Running a dummy derivation on every invalid
     * token would convert a free indexed lookup into ~100 ms of attacker-chosen
     * CPU work, i.e. it would CREATE the amplification it was meant to hide.
     * The single scrypt here happens only after token+email are both proven.
     *
     * WHY THE EMAIL IS CHECKED BEFORE THE CONSUME: an attacker who steals the
     * link but not the mailbox cannot burn it, and a buyer who typos their email
     * does not lose their own link. This costs nothing in oracle terms, because
     * reaching the comparison already requires the 256-bit token.
     *
     * Ordering summary: local shape/strength checks -> read pending row ->
     * constant-time email match -> CAS consume -> load group -> rehash under a
     * password_version CAS -> audit -> mint a session cookie with the NEW pv.
     */
    async function accessReset(req, res) {
        setGuestSensitiveHeaders(res);
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }
        try {
            ensureGuestOrderAccessEnabled();
            // Same write budget as login (§8.1): the reset endpoint is a
            // credential-setting surface and must not be cheaper to spray.
            if (!(await limit(req, res, 'guest-orders-write', { limit: 10 }))) return;
            const body = await parseJson(req);
            for (const key of Object.keys(body || {})) {
                if (!['token', 'resetToken', 'reset_token', 'email', 'password', 'orderPassword', 'order_password', 'site'].includes(key)) {
                    throw new security.GuestShopSecurityError('重置请求字段不允许', {
                        field: key, code: 'unknown_field'
                    });
                }
            }
            const siteName = normalizeSiteValue(body.site);
            const db = getSupabase();
            if (!db?.from) throw guestDatabaseUnavailableError();
            const ipHash = hashRequestAttribute(clientIpForRateLimit(req));
            const deviceHash = hashRequestAttribute(req?.headers?.['user-agent'] || '');
            const audit = async (outcome, contactHash = null, buyerId = null) => {
                // Best effort by contract: a failed audit insert must never flip
                // the decision that has already been made.
                try {
                    await defaultBuyerCredentials.recordBuyerAccessAttempt({
                        supabase: db, site: siteName, contactHash, buyerId, ipHash, deviceHash, outcome
                    });
                } catch (_) { /* evidence only */ }
            };

            const rawToken = defaultBuyerAccessAdmin.normalizeResetToken(
                body.token || body.resetToken || body.reset_token
            );
            const rawEmail = String(body.email || '').trim().toLowerCase();
            const newPassword = typeof body.password === 'string' && body.password
                ? body.password
                : (typeof body.orderPassword === 'string' && body.orderPassword
                    ? body.orderPassword
                    : String(body.order_password || ''));

            // Cheap local rejects FIRST: no database read is owed to a request
            // that cannot possibly succeed.
            if (!rawToken || !rawEmail) {
                await audit('reset_invalid');
                throw guestResetInvalidError();
            }
            try {
                // §6.1.4: echoing the failing rule is safe — the buyer is present
                // and the answer is identical whether or not the token is valid,
                // so this leaks nothing about the link.
                defaultBuyerCredentials.assertBuyerQueryPasswordStrength(newPassword, {
                    security, env, email: rawEmail, field: 'password'
                });
            } catch (error) {
                await audit('reset_invalid');
                throw error;
            }

            const tokenHash = defaultBuyerAccessAdmin.hashResetToken(rawToken);
            const pending = await defaultBuyerAccessAdmin.loadPendingResetByTokenHash({
                supabase: db, tokenHash
            });
            if (!pending || pending.purpose !== defaultBuyerAccessAdmin.RESET_PURPOSE
                || pending.site !== siteName) {
                await audit('reset_invalid');
                throw guestResetInvalidError();
            }
            // The audit row names the group the link was minted for, not the
            // attacker-supplied email: "someone probed group X" is the useful
            // forensic fact, and contact_hash is an HMAC anyway.
            if (!defaultBuyerAccessAdmin.matchesResetContact({ reset: pending, email: rawEmail, security, env })) {
                await audit('reset_invalid', pending.contactHash || null, pending.buyerId || null);
                throw guestResetInvalidError();
            }
            const consumed = await defaultBuyerAccessAdmin.consumeResetToken({
                supabase: db, tokenHash, ipHash
            });
            if (!consumed || consumed.buyerId !== pending.buyerId) {
                // Lost the race against a second browser, or revoked in between.
                // Same answer as an invalid link: the token is spent either way.
                await audit('reset_invalid', pending.contactHash || null, pending.buyerId || null);
                throw guestResetInvalidError();
            }

            const buyer = await defaultBuyerAccessAdmin.loadBuyerRowById({
                supabase: db, buyerId: consumed.buyerId, site: consumed.site || siteName
            });
            if (!buyer || buyer.mergedIntoUserId) {
                await audit('reset_invalid', pending.contactHash || null, pending.buyerId || null);
                throw guestResetInvalidError();
            }
            const applied = await defaultBuyerAccessAdmin.applyPasswordReset({
                supabase: db, buyer, password: newPassword, security
            });
            await audit('reset_success', buyer.contactHash || null, applied.buyerId);

            // Sign the buyer straight in: they have just proven link + email +
            // set a password, and making them retype it would only teach them
            // that the reset page and the login page disagree. The cookie carries
            // the NEW password_version, so every other outstanding cookie for
            // this group is dead (D-8).
            const token = encryptAccessCookie({
                v: 1,
                buyer_id: applied.buyerId,
                contact_hash: buyer.contactHash,
                pv: applied.passwordVersion,
                exp: Date.now() + GUEST_ACCESS_COOKIE_MAX_AGE_SECONDS * 1000
            }, security, env);
            if (!token) {
                // The password is already changed; only the convenience session
                // failed. Say so instead of pretending the reset failed.
                return sendJson(res, 200, {
                    success: true,
                    reset: true,
                    authenticated: false,
                    session_required: true,
                    email: rawEmail
                });
            }
            setAccessCookie(res, token);
            return sendJson(res, 200, {
                success: true,
                reset: true,
                authenticated: true,
                email: rawEmail,
                session_expires_in_seconds: GUEST_ACCESS_COOKIE_MAX_AGE_SECONDS
            });
        } catch (error) { return failResponse(res, error); }
    }

    /**
     * §13.2 (A3): self-service upgrade of a HISTORICAL order
     * (`buyer_id IS NULL`, placed before the credential switch existed) to
     * email + query-password access.
     *
     * Two factors, in this order:
     *   1. orderNo + recoveryCode — the legacy claim secret, verified through
     *      the SAME `verifyClaimSecret` + `recordClaimFailure` budget as
     *      `/guest/recover`, so this endpoint does not become a second,
     *      uncounted guessing surface for it;
     *   2. email + new/existing query password — resolved through
     *      `resolveBuyerGroupForOrder`, which is the order-path resolver, so
     *      the upgrade inherits §8.1 locking, the per-IP budget, §8.4
     *      equal-cost verification and the §6.4 group cap for free instead of
     *      re-implementing any of them.
     *
     * The site is taken from the ORDER, never from the body: the credential
     * group key is (site, contact_hash), and letting the client pick the site
     * would let one recovery code mint groups in a site the order was never
     * placed in.
     *
     * Idempotent: re-submitting resolves to the same group and returns success.
     * A different group is a hard 409 and needs support (§13.2).
     */
    async function accessUpgrade(req, res) {
        setGuestSensitiveHeaders(res);
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }
        try {
            ensureGuestOrderAccessEnabled();
            // Shares the `recover` budget because it spends the same secret.
            if (!(await limit(req, res, 'recover', { limit: 8 }))) return;
            const body = await parseJson(req);
            for (const key of Object.keys(body || {})) {
                if (!['orderNo', 'order_no', 'recoveryCode', 'recovery_code', 'email', 'password', 'orderPassword', 'order_password', 'site'].includes(key)) {
                    throw new security.GuestShopSecurityError('升级请求字段不允许', {
                        field: key, code: 'unknown_field'
                    });
                }
            }
            const db = getSupabase();
            if (!db?.from) throw guestDatabaseUnavailableError();
            const orderNo = String(body.orderNo || body.order_no || '').trim();
            const recoveryCode = String(body.recoveryCode || body.recovery_code || '').trim();
            const email = String(body.email || '').trim().toLowerCase();
            const password = typeof body.password === 'string' && body.password
                ? body.password
                : (typeof body.orderPassword === 'string' && body.orderPassword
                    ? body.orderPassword
                    : String(body.order_password || ''));
            // Identical shapes to /guest/recover: one canonical spelling per
            // field, so the two endpoints cannot be used to probe each other's
            // normalization (§16.1).
            if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u.test(orderNo)
                || !/^[A-Za-z0-9_-]{40,200}$/u.test(recoveryCode)) {
                throw new security.GuestShopSecurityError('订单号或取货口令无效', {
                    code: 'guest_claim_invalid', statusCode: 403
                });
            }
            if (!email || !password) {
                throw new security.GuestShopSecurityError('请填写邮箱和查询密码', {
                    statusCode: 400, code: 'guest_credential_malformed', field: 'email'
                });
            }

            const order = await loadOrderByNo(orderNo);
            const siteName = normalizeSiteValue(order.site);
            const ipHash = hashRequestAttribute(clientIpForRateLimit(req));
            const deviceHash = hashRequestAttribute(req?.headers?.['user-agent'] || '');
            const audit = async (outcome, contactHash = null, buyerId = null) => {
                try {
                    await defaultBuyerCredentials.recordBuyerAccessAttempt({
                        supabase: db, site: siteName, contactHash, buyerId, ipHash, deviceHash, outcome
                    });
                } catch (_) { /* evidence only */ }
            };

            // The claim-failure budget is spent BEFORE anything else is looked
            // at, exactly as in /guest/recover.
            if (!security.verifyClaimSecret(recoveryCode, order.claim_secret_hash, { env })) {
                await recordClaimFailure(order);
                await audit('upgrade_invalid');
                throw Object.assign(new Error('取货凭证无效'), {
                    statusCode: 403, code: 'guest_claim_invalid'
                });
            }
            // There is deliberately NO early return for an already-bound order.
            //
            // §13.2 hardening: an order bound before A3 carries only `buyer_id`.
            // Minting a session cookie from that alone would let anyone holding
            // the LEGACY orderNo + claim code escalate from single-order legacy
            // access to GROUP-WIDE access — every order and every card in that
            // credential group — which is precisely the 掏鸟蛋 failure mode. So a
            // bound order goes through the SAME email + password verification as
            // an unbound one (`resolveBuyerGroupForOrder` runs §8.4 equal-cost
            // scrypt verification regardless of binding state), and only the
            // binding step differs: same group -> idempotent success, different
            // group -> hard 409 for support, exactly as §13.2 specifies.
            //
            // K26 (§6.1) applies to EVERY surface that can create a credential:
            // the resolve below may allocate a brand-new group, and a weak
            // password guarding card content is exactly what the policy exists
            // to prevent. A reused (matched) password was minted under the same
            // policy at order time, so this check can never lock a legitimate
            // buyer out of the reuse path.
            try {
                defaultBuyerCredentials.assertBuyerQueryPasswordStrength(password, {
                    security, env, email, field: 'password'
                });
            } catch (error) {
                await audit('upgrade_invalid');
                throw error;
            }
            let resolved = null;
            try {
                resolved = await defaultBuyerCredentials.resolveBuyerGroupForOrder({
                    supabase: db,
                    security,
                    env,
                    site: siteName,
                    email,
                    password,
                    ipHash,
                    deviceHash
                });
            } catch (error) {
                // resolveBuyerGroupForOrder already recorded the specific reason
                // (locked / rate_limited / credential_conflict). One extra
                // `upgrade_invalid` row marks this as the upgrade surface; it is
                // deliberately NOT a failure outcome, so it cannot double count
                // into the per-IP login budget.
                await audit('upgrade_invalid');
                throw error;
            }
            const contactHash = security.hashGuestContact(email, { env, strict: true });
            let binding = null;
            try {
                binding = await defaultBuyerAccessAdmin.bindOrderToBuyer({
                    supabase: db, order, buyerId: resolved.buyerId
                });
            } catch (error) {
                // The credential itself verified; this failure is about the order
                // row (409: already bound to a DIFFERENT group). No cookie is set
                // on this path, so the verified credential gains nothing it did
                // not already have through /guest/access/login. Audited as
                // `upgrade_invalid` for evidence.
                await audit('upgrade_invalid', contactHash, resolved.buyerId);
                throw error;
            }
            // Read back for the CURRENT password_version: on the reuse path the
            // §6.2 transparent rehash happens inside the allocation RPC, so the
            // number we would otherwise guess may already be stale and the
            // cookie would be rejected by its own first authenticated read.
            const buyer = await defaultBuyerAccessAdmin.loadBuyerRowById({
                supabase: db, buyerId: resolved.buyerId, site: siteName
            });
            await audit('upgrade_success', contactHash, resolved.buyerId);
            const token = buyer ? encryptAccessCookie({
                v: 1,
                buyer_id: buyer.id,
                contact_hash: buyer.contactHash,
                pv: buyer.passwordVersion,
                exp: Date.now() + GUEST_ACCESS_COOKIE_MAX_AGE_SECONDS * 1000
            }, security, env) : '';
            if (token) setAccessCookie(res, token);
            return sendJson(res, 200, {
                success: true,
                upgraded: true,
                already_bound: binding.alreadyBound === true,
                order_no: order.order_no,
                credential_group_no: resolved.groupNo || null,
                authenticated: Boolean(token),
                ...(token ? { session_expires_in_seconds: GUEST_ACCESS_COOKIE_MAX_AGE_SECONDS } : {})
            });
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
        // Order Access 2.0 (A2). All of these answer 404
        // guest_feature_disabled unless both the credential and standalone-page
        // switches are on (logout excepted: it only clears a cookie, so it must
        // keep working after a rollback).
        accessAvailability: orderAccessAvailability,
        order: orderDetail,
        delivery,
        accessLogin,
        accessLogout,
        // Order Access 2.0 (A3). Both answer 404 guest_feature_disabled while
        // GUEST_SHOP_BUYER_CREDENTIAL_ENABLED is off, so the deployed surface is
        // unchanged (§13.4). accessReset spends an admin-issued one-time link
        // (§10.5); accessUpgrade is the §13.2 historical-order self-service.
        accessReset,
        accessUpgrade,
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
        guestMaxQuantity,
        guestOrderTtlSeconds,
        guestSnapshotBreakdown,
        guestSnapshotDiscount,
        guestSnapshotQuantity,
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
