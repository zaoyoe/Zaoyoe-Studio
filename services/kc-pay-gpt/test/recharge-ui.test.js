import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const publicRoot = path.resolve('public');
const cdk = 'KC-OFFLINE-UI-ONLY';
const grid = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="450" height="600"><rect width="450" height="600" fill="#eef2f7"/><text x="30" y="55" font-size="18">Offline CAPTCHA fixture</text><rect x="20" y="90" width="410" height="400" fill="#93c5fd"/><text x="335" y="570" font-size="20">Verify</text></svg>').toString('base64')}`;
let browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] }); });
afterAll(async () => { await browser?.close(); });

async function fixture(options = {}) {
    const context = await browser.newContext({ viewport: options.viewport || { width: 1280, height: 900 }, reducedMotion: options.reducedMotion || 'no-preference' });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await context.addInitScript(() => {
        localStorage.setItem('fk-theme', 'dark');
        window.__sockets = [];
        window.__sent = [];
        class OfflineWebSocket {
            static OPEN = 1;
            static CONNECTING = 0;
            constructor(url) {
                this.url = url;
                this.readyState = 0;
                window.__sockets.push(this);
                setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
            }
            send(raw) { window.__sent.push(JSON.parse(raw)); }
            close() { this.readyState = 3; }
        }
        window.WebSocket = OfflineWebSocket;
        window.__emit = data => window.__sockets.at(-1)?.onmessage?.({ data: JSON.stringify({ jobKey: 'offline-job', ...data }) });
    });
    await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== 'http://recharge.test') {
            if (url.hostname === 'unpkg.com') return route.fulfill({ contentType: 'application/javascript', body: 'window.lucide={createIcons(){}};' });
            return route.fulfill({ contentType: 'text/css', body: '' });
        }
        if (url.pathname.startsWith('/api/')) {
            requests.push({ url: url.pathname, method: request.method(), body: request.postData() });
            const response = url.pathname === '/api/verify-cdk'
                ? { success: true, data: { platform: options.platform || 'chatgpt', plan_type: options.plan || 'plus', plan_label: options.label || 'ChatGPT Plus', ...options.verify } }
                : url.pathname === '/api/cdk/query'
                    ? { success: true, data: { status: '未使用', platform: 'chatgpt', plan_type: 'plus' } }
                    : url.pathname === '/api/run-process'
                        ? { success: true, jobKey: 'offline-job' }
                        : { success: true, handled: true, email: 'offline@example.test' };
            return route.fulfill({ json: response });
        }
        const file = path.join(publicRoot, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
        if (!file.startsWith(publicRoot + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html', body: fs.readFileSync(file) });
    });
    await page.goto('http://recharge.test/');
    return { context, page, errors, requests };
}

async function verify(page) {
    await page.locator('#cdkInput').fill(cdk);
    await page.locator('#redeemBtn').click();
    await page.waitForFunction(() => document.querySelector('#step2').offsetHeight > 0);
    await page.waitForFunction(() => !document.querySelector('.recharge-card').classList.contains('is-morphing'));
}

function session() {
    const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
    return JSON.stringify({ user: { email: 'offline@example.test' }, accessToken: `${encode({ typ: 'JWT', alg: 'RS256' })}.${encode({ iss: 'https://auth.openai.com', aud: 'https://api.openai.com/v1', exp: Math.floor(Date.now() / 1000) + 3600, scp: ['model.request'], 'https://api.openai.com/auth': { chatgpt_account_id: 'offline-account', chatgpt_user_id: 'offline-user' } })}.offline-signature` });
}

describe('restored recharge user interactions with all external effects mocked', () => {
    it('plays the circular check, morphs the card, animates both tabs and resets cleanly', async () => {
        const f = await fixture();
        try {
            await f.page.locator('#cdkInput').fill(cdk);
            await f.page.locator('#redeemBtn').click();
            await f.page.waitForFunction(() => document.querySelector('#redeemBtn').classList.contains('is-circle-success'));
            expect(await f.page.locator('#step2').isVisible()).toBe(false);
            await f.page.waitForFunction(() => document.querySelector('.recharge-card').classList.contains('is-morphing'));
            await f.page.waitForFunction(() => !document.querySelector('.recharge-card').classList.contains('is-morphing'));
            expect(await f.page.locator('#cardSubtitle').textContent()).toBe('ChatGPT Plus');
            await f.page.locator('[data-tab="query"]').click();
            expect(await f.page.locator('#tabStage').evaluate(el => el.classList.contains('is-switching'))).toBe(true);
            await f.page.waitForFunction(() => !document.querySelector('#tabStage').classList.contains('is-switching'));
            await f.page.locator('#queryInput').fill(cdk);
            await f.page.locator('#queryBtn').click();
            await f.page.waitForFunction(() => document.querySelector('#statusMessage').textContent.includes('未使用'));
            expect(f.requests.some(r => r.url === '/api/cdk/query' && r.method === 'GET')).toBe(true);
            await f.page.locator('[data-tab="redeem"]').click();
            await f.page.waitForFunction(() => !document.querySelector('#tabStage').classList.contains('is-switching'));
            await f.page.locator('#backToStep1').click();
            await f.page.waitForFunction(() => document.querySelector('#step1').offsetHeight > 0);
            expect(await f.page.locator('#tabNav').isVisible()).toBe(false);
            expect(f.errors).toEqual([]);
        } finally { await f.context.close(); }
    });

    it('receives real message shapes, protects uncertain payments, and routes CAPTCHA independently', async () => {
        const f = await fixture();
        try {
            await verify(f.page);
            await f.page.locator('#tokenInput').fill(session());
            await f.page.locator('#startBtn').click();
            await f.page.waitForFunction(() => window.__sent.some(data => data.type === 'subscribe'));
            await f.page.evaluate(() => window.__emit({ type: 'progress', status: 'running', progress: 50 }));
            expect(await f.page.locator('#startBtnProgress').evaluate(el => el.style.width)).toBe('50%');
            await f.page.evaluate(image => window.__emit({ type: 'captcha_interactive_required', image, frameSeq: 1, contentReady: true, promptEn: 'Select all bicycles', promptZh: '请选择所有自行车', expiresAt: Date.now() + 180000 }), grid);
            await f.page.locator('#captchaInteractiveImg').waitFor({ state: 'visible' });
            expect(await f.page.locator('#captchaPromptHeading').textContent()).toContain('自行车');
            expect(await f.page.locator('#captchaPromptDetail').textContent()).not.toContain('操作指引');
            await f.page.locator('#captchaInteractiveImg').click({ position: { x: 100, y: 200 } });
            expect(await f.page.locator('.captcha-select-badge').count()).toBe(1);
            await f.page.locator('#captchaModalCloseBtn').click();
            expect(await f.page.locator('#captchaFloatingPill').isVisible()).toBe(true);
            await f.page.locator('#captchaFloatingPill').click();
            await f.page.locator('#captchaHeaderRefreshBtn').click();
            expect(await f.page.locator('#captchaLoadingState').isVisible()).toBe(true);
            expect(await f.page.evaluate(() => window.__sent.at(-1).action)).toBe('refresh');
            await f.page.evaluate(image => window.__emit({ type: 'captcha_interactive_required', image, frameSeq: 2, contentReady: true }), grid);
            await f.page.evaluate(() => window.__emit({ type: 'captcha_interactive_status', cleared: true }));
            await f.page.waitForFunction(() => document.querySelector('#captchaInteractiveModal').style.display === 'none');
            expect(await f.page.locator('#capsuleToast').textContent()).toContain('安全验证已通过');
            await f.page.evaluate(() => window.__emit({ type: 'status', status: 'manual', progress: 70, paymentState: 'unknown', recoveryRequired: true, message: 'locator.click timeout' }));
            expect(await f.page.locator('#statusMessage').textContent()).toBe('支付结果待确认，请联系客服核实，请勿重复充值');
            expect(f.errors).toEqual([]);
        } finally { await f.context.close(); }
    });

    it.each(['light', 'dark'])('fits a narrow viewport in %s mode and shows a working scroll hint', async theme => {
        const f = await fixture({ viewport: { width: 390, height: 640 }, platform: 'grok', plan: 'grok_bundle_plus_monthly', label: 'The X Subscription Plus 月付' });
        try {
            await verify(f.page);
            await f.page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
            await f.page.evaluate(image => { activeJobKey = 'offline-job'; openCaptchaInteractiveModal({ image, frameSeq: 1, promptEn: 'Select all bicycles', promptZh: '请选择所有自行车', contentReady: true, expiresAt: Date.now() + 180000 }); }, grid);
            await f.page.waitForFunction(() => !document.querySelector('#captchaScrollHint').hidden);
            const box = await f.page.locator('#captchaModalCard').boundingBox();
            expect(box.width).toBeLessThanOrEqual(390);
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.y + box.height).toBeLessThanOrEqual(641);
            await f.page.locator('#captchaScrollHint').click();
            await f.page.waitForFunction(() => document.querySelector('#captchaModalBody').scrollTop > 0);
            expect(f.errors).toEqual([]);
        } finally { await f.context.close(); }
    });

    it('restores the progress completion animation and success expansion', async () => {
        const f = await fixture();
        try {
            await verify(f.page);
            await f.page.evaluate(() => applyTaskState({ type: 'status', status: 'success', progress: 100 }));
            await f.page.waitForFunction(() => document.querySelector('#startBtn').classList.contains('is-success'));
            await f.page.waitForFunction(() => document.querySelector('#statusMessage').textContent.includes('成功开通'));
            expect(await f.page.locator('#startBtn').isDisabled()).toBe(true);
            expect(f.errors).toEqual([]);
        } finally { await f.context.close(); }
    });
});
