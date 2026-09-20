'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createGuestShopHandlers } = require('../server/api-handlers/public/guest-shop');

const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const PAYMENT_ID = '44444444-4444-4444-8444-444444444444';
const PRODUCT_ID = '55555555-5555-4555-8555-555555555555';
const SKU_ID = '66666666-6666-4666-8666-666666666666';
const ORDER_NO = 'GS20260913-000001';
const VALID_RECOVERY_CODE = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abc';

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createResponse() {
    const state = { statusCode: 200, headers: {}, body: '' };
    return {
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
            return this;
        },
        status(code) {
            state.statusCode = code;
            return this;
        },
        end(body = '') {
            state.body = String(body);
            return this;
        },
        get statusCode() { return state.statusCode; },
        get headers() { return state.headers; },
        get payload() { return state.body ? JSON.parse(state.body) : null; }
    };
}

function makeOrder(overrides = {}) {
    return {
        id: ORDER_ID,
        order_no: ORDER_NO,
        site: 'cn',
        product_id: PRODUCT_ID,
        sku_id: SKU_ID,
        snapshot_product_name: 'Cross-device product',
        snapshot_sku_name: 'Annual plan',
        quantity: 1,
        idempotency_key: 'must-not-leak-idempotency-key',
        request_fingerprint: 'must-not-leak-request-fingerprint',
        buyer_id: '88888888-8888-4888-8888-888888888888',
        buyer_contact_hash: 'must-not-leak-contact-hash',
        request_ip_hash: 'must-not-leak-ip-hash',
        request_device_hash: 'must-not-leak-device-hash',
        claim_secret_hash: 'stored-claim-hash',
        claim_secret_version: 1,
        claim_attempt_count: 0,
        recovery_code: 'must-not-leak-recovery-code',
        query_password_hash: 'must-not-leak-password-hash',
        delivery_content: 'must-not-leak-card-secret',
        metadata: { card_secret: 'must-not-leak-card-secret' },
        discount_snapshot: { internal_rule: 'must-not-leak-discount-rule' },
        last_error_code: null,
        last_error_message: null,
        payment_status: 'pending',
        fulfillment_status: 'pending',
        refund_status: 'none',
        total_amount: '12.34',
        currency: 'CNY',
        expires_at: '2099-01-01T00:00:00.000Z',
        ...overrides
    };
}

function makePayment(overrides = {}) {
    const checkoutUrl = 'https://pay.example.test/checkout?id=1';
    return {
        id: PAYMENT_ID,
        guest_order_id: ORDER_ID,
        merchant_order_no: ORDER_NO,
        purpose: 'shop_direct',
        provider: 'zpay',
        channel: 'alipay',
        currency: 'CNY',
        status: 'created',
        provider_order_no: 'ZPAY-PROVIDER-001',
        checkout_reference: checkoutUrl,
        provider_metadata: {
            provider: 'zpay',
            purpose: 'shop_direct',
            provider_order_no: 'ZPAY-PROVIDER-001',
            checkout_url: checkoutUrl,
            qrcode_url: 'https://pay.example.test/qr?id=1',
            qrcode_image_url: 'https://pay.example.test/image?id=1',
            claim_secret: 'must-not-leak',
            provider_token: 'must-not-leak',
            arbitrary_sensitive_value: 'must-not-leak'
        },
        ...overrides
    };
}

/**
 * Small PostgREST-shaped double for the status handler. It deliberately
 * counts payment reads so authorization ordering is part of the test.
 */
function createSupabaseStub({ order = makeOrder(), payment = makePayment() } = {}) {
    const state = {
        order,
        payment,
        paymentReads: 0,
        orderReads: 0,
        updates: 0
    };

    function rowsFor(table) {
        if (table === 'guest_shop_orders') return [state.order];
        if (table === 'guest_shop_payment_orders') return [state.payment];
        return [];
    }

    function createBuilder(table, operation = 'select', patch = null) {
        const filters = [];
        const query = {
            select() { return query; },
            update(nextPatch) { return createBuilder(table, 'update', nextPatch); },
            eq(field, value) {
                filters.push({ type: 'eq', field: String(field), value });
                return query;
            },
            is(field, value) {
                filters.push({ type: 'is', field: String(field), value });
                return query;
            },
            async maybeSingle() { return execute(); },
            then(resolve, reject) { return execute().then(resolve, reject); }
        };

        async function execute() {
            const rows = rowsFor(table);
            if (operation === 'select' && table === 'guest_shop_orders') state.orderReads += 1;
            if (operation === 'select' && table === 'guest_shop_payment_orders') state.paymentReads += 1;
            const matches = rows.filter((row) => filters.every((filter) => {
                if (filter.type === 'is') {
                    return filter.value === null
                        ? row?.[filter.field] == null
                        : row?.[filter.field] === filter.value;
                }
                return row?.[filter.field] === filter.value;
            }));
            if (operation === 'update') {
                state.updates += 1;
                const row = matches[0];
                if (!row) return { data: null, error: null };
                Object.assign(row, clone(patch));
                return { data: clone(row), error: null };
            }
            return { data: clone(matches[0] || null), error: null };
        }

        return query;
    }

    return {
        state,
        from(table) {
            return {
                select(columns = '*') { return createBuilder(table, 'select').select(columns); },
                update(patch) { return createBuilder(table, 'update', patch); }
            };
        }
    };
}

function createHandlers(options = {}) {
    const supabase = createSupabaseStub(options);
    const security = {
        GuestShopSecurityError: class GuestShopSecurityError extends Error {
            constructor(message, options = {}) { super(message); Object.assign(this, options); this.name = 'GuestShopSecurityError'; }
        },
        getGuestClaimPepper() { return 'p'.repeat(48); },
        DEFAULT_JSON_BODY_LIMIT: 16 * 1024,
        readJsonBodyWithLimit(req) { return JSON.parse(req.body || '{}'); },
        verifyClaimSecret(secret, storedHash) {
            return (secret === 'valid-secret' || secret === VALID_RECOVERY_CODE) && storedHash === 'stored-claim-hash';
        }
    };
    const handlers = createGuestShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() { return supabase; },
            sendJson(res, status, payload) {
                res.status(status);
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(payload));
            }
        },
        requestSecurity: {
            async takeRateLimitToken() { return { allowed: true }; },
            applyRateLimitHeaders() {},
            resolveClientIp() { return '198.51.100.10'; }
        },
        security,
        env: { APP_ENV: 'test' }
    });
    return { handlers, state: supabase.state };
}

function statusRequest(secret) {
    return {
        method: 'GET',
        query: { orderNo: ORDER_NO },
        headers: secret === undefined ? {} : { 'x-guest-claim-secret': secret }
    };
}

function recoverRequest(recoveryCode = VALID_RECOVERY_CODE) {
    return {
        method: 'POST',
        body: JSON.stringify({ orderNo: ORDER_NO, recoveryCode }),
        headers: { 'content-type': 'application/json' }
    };
}

test('authorized pending status reconstructs an allowlisted checkout', async () => {
    const { handlers, state } = createHandlers();
    const response = createResponse();

    await handlers.status(statusRequest('valid-secret'), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.success, true);
    assert.deepEqual(response.payload.order, {
        order_no: ORDER_NO,
        site: 'cn',
        product_id: PRODUCT_ID,
        sku_id: SKU_ID,
        product_name: 'Cross-device product',
        sku_name: 'Annual plan',
        payment_status: 'pending',
        fulfillment_status: 'pending',
        refund_status: 'none',
        amount: '12.34',
        currency: 'CNY',
        expires_at: '2099-01-01T00:00:00.000Z',
        quantity: 1,
        provider: 'zpay',
        channel: 'alipay'
    });
    assert.equal(response.payload.checkout.provider, 'zpay');
    assert.equal(response.payload.checkout.checkout_url, 'https://pay.example.test/checkout?id=1');
    assert.equal(response.payload.checkout.amount, 12.34);
    assert.equal(response.payload.checkout.currency, 'CNY');
    assert.equal(state.orderReads, 1);
    assert.equal(state.paymentReads, 1);

    const serialized = JSON.stringify(response.payload);
    assert.doesNotMatch(serialized, /claim_secret|provider_token|arbitrary_sensitive_value|stored-claim-hash/);
    assert.doesNotMatch(serialized, /recovery_code|query_password_hash|delivery_content|card_secret|must-not-leak/);
    assert.doesNotMatch(serialized, /provider_metadata/);
});

test('cross-device recovery requires order number plus high-entropy code and sets cookie', async () => {
    const { handlers, state } = createHandlers();
    const response = createResponse();
    await handlers.recover(recoverRequest(), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.success, true);
    assert.equal(response.payload.recovered, true);
    assert.equal(response.payload.order.order_no, ORDER_NO);
    assert.equal(response.payload.order.site, 'cn');
    assert.equal(response.payload.order.product_id, PRODUCT_ID);
    assert.equal(response.payload.order.sku_id, SKU_ID);
    assert.equal(response.payload.order.product_name, 'Cross-device product');
    assert.equal(response.payload.order.sku_name, 'Annual plan');
    assert.equal(response.payload.order.provider, 'zpay');
    assert.equal(response.payload.order.channel, 'alipay');
    assert.equal(response.payload.checkout.provider, 'zpay');
    assert.match(String(response.headers['set-cookie'] || ''), /guest_claim_proof=/);
    assert.equal(state.paymentReads, 1);
    assert.doesNotMatch(JSON.stringify(response.payload), /claim_secret|recovery_code|query_password_hash|delivery_content|card_secret|stored-claim-hash|must-not-leak/);
});

test('status omits provider context when the payment intent is not bound to the order', async () => {
    const { handlers, state } = createHandlers({
        payment: makePayment({ guest_order_id: '77777777-7777-4777-8777-777777777777' })
    });
    const response = createResponse();

    await handlers.status(statusRequest('valid-secret'), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.order.product_id, PRODUCT_ID);
    assert.equal(response.payload.order.product_name, 'Cross-device product');
    assert.equal(Object.hasOwn(response.payload.order, 'provider'), false);
    assert.equal(Object.hasOwn(response.payload.order, 'channel'), false);
    assert.equal(Object.hasOwn(response.payload, 'checkout'), false);
    assert.equal(state.paymentReads, 1);
    assert.doesNotMatch(JSON.stringify(response.payload), /provider_metadata|must-not-leak/);
});

test('status never falls back to provider metadata for an invalid payment key', async () => {
    const { handlers } = createHandlers({
        payment: makePayment({
            provider: `z${'p'.repeat(80)}`,
            channel: 'alipay',
            provider_metadata: {
                provider: 'zpay',
                purpose: 'shop_direct',
                provider_order_no: 'ZPAY-PROVIDER-001',
                checkout_url: 'https://pay.example.test/checkout?id=1',
                provider_token: 'must-not-leak-provider-token'
            }
        })
    });
    const response = createResponse();

    await handlers.status(statusRequest('valid-secret'), response);

    assert.equal(response.statusCode, 200);
    assert.equal(Object.hasOwn(response.payload.order, 'provider'), false);
    assert.equal(Object.hasOwn(response.payload.order, 'channel'), false);
    assert.equal(Object.hasOwn(response.payload, 'checkout'), false);
    assert.doesNotMatch(JSON.stringify(response.payload), /provider_metadata|must-not-leak-provider-token/);
});

test('cross-device recovery rejects malformed or invalid code before payment lookup', async () => {
    const { handlers, state } = createHandlers();
    const response = createResponse();
    await handlers.recover(recoverRequest('short'), response);
    assert.equal(response.statusCode, 403);
    assert.equal(response.payload.code, 'guest_claim_invalid');
    assert.equal(state.paymentReads, 0);
});

test('invalid status proof is rejected before payment lookup or checkout reconstruction', async () => {
    const { handlers, state } = createHandlers();
    const response = createResponse();

    await handlers.status(statusRequest('wrong-secret'), response);

    assert.equal(response.statusCode, 403);
    assert.equal(response.payload.success, false);
    assert.equal(response.payload.code, 'guest_claim_invalid');
    assert.equal(Object.prototype.hasOwnProperty.call(response.payload, 'order'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(response.payload, 'checkout'), false);
    assert.equal(state.orderReads, 1);
    assert.equal(state.paymentReads, 0);
});

test('authorized terminal status returns its bound channel without reconstructing a stale checkout', async () => {
    const { handlers, state } = createHandlers({
        order: makeOrder({ payment_status: 'confirmed', fulfillment_status: 'delivered' })
    });
    const response = createResponse();

    await handlers.status(statusRequest('valid-secret'), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.success, true);
    assert.equal(response.payload.order.payment_status, 'confirmed');
    assert.equal(response.payload.order.product_id, PRODUCT_ID);
    assert.equal(response.payload.order.sku_id, SKU_ID);
    assert.equal(response.payload.order.provider, 'zpay');
    assert.equal(response.payload.order.channel, 'alipay');
    assert.equal(Object.prototype.hasOwnProperty.call(response.payload, 'checkout'), false);
    assert.equal(state.paymentReads, 1);
});

test('terminal recovery returns its bound channel without a checkout', async () => {
    const { handlers, state } = createHandlers({
        order: makeOrder({ payment_status: 'expired', fulfillment_status: 'pending' })
    });
    const response = createResponse();

    await handlers.recover(recoverRequest(), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.order.payment_status, 'expired');
    assert.equal(response.payload.order.provider, 'zpay');
    assert.equal(response.payload.order.channel, 'alipay');
    assert.equal(Object.hasOwn(response.payload, 'checkout'), false);
    assert.equal(state.paymentReads, 1);
    assert.doesNotMatch(JSON.stringify(response.payload), /provider_metadata|must-not-leak/);
});

test('authorized status fails closed when the stored checkout URL is not HTTPS', async () => {
    const { handlers } = createHandlers({
        payment: makePayment({
            checkout_reference: 'javascript:alert(1)',
            provider_metadata: {
                provider: 'zpay',
                purpose: 'shop_direct',
                provider_order_no: 'ZPAY-PROVIDER-001',
                checkout_url: 'javascript:alert(1)'
            }
        })
    });
    const response = createResponse();

    await handlers.status(statusRequest('valid-secret'), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.success, true);
    assert.equal(Object.prototype.hasOwnProperty.call(response.payload, 'checkout'), false);
});

test('cross-device recovery is idempotent and never re-emits the recovery code', async () => {
    const { handlers, state } = createHandlers();
    const first = createResponse();
    const second = createResponse();

    await handlers.recover(recoverRequest(), first);
    await handlers.recover(recoverRequest(), second);

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(first.payload.recovered, true);
    assert.equal(second.payload.recovered, true);
    assert.equal(state.paymentReads, 2);
    assert.match(String(first.headers['set-cookie'] || ''), /guest_claim_proof=/);
    assert.match(String(second.headers['set-cookie'] || ''), /guest_claim_proof=/);
    assert.doesNotMatch(JSON.stringify(first.payload), /recovery_code|claim_secret|stored-claim-hash/);
    assert.doesNotMatch(JSON.stringify(second.payload), /recovery_code|claim_secret|stored-claim-hash/);
});

test('status after recovery still withholds the recovery code', async () => {
    const { handlers } = createHandlers();
    const recovered = createResponse();
    await handlers.recover(recoverRequest(), recovered);
    const status = createResponse();
    await handlers.status(statusRequest(VALID_RECOVERY_CODE), status);

    assert.equal(status.statusCode, 200);
    assert.equal(status.payload.order.order_no, ORDER_NO);
    assert.doesNotMatch(JSON.stringify(status.payload), /recovery_code|claim_secret|stored-claim-hash/);
});
