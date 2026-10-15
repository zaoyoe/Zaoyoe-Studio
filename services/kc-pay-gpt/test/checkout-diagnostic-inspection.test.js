import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { inspectDiagnosticCheckout } from '../checkout-diagnostic-inspection.js';
import { validateCommerceContract } from '../grok-commerce.js';
import { quote } from './fixtures/grok-commerce.js';
import { createDiagnosticReporter, parseDiagnosticOutput, sanitizeDiagnosticReport } from '../checkout-diagnostic.js';

let browser;
const contexts = [];
const writes = [];
const fields = '<input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">';
const stripePath = '/v3/elements-inner-payment-offline.html';
const frame = `<iframe src="https://js.stripe.com${stripePath}"></iframe>`;
const openAiSummary = (currency = 'USD', amount = 20) => `<aside><h2>ChatGPT Plus</h2><p>${currency} ${amount} / month</p><div><span>Due today</span><strong>${currency} ${amount}</strong></div></aside>`;

beforeAll(async () => {
    browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
});
afterEach(async () => {
    vi.restoreAllMocks();
    expect(writes.splice(0)).toEqual([]);
    await Promise.all(contexts.splice(0).map(context => context.close()));
});
afterAll(async () => { await browser?.close(); });

async function fixture(html, { url = 'https://chatgpt.com/checkout/openai_llc/offline', frameBodies = {} } = {}) {
    const context = await browser.newContext();
    contexts.push(context);
    await context.route('**/*', route => {
        if (route.request().method() !== 'GET') writes.push(route.request().method());
        return route.fulfill({ contentType: 'text/html', body: frameBodies[route.request().url()] || fields });
    });
    const page = await context.newPage();
    await page.goto(url);
    await page.setContent(`${html}<button id="submit" type="button" onclick="window.submitClicks++">Subscribe</button>
        <script>window.submitClicks=0;window.cardClicks=0;window.fieldWrites=0;
        document.addEventListener('input',e=>{if(e.target.matches('input:not([type=radio])'))window.fieldWrites++;});</script>`);
    const proto = Object.getPrototypeOf(page.locator('input'));
    for (const method of ['fill', 'press', 'selectOption', 'check', 'uncheck', 'type', 'pressSequentially']) {
        if (typeof proto[method] !== 'function') continue;
        vi.spyOn(proto, method).mockImplementation(() => {
            writes.push(method);
            throw new Error(`Forbidden diagnostic write: ${method}`);
        });
    }
    return page;
}
async function assertUntouched(page) {
    expect(await page.evaluate(() => ({ submit: window.submitClicks, fields: window.fieldWrites }))).toEqual({ submit: 0, fields: 0 });
    for (const child of page.frames()) {
        expect(await child.locator('input:not([type=radio])').evaluateAll(inputs => inputs.map(input => input.value))).toEqual(
            Array(await child.locator('input:not([type=radio])').count()).fill('')
        );
    }
}
const inspect = (page, options = {}) => inspectDiagnosticCheckout(page, { platform: 'chatgpt', planType: 'plus', region: 'US', timeoutMs: 300, ...options });

function claudeSummary() {
    return '<label><input type="radio" name="plan" value="monthly" checked>Pro 按月计费 USD 20</label>'
        + '<label><input type="radio" name="plan" value="annual">Pro 按年计费 USD 200</label>'
        + '<aside><h2>Pro 月付</h2><div><span>Due today</span><strong>USD 20</strong></div></aside>';
}
function nativeSummary(q, form = frame) {
    return `<div role="dialog" aria-label="Checkout"><aside class="x-commerce-summary"><h3>${q.plan.name}</h3><dl>
        <dt>Plan price</dt><dd>USD ${q.plan.amount}/${q.plan.interval}</dd><dt>Estimated tax</dt><dd>Enter address</dd>
        <dt>Due today</dt><dd>USD ${q.first}</dd></dl></aside>${form}
        <input autocomplete="billing address-line1"><a href="https://x.ai/legal/bundled-subscription-terms?us=unified">Terms</a></div>`;
}

// Every fixture is routed locally and all payment-data writes are poisoned.
describe('read-only checkout diagnostic inspection', () => {
    it('confirms the visible OpenAI summary and editable main-document fields without any writes', async () => {
        const page = await fixture(openAiSummary() + fields);
        expect(await inspect(page)).toMatchObject({ kind: 'hosted', product: 'ChatGPT Plus', interval: 'month', amount: 20, currency: 'USD', confirmed: true });
        await assertUntouched(page);
    });

    it('uses visible regional amounts instead of inventing an amount from USD plan configuration', async () => {
        const page = await fixture(openAiSummary('₱', 1499) + fields);
        expect(await inspect(page, { region: 'PH' })).toMatchObject({ amount: 1499, currency: 'PHP', confirmed: true });
        await assertUntouched(page);
    });

    it.each([
        ['no summary', '', { product: null, amount: null, currency: null }],
        ['bare dollar currency', openAiSummary('$'), { amount: 20, currency: null }],
        ['product absent', '<aside><p>Monthly subscription</p><div>Due today USD 20</div></aside>', { product: null, amount: 20, currency: 'USD' }]
    ])('returns unconfirmed with %s even when the form is ready', async (_, summary, expected) => {
        const page = await fixture(summary + fields);
        const result = await inspect(page);
        expect(result).toMatchObject({ ...expected, confirmed: false });
        expect(result.checks.some(check => check.status === 'unconfirmed')).toBe(true);
        await assertUntouched(page);
    });

    it('reads already-selected Pro usage controls without clicking or treating the catalog as evidence', async () => {
        const page = await fixture('<aside><h2>ChatGPT Pro</h2><p>USD 500 / month</p><div>Due today USD 500</div></aside>'
            + '<button aria-checked="false" onclick="window.cardClicks++">Standard</button>'
            + '<button aria-checked="true" onclick="window.cardClicks++">Max usage</button>' + fields);
        expect(await inspect(page, { planType: 'pro_500' })).toMatchObject({ product: 'ChatGPT Pro', amount: 500, confirmed: true });
        expect(await page.evaluate(() => window.cardClicks)).toBe(0);
        await assertUntouched(page);
    });

    it('does not confirm Pro when the selected usage tier lacks authoritative state', async () => {
        const page = await fixture('<aside><h2>ChatGPT Pro</h2><p>USD 500 / month</p><div>Due today USD 500</div></aside><button>Max usage</button>' + fields);
        expect(await inspect(page, { planType: 'pro_500' })).toMatchObject({ amount: 500, confirmed: false });
        await assertUntouched(page);
    });

    it('allows exactly one native Card selection before rescanning fields', async () => {
        const page = await fixture(openAiSummary() + '<button id="paypal" aria-selected="true">PayPal</button>'
            + '<button id="card" aria-selected="false" onclick="window.cardClicks++;this.setAttribute(\'aria-selected\',\'true\');document.querySelector(\'#paypal\').setAttribute(\'aria-selected\',\'false\');document.querySelector(\'#cardfields\').hidden=false">Card</button>'
            + `<div id="cardfields" hidden>${fields}</div>`);
        expect(await inspect(page, { timeoutMs: 1000 })).toMatchObject({ confirmed: true });
        expect(await page.evaluate(() => window.cardClicks)).toBe(1);
        await assertUntouched(page);
    });

    it('supports trusted split Stripe iframes and ignores an unrelated hostile iframe', async () => {
        const page = await fixture(openAiSummary() + '<iframe src="https://evil.test/form"></iframe>'
            + '<iframe src="https://js.stripe.com/number"></iframe><iframe src="https://js.stripe.com/expiry"></iframe><iframe src="https://js.stripe.com/cvc"></iframe>', {
            frameBodies: {
                'https://js.stripe.com/number': '<input autocomplete="cc-number">',
                'https://js.stripe.com/expiry': '<input autocomplete="cc-exp">',
                'https://js.stripe.com/cvc': '<input autocomplete="cc-csc">'
            }
        });
        expect(await inspect(page)).toMatchObject({ confirmed: true });
        await assertUntouched(page);
    });

    it.each(['https://evil.test/form', 'https://js.stripe.com.evil.test/form', 'https://js.stripe.com/elements-inner-address.html', 'https://js.stripe.com/hcaptcha.html'])('rejects fields from excluded iframe %s', async url => {
        const page = await fixture(openAiSummary() + `<iframe src="${url}"></iframe>`);
        await expect(inspect(page, { timeoutMs: 0 })).rejects.toMatchObject({ code: 'CHECKOUT_DIAGNOSTIC_CARD_FIELDS_NOT_READY', diagnosticChecks: expect.arrayContaining([expect.objectContaining({ id: 'card-number', status: 'failed' }), expect.objectContaining({ id: 'form', status: 'failed' })]) });
        await assertUntouched(page);
    });

    it.each(['disabled', 'readonly'])('does not qualify %s card input as editable', async attr => {
        const page = await fixture(openAiSummary() + fields.replace('autocomplete="cc-number"', `autocomplete="cc-number" ${attr}`));
        await expect(inspect(page, { timeoutMs: 0 })).rejects.toMatchObject({ code: 'CHECKOUT_DIAGNOSTIC_CARD_FIELDS_NOT_READY' });
        await assertUntouched(page);
    });

    it('rejects ambiguous editable fields and preserves diagnostic checks', async () => {
        const page = await fixture(openAiSummary() + fields + '<input autocomplete="cc-number">');
        await expect(inspect(page)).rejects.toMatchObject({ code: 'CHECKOUT_DIAGNOSTIC_CARD_FIELDS_AMBIGUOUS', diagnosticChecks: expect.arrayContaining([expect.objectContaining({ status: 'failed' })]) });
        await assertUntouched(page);
    });

    it.each([
        ['product', '<aside><h2>ChatGPT Go</h2><p>USD 20 / month</p><div>Due today USD 20</div></aside>'],
        ['two totals', openAiSummary() + '<aside><div>Due today USD 99</div></aside>'],
        ['annual period', openAiSummary().replace('/ month', '/ year')]
    ])('stops on conflicting OpenAI %s evidence', async (_, summary) => {
        const page = await fixture(summary + fields);
        await expect(inspect(page)).rejects.toMatchObject({ code: 'CHATGPT_CHECKOUT_MISMATCH', diagnosticChecks: expect.arrayContaining([expect.objectContaining({ id: 'product', status: 'failed' })]) });
        await assertUntouched(page);
    });

    it('retains a different official USD amount while marking the reference-price comparison unconfirmed', async () => {
        const page = await fixture(openAiSummary('USD', 25) + fields);
        const result = await inspect(page);
        expect(result).toMatchObject({ amount: 25, currency: 'USD', confirmed: false });
        expect(result.checks).toContainEqual(expect.objectContaining({ id: 'amount', status: 'unconfirmed', message: expect.stringContaining('官方报价与目录参考价不同') }));
        await assertUntouched(page);
    });

    it('keeps a different currency unconfirmed instead of pretending it matches the requested region', async () => {
        const page = await fixture(openAiSummary('EUR') + fields);
        const result = await inspect(page);
        expect(result).toMatchObject({ currency: 'EUR', confirmed: false });
        expect(result.checks).toContainEqual(expect.objectContaining({ id: 'currency', status: 'unconfirmed' }));
        await assertUntouched(page);
    });

    it('rereads quote evidence after selecting Card rather than returning the earlier amount and currency', async () => {
        const page = await fixture(openAiSummary() + '<button id="paypal" aria-selected="true">PayPal</button>'
            + '<button id="card" aria-selected="false" onclick="window.cardClicks++;this.setAttribute(\'aria-selected\',\'true\');document.querySelector(\'#paypal\').setAttribute(\'aria-selected\',\'false\');document.querySelector(\'#cardfields\').hidden=false;document.querySelector(\'aside\').innerHTML=\'<h2>ChatGPT Plus</h2><p>EUR 25 / month</p><div>Due today EUR 25</div>\'">Card</button>'
            + `<div id="cardfields" hidden>${fields}</div>`);
        expect(await inspect(page, { timeoutMs: 1000 })).toMatchObject({ amount: 25, currency: 'EUR', confirmed: false });
        expect(await page.evaluate(() => window.cardClicks)).toBe(1);
        await assertUntouched(page);
    });

    it('rejects a foreign main origin before reading or selecting any payment method', async () => {
        const page = await fixture(openAiSummary() + fields + '<button onclick="window.cardClicks++">Card</button>', { url: 'https://chatgpt.com.evil.test/checkout/openai_llc/offline' });
        await expect(inspect(page)).rejects.toMatchObject({ code: 'CHECKOUT_DIAGNOSTIC_UNTRUSTED' });
        expect(await page.evaluate(() => window.cardClicks)).toBe(0);
        await assertUntouched(page);
    });

    it('reuses Claude selected-plan and amount assertion without selecting, filling, or submitting', async () => {
        const page = await fixture(claudeSummary() + frame, { url: 'https://claude.ai/upgrade/pro' });
        expect(await inspect(page, { platform: 'claude', planType: 'claude_pro' })).toMatchObject({ kind: 'native', product: 'Claude Pro', interval: 'month', amount: 20, currency: 'USD', confirmed: true });
        await assertUntouched(page);
    });

    it('preserves the Claude mismatch code and attaches checks', async () => {
        const page = await fixture(claudeSummary().replace('strong>USD 20', 'strong>USD 200') + frame, { url: 'https://claude.ai/upgrade/pro' });
        await expect(inspect(page, { platform: 'claude', planType: 'claude_pro' })).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_MISMATCH', diagnosticChecks: expect.any(Array) });
        await assertUntouched(page);
    });

    it('checks native Grok contract with final:false and skips unfilled address tax', async () => {
        const q = quote('grok_bundle_premium_monthly', { promo: true });
        const contract = vi.fn(() => validateCommerceContract(q.plan, q.skuId, q.session, q.cart, null, null));
        const page = await fixture(nativeSummary(q), { url: 'https://grok.com/plans' });
        const result = await inspect(page, { platform: 'grok', planType: q.plan.key, checkoutResult: { native: true, commerceObserver: { plan: q.plan, contract } } });
        expect(result).toMatchObject({ kind: 'native', product: 'The X Subscription Premium', interval: 'month', amount: 15, currency: 'USD', confirmed: true });
        expect(contract).toHaveBeenCalledWith({ final: false });
        expect(result.checks).toContainEqual(expect.objectContaining({ id: 'tax', status: 'skipped' }));
        await assertUntouched(page);
    });

    it('does not accept native Grok fields outside the checkout dialog', async () => {
        const q = quote();
        const contract = () => validateCommerceContract(q.plan, q.skuId, q.session, q.cart, null, null);
        const page = await fixture(nativeSummary(q, '') + frame, { url: 'https://grok.com/plans' });
        await expect(inspect(page, { platform: 'grok', planType: q.plan.key, commerceObserver: { plan: q.plan, contract }, timeoutMs: 0 }))
            .rejects.toMatchObject({ code: 'CHECKOUT_DIAGNOSTIC_CARD_FIELDS_NOT_READY' });
        await assertUntouched(page);
    });
    it.each(['chatgpt', 'claude', 'grok'])('combines real %s inspection with the production reporter and sanitizer', async platform => {
        const q = quote();
        const planType = platform === 'grok' ? q.plan.key : platform === 'claude' ? 'claude_pro' : 'plus';
        const url = platform === 'grok' ? 'https://grok.com/plans' : platform === 'claude' ? 'https://claude.ai/upgrade/pro' : 'https://chatgpt.com/checkout/openai_llc/offline';
        const html = platform === 'grok' ? nativeSummary(q) : platform === 'claude' ? claudeSummary() + frame : openAiSummary() + fields;
        const commerceObserver = platform === 'grok' ? { plan: q.plan, contract: () => validateCommerceContract(q.plan, q.skuId, q.session, q.cart, null, null) } : null;
        const page = await fixture(html, { url });
        const result = await inspect(page, { platform, planType, commerceObserver });
        const lines = [], reporter = createDiagnosticReporter({ platform, planType, region: 'US', mode: 'checkout' }, line => lines.push(line));
        reporter.check('session', '官方登录状态', 'passed', '该组件测试假定正式登录检查已通过');
        for (const item of result.checks) reporter.check(item.id, item.label, item.status, item.message);
        reporter.checkout({ ...result, url: page.url() });
        reporter.finish(result.confirmed, '诊断完成');
        const report = parseDiagnosticOutput(lines.join('\n'));
        expect(report).toMatchObject({ success: true, paymentSubmitted: false, checkout: { confirmed: true, kind: platform === 'chatgpt' ? 'hosted' : 'native' } });
        expect(report.checks).toContainEqual(expect.objectContaining({ id: 'form', status: 'passed' }));
        expect(report.checks).toContainEqual(expect.objectContaining({ id: 'product', status: 'passed' }));
        expect(sanitizeDiagnosticReport(reporter.report)).not.toBeNull();
        await assertUntouched(page);
    });

});
