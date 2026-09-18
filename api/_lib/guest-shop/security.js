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

const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|set-cookie|password|passwd|secret|token|recovery[_-]?code|api[_-]?key|service[_-]?role|refresh[_-]?token|access[_-]?token|claim|credential|query[_-]?password|signature|(?:^|[_-])sign(?:ature)?$|raw[_-]?body|card|inventory|delivery|content|private[_-]?key|merchant[_-]?secret|webhook[_-]?secret)/i;
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

// ---------------------------------------------------------------------------
// Order Access 2.0 (A1): guest query-password primitives.
//
// Contract: docs/guest-shop-order-access-2.0.md §6 (policy + hashing),
// §6.1.2 (frozen normalization), §7.1 (transport header), §8.4 (timing
// equivalence).  Everything below is a pure function of its arguments: no
// Supabase, no HTTP, and no env reads except through the explicit `env`
// parameter.  That is deliberate — the credential path is the one place where
// a hidden dependency silently turns into a fail-open.
//
// Two rules are load-bearing and must never be "cleaned up":
//
//   1. normalizeGuestQueryPassword() is FROZEN and stamped into every stored
//      hash as `norm=v1`.  Set-password and verify-password must call this
//      exact function forever.  Editing it invalidates every stored hash,
//      i.e. every guest order becomes permanently unreachable.  If a change is
//      ever unavoidable it must ship as a NEW norm version with a transparent
//      rehash-on-successful-login path, never as an edit to v1.
//   2. The scrypt cost parameters are frozen constants, not env knobs.  An
//      operator typo that lowers N would silently turn every query password
//      into an offline-crackable hash and nothing at runtime would notice.
//      scripts/guest-shop-readiness.js asserts both the values and the floor.
//
// There is deliberately NO pepper on the password hash (§6.3): the per-row
// random salt already defeats rainbow tables, and a lost pepper would make
// every guest order permanently inaccessible.  The contact-hash pepper is a
// separate concern (it keys the credential group) and IS mandatory.
// ---------------------------------------------------------------------------

const GUEST_QUERY_PASSWORD_NORM_VERSION = 'v1';
const GUEST_QUERY_PASSWORD_MIN_LENGTH = 8;          // P1 (K26/K27)
const GUEST_QUERY_PASSWORD_MAX_LENGTH = 64;         // P3
const GUEST_QUERY_PASSWORD_MIN_DISTINCT = 5;        // P10
const GUEST_QUERY_PASSWORD_MAX_REPEAT_RUN = 3;      // P9: a run of 4+ is rejected
const GENERATED_QUERY_PASSWORD_LENGTH = 12;         // §6.1.3 "帮我生成"
const GUEST_EMAIL_MAX_LENGTH = 320;
const GUEST_CREDENTIAL_MAX_PASSWORD_LENGTH = 128;   // §7.1 transport bound
const GUEST_CREDENTIAL_HEADER_MAX_LENGTH = 1024;
const GUEST_ORDER_CREDENTIAL_HEADER = 'x-guest-order-credential';
const GUEST_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// P4/P5: printable ASCII, no space.  Punctuation is exactly the complement of
// [A-Za-z0-9] inside this range (32 characters), so no separate whitelist can
// drift out of sync with the charset rule.
const GUEST_QUERY_PASSWORD_CHARSET = /^[\x21-\x7e]+$/;
const GUEST_QUERY_PASSWORD_CONTROL_CHARS = /[\x00-\x20\x7f]/;

const BUYER_SCRYPT_PARAMS = Object.freeze({
    N: 32768,
    r: 8,
    p: 1,
    keylen: 32,
    saltBytes: 32
});
// Policy floor.  A stored row below this verifies but is flagged for a
// transparent rehash on successful login (§6.2 parameter upgrade path).
const BUYER_SCRYPT_MIN_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 32 });
// 128 * N * r is scrypt's memory cost.  For the frozen parameters that is
// exactly 32 MiB, which is Node's default maxmem, so the derivation would
// fail without explicit head-room.
const BUYER_SCRYPT_MAXMEM = 128 * BUYER_SCRYPT_PARAMS.N * BUYER_SCRYPT_PARAMS.r * 2;
// Hard ceiling for parameters read back out of a stored hash.  A corrupt or
// hostilely edited row must never be able to make the query path allocate
// unbounded memory or spin an unbounded number of rounds.
const BUYER_SCRYPT_PARSE_MAX = Object.freeze({ N: 1048576, r: 256, p: 16, keylen: 128 });
const BUYER_SCRYPT_MAX_MEMORY_BYTES = 128 * 1024 * 1024;

// Stricter than the DB CHECK in
// supabase/migrations/20260920_guest_shop_buyer_credentials.sql so that a row
// the database would accept can still be refused here.  Standard base64
// (with +/=) is required, NOT base64url: the CHECK constrains the alphabet to
// [A-Za-z0-9+/=] and a base64url hash would be rejected by the database.
const GUEST_QUERY_PASSWORD_HASH_PATTERN =
    /^scrypt\$([0-9]{1,9})\$([0-9]{1,4})\$([0-9]{1,4})\$norm=(v[0-9]{1,4})\$([A-Za-z0-9+/=]{4,128})\$([A-Za-z0-9+/=]{16,256})$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * §6.1.2 step 2.  Fullwidth ASCII variants (U+FF01..U+FF5E) fold to their
 * halfwidth equivalents (0x21..0x7E) by subtracting 0xFEE0.  This is a hard
 * requirement for Chinese mobile input methods, which happily emit ！＠＃; without
 * the fold a user who "obviously typed punctuation" is told they did not.
 */
function foldFullwidthAscii(value) {
    let out = '';
    for (const chunk of value) {
        const codePoint = chunk.codePointAt(0);
        out += (codePoint >= 0xff01 && codePoint <= 0xff5e)
            ? String.fromCharCode(codePoint - 0xfee0)
            : chunk;
    }
    return out;
}

/**
 * §6.1.2 frozen normalization (norm=v1).  NEVER trims and NEVER case-folds the
 * password — only the email is lower(trim(...)).  Returns a result object
 * instead of throwing so that the query path can turn a policy failure into
 * the single unified 403 of §9.1 without a try/catch per call.
 *
 * Minimum length is deliberately NOT checked here: it is an operator-tunable
 * policy knob (GUEST_SHOP_BUYER_PASSWORD_MIN_LENGTH), not part of the frozen
 * normalization contract.
 */
function normalizeGuestQueryPassword(value) {
    if (typeof value !== 'string') {
        return { ok: false, value: '', rule: 'P4', reason: 'invalid_type' };
    }
    // Bound the fold loop before touching a hostile multi-megabyte string.
    // readJsonBodyWithLimit already caps the request, but a direct caller
    // (admin tooling, tests) must not be able to make this expensive.
    if (value.length > GUEST_QUERY_PASSWORD_MAX_LENGTH * 4) {
        return { ok: false, value: '', rule: 'P3', reason: 'too_long' };
    }
    const folded = foldFullwidthAscii(value);
    if ([...folded].length > GUEST_QUERY_PASSWORD_MAX_LENGTH) {
        return { ok: false, value: folded, rule: 'P3', reason: 'too_long' };
    }
    if (!GUEST_QUERY_PASSWORD_CHARSET.test(folded)) {
        return { ok: false, value: folded, rule: 'P4', reason: 'invalid_characters' };
    }
    return { ok: true, value: folded, rule: '', reason: '' };
}

// ---------------------------------------------------------------------------
// P7a: literal weak-password denylist.  Static, never fetched over the
// network.  A curated core is expanded deterministically with exactly the
// leet/suffix transformations that let "Password1!"-class passwords satisfy
// the four-class rule P2 while remaining among the most common passwords on
// earth.  A static list can never keep up with variants — which is precisely
// why P7b below, not this list, is the primary defence.
// ---------------------------------------------------------------------------
const GUEST_QUERY_PASSWORD_DENYLIST_CORE = Object.freeze([
    'password', 'passwort', 'passwd', 'passw', 'pass', 'pwd',
    'qwerty', 'qwertyuiop', 'qwertz', 'azerty', 'qazwsx', 'qweasd', 'qweasdzxc',
    'asdf', 'asdfgh', 'asdfghjkl', 'zxcv', 'zxcvbn', 'zxcvbnm',
    'admin', 'administrator', 'root', 'superuser', 'sysadmin', 'webadmin', 'master',
    'letmein', 'welcome', 'hello', 'monkey', 'dragon', 'ninja', 'samurai',
    'sunshine', 'princess', 'starwars', 'superman', 'batman', 'spiderman', 'ironman',
    'pokemon', 'minecraft', 'roblox', 'fortnite',
    'football', 'baseball', 'basketball', 'soccer', 'hockey', 'tennis', 'cricket',
    'iloveyou', 'iloveu', 'loveyou', 'lover', 'baby', 'honey', 'sweetie', 'darling',
    'abc', 'abcd', 'abcdef', 'abcdefg', 'abcdefgh', 'aaa', 'aaaa', 'aaaaa', 'aaaaaa',
    'test', 'testing', 'tester', 'demo', 'sample', 'example',
    'guest', 'user', 'username', 'customer', 'client', 'member', 'login',
    'shop', 'store', 'order', 'orders', 'card', 'cards', 'key', 'keys', 'secret',
    'computer', 'internet', 'network', 'server', 'database', 'system', 'security', 'secure',
    'money', 'cash', 'dollar', 'bitcoin', 'ethereum', 'usdt', 'crypto', 'wallet',
    'google', 'facebook', 'twitter', 'instagram', 'tiktok', 'youtube',
    'wechat', 'weixin', 'alipay', 'taobao', 'amazon', 'github',
    'apple', 'samsung', 'huawei', 'xiaomi', 'tesla',
    'china', 'chinese', 'beijing', 'shanghai',
    'fatherkey', 'zaoyoe', 'verify', 'sub2api', 'newapi',
    'january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'spring', 'summer', 'autumn', 'winter'
]);

const GUEST_QUERY_PASSWORD_DENYLIST_SUFFIXES = Object.freeze([
    '', '1', '12', '123', '1234', '12345', '123456', '01', '007', '666', '888',
    '2020', '2021', '2022', '2023', '2024', '2025', '2026',
    '!', '!!', '!@#', '@', '#', '$', '%', '.', '..',
    '1!', '123!', '123@', '123#', '@123', '!123', '123.', '007!', '!@#$'
]);

const LEET_TO_PLAIN = Object.freeze({
    0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b',
    '@': 'a', $: 's', '!': 'i', '+': 't'
});
const PLAIN_TO_LEET = Object.freeze({
    o: '0', i: '1', e: '3', a: '4', s: '5', t: '7', b: '8'
});

function leetUnfold(value) {
    let out = '';
    for (const ch of value) out += LEET_TO_PLAIN[ch] ?? ch;
    return out;
}

function leetFold(value) {
    let out = '';
    for (const ch of value) out += PLAIN_TO_LEET[ch] ?? ch;
    return out;
}

function buildGuestQueryPasswordDenylist() {
    const set = new Set();
    for (const word of GUEST_QUERY_PASSWORD_DENYLIST_CORE) {
        const leet = leetFold(word);
        for (const suffix of GUEST_QUERY_PASSWORD_DENYLIST_SUFFIXES) {
            set.add(word + suffix);
            if (leet !== word) set.add(leet + suffix);
        }
    }
    return set;
}

const GUEST_QUERY_PASSWORD_DENYLIST = buildGuestQueryPasswordDenylist();

// P7b-①: common stems, matched as substrings after leet unfolding.  Kept
// deliberately short — every extra stem is a false-positive surface on
// legitimate passwords, and P7a/P7b-②/P7b-③ already cover the volume.
const GUEST_QUERY_PASSWORD_WEAK_STEMS = Object.freeze([
    'password', 'passwd', 'passw', 'admin', 'qwerty', 'asdf', 'zxcv',
    'letmein', 'welcome', 'abc', 'iloveyou'
]);

// P7b-②: keyboard rows are not monotonic in code-point order, so their
// windows have to be enumerated explicitly.  Alphabet and digit runs are
// handled by longestMonotonicRun() below.
const KEYBOARD_ROWS = Object.freeze(['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890']);
const KEYBOARD_SEQUENCE_MIN_LENGTH = 4;

function buildWeakSequenceSet() {
    const set = new Set();
    for (const row of KEYBOARD_ROWS) {
        for (let start = 0; start < row.length; start += 1) {
            for (let end = start + KEYBOARD_SEQUENCE_MIN_LENGTH; end <= row.length; end += 1) {
                const window = row.slice(start, end);
                set.add(window);
                set.add([...window].reverse().join(''));
            }
        }
    }
    return set;
}

const GUEST_QUERY_PASSWORD_WEAK_SEQUENCES = buildWeakSequenceSet();

// P7b-③: "word + digits + a single trailing punctuation" is the shape every
// password manager warning exists for.  Requiring the punctuation to be the
// LAST character and the digits to be the LAST block keeps this from firing on
// genuinely mixed passwords such as `Ab3!xY9#`.
const GUEST_QUERY_PASSWORD_WEAK_STRUCTURE = /^[A-Z][A-Za-z]*[0-9]+[^A-Za-z0-9]$/;

/**
 * Longest run of consecutive characters whose code points increase (or
 * decrease) by exactly one, restricted to [a-z0-9].  Catches `abcd`, `wxyz`,
 * `1234`, `9876` and the case-insensitive form `aAAa` is handled separately
 * by longestRepeatRun().
 */
function longestMonotonicRun(value) {
    let best = 1;
    let ascending = 1;
    let descending = 1;
    for (let index = 1; index < value.length; index += 1) {
        const prev = value.charCodeAt(index - 1);
        const current = value.charCodeAt(index);
        const comparable = /[a-z0-9]/.test(value[index - 1]) && /[a-z0-9]/.test(value[index]);
        ascending = comparable && current === prev + 1 ? ascending + 1 : 1;
        descending = comparable && current === prev - 1 ? descending + 1 : 1;
        if (ascending > best) best = ascending;
        if (descending > best) best = descending;
    }
    return best;
}

/**
 * P9.  Letters are compared case-insensitively (`aAAa` is a run of four `a`);
 * everything else is compared exactly.  A run longer than
 * GUEST_QUERY_PASSWORD_MAX_REPEAT_RUN is rejected.
 */
function longestRepeatRun(value) {
    let best = 1;
    let run = 1;
    const keyOf = (ch) => (/[A-Za-z]/.test(ch) ? ch.toLowerCase() : ch);
    for (let index = 1; index < value.length; index += 1) {
        run = keyOf(value[index]) === keyOf(value[index - 1]) ? run + 1 : 1;
        if (run > best) best = run;
    }
    return best;
}

function distinctCharCount(value) {
    return new Set([...value]).size;
}

/**
 * Progressive trailing-decoration peel used by P7a.  Returns up to three
 * shorter prefixes and stops at the first letter: `p@ssw0rd1` -> `p@ssw0rd`,
 * `admin123` -> `admin12`, `admin1`, `admin`.  Letters are never peeled, so
 * this stays a denylist refinement rather than a general substring rule —
 * "contains a common word" is P7b-①'s job and has its own curated stem list.
 */
function peelTrailingDecoration(value) {
    const variants = [];
    let current = typeof value === 'string' ? value : '';
    for (let index = 0; index < 3; index += 1) {
        const last = current[current.length - 1];
        if (last === undefined || /[a-z]/.test(last)) break;
        current = current.slice(0, -1);
        if (current) variants.push(current);
    }
    return variants;
}

/**
 * P8 label split.  Nobody types `www.fatherkey.com` into a password field;
 * they type the brand.  Splitting a configured context token into its
 * alphanumeric labels lets P8 catch `Zk9#mQ2$nightjar` for the token
 * `nightjar.shop` even when the static denylist has never heard of that
 * operator.  Labels shorter than the caller's minimum still only collide by
 * exact equality, so `co`/`xyz`/`www` never reject a legitimate password.
 */
function splitContextTokenLabels(token) {
    if (typeof token !== 'string') return [];
    return token.trim().toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
}

function contextTokenCollides(value, token, minTokenLength) {
    if (typeof token !== 'string') return false;
    const normalizedToken = token.trim().toLowerCase();
    if (!normalizedToken) return false;
    if (normalizedToken === value) return true;
    if ([...normalizedToken].length < minTokenLength) return false;
    return value.includes(normalizedToken) || normalizedToken.includes(value);
}

/**
 * §6.1.1 P1-P10.  Returns `{ ok, rule, reason }` and never throws: the caller
 * decides whether a rejection is a 400 `guest_password_weak` with the rule
 * attached (order path, §6.1.4) or a silent unified 403 (query path, §9.1).
 *
 * Rule evaluation order is part of the contract because tests and the user
 * facing copy depend on WHICH rule is reported:
 *   P1 -> P3 -> P4 -> P2a-d -> P9 -> P10 -> P6 -> P7a -> P7b -> P8
 */
function validateGuestQueryPasswordPolicy(password, options = {}) {
    const normalized = normalizeGuestQueryPassword(password);
    if (!normalized.ok) {
        return { ok: false, value: normalized.value, rule: normalized.rule, reason: normalized.reason };
    }
    const value = normalized.value;
    const reject = (rule, reason) => ({ ok: false, value, rule, reason });

    const minLength = Math.max(
        GUEST_QUERY_PASSWORD_MIN_LENGTH,
        Math.min(20, Number(options.minLength) || GUEST_QUERY_PASSWORD_MIN_LENGTH)
    );
    if ([...value].length < minLength) return reject('P1', 'too_short');

    if (!/[A-Z]/.test(value)) return reject('P2a', 'missing_uppercase');
    if (!/[a-z]/.test(value)) return reject('P2b', 'missing_lowercase');
    if (!/[0-9]/.test(value)) return reject('P2c', 'missing_digit');
    if (!/[^A-Za-z0-9]/.test(value)) return reject('P2d', 'missing_punctuation');

    if (longestRepeatRun(value) > GUEST_QUERY_PASSWORD_MAX_REPEAT_RUN) return reject('P9', 'repeated_character');
    if (distinctCharCount(value) < GUEST_QUERY_PASSWORD_MIN_DISTINCT) return reject('P10', 'low_character_diversity');

    const lower = value.toLowerCase();

    // P6: the local part is the single most common ingredient of a "strong
    // enough" password chosen by a real user.  Tokens shorter than 3 characters
    // only collide by exact equality, otherwise a two-letter mailbox would
    // reject almost every password the user can think of.
    if (typeof options.email === 'string' && GUEST_EMAIL_PATTERN.test(options.email.trim().toLowerCase())) {
        const localPart = options.email.trim().toLowerCase().split('@')[0];
        if (contextTokenCollides(lower, localPart, 3)) return reject('P6', 'contains_email_local_part');
    }

    // P7a: literal denylist, checked against leet-unfolded and
    // digit/punctuation-stripped variants so `Passw0rd!` and `P@ssw0rd1`
    // both resolve to `password`.
    const stripped = lower.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    const unfolded = leetUnfold(stripped);
    const candidates = new Set([
        lower,
        stripped,
        unfolded,
        unfolded.replace(/[0-9]+$/, ''),
        unfolded.replace(/[^a-z0-9]+$/, ''),
        leetUnfold(lower)
    ]);
    // Trailing digit/punctuation decoration is the cheapest way to dress a
    // denylisted word up until it satisfies P2 (`P@ssw0rd1`, `Qwerty2!`):
    // `p@ssw0rd1` unfolds to `passwordi`, which no denylist contains, but one
    // peeled character resolves it to `password`.  Peel, then unfold again,
    // because the decoration itself may be leet (`Admin123$`).
    for (const base of [stripped, unfolded, leetUnfold(lower)]) {
        for (const variant of peelTrailingDecoration(base)) {
            candidates.add(variant);
            candidates.add(leetUnfold(variant));
        }
    }
    for (const candidate of candidates) {
        if (candidate && GUEST_QUERY_PASSWORD_DENYLIST.has(candidate)) return reject('P7a', 'common_password');
    }

    // P7b-①: stem substring match on the leet-unfolded value.
    const haystacks = [lower, unfolded];
    for (const stem of GUEST_QUERY_PASSWORD_WEAK_STEMS) {
        if (haystacks.some((haystack) => haystack.includes(stem))) return reject('P7b', 'weak_stem');
    }

    // P7b-②: keyboard rows (both directions) plus monotonic alphabet/digit
    // runs of four or more.
    for (const sequence of GUEST_QUERY_PASSWORD_WEAK_SEQUENCES) {
        if (lower.includes(sequence)) return reject('P7b', 'keyboard_sequence');
    }
    if (longestMonotonicRun(lower) >= KEYBOARD_SEQUENCE_MIN_LENGTH) return reject('P7b', 'sequential_characters');

    // P7b-③: the canonical "Capitalized word + digits + one bang" shape.
    if (GUEST_QUERY_PASSWORD_WEAK_STRUCTURE.test(value)) return reject('P7b', 'weak_structure');

    // P8: order numbers and site domains.  order_no does not exist yet on the
    // create path (the RPC mints it), so this mainly guards the §13.2
    // historical-upgrade and admin-reset flows where it is known.
    if (contextTokenCollides(lower, options.orderNo, 6)) return reject('P8', 'contains_order_no');
    for (const token of options.forbiddenTokens || []) {
        if (contextTokenCollides(lower, token, 4)) return reject('P8', 'contains_site_token');
        for (const label of splitContextTokenLabels(token)) {
            if (contextTokenCollides(lower, label, 4)) return reject('P8', 'contains_site_token');
        }
    }

    return { ok: true, value, rule: '', reason: '' };
}

/**
 * Throwing wrapper used by the order path (§6.1.4): the user is present, no
 * secret exists yet, so telling them exactly which rule failed is safe and is
 * the only way the form is usable.  The query path must NEVER call this.
 */
function assertGuestQueryPasswordPolicy(password, options = {}) {
    const result = validateGuestQueryPasswordPolicy(password, options);
    if (!result.ok) {
        const error = new GuestShopSecurityError('查询密码强度不足', {
            statusCode: 400,
            code: 'guest_password_weak',
            field: options.field || 'orderPassword'
        });
        error.rule = result.rule;
        error.reason = result.reason;
        throw error;
    }
    return result.value;
}

function buildGuestQueryPasswordHashString({ params, norm, salt, hash }) {
    return `scrypt$${params.N}$${params.r}$${params.p}$norm=${norm}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * §6.2.  Per-row random salt, frozen cost parameters, standard base64 (NOT
 * base64url — the DB CHECK constrains the alphabet to [A-Za-z0-9+/=]).
 * `options.salt` exists for deterministic tests only; production callers must
 * omit it so every row gets fresh entropy.
 */
function hashGuestQueryPassword(password, options = {}) {
    const normalized = normalizeGuestQueryPassword(password);
    if (!normalized.ok) {
        fail('查询密码格式不正确', {
            statusCode: 400,
            code: 'guest_password_weak',
            field: options.field || 'orderPassword'
        });
    }
    const params = options.params
        ? Object.freeze({
            N: Number(options.params.N) || BUYER_SCRYPT_PARAMS.N,
            r: Number(options.params.r) || BUYER_SCRYPT_PARAMS.r,
            p: Number(options.params.p) || BUYER_SCRYPT_PARAMS.p,
            keylen: Number(options.params.keylen) || BUYER_SCRYPT_PARAMS.keylen,
            saltBytes: Number(options.params.saltBytes) || BUYER_SCRYPT_PARAMS.saltBytes
        })
        : BUYER_SCRYPT_PARAMS;
    if (params.N < BUYER_SCRYPT_MIN_PARAMS.N
        || params.r < BUYER_SCRYPT_MIN_PARAMS.r
        || params.p < BUYER_SCRYPT_MIN_PARAMS.p
        || params.keylen < BUYER_SCRYPT_MIN_PARAMS.keylen) {
        // Refuse to mint a hash weaker than the policy floor.  This is what
        // makes "cost parameters are not env knobs" enforceable in code rather
        // than only in a document.
        fail('游客查询密码哈希参数低于安全下限', {
            statusCode: 500,
            code: 'guest_password_hash_params_invalid',
            expose: false
        });
    }
    let salt;
    if (options.salt) {
        if (!Buffer.isBuffer(options.salt) || options.salt.length !== params.saltBytes) {
            fail('salt 长度不正确', { statusCode: 500, code: 'guest_password_hash_params_invalid', expose: false });
        }
        salt = options.salt;
    } else {
        salt = crypto.randomBytes(params.saltBytes);
    }
    const derived = crypto.scryptSync(Buffer.from(normalized.value, 'utf8'), salt, params.keylen, {
        N: params.N,
        r: params.r,
        p: params.p,
        maxmem: Math.max(BUYER_SCRYPT_MAXMEM, 128 * params.N * params.r * 2)
    });
    return buildGuestQueryPasswordHashString({
        params,
        norm: String(options.norm || GUEST_QUERY_PASSWORD_NORM_VERSION),
        salt,
        hash: derived
    });
}

/**
 * Parse a stored hash.  Never throws: an unparseable row is reported as
 * `{ ok: false }` so the query path degrades to the unified 403 of §9.1
 * instead of a 500 that would reveal the row is malformed.
 */
function parseGuestQueryPasswordHash(storedHash) {
    if (typeof storedHash !== 'string') {
        return { ok: false, reason: 'not_a_string' };
    }
    const match = storedHash.trim().match(GUEST_QUERY_PASSWORD_HASH_PATTERN);
    if (!match) return { ok: false, reason: 'malformed' };
    const [, rawN, rawR, rawP, norm, saltB64, hashB64] = match;
    let salt;
    let hash;
    try {
        salt = Buffer.from(saltB64, 'base64');
        hash = Buffer.from(hashB64, 'base64');
    } catch (_) {
        return { ok: false, reason: 'undecodable' };
    }
    if (!salt.length || !hash.length) return { ok: false, reason: 'undecodable' };
    return {
        ok: true,
        reason: '',
        N: Number(rawN),
        r: Number(rawR),
        p: Number(rawP),
        keylen: hash.length,
        norm,
        salt,
        hash
    };
}

/**
 * §6.2 verification.  Returns `{ ok, needsRehash, reason }` and never throws,
 * including for a corrupt row or an absurd parameter set.  `needsRehash` is
 * true only on a successful verification whose stored parameters (or norm
 * version) are below the current policy — that is the transparent upgrade path.
 */
function verifyGuestQueryPassword(password, storedHash) {
    const parsed = parseGuestQueryPasswordHash(storedHash);
    if (!parsed.ok) return { ok: false, needsRehash: false, reason: parsed.reason };
    if (parsed.N > BUYER_SCRYPT_PARSE_MAX.N
        || parsed.r > BUYER_SCRYPT_PARSE_MAX.r
        || parsed.p > BUYER_SCRYPT_PARSE_MAX.p
        || parsed.keylen > BUYER_SCRYPT_PARSE_MAX.keylen) {
        return { ok: false, needsRehash: false, reason: 'params_unsupported' };
    }
    const memoryCost = 128 * parsed.N * parsed.r;
    if (memoryCost > BUYER_SCRYPT_MAX_MEMORY_BYTES || memoryCost < 1024) {
        return { ok: false, needsRehash: false, reason: 'params_unsupported' };
    }
    const normalized = normalizeGuestQueryPassword(password);
    if (!normalized.ok) return { ok: false, needsRehash: false, reason: 'password_invalid' };
    let derived;
    try {
        derived = crypto.scryptSync(Buffer.from(normalized.value, 'utf8'), parsed.salt, parsed.keylen, {
            N: parsed.N,
            r: parsed.r,
            p: parsed.p,
            maxmem: Math.max(BUYER_SCRYPT_MAXMEM, memoryCost * 2)
        });
    } catch (_) {
        return { ok: false, needsRehash: false, reason: 'derivation_failed' };
    }
    if (derived.length !== parsed.hash.length) {
        return { ok: false, needsRehash: false, reason: 'length_mismatch' };
    }
    const ok = crypto.timingSafeEqual(derived, parsed.hash);
    if (!ok) return { ok: false, needsRehash: false, reason: 'bad_password' };
    const needsRehash = parsed.norm !== GUEST_QUERY_PASSWORD_NORM_VERSION
        || parsed.N < BUYER_SCRYPT_PARAMS.N
        || parsed.r < BUYER_SCRYPT_PARAMS.r
        || parsed.p < BUYER_SCRYPT_PARAMS.p
        || parsed.keylen < BUYER_SCRYPT_PARAMS.keylen;
    return { ok: true, needsRehash, reason: '' };
}

// A fixed, deliberately wrong credential at the frozen cost parameters.  §8.4
// requires the "unknown email" branch to burn exactly one scrypt so that it is
// timing-indistinguishable from "wrong password"; running the real verifier
// against this constant guarantees the same code path AND the same cost.
const GUEST_QUERY_PASSWORD_DUMMY_HASH = buildGuestQueryPasswordHashString({
    params: BUYER_SCRYPT_PARAMS,
    norm: GUEST_QUERY_PASSWORD_NORM_VERSION,
    salt: Buffer.alloc(BUYER_SCRYPT_PARAMS.saltBytes, 0x5a),
    hash: Buffer.alloc(BUYER_SCRYPT_PARAMS.keylen, 0xa5)
});

function runDummyGuestQueryPasswordVerification() {
    return verifyGuestQueryPassword('Zx7#Dummy9qK', GUEST_QUERY_PASSWORD_DUMMY_HASH);
}

/**
 * §7.1.  `X-Guest-Order-Credential: base64url(email + "\n" + password)`.
 *
 * A dedicated header (not the standard bearer-auth header) keeps the existing
 * isolation contract intact: tests/guest-shop-frontend-contract.test.js
 * asserts guest scripts never carry a session bearer token or a Supabase
 * import, and that assertion is an asset, not an obstacle.
 *
 * Only STRUCTURAL problems are a 400 `guest_credential_malformed`.  A password
 * that merely violates the charset policy is NOT malformed: such a password
 * can never have been stored, so it flows through to the verifier and returns
 * the same unified 403 as a wrong password.  Answering 400 there would hand
 * out a free distinguishing signal for no user benefit.
 */
function parseGuestOrderCredentialHeader(rawValue) {
    const malformed = () => fail('请输入邮箱和查询密码', {
        statusCode: 400,
        code: 'guest_credential_malformed',
        field: GUEST_ORDER_CREDENTIAL_HEADER
    });
    if (typeof rawValue !== 'string') malformed();
    const value = rawValue.trim();
    if (!value || value.length > GUEST_CREDENTIAL_HEADER_MAX_LENGTH) malformed();
    if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) malformed();
    let decoded;
    try {
        decoded = Buffer.from(value, 'base64url');
    } catch (_) {
        malformed();
    }
    // Node's base64url decoder silently ignores invalid characters, so prove
    // canonicity by re-encoding instead of trusting the decode.
    const canonical = decoded.toString('base64url');
    if (canonical !== value && `${canonical}=` !== value && `${canonical}==` !== value) malformed();
    const text = decoded.toString('utf8');
    if (!text || text.includes('\r')) malformed();
    const parts = text.split('\n');
    if (parts.length !== 2) malformed();
    const email = parts[0].trim().toLowerCase();
    if (!email || email.length > GUEST_EMAIL_MAX_LENGTH || !GUEST_EMAIL_PATTERN.test(email)) malformed();
    const password = foldFullwidthAscii(parts[1]);
    if (!password
        || password.length > GUEST_CREDENTIAL_MAX_PASSWORD_LENGTH
        || GUEST_QUERY_PASSWORD_CONTROL_CHARS.test(password)) {
        malformed();
    }
    return { email, password };
}

function buildGuestOrderCredentialHeader(email, password) {
    if (typeof email !== 'string') {
        fail('email 格式不正确', { field: 'email', code: 'invalid_format' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail
        || normalizedEmail.length > GUEST_EMAIL_MAX_LENGTH
        || !GUEST_EMAIL_PATTERN.test(normalizedEmail)) {
        fail('email 格式不正确', { field: 'email', code: 'invalid_format' });
    }
    if (typeof password !== 'string') {
        fail('查询密码格式不正确', { field: 'orderPassword', code: 'guest_password_weak' });
    }
    const folded = foldFullwidthAscii(password);
    if (!folded
        || folded.length > GUEST_CREDENTIAL_MAX_PASSWORD_LENGTH
        || GUEST_QUERY_PASSWORD_CONTROL_CHARS.test(folded)) {
        fail('查询密码格式不正确', { field: 'orderPassword', code: 'guest_password_weak' });
    }
    return Buffer.from(`${normalizedEmail}\n${folded}`, 'utf8').toString('base64url');
}

// §6.1.3.  Ambiguous glyphs are removed from every class: 0/O/o, 1/l/I and |.
// The generator is a MANDATORY companion to the four-class rule P2, not
// decoration — without it the cheapest way for a user to satisfy P2 is to
// reuse a real password from another site, which is strictly worse.
const GENERATED_QUERY_PASSWORD_CLASSES = Object.freeze({
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    lower: 'abcdefghijkmnqrstuvwxyz',
    digit: '23456789',
    punct: '!@#$%^&*()-_=+[]{};:,.<>?/~'
});
const GENERATED_QUERY_PASSWORD_ALPHABET = Object.freeze(
    Object.values(GENERATED_QUERY_PASSWORD_CLASSES).join('')
);

/**
 * Generate a 12-character, four-class, ambiguity-free query password that is
 * guaranteed to satisfy P1-P10.  Uses rejection sampling so the output is
 * never a password the server would refuse to store.
 */
function generateGuestQueryPassword(options = {}) {
    const attempts = Math.max(1, Math.min(64, Number(options.attempts) || 32));
    const classes = Object.values(GENERATED_QUERY_PASSWORD_CLASSES);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const chars = [];
        // One guaranteed character from each class, then fill from the pool.
        for (const pool of classes) {
            chars.push(pool[crypto.randomInt(pool.length)]);
        }
        while (chars.length < GENERATED_QUERY_PASSWORD_LENGTH) {
            chars.push(GENERATED_QUERY_PASSWORD_ALPHABET[crypto.randomInt(GENERATED_QUERY_PASSWORD_ALPHABET.length)]);
        }
        // Fisher-Yates with crypto randomness: the class-guaranteed characters
        // must not stay in a fixed position, or the shape itself leaks.
        for (let index = chars.length - 1; index > 0; index -= 1) {
            const swap = crypto.randomInt(index + 1);
            [chars[index], chars[swap]] = [chars[swap], chars[index]];
        }
        const candidate = chars.join('');
        if (validateGuestQueryPasswordPolicy(candidate, options).ok) return candidate;
    }
    // Unreachable in practice (rejection probability per attempt is ~1e-6).
    fail('无法生成查询密码', { statusCode: 500, code: 'guest_password_generation_failed', expose: false });
}

/**
 * §6.3.  The contact-hash pepper keys the credential group, so it becomes
 * mandatory the moment credentials are collected.  There is NO fallback to
 * the claim pepper here: a fallback that changes later silently re-keys every
 * stored contact_hash and makes existing guest orders permanently
 * unreachable.  scripts/guest-shop-readiness.js enforces the same rule before
 * an operator can turn the switch on.
 *
 * The legacy non-strict derivation (claim-pepper fallback, null when absent)
 * is preserved behind `strict: false` for the pre-2.0 order path so that
 * A1 is behaviour-neutral while the switch is off.
 */
function getGuestContactHashPepper(env = process.env, options = {}) {
    const strict = options.strict !== false;
    const source = env || {};
    const value = String(source.GUEST_SHOP_CONTACT_HASH_PEPPER || '').trim();
    if (!value) {
        if (!strict) {
            return String(source.GUEST_SHOP_CLAIM_PEPPER || '').trim();
        }
        fail('游客联系人哈希密钥未配置', {
            statusCode: 503,
            code: 'guest_shop_misconfigured',
            expose: false
        });
    }
    if (strict) {
        const forbidden = [
            source.SUPABASE_SERVICE_ROLE_KEY,
            source.CRON_SECRET,
            source.GUEST_SHOP_CLAIM_PEPPER,
            source.GUEST_SHOP_CLAIM_DERIVATION_PEPPER
        ];
        for (const candidate of forbidden) {
            const text = String(candidate || '').trim();
            if (text && text === value) {
                fail('游客联系人哈希密钥必须是独立密钥', {
                    statusCode: 503,
                    code: 'guest_shop_misconfigured',
                    expose: false
                });
            }
        }
        if (Buffer.byteLength(value, 'utf8') < 32) {
            fail('游客联系人哈希密钥强度不足', {
                statusCode: 503,
                code: 'guest_shop_misconfigured',
                expose: false
            });
        }
    }
    return value;
}

/**
 * HMAC-SHA256(pepper, lower(btrim(email))), hex.  The derivation is byte-for-byte
 * identical to the inline hashContact() that the pre-2.0 order path already
 * uses and to the value stored in guest_shop_orders.buyer_contact_hash, so
 * existing rows keep resolving.  Only the pepper STRICTNESS changes here, never
 * the digest.  A regression test asserts the two agree for the same pepper.
 *
 * §6.4.5: this hash is the QUOTA key (union across all credential groups of an
 * email).  Access control uses buyer_id.  The two must never be swapped.
 */
function hashGuestContact(email, options = {}) {
    const strict = options.strict !== false;
    const value = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!value) {
        if (!strict) return null;
        fail('email 不能为空', { field: 'email', code: 'required_field' });
    }
    const pepper = strict
        ? getGuestContactHashPepper(options.env || process.env, { strict: true })
        : getGuestContactHashPepper(options.env || process.env, { strict: false });
    if (!pepper) return null;
    return crypto.createHmac('sha256', Buffer.from(pepper, 'utf8'))
        .update(value, 'utf8')
        .digest('hex');
}


module.exports = {
    BUYER_SCRYPT_MIN_PARAMS,
    BUYER_SCRYPT_PARAMS,
    DEFAULT_JSON_BODY_LIMIT,
    DEFAULT_WEBHOOK_BODY_LIMIT,
    MAX_BODY_LIMIT_BYTES,
    GENERATED_QUERY_PASSWORD_LENGTH,
    GUEST_ORDER_CREDENTIAL_HEADER,
    GUEST_QUERY_PASSWORD_DENYLIST,
    GUEST_QUERY_PASSWORD_MAX_LENGTH,
    GUEST_QUERY_PASSWORD_MIN_LENGTH,
    GUEST_QUERY_PASSWORD_NORM_VERSION,
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
    generateGuestQueryPassword,
    deriveClaimSecretFromIdempotencyKey,
    getGuestClaimPepper,
    getGuestContactHashPepper,
    hashGuestContact,
    hashGuestQueryPassword,
    assertGuestQueryPasswordPolicy,
    buildGuestOrderCredentialHeader,
    parseGuestOrderCredentialHeader,
    parseGuestQueryPasswordHash,
    runDummyGuestQueryPasswordVerification,
    verifyGuestQueryPassword,
    validateGuestQueryPasswordPolicy,
    normalizeGuestQueryPassword,
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
        BUYER_SCRYPT_MAX_MEMORY_BYTES,
        BUYER_SCRYPT_PARSE_MAX,
        GENERATED_QUERY_PASSWORD_CLASSES,
        GUEST_EMAIL_PATTERN,
        GUEST_QUERY_PASSWORD_CHARSET,
        GUEST_QUERY_PASSWORD_DUMMY_HASH,
        GUEST_QUERY_PASSWORD_WEAK_SEQUENCES,
        GUEST_QUERY_PASSWORD_WEAK_STEMS,
        GUEST_QUERY_PASSWORD_WEAK_STRUCTURE,
        buildGuestQueryPasswordHashString,
        distinctCharCount,
        foldFullwidthAscii,
        leetFold,
        leetUnfold,
        longestMonotonicRun,
        longestRepeatRun,
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
