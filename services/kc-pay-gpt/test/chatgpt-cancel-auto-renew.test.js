'use strict';

import { describe, it, expect, vi } from 'vitest';
const {
    cancelChatGptAutoRenew,
    cancelChatGptAutoRenewProtocol,
    cancelInsideStripeCustomerPortal,
    resolveAccountIdsFromCheckData,
    inspectSubscriptionState
} = require('../chatgpt-cancel-auto-renew');

describe('ChatGPT Cancel Auto-Renew Module', () => {
    it('returns controlled error when page is invalid', async () => {
        const result = await cancelChatGptAutoRenew(null);
        expect(result).toMatchObject({
            ok: false,
            verificationUnknown: true
        });
        expect(result.error).toContain('缺少可用的 ChatGPT 浏览器页面上下文');
    });

    it('cancels auto-renew via 0-browser pure protocol native API (with webhook sync polling) and never wakes browser', async () => {
        const ensureBrowserPage = vi.fn();
        let subQueryCount = 0;
        const calls = [];

        const mockFetch = vi.fn(async (url, init = {}) => {
            calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });

            if (url.includes('/backend-api/accounts/check/')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        accounts: {
                            'acc-uuid-1234': {
                                account: { account_id: 'acc-uuid-1234', plan_type: 'plus', structure: 'personal' },
                                entitlement: { has_active_subscription: true }
                            }
                        },
                        account_ordering: ['acc-uuid-1234']
                    })
                };
            }

            if (url.includes('/backend-api/subscriptions?account_id=acc-uuid-1234')) {
                subQueryCount += 1;
                if (subQueryCount === 1) {
                    // Simulate Stripe webhook not yet synced (historical expired subscription has will_renew: false)
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            id: 'sub-old',
                            is_active: false,
                            will_renew: false,
                            entitlement: {
                                has_active_subscription: false,
                                expires_at: '2026-05-05T20:03:44+00:00',
                                cancels_at: null
                            }
                        })
                    };
                }
                if (subQueryCount === 2) {
                    // Webhook synced: active subscription with will_renew: true
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            id: 'sub-new',
                            is_active: true,
                            will_renew: true,
                            entitlement: {
                                has_active_subscription: true,
                                subscription_plan: 'chatgptplusplan',
                                expires_at: '2026-11-27T20:00:00+00:00',
                                renews_at: '2026-11-27T20:00:00+00:00',
                                cancels_at: null
                            }
                        })
                    };
                }
                // Post-cancel verification
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        id: 'sub-new',
                        is_active: true,
                        will_renew: false,
                        entitlement: {
                            has_active_subscription: true,
                            subscription_plan: 'chatgptplusplan',
                            expires_at: '2026-11-27T20:00:00+00:00',
                            renews_at: null,
                            cancels_at: '2026-11-27T20:00:00+00:00'
                        }
                    })
                };
            }

            if (url === 'https://chatgpt.com/backend-api/subscriptions/cancel' && init.method === 'POST') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ status: 'canceled', will_renew: false })
                };
            }

            return { ok: false, status: 404, json: async () => ({ detail: 'not found' }) };
        });

        const result = await cancelChatGptAutoRenew(null, {
            accessToken: 'eyJhbGciOiJSUzI1NiJ9.test',
            fetchImpl: mockFetch,
            pollIntervalMs: 50,
            maxPollAttempts: 4,
            ensureBrowserPage
        });

        expect(result.ok).toBe(true);
        expect(result.cancelled).toBe(true);
        expect(result.autoRenewRaw).toBe(false);
        expect(result.accountId).toBe('acc-uuid-1234');
        expect(result.effectiveAt).toBe('2026-11-27T20:00:00+00:00');
        expect(ensureBrowserPage).not.toHaveBeenCalled();

        const cancelCall = calls.find((c) => c.url.endsWith('/backend-api/subscriptions/cancel'));
        expect(cancelCall).toEqual({
            url: 'https://chatgpt.com/backend-api/subscriptions/cancel',
            method: 'POST',
            body: { account_id: 'acc-uuid-1234' }
        });
    });

    it('prioritizes active team workspace account_id when planType is team', () => {
        const accData = {
            accounts: {
                'personal-uuid': {
                    account: { account_id: 'personal-uuid', plan_type: 'free', structure: 'personal' },
                    entitlement: { has_active_subscription: false }
                },
                'team-ws-uuid': {
                    account: { account_id: 'team-ws-uuid', plan_type: 'team', structure: 'workspace' },
                    entitlement: { has_active_subscription: true }
                }
            },
            account_ordering: ['personal-uuid', 'team-ws-uuid']
        };

        const ids = resolveAccountIdsFromCheckData(accData, 'team');
        expect(ids[0]).toBe('team-ws-uuid');
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
