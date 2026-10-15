'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    GramixApiError,
    GramixConfigurationError,
    GramixClient,
    assertDecimalString,
    isDecimalString
} = require('../server/tg/gramix-client');

function response(status, payload, headers = {}) {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: { get(name) { return headers[String(name).toLowerCase()] || null; } },
        async json() { return payload; }
    };
}

function client(fetchImpl, options = {}) {
    return new GramixClient({
        apiKey: 'test-provider-key',
        baseUrl: 'https://provider.test/api/v1',
        fetchImpl,
        timeoutMs: 1000,
        ...options
    });
}

test('premium request validates duration, strips @, and sends provider idempotency key', async () => {
    const calls = [];
    const api = client(async (url, init) => {
        calls.push({ url, init });
        return response(201, { statusCode: 201, data: { orderId: 'provider-order-1', status: 'processing' } });
    });

    const result = await api.purchasePremium({
        recipientName: '@telegram_user',
        duration: 6,
        idempotencyKey: 'tg-order-provider-key-1'
    });

    assert.equal(result.data.orderId, 'provider-order-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://provider.test/api/v1/purchase/premium/6');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['x-api-key'], 'test-provider-key');
    assert.equal(calls[0].init.headers['idempotency-key'], 'tg-order-provider-key-1');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
        recipientName: 'telegram_user',
        paymentCurrency: 'usdt'
    });
});

test('premium request rejects unsupported durations and missing idempotency keys before fetch', async () => {
    let calls = 0;
    const api = client(async () => {
        calls += 1;
        return response(201, { statusCode: 201, data: {} });
    });

    await assert.rejects(
        api.purchasePremium({ recipientName: 'telegram_user', duration: 1, idempotencyKey: 'provider-key-123456' }),
        (error) => error instanceof GramixApiError && error.code === 'gramix_invalid_premium_duration'
    );
    await assert.rejects(
        api.purchasePremium({ recipientName: 'telegram_user', duration: 3 }),
        (error) => error instanceof GramixApiError && error.code === 'gramix_invalid_idempotency_key'
    );
    assert.equal(calls, 0);
});

test('both purchase methods default to USDT and use only an explicitly selected GRAM balance', async () => {
    const calls = [];
    const api = client(async (_url, init) => {
        calls.push(JSON.parse(init.body));
        return response(201, { statusCode: 201, data: {} });
    });
    await api.purchaseStars({ username: 'telegram_user', stars: 50, idempotencyKey: 'stars-default-usdt' });
    await api.purchasePremium({ username: 'telegram_user', duration: 3, paymentCurrency: 'gram', idempotencyKey: 'premium-explicit-gram' });
    assert.equal(calls[0].paymentCurrency, 'usdt');
    assert.equal(calls[1].paymentCurrency, 'gram');
});

test('balance accepts decimal strings and rejects floating point values', async () => {
    const api = client(async () => response(200, { statusCode: 200, data: { gram: '12.3400', usdt: '0.0000' } }));
    const balance = await api.getBalance();
    assert.equal(balance.data.gram, '12.3400');
    assert.equal(isDecimalString('0'), true);
    assert.equal(isDecimalString('01.2'), false);
    assert.equal(isDecimalString(12.34), false);
    assert.equal(assertDecimalString('9.00', 'wallet balance'), '9.00');
    assert.throws(() => assertDecimalString(9.00), /decimal string/);
});

test('HTTP and network failures are classified without exposing credentials', async () => {
    const api = client(async (_url, init) => {
        assert.equal(init.headers['x-api-key'], 'test-provider-key');
        return response(500, { message: 'upstream failed apiKey=secret-value', code: 'TEMPORARY' });
    });

    await assert.rejects(api.getOrder('f47ac10b-58cc-4372-a567-0e02b2c3d479'), (error) => {
        assert.equal(error.code, 'gramix_http_error');
        assert.equal(error.statusCode, 500);
        assert.equal(error.retryable, true);
        assert.equal(error.providerCode, undefined);
        assert.equal(error.message.includes('secret-value'), false);
        assert.equal(error.cause, undefined);
        return true;
    });

    const network = client(async () => { throw new Error('socket failed with x-api-key=secret-value'); });
    await assert.rejects(network.getOrder('f47ac10b-58cc-4372-a567-0e02b2c3d479'), (error) => {
        assert.equal(error.code, 'gramix_network_error');
        assert.equal(error.retryable, true);
        assert.equal(error.message.includes('secret-value'), false);
        return true;
    });
});

test('request timeout aborts the fetch and is retryable', async () => {
    let aborted = false;
    const api = client((_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
            aborted = true;
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
        });
    }), { timeoutMs: 250 });

    await assert.rejects(api.getOrder('f47ac10b-58cc-4372-a567-0e02b2c3d479'), (error) => error.code === 'gramix_timeout' && error.retryable === true);
    assert.equal(aborted, true);
});

test('configuration rejects insecure or ambiguous URLs and malformed API keys', () => {
    const fetchImpl = async () => { throw new Error('must not fetch'); };
    for (const baseUrl of [
        'http://provider.test/api/v1',
        'https://user:password@provider.test/api/v1',
        'https://provider.test/api/v1?key=secret',
        'https://provider.test/api/v1#fragment',
        `https://provider.test/${'a'.repeat(512)}`
    ]) assert.throws(() => client(fetchImpl, { baseUrl }), GramixConfigurationError);
    for (const apiKey of ['', 'key\r\nsecret', 'key\n', 'k'.repeat(513)]) {
        assert.throws(() => client(fetchImpl, { apiKey, env: {} }), GramixConfigurationError);
    }
});

test('requests prohibit redirects so provider API credentials cannot follow another origin', async () => {
    const api = client(async (_url, init) => {
        assert.equal(init.redirect, 'error');
        throw new TypeError('redirect rejected, x-api-key=private-key');
    });
    await assert.rejects(api.getBalance(), (error) => {
        assert.equal(error.code, 'gramix_network_error');
        assert.equal(error.message.includes('private-key'), false);
        return true;
    });
});

test('timeout also covers a stalled JSON response body', async () => {
    let signal;
    const api = client(async (_url, init) => {
        signal = init.signal;
        return { status: 200, ok: true, json: () => new Promise(() => {}) };
    }, { timeoutMs: 250 });
    await assert.rejects(api.getBalance(), (error) => error.code === 'gramix_timeout');
    assert.equal(signal.aborted, true);
});

test('deposit address is requested with an empty POST body and validated response', async () => {
    const api = client(async (url, init) => {
        assert.equal(url, 'https://provider.test/api/v1/wallets/balance');
        assert.equal(init.method, 'POST');
        assert.equal(init.body, undefined);
        assert.equal(init.headers['Content-Type'], undefined);
        return response(201, { statusCode: 201, data: { address: 'wallet-address', memo: 'memo' } });
    });
    assert.deepEqual((await api.createDeposit({ body: { amount: '100' } })).data, { address: 'wallet-address', memo: 'memo' });
});

test('Stars validates documented integer bounds and sends only official purchase fields', async () => {
    const calls = [];
    const api = client(async (url, init) => {
        calls.push({ url, init });
        return response(201, { statusCode: 201, data: { orderId: 'provider-order-id' } });
    });
    for (const stars of [49, 1_000_001, 50.5, '50', NaN]) {
        await assert.rejects(api.purchaseStars({ recipientName: 'telegram_user', stars, idempotencyKey: 'valid_key' }),
            (error) => error.code === 'gramix_invalid_stars_quantity');
    }
    assert.equal(calls.length, 0);
    for (const stars of [50, 1_000_000]) {
        await api.purchaseStars({ username: '@Telegram_User', stars, paymentCurrency: 'usdt', idempotencyKey: 'valid_key' });
        assert.equal(calls.at(-1).url, 'https://provider.test/api/v1/purchase/stars');
        assert.deepEqual(JSON.parse(calls.at(-1).init.body), { recipientName: 'telegram_user', paymentCurrency: 'usdt', stars });
    }
});

test('purchase idempotency keys accept 8 through 64 safe characters only', async () => {
    let calls = 0;
    const api = client(async () => {
        calls += 1;
        return response(201, { statusCode: 201, data: {} });
    });
    const purchase = (idempotencyKey) => api.purchasePremium({ recipientName: 'telegram_user', duration: 3, idempotencyKey });
    for (const key of ['a'.repeat(7), 'a'.repeat(65), 'unsafe key', 'unsafe/key', 'unsafe?key']) {
        await assert.rejects(purchase(key), (error) => error.code === 'gramix_invalid_idempotency_key');
    }
    assert.equal(calls, 0);
    await purchase('a'.repeat(8));
    await purchase(`A_-${'a'.repeat(61)}`);
    assert.equal(calls, 2);
});

test('unexpected successful HTTP status is not accepted as an order creation', async () => {
    const api = client(async () => response(202, { statusCode: 202, data: { orderId: 'provider-order-id' } }));
    await assert.rejects(api.purchasePremium({ recipientName: 'telegram_user', duration: 6, idempotencyKey: 'safe_key_123' }),
        (error) => error.code === 'gramix_invalid_response');
});
