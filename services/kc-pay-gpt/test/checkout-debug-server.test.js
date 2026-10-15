import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import * as sessions from '../session-auth.js';
import * as diagnostics from '../checkout-diagnostic.js';
import * as managerHelpers from '../checkout-debug-manager.js';
import { validateCdkPlan } from '../cdk-plan-catalog.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const jwt = [Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'RS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: ['https://api.openai.com/v1'], scp: ['model.request'],
        exp: Math.floor(Date.now() / 1000) + 3600,
        'https://api.openai.com/auth': { chatgpt_account_id: 'offline', chatgpt_user_id: 'offline' } })).toString('base64url'),
    'offline-signature'].join('.');
const fixtures = [
    { platform: 'chatgpt', planType: 'plus', credential: JSON.stringify({ accessToken: jwt, user: { email: 'offline@example.test' } }) },
    { platform: 'claude', planType: 'claude_pro', credential: 'sessionKey=sk-ant-sid01-' + 'x'.repeat(80) },
    { platform: 'grok', planType: 'grok_bundle_super_annual', credential: 'sso=offline-cookie-fixture; sso-rw=offline-cookie-rw' }
];
const snippet = (start, end) => server.slice(server.indexOf(start), server.indexOf(end, server.indexOf(start)));
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function reportFor(fixture = fixtures[0], extra = {}) {
    const url = fixture.platform === 'chatgpt' ? 'https://chatgpt.com/checkout/offline-link?private=checkout-secret'
        : fixture.platform === 'claude' ? 'https://claude.ai/upgrade/offline-link' : 'https://grok.com/plans';
    const plan = diagnostics.getDiagnosticCatalog().platforms.find(platform => platform.id === fixture.platform).plans.find(plan => plan.id === fixture.planType);
    return { version: 1, platform: fixture.platform, planType: fixture.planType, mode: 'checkout', region: 'US',
        startedAt: '2026-10-14T00:00:00.000Z', finishedAt: '2026-10-14T00:00:01.000Z', elapsedMs: 1000,
        phase: 'complete', paymentSubmitted: false, success: true, code: '', message: '检查完成，未提交支付',
        checks: [{ id: 'session', label: '官方登录', status: 'passed', message: '官方会话有效' },
            { id: 'product', label: '商品', status: 'passed', message: '商品匹配' },
            { id: 'form', label: '表单', status: 'passed', message: '表单就绪', durationMs: 500 },
            ...['amount', 'currency', 'interval'].map(id => ({ id, label: id, status: 'passed', message: 'Observed value matches' }))],
        checkout: { url, kind: 'hosted', confirmed: true, product: plan.label, amount: plan.amount, currency: 'USD',
            expectedAmount: plan.amount, expectedCurrency: 'USD', interval: plan.interval, expiresAt: null }, ...extra };
}
const outputFor = report => `diagnostic offline log\nCHECKOUT_DIAGNOSTIC:${JSON.stringify(report)}\n`;

function harness({ pool = false, queued = false, overrides = {} } = {}) {
    const routes = new Map(), tasks = new Map(), children = [];
    const forbidden = Object.fromEntries(['hasAvailableCard', 'reserveCardAsset', 'markCdkUsed', 'markCdkUnused',
        'verifyCdkDetails', 'releaseCardAsset', 'insertBillingRecord', 'updateBillingRecord', 'resetAllAssetLocks']
        .map(name => [name, vi.fn(() => { throw new Error(`Forbidden payment call ${name}`); })]));
    const store = { ...forbidden,
        getPaymentRegion: vi.fn(async () => 'US'),
        getMaintenanceModeState: vi.fn(async () => ({ enabled: false })),
        getMaxConcurrentActivations: vi.fn(async () => 2),
        getGptApiConfig: vi.fn(async () => ({ enabled: true, api_key: 'offline-config-key' })),
        getActiveProxy: vi.fn(async () => ''), getHcaptchaConfig: vi.fn(async () => ({})),
        getTaskStatus: vi.fn(async key => tasks.get(key)),
        createTaskLog: vi.fn(async input => {
            const jobKey = `offline-${tasks.size + 1}`;
            tasks.set(jobKey, { job_key: jobKey, status: input.status, progress: input.progress,
                execution_mode: input.executionMode, raw_output: '' });
            return { jobKey };
        }),
        updateTaskLog: vi.fn(async (key, value) => {
            const task = tasks.get(key);
            if (task) Object.assign(task, value, {
                raw_output: value.rawOutput ?? task.raw_output,
                execution_mode: value.executionMode ?? task.execution_mode,
                failure_screenshots: value.failureScreenshots ? JSON.stringify(value.failureScreenshots) : task.failure_screenshots
            });
        }),
        runQuery: vi.fn(async (sql, params) => {
            const rows = [...tasks.values()].filter(task => task.execution_mode === 'checkout_diagnostic');
            if (sql.includes('COUNT(*)')) return [{ total: rows.length }];
            if (sql.includes('job_key = ?')) return rows.filter(task => task.job_key === params[0]);
            return rows.slice(params[2], params[2] + params[1]);
        }), ...overrides
    };
    const requireSecondaryAuth = vi.fn((_req, _res, next) => next());
    const checkoutDebugManager = managerHelpers.createCheckoutDebugManager();
    let queueCallback = null;
    const browserPool = {
        getRuntimeEnabled: () => pool,
        withBrowserSlot: vi.fn((key, fn, signal) => {
            if (!queued) return fn({ slotId: 1, cdpUrl: 'http://offline.test:19222' });
            queueCallback = () => fn({ slotId: 1, cdpUrl: 'http://offline.test:19222' });
            return new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => reject(Object.assign(new Error('Browser wait cancelled'), { code: 'BROWSER_POOL_CANCELLED' })), { once: true });
            });
        })
    };
    const context = { ...sessions, ...diagnostics, ...managerHelpers, validateCdkPlan,
        CHECKOUT_DIAGNOSTIC_MODE: managerHelpers.EXECUTION_MODE, checkoutDebugManager, Buffer, Date, AbortController,
        path, crypto, __dirname: root, process: { env: { CHATGPT_TOKEN: 'inherited-gpt', CHATGPT_SESSION_JSON: 'inherited-gpt-json',
            CLAUDE_SESSION_KEY: 'inherited-claude', GROK_TOKEN: 'inherited-grok', RECORD_VIDEO: '0' } },
        store, browserPool, requireSecondaryAuth, ensureStoreReady: async () => {},
        activeForegroundJobs: new Set(), activeProcesses: new Set(), interactiveCaptchaMap: new Map(),
        notifyCaptchaClick: vi.fn(() => true), notifyCaptchaDrag: vi.fn(() => true), broadcastToTask: vi.fn(),
        buildHcaptchaEnvFromConfig: () => ({ env: {} }), buildWorkerRuntimeEnv: env => env,
        logTask: vi.fn(), logTaskChunk: vi.fn(), getCheckoutProgress: () => 10, analyzeProcessOutput: vi.fn(),
        PROCESS_IDLE_TIMEOUT_MS: 10000, PROCESS_TOTAL_TIMEOUT_MS: 20000,
        setTimeout, clearTimeout, console: { log() {}, error() {}, warn() {} },
        app: { get: (route, ...handlers) => routes.set(`GET ${route}`, handlers),
            post: (route, ...handlers) => routes.set(`POST ${route}`, handlers) },
        spawn: vi.fn((_command, _args, options) => {
            const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
            child.env = options.env;
            child.kill = vi.fn(signal => { Promise.resolve().then(() => child.emit('close', null, signal)); return true; });
            children.push(child); return child;
        })
    };
    vm.runInNewContext(snippet('function reserveForegroundSlot(', 'function sleep('), context);
    vm.runInNewContext(snippet('function decodeJwtPart(', 'const verifyPassword'), context);
    vm.runInNewContext(snippet('function extractScreenshotsFromOutput(', 'function extractCheckoutUrlFromOutput('), context);
    vm.runInNewContext(snippet('function runCheckoutScript(', "app.get('/admin'"), context);
    vm.runInNewContext(snippet('function checkoutDiagnosticResponse(', '// ─── Card Pool Management API'), context);
    vm.runInNewContext(snippet('async function spawnWorkerWithBrowser(', 'async function runGptApiWorker('), context);
    vm.runInNewContext(snippet("app.post('/api/public/task/:jobKey/captcha-click'", "app.use('/api/admin', authenticateAdmin)"), context);
    vm.runInNewContext(snippet("app.post('/api/public/task/:jobKey/captcha-drag'", "app.post('/api/public/probe-account'"), context);
    async function request(method, route, { body = {}, params = {}, query = {} } = {}) {
        const handlers = routes.get(`${method} ${route}`);
        if (!handlers) throw new Error(`Missing route ${method} ${route}`);
        const response = { statusCode: 200, value: null,
            status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return this; } };
        await handlers.at(-1)({ body, params, query, admin: { email: 'offline-admin@example.test' } }, response);
        await flush(); return response;
    }
    const generate = (fixture = fixtures[0], extra = {}) => request('POST', '/api/admin/checkout/generate', {
        body: { platform: fixture.platform, plan_type: fixture.planType, country: 'US', mode: 'checkout', session: fixture.credential, ...extra }
    });
    async function finish(report = reportFor(), { output = outputFor(report), code = 0 } = {}) {
        await flush();
        const child = children.at(-1);
        if (!child) throw new Error('No child created');
        const entry = checkoutDebugManager.get([...tasks.keys()].at(-1));
        child.stdout.emit('data', Buffer.from(output)); child.emit('close', code, null);
        if (entry) await entry.promise; await flush();
    }
    return { context, store, routes, tasks, children, browserPool, manager: checkoutDebugManager, forbidden,
        request, generate, finish, requireSecondaryAuth, queuedCallback: () => queueCallback?.() };
}

afterEach(() => vi.useRealTimers());

describe('authenticated checkout diagnostics routes with isolated storage and children', () => {
    it.each(fixtures)('routes $platform credentials without a payment/card/CDK operation', async fixture => {
        const h = harness(); const response = await h.generate(fixture);
        expect(response.value).toMatchObject({ success: true, jobKey: 'offline-1' });
        const env = h.children[0].env;
        expect(env).toMatchObject({ PLATFORM: fixture.platform, CDK_PLAN_TYPE: fixture.planType,
            CDK_CODE: '', CHECKOUT_DEBUG_ONLY: '1', CHECKOUT_DIAGNOSTIC_MODE: 'checkout', CHECKOUT_MODE: 'auto',
            JOB_KEY: 'offline-1', RECORD_VIDEO: '1', PAYMENT_REGION_OVERRIDE: 'US' });
        const expected = fixture.platform === 'chatgpt' ? { CHATGPT_TOKEN: jwt, CHATGPT_SESSION_JSON: fixture.credential, CLAUDE_SESSION_KEY: '', GROK_TOKEN: '' }
            : fixture.platform === 'claude' ? { CHATGPT_TOKEN: '', CHATGPT_SESSION_JSON: '', CLAUDE_SESSION_KEY: fixture.credential, GROK_TOKEN: '' }
                : { CHATGPT_TOKEN: '', CHATGPT_SESSION_JSON: '', CLAUDE_SESSION_KEY: '', GROK_TOKEN: fixture.credential };
        expect(env).toMatchObject(expected);
        expect(h.store.createTaskLog).toHaveBeenCalledWith(expect.objectContaining({ executionMode: 'checkout_diagnostic', paymentState: 'not_started' }));
        await h.finish(reportFor(fixture));
        for (const method of Object.values(h.forbidden)) expect(method).not.toHaveBeenCalled();
        expect(h.context.analyzeProcessOutput).not.toHaveBeenCalled();
        expect(h.context.logTaskChunk).not.toHaveBeenCalled();
    });

    it('returns the canonical platform catalog and the actual configured recharge mode without secrets', async () => {
        const h = harness(); const response = await h.request('GET', '/api/admin/checkout/plans');
        expect(response.value).toMatchObject({ success: true, version: 1, defaultRegion: 'US', configuredRechargeMode: 'third_party_api', scope: 'local_card_pool' });
        expect(response.value.platforms.map(platform => platform.id)).toEqual(['chatgpt', 'claude', 'grok']);
        expect(JSON.stringify(response.value)).not.toContain('offline-config-key');
    });

    it('requires normal admin auth and secondary auth for credentials and diagnostic records', () => {
        const h = harness();
        expect(server.indexOf("app.use('/api/admin', authenticateAdmin)")).toBeLessThan(server.indexOf("app.post('/api/admin/checkout/generate'"));
        for (const route of ['POST /api/admin/checkout/generate', 'GET /api/admin/checkout/status/:jobKey',
            'GET /api/admin/checkout/history', 'POST /api/admin/checkout/cancel/:jobKey',
            'POST /api/admin/checkout/captcha-click/:jobKey', 'POST /api/admin/checkout/captcha-drag/:jobKey']) {
            expect(h.routes.get(route)[0]).toBe(h.requireSecondaryAuth);
        }
        for (const route of ["app.get('/api/admin/screenshots', requireSecondaryAuth", "app.get('/api/admin/video', requireSecondaryAuth",
            "app.get('/api/admin/screenshots/:subdir/:filename', requireSecondaryAuth"]) expect(server).toContain(route);
    });

    it('deduplicates simultaneous request_id submissions and rejects conflicting inputs', async () => {
        const h = harness();
        const responses = await Promise.all([h.generate(fixtures[0], { request_id: 'offline-request' }), h.generate(fixtures[0], { request_id: 'offline-request' })]);
        expect(h.store.createTaskLog).toHaveBeenCalledOnce(); expect(h.children).toHaveLength(1);
        expect(responses[0].value.jobKey).toBe(responses[1].value.jobKey);
        expect(responses.some(response => response.value.reused === true)).toBe(true);
        const conflict = await h.generate(fixtures[0], { request_id: 'offline-request', plan_type: 'pro_100' });
        expect(conflict.statusCode).toBe(409); expect(conflict.value.code).toBe('DIAGNOSTIC_REQUEST_CONFLICT');
        await h.finish();
    });

    it('rejects maintenance and shared capacity limits before task creation', async () => {
        for (const options of [{ getMaintenanceModeState: async () => ({ enabled: true }) }, { getMaxConcurrentActivations: async () => 1 }]) {
            const h = harness({ overrides: options });
            if (!options.getMaintenanceModeState) h.context.activeForegroundJobs.add('formal-existing-job');
            const response = await h.generate();
            expect(response.statusCode).toBe(options.getMaintenanceModeState ? 503 : 429);
            expect(h.store.createTaskLog).not.toHaveBeenCalled(); expect(h.children).toHaveLength(0);
        }
    });

    it('reserves a shared slot before asynchronous task creation to prevent concurrent diagnostic oversubscription', async () => {
        const h = harness({ overrides: { getMaxConcurrentActivations: async () => 1 } });
        const responses = await Promise.all([h.generate(fixtures[0], { request_id: 'one' }), h.generate(fixtures[0], { request_id: 'two' })]);
        expect(responses.map(response => response.statusCode).sort()).toEqual([200, 429]);
        expect(h.store.createTaskLog).toHaveBeenCalledOnce();
        expect(h.context.activeForegroundJobs.size).toBe(1); await h.finish(); expect(h.context.activeForegroundJobs.size).toBe(0);
    });

    it('releases the reservation when task creation fails', async () => {
        const h = harness({ overrides: { createTaskLog: async () => { throw new Error('Offline storage failure'); } } });
        const response = await h.generate(); expect(response.statusCode).toBe(500);
        expect(h.context.activeForegroundJobs.size).toBe(0); expect(h.children).toHaveLength(0);
    });

    it('rejects invalid cross-platform, retired, mismatched-region and credential input before dispatch', async () => {
        const h = harness();
        for (const body of [{ platform: 'claude', plan_type: 'plus' }, { platform: 'grok', plan_type: 'supergrok' },
            { country: 'US', region: 'PH' }, { session: 'invalid-private-input' }, { platform: 'claude', plan_type: 'claude_pro', session: fixtures[1].credential, mode: 'link' }]) {
            const response = await h.generate(fixtures[0], body); expect(response.statusCode).toBe(400);
        }
        expect(h.store.createTaskLog).not.toHaveBeenCalled(); expect(h.children).toHaveLength(0);
    });

    it('persists successful reports without the undefined finalPaymentState regression and exposes sanitized status', async () => {
        const h = harness(); await h.generate(); await h.finish(reportFor(), { output: outputFor(reportFor()) +
            'SUCCESS_SCREENSHOT:/offline/debug_screenshots/diagnostics/offline.png\nVIDEO_FILE:/offline/debug_screenshots/diagnostics/offline.webm\n' });
        const task = h.tasks.get('offline-1'); expect(task.status).toBe('success');
        expect(task.message).not.toContain('finalPaymentState'); expect(task.paymentState).toBe('not_started'); expect(task.recoveryRequired).toBe(false);
        const response = await h.request('GET', '/api/admin/checkout/status/:jobKey', { params: { jobKey: 'offline-1' } });
        expect(response.value).toMatchObject({ success: true, status: 'success', progress: 100,
            checkout_url: reportFor().checkout.url, screenshots: ['diagnostics/offline.png'], videos: ['diagnostics/offline.webm'] });
        expect(response.value.report).toMatchObject({ paymentSubmitted: false, success: true });
        expect(response.value.stages).toHaveLength(6); expect(response.value.checks).toHaveLength(6);
        expect(response.value.raw_output).not.toContain('CHECKOUT_DIAGNOSTIC:'); expect(response.value.raw_output).not.toContain('checkout-secret');
        expect(h.context.activeProcesses.size).toBe(0); expect(h.context.activeForegroundJobs.size).toBe(0);
    });

    it('saves useful running output and redacts full lines without leaking credentials split across chunks', async () => {
        vi.useFakeTimers();
        const h = harness(); await h.generate(); const child = h.children[0];
        const report = reportFor(fixtures[0], { success: false, finishedAt: undefined, phase: 'form', checks: [
            { id: 'session', label: '登录', status: 'passed', message: '有效' }, { id: 'form', label: '表单', status: 'running', message: '检查中' }] });
        child.stdout.emit('data', Buffer.from(outputFor(report) + `token=${jwt.slice(0, 18)}`)); await flush();
        expect(h.tasks.get('offline-1').raw_output).not.toContain(jwt.slice(0, 18));
        child.stdout.emit('data', Buffer.from(jwt.slice(18) + '\nHTTP request failed at https://private.test/secret\nsso=offline-cookie-fixture\n'));
        await vi.advanceTimersByTimeAsync(501); await flush();
        const raw = h.tasks.get('offline-1').raw_output;
        expect(raw).toContain('HTTP request failed'); expect(raw).toContain('[URL_REDACTED]');
        expect(raw).not.toContain(jwt); expect(raw).not.toContain('offline-cookie-fixture');
        expect(h.tasks.get('offline-1').progress).toBeGreaterThan(1);
        await h.finish(reportFor());
    });

    it('coalesces verbose running logs while persisting changed reports immediately and always flushing the terminal output', async () => {
        vi.useFakeTimers(); const h = harness(); await h.generate(); const child = h.children[0];
        const report = reportFor(fixtures[0], { success: false, phase: 'browser', finishedAt: undefined,
            checks: [{ id: 'browser', label: '浏览器', status: 'running', message: '' }] });
        child.stdout.emit('data', Buffer.from(outputFor(report))); await flush();
        const before = h.store.updateTaskLog.mock.calls.length;
        for (let i = 0; i < 100; i++) child.stdout.emit('data', Buffer.from(`offline verbose line ${i}\n`));
        await flush(); expect(h.store.updateTaskLog.mock.calls.length).toBe(before);
        await vi.advanceTimersByTimeAsync(501); await flush();
        expect(h.store.updateTaskLog.mock.calls.length).toBe(before + 1);
        expect(h.tasks.get('offline-1').raw_output).toContain('offline verbose line 99');
        child.stdout.emit('data', Buffer.from(outputFor({ ...report, checks: [{ id: 'browser', label: '浏览器', status: 'passed', message: '' }] })));
        await flush(); expect(h.store.updateTaskLog.mock.calls.length).toBe(before + 2);
        const entry = h.manager.get('offline-1');
        child.stdout.emit('data', Buffer.from(outputFor(reportFor()) + 'last terminal log without a newline'));
        child.emit('close', 0, null); await entry.promise;
        expect(h.tasks.get('offline-1').status).toBe('success');
        expect(h.tasks.get('offline-1').raw_output).toContain('last terminal log without a newline');
    });

    it.each([
        { title: 'nonzero child exit', output: outputFor(reportFor()), code: 1, expected: 'DIAGNOSTIC_PROCESS_FAILED' },
        { title: 'legacy-only success markers', output: 'PAYMENT_SUCCESS\nCHECKOUT_DEBUG_SUCCESS\nCHECKOUT_URL:https://chatgpt.com/checkout/offline\n', code: 0, expected: 'DIAGNOSTIC_REPORT_MISSING' },
        { title: 'explicit failed report', output: outputFor(reportFor(fixtures[0], { success: false, code: 'AUTH_REJECTED', message: '登录无效' })), code: 1, expected: 'AUTH_REJECTED' },
        { title: 'report from a different plan', output: outputFor(reportFor(fixtures[0], { planType: 'pro_100' })), code: 0, expected: 'DIAGNOSTIC_REPORT_MISSING' }
    ])('fails safely for $title', async scenario => {
        const h = harness(); await h.generate(); await h.finish(undefined, scenario);
        const task = h.tasks.get('offline-1'); expect(task.status).toBe('failed');
        expect(diagnostics.parseDiagnosticOutput(task.raw_output)).toMatchObject({ success: false, code: scenario.expected, paymentSubmitted: false });
    });

    it('terminates and records timeout independently of worker success text', async () => {
        vi.useFakeTimers(); const h = harness(); await h.generate();
        const child = h.children[0], entry = h.manager.get('offline-1');
        await vi.advanceTimersByTimeAsync(10001); await entry.promise;
        expect(child.kill).toHaveBeenCalledWith('SIGTERM'); expect(h.tasks.get('offline-1').status).toBe('failed');
        expect(diagnostics.parseDiagnosticOutput(h.tasks.get('offline-1').raw_output)).toMatchObject({ code: 'DIAGNOSTIC_TIMEOUT', success: false });
        expect(h.context.activeForegroundJobs.size).toBe(0);
    });

    it('cancels an active child and persists a terminal cancelled report', async () => {
        const h = harness(); await h.generate(); const child = h.children[0];
        const response = await h.request('POST', '/api/admin/checkout/cancel/:jobKey', { params: { jobKey: 'offline-1' } });
        expect(response.value).toMatchObject({ success: true, cancelled: true }); expect(child.kill).toHaveBeenCalledWith('SIGTERM');
        expect(h.tasks.get('offline-1').status).toBe('cancelled');
        expect(diagnostics.parseDiagnosticOutput(h.tasks.get('offline-1').raw_output)).toMatchObject({ code: 'DIAGNOSTIC_CANCELLED', success: false });
        expect(h.manager.has('offline-1')).toBe(false); expect(h.context.activeForegroundJobs.size).toBe(0);
        const again = await h.request('POST', '/api/admin/checkout/cancel/:jobKey', { params: { jobKey: 'offline-1' } });
        expect(again.value.cancelled).toBe(false);
    });

    it('cancels a queued browser job and prevents child creation even if a stale callback receives a slot', async () => {
        const h = harness({ pool: true, queued: true }); await h.generate();
        expect(h.children).toHaveLength(0); expect(h.browserPool.withBrowserSlot).toHaveBeenCalledWith('offline-1', expect.any(Function), expect.any(AbortSignal));
        const response = await h.request('POST', '/api/admin/checkout/cancel/:jobKey', { params: { jobKey: 'offline-1' } });
        expect(response.value.cancelled).toBe(true); expect(h.tasks.get('offline-1').status).toBe('cancelled');
        await expect(h.queuedCallback()).rejects.toMatchObject({ code: 'DIAGNOSTIC_CANCELLED' });
        expect(h.children).toHaveLength(0); expect(h.context.activeForegroundJobs.size).toBe(0);
    });

    it('filters paginated history and status by execution_mode without returning session payloads', async () => {
        const h = harness(); await h.generate(); await h.finish();
        h.tasks.set('formal-1', { job_key: 'formal-1', execution_mode: 'local_card_pool', session_payload: 'private-formal-session' });
        const response = await h.request('GET', '/api/admin/checkout/history', { query: { page: '1', limit: '2' } });
        expect(response.value).toMatchObject({ success: true, total: 1, page: 1, limit: 2 }); expect(response.value.tasks).toHaveLength(1);
        const historyCall = h.store.runQuery.mock.calls.find(([sql]) => sql.includes('OFFSET'));
        expect(historyCall[0]).toContain('WHERE execution_mode = ?'); expect(historyCall[1]).toEqual(['checkout_diagnostic', 2, 0]);
        expect(JSON.stringify(response.value)).not.toContain('private-formal-session');
        const status = await h.request('GET', '/api/admin/checkout/status/:jobKey', { params: { jobKey: 'formal-1' } });
        expect(status.statusCode).toBe(404);
    });

    it('provides diagnostic CAPTCHA only through authenticated status and admin interaction endpoints', async () => {
        const h = harness(); await h.generate();
        h.context.interactiveCaptchaMap.set('offline-1', { active: true, image: 'data:image/png;base64,offline',
            frameSeq: 7, width: 400, height: 300, promptEn: 'Choose images', contentReady: true });
        const status = await h.request('GET', '/api/admin/checkout/status/:jobKey', { params: { jobKey: 'offline-1' } });
        expect(status.value.captcha).toMatchObject({ active: true, image: 'data:image/png;base64,offline', frameSeq: 7 });
        const click = await h.request('POST', '/api/admin/checkout/captcha-click/:jobKey', {
            params: { jobKey: 'offline-1' }, body: { ratioX: 0.3, ratioY: 0.2, frameSeq: 7 } });
        expect(click.value.handled).toBe(true);
        expect(h.context.notifyCaptchaClick).toHaveBeenCalledWith('offline-1', expect.objectContaining({ ratioX: 0.3, ratioY: 0.2, frameSeq: 7 }));
        const drag = await h.request('POST', '/api/admin/checkout/captcha-drag/:jobKey', {
            params: { jobKey: 'offline-1' }, body: { fromRatioX: 0.2, fromRatioY: 0.1, toRatioX: 0.5, toRatioY: 0.7, frameSeq: 7 } });
        expect(drag.value.handled).toBe(true);
        const invalid = await h.request('POST', '/api/admin/checkout/captcha-drag/:jobKey', { params: { jobKey: 'offline-1' }, body: {} });
        expect(invalid.statusCode).toBe(400);
        await h.finish(); expect(h.context.interactiveCaptchaMap.has('offline-1')).toBe(false);
    });

    it('rejects diagnostic CAPTCHA from public HTTP endpoints while preserving formal task interaction', async () => {
        const h = harness(); await h.generate();
        for (const route of ['/api/public/task/:jobKey/captcha-click', '/api/public/task/:jobKey/captcha-drag']) {
            const denied = await h.request('POST', route, { params: { jobKey: 'offline-1' }, body: { ratioX: 0.3, ratioY: 0.2, frameSeq: 7 } });
            expect(denied.statusCode).toBe(403);
            const formal = await h.request('POST', route, { params: { jobKey: 'formal-task' }, body: { ratioX: 0.3, ratioY: 0.2, frameSeq: 7 } });
            expect(formal.value).toMatchObject({ success: true, handled: true });
        }
        expect(h.context.notifyCaptchaClick).not.toHaveBeenCalledWith('offline-1', expect.anything());
        expect(h.context.notifyCaptchaDrag).not.toHaveBeenCalledWith('offline-1', expect.anything());
        await h.finish();
    });

    it('blocks public WebSocket diagnostic subscription before snapshots or challenge delivery', async () => {
        const h = harness(); await h.generate();
        h.context.data = { type: 'subscribe', jobKey: 'offline-1' };
        h.context.WebSocket = { OPEN: 1 }; h.context.ws = { readyState: 1, send: vi.fn() };
        h.context.sendTaskSnapshot = vi.fn(); h.context.taskClients = new Map();
        const subscription = snippet("                if (data.type === 'subscribe' && data.jobKey)", "                if (data.type === 'captcha_click' && data.jobKey)");
        vm.runInNewContext('async function inspectWsSubscription() { ' + subscription + ' }', h.context);
        await h.context.inspectWsSubscription();
        expect(h.context.ws.send).toHaveBeenCalledWith(expect.stringContaining('管理员二级验证'));
        expect(h.context.sendTaskSnapshot).not.toHaveBeenCalled(); expect(h.context.taskClients.size).toBe(0);
        await h.finish();
    });

    it('recovers interrupted diagnostics without releasing CDKs or invoking asset recovery', async () => {
        const h = harness(); const task = { job_key: 'offline-stale', execution_mode: 'checkout_diagnostic',
            cdk_code: '[checkout-diagnostic]', raw_output: outputFor(reportFor(fixtures[0], { success: false, checks: [
                { id: 'form', label: '表单', status: 'running', message: '检查中' }] })) };
        expect(await h.context.recoverInterruptedCheckoutDiagnostic(task)).toBe(true);
        const update = h.store.updateTaskLog.mock.calls[0][1]; expect(update).toMatchObject({ status: 'failed', paymentState: 'not_started', recoveryRequired: false });
        expect(diagnostics.parseDiagnosticOutput(update.rawOutput)).toMatchObject({ code: 'DIAGNOSTIC_INTERRUPTED', checks: [{ id: 'form', status: 'failed' }] });
        for (const method of Object.values(h.forbidden)) expect(method).not.toHaveBeenCalled();
        expect(server).toContain('if (await recoverInterruptedCheckoutDiagnostic(staleTask)) continue;');
    });

    it('advances progress by completed phase rather than the number of currently emitted checks', () => {
        expect(managerHelpers.diagnosticProgress({ checks: [{ id: 'browser', status: 'passed' }] })).toBe(5);
        expect(managerHelpers.diagnosticProgress({ checks: [{ id: 'browser', status: 'passed' },
            { id: 'session', status: 'passed' }, { id: 'checkout', status: 'running' }] })).toBe(25);
        expect(managerHelpers.diagnosticProgress({ success: true, checks: [{ id: 'form', status: 'passed' }] })).toBe(100);
        expect(managerHelpers.diagnosticProgress({ success: false, checks: [{ id: 'browser', status: 'passed' },
            { id: 'session', status: 'failed' }] })).toBe(5);
    });

    it('rejects untrusted checkout URLs and redacts tokens, cookies, arbitrary credentials and raw URLs', () => {
        const secret = 'offline-private-credential-with-many-characters';
        const raw = outputFor(reportFor()) + `token=${jwt}\nCookie: sso=private-cookie\n${secret}\nhttps://private.test/checkout?client_secret=private\n`;
        const clean = managerHelpers.redactDiagnosticLogs(raw, [secret]);
        expect(clean).not.toContain(jwt); expect(clean).not.toContain('private-cookie'); expect(clean).not.toContain(secret);
        expect(clean).not.toContain('https://'); expect(clean).not.toContain('CHECKOUT_DIAGNOSTIC:');
        expect(managerHelpers.sanitizeDiagnosticReport(reportFor(fixtures[0], { checkout: { ...reportFor().checkout, url: 'https://evil.test/private' } }))).toBeNull();
    });
});
