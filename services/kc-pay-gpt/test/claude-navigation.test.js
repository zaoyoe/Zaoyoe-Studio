import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { EventEmitter } from 'node:events';
import { navigateClaudeUpgrade, observeClaudeNavigation, assertClaudeNavigationHealthy } from '../claude-navigation.js';
import { bootstrapClaudeSession } from '../claude-auth.js';
import { ensureClaudePlanSelection } from '../claude-checkout-state.js';
import { classifyClaudeNavigationFailure, finalizeRetryAnalysis } from '../task-safety.js';
import fs from 'node:fs';
import vm from 'node:vm';
import * as taskSafety from '../task-safety.js';

let browser;
const contexts = [];
const pendingRoutes = [];
const credential = 'offline-fixture-credential-'.repeat(2);
beforeAll(async () => { browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] }); });
afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(pendingRoutes.splice(0).map(route => route.abort().catch(() => {})));
    await Promise.all(contexts.splice(0).map(context => context.close()));
});
afterAll(async () => { await browser?.close(); });

async function fixture(body, { stalledScript = false, status = 200 } = {}) {
    const context = await browser.newContext(); contexts.push(context);
    const navigations = [];
    await context.route('**/*', route => {
        if (route.request().resourceType() === 'script') {
            if (stalledScript) { pendingRoutes.push(route); return; }
            return route.abort();
        }
        if (!route.request().isNavigationRequest()) return route.fulfill({ status: 401, json: {} });
        navigations.push(route.request().url());
        return route.fulfill({ status, contentType: 'text/html; charset=utf-8', body });
    });
    return { page: await context.newPage(), navigations };
}

describe('Claude navigation state and recovery', () => {
    it('detects the screenshot connection banner while DOMContentLoaded is still blocked', async () => {
        const { page, navigations } = await fixture('<p>Can\'t reach Claude. Check your connection. Try again</p><script src="/stalled.js"></script>', { stalledScript: true });
        const log = vi.fn(); const start = performance.now();
        await expect(navigateClaudeUpgrade(page, 'https://claude.ai/upgrade/pro', { log, primaryTimeoutMs: 5000 })).rejects.toMatchObject({ code: 'CLAUDE_NAV_NETWORK_ERROR' });
        expect(performance.now() - start).toBeLessThan(2000);
        expect(navigations).toEqual(['https://claude.ai/upgrade/pro']);
        expect(JSON.stringify(log.mock.calls)).toContain('document:HTTP200');
        expect(page.listenerCount('requestfailed')).toBe(0);
    });
    it('continues from a rendered checkout boundary despite a stalled unrelated script', async () => {
        const { page, navigations } = await fixture('<h1>设置您的套餐</h1><label><input type="radio" checked>Pro 按月计费</label><div>今日应付 USD20</div><script src="/stalled.js"></script>', { stalledScript: true });
        expect(await navigateClaudeUpgrade(page, 'https://claude.ai/upgrade/pro', { primaryTimeoutMs: 1000, log: vi.fn() })).toMatchObject({ boundary: 'checkout' });
        expect(navigations).toHaveLength(1);
        expect(await ensureClaudePlanSelection(page, 'claude_pro')).toEqual({ amount: 20, currency: 'USD' });
    });
    it('keeps a real blank loading page bounded and never calls it authenticated or paid', async () => {
        const { page, navigations } = await fixture('<script src="/stalled.js"></script>', { stalledScript: true });
        await expect(navigateClaudeUpgrade(page, 'https://claude.ai/upgrade/pro', {
            primaryTimeoutMs: 250, fallbackTimeoutMs: 250, log: vi.fn()
        })).rejects.toMatchObject({ code: 'CLAUDE_NAV_NAVIGATION_TIMEOUT' });
        expect(navigations).toEqual(['https://claude.ai/upgrade/pro', 'https://claude.ai/upgrade']);
    });
    it('still uses the fallback when the primary route never receives a response', async () => {
        const { page } = await fixture('<p>Fallback page</p>');
        const goto = page.goto.bind(page);
        const spy = vi.spyOn(page, 'goto').mockImplementationOnce(async () => { throw new Error('page.goto: Timeout exceeded'); }).mockImplementation(goto);
        expect(await navigateClaudeUpgrade(page, 'https://claude.ai/upgrade/pro', { log: vi.fn() })).toMatchObject({ ready: true });
        expect(spy).toHaveBeenCalledTimes(2);
        expect(page.url()).toBe('https://claude.ai/upgrade');
    });
    it('does not redundantly navigate the same origin after an explicit transport error', async () => {
        const { page } = await fixture('<p>unused</p>');
        const spy = vi.spyOn(page, 'goto').mockRejectedValue(new Error('net::ERR_CONNECTION_CLOSED private-credential'));
        const log = vi.fn();
        await expect(navigateClaudeUpgrade(page, 'https://claude.ai/upgrade/pro', { log })).rejects.toMatchObject({ code: 'CLAUDE_NAV_NETWORK_ERROR' });
        expect(spy).toHaveBeenCalledOnce();
        expect(JSON.stringify(log.mock.calls)).toContain('ERR_CONNECTION_CLOSED');
        expect(JSON.stringify(log.mock.calls)).not.toContain('private-credential');
    });
    it.each([['<p>App unavailable in your region</p>', 'CLAUDE_NAV_REGION_UNAVAILABLE'], ['<p>Claude is not available</p>', 'CLAUDE_NAV_REGION_UNAVAILABLE']])('stops on explicit region restriction', async (body, code) => {
        const { page, navigations } = await fixture(body);
        await expect(navigateClaudeUpgrade(page, 'https://claude.ai/upgrade/pro', { log: vi.fn() })).rejects.toMatchObject({ code });
        expect(navigations).toHaveLength(1);
    });
    it('stops on official HTTP rejection without automatic path fallback', async () => {
        const { page, navigations } = await fixture('<p>Access denied</p>', { status: 403 });
        await expect(navigateClaudeUpgrade(page, 'https://claude.ai/upgrade/pro', { log: vi.fn() })).rejects.toMatchObject({ code: 'CLAUDE_NAV_HTTP_ERROR' });
        expect(navigations).toHaveLength(1);
    });
    it('catches the connection banner appearing after navigation', async () => {
        const { page } = await fixture('<p>Initial loading</p>');
        await navigateClaudeUpgrade(page, 'https://claude.ai/upgrade/pro', { log: vi.fn() });
        await page.setContent('<p>Can\'t reach Claude. Check your connection.</p>');
        await expect(assertClaudeNavigationHealthy(page)).rejects.toMatchObject({ code: 'CLAUDE_NAV_NETWORK_ERROR' });
        await expect(ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 1000 })).rejects.toMatchObject({ code: 'CLAUDE_NAV_NETWORK_ERROR' });
    });
    it('checks a connection failure before attempting account metadata', async () => {
        const { page } = await fixture('<p>Can\'t reach Claude. Check your connection.</p>');
        await expect(bootstrapClaudeSession(page, credential, { log: vi.fn() })).rejects.toMatchObject({ code: 'CLAUDE_NAV_NETWORK_ERROR' });
        expect(page.listenerCount('response')).toBe(0);
        expect(page.listenerCount('requestfailed')).toBe(0);
    });
    it('checks a connection banner appearing while account metadata is still pending', async () => {
        const context = await browser.newContext(); contexts.push(context);
        await context.route('**/*', async route => {
            if (route.request().url().endsWith('/api/auth/current_account')) {
                await new Promise(resolve => setTimeout(resolve, 200));
                return route.fulfill({ status: 200, json: { account: { id: 'offline-account' } } }).catch(() => {});
            }
            return route.fulfill({ contentType: 'text/html', body: '<p>Initial page</p><script>fetch("/api/auth/current_account");setTimeout(()=>document.querySelector("p").textContent="Can\'t reach Claude. Check your connection.",80)</script>' });
        });
        const page = await context.newPage();
        const log = vi.fn();
        await expect(bootstrapClaudeSession(page, credential, { log })).rejects.toMatchObject({ code: 'CLAUDE_NAV_NETWORK_ERROR' });
        expect(JSON.stringify(log.mock.calls)).toContain('account:HTTP200');
        expect(page.listenerCount('response')).toBe(0);
    });
});

describe('navigation diagnostics redact by construction', () => {
    it('distinguishes response headers from completed transfer and tracks pending Stripe requests safely', () => {
        const page = new EventEmitter(); page.mainFrame = () => ({});
        const observer = observeClaudeNavigation(page);
        const request = { url: () => 'https://js.stripe.com/v3/elements-inner-payment.html?token=private',
            resourceType: () => 'document', isNavigationRequest: () => true, failure: () => null };
        page.emit('request', request);
        page.emit('response', { request: () => request, status: () => 200 });
        expect(observer.details()).toMatch(/stripe_frame:headers\(count=1, avg=\d+ms, max=\d+ms\)/);
        expect(observer.details()).toContain('stripe_frame:pending(count=1');
        page.emit('requestfinished', request);
        expect(observer.details()).toContain('stripe_frame:complete(count=1');
        expect(observer.details()).not.toMatch(/pending|private|token|https:/);
        observer.dispose();
        for (const event of ['request', 'response', 'requestfailed', 'requestfinished']) expect(page.listenerCount(event)).toBe(0);
    });

    it('removes failed requests from pending diagnostics and ignores deliberate cancellation as a proxy failure', () => {
        const page = new EventEmitter(); page.mainFrame = () => ({});
        const observer = observeClaudeNavigation(page);
        const request = { url: () => 'https://claude.ai/api/organizations/private/billing/checkout',
            resourceType: () => 'fetch', isNavigationRequest: () => false, failure: () => ({ errorText: 'net::ERR_ABORTED token=private' }) };
        page.emit('request', request); page.emit('requestfailed', request);
        expect(observer.details()).toContain('billing:failed(count=1');
        expect(observer.details()).not.toMatch(/pending|private|token|https:/);
        expect(observer.networkFailure()).toBeNull();
        observer.dispose();
    });

    it('records categories, HTTP status and transport codes without paths, queries, headers or bodies', () => {
        const page = new EventEmitter(); const frame = {}; page.mainFrame = () => frame;
        const request = (url, type, error = '') => ({ url: () => url, resourceType: () => type,
            isNavigationRequest: () => type === 'document', frame: () => frame, failure: () => ({ errorText: error }),
            headers: () => { throw new Error('must not read headers'); }, postData: () => { throw new Error('must not read body'); } });
        const observer = observeClaudeNavigation(page);
        const doc = request('https://claude.ai/upgrade/pro?secret=private', 'document');
        const script = request('https://claude.ai/_next/static/private-script.js?token=private', 'script', 'net::ERR_CONNECTION_RESET secret=private');
        page.emit('request', doc);
        page.emit('response', { request: () => doc, status: () => 200 });
        page.emit('requestfailed', script);
        page.emit('requestfailed', request('https://telemetry.example/private', 'script', 'net::ERR_FAILED'));
        expect(observer.summary()).toBe('document:requested=1, document:HTTP200=1, script:ERR_CONNECTION_RESET=1');
        expect(observer.summary()).not.toMatch(/private|secret|token|https:/);
        observer.dispose(); expect(page.listenerCount('request')).toBe(0);
    });
    it('records failed bootstrap APIs and official asset scripts without account identifiers', () => {
        const page = new EventEmitter(); page.mainFrame = () => ({});
        const observer = observeClaudeNavigation(page);
        const request = url => ({ url: () => url, resourceType: () => url.includes('/api/') ? 'fetch' : 'script', isNavigationRequest: () => false,
            failure: () => ({ errorText: 'net::ERR_CONNECTION_CLOSED secret=private' }) });
        page.emit('requestfailed', request('https://claude.ai/api/organizations/private-id?secret=private'));
        page.emit('requestfailed', request('https://assets.claude.ai/private.js'));
        expect(observer.summary()).toBe('api:ERR_CONNECTION_CLOSED=1, script:ERR_CONNECTION_CLOSED=1');
        observer.dispose();
    });
});

describe('prepayment navigation classification and retry exhaustion', () => {
    const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
    const start = source.indexOf('function extractRuntimeErrorMessage(');
    const end = source.indexOf('\nfunction ', source.indexOf('function analyzeProcessOutput(') + 10);
    function analyze(output) {
        const sandbox = { ...taskSafety, input: output };
        vm.runInNewContext(source.slice(start, end) + '\nresult = analyzeProcessOutput(input, false);', sandbox);
        return sandbox.result;
    }
    it.each(['NETWORK_ERROR', 'NAVIGATION_TIMEOUT'])('retries marked prepayment %s failures and gives a final exhausted message', code => {
        const analysis = analyze(`❌ [运行时错误]: 连接失败 [CLAUDE_NAV_${code}]`);
        expect(analysis).toMatchObject({ shouldRetry: true, reachedPayment: false, paymentState: 'not_started' });
        expect(finalizeRetryAnalysis(analysis)).toMatchObject({ status: 'failed', shouldRetry: false, message: expect.stringContaining('自动重试后仍无法连接') });
    });
    it.each(['HTTP_ERROR', 'AUTH_REQUIRED', 'REGION_UNAVAILABLE', 'SITE_MISMATCH'])('does not retry %s', code => {
        expect(classifyClaudeNavigationFailure(`error [CLAUDE_NAV_${code}]`, null)).toMatchObject({ shouldRetry: false });
    });
    it.each(['started', 'unknown', 'succeeded', 'declined', 'legacy_invalid'])('does not override payment state %s', state => {
        expect(classifyClaudeNavigationFailure('error [CLAUDE_NAV_NETWORK_ERROR]', state)).toBeNull();
    });
    it('preserves submitted unknown payment and keeps its card/CDK for review', () => {
        expect(analyze('PAYMENT_STATE:unknown\n❌ [运行时错误]: error [CLAUDE_NAV_NETWORK_ERROR]')).toMatchObject({ status: 'manual', shouldRetry: false });
    });
    it('corrects legacy network retry copy after exhaustion without changing manual results', () => {
        expect(finalizeRetryAnalysis({ status: 'retry', shouldRetry: true, message: '连接失败，已自动切换代理重试' })).toMatchObject({ status: 'failed', shouldRetry: false, message: '连接失败，自动重试已耗尽，请稍后重试' });
        const manual = { status: 'manual', shouldRetry: false }; expect(finalizeRetryAnalysis(manual)).toBe(manual);
    });
    it.each(['LOADING_TIMEOUT', 'INTERACTION_TIMEOUT'])('retries a marked prepayment checkout readiness failure %s', code => {
        const analysis = analyze(`❌ [运行时错误]: 暂时无法操作 [CLAUDE_CHECKOUT_${code}]`);
        expect(analysis).toMatchObject({ shouldRetry: true, reachedPayment: false, paymentState: 'not_started' });
        expect(finalizeRetryAnalysis(analysis)).toMatchObject({ status: 'failed', shouldRetry: false });
    });
    it.each(['started', 'unknown', 'succeeded', 'declined', 'legacy_invalid'])('never retries checkout readiness failure over payment state %s', state => {
        expect(taskSafety.classifyClaudeCheckoutReadinessFailure('error [CLAUDE_CHECKOUT_LOADING_TIMEOUT]', state)).toBeNull();
    });
    it('does not retry a price mismatch as a page loading failure', () => {
        expect(taskSafety.classifyClaudeCheckoutReadinessFailure('资金安全拦截 [CLAUDE_CHECKOUT_MISMATCH]', 'not_started')).toBeNull();
        expect(analyze('PAYMENT_STATE:unknown\n❌ [运行时错误]: error [CLAUDE_CHECKOUT_LOADING_TIMEOUT]')).toMatchObject({ status: 'manual', shouldRetry: false });
    });
});
