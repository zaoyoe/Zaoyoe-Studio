'use strict';

import { describe, it, expect, vi } from 'vitest';
const { resolvePlanName, validateCdkPlan } = require('../cdk-plan-catalog');
const { parsePromoCampaigns, parseAccountCheckResponse, queryPromoEligibility } = require('../subscription-check');
const chatgpt = require('../chatgpt');

describe('ChatGPT Team & Promo Campaign Protocol Integration', () => {
    describe('CDK & Catalog Resolution for Team Plan', () => {
        it('resolves team and chatgpt_team to chatgptteamplan', () => {
            expect(resolvePlanName('team')).toBe('chatgptteamplan');
            expect(resolvePlanName('chatgpt_team')).toBe('chatgptteamplan');
            expect(resolvePlanName('team_monthly')).toBe('chatgptteamplan');
            expect(resolvePlanName('team_yearly')).toBe('chatgptteamplan');
        });

        it('validates cdk plan for team under chatgpt platform', () => {
            const plan = validateCdkPlan('team', 'chatgpt');
            expect(plan.platform).toBe('chatgpt');
            expect(plan.planName).toBe('chatgptteamplan');
        });
    });

    describe('ChatGPT Checkout Payload Generation', () => {
        it('builds standard Plus checkout payload without promo', () => {
            // Test through ChatGPTService constructor & createHostedCheckoutLink or exported functions
            const service = new chatgpt.ChatGPTService(null, 'test_token');
            expect(service).toBeDefined();
        });

        it('builds Team checkout payload with team_workspace_purchase_modal and redirect mode', async () => {
            let capturedData = null;
            const mockRequest = {
                post: vi.fn().mockImplementation(async (url, opts) => {
                    capturedData = opts.data;
                    return {
                        status: () => 200,
                        text: async () => JSON.stringify({
                            url: 'https://pay.openai.com/c/pay/cs_live_team_abc123',
                            checkout_session_id: 'cs_live_team_abc123'
                        })
                    };
                })
            };

            const service = new chatgpt.ChatGPTService(mockRequest, 'test_token');
            const res = await service.createCheckoutSession('team', 'US', 'USD', null, {
                workspaceName: 'Acme AI Team',
                seatQuantity: 5,
                priceInterval: 'month'
            });

            expect(res.sessionId).toBe('cs_live_team_abc123');
            expect(res.checkoutUrl).toBe('https://pay.openai.com/c/pay/cs_live_team_abc123');
            expect(capturedData).toMatchObject({
                entry_point: 'team_workspace_purchase_modal',
                plan_name: 'chatgptteamplan',
                checkout_ui_mode: 'redirect',
                check_card_proxy: true,
                team_plan_data: {
                    workspace_name: 'Acme AI Team',
                    price_interval: 'month',
                    seat_quantity: 5
                }
            });
        });

        it('builds Plus checkout payload with promo_campaign injected when promo requested', async () => {
            let capturedData = null;
            const mockRequest = {
                post: vi.fn().mockImplementation(async (url, opts) => {
                    capturedData = opts.data;
                    return {
                        status: () => 200,
                        text: async () => JSON.stringify({
                            url: 'https://chatgpt.com/checkout/openai_llc/oaics_promo_abc123',
                            checkout_session_id: 'oaics_promo_abc123'
                        })
                    };
                })
            };

            const service = new chatgpt.ChatGPTService(mockRequest, 'test_token');
            const res = await service.createCheckoutSession('plus', 'PH', 'PHP', null, {
                promoCampaignId: 'plus-1-month-free'
            });

            expect(res.sessionId).toBe('oaics_promo_abc123');
            expect(capturedData).toMatchObject({
                entry_point: 'all_plans_pricing_modal',
                plan_name: 'chatgptplusplan',
                checkout_ui_mode: 'custom',
                promo_campaign: {
                    promo_campaign_id: 'plus-1-month-free',
                    is_coupon_from_query_param: false
                }
            });
        });
    });

    describe('Promo Campaign Eligibility Parsing', () => {
        it('parses eligible promo campaigns and identifies Plus trial eligibility', () => {
            const rawCheckResponse = {
                accounts: {
                    default: {
                        account: {
                            account_id: 'acc_free_123',
                            has_previously_paid_subscription: false
                        },
                        entitlement: {
                            has_active_subscription: false,
                            subscription_plan: 'chatgptfreeplan'
                        },
                        eligible_promo_campaigns: {
                            plus: {
                                id: 'plus-1-month-free',
                                metadata: {
                                    title: '1 Month Free Plus',
                                    summary: 'Try ChatGPT Plus free for 1 month',
                                    promotion_type_label: 'free_trial',
                                    discount: { percentage: 100 },
                                    duration: { num_periods: 1, period: 'month' }
                                }
                            }
                        }
                    }
                }
            };

            const parsed = parseAccountCheckResponse(rawCheckResponse, { email: 'trial@example.com' });
            expect(parsed.hasActiveSubscription).toBe(false);
            expect(parsed.hasPlusPromo).toBe(true);
            expect(parsed.plusPromoCampaignId).toBe('plus-1-month-free');
            expect(parsed.eligiblePromoCampaigns).toHaveLength(1);
            expect(parsed.eligiblePromoCampaigns[0]).toMatchObject({
                key: 'plus',
                id: 'plus-1-month-free',
                discountPercentage: 100,
                durationNumPeriods: 1,
                durationPeriod: 'month'
            });
        });

        it('does not mark plusPromo as active when account already has active subscription', () => {
            const rawCheckResponse = {
                accounts: {
                    default: {
                        account: {
                            account_id: 'acc_paid_123',
                            has_previously_paid_subscription: true
                        },
                        entitlement: {
                            has_active_subscription: true,
                            subscription_plan: 'chatgptplusplan'
                        },
                        eligible_promo_campaigns: {
                            plus: {
                                id: 'plus-1-month-free',
                                metadata: {}
                            }
                        }
                    }
                }
            };

            const parsed = parseAccountCheckResponse(rawCheckResponse, { email: 'paid@example.com' });
            expect(parsed.hasActiveSubscription).toBe(true);
            expect(parsed.hasPlusPromo).toBe(false);
        });
    });
});
