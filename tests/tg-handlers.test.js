'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
// Handler factories receive every backend dependency explicitly. Avoid loading
// the production Supabase SDK or needing credentials in these offline tests.
const adminModulePath = require.resolve('../api/_lib/admin');
const cachedAdminModule = require.cache[adminModulePath];
require.cache[adminModulePath] = { id: adminModulePath, filename: adminModulePath, loaded: true, exports: {} };
const { createCodesHandler } = require('../server/api-handlers/admin/tg/codes');
const { createOrdersHandler } = require('../server/api-handlers/admin/tg/orders');
const { createProviderHandler } = require('../server/api-handlers/admin/tg/provider');
const { createTgHandlers, digest, tokenHash } = require('../server/api-handlers/public/tg');
if (cachedAdminModule) require.cache[adminModulePath] = cachedAdminModule;
else delete require.cache[adminModulePath];

const UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const TOKEN = 'a'.repeat(32);
const KEY = 'test-redemption-key-0001';
const CODE = 'TG-PREM-12345678-12345678-12345678-12345678';
const ENV = { TG_REDEMPTION_ENABLED: 'true', TG_REDEMPTION_CODE_PEPPER: 'test-only-independent-code-pepper-12345678', TG_REDEMPTION_CODE_ENCRYPTION_KEY: 'ab'.repeat(32) };
const ADMIN_WRITE_HEADERS = { origin: 'https://tg.adm.fatherkey.com', 'content-type': 'application/json' };
function adminWriteRequest(body, extra = {}) { return { method: 'POST', body, headers: { ...ADMIN_WRITE_HEADERS }, ...extra }; }
function response() {
    return { headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; }, end(value) { this.body = JSON.parse(value); } };
}
async function call(handler, req = {}) {
    const res = response();
    await handler({ method: 'GET', url: '/', headers: {}, ...req }, res);
    return res;
}
function stubAdmin(supabase = {}, overrides = {}) {
    return {
        requireAdmin: async () => ({ supabase, user: { id: UUID }, isSuperAdmin: true }),
        getOptionalSupabaseAdmin: () => supabase,
        parseJsonBody: async (req) => req.body,
        sendJson(res, status, body) { res.status(status).end(JSON.stringify(body)); },
        writeAdminAuditLog: async () => {}, ...overrides
    };
}
function security(result = { allowed: true }) {
    return { resolveClientIp: () => '192.0.2.10', _private: { isProductionLikeRuntime: () => true }, applyRateLimitHeaders() {}, takeRateLimitToken: async () => result };
}
function order(extra = {}) { return { success: true, order_no: 'TG-1234567890ABCDEF', status: 'pending', product_family: 'telegram_premium', term_months: 3, stars_quantity: null, ...extra }; }
function publicHandlers(rpc = async () => ({ data: order({ existing: false }) }), extra = {}) {
    return createTgHandlers({ admin: stubAdmin({ rpc }), env: ENV, requestSecurity: security(), ...extra });
}

test('all TG administration endpoints require a verified super administrator', async () => {
    for (const factory of [createCodesHandler, createOrdersHandler, createProviderHandler]) {
        const denied = await call(factory({ admin: stubAdmin({}, { requireAdmin: async () => ({ isSuperAdmin: false }) }) }));
        assert.equal(denied.statusCode, 403);
        const anonymous = await call(factory({ admin: stubAdmin({}, { requireAdmin: async () => { throw Object.assign(new Error('Unauthorized'), { statusCode: 401 }); } }) }));
        assert.equal(anonymous.statusCode, 401);
        assert.equal(anonymous.headers['cache-control'], 'no-store');
    }
});

test('code generation commits one atomic batch and stores only HMAC plus authenticated ciphertext', async () => {
    const calls = [];
    const admin = stubAdmin({ rpc: async (name, params) => { calls.push({ name, params }); return { data: { success: true, batch_id: UUID, batch_no: params.p_batch_no } }; } });
    const res = await call(createCodesHandler({ admin, env: ENV }), adminWriteRequest({ term_months: 6, count: 2 }));
    assert.equal(res.statusCode, 201);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'fn_tg_generate_batch');
    assert.equal(calls[0].params.p_term_months, 6);
    assert.equal(res.body.codes.length, 2);
    assert.notEqual(res.body.codes[0], res.body.codes[1]);
    res.body.codes.forEach((code, index) => {
        assert.match(code, /^TG-PREM-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/);
        const row = calls[0].params.p_codes[index];
        assert.equal(row.code_digest, digest(code, ENV));
        assert.equal(row.code_last4, code.slice(-4));
        assert.equal(JSON.stringify(calls[0].params).includes(code), false);
        const [version, iv, tag, encrypted] = row.code_ciphertext.split('.');
        assert.equal(version, 'v1');
        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENV.TG_REDEMPTION_CODE_ENCRYPTION_KEY, 'hex'), Buffer.from(iv, 'base64url'));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        assert.equal(Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString(), code);
    });
});

test('failed batch transactions return no plaintext codes or database details', async () => {
    const admin = stubAdmin({ rpc: async () => ({ error: new Error('database password=private') }) });
    const res = await call(createCodesHandler({ admin, env: ENV }), adminWriteRequest({ term_months: 3, count: 1 }));
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.codes, undefined);
    assert.equal(JSON.stringify(res.body).includes('private'), false);
});

test('batch generation strictly rejects invalid terms and quantities before writing', async () => {
    let calls = 0;
    const handler = createCodesHandler({ admin: stubAdmin({ rpc: async () => { calls++; } }), env: ENV });
    for (const input of [{ term_months: '3junk', count: 1 }, { term_months: 4, count: 1 }, { term_months: 3, count: 1.5 }, { term_months: 3, count: 1001 }]) {
        assert.equal((await call(handler, adminWriteRequest(input))).statusCode, 400);
    }
    assert.equal(calls, 0);
});

test('revoke requires exactly one valid target and calls only the atomic revoke RPC', async () => {
    const calls = [];
    const handler = createCodesHandler({ admin: stubAdmin({ rpc: async (name, params) => { calls.push({ name, params }); return { data: { success: true, revoked_count: 2 } }; } }) });
    for (const input of [{}, { code_id: UUID, batch_id: UUID }, { code_id: 'invalid' }]) {
        assert.equal((await call(handler, adminWriteRequest({ action: 'revoke', ...input }))).statusCode, 400);
    }
    const res = await call(handler, adminWriteRequest({ action: 'revoke', batch_id: UUID }));
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'fn_tg_revoke_codes');
    assert.equal(calls[0].params.p_code_id, null);
    assert.equal(calls[0].params.p_batch_id, UUID);
});

test('TG admin cookie writes reject missing and sibling origins before parsing or changing codes', async () => {
    let parses = 0;
    let writes = 0;
    const handler = createCodesHandler({ admin: stubAdmin({ rpc: async () => { writes++; } }, {
        parseJsonBody: async (req) => { parses++; return JSON.parse(req.body); }
    }), env: { ...ENV, APP_ENV: 'production' } });
    for (const origin of [undefined, 'null', 'https://tg.fatherkey.com', 'https://www.fatherkey.com', 'https://tg.adm.fatherkey.com.evil.test', 'https://tg.adm.fatherkey.com/path']) {
        // text/plain is a CORS-simple POST and would otherwise reach a JSON
        // parser even though the browser cannot read the response.
        const res = await call(handler, { method: 'POST', headers: { cookie: 'admin_session=test-only', 'content-type': 'text/plain', ...(origin ? { origin } : {}) }, body: JSON.stringify({ action: 'revoke', batch_id: UUID }) });
        assert.equal(res.statusCode, 403, origin || 'missing origin');
        assert.equal(res.body.code, 'tg_admin_origin_required');
    }
    assert.equal(parses, 0);
    assert.equal(writes, 0);
});

test('TG admin writes require application/json even with the trusted origin', async () => {
    let parses = 0;
    let writes = 0;
    const handler = createCodesHandler({ admin: stubAdmin({ rpc: async () => { writes++; return { data: { success: true, revoked_count: 1 } }; } }, {
        parseJsonBody: async (req) => { parses++; return req.body; }
    }), env: ENV });
    for (const contentType of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/json-patch+json']) {
        const res = await call(handler, adminWriteRequest({ action: 'revoke', batch_id: UUID }, { headers: { origin: ADMIN_WRITE_HEADERS.origin, cookie: 'admin_session=test-only', ...(contentType ? { 'content-type': contentType } : {}) } }));
        assert.equal(res.statusCode, 415, contentType || 'missing content type');
    }
    assert.equal(parses, 0);
    assert.equal(writes, 0);
    const accepted = await call(handler, adminWriteRequest({ action: 'revoke', batch_id: UUID }, { headers: { ...ADMIN_WRITE_HEADERS, 'content-type': 'application/json; charset=utf-8' } }));
    assert.equal(accepted.statusCode, 200);
    assert.equal(parses, 1);
    assert.equal(writes, 1);
});

test('local TG admin writes require an exact loopback origin and are disabled in production', async () => {
    let writes = 0;
    const admin = stubAdmin({ rpc: async () => { writes++; return { data: { success: true, revoked_count: 1 } }; } });
    const body = { action: 'revoke', batch_id: UUID };
    const headers = (origin, host) => ({ origin, host, 'content-type': 'application/json' });
    for (const host of ['localhost:8000', '127.0.0.1:8000']) {
        const handler = createCodesHandler({ admin, env: {} });
        const res = await call(handler, adminWriteRequest(body, { headers: headers(`http://${host}`, host) }));
        assert.equal(res.statusCode, 200);
    }
    const localWrites = writes;
    for (const env of [{ NODE_ENV: 'production' }, { APP_ENV: 'production' }, { DEPLOYMENT_TIER: 'production' }, { VERCEL_ENV: 'production' }, { RAILWAY_ENVIRONMENT_NAME: 'production' }]) {
        const handler = createCodesHandler({ admin, env });
        const res = await call(handler, adminWriteRequest(body, { headers: headers('http://localhost:8000', 'localhost:8000') }));
        assert.equal(res.statusCode, 403);
    }
    const handler = createCodesHandler({ admin, env: {} });
    for (const [origin, host] of [['http://localhost:8001', 'localhost:8000'], ['http://127.0.0.1:8000', 'localhost:8000'], ['https://localhost:8000', 'localhost:8000'], ['http://localhost.evil.test:8000', 'localhost.evil.test:8000'], ['http://localhost:8000', 'tg.adm.fatherkey.com']]) {
        const res = await call(handler, adminWriteRequest(body, { headers: headers(origin, host) }));
        assert.equal(res.statusCode, 403, `${origin} -> ${host}`);
    }
    assert.equal(writes, localWrites);
});

test('public redemption is disabled by default and rejects foreign origins', async () => {
    let calls = 0;
    const handlers = publicHandlers(async () => { calls++; }, { env: {} });
    assert.equal((await call(handlers.redeem, { method: 'POST', body: {} })).statusCode, 503);
    assert.equal((await call(handlers.redeem, { method: 'POST', headers: { origin: 'https://evil.test' }, body: {} })).statusCode, 403);
    assert.equal(calls, 0);
    const catalog = await call(handlers.catalog);
    assert.equal(catalog.body.redemption_enabled, false);
    assert.deepEqual(catalog.body.products.filter((item) => item.product_family === 'telegram_premium').map((item) => item.term_months), [3, 6, 12]);
    assert.deepEqual(catalog.body.products.find((item) => item.product_family === 'telegram_stars'), { product_family: 'telegram_stars', min_stars: 50, max_stars: 1000000 });
    assert.equal(JSON.stringify(catalog.body).includes('price'), false);
});

test('persistent rate limiting fails closed before parsing or reserving a code', async () => {
    let calls = 0;
    const handlers = publicHandlers(async () => { calls++; }, { requestSecurity: security({ allowed: false, unavailable: true }) });
    const res = await call(handlers.redeem, { method: 'POST', body: { code: CODE, username: 'telegram_user' } });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'security_unavailable');
    assert.equal(calls, 0);
});

test('public redemption binds normalized recipient, code and both hashed request secrets', async () => {
    const calls = [];
    const handlers = publicHandlers(async (name, params) => { calls.push({ name, params }); return { data: order({ existing: false, provider_request: 'secret' }) }; });
    const res = await call(handlers.redeem, { method: 'POST', body: { code: CODE.toLowerCase(), username: '@Telegram_User', status_token: TOKEN, idempotency_key: KEY } });
    assert.equal(res.statusCode, 200);
    assert.equal(calls[0].name, 'fn_tg_reserve_code');
    assert.deepEqual(calls[0].params, { p_code_digest: digest(CODE, ENV), p_username: 'telegram_user', p_status_token_hash: tokenHash(TOKEN), p_idempotency_key_hash: tokenHash(KEY) });
    assert.equal(res.body.status_token, TOKEN);
    assert.equal(res.body.provider_request, undefined);
});

test('idempotent replay does not issue a new status token and RPC failures remain generic', async () => {
    const replay = await call(publicHandlers(async () => ({ data: order({ existing: true }) })).redeem, { method: 'POST', body: { code: CODE, username: 'telegram_user', status_token: TOKEN, idempotency_key: KEY } });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.status_token, undefined);
    const failed = await call(publicHandlers(async () => ({ error: new Error('database secret=private') })).redeem, { method: 'POST', body: { code: CODE, username: 'telegram_user' } });
    assert.equal(failed.statusCode, 500);
    assert.equal(JSON.stringify(failed.body).includes('private'), false);
});

test('invalid JSON, status tokens, and idempotency keys never reserve codes', async () => {
    let calls = 0;
    const handler = publicHandlers(async () => { calls++; }).redeem;
    for (const input of ['{', [], { code: CODE, username: 'telegram_user', status_token: 'short' }, { code: CODE, username: 'telegram_user', idempotency_key: 'short' }]) {
        assert.equal((await call(handler, { method: 'POST', body: input })).statusCode, 400);
    }
    assert.equal(calls, 0);
});

test('public status authenticates the header token and only returns safe order fields', async () => {
    const handlers = publicHandlers(async (name, params) => {
        assert.equal(name, 'fn_tg_order_status');
        assert.equal(params.p_status_token_hash, tokenHash(TOKEN));
        return { data: order({ status: 'succeeded', username: 'telegram_user', provider_response: 'secret', code_digest: 'secret', provider_idempotency_key: 'secret' }) };
    });
    const res = await call(handlers.status, { url: '/?order_no=TG-1234567890ABCDEF', headers: { 'x-tg-status-token': TOKEN } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, order({ status: 'succeeded', username: 'telegram_user' }));
    assert.equal(res.headers['cache-control'], 'no-store');
});

test('public status rejects query-only tokens without authenticating an order', async () => {
    let calls = 0;
    const handlers = publicHandlers(async () => { calls++; return { data: order() }; });
    for (const parameter of ['status_token', 'token']) {
        const res = await call(handlers.status, { url: `/?order_no=TG-1234567890ABCDEF&${parameter}=${TOKEN}` });
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.success, false);
        assert.equal(JSON.stringify(res.body).includes(TOKEN), false);
    }
    const invalidHeader = await call(handlers.status, { url: `/?order_no=TG-1234567890ABCDEF&token=${TOKEN}`, headers: { 'x-tg-status-token': 'short' } });
    assert.equal(invalidHeader.statusCode, 400);
    assert.equal(calls, 0);
});

test('public status uses only the header when a different token is present in the URL', async () => {
    const handlers = publicHandlers(async (name, params) => {
        assert.equal(name, 'fn_tg_order_status');
        assert.equal(params.p_status_token_hash, tokenHash(TOKEN));
        return { data: order() };
    });
    const res = await call(handlers.status, { url: '/?order_no=TG-1234567890ABCDEF&token=untrusted_query_token', headers: { 'x-tg-status-token': TOKEN } });
    assert.equal(res.statusCode, 200);
});

test('provider status is read-only and whitelists decimal balances', async () => {
    let calls = 0;
    const clientFactory = () => ({ async getBalance() { calls++; return { statusCode: 200, data: { gram: '14.2500', usdt: '125.5000', apiKey: 'private' } }; } });
    const handler = createProviderHandler({ admin: stubAdmin(), env: { GRAMIX_API_KEY: 'private' }, clientFactory });
    const res = await call(handler);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.healthy, true);
    assert.deepEqual(res.body.balances, { gram: '14.2500', usdt: '125.5000' });
    assert.equal(res.body.payment_currency, 'usdt');
    assert.equal(JSON.stringify(res.body).includes('private'), false);
    assert.equal((await call(handler, { method: 'POST' })).statusCode, 405);
    assert.equal(calls, 1);
});

test('provider reports only a supported configured debit currency without exposing invalid values', async () => {
    const clientFactory = () => ({ async getBalance() { return { statusCode: 200, data: { gram: '14.2500', usdt: '125.5000', payment_currency: 'untrusted-upstream-value' } }; } });
    for (const currency of ['usdt', 'gram', 'untrusted-private-value', 'USDT', ' usdt ', 'toString']) {
        const env = { GRAMIX_API_KEY: 'private', GRAMIX_PAYMENT_CURRENCY: currency };
        const res = await call(createProviderHandler({ admin: stubAdmin(), env, clientFactory }));
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.payment_currency, ['usdt', 'gram'].includes(currency) ? currency : null);
        assert.equal(env.GRAMIX_PAYMENT_CURRENCY, currency);
        assert.equal(JSON.stringify(res.body).includes('private'), false);
        assert.equal(JSON.stringify(res.body).includes('untrusted-upstream-value'), false);
    }
});

test('unconfigured or unavailable provider never reports healthy or leaks upstream errors', async () => {
    let calls = 0;
    const clientFactory = () => { calls++; throw new Error('API key private'); };
    const missing = await call(createProviderHandler({ admin: stubAdmin(), env: {}, clientFactory }));
    assert.equal(missing.body.configured, false);
    assert.equal(missing.body.payment_currency, 'usdt');
    assert.equal(calls, 0);
    const failed = await call(createProviderHandler({ admin: stubAdmin(), env: { GRAMIX_API_KEY: 'private' }, clientFactory }));
    assert.equal(failed.body.healthy, false);
    assert.equal(failed.body.balances, null);
    assert.equal(failed.body.payment_currency, 'usdt');
    assert.equal(JSON.stringify(failed.body).includes('private'), false);
});

test('admin reconciliation never updates orders and suppresses a mismatched upstream snapshot', async () => {
    const calls = [];
    const localOrder = { id: UUID, order_no: 'TG-1234567890ABCDEF', term_months: 3, telegram_username: 'telegram_user', provider_order_id: UUID, provider_payment_currency: 'usdt', provider_idempotency_key: KEY };
    const supabase = { from(table) { assert.equal(table, 'tg_redemption_orders'); return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: localOrder }; } }; } };
    const handler = createOrdersHandler({ admin: stubAdmin(supabase), clientFactory: () => ({ async getOrder(id) { calls.push(id); return { statusCode: 200, data: { id: UUID, recipientName: 'other_user', type: 'premium_3_month', method: 'api', status: 'completed' } }; } }) });
    const res = await call(handler, { url: `/?orderId=${UUID}&reconcile=1` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.reconciliation.verified, false);
    assert.equal(res.body.reconciliation.snapshot, null);
    assert.equal(res.body.order.provider_idempotency_key, undefined);
    assert.deepEqual(calls, [UUID]);
});

test('admin reconciliation verifies saved payment currency without exposing correlation keys or writing data', async () => {
    for (const currency of ['usd', 'gram', null]) {
        const localOrder = { id: UUID, order_no: 'TG-1234567890ABCDEF', term_months: 3, telegram_username: 'telegram_user', provider_order_id: UUID, provider_payment_currency: 'usdt', provider_idempotency_key: KEY };
        const supabase = { from() { return {
            select(columns) { assert.ok(columns.includes('provider_payment_currency')); return this; },
            eq() { return this; }, async maybeSingle() { return { data: localOrder }; }
        }; } };
        const handler = createOrdersHandler({
            admin: stubAdmin(supabase),
            clientFactory: () => ({ async getOrder() { return { statusCode: 200, data: {
                id: UUID, recipientName: 'telegram_user', type: 'premium_3_month', method: 'api', status: 'completed', currency, amount: '12.3400'
            } }; } })
        });
        const res = await call(handler, { url: `/?orderId=${UUID}&reconcile=1` });
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reconciliation.verified, currency === 'usd');
        assert.equal(res.body.order.provider_payment_currency, 'usdt');
        assert.equal(res.body.order.provider_idempotency_key, undefined);
    }
});

test('Stars code generation uses its atomic RPC, immutable quantity and distinct prefix', async () => {
    const calls = [];
    const handler = createCodesHandler({ admin: stubAdmin({ rpc: async (name, params) => { calls.push({ name, params }); return { data: { success: true, batch_id: UUID, batch_no: params.p_batch_no } }; } }), env: ENV });
    const result = await call(handler, adminWriteRequest({ product_family: 'telegram_stars', stars_quantity: '500', count: 2 }));
    assert.equal(result.statusCode, 201);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'fn_tg_generate_stars_batch');
    assert.equal(calls[0].params.p_stars_quantity, 500);
    assert.equal(Object.hasOwn(calls[0].params, 'p_term_months'), false);
    assert.equal(result.body.batch.product_family, 'telegram_stars');
    assert.equal(result.body.batch.stars_quantity, 500);
    assert.equal(result.body.batch.term_months, null);
    for (const [index, code] of result.body.codes.entries()) {
        assert.match(code, /^TG-STAR-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/);
        assert.equal(calls[0].params.p_codes[index].code_digest, digest(code, ENV));
        assert.equal(JSON.stringify(calls[0].params).includes(code), false);
    }
});

test('code generation rejects ambiguous products and invalid Stars quantities before RPC', async () => {
    let writes = 0;
    const handler = createCodesHandler({ admin: stubAdmin({ rpc: async () => { writes++; } }), env: ENV });
    for (const input of [
        { product_family: 'telegram_stars', stars_quantity: 49 },
        { product_family: 'telegram_stars', stars_quantity: 1000001 },
        { product_family: 'telegram_stars', stars_quantity: '500x' },
        { product_family: 'telegram_stars', stars_quantity: 50.1 },
        { product_family: 'telegram_stars', stars_quantity: 500, term_months: 3 },
        { product_family: 'telegram_stars', stars_quantity: 500, durationMonths: 3 },
        { product_family: 'telegram_premium', stars_quantity: 500, term_months: 3 },
        { product_family: 'unknown', term_months: 3 }
    ]) assert.equal((await call(handler, adminWriteRequest({ count: 1, ...input }))).statusCode, 400, JSON.stringify(input));
    assert.equal(writes, 0);
});

test('Stars redemption gets quantity only from reserved code and returns a strict public whitelist', async () => {
    const calls = [];
    const handlers = publicHandlers(async (name, params) => {
        calls.push({ name, params });
        return { data: order({ product_family: 'telegram_stars', term_months: null, stars_quantity: 500, existing: false, provider_payment_currency: 'usdt', provider_snapshot: { secret: 'private' } }) };
    });
    const result = await call(handlers.redeem, { method: 'POST', body: { code: CODE.replace('PREM', 'STAR'), username: 'telegram_user', stars_quantity: 1000000, stars: 1000000, term_months: 12, product_family: 'telegram_premium', status_token: TOKEN, idempotency_key: KEY } });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, order({ product_family: 'telegram_stars', term_months: null, stars_quantity: 500, existing: false, status_token: TOKEN }));
    assert.deepEqual(Object.keys(calls[0].params).sort(), ['p_code_digest', 'p_idempotency_key_hash', 'p_status_token_hash', 'p_username']);
    assert.equal(JSON.stringify(result.body).includes('private'), false);
});

test('public status accepts legacy Premium and rejects malformed product entitlements', async () => {
    const legacy = { success: true, order_no: 'TG-1234567890ABCDEF', status: 'pending', term_months: 3 };
    const req = { url: '/?order_no=TG-1234567890ABCDEF', headers: { 'x-tg-status-token': TOKEN } };
    assert.deepEqual((await call(publicHandlers(async () => ({ data: legacy })).status, req)).body, order());
    for (const patch of [
        { product_family: 'telegram_stars', term_months: 3, stars_quantity: 500 },
        { product_family: 'telegram_stars', term_months: null, stars_quantity: '500' },
        { product_family: 'telegram_stars', term_months: null, stars_quantity: 49 },
        { product_family: 'telegram_stars', term_months: null, stars_quantity: 1000001 },
        { product_family: 'telegram_stars', term_months: null, stars_quantity: 50.5 },
        { product_family: 'telegram_premium', stars_quantity: 500 },
        { product_family: 'unknown' }
    ]) {
        const result = await call(publicHandlers(async () => ({ data: order(patch) })).status, req);
        assert.equal(result.statusCode, 500, JSON.stringify(patch));
        assert.equal(result.body.stars_quantity, undefined);
    }
});

test('local public preview origins are allowed only outside production', async () => {
    const req = { url: '/?order_no=TG-1234567890ABCDEF', headers: { origin: 'http://localhost:8000', 'x-tg-status-token': TOKEN } };
    assert.equal((await call(publicHandlers(undefined, { env: { ...ENV, NODE_ENV: 'development' } }).status, req)).statusCode, 200);
    for (const runtime of [{ NODE_ENV: 'production' }, { APP_ENV: 'production' }, { VERCEL_ENV: 'production' }]) {
        assert.equal((await call(publicHandlers(undefined, { env: { ...ENV, ...runtime } }).status, req)).statusCode, 403);
    }
});

test('admin Stars reconciliation verifies official quantity and does not mutate orders', async () => {
    for (const quantity of [500, '500', 501, null]) {
        const localOrder = { id: UUID, order_no: 'TG-1234567890ABCDEF', product_family: 'telegram_stars', term_months: null, stars_quantity: 500, telegram_username: 'telegram_user', provider_order_id: UUID, provider_payment_currency: 'usdt', provider_idempotency_key: KEY };
        const supabase = { from() { return {
            select(columns) { assert.ok(columns.includes('product_family')); assert.ok(columns.includes('stars_quantity')); return this; },
            eq() { return this; }, async maybeSingle() { return { data: localOrder }; }
        }; } };
        const handler = createOrdersHandler({ admin: stubAdmin(supabase), clientFactory: () => ({ async getOrder() { return { statusCode: 200, data: {
            id: UUID, recipientName: 'telegram_user', type: 'stars', method: 'api', status: 'completed', currency: 'usd', amount: '1.25', extraData: { quantityStars: quantity }
        } }; } }) });
        const result = await call(handler, { url: `/?orderId=${UUID}&reconcile=1` });
        assert.equal(result.statusCode, 200);
        assert.equal(result.body.reconciliation.verified, quantity === 500);
        assert.equal(result.body.order.provider_idempotency_key, undefined);
        if (quantity === 500) assert.equal(result.body.reconciliation.snapshot.stars_quantity, 500);
        else assert.equal(result.body.reconciliation.snapshot, null);
    }
});
