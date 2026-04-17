const admin = require('../_lib/admin');
const site = require('../_lib/site');
const {
    createWalletHandlers
} = require('../../server/api-handlers/public/wallet');

module.exports = createWalletHandlers({
    admin,
    site
}).overview;
