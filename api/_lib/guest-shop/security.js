'use strict';

/**
 * Security and input helpers for the isolated guest-shop cash channel.
 *
 * This module deliberately has no Supabase or HTTP-handler dependency.  The
 * handlers can use the helpers to establish a canonical request before doing
 * any database or provider work.  In particular, webhook callers should use
 * readRawBodyWithLimit() and verifyHmacEnvelope() before parsing JSON: a
 * parsed/re-serialized object is not the signed byte sequence.
 */

const crypto = require('crypto');

const SUPPORTED_SITES = Object.freeze(['cn', 'intl']);
const SITE_CURRENCIES = Object.freeze({ cn: 'CNY', intl: 'CNY' });
const DEFAULT_JSON_BODY_LIMIT = 16 * 1024;
const DEFAULT_WEBHOOK_BODY_LIMIT = 256 * 1024;
// Keep every route-specific reader below a hard upper bound.  This is an
// operational safety valve as well as a parser guard: a typo in an env value
// must never turn into an unbounded Buffer allocation.
const MAX_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
const DEFAULT_CLAIM_SECRET_BYTES = 32;
const DEFAULT_HMAC_SKEW_SECONDS = 5 * 60;
const REDACTED = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE_PATTERN = /^[A-Za-z0-9._:-]{16,200}$/;
const MONEY_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/i;

const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|set-cookie|password|passwd|secret|token|recovery[_-]?code|api[_-]?key|service[_-]?role|refresh[_-]?token|access[_-]?token|claim|signature|(?:^|[_-])sign(?:ature)?$|raw[_-]?body|card|inventory|delivery|content|private[_-]?key|merchant[_-]?secret|webhook[_-]?secret)/i;
const SENSITIVE_VALUE_PATTERN = /(?:bearer\s+[a-z0-9._~+\/-]+=*|eyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|sk-[a-z0-9_-]{12,}|sb_(?:secret|publishable)_[a-z0-9_-]+|gAAAA[a-z0-9_=-]{20,})/i;

class GuestShopSecurityError extends Error {
    constructor(message, {
        statusCode = 400,
        code = 'guest_shop_invalid_request',
        field = '',
        expose = true,
        cause
    } = {}) {
        super(String(message || 'Invalid guest shop request'));
        this.name = 'GuestShopSecurityError';
        this.statusCode = Number.isInteger(statusCode) ? statusCode : 400;
        this.code = String(code || 'guest_shop_invalid_request');
        this.field = field ? String(field) : '';
        this.expose = expose !== false;
        if (cause !== undefined) this.cause = cause;
    }
}

function fail(message, options = {}) {
    throw new GuestShopSecurityError(message, options);
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function normalizeBoundedString(value, field = 'value', maxLength = 200, options = {}) {
    const {
        minLength = 0,
        allowEmpty = false,
        pattern,
        ascii = false,
        trim = true,
        lowercase = false
    } = options || {};

    if (typeof value !== 'string') {
        fail(`${field} 格式不正确`, { field, code: 'invalid_string' });
    }

    const normalized = (trim ? value.trim() : value);
    const length = [...normalized].length;
    const safeMax = Math.max(0, Number(maxLength) || 0);
    const safeMin = Math.max(0, Number(minLength) || 0);

    if (!normalized) {
        if (allowEmpty) return '';
        fail(`${field} 不能为空`, { field, code: 'required_field' });
    }
    if (length < safeMin || length > safeMax) {
        fail(`${field} 长度不符合要求`, { field, code: 'invalid_length' });
    }
    if (/^[\u0000-\u001f\u007f]/.test(normalized) || /[\u0000-\u001f\u007f]/.test(normalized)) {
        fail(`${field} 包含非法字符`, { field, code: 'invalid_characters' });
    }
    if (ascii && /[^\x20-\x7e]/.test(normalized)) {
        fail(`${field} 必须使用 ASCII 字符`, { field, code: 'invalid_characters' });
    }
    if (pattern && !(pattern instanceof RegExp ? pattern.test(normalized) : new RegExp(pattern).test(normalized))) {
        fail(`${field} 格式不正确`, { field, code: 'invalid_format' });
    }

    return lowercase ? normalized.toLowerCase() : normalized;
}

function normalizeUuid(value, field = 'id') {
    if (typeof value !== 'string') {
        fail(`${field} 必须是有效 UUID`, { field, code: 'invalid_uuid' });
    }
    const normalized = value.trim().toLowerCase();
    if (!UUID_PATTERN.test(normalized)) {
        fail(`${field} 必须是有效 UUID`, { field, code: 'invalid_uuid' });
    }
    return normalized;
}

function normalizeGuestSite(value, options = {}) {
    const {
        allowEmpty = false,
        fieldName = 'site'
    } = options || {};
    if (value === undefined || value === null || value === '') {
        if (allowEmpty) return '';
        fail(`${fieldName} 不能为空`, { field: fieldName, code: 'required_site' });
    }

    const normalized = normalizeBoundedString(value, fieldName, 10, {
        minLength: 2,
        ascii: true,
        lowercase: true
    });
    if (!SUPPORTED_SITES.includes(normalized)) {
        fail(`${fieldName} 不支持`, {
            field: fieldName,
            code: 'unsupported_site'
        });
    }
    return normalized;
}

function currencyForSite(site) {
    const normalized = normalizeGuestSite(site);
    return SITE_CURRENCIES[normalized];
}

function normalizeGuestIdempotencyKey(value, field = 'idempotencyKey') {
    const normalized = normalizeBoundedString(value, field, 200, {
        minLength: 16,
        ascii: true,
        pattern: IDEMPOTENCY_KEY_PATTERN
    });
    return normalized;
}

function readAliasedValue(body, primary, aliases, field) {
    const keys = [primary, ...(aliases || [])];
    const present = keys.filter((key) => Object.prototype.hasOwnProperty.call(body, key));
    if (!present.length) return undefined;
    const first = body[present[0]];
    for (const key of present.slice(1)) {
        if (body[key] !== first) {
            fail(`${field} 参数重复且不一致`, { field, code: 'conflicting_field_alias' });
        }
    }
    return first;
}

function normalizeGuestOrderInput(body, options = {}) {
    const {
        site,
        requireSite = true,
        allowClientSite = true,
        quantityMax = 1,
        requireIdempotencyKey = true,
        allowOptionalContact = false
    } = options || {};

    if (!isPlainObject(body)) {
        fail('请求体必须是 JSON 对象', { code: 'invalid_json_object' });
    }

    // These values are always selected from the server-side product/order
    // snapshot.  Rejecting them makes accidental handler pass-through fail
    // closed instead of silently trusting a client amount or inventory id.
    const forbiddenFields = [
        'amount', 'unitAmount', 'totalAmount', 'price', 'currency',
        'inventoryId', 'inventory_id', 'provider', 'providerOrderNo',
        'merchantOrderNo', 'returnUrl', 'return_url', 'metadata',
        'claimSecret', 'claim_secret', 'paymentStatus', 'status'
    ];
    for (const field of forbiddenFields) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
            fail(`${field} 不允许由客户端提供`, {
                field,
                code: 'client_controlled_field'
            });
        }
    }

    const productId = normalizeUuid(
        readAliasedValue(body, 'productId', ['product_id'], 'productId'),
        'productId'
    );
    const skuId = normalizeUuid(
        readAliasedValue(body, 'skuId', ['sku_id'], 'skuId'),
        'skuId'
    );

    const rawQuantity = readAliasedValue(body, 'quantity', [], 'quantity');
    const quantity = rawQuantity === undefined ? 1 : rawQuantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > Math.max(1, Number(quantityMax) || 1)) {
        fail('quantity 必须是允许范围内的整数', {
            field: 'quantity',
            code: 'invalid_quantity'
        });
    }

    const requestedSite = readAliasedValue(body, 'site', [], 'site');
    let normalizedSite = '';
    if (requestedSite !== undefined) {
        if (!allowClientSite) {
            fail('site 不允许由客户端提供', { field: 'site', code: 'client_controlled_field' });
        }
        normalizedSite = normalizeGuestSite(requestedSite);
    }
    if (site !== undefined && site !== null && site !== '') {
        const serverSite = normalizeGuestSite(site, { fieldName: 'serverSite' });
        if (normalizedSite && normalizedSite !== serverSite) {
            fail('site 与当前站点不匹配', { field: 'site', code: 'site_mismatch' });
        }
        normalizedSite = serverSite;
    }
    if (requireSite && !normalizedSite) {
        fail('site 不能为空', { field: 'site', code: 'required_site' });
    }

    const rawIdempotencyKey = readAliasedValue(
        body,
        'idempotencyKey',
        ['idempotency_key'],
        'idempotencyKey'
    );
    const idempotencyKey = rawIdempotencyKey === undefined && !requireIdempotencyKey
        ? ''
        : normalizeGuestIdempotencyKey(rawIdempotencyKey);

    const result = {
        productId,
        skuId,
        quantity,
        site: normalizedSite,
        currency: normalizedSite ? currencyForSite(normalizedSite) : '',
        idempotencyKey
    };

    if (allowOptionalContact && body.email !== undefined) {
        result.email = normalizeBoundedString(body.email, 'email', 320, {
            minLength: 3,
            ascii: true,
            pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        }).toLowerCase();
    }

    return Object.freeze(result);
}

function getHeader(req, name) {
    const headers = req?.headers;
    if (!headers || typeof headers !== 'object') return '';
    const wanted = String(name).toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (String(key).toLowerCase() === wanted) {
            return Array.isArray(value) ? String(value[0] || '') : String(value || '');
        }
    }
    return '';
}

function ensureUtf8(buffer, field = 'body') {
    try {
        if (typeof TextDecoder === 'function') {
            return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        }
        return buffer.toString('utf8');
    } catch (error) {
        fail(`${field} 不是有效 UTF-8`, {
            field,
            code: 'invalid_utf8',
            cause: error
        });
    }
}

function normalizeBodyChunk(chunk) {
    if (Buffer.isBuffer(chunk)) return chunk;
    if (chunk instanceof Uint8Array) return Buffer.from(chunk);
    if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
    fail('请求体包含无法读取的数据', { code: 'invalid_body_chunk' });
}

function invalidBodyLimitError() {
    return new GuestShopSecurityError('请求体限制配置无效', {
        statusCode: 500,
        code: 'guest_body_limit_invalid',
        field: 'maxBytes',
        expose: false
    });
}

/**
 * Parse a route body limit without JavaScript's permissive Number coercion.
 * Missing/undefined values use the caller's conservative default; an
 * explicitly supplied malformed, fractional, non-positive, or over-sized
 * value is a configuration error and fails closed.
 */
function parseBodyLimit(value, fallback) {
    const defaultValue = fallback === undefined ? DEFAULT_WEBHOOK_BODY_LIMIT : fallback;
    const parse = (candidate) => {
        if (typeof candidate === 'number') {
            if (!Number.isSafeInteger(candidate)) throw invalidBodyLimitError();
            return candidate;
        }
        if (typeof candidate === 'string' && /^\d+$/u.test(candidate.trim())) {
            const parsed = Number(candidate.trim());
            if (Number.isSafeInteger(parsed)) return parsed;
        }
        throw invalidBodyLimitError();
    };

    // `undefined` is the only omitted-value form.  Null, empty strings and
    // booleans are explicit operator mistakes and must not silently default.
    const parsed = value === undefined ? parse(defaultValue) : parse(value);
    if (parsed < 1 || parsed > MAX_BODY_LIMIT_BYTES) throw invalidBodyLimitError();
    return parsed;
}

async function readRawBodyWithLimit(req, options = {}) {
    const maxBytes = parseBodyLimit(options?.maxBytes, DEFAULT_WEBHOOK_BODY_LIMIT);
    const contentLength = Number.parseInt(getHeader(req, 'content-length'), 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        fail('请求体过大', {
            statusCode: 413,
            code: 'payload_too_large'
        });
    }

    const existingBody = req?.body;
    if (existingBody !== undefined && existingBody !== null) {
        let buffer;
        if (Buffer.isBuffer(existingBody) || existingBody instanceof Uint8Array) {
            buffer = normalizeBodyChunk(existingBody);
        } else if (typeof existingBody === 'string') {
            buffer = Buffer.from(existingBody, 'utf8');
        } else {
            // Frameworks such as Vercel may pre-parse JSON.  This path is
            // suitable for ordinary JSON endpoints, but not for signatures
            // that require the original wire bytes.
            try {
                buffer = Buffer.from(JSON.stringify(existingBody), 'utf8');
            } catch (error) {
                fail('请求体无法序列化', { code: 'invalid_body', cause: error });
            }
        }
        if (buffer.length > maxBytes) {
            fail('请求体过大', { statusCode: 413, code: 'payload_too_large' });
        }
        return buffer;
    }

    if (!req || typeof req[Symbol.asyncIterator] !== 'function') {
        return Buffer.alloc(0);
    }

    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buffer = normalizeBodyChunk(chunk);
        total += buffer.length;
        if (total > maxBytes) {
            // Stop consuming as soon as the limit is crossed.  Destroying a
            // framework-owned request can mask the intended 413, so leave
            // lifecycle handling to the caller.
            fail('请求体过大', { statusCode: 413, code: 'payload_too_large' });
        }
        chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
}

async function readJsonBodyWithLimit(req, options = {}) {
    const {
        maxBytes = DEFAULT_JSON_BODY_LIMIT,
        allowEmpty = false,
        requireContentType = false,
        returnRaw = false,
        rejectArrays = true
    } = options || {};

    if (requireContentType) {
        const contentType = getHeader(req, 'content-type').split(';', 1)[0].trim().toLowerCase();
        if (!/^application\/(?:json|[^;]+\+json)$/.test(contentType)) {
            fail('Content-Type 必须是 JSON', {
                statusCode: 415,
                code: 'invalid_content_type'
            });
        }
    }

    const rawBody = await readRawBodyWithLimit(req, { maxBytes });
    if (!rawBody.length) {
        if (allowEmpty) {
            const emptyResult = {};
            return returnRaw ? { body: emptyResult, rawBody } : emptyResult;
        }
        fail('请求体不能为空', { code: 'empty_body' });
    }

    const text = ensureUtf8(rawBody);
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        fail('请求体不是有效 JSON', { code: 'invalid_json', cause: error });
    }

    if ((rejectArrays && Array.isArray(parsed)) || !isPlainObject(parsed)) {
        fail('请求体必须是 JSON 对象', { code: 'invalid_json_object' });
    }
    return returnRaw ? { body: parsed, rawBody } : parsed;
}

function normalizeCurrency(currency, field = 'currency') {
    const normalized = normalizeBoundedString(currency, field, 3, {
        minLength: 3,
        ascii: true,
        lowercase: true
    }).toUpperCase();
    if (!['CNY', 'USD'].includes(normalized)) {
        fail(`${field} 不支持`, { field, code: 'unsupported_currency' });
    }
    return normalized;
}

function parseMoneyMinor(value, options = {}) {
    const {
        currency,
        field = 'amount',
        allowZero = false,
        maxMinor = Number.MAX_SAFE_INTEGER
    } = options || {};

    if (currency !== undefined && currency !== null && currency !== '') {
        normalizeCurrency(currency, 'currency');
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
        fail(`${field} 金额格式不正确`, { field, code: 'invalid_amount' });
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
        fail(`${field} 金额格式不正确`, { field, code: 'invalid_amount' });
    }
    const text = String(value).trim();
    if (!text || /[eE]/.test(text) || !MONEY_PATTERN.test(text)) {
        fail(`${field} 金额格式不正确`, { field, code: 'invalid_amount' });
    }
    const match = text.match(MONEY_PATTERN);
    const whole = match ? text.split('.', 1)[0] : '';
    const fraction = match?.[1] || '';
    let minor;
    try {
        const wholeBig = BigInt(whole);
        const fractionBig = BigInt((fraction + '00').slice(0, 2) || '0');
        const minorBig = wholeBig * 100n + fractionBig;
        if (minorBig > BigInt(Number.MAX_SAFE_INTEGER) || minorBig > BigInt(Math.max(0, Number(maxMinor) || Number.MAX_SAFE_INTEGER))) {
            fail(`${field} 金额超出范围`, { field, code: 'amount_out_of_range' });
        }
        minor = Number(minorBig);
    } catch (error) {
        if (error instanceof GuestShopSecurityError) throw error;
        fail(`${field} 金额格式不正确`, { field, code: 'invalid_amount', cause: error });
    }
    if (!allowZero && minor <= 0) {
        fail(`${field} 金额必须大于 0`, { field, code: 'invalid_amount' });
    }
    if (allowZero && minor < 0) {
        fail(`${field} 金额不能为负数`, { field, code: 'invalid_amount' });
    }
    return minor;
}

function formatMoneyMinor(minor, currency) {
    if (currency !== undefined && currency !== null && currency !== '') {
        normalizeCurrency(currency, 'currency');
    }
    if (!Number.isSafeInteger(minor) || minor < 0) {
        fail('金额分值格式不正确', { field: 'amount', code: 'invalid_amount' });
    }
    return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

function multiplyMoneyMinor(unitMinor, quantity) {
    if (!Number.isSafeInteger(unitMinor) || unitMinor < 0) {
        fail('单位金额格式不正确', { field: 'unitAmount', code: 'invalid_amount' });
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
        fail('quantity 必须是正整数', { field: 'quantity', code: 'invalid_quantity' });
    }
    const product = BigInt(unitMinor) * BigInt(quantity);
    if (product > BigInt(Number.MAX_SAFE_INTEGER)) {
        fail('总金额超出范围', { field: 'totalAmount', code: 'amount_out_of_range' });
    }
    return Number(product);
}

function moneyMinorEqual(expectedMinor, actualValue, options = {}) {
    if (!Number.isSafeInteger(expectedMinor) || expectedMinor < 0) return false;
    try {
        const actualMinor = options.actualIsMinor === true
            ? (Number.isSafeInteger(actualValue) && actualValue >= 0 ? actualValue : null)
            : parseMoneyMinor(actualValue, {
                currency: options.currency,
                field: options.field || 'paid_amount',
                allowZero: true
            });
        return actualMinor !== null && actualMinor === expectedMinor;
    } catch (_) {
        return false;
    }
}

function hashIdempotencyKey(key, options = {}) {
    const normalizedKey = normalizeGuestIdempotencyKey(key);
    const site = options.site ? normalizeGuestSite(options.site) : '';
    return crypto.createHash('sha256')
        .update(`guest-shop-idempotency\0${site}\0${normalizedKey}`, 'utf8')
        .digest('hex');
}

function buildGuestRequestFingerprint(input = {}) {
    const site = normalizeGuestSite(input.site);
    const currency = normalizeCurrency(input.currency || currencyForSite(site));
    if (currency !== currencyForSite(site)) {
        fail('site 与 currency 不匹配', { code: 'site_currency_mismatch' });
    }
    const productId = normalizeUuid(input.productId ?? input.product_id, 'productId');
    const skuId = normalizeUuid(input.skuId ?? input.sku_id, 'skuId');
    const quantity = input.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
        fail('quantity 必须是正整数', { field: 'quantity', code: 'invalid_quantity' });
    }
    const unitAmountMinor = Number.isSafeInteger(input.unitAmountMinor)
        ? input.unitAmountMinor
        : parseMoneyMinor(input.unitAmount ?? input.unit_amount, {
            currency,
            field: 'unitAmount'
        });
    if (unitAmountMinor <= 0) {
        fail('unitAmount 必须大于 0', { field: 'unitAmount', code: 'invalid_amount' });
    }
    const pricingVersion = normalizeBoundedString(
        String(input.pricingVersion ?? input.pricing_version ?? 'v1'),
        'pricingVersion',
        80,
        { minLength: 1, ascii: true, pattern: /^[A-Za-z0-9._:-]+$/ }
    );
    const normalizeBindingToken = (value, field) => {
        if (value === undefined || value === null || value === '') return '';
        return normalizeBoundedString(String(value), field, 200, {
            minLength: 1,
            ascii: true,
            lowercase: true,
            pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
        });
    };
    const canonical = {
        site,
        productId,
        skuId,
        quantity,
        currency,
        unitAmountMinor,
        pricingVersion,
        // Payment identity is part of the idempotency contract.  Reusing a
        // client key for another provider/channel must never be able to
        // replay or mutate the first payment intent.
        provider: normalizeBindingToken(input.provider, 'provider'),
        channel: normalizeBindingToken(input.channel, 'channel')
    };
    return crypto.createHash('sha256')
        .update(JSON.stringify(canonical), 'utf8')
        .digest('hex');
}

function isIdempotencyConflict(existingFingerprint, incomingFingerprint) {
    const left = String(existingFingerprint || '').trim().toLowerCase();
    const right = String(incomingFingerprint || '').trim().toLowerCase();
    return Boolean(left && right && left !== right);
}

function assertIdempotencyFingerprint(existingFingerprint, incomingFingerprint) {
    if (isIdempotencyConflict(existingFingerprint, incomingFingerprint)) {
        fail('幂等键已绑定其他购买请求', {
            statusCode: 409,
            code: 'idempotency_conflict'
        });
    }
    return true;
}

function getGuestClaimPepper(env = process.env, options = {}) {
    const names = options.names || [
        'GUEST_SHOP_CLAIM_PEPPER',
        'GUEST_CLAIM_PEPPER',
        'SHOP_GUEST_CLAIM_PEPPER'
    ];
    let value = '';
    for (const name of names) {
        const candidate = String(env?.[name] || '').trim();
        if (candidate) {
            value = candidate;
            break;
        }
    }
    const required = options.required !== false;
    if (!value) {
        if (!required) return '';
        fail('游客取货凭证密钥未配置', {
            statusCode: 503,
            code: 'guest_claim_secret_unavailable',
            expose: false
        });
    }
    const serviceRole = String(env?.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (serviceRole && value === serviceRole) {
        fail('游客取货凭证密钥不能复用服务角色密钥', {
            statusCode: 503,
            code: 'guest_claim_secret_invalid',
            expose: false
        });
    }
    if (Buffer.byteLength(value, 'utf8') < 32) {
        fail('游客取货凭证密钥强度不足', {
            statusCode: 503,
            code: 'guest_claim_secret_invalid',
            expose: false
        });
    }
    return value;
}

function normalizeClaimSecret(secret) {
    if (typeof secret !== 'string') return '';
    const normalized = secret.trim();
    if (!/^[A-Za-z0-9_-]{40,200}$/.test(normalized)) return '';
    return normalized;
}

function generateClaimSecret(options = {}) {
    const bytes = Math.max(32, Math.min(128, Number(options.bytes) || DEFAULT_CLAIM_SECRET_BYTES));
    return crypto.randomBytes(bytes).toString('base64url');
}

// Derive the claim credential from the client-generated idempotency key so a
// lost response can be retried without changing the stored credential. The
// dedicated pepper is intentionally separate from service-role credentials.
function deriveClaimSecretFromIdempotencyKey(idempotencyKey, options = {}) {
    const normalizedKey = normalizeGuestIdempotencyKey(idempotencyKey);
    const site = normalizeGuestSite(options.site);
    const pepper = getGuestClaimPepper(options.env || process.env, {
        names: ['GUEST_SHOP_CLAIM_DERIVATION_PEPPER'],
        required: true
    });
    return crypto.createHmac('sha256', Buffer.from(pepper, 'utf8'))
        .update(`guest-shop-claim-v1\0${site}\0${normalizedKey}`, 'utf8')
        .digest('base64url');
}

function hashClaimSecret(secret, options = {}) {
    const normalizedSecret = normalizeClaimSecret(secret);
    if (!normalizedSecret) {
        fail('取货凭证格式不正确', { code: 'invalid_claim_secret' });
    }
    const pepper = options.pepper || getGuestClaimPepper(options.env || process.env, options);
    if (!pepper) {
        fail('游客取货凭证密钥未配置', {
            statusCode: 503,
            code: 'guest_claim_secret_unavailable',
            expose: false
        });
    }
    const version = String(options.version || '1').trim();
    if (!/^[1-9][0-9]{0,5}$/.test(version)) {
        fail('取货凭证哈希版本不支持', { code: 'invalid_claim_secret_version' });
    }
    const digest = crypto.createHmac('sha256', Buffer.from(String(pepper), 'utf8'))
        .update(normalizedSecret, 'utf8')
        .digest('hex');
    return `hmac-sha256:v${version}:${digest}`;
}

function constantTimeEqual(left, right, options = {}) {
    const encoding = options.encoding || 'utf8';
    let leftBuffer;
    let rightBuffer;
    try {
        leftBuffer = Buffer.isBuffer(left) ? left : Buffer.from(String(left ?? ''), encoding);
        rightBuffer = Buffer.isBuffer(right) ? right : Buffer.from(String(right ?? ''), encoding);
    } catch (_) {
        return false;
    }
    if (!leftBuffer.length || !rightBuffer.length || leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyClaimSecret(secret, storedHash, options = {}) {
    const normalizedSecret = normalizeClaimSecret(secret);
    if (!normalizedSecret || typeof storedHash !== 'string') return false;
    const match = storedHash.trim().match(/^hmac-sha256:v([1-9][0-9]{0,5}):([0-9a-f]{64})$/i);
    if (!match) return false;
    try {
        const calculated = hashClaimSecret(normalizedSecret, {
            ...options,
            version: match[1]
        });
        return constantTimeEqual(calculated.toLowerCase(), storedHash.trim().toLowerCase());
    } catch (error) {
        if (options.throwOnMissingPepper) throw error;
        return false;
    }
}

function hashRawBody(rawBody) {
    let buffer;
    if (Buffer.isBuffer(rawBody)) buffer = rawBody;
    else if (rawBody instanceof Uint8Array) buffer = Buffer.from(rawBody);
    else if (typeof rawBody === 'string') buffer = Buffer.from(rawBody, 'utf8');
    else fail('回调原始请求体格式不正确', { code: 'invalid_raw_body' });
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeTimestampSeconds(timestamp) {
    if (typeof timestamp === 'number') {
        if (!Number.isSafeInteger(timestamp)) return null;
        return timestamp > 100000000000 ? null : timestamp;
    }
    if (typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp.trim())) return null;
    const parsed = Number(timestamp.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildHmacSigningPayload({ version = 'v1', timestamp, nonce, rawBody } = {}) {
    const normalizedVersion = normalizeBoundedString(String(version), 'version', 20, {
        minLength: 1,
        ascii: true,
        pattern: /^[A-Za-z0-9._:-]+$/
    });
    const normalizedTimestamp = normalizeTimestampSeconds(timestamp);
    if (normalizedTimestamp === null) {
        fail('回调时间戳格式不正确', { field: 'timestamp', code: 'invalid_timestamp' });
    }
    const normalizedNonce = normalizeBoundedString(nonce, 'nonce', 200, {
        minLength: 16,
        ascii: true,
        pattern: NONCE_PATTERN
    });
    const bodyHash = hashRawBody(rawBody);
    return `${normalizedVersion}.${normalizedTimestamp}.${normalizedNonce}.${bodyHash}`;
}

function buildHmacSignature({ secret, version = 'v1', timestamp, nonce, rawBody } = {}) {
    const normalizedSecret = typeof secret === 'string' || Buffer.isBuffer(secret)
        ? secret
        : '';
    if (!normalizedSecret || (typeof normalizedSecret === 'string' && !normalizedSecret.trim())) {
        fail('回调签名密钥未配置', {
            statusCode: 503,
            code: 'webhook_secret_unavailable',
            expose: false
        });
    }
    const payload = buildHmacSigningPayload({ version, timestamp, nonce, rawBody });
    return crypto.createHmac('sha256', normalizedSecret).update(payload, 'utf8').digest('hex');
}

function verifyHmacEnvelope({
    secret,
    version = 'v1',
    timestamp,
    nonce,
    signature,
    rawBody,
    now = Date.now(),
    maxSkewSeconds = DEFAULT_HMAC_SKEW_SECONDS
} = {}) {
    const failResult = (code) => ({
        valid: false,
        code,
        bodySha256: (() => {
            try { return hashRawBody(rawBody); } catch (_) { return ''; }
        })()
    });
    if (!secret) return failResult('missing_secret');
    if (typeof version !== 'string' || !/^v[0-9]+$/.test(version)) return failResult('invalid_version');
    const timestampSeconds = normalizeTimestampSeconds(timestamp);
    if (timestampSeconds === null) return failResult('invalid_timestamp');
    const nowNumber = Number(now);
    const nowSeconds = Number.isFinite(nowNumber)
        ? (nowNumber > 100000000000 ? Math.floor(nowNumber / 1000) : Math.floor(nowNumber))
        : Math.floor(Date.now() / 1000);
    const skew = Math.max(1, Math.min(86400, Number(maxSkewSeconds) || DEFAULT_HMAC_SKEW_SECONDS));
    if (Math.abs(nowSeconds - timestampSeconds) > skew) return failResult('timestamp_out_of_range');
    if (typeof nonce !== 'string' || !NONCE_PATTERN.test(nonce)) return failResult('invalid_nonce');
    if (typeof signature !== 'string') return failResult('invalid_signature');
    const receivedSignature = signature.trim().replace(/^sha256=/i, '').toLowerCase();
    if (!HEX_64_PATTERN.test(receivedSignature)) return failResult('invalid_signature');
    let expected;
    try {
        expected = buildHmacSignature({ secret, version, timestamp: timestampSeconds, nonce, rawBody });
    } catch (_) {
        return failResult('invalid_envelope');
    }
    const valid = constantTimeEqual(expected, receivedSignature);
    return {
        valid,
        code: valid ? 'ok' : 'signature_mismatch',
        version,
        timestamp: timestampSeconds,
        nonce,
        bodySha256: hashRawBody(rawBody)
    };
}

function verifyPaymentBinding({
    expectedMerchantOrderNo,
    expectedProvider,
    expectedPurpose = 'shop_direct',
    expectedSite,
    expectedCurrency,
    expectedAmountMinor,
    received = {}
} = {}) {
    const checks = {};
    const normalizeComparable = (value) => String(value ?? '').trim();
    checks.merchantOrderNo = Boolean(expectedMerchantOrderNo)
        && normalizeComparable(received.merchantOrderNo ?? received.merchant_order_no) === normalizeComparable(expectedMerchantOrderNo);
    checks.provider = Boolean(expectedProvider)
        && normalizeComparable(received.provider) === normalizeComparable(expectedProvider);
    checks.purpose = normalizeComparable(received.purpose || received.paymentPurpose || received.payment_purpose) === normalizeComparable(expectedPurpose);
    checks.site = normalizeComparable(received.site) === normalizeComparable(expectedSite);
    checks.currency = normalizeComparable(received.currency).toUpperCase() === normalizeComparable(expectedCurrency).toUpperCase();
    checks.amount = moneyMinorEqual(expectedAmountMinor, received.paidAmount ?? received.paid_amount ?? received.amount, {
        currency: expectedCurrency,
        field: 'paid_amount'
    });
    const finalState = normalizeComparable(received.finalStatus ?? received.final_status ?? received.status).toLowerCase();
    checks.finalStatus = ['paid', 'confirmed', 'finished', 'success', 'succeeded'].includes(finalState);
    const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
    return { valid: failures.length === 0, checks, failures };
}

function redactEmail(value) {
    const text = String(value || '').trim();
    const at = text.indexOf('@');
    if (at <= 0) return REDACTED;
    const local = text.slice(0, at);
    const domain = text.slice(at + 1);
    return `${local.slice(0, 1)}***@${domain.slice(0, 1)}***`;
}

function redactGuestPaymentPayload(value, options = {}) {
    const maxDepth = Math.max(0, Math.min(10, Number(options.maxDepth) || 5));
    const maxArrayItems = Math.max(0, Math.min(100, Number(options.maxArrayItems) || 20));
    const maxObjectKeys = Math.max(1, Math.min(200, Number(options.maxObjectKeys) || 80));
    const maxStringLength = Math.max(32, Math.min(10000, Number(options.maxStringLength) || 1000));
    const seen = new WeakSet();

    function visit(input, depth, key = '') {
        const keyText = String(key || '');
        if (SENSITIVE_KEY_PATTERN.test(keyText)) return REDACTED;
        if (input === null || input === undefined) return input;
        if (typeof input === 'string') {
            if (/email/i.test(keyText)) return redactEmail(input);
            if (SENSITIVE_VALUE_PATTERN.test(input)) return REDACTED;
            return input.slice(0, maxStringLength);
        }
        if (typeof input === 'number' || typeof input === 'boolean') return input;
        if (typeof input === 'bigint') return String(input);
        if (typeof input === 'function' || typeof input === 'symbol') return REDACTED;
        if (Buffer.isBuffer(input) || input instanceof Uint8Array) return REDACTED;
        if (input instanceof Error) {
            return {
                name: visit(input.name, depth + 1, 'name'),
                message: visit(input.message, depth + 1, 'message'),
                stack: visit(input.stack, depth + 1, 'stack')
            };
        }
        if (depth >= maxDepth) return TRUNCATED;
        if (seen.has(input)) return TRUNCATED;
        seen.add(input);
        if (Array.isArray(input)) {
            return input.slice(0, maxArrayItems).map((item) => visit(item, depth + 1, keyText));
        }
        if (typeof input === 'object') {
            const result = {};
            for (const [entryKey, entryValue] of Object.entries(input).slice(0, maxObjectKeys)) {
                const safeKey = String(entryKey).slice(0, 120);
                result[safeKey] = visit(entryValue, depth + 1, safeKey);
            }
            return result;
        }
        return REDACTED;
    }

    return visit(value, 0);
}

function sanitizeGuestLogContext(value, options = {}) {
    return redactGuestPaymentPayload(value, {
        maxDepth: 4,
        maxArrayItems: 12,
        maxObjectKeys: 60,
        maxStringLength: 600,
        ...options
    });
}

module.exports = {
    DEFAULT_JSON_BODY_LIMIT,
    DEFAULT_WEBHOOK_BODY_LIMIT,
    MAX_BODY_LIMIT_BYTES,
    GuestShopSecurityError,
    SUPPORTED_SITES,
    SITE_CURRENCIES,
    assertIdempotencyFingerprint,
    buildGuestRequestFingerprint,
    buildHmacSignature,
    buildHmacSigningPayload,
    constantTimeEqual,
    currencyForSite,
    formatMoneyMinor,
    generateClaimSecret,
    deriveClaimSecretFromIdempotencyKey,
    getGuestClaimPepper,
    hashClaimSecret,
    hashIdempotencyKey,
    hashRawBody,
    isIdempotencyConflict,
    isPlainObject,
    moneyMinorEqual,
    multiplyMoneyMinor,
    normalizeBoundedString,
    normalizeGuestIdempotencyKey,
    normalizeGuestOrderInput,
    normalizeGuestSite,
    normalizeUuid,
    parseMoneyMinor,
    readJsonBodyWithLimit,
    readRawBodyWithLimit,
    parseBodyLimit,
    redactGuestPaymentPayload,
    sanitizeGuestLogContext,
    verifyClaimSecret,
    verifyHmacEnvelope,
    verifyPaymentBinding,
    _private: {
        IDEMPOTENCY_KEY_PATTERN,
        MONEY_PATTERN,
        NONCE_PATTERN,
        SENSITIVE_KEY_PATTERN,
        getHeader,
        invalidBodyLimitError,
        normalizeBodyChunk,
        normalizeCurrency,
        normalizeTimestampSeconds
    }
};
