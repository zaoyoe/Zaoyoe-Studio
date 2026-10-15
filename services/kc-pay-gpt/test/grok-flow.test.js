import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { injectGrokSession, bootstrapGrokSession, parseOfficialGrokSession } from '../grok-auth.js';
import { openGrokCheckout } from '../pricing-checkout-grok.js';
import { getGrokPlan, isGrokCheckoutUrl, assertGrokCheckoutReady } from '../grok-checkout-state.js';
import { completeStripeCardPayment } from '../stripe-payment.js';
import { fillGrokBilling, assertGrokBillingReady } from '../grok-billing.js';
import { observeGrokPayment, classifyGrokPaymentSnapshot, waitForGrokPaymentOutcome } from '../grok-payment-observer.js';
import { classifyGrokFailure, classifyPaymentResult, shouldRetainCdk } from '../task-safety.js';

const checkout = 'https://checkout.stripe.com/c/pay/cs_test_grokFixture123';
const sessionId = 'cs_test_grokFixture123';
const account = { ok: true, accountId: 'offline-user', email: 'offline@example.test', platformMode: 'grok_web' };
const card = { number: '4242424242424242', expiry: '12/30', cvc: '123', holder: 'Offline Fixture' };
const address = { country: 'US', state: 'OR', city: 'Fixture', postal_code: '97000', line1: '123 Fixture Street' };
let browser;
const contexts = [], screenshots = [];
beforeAll(async () => { browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] }); });
afterEach(async () => {
    await Promise.all(contexts.splice(0).map(context => context.close()));
    for (const path of screenshots.splice(0)) fs.rmSync(path, { force: true });
});
afterAll(async () => { await browser?.close(); });
async function fixturePage(html, url = 'https://grok.com/plans', handler = null) {
    const context = await browser.newContext(); contexts.push(context);
    await context.route('**/*', async route => {
        if (handler && await handler(route)) return;
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    });
    const page = await context.newPage(); await page.goto(url);
    return page;
}
const planButton = '<h2>SuperGrok</h2><button id="plan">Upgrade to SuperGrok</button>';
function order({ name = 'SuperGrok', interval = 'per month', currency = 'USD', amount = 30, total = 30, extra = '' } = {}) {
    return `<aside><h1>${name}</h1><p>${currency} ${amount} ${interval}</p></aside>
        <div><span>Due today</span><span>${currency} ${total}</span></div>${extra}`;
}
function fields() {
    return `<input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">
        <select id="billingCountry"><option value="US">United States</option></select>
        <input id="billingName" required><input autocomplete="address-line1" required><input autocomplete="address-level2" required>
        <select autocomplete="address-level1"><option value="OR">Oregon</option></select><input autocomplete="postal-code" required>
        <input type="email" required><button type="submit" id="pay">Subscribe</button>`;
}
async function paymentPage(result = 'success', extra = '') {
    const page = await fixturePage(`${order()}${fields()}${extra}<script>
        window.payClicks=0;
        document.querySelector('#pay').onclick=()=>{
            window.payClicks++;
            setTimeout(()=>{
                if(${JSON.stringify(result)}==='success')document.body.innerHTML='<h1>Payment successful</h1>';
                if(${JSON.stringify(result)}==='decline')document.body.innerHTML='<div role="alert">Your card was declined</div>';
                if(${JSON.stringify(result)}==='verification')document.body.innerHTML='<div role="alert">安全验证未完成</div>';
            },40);
        };
        </script>`, checkout);
    return page;
}
async function runPayment(page, options = {}) {
    const states = [];
    const result = await completeStripeCardPayment(page, card, address, {
        platform: 'grok', planType: 'supergrok', grokAccount: account, resultTimeoutMs: 1500,
        onPaymentAttemptStarted: async () => states.push('started'), ...options
    });
    if (result.screenshot) screenshots.push(result.screenshot);
    return { result, states };
}

describe('real Grok authentication', () => {
    it('does not treat a profile or anonymous session as an authenticated account', async () => {
        expect(parseOfficialGrokSession({ email: account.email })).toBe(null);
        expect(parseOfficialGrokSession({ status: 'blocked', session: { userId: account.accountId } })).toBe(null);
        await expect(injectGrokSession({}, { status: 'authenticated', session: { userId: account.accountId, sessionId: 'profile-only' } }))
            .rejects.toMatchObject({ code: 'GROK_AUTH_REQUIRED' });
    });
    it('navigates directly to plans and verifies the actual official session response', async () => {
        let requests = 0;
        const page = await fixturePage(planButton, 'https://grok.com/', async route => {
            if (!route.request().url().endsWith('/api/auth/session')) return false;
            requests++;
            await route.fulfill({ json: { status: 'authenticated', session: { userId: account.accountId, email: account.email } } });
            return true;
        });
        const info = await bootstrapGrokSession(page, 'sso=offline-cookie', { planType: 'supergrok' });
        expect(info).toMatchObject(account);
        expect(page.url()).toBe('https://grok.com/plans'); expect(requests).toBe(1);
    });
    it('stops when the page looks signed in but the real session is anonymous', async () => {
        const page = await fixturePage('<p>Offline User</p>', 'https://grok.com/plans', async route => {
            if (!route.request().url().endsWith('/api/auth/session')) return false;
            await route.fulfill({ json: { status: 'unauthenticated' } }); return true;
        });
        await expect(bootstrapGrokSession(page, 'sso=offline-cookie')).rejects.toMatchObject({ code: 'GROK_AUTH_REQUIRED' });
    });
    it('rejects a real session belonging to a different supplied account', async () => {
        const page = await fixturePage(planButton, 'https://grok.com/plans', async route => {
            if (!route.request().url().endsWith('/api/auth/session')) return false;
            await route.fulfill({ json: { status: 'authenticated', session: { userId: account.accountId, email: account.email } } });
            return true;
        });
        await expect(bootstrapGrokSession(page, { sso: 'offline-token', email: 'other@example.test' }))
            .rejects.toMatchObject({ code: 'GROK_AUTH_IDENTITY_MISMATCH' });
    });
    it('preserves the original X csrf cookie and rejects an X/SuperGrok mismatch', async () => {
        let cookies;
        const token = 'a'.repeat(40);
        await injectGrokSession({ addCookies: async value => { cookies = value; } }, `auth_token=${token}; ct0=offline-csrf`);
        expect(cookies.some(c => c.name === 'ct0' && c.value === 'offline-csrf')).toBe(true);
        await expect(bootstrapGrokSession({}, `auth_token=${token}`, { planType: 'supergrok' })).rejects.toMatchObject({ code: 'GROK_AUTH_PLAN_MISMATCH' });
    });
});

describe('direct plans and current checkout handoff', () => {
    it('uses the official plan card CTA and turns the annual switch off', async () => {
        const page = await fixturePage(`<button role="switch" aria-label="Save with annual" aria-checked="true"
            onclick="this.setAttribute('aria-checked',this.getAttribute('aria-checked')==='true'?'false':'true')">Save with annual</button>
            <section data-testid="plan-card-supergrok"><h2>SuperGrok</h2><button data-testid="plan-cta-supergrok" id="plan">Try now</button></section>
            <button onclick="window.adClicks++">Upgrade</button><script>window.adClicks=0;
            document.querySelector('#plan').onclick=()=>fetch('/rest/subscriptions/subscribe/new',{method:'POST',headers:{'content-type':'application/json'},
                body:JSON.stringify({subscriptionType:document.querySelector('[role=switch]').getAttribute('aria-checked')==='true'?'YEARLY':'MONTHLY',requestedTier:'REQUESTED_TIER_GROK_PRO'})})</script>`,
            'https://grok.com/plans', async route => {
                if (!route.request().url().endsWith('/rest/subscriptions/subscribe/new')) return false;
                expect(route.request().postDataJSON().subscriptionType).toBe('MONTHLY');
                await route.fulfill({ json: { url: checkout } }); return true;
            });
        expect(await openGrokCheckout(page, { checkoutTimeoutMs: 1500 })).toMatchObject({ success: true, sessionId });
    });
    it('does not click a homepage advertisement and does not enter an empty Stripe wait', async () => {
        const page = await fixturePage('<button onclick="window.adClicks++">Upgrade</button><script>window.adClicks=0</script>');
        const start = performance.now();
        await expect(openGrokCheckout(page, { entryTimeoutMs: 250 })).rejects.toMatchObject({ code: 'GROK_ENTRY_MISSING' });
        expect(performance.now() - start).toBeLessThan(2000);
        expect(await page.evaluate(() => window.adClicks)).toBe(0);
    });
    it('waits for delayed exact entry and follows only the official create response URL', async () => {
        const page = await fixturePage(`<button>Upgrade</button><div id="plans"></div><script>
            window.planClicks=0;setTimeout(()=>{document.querySelector('#plans').innerHTML=${JSON.stringify(planButton)};
            document.querySelector('#plan').onclick=()=>{window.planClicks++;fetch('/rest/subscriptions/subscribe/new',{method:'POST'})};},120);
            </script>`, 'https://grok.com/plans', async route => {
            if (!route.request().url().endsWith('/rest/subscriptions/subscribe/new')) return false;
            await route.fulfill({ json: { url: checkout } }); return true;
        });
        const result = await openGrokCheckout(page, { entryTimeoutMs: 1000, checkoutTimeoutMs: 1500 });
        expect(result).toMatchObject({ success: true, sessionId, url: checkout });
    });
    it('hands a real checkout popup to the caller', async () => {
        const page = await fixturePage(`${planButton}<script>document.querySelector('#plan').onclick=()=>window.open(${JSON.stringify(checkout)})</script>`);
        let handed;
        await openGrokCheckout(page, { onCheckoutPage: value => { handed = value; }, checkoutTimeoutMs: 1500 });
        expect(handed).not.toBe(page); expect(handed.url()).toBe(checkout);
    });
    it('ignores a stale popup and create responses from another page', async () => {
        const page = await fixturePage(`${planButton}<script>document.querySelector('#plan').onclick=()=>window.other.postMessage('checkout','*')</script>`);
        await page.evaluate(url => { window.other = window.open(url); }, checkout);
        await new Promise(resolve => setTimeout(resolve, 150));
        const other = page.context().pages().find(candidate => candidate !== page);
        await other.evaluate(() => { window.onmessage = () => fetch('https://grok.com/rest/subscriptions/subscribe/new', { method: 'POST' }); });
        await page.context().route('**/rest/subscriptions/subscribe/new', route => route.fulfill({ json: { url: checkout } }));
        await expect(openGrokCheckout(page, { checkoutTimeoutMs: 350 })).rejects.toMatchObject({ code: 'GROK_CHECKOUT_NO_REQUEST' });
        expect(page.url()).toBe('https://grok.com/plans');
    });
    it('rejects a current official create request for a different period or tier', async () => {
        for (const body of [{ subscriptionType: 'YEARLY' }, { requestedTier: 'REQUESTED_TIER_SUPER_GROK_PRO' }]) {
            const page = await fixturePage(`${planButton}<script>document.querySelector('#plan').onclick=()=>fetch('/rest/subscriptions/subscribe/new',
                {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})})</script>`,
                'https://grok.com/plans', async route => {
                    if (!route.request().url().endsWith('/rest/subscriptions/subscribe/new')) return false;
                    await route.fulfill({ json: { url: checkout } }); return true;
                });
            await expect(openGrokCheckout(page, { checkoutTimeoutMs: 1500 })).rejects.toMatchObject({ code: 'GROK_CHECKOUT_PLAN_MISMATCH' });
        }
    });
    it('rejects ambiguous exact actions and an official response pointing to an untrusted host', async () => {
        const page = await fixturePage(planButton + '<button>Upgrade to SuperGrok</button>');
        await expect(openGrokCheckout(page)).rejects.toMatchObject({ code: 'GROK_ENTRY_AMBIGUOUS' });
        await page.setContent(`${planButton}<script>document.querySelector('#plan').onclick=()=>fetch('/rest/subscriptions/subscribe/new',{method:'POST'})</script>`);
        await page.route('**/rest/subscriptions/subscribe/new', route => route.fulfill({ json: { url: 'https://checkout.stripe.com.evil.test/c/pay/cs_test_other' } }));
        await expect(openGrokCheckout(page)).rejects.toMatchObject({ code: 'GROK_CHECKOUT_RESPONSE_UNSUPPORTED' });
        expect(page.url()).toBe('https://grok.com/plans');
    });
    it('never treats Stripe scripts or a substring host match as checkout pages', () => {
        for (const url of ['https://js.stripe.com/v3/checkout/cs_test_abc', 'https://checkout.stripe.com.evil.test/c/pay/cs_test_abc',
            'http://checkout.stripe.com/c/pay/cs_test_abc','https://user:pass@checkout.stripe.com/c/pay/cs_test_abc']) expect(isGrokCheckoutUrl(url)).toBe(false);
        expect(getGrokPlan('grok_super')).toMatchObject({ key: 'supergrok', amount: 30 });
        expect(() => getGrokPlan('supergrok_1000')).toThrow();
    });
});

describe('Grok checkout funding gates and billing', () => {
    it('requires matching plan, monthly period, USD and fresh final amount', async () => {
        const page = await fixturePage(order(), checkout);
        expect(await assertGrokCheckoutReady(page, 'supergrok')).toEqual({ amount: 30, currency: 'USD' });
        for (const bad of [{ name: 'SuperGrok Heavy' }, { interval: 'per year' }, { currency: 'EUR' }, { total: 31 },
            { currency: '$' }, { extra: '<div><span>Total due</span><span>USD 35</span></div>' }]) {
            await page.setContent(order(bad));
            await expect(assertGrokCheckoutReady(page, 'supergrok')).rejects.toMatchObject({ code: 'GROK_PRICE_UNCONFIRMED' });
        }
    });
    it('fills country before remounted state and postal fields, then verifies values', async () => {
        const page = await fixturePage(`<select id="billingCountry"><option value="GB">United Kingdom</option><option value="US">United States</option></select>
            <div id="address"></div><input type="email" value="offline@example.test" readonly>
            <script>document.querySelector('#billingCountry').onchange=()=>{document.querySelector('#address').innerHTML=
                '<input autocomplete="address-line1" required><input autocomplete="address-level2" required><select autocomplete="address-level1"><option value="OR">Oregon</option></select><input autocomplete="postal-code" required>';}</script>`, checkout);
        const info = await fillGrokBilling(page, address, card.holder, account.email);
        expect(await page.locator('[autocomplete="postal-code"]').inputValue()).toBe('97000');
        await page.locator('[autocomplete="postal-code"]').fill('');
        await expect(assertGrokBillingReady(page, info.filled, info.expected)).rejects.toMatchObject({ code: 'GROK_BILLING_UNCONFIRMED' });
    });
    it('waits for existing address fields to return after an asynchronous country remount', async () => {
        const markup = '<input autocomplete="address-line1" required><input autocomplete="address-level2" required><select autocomplete="address-level1"><option value="OR">Oregon</option></select><input autocomplete="postal-code" required>';
        const page = await fixturePage(`<select id="billingCountry"><option value="GB">United Kingdom</option><option value="US">United States</option></select>
            <div id="address">${markup}</div><script>document.querySelector('#billingCountry').onchange=()=>{
                document.querySelector('#address').innerHTML='';setTimeout(()=>{document.querySelector('#address').innerHTML=${JSON.stringify(markup)}},180)}</script>`, checkout);
        const info = await fillGrokBilling(page, address, card.holder, account.email);
        expect(info.filled).toMatchObject({ country: 'US', line1: address.line1, state: 'OR', zip: address.postal_code });
        expect(await assertGrokBillingReady(page, info.filled, info.expected)).toBe(true);
    });
    it('blocks a checkout tied to another email', async () => {
        const page = await fixturePage('<input type="email" value="other@example.test" readonly>', checkout);
        await expect(fillGrokBilling(page, address, card.holder, account.email)).rejects.toMatchObject({ code: 'GROK_BILLING_UNCONFIRMED' });
    });
    it('never converts a safety-gate failure into a card decline or a submitted attempt', async () => {
        const page = await paymentPage();
        await page.locator('aside').evaluate(el => el.innerHTML = '<h1>SuperGrok Heavy</h1><p>USD 300 per month</p>');
        const { result, states } = await runPayment(page);
        expect(result).toMatchObject({ success: false, declined: false, submissionAttempted: false });
        expect(states).toEqual([]); expect(await page.evaluate(() => window.payClicks)).toBe(0);
    });
    it('stops on ambiguous submit buttons without marking payment started', async () => {
        const page = await paymentPage('pending', '<button type="submit">Pay</button>');
        const { result, states } = await runPayment(page);
        expect(result).toMatchObject({ success: false, declined: false, submissionAttempted: false });
        expect(result.error).toContain('GROK_SUBMIT_UNCONFIRMED');
        expect(states).toEqual([]); expect(await page.evaluate(() => window.payClicks)).toBe(0);
    });
});

describe('single Grok payment submit and unified outcome wait', () => {
    it('fills current fields and submits once, with no legacy 45-second wait', async () => {
        const page = await paymentPage();
        const start = performance.now();
        const { result, states } = await runPayment(page);
        expect(result).toMatchObject({ success: true, submitted: true, dueAmount: 30, dueCurrency: 'USD' });
        expect(states).toEqual(['started']); expect(await page.evaluate(() => window.payClicks)).toBe(1);
        expect(performance.now() - start).toBeLessThan(10000);
    });
    it('returns a current explicit decline without a second submit', async () => {
        const page = await paymentPage('decline');
        const { result } = await runPayment(page);
        expect(result).toMatchObject({ success: false, declined: true, canRetryCard: true, submitted: true });
        expect(await page.evaluate(() => window.payClicks)).toBe(1);
    });
    it.each(['verification', 'pending'])('keeps %s after dispatch unknown and never re-submits', async mode => {
        const page = await paymentPage(mode);
        const { result } = await runPayment(page);
        expect(result).toMatchObject({ success: false, code: 'PAYMENT_RESULT_UNKNOWN', declined: false, submitted: true });
        expect(await page.evaluate(() => window.payClicks)).toBe(1);
        expect(classifyPaymentResult(result)).toBe('unknown');
        expect(shouldRetainCdk({ executionMode: 'local_card_pool', paymentState: 'unknown' })).toBe(true);
    });
    it('ignores pre-existing success text and an unrelated redirect', () => {
        const before = { url: checkout, text: 'Payment successful' };
        expect(classifyGrokPaymentSnapshot(before, before, sessionId).state).toBe('pending');
        expect(classifyGrokPaymentSnapshot({ url: 'https://grok.com/?redirect_status=succeeded', text: 'Subscription active' }, before, sessionId).state).toBe('pending');
    });
    it('trusts only responses started after dispatch for the same Stripe session', async () => {
        const page = new EventEmitter(); page.url = () => checkout;
        const observer = observeGrokPayment(page, 'supergrok');
        const old = {}; page.emit('request', old); observer.arm();
        const response = (request, id = sessionId) => ({ request: () => request,
            url: () => `https://api.stripe.com/v1/payment_pages/${id}/confirm`, ok: () => true,
            json: async () => ({ payment_status: 'paid', status: 'complete', currency: 'usd', amount_total: 3000 }) });
        page.emit('response', response(old));
        const unrelated = {}; page.emit('request', unrelated); page.emit('response', response(unrelated, 'cs_test_other'));
        await Promise.resolve(); expect(observer.terminal()).toBe(null);
        const fresh = {}; page.emit('request', fresh); page.emit('response', response(fresh));
        await Promise.resolve(); expect(observer.terminal()).toMatchObject({ state: 'succeeded' });
        observer.dispose(); expect(page.listenerCount('response')).toBe(0);
    });
    it('stops on page closure with unknown, retaining submission evidence', async () => {
        const page = new EventEmitter(); page.url = () => checkout; page.isClosed = () => true;
        const observer = observeGrokPayment(page, 'supergrok'); observer.arm();
        const result = await waitForGrokPaymentOutcome(page, { observer, beforeSubmit: { url: checkout, text: '' }, timeoutMs: 100 });
        expect(result).toMatchObject({ code: 'PAYMENT_RESULT_UNKNOWN', submissionAttempted: true, canRetryCard: false });
        observer.dispose();
    });
    it('retries only actual pre-payment network failures, never submitted or ambiguous ones', () => {
        expect(classifyGrokFailure('network [GROK_NAVIGATION_TIMEOUT]', 'not_started')).toMatchObject({ shouldRetry: true });
        for (const code of ['GROK_ENTRY_MISSING', 'GROK_PRICE_UNCONFIRMED', 'GROK_AUTH_REQUIRED', 'GROK_CHECKOUT_PENDING']) {
            expect(classifyGrokFailure(`failure [${code}]`, 'not_started')).toMatchObject({ shouldRetry: false });
            expect(classifyGrokFailure(`failure [${code}]`, 'started')).toBe(null);
        }
    });
});
