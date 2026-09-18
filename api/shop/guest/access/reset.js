const admin = require('../../../_lib/admin');
const requestSecurity = require('../../../_lib/request-security');
const site = require('../../../_lib/site');
const { createGuestShopHandlers } = require('../../../../server/api-handlers/public/guest-shop');

// Order Access 2.0 (A3) §10.5: consume an admin-issued one-time reset link and
// set a new query password. Answers 404 guest_feature_disabled while
// GUEST_SHOP_BUYER_CREDENTIAL_ENABLED is off, so shipping this route module is
// behaviour-neutral. The plaintext token is never logged here: it is only ever
// read from the request body and passed to the handler.
module.exports = createGuestShopHandlers({ admin, requestSecurity, site, env: process.env }).accessReset;
