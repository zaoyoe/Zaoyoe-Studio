const admin = require('../../_lib/admin');
const {
    createNowpaymentsWebhookHandler
} = require('../../_lib/payments/nowpayments-webhook');

module.exports = createNowpaymentsWebhookHandler({
    getSupabase: () => admin.getOptionalSupabaseAdmin?.() || admin.getSupabaseAdmin?.() || null,
    env: process.env
});
