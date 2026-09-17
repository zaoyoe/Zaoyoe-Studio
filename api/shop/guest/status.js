const admin = require('../../_lib/admin');
const requestSecurity = require('../../_lib/request-security');
const site = require('../../_lib/site');
const { createGuestShopPaymentAdapter } = require('../../_lib/payments/guest-shop-adapter');
const { createGuestShopHandlers } = require('../../../server/api-handlers/public/guest-shop');
const {
    isGuestShopImmediateFulfillmentEnabled,
    createGuestShopFulfillmentKicker
} = require('../../../server/guest-shop-worker');

const paymentAdapter = createGuestShopPaymentAdapter({
    supabase: admin.getOptionalSupabaseAdmin?.() || null,
    env: process.env
});

const immediateFulfillment = isGuestShopImmediateFulfillmentEnabled(process.env)
    ? createGuestShopFulfillmentKicker({
        supabase: admin.getOptionalSupabaseAdmin?.() || null,
        paymentAdapter,
        env: process.env
    })
    : null;

module.exports = createGuestShopHandlers({
    admin,
    requestSecurity,
    site,
    paymentAdapter,
    kickFulfillment: immediateFulfillment?.kick,
    env: process.env
}).status;
