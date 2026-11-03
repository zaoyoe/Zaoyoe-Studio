import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const publicRoot = path.resolve('public');
const adminHtml = fs.readFileSync(path.join(publicRoot, 'admin.html'), 'utf8');
const styles = adminHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const sidebarScript = fs.readFileSync(path.join(publicRoot, 'admin-sidebar.js'), 'utf8');
let browser;

beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
    await browser?.close();
});

async function createSidebar(theme = 'dark') {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const items = Array.from({ length: 36 }, (_, index) => `
        <div class="nav-item"><span>导航项目 ${index + 1}</span></div>
    `).join('');
    await page.setContent(`
        <!doctype html>
        <html data-theme="${theme}">
            <head><style>${styles}</style></head>
            <body>
                <aside class="sidebar">
                    <div class="sidebar-brand"></div>
                    <nav class="nav-menu">${items}</nav>
                    <div class="sidebar-footer"></div>
                </aside>
            </body>
        </html>
    `);
    await page.addScriptTag({ content: sidebarScript });
    return page;
}

describe('admin sidebar scrollbar', () => {
    it('uses a subdued dark-theme thumb and hides it after scrolling stops', async () => {
        const page = await createSidebar();
        try {
            const nav = page.locator('.nav-menu');
            expect(await nav.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
            expect(await nav.evaluate(element => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor))
                .toBe('rgba(0, 0, 0, 0)');

            await nav.evaluate(element => { element.scrollTop = 120; });
            await page.waitForFunction(() => document.querySelector('.sidebar').classList.contains('scrollbar-visible'));
            const activeThumb = await nav.evaluate(element => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor);
            expect(activeThumb).toBe('rgba(148, 163, 184, 0.46)');

            await page.waitForFunction(() => !document.querySelector('.sidebar').classList.contains('scrollbar-visible'), null, { timeout: 2500 });
            expect(await nav.evaluate(element => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor))
                .toBe('rgba(0, 0, 0, 0)');
        } finally {
            await page.close();
        }
    });

    it('uses a muted theme token for the light-theme scrollbar', async () => {
        const page = await createSidebar('light');
        try {
            const color = await page.locator('.sidebar').evaluate(sidebar =>
                getComputedStyle(sidebar).getPropertyValue('--sidebar-scrollbar-thumb').trim()
            );
            expect(color).toBe('rgba(100, 116, 139, 0.48)');
        } finally {
            await page.close();
        }
    });

    it('resumes the idle timeout after a pointer gesture is cancelled', async () => {
        const page = await createSidebar();
        try {
            const nav = page.locator('.nav-menu');
            await nav.dispatchEvent('pointerdown');
            expect(await page.locator('.sidebar').evaluate(sidebar => sidebar.classList.contains('scrollbar-visible')))
                .toBe(true);

            await page.locator('body').dispatchEvent('pointercancel');
            await page.waitForFunction(() => !document.querySelector('.sidebar').classList.contains('scrollbar-visible'), null, { timeout: 2500 });
        } finally {
            await page.close();
        }
    });
});
