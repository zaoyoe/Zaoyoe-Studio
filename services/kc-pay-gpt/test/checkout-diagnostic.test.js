import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const domain = require('../checkout-diagnostic');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const worker = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const fixtures = [
    { platform: 'chatgpt', planType: 'plus', session: 'offline-session', url: 'https://chatgpt.com/checkout/openai_llc/fixture' },
    { platform: 'claude', planType: 'claude_pro', session: 'sessionKey=sk-ant-sid01-' + 'x'.repeat(80), url: 'https://claude.ai/upgrade/pro' },
    { platform: 'grok', planType: 'grok_bundle_super_annual', session: 'sso=offline-cookie-fixture', url: 'https://grok.com/plans' }
];
function resolve(fixture, extra = {}) {
    return domain.resolveDiagnosticInput({ body: { platform: fixture.platform, plan_type: fixture.planType,
        session: fixture.session, region: 'US', ...extra }, validateChatGpt: raw => ({ token: 'offline-token', storedSession: raw }) });
}
function finalReport(extra = {}) {
    return { version: 1, platform: 'chatgpt', planType: 'plus', mode: 'checkout', region: 'US', success: true,
        paymentSubmitted: false, checks: ['session', 'form', 'product', 'amount', 'currency', 'interval'].map(id => ({ id, label: id, status: 'passed' })),
        checkout: { url: fixtures[0].url, kind: 'hosted', confirmed: true, amount: 20, currency: 'USD', product: 'ChatGPT Plus', interval: 'month' }, ...extra };
}

describe('diagnostic catalog, credentials and safe runtime', () => {
    it('uses canonical current merchandise and platform-specific modes/regions', () => {
        const catalog = domain.getDiagnosticCatalog('US');
        expect(catalog.platforms.map(p => p.plans.length)).toEqual([5, 4, 8]);
        expect(catalog.platforms[1].plans.map(p => p.id)).not.toContain('claude_team');
        expect(catalog.platforms[2].plans.map(p => p.id)).not.toContain('supergrok');
        expect(catalog.regions.map(r => r.id)).toEqual(['PH', 'US', 'EG', 'CL']);
        expect(catalog.platforms[1].modes.map(m => m.id)).toEqual(['checkout']);
    });
    it.each(fixtures)('$platform clears inherited credentials and CDK before starting', fixture => {
        const input = resolve(fixture);
        const env = domain.buildDiagnosticRuntimeEnv(input, { CDK_CODE: 'unrelated', CHATGPT_TOKEN: 'old',
            CLAUDE_SESSION_KEY: 'old', GROK_TOKEN: 'old', CHATGPT_SESSION_COOKIE: 'old-cookie', CHATGPT_SESSION_TOKEN: 'old-token',
            ACTIVATION_EMAIL: 'old', CHECKOUT_MODE: 'ui' }, 'diag-fixture');
        expect(env).toMatchObject({ JOB_KEY: 'diag-fixture', CDK_CODE: '', CHECKOUT_DEBUG_ONLY: '1',
            CHECKOUT_DIAGNOSTIC_MODE: 'checkout', CHECKOUT_MODE: 'auto', PAYMENT_REGION_OVERRIDE: 'US', ACTIVATION_EMAIL: '',
            CHATGPT_SESSION_COOKIE: '', CHATGPT_SESSION_TOKEN: '' });
        for (const [platform, key] of [['chatgpt', 'CHATGPT_TOKEN'], ['claude', 'CLAUDE_SESSION_KEY'], ['grok', 'GROK_TOKEN']]) {
            if (platform !== fixture.platform) expect(env[key]).toBe('');
        }
    });
    it.each([
        { platform: 'grok', plan_type: 'supergrok' }, { platform: 'claude', plan_type: 'claude_team' },
        { platform: 'claude', plan_type: 'claude_pro', mode: 'link' },
        { region: 'SG' }, { mode: 'unknown' }, { plan_name: 'custom' }, { plan_name: 'x\nCHECKOUT_DEBUG_SUCCESS', mode: 'link' }
    ])('rejects unsupported or ambiguous diagnostic input %j', extra => {
        expect(() => resolve(fixtures[0], extra)).toThrow();
    });
    it('preserves a manual override only in link mode without changing selected merchandise', () => {
        const input = resolve(fixtures[0], { mode: 'link', plan_name: 'custom_test_plan' });
        expect(input.planNameOverride).toBe('custom_test_plan');
        expect(input.planType).toBe('plus');
        expect(domain.buildDiagnosticRuntimeEnv(input, {}, 'fixture').CHECKOUT_MODE).toBe('api');
    });
    it('does not invent a local price for a non-USD region', () => {
        const lines = [];
        domain.createDiagnosticReporter({ platform: 'chatgpt', planType: 'plus', mode: 'checkout', region: 'PH' }, line => lines.push(line))
            .check('browser', '浏览器', 'running');
        expect(domain.parseDiagnosticOutput(lines.join('\n')).checkout.expectedAmount).toBeNull();
    });
});

describe('structured diagnostic protocol', () => {
    it('accepts stage reports and requires actual successful form and product evidence', () => {
        const stage = finalReport({ success: undefined, checks: [], checkout: { confirmed: false } });
        expect(domain.parseDiagnosticOutput('CHECKOUT_DIAGNOSTIC:' + JSON.stringify(stage)).success).toBeUndefined();
        expect(domain.parseDiagnosticOutput('CHECKOUT_DIAGNOSTIC:' + JSON.stringify(finalReport()))).toMatchObject({ success: true });
        for (const bad of [finalReport({ checks: [] }), finalReport({ paymentSubmitted: true }),
            finalReport({ checkout: { url: fixtures[0].url, confirmed: false } })]) {
            expect(domain.parseDiagnosticOutput('CHECKOUT_DIAGNOSTIC:' + JSON.stringify(bad))).toBeNull();
        }
        expect(domain.parseDiagnosticOutput('CHECKOUT_DEBUG_SUCCESS')).toBeNull();
        expect(domain.sanitizeDiagnosticReport(finalReport({ checks: [...finalReport().checks, { id: 'tax', status: 'failed' }] }))).toBeNull();
        expect(domain.sanitizeDiagnosticReport(finalReport({ checkout: { ...finalReport().checkout, currency: null } }))).toBeNull();
    });
    it('keeps generated links explicitly unverified and discards sensitive unknown report fields', () => {
        const report = domain.sanitizeDiagnosticReport(finalReport({ mode: 'link', token: 'private',
            message: 'fixture@example.test https://example.test/private PAYMENT_SUCCESS',
            checkout: { url: fixtures[0].url, confirmed: true, expiresAt: '2099-01-01', secret: 'private' } }));
        expect(report.checkout.confirmed).toBe(false);
        expect(report.checkout.expiresAt).toBeNull();
        expect(JSON.stringify(report)).not.toContain('private');
        expect(JSON.stringify(report)).not.toContain('fixture@example.test');
        expect(report.message).not.toContain('PAYMENT_SUCCESS');
    });
    it.each(['http://chatgpt.com/checkout/x', 'https://chatgpt.com.evil.test/checkout/x', 'https://user@chatgpt.com/checkout/x',
        'https://chatgpt.com:444/checkout/x', 'javascript:alert(1)', 'https://chatgpt.com/'])('rejects untrusted URLs %s', url => {
        expect(domain.trustedCheckoutUrl(url, 'chatgpt')).toBeNull();
    });
    it('redacts all three platform credential formats and Stripe secrets before emitting failure reports', () => {
        const message = 'sessionKey=sk-ant-sid01-offline-secret; sso=offline-grok-secret; auth_token=offline-x-secret; client_secret=offline-stripe-secret';
        const safe = domain.safeDiagnosticMessage(message);
        for (const secret of ['offline-secret', 'offline-grok-secret', 'offline-x-secret', 'offline-stripe-secret']) expect(safe).not.toContain(secret);
    });
});

async function runDiagnostic(fixture, { mode = 'checkout', apiError, inspectionConfirmed = true, setupError, cancelDuringScreenshot = false, claudeAccountConfirmed = true } = {}) {
    const output = [];
    const signalHandlers = new Map();
    const page = { on() {}, url: () => fixture.url, isClosed: () => false };
    const context = { newPage: async () => page, addInitScript: async () => {}, close: async () => {} };
    const login = { email: 'fixture@example.test', session: { accessToken: 'offline-token' } };
    const methods = Object.fromEntries(['installChatGptSession', 'bootstrapChatGptSession', 'injectClaudeSession', 'bootstrapClaudeSession',
        'openClaudeCheckout', 'injectGrokSession', 'bootstrapGrokSession', 'openGrokCheckout', 'openApiCheckout',
        'openPricingCheckout', 'executePaymentWithRetry', 'inspectDiagnosticCheckout'].map(name => [name, vi.fn(async () => login)]));
    methods.openApiCheckout.mockResolvedValue({ checkoutUrl: fixture.url });
    methods.openClaudeCheckout.mockResolvedValue({ url: fixture.url });
    methods.openGrokCheckout.mockResolvedValue({ url: fixture.url, native: true });
    methods.openPricingCheckout.mockResolvedValue(fixture.url);
    methods.inspectDiagnosticCheckout.mockResolvedValue({ confirmed: inspectionConfirmed, amount: 20, currency: 'USD',
        product: 'Offline product', interval: fixture.planType.endsWith('annual') ? 'year' : 'month',
        checks: ['form', 'product', 'amount', 'currency', 'interval'].map(id => ({ id, label: id,
            status: id === 'product' && !inspectionConfirmed ? 'unconfirmed' : 'passed' })) });
    if (apiError) methods.openApiCheckout.mockRejectedValue(apiError);
    methods.getClaudeAccountSnapshot = vi.fn(() => claudeAccountConfirmed ? { accountId: 'offline-account' } : null);
    methods.readClaudeAccountInBrowser = vi.fn(async () => ({ status: 0, account: null }));
    const storeMutation = vi.fn(() => { throw new Error('diagnostic must never access assets'); });
    const dependencies = {
        './payment-retry': methods, './pricing-checkout': methods, './chatgpt': { ...require('../chatgpt'), openApiCheckout: methods.openApiCheckout },
        './chatgpt-cancel-auto-renew': { cancelChatGptAutoRenew: vi.fn() },
        './region-config': require('../region-config'), './session-auth': methods, './claude-auth': methods,
        './pricing-checkout-claude': methods, './claude-cancel-auto-renew': methods, './grok-auth': methods, './pricing-checkout-grok': methods, './grok-cancel-auto-renew': methods,
        './public/grok-plan-catalog': require('../public/grok-plan-catalog'), './grok-commerce': { observeGrokCommerce: () => ({ dispose() {} }) },
        './cdk-plan-catalog': require('../cdk-plan-catalog'), './mysql-store': { verifyCdkDetails: storeMutation, markCdkUsed: storeMutation, reserveCard: storeMutation },
        './browser-runtime': { connectTaskBrowser: async () => { if (setupError) throw setupError;
            return { browser: { newContext: async () => context }, realUserAgent: 'Chrome/147.0' }; }, applyCdpEnv() {}, closeTaskBrowser: vi.fn(async () => {}) },
        './playwright-proxy': { preparePlaywrightProxy: async () => ({ cleanup: async () => {}, proxyConfig: null }) },
        './proxy-preflight': { checkProxyConnectivity: vi.fn(), checkEgressRegion: vi.fn(async (_context, expectedRegion) => ({
            expectedRegion, actualRegion: expectedRegion, transport: 'fixture'
        })) }, './task-diagnostics': { captureDiagnosticScreenshot: async () => {
            if (cancelDuringScreenshot) signalHandlers.get('SIGTERM')?.();
            return null;
        } },
        './checkout-diagnostic': { ...domain, createDiagnosticReporter: input => domain.createDiagnosticReporter(input, line => output.push(line)) },
        './checkout-diagnostic-inspection': methods, fs: { mkdirSync() {} }, path
    };
    const module = { exports: {} };
    const process = { env: { ...domain.buildDiagnosticRuntimeEnv(resolve(fixture, { mode }), {}, 'diag-offline'), RECORD_VIDEO: '0' }, exitCode: 0,
        once: (name, fn) => signalHandlers.set(name, fn), removeListener: name => signalHandlers.delete(name) };
    vm.runInNewContext(worker.slice(0, worker.indexOf('run().finally(')) + '\nmodule.exports = { run };', {
        module, process, __dirname: root, console: { log: line => output.push(String(line)), warn() {}, error() {} },
        require: key => { if (!(key in dependencies)) throw new Error(`Unexpected dependency: ${key}`); return dependencies[key]; }
    });
    await module.exports.run();
    return { methods, storeMutation, process, report: domain.parseDiagnosticOutput(output.join('\n')), dependencies };
}

describe('actual worker diagnostic boundary with offline adapters', () => {
    it.each(fixtures)('$platform uses formal checkout components and returns before any payment or asset action', async fixture => {
        const h = await runDiagnostic(fixture);
        expect(h.report).toMatchObject({ success: true, paymentSubmitted: false, checkout: { confirmed: true } });
        expect(h.methods.inspectDiagnosticCheckout).toHaveBeenCalledOnce();
        expect(h.methods.executePaymentWithRetry).not.toHaveBeenCalled();
        expect(h.storeMutation).not.toHaveBeenCalled();
        if (fixture.platform === 'chatgpt') expect(h.methods.openApiCheckout.mock.calls[0][1].verifyPage).toBe(true);
    });
    it('link mode creates a URL without pretending to inspect the checkout', async () => {
        const h = await runDiagnostic(fixtures[0], { mode: 'link' });
        expect(h.report).toMatchObject({ success: true, checkout: { confirmed: false, kind: 'link' } });
        expect(h.methods.openApiCheckout.mock.calls[0][1].verifyPage).toBe(false);
        expect(h.methods.inspectDiagnosticCheckout).not.toHaveBeenCalled();
        expect(h.methods.executePaymentWithRetry).not.toHaveBeenCalled();
    });
    it('full diagnostics can use the formal UI fallback but expired auth never falls back', async () => {
        const fallback = await runDiagnostic(fixtures[0], { apiError: new Error('temporary API failure') });
        expect(fallback.methods.openPricingCheckout).toHaveBeenCalledOnce();
        expect(fallback.report.success).toBe(true);
        const denied = await runDiagnostic(fixtures[0], { apiError: Object.assign(new Error('token_expired'), { code: 'CHECKOUT_AUTH_ERROR' }) });
        expect(denied.methods.openPricingCheckout).not.toHaveBeenCalled();
        expect(denied.report.success).toBe(false);
        expect(denied.methods.executePaymentWithRetry).not.toHaveBeenCalled();
    });
    it('unconfirmed inspection and browser setup failures are preserved as failed reports', async () => {
        for (const options of [{ inspectionConfirmed: false }, { setupError: new Error('browser unavailable') }]) {
            const h = await runDiagnostic(fixtures[0], options);
            expect(h.report.success).toBe(false);
            expect(h.process.exitCode).toBe(1);
            expect(h.methods.executePaymentWithRetry).not.toHaveBeenCalled();
            expect(h.dependencies['./browser-runtime'].closeTaskBrowser).toHaveBeenCalledOnce();
        }
    });
    it('cancelling during screenshot capture cannot turn into a successful diagnostic', async () => {
        const h = await runDiagnostic(fixtures[0], { cancelDuringScreenshot: true });
        expect(h.report).toMatchObject({ success: false, code: 'DIAGNOSTIC_CANCELLED', paymentSubmitted: false });
        expect(h.process.exitCode).toBe(1);
        expect(h.methods.executePaymentWithRetry).not.toHaveBeenCalled();
    });
    it('Claude cannot report login success from a merely opened upgrade page', async () => {
        const h = await runDiagnostic(fixtures[1], { claudeAccountConfirmed: false });
        expect(h.report).toMatchObject({ success: false, code: 'DIAGNOSTIC_SESSION_UNCONFIRMED' });
        expect(h.report.checks).toContainEqual(expect.objectContaining({ id: 'session', status: 'unconfirmed' }));
        expect(h.methods.executePaymentWithRetry).not.toHaveBeenCalled();
    });
});
