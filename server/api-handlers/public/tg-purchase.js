'use strict';

const crypto = require('node:crypto');
const sharedSecurity = require('../../../api/_lib/request-security');
const { tokenHash, _private: { body, allowedOrigin, sendJson, enabled } } = require('./tg');
const { PRODUCTS } = require('../../tg/products');
const { createTgPaymentGateway, httpsUrl } = require('../../tg/payment-gateway');
const { safeCryptoCheckout, parsePaymentJson, CHANNEL: CRYPTO_CHANNEL } = require('../../tg/nowpayments-gateway');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_NO = /^TGP-[A-Z0-9]{20}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{16,128}$/;
const USERNAME = /^[A-Za-z0-9_]{5,32}$/;
const ERRORS = Object.freeze({ invalid_request: '购买请求无效', invalid_username: 'Telegram 用户名格式无效', product_unavailable: '当前商品暂未开售', quote_expired: '报价已过期，请重新确认价格', quote_not_found: '报价无效，请重新确认价格', quote_stale: '商品价格已更新，请重新确认价格', quote_conflict: '购买信息已变化，请重新确认报价', quote_mismatch: '购买信息已变化，请重新确认报价', quote_already_used: '该报价已创建订单，请查询原订单', price_changed: '商品价格已更新，请重新确认价格', price_version_conflict: '商品价格已更新，请重新确认价格', idempotency_conflict: '本次请求与原订单不一致，请查询原订单', payment_channel_invalid: '当前支付方式不可用', payment_binding_mismatch: '支付结果尚未确认，请联系客服处理' });
const PAYMENT = new Set(['awaiting_payment', 'checkout_creating', 'paid', 'manual_review', 'expired']);
const FULFILLMENT = new Set(['not_started', 'pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled']);
function invalid(message = ERRORS.invalid_request) { return Object.assign(new Error(message), { statusCode: 400, code: 'invalid_request' }); }
function productFields(value) {
    if (value?.product_family === 'telegram_premium' && [3, 6, 12].includes(value.term_months) && value.stars_quantity == null) return { product_family: 'telegram_premium', term_months: value.term_months, stars_quantity: null };
    if (value?.product_family === 'telegram_stars' && value.term_months == null && Number.isSafeInteger(value.stars_quantity) && value.stars_quantity >= 50 && value.stars_quantity <= 1000000) return { product_family: 'telegram_stars', term_months: null, stars_quantity: value.stars_quantity };
    return null;
}
function safeOrder(value) {
    const product = productFields(value);
    const amount = Number(value?.total_minor);
    const priceVersion = Number(value?.price_version);
    const username = value?.telegram_username ?? value?.username;
    if (!product || !ORDER_NO.test(value.order_no || '') || !USERNAME.test(username || '') || value.currency !== 'CNY'
        || !Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(priceVersion) || priceVersion < 1 || !PAYMENT.has(value.payment_status)) return null;
    const fulfillment = value.fulfillment_status || (value.payment_status === 'paid' ? 'pending' : 'not_started');
    if (!FULFILLMENT.has(fulfillment)) return null;
    const order = { order_no: value.order_no, username, ...product, currency: 'CNY', total_minor: amount, price_version: priceVersion,
        payment_channel: value.payment_channel, payment_status: ['awaiting_payment', 'checkout_creating'].includes(value.payment_status) ? 'pending' : value.payment_status,
        fulfillment_status: fulfillment };
    if (!['alipay', 'wxpay', CRYPTO_CHANNEL].includes(order.payment_channel)) return null;
    if (value.crypto_checkout != null) {
        const checkout = safeCryptoCheckout(value.crypto_checkout);
        if (!checkout || order.payment_channel !== CRYPTO_CHANNEL) return null;
        if (order.payment_status === 'pending') order.crypto_checkout = checkout;
    }
    if (order.payment_status === 'pending' && value.checkout_url) { const url = httpsUrl(value.checkout_url); if (url) order.checkout_url = url; }
    for (const key of ['created_at', 'updated_at']) if (typeof value[key] === 'string') order[key] = value[key];
    const expiresAt = value.payment_expires_at ?? value.expires_at;
    if (typeof expiresAt === 'string') order.expires_at = expiresAt;
    return order;
}
function rpcError(data, res) {
    const code = Object.hasOwn(ERRORS, data?.code) ? data.code : 'purchase_unconfirmed';
    return sendJson(res, 409, { success: false, code, message: ERRORS[code] || '购买结果尚未确认，请查询原订单或联系客服' });
}
async function webhookPayload(req) {
    const params = new URL(req.url || '/', 'https://tg.fatherkey.com').searchParams;
    const result = {};
    function add(key, value) { if (['route', 'scope', 'path'].includes(key)) return; if (Object.hasOwn(result, key) || typeof value !== 'string' || value.length > 4096) throw invalid(); result[key] = value; }
    if (String(req.method).toUpperCase() === 'GET') for (const [key, value] of params) add(key, value);
    else {
        if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/x-www-form-urlencoded')) throw invalid();
        if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && !Array.isArray(req.body)) for (const [key, value] of Object.entries(req.body)) add(key, value);
        else {
            let raw = req.body;
            if (raw === undefined) { const chunks = []; let size = 0; for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > 16384) throw invalid(); chunks.push(Buffer.from(chunk)); } raw = Buffer.concat(chunks).toString('utf8'); }
            if (Buffer.byteLength(String(raw)) > 16384) throw invalid();
            for (const [key, value] of new URLSearchParams(String(raw))) add(key, value);
        }
    }
    if (Object.keys(result).length > 40) throw invalid();
    return result;
}
function plain(res, status, value) { res.status(status); res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(value); }
async function cryptoWebhookBody(req) {
    let raw = req.rawBody;
    if (raw == null && (typeof req.body === 'string' || Buffer.isBuffer(req.body))) raw = req.body;
    if (raw == null && req.body && typeof req.body === 'object') {
        // Parsed monetary numbers have lost their original decimal token. They
        // cannot be accepted as exact settlement evidence without raw bytes.
        if (['payment_id', 'price_amount', 'pay_amount', 'actually_paid'].some((key) => typeof req.body[key] === 'number')) throw invalid();
        raw = JSON.stringify(req.body);
    }
    if (raw == null) { const chunks = []; let size = 0; for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > 8192) throw invalid(); chunks.push(Buffer.from(chunk)); } raw = Buffer.concat(chunks); }
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    if (Buffer.byteLength(text) > 8192) throw invalid();
    try { return parsePaymentJson(text); } catch (_) { throw invalid(); }
}

function createTgPurchaseHandlers({ admin, env = process.env, requestSecurity = sharedSecurity, gateway = createTgPaymentGateway({ env }), leaseTokenFactory = () => crypto.randomUUID() } = {}) {
    async function rpc(supabase, name, args) { const { data, error } = await supabase.rpc(name, args); if (error) throw new Error('TG purchase database unavailable'); return data; }
    async function context(req, res, scope, limit, { selling = false } = {}) {
        if (!allowedOrigin(req, env)) { sendJson(res, 403, { success: false, message: '当前请求来源不可用' }); return null; }
        if (selling && (!enabled(env.TG_PURCHASE_ENABLED) || !gateway.channels().length)) { sendJson(res, 503, { success: false, code: 'purchase_disabled', message: 'TG 购买服务暂未开放' }); return null; }
        const supabase = admin.getOptionalSupabaseAdmin?.();
        if (!supabase) { sendJson(res, 503, { success: false, message: 'TG 购买服务暂不可用' }); return null; }
        const ip = requestSecurity.resolveClientIp(req, { env }) || 'unknown';
        const rate = await requestSecurity.takeRateLimitToken({ supabase, env, key: `tg:purchase:${scope}:ip:${tokenHash(ip)}`, limit, windowMs: 60000, requirePersistent: requestSecurity._private.isProductionLikeRuntime(env) });
        requestSecurity.applyRateLimitHeaders(res, rate);
        if (!rate.allowed) { sendJson(res, rate.unavailable ? 503 : 429, { success: false, message: rate.unavailable ? '服务暂不可用，请稍后重试' : '请求过于频繁，请稍后重试' }); return null; }
        return supabase;
    }
    function method(req, res, expected) { if (req.method === expected) return true; res.setHeader('Allow', expected); sendJson(res, 405, { success: false, message: 'Method not allowed' }); return false; }
    function error(res, caught) { return sendJson(res, [400, 413].includes(caught?.statusCode) ? caught.statusCode : 503, { success: false, code: [400, 413].includes(caught?.statusCode) ? 'invalid_request' : 'purchase_unconfirmed', message: [400, 413].includes(caught?.statusCode) ? caught.message : '购买结果暂未确认，请查询原订单或联系客服' }); }
    return {
        async quote(req, res) {
            if (!method(req, res, 'POST')) return;
            try {
                const supabase = await context(req, res, 'quote', 20, { selling: true }); if (!supabase) return;
                const input = await body(req); const definition = Object.hasOwn(PRODUCTS, input.product_id) ? PRODUCTS[input.product_id] : null;
                const username = typeof input.username === 'string' ? input.username.trim().replace(/^@/, '').toLowerCase() : '';
                if (!definition || !USERNAME.test(username)) throw invalid();
                const stars = input.product_id === 'stars';
                if (stars ? !Number.isSafeInteger(input.stars_quantity) || input.stars_quantity < 50 || input.stars_quantity > 1000000 : input.stars_quantity != null) throw invalid();
                const data = await rpc(supabase, 'fn_tg_purchase_quote', { p_product_family: definition[0], p_term_months: definition[1], p_stars_quantity: stars ? input.stars_quantity : null, p_username: username });
                if (data?.success !== true) return rpcError(data, res);
                const quote = data.quote; const product = productFields(quote); const total = Number(quote?.total_minor); const version = Number(quote?.price_version);
                if (!product || !UUID.test(quote?.quote_id || '') || quote.username !== username || product.product_family !== definition[0] || product.term_months !== definition[1]
                    || (stars && product.stars_quantity !== input.stars_quantity) || quote.currency !== 'CNY' || !Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(version) || version < 1 || typeof quote.expires_at !== 'string') throw new Error('Invalid TG quote');
                return sendJson(res, 200, { success: true, quote: { quote_id: quote.quote_id, product_id: input.product_id, ...product, username, currency: 'CNY', total_minor: total, price_version: version, expires_at: quote.expires_at } });
            } catch (caught) { return error(res, caught); }
        },
        async orders(req, res) {
            if (!method(req, res, 'POST')) return;
            try {
                const supabase = await context(req, res, 'create', 10, { selling: true }); if (!supabase) return;
                const input = await body(req); const token = input.status_token; const key = req.headers?.['idempotency-key'] ?? input.idempotency_key;
                const definition = Object.hasOwn(PRODUCTS, input.product_id) ? PRODUCTS[input.product_id] : null;
                const username = typeof input.username === 'string' ? input.username.trim().replace(/^@/, '').toLowerCase() : '';
                const stars = input.product_id === 'stars';
                if (!definition || !USERNAME.test(username)
                    || (stars ? !Number.isSafeInteger(input.stars_quantity) || input.stars_quantity < 50 || input.stars_quantity > 1000000 : input.stars_quantity != null)
                    || !Number.isSafeInteger(input.expected_total_minor) || input.expected_total_minor < 1
                    || !Number.isSafeInteger(input.price_version) || input.price_version < 1
                    || !UUID.test(input.quote_id || '') || typeof token !== 'string' || !TOKEN.test(token) || typeof key !== 'string' || !IDEMPOTENCY.test(key)
                    || !gateway.channels().some((channel) => channel.id === input.channel)) throw invalid();
                const identity = gateway.identity(input.channel);
                const created = await rpc(supabase, 'fn_tg_create_purchase', {
                    p_quote_id: input.quote_id,
                    p_expected_product_key: input.product_id,
                    p_expected_username: username,
                    p_expected_total_minor: input.expected_total_minor,
                    p_expected_price_version: input.price_version,
                    p_expected_stars_quantity: stars ? input.stars_quantity : null,
                    p_status_token_hash: tokenHash(token),
                    p_idempotency_key_hash: tokenHash(key),
                    p_payment_channel: input.channel,
                    p_payment_provider: identity.provider,
                    p_payment_merchant_id: identity.merchant_id
                });
                if (created?.success !== true) return rpcError(created, res);
                const order = created.order;
                function sameOrder(candidate) {
                    return UUID.test(candidate?.id || '') && candidate.id === order.id && candidate.order_no === order.order_no
                        && candidate.quote_id === input.quote_id && candidate.payment_channel === input.channel
                        && candidate.payment_provider === identity.provider && candidate.payment_merchant_id === identity.merchant_id
                        && candidate.total_minor === order.total_minor && candidate.total_minor === input.expected_total_minor && candidate.currency === order.currency
                        && candidate.telegram_username === order.telegram_username && candidate.telegram_username === username
                        && candidate.product_family === order.product_family && candidate.product_family === definition[0]
                        && candidate.term_months === order.term_months && candidate.term_months === definition[1]
                        && candidate.price_version === input.price_version
                        && candidate.stars_quantity === order.stars_quantity && candidate.stars_quantity === (stars ? input.stars_quantity : null)
                        && !!safeOrder(candidate);
                }
                if (!order || !sameOrder(order)) throw new Error('Invalid TG purchase');
                let result = order;
                if (['awaiting_payment', 'checkout_creating'].includes(order.payment_status) && !order.checkout_url && !order.crypto_checkout) {
                    const lease = leaseTokenFactory();
                    const claimed = await rpc(supabase, 'fn_tg_claim_purchase_checkout', { p_purchase_id: order.id, p_lease_token: lease, p_lease_seconds: 120 });
                    if (claimed?.success === true && claimed.action === 'create') {
                        try {
                            if (!sameOrder(claimed.order) || claimed.order.payment_status !== 'checkout_creating') throw new Error('Invalid TG checkout claim');
                            const payment = await gateway.createPayment({ order: claimed.order, clientIp: requestSecurity.resolveClientIp(req, { env }), userAgent: req.headers?.['user-agent'] || '' });
                            const saved = payment.crypto_checkout
                                ? await rpc(supabase, 'fn_tg_save_purchase_crypto_checkout', { p_purchase_id: order.id, p_lease_token: lease, p_provider_trade_no: payment.provider_trade_no, p_crypto_checkout: payment.crypto_checkout })
                                : await rpc(supabase, 'fn_tg_save_purchase_checkout', { p_purchase_id: order.id, p_lease_token: lease, p_provider_trade_no: payment.provider_trade_no, p_checkout_url: payment.checkout_url });
                            if (saved?.success !== true) throw new Error('TG checkout result not saved');
                            result = saved.order;
                        } catch (_) {
                            // A timeout may have created a payable upstream order.
                            // Never issue a second create call for this purchase.
                            await rpc(supabase, 'fn_tg_fail_purchase_checkout', { p_purchase_id: order.id, p_lease_token: lease, p_error_code: 'payment_create_unconfirmed' });
                            const current = await rpc(supabase, 'fn_tg_purchase_status', { p_order_no: order.order_no, p_status_token_hash: tokenHash(token) });
                            if (current?.success !== true) throw new Error('TG purchase status not confirmed');
                            result = current.order;
                        }
                    } else if (claimed?.order) result = claimed.order;
                }
                const publicValue = safeOrder(result); if (!publicValue || !sameOrder(result)) throw new Error('Invalid TG purchase');
                return sendJson(res, 200, { success: true, existing: created.existing === true, order: publicValue, ...(created.existing === true ? {} : { status_token: token }) });
            } catch (caught) { return error(res, caught); }
        },
        async status(req, res) {
            if (!method(req, res, 'GET')) return;
            try {
                const supabase = await context(req, res, 'status', 60); if (!supabase) return;
                const orderNo = new URL(req.url || '/', 'https://tg.fatherkey.com').searchParams.get('order_no'); const token = req.headers?.['x-tg-status-token'];
                if (!ORDER_NO.test(orderNo || '') || typeof token !== 'string' || !TOKEN.test(token)) throw invalid('订单查询参数无效');
                const data = await rpc(supabase, 'fn_tg_purchase_status', { p_order_no: orderNo, p_status_token_hash: tokenHash(token) });
                if (data?.success !== true) return sendJson(res, 404, { success: false, code: 'not_found', message: '订单不存在或查询凭证无效' });
                const order = safeOrder(data.order); if (!order || order.order_no !== orderNo) throw new Error('Invalid TG purchase status');
                return sendJson(res, 200, { success: true, order });
            } catch (caught) { return error(res, caught); }
        },
        async webhookNowpayments(req, res) {
            if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return plain(res, 405, 'error'); }
            try {
                if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) return plain(res, 400, 'error');
                const { data: payload, exact } = await cryptoWebhookBody(req); const signature = req.headers?.['x-nowpayments-sig'];
                if (!gateway.verifyCryptoSignature(payload, signature)) return plain(res, 401, 'error');
                if (!ORDER_NO.test(payload.order_id || '') || !/^[0-9]{1,32}$/.test(exact.payment_id || '')) return plain(res, 400, 'error');
                // An authenticated progress notification is not payment proof.
                if (payload.payment_status !== 'finished') return plain(res, 200, 'success');
                const supabase = admin.getOptionalSupabaseAdmin?.(); if (!supabase) return plain(res, 503, 'error');
                const { data: order, error: lookupError } = await supabase.from('tg_purchase_orders')
                    .select('order_no,payment_provider,payment_channel,payment_merchant_id,provider_trade_no,total_minor,currency,crypto_checkout')
                    .eq('order_no', payload.order_id).maybeSingle();
                if (lookupError) return plain(res, 503, 'error');
                if (!order) return plain(res, 409, 'error');
                const verified = await gateway.verifyCryptoPayment({ payload, exact, order });
                if (!verified) return plain(res, 409, 'error');
                const data = await rpc(supabase, 'fn_tg_confirm_purchase_payment', { p_order_no: verified.order_no, p_provider: verified.provider, p_merchant_id: verified.merchant_id,
                    p_provider_trade_no: verified.provider_trade_no, p_payment_channel: verified.payment_channel, p_amount_minor: verified.amount_minor,
                    p_currency: verified.currency, p_verified_payload: verified.verified_payload });
                return plain(res, data?.success === true ? 200 : 409, data?.success === true ? 'success' : 'error');
            } catch (caught) { return plain(res, [400, 413].includes(caught?.statusCode) ? caught.statusCode : 503, 'error'); }
        },
        async webhook(req, res) {
            if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return plain(res, 405, 'error'); }
            try {
                const verified = gateway.verifyWebhook(await webhookPayload(req));
                if (!verified) return plain(res, 401, 'error');
                // Verification remains available after the sales switch closes.
                const supabase = admin.getOptionalSupabaseAdmin?.(); if (!supabase) return plain(res, 503, 'error');
                const data = await rpc(supabase, 'fn_tg_confirm_purchase_payment', { p_order_no: verified.order_no, p_provider: verified.provider, p_merchant_id: verified.merchant_id, p_provider_trade_no: verified.provider_trade_no, p_payment_channel: verified.payment_channel, p_amount_minor: verified.amount_minor, p_currency: verified.currency, p_verified_payload: verified.verified_payload });
                return plain(res, data?.success === true ? 200 : 409, data?.success === true ? 'success' : 'error');
            } catch (caught) { return plain(res, [400, 413].includes(caught?.statusCode) ? caught.statusCode : 503, 'error'); }
        }
    };
}
module.exports = { createTgPurchaseHandlers, _private: { safeOrder, productFields, webhookPayload } };
