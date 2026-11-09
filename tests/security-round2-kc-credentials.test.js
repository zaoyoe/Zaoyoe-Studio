'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { sealCredential, openCredential } = require('../services/kc-pay-gpt/credential-security');
// Synthetic credentials only. No environment file or database is loaded.
const secret = 'JBSWY3DPEHPK3PXP';
const purpose = 'admin_totp_secret';
const keyA = Buffer.alloc(32, 17).toString('base64');
const keyB = Buffer.alloc(32, 29).toString('base64');
const env = { KC_CREDENTIAL_ACTIVE_KEY_ID: 'key-a', KC_CREDENTIAL_KEYRING_JSON: JSON.stringify({ 'key-a': keyA }) };
function withEnv(overrides, fn) {
    const original = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
    for (const k of Object.keys(env)) { if (overrides[k] === undefined) delete process.env[k]; else process.env[k] = overrides[k]; }
    return Promise.resolve().then(fn).finally(() => {
        for (const k of Object.keys(env)) { if (original[k] === undefined) delete process.env[k]; else process.env[k] = original[k]; }
    });
}
function storeFixture(initial = {}) {
    const values = new Map(Object.entries({ admin_password_version: '2', ...initial }));
    let snapshot, commits = 0, rollbacks = 0;
    const reads = [], writes = [];
    const executor = {
        async query(sql, params = []) {
            reads.push({ sql, params });
            assert.match(sql, /^SELECT .*FROM app_config/s);
            let keys = params;
            if (sql.includes("IN ('admin_password_version', 'admin_totp_pending')")) keys = ['admin_password_version', 'admin_totp_pending'];
            return [keys.filter(k => values.has(k)).map(k => ({ config_key: k, config_value: values.get(k) }))];
        },
        async execute(sql, params) {
            writes.push({ sql, params });
            if (sql.startsWith('INSERT INTO app_config')) {
                for (let i = 0; i < params.length; i += 2) values.set(params[i], params[i + 1]);
            } else if (sql.startsWith('DELETE FROM app_config')) values.delete(params[0]);
            else if (sql.startsWith('UPDATE app_config SET config_value = ?')) values.set(params[1], params[0]);
            else if (sql.startsWith("UPDATE app_config SET config_value = 'either'")) {
                if (values.get('admin_2fa_login_mode') === 'totp') values.set('admin_2fa_login_mode', 'either');
            } else throw new Error('unhandled fixture write');
            return [{ affectedRows: 1 }];
        },
        async beginTransaction() { snapshot = new Map(values); },
        async commit() { commits++; },
        async rollback() { rollbacks++; values.clear(); for (const [k, v] of snapshot) values.set(k, v); },
        release() {}
    };
    const filename = path.resolve(__dirname, '../services/kc-pay-gpt/mysql-store.js');
    const mod = new Module(filename, module);
    mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
    mod.require = request => request === 'mysql2/promise'
        ? { createPool: () => ({ ...executor, getConnection: async () => executor }) }
        : Module.prototype.require.call(mod, request);
    mod._compile(fs.readFileSync(filename, 'utf8'), filename);
    return { store: mod.exports, values, reads, writes, get commits() { return commits; }, get rollbacks() { return rollbacks; } };
}
function pending(overrides = {}) {
    return { secret, pendingId: 'fixture-pending', binding: 'fixture-binding', passwordVersion: 2, expiresAt: Date.now() + 60000, ...overrides };
}
test('KC credential encryption uses random IVs and authenticated round trips', () => {
    const first = sealCredential(secret, purpose, env), second = sealCredential(secret, purpose, env);
    assert.notEqual(first, second); assert.ok(!first.includes(secret));
    assert.match(first, /^kc-secret:v1:key-a:/);
    assert.equal(openCredential(first, purpose, env), secret);
    assert.equal(openCredential(second, purpose, env), secret);
});
for (const index of [3, 4, 5]) test(`KC credential rejects tampering with envelope field ${index}`, () => {
    const parts = sealCredential(secret, purpose, env).split(':');
    const bytes = Buffer.from(parts[index], 'base64url'); bytes[0] ^= 1; parts[index] = bytes.toString('base64url');
    assert.throws(() => openCredential(parts.join(':'), purpose, env), /decryption failed/);
});
test('KC credential rejects wrong purposes, keys, versions and damaged envelopes', () => {
    const envelope = sealCredential(secret, purpose, env);
    const wrongKey = { ...env, KC_CREDENTIAL_KEYRING_JSON: JSON.stringify({ 'key-a': keyB }) };
    for (const [value, p, e] of [
        [envelope, 'admin_totp_pending', env], [envelope, purpose, wrongKey], [envelope, purpose, {}],
        [envelope.replace('v1:', 'v9:'), purpose, env], [envelope.slice(0, -2), purpose, env],
        [envelope.replace('key-a:', 'unknown:'), purpose, env], [envelope + ':extra', purpose, env]
    ]) assert.throws(() => openCredential(value, p, e), /KC credential/);
});
test('KC credential key rotation reads retained keys and writes with the active key', () => {
    const old = sealCredential(secret, purpose, env);
    const rotated = { KC_CREDENTIAL_ACTIVE_KEY_ID: 'key-b', KC_CREDENTIAL_KEYRING_JSON: JSON.stringify({ 'key-a': keyA, 'key-b': keyB }) };
    assert.equal(openCredential(old, purpose, rotated), secret);
    const next = sealCredential(secret, purpose, rotated); assert.match(next, /^kc-secret:v1:key-b:/);
    assert.throws(() => openCredential(old, purpose, { ...rotated, KC_CREDENTIAL_KEYRING_JSON: JSON.stringify({ 'key-b': keyB }) }));
});
test('KC legacy read compatibility never enables unencrypted writes', () => {
    assert.equal(openCredential(secret, purpose, {}), secret);
    const json = JSON.stringify(pending()); assert.equal(openCredential(json, 'admin_totp_pending', {}), json);
    assert.equal(openCredential('', purpose, {}), ''); assert.equal(sealCredential('', purpose, {}), '');
    assert.throws(() => sealCredential(secret, purpose, {}));
    assert.throws(() => sealCredential(json, 'admin_totp_pending', {}));
    for (const value of ['not-a-totp-secret', 'kc-secret:broken', '{}']) assert.throws(() => openCredential(value, purpose, {}));
    assert.throws(() => openCredential('{"secret":"bad"}', 'admin_totp_pending', {}));
});
test('KC credential key parser rejects invalid key configuration', () => {
    for (const value of ['null', '[]', '{', JSON.stringify({ 'key-a': 'short' }), JSON.stringify({ 'key-a': Buffer.alloc(31).toString('base64') })]) {
        assert.throws(() => sealCredential(secret, purpose, { ...env, KC_CREDENTIAL_KEYRING_JSON: value }));
    }
    assert.throws(() => sealCredential(secret, 'unexpected-purpose', env));
});
test('KC real store reads old TOTP and permits unconfigured accounts without a key', () => withEnv({}, async () => {
    const f = storeFixture(); assert.equal((await f.store.getAdminAuthConfig()).totpSecret, '');
    f.values.set('admin_totp_secret', secret); assert.equal((await f.store.getAdminAuthConfig()).totpSecret, secret);
    await assert.rejects(f.store.saveAdminTotpConfig({ secret, enabled: true }));
    assert.equal(f.values.get('admin_totp_secret'), secret); assert.equal(f.rollbacks, 1);
    await assert.rejects(f.store.savePendingAdminTotp(pending()));
    assert.equal(f.values.has('admin_totp_pending'), false);
}));
test('KC real store encrypts active and pending values and decrypts only on reads', () => withEnv(env, async () => {
    const f = storeFixture(); await f.store.saveAdminTotpConfig({ secret, enabled: true });
    assert.match(f.values.get('admin_totp_secret'), /^kc-secret:v1:/);
    assert.equal(f.values.get('admin_totp_enabled'), '1'); assert.equal((await f.store.getAdminAuthConfig()).totpSecret, secret);
    const enrollment = pending(); await f.store.savePendingAdminTotp(enrollment);
    assert.match(f.values.get('admin_totp_pending'), /^kc-secret:v1:/);
    assert.ok(!f.values.get('admin_totp_pending').includes(secret));
    assert.deepEqual(await f.store.getPendingAdminTotp(), enrollment);
    assert.ok(f.reads.some(r => /FOR UPDATE/.test(r.sql)));
    assert.equal(f.commits, 2);
}));
test('KC real store promotes encrypted pending TOTP with a new purpose and revokes enrollment', () => withEnv(env, async () => {
    const f = storeFixture(); const enrollment = pending(); await f.store.savePendingAdminTotp(enrollment);
    const oldPending = f.values.get('admin_totp_pending'); await f.store.commitPendingAdminTotp(enrollment);
    const active = f.values.get('admin_totp_secret'); assert.notEqual(active, oldPending);
    assert.equal(openCredential(active, purpose, env), secret); assert.throws(() => openCredential(active, 'admin_totp_pending', env));
    assert.equal(f.values.get('admin_password_version'), '3'); assert.equal(f.values.get('admin_totp_enabled'), '1');
    assert.equal(f.values.has('admin_totp_pending'), false);
    await assert.rejects(f.store.commitPendingAdminTotp(enrollment));
}));
for (const reason of ['expired', 'version', 'binding', 'pendingId', 'corrupt']) test(`KC real store refuses ${reason} enrollment without changing the active factor`, () => withEnv(env, async () => {
    const f = storeFixture({ admin_totp_secret: secret, admin_totp_enabled: '1' });
    const enrollment = pending(); await f.store.savePendingAdminTotp(enrollment);
    let expected = { ...enrollment };
    if (reason === 'expired') f.values.set('admin_totp_pending', sealCredential(JSON.stringify({ ...enrollment, expiresAt: Date.now() - 1 }), 'admin_totp_pending', env));
    if (reason === 'version') f.values.set('admin_password_version', '3');
    if (reason === 'binding') expected.binding = 'other';
    if (reason === 'pendingId') expected.pendingId = 'other';
    if (reason === 'corrupt') f.values.set('admin_totp_pending', 'kc-secret:v1:broken');
    await assert.rejects(f.store.commitPendingAdminTotp(expected));
    assert.equal(f.values.get('admin_totp_secret'), secret); assert.equal(f.values.get('admin_totp_enabled'), '1');
    assert.equal(f.rollbacks, 1); assert.equal(f.commits, 1);
}));
test('KC real store does not swallow encrypted credential decryption failures', () => withEnv({}, async () => {
    const f = storeFixture({ admin_totp_secret: sealCredential(secret, purpose, env), admin_totp_pending: sealCredential(JSON.stringify(pending()), 'admin_totp_pending', env) });
    await assert.rejects(f.store.getAdminAuthConfig(), /decryption failed/);
    await assert.rejects(f.store.getPendingAdminTotp(), /decryption failed/);
}));
test('KC real store can disable TOTP without an encryption key', () => withEnv({}, async () => {
    const f = storeFixture({ admin_totp_secret: secret, admin_totp_enabled: '1', admin_2fa_login_mode: 'totp', admin_totp_pending: JSON.stringify(pending()) });
    await f.store.disableAdminTotp(2);
    assert.equal(f.values.get('admin_2fa_login_mode'), 'either');
    assert.equal(f.values.get('admin_totp_secret'), ''); assert.equal(f.values.get('admin_totp_enabled'), '0');
    assert.equal(f.values.has('admin_totp_pending'), false); assert.equal(f.values.get('admin_password_version'), '3');
}));
