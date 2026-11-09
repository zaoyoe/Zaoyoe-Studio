import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { publicTaskUpdate } from '../public/task-messages.js';

// Real modules and handlers, isolated clock and environment. No .env, service or database.
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function snippet(start, end) {
    const from = server.indexOf(start), to = server.indexOf(end, from);
    if (from < 0 || to < 0) throw new Error(`Missing handler: ${start}`);
    return server.slice(from, to);
}
function tokenHarness() {
    const env = { KC_SESSION_ENCRYPTION_KEY: 'offline-task-access-key-32-bytes-long' };
    const clock = { now: Date.parse('2026-11-08T08:00:00Z') };
    class Clock extends Date { static now() { return clock.now; } }
    const session = { exports: {} }, task = { exports: {} };
    const base = { Buffer, Date: Clock, process: { env } };
    vm.runInNewContext(fs.readFileSync(new URL('../session-security.js', import.meta.url), 'utf8'), {
        ...base, module: session, require: name => { if (name === 'crypto') return crypto; throw new Error(name); }
    });
    vm.runInNewContext(fs.readFileSync(new URL('../task-access.js', import.meta.url), 'utf8'), {
        ...base, module: task, require: name => {
            if (name === 'crypto') return crypto;
            if (name === './session-security') return session.exports;
            throw new Error(name);
        }
    });
    return { ...task.exports, env, clock };
}
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function deliveryHarness() {
    const auth = tokenHarness(), callbacks = {};
    const ws = { readyState: 1, send: vi.fn(), on: (name, callback) => { callbacks[name] = callback; } };
    const store = { getTaskStatus: vi.fn(async () => ({ status: 'running', progress: 10 })) };
    const context = {
        taskClients: new Map(), interactiveCaptchaMap: new Map(), store,
        WebSocket: { OPEN: 1 }, publicTaskUpdate, TERMINAL_TASK_STATUSES: new Set(['success', 'failed', 'manual']),
        verifyTaskAccessToken: auth.verifyTaskAccessToken, isCheckoutDiagnosticJob: vi.fn(async () => false),
        notifyCaptchaClick: vi.fn(() => true), notifyCaptchaDrag: vi.fn(() => true),
        WS_HEARTBEAT_PING_TYPE: 'ping', WS_HEARTBEAT_PONG_TYPE: 'pong',
        console: { log() {}, error: vi.fn() },
        wss: { on: (name, callback) => { if (name === 'connection') callback(ws); } }
    };
    vm.runInNewContext(snippet('function broadcastToTask(', '// In-memory state for interactive'), context);
    vm.runInNewContext(snippet('function unsubscribeTaskClient(', 'function logTask('), context);
    vm.runInNewContext(snippet("    wss.on('connection', (ws) => {", '\n}\n\nif (process.env.IS_PRODUCT_FLOW'), context);
    const tokens = { A: auth.issueTaskAccessToken('job-A'), B: auth.issueTaskAccessToken('job-B') };
    const message = value => callbacks.message(JSON.stringify(value));
    const subscribe = (key = 'A', token = tokens[key]) => message({ type: 'subscribe', jobKey: `job-${key}`, taskAccessToken: token });
    return { auth, ws, store, context, tokens, message, subscribe, close: () => { ws.readyState = 3; callbacks.close(); } };
}
const captcha = (type, token) => ({ type, jobKey: 'job-A', taskAccessToken: token,
    ratioX: 0.3, ratioY: 0.4, startRatioX: 0.1, startRatioY: 0.2, endRatioX: 0.5, endRatioY: 0.6, frameSeq: 7 });

describe('public task capability integrity', () => {
    it('binds to one job and expires at the exact deadline', () => {
        const auth = tokenHarness(), token = auth.issueTaskAccessToken('job-A');
        expect(auth.verifyTaskAccessToken('job-A', token)).toBe(true);
        expect(auth.verifyTaskAccessToken('job-B', token)).toBe(false);
        auth.clock.now += auth.TASK_ACCESS_TTL_MS - 1;
        expect(auth.verifyTaskAccessToken('job-A', token)).toBe(true);
        auth.clock.now++;
        expect(auth.verifyTaskAccessToken('job-A', token)).toBe(false);
    });
    it.each(['', null, 'v1.123.bad', 'x'.repeat(5000), [], {}, 123])('rejects malformed token %j', token => {
        expect(tokenHarness().verifyTaskAccessToken('job-A', token)).toBe(false);
    });
    it('rejects signature changes, appended segments and signed future tokens beyond the lifetime', () => {
        const auth = tokenHarness(), token = auth.issueTaskAccessToken('job-A'), parts = token.split('.');
        parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
        expect(auth.verifyTaskAccessToken('job-A', parts.join('.'))).toBe(false);
        expect(auth.verifyTaskAccessToken('job-A', `${token}.extra`)).toBe(false);
        expect(auth.verifyTaskAccessToken('job-A', auth.issueTaskAccessToken('job-A', auth.clock.now + 1))).toBe(false);
    });
    it.each(['', 'a\nb', '../job', 'a'.repeat(129), null])('rejects invalid task identity %j', job => {
        const auth = tokenHarness();
        expect(() => auth.issueTaskAccessToken(job)).toThrow();
        expect(auth.verifyTaskAccessToken(job, auth.issueTaskAccessToken('job-A'))).toBe(false);
    });
    it('fails closed when the key is missing or rotated', () => {
        const auth = tokenHarness(), token = auth.issueTaskAccessToken('job-A');
        auth.env.KC_SESSION_ENCRYPTION_KEY = 'another-offline-task-access-key-32-bytes';
        expect(auth.verifyTaskAccessToken('job-A', token)).toBe(false);
        delete auth.env.KC_SESSION_ENCRYPTION_KEY;
        expect(auth.verifyTaskAccessToken('job-A', token)).toBe(false);
        expect(() => auth.issueTaskAccessToken('job-A')).toThrow();
    });
});

describe('authenticated task delivery', () => {
    it('delivers only the public field allowlist from persisted rows and live updates', async () => {
        const h = deliveryHarness();
        const privateRow = { status: 'failed', progress: 10, message: 'Bearer private-token', cdk_code: 'private-cdk',
            cardNumber: 'private-card', phone: 'private-phone', output: 'private-output', media: ['private-media'],
            screenshots: ['private-screen'], videos: ['private-video'] };
        h.store.getTaskStatus.mockResolvedValue(privateRow);
        await h.subscribe();
        h.context.broadcastToTask('job-A', { type: 'status', jobKey: 'job-A', ...privateRow });
        expect(h.ws.send).toHaveBeenCalledTimes(2);
        for (const [encoded] of h.ws.send.mock.calls) {
            expect(encoded).not.toContain('private-');
            expect(Object.keys(JSON.parse(encoded))).toEqual(expect.arrayContaining(['type', 'jobKey', 'status', 'progress', 'message']));
            expect(Object.keys(JSON.parse(encoded)).every(key => ['type', 'jobKey', 'status', 'progress', 'message', 'completed', 'paymentState', 'recoveryRequired'].includes(key))).toBe(true);
        }
        expect(privateRow.message).toBe('Bearer private-token');
    });
    it('removes expired subscriptions before broadcasting CAPTCHA or status data', async () => {
        const h = deliveryHarness(); await h.subscribe(); h.ws.send.mockClear();
        h.auth.clock.now += h.auth.TASK_ACCESS_TTL_MS;
        h.context.broadcastToTask('job-A', { type: 'captcha_interactive_required', image: 'private-image' });
        expect(h.ws.send).not.toHaveBeenCalled(); expect(h.ws.taskAccess).toBeNull();
        expect(h.context.taskClients.has('job-A')).toBe(false);
    });
    it.each(['expires', 'switches', 'closes'])('does not send a stale snapshot when authorization %s during database wait', async reason => {
        const h = deliveryHarness(); await h.subscribe(); h.ws.send.mockClear();
        const pending = deferred(); h.store.getTaskStatus.mockReturnValueOnce(pending.promise);
        const request = h.context.sendTaskSnapshot(h.ws, 'job-A');
        if (reason === 'expires') h.auth.clock.now += h.auth.TASK_ACCESS_TTL_MS;
        if (reason === 'switches') await h.subscribe('B');
        if (reason === 'closes') h.close();
        h.ws.send.mockClear(); pending.resolve({ status: 'success', message: 'private-output' }); await request;
        expect(h.ws.send).not.toHaveBeenCalled();
    });
});

describe('WebSocket task authorization races', () => {
    it('refuses cross-job or missing tokens before any store lookup', async () => {
        const h = deliveryHarness(); await h.subscribe('A', h.tokens.B);
        expect(h.context.isCheckoutDiagnosticJob).not.toHaveBeenCalled(); expect(h.store.getTaskStatus).not.toHaveBeenCalled();
        expect(h.ws.taskAccess).toBeNull(); await h.message(captcha('captcha_click', h.tokens.A));
        expect(h.context.notifyCaptchaClick).not.toHaveBeenCalled();
    });
    it.each(['switches', 'invalidates', 'expires', 'closes'])('cannot restore an old subscription when the client %s during diagnostic lookup', async reason => {
        const h = deliveryHarness(), pending = deferred(); h.context.isCheckoutDiagnosticJob.mockReturnValueOnce(pending.promise);
        const request = h.subscribe();
        if (reason === 'switches') await h.subscribe('B');
        if (reason === 'invalidates') await h.subscribe('A', 'invalid');
        if (reason === 'expires') h.auth.clock.now += h.auth.TASK_ACCESS_TTL_MS;
        if (reason === 'closes') h.close();
        pending.resolve(false); await request;
        expect(h.context.taskClients.has('job-A')).toBe(false);
        expect(h.ws.taskAccess?.jobKey).toBe(reason === 'switches' ? 'job-B' : undefined);
    });
    it('immediately revokes an existing subscription if a replacement credential is invalid', async () => {
        const h = deliveryHarness(); await h.subscribe(); await h.subscribe('B', 'invalid'); h.ws.send.mockClear();
        h.context.broadcastToTask('job-A', { type: 'status', status: 'running' });
        expect(h.ws.send).not.toHaveBeenCalled(); expect(h.ws.taskAccess).toBeNull();
    });
    it('does not replay CAPTCHA state after a snapshot lookup if the task changed', async () => {
        const h = deliveryHarness(), pending = deferred(), snapshotStarted = deferred();
        h.context.interactiveCaptchaMap.set('job-A', { active: true, image: 'private-old-captcha' });
        h.store.getTaskStatus.mockImplementationOnce(() => { snapshotStarted.resolve(); return pending.promise; });
        const request = h.subscribe(); await snapshotStarted.promise;
        expect(h.store.getTaskStatus).toHaveBeenCalledWith('job-A'); await h.subscribe('B'); h.ws.send.mockClear();
        pending.resolve({ status: 'running' }); await request; expect(h.ws.send).not.toHaveBeenCalled();
    });
    it.each(['captcha_click', 'captcha_drag'])('accepts a current authorized %s but refuses a different token', async type => {
        const h = deliveryHarness(); await h.subscribe();
        const notify = type === 'captcha_click' ? h.context.notifyCaptchaClick : h.context.notifyCaptchaDrag;
        await h.message(captcha(type, h.tokens.B)); expect(notify).not.toHaveBeenCalled();
        await h.message(captcha(type, h.tokens.A)); expect(notify).toHaveBeenCalledOnce();
        expect(notify.mock.calls[0][0]).toBe('job-A');
    });
    it.each(['captcha_click', 'captcha_drag'].flatMap(type => ['switches', 'resubscribes', 'expires', 'closes'].map(reason => [type, reason])))('cancels %s when authorization %s during lookup', async (type, reason) => {
        const h = deliveryHarness(); await h.subscribe(); const pending = deferred();
        h.context.isCheckoutDiagnosticJob.mockReturnValueOnce(pending.promise);
        const request = h.message(captcha(type, h.tokens.A));
        if (reason === 'switches') await h.subscribe('B');
        if (reason === 'resubscribes') await h.subscribe('A');
        if (reason === 'expires') h.auth.clock.now += h.auth.TASK_ACCESS_TTL_MS;
        if (reason === 'closes') h.close();
        pending.resolve(false); await request;
        expect(h.context.notifyCaptchaClick).not.toHaveBeenCalled(); expect(h.context.notifyCaptchaDrag).not.toHaveBeenCalled();
    });
    it('keeps diagnostic tasks and lookup failures inaccessible', async () => {
        const h = deliveryHarness(); h.context.isCheckoutDiagnosticJob.mockResolvedValueOnce(true);
        await h.subscribe(); expect(h.ws.taskAccess).toBeNull();
        h.context.isCheckoutDiagnosticJob.mockRejectedValueOnce(new Error('offline store unavailable'));
        await h.subscribe(); expect(h.ws.taskAccess).toBeNull();
        expect(h.context.taskClients.size).toBe(0); expect(h.store.getTaskStatus).not.toHaveBeenCalled();
    });
});

describe('HTTP CAPTCHA authorization at time of use', () => {
    it.each(['click', 'drag'].flatMap(kind => ['valid', 'expires', 'invalid', 'diagnostic', 'store-failure'].map(reason => [kind, reason])))('checks %s for %s state without doing unauthorized work', async (kind, reason) => {
        const auth = tokenHarness(), pending = deferred();
        const context = { verifyTaskAccessToken: auth.verifyTaskAccessToken, isCheckoutDiagnosticJob: vi.fn(() => pending.promise),
            notifyCaptchaClick: vi.fn(() => true), notifyCaptchaDrag: vi.fn(() => true) };
        vm.runInNewContext(snippet('function publicCaptchaHandler(', "app.post('/api/public/task/"), context);
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
        const request = context.publicCaptchaHandler(kind)({ params: { jobKey: 'job-A' }, body: {
            taskAccessToken: reason === 'invalid' ? auth.issueTaskAccessToken('job-B') : auth.issueTaskAccessToken('job-A') } }, res);
        if (reason === 'expires') auth.clock.now += auth.TASK_ACCESS_TTL_MS;
        if (reason === 'store-failure') pending.reject(new Error('offline lookup failed')); else pending.resolve(reason === 'diagnostic');
        await request;
        expect(res.statusCode).toBe(reason === 'valid' ? 200 : reason === 'store-failure' ? 503 : 403);
        expect(context.notifyCaptchaClick.mock.calls.length + context.notifyCaptchaDrag.mock.calls.length).toBe(reason === 'valid' ? 1 : 0);
        if (reason === 'invalid') expect(context.isCheckoutDiagnosticJob).not.toHaveBeenCalled();
    });
});
