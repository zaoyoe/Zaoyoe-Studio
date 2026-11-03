'use strict';

import { describe, it, expect } from 'vitest';
const {
    STRIPE_DECLINE_CODE_MAP,
    OPENAI_DECLINE_CODE_MAP,
    CLAUDE_REJECTION_REASONS,
    GROK_DECLINE_CODE_MAP,
    ALL_EXPLICIT_STRIPE_DECLINE_CODES,
    formatStripeDeclineReason,
    formatClaudeDeclineReason,
    formatGrokDeclineReason
} = require('../payment-decline-dictionary');

describe('Payment Decline Dictionary & Code Mapping', () => {
    describe('Stripe & OpenAI mappings', () => {
        it('maps essential Stripe decline codes to descriptive bilingual Chinese text', () => {
            expect(STRIPE_DECLINE_CODE_MAP.insufficient_funds).toContain('卡内余额不足');
            expect(STRIPE_DECLINE_CODE_MAP.card_declined).toContain('发卡行拒绝交易');
            expect(STRIPE_DECLINE_CODE_MAP.incorrect_number).toContain('卡号不正确');
            expect(STRIPE_DECLINE_CODE_MAP.incorrect_cvc).toContain('安全码(CVC)错误');
            expect(STRIPE_DECLINE_CODE_MAP.expired_card).toContain('卡片已过期');
            expect(STRIPE_DECLINE_CODE_MAP.lost_card).toContain('挂失/遗失卡');
            expect(STRIPE_DECLINE_CODE_MAP.stolen_card).toContain('盗刷卡');
            expect(STRIPE_DECLINE_CODE_MAP.card_not_supported).toContain('不支持该卡片类型');
            expect(STRIPE_DECLINE_CODE_MAP.fraudulent).toContain('高风险欺诈拦截');
            expect(STRIPE_DECLINE_CODE_MAP.processing_error).toContain('发卡行系统处理异常');
        });

        it('maps OpenAI specific checkout codes', () => {
            expect(OPENAI_DECLINE_CODE_MAP.purchase_not_allowed).toContain('商户风控拦截无法完成购买');
            expect(OPENAI_DECLINE_CODE_MAP.country_not_supported).toContain('不支持当前国家或地区');
            expect(OPENAI_DECLINE_CODE_MAP.account_deactivated).toContain('OpenAI 账号已被封禁或停用');
        });

        it('includes all mapped codes in the explicit decline set', () => {
            expect(ALL_EXPLICIT_STRIPE_DECLINE_CODES.has('insufficient_funds')).toBe(true);
            expect(ALL_EXPLICIT_STRIPE_DECLINE_CODES.has('card_not_supported')).toBe(true);
            expect(ALL_EXPLICIT_STRIPE_DECLINE_CODES.has('purchase_not_allowed')).toBe(true);
            expect(ALL_EXPLICIT_STRIPE_DECLINE_CODES.has('fraudulent')).toBe(true);
        });

        it('formats Stripe decline reason preferring declineCode over top-level code', () => {
            const res = formatStripeDeclineReason({
                code: 'card_declined',
                declineCode: 'insufficient_funds',
                rawMessage: 'Your card has insufficient funds.'
            });
            expect(res.formatted).toBe('卡内余额不足 (insufficient funds) [insufficient_funds]');
            expect(res.declineCode).toBe('insufficient_funds');
        });

        it('formats Stripe decline reason fallback using top-level code when declineCode is empty', () => {
            const res = formatStripeDeclineReason({
                code: 'purchase_not_allowed',
                rawMessage: 'This purchase is not allowed.'
            });
            expect(res.formatted).toBe('商户风控拦截无法完成购买 (purchase not allowed / OpenAI风控) [purchase_not_allowed]');
        });

        it('formats Stripe decline reason fallback using English rawMessage pattern match', () => {
            const res = formatStripeDeclineReason({
                rawMessage: 'Your card has insufficient funds.'
            });
            expect(res.formatted).toContain('卡内余额不足 (insufficient funds)');
        });
    });

    describe('Claude / Anthropic mappings', () => {
        it('maps Claude incident purchase failure string', () => {
            const res = formatClaudeDeclineReason('This purchase cannot be completed.');
            expect(res).toBe('商户风控拦截无法完成购买 (purchase not allowed / Anthropic风控) [purchase_not_allowed]');
        });

        it('maps Claude insufficient funds text', () => {
            const res = formatClaudeDeclineReason('Your card has insufficient funds.');
            expect(res).toBe('卡内余额不足 (insufficient funds) [insufficient_funds]');
        });

        it('maps Claude incorrect card number text', () => {
            const res = formatClaudeDeclineReason('Your card number is incorrect.');
            expect(res).toBe('卡号无效或不正确 (incorrect card number) [incorrect_number]');
        });

        it('maps Claude rejection reasons from Anthropic API', () => {
            expect(formatClaudeDeclineReason('', 'purchase_not_allowed')).toContain('商户风控拦截无法完成购买');
            expect(formatClaudeDeclineReason('', 'country_mismatch')).toContain('账单国家与卡片注册国不符');
            expect(formatClaudeDeclineReason('', 'kyc_required')).toContain('需要进行KYC身份核验');
        });
    });

    describe('Grok Commerce mappings', () => {
        it('maps Grok DECLINE_REASON codes', () => {
            expect(formatGrokDeclineReason('DECLINE_REASON_INSUFFICIENT_FUNDS')).toContain('余额不足');
            expect(formatGrokDeclineReason('DECLINE_REASON_LIMIT_EXCEEDED')).toContain('交易限额超限');
            expect(formatGrokDeclineReason('DECLINE_REASON_AUTHENTICATION_FAILED')).toContain('3DS验证失败');
        });
    });
});
