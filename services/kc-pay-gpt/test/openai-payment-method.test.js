import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import fs from 'node:fs';
import vm from 'node:vm';
import * as taskSafety from '../task-safety.js';
import { completeStripeCardPayment, fillCardFieldsOpenAiCheckout } from '../stripe-payment.js';
import { createOpenAiCardMethodGuard } from '../openai-payment-method.js';
import { isTrustedStripeFrame, isStripePaymentAccessoryFrame } from '../stripe-payment-frame.js';

let browser;
const contexts = [];
const screenshots = [];
const card = { number: '4242424242424242', expiry: '12/30', cvc: '123' };
const fields = '<input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">';
const accessoryPath = '/v3/elements-inner-accessory-target-fixture.html';
const accessoryUrl = 'https://js.stripe.com' + accessoryPath + '#componentName=payment&elementId=payment-fixture';
const accessoryBody = `<div role="tablist"><button id="paypal" role="tab" aria-selected="true"><svg><title>PayPal logo</title></svg><span>PayPal</span></button>
    <button id="card" role="tab" aria-selected="false"><svg><title>Credit card icon</title></svg><span>Card</span></button></div>
    <div id="method-copy"><span>PayPal selected.</span><p>After submission, you will be redirected to securely complete next steps.</p></div>
    <div id="fields"></div><script>window.cardClicks=0;document.querySelector('#card').onclick=()=>{
        window.cardClicks++;document.querySelector('#card').setAttribute('aria-selected','true');document.querySelector('#paypal').setAttribute('aria-selected','false');
        document.querySelector('#method-copy').textContent='Card selected.';
        setTimeout(()=>document.querySelector('#fields').innerHTML=${JSON.stringify(fields)},150);
    };</script>`;
const billing = `<input type="email" value="offline@example.test"><section><h2>Billing address</h2>
    <input autocomplete="billing name" value="Offline Customer"><input autocomplete="billing address-line1" value="123 Fixture Street">
    <input autocomplete="billing address-level2" value="Fixture"><select autocomplete="billing address-level1"><option value="OR">Oregon</option></select>
    <input autocomplete="billing postal-code" value="97000"><select autocomplete="billing country"><option value="US">United States</option></select>
    </section><aside>Due today USD 200<br>Tax (0%) USD 0</aside>`;

beforeAll(async () => { browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] }); });
afterEach(async () => {
    await Promise.all(contexts.splice(0).map(context => context.close()));
    for (const path of screenshots.splice(0)) fs.rmSync(path, { force: true });
});
afterAll(async () => { await browser?.close(); });

async function fixture(html, frames = {}) {
    const context = await browser.newContext(); contexts.push(context);
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8',
        body: frames[new URL(route.request().url()).pathname] || '<body></body>' }));
    const page = await context.newPage();
    await page.goto('https://chatgpt.com/checkout/openai_llc/offline');
    await page.setContent(`<h1>Configure your plan</h1>${html}
        <button id="submit" onclick="window.payClicks++">Upgrade to Pro</button>
        <script>window.cardClicks=0;window.payClicks=0;window.walletClicks=0;</script>`);
    return page;
}

async function paypalFixture({ delay = 250, mode = 'button', chinese = false, initial = 'paypal', stale = false, noSwitch = false } = {}) {
    const selected = initial === 'card';
    const cardLabel = chinese ? '信用卡' : 'Card';
    const choices = mode === 'radio'
        ? `<label><input type="radio" name="method" value="paypal" ${selected ? '' : 'checked'}>PayPal</label>
            <label><input id="card" type="radio" name="method" value="card" ${selected ? 'checked' : ''}>${cardLabel}</label>`
        : `<button id="paypal" ${mode === 'tab' ? 'role="tab"' : ''} aria-${mode === 'tab' ? 'selected' : 'pressed'}="${!selected}">PayPal</button>
            <button id="card" ${mode === 'tab' ? 'role="tab"' : ''} aria-${mode === 'tab' ? 'selected' : 'pressed'}="${selected}">${cardLabel}</button>`;
    const page = await fixture(`<button onclick="window.walletClicks++">Apple Pay</button><button onclick="window.walletClicks++">Google Pay</button>
        <div id="choices">${choices}</div><p id="method-copy">${selected ? 'Card selected.' : chinese ? '已选择 PayPal' : 'PayPal selected.'}</p>
        <div id="fields">${selected || stale ? fields : ''}</div>`);
    await page.locator('#card').evaluate((target, { fields, delay, noSwitch }) => {
        target.onclick = () => {
            window.cardClicks++;
            if (noSwitch) return;
            document.querySelector('#method-copy').textContent = 'Card selected.';
            if (target.type !== 'radio') {
                const attr = target.getAttribute('role') === 'tab' ? 'aria-selected' : 'aria-pressed';
                target.setAttribute(attr, 'true');
                document.querySelector('#paypal').setAttribute(attr, 'false');
            }
            document.querySelector('#fields').innerHTML = '';
            setTimeout(() => { document.querySelector('#fields').innerHTML = fields; }, delay);
        };
    }, { fields, delay, noSwitch });
    return page;
}

async function fill(page, timeout = 4000) {
    const started = performance.now();
    const result = await fillCardFieldsOpenAiCheckout(page, card, timeout);
    return { result, elapsed: performance.now() - started };
}

async function run(page, cardAttempt = 1) {
    const states = [];
    const result = await completeStripeCardPayment(page, card, {
        line1: '123 Fixture Street', city: 'Fixture', state: 'OR', postal_code: '97000', country: 'US'
    }, { holderName: 'Offline Customer', email: 'offline@example.test', cardAttempt, platform: 'chatgpt', paymentCurrency: 'USD',
        onPaymentAttemptStarted: async () => states.push('started') });
    if (result.screenshot) screenshots.push(result.screenshot);
    return { result, states };
}

describe('OpenAI checkout Card method before card field discovery', () => {
    it.each(['button', 'tab', 'radio'])('switches PayPal to Card exactly once using %s controls and waits for the form', async mode => {
        const page = await paypalFixture({ mode, chinese: mode === 'radio' });
        expect((await fill(page)).result).toEqual({ ok: true });
        expect(await page.evaluate(() => ({ card: window.cardClicks, wallet: window.walletClicks, pay: window.payClicks })))
            .toEqual({ card: 1, wallet: 0, pay: 0 });
        expect(await page.locator('input[autocomplete="cc-number"]').inputValue()).toBe(card.number);
    });

    it('handles external radio labels without treating the label and input as two different Card options', async () => {
        const page = await fixture(`<input id="paypal" type="radio" name="method" checked><label for="paypal">PayPal</label>
            <input id="card" type="radio" name="method"><label for="card">Card</label><div id="fields"></div>`);
        await page.locator('#card').evaluate((target, html) => {
            target.onclick = () => { window.cardClicks++; document.querySelector('#fields').innerHTML = html; };
        }, fields);
        expect((await fill(page)).result.ok).toBe(true);
        expect(await page.evaluate(() => window.cardClicks)).toBe(1);
    });

    it('leaves an already selected Card form intact', async () => {
        const page = await paypalFixture({ initial: 'card' });
        expect((await fill(page)).result.ok).toBe(true);
        expect(await page.evaluate(() => window.cardClicks)).toBe(0);
    });

    it('ignores a hidden earlier Card option and never clicks a wallet or submit button', async () => {
        const page = await paypalFixture();
        await page.locator('#choices').evaluate(group => group.insertAdjacentHTML('afterbegin', '<button hidden>Card</button>'));
        expect((await fill(page)).result.ok).toBe(true);
        expect(await page.evaluate(() => window.cardClicks)).toBe(1);
        expect(await page.evaluate(() => window.walletClicks + window.payClicks)).toBe(0);
    });

    it('detects a payment picker rendered after the initial scan', async () => {
        const page = await paypalFixture();
        await page.locator('#choices').evaluate(group => {
            group.hidden = true;
            document.querySelector('#method-copy').hidden = true;
            setTimeout(() => { group.hidden = false; document.querySelector('#method-copy').hidden = false; }, 350);
        });
        expect((await fill(page)).result.ok).toBe(true);
        expect(await page.evaluate(() => window.cardClicks)).toBe(1);
    });

    it('selects Card inside a visible Stripe Payment iframe and excludes an unrelated frame', async () => {
        const frameBody = `<button role="tab" aria-selected="true" id="paypal">PayPal</button><button role="tab" aria-selected="false" id="card">Card</button>
            <div id="fields"></div><script>window.cardClicks=0;document.querySelector('#card').onclick=()=>{
                window.cardClicks++;document.querySelector('#card').setAttribute('aria-selected','true');document.querySelector('#paypal').setAttribute('aria-selected','false');
                document.querySelector('#fields').innerHTML=${JSON.stringify(fields)};
            };</script>`;
        const page = await fixture('<iframe src="https://unrelated.test/card"></iframe><iframe src="https://js.stripe.com/payment"></iframe>',
            { '/card': '<button>Card</button>', '/payment': frameBody });
        expect((await fill(page)).result.ok).toBe(true);
        const frame = page.frames().find(frame => frame.url().endsWith('/payment'));
        expect(await frame.evaluate(() => window.cardClicks)).toBe(1);
        expect(await frame.locator('input').first().inputValue()).toBe(card.number);
    });
    it('switches and fills the labelled Card control in a payment accessory-target iframe', async () => {
        const page = await fixture('<iframe src="' + accessoryUrl + '"></iframe>', { [accessoryPath]: accessoryBody });
        const {result,elapsed} = await fill(page);
        expect(result).toEqual({ok:true});
        expect(elapsed).toBeLessThan(3000);
        const frame = page.frames().find(frame => frame.url() === accessoryUrl);
        expect(await frame.evaluate(() => window.cardClicks)).toBe(1);
        expect(await frame.locator('[autocomplete="cc-number"]').inputValue()).toBe(card.number);
        expect(await page.evaluate(() => window.payClicks)).toBe(0);
    });
    it('accepts exact Card label text inside a main-document button with an icon and longer accessible name', async () => {
        const page = await paypalFixture();
        await page.locator('#card').evaluate(button => {
            button.innerHTML='<svg><title>Credit card icon</title></svg><span>Card</span><span>Credit or debit</span>';
        });
        expect((await fill(page)).result).toEqual({ok:true});
        expect(await page.evaluate(() => window.cardClicks)).toBe(1);
    });
    it('detects other-method selection copy combined with a longer description and never fills stale fields', async () => {
        const page=await paypalFixture({stale:true,noSwitch:true});
        await page.locator('#paypal').evaluate(button=>button.removeAttribute('aria-pressed'));
        await page.locator('#card').evaluate(button=>button.removeAttribute('aria-pressed'));
        await page.locator('#method-copy').evaluate(copy=>copy.textContent='PayPal selected. After submission, you will be redirected.');
        expect((await fill(page,700)).result.error).toContain('OPENAI_CARD_METHOD_CHANGED');
        expect(await page.locator('input').first().inputValue()).toBe('');
        expect(await page.evaluate(()=>[window.cardClicks,window.payClicks])).toEqual([1,0]);
    });
    it.each([
        ['address','#componentName=address&elementId=address-fixture'],
        ['wallet','#componentName=expressCheckout&elementId=expressCheckout-fixture'],
        ['unmarked',''],
        ['wrong element','#componentName=payment&elementId=address-fixture'],
        ['conflicting marker','#componentName=payment&componentName=address&elementId=payment-fixture']
    ])('excludes %s accessory surfaces from both method selection and semantic card filling', async (_name,hash) => {
        const staleBody=accessoryBody.replace('<div id="fields"></div>','<div id="fields">'+fields+'</div>');
        const page=await fixture('<iframe src="https://js.stripe.com'+accessoryPath+hash+'"></iframe>',{[accessoryPath]:staleBody});
        expect((await fill(page,500)).result.error).toContain('OPENAI_CARD_METHOD_NOT_FOUND');
        const frame=page.frames().find(frame=>frame.url().includes(accessoryPath));
        expect(await frame.evaluate(()=>window.cardClicks)).toBe(0);
        expect(await frame.locator('input').first().inputValue()).toBe('');
        expect(await page.evaluate(()=>window.payClicks)).toBe(0);
    });
    it.each(['https://js.stripe.com.evil.test','https://js.stripe.com:444'])('does not inspect or fill Card controls from an untrusted frame %s', async host => {
        const page=await fixture('<iframe src="'+host+accessoryPath+'#componentName=payment&elementId=payment-fixture"></iframe>',{
            [accessoryPath]:accessoryBody.replace('<div id="fields"></div>','<div id="fields">'+fields+'</div>')
        });
        expect((await fill(page,500)).result.error).toContain('OPENAI_CARD_METHOD_NOT_FOUND');
        const frame=page.frames().find(frame=>frame.url().includes(accessoryPath));
        expect(await frame.evaluate(()=>window.cardClicks)).toBe(0);
        expect(await frame.locator('input').first().inputValue()).toBe('');
    });
    it('rejects insecure and credential-bearing frame URLs before DOM inspection', () => {
        for(const host of ['http://js.stripe.com','https://user:password@js.stripe.com']) {
            const url=host+accessoryPath+'#componentName=payment&elementId=payment-fixture';
            expect(isTrustedStripeFrame(url)).toBe(false);
            expect(isStripePaymentAccessoryFrame(url)).toBe(false);
        }
    });
    it('requires a known Card selection or actual card fields instead of approving an unseen picker', async () => {
        const page=await fixture('<p>Pay with</p>');
        const guard=createOpenAiCardMethodGuard(page,Date.now());
        await expect(guard.assertReady()).rejects.toMatchObject({code:'OPENAI_CARD_METHOD_NOT_FOUND'});
    });

    it.each(['missing', 'disabled', 'ambiguous', 'unchanged'])('blocks %s Card selection without filling stale fields or submitting', async failure => {
        const page = await paypalFixture({ stale: true, noSwitch: true });
        if (failure === 'missing') await page.locator('#card').evaluate(target => target.remove());
        if (failure === 'disabled') await page.locator('#card').evaluate(target => { target.disabled = true; });
        if (failure === 'ambiguous') await page.locator('#choices').evaluate(group => group.insertAdjacentHTML('beforeend', '<button>Card</button>'));
        const { result, elapsed } = await fill(page, 700);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('OPENAI_CARD_METHOD_');
        expect(elapsed).toBeLessThan(1800);
        expect(await page.locator('input').first().inputValue()).toBe('');
        expect(await page.evaluate(() => window.payClicks)).toBe(0);
        expect(await page.evaluate(() => window.cardClicks)).toBe(failure === 'unchanged' ? 1 : 0);
    });

    it('waits for all three fields after switching, including a delayed CVC', async () => {
        const page = await paypalFixture();
        await page.locator('#card').evaluate((button, html) => {
            window.earlyWrites = 0;
            button.onclick = () => {
                window.cardClicks++;
                button.setAttribute('aria-pressed', 'true'); document.querySelector('#paypal').setAttribute('aria-pressed', 'false');
                document.querySelector('#method-copy').textContent = 'Card selected.';
                document.querySelector('#fields').innerHTML = html.replace('<input autocomplete="cc-csc">', '');
                document.querySelectorAll('#fields input').forEach(input => input.oninput = () => {
                    if (!document.querySelector('[autocomplete="cc-csc"]')) window.earlyWrites++;
                });
                setTimeout(() => document.querySelector('#fields').insertAdjacentHTML('beforeend','<input autocomplete="cc-csc">'), 500);
            };
        }, fields);
        expect((await fill(page)).result.ok).toBe(true);
        expect(await page.evaluate(() => window.earlyWrites)).toBe(0);
    });
});

describe('OpenAI Card form process classification', () => {
    const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
    const start = source.indexOf('function extractRuntimeErrorMessage(');
    const end = source.indexOf('\nfunction ', source.indexOf('function analyzeProcessOutput(') + 10);
    function analyze(code, state) {
        const sandbox = { ...taskSafety, input: '[Stripe] Step 2: 填写信用卡字段\n' +
            '截图已保存: /tmp/card_fields_not_found_fixture.png\nPAYMENT_STATE:' + state +
            '\n❌ [运行时错误]: 支付失败 (manual_intervention): 信用卡表单未确认 [' + code + ']' };
        vm.runInNewContext(source.slice(start, end) + '\nresult = analyzeProcessOutput(input, false);', sandbox);
        return sandbox.result;
    }
    it.each(['METHOD_NOT_FOUND','METHOD_NOT_SELECTED','FIELDS_NOT_READY','FIELDS_INCOMPLETE'])('does not infer proxy failure or retry from the screenshot filename for %s', suffix => {
        expect(analyze('OPENAI_CARD_' + suffix, 'not_started')).toMatchObject({ status: 'manual', shouldRetry: false,
            deletePhone: false, deleteCard: false, paymentState: 'not_started' });
    });
    it('retains assets when a prior payment has an unknown result', () => {
        expect(analyze('OPENAI_CARD_METHOD_CHANGED', 'unknown')).toMatchObject({ status: 'manual', shouldRetry: false,
            paymentState: 'unknown', recoveryRequired: true, deleteCard: false });
    });
});

describe('OpenAI Card method submission safety', () => {
    it.each([1,2])('selects the payment accessory Card and submits only once on card attempt %i', async cardAttempt => {
        const loggedBody=accessoryBody.replace('window.cardClicks++;','window.cardClicks++;parent.postMessage("offline-card-click", "*");');
        const page=await fixture('<iframe src="'+accessoryUrl+'"></iframe>'+billing,{[accessoryPath]:loggedBody});
        await page.evaluate(()=>window.addEventListener('message',event=>{
            if(event.origin==='https://js.stripe.com' && event.data==='offline-card-click')window.cardClicks++;
        }));
        await page.locator('#submit').evaluate(button=>{
            button.onclick=()=>{window.payClicks++;setTimeout(()=>document.body.innerHTML='<h1>Your card was declined</h1>',40);};
        });
        const {result,states}=await run(page,cardAttempt);
        expect(result).toMatchObject({success:false,declined:true,submitted:true});
        expect(states).toEqual(['started']);
        expect(await page.evaluate(()=>[window.cardClicks,window.payClicks])).toEqual([1,1]);
    });
    it('rechecks an accessory payment picker changed back to PayPal before submission', async () => {
        const page=await fixture('<iframe src="'+accessoryUrl+'"></iframe>'+billing+'<label><input type="checkbox" name="agree">Agree</label>',{
            [accessoryPath]:accessoryBody.replace('</script>',`window.addEventListener('message',event=>{
                if(event.data==='offline-paypal-reset'){
                    document.querySelector('#paypal').setAttribute('aria-selected','true');document.querySelector('#card').setAttribute('aria-selected','false');
                    document.querySelector('#method-copy').textContent='PayPal selected.';
                }
            });</script>`)
        });
        await page.locator('[name="agree"]').evaluate(input=>input.onclick=()=>document.querySelector('iframe').contentWindow.postMessage('offline-paypal-reset','*'));
        const {result,states}=await run(page);
        expect(result).toMatchObject({success:false,submitted:false,declined:false});
        expect(result.error).toContain('OPENAI_CARD_METHOD_CHANGED');
        expect(states).toEqual([]);
        expect(await page.evaluate(()=>window.payClicks)).toBe(0);
    });
    it.each([1, 2])('uses Card and submits exactly once on card attempt %i', async cardAttempt => {
        const page = await paypalFixture();
        await page.locator('#submit').evaluate((button, html) => {
            button.insertAdjacentHTML('beforebegin', html);
            button.onclick = () => { window.payClicks++; setTimeout(() => { document.body.innerHTML = '<h1>Your card was declined</h1>'; }, 40); };
        }, billing);
        const { result, states } = await run(page, cardAttempt);
        expect(result).toMatchObject({ success: false, declined: true, submitted: true, submissionAttempted: true });
        expect(states).toEqual(['started']);
        expect(await page.evaluate(() => ({ card: window.cardClicks, pay: window.payClicks }))).toEqual({ card: 1, pay: 1 });
    });

    it.each(['method', 'fields'])('stops before submission when %s changes during checkout preparation', async change => {
        const page = await paypalFixture();
        await page.locator('#submit').evaluate((button, { billing, change }) => {
            button.insertAdjacentHTML('beforebegin', billing+'<label><input type="checkbox" name="agree">Agree</label>');
            document.querySelector('[name="agree"]').onclick = () => {
                if (change === 'method') {
                    document.querySelector('#paypal').setAttribute('aria-pressed', 'true');
                    document.querySelector('#card').setAttribute('aria-pressed', 'false');
                    document.querySelector('#method-copy').textContent = 'PayPal selected.';
                } else document.querySelector('input[autocomplete="cc-csc"]').value = '';
            };
        }, { billing, change });
        const { result, states } = await run(page);
        expect(result).toMatchObject({ success: false, submitted: false, submissionAttempted: false, declined: false });
        expect(result.error).toContain(change === 'method' ? 'OPENAI_CARD_METHOD_CHANGED' : 'OPENAI_CARD_FIELDS_CHANGED');
        expect(states).toEqual([]);
        expect(await page.evaluate(() => window.payClicks)).toBe(0);
        expect(await page.evaluate(() => window.cardClicks)).toBe(1);
    });
});
