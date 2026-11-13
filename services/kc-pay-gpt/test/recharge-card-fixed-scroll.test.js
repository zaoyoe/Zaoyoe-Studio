import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const publicRoot = path.resolve('public');
const cdk = 'KC-OFFLINE-SCROLL-TEST';

let browser;
beforeAll(async () => {
    browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
});
afterAll(async () => {
    await browser?.close();
});

async function createFixture(viewport = { width: 1280, height: 750 }) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://recharge.test') {
            if (url.hostname === 'unpkg.com') {
                return route.fulfill({ contentType: 'application/javascript', body: 'window.lucide={createIcons(){}};' });
            }
            return route.fulfill({ contentType: 'text/css', body: '' });
        }
        if (url.pathname.startsWith('/api/')) {
            if (url.pathname === '/api/verify-cdk') {
                return route.fulfill({
                    json: {
                        success: true,
                        data: { platform: 'chatgpt', plan_type: 'plus', plan_label: 'ChatGPT Plus' }
                    }
                });
            }
            return route.fulfill({ json: { success: true } });
        }
        const filePath = path.join(publicRoot, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
        if (!filePath.startsWith(publicRoot + path.sep) || !fs.existsSync(filePath)) {
            return route.fulfill({ status: 404, body: '' });
        }
        const ext = path.extname(filePath);
        const contentType = ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'text/html';
        return route.fulfill({ contentType, body: fs.readFileSync(filePath) });
    });

    await page.goto('http://recharge.test/');
    return { context, page };
}

describe('Recharge Card Fixed Viewport & Scroll Containment', () => {
    it('keeps recharge card fixed in viewport without outer page scroll during Session Token entry', async () => {
        const { context, page } = await createFixture({ width: 1280, height: 750 });
        try {
            // 1. Verify body has overscroll-behavior: none and viewport has no outer vertical overflow
            const pageStyles = await page.evaluate(() => {
                const bodyStyle = window.getComputedStyle(document.body);
                return {
                    bodyOverscroll: bodyStyle.overscrollBehaviorY || bodyStyle.overscrollBehavior,
                    outerOverflowPx: document.documentElement.scrollHeight - window.innerHeight
                };
            });
            expect(pageStyles.bodyOverscroll).toBe('none');
            expect(pageStyles.outerOverflowPx).toBeLessThanOrEqual(0);

            // 2. Step 1 -> Step 2
            await page.locator('#cdkInput').fill(cdk);
            await page.locator('#redeemBtn').click();
            await page.waitForFunction(() => document.querySelector('#step2').offsetHeight > 0);
            await page.waitForFunction(() => !document.querySelector('.recharge-card').classList.contains('is-morphing'));

            // 3. tokenInput styling: overscroll-behavior: contain
            const tokenInputStyles = await page.evaluate(() => {
                const input = document.getElementById('tokenInput');
                const style = window.getComputedStyle(input);
                return {
                    overscroll: style.overscrollBehaviorY || style.overscrollBehavior,
                    overflowY: style.overflowY
                };
            });
            expect(tokenInputStyles.overscroll).toBe('contain');
            expect(tokenInputStyles.overflowY).toBe('auto');

            // 4. Fill 4000+ character Session Token JSON
            const largeSession = JSON.stringify({
                user: { id: 'user_123', email: 'test@example.com' },
                accessToken: 'a'.repeat(2500),
                '__Secure-next-auth.session-token': 'b'.repeat(2500)
            });
            await page.locator('#tokenInput').focus();
            expect(await page.evaluate(() => window.scrollY)).toBe(0);

            await page.locator('#tokenInput').fill(largeSession);
            await page.waitForFunction(() => document.querySelector('#statusMessage').style.display !== 'none');
            await page.waitForFunction(() => !document.querySelector('.recharge-card').classList.contains('is-morphing'));
            await page.waitForTimeout(100);

            // 5. Verify status message is displayed and card is within viewport
            expect(await page.locator('#statusMessage').isVisible()).toBe(true);
            const cardBox = await page.locator('#rechargeCard').boundingBox();
            expect(cardBox.y).toBeGreaterThan(0);
            expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(751);
            expect(await page.evaluate(() => window.scrollY)).toBe(0);

            // 6. Scroll inside tokenInput (even past boundaries) does NOT scroll window
            await page.locator('#tokenInput').hover();
            await page.mouse.wheel(0, 5000);
            await page.waitForTimeout(100);
            expect(await page.evaluate(() => window.scrollY)).toBe(0);

            await page.mouse.wheel(0, -5000);
            await page.waitForTimeout(100);
            expect(await page.evaluate(() => window.scrollY)).toBe(0);

            // 7. Scroll outside card on webpage background does NOT scroll window or move card
            await page.mouse.move(50, 50);
            await page.mouse.wheel(0, 3000);
            await page.waitForTimeout(100);
            expect(await page.evaluate(() => window.scrollY)).toBe(0);

            const cardBoxAfter = await page.locator('#rechargeCard').boundingBox();
            expect(cardBoxAfter.y).toBeCloseTo(cardBox.y, 1);
            expect(cardBoxAfter.height).toBeCloseTo(cardBox.height, 1);
        } finally {
            await context.close();
        }
    });
});
