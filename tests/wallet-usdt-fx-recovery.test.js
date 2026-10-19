'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/components/WalletModal.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const ID = '41444444-4444-4444-8444-444444444444';
const NEXT_ID = '51444444-4444-4444-8444-444444444444';
const response = payload => ({ ok: true, json: async () => payload });

function fixture() {
    let now = Date.parse('2026-10-18T12:00:00Z');
    let nextTimer = 0;
    const timers = new Map();
    const storage = new Map();
    const events = { window: new Map(), document: new Map() };
    const target = (key, extras = {}) => ({
        ...extras,
        addEventListener(type, handler) {
            if (!events[key].has(type)) events[key].set(type, new Set());
            events[key].get(type).add(handler);
        },
        removeEventListener(type, handler) { events[key].get(type)?.delete(handler); }
    });
    const elements = new Map();
    const makeElement = () => {
        const classes = new Set();
        return { value: '', textContent: '', className: '', children: [],
            setAttribute() {}, focus() {},
            classList: {add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name)},
            appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); },
            remove() { if (elements.get(this.id) === this) elements.delete(this.id); }
        };
    };
    const css = { sheet: {}, getAttribute: () => '', addEventListener() {} };
    const document = target('document', { visibilityState: 'visible',
        getElementById: id => id === 'wallet-modal-css' ? css : elements.get(id) || null,
        createElement: makeElement, body: makeElement(),
        querySelector: () => null, querySelectorAll: () => [] });
    const window = target('window', { supabaseClient: {}, location: { origin: 'https://www.fatherkey.com' },
        sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } });
    const paymentCalls = [];
    const PointsService = {createPaymentRequest: async input => { paymentCalls.push(input); return {mode: 'crypto_checkout', provider: 'nowpayments'}; }};
    window.PointsService = PointsService;
    let fetchImpl = async () => { throw Error('unexpected network request'); };
    vm.runInNewContext(source, { window, document, URL, URLSearchParams, AbortController, PointsService,
        Date: class extends Date { static now() { return now; } },
        console: { log() {}, warn() {}, error() {}, debug() {} },
        fetch: (...args) => fetchImpl(...args), requestAnimationFrame: callback => callback(),
        setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
        clearTimeout: id => timers.delete(id) });
    timers.clear();
    const wallet = window.WalletModal;
    wallet.getWalletSiteScope = () => 'cn';
    const renders = [];
    wallet.renderSelectedRechargePaymentPanel = () => renders.push('package');
    wallet.renderCustomRechargeSection = () => renders.push('custom');
    const snapshot = (ttl = 240000, id = ID) => ({ id, source: 'coingecko:tether/cny',
        usdt_per_cny: '0.14970060', cny_per_usdt: '6.68000000',
        fetched_at: new Date(now).toISOString(), expires_at: new Date(now + ttl).toISOString() });
    const payload = (fx = snapshot(), overrides = {}) => ({ success: true, config: { active_provider: 'zpay',
        providers: { zpay: { enabled: true, channel: 'alipay' }, nowpayments: {
            enabled: true, fx_mode: 'market', fx_snapshot: fx, surcharge_rate: 0.01, ...overrides } } },
        runtime: { mock_payment: { allowed: false } }, recharge_options: {} });
    const emit = async (key, type) => {
        for (const handler of events[key].get(type) || []) handler();
        await settle();
    };
    const runNext = async () => {
        const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        assert.ok(entry, 'expected an automatic refresh or retry');
        timers.delete(entry[0]); now = entry[1].at;
        entry[1].callback(); await settle();
    };
    return { wallet, document, timers, storage, events, renders, snapshot, payload, emit, runNext, elements, makeElement, paymentCalls,
        now: () => now, advance: ms => { now += ms; }, setFetch: implementation => { fetchImpl = implementation; } };
}

test('a failed background refresh preserves an unexpired authoritative market quote', async () => {
    const f = fixture(); const { wallet } = f;
    wallet.applyPaymentConfigPayload(f.payload());
    wallet.isOpen = true;
    wallet.fetchPaymentConfigPayload = async () => { throw Error('temporary network failure'); };
    wallet.loadSystemConfigValue = async () => { throw Error('must not replace authoritative config'); };
    await wallet.loadPaymentRuntimeConfig(true);
    const provider = wallet.paymentChannelsConfig.providers.nowpayments;
    assert.equal(provider.fx_snapshot?.id, ID);
    assert.equal(wallet.estimateUsdtPayableAmountText(98.98, provider), '14.82');
    assert.equal((await wallet.getRechargeFxRequest('nowpayments')).fx_snapshot_id, ID);
    assert.equal(f.timers.size, 1, 'keep the next expiry refresh scheduled');
});

test('prefetch and foreground refresh share one request and cannot overwrite each other out of order', async () => {
    const f = fixture(); const { wallet } = f;
    let finish; let calls = 0;
    wallet.fetchPaymentConfigPayload = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
    const first = wallet.loadPaymentRuntimeConfig();
    const second = wallet.loadPaymentRuntimeConfig(true);
    assert.equal(calls, 1);
    finish(f.payload()); await Promise.all([first, second]);
    assert.equal(wallet.paymentChannelsConfig.providers.nowpayments.fx_snapshot.id, ID);
    assert.equal(wallet.paymentConfigRequest, null);
});

test('HTTP 200 with missing FX automatically retries and never caches an unavailable quote', async () => {
    const f = fixture(); const { wallet } = f;
    wallet.isOpen = true;
    let calls = 0;
    wallet.fetchPaymentConfigPayload = async () => ++calls === 1
        ? f.payload(null, { fx_error: 'payment_fx_unavailable' }) : f.payload();
    await wallet.loadPaymentRuntimeConfig(true);
    assert.equal(wallet.estimateUsdtPayableAmountText(98.98, wallet.paymentChannelsConfig.providers.nowpayments), '');
    assert.equal(f.storage.size, 0);
    await f.runNext();
    assert.equal(calls, 2);
    assert.equal(wallet.estimateUsdtPayableAmountText(98.98, wallet.paymentChannelsConfig.providers.nowpayments), '14.82');
    assert.equal(f.storage.size, 1);
    assert.deepEqual(f.renders.slice(-2), ['package', 'custom']);
});

test('an open wallet renews the five-minute window without a click and shows pending FX as loading', async () => {
    const f = fixture(); const { wallet } = f;
    wallet.isOpen = true;
    let calls = 0; let finish;
    wallet.fetchPaymentConfigPayload = async () => {
        calls++;
        if (calls === 1) return f.payload(f.snapshot(1500));
        return new Promise(resolve => { finish = resolve; });
    };
    await wallet.loadPaymentRuntimeConfig(true);
    await f.runNext();
    assert.equal(calls, 2);
    assert.equal(wallet.estimateUsdtPayableAmountText(98.98, wallet.paymentChannelsConfig.providers.nowpayments), '');
    assert.equal(wallet.getRechargePaymentMethods().find(method => method.key === 'usdt').sublabel, '汇率更新中…');
    finish(f.payload(f.snapshot(240000, NEXT_ID))); await settle();
    assert.equal(wallet.paymentChannelsConfig.providers.nowpayments.fx_snapshot.id, NEXT_ID);
    assert.equal(wallet.paymentConfigRequest, null);
    assert.equal(f.timers.size, 1, 'a returned snapshot schedules exactly one next renewal');
});

test('hidden tabs pause refresh and resuming renews expired FX; closing removes timers and listeners', async () => {
    const f = fixture(); const { wallet } = f;
    wallet.applyPaymentConfigPayload(f.payload(f.snapshot(1000)));
    wallet.isOpen = true;
    let calls = 0;
    wallet.fetchPaymentConfigPayload = async () => { calls++; return f.payload(f.snapshot(240000, NEXT_ID)); };
    wallet.startRechargeFxRefresh();
    wallet.startRechargeFxRefresh();
    assert.equal(f.events.document.get('visibilitychange').size, 1);
    assert.equal(f.timers.size, 1);
    f.document.visibilityState = 'hidden'; await f.emit('document', 'visibilitychange');
    assert.equal(f.timers.size, 0);
    f.advance(1500);
    f.document.visibilityState = 'visible';
    await f.emit('document', 'visibilitychange');
    assert.equal(calls, 1);
    assert.equal(wallet.paymentChannelsConfig.providers.nowpayments.fx_snapshot.id, NEXT_ID);
    wallet.stopRechargeFxRefresh(); wallet.isOpen = false;
    await f.emit('window', 'focus');
    assert.equal(calls, 1);
    assert.equal(f.timers.size, 0);
    assert.equal(f.events.document.get('visibilitychange').size, 0);
    assert.match(source, /close\(\) \{\s*this\.stopRechargeFxRefresh\(\);/);
});

test('a hung direct config request times out and uses the same-origin route', async () => {
    const f = fixture(); const calls = [];
    f.setFetch((url, options) => {
        calls.push({ url, cache: options.cache });
        if (url.startsWith('https://')) return new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
        });
        return Promise.resolve(response(f.payload()));
    });
    const pending = f.wallet.fetchPaymentConfigPayload('cn');
    await f.runNext();
    assert.equal((await pending).success, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, '/api/payments/config?site=cn');
    assert.ok(calls.every(call => call.cache === 'no-store'));
    assert.equal(f.timers.size, 0);
});

test('a transient partial response retains live FX only until its original expiry', () => {
    const f = fixture(); const { wallet } = f;
    wallet.applyPaymentConfigPayload(f.payload(f.snapshot(1000)));
    wallet.applyPaymentConfigPayload(f.payload(null, { fx_error: 'payment_fx_unavailable' }));
    assert.equal(wallet.estimateUsdtPayableAmountText(98.98, wallet.paymentChannelsConfig.providers.nowpayments), '14.82');
    f.advance(1001);
    assert.equal(wallet.estimateUsdtPayableAmountText(98.98, wallet.paymentChannelsConfig.providers.nowpayments), '');
    wallet.applyPaymentConfigPayload(f.payload(null, { enabled: false }));
    assert.equal(wallet.paymentChannelsConfig.providers.nowpayments.enabled, false);
    assert.equal(wallet.paymentChannelsConfig.providers.nowpayments.fx_snapshot, null);
});

test('genuine FX errors stay fail closed, retry with backoff and never submit a stale quote', async () => {
    const f = fixture(); const { wallet } = f;
    wallet.isOpen = true;
    let calls = 0;
    wallet.fetchPaymentConfigPayload = async () => { calls++; return f.payload(null, { fx_error: 'payment_fx_unavailable' }); };
    await wallet.loadPaymentRuntimeConfig(true);
    for (const expectedDelay of [2000, 4000, 8000, 16000, 30000, 30000]) {
        assert.equal([...f.timers.values()][0].at - f.now(), expectedDelay);
        await f.runNext();
    }
    await assert.rejects(wallet.getRechargeFxRequest('nowpayments'), { code: 'payment_fx_unavailable' });
    assert.ok(calls < 10);
    wallet.stopRechargeFxRefresh();
});

test('disabled and fixed-rate USDT do not create market polling timers', async () => {
    for (const overrides of [{ enabled: false }, { fx_mode: 'fixed' }]) {
        const f = fixture();
        f.wallet.isOpen = true;
        f.wallet.fetchPaymentConfigPayload = async () => f.payload(null, overrides);
        await f.wallet.loadPaymentRuntimeConfig(true);
        assert.equal(f.timers.size, 0);
    }
});


test('a response after the wallet closes never restarts its refresh loop', async () => {
    const f = fixture(); const { wallet } = f;
    let finish;
    wallet.isOpen = true;
    wallet.startRechargeFxRefresh();
    wallet.fetchPaymentConfigPayload = () => new Promise(resolve => { finish = resolve; });
    const pending = wallet.loadPaymentRuntimeConfig(true);
    wallet.stopRechargeFxRefresh(); wallet.isOpen = false;
    finish(f.payload()); await pending;
    assert.equal(f.timers.size, 0);
    assert.equal(wallet.paymentConfigRequest, null);
    assert.equal(f.renders.length, 0);
});

test('an explicit non-transient FX rejection cannot be hidden by a previous live quote', () => {
    const f = fixture(); const { wallet } = f;
    wallet.applyPaymentConfigPayload(f.payload());
    wallet.applyPaymentConfigPayload(f.payload(null, { fx_error: 'payment_fx_migration_required' }));
    assert.equal(wallet.getRechargeFxSnapshot(wallet.paymentChannelsConfig.providers.nowpayments), null);
    assert.equal(wallet.estimateUsdtPayableAmountText(98.98, wallet.paymentChannelsConfig.providers.nowpayments), '');
});

function rechargeMinimumFixture(network = 'usdtbsc') {
    const f = fixture(); const w = f.wallet;
    w.applyPaymentConfigPayload(f.payload());
    w.isOpen = true;
    w.lastOpenContext = {entry: 'wallet'};
    w.selectedRechargeMethod = 'usdt';
    w.selectedUsdtNetwork = network;
    w._packagesCache = [{id: 'package-low', name: 'Small', price_cny: 0.50}];
    w.selectedRechargePackage = {id: 'package-low'};
    w.setRechargeActionPendingState = state => { w.pendingRechargeAction = state; };
    w.tryPresentNowpaymentsCheckoutModal = () => true;
    w.rememberPendingCustomRechargeQuote = () => {};
    const errors = [];
    w.showToast = message => errors.push(message);
    const input = f.makeElement(); input.value = '0.50';
    f.elements.set('wallet-custom-recharge-input', input);
    w.clearSelectedRechargePackageForCustomInput = () => { w.selectedRechargePackage = null; };
    w.resolveCustomRechargeRequest = raw => ({ok: true, normalizedPoints: Number(raw), estimatedPaidAmount: Number(raw), inputMode: 'cny'});
    const respond = (url, {minimum = '0.09', payAmount = '0.08'} = {}) => {
        const parsed = new URL(url, 'https://www.fatherkey.com');
        assert.equal(parsed.pathname, '/api/payments/minimum');
        assert.equal(parsed.searchParams.get('channel'), network);
        assert.equal(parsed.searchParams.get('fx_snapshot_id'), ID);
        return response({success: true, site: 'cn', minimum: {network, currency: 'USDT', amount: minimum,
            expires_at: new Date(f.now() + 60000).toISOString()}, check: {
                amount_cny: parsed.searchParams.get('amount_cny'), pay_amount: payAmount,
                below_minimum: Number(payAmount) < Number(minimum), fx_snapshot_id: ID } });
    };
    return {...f, w, input, respond, errors, submit: kind => kind === 'package'
        ? w.buyPackage('package-low', 'Small', {paymentMethod: 'usdt'}) : w.customRecharge('usdt')};
}

for (const kind of ['package', 'custom']) for (const [network, minimum] of [['usdtbsc', '0.09'], ['usdtton', '0.26'], ['usdtmatic', '0.24'], ['usdttrc20', '11.93']]) {
    test(`wallet ${kind} ${network} below minimum uses a timed capsule and never creates a payment`, async () => {
        const f = rechargeMinimumFixture(network);
        f.setFetch(async (url, options) => {
            assert.equal(options.credentials, 'same-origin');
            assert.ok(options.signal instanceof AbortSignal);
            assert.equal(new URL(url, 'http://local').searchParams.get('amount_cny'), '0.51', 'include the 1% fee once');
            return f.respond(url, {minimum});
        });
        await f.submit(kind);
        assert.deepEqual(f.errors, []);
        const toast = f.elements.get('wallet-usdt-minimum-toast');
        assert.ok(toast?.textContent.includes(`最低支付 ${minimum} USDT`));
        assert.equal(f.paymentCalls.length, 0);
        assert.equal(f.w.pendingRechargeAction, null);
        await f.submit(kind);
        assert.equal([...f.timers.values()].filter(timer => timer.at === f.now() + 3600).length, 1);
        await f.runNext();
        assert.equal(f.elements.get('wallet-usdt-minimum-toast').classList.contains('wallet-toast--leaving'), true);
        await f.runNext();
        assert.equal(f.elements.has('wallet-usdt-minimum-toast'), false);
    });
}

for (const minimum of ['0.08', '0.07']) {
    test(`wallet minimum ${minimum} permits exactly one payment after a successful check`, async () => {
        const f = rechargeMinimumFixture();
        f.setFetch(async url => f.respond(url, {minimum}));
        await f.submit('package');
        assert.deepEqual(f.errors, []);
        assert.equal(f.paymentCalls.length, 1);
        assert.equal(f.paymentCalls[0].pay_currency, 'usdtbsc');
        assert.equal(f.paymentCalls[0].fx_snapshot_id, ID);
        assert.equal(f.elements.has('wallet-usdt-minimum-toast'), false);
    });
}

for (const change of ['network', 'amount', 'reopen']) {
    test(`wallet delayed minimum ignores a changed ${change} without creating or showing stale feedback`, async () => {
        const f = rechargeMinimumFixture();
        let finish; let query;
        f.setFetch(url => { query = url; return new Promise(resolve => { finish = resolve; }); });
        const pending = f.submit('custom'); await settle();
        assert.ok(finish);
        if (change === 'network') f.w.selectedUsdtNetwork = 'usdtton';
        if (change === 'amount') f.input.value = '1.00';
        if (change === 'reopen') f.w.lastOpenContext = {entry: 'wallet'};
        finish(f.respond(query)); await pending;
        assert.equal(f.paymentCalls.length, 0);
        assert.equal(f.elements.has('wallet-usdt-minimum-toast'), false);
        assert.equal(f.w.pendingRechargeAction, null);
    });
}
