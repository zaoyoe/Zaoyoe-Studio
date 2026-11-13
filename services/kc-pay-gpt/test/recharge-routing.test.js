import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { resolveActivationInput, buildActivationCredentialEnv } from '../activation-routing.js';
import { validateOutsourceConfig, canonicalizeOutsourcePlan } from '../gpt-outsourcing.js';
import { validateCdkPlan } from '../cdk-plan-catalog.js';
import * as sessions from '../session-auth.js';
import * as safety from '../task-safety.js';
import { getPlatformForPlan, getRegionConfig, getRegionBrowserProfile } from '../region-config.js';
import { formatTaskErrorMessage } from '../public/task-messages.js';
import { reportTaskFailure } from '../task-diagnostics.js';
import { fingerprintSessionPayload } from '../session-security.js';
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
        getActivationAttemptLimit: vi.fn(async () => null),
        getGptApiConfig: vi.fn(async () => ({ enabled: true, api_key: 'offline-key',
            base_url: 'https://supplier.example/api', country: 'US', currency: 'USD',
            plan_mapping: { plus: 'plus-monthly', go: 'go-monthly', pro_100: 'pro100-monthly',
                pro_200: 'pro200-monthly', pro_500: 'pro500-monthly' } })),
        hasAvailableCard: vi.fn(async () => true), markCdkUsed: vi.fn(async () => true),
        markCdkUnused: vi.fn(async () => {}), createTaskLog: vi.fn(async () => ({ jobKey: 'fixture-job' })),
        createActivationTask: vi.fn(async () => ({ created: true, jobKey: 'fixture-job' })),
        retireSafeActivationTask: vi.fn(async () => ({ released: true })), ...overrides
    };
    const spawnActivationWorker = vi.fn(), runGptApiWorker = vi.fn(async () => {});
    const context = { ...sessions, Buffer, Date, crypto, store, ensureStoreReady: async () => {},
        validateOutsourceConfig, canonicalizeOutsourcePlan,
        fingerprintSessionPayload, getClientIp: () => '', getRemainingCooldownMinutes: value => value ? 7 : 0,
        activeForegroundJobs: new Set(),
        resolveActivationInput, formatTaskErrorMessage, redactSensitiveText: s => s,
        logTask: vi.fn(), issueTaskAccessToken: key => `offline-task-access-${key}`, fireTelegramNotification: vi.fn(),
        spawnActivationWorker, runGptApiWorker, console: { log() {}, error() {} } };
    // Exercise the real capacity bookkeeping used by the extracted handler.
    vm.runInNewContext(snippet('function reserveForegroundSlot(', 'function getTotalActiveJobs('), context);
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
        expect(h.store.createActivationTask).toHaveBeenCalledOnce();
        expect(h.store.markCdkUsed).not.toHaveBeenCalled();
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
        expect(h.context.validateAccessToken).toHaveBeenCalledTimes(fixture.platform === 'chatgpt' ? 1 : 0);
        if (fixture.platform === 'chatgpt') {
            expect(h.runGptApiWorker).toHaveBeenCalledOnce(); expect(h.spawnActivationWorker).not.toHaveBeenCalled();
        } else {
            expect(h.runGptApiWorker).not.toHaveBeenCalled(); expect(h.spawnActivationWorker).toHaveBeenCalledOnce();
            expect(h.spawnActivationWorker.mock.calls[0][0]).toMatchObject({ sessionRaw: fixture.credential,
                task: { platform: fixture.platform, executionMode: 'local_card_pool' } });
        }
        expect(h.store.createActivationTask.mock.calls[0][0].tokenPreview).not.toContain('offline-cookie');
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
        expect(h.store.createActivationTask).not.toHaveBeenCalled();
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
        expect(h.store.createActivationTask).not.toHaveBeenCalled();
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
    it('never unlocks by CDK when atomic admission fails or its commit outcome is unknown', async () => {
        const h = handlerHarness(fixtures[0], { createActivationTask: vi.fn(async () => { throw new Error('insert or commit failed'); }) });
        await h.request();
        expect(h.response.statusCode).toBe(500);
        expect(h.store.createActivationTask).toHaveBeenCalledOnce();
        expect(h.store.markCdkUsed).not.toHaveBeenCalled();
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
        expect(h.store.retireSafeActivationTask).not.toHaveBeenCalled();
        expect(h.spawnActivationWorker).not.toHaveBeenCalled();
        expect(h.context.logTask).toHaveBeenCalledWith('', expect.stringContaining('stage=task_admission'), 'error');
    });
    it.each(fixtures)('records card-pool rejection for $platform without leaking internal instructions or starting a task', async fixture => {
        const h = handlerHarness(fixture, { getGptApiConfig: async () => ({ enabled: false }), hasAvailableCard: async () => false });
        await h.request();
        expect(h.response.statusCode).toBe(503);
        expect(h.response.value.message).toBe('充值失败，请联系客服处理');
        expect(h.context.logTask).toHaveBeenCalledWith('', expect.stringContaining('stage=card_pool_check code=CARD_POOL_UNAVAILABLE'), 'warn');
        expect(h.store.markCdkUsed).not.toHaveBeenCalled();
        expect(h.store.createTaskLog).not.toHaveBeenCalled();
        expect(h.store.createActivationTask).not.toHaveBeenCalled();
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
    it('does not block local ChatGPT Sessions with a Session checkout cooldown', async () => {
        const h = handlerHarness(fixtures[2]);
        h.store.getGptApiConfig.mockResolvedValue({ enabled: false });
        h.store.getActivationAttemptLimit.mockResolvedValue({ cooldown_until: 'future-cooldown' });
        h.context.getRemainingCooldownMinutes = vi.fn(value => value ? 7 : 0);

        await h.request();

        expect(h.response.statusCode).toBe(200);
        expect(h.response.value.success).toBe(true);
        expect(h.store.getActivationAttemptLimit).not.toHaveBeenCalledWith('chatgpt_ua', expect.anything());
        expect(h.spawnActivationWorker).toHaveBeenCalledOnce();
    });
    it('does not apply the local Session cooldown to third-party ChatGPT checkout', async () => {
        const h = handlerHarness(fixtures[2]);
        await h.request();
        expect(h.response.value.success).toBe(true);
        expect(h.store.getActivationAttemptLimit).not.toHaveBeenCalled();
        expect(h.runGptApiWorker).toHaveBeenCalledOnce();
    });
});

async function workerHarness(fixture, { mismatch = false, apiError = null, bootstrapError = null, checkoutMode = 'auto', fastProtocol = 'false', protocolCapabilities = true, protocolSessionOk = true, protocolRegionOk = true, contextCloseError = null } = {}) {
    const page = { on() {}, url: () => 'https://fixture.test/checkout', isClosed: () => false };
    const context = { newPage: async () => page, addInitScript: async () => {}, close: vi.fn(async () => { if (contextCloseError) throw contextCloseError; }) };
    const closeTaskBrowser = vi.fn(async () => {});
    const proxyCleanup = vi.fn(async () => {});
    const login = { ok: true, email: 'fixture@example.test', session: { accessToken: jwt } };
    const methods = Object.fromEntries(['verifyChatGptSessionProtocol', 'installChatGptSession', 'bootstrapChatGptSession', 'cancelChatGptAutoRenew', 'injectClaudeSession', 'bootstrapClaudeSession',
        'openClaudeCheckout', 'cancelClaudeAutoRenew', 'injectGrokSession', 'bootstrapGrokSession', 'openGrokCheckout', 'cancelGrokAutoRenew', 'openApiCheckout',
        'openPricingCheckout', 'executePaymentWithRetry', 'observeGrokCommerce'].map(name => [name, vi.fn(async () => login)]));
    methods.verifyChatGptSessionProtocol.mockResolvedValue({ ...login, ok: protocolSessionOk });
    if (!protocolCapabilities) delete methods.verifyChatGptSessionProtocol;
    methods.openApiCheckout.mockResolvedValue({ sessionId: 'oaics_offline', checkoutUrl: 'https://chatgpt.com/checkout/openai_llc/oaics_offline' });
    methods.openPricingCheckout.mockResolvedValue('https://chatgpt.com/checkout/openai_llc/oaics_offline_ui');
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
        './browser-runtime': { connectTaskBrowser: async () => ({ browser: { newContext: async () => context }, realUserAgent: 'Chrome/147.0' }), applyCdpEnv() {}, closeTaskBrowser },
        './playwright-proxy': { preparePlaywrightProxy: async () => ({ cleanup: proxyCleanup, proxyConfig: null }) },
        './proxy-preflight': { checkProxyAndRegionProtocol: vi.fn(async (_proxy, region) => protocolRegionOk ? { ip: '192.0.2.1', actualRegion: region } : null), checkProxyConnectivity: vi.fn(), checkProxyAndRegionFast: vi.fn(async () => null), checkEgressRegion: vi.fn(async (_context, expectedRegion) => ({
            expectedRegion, actualRegion: expectedRegion
        })) }, './task-diagnostics': { captureDiagnosticScreenshot: async () => null },
        fs: { mkdirSync() {} }, path
    };
    // Methods must replace real checkout functions: every external action remains a mock.
    dependencies['./chatgpt'].openApiCheckout = methods.openApiCheckout;
    const module = { exports: {} }, process = { env: { ...buildActivationCredentialEnv({ platform: fixture.platform, token: jwt, sessionRaw: fixture.credential }),
        CDK_CODE: 'OFFLINE-CDK', CDK_PLAN_TYPE: fixture.planType, RECORD_VIDEO: '0', CHECKOUT_MODE: checkoutMode, FAST_PROTOCOL_ENABLED: fastProtocol }, exitCode: 0 };
    vm.runInNewContext(worker.slice(0, worker.indexOf('run().finally(')) + '\nmodule.exports = { run };', {
        module, process, __dirname: root, console: { log() {}, warn() {}, error() {} },
        require: key => { if (!(key in dependencies)) throw new Error(`Unexpected dependency: ${key}`); return dependencies[key]; }
    });
    await module.exports.run(); return { methods, process, context, closeTaskBrowser, proxyCleanup };
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
            expect(h.methods.openApiCheckout).toHaveBeenCalledOnce();
            expect(h.methods.bootstrapGrokSession).not.toHaveBeenCalled();
            expect(h.methods.installChatGptSession.mock.calls[0][1]).toBe(fixture.credential);
        }
    });
    it.each(['api', 'auto', 'hybrid'])('falls back to UI Checkout when API checkout fails in CHECKOUT_MODE=%s', async checkoutMode => {
        const h = await workerHarness(fixtures[2], { checkoutMode,
            apiError: Object.assign(new Error('fixture API error for fallback'), { code: 'CHECKOUT_HTTP_ERROR' }) });
        expect(h.methods.openApiCheckout).toHaveBeenCalledOnce();
        expect(h.methods.openPricingCheckout).toHaveBeenCalledOnce();
        expect(h.methods.executePaymentWithRetry).toHaveBeenCalledOnce();
    });
    it.each(['false', '0'])('uses protocol preparation and browser confirmation when FAST_PROTOCOL_ENABLED=%s', async fastProtocol => {
        const h = await workerHarness(fixtures[2], { fastProtocol });
        expect(h.methods.verifyChatGptSessionProtocol).toHaveBeenCalledOnce();
        expect(h.methods.bootstrapChatGptSession).not.toHaveBeenCalled();
        expect(h.methods.openApiCheckout).toHaveBeenCalledOnce();
        expect(h.methods.openApiCheckout.mock.calls[0][0]).toBeNull();
        expect(h.methods.openPricingCheckout).not.toHaveBeenCalled();
        expect(h.methods.executePaymentWithRetry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ protocolOnly: false, fastProtocol: false }));
    });
    it('keeps explicit hybrid confirmation in the browser even when fast protocol is enabled', async () => {
        const h = await workerHarness(fixtures[2], { checkoutMode: 'hybrid', fastProtocol: 'true' });
        expect(h.methods.executePaymentWithRetry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ protocolOnly: false, fastProtocol: false }));
    });
    it('keeps successful protocol preparation free of browser work in pure protocol mode', async () => {
        const h = await workerHarness(fixtures[2], { fastProtocol: 'true' });
        expect(h.methods.openApiCheckout).toHaveBeenCalledOnce();
        expect(h.methods.installChatGptSession).not.toHaveBeenCalled();
        expect(h.methods.executePaymentWithRetry).toHaveBeenCalledWith(null, expect.objectContaining({ protocolOnly: true, fastProtocol: true }));
        expect(h.context.close).not.toHaveBeenCalled();
    });
    it('stops pure protocol API failure before browser or payment', async () => {
        const h = await workerHarness(fixtures[2], { fastProtocol: 'true', apiError: Object.assign(new Error('offline API failure'), { code: 'CHECKOUT_HTTP_ERROR' }) });
        expect(h.methods.openApiCheckout).toHaveBeenCalledOnce();
        expect(h.methods.installChatGptSession).not.toHaveBeenCalled();
        expect(h.methods.openPricingCheckout).not.toHaveBeenCalled();
        expect(h.methods.executePaymentWithRetry).not.toHaveBeenCalled();
    });
    it('stops when required pure protocol capabilities are unavailable', async () => {
        const h = await workerHarness(fixtures[2], { fastProtocol: 'true', protocolCapabilities: false });
        expect(h.methods.openApiCheckout).not.toHaveBeenCalled();
        expect(h.methods.installChatGptSession).not.toHaveBeenCalled();
        expect(h.methods.executePaymentWithRetry).not.toHaveBeenCalled();
    });
    it.each([
        { protocolSessionOk: false }, { protocolRegionOk: false }
    ])('stops hybrid preparation failure without payment or browser fallback: %j', async options => {
        const h = await workerHarness(fixtures[2], options);
        expect(h.methods.openApiCheckout).not.toHaveBeenCalled();
        expect(h.methods.installChatGptSession).not.toHaveBeenCalled();
        expect(h.methods.executePaymentWithRetry).not.toHaveBeenCalled();
    });
    it.each(['CHECKOUT_UNUSUAL_ACTIVITY', 'ACCOUNT_ALREADY_SUBSCRIBED', 'CHECKOUT_AUTH_ERROR'])('stops hybrid API %s without UI fallback', async code => {
        const h = await workerHarness(fixtures[2], { apiError: Object.assign(new Error(`offline ${code}`), { code }) });
        expect(h.methods.openApiCheckout).toHaveBeenCalledOnce();
        expect(h.methods.openPricingCheckout).not.toHaveBeenCalled();
        expect(h.methods.executePaymentWithRetry).not.toHaveBeenCalled();
    });
    it('keeps real recharge directly on UI Checkout when CHECKOUT_MODE=ui', async () => {
        const h = await workerHarness(fixtures[2], { checkoutMode: 'ui' });
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

function spawnHarness({ state = 'not_started', failPersist = false, failAt = 0, refuseAt = 0,
    refuseFinal = false, failFinal = false, loseFinalResponse = false, failAnnotation = false,
    refuseAnnotation = false, loseAnnotationResponse = false, autoRenewError = false, cardPoolEmpty = false,
    workerError = 'fixture worker interruption',
    latestState = null, paymentSequence = null, unawaitedPayments = false, emitProgress = false,
    platform = 'grok', executionMode = 'local_card_pool', runOutput = null, runStatus = 'failed',
    runSequence = null, proxies = [], useRealFinalize = false,
    autoRenewConfirmed = false, sessionCooldownScopeKey = 'fixture-session-fingerprint' } = {}) {
    let done; const finished = new Promise(resolve => { done = resolve; });
    let savedState = latestState || 'not_started', settled = false, writes = 0, paymentCallback, finalFailed = false;
    const events = [];
    const runtimeEnvs = [];
    const proxyQueue = [...proxies];
    const store = {
        getPaymentRegion: async () => 'US',
        getActiveProxy: async () => (proxyQueue.length ? proxyQueue.shift() : ''),
        getHcaptchaConfig: async () => ({}),
        updateTaskLog: vi.fn(), markCdkUnused: vi.fn(), getTaskStatus: vi.fn(),
        updateLocalActivationTask: vi.fn(async (_key, input, options = {}) => {
            events.push({ type: 'write', input, options });
            writes += 1;
            if (failPersist || writes === failAt || (failAnnotation && options.annotate)) throw new Error('fixture persistence failure');
            if (failFinal && options.finalize && !finalFailed) {
                finalFailed = true;
                throw new Error('fixture final write failed before commit');
            }
            if (writes === refuseAt || (options.finalize && refuseFinal) || (options.annotate && refuseAnnotation) || (settled && !options.annotate)) {
                return { applied: false, released: false, reason: 'OFFLINE_OWNER_CHANGED' };
            }
            // The store itself is exercised separately through its real SQL.
            // Here return the effective persisted evidence for the worker flow.
            await Promise.resolve();
            savedState = safety.mergePaymentState(savedState, input.paymentState);
            const confirmed = (options.finalize || options.annotate) && input.status === 'success' && savedState === 'succeeded';
            const recoveryRequired = !confirmed && (safety.shouldRetainCdk({ paymentState: savedState }) || !!input.recoveryRequired);
            const status = options.finalize
                ? (recoveryRequired ? 'manual' : input.status)
                : input.status;
            if (options.finalize) settled = true;
            const result = { applied: true, status, paymentState: savedState, recoveryRequired,
                released: !!options.finalize && status === 'failed' && !recoveryRequired,
                message: options.finalize && status === 'manual' && input.status !== 'manual'
                    ? '支付结果或任务状态需人工复核，已保留 CDK 与银行卡' : input.message };
            events.push({ type: 'saved', result, options });
            if ((loseFinalResponse && options.finalize) || (loseAnnotationResponse && options.annotate)) throw new Error('fixture commit response lost');
            return result;
        }),
        releaseCardsByOwner: vi.fn(async () => { events.push({ type: 'releaseCards' }); }),
        resetCdkFailure: vi.fn(async () => {}), resetActivationAttemptFailure: vi.fn(async () => {}),
        getMaintenanceModeState: async () => ({ enabled: false }),
        setActivationAttemptCooldown: vi.fn(async () => {})
    };
    let runtimeEnv;
    const sandbox = { ...safety, ...sessions, path, __dirname: root, process: { env: { CHATGPT_TOKEN: 'unrelated-token' } },
        require: id => (id === './playwright-proxy' ? { alignProxyRegion: p => p } : require(id)),
        store, buildActivationCredentialEnv, getPlatformForPlan, reportTaskFailure, redactSensitiveText: s => s,
        MAX_PROCESS_ATTEMPTS: 2, normalizeTaskProgress: p => p, logTask() {},
        broadcastToTask: vi.fn((_key, value) => { events.push({ type: 'broadcast', value }); }),
        notifyTaskOutcome: vi.fn(value => { events.push({ type: 'notify', value }); }),
        finalizeRetryAnalysis: useRealFinalize ? safety.finalizeRetryAnalysis : (analysis => analysis), isNoActivationEligibilityMessage: () => false,
        isCardPoolExhaustedIssue: () => cardPoolEmpty, extractAutoRenewResultFromOutput: () => null,
        cancelAutoRenew: vi.fn(async () => {
            events.push({ type: 'autoRenewCheck' });
            if (autoRenewError) throw new Error('offline cancellation error');
            return { ok: true, data: autoRenewConfirmed ? { alreadyCancelled: true } : { verificationUnknown: true } };
        }),
        buildHcaptchaEnvFromConfig: () => ({ env: {} }), extractCardLast4FromOutput: () => null,
        extractTaskMediaFromOutput: () => ({ screenshots: [], videos: [] }), getCheckoutProgress: () => 10,
        getTotalActiveJobs: () => 1, releaseForegroundSlot: () => done(),
        runCheckoutScript: async (_key, _script, env, attempt, progressCb, payment) => {
            runtimeEnv = env; runtimeEnvs.push(env); paymentCallback = payment;
            if (emitProgress && paymentSequence) {
                for (const value of paymentSequence) {
                    await payment(value);
                    if (value === 'started') await progressCb(80, '[Stripe] Step 9.5: 等待 hCaptcha 弹层或拒付结果');
                }
            } else {
                const pending = (paymentSequence || (runOutput === null && !runSequence ? [state] : [])).map(value => payment(value));
                if (!unawaitedPayments) await Promise.all(pending);
                else pending.forEach(operation => operation.catch(() => {}));
            }
            if (Array.isArray(runSequence)) {
                return runSequence[attempt - 1];
            }
            if (runOutput !== null) {
                return { output: runOutput, analysis: { status: runStatus, message: 'offline fixture', paymentState: state, shouldRetry: false } };
            }
            throw new Error(workerError);
        },
        spawnWorkerWithBrowser: ({ runtimeEnv, runScript }) => runScript(runtimeEnv), console: { error() {} }
    };
    vm.runInNewContext(snippet('function spawnActivationWorker(', 'async function handleActivationRequest('), sandbox);
    const fixture = fixtures.find(item => item.platform === platform);
    const planType = fixture?.planType || 'plus';
    const token = platform === 'chatgpt' ? jwt : 'offline-token';
    sandbox.spawnActivationWorker({ task: { jobKey: 'fixture-job', executionMode }, token,
        sessionRaw: fixture?.credential || '', cdk: 'OFFLINE-CDK', cdkDetails: { platform, plan_type: planType }, clientIp: '', sessionCooldownScopeKey });
    return finished.then(() => ({ store, runtimeEnv, runtimeEnvs, sandbox, events, paymentCallback }));
}

describe('server dispatch and interruption preserve payment resources', () => {
    it('dispatches Grok raw cookies and clears inherited GPT credentials', async () => {
        const h = await spawnHarness();
        expect(h.runtimeEnv).toMatchObject({ PLATFORM: 'grok', GROK_TOKEN: fixtures[0].credential, CHATGPT_TOKEN: '', CHATGPT_SESSION_JSON: '', CLAUDE_SESSION_KEY: '' });
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
        expect(h.store.releaseCardsByOwner).toHaveBeenCalledOnce();
        expect(h.store.updateLocalActivationTask).toHaveBeenLastCalledWith('fixture-job',
            expect.objectContaining({ status: 'failed', paymentState: 'not_started' }), { finalize: true });
        const saved = h.events.findIndex(event => event.type === 'saved' && event.options.finalize);
        expect(h.events.findIndex(event => event.type === 'notify')).toBeGreaterThan(saved);
        expect(h.events.findIndex(event => event.type === 'releaseCards')).toBeGreaterThan(saved);
    });
    it.each(['started', 'unknown', 'succeeded'])('retains %s even when saving the state fails', async state => {
        const h = await spawnHarness({ state, failPersist: true, latestState: 'not_started' });
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
        expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
        expect(h.sandbox.notifyTaskOutcome).not.toHaveBeenCalled();
        expect(h.sandbox.broadcastToTask.mock.calls.some(([, event]) => event.type === 'status')).toBe(false);
    });
    it('never cools a ChatGPT Session after unusual activity', async () => {
        const h = await spawnHarness({ platform: 'chatgpt', runOutput: '[CHECKOUT_UNUSUAL_ACTIVITY]', sessionCooldownScopeKey: 'a'.repeat(64) });
        expect(h.store.setActivationAttemptCooldown).not.toHaveBeenCalled();
    });
    it('retries once with a fresh proxy after CHECKOUT_UNUSUAL_ACTIVITY before payment starts, then settles failed without cooldown', async () => {
        const retryResult = () => ({
            output: '[CHECKOUT_UNUSUAL_ACTIVITY]',
            analysis: safety.classifyCheckoutFailure(
                'Checkout 创建接口返回 HTTP 400：Our systems have detected unusual activity. Please try again later. [CHECKOUT_UNUSUAL_ACTIVITY]',
                'not_started'
            )
        });
        const h = await spawnHarness({
            platform: 'chatgpt',
            proxies: ['http://p1:8000', 'http://p2:8000'],
            runSequence: [retryResult(), retryResult()],
            useRealFinalize: true,
            sessionCooldownScopeKey: 'b'.repeat(64)
        });
        expect(h.runtimeEnvs.map(env => env.PROXY)).toEqual(['http://p1:8000', 'http://p2:8000']);
        expect(h.store.releaseCardsByOwner).toHaveBeenCalledTimes(2);
        expect(h.store.updateLocalActivationTask).toHaveBeenLastCalledWith(
            'fixture-job',
            expect.objectContaining({ status: 'failed', paymentState: 'not_started' }),
            { finalize: true }
        );
        const savedFinal = h.events.find(event => event.type === 'saved' && event.options.finalize);
        expect(savedFinal?.result).toMatchObject({ applied: true, status: 'failed', released: true, recoveryRequired: false });
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
        expect(h.store.setActivationAttemptCooldown).not.toHaveBeenCalled();
    });
    it('keeps worker exception details out of the saved and reported public message', async () => {
        const h = await spawnHarness({ workerError: 'offline internal diagnostic: synthetic-secret-fixture' });
        const finalWrite = h.events.find(event => event.type === 'write' && event.options.finalize);
        expect(finalWrite.input.message).toBe('任务执行异常，请稍后重试或联系客服');
        const status = h.events.filter(event => event.type === 'broadcast' && event.value.type === 'status').at(-1).value;
        expect(status.message).toBe(finalWrite.input.message);
        expect(h.sandbox.notifyTaskOutcome).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: status.message }));
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
    });
    it('retains assets after a transient persistence failure and only reports the saved manual result', async () => {
        const h = await spawnHarness({ failAt: 1 });
        expect(h.store.updateLocalActivationTask).toHaveBeenLastCalledWith('fixture-job',
            expect.objectContaining({ status: 'manual', paymentState: 'unknown', recoveryRequired: true }), { finalize: true });
        expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
        expect(h.sandbox.notifyTaskOutcome).toHaveBeenCalledOnce();
        expect(h.sandbox.broadcastToTask).toHaveBeenCalledWith('fixture-job', expect.objectContaining({ type: 'status', status: 'manual' }));
    });
    it.each([{ refuseAt: 1 }, { refuseFinal: true }])('stops refused settlement without a fallback unlock or completion notice: %j', async options => {
        const h = await spawnHarness(options);
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
        expect(h.store.updateTaskLog).not.toHaveBeenCalled();
        expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
        expect(h.sandbox.notifyTaskOutcome).not.toHaveBeenCalled();
    });
    it('retains assets after a rejected final write and only reports a confirmed manual settlement', async () => {
        const h = await spawnHarness({ state: 'not_started', runOutput: 'offline output', failFinal: true });
        expect(h.store.updateLocalActivationTask).toHaveBeenLastCalledWith('fixture-job',
            expect.objectContaining({ status: 'manual', paymentState: 'unknown', recoveryRequired: true }), { finalize: true });
        expect(h.sandbox.notifyTaskOutcome).toHaveBeenCalledOnce();
        expect(h.sandbox.notifyTaskOutcome).toHaveBeenCalledWith(expect.objectContaining({ event: 'failure' }));
        expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
    });
    it('does not compensate or report completion when the final commit response is lost', async () => {
        const h = await spawnHarness({ state: 'not_started', runOutput: 'offline output', loseFinalResponse: true });
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
        expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
        expect(h.sandbox.notifyTaskOutcome).not.toHaveBeenCalled();
        expect(h.sandbox.broadcastToTask).not.toHaveBeenCalledWith('fixture-job', expect.objectContaining({ type: 'status' }));
    });
    it('uses persisted stronger evidence when the worker fails before payment', async () => {
        const h = await spawnHarness({ latestState: 'succeeded' });
        expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
        expect(h.sandbox.broadcastToTask).toHaveBeenCalledWith('fixture-job', expect.objectContaining({
            type: 'status', status: 'manual', paymentState: 'succeeded', recoveryRequired: true }));
        const status = h.events.filter(event => event.type === 'broadcast' && event.value.type === 'status').at(-1).value;
        expect(h.sandbox.notifyTaskOutcome).toHaveBeenCalledWith(expect.objectContaining({ event: 'failure', message: status.message }));
        expect(status.message).toContain('人工复核');
    });
    it('uses the persisted review message for normal completion and does not report card-pool exhaustion', async () => {
        const h = await spawnHarness({ latestState: 'succeeded', runOutput: 'offline failed result', cardPoolEmpty: true });
        const status = h.events.filter(event => event.type === 'broadcast' && event.value.type === 'status').at(-1).value;
        expect(status).toMatchObject({ status: 'manual', paymentState: 'succeeded', recoveryRequired: true });
        expect(status.message).toContain('人工复核');
        expect(h.sandbox.notifyTaskOutcome).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ event: 'failure', message: status.message }));
        expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
    });
    it('serializes unawaited stdout callbacks before finalization and does not downgrade payment evidence', async () => {
        const h = await spawnHarness({ state: 'not_started', paymentSequence: ['started', 'not_started'],
            unawaitedPayments: true, runOutput: 'offline output' });
        const finalWrite = h.events.find(event => event.type === 'write' && event.options.finalize);
        expect(finalWrite.input.paymentState).toBe('started');
        expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
        expect(h.sandbox.broadcastToTask).toHaveBeenCalledWith('fixture-job', expect.objectContaining({ type: 'status', status: 'manual' }));
    });
    it('preserves a started marker even when a single output chunk ends with declined', async () => {
        const h = await spawnHarness({ state: 'declined', runOutput: 'PAYMENT_STATE:started\nPAYMENT_STATE:declined' });
        expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
        expect(h.store.updateLocalActivationTask).toHaveBeenLastCalledWith('fixture-job',
            expect.objectContaining({ paymentState: 'started' }), { finalize: true });
    });
    it('retains assets when legacy output reports an unknown payment without a state marker', async () => {
        const h = await spawnHarness({ state: 'not_started', runOutput: '支付结果未知，请人工复核' });
        expect(h.store.updateLocalActivationTask).toHaveBeenLastCalledWith('fixture-job',
            expect.objectContaining({ status: 'manual', paymentState: 'unknown', recoveryRequired: true }), { finalize: true });
        expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
    });
    it('accepts affirmative success after an earlier legacy unknown-payment message', async () => {
        const h = await spawnHarness({ platform: 'chatgpt', state: 'succeeded', runStatus: 'success',
            runOutput: '支付结果未知\nPAYMENT_STATE:succeeded', autoRenewConfirmed: true });
        expect(h.sandbox.notifyTaskOutcome).toHaveBeenCalledWith(expect.objectContaining({ event: 'success' }));
        expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
    });
    it('reports affirmative success only after settlement and safely annotates auto-renew confirmation', async () => {
        const h = await spawnHarness({ platform: 'chatgpt', state: 'succeeded', runStatus: 'success',
            runOutput: 'PAYMENT_STATE:succeeded', autoRenewConfirmed: true });
        expect(h.store.updateLocalActivationTask).toHaveBeenLastCalledWith('fixture-job',
            expect.objectContaining({ status: 'success', paymentState: 'succeeded', autoRenewStatus: 'disabled' }), { annotate: true });
        expect(h.sandbox.notifyTaskOutcome).toHaveBeenCalledWith(expect.objectContaining({ event: 'success' }));
        const saved = h.events.findIndex(event => event.type === 'saved' && event.options.finalize);
        const renewalSaved = h.events.findIndex(event => event.type === 'saved' && event.options.annotate);
        const renewalCheck = h.events.findIndex(event => event.type === 'autoRenewCheck');
        expect(renewalCheck).toBeGreaterThan(saved);
        expect(renewalSaved).toBeGreaterThan(renewalCheck);
        expect(h.events.findIndex(event => event.type === 'broadcast' && event.value.status === 'success')).toBeGreaterThanOrEqual(0);
        expect(h.events[saved].result).toMatchObject({ status: 'success', recoveryRequired: false });
        expect(h.events[renewalSaved].result).toMatchObject({ status: 'success', recoveryRequired: false });
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
        expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
        const writes = h.store.updateLocalActivationTask.mock.calls.length;
        await expect(h.paymentCallback('started')).rejects.toThrow('已结算');
        expect(h.store.updateLocalActivationTask).toHaveBeenCalledTimes(writes);
    });
    it('persists background auto-renew failure without revoking affirmative payment success', async () => {
        const h = await spawnHarness({ platform: 'chatgpt', state: 'succeeded', runStatus: 'success',
            runOutput: 'PAYMENT_STATE:succeeded', autoRenewConfirmed: true, failAnnotation: true });
        expect(h.store.updateLocalActivationTask).toHaveBeenLastCalledWith('fixture-job',
            expect.objectContaining({ status: 'success', paymentState: 'succeeded' }), { annotate: true });
        expect(h.sandbox.notifyTaskOutcome).toHaveBeenCalledWith(expect.objectContaining({ event: 'success' }));
        expect(h.sandbox.broadcastToTask).toHaveBeenCalledWith('fixture-job', expect.objectContaining({ status: 'success' }));
        const finalized = h.events.find(event => event.type === 'saved' && event.options.finalize);
        expect(finalized.result).toMatchObject({ status: 'success', paymentState: 'succeeded', recoveryRequired: false });
        const finalWrite = h.events.find(event => event.type === 'write' && event.options.finalize);
        expect(finalWrite.input).toMatchObject({ status: 'success', autoRenewStatus: 'pending', recoveryRequired: false });
        expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
    });
    it('preserves payment success even if background annotation is refused or its response is lost', async () => {
        for (const options of [{ refuseAnnotation: true }, { loseAnnotationResponse: true }]) {
            const h = await spawnHarness({ platform: 'chatgpt', state: 'succeeded', runStatus: 'success',
                runOutput: 'PAYMENT_STATE:succeeded', autoRenewConfirmed: true, ...options });
            expect(h.sandbox.broadcastToTask).toHaveBeenCalledWith('fixture-job', expect.objectContaining({ status: 'success' }));
            expect(h.sandbox.notifyTaskOutcome).toHaveBeenCalledWith(expect.objectContaining({ event: 'success' }));
            expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
            expect(h.store.markCdkUnused).not.toHaveBeenCalled();
            expect(h.store.updateLocalActivationTask).toHaveBeenLastCalledWith('fixture-job',
                expect.objectContaining({ status: 'success', paymentState: 'succeeded' }), { annotate: true });
            const finalized = h.events.find(event => event.type === 'saved' && event.options.finalize);
            expect(finalized.result).toMatchObject({ status: 'success', recoveryRequired: false });
        }
    });
    it('persists cancellation exceptions in background without downgrading task to manual', async () => {
        const h = await spawnHarness({ platform: 'chatgpt', state: 'succeeded', runStatus: 'success',
            runOutput: 'PAYMENT_STATE:succeeded', autoRenewError: true });
        expect(h.store.updateLocalActivationTask).toHaveBeenLastCalledWith('fixture-job', expect.objectContaining({
            status: 'success', paymentState: 'succeeded', autoRenewStatus: 'verification_unknown', recoveryRequired: false
        }), { annotate: true });
        expect(h.sandbox.notifyTaskOutcome).toHaveBeenCalledWith(expect.objectContaining({ event: 'success' }));
        expect(h.sandbox.broadcastToTask).toHaveBeenCalledWith('fixture-job', expect.objectContaining({ status: 'success' }));
        expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
    });
    it('keeps payment completed when auto-renew needs review', async () => {
        const h = await spawnHarness({ state: 'succeeded', runStatus: 'success', runOutput: 'PAYMENT_STATE:succeeded' });
        expect(h.store.updateLocalActivationTask).toHaveBeenLastCalledWith('fixture-job',
            expect.objectContaining({ status: 'success', paymentState: 'succeeded', recoveryRequired: false }), { annotate: true });
        expect(h.sandbox.broadcastToTask).toHaveBeenCalledWith('fixture-job', expect.objectContaining({ status: 'success', paymentState: 'succeeded' }));
        expect(h.sandbox.notifyTaskOutcome).toHaveBeenCalledWith(expect.objectContaining({ event: 'success' }));
        expect(h.store.releaseCardsByOwner).not.toHaveBeenCalled();
    });
    it('keeps mid-charge progress running instead of broadcasting manual before settlement', async () => {
        const h = await spawnHarness({
            platform: 'chatgpt',
            state: 'succeeded',
            paymentSequence: ['started', 'succeeded'],
            emitProgress: true,
            runStatus: 'success',
            runOutput: 'PAYMENT_STATE:succeeded',
            autoRenewConfirmed: true
        });
        const progressBroadcasts = h.events
            .filter(event => event.type === 'broadcast' && event.value.type === 'progress')
            .map(event => event.value);
        expect(progressBroadcasts.some(item => item.status === 'manual')).toBe(false);
        expect(progressBroadcasts).toEqual(expect.arrayContaining([
            expect.objectContaining({ status: 'running', paymentState: 'started', progress: 80 }),
            expect.objectContaining({ status: 'running', paymentState: 'succeeded', progress: 100 })
        ]));
        expect(h.sandbox.broadcastToTask).toHaveBeenCalledWith('fixture-job', expect.objectContaining({ status: 'success', paymentState: 'succeeded' }));
        expect(h.store.updateLocalActivationTask).toHaveBeenLastCalledWith('fixture-job',
            expect.objectContaining({ status: 'success', paymentState: 'succeeded', autoRenewStatus: 'disabled' }), { annotate: true });
    });
    it('closes the context with recording disabled and continues cleanup after close failure', async () => {
        const h = await workerHarness(fixtures[0], { contextCloseError: new Error('fixture context close failure') });
        expect(h.process.exitCode).toBe(1);
        expect(h.context.close).toHaveBeenCalledOnce();
        expect(h.closeTaskBrowser).toHaveBeenCalledOnce();
        expect(h.proxyCleanup).toHaveBeenCalledOnce();
    });
});
