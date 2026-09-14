const admin = require('../../_lib/admin');
const requestSecurity = require('../../_lib/request-security');
const site = require('../../_lib/site');
const { createGuestShopPaymentAdapter } = require('../../_lib/payments/guest-shop-adapter');
const { createGuestShopHandlers } = require('../../../server/api-handlers/public/guest-shop');

const paymentAdapter = createGuestShopPaymentAdapter({
    supabase: admin.getOptionalSupabaseAdmin?.() || null,
    env: process.env
});

module.exports = createGuestShopHandlers({
    admin,
    requestSecurity,
    site,
    paymentAdapter,
    env: process.env
}).orders;
