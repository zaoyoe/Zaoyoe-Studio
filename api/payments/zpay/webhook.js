const admin = require('../../_lib/admin');
const {
    createZpayWebhookHandler
} = require('../../_lib/payments/zpay-webhook');

module.exports = createZpayWebhookHandler({
    getSupabase: () => admin.getOptionalSupabaseAdmin?.() || admin.getSupabaseAdmin?.() || null,
    env: process.env
});
