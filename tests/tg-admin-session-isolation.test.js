'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(require.resolve('../js/admin-access.js'), 'utf8');
const USER = { id: 'tg-admin', email: 'admin@example.test' };

function fixture(options = {}) {
    let now = Date.now();
    let storageReads = 0;
    const sessions = new Map();
    const timers = new Map();
    const calls = [];
    const ownSession = { access_token: 'tg-own-token', refresh_token: 'tg-own-refresh', user: USER };
    const client = { auth: {
        ...(options.storageKey ? { storageKey: options.storageKey } : {}),
        async getUser() { return options.noUser ? { data: { user: null }, error: new Error('unavailable') } : { data: { user: USER } }; },
        async getSession() { return { data: { session: options.session === false ? null : ownSession } }; },
        async setSession(payload) { calls.push({ type: 'restore', payload }); return { data: { session: ownSession } }; }
    }, async rpc() { calls.push({ type: 'rpc' }); return options.rpcError ? { error: new Error('unavailable') } : { data: { is_super_admin: true } }; } };
    const foreignToken = `header.${Buffer.from(JSON.stringify({ sub: 'shop-admin', email: 'shop@example.test', exp: Math.floor(now / 1000) + 3600 })).toString('base64url')}.signature`;
    const window = {
        supabaseClient: client,
        localStorage: {
            get length() { storageReads++; return 1; },
            key() { storageReads++; return 'sb-shop-auth-token'; },
            getItem() { storageReads++; return JSON.stringify({ access_token: foreignToken, refresh_token: 'shop-refresh', user: { id: 'shop-admin' } }); }
        },
        sessionStorage: { getItem: (key) => sessions.get(key) || null, setItem: (key, value) => sessions.set(key, value), removeItem: (key) => sessions.delete(key) },
        atob: (value) => Buffer.from(value, 'base64').toString('binary'),
        setTimeout(callback, delay) { const handle = { unref() {} }; timers.set(handle, { callback, delay }); return handle; },
        clearTimeout: (handle) => timers.delete(handle)
    };
    const fetch = async (url, init) => {
        calls.push({ type: 'fetch', url, init });
        return { ok: true, status: 200, json: async () => ({ success: true, expiresInSeconds: 600 }) };
    };
    class TestDate extends Date { static now() { return now; } }
    vm.runInNewContext(script, { window, fetch, URL, Date: TestDate, console: { warn() {} } });
    return { api: window.AdminAccess, window, client, calls, timers, sessions, storageReads: () => storageReads, advance: (ms) => { now += ms; } };
}

test('TG strict access lookup never imports storefront identity when the SDK has no user', async () => {
    const f = fixture({ noUser: true });
    const access = await f.api.getCurrentAdminAccess({ supabaseClient: f.client, allowPersistedSessionFallback: false, forceRefresh: true });
    assert.equal(access.user, null);
    assert.equal(access.isSuperAdmin, false);
    assert.equal(f.storageReads(), 0);
    assert.equal(f.calls.length, 0);
});

test('TG strict permission failures never fall back to storefront REST credentials', async () => {
    const f = fixture({ rpcError: true });
    const access = await f.api.getCurrentAdminAccess({ supabaseClient: f.client, allowPersistedSessionFallback: false, forceRefresh: true });
    assert.equal(access.user.id, USER.id);
    assert.equal(access.isSuperAdmin, false);
    assert.match(access.error.message, /unavailable/);
    assert.equal(f.storageReads(), 0);
    assert.deepEqual(f.calls.map((call) => call.type), ['rpc']);
});

test('TG strict host-session issuance refuses missing SDK credentials without restoring storefront refresh tokens', async () => {
    const f = fixture({ session: false });
    const result = await f.api.createAdminStudioSession({ supabaseClient: f.client, userId: USER.id, allowPersistedSessionFallback: false, forceRefresh: true });
    assert.equal(result.status, 401);
    assert.equal(f.storageReads(), 0);
    assert.equal(f.calls.length, 0);
});

test('TG storage key independently disables storefront fallback for shared renewal entry points', async () => {
    const f = fixture({ noUser: true, session: false, storageKey: 'tg-admin-auth-v1' });
    assert.equal((await f.api.getCurrentAdminAccess({ forceRefresh: true })).user, null);
    assert.equal((await f.api.createAdminStudioSession({ userId: USER.id, forceRefresh: true })).status, 401);
    assert.equal(f.storageReads(), 0);
    assert.equal(f.calls.length, 0);
});

test('TG successful issuance renews with its original client and strict isolation after global client changes', async () => {
    const f = fixture();
    assert.equal((await f.api.createAdminStudioSession({ supabaseClient: f.client, userId: USER.id, allowPersistedSessionFallback: false, forceRefresh: true })).ok, true);
    f.window.supabaseClient = { auth: { async getSession() { throw new Error('storefront client must not be used'); } } };
    f.client.auth.getSession = async () => ({ data: { session: null } });
    const result = await f.api.renewAdminStudioSession({ userId: USER.id, force: true });
    assert.equal(result.status, 401);
    assert.equal(f.storageReads(), 0);
    assert.deepEqual(f.calls.map((call) => call.type), ['fetch']);
    assert.equal(f.calls[0].init.headers.Authorization, 'Bearer tg-own-token');
    assert.notEqual(f.sessions.get('zaoyoe_admin_studio_session_cache_v1'), undefined);
    assert.ok([...f.timers.values()].some((timer) => timer.delay === 60000), 'retry must remain scheduled');
});

test('TG renewal timer retains strict isolation when its Supabase session expires', async () => {
    const f = fixture();
    await f.api.createAdminStudioSession({ supabaseClient: f.client, userId: USER.id, allowPersistedSessionFallback: false, forceRefresh: true });
    const timer = [...f.timers.values()].find((entry) => entry.delay === 450000);
    assert.ok(timer);
    f.client.auth.getSession = async () => ({ data: { session: null } });
    f.advance(450001);
    timer.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.storageReads(), 0);
    assert.deepEqual(f.calls.map((call) => call.type), ['fetch']);
    assert.ok([...f.timers.values()].some((entry) => entry.delay === 60000));
});

test('TG cached host-session reuse retains strict options for subsequent renewal', async () => {
    const f = fixture();
    f.sessions.set('zaoyoe_admin_studio_session_cache_v1', JSON.stringify({ userId: USER.id, issuedAt: Date.now(), expiresAt: Date.now() + 600000 }));
    const cached = await f.api.createAdminStudioSession({ supabaseClient: f.client, userId: USER.id, allowPersistedSessionFallback: false });
    assert.equal(cached.cached, true);
    f.client.auth.getSession = async () => ({ data: { session: null } });
    assert.equal((await f.api.renewAdminStudioSession({ force: true })).status, 401);
    assert.equal(f.storageReads(), 0);
    assert.equal(f.calls.length, 0);
});

test('storefront default identity fallback remains available without the TG option', async () => {
    const f = fixture({ noUser: true });
    const access = await f.api.getCurrentAdminAccess({ forceRefresh: true });
    assert.equal(access.user.id, 'shop-admin');
    assert.equal(access.isSuperAdmin, true);
    assert.ok(f.storageReads() > 0);
});
