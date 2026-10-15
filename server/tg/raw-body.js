'use strict';

// Preserve numeric JSON lexemes for TG's signed USDT callback only. The shop
// and other APIs keep their existing parsers and request-size policies.
function isTgNowpaymentsWebhookRequest(req = {}) {
    if (String(req.method || '').toUpperCase() !== 'POST') return false;
    try {
        const url = new URL(req.originalUrl || req.url || '/', 'http://verify.internal');
        const normalize = (value) => String(value || '').trim().replace(/[?#][\s\S]*$/, '').replace(/^\/+|\/+$/g, '').toLowerCase();
        const parts = normalize(url.pathname).split('/');
        if (parts[0] !== 'api' || !['public', 'tg'].includes(parts[1])) return false;
        const scope = normalize(url.searchParams.get('scope')) || (parts[1] === 'public' ? parts[2] : parts[1]);
        const route = normalize(url.searchParams.get('route')) || parts.slice(parts[1] === 'public' ? 3 : 2).join('/');
        return scope === 'tg' && route === 'purchase/webhooks/nowpayments';
    } catch (_) { return false; }
}

module.exports = { isTgNowpaymentsWebhookRequest };
