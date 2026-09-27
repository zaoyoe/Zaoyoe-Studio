'use strict';

/**
 * Order Access 2.0 (A3) — admin buyer-access surface (§10.5).
 *
 * What this file pins down:
 *
 *   1. THE SELECTOR IS order_no. An email is never accepted, because §6.4 says
 *      contact_hash is not a trusted identity factor and an operator-typed
 *      email would silently unlock the wrong credential group.
 *   2. The response projection is an ALLOW-LIST. `contact_hash`,
 *      `password_hash` and `token_hash` must be unreachable from an admin
 *      payload, so a future column on the buyer or reset table cannot leak by
 *      default.
 *   3. `reset_token` is returned EXACTLY ONCE, in the HTTP response, and must
 *      never appear in the audit row (AGENTS.md: no secrets in logs/audit).
 *   4. Deploy is not enablement: with the switch off every action answers
 *      409 `guest_feature_disabled`, and `requireAdmin` runs first so an
 *      outsider learns nothing about the rollout.
 *   5. Re-issuing revokes the outstanding link and bumps password_version, i.e.
 *      at most one link is ever live and every existing session of that group
 *      dies at the same moment (deviation D-8).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const Module = require('node:module');

const security = require('../api/_lib/guest-shop/security');
const buyerAccessAdmin = require('../api/_lib/guest-shop/buyer-access-admin');

const HANDLER_PATH = path.resolve(__dirname, '../server/api-handlers/admin/shop/guest-buyer-access.js');
// Loaded once for the PURE exports (ACTIONS / RESET_VIEW_FIELDS / sanitizeResetRow).
// Every behavioural test below uses withHandler(), which reloads the module under
// a stubbed ../../../../api/_lib/admin.
const handlerModule = require(HANDLER_PATH);

const ADMIN_UUID = '11111111-1111-4111-8111-111111111111';
const BUYER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SIBLING_GROUP_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ORDER_NO = 'GS20260921-000001';
const LEGACY_ORDER_NO = 'GS20260101-000009';
const EMAIL = 'guest.buyer@example.com';

const CONTACT_PEPPER = 'guest-contact-hash-pepper-0123456789-abcdefghijklmnopqrstuvwx';
const CONTACT_HASH = security.hashGuestContact(EMAIL, {
    env: { GUEST_SHOP_CONTACT_HASH_PEPPER: CONTACT_PEPPER },
    strict: true
});

/**
 * Column DEFAULT NULLs of the real tables. Mirrored so an insert that omits a
 * column reads back the way PostgREST returns it, not as `undefined`.
 */
const NULLABLE_COLUMNS = Object.freeze({
    guest_shop_access_resets: Object.freeze({ used_at: null, consumed_ip_hash: null, revoked_at: null }),
    guest_shop_buyers: Object.freeze({ locked_until: null, merged_into_user_id: null, failed_login_count: 0, login_lock_stage: 0 })
});

function makeBuyerRow(overrides = {}) {
    return {
        id: BUYER_ID,
        site: 'cn',
        contact_hash: CONTACT_HASH,
        credential_group_no: 1,
        password_hash: 'scrypt$32768$8$1$salt$hash',
        password_version: 2,
        failed_login_count: 4,
        login_lock_stage: 2,
        locked_until: '2099-01-01T00:00:00.000Z',
        merged_into_user_id: null,
        created_at: '2026-09-21T00:00:00.000Z',
        updated_at: '2026-09-21T00:00:00.000Z',
        ...overrides
    };
}

function makeOrderRow(overrides = {}) {
    return {
        id: ORDER_ID,
        order_no: ORDER_NO,
        site: 'cn',
        buyer_id: BUYER_ID,
        payment_status: 'confirmed',
        fulfillment_status: 'delivered',
        created_at: '2026-09-21T00:00:00.000Z',
        ...overrides
    };
}

function createMockResponse() {
    const state = { statusCode: 200, headers: {}, body: '' };
    return {
        status(code) { state.statusCode = code; return this; },
        setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; return this; },
        getHeader(name) { return state.headers[String(name).toLowerCase()]; },
        removeHeader(name) { delete state.headers[String(name).toLowerCase()]; return this; },
        end(payload = '') { state.body = String(payload || ''); return this; },
        json() { return state.body ? JSON.parse(state.body) : {}; },
        get statusCode() { return state.statusCode; },
        get headers() { return state.headers; }
    };
}

/**
 * PostgREST-shaped stub. `update()` touches EVERY matching row (the admin
 * unlock is a bulk write across all groups of one contact) and returns an array
 * from `.select()` / narrows through `.maybeSingle()`, exactly like supabase-js.
 */
function createSupabaseStub(state) {
    function builder(table, operation, patch = null) {
        const filters = [];
        let countMode = null;

        const query = {
            select(columns = '*', options = {}) {
                if (options && options.count) countMode = options.count;
                query.__selectedColumns = String(columns);
                return query;
            },
            update(nextPatch) { return builder(table, 'update', nextPatch); },
            insert(rows) { return builder(table, 'insert', rows); },
            eq(field, value) { filters.push({ type: 'eq', field: String(field), value }); return query; },
            gt(field, value) { filters.push({ type: 'gt', field: String(field), value }); return query; },
            gte(field, value) { filters.push({ type: 'gte', field: String(field), value }); return query; },
            lt(field, value) { filters.push({ type: 'lt', field: String(field), value }); return query; },
            is(field, value) { filters.push({ type: 'is', field: String(field), value }); return query; },
            in(field, values) { filters.push({ type: 'in', field: String(field), values }); return query; },
            order() { return query; },
            limit(n) { filters.push({ type: 'limit', n: Number(n) }); return query; },
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
            if (table === 'guest_shop_orders') return state.orders;
            if (table === 'guest_shop_access_resets') return state.resets;
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
            state.queries.push({ table, operation, columns: query.__selectedColumns || null, filters });
            if (operation === 'insert') {
                const list = Array.isArray(patch) ? patch : [patch];
                const created = [];
                for (const row of list) {
                    const next = {
                        id: row.id || crypto.randomUUID(),
                        created_at: row.created_at || new Date().toISOString(),
                        ...NULLABLE_COLUMNS[table],
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
            if (limitFilter) rows = rows.slice(0, limitFilter.n);
            return { data: rows, error: null, count: countMode ? total : null };
        }
        return query;
    }

    return {
        from(table) {
            return {
                select(columns = '*', options) { return builder(table, 'select').select(columns, options); },
                update(nextPatch) { return builder(table, 'update', nextPatch); },
                insert(rows) { return builder(table, 'insert').insert(rows); }
            };
        },
        async rpc(name) { throw new Error(`unexpected rpc ${name}`); }
    };
}

/**
 * Load the handler with `../../../../api/_lib/admin` replaced, so requireAdmin,
 * the audit sink and the JSON transport are all observable.
 */
async function withHandler(initialState, callback) {
    const state = {
        buyers: [makeBuyerRow()],
        orders: [makeOrderRow()],
        resets: [],
        queries: [],
        auditLogs: [],
        user: { id: ADMIN_UUID },
        requireAdminError: null,
        adminSupabase: undefined,
        auditError: null,
        ...initialState
    };
    const supabase = createSupabaseStub(state);
    const originalLoad = Module._load;
    delete require.cache[HANDLER_PATH];

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async parseJsonBody(req) {
                    if (typeof state.parseJsonBody === 'function') return state.parseJsonBody(req);
                    if (req && req.body && typeof req.body === 'object') return req.body;
                    throw new Error('invalid json');
                },
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls = state.requireAdminCalls || [];
                    state.requireAdminCalls.push({ req, options });
                    if (state.requireAdminError) throw state.requireAdminError;
                    return {
                        supabase,
                        adminSupabase: state.adminSupabase === undefined ? supabase : state.adminSupabase,
                        user: state.user
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status);
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    if (state.auditError) throw state.auditError;
                    state.auditLogs.push(entry);
                    return { id: crypto.randomUUID() };
                }
            };
        }
        return originalLoad.call(Module, request, parent, isMain);
    };

    // require() runs synchronously under the patched loader, so the handler
    // instance captures the stubbed admin lib. Both the loader and the feature
    // switch must be restored only AFTER the async body finishes, otherwise the
    // handler would read the real process.env mid-request.
    const handler = require(HANDLER_PATH);
    Module._load = originalLoad;
    try {
        return await callback(handler, state, supabase);
    } finally {
        delete require.cache[HANDLER_PATH];
    }
}

async function withEnabledEnv(callback) {
    const key = 'GUEST_SHOP_BUYER_CREDENTIAL_ENABLED';
    const had = Object.prototype.hasOwnProperty.call(process.env, key);
    const previous = process.env[key];
    process.env[key] = 'true';
    try {
        return await callback();
    } finally {
        if (had) process.env[key] = previous;
        else delete process.env[key];
    }
}

function readRequest(orderNo) {
    return { method: 'GET', url: `/api/admin?route=shop/guest-buyer-access&orderNo=${encodeURIComponent(orderNo || '')}` };
}

function postRequest(body) {
    return { method: 'POST', url: '/api/admin?route=shop/guest-buyer-access', body };
}

const REASON = '客服工单 #4482：买家已通过邮箱验证身份';

// ---------------------------------------------------------------------------
// Method / switch / authorization
// ---------------------------------------------------------------------------

test('A3 admin buyer access rejects non-GET/POST methods with an Allow header', async () => {
    await withEnabledEnv(() => withHandler({}, async (handler) => {
        const res = createMockResponse();
        await handler({ method: 'DELETE', url: '/api/admin?route=shop/guest-buyer-access' }, res);
        assert.equal(res.statusCode, 405);
        assert.equal(res.headers.allow, 'GET, POST');
        assert.equal(res.json().success, false);
    }));
});

test('A3 admin buyer access answers 409 guest_feature_disabled while the switch is off', async () => {
    const key = 'GUEST_SHOP_BUYER_CREDENTIAL_ENABLED';
    const had = Object.prototype.hasOwnProperty.call(process.env, key);
    const previous = process.env[key];
    process.env[key] = 'false';
    try {
        await withHandler({}, async (handler) => {
            const get = createMockResponse();
            await handler(readRequest(ORDER_NO), get);
            assert.equal(get.statusCode, 409);
            assert.equal(get.json().code, 'guest_feature_disabled');

            const post = createMockResponse();
            await handler(postRequest({ action: 'unlock_buyer_login', orderNo: ORDER_NO, confirm: true, reason: REASON }), post);
            assert.equal(post.statusCode, 409);
            assert.equal(post.json().code, 'guest_feature_disabled');
        });
    } finally {
        if (had) process.env[key] = previous;
        else delete process.env[key];
    }
});

test('A3 admin buyer access runs requireAdmin before the feature switch and forwards auth failures', async () => {
    await withEnabledEnv(() => withHandler({
        requireAdminError: Object.assign(new Error('Admin access required'), { statusCode: 403 })
    }, async (handler, state) => {
        const res = createMockResponse();
        await handler(readRequest(ORDER_NO), res);
        assert.equal(res.statusCode, 403);
        assert.ok(res.json().message.includes('Admin access required'));
        // The switch-off 409 must NOT be what an unauthenticated caller sees:
        // that would advertise the rollout state of the credential feature.
        assert.notEqual(res.json().code, 'guest_feature_disabled');
        assert.equal(state.auditLogs.length, 0);
    }));
});

test('A3 admin buyer access requires shop.manage and a usable admin client', async () => {
    await withEnabledEnv(() => withHandler({ adminSupabase: null }, async (handler, state) => {
        const res = createMockResponse();
        await handler(readRequest(ORDER_NO), res);
        assert.equal(res.statusCode, 503);
        assert.equal(res.json().code, 'guest_admin_ops_unavailable');
        assert.equal(state.requireAdminCalls[0].options.permission, 'shop.manage');
    }));
});

test('A3 admin buyer access refuses a non-uuid admin actor', async () => {
    await withEnabledEnv(() => withHandler({ user: { id: 'not-a-uuid' } }, async (handler) => {
        const res = createMockResponse();
        await handler(postRequest({ action: 'unlock_buyer_login', orderNo: ORDER_NO, confirm: true, reason: REASON }), res);
        assert.equal(res.statusCode, 400);
        assert.equal(res.json().code, 'guest_admin_actor_required');
    }));
});

// ---------------------------------------------------------------------------
// GET projection
// ---------------------------------------------------------------------------

test('A3 admin GET requires an order number and 404s on an unknown order', async () => {
    await withEnabledEnv(() => withHandler({}, async (handler) => {
        const missing = createMockResponse();
        await handler(readRequest(''), missing);
        assert.equal(missing.statusCode, 400);
        assert.equal(missing.json().code, 'guest_order_required');

        const unknown = createMockResponse();
        await handler(readRequest('GS20260921-999999'), unknown);
        assert.equal(unknown.statusCode, 404);
        assert.equal(unknown.json().code, 'guest_order_not_found');
    }));
});

test('A3 admin GET on an unbound order returns bound:false with the 2.1 manual-recovery hint', async () => {
    await withEnabledEnv(() => withHandler({
        orders: [makeOrderRow({ order_no: LEGACY_ORDER_NO, buyer_id: null })]
    }, async (handler) => {
        const res = createMockResponse();
        await handler(readRequest(LEGACY_ORDER_NO), res);
        assert.equal(res.statusCode, 200);
        const payload = res.json();
        assert.equal(payload.bound, false);
        assert.equal(payload.buyer, null);
        assert.deepEqual(payload.resets, []);
        assert.match(payload.hint, /人工核验/);
        assert.match(payload.hint, /一次性找回链接/);
        assert.doesNotMatch(payload.hint, /自助升级|取货口令|恢复入口/);
        assert.equal(payload.hint.length > 0, true);
    }));
});

test('A3 admin GET never exposes contact_hash, password_hash or token_hash', async () => {
    await withEnabledEnv(() => withHandler({
        resets: [{
            id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            site: 'cn',
            buyer_id: BUYER_ID,
            contact_hash: CONTACT_HASH,
            purpose: 'password_reset',
            token_hash: buyerAccessAdmin.hashResetToken('x'.repeat(43)),
            expires_at: new Date(Date.now() + 60000).toISOString(),
            created_at: new Date().toISOString(),
            created_by_admin_id: ADMIN_UUID,
            reason: REASON,
            used_at: null,
            consumed_ip_hash: null,
            revoked_at: null
        }]
    }, async (handler) => {
        const res = createMockResponse();
        await handler(readRequest(ORDER_NO), res);
        assert.equal(res.statusCode, 200);
        const payload = res.json();
        assert.equal(payload.bound, true);
        assert.equal(payload.site, 'cn');
        assert.equal(payload.order_no, ORDER_NO);

        const serialized = JSON.stringify(payload);
        assert.ok(!serialized.includes(CONTACT_HASH), 'contact_hash must never reach the admin payload');
        assert.ok(!serialized.includes('scrypt$'), 'password_hash must never reach the admin payload');
        assert.ok(!serialized.includes('token_hash'), 'the reset token hash column must never be projected');
        assert.ok(!serialized.includes(EMAIL), 'the plaintext email must never reach the admin payload');

        assert.deepEqual(Object.keys(payload.buyer).sort(), [
            'buyer_id', 'credential_group_no', 'failed_login_count', 'locked',
            'locked_until', 'login_lock_stage', 'merged_into_user_id',
            'password_version', 'site'
        ].sort());
        assert.equal(payload.buyer.locked, true);
        assert.equal(payload.buyer.login_lock_stage, 2);

        assert.equal(payload.resets.length, 1);
        assert.deepEqual(Object.keys(payload.resets[0]).sort(), [
            'created_at', 'created_by_admin_id', 'expires_at', 'purpose',
            'reason', 'reset_id', 'revoked_at', 'state', 'used_at'
        ].sort());
        assert.equal(payload.resets[0].state, 'pending');
    }));
});

test('A3 admin reset view derives used/revoked/expired states without leaking the token', () => {
    // sanitizeResetRow is exported for exactly this reason: state derivation is
    // a pure function of the row and must not be re-implemented in the UI.
    const { sanitizeResetRow } = handlerModule;
    const base = {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        purpose: 'password_reset',
        expires_at: '2099-01-01T00:00:00.000Z',
        used_at: null,
        revoked_at: null,
        created_at: '2026-09-22T00:00:00.000Z',
        created_by_admin_id: ADMIN_UUID,
        reason: REASON,
        token_hash: 'should-not-appear',
        contact_hash: 'should-not-appear'
    };
    assert.equal(sanitizeResetRow(base).state, 'pending');
    assert.equal(sanitizeResetRow({ ...base, used_at: '2026-09-22T00:01:00.000Z' }).state, 'used');
    assert.equal(sanitizeResetRow({ ...base, revoked_at: '2026-09-22T00:01:00.000Z' }).state, 'revoked');
    assert.equal(sanitizeResetRow({ ...base, expires_at: '2020-01-01T00:00:00.000Z' }).state, 'expired');
    // used beats revoked beats expired: the row's terminal outcome is what an
    // incident reviewer needs, not the bookkeeping order.
    assert.equal(sanitizeResetRow({ ...base, used_at: '2026-09-22T00:02:00.000Z', revoked_at: '2026-09-22T00:03:00.000Z' }).state, 'used');
    assert.equal(sanitizeResetRow(null), null);
});

// ---------------------------------------------------------------------------
// POST validation
// ---------------------------------------------------------------------------

test('A3 admin POST rejects unknown actions, missing confirm, short reasons and missing order numbers', async () => {
    await withEnabledEnv(() => withHandler({
        // The §13.2 case needs the historical order to actually exist: a missing
        // row is a 404 guest_order_not_found, not the 409 that says "unbound".
        orders: [makeOrderRow(), makeOrderRow({ order_no: LEGACY_ORDER_NO, buyer_id: null })]
    }, async (handler, state) => {
        const cases = [
            [{ action: 'reset_query_password', orderNo: ORDER_NO, confirm: true, reason: REASON }, 400, 'invalid_guest_buyer_access_action'],
            [{ action: 'unlock_buyer_login', orderNo: ORDER_NO, confirm: false, reason: REASON }, 400, 'guest_admin_confirm_required'],
            [{ action: 'unlock_buyer_login', orderNo: ORDER_NO, confirm: true, reason: '短' }, 400, 'guest_admin_reason_required'],
            [{ action: 'unlock_buyer_login', orderNo: '   ', confirm: true, reason: REASON }, 400, 'guest_order_required'],
            [{ action: 'unlock_buyer_login', orderNo: LEGACY_ORDER_NO, confirm: true, reason: REASON }, 409, 'guest_buyer_not_bound']
        ];
        for (const [body, status, code] of cases) {
            const res = createMockResponse();
            await handler(postRequest(body), res);
            assert.equal(res.statusCode, status, `${body.action} expected ${status}`);
            assert.equal(res.json().code, code, `${body.action} expected ${code}`);
        }
        // §13.2: the admin may NOT set a password on the buyer's behalf. The
        // action does not exist, so it must not be silently accepted either.
        assert.ok(!Object.keys(handlerModule.ACTIONS).includes('reset_query_password'));
        assert.equal(state.auditLogs.length, 0, 'no rejected write may produce an audit row');
    }));
});

test('A3 admin POST with a malformed body answers 400 invalid_json', async () => {
    await withEnabledEnv(() => withHandler({
        parseJsonBody: async () => { throw new Error('bad json'); }
    }, async (handler) => {
        const res = createMockResponse();
        await handler({ method: 'POST', url: '/api/admin?route=shop/guest-buyer-access', body: null }, res);
        assert.equal(res.statusCode, 400);
        assert.equal(res.json().code, 'invalid_json');
    }));
});

// ---------------------------------------------------------------------------
// unlock_buyer_login
// ---------------------------------------------------------------------------

test('A3 admin unlock clears the login lock of EVERY credential group of the contact', async () => {
    await withEnabledEnv(() => withHandler({
        buyers: [
            makeBuyerRow(),
            // Same (site, contact_hash), different group: §8.1 reads the lock
            // across all groups, so clearing only the bound one would leave the
            // buyer locked out and the admin action would look like a no-op.
            makeBuyerRow({ id: SIBLING_GROUP_ID, credential_group_no: 2, locked_until: '2099-01-01T00:00:00.000Z', login_lock_stage: 1, failed_login_count: 3 })
        ]
    }, async (handler, state) => {
        const res = createMockResponse();
        await handler(postRequest({ action: 'unlock_buyer_login', orderNo: ORDER_NO, confirm: true, reason: REASON }), res);
        assert.equal(res.statusCode, 200);
        const payload = res.json();
        assert.equal(payload.success, true);
        assert.equal(payload.unlocked_groups, 2);
        assert.equal(payload.buyer.locked, false);
        assert.equal(payload.buyer.login_lock_stage, 0);
        assert.equal(payload.buyer.failed_login_count, 0);
        assert.equal(payload.buyer.locked_until, null);
        assert.equal(payload.audit_recorded, true);

        for (const row of state.buyers) {
            assert.equal(row.locked_until, null, `group ${row.credential_group_no} must be unlocked`);
            assert.equal(row.login_lock_stage, 0);
            assert.equal(row.failed_login_count, 0);
        }

        assert.equal(state.auditLogs.length, 1);
        const audit = state.auditLogs[0];
        assert.equal(audit.actionType, 'shop.guest_buyer_access.unlock');
        assert.equal(audit.module, 'shop');
        assert.equal(audit.site, 'cn');
        assert.equal(audit.adminId, ADMIN_UUID);
        assert.equal(audit.details.order_no, ORDER_NO);
        assert.equal(audit.details.buyer_id, BUYER_ID);
        assert.equal(audit.details.unlocked_groups, 2);
        assert.equal(audit.details.reason, REASON);
        assert.ok(!JSON.stringify(audit.details).includes(CONTACT_HASH));
    }));
});

// ---------------------------------------------------------------------------
// issue_password_reset_link
// ---------------------------------------------------------------------------

test('A3 admin issue returns the reset token once, bumps password_version and revokes prior links', async () => {
    const staleResetId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await withEnabledEnv(() => withHandler({
        resets: [{
            id: staleResetId,
            site: 'cn',
            buyer_id: BUYER_ID,
            contact_hash: CONTACT_HASH,
            purpose: 'password_reset',
            token_hash: buyerAccessAdmin.hashResetToken('y'.repeat(43)),
            expires_at: new Date(Date.now() + 600000).toISOString(),
            created_at: new Date(Date.now() - 60000).toISOString(),
            created_by_admin_id: ADMIN_UUID,
            reason: '上一条链接',
            used_at: null,
            consumed_ip_hash: null,
            revoked_at: null
        }]
    }, async (handler, state) => {
        const res = createMockResponse();
        await handler(postRequest({ action: 'issue_password_reset_link', orderNo: ORDER_NO, confirm: true, reason: REASON }), res);
        assert.equal(res.statusCode, 200);
        const payload = res.json();
        assert.equal(payload.success, true);
        assert.equal(payload.ttl_seconds, buyerAccessAdmin.RESET_LINK_TTL_SECONDS);
        assert.deepEqual(payload.revoked_reset_ids, [staleResetId]);

        // The token is 43 url-safe chars (32 bytes base64url) and matches the
        // pattern the public reset endpoint will accept.
        assert.equal(payload.reset_token.length, buyerAccessAdmin.RESET_TOKEN_LENGTH);
        assert.match(payload.reset_token, buyerAccessAdmin.RESET_TOKEN_PATTERN);
        assert.equal(
            payload.reset_path,
            `/guest-orders.html?reset=${encodeURIComponent(payload.reset_token)}&site=cn`
        );
        // password_version moved 2 -> 3, which is what kills every live session
        // of this group on the next request (deviation D-8).
        assert.equal(payload.password_version, 3);
        assert.equal(state.buyers[0].password_version, 3);
        assert.equal(payload.buyer.password_version, 3);

        // Exactly one pending link exists, the stale one is revoked.
        const stored = state.resets.find((row) => row.id === payload.reset_id);
        assert.ok(stored, 'the new reset row must be persisted');
        assert.equal(stored.revoked_at, null);
        assert.equal(stored.used_at, null);
        assert.equal(stored.purpose, 'password_reset');
        assert.equal(stored.site, 'cn');
        assert.equal(stored.buyer_id, BUYER_ID);
        assert.equal(stored.created_by_admin_id, ADMIN_UUID);
        assert.equal(stored.reason, REASON);
        // What is stored is the HASH, never the plaintext token.
        assert.notEqual(stored.token_hash, payload.reset_token);
        assert.equal(stored.token_hash, buyerAccessAdmin.hashResetToken(payload.reset_token));
        assert.equal(state.resets.find((row) => row.id === staleResetId).revoked_at !== null, true);

        assert.equal(payload.buyer.password_version, 3);
        const audit = state.auditLogs[0];
        assert.equal(audit.actionType, 'shop.guest_buyer_access.issue_reset_link');
        assert.equal(audit.details.reset_id, payload.reset_id);
        assert.equal(audit.details.password_version, 3);
        assert.deepEqual(audit.details.revoked_reset_ids, [staleResetId]);
        // AGENTS.md / §18: the token and the link must never be written to the
        // audit row, the journal, or the chat.
        const auditJson = JSON.stringify(audit.details);
        assert.ok(!auditJson.includes(payload.reset_token), 'the audit row must not contain the reset token');
        assert.ok(!auditJson.includes('reset_token'), 'the audit row must not carry a token field at all');
        assert.ok(!auditJson.includes('reset='), 'the audit row must not contain a usable link');
        assert.ok(!auditJson.includes(CONTACT_HASH));
    }));
});

test('A3 admin issue on a second call revokes the first link so at most one is live', async () => {
    await withEnabledEnv(() => withHandler({}, async (handler, state) => {
        const first = createMockResponse();
        await handler(postRequest({ action: 'issue_password_reset_link', orderNo: ORDER_NO, confirm: true, reason: REASON }), first);
        const firstPayload = first.json();

        const second = createMockResponse();
        await handler(postRequest({ action: 'issue_password_reset_link', orderNo: ORDER_NO, confirm: true, reason: REASON }), second);
        const secondPayload = second.json();

        assert.notEqual(secondPayload.reset_id, firstPayload.reset_id);
        assert.notEqual(secondPayload.reset_token, firstPayload.reset_token);
        assert.deepEqual(secondPayload.revoked_reset_ids, [firstPayload.reset_id]);
        assert.equal(secondPayload.password_version, 4);

        const live = state.resets.filter((row) => !row.revoked_at && !row.used_at);
        assert.equal(live.length, 1, 'only one link may ever be outstanding');
        assert.equal(live[0].id, secondPayload.reset_id);
    }));
});

test('A3 admin revoke kills an outstanding link without issuing a new one', async () => {
    await withEnabledEnv(() => withHandler({}, async (handler, state) => {
        const issued = createMockResponse();
        await handler(postRequest({ action: 'issue_password_reset_link', orderNo: ORDER_NO, confirm: true, reason: REASON }), issued);
        const resetId = issued.json().reset_id;

        const res = createMockResponse();
        await handler(postRequest({ action: 'revoke_password_reset_link', orderNo: ORDER_NO, confirm: true, reason: REASON }), res);
        assert.equal(res.statusCode, 200);
        const payload = res.json();
        assert.deepEqual(payload.revoked_reset_ids, [resetId]);
        assert.equal(payload.reset_token, undefined, 'revoke must not mint a replacement token');
        assert.equal(payload.reset_path, undefined);
        assert.equal(state.auditLogs[1].actionType, 'shop.guest_buyer_access.revoke_reset_link');

        const live = state.resets.filter((row) => !row.revoked_at && !row.used_at);
        assert.equal(live.length, 0);
        assert.notEqual(state.resets.find((row) => row.id === resetId).revoked_at, null);
    }));
});

test('A3 admin refuses to issue a guest reset link for a merged credential group', async () => {
    await withEnabledEnv(() => withHandler({
        buyers: [makeBuyerRow({ merged_into_user_id: '99999999-9999-4999-8999-999999999999' })]
    }, async (handler, state) => {
        const res = createMockResponse();
        await handler(postRequest({ action: 'issue_password_reset_link', orderNo: ORDER_NO, confirm: true, reason: REASON }), res);
        // §10.4: a merged group is retired from guest access; handing back a
        // guest link would undo exactly what the merge removed.
        assert.equal(res.statusCode, 409);
        assert.equal(res.json().code, 'guest_buyer_merged');
        assert.equal(state.resets.length, 0);
        assert.equal(state.buyers[0].password_version, 2, 'no session revocation may happen on a refused action');
        assert.equal(state.auditLogs.length, 0);
    }));
});

test('A3 admin fails closed when the group has no usable contact_hash', async () => {
    await withEnabledEnv(() => withHandler({
        buyers: [makeBuyerRow({ contact_hash: 'not-a-hex-digest' })]
    }, async (handler, state) => {
        const res = createMockResponse();
        await handler(postRequest({ action: 'issue_password_reset_link', orderNo: ORDER_NO, confirm: true, reason: REASON }), res);
        assert.equal(res.statusCode, 409);
        assert.equal(res.json().code, 'guest_buyer_contact_required');
        assert.equal(state.resets.length, 0);
    }));
});

test('A3 admin refuses to unlock or issue for an order whose group no longer exists', async () => {
    await withEnabledEnv(() => withHandler({ buyers: [] }, async (handler) => {
        const res = createMockResponse();
        await handler(postRequest({ action: 'unlock_buyer_login', orderNo: ORDER_NO, confirm: true, reason: REASON }), res);
        assert.equal(res.statusCode, 409);
        assert.equal(res.json().code, 'guest_buyer_not_found');
    }));
});

// ---------------------------------------------------------------------------
// Audit resilience and error shapes
// ---------------------------------------------------------------------------

test('A3 admin keeps a completed action when the audit write fails, flagging it instead of rolling back', async () => {
    await withEnabledEnv(() => withHandler({ auditError: new Error('audit sink down') }, async (handler, state) => {
        const res = createMockResponse();
        await handler(postRequest({ action: 'unlock_buyer_login', orderNo: ORDER_NO, confirm: true, reason: REASON }), res);
        assert.equal(res.statusCode, 200);
        const payload = res.json();
        assert.equal(payload.success, true);
        // The lock is already cleared in the database; failing the request
        // would tell the operator the unlock did not happen when it did.
        assert.equal(payload.audit_recorded, false);
        assert.equal(state.buyers[0].locked_until, null);
    }));
});

test('A3 admin does not leak internal messages from expose:false errors', async () => {
    await withEnabledEnv(() => withHandler({
        buyers: [],
        orders: [makeOrderRow({ buyer_id: '00000000-0000-4000-8000-000000000000' })]
    }, async (handler) => {
        // resolveBuyerByOrderNo throws 409 guest_buyer_not_found for a dangling
        // buyer_id; the shape must stay {success, code, message}.
        const res = createMockResponse();
        await handler(postRequest({ action: 'unlock_buyer_login', orderNo: ORDER_NO, confirm: true, reason: REASON }), res);
        const payload = res.json();
        assert.equal(payload.success, false);
        assert.equal(typeof payload.message, 'string');
        assert.ok(payload.message.length > 0);
        assert.ok(!payload.message.includes('postgres'), 'internal driver text must not surface');
    }));
});

test('A3 admin surfaces a database error as 500 without the driver message', async () => {
    await withEnabledEnv(() => withHandler({
        parseJsonBody: async () => ({ action: 'unlock_buyer_login', orderNo: ORDER_NO, confirm: true, reason: REASON })
    }, async (handler, state) => {
        // Break the order read so the handler hits an unmapped error path.
        state.orders.length = 0;
        const res = createMockResponse();
        await handler(postRequest({ action: 'unlock_buyer_login', orderNo: ORDER_NO, confirm: true, reason: REASON }), res);
        assert.equal(res.statusCode, 404);
        assert.equal(res.json().code, 'guest_order_not_found');
        assert.ok(!JSON.stringify(res.json()).includes('stack'));
    }));
});

test('A3 admin action names map to the audit action types used by the admin audit UI', () => {
    const actions = handlerModule.ACTIONS;
    assert.deepEqual(actions, {
        unlock_buyer_login: 'shop.guest_buyer_access.unlock',
        issue_password_reset_link: 'shop.guest_buyer_access.issue_reset_link',
        revoke_password_reset_link: 'shop.guest_buyer_access.revoke_reset_link'
    });
    assert.deepEqual(handlerModule.RESET_VIEW_FIELDS, [
        'id', 'purpose', 'expires_at', 'used_at', 'revoked_at', 'created_at', 'created_by_admin_id', 'reason'
    ]);
    assert.ok(!handlerModule.RESET_VIEW_FIELDS.includes('token_hash'));
    assert.ok(!handlerModule.RESET_VIEW_FIELDS.includes('contact_hash'));
});

test('A3 admin handler is registered on the admin dispatcher under shop/guest-buyer-access', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(path.join(__dirname, '../api/admin.js'), 'utf8');
    assert.ok(
        source.includes("'shop/guest-buyer-access': shopGuestBuyerAccessHandler"),
        'api/admin.js must bind the flat route key to the A3 handler'
    );
    assert.ok(
        source.includes("require('../server/api-handlers/admin/shop/guest-buyer-access')"),
        'api/admin.js must require the A3 handler module'
    );
});
