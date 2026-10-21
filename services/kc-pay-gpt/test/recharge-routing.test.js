import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { resolveActivationInput, buildActivationCredentialEnv } from '../activation-routing.js';
import { validateOutsourceConfig, canonicalizeOutsourcePlan } from '../gpt-outsourcing.js';
import { validateCdkPlan } from '../cdk-plan-catalog.js';
import * as sessions from '../session-auth.js';
import * as safety from '../task-safety.js';
import { getPlatformForPlan, getRegionConfig, getRegionBrowserProfile } from '../region-config.js';
import { formatTaskErrorMessage } from '../public/task-messages.js';
import { reportTaskFailure } from '../task-diagnostics.js';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const jwt = [Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'RS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: ['https://api.openai.com/v1'],
        scp: ['model.request'], exp: Math.floor(Date.now() / 1000) + 3600,
        'https://api.openai.com/auth': { chatgpt_account_id: 'fixture', chatgpt_user_id: 'fixture' } })).toString('base64url'), 'fixture-signature'].join('.');
const fixtures = [
    { platform: 'grok', planType: 'grok_bundle_super_annual', credential: 'sso=offline-cookie-fixture; sso-rw=offline-cookie-rw' },
    { platform: 'claude', planType: 'claude_pro', credential: 'sessionKey=sk-ant-sid01-' + 'x'.repeat(80) },
    { platform: 'chatgpt', planType: 'plus', credential: JSON.stringify({ accessToken: jwt, user: { email: 'fixture@example.test' } }) }
];
function snippet(start, end) { return server.slice(server.indexOf(start), server.indexOf(end, server.indexOf(start))); }
function handlerHarness(fixture, overrides = {}) {
    const store = {
        getMaintenanceModeState: vi.fn(async () => ({ enabled: false })),
        getMaxConcurrentActivations: vi.fn(async () => 5),
        verifyCdkDetails: vi.fn(async () => ({ type: '自助', used_at: null, platform: fixture.platform, plan_type: fixture.planType })),
        getRunningTaskByCdk: vi.fn(async () => null),
        getGptApiConfig: vi.fn(async () => ({ enabled: true, api_key: 'offline-key',
            base_url: 'https://supplier.example/api', country: 'US', currency: 'USD',
            plan_mapping: { plus: 'plus-monthly', go: 'go-monthly', pro_100: 'pro100-monthly',
                pro_200: 'pro200-monthly', pro_500: 'pro500-monthly' } })),
        hasAvailableCard: vi.fn(async () => true), markCdkUsed: vi.fn(async () => true),
        markCdkUnused: vi.fn(async () => {}), createTaskLog: vi.fn(async () => ({ jobKey: 'fixture-job' })), ...overrides
    };
    const spawnActivationWorker = vi.fn(), runGptApiWorker = vi.fn(async () => {});
    const context = { ...sessions, Buffer, Date, store, ensureStoreReady: async () => {},
        validateOutsourceConfig, canonicalizeOutsourcePlan,
        getClientIp: () => '', getRemainingCooldownMinutes: () => 0, activeForegroundJobs: new Set(),
        resolveActivationInput, formatTaskErrorMessage, redactSensitiveText: s => s,
        logTask: vi.fn(), reserveForegroundSlot: vi.fn(), fireTelegramNotification: vi.fn(),
        spawnActivationWorker, runGptApiWorker, console: { log() {}, error() {} } };
    vm.runInNewContext(snippet('function decodeJwtPart(', 'const verifyPassword'), context);
    const realValidator = context.validateAccessToken;
    context.validateAccessToken = vi.fn(realValidator);
    vm.runInNewContext(snippet('async function handleActivationRequest(', "app.post('/api/run-process'"), context);
    const response = { statusCode: 200, value: null, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return this; } };
    return { store, context, response, spawnActivationWorker, runGptApiWorker,
        request: (body = {}) => context.handleActivationRequest({ path: '/api/run-process', body: { cdk: 'OFFLINE-CDK', platform: fixture.platform, session: fixture.credential, ...body } }, response) };
}

describe('actual activation request platform routing with a mock store', () => {
    it.each(fixtures)('$platform uses only its own credential checks and execution mode', async fixture => {
        const h = handlerHarness(fixture); await h.request();
        expect(h.response.value).toMatchObject({ success: true, jobKey: 'fixture-job' });
        expect(h.store.markCdkUsed).toHaveBeenCalledOnce();
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
        expect(h.context.validateAccessToken).toHaveBeenCalledTimes(fixture.platform === 'chatgpt' ? 1 : 0);
        if (fixture.platform === 'chatgpt') {
            expect(h.runGptApiWorker).toHaveBeenCalledOnce(); expect(h.spawnActivationWorker).not.toHaveBeenCalled();
        } else {
            expect(h.runGptApiWorker).not.toHaveBeenCalled(); expect(h.spawnActivationWorker).toHaveBeenCalledOnce();
            expect(h.spawnActivationWorker.mock.calls[0][0]).toMatchObject({ sessionRaw: fixture.credential,
                task: { platform: fixture.platform, executionMode: 'local_card_pool' } });
        }
        expect(h.store.createTaskLog.mock.calls[0][0].tokenPreview).not.toContain('offline-cookie');
    });
    it('preserves full ChatGPT Session JSON in local mode', async () => {
        const h = handlerHarness(fixtures[2], { getGptApiConfig: async () => ({ enabled: false }) }); await h.request();
        expect(h.spawnActivationWorker.mock.calls[0][0].sessionRaw).toBe(fixtures[2].credential);
    });
    it('fails closed before locking the CDK when the outsourced channel is enabled without an API key', async () => {
        const h = handlerHarness(fixtures[2], {
            getGptApiConfig: async () => ({ enabled: true, api_key: '', base_url: '' })
        });
        await h.request();
        expect(h.response.statusCode).toBe(503);
        expect(h.response.value).toMatchObject({ success: false,
            message: '充值失败，请联系客服处理' });
        expect(h.store.hasAvailableCard).not.toHaveBeenCalled();
        expect(h.store.markCdkUsed).not.toHaveBeenCalled();
        expect(h.store.createTaskLog).not.toHaveBeenCalled();
        expect(h.spawnActivationWorker).not.toHaveBeenCalled();
        expect(h.runGptApiWorker).not.toHaveBeenCalled();
    });
    it.each([
        ['missing API key', { api_key: '' }, 'GPT_OUTSOURCE_CONFIG_INVALID'],
        ['missing endpoint', { base_url: '' }, 'GPT_OUTSOURCE_CONFIG_INVALID'],
        ['mismatched currency', { currency: 'PHP' }, 'GPT_OUTSOURCE_REGION_INVALID'],
        ['unmapped current plan', { plan_mapping: { go: 'go-monthly' } }, 'GPT_OUTSOURCE_MAPPING_MISSING']
    ])('rejects %s before creating an outsourced task or routing to local payment', async (_label, configPatch, code) => {
        const h = handlerHarness(fixtures[2]);
        const config = await h.store.getGptApiConfig();
        h.store.getGptApiConfig.mockResolvedValue({ ...config, ...configPatch });
        await h.request();
        expect(h.response.statusCode).toBe(503);
        expect(h.response.value.message).toBe('充值失败，请联系客服处理');
        expect(h.context.logTask).toHaveBeenCalledWith('', expect.stringContaining(`stage=payment_mode_check code=${code}`), 'warn');
        expect(h.store.hasAvailableCard).not.toHaveBeenCalled();
        expect(h.store.markCdkUsed).not.toHaveBeenCalled();
        expect(h.store.createTaskLog).not.toHaveBeenCalled();
        expect(h.spawnActivationWorker).not.toHaveBeenCalled();
        expect(h.runGptApiWorker).not.toHaveBeenCalled();
    });
    it.each(fixtures.slice(0, 2))('$platform does not depend on GPT supplier configuration', async fixture => {
        const h = handlerHarness(fixture, { getGptApiConfig: vi.fn(async () => { throw new Error('offline GPT config unavailable'); }) });
        await h.request();
        expect(h.response.value.success).toBe(true);
        expect(h.store.getGptApiConfig).not.toHaveBeenCalled();
        expect(h.spawnActivationWorker).toHaveBeenCalledOnce();
        expect(h.runGptApiWorker).not.toHaveBeenCalled();
    });
    it.each([
        ['wrong browser platform', { platform: 'chatgpt' }],
        ['profile JSON instead of login cookie', { session: JSON.stringify({ status: 'authenticated', session: { userId: 'fixture', sessionId: 'profile' } }) }],
        ['irrelevant cookie', { session: 'other_cookie=offline-cookie-fixture' }]
    ])('rejects %s before locking any CDK', async (_label, body) => {
        const h = handlerHarness(fixtures[0]); await h.request(body);
        expect(h.response.statusCode).toBe(400); expect(h.store.markCdkUsed).not.toHaveBeenCalled();
        expect(h.store.markCdkUnused).not.toHaveBeenCalled(); expect(h.spawnActivationWorker).not.toHaveBeenCalled();
    });
    it('does not unlock an unrelated active CDK when its lookup fails', async () => {
        const h = handlerHarness(fixtures[0], { verifyCdkDetails: async () => { throw new Error('lookup failed'); } });
        await h.request(); expect(h.store.markCdkUnused).not.toHaveBeenCalled(); expect(h.response.statusCode).toBe(500);
    });
    it('releases only the lock acquired by this request when task creation fails', async () => {
        const h = handlerHarness(fixtures[0], { createTaskLog: async () => { throw new Error('insert failed'); } });
        await h.request(); expect(h.store.markCdkUsed).toHaveBeenCalledOnce(); expect(h.store.markCdkUnused).toHaveBeenCalledOnce();
        expect(h.context.logTask).toHaveBeenCalledWith('', expect.stringContaining('stage=task_create'), 'error');
    });
    it.each(fixtures)('records card-pool rejection for $platform without leaking internal instructions or starting a task', async fixture => {
        const h = handlerHarness(fixture, { getGptApiConfig: async () => ({ enabled: false }), hasAvailableCard: async () => false });
        await h.request();
        expect(h.response.statusCode).toBe(503);
        expect(h.response.value.message).toBe('充值失败，请联系客服处理');
        expect(h.context.logTask).toHaveBeenCalledWith('', expect.stringContaining('stage=card_pool_check code=CARD_POOL_UNAVAILABLE'), 'warn');
        expect(h.store.markCdkUsed).not.toHaveBeenCalled();
        expect(h.store.createTaskLog).not.toHaveBeenCalled();
        expect(h.spawnActivationWorker).not.toHaveBeenCalled();
        expect(h.runGptApiWorker).not.toHaveBeenCalled();
    });
    it('records Claude credential rejection without logging the submitted credential', async () => {
        const credential = 'unrelated-cookie=offline-private-fixture';
        const h = handlerHarness(fixtures[1]);
        await h.request({ session: credential });
        expect(h.response.statusCode).toBe(400);
        expect(h.context.logTask).toHaveBeenCalledWith('', expect.stringContaining('stage=credential_validation'), 'error');
        expect(JSON.stringify(h.context.logTask.mock.calls)).not.toContain(credential);
        expect(h.store.markCdkUsed).not.toHaveBeenCalled();
    });
    it('does not expose raw diagnostics when restoring an existing task', async () => {
        const h = handlerHarness(fixtures[0], { getRunningTaskByCdk: async () => ({ job_key: 'existing', message: 'locator private data' }) });
        await h.request(); expect(h.response.value).toMatchObject({ success: true, jobKey: 'existing' });
        expect(h.response.value.message).not.toContain('locator'); expect(h.store.markCdkUsed).not.toHaveBeenCalled();
    });
    it('rejects a conflicting database platform and retired Grok plan before reserving assets', async () => {
        for (const details of [{ platform: 'chatgpt', plan_type: fixtures[0].planType }, { platform: 'grok', plan_type: 'supergrok' }]) {
            const h = handlerHarness(fixtures[0], { verifyCdkDetails: async () => ({ type: '自助', ...details }) });
            await h.request(); expect(h.response.statusCode).toBe(400); expect(h.store.markCdkUsed).not.toHaveBeenCalled();
        }
    });
});

async function workerHarness(fixture, { mismatch = false, apiError = null, bootstrapError = null, checkoutMode = 'auto' } = {}) {
    const page = { on() {}, url: () => 'https://fixture.test/checkout', isClosed: () => false };
    const context = { newPage: async () => page, addInitScript: async () => {}, close: async () => {} };
    const login = { ok: true, email: 'fixture@example.test', session: { accessToken: jwt } };
    const methods = Object.fromEntries(['installChatGptSession', 'bootstrapChatGptSession', 'cancelChatGptAutoRenew', 'injectClaudeSession', 'bootstrapClaudeSession',
        'openClaudeCheckout', 'cancelClaudeAutoRenew', 'injectGrokSession', 'bootstrapGrokSession', 'openGrokCheckout', 'cancelGrokAutoRenew', 'openApiCheckout',
        'openPricingCheckout', 'executePaymentWithRetry', 'observeGrokCommerce'].map(name => [name, vi.fn(async () => login)]));
    methods.installChatGptSession.mockResolvedValue({ sessionData: login, hasSessionToken: true, cookieVerified: true });
    methods.openGrokCheckout.mockResolvedValue({ native: true, observedCart: 'offline-cart' });
    methods.observeGrokCommerce.mockImplementation(() => ({ dispose: vi.fn() }));
    methods.executePaymentWithRetry.mockResolvedValue({ success: false, error: 'offline decline', paymentState: 'declined' });
    if (apiError) methods.openApiCheckout.mockRejectedValue(apiError);
    if (bootstrapError) methods[`bootstrap${fixture.platform === 'grok' ? 'Grok' : fixture.platform === 'claude' ? 'Claude' : 'ChatGpt'}Session`].mockRejectedValue(bootstrapError);
    const dependencies = {
        './payment-retry': methods, './pricing-checkout': methods, './chatgpt': { ...methods, ...require('../chatgpt') },
        './region-config': { getRegionConfig, getRegionBrowserProfile }, './session-auth': methods, './chatgpt-cancel-auto-renew': methods, './claude-auth': methods,
        './pricing-checkout-claude': methods, './claude-cancel-auto-renew': methods,
        './grok-auth': methods, './pricing-checkout-grok': methods, './grok-cancel-auto-renew': methods,
        './public/grok-plan-catalog': require('../public/grok-plan-catalog'), './grok-commerce': methods, './cdk-plan-catalog': { validateCdkPlan },
        './mysql-store': { getPaymentRegion: async () => 'PH', verifyCdkDetails: async () => ({ payment_region: 'US', plan_type: mismatch ? 'plus' : fixture.planType, platform: mismatch ? 'chatgpt' : fixture.platform }) },
        './browser-runtime': { connectTaskBrowser: async () => ({ browser: { newContext: async () => context }, realUserAgent: 'Chrome/147.0' }), applyCdpEnv() {}, closeTaskBrowser: async () => {} },
        './playwright-proxy': { preparePlaywrightProxy: async () => ({ cleanup: async () => {}, proxyConfig: null }) },
        './proxy-preflight': { checkProxyConnectivity: vi.fn(), checkProxyAndRegionFast: vi.fn(async () => null), checkEgressRegion: vi.fn(async (_context, expectedRegion) => ({
            expectedRegion, actualRegion: expectedRegion
        })) }, './task-diagnostics': { captureDiagnosticScreenshot: async () => null },
        fs: { mkdirSync() {} }, path
    };
    // Methods must replace real checkout functions: every external action remains a mock.
    dependencies['./chatgpt'].openApiCheckout = methods.openApiCheckout;
    const module = { exports: {} }, process = { env: { ...buildActivationCredentialEnv({ platform: fixture.platform, token: jwt, sessionRaw: fixture.credential }),
        CDK_CODE: 'OFFLINE-CDK', CDK_PLAN_TYPE: fixture.planType, RECORD_VIDEO: '0', CHECKOUT_MODE: checkoutMode }, exitCode: 0 };
    vm.runInNewContext(worker.slice(0, worker.indexOf('run().finally(')) + '\nmodule.exports = { run };', {
        module, process, __dirname: root, console: { log() {}, warn() {}, error() {} },
        require: key => { if (!(key in dependencies)) throw new Error(`Unexpected dependency: ${key}`); return dependencies[key]; }
    });
    await module.exports.run(); return { methods, process };
}

describe('real worker entry uses restored platform modules without network or payment', () => {
    it.each(fixtures)('$platform reaches the matching payment adapter with its exact CDK plan', async fixture => {
        const h = await workerHarness(fixture);
        expect(h.methods.executePaymentWithRetry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ platform: fixture.platform, planType: fixture.planType }));
        expect(h.methods.executePaymentWithRetry.mock.calls[0][1]).toMatchObject({ paymentRegion: 'US', paymentCurrency: 'USD' });
        if (fixture.platform === 'grok') {
            expect(h.methods.openGrokCheckout).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ planType: fixture.planType, commerceObserver: expect.anything() }));
            expect(h.methods.executePaymentWithRetry.mock.calls[0][1]).toMatchObject({ grokAccount: { ok: true }, grokCheckout: { native: true } });
            expect(h.methods.installChatGptSession).not.toHaveBeenCalled(); expect(h.methods.openApiCheckout).not.toHaveBeenCalled();
            expect(h.methods.injectGrokSession.mock.calls[0][1]).toBe(fixture.credential);
        } else if (fixture.platform === 'claude') {
            expect(h.methods.bootstrapClaudeSession).toHaveBeenCalledWith(expect.anything(), fixture.credential, { planType: fixture.planType });
            expect(h.methods.installChatGptSession).not.toHaveBeenCalled(); expect(h.methods.openGrokCheckout).not.toHaveBeenCalled();
        } else {
            expect(h.methods.openApiCheckout).not.toHaveBeenCalled();
            expect(h.methods.openPricingCheckout).toHaveBeenCalledOnce();
            expect(h.methods.bootstrapGrokSession).not.toHaveBeenCalled();
            expect(h.methods.installChatGptSession.mock.calls[0][1]).toBe(fixture.credential);
        }
    });
    it.each(['api', 'auto', 'hybrid'])('keeps real recharge on UI Checkout when CHECKOUT_MODE=%s', async checkoutMode => {
        const h = await workerHarness(fixtures[2], { checkoutMode,
            apiError: Object.assign(new Error('fixture API should not be called'), { code: 'CHECKOUT_HTTP_ERROR' }) });
        expect(h.methods.openApiCheckout).not.toHaveBeenCalled();
        expect(h.methods.openPricingCheckout).toHaveBeenCalledOnce();
        expect(h.methods.executePaymentWithRetry).toHaveBeenCalledOnce();
    });
    it('stops a tampered task plan before installing credentials or opening checkout', async () => {
        const h = await workerHarness(fixtures[0], { mismatch: true });
        expect(h.methods.injectGrokSession).not.toHaveBeenCalled(); expect(h.methods.executePaymentWithRetry).not.toHaveBeenCalled();
    });
    it('does not open checkout when official Grok authentication rejects the cookie', async () => {
        const h = await workerHarness(fixtures[0], { bootstrapError: new Error('GROK_AUTH_REQUIRED') });
        expect(h.methods.openGrokCheckout).not.toHaveBeenCalled(); expect(h.methods.executePaymentWithRetry).not.toHaveBeenCalled();
    });
});

function spawnHarness({ state = 'not_started', failPersist = false, latestState = null } = {}) {
    let done; const finished = new Promise(resolve => { done = resolve; });
    const store = {
        getPaymentRegion: async () => 'US', getActiveProxy: async () => '', getHcaptchaConfig: async () => ({}),
        updateTaskLog: vi.fn(async () => { if (failPersist) throw new Error('fixture persistence failure'); }),
        getTaskStatus: async () => ({ payment_state: latestState || state }), markCdkUnused: vi.fn(async () => {}),
        getMaintenanceModeState: async () => ({ enabled: false })
    };
    let runtimeEnv;
    const sandbox = { ...safety, ...sessions, path, __dirname: root, process: { env: { CHATGPT_TOKEN: 'unrelated-token' } },
        store, buildActivationCredentialEnv, getPlatformForPlan, reportTaskFailure, redactSensitiveText: s => s,
        MAX_PROCESS_ATTEMPTS: 2, normalizeTaskProgress: p => p, logTask() {}, broadcastToTask: vi.fn(),
        notifyTaskOutcome: vi.fn(),
        buildHcaptchaEnvFromConfig: () => ({ env: {} }), extractCardLast4FromOutput: () => null,
        extractTaskMediaFromOutput: () => ({ screenshots: [], videos: [] }), getCheckoutProgress: () => 10,
        getTotalActiveJobs: () => 1, releaseForegroundSlot: () => done(),
        runCheckoutScript: async (_key, _script, env, _attempt, _progress, payment) => {
            runtimeEnv = env; await payment(state); throw new Error('fixture worker interruption');
        },
        spawnWorkerWithBrowser: ({ runtimeEnv, runScript }) => runScript(runtimeEnv), console: { error() {} }
    };
    vm.runInNewContext(snippet('function spawnActivationWorker(', 'async function handleActivationRequest('), sandbox);
    sandbox.spawnActivationWorker({ task: { jobKey: 'fixture-job', executionMode: 'local_card_pool' }, token: 'offline-token',
        sessionRaw: fixtures[0].credential, cdk: 'OFFLINE-CDK', cdkDetails: { platform: 'grok', plan_type: fixtures[0].planType }, clientIp: '' });
    return finished.then(() => ({ store, runtimeEnv, sandbox }));
}

describe('server dispatch and interruption preserve payment resources', () => {
    it('dispatches Grok raw cookies and clears inherited GPT credentials', async () => {
        const h = await spawnHarness();
        expect(h.runtimeEnv).toMatchObject({ PLATFORM: 'grok', GROK_TOKEN: fixtures[0].credential, CHATGPT_TOKEN: '', CHATGPT_SESSION_JSON: '', CLAUDE_SESSION_KEY: '' });
        expect(h.store.markCdkUnused).toHaveBeenCalledOnce();
    });
    it.each(['started', 'unknown', 'succeeded'])('retains %s even when saving the state fails', async state => {
        const h = await spawnHarness({ state, failPersist: true, latestState: 'not_started' });
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
        expect(h.sandbox.broadcastToTask).toHaveBeenCalledWith('fixture-job', expect.objectContaining({ status: 'manual', recoveryRequired: true }));
    });
});
