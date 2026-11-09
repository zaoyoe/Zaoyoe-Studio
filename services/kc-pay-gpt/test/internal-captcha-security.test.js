import { describe, expect, it, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Import only the dependency-free boundary module; never load the app or dotenv.
const security = require('../internal-captcha-security');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../human-verification.js', import.meta.url), 'utf8');
const token = 'offline-captcha-fixture-token-at-least-32-bytes';
function response() {
    return { headersSent: false, statusCode: 200, headers: {}, listeners: {},
        setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; },
        json(body) { this.value = body; this.headersSent = true; return this; }, on(k, fn) { this.listeners[k] = fn; } };
}
function harness() {
    const app = { get: vi.fn() }, states = new Map();
    const a = server.indexOf('function getOrCreateCaptchaState('), b = server.indexOf('\nfunction notifyCaptchaClick(', a);
    const c = server.indexOf("app.get('/api/internal/captcha-wait-click/:jobKey'"), d = server.indexOf("app.post('/api/internal/captcha-status'", c);
    if ([a, b, c, d].some(i => i < 0)) throw new Error('Captcha source boundary missing');
    const context = vm.createContext({ app, interactiveCaptchaMap: states, captchaSecurity: security, Date, setTimeout, clearTimeout });
    vm.runInContext(server.slice(a, b), context); vm.runInContext(server.slice(c, d), context);
    const wait = (key, timeout) => { const res = response(); app.get.mock.calls[0][1]({ params: { jobKey: key }, query: { timeout } }, res); return res; };
    return { states, create: context.getOrCreateCaptchaState, wait };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('internal captcha authentication uses socket peer and a process credential', () => {
    it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('accepts %s only with the correct token', ip => {
        const res = response(), next = vi.fn();
        security.createInternalCaptchaAuth(token)({ socket: { remoteAddress: ip }, headers: { 'x-kc-internal-token': token } }, res, next);
        expect(next).toHaveBeenCalledOnce(); expect(res.headers['Cache-Control']).toBe('no-store');
    });
    it.each([
        ['198.51.100.1', token], [undefined, token], ['127.0.0.1', undefined], ['127.0.0.1', 'wrong'],
        ['127.0.0.1', [token]], ['127.0.0.1', 'x'.repeat(257)]
    ])('rejects invalid peer or credential %# even with a loopback XFF', (ip, supplied) => {
        const res = response(), next = vi.fn();
        security.createInternalCaptchaAuth(token)({ socket: { remoteAddress: ip }, headers: { 'x-forwarded-for': '127.0.0.1', 'x-kc-internal-token': supplied } }, res, next);
        expect(res.statusCode).toBe(403); expect(next).not.toHaveBeenCalled(); expect(res.headers['Cache-Control']).toBe('no-store');
    });
    it('rejects weak process credentials at startup', () => {
        for (const key of ['', 'short', null, undefined]) expect(() => security.createInternalCaptchaAuth(key)).toThrow();
    });
    it('guards the complete internal prefix before parsing and fixes worker HTTP to loopback without proxies or redirects', () => {
        expect(server).toContain("app.use('/api/internal', captchaSecurity.createInternalCaptchaAuth(internalCaptchaToken), express.json({ limit: '1600kb' }))");
        expect(server.indexOf("app.use('/api/internal',")).toBeLessThan(server.indexOf("app.post('/api/internal/captcha-prompt'"));
        expect(server).toContain('KC_INTERNAL_CAPTCHA_TOKEN: internalCaptchaToken');
        expect(worker).toContain('const baseUrl = `http://127.0.0.1:${serverPort}`');
        expect(worker).toContain("axios.create({ headers: { 'x-kc-internal-token': internalToken }, proxy: false, maxRedirects: 0 })");
    });
});

describe('captcha prompts are bounded and cannot retain arbitrary payloads', () => {
    it('accepts a loading placeholder and supported image formats', () => {
        expect(security.validPrompt({ jobKey: 'fixture-job_1', loading: true })).toBe(true);
        for (const type of ['png', 'jpeg', 'webp']) expect(security.validPrompt({ jobKey: 'job', image: `data:image/${type};base64,YQ==`, width: 1280, height: 800, expiresAt: Date.now() + 1000 })).toBe(true);
    });
    it.each([null, [], 'wrong', {}, { jobKey: '../job', loading: true }, { jobKey: 'x'.repeat(129), loading: true },
        { jobKey: 'job' }, { jobKey: 'job', image: 'https://example.test/image' }, { jobKey: 'job', image: 'data:image/svg+xml;base64,YQ==' },
        { jobKey: 'job', image: 'data:image/png;base64,' + 'A'.repeat(1_500_000) },
        { jobKey: 'job', loading: true, title: 'x'.repeat(2001) }, { jobKey: 'job', loading: true, width: 8193 },
        { jobKey: 'job', loading: true, height: -1 }, { jobKey: 'job', loading: true, width: 0.5 },
        { jobKey: 'job', loading: true, expiresAt: 0 }, { jobKey: 'job', loading: true, expiresAt: Infinity }
    ])('rejects malformed, expired or oversized prompts %#', body => {
        expect(security.validPrompt(body)).toBe(false);
    });
    it('cancels expired waiters, clears their timers and releases capacity', async () => {
        vi.useFakeTimers(); const expired = response(), finished = response(); finished.headersSent = true;
        const fire = vi.fn(), timer = setTimeout(fire, 1000), states = new Map([
            ['expired', { expiresAt: Date.now(), waitingRequests: [{ res: expired, timer }, { res: finished }] }],
            ['fallback', { updatedAt: Date.now() - security.CAPTCHA_TTL_MS }], ['live', { expiresAt: Date.now() + 1000 }]
        ]);
        security.expireStates(states); expect([...states.keys()]).toEqual(['live']);
        expect(expired.value).toEqual({ success: true, clicked: false, cancelled: true }); expect(finished.value).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1000); expect(fire).not.toHaveBeenCalled();
    });
    it('caps states at 128 and reclaims expired slots', () => {
        vi.useFakeTimers(); const h = harness();
        for (let i = 0; i < 128; i++) expect(h.create(`job-${i}`)).toBeTruthy();
        expect(h.create('overflow')).toBeNull(); expect(h.create('../invalid')).toBeNull(); expect(h.create('job-0')).toBe(h.states.get('job-0'));
        vi.advanceTimersByTime(security.CAPTCHA_TTL_MS); expect(h.create('next')).toBeTruthy(); expect(h.states.size).toBe(1);
    });
});

describe('captcha long polling retains only one waiter per active job', () => {
    it('returns 404 without creating an unknown, inactive or expired job', () => {
        vi.useFakeTimers(); const h = harness(); expect(h.wait('missing').statusCode).toBe(404); expect(h.states.size).toBe(0);
        h.create('inactive'); expect(h.wait('inactive').statusCode).toBe(404);
        const state = h.create('expired'); state.active = true; state.expiresAt = Date.now();
        expect(h.wait('expired').statusCode).toBe(404); expect(h.states.has('expired')).toBe(false);
    });
    it('rejects a second waiter, cleans up on disconnect and accepts a new waiter', () => {
        vi.useFakeTimers(); const h = harness(), state = h.create('job'); state.active = true;
        const first = h.wait('job'); expect(state.waitingRequests).toHaveLength(1); expect(h.wait('job').statusCode).toBe(429);
        first.listeners.close(); expect(state.waitingRequests).toHaveLength(0);
        const second = h.wait('job'); expect(state.waitingRequests).toHaveLength(1); second.listeners.close();
    });
    it.each([[-1, 500], [Infinity, 35000], [100000, 60000]])('clamps requested timeout %s to %s', async (requested, expected) => {
        vi.useFakeTimers(); const h = harness(), state = h.create('job'); state.active = true;
        const res = h.wait('job', requested); await vi.advanceTimersByTimeAsync(expected - 1); expect(res.value).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1); expect(res.value).toEqual({ success: true, clicked: false, timeout: true }); expect(state.waitingRequests).toHaveLength(0);
    });
    it('consumes a pending click exactly once without retaining a waiter', () => {
        vi.useFakeTimers(); const h = harness(), state = h.create('job'); state.active = true;
        state.pendingClicks.push({ clicked: true, ratioX: 0.2 }); expect(h.wait('job').value).toEqual({ clicked: true, ratioX: 0.2 });
        expect(state.pendingClicks).toHaveLength(0); expect(state.waitingRequests).toHaveLength(0);
        const next = h.wait('job'); expect(next.value).toBeUndefined(); next.listeners.close();
    });
});
