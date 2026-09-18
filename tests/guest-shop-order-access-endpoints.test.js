'use strict';

/**
 * Order Access 2.0 (A2) endpoint contract.
 *
 * Contract: docs/guest-shop-order-access-2.0.md
 *   §7.1  X-Guest-Order-Credential transport + __Host-gs-acc session cookie
 *   §8.1  ONE shared login budget for the header path and the login endpoint
 *   §9.1  unified 403 for unknown-email / wrong-password / no-order
 *   §9.2  ownership by buyer_id; every non-match collapses to 404, never 403
 *   §11.2 list/detail/delivery payload shape
 *   §12   flat-key routing (the dispatcher has no path parameters)
 *   §13.4 switch off => byte-identical behaviour to today
 *
 * The scrypt verification here is the REAL one: a stubbed verifier would make
 * the equal-cost and lockout assertions meaningless.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const security = require('../api/_lib/guest-shop/security');
const { createGuestShopHandlers } = require('../server/api-handlers/public/guest-shop');

const BUYER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_BUYER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORDER_NO = 'GS20260921-000001';
const EMAIL = 'guest.buyer@example.com';
const PASSWORD = 'Ab3!xY9#';
// Minted once for the whole file: scrypt at N=32768 costs ~100ms and the point
// of these tests is the authorization logic, not re-deriving the same hash.
const PASSWORD_HASH = security.hashGuestQueryPassword(PASSWORD);

const CLAIM_PEPPER = 'guest-claim-pepper-012345678901234567890123456789';
const CONTACT_PEPPER = 'guest-contact-hash-pepper-0123456789-abcdefghijklmnopqrstuvwx';
const REQUEST_PEPPER = 'guest-request-hash-pepper-0123456789-abcdefghijklmnopqrstuvwx';

const BASE_ENV = Object.freeze({
    APP_ENV: 'test',
    APP_BASE_URL: 'https://www.fatherkey.com',
    GUEST_SHOP_CLAIM_PEPPER: CLAIM_PEPPER,
    GUEST_SHOP_CLAIM_DERIVATION_PEPPER: 'guest-derivation-pepper-0123456789-abcdefghijklmnopqrstuv',
    GUEST_SHOP_CONTACT_HASH_PEPPER: CONTACT_PEPPER,
    GUEST_SHOP_REQUEST_HASH_PEPPER: REQUEST_PEPPER,
    GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true'
});

const OFF_ENV = Object.freeze({ ...BASE_ENV, GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'false' });

const COOKIE_NAME = '__Host-gs-acc';

function contactHashOf(email = EMAIL) {
    return security.hashGuestContact(email, { env: BASE_ENV, strict: true });
}

/**
 * The group key is (site, contact_hash): loadBuyerGroups filters on both, so a
 * fixture row without them is invisible to the login path and every credential
 * would collapse into the unified 403. The contact hash is an HMAC digest from
 * this file's own pepper, never the plaintext email.
 */
function makeBuyerRow(overrides = {}) {
    return {
        id: BUYER_ID,
        site: 'cn',
        contact_hash: contactHashOf(),
        credential_group_no: 1,
        password_hash: PASSWORD_HASH,
        password_version: 2,
        failed_login_count: 0,
        login_lock_stage: 0,
        locked_until: null,
        merged_into_user_id: null,
        ...overrides
    };
}

function makeOrderRow(overrides = {}) {
    return {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        order_no: ORDER_NO,
        buyer_id: BUYER_ID,
        site: 'cn',
        currency: 'CNY',
        total_amount: '12.34',
        unit_amount: '12.34',
        quantity: 1,
        payment_status: 'pending',
        fulfillment_status: 'pending',
        refund_status: 'none',
        expires_at: '2099-01-01T00:00:00.000Z',
        created_at: '2026-09-21T00:00:00.000Z',
        ...overrides
    };
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
        get headers() { return state.headers; },
        get payload() { return state.body ? JSON.parse(state.body) : null; },
        get cookies() {
            const raw = state.headers['set-cookie'];
            return Array.isArray(raw) ? raw : (raw ? [String(raw)] : []);
        }
    };
}

/**
 * PostgREST-shaped stub covering exactly the access patterns A2 uses:
 * the audit insert/count, the buyer-group read + conditional CAS updates,
 * the paginated order list and the single owned-order read.
 */
function createSupabaseStub(state) {
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
            insert(rows) {
                const list = Array.isArray(rows) ? rows : [rows];
                for (const row of list) state.attempts.push({ ...row, created_at: new Date().toISOString() });
                return Promise.resolve({ data: null, error: null });
            },
            eq(field, value) { filters.push({ type: 'eq', field: String(field), value }); return query; },
            gte(field, value) { filters.push({ type: 'gte', field: String(field), value }); return query; },
            is(field, value) { filters.push({ type: 'is', field: String(field), value }); return query; },
            in(field, values) { filters.push({ type: 'in', field: String(field), values }); return query; },
            order() { return query; },
            limit(n) { filters.push({ type: 'limit', n: Number(n) }); return query; },
            range(from, to) { rangeArgs = { from: Number(from), to: Number(to) }; return query; },
            async maybeSingle() { const result = await execute(); return { data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data, error: result.error, count: result.count }; },
            async single() { return query.maybeSingle(); },
            then(resolve, reject) { return execute().then(resolve, reject); }
        };

        function rowsFor() {
            if (table === 'guest_shop_buyers') return state.buyers;
            if (table === 'guest_shop_access_attempts') return state.attempts;
            if (table === 'guest_shop_orders') return state.orders;
            return [];
        }

        function matches(row) {
            return filters.every((filter) => {
                if (filter.type === 'limit') return true;
                if (filter.type === 'in') return filter.values.includes(row?.[filter.field]);
                if (filter.type === 'gte') return String(row?.[filter.field] ?? '') >= String(filter.value);
                if (filter.type === 'is') {
                    return filter.value === null ? row?.[filter.field] == null : row?.[filter.field] === filter.value;
                }
                return row?.[filter.field] === filter.value;
            });
        }

        async function execute() {
            await new Promise((resolve) => setImmediate(resolve));
            if (operation === 'update') {
                const row = rowsFor().find(matches);
                if (!row) return { data: null, error: null };
                Object.assign(row, JSON.parse(JSON.stringify(patch)));
                return { data: JSON.parse(JSON.stringify(row)), error: null };
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

    return {
        from(table) {
            return {
                select(columns = '*', options) { return builder(table, 'select').select(columns, options); },
                update(patch) { return builder(table, 'update', patch); },
                insert(rows) { return builder(table, 'insert').insert(rows); }
            };
        },
        async rpc(name, args) {
            state.rpcCalls.push({ name, args });
            await new Promise((resolve) => setImmediate(resolve));
            if (name === 'fn_guest_shop_claim_fulfillment') {
                const order = state.orders.find((row) => row.id === args?.p_order_id);
                if (!order) return { data: [], error: null };
                return {
                    data: [{
                        order_id: order.id,
                        reservation_status: state.reservationStatus,
                        fulfillment_status: order.fulfillment_status,
                        content: state.deliveryContent
                    }],
                    error: null
                };
            }
            throw new Error(`unexpected rpc ${name}`);
        }
    };
}

function createHarness({ env = BASE_ENV, state: stateOverrides = {}, rateLimited = false } = {}) {
    const state = {
        buyers: [makeBuyerRow()],
        attempts: [],
        orders: [makeOrderRow()],
        rpcCalls: [],
        reservationStatus: 'consumed',
        deliveryContent: 'CARD-KEY-0001',
        ...stateOverrides
    };
    const supabase = createSupabaseStub(state);
    const limitCalls = [];
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
            async takeRateLimitToken(args) {
                limitCalls.push(args?.key);
                return rateLimited ? { allowed: false } : { allowed: true };
            },
            applyRateLimitHeaders() {},
            resolveClientIp() { return '198.51.100.10'; }
        },
        security: {
            ...security,
            async readJsonBodyWithLimit(req) { return req.body; }
        },
        paymentAdapter: null,
        env
    });
    return { state, handlers, limitCalls, supabase };
}

function credentialHeader(email = EMAIL, password = PASSWORD) {
    return security.buildGuestOrderCredentialHeader(email, password);
}

/**
 * Mirrors the handler's internal hashRequestAttribute so the per-IP budget test
 * can seed audit rows the real counter will actually find. The value is an HMAC
 * digest, never the raw IP, and the pepper comes from this file's own fixture.
 */
function ipHashOf(ip = '198.51.100.10') {
    return crypto.createHmac('sha256', REQUEST_PEPPER).update(String(ip)).digest('hex');
}

function loginBody(overrides = {}) {
    return { email: EMAIL, password: PASSWORD, site: 'cn', ...overrides };
}

/**
 * Every guest read carries `site`: the credential group key is
 * (site, contact_hash), so the login path cannot resolve a group without it.
 * js/guest-orders-client.js puts it in the query string of every request and in
 * the login body, which is what these helpers mirror.
 */
function getReq(path, query = {}, headers = {}) {
    return {
        method: 'GET',
        url: path,
        query: { site: 'cn', ...query },
        headers: { 'user-agent': 'guest-test', ...headers }
    };
}

function postReq(path, body = {}, headers = {}) {
    return {
        method: 'POST',
        url: path,
        query: {},
        headers: { 'content-type': 'application/json', 'user-agent': 'guest-test', ...headers },
        body
    };
}

function setCookieValue(res) {
    for (const cookie of res.cookies) {
        if (cookie.startsWith(`${COOKIE_NAME}=`)) return cookie;
    }
    return '';
}

function sessionToken(res) {
    const cookie = setCookieValue(res);
    if (!cookie) return '';
    const value = cookie.slice(`${COOKIE_NAME}=`.length).split(';')[0];
    try { return decodeURIComponent(value); } catch (_) { return value; }
}

// ---------------------------------------------------------------------------
// §13.4 — switch off is byte-identical to today
// ---------------------------------------------------------------------------

test('with the credential switch off every new route answers 404 guest_feature_disabled', async () => {
    const { handlers } = createHarness({ env: OFF_ENV });

    const detail = createResponse();
    await handlers.order(getReq('/api/shop/guest/order', { order_no: ORDER_NO }, {
        'x-guest-order-credential': credentialHeader()
    }), detail);
    assert.equal(detail.statusCode, 404);
    assert.equal(detail.payload.code, 'guest_feature_disabled');

    const delivery = createResponse();
    await handlers.delivery(getReq('/api/shop/guest/delivery', { order_no: ORDER_NO }, {
        'x-guest-order-credential': credentialHeader()
    }), delivery);
    assert.equal(delivery.statusCode, 404);
    assert.equal(delivery.payload.code, 'guest_feature_disabled');

    const login = createResponse();
    await handlers.accessLogin(postReq('/api/shop/guest/access/login', loginBody()), login);
    assert.equal(login.statusCode, 404);
    assert.equal(login.payload.code, 'guest_feature_disabled');
    assert.equal(login.cookies.length, 0, 'a disabled feature must not issue a session cookie');
});

test('with the switch off GET /guest/orders keeps today\'s 405 and never reaches the list handler', async () => {
    const { handlers, limitCalls } = createHarness({ env: OFF_ENV });
    const res = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', {}, {
        'x-guest-order-credential': credentialHeader()
    }), res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, 'POST');
    assert.equal(res.payload.success, false);
    // No credential verification, no audit row, no read budget consumed: the
    // request must be indistinguishable from today's method-not-allowed path.
    assert.equal(limitCalls.length, 0);
});

test('logout is never switch-gated so a rollback cannot strand a live cookie', async () => {
    const { handlers } = createHarness({ env: OFF_ENV });
    const res = createResponse();
    await handlers.accessLogout(postReq('/api/shop/guest/access/logout', { site: 'cn' }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { success: true, logged_out: true });
    const cookie = setCookieValue(res);
    assert.ok(cookie.startsWith(`${COOKIE_NAME}=;`), 'logout must expire the cookie');
    assert.match(cookie, /Max-Age=0/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Domain=/i, 'a __Host- cookie must not carry a Domain attribute');
});

// ---------------------------------------------------------------------------
// §7.1 — transport rules
// ---------------------------------------------------------------------------

test('credentials in a query string are rejected with 400 and audited, never verified', async () => {
    const { handlers, state } = createHarness();
    for (const [name, value] of [
        ['email', EMAIL],
        ['password', PASSWORD],
        ['orderPassword', PASSWORD],
        ['order_password', PASSWORD]
    ]) {
        const res = createResponse();
        await handlers.order(getReq('/api/shop/guest/order', { order_no: ORDER_NO, site: 'cn', [name]: value }), res);
        assert.equal(res.statusCode, 400, `${name} in the query string must be rejected`);
        assert.equal(res.payload.code, 'guest_credential_malformed');
        assert.match(res.payload.message, /不支持通过 URL 传递查询凭证/);
    }
    // The rejection is audited so a URL-credential probe is visible, and the
    // audit row must never contain the submitted secret.
    assert.ok(state.attempts.length > 0);
    const serialized = JSON.stringify(state.attempts);
    assert.equal(serialized.includes(PASSWORD), false, 'the audit trail must not store the query password');
    assert.equal(serialized.includes(EMAIL), false, 'the audit trail stores a contact hash, never the email');
});

test('the session cookie wins over the header and authorizes by buyer_id', async () => {
    const { handlers } = createHarness();
    const login = createResponse();
    await handlers.accessLogin(postReq('/api/shop/guest/access/login', loginBody()), login);
    assert.equal(login.statusCode, 200);
    assert.equal(login.payload.authenticated, true);
    assert.equal(login.payload.email, EMAIL);
    assert.equal(login.payload.session_expires_in_seconds, 1800);
    const token = sessionToken(login);
    assert.ok(token.startsWith('v1.'), 'the cookie token must be versioned');
    // The response echoes only the buyer's own email; buyer_id stays inside the
    // encrypted cookie (§6.4).
    assert.equal(JSON.stringify(login.payload).includes(BUYER_ID), false);

    const list = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', {}, { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` }), list);
    assert.equal(list.statusCode, 200);
    assert.equal(list.payload.success, true);
    assert.equal(list.payload.orders.length, 1);
    assert.deepEqual(list.payload.pagination, { page: 1, page_size: 20, total: 1 });
});

test('a forged or expired session cookie falls through to the unified 403', async () => {
    const { handlers } = createHarness();
    const forged = 'v1.' + Buffer.from('0'.repeat(16)).toString('base64url')
        + '.' + Buffer.from('0'.repeat(16)).toString('base64url')
        + '.' + Buffer.from('not-a-real-session').toString('base64url');
    const res = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', {}, { cookie: `${COOKIE_NAME}=${encodeURIComponent(forged)}` }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.code, 'guest_order_credentials_invalid');

    const missing = createResponse();
    await handlers.order(getReq('/api/shop/guest/order', { order_no: ORDER_NO }), missing);
    assert.equal(missing.statusCode, 403);
    assert.equal(missing.payload.code, 'guest_order_credentials_invalid');
});

// ---------------------------------------------------------------------------
// §9.1 / §8.1 — unified rejection, shared budget, lockout
// ---------------------------------------------------------------------------

test('unknown email and wrong password are indistinguishable in the response body', async () => {
    const { handlers } = createHarness();
    const unknown = createResponse();
    await handlers.accessLogin(postReq('/api/shop/guest/access/login', loginBody({ email: 'nobody@example.com' })), unknown);
    const wrong = createResponse();
    await handlers.accessLogin(postReq('/api/shop/guest/access/login', loginBody({ password: 'Zz9!wrongOne' })), wrong);

    assert.equal(unknown.statusCode, 403);
    assert.equal(wrong.statusCode, 403);
    assert.equal(unknown.payload.code, 'guest_order_credentials_invalid');
    assert.equal(wrong.payload.code, 'guest_order_credentials_invalid');
    assert.equal(unknown.payload.message, wrong.payload.message);
    assert.deepEqual(Object.keys(unknown.payload).sort(), Object.keys(wrong.payload).sort());
    assert.equal(unknown.cookies.length, 0);
    assert.equal(wrong.cookies.length, 0);
});

test('a locked contact answers 423 before any scrypt work is billed to it', async () => {
    const lockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { handlers, state } = createHarness({
        state: { buyers: [makeBuyerRow({ locked_until: lockedUntil, login_lock_stage: 1, failed_login_count: 5 })] }
    });
    const res = createResponse();
    await handlers.accessLogin(postReq('/api/shop/guest/access/login', loginBody()), res);
    // The correct password must NOT be honoured while the contact is locked:
    // otherwise the lock is decoration and the buyer learns the password worked.
    assert.equal(res.statusCode, 423);
    assert.equal(res.payload.code, 'guest_order_locked');
    assert.equal(res.cookies.length, 0);
    assert.equal(state.attempts.some((row) => row.outcome === 'locked'), true);
});

test('a merged credential group is retired fail-closed and looks like a wrong password', async () => {
    const { handlers, state } = createHarness({
        state: { buyers: [makeBuyerRow({ merged_into_user_id: '99999999-9999-4999-8999-999999999999' })] }
    });
    const res = createResponse();
    await handlers.accessLogin(postReq('/api/shop/guest/access/login', loginBody()), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.code, 'guest_order_credentials_invalid');
    assert.equal(res.cookies.length, 0);
    // Reuses the existing outcome enum rather than inventing a distinguishable
    // signal that would advertise the §10.4 merge state.
    assert.equal(state.attempts.some((row) => row.outcome === 'bad_password'), true);
    assert.equal(state.attempts.some((row) => row.outcome === 'merged'), false);
});

test('the per-IP budget is evaluated before the group read and answers 429', async () => {
    const { handlers, state } = createHarness();
    const failures = ['bad_password', 'unknown_email'];
    for (let index = 0; index < 20; index += 1) {
        state.attempts.push({
            site: 'cn',
            contact_hash: null,
            buyer_id: null,
            request_ip_hash: ipHashOf(),
            request_device_hash: null,
            outcome: failures[index % 2],
            created_at: new Date().toISOString()
        });
    }
    const res = createResponse();
    await handlers.accessLogin(postReq('/api/shop/guest/access/login', loginBody()), res);
    assert.equal(res.statusCode, 429);
    assert.equal(res.payload.code, 'guest_rate_limited');
    assert.equal(res.cookies.length, 0);
    assert.equal(state.attempts.some((row) => row.outcome === 'rate_limited'), true);
});

test('the coarse rate limiter is applied before authentication on every read route', async () => {
    const { handlers, limitCalls } = createHarness({ rateLimited: true });
    const list = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', {}, { 'x-guest-order-credential': credentialHeader() }), list);
    assert.equal(list.statusCode, 429);

    const detail = createResponse();
    await handlers.order(getReq('/api/shop/guest/order', { order_no: ORDER_NO }, { 'x-guest-order-credential': credentialHeader() }), detail);
    assert.equal(detail.statusCode, 429);

    const delivery = createResponse();
    await handlers.delivery(getReq('/api/shop/guest/delivery', { order_no: ORDER_NO }, { 'x-guest-order-credential': credentialHeader() }), delivery);
    assert.equal(delivery.statusCode, 429);

    // Card content gets a tighter budget than the list, and the login write
    // budget is tighter still (§8.1).
    assert.ok(limitCalls.includes('guest-shop:guest-orders-read:198.51.100.10'));
    assert.ok(limitCalls.includes('guest-shop:guest-orders-delivery:198.51.100.10'));
});

// ---------------------------------------------------------------------------
// §9.2 — ownership collapses to 404, never 403
// ---------------------------------------------------------------------------

test('another buyer\'s order is a 404 on both detail and delivery, not a 403', async () => {
    const { handlers } = createHarness({
        state: { orders: [makeOrderRow({ buyer_id: OTHER_BUYER_ID })] }
    });
    const header = { 'x-guest-order-credential': credentialHeader() };

    const detail = createResponse();
    await handlers.order(getReq('/api/shop/guest/order', { order_no: ORDER_NO }, header), detail);
    assert.equal(detail.statusCode, 404);
    assert.equal(detail.payload.code, 'guest_order_not_found');

    const delivery = createResponse();
    await handlers.delivery(getReq('/api/shop/guest/delivery', { order_no: ORDER_NO }, header), delivery);
    assert.equal(delivery.statusCode, 404);
    assert.equal(delivery.payload.code, 'guest_order_not_found');

    // A non-existent order number must be indistinguishable from a real order
    // belonging to someone else, or detail becomes an existence oracle.
    const ghost = createResponse();
    await handlers.order(getReq('/api/shop/guest/order', { order_no: 'GS00000000-999999' }, header), ghost);
    assert.equal(ghost.statusCode, 404);
    assert.equal(ghost.payload.code, 'guest_order_not_found');
    assert.deepEqual(Object.keys(ghost.payload).sort(), Object.keys(detail.payload).sort());
    assert.equal(ghost.payload.message, detail.payload.message);
});

test('a session for group 1 cannot read an order owned by group 2 of the same contact', async () => {
    // buyer_id, not contact_hash, is the authorization subject (§6.4.2).
    const { handlers } = createHarness({
        state: {
            buyers: [makeBuyerRow()],
            orders: [makeOrderRow({ buyer_id: OTHER_BUYER_ID })]
        }
    });
    const login = createResponse();
    await handlers.accessLogin(postReq('/api/shop/guest/access/login', loginBody()), login);
    assert.equal(login.statusCode, 200);
    const token = sessionToken(login);

    const res = createResponse();
    await handlers.order(getReq('/api/shop/guest/order', { order_no: ORDER_NO }, {
        cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}`
    }), res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.payload.code, 'guest_order_not_found');
});

// ---------------------------------------------------------------------------
// §11.2 — payload shape and the delivery gate
// ---------------------------------------------------------------------------

test('the list snapshot ships the discount container as null until L1/L2 fill it', async () => {
    const { handlers } = createHarness();
    const res = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', {}, { 'x-guest-order-credential': credentialHeader() }), res);
    assert.equal(res.statusCode, 200);
    const [order] = res.payload.orders;
    assert.deepEqual(order, {
        order_no: ORDER_NO,
        payment_status: 'pending',
        fulfillment_status: 'pending',
        refund_status: 'none',
        amount: '12.34',
        currency: 'CNY',
        expires_at: '2099-01-01T00:00:00.000Z',
        site: 'cn',
        quantity: 1,
        unit_amount: '12.34',
        created_at: '2026-09-21T00:00:00.000Z',
        coupon_discount: null,
        promo_discount: null
    });
    // Nothing secret or internal may ride along in the list payload.
    const serialized = JSON.stringify(res.payload);
    assert.equal(serialized.includes(BUYER_ID), false);
    assert.equal(serialized.includes('password_hash'), false);
    assert.equal(serialized.includes('recovery'), false);
    assert.equal(serialized.includes('claim'), false);
});

test('pagination and order_no filters are clamped, not trusted', async () => {
    const { handlers } = createHarness();
    const header = { 'x-guest-order-credential': credentialHeader() };

    const clamped = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', { page: '-1', pageSize: '99999' }, header), clamped);
    assert.equal(clamped.statusCode, 200);
    assert.deepEqual(clamped.payload.pagination, { page: 1, page_size: 50, total: 1 });

    const garbage = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', { page: 'abc', pageSize: '1e9' }, header), garbage);
    assert.equal(garbage.statusCode, 200);
    assert.deepEqual(garbage.payload.pagination, { page: 1, page_size: 20, total: 1 });

    const filtered = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', { order_no: 'GS-nope' }, header), filtered);
    assert.equal(filtered.statusCode, 200);
    assert.deepEqual(filtered.payload.orders, []);
    assert.equal(filtered.payload.pagination.total, 0);
});

test('delivery is gated on confirmed payment AND delivered fulfillment', async () => {
    const header = { 'x-guest-order-credential': credentialHeader() };
    const cases = [
        [{ payment_status: 'pending', fulfillment_status: 'pending' }, 409],
        [{ payment_status: 'confirmed', fulfillment_status: 'pending' }, 409],
        [{ payment_status: 'pending', fulfillment_status: 'delivered' }, 409],
        [{ payment_status: 'refunded', fulfillment_status: 'delivered' }, 409],
        [{ payment_status: 'confirmed', fulfillment_status: 'delivered' }, 200]
    ];
    for (const [overrides, expected] of cases) {
        const { handlers, state } = createHarness({ state: { orders: [makeOrderRow(overrides)] } });
        const res = createResponse();
        await handlers.delivery(getReq('/api/shop/guest/delivery', { order_no: ORDER_NO }, header), res);
        assert.equal(res.statusCode, expected, `${JSON.stringify(overrides)} must answer ${expected}`);
        if (expected === 409) {
            assert.equal(res.payload.code, 'guest_order_not_ready');
            // A not-ready order must not have touched the fulfillment RPC at all.
            assert.equal(state.rpcCalls.length, 0);
        } else {
            assert.equal(res.payload.success, true);
            assert.equal(res.payload.order_no, ORDER_NO);
            assert.equal(res.payload.content, 'CARD-KEY-0001');
        }
    }
});

test('detail and delivery reject non-GET methods with an Allow header', async () => {
    const { handlers } = createHarness();
    const header = { 'x-guest-order-credential': credentialHeader() };
    for (const [handler, path] of [['order', '/api/shop/guest/order'], ['delivery', '/api/shop/guest/delivery']]) {
        const res = createResponse();
        await handlers[handler]({ method: 'POST', url: path, query: { order_no: ORDER_NO }, headers: header, body: {} }, res);
        assert.equal(res.statusCode, 405);
        assert.equal(res.headers.allow, 'GET');
    }
    const login = createResponse();
    await handlers.accessLogin(getReq('/api/shop/guest/access/login'), login);
    assert.equal(login.statusCode, 405);
    assert.equal(login.headers.allow, 'POST');
});

test('the login body is field-whitelisted so a client cannot inject buyer_id or a site override', async () => {
    const { handlers, state } = createHarness();
    for (const extra of [{ buyer_id: OTHER_BUYER_ID }, { contact_hash: 'deadbeef' }, { admin: true }, { merged_into_user_id: null }]) {
        const res = createResponse();
        await handlers.accessLogin(postReq('/api/shop/guest/access/login', loginBody(extra)), res);
        assert.equal(res.statusCode, 400, `${Object.keys(extra)[0]} must be rejected`);
        assert.equal(res.payload.code, 'unknown_field');
        assert.equal(res.cookies.length, 0);
    }
    // A rejected body must not have produced a session row or a success audit.
    assert.equal(state.attempts.some((row) => row.outcome === 'success'), false);

    const blank = createResponse();
    await handlers.accessLogin(postReq('/api/shop/guest/access/login', loginBody({ email: '', password: '' })), blank);
    assert.equal(blank.statusCode, 400);
    assert.equal(blank.payload.code, 'guest_credential_malformed');
});

test('the session cookie is __Host- scoped, HttpOnly, Secure, SameSite=Strict and Path=/', async () => {
    const { handlers } = createHarness();
    const res = createResponse();
    await handlers.accessLogin(postReq('/api/shop/guest/access/login', loginBody()), res);
    assert.equal(res.statusCode, 200);
    const cookie = setCookieValue(res);
    assert.ok(cookie, 'login must set the session cookie');
    assert.ok(cookie.startsWith(`${COOKIE_NAME}=`), 'the cookie must use the __Host- name');
    assert.match(cookie, /Max-Age=1800/);
    // The `__Host-` prefix REQUIRES Path=/; the doc's illustrative
    // Path=/api/shop/guest would make browsers drop the cookie entirely.
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(cookie, /Domain=/i);
    // The token is encrypted, so neither the plaintext email nor the buyer id
    // may appear anywhere in the response.
    assert.equal(cookie.includes(EMAIL), false);
    assert.equal(cookie.includes(BUYER_ID), false);
    assert.equal(cookie.includes(PASSWORD), false);
});
