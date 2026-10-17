'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const adminPath = require.resolve('../api/_lib/admin');
const cachedAdmin = require.cache[adminPath];
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: {} };
const { createOrdersHandler } = require('../server/api-handlers/admin/tg/orders');
const { createPurchasesHandler } = require('../server/api-handlers/admin/tg/purchases');
const { createCodesHandler } = require('../server/api-handlers/admin/tg/codes');
const { createTgHandlers, digest, tokenHash } = require('../server/api-handlers/public/tg');
const { createTgPurchaseHandlers } = require('../server/api-handlers/public/tg-purchase');
if (cachedAdmin) require.cache[adminPath] = cachedAdmin; else delete require.cache[adminPath];

const ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const ACTOR = 'f47ac10b-58cc-4372-a567-0e02b2c3d480';
const VERSION = '2026-10-17T10:00:00.000Z';
const CODE = 'TG-PREM-12345678-12345678-12345678-12345678';
const TOKEN = 'a'.repeat(64);
const ENV = { NODE_ENV: 'production', TG_REDEMPTION_ENABLED: 'true', TG_PURCHASE_ENABLED: 'false', TG_REDEMPTION_CODE_PEPPER: 'test-only-independent-code-pepper-12345678' };
const HEADERS = { origin: 'https://tg.adm.fatherkey.com', 'content-type': 'application/json' };
const ENTITLEMENT = { product_family: 'telegram_premium', term_months: 3, stars_quantity: null };
const ORDER = { id: ID, order_no: 'TG-ABCDEFGHIJKLMNOPQRST', order_source: 'redemption', ...ENTITLEMENT,
    telegram_username: 'telegram_user', status: 'manual_review', provider_order_id: ID, provider_payment_currency: 'usdt',
    provider_idempotency_key: 'private-key', submitted_at: VERSION, updated_at: VERSION };
const PURCHASE = { id: ID, order_no: 'TGP-ABCDEFGHIJKLMNOPQRST', ...ENTITLEMENT, telegram_username: 'telegram_user',
    currency: 'CNY', total_minor: 12000, subtotal_minor: 12000, payment_fee_minor: 0, payment_fee_rate_bps: 0, price_version: 2, payment_channel: 'alipay', payment_provider: 'zpay',
    payment_status: 'awaiting_payment', fulfillment_status: 'not_started', created_at: VERSION, updated_at: VERSION,
    payment_expires_at: '2026-10-18T00:00:00Z', can_close: true };
const PROVIDER = { statusCode: 200, data: { id: ID, recipientName: 'telegram_user', type: 'premium_3_month',
    method: 'api', status: 'completed', currency: 'usd', amount: '12.00', secret: 'never-return-provider-payload' } };

function db(rows = {}, result = { success: true }) {
    const calls = [];
    return { calls, async rpc(name, args) { calls.push(['rpc', name, args]); return { data: typeof result === 'function' ? result(name, args) : result }; },
        from(table) {
            calls.push(['from', table]);
            const data = rows[table] ?? [];
            const query = { then(resolve, reject) { return Promise.resolve({ data, count: Array.isArray(data) ? data.length : 1 }).then(resolve, reject); },
                async maybeSingle() { return { data }; } };
            for (const method of ['select', 'eq', 'in', 'gte', 'lt', 'order', 'range', 'limit']) query[method] = (...args) => { calls.push([method, table, ...args]); return query; };
            return query;
        }
    };
}
function admin(supabase, role = true) {
    return { requireAdmin: async () => ({ supabase, user: { id: ACTOR }, isSuperAdmin: role }), getOptionalSupabaseAdmin: () => supabase,
        sendJson(res, status, body) { res.status(status).end(JSON.stringify(body)); } };
}
function security(rate = { allowed: true }, taken = []) {
    return { resolveClientIp: () => '192.0.2.10', _private: { isProductionLikeRuntime: () => true }, applyRateLimitHeaders() {},
        async takeRateLimitToken(input) { taken.push(input); return rate; } };
}
async function call(handler, req = {}) {
    const res = { headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(key, value) { this.headers[key.toLowerCase()] = value; return this; }, end(text) { this.body = JSON.parse(text); } };
    await handler({ method: 'GET', url: '/', headers: {}, ...req }, res); return res;
}
function write(body, headers = HEADERS) { return { method: 'POST', headers, body }; }
function input(extra = {}) { return { order_id: ID, order_no: PURCHASE.order_no, expected_updated_at: VERSION, action: 'note', note: '已核对原始订单', ...extra }; }
function pub(supabase, changes = {}) { return createTgHandlers({ admin: admin(supabase), env: ENV, requestSecurity: security(), ...changes }); }
function purchase(supabase, changes = {}) { return createTgPurchaseHandlers({ admin: admin(supabase), env: ENV, requestSecurity: security(), ...changes }); }
const publicWrite = body => write(body, { origin: 'https://tg.fatherkey.com', 'content-type': 'application/json' });
const rpcCalls = database => database.calls.filter(([kind]) => kind === 'rpc');

test('preview only sends a code HMAC and exposes the immutable entitlement without reserving it', async () => {
    const database = db({}, { success: true, ...ENTITLEMENT, expires_at: null, code: CODE, status_token: TOKEN, telegram_username: 'someone_else' });
    const rates = [];
    const res = await call(pub(database, { requestSecurity: security({ allowed: true }, rates) }).preview, publicWrite({ code: CODE.toLowerCase() }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, ...ENTITLEMENT, expires_at: null });
    assert.deepEqual(rpcCalls(database), [['rpc', 'fn_tg_preview_code', { p_code_digest: digest(CODE, ENV) }]]);
    assert.equal(rates[0].limit, 10); assert.equal(rates[0].requirePersistent, true);
    assert.equal(res.headers['cache-control'], 'no-store');
});

test('preview fails closed on a bad origin, disabled sales, missing limiter and excessive requests', async () => {
    for (const [changes, request, status] of [
        [{}, write({ code: CODE }, { origin: 'https://evil.test' }), 403],
        [{ env: { ...ENV, TG_REDEMPTION_ENABLED: 'false' } }, publicWrite({ code: CODE }), 503],
        [{ requestSecurity: security({ allowed: false, unavailable: true }) }, publicWrite({ code: CODE }), 503],
        [{ requestSecurity: security({ allowed: false }) }, publicWrite({ code: CODE }), 429]
    ]) {
        const database = db(); const res = await call(pub(database, changes).preview, request);
        assert.equal(res.statusCode, status); assert.equal(rpcCalls(database).length, 0);
    }
});

test('preview hides unavailable code details and rejects inconsistent product data', async () => {
    for (const reason of ['not_found', 'reserved', 'fulfilled', 'expired', 'batch_unavailable']) {
        const res = await call(pub(db({}, { success: false, code: reason, message: TOKEN })).preview, publicWrite({ code: CODE }));
        assert.equal(res.statusCode, 409); assert.equal(res.body.code, 'code_unavailable'); assert.ok(!JSON.stringify(res.body).includes(TOKEN));
    }
    for (const bad of [{ term_months: 4 }, { stars_quantity: 500 }, { expires_at: 'invalid' }]) {
        const res = await call(pub(db({}, { success: true, ...ENTITLEMENT, ...bad })).preview, publicWrite({ code: CODE }));
        assert.equal(res.statusCode, 500); assert.equal(res.body.product_family, undefined);
    }
});

test('customer cancellation works with sales disabled and uses only the header token, never a claimed administrator', async () => {
    const database = db({}, name => ({ success: true, order: { ...PURCHASE, payment_status: name === 'fn_tg_cancel_purchase' ? 'cancelled' : 'awaiting_payment', checkout_url: 'https://pay.example/old', status_token: TOKEN } }));
    const request = publicWrite({ order_no: PURCHASE.order_no, actor_id: ACTOR, expected_updated_at: VERSION }); request.headers['x-tg-status-token'] = TOKEN;
    const res = await call(purchase(database).cancel, request);
    assert.equal(res.statusCode, 200); assert.equal(res.body.order.can_close, false); assert.equal(res.body.order.checkout_url, undefined);
    assert.ok(!JSON.stringify(res.body).includes(TOKEN));
    assert.equal(rpcCalls(database)[0][1], 'fn_tg_purchase_status');
    const [_, name, args] = rpcCalls(database)[1]; assert.equal(name, 'fn_tg_cancel_purchase');
    assert.equal(args.p_status_token_hash, tokenHash(TOKEN)); assert.equal(args.p_actor_id, undefined); assert.equal(args.p_expected_updated_at, undefined);
    assert.equal(args.p_provider_trade_no, null); assert.equal(args.p_provider_checked, false);
});

test('customer cancellation rejects a token in the body and safely reports paid or changed orders', async () => {
    const database = db({}, name => name === 'fn_tg_purchase_status' ? { success: true, order: PURCHASE } : { success: false, code: 'cancel_not_allowed', message: TOKEN });
    const request = publicWrite({ order_no: PURCHASE.order_no, status_token: TOKEN });
    assert.equal((await call(purchase(database).cancel, request)).statusCode, 400); assert.equal(rpcCalls(database).length, 0);
    request.headers['x-tg-status-token'] = TOKEN;
    const res = await call(purchase(database).cancel, request); assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'cancel_not_allowed'); assert.ok(!JSON.stringify(res.body).includes(TOKEN));
});

test('all manual operations require a verified superadmin, exact admin origin and JSON', async () => {
    for (const factory of [createOrdersHandler, createPurchasesHandler]) {
        for (const [role, headers, status] of [[false, HEADERS, 403], [true, { ...HEADERS, origin: 'https://tg.fatherkey.com' }, 403],
            [true, { ...HEADERS, origin: 'https://tg.adm.fatherkey.com.evil.test' }, 403], [true, { ...HEADERS, 'content-type': 'text/plain' }, 415]]) {
            const database = db(); const res = await call(factory({ admin: admin(database, role), env: ENV }), write(input(), headers));
            assert.equal(res.statusCode, status); assert.equal(rpcCalls(database).length, 0);
        }
    }
});

test('manual operations reject a missing reason, missing version and unsupported action before mutation', async () => {
    for (const extra of [{ note: '' }, { note: ' ' }, { note: 'a'.repeat(501) }, { expected_updated_at: null }, { expected_updated_at: 'yesterday' }, { action: 'force_success' }]) {
        for (const factory of [createOrdersHandler, createPurchasesHandler]) {
            const database = db(); const res = await call(factory({ admin: admin(database), env: ENV }), write(input(extra)));
            assert.equal(res.statusCode, 400); assert.equal(rpcCalls(database).length, 0);
        }
    }
});

test('purchase review binds the authenticated actor and version, and sends no browser payment proof', async () => {
    for (const action of ['close', 'note']) {
        const database = db(); const res = await call(createPurchasesHandler({ admin: admin(database), env: ENV }), write(input({ action, actor_id: ID, verified_payment: { paid: true } })));
        assert.equal(res.statusCode, 200);
        const [_, name, args] = rpcCalls(database)[0];
        assert.equal(name, action === 'close' ? 'fn_tg_close_purchase' : 'fn_tg_review_purchase');
        assert.equal(args.p_actor_id, ACTOR); assert.equal(args.p_expected_updated_at, VERSION); assert.equal(args.verified_payment, undefined);
        assert.equal(args.p_status_token_hash, action === 'close' ? null : undefined);
    }
});

test('legacy payment approval cannot bypass fresh provider checks and refund/delivery confirmations', async () => {
    const database = db();
    const res = await call(createPurchasesHandler({ admin: admin(database), env: ENV }), write(input({ action: 'approve_payment' })));
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'payment_recheck_required');
    assert.equal(rpcCalls(database).length, 0);
});

test('manual reconciliation obtains fresh provider proof and ignores a forged browser snapshot', async () => {
    for (const status of ['created', 'processing', 'completed', 'failed', 'canceled']) {
        const database = db({ tg_redemption_orders: ORDER }); let queries = 0;
        const handler = createOrdersHandler({ admin: admin(database), env: ENV, clientFactory: () => ({ async getOrder(id) {
            assert.equal(id, ID); queries++; return { ...PROVIDER, data: { ...PROVIDER.data, status } };
        } }) });
        const res = await call(handler, write(input({ action: 'reconcile', snapshot: { provider_status: 'completed', secret: TOKEN } })));
        assert.equal(res.statusCode, 200); assert.equal(queries, 1);
        const args = rpcCalls(database)[0][2]; assert.equal(args.p_snapshot.provider_status, status);
        assert.equal(args.p_snapshot.verified_by, 'order_get'); assert.equal(args.p_actor_id, ACTOR); assert.equal(args.p_snapshot.secret, undefined);
        assert.ok(!JSON.stringify(args).includes('private-key')); assert.ok(!JSON.stringify(args).includes(TOKEN));
    }
});

test('provider identity, recipient, entitlement, currency and method mismatches never authorize reconciliation', async () => {
    for (const mismatch of [{ id: ACTOR }, { recipientName: 'other_user' }, { type: 'premium_6_month' }, { currency: 'gram' }, { method: 'web' }, { status: 'unknown' }, { amount: '-1' }]) {
        const database = db({ tg_redemption_orders: ORDER });
        const handler = createOrdersHandler({ admin: admin(database), env: ENV, clientFactory: () => ({ getOrder: async () => ({ ...PROVIDER, data: { ...PROVIDER.data, ...mismatch } }) }) });
        const res = await call(handler, write(input({ action: 'reconcile' })));
        assert.equal(res.statusCode, 409); assert.equal(res.body.code, 'provider_unverified'); assert.equal(rpcCalls(database).length, 0);
    }
});

test('version conflicts and ambiguous submissions stay explicit, without replaying writes', async () => {
    for (const code of ['version_conflict', 'submission_unknown', 'review_not_allowed', 'source_unconfirmed', 'payment_unverified']) {
        const database = db({ tg_redemption_orders: ORDER }, { success: false, code, message: TOKEN });
        const res = await call(createOrdersHandler({ admin: admin(database), env: ENV }), write(input({ action: 'resume_unsubmitted' })));
        assert.equal(res.statusCode, 409); assert.equal(res.body.code, code); assert.equal(rpcCalls(database).length, 1); assert.ok(!JSON.stringify(res.body).includes(TOKEN));
    }
});

test('purchase detail joins fulfillment and read-only provider results without exposing checkout leases or audit secrets', async () => {
    const database = db({ tg_purchase_orders: { ...PURCHASE, checkout_lease_token: 'private-lease', status_token_hash: TOKEN },
        tg_redemption_orders: { ...ORDER, order_source: 'purchase', purchase_id: ID, status_token_hash: TOKEN },
        tg_audit_events: [{ id: ID, actor_user_id: ACTOR, event_type: 'purchase_review', metadata: { action: 'note', note: '已核对', token: TOKEN, provider_payload: PROVIDER } }] });
    const handler = createPurchasesHandler({ admin: admin(database), env: ENV, clientFactory: () => ({ getOrder: async () => PROVIDER }) });
    const res = await call(handler, { url: `/?order_no=${PURCHASE.order_no}&reconcile=1` });
    assert.equal(res.statusCode, 200); assert.equal(res.body.fulfillment.order_no, ORDER.order_no); assert.equal(res.body.reconciliation.verified, true);
    assert.equal(res.body.order.can_close, false); assert.deepEqual(res.body.history[0].metadata, { action: 'note', note: '已核对' });
    for (const secret of [TOKEN, 'private-lease', 'private-key', 'never-return-provider-payload']) assert.ok(!JSON.stringify(res.body).includes(secret));
    assert.deepEqual(rpcCalls(database).map(([, name]) => name), ['fn_tg_purchase_completion_ready'], 'detail may only read completion readiness, never mutate the order');
});

test('purchase detail reports unapplied resolution migration without falling back to unsafe actions', async () => {
    const database = db();
    const from = database.from.bind(database);
    database.from = (table) => {
        const query = from(table);
        query.maybeSingle = async () => ({ error: { code: '42703', message: 'column tg_purchase_orders.closed_at does not exist' } });
        return query;
    };
    const res = await call(createPurchasesHandler({ admin: admin(database), env: ENV }), { url: `/?order_no=${PURCHASE.order_no}` });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'resolution_migration_required');
    assert.match(res.body.message, /迁移尚未生效/);
    assert.equal(res.body.order, undefined);
    assert.equal(rpcCalls(database).length, 0);
    assert.equal(database.calls.filter(([method]) => method === 'from').length, 1);
    assert.ok(database.calls.some(([method, table, fields]) => method === 'select' && table === 'tg_purchase_orders' && fields.includes('closed_at')));
});

test('purchase detail keeps unrelated database errors private instead of misreporting migration state', async () => {
    for (const error of [
        { code: '42703', message: 'column private_column does not exist' },
        { code: '42501', message: 'permission denied: closed_at internal details' }
    ]) {
        const database = db();
        const from = database.from.bind(database);
        database.from = (table) => {
            const query = from(table);
            query.maybeSingle = async () => ({ error });
            return query;
        };
        const res = await call(createPurchasesHandler({ admin: admin(database), env: ENV }), { url: `/?order_no=${PURCHASE.order_no}` });
        assert.equal(res.statusCode, 500);
        assert.equal(res.body.code, 'tg_service_error');
        assert.ok(!JSON.stringify(res.body).includes(error.message));
        assert.equal(rpcCalls(database).length, 0);
    }
});

test('combined purchase filters apply exact values, time bounds and stable pagination', async () => {
    const database = db(); const params = new URLSearchParams({ page: '2', page_size: '25', username: '@Telegram_User', search: PURCHASE.order_no,
        product_family: 'telegram_premium', payment_status: 'pending', fulfillment_status: 'not_started', payment_channel: 'usdt_bep20',
        from: VERSION, to: '2026-10-18T00:00:00Z' });
    const res = await call(createPurchasesHandler({ admin: admin(database) }), { url: '/?' + params }); assert.equal(res.statusCode, 200);
    for (const expected of [['eq', 'tg_purchase_order_stats', 'telegram_username', 'telegram_user'], ['in', 'tg_purchase_order_stats', 'payment_status', ['awaiting_payment', 'checkout_creating']],
        ['eq', 'tg_purchase_order_stats', 'payment_channel', 'usdt_bep20'], ['range', 'tg_purchase_order_stats', 25, 49],
        ['order', 'tg_purchase_order_stats', 'id', { ascending: false }], ['gte', 'tg_purchase_order_stats', 'created_at', VERSION]]) {
        assert.ok(database.calls.some(call => JSON.stringify(call) === JSON.stringify(expected)), JSON.stringify(expected));
    }
});

test('invalid filter enums, query expressions and reversed time ranges are rejected', async () => {
    for (const values of [{ username: 'x),status.eq.paid' }, { payment_channel: 'bitcoin' }, { payment_status: 'force_paid' },
        { search: 'x,or(status.eq.paid)' }, { product_family: 'other' }, { from: '2026-10-18T00:00:00Z', to: VERSION }, { from: '2026-10-17' }]) {
        const res = await call(createPurchasesHandler({ admin: admin(db()) }), { url: '/?' + new URLSearchParams(values) }); assert.equal(res.statusCode, 400);
    }
});

test('fulfillment source and batch filters reach their independent lists', async () => {
    for (const [factory, table, filters, expected] of [
        [createOrdersHandler, 'tg_redemption_orders', { order_source: 'purchase', status: 'manual_review' }, ['eq', 'tg_redemption_orders', 'order_source', 'purchase']],
        [createCodesHandler, 'tg_redemption_batches', { status: 'active', search: 'TGB-20261017-TEST', product_family: 'telegram_stars' }, ['eq', 'tg_redemption_batches', 'batch_no', 'TGB-20261017-TEST']]
    ]) {
        const database = db(); const res = await call(factory({ admin: admin(database), env: ENV }), { url: '/?' + new URLSearchParams(filters) });
        assert.equal(res.statusCode, 200); assert.ok(database.calls.some(call => JSON.stringify(call) === JSON.stringify(expected)));
        assert.ok(database.calls.some(([method, name, field]) => method === 'order' && name === table && field === 'id'));
    }
});
