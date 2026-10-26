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

        it('resolves activation input correctly for team CDK', () => {
            const { resolveActivationInput } = require('../activation-routing');
            const cdkDetails = {
                cdk_code: 'KC-TEAM12345',
                plan_type: 'team',
                platform: 'chatgpt'
            };
            const res = resolveActivationInput({
                cdkDetails,
                rawSession: 'fake_token.payload.signature',
                validateChatGpt: () => ({ token: 'mock_token', storedSession: 'mock_session' })
            });
            expect(res.platform).toBe('chatgpt');
            expect(res.planType).toBe('team');
            expect(res.planName).toBe('chatgptteamplan');
        });

        it('returns proper plan labels from getPlanTypeLabel', () => {
            const { getPlanTypeLabel } = require('../region-config');
            expect(getPlanTypeLabel('team')).toBe('ChatGPT Team');
            expect(getPlanTypeLabel('chatgpt_team')).toBe('ChatGPT Team');
            expect(getPlanTypeLabel('team_2')).toBe('ChatGPT Team (2席)');
            expect(getPlanTypeLabel('team_5')).toBe('ChatGPT Team (5席)');
            expect(getPlanTypeLabel('team_10')).toBe('ChatGPT Team (10席)');
            expect(getPlanTypeLabel('team_20')).toBe('ChatGPT Team (20席)');
            expect(getPlanTypeLabel('team_8')).toBe('ChatGPT Team (8席)');
        });

        it('resolves team seat sub-options and custom seats in catalog and validation', () => {
            const { parseTeamSeats } = require('../cdk-plan-catalog');
            const { PLATFORM_CONFIG } = require('../region-config');

            expect(parseTeamSeats('team')).toBe(2);
            expect(parseTeamSeats('team_2')).toBe(2);
            expect(parseTeamSeats('team_5')).toBe(5);
            expect(parseTeamSeats('team_10')).toBe(10);
            expect(parseTeamSeats('team_20')).toBe(20);
            expect(parseTeamSeats('team_8')).toBe(8);
            expect(parseTeamSeats('plus')).toBeNull();

            // Preset pricing verification ($30/seat)
            expect(PLATFORM_CONFIG.chatgpt.plans.team_2.amount).toBe(60.00);
            expect(PLATFORM_CONFIG.chatgpt.plans.team_5.amount).toBe(150.00);
            expect(PLATFORM_CONFIG.chatgpt.plans.team_10.amount).toBe(300.00);
            expect(PLATFORM_CONFIG.chatgpt.plans.team_20.amount).toBe(600.00);

            // Validation with seat quantity mapping
            const v2 = validateCdkPlan('team_2', 'chatgpt');
            expect(v2.planName).toBe('chatgptteamplan');
            expect(v2.seatQuantity).toBe(2);

            const v5 = validateCdkPlan('team_5', 'chatgpt');
            expect(v5.planName).toBe('chatgptteamplan');
            expect(v5.seatQuantity).toBe(5);

            const vCustom = validateCdkPlan('team_15', 'chatgpt');
            expect(vCustom.planName).toBe('chatgptteamplan');
            expect(vCustom.seatQuantity).toBe(15);
        });
    });

    describe('ChatGPT Checkout Payload Generation', () => {
        it('builds standard Plus checkout payload without promo', () => {
            // Test through ChatGPTService constructor & createHostedCheckoutLink or exported functions
            const service = new chatgpt.ChatGPTService(null, 'test_token');
            expect(service).toBeDefined();
        });

        it('builds Team checkout payload with seats dynamically parsed from planType', () => {
            const p2 = chatgpt.buildCheckoutPayload('chatgptteamplan', 'US', 'USD', { planType: 'team_2' });
            expect(p2.team_plan_data.seat_quantity).toBe(2);

            const p5 = chatgpt.buildCheckoutPayload('chatgptteamplan', 'US', 'USD', { planType: 'team_5' });
            expect(p5.team_plan_data.seat_quantity).toBe(5);

            const p10 = chatgpt.buildCheckoutPayload('chatgptteamplan', 'US', 'USD', { planType: 'team_10' });
            expect(p10.team_plan_data.seat_quantity).toBe(10);

            const p20 = chatgpt.buildCheckoutPayload('chatgptteamplan', 'US', 'USD', { planType: 'team_20' });
            expect(p20.team_plan_data.seat_quantity).toBe(20);

            const pCustom = chatgpt.buildCheckoutPayload('chatgptteamplan', 'US', 'USD', { planType: 'team_8' });
            expect(pCustom.team_plan_data.seat_quantity).toBe(8);

            const pDefault = chatgpt.buildCheckoutPayload('chatgptteamplan', 'US', 'USD', { planType: 'team' });
            expect(pDefault.team_plan_data.seat_quantity).toBe(2);

            const pExplicitOverride = chatgpt.buildCheckoutPayload('chatgptteamplan', 'US', 'USD', { planType: 'team_2', seatQuantity: 12 });
            expect(pExplicitOverride.team_plan_data.seat_quantity).toBe(12);
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
