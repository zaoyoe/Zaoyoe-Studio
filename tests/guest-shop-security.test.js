'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
    GuestShopSecurityError,
    assertIdempotencyFingerprint,
    buildGuestRequestFingerprint,
    buildHmacSignature,
    constantTimeEqual,
    currencyForSite,
    deriveClaimSecretFromIdempotencyKey,
    formatMoneyMinor,
    generateClaimSecret,
    getGuestClaimPepper,
    hashClaimSecret,
    hashIdempotencyKey,
    hashRawBody,
    isIdempotencyConflict,
    moneyMinorEqual,
    multiplyMoneyMinor,
    normalizeGuestIdempotencyKey,
    normalizeGuestOrderInput,
    normalizeGuestSite,
    normalizeUuid,
    parseMoneyMinor,
    readJsonBodyWithLimit,
    readRawBodyWithLimit,
    redactGuestPaymentPayload,
    sanitizeGuestLogContext,
    verifyClaimSecret,
    verifyHmacEnvelope,
    verifyPaymentBinding
} = require('../api/_lib/guest-shop/security');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SKU_ID = '22222222-2222-4222-8222-222222222222';
const PEPPER = 'guest-claim-pepper-0123456789-abcdefghijklmnopqrstuvwxyz';

function expectCode(callback, code) {
    assert.throws(callback, (error) => {
        assert.ok(error instanceof GuestShopSecurityError);
        assert.equal(error.code, code);
        return true;
    });
}

test('guest site and order input validation is strict and server-bindable', () => {
    assert.equal(normalizeGuestSite(' INTL '), 'intl');
    assert.equal(currencyForSite('cn'), 'CNY');
    assert.equal(currencyForSite('intl'), 'USD');
    expectCode(() => normalizeGuestSite('unknown'), 'unsupported_site');
    expectCode(() => normalizeGuestSite(''), 'required_site');
    expectCode(() => normalizeUuid('not-a-uuid'), 'invalid_uuid');
    expectCode(() => normalizeGuestIdempotencyKey('short'), 'invalid_length');
    expectCode(() => normalizeGuestIdempotencyKey('bad key with spaces-12345'), 'invalid_format');

    const normalized = normalizeGuestOrderInput({
        productId: PRODUCT_ID.toUpperCase(),
        skuId: SKU_ID,
        quantity: 1,
        site: 'CN',
        idempotencyKey: 'guest-order-00000001'
    }, { site: 'cn', quantityMax: 1 });
    assert.deepEqual(normalized, {
        productId: PRODUCT_ID,
        skuId: SKU_ID,
        quantity: 1,
        site: 'cn',
        currency: 'CNY',
        idempotencyKey: 'guest-order-00000001'
    });
    expectCode(() => normalizeGuestOrderInput({
        productId: PRODUCT_ID,
        skuId: SKU_ID,
        quantity: 2,
        site: 'cn',
        idempotencyKey: 'guest-order-00000002'
    }, { site: 'cn', quantityMax: 1 }), 'invalid_quantity');
    expectCode(() => normalizeGuestOrderInput({
        productId: PRODUCT_ID,
        skuId: SKU_ID,
        quantity: 1,
        site: 'cn',
        idempotencyKey: 'guest-order-00000003',
        amount: '0.01'
    }, { site: 'cn' }), 'client_controlled_field');
    expectCode(() => normalizeGuestOrderInput({
        productId: PRODUCT_ID,
        skuId: SKU_ID,
        quantity: 1,
        site: 'intl',
        idempotencyKey: 'guest-order-00000004'
    }, { site: 'cn' }), 'site_mismatch');
});

test('integer-cent money parser rejects floating point ambiguity and unsafe values', () => {
    assert.equal(parseMoneyMinor('0.1', { currency: 'CNY' }), 10);
    assert.equal(parseMoneyMinor('1.00', { currency: 'CNY' }), 100);
    assert.equal(parseMoneyMinor(12, { currency: 'USD' }), 1200);
    assert.equal(formatMoneyMinor(100, 'CNY'), '1.00');
    assert.equal(formatMoneyMinor(5, 'USD'), '0.05');
    assert.equal(multiplyMoneyMinor(125, 2), 250);
    assert.equal(moneyMinorEqual(10, '0.10', { currency: 'CNY' }), true);
    assert.equal(moneyMinorEqual(10, '0.100', { currency: 'CNY' }), false);
    assert.equal(moneyMinorEqual(10, '0.11', { currency: 'CNY' }), false);

    for (const value of ['1.005', '1e-2', '1E2', '-1', '+1', 'NaN', 'Infinity', '00.10']) {
        expectCode(() => parseMoneyMinor(value, { currency: 'CNY' }), 'invalid_amount');
    }
    expectCode(() => parseMoneyMinor(1.005, { currency: 'CNY' }), 'invalid_amount');
    expectCode(() => parseMoneyMinor('900719925474099.99', { currency: 'CNY' }), 'amount_out_of_range');
    expectCode(() => parseMoneyMinor('0.00', { currency: 'CNY' }), 'invalid_amount');
    expectCode(() => formatMoneyMinor(-1, 'CNY'), 'invalid_amount');
    expectCode(() => multiplyMoneyMinor(100, 0), 'invalid_quantity');
});

test('idempotency hashes and request fingerprints are stable but scoped', () => {
    const key = 'guest-order-00000099';
    assert.equal(hashIdempotencyKey(key, { site: 'cn' }), hashIdempotencyKey(key, { site: 'cn' }));
    assert.notEqual(hashIdempotencyKey(key, { site: 'cn' }), hashIdempotencyKey(key, { site: 'intl' }));

    const base = {
        site: 'cn',
        productId: PRODUCT_ID,
        skuId: SKU_ID,
        quantity: 1,
        currency: 'CNY',
        unitAmountMinor: 199,
        pricingVersion: 'v1'
    };
    const first = buildGuestRequestFingerprint(base);
    assert.equal(first, buildGuestRequestFingerprint({ ...base }));
    assert.notEqual(first, buildGuestRequestFingerprint({ ...base, quantity: 2 }));
    assert.notEqual(first, buildGuestRequestFingerprint({ ...base, skuId: '33333333-3333-4333-8333-333333333333' }));
    assert.notEqual(first, buildGuestRequestFingerprint({ ...base, unitAmountMinor: 200 }));
    assert.notEqual(first, buildGuestRequestFingerprint({ ...base, provider: 'zpay' }));
    assert.notEqual(
        buildGuestRequestFingerprint({ ...base, provider: 'zpay', channel: 'alipay' }),
        buildGuestRequestFingerprint({ ...base, provider: 'zpay', channel: 'wxpay' })
    );
    assert.equal(isIdempotencyConflict(first, first), false);
    assert.equal(isIdempotencyConflict(first, `${first.slice(0, -1)}0`), true);
    expectCode(() => assertIdempotencyFingerprint(first, `${first.slice(0, -1)}0`), 'idempotency_conflict');
});

test('claim secret is high entropy, peppered, versioned and timing-safe', () => {
    const one = generateClaimSecret();
    const two = generateClaimSecret();
    assert.match(one, /^[A-Za-z0-9_-]{40,200}$/);
    assert.notEqual(one, two);
    const hash = hashClaimSecret(one, { env: { GUEST_SHOP_CLAIM_PEPPER: PEPPER } });
    assert.match(hash, /^hmac-sha256:v1:[0-9a-f]{64}$/);
    assert.equal(hash.includes(one), false);
    assert.equal(verifyClaimSecret(one, hash, { env: { GUEST_SHOP_CLAIM_PEPPER: PEPPER } }), true);
    assert.equal(verifyClaimSecret(two, hash, { env: { GUEST_SHOP_CLAIM_PEPPER: PEPPER } }), false);
    assert.equal(verifyClaimSecret(one, `${hash}x`, { env: { GUEST_SHOP_CLAIM_PEPPER: PEPPER } }), false);
    assert.equal(verifyClaimSecret(one, hash, { env: { GUEST_SHOP_CLAIM_PEPPER: 'different-pepper-0123456789-abcdefghijklmnopqrstuvwxyz' } }), false);
    expectCode(() => getGuestClaimPepper({}), 'guest_claim_secret_unavailable');
    expectCode(() => getGuestClaimPepper({ GUEST_SHOP_CLAIM_PEPPER: 'too-short', SUPABASE_SERVICE_ROLE_KEY: 'service' }), 'guest_claim_secret_invalid');
    assert.equal(constantTimeEqual('same', 'same'), true);
    assert.equal(constantTimeEqual('same', 'different'), false);
    assert.equal(constantTimeEqual('same', 'same-longer'), false);
});

test('claim secret derivation is deterministic, site-scoped, and fail-closed', () => {
    const key = 'guest-order-deterministic-0001';
    const env = { GUEST_SHOP_CLAIM_DERIVATION_PEPPER: PEPPER };
    const first = deriveClaimSecretFromIdempotencyKey(key, { site: 'cn', env });
    const retry = deriveClaimSecretFromIdempotencyKey(key, { site: 'cn', env });
    assert.match(first, /^[A-Za-z0-9_-]{40,200}$/);
    assert.equal(first, retry);
    assert.notEqual(first, deriveClaimSecretFromIdempotencyKey(key, { site: 'intl', env }));
    assert.notEqual(first, deriveClaimSecretFromIdempotencyKey(`${key}-2`, { site: 'cn', env }));

    const claimHash = hashClaimSecret(first, { env: { GUEST_SHOP_CLAIM_PEPPER: PEPPER } });
    assert.equal(verifyClaimSecret(retry, claimHash, { env: { GUEST_SHOP_CLAIM_PEPPER: PEPPER } }), true);
    expectCode(() => deriveClaimSecretFromIdempotencyKey(key, { site: 'cn', env: {} }), 'guest_claim_secret_unavailable');
    expectCode(() => deriveClaimSecretFromIdempotencyKey(key, {
        site: 'cn',
        env: { GUEST_SHOP_CLAIM_DERIVATION_PEPPER: 'too-short' }
    }), 'guest_claim_secret_invalid');
    expectCode(() => deriveClaimSecretFromIdempotencyKey(key, {
        site: 'cn',
        env: {
            GUEST_SHOP_CLAIM_DERIVATION_PEPPER: PEPPER,
            SUPABASE_SERVICE_ROLE_KEY: PEPPER
        }
    }), 'guest_claim_secret_invalid');
});

test('webhook HMAC covers version, timestamp, nonce and exact raw body', () => {
    const rawBody = Buffer.from('{"order":"G-1","amount":"1.00"}', 'utf8');
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = 'nonce-0123456789';
    const signature = buildHmacSignature({
        secret: 'webhook-secret-012345678901234567890123',
        version: 'v1',
        timestamp,
        nonce,
        rawBody
    });
    assert.equal(hashRawBody(rawBody), crypto.createHash('sha256').update(rawBody).digest('hex'));
    assert.equal(verifyHmacEnvelope({
        secret: 'webhook-secret-012345678901234567890123',
        version: 'v1', timestamp, nonce, signature, rawBody
    }).valid, true);
    assert.equal(verifyHmacEnvelope({
        secret: 'webhook-secret-012345678901234567890123',
        version: 'v1', timestamp, nonce, signature, rawBody: Buffer.from(`${rawBody} `)
    }).valid, false);
    assert.equal(verifyHmacEnvelope({
        secret: 'webhook-secret-012345678901234567890123',
        version: 'v1', timestamp: timestamp - 1000, nonce, signature, rawBody
    }).code, 'timestamp_out_of_range');
    assert.equal(verifyHmacEnvelope({
        secret: 'webhook-secret-012345678901234567890123',
        version: 'v1', timestamp, nonce: 'short', signature, rawBody
    }).code, 'invalid_nonce');
    assert.equal(verifyHmacEnvelope({ timestamp, nonce, signature, rawBody }).code, 'missing_secret');
});

test('payment binding requires purpose, provider, site, currency, amount and final state', () => {
    const received = {
        merchant_order_no: 'G-1',
        provider: 'zpay',
        purpose: 'shop_direct',
        site: 'cn',
        currency: 'CNY',
        paid_amount: '1.00',
        status: 'paid'
    };
    assert.equal(verifyPaymentBinding({
        expectedMerchantOrderNo: 'G-1',
        expectedProvider: 'zpay',
        expectedSite: 'cn',
        expectedCurrency: 'CNY',
        expectedAmountMinor: 100,
        received
    }).valid, true);
    const mismatch = verifyPaymentBinding({
        expectedMerchantOrderNo: 'G-1', expectedProvider: 'zpay', expectedSite: 'cn',
        expectedCurrency: 'CNY', expectedAmountMinor: 100,
        received: { ...received, paid_amount: '0.99' }
    });
    assert.equal(mismatch.valid, false);
    assert.ok(mismatch.failures.includes('amount'));
});

test('bounded JSON reader rejects oversized, non-JSON and primitive bodies', async () => {
    const objectRequest = {
        headers: { 'content-type': 'application/json' },
        async *[Symbol.asyncIterator]() { yield Buffer.from('{"ok":true}'); }
    };
    assert.deepEqual(await readJsonBodyWithLimit(objectRequest, { requireContentType: true }), { ok: true });
    const rawResult = await readJsonBodyWithLimit({ body: '{"ok":true}', headers: {} }, { returnRaw: true });
    assert.equal(Buffer.isBuffer(rawResult.rawBody), true);
    assert.deepEqual(rawResult.body, { ok: true });
    await assert.rejects(
        () => readJsonBodyWithLimit({ body: 'x'.repeat(100), headers: {} }, { maxBytes: 10 }),
        (error) => error.code === 'payload_too_large' && error.statusCode === 413
    );
    await assert.rejects(
        () => readJsonBodyWithLimit({ body: '[1,2,3]', headers: { 'content-type': 'application/json' } }),
        (error) => error.code === 'invalid_json_object'
    );
    await assert.rejects(
        () => readJsonBodyWithLimit({ body: 'null', headers: { 'content-type': 'application/json' } }),
        (error) => error.code === 'invalid_json_object'
    );
    await assert.rejects(
        () => readJsonBodyWithLimit({ body: '{}', headers: { 'content-type': 'text/plain' } }, { requireContentType: true }),
        (error) => error.code === 'invalid_content_type' && error.statusCode === 415
    );
});

test('body readers fail closed for malformed or over-sized explicit limits', async () => {
    const request = { body: '{}', headers: {} };
    for (const value of [null, '', 'NaN', 'Infinity', '-1', '0', '1.5', '1e3', 0, -1, 1.5, 4 * 1024 * 1024 + 1]) {
        await assert.rejects(
            () => readRawBodyWithLimit(request, { maxBytes: value }),
            (error) => error instanceof GuestShopSecurityError
                && error.code === 'guest_body_limit_invalid'
                && error.statusCode === 500
                && error.expose === false
        );
        await assert.rejects(
            () => readJsonBodyWithLimit(request, { maxBytes: value }),
            (error) => error instanceof GuestShopSecurityError
                && error.code === 'guest_body_limit_invalid'
                && error.statusCode === 500
                && error.expose === false
        );
    }
    assert.deepEqual(await readJsonBodyWithLimit(request), {});
});

test('payment payload redaction removes secrets and does not mutate source', () => {
    const source = {
        merchant_order_no: 'G-1',
        authorization: 'Bearer very-secret-token',
        claim_secret: 'claim-secret-value',
        inventory_content: 'CARD-ABC-123',
        nested: {
            cookie: 'session=secret',
            api_key: 'sk-test-abcdefghijklmnop',
            safe: 'visible'
        },
        repeated: null
    };
    source.repeated = source.nested;
    const redacted = redactGuestPaymentPayload(source);
    assert.equal(redacted.authorization, '[REDACTED]');
    assert.equal(redacted.claim_secret, '[REDACTED]');
    assert.equal(redacted.inventory_content, '[REDACTED]');
    assert.equal(redacted.nested.cookie, '[REDACTED]');
    assert.equal(redacted.nested.api_key, '[REDACTED]');
    assert.equal(redacted.nested.safe, 'visible');
    assert.equal(source.nested.safe, 'visible');
    assert.equal(source.authorization, 'Bearer very-secret-token');
    assert.equal(sanitizeGuestLogContext({ token: 'secret', message: 'safe' }).token, '[REDACTED]');
});
