import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.dirname(new URL('../server.js', import.meta.url).pathname);
const source = fs.readFileSync(path.join(root, 'admin-auth.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const SECRET = 'offline-test-signing-secret-only-32-bytes';
const EMAIL = 'admin@example.test';
const META = { ip: '192.0.2.10', fingerprint: 'offline-browser' };
const CONFIG = { email: EMAIL, passwordVersion: 2 };
function authHarness(env = {}, cryptoOverride) {
    const module = { exports: {} }, fakeEnv = { ADMIN_TOKEN_SECRET: SECRET, ...env };
    vm.runInNewContext(source, { module, Buffer, Date, process: { env: fakeEnv },
        require: name => name === 'crypto' && cryptoOverride ? cryptoOverride : require(name) });
    return { auth: module.exports, env: fakeEnv };
}
function signed(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}
function challenge(auth) { return auth.issueLoginChallenge({ email: EMAIL, passwordVersion: 2, ...META }); }
function routeHarness() {
    const { auth } = authHarness();
    const config = { ...CONFIG, passwordHash: auth.createPasswordHash('a-long-offline-test-password'), login2faMode: 'telegram', totpEnabled: false };
    const telegram = { bot_token: 'offline-bot', admin_chat_id: 'offline-chat' };
    const store = { getAdminAuthConfig: vi.fn(async () => config), getTelegramConfig: vi.fn(async () => telegram) };
    const send = vi.fn(async () => ({ ok: true })), routes = new Map();
    vm.runInNewContext(server.slice(server.indexOf("app.post('/api/admin/login',"), server.indexOf('/** 运行日志')), {
        app: { post: (url, handler) => routes.set(url, handler) }, adminAuth: auth, store, ensureStoreReady: async () => {},
        verifyPassword: auth.verifyPassword, issueAdminToken: auth.issueAdminToken, logAdminSecurityEvent: async () => {},
        fireAdminSecurityNotification() {}, attachAdminPaths: async value => value, sendTelegramLoginCode: send
    });
    async function invoke(url, body, meta = META) {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return this; } };
        await routes.get(`/api/admin/login${url}`)({ body: { fingerprint: meta.fingerprint, ...body }, headers: {}, ip: meta.ip }, res);
        return res;
    }
    return { auth, config, telegram, send, invoke };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('KC signing and credential ingress', () => {
    it.each([undefined, '', 'short', ' '.repeat(40)])('rejects missing/weak signing secret (%s)', secret => {
        const { auth } = authHarness({ ADMIN_TOKEN_SECRET: secret });
        expect(() => auth.resolveAdminTokenSecret()).toThrow(/ADMIN_TOKEN_SECRET/);
        expect(() => auth.issueAdminToken(1, EMAIL)).toThrow();
    });
    it('accepts valid bearer tokens and refuses query tokens, extra segments and ambiguous headers', () => {
        const { auth } = authHarness(), { token } = auth.issueAdminToken(2, EMAIL);
        expect(auth.verifyAdminToken(token)?.pv).toBe(2);
        for (const value of [`${token}.extra`, `x${token}`, 'x'.repeat(5000)]) expect(auth.verifyAdminToken(value)).toBeNull();
        expect(auth.getBearerToken({ headers: {}, query: { token } })).toBeNull();
        expect(auth.getBearerToken({ headers: { authorization: `Bearer ${token}` } })).toBe(token);
        for (const value of [`Bearer ${token} extra`, [`Bearer ${token}`]]) expect(auth.getBearerToken({ headers: { authorization: value } })).toBeNull();
    });
    it.each([{ exp: 'NaN' }, { exp: '9999999999999' }, { exp: null }, { iat: '123' },
        { iat: Date.parse('2027-01-01') }, { exp: Date.parse('2028-01-01') }, { pv: 0 }, { pv: 1.5 }
    ])('rejects signed tokens with invalid claims %j', changed => {
        const { auth } = authHarness();
        expect(auth.verifyAdminToken(signed({ sub: 'admin', permissions: ['admin'], pv: 2, email: EMAIL,
            iat: Date.now(), exp: Date.now() + 60_000, ...changed }))).toBeNull();
    });
    it('expires a token at the exact deadline', () => {
        const { auth } = authHarness(), issued = auth.issueAdminToken(2, EMAIL);
        vi.setSystemTime(issued.payload.exp);
        expect(auth.verifyAdminToken(issued.token)).toBeNull();
    });
    it.each(['', null, 'invalid', 'scrypt$short$bad', 123, 'scrypt$' + 'a'.repeat(32) + '$' + 'b'.repeat(127)])('refuses an existing invalid password record instead of treating it as a fresh install (%s)', value => {
        const { auth } = authHarness({ ADMIN_PASSWORD: 'a-strong-offline-bootstrap-password' });
        expect(() => auth.resolveInitialAdminPasswordHash(value)).toThrow(/credential recovery/);
    });
    it('stops database initialization before any write when the existing password record is invalid', async () => {
        const { auth } = authHarness({ ADMIN_PASSWORD: 'a-strong-offline-bootstrap-password' });
        const storeSource = fs.readFileSync(path.join(root, 'mysql-store.js'), 'utf8');
        const start = storeSource.indexOf('async function initializeBaseData()');
        const end = storeSource.indexOf('\nasync function ', start + 1);
        const write = vi.fn();
        const initialize = vm.runInNewContext(`(${storeSource.slice(start, end)})`, {
            runQuery: async () => [{ config_value: '' }], runExecute: write,
            resolveInitialAdminPasswordHash: auth.resolveInitialAdminPasswordHash
        });
        await expect(initialize()).rejects.toThrow(/credential recovery/);
        expect(write).not.toHaveBeenCalled();
    });
    it('requires a strong explicit bootstrap password only for a missing database hash', () => {
        const { auth, env } = authHarness();
        expect(() => auth.resolveInitialAdminPasswordHash()).toThrow(/ADMIN_PASSWORD/);
        env.ADMIN_PASSWORD = 'admin123'; expect(() => auth.resolveInitialAdminPasswordHash()).toThrow();
        const saved = auth.createPasswordHash('previous-password');
        expect(auth.resolveInitialAdminPasswordHash(saved)).toBe(saved);
        env.ADMIN_PASSWORD = 'a-strong-offline-bootstrap-password';
        expect(auth.verifyPassword(env.ADMIN_PASSWORD, auth.resolveInitialAdminPasswordHash())).toBe(true);
    });
});

describe('KC IP trust and concurrent login limits', () => {
    // Execute the production recharge helper without starting the server/database.
    const ipHelperStart = server.indexOf('function getClientIp(req) {');
    const ipHelperEnd = server.indexOf('function getRemainingCooldownMinutes(', ipHelperStart);
    const getRechargeClientIp = vm.runInNewContext(`(${server.slice(ipHelperStart, ipHelperEnd)})`);
    it.each([
        ['', '192.0.2.99', '203.0.113.8, 198.51.100.7', '192.0.2.99'],
        ['127.0.0.1', '192.0.2.99', '203.0.113.8, 198.51.100.7', '192.0.2.99'],
        ['127.0.0.1', '127.0.0.1', '203.0.113.8, 198.51.100.7', '198.51.100.7'],
        ['127.0.0.1,198.51.100.7', '127.0.0.1', '203.0.113.8, 198.51.100.7', '203.0.113.8'],
        ['127.0.0.1,198.51.100.7', '127.0.0.1', '203.0.113.8, 192.0.2.44, 198.51.100.7', '192.0.2.44'],
        ['', '::ffff:192.0.2.99', '203.0.113.8', '192.0.2.99'],
        ['127.0.0.1', '::ffff:127.0.0.1', '::ffff:198.51.100.7', '198.51.100.7'],
        ['127.0.0.1', '127.0.0.1', '', '127.0.0.1']
    ])('uses the trusted proxy chain for admin and recharge (%s, %s, %s)', (allowlist, peer, forwarded, expected) => {
        const { auth } = authHarness(), express = require('express');
        const app = express(); app.set('trust proxy', auth.resolveTrustedProxyCidrs(allowlist));
        const req = Object.create(app.request);
        req.app = app; req.connection = { remoteAddress: peer };
        req.headers = { 'x-real-ip': '203.0.113.9', 'cf-connecting-ip': '203.0.113.10' };
        if (forwarded) req.headers['x-forwarded-for'] = forwarded;
        expect(auth.getClientMeta(req).ip).toBe(expected);
        expect(getRechargeClientIp(req)).toBe(expected);
    });
    it('normalizes the recharge socket fallback without trusting forwarded headers', () => {
        expect(getRechargeClientIp({ headers: { 'x-forwarded-for': '203.0.113.8' }, socket: { remoteAddress: '::1' } })).toBe('127.0.0.1');
        expect(getRechargeClientIp({ headers: {}, socket: { remoteAddress: '::ffff:192.0.2.99' } })).toBe('192.0.2.99');
        expect(getRechargeClientIp({ headers: {} })).toBe('');
    });
    it.each(['true', '1', '0.0.0.0/0', '::/0', '127.0.0.1/33', '::1/129', '127.0.0.1,'])('rejects unsafe proxy config %s', value => {
        expect(() => authHarness().auth.resolveTrustedProxyCidrs(value)).toThrow();
    });
    it('reserves all attempts before asynchronous verification and unlocks after timeout', async () => {
        const { auth } = authHarness();
        const attempts = await Promise.all(Array.from({ length: 12 }, async () => {
            const result = auth.checkLoginRateLimit(META.ip); await Promise.resolve();
            if (result.allowed) auth.recordLoginFailure(result.key, result.entry); return result;
        }));
        expect(attempts.filter(item => item.allowed)).toHaveLength(5);
        expect(auth.checkLoginRateLimit(META.ip).allowed).toBe(false);
        vi.advanceTimersByTime(30 * 60_000); expect(auth.checkLoginRateLimit(META.ip).allowed).toBe(true);
    });
    it('keeps full IPv6 password and 2FA budgets separate', () => {
        const { auth } = authHarness(), ip = '2001:0db8:0000:0000:0000:0000:0000:0001';
        for (let i = 0; i < 5; i++) auth.checkLoginRateLimit(ip);
        expect(auth.checkLoginRateLimit(ip).allowed).toBe(false); expect(auth.checkLoginRateLimit(`${ip}:2fa`).allowed).toBe(true);
    });
    it('bounds memory, denies overflow and reclaims expired entries', () => {
        const { auth } = authHarness();
        for (let i = 0; i < 4096; i++) expect(auth.checkLoginRateLimit(`ip-${i}`).allowed).toBe(true);
        expect(auth.checkLoginRateLimit('overflow').allowed).toBe(false);
        vi.advanceTimersByTime(16 * 60_000); expect(auth.checkLoginRateLimit('overflow').allowed).toBe(true);
    });
});

describe('KC challenge lifecycle', () => {
    it('binds current password version, email, IP and fingerprint and consumes exactly once', () => {
        const { auth } = authHarness(), issued = challenge(auth), value = auth.verifyLoginChallenge(issued.token);
        expect(auth.validateLoginChallenge(value, CONFIG, META)).toBe(true);
        for (const [config, meta] of [[{ ...CONFIG, passwordVersion: 3 }, META], [{ ...CONFIG, email: 'other@example.test' }, META],
            [CONFIG, { ...META, ip: '192.0.2.11' }], [CONFIG, { ...META, fingerprint: '' }]]) expect(auth.validateLoginChallenge(value, config, meta)).toBe(false);
        expect(auth.beginLoginChallengeAttempt(value, CONFIG, META)).toBe(true);
        expect(auth.consumeLoginChallenge(value, CONFIG, META)).toBe(true);
        expect(auth.consumeLoginChallenge(value, CONFIG, META)).toBe(false); expect(auth.verifyLoginChallenge(issued.token)).toBeNull();
    });
    it('invalidates challenges after restart and expiry', () => {
        const { auth } = authHarness(), issued = challenge(auth);
        expect(authHarness().auth.verifyLoginChallenge(issued.token)).toBeNull();
        vi.setSystemTime(issued.payload.exp); expect(auth.verifyLoginChallenge(issued.token)).toBeNull();
    });
    it('uses one attempt budget across methods and code resends', () => {
        const { auth } = authHarness(), value = challenge(auth).payload;
        auth.storeTelegramLoginCode(value.cid, '123456');
        for (let i = 0; i < 5; i++) {
            expect(auth.beginLoginChallengeAttempt(value, CONFIG, META)).toBe(true);
            auth.verifyTelegramLoginCode(value.cid, '000000'); auth.storeTelegramLoginCode(value.cid, '123456');
        }
        expect(auth.beginLoginChallengeAttempt(value, CONFIG, META)).toBe(false); expect(auth.reserveTelegramCodeSend(value)).toBe(false);
        expect(auth.verifyTelegramLoginCode(value.cid, '123456').ok).toBe(false);
    });
    it('reserves a one-minute cooldown and at most three sends per challenge', () => {
        const { auth } = authHarness(), value = challenge(auth).payload;
        for (let i = 0; i < 3; i++) {
            expect(auth.reserveTelegramCodeSend(value)).toBe(true); expect(auth.reserveTelegramCodeSend(value)).toBe(false); vi.advanceTimersByTime(60_000);
        }
        expect(auth.reserveTelegramCodeSend(value)).toBe(false);
    });
    it('uses crypto.randomInt for codes and refuses short TOTP input', () => {
        const randomInt = vi.fn(() => 456789), { auth } = authHarness({}, { ...crypto, randomInt });
        expect(auth.generateTelegramLoginCode()).toBe('456789'); expect(randomInt).toHaveBeenCalledWith(100000, 1000000);
        expect(auth.verifyTotpCode('JBSWY3DPEHPK3PXP', '123')).toBe(false);
    });
});

describe('KC actual routes with mocked database and Telegram', () => {
    async function login(h) {
        const res = await h.invoke('', { email: EMAIL, password: 'a-long-offline-test-password' });
        expect(res.value.requires2fa).toBe(true); return res.value.challengeToken;
    }
    it('completes Telegram login once and rejects parallel and sequential replay', async () => {
        const h = routeHarness(), token = await login(h);
        expect((await h.invoke('/send-tg-code', { challengeToken: token })).statusCode).toBe(200);
        const code = h.send.mock.calls[0][1];
        const results = await Promise.all(Array.from({ length: 2 }, () => h.invoke('/verify-2fa', { challengeToken: token, code, method: 'telegram' })));
        expect(results.map(item => item.statusCode).sort()).toEqual([200, 401]);
        expect(h.auth.verifyAdminToken(results.find(item => item.statusCode === 200).value.token)?.email).toBe(EMAIL);
        expect((await h.invoke('/verify-2fa', { challengeToken: token, code, method: 'telegram' })).statusCode).toBe(401);
    });
    it('rejects old password-version challenges on both endpoints without messaging', async () => {
        const h = routeHarness(), token = await login(h); h.config.passwordVersion++;
        expect((await h.invoke('/send-tg-code', { challengeToken: token })).statusCode).toBe(401); expect(h.send).not.toHaveBeenCalled();
        expect((await h.invoke('/verify-2fa', { challengeToken: token, code: '123456', method: 'telegram' })).statusCode).toBe(401);
    });
    it('rejects changed binding and throttles simultaneous code sends', async () => {
        const h = routeHarness(), token = await login(h);
        expect((await h.invoke('/send-tg-code', { challengeToken: token }, { ...META, fingerprint: 'other' })).statusCode).toBe(401);
        const results = await Promise.all(Array.from({ length: 5 }, () => h.invoke('/send-tg-code', { challengeToken: token })));
        expect(results.filter(item => item.statusCode === 200)).toHaveLength(1); expect(results.filter(item => item.statusCode === 429)).toHaveLength(4); expect(h.send).toHaveBeenCalledOnce();
    });
    it('does not reset the password budget while 2FA remains pending', async () => {
        const h = routeHarness();
        const results = await Promise.all(Array.from({ length: 8 }, () => h.invoke('', { email: EMAIL, password: 'a-long-offline-test-password' })));
        expect(results.filter(item => item.statusCode === 200)).toHaveLength(5); expect(results.filter(item => item.statusCode === 429)).toHaveLength(3);
    });
    it('keeps password-only login working when 2FA is unconfigured', async () => {
        const h = routeHarness(); h.telegram.bot_token = ''; h.telegram.admin_chat_id = ''; h.config.login2faMode = 'either';
        const res = await h.invoke('', { email: EMAIL, password: 'a-long-offline-test-password' });
        expect(res.statusCode).toBe(200); expect(res.value.requires2fa).toBe(false); expect(h.auth.verifyAdminToken(res.value.token)?.pv).toBe(2);
    });
    it('browser includes its fingerprint when sending Telegram codes', () => {
        expect(fs.readFileSync(path.join(root, 'public/admin-login.html'), 'utf8')).toContain('JSON.stringify({ challengeToken: state.challengeToken, fingerprint: getBrowserFingerprint() })');
    });
});
