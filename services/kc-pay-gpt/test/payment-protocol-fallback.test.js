'use strict';

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomBytes } from 'node:crypto';
import { classifyPaymentResult, classifyOpenAiCardMethodFailure } from '../task-safety.js';

describe('Payment Protocol Decline UI Fallback', () => {
    function createFixture({
        protoRes = { success: false, declined: true, error: 'Your card was declined.', code: 'card_declined' },
        uiPaymentResult = { success: true, dueAmount: 982.14, dueCurrency: 'PHP' },
        env = {},
        extraOptions = {}, protocolStarted = true, protocolError = null
    } = {}) {
        const store = {
            getPaymentRegion: vi.fn(async () => 'PH'),
            getAppConfigValue: vi.fn(async () => null),
            reserveCard: vi.fn(async () => ({
                id: 1,
                card_number: '5378727144540565',
                card_expiry: '10/28',
                card_cvc: '123'
            })),
            markCardPaymentStarted: vi.fn(async () => 1), completeCardPayment: vi.fn(async () => 1),
            releaseCard: vi.fn(async () => 1),
            cooldownCard: vi.fn(),
            quarantineCardForReview: vi.fn(),
            createBillingRecord: vi.fn(),
            bindCardPaymentProfile: vi.fn(),
            recordCardUsage: vi.fn()
        };

        const mockPage = {
            url: () => 'https://chatgpt.com/',
            isClosed: () => false,
            goto: vi.fn(async () => {}),
            evaluate: vi.fn(async () => null),
            waitForTimeout: vi.fn(async () => {}),
            screenshot: vi.fn(async () => {})
        };

        const executeStripeProtocolPayment = vi.fn(async options => {
            if (protocolStarted) await options.onPaymentAttemptStarted();
            if (protocolError) throw protocolError;
            return protoRes;
        });
        const completeStripeCardPayment = vi.fn(async (_page, _card, _address, options) => {
            await options.onPaymentAttemptStarted();
            return uiPaymentResult;
        });
        const waitForCheckoutDueAmount = vi.fn(async () => ({ amount: 982.14, currency: 'PHP' }));
        const readCheckoutDueAmount = vi.fn(async () => ({ amount: 982.14, currency: 'PHP' }));
        const onProgress = vi.fn();
        const onPaymentState = vi.fn();

        const dependencies = {
            'node:crypto': { randomBytes },
            './mysql-store': store,
            './stripe-payment': {
                completeStripeCardPayment,
                readCheckoutDueAmount,
                waitForCheckoutDueAmount,
                estimateTaxFreeAmount: () => 982.14
            },
            './stripe-protocol-payment': { executeStripeProtocolPayment },
            './pricing-checkout': { ensureChatGptProUsageTier: async () => {} },
            './tax-free-address': {
                pickBillingAddressForCheckout: async () => ({
                    country: 'US',
                    state: 'Oregon',
                    city: 'Portland',
                    line1: '100 Main St',
                    postal_code: '97201'
                }),
                markAddressBound: vi.fn()
            },
            './region-config': { getRegionConfig: () => ({ currency: 'PHP' }) },
            './task-safety': {
                classifyPaymentResult, classifyOpenAiCardMethodFailure
            },
            './card-validator': { validateCardNumber: () => ({ valid: true }) },
            './public/grok-plan-catalog': {},
            './grok-checkout-state': { grokError: (c, m) => new Error(m) },
            './grok-billing-address': {
                assertNativeBillingRegion: () => {},
                normalizeNativeBillingAddress: () => {}
            }
        };

        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(new URL('../payment-retry.js', import.meta.url), 'utf8'), {
            module,
            exports: module.exports,
            require: key => {
                if (!(key in dependencies)) throw new Error(`Unexpected dependency: ${key}`);
                return dependencies[key];
            },
            process: { env: { ...env } },
            console: { log() {}, warn() {}, error() {} },
            Date,
            __dirname: '/tmp'
        });

        return {
            mockPage,
            store,
            executeStripeProtocolPayment,
            completeStripeCardPayment,
            onProgress,
            onPaymentState,
            run: (overrides = {}, initialPage = mockPage) => module.exports.executePaymentWithRetry(initialPage, {
                platform: 'chatgpt',
                planType: 'plus',
                paymentRegion: 'PH',
                paymentCurrency: 'PHP',
                stripeSessionId: 'oaics_test123',
                accessToken: 'test_access_token',
                onProgress,
                onPaymentState,
                ...extraOptions,
                ...overrides
            })
        };
    }

    it.each([
        { env: { FAST_PROTOCOL_ENABLED: 'false' } },
        { env: { FAST_PROTOCOL_ENABLED: '0' } },
        { extraOptions: { fastProtocol: false } }
    ])('uses the original Checkout once in browser confirmation mode: %j', async options => {
        const fixture = createFixture(options);
        const refreshCheckoutSession = vi.fn();
        const result = await fixture.run({ refreshCheckoutSession, checkoutUrl: 'https://chatgpt.com/checkout/openai_llc/oaics_test123' });
        expect(result.success).toBe(true);
        expect(fixture.executeStripeProtocolPayment).not.toHaveBeenCalled();
        expect(refreshCheckoutSession).not.toHaveBeenCalled();
        expect(fixture.mockPage.goto).toHaveBeenCalledTimes(1);
        expect(fixture.mockPage.goto.mock.calls[0][0]).toContain('oaics_test123');
        expect(fixture.completeStripeCardPayment).toHaveBeenCalledTimes(1);
    });

    it('completes pure protocol payment with 0 browser when page is null and protocol succeeds', async () => {
        const ensureBrowserPage = vi.fn();
        const fixture = createFixture({
            protoRes: {
                success: true,
                amount: 982.14,
                currency: 'PHP'
            },
            extraOptions: {
                ensureBrowserPage,
                cookieHeader: '__Secure-next-auth.session-token=test',
                deviceId: 'test-device-id'
            }
        });

        const result = await fixture.run({}, null);

        expect(fixture.executeStripeProtocolPayment).toHaveBeenCalledTimes(1);
        expect(ensureBrowserPage).not.toHaveBeenCalled();
        expect(fixture.completeStripeCardPayment).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
    });

    it('persists one protocol attempt correlation without exposing the raw confirmation token', async () => {
        const rawConfirmationToken = 'ctoken_raw_must_never_leave_protocol_scope';
        const fixture = createFixture({
            protoRes: {
                success: true,
                amount: 982.14,
                currency: 'PHP',
                attemptId: 'attempt_20261028_0001',
                sessionId: 'cs_live_protocol_session_0001',
                paymentIntentId: 'pi_protocol_0001',
                paymentMethodId: 'pm_protocol_0001',
                confirmationTokenHash: 'a'.repeat(64),
                confirmationToken: rawConfirmationToken
            }
        });

        const result = await fixture.run({}, null);
        const record = fixture.store.createBillingRecord.mock.calls[0]?.[0];

        expect(fixture.store.createBillingRecord).toHaveBeenCalledTimes(1);
        expect(record).toMatchObject({
            protocol_attempt_id: 'attempt_20261028_0001',
            stripe_session_id: 'cs_live_protocol_session_0001',
            stripe_payment_intent_id: 'pi_protocol_0001',
            stripe_payment_method_id: 'pm_protocol_0001',
            stripe_confirmation_token_hash: 'a'.repeat(64)
        });
        expect(result).toMatchObject({
            protocol_attempt_id: 'attempt_20261028_0001',
            stripe_session_id: 'cs_live_protocol_session_0001',
            stripe_payment_intent_id: 'pi_protocol_0001',
            stripe_payment_method_id: 'pm_protocol_0001',
            stripe_confirmation_token_hash: 'a'.repeat(64)
        });
        expect(JSON.stringify(record)).not.toContain(rawConfirmationToken);
        expect(JSON.stringify(result)).not.toContain(rawConfirmationToken);
    });

    it('fails fast on card decline without waking up Chromium or falling back to UI', async () => {
        const fixture = createFixture({
            protoRes: {
                success: false,
                declined: true,
                error: 'Your card was declined.',
                code: 'card_declined',
                decline_code: 'generic_decline'
            },
            uiPaymentResult: {
                success: true,
                dueAmount: 982.14,
                dueCurrency: 'PHP'
            }
        });
        const ensureBrowserPage = vi.fn();

        const result = await fixture.run({ ensureBrowserPage }, null);

        // Protocol was attempted across all 3 cards in the pool via pure protocol
        expect(fixture.executeStripeProtocolPayment).toHaveBeenCalledTimes(3);
        // Fail-Fast: Never woke up the browser or called UI payment!
        expect(ensureBrowserPage).not.toHaveBeenCalled();
        expect(fixture.completeStripeCardPayment).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
        expect(result.cardsDeclined).toBe(3);
    });

    it('fails fast even when protocol returns incorrect_number without launching browser', async () => {
        const fixture = createFixture({
            protoRes: {
                success: false,
                declined: true,
                error: 'Your card number is incorrect.',
                code: 'incorrect_number'
            },
            uiPaymentResult: {
                success: true,
                dueAmount: 982.14,
                dueCurrency: 'PHP'
            }
        });
        const ensureBrowserPage = vi.fn();

        const result = await fixture.run({ ensureBrowserPage }, null);

        expect(fixture.executeStripeProtocolPayment).toHaveBeenCalledTimes(3);
        expect(ensureBrowserPage).not.toHaveBeenCalled();
        expect(fixture.completeStripeCardPayment).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
        expect(result.cardsDeclined).toBe(3);
    });

    it('permits UI fallback only when protocol has not entered the submission barrier', async () => {
        const fixture = createFixture({
            protoRes: {
                success: false,
                declined: false,
                fallbackToUi: true,
                requiresAction: true,
                error: '协议预检查不支持当前页面'
            },
            protocolStarted: false,
            uiPaymentResult: {
                success: true,
                dueAmount: 982.14,
                dueCurrency: 'PHP'
            }
        });
        const ensureBrowserPage = vi.fn(async () => fixture.mockPage);
        const refreshCheckoutSession = vi.fn(async () => ({
            sessionId: 'oaics_lazy_clean_999',
            checkoutUrl: 'https://chatgpt.com/checkout/openai_llc/oaics_lazy_clean_999'
        }));

        const result = await fixture.run({
            ensureBrowserPage,
            refreshCheckoutSession,
            cookieHeader: '__Secure-next-auth.session-token=test',
            deviceId: 'test-device-id'
        }, null);

        expect(fixture.executeStripeProtocolPayment).toHaveBeenCalledTimes(1);
        expect(ensureBrowserPage).toHaveBeenCalledTimes(1);
        expect(refreshCheckoutSession).toHaveBeenCalledTimes(1);
        expect(fixture.mockPage.goto).toHaveBeenCalledWith(
            expect.stringContaining('oaics_lazy_clean_999'),
            expect.anything()
        );
        expect(fixture.completeStripeCardPayment).toHaveBeenCalledTimes(1);
        expect(result.success).toBe(true);
    });

    it('respects CHECKOUT_PROTOCOL_DECLINE_FALLBACK=false to disable fallback', async () => {
        const fixture = createFixture({
            protoRes: {
                success: false,
                declined: true,
                error: 'Your card was declined.',
                code: 'card_declined'
            },
            env: { CHECKOUT_PROTOCOL_DECLINE_FALLBACK: 'false' }
        });

        const result = await fixture.run();

        expect(fixture.executeStripeProtocolPayment).toHaveBeenCalled();
        expect(fixture.completeStripeCardPayment).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
    });

    it('completely skips protocol payment when FAST_PROTOCOL_ENABLED=false and directly uses UI checkout', async () => {
        const fixture = createFixture({
            uiPaymentResult: {
                success: true,
                dueAmount: 982.14,
                dueCurrency: 'PHP'
            },
            env: { FAST_PROTOCOL_ENABLED: 'false' }
        });

        const result = await fixture.run();

        // Protocol payment was never called!
        expect(fixture.executeStripeProtocolPayment).not.toHaveBeenCalled();
        // Browser smoothly navigated directly to the checkout page
        expect(fixture.mockPage.goto).toHaveBeenCalledWith(
            expect.stringContaining('oaics_test123'),
            expect.anything()
        );
        // UI card payment completed directly
        expect(fixture.completeStripeCardPayment).toHaveBeenCalledTimes(1);
        expect(result.success).toBe(true);
    });

    it('completely skips protocol payment when options.fastProtocol is false and directly uses UI checkout', async () => {
        const fixture = createFixture({
            uiPaymentResult: {
                success: true,
                dueAmount: 982.14,
                dueCurrency: 'PHP'
            },
            extraOptions: { fastProtocol: false }
        });

        const result = await fixture.run();

        expect(fixture.executeStripeProtocolPayment).not.toHaveBeenCalled();
        expect(fixture.mockPage.goto).toHaveBeenCalledWith(
            expect.stringContaining('oaics_test123'),
            expect.anything()
        );
        expect(fixture.completeStripeCardPayment).toHaveBeenCalledTimes(1);
        expect(result.success).toBe(true);
    });

    it('fails fast on card decline without calling refreshCheckoutSession or navigating to burned session', async () => {
        const refreshCheckoutSession = vi.fn(async () => null);
        const ensureBrowserPage = vi.fn();
        const fixture = createFixture({
            protoRes: {
                success: false,
                declined: true,
                error: 'Your card was declined.',
                code: 'card_declined',
                decline_code: 'generic_decline'
            },
            extraOptions: {
                refreshCheckoutSession,
                ensureBrowserPage
            }
        });
        ensureBrowserPage.mockResolvedValue(fixture.mockPage);

        const result = await fixture.run({}, null);

        expect(fixture.executeStripeProtocolPayment).toHaveBeenCalledTimes(3);
        // Fail-Fast: Does NOT call refreshCheckoutSession because it doesn't fall back to browser!
        expect(refreshCheckoutSession).not.toHaveBeenCalled();
        expect(fixture.mockPage.goto).not.toHaveBeenCalled();
        expect(fixture.completeStripeCardPayment).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
    });
    it.each([
        { success: false, fallbackToUi: true, submitted: false, error: 'offline unsupported response' },
        { success: false, requiresAction: true, fallbackToUi: true, submitted: true, code: 'PAYMENT_REQUIRES_ACTION' },
        { success: false, submitted: false, captchaRequired: true, error: 'captcha required' }
    ])('never opens UI or rotates after the durable hold: %j', async protoRes => {
        const fixture = createFixture({ protoRes });
        const ensureBrowserPage = vi.fn();
        const refreshCheckoutSession = vi.fn();
        expect(await fixture.run({ ensureBrowserPage, refreshCheckoutSession })).toMatchObject({ success: false, paymentState: 'unknown' });
        expect(fixture.executeStripeProtocolPayment).toHaveBeenCalledOnce();
        expect(fixture.completeStripeCardPayment).not.toHaveBeenCalled();
        expect(ensureBrowserPage).not.toHaveBeenCalled();
        expect(refreshCheckoutSession).not.toHaveBeenCalled();
        expect(fixture.store.reserveCard).toHaveBeenCalledOnce();
        expect(fixture.store.releaseCard).not.toHaveBeenCalled();
        expect(fixture.store.cooldownCard).not.toHaveBeenCalled();
    });
    it('never falls back after the protocol throws after payment protection', async () => {
        const fixture = createFixture({ protocolError: new Error('offline socket response lost') });
        expect(await fixture.run()).toMatchObject({ success: false, paymentState: 'unknown' });
        expect(fixture.completeStripeCardPayment).not.toHaveBeenCalled();
        expect(fixture.store.markCardPaymentStarted).toHaveBeenCalledOnce();
        expect(fixture.store.reserveCard).toHaveBeenCalledOnce();
        expect(fixture.store.releaseCard).not.toHaveBeenCalled();
    });
    it('permits one UI attempt when the protocol throws before protection', async () => {
        const fixture = createFixture({ protocolStarted: false, protocolError: new Error('offline preflight failure') });
        expect(await fixture.run()).toMatchObject({ success: true });
        expect(fixture.completeStripeCardPayment).toHaveBeenCalledOnce();
        expect(fixture.store.markCardPaymentStarted).toHaveBeenCalledOnce();
        expect(fixture.store.completeCardPayment).toHaveBeenCalledOnce();
        expect(fixture.store.reserveCard).toHaveBeenCalledOnce();
    });
    it('stops protocol and UI when the durable hold cannot be acknowledged', async () => {
        const fixture = createFixture();
        fixture.store.markCardPaymentStarted.mockRejectedValue(new Error('offline hold acknowledgement lost'));
        expect(await fixture.run()).toMatchObject({ success: false, paymentState: 'unknown' });
        expect(fixture.completeStripeCardPayment).not.toHaveBeenCalled();
        expect(fixture.store.reserveCard).toHaveBeenCalledOnce();
        expect(fixture.store.releaseCard).not.toHaveBeenCalled();
        expect(fixture.store.cooldownCard).not.toHaveBeenCalled();
    });

});
