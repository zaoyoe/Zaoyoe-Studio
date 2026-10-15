import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { observeGrokCommerce } from '../grok-commerce.js';
import { decodeRpc, hasRpcField } from '../grok-commerce-wire.js';
import { openGrokCheckout } from '../pricing-checkout-grok.js';
import { completeStripeCardPayment } from '../stripe-payment.js';
import { assertNativeBilling, fillNativeBilling } from '../grok-native-billing.js';
import { completeGrokCommercePayment, nativeCardFields } from '../grok-native-payment.js';
import { quote, methods, rpc, address, account, card } from './fixtures/grok-commerce.js';
import catalog from '../public/grok-plan-catalog.js';

let browser;
const contexts = [], observers = [];
beforeAll(async () => {
    browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
});
afterEach(async () => {
    vi.restoreAllMocks();
    for (const observer of observers.splice(0)) observer.dispose();
    await Promise.all(contexts.splice(0).map(context => context.close()));
});
afterAll(async () => { await browser?.close(); });

const stripeUrl = 'https://js.stripe.com/v3/elements-inner-accessory-target-fixture.html#componentName=payment&elementId=payment-fixture';
const stripeHtml = [
    '<button aria-expanded="false" onclick="this.setAttribute(\'aria-expanded\',\'true\');document.querySelector(\'#fields\').hidden=false">银行卡</button>',
    '<div id="fields" hidden><input autocomplete="cc-number" id="payment-numberInput" required>',
    '<input autocomplete="cc-exp" id="payment-expiryInput" required><input autocomplete="cc-csc" id="payment-cvcInput" required></div>'
].join('');

function html(q, options) {
    const english = options.locale === 'en';
    const currency = options.currencyPrefix ?? (english ? '$' : 'US$');
    const price = currency + q.plan.amount.toFixed(2), due = currency + q.first.toFixed(2);
    const period = q.plan.interval === 'year' ? (english ? 'year' : '年') : (english ? 'month' : '月');
    const groupName = options.periodGroupName ?? (english ? 'Billing interval' : '计费周期');
    const monthlyLabel = english ? 'Monthly' : '每月', annualLabel = options.annualLabel ?? (english ? 'Annual' : '年度');
    const checkoutLabel = english ? 'Checkout' : '结账';
    const subscriptionLabel = q.plan.interval === 'year' || options.summaryStyle === 'subscription';
    const baseLabel = options.baseLabel ?? (subscriptionLabel
        ? q.plan.interval === 'year' ? (english ? 'Yearly subscription' : '年度订阅') : (english ? 'Monthly subscription' : '月度订阅')
        : english ? 'Plan price' : '计划价格');
    const baseValue = options.baseValue ?? (subscriptionLabel ? price : price + '/' + period);
    return [
        '<style>[role=dialog]{width:650px}iframe{width:450px;height:150px}label{display:block}dt,dd{display:inline-block}dd{margin-right:20px}</style>',
        '<div role="radiogroup" aria-label="' + groupName + '"><span role="radio" tabindex="0" id="monthly" aria-checked="true">' + monthlyLabel + '</span>',
        '<span role="radio" tabindex="-1" id="annual" aria-checked="false">' + annualLabel + '</span><input type="radio" hidden aria-label="' + monthlyLabel + '"></div>',
        '<ul role="list"><li><div>' + q.plan.name + '</div><div id="cta"></div></li></ul>',
        '<div role="dialog" aria-label="' + checkoutLabel + '" hidden><aside class="x-commerce-summary"><h3>' + q.plan.name + '</h3><dl>',
        '<dt>' + baseLabel + '</dt><dd>' + baseValue + '</dd><dt>预计税费</dt><dd id="tax">输入地址以计算</dd>',
        '<dt>' + (english ? 'Due today' : '今日到期') + '</dt><dd id="due">' + (options.dueValue ?? (options.badSummary ? 'US$999.00' : due)) + '</dd></dl></aside>',
        options.migration ? '<p>取消现有订阅并统一账号</p>' : '',
        options.offerReview ? '<p role="alert">此优惠需要审核。请返回并重新选择一个计划。</p>' : '',
        '<h4>账单信息</h4><div><input name="country" type="hidden" value="GB"><button role="combobox" id="countryTrigger" data-slot="xds-select-trigger">英国</button></div>',
        '<input name="addressLine1" role="combobox" autocomplete="billing address-line1" required>',
        '<div id="dynamic"></div><input autocomplete="billing address-line2"><input autocomplete="billing name" required><input type="email" required>',
        '<iframe src="' + (options.stripeHost ? stripeUrl.replace('js.stripe.com', options.stripeHost) : stripeUrl) + '"></iframe>',
        options.termsStyle === 'native_only'
            ? '<label><input type="checkbox" id="terms" ' + (options.termsPrechecked ? 'checked' : '') + '><a href="https://x.ai/legal/bundled-subscription-terms?us=unified">组合订阅条款</a>，订阅将自动续费。</label>'
            : '<label><span role="checkbox" aria-checked="' + (options.termsPrechecked ? 'true' : 'false') + '" tabindex="0" id="terms">同意</span>' +
              (options.termsStyle === 'base_ui_dual'
                  ? '<input type="checkbox" style="width:1px;height:1px;clip-path:inset(50%);position:absolute;">'
                  : '<input type="checkbox" hidden>') +
              '<a href="https://x.ai/legal/bundled-subscription-terms?us=unified">组合订阅条款</a>，订阅将自动续费。</label>',
        '<button type="button" id="pay" disabled>订阅并付款</button><div id="result"></div></div>',
        '<script>',
        'const q=' + JSON.stringify(q) + ',methods=' + JSON.stringify(methods) + ';',
        'const fixtureAccount=' + JSON.stringify(account) + ';',
        'const english=' + JSON.stringify(english) + ',periodStuck=' + JSON.stringify(Boolean(options.periodStuck)) + ';',
        'window.planClicks=0;window.payClicks=0;window.periodClicks=0;window.escapeDismissals=0;',
        'const $=selector=>document.querySelector(selector);',
        'document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!$("[role=dialog]").hidden){',
        'event.preventDefault();window.escapeDismissals++;$("[role=dialog]").hidden=true;history.replaceState({},"","/");}},true);',
        'function send(name,body){return fetch("/"+methods[name],{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});}',
        'let committedAddress=null,addressEdited=false,taxStatus="idle",addressRefused=false,taxVersion=0;',
        'const suppressTaxRecommit=' + JSON.stringify(Boolean(options.suppressTaxRecommit)) + ';',
        'function commitAddress(){if(!$("[name=state]")||$("[name=state]").value!=="OR")return;',
        'const billingAddress={regionCode:$("[name=country]").value,administrativeAreaCode:$("[name=state]").value,',
        'postalCode:$("[autocomplete=\\"billing postal-code\\"]").value.trim(),',
        'locality:$("[autocomplete=\\"billing address-level2\\"]").value.trim(),addressLines:[$("[name=addressLine1]").value.trim()]};',
        'if(JSON.stringify(billingAddress)===JSON.stringify(committedAddress)&&(taxStatus!=="error"||addressRefused||suppressTaxRecommit))return;',
        'committedAddress=billingAddress;taxStatus="pending";const version=++taxVersion;$("#tax").textContent="";',
        'send("EstimateTax",{cartId:q.cart.data.cartId,billingAddress}).then(response=>{if(version!==taxVersion)return;',
        'const status=response.headers.get("x-fixture-tax-state");taxStatus=status==="ready"?"ready":"error";',
        'addressRefused=status==="refused";$("#tax").textContent=status==="ready"?"US$0.00":"—";});}',
        'send("CreateCheckoutSession",q.session.request);',
        'function mountCta(){const annual=$("#annual").getAttribute("aria-checked")==="true";',
        'const name=english?"Subscribe to "+q.plan.name+" "+(annual?"Yearly":"Monthly"):"订阅 "+q.plan.name+" "+(annual?"每年":"每月");',
        '$("#cta").innerHTML="<button data-sku-id=\\""+q.skuId+"\\" aria-label=\\""+name+(english?", Most popular":", 最受欢迎")+"\\">领取优惠</button>";',
        '$("#cta button").onclick=()=>{window.planClicks++;$("[role=dialog]").hidden=false;send("GetCartForSession",q.cart.request)};}',
        'mountCta();',
        'for(const id of ["monthly","annual"]){$("#"+id).onclick=()=>{window.periodClicks++;if(periodStuck)return;$("#cta").innerHTML="";setTimeout(()=>{',
        '$("#monthly").setAttribute("aria-checked",String(id==="monthly"));$("#annual").setAttribute("aria-checked",String(id==="annual"));mountCta();},70);};}',
        'function selector(name,label,value){const list=document.createElement("div");list.setAttribute("role","listbox");',
        'list.innerHTML="<button role=\\"option\\">"+label+"</button>";document.body.append(list);',
        'list.firstChild.onclick=()=>{setTimeout(()=>{$("[name="+name+"]").value=value;$("#"+name+"Trigger").textContent=label;',
        'if(name==="state")commitAddress();},40);list.remove();};}',
        '$("#countryTrigger").onclick=()=>setTimeout(()=>selector("country","美国","US"),40);',
        '$("[name=addressLine1]").onblur=()=>{if(!$("#dynamic").children.length)setTimeout(()=>{$("#dynamic").innerHTML=',
        JSON.stringify('<input autocomplete="billing address-level2" required><input autocomplete="billing postal-code" required><div><input name="state" type="hidden" value="WA"><button role="combobox" id="stateTrigger" data-slot="xds-select-trigger">Washington</button></div>') + ';',
        '$("#stateTrigger").onclick=()=>setTimeout(()=>selector("state","Oregon","OR"),40);',
        'const city=$("[autocomplete=\\"billing address-level2\\"]");city.oninput=()=>{addressEdited=true;};',
        'city.onblur=()=>{if(addressEdited){addressEdited=false;commitAddress();}};},40);};',
        '$("#terms").onclick=()=>{if($("#terms").tagName==="INPUT"){$("#terms").checked=true;}else{$("#terms").setAttribute("aria-checked","true");}$("#pay").disabled=false;};',
        'if(' + Boolean(options.termsPrechecked) + ')$("#pay").disabled=false;',
        options.outcome === 'client_decline'
            ? '$("#pay").onclick=()=>{window.payClicks++;setTimeout(()=>{$("#result").innerHTML=\'<div role="alert">Your payment method was declined.</div>\';},20);};'
            : '$("#pay").onclick=()=>{window.payClicks++;send("Acquire",{cartId:q.cart.data.cartId,idempotencyKey:"offline-idempotency",native:{paymentMethodId:"pm_offline_fixture"},billingAddress:q.address,billingEmail:fixtureAccount.email}).then(()=>{' +
              '$("#result").textContent="Payment successful. Your card was declined.";});};',
        '</script>'
    ].join('\n');
}

async function fixture(key = 'grok_bundle_premium_monthly', options = {}) {
    const q = quote(key, { promo: options.promo }), calls = [];
    if (options.teamSession) q.session.request.teamId = 'offline-team';
    if (options.missingInitialTax) delete q.cart.data.tax;
    if (options.effectiveAt) q.cart.data.effectiveAt = { seconds: String(Math.floor(Date.now()/1000)+3600), nanos: 0 };
    if (Object.hasOwn(options, 'cartQuantity')) q.cart.request.selections[0].quantity = options.cartQuantity;
    if (options.commerceCurrency) {
        for (const price of q.session.data.skuPricings) price.pricing.details.amount.currencyCode = options.commerceCurrency;
        for (const value of [q.cart.data.subtotal, q.cart.data.total, q.cart.data.tax]) if (value) value.currencyCode = options.commerceCurrency;
    }
    const context = await browser.newContext(); contexts.push(context);
    await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), method = url.pathname.slice(1);
        const name = Object.entries(methods).find(([,value]) => value === method)?.[0];
        if (name) {
            const input = decodeRpc(method, 'input', request.postDataBuffer(), request.headers());
            calls.push({ name, input });
            let output = name === 'CreateCheckoutSession' ? q.session.data : name === 'GetCartForSession' ? q.cart.data : q.tax.data;
            if (name === 'Acquire') {
                output = options.outcome === 'decline'
                    ? { purchaseId: 'offline-purchase', status: 'ACQUISITION_STATUS_FAILED', declineReason: 'DECLINE_REASON_GENERIC', error: { code: 'CARD_DECLINED' } }
                    : options.outcome === 'pending'
                        ? { purchaseId: 'offline-purchase', status: 'ACQUISITION_STATUS_PENDING' }
                        : { purchaseId: 'offline-purchase', status: 'ACQUISITION_STATUS_SUCCEEDED', subscriptionId: 'offline-subscription' };
            }
            const headers = {};
            if (name === 'EstimateTax') {
                const index = calls.filter(call => call.name === 'EstimateTax').length - 1;
                const error = options.taxErrors?.[index];
                if (error) output = { error };
                headers['x-fixture-tax-state'] = !error ? 'ready'
                    : ['ADDRESS_INVALID', 'BILLING_COUNTRY_MISMATCH'].includes(error.code) ? 'refused' : 'error';
                await new Promise(resolve => setTimeout(resolve, 70));
            }
            await route.fulfill({ contentType: 'application/grpc-web+proto', headers, body: rpc(name, 'output', output) }); return;
        }
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: url.pathname.includes('elements-inner') ? stripeHtml : html(q, options) });
    });
    const page = await context.newPage();
    const observer = observeGrokCommerce(page, key); observers.push(observer);
    await page.goto('https://grok.com/plans');
    return { page, observer, q, calls };
}
async function open(f) {
    return openGrokCheckout(f.page, { planType: f.q.plan.key, platformMode: 'grok_web', commerceObserver: f.observer,
        entryTimeoutMs: 1000, checkoutTimeoutMs: 800 });
}
async function pay(f, options = {}) {
    const { billingAddress = address, ...paymentOptions } = options;
    return completeStripeCardPayment(f.page, card, billingAddress, { platform: 'grok', planType: f.q.plan.key,
        grokAccount: account, grokCheckout: { native: true, commerceObserver: f.observer },
        checkoutTimeoutMs: 800, resultTimeoutMs: 350, ...paymentOptions });
}

async function addressOverlay(f, { delayMs = 20, duplicate = false, manualMissing = false, staysOpen = false, changesStreet = false,
    portal = false, manualLabel = 'Enter address manually' } = {}) {
    await f.page.locator('[name=addressLine1]').evaluate((input, config) => {
        input.setAttribute('aria-controls', 'address-suggestions');
        window.suggestionClicks = 0; window.manualEntryClicks = 0;
        let scheduled = false;
        input.addEventListener('input', () => {
            if (scheduled) return;
            scheduled = true;
            setTimeout(() => {
                const list = document.createElement('div');
                list.id = 'address-suggestions'; list.setAttribute('role', 'listbox');
                list.style.cssText = 'position:fixed;inset:30px 0 0;z-index:1000;background:white';
                list.innerHTML = '<button role="option" type="button">Unrelated suggested address in another state</button>';
                for (let i = 0; i < (config.manualMissing ? 0 : config.duplicate ? 2 : 1); i++) {
                    const option = document.createElement('button'); option.type = 'button';
                    option.setAttribute('role', 'option'); option.textContent = config.manualLabel; list.append(option);
                }
                (config.portal ? document.body : document.querySelector('[role=dialog]')).append(list);
                for (const option of list.children) option.onclick = () => {
                    if (option.textContent.startsWith('Unrelated')) { window.suggestionClicks++; return; }
                    window.manualEntryClicks++;
                    if (config.changesStreet) input.value = 'unexpected address';
                    if (!config.staysOpen) list.remove();
                };
            }, config.delayMs);
        });
    }, { delayMs, duplicate, manualMissing, staysOpen, changesStreet, portal, manualLabel });
}

describe('isolated native Grok Commerce checkout', () => {
    it.each([1, 2])('recovers %s explicit temporary tax failure(s), commits the same full address and pays once', async failures => {
        const f = await fixture('grok_bundle_plus_monthly', {
            taxErrors: Array.from({ length: failures }, () => ({ code: 'TRANSPORT_FAILURE', retriable: true, message: 'private-sentinel' }))
        }); await open(f);
        const started = vi.fn();
        expect(await pay(f, { checkoutTimeoutMs: 5000, onPaymentAttemptStarted: started }))
            .toMatchObject({ success: true, submitted: true, dueAmount: 8 });
        const estimates = f.calls.filter(call => call.name === 'EstimateTax');
        expect(estimates).toHaveLength(failures + 1);
        for (const call of estimates) expect(call.input.billingAddress).toMatchObject(f.q.address);
        expect(started).toHaveBeenCalledOnce();
        expect(f.calls.filter(call => call.name === 'Acquire')).toHaveLength(1);
        expect(await f.page.evaluate(() => [window.planClicks, window.payClicks, window.escapeDismissals])).toEqual([1,1,0]);
        expect(await f.page.locator('[autocomplete="billing address-level2"]').inputValue()).toBe(address.city);
    });
    it('stops after two tax retries without accepting terms or starting payment', async () => {
        const f = await fixture('grok_bundle_plus_monthly', {
            taxErrors: Array.from({ length: 4 }, () => ({ code: 'TRANSPORT_FAILURE', retriable: true }))
        }); await open(f);
        const started = vi.fn();
        expect(await pay(f, { checkoutTimeoutMs: 5000, onPaymentAttemptStarted: started }))
            .toMatchObject({ success: false, submitted: false, canRetryCard: false, code: 'GROK_TAX_RETRY_EXHAUSTED' });
        expect(f.calls.filter(call => call.name === 'EstimateTax')).toHaveLength(3);
        expect(f.calls.filter(call => call.name === 'Acquire')).toHaveLength(0);
        expect(started).not.toHaveBeenCalled();
        expect(await f.page.locator('#terms').getAttribute('aria-checked')).toBe('false');
    });
    it.each([
        [{ code: 'ADDRESS_INVALID', retriable: true, message: 'ADDRESS_INVALID: {"field":"postal_code","private":"private-sentinel"}' }, 'GROK_TAX_ADDRESS_REFUSED'],
        [{ code: 'BILLING_COUNTRY_MISMATCH', retriable: true }, 'GROK_TAX_ADDRESS_REFUSED'],
        [{ code: 'TRANSPORT_FAILURE', retriable: false }, 'GROK_TAX_FAILED'],
        [{ code: 'PRIVATE_CODE_SENTINEL', retriable: true, message: 'private-sentinel' }, 'GROK_TAX_FAILED']
    ])('immediately stops an unrecoverable official tax error: %j', async (error, code) => {
        const f = await fixture('grok_bundle_plus_monthly', { taxErrors: [error] }); await open(f);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const started = vi.fn();
        const before = Date.now();
        const result = await pay(f, { checkoutTimeoutMs: 15000, onPaymentAttemptStarted: started });
        expect(result).toMatchObject({ success: false, submitted: false, canRetryCard: false, code, failureStage: 'tax' });
        expect(Date.now() - before).toBeLessThan(4000);
        expect(f.calls.filter(call => call.name === 'EstimateTax')).toHaveLength(1);
        expect(f.calls.filter(call => call.name === 'Acquire')).toHaveLength(0);
        expect(started).not.toHaveBeenCalled();
        expect(await f.page.locator('#terms').getAttribute('aria-checked')).toBe('false');
        expect(JSON.stringify(result) + warn.mock.calls.flat().join('\n')).not.toMatch(/private-sentinel|PRIVATE_CODE_SENTINEL|offline-|42424242|97000/);
        if (error.code === 'ADDRESS_INVALID') expect(warn.mock.calls.flat().join('\n')).toContain('"refusedField":"postalCode"');
    });
    it('does not reuse the old failure when recommitting does not issue a new estimate', async () => {
        const f = await fixture('grok_bundle_plus_monthly', { suppressTaxRecommit: true,
            taxErrors: [{ code: 'TRANSPORT_FAILURE', retriable: true }] }); await open(f);
        expect(await pay(f, { checkoutTimeoutMs: 5000 })).toMatchObject({ success: false, submitted: false,
            code: 'GROK_TAX_RETRY_UNCONFIRMED' });
        expect(f.calls.filter(call => call.name === 'EstimateTax')).toHaveLength(1);
        expect(f.calls.some(call => call.name === 'Acquire')).toBe(false);
    });
    it('observes a newer successful estimate during backoff instead of retrying the old error', async () => {
        const f = await fixture('grok_bundle_plus_monthly', { taxErrors: [{ code: 'TRANSPORT_FAILURE', retriable: true }] });
        await open(f);
        let recovering = false;
        const original = f.observer.taxRecoveryScope.bind(f.observer);
        vi.spyOn(f.observer, 'taxRecoveryScope').mockImplementation(() => {
            const scope = original();
            return { ...scope, diagnostics() {
                const result = scope.diagnostics();
                if (result.error?.canRetry) recovering = true;
                return result;
            } };
        });
        const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
        const pending = pay(f, { checkoutTimeoutMs: 4000 });
        await vi.waitFor(() => expect(recovering).toBe(true), { timeout: 3500 });
        await f.page.evaluate(() => send('EstimateTax', { cartId: q.cart.data.cartId, billingAddress: q.address })
            .then(() => document.querySelector('#tax').textContent = 'US$0.00'));
        expect(await pending).toMatchObject({ success: true, submitted: true });
        expect(f.calls.filter(call => call.name === 'EstimateTax')).toHaveLength(2);
        expect(f.calls.filter(call => call.name === 'Acquire')).toHaveLength(1);
        expect(logs.mock.calls.flat().join('\n')).not.toContain('重新确认同一账单地址');
    });
    it.each(['cart', 'session', 'address'])('stops when the %s changes during tax recovery backoff', async change => {
        const f = await fixture('grok_bundle_plus_monthly', { taxErrors: [{ code: 'TRANSPORT_FAILURE', retriable: true }] });
        await open(f);
        let recovering = false;
        const original = f.observer.taxRecoveryScope.bind(f.observer);
        vi.spyOn(f.observer, 'taxRecoveryScope').mockImplementation(() => {
            const scope = original();
            return { ...scope, diagnostics() {
                const result = scope.diagnostics();
                if (result.error?.canRetry) recovering = true;
                return result;
            } };
        });
        const started = vi.fn();
        const pending = pay(f, { checkoutTimeoutMs: 4000, onPaymentAttemptStarted: started });
        await vi.waitFor(() => expect(recovering).toBe(true));
        if (change === 'cart') await f.page.evaluate(() => send('GetCartForSession', q.cart.request));
        if (change === 'session') await f.page.evaluate(() => send('CreateCheckoutSession', q.session.request));
        if (change === 'address') f.observer.setBillingAddress({ ...address, city: 'changed' });
        expect(await pending).toMatchObject({ success: false, submitted: false, code: 'GROK_TAX_CONTEXT_CHANGED' });
        expect(started).not.toHaveBeenCalled();
        expect(f.calls.filter(call => call.name === 'EstimateTax')).toHaveLength(1);
        expect(f.calls.some(call => call.name === 'Acquire')).toBe(false);
        expect(await f.page.locator('#terms').getAttribute('aria-checked')).toBe('false');
    });
    it('still blocks payment when a recovered tax quote exceeds the authorized price', async () => {
        const f = await fixture('grok_bundle_plus_monthly', { taxErrors: [{ code: 'TRANSPORT_FAILURE', retriable: true }] });
        f.q.tax.data.tax = { currencyCode: 'USD', unitMicros: '1000000' };
        f.q.tax.data.total = { currencyCode: 'USD', unitMicros: '9000000' };
        f.q.tax.data.taxLines = [{ amount: f.q.tax.data.tax }];
        await open(f);
        expect(await pay(f, { checkoutTimeoutMs: 2500 })).toMatchObject({ success: false, submitted: false,
            code: 'GROK_COMMERCE_UNCONFIRMED' });
        expect(f.calls.filter(call => call.name === 'EstimateTax')).toHaveLength(2);
        expect(f.calls.some(call => call.name === 'Acquire')).toBe(false);
    });
    it('leaves the official typeahead through a real outside focus target before a late suggestion response', async () => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        await f.page.locator('[name=addressLine1]').evaluate(input => {
            window.outsideFocusCommits = 0;
            const original = input.onblur;
            input.onblur = event => {
                // Base UI controls popup focus separately from the form's blur.
                // Simulate a delayed callback surviving programmatic blur.
                if (!event.relatedTarget) return;
                window.outsideFocusCommits++;
                original.call(input, event);
            };
            document.querySelector('h4').setAttribute('tabindex', '-1');
        });
        expect(await pay(f)).toMatchObject({ success: true, submitted: true, dueAmount: 8 });
        expect(await f.page.evaluate(() => [window.outsideFocusCommits, window.escapeDismissals, window.payClicks])).toEqual([1, 0, 1]);
        expect(f.calls.find(call => call.name === 'EstimateTax').input.billingAddress).toMatchObject(f.q.address);
    });
    it.each(['—', 'US$1.00', 'CAD$0.00'])('requires visible official tax readiness as well as the RPC when the summary shows %s', async taxText => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        await fillNativeBilling(f.page, address, card.holder, account.email);
        f.observer.setBillingAddress(address);
        await f.page.waitForFunction(() => document.querySelector('#tax').textContent === 'US$0.00');
        await vi.waitFor(() => expect(f.observer.contract({ final: true })).toMatchObject({ amount: 8, tax: 0 }));
        await f.page.locator('#tax').evaluate((el, value) => el.textContent = value, taxText);
        expect(await pay(f)).toMatchObject({ success: false, submitted: false, code: 'GROK_PRICE_UNCONFIRMED',
            failureStage: taxText.startsWith('CAD') ? 'checkout' : 'tax' });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(0);
        expect(f.calls.some(call => call.name === 'Acquire')).toBe(false);
    });
    it('logs the exact tax state for a mismatched official address without leaking values or submitting', async () => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        await fillNativeBilling(f.page, address, card.holder, account.email);
        f.observer.setBillingAddress(address);
        await f.page.evaluate(() => send('EstimateTax', { cartId: q.cart.data.cartId,
            billingAddress: { ...q.address, postalCode: '00000' } }));
        await vi.waitFor(() => expect(f.observer.taxDiagnostics()).toMatchObject({ state: 'address_mismatch' }));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await pay(f)).toMatchObject({ success: false, submitted: false, code: 'GROK_TAX_CONTEXT_CHANGED', failureStage: 'tax' });
        const log = warn.mock.calls.flat().join('\n');
        expect(log).toContain('"state":"address_mismatch"');
        expect(log).toContain('"mismatchedFields":["postalCode"]');
        expect(log).not.toMatch(/00000|42424242|offline-|Fixture/);
        expect(await f.page.evaluate(() => window.payClicks)).toBe(0);
        expect(f.calls.some(call => call.name === 'Acquire')).toBe(false);
    });
    it('handles a late address suggestion overlay covering the state selector without choosing a guessed address', async () => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        await addressOverlay(f);
        expect(await pay(f)).toMatchObject({ success: true, submitted: true, dueAmount: 8 });
        expect(await f.page.evaluate(() => [window.suggestionClicks, window.manualEntryClicks, window.escapeDismissals, window.payClicks])).toEqual([0,1,0,1]);
        expect(await f.page.locator('[name=state]').inputValue()).toBe('OR');
        expect(f.calls.find(call => call.name === 'EstimateTax').input.billingAddress).toMatchObject(f.q.address);
    });
    it('recovers a suggestion popup that appears while waiting for the state trigger to become actionable', async () => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        await addressOverlay(f, { delayMs: 600 });
        await f.page.evaluate(() => {
            new MutationObserver((_, observer) => {
                const trigger = document.querySelector('#stateTrigger');
                if (!trigger) return;
                trigger.disabled = true;
                setTimeout(() => trigger.disabled = false, 1200);
                observer.disconnect();
            }).observe(document.querySelector('#dynamic'), { childList: true });
        });
        expect(await pay(f)).toMatchObject({ success: true, submitted: true });
        expect(await f.page.evaluate(() => [window.manualEntryClicks, window.suggestionClicks, window.escapeDismissals, window.payClicks])).toEqual([1,0,0,1]);
        expect(f.calls.filter(call => call.name === 'Acquire')).toHaveLength(1);
    });
    it.each(['Enter address manually', '手动输入地址'])('handles the associated portal action %s', async manualLabel => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        await addressOverlay(f, { portal: true, manualLabel });
        expect(await pay(f)).toMatchObject({ success: true, submitted: true });
        expect(await f.page.evaluate(() => [window.manualEntryClicks, window.suggestionClicks, window.escapeDismissals, window.payClicks])).toEqual([1,0,0,1]);
    });
    it.each([
        ['missing manual entry', { manualMissing: true }, 0],
        ['ambiguous manual entry', { duplicate: true }, 0],
        ['popup that stays open', { staysOpen: true }, 1],
        ['unexpected street change', { changesStreet: true }, 1]
    ])('stops %s without selecting a suggested address or submitting', async (_reason, overlay, manualClicks) => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        await addressOverlay(f, overlay);
        expect(await pay(f)).toMatchObject({ success: false, submitted: false, canRetryCard: false, code: 'GROK_BILLING_UNCONFIRMED' });
        expect(await f.page.evaluate(() => [window.manualEntryClicks, window.suggestionClicks, window.escapeDismissals, window.payClicks])).toEqual([manualClicks,0,0,0]);
        expect(f.calls.some(call => call.name === 'Acquire' || call.name === 'EstimateTax')).toBe(false);
    });
    it('reproduces Escape dismissing the checkout and returning to the home route without paying', async () => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        const street = f.page.locator('[name=addressLine1]');
        await street.fill(address.line1); await street.press('Escape');
        expect(new URL(f.page.url()).pathname).toBe('/');
        expect(await f.page.getByRole('dialog', { name: '结账' }).isVisible()).toBe(false);
        expect(await f.page.evaluate(() => [window.escapeDismissals, window.payClicks])).toEqual([1,0]);
        expect(f.calls.some(call => call.name === 'Acquire')).toBe(false);
    });
    it('fills the manual address in an Escape-enabled checkout without dismissing it', async () => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        f.page.setDefaultTimeout(800);
        expect(await pay(f)).toMatchObject({ success: true, submitted: true, dueAmount: 8 });
        expect(new URL(f.page.url()).pathname).toBe('/plans');
        expect(await f.page.evaluate(() => [window.escapeDismissals, window.payClicks])).toEqual([0,1]);
        expect(f.calls.find(call => call.name === 'EstimateTax').input.billingAddress).toMatchObject(f.q.address);
    });
    it('commits the manual address even when a typeahead popup has a focusable item after the input', async () => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        await f.page.locator('[name=addressLine1]').evaluate(input => {
            const suggestions = document.createElement('div');
            suggestions.setAttribute('role', 'listbox');
            suggestions.innerHTML = '<button type="button" role="option">Enter address manually</button>';
            input.after(suggestions);
            window.suggestionClicks = 0;
            suggestions.firstChild.onclick = () => window.suggestionClicks++;
            const commitOnBlur = input.onblur;
            input.onblur = event => {
                // The official typeahead skips commit while focus stays inside
                // the suggestions popup. Native blur leaves it without guessing.
                if (event.relatedTarget && suggestions.contains(event.relatedTarget)) return;
                suggestions.remove(); commitOnBlur.call(input, event);
            };
        });
        expect(await pay(f)).toMatchObject({ success: true, submitted: true, dueAmount: 8 });
        expect(await f.page.evaluate(() => [window.suggestionClicks, window.escapeDismissals, window.payClicks])).toEqual([0,0,1]);
        expect(f.calls.find(call => call.name === 'EstimateTax').input.billingAddress).toMatchObject(f.q.address);
    });
    it('stops promptly and identifies the billing step when the checkout closes on street blur', async () => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        await f.page.locator('[name=addressLine1]').evaluate(input => input.addEventListener('blur', () => {
            document.querySelector('[role=dialog]').hidden = true;
            history.replaceState({}, '', '/');
        }, { once: true }));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const started = performance.now();
        expect(await pay(f)).toMatchObject({ success: false, submitted: false, canRetryCard: false,
            code: 'GROK_CHECKOUT_UNTRUSTED', failureStage: 'billing.line1' });
        expect(performance.now() - started).toBeLessThan(5000);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('step=billing.line1, code=GROK_CHECKOUT_UNTRUSTED, reason=guard, page=home, submitted=false'));
        expect(f.calls.some(call => call.name === 'EstimateTax' || call.name === 'Acquire')).toBe(false);
        expect(await f.page.evaluate(() => [window.planClicks, window.payClicks])).toEqual([1,0]);
    });
    it('bounds a disabled street operation and reports it without a default 30-second wait', async () => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        await f.page.locator('[name=addressLine1]').evaluate(input => input.disabled = true);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const started = performance.now();
        expect(await pay(f)).toMatchObject({ success: false, submitted: false, code: 'GROK_BILLING_UNCONFIRMED',
            failureStage: 'billing.line1', error: '账单 line1 操作超时，尚未提交支付 [GROK_BILLING_UNCONFIRMED]' });
        expect(performance.now() - started).toBeLessThan(6000);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('step=billing.line1, code=GROK_BILLING_UNCONFIRMED, reason=timeout'));
        expect(f.calls.some(call => call.name === 'EstimateTax' || call.name === 'Acquire')).toBe(false);
        expect(await f.page.evaluate(() => window.payClicks)).toBe(0);
    });
    it('keeps unexpected driver error details out of diagnostics and returned messages', async () => {
        const f = await fixture(); await open(f);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const privateDetail = 'offline-private-call-log-sentinel';
        const result = await completeGrokCommercePayment(f.page, card, address, {
            planType: f.q.plan.key, grokAccount: account, grokCheckout: { commerceObserver: f.observer }
        }, { normalizeCardNumber: () => { throw new Error(privateDetail); }, normalizeCardExpiry: () => '12/30' });
        expect(result).toMatchObject({ success: false, submitted: false, code: 'GROK_FORM_UNCONFIRMED', failureStage: 'card' });
        expect(result.error).toContain('[GROK_FORM_UNCONFIRMED]');
        expect(result.error).not.toContain(privateDetail);
        expect(warn.mock.calls.flat().join('\n')).not.toContain(privateDetail);
        expect(f.calls.some(call => call.name === 'Acquire')).toBe(false);
    });
    it('retains unknown-result protection if the checkout leaves plans after submission bookkeeping', async () => {
        const f = await fixture(); await open(f);
        expect(await pay(f, { onPaymentAttemptStarted: () => f.page.evaluate(() => history.replaceState({}, '', '/')) }))
            .toMatchObject({ success: false, submitted: true, canRetryCard: false,
                code: 'PAYMENT_RESULT_UNKNOWN', failureStage: 'pre_submit' });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(0);
        expect(f.calls.some(call => call.name === 'Acquire')).toBe(false);
    });
    it('normalizes the address-pool Oregon label for the form and correlated official tax request', async () => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        expect(await pay(f, { billingAddress: { ...address, country: ' us ', state: ' Oregon ' } }))
            .toMatchObject({ success: true, submitted: true, dueAmount: 8 });
        expect(await f.page.locator('[name=state]').inputValue()).toBe('OR');
        expect(f.calls.find(call => call.name === 'EstimateTax').input.billingAddress).toMatchObject(f.q.address);
        expect(await f.page.evaluate(() => window.payClicks)).toBe(1);
    });
    it.each([
        null, { ...address, state: 'Delaware', city: 'Dover', postal_code: '19901' },
        { ...address, state: 'WA' }, { ...address, country: 'CA' },
        { ...address, line1: '' }, { ...address, city: ' ' }, { ...address, postal_code: '' },
        { ...address, postal_code: 'not-a-zip' }
    ])('rejects unsupported billing %j before exposing card data or requesting tax/payment', async billingAddress => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        expect(await pay(f, { billingAddress })).toMatchObject({ success: false, submitted: false,
            canRetryCard: false, code: 'GROK_BILLING_UNCONFIRMED' });
        const frame = f.page.frames().find(frame => frame.url().startsWith('https://js.stripe.com/'));
        for (const field of ['cc-number', 'cc-exp', 'cc-csc']) expect(await frame.locator(`[autocomplete="${field}"]`).inputValue()).toBe('');
        expect(await frame.getByRole('button').getAttribute('aria-expanded')).toBe('false');
        expect(f.calls.some(call => call.name === 'EstimateTax' || call.name === 'Acquire')).toBe(false);
        expect(await f.page.evaluate(() => window.payClicks)).toBe(0);
    });
    it.each(Object.keys(catalog.plans))('selects and pays %s exactly once', async key => {
        const f = await fixture(key, { promo: key === 'grok_bundle_premium_monthly', missingInitialTax: true });
        expect(await open(f)).toMatchObject({ native: true, plan: key });
        const result = await pay(f);
        expect(result, JSON.stringify(result)).toMatchObject({ success: true, submitted: true, dueAmount: f.q.first });
        expect(await f.page.evaluate(() => [window.planClicks,window.payClicks])).toEqual([1,1]);
        expect(f.calls.map(call => call.name)).toEqual(['CreateCheckoutSession','GetCartForSession','EstimateTax','Acquire']);
        expect(f.calls.find(call => call.name === 'EstimateTax').input.billingAddress).toMatchObject(f.q.address);
        const cart = f.calls.find(call => call.name === 'GetCartForSession').input;
        expect(cart.selections[0]).toMatchObject({ quantity: 0, recurrence: { count: 1, unit: f.q.plan.interval === 'year' ? 'UNIT_YEAR' : 'UNIT_MONTH' } });
        expect(hasRpcField(cart.selections[0], 'quantity')).toBe(false);
        expect(await f.page.locator('#annual').getAttribute('aria-checked')).toBe(String(f.q.plan.interval === 'year'));
    });
    it.each(Object.keys(catalog.plans))('selects %s from the official English Billing interval controls', async key => {
        const f = await fixture(key, { locale: 'en' });
        expect(await open(f)).toMatchObject({ native: true, plan: key });
        expect(await f.page.evaluate(() => [window.planClicks,window.periodClicks,window.payClicks]))
            .toEqual([1, Number(f.q.plan.interval === 'year'), 0]);
        expect(await f.page.locator('#annual').getAttribute('aria-checked')).toBe(String(f.q.plan.interval === 'year'));
        expect(f.calls.find(call => call.name === 'GetCartForSession').input.selections[0].recurrence)
            .toEqual({ count: 1, unit: f.q.plan.interval === 'year' ? 'UNIT_YEAR' : 'UNIT_MONTH' });
    });
    it('does not accept an unrelated selected annual radio when the official period fails to change', async () => {
        const f = await fixture('grok_bundle_premium_annual', { locale: 'en', periodStuck: true });
        await f.page.evaluate(() => {
            const unrelated = document.createElement('div');
            unrelated.innerHTML = '<div role="radiogroup" aria-label="Other preferences"><span role="radio" aria-checked="true">Annual</span></div>';
            document.body.append(unrelated);
        });
        await expect(open(f)).rejects.toMatchObject({ code: 'GROK_PRICE_UNCONFIRMED' });
        expect(await f.page.evaluate(() => [window.planClicks,window.periodClicks,window.payClicks])).toEqual([0,1,0]);
        expect(f.calls.some(call => call.name === 'GetCartForSession' || call.name === 'Acquire')).toBe(false);
    });
    it('rejects multiple official period matches before selecting a plan', async () => {
        const f = await fixture('grok_bundle_premium_annual', { locale: 'en' });
        await f.page.evaluate(() => document.body.append(document.querySelector('[role="radiogroup"]').cloneNode(true)));
        await expect(open(f)).rejects.toMatchObject({ code: 'GROK_ENTRY_AMBIGUOUS' });
        expect(await f.page.evaluate(() => [window.planClicks,window.periodClicks,window.payClicks])).toEqual([0,0,0]);
    });
    it.each(['zh','en'])('accepts the %s monthly subscription summary with an explicit period label', async locale => {
        const f = await fixture('grok_bundle_premium_monthly', { locale, summaryStyle: 'subscription' });
        expect(await open(f)).toMatchObject({ native: true });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(0);
    });
    it('accepts the observed Plus $8 monthly checkout with omitted quantity and both official period prices', async () => {
        const f = await fixture('grok_bundle_plus_monthly', { locale: 'en', summaryStyle: 'subscription' });
        expect(await open(f)).toMatchObject({ native: true });
        expect(f.observer.contract()).toMatchObject({ amount: 8, currency: 'USD', recurringAmount: 8, interval: 'month' });
        expect(await f.page.evaluate(() => [window.planClicks, window.payClicks])).toEqual([1,0]);
        expect(await pay(f)).toMatchObject({ success: true, submitted: true, dueAmount: 8 });
        expect(await f.page.evaluate(() => [window.planClicks, window.payClicks])).toEqual([1,1]);
    });
    it('stops before card entry when the official session is explicitly team-scoped', async () => {
        const f = await fixture('grok_bundle_plus_monthly', { teamSession: true });
        await expect(open(f)).rejects.toMatchObject({ code: 'GROK_MIGRATION_REQUIRED' });
        expect(await f.page.evaluate(() => [window.planClicks, window.payClicks])).toEqual([1,0]);
        expect(f.calls.some(call => call.name === 'Acquire' || call.name === 'EstimateTax')).toBe(false);
        const frame = f.page.frames().find(frame => frame.url().startsWith('https://js.stripe.com/'));
        expect(await frame.locator('[autocomplete="cc-number"]').inputValue()).toBe('');
    });
    it.each([
        ['changed subject', q => q.cart.data.teamId = 'offline-other-subject', 'GROK_CHECKOUT_SCOPE_UNCONFIRMED'],
        ['subscription conflict', q => q.cart.data.planFamilyConflict = {}, 'GROK_MIGRATION_REQUIRED']
    ])('rechecks %s after selection and stops before card entry', async (_name, mutate, code) => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        mutate(f.q);
        await f.page.evaluate(() => send('GetCartForSession', q.cart.request));
        expect(await pay(f)).toMatchObject({ success: false, submitted: false, canRetryCard: false, code });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(0);
        expect(f.calls.some(call => call.name === 'Acquire' || call.name === 'EstimateTax')).toBe(false);
        const frame = f.page.frames().find(frame => frame.url().startsWith('https://js.stripe.com/'));
        expect(await frame.locator('[autocomplete="cc-number"]').inputValue()).toBe('');
    });
    it('rechecks cart subject after asynchronous payment preparation and never clicks pay on a change', async () => {
        const f = await fixture('grok_bundle_plus_monthly'); await open(f);
        const result = await pay(f, { onPaymentAttemptStarted: async () => {
            f.q.cart.data.teamId = 'offline-other-subject';
            await f.page.evaluate(() => send('GetCartForSession', q.cart.request));
        } });
        expect(result).toMatchObject({ success: false, canRetryCard: false, code: 'PAYMENT_RESULT_UNKNOWN' });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(0);
        expect(f.calls.some(call => call.name === 'Acquire')).toBe(false);
    });
    it.each([
        [{ cartQuantity: 0 }, 'GROK_COMMERCE_UNCONFIRMED'],
        [{ cartQuantity: 2 }, 'GROK_COMMERCE_UNCONFIRMED'],
        [{ commerceCurrency: 'CAD' }, 'GROK_COMMERCE_UNCONFIRMED'],
        [{ currencyPrefix: 'CAD$' }, 'GROK_PRICE_UNCONFIRMED'],
        [{ dueValue: '$8.00 CAD' }, 'GROK_PRICE_UNCONFIRMED'],
        [{ dueValue: '$8.00/month' }, 'GROK_PRICE_UNCONFIRMED'],
        [{ dueValue: '$8.00 extra' }, 'GROK_PRICE_UNCONFIRMED'],
        [{ dueValue: '$8,00' }, 'GROK_PRICE_UNCONFIRMED']
    ])('rejects quantity or dollar-display ambiguity %j before filling a card or paying', async (options, code) => {
        const f = await fixture('grok_bundle_plus_monthly', { locale: 'en', summaryStyle: 'subscription', ...options });
        await expect(open(f)).rejects.toMatchObject({ code });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(0);
        expect(f.calls.some(call => call.name === 'Acquire' || call.name === 'EstimateTax')).toBe(false);
        const frame = f.page.frames().find(frame => frame.url().startsWith('https://js.stripe.com/'));
        expect(await frame.locator('[autocomplete="cc-number"]').inputValue()).toBe('');
    });
    it('keeps an unexplained effectiveAt timestamp blocked under its own diagnostic code', async () => {
        const f = await fixture('grok_bundle_plus_monthly', { effectiveAt: true });
        await expect(open(f)).rejects.toMatchObject({ code: 'GROK_EFFECTIVE_TIME_UNCONFIRMED' });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(0);
        expect(f.calls.some(call => call.name === 'Acquire')).toBe(false);
    });
    it.each([
        { baseValue: 'US$25.00' },
        { baseValue: 'US$300.00/month' },
        { baseLabel: 'Monthly subscription', baseValue: 'US$300.00' },
        { baseLabel: 'Plan price', baseValue: 'US$300.00' }
    ])('rejects an annual summary with an incorrect amount or unclear period %j', async options => {
        const f = await fixture('grok_bundle_premium_annual', { locale: 'en', ...options });
        await expect(open(f)).rejects.toMatchObject({ code: 'GROK_PRICE_UNCONFIRMED' });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(0);
        expect(f.calls.some(call => call.name === 'Acquire')).toBe(false);
    });
    it('accepts only a correlated official bank decline', async () => {
        const f = await fixture(undefined, { outcome: 'decline' }); await open(f);
        expect(await pay(f)).toMatchObject({ success: false, declined: true, canRetryCard: true, submitted: true });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(1);
    });
    it('recognizes client-side bank decline banner in checkout dialog and permits card rotation', async () => {
        const f = await fixture(undefined, { outcome: 'client_decline' }); await open(f);
        expect(await pay(f)).toMatchObject({ success: false, declined: true, canRetryCard: true, submitted: true });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(1);
        expect(f.calls.some(call => call.name === 'Acquire')).toBe(false);
        expect(() => f.observer.arm(f.observer.contract({ final: true }), account.email)).not.toThrow();
    });
    it('keeps pending unknown despite misleading generic DOM text, without a second submission', async () => {
        const f = await fixture(undefined, { outcome: 'pending' }); await open(f);
        expect(await pay(f)).toMatchObject({ code: 'PAYMENT_RESULT_UNKNOWN', canRetryCard: false, success: false, submitted: true });
        expect(await pay(f)).toMatchObject({ success: false, canRetryCard: false });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(1);
    });
    it.each([
        [{ badSummary: true }, 'GROK_PRICE_UNCONFIRMED'],
        [{ migration: true }, 'GROK_MIGRATION_REQUIRED'],
        [{ offerReview: true }, 'GROK_OFFER_REVIEW_REQUIRED']
    ])('blocks unsafe native summary %j before card or payment', async (options, code) => {
        const f = await fixture(undefined, options);
        await expect(open(f)).rejects.toMatchObject({ code });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(0);
        expect(f.calls.some(call => call.name === 'Acquire')).toBe(false);
    });
    it('rejects an impersonating Stripe host even with identical iframe fields', async () => {
        const f = await fixture(undefined, { stripeHost: 'js.stripe.com.evil.test' }); await open(f);
        await expect(nativeCardFields(f.page, { timeoutMs: 80, select: true })).rejects.toMatchObject({ code: 'GROK_FORM_UNCONFIRMED' });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(0);
    });
    it('reads back dynamic custom selectors and stops when the billing state is altered', async () => {
        const f = await fixture(); await open(f);
        const billing = await fillNativeBilling(f.page, address, card.holder, account.email);
        expect(billing.filled).toEqual(expect.arrayContaining(['line1','city','zip','name','email']));
        await f.page.locator('[name=state]').evaluate(el => el.value = 'WA');
        await expect(assertNativeBilling(f.page, billing)).rejects.toMatchObject({ code: 'GROK_BILLING_UNCONFIRMED' });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(0);
    });
    it('rechecks the order after asynchronous submission bookkeeping and stops if it changes', async () => {
        const f = await fixture(); await open(f);
        const result = await pay(f, { onPaymentAttemptStarted: () => f.page.locator('#due').evaluate(el => el.textContent = 'US$999.00') });
        expect(result).toMatchObject({ code: 'PAYMENT_RESULT_UNKNOWN', submitted: true, canRetryCard: false });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(0);
        expect(f.calls.some(call => call.name === 'Acquire')).toBe(false);
    });
    it('accepts terms when Base UI renders both a role=checkbox span and a visually-hidden input', async () => {
        const f = await fixture('grok_bundle_super_annual', { termsStyle: 'base_ui_dual' }); await open(f);
        expect(await pay(f)).toMatchObject({ success: true, submitted: true });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(1);
    });
    it('accepts terms when already pre-checked without unchecking', async () => {
        const f = await fixture('grok_bundle_super_annual', { termsStyle: 'base_ui_dual', termsPrechecked: true }); await open(f);
        expect(await pay(f)).toMatchObject({ success: true, submitted: true });
        expect(await f.page.evaluate(() => window.payClicks)).toBe(1);
    });
});

