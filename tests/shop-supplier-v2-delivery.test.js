'use strict';
// In-memory protocol/crypto tests only. These are NOT database or merchant acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const delivery = require('../server/integrations/suppliers/delivery');
const INTENT = '11111111-1111-4111-8111-111111111111';
const UNIT = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const REQUEST = '44444444-4444-4444-8444-444444444444';
const ORDER = '55555555-5555-4555-8555-555555555555';
const USER = '66666666-6666-4666-8666-666666666666';
const PROOF = 'a'.repeat(64);
const EVIDENCE = 'b'.repeat(64);
const CONTENT = 'demo-test-card\n测试用完整内容';
const CONTEXT = { unitId: UNIT, intentId: INTENT, site: 'cn', orderNo: 'ORIGINAL-1' };
function environment() { return {
    SHOP_SUPPLIER_DELIVERY_V2_ENABLED: 'true',
    SHOP_SUPPLIER_DELIVERY_KEYS: JSON.stringify({ first: 'encryption-only-test-seed-'.repeat(3) }),
    SHOP_SUPPLIER_DELIVERY_ACTIVE_KEY: 'first',
    SHOP_SUPPLIER_DELIVERY_FINGERPRINT_KEY: 'fingerprint-only-test-seed-'.repeat(3)
}; }
function ticket() { return { ...CONTEXT, intentId: INTENT, account: { id: ACCOUNT, provider_id: 'test-provider',
    credential_ref: 'env:TEST_SUPPLIER' }, requestId: REQUEST, contractHash: delivery.CONTRACT_HASH, proofHash: PROOF }; }
function receipt(overrides = {}) { return { accountId: ACCOUNT, requestId: REQUEST, orderNo: CONTEXT.orderNo,
    outcome: 'delivered', completeDelivery: true, quantity: 1, finalCost: true,
    cost: { currency: 'CNY', amount: '12.340000' }, evidenceHash: EVIDENCE, content: CONTENT, ...overrides }; }
function fixture(options = {}) {
    const calls = [];
    const db = { async rpc(name, args) {
        calls.push({ name, args });
        if (name === 'fn_shop_supplier_delivery_ticket_v2') return { data: options.ticket || { status: 'ready', ticket: ticket() } };
        assert.equal(name, 'fn_shop_supplier_record_delivery_v2');
        if (options.recordError) throw new Error('merchant-private-secret');
        return { data: options.stored || { status: 'delivered', applied: true } };
    } };
    const adapter = { providerId: 'test-provider', capabilities: { deliveryQuery: true }, deliveryContract: { ...delivery.CONTRACT },
        async queryDelivery(input) { calls.push({ query: input }); if (options.queryError) throw new Error('merchant-private-secret');
            return options.raw === undefined ? receipt() : options.raw; },
        purchase() { assert.fail('delivery must never submit a purchase'); },
        refund() { assert.fail('delivery must never issue refunds'); }, ...options.adapter };
    const runner = delivery.createDeliveryRunner({ db, env: options.env || environment(), async resolveAdapter(account) {
        calls.push({ account }); return adapter;
    } });
    return { runner, calls };
}
function noSecret(error) {
    assert.doesNotMatch(`${error.message} ${JSON.stringify(error)}`, /merchant-private-secret|demo-test-card|encryption-only|fingerprint-only/);
    return true;
}
test('crypto roundtrip normalizes full text, uses authenticated random envelopes and stable fingerprints', () => {
    const env = environment();
    const first = delivery.sealDelivery(` \r\n${CONTENT.replace('\n', '\r\n')} \r\n`, CONTEXT, env);
    const second = delivery.sealDelivery(CONTENT, CONTEXT, env);
    assert.equal(delivery.openDelivery(first, CONTEXT, env), CONTENT);
    assert.equal(first.fingerprint, second.fingerprint);
    assert.notEqual(first.ciphertext, second.ciphertext);
    assert.notEqual(first.nonce, second.nonce);
    assert.equal(Buffer.from(first.nonce, 'base64').length, 12);
    assert.equal(Buffer.from(first.tag, 'base64').length, 16);
    assert.doesNotMatch(JSON.stringify(first), /demo-test-card|encryption-only|fingerprint-only/);
});
for (const field of ['ciphertext', 'tag', 'nonce', 'fingerprint', 'keyId', 'algorithm', 'version']) {
    test(`decrypt rejects tampered ${field} without exposing content or secrets`, () => {
        const env = environment();
        const sealed = delivery.sealDelivery(CONTENT, CONTEXT, env);
        sealed[field] = field === 'version' ? 2 : field === 'fingerprint' ? 'c'.repeat(64) : field === 'keyId' ? 'missing' : 'AAAA';
        assert.throws(() => delivery.openDelivery(sealed, CONTEXT, env), noSecret);
    });
}
for (const [field, value] of [['unitId', ORDER], ['intentId', ORDER], ['orderNo', 'OTHER'], ['site', 'intl']]) {
    test(`decrypt cannot replay another ${field}`, () => {
        const env = environment();
        assert.throws(() => delivery.openDelivery(delivery.sealDelivery(CONTENT, CONTEXT, env), { ...CONTEXT, [field]: value }, env), noSecret);
    });
}
test('key rotation retains old envelopes and fingerprints without changing stored ciphertext', () => {
    const env = environment(); const old = delivery.sealDelivery(CONTENT, CONTEXT, env);
    const keys = JSON.parse(env.SHOP_SUPPLIER_DELIVERY_KEYS); keys.second = 'new-independent-test-key-'.repeat(3);
    env.SHOP_SUPPLIER_DELIVERY_KEYS = JSON.stringify(keys); env.SHOP_SUPPLIER_DELIVERY_ACTIVE_KEY = 'second';
    const current = delivery.sealDelivery(CONTENT, CONTEXT, env);
    assert.equal(delivery.openDelivery(old, CONTEXT, env), CONTENT);
    assert.equal(delivery.openDelivery(current, CONTEXT, env), CONTENT);
    assert.equal(old.fingerprint, current.fingerprint);
    delete keys.first; env.SHOP_SUPPLIER_DELIVERY_KEYS = JSON.stringify(keys);
    assert.throws(() => delivery.openDelivery(old, CONTEXT, env), noSecret);
});
for (const value of ['', null, '  ', 'test\u0000content', '汉'.repeat(10923)]) {
    test(`invalid or oversized content is rejected (${typeof value}/${String(value).length})`, () => {
        assert.throws(() => delivery.sealDelivery(value, CONTEXT, environment()), noSecret);
    });
}
test('32768 byte full-content boundary remains decryptable', () => {
    const env = environment(); const text = 'x'.repeat(32768);
    assert.equal(delivery.openDelivery(delivery.sealDelivery(text, CONTEXT, env), CONTEXT, env), text);
});
for (const reuse of ['CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'SHOP_SUPPLIER_DELIVERY_FINGERPRINT_KEY']) {
    test(`encryption seed must be independent of ${reuse}`, () => {
        const env = environment(); env[reuse] = JSON.parse(env.SHOP_SUPPLIER_DELIVERY_KEYS).first;
        assert.throws(() => delivery.sealDelivery(CONTENT, CONTEXT, env), noSecret);
    });
}
test('missing/weak/malformed keyrings and reused fingerprint seeds fail closed', () => {
    for (const patch of [{ SHOP_SUPPLIER_DELIVERY_KEYS: '{}' }, { SHOP_SUPPLIER_DELIVERY_KEYS: '{broken' },
        { SHOP_SUPPLIER_DELIVERY_KEYS: '{"first":"short"}' }, { SHOP_SUPPLIER_DELIVERY_FINGERPRINT_KEY: '' },
        { CRON_SECRET: environment().SHOP_SUPPLIER_DELIVERY_FINGERPRINT_KEY }]) {
        assert.throws(() => delivery.sealDelivery(CONTENT, CONTEXT, { ...environment(), ...patch }), noSecret);
    }
});
test('default off avoids DB, credentials and merchant entirely', async () => {
    const f = fixture({ env: {} });
    assert.deepEqual(await f.runner.reconcile(INTENT), { status: 'disabled' });
    assert.deepEqual(f.calls, []);
});
test('contract hash is the exact reviewed delivery contract', () => {
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(delivery.CONTRACT)).digest('hex'), delivery.CONTRACT_HASH);
    assert.equal(delivery.CONTRACT_HASH, '412c6c9277c684368548010f93001c9cf10a7b170fddcafc085f9a0171289fd9');
});
test('runner queries original account/request/order and stores encrypted final actual cost', async () => {
    const f = fixture();
    assert.deepEqual(await f.runner.reconcile(INTENT), { status: 'delivered', applied: true });
    assert.deepEqual(f.calls[1].account, ticket().account);
    assert.deepEqual(f.calls[2].query, { requestId: REQUEST, orderNo: CONTEXT.orderNo });
    const recorded = f.calls[3];
    assert.equal(recorded.name, 'fn_shop_supplier_record_delivery_v2');
    assert.equal(recorded.args.p_receipt.actualCostCny, '12.340000');
    assert.equal(recorded.args.p_receipt.proofHash, PROOF);
    assert.equal(delivery.openDelivery(recorded.args.p_receipt.sealed, CONTEXT, environment()), CONTENT);
    assert.doesNotMatch(JSON.stringify(recorded), /demo-test-card|encryption-only|fingerprint-only/);
});
for (const status of ['delivered', 'quarantined', 'awaiting_acceptance']) {
    test(`durable ${status} result stops before resolving credentials`, async () => {
        const f = fixture({ ticket: { status } });
        assert.deepEqual(await f.runner.reconcile(INTENT), { status }); assert.equal(f.calls.length, 1);
    });
}
for (const patch of [{ accountId: ORDER }, { requestId: ORDER }, { orderNo: 'OTHER' }, { outcome: 'accepted' },
    { outcome: 'not_found' }, { completeDelivery: false }, { quantity: 2 }, { finalCost: false },
    { cost: { currency: 'USDT', amount: '12' } }, { cost: { currency: 'CNY', amount: 12 } },
    { cost: { currency: 'CNY', amount: '-1' } }, { cost: { currency: 'CNY', amount: '1e2' } },
    { evidenceHash: '' }, { content: '' }]) {
    test(`incomplete or mismatched upstream receipt remains pending (${Object.keys(patch)[0]}=${JSON.stringify(Object.values(patch)[0])})`, async () => {
        const f = fixture({ raw: receipt(patch), env: { SHOP_SUPPLIER_DELIVERY_V2_ENABLED: 'true' } });
        assert.deepEqual(await f.runner.reconcile(INTENT), { status: 'pending' });
        assert.equal(f.calls.some(c => c.name === 'fn_shop_supplier_record_delivery_v2'), false);
    });
}
test('merchant exception is sanitized and pending; does not require keys or record anything', async () => {
    const f = fixture({ queryError: true, env: { SHOP_SUPPLIER_DELIVERY_V2_ENABLED: 'true' } });
    assert.deepEqual(await f.runner.reconcile(INTENT), { status: 'pending' });
    assert.equal(f.calls.length, 3);
});
for (const adapter of [{ providerId: 'wrong' }, { capabilities: {} }, { deliveryContract: {} },
    { deliveryContract: { ...delivery.CONTRACT, unchecked: true } }, { queryDelivery: null }]) {
    test(`unqualified adapter cannot query or deliver (${Object.keys(adapter)[0]})`, async () => {
        const f = fixture({ adapter });
        await assert.rejects(f.runner.reconcile(INTENT), noSecret);
        assert.equal(f.calls.some(c => c.query), false);
    });
}
test('lost recording acknowledgement is retried by original query, never a new purchase', async () => {
    const f = fixture({ recordError: true });
    await assert.rejects(f.runner.reconcile(INTENT), noSecret);
    await assert.rejects(f.runner.reconcile(INTENT), noSecret);
    const queries = f.calls.filter(c => c.query); assert.equal(queries.length, 2);
    assert.deepEqual(queries[0], queries[1]);
});
test('quarantine result preserves the DB decision and never returns content', async () => {
    const f = fixture({ stored: { status: 'quarantined', applied: true } });
    assert.deepEqual(await f.runner.reconcile(INTENT), { status: 'quarantined', applied: true });
});
test('malformed ticket/status and unacknowledged recording fail safely', async () => {
    for (const options of [{ ticket: { status: 'other', ticket: ticket() } },
        { ticket: { status: 'ready', ticket: { ...ticket(), proofHash: '' } } },
        { stored: { status: 'delivered', applied: false } }]) {
        await assert.rejects(fixture(options).runner.reconcile(INTENT), noSecret);
    }
});
test('customer delivery uses private ownership RPC and returns only decrypted content', async () => {
    const env = environment(); const calls = [];
    const db = { async rpc(name, args) { calls.push({ name, args }); return { data: { status: 'delivered', ...CONTEXT,
        sealed: delivery.sealDelivery(CONTENT, CONTEXT, env), credential_ref: 'private' } }; } };
    assert.deepEqual(await delivery.loadCustomerDelivery(db, { orderId: ORDER, fundingKind: 'points', userId: USER }, env),
        { status: 'delivered', content: CONTENT });
    assert.equal(calls[0].name, 'fn_shop_supplier_customer_delivery_v2');
    assert.equal(calls[0].args.p_buyer_user_id, USER);
});
test('pending customer result needs no keys; malformed/error results expose no metadata', async () => {
    const args = { orderId: ORDER, fundingKind: 'guest_cash' };
    assert.deepEqual(await delivery.loadCustomerDelivery({ rpc: async () => ({ data: { status: 'pending' } }) }, args, {}),
        { status: 'pending', content: '' });
    for (const result of [{ error: { message: 'merchant-private-secret' } }, { data: { status: 'quarantined', content: CONTENT } }]) {
        await assert.rejects(delivery.loadCustomerDelivery({ rpc: async () => result }, args, {}), noSecret);
    }
});
test('points user/site/order input must be valid before any private read', async () => {
    const db = { rpc() { assert.fail('invalid input must not reach DB'); } };
    for (const args of [{ orderId: ORDER, fundingKind: 'points' }, { orderId: ORDER, fundingKind: 'points', userId: USER, site: 'intl' },
        { orderId: 'bad', fundingKind: 'guest_cash' }, { orderId: ORDER, fundingKind: 'bad' }]) {
        await assert.rejects(delivery.loadCustomerDelivery(db, args), noSecret);
    }
});
