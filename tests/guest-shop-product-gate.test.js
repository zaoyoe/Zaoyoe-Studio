'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const defaultSecurity = require('../api/_lib/guest-shop/security');
const { createGuestShopHandlers } = require('../server/api-handlers/public/guest-shop');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SKU_ID = '22222222-2222-4222-8222-222222222222';

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

function makeProduct(overrides = {}) {
    return {
        id: PRODUCT_ID,
        name: 'Guest card',
        is_active: true,
        allow_guest_purchase: false,
        guest_cash_price_cny: '12.34',
        guest_cash_price_intl: '2.00',
        delivery_type: 'KEY',
        manual_delivery: false,
        guest_payment_channels: ['zpay'],
        ...overrides
    };
}

function makeSku(overrides = {}) {
    return {
        id: SKU_ID,
        product_id: PRODUCT_ID,
        sku_name: 'default',
        is_active: true,
        allow_guest_purchase: null,
        guest_cash_price_cny: null,
        guest_cash_price_intl: null,
        manual_delivery: false,
        guest_payment_channels: null,
        ...overrides
    };
}

function createQuery(rows) {
    const filters = [];
    const query = {
        select() { return query; },
        eq(field, value) { filters.push([String(field), value]); return query; },
        async maybeSingle() {
            const match = rows.find((row) => filters.every(([field, value]) => row?.[field] === value));
            return { data: match ? clone(match) : null, error: null };
        }
    };
    return query;
}

function createHandlers({ product, sku }) {
    const state = { rpcCalls: [] };
    const supabase = {
        from(table) {
            if (table === 'shop_products') return createQuery([product]);
            if (table === 'shop_product_skus') return createQuery([sku]);
            return createQuery([]);
        },
        async rpc(name) {
            state.rpcCalls.push(name);
            return { data: null, error: new Error(`unexpected rpc ${name}`) };
        }
    };
    const security = {
        ...defaultSecurity,
        async readJsonBodyWithLimit(req) { return req.body; }
    };
    const handlers = createGuestShopHandlers({
        security,
        admin: {
            getOptionalSupabaseAdmin() { return supabase; },
            getSupabaseAdmin() { return supabase; },
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
        env: {
            APP_ENV: 'test',
            APP_BASE_URL: 'https://www.fatherkey.com',
            GUEST_SHOP_CLAIM_PEPPER: 'guest-claim-pepper-012345678901234567890123456789',
            GUEST_SHOP_CLAIM_DERIVATION_PEPPER: 'guest-claim-derivation-pepper-012345678901234567890'
        }
    });
    return { state, handlers };
}

function previewRequest() {
    return {
        method: 'GET',
        headers: { 'user-agent': 'guest-test' },
        query: { site: 'cn', productId: PRODUCT_ID, skuId: SKU_ID }
    };
}

function orderRequest() {
    return {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'guest-test' },
        body: {
            site: 'cn',
            productId: PRODUCT_ID,
            skuId: SKU_ID,
            quantity: 1,
            idempotencyKey: 'idem-key-gate-0000000001',
            provider: 'zpay',
            channel: 'alipay'
        }
    };
}

async function assertUnavailable(handlers, state, kind) {
    const res = createResponse();
    if (kind === 'preview') await handlers.preview(previewRequest(), res);
    else await handlers.orders(orderRequest(), res);
    assert.equal(res.statusCode, 409, `${kind} should fail closed`);
    assert.equal(res.payload.success, false);
    assert.equal(res.payload.code, 'guest_product_unavailable');
    assert.equal(state.rpcCalls.length, 0, `${kind} must not create an order`);
}

test('preview and order fail closed when guest purchase is left at the product default', async () => {
    const { state, handlers } = createHandlers({
        product: makeProduct(),
        sku: makeSku()
    });
    await assertUnavailable(handlers, state, 'preview');
    await assertUnavailable(handlers, state, 'orders');
});

test('a sku false override blocks guest purchase even if the product is enabled', async () => {
    const { state, handlers } = createHandlers({
        product: makeProduct({ allow_guest_purchase: true }),
        sku: makeSku({ allow_guest_purchase: false })
    });
    await assertUnavailable(handlers, state, 'preview');
    await assertUnavailable(handlers, state, 'orders');
});

test('inactive, missing, or manual-delivery catalog rows cannot be previewed or ordered', async () => {
    const blocked = [
        { product: makeProduct({ allow_guest_purchase: true, is_active: false }), sku: makeSku({ allow_guest_purchase: true }) },
        { product: makeProduct({ allow_guest_purchase: true }), sku: makeSku({ allow_guest_purchase: true, is_active: false }) },
        { product: makeProduct({ allow_guest_purchase: true, delivery_type: 'MANUAL' }), sku: makeSku({ allow_guest_purchase: true }) },
        { product: makeProduct({ allow_guest_purchase: true, manual_delivery: true }), sku: makeSku({ allow_guest_purchase: true }) },
        { product: makeProduct({ allow_guest_purchase: true }), sku: makeSku({ allow_guest_purchase: true, manual_delivery: true }) },
        { product: makeProduct({ allow_guest_purchase: true, guest_cash_price_cny: null }), sku: makeSku({ allow_guest_purchase: true, guest_cash_price_cny: null }) }
    ];
    for (const catalog of blocked) {
        const { state, handlers } = createHandlers(catalog);
        await assertUnavailable(handlers, state, 'preview');
        await assertUnavailable(handlers, state, 'orders');
    }
});

test('only an explicitly enabled sku can pass the guest product gate', async () => {
    const { state, handlers } = createHandlers({
        product: makeProduct({ allow_guest_purchase: false }),
        sku: makeSku({
            allow_guest_purchase: true,
            guest_cash_price_cny: '12.34',
            guest_payment_channels: ['zpay']
        })
    });
    const res = createResponse();
    await handlers.preview(previewRequest(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.price.amount, 12.34);
    assert.equal(res.payload.price.currency, 'CNY');
    assert.equal(state.rpcCalls.length, 0);
});
