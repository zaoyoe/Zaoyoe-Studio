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
    const context = await browser.newContext({
        viewport: options.viewport || { width: 1280, height: 900 },
        isMobile: Boolean(options.isMobile),
        hasTouch: Boolean(options.isMobile),
        reducedMotion: options.reducedMotion || 'no-preference'
    });
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
                    ? {
                        success: true,
                        data: {
                            status: '未使用',
                            platform: 'chatgpt',
                            plan_type: 'plus',
                            plan_label: 'ChatGPT Plus',
                            boundAccount: '',
                            records: options.queryRecords || [
                                {
                                    account: 'offline@example.test',
                                    platform: 'chatgpt',
                                    planType: 'plus',
                                    planLabel: 'ChatGPT Plus',
                                    status: 'failed',
                                    paymentState: 'declined',
                                    reason: '支付卡被官方系统拒付：Your card number is incorrect. [incorrect_number]（卡密未使用）',
                                    createdAt: '2026-11-14 20:07:25'
                                }
                            ]
                        }
                    }
                    : url.pathname === '/api/run-process'
                        ? { success: true, jobKey: 'offline-job', taskAccessToken: 'offline-task-access-token' }
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

function session({ includeSessionToken = false } = {}) {
    const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
    return JSON.stringify({
        user: { email: 'offline@example.test' },
        accessToken: `${encode({ typ: 'JWT', alg: 'RS256' })}.${encode({ iss: 'https://auth.openai.com', aud: 'https://api.openai.com/v1', exp: Math.floor(Date.now() / 1000) + 3600, scp: ['model.request'], 'https://api.openai.com/auth': { chatgpt_account_id: 'offline-account', chatgpt_user_id: 'offline-user' } })}.offline-signature`,
        ...(includeSessionToken ? { sessionToken: 'offline-session-token' } : {})
    });
}

describe('restored recharge user interactions with all external effects mocked', () => {
    it('keeps mobile inputs at a non-zooming size and disables page scaling', async () => {
        const f = await fixture({ viewport: { width: 390, height: 844 }, isMobile: true });
        try {
            const viewport = await f.page.locator('meta[name="viewport"]').getAttribute('content');
            expect(viewport).toContain('maximum-scale=1');
            expect(viewport).toContain('user-scalable=no');
            expect(viewport).toContain('viewport-fit=cover');

            await verify(f.page);
            const cdkAndQuerySizes = await f.page.evaluate(() => ['#cdkInput', '#queryInput']
                .map(selector => Number.parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)));
            expect(cdkAndQuerySizes.every(size => size >= 16)).toBe(true);
            const tokenFontSize = await f.page.evaluate(() => Number.parseFloat(getComputedStyle(document.querySelector('#tokenInput')).fontSize));
            expect(tokenFontSize).toBe(14);
            const touchActions = await f.page.evaluate(() => ({
                body: getComputedStyle(document.body).touchAction,
                card: getComputedStyle(document.querySelector('.recharge-card')).touchAction
            }));
            expect(touchActions.body).toContain('pan-x');
            expect(touchActions.body).toContain('pan-y');
            expect(touchActions.card).toBe('pan-y');
            expect(f.errors).toEqual([]);
        } finally { await f.context.close(); }
    });

    it('keeps the AI recharge action visible when the mobile keyboard reduces the viewport', async () => {
        const f = await fixture({ viewport: { width: 390, height: 844 }, isMobile: true });
        try {
            await f.page.locator('.page-shell').evaluate(shell => Promise.all(
                shell.getAnimations().map(animation => animation.finished)
            ));
            await f.page.locator('#cdkInput').focus();
            await f.page.setViewportSize({ width: 390, height: 420 });
            await f.page.waitForFunction(() => document.body.classList.contains('keyboard-open')
                && getComputedStyle(document.documentElement).getPropertyValue('--kc-keyboard-shell-top').trim());

            const layout = await f.page.evaluate(() => {
                const card = document.querySelector('.recharge-card').getBoundingClientRect();
                const button = document.querySelector('#redeemBtn').getBoundingClientRect();
                return {
                    viewportHeight: window.visualViewport?.height || window.innerHeight,
                    cardTop: card.top,
                    cardBottom: card.bottom,
                    buttonTop: button.top,
                    buttonBottom: button.bottom
                };
            });
            expect(layout.cardTop).toBeGreaterThanOrEqual(0);
            expect(Math.abs(layout.cardBottom - layout.viewportHeight + 8)).toBeLessThanOrEqual(16);
            expect(layout.cardBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
            expect(layout.buttonTop).toBeGreaterThanOrEqual(0);
            expect(layout.buttonBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
            expect(f.errors).toEqual([]);
        } finally { await f.context.close(); }
    });

    it('keeps the native-height mobile card bottom-aligned and smoothly recenters after the keyboard closes', async () => {
        const f = await fixture({ viewport: { width: 390, height: 844 }, isMobile: true });
        try {
            await f.page.locator('#cdkInput').focus();
            await f.page.setViewportSize({ width: 390, height: 420 });
            await f.page.waitForFunction(() => document.body.classList.contains('keyboard-open')
                && getComputedStyle(document.documentElement).getPropertyValue('--kc-keyboard-shell-top').trim());

            const openCard = await f.page.locator('.recharge-card').boundingBox();
            const nativeCard = await f.page.evaluate(() => {
                const card = document.querySelector('.recharge-card');
                const previousHeight = card.style.height;
                card.style.height = 'auto';
                const height = card.getBoundingClientRect().height;
                card.style.height = previousHeight;
                return height;
            });
            const viewportHeight = await f.page.evaluate(() => window.visualViewport?.height || window.innerHeight);
            expect(Math.abs(openCard.height - nativeCard)).toBeLessThanOrEqual(1);
            expect(openCard.y).toBeGreaterThanOrEqual(0);
            expect(Math.abs(openCard.y + openCard.height - viewportHeight + 8)).toBeLessThanOrEqual(16);

            await f.page.evaluate(() => {
                window.__keyboardCloseTopSamples = [];
                const shell = document.querySelector('.page-shell');
                const sample = () => {
                    window.__keyboardCloseTopSamples.push(shell.getBoundingClientRect().top);
                    if (window.__keyboardCloseTopSamples.length < 28) requestAnimationFrame(sample);
                };
                requestAnimationFrame(sample);
            });
            await f.page.setViewportSize({ width: 390, height: 844 });
            await f.page.waitForFunction(() => !document.body.classList.contains('keyboard-open'), { timeout: 2000 });
            await f.page.waitForTimeout(240);

            const tops = await f.page.evaluate(() => window.__keyboardCloseTopSamples);
            const largestFrameMove = Math.max(...tops.slice(1).map((top, index) => Math.abs(top - tops[index])));
            const restoredTop = await f.page.locator('.page-shell').evaluate(shell => shell.getBoundingClientRect().top);
            const restoreDirection = Math.sign(tops.at(-1) - tops[0]);
            const reverseFrames = tops.slice(1).filter((top, index) => {
                const previous = tops[index];
                return restoreDirection > 0 ? top < previous - 1 : top > previous + 1;
            });
            expect(largestFrameMove).toBeLessThan(50);
            expect(reverseFrames).toHaveLength(0);
            expect(restoredTop).toBeGreaterThan(100);
            expect(f.errors).toEqual([]);
        } finally { await f.context.close(); }
    });

    it('freezes the card while the mobile keyboard retracts through intermediate viewport heights', async () => {
        const f = await fixture({ viewport: { width: 390, height: 844 }, isMobile: true });
        try {
            await f.page.locator('#cdkInput').focus();
            await f.page.setViewportSize({ width: 390, height: 420 });
            await f.page.waitForFunction(() => document.body.classList.contains('keyboard-open')
                && getComputedStyle(document.documentElement).getPropertyValue('--kc-keyboard-shell-top').trim());

            await f.page.evaluate(() => {
                window.__keyboardCloseTopSamples = [];
                const shell = document.querySelector('.page-shell');
                const sample = () => {
                    window.__keyboardCloseTopSamples.push(shell.getBoundingClientRect().top);
                    if (window.__keyboardCloseTopSamples.length < 42) requestAnimationFrame(sample);
                };
                requestAnimationFrame(sample);
            });
            await f.page.setViewportSize({ width: 390, height: 500 });
            await f.page.waitForTimeout(55);
            await f.page.setViewportSize({ width: 390, height: 650 });
            await f.page.waitForTimeout(55);
            await f.page.setViewportSize({ width: 390, height: 844 });
            await f.page.waitForTimeout(500);

            const tops = await f.page.evaluate(() => window.__keyboardCloseTopSamples);
            const first = tops[0];
            const final = tops.at(-1);
            const direction = Math.sign(final - first);
            const reverseFrames = tops.slice(1).filter((top, index) => {
                const previous = tops[index];
                return direction > 0 ? top < previous - 1 : top > previous + 1;
            });
            expect(reverseFrames).toHaveLength(0);
            expect(Math.max(...tops.slice(1).map((top, index) => Math.abs(top - tops[index])))).toBeLessThan(50);
            expect(await f.page.locator('.page-shell').evaluate(shell => shell.getBoundingClientRect().top)).toBeGreaterThan(100);
            expect(f.errors).toEqual([]);
        } finally { await f.context.close(); }
    });

    it('does not force the mobile page back to scroll position zero during focus handling', async () => {
        const f = await fixture({ viewport: { width: 390, height: 844 }, isMobile: true });
        try {
            await f.page.evaluate(() => {
                window.__scrollToCalls = [];
                window.scrollTo = (...args) => window.__scrollToCalls.push(args);
                Object.defineProperty(window, 'scrollY', { configurable: true, value: 40 });
                window.dispatchEvent(new Event('scroll'));
            });
            expect(await f.page.evaluate(() => window.__scrollToCalls)).toEqual([]);
            expect(f.errors).toEqual([]);
        } finally { await f.context.close(); }
    });

    it.each([
        ['desktop', { width: 1280, height: 900 }],
        ['compact desktop', { width: 700, height: 900 }],
        ['mobile', { width: 390, height: 844 }]
    ])('collapses the Session status and card together on %s', async (_label, viewport) => {
        const f = await fixture({ viewport });
        try {
            await verify(f.page);
            await f.page.locator('#tokenInput').fill(session({ includeSessionToken: true }));
            await f.page.waitForFunction(() => {
                const status = document.querySelector('#statusMessage');
                const card = document.querySelector('.recharge-card');
                return status.textContent.includes('Session 完整有效')
                    && getComputedStyle(status).display !== 'none'
                    && !card.classList.contains('is-morphing');
            });

            const before = await f.page.evaluate(() => {
                const rect = document.querySelector('.recharge-card').getBoundingClientRect();
                return { width: rect.width, height: rect.height };
            });
            await f.page.evaluate(() => {
                window.__collapseSamples = [];
                document.querySelector('#startBtn').addEventListener('click', () => {
                    const startedAt = performance.now();
                    const sample = () => {
                        const card = document.querySelector('.recharge-card');
                        const status = document.querySelector('#statusMessage');
                        const cardRect = card.getBoundingClientRect();
                        const statusRect = status.getBoundingClientRect();
                        const style = getComputedStyle(status);
                        const px = property => parseFloat(style.getPropertyValue(property)) || 0;
                        window.__collapseSamples.push({
                            t: performance.now() - startedAt,
                            cardHeight: cardRect.height,
                            cardWidth: cardRect.width,
                            statusHeight: statusRect.height,
                            statusContentHeight: statusRect.height - px('padding-top') - px('padding-bottom')
                                - px('border-top-width') - px('border-bottom-width'),
                            statusOpacity: Number.parseFloat(style.opacity),
                            statusDisplay: style.display
                        });
                        if (card.classList.contains('is-morphing')) requestAnimationFrame(sample);
                    };
                    requestAnimationFrame(sample);
                }, { capture: true, once: true });
            });

            await f.page.locator('#startBtn').click();
            await f.page.waitForFunction(() => {
                const card = document.querySelector('.recharge-card');
                const status = document.querySelector('#statusMessage');
                return card.classList.contains('is-morphing')
                    && status.classList.contains('is-collapsing')
                    && getComputedStyle(status).display !== 'none';
            });
            await f.page.waitForFunction(() => !document.querySelector('.recharge-card').classList.contains('is-morphing'));

            const samples = await f.page.evaluate(() => window.__collapseSamples);
            const final = samples.at(-1);
            const firstCardShrink = samples.find(sample => sample.cardHeight < before.height - 1);
            const firstFade = samples.find(sample => sample.statusOpacity < 0.99);
            const fullyFaded = samples.find(sample => sample.statusOpacity <= 0.05);
            const visibleTextSamples = samples.filter(sample => sample.statusDisplay !== 'none' && sample.statusOpacity > 0.05);
            const fadingSamples = samples.filter(sample => sample.statusOpacity > 0.05 && sample.statusOpacity < 0.95);
            expect(firstCardShrink).toBeDefined();
            expect(firstFade).toBeDefined();
            expect(firstCardShrink.t).toBeLessThanOrEqual(firstFade.t);
            expect(fullyFaded).toBeDefined();
            expect(fadingSamples.length).toBeGreaterThan(1);
            expect(fadingSamples.at(-1).cardHeight).toBeLessThan(fadingSamples[0].cardHeight - 1);
            expect(final.t - fullyFaded.t).toBeGreaterThan(100);
            expect(final.t - fullyFaded.t).toBeLessThanOrEqual(240);
            expect(fullyFaded.cardHeight).toBeGreaterThan(final.cardHeight + 5);
            expect(visibleTextSamples.length).toBeGreaterThan(0);
            expect(Math.min(...visibleTextSamples.map(sample => sample.statusContentHeight)))
                .toBeGreaterThanOrEqual(visibleTextSamples[0].statusContentHeight - 2);
            expect(Math.max(...samples.map(sample => Math.abs(sample.cardWidth - before.width))))
                .toBeLessThan(0.5);
            expect(final.cardHeight).toBeLessThan(before.height - 20);
            expect(await f.page.locator('#statusMessage').evaluate(status => getComputedStyle(status).display)).toBe('none');
            expect(f.errors).toEqual([]);
        } finally { await f.context.close(); }
    });

    it('honors reduced motion when dismissing the Session status', async () => {
        const f = await fixture({ reducedMotion: 'reduce' });
        try {
            await verify(f.page);
            await f.page.locator('#tokenInput').fill(session({ includeSessionToken: true }));
            await f.page.waitForFunction(() => document.querySelector('#statusMessage').textContent.includes('Session 完整有效'));
            await f.page.locator('#startBtn').click();
            await f.page.waitForFunction(() => window.__sent.some(data => data.type === 'subscribe'));

            expect(await f.page.locator('#statusMessage').evaluate(status => getComputedStyle(status).display)).toBe('none');
            expect(await f.page.locator('.recharge-card').evaluate(card => card.classList.contains('is-morphing'))).toBe(false);
            expect(f.errors).toEqual([]);
        } finally { await f.context.close(); }
    });

    it('cancels the status entrance morph when recharge starts immediately', async () => {
        const f = await fixture();
        try {
            await verify(f.page);
            await f.page.locator('#tokenInput').fill(session({ includeSessionToken: true }));
            await f.page.waitForFunction(() => {
                const status = document.querySelector('#statusMessage');
                return status.textContent.includes('Session 完整有效')
                    && getComputedStyle(status).display !== 'none'
                    && document.querySelector('.recharge-card').classList.contains('is-morphing');
            });

            await f.page.locator('#startBtn').click();
            await f.page.waitForFunction(() => window.__sent.some(data => data.type === 'subscribe'));
            await f.page.waitForFunction(() => !document.querySelector('.recharge-card').classList.contains('is-morphing'));

            expect(await f.page.locator('#statusMessage').evaluate(status => getComputedStyle(status).display)).toBe('none');
            expect(await f.page.locator('.recharge-card').evaluate(card => card.style.height)).toBe('');
            expect(f.errors).toEqual([]);
        } finally { await f.context.close(); }
    });

    it('plays the circular check, morphs the card, animates both tabs and resets cleanly', async () => {
        const f = await fixture();
        try {
            await f.page.locator('#cdkInput').fill(cdk);
            await f.page.locator('#redeemBtn').click();
            await f.page.waitForFunction(() => document.querySelector('#redeemBtn').classList.contains('is-circle-success'));
            expect(await f.page.locator('#step2').isVisible()).toBe(false);
            expect(await f.page.locator('#step2').evaluate(el => getComputedStyle(el).transitionProperty)).not.toContain('filter');
            await f.page.waitForFunction(() => document.querySelector('.recharge-card').classList.contains('is-morphing'));
            await f.page.waitForFunction(() => !document.querySelector('.recharge-card').classList.contains('is-morphing'));
            expect(await f.page.locator('#cardSubtitle').textContent()).toBe('ChatGPT Plus');
            await f.page.locator('[data-tab="query"]').click();
            expect(await f.page.locator('#tabStage').evaluate(el => el.classList.contains('is-switching'))).toBe(true);
            await f.page.waitForFunction(() => !document.querySelector('#tabStage').classList.contains('is-switching'));
            await f.page.locator('#queryInput').fill(cdk);
            await f.page.locator('#queryBtn').click();
            await f.page.waitForFunction(() => document.querySelector('#statusMessage').textContent.includes('未使用'));
            expect(await f.page.locator('#statusMessage .query-result-card').count()).toBe(1);
            expect(await f.page.locator('#statusMessage').textContent()).not.toContain('<div class=');
            expect(await f.page.locator('#statusMessage .query-history-item').textContent()).toContain('offline@example.test');
            expect(await f.page.locator('#statusMessage .query-history-reason').textContent()).toContain('incorrect_number');
            expect(f.requests.some(r => r.url === '/api/cdk/query' && r.method === 'POST')).toBe(true);
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

    it('prevents progress from shrinking backwards when an initial snapshot is received', async () => {
        const f = await fixture();
        try {
            await verify(f.page);
            // Simulate start button dispatched to 8%
            await f.page.evaluate(() => setProgress(8, '', 'running'));
            const initialWidth = await f.page.evaluate(() => document.querySelector('#startBtnProgress').style.width);
            expect(initialWidth).toBe('8%');

            // Snapshot from server with smaller initial progress (e.g. 3%)
            await f.page.evaluate(() => applyTaskState({ type: 'snapshot', status: 'running', progress: 3 }));
            const postSnapshotWidth = await f.page.evaluate(() => document.querySelector('#startBtnProgress').style.width);
            expect(postSnapshotWidth).toBe('8%');

            // When real higher progress arrives, it moves forward normally
            await f.page.evaluate(() => applyTaskState({ type: 'progress', status: 'running', progress: 15 }));
            const higherWidth = await f.page.evaluate(() => document.querySelector('#startBtnProgress').style.width);
            expect(higherWidth).toBe('15%');
            expect(f.errors).toEqual([]);
        } finally { await f.context.close(); }
    });

    it('centers step 1 cleanly after reset and does not push card into dynamic island when reopening keyboard', async () => {
        const f = await fixture({ viewport: { width: 390, height: 844 }, isMobile: true });
        try {
            await verify(f.page);
            expect(await f.page.locator('#step2').isVisible()).toBe(true);

            // Click reset (backToStep1) on mobile
            await f.page.locator('#backToStep1').click();
            await f.page.waitForFunction(() => document.querySelector('#step1').offsetHeight > 0);
            expect(await f.page.locator('#step2').isVisible()).toBe(false);

            // Verify clean mobile reset: no lingering keyboard classes, no active input focus
            expect(await f.page.evaluate(() => document.body.classList.contains('keyboard-open'))).toBe(false);
            const activeTag = await f.page.evaluate(() => document.activeElement?.tagName?.toLowerCase());
            expect(activeTag).not.toBe('input');

            // Resting card should be vertically centered (y well above 150px)
            const restingBox = await f.page.locator('.recharge-card').boundingBox();
            expect(restingBox.y).toBeGreaterThan(150);

            // Tap CDK input to open mobile keyboard
            await f.page.locator('#cdkInput').focus();
            await f.page.setViewportSize({ width: 390, height: 464 });
            await f.page.waitForFunction(() => document.body.classList.contains('keyboard-open'));

            const keyboardBox = await f.page.locator('.recharge-card').boundingBox();
            // Card must never be shoved under the dynamic island (topInset >= 48)
            expect(keyboardBox.y).toBeGreaterThanOrEqual(48);
            // Card must fit cleanly above keyboard (viewport height 464)
            expect(keyboardBox.y + keyboardBox.height).toBeLessThanOrEqual(464);
            expect(f.errors).toEqual([]);
        } finally { await f.context.close(); }
    });

    it('keeps step 2 card stable, un-squished, and comfortably above keyboard even when visualViewport pans', async () => {
        const f = await fixture({ viewport: { width: 390, height: 844 }, isMobile: true });
        try {
            await verify(f.page);
            expect(await f.page.locator('#step2').isVisible()).toBe(true);
            await f.page.waitForTimeout(250);

            // Entering step 2 on mobile must not silently auto-focus tokenInput
            const activeAfterEnter = await f.page.evaluate(() => document.activeElement?.id || '');
            expect(activeAfterEnter).not.toBe('tokenInput');

            const restingCardBox = await f.page.locator('.recharge-card').boundingBox();
            const restingTokenBox = await f.page.locator('#tokenInput').boundingBox();
            expect(restingTokenBox.height).toBeGreaterThanOrEqual(140);

            // Focus session input (tokenInput) on mobile
            await f.page.locator('#tokenInput').focus();
            await f.page.setViewportSize({ width: 390, height: 430 });
            await f.page.waitForFunction(() => document.body.classList.contains('keyboard-open'));

            const cardBox = await f.page.locator('.recharge-card').boundingBox();
            const tokenBox = await f.page.locator('#tokenInput').boundingBox();
            const btnRowBox = await f.page.locator('.action-btn-row').boundingBox();
            const titleBox = await f.page.locator('#cardTitle').boundingBox();

            // When keyboard is open, tokenInput compacts to 115px to fit perfectly above keyboard
            expect(tokenBox.height).toBeGreaterThanOrEqual(112);
            expect(tokenBox.height).toBeLessThanOrEqual(120);

            // Card must respect topInset >= 14 and leave bottomInset >= 16 above address bar
            expect(cardBox.y).toBeGreaterThanOrEqual(14);
            expect(titleBox.y).toBeGreaterThanOrEqual(14);
            expect(btnRowBox.y + btnRowBox.height).toBeLessThanOrEqual(414);
            expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(415);

            // Simulate iOS Safari panning visualViewport.offsetTop = 220px
            const panMetrics = await f.page.evaluate(() => {
                document.documentElement.style.setProperty('--kc-visual-viewport-offset-top', '220px');
                updateKeyboardCardPositionSync();
                const shellTopVar = parseFloat(document.documentElement.style.getPropertyValue('--kc-keyboard-shell-top'));
                const computedTop = parseFloat(window.getComputedStyle(document.querySelector('.page-shell')).top);
                return { shellTopVar, computedTop };
            });
            expect(panMetrics.shellTopVar).toBeGreaterThanOrEqual(14);
            expect(panMetrics.computedTop).toBeGreaterThanOrEqual(234);
            expect(f.errors).toEqual([]);
        } finally { await f.context.close(); }
    });
});
