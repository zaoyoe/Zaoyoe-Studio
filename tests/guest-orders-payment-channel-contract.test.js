'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const security = require('../api/_lib/guest-shop/security');
const { createGuestShopHandlers } = require('../server/api-handlers/public/guest-shop');

const BUYER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER_NO_USDT = 'GS2026100412164509601E2CEE07F0D';
const ORDER_NO_ALIPAY = 'GS2026100411223344556677889900A';
const EMAIL = 'test.buyer@example.com';
const PASSWORD = 'Password123!';
const PASSWORD_HASH = security.hashGuestQueryPassword(PASSWORD);

const BASE_ENV = Object.freeze({
    APP_ENV: 'test',
    APP_BASE_URL: 'https://www.fatherkey.com',
    GUEST_SHOP_CLAIM_PEPPER: 'claim-pepper-012345678901234567890123456789',
    GUEST_SHOP_CLAIM_DERIVATION_PEPPER: 'derivation-pepper-0123456789-abcdefghijklmnopqrstuv',
    GUEST_SHOP_CONTACT_HASH_PEPPER: 'contact-hash-pepper-0123456789-abcdefghijklmnopqrstuvwx',
    GUEST_SHOP_REQUEST_HASH_PEPPER: 'request-hash-pepper-0123456789-abcdefghijklmnopqrstuvwx',
    GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
    GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED: 'true'
});

function contactHashOf(email = EMAIL) {
    return security.hashGuestContact(email, { env: BASE_ENV, strict: true });
}

function createResponse() {
    const state = { statusCode: 200, headers: {}, body: '' };
    return {
        setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; return this; },
        getHeader(name) { return state.headers[String(name).toLowerCase()]; },
        removeHeader(name) { delete state.headers[String(name).toLowerCase()]; },
        status(code) { state.statusCode = code; return this; },
        end(body = '') { state.body = String(body); return this; },
        get statusCode() { return state.statusCode; },
        set statusCode(code) { state.statusCode = code; },
        get headers() { return state.headers; },
        get payload() { return state.body ? JSON.parse(state.body) : null; }
    };
}

function createHarness() {
    const state = {
        buyers: [{
            id: BUYER_ID,
            site: 'cn',
            contact_hash: contactHashOf(),
            credential_group_no: 1,
            password_hash: PASSWORD_HASH,
            password_version: 2,
            failed_login_count: 0,
            login_lock_stage: 0,
            locked_until: null,
            merged_into_user_id: null
        }],
        attempts: [],
        orders: [
            {
                id: '11111111-1111-4111-8111-111111111111',
                order_no: ORDER_NO_USDT,
                buyer_id: BUYER_ID,
                site: 'cn',
                currency: 'CNY',
                total_amount: '20.20',
                unit_amount: '20.20',
                quantity: 1,
                payment_status: 'confirmed',
                fulfillment_status: 'delivered',
                refund_status: 'none',
                expires_at: '2099-01-01T00:00:00.000Z',
                created_at: '2026-10-04T12:16:45.000Z'
            },
            {
                id: '22222222-2222-4222-8222-222222222222',
                order_no: ORDER_NO_ALIPAY,
                buyer_id: BUYER_ID,
                site: 'cn',
                currency: 'CNY',
                total_amount: '10.10',
                unit_amount: '10.10',
                quantity: 1,
                payment_status: 'confirmed',
                fulfillment_status: 'delivered',
                refund_status: 'none',
                expires_at: '2099-01-01T00:00:00.000Z',
                created_at: '2026-10-04T11:22:33.000Z'
            }
        ],
        payments: [
            {
                id: 'p1111111-1111-4111-8111-111111111111',
                guest_order_id: '11111111-1111-4111-8111-111111111111',
                merchant_order_no: ORDER_NO_USDT,
                provider: 'nowpayments',
                channel: 'usdtbsc',
                purpose: 'shop_direct',
                status: 'confirmed'
            },
            {
                id: 'p2222222-2222-4222-8222-222222222222',
                guest_order_id: '22222222-2222-4222-8222-222222222222',
                merchant_order_no: ORDER_NO_ALIPAY,
                provider: 'zpay',
                channel: 'alipay',
                purpose: 'shop_direct',
                status: 'confirmed'
            }
        ]
    };

    function builder(table, operation, patch = null) {
        const filters = [];
        let rangeArgs = null;
        let countMode = null;

        const query = {
            select(columns = '*', options = {}) {
                if (options && options.count) countMode = options.count;
                return query;
            },
            update(nextPatch) { return builder(table, 'update', nextPatch); },
            insert(rows) { return builder(table, 'insert', rows); },
            eq(field, value) { filters.push({ type: 'eq', field: String(field), value }); return query; },
            gt(field, value) { filters.push({ type: 'gt', field: String(field), value }); return query; },
            lt(field, value) { filters.push({ type: 'lt', field: String(field), value }); return query; },
            gte(field, value) { filters.push({ type: 'gte', field: String(field), value }); return query; },
            is(field, value) { filters.push({ type: 'is', field: String(field), value }); return query; },
            in(field, values) { filters.push({ type: 'in', field: String(field), values }); return query; },
            order() { return query; },
            limit(n) { filters.push({ type: 'limit', n: Number(n) }); return query; },
            range(from, to) { rangeArgs = { from: Number(from), to: Number(to) }; return query; },
            async maybeSingle() {
                const result = await execute();
                return {
                    data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
                    error: result.error,
                    count: result.count
                };
            },
            async single() { return query.maybeSingle(); },
            then(resolve, reject) { return execute().then(resolve, reject); }
        };

        function rowsFor() {
            if (table === 'guest_shop_buyers') return state.buyers;
            if (table === 'guest_shop_access_attempts') return state.attempts;
            if (table === 'guest_shop_orders') return state.orders;
            if (table === 'guest_shop_payment_orders') return state.payments;
            return [];
        }

        function matches(row) {
            return filters.every((filter) => {
                if (filter.type === 'limit') return true;
                if (filter.type === 'in') return filter.values.includes(row?.[filter.field]);
                if (filter.type === 'gte') return String(row?.[filter.field] ?? '') >= String(filter.value);
                if (filter.type === 'gt') return String(row?.[filter.field] ?? '') > String(filter.value);
                if (filter.type === 'lt') return String(row?.[filter.field] ?? '') < String(filter.value);
                if (filter.type === 'is') {
                    return filter.value === null ? row?.[filter.field] == null : row?.[filter.field] === filter.value;
                }
                return row?.[filter.field] === filter.value;
            });
        }

        async function execute() {
            await new Promise((resolve) => setImmediate(resolve));
            if (operation === 'insert') {
                const list = Array.isArray(patch) ? patch : [patch];
                const created = [];
                for (const row of list) {
                    const next = {
                        id: row.id || crypto.randomUUID(),
                        created_at: row.created_at || new Date().toISOString(),
                        ...row
                    };
                    rowsFor().push(next);
                    created.push(JSON.parse(JSON.stringify(next)));
                }
                return { data: created, error: null, count: null };
            }
            if (operation === 'update') {
                const rows = rowsFor().filter(matches);
                if (!rows.length) return { data: [], error: null, count: null };
                const nextPatch = JSON.parse(JSON.stringify(patch));
                for (const row of rows) Object.assign(row, nextPatch);
                return { data: rows.map((row) => JSON.parse(JSON.stringify(row))), error: null, count: null };
            }
            let rows = rowsFor().filter(matches).map((row) => JSON.parse(JSON.stringify(row)));
            const limitFilter = filters.find((filter) => filter.type === 'limit');
            const total = rows.length;
            if (rangeArgs) rows = rows.slice(rangeArgs.from, rangeArgs.to + 1);
            else if (limitFilter) rows = rows.slice(0, limitFilter.n);
            return { data: rows, error: null, count: countMode ? total : null };
        }
        return query;
    }

    const supabase = {
        from(table) {
            return {
                select(columns = '*', options) { return builder(table, 'select').select(columns, options); },
                update(patch) { return builder(table, 'update', patch); },
                insert(rows) { return builder(table, 'insert', rows); }
            };
        }
    };

    const handlers = createGuestShopHandlers({
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
        security,
        paymentAdapter: null,
        env: BASE_ENV
    });

    return { handlers, state };
}

function credentialHeader() {
    return security.buildGuestOrderCredentialHeader(EMAIL, PASSWORD);
}

function getReq(path, query = {}, headers = {}) {
    return {
        method: 'GET',
        url: path,
        query: { site: 'cn', ...query },
        headers: { 'user-agent': 'guest-test', ...headers }
    };
}

test('guest orders list and detail surface provider and channel from payment records', async () => {
    const { handlers } = createHarness();
    const resList = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', {}, {
        'x-guest-order-credential': credentialHeader()
    }), resList);

    assert.equal(resList.statusCode, 200);
    const orders = resList.payload?.orders || [];
    assert.equal(orders.length, 2);

    const usdtOrder = orders.find((o) => o.order_no === ORDER_NO_USDT);
    const alipayOrder = orders.find((o) => o.order_no === ORDER_NO_ALIPAY);

    assert.ok(usdtOrder, 'USDT order must exist in list response');
    assert.equal(usdtOrder.provider, 'nowpayments');
    assert.equal(usdtOrder.channel, 'usdtbsc');

    assert.ok(alipayOrder, 'Alipay order must exist in list response');
    assert.equal(alipayOrder.provider, 'zpay');
    assert.equal(alipayOrder.channel, 'alipay');

    // Also verify detail endpoint
    const resDetail = createResponse();
    await handlers.order(getReq('/api/shop/guest/order', { order_no: ORDER_NO_USDT }, {
        'x-guest-order-credential': credentialHeader()
    }), resDetail);

    assert.equal(resDetail.statusCode, 200);
    assert.equal(resDetail.payload?.order?.order_no, ORDER_NO_USDT);
    assert.equal(resDetail.payload?.order?.provider, 'nowpayments');
    assert.equal(resDetail.payload?.order?.channel, 'usdtbsc');
});

test('frontend resolvePaymentMethod maps usdtbsc to USDT and alipay to 支付宝, and unknown to 在线支付', () => {
    const clientCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'guest-orders-client.js'), 'utf8');

    const fnMatch = clientCode.match(/function resolvePaymentMethod\([\s\S]*?\n    \}/u);
    assert.ok(fnMatch, 'resolvePaymentMethod must exist in js/guest-orders-client.js');

    const sandbox = {
        normalizeText: (val) => String(val || '').trim(),
        normalizeSite: (val) => String(val || '').trim().toLowerCase()
    };
    vm.createContext(sandbox);
    vm.runInContext(fnMatch[0], sandbox);
    const { resolvePaymentMethod } = sandbox;

    // Test USDT/NOWPayments order
    const usdtResult = resolvePaymentMethod({
        provider: 'nowpayments',
        channel: 'usdtbsc',
        site: 'cn'
    });
    assert.equal(usdtResult.label, 'USDT');
    assert.equal(usdtResult.key, 'crypto');

    // Test Alipay order
    const alipayResult = resolvePaymentMethod({
        provider: 'zpay',
        channel: 'alipay',
        site: 'cn'
    });
    assert.equal(alipayResult.label, '支付宝');
    assert.equal(alipayResult.key, 'alipay');

    // Test Unknown/missing order
    const unknownResult = resolvePaymentMethod({
        site: 'cn'
    });
    assert.equal(unknownResult.label, '在线支付');
    assert.equal(unknownResult.key, 'online');
});
