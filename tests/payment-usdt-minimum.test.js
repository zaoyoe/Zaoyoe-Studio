const test = require('node:test');
const assert = require('node:assert/strict');
const { queryNowpaymentsMinimum, isNowpaymentsAmountTooSmall } = require('../api/_lib/payments/nowpayments');
const { createPaymentsHandlers } = require('../server/api-handlers/public/payments');

const API_KEY = 'test-server-only-api-key';
const config = (changes = {}) => ({ channelConfig: { pay_currency: 'usdtbsc', ...changes },
    secretValues: { nowpayments_api_key: API_KEY }, env: {} });
const response = (data, status = 200) => ({ ok: status === 200, status, text: async () => JSON.stringify(data) });

for (const [network, raw, amount] of [
    ['usdtbsc', 0.0873176, '0.09'], ['usdtton', '0.255286', '0.26'],
    ['usdtmatic', 0.233974, '0.24'], ['usdttrc20', 11.932878, '11.94'],
    ['usdtbsc', 0.09, '0.09'], ['usdtton', 0.090001, '0.1']
]) {
    test(`minimum for ${network} rounds ${raw} up to a payable ${amount} USDT`, async () => {
        const result = await queryNowpaymentsMinimum(config({ pay_currency: network }), {
            fetchImpl: async (url, init) => {
                const parsed = new URL(url);
                assert.equal(parsed.pathname, '/v1/min-amount');
                assert.equal(parsed.searchParams.get('currency_from'), network);
                assert.equal(parsed.searchParams.has('currency_to'), false, 'use the actual merchant payout routing');
                assert.equal(parsed.searchParams.get('is_fixed_rate'), 'false');
                assert.equal(parsed.searchParams.get('is_fee_paid_by_user'), 'false');
                assert.equal(init.method, 'GET');
                assert.equal(init.body, undefined);
                assert.equal(init.headers['x-api-key'], API_KEY);
                assert.ok(init.signal instanceof AbortSignal, 'read-only gateway request has a timeout');
                return response({ currency_from: network, min_amount: raw });
            }
        });
        assert.equal(result.amount, amount);
        assert.equal(result.network, network);
        assert.equal(result.currency, 'USDT');
        assert.equal(result.provider_min_amount, String(raw));
        assert.equal(JSON.stringify(result).includes(API_KEY), false);
    });
}

test('minimum honors configured fixed-rate and customer fee flags outside market mode', async () => {
    await queryNowpaymentsMinimum(config({ is_fixed_rate: true, is_fee_paid_by_user: true }), {
        fetchImpl: async url => {
            assert.equal(new URL(url).searchParams.get('is_fixed_rate'), 'true');
            assert.equal(new URL(url).searchParams.get('is_fee_paid_by_user'), 'true');
            return response({ currency_from: 'usdtbsc', min_amount: 0.2 });
        }
    });
});

test('missing, invalid, mismatched, rejected and unavailable minima never use a guessed fallback', async () => {
    for (const payload of [{}, { currency_from: 'usdtbsc', min_amount: 0 },
        { currency_from: 'usdtbsc', min_amount: -1 }, { currency_from: 'usdtbsc', min_amount: 'NaN' },
        { currency_from: 'usdtbsc', min_amount: true }, { currency_from: 'usdtton', min_amount: .1 }]) {
        await assert.rejects(queryNowpaymentsMinimum(config(), { fetchImpl: async () => response(payload) }), {
            code: 'payment_minimum_unavailable'
        });
    }
    await assert.rejects(queryNowpaymentsMinimum(config(), { fetchImpl: async () => response({ message: API_KEY }, 403) }),
        error => error.code === 'payment_minimum_unavailable' && !error.message.includes(API_KEY));
    await assert.rejects(queryNowpaymentsMinimum(config(), { fetchImpl: async () => { throw Error('socket reset'); } }),
        { code: 'payment_minimum_unavailable' });
    await assert.rejects(queryNowpaymentsMinimum({ env: {}, channelConfig: {} }, { fetchImpl: () => assert.fail('no credentials') }),
        { code: 'payment_minimum_unavailable' });
    await assert.rejects(queryNowpaymentsMinimum(config({ pay_currency: 'btc' }), { fetchImpl: () => assert.fail('unknown network') }),
        { code: 'payment_network_unsupported' });
});

test('both minimum and minimal provider errors are recognized without treating timeouts as a rejection', () => {
    for (const message of ['Crypto amount 0.01 is less than minimal', 'amountTo is too small',
        'amountFrom is too small', 'Amount is less than the minimum']) {
        assert.equal(isNowpaymentsAmountTooSmall(new Error(message)), true, message);
    }
    assert.equal(isNowpaymentsAmountTooSmall(new Error('socket timeout')), false);
});

function endpoint({ allowed = true, enabled = true, fail = false, env = {}, provider = {}, amount = '0.09', fx } = {}) {
    const calls = [];
    const handler = createPaymentsHandlers({
        admin: {
            getSupabaseAdmin: () => ({ rpc: async name => { assert.equal(name, 'fn_payment_usdt_fx_current'); return { data: fx }; } }),
            sendJson(res, status, payload) { res.status = status; res.body = payload; }
        },
        requestSecurity: {
            resolveClientIp: () => '192.0.2.10',
            takeRateLimitToken: async () => ({ allowed }),
            applyRateLimitHeaders() {}
        },
        paymentProviders: {
            loadStoredPaymentConfigs: async (_, { site }) => ({ paymentChannels: {
                providers: { nowpayments: { enabled, is_fixed_rate: true, is_fee_paid_by_user: true, site, ...provider } }
            } }),
            resolvePaymentProviderSecrets: async (_, provider, runtimeEnv, { site }) => ({
                nowpayments_api_key: { value: `${API_KEY}:${site}` }
            })
        },
        nowpaymentsMinimum: async options => {
            calls.push(options);
            if (fail) throw Error(API_KEY);
            return { network: options.channelConfig.pay_currency, network_name: 'BSC (BEP20)',
                currency: 'USDT', amount, provider_min_amount: '0.0873176' };
        },
        env
    }).minimum;
    return { calls, async request(url = '/api/payments/minimum?site=cn&channel=usdtbsc', method = 'GET') {
        const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; } };
        await handler({ url, method, headers: { host: 'localhost' } }, res);
        return res;
    } };
}

test('public minimum endpoint caches each site/network separately and exposes no credentials', async () => {
    const api = endpoint({ env: { PAYMENT_USDT_FX_MODE: 'market' } });
    const res = await api.request();
    assert.equal(res.status, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.body.minimum.amount, '0.09');
    assert.ok(Date.parse(res.body.minimum.expires_at) > Date.now());
    assert.equal(JSON.stringify(res.body).includes(API_KEY), false);
    assert.equal(api.calls[0].secretValues.nowpayments_api_key, `${API_KEY}:cn`);
    assert.equal(api.calls[0].channelConfig.is_fixed_rate, false);
    assert.equal(api.calls[0].channelConfig.is_fee_paid_by_user, false);
    await api.request();
    assert.equal(api.calls.length, 1);
    await api.request('/api/payments/minimum?site=cn&channel=usdtton');
    await api.request('/api/payments/minimum?site=intl&channel=usdtbsc');
    assert.equal(api.calls.length, 3);
    assert.equal(api.calls[2].secretValues.nowpayments_api_key, `${API_KEY}:intl`);
});

test('minimum endpoint respects method, network, rate and disabled-provider gates', async () => {
    const api = endpoint();
    assert.equal((await api.request(undefined, 'POST')).status, 405);
    assert.equal((await api.request('/api/payments/minimum?channel=btc')).status, 400);
    assert.equal(api.calls.length, 0);
    const limited = endpoint({ allowed: false });
    assert.equal((await limited.request()).status, 429);
    assert.equal(limited.calls.length, 0);
    const disabled = endpoint({ enabled: false });
    assert.equal((await disabled.request()).status, 503);
    assert.equal(disabled.calls.length, 0);
    const failed = endpoint({ fail: true });
    const res = await failed.request();
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'payment_minimum_unavailable');
    assert.equal(JSON.stringify(res.body).includes(API_KEY), false);
});

function fxSnapshot() {
    return { id: '41444444-4444-4444-8444-444444444444', source: 'coingecko:tether/cny',
        cny_per_usdt: '6.68000000', usdt_per_cny: '0.14970060',
        fetched_at: new Date().toISOString(), source_updated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 240000).toISOString() };
}
for (const network of ['usdtbsc', 'usdtton', 'usdtmatic', 'usdttrc20']) {
    for (const [cny, expected, below] of [['0.50', '0.08', true], ['0.60', '0.09', false], ['0.61', '0.10', false]]) {
        test(`minimum endpoint checks ${network} ${cny} CNY against the rounded native quote`, async () => {
            const fx = fxSnapshot();
            const api = endpoint({ env: {PAYMENT_USDT_FX_MODE: 'market'}, fx });
            const res = await api.request(`/api/payments/minimum?site=cn&channel=${network}&amount_cny=${cny}&fx_snapshot_id=${fx.id}`);
            assert.equal(res.status, 200);
            assert.deepEqual(res.body.check, { amount_cny: cny, pay_amount: expected, below_minimum: below, fx_snapshot_id: fx.id });
            assert.equal(api.calls.length, 1);
        });
    }
}

test('minimum check uses the fee-inclusive amount once and still checks each amount when the network limit is cached', async () => {
    const fx = fxSnapshot();
    const api = endpoint({ env: {PAYMENT_USDT_FX_MODE: 'market'}, fx, provider: {surcharge_rate: 0.01} });
    const first = await api.request('/api/payments/minimum?site=cn&channel=usdtbsc&amount_cny=98.98');
    const next = await api.request('/api/payments/minimum?site=cn&channel=usdtbsc&amount_cny=0.10');
    assert.equal(first.body.check.pay_amount, '14.82');
    assert.equal(next.body.check.pay_amount, '0.02');
    assert.equal(next.body.check.below_minimum, true);
    assert.equal(api.calls.length, 1, 'cache only minimum metadata, not previous order amount');
});

test('fixed minimum check preserves the configured rate alias', async () => {
    const api = endpoint({env: {PAYMENT_USDT_FX_MODE: 'fixed'}, provider: {cny_usd_rate: 0.2}});
    const res = await api.request('/api/payments/minimum?site=cn&channel=usdtbsc&amount_cny=10.00');
    assert.equal(res.status, 200);
    assert.equal(res.body.check.pay_amount, '2.00');
    assert.equal(res.body.check.fx_snapshot_id, undefined);
});

test('minimum checks reject stale expected FX and malformed amounts without a payment side effect', async () => {
    const api = endpoint({env: {PAYMENT_USDT_FX_MODE: 'market'}, fx: fxSnapshot()});
    const stale = await api.request('/api/payments/minimum?site=cn&channel=usdtbsc&amount_cny=1.00&fx_snapshot_id=old');
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'payment_fx_quote_expired');
    for (const amount of ['', '0', '-1', '0.001', 'NaN', 'Infinity', '1e2']) {
        const res = await api.request(`/api/payments/minimum?amount_cny=${amount}`);
        assert.equal(res.status, 400);
        assert.equal(res.body.code, 'payment_amount_invalid');
    }
});
