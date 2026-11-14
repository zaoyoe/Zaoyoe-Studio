import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../chatgpt.js', import.meta.url), 'utf8');
const headers = {
    'content-type': 'application/json; charset=utf-8',
    'x-request-id': '4acdb0c0-9768-430d-8c94-08a34c6fc602',
    'cf-ray': '1234567890abcdef-MNL',
    'set-cookie': 'session=private-cookie'
};
function harness(transport = 'playwright', { networkError, sentinel = null, mintInPageSentinelToken } = {}) {
    const fetch = vi.fn(async () => {
        if (networkError) throw networkError;
        return { status: 400, headers: new Headers(headers), text: async () => JSON.stringify({
            error: { message: 'Our systems have detected unusual activity. Please try again later.' }
        }) };
    });
    const post = vi.fn(async () => {
        const result = await fetch();
        return { ...result, status: () => result.status, headers: () => headers };
    });
    const mintSentinelToken = vi.fn(async () => sentinel);
    const close = vi.fn(async () => {});
    const console = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const dependencies = {
        axios: {}, './mysql-store': { resolvePlanName: () => 'chatgptplusplan' },
        './region-config': { getRegionConfig: () => ({ currency: 'PHP' }) },
        './payment-retry': {}, './checkout-diagnostics': require('../checkout-diagnostics'),
        './chatgpt-auth-state': require('../chatgpt-auth-state'), './session-auth': {},
        './sentinel/sentinel-client': mintInPageSentinelToken ? { mintSentinelToken, mintInPageSentinelToken } : { mintSentinelToken },
        undici: { fetch, ProxyAgent: class { close = close; } }
    };
    const sandbox = { module: { exports: {} }, console, Date, setTimeout, clearTimeout, AbortController,
        process: { env: {} }, require: name => {
            if (name === 'impit') {
                if (transport === 'undici') throw new Error('offline impit unavailable');
                return { Impit: class { fetch = fetch; } };
            }
            if (Object.hasOwn(dependencies, name)) return dependencies[name];
            throw new Error(`Unexpected test dependency: ${name}`);
        } };
    vm.runInNewContext(source, sandbox);
    const api = sandbox.module.exports;
    const request = transport === 'playwright' ? { post } : null;
    const run = () => new api.ChatGPTService(request, 'private-access-token').createCheckoutSession('plus', 'PH', 'PHP', null, {
        proxy: 'http://private-user:private-password@proxy.example:8000',
        headers: { 'openai-sentinel-token': 'private-sentinel-token', Cookie: 'session=private-session' }
    });
    const logs = () => [...console.log.mock.calls, ...console.warn.mock.calls, ...console.error.mock.calls].flat().join('\n');
    return { api, request, fetch, post, close, console, mintSentinelToken, run, logs };
}

describe('checkout request diagnostics', () => {
    it.each(['playwright', 'impit', 'undici'])('records safe response metadata for %s without repeating an HTTP refusal', async transport => {
        const h = harness(transport);
        await expect(h.run()).resolves.toMatchObject({ checkoutUrl: null, httpStatus: 400, code: 'CHECKOUT_UNUSUAL_ACTIVITY' });
        expect(h.fetch).toHaveBeenCalledOnce();
        const line = h.console.log.mock.calls.map(([line]) => line).find(line => line.startsWith('[Checkout/http] '));
        expect(JSON.parse(line.slice('[Checkout/http] '.length))).toMatchObject({ transport, status: 400,
            elapsedMs: expect.any(Number), contentType: 'application/json', requestId: headers['x-request-id'], cfRay: headers['cf-ray'] });
        expect(h.logs()).not.toMatch(/private-|proxy\.example|Authorization|Cookie/);
        if (transport === 'undici') expect(h.close).toHaveBeenCalledOnce();
    });
    it('reports an optional metadata read failure without changing the upstream result', async () => {
        const h = harness();
        h.post.mockResolvedValueOnce({ status: () => 400, headers: () => { throw new Error('offline metadata failure'); },
            text: async () => 'Our systems have detected unusual activity.' });
        await expect(h.run()).resolves.toMatchObject({ httpStatus: 400, code: 'CHECKOUT_UNUSUAL_ACTIVITY' });
        expect(h.logs()).toContain('"contentType":"unknown"');
    });
    it('sanitizes transport errors in both logs and the returned failure', async () => {
        const h = harness('playwright', { networkError: new Error('connection failed https://private-user:private-password@proxy.example/?token=private-query Bearer private-access-token') });
        const result = await h.run();
        expect(result.checkoutUrl).toBeNull();
        expect(h.logs()).toContain('"result":"request_error"');
        expect(h.logs() + result.error).not.toMatch(/private-|proxy\.example/);
    });
    it('does not log a successful token injection when no primary token was obtained', async () => {
        const h = harness();
        const page = { context: () => ({ request: h.request }), goto: vi.fn() };
        await expect(h.api.openApiCheckout(page, { accessToken: 'private-access-token',
            planType: 'plus', country: 'PH', currency: 'PHP' })).rejects.toMatchObject({ code: 'CHECKOUT_UNUSUAL_ACTIVITY' });
        expect(h.mintSentinelToken).toHaveBeenCalledOnce();
        expect(h.logs()).toContain('未取得风控主令牌');
        expect(h.logs()).toContain('"sentinelTokenPresent":false');
        expect(h.logs()).not.toContain('风控令牌签发成功');
        expect(h.logs()).not.toMatch(/private-|proxy\.example/);
        expect(h.post).toHaveBeenCalledOnce();
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('logs token presence without copying token, cookie, or device values', async () => {
        const h = harness();
        const page = { context: () => ({ request: h.request }), goto: vi.fn() };
        await expect(h.api.openApiCheckout(page, { accessToken: 'private-access-token',
            planType: 'plus', country: 'PH', currency: 'PHP', deviceId: 'private-device-id',
            sentinelPromise: Promise.resolve({ sentinelToken: 'private-sentinel-token', sentinelSoToken: 'private-so-token' }) }))
            .rejects.toMatchObject({ code: 'CHECKOUT_UNUSUAL_ACTIVITY' });
        expect(h.mintSentinelToken).not.toHaveBeenCalled();
        expect(h.logs()).toContain('"sentinelTokenPresent":true');
        expect(h.logs()).toContain('"sentinelSoTokenPresent":true');
        expect(h.logs()).not.toMatch(/private-|proxy\.example/);
        expect(h.post).toHaveBeenCalledOnce();
    });
    it('uses browser_fetch with ChatGPT-Account-Id and strips forbidden fetch headers when inPageFetch=true', async () => {
        const mintInPageSentinelToken = vi.fn(async () => ({
            sentinelToken: 'private-sentinel-token',
            sentinelSoToken: 'private-so-token',
            telemetry: '[1,2]',
            source: 'browser_sdk'
        }));
        const h = harness('playwright', { mintInPageSentinelToken });
        const evaluateCalls = [];
        const page = {
            url: () => 'https://chatgpt.com/',
            context: () => ({ request: h.request, cookies: async () => [{ name: 'oai-did', value: 'did-cookie' }] }),
            goto: vi.fn(),
            evaluate: vi.fn(async (_fn, arg) => {
                evaluateCalls.push(arg);
                if (!arg) return 'Mozilla/5.0 Chrome/147.0';
                return {
                    status: 200,
                    headers: { 'content-type': 'application/json', 'x-request-id': 'req-inpage', 'cf-ray': 'ray-inpage' },
                    bodyText: JSON.stringify({ checkout_session_id: 'oaics_inpage_123', url: 'https://chatgpt.com/checkout/openai_llc/oaics_inpage_123' })
                };
            })
        };
        const result = await h.api.openApiCheckout(page, {
            accessToken: 'private-access-token',
            planType: 'plus',
            country: 'PH',
            currency: 'PHP',
            accountId: 'acct-123',
            cookieHeader: '__Secure-next-auth.session-token=secret',
            verifyPage: false,
            inPageFetch: true,
            allowOutOfBrowserSentinelFallback: false
        });
        expect(result).toMatchObject({ sessionId: 'oaics_inpage_123', checkoutUrl: 'https://chatgpt.com/checkout/openai_llc/oaics_inpage_123' });
        expect(mintInPageSentinelToken).toHaveBeenCalledWith(page, 'chatgpt_checkout', { waitForSdkMs: 6500, tokenTimeoutMs: 7000 });
        expect(h.mintSentinelToken).not.toHaveBeenCalled();
        expect(h.post).not.toHaveBeenCalled();
        const fetchCall = evaluateCalls.find(item => item && item.url);
        expect(fetchCall.url).toBe('https://chatgpt.com/backend-api/payments/checkout');
        expect(fetchCall.headers).toMatchObject({
            'Authorization': 'Bearer private-access-token',
            'chatgpt-account-id': 'acct-123',
            'openai-sentinel-token': 'private-sentinel-token',
            'openai-sentinel-so-token': 'private-so-token',
            'oai-telemetry': '[1,2]',
            'oai-did': 'did-cookie',
            'Content-Type': 'application/json'
        });
        for (const forbidden of ['Cookie', 'cookie', 'Origin', 'origin', 'Referer', 'referer', 'User-Agent', 'user-agent']) {
            expect(fetchCall.headers[forbidden]).toBeUndefined();
        }
        const httpLine = h.console.log.mock.calls.map(([line]) => line).find(line => line.startsWith('[Checkout/http] '));
        expect(JSON.parse(httpLine.slice('[Checkout/http] '.length))).toMatchObject({ transport: 'browser_fetch', status: 200 });
    });
    it('refuses offline sentinel fallback when allowOutOfBrowserSentinelFallback=false', async () => {
        const mintInPageSentinelToken = vi.fn(async () => null);
        const h = harness('playwright', { mintInPageSentinelToken });
        const page = {
            url: () => 'https://chatgpt.com/',
            context: () => ({ request: h.request, cookies: async () => [] }),
            goto: vi.fn(),
            evaluate: vi.fn(async () => 'Mozilla/5.0 Chrome/147.0')
        };
        await expect(h.api.openApiCheckout(page, {
            accessToken: 'private-access-token',
            planType: 'plus',
            country: 'PH',
            currency: 'PHP',
            inPageFetch: true,
            allowOutOfBrowserSentinelFallback: false
        })).rejects.toMatchObject({ code: 'CHECKOUT_SENTINEL_UNAVAILABLE' });
        expect(h.mintSentinelToken).not.toHaveBeenCalled();
        expect(h.post).not.toHaveBeenCalled();
        expect(h.fetch).not.toHaveBeenCalled();
    });
    it('bounds hanging in-page SentinelSDK evaluation instead of stalling checkout', async () => {
        const sentinelClient = require('../sentinel/sentinel-client');
        const hangingPage = {
            url: () => 'https://chatgpt.com/',
            isClosed: () => false,
            evaluate: vi.fn(() => new Promise(() => {}))
        };
        const result = await sentinelClient.mintInPageSentinelToken(hangingPage, 'chatgpt_checkout', {
            waitForSdkMs: 0,
            tokenTimeoutMs: 100
        });
        expect(result).toBeNull();
    });
    it('reuses pre-started inPageSentinelPromise without re-minting in-page Sentinel tokens', async () => {
        const mintInPageSentinelToken = vi.fn(async () => {
            throw new Error('should not call mintInPageSentinelToken again when inPageSentinelPromise is passed');
        });
        const h = harness('playwright', { mintInPageSentinelToken });
        const page = {
            url: () => 'https://chatgpt.com/#pricing',
            context: () => ({ request: h.request, cookies: async () => [{ name: 'oai-did', value: 'did-cookie' }] }),
            goto: vi.fn(),
            evaluate: vi.fn(async (fn) => {
                const src = String(fn);
                if (src.includes('navigator.userAgent')) return 'Mozilla/5.0 Chrome/147.0';
                return {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                    bodyText: JSON.stringify({ checkout_session_id: 'oaics_parallel_456', url: 'https://chatgpt.com/checkout/openai_llc/oaics_parallel_456' })
                };
            })
        };
        const result = await h.api.openApiCheckout(page, {
            accessToken: 'private-access-token',
            planType: 'plus',
            country: 'PH',
            currency: 'PHP',
            verifyPage: false,
            inPageFetch: true,
            allowOutOfBrowserSentinelFallback: false,
            inPageSentinelPromise: Promise.resolve({
                sentinelToken: 'prefetched-sentinel-token',
                sentinelSoToken: 'prefetched-so-token',
                telemetry: '[1,2]',
                source: 'browser_sdk'
            })
        });
        expect(result).toMatchObject({ sessionId: 'oaics_parallel_456', checkoutUrl: 'https://chatgpt.com/checkout/openai_llc/oaics_parallel_456' });
        expect(mintInPageSentinelToken).not.toHaveBeenCalled();
        expect(h.mintSentinelToken).not.toHaveBeenCalled();
    });
});
