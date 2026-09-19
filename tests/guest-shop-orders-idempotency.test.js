'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const defaultSecurity = require('../api/_lib/guest-shop/security');
const { createGuestShopHandlers } = require('../server/api-handlers/public/guest-shop');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SKU_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const PAYMENT_ID = '44444444-4444-4444-8444-444444444444';
const ORDER_NO = 'GS20260913-000001';
const CLAIM_PEPPER = 'guest-claim-pepper-012345678901234567890123456789';
const DERIVATION_PEPPER = 'guest-claim-derivation-pepper-012345678901234567890';

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createResponse() {
    const state = { statusCode: 200, headers: {}, body: '' };
    return {
        setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; return this; },
        status(code) { state.statusCode = code; return this; },
        end(body = '') { state.body = String(body); return this; },
        get statusCode() { return state.statusCode; },
        get payload() { return state.body ? JSON.parse(state.body) : null; }
    };
}

function makeOrder(overrides = {}) {
    return {
        id: ORDER_ID,
        order_id: ORDER_ID,
        order_no: ORDER_NO,
        merchant_order_no: ORDER_NO,
        payment_order_id: PAYMENT_ID,
        site: 'cn',
        currency: 'CNY',
        total_amount: '12.34',
        expires_at: '2099-01-01T00:00:00.000Z',
        payment_status: 'pending',
        ...overrides
    };
}

function makePayment(overrides = {}) {
    return {
        id: PAYMENT_ID,
        guest_order_id: ORDER_ID,
        merchant_order_no: ORDER_NO,
        purpose: 'shop_direct',
        provider: 'zpay',
        channel: 'alipay',
        site: 'cn',
        currency: 'CNY',
        expected_amount: '12.34',
        status: 'pending',
        provider_order_no: null,
        checkout_reference: null,
        provider_metadata: {},
        last_error_code: null,
        last_error_message: null,
        ...overrides
    };
}

/**
 * Tiny PostgREST-like in-memory stub.  Updates evaluate all predicates at
 * execution time, so concurrent handler calls exercise the same conditional
 * lease semantics as the real payment row.
 */
function createSupabaseStub(state) {
    function rowsFor(table) {
        if (table === 'shop_products') return [state.product];
        if (table === 'shop_product_skus') return [state.sku];
        if (table === 'guest_shop_payment_orders') return [state.payment];
        if (table === 'guest_shop_orders') return [state.order];
        if (table === 'guest_shop_inventory_reservations') return state.reservations || [];
        return [];
    }

    function builder(table, operation, patch = null) {
        const filters = [];
        const query = {
            _columns: '*',
            select(columns = '*') { query._columns = columns; return query; },
            update(nextPatch) { return builder(table, 'update', nextPatch); },
            eq(field, value) { filters.push({ type: 'eq', field: String(field), value }); return query; },
            is(field, value) { filters.push({ type: 'is', field: String(field), value }); return query; },
            in(field, values) { filters.push({ type: 'in', field: String(field), values }); return query; },
            async maybeSingle() { return execute(); },
            then(resolve, reject) { return execute().then(resolve, reject); }
        };

        async function execute() {
            // Let two requests interleave between the RPC and the conditional
            // update, just as separate serverless instances would.
            await new Promise((resolve) => setImmediate(resolve));
            const rows = rowsFor(table);
            const matches = rows.filter((row) => filters.every((filter) => {
                if (filter.type === 'in') return filter.values.includes(row?.[filter.field]);
                if (filter.type === 'is') return filter.value === null ? row?.[filter.field] == null : row?.[filter.field] === filter.value;
                return row?.[filter.field] === filter.value;
            }));
            if (operation === 'update') {
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
        from(table) {
            return {
                select(columns = '*') { return builder(table, 'select').select(columns); },
                update(patch) { return builder(table, 'update', patch); }
            };
        },
        async rpc(name, args) {
            state.rpcCalls.push(name);
            state.rpcArgs.push({ name, args: clone(args) });
            await new Promise((resolve) => setImmediate(resolve));
            if (name === 'fn_guest_shop_create_order') return { data: [clone(state.order)], error: null };
            // L1: an order can hold up to 5 reservation rows, so a failed payment
            // creation releases ALL held rows through the service-role helper
            // (RETURNS INTEGER = released count). The pre-L1 single-row
            // fn_guest_shop_release_reservation + maybeSingle() read would now
            // error on a multi-row order and leave stock locked until the TTL sweep.
            if (name === 'guest_shop_release_held_reservations') return { data: 1, error: null };
            throw new Error(`unexpected rpc ${name}`);
        }
    };
}

function createHandlers(stateOverrides = {}, adapterOverrides = {}) {
    const state = {
        product: {
            id: PRODUCT_ID,
            name: 'Test product',
            is_active: true,
            allow_guest_purchase: true,
            delivery_type: 'KEY',
            manual_delivery: false,
            guest_payment_channels: ['zpay']
        },
        sku: {
            id: SKU_ID,
            product_id: PRODUCT_ID,
            sku_name: 'Default',
            is_active: true,
            allow_guest_purchase: null,
            price_points: 12.34,
            price_points_intl: 12.34,
            is_default: true,
            manual_delivery: false,
            guest_payment_channels: null
        },
        order: makeOrder(),
        payment: makePayment(),
        reservations: [],
        rpcCalls: [],
        rpcArgs: [],
        ...stateOverrides
    };
    const supabase = createSupabaseStub(state);
    const calls = { create: 0, lastCreateArgs: null };
    const paymentAdapter = {
        async createGuestPayment(args) {
            calls.create += 1;
            calls.lastCreateArgs = args;
            if (adapterOverrides.createDelayMs) {
                await new Promise((resolve) => setTimeout(resolve, adapterOverrides.createDelayMs));
            }
            if (adapterOverrides.createError) {
                throw adapterOverrides.createError;
            }
            const checkoutUrl = 'https://pay.example.test/checkout?id=1';
            const metadata = {
                provider: 'zpay',
                purpose: 'shop_direct',
                provider_order_no: ORDER_NO,
                checkout_url: checkoutUrl
            };
            const checkoutAmount = Number(args?.amount ?? 12.34);
            return {
                amount: checkoutAmount,
                currency: 'CNY',
                checkout: {
                    provider: 'zpay', channel: 'alipay', checkout_url: checkoutUrl,
                    qrcode_url: null, qrcode_image_url: null, amount: checkoutAmount, currency: 'CNY'
                },
                payment_order_patch: {
                    provider_order_no: ORDER_NO,
                    checkout_reference: checkoutUrl,
                    provider_metadata: metadata
                }
            };
        }
    };
    const security = {
        ...defaultSecurity,
        async readJsonBodyWithLimit(req) { return req.body; }
    };
    const handlers = createGuestShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() { return supabase; },
            getSupabaseAdmin() { return supabase; },
            sendJson(res, status, payload) { res.status(status); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(payload)); }
        },
        requestSecurity: {
            async takeRateLimitToken() { return { allowed: true }; },
            applyRateLimitHeaders() {},
            resolveClientIp() { return '198.51.100.10'; }
        },
        security,
        paymentAdapter,
        env: {
            APP_ENV: 'test',
            APP_BASE_URL: 'https://www.fatherkey.com',
            GUEST_SHOP_CLAIM_PEPPER: CLAIM_PEPPER,
            GUEST_SHOP_CLAIM_DERIVATION_PEPPER: DERIVATION_PEPPER,
            GUEST_SHOP_PAYMENT_CREATE_LEASE_MS: '120000'
        }
    });
    return { state, calls, handlers };
}

function request(key = 'idem-key-000000000001') {
    return {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'guest-test' },
        body: {
            site: 'cn', productId: PRODUCT_ID, skuId: SKU_ID, quantity: 1,
            idempotencyKey: key, provider: 'zpay', channel: 'alipay'
        }
    };
}

test('retry after a persisted provider reference replays checkout without calling provider', async () => {
    const checkoutUrl = 'https://pay.example.test/checkout?id=existing';
    const { state, calls, handlers } = createHandlers({
        payment: makePayment({
            status: 'created',
            provider_order_no: ORDER_NO,
            checkout_reference: checkoutUrl,
            provider_metadata: { provider: 'zpay', purpose: 'shop_direct', provider_order_no: ORDER_NO, checkout_url: checkoutUrl }
        })
    });
    const res = createResponse();
    await handlers.orders(request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.replayed, true);
    assert.equal(res.payload.checkout.checkout_url, checkoutUrl);
    assert.equal(calls.create, 0);
    assert.deepEqual(state.rpcCalls, ['fn_guest_shop_create_order']);
});

test('two concurrent pending retries acquire one creation lease and call provider once', async () => {
    const { state, calls, handlers } = createHandlers({}, { createDelayMs: 40 });
    const firstResponse = createResponse();
    const secondResponse = createResponse();
    await Promise.all([
        handlers.orders(request('idem-key-concurrent-0001'), firstResponse),
        handlers.orders(request('idem-key-concurrent-0001'), secondResponse)
    ]);
    const statuses = [firstResponse.statusCode, secondResponse.statusCode].sort((a, b) => a - b);
    assert.deepEqual(statuses, [201, 409]);
    assert.equal(calls.create, 1);
    assert.equal(state.payment.status, 'created');
    assert.equal(state.payment.provider_order_no, ORDER_NO);
});

test('unknown provider create error marks payment and order review and blocks a second charge', async () => {
    const { state, calls, handlers } = createHandlers({}, {
        createError: Object.assign(new Error('connect timeout'), { name: 'FetchError' })
    });
    const first = createResponse();
    await handlers.orders(request('idem-key-unknown-0000001'), first);
    assert.equal(first.statusCode, 500);
    assert.equal(first.payload.code, 'guest_shop_request_failed');
    assert.equal(calls.create, 1);
    assert.equal(state.payment.status, 'review');
    assert.equal(state.payment.last_error_code, 'payment_creation_unknown');
    assert.equal(state.order.payment_status, 'review');
    assert.equal(state.order.last_error_code, 'payment_creation_unknown');
    assert.equal(state.order.id, ORDER_ID);

    const second = createResponse();
    await handlers.orders(request('idem-key-unknown-0000001'), second);
    assert.equal(second.statusCode, 503);
    assert.equal(second.payload.code, 'guest_payment_reconciliation_required');
    assert.equal(calls.create, 1);
    assert.equal(state.payment.status, 'review');
    assert.equal(state.order.payment_status, 'review');
});

test('definitive provider create rejection marks payment failed and releases the reservation', async () => {
    const { state, calls, handlers } = createHandlers({
        reservations: [{
            id: '55555555-5555-4555-8555-555555555555',
            order_id: ORDER_ID,
            status: 'held'
        }]
    }, {
        createError: Object.assign(new Error('金额低于 NOWPayments 最低限额，无法创建支付'), {
            code: 'guest_provider_create_failed',
            statusCode: 400,
            expose: true
        })
    });
    const res = createResponse();
    await handlers.orders(request('idem-key-rejected-0000001'), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, 'guest_provider_create_failed');
    assert.equal(calls.create, 1);
    assert.equal(state.payment.status, 'failed');
    assert.equal(state.payment.last_error_code, 'guest_provider_create_failed');
    // L1: every held row of the order is released, and the reason records why.
    assert.ok(state.rpcCalls.includes('guest_shop_release_held_reservations'));
    assert.equal(state.rpcCalls.includes('fn_guest_shop_release_reservation'), false,
        'the single-row release must not be used: it cannot release a multi-unit order');
    const release = state.rpcArgs.find((call) => call.name === 'guest_shop_release_held_reservations');
    assert.deepEqual(release.args, {
        p_order_id: ORDER_ID,
        p_reason: 'payment_create_failed:guest_provider_create_failed'
    });
});

test('a stale creation lease is fail-closed and never issues a second provider order', async () => {
    const staleMessage = `v1:${Date.now() - 10 * 60 * 1000}:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    const { calls, handlers } = createHandlers({
        payment: makePayment({ last_error_code: 'payment_creation_in_progress', last_error_message: staleMessage })
    });
    const res = createResponse();
    await handlers.orders(request('idem-key-stale-0000001'), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, 'guest_payment_reconciliation_required');
    assert.equal(calls.create, 0);
});


test('idempotent create retry re-emits the same recovery code and never leaks the stored hash', async () => {
    const checkoutUrl = 'https://pay.example.test/checkout?id=existing';
    const { handlers } = createHandlers({
        payment: makePayment({
            status: 'created',
            provider_order_no: ORDER_NO,
            checkout_reference: checkoutUrl,
            provider_metadata: {
                provider: 'zpay',
                purpose: 'shop_direct',
                provider_order_no: ORDER_NO,
                checkout_url: checkoutUrl
            }
        })
    });
    const key = 'idem-key-recovery-0000001';
    const expected = defaultSecurity.deriveClaimSecretFromIdempotencyKey(key, {
        site: 'cn',
        env: { GUEST_SHOP_CLAIM_DERIVATION_PEPPER: DERIVATION_PEPPER }
    });
    const first = createResponse();
    await handlers.orders(request(key), first);
    const second = createResponse();
    await handlers.orders(request(key), second);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(first.payload.replayed, true);
    assert.equal(second.payload.replayed, true);
    assert.equal(first.payload.order.recovery_code, expected);
    assert.equal(second.payload.order.recovery_code, expected);
    assert.match(expected, /^[A-Za-z0-9_-]{40,200}$/u);
    assert.doesNotMatch(JSON.stringify(first.payload), /claim_secret_hash|hmac-sha256|stored-claim-hash/);
    assert.doesNotMatch(JSON.stringify(second.payload), /claim_secret_hash|hmac-sha256|stored-claim-hash/);
});

test('guest order create persists and sends the credit price plus 1% channel fee', async () => {
    const { state, calls, handlers } = createHandlers();
    const res = createResponse();
    await handlers.orders(request('idem-key-payable-0000001'), res);
    assert.equal(res.statusCode, 201);
    assert.equal(calls.create, 1);
    assert.equal(Number(calls.lastCreateArgs.amount), 12.47);
    assert.equal(Number(state.order.unit_amount), 12.47);
    assert.equal(Number(state.order.total_amount), 12.47);
    assert.equal(Number(state.payment.expected_amount), 12.47);
    assert.equal(Number(state.payment.payment_fee), 0.13);
    assert.equal(Number(res.payload.order.amount), 12.47);
    assert.equal(Number(res.payload.order.payment_pricing.base_amount), 12.34);
    assert.equal(Number(res.payload.order.payment_pricing.payment_fee_amount), 0.13);
    assert.equal(Number(res.payload.order.payment_pricing.payable_amount), 12.47);
    assert.equal(Number(res.payload.checkout.amount), 12.47);
});
