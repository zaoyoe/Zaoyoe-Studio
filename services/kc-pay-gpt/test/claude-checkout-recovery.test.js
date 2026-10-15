import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { prepareClaudeCheckout } from '../claude-checkout-recovery.js';
import { ensureClaudePlanSelection } from '../claude-checkout-state.js';
import { shouldBlockLoginNavigation } from '../auth-page-detect.js';

let browser;
const contexts = [];
beforeAll(async () => { browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] }); });
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(contexts.splice(0).map(context => context.close())); });
afterAll(async () => { await browser?.close(); });

function checkout({ amount = 'USD 20', blocked = false, busy = false } = {}) {
    return `<label><input type="radio" name="plan" value="monthly" checked>Pro 按月计费 USD20</label>
        <label><input type="radio" name="plan" value="annual">Pro 按年计费 USD200</label>
        <aside><span>Due today</span><strong id="due">${amount}</strong></aside>
        <button id="pay" onclick="window.payClicks=(window.payClicks||0)+1">Subscribe</button>
        ${blocked ? '<div data-cds-portal style="position:fixed;inset:0;z-index:100;background:white"><div class="animate-pulse">Loading</div></div>' : ''}
        ${busy ? '<div aria-busy="true">Loading total</div>' : ''}`;
}

async function fixture(initial, { restored = checkout(), route = 'pro', abortBilling = '', billingOk = false, card = '' } = {}) {
    const context = await browser.newContext(); contexts.push(context);
    const navigations = [];
    await context.route('**/*', requestRoute => {
        const request = requestRoute.request();
        if (request.url().startsWith('https://js.stripe.com/')) {
            return requestRoute.fulfill({ contentType: 'text/html', body: `<input autocomplete="cc-number" value="${card}">` });
        }
        if (request.url().includes('/api/')) return billingOk ? requestRoute.fulfill({ status: 200, json: {} }) : requestRoute.abort(abortBilling || 'failed');
        if (!request.isNavigationRequest()) return requestRoute.abort();
        navigations.push(request.url());
        return requestRoute.fulfill({ contentType: 'text/html; charset=utf-8', body: navigations.length === 1 ? initial : restored });
    });
    const page = await context.newPage();
    await page.goto(`https://claude.ai/upgrade/${route}`);
    const reload = vi.spyOn(page, 'reload');
    return { page, navigations, reload };
}

function options(extra = {}) {
    return { phase: 'before_card_entry', paymentState: 'not_started', totalTimeoutMs: 1800,
        readinessTimeoutMs: 250, confirmationTimeoutMs: 250, progressGraceMs: 700, log: vi.fn(), ...extra };
}

describe('bounded initial Claude checkout recovery', () => {
    it('continues immediately when already ready, without retrying or reloading', async () => {
        const { page, reload } = await fixture(checkout());
        const start = performance.now();
        expect(await prepareClaudeCheckout(page, 'claude_pro', options())).toEqual({ amount: 20, currency: 'USD' });
        expect(performance.now() - start).toBeLessThan(500);
        expect(reload).not.toHaveBeenCalled();
        expect(await page.evaluate(() => window.payClicks || 0)).toBe(0);
        for (const event of ['request', 'response', 'requestfailed', 'requestfinished']) expect(page.listenerCount(event)).toBe(0);
    });

    it('extends a short stage wait only after actual checkout progress, then continues as soon as the total arrives', async () => {
        const initial = `<div aria-busy="true">Loading</div><script>
            setTimeout(()=>document.body.innerHTML=${JSON.stringify(checkout({ amount: '', busy: true }))},120);
            setTimeout(()=>{document.querySelector('#due').textContent='USD 20';document.querySelector('[aria-busy]').remove()},620);
            </script>`;
        const { page, reload } = await fixture(initial);
        const config = options(); const start = performance.now();
        expect(await prepareClaudeCheckout(page, 'claude_pro', config)).toEqual({ amount: 20, currency: 'USD' });
        expect(reload).not.toHaveBeenCalled();
        expect(JSON.stringify(config.log.mock.calls)).toContain('实际加载进展');
        expect(performance.now() - start).toBeLessThan(1500);
    });

    it('reloads a stalled checkout once in the same context and retains session cookies', async () => {
        const { page, navigations, reload } = await fixture(checkout({ amount: '', blocked: true }));
        await page.context().addCookies([{ name: 'offline-session', value: 'fixture-cookie', url: 'https://claude.ai' }]);
        const context = page.context();
        expect(await prepareClaudeCheckout(page, 'claude_pro', options())).toEqual({ amount: 20, currency: 'USD' });
        expect(reload).toHaveBeenCalledOnce();
        expect(navigations).toEqual(['https://claude.ai/upgrade/pro', 'https://claude.ai/upgrade/pro']);
        expect(page.context()).toBe(context);
        expect((await context.cookies()).find(cookie => cookie.name === 'offline-session')?.value).toBe('fixture-cookie');
        expect(await page.evaluate(() => window.payClicks || 0)).toBe(0);
    });

    it('prefers one official Retry and waits for its asynchronous recovery without reloading', async () => {
        const initial = `<p>Failed to load payment form</p><button id="retry">Retry</button><script>
            window.retryClicks=0;retry.onclick=()=>{window.retryClicks++;setTimeout(()=>document.body.innerHTML=${JSON.stringify(checkout())},180)};
            </script>`;
        const { page, reload } = await fixture(initial);
        expect(await prepareClaudeCheckout(page, 'claude_pro', options({ readinessTimeoutMs: 700 }))).toEqual({ amount: 20, currency: 'USD' });
        expect(await page.evaluate(() => window.retryClicks)).toBe(1);
        expect(reload).not.toHaveBeenCalled();
    });

    it('does not add a reload or a second Retry when the official Retry remains stalled', async () => {
        const { page, reload } = await fixture('<p>Failed to load payment form</p><button onclick="window.retryClicks=(window.retryClicks||0)+1">Retry</button>');
        await expect(prepareClaudeCheckout(page, 'claude_pro', options())).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_LOADING_TIMEOUT' });
        expect(await page.evaluate(() => window.retryClicks)).toBe(1);
        expect(reload).not.toHaveBeenCalled();
        expect(page.listenerCount('requestfinished')).toBe(0);
    });

    it('shares the total deadline across reload and all subsequent waits', async () => {
        const stalled = checkout({ amount: '', blocked: true });
        const { page, reload } = await fixture(stalled, { restored: stalled });
        const start = performance.now();
        await expect(prepareClaudeCheckout(page, 'claude_pro', options({ totalTimeoutMs: 1000, readinessTimeoutMs: 800 }))).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_LOADING_TIMEOUT' });
        expect(reload).toHaveBeenCalledOnce();
        expect(performance.now() - start).toBeLessThan(1350);
    });

    it('does not extend waits for skeleton animation or unrelated text changes', async () => {
        const stalled = checkout({ amount: '', blocked: true }) + '<script>setInterval(()=>document.querySelector(".animate-pulse").textContent=String(Date.now()),20)</script>';
        const { page, reload } = await fixture(stalled, { restored: stalled });
        const config = options();
        await expect(prepareClaudeCheckout(page, 'claude_pro', config)).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_LOADING_TIMEOUT' });
        expect(reload).toHaveBeenCalledOnce();
        expect(JSON.stringify(config.log.mock.calls)).not.toContain('实际加载进展');
    });

    it('does not treat repeated HTTP200 responses as checkout progress', async () => {
        const stalled = checkout({ amount: '', blocked: true }) + '<script>setInterval(()=>fetch("/api/billing/status").catch(()=>{}),40)</script>';
        const { page, reload } = await fixture(stalled, { restored: stalled, billingOk: true });
        const config = options();
        await expect(prepareClaudeCheckout(page, 'claude_pro', config)).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_LOADING_TIMEOUT' });
        expect(reload).toHaveBeenCalledOnce();
        const log = JSON.stringify(config.log.mock.calls);
        expect(log).toContain('billing:HTTP200');
        expect(log).not.toContain('实际加载进展');
    });

    it('does not refresh when the page itself already reports a payment in progress', async () => {
        const { page, reload } = await fixture(checkout({ amount: '' }) + '<p>Processing payment</p>');
        await expect(prepareClaudeCheckout(page, 'claude_pro', options())).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_RECOVERY_NOT_ALLOWED' });
        expect(reload).not.toHaveBeenCalled();
    });

    it.each(['USD 25', 'EUR 20'])('never reloads to repair a real final-total conflict: %s', async amount => {
        const { page, reload } = await fixture(checkout({ amount, busy: true }));
        await expect(prepareClaudeCheckout(page, 'claude_pro', options())).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_MISMATCH' });
        expect(reload).not.toHaveBeenCalled();
        expect(await page.evaluate(() => window.payClicks || 0)).toBe(0);
    });

    it('preserves ambiguous visible totals as a hard stop', async () => {
        const { page, reload } = await fixture(checkout() + '<div>今日应付 USD 200</div>');
        await expect(prepareClaudeCheckout(page, 'claude_pro', options())).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_MISMATCH' });
        expect(reload).not.toHaveBeenCalled();
    });

    it('never reloads a mismatched product route', async () => {
        const { page, reload } = await fixture(checkout(), { route: 'max' });
        await expect(prepareClaudeCheckout(page, 'claude_pro', options())).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_ROUTE_MISMATCH' });
        expect(reload).not.toHaveBeenCalled();
    });

    it('hands an explicit connection banner back to task-level retry without page recovery', async () => {
        const { page, reload } = await fixture('<p>Can\'t reach Claude. Check your connection.</p>');
        await expect(prepareClaudeCheckout(page, 'claude_pro', options())).rejects.toMatchObject({ code: 'CLAUDE_NAV_NETWORK_ERROR' });
        expect(reload).not.toHaveBeenCalled();
    });

    it('exits on a critical billing transport failure and redacts the request identifier', async () => {
        const initial = checkout({ amount: '', blocked: true }) + '<script>setTimeout(()=>fetch("/api/organizations/private-id/billing/checkout?token=fixture-secret").catch(()=>{}),20)</script>';
        const { page, reload } = await fixture(initial, { abortBilling: 'connectionreset' });
        const config = options({ readinessTimeoutMs: 1000 });
        await expect(prepareClaudeCheckout(page, 'claude_pro', config)).rejects.toMatchObject({ code: 'CLAUDE_NAV_NETWORK_ERROR' });
        expect(reload).not.toHaveBeenCalled();
        const log = JSON.stringify(config.log.mock.calls);
        expect(log).toContain('billing:ERR_CONNECTION_RESET');
        expect(log).not.toMatch(/private-id|fixture-secret/);
    });

    it('ignores cancelled requests during a remount and still allows one bounded recovery', async () => {
        const initial = checkout({ amount: '', blocked: true }) + '<script>setTimeout(()=>fetch("/api/organizations/fixture/billing/checkout").catch(()=>{}),20)</script>';
        const { page, reload } = await fixture(initial, { abortBilling: 'aborted' });
        expect(await prepareClaudeCheckout(page, 'claude_pro', options())).toEqual({ amount: 20, currency: 'USD' });
        expect(reload).toHaveBeenCalledOnce();
    });

    it.each(['started', 'unknown', 'succeeded', 'declined'])('refuses recovery once payment state is %s', async paymentState => {
        const { page, reload } = await fixture(checkout({ amount: '' }));
        await expect(prepareClaudeCheckout(page, 'claude_pro', options({ paymentState }))).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_RECOVERY_NOT_ALLOWED' });
        expect(reload).not.toHaveBeenCalled();
    });

    it('requires the explicit before-card-entry phase', async () => {
        const { page, reload } = await fixture(checkout({ amount: '' }));
        await expect(prepareClaudeCheckout(page, 'claude_pro')).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_RECOVERY_NOT_ALLOWED' });
        expect(reload).not.toHaveBeenCalled();
    });

    it('refuses a reload after any card data was entered in the Stripe frame', async () => {
        const { page, reload } = await fixture(checkout({ amount: '' }) + '<iframe src="https://js.stripe.com/v3/elements-inner-payment.html"></iframe>', { card: 'fixture-entered-data' });
        const config = options();
        await expect(prepareClaudeCheckout(page, 'claude_pro', config)).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_RECOVERY_NOT_ALLOWED' });
        expect(reload).not.toHaveBeenCalled();
        expect(JSON.stringify(config.log.mock.calls)).not.toContain('fixture-entered-data');
    });

    it('keeps subsequent strict checks free of reload recovery', async () => {
        const { page, reload } = await fixture(checkout({ amount: '' }));
        await expect(ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 200 })).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_LOADING_TIMEOUT' });
        expect(reload).not.toHaveBeenCalled();
    });
});

describe('core resource blocking contract', () => {
    it.each([
        ['https://claude.ai/api/organizations/fixture/billing/checkout', 'fetch'],
        ['https://claude.ai/_next/static/bootstrap.js', 'script'],
        ['https://assets.claude.ai/checkout.js', 'script'],
        ['https://js.stripe.com/v3/', 'script'],
        ['https://js.stripe.com/v3/elements-inner-payment.html', 'document'],
        ['https://api.stripe.com/v1/elements/sessions', 'xhr'],
        ['https://newassets.hcaptcha.com/captcha/v1/image.png', 'image']
    ])('allows required checkout resources: %s', (url, type) => {
        expect(shouldBlockLoginNavigation(url, type)).toBe(false);
    });
});
