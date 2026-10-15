'use strict';

const crypto = require('node:crypto');
const { buildNowpaymentsIpnSignature } = require('../../api/_lib/payments/nowpayments');
const CHANNEL = 'usdt_bep20';
const ORDER_NO = /^TGP-[A-Z0-9]{20}$/;
const PAYMENT_ID = /^[0-9]{1,32}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MERCHANT_ID = /^nowpayments:[a-f0-9]{64}$/;
const EXACT_FIELDS = new Set(['payment_id', 'id', 'price_amount', 'pay_amount', 'actually_paid']);
function unavailable() { return Object.assign(new Error('TG USDT 支付服务暂不可用，请稍后重试'), { code: 'tg_payment_provider_unconfirmed', statusCode: 503 }); }
function decimalUnits(value, precision = 18) {
    const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
    if (typeof text !== 'string' || !new RegExp(`^(?:0|[1-9]\\d{0,12})(?:\\.\\d{1,${precision}})?$`).test(text)) return null;
    const [major, fraction = ''] = text.split('.');
    const units = BigInt(major) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0'));
    return units > 0n ? units : null;
}
function decimalText(value) {
    if (decimalUnits(value) === null) return null;
    return String(value).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}
// JSON.parse rounds numeric tokens before a BigInt conversion. Keep the original
// top-level amount tokens separately; the unchanged parsed object is still used
// for NOWPayments' prescribed sorted-JSON HMAC canonicalization.
function parsePaymentJson(raw) {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 65536) throw unavailable();
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw unavailable();
    let position = 0; const exact = {}; const seen = new Set();
    const whitespace = () => { while (/\s/.test(raw[position] || '') && position < raw.length) position += 1; };
    function stringEnd(start) {
        let index = start + 1;
        while (index < raw.length) { if (raw[index] === '\\') index += 2; else if (raw[index++] === '"') return index; }
        throw unavailable();
    }
    whitespace(); if (raw[position++] !== '{') throw unavailable(); whitespace();
    while (raw[position] !== '}') {
        if (raw[position] !== '"') throw unavailable();
        const keyEnd = stringEnd(position); const key = JSON.parse(raw.slice(position, keyEnd)); position = keyEnd; whitespace();
        if (seen.has(key) || raw[position++] !== ':') throw unavailable(); seen.add(key); whitespace();
        const start = position; let depth = 0;
        while (position < raw.length) {
            const char = raw[position];
            if (char === '"') { position = stringEnd(position); continue; }
            if ((char === ',' || char === '}') && depth === 0) break;
            if (char === '{' || char === '[') depth += 1;
            else if (char === '}' || char === ']') depth -= 1;
            position += 1;
        }
        if (EXACT_FIELDS.has(key)) exact[key] = typeof data[key] === 'number' ? raw.slice(start, position).trim() : data[key];
        whitespace(); if (raw[position] === ',') { position += 1; whitespace(); } else if (raw[position] !== '}') throw unavailable();
    }
    return { data, exact };
}
function usdPriceMinor(totalMinor, rate) {
    const rateUnits = decimalUnits(rate, 8);
    if (!Number.isSafeInteger(totalMinor) || totalMinor < 1 || totalMinor > 100000000 || rateUnits === null || rateUnits >= 1000000000n) return null;
    const result = (BigInt(totalMinor) * rateUnits + 99999999n) / 100000000n;
    return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}
function cents(value) { return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`; }
function safeCryptoCheckout(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.pay_currency !== 'usdtbsc'
        || !ADDRESS.test(value.pay_address || '') || !PAYMENT_ID.test(value.payment_id || '')
        || !Number.isSafeInteger(value.price_amount_minor) || value.price_amount_minor < 1 || value.price_currency !== 'usd'
        || decimalText(value.pay_amount) !== value.pay_amount || !Number.isFinite(Date.parse(value.quote_expires_at))) return null;
    return { payment_id: value.payment_id, network: 'BSC (BEP20)', pay_currency: 'usdtbsc', pay_amount: value.pay_amount,
        pay_address: value.pay_address, quote_expires_at: value.quote_expires_at, price_currency: 'usd', price_amount_minor: value.price_amount_minor };
}
function createTgNowpaymentsGateway({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    function config() {
        const apiKey = String(env.TG_PURCHASE_NOWPAYMENTS_API_KEY || '');
        const ipnSecret = String(env.TG_PURCHASE_NOWPAYMENTS_IPN_SECRET || '');
        const rate = String(env.TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE || '');
        const forbidden = ['GRAMIX_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'CRON_SECRET', 'ADMIN_CONFIG_ENCRYPTION_KEY', 'ADMIN_STUDIO_ACCESS_SECRET', 'TG_WORKER_SECRET', 'TG_REDEMPTION_CODE_PEPPER', 'TG_REDEMPTION_CODE_ENCRYPTION_KEY', 'TG_PURCHASE_ZPAY_KEY'].map((name) => String(env[name] || '').trim()).filter(Boolean);
        if (![apiKey, ipnSecret].every((item) => item === item.trim() && item.length >= 16 && item.length <= 300 && !/[\r\n]/.test(item) && !forbidden.includes(item))
            || apiKey === ipnSecret || usdPriceMinor(100, rate) === null
            || (env.TG_PUBLIC_ORIGIN || 'https://tg.fatherkey.com') !== 'https://tg.fatherkey.com') throw unavailable();
        return { apiKey, ipnSecret, rate, merchantId: `nowpayments:${crypto.createHash('sha256').update(apiKey).digest('hex')}` };
    }
    async function request(path, payload, value) {
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
        try {
            const response = await fetchImpl(`https://api.nowpayments.io/v1/payment${path}`, { method: payload ? 'POST' : 'GET', redirect: 'error', signal: controller.signal,
                headers: { 'Content-Type': 'application/json', 'x-api-key': value.apiKey }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
            if (!response.ok) throw unavailable();
            return parsePaymentJson(await response.text());
        } catch (_) { throw unavailable(); } finally { clearTimeout(timer); }
    }
    function matches(payload, order, checkout, exact) {
        return payload?.order_id === order.order_no && exact?.payment_id === checkout.payment_id
            && payload.pay_currency === 'usdtbsc' && payload.price_currency === 'usd'
            && decimalUnits(exact?.price_amount, 2) === BigInt(checkout.price_amount_minor)
            && decimalUnits(exact?.pay_amount) === decimalUnits(checkout.pay_amount)
            && payload.pay_address === checkout.pay_address;
    }
    return {
        ready() { try { config(); return true; } catch (_) { return false; } },
        identity() { return { provider: 'nowpayments', merchant_id: config().merchantId }; },
        verifySignature(payload, signature) {
            try {
                if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !/^[a-fA-F0-9]{128}$/.test(signature || '')) return false;
                const expected = buildNowpaymentsIpnSignature(payload, config().ipnSecret);
                return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
            } catch (_) { return false; }
        },
        async createPayment({ order } = {}) {
            const value = config(); const priceMinor = usdPriceMinor(order?.total_minor, value.rate);
            if (!ORDER_NO.test(order?.order_no || '') || order.currency !== 'CNY' || priceMinor === null
                || order.payment_provider !== 'nowpayments' || order.payment_channel !== CHANNEL || order.payment_merchant_id !== value.merchantId) throw unavailable();
            let { data, exact } = await request('', { price_amount: cents(priceMinor), price_currency: 'usd', pay_currency: 'usdtbsc',
                order_id: order.order_no, order_description: order.product_family === 'telegram_stars' ? `Telegram Stars ${order.stars_quantity}` : `Telegram Premium ${order.term_months} months`,
                ipn_callback_url: 'https://tg.fatherkey.com/api/tg/purchase/webhooks/nowpayments', is_fixed_rate: true, is_fee_paid_by_user: true }, value);
            // The shop uses this official endpoint because create-payment can
            // omit its estimate deadline. Refresh this same payment once; never
            // create a replacement payment or invent a provider expiry.
            if (!Number.isFinite(Date.parse(data.expiration_estimate_date)) && PAYMENT_ID.test(exact.payment_id || '')) {
                const refreshed = await request(`/${exact.payment_id}/update-merchant-estimate`, {}, value);
                // The documented estimate response uses `id`; older responses
                // may use `payment_id`. Every supplied identity must agree.
                const refreshedId = refreshed.exact.id || refreshed.exact.payment_id;
                if (refreshedId !== exact.payment_id || ['id', 'payment_id'].some((key) => Object.hasOwn(refreshed.exact, key) && refreshed.exact[key] !== exact.payment_id)) throw unavailable();
                data = { ...data, ...refreshed.data }; exact = { ...exact, ...refreshed.exact };
            }
            const localExpiry = Date.parse(order.payment_expires_at || order.expires_at);
            const providerExpiry = Date.parse(data.expiration_estimate_date);
            if (!Number.isFinite(localExpiry) || !Number.isFinite(providerExpiry) || providerExpiry <= now()) throw unavailable();
            const expiry = Math.min(now() + 300000, localExpiry, providerExpiry);
            const checkout = safeCryptoCheckout({ payment_id: exact.payment_id, pay_currency: data.pay_currency, pay_amount: decimalText(exact.pay_amount), pay_address: data.pay_address,
                price_currency: 'usd', price_amount_minor: priceMinor, quote_expires_at: new Date(expiry).toISOString() });
            if (!checkout || expiry <= now() || !matches(data, order, checkout, exact) || !['waiting', 'confirming'].includes(data.payment_status)) throw unavailable();
            return { provider_trade_no: checkout.payment_id, crypto_checkout: checkout };
        },
        async verifyPayment({ payload, exact, order } = {}) {
            const value = config(); const checkout = safeCryptoCheckout(order?.crypto_checkout);
            if (!checkout || !ORDER_NO.test(order?.order_no || '') || order.payment_provider !== 'nowpayments' || order.payment_channel !== CHANNEL
                || order.payment_merchant_id !== value.merchantId || order.provider_trade_no !== checkout.payment_id || !matches(payload, order, checkout, exact)
                || payload.payment_status !== 'finished'
                || (Object.hasOwn(payload, 'actually_paid_currency') && payload.actually_paid_currency !== 'usdtbsc')
                || decimalUnits(exact?.actually_paid) === null || decimalUnits(exact?.actually_paid) < decimalUnits(checkout.pay_amount)) return null;
            const { data: canonical, exact: canonicalExact } = await request(`/${checkout.payment_id}`, null, value);
            if (!matches(canonical, order, checkout, canonicalExact) || canonical.payment_status !== 'finished'
                || (Object.hasOwn(canonical, 'actually_paid_currency') && canonical.actually_paid_currency !== 'usdtbsc')
                || decimalUnits(canonicalExact.actually_paid) === null || decimalUnits(canonicalExact.actually_paid) < decimalUnits(checkout.pay_amount)) return null;
            // Official IPN/GET examples omit actually_paid_currency: their
            // actually_paid is denominated in pay_currency. Both independently
            // authenticated records must match the saved usdtbsc payment and
            // report sufficient actually_paid; outcome_currency is payout only.
            return { order_no: order.order_no, provider: 'nowpayments', merchant_id: value.merchantId, provider_trade_no: checkout.payment_id,
                payment_channel: CHANNEL, amount_minor: order.total_minor, currency: 'CNY', verified_payload: { verified_by: 'signed_notify_and_query', event_status: 'paid',
                    price_currency: 'usd', price_amount_minor: checkout.price_amount_minor, pay_currency: 'usdtbsc', pay_amount: checkout.pay_amount,
                    pay_address: checkout.pay_address, actually_paid_currency: 'usdtbsc', actually_paid: decimalText(canonicalExact.actually_paid) } };
        }
    };
}
module.exports = { createTgNowpaymentsGateway, safeCryptoCheckout, usdPriceMinor, decimalUnits, parsePaymentJson, CHANNEL, MERCHANT_ID };
