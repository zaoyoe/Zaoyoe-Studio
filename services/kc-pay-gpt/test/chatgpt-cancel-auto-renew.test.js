'use strict';

import { describe, it, expect, vi } from 'vitest';
const { cancelChatGptAutoRenew, cancelInsideStripeCustomerPortal } = require('../chatgpt-cancel-auto-renew');

describe('ChatGPT Cancel Auto-Renew Module', () => {
    it('returns controlled error when page is invalid', async () => {
        const result = await cancelChatGptAutoRenew(null);
        expect(result).toMatchObject({
            ok: false,
            verificationUnknown: true
        });
        expect(result.error).toContain('缺少可用的 ChatGPT 浏览器页面上下文');
    });

    it('cancels auto-renew successfully via ChatGPT Web API', async () => {
        const mockPage = {
            evaluate: vi.fn().mockImplementation(async (fn, args) => {
                return {
                    ok: true,
                    cancelled: true,
                    message: '已成功关闭次月自动续订，本周期内 Plus 权益继续有效'
                };
            })
        };

        const result = await cancelChatGptAutoRenew(mockPage);

        expect(result.ok).toBe(true);
        expect(result.cancelled).toBe(true);
        expect(result.autoRenewRaw).toBe(false);
        expect(result.message).toContain('已成功关闭次月自动续订');
    });

    it('handles idempotent already-cancelled response correctly', async () => {
        const mockPage = {
            evaluate: vi.fn().mockResolvedValue({
                ok: true,
                alreadyCancelled: true,
                message: '自动续费先前已关闭，下月不会自动扣款'
            })
        };

        const result = await cancelChatGptAutoRenew(mockPage);

        expect(result.ok).toBe(true);
        expect(result.alreadyCancelled).toBe(true);
        expect(result.autoRenewRaw).toBe(false);
    });

    it('navigates to Stripe Customer Portal when API returns portalUrl and confirms cancellation', async () => {
        let isFirstStep = true;
        const mockPage = {
            url: () => 'https://chatgpt.com',
            goto: vi.fn().mockResolvedValue(null),
            waitForTimeout: vi.fn().mockResolvedValue(null),
            evaluate: vi.fn().mockResolvedValue({
                ok: true,
                portalUrl: 'https://billing.stripe.com/p/session/bps_test_123456'
            }),
            content: vi.fn().mockResolvedValue('<div>Stripe Customer Portal: Plan details</div>'),
            textContent: vi.fn().mockImplementation(async (selector) => {
                if (isFirstStep) {
                    return 'ChatGPT Plus $20/month';
                }
                return 'Your plan will be canceled on November 26, 2026.';
            }),
            locator: vi.fn().mockImplementation((sel) => ({
                first: () => ({
                    isVisible: vi.fn().mockResolvedValue(true),
                    click: vi.fn().mockImplementation(async () => {
                        isFirstStep = false;
                    })
                })
            })),
            getByRole: vi.fn().mockImplementation(() => ({
                first: () => ({
                    isVisible: vi.fn().mockResolvedValue(false),
                    click: vi.fn().mockResolvedValue(null)
                })
            }))
        };

        const result = await cancelChatGptAutoRenew(mockPage);

        expect(mockPage.goto).toHaveBeenCalledWith('https://billing.stripe.com/p/session/bps_test_123456', expect.any(Object));
        expect(result.ok).toBe(true);
        expect(result.cancelled).toBe(true);
        expect(result.message).toContain('已成功在 Stripe 账单中心关闭次月自动续订');
    });

    it('detects already cancelled state inside Stripe Customer Portal', async () => {
        const mockPage = {
            url: () => 'https://chatgpt.com',
            goto: vi.fn().mockResolvedValue(null),
            waitForTimeout: vi.fn().mockResolvedValue(null),
            evaluate: vi.fn().mockResolvedValue({
                ok: true,
                portalUrl: 'https://billing.stripe.com/p/session/bps_test_already_cancelled'
            }),
            content: vi.fn().mockResolvedValue('<div>Plan cancels on Nov 26, 2026. Renew plan</div>'),
            textContent: vi.fn().mockResolvedValue('Plan cancels on Nov 26, 2026. Renew plan')
        };

        const result = await cancelChatGptAutoRenew(mockPage);

        expect(result.ok).toBe(true);
        expect(result.alreadyCancelled).toBe(true);
        expect(result.message).toContain('Stripe 账单中心显示');
    });

    it('falls back to page UI when API cannot cancel directly', async () => {
        const mockPage = {
            url: () => 'https://chatgpt.com',
            content: vi.fn().mockResolvedValue('<div>Manage subscription: Cancel plan</div>'),
            goto: vi.fn().mockResolvedValue(null),
            waitForTimeout: vi.fn().mockResolvedValue(null),
            evaluate: vi.fn().mockResolvedValue({
                ok: false,
                canFallbackUi: true
            }),
            getByRole: vi.fn().mockImplementation((role, { name }) => ({
                first: () => ({
                    isVisible: vi.fn().mockResolvedValue(true),
                    click: vi.fn().mockResolvedValue(null)
                })
            }))
        };

        const result = await cancelChatGptAutoRenew(mockPage);
        expect(result.ok).toBe(true);
        expect(result.cancelled).toBe(true);
    });

    it('handles popup navigation when Manage my subscription button is clicked in UI fallback', async () => {
        let popupFirstStep = true;
        const mockPopup = {
            url: () => 'https://billing.stripe.com/p/session/bps_popup_789',
            goto: vi.fn().mockResolvedValue(null),
            waitForTimeout: vi.fn().mockResolvedValue(null),
            content: vi.fn().mockResolvedValue('<div>Stripe Portal: Active Subscription</div>'),
            textContent: vi.fn().mockImplementation(async () => {
                if (popupFirstStep) return 'ChatGPT Plus Active. Cancel plan available.';
                return 'Cancellation scheduled: will be canceled on Dec 1';
            }),
            locator: vi.fn().mockImplementation(() => ({
                first: () => ({
                    isVisible: vi.fn().mockResolvedValue(true),
                    click: vi.fn().mockImplementation(async () => {
                        popupFirstStep = false;
                    })
                })
            }))
        };

        const mockPage = {
            url: () => 'https://chatgpt.com/#settings',
            content: vi.fn().mockResolvedValue('<div>Settings: Manage my subscription</div>'),
            goto: vi.fn().mockResolvedValue(null),
            waitForTimeout: vi.fn().mockResolvedValue(null),
            waitForEvent: vi.fn().mockResolvedValue(mockPopup),
            evaluate: vi.fn().mockResolvedValue({
                ok: false,
                canFallbackUi: true
            }),
            getByRole: vi.fn().mockImplementation((role, { name }) => ({
                first: () => ({
                    isVisible: vi.fn().mockImplementation(async () => {
                        // Return false for Cancel plan so it tests Manage my subscription
                        if (name.toString().includes('Cancel plan')) return false;
                        return true;
                    }),
                    click: vi.fn().mockResolvedValue(null)
                })
            }))
        };

        const result = await cancelChatGptAutoRenew(mockPage);
        expect(result.ok).toBe(true);
        expect(result.cancelled).toBe(true);
    });
});
