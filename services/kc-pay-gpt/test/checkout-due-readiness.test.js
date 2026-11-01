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

    it.each([
        ['closed page', { textContent: vi.fn(), isClosed: () => true }, 'CHECKOUT_PAGE_CLOSED'],
        ['Chrome error page', { textContent: vi.fn(), isClosed: () => false, url: () => 'chrome-error://chromewebdata/' }, 'CHECKOUT_NAVIGATION_FAILED'],
        ['network error page', {
            evaluate: vi.fn(async () => 'This site can\'t be reached'),
            textContent: vi.fn(), isClosed: () => false, url: () => 'https://checkout.test/offline'
        }, 'CHECKOUT_NAVIGATION_FAILED'],
        ['unavailable page', {}, 'CHECKOUT_PAGE_UNAVAILABLE']
    ])('fails closed for %s before payment submission', async (_label, page, code) => {
        await expect(waitForCheckoutDueAmount(page, { timeoutMs: 0, pollIntervalMs: 0, throwOnTimeout: true }))
            .rejects.toMatchObject({ code, submitted: false, submissionAttempted: false, paymentState: 'not_started' });
    });

    it('reports a render timeout as an unsubmitted payment when requested', async () => {
        const page = {
            textContent: vi.fn(async () => 'Getting your plan ready'),
            waitForTimeout: vi.fn(async () => {}),
            isClosed: () => false
        };

        await expect(waitForCheckoutDueAmount(page, { timeoutMs: 0, throwOnTimeout: true }))
            .rejects.toMatchObject({ code: 'CHECKOUT_RENDER_TIMEOUT', submitted: false, paymentState: 'not_started' });
    });

    it('automatically clicks Retry button when official page displays "The payment form took too long to load"', async () => {
        let retryClicked = false;
        let showTimeoutBanner = true;
        const page = {
            textContent: vi.fn(async () => {
                if (retryClicked) return 'Due today $20.00';
                return 'The payment form took too long to load. Please try again.';
            }),
            evaluate: vi.fn(async (fn) => {
                const src = String(fn);
                if (src.includes('The payment form took too long to load')) {
                    if (showTimeoutBanner) {
                        retryClicked = true;
                        showTimeoutBanner = false;
                        return 'clicked';
                    }
                    return null;
                }
                if (src.includes('There was an error processing your payment')) {
                    return null;
                }
                return showTimeoutBanner ? 'The payment form took too long to load. Please try again.' : 'Due today $20.00';
            }),
            waitForTimeout: vi.fn(async () => {}),
            isClosed: () => false
        };

        const result = await waitForCheckoutDueAmount(page, { timeoutMs: 5000, pollIntervalMs: 0 });
        expect(result).toEqual({ amount: 20, currency: 'USD' });
        expect(retryClicked).toBe(true);
        expect(page.waitForTimeout).toHaveBeenCalledWith(1500);
    });
});
