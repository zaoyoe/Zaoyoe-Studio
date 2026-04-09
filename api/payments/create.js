const admin = require('../_lib/admin');
const requestSecurity = require('../_lib/request-security');
const paymentProviders = require('../_lib/payments/providers');
const paymentOrders = require('../_lib/payments/orders');
const {
    createPaymentsHandlers
} = require('../../server/api-handlers/public/payments');

module.exports = createPaymentsHandlers({
    admin,
    requestSecurity,
    paymentProviders,
    paymentOrders,
    env: process.env
}).create;
