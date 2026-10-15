(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.GrokPlanCatalog = factory();
})(typeof window === 'object' ? window : this, function () {
    'use strict';
    // New bundled merchandise. Never reuse a legacy SuperGrok/X Premium key.
    const tiers = { plus: [8, 80], premium: [30, 300], super: [100, 1000], ultra: [200, 2000] };
    const plans = Object.freeze(Object.fromEntries(Object.entries(tiers).flatMap(([tier, amounts]) =>
        ['monthly', 'annual'].map((period, i) => {
            const key = `grok_bundle_${tier}_${period}`;
            const name = tier[0].toUpperCase() + tier.slice(1);
            return [key, Object.freeze({ key, tier, name, platform: 'grok', productFamily: 'x_subscription',
                label: `The X Subscription ${name}（${i ? '年付' : '月付'}）`,
                amount: amounts[i], currency: 'USD', interval: i ? 'year' : 'month', platformMode: 'grok_web' })];
        }))));
    const legacyKeys = Object.freeze(['supergrok_lite', 'supergrok', 'supergrok_plus', 'supergrok_heavy',
        'grok_lite', 'grok_super', 'grok_plus', 'grok_heavy', 'grok_premium', 'grok_premium_plus']);
    const legacyLabels = Object.freeze({ supergrok_lite: 'SuperGrok Lite（历史商品）', supergrok: 'SuperGrok（历史商品）',
        supergrok_plus: 'SuperGrok Plus（历史商品）', supergrok_heavy: 'SuperGrok Heavy（历史商品）',
        grok_lite: 'SuperGrok Lite（历史商品）', grok_super: 'SuperGrok（历史商品）', grok_plus: 'SuperGrok Plus（历史商品）',
        grok_heavy: 'SuperGrok Heavy（历史商品）', grok_premium: 'X Premium（历史商品）', grok_premium_plus: 'X Premium+（历史商品）' });
    const labels = Object.freeze({ ...legacyLabels, ...Object.fromEntries(Object.entries(plans).map(([key, plan]) => [key, plan.label])) });
    return Object.freeze({ plans, labels, legacyKeys, isBundle: key => Object.hasOwn(plans, key),
        isLegacy: key => legacyKeys.includes(key) });
});
