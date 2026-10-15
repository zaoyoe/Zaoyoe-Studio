import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import fs from 'node:fs';
import { completeStripeCardPayment, assertClaudeCardFieldsReady } from '../stripe-payment.js';

let browser;
const contexts = [];
const screenshots = [];
const card = { number: '4242424242424242', expiry: '12/30', cvc: '123', holder: 'Offline Fixture' };
const address = { country: 'US', state: 'OR', city: 'Fixture', postal_code: '97000', line1: '123 Fixture Street' };
const cardForm = '<input id="payment-numberInput" name="number"><input id="payment-expiryInput" name="expiry"><input id="payment-cvcInput" name="cvc">';
const addressForm = '<input id="billingAddress-nameInput"><input id="billingAddress-addressLine1Input"><input id="billingAddress-localityInput"><select id="billingAddress-administrativeAreaInput"><option value="OR">Oregon</option></select><input id="billingAddress-postalCodeInput">';
beforeAll(async () => { browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] }); });
afterEach(async () => {
    await Promise.all(contexts.splice(0).map(context => context.close()));
    for (const path of screenshots.splice(0)) fs.rmSync(path, { force: true });
});
afterAll(async () => { await browser?.close(); });

async function fixture({ annual = false, result = 'success', plainCards = false } = {}) {
    const context = await browser.newContext(); contexts.push(context);
    await context.route('**/*', route => {
        const url = route.request().url();
        const html = url.includes('elements-inner-payment') ? cardForm : url.includes('elements-inner-address') ? addressForm : '<body></body>';
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    });
    const page = await context.newPage(); await page.goto('https://claude.ai/upgrade/pro');
    const choices = plainCards ? `<div><div class="plan-card" data-plan="monthly"><p>Pro 按月计费</p><p>USD 20.00</p></div>
        <div class="plan-card" data-plan="annual"><p>Pro 按年计费</p><p>USD 200.00</p></div></div>`
        : `<label><input name="plan" type="radio" value="monthly" ${annual ? '' : 'checked'}>Pro 按月计费 USD 20.00</label>
        <label><input name="plan" type="radio" value="annual" ${annual ? 'checked' : ''}>Pro 按年计费 USD 200.00</label>`;
    await page.setContent(`${choices}
        <aside>${plainCards ? `<p id="interval">Pro ${annual ? '按年' : '按月'}计费</p>` : ''}<div>Due today <span id="due">USD ${annual ? 200 : 20}</span></div></aside>
        <div id="payment"><iframe src="https://js.stripe.com/v3/elements-inner-payment.html"></iframe></div>
        <iframe src="https://js.stripe.com/v3/elements-inner-address.html"></iframe>
        <div>You agree that Anthropic will charge <span role="checkbox" data-cds="Checkbox" aria-checked="false" onclick="this.setAttribute('aria-checked','true')">Agree</span></div>
        <button id="pay">Subscribe</button>
        <script>
        window.planClicks=0;window.payClicks=0;
        document.querySelectorAll('input[type=radio], .plan-card').forEach(el=>el.onclick=()=>{
            window.planClicks++;
            const plan = el.value || el.dataset.plan;
            document.querySelector('#payment').innerHTML='';
            setTimeout(()=>{
                document.querySelector('#due').textContent='USD '+(plan==='annual'?200:20);
                const interval = document.querySelector('#interval');
                if(interval) interval.textContent='Pro '+(plan==='annual'?'按年':'按月')+'计费';
                document.querySelector('#payment').innerHTML='<iframe src="https://js.stripe.com/v3/elements-inner-payment.html?remounted=1"></iframe>';
            },120);
        });
        document.querySelector('#pay').onclick=()=>{
            window.payClicks++;
            setTimeout(()=>document.body.innerHTML=${JSON.stringify(result === 'success' ? '<h1>支付成功</h1>' : '<h1>Your card was declined</h1>')},40);
        };
        </script>`);
    await page.frames().find(frame => frame.url().includes('elements-inner-payment'))?.waitForLoadState();
    return page;
}
async function run(page) {
    const states = [];
    const started = performance.now();
    const result = await completeStripeCardPayment(page, card, address, {
        platform: 'claude', planType: 'claude_pro', onPaymentAttemptStarted: async () => states.push('started')
    });
    if (result.screenshot) screenshots.push(result.screenshot);
    return { result, states, elapsed: performance.now() - started };
}

describe('offline Claude native checkout integration', () => {
    it('fills Stripe elements, validates and submits exactly once', async () => {
        const page = await fixture();
        const { result, states, elapsed } = await run(page);
        expect(result).toMatchObject({ success: true, submitted: true, submissionAttempted: true, dueAmount: 20, dueCurrency: 'USD' });
        expect(states).toEqual(['started']);
        expect(await page.evaluate(() => window.payClicks)).toBe(1);
        expect(await page.evaluate(() => window.planClicks)).toBe(0);
        console.log(`Offline Claude flow: ${Math.round(elapsed)}ms`);
    });
    it('handles Stripe iframe remount after a single monthly selection', async () => {
        const page = await fixture({ annual: true });
        const { result } = await run(page);
        expect(result).toMatchObject({ success: true, dueAmount: 20 });
        expect(await page.evaluate(() => window.planClicks)).toBe(1);
        expect(await page.evaluate(() => window.payClicks)).toBe(1);
    });
    it('switches screenshot-style plain cards, survives iframe remount, then pays once', async () => {
        const page = await fixture({ annual: true, plainCards: true });
        const { result, states } = await run(page);
        expect(result).toMatchObject({ success: true, dueAmount: 20, submissionAttempted: true });
        expect(states).toEqual(['started']);
        expect(await page.evaluate(() => window.planClicks)).toBe(1);
        expect(await page.evaluate(() => window.payClicks)).toBe(1);
    });
    it('returns a real decline without clicking another submit button', async () => {
        const page = await fixture({ result: 'decline' });
        const { result } = await run(page);
        expect(result).toMatchObject({ success: false, declined: true, canRetryCard: true, submissionAttempted: true });
        expect(await page.evaluate(() => window.payClicks)).toBe(1);
    });
    it('blocks card fields reset by an iframe remount before payment', async () => {
        const page = await fixture();
        const frame = page.frames().find(frame => frame.url().includes('elements-inner-payment'));
        await frame.locator('#payment-numberInput').fill(card.number);
        await frame.locator('#payment-expiryInput').fill(card.expiry);
        await frame.locator('#payment-cvcInput').fill(card.cvc);
        expect(await assertClaudeCardFieldsReady(page, card)).toBe(true);
        await frame.locator('#payment-numberInput').fill('');
        await expect(assertClaudeCardFieldsReady(page, card)).rejects.toMatchObject({ code: 'CLAUDE_CARD_FIELDS_CHANGED' });
        expect(await page.evaluate(() => window.payClicks)).toBe(0);
    });
    it('does not mark submission started when card fields reset during pre-submit preparation', async () => {
        const page = await fixture();
        await page.locator('[role="checkbox"]').evaluate(checkbox => {
            checkbox.onclick = () => {
                checkbox.setAttribute('aria-checked', 'true');
                document.querySelector('#payment').innerHTML = '<iframe src="https://js.stripe.com/v3/elements-inner-payment.html?reset=1"></iframe>';
            };
        });
        const { result, states } = await run(page);
        expect(result).toMatchObject({ success: false, submissionAttempted: false, submitted: false });
        expect(states).toEqual([]);
        expect(await page.evaluate(() => window.payClicks)).toBe(0);
    });
});
