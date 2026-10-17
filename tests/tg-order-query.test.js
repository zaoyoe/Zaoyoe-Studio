'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const adminPath = require.resolve('../api/_lib/admin');
const previousAdmin = require.cache[adminPath];
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: {} };
const { createTgOrderQueryHandlers } = require('../server/api-handlers/public/tg-order-query');
const { createTgPurchaseHandlers } = require('../server/api-handlers/public/tg-purchase');
const { createTgHandlers } = require('../server/api-handlers/public/tg');
if (previousAdmin) require.cache[adminPath] = previousAdmin;
else delete require.cache[adminPath];
const access = require('../server/tg/order-query');
const passwords = require('../api/_lib/guest-shop/security');

const ENV = { TG_PUBLIC_ORIGIN: 'https://tg.fatherkey.com', TG_REDEMPTION_CODE_PEPPER: 'tg-query-unit-test-independent-pepper-001', TG_PURCHASE_ENABLED: 'true', TG_REDEMPTION_ENABLED: 'true' };
const EMAIL = 'customer@example.test';
const PASSWORD = 'Qx7!vk9#Gr2w';
const OTHER_PASSWORD = 'Zr6@hx8$Pj4s';
const BUYER = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const OTHER_BUYER = 'f47ac10b-58cc-4372-a567-0e02b2c3d480';
const QUOTE = 'f47ac10b-58cc-4372-a567-0e02b2c3d481';
const PURCHASE = 'TGP-ABCDEFGHIJKLMNOPQRST';
const REDEMPTION = 'TG-ABCDEFGHIJKLMNOP';
const TOKEN = 't'.repeat(48);
const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex');
const CONTACT_HASH = access.contactHash(EMAIL, ENV);
const PASSWORD_HASH = passwords.hashGuestQueryPassword(PASSWORD);
const OTHER_HASH = passwords.hashGuestQueryPassword(OTHER_PASSWORD);
const ROW = { id: BUYER, contact_hash: CONTACT_HASH, password_hash: PASSWORD_HASH, group_no: 1 };
const ORDER = { order_no: PURCHASE, telegram_username: 'recipient_test', product_family: 'telegram_stars', term_months: null,
    stars_quantity: 50, currency: 'CNY', subtotal_minor: 700, payment_fee_minor: 7, payment_fee_rate_bps: 100,
    total_minor: 707, price_version: 3, payment_channel: 'alipay', payment_provider: 'zpay', payment_merchant_id: '12345',
    payment_status: 'awaiting_payment', fulfillment_status: 'not_started', created_at: '2026-10-16T00:00:00Z',
    status_token_hash: TOKEN_HASH, query_buyer_id: BUYER, password_hash: PASSWORD_HASH };
const REDEEM = { success: true, order_no: REDEMPTION, username: 'recipient_test', product_family: 'telegram_stars',
    term_months: null, stars_quantity: 50, status: 'pending', created_at: '2026-10-16T00:00:00Z', status_token_hash: TOKEN_HASH };
function requestSecurity(result = { allowed: true }) {
    const calls = [];
    return { calls, resolveClientIp: () => '192.0.2.1', _private: { isProductionLikeRuntime: () => true }, applyRateLimitHeaders() {},
        async takeRateLimitToken(input) { calls.push(input); return typeof result === 'function' ? result(input) : result; } };
}
function database({ rows = [ROW], ready = 1, rpc } = {}) {
    const calls = [];
    return { calls,
        from(table) {
            assert.equal(table, 'tg_order_query_buyers');
            const chain = { select(fields) { calls.push({ table, fields }); return this; }, eq(key, value) { assert.equal(key, 'contact_hash'); this.hash = value; return this; },
                order(key, options) { assert.equal(key, 'group_no'); assert.equal(options.ascending, true); return this; },
                async limit(count) { assert.equal(count, 6); const data = typeof rows === 'function' ? rows() : rows; return { data: data.filter(row => row.contact_hash === this.hash) }; } };
            return chain;
        },
        async rpc(name, args) {
            calls.push({ name, args });
            if (name === 'fn_tg_order_query_contract') return { data: ready };
            if (rpc) return rpc(name, args);
            if (name === 'fn_tg_query_orders') return { data: { total: 1, orders: [args.p_kind === 'purchase' ? ORDER : REDEEM] } };
            if (name === 'fn_tg_query_order_token_hash') return { data: args.p_buyer_id === BUYER && [PURCHASE, REDEMPTION].includes(args.p_order_no) ? TOKEN_HASH : null };
            if (name === 'fn_tg_purchase_status') return { data: { success: true, order: ORDER } };
            if (name === 'fn_tg_order_status') return { data: REDEEM };
            throw new Error(`Unexpected offline RPC ${name}`);
        } };
}
const admin = db => ({ getOptionalSupabaseAdmin: () => db });
function post(body, extra = {}) { return { method: 'POST', url: '/api/tg/orders/query', headers: { origin: ENV.TG_PUBLIC_ORIGIN, 'content-type': 'application/json' }, body, ...extra }; }
async function call(handler, request) {
    const res = { headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(key, value) { this.headers[key.toLowerCase()] = value; return this; }, end(value) { this.body = JSON.parse(value); } };
    await handler(request, res); return res;
}
const queryHandlers = (db, security = requestSecurity()) => createTgOrderQueryHandlers({ admin: admin(db), env: ENV, requestSecurity: security });
const authContext = db => ({ db, email: EMAIL, password: PASSWORD, env: ENV, requestSecurity: requestSecurity(), req: { headers: {} }, res: {} });
const credential = password => passwords.buildGuestOrderCredentialHeader(EMAIL, password);
function gateway() { return { channels: () => [{ id: 'alipay', label: '支付宝' }], identity: () => ({ provider: 'zpay', merchant_id: '12345' }),
    createPayment: async () => { throw new Error('Provider must not run in these tests'); } }; }

for (const kind of ['purchase', 'redeem']) test(`email query returns a sanitized ${kind} list using only the authenticated password group`, async () => {
    const db = database(); const security = requestSecurity();
    const res = await call(queryHandlers(db, security).query, post({ email: ' CUSTOMER@EXAMPLE.TEST ', password: PASSWORD, kind, page: 2 }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.page, 2); assert.equal(res.body.page_size, 20); assert.equal(res.body.total, 1);
    assert.equal(res.body.orders[0].order_no, kind === 'purchase' ? PURCHASE : REDEMPTION);
    assert.equal(res.body.orders[0].username, 'recipient_test');
    assert.deepEqual(db.calls.find(row => row.name === 'fn_tg_query_orders').args, { p_buyer_id: BUYER, p_kind: kind, p_order_no: null, p_page: 2 });
    const payload = JSON.stringify(res.body);
    for (const secret of [EMAIL, PASSWORD, PASSWORD_HASH, TOKEN_HASH, 'query_buyer_id', 'password_hash', 'status_token_hash']) assert.ok(!payload.includes(secret));
    assert.equal(res.headers['cache-control'], 'no-store'); assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(security.calls.length, 2); assert.equal(security.calls[1].limit, 20); assert.equal(security.calls[1].requirePersistent, true);
    assert.ok(!JSON.stringify(security.calls.map(row => row.key)).includes(EMAIL));
});

test('wrong passwords and unknown emails return the same denial and never query an order', async () => {
    const db = database(); const query = queryHandlers(db).query;
    const wrong = await call(query, post({ email: EMAIL, password: OTHER_PASSWORD }));
    const unknown = await call(query, post({ email: 'unknown@example.test', password: PASSWORD }));
    assert.equal(wrong.statusCode, 403); assert.equal(unknown.statusCode, 403); assert.deepEqual(wrong.body, unknown.body);
    assert.ok(!db.calls.some(row => row.name === 'fn_tg_query_orders'));
});

test('different passwords for one email authenticate to different groups and cannot cross order ownership', async () => {
    const db = database({ rows: [ROW, { ...ROW, id: OTHER_BUYER, group_no: 2, password_hash: OTHER_HASH }] });
    assert.equal(await access.authenticate(authContext(db)), BUYER);
    assert.equal(await access.authenticate({ ...authContext(db), password: OTHER_PASSWORD }), OTHER_BUYER);
    await assert.rejects(access.ownedTokenHash({ ...authContext(db), kind: 'purchase', orderNo: PURCHASE,
        req: { headers: { [access.HEADER]: credential(OTHER_PASSWORD) } } }), error => error.statusCode === 404);
    assert.equal(await access.ownedTokenHash({ ...authContext(db), kind: 'purchase', orderNo: PURCHASE,
        req: { headers: { [access.HEADER]: credential(PASSWORD) } } }), TOKEN_HASH);
});

test('creation reuses a verified salted password group and normalizes email without storing plaintext', async () => {
    const db = database();
    assert.equal(await access.prepareCreation(db, { query_email: ' CUSTOMER@EXAMPLE.TEST ', query_password: PASSWORD }, ENV), BUYER);
    assert.ok(!db.calls.some(row => row.name === 'fn_tg_upsert_query_buyer'));
    const empty = database({ rows: [], rpc: async (name, args) => {
        assert.equal(name, 'fn_tg_upsert_query_buyer'); assert.equal(args.p_contact_hash, CONTACT_HASH);
        assert.equal(args.p_expected_groups, 0); assert.ok(passwords.verifyGuestQueryPassword(PASSWORD, args.p_password_hash).ok);
        assert.notEqual(args.p_password_hash, PASSWORD_HASH); return { data: { buyer_id: BUYER } };
    } });
    assert.equal(await access.prepareCreation(empty, { query_email: EMAIL, query_password: PASSWORD }, ENV), BUYER);
    const writes = JSON.stringify(empty.calls.filter(row => row.name === 'fn_tg_upsert_query_buyer'));
    assert.ok(!writes.includes(EMAIL)); assert.ok(!writes.includes(PASSWORD));
});

test('concurrent buyer allocation rechecks salted hashes instead of allocating another group', async () => {
    let inserted = false;
    const db = database({ rows: () => inserted ? [ROW] : [], rpc: async name => { assert.equal(name, 'fn_tg_upsert_query_buyer'); inserted = true; return { data: { code: 'retry' } }; } });
    assert.equal(await access.prepareCreation(db, { query_email: EMAIL, query_password: PASSWORD }, ENV), BUYER);
    assert.equal(db.calls.filter(row => row.name === 'fn_tg_upsert_query_buyer').length, 1);
});

test('password group cap and malformed stored hashes fail closed', async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({ ...ROW, id: `${BUYER.slice(0, -1)}${index}`, group_no: index + 1, password_hash: OTHER_HASH }));
    await assert.rejects(access.prepareCreation(database({ rows }), { query_email: EMAIL, query_password: PASSWORD }, ENV), error => error.code === 'order_query_group_limit');
    await assert.rejects(access.authenticate(authContext(database({ rows: [{ ...ROW, password_hash: 'not-a-scrypt-hash' }] }))), error => error.statusCode === 503);
});

test('migration readiness preserves bearer callers but blocks partially supplied or unavailable email creation', async () => {
    const db = database({ ready: 0 });
    assert.equal(await access.prepareCreation(db, {}, ENV), null); assert.equal(db.calls.length, 0);
    await assert.rejects(access.prepareCreation(db, { query_email: EMAIL, query_password: PASSWORD }, ENV), error => error.statusCode === 503);
    for (const input of [{ query_email: EMAIL }, { query_password: PASSWORD }, { query_email: EMAIL, query_password: 'weak' }]) {
        await assert.rejects(access.prepareCreation(database(), input, ENV), error => error.statusCode === 400);
    }
});

test('query rejects methods, origins, oversized bodies, URL credentials and invalid pagination before order reads', async () => {
    const db = database(); const handler = queryHandlers(db).query;
    const cases = [
        [post({}, { method: 'GET' }), 405], [post({}, { headers: { origin: 'https://evil.example' } }), 403],
        [post({ email: EMAIL, password: PASSWORD }, { url: '/api/tg/orders/query?password=secret' }), 400],
        [post({ email: EMAIL, password: PASSWORD, extra: 'x'.repeat(8192) }), 413],
        ...[0, -1, '2', 1.5, 10001].map(page => [post({ email: EMAIL, password: PASSWORD, page }), 400]),
        [post({ email: EMAIL, password: PASSWORD, kind: '__proto__' }), 400],
        [post({ email: EMAIL, password: PASSWORD, order_no: REDEMPTION }), 400],
        [post({ email: EMAIL, password: PASSWORD, order_no: 123 }), 400]
    ];
    for (const [req, expected] of cases) assert.equal((await call(handler, req)).statusCode, expected);
    assert.ok(!db.calls.some(row => row.table || row.name));
});

test('IP and email rate limits reject with no order read and no database errors exposed', async () => {
    const db = database();
    for (const unavailable of [false, true]) {
        const res = await call(queryHandlers(db, requestSecurity({ allowed: false, unavailable })).query, post({ email: EMAIL, password: PASSWORD }));
        assert.equal(res.statusCode, unavailable ? 503 : 429);
    }
    const rate = requestSecurity(input => ({ allowed: !input.key.includes(':email:') }));
    assert.equal((await call(queryHandlers(db, rate).query, post({ email: EMAIL, password: PASSWORD }))).statusCode, 429);
    assert.ok(!db.calls.some(row => row.name === 'fn_tg_query_orders'));
    const broken = database({ rpc: async () => ({ error: { message: 'database password=must-stay-private' } }) });
    const res = await call(queryHandlers(broken).query, post({ email: EMAIL, password: PASSWORD }));
    assert.equal(res.statusCode, 503); assert.ok(!JSON.stringify(res.body).includes('must-stay-private'));
});

test('query validates returned snapshots, duplicate numbers and exact order filtering', async () => {
    for (const result of [{ orders: [ORDER, ORDER], total: 2 }, { orders: [ORDER], total: 0 }, { orders: [{ ...ORDER, payment_status: 'invented' }], total: 1 }]) {
        const db = database({ rpc: async () => ({ data: result }) });
        assert.equal((await call(queryHandlers(db).query, post({ email: EMAIL, password: PASSWORD }))).statusCode, 503);
    }
    const db = database();
    const res = await call(queryHandlers(db).query, post({ email: EMAIL, password: PASSWORD, order_no: ' tgp-00000000000000000000 ' }));
    assert.equal(res.statusCode, 503);
    assert.equal(db.calls.find(row => row.name === 'fn_tg_query_orders').args.p_order_no, 'TGP-00000000000000000000');
});

for (const kind of ['purchase', 'redeem']) test(`historical ${kind} binding requires original proof before allocating a buyer and cannot rebind`, async () => {
    let proofValid = false; const orderNo = kind === 'purchase' ? PURCHASE : REDEMPTION;
    const db = database({ rows: [], rpc: async (name, args) => {
        if (name.endsWith('_status')) return { data: { success: proofValid } };
        if (name === 'fn_tg_upsert_query_buyer') return { data: { buyer_id: BUYER } };
        if (name === 'fn_tg_bind_query_order') {
            assert.deepEqual(args, { p_kind: kind, p_order_no: orderNo, p_status_token_hash: TOKEN_HASH, p_buyer_id: BUYER });
            return { error: { message: 'tg_query_binding_conflict database-private-value' } };
        }
        throw new Error(name);
    } });
    const req = post({ kind, order_no: orderNo, email: EMAIL, password: PASSWORD }, { headers: { origin: ENV.TG_PUBLIC_ORIGIN, 'x-tg-status-token': TOKEN } });
    assert.equal((await call(queryHandlers(db).bind, req)).statusCode, 404);
    assert.ok(!db.calls.some(row => row.table || row.name === 'fn_tg_upsert_query_buyer'));
    proofValid = true;
    const conflict = await call(queryHandlers(db).bind, req);
    assert.equal(conflict.statusCode, 409); assert.equal(conflict.body.code, 'order_query_binding_conflict');
    assert.ok(!JSON.stringify(conflict.body).includes('database-private-value'));
});

test('successful historical binding preserves the original bearer and only returns a confirmation', async () => {
    const db = database({ rpc: async name => ({ data: name === 'fn_tg_bind_query_order' ? true : { success: true } }) });
    const req = post({ kind: 'purchase', order_no: PURCHASE, email: EMAIL, password: PASSWORD }, { headers: { 'x-tg-status-token': TOKEN } });
    const res = await call(queryHandlers(db).bind, req);
    assert.equal(res.statusCode, 200); assert.equal(res.body.success, true);
    assert.ok(!JSON.stringify(res.body).includes(TOKEN));
    assert.ok(!db.calls.some(row => /rotate|update_status_token|upsert/.test(row.name || '')));
});

for (const kind of ['purchase', 'redeem']) test(`email credentials authorize existing ${kind} status without revealing the internal hash`, async () => {
    const db = database();
    const options = { admin: admin(db), env: ENV, requestSecurity: requestSecurity(), gateway: gateway() };
    const handler = kind === 'purchase' ? createTgPurchaseHandlers(options).status : createTgHandlers(options).status;
    const orderNo = kind === 'purchase' ? PURCHASE : REDEMPTION;
    const res = await call(handler, { method: 'GET', url: `/api/tg/${kind}/status?order_no=${orderNo}`, headers: { [access.HEADER]: credential(PASSWORD) } });
    assert.equal(res.statusCode, 200);
    const read = db.calls.find(row => row.name === (kind === 'purchase' ? 'fn_tg_purchase_status' : 'fn_tg_order_status'));
    assert.equal(read.args.p_status_token_hash, TOKEN_HASH); assert.ok(!JSON.stringify(res.body).includes(TOKEN_HASH));
});

test('email cancellation checks password-group ownership before provider calls or cancellation writes', async () => {
    const db = database({ rows: [ROW, { ...ROW, id: OTHER_BUYER, group_no: 2, password_hash: OTHER_HASH }] });
    const handler = createTgPurchaseHandlers({ admin: admin(db), env: ENV, requestSecurity: requestSecurity(), gateway: gateway() }).cancel;
    const res = await call(handler, post({ order_no: PURCHASE }, { headers: { [access.HEADER]: credential(OTHER_PASSWORD) } }));
    assert.equal(res.statusCode, 404);
    assert.ok(!db.calls.some(row => ['fn_tg_purchase_status', 'fn_tg_cancel_purchase'].includes(row.name)));
});

test('purchase and redemption use the atomic query-binding wrappers and stop before provider activity on conflicts', async () => {
    for (const kind of ['purchase', 'redeem']) {
        const wrapper = kind === 'purchase' ? 'fn_tg_create_purchase_with_query' : 'fn_tg_reserve_code_with_query';
        const db = database({ rpc: async name => {
            assert.equal(name, wrapper); return { error: { message: 'tg_query_binding_conflict' } };
        } });
        const options = { admin: admin(db), env: ENV, requestSecurity: requestSecurity(), gateway: gateway() };
        const input = { query_email: EMAIL, query_password: PASSWORD, username: 'recipient_test', status_token: TOKEN, idempotency_key: 'tg-query-offline-idempotency-001' };
        const handler = kind === 'purchase' ? createTgPurchaseHandlers(options).orders : createTgHandlers(options).redeem;
        if (kind === 'purchase') Object.assign(input, { quote_id: QUOTE, product_id: 'stars', stars_quantity: 50, expected_total_minor: 707, price_version: 3, channel: 'alipay' });
        else input.code = 'TG-PREM-12345678-12345678-12345678-12345678';
        const res = await call(handler, post(input));
        assert.equal(res.statusCode, 409);
        const creation = db.calls.find(row => row.name === wrapper);
        assert.equal(creation.args.p_buyer_id, BUYER);
        assert.equal(creation.args.p_request.p_status_token_hash, TOKEN_HASH);
        assert.ok(!JSON.stringify(creation.args).includes(PASSWORD)); assert.ok(!JSON.stringify(creation.args).includes(EMAIL));
        assert.ok(!db.calls.some(row => ['fn_tg_create_purchase', 'fn_tg_reserve_code', 'fn_tg_claim_checkout'].includes(row.name)));
    }
});

const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261016_tg_order_email_query.sql'), 'utf8');
const verifier = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261016_verify_tg_order_email_query.sql'), 'utf8');
test('SQL migration gives no public table/function access and uses fixed search paths', () => {
    assert.match(migration, /ALTER TABLE public\.tg_order_query_buyers ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, /REVOKE ALL ON TABLE public\.tg_order_query_buyers FROM PUBLIC, anon, authenticated/);
    assert.doesNotMatch(migration, /(?:email|password)\s+TEXT\b/i);
    const functions = [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(fn_tg_\w+)\(/g)].map(row => row[1]);
    assert.equal(functions.length, 7);
    assert.equal((migration.match(/SECURITY DEFINER SET search_path = public, pg_temp/g) || []).length, 7);
    for (const name of functions) {
        assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]+ FROM PUBLIC, anon, authenticated;`));
        assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]+ TO service_role;`));
        assert.ok(verifier.includes(`'${name}'`));
    }
    assert.doesNotMatch(verifier, /\b(?:UPDATE|INSERT INTO|DELETE FROM)\b/);
});

test('SQL ownership binding locks each order, refuses reassignment and rolls back failed atomic creation', () => {
    const section = (first, last) => migration.slice(migration.indexOf(`FUNCTION public.${first}`), migration.indexOf(`FUNCTION public.${last}`));
    const bind = section('fn_tg_bind_query_order', 'fn_tg_create_purchase_with_query');
    assert.equal((bind.match(/status_token_hash = p_status_token_hash FOR UPDATE/g) || []).length, 2);
    assert.equal((bind.match(/v_buyer IS NOT NULL AND v_buyer <> p_buyer_id THEN RAISE EXCEPTION/g) || []).length, 2);
    for (const [first, last] of [['fn_tg_create_purchase_with_query', 'fn_tg_reserve_code_with_query'], ['fn_tg_reserve_code_with_query', 'fn_tg_query_order_token_hash']]) {
        const wrapper = section(first, last);
        assert.match(wrapper, /AND NOT public\.fn_tg_bind_query_order\([\s\S]+THEN RAISE EXCEPTION 'tg_query_bind_unconfirmed'/);
        assert.doesNotMatch(wrapper, /EXCEPTION WHEN/);
    }
    const list = section('fn_tg_query_orders', 'fn_tg_order_query_contract');
    assert.equal((list.match(/WHERE query_buyer_id = p_buyer_id AND/g) || []).length, 4);
    assert.equal((list.match(/ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET \(p_page - 1\) \* 20/g) || []).length, 2);
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(migration, /v_count <> p_expected_groups THEN RETURN jsonb_build_object\('code', 'retry'\)/);
});

for (const payment of [
    { name: 'paid refund', payment_status: 'paid', paid_at: '2026-10-16T11:00:00Z', completion_outcome: 'refunded' },
    { name: 'unverified payment review', payment_status: 'manual_review', paid_at: null, completion_outcome: 'no_valid_payment' }
]) test(`email order query preserves completion status and customer explanation while hiding internal settlement evidence: ${payment.name}`, async () => {
    const note = '本订单已协商处理完毕，后续问题请凭订单号联系我们。';
    const db = database({ rpc: async name => {
        assert.equal(name, 'fn_tg_query_orders');
        return { data: { total: 1, orders: [{ ...ORDER, ...payment, fulfillment_status: payment.paid_at ? 'cancelled' : 'not_started', closed_at: '2026-10-17T11:00:00Z',
            checkout_url: 'https://pay.example.test/expired-checkout', completion_note: note, close_note: 'private-verification-record',
            completion_request_hash: 'private-request-hash', closed_by: BUYER }] } };
    } });
    const res = await call(queryHandlers(db).query, post({ email: EMAIL, password: PASSWORD, kind: 'purchase' }));
    assert.equal(res.statusCode, 200); assert.equal(res.body.orders[0].fulfillment_status, 'closed'); assert.equal(res.body.orders[0].completion_note, note);
    assert.equal(res.body.orders[0].payment_status, payment.payment_status); assert.equal(res.body.orders[0].checkout_url, undefined);
    assert.equal(res.body.orders[0].can_close, false);
    assert.doesNotMatch(JSON.stringify(res.body), /private-|close_note|completion_outcome|completion_request_hash|closed_by/);
});

test('token lookup and authenticated email lookup return the same public redemption closure', async () => {
    const closed = { ...REDEEM, status: 'closed', closed_at: '2026-10-17T10:00:00Z', completion_note: '已完成协商处理，原兑换码已作废。',
        note: 'PRIVATE-STAFF-EVIDENCE', closed_by: BUYER, provider_idempotency_key: 'PRIVATE-SUBMISSION-KEY', code_disposition: 'revoked' };
    const db = database({ rpc: async name => name === 'fn_tg_query_orders' ? { data: { total: 1, orders: [closed] } }
        : name === 'fn_tg_order_status' ? { data: closed } : { data: null } });
    const email = await call(queryHandlers(db).query, post({ kind: 'redeem', email: EMAIL, password: PASSWORD }));
    const token = await call(createTgHandlers({ admin: admin(db), env: ENV, requestSecurity: requestSecurity() }).status,
        { method: 'GET', url: `/api/tg/status?order_no=${REDEMPTION}`, headers: { 'x-tg-status-token': TOKEN } });
    assert.equal(email.statusCode, 200); assert.equal(token.statusCode, 200); assert.deepEqual(email.body.orders[0], token.body);
    assert.equal(token.body.status, 'closed'); assert.equal(token.body.completion_note, closed.completion_note);
    assert.doesNotMatch(JSON.stringify([token.body, email.body]), /PRIVATE|closed_by|disposition|status_token_hash/);
});
