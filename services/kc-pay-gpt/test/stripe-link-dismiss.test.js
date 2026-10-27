'use strict';

import { describe, it, expect } from 'vitest';
import { chromium } from 'playwright';
import { dismissStripeLinkVerification, isBillingAddressLocked } from '../stripe-payment.js';

describe('dismissStripeLinkVerification', () => {
    it('detects and clicks "Pay without Link" button to bypass Stripe Link challenge', async () => {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
            <html>
                <body>
                    <div class="stripe-link-modal">
                        <h2>Confirm it's you</h2>
                        <p>Before we email you a code, we need to verify your phone number.</p>
                        <input type="tel" value="" placeholder="(201) 555-0123" />
                        <button type="button">Verify</button>
                        <button type="button" id="pay-no-link">Pay without Link</button>
                    </div>
                </body>
            </html>
        `);

        let clicked = false;
        await page.locator('#pay-no-link').evaluate(el => {
            el.addEventListener('click', () => {
                window.__linkClicked = true;
            });
        });

        const dismissed = await dismissStripeLinkVerification(page);
        expect(dismissed).toBe(true);

        const wasClicked = await page.evaluate(() => window.__linkClicked);
        expect(wasClicked).toBe(true);

        await browser.close();
    });

    it('returns false when Stripe Link modal is not present', async () => {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
            <html>
                <body>
                    <div class="standard-checkout">
                        <input type="text" placeholder="Card number" />
                    </div>
                </body>
            </html>
        `);

        const dismissed = await dismissStripeLinkVerification(page);
        expect(dismissed).toBe(false);

        await browser.close();
    });
});

describe('isBillingAddressLocked', () => {
    it('detects locked address notice on Stripe hosted checkout', async () => {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
            <html>
                <body>
                    <div class="billing-address-section">
                        <p class="notice">To change your billing address, leave this page and restart checkout.</p>
                        <input id="billingAddressLine1" disabled value="4755 SW Griffith Dr" />
                        <input id="billingPostalCode" disabled value="97005" />
                    </div>
                </body>
            </html>
        `);

        const isLocked = await isBillingAddressLocked(page);
        expect(isLocked).toBe(true);

        await browser.close();
    });

    it('returns false when billing address is editable', async () => {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.setContent(`
            <html>
                <body>
                    <div class="billing-address-section">
                        <input id="billingAddressLine1" value="" />
                        <input id="billingPostalCode" value="" />
                    </div>
                </body>
            </html>
        `);

        const isLocked = await isBillingAddressLocked(page);
        expect(isLocked).toBe(false);

        await browser.close();
    });
});
