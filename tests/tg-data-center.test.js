'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { windowParams, listParams, aggregate, list, migrationError } = require('../server/tg/data-center');
const { AS_OF, payload } = require('./fixtures/tg-data-center');
const NOW = Date.parse(AS_OF);
const params = value => new URLSearchParams(value);
const ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const invalid = fn => assert.throws(fn, error => error.statusCode === 400 && error.code === 'invalid_data_center_filter');
const adminPath = require.resolve('../api/_lib/admin');
const cachedAdmin = require.cache[adminPath];
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: {} };
const { createDataCenterHandler } = require('../server/api-handlers/admin/tg/data-center');
const { createPurchasesHandler } = require('../server/api-handlers/admin/tg/purchases');
const { createOrdersHandler } = require('../server/api-handlers/admin/tg/orders');
const { createCodesHandler } = require('../server/api-handlers/admin/tg/codes');
if (cachedAdmin) require.cache[adminPath] = cachedAdmin; else delete require.cache[adminPath];
function admin(supabase, isSuperAdmin = true) {
    return { requireAdmin: async () => ({ supabase, isSuperAdmin, user: { id: ID } }), sendJson(res, status, body) { res.statusCode = status; res.body = body; } };
}
async function call(handler, url = '/', method = 'GET') {
    const res = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; } };
    await handler({ url, method, headers: {} }, res); return res;
}
function db(data, error) {
    return { calls: [], async rpc(name, args) { this.calls.push({ name, args }); return { data, error }; }, from() { throw new Error('Reporting must aggregate in the database'); } };
}

test('Beijing today begins at 16:00 UTC and compares the same elapsed time', () => {
    const result = windowParams(params('range=today'), NOW);
    assert.equal(result.from, '2026-10-16T16:00:00.000Z');
    assert.equal(result.to, AS_OF);
    assert.equal(result.previous_from, '2026-10-15T16:00:00.000Z');
    assert.equal(result.previous_to, '2026-10-16T07:30:00.000Z');
    assert.equal(result.timezone, 'Asia/Shanghai');
});
for (const [range, from, previous] of [['7d', '2026-10-10T16:00:00.000Z', '2026-10-03T16:00:00.000Z'], ['30d', '2026-09-17T16:00:00.000Z', '2026-08-18T16:00:00.000Z']]) {
    test(range + ' includes today and uses an equal elapsed previous period', () => {
        const result = windowParams(params({ range }), NOW);
        assert.equal(result.from, from); assert.equal(result.previous_from, previous);
        assert.equal(Date.parse(result.to) - Date.parse(result.from), Date.parse(result.previous_to) - Date.parse(result.previous_from));
    });
}
test('midnight and a completed custom period use exclusive upper bounds', () => {
    const midnight = windowParams(params('range=today'), Date.parse('2026-10-16T16:00:00Z'));
    assert.equal(midnight.from, midnight.to);
    const result = windowParams(params('range=custom&start=2026-10-01&end=2026-10-03'), NOW);
    assert.equal(result.from, '2026-09-30T16:00:00.000Z'); assert.equal(result.to, '2026-10-03T16:00:00.000Z');
    assert.equal(result.previous_from, '2026-09-27T16:00:00.000Z'); assert.equal(result.previous_to, result.from);
});
for (const query of ['range=custom&start=2026-02-30&end=2026-03-01', 'range=custom&start=2026-10-03&end=2026-10-01',
    'range=custom&start=2026-07-01&end=2026-10-17', 'range=custom&start=2026-10-18&end=2026-10-18',
    'range=custom&start=&end=2026-10-17', 'module=all', 'range=year', 'range=7d&range=today', 'sql=select',
    'as_of=2026-10-17T07:00:00Z', 'as_of=2026-10-17T07:31:00Z', 'as_of=2026-02-30T00:00:00Z', 'as_of=2026-10-17']) {
    test('overview rejects invalid input: ' + query, () => invalid(() => windowParams(params(query), NOW)));
}
test('shared route query is allowed and all three modules share a snapshot', () => {
    for (const module of ['business', 'operations', 'inventory']) {
        const result = windowParams(params({ route: 'tg/data-center', module, as_of: AS_OF }), NOW);
        assert.equal(result.as_of, AS_OF); assert.equal(result.module, module);
    }
});
test('aggregation is one RPC over the full dataset, without page or credential fields', async () => {
    const database = db(payload().data); const window = windowParams(params(''), NOW);
    const result = await aggregate(database, window);
    assert.equal(result.success, true); assert.deepEqual(result.data, payload().data);
    assert.deepEqual(database.calls, [{ name: 'fn_tg_admin_data_center', args: { p_module: 'business', p_from: window.from, p_to: window.to, p_previous_from: window.previous_from, p_previous_to: window.previous_to, p_as_of: AS_OF } }]);
});
test('missing schema returns a safe initialization error; unrelated database errors remain failures', async () => {
    for (const code of ['PGRST202', 'PGRST205', '42883', '42P01', '42703']) {
        await assert.rejects(aggregate(db(null, { code, message: 'secret connection detail' }), windowParams(params(''), NOW)), error => error.statusCode === 409 && error.code === 'tg_data_center_migration_required' && !error.message.includes('secret'));
    }
    const error = { code: 'XX001' }; assert.equal(migrationError(error), error);
    await assert.rejects(aggregate(db({ version: 1, module: 'inventory' }), windowParams(params(''), NOW)), /Invalid TG aggregate/);
});
test('endpoint is GET-only, super-admin only, uncached and masks unexpected errors', async () => {
    const database = db(payload().data); const handler = createDataCenterHandler({ admin: admin(database), now: () => NOW });
    const result = await call(handler, '/api/admin/tg/data-center?range=7d');
    assert.equal(result.statusCode, 200); assert.equal(result.headers['cache-control'], 'no-store'); assert.equal(result.headers['x-content-type-options'], 'nosniff');
    const rejected = await call(handler, '/', 'POST'); assert.equal(rejected.statusCode, 405); assert.equal(rejected.headers.allow, 'GET'); assert.equal(database.calls.length, 1);
    assert.equal((await call(createDataCenterHandler({ admin: admin(database, false) }))).statusCode, 403);
    assert.equal((await call(handler, '/?module=invalid')).statusCode, 400);
    const failure = await call(createDataCenterHandler({ admin: admin(db(null, new Error('private-password'))), now: () => NOW }));
    assert.equal(failure.statusCode, 500); assert.doesNotMatch(JSON.stringify(failure.body), /private-password/);
});
test('purchase filters preserve paid time, original currency, network and snapshot', () => {
    const result = listParams(params({ data_center: '1', date_field: 'paid_at', receipt: 'confirmed', currency: 'USDT', pay_currency: 'usdtton', as_of: AS_OF, from: '2026-10-11T00:00:00+08:00', to: AS_OF, username: '@Telegram_User' }), 'purchase', NOW);
    assert.deepEqual(result.values, { currency: 'USDT', pay_currency: 'usdtton', receipt: 'confirmed', date_field: 'paid_at', from: '2026-10-10T16:00:00.000Z', to: AS_OF, username: 'telegram_user' });
    assert.equal(result.as_of, AS_OF);
    assert.equal(listParams(params('pay_currency=unknown'), 'purchase', NOW).values.pay_currency, 'unknown');
});
for (const [kind, query] of [['purchase', 'status=active'], ['purchase', 'date_field=completed_at'], ['order', 'date_field=paid_at'], ['order', 'receipt=confirmed'], ['order', 'status=active'], ['batch', 'status=manual_review'], ['batch', 'currency=USDT'], ['batch', 'username=valid_user'],
    ['code', ''], ['code', 'batch_id=invalid'], ['code', 'batch_id=' + ID + '&from=2026-10-17T00:00:00Z'], ['code', 'batch_id=' + ID + '&search=whatever'], ['code', 'batch_id=' + ID + '&status=active'],
    ['purchase', 'receipt=confirmed&receipt=review'], ['purchase', 'pageSize=25&page_size=25'], ['purchase', 'from=2026-10-17T00:00:00Z&to=2026-10-16T00:00:00Z'], ['purchase', 'extra=ignored'], ['order', 'search=not-an-order'], ['batch', 'as_of=2026-10-15T00:00:00Z']]) {
    test('drilldown rejects unsupported or ambiguous filters: ' + kind + ' ' + query, () => invalid(() => listParams(params(query), kind, NOW)));
}
test('code detail allows only an inventory predicate and a validated batch UUID', () => {
    assert.deepEqual(listParams(params({ batch_id: ID, inventory: 'expiring' }), 'code', NOW).values, { inventory: 'expiring', batch_id: ID });
});
test('drilldown listing calls the common RPC and preserves total beyond one page', async () => {
    const database = db({ total: 137, rows: [{ id: ID }] });
    const result = await list(database, params({ attention: 'overdue', order_source: 'redemption' }), 'order', 3, 25);
    assert.equal(result.total, 137); assert.equal(result.rows.length, 1);
    assert.equal(database.calls[0].name, 'fn_tg_admin_data_center_list'); assert.equal(database.calls[0].args.p_page, 3);
    assert.equal(database.calls[0].args.p_filters.order_source, 'redemption');
    await assert.rejects(list(db({ total: -1, rows: [] }), params(''), 'purchase', 1, 25), /Invalid TG drilldown/);
});
test('existing read handlers use reporting RPCs and purchase responses retain original-currency fields', async () => {
    const purchase = { id: ID, order_no: 'TGP-ABCDEFGHIJKLMNOPQRST', product_family: 'telegram_premium', term_months: 3, telegram_username: 'test_user', currency: 'CNY', total_minor: 10000, subtotal_minor: 10000, payment_fee_minor: 0, payment_fee_rate_bps: 0, price_version: 2, payment_channel: 'usdt_bep20', payment_status: 'manual_review', paid_at: AS_OF, receipt_currency: 'USDT', receipt_amount: '13.00000001', receipt_confirmed: true, pay_currency: 'usdtton' };
    for (const [create, key, row] of [[createPurchasesHandler, 'purchases', purchase], [createOrdersHandler, 'orders', { id: ID, order_no: 'TG-ABCDEFGHIJKLMNOPQRST', status: 'succeeded', completed_at: AS_OF }], [createCodesHandler, 'batches', { id: ID, metadata: { name: '安全投影' }, matching_code_count: 4 }]]) {
        const database = db({ total: 137, rows: [row], matching_codes: 4 });
        const result = await call(create({ admin: admin(database) }), '/?data_center=1');
        assert.equal(result.statusCode, 200); assert.equal(result.body.total, 137); assert.equal(result.body[key].length, 1); assert.equal(database.calls.length, 1);
        if (key === 'purchases') { assert.equal(result.body[key][0].receipt_amount, '13.00000001'); assert.equal(result.body[key][0].receipt_currency, 'USDT'); }
    }
});
test('data center SQL uses verified receipts, safe reporting views and read-only functions', () => {
    const sql = fs.readFileSync(require.resolve('../supabase/migrations/20261017_tg_data_center.sql'), 'utf8');
    assert.match(sql, /signed_notify_and_query/); assert.match(sql, /signed_notify', 'authenticated_query/);
    assert.match(sql, /actually_paid_currency/); assert.match(sql, /actually_paid'\) >= public\.tg_admin_decimal/);
    assert.match(sql, /receipt_amount::TEXT/); assert.match(sql, /pay_currency' = 'unknown' AND p\.pay_currency IS NULL/);
    assert.match(sql, /completed_at >= p_previous_from/); assert.match(sql, /paid_at >= p_previous_from/);
    assert.match(sql, /WHERE order_source = 'redemption'/); assert.match(sql, /p_closed IS NOT NULL OR p_fulfillment IN \('succeeded', 'cancelled', 'closed'\)/);
    assert.match(sql, /least\(c\.expires_at, b\.valid_until\)/); assert.match(sql, /p_valid_from <= p_as_of/); assert.match(sql, /p_batch_status = 'active'/);
    assert.match(sql, /count\(\*\) FILTER \(WHERE status = 'fulfilled'\)/);
    assert.match(sql, /jsonb_build_object\('name', b\.metadata->>'name'\)/); assert.doesNotMatch(sql, /b\.name\b|SELECT b\.\*/);
    assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|EXECUTE\s+format)\b/i);
    assert.doesNotMatch(sql, /code_ciphertext|code_digest|status_token|provider_payload/);
    assert.equal((sql.match(/STABLE SECURITY DEFINER/g) || []).length, 2);
    assert.match(sql, /REVOKE ALL ON public\.tg_admin_purchase_facts, public\.tg_admin_code_facts FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.fn_tg_admin_data_center_list\([\s\S]*?TO service_role/);
    const domain = fs.readFileSync(require.resolve('../supabase/migrations/20261015_tg_purchase_domain.sql'), 'utf8');
    assert.match(domain, /idx_tg_redemption_orders_purchase[\s\S]*?UNIQUE|UNIQUE[\s\S]*?idx_tg_redemption_orders_purchase/);
});

test('operator verification resolves every read module without treating structural evidence as business acceptance', () => {
    const sql = fs.readFileSync(require.resolve('../supabase/migrations/20261017_verify_tg_data_center.sql'), 'utf8');
    assert.match(sql, /BEGIN READ ONLY/);
    assert.match(sql, /has_function_privilege\('anon'/); assert.match(sql, /has_table_privilege\('authenticated'/);
    assert.match(sql, /provolatile = 's'/); assert.match(sql, /indisunique AND indisvalid/);
    assert.match(sql, /ARRAY\['business', 'operations', 'inventory'\]/);
    assert.match(sql, /ARRAY\['purchase', 'order', 'batch', 'code'\]/);
    assert.match(sql, /v_payload := public\.fn_tg_admin_data_center\(/);
    assert.match(sql, /v_payload := public\.fn_tg_admin_data_center_list\(/);
    assert.match(sql, /concurrent\/business acceptance remains NOT RUN/);
    assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i);
});
