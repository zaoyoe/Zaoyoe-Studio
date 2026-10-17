'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
// Factories inject a fully offline database. Do not initialize the production
// Supabase SDK or read runtime credentials while loading the handler.
const adminPath = require.resolve('../api/_lib/admin');
const previousAdmin = require.cache[adminPath];
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: {} };
const { createAdminOrderQueryHandler } = require('../server/api-handlers/admin/tg/order-query');
if (previousAdmin) require.cache[adminPath] = previousAdmin;
else delete require.cache[adminPath];
const orderQuery = require('../server/tg/order-query');

const ENV = { APP_ENV: 'production', TG_REDEMPTION_CODE_PEPPER: 'tg-admin-query-test-independent-pepper-001' };
const ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const OTHER_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d480';
const TASK_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d481';
const PURCHASE = 'TGP-ABCDEFGHIJKLMNOPQRST';
const REDEMPTION = 'TG-ABCDEFGHIJKLMNOP';
const EMAIL = 'customer@example.test';
const PRIVATE = 'never-expose-private-bearer-or-password';
const BUY = { id: ID, order_no: PURCHASE, telegram_username: 'recipient_test', product_family: 'telegram_stars',
    term_months: null, stars_quantity: 50, currency: 'CNY', subtotal_minor: 700, payment_fee_minor: 7,
    payment_fee_rate_bps: 100, total_minor: 707, price_version: 3, payment_channel: 'alipay',
    payment_status: 'awaiting_payment', created_at: '2026-10-16T00:00:00Z', updated_at: '2026-10-16T00:01:00Z',
    payment_expires_at: '2026-10-16T00:20:00Z', status_token_hash: PRIVATE, query_buyer_id: OTHER_ID, password_hash: PRIVATE,
    payment_merchant_id: PRIVATE, checkout_url: 'https://private-checkout.example.test' };
const REDEEM = { id: TASK_ID, order_no: REDEMPTION, telegram_username: 'recipient_test', product_family: 'telegram_stars',
    term_months: null, stars_quantity: 50, status: 'processing', created_at: BUY.created_at, updated_at: BUY.updated_at,
    status_token_hash: PRIVATE, code_ciphertext: PRIVATE, upstream_order_id: PRIVATE };
const CRYPTO = { payment_id: '1234567890', pay_currency: 'usdtbsc', pay_amount: '1.01', pay_address: `0x${'a'.repeat(40)}`,
    price_currency: 'usdtbsc', price_amount_minor: 101, quote_expires_at: BUY.payment_expires_at };
function database(options = {}) {
    const calls = [];
    return { calls,
        async rpc(name, args) {
            calls.push({ name, args });
            assert.equal(name, 'fn_tg_order_query_contract', 'search must not write or invoke fulfillment RPCs');
            return options.contractError ? { error: new Error(PRIVATE) } : { data: options.ready ?? 1 };
        },
        from(table) {
            const call = { table, filters: [], orders: [] }; calls.push(call);
            const resolve = () => {
                if (table === 'tg_order_query_buyers') return options.buyerError ? { error: new Error(PRIVATE) } : { data: options.buyers ?? [{ id: OTHER_ID }] };
                if (table === 'tg_redemption_orders' && call.fields === 'purchase_id,status') return options.taskError ? { error: new Error(PRIVATE) } : { data: options.tasks ?? [] };
                return options.orderError ? { error: new Error(PRIVATE) } : { data: Object.hasOwn(options, 'rows') ? options.rows : [table === 'tg_purchase_orders' ? BUY : REDEEM], count: Object.hasOwn(options, 'count') ? options.count : 1 };
            };
            return { select(fields, config) { call.fields = fields; call.config = config; return this; },
                eq(key, value) { call.filters.push(['eq', key, value]); return this; },
                in(key, value) { call.filters.push(['in', key, value]); return this; },
                order(key, value) { call.orders.push([key, value]); return this; },
                range(from, to) { call.range = [from, to]; return this; }, limit(value) { call.limit = value; return this; },
                then(resolvePromise, reject) { return Promise.resolve(resolve()).then(resolvePromise, reject); } };
        } };
}
function request(body = { kind: 'purchase', search_by: 'email', query: EMAIL }, overrides = {}) {
    return { method: 'POST', url: '/api/admin/tg/order-query', headers: { origin: 'https://tg.adm.fatherkey.com', 'content-type': 'application/json' }, body, ...overrides };
}
function setup(options = {}) {
    const db = database(options); const activity = [];
    const admin = {
        async requireAdmin() { activity.push('authenticate'); if (options.authError) throw Object.assign(new Error('Unauthorized'), { statusCode: options.authError }); return { supabase: db, isSuperAdmin: options.isSuperAdmin !== false }; },
        async parseJsonBody(req) { activity.push('parse'); if (options.parseError) throw new Error(PRIVATE); return req.body; },
        sendJson(res, code, body) { res.statusCode = code; res.body = body; }
    };
    return { db, activity, handler: createAdminOrderQueryHandler({ admin, env: options.env || ENV }) };
}
async function call(handler, req = request()) {
    const res = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; } };
    await handler(req, res); return res;
}
function noSecrets(res) {
    const payload = JSON.stringify(res.body);
    for (const value of [PRIVATE, EMAIL, 'password_hash', 'status_token_hash', 'query_buyer_id', 'code_ciphertext', 'pay_address', 'checkout_url']) assert.ok(!payload.includes(value), value);
    assert.equal(res.headers['cache-control'], 'no-store'); assert.equal(res.headers['referrer-policy'], 'no-referrer'); assert.equal(res.headers['x-content-type-options'], 'nosniff');
}

test('admin order query accepts only POST and never authenticates other methods', async () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const { handler, activity, db } = setup(); const res = await call(handler, request(undefined, { method }));
        assert.equal(res.statusCode, 405); assert.equal(res.headers.allow, 'POST'); assert.equal(activity.length, 0); assert.equal(db.calls.length, 0); noSecrets(res);
    }
});

test('admin order query requires verified super administrator before reading or parsing', async () => {
    for (const options of [{ authError: 401 }, { authError: 403 }, { isSuperAdmin: false }]) {
        const { handler, db, activity } = setup(options); const res = await call(handler);
        assert.equal(res.statusCode, options.authError || 403); assert.deepEqual(activity, ['authenticate']); assert.equal(db.calls.length, 0); noSecrets(res);
    }
});

test('admin order query rejects foreign, missing and malformed origins and requires JSON', async () => {
    for (const origin of [undefined, 'null', 'https://tg.fatherkey.com', 'https://www.fatherkey.com', 'https://tg.adm.fatherkey.com.evil.test', 'https://tg.adm.fatherkey.com/path']) {
        const { handler, db, activity } = setup();
        const res = await call(handler, request(undefined, { headers: { origin, 'content-type': 'application/json' } }));
        assert.equal(res.statusCode, 403); assert.deepEqual(activity, ['authenticate']); assert.equal(db.calls.length, 0);
    }
    const { handler, db, activity } = setup();
    const res = await call(handler, request(undefined, { headers: { origin: 'https://tg.adm.fatherkey.com', 'content-type': 'text/plain' } }));
    assert.equal(res.statusCode, 415); assert.deepEqual(activity, ['authenticate']); assert.equal(db.calls.length, 0);
});

test('local admin search is allowed only for a matching development loopback origin', async () => {
    for (const [env, origin, expected] of [[{}, 'http://127.0.0.1:8000', 200], [{ NODE_ENV: 'production' }, 'http://127.0.0.1:8000', 403], [{}, 'http://localhost:8000', 403]]) {
        const { handler } = setup({ env, rows: [], count: 0 });
        const res = await call(handler, request({ kind: 'purchase', search_by: 'order_no', query: PURCHASE }, { headers: { host: '127.0.0.1:8000', origin, 'content-type': 'application/json' } }));
        assert.equal(res.statusCode, expected);
    }
});

test('admin query credentials in URLs are rejected before parsing', async () => {
    for (const key of ['email', 'password', 'query_email', 'query_password', 'credential']) {
        const { handler, db, activity } = setup(); const res = await call(handler, request(undefined, { url: `/api/admin/tg/order-query?${key}=do-not-log` }));
        assert.equal(res.statusCode, 400); assert.deepEqual(activity, ['authenticate']); assert.equal(db.calls.length, 0);
    }
});

test('admin order query validates all input before accessing the database', async () => {
    for (const body of [null, [], {}, { kind: 'all', search_by: 'email', query: EMAIL }, { kind: 'purchase', search_by: 'password', query: EMAIL },
        { kind: 'purchase', search_by: 'email', query: 'invalid' }, { kind: 'purchase', search_by: 'email', query: `${EMAIL}\n` },
        ...['', 10, 'a'.repeat(321)].map(query => ({ kind: 'purchase', search_by: 'email', query })),
        ...[0, -1, 1.5, '2', 10001].map(page => ({ kind: 'purchase', search_by: 'email', query: EMAIL, page })),
        { kind: 'purchase', search_by: 'order_no', query: REDEMPTION }, { kind: 'redeem', search_by: 'order_no', query: PURCHASE },
        ...['@abc', '@@recipient', 'bad%_name', 'hello@example.test'].map(query => ({ kind: 'redeem', search_by: 'username', query }))]) {
        const { handler, db } = setup(); const res = await call(handler, request(body));
        assert.equal(res.statusCode, 400, JSON.stringify(body)); assert.equal(db.calls.length, 0);
    }
    const { handler, db } = setup({ parseError: true }); const res = await call(handler);
    assert.equal(res.statusCode, 400); assert.equal(db.calls.length, 0); noSecrets(res);
});

for (const kind of ['purchase', 'redeem']) test(`admin email query finds all password groups for ${kind}, reads no password, and paginates by twenty`, async () => {
    const { handler, db } = setup({ buyers: [{ id: ID }, { id: OTHER_ID }], count: 43 });
    const res = await call(handler, request({ kind, search_by: 'email', query: ' CUSTOMER@EXAMPLE.TEST ', page: 2 }));
    assert.equal(res.statusCode, 200); assert.equal(res.body.kind, kind); assert.equal(res.body.page, 2); assert.equal(res.body.page_size, 20); assert.equal(res.body.total, 43);
    assert.equal(res.body.orders[0].username, 'recipient_test'); assert.equal(res.body.orders[0].order_no, kind === 'purchase' ? PURCHASE : REDEMPTION);
    const buyer = db.calls.find(row => row.table === 'tg_order_query_buyers');
    assert.equal(buyer.fields, 'id'); assert.equal(buyer.limit, 6); assert.deepEqual(buyer.filters, [['eq', 'contact_hash', orderQuery.contactHash(EMAIL, ENV)]]);
    const orders = db.calls.find(row => row.table === (kind === 'purchase' ? 'tg_purchase_orders' : 'tg_redemption_orders'));
    assert.deepEqual(orders.filters, [...(kind === 'redeem' ? [['eq', 'order_source', 'redemption']] : []), ['in', 'query_buyer_id', [ID, OTHER_ID]]]);
    assert.deepEqual(orders.range, [20, 39]); assert.deepEqual(orders.config, { count: 'exact' });
    assert.deepEqual(orders.orders, [['created_at', { ascending: false }], ['id', { ascending: false }]]);
    assert.ok(!/password|token|merchant|ciphertext/.test(orders.fields)); noSecrets(res);
});

test('unknown admin email returns an empty list without querying orders', async () => {
    const { handler, db } = setup({ buyers: [] }); const res = await call(handler);
    assert.equal(res.statusCode, 200); assert.deepEqual(res.body.orders, []); assert.equal(res.body.total, 0);
    assert.equal(db.calls.filter(row => row.table).length, 1); noSecrets(res);
});

test('admin email query reports missing migration while order number and username search remain available', async () => {
    for (const options of [{ ready: 0 }, { contractError: true }]) {
        const { handler, db } = setup(options); const res = await call(handler);
        assert.equal(res.statusCode, 503); assert.equal(res.body.code, 'order_query_migration_required'); assert.match(res.body.message, /订单号.*用户名/); noSecrets(res);
        assert.equal(db.calls.filter(row => row.table).length, 0);
    }
    for (const [kind, search_by, query, key, expected] of [['purchase', 'order_no', PURCHASE.toLowerCase(), 'order_no', PURCHASE], ['redeem', 'username', ' @Recipient_Test ', 'telegram_username', 'recipient_test']]) {
        const { handler, db } = setup({ ready: 0 }); const res = await call(handler, request({ kind, search_by, query }));
        assert.equal(res.statusCode, 200); assert.ok(!db.calls.some(row => row.name));
        assert.ok(db.calls.some(row => row.filters?.some(filter => filter[0] === 'eq' && filter[1] === key && filter[2] === expected))); noSecrets(res);
    }
});

for (const status of ['pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled']) test(`admin paid purchase exposes the persisted fulfillment status ${status}`, async () => {
    const { handler } = setup({ rows: [{ ...BUY, payment_status: 'paid' }], tasks: [{ purchase_id: ID, status }] });
    const res = await call(handler); assert.equal(res.statusCode, 200); assert.equal(res.body.orders[0].payment_status, 'paid'); assert.equal(res.body.orders[0].fulfillment_status, status); noSecrets(res);
});

test('admin pending and paid orders without a fulfillment task never claim delivery is complete', async () => {
    for (const payment_status of ['awaiting_payment', 'checkout_creating', 'paid', 'manual_review', 'cancelled', 'expired']) {
        const { handler } = setup({ rows: [{ ...BUY, payment_status }] }); const res = await call(handler);
        assert.equal(res.statusCode, 200); assert.equal(res.body.orders[0].fulfillment_status, 'not_started'); noSecrets(res);
    }
});

test('admin crypto query exposes the exact USDT amount and network without checkout credentials or address', async () => {
    const { handler } = setup({ rows: [{ ...BUY, payment_channel: 'usdt_bep20', crypto_checkout: CRYPTO }] }); const res = await call(handler);
    assert.equal(res.statusCode, 200); assert.equal(res.body.orders[0].crypto_pay_amount, '1.01'); assert.equal(res.body.orders[0].crypto_network, 'BSC (BEP20)');
    assert.ok(!JSON.stringify(res.body).includes(CRYPTO.payment_id)); assert.ok(!Object.hasOwn(res.body.orders[0], 'crypto_checkout')); noSecrets(res);
});

test('admin query fails closed for invalid indexes, malformed orders or conflicting fulfillment data', async () => {
    for (const options of [{ buyerError: true }, { buyers: [{ id: 'bad-id' }] }, { buyers: Array(6).fill({ id: ID }) },
        { orderError: true }, { count: null, rows: null }, { count: -1 }, { count: '1' }, { rows: Array(21).fill(BUY) },
        { rows: [{ ...BUY, id: 'invalid' }] }, { rows: [{ ...BUY, total_minor: 1 }] }, { rows: [{ ...BUY, payment_status: 'unknown' }] },
        { taskError: true }, { tasks: [{ purchase_id: OTHER_ID, status: 'succeeded' }] }, { tasks: [{ purchase_id: ID, status: 'unknown' }] },
        { tasks: [{ purchase_id: ID, status: 'succeeded' }, { purchase_id: ID, status: 'pending' }] }]) {
        const { handler } = setup(options); const res = await call(handler);
        assert.equal(res.statusCode, 500, JSON.stringify(options)); assert.equal(res.body.orders, undefined); noSecrets(res);
    }
    const { handler } = setup({ rows: [{ ...REDEEM, status: 'unknown' }] });
    assert.equal((await call(handler, request({ kind: 'redeem', search_by: 'order_no', query: REDEMPTION }))).statusCode, 500);
});

test('admin query route is registered in the common dispatcher and does not invoke writes or providers', () => {
    const source = fs.readFileSync(require.resolve('../server/api-handlers/admin/tg/order-query'), 'utf8');
    const dispatcher = fs.readFileSync(require.resolve('../api/admin'), 'utf8');
    assert.match(dispatcher, /'tg\/order-query': tgOrderQueryHandler/);
    assert.doesNotMatch(source, /\.(insert|update|upsert|delete)\(|fetch\(|createPayment|worker\.run|query_password/);
});

test('a closed purchase search stays completed even though its stopped fulfillment task is cancelled', async () => {
    const f = setup({ rows: [{ ...BUY, payment_status: 'paid', closed_at: '2026-10-17T11:00:00Z' }], tasks: [{ purchase_id: ID, status: 'cancelled' }] });
    const res = await call(f.handler, request({ kind: 'purchase', search_by: 'order_no', query: PURCHASE }));
    assert.equal(res.statusCode, 200); assert.equal(res.body.orders[0].fulfillment_status, 'closed');
    assert.ok(f.db.calls.some(call => call.table === 'tg_purchase_orders' && call.fields?.split(',').includes('closed_at')));
});
