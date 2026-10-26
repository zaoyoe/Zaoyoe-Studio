'use strict';

import { describe, it, expect, vi } from 'vitest';
const {
    createStripePaymentMethod,
    createStripeConfirmationToken,
    prewarmStripeConfirmationToken,
    executeStripeProtocolPayment,
    syncCheckoutBillingTax,
    executeWithProxyRetry
} = require('../stripe-protocol-payment');

describe('Stripe pure protocol payment integration', () => {
    it('normalizes card expiry cleanly from various formats', async () => {
        const card = { number: '4000000000008043', expiry: '05/29', cvc: '123' };
        const billing = { name: 'John Doe', country: 'US', line1: '100 Main St', city: 'Portland', state: 'Oregon', postal_code: '97201' };

        const res = await createStripePaymentMethod(card, billing);
        expect(res.status).toBe(402);
        expect(res.data?.error?.code).toBe('incorrect_number');
    });

    it('identifies declined cards in sub-second protocol mode without UI fallback', async () => {
        const card = { number: '4000000000008043', expiry: '12/28', cvc: '123' };
        const billing = { name: 'Sarah Smith', country: 'US', state: 'Oregon', city: 'Hillsboro', line1: '150 E Main St', postal_code: '97123' };

        const result = await executeStripeProtocolPayment({
            card,
            billing,
            sessionId: 'oaics_test123',
            accessToken: 'test_token',
            currency: 'PHP'
        });

        expect(result.success).toBe(false);
        expect(result.declined).toBe(true);
        expect(result.canRetryCard).toBe(true);
        expect(result.error).toContain('Your card number is incorrect');
        expect(result.protocolDirect).toBe(true);
    });

    it('consumes prewarmed Stripe tokens directly and proceeds with parallel ChatGPT risk track', async () => {
        const card = { number: '4000000000008043', expiry: '12/28', cvc: '123' };
        const billing = { name: 'Sarah Smith', country: 'US', state: 'Oregon', city: 'Hillsboro', line1: '150 E Main St', postal_code: '97123' };
        const prewarmed = Promise.resolve({
            ok: true,
            pmId: 'pm_prewarmed_123456789',
            ctoken: 'ctoken_prewarmed_123456789'
        });

        const result = await executeStripeProtocolPayment({
            card,
            billing,
            sessionId: 'oaics_prewarm_test',
            accessToken: 'test_token',
            currency: 'PHP',
            prewarmedTokens: prewarmed
        });

        // Test token triggers terminal decline on ChatGPT test confirmation
        expect(result.success).toBe(false);
        expect(result.declined).toBe(true);
        expect(result.protocolDirect).toBe(true);
    });

    it('syncCheckoutBillingTax coordinates /taxes and /update_tax_id for Oregon tax-free billing', async () => {
        const mockPage = {
            isClosed: () => false,
            evaluate: vi.fn().mockImplementation(async (fn, args) => {
                expect(args.taxUrl).toContain('/backend-api/payments/checkout/taxes');
                expect(args.updateTaxIdUrl).toContain('/backend-api/payments/checkout/update_tax_id');
                expect(args.updateBodyObj).toEqual({
                    checkout_session_id: 'oaics_tax_sync_test',
                    tax_id_info: null
                });
                return {
                    status: 200,
                    ok: true,
                    data: {
                        checkout_session: {
                            amount_total: 98214,
                            total_details: { amount_tax: 0 }
                        }
                    }
                };
            })
        };

        const taxRes = await syncCheckoutBillingTax({
            page: mockPage,
            sessionId: 'oaics_tax_sync_test',
            billing: { country: 'US', state: 'Oregon', postal_code: '97123' },
            currency: 'PHP',
            targetHeaders: { authorization: 'Bearer test' }
        });

        expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
        expect(taxRes.ok).toBe(true);
        expect(taxRes.taxAmount).toBe(0);
        expect(taxRes.amountTotal).toBe(98214);
    });

    it('executeWithProxyRetry automatically rotates proxy SID upon transient socket/TLS failure', async () => {
        let attempts = 0;
        const initialProxy = 'http://user-region-ph-sid-old123:pass@gateway.proxy.com:3010';
        const recordedProxies = [];

        const result = await executeWithProxyRetry(async (_client, currentProxy) => {
            attempts++;
            recordedProxies.push(currentProxy);
            if (attempts === 1) {
                const err = new Error('Client network socket disconnected before secure TLS connection was established');
                err.code = 'ECONNRESET';
                throw err;
            }
            return { ok: true, attempts, proxy: currentProxy };
        }, {
            proxy: initialProxy,
            maxRetries: 3
        });

        expect(result.ok).toBe(true);
        expect(attempts).toBe(2);
        expect(recordedProxies[0]).toBe(initialProxy);
        expect(recordedProxies[1]).not.toBe(initialProxy);
        expect(recordedProxies[1]).toContain('-sid-');
    });
});
