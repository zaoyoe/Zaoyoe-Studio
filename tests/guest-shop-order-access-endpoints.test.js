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
// Nullable columns the migration leaves to DEFAULT NULL. Mirrored here so an
// insert that omits them reads back the same way it does from PostgREST.
const NULLABLE_COLUMNS = Object.freeze({
    guest_shop_access_resets: Object.freeze({ used_at: null, consumed_ip_hash: null, revoked_at: null }),
    guest_shop_access_attempts: Object.freeze({ contact_hash: null, buyer_id: null, request_device_hash: null })
});

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
            // Table-aware since A3: the audit sink and the reset-link sink are
            // different tables, and an insert into guest_shop_access_resets must
            // be selectable afterwards (the issue path returns the new row).
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
            async maybeSingle() { const result = await execute(); return { data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data, error: result.error, count: result.count }; },
            async single() { return query.maybeSingle(); },
            then(resolve, reject) { return execute().then(resolve, reject); }
        };

        function rowsFor() {
            if (table === 'guest_shop_buyers') return state.buyers;
            if (table === 'guest_shop_access_attempts') return state.attempts;
            if (table === 'guest_shop_orders') return state.orders;
            if (table === 'guest_shop_access_resets') return state.resets;
            return [];
        }

        function matches(row) {
            return filters.every((filter) => {
                if (filter.type === 'limit') return true;
                if (filter.type === 'in') return filter.values.includes(row?.[filter.field]);
                if (filter.type === 'gte') return String(row?.[filter.field] ?? '') >= String(filter.value);
                // ISO-8601 timestamps sort lexicographically, which is what the
                // reset-link expiry filter relies on in PostgREST too.
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
                        // Column DEFAULT NULLs the real table applies. Without
                        // them `used_at` reads back as `undefined` here and as
                        // NULL in Postgres, and a test asserting "the link was
                        // not consumed" would be comparing against a value the
                        // database never actually stores.
                        ...NULLABLE_COLUMNS[table],
                        ...row
                    };
                    rowsFor().push(next);
                    created.push(JSON.parse(JSON.stringify(next)));
                }
                return { data: created, error: null, count: null };
            }
            if (operation === 'update') {
                // EVERY matching row, not the first. A3's admin unlock is a bulk
                // write across all credential groups of one contact, and a stub
                // that silently updated only row #1 would let that bug ship.
                // supabase-js returns an ARRAY from `update().select()` and a
                // single object from `.maybeSingle()`, so data is an array here
                // and maybeSingle() above narrows it.
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
            if (name === 'fn_guest_shop_list_delivered_content') {
                // Mirrors supabase/migrations/20260923_guest_shop_promo_l1l2.sql:
                // the helper re-validates the WHOLE order under the service-role
                // contract and raises a named token for every undeliverable state;
                // a healthy order returns one (reservation_id, item_index,
                // content) row per item, ordered by reservation creation.
                const order = state.orders.find((row) => row.id === args?.p_order_id);
                const raise = (message) => ({ data: null, error: { message, code: 'P0002' } });
                if (!order) return raise('guest_order_not_found');
                if (String(order.payment_status) !== 'confirmed') return raise('guest_payment_not_confirmed');
                if (String(order.fulfillment_status) !== 'delivered') return raise('guest_order_not_delivered');
                if (String(state.reservationStatus) !== 'consumed') return raise('guest_reservation_not_consumed');
                const requested = Number.isInteger(order.quantity) && order.quantity > 0 ? order.quantity : 1;
                const contents = Array.isArray(state.deliveryContents)
                    ? state.deliveryContents
                    : Array.from({ length: requested }, () => state.deliveryContent);
                if (contents.some((text) => typeof text !== 'string')) return raise('guest_consumed_inventory_inconsistent');
                return {
                    data: contents.map((content, index) => ({
                        reservation_id: crypto.randomUUID(),
                        item_index: index,
                        content
                    })),
                    error: null
                };
            }
            if (name === 'fn_guest_shop_upsert_buyer_group') {
                // Mirrors supabase/migrations/20260921_guest_shop_buyer_group_upsert.sql:
                // a verified match REUSES its group (and only overwrites the
                // password when the caller handed one in together with that
                // match); otherwise it allocates, and at the cap it raises the
                // named conflict token the resolver maps to a 409.
                const site = String(args?.p_site || '').trim();
                const hash = String(args?.p_contact_hash || '').trim();
                const cap = Number(args?.p_group_cap) || 3;
                const groups = state.buyers.filter((row) => row.site === site && row.contact_hash === hash);
                const matchedNo = args?.p_matched_group_no;
                if (matchedNo !== null && matchedNo !== undefined) {
                    const row = groups.find((item) => Number(item.credential_group_no) === Number(matchedNo));
                    if (row) {
                        if (args?.p_password_hash && args.p_password_hash !== row.password_hash) {
                            row.password_hash = args.p_password_hash;
                            row.password_version = Number(row.password_version || 1) + 1;
                        }
                        return {
                            data: [{ buyer_id: row.id, credential_group_no: Number(row.credential_group_no), allocation: 'reused' }],
                            error: null
                        };
                    }
                }
                if (!args?.p_password_hash) {
                    return { data: null, error: { message: 'guest_buyer_password_required', code: '22023' } };
                }
                if (groups.length >= cap) {
                    return { data: null, error: { message: 'guest_buyer_credential_conflict', code: '23505' } };
                }
                const nextNo = groups.reduce((max, row) => Math.max(max, Number(row.credential_group_no) || 0), 0) + 1;
                const created = crypto.randomUUID();
                state.buyers.push({
                    id: created,
                    site,
                    contact_hash: hash,
                    credential_group_no: nextNo,
                    password_hash: args.p_password_hash,
                    password_version: 1,
                    failed_login_count: 0,
                    login_lock_stage: 0,
                    locked_until: null,
                    merged_into_user_id: null,
                    created_at: new Date().toISOString()
                });
                return {
                    data: [{ buyer_id: created, credential_group_no: nextNo, allocation: 'created' }],
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
        resets: [],
        rpcCalls: [],
        reservationStatus: 'consumed',
        deliveryContent: 'CARD-KEY-0001',
        // L1: an order can hold several consumed reservations; deliveryContents
        // overrides the per-item content when a test needs a multi-card order.
        deliveryContents: null,
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
    // v2 (A3): the payload carries `pv`, the password_version the session was
    // minted with. v1 is rejected outright by decryptAccessCookie so that a
    // pre-A3 cookie can never survive a reset-link revocation.
    assert.ok(token.startsWith('v2.'), 'the cookie token must be versioned');
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
    const forged = 'v2.' + Buffer.from('0'.repeat(16)).toString('base64url')
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

// ---------------------------------------------------------------------------
// §11.2 + Promo L1/L2 — a multi-unit order and the committed amount breakdown
// ---------------------------------------------------------------------------

test('L1: a multi-unit order delivers every card in one payload', async () => {
    const header = { 'x-guest-order-credential': credentialHeader() };
    const { handlers, state } = createHarness({
        state: {
            orders: [makeOrderRow({
                payment_status: 'confirmed',
                fulfillment_status: 'delivered',
                quantity: 3,
                list_unit_amount: '12.34',
                unit_amount: '12.34',
                discount_amount: '0.00',
                payment_fee_amount: '0.38',
                total_amount: '37.40'
            })],
            deliveryContents: ['CARD-KEY-0001', 'CARD-KEY-0002', 'CARD-KEY-0003']
        }
    });
    const res = createResponse();
    await handlers.delivery(getReq('/api/shop/guest/delivery', { order_no: ORDER_NO }, header), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    // One card keeps the pre-L1 single-string shape; several are joined so the
    // buyer receives every item without a client change.
    assert.equal(res.payload.content, 'CARD-KEY-0001\n\nCARD-KEY-0002\n\nCARD-KEY-0003');
    // One round-trip for the whole order, never one call per item.
    const deliveryCalls = state.rpcCalls.filter((call) => call.name === 'fn_guest_shop_list_delivered_content');
    assert.equal(deliveryCalls.length, 1);
    assert.deepEqual(deliveryCalls[0].args, { p_order_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
});

test('L1: a partially delivered order is a 409, never a truncated payload', async () => {
    const header = { 'x-guest-order-credential': credentialHeader() };
    // fn_guest_shop_list_delivered_content raises guest_reservation_not_consumed
    // unless EVERY reservation of the order is consumed; the endpoint must map
    // that onto its existing 409 contract instead of rendering what it has.
    const { handlers } = createHarness({
        state: {
            orders: [makeOrderRow({
                payment_status: 'confirmed',
                fulfillment_status: 'delivered',
                quantity: 2,
                unit_amount: '12.34',
                total_amount: '24.68'
            })],
            reservationStatus: 'held'
        }
    });
    const res = createResponse();
    await handlers.delivery(getReq('/api/shop/guest/delivery', { order_no: ORDER_NO }, header), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.code, 'guest_inventory_inconsistent');
    assert.equal('content' in res.payload, false);
});

test('L2: the list snapshot fills coupon_discount and amount_breakdown from committed columns', async () => {
    const { handlers } = createHarness({
        state: {
            orders: [makeOrderRow({
                quantity: 2,
                list_unit_amount: '12.34',
                unit_amount: '11.11',
                discount_amount: '2.46',
                discount_code: 'WELCOME10',
                payment_fee_amount: '0.23',
                total_amount: '22.45'
            })]
        }
    });
    const res = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', {}, { 'x-guest-order-credential': credentialHeader() }), res);
    assert.equal(res.statusCode, 200);
    const [order] = res.payload.orders;
    assert.equal(order.quantity, 2);
    assert.equal(order.coupon_discount, 2.46);
    assert.equal(order.promo_discount, null);
    assert.deepEqual(order.amount_breakdown, {
        quantity: 2,
        unit_amount: 11.11,
        net_amount: 22.22,
        discount_amount: 2.46,
        payment_fee_amount: 0.23,
        total_amount: 22.45,
        currency: 'CNY',
        list_unit_amount: 12.34,
        list_amount: 24.68,
        discount_code: 'WELCOME10'
    });
});

test('L2: an inconsistent committed row drops the breakdown instead of lying about it', async () => {
    // total != unit*qty + fee. buildGuestAmountBreakdown must return null so the
    // client never renders a breakdown that does not add up to the amount owed.
    const { handlers } = createHarness({
        state: {
            orders: [makeOrderRow({
                quantity: 2,
                list_unit_amount: '12.34',
                unit_amount: '11.11',
                discount_amount: '2.46',
                payment_fee_amount: '0.23',
                total_amount: '99.99'
            })]
        }
    });
    const res = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', {}, { 'x-guest-order-credential': credentialHeader() }), res);
    assert.equal(res.statusCode, 200);
    const [order] = res.payload.orders;
    assert.equal('amount_breakdown' in order, false);
    assert.equal(order.quantity, 2);
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

// ---------------------------------------------------------------------------
// A3 — §10.5 one-time reset link + §13.2 historical-order self-upgrade
// ---------------------------------------------------------------------------

const buyerAccessAdmin = require('../api/_lib/guest-shop/buyer-access-admin');

const ADMIN_UUID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
// A real claim secret: 43 base64url chars, which is what the upgrade endpoint's
// /^[A-Za-z0-9_-]{40,200}$/ shape check and verifyClaimSecret both expect.
const RECOVERY_CODE = security.generateClaimSecret();
const CLAIM_HASH = security.hashClaimSecret(RECOVERY_CODE, { env: BASE_ENV });
const LEGACY_ORDER_NO = 'GS20260101-000009';
const LEGACY_ORDER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const NEW_PASSWORD = 'Qw8#rT2!yZ';
const WEAK_PASSWORD = 'abc';

/**
 * A HISTORICAL order: placed before the credential switch existed, so
 * `buyer_id IS NULL` and the only proof of ownership is orderNo + claim secret.
 * This is the exact row shape §13.2's self-upgrade has to work on.
 */
function makeLegacyOrderRow(overrides = {}) {
    return makeOrderRow({
        id: LEGACY_ORDER_ID,
        order_no: LEGACY_ORDER_NO,
        buyer_id: null,
        claim_secret_hash: CLAIM_HASH,
        claim_attempt_count: 0,
        last_error_code: null,
        last_error_message: null,
        created_at: '2026-01-01T00:00:00.000Z',
        ...overrides
    });
}

/** Issues a link through the REAL admin primitive, against the test stub. */
async function issueLink(supabase, { buyerId = BUYER_ID, site = 'cn', reason = '客服核实身份后补发一次性找回链接' } = {}) {
    const buyer = await buyerAccessAdmin.loadBuyerRowById({ supabase, buyerId, site });
    return buyerAccessAdmin.issuePasswordResetLink({ supabase, buyer, adminId: ADMIN_UUID, reason });
}

function resetBody(overrides = {}) {
    return { token: 'A'.repeat(43), email: EMAIL, password: NEW_PASSWORD, site: 'cn', ...overrides };
}

function upgradeBody(overrides = {}) {
    return {
        orderNo: LEGACY_ORDER_NO,
        recoveryCode: RECOVERY_CODE,
        email: EMAIL,
        password: PASSWORD,
        site: 'cn',
        ...overrides
    };
}

function outcomesOf(state) {
    return state.attempts.map((row) => row.outcome);
}

test('A3: with the switch off reset and upgrade answer 404 guest_feature_disabled', async () => {
    const { handlers } = createHarness({ env: OFF_ENV });
    const reset = createResponse();
    await handlers.accessReset(postReq('/api/shop/guest/access/reset', resetBody()), reset);
    assert.equal(reset.statusCode, 404);
    assert.equal(reset.payload.code, 'guest_feature_disabled');
    assert.equal(reset.cookies.length, 0);

    const upgrade = createResponse();
    await handlers.accessUpgrade(postReq('/api/shop/guest/access/upgrade', upgradeBody()), upgrade);
    assert.equal(upgrade.statusCode, 404);
    assert.equal(upgrade.payload.code, 'guest_feature_disabled');
    assert.equal(upgrade.cookies.length, 0);
});

test('A3: reset and upgrade reject non-POST methods with an Allow header', async () => {
    const { handlers, limitCalls } = createHarness();
    for (const [name, path] of [['accessReset', '/api/shop/guest/access/reset'], ['accessUpgrade', '/api/shop/guest/access/upgrade']]) {
        const res = createResponse();
        await handlers[name](getReq(path), res);
        assert.equal(res.statusCode, 405, `${name} must be POST-only`);
        assert.equal(res.headers.allow, 'POST');
        assert.equal(res.cookies.length, 0);
    }
    // A 405 must be answered before any budget is spent.
    assert.equal(limitCalls.length, 0);
});

test('A3: reset and upgrade bodies are field-whitelisted', async () => {
    const { handlers, state } = createHarness({ state: { orders: [makeLegacyOrderRow()] } });
    for (const extra of [{ buyer_id: OTHER_BUYER_ID }, { contact_hash: 'deadbeef' }, { admin: true }, { pv: 99 }]) {
        const key = Object.keys(extra)[0];
        const a = createResponse();
        await handlers.accessReset(postReq('/api/shop/guest/access/reset', resetBody(extra)), a);
        assert.equal(a.statusCode, 400, `reset must reject ${key}`);
        assert.equal(a.payload.code, 'unknown_field');
        assert.equal(a.cookies.length, 0);

        const b = createResponse();
        await handlers.accessUpgrade(postReq('/api/shop/guest/access/upgrade', upgradeBody(extra)), b);
        assert.equal(b.statusCode, 400, `upgrade must reject ${key}`);
        assert.equal(b.payload.code, 'unknown_field');
        assert.equal(b.cookies.length, 0);
    }
    assert.equal(outcomesOf(state).includes('reset_success'), false);
    assert.equal(outcomesOf(state).includes('upgrade_success'), false);
});

test('A3: an issued link is 43 base64url chars, only its sha256 is persisted, and issuing bumps password_version', async () => {
    const { state, supabase } = createHarness();
    assert.equal(state.buyers[0].password_version, 2);
    const issued = await issueLink(supabase);
    assert.match(issued.token, buyerAccessAdmin.RESET_TOKEN_PATTERN);
    assert.equal(issued.token.length, buyerAccessAdmin.RESET_TOKEN_LENGTH);
    assert.equal(issued.passwordVersion, 3, 'issuing must revoke every live session first (I3)');
    assert.equal(state.buyers[0].password_version, 3);
    assert.equal(state.resets.length, 1);
    assert.equal(state.resets[0].token_hash, buyerAccessAdmin.hashResetToken(issued.token));
    // The plaintext token must not exist anywhere in the database state.
    assert.equal(JSON.stringify(state.resets).includes(issued.token), false);
    assert.equal(state.resets[0].purpose, 'password_reset');
    assert.equal(state.resets[0].used_at, null);
    assert.equal(state.resets[0].revoked_at, null);
});

test('A3: invalid, expired, used and revoked links all collapse to ONE identical 403', async () => {
    const { handlers, state, supabase } = createHarness();
    const payloads = [];

    // 1. a token that was never issued
    const never = createResponse();
    await handlers.accessReset(postReq('/api/shop/guest/access/reset', resetBody({
        token: buyerAccessAdmin.issueResetToken().token
    })), never);
    payloads.push(never.payload);

    // 2. expired
    const expiring = await issueLink(supabase);
    state.resets[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const expired = createResponse();
    await handlers.accessReset(postReq('/api/shop/guest/access/reset', resetBody({ token: expiring.token })), expired);
    payloads.push(expired.payload);
    assert.equal(state.resets[0].used_at, null, 'an expired link must not be marked used');

    // 3. revoked
    state.resets[0].expires_at = new Date(Date.now() + 600000).toISOString();
    state.resets[0].revoked_at = new Date().toISOString();
    const revoked = createResponse();
    await handlers.accessReset(postReq('/api/shop/guest/access/reset', resetBody({ token: expiring.token })), revoked);
    payloads.push(revoked.payload);

    // 4. already used
    state.resets[0].revoked_at = null;
    state.resets[0].used_at = new Date().toISOString();
    const used = createResponse();
    await handlers.accessReset(postReq('/api/shop/guest/access/reset', resetBody({ token: expiring.token })), used);
    payloads.push(used.payload);

    // 5. malformed shape
    const malformed = createResponse();
    await handlers.accessReset(postReq('/api/shop/guest/access/reset', resetBody({ token: 'not-a-token' })), malformed);
    payloads.push(malformed.payload);

    for (const [index, payload] of payloads.entries()) {
        assert.equal(payload.code, 'guest_reset_invalid', `case ${index}`);
        assert.deepEqual(payload, payloads[0], `case ${index} must be byte-identical (I4)`);
    }
    for (const res of [never, expired, revoked, used, malformed]) {
        assert.equal(res.statusCode, 403);
        assert.equal(res.cookies.length, 0, 'a rejected link must never mint a session');
    }
    // The password was never touched.
    assert.equal(state.buyers[0].password_hash, PASSWORD_HASH);
    assert.equal(state.buyers[0].password_version, 3, 'only the ISSUE bumps pv, not a failed consume');
    // Every rejection left evidence, and none of it is a LOGIN failure outcome
    // (a reset probe must not be able to lock a shared NAT out of the login page).
    const outcomes = outcomesOf(state);
    assert.equal(outcomes.filter((outcome) => outcome === 'reset_invalid').length, payloads.length);
    assert.equal(outcomes.includes('bad_password'), false);
    assert.equal(outcomes.includes('unknown_email'), false);
});

test('A3: a wrong email is rejected WITHOUT burning the link, and the right email then works', async () => {
    const { handlers, state, supabase } = createHarness();
    const issued = await issueLink(supabase);

    const wrong = createResponse();
    await handlers.accessReset(postReq('/api/shop/guest/access/reset', resetBody({
        token: issued.token, email: 'attacker@example.com'
    })), wrong);
    assert.equal(wrong.statusCode, 403);
    assert.equal(wrong.payload.code, 'guest_reset_invalid');
    assert.equal(wrong.cookies.length, 0);
    // Anti-griefing: the email is compared BEFORE the CAS consume, so stealing a
    // link without the mailbox cannot burn it, and a typo cannot lose it.
    assert.equal(state.resets[0].used_at, null, 'a wrong email must not consume the link');
    assert.equal(state.resets[0].consumed_ip_hash, null);
    assert.equal(state.buyers[0].password_hash, PASSWORD_HASH);
    // The audit row names the group the link was minted for, not the attacker's
    // email, and contact_hash is an HMAC anyway.
    const invalid = state.attempts.filter((row) => row.outcome === 'reset_invalid');
    assert.equal(invalid.length, 1);
    assert.equal(invalid[0].contact_hash, contactHashOf());
    assert.equal(invalid[0].buyer_id, BUYER_ID);
    assert.equal(JSON.stringify(invalid[0]).includes('attacker@example.com'), false);

    const right = createResponse();
    await handlers.accessReset(postReq('/api/shop/guest/access/reset', resetBody({ token: issued.token })), right);
    assert.equal(right.statusCode, 200);
    assert.equal(right.payload.reset, true);
});

test('A3: a weak password is rejected before the link is consumed', async () => {
    const { handlers, state, supabase } = createHarness();
    const issued = await issueLink(supabase);
    const res = createResponse();
    await handlers.accessReset(postReq('/api/shop/guest/access/reset', resetBody({
        token: issued.token, password: WEAK_PASSWORD
    })), res);
    assert.equal(res.statusCode, 400, 'K26 strength is a 400, not the unified 403');
    assert.equal(res.cookies.length, 0);
    assert.equal(state.resets[0].used_at, null, 'the buyer must still be able to use their link');
    assert.equal(state.buyers[0].password_hash, PASSWORD_HASH);
    assert.equal(outcomesOf(state).includes('reset_success'), false);
});

test('A3: a link minted for cn cannot be spent with site=intl', async () => {
    const { handlers, state, supabase } = createHarness();
    const issued = await issueLink(supabase);
    const res = createResponse();
    await handlers.accessReset(postReq('/api/shop/guest/access/reset', resetBody({
        token: issued.token, site: 'intl'
    })), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.code, 'guest_reset_invalid');
    assert.equal(res.cookies.length, 0);
    assert.equal(state.resets[0].used_at, null);
    assert.equal(state.buyers[0].password_hash, PASSWORD_HASH);
});

test('A3: a successful reset consumes the link, moves password_version, kills the old cookie and signs the buyer in', async () => {
    const { handlers, state, supabase } = createHarness();

    // A live session minted BEFORE the link exists. It must die.
    const before = createResponse();
    await handlers.accessLogin(postReq('/api/shop/guest/access/login', loginBody()), before);
    assert.equal(before.statusCode, 200);
    const staleToken = sessionToken(before);
    const staleList = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', {}, {
        cookie: `${COOKIE_NAME}=${encodeURIComponent(staleToken)}`
    }), staleList);
    assert.equal(staleList.statusCode, 200, 'sanity: the cookie works before the reset');

    const issued = await issueLink(supabase);
    // I3: containment precedes remediation. The moment the admin mints a link,
    // every outstanding session of that group is already dead.
    const revokedList = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', {}, {
        cookie: `${COOKIE_NAME}=${encodeURIComponent(staleToken)}`
    }), revokedList);
    assert.equal(revokedList.statusCode, 403, 'issuing a link must revoke live sessions');
    assert.equal(revokedList.payload.code, 'guest_order_credentials_invalid');

    const res = createResponse();
    await handlers.accessReset(postReq('/api/shop/guest/access/reset', resetBody({ token: issued.token })), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.reset, true);
    assert.equal(res.payload.authenticated, true);
    assert.equal(res.payload.email, EMAIL);
    assert.equal(res.payload.session_expires_in_seconds, 1800);
    const cookie = setCookieValue(res);
    assert.ok(sessionToken(res).startsWith('v2.'), 'the new session cookie must be v2');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    // Nothing secret in the body: no token, no hash, no buyer id, no password.
    const body = JSON.stringify(res.payload);
    for (const forbidden of [issued.token, PASSWORD, NEW_PASSWORD, BUYER_ID, state.resets[0].token_hash]) {
        assert.equal(body.includes(forbidden), false, `the response must not carry ${forbidden.slice(0, 8)}…`);
    }

    // The link is single-use and records who spent it (hashed, never the IP).
    assert.ok(state.resets[0].used_at, 'the link must be consumed');
    assert.equal(state.resets[0].revoked_at, null, 'used and revoked are mutually exclusive');
    assert.ok(state.resets[0].consumed_ip_hash);
    assert.equal(state.resets[0].consumed_ip_hash.includes('198.51.100.10'), false);

    // pv moved twice: once on issue (2->3), once on the password write (3->4).
    assert.equal(state.buyers[0].password_version, 4);
    assert.notEqual(state.buyers[0].password_hash, PASSWORD_HASH);
    assert.equal(state.buyers[0].failed_login_count, 0, 'a reset clears the failure counter');
    assert.equal(state.buyers[0].locked_until, null, 'a reset clears the lock');
    assert.equal(outcomesOf(state).includes('reset_success'), true);

    // The new password works, the old one does not, and both look the same.
    const fresh = createResponse();
    await handlers.accessLogin(postReq('/api/shop/guest/access/login', loginBody({ password: NEW_PASSWORD })), fresh);
    assert.equal(fresh.statusCode, 200);
    const old = createResponse();
    await handlers.accessLogin(postReq('/api/shop/guest/access/login', loginBody()), old);
    assert.equal(old.statusCode, 403);
    assert.equal(old.payload.code, 'guest_order_credentials_invalid');

    // Replay of the same link is the unified 403, and does not undo the reset.
    const replay = createResponse();
    await handlers.accessReset(postReq('/api/shop/guest/access/reset', resetBody({ token: issued.token })), replay);
    assert.equal(replay.statusCode, 403);
    assert.deepEqual(replay.payload, { success: false, code: 'guest_reset_invalid', message: replay.payload.message });
    assert.equal(replay.cookies.length, 0);
    assert.equal(state.buyers[0].password_version, 4, 'a replay must not move pv again');

    // The session minted by the reset itself is usable.
    const list = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', {}, {
        cookie: `${COOKIE_NAME}=${encodeURIComponent(sessionToken(res))}`
    }), list);
    assert.equal(list.statusCode, 200);
    assert.equal(list.payload.orders.length, 1);
});

test('A3: a merged credential group cannot be reset through the guest link', async () => {
    const { handlers, state, supabase } = createHarness({
        state: { buyers: [makeBuyerRow({ merged_into_user_id: '11111111-2222-4333-8444-555555555555' })] }
    });
    const issued = await issueLink(supabase).then(
        () => { throw new Error('issuePasswordResetLink must refuse a merged group'); },
        (error) => error
    );
    assert.equal(issued.code, 'guest_buyer_merged');
    assert.equal(state.resets.length, 0);
});

// ---------------------------------------------------------------------------
// §13.2 — historical order self-upgrade
// ---------------------------------------------------------------------------

test('A3: upgrade refuses a wrong recovery code, spends the claim budget and leaves the order unbound', async () => {
    const { handlers, state } = createHarness({ state: { orders: [makeLegacyOrderRow()] } });
    const res = createResponse();
    await handlers.accessUpgrade(postReq('/api/shop/guest/access/upgrade', upgradeBody({
        recoveryCode: security.generateClaimSecret()
    })), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.code, 'guest_claim_invalid');
    assert.equal(res.cookies.length, 0, 'a wrong recovery code must never mint a session');
    assert.equal(state.orders[0].buyer_id, null, 'the order must stay unbound');
    assert.equal(state.orders[0].claim_attempt_count, 1, 'the shared recover budget must be spent');
    assert.equal(outcomesOf(state).includes('upgrade_invalid'), true);
    assert.equal(outcomesOf(state).includes('upgrade_success'), false);
    // No credential group was created for the attacker's email.
    assert.equal(state.buyers.length, 1);
});

test('A3: upgrade rejects malformed orderNo / recoveryCode shapes without touching the database', async () => {
    const { handlers, state } = createHarness({ state: { orders: [makeLegacyOrderRow()] } });
    for (const body of [
        upgradeBody({ orderNo: 'x' }),
        upgradeBody({ orderNo: '订单号 空格' }),
        upgradeBody({ recoveryCode: 'short' }),
        upgradeBody({ recoveryCode: '!' + 'A'.repeat(42) })
    ]) {
        const res = createResponse();
        await handlers.accessUpgrade(postReq('/api/shop/guest/access/upgrade', body), res);
        assert.equal(res.statusCode, 403);
        assert.equal(res.payload.code, 'guest_claim_invalid');
        assert.equal(res.cookies.length, 0);
    }
    assert.equal(state.orders[0].claim_attempt_count, 0, 'a shape reject must not spend the claim budget');
    assert.equal(state.orders[0].buyer_id, null);
});

test('A3: upgrade cannot CREATE a credential group from a weak password', async () => {
    const { handlers, state } = createHarness({ state: { orders: [makeLegacyOrderRow()] } });
    const res = createResponse();
    await handlers.accessUpgrade(postReq('/api/shop/guest/access/upgrade', upgradeBody({
        email: 'brand.new@example.com', password: WEAK_PASSWORD
    })), res);
    // K26 is enforced BEFORE resolveBuyerGroupForOrder, so the weak password
    // never reaches the allocator: a 400, not a 201-shaped success.
    assert.equal(res.statusCode, 400);
    assert.equal(res.cookies.length, 0);
    assert.equal(state.orders[0].buyer_id, null);
    assert.equal(state.buyers.length, 1, 'no new credential group may exist');
    assert.equal(outcomesOf(state).includes('upgrade_invalid'), true);
    assert.equal(outcomesOf(state).includes('upgrade_success'), false);
});

test('A3: upgrade binds a historical order to the credential group that matches the submitted password', async () => {
    const { handlers, state } = createHarness({ state: { orders: [makeLegacyOrderRow()] } });
    const res = createResponse();
    await handlers.accessUpgrade(postReq('/api/shop/guest/access/upgrade', upgradeBody()), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.upgraded, true);
    assert.equal(res.payload.already_bound, false);
    assert.equal(res.payload.order_no, LEGACY_ORDER_NO);
    assert.equal(res.payload.credential_group_no, 1);
    assert.equal(res.payload.authenticated, true);
    assert.ok(sessionToken(res).startsWith('v2.'));
    assert.equal(state.orders[0].buyer_id, BUYER_ID, 'the order is now owned by the matched group');
    assert.equal(state.buyers.length, 1, 'an existing match must REUSE its group, never allocate');
    assert.equal(state.buyers[0].password_hash, PASSWORD_HASH, 'the reuse path must not overwrite the password');
    assert.equal(outcomesOf(state).includes('upgrade_success'), true);

    // The bound order is now readable through the normal login path.
    const list = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', {}, {
        cookie: `${COOKIE_NAME}=${encodeURIComponent(sessionToken(res))}`
    }), list);
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.payload.orders.map((row) => row.order_no), [LEGACY_ORDER_NO]);
});

test('A3: upgrade with a fresh email allocates a new group and the order follows it', async () => {
    const { handlers, state } = createHarness({ state: { orders: [makeLegacyOrderRow()] } });
    const freshEmail = 'brand.new@example.com';
    const res = createResponse();
    await handlers.accessUpgrade(postReq('/api/shop/guest/access/upgrade', upgradeBody({
        email: freshEmail, password: NEW_PASSWORD
    })), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.already_bound, false);
    assert.equal(state.buyers.length, 2, 'a new credential group was allocated');
    const created = state.buyers.find((row) => row.id !== BUYER_ID);
    assert.equal(created.credential_group_no, 1, 'the new contact starts at group 1');
    assert.equal(created.site, 'cn');
    assert.equal(state.orders[0].buyer_id, created.id);
    // The old contact did NOT gain access to this order.
    const oldLogin = createResponse();
    await handlers.accessLogin(postReq('/api/shop/guest/access/login', loginBody()), oldLogin);
    assert.equal(oldLogin.statusCode, 200);
    const oldList = createResponse();
    await handlers.orders(getReq('/api/shop/guest/orders', {}, {
        cookie: `${COOKIE_NAME}=${encodeURIComponent(sessionToken(oldLogin))}`
    }), oldList);
    assert.equal(oldList.statusCode, 200);
    assert.deepEqual(oldList.payload.orders, [], 'the legacy order moved to the new group only');
});

test('A3: upgrade is idempotent for the same credential and a hard 409 for a different one', async () => {
    const { handlers, state } = createHarness({ state: { orders: [makeLegacyOrderRow()] } });
    const first = createResponse();
    await handlers.accessUpgrade(postReq('/api/shop/guest/access/upgrade', upgradeBody()), first);
    assert.equal(first.statusCode, 200);
    assert.equal(first.payload.already_bound, false);

    // A double-click must not be told the order is broken.
    const again = createResponse();
    await handlers.accessUpgrade(postReq('/api/shop/guest/access/upgrade', upgradeBody()), again);
    assert.equal(again.statusCode, 200);
    assert.equal(again.payload.already_bound, true);
    assert.equal(again.payload.order_no, LEGACY_ORDER_NO);
    assert.equal(state.orders[0].buyer_id, BUYER_ID);
    assert.ok(sessionToken(again).startsWith('v2.'), 'the legitimate owner is signed in');
});

/**
 * THE FIX B REGRESSION TEST.
 *
 * Before the hardening, `accessUpgrade` short-circuited on `order.buyer_id`:
 * it re-read the bound group and minted a session cookie for it WITHOUT ever
 * checking the submitted email + password. Anyone holding the LEGACY
 * orderNo + claim code — which is printed on the old recovery page and is the
 * weaker of the two factors — would have escalated from single-order legacy
 * access to GROUP-WIDE access: every order and every card secret in that
 * credential group. That is the 掏鸟蛋 case, so it gets its own test.
 */
test('A3: a bound order still requires the email + password — the legacy claim code alone grants nothing', async () => {
    const bound = makeLegacyOrderRow({ buyer_id: BUYER_ID });
    const { handlers, state } = createHarness({ state: { orders: [bound] } });

    // Correct orderNo + correct claim code, WRONG password, same email.
    const wrongPassword = createResponse();
    await handlers.accessUpgrade(postReq('/api/shop/guest/access/upgrade', upgradeBody({
        password: 'Wr4ng!Pass9'
    })), wrongPassword);
    assert.notEqual(wrongPassword.statusCode, 200, 'the claim code alone must not authenticate');
    assert.equal(wrongPassword.cookies.length, 0, 'no session may be minted without the password');
    assert.equal(state.orders[0].buyer_id, BUYER_ID, 'the binding must not move');

    // Correct orderNo + correct claim code, attacker's OWN email + a strong
    // password they control. This is the exact escalation attempt: it allocates
    // a group the attacker owns, and the CAS bind must refuse it.
    const attacker = createResponse();
    await handlers.accessUpgrade(postReq('/api/shop/guest/access/upgrade', upgradeBody({
        email: 'attacker@example.com', password: 'At7#tackEr9'
    })), attacker);
    assert.equal(attacker.statusCode, 409);
    assert.equal(attacker.payload.code, 'guest_order_already_bound');
    assert.equal(attacker.cookies.length, 0, 'the attacker must not receive the victim group session');
    assert.equal(state.orders[0].buyer_id, BUYER_ID, 'the order still belongs to the original group');
    assert.equal(outcomesOf(state).includes('upgrade_success'), false, 'no success may be audited for a refused bind');

    // The real owner, with the real password, still gets in.
    const owner = createResponse();
    await handlers.accessUpgrade(postReq('/api/shop/guest/access/upgrade', upgradeBody()), owner);
    assert.equal(owner.statusCode, 200);
    assert.equal(owner.payload.already_bound, true);
    assert.ok(sessionToken(owner).startsWith('v2.'));
});

test('A3: upgrade takes the site from the ORDER, never from the body', async () => {
    const { handlers, state } = createHarness({ state: { orders: [makeLegacyOrderRow()] } });
    const res = createResponse();
    await handlers.accessUpgrade(postReq('/api/shop/guest/access/upgrade', upgradeBody({
        email: 'brand.new@example.com', password: NEW_PASSWORD, site: 'intl'
    })), res);
    assert.equal(res.statusCode, 200);
    // A body-supplied site must not be able to mint a credential group in a site
    // the order was never placed in: the group key is (site, contact_hash).
    assert.equal(state.buyers.length, 2);
    assert.equal(state.buyers[1].site, 'cn', 'the new group inherits the ORDER site');
    assert.equal(state.orders[0].buyer_id, state.buyers[1].id);
});

test('A3: an upgrade for an unknown order number collapses to the claim 403', async () => {
    const { handlers, state } = createHarness({ state: { orders: [makeLegacyOrderRow()] } });
    const res = createResponse();
    await handlers.accessUpgrade(postReq('/api/shop/guest/access/upgrade', upgradeBody({
        orderNo: 'GS99999999-000000'
    })), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.code, 'guest_claim_invalid');
    assert.equal(res.cookies.length, 0);
    assert.equal(state.orders[0].buyer_id, null);
});

test('A3: a locked group answers 423 on the upgrade path too, before any allocation', async () => {
    const lockedUntil = new Date(Date.now() + 600000).toISOString();
    const { handlers, state } = createHarness({
        state: {
            buyers: [makeBuyerRow({ locked_until: lockedUntil, login_lock_stage: 2 })],
            orders: [makeLegacyOrderRow()]
        }
    });
    const res = createResponse();
    await handlers.accessUpgrade(postReq('/api/shop/guest/access/upgrade', upgradeBody()), res);
    assert.equal(res.statusCode, 423);
    assert.equal(res.payload.code, 'guest_order_locked');
    assert.equal(res.cookies.length, 0);
    assert.equal(state.orders[0].buyer_id, null);
    assert.equal(state.buyers.length, 1);
});
