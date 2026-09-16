'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const guestShop = require('../server/api-handlers/public/guest-shop');
const worker = require('../server/guest-shop-worker');
const runtimeConfig = require('../api/_lib/guest-shop/runtime-config');

const {
    guestOrderTtlSeconds,
    guestRuntimeConfigError,
    guestWebhookLimits,
    normalizeGuestCashPrice,
    paymentCreationLeaseMs
} = guestShop._private;

function createResponse() {
    const state = { statusCode: 200, headers: {}, body: '' };
    return {
        setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; },
        status(code) { state.statusCode = code; return this; },
        end(body = '') { state.body = String(body); return this; },
        get statusCode() { return state.statusCode; },
        get payload() { return state.body ? JSON.parse(state.body) : null; }
    };
}

function assertConfigError(fn, code = 'guest_runtime_config_invalid') {
    assert.throws(fn, (error) => {
        assert.equal(error.code, code);
        assert.equal(error.statusCode, 503);
        assert.equal(error.expose, false);
        return true;
    });
}

test('guest runtime integer settings use defaults only when absent and reject coercion traps', () => {
    assert.equal(paymentCreationLeaseMs({}), 120000);
    assert.equal(paymentCreationLeaseMs({ GUEST_SHOP_PAYMENT_CREATE_LEASE_MS: '30000' }), 30000);
    assert.equal(paymentCreationLeaseMs({ GUEST_SHOP_PAYMENT_CREATE_LEASE_MS: '900000' }), 900000);
    assert.equal(guestOrderTtlSeconds({}), 1800);
    assert.equal(guestOrderTtlSeconds({ GUEST_SHOP_ORDER_TTL_SECONDS: '300' }), 300);
    assert.equal(guestOrderTtlSeconds({ GUEST_SHOP_ORDER_TTL_SECONDS: '7200' }), 7200);

    for (const value of ['NaN', 'Infinity', '-Infinity', '-1', '1.5', '1e3', '+120000', 'junk']) {
        assertConfigError(() => paymentCreationLeaseMs({ GUEST_SHOP_PAYMENT_CREATE_LEASE_MS: value }));
        assertConfigError(() => guestOrderTtlSeconds({ GUEST_SHOP_ORDER_TTL_SECONDS: value }));
    }
    assertConfigError(() => paymentCreationLeaseMs({ GUEST_SHOP_PAYMENT_CREATE_LEASE_MS: '29999' }));
    assertConfigError(() => paymentCreationLeaseMs({ GUEST_SHOP_PAYMENT_CREATE_LEASE_MS: '900001' }));
    assertConfigError(() => guestOrderTtlSeconds({ GUEST_SHOP_ORDER_TTL_SECONDS: '299' }));
    assertConfigError(() => guestOrderTtlSeconds({ GUEST_SHOP_ORDER_TTL_SECONDS: '7201' }));
});

test('guest webhook limits reject malformed values and preserve global >= ip invariant', () => {
    assert.deepEqual(guestWebhookLimits({}), { global: 1200, ip: 120 });
    assert.deepEqual(guestWebhookLimits({
        GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT: '100000',
        GUEST_SHOP_WEBHOOK_IP_LIMIT: '10000'
    }), { global: 100000, ip: 10000 });
    for (const [name, value] of [
        ['GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT', 'NaN'],
        ['GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT', 'Infinity'],
        ['GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT', '-1'],
        ['GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT', '1.5'],
        ['GUEST_SHOP_WEBHOOK_IP_LIMIT', 'NaN'],
        ['GUEST_SHOP_WEBHOOK_IP_LIMIT', 'Infinity'],
        ['GUEST_SHOP_WEBHOOK_IP_LIMIT', '-1'],
        ['GUEST_SHOP_WEBHOOK_IP_LIMIT', '1.5']
    ]) {
        assertConfigError(() => guestWebhookLimits({ [name]: value }));
    }
    assertConfigError(() => guestWebhookLimits({
        GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT: '10',
        GUEST_SHOP_WEBHOOK_IP_LIMIT: '11'
    }));
});

test('malformed webhook config fails before raw callback bytes are read', async () => {
    let bodyRead = false;
    const handlers = guestShop.createGuestShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() { return {}; },
            sendJson(res, status, payload) { res.status(status).end(JSON.stringify(payload)); }
        },
        requestSecurity: {
            async takeRateLimitToken() { return { allowed: true, remaining: 10, limit: 20, resetAt: Date.now() + 60000 }; },
            applyRateLimitHeaders() {},
            resolveClientIp() { return '198.51.100.10'; }
        },
        env: { APP_ENV: 'production', GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT: 'Infinity' }
    });
    const req = {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        query: {},
        async *[Symbol.asyncIterator]() {
            bodyRead = true;
            yield Buffer.from('out_trade_no=attacker');
        }
    };
    const res = createResponse();
    await handlers.webhook(req, res, 'zpay');
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, 'guest_runtime_config_invalid');
    assert.equal(bodyRead, false);
});

test('malformed order TTL fails before request body parsing or order RPC', async () => {
    let bodyRead = false;
    let rpcCalled = false;
    const handlers = guestShop.createGuestShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                return { rpc: async () => { rpcCalled = true; return { data: null, error: null }; } };
            },
            sendJson(res, status, payload) { res.status(status).end(JSON.stringify(payload)); }
        },
        requestSecurity: {
            async takeRateLimitToken() { return { allowed: true, remaining: 10, limit: 20, resetAt: Date.now() + 60000 }; },
            applyRateLimitHeaders() {},
            resolveClientIp() { return '198.51.100.10'; }
        },
        env: { APP_ENV: 'production', GUEST_SHOP_ORDER_TTL_SECONDS: '1.5' }
    });
    const req = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        query: {},
        async *[Symbol.asyncIterator]() {
            bodyRead = true;
            yield Buffer.from('{}');
        }
    };
    const res = createResponse();
    await handlers.orders(req, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, 'guest_runtime_config_invalid');
    assert.equal(bodyRead, false);
    assert.equal(rpcCalled, false);
});

test('guest cash price normalization rejects non-finite, sub-cent and out-of-range values', () => {
    const security = require('../api/_lib/guest-shop/security');
    assert.deepEqual(normalizeGuestCashPrice('1.00', security, 'CNY'), {
        minor: 100,
        amount: 1,
        text: '1.00'
    });
    for (const value of ['Infinity', '-1', '0', '0.001', '1.999', '1e3', '9999999999999.99']) {
        assert.equal(normalizeGuestCashPrice(value, security, 'CNY'), null, value);
    }
    assert.equal(normalizeGuestCashPrice('999999999999.99', security, 'CNY').minor, 99999999999999);
});

test('worker authorizes only dedicated secret and fails closed for weak production config', () => {
    const legacy = { APP_ENV: 'production', CRON_SECRET: 'x'.repeat(64) };
    assert.equal(worker.authorizeGuestShopWorkerRequest({ headers: { authorization: `Bearer ${legacy.CRON_SECRET}` } }, legacy).reason, 'worker_secret_not_configured');

    const weak = { APP_ENV: 'production', GUEST_SHOP_WORKER_SECRET: 'short-secret' };
    assert.equal(worker.authorizeGuestShopWorkerRequest({ headers: { authorization: 'Bearer short-secret' } }, weak).reason, 'worker_secret_invalid');

    const strong = { APP_ENV: 'production', GUEST_SHOP_WORKER_SECRET: 'worker-' + 'x'.repeat(64) };
    assert.equal(worker.authorizeGuestShopWorkerRequest({ headers: { 'x-guest-shop-worker-secret': strong.GUEST_SHOP_WORKER_SECRET } }, strong).ok, true);
});

test('worker numeric runtime settings reject malformed values instead of clamping', () => {
    assert.equal(worker.resolveWorkerConfig({}).batchSize, 20);
    assert.equal(worker.resolveWorkerConfig({ GUEST_SHOP_WORKER_BATCH_SIZE: '100' }).batchSize, 100);
    for (const [name, value] of [
        ['GUEST_SHOP_WORKER_BATCH_SIZE', 'Infinity'],
        ['GUEST_SHOP_WORKER_MAX_ATTEMPTS', '1.5'],
        ['GUEST_SHOP_WORKER_BASE_BACKOFF_MS', '-1'],
        ['GUEST_SHOP_WORKER_RETRY_JITTER_RATIO', 'NaN']
    ]) {
        assertConfigError(() => worker.resolveWorkerConfig({ [name]: value }), 'guest_worker_runtime_config_invalid');
    }
    assertConfigError(() => worker.resolveWorkerConfig({
        GUEST_SHOP_WORKER_BASE_BACKOFF_MS: '5000',
        GUEST_SHOP_WORKER_MAX_BACKOFF_MS: '1000'
    }), 'guest_worker_runtime_config_invalid');
});

test('stored checkout normalization does not serialize Infinity or unsafe fiat prices', () => {
    const security = require('../api/_lib/guest-shop/security');
    const handlers = guestShop.createGuestShopHandlers({ security, env: { APP_ENV: 'production' } });
    const build = handlers._private.buildStoredCheckout;
    const baseOrder = { total_amount: '1.00', currency: 'CNY' };
    const basePayment = {
        provider: 'nowpayments',
        channel: 'usdtbsc',
        provider_order_no: 'GS-1',
        provider_metadata: {
            provider: 'nowpayments',
            purpose: 'shop_direct',
            payment_id: 'np-1',
            pay_address: '0xabc',
            pay_amount: 1.23,
            pay_amount_text: '1.23',
            pay_currency: 'usdtbsc',
            price_amount: 1,
            price_currency: 'usd'
        },
        checkout_reference: 'np-1',
        merchant_order_no: 'GS-1'
    };
    assert.equal(build(baseOrder, basePayment).price_amount, 1);
    const usdOrder = { total_amount: '1.00', currency: 'USD' };
    assert.equal(build(usdOrder, basePayment), null);
    assert.equal(build(baseOrder, {
        ...basePayment,
        provider_metadata: { ...basePayment.provider_metadata, pay_amount: 'Infinity' }
    }), null);
});

test('runtime config error helper is non-exposing', () => {
    const error = guestRuntimeConfigError('SECRET_NAME', 'range');
    assert.equal(error.code, 'guest_runtime_config_invalid');
    assert.equal(error.expose, false);
    assert.match(error.message, /SECRET_NAME/u);
});

test('shared runtime configuration parser is strict, bounded, and relation-aware', () => {
    const defaults = runtimeConfig.resolveGuestShopRuntimeConfig({});
    assert.equal(defaults.orderTtlSeconds, 1800);
    assert.equal(defaults.workerBatchSize, 20);
    assert.equal(defaults.workerRetryJitterRatio, 0.2);
    assert.equal(defaults.invalid, false);

    for (const [name, value] of [
        ['GUEST_SHOP_ORDER_TTL_SECONDS', 'NaN'],
        ['GUEST_SHOP_PAYMENT_CREATE_LEASE_MS', 'Infinity'],
        ['GUEST_SHOP_WORKER_BATCH_SIZE', '1e2'],
        ['GUEST_SHOP_WORKER_RETRY_JITTER_RATIO', '-0.1'],
        ['GUEST_SHOP_WORKER_RETRY_JITTER_RATIO', '0.51'],
        ['GUEST_SHOP_WORKER_BASE_BACKOFF_MS', '0'],
        ['GUEST_SHOP_WORKER_MAX_BACKOFF_MS', '1.5']
    ]) {
        const result = runtimeConfig.resolveGuestShopRuntimeConfig({ [name]: value });
        assert.equal(result.invalid, true, name);
        assert.ok(result.errors.some((entry) => entry.name === name), name);
        assert.doesNotMatch(JSON.stringify(result.errors), /NaN|Infinity|1e2|0\.51/u);
    }

    const inconsistent = runtimeConfig.resolveGuestShopRuntimeConfig({
        GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT: '10',
        GUEST_SHOP_WEBHOOK_IP_LIMIT: '11',
        GUEST_SHOP_WORKER_BASE_BACKOFF_MS: '5000',
        GUEST_SHOP_WORKER_MAX_BACKOFF_MS: '1000'
    });
    assert.equal(inconsistent.invalid, true);
    assert.ok(inconsistent.errors.some((entry) => entry.code === 'inconsistent_numeric_config'));
    assert.throws(
        () => runtimeConfig.assertGuestShopRuntimeConfig({ GUEST_SHOP_WORKER_BATCH_SIZE: 'NaN' }),
        (error) => error.code === 'guest_shop_runtime_config_invalid'
            && error.statusCode === 503
            && error.expose === false
    );
});
