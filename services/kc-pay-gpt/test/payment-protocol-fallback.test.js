'use strict';

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

describe('Payment Protocol Decline UI Fallback', () => {
    function createFixture({
        protoRes = { success: false, declined: true, error: 'Your card was declined.', code: 'card_declined' },
        uiPaymentResult = { success: true, dueAmount: 982.14, dueCurrency: 'PHP' },
        env = {},
        extraOptions = {}
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
            releaseCard: vi.fn(),
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

        const executeStripeProtocolPayment = vi.fn(async () => protoRes);
        const completeStripeCardPayment = vi.fn(async () => uiPaymentResult);
        const waitForCheckoutDueAmount = vi.fn(async () => ({ amount: 982.14, currency: 'PHP' }));
        const readCheckoutDueAmount = vi.fn(async () => ({ amount: 982.14, currency: 'PHP' }));
        const onProgress = vi.fn();
        const onPaymentState = vi.fn();

        const dependencies = {
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
                classifyPaymentResult: () => ({ kind: 'success', category: 'paid' }),
                classifyOpenAiCardMethodFailure: () => null
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

    it('lazily wakes up browser and UI only when protocol explicitly requests fallbackToUi (e.g. 3DS required)', async () => {
        const fixture = createFixture({
            protoRes: {
                success: false,
                declined: false,
                fallbackToUi: true,
                requiresAction: true,
                error: '银行卡需要 3DS 验证，平滑切入收银台 UI'
            },
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
});
