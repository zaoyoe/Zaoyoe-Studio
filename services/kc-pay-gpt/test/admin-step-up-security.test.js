import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import net from 'node:net';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const authSource = read('admin-auth.js');
const securitySource = read('admin-security.js');
const serverSource = read('server.js');
const PASSWORD = 'offline-fixture-password-strong';
const SIGNING_KEY = 'offline-fixture-signing-key-at-least-32-bytes';
const FIXTURE_SEED = 'JBSWY3DPEHPK3PXP';
const hash = `scrypt$fixture$${crypto.scryptSync(PASSWORD, 'fixture', 64).toString('hex')}`;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function response() {
    return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
        setHeader(key, value) { this.headers[key] = value; }, json(value) { this.value = value; return this; }, send(value) { this.value = value; return this; } };
}
function harness() {
    const clock = { now: 1_790_000_000_000 };
    class Clock extends Date { static now() { return clock.now; } }
    const module = { exports: {} };
    vm.runInNewContext(authSource, { module, Buffer, Date: Clock, process: { env: { ADMIN_TOKEN_SECRET: SIGNING_KEY } },
        require: name => { if (name === 'crypto') return crypto; if (name === 'node:net') return net; throw new Error(`Unexpected dependency: ${name}`); } });
    const auth = module.exports;
    const config = { email: 'admin@example.test', passwordHash: hash, passwordVersion: 2, login2faMode: 'either', totpEnabled: false, totpSecret: '' };
    const telegram = {};
    let savedPending = null;
    const store = {
        getAdminAuthConfig: vi.fn(async () => ({ ...config })), getTelegramConfig: vi.fn(async () => ({ ...telegram })),
        savePendingAdminTotp: vi.fn(async value => { savedPending = { ...value }; }),
        getPendingAdminTotp: vi.fn(async () => savedPending && { ...savedPending }),
        commitPendingAdminTotp: vi.fn(async () => {})
    };
    const ensureStoreReady = vi.fn(async () => {}), send = vi.fn(async () => ({ ok: true }));
    const securityModule = { exports: {} };
    vm.runInNewContext(securitySource, { module: securityModule, Date: Clock,
        require: name => { if (name === 'node:crypto') return crypto; if (name === './admin-auth') return auth; if (name === './lib/qrcode-generator') return require('../lib/qrcode-generator'); if (name === './webauthn-security') return require('../webauthn-security'); throw new Error(`Unexpected dependency: ${name}`); } });
    const handlers = securityModule.exports.createAdminSecurity({ store, ensureStoreReady, sendTelegramLoginCode: send });
    const request = (body = {}, extra = {}) => ({ body, headers: {}, ip: '192.0.2.10', admin: { pv: 2, email: config.email }, adminToken: 'offline-login-token', ...extra });
    const invoke = async (method, body = {}, extra = {}) => { const res = response(); await handlers[method](request(body, extra), res); return res; };
    const issueProof = (extra = {}) => auth.issueSecondaryToken(2, extra.ip || '192.0.2.10', extra.adminToken || 'offline-login-token');
    const authorize = async (proof, extra = {}) => {
        const res = response(), next = vi.fn();
        await auth.createRequireSecondaryAuth(store, ensureStoreReady)(request({}, { headers: { 'x-admin-secondary-token': proof }, ...extra }), res, next);
        return { res, next };
    };
    return { auth, clock, config, telegram, store, ensureStoreReady, send, handlers, request, invoke, issueProof, authorize, pending: () => savedPending };
}
function totp(seed, now) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const bits = [...seed].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
    const bytes = Buffer.from((bits.match(/.{8}/g) || []).map(byte => parseInt(byte, 2)));
    const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
    const digest = crypto.createHmac('sha1', bytes).update(counter).digest();
    return String((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
async function challenge(h, extra = {}) { return h.invoke('challenge', { password: PASSWORD }, extra); }

describe('KC recent verification binds the exact login and authorizes at time of use', () => {
    it('accepts a valid proof and disables response caching', async () => {
        const h = harness(), { res, next } = await h.authorize(h.issueProof().token);
        expect(next).toHaveBeenCalledOnce(); expect(res.headers['Cache-Control']).toBe('no-store');
    });
    it.each(['missing', 'array', 'token', 'ip', 'version', 'expired'])('rejects %s proof before storage access', async kind => {
        const h = harness(); let token = h.issueProof().token; const extra = {};
        if (kind === 'missing') token = undefined;
        if (kind === 'array') token = [token];
        if (kind === 'token') extra.adminToken = 'other-login';
        if (kind === 'ip') extra.ip = '192.0.2.11';
        if (kind === 'version') extra.admin = { pv: 3 };
        if (kind === 'expired') h.clock.now += 300_000;
        const { res, next } = await h.authorize(token, extra);
        expect(res.statusCode).toBe(403); expect(next).not.toHaveBeenCalled(); expect(h.store.getAdminAuthConfig).not.toHaveBeenCalled();
    });
    it('rejects a proof that expires during the awaited store read', async () => {
        const h = harness(), token = h.issueProof().token, gate = deferred();
        h.store.getAdminAuthConfig.mockReturnValue(gate.promise);
        const result = h.authorize(token); await Promise.resolve(); h.clock.now += 300_000; gate.resolve({ ...h.config });
        const { res, next } = await result; expect(res.statusCode).toBe(403); expect(next).not.toHaveBeenCalled();
    });
    it('rejects a changed password version even with a correctly signed proof', async () => {
        const h = harness(), token = h.issueProof().token; h.config.passwordVersion++;
        const { res, next } = await h.authorize(token); expect(res.statusCode).toBe(403); expect(next).not.toHaveBeenCalled();
    });
    it('fails closed and hides storage diagnostics', async () => {
        const h = harness(); h.store.getAdminAuthConfig.mockRejectedValue(new Error('private-driver-fixture'));
        const { res, next } = await h.authorize(h.issueProof().token);
        expect(res.statusCode).toBe(503); expect(next).not.toHaveBeenCalled(); expect(JSON.stringify(res.value)).not.toContain('private-driver');
    });
});

describe('KC second factor challenge consumption and configuration policy', () => {
    it('still requires the password when no extra factor is configured', async () => {
        const h = harness(); expect((await h.invoke('challenge', { password: 'wrong' })).statusCode).toBe(401);
        const c = await challenge(h); expect(c.value.method).toBe('');
        const result = await h.invoke('verify', { challengeId: c.value.challengeId }); expect(result.value.success).toBe(true);
        expect(h.auth.verifySecondaryToken(result.value.secondaryToken).binding).toBe(crypto.createHash('sha256').update('offline-login-token').digest('hex'));
    });
    it('uses the configured TOTP factor and verifies an actual RFC-compatible code', async () => {
        const h = harness(); Object.assign(h.config, { login2faMode: 'totp', totpEnabled: true, totpSecret: FIXTURE_SEED });
        const c = await challenge(h); expect(c.value.method).toBe('totp');
        const result = await h.invoke('verify', { challengeId: c.value.challengeId, code: totp(FIXTURE_SEED, h.clock.now) });
        expect(result.value.success).toBe(true); expect(h.send).not.toHaveBeenCalled();
    });
    it.each(['totp-missing', 'totp-required', 'tg-token-only', 'tg-chat-only', 'tg-required', 'unknown-mode'])('fails closed for %s', async kind => {
        const h = harness();
        if (kind === 'totp-missing') h.config.totpEnabled = true;
        if (kind === 'totp-required') h.config.login2faMode = 'totp';
        if (kind === 'tg-token-only') h.telegram.bot_token = 'offline';
        if (kind === 'tg-chat-only') h.telegram.admin_chat_id = 'offline';
        if (kind === 'tg-required') h.config.login2faMode = 'telegram';
        if (kind === 'unknown-mode') h.config.login2faMode = 'ignore';
        expect((await challenge(h)).statusCode).toBe(503); expect(h.send).not.toHaveBeenCalled();
    });
    it('sends no Telegram code for a wrong password and removes a failed-send challenge', async () => {
        const h = harness(); Object.assign(h.telegram, { bot_token: 'offline', admin_chat_id: 'offline' });
        expect((await h.invoke('challenge', { password: 'wrong' })).statusCode).toBe(401); expect(h.send).not.toHaveBeenCalled();
        h.send.mockResolvedValue({ ok: false }); expect((await challenge(h)).statusCode).toBe(503);
    });
    it('allows only one concurrent verification and prevents replay', async () => {
        const h = harness(); Object.assign(h.telegram, { bot_token: 'offline', admin_chat_id: 'offline' });
        const c = await challenge(h), gate = deferred(), code = h.send.mock.calls[0][1];
        h.store.getAdminAuthConfig.mockReturnValue(gate.promise);
        const attempts = [h.invoke('verify', { challengeId: c.value.challengeId, code }), h.invoke('verify', { challengeId: c.value.challengeId, code })];
        gate.resolve({ ...h.config });
        const results = await Promise.all(attempts); expect(results.map(x => x.statusCode).sort()).toEqual([200, 403]);
        expect((await h.invoke('verify', { challengeId: c.value.challengeId, code })).statusCode).toBe(403);
    });
    it('reserves a shared five-guess budget before asynchronous reads', async () => {
        const h = harness(); Object.assign(h.telegram, { bot_token: 'offline', admin_chat_id: 'offline' });
        const c = await challenge(h), gate = deferred(), code = h.send.mock.calls[0][1];
        h.store.getAdminAuthConfig.mockReturnValue(gate.promise);
        const bad = code === '000000' ? '000001' : '000000';
        const attempts = Array.from({ length: 5 }, () => h.invoke('verify', { challengeId: c.value.challengeId, code: bad }));
        expect((await h.invoke('verify', { challengeId: c.value.challengeId, code })).statusCode).toBe(403);
        gate.resolve({ ...h.config }); expect((await Promise.all(attempts)).every(r => r.statusCode === 403)).toBe(true);
        expect((await h.invoke('verify', { challengeId: c.value.challengeId, code })).statusCode).toBe(403);
    });
    it.each(['token', 'ip', 'version', 'ttl', 'await-expiry'])('rejects challenge after %s changes', async kind => {
        const h = harness(), c = await challenge(h), extra = {};
        if (kind === 'token') extra.adminToken = 'other-login';
        if (kind === 'ip') extra.ip = '192.0.2.99';
        if (kind === 'version') h.config.passwordVersion++;
        if (kind === 'ttl') h.clock.now += 300_000;
        if (kind === 'await-expiry') h.store.getAdminAuthConfig.mockImplementation(async () => { h.clock.now += 300_000; return { ...h.config }; });
        const result = await h.invoke('verify', { challengeId: c.value.challengeId }, extra); expect(result.statusCode).toBe(403);
    });
    it('caps live challenges at 128 and reclaims expired capacity', async () => {
        const h = harness();
        // Separate source addresses isolate capacity from the per-address request budget.
        for (let i = 0; i < 128; i++) expect((await challenge(h, { ip: `192.0.2.${i + 1}` })).statusCode).toBe(200);
        expect((await challenge(h, { ip: '198.51.100.1' })).statusCode).toBe(429);
        h.clock.now += 300_000;
        expect((await challenge(h, { ip: '198.51.100.2' })).statusCode).toBe(200);
    });
});

describe('KC pending TOTP cannot replace an active factor without confirmation', () => {
    it('generates a local QR and saves a bound pending seed without mutating the active factor', async () => {
        const h = harness(); h.config.totpSecret = FIXTURE_SEED; h.config.totpEnabled = true;
        const result = await h.invoke('setup'); expect(result.value.qrCodeUrl).toMatch(/^data:image\/gif;base64,/);
        expect(h.pending().binding).toBe(crypto.createHash('sha256').update('offline-login-token').digest('hex'));
        expect(h.pending().passwordVersion).toBe(2); expect(h.pending().expiresAt).toBe(h.clock.now + 300_000);
        expect(h.config.totpSecret).toBe(FIXTURE_SEED); expect(h.store.commitPendingAdminTotp).not.toHaveBeenCalled();
    });
    it.each(['id', 'binding', 'expiry', 'version', 'code'])('does not commit when pending %s is invalid', async kind => {
        const h = harness(); await h.invoke('setup'); const p = h.pending();
        const body = { pendingId: p.pendingId, code: totp(p.secret, h.clock.now) }, extra = {};
        if (kind === 'id') body.pendingId = 'other';
        if (kind === 'binding') extra.adminToken = 'other-login';
        if (kind === 'expiry') h.clock.now += 300_000;
        if (kind === 'version') extra.admin = { pv: 3 };
        if (kind === 'code') body.code = 'invalid';
        expect((await h.invoke('confirm', body, extra)).statusCode).toBe(400); expect(h.store.commitPendingAdminTotp).not.toHaveBeenCalled();
    });
    it('commits only a confirmed seed, and a concurrent storage conflict is a safe 409', async () => {
        const h = harness(); await h.invoke('setup'); const p = h.pending();
        const body = { pendingId: p.pendingId, code: totp(p.secret, h.clock.now) };
        expect((await h.invoke('confirm', body)).value.reauthenticate).toBe(true); expect(h.store.commitPendingAdminTotp).toHaveBeenCalledOnce();
        h.store.commitPendingAdminTotp.mockRejectedValue(new Error('private-concurrency-fixture'));
        const result = await h.invoke('confirm', body); expect(result.statusCode).toBe(409); expect(JSON.stringify(result.value)).not.toContain('private-concurrency');
    });
});

function routeHarness() {
    const routes = new Map(), secondary = () => {};
    const store = { insertAdminLoginLog: vi.fn(async () => {}), runQuery: vi.fn(async () => [{ cdk_code: 'offline-cdk', id: 4 }]),
        getSessionByJobKey: vi.fn(async () => ({ session_payload: 'offline-session' })), exportBillingRecordsCSV: vi.fn(async () => 'offline-csv') };
    const context = { app: { get: (url, ...handlers) => routes.set(url, handlers) }, requireSecondaryAuth: secondary, store,
        ensureStoreReady: async () => {}, adminAuth: { getClientMeta: () => ({ ip: '192.0.2.10' }) } };
    for (const [start, end] of [
        ["app.get('/api/admin/sessions/:jobKey'", "app.post('/api/admin/subscription/"],
        ["app.get('/api/admin/cards/:id/secret'", "app.post('/api/admin/cards/import'"],
        ["app.get('/api/admin/billing/:id/secret'", "app.get('/api/admin/billing/summary/"]
    ]) {
        const a = serverSource.indexOf(start), b = serverSource.indexOf(end, a);
        if (a < 0 || b < a) throw new Error('Route boundary missing');
        vm.runInNewContext(serverSource.slice(a, b), context);
    }
    const invoke = async (url, params = { id: '4', jobKey: 'fixture-job' }) => {
        const handlers = routes.get(url); expect(handlers[0]).toBe(secondary);
        const res = response(); await handlers.at(-1)({ params, query: {}, admin: { email: 'admin@example.test' } }, res); return res;
    };
    return { routes, store, invoke };
}
describe('KC sensitive reads require recent verification and a successful prior audit write', () => {
    it.each(['/api/admin/sessions/:jobKey', '/api/admin/cards/:id/secret', '/api/admin/billing/:id/secret', '/api/admin/billing/export'])('fails closed at %s when audit fails', async url => {
        const h = routeHarness(); h.store.insertAdminLoginLog.mockRejectedValue(new Error('private-audit-fixture'));
        const result = await h.invoke(url); expect(result.statusCode).toBe(503);
        expect(h.store.runQuery).not.toHaveBeenCalled(); expect(h.store.getSessionByJobKey).not.toHaveBeenCalled(); expect(h.store.exportBillingRecordsCSV).not.toHaveBeenCalled();
        expect(JSON.stringify(result.value)).not.toContain('private-audit');
    });
    it('waits for the audit and records only the row identity before querying a CDK', async () => {
        const h = routeHarness(), gate = deferred(); h.store.insertAdminLoginLog.mockReturnValue(gate.promise);
        const pending = h.invoke('/api/admin/billing/:id/secret'); await Promise.resolve();
        expect(h.store.runQuery).not.toHaveBeenCalled(); gate.resolve();
        const result = await pending; expect(result.value.cdk).toBe('offline-cdk');
        expect(h.store.runQuery).toHaveBeenCalledWith('SELECT cdk_code FROM billing_records WHERE id = ?', ['4']);
        const audit = h.store.insertAdminLoginLog.mock.calls[0][0]; expect(audit.detail).toBe('billing_id=4'); expect(JSON.stringify(audit)).not.toContain('offline-cdk');
    });
    it.each(['0', '-1', '1 OR 1=1', '1234567890123456', ''])('rejects invalid billing row ID %s', async id => {
        const h = routeHarness(); expect((await h.invoke('/api/admin/billing/:id/secret', { id })).statusCode).toBe(400);
        expect(h.store.insertAdminLoginLog).not.toHaveBeenCalled(); expect(h.store.runQuery).not.toHaveBeenCalled();
    });
    it('returns 404 for an absent billing row', async () => {
        const h = routeHarness(); h.store.runQuery.mockResolvedValue([]);
        expect((await h.invoke('/api/admin/billing/:id/secret')).statusCode).toBe(404);
    });
    it('projects masked billing fields without fetching Stripe identifiers or error payloads', async () => {
        const source = read('mysql-store.js'), a = source.indexOf('async function listBillingRecords('), b = source.indexOf('\nasync function ', a + 1);
        const runQuery = vi.fn(async sql => /COUNT\(/i.test(sql) ? [{ total: 0 }] : []);
        const fn = vm.runInNewContext(`(${source.slice(a, b)})`, { runQuery }); await fn({}, 1, 20);
        const projection = runQuery.mock.calls.map(call => call[0]).find(sql => /FROM billing_records/.test(sql) && !/COUNT\(/i.test(sql));
        expect(projection).toMatch(/CONCAT\('\*\*\*\*', card_last4\)/);
        expect(projection).toMatch(/CASE WHEN cdk_code[\s\S]*'\[已隐藏\]'[\s\S]*END AS cdk_code/);
        expect(projection).not.toMatch(/stripe_|error_message|SELECT\s+\*/i);
    });
});
