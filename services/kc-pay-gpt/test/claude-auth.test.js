import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { bootstrapClaudeSession, readClaudeAccountInBrowser, getClaudeAccountSnapshot, fetchClaudeAccount } from '../claude-auth.js';

const require = createRequire(import.meta.url);
const axios = require('axios');
const account = { account: { uuid: 'fixture-account', email_address: 'fixture@example.test' }, memberships: [{ organization: { uuid: 'fixture-org', capabilities: [] } }] };
const credential = 'offline-fixture-credential-'.repeat(2);
let browser;
const contexts = [];
beforeAll(async () => { browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] }); });
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(contexts.splice(0).map(context => context.close())); });
afterAll(async () => { await browser?.close(); });
async function fixture({ passive = false, delay = 0, status = 200, redirect = false, body = '<p>Checkout loading</p>' } = {}) {
    const context = await browser.newContext(); contexts.push(context);
    let requests = 0;
    await context.route('**/*', async route => {
        if (route.request().url().endsWith('/api/auth/current_account')) {
            requests++;
            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
            return route.fulfill({ status, json: account }).catch(() => {});
        }
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: body + (passive ? '<script>fetch("/api/auth/current_account")</script>' : '') });
    });
    const page = await context.newPage();
    if (redirect) {
        const navigate = page.goto.bind(page);
        vi.spyOn(page, 'goto').mockImplementation((_url, options) => navigate('https://claude.ai/login', options));
    }
    return { page, requests: () => requests };
}

describe('bounded Claude account bootstrap', () => {
    it('reuses an in-flight page bootstrap request without sending another', async () => {
        const fixturePage = await fixture({ passive: true, delay: 120 });
        const initialResponses = fixturePage.page.listenerCount('response');
        expect(await bootstrapClaudeSession(fixturePage.page, credential)).toMatchObject({ ok: true, email: 'fixture@example.test', orgId: 'fixture-org' });
        expect(fixturePage.requests()).toBe(1);
        expect(getClaudeAccountSnapshot(fixturePage.page)).toMatchObject({ accountId: 'fixture-account', organizationCount: 1 });
        expect(fixturePage.page.listenerCount('response')).toBe(initialResponses);
    });
    it('uses one bounded same-origin read if the page has no account request', async () => {
        const fixturePage = await fixture();
        expect(await bootstrapClaudeSession(fixturePage.page, credential)).toMatchObject({ email: 'fixture@example.test' });
        expect(fixturePage.requests()).toBe(1);
    });
    it('does not call an unconfirmed account authenticated after timeout', async () => {
        const fixturePage = await fixture({ delay: 300 });
        const started = performance.now();
        expect(await bootstrapClaudeSession(fixturePage.page, credential, { accountTimeoutMs: 60 })).toMatchObject({ ok: true, email: '' });
        expect(getClaudeAccountSnapshot(fixturePage.page)).toBeNull();
        expect(performance.now() - started).toBeLessThan(1000);
    });
    it('rejects an explicit unauthorized account response', async () => {
        const fixturePage = await fixture({ status: 401 });
        await expect(bootstrapClaudeSession(fixturePage.page, credential)).rejects.toThrow('登录已失效');
    });
    it('rejects a login redirect before attempting metadata fetch', async () => {
        const fixturePage = await fixture({ redirect: true });
        await expect(bootstrapClaudeSession(fixturePage.page, credential)).rejects.toThrow('登录页');
        expect(fixturePage.requests()).toBe(0);
    });
    it('rejects a visible region restriction', async () => {
        const fixturePage = await fixture({ body: '<p>App unavailable in your region</p>' });
        await expect(bootstrapClaudeSession(fixturePage.page, credential)).rejects.toThrow('地区不可用');
    });
    it('reads updated account data through the current browser context', async () => {
        const fixturePage = await fixture(); await fixturePage.page.goto('https://claude.ai/new');
        expect(await readClaudeAccountInBrowser(fixturePage.page)).toMatchObject({ status: 200, account: { accountId: 'fixture-account' } });
    });
});

describe('HTTP metadata probe contract', () => {
    it('uses the web endpoint and applies the supplied proxy', async () => {
        const spy = vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: account });
        expect(await fetchClaudeAccount(credential, { proxyUrl: 'http://127.0.0.1:9', timeout: 50 })).toMatchObject({ ok: true });
        expect(spy.mock.calls[0][0]).toBe('https://claude.ai/api/auth/current_account');
        expect(spy.mock.calls[0][1]).toMatchObject({ proxy: false, timeout: 50 });
        expect(spy.mock.calls[0][1].httpsAgent).toBeTruthy();
    });
    it('does not report a network failure as verified authentication', async () => {
        vi.spyOn(axios, 'get').mockRejectedValue(new Error('offline fixture timeout'));
        expect(await fetchClaudeAccount(credential)).toMatchObject({ ok: false });
    });
});
