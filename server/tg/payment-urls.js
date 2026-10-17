'use strict';

const { _private: { isProductionLikeRuntime } } = require('../../api/_lib/request-security');

const TG_ORIGIN = 'https://tg.fatherkey.com';

function webhookUrl(provider, env = process.env) {
    if (!['zpay', 'nowpayments'].includes(provider)) throw new Error('tg_payment_callback_invalid');
    let origin = TG_ORIGIN;
    const previewOrigin = env.TG_PREVIEW_PAYMENT_WEBHOOK_ORIGIN;
    // The local callback relay exposes only signed webhook routes. Production
    // must always retain the canonical domain, even with a stale preview key.
    if (previewOrigin && !isProductionLikeRuntime(env) && env.NODE_ENV !== 'production') {
        const url = new URL(previewOrigin);
        if (env.APP_ENV !== 'preview' || !['127.0.0.1', 'localhost'].includes(env.LOCAL_PREVIEW_HOST)
            || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
            || url.pathname !== '/' || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(url.hostname)) {
            throw new Error('tg_payment_callback_invalid');
        }
        origin = url.origin;
    }
    return `${origin}/api/tg/purchase/webhooks/${provider}`;
}

module.exports = { webhookUrl };
