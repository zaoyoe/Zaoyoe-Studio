import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { plans, legacyKeys } from '../public/grok-plan-catalog.js';
import { validateCdkPlan, resolvePlanName } from '../cdk-plan-catalog.js';
import { PLATFORM_CONFIG } from '../region-config.js';
import { validateCommerceContract, observeGrokCommerce, classifyTaxError } from '../grok-commerce.js';
import { decodeRpc, commerceMethod, hasRpcField } from '../grok-commerce-wire.js';
import { quote, rpc, envelope, methods, money, address, account } from './fixtures/grok-commerce.js';

const validate = q => validateCommerceContract(q.plan, q.skuId, q.session, q.cart, q.tax, q.address);
describe('Independent bundle CDK catalog', () => {
    it.each(Object.keys(plans))('recognizes %s without legacy aliases', key => {
        expect(validateCdkPlan(key, 'grok', { issuance: true })).toMatchObject({ planType: key, platform: 'grok', planName: key });
        expect(PLATFORM_CONFIG.grok.plans[key].amount).toBe(plans[key].amount);
        expect(validate(quote(key))).toMatchObject({ amount: plans[key].amount, recurringAmount: plans[key].amount, interval: plans[key].interval });
    });
    it.each(legacyKeys)('retains historical %s meaning but rejects issuance and activation', key => {
        expect(resolvePlanName(key)).toBeTruthy();
        expect(() => validateCdkPlan(key, 'grok', { issuance: true })).toThrow('停止生成');
        expect(() => validateCdkPlan(key, 'grok', { activation: true })).toThrow('旧版 Grok');
    });
    it('never turns unknown or mismatched types into ChatGPT Plus', () => {
        for (const key of ['grok_bundle_premium', 'grok_bundle_ultra_annual_extra', 'unknown', '', '__proto__'])
            expect(() => resolvePlanName(key)).toThrow();
        expect(() => validateCdkPlan('grok_bundle_plus_monthly', 'chatgpt')).toThrow('不一致');
        expect(resolvePlanName('grok_plus')).toBe('supergrok_plus');
        expect(PLATFORM_CONFIG.grok.plans.grok_plus.amount).toBe(100);
        expect(PLATFORM_CONFIG.grok.plans.grok_premium.amount).toBe(8);
        expect(resolvePlanName('plus')).toBe('chatgptplusplan');
    });
});

describe('Official grpc-web decoding', () => {
    it('decodes binary frames, enums, int64 money, repeated fields and zero-value defaults', () => {
        const q = quote(undefined, { promo: true });
        expect(decodeRpc(methods.CreateCheckoutSession, 'output', rpc('CreateCheckoutSession','output',q.session.data),
            {'content-type':'application/grpc-web+proto'})).toMatchObject(q.session.data);
        expect(decodeRpc(methods.GetCartForSession, 'input', rpc('GetCartForSession','input',q.cart.request),
            {'content-type':'application/grpc-web+proto'})).toMatchObject(q.cart.request);
    });
    it('rejects truncation, compressed frames, contradictory trailers and HTML gateways', () => {
        const bytes = rpc('Acquire','output',{ status:'ACQUISITION_STATUS_PENDING', purchaseId:'offline-purchase' });
        for (const body of [bytes.subarray(0,bytes.length-1), envelope(Buffer.from([0xff])), envelope(Buffer.from([]),1),
            rpc('Acquire','output',{},'grpc-status: 7\r\ngrpc-status: 0\r\n')])
            expect(() => decodeRpc(methods.Acquire,'output',body,{'content-type':'application/grpc-web+proto'})).toThrow();
        expect(() => decodeRpc(methods.Acquire,'output',bytes,{'content-type':'application/grpc-web-text'})).toThrow();
        expect(() => decodeRpc(methods.Acquire,'output',Buffer.from('<html>error</html>'),{'content-type':'text/html'})).toThrow();
        expect(() => decodeRpc(methods.Acquire,'output',bytes,{'content-type':'application/grpc-web+proto','grpc-status':'13'})).toThrow();
    });
    it('accepts only exact official RPC hosts and supported method paths', () => {
        expect(commerceMethod('https://grok.com/'+methods.Acquire)).toBe(methods.Acquire);
        for (const host of ['http://grok.com','https://grok.com.evil.test','https://user:secret@grok.com','https://grok.com:444'])
            expect(commerceMethod(host+'/'+methods.Acquire)).toBeNull();
        expect(commerceMethod('https://grok.com/unknown/Acquire')).toBeNull();
    });
    it.each(['json', 'proto'])('distinguishes omitted quantity from explicit zero in %s transport', transport => {
        const decode = request => decodeRpc(methods.GetCartForSession, 'input',
            transport === 'json' ? Buffer.from(JSON.stringify(request)) : rpc('GetCartForSession', 'input', request),
            { 'content-type': transport === 'json' ? 'application/json' : 'application/grpc-web+proto' });
        const q = quote('grok_bundle_plus_monthly');
        q.cart.request = decode(q.cart.request);
        expect(q.cart.request.selections[0].quantity).toBe(0);
        expect(hasRpcField(q.cart.request.selections[0], 'quantity')).toBe(false);
        expect(JSON.parse(JSON.stringify(q.cart.request)).selections[0]).toEqual({
            skuId: q.skuId, quantity: 0, recurrence: { count: 1, unit: 'UNIT_MONTH' }
        });
        expect(validate(q)).toMatchObject({ amount: 8, recurringAmount: 8 });
        for (const quantity of [0, -1, 2]) {
            const explicit = quote('grok_bundle_plus_monthly');
            explicit.cart.request.selections[0].quantity = quantity;
            explicit.cart.request = decode(explicit.cart.request);
            expect(hasRpcField(explicit.cart.request.selections[0], 'quantity')).toBe(true);
            expect(() => validate(explicit)).toThrow('数量不符合');
        }
        const one = quote('grok_bundle_plus_monthly');
        one.cart.request.selections[0].quantity = 1;
        one.cart.request = decode(one.cart.request);
        expect(validate(one).amount).toBe(8);
    });
});

describe('Money, period, tax and migration gates', () => {
    it.each(['offline-personal-subject', ''])('accepts stable cart scope metadata %j from a proven personal creation', teamId => {
        const q = quote('grok_bundle_plus_monthly');
        q.cart.data.teamId = q.session.origin.cartTeamId = teamId;
        expect(validate(q)).toMatchObject({ amount: 8, recurringAmount: 8, interval: 'month' });
    });
    it.each([
        q => delete q.session.origin,
        q => q.session.origin.token = 'unrelated-session',
        q => delete q.session.origin.cartTeamId,
        q => delete q.cart.data.teamId
    ])('stops payment when personal provenance or bound cart scope is unconfirmed', mutate => {
        const q = quote(); mutate(q);
        expect(() => validate(q)).toThrow('GROK_CHECKOUT_SCOPE_UNCONFIRMED');
    });
    it.each([
        q => q.session.origin.request.country = 'GB',
        q => q.session.origin.request.billingPlatforms = ['BILLING_PLATFORM_PAYPAL']
    ])('preserves the original creation region and payment platform gates after a session read', mutate => {
        const q = quote(); q.session.request = { sessionToken: q.session.data.checkoutSession.token }; mutate(q);
        expect(() => validate(q)).toThrow('地区或支付平台');
    });
    it('selects the matching period price, while rejecting ambiguous target quotes', () => {
        for (const key of ['grok_bundle_plus_monthly', 'grok_bundle_plus_annual']) {
            const q = quote(key);
            expect(validate(q).recurringAmount).toBe(q.plan.amount);
            const display = structuredClone(q.session.data.skuPricings[0]); display.displayOnly = true;
            q.session.data.skuPricings.push(display);
            expect(validate(q).recurringAmount).toBe(q.plan.amount);
            q.session.data.skuPricings.push(structuredClone(q.session.data.skuPricings[0]));
            expect(() => validate(q)).toThrow('无法唯一关联');
        }
    });
    it('allows missing or empty-zero initial cart tax only for a matching untaxed preview and requires final tax', () => {
        for (const subtotalAmount of [50, 100]) {
            for (const initialTax of [undefined, {}, { currencyCode: '', unitMicros: '0' }]) {
                const q = quote('grok_bundle_super_monthly', { promo: true });
                q.cart.data.subtotal = money(subtotalAmount);
                q.tax.data.subtotal = money(subtotalAmount);
                if (initialTax === undefined) delete q.cart.data.tax;
                else q.cart.data.tax = decodeRpc(methods.GetCartForSession, 'output',
                    rpc('GetCartForSession', 'output', { ...q.cart.data, tax: initialTax }),
                    { 'content-type': 'application/grpc-web+proto' }).tax;
                expect(validateCommerceContract(q.plan, q.skuId, q.session, q.cart, null, null))
                    .toMatchObject({ amount: 50, firstAmount: 50, recurringAmount: 100 });
                expect(validateCommerceContract(q.plan, q.skuId, q.session, q.cart, q.tax, q.address))
                    .toMatchObject({ amount: 50, firstAmount: 50, recurringAmount: 100, tax: 0 });
                expect(() => validateCommerceContract(q.plan, q.skuId, q.session, q.cart, null, q.address)).toThrow('税费尚未确认');
                q.cart.data.total = money(51);
                expect(() => validateCommerceContract(q.plan, q.skuId, q.session, q.cart, null, null)).toThrow();
            }
        }
        for (const badTax of [{ currencyCode: '', unitMicros: '1000000' }, { currencyCode: 'CAD', unitMicros: '0' }]) {
            const q = quote('grok_bundle_super_monthly', { promo: true });
            q.cart.data.tax = badTax;
            expect(() => validateCommerceContract(q.plan, q.skuId, q.session, q.cart, null, null)).toThrow('官方购物车税费币种无法确认');
        }
    });
    it('verifies first-period promotion independently of standard renewal', () => {
        expect(validate(quote(undefined, { promo: true }))).toMatchObject({ amount:15, firstAmount:15, recurringAmount:30 });
        const q = quote(undefined,{promo:true});
        q.session.data.skuPricings[0].benefits[0].value.discount = { fixedAmount:money(15), times:1 };
        expect(validate(q).amount).toBe(15);
    });
    it('identifies the invalid official money field without exposing upstream values', () => {
        const skuCurrency = quote();
        skuCurrency.session.data.skuPricings[0].pricing.details.amount.currencyCode = 'CLP';
        expect(() => validate(skuCurrency)).toThrow('官方 SKU 标价币种无法确认');

        const cartTotal = quote();
        cartTotal.cart.data.total.currencyCode = 'PHP';
        expect(() => validate(cartTotal)).toThrow('官方购物车总额币种无法确认');

        const offerCurrency = quote(undefined, { promo: true });
        offerCurrency.session.data.skuPricings[0].benefits[0].value.discount = {
            fixedAmount: { currencyCode: 'EUR', unitMicros: '15000000' }, times: 1
        };
        expect(() => validate(offerCurrency)).toThrow('官方优惠金额币种无法确认');
    });
    it.each([
        ['wrong SKU',q=>q.cart.request.selections[0].skuId='other'],
        ['wrong quantity',q=>q.cart.request.selections[0].quantity=2],
        ['explicit zero quantity',q=>q.cart.request.selections[0].quantity=0],
        ['missing SKU',q=>delete q.cart.request.selections[0].skuId],
        ['multiple selections',q=>q.cart.request.selections.push({...q.cart.request.selections[0]})],
        ['wrong session',q=>q.cart.request.sessionToken='other'],
        ['wrong platform',q=>q.cart.request.billingPlatform='BILLING_PLATFORM_PAYPAL'],
        ['missing recurrence',q=>delete q.cart.request.selections[0].recurrence],
        ['wrong period',q=>q.cart.request.selections[0].recurrence={count:1,unit:'UNIT_YEAR'}],
        ['wrong currency',q=>q.cart.data.total.currencyCode='EUR'],
        ['unsafe money',q=>q.cart.data.total.unitMicros='9007199254740993'],
        ['fractional cents',q=>q.cart.data.total.unitMicros='30000001'],
        ['expired session',q=>q.session.data.checkoutSession.expiresAt.seconds='1'],
        ['expired cart',q=>q.cart.data.expiresAt.seconds='1'],
        ['wrong standard price',q=>q.session.data.skuPricings[0].pricing.details.amount=money(8)],
        ['retired pricing',q=>q.session.data.skuPricings[0].pricing.status='PRICING_STATUS_RETIRED'],
        ['migration',q=>q.cart.request.migratedFrom={}],
        ['crossgrade',q=>q.cart.request.crossgrade={}],
        ['changed cart subject',q=>q.cart.data.teamId='other'],
        ['team session with omitted quantity',q=>q.session.request.teamId='other'],
        ['family conflict',q=>q.cart.data.planFamilyConflict={}],
        ['mismatched tax cart',q=>q.tax.request.cartId='other'],
        ['mismatched tax address',q=>q.tax.request.billingAddress.postalCode='00000'],
        ['tax disagreement',q=>q.tax.data.total=money(31)],
        ['over cap',q=>{q.tax.data.tax=money(1);q.tax.data.total=money(31);q.tax.data.taxLines=[{amount:money(1)}]}],
        ['finite renewal',q=>q.cart.data.chargeSchedule.segments[0].count=3],
        ['empty schedule',q=>q.cart.data.chargeSchedule.segments=[]]
    ])('rejects %s', (_name,mutate) => { const q=quote();mutate(q);expect(()=>validate(q)).toThrow(); });
    it('does not label an isolated effectiveAt timestamp as migration, and still fails closed', () => {
        const q=quote();
        q.cart.data.effectiveAt={seconds:String(Math.floor(Date.now()/1000)+3600),nanos:0};
        expect(()=>validate(q)).toThrow('GROK_EFFECTIVE_TIME_UNCONFIRMED');
        q.cart.request.crossgrade={flavor:'SCHEDULED',completeTarget:false};
        expect(()=>validate(q)).toThrow('GROK_MIGRATION_REQUIRED');
    });
    it.each(['json', 'proto'])('preserves migration and effective-time gates after %s decoding', transport => {
        const decode = (name, direction, data) => decodeRpc(methods[name], direction,
            transport === 'json' ? Buffer.from(JSON.stringify(data)) : rpc(name, direction, data),
            { 'content-type': transport === 'json' ? 'application/json' : 'application/grpc-web+proto' });
        const decoded = q => {
            q.session.request=decode('CreateCheckoutSession','input',q.session.request);
            q.session.data=decode('CreateCheckoutSession','output',q.session.data);
            q.session.origin.request=q.session.request;
            q.session.origin.token=q.session.data.checkoutSession.token;
            q.cart.request=decode('GetCartForSession','input',q.cart.request);
            q.cart.data=decode('GetCartForSession','output',q.cart.data);
            return q;
        };
        expect(validate(decoded(quote())).amount).toBe(30);
        for (const mutate of [
            q=>q.session.request.teamId='private-team',
            q=>q.cart.request.migratedFrom={},
            q=>q.cart.request.crossgrade={},
            q=>q.cart.data.planFamilyConflict={},
            q=>q.cart.data.crossgradeFlavor='SCHEDULED',
            q=>q.cart.data.crossgradeFlavor='IMMEDIATE',
            q=>q.cart.data.crossgradeFlavor=99
        ]) {
            const q=quote();mutate(q);
            expect(()=>validate(decoded(q))).toThrow('GROK_MIGRATION_REQUIRED');
        }
        const changedSubject = quote();
        changedSubject.cart.data.teamId = 'private-team';
        expect(() => validate(decoded(changedSubject))).toThrow('GROK_CHECKOUT_SCOPE_UNCONFIRMED');
        for (const effectiveAt of [{}, {seconds:'0'}, {seconds:'1900000000',nanos:0}]) {
            const q=quote();q.cart.data.effectiveAt=effectiveAt;
            expect(()=>validate(decoded(q))).toThrow('GROK_EFFECTIVE_TIME_UNCONFIRMED');
        }
    });
    it('rejects unsubstantiated promotion, wrong renewal and annual monthly-equivalent totals', () => {
        for (const mutate of [q=>q.session.data.skuPricings[0].benefits=[],
            q=>q.cart.data.chargeSchedule.segments[0].count=2,
            q=>q.cart.data.chargeSchedule.segments[1].amount=money(31)]) {
            const q=quote(undefined,{promo:true});mutate(q);expect(()=>validate(q)).toThrow();
        }
        const q=quote('grok_bundle_premium_annual');q.cart.data.subtotal=q.cart.data.total=money(25);
        expect(()=>validate(q)).toThrow();
    });
});

class Page extends EventEmitter {
    constructor() { super();this.frame={page:()=>this}; }
    mainFrame() {return this.frame;}
    request(name,data,frame=this.frame) {
        const request={url:()=> 'https://grok.com/'+methods[name],method:()=> 'POST',frame:()=>frame,
            headers:()=>({'content-type':'application/grpc-web+proto'}),postDataBuffer:()=>rpc(name,'input',data)};
        this.emit('request',request);return request;
    }
    async response(name,request,data,wait=null) {
        const response={request:()=>request,ok:()=>true,headers:()=>({'content-type':'application/grpc-web+proto'}),
            body:async()=>{if(wait)await wait;return rpc(name,'output',data)}};
        await Promise.all(this.listeners('response').map(listener=>listener(response)));
    }
    async send(name,input,output) {const request=this.request(name,input);await this.response(name,request,output);}
}
async function readyObserver() {
    const page=new Page(),q=quote(undefined,{promo:true}),observer=observeGrokCommerce(page,q.plan.key);
    await page.send('CreateCheckoutSession',q.session.request,q.session.data);
    observer.bindSku(q.skuId);
    await page.send('GetCartForSession',q.cart.request,q.cart.data);
    observer.setBillingAddress(address);
    await page.send('EstimateTax',q.tax.request,q.tax.data);
    return {page,q,observer};
}
const acquireInput=q=>({cartId:q.cart.data.cartId,native:{paymentMethodId:'pm_offline'},idempotencyKey:'offline-key',
    billingAddress:q.address,billingEmail:account.email});
describe('official tax error classification', () => {
    it.each([
        ['address_line', 'addressLines'], ['administrative_area', 'administrativeAreaCode'],
        ['country', 'regionCode'], ['locality', 'locality'], ['postal_code', 'postalCode'], ['other', null]
    ])('extracts only the allowlisted refused field %s', (field, refusedField) => {
        for (const prefix of ['', 'ADDRESS_INVALID: ']) {
            expect(classifyTaxError({ code: 'ADDRESS_INVALID', retriable: true,
                message: prefix + JSON.stringify({ field, address: 'private-address-sentinel' }) }))
                .toEqual({ code: 'ADDRESS_INVALID', category: 'address_refused', retriable: true, canRetry: false, refusedField });
        }
    });
    it('always stops country refusals, even when the upstream flag says retriable', () => {
        expect(classifyTaxError({ code: 'BILLING_COUNTRY_MISMATCH', retriable: true }))
            .toMatchObject({ category: 'address_refused', canRetry: false, refusedField: 'regionCode' });
    });
    it('requires an explicit official retriable flag for a known transport failure', () => {
        expect(classifyTaxError({ code: 'TRANSPORT_FAILURE', retriable: true }))
            .toMatchObject({ category: 'temporary', retriable: true, canRetry: true });
        for (const retriable of [undefined, false, 'true', 1]) {
            expect(classifyTaxError({ code: 'TRANSPORT_FAILURE', retriable })).toMatchObject({ canRetry: false });
        }
    });
    it.each(['new-error-code', 'PRIVATE_TOKEN_SENTINEL', '', '__proto__'])('does not retry or expose unknown codes: %s', code => {
        const result = classifyTaxError({ code, retriable: true, message: 'private-address-sentinel' });
        expect(result).toMatchObject({ code: 'UNKNOWN', category: 'unknown', canRetry: false });
        expect(JSON.stringify(result)).not.toMatch(/private|PRIVATE|new-error|__proto__/);
    });
    it.each(['not json', '{"field":"private-field-sentinel"}', '{"field":["postal_code"]}',
        '{"field":"postal_code"'.repeat(1000)])('rejects malformed refusal details', message => {
        expect(classifyTaxError({ code: 'ADDRESS_INVALID', message })).toMatchObject({ refusedField: null, canRetry: false });
    });
});
describe('Commerce request correlation and single submission', () => {
    it('binds recovery to an unchanged, unpaid official cart and address', async () => {
        const { page, q, observer } = await readyObserver();
        const scope = observer.taxRecoveryScope();
        await page.send('EstimateTax', q.tax.request, { error: { code: 'TRANSPORT_FAILURE', retriable: true } });
        expect(() => observer.contract({ final: true })).toThrow('临时失败');
        expect(scope.diagnostics()).toMatchObject({ state: 'rpc_error', error: { code: 'TRANSPORT_FAILURE', canRetry: true } });
        expect(JSON.stringify(scope)).not.toMatch(/offline|97000|Fixture/);
        await page.send('EstimateTax', q.tax.request, q.tax.data);
        expect(scope.diagnostics()).toMatchObject({ state: 'ready' });
        observer.arm(observer.contract({ final: true }), account.email);
        expect(() => scope.assertCurrent()).toThrow('税费重试上下文');
        observer.dispose();
    });
    it.each(['cart', 'session', 'address', 'dispose'])('stops recovery after a newer %s', async change => {
        const { page, q, observer } = await readyObserver();
        const scope = observer.taxRecoveryScope();
        if (change === 'cart') await page.send('GetCartForSession', q.cart.request, q.cart.data);
        if (change === 'session') await page.send('CreateCheckoutSession', q.session.request, q.session.data);
        if (change === 'address') observer.setBillingAddress({ ...address, city: 'changed' });
        if (change === 'dispose') observer.dispose();
        expect(() => scope.assertCurrent()).toThrow('税费重试上下文');
        observer.dispose();
    });
    it('refuses to recover a retryable response for a different address', async () => {
        const { page, q, observer } = await readyObserver();
        const scope = observer.taxRecoveryScope();
        await page.send('EstimateTax', { ...q.tax.request, billingAddress: { ...q.address, postalCode: '00000' } },
            { error: { code: 'TRANSPORT_FAILURE', retriable: true } });
        expect(observer.taxDiagnostics()).toMatchObject({ state: 'address_mismatch' });
        expect(() => scope.diagnostics()).toThrow('税费重试上下文');
        observer.dispose();
    });
    it('ignores a late retryable error after a newer successful tax estimate', async () => {
        const { page, q, observer } = await readyObserver();
        const scope = observer.taxRecoveryScope();
        const stale = page.request('EstimateTax', q.tax.request);
        await page.send('EstimateTax', q.tax.request, q.tax.data);
        await page.response('EstimateTax', stale, { error: { code: 'TRANSPORT_FAILURE', retriable: true } });
        expect(scope.diagnostics()).toMatchObject({ state: 'ready' });
        expect(observer.contract({ final: true })).toMatchObject({ amount: q.first });
        observer.dispose();
    });
    it.each(['before', 'after'])('retains current tax when it finishes %s delayed cart body decoding', async order => {
        const { page, q, observer } = await readyObserver();
        const request = page.request('GetCartForSession', q.cart.request);
        let release;
        const body = new Promise(resolve => release = resolve);
        const cartResponse = page.response('GetCartForSession', request, q.cart.data, body);
        const taxRequest = page.request('EstimateTax', q.tax.request);
        if (order === 'before') await page.response('EstimateTax', taxRequest, q.tax.data);
        release(); await cartResponse;
        if (order === 'after') await page.response('EstimateTax', taxRequest, q.tax.data);
        expect(observer.contract({ final: true })).toMatchObject({ amount: 15, cartId: q.cart.data.cartId });
        observer.dispose();
    });
    it('rejects tax for a different cart even when its request precedes cart decoding', async () => {
        const { page, q, observer } = await readyObserver();
        const request = page.request('GetCartForSession', q.cart.request);
        const taxRequest = page.request('EstimateTax', q.tax.request);
        await page.response('EstimateTax', taxRequest, q.tax.data);
        await page.response('GetCartForSession', request, { ...q.cart.data, cartId: 'unrelated-private-cart' });
        expect(() => observer.contract({ final: true })).toThrow('税费尚未确认');
        expect(observer.taxDiagnostics()).toMatchObject({ state: 'cart_mismatch' });
        expect(JSON.stringify(observer.taxDiagnostics())).not.toMatch(/private|offline|97000/);
        observer.dispose();
    });
    it.each(['cart', 'session'])('discards an early tax response after a newer %s generation', async generation => {
        const { page, q, observer } = await readyObserver();
        const oldCart = page.request('GetCartForSession', q.cart.request);
        const oldTax = page.request('EstimateTax', q.tax.request);
        if (generation === 'session') await page.send('CreateCheckoutSession', q.session.request, q.session.data);
        await page.send('GetCartForSession', q.cart.request, q.cart.data);
        await page.response('GetCartForSession', oldCart, q.cart.data);
        await page.response('EstimateTax', oldTax, q.tax.data);
        expect(() => observer.contract({ final: true })).toThrow('税费尚未确认');
        expect(observer.taxDiagnostics()).toMatchObject({ state: 'not_requested' });
        observer.dispose();
    });
    it('diagnoses pending, refused and mismatched address tax without private values', async () => {
        const { page, q, observer } = await readyObserver();
        const wrongAddress = { ...q.tax.request.billingAddress, locality: 'private-city-sentinel' };
        const request = page.request('EstimateTax', { ...q.tax.request, billingAddress: wrongAddress });
        expect(observer.taxDiagnostics()).toMatchObject({ state: 'response_pending' });
        await page.response('EstimateTax', request, q.tax.data);
        expect(observer.taxDiagnostics()).toMatchObject({ state: 'address_mismatch', mismatchedFields: ['locality'] });
        expect(() => observer.contract({ final: true })).toThrow('税费尚未确认');
        await page.send('EstimateTax', q.tax.request, { error: { code: 'ADDRESS_INVALID', message: 'private-error-sentinel' } });
        expect(observer.taxDiagnostics()).toMatchObject({ state: 'rpc_error' });
        expect(() => observer.contract({ final: true })).toThrow('税费尚未确认');
        expect(JSON.stringify(observer.taxDiagnostics())).not.toMatch(/private|offline|97000/);
        observer.dispose();
    });
    it('logs only allowlisted risk field names once per current cart, never private IDs or unknown enum text', async () => {
        const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
        try {
            const {page,q,observer}=await readyObserver();
            q.cart.request.crossgrade={};
            q.cart.data.teamId='secret-team-value';
            q.cart.data.planFamilyConflict={heldSubscriptionId:'secret-subscription-value'};
            q.cart.data.effectiveAt={seconds:'1900000000'};
            // Unknown enum values may be received as numeric wire values.
            q.cart.data.crossgradeFlavor=99;
            await page.send('GetCartForSession',q.cart.request,q.cart.data);
            for(let i=0;i<3;i++) expect(()=>observer.contract()).toThrow('GROK_MIGRATION_REQUIRED');
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toBe('[Grok/commerce] 安全拦截命中字段: cartRequest.crossgrade, cart.planFamilyConflict, cart.crossgradeFlavor=UNKNOWN, cart.effectiveAt; code=GROK_MIGRATION_REQUIRED');
            expect(warn.mock.calls.flat().join(' ')).not.toMatch(/secret-|offline-|1900000000|99/);
            await page.send('GetCartForSession',q.cart.request,q.cart.data);
            expect(()=>observer.contract()).toThrow('GROK_MIGRATION_REQUIRED');
            expect(warn).toHaveBeenCalledTimes(2);
            observer.dispose();
        } finally { warn.mockRestore(); }
    });
    it('observes initialization before selection and rejects a second arm',async()=>{
        const {observer}=await readyObserver();
        observer.arm(observer.contract({final:true}),account.email);
        expect(()=>observer.arm(observer.contract({final:true}),account.email)).toThrow('重复提交');
    });
    it('retains personal checkout provenance across same-token session reads and adopts', async () => {
        const {page,q,observer}=await readyObserver();
        for (const name of ['GetCheckoutSession','AdoptCheckoutSession']) {
            const request=page.request(name,{sessionToken:q.session.data.checkoutSession.token});
            await page.response(name,request,q.session.data);
            const cartRequest=page.request('GetCartForSession',q.cart.request);
            await page.response('GetCartForSession',cartRequest,q.cart.data);
            expect(observer.contract()).toMatchObject({amount:15,currency:'USD'});
        }
        observer.dispose();
    });
    it('rejects explicit team checkout creation even with ordinary cart metadata', async () => {
        const page=new Page(),q=quote(),observer=observeGrokCommerce(page,q.plan.key);
        await page.send('CreateCheckoutSession',{...q.session.request,teamId:'private-team'},q.session.data);
        observer.bindSku(q.skuId);
        await page.send('GetCartForSession',q.cart.request,q.cart.data);
        expect(()=>observer.contract()).toThrow('GROK_MIGRATION_REQUIRED');
        observer.dispose();
    });
    it('rejects changed cart subject metadata within a proven personal session', async () => {
        const {page,q,observer}=await readyObserver();
        expect(observer.contract().amount).toBe(15);
        const newCart=page.request('GetCartForSession',q.cart.request);
        await page.response('GetCartForSession',newCart,{...q.cart.data,teamId:'changed-subject'});
        expect(()=>observer.contract()).toThrow('GROK_CHECKOUT_SCOPE_UNCONFIRMED');
        observer.dispose();
    });
    it('retains team protection after same-token session reads and adopts', async () => {
        const page=new Page(),q=quote(),observer=observeGrokCommerce(page,q.plan.key);
        await page.send('CreateCheckoutSession',{...q.session.request,teamId:'private-team'},q.session.data);
        observer.bindSku(q.skuId);
        for (const name of ['GetCheckoutSession','AdoptCheckoutSession']) {
            await page.send(name,{sessionToken:q.session.data.checkoutSession.token},q.session.data);
            await page.send('GetCartForSession',q.cart.request,q.cart.data);
            expect(()=>observer.contract()).toThrow('GROK_MIGRATION_REQUIRED');
        }
        observer.dispose();
    });
    it.each(['GetCheckoutSession','AdoptCheckoutSession'])('does not infer personal provenance from an isolated %s', async name => {
        const page=new Page(),q=quote(),observer=observeGrokCommerce(page,q.plan.key);
        observer.bindSku(q.skuId);
        await page.send(name,{sessionToken:q.session.data.checkoutSession.token},q.session.data);
        await page.send('GetCartForSession',q.cart.request,q.cart.data);
        expect(()=>observer.contract()).toThrow('GROK_CHECKOUT_SCOPE_UNCONFIRMED');
        observer.dispose();
    });
    it.each(['GetCheckoutSession','AdoptCheckoutSession'])('rejects a mismatched token returned by %s', async name => {
        const {page,q,observer}=await readyObserver();
        await page.send(name,{sessionToken:q.session.data.checkoutSession.token}, {
            ...q.session.data,checkoutSession:{...q.session.data.checkoutSession,token:'unrelated-session'}
        });
        await page.send('GetCartForSession',q.cart.request,q.cart.data);
        expect(()=>observer.contract()).toThrow('GROK_COMMERCE_UNCONFIRMED');
        observer.dispose();
    });
    it('retains the bound cart subject on repeated creation of the same session', async () => {
        const {page,q,observer}=await readyObserver();
        await page.send('CreateCheckoutSession',q.session.request,q.session.data);
        await page.send('GetCartForSession',q.cart.request,q.cart.data);
        expect(observer.contract().amount).toBe(15);
        await page.send('CreateCheckoutSession',q.session.request,q.session.data);
        await page.send('GetCartForSession',q.cart.request,{...q.cart.data,teamId:'changed-subject'});
        expect(()=>observer.contract()).toThrow('GROK_CHECKOUT_SCOPE_UNCONFIRMED');
        observer.dispose();
    });
    it('does not reset bound scope when overlapping creation requests reuse a known token', async () => {
        const {page,q,observer}=await readyObserver();
        const old=page.request('CreateCheckoutSession',q.session.request);
        const latest=page.request('CreateCheckoutSession',q.session.request);
        await page.response('CreateCheckoutSession',latest,q.session.data);
        await page.response('CreateCheckoutSession',old,q.session.data);
        await page.send('GetCartForSession',q.cart.request,{...q.cart.data,teamId:'changed-subject'});
        expect(()=>observer.contract()).toThrow('GROK_CHECKOUT_SCOPE_UNCONFIRMED');
        observer.dispose();
    });
    it('does not silently change team scope when creation reuses the same token', async () => {
        const {page,q,observer}=await readyObserver();
        await page.send('CreateCheckoutSession',{...q.session.request,teamId:'private-team'},q.session.data);
        await page.send('GetCartForSession',q.cart.request,q.cart.data);
        expect(()=>observer.contract()).toThrow('GROK_CHECKOUT_SCOPE_UNCONFIRMED');
        observer.dispose();
    });
    it('ignores a stale response that would change the bound cart subject', async () => {
        const {page,q,observer}=await readyObserver();
        const old=page.request('GetCartForSession',q.cart.request);
        const latest=page.request('GetCartForSession',q.cart.request);
        await page.response('GetCartForSession',latest,q.cart.data);
        await page.response('GetCartForSession',old,{...q.cart.data,teamId:'changed-subject'});
        expect(observer.contract().amount).toBe(15);
        observer.dispose();
    });
    it('diagnoses scope mismatch without exposing opaque subject values', async () => {
        const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
        try {
            const {page,q,observer}=await readyObserver();
            await page.send('GetCartForSession',q.cart.request,{...q.cart.data,teamId:'secret-subject'});
            for(let i=0;i<2;i++) expect(()=>observer.contract()).toThrow('GROK_CHECKOUT_SCOPE_UNCONFIRMED');
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledWith('[Grok/commerce] 安全拦截命中字段: cart.teamId; code=GROK_CHECKOUT_SCOPE_UNCONFIRMED');
            expect(warn.mock.calls.flat().join(' ')).not.toMatch(/secret-|offline-/);
            observer.dispose();
        } finally { warn.mockRestore(); }
    });
    it('discards late cart/tax responses after a newer request or session',async()=>{
        const {page,q,observer}=await readyObserver();
        const oldTax=page.request('EstimateTax',q.tax.request);
        const old=page.request('GetCartForSession',q.cart.request);
        const latest=page.request('GetCartForSession',q.cart.request);
        await page.response('GetCartForSession',latest,{...q.cart.data,cartId:'latest-cart'});
        await page.response('GetCartForSession',old,q.cart.data);
        page.emit('requestfailed',oldTax);
        expect(observer.contract().cartId).toBe('latest-cart');
        const stale=page.request('GetCartForSession',q.cart.request);
        const session=page.request('CreateCheckoutSession',q.session.request);
        expect(()=>observer.contract()).toThrow('尚未就绪');
        await page.response('CreateCheckoutSession',session,{...q.session.data,checkoutSession:{...q.session.data.checkoutSession,token:'next-session'}});
        await page.response('GetCartForSession',stale,q.cart.data);
        expect(()=>observer.contract()).toThrow();
    });
    it('does not accept another page, purchase, or generic DOM success as this payment',async()=>{
        const {page,q,observer}=await readyObserver();observer.arm(observer.contract({final:true}),account.email);
        const req=page.request('Acquire',acquireInput(q),{page:()=>({})});
        await page.response('Acquire',req,{status:'ACQUISITION_STATUS_SUCCEEDED',purchaseId:'other',subscriptionId:'sub_other'});
        expect(observer.result()).toBeNull();
        await page.send('Acquire',acquireInput(q),{status:'ACQUISITION_STATUS_PENDING',purchaseId:'purchase1'});
        await page.send('GetAcquisitionStatus',{purchaseId:'purchase2'},{status:'ACQUISITION_STATUS_SUCCEEDED',purchaseId:'purchase2',subscriptionId:'sub2'});
        expect(observer.result()).toBeNull();
        await page.send('GetAcquisitionStatus',{purchaseId:'purchase1'},{status:'ACQUISITION_STATUS_SUCCEEDED',purchaseId:'purchase1',subscriptionId:'sub1'});
        expect(observer.result()).toMatchObject({success:true,canRetryCard:false});
    });
    it('requires subscription identity and a correlated explicit decline before rotation',async()=>{
        const {page,q,observer}=await readyObserver();observer.arm(observer.contract({final:true}),account.email);
        await page.send('Acquire',acquireInput(q),{status:'ACQUISITION_STATUS_SUCCEEDED',purchaseId:'purchase1'});
        expect(observer.result()).toBeNull();
        await page.send('GetAcquisitionStatus',{purchaseId:'purchase1'}, {status:'ACQUISITION_STATUS_FAILED',purchaseId:'purchase1',error:{code:'OTHER',message:'card declined'}});
        expect(observer.result()).toBeNull();
        await page.send('GetAcquisitionStatus',{purchaseId:'purchase1'}, {status:'ACQUISITION_STATUS_FAILED',purchaseId:'purchase1',declineReason:'DECLINE_REASON_GENERIC',error:{code:'CARD_DECLINED'}});
        expect(observer.result()).toMatchObject({declined:true,canRetryCard:true});
        expect(()=>observer.arm(observer.contract({final:true}),account.email)).not.toThrow();
    });
    it('allows client-side decline recording and permits rotation',async()=>{
        const {page,q,observer}=await readyObserver();observer.arm(observer.contract({final:true}),account.email);
        expect(observer.isPending()).toBe(false);
        observer.recordDecline('Your payment method was declined.');
        expect(observer.result()).toMatchObject({success:false,declined:true,canRetryCard:true});
        expect(()=>observer.arm(observer.contract({final:true}),account.email)).not.toThrow();
    });
    it('keeps protocol/network uncertainty terminal and rejects another cart/address on Acquire',async()=>{
        for (const mutate of [input=>input.cartId='other',input=>input.billingAddress={...input.billingAddress,postalCode:'00000'}]) {
            const {page,q,observer}=await readyObserver();observer.arm(observer.contract({final:true}),account.email);
            const input=acquireInput(q);mutate(input);
            await page.send('Acquire',input,{status:'ACQUISITION_STATUS_SUCCEEDED',purchaseId:'p',subscriptionId:'s'});
            expect(observer.result()).toMatchObject({code:'PAYMENT_RESULT_UNKNOWN',success:false});
        }
        const {page,q,observer}=await readyObserver();observer.arm(observer.contract({final:true}),account.email);
        const request=page.request('Acquire',acquireInput(q));page.emit('requestfailed',request);
        await page.response('Acquire',request,{status:'ACQUISITION_STATUS_SUCCEEDED',purchaseId:'p',subscriptionId:'s'});
        expect(observer.result()).toMatchObject({code:'PAYMENT_RESULT_UNKNOWN',success:false});
        observer.dispose();expect(page.listenerCount('request')).toBe(0);
    });
});
