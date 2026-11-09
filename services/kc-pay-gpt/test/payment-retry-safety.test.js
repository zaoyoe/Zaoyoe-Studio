import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomBytes } from 'node:crypto';
import { classifyPaymentResult, classifyOpenAiCardMethodFailure } from '../task-safety.js';
import catalog from '../public/grok-plan-catalog.js';
import { grokError } from '../grok-checkout-state.js';
import { assertNativeBillingRegion, normalizeNativeBillingAddress } from '../grok-billing-address.js';

const oregonAddress = { country: 'US', state: 'OR', line1: '123 Fixture Street', city: 'Fixture', postal_code: '97000' };
function harness({ started = true, failRecord = false, failQuarantine = false, throwAfterSubmit = false, native = false,
    paymentResponse = null, address = oregonAddress, region = 'US', currency = 'USD', pickerError = false,
    lastUsedId = null, runOptions = {}, addressRows = null, addressPoolFailure = false, failCooldown = false,
    checkoutDue = { amount: 20, currency }, checkoutDueError = false, page = {}, startCallbacks = 1, cardValidation = { valid: true } } = {}) {
    const store = {
        getPaymentRegion: vi.fn(async () => region), getAppConfigValue: vi.fn(async () => lastUsedId),
        reserveCard: vi.fn(async () => ({ id: 1, card_number: 'offline-fixture-card', card_expiry: '01/30', card_cvc: '000' })),
        markCardPaymentStarted: vi.fn(async () => 1), completeCardPayment: vi.fn(async () => 1),
        releaseCard: vi.fn(async () => 1), cooldownCard: vi.fn(async () => { if (failCooldown) throw new Error('fixture cooldown error'); }), quarantineCardForReview: vi.fn(async () => { if (failQuarantine) throw new Error('fixture quarantine error'); }),
        createBillingRecord: vi.fn(async () => { if (failRecord) throw new Error('fixture record error'); }),
        bindCardPaymentProfile: vi.fn(), recordCardUsage: vi.fn(), markCardExhausted: vi.fn()
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
    const externalSubmission = vi.fn();
    const completeStripeCardPayment = vi.fn(async (_page, _card, _address, options) => {
        if (started) {
            for (let i = 0; i < startCallbacks; i++) {
                await options.onPaymentAttemptStarted();
                externalSubmission();
            }
        }
        if (throwAfterSubmit) throw new Error('fixture browser closed');
        return paymentResponse || { success: false, submitted: false, captchaRequired: true, error: '人机验证未完成', dueAmount: 20, dueCurrency: 'USD' };
    });
    const readDue = async () => {
        if (checkoutDueError) throw new Error('fixture checkout read failure');
        return checkoutDue;
    };
    const waitForCheckoutDueAmount = vi.fn(readDue);
    const dependencies = {
        'node:crypto': { randomBytes }, './mysql-store': store, './stripe-payment': { completeStripeCardPayment, readCheckoutDueAmount: readDue, waitForCheckoutDueAmount },
        './pricing-checkout': { ensureChatGptProUsageTier: async () => {} }, './tax-free-address': { pickBillingAddressForCheckout, markAddressBound },
        './region-config': { getRegionConfig: () => ({ currency }) }, './task-safety': { classifyPaymentResult, classifyOpenAiCardMethodFailure },
        './card-validator': { validateCardNumber: () => cardValidation }, './public/grok-plan-catalog': catalog,
        './grok-checkout-state': { grokError }, './grok-billing-address': { assertNativeBillingRegion, normalizeNativeBillingAddress }
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(new URL('../payment-retry.js', import.meta.url), 'utf8'), {
        module, exports: module.exports, require: key => { if (!(key in dependencies)) throw new Error('Unexpected dependency'); return dependencies[key]; },
        process: { env: {} }, console: { log() {}, warn() {} }, Date
    });
    return { store, externalSubmission, completeStripeCardPayment, waitForCheckoutDueAmount, pickBillingAddressForCheckout, markAddressBound, onPaymentState,
        run: () => module.exports.executePaymentWithRetry(page, { ...(native
        ? { platform: 'grok', planType: 'grok_bundle_premium_monthly', grokCheckout: { native: true } }
        : { platform: 'claude', planType: 'claude_pro' }), ownerKey: 'fixture_job', onPaymentState, ...runOptions }) };
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

    it('does not submit or rotate a card when Checkout navigation fails', async () => {
        const page = {
            goto: vi.fn(async () => { throw new Error('offline navigation'); }),
            url: () => '',
            isClosed: () => false
        };
        const fixture = harness({ page, runOptions: {
            platform: 'chatgpt', planType: 'plus', paymentRegion: 'US', paymentCurrency: 'USD',
            checkoutUrl: 'https://checkout.test/cs_live_fixture', fastProtocol: false
        } });

        await expect(fixture.run()).resolves.toMatchObject({
            success: false, code: 'CHECKOUT_NAVIGATION_FAILED', paymentState: 'not_started', canRetryCard: false
        });
        expect(page.goto).toHaveBeenCalledOnce();
        expect(fixture.completeStripeCardPayment).not.toHaveBeenCalled();
        expect(fixture.store.cooldownCard).not.toHaveBeenCalled();
        expect(fixture.store.quarantineCardForReview).not.toHaveBeenCalled();
        expect(fixture.store.releaseCard).toHaveBeenCalledOnce();
    });
    it('passes the verified card region and currency to the payment driver', async () => {
        const fixture = harness({ region: 'PH', currency: 'PHP', started: false,
            checkoutDue: { amount: 1100, currency: 'PHP' },
            runOptions: { platform: 'chatgpt', planType: 'plus', paymentRegion: 'PH', paymentCurrency: 'PHP' } });
        await fixture.run();
        expect(fixture.waitForCheckoutDueAmount).toHaveBeenCalled();
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
        expect(fixture.store.bindCardPaymentProfile).toHaveBeenCalledWith(1, { holderName: 'Fixture', address: usedAddress }, 'payment_fixture_job');
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
        expect(fixture.store.quarantineCardForReview).toHaveBeenCalledWith(1, 'payment_result_unknown', 'payment_fixture_job');
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
        expect(fixture.store.quarantineCardForReview).toHaveBeenCalledWith(1, 'payment_result_unknown', 'payment_fixture_job');
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
        expect(fixture.store.quarantineCardForReview).toHaveBeenCalledWith(1, 'payment_result_unknown', 'payment_fixture_job');
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
        expect(fixture.store.cooldownCard).toHaveBeenCalledWith(1, 30, 'payment_fixture_job');
        expect(fixture.store.quarantineCardForReview).not.toHaveBeenCalled();
        expect(fixture.store.releaseCard).not.toHaveBeenCalled();
    });
    it('cools down an explicitly declined card before billing-record failure and never releases or rotates it', async () => {
        const f = harness({ native: true, failRecord: true, paymentResponse: { success: false, submitted: true,
            declined: true, canRetryCard: true, error: '官方拒付' } });
        await expect(f.run()).rejects.toThrow('fixture record error');
        expect(f.store.cooldownCard).toHaveBeenCalledWith(1, 30, 'payment_fixture_job');
        expect(f.store.cooldownCard.mock.invocationCallOrder[0]).toBeLessThan(f.store.createBillingRecord.mock.invocationCallOrder[0]);
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
    });
    it.each([false, true])('retains a declined card when cooldown persistence fails, including quarantine failure (%s)', async failQuarantine => {
        const f = harness({ native: true, failCooldown: true, failQuarantine, paymentResponse: { success: false, submitted: true,
            declined: true, canRetryCard: true, error: '官方拒付' } });
        await expect(f.run()).rejects.toThrow('fixture');
        expect(f.store.quarantineCardForReview).toHaveBeenCalledWith(1, 'decline_cooldown_failed', 'payment_fixture_job');
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
        expect(f.completeStripeCardPayment).toHaveBeenCalledOnce();
    });
});


describe('round6 card ownership through payment retry', () => {
    const ownerKey = 'payment_fixture_job';
    const success = { success: true, submitted: true, dueAmount: 20, dueCurrency: 'USD' };
    const unknown = { success: false, submitted: true, error: 'offline outcome unconfirmed' };
    const declined = { success: false, submitted: true, declined: true, canRetryCard: true, error: 'offline official decline' };
    const lost = () => Object.assign(new Error('offline ownership lost'), { code: 'CARD_LOCK_OWNERSHIP_LOST' });
    const card = (receipt) => ({ id: 1, card_number: 'offline-fixture-card', card_expiry: '01/30', card_cvc: '000', ...receipt });

    it('uses the same owner for reservation and a confirmed unsubmitted release', async () => {
        const f = harness({ started: false });
        expect(await f.run()).toMatchObject({ success: false, paymentState: 'not_started' });
        expect(f.store.reserveCard).toHaveBeenCalledWith(ownerKey);
        expect(f.store.releaseCard).toHaveBeenCalledExactlyOnceWith(1, ownerKey);
    });
    it('holds the same owner before submission and completes only after success billing', async () => {
        const f = harness({ paymentResponse: success });
        expect(await f.run()).toMatchObject({ success: true });
        expect(f.store.bindCardPaymentProfile).toHaveBeenCalledExactlyOnceWith(1, { holderName: '', address: oregonAddress }, ownerKey);
        expect(f.store.recordCardUsage).toHaveBeenCalledExactlyOnceWith(1, ownerKey);
        expect(f.store.markCardPaymentStarted).toHaveBeenCalledExactlyOnceWith(1, ownerKey);
        expect(f.store.completeCardPayment).toHaveBeenCalledExactlyOnceWith(1, ownerKey);
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.createBillingRecord.mock.invocationCallOrder[0]).toBeLessThan(f.store.completeCardPayment.mock.invocationCallOrder[0]);
    });
    it('passes the owner to unknown-result quarantine without ordinary release or rotation', async () => {
        const f = harness({ paymentResponse: unknown });
        expect(await f.run()).toMatchObject({ paymentState: 'unknown' });
        expect(f.store.quarantineCardForReview).toHaveBeenCalledExactlyOnceWith(1, 'payment_result_unknown', ownerKey);
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
    });
    it('cools down under the owner before looking for another card', async () => {
        const f = harness({ paymentResponse: declined });
        f.store.reserveCard.mockResolvedValueOnce(card()).mockResolvedValueOnce(null);
        expect(await f.run()).toMatchObject({ success: false, cardsDeclined: 1 });
        expect(f.store.cooldownCard).toHaveBeenCalledExactlyOnceWith(1, 30, ownerKey);
        expect(f.store.reserveCard).toHaveBeenNthCalledWith(2, ownerKey);
        expect(f.store.cooldownCard.mock.invocationCallOrder[0]).toBeLessThan(f.store.reserveCard.mock.invocationCallOrder[1]);
        expect(f.store.releaseCard).not.toHaveBeenCalled();
    });
    it.each(['', ' bad', 'bad ', 'a/b', 'a.b', 'x'.repeat(49), null, 7, {}])('rejects invalid explicit owner before reserving or paying (%j)', async suppliedOwner => {
        const f = harness({ runOptions: { ownerKey: suppliedOwner } });
        expect(await f.run()).toMatchObject({ code: 'ASSET_LOCK_OWNER_INVALID', paymentState: 'not_started' });
        expect(f.store.reserveCard).not.toHaveBeenCalled();
        expect(f.completeStripeCardPayment).not.toHaveBeenCalled();
    });
    it('gives independent debug invocations bounded random owners without embedding the CDK', async () => {
        const f = harness({ started: false, runOptions: { ownerKey: undefined, cdkCode: 'OFFLINE-CDK-DO-NOT-EMBED' } });
        await f.run();
        await f.run();
        const owners = f.store.reserveCard.mock.calls.map(([owner]) => owner);
        expect(owners).toHaveLength(2);
        for (const owner of owners) {
            expect(owner).toMatch(/^payment_debug_[a-f0-9]{32}$/);
            expect(owner.length).toBeLessThanOrEqual(64);
            expect(owner).not.toContain('OFFLINE-CDK');
            expect(f.store.releaseCard).toHaveBeenCalledWith(1, owner);
        }
        expect(owners[0]).not.toBe(owners[1]);
    });
    it.each([undefined, null, 'payment_other_job', 'payment_fixture_job ', 'payment_Fixture_job'])('refuses prewarm without an exact matching receipt (%j)', async receipt => {
        const prewarmedPayment = { card: card({ ownerKey: receipt }) };
        const f = harness({ runOptions: { prewarmedPayment } });
        expect(await f.run()).toMatchObject({ code: 'CARD_LOCK_OWNERSHIP_LOST', paymentState: 'not_started' });
        expect(prewarmedPayment.consumed).not.toBe(true);
        expect(f.store.reserveCard).not.toHaveBeenCalled();
        expect(f.completeStripeCardPayment).not.toHaveBeenCalled();
        expect(f.store.releaseCard).not.toHaveBeenCalled();
    });
    it('consumes and releases prewarm only when its receipt matches', async () => {
        const prewarmedPayment = { card: card({ ownerKey }) };
        const f = harness({ started: false, runOptions: { prewarmedPayment } });
        expect(await f.run()).toMatchObject({ paymentState: 'not_started' });
        expect(prewarmedPayment.consumed).toBe(true);
        expect(f.store.reserveCard).not.toHaveBeenCalled();
        expect(f.completeStripeCardPayment).toHaveBeenCalledOnce();
        expect(f.store.releaseCard).toHaveBeenCalledExactlyOnceWith(1, ownerKey);
    });
    it('passes the owner to invalid-card retirement before trying another reservation', async () => {
        const f = harness({ cardValidation: { valid: false, error: 'offline invalid card' } });
        f.store.reserveCard.mockResolvedValueOnce(card()).mockResolvedValueOnce(null);
        await f.run();
        expect(f.store.markCardExhausted).toHaveBeenCalledExactlyOnceWith(1, ownerKey);
        expect(f.store.reserveCard).toHaveBeenNthCalledWith(2, ownerKey);
        expect(f.completeStripeCardPayment).not.toHaveBeenCalled();
    });
    it('stops immediately if invalid-card retirement loses ownership', async () => {
        const f = harness({ cardValidation: { valid: false, error: 'offline invalid card' } });
        f.store.markCardExhausted.mockRejectedValue(lost());
        await expect(f.run()).rejects.toMatchObject({ code: 'CARD_LOCK_OWNERSHIP_LOST' });
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.completeStripeCardPayment).not.toHaveBeenCalled();
    });
    it.each(['bindCardPaymentProfile', 'recordCardUsage', 'completeCardPayment'])('stops success bookkeeping on ownership loss in %s', async action => {
        const f = harness({ paymentResponse: success });
        f.store[action].mockRejectedValue(lost());
        await expect(f.run()).rejects.toMatchObject({ code: 'CARD_LOCK_OWNERSHIP_LOST' });
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
        expect(f.completeStripeCardPayment).toHaveBeenCalledOnce();
        if (action === 'completeCardPayment') expect(f.store.createBillingRecord).toHaveBeenCalledOnce();
        else expect(f.store.createBillingRecord).not.toHaveBeenCalled();
        if (action === 'bindCardPaymentProfile') expect(f.store.recordCardUsage).not.toHaveBeenCalled();
        expect(f.store.releaseCard).not.toHaveBeenCalled();
    });
    it('stops on a zero-row completion after preserving the success billing record', async () => {
        const f = harness({ paymentResponse: success });
        f.store.completeCardPayment.mockResolvedValue(0);
        await expect(f.run()).rejects.toMatchObject({ code: 'CARD_LOCK_OWNERSHIP_LOST' });
        expect(f.store.createBillingRecord).toHaveBeenCalledOnce();
        expect(f.store.completeCardPayment).toHaveBeenCalledOnce();
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
    });
    it('stops a confirmed-unsubmitted zero-row release without trying another card', async () => {
        const f = harness({ started: false });
        f.store.releaseCard.mockResolvedValue(0);
        await expect(f.run()).rejects.toMatchObject({ code: 'CARD_LOCK_OWNERSHIP_LOST' });
        expect(f.store.releaseCard.mock.calls.every(([, actualOwner]) => actualOwner === ownerKey)).toBe(true);
        expect(f.completeStripeCardPayment).toHaveBeenCalledOnce();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
    });
    it('never releases or rotates after unknown-result quarantine loses ownership', async () => {
        const f = harness({ paymentResponse: unknown });
        f.store.quarantineCardForReview.mockRejectedValue(lost());
        await expect(f.run()).rejects.toMatchObject({ code: 'CARD_LOCK_OWNERSHIP_LOST' });
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.createBillingRecord).not.toHaveBeenCalled();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
    });
    it('stops a decline on ownership loss without attempting fallback mutation or rotation', async () => {
        const f = harness({ paymentResponse: declined });
        f.store.cooldownCard.mockRejectedValue(lost());
        await expect(f.run()).rejects.toMatchObject({ code: 'CARD_LOCK_OWNERSHIP_LOST' });
        expect(f.store.quarantineCardForReview).not.toHaveBeenCalled();
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.createBillingRecord).not.toHaveBeenCalled();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
    });
    it.each([
        ['succeeded', success], ['unknown', unknown], ['declined', declined]
    ])('retains the card if the %s result callback fails before bookkeeping', async (state, paymentResponse) => {
        const f = harness({ paymentResponse });
        f.onPaymentState.mockImplementation(async actualState => {
            if (actualState === state) throw new Error('offline result persistence failed');
        });
        await expect(f.run()).rejects.toThrow('offline result persistence failed');
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
        expect(f.store.bindCardPaymentProfile).not.toHaveBeenCalled();
        expect(f.store.recordCardUsage).not.toHaveBeenCalled();
        expect(f.store.createBillingRecord).not.toHaveBeenCalled();
    });
    it.each(['bindCardPaymentProfile', 'recordCardUsage'])('retains a successful payment card when %s persistence fails', async action => {
        const f = harness({ paymentResponse: success });
        f.store[action].mockRejectedValue(new Error('offline write failed'));
        await expect(f.run()).rejects.toThrow('offline write failed');
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
        expect(f.store.createBillingRecord).not.toHaveBeenCalled();
    });
    it('keeps cleanup owner-qualified on an exception before any payment submission', async () => {
        const f = harness({ started: false });
        f.onPaymentState.mockImplementation(async state => {
            if (state === 'not_started') throw new Error('offline pre-submit persistence failed');
        });
        await expect(f.run()).rejects.toThrow('offline pre-submit persistence failed');
        expect(f.store.releaseCard).toHaveBeenCalledExactlyOnceWith(1, ownerKey);
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
    });
});


describe('round7 durable payment hold failures', () => {
    const success = { success: true, submitted: true, dueAmount: 20, dueCurrency: 'USD' };
    it.each(['zero_rows', 'write_error', 'response_lost'])('stops before external submission and retains recovery ownership on %s', async fault => {
        const f = harness({ paymentResponse: success });
        let durableHold = false;
        f.store.markCardPaymentStarted.mockImplementation(async () => {
            if (fault === 'zero_rows') return 0;
            if (fault === 'response_lost') durableHold = true;
            throw new Error('offline hold write/response failure');
        });
        const result = await f.run();
        expect(result).toMatchObject({ success: false, paymentState: 'unknown', manualIntervention: true });
        expect(f.externalSubmission).not.toHaveBeenCalled();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
        expect(f.store.markCardPaymentStarted).toHaveBeenCalledOnce();
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.completeCardPayment).not.toHaveBeenCalled();
        expect(f.store.cooldownCard).not.toHaveBeenCalled();
        expect(f.store.quarantineCardForReview).toHaveBeenCalledOnce();
        expect(durableHold).toBe(fault === 'response_lost');
    });
    it('never submits when started-state persistence fails after the durable hold', async () => {
        const f = harness({ paymentResponse: success });
        f.onPaymentState.mockImplementation(async state => {
            if (state === 'started') throw new Error('offline task persistence failure');
        });
        expect(await f.run()).toMatchObject({ success: false, paymentState: 'unknown' });
        expect(f.store.markCardPaymentStarted).toHaveBeenCalledOnce();
        expect(f.externalSubmission).not.toHaveBeenCalled();
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
    });
    it('rejects a repeated start callback before a second external submission', async () => {
        const f = harness({ startCallbacks: 2, paymentResponse: success });
        expect(await f.run()).toMatchObject({ success: false, paymentState: 'unknown' });
        expect(f.externalSubmission).toHaveBeenCalledOnce();
        expect(f.store.markCardPaymentStarted).toHaveBeenCalledOnce();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.completeCardPayment).not.toHaveBeenCalled();
    });
    it('retains the card if both hold acknowledgement and recovery quarantine fail', async () => {
        const f = harness({ failQuarantine: true });
        f.store.markCardPaymentStarted.mockRejectedValue(new Error('offline acknowledgement lost'));
        await expect(f.run()).rejects.toThrow('fixture quarantine error');
        expect(f.externalSubmission).not.toHaveBeenCalled();
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.cooldownCard).not.toHaveBeenCalled();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
    });
    it.each(['address', 'billing', 'completion'])('does not release or resubmit after a successful charge with %s write failure', async fault => {
        const f = harness({ address: { ...oregonAddress, id: 7 }, paymentResponse: success });
        const target = fault === 'address' ? f.markAddressBound
            : fault === 'billing' ? f.store.createBillingRecord : f.store.completeCardPayment;
        target.mockRejectedValue(new Error('offline bookkeeping failure'));
        await expect(f.run()).rejects.toThrow('offline bookkeeping failure');
        expect(f.externalSubmission).toHaveBeenCalledOnce();
        expect(f.store.reserveCard).toHaveBeenCalledOnce();
        expect(f.store.releaseCard).not.toHaveBeenCalled();
        expect(f.store.cooldownCard).not.toHaveBeenCalled();
        expect(f.store.quarantineCardForReview).not.toHaveBeenCalled();
        if (fault !== 'completion') expect(f.store.completeCardPayment).not.toHaveBeenCalled();
    });
    it('holds through charge and bookkeeping, then completes exactly once', async () => {
        const f = harness({ address: { ...oregonAddress, id: 7 }, paymentResponse: success });
        expect(await f.run()).toMatchObject({ success: true });
        const order = spy => spy.mock.invocationCallOrder[0];
        expect(order(f.store.markCardPaymentStarted)).toBeLessThan(order(f.externalSubmission));
        expect(order(f.externalSubmission)).toBeLessThan(order(f.store.bindCardPaymentProfile));
        expect(order(f.store.bindCardPaymentProfile)).toBeLessThan(order(f.markAddressBound));
        expect(order(f.markAddressBound)).toBeLessThan(order(f.store.recordCardUsage));
        expect(order(f.store.recordCardUsage)).toBeLessThan(order(f.store.createBillingRecord));
        expect(order(f.store.createBillingRecord)).toBeLessThan(order(f.store.completeCardPayment));
        expect(f.store.completeCardPayment).toHaveBeenCalledOnce();
        expect(f.store.releaseCard).not.toHaveBeenCalled();
    });
});
