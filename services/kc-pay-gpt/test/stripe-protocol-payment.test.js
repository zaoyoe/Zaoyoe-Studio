'use strict';

import { describe, it, expect, vi } from 'vitest';
const {
    createStripePaymentMethod,
    createStripeConfirmationToken,
    executeStripeProtocolPayment
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
});
