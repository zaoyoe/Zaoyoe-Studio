const admin = require('../../../_lib/admin');
const requestSecurity = require('../../../_lib/request-security');
const site = require('../../../_lib/site');
const { createGuestShopHandlers } = require('../../../../server/api-handlers/public/guest-shop');

// Local preview resolves this small entrypoint directly. Production proxies
// /api/shop/* to Verify Server, where api/public.js binds the same handler.
module.exports = createGuestShopHandlers({ admin, requestSecurity, site, env: process.env }).accessAvailability;
