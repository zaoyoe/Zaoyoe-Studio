'use strict';

// TG keeps its own configuration snapshot, order namespace and callback URLs.
// The merchant account may be shared with the shop; no wallet or shop RPC is used.
const crypto = require('node:crypto');
const { buildZpaySign, normalizeZpayDevice } = require('../../api/_lib/payments/zpay');
const { createTgNowpaymentsGateway, CHANNEL: CRYPTO_CHANNEL } = require('./nowpayments-gateway');
const { marketMode, getMarketUsdtFx } = require('../../api/_lib/payments/usdt-market-fx');
const { NETWORKS } = require('../../api/_lib/payments/usdt-networks');
const { webhookUrl } = require('./payment-urls');
const CHANNELS = new Set(['alipay', 'wxpay']);
const ALL_CHANNELS = new Set([...CHANNELS, CRYPTO_CHANNEL]);
const ORDER_NO = /^TGP-[A-Z0-9]{20}$/;
function failure(code = 'tg_payment_unavailable') { return Object.assign(new Error('TG 支付服务暂不可用，请稍后重试'), { code, statusCode: 503 }); }
function httpsUrl(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash ? url.href : null; } catch (_) { return null; }
}
function paymentCheckoutUrl(value) {
    const safe = httpsUrl(value);
    if (!safe || safe.length > 4096) return null;
    const url = new URL(safe);
    // A gateway home/download page or placeholder is not a payment credential.
    if (url.pathname === '/' || /(?:^|[-_/])(placeholder|loading|default|sample|demo|download)(?:[-_/.]|$)/i.test(url.pathname)
        || ['d.alipay.com', 'mobile.alipay.com'].includes(url.hostname)) return null;
    return safe;
}
function httpsOrigin(value) {
    const safe = httpsUrl(value);
    if (!safe) return null;
    const url = new URL(safe);
    return url.pathname === '/' && !url.search ? url.origin : null;
}
function amountMinor(value) {
    if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(value)) return null;
    const [major, decimal = ''] = value.split('.');
    const minor = BigInt(major) * 100n + BigInt(decimal.padEnd(2, '0'));
    return minor > 0n && minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}
function decimal(minor) { return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`; }
function createTgPaymentGateway({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    const nowpayments = createTgNowpaymentsGateway({ env, fetchImpl });
    function configuredChannels() {
        const channels = String(env.TG_PURCHASE_CHANNELS || 'alipay,wxpay').split(',').map((value) => value.trim());
        if (!channels.length || channels.some((value) => !ALL_CHANNELS.has(value)) || new Set(channels).size !== channels.length) throw failure('tg_payment_configuration_invalid');
        return channels;
    }
    function config() {
        const pid = String(env.TG_PURCHASE_ZPAY_PID || '').trim();
        const rawKey = String(env.TG_PURCHASE_ZPAY_KEY || '');
        const key = rawKey.trim();
        const base = httpsOrigin(String(env.TG_PURCHASE_ZPAY_API_BASE_URL || 'https://zpayz.cn').trim());
        const publicUrl = httpsOrigin(String(env.TG_PUBLIC_ORIGIN || 'https://tg.fatherkey.com').trim());
        const forbiddenSecrets = ['GRAMIX_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'CRON_SECRET', 'TG_WORKER_SECRET', 'TG_REDEMPTION_CODE_PEPPER', 'TG_REDEMPTION_CODE_ENCRYPTION_KEY'].map((name) => String(env[name] || '').trim()).filter(Boolean);
        if (!/^\d{1,32}$/.test(pid) || key.length < 16 || key.length > 200 || /[\r\n]/.test(rawKey) || forbiddenSecrets.includes(key)
            || !base || publicUrl !== 'https://tg.fatherkey.com') throw failure('tg_payment_configuration_invalid');
        const channels = configuredChannels().filter((value) => CHANNELS.has(value));
        if (!channels.length) throw failure('tg_payment_configuration_invalid');
        return { pid, key, base, origin: publicUrl, channels, notifyUrl: webhookUrl('zpay', env) };
    }
    async function request(url, payload) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
            const response = await fetchImpl(url, { method: payload ? 'POST' : 'GET', redirect: 'error', signal: controller.signal,
                ...(payload ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: new URLSearchParams(payload).toString() } : {}) });
            if (!response.ok) throw failure('tg_payment_provider_unconfirmed');
            // Provider payloads can contain URLs and error strings. Never log or
            // forward raw responses, and bound them before JSON parsing.
            const raw = await response.text();
            if (Buffer.byteLength(raw) > 65536) throw failure('tg_payment_provider_unconfirmed');
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure('tg_payment_provider_unconfirmed');
            return data;
        } catch (_) { throw failure('tg_payment_provider_unconfirmed'); } finally { clearTimeout(timer); }
    }
    async function queryPayment({ order } = {}) {
        const value = config();
        const savedTrade = order?.provider_trade_no;
        if (!ORDER_NO.test(order?.order_no || '') || order.payment_provider !== 'zpay' || order.payment_merchant_id !== value.pid
            || !CHANNELS.has(order.payment_channel) || (savedTrade != null && !/^[A-Za-z0-9_-]{1,128}$/.test(savedTrade))
            || order.currency !== 'CNY' || !Number.isSafeInteger(order.total_minor) || order.total_minor < 1) throw failure();
        // Only this authenticated, merchant-scoped read can reconcile ZPay's
        // checkout alias with the transaction identifier returned after payment.
        const query = new URLSearchParams({ act: 'order', pid: value.pid, key: value.key, out_trade_no: order.order_no });
        const data = await request(`${value.base}/api.php?${query}`, null);
        const trade = String(data.trade_no || '');
        if (Number(data.code) !== 1 || String(data.pid) !== value.pid || data.out_trade_no !== order.order_no
            || !/^[A-Za-z0-9_-]{1,128}$/.test(trade) || (savedTrade && savedTrade !== order.order_no && trade !== savedTrade)
            || data.type !== order.payment_channel || amountMinor(String(data.money)) !== order.total_minor
            || (data.currency != null && data.currency !== 'CNY') || ![0, 1, '0', '1'].includes(data.status)) throw failure('tg_payment_provider_unconfirmed');
        if (String(data.status) === '0') return null;
        return { order_no: order.order_no, provider: 'zpay', merchant_id: value.pid, provider_trade_no: trade,
            payment_channel: order.payment_channel, amount_minor: order.total_minor, currency: 'CNY',
            verified_payload: { verified_by: 'authenticated_query', event_status: 'paid', provider_order_no: order.order_no,
                merchant_id: value.pid, provider_trade_no: trade, payment_channel: order.payment_channel,
                amount_minor: order.total_minor, currency: 'CNY', checkout_trade_no: savedTrade ?? null } };
    }
    return {
        queryPayment,
        async assertCallbackReady() {
            const callback = new URL(webhookUrl('zpay', env));
            if (callback.origin === 'https://tg.fatherkey.com') return;
            const challenge = crypto.randomBytes(16).toString('hex');
            try {
                const response = await fetchImpl(`${callback.origin}/_tg-payment-health?challenge=${challenge}`, {
                    redirect: 'error', signal: AbortSignal.timeout(8000)
                });
                if (!response.ok) throw failure();
                const raw = await response.text();
                if (Buffer.byteLength(raw) > 2048) throw failure();
                const data = JSON.parse(raw);
                if (data.service !== 'tg-local-payment-relay' || data.status !== 'ok' || data.challenge !== challenge) throw failure();
            } catch (_) { throw failure('tg_payment_callback_unavailable'); }
        },
        resolveUsdtFx({ supabase } = {}) { return marketMode(env) ? getMarketUsdtFx({ supabase, fetchImpl }) : null; },
        usdtRate(options) { return nowpayments.quoteRate(options); },
        quotePayment({ channel, totalMinor, fxSnapshot } = {}) {
            if (channel !== CRYPTO_CHANNEL || !configuredChannels().includes(channel)) throw failure();
            return nowpayments.quotePayment({ totalMinor, fxSnapshot });
        },
        minimumPayment({ channel, payCurrency } = {}) {
            if (channel !== CRYPTO_CHANNEL || !configuredChannels().includes(channel)) throw failure();
            return nowpayments.minimumPayment({ payCurrency });
        },
        async canCancel({ order } = {}) {
            if (order?.payment_provider === 'nowpayments') return nowpayments.canCancel({ order });
            return await queryPayment({ order }) === null;
        },
        channels() {
            let selected; try { selected = configuredChannels(); } catch (_) { return []; }
            let zpay = []; try { zpay = config().channels; } catch (_) { /* Each configured provider fails closed independently. */ }
            return selected.filter((id) => id === CRYPTO_CHANNEL ? nowpayments.ready() : zpay.includes(id))
                .map((id) => ({ id, label: id === CRYPTO_CHANNEL ? 'USDT' : id === 'alipay' ? '支付宝' : '微信支付', ...(id === CRYPTO_CHANNEL ? { networks: NETWORKS } : {}) }));
        },
        identity(channel) { if (channel === CRYPTO_CHANNEL && configuredChannels().includes(channel)) return nowpayments.identity(); const value = config(); return { provider: 'zpay', merchant_id: value.pid }; },
        async createPayment({ order, clientIp = '127.0.0.1', userAgent = '', usdtQuote, payCurrency } = {}) {
            if (order?.payment_channel === CRYPTO_CHANNEL && configuredChannels().includes(CRYPTO_CHANNEL)) return nowpayments.createPayment({ order, usdtQuote, payCurrency });
            const value = config();
            if (!ORDER_NO.test(order?.order_no) || order.currency !== 'CNY' || !Number.isSafeInteger(order.total_minor) || order.total_minor < 1
                || !value.channels.includes(order.payment_channel) || order.payment_provider !== 'zpay' || order.payment_merchant_id !== value.pid) throw failure('tg_payment_order_invalid');
            const payload = { pid: value.pid, type: order.payment_channel, out_trade_no: order.order_no,
                notify_url: value.notifyUrl, return_url: `${value.origin}/?purchase_order=${order.order_no}`,
                name: order.product_family === 'telegram_stars' ? `Telegram Stars ${order.stars_quantity}` : `Telegram Premium ${order.term_months}个月`,
                money: decimal(order.total_minor), clientip: String(clientIp || '127.0.0.1').slice(0, 64), device: normalizeZpayDevice(userAgent), sign_type: 'MD5' };
            payload.sign = buildZpaySign(payload, value.key);
            const data = await request(`${value.base}/mapi.php`, payload);
            // Keep the order-specific QR payload in-page. Opening Alipay's QR
            // URL in a desktop browser can redirect to its app download site.
            const qrUrl = paymentCheckoutUrl(data.qrcode);
            const qrPayload = qrUrl && !/\.(?:apng|avif|gif|jpe?g|png|svg|webp)$/i.test(new URL(qrUrl).pathname) ? qrUrl : null;
            const checkoutUrl = qrPayload || paymentCheckoutUrl(data.payurl);
            const tradeNo = typeof data.trade_no === 'string' ? data.trade_no : '';
            if (Number(data.code) !== 1 || !checkoutUrl || !/^[A-Za-z0-9_-]{1,128}$/.test(tradeNo)) throw failure('tg_payment_provider_unconfirmed');
            return { checkout_url: checkoutUrl, provider_trade_no: tradeNo };
        },
        verifyCryptoSignature(payload, signature) { return nowpayments.verifySignature(payload, signature); },
        verifyCryptoPayment(options) { return nowpayments.verifyPayment(options); },
        verifyWebhook(payload) {
            const value = config();
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)
                || Object.keys(payload).length > 40 || Object.values(payload).some((item) => typeof item !== 'string' || item.length > 4096)) return null;
            if (payload.pid !== value.pid || payload.sign_type !== 'MD5' || !/^[a-fA-F0-9]{32}$/.test(payload.sign || '')
                || !ORDER_NO.test(payload.out_trade_no || '') || !CHANNELS.has(payload.type) || payload.trade_status !== 'TRADE_SUCCESS'
                || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.trade_no || '')) return null;
            const expected = Buffer.from(buildZpaySign(payload, value.key), 'hex');
            if (!crypto.timingSafeEqual(expected, Buffer.from(payload.sign, 'hex'))) return null;
            const minor = amountMinor(payload.money);
            if (minor === null || (payload.currency != null && payload.currency !== 'CNY')) return null;
            return { order_no: payload.out_trade_no, provider: 'zpay', merchant_id: value.pid, provider_trade_no: payload.trade_no,
                payment_channel: payload.type, amount_minor: minor, currency: 'CNY',
                verified_payload: { verified_by: 'signed_notify', event_status: 'paid' } };
        }
    };
}
module.exports = { createTgPaymentGateway, httpsUrl, paymentCheckoutUrl, amountMinor, decimal };
