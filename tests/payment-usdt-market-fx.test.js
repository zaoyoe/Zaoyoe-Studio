'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fx = require('../api/_lib/payments/usdt-market-fx');
const pricing = require('../js/tg-payment-pricing');
const NOW = Date.parse('2026-10-16T00:01:00Z');
const SNAPSHOT = Object.freeze({ id: '41444444-4444-4444-8444-444444444444', source: 'coingecko:tether/cny',
    cny_per_usdt: '6.68000000', usdt_per_cny: '0.14970060', source_updated_at: new Date(NOW - 60000).toISOString(),
    fetched_at: new Date(NOW).toISOString(), expires_at: new Date(NOW + 240000).toISOString() });
const response = (data, ok = true) => ({ ok, text: async () => JSON.stringify(data) });
const source = (changes = {}) => ({ tether: { cny: 6.68, last_updated_at: (NOW - 60000) / 1000, ...changes } });
const current = data => ({ rpc: async name => { assert.equal(name, 'fn_payment_usdt_fx_current'); return { data }; } });
const rejectsFx = promise => assert.rejects(promise, error => error.statusCode === 503 && error.code.startsWith('payment_fx_'));

test('market mode is explicit, shared and rejects unknown modes', () => {
    assert.equal(fx.marketMode({}), false);
    assert.equal(fx.marketMode({ PAYMENT_USDT_FX_MODE: 'market' }), true);
    for (const value of ['auto', 'false', ' market ', 'MARKET']) assert.throws(() => fx.marketMode({ PAYMENT_USDT_FX_MODE: value }));
});
test('a valid canonical database interval is reused without consulting the market or fixed settings', async () => {
    const snapshot = await fx.getMarketUsdtFx({ supabase: current(SNAPSHOT), now: () => NOW,
        fetchImpl: async () => { throw Error('must not fetch'); } });
    assert.deepEqual(snapshot, SNAPSHOT);
});
test('fresh market data is published once and the winning database row is canonical across instances', async () => {
    const calls = [];
    const supabase = { rpc: async (name, args) => { calls.push({ name, args }); return { data: name.endsWith('_current') ? null : SNAPSHOT }; } };
    // Simulate two API instances seeing different ticks in the same bucket.
    const results = await Promise.all([6.68, 6.69].map(price => fx.getMarketUsdtFx({ supabase, now: () => NOW,
        fetchImpl: async (url, options) => { assert.equal(url, fx.SOURCE_URL); assert.equal(options.redirect, 'error');
            assert.equal(options.headers['x-api-key'], undefined); assert.ok(options.signal); return response(source({ cny: price })); } })));
    assert.deepEqual(results, [SNAPSHOT, SNAPSHOT]);
    assert.deepEqual(calls.filter(call => call.name.endsWith('_publish')).map(call => call.args.p_cny_per_usdt), ['6.68', '6.69']);
});
test('rate expiry never reuses the old interval or silently falls back to a fixed rate', async () => {
    let requested = false;
    await rejectsFx(fx.getMarketUsdtFx({ supabase: current(SNAPSHOT), now: () => Date.parse(SNAPSHOT.expires_at),
        fetchImpl: async () => { requested = true; return response(source()); } }));
    assert.equal(requested, false);
    await rejectsFx(fx.getMarketUsdtFx({ supabase: current(null), now: () => NOW, fetchImpl: async () => { throw Error('network secret'); } }));
});
test('missing migrations and database failures stop before any market request', async () => {
    let requests = 0;
    for (const error of [{ code: 'PGRST202' }, { code: '42883' }, { code: '42P01' }, { message: 'private db detail' }]) {
        await rejectsFx(fx.getMarketUsdtFx({ supabase: { rpc: async () => ({ error }) }, now: () => NOW,
            fetchImpl: async () => { requests++; } }));
    }
    assert.equal(requests, 0);
});
test('malformed, stale, future and implausible market prices cannot be published', async () => {
    for (const changes of [{ cny: 0 }, { cny: -1 }, { cny: 1.9 }, { cny: 20.1 }, { cny: '6.68' },
        { cny: null }, { last_updated_at: (NOW - 600001) / 1000 }, { last_updated_at: (NOW + 61000) / 1000 }, { last_updated_at: null }]) {
        let publications = 0;
        await rejectsFx(fx.getMarketUsdtFx({ now: () => NOW,
            supabase: { rpc: async name => { if (name.endsWith('_publish')) publications++; return { data: null }; } },
            fetchImpl: async () => response(source(changes)) }));
        assert.equal(publications, 0);
    }
    for (const result of [response({}, false), { ok: true, text: async () => 'not json' }, { ok: true, text: async () => ' '.repeat(8193) }]) {
        await rejectsFx(fx.getMarketUsdtFx({ supabase: current(null), now: () => NOW, fetchImpl: async () => result }));
    }
});
test('invalid database snapshots are rejected even when the source fetch itself succeeded', async () => {
    for (const changes of [{ id: 'bad' }, { source: 'untrusted' }, { usdt_per_cny: '.15' }, { usdt_per_cny: '1e-1' },
        { usdt_per_cny: '0.50000001' }, { cny_per_usdt: '0' }, { expires_at: new Date(NOW).toISOString() },
        { expires_at: new Date(NOW + 301000).toISOString() }, { source_updated_at: new Date(NOW - 601000).toISOString() }]) {
        const supabase = { rpc: async name => ({ data: name.endsWith('_current') ? null : { ...SNAPSHOT, ...changes } }) };
        await rejectsFx(fx.getMarketUsdtFx({ supabase, now: () => NOW, fetchImpl: async () => response(source()) }));
    }
});
test('TG and guest cash checkout use the same integer conversion with one cent ceiling and one fee', () => {
    for (const subtotal of [1, 99, 100, 1234, 7000, 9800, 21800, 99000000]) {
        const total = pricing.breakdown(subtotal, 'usdt_bep20').total_minor;
        assert.equal(fx.convertCnyMinorToUsdt(total, SNAPSHOT.usdt_per_cny), pricing.usdtPayAmount(total, SNAPSHOT.usdt_per_cny));
    }
    assert.equal(fx.convertCnyMinorToUsdt(9898, SNAPSHOT.usdt_per_cny), '14.82');
    assert.equal(fx.convertCnyMinorToUsdt(99999999999999, '0.15000000'), '150000000000.00');
    for (const amount of [undefined, 0, -1, 1.1, '9898', Number.MAX_SAFE_INTEGER + 1]) assert.equal(fx.convertCnyMinorToUsdt(amount, SNAPSHOT.usdt_per_cny), null);
});
test('an accepted TG FX quote remains locked after market expiry, but altered identity or amounts fail', () => {
    const quoteId = '51555555-5555-4555-8555-555555555555';
    const frozen = { quote_id: quoteId, total_minor: 9898, usdt_pay_amount: '14.82', fx: SNAPSHOT };
    assert.deepEqual(fx.safeLockedQuote(frozen, 9898, quoteId), frozen);
    for (const changes of [{ quote_id: 'forged' }, { total_minor: 9899 }, { usdt_pay_amount: '14.820000000000000001' },
        { usdt_pay_amount: '14.81' }, { fx: { ...SNAPSHOT, usdt_per_cny: '0.16' } }]) assert.equal(fx.safeLockedQuote({ ...frozen, ...changes }, 9898, quoteId), null);
});
test('FX migration preserves existing quote/order guards and keeps snapshots immutable and service-only', () => {
    const sql = fs.readFileSync(require.resolve('../supabase/migrations/20261016_payment_usdt_market_fx.sql'), 'utf8');
    for (const fragment of ['ON CONFLICT (bucket_start) DO NOTHING', 'FOR UPDATE', 'ceil(v_quote.total_minor * v_fx.usdt_per_cny) / 100',
        'BEFORE UPDATE OR DELETE', 'ENABLE ROW LEVEL SECURITY', 'FROM PUBLIC, anon, authenticated, service_role',
        'REVOKE ALL ON FUNCTION', 'TO service_role', "interval '10 minutes'", "interval '5 minutes'", 'fn_tg_purchase_fx_quote']) assert.ok(sql.includes(fragment), fragment);
    assert.doesNotMatch(sql, /(?:UPDATE|ALTER TABLE|DELETE FROM) public\.(?:tg_purchase_orders|tg_purchase_quotes|system_config|shop_products)/);
    assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.(?:tg_guard_purchase_identity|fn_tg_confirm_purchase_payment)/);
});
