const admin = require('../_lib/admin');
const requestSecurity = require('../_lib/request-security');
const site = require('../_lib/site');
const discountAssets = require('../_lib/discount-assets');
const discountPricing = require('../_lib/discount-pricing');
const {
    createShopHandlers
} = require('../../server/api-handlers/public/shop');

module.exports = createShopHandlers({
    admin,
    requestSecurity,
    site,
    discountAssets,
    discountPricing,
    env: process.env
})['product-guidance'];
