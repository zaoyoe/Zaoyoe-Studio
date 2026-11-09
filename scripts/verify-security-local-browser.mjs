#!/usr/bin/env node
// Local, mock-only browser acceptance. Never starts the KC/Verify application or loads .env.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputArg = process.argv.find((arg) => arg.startsWith('--output-dir='));
const browserNames = (process.argv.find((arg) => arg.startsWith('--browsers='))?.slice('--browsers='.length) || 'chromium,webkit').split(',');
if (!browserNames.length || browserNames.some((name) => !['chromium', 'webkit'].includes(name)) || new Set(browserNames).size !== browserNames.length) {
    throw new Error('--browsers must list chromium and/or webkit without duplicates');
}
if (!outputArg) throw new Error('Provide --output-dir=/absolute/path/outside/repository');
const output = path.resolve(outputArg.slice('--output-dir='.length));
if (!path.isAbsolute(outputArg.slice('--output-dir='.length)) || output === root || output.startsWith(`${root}${path.sep}`)) {
    throw new Error('Evidence must be written outside the repository');
}
await mkdir(output, { recursive: true, mode: 0o700 });
const require = createRequire(path.join(root, 'services/kc-pay-gpt/package.json'));
const playwright = require('playwright');
const sourcePaths = {
    '/source/kc.js': 'services/kc-pay-gpt/public/admin-security.js',
    '/source/access.js': 'js/admin-access.js',
    '/kc-login.html': 'services/kc-pay-gpt/public/admin-login.html'
};
const source = new Map(await Promise.all(Object.entries(sourcePaths).map(async ([url, relative]) => [url, await readFile(path.join(root, relative))])));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: true,
    playwrightVersion: require('playwright/package.json').version,
    requestedBrowsers: browserNames,
    sourceHashes: Object.fromEntries(Object.entries(sourcePaths).map(([url, relative]) => [relative, sha256(source.get(url))])),
    scope: 'Real browser DOM and source modules; mock HTTP API; isolated context; no database, provider, or production evidence'
};
identity.snapshot = sha256(JSON.stringify(identity.sourceHashes));
const FAKE_TOKEN = 'fixture-admin-token';
const FAKE_PROOF = 'fixture-secondary-proof';
const FAKE_USER = '11111111-1111-4111-8111-111111111111';
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const bounded = (promise) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture synchronization timed out')), 8_000);
    Promise.resolve(promise).then(resolve, reject).finally(() => clearTimeout(timer));
});
const states = new Map();
const serverErrors = [];
function json(res, status, data, headers = {}) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
    res.end(JSON.stringify(data));
}
const server = http.createServer(async (req, res) => {
    try {
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        if (pathname === '/diagnostics') return json(res, 200, identity);
        if (source.has(pathname)) {
            res.writeHead(200, { 'content-type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
            return res.end(source.get(pathname));
        }
        if (pathname === '/fixture/kc' || pathname === '/fixture/access') {
            const modulePath = pathname.endsWith('/kc') ? '/source/kc.js' : '/source/access.js';
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            return res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本地安全验收</title><body style="font:18px system-ui;padding:32px"><h1>本地安全交互验收</h1><p>模拟 API · 独立浏览器会话 · 无真实订单</p><p>HEAD ${identity.head} + dirty ${identity.snapshot.slice(0, 12)}</p><button id="fixture-button">安全交互测试</button><script src="${modulePath}"></script></body></html>`);
        }
        if (pathname === '/favicon.ico' || pathname === '/favicon.svg') { res.writeHead(204); return res.end(); }
        const state = states.get(req.headers['x-security-fixture-case']);
        if (!state) return json(res, 404, { success: false, message: 'Fixture route not available' });
        const chunks = [];
        for await (const chunk of req) { chunks.push(chunk); if (Buffer.concat(chunks).length > 4096) throw new Error('Fixture request too large'); }
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
        state.calls.push({ path: pathname, method: req.method, proof: req.headers['x-admin-secondary-token'] === FAKE_PROOF, bearer: req.headers.authorization === `Bearer ${FAKE_TOKEN}` });
        if (pathname === '/api/public/admin-paths') return json(res, 200, { success: true, loginPath: '/kc-login.html', panelPath: '/fixture/kc' });
        if (pathname === '/api/admin/login') return json(res, 401, { success: false, message: '模拟接口：登录凭证无效' });
        if (pathname === '/api/admin/secondary/challenge') {
            assert.equal(body.password, 'fixture-password');
            state.challengeStarted.resolve();
            if (state.holdChallenge) await state.release.promise;
            return json(res, 200, { success: true, challengeId: 'fixture-challenge', method: state.method });
        }
        if (pathname === '/api/admin/verify-secondary') {
            assert.equal(body.challengeId, 'fixture-challenge');
            assert.equal(body.code, state.method ? '123456' : '');
            return json(res, 200, { success: true, secondaryToken: FAKE_PROOF, expiresAt: Date.now() + (state.invalidExpiry ? 600_000 : 240_000) });
        }
        if (pathname === '/api/admin/sensitive') {
            if (req.headers['x-admin-secondary-token'] !== FAKE_PROOF) return json(res, 403, { success: false, code: 'STEP_UP_REQUIRED' });
            if (state.delayBody) {
                res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                // WebKit may buffer header-only responses. Deliver an initial JSON chunk,
                // then delay the sensitive value so both engines exercise a real streamed body.
                res.write(' '.repeat(4096) + '{"success":true,"value":"');
                state.bodyStarted.resolve();
                await state.release.promise;
                return res.end('FIXTURE_ONLY_CREDENTIAL"}');
            }
            return json(res, 200, { success: true, value: 'FIXTURE_ONLY_CREDENTIAL' });
        }
        if (pathname === '/api/admin/access/session') {
            if (req.method === 'POST') {
                state.postStarted.resolve();
                if (state.holdPost) await state.release.promise;
                return json(res, 200, { success: true, expiresInSeconds: 600 }, { 'set-cookie': 'fixture_admin_session=fake; Path=/; HttpOnly; SameSite=Strict' });
            }
            if (req.method === 'DELETE') return json(res, state.failDelete ? 503 : 200, { success: !state.failDelete }, state.failDelete ? {} : { 'set-cookie': 'fixture_admin_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict' });
        }
        return json(res, 404, { success: false, message: 'Fixture route not available' });
    } catch (error) {
        serverErrors.push(error.message);
        if (!res.headersSent) json(res, 500, { success: false, message: 'Fixture assertion failed' }); else res.destroy();
    }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(JSON.stringify({ base, ...identity }));
const results = [];
async function fixture(browser, kind, options = {}) {
    const id = `case-${states.size + 1}`;
    const state = { calls: [], method: 'totp', release: deferred(), challengeStarted: deferred(), bodyStarted: deferred(), postStarted: deferred(), ...options };
    states.set(id, state);
    const context = await browser.newContext({ serviceWorkers: 'block', extraHTTPHeaders: { 'x-security-fixture-case': id }, viewport: { width: 1100, height: 800 } });
    const blocked = [];
    await context.route('**/*', async (route) => {
        if (new URL(route.request().url()).origin === base) return route.continue();
        blocked.push(new URL(route.request().url()).origin);
        return route.fulfill({ status: 200, contentType: 'text/css', body: '/* External resource intentionally blocked by fixture */' });
    });
    const page = await context.newPage();
    const errors = [], consoleErrors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.goto(`${base}${kind === 'login' ? '/kc-login.html' : `/fixture/${kind}`}`, { waitUntil: 'load' });
    assert.ok((await page.locator('body').innerText()).trim().length > 30, 'Nonempty page');
    assert.equal(await page.locator('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay').count(), 0);
    if (kind !== 'login') assert.equal(await page.locator('#fixture-button').count(), 1);
    return { page, state, context, errors, consoleErrors, blocked, close: async () => { state.release.resolve(); await context.close(); states.delete(id); } };
}
async function runCase(browser, browserName, name, kind, options, run) {
    let f;
    try {
        f = await fixture(browser, kind, options);
        await run(f);
        assert.deepEqual(f.errors, [], 'No uncaught browser errors');
        // Deliberate 401/403/503 test responses appear as network console errors in Chromium.
        const unexpected = f.consoleErrors.filter((message) => !/^Failed to load resource: the server responded with a status of (401|403|503)\b/.test(message));
        assert.deepEqual(unexpected, [], 'No unexpected console errors');
        results.push({ browser: browserName, name, status: 'PASS', pageErrors: f.errors, expectedHttpErrors: f.consoleErrors.length, blockedExternalOrigins: [...new Set(f.blocked)] });
    } catch (error) {
        results.push({ browser: browserName, name, status: 'FAIL', error: error.message });
        if (f) await f.page.screenshot({ path: path.join(output, `${browserName}-${results.length}-failure.png`) }).catch(() => {});
    } finally { if (f) await f.close(); }
    console.log(`${results.at(-1).status} ${browserName}: ${name}`);
}
async function beginSensitive(page, count = 1) {
    await page.evaluate(({ token, count }) => {
        window.fixtureResult = Promise.allSettled(Array.from({ length: count }, () => KcAdminSecurity.fetch('/api/admin/sensitive', {}, token).then((r) => r.json())));
    }, { token: FAKE_TOKEN, count });
}
async function password(page) {
    await page.locator('dialog[open] input[type=password]').fill('fixture-password');
    await page.locator('dialog[open] button[type=submit]').click();
}
async function otp(page) {
    await page.locator('dialog[open] input[type=text]').fill('123456');
    await page.locator('dialog[open] button[type=submit]').click();
}
async function outcome(page) { return page.evaluate(() => window.fixtureResult.then((rows) => rows.map((row) => ({ status: row.status, value: row.value, error: row.reason?.message })))); }
async function installClient(page, { missing = false, tg = false } = {}) {
    await page.evaluate(({ token, user, missing, tg }) => {
        window.fixtureStorageReads = 0;
        localStorage.setItem('sb-foreign-auth-token', JSON.stringify({ access_token: 'fixture-foreign-token', refresh_token: 'fixture-foreign-refresh', user: { id: 'foreign-user' } }));
        const originalGet = Storage.prototype.getItem, originalKey = Storage.prototype.key;
        Storage.prototype.getItem = function (...args) { if (this === localStorage) window.fixtureStorageReads++; return originalGet.apply(this, args); };
        Storage.prototype.key = function (...args) { if (this === localStorage) window.fixtureStorageReads++; return originalKey.apply(this, args); };
        window.fixtureRestores = 0;
        window.supabaseClient = { auth: { storageKey: tg ? 'tg-admin-auth-v1' : 'fixture-main-auth',
            getSession: async () => ({ data: { session: missing ? null : { access_token: token, user: { id: user } } } }),
            getUser: async () => ({ data: { user: missing ? null : { id: user } } }),
            setSession: async () => { window.fixtureRestores++; throw new Error('Foreign restore forbidden'); }
        }, rpc: async () => ({ data: { is_admin: true, is_super_admin: true, permissions: [] } }) };
    }, { token: FAKE_TOKEN, user: FAKE_USER, missing, tg });
}
try {
    for (const browserName of browserNames) {
        let browser;
        try { browser = await playwright[browserName].launch({ headless: true }); }
        catch (error) { results.push({ browser: browserName, name: 'browser_launch', status: 'NOT RUN', error: error.message }); continue; }
        try {
            await runCase(browser, browserName, 'KC: password + TOTP, single retry, memory-only proof', 'kc', {}, async ({ page, state }) => {
                await beginSensitive(page); await password(page); await otp(page);
                const rows = await outcome(page); assert.equal(rows[0].status, 'fulfilled'); assert.equal(rows[0].value.value, 'FIXTURE_ONLY_CREDENTIAL');
                assert.equal(state.calls.filter((c) => c.path.endsWith('/sensitive')).length, 2);
                assert.equal(state.calls.filter((c) => c.path.endsWith('/verify-secondary')).length, 1);
                assert.equal(await page.evaluate(() => Object.values(localStorage).concat(Object.values(sessionStorage)).some((v) => v.includes('fixture-secondary-proof'))), false);
            });
            await runCase(browser, browserName, 'KC: concurrent reads share one challenge', 'kc', {}, async ({ page, state }) => {
                await beginSensitive(page, 2); await password(page); await otp(page);
                assert.ok((await outcome(page)).every((row) => row.status === 'fulfilled'));
                assert.equal(state.calls.filter((c) => c.path.endsWith('/secondary/challenge')).length, 1);
                assert.equal(state.calls.filter((c) => c.path.endsWith('/verify-secondary')).length, 1);
            });
            await runCase(browser, browserName, 'KC: cancelled password sends no challenge', 'kc', {}, async ({ page, state }) => {
                await beginSensitive(page); await page.locator('dialog[open] button[type=button]').click();
                assert.equal((await outcome(page))[0].status, 'rejected'); assert.equal(state.calls.length, 1);
            });
            await runCase(browser, browserName, 'KC: invalid proof expiry rejects without retry', 'kc', { invalidExpiry: true }, async ({ page, state }) => {
                await beginSensitive(page); await password(page); await otp(page);
                assert.equal((await outcome(page))[0].status, 'rejected');
                assert.equal(state.calls.filter((c) => c.path.endsWith('/sensitive')).length, 1);
            });
            await runCase(browser, browserName, 'KC: logout while challenge waits prevents OTP and retry', 'kc', { holdChallenge: true }, async ({ page, state }) => {
                await beginSensitive(page); await password(page); await bounded(state.challengeStarted.promise);
                await page.evaluate(() => KcAdminSecurity.clear()); state.release.resolve();
                assert.equal((await outcome(page))[0].status, 'rejected'); assert.equal(await page.locator('dialog').count(), 0);
                assert.equal(state.calls.some((c) => c.path.endsWith('/verify-secondary')), false);
            });
            await runCase(browser, browserName, 'KC: token switch cancels prior password dialog', 'kc', {}, async ({ page }) => {
                await beginSensitive(page); await page.locator('dialog[open]').waitFor();
                await page.evaluate(async () => { const r = await KcAdminSecurity.fetch('/api/admin/sensitive', { stepUp: false }, 'fixture-new-token'); window.fixtureNewStatus = r.status; });
                assert.equal((await outcome(page))[0].status, 'rejected'); assert.equal(await page.locator('dialog').count(), 0);
            });
            await runCase(browser, browserName, 'KC: late streamed body and cloned response reject after logout', 'kc', {}, async ({ page, state }) => {
                await beginSensitive(page); await password(page); await otp(page); await outcome(page);
                state.delayBody = true;
                await page.evaluate((token) => { window.fixtureLate = KcAdminSecurity.fetch('/api/admin/sensitive', {}, token).then((r) => { const clone = r.clone(); window.fixtureReadersStarted = true; return Promise.allSettled([r.json(), clone.text()]).then((rows) => rows.map((row) => row.status)); }); }, FAKE_TOKEN);
                await bounded(state.bodyStarted.promise); await page.waitForFunction(() => window.fixtureReadersStarted === true);
                await page.evaluate(() => KcAdminSecurity.clear()); state.release.resolve();
                assert.deepEqual(await page.evaluate(() => window.fixtureLate), ['rejected', 'rejected']);
            });
            await runCase(browser, browserName, 'KC: reveal uses text, clears on close and 30-second timeout', 'kc', {}, async ({ page }) => {
                await page.clock.install();
                await page.evaluate(() => { window.fixtureReveal = KcAdminSecurity.showSecret('<img src=x onerror="window.fixtureInjected=true">FIXTURE_ONLY'); });
                await page.locator('dialog[open] pre').waitFor(); assert.equal(await page.locator('dialog img').count(), 0);
                await page.screenshot({ path: path.join(output, `${browserName}-kc-reveal.png`) });
                await page.clock.fastForward(30_001); await page.waitForFunction(() => !document.querySelector('dialog'));
                assert.equal(await page.evaluate(() => Boolean(window.fixtureInjected)), false);
                assert.equal((await page.locator('body').innerText()).includes('FIXTURE_ONLY'), false);
            });
            await runCase(browser, browserName, 'KC: visibility handler clears dialogs and rejects hidden reveals (synthetic event)', 'kc', {}, async ({ page }) => {
                await beginSensitive(page); await page.locator('dialog[open]').waitFor();
                const hiddenResult = await page.evaluate(async () => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); return KcAdminSecurity.showSecret('FIXTURE_ONLY').then(() => 'fulfilled', () => 'rejected'); });
                assert.equal(hiddenResult, 'rejected'); assert.equal((await outcome(page))[0].status, 'rejected'); assert.equal(await page.locator('dialog').count(), 0);
            });
            await runCase(browser, browserName, 'Main: pending Set-Cookie finishes before logout DELETE; cache stays cleared', 'access', { holdPost: true }, async ({ page, state, context }) => {
                await installClient(page);
                await page.evaluate((userId) => { window.fixtureIssue = AdminAccess.createAdminStudioSession({ userId, allowPersistedSessionFallback: false, forceRefresh: true }); }, FAKE_USER);
                await bounded(state.postStarted.promise);
                await page.evaluate((userId) => { window.fixtureClear = AdminAccess.clearAdminStudioSession(); window.fixtureBlocked = AdminAccess.createAdminStudioSession({ userId }); }, FAKE_USER);
                assert.equal(state.calls.some((c) => c.method === 'DELETE'), false); state.release.resolve();
                const result = await page.evaluate(async () => ({ issue: await window.fixtureIssue, clear: await window.fixtureClear, blocked: await window.fixtureBlocked, cache: sessionStorage.getItem('zaoyoe_admin_studio_session_cache_v1') }));
                assert.equal(result.issue.reason, 'session_cleared'); assert.equal(result.blocked.reason, 'session_clearing'); assert.equal(result.clear, true); assert.equal(result.cache, null);
                assert.deepEqual(state.calls.filter((c) => c.path.endsWith('/access/session')).map((c) => c.method), ['POST', 'DELETE']);
                assert.equal((await context.cookies()).some((c) => c.name === 'fixture_admin_session'), false);
            });
            await runCase(browser, browserName, 'Main: failed revocation returns failure and clears local cache', 'access', { failDelete: true }, async ({ page }) => {
                await installClient(page);
                const result = await page.evaluate(async (userId) => ({ issue: await AdminAccess.createAdminStudioSession({ userId, allowPersistedSessionFallback: false }), cleared: await AdminAccess.clearAdminStudioSession(), cache: sessionStorage.getItem('zaoyoe_admin_studio_session_cache_v1') }), FAKE_USER);
                assert.equal(result.issue.ok, true); assert.equal(result.cleared, false); assert.equal(result.cache, null);
            });
            await runCase(browser, browserName, 'TG: missing own SDK identity never imports storefront storage', 'access', {}, async ({ page, state }) => {
                await installClient(page, { missing: true, tg: true });
                const result = await page.evaluate(async (userId) => ({ access: await AdminAccess.getCurrentAdminAccess({ forceRefresh: true }), issue: await AdminAccess.createAdminStudioSession({ userId, forceRefresh: true }), reads: window.fixtureStorageReads, restores: window.fixtureRestores }), FAKE_USER);
                assert.equal(result.access.user, null); assert.equal(result.issue.status, 401); assert.equal(result.reads, 0); assert.equal(result.restores, 0); assert.equal(state.calls.length, 0);
            });
            await runCase(browser, browserName, 'TG: own token issues session despite foreign storefront storage', 'access', {}, async ({ page, state }) => {
                await installClient(page, { tg: true });
                const result = await page.evaluate(async (userId) => ({ issue: await AdminAccess.createAdminStudioSession({ userId, allowPersistedSessionFallback: false, forceRefresh: true }), reads: window.fixtureStorageReads }), FAKE_USER);
                assert.equal(result.issue.ok, true); assert.equal(result.reads, 0); assert.ok(state.calls.every((c) => c.bearer));
            });
            await runCase(browser, browserName, 'KC: actual login page renders and rejects mock invalid login', 'login', {}, async ({ page, state }) => {
                await page.locator('#email').fill('fixture@example.test'); await page.locator('#password').fill('fixture-password'); await page.locator('#loginBtn').click();
                await page.waitForFunction(() => document.querySelector('#message').textContent.includes('模拟接口'));
                assert.equal(state.calls.filter((c) => c.path === '/api/admin/login').length, 1);
                assert.equal(await page.evaluate(() => Object.values(localStorage).some((v) => v.includes('fixture-admin-token'))), false);
                await page.screenshot({ path: path.join(output, `${browserName}-kc-login.png`) });
            });
        } finally { await browser.close(); }
    }
} finally {
    for (const state of states.values()) state.release.resolve();
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
}
const after = Object.fromEntries(await Promise.all(Object.values(sourcePaths).map(async (relative) => [relative, sha256(await readFile(path.join(root, relative)))])));
assert.deepEqual(after, identity.sourceHashes, 'Runtime source unchanged during browser acceptance');
const report = { ...identity, completedAt: new Date().toISOString(), results, counts: { pass: results.filter((r) => r.status === 'PASS').length, fail: results.filter((r) => r.status === 'FAIL').length, notRun: results.filter((r) => r.status === 'NOT RUN').length }, serverErrors };
await writeFile(path.join(output, 'browser-results.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(report.counts));
if (report.counts.fail || report.counts.notRun || serverErrors.length) process.exitCode = 1;
