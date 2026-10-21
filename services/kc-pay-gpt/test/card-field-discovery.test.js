import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { completeStripeCardPayment, fillCardFieldsOpenAiCheckout } from '../stripe-payment.js';

let browser;
const contexts = [];
const card = { number: '4242424242424242', expiry: '12/30', cvc: '123' };
const semantic = '<input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">';

beforeAll(async () => { browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] }); });
afterEach(async () => { await Promise.all(contexts.splice(0).map(context => context.close())); });
afterAll(async () => { await browser?.close(); });

async function fixture(html, frames = {}) {
    const context = await browser.newContext();
    contexts.push(context);
    await context.route('**/*', route => {
        const body = frames[new URL(route.request().url()).pathname] || '<body></body>';
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body });
    });
    const page = await context.newPage();
    await page.goto('https://chatgpt.com/checkout/openai_llc/offline');
    await page.setContent(`<h1>Configure your plan</h1>${html}<button onclick="window.payClicks++">Upgrade to Pro</button><script>window.payClicks=0</script>`);
    return page;
}

async function fill(page, budget = 4000) {
    const started = performance.now();
    const result = await fillCardFieldsOpenAiCheckout(page, card, budget);
    return { result, elapsed: performance.now() - started };
}

describe('card field discovery uses actual controls and one wait budget', () => {
    it('fills ready main-document fields promptly despite unrelated invisible Stripe frames', async () => {
        const page = await fixture(`<iframe hidden src="https://js.stripe.com/elements-inner-payment.html"></iframe>${semantic}`);
        const { result, elapsed } = await fill(page);
        expect(result).toEqual({ ok: true });
        expect(elapsed).toBeLessThan(2500);
        expect(await page.locator('input[autocomplete="cc-number"]').inputValue()).toBe(card.number);
        expect(await page.locator('input[autocomplete="cc-exp"]').inputValue()).toBe(card.expiry);
        expect(await page.locator('input[autocomplete="cc-csc"]').inputValue()).toBe(card.cvc);
        expect(await page.evaluate(() => window.payClicks)).toBe(0);
    });

    it('fills semantic fields across three differently named Stripe iframes without waiting for a Payment iframe', async () => {
        const page = await fixture('<iframe src="https://js.stripe.com/number"></iframe><iframe src="https://js.stripe.com/expiry"></iframe><iframe src="https://js.stripe.com/cvc"></iframe>', {
            '/number': '<input autocomplete="cc-number">', '/expiry': '<input autocomplete="cc-exp">', '/cvc': '<input autocomplete="cc-csc">'
        });
        const { result, elapsed } = await fill(page);
        expect(result.ok).toBe(true);
        expect(elapsed).toBeLessThan(2500);
        for (const [path, value] of [['/number', card.number], ['/expiry', card.expiry], ['/cvc', card.cvc]]) {
            expect(await page.frames().find(frame => frame.url().endsWith(path)).locator('input').inputValue()).toBe(value);
        }
    });

    it('supports the Claude Payment Element layout using the same field scan', async () => {
        const page = await fixture('<iframe src="https://js.stripe.com/elements-inner-payment.html"></iframe>', {
            '/elements-inner-payment.html': '<input id="payment-numberInput"><input id="payment-expiryInput"><input id="payment-cvcInput">'
        });
        expect((await fill(page)).result.ok).toBe(true);
        const frame = page.frames().find(frame => frame.url().includes('elements-inner-payment'));
        expect(await frame.locator('#payment-numberInput').inputValue()).toBe(card.number);
        expect(await frame.locator('#payment-expiryInput').inputValue()).toBe(card.expiry);
        expect(await frame.locator('#payment-cvcInput').inputValue()).toBe(card.cvc);
    });

    it('waits for all three fields before writing any card data', async () => {
        const page = await fixture('<input autocomplete="cc-number"><input autocomplete="cc-exp">');
        await page.evaluate(() => {
            window.earlyWrites = 0;
            document.querySelectorAll('input').forEach(input => input.oninput = () => {
                if (!document.querySelector('input[autocomplete="cc-csc"]')) window.earlyWrites++;
            });
            setTimeout(() => { document.body.insertAdjacentHTML('beforeend', '<input autocomplete="cc-csc">'); }, 500);
        });
        const { result, elapsed } = await fill(page);
        expect(result.ok).toBe(true);
        expect(elapsed).toBeLessThan(2500);
        expect(await page.evaluate(() => window.earlyWrites)).toBe(0);
    });

    it('does not restart separate timeouts when a required field stays missing', async () => {
        const page = await fixture('<input autocomplete="cc-number"><input autocomplete="cc-exp">');
        const { result, elapsed } = await fill(page, 700);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('OPENAI_CARD_METHOD_NOT_FOUND');
        expect(elapsed).toBeLessThan(1800);
        expect(await page.locator('input').first().inputValue()).toBe('');
        expect(await page.evaluate(() => window.payClicks)).toBe(0);
    });

    it('skips hidden and disabled earlier matches and fills the visible enabled fields', async () => {
        const page = await fixture(`<div hidden>${semantic}</div><input disabled autocomplete="cc-number">${semantic}`);
        expect((await fill(page)).result.ok).toBe(true);
        expect(await page.locator('input[autocomplete="cc-number"]').nth(0).inputValue()).toBe('');
        expect(await page.locator('input[autocomplete="cc-number"]').nth(1).inputValue()).toBe('');
        expect(await page.locator('input[autocomplete="cc-number"]').nth(2).inputValue()).toBe(card.number);
    });

    it('excludes address and CAPTCHA frames from field discovery', async () => {
        const page = await fixture('<iframe src="https://js.stripe.com/elements-inner-address.html"></iframe><iframe src="https://hcaptcha.com/challenge"></iframe>', {
            '/elements-inner-address.html': semantic, '/challenge': semantic
        });
        const { result } = await fill(page, 500);
        expect(result.ok).toBe(false);
        for (const frame of page.frames().filter(frame => frame !== page.mainFrame())) {
            expect(await frame.locator('input').first().inputValue()).toBe('');
        }
    });

    it('retains unnamed legacy Stripe split fields without inspecting arbitrary non-Stripe iframes', async () => {
        const page = await fixture('<iframe src="https://other.test/contact?stripe=1"></iframe><iframe src="https://js.stripe.com/a"></iframe><iframe src="https://js.stripe.com/b"></iframe><iframe src="https://js.stripe.com/c"></iframe>', {
            '/contact': '<input>', '/a': '<input>', '/b': '<input>', '/c': '<input>'
        });
        expect((await fill(page)).result.ok).toBe(true);
        expect(await page.frames().find(frame => frame.url().includes('other.test')).locator('input').inputValue()).toBe('');
    });

    it('does not fill a legacy form while one of its unnamed inputs is hidden', async () => {
        const page = await fixture('<iframe src="https://js.stripe.com/legacy"></iframe>', {
            '/legacy': '<input><input style="display:none"><input>'
        });
        expect((await fill(page, 500)).result.ok).toBe(false);
        const frame = page.frames().find(frame => frame.url().endsWith('/legacy'));
        expect(await frame.locator('input').first().inputValue()).toBe('');
    });

    it('stops if a field rejects the typed card value', async () => {
        const page = await fixture('<input autocomplete="cc-number" maxlength="4"><input autocomplete="cc-exp"><input autocomplete="cc-csc">');
        const { result } = await fill(page);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('CARD_FIELDS_INCOMPLETE');
        expect(await page.locator('input[autocomplete="cc-exp"]').inputValue()).toBe('');
        expect(await page.evaluate(() => window.payClicks)).toBe(0);
    });

    it('rescans actual fields during official form retry recovery', async () => {
        const page = await fixture('<p id="error">Failed to load payment form</p><button id="retry">Retry</button>');
        await page.locator('#retry').evaluate((button, markup) => {
            window.retryClicks = 0;
            button.onclick = () => {
                window.retryClicks++;
                setTimeout(() => {
                    document.querySelector('#error').remove();
                    button.remove();
                    document.body.insertAdjacentHTML('beforeend', markup);
                }, 300);
            };
        }, semantic);
        const { result, elapsed } = await fill(page);
        expect(result.ok).toBe(true);
        expect(elapsed).toBeLessThan(2500);
        expect(await page.evaluate(() => window.retryClicks)).toBe(1);
    });

    it('passes through the full offline OpenAI flow and submits exactly once after validation', async () => {
        const page = await fixture(`${semantic}
            <input type="email" value="offline@example.test">
            <section><h2>Billing address</h2>
                <input autocomplete="billing name" value="Offline Customer">
                <input autocomplete="billing address-line1" value="123 Fixture Street">
                <input autocomplete="billing address-level2" value="Fixture">
                <select autocomplete="billing address-level1"><option value="OR">Oregon</option></select>
                <input autocomplete="billing postal-code" value="97000">
                <select autocomplete="billing country"><option value="US">United States</option></select>
            </section><aside>Due today USD 500<br>Tax (0%) USD 0</aside>`);
        await page.getByRole('button', { name: 'Upgrade to Pro' }).evaluate(button => {
            button.onclick = () => {
                window.payClicks++;
                setTimeout(() => { document.body.innerHTML = '<h1>Your card was declined</h1>'; }, 40);
            };
        });
        const states = [];
        const result = await completeStripeCardPayment(page, card, {
            line1: '123 Fixture Street', city: 'Fixture', state: 'OR', postal_code: '97000', country: 'US'
        }, { holderName: 'Offline Customer', email: 'offline@example.test', platform: 'chatgpt', paymentCurrency: 'USD',
            onPaymentAttemptStarted: async () => states.push('started') });
        if (result.screenshot) {
            const fs = await import('node:fs');
            fs.rmSync(result.screenshot, { force: true });
        }
        expect(result).toMatchObject({ success: false, declined: true, submitted: true });
        expect(states).toEqual(['started']);
        expect(await page.evaluate(() => window.payClicks)).toBe(1);
    });
});
