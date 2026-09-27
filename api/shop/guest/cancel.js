const admin = require('../../_lib/admin');
const requestSecurity = require('../../_lib/request-security');
const site = require('../../_lib/site');
const { createGuestShopHandlers } = require('../../../server/api-handlers/public/guest-shop');

<<<<<<<< HEAD:api/shop/guest/cancel.js
module.exports = createGuestShopHandlers({
    admin,
    requestSecurity,
    site,
    env: process.env
}).cancel;
========
// Order Access 2.0 (A2). Answers 404 guest_feature_disabled while
// GUEST_SHOP_BUYER_CREDENTIAL_ENABLED is off, so shipping this route module is
// behaviour-neutral.
module.exports = createGuestShopHandlers({ admin, requestSecurity, site, env: process.env }).order;
>>>>>>>> https-origin/main:api/shop/guest/order.js
