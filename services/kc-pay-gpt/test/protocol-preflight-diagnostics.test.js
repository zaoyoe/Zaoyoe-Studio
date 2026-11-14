import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../proxy-preflight.js', import.meta.url), 'utf8');
const response = (body, status = 200, contentType = 'text/plain; charset=utf-8') => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: () => contentType }, text: vi.fn(async () => body)
});
function harness(fetch, env = { NODE_ENV: 'test' }) {
    const close = vi.fn(async () => {});
    const sandbox = { module: { exports: {} }, AbortController, setTimeout, clearTimeout, Date,
        process: { env }, console: { log: vi.fn(), warn: vi.fn() },
        require: name => name === 'undici' ? { fetch, ProxyAgent: class { close = close; } } : require(name) };
    vm.runInNewContext(source, sandbox);
    const log = vi.fn();
    const run = (options = {}) => sandbox.module.exports.checkProxyAndRegionProtocol(
        'http://private-user:private-password@proxy.example:8000', 'PH', { log, ...options });
    const diagnostics = () => log.mock.calls.map(([line]) => line).filter(line => line.startsWith('[Proxy/preflight/protocol] '))
        .map(line => JSON.parse(line.slice('[Proxy/preflight/protocol] '.length)));
    return { run, log, close, fetch, diagnostics };
}

describe('pure protocol preflight diagnostics', () => {
    it('keeps the successful fast path and records safe timing and region metadata', async () => {
        const h = harness(vi.fn(async () => response('ip=203.0.113.24\nloc=PH\n')));
        await expect(h.run({ probeTimeoutMs: 3500 })).resolves.toMatchObject({
            ip: '203.0.113.24', actualRegion: 'PH', expectedRegion: 'PH', transport: 'protocol', fastPath: true
        });
        expect(h.fetch).toHaveBeenCalledOnce();
        expect(h.close).toHaveBeenCalledOnce();
        expect(h.diagnostics()).toEqual([expect.objectContaining({ probe: 1, total: 2,
            endpoint: 'cloudflare_trace', timeoutMs: 3500, expectedRegion: 'PH', actualRegion: 'PH',
            httpStatus: 200, contentType: 'text/plain', result: 'ok', elapsedMs: expect.any(Number) })]);
        expect(JSON.stringify(h.log.mock.calls)).not.toMatch(/private-|proxy\.example|203\.0\.113/);
    });
    it('records each failed endpoint and preserves the null result when neither confirms the region', async () => {
        const fetch = vi.fn().mockResolvedValueOnce(response('<html>private-body</html>', 503, 'text/html'))
            .mockResolvedValueOnce(response('ip=203.0.113.24\nprivate-body'));
        const h = harness(fetch);
        await expect(h.run()).resolves.toBeNull();
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(h.diagnostics()).toMatchObject([
            { endpoint: 'cloudflare_trace', result: 'http_error', httpStatus: 503, contentType: 'text/html' },
            { endpoint: 'chatgpt_trace', result: 'missing_region', httpStatus: 200, actualRegion: null }
        ]);
        expect(JSON.stringify(h.log.mock.calls)).not.toMatch(/private-|proxy\.example|203\.0\.113/);
        expect(h.close).toHaveBeenCalledOnce();
    });
    it.each([
        ['<html>private-body</html>', 'invalid_trace'],
        ['ip=invalid\nloc=PH', 'invalid_ip'],
        ['ip=203.0.113.24\nloc=XX', 'missing_region']
    ])('distinguishes malformed trace responses without recording their bodies', async (body, result) => {
        const h = harness(vi.fn(async () => response(body)));
        await expect(h.run()).resolves.toBeNull();
        expect(h.diagnostics().map(value => value.result)).toEqual([result, result]);
        expect(JSON.stringify(h.log.mock.calls)).not.toMatch(/private-body|203\.0\.113/);
    });
    it.each([
        ['UND_ERR_CONNECT_TIMEOUT', 'timeout', null],
        ['EPROTO', 'tls_protocol', null],
        ['ECONNRESET', 'connection', null],
        ['CERT_HAS_EXPIRED', 'certificate', 'PROXY_PREFLIGHT_CERTIFICATE']
    ])('classifies wrapped %s without logging exception details', async (code, result, errorCode) => {
        const error = new Error('fetch failed http://private-user:private-password@proxy.example', {
            cause: Object.assign(new Error('private-body'), { code })
        });
        const h = harness(vi.fn(async () => { throw error; }));
        if (errorCode) await expect(h.run()).rejects.toMatchObject({ code: errorCode });
        else await expect(h.run()).resolves.toBeNull();
        expect(h.diagnostics().every(value => value.result === result)).toBe(true);
        expect(h.fetch).toHaveBeenCalledTimes(errorCode ? 1 : 2);
        expect(JSON.stringify(h.log.mock.calls)).not.toMatch(/private-|proxy\.example|fetch failed/);
        expect(h.close).toHaveBeenCalledOnce();
    });
    it('records the configured timeout when an abort has no useful network error text', async () => {
        const h = harness(vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('private-body')), { once: true });
        })));
        await expect(h.run({ url: 'https://custom.example/private-query?token=private-value', probeTimeoutMs: 5 })).resolves.toBeNull();
        expect(h.diagnostics()).toMatchObject([{ endpoint: 'custom_trace', result: 'timeout', timeoutMs: 5 }]);
        expect(JSON.stringify(h.log.mock.calls)).not.toMatch(/custom\.example|private-/);
    });
    it.each([407, 597])('keeps HTTP %s terminal and closes the proxy dispatcher', async status => {
        const h = harness(vi.fn(async () => response('private-body', status)));
        await expect(h.run()).rejects.toMatchObject({ code: 'PROXY_PREFLIGHT_AUTH' });
        expect(h.fetch).toHaveBeenCalledOnce();
        expect(h.diagnostics()).toMatchObject([{ result: 'proxy_auth', httpStatus: status }]);
        expect(h.close).toHaveBeenCalledOnce();
    });
    it('keeps a region mismatch terminal without logging the IP', async () => {
        const h = harness(vi.fn(async () => response('ip=203.0.113.24\nloc=US')));
        await expect(h.run()).rejects.toMatchObject({ code: 'PAYMENT_REGION_NETWORK_MISMATCH' });
        expect(h.fetch).toHaveBeenCalledOnce();
        expect(h.diagnostics()).toMatchObject([{ result: 'region_mismatch', expectedRegion: 'PH', actualRegion: 'US' }]);
    });
    it('still applies the latency gate independently of diagnostic logging', async () => {
        const h = harness(vi.fn(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
            return response('ip=203.0.113.24\nloc=PH');
        }), { NODE_ENV: 'production' });
        await expect(h.run({ maxLatencyMs: 10 })).rejects.toMatchObject({ code: 'PROXY_PREFLIGHT_NETWORK' });
        expect(h.diagnostics()).toMatchObject([{ result: 'high_latency' }]);
        expect(h.fetch).toHaveBeenCalledOnce();
    });
    it('does not reject a valid region when optional response metadata cannot be read', async () => {
        const resp = response('ip=203.0.113.24\nloc=PH');
        resp.headers.get = () => { throw new Error('offline header read failure'); };
        const h = harness(vi.fn(async () => resp));
        await expect(h.run()).resolves.toMatchObject({ actualRegion: 'PH' });
        expect(h.diagnostics()).toMatchObject([{ result: 'ok', contentType: 'unknown' }]);
    });
    it('does not turn a malformed response into an exception when the diagnostic logger fails', async () => {
        const h = harness(vi.fn(async () => response('unconfirmed')));
        await expect(h.run({ log: () => { throw new Error('offline logger failure'); } })).resolves.toBeNull();
        expect(h.fetch).toHaveBeenCalledTimes(2);
        expect(h.close).toHaveBeenCalledOnce();
    });
});
