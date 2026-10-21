import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { chromium } from 'playwright';
import {
    waitForPricingContentReady, clickPlanUpgrade, observeCheckout,
    waitForCheckoutPage, isCheckoutDestination, ensurePricingDialogVisible, waitForPricingPage,
    openPricingCheckout
} from '../pricing-checkout.js';

let browser;
const contexts = [];
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterEach(async () => { await Promise.all(contexts.splice(0).map(context => context.close())); });
afterAll(async () => { await browser?.close(); });
async function fixture(html) {
    const context = await browser.newContext();
    contexts.push(context);
    // Every URL is served locally. No request can reach a real recharge service.
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Offline checkout fixture</h1>' }));
    const page = await context.newPage();
    await page.setContent(html);
    return page;
}

function fakeObserver() {
    const context = new EventEmitter();
    const page = new EventEmitter();
    page.context = () => context;
    const observer = observeCheckout(page);
    const request = (owner = page, url = 'https://chatgpt.com/backend-api/payments/checkout', method = 'POST') => ({ url: () => url, method: () => method, frame: () => ({ page: () => owner }) });
    return { context, page, observer, request };
}

describe('pricing dialog recovery', () => {
    const dialogHtml = '<div role="dialog"><h2>Upgrade your plan</h2><button>Upgrade to Plus</button></div>';

    it('rescans an upgrade entry that appears after the initial lookup without navigating again', async () => {
        const page = await fixture('<main><h1>Ready when you are.</h1></main>');
        const navigation = vi.spyOn(page, 'goto');
        await page.evaluate((dialog) => {
            setTimeout(() => {
                const button = document.createElement('button');
                button.textContent = 'Upgrade plan';
                button.onclick = () => { document.body.innerHTML = dialog; };
                document.body.append(button);
            }, 900);
        }, dialogHtml);
        try {
            await expect(ensurePricingDialogVisible(page, 3000)).resolves.toBe(true);
            expect(navigation).not.toHaveBeenCalled();
            expect(await page.getByRole('dialog').isVisible()).toBe(true);
        } finally { navigation.mockRestore(); }
    });

    it('waits beyond the old 15-second cutoff through the full pricing-page flow', async () => {
        const page = await fixture('<main></main>');
        let navigations = 0;
        await page.context().route('https://chatgpt.com/**', route => {
            navigations += 1;
            return route.fulfill({ contentType: 'text/html', body: `
                <main><h1>Ready when you are.</h1></main>
                <script>
                    setTimeout(() => {
                        const button = document.createElement('button');
                        button.textContent = 'Upgrade plan';
                        button.onclick = () => { document.body.innerHTML = ${JSON.stringify(dialogHtml)}; };
                        document.body.append(button);
                    }, 16000);
                </script>` });
        });
        await expect(waitForPricingPage(page)).resolves.toBeUndefined();
        expect(navigations).toBe(1);
        expect(await page.getByRole('dialog').isVisible()).toBe(true);
    });

    it('uses the requested pricing-page timeout instead of a fixed 15 seconds', async () => {
        const page = await fixture('<main></main>');
        const startedAt = Date.now();
        await expect(waitForPricingPage(page, 300)).rejects.toThrow('定价弹窗未能成功弹出');
        expect(Date.now() - startedAt).toBeLessThan(2500);
    });

    it('skips a hidden first pricing link and selects the visible link', async () => {
        const page = await fixture('<a href="#pricing" hidden>Upgrade plan</a><a id="real" href="#pricing">Upgrade plan</a>');
        await page.locator('#real').evaluate((node, dialog) => {
            node.onclick = event => { event.preventDefault(); document.body.innerHTML = dialog; };
        }, dialogHtml);
        await expect(ensurePricingDialogVisible(page, 2000)).resolves.toBe(true);
    });

    it('skips a disabled entry and selects the enabled button', async () => {
        const page = await fixture('<button disabled>Upgrade plan</button><button id="real">Upgrade plan</button>');
        await page.locator('#real').evaluate((node, dialog) => { node.onclick = () => { document.body.innerHTML = dialog; }; }, dialogHtml);
        await expect(ensurePricingDialogVisible(page, 2000)).resolves.toBe(true);
    });

    it('waits for a delayed account-menu item without toggling the account menu closed', async () => {
        const page = await fixture('<button data-testid="accounts-profile-button">Profile</button>');
        await page.evaluate((dialog) => {
            window.profileClicks = 0;
            document.querySelector('button').onclick = () => {
                window.profileClicks += 1;
                setTimeout(() => {
                    const item = document.createElement('button');
                    item.setAttribute('role', 'menuitem');
                    item.textContent = 'Upgrade';
                    item.onclick = () => { document.body.innerHTML = dialog; };
                    document.body.append(item);
                }, 900);
            };
        }, dialogHtml);
        await expect(ensurePricingDialogVisible(page, 3000)).resolves.toBe(true);
        expect(await page.evaluate(() => window.profileClicks)).toBe(1);
    });

    it('ignores upgrade entries inside chat messages and editors and ignores external pricing links', async () => {
        const page = await fixture(`
            <div data-message-author-role="assistant"><a href="#pricing" onclick="window.fakeClicks++">Upgrade plan</a><button onclick="window.fakeClicks++">Upgrade plan</button></div>
            <div contenteditable="true"><button onclick="window.fakeClicks++">Upgrade plan</button></div>
            <a href="https://example.test/#pricing" onclick="window.fakeClicks++">Upgrade plan</a>
            <script>window.fakeClicks = 0;</script>`);
        await expect(ensurePricingDialogVisible(page, 1200)).resolves.toBe(false);
        expect(await page.evaluate(() => window.fakeClicks)).toBe(0);
    });

    it('limits repeated attempts to open pricing without clicking the Plus purchase action', async () => {
        const page = await fixture(`
            <button onclick="window.entryClicks++">Upgrade plan</button>
            <button onclick="window.purchaseClicks++">Upgrade to Plus</button>
            <script>window.entryClicks = 0; window.purchaseClicks = 0;</script>`);
        await expect(ensurePricingDialogVisible(page, 10500)).resolves.toBe(false);
        expect(await page.evaluate(() => window.entryClicks)).toBe(3);
        expect(await page.evaluate(() => window.purchaseClicks)).toBe(0);
    });

    it('returns within the wait budget when no entry appears', async () => {
        const page = await fixture('<main><h1>Ready when you are.</h1></main>');
        const startedAt = Date.now();
        await expect(ensurePricingDialogVisible(page, 300)).resolves.toBe(false);
        expect(Date.now() - startedAt).toBeLessThan(1500);
    });

    it('stops promptly when the page closes while waiting', async () => {
        const page = await fixture('<main><h1>Ready when you are.</h1></main>');
        const assertion = expect(ensurePricingDialogVisible(page, 5000)).rejects.toThrow(/定价页面已关闭|closed/i);
        await page.waitForTimeout(100);
        await page.close();
        await assertion;
    });
});

describe('pricing readiness and precise selection', () => {
    it.each([
        ['blank', '<main></main>'],
        ['homepage upgrade entry', '<main><h1>What can I help with?</h1><button>Upgrade to Plus</button></main>'],
        ['chat message', '<main><div data-message-author-role="assistant"><h2>Plus</h2><button>Upgrade to Plus</button></div></main>'],
        ['loading', '<div role="dialog"><h2>Upgrade your plan</h2><button>Upgrade to Plus</button><p>Getting your plan ready</p></div>']
    ])('rejects %s before any plan action', async (_, html) => {
        const page = await fixture(html);
        await expect(waitForPricingContentReady(page, 80)).rejects.toThrow(/超时|未检测到/);
    });
    it('waits for the pricing loader to finish', async () => {
        const page = await fixture('<div role="dialog"><h2>Upgrade your plan</h2><p id="loader">Getting your plan ready</p><button>Upgrade to Plus</button></div>');
        await page.evaluate(() => setTimeout(() => document.querySelector('#loader').remove(), 100));
        await expect(waitForPricingContentReady(page, 1500)).resolves.toBe(true);
    });
    it('reopens the pricing modal through a known entry', async () => {
        const page = await fixture('<button id="entry">Upgrade plan</button><script>entry.onclick = () => {document.body.innerHTML = \'<div role="dialog"><h2>Upgrade your plan</h2><button>Upgrade to Plus</button></div>\'}</script>');
        await ensurePricingDialogVisible(page, 3000);
        expect(await page.getByRole('dialog').isVisible()).toBe(true);
    });
    it('selects only the Plus card even with other generic actions and dialogs', async () => {
        const page = await fixture(`
            <div role="dialog"><h2>Unrelated dialog</h2><button onclick="window.selected='unrelated'">Start now</button></div>
            <div role="dialog"><h2>Upgrade your plan</h2>
                <section><h3>Go</h3><button onclick="window.selected='Go'">Start now</button></section>
                <section><h3>Plus</h3><p>₱1,100 / month</p><button onclick="window.selected='Plus'">Start now</button></section>
                <section><h3>Pro</h3><button onclick="window.selected='Pro'">Start now</button></section>
            </div>`);
        await clickPlanUpgrade(page, 'plus', { region: 'PH' });
        expect(await page.evaluate(() => window.selected)).toBe('Plus');
    });
    it('does not click a generic action whose container also contains another plan', async () => {
        const page = await fixture('<div role="dialog"><h2>Upgrade your plan</h2><h3>Plus</h3><h3>Go</h3><button onclick="window.selected=true">Start now</button></div>');
        await expect(clickPlanUpgrade(page, 'plus')).rejects.toThrow('未找到可明确归属 Plus');
        expect(await page.evaluate(() => window.selected)).toBeUndefined();
    });
    it('propagates a click failure without falling through to another plan', async () => {
        const page = await fixture('<div role="dialog"><h2>Upgrade your plan</h2><section><h3>Plus</h3><p>₱1,100 / month</p><button>Upgrade to Plus</button></section><section><h3>Go</h3><button>Start now</button></section></div>');
        const originalGetByRole = page.getByRole.bind(page);
        // Get the real locator prototype, replacing click only for the selected upgrade button.
        const proto = Object.getPrototypeOf(originalGetByRole('button').first());
        const spy = vi.spyOn(proto, 'click').mockImplementation(function () { throw new Error('click dispatched then page closed'); });
        try {
            await expect(clickPlanUpgrade(page, 'plus', { region: 'PH' })).rejects.toThrow('click dispatched');
            expect(spy).toHaveBeenCalledOnce();
        } finally { spy.mockRestore(); }
    });
});

describe('checkout request diagnostics', () => {
    it.each([
        ['CHECKOUT_NO_REQUEST', () => {}],
        ['CHECKOUT_REQUEST_PENDING', ({ context, request }) => context.emit('request', request())],
        ['CHECKOUT_NETWORK_ERROR', ({ context, request }) => context.emit('requestfailed', request())],
        ['CHECKOUT_HTTP_ERROR', ({ context, request }) => context.emit('response', { request: () => request(), status: () => 403 })],
        ['CHECKOUT_NAVIGATION_TIMEOUT', ({ context, request }) => context.emit('response', { request: () => request(), status: () => 200 })]
    ])('distinguishes %s', (code, emit) => {
        const state = fakeObserver();
        try { emit(state); expect(state.observer.timeoutReason().code).toBe(code); }
        finally { state.observer.dispose(); }
        expect(state.context.eventNames()).toEqual([]);
        expect(state.page.listenerCount('popup')).toBe(0);
    });
    it('ignores requests from other tasks, other hosts and methods', () => {
        const state = fakeObserver();
        state.context.emit('request', state.request({}));
        state.context.emit('request', state.request(state.page, 'https://chatgpt.com.example.test/backend-api/payments/checkout'));
        state.context.emit('request', state.request(state.page, undefined, 'GET'));
        expect(state.observer.timeoutReason().code).toBe('CHECKOUT_NO_REQUEST');
        state.observer.dispose();
    });
    it('reports a no-effect click without a generic navigation timeout', async () => {
        const page = await fixture('<div role="dialog"><h2>Upgrade your plan</h2><section><h3>Plus</h3><p>₱1,100 / month</p><button>Upgrade to Plus</button></section></div>');
        const observer = observeCheckout(page);
        try {
            await clickPlanUpgrade(page, 'plus', { region: 'PH' });
            await expect(waitForCheckoutPage(page, 100, { observer })).rejects.toMatchObject({ code: 'CHECKOUT_NO_REQUEST' });
        } finally { observer.dispose(); }
    });
    it('classifies a mocked checkout HTTP failure and disposes listeners', async () => {
        const page = await fixture('<button id="request">Create checkout</button>');
        await page.goto('https://chatgpt.com/#pricing');
        await page.context().route('**/backend-api/payments/checkout', route => route.fulfill({
            status: 400, contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'invalid_request', message: 'Unsupported currency' }, access_token: 'must-not-log' })
        }));
        const baseline = page.context().listenerCount('response');
        const wait = waitForCheckoutPage(page, 1500);
        await page.evaluate(() => { void fetch('/backend-api/payments/checkout', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
                plan_name: 'chatgptplusplan', billing_details: { country: 'PH', currency: 'PHP' }, checkout_ui_mode: 'custom', access_token: 'must-not-log'
            })
        }); });
        await expect(wait).rejects.toMatchObject({
            code: 'CHECKOUT_HTTP_ERROR',
            message: 'Checkout 创建接口返回 HTTP 400：invalid_request; Unsupported currency（请求 plan=chatgptplusplan, country=PH, currency=PHP, ui=custom） [CHECKOUT_HTTP_ERROR]'
        });
        expect(page.context().listenerCount('response')).toBe(baseline);
    });
    it('classifies unusual-activity HTTP rejection and cleans up listeners', async () => {
        const page = await fixture('<button id="request">Create checkout</button>');
        await page.goto('https://chatgpt.com/#pricing');
        const navigation = vi.spyOn(page, 'goto');
        await page.context().route('**/backend-api/payments/checkout', route => route.fulfill({
            status: 400, contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'Our systems have detected unusual activity. Please try again later.' } })
        }));
        const baseline = page.context().listenerCount('response');
        const wait = waitForCheckoutPage(page, 1500);
        await page.evaluate(() => { void fetch('/backend-api/payments/checkout', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
                plan_name: 'chatgptplusplan', billing_details: { country: 'PH', currency: 'PHP' }, checkout_ui_mode: 'custom'
            })
        }); });
        await expect(wait).rejects.toMatchObject({
            code: 'CHECKOUT_UNUSUAL_ACTIVITY',
            message: expect.stringContaining('上游检测到异常活动，未进入银行卡支付；请稍后再试')
        });
        expect(navigation).not.toHaveBeenCalled();
        expect(page.context().listenerCount('response')).toBe(baseline);
        navigation.mockRestore();
    });

    it('awaits a delayed error body without dropping its explanation', async () => {
        const state = fakeObserver();
        let resolveBody;
        const body = new Promise(resolve => { resolveBody = resolve; });
        const text = vi.fn(() => body);
        try {
            state.context.emit('response', { request: () => state.request(), status: () => 400, text });
            const pending = state.observer.resolveFailure();
            await Promise.resolve();
            expect(state.observer.failure().message).not.toContain('specific rejection');
            resolveBody(JSON.stringify({ error: { message: 'specific rejection' } }));
            expect(await pending).toMatchObject({ code: 'CHECKOUT_HTTP_ERROR', message: 'Checkout 创建接口返回 HTTP 400：specific rejection' });
            expect(text).toHaveBeenCalledOnce();
        } finally { state.observer.dispose(); }
        expect(state.context.eventNames()).toEqual([]);
    });
    it('never reads successful or unrelated response bodies', async () => {
        const state = fakeObserver();
        const successText = vi.fn();
        const unrelatedText = vi.fn();
        try {
            state.context.emit('response', { request: () => state.request(), status: () => 200, text: successText });
            state.context.emit('response', { request: () => state.request({}), status: () => 400, text: unrelatedText });
            expect(await state.observer.resolveFailure()).toBeNull();
            expect(successText).not.toHaveBeenCalled();
            expect(unrelatedText).not.toHaveBeenCalled();
        } finally { state.observer.dispose(); }
    });
    it('hands the real popup page to the payment flow and removes its listeners', async () => {
        const page = await fixture('<button id="pay" onclick="window.open(\'https://chatgpt.com/checkout/offline\')">Upgrade to Plus</button>');
        const baseline = page.listenerCount('popup');
        const callback = vi.fn();
        const wait = waitForCheckoutPage(page, 2500, { onCheckoutPage: callback });
        const popupPromise = page.waitForEvent('popup');
        await page.locator('#pay').click();
        const popup = await popupPromise;
        expect(await wait).toBe('https://chatgpt.com/checkout/offline');
        expect(callback).toHaveBeenCalledWith(popup);
        expect(page.listenerCount('popup')).toBe(baseline);
    });
    it('cleans up after a closed original page', async () => {
        const page = await fixture('<h1>Offline</h1>');
        const baseline = page.context().listenerCount('request');
        const wait = waitForCheckoutPage(page, 1000);
        await page.close();
        await expect(wait).rejects.toMatchObject({ code: 'CHECKOUT_PAGE_CLOSED' });
        expect(page.context().listenerCount('request')).toBe(baseline);
    });
    it.each([
        ['https://chatgpt.com/checkout/offline', true],
        ['https://checkout.stripe.com/c/pay/offline', true],
        ['https://pay.openai.com/c/pay/offline', true],
        ['https://chatgpt.com/#pricing', false],
        ['https://chatgpt.com/checkoutish', false],
        ['https://chatgpt.com.example.test/checkout/offline', false],
        ['https://example.test/?next=https://checkout.stripe.com/c/pay/offline', false],
        ['http://chatgpt.com/checkout/offline', false]
    ])('validates checkout destination %s', (url, expected) => expect(isCheckoutDestination(url)).toBe(expected));

    it('retries when checkout creation returns unusual-activity and succeeds on second attempt', async () => {
        const dialogHtml = `
            <div id="pricing" role="dialog">
                <h2>Upgrade your plan</h2>
                <button role="tab" aria-selected="true">Personal</button>
                <button id="billing">Philippines</button>
                <section>
                    <h3>Plus</h3>
                    <p>₱1,100 / month</p>
                    <button id="upgrade">Upgrade to Plus</button>
                </section>
            </div>
            <script>
                let attempts = 0;
                document.getElementById('upgrade').onclick = async () => {
                    attempts++;
                    const res = await fetch('/backend-api/payments/checkout', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ attempt: attempts })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        window.location.href = data.url;
                    }
                };
            </script>
        `;
        const page = await fixture('<h1>temp</h1>');
        await page.goto('https://chatgpt.com/#pricing');
        await page.setContent(dialogHtml);

        let callCount = 0;
        await page.context().route('**/backend-api/payments/checkout', route => {
            callCount++;
            if (callCount === 1) {
                return route.fulfill({
                    status: 400,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: { message: 'Our systems have detected unusual activity. Please try again later.' } })
                });
            }
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ url: 'https://chatgpt.com/checkout/offline' })
            });
        });

        const url = await openPricingCheckout(page, { region: 'PH', planType: 'plus', skipPreflight: true });
        expect(url).toBe('https://chatgpt.com/checkout/offline');
        expect(callCount).toBe(2);
    });

    it('throws CHECKOUT_UNUSUAL_ACTIVITY when all retry attempts fail', async () => {
        const dialogHtml = `
            <div id="pricing" role="dialog">
                <h2>Upgrade your plan</h2>
                <button role="tab" aria-selected="true">Personal</button>
                <button id="billing">Philippines</button>
                <section>
                    <h3>Plus</h3>
                    <p>₱1,100 / month</p>
                    <button id="upgrade">Upgrade to Plus</button>
                </section>
            </div>
            <script>
                document.getElementById('upgrade').onclick = () => {
                    fetch('/backend-api/payments/checkout', { method: 'POST' });
                };
            </script>
        `;
        const page = await fixture('<h1>temp</h1>');
        await page.goto('https://chatgpt.com/#pricing');
        await page.setContent(dialogHtml);

        let callCount = 0;
        await page.context().route('**/backend-api/payments/checkout', route => {
            callCount++;
            return route.fulfill({
                status: 400,
                contentType: 'application/json',
                body: JSON.stringify({ error: { message: 'Our systems have detected unusual activity. Please try again later.' } })
            });
        });

        await expect(openPricingCheckout(page, { region: 'PH', planType: 'plus', skipPreflight: true }))
            .rejects.toMatchObject({ code: 'CHECKOUT_UNUSUAL_ACTIVITY' });
        expect(callCount).toBe(2);
    });

    it('actively hijacks and navigates to captured checkoutUrl when SPA routing is stalled after HTTP 200', async () => {
        const dialogHtml = `
            <div id="pricing" role="dialog">
                <h2>Upgrade your plan</h2>
                <button role="tab" aria-selected="true">Personal</button>
                <button id="billing">Philippines</button>
                <section>
                    <h3>Plus</h3>
                    <p>₱1,100 / month</p>
                    <button id="upgrade">Upgrade to Plus</button>
                </section>
            </div>
            <script>
                document.getElementById('upgrade').onclick = () => {
                    // Client does not redirect, simulating stalled SPA routing
                    fetch('/backend-api/payments/checkout', { method: 'POST' });
                };
            </script>
        `;
        const page = await fixture('<h1>temp</h1>');
        await page.goto('https://chatgpt.com/#pricing');
        await page.setContent(dialogHtml);

        await page.context().route('**/backend-api/payments/checkout', route => {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ url: 'https://chatgpt.com/checkout/hijacked-success' })
            });
        });

        const url = await openPricingCheckout(page, { region: 'PH', planType: 'plus', skipPreflight: true });
        expect(url).toBe('https://chatgpt.com/checkout/hijacked-success');
    });
});
