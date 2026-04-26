const admin = require('../_lib/admin');
const site = require('../_lib/site');
const {
    createWalletCheckinHandler
} = require('../../server/api-handlers/public/wallet-checkin');

function loadCheckinDiscountLinkageHelper() {
    const {
        maybeIssueCheckinDiscountAssets
    } = require('../_lib/discount-trigger-linkage');

    return maybeIssueCheckinDiscountAssets;
}

module.exports = createWalletCheckinHandler({
    admin,
    site,
    loadDiscountLinkageHelper: loadCheckinDiscountLinkageHelper
});
