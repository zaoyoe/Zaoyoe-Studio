'use strict';

/**
 * Order Access 2.0 (A1b) unit + contract tests for the guest buyer-credential
 * ORDER path:
 *   api/_lib/guest-shop/buyer-credentials.js
 *   supabase/migrations/20260921_guest_shop_buyer_group_upsert.sql
 *   supabase/migrations/20260921_verify_guest_shop_buyer_group_upsert.sql
 *
 * Contract: docs/guest-shop-order-access-2.0.md
 *   §6.4.2 the upsert rules (reuse / recycle / allocate / cap-conflict)
 *   §6.4.5 access control by buyer_id, promotion quota by contact_hash
 *   §8.1   double-dimension lockout; the lock check runs BEFORE any scrypt
 *   §8.4   equal-cost responses — a below-cap "matched" order must be
 *          timing-indistinguishable from a "not matched" one, otherwise the
 *          order endpoint is a password oracle (see the equal-cost test)
 *   §9.1   error semantics; the 409 credential_conflict is the ONE accepted leak
 *   §10.1  registered_user_match is record-only, never a pricing/quota input
 *
 * A1b is the ORDER path only. The login/query path (A2) reuses these primitives
 * but is delivered separately, so nothing here depends on a wired handler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MODULE_PATH = path.join(REPO_ROOT, 'api/_lib/guest-shop/buyer-credentials.js');
const UPSERT_MIGRATION = path.join(REPO_ROOT, 'supabase/migrations/20260921_guest_shop_buyer_group_upsert.sql');
const UPSERT_VERIFY = path.join(REPO_ROOT, 'supabase/migrations/20260921_verify_guest_shop_buyer_group_upsert.sql');

const security = require('../api/_lib/guest-shop/security');
const { stripSqlComments } = require('../scripts/guest-shop-readiness');
const buyer = require('../api/_lib/guest-shop/buyer-credentials');

const { GuestShopSecurityError } = security;

const SITE = 'cn';
const CONTACT_HASH = 'ab'.repeat(32);   // 64-hex quota key (§6.4.5)
const IP_HASH = 'cd'.repeat(32);
const DEVICE_HASH = 'ef'.repeat(32);
const PASS_MATCH = 'Ab3!xY9#';           // canonical valid sample (§16.1)
const PASS_OTHER = 'Tr7#Other2qK';       // a different valid password
const NOW = new Date('2026-09-21T00:00:00.000Z');

// Full-parameter hashes verify with needsRehash === false; the WEAK hash uses
// N=16384 (the policy floor) so a successful verify reports needsRehash true and
// exercises the §6.2 transparent-upgrade path.
const STRONG_MATCH = security.hashGuestQueryPassword(PASS_MATCH);
const STRONG_OTHER = security.hashGuestQueryPassword(PASS_OTHER);
const WEAK_MATCH = security.hashGuestQueryPassword(PASS_MATCH, { params: { N: 16384 } });

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

let rowSeq = 0;
function makeRow(overrides = {}) {
    rowSeq += 1;
    return {
        id: `buyer-row-${rowSeq}`,
        site: SITE,
        contact_hash: CONTACT_HASH,
        credential_group_no: 1,
        password_hash: STRONG_OTHER,
        password_version: 1,
        failed_login_count: 0,
        login_lock_stage: 0,
        locked_until: null,
        created_at: NOW.toISOString(),
        ...overrides
    };
}

function settings(overrides = {}) {
    return {
        passwordMinLength: 8,
        groupCap: 3,
        loginMaxFailures: 5,
        loginWindowSeconds: 600,
        ipMaxFailures: 20,
        recycleCooldownSeconds: 600,
        ...overrides
    };
}

/**
 * Minimal in-memory Supabase double covering exactly the query shapes
 * buyer-credentials.js uses: chained select/eq/gte/in/limit, insert,
 * conditional update + select().maybeSingle() (the CAS loop), and rpc().
 */
function createFakeSupabase(config = {}) {
    const state = {
        buyers: (config.buyers || []).map(clone),
        attempts: (config.attempts || []).map(clone),
        rpcCalls: [],
        inserts: [],
        updates: [],
        selects: []
    };
    const rpcHandler = typeof config.rpc === 'function'
        ? config.rpc
        : () => ({ data: [{ buyer_id: 'rpc-buyer-id', credential_group_no: 1, allocation: 'reused' }], error: null });

    function rowsFor(table) {
        if (table === 'guest_shop_buyers') return state.buyers;
        if (table === 'guest_shop_access_attempts') return state.attempts;
        return [];
    }

    function makeBuilder(table, operation, payload) {
        const filters = [];
        let wantSingle = false;
        let limitN = null;

        function applyFilters(rows) {
            let out = rows.filter((row) => filters.every((f) => {
                if (f.type === 'eq') return row?.[f.field] === f.value;
                if (f.type === 'gte') return row?.[f.field] >= f.value;
                if (f.type === 'in') return f.values.includes(row?.[f.field]);
                return true;
            }));
            if (limitN != null) out = out.slice(0, limitN);
            return out;
        }

        async function execute() {
            await new Promise((resolve) => setImmediate(resolve));
            if (operation === 'insert') {
                state.inserts.push({ table, row: clone(payload) });
                if (config.insertError) return { data: null, error: config.insertError };
                state.attempts.push(clone(payload));
                return { data: clone(payload), error: null };
            }
            if (operation === 'update') {
                const matched = applyFilters(rowsFor(table));
                state.updates.push({ table, patch: clone(payload), matched: matched.length });
                if (config.updateError) return { data: null, error: config.updateError };
                const row = matched[0];
                if (!row) return { data: null, error: null };   // CAS miss
                Object.assign(row, clone(payload));
                return { data: clone(row), error: null };
            }
            if (config.selectError && (config.selectErrorTables || []).includes(table)) {
                return { data: null, error: config.selectError };
            }
            const matched = applyFilters(rowsFor(table));
            state.selects.push({ table, limitN, filters: filters.map((f) => ({ ...f })) });
            if (wantSingle) return { data: matched[0] ? clone(matched[0]) : null, error: null };
            return { data: clone(matched), error: null };
        }

        const builder = {
            select() { return builder; },
            eq(field, value) { filters.push({ type: 'eq', field: String(field), value }); return builder; },
            gte(field, value) { filters.push({ type: 'gte', field: String(field), value }); return builder; },
            in(field, values) { filters.push({ type: 'in', field: String(field), values: Array.isArray(values) ? values.slice() : [] }); return builder; },
            limit(n) { limitN = Number(n) || null; return builder; },
            maybeSingle() { wantSingle = true; return execute(); },
            single() { wantSingle = true; return execute(); },
            then(resolve, reject) { return execute().then(resolve, reject); }
        };
        return builder;
    }

    return {
        state,
        from(table) {
            return {
                select() { return makeBuilder(table, 'select', null); },
                update(patch) { return makeBuilder(table, 'update', patch); },
                insert(row) { return makeBuilder(table, 'insert', row); }
            };
        },
        async rpc(name, args) {
            state.rpcCalls.push({ name, args: clone(args) });
            return rpcHandler(name, clone(args), state.rpcCalls.length);
        }
    };
}

/** Run an async fn with crypto.scryptSync counted, capturing value or error. */
async function countScrypt(fn) {
    const real = crypto.scryptSync;
    let count = 0;
    crypto.scryptSync = function patched(...args) { count += 1; return real.apply(crypto, args); };
    try {
        return { value: await fn(), count, error: null };
    } catch (error) {
        return { value: null, count, error };
    } finally {
        crypto.scryptSync = real;
    }
}

function assertGuestError(error, { statusCode, code, expose }) {
    assert.ok(
        error instanceof GuestShopSecurityError,
        `expected GuestShopSecurityError, got ${error && error.name}: ${error && error.message}`
    );
    if (statusCode != null) assert.equal(error.statusCode, statusCode);
    if (code != null) assert.equal(error.code, code);
    if (expose != null) assert.equal(error.expose, expose);
}

function resolveOrder(supabase, overrides = {}) {
    return buyer.resolveBuyerGroupForOrder({
        supabase,
        site: SITE,
        email: 'alice@example.com',
        password: PASS_MATCH,
        contactHash: CONTACT_HASH,
        ipHash: IP_HASH,
        deviceHash: DEVICE_HASH,
        settings: settings(),
        now: NOW,
        ...overrides
    });
}

function fakeSecurity(verifyImpl) {
    const calls = { verify: [], dummy: 0 };
    return {
        calls,
        parseGuestQueryPasswordHash(hash) { return hash === 'MALFORMED' ? { ok: false } : { ok: true }; },
        verifyGuestQueryPassword(password, hash) { calls.verify.push(hash); return verifyImpl(password, hash); },
        runDummyGuestQueryPasswordVerification() { calls.dummy += 1; return { ok: false }; }
    };
}

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => (/^\s*\/\//.test(line) ? '' : line))
        .join('\n');
}

// ---------------------------------------------------------------------------
// §15.1 master switch parsing — fail closed, "off" === today's behaviour
// ---------------------------------------------------------------------------

test('parseBuyerCredentialSwitch fails closed on garbage and treats absent as disabled', () => {
    assert.deepEqual(buyer.parseBuyerCredentialSwitch({}), { present: false, valid: true, enabled: false });
    for (const truthy of ['1', 'true', 'TRUE', 'yes', 'Y', 'on', 'Enabled']) {
        const parsed = buyer.parseBuyerCredentialSwitch({ GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: truthy });
        assert.equal(parsed.enabled, true, `${truthy} should enable`);
        assert.equal(parsed.valid, true);
        assert.equal(parsed.present, true);
    }
    for (const falsy of ['0', 'false', 'NO', 'n', 'off', 'disabled']) {
        const parsed = buyer.parseBuyerCredentialSwitch({ GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: falsy });
        assert.equal(parsed.enabled, false, `${falsy} should disable`);
        assert.equal(parsed.valid, true);
    }
    for (const garbage of ['maybe', '2', 'truthy', 'enable-me']) {
        const parsed = buyer.parseBuyerCredentialSwitch({ GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: garbage });
        assert.equal(parsed.valid, false, `${garbage} must be invalid`);
        assert.equal(parsed.enabled, false, `${garbage} must fail closed to disabled`);
        assert.equal(parsed.present, true);
    }
    assert.equal(buyer.isBuyerCredentialEnabled({ GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true' }), true);
    assert.equal(buyer.isBuyerCredentialEnabled({ GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'maybe' }), false);
    assert.equal(buyer.isBuyerCredentialEnabled({}), false);

    assert.deepEqual(buyer.parseGuestOrdersPageSwitch({}), { present: false, valid: true, enabled: false });
    assert.equal(buyer.isGuestOrdersPageEnabled({ GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED: 'true' }), true);
    assert.equal(buyer.isGuestOrdersPageEnabled({ GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED: 'no' }), false);
    assert.deepEqual(
        buyer.parseGuestOrdersPageSwitch({ GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED: 'maybe' }),
        { present: true, valid: false, enabled: false }
    );
});

test('resolveBuyerCredentialSettings applies defaults, clamps the cap and rejects invalid numbers', () => {
    const defaults = buyer.resolveBuyerCredentialSettings({});
    assert.equal(defaults.passwordMinLength, 8);
    assert.equal(defaults.groupCap, 3);
    assert.equal(defaults.loginMaxFailures, 5);
    assert.equal(defaults.loginWindowSeconds, 600);
    assert.equal(defaults.ipMaxFailures, 20);
    assert.equal(defaults.recycleCooldownSeconds, buyer.GUEST_BUYER_GROUP_RECYCLE_COOLDOWN_SECONDS);

    // The application cap can never exceed the DB CHECK bound (group_range 1..5).
    assert.equal(buyer.BUYER_GROUP_DB_MAX, 5);
    assert.equal(buyer.resolveBuyerCredentialSettings({ GUEST_SHOP_BUYER_CREDENTIAL_GROUP_CAP: '5' }).groupCap, 5);
    assert.equal(buyer.resolveBuyerCredentialSettings({ GUEST_SHOP_BUYER_CREDENTIAL_GROUP_CAP: '1' }).groupCap, 1);

    // Out-of-range / malformed values are operator errors -> 503, never a silent default.
    for (const env of [
        { GUEST_SHOP_BUYER_CREDENTIAL_GROUP_CAP: '99' },
        { GUEST_SHOP_BUYER_CREDENTIAL_GROUP_CAP: '0' },
        { GUEST_SHOP_BUYER_PASSWORD_MIN_LENGTH: '8.5' },
        { GUEST_SHOP_BUYER_LOGIN_MAX_FAILURES: 'abc' }
    ]) {
        assert.throws(() => buyer.resolveBuyerCredentialSettings(env), (err) => {
            assertGuestError(err, { statusCode: 503, code: 'guest_shop_misconfigured', expose: false });
            return true;
        });
    }
});

test('forbiddenPasswordTokens always carries the site tokens and never weakens on a bad base URL', () => {
    const base = buyer.forbiddenPasswordTokens({});
    for (const token of buyer.SITE_FORBIDDEN_PASSWORD_TOKENS) assert.ok(base.includes(token));
    const withUrl = buyer.forbiddenPasswordTokens({ APP_BASE_URL: 'https://shop.example.com/path' });
    assert.ok(withUrl.includes('shop.example.com'));
    const malformed = buyer.forbiddenPasswordTokens({ APP_BASE_URL: 'not a url', SITE_BASE_URL: '::::' });
    for (const token of buyer.SITE_FORBIDDEN_PASSWORD_TOKENS) assert.ok(malformed.includes(token));
});

test('assertBuyerQueryPasswordStrength returns the normalized value and throws guest_password_weak', () => {
    assert.equal(buyer.assertBuyerQueryPasswordStrength(PASS_MATCH, { env: {} }), PASS_MATCH);
    assert.throws(() => buyer.assertBuyerQueryPasswordStrength('abcd123!', { env: {} }), (err) => {
        assertGuestError(err, { statusCode: 400, code: 'guest_password_weak' });
        assert.equal(err.field, 'orderPassword');
        return true;
    });
});

// ---------------------------------------------------------------------------
// loadBuyerGroups / findActiveBuyerLock
// ---------------------------------------------------------------------------

test('loadBuyerGroups reads password_version, sorts ascending and drops malformed rows', async () => {
    const supabase = createFakeSupabase({
        buyers: [
            makeRow({ id: 'g2', credential_group_no: 2, password_version: 3 }),
            makeRow({ id: 'g1', credential_group_no: 1, password_version: 1 }),
            makeRow({ id: '', credential_group_no: 3 }),                 // no id -> dropped
            makeRow({ id: 'g0', credential_group_no: 0 }),               // group < 1 -> dropped
            makeRow({ id: 'gx', credential_group_no: 'NaN-ish' })        // non-integer -> dropped
        ]
    });
    const rows = await buyer.loadBuyerGroups({ supabase, site: SITE, contactHash: CONTACT_HASH });
    assert.deepEqual(rows.map((r) => r.groupNo), [1, 2]);
    // Regression: password_version must be selected, or §6.2 transparent upgrade
    // silently pins every upgraded row to version 2.
    const g2 = rows.find((r) => r.groupNo === 2);
    assert.equal(g2.passwordVersion, 3);
    assert.equal(g2.id, 'g2');
});

test('loadBuyerGroups fails closed without a table handle or contact hash and rethrows driver errors', async () => {
    const driverError = new Error('driver boom');
    await assert.rejects(
        buyer.loadBuyerGroups({ supabase: {}, site: SITE, contactHash: CONTACT_HASH }),
        (err) => { assertGuestError(err, { statusCode: 503, expose: false }); return true; }
    );
    await assert.rejects(
        buyer.loadBuyerGroups({ supabase: createFakeSupabase({}), site: SITE, contactHash: '' }),
        (err) => { assertGuestError(err, { statusCode: 503, expose: false }); return true; }
    );
    const failing = createFakeSupabase({ selectError: driverError, selectErrorTables: ['guest_shop_buyers'], buyers: [] });
    await assert.rejects(
        buyer.loadBuyerGroups({ supabase: failing, site: SITE, contactHash: CONTACT_HASH }),
        (err) => err === driverError
    );
});

test('findActiveBuyerLock locks the whole contact when any group is locked, ignoring expired locks', () => {
    const future = new Date(NOW.getTime() + 60_000);
    const past = new Date(NOW.getTime() - 60_000);
    const lockedRow = { id: 'g2', groupNo: 2, lockedUntil: future };
    assert.equal(buyer.findActiveBuyerLock([{ id: 'g1', lockedUntil: null }, lockedRow], NOW), lockedRow);
    assert.equal(buyer.findActiveBuyerLock([{ id: 'g1', lockedUntil: past }], NOW), null);
    assert.equal(buyer.findActiveBuyerLock([{ id: 'g1', lockedUntil: null }], NOW), null);
    assert.equal(buyer.findActiveBuyerLock([], NOW), null);
});

// ---------------------------------------------------------------------------
// §8.4 verifyBuyerPasswordAcrossGroups — equal cost, no early exit
// ---------------------------------------------------------------------------

test('verifyBuyerPasswordAcrossGroups never early-exits and burns one dummy on an empty contact', () => {
    const sec = fakeSecurity((password, hash) => (hash === 'H1' ? { ok: true, needsRehash: false } : { ok: false }));
    const rows = [{ id: 'g1', groupNo: 1, passwordHash: 'H1' }, { id: 'g2', groupNo: 2, passwordHash: 'H2' }];
    const result = buyer.verifyBuyerPasswordAcrossGroups(PASS_MATCH, rows, sec);
    assert.equal(sec.calls.verify.length, 2, 'both rows must be verified even after a match (no timing early-exit)');
    assert.equal(result.matched.groupNo, 1);
    assert.equal(result.needsRehash, false);

    const emptySec = fakeSecurity(() => ({ ok: false }));
    const empty = buyer.verifyBuyerPasswordAcrossGroups(PASS_MATCH, [], emptySec);
    assert.equal(emptySec.calls.dummy, 1, 'an unknown email must still run exactly one scrypt');
    assert.equal(empty.matched, null);
});

test('verifyBuyerPasswordAcrossGroups treats a malformed hash as a dummy burn, not a fast path', () => {
    const sec = fakeSecurity(() => ({ ok: true }));
    const rows = [{ id: 'g1', groupNo: 1, passwordHash: 'MALFORMED' }];
    const result = buyer.verifyBuyerPasswordAcrossGroups(PASS_MATCH, rows, sec);
    assert.equal(sec.calls.dummy, 1);
    assert.equal(sec.calls.verify.length, 0, 'a dirty row must not reach the real verifier');
    assert.equal(result.matched, null);
});

test('verifyBuyerPasswordAcrossGroups reports needsRehash only on a successful match', () => {
    const rehashSec = fakeSecurity(() => ({ ok: true, needsRehash: true }));
    const matched = buyer.verifyBuyerPasswordAcrossGroups(PASS_MATCH, [{ id: 'g1', groupNo: 1, passwordHash: 'H1' }], rehashSec);
    assert.equal(matched.needsRehash, true);

    const noMatchSec = fakeSecurity(() => ({ ok: false, needsRehash: true }));
    const unmatched = buyer.verifyBuyerPasswordAcrossGroups(PASS_MATCH, [{ id: 'g1', groupNo: 1, passwordHash: 'H1' }], noMatchSec);
    assert.equal(unmatched.matched, null);
    assert.equal(unmatched.needsRehash, false, 'needsRehash must be gated on a real match');
});

// ---------------------------------------------------------------------------
// audit + IP budget
// ---------------------------------------------------------------------------

test('recordBuyerAccessAttempt validates outcome, requires an ip hash, slices hashes and swallows errors', async () => {
    const supabase = createFakeSupabase({});
    assert.equal(await buyer.recordBuyerAccessAttempt({ supabase, site: SITE, contactHash: CONTACT_HASH, ipHash: IP_HASH, outcome: 'not_a_real_outcome' }), false);
    assert.equal(supabase.state.inserts.length, 0);

    assert.equal(await buyer.recordBuyerAccessAttempt({ supabase, site: SITE, contactHash: CONTACT_HASH, ipHash: null, outcome: 'locked' }), false);
    assert.equal(supabase.state.inserts.length, 0);

    assert.equal(await buyer.recordBuyerAccessAttempt({ supabase: {}, site: SITE, ipHash: IP_HASH, outcome: 'locked' }), false);

    const longIp = 'z'.repeat(200);
    const ok = await buyer.recordBuyerAccessAttempt({ supabase, site: SITE, contactHash: CONTACT_HASH, buyerId: 'g1', ipHash: longIp, deviceHash: DEVICE_HASH, outcome: 'credential_conflict' });
    assert.equal(ok, true);
    assert.equal(supabase.state.inserts.length, 1);
    const inserted = supabase.state.inserts[0].row;
    assert.equal(inserted.outcome, 'credential_conflict');
    assert.equal(inserted.request_ip_hash.length, 128);
    assert.equal(inserted.buyer_id, 'g1');

    const failing = createFakeSupabase({ insertError: new Error('audit down') });
    assert.equal(await buyer.recordBuyerAccessAttempt({ supabase: failing, site: SITE, ipHash: IP_HASH, outcome: 'locked' }), false, 'an audit outage must not throw on the buyer path');
});

test('countRecentIpFailures fails closed and shares one budget between order and login paths', async () => {
    assert.equal(await buyer.countRecentIpFailures({ supabase: createFakeSupabase({}), ipHash: null, windowSeconds: 600, budget: 20 }), 0);
    assert.equal(await buyer.countRecentIpFailures({ supabase: {}, ipHash: IP_HASH, windowSeconds: 600, budget: 20 }), Number.MAX_SAFE_INTEGER);

    const recent = new Date().toISOString();
    const supabase = createFakeSupabase({
        attempts: [
            { id: 1, request_ip_hash: IP_HASH, outcome: 'bad_password', created_at: recent },
            { id: 2, request_ip_hash: IP_HASH, outcome: 'credential_conflict', created_at: recent },
            { id: 3, request_ip_hash: IP_HASH, outcome: 'success', created_at: recent },          // not a failure
            { id: 4, request_ip_hash: 'other'.repeat(16), outcome: 'bad_password', created_at: recent } // other ip
        ]
    });
    const count = await buyer.countRecentIpFailures({ supabase, ipHash: IP_HASH, windowSeconds: 600, budget: 20 });
    assert.equal(count, 2);
    const select = supabase.state.selects.find((s) => s.table === 'guest_shop_access_attempts');
    assert.equal(select.limitN, 20);
    const inFilter = select.filters.find((f) => f.type === 'in' && f.field === 'outcome');
    assert.deepEqual(inFilter.values, [...buyer.BUYER_ACCESS_FAILURE_OUTCOMES]);

    const failing = createFakeSupabase({ selectError: new Error('down'), selectErrorTables: ['guest_shop_access_attempts'] });
    assert.equal(await buyer.countRecentIpFailures({ supabase: failing, ipHash: IP_HASH, windowSeconds: 600, budget: 20 }), Number.MAX_SAFE_INTEGER);
});

// ---------------------------------------------------------------------------
// §8.1 lock ladder + CAS counter
// ---------------------------------------------------------------------------

test('registerBuyerLoginFailure increments below the threshold and locks on reaching it', async () => {
    const supabase = createFakeSupabase({ buyers: [makeRow({ id: 'g1', credential_group_no: 1, failed_login_count: 0 })] });
    const rows = [{ id: 'g1', groupNo: 1, failedLoginCount: 0, loginLockStage: 0, lockedUntil: null }];
    const inc = await buyer.registerBuyerLoginFailure({ supabase, site: SITE, contactHash: CONTACT_HASH, rows, settings: settings(), now: NOW });
    assert.deepEqual(inc, { locked: false, stage: 0 });
    assert.equal(supabase.state.buyers[0].failed_login_count, 1);
    assert.equal(supabase.state.buyers[0].locked_until, null, 'a below-threshold increment arms no lock');

    const lockSupabase = createFakeSupabase({ buyers: [makeRow({ id: 'g1', failed_login_count: 4, login_lock_stage: 0 })] });
    const lockRows = [{ id: 'g1', groupNo: 1, failedLoginCount: 4, loginLockStage: 0, lockedUntil: null }];
    const locked = await buyer.registerBuyerLoginFailure({ supabase: lockSupabase, site: SITE, contactHash: CONTACT_HASH, rows: lockRows, settings: settings(), now: NOW });
    assert.deepEqual(locked, { locked: true, stage: 1 });
    assert.equal(lockSupabase.state.buyers[0].failed_login_count, 0, 'counter resets when a lock is armed');
    assert.equal(lockSupabase.state.buyers[0].login_lock_stage, 1);
    assert.equal(lockSupabase.state.buyers[0].locked_until, new Date(NOW.getTime() + 15 * 60_000).toISOString());
});

test('registerBuyerLoginFailure follows the 15/30/1440 ladder and caps the stage at 3', async () => {
    assert.deepEqual([...buyer.BUYER_LOCK_STAGE_MINUTES], [15, 30, 1440]);
    assert.equal(buyer.BUYER_LOCK_MAX_STAGE, 3);
    for (const [startStage, expectedStage, minutes] of [[0, 1, 15], [1, 2, 30], [2, 3, 1440], [3, 3, 1440]]) {
        const supabase = createFakeSupabase({ buyers: [makeRow({ id: 'g1', failed_login_count: 4, login_lock_stage: startStage })] });
        const rows = [{ id: 'g1', groupNo: 1, failedLoginCount: 4, loginLockStage: startStage, lockedUntil: null }];
        const result = await buyer.registerBuyerLoginFailure({ supabase, site: SITE, contactHash: CONTACT_HASH, rows, settings: settings(), now: NOW });
        assert.equal(result.stage, expectedStage, `stage from ${startStage}`);
        assert.equal(result.locked, true);
        assert.equal(supabase.state.buyers[0].locked_until, new Date(NOW.getTime() + minutes * 60_000).toISOString());
    }
});

test('registerBuyerLoginFailure retries on a CAS miss instead of losing the increment', async () => {
    // The stored row already advanced to 1 (a concurrent writer), but the caller
    // holds a stale snapshot at 0: the first conditional update misses, the loop
    // rereads, and the second update lands — no lost increment.
    const supabase = createFakeSupabase({ buyers: [makeRow({ id: 'g1', failed_login_count: 1, login_lock_stage: 0 })] });
    const staleRows = [{ id: 'g1', groupNo: 1, failedLoginCount: 0, loginLockStage: 0, lockedUntil: null }];
    const result = await buyer.registerBuyerLoginFailure({ supabase, site: SITE, contactHash: CONTACT_HASH, rows: staleRows, settings: settings(), now: NOW });
    assert.equal(result.locked, false);
    assert.equal(supabase.state.updates.length, 2, 'one miss + one successful retry');
    assert.equal(supabase.state.buyers[0].failed_login_count, 2);
});

test('registerBuyerLoginFailure is a no-op without a table handle or a target row', async () => {
    const noTable = await buyer.registerBuyerLoginFailure({ supabase: {}, site: SITE, contactHash: CONTACT_HASH, rows: [{ id: 'g1' }], settings: settings(), now: NOW });
    assert.equal(noTable.locked, false);
    const noRows = await buyer.registerBuyerLoginFailure({ supabase: createFakeSupabase({}), site: SITE, contactHash: CONTACT_HASH, rows: [], settings: settings(), now: NOW });
    assert.equal(noRows.locked, false);
});

test('rehashBuyerPasswordIfNeeded only writes a changed hash, guarded by the old hash', async () => {
    const supabase = createFakeSupabase({ buyers: [makeRow({ id: 'g1', password_hash: WEAK_MATCH, password_version: 1 })] });
    const row = { id: 'g1', passwordHash: WEAK_MATCH, passwordVersion: 1 };
    const ok = await buyer.rehashBuyerPasswordIfNeeded({ supabase, row, password: PASS_MATCH, security, now: NOW });
    assert.equal(ok, true);
    const patch = supabase.state.updates[0].patch;
    assert.equal(patch.password_version, 2);
    assert.notEqual(patch.password_hash, WEAK_MATCH);
    assert.equal(security.verifyGuestQueryPassword(PASS_MATCH, patch.password_hash).ok, true);

    // A mint that returns the same hash, or throws, must not write.
    const sameSec = { hashGuestQueryPassword: () => WEAK_MATCH };
    assert.equal(await buyer.rehashBuyerPasswordIfNeeded({ supabase: createFakeSupabase({}), row, password: PASS_MATCH, security: sameSec }), false);
    const throwSec = { hashGuestQueryPassword: () => { throw new Error('mint failed'); } };
    assert.equal(await buyer.rehashBuyerPasswordIfNeeded({ supabase: createFakeSupabase({}), row, password: PASS_MATCH, security: throwSec }), false);
    assert.equal(await buyer.rehashBuyerPasswordIfNeeded({ supabase: {}, row, password: PASS_MATCH, security }), false);
});

// ---------------------------------------------------------------------------
// resolveBuyerGroupForOrder — the order-path integration
// ---------------------------------------------------------------------------

test('order path: matched below cap reuses the group and never overwrites its password', async () => {
    const supabase = createFakeSupabase({
        buyers: [makeRow({ id: 'g1', credential_group_no: 1, password_hash: STRONG_MATCH })],
        rpc: (name, args) => ({ data: [{ buyer_id: 'g1', credential_group_no: args.p_matched_group_no, allocation: 'reused' }], error: null })
    });
    const { value, count, error } = await countScrypt(() => resolveOrder(supabase, { settings: settings({ groupCap: 3 }) }));
    assert.equal(error, null);
    assert.equal(value.allocation, 'reused');
    assert.equal(value.buyerId, 'g1');
    assert.equal(supabase.state.rpcCalls.length, 1);
    const args = supabase.state.rpcCalls[0].args;
    assert.equal(args.p_matched_group_no, 1);
    assert.equal(args.p_password_hash, null, 'reuse must never carry a password hash (N2)');
    assert.equal(args.p_registered_user_match, null, '§10.1 record-only, never computed on the public order path');
    assert.equal(args.p_group_cap, 3);
    assert.equal(count, 2, '1 verify + 1 equal-cost dummy');
    assert.equal(supabase.state.inserts.length, 0, 'a successful below-cap order records no failure');
});

test('order path: not matched below cap allocates a new group storing the submitted password', async () => {
    const supabase = createFakeSupabase({
        buyers: [makeRow({ id: 'g1', credential_group_no: 1, password_hash: STRONG_OTHER })],
        rpc: (name, args) => ({ data: [{ buyer_id: 'new-id', credential_group_no: 2, allocation: 'created' }], error: null })
    });
    const { value, count, error } = await countScrypt(() => resolveOrder(supabase, { settings: settings({ groupCap: 3 }) }));
    assert.equal(error, null);
    assert.equal(value.allocation, 'created');
    const args = supabase.state.rpcCalls[0].args;
    assert.equal(args.p_matched_group_no, null);
    assert.ok(args.p_password_hash, 'allocation must mint a hash');
    assert.equal(security.verifyGuestQueryPassword(PASS_MATCH, args.p_password_hash).ok, true);
    assert.equal(args.p_registered_user_match, null);
    assert.equal(count, 2, '1 verify + 1 mint');
});

test('§8.4 equal-cost: a below-cap match is timing-indistinguishable from a non-match', async () => {
    // This is the load-bearing anti-oracle assertion. Without the dummy burn on
    // the matched-no-rehash branch, "matched" finishes one scrypt (~50ms) earlier
    // than "not matched", letting an attacker verify guessed query passwords
    // against a victim email through the order endpoint — below the cap, where no
    // failure is recorded and no lock applies — and then read that buyer's card
    // secrets on the login path. Both branches must cost the same.
    const matchedSupabase = createFakeSupabase({
        buyers: [makeRow({ id: 'g1', credential_group_no: 1, password_hash: STRONG_MATCH })],
        rpc: () => ({ data: [{ buyer_id: 'g1', credential_group_no: 1, allocation: 'reused' }], error: null })
    });
    const unmatchedSupabase = createFakeSupabase({
        buyers: [makeRow({ id: 'g1', credential_group_no: 1, password_hash: STRONG_OTHER })],
        rpc: () => ({ data: [{ buyer_id: 'new', credential_group_no: 2, allocation: 'created' }], error: null })
    });
    const matched = await countScrypt(() => resolveOrder(matchedSupabase));
    const unmatched = await countScrypt(() => resolveOrder(unmatchedSupabase));
    assert.equal(matched.error, null);
    assert.equal(unmatched.error, null);
    assert.equal(matched.count, unmatched.count, 'matched and not-matched below cap must run an identical number of scrypt ops');
});

test('order path: a matched low-parameter row is transparently upgraded in the same rpc call', async () => {
    const supabase = createFakeSupabase({
        buyers: [makeRow({ id: 'g1', credential_group_no: 1, password_hash: WEAK_MATCH, password_version: 1 })],
        rpc: (name, args) => ({ data: [{ buyer_id: 'g1', credential_group_no: 1, allocation: 'reused' }], error: null })
    });
    const { value, count, error } = await countScrypt(() => resolveOrder(supabase));
    assert.equal(error, null);
    assert.equal(value.allocation, 'reused');
    const args = supabase.state.rpcCalls[0].args;
    assert.equal(args.p_matched_group_no, 1);
    assert.ok(args.p_password_hash, 'a needsRehash match rides the upgrade hash in the same rpc');
    const verified = security.verifyGuestQueryPassword(PASS_MATCH, args.p_password_hash);
    assert.equal(verified.ok, true);
    assert.equal(verified.needsRehash, false, 'the upgraded hash is at full parameters');
    assert.equal(count, 2, '1 verify + 1 mint (no extra dummy when an upgrade is owed)');
});

test('§8.1 order path: an active lock rejects with 423 before any scrypt', async () => {
    const supabase = createFakeSupabase({
        buyers: [makeRow({ id: 'g1', credential_group_no: 1, locked_until: new Date(NOW.getTime() + 60_000).toISOString() })]
    });
    const { error, count } = await countScrypt(() => resolveOrder(supabase));
    assertGuestError(error, { statusCode: 423, code: 'guest_order_locked' });
    assert.equal(count, 0, 'a locked contact must cost zero scrypt');
    assert.equal(supabase.state.rpcCalls.length, 0);
    assert.equal(supabase.state.inserts.length, 1);
    assert.equal(supabase.state.inserts[0].row.outcome, 'locked');
});

test('§8.1 order path: at cap and over the IP budget rejects with 429 before any scrypt', async () => {
    const recent = new Date().toISOString();
    const supabase = createFakeSupabase({
        buyers: [
            makeRow({ id: 'g1', credential_group_no: 1, password_hash: STRONG_OTHER }),
            makeRow({ id: 'g2', credential_group_no: 2, password_hash: STRONG_OTHER }),
            makeRow({ id: 'g3', credential_group_no: 3, password_hash: STRONG_OTHER })
        ],
        attempts: [
            { id: 1, request_ip_hash: IP_HASH, outcome: 'bad_password', created_at: recent },
            { id: 2, request_ip_hash: IP_HASH, outcome: 'credential_conflict', created_at: recent }
        ]
    });
    const { error, count } = await countScrypt(() => resolveOrder(supabase, { settings: settings({ groupCap: 3, ipMaxFailures: 2 }) }));
    assertGuestError(error, { statusCode: 429, code: 'guest_rate_limited' });
    assert.equal(count, 0);
    assert.equal(supabase.state.rpcCalls.length, 0);
    assert.equal(supabase.state.inserts.at(-1).row.outcome, 'rate_limited');
});

test('§6.4.2 rule 5 / §9.1: at cap and not matched is the one observable 409, paid into the lock budget', async () => {
    const supabase = createFakeSupabase({
        buyers: [
            makeRow({ id: 'g1', credential_group_no: 1, password_hash: STRONG_OTHER, failed_login_count: 0 }),
            makeRow({ id: 'g2', credential_group_no: 2, password_hash: STRONG_OTHER }),
            makeRow({ id: 'g3', credential_group_no: 3, password_hash: STRONG_OTHER })
        ]
    });
    const { error, count } = await countScrypt(() => resolveOrder(supabase, { settings: settings({ groupCap: 3 }) }));
    assertGuestError(error, { statusCode: 409, code: 'guest_buyer_credential_conflict' });
    assert.match(error.message, /3 套查询密码/);
    assert.equal(count, 3, 'the 409 path runs the verify (3 rows) but mints nothing');
    assert.equal(supabase.state.rpcCalls.length, 0, 'rejected before allocation');
    assert.equal(supabase.state.buyers.find((b) => b.id === 'g1').failed_login_count, 1, 'the observable branch pays into the shared failure budget');
    assert.equal(supabase.state.inserts.at(-1).row.outcome, 'credential_conflict');
});

test('§6.4.2 N1: at cap but matched still reuses the group (a returning buyer is never walled out)', async () => {
    const supabase = createFakeSupabase({
        buyers: [
            makeRow({ id: 'g1', credential_group_no: 1, password_hash: STRONG_OTHER }),
            makeRow({ id: 'g2', credential_group_no: 2, password_hash: STRONG_MATCH }),
            makeRow({ id: 'g3', credential_group_no: 3, password_hash: STRONG_OTHER })
        ],
        rpc: (name, args) => ({ data: [{ buyer_id: 'g2', credential_group_no: args.p_matched_group_no, allocation: 'reused' }], error: null })
    });
    const { value, error } = await countScrypt(() => resolveOrder(supabase, { settings: settings({ groupCap: 3 }) }));
    assert.equal(error, null);
    assert.equal(value.allocation, 'reused');
    assert.equal(supabase.state.rpcCalls[0].args.p_matched_group_no, 2);
    assert.equal(supabase.state.buyers.find((b) => b.id === 'g1').failed_login_count, 0, 'a match records no failure');
});

test('order path maps rpc credential_conflict to 409 and every misconfig token to a 503', async () => {
    const conflict = createFakeSupabase({
        buyers: [makeRow({ id: 'g1', password_hash: STRONG_OTHER })],
        rpc: () => ({ data: null, error: { message: 'duplicate key value violates guest_buyer_credential_conflict' } })
    });
    await assert.rejects(resolveOrder(conflict), (err) => { assertGuestError(err, { statusCode: 409, code: 'guest_buyer_credential_conflict' }); return true; });

    for (const token of buyer.BUYER_GROUP_SQL_MISCONFIG_TOKENS) {
        const supabase = createFakeSupabase({
            buyers: [makeRow({ id: 'g1', password_hash: STRONG_OTHER })],
            rpc: () => ({ data: null, error: { message: `rpc failed: ${token}` } })
        });
        await assert.rejects(resolveOrder(supabase), (err) => {
            assertGuestError(err, { statusCode: 503, code: 'guest_shop_misconfigured', expose: false });
            assert.equal(err.message.includes(token), false, 'a SQL token must never reach the buyer');
            return true;
        }, `token ${token} should map to 503`);
    }
});

test('order path rethrows an unknown rpc error and fails closed on an empty buyer_id', async () => {
    const sentinel = new Error('unexpected rpc failure');
    const supabase = createFakeSupabase({
        buyers: [makeRow({ id: 'g1', password_hash: STRONG_OTHER })],
        rpc: () => ({ data: null, error: sentinel })
    });
    await assert.rejects(resolveOrder(supabase), (err) => err === sentinel);

    const emptyId = createFakeSupabase({
        buyers: [makeRow({ id: 'g1', password_hash: STRONG_OTHER })],
        rpc: () => ({ data: [{ buyer_id: '   ', credential_group_no: 2, allocation: 'created' }], error: null })
    });
    await assert.rejects(resolveOrder(emptyId), (err) => { assertGuestError(err, { statusCode: 503, expose: false }); return true; });
});

test('§6.3 order path fails closed when the contact pepper is unavailable', async () => {
    const supabase = createFakeSupabase({ buyers: [] });
    await assert.rejects(
        buyer.resolveBuyerGroupForOrder({ supabase, site: SITE, email: 'alice@example.com', password: PASS_MATCH, ipHash: IP_HASH, settings: settings(), now: NOW }),
        (err) => { assertGuestError(err, { statusCode: 503, code: 'guest_shop_misconfigured', expose: false }); return true; }
    );
});

// ---------------------------------------------------------------------------
// migration + verify-script contract (read from disk; Codex never executes SQL)
// ---------------------------------------------------------------------------

test('A1b upsert migration is additive, serialised, insert-only and record-only on registered_user_match', () => {
    const migration = stripSqlComments(fs.readFileSync(UPSERT_MIGRATION, 'utf8'));

    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_guest_shop_upsert_buyer_group/u);
    assert.match(migration, /p_registered_user_match BOOLEAN DEFAULT NULL/u);
    assert.match(migration, /SECURITY DEFINER/u);
    assert.match(migration, /search_path = public, pg_temp/u);
    assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(/u);

    // The conflict target names the CONSTRAINT and is DO NOTHING; a column list
    // would be ambiguous against the RETURNS TABLE output variable, and DO UPDATE
    // would be exactly the N2 password-takeover the design forbids.
    assert.match(migration, /ON CONFLICT ON CONSTRAINT guest_shop_buyers_site_contact_group_uniq DO NOTHING/u);
    assert.doesNotMatch(migration, /ON CONFLICT[^;]*DO UPDATE/u);

    // Named, testable error tokens (mapped to 503/409 by the handler).
    for (const token of ['guest_buyer_site_invalid', 'guest_buyer_contact_required', 'guest_buyer_password_malformed', 'guest_buyer_password_required', 'guest_buyer_credential_conflict']) {
        assert.ok(migration.includes(`'${token}'`), `migration must raise ${token}`);
    }

    // registered_user_match is record-only: written via COALESCE, never a predicate.
    assert.match(migration, /registered_user_match = COALESCE\(p_registered_user_match/u);
    assert.match(migration, /COALESCE\(p_registered_user_match, false\)/u);
    assert.doesNotMatch(migration, /AND\s+[a-z_]*\.?registered_user_match/u);
    assert.doesNotMatch(migration, /registered_user_match\s*(=|<>|!=)\s*(true|false)/u);
    assert.doesNotMatch(migration, /CASE\s+WHEN[^;]*registered_user_match/u);

    // Privileges: service_role only.
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_guest_shop_upsert_buyer_group[\s\S]*FROM PUBLIC, anon, authenticated/u);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_guest_shop_upsert_buyer_group[\s\S]*TO service_role/u);

    // AGENTS.md: a deploy must never enable products, backfill orders or schedule jobs.
    assert.doesNotMatch(migration, /CREATE TABLE|ALTER TABLE|DROP TABLE/iu);
    assert.doesNotMatch(migration, /UPDATE\s+public\.guest_shop_orders/iu);
    assert.doesNotMatch(migration, /UPDATE\s+public\.shop_products/iu);
    assert.doesNotMatch(migration, /allow_guest_purchase\s*=\s*true/iu);
    assert.doesNotMatch(migration, /pg_cron|cron\.schedule/iu);
});

test('A1b verify script is read-only and asserts the six structural guarantees', () => {
    const verify = stripSqlComments(fs.readFileSync(UPSERT_VERIFY, 'utf8'));
    for (const check of ['upsert_fn_present_and_unique', 'upsert_fn_signature', 'upsert_fn_security_posture', 'upsert_fn_grants', 'upsert_fn_body_guarantees', 'a1b_is_additive']) {
        assert.ok(verify.includes(`'${check}'`), `verify must contain check ${check}`);
    }
    assert.match(verify, /insert_never_upserts/u);
    assert.match(verify, /registered_match_never_a_predicate/u);
    assert.match(verify, /advisory_lock_serialises_contact/u);
    // 2026-09-23 era-aware probe: the key used to pin the A0 13-parameter
    // create_order signature exactly. 20260923_guest_shop_promo_l1l2.sql
    // legitimately replaces it with 15 parameters, so the pinned probe would
    // report a FALSE FAIL against a correct database. The row now asserts
    // "a KNOWN create_order signature is installed"; the retired key must not
    // come back.
    assert.match(verify, /create_order_rpc_known_signature/u);
    assert.doesNotMatch(verify, /create_order_rpc_still_13_params/u);
    // Read-only: no leading write/DDL statement (string literals inside the body
    // checks are fine; this mirrors the readiness gate's prohibition regex).
    assert.doesNotMatch(verify, /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|CALL)\b/imu);
});

// ---------------------------------------------------------------------------
// isolation: the order path stays inside the guest-shop boundary
// ---------------------------------------------------------------------------

test('buyer-credentials.js never touches process.env, supabase-js or the account auth system', () => {
    const source = fs.readFileSync(MODULE_PATH, 'utf8');
    const code = stripComments(source);
    assert.doesNotMatch(code, /process\.env/u, 'settings must arrive via the explicit env argument, never implicitly');
    assert.doesNotMatch(source, /require\(['"]@supabase/u, 'the supabase handle is injected, never imported');
    assert.doesNotMatch(source, /createClient/u);
    assert.doesNotMatch(code, /access_token|Authorization|Bearer/iu, 'guest credential code must stay isolated from session auth');
    assert.doesNotMatch(code, /auth\.users/u, 'the order path must not look up registered accounts (anti-enumeration + anti-杀熟)');
    assert.match(source, /require\('\.\/security'\)/u);
    assert.match(source, /require\('\.\/runtime-config'\)/u);
});
