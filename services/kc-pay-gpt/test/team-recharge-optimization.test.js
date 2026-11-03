import { describe, expect, it } from 'vitest';
const { isCheckoutOrUpgradeUrl } = require('../human-verification');
const { parseAccountCheckResponse } = require('../subscription-check');
const { resolveAccountIdsFromCheckData } = require('../chatgpt-cancel-auto-renew');

describe('ChatGPT Team Recharge & Experience Optimization', () => {
    describe('isCheckoutOrUpgradeUrl recognition', () => {
        it('recognizes standard ChatGPT checkout URLs', () => {
            expect(isCheckoutOrUpgradeUrl('https://chatgpt.com/checkout/openai_llc/oaics_12345')).toBe(true);
        });

        it('recognizes Stripe hosted checkout URLs for ChatGPT Team', () => {
            expect(isCheckoutOrUpgradeUrl('https://pay.openai.com/c/pay/cs_live_a1Y6DUdKvka3mD74IVM1cqYuFRnjhsQ0S2CFwPggqBevoSlpdMsdKuLuHx#fidnandh...')).toBe(true);
            expect(isCheckoutOrUpgradeUrl('https://pay.openai.com/c/pay/cs_test_123')).toBe(true);
        });

        it('recognizes Claude and Grok upgrade/billing URLs', () => {
            expect(isCheckoutOrUpgradeUrl('https://claude.ai/upgrade')).toBe(true);
            expect(isCheckoutOrUpgradeUrl('https://x.com/i/premium_sign_up')).toBe(false);
            expect(isCheckoutOrUpgradeUrl('https://chatgpt.com/billing')).toBe(true);
        });

        it('rejects regular non-checkout pages', () => {
            expect(isCheckoutOrUpgradeUrl('https://chatgpt.com/')).toBe(false);
            expect(isCheckoutOrUpgradeUrl('https://chatgpt.com/c/67890')).toBe(false);
            expect(isCheckoutOrUpgradeUrl('')).toBe(false);
        });
    });

    describe('chatgpt-cancel-auto-renew account resolution for Team variants', () => {
        it('prioritizes workspace team account when planType is team_2, team_5, or chatgpt_team', () => {
            const accData = {
                accounts: {
                    default: {
                        account: { account_id: 'personal-acc-123', plan_type: 'free', structure: 'personal' },
                        entitlement: { has_active_subscription: false }
                    },
                    'workspace-team-uuid': {
                        account: { account_id: 'workspace-team-uuid', plan_type: 'team', structure: 'workspace' },
                        entitlement: { has_active_subscription: true }
                    }
                },
                account_ordering: ['default', 'workspace-team-uuid']
            };

            for (const planType of ['team_2', 'team_5', 'team_10', 'team', 'chatgpt_team']) {
                const candidates = resolveAccountIdsFromCheckData(accData, planType);
                expect(candidates[0]).toBe('workspace-team-uuid');
            }
        });
    });

    describe('subscription-check multi-account resolution for Team', () => {
        it('accurately identifies active Team workspace subscription instead of defaulting to free personal account', () => {
            const accData = {
                accounts: {
                    default: {
                        account: { account_id: 'personal-acc-123', plan_type: 'free', structure: 'personal' },
                        entitlement: { has_active_subscription: false, subscription_plan: 'free' },
                        last_active_subscription: { will_renew: false }
                    },
                    'team-workspace-789': {
                        account: { account_id: 'team-workspace-789', plan_type: 'team', structure: 'workspace' },
                        entitlement: {
                            has_active_subscription: true,
                            subscription_plan: 'chatgptteamplan',
                            expires_at: '2026-11-27T00:00:00Z'
                        },
                        last_active_subscription: {
                            will_renew: true,
                            purchase_origin_platform: 'chatgpt_web',
                            currency: 'PHP'
                        }
                    }
                },
                account_ordering: ['default', 'team-workspace-789']
            };

            const parsed = parseAccountCheckResponse(accData, { email: 'team@example.com' });
            expect(parsed.hasActiveSubscription).toBe(true);
            expect(parsed.planKey).toBe('team');
            expect(parsed.accountId).toBe('team-workspace-789');
            expect(parsed.autoRenew).toBe('是');
            expect(parsed.currency).toBe('PHP');
        });
    });
});
