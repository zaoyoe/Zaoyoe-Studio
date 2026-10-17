'use strict';

const crypto = require('node:crypto');
const sharedRequestSecurity = require('../../../api/_lib/request-security');
const { codePepper } = require('../../tg/code-secrets');
const orderQuery = require('../../tg/order-query');
const { safeProduct } = require('../../tg/products');
const { createTgPaymentGateway } = require('../../tg/payment-gateway');

const CODE_PATTERN = /^TG-[A-Z0-9-]{12,64}$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/;
const STATUS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
const ORDER_STATUSES = new Set(['pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled', 'closed']);
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
    res.setHeader('Referrer-Policy', 'no-referrer');
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
    if (data.status === 'closed') {
        if (typeof data.closed_at !== 'string' || !Number.isFinite(Date.parse(data.closed_at)) || typeof data.completion_note !== 'string'
            || data.completion_note.trim().length < 6 || data.completion_note.length > 500 || /[\x00-\x09\x0b-\x1f\x7f]/.test(data.completion_note)) return null;
        result.closed_at = data.closed_at; result.completion_note = data.completion_note;
    }
    return result;
}
function publicError(data, fallback = '兑换失败，请联系客服处理') {
    const code = Object.hasOwn(PUBLIC_ERRORS, data?.code) ? data.code : 'redemption_failed';
    return { success: false, code, message: PUBLIC_ERRORS[code] || fallback };
}
function createTgHandlers({ admin, env = process.env, requestSecurity = sharedRequestSecurity } = {}) {
    async function limitRequest(req, res, supabase, scope, limit) {
        const ip = requestSecurity.resolveClientIp(req, { env }) || 'unknown';
        const production = sharedRequestSecurity._private.isProductionLikeRuntime(env) || String(env.NODE_ENV || '').toLowerCase() === 'production';
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
            let supabase;
            try {
                supabase = admin.getOptionalSupabaseAdmin?.();
                if (supabase && typeof supabase.from === 'function') {
                    const { data, error } = await supabase.from('tg_purchase_products').select('product_key,product_family,term_months,price_minor,unit_price_micros,min_stars,max_stars,enabled,currency,price_version').order('product_key', { ascending: true });
                    if (error) throw error;
                    saleProducts = (data || []).map(safeProduct);
                    if (saleProducts.some((product) => !product)) throw new Error('Invalid TG catalog');
                    saleProducts = saleProducts.map(({ product_id, updated_at, ...product }) => ({ id: product_id, ...product }));
                }
            } catch (_) { saleProducts = []; }
            const gateway = createTgPaymentGateway({ env });
            let channels = gateway.channels();
            let usdtRate; let fxSnapshot;
            if (channels.some(channel => channel.id === 'usdt_bep20')) {
                try {
                    fxSnapshot = await gateway.resolveUsdtFx({ supabase });
                    usdtRate = gateway.usdtRate({ fxSnapshot });
                } catch (_) { channels = channels.filter(channel => channel.id !== 'usdt_bep20'); }
            }
            const result = {
                success: true, redemption_enabled: enabled(env.TG_REDEMPTION_ENABLED),
                order_query: { enabled: await orderQuery.ready(supabase), password_min_length: 8 },
                purchase_enabled: enabled(env.TG_PURCHASE_ENABLED) && channels.length > 0 && saleProducts.some((product) => product.enabled),
                currency: 'CNY', sale_products: saleProducts, payment_channels: channels,
                products: [
                    ...[3, 6, 12].map((term_months) => ({ product_family: 'telegram_premium', term_months })),
                    { product_family: 'telegram_stars', min_stars: 50, max_stars: 1000000 }
                ]
            };
            if (usdtRate) result.usdt_per_cny = usdtRate;
            if (fxSnapshot) result.usdt_fx = fxSnapshot;
            if (env.PAYMENT_USDT_FX_MODE === 'market') result.usdt_fx_mode = 'market';
            return sendJson(res, 200, result);
        },
        async codePreview(req, res) {
            if (String(req.method || '').toUpperCase() !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
            try {
                if (!allowedOrigin(req, env)) return sendJson(res, 403, { success: false, code: 'origin_denied', message: '当前请求来源不可用' });
                if (!enabled(env.TG_REDEMPTION_ENABLED)) return sendJson(res, 503, { success: false, code: 'redemption_disabled', message: 'TG 兑换服务暂未开放' });
                const supabase = admin.getOptionalSupabaseAdmin?.();
                if (!supabase) return sendJson(res, 503, { success: false, message: '兑换码暂时无法核验，请稍后重试' });
                if (!await limitRequest(req, res, supabase, 'code-preview', 20)) return;
                orderQuery.rejectUrlCredentials(req);
                const input = await body(req);
                const code = normalizeCode(input.code);
                if (Object.keys(input).some(key => key !== 'code') || typeof input.code !== 'string' || !CODE_PATTERN.test(code)) {
                    return sendJson(res, 400, { success: false, code: 'invalid_code', message: PUBLIC_ERRORS.invalid_code });
                }
                // Read only: previewing a gift must never reserve a code or create a task.
                const { data: gift, error } = await supabase.from('tg_redemption_codes')
                    .select('batch_id,status,expires_at').eq('code_digest', digest(code, env)).maybeSingle();
                if (error) throw error;
                if (!gift || gift.status !== 'available') return sendJson(res, 404, { success: false, code: 'code_unavailable', message: '兑换码不存在、已使用或暂不可用' });
                const { data: batch, error: batchError } = await supabase.from('tg_redemption_batches')
                    .select('product_family,term_months,stars_quantity,status,valid_from,valid_until').eq('id', gift.batch_id).maybeSingle();
                if (batchError) throw batchError;
                const now = Date.now();
                const expired = gift.expires_at != null && (!Number.isFinite(Date.parse(gift.expires_at)) || Date.parse(gift.expires_at) <= now);
                const active = batch?.status === 'active' && Number.isFinite(Date.parse(batch.valid_from)) && Date.parse(batch.valid_from) <= now
                    && (batch.valid_until == null || (Number.isFinite(Date.parse(batch.valid_until)) && Date.parse(batch.valid_until) > now));
                if (expired || !active) return sendJson(res, 409, { success: false, code: expired ? 'expired' : 'code_unavailable', message: expired ? PUBLIC_ERRORS.expired : PUBLIC_ERRORS.code_unavailable });
                const product = batch.product_family === 'telegram_premium' && [3, 6, 12].includes(batch.term_months) && batch.stars_quantity == null
                    ? { product_family: batch.product_family, term_months: batch.term_months, stars_quantity: null }
                    : batch.product_family === 'telegram_stars' && batch.term_months == null && Number.isSafeInteger(batch.stars_quantity) && batch.stars_quantity >= 50 && batch.stars_quantity <= 1000000
                        ? { product_family: batch.product_family, term_months: null, stars_quantity: batch.stars_quantity } : null;
                if (!product) throw new Error('Invalid TG gift entitlement');
                return sendJson(res, 200, { success: true, product });
            } catch (error) {
                return sendJson(res, [400, 413].includes(error.statusCode) ? error.statusCode : 503, { success: false, message: '兑换码暂时无法核验，请稍后重试' });
            }
        },
        async preview(req, res) {
            if (String(req.method || '').toUpperCase() !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
            try {
                if (!allowedOrigin(req, env)) return sendJson(res, 403, { success: false, code: 'origin_denied', message: '当前请求来源不可用' });
                if (!enabled(env.TG_REDEMPTION_ENABLED)) return sendJson(res, 503, { success: false, code: 'redemption_disabled', message: 'TG 兑换服务暂未开放' });
                const supabase = admin.getOptionalSupabaseAdmin?.();
                if (!supabase) return sendJson(res, 503, { success: false, message: 'TG 兑换服务暂不可用' });
                if (!await limitRequest(req, res, supabase, 'preview', 10)) return;
                const input = await body(req); const code = normalizeCode(input.code);
                if (typeof input.code !== 'string' || !CODE_PATTERN.test(code)) return sendJson(res, 400, publicError({ code: 'invalid_code' }));
                const { data, error } = await supabase.rpc('fn_tg_preview_code', { p_code_digest: digest(code, env) });
                if (error) throw error;
                if (data?.success !== true) return sendJson(res, 409, publicError({ code: 'code_unavailable' }));
                const { productFields } = require('./tg-purchase')._private;
                const product = productFields(data);
                if (!product || (data.expires_at != null && !Number.isFinite(Date.parse(data.expires_at)))) throw new Error('Invalid preview');
                return sendJson(res, 200, { success: true, ...product, expires_at: data.expires_at || null });
            } catch (error) {
                const status = [400, 413, 503].includes(Number(error?.statusCode)) ? Number(error.statusCode) : 500;
                return sendJson(res, status, { success: false, message: status < 500 ? error.message : '兑换码暂时无法核对，请稍后重试' });
            }
        },
        async redeem(req, res) {
            if (String(req.method || '').toUpperCase() !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
            try {
                if (!allowedOrigin(req, env)) return sendJson(res, 403, { success: false, code: 'origin_denied', message: '当前请求来源不可用' });
                if (!enabled(env.TG_REDEMPTION_ENABLED)) return sendJson(res, 503, { success: false, code: 'redemption_disabled', message: 'TG 兑换服务暂未开放' });
                const supabase = admin.getOptionalSupabaseAdmin?.();
                if (!supabase) return sendJson(res, 503, { success: false, message: 'TG 兑换服务暂不可用' });
                if (!await limitRequest(req, res, supabase, 'redeem', 10)) return;
                orderQuery.rejectUrlCredentials(req);
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
                const buyerId = await orderQuery.prepareCreation(supabase, input, env);
                const args = { p_code_digest: digest(code, env), p_username: username,
                    p_status_token_hash: tokenHash(statusToken), p_idempotency_key_hash: tokenHash(idempotencyKey) };
                let data;
                if (buyerId) data = await orderQuery.rpc(supabase, 'fn_tg_reserve_code_with_query', { p_request: args, p_buyer_id: buyerId });
                else {
                    const result = await supabase.rpc('fn_tg_reserve_code', args);
                    if (result.error) throw result.error;
                    data = result.data;
                }
                if (data?.success !== true) return sendJson(res, data?.code === 'invalid_code' ? 404 : 409, publicError(data));
                if (data.status === 'closed') {
                    const snapshot = await supabase.rpc('fn_tg_order_status', { p_order_no: data.order_no, p_status_token_hash: args.p_status_token_hash });
                    if (snapshot.error || snapshot.data?.success !== true || snapshot.data.order_no !== data.order_no) throw new Error('Unconfirmed closed redemption replay');
                    data = { ...snapshot.data, existing: true };
                }
                const result = publicOrder(data);
                if (!result) throw new Error('Unconfirmed TG order response');
                // The SQL transaction binds replay to code + recipient + both
                // hashes. A replay never receives a newly generated token.
                return sendJson(res, 200, result.existing ? result : { ...result, status_token: statusToken });
            } catch (error) {
                if (orderQuery.sendError(res, error)) return;
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
                orderQuery.rejectUrlCredentials(req);
                const statusToken = req.headers?.['x-tg-status-token'];
                const queryCredential = req.headers?.[orderQuery.HEADER];
                if (!/^TG-[A-Z0-9]{12,24}$/.test(orderNo) || queryCredential === undefined && (typeof statusToken !== 'string' || !STATUS_TOKEN_PATTERN.test(statusToken))) return sendJson(res, 400, { success: false, message: '订单查询参数无效' });
                const hash = queryCredential !== undefined
                    ? await orderQuery.ownedTokenHash({ db: supabase, kind: 'redeem', orderNo, env, requestSecurity, req, res }) : tokenHash(statusToken);
                const { data, error } = await supabase.rpc('fn_tg_order_status', { p_order_no: orderNo, p_status_token_hash: hash });
                if (error) throw error;
                if (data?.success !== true) return sendJson(res, 404, publicError({ code: 'not_found' }));
                const result = publicOrder(data);
                if (!result) throw new Error('Unconfirmed TG status response');
                return sendJson(res, 200, result);
            } catch (caught) { if (orderQuery.sendError(res, caught)) return; return sendJson(res, 500, { success: false, message: '订单查询失败，请稍后重试' }); }
        }
    };
}
module.exports = { createTgHandlers, publicOrder, normalizeCode, digest, tokenHash, _private: { body, allowedOrigin, sendJson, enabled } };
