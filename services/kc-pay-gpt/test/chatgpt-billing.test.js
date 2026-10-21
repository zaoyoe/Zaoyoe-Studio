'use strict';

const {
    isBillingCountryMismatchError,
    buildBillingCountryMismatchError,
    shouldFallbackToPricingCheckout,
    openApiCheckout
} = require('../chatgpt');

describe('checkout API rejection handling', () => {
    it.each(['api', 'auto', 'hybrid'])('stops an expired token in %s mode without navigating or UI fallback', async checkoutMode => {
        const post = vi.fn().mockResolvedValue({ status: () => 401, text: async () => JSON.stringify({ error: { code: 'token_expired', message: 'Your authentication token has expired.' } }) });
        const page = { context: () => ({ request: { post } }), goto: vi.fn() };
        let failure;
        try { await openApiCheckout(page, { accessToken: 'offline', planType: 'go', country: 'US', currency: 'USD' }); } catch (error) { failure = error; }
        expect(failure).toMatchObject({ code: 'CHECKOUT_AUTH_ERROR', httpStatus: 401 });
        expect(shouldFallbackToPricingCheckout(failure, { checkoutMode })).toBe(false);
        expect(post).toHaveBeenCalledOnce();
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('does not retry or navigate after an unusual-activity checkout rejection', async () => {
        const post = vi.fn().mockResolvedValue({
            status: () => 400,
            text: async () => JSON.stringify({
                error: { message: 'Our systems have detected unusual activity. Please try again later.' }
            })
        });
        const goto = vi.fn();
        const page = { context: () => ({ request: { post } }), goto };

        await expect(openApiCheckout(page, {
            accessToken: 'session-token-for-test',
            planType: 'plus', country: 'PH', currency: 'PHP', verifyPage: true
        })).rejects.toMatchObject({
            code: 'CHECKOUT_UNUSUAL_ACTIVITY',
            httpStatus: 400,
            message: expect.stringContaining('[CHECKOUT_UNUSUAL_ACTIVITY]')
        });
        expect(post).toHaveBeenCalledOnce();
        expect(goto).not.toHaveBeenCalled();
    });

    it('allows ordinary API checkout errors to use UI fallback but stops unusual-activity rejection', () => {
        expect(shouldFallbackToPricingCheckout(
            Object.assign(new Error('Checkout 创建接口返回 HTTP 400：Unsupported currency'), { code: 'CHECKOUT_HTTP_ERROR' }),
            { checkoutMode: 'api' }
        )).toBe(true);
        expect(shouldFallbackToPricingCheckout(
            Object.assign(new Error('unusual activity'), { code: 'CHECKOUT_UNUSUAL_ACTIVITY' }),
            { checkoutMode: 'api' }
        )).toBe(false);
        expect(shouldFallbackToPricingCheckout(
            Object.assign(new Error('ordinary failure'), { code: 'CHECKOUT_HTTP_ERROR' }),
            { checkoutMode: 'api', debugOnly: true }
        )).toBe(false);
        expect(shouldFallbackToPricingCheckout(
            Object.assign(new Error('ordinary failure'), { code: 'CHECKOUT_HTTP_ERROR' }),
            { checkoutMode: 'ui' }
        )).toBe(false);
    });
});

describe('checkout billing-country guard', () => {
    it('recognizes the upstream billing-country mismatch response', () => {
        expect(isBillingCountryMismatchError('Billing country must match request country.')).toBe(true);
        expect(isBillingCountryMismatchError('API 创建 Checkout 失败: Billing country must match request country.')).toBe(true);
        expect(isBillingCountryMismatchError('network timeout')).toBe(false);
    });

    it('builds a fail-closed message without allowing a payment fallback', () => {
        const message = buildBillingCountryMismatchError({ country: 'PH', currency: 'PHP' });
        expect(message).toContain('PH/PHP');
        expect(message).toContain('已停止回退到 UI 和银行卡支付');
        expect(message).toContain('未发起扣款');
        expect(message).toContain('不能仅通过请求参数强行切换账单地区');
    });
});
