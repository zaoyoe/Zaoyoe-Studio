import { describe, expect, it, vi } from 'vitest';
import { waitForCheckoutDueAmount } from '../stripe-payment.js';

describe('checkout due amount readiness', () => {
    it('waits for the checkout summary to replace its loading state', async () => {
        const snapshots = ['Getting your plan ready', 'Due today $20.00'];
        const page = {
            textContent: vi.fn(async () => snapshots.shift() || 'Due today $20.00'),
            waitForTimeout: vi.fn(async () => {}),
            isClosed: () => false
        };

        await expect(waitForCheckoutDueAmount(page, { timeoutMs: 5000, pollIntervalMs: 0 }))
            .resolves.toEqual({ amount: 20, currency: 'USD' });
        expect(page.textContent).toHaveBeenCalledTimes(2);
        expect(page.waitForTimeout).toHaveBeenCalledOnce();
    });

    it('returns unconfirmed at the deadline instead of guessing a price', async () => {
        const page = {
            textContent: vi.fn(async () => 'Getting your plan ready'),
            waitForTimeout: vi.fn(async () => {}),
            isClosed: () => false
        };

        await expect(waitForCheckoutDueAmount(page, { timeoutMs: 0 })).resolves.toBeNull();
        expect(page.textContent).toHaveBeenCalledOnce();
    });
});
