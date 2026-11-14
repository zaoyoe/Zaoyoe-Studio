import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../session-auth.js', import.meta.url));
const source = fs.readFileSync(new URL('../session-auth.js', import.meta.url), 'utf8');
const session = { accessToken: 'private-access-token', user: { id: 'fixture-user', email: 'fixture@example.test' } };
const response = (data, status = 200) => ({ status, text: async () => JSON.stringify(data) });
const me = () => response({ id: 'fixture-user', email: 'fixture@example.test' });
const subscription = () => response({ accounts: { default: { account: { plan_type: 'free' }, entitlement: { has_active_subscription: false } } } });
const connectError = status => new Error(`Proxy rejected the CONNECT tunnel with status code ${status}. http://private-user:private-password@proxy.example`);

function harness(fetch, transport = 'impit') {
    const close = vi.fn(async () => {});
    const log = vi.fn();
    const sandbox = { module: { exports: {} }, Buffer, Date, AbortController, setTimeout, clearTimeout,
        process: { env: {} }, console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        require: name => {
            if (name === 'impit') {
                if (transport === 'undici') throw new Error('offline fixture transport');
                return { Impit: class { fetch = fetch; } };
            }
            if (name === 'undici') return { fetch, ProxyAgent: class { close = close; } };
            return require(name);
        } };
    vm.runInNewContext(source, sandbox);
    const run = (options = {}, raw = session) => sandbox.module.exports.verifyChatGptSessionProtocol(JSON.stringify(raw), {
        proxy: 'http://private-user:private-password@proxy.example:8000', timeoutMs: 7000, log, ...options
    });
    const diagnostics = () => log.mock.calls.map(([line]) => JSON.parse(line.slice('[Session/http] '.length)));
    return { run, diagnostics, log, fetch, close };
}

describe('protocol Session request diagnostics', () => {
    it.each(['impit', 'undici'])('records only safe endpoint metadata for %s', async transport => {
        const h = harness(vi.fn(async url => url.endsWith('/me') ? me() : subscription()), transport);
        await expect(h.run()).resolves.toMatchObject({ ok: true, email: session.user.email });
        expect(h.diagnostics()).toMatchObject([
            { endpoint: 'identity', transport, attempt: 1, httpStatus: 200, connectStatus: null, result: 'json_response' },
            { endpoint: 'subscription', transport, attempt: 1, httpStatus: 200, connectStatus: null, result: 'json_response' }
        ]);
        expect(JSON.stringify(h.diagnostics())).not.toMatch(/private-|fixture|proxy\.example|Bearer|Cookie|chatgpt\.com/);
        if (transport === 'undici') expect(h.close).toHaveBeenCalledOnce();
    });

    it.each([400, 401, 403, 407, 429])('does not retry an explicit proxy CONNECT %s refusal or call it an account expiry', async status => {
        const h = harness(vi.fn(async () => { throw connectError(status); }));
        const result = await h.run();
        expect(result).toMatchObject({ ok: false, status: 0, connectStatus: status,
            failureKind: [401, 407].includes(status) ? 'proxy_auth' : 'proxy_connect' });
        expect(result.error).toContain(`HTTP ${status}`);
        expect(result.error).not.toMatch(/private-|proxy\.example|CHATGPT_SESSION_EXPIRED/);
        expect(h.fetch).toHaveBeenCalledTimes(2);
        expect(h.diagnostics().every(entry => entry.attempt === 1 && entry.connectStatus === status)).toBe(true);
    });

    it('retains the existing two-request budget for transient CONNECT 502 errors', async () => {
        const h = harness(vi.fn(async () => { throw connectError(502); }));
        await expect(h.run()).resolves.toMatchObject({ ok: false, status: 0, connectStatus: 502, failureKind: 'proxy_connect' });
        expect(h.fetch).toHaveBeenCalledTimes(4);
        expect(h.diagnostics().filter(value => value.attempt === 2)).toHaveLength(2);
        expect(JSON.stringify(h.diagnostics())).not.toMatch(/private-|proxy\.example/);
    });

    it.each([403, 429])('preserves HTTP %s when the parallel identity request has a network failure', async status => {
        const h = harness(vi.fn(async url => {
            if (url.endsWith('/me')) throw connectError(502);
            return response({ error: 'private-response' }, status);
        }));
        await expect(h.run()).resolves.toMatchObject({ ok: false, status, error: `HTTP ${status}`, challenge: status === 403 });
        expect(h.fetch.mock.calls.filter(([url]) => url.includes('/accounts/'))).toHaveLength(1);
        expect(JSON.stringify(h.diagnostics())).not.toContain('private-response');
    });

    it('keeps a confirmed official 401 terminal even when the other endpoint cannot connect', async () => {
        const h = harness(vi.fn(async url => {
            if (url.endsWith('/me')) throw connectError(400);
            return response({ error: 'invalid_token' }, 401);
        }));
        await expect(h.run()).rejects.toMatchObject({ code: 'CHATGPT_SESSION_EXPIRED' });
    });

    it('keeps an already active subscription terminal when identity verification cannot connect', async () => {
        const h = harness(vi.fn(async url => {
            if (url.endsWith('/me')) throw connectError(400);
            return response({ accounts: { default: { account: { plan_type: 'plus' }, entitlement: { has_active_subscription: true } } } });
        }));
        await expect(h.run()).rejects.toMatchObject({ code: 'ACCOUNT_ALREADY_SUBSCRIBED' });
    });

    it('rejects an official account mismatch', async () => {
        const h = harness(vi.fn(async url => url.endsWith('/me') ? response({ id: 'other-user', email: 'other@example.test' }) : subscription()));
        await expect(h.run()).rejects.toMatchObject({ code: 'CHATGPT_ACCOUNT_MISMATCH' });
    });

    it('keeps a successful HTTP response with missing identity unconfirmed', async () => {
        const h = harness(vi.fn(async url => url.endsWith('/me') ? response({}) : subscription()));
        await expect(h.run()).resolves.toMatchObject({ ok: false, status: 200, error: expect.stringContaining('未返回完整身份或订阅数据') });
    });

    it('does not retry certificate errors or expose an arbitrary transport error', async () => {
        const h = harness(vi.fn(async () => { throw Object.assign(new Error('private-proxy-certificate'), { code: 'CERT_HAS_EXPIRED' }); }));
        const result = await h.run();
        expect(result).toMatchObject({ ok: false, failureKind: 'certificate' });
        expect(result.error).not.toContain('private-');
        expect(h.fetch).toHaveBeenCalledTimes(2);
    });

    it('does not alter authentication when the optional logger fails', async () => {
        const h = harness(vi.fn(async url => url.endsWith('/me') ? me() : subscription()));
        await expect(h.run({ log: () => { throw new Error('offline logger failure'); } })).resolves.toMatchObject({ ok: true });
    });

    it('derives a deterministic UUID v4 deviceId and injects oai-did when input Session lacks oai-did', async () => {
        const fetch = vi.fn(async url => url.endsWith('/me') ? me() : subscription());
        const h = harness(fetch);
        const result = await h.run();
        expect(result.ok).toBe(true);
        expect(result.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        expect(result.cookieHeader).toContain(`oai-did=${result.deviceId}`);
        for (const [, init] of fetch.mock.calls) {
            expect(init.headers['oai-device-id']).toBe(result.deviceId);
            expect(init.headers.Cookie).toContain(`oai-did=${result.deviceId}`);
        }
        const second = await h.run();
        expect(second.deviceId).toBe(result.deviceId);
    });
});
