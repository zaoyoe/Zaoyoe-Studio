import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { inspectCaptchaContent, waitForCaptchaContentReady } from '../captcha-content.js';
import { reloadHcaptchaChallenge, translateHcaptchaPrompt } from '../human-verification.js';

let browser;
const contexts = [];
const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#66aaff"/><circle cx="25" cy="30" r="20" fill="#ff7733"/></svg>';
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterEach(async () => { await Promise.all(contexts.splice(0).map(context => context.close())); });
afterAll(async () => { await browser?.close(); });

async function fixture(html, handler) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 720 } });
    contexts.push(context);
    // Serve every request locally; these fixtures cannot reach an actual checkout.
    await context.route('**/*', handler || (route => route.fulfill({ contentType: 'image/svg+xml', body: tile })));
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return page;
}

async function captchaModalFixture(viewport) {
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
    const modalStart = html.indexOf('    <!-- 前端交互式人机验证透传弹窗');
    const modalEnd = html.indexOf('    <!-- 最小化悬浮恢复气泡', modalStart);
    const scriptStart = html.indexOf('        // ==================== 前端交互式人机验证透传控制器');
    const scriptEnd = html.indexOf('        function initWebSocket(', scriptStart);
    const toastStart = html.indexOf('        const capsuleToast =');
    const toastEnd = html.indexOf("        updateFlowUI(1, 'pending');", toastStart);
    const page = await fixture(`<style>${css}</style><div id="statusMsg" style="display:none"></div><div id="capsuleToast" class="capsule-toast" style="display:none"></div>${html.slice(modalStart, modalEnd)}`);
    await page.setViewportSize(viewport);
    await page.addScriptTag({ content: `let activeJobKey = 'offline'; let taskProgressValue = 50; let socket = null; const statusMsg = document.getElementById('statusMsg');\n${html.slice(scriptStart, scriptEnd)}\n${html.slice(toastStart, toastEnd)}` });
    return page;
}

const tallPuzzleImage = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="700"><rect width="400" height="700" fill="#eee"/><rect width="400" height="110" fill="#008899"/><text x="20" y="55" fill="white">OFFLINE PUZZLE</text><rect y="600" width="400" height="100" fill="#556677"/><text x="20" y="665" fill="white">NEXT / VERIFY</text></svg>');

describe('CAPTCHA material rendering', () => {
    it('does not count a CSS background URL as loaded while the ninth image request is pending', async () => {
        let release;
        const pending = new Promise(resolve => { release = resolve; });
        const cells = Array.from({ length: 9 }, (_, i) => `<div class="task-image" style="width:100px;height:100px;background-image:url(https://captcha.test/${i}.svg)"></div>`).join('');
        const page = await fixture(`<h2>Offline nine-image fixture</h2><div class="task-grid" style="display:grid;grid-template-columns:repeat(3,100px)">${cells}</div>`, async route => {
            if (route.request().url().includes('/8.svg')) await pending;
            await route.fulfill({ contentType: 'image/svg+xml', body: tile });
        });
        const loading = await waitForCaptchaContentReady(page.mainFrame(), 600);
        expect(loading).toMatchObject({ ready: false, reason: 'grid_incomplete', loaded: 8, total: 9 });
        release();
        expect(await waitForCaptchaContentReady(page.mainFrame(), 1500)).toMatchObject({ ready: true, loaded: 9, total: 9 });
    });

    it('waits for the reference image even when the answer image has loaded', async () => {
        let release;
        const pending = new Promise(resolve => { release = resolve; });
        const page = await fixture('<div class="prompt-image" style="width:100px;height:100px;background-image:url(https://captcha.test/reference.svg)"></div><img src="https://captcha.test/answer.svg" width="300" height="300">', async route => {
            if (route.request().url().includes('reference')) await pending;
            await route.fulfill({ contentType: 'image/svg+xml', body: tile });
        });
        expect(await waitForCaptchaContentReady(page.mainFrame(), 400)).toMatchObject({ ready: false, reason: 'reference_image_loading' });
        release();
        expect(await waitForCaptchaContentReady(page.mainFrame(), 1500)).toMatchObject({ ready: true });
    });

    it('waits for a header reference placeholder to receive its image, even with a complete answer grid', async () => {
        const cells = Array.from({ length: 9 }, () => '<div class="task-image" style="width:100px;height:100px"><img src="https://captcha.test/answer.svg" width="100" height="100"></div>').join('');
        const page = await fixture(`<div class="challenge-header"><h2>Tap all objects that can be completely concealed by the item shown</h2><div class="image" style="width:80px;height:80px;background:#ddd"><span>•••</span></div></div><div class="task-grid" style="display:grid;grid-template-columns:repeat(3,100px)">${cells}</div>`);
        await page.locator('img').first().evaluate(img => img.decode());
        expect(await inspectCaptchaContent(page.mainFrame())).toMatchObject({ ready: false, reason: 'reference_image_loading' });
        await page.locator('.challenge-header .image').evaluate(el => { el.style.backgroundImage = 'url(https://captcha.test/reference.svg)'; el.textContent = ''; });
        expect(await waitForCaptchaContentReady(page.mainFrame(), 1500)).toMatchObject({ ready: true, loaded: 9, total: 9 });
    });

    it('does not accept a loaded answer while the required reference node has not been inserted yet', async () => {
        const page = await fixture('<div class="challenge-header"><h2>Tap all objects that can be completely concealed by the item shown</h2></div><img src="https://captcha.test/answer.svg" width="300" height="300">');
        await page.locator('img').evaluate(img => img.decode());
        expect(await inspectCaptchaContent(page.mainFrame())).toMatchObject({ ready: false, reason: 'reference_image_missing' });
        await page.locator('.challenge-header').evaluate(el => {
            const img = document.createElement('img');
            img.width = img.height = 80; img.src = 'https://captcha.test/reference.svg';
            el.append(img);
        });
        expect(await waitForCaptchaContentReady(page.mainFrame(), 1500)).toMatchObject({ ready: true });
    });

    it('waits for an inset gray loading reference painted in the same canvas as the completed answer', async () => {
        const page = await fixture('<h2 style="position:absolute;left:20px;top:20px;width:280px">Tap all objects that can be completely concealed by the item shown</h2><canvas width="400" height="440"></canvas>');
        await page.evaluate(() => {
            const ctx = document.querySelector('canvas').getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 400, 440);
            ctx.fillStyle = '#008899'; ctx.fillRect(0, 0, 400, 100);
            ctx.fillStyle = '#ddd'; ctx.fillRect(320, 8, 72, 72);
            ctx.fillStyle = '#e5e5e5'; ctx.fillRect(338, 26, 36, 36);
            ctx.fillStyle = '#fff';
            for (const x of [344, 356, 368]) { ctx.beginPath(); ctx.arc(x, 44, 2, 0, Math.PI * 2); ctx.fill(); }
            ctx.fillStyle = '#cc99cc'; ctx.fillRect(8, 110, 384, 260);
            ctx.fillStyle = '#ffaa33'; ctx.fillRect(40, 150, 100, 100);
            ctx.fillStyle = '#33aacc'; ctx.fillRect(210, 200, 130, 120);
        });
        expect(await inspectCaptchaContent(page.mainFrame())).toMatchObject({ ready: false, reason: 'reference_image_loading' });
        await page.evaluate(() => {
            const ctx = document.querySelector('canvas').getContext('2d');
            ctx.fillStyle = '#eee'; ctx.fillRect(320, 8, 72, 72);
            // A monochrome reference is valid too; color must not be required.
            ctx.fillStyle = '#444'; ctx.fillRect(335, 22, 40, 40);
        });
        expect(await waitForCaptchaContentReady(page.mainFrame(), 1500)).toMatchObject({ ready: true });
        await page.evaluate(() => {
            const ctx = document.querySelector('canvas').getContext('2d');
            ctx.fillStyle = '#eee'; ctx.fillRect(0, 100, 400, 340);
        });
        expect(await inspectCaptchaContent(page.mainFrame())).toMatchObject({ ready: false, reason: 'canvas_incomplete' });
    });

    it('does not require a reference for a line-endpoint challenge', async () => {
        const page = await fixture('<div class="challenge-header"><h2>Please click on the TWO ends of the line</h2></div><img src="https://captcha.test/answer.svg" width="300" height="300">');
        expect(await waitForCaptchaContentReady(page.mainFrame(), 1500)).toMatchObject({ ready: true });
    });

    it('checks reference canvases inside a wrapper and does not count them as answer material', async () => {
        const page = await fixture('<h2>Tap all objects that can be completely concealed by the item shown</h2><div class="prompt-image" style="width:100px;height:100px;padding:8px"><canvas width="80" height="80"></canvas></div>');
        expect(await inspectCaptchaContent(page.mainFrame())).toMatchObject({ ready: false, reason: 'reference_image_loading' });
        await page.evaluate(() => {
            const ctx = document.querySelector('canvas').getContext('2d');
            ctx.fillStyle = '#eee'; ctx.fillRect(0, 0, 80, 80);
            ctx.fillStyle = '#444'; ctx.fillRect(15, 15, 40, 40);
        });
        expect(await inspectCaptchaContent(page.mainFrame())).toMatchObject({ ready: false, reason: 'waiting_for_answer_material' });
        await page.evaluate(() => {
            const img = document.createElement('img');
            img.width = img.height = 300; img.src = 'https://captcha.test/answer.svg';
            document.body.append(img);
        });
        expect(await waitForCaptchaContentReady(page.mainFrame(), 1500)).toMatchObject({ ready: true });
    });

    it('checks a required reference when the prompt is extracted from a non-heading container', async () => {
        const page = await fixture('<div class="prompt-text-container">Tap all objects that can be completely concealed by the item shown</div><img src="https://captcha.test/answer.svg" width="300" height="300">');
        await page.locator('img').evaluate(img => img.decode());
        expect(await inspectCaptchaContent(page.mainFrame())).toMatchObject({ ready: false, reason: 'reference_image_missing' });
        await page.locator('.prompt-text-container').evaluate(el => { el.remove(); });
        expect(await inspectCaptchaContent(page.mainFrame(), 'Tap all objects that can be completely concealed by the item shown'))
            .toMatchObject({ ready: false, reason: 'reference_image_missing' });
    });

    it('does not require a top-right reference for a count/example challenge with material below the prompt', async () => {
        const page = await fixture('<h2>Select all animals that match the example and count shown</h2><canvas width="330" height="330"></canvas>');
        await page.evaluate(() => {
            const ctx = document.querySelector('canvas').getContext('2d');
            ctx.fillStyle = '#eee'; ctx.fillRect(0, 0, 330, 330);
            ctx.fillStyle = '#33aacc'; ctx.fillRect(20, 20, 290, 180);
            ctx.fillStyle = '#444'; ctx.fillRect(100, 260, 50, 50);
        });
        expect(await waitForCaptchaContentReady(page.mainFrame(), 1500)).toMatchObject({ ready: true });
    });

    it('does not use prompt text alone as evidence of an answer image', async () => {
        const page = await fixture('<h2 class="prompt-text">Offline prompt with missing answer material</h2>');
        expect(await inspectCaptchaContent(page.mainFrame())).toMatchObject({ ready: false, reason: 'waiting_for_answer_material' });
    });

    it('recognizes an active spinner inside the challenge interface', async () => {
        const page = await fixture('<div class="challenge-interface"><div class="spinner" style="width:30px;height:30px">Loading</div><img src="https://captcha.test/ready.svg"></div>');
        expect(await inspectCaptchaContent(page.mainFrame())).toMatchObject({ ready: false, reason: 'loading_indicator' });
    });

    it('does not use the colored header of a tall canvas to accept a gray spinner-only answer area', async () => {
        const page = await fixture('<canvas width="400" height="600"></canvas>');
        await page.evaluate(() => {
            const ctx = document.querySelector('canvas').getContext('2d');
            ctx.fillStyle = '#eee'; ctx.fillRect(0, 0, 400, 600);
            ctx.fillStyle = '#008899'; ctx.fillRect(0, 0, 400, 120);
            ctx.strokeStyle = '#333'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(200, 315, 12, 0, Math.PI * 1.5); ctx.stroke();
        });
        expect(await inspectCaptchaContent(page.mainFrame())).toMatchObject({ ready: false, reason: 'canvas_incomplete' });
        await page.evaluate(() => {
            const ctx = document.querySelector('canvas').getContext('2d');
            for (let i = 0; i < 6; i++) {
                ctx.fillStyle = i % 2 ? '#aa44cc' : '#ffaa33';
                ctx.fillRect(30 + i % 3 * 110, 160 + Math.floor(i / 3) * 150, 70, 80);
            }
        });
        expect(await inspectCaptchaContent(page.mainFrame())).toMatchObject({ ready: true });
    });

    it('requires material in every grid canvas, including the last blank cell', async () => {
        const cells = Array.from({ length: 9 }, () => '<div class="task-image" style="width:100px;height:100px"><canvas width="100" height="100"></canvas></div>').join('');
        const page = await fixture(`<div class="task-grid" style="display:grid;grid-template-columns:repeat(3,100px)">${cells}</div>`);
        await page.evaluate(() => {
            document.querySelectorAll('canvas').forEach((canvas, i) => {
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#eee'; ctx.fillRect(0, 0, 100, 100);
                if (i < 8) { ctx.fillStyle = '#33aacc'; ctx.fillRect(5, 5, 70, 70); }
            });
        });
        expect(await inspectCaptchaContent(page.mainFrame())).toMatchObject({ ready: false, loaded: 8, total: 9 });
        await page.evaluate(() => {
            const ctx = document.querySelectorAll('canvas')[8].getContext('2d');
            ctx.fillStyle = '#33aacc'; ctx.fillRect(5, 5, 70, 70);
        });
        expect(await inspectCaptchaContent(page.mainFrame())).toMatchObject({ ready: true, loaded: 9, total: 9 });
    });

    it('detects a blank ninth tile when the entire photo grid is drawn in one canvas', async () => {
        const page = await fixture('<h2>Select animals in this offline fixture</h2><canvas width="330" height="330"></canvas>');
        await page.evaluate(() => {
            const ctx = document.querySelector('canvas').getContext('2d');
            ctx.fillStyle = '#eee'; ctx.fillRect(0, 0, 330, 330);
            for (let i = 0; i < 8; i++) {
                ctx.fillStyle = '#33aacc'; ctx.fillRect(5 + i % 3 * 110, 5 + Math.floor(i / 3) * 110, 100, 100);
                ctx.fillStyle = '#ffaa33'; ctx.fillRect(15 + i % 3 * 110, 15 + Math.floor(i / 3) * 110, 40, 40);
            }
        });
        expect(await inspectCaptchaContent(page.mainFrame())).toMatchObject({ ready: false, reason: 'canvas_grid_incomplete', loaded: 8, total: 9 });
        await page.evaluate(() => {
            const ctx = document.querySelector('canvas').getContext('2d');
            ctx.fillStyle = '#33aacc'; ctx.fillRect(225, 225, 100, 100);
        });
        expect(await inspectCaptchaContent(page.mainFrame())).toMatchObject({ ready: true });
    });
});

describe('CAPTCHA image layout', () => {
    it('shows the complete endpoint translation and retains only the original English beneath it', async () => {
        const page = await captchaModalFixture({ width: 1000, height: 720 });
        const promptEn = 'Please click on the TWO ends of the line';
        await page.evaluate(data => openCaptchaInteractiveModal(data), {
            image: tallPuzzleImage, frameSeq: 1, promptEn, promptZh: translateHcaptchaPrompt(promptEn),
        });
        expect(await page.locator('#captchaPromptHeading').textContent()).toBe('请点击线条的两个端点');
        expect(await page.locator('#captchaPromptDetail').textContent()).toBe(`英文原题：${promptEn}`);
    });
    it.each([{ width: 1000, height: 720 }, { width: 390, height: 650 }])('shows a scroll hint only while content remains below at $width × $height', async viewport => {
        const page = await captchaModalFixture(viewport);
        await page.evaluate(image => openCaptchaInteractiveModal({ image, frameSeq: 1, promptEn: 'Select all bicycles', promptZh: '请选择所有自行车' }), tallPuzzleImage);
        await page.locator('#captchaInteractiveImg').evaluate(img => img.decode());
        const hint = page.locator('#captchaScrollHint');
        await expect.poll(() => hint.isVisible()).toBe(true);
        const hintBox = await hint.boundingBox();
        const cardBox = await page.locator('.captcha-modal-card').boundingBox();
        expect(hintBox.y + hintBox.height).toBeLessThan(cardBox.y + cardBox.height);
        expect(await page.locator('#captchaPromptDetail').textContent()).toContain('英文原题：Select all bicycles');
        expect(await page.locator('#captchaPromptDetail').textContent()).not.toContain('操作指引');
        await hint.click();
        await expect.poll(() => page.locator('#captchaModalBody').evaluate(body => body.scrollTop)).toBeGreaterThan(0);
        await page.locator('#captchaModalBody').evaluate(body => { body.scrollTop = body.scrollHeight; });
        await expect.poll(() => hint.isVisible()).toBe(false);
        await page.locator('#captchaModalBody').evaluate(body => { body.scrollTop = 0; });
        await expect.poll(() => hint.isVisible()).toBe(true);
        if (viewport.width === 390) {
            mkdirSync('/tmp/kc-captcha-scroll-20261012', { recursive: true });
            await page.screenshot({ path: '/tmp/kc-captcha-scroll-20261012/mobile-scroll-hint.png' });
        }
        await page.setViewportSize({ width: 1000, height: 1400 });
        await expect.poll(() => hint.isVisible()).toBe(false);
        await page.setViewportSize(viewport);
        await expect.poll(() => hint.isVisible()).toBe(true);
        const smallImage = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect width="400" height="100" fill="#eee"/></svg>');
        await page.evaluate(image => openCaptchaInteractiveModal({ image, frameSeq: 2 }), smallImage);
        await expect.poll(() => hint.isVisible()).toBe(false);
    });

    it.each([{ width: 1000, height: 720 }, { width: 390, height: 650 }])('keeps the ready dialog size throughout refresh at $width × $height', async viewport => {
        const page = await captchaModalFixture(viewport);
        await page.evaluate(() => openCaptchaInteractiveModal({ loading: true, contentReady: false, frameSeq: 1 }));
        await page.locator('#captchaModalCard').evaluate(card => Promise.all(card.getAnimations().map(animation => animation.finished)));
        const initialBox = await page.locator('#captchaModalCard').boundingBox();
        await page.evaluate(image => openCaptchaInteractiveModal({ image, frameSeq: 2, promptEn: 'Select all bicycles', promptZh: '请选择所有自行车' }), tallPuzzleImage);
        await page.locator('#captchaInteractiveImg').evaluate(img => img.decode());
        // Wait for the existing entrance animation to finish before comparing geometry.
        await page.locator('#captchaModalCard').evaluate(card => Promise.all(card.getAnimations().map(animation => animation.finished)));
        const readyBox = await page.locator('#captchaModalCard').boundingBox();
        expect(Math.abs(initialBox.height - readyBox.height)).toBeLessThan(2);
        await page.evaluate(() => {
            document.getElementById('captchaModalBody').scrollTop = 9999;
            triggerCaptchaRefresh();
            handleCaptchaClickReceived({ handled: true });
        });
        const refreshBox = await page.locator('#captchaModalCard').boundingBox();
        expect(Math.abs(refreshBox.height - readyBox.height)).toBeLessThan(2);
        expect(refreshBox.width).toBe(readyBox.width);
        expect(await page.locator('#captchaStatusTip').isVisible()).toBe(false);
        expect(await page.locator('#captchaStatusTip').textContent()).not.toContain('已接收点击');
        await page.evaluate(() => openCaptchaInteractiveModal({ loading: true, contentReady: false, title: '正在更换题型…', message: '正在为你切换到点选题，请稍候。', frameSeq: 3 }));
        const loadingBox = await page.locator('#captchaModalCard').boundingBox();
        expect(Math.abs(loadingBox.height - readyBox.height)).toBeLessThan(2);
        const loaderBox = await page.locator('#captchaLoadingTitle').boundingBox();
        expect(loaderBox.y).toBeGreaterThan(loadingBox.y);
        expect(loaderBox.y + loaderBox.height).toBeLessThan(loadingBox.y + loadingBox.height);
        if (viewport.width === 390) {
            mkdirSync('/tmp/kc-captcha-polish-20261012', { recursive: true });
            await page.screenshot({ path: '/tmp/kc-captcha-polish-20261012/mobile-loading.png' });
        }
        await page.evaluate(image => openCaptchaInteractiveModal({ image, frameSeq: 4, promptEn: 'Select all bicycles', promptZh: '请选择所有自行车' }), tallPuzzleImage);
        const nextBox = await page.locator('#captchaModalCard').boundingBox();
        expect(Math.abs(nextBox.height - readyBox.height)).toBeLessThan(2);
    });

    it('closes the CAPTCHA and floats a responsive success capsule that sinks away', async () => {
        const page = await captchaModalFixture({ width: 390, height: 650 });
        await page.evaluate(image => openCaptchaInteractiveModal({ image, frameSeq: 1 }), tallPuzzleImage);
        await page.locator('#captchaInteractiveImg').evaluate(img => img.decode());
        await page.evaluate(() => handleCaptchaInteractiveStatus({ cleared: true }));
        const toast = page.locator('#capsuleToast');
        await expect.poll(() => toast.isVisible()).toBe(true);
        expect(await page.locator('#captchaInteractiveModal').isVisible()).toBe(false);
        expect(await page.locator('#statusMsg').isVisible()).toBe(false);
        expect(await toast.textContent()).toBe('安全验证已通过，系统正在继续执行支付…');
        expect(await toast.evaluate(element => getComputedStyle(element).animationName)).toBe('capsuleFloatIn');
        const box = await toast.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        mkdirSync('/tmp/kc-captcha-polish-20261012', { recursive: true });
        await toast.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
        await page.screenshot({ path: '/tmp/kc-captcha-polish-20261012/mobile-success-capsule.png' });
        await expect.poll(() => toast.evaluate(element => getComputedStyle(element).animationName), { timeout: 4000, interval: 50 }).toBe('capsuleFloatOut');
        await expect.poll(() => toast.isVisible()).toBe(false);
    });

    it.each([{ width: 1000, height: 720 }, { width: 390, height: 650 }])('keeps both ends of a tall puzzle accessible at $width × $height', async viewport => {
        const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
        const page = await fixture(`<style>${css}</style><div class="modal-overlay"><div class="modal-card captcha-modal-card"><div class="modal-header">Offline fixture</div><div class="captcha-modal-body"><div class="captcha-guide-banner" style="min-height:180px">Long translated instructions</div><div class="captcha-viewport-container"><img class="captcha-interactive-img" src="https://captcha.test/tall.svg"></div></div></div></div>`, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="700"><rect width="400" height="700" fill="#eee"/><rect width="400" height="110" fill="#008899"/><text x="20" y="55" fill="white">TOP OF PUZZLE</text><rect y="600" width="400" height="100" fill="#556677"/><text x="20" y="665" fill="white">BOTTOM / NEXT / VERIFY</text></svg>' }));
        await page.setViewportSize(viewport);
        await page.locator('img').evaluate(img => img.decode());
        const metrics = await page.evaluate(() => {
            const image = document.querySelector('img').getBoundingClientRect();
            const box = document.querySelector('.captcha-viewport-container').getBoundingClientRect();
            return { contained: image.top >= box.top && image.bottom <= box.bottom, ratio: image.height / image.width };
        });
        expect(metrics.contained).toBe(true);
        expect(metrics.ratio).toBeCloseTo(700 / 400, 2);
        await page.evaluate(() => { document.querySelector('.captcha-modal-body').scrollTop = 9999; });
        const footerVisible = await page.evaluate(() => {
            const body = document.querySelector('.captcha-modal-body').getBoundingClientRect();
            const image = document.querySelector('img').getBoundingClientRect();
            return image.bottom <= body.bottom && image.bottom >= body.top;
        });
        expect(footerVisible).toBe(true);
        if (viewport.width === 390) {
            mkdirSync('/tmp/kc-captcha-followup-20261012', { recursive: true });
            await page.screenshot({ path: '/tmp/kc-captcha-followup-20261012/tall-fixture-footer.png' });
        }
    });
});

describe('official CAPTCHA refresh control', () => {
    it('clicks only the identified refresh control when automatically replacing a drag challenge', async () => {
        const page = await fixture('<button class="refresh" onclick="window.refreshes=(window.refreshes||0)+1">Refresh</button><button onclick="window.submits=(window.submits||0)+1">Verify</button>');
        expect(await reloadHcaptchaChallenge(page, { frame: page.mainFrame() }, { allowCoordinateFallback: false })).toBe(true);
        expect(await page.evaluate(() => ({ refreshes: window.refreshes, submits: window.submits || 0 }))).toEqual({ refreshes: 1, submits: 0 });
    });

    it('does not click an unlabelled toolbar button based on its position during automatic replacement', async () => {
        const page = await fixture('<button style="position:fixed;left:25%;top:80%;height:30px;width:50px" onclick="window.unrelatedClicks=(window.unrelatedClicks||0)+1">?</button>');
        expect(await reloadHcaptchaChallenge(page, { frame: page.mainFrame(), clip: { x: 0, y: 0, width: 1000, height: 720 } }, { allowCoordinateFallback: false })).toBe(false);
        expect(await page.evaluate(() => window.unrelatedClicks || 0)).toBe(0);
    });
});
