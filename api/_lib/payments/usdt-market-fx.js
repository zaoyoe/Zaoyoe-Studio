'use strict';

// TG, guest cash checkout and wallet recharge share this database snapshot.
// Read/verification of existing payments must never depend on live FX access.
const SOURCE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=cny&include_last_updated_at=true';
const WINDOW_MS = 5 * 60 * 1000;
const MAX_SOURCE_AGE_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function marketMode(env = process.env) {
    const mode = String(env.PAYMENT_USDT_FX_MODE || 'fixed');
    if (!['fixed', 'market'].includes(mode)) throw unavailable();
    return mode === 'market';
}
function unavailable(code = 'payment_fx_unavailable') {
    return Object.assign(new Error('USDT 市场汇率暂不可用，请稍后重试或选择其他支付方式'), { code, statusCode: 503 });
}
function safeSnapshot(value, { now = Date.now(), requireFresh = true } = {}) {
    if (!value || !UUID.test(value.id || '') || value.source !== 'coingecko:tether/cny'
        || typeof value.usdt_per_cny !== 'string' || !/^0\.\d{1,8}$/.test(value.usdt_per_cny)
        || Number(value.usdt_per_cny) < .05 || Number(value.usdt_per_cny) > .5
        || !Number.isFinite(Number(value.cny_per_usdt)) || Number(value.cny_per_usdt) < 2 || Number(value.cny_per_usdt) > 20) return null;
    const sourceAt = Date.parse(value.source_updated_at); const fetchedAt = Date.parse(value.fetched_at);
    const expiresAt = Date.parse(value.expires_at);
    if (![sourceAt, fetchedAt, expiresAt].every(Number.isFinite) || sourceAt > fetchedAt + 60000
        || fetchedAt - sourceAt > MAX_SOURCE_AGE_MS || expiresAt <= fetchedAt || expiresAt - fetchedAt > WINDOW_MS
        || (requireFresh && (sourceAt > now + 60000 || fetchedAt > now + 60000 || expiresAt <= now || now - sourceAt > MAX_SOURCE_AGE_MS))) return null;
    return { id: value.id, source: value.source, usdt_per_cny: value.usdt_per_cny,
        cny_per_usdt: String(value.cny_per_usdt), source_updated_at: value.source_updated_at,
        fetched_at: value.fetched_at, expires_at: value.expires_at };
}
async function database(supabase, name, args = {}) {
    try {
        if (!supabase?.rpc) throw unavailable('payment_fx_migration_required');
        const { data, error } = await supabase.rpc(name, args);
        if (error) throw unavailable(['PGRST202', '42883', '42P01'].includes(error.code) ? 'payment_fx_migration_required' : undefined);
        return data;
    } catch (error) { throw error?.code?.startsWith('payment_fx_') ? error : unavailable(); }
}
async function getMarketUsdtFx({ supabase, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    const stored = await database(supabase, 'fn_payment_usdt_fx_current');
    if (stored != null) {
        const snapshot = safeSnapshot(stored, { now: now() });
        if (!snapshot) throw unavailable();
        return snapshot;
    }
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetchImpl(SOURCE_URL, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
        if (!response.ok) throw unavailable();
        const raw = await response.text();
        if (Buffer.byteLength(raw) > 8192) throw unavailable();
        const ticker = JSON.parse(raw)?.tether;
        const price = ticker?.cny; const sourceAt = ticker?.last_updated_at;
        if (typeof price !== 'number' || !Number.isFinite(price) || price < 2 || price > 20
            || !Number.isSafeInteger(sourceAt) || sourceAt * 1000 > now() + 60000 || now() - sourceAt * 1000 > MAX_SOURCE_AGE_MS) throw unavailable();
        // Publish picks one immutable row for the UTC five-minute interval.
        // Concurrent instances always receive that same canonical database row.
        const published = await database(supabase, 'fn_payment_usdt_fx_publish', {
            p_cny_per_usdt: String(price), p_source_updated_at: new Date(sourceAt * 1000).toISOString()
        });
        const snapshot = safeSnapshot(published, { now: now() });
        if (!snapshot) throw unavailable();
        return snapshot;
    } catch (error) { throw error?.code?.startsWith('payment_fx_') ? error : unavailable(); }
    finally { clearTimeout(timer); }
}
function safeLockedQuote(value, totalMinor, quoteId) {
    const fx = safeSnapshot(value?.fx, { requireFresh: false });
    const pricing = require('../../../js/tg-payment-pricing');
    return fx && value.quote_id === quoteId && value.total_minor === totalMinor
        && pricing.cryptoAmountsEqual(value.usdt_pay_amount, pricing.usdtPayAmount(totalMinor, fx.usdt_per_cny))
        ? { quote_id: quoteId, total_minor: totalMinor, usdt_pay_amount: value.usdt_pay_amount, fx } : null;
}
function convertCnyMinorToUsdt(totalMinor, rate) {
    if (!Number.isSafeInteger(totalMinor) || totalMinor < 1 || typeof rate !== 'string'
        || !/^0\.\d{1,8}$/.test(rate) || Number(rate) < .05 || Number(rate) > .5) return null;
    const units = BigInt(rate.slice(2).padEnd(8, '0'));
    const cents = (BigInt(totalMinor) * units + 99999999n) / 100000000n;
    return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
module.exports = { marketMode, getMarketUsdtFx, safeSnapshot, safeLockedQuote, convertCnyMinorToUsdt, database, unavailable, SOURCE_URL, WINDOW_MS, MAX_SOURCE_AGE_MS };
