'use strict';

function isTrustedStripeFrame(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && /(?:^|\.)stripe\.com$/i.test(url.hostname)
            && !url.port && !url.username && !url.password;
    } catch (_) { return false; }
}

// Stripe can render its Payment Element inside an accessory-target iframe.
// Address and wallet accessories must not qualify as card input surfaces.
function isStripePaymentAccessoryFrame(value) {
    try {
        const url = new URL(value);
        const params = new URLSearchParams(url.hash.slice(1));
        return url.protocol === 'https:' && url.hostname === 'js.stripe.com' && !url.port
            && !url.username && !url.password
            && /^\/v3\/elements-inner-accessory-target-[\w-]+\.html$/.test(url.pathname)
            && params.getAll('componentName').length === 1 && params.get('componentName') === 'payment'
            && params.getAll('elementId').length === 1 && /^payment-[\w-]+$/.test(params.get('elementId') || '');
    } catch (_) { return false; }
}

function isExcludedCardFrame(value) {
    return /elements-inner-address|hcaptcha|captcha|challenge/i.test(value)
        || /elements-inner-accessory/i.test(value) && !isStripePaymentAccessoryFrame(value);
}

module.exports = { isTrustedStripeFrame, isStripePaymentAccessoryFrame, isExcludedCardFrame };
