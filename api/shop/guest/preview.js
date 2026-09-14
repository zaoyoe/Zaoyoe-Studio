const admin = require('../../_lib/admin');
const requestSecurity = require('../../_lib/request-security');
const site = require('../../_lib/site');
const { createGuestShopHandlers } = require('../../../server/api-handlers/public/guest-shop');

module.exports = createGuestShopHandlers({ admin, requestSecurity, site, env: process.env }).preview;
