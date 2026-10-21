import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { classifyPaymentResult, classifyOpenAiCardMethodFailure } from '../task-safety.js';
import catalog from '../public/grok-plan-catalog.js';
import { grokError } from '../grok-checkout-state.js';
import { assertNativeBillingRegion, normalizeNativeBillingAddress } from '../grok-billing-address.js';

const oregonAddress = { country: 'US', state: 'OR', line1: '123 Fixture Street', city: 'Fixture', postal_code: '97000' };
function harness({ started = true, failRecord = false, failQuarantine = false, throwAfterSubmit = false, native = false,
    paymentResponse = null, address = oregonAddress, region = 'US', currency = 'USD', pickerError = false,
    lastUsedId = null, runOptions = {}, addressRows = null, addressPoolFailure = false, failCooldown = false,
    checkoutDue = { amount: 20, currency }, checkoutDueError = false } = {}) {
    const store = {
        getPaymentRegion: vi.fn(async () => region), getAppConfigValue: vi.fn(async () => lastUsedId),
        reserveCard: vi.fn(async () => ({ id: 1, card_number: 'offline-fixture-card', card_expiry: '01/30', card_cvc: '000' })),
        releaseCard: vi.fn(), cooldownCard: vi.fn(async () => { if (failCooldown) throw new Error('fixture cooldown error'); }), quarantineCardForReview: vi.fn(async () => { if (failQuarantine) throw new Error('fixture quarantine error'); }),
        createBillingRecord: vi.fn(async () => { if (failRecord) throw new Error('fixture record error'); }),
        bindCardPaymentProfile: vi.fn(), recordCardUsage: vi.fn()
    };
    // When requested, compose the actual selector with the payment preflight.
    // All persistence still belongs to this mock store, with no real DB access.
    let selector;
    if (addressRows !== null) {
        store.runQuery = vi.fn(async (sql, params) => {
            if (addressPoolFailure) throw new Error('fixture pool unavailable');
            const oregonOnly = sql.includes("country = 'US'") && sql.includes('LOWER(TRIM(state))');
            return addressRows.filter(row => row.is_active !== 0 && !row.is_bound && (oregonOnly
                ? row.country === 'US' && /^(OR|Oregon)$/i.test(row.state.trim())
                : row.region === params?.[0])).map(row => ({ ...row }));
        });
        store.setAppConfigValue = vi.fn(async () => {});
        const addressModule = { exports: {} };
        const deterministicMath = Object.create(Math);
        deterministicMath.random = () => 0;
        vm.runInNewContext(fs.readFileSync(new URL('../tax-free-address.js', import.meta.url), 'utf8'), {
            module: addressModule, exports: addressModule.exports,
            require: key => { if (key !== './mysql-store') throw new Error('Unexpected address dependency'); return store; },
            process: { env: {} }, console, Math: deterministicMath
        });
        selector = addressModule.exports.pickBillingAddressForCheckout;
    }
    const pickBillingAddressForCheckout = vi.fn(async (...args) => {
        if (pickerError) throw new Error('fixture picker error');
        return selector ? selector(...args) : address;
    });
    const markAddressBound = vi.fn(), onPaymentState = vi.fn();
    const completeStripeCardPayment = vi.fn(async (_page, _card, _address, options) => {
        if (started) await options.onPaymentAttemptStarted();
        if (throwAfterSubmit) throw new Error('fixture browser closed');
        return paymentResponse || { success: false, submitted: false, captchaRequired: true, error: '人机验证未完成', dueAmount: 20, dueCurrency: 'USD' };
    });
    const readDue = async () => {
        if (checkoutDueError) throw new Error('fixture checkout read failure');
        return checkoutDue;
    };
    const waitForCheckoutDueAmount = vi.fn(readDue);
    const dependencies = {
        './mysql-store': store, './stripe-payment': { completeStripeCardPayment, readCheckoutDueAmount: readDue, waitForCheckoutDueAmount },
        './pricing-checkout': { ensureChatGptProUsageTier: async () => {} }, './tax-free-address': { pickBillingAddressForCheckout, markAddressBound },
        './region-config': { getRegionConfig: () => ({ currency }) }, './task-safety': { classifyPaymentResult, classifyOpenAiCardMethodFailure },
        './card-validator': { validateCardNumber: () => ({ valid: true }) }, './public/grok-plan-catalog': catalog,
        './grok-checkout-state': { grokError }, './grok-billing-address': { assertNativeBillingRegion, normalizeNativeBillingAddress }
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(new URL('../payment-retry.js', import.meta.url), 'utf8'), {
        module, exports: module.exports, require: key => { if (!(key in dependencies)) throw new Error('Unexpected dependency'); return dependencies[key]; },
        process: { env: {} }, console: { log() {}, warn() {} }, Date
    });
    return { store, completeStripeCardPayment, waitForCheckoutDueAmount, pickBillingAddressForCheckout, markAddressBound, onPaymentState,
        run: () => module.exports.executePaymentWithRetry({}, { ...(native
        ? { platform: 'grok', planType: 'grok_bundle_premium_monthly', grokCheckout: { native: true } }
        : { platform: 'claude', planType: 'claude_pro' }), onPaymentState, ...runOptions }) };
}

describe('ChatGPT checkout currency preflight', () => {
    it.each([
        { checkoutDue: null, expectedCode: 'CHECKOUT_CURRENCY_UNCONFIRMED' },
        { checkoutDue: { amount: 20, currency: 'USD' }, expectedCode: 'PAYMENT_CURRENCY_MISMATCH' },
        { checkoutDue: { amount: 20, currency: null }, expectedCode: 'CHECKOUT_CURRENCY_UNCONFIRMED' }
    ])('does not reserve a card when currency is missing or mismatched (%j)', async ({ checkoutDue, expectedCode }) => {
        const fixture = harness({ region: 'PH', currency: 'PHP', checkoutDue,
            runOptions: { platform: 'chatgpt', planType: 'plus', paymentRegion: 'PH', paymentCurrency: 'PHP' } });
        expect(await fixture.run()).toMatchObject({ code: expectedCode, paymentState: 'not_started' });
        expect(fixture.onPaymentState).toHaveBeenCalledWith('not_started', '');
        expect(fixture.store.reserveCard).not.toHaveBeenCalled();
        expect(fixture.completeStripeCardPayment).not.toHaveBeenCalled();
    });
    it('does not reserve a card when checkout currency cannot be read', async () => {
        const fixture = harness({ region: 'PH', currency: 'PHP', checkoutDueError: true,
            runOptions: { platform: 'chatgpt', planType: 'plus', paymentRegion: 'PH', paymentCurrency: 'PHP' } });
        expect(await fixture.run()).toMatchObject({ code: 'CHECKOUT_CURRENCY_UNCONFIRMED', paymentState: 'not_started' });
        expect(fixture.store.reserveCard).not.toHaveBeenCalled();
    });
    it('does not reserve a card when checkout amount does not match expected plan amount (pro_200 vs $100)', async () => {
        const fixture = harness({ region: 'US', currency: 'USD', checkoutDue: { amount: 100, currency: 'USD' },
            runOptions: { platform: 'chatgpt', planType: 'pro_200', paymentRegion: 'US', paymentCurrency: 'USD' } });
        expect(await fixture.run()).toMatchObject({ code: 'CHECKOUT_AMOUNT_MISMATCH', paymentState: 'not_started' });
        expect(fixture.store.reserveCard).not.toHaveBeenCalled();
        expect(fixture.completeStripeCardPayment).not.toHaveBeenCalled();
    });
    it('passes the verified card region and currency to the payment driver', async () => {
        const fixture = harness({ region: 'PH', currency: 'PHP', started: false,
            runOptions: { platform: 'chatgpt', planType: 'plus', paymentRegion: 'PH', paymentCurrency: 'PHP' } });
        await fixture.run();
        expect(fixture.waitForCheckoutDueAmount).toHaveBeenCalledOnce();
        expect(fixture.store.reserveCard).toHaveBeenCalledOnce();
        expect(fixture.completeStripeCardPayment.mock.calls[0][3]).toMatchObject({ paymentRegion: 'PH', paymentCurrency: 'PHP' });
    });
    it('does not classify a pre-submit currency guard as a decline or rotate the reserved card', async () => {
        const fixture = harness({ started: false, paymentResponse: {
            success: false, submitted: false, submissionAttempted: false,
            code: 'PAYMENT_CURRENCY_MISMATCH', declined: true, canRetryCard: true,
            error: 'invalid currency; card declined before payment'
        } });
        expect(await fixture.run()).toMatchObject({ success: false, paymentState: 'not_started', manualIntervention: true });
        expect(fixture.store.reserveCard).toHaveBeenCalledOnce();
        expect(fixture.completeStripeCardPayment).toHaveBeenCalledOnce();
        expect(fixture.store.cooldownCard).not.toHaveBeenCalled();
        expect(fixture.store.quarantineCardForReview).not.toHaveBeenCalled();
        expect(fixture.store.releaseCard).toHaveBeenCalledOnce();
        expect(fixture.store.createBillingRecord).toHaveBeenCalledWith(expect.objectContaining({
            status: 'failed', error_code: 'PAYMENT_CURRENCY_MISMATCH'
        }));
    });
    it('does not rotate cards when the required tax-free amount is not reached', async () => {
        const fixture = harness({ started: false, paymentResponse: {
            success: false, submitted: false, submissionAttempted: false,
            code: 'BILLING_TAX_NOT_REMOVED', declined: true, canRetryCard: true,
            error: '账单税区未生效，应付仍为 PHP 1,100（免税应约 982.14）'
        } });
        expect(await fixture.run()).toMatchObject({ success: false, paymentState: 'not_started', manualIntervention: true });
        expect(fixture.completeStripeCardPayment).toHaveBeenCalledOnce();
        expect(fixture.store.reserveCard).toHaveBeenCalledOnce();
        expect(fixture.store.cooldownCard).not.toHaveBeenCalled();
        expect(fixture.store.releaseCard).toHaveBeenCalledOnce();
        expect(fixture.store.createBillingRecord).toHaveBeenCalledWith(expect.objectContaining({
            status: 'failed', error_code: 'BILLING_TAX_NOT_REMOVED'
        }));
    });
});

describe('Grok bundle billing preflight before card reservation', () => {
    it.each(Object.keys(catalog.plans))('composes the real mixed-state address pool with %s before reserving a card', async planType => {
        const delaware = { id: 2, region: 'US', country: 'US', state: 'Delaware',
            line1: '456 Fixture Street', city: 'Dover', postal_code: '19901' };
        const previous = { ...oregonAddress, id: 6, region: 'US', state: 'Oregon' };
        const eligible = { ...oregonAddress, id: 7, region: 'US', state: ' OR ',
            line1: '789 Fixture Street', city: 'Portland', postal_code: '97201' };
        const fixture = harness({ native: true, started: false, lastUsedId: '6', runOptions: { planType },
            addressRows: [delaware, previous, { ...eligible, id: 8, is_bound: 1 },
                { ...eligible, id: 9, is_active: 0 }, eligible] });
        expect(await fixture.run()).toMatchObject({ success: false, paymentState: 'not_started' });
        expect(fixture.completeStripeCardPayment.mock.calls[0][2]).toEqual({ ...eligible, state: 'OR', line2: '' });
        expect(fixture.store.setAppConfigValue).toHaveBeenCalledWith('last_used_address_id', '7');
        expect(fixture.store.setAppConfigValue.mock.invocationCallOrder[0])
            .toBeLessThan(fixture.store.reserveCard.mock.invocationCallOrder[0]);
        expect(fixture.store.reserveCard).toHaveBeenCalledOnce();
        expect(fixture.store.releaseCard).toHaveBeenCalledOnce();
        expect(eligible.state).toBe(' OR ');
    });
    it.each([false, true])('composes an Oregon-only fallback before card reservation when the pool is empty or unavailable (%s)', async addressPoolFailure => {
        const fixture = harness({ native: true, started: false, addressPoolFailure,
            runOptions: { planType: 'grok_bundle_super_annual' }, addressRows: [] });
        await fixture.run();
        expect(fixture.completeStripeCardPayment.mock.calls[0][2]).toMatchObject({ id: 0, generated: true,
            country: 'US', state: 'OR', city: 'Portland', postal_code: '97201' });
        expect(fixture.store.setAppConfigValue).not.toHaveBeenCalled();
        expect(fixture.store.reserveCard).toHaveBeenCalledOnce();
    });
    it('composes the actual picker but rejects malformed Oregon pool data before reserving a card', async () => {
        const fixture = harness({ native: true, addressRows: [
            { ...oregonAddress, id: 7, region: 'US', postal_code: 'invalid' }
        ] });
        expect(await fixture.run()).toMatchObject({ code: 'GROK_BILLING_UNCONFIRMED', paymentState: 'not_started' });
        expect(fixture.store.reserveCard).not.toHaveBeenCalled();
        expect(fixture.completeStripeCardPayment).not.toHaveBeenCalled();
    });
    it.each(Object.keys(catalog.plans))('limits %s to the Oregon address policy', async planType => {
        const input = { ...oregonAddress, country: ' us ', state: ' oReGoN ', id: 7 };
        const fixture = harness({ native: true, started: false, address: input, lastUsedId: '6', runOptions: { planType } });
        await fixture.run();
        expect(fixture.pickBillingAddressForCheckout).toHaveBeenCalledWith('US', 6, { strategy: 'oregon' });
        expect(fixture.completeStripeCardPayment).toHaveBeenCalledWith(expect.anything(), expect.anything(),
            expect.objectContaining({ ...oregonAddress, line2: '', id: 7 }), expect.anything());
        expect(input.state).toBe(' oReGoN ');
        expect(fixture.store.reserveCard).toHaveBeenCalledOnce();
    });
    it.each([
        null, { ...oregonAddress, state: 'Delaware', city: 'Dover', postal_code: '19901' },
        { ...oregonAddress, country: 'CA' }, { ...oregonAddress, line1: ' ' },
        { ...oregonAddress, city: '' }, { ...oregonAddress, postal_code: '' },
        { ...oregonAddress, postal_code: 'not-a-zip' }, { ...oregonAddress, line2: 5 }
    ])('stops an unsupported or missing address %j before reserving any card', async address => {
        const fixture = harness({ native: true, address });
        expect(await fixture.run()).toMatchObject({ success: false, code: 'GROK_BILLING_UNCONFIRMED',
            paymentState: 'not_started', manualIntervention: true });
        expect(fixture.onPaymentState).toHaveBeenCalledWith('not_started', '');
        expect(fixture.store.reserveCard).not.toHaveBeenCalled();
        expect(fixture.completeStripeCardPayment).not.toHaveBeenCalled();
        expect(fixture.store.cooldownCard).not.toHaveBeenCalled();
        expect(fixture.store.quarantineCardForReview).not.toHaveBeenCalled();
        expect(fixture.store.createBillingRecord).not.toHaveBeenCalled();
    });
    it.each([['PH', 'PHP'], ['US', 'CAD']])('stops %s/%s before address selection or card reservation', async (region, currency) => {
        const fixture = harness({ native: true, region, currency });
        expect(await fixture.run()).toMatchObject({ code: 'GROK_BILLING_UNCONFIRMED', paymentState: 'not_started' });
        expect(fixture.pickBillingAddressForCheckout).not.toHaveBeenCalled();
        expect(fixture.store.reserveCard).not.toHaveBeenCalled();
        expect(fixture.store.createBillingRecord).not.toHaveBeenCalled();
    });
    it('does not touch the card pool when no supported address can be obtained', async () => {
        const fixture = harness({ native: true, pickerError: true });
        expect(await fixture.run()).toMatchObject({ code: 'GROK_BILLING_UNCONFIRMED', paymentState: 'not_started' });
        expect(fixture.store.reserveCard).not.toHaveBeenCalled();
        expect(fixture.store.createBillingRecord).not.toHaveBeenCalled();
    });
    it.each([
        { platform: 'chatgpt', planType: 'plus' }, { platform: 'claude', planType: 'claude_pro' },
        { platform: 'grok', planType: 'supergrok' }, { platform: 'grok', planType: 'grok_bundle_unknown_monthly' },
        { platform: 'chatgpt', planType: 'grok_bundle_plus_monthly' }
    ])('preserves the default regional policy for %j', async runOptions => {
        const address = { ...oregonAddress, state: 'Delaware', city: 'Dover', postal_code: '19901' };
        const fixture = harness({ started: false, address, runOptions }); await fixture.run();
        expect(fixture.pickBillingAddressForCheckout).toHaveBeenCalledWith('US', null);
        expect(fixture.completeStripeCardPayment.mock.calls[0][2]).toEqual(address);
    });
    it('binds the same canonical address used by payment after a confirmed success', async () => {
        const fixture = harness({ native: true, address: { ...oregonAddress, state: 'Oregon', id: 7 },
            paymentResponse: { success: true, submitted: true, dueAmount: 8, dueCurrency: 'USD', holderName: 'Fixture' } });
        expect(await fixture.run()).toMatchObject({ success: true });
        const usedAddress = fixture.completeStripeCardPayment.mock.calls[0][2];
        expect(usedAddress.state).toBe('OR');
        expect(fixture.store.bindCardPaymentProfile).toHaveBeenCalledWith(1, { holderName: 'Fixture', address: usedAddress });
        expect(fixture.markAddressBound).toHaveBeenCalledWith(7, 1);
        expect(fixture.store.createBillingRecord).toHaveBeenCalledWith(expect.objectContaining({ amount: 8, currency: 'USD', status: 'success' }));
    });
});

describe('unknown submitted payment resources', () => {
    it('quarantines a submitted verification failure without retry or release', async () => {
        const fixture = harness();
        expect(await fixture.run()).toMatchObject({ paymentState: 'unknown', manualIntervention: true });
        expect(fixture.completeStripeCardPayment).toHaveBeenCalledOnce();
        expect(fixture.store.reserveCard).toHaveBeenCalledOnce();
        expect(fixture.store.quarantineCardForReview).toHaveBeenCalledWith(1);
        expect(fixture.store.createBillingRecord).toHaveBeenCalledWith(expect.objectContaining({ amount: 20, currency: 'USD', status: 'pending' }));
        expect(fixture.store.releaseCard).not.toHaveBeenCalled();
    });
    it('releases a verification failure that occurred before submission', async () => {
        const fixture = harness({ started: false });
        expect(await fixture.run()).toMatchObject({ paymentState: 'not_started' });
        expect(fixture.store.releaseCard).toHaveBeenCalledOnce();
        expect(fixture.store.quarantineCardForReview).not.toHaveBeenCalled();
    });
    it.each([
        '无法唯一确认 Card [OPENAI_CARD_METHOD_AMBIGUOUS]',
        'Card 尚未选中 [OPENAI_CARD_METHOD_NOT_SELECTED]',
        '找不到 Card [OPENAI_CARD_METHOD_NOT_FOUND]',
        '付款方式无法确认 [OPENAI_CARD_METHOD_CHANGED]',
        'ChatGPT 信用卡字段已变化或填写不完整，尚未提交付款 [OPENAI_CARD_FIELDS_CHANGED]',
        '无法定位完整的信用卡输入框，尚未提交付款 [OPENAI_CARD_FIELDS_NOT_READY]',
        '信用卡字段未完整写入，尚未提交付款 [OPENAI_CARD_FIELDS_INCOMPLETE]'
    ])('releases an unsubmitted guard failure without cooldown, rotation or a pending charge record: %s', async error => {
        const fixture = harness({ started: false, paymentResponse: { success: false, submitted: false,
            error } });
        expect(await fixture.run()).toMatchObject({ paymentState: 'not_started', manualIntervention: true });
        expect(fixture.completeStripeCardPayment).toHaveBeenCalledOnce();
        expect(fixture.store.reserveCard).toHaveBeenCalledOnce();
        expect(fixture.store.releaseCard).toHaveBeenCalledOnce();
        expect(fixture.store.cooldownCard).not.toHaveBeenCalled();
        expect(fixture.store.quarantineCardForReview).not.toHaveBeenCalled();
        expect(fixture.store.createBillingRecord).toHaveBeenCalledOnce();
        expect(fixture.store.createBillingRecord).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error_message: error }));
    });
    it('retains an already submitted payment when a card-field guard error is returned', async () => {
        const fixture = harness({ paymentResponse: { success: false, submitted: true,
            error: 'ChatGPT 信用卡字段已变化或填写不完整 [OPENAI_CARD_FIELDS_CHANGED]' } });
        expect(await fixture.run()).toMatchObject({ paymentState: 'unknown', manualIntervention: true });
        expect(fixture.completeStripeCardPayment).toHaveBeenCalledOnce();
        expect(fixture.store.cooldownCard).not.toHaveBeenCalled();
        expect(fixture.store.releaseCard).not.toHaveBeenCalled();
        expect(fixture.store.quarantineCardForReview).toHaveBeenCalledWith(1);
        expect(fixture.store.createBillingRecord).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    });
    it.each([{ failRecord: true }, { failQuarantine: true }])('does not release after unknown-result bookkeeping failure: %j', async config => {
        const fixture = harness(config);
        await expect(fixture.run()).rejects.toThrow('fixture');
        expect(fixture.store.releaseCard).not.toHaveBeenCalled();
    });
    it('preserves submission even when the payment driver throws', async () => {
        const fixture = harness({ throwAfterSubmit: true });
        expect(await fixture.run()).toMatchObject({ paymentState: 'unknown' });
        expect(fixture.store.releaseCard).not.toHaveBeenCalled();
        expect(fixture.completeStripeCardPayment).toHaveBeenCalledOnce();
    });
    it('does not infer a native bank decline from unrelated text after submission', async () => {
        const fixture = harness({ native: true, paymentResponse: { success: false, submitted: true,
            error: 'Your card was declined', canRetryCard: false, dueAmount: 15, dueCurrency: 'USD' } });
        expect(await fixture.run()).toMatchObject({ paymentState: 'unknown', manualIntervention: true });
        expect(fixture.completeStripeCardPayment).toHaveBeenCalledOnce();
        expect(fixture.store.reserveCard).toHaveBeenCalledOnce();
        expect(fixture.store.quarantineCardForReview).toHaveBeenCalledWith(1);
        expect(fixture.store.cooldownCard).not.toHaveBeenCalled();
        expect(fixture.store.releaseCard).not.toHaveBeenCalled();
    });
    it('records actual native first-period amount and retains assets on unknown result', async () => {
        const fixture = harness({ native: true, paymentResponse: { success: false, submitted: true,
            code: 'PAYMENT_RESULT_UNKNOWN', canRetryCard: false, error: '支付结果未知', dueAmount: 15, dueCurrency: 'USD' } });
        expect(await fixture.run()).toMatchObject({ paymentState: 'unknown' });
        expect(fixture.store.createBillingRecord).toHaveBeenCalledWith(expect.objectContaining({
            amount: 15, currency: 'USD', plan_type: 'grok_bundle_premium_monthly', status: 'pending' }));
        expect(fixture.store.reserveCard).toHaveBeenCalledOnce();
    });
    it('releases an unsubmitted native scope failure without treating it as a card decline', async () => {
        const fixture = harness({ started: false, native: true, paymentResponse: { success: false, submitted: false,
            canRetryCard: false, code: 'GROK_CHECKOUT_SCOPE_UNCONFIRMED',
            error: '本次官方结账会话的个人归属无法确认 [GROK_CHECKOUT_SCOPE_UNCONFIRMED]' } });
        expect(await fixture.run()).toMatchObject({ paymentState: 'not_started', manualIntervention: true });
        expect(fixture.completeStripeCardPayment).toHaveBeenCalledOnce();
        expect(fixture.store.reserveCard).toHaveBeenCalledOnce();
        expect(fixture.store.releaseCard).toHaveBeenCalledOnce();
        expect(fixture.store.cooldownCard).not.toHaveBeenCalled();
        expect(fixture.store.quarantineCardForReview).not.toHaveBeenCalled();
        expect(fixture.store.createBillingRecord).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    });
    it('rotates a native card only for a correlated explicit official decline', async () => {
        const fixture = harness({ native: true, paymentResponse: { success: false, submitted: true,
            declined: true, canRetryCard: true, error: '支付卡被官方系统拒付', dueAmount: 30, dueCurrency: 'USD' } });
        fixture.store.reserveCard.mockResolvedValueOnce({ id: 1, card_number: 'offline-fixture-card', card_expiry: '01/30', card_cvc: '000' })
            .mockResolvedValueOnce(null);
        expect(await fixture.run()).toMatchObject({ success: false, manualIntervention: true, cardsDeclined: 1 });
        expect(fixture.completeStripeCardPayment).toHaveBeenCalledOnce();
        expect(fixture.store.cooldownCard).toHaveBeenCalledWith(1, 30, 'Stripe拒付');
        expect(fixture.store.quarantineCardForReview).not.toHaveBeenCalled();
        expect(fixture.store.releaseCard).not.toHaveBeenCalled();
    });
    it('cools down an explicitly declined card before billing-record failure and never releases or rotates it', async () => {
        const f = harness({ native: true, failRecord: true, paymentResponse: { success: false, submitted: true,
            declined: true, canRetryCard: true, error: '官方拒付' } });
        await expect(f.run()).rejects.toThrow('fixture record error');
        expect(f.store.cooldownCard).toHaveBeenCalledWith(1, 30, 'Stripe拒付');
        expect(f.store.cooldownCard.mock.invocationCallOrder[0]).toBeLessThan(f.store.createBillingRecord.mock.invocationCallOrder[0]);
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
    });
    it.each([false, true])('retains a declined card when cooldown persistence fails, including quarantine failure (%s)', async failQuarantine => {
        const f = harness({ native: true, failCooldown: true, failQuarantine, paymentResponse: { success: false, submitted: true,
            declined: true, canRetryCard: true, error: '官方拒付' } });
        await expect(f.run()).rejects.toThrow('fixture');
        expect(f.store.quarantineCardForReview).toHaveBeenCalledWith(1, 'decline_cooldown_failed');
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
        expect(f.completeStripeCardPayment).toHaveBeenCalledOnce();
    });
});
