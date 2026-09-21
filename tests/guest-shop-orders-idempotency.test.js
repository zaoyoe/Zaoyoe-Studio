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
const TEST_ENV = Object.freeze({
    APP_ENV: 'test',
    APP_BASE_URL: 'https://www.fatherkey.com',
    GUEST_SHOP_CLAIM_PEPPER: CLAIM_PEPPER,
    GUEST_SHOP_CLAIM_DERIVATION_PEPPER: DERIVATION_PEPPER,
    GUEST_SHOP_PAYMENT_CREATE_LEASE_MS: '120000'
});
const BUYER_EMAIL = 'resume-buyer@example.com';
const BUYER_PASSWORD = 'Qv7!NorthLake9';
const BUYER_ID = '66666666-6666-4666-8666-666666666666';
const CREDENTIAL_ENV = Object.freeze({
    ...TEST_ENV,
    GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
    GUEST_SHOP_CONTACT_HASH_PEPPER: 'guest-contact-pepper-012345678901234567890123456789',
    GUEST_SHOP_REQUEST_HASH_PEPPER: 'guest-request-pepper-012345678901234567890123456789'
});

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createResponse() {
    const state = { statusCode: 200, headers: {}, body: '' };
    return {
        setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; return this; },
        getHeader(name) { return state.headers[String(name).toLowerCase()]; },
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

function makeResumableOrder(idempotencyKey, overrides = {}) {
    const claimSecret = defaultSecurity.deriveClaimSecretFromIdempotencyKey(idempotencyKey, {
        site: 'cn',
        env: TEST_ENV
    });
    return makeOrder({
        idempotency_key: idempotencyKey,
        product_id: PRODUCT_ID,
        sku_id: SKU_ID,
        snapshot_product_name: 'Test product',
        snapshot_sku_name: 'Default',
        quantity: 1,
        list_unit_amount: '12.34',
        unit_amount: '12.34',
        discount_amount: '0',
        discount_code: null,
        payment_fee_amount: '0',
        metadata: {},
        claim_secret_hash: defaultSecurity.hashClaimSecret(claimSecret, { env: TEST_ENV }),
        ...overrides
    });
}

function makeBuyerRow(overrides = {}) {
    return {
        id: BUYER_ID,
        site: 'cn',
        contact_hash: defaultSecurity.hashGuestContact(BUYER_EMAIL, {
            env: CREDENTIAL_ENV,
            strict: true
        }),
        credential_group_no: 1,
        password_hash: defaultSecurity.hashGuestQueryPassword(BUYER_PASSWORD),
        password_version: 1,
        failed_login_count: 0,
        login_lock_stage: 0,
        locked_until: null,
        merged_into_user_id: null,
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
        if (table === 'guest_shop_buyers') return state.buyers || [];
        if (table === 'guest_shop_access_attempts') return state.accessAttempts || [];
        return [];
    }

    function builder(table, operation, patch = null) {
        const filters = [];
        let limit = null;
        let ordering = null;
        const query = {
            _columns: '*',
            select(columns = '*') { query._columns = columns; return query; },
            update(nextPatch) { return builder(table, 'update', nextPatch); },
            eq(field, value) { filters.push({ type: 'eq', field: String(field), value }); return query; },
            is(field, value) { filters.push({ type: 'is', field: String(field), value }); return query; },
            in(field, values) { filters.push({ type: 'in', field: String(field), values }); return query; },
            gte(field, value) { filters.push({ type: 'gte', field: String(field), value }); return query; },
            limit(value) { limit = Number(value) || null; return query; },
            order(field, options = {}) { ordering = { field: String(field), ascending: options.ascending !== false }; return query; },
            async maybeSingle() { return execute(); },
            then(resolve, reject) { return execute().then(resolve, reject); }
        };

        async function execute() {
            // Let two requests interleave between the RPC and the conditional
            // update, just as separate serverless instances would.
            await new Promise((resolve) => setImmediate(resolve));
            const rows = rowsFor(table);
            let matches = rows.filter((row) => filters.every((filter) => {
                if (filter.type === 'in') return filter.values.includes(row?.[filter.field]);
                if (filter.type === 'is') return filter.value === null ? row?.[filter.field] == null : row?.[filter.field] === filter.value;
                if (filter.type === 'gte') return row?.[filter.field] >= filter.value;
                return row?.[filter.field] === filter.value;
            }));
            if (ordering) {
                matches = matches.slice().sort((left, right) => {
                    const result = left?.[ordering.field] < right?.[ordering.field]
                        ? -1
                        : (left?.[ordering.field] > right?.[ordering.field] ? 1 : 0);
                    return ordering.ascending ? result : -result;
                });
            }
            if (limit !== null) matches = matches.slice(0, limit);
            if (operation === 'insert') {
                const inserted = clone(patch);
                rows.push(inserted);
                return { data: clone(inserted), error: null };
            }
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
                update(patch) { return builder(table, 'update', patch); },
                insert(row) { return builder(table, 'insert', row); }
            };
        },
        async rpc(name, args) {
            state.rpcCalls.push(name);
            state.rpcArgs.push({ name, args: clone(args) });
            await new Promise((resolve) => setImmediate(resolve));
            if (name === 'fn_guest_shop_create_order') {
                // Mirror the durable row that the real RPC returns. This lets
                // the intent tests issue a second HTTP request after the first
                // response is intentionally discarded.
                Object.assign(state.order, {
                    idempotency_key: args.p_idempotency_key,
                    site: args.p_site,
                    product_id: args.p_product_id,
                    sku_id: args.p_sku_id,
                    quantity: args.p_quantity,
                    claim_secret_hash: args.p_claim_secret_hash,
                    buyer_contact_hash: args.p_buyer_contact_hash,
                    buyer_id: args.p_buyer_id
                });
                return { data: [clone(state.order)], error: null };
            }
            if (name === 'fn_guest_shop_upsert_buyer_group') {
                const matched = state.buyers.find((buyer) => buyer?.site === args.p_site)
                    || makeBuyerRow({
                        site: args.p_site,
                        contact_hash: args.p_contact_hash,
                        password_hash: args.p_password_hash || makeBuyerRow().password_hash
                    });
                return {
                    data: [{
                        buyer_id: matched.id,
                        credential_group_no: matched.credential_group_no,
                        allocation: 'reused'
                    }],
                    error: null
                };
            }
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

function createHandlers(stateOverrides = {}, adapterOverrides = {}, envOverrides = {}) {
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
        buyers: [],
        accessAttempts: [],
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
        env: { ...TEST_ENV, ...envOverrides }
    });
    return { state, calls, handlers };
}

function request(key = 'idem-key-000000000001', overrides = {}) {
    return {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'guest-test' },
        body: {
            site: 'cn', productId: PRODUCT_ID, skuId: SKU_ID, quantity: 1,
            idempotencyKey: key, provider: 'zpay', channel: 'alipay',
            ...overrides
        }
    };
}

function checkoutRequest(action, body = {}, cookie = '') {
    return {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'user-agent': 'guest-test',
            ...(cookie ? { cookie } : {})
        },
        body: { checkoutAction: action, ...body }
    };
}

function setCookies(response) {
    const value = response.getHeader('set-cookie');
    return Array.isArray(value) ? value : (value ? [value] : []);
}

function checkoutIntentCookie(response) {
    const cookie = setCookies(response).find((item) => String(item).startsWith('__Host-gs-checkout-intent='));
    assert.ok(cookie, 'expected a checkout intent cookie');
    return String(cookie).split(';', 1)[0];
}

function claimProofCookie(response) {
    const cookie = setCookies(response).find((item) => String(item).startsWith('guest_claim_proof='));
    assert.ok(cookie, 'expected a claim proof cookie');
    return String(cookie).split(';', 1)[0];
}

function joinCookies(...cookies) {
    return cookies.filter(Boolean).join('; ');
}

function tamperCookie(cookie) {
    const separator = String(cookie).indexOf('=');
    assert.ok(separator > 0, 'expected a cookie assignment');
    const value = String(cookie).slice(separator + 1);
    const replacement = value[0] === 'a' ? 'b' : 'a';
    return `${String(cookie).slice(0, separator + 1)}${replacement}${value.slice(1)}`;
}

function persistCreatedOrderForResume(state) {
    const create = state.rpcArgs.find((entry) => entry.name === 'fn_guest_shop_create_order');
    assert.ok(create, 'expected a create-order RPC');
    Object.assign(state.order, {
        idempotency_key: create.args.p_idempotency_key,
        site: create.args.p_site,
        product_id: create.args.p_product_id,
        sku_id: create.args.p_sku_id,
        quantity: create.args.p_quantity,
        claim_secret_hash: create.args.p_claim_secret_hash,
        buyer_id: create.args.p_buyer_id,
        buyer_contact_hash: create.args.p_buyer_contact_hash
    });
    return create.args;
}

test('checkout intent prepare and commit hide the server key and set a secure recovery cookie', async () => {
    const { state, calls, handlers } = createHandlers();
    const prepare = createResponse();
    await handlers.orders(checkoutRequest('prepare', {
        site: 'cn', productId: PRODUCT_ID, skuId: SKU_ID,
        quantity: 1, provider: 'zpay', channel: 'alipay'
    }), prepare);

    assert.equal(prepare.statusCode, 200);
    assert.equal(prepare.payload.success, true);
    assert.equal(prepare.payload.prepared, true);
    assert.ok(prepare.payload.intent.intent_id);
    assert.doesNotMatch(JSON.stringify(prepare.payload), /idempotency|claim_secret|recovery_code/iu);
    const intentCookie = checkoutIntentCookie(prepare);
    assert.match(intentCookie, /^__Host-gs-checkout-intent=/u);
    const setCookie = setCookies(prepare).find((item) => item.startsWith('__Host-gs-checkout-intent='));
    assert.match(setCookie, /; HttpOnly/u);
    assert.match(setCookie, /; Secure/u);
    assert.match(setCookie, /; SameSite=Strict/u);
    assert.match(setCookie, /; Path=\//u);
    assert.doesNotMatch(setCookie, /Domain=/iu);

    const commit = createResponse();
    await handlers.orders(checkoutRequest('commit', {
        intentId: prepare.payload.intent.intent_id
    }, intentCookie), commit);
    assert.equal(commit.statusCode, 201);
    assert.equal(calls.create, 1);
    const createArgs = state.rpcArgs.find((entry) => entry.name === 'fn_guest_shop_create_order')?.args;
    assert.match(createArgs.p_idempotency_key, /^ci\.[A-Za-z0-9_-]{24,96}$/u);
    assert.doesNotMatch(JSON.stringify(commit.payload), /idempotency_key|idempotencyKey|claim_secret_hash/iu);
});

test('checkout intent reuses the same live prepare request and enforces production origin checks', async () => {
    const { handlers } = createHandlers({}, {}, { DEPLOYMENT_TIER: 'production' });
    const prepareBody = {
        site: 'cn', productId: PRODUCT_ID, skuId: SKU_ID,
        quantity: 1, provider: 'zpay', channel: 'alipay'
    };
    const deniedRequest = checkoutRequest('prepare', prepareBody);
    const denied = createResponse();
    await handlers.orders(deniedRequest, denied);
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.payload.code, 'guest_checkout_origin_invalid');

    const firstRequest = checkoutRequest('prepare', prepareBody);
    firstRequest.headers.origin = 'https://www.fatherkey.com';
    firstRequest.headers['sec-fetch-site'] = 'same-origin';
    const first = createResponse();
    await handlers.orders(firstRequest, first);
    assert.equal(first.statusCode, 200);
    const cookie = checkoutIntentCookie(first);

    const secondRequest = checkoutRequest('prepare', prepareBody, cookie);
    secondRequest.headers.origin = 'https://www.fatherkey.com';
    secondRequest.headers['sec-fetch-site'] = 'same-origin';
    const second = createResponse();
    await handlers.orders(secondRequest, second);
    assert.equal(second.statusCode, 200);
    assert.equal(second.payload.reused, true);
    assert.equal(second.payload.intent.intent_id, first.payload.intent.intent_id);
});

test('all checkout intent actions enforce production Origin and same-site fetch metadata', async () => {
    const { calls, handlers } = createHandlers({}, {}, { DEPLOYMENT_TIER: 'production' });
    const prepareBody = {
        site: 'cn', productId: PRODUCT_ID, skuId: SKU_ID,
        quantity: 1, provider: 'zpay', channel: 'alipay'
    };
    const prepare = createResponse();
    const prepareRequest = checkoutRequest('prepare', prepareBody);
    prepareRequest.headers.origin = 'https://www.fatherkey.com';
    prepareRequest.headers['sec-fetch-site'] = 'same-origin';
    await handlers.orders(prepareRequest, prepare);
    assert.equal(prepare.statusCode, 200);
    const intentId = prepare.payload.intent.intent_id;
    const intentCookie = checkoutIntentCookie(prepare);

    const inspectDenied = createResponse();
    await handlers.orders(checkoutRequest('inspect', {}, intentCookie), inspectDenied);
    assert.equal(inspectDenied.statusCode, 403);
    assert.equal(inspectDenied.payload.code, 'guest_checkout_origin_invalid');

    const inspectAllowedRequest = checkoutRequest('inspect', {}, intentCookie);
    inspectAllowedRequest.headers.origin = 'https://www.fatherkey.com';
    inspectAllowedRequest.headers['sec-fetch-site'] = 'same-site';
    const inspectAllowed = createResponse();
    await handlers.orders(inspectAllowedRequest, inspectAllowed);
    assert.equal(inspectAllowed.statusCode, 200);
    assert.equal(inspectAllowed.payload.intent.intent_id, intentId);

    const commitDenied = createResponse();
    await handlers.orders(checkoutRequest('commit', { intentId }, intentCookie), commitDenied);
    assert.equal(commitDenied.statusCode, 403);
    assert.equal(commitDenied.payload.code, 'guest_checkout_origin_invalid');
    assert.equal(calls.create, 0);

    const commitRequest = checkoutRequest('commit', { intentId }, intentCookie);
    commitRequest.headers.origin = 'https://www.fatherkey.com';
    commitRequest.headers['sec-fetch-site'] = 'same-origin';
    const commit = createResponse();
    await handlers.orders(commitRequest, commit);
    assert.equal(commit.statusCode, 201);
    assert.equal(calls.create, 1);
    const claimCookie = claimProofCookie(commit);

    const ackDenied = createResponse();
    await handlers.orders(checkoutRequest('ack', { intentId }, joinCookies(intentCookie, claimCookie)), ackDenied);
    assert.equal(ackDenied.statusCode, 403);
    assert.equal(ackDenied.payload.code, 'guest_checkout_origin_invalid');

    const ackRequest = checkoutRequest('ack', { intentId }, joinCookies(intentCookie, claimCookie));
    ackRequest.headers.origin = 'https://www.fatherkey.com';
    ackRequest.headers['sec-fetch-site'] = 'same-origin';
    const ack = createResponse();
    await handlers.orders(ackRequest, ack);
    assert.equal(ack.statusCode, 200);
    assert.equal(ack.payload.acknowledged, true);
});

test('checkout intent survives a lost commit response and resumes the same order without a second provider call', async () => {
    const { state, calls, handlers } = createHandlers();
    const prepare = createResponse();
    await handlers.orders(checkoutRequest('prepare', {
        site: 'cn', productId: PRODUCT_ID, skuId: SKU_ID,
        quantity: 1, provider: 'zpay', channel: 'alipay'
    }), prepare);
    const intentCookie = checkoutIntentCookie(prepare);
    const intentId = prepare.payload.intent.intent_id;

    // The first commit completes all side effects, but its response is dropped
    // before either claim or intent-cookie state reaches the browser.
    const droppedCommit = createResponse();
    await handlers.orders(checkoutRequest('commit', { intentId }, intentCookie), droppedCommit);
    assert.equal(droppedCommit.statusCode, 201);
    assert.equal(calls.create, 1);

    const inspect = createResponse();
    await handlers.orders(checkoutRequest('inspect', {}, intentCookie), inspect);
    assert.equal(inspect.statusCode, 200);
    assert.equal(inspect.payload.intent.pending, true);
    assert.equal(inspect.payload.intent.intent_id, intentId);

    const resumed = createResponse();
    await handlers.orders(checkoutRequest('commit', { intentId }, intentCookie), resumed);
    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.payload.replayed, true);
    assert.equal(resumed.payload.resumed_unknown, true);
    assert.equal(calls.create, 1);
});

test('checkout intent rejects tampered selectors and never reaches order or provider side effects', async () => {
    const { state, calls, handlers } = createHandlers();
    const prepare = createResponse();
    await handlers.orders(checkoutRequest('prepare', {
        site: 'cn', productId: PRODUCT_ID, skuId: SKU_ID,
        quantity: 1, provider: 'zpay', channel: 'alipay'
    }), prepare);
    const cookie = checkoutIntentCookie(prepare);
    const value = cookie.slice(cookie.indexOf('=') + 1);
    const tamperedValue = `${value.slice(0, 4)}${value[4] === 'a' ? 'b' : 'a'}${value.slice(5)}`;
    const tampered = `${cookie.slice(0, cookie.indexOf('=') + 1)}${tamperedValue}`;
    const commit = createResponse();
    await handlers.orders(checkoutRequest('commit', {
        intentId: prepare.payload.intent.intent_id
    }, tampered), commit);
    assert.equal(commit.statusCode, 409);
    assert.equal(commit.payload.code, 'guest_checkout_intent_missing');
    assert.equal(calls.create, 0);
    assert.deepEqual(state.rpcCalls, []);
});

test('checkout intent rejects an expired create window before order or provider side effects', async () => {
    const { state, calls, handlers } = createHandlers();
    const prepare = createResponse();
    await handlers.orders(checkoutRequest('prepare', {
        site: 'cn', productId: PRODUCT_ID, skuId: SKU_ID,
        quantity: 1, provider: 'zpay', channel: 'alipay'
    }), prepare);
    const originalNow = Date.now;
    const preparedAt = originalNow();
    try {
        Date.now = () => preparedAt + 6 * 60 * 1000;
        const commit = createResponse();
        await handlers.orders(checkoutRequest('commit', {
            intentId: prepare.payload.intent.intent_id
        }, checkoutIntentCookie(prepare)), commit);
        assert.equal(commit.statusCode, 409);
        assert.equal(commit.payload.code, 'guest_checkout_intent_expired');
        assert.equal(calls.create, 0);
        assert.deepEqual(state.rpcCalls, []);
    } finally {
        Date.now = originalNow;
    }
});

test('checkout intent rejects a mismatched public selector before order or provider side effects', async () => {
    const { state, calls, handlers } = createHandlers();
    const prepare = createResponse();
    await handlers.orders(checkoutRequest('prepare', {
        site: 'cn', productId: PRODUCT_ID, skuId: SKU_ID,
        quantity: 1, provider: 'zpay', channel: 'alipay'
    }), prepare);
    const commit = createResponse();
    await handlers.orders(checkoutRequest('commit', {
        intentId: `ci.${'x'.repeat(40)}`
    }, checkoutIntentCookie(prepare)), commit);
    assert.equal(commit.statusCode, 403);
    assert.equal(commit.payload.code, 'guest_checkout_intent_invalid');
    assert.equal(calls.create, 0);
    assert.deepEqual(state.rpcCalls, []);
});

test('checkout intent resumes a review order without exposing a checkout or retrying the provider', async () => {
    const { state, calls, handlers } = createHandlers();
    const prepare = createResponse();
    await handlers.orders(checkoutRequest('prepare', {
        site: 'cn', productId: PRODUCT_ID, skuId: SKU_ID,
        quantity: 1, provider: 'zpay', channel: 'alipay'
    }), prepare);
    const cookie = checkoutIntentCookie(prepare);
    const intentId = prepare.payload.intent.intent_id;
    const create = createResponse();
    await handlers.orders(checkoutRequest('commit', { intentId }, cookie), create);
    assert.equal(create.statusCode, 201);
    state.order.payment_status = 'review';
    Object.assign(state.payment, {
        status: 'review',
        provider_order_no: null,
        checkout_reference: null,
        provider_metadata: {},
        last_error_code: 'payment_creation_unknown'
    });

    const resumed = createResponse();
    await handlers.orders(checkoutRequest('commit', { intentId }, cookie), resumed);
    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.payload.payment_status, 'review');
    assert.equal(resumed.payload.checkout, null);
    assert.equal(calls.create, 1);
    assert.equal(state.rpcCalls.filter((name) => name === 'fn_guest_shop_create_order').length, 1);
});

test('credential-bound checkout intent authenticates a persisted order before replaying checkout', async () => {
    const buyer = makeBuyerRow();
    const { state, calls, handlers } = createHandlers({ buyers: [buyer] }, {}, CREDENTIAL_ENV);
    const prepare = createResponse();
    await handlers.orders(checkoutRequest('prepare', {
        site: 'cn', productId: PRODUCT_ID, skuId: SKU_ID, quantity: 1,
        email: BUYER_EMAIL, provider: 'zpay', channel: 'alipay'
    }), prepare);
    const cookie = checkoutIntentCookie(prepare);
    const intentId = prepare.payload.intent.intent_id;

    const create = createResponse();
    await handlers.orders(checkoutRequest('commit', {
        intentId, email: BUYER_EMAIL, orderPassword: BUYER_PASSWORD
    }, cookie), create);
    assert.equal(create.statusCode, 201);
    assert.equal(calls.create, 1);

    const resumed = createResponse();
    await handlers.orders(checkoutRequest('commit', {
        intentId, email: BUYER_EMAIL, orderPassword: BUYER_PASSWORD
    }, cookie), resumed);
    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.payload.checkout.checkout_url, 'https://pay.example.test/checkout?id=1');
    assert.equal(calls.create, 1);

    const wrongPassword = createResponse();
    await handlers.orders(checkoutRequest('commit', {
        intentId, email: BUYER_EMAIL, orderPassword: 'Zm8!WrongRiver4'
    }, cookie), wrongPassword);
    assert.equal(wrongPassword.statusCode, 403);
    assert.equal(wrongPassword.payload.code, 'guest_order_credentials_invalid');
    assert.equal(wrongPassword.payload.checkout, undefined);
    assert.equal(calls.create, 1);
});

test('checkout intent ack requires the matching claim proof before clearing the sealed key', async () => {
    const first = createHandlers();
    const prepare = createResponse();
    await first.handlers.orders(checkoutRequest('prepare', {
        site: 'cn', productId: PRODUCT_ID, skuId: SKU_ID,
        quantity: 1, provider: 'zpay', channel: 'alipay'
    }), prepare);
    const cookie = checkoutIntentCookie(prepare);
    const intentId = prepare.payload.intent.intent_id;
    const unresolved = createResponse();
    await first.handlers.orders(checkoutRequest('ack', { intentId }, cookie), unresolved);
    assert.equal(unresolved.statusCode, 409);
    assert.equal(setCookies(unresolved).some((item) => /Max-Age=0/u.test(item)), false);

    const commit = createResponse();
    await first.handlers.orders(checkoutRequest('commit', { intentId }, cookie), commit);
    assert.equal(commit.statusCode, 201);

    // A persisted order alone is not enough: a dropped/forged same-site call
    // must not erase the only idempotent recovery handle.
    const missingProof = createResponse();
    await first.handlers.orders(checkoutRequest('ack', { intentId }, cookie), missingProof);
    assert.equal(missingProof.statusCode, 409);
    assert.equal(missingProof.payload.code, 'guest_checkout_intent_unresolved');
    assert.equal(setCookies(missingProof).some((item) => /__Host-gs-checkout-intent=.*Max-Age=0/u.test(item)), false);

    const proof = claimProofCookie(commit);
    const wrongProof = createResponse();
    await first.handlers.orders(checkoutRequest('ack', { intentId }, joinCookies(cookie, tamperCookie(proof))), wrongProof);
    assert.equal(wrongProof.statusCode, 409);
    assert.equal(wrongProof.payload.code, 'guest_checkout_intent_unresolved');
    assert.equal(setCookies(wrongProof).some((item) => /__Host-gs-checkout-intent=.*Max-Age=0/u.test(item)), false);

    const ack = createResponse();
    await first.handlers.orders(checkoutRequest('ack', { intentId }, joinCookies(cookie, proof)), ack);
    assert.equal(ack.statusCode, 200);
    assert.equal(ack.payload.acknowledged, true);
    assert.equal(setCookies(ack).some((item) => /__Host-gs-checkout-intent=.*Max-Age=0/u.test(item)), true);
});

test('checkout intent ack with the wrong selector leaves the recovery cookie intact', async () => {
    const { handlers } = createHandlers();
    const prepare = createResponse();
    await handlers.orders(checkoutRequest('prepare', {
        site: 'cn', productId: PRODUCT_ID, skuId: SKU_ID,
        quantity: 1, provider: 'zpay', channel: 'alipay'
    }), prepare);
    const ack = createResponse();
    await handlers.orders(checkoutRequest('ack', {
        intentId: `ci.${'z'.repeat(40)}`
    }, checkoutIntentCookie(prepare)), ack);
    assert.equal(ack.statusCode, 403);
    assert.equal(setCookies(ack).some((item) => /Max-Age=0/u.test(item)), false);
});

test('unknown-create resume bypasses mutable catalogue pricing and replays persisted checkout', async () => {
    const key = 'idem-key-resume-price-change-0001';
    const checkoutUrl = 'https://pay.example.test/checkout?id=resume-existing';
    const { state, calls, handlers } = createHandlers({
        order: makeResumableOrder(key),
        sku: {
            id: SKU_ID,
            product_id: PRODUCT_ID,
            sku_name: 'Default',
            is_active: true,
            allow_guest_purchase: null,
            price_points: 98.76,
            price_points_intl: 98.76,
            is_default: true,
            manual_delivery: false,
            guest_payment_channels: null
        },
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
    const res = createResponse();
    await handlers.orders(request(key, { resumeUnknown: true }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.replayed, true);
    assert.equal(res.payload.resumed_unknown, true);
    assert.equal(res.payload.order.order_no, ORDER_NO);
    assert.equal(Number(res.payload.order.amount), 12.34);
    assert.equal(res.payload.checkout.checkout_url, checkoutUrl);
    assert.equal(calls.create, 0, 'an existing order must never create another provider payment');
    assert.deepEqual(state.rpcCalls, [], 'resume must not rebuild a live-price fingerprint through the create RPC');
});

test('unknown-create resume rejects every immutable binding mismatch before provider work', async (t) => {
    const key = 'idem-key-resume-binding-00001';
    const cases = [
        ['product', { order: { product_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }],
        ['sku', { order: { sku_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }],
        ['quantity', { order: { quantity: 2 } }],
        ['discount', { order: { discount_code: 'SAVE10' } }],
        ['claim hash', { order: { claim_secret_hash: `hmac-sha256:v1:${'0'.repeat(64)}` } }],
        ['provider', { payment: { provider: 'nowpayments' } }],
        ['channel', { payment: { channel: 'wechat' } }]
    ];
    for (const [name, overrides] of cases) {
        await t.test(name, async () => {
            const { state, calls, handlers } = createHandlers({
                order: makeResumableOrder(key, overrides.order),
                payment: makePayment(overrides.payment)
            });
            const res = createResponse();
            await handlers.orders(request(key, { resumeUnknown: true }), res);
            assert.equal(res.statusCode, 409);
            assert.equal(res.payload.code, 'guest_idempotency_conflict');
            assert.equal(calls.create, 0);
            assert.deepEqual(state.rpcCalls, []);
        });
    }
});

test('unknown-create resume returns a review handle without checkout or another provider call', async () => {
    const key = 'idem-key-resume-review-0000001';
    const { state, calls, handlers } = createHandlers({
        order: makeResumableOrder(key, { payment_status: 'review' }),
        payment: makePayment({
            status: 'review',
            provider_order_no: null,
            checkout_reference: null,
            last_error_code: 'payment_creation_unknown',
            last_error_message: 'unknown'
        })
    });
    const res = createResponse();
    await handlers.orders(request(key, { resumeUnknown: true }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.order.order_no, ORDER_NO);
    assert.equal(res.payload.payment_status, 'review');
    assert.equal(res.payload.checkout, null);
    assert.equal(Object.hasOwn(res.payload.order, 'recovery_code'), false);
    assert.equal(calls.create, 0);
    assert.deepEqual(state.rpcCalls, []);
});

test('unknown-create resume survives quantity and discount gate changes only for a persisted row', async () => {
    const key = 'idem-key-resume-config-drift-001';
    const checkoutUrl = 'https://pay.example.test/checkout?id=config-drift';
    const { state, calls, handlers } = createHandlers({
        order: makeResumableOrder(key, {
            quantity: 2,
            unit_amount: '10.00',
            list_unit_amount: '12.34',
            discount_amount: '4.68',
            discount_code: 'SAVE10',
            total_amount: '20.00'
        }),
        payment: makePayment({
            expected_amount: '20.00',
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
    const res = createResponse();
    await handlers.orders(request(key, {
        resumeUnknown: true,
        quantity: 2,
        discountCode: 'save10'
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.order.quantity, 2);
    assert.equal(Number(res.payload.order.amount), 20);
    assert.equal(res.payload.checkout.checkout_url, checkoutUrl);
    assert.equal(calls.create, 0);
    assert.deepEqual(state.rpcCalls, []);
});

test('credential-bound unknown-create resume authenticates the existing buyer without allocating a group', async () => {
    const key = 'idem-key-resume-buyer-auth-0001';
    const buyer = makeBuyerRow();
    const checkoutUrl = 'https://pay.example.test/checkout?id=buyer-resume';
    const { state, calls, handlers } = createHandlers({
        buyers: [buyer],
        order: makeResumableOrder(key, {
            buyer_id: BUYER_ID,
            buyer_contact_hash: buyer.contact_hash
        }),
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
    }, {}, CREDENTIAL_ENV);
    const res = createResponse();
    await handlers.orders(request(key, {
        resumeUnknown: true,
        email: BUYER_EMAIL,
        orderPassword: BUYER_PASSWORD
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.order.order_no, ORDER_NO);
    assert.equal(calls.create, 0);
    assert.deepEqual(state.rpcCalls, [], 'resume authentication must not call the buyer-group upsert or create-order RPC');
    assert.equal(state.accessAttempts.at(-1)?.outcome, 'success');
});

test('credential-bound unknown-create resume rejects a wrong password before payment disclosure', async () => {
    const key = 'idem-key-resume-buyer-wrong-001';
    const buyer = makeBuyerRow();
    const { state, calls, handlers } = createHandlers({
        buyers: [buyer],
        order: makeResumableOrder(key, {
            buyer_id: BUYER_ID,
            buyer_contact_hash: buyer.contact_hash
        })
    }, {}, CREDENTIAL_ENV);
    const res = createResponse();
    await handlers.orders(request(key, {
        resumeUnknown: true,
        email: BUYER_EMAIL,
        orderPassword: 'Zm8!WrongRiver4'
    }), res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.code, 'guest_order_credentials_invalid');
    assert.equal(res.payload.checkout, undefined);
    assert.equal(calls.create, 0);
    assert.deepEqual(state.rpcCalls, []);
    assert.equal(state.buyers[0].failed_login_count, 1);
    assert.equal(state.accessAttempts.at(-1)?.outcome, 'bad_password');
});

test('unknown-create resume re-applies current quantity and discount gates when no row exists', async (t) => {
    const key = 'idem-key-resume-current-gates-01';
    for (const [name, body, expectedStatus, expectedCode] of [
        ['quantity', { quantity: 2 }, 400, 'invalid_quantity'],
        ['discount', { discountCode: 'SAVE10' }, 403, 'guest_discount_disabled']
    ]) {
        await t.test(name, async () => {
            const { state, calls, handlers } = createHandlers({
                order: makeOrder({ idempotency_key: 'another-idempotency-key-0001' })
            });
            const res = createResponse();
            await handlers.orders(request(key, { resumeUnknown: true, ...body }), res);
            assert.equal(res.statusCode, expectedStatus);
            assert.equal(res.payload.code, expectedCode);
            assert.equal(calls.create, 0);
            assert.deepEqual(state.rpcCalls, []);
        });
    }
});

test('unknown-create resume never replays a checkout for a terminal order', async () => {
    const key = 'idem-key-resume-terminal-00001';
    const checkoutUrl = 'https://pay.example.test/checkout?id=must-not-replay';
    const { state, calls, handlers } = createHandlers({
        order: makeResumableOrder(key, { payment_status: 'expired' }),
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
    const res = createResponse();
    await handlers.orders(request(key, { resumeUnknown: true }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.payment_status, 'expired');
    assert.equal(res.payload.checkout, null);
    assert.equal(calls.create, 0);
    assert.deepEqual(state.rpcCalls, []);
});

test('unknown-create resume with no persisted order falls through using the original key', async () => {
    const key = 'idem-key-resume-no-row-000001';
    const { state, calls, handlers } = createHandlers({
        order: makeOrder({ idempotency_key: 'another-idempotency-key-0001' })
    });
    const res = createResponse();
    await handlers.orders(request(key, { resumeUnknown: true }), res);

    assert.equal(res.statusCode, 201);
    assert.equal(calls.create, 1);
    assert.deepEqual(state.rpcCalls, ['fn_guest_shop_create_order']);
    const createCall = state.rpcArgs.find((entry) => entry.name === 'fn_guest_shop_create_order');
    assert.equal(createCall.args.p_idempotency_key, key);
});

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


test('idempotent create retry keeps the same order response contract and never leaks claim material', async () => {
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
    const first = createResponse();
    await handlers.orders(request(key), first);
    const second = createResponse();
    await handlers.orders(request(key), second);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(first.payload.replayed, true);
    assert.equal(second.payload.replayed, true);
    assert.equal(Object.hasOwn(first.payload.order, 'recovery_code'), false);
    assert.equal(Object.hasOwn(second.payload.order, 'recovery_code'), false);
    assert.equal(first.payload.order.order_no, ORDER_NO);
    assert.equal(second.payload.order.order_no, ORDER_NO);
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
