const admin = require('../../../_lib/admin');
const requestSecurity = require('../../../_lib/request-security');
const site = require('../../../_lib/site');
const { createGuestShopHandlers } = require('../../../../server/api-handlers/public/guest-shop');

// Order Access 2.0 (A3) §13.2: self-service upgrade of a historical order
// (buyer_id IS NULL) to email + query-password access, behind orderNo +
// recoveryCode. Answers 404 guest_feature_disabled while
// GUEST_SHOP_BUYER_CREDENTIAL_ENABLED is off, so shipping this route module is
// behaviour-neutral.
module.exports = createGuestShopHandlers({ admin, requestSecurity, site, env: process.env }).accessUpgrade;
