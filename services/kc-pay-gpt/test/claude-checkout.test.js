import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { ensureClaudePlanSelection, assertClaudeCheckoutReady, getClaudePlanRule, readClaudeCheckoutSnapshot } from '../claude-checkout-state.js';
import { openClaudeCheckout } from '../pricing-checkout-claude.js';
import { clickCheckoutSubmitButton } from '../stripe-payment.js';
import { classifyClaudeCheckoutReadinessFailure } from '../task-safety.js';

let browser;
const contexts = [];
beforeAll(async () => { browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] }); });
afterEach(async () => { await Promise.all(contexts.splice(0).map(context => context.close())); });
afterAll(async () => { await browser?.close(); });

function pro({ annual = false, amount = annual ? 200 : 20, currency = 'USD', label = 'Due today' } = {}) {
    return `<label><input type="radio" name="plan" value="monthly" ${annual ? '' : 'checked'}>Pro 按月计费 USD 20.00</label>
        <label><input type="radio" name="plan" value="annual" ${annual ? 'checked' : ''}>Pro 按年计费 USD 200.00</label>
        <section id="summary"><span>${label}</span><strong id="due">${currency} ${amount}</strong></section>
        <button id="pay">Subscribe</button><script>
        window.planClicks=0;window.payClicks=0;
        document.querySelectorAll('input[type=radio]').forEach(el=>el.addEventListener('click',()=>{
            window.planClicks++;setTimeout(()=>document.querySelector('#due').textContent='USD '+(el.value==='annual'?200:20),120);
        }));
        document.querySelector('#pay').onclick=()=>window.payClicks++;
        </script>`;
}
async function fixture(html = pro(), route = 'pro') {
    const context = await browser.newContext(); contexts.push(context);
    await context.route('**/*', route => route.request().isNavigationRequest()
        ? route.fulfill({ contentType: 'text/html', body: '<body></body>' }) : route.abort());
    const page = await context.newPage();
    await page.goto(`https://claude.ai/upgrade/${route}`); await page.setContent(html);
    return page;
}

// Screenshot regression: cards show a drawn radio but need not expose a radio
// role/input. Selection is reflected in the separate official order summary.
function proCards({ annual = true, nestedRadio = false, summary = true, updateSummary = true } = {}) {
    return `<div class="choices"><div id="monthly" class="plan-card">
        <div class="circle">${nestedRadio ? `<input type="radio" name="plan" ${annual ? '' : 'checked'} style="display:none">` : '<svg></svg>'}</div>
        <p>Pro 按月计费</p><p>USD 20.00</p><p>按月计费</p></div>
        <div id="annual" class="plan-card"><div class="circle">${nestedRadio ? `<input type="radio" name="plan" ${annual ? 'checked' : ''} style="display:none">` : '<svg></svg>'}</div>
        <p>Pro 按年计费</p><p>USD 200.00</p><p>按年计费</p></div></div>
        <aside><h2>Pro 套餐</h2>${summary ? `<div><span id="interval">Pro ${annual ? '按年' : '按月'}计费</span><span>US$${annual ? 200 : 20}.00</span></div>` : ''}
        <div><span>小计</span><span>US$${annual ? 200 : 20}.00</span></div>
        <div><span>税费</span><span>US$0.00</span></div>
        <div><span>今日应付总额</span><span id="due">US$${annual ? 200 : 20}.00</span></div></aside>
        <script>window.planClicks=0;
        for(const card of document.querySelectorAll('.plan-card')) card.onclick=()=>{
            window.planClicks++;
            for(const radio of document.querySelectorAll('input[type=radio]')) radio.checked=card.contains(radio);
            setTimeout(()=>{
                document.querySelector('#due').textContent='US$'+(card.id==='monthly'?20:200)+'.00';
                ${updateSummary && summary ? "document.querySelector('#interval').textContent='Pro '+(card.id==='monthly'?'按月':'按年')+'计费';" : ''}
            },100);
        };</script>`;
}

describe('Claude visible plan card regression', () => {
    it('switches the screenshot-style annual card to monthly once without ARIA/native radios', async () => {
        const page = await fixture(proCards());
        expect(await ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 2000 })).toEqual({ amount: 20, currency: 'USD' });
        expect(await page.evaluate(() => window.planClicks)).toBe(1);
        expect(await assertClaudeCheckoutReady(page, 'claude_pro')).toEqual({ amount: 20, currency: 'USD' });
    });
    it('recognizes an already monthly plain card from independent summary text without clicking', async () => {
        const page = await fixture(proCards({ annual: false }));
        await ensureClaudePlanSelection(page, 'claude_pro');
        expect(await page.evaluate(() => window.planClicks)).toBe(0);
    });
    it('supports hidden radios inside decorative wrappers separate from plan titles', async () => {
        const page = await fixture(proCards({ nestedRadio: true }));
        await ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 2000 });
        expect(await page.evaluate(() => window.planClicks)).toBe(1);
    });
    it('can select annual through the same card layout', async () => {
        const page = await fixture(proCards({ annual: false }));
        expect(await ensureClaudePlanSelection(page, 'claude_pro_annual')).toEqual({ amount: 200, currency: 'USD' });
        expect(await page.evaluate(() => window.planClicks)).toBe(1);
    });
    it('does not infer a selected plan solely from an amount or CSS blue border', async () => {
        const page = await fixture(proCards({ annual: false, summary: false }));
        await expect(assertClaudeCheckoutReady(page, 'claude_pro')).rejects.toThrow('资金安全拦截');
    });
    it('blocks a matching amount while the official summary still names the annual interval', async () => {
        const page = await fixture(proCards({ updateSummary: false }));
        await expect(ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 400 })).rejects.toThrow('资金安全拦截');
        expect(await page.evaluate(() => window.planClicks)).toBe(1);
    });
    it('blocks conflicting native selection and summary evidence', async () => {
        const page = await fixture(proCards({ nestedRadio: true, annual: false }));
        await page.locator('#interval').evaluate(el => el.textContent = 'Pro 按年计费');
        await expect(assertClaudeCheckoutReady(page, 'claude_pro')).rejects.toThrow('资金安全拦截');
    });
    it('ignores a standalone summary label/price as a clickable choice', async () => {
        const page = await fixture('<aside><p>Pro 按月计费</p><p>USD 20.00</p><div>今日应付总额 US$20.00</div></aside>');
        await expect(ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 200 })).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_CONTROLS_TIMEOUT' });
        await expect(assertClaudeCheckoutReady(page, 'claude_pro')).rejects.toThrow('资金安全拦截');
    });
    it('supports English Max cards and independently confirms the selected tier', async () => {
        const page = await fixture(`<div><button id="five"><span>Max 5x</span><span>USD 100.00</span></button>
            <button id="twenty"><span>Max 20x</span><span>USD 200.00</span></button></div>
            <aside><p id="tier">Max 20x</p><div>Due today <span id="due">US$200.00</span></div></aside>
            <script>window.clicks=0;document.querySelector('#five').onclick=()=>{
                window.clicks++;document.querySelector('#tier').textContent='Max 5x';document.querySelector('#due').textContent='US$100.00';}</script>`, 'max');
        expect(await ensureClaudePlanSelection(page, 'claude_max_100')).toEqual({ amount: 100, currency: 'USD' });
        expect(await page.evaluate(() => window.clicks)).toBe(1);
    });
});

describe('Claude loading portal and button readiness regression', () => {
    async function blockedFixture({ monthly = false, skeleton = true } = {}) {
        return fixture(`<div><button type="button" id="monthly" aria-pressed="${monthly}"><p>Pro 按月计费</p><p>USD 20.00</p></button>
            <button type="button" id="annual" aria-pressed="${!monthly}"><p>Pro 按年计费</p><p>USD 200.00</p></button></div>
            <aside><p id="interval">Pro ${monthly ? '按月' : '按年'}计费</p><div>今日应付总额 <span id="due">US$${monthly ? 20 : 200}.00</span></div></aside>
            <div data-cds-portal style="position:fixed;inset:0;z-index:100;pointer-events:auto;background:white">
                <div class="${skeleton ? 'animate-pulse' : ''}" style="width:100%;height:100%"></div></div>
            <script>window.planClicks=0;document.querySelector('#monthly').onclick=()=>{
                window.planClicks++;document.querySelector('#monthly').setAttribute('aria-pressed','true');
                document.querySelector('#annual').setAttribute('aria-pressed','false');
                document.querySelector('#interval').textContent='Pro 按月计费';document.querySelector('#due').textContent='US$20.00';
            };</script>`);
    }
    it('waits for the portal to clear before one normal monthly button click', async () => {
        const page = await blockedFixture();
        const before = await readClaudeCheckoutSnapshot(page);
        expect(before).toMatchObject({ receivesPointer: false, loadingSkeleton: true });
        expect(before.target.path).toBeUndefined();
        await page.evaluate(() => setTimeout(() => document.querySelector('[data-cds-portal]').remove(), 200));
        expect(await ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 2000 })).toEqual({ amount: 20, currency: 'USD' });
        expect(await page.evaluate(() => window.planClicks)).toBe(1);
        expect(page.listenerCount('requestfailed')).toBe(0);
    });
    it('does not force-click through a persistent skeleton and reports Chinese loading failure', async () => {
        const page = await blockedFixture();
        await expect(ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 300 })).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_LOADING_TIMEOUT', message: expect.stringContaining('仍在加载') });
        expect(await page.evaluate(() => window.planClicks)).toBe(0);
        expect(page.listenerCount('requestfailed')).toBe(0);
    });
    it('waits for loading to finish even when stale monthly selection and amount already agree', async () => {
        const page = await blockedFixture({ monthly: true });
        await page.evaluate(() => setTimeout(() => document.querySelector('[data-cds-portal]').remove(), 200));
        await ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 2000 });
        expect(await page.locator('[data-cds-portal]').count()).toBe(0);
        expect(await page.evaluate(() => window.planClicks)).toBe(0);
    });
    it('does not call an arbitrary dialog a network or loading error', async () => {
        const page = await blockedFixture({ skeleton: false });
        await expect(ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 300 })).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_INTERACTION_TIMEOUT', message: expect.stringContaining('被遮挡') });
        expect(await page.evaluate(() => window.planClicks)).toBe(0);
    });
    it('handles buttons revealed late without leaking a raw locator timeout or clicking through the blocker', async () => {
        const page = await blockedFixture();
        await page.locator('#monthly, #annual').evaluateAll(buttons => buttons.forEach(button => button.style.visibility = 'hidden'));
        await page.evaluate(() => setTimeout(() => document.querySelectorAll('button').forEach(button => button.style.visibility = 'visible'), 200));
        await expect(ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 350 })).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_LOADING_TIMEOUT' });
        expect(await page.evaluate(() => window.planClicks)).toBe(0);
    });
    it('preserves a final-total loading timeout after the monthly button is already actionable', async () => {
        const page = await blockedFixture({ monthly: true });
        await page.locator('[data-cds-portal]').evaluate(el => el.style.pointerEvents = 'none');
        await page.locator('#due').evaluate(el => el.textContent = '');
        const started = performance.now();
        const error = await ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 2000, confirmationTimeoutMs: 250 }).catch(error => error);
        expect(performance.now() - started).toBeLessThan(1500);
        expect(error).toMatchObject({ code: 'CLAUDE_CHECKOUT_LOADING_TIMEOUT', message: expect.stringContaining('仍在加载') });
        expect(classifyClaudeCheckoutReadinessFailure(error.message, 'not_started')).toMatchObject({ shouldRetry: true, reachedPayment: false });
        expect(classifyClaudeCheckoutReadinessFailure(error.message, 'started')).toBeNull();
        expect(await page.evaluate(() => window.planClicks)).toBe(0);
    });
    it('gives a late actionable plan its own bounded time for the official total to update', async () => {
        const page = await blockedFixture();
        await page.evaluate(() => {
            setTimeout(() => document.querySelector('[data-cds-portal]').remove(), 350);
            document.querySelector('#monthly').onclick = () => {
                window.planClicks++;
                document.querySelector('#monthly').setAttribute('aria-pressed', 'true');
                document.querySelector('#annual').setAttribute('aria-pressed', 'false');
                document.querySelector('#interval').textContent = 'Pro 按月计费';
                document.querySelector('#due').textContent = '';
                setTimeout(() => document.querySelector('#due').textContent = 'US$20.00', 350);
            };
        });
        expect(await ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 600, confirmationTimeoutMs: 800 })).toEqual({ amount: 20, currency: 'USD' });
        expect(await page.evaluate(() => window.planClicks)).toBe(1);
    });
    it('does not replace a visible subtotal with a missing final total even without a skeleton marker', async () => {
        const page = await fixture(pro({ amount: '' }) + '<div>Subtotal USD 20</div>');
        const error = await ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 250 }).catch(error => error);
        expect(error).toMatchObject({ code: 'CLAUDE_CHECKOUT_LOADING_TIMEOUT' });
        expect(classifyClaudeCheckoutReadinessFailure(error.message, 'not_started')).toMatchObject({ shouldRetry: true });
        await expect(assertClaudeCheckoutReady(page, 'claude_pro')).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_MISMATCH' });
        expect(await page.evaluate(() => window.planClicks)).toBe(0);
        expect(await page.evaluate(() => window.payClicks)).toBe(0);
    });
    it('keeps conflicting visible totals blocked instead of calling them missing', async () => {
        const page = await fixture(pro() + '<div>Due today USD 200</div>');
        const error = await ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 250 }).catch(error => error);
        expect(error).toMatchObject({ code: 'CLAUDE_CHECKOUT_MISMATCH' });
        expect(classifyClaudeCheckoutReadinessFailure(error.message, 'not_started')).toBeNull();
        expect(await page.evaluate(() => window.payClicks)).toBe(0);
    });
    it.each([{ currency: 'EUR' }, { amount: 25 }])('does not retry an explicitly wrong final total: %j', async config => {
        const page = await fixture(pro(config));
        const error = await ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 250 }).catch(error => error);
        expect(error).toMatchObject({ code: 'CLAUDE_CHECKOUT_MISMATCH' });
        expect(classifyClaudeCheckoutReadinessFailure(error.message, 'not_started')).toBeNull();
        expect(await page.evaluate(() => window.planClicks)).toBe(0);
        expect(await page.evaluate(() => window.payClicks)).toBe(0);
    });
});

describe('Claude single plan controller', () => {
    it('confirms an already selected monthly plan without clicking or a six-second sleep', async () => {
        const page = await fixture();
        const started = performance.now();
        expect(await ensureClaudePlanSelection(page, 'claude_pro')).toEqual({ amount: 20, currency: 'USD' });
        expect(performance.now() - started).toBeLessThan(1500);
        expect(await page.evaluate(() => window.planClicks)).toBe(0);
    });
    it('switches annual to monthly once and waits for the actual total', async () => {
        const page = await fixture(pro({ annual: true }));
        expect(await ensureClaudePlanSelection(page, 'claude_pro')).toEqual({ amount: 20, currency: 'USD' });
        expect(await page.evaluate(() => window.planClicks)).toBe(1);
    });
    it('switches monthly to annual once and checks the annual total', async () => {
        const page = await fixture();
        expect(await ensureClaudePlanSelection(page, 'claude_pro_annual')).toEqual({ amount: 200, currency: 'USD' });
        expect(await page.evaluate(() => window.planClicks)).toBe(1);
    });
    it('waits for controls rendered later instead of exhausting sequential candidates', async () => {
        const page = await fixture('<div>Loading</div>');
        await page.evaluate(html => setTimeout(() => document.body.innerHTML = html, 250), pro());
        expect(await ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 2000 })).toEqual({ amount: 20, currency: 'USD' });
    });
    it('keeps the selected plan while its summary is still loading', async () => {
        const page = await fixture(pro({ amount: '' }));
        await page.evaluate(() => setTimeout(() => document.querySelector('#due').textContent = 'USD 20', 200));
        expect(await ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 2000 })).toEqual({ amount: 20, currency: 'USD' });
        expect(await page.evaluate(() => window.planClicks)).toBe(0);
    });
    it('waits for the official retry to finish instead of treating the old loading error as terminal', async () => {
        const page = await fixture('<p>Failed to load payment form</p><button>Retry</button>');
        await page.locator('button').evaluate((button, html) => button.onclick = () => setTimeout(() => document.body.innerHTML = html, 150), pro());
        expect(await ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 1500 })).toEqual({ amount: 20, currency: 'USD' });
    });
    it('reuses the same controller when opening checkout and later checking it', async () => {
        const page = await fixture(pro({ annual: true }));
        expect(await openClaudeCheckout(page, { planType: 'claude_pro' })).toMatchObject({ success: true, isCustomCheckout: true });
        await ensureClaudePlanSelection(page, 'claude_pro');
        expect(await page.evaluate(() => window.planClicks)).toBe(1);
    });
    it('supports custom role radios with one ordinary click', async () => {
        const page = await fixture(`<button role="radio" aria-checked="false" id="monthly">Pro 按月计费</button>
            <button role="radio" aria-checked="true" id="annual">Pro 按年计费</button><div>应付金额 <span id="due">USD 200</span></div>
            <script>window.clicks=0;document.querySelector('#monthly').onclick=()=>{window.clicks++;document.querySelector('#monthly').setAttribute('aria-checked','true');document.querySelector('#annual').setAttribute('aria-checked','false');document.querySelector('#due').textContent='USD 20';}</script>`);
        await ensureClaudePlanSelection(page, 'claude_pro');
        expect(await page.evaluate(() => window.clicks)).toBe(1);
    });
    it('can select a hidden native radio through its visible label', async () => {
        const page = await fixture(pro({ annual: true }).replaceAll('type="radio"', 'style="display:none" type="radio"'));
        await ensureClaudePlanSelection(page, 'claude_pro');
        expect(await page.evaluate(() => window.planClicks)).toBe(1);
    });
    it.each([['claude_max_5x', '5x', 100], ['claude_max_20x', '20x', 200]])('validates %s without treating Max as Pro', async (plan, tier, amount) => {
        const page = await fixture(`<label><input type="radio" name="tier" ${tier === '5x' ? 'checked' : ''}>Max 5x USD 100</label>
            <label><input type="radio" name="tier" ${tier === '20x' ? 'checked' : ''}>Max 20x USD 200</label><div>Total USD ${amount}</div>`, 'max');
        expect(await ensureClaudePlanSelection(page, plan)).toEqual({ amount, currency: 'USD' });
    });
    it('uses the Max label rather than a generic monthly radio value', async () => {
        const page = await fixture('<label><input type="radio" value="monthly" checked>Max 5x</label><div>Total USD 100</div>', 'max');
        expect(await ensureClaudePlanSelection(page, 'claude_max_100')).toEqual({ amount: 100, currency: 'USD' });
    });
});

describe('fresh Claude payment guard', () => {
    it.each(['Due today', 'Total due today', 'Total', '应付金额', '今日应付'])('reads the visible %s summary', async label => {
        const page = await fixture(pro({ label }));
        expect(await assertClaudeCheckoutReady(page, 'claude_pro')).toEqual({ amount: 20, currency: 'USD' });
    });
    it.each([{ amount: '' }, { currency: 'EUR' }, { amount: 200 }, { amount: 25 }])('blocks missing or unexpected live total: %j', async config => {
        const page = await fixture(pro(config));
        await expect(assertClaudeCheckoutReady(page, 'claude_pro')).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_MISMATCH' });
    });
    it('ignores hidden stale totals', async () => {
        const page = await fixture(pro() + '<div hidden>Due today USD 200</div>');
        expect(await assertClaudeCheckoutReady(page, 'claude_pro')).toEqual({ amount: 20, currency: 'USD' });
    });
    it('blocks conflicting visible totals', async () => {
        const page = await fixture(pro() + '<div>Due today USD 200</div>');
        await expect(assertClaudeCheckoutReady(page, 'claude_pro')).rejects.toThrow('资金安全拦截');
    });
    it('blocks a wrong interval even when its amount happens to match', async () => {
        const page = await fixture(pro({ annual: true, amount: 20 }));
        await expect(assertClaudeCheckoutReady(page, 'claude_pro')).rejects.toThrow('资金安全拦截');
    });
    it('rechecks a changed total immediately before the actual submit action', async () => {
        const page = await fixture();
        await ensureClaudePlanSelection(page, 'claude_pro');
        await page.evaluate(() => document.querySelector('#due').textContent = 'USD 200');
        await expect(clickCheckoutSubmitButton(page, '', () => assertClaudeCheckoutReady(page, 'claude_pro'))).rejects.toThrow('资金安全拦截');
        expect(await page.evaluate(() => window.payClicks)).toBe(0);
    });
    it('waits safely when a selected plan still shows the wrong total', async () => {
        const page = await fixture(pro({ amount: 200 }));
        await expect(ensureClaudePlanSelection(page, 'claude_pro', { timeoutMs: 300 })).rejects.toThrow('资金安全拦截');
        expect(await page.evaluate(() => window.planClicks)).toBe(0);
    });
    it('rejects the wrong product route and unsupported plans', async () => {
        const page = await fixture();
        await expect(ensureClaudePlanSelection(page, 'claude_max_100')).rejects.toMatchObject({ code: 'CLAUDE_CHECKOUT_ROUTE_MISMATCH' });
        expect(() => getClaudePlanRule('claude_unknown')).toThrow('不支持');
    });
    it('reports a closed page rather than continuing with earlier evidence', async () => {
        const page = await fixture(); await page.close();
        await expect(readClaudeCheckoutSnapshot(page)).rejects.toThrow();
    });
});
