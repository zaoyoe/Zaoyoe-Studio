'use strict';

const crypto = require('node:crypto');
const sharedRequestSecurity = require('../../../api/_lib/request-security');
const { codePepper } = require('../../tg/code-secrets');
const { safeProduct } = require('../../tg/products');
const { createTgPaymentGateway } = require('../../tg/payment-gateway');

const CODE_PATTERN = /^TG-[A-Z0-9-]{12,64}$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/;
const STATUS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
const ORDER_STATUSES = new Set(['pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled']);
const PUBLIC_ERRORS = Object.freeze({
    invalid_code: '兑换码无效', invalid_request: '兑换请求无效', invalid_username: 'Telegram 用户名格式无效',
    expired: '兑换码已过期', code_unavailable: '兑换码不可用', batch_unavailable: '兑换码批次不可用',
    idempotency_conflict: '兑换请求与原请求不一致，请勿更换账号后重试', not_found: '订单不存在或查询凭证无效'
});
function text(value, max = 256) { return String(value ?? '').trim().slice(0, max); }
function normalizeCode(value) { return text(value, 128).toUpperCase().replace(/\s+/g, ''); }
function tokenHash(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function digest(value, env = process.env) {
    return crypto.createHmac('sha256', codePepper(env)).update(normalizeCode(value)).digest('hex');
}
function sendJson(res, status, payload) {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(JSON.stringify(payload));
}
function enabled(value) { return /^(true|1)$/i.test(String(value || '').trim()); }
function invalidBody() { return Object.assign(new Error('请求内容格式无效'), { statusCode: 400 }); }
async function body(req) {
    const limit = 8192;
    let source;
    if (req.body && typeof req.body === 'object') source = req.body;
    else {
        let raw;
        if (typeof req.body === 'string') raw = req.body;
        else {
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                size += buffer.length;
                if (size > limit) throw Object.assign(new Error('请求内容过大'), { statusCode: 413 });
                chunks.push(buffer);
            }
            raw = Buffer.concat(chunks).toString('utf8');
        }
        if (Buffer.byteLength(raw) > limit) throw Object.assign(new Error('请求内容过大'), { statusCode: 413 });
        try { source = JSON.parse(raw); } catch (_) { throw invalidBody(); }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw invalidBody();
    if (Buffer.byteLength(JSON.stringify(source)) > limit) throw Object.assign(new Error('请求内容过大'), { statusCode: 413 });
    return source;
}
function allowedOrigin(req, env) {
    const origin = String(req.headers?.origin || '').trim();
    if (!origin) return true;
    const allowed = new Set(['https://tg.fatherkey.com']);
    for (const item of String(env.TG_PUBLIC_ORIGINS || env.TG_PUBLIC_ORIGIN || '').split(',')) {
        try { allowed.add(new URL(item.trim()).origin); } catch (_) { /* ignore invalid configuration */ }
    }
    const production = sharedRequestSecurity._private.isProductionLikeRuntime(env) || String(env.NODE_ENV || '').toLowerCase() === 'production';
    if (!production) {
        for (const host of ['localhost', '127.0.0.1']) for (const port of [3100, 8000]) allowed.add(`http://${host}:${port}`);
    }
    return allowed.has(origin);
}
function publicOrder(data) {
    if (!data || data.success !== true || !/^TG-[A-Z0-9]{12,24}$/.test(String(data.order_no || '')) || !ORDER_STATUSES.has(data.status)) return null;
    const family = data.product_family ?? 'telegram_premium';
    let product;
    if (family === 'telegram_premium' && [3, 6, 12].includes(data.term_months) && data.stars_quantity == null) {
        product = { product_family: family, term_months: data.term_months, stars_quantity: null };
    } else if (family === 'telegram_stars' && data.term_months === null
        && Number.isSafeInteger(data.stars_quantity) && data.stars_quantity >= 50 && data.stars_quantity <= 1000000) {
        product = { product_family: family, term_months: null, stars_quantity: data.stars_quantity };
    } else return null;
    const result = { success: true, order_no: data.order_no, status: data.status, ...product };
    if (typeof data.existing === 'boolean') result.existing = data.existing;
    if (USERNAME_PATTERN.test(String(data.username || ''))) result.username = data.username;
    for (const key of ['created_at', 'updated_at']) if (typeof data[key] === 'string') result[key] = data[key];
    return result;
}
function publicError(data, fallback = '兑换失败，请联系客服处理') {
    const code = Object.hasOwn(PUBLIC_ERRORS, data?.code) ? data.code : 'redemption_failed';
    return { success: false, code, message: PUBLIC_ERRORS[code] || fallback };
}
function createTgHandlers({ admin, env = process.env, requestSecurity = sharedRequestSecurity } = {}) {
    async function limitRequest(req, res, supabase, scope, limit) {
        const ip = requestSecurity.resolveClientIp(req, { env }) || 'unknown';
        const production = sharedRequestSecurity._private.isProductionLikeRuntime(env);
        const result = await requestSecurity.takeRateLimitToken({
            supabase, env, key: `tg:${scope}:ip:${tokenHash(ip)}`, limit, windowMs: 60_000, requirePersistent: production
        });
        requestSecurity.applyRateLimitHeaders(res, result);
        if (result.allowed) return true;
        sendJson(res, result.unavailable ? 503 : 429, { success: false, code: result.unavailable ? 'security_unavailable' : 'rate_limited', message: result.unavailable ? '兑换服务暂不可用，请稍后重试' : '请求过于频繁，请稍后重试' });
        return false;
    }
    return {
        async catalog(req, res) {
            if (String(req.method || '').toUpperCase() !== 'GET') { res.setHeader('Allow', 'GET'); return sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
            let saleProducts = [];
            try {
                const supabase = admin.getOptionalSupabaseAdmin?.();
                if (supabase && typeof supabase.from === 'function') {
                    const { data, error } = await supabase.from('tg_purchase_products').select('product_key,product_family,term_months,price_minor,unit_price_micros,min_stars,max_stars,enabled,currency,price_version').order('product_key', { ascending: true });
                    if (error) throw error;
                    saleProducts = (data || []).map(safeProduct);
                    if (saleProducts.some((product) => !product)) throw new Error('Invalid TG catalog');
                    saleProducts = saleProducts.map(({ product_id, updated_at, ...product }) => ({ id: product_id, ...product }));
                }
            } catch (_) { saleProducts = []; }
            const channels = createTgPaymentGateway({ env }).channels();
            return sendJson(res, 200, {
                success: true, redemption_enabled: enabled(env.TG_REDEMPTION_ENABLED),
                purchase_enabled: enabled(env.TG_PURCHASE_ENABLED) && channels.length > 0 && saleProducts.some((product) => product.enabled),
                currency: 'CNY', sale_products: saleProducts, payment_channels: channels,
                products: [
                    ...[3, 6, 12].map((term_months) => ({ product_family: 'telegram_premium', term_months })),
                    { product_family: 'telegram_stars', min_stars: 50, max_stars: 1000000 }
                ]
            });
        },
        async redeem(req, res) {
            if (String(req.method || '').toUpperCase() !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
            try {
                if (!allowedOrigin(req, env)) return sendJson(res, 403, { success: false, code: 'origin_denied', message: '当前请求来源不可用' });
                if (!enabled(env.TG_REDEMPTION_ENABLED)) return sendJson(res, 503, { success: false, code: 'redemption_disabled', message: 'TG 兑换服务暂未开放' });
                const supabase = admin.getOptionalSupabaseAdmin?.();
                if (!supabase) return sendJson(res, 503, { success: false, message: 'TG 兑换服务暂不可用' });
                if (!await limitRequest(req, res, supabase, 'redeem', 10)) return;
                const input = await body(req);
                const code = normalizeCode(input.code);
                const username = typeof input.username === 'string' ? input.username.trim().replace(/^@/, '').toLowerCase() : '';
                if (typeof input.code !== 'string' || !CODE_PATTERN.test(code)) return sendJson(res, 400, { success: false, code: 'invalid_code', message: PUBLIC_ERRORS.invalid_code });
                if (!USERNAME_PATTERN.test(username)) return sendJson(res, 400, { success: false, code: 'invalid_username', message: PUBLIC_ERRORS.invalid_username });
                const suppliedToken = input.status_token ?? input.statusToken;
                const statusToken = suppliedToken === undefined ? crypto.randomBytes(24).toString('base64url') : suppliedToken;
                const suppliedKey = req.headers?.['idempotency-key'] ?? input.idempotency_key ?? input.idempotencyKey;
                const idempotencyKey = suppliedKey === undefined ? crypto.randomUUID() : suppliedKey;
                if (typeof statusToken !== 'string' || !STATUS_TOKEN_PATTERN.test(statusToken) || typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) return sendJson(res, 400, { success: false, code: 'invalid_request', message: PUBLIC_ERRORS.invalid_request });
                const { data, error } = await supabase.rpc('fn_tg_reserve_code', {
                    p_code_digest: digest(code, env), p_username: username,
                    p_status_token_hash: tokenHash(statusToken), p_idempotency_key_hash: tokenHash(idempotencyKey)
                });
                if (error) throw error;
                if (data?.success !== true) return sendJson(res, data?.code === 'invalid_code' ? 404 : 409, publicError(data));
                const result = publicOrder(data);
                if (!result) throw new Error('Unconfirmed TG order response');
                // The SQL transaction binds replay to code + recipient + both
                // hashes. A replay never receives a newly generated token.
                return sendJson(res, 200, result.existing ? result : { ...result, status_token: statusToken });
            } catch (error) {
                const status = [400, 413, 503].includes(Number(error?.statusCode)) ? Number(error.statusCode) : 500;
                return sendJson(res, status, { success: false, message: status === 400 || status === 413 ? error.message : '兑换失败，请联系客服处理' });
            }
        },
        async status(req, res) {
            if (String(req.method || '').toUpperCase() !== 'GET') { res.setHeader('Allow', 'GET'); return sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
            try {
                if (!allowedOrigin(req, env)) return sendJson(res, 403, { success: false, code: 'origin_denied', message: '当前请求来源不可用' });
                const supabase = admin.getOptionalSupabaseAdmin?.();
                if (!supabase) return sendJson(res, 503, { success: false, message: 'TG 订单服务暂不可用' });
                if (!await limitRequest(req, res, supabase, 'status', 60)) return;
                const url = new URL(req.url || '', 'http://localhost');
                const orderNo = url.searchParams.get('order_no') || url.searchParams.get('orderNo') || '';
                // Bearer credentials belong in a header, never in URLs that
                // can be retained by access logs, history or referrers.
                const statusToken = req.headers?.['x-tg-status-token'];
                if (!/^TG-[A-Z0-9]{12,24}$/.test(orderNo) || typeof statusToken !== 'string' || !STATUS_TOKEN_PATTERN.test(statusToken)) return sendJson(res, 400, { success: false, message: '订单查询参数无效' });
                const { data, error } = await supabase.rpc('fn_tg_order_status', { p_order_no: orderNo, p_status_token_hash: tokenHash(statusToken) });
                if (error) throw error;
                if (data?.success !== true) return sendJson(res, 404, publicError({ code: 'not_found' }));
                const result = publicOrder(data);
                if (!result) throw new Error('Unconfirmed TG status response');
                return sendJson(res, 200, result);
            } catch (_) { return sendJson(res, 500, { success: false, message: '订单查询失败，请稍后重试' }); }
        }
    };
}
module.exports = { createTgHandlers, normalizeCode, digest, tokenHash, _private: { body, allowedOrigin, sendJson, enabled } };
