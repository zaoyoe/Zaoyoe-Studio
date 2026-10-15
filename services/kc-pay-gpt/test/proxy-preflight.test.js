import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { parseProbeIp, checkProxyConnectivity } from '../proxy-preflight.js';
import { classifyProxyPreflightFailure } from '../task-safety.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import * as taskSafety from '../task-safety.js';

const response = (body, status = 200) => ({ ok: () => status === 200, status: () => status,
    text: vi.fn(async () => body), dispose: vi.fn(async () => {}) });
const tlsError = () => new Error('apiRequestContext.get: write EPROTO wrong version number https://private-user:private-password@proxy.example/');
function mockContext(get, goto) {
    const page = { goto, close: vi.fn(async () => {}), video: () => null };
    return { request: { get }, newPage: vi.fn(async () => page), page };
}

describe('proxy IP preflight recovery', () => {
    it.each(['203.0.113.2', ' 203.0.113.2\n', '2001:db8::1'])('accepts a complete IP: %s', value => {
        expect(parseProbeIp(value)).toBe(value.trim());
    });
    it.each(['', '203.0.113.2 extra', '<html>203.0.113.2</html>', '999.1.1.1', 'success', '127.0.0.1\nsecret'])('rejects malformed IP response: %s', value => {
        expect(parseProbeIp(value)).toBeNull();
    });
    it('has no browser fallback overhead when the first probe succeeds', async () => {
        const resp = response('203.0.113.2');
        const context = mockContext(vi.fn(async () => resp), vi.fn());
        expect(await checkProxyConnectivity(context, { log: vi.fn() })).toEqual({ ip: '203.0.113.2', transport: 'request' });
        expect(context.newPage).not.toHaveBeenCalled();
        expect(resp.dispose).toHaveBeenCalledOnce();
    });
    it('recovers a first failed TLS handshake through the second endpoint', async () => {
        const context = mockContext(vi.fn().mockRejectedValueOnce(tlsError()).mockResolvedValueOnce(response('203.0.113.2')), vi.fn());
        const log = vi.fn();
        expect(await checkProxyConnectivity(context, { log })).toMatchObject({ transport: 'request' });
        expect(context.request.get).toHaveBeenCalledTimes(2);
        expect(context.newPage).not.toHaveBeenCalled();
        expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    });
    it('recovers two Node TLS failures with a same-context browser navigation and closes its page', async () => {
        const context = mockContext(vi.fn(async () => { throw tlsError(); }), vi.fn(async () => response('203.0.113.2')));
        expect(await checkProxyConnectivity(context, { log: vi.fn() })).toEqual({ ip: '203.0.113.2', transport: 'browser' });
        expect(context.request.get).toHaveBeenCalledTimes(2);
        expect(context.page.goto).toHaveBeenCalledOnce();
        expect(context.page.close).toHaveBeenCalledOnce();
        for (const [, options] of context.request.get.mock.calls) {
            expect(options).toMatchObject({ maxRetries: 0, maxRedirects: 0 });
            expect(options.ignoreHTTPSErrors).toBeUndefined();
        }
    });
    it('rejects persistent failure with a Chinese error and no credentials/raw stack', async () => {
        const context = mockContext(vi.fn(async () => { throw tlsError(); }), vi.fn(async () => { throw tlsError(); }));
        const log = vi.fn();
        await expect(checkProxyConnectivity(context, { log })).rejects.toMatchObject({ code: 'PROXY_PREFLIGHT_NETWORK', message: expect.stringContaining('尚未提交支付') });
        expect(context.request.get).toHaveBeenCalledTimes(2);
        expect(context.page.goto).toHaveBeenCalledTimes(2);
        expect(context.page.close).toHaveBeenCalledOnce();
        expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|EPROTO|proxy\.example/);
    });
    it('does not accept a 200 HTML error page as proof of working proxy', async () => {
        const context = mockContext(vi.fn(async () => response('<html>error</html>')), vi.fn(async () => response('not an IP')));
        await expect(checkProxyConnectivity(context, { log: vi.fn() })).rejects.toMatchObject({ code: 'PROXY_PREFLIGHT_NETWORK' });
    });
    it.each([407, 597])('does not retry an explicit proxy authentication failure %s', async status => {
        const context = mockContext(vi.fn(async () => response('auth failed', status)), vi.fn());
        await expect(checkProxyConnectivity(context, { log: vi.fn() })).rejects.toMatchObject({ code: 'PROXY_PREFLIGHT_AUTH' });
        expect(context.request.get).toHaveBeenCalledOnce();
        expect(context.newPage).not.toHaveBeenCalled();
    });
    it('keeps certificate errors terminal and never disables certificate checks', async () => {
        const context = mockContext(vi.fn(async () => { throw new Error('certificate has expired'); }), vi.fn());
        await expect(checkProxyConnectivity(context, { log: vi.fn() })).rejects.toMatchObject({ code: 'PROXY_PREFLIGHT_CERTIFICATE' });
        expect(context.newPage).not.toHaveBeenCalled();
    });
    it('honors a single shared time budget without launching probes after the deadline', async () => {
        const context = mockContext(vi.fn(async () => {
            await new Promise(resolve => setTimeout(resolve, 30)); throw tlsError();
        }), vi.fn());
        await expect(checkProxyConnectivity(context, { log: vi.fn(), timeoutMs: 10 })).rejects.toMatchObject({ code: 'PROXY_PREFLIGHT_NETWORK' });
        expect(context.request.get).toHaveBeenCalledOnce();
        expect(context.newPage).not.toHaveBeenCalled();
    });
});

describe('server preflight retry safety', () => {
    const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
    const start = source.indexOf('function extractRuntimeErrorMessage(');
    const end = source.indexOf('\nfunction ', source.indexOf('function analyzeProcessOutput(') + 10);
    const analyze = (output) => {
        const context = { ...taskSafety };
        const sandbox = { ...context, input: output };
        vm.runInNewContext(source.slice(start, end) + '\nresult = analyzeProcessOutput(input, false);', sandbox);
        return sandbox.result;
    };
    it('automatically retries only a marked prepayment transient network failure', () => {
        const result = analyze('❌ [运行时错误]: 代理连接暂时异常；尚未提交支付 [PROXY_PREFLIGHT_NETWORK]');
        expect(result).toMatchObject({ shouldRetry: true, status: 'retry', paymentState: 'not_started', reachedPayment: false });
    });
    it.each(['AUTH', 'CERTIFICATE'])('does not retry preflight %s configuration problems', code => {
        expect(classifyProxyPreflightFailure(`error [PROXY_PREFLIGHT_${code}]`, null)).toMatchObject({ shouldRetry: false });
    });
    it.each(['started', 'unknown', 'succeeded', 'declined', 'legacy_invalid'])('never applies a preflight retry over payment state %s', state => {
        expect(classifyProxyPreflightFailure('error [PROXY_PREFLIGHT_NETWORK]', state)).toBeNull();
    });
    it('does not turn arbitrary payment TLS errors into a new task retry', () => {
        expect(classifyProxyPreflightFailure(tlsError().message, null)).toBeNull();
        expect(analyze('PAYMENT_STATE:unknown\n❌ [运行时错误]: error [PROXY_PREFLIGHT_NETWORK]')).toMatchObject({ status: 'manual', shouldRetry: false });
    });
});

describe('real Chromium fallback on offline routed IP pages', () => {
    let browser;
    beforeAll(async () => { browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] }); });
    afterAll(async () => { await browser?.close(); });
    it('reads a complete IP from the real browser response after Node TLS probe failures', async () => {
        const context = await browser.newContext();
        try {
            await context.route('**/*', route => route.fulfill({ contentType: 'text/plain', body: '203.0.113.2\n' }));
            const get = vi.spyOn(context.request, 'get').mockRejectedValue(tlsError());
            expect(await checkProxyConnectivity(context, { log: vi.fn() })).toEqual({ ip: '203.0.113.2', transport: 'browser' });
            expect(get).toHaveBeenCalledTimes(2);
            expect(context.pages()).toHaveLength(0);
        } finally { await context.close(); }
    });
    it('removes the temporary preflight recording without waiting for the payment context to close', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-preflight-video-'));
        const context = await browser.newContext({ recordVideo: { dir } });
        try {
            await context.route('**/*', route => route.fulfill({ contentType: 'text/plain', body: '203.0.113.2' }));
            vi.spyOn(context.request, 'get').mockRejectedValue(tlsError());
            expect(await checkProxyConnectivity(context, { log: vi.fn() })).toMatchObject({ transport: 'browser' });
            expect(context.pages()).toHaveLength(0);
            expect(fs.readdirSync(dir)).toHaveLength(0);
        } finally { await context.close(); fs.rmSync(dir, { recursive: true, force: true }); }
    });
});
