'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { getPaymentProviderAdapter } = require('../api/_lib/payments/provider-adapters');
const { createPaymentRequest, __testUtils: { buildPaymentPricing } } = require('../api/_lib/payments/orders');
const { createPaymentsHandlers } = require('../server/api-handlers/public/payments');
const { _private: { resolveNowpaymentsAmountVerification } } = require('../api/_lib/payments/nowpayments-webhook');
const marketFx = require('../api/_lib/payments/usdt-market-fx');

function snapshot() {
    const now = Date.now();
    return { id: '41444444-4444-4444-8444-444444444444', source: 'coingecko:tether/cny',
        cny_per_usdt: '6.68000000', usdt_per_cny: '0.14970060',
        source_updated_at: new Date(now - 60000).toISOString(), fetched_at: new Date(now).toISOString(),
        expires_at: new Date(now + 240000).toISOString() };
}
const ENV = { PAYMENT_USDT_FX_MODE: 'market', APP_BASE_URL: 'https://www.fatherkey.com',
    NOWPAYMENTS_API_KEY: 'test-np-api-key', NOWPAYMENTS_IPN_SECRET: 'test-np-ipn-secret',
    PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'test-independent-custom-quote-secret' };
const CHANNEL = { enabled: true, cny_to_usd_rate: 0.1536, price_currency: 'usd', pay_currency: 'usdtbsc',
    is_fixed_rate: true, is_fee_paid_by_user: true, surcharge_rate: 0.01,
    ipn_callback_url: 'https://www.fatherkey.com/api/payments/nowpayments/webhook' };
const channelConfig = () => ({ active_provider: 'nowpayments', providers: {
    nowpayments: { ...CHANNEL }, zpay: { enabled: true, display_name: '支付宝' } } });
const paymentPayload = (changes = {}) => ({ payment_id: '5731943810', pay_address: `0x${'a'.repeat(40)}`,
    price_amount: '14.82', price_currency: 'usdtbsc', pay_currency: 'usdtbsc', pay_amount: '14.82',
    expiration_estimate_date: new Date(Date.now() + 1200000).toISOString(), ...changes });
const response = data => ({ ok: true, status: 200, text: async () => typeof data === 'string' ? data : JSON.stringify(data) });

async function withFetch(fetchImpl, run) {
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try { return await run(); } finally { globalThis.fetch = original; }
}

function runtime(fx = snapshot(), env = ENV) {
    return { env, channelConfig: { ...CHANNEL }, requestOrigin: ENV.APP_BASE_URL,
        secretValues: { nowpayments_api_key: ENV.NOWPAYMENTS_API_KEY, nowpayments_ipn_secret: ENV.NOWPAYMENTS_IPN_SECRET },
        supabase: { rpc: async name => { assert.equal(name, 'fn_payment_usdt_fx_current'); return { data: fx }; } } };
}
const checkout = context => getPaymentProviderAdapter('nowpayments').createCheckoutContext({ runtimeContext: context,
    paidAmount: 98.98, grantedPoints: 98, site: 'cn', checkoutSession: { id: 'checkout-1', session_key: 'session-1' } });

test('wallet uses the shared snapshot, charges the fee once and locks native USDT without repricing', async () => {
    const fx = snapshot(); const context = runtime(fx); const calls = [];
    const result = await withFetch(async (url, init) => {
        calls.push(url);
        const payload = JSON.parse(init.body);
        assert.equal(payload.price_amount, '14.82');
        assert.equal(payload.price_currency, 'usdtbsc');
        assert.equal(payload.pay_currency, 'usdtbsc');
        assert.equal(payload.is_fixed_rate, false);
        assert.equal(payload.is_fee_paid_by_user, false);
        return response(paymentPayload());
    }, () => checkout(context));
    assert.equal(calls.length, 1, 'must not refresh the provider estimate after locking the amount');
    assert.equal(result.summary.pay_amount_text, '14.82');
    assert.equal(result.summary.fx_snapshot_id, fx.id);
    assert.equal(result.providerMetadata.local_amount, 98.98);
    assert.equal(result.providerMetadata.fx_usdt_per_cny, fx.usdt_per_cny);
    assert.equal(result.providerMetadata.cny_to_usd_rate, Number(fx.usdt_per_cny));
    assert.equal(result.providerMetadata.is_fee_paid_by_user, false);
    assert.equal(result.summary.quote_expires_at, result.providerMetadata.quote_expires_at);
    assert.equal(context.channelConfig.cny_to_usd_rate, 0.1536, 'do not mutate stored channel config');
});

test('unavailable, stale or unapplied market data stops recharge before any gateway request', async () => {
    await withFetch(() => { throw Error('must not contact gateway or use fixed fallback'); }, async () => {
        for (const fx of [{ ...snapshot(), expires_at: new Date(0).toISOString() }, { ...snapshot(), usdt_per_cny: '0' }]) {
            await assert.rejects(checkout(runtime(fx)), { code: 'payment_fx_unavailable' });
        }
        const context = runtime(); context.supabase.rpc = async () => ({ error: { code: 'PGRST202' } });
        await assert.rejects(checkout(context), { code: 'payment_fx_migration_required' });
        const missing = runtime(null);
        await assert.rejects(withFetch(async url => {
            assert.equal(url, marketFx.SOURCE_URL);
            return { ok: false };
        }, () => checkout(missing)), { code: 'payment_fx_unavailable' });
    });
});

test('a changed preview snapshot rejects purchase instead of silently using a new price', async () => {
    await withFetch(() => { throw Error('must not create provider payment'); }, async () => {
        await assert.rejects(getPaymentProviderAdapter('nowpayments').createCheckoutContext({ runtimeContext: runtime(),
            paidAmount: 98.98, expectedFxSnapshotId: 'old-snapshot' }), { code: 'payment_fx_quote_expired', statusCode: 409 });
    });
});

test('market checkout rejects gateway double conversion, a second fee and atomic amount differences', async () => {
    const payloads = [paymentPayload({ pay_amount: '15.01' }), paymentPayload({ price_currency: 'usd' }),
        paymentPayload({ pay_currency: 'usdttrc20' }), paymentPayload({ price_amount: '14.81' }),
        '{"payment_id":"5731943810","price_currency":"usdtbsc","pay_currency":"usdtbsc","price_amount":14.82,"pay_amount":14.820000000000000001}'];
    for (const payload of payloads) await withFetch(async () => response(payload), async () => {
        await assert.rejects(checkout(runtime()), { code: 'payment_fx_quote_mismatch', statusCode: 502 });
    });
});

function databaseMock(fx = snapshot()) {
    const sessions = []; const orders = []; const rpcCalls = [];
    return { sessions, orders, rpcCalls,
        async rpc(name, args) {
            rpcCalls.push(name);
            if (name === 'fn_payment_usdt_fx_current') return { data: fx };
            if (name === 'fn_create_payment_checkout_session') {
                const row = { id: `session-${sessions.length + 1}`, ...args.p_payload }; sessions.push(row); return { data: row };
            }
            if (name === 'fn_update_payment_checkout_session') {
                const row = sessions.find(s => s.id === args.p_session_id); Object.assign(row, args.p_patch); return { data: row };
            }
            if (name === 'fn_create_pending_payment_order_for_checkout_session') {
                const row = { id: `payment-${orders.length + 1}`, ...args.p_payload }; orders.push(row); return { data: row };
            }
            throw Error(`unexpected RPC: ${name}`);
        },
        from(table) {
            const data = table === 'system_config' ? [
                { config_key: 'payment_channels', config_value: channelConfig() },
                { config_key: 'recharge_options', config_value: { custom_amount_enabled: true } }
            ] : table === 'points_packages' ? { id: 'pkg-98', name: '98元套餐', price_cny: 98, points_amount: 98, is_active: true }
                : table === 'admin_secret_store' ? null : undefined;
            assert.notEqual(data, undefined, `unexpected table: ${table}`);
            const query = { select() { return query; }, in() { return query; }, eq() { return query; },
                single() { return query; }, maybeSingle() { return query; }, limit() { return query; },
                then(resolve, reject) { return Promise.resolve({ data, error: null }).then(resolve, reject); } };
            return query;
        }
    };
}

for (const currency of ['usdtbsc', 'usdtton', 'usdtmatic', 'usdttrc20'])
for (const packagePurchase of [true, false]) test(`recharge ${currency} ${packagePurchase ? 'package' : 'custom amount'} persists the same FX and fee in session and order`, async () => {
    const fx = snapshot(); const db = databaseMock(fx);
    const result = await withFetch(async (url, init) => {
        assert.equal(url, 'https://api.nowpayments.io/v1/payment');
        assert.equal(JSON.parse(init.body).price_amount, '14.82');
        assert.equal(JSON.parse(init.body).pay_currency, currency);
        assert.equal(JSON.parse(init.body).price_currency, currency);
        return response(paymentPayload({ pay_currency: currency, price_currency: currency,
            pay_address: currency === 'usdtton' ? 'EQ' + 'a'.repeat(46) : currency === 'usdttrc20' ? 'T' + 'a'.repeat(33) : '0x' + 'a'.repeat(40),
            ...(currency === 'usdtton' ? { extra_id: '123456789' } : {}) }));
    }, () => createPaymentRequest({ supabase: db, user: { id: 'user-1' }, env: ENV, requestHost: 'www.fatherkey.com',
        body: { site: 'cn', provider_key: 'nowpayments', fx_snapshot_id: fx.id, pay_currency: currency,
            ...(packagePurchase ? { package_id: 'pkg-98' } : { points_amount: 98 }),
            paid_amount: 0.01, cny_to_usd_rate: 0.01 } }));
    assert.equal(result.success, true);
    assert.equal(result.points_amount, 98);
    assert.equal(result.base_amount, 98);
    assert.equal(result.payment_fee_amount, 0.98);
    assert.equal(result.paid_amount, 98.98);
    assert.equal(result.provider_summary.pay_amount_text, '14.82');
    for (const row of [db.sessions[0], db.orders[0]]) {
        assert.equal(row.provider_metadata.fx_snapshot_id, fx.id);
        assert.equal(row.provider_metadata.pay_amount_text, '14.82');
        assert.equal(row.provider_metadata.fx_mode, 'market');
        assert.equal(row.provider_metadata.pay_currency, currency);
        if (currency === 'usdtton') assert.equal(row.provider_metadata.payin_extra_id, '123456789');
        assert.equal(row.provider_metadata.payment_fee_amount, 0.98);
    }
});

test('wallet network selection survives repaint and is sent with the locked FX snapshot', async () => {
    const wallet = loadWallet();
    const networks = require('../api/_lib/payments/usdt-networks').NETWORKS;
    wallet.paymentChannelsConfig = wallet.normalizePaymentChannelsConfig({ providers: {
        nowpayments: { ...CHANNEL, fx_mode: 'market', fx_snapshot: snapshot(), networks } } });
    for (const { currency } of networks) {
        wallet.selectedUsdtNetwork = currency;
        assert.match(wallet.renderUsdtNetworkChoices(), new RegExp(`data-wallet-usdt-network="${currency}" aria-pressed="true"`));
        assert.equal((await wallet.getRechargeFxRequest('nowpayments')).pay_currency, currency);
        wallet.renderUsdtNetworkChoices();
        assert.equal(wallet.selectedUsdtNetwork, currency);
    }
});

test('native recharge settlement binds each network and Memo regardless of payout currency', () => {
    for (const currency of ['usdtbsc', 'usdtton', 'usdtmatic', 'usdttrc20']) {
        const metadata = { native_usdt: true, pay_currency: currency, price_currency: currency,
            pay_amount_text: '14.82', price_amount: 14.82, payment_id: '5731943810', payin_extra_id: '321' };
        const payload = paymentPayload({ pay_currency: currency, price_currency: currency, actually_paid: '14.82', extra_id: '321', outcome_currency: 'btc' });
        assert.equal(resolveNowpaymentsAmountVerification(metadata, payload).valid, true);
        for (const changes of [{ actually_paid: '14.81' }, { actually_paid: undefined }, { pay_currency: 'usdterc20' },
            { extra_id: '322' }, { extra_id: undefined }, { payin_extra_id: '322' }, { payment_id: '999' }]) {
            assert.equal(resolveNowpaymentsAmountVerification(metadata, { ...payload, ...changes }).valid, false);
        }
    }
});

function mockResponse() {
    return { headers: {}, status(code) { this.statusCode = code; return this; },
        setHeader(key, value) { this.headers[key.toLowerCase()] = value; return this; },
        end(body) { this.payload = JSON.parse(body); } };
}
function configHandler(db) {
    return createPaymentsHandlers({ env: { ...ENV, SUPABASE_SERVICE_ROLE_KEY: 'test-service-role' },
        admin: { getSupabaseAdmin: () => db, sendJson: (res, status, body) => res.status(status).end(JSON.stringify(body)) },
        requestSecurity: { takeRateLimitToken: async () => ({ allowed: true }), applyRateLimitHeaders() {}, resolveClientIp: () => 'local' },
        paymentProviders: { loadStoredPaymentConfigs: async () => ({ paymentChannels: channelConfig(), rechargeOptions: {} }),
            buildPublicPaymentConfig: (paymentChannels, rechargeOptions) => ({ paymentChannels, rechargeOptions }),
            buildPublicPaymentRuntime: runtime => runtime },
        paymentOrders: { getMockPaymentRuntimeState: () => ({ allowed: false }) }
    }).config;
}
const req = { method: 'GET', url: '/api/payments/config?site=cn', headers: { host: 'www.fatherkey.com' } };

test('wallet public preview uses the current shared FX even when configuration is cached', async () => {
    let fx = snapshot(); const handler = configHandler({ rpc: async () => ({ data: fx }) });
    const first = mockResponse(); await handler(req, first);
    assert.equal(first.payload.config.providers.nowpayments.fx_snapshot.id, fx.id);
    assert.equal(first.payload.config.providers.nowpayments.cny_to_usd_rate, Number(fx.usdt_per_cny));
    assert.equal(first.headers['cache-control'], 'no-store');
    fx = { ...snapshot(), id: '51444444-4444-4444-8444-444444444444', cny_per_usdt: '7.00000000', usdt_per_cny: '0.14285714' };
    const second = mockResponse(); await handler(req, second);
    assert.equal(second.headers['x-zaoyoe-cache'], 'hit');
    assert.equal(second.payload.config.providers.nowpayments.fx_snapshot.id, fx.id);
    assert.equal(second.payload.config.providers.nowpayments.cny_to_usd_rate, Number(fx.usdt_per_cny));
});

test('FX failure clears the fixed public estimate without breaking Alipay or wallet configuration', async () => {
    const handler = configHandler({ rpc: async () => ({ error: { code: 'PGRST202' } }) });
    const res = mockResponse(); await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.config.providers.zpay.enabled, true);
    assert.equal(res.payload.config.providers.nowpayments.fx_mode, 'market');
    assert.equal(res.payload.config.providers.nowpayments.cny_to_usd_rate, null);
    assert.equal(res.payload.config.providers.nowpayments.fx_snapshot, null);
});

test('an FX failure never contaminates cached config or the next successful preview', async () => {
    let unavailable = true;
    const fx = snapshot();
    const handler = configHandler({ rpc: async () => unavailable
        ? ({ error: { code: 'PGRST202' } }) : ({ data: fx }) });
    const failed = mockResponse(); await handler(req, failed);
    assert.equal(failed.payload.config.providers.nowpayments.fx_error, 'payment_fx_migration_required');
    assert.equal(failed.payload.config.providers.nowpayments.fx_snapshot, null);
    unavailable = false;
    const recovered = mockResponse(); await handler(req, recovered);
    assert.equal(recovered.headers['x-zaoyoe-cache'], 'hit');
    assert.equal(recovered.payload.config.providers.nowpayments.fx_snapshot.id, fx.id);
    assert.equal(recovered.payload.config.providers.nowpayments.fx_error, undefined);
    assert.equal(failed.payload.config.providers.nowpayments.fx_snapshot, null);
    assert.equal(recovered.payload.config.providers.zpay.enabled, true);
});

test('market recharge verifies actual receipt against saved USDT, independently of expired FX and fixed settings', () => {
    const metadata = { fx_mode: 'market', fx_snapshot_id: snapshot().id, fx_expires_at: new Date(0).toISOString(),
        pay_amount_text: '14.82', pay_amount: 14.82, price_amount: 14.82, pay_currency: 'usdtbsc',
        price_currency: 'usdtbsc', payment_id: '5731943810' };
    const payload = paymentPayload({ actually_paid: '14.82' });
    assert.equal(resolveNowpaymentsAmountVerification(metadata, payload).valid, true);
    assert.equal(resolveNowpaymentsAmountVerification(metadata, { ...payload, actually_paid: '15' }).valid, true);
    for (const changes of [{ actually_paid: '14.819' }, { actually_paid: '14.81' }, { actually_paid: 0 },
        { actually_paid: undefined }, { payment_id: 'another' }, { pay_currency: 'usdttrc20' }, { price_currency: 'usd' }]) {
        assert.equal(resolveNowpaymentsAmountVerification(metadata, { ...payload, ...changes }).valid, false);
    }
});

function loadWallet() {
    const node = { sheet: {}, addEventListener() {}, getAttribute: () => '', style: {} };
    const document = { getElementById: () => node, createElement: () => ({ ...node }),
        head: { appendChild() {} }, addEventListener() {}, querySelector: () => null };
    const window = { supabaseClient: {}, addEventListener() {}, location: { origin: ENV.APP_BASE_URL },
        sessionStorage: { getItem: () => null, setItem() {} } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/components/WalletModal.js'), 'utf8'), {
        window, document, console: { log() {}, warn() {}, error() {} },
        setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: fn => fn(), URL, Date
    });
    return window.WalletModal;
}

test('wallet preview matches server integer conversion, includes 1% once and never falls back on stale FX', async () => {
    const wallet = loadWallet(); const fx = snapshot();
    const provider = { ...CHANNEL, fx_mode: 'market', fx_snapshot: fx };
    for (const amount of [0.01, 1, 9.99, 98, 100, 50000]) {
        const pricing = buildPaymentPricing({ providerConfig: provider, baseAmount: amount });
        assert.equal(wallet.estimateUsdtPayableAmountText(pricing.payableAmount, provider),
            marketFx.convertCnyMinorToUsdt(Math.round(pricing.payableAmount * 100), fx.usdt_per_cny));
    }
    assert.equal(wallet.estimateUsdtPayableAmountText(98.98, provider), '14.82');
    assert.equal(wallet.estimateUsdtPayableAmountText(98.98, { ...provider, fx_snapshot: null }), '');
    assert.equal(wallet.estimateUsdtPayableAmountText(98.98, { ...provider,
        fx_snapshot: { ...fx, expires_at: new Date(0).toISOString() } }), '');
    wallet.paymentChannelsConfig = { providers: { nowpayments: provider } };
    assert.equal((await wallet.getRechargeFxRequest('nowpayments')).fx_snapshot_id, fx.id);
    let refreshed = 0;
    provider.fx_snapshot = { ...fx, expires_at: new Date(0).toISOString() };
    wallet.refreshRechargeFxPreview = async () => { refreshed++; provider.fx_snapshot = fx; };
    await assert.rejects(wallet.getRechargeFxRequest('nowpayments'), { code: 'payment_fx_quote_expired' });
    assert.equal(refreshed, 1);
    assert.equal((await wallet.getRechargeFxRequest('nowpayments')).fx_snapshot_id, fx.id);
});

test('a failed config request cannot recover a fixed estimate; a successful retry requires fresh confirmation', async () => {
    const wallet = loadWallet(); const fx = snapshot();
    wallet.paymentChannelsConfig = wallet.normalizePaymentChannelsConfig({ providers: {
        nowpayments: { ...CHANNEL, fx_mode: 'market', fx_snapshot: fx } } });
    wallet.getWalletSiteScope = () => 'cn';
    wallet.fetchPaymentConfigPayload = async () => { throw Error('configuration unavailable'); };
    wallet.loadSystemConfigValue = async key => key === 'payment_channels' ? channelConfig() : {};
    await wallet.loadPaymentRuntimeConfig(true);
    assert.equal(wallet.paymentChannelsConfig.providers.nowpayments.fx_mode, 'market');
    assert.equal(wallet.paymentChannelsConfig.providers.nowpayments.fx_preview_unavailable, true);
    assert.equal(wallet.estimateUsdtPayableAmountText(98.98, wallet.paymentChannelsConfig.providers.nowpayments), '');
    wallet.fetchPaymentConfigPayload = async () => ({ success: true, config: { providers: {
        nowpayments: { ...CHANNEL, fx_mode: 'market', fx_snapshot: fx } } }, runtime: {} });
    let renders = 0;
    wallet.renderSelectedRechargePaymentPanel = () => { renders++; };
    wallet.renderCustomRechargeSection = () => { renders++; };
    await assert.rejects(wallet.getRechargeFxRequest('nowpayments'), { code: 'payment_fx_quote_expired' });
    assert.equal(renders, 2);
    assert.equal(wallet.estimateUsdtPayableAmountText(98.98, wallet.paymentChannelsConfig.providers.nowpayments), '14.82');
    assert.equal((await wallet.getRechargeFxRequest('nowpayments')).fx_snapshot_id, fx.id);
});

test('background FX refresh updates a visible recharge preview before the next click', async () => {
    const wallet = loadWallet(); const fx = snapshot();
    wallet.isOpen = true;
    wallet.getWalletSiteScope = () => 'cn';
    wallet.fetchPaymentConfigPayload = async () => ({ success: true, config: { providers: {
        nowpayments: { ...CHANNEL, fx_mode: 'market', fx_snapshot: fx } } }, runtime: {} });
    let renders = 0;
    wallet.renderSelectedRechargePaymentPanel = () => { renders++; };
    wallet.renderCustomRechargeSection = () => { renders++; };
    await wallet.loadPaymentRuntimeConfig(true);
    assert.equal(renders, 2);
    assert.equal(wallet.estimateUsdtPayableAmountText(98.98, wallet.paymentChannelsConfig.providers.nowpayments), '14.82');
    assert.equal((await wallet.getRechargeFxRequest('nowpayments')).fx_snapshot_id, fx.id);
});

test('wallet separates payment selection from confirmation and restores its network', () => {
    const wallet = loadWallet();
    wallet.paymentChannelsConfig = wallet.normalizePaymentChannelsConfig({ providers: {
        zpay: { enabled: true, channel: 'alipay' },
        nowpayments: { ...CHANNEL, fx_mode: 'market', fx_snapshot: snapshot(), networks: require('../api/_lib/payments/usdt-networks').NETWORKS }
    } });
    let markup = wallet.renderRechargePaymentMethodButtons({ baseAmount: 10 });
    assert.equal(wallet.selectedRechargeMethod, 'alipay');
    assert.match(markup, /data-wallet-action="select-recharge-method"/);
    assert.match(markup, /id="wallet-usdt-network-panel"[^>]*aria-hidden="true" inert/);
    assert.match(markup, /wallet-recharge-submit[\s\S]*data-wallet-action="pay-selected-recharge"[\s\S]*data-wallet-payment-method="alipay"/);
    wallet.selectedRechargeMethod = 'usdt';
    wallet.selectedUsdtNetwork = 'usdttrc20';
    markup = wallet.renderRechargePaymentMethodButtons({ action: 'custom-recharge', baseAmount: 10 });
    assert.match(markup, /id="wallet-usdt-network-panel"[^>]*is-expanded[^>]*aria-hidden="false"/);
    assert.match(markup, /wallet-recharge-submit[\s\S]*data-wallet-action="custom-recharge"[\s\S]*data-wallet-payment-method="usdt"/);
    for (const icon of ['bsc', 'ton', 'polygon', 'tron']) assert.ok(markup.includes(`/assets/tg-network-icons/${icon}.svg`));
    wallet.selectedRechargeMethod = 'alipay';
    wallet.renderRechargePaymentMethodButtons();
    wallet.selectedRechargeMethod = 'usdt';
    assert.match(wallet.renderRechargePaymentMethodButtons(), /data-wallet-usdt-network="usdttrc20" aria-pressed="true"/);
    assert.equal(wallet.selectedUsdtNetwork, 'usdttrc20');
    assert.match(wallet.renderRechargePaymentMethodButtons({ disabled: true }), /wallet-recharge-submit"\s+disabled/);
});

test('wallet keeps the default selection, method label and panel aligned with available networks', () => {
    const wallet = loadWallet();
    wallet.paymentChannelsConfig = wallet.normalizePaymentChannelsConfig({ providers: {
        zpay: { enabled: false },
        nowpayments: { ...CHANNEL, fx_mode: 'market', fx_snapshot: snapshot(), networks: [
            { currency: 'usdtton', name: 'TON', code: 'TON' }
        ] }
    } });
    const markup = wallet.renderRechargePaymentMethodButtons({ baseAmount: 10 });
    assert.equal(wallet.selectedRechargeMethod, 'usdt');
    assert.equal(wallet.selectedUsdtNetwork, 'usdtton');
    assert.match(markup, /title="USDT · TON/);
    assert.match(markup, /id="wallet-usdt-network-panel"[^>]*is-expanded[^>]*aria-hidden="false"/);
    assert.match(markup, /data-wallet-usdt-network="usdtton" aria-pressed="true"/);
    assert.doesNotMatch(markup, /data-wallet-usdt-network="usdtbsc"/);
});
