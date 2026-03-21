const { sendJson } = require('./_lib/admin');
const geminiHandler = require('../server/api-handlers/admin/gemini');
const shopMutateHandler = require('../server/api-handlers/admin/shop/mutate');
const shopDeliveryActionsHandler = require('../server/api-handlers/admin/shop/delivery-actions');
const shopDeliveryTasksHandler = require('../server/api-handlers/admin/shop/delivery-tasks');
const paymentsActionsHandler = require('../server/api-handlers/admin/payments/actions');
const paymentsCleanupHandler = require('../server/api-handlers/admin/payments/cleanup');
const paymentsSummaryHandler = require('../server/api-handlers/admin/payments/summary');
const settingsGeminiKeyHandler = require('../server/api-handlers/admin/settings/gemini-key');
const settingsPaymentChannelsHandler = require('../server/api-handlers/admin/settings/payment-channels');
const ticketProcessHandler = require('../server/api-handlers/admin/tickets/process');

const ROUTE_HANDLERS = {
    gemini: geminiHandler,
    'settings/gemini-key': settingsGeminiKeyHandler,
    'settings/payment-channels': settingsPaymentChannelsHandler,
    'tickets/process': ticketProcessHandler,
    'shop/mutate': shopMutateHandler,
    'shop/delivery-actions': shopDeliveryActionsHandler,
    'shop/delivery-tasks': shopDeliveryTasksHandler,
    'shop/delivery-strategy': shopDeliveryTasksHandler,
    'payments/actions': paymentsActionsHandler,
    'payments/cleanup': paymentsCleanupHandler,
    'payments/summary': paymentsSummaryHandler
};

module.exports = async function handler(req, res) {
    const url = new URL(req.url || '', 'http://localhost');
    const route = String(url.searchParams.get('route') || '').trim().toLowerCase();
    const resolvedHandler = ROUTE_HANDLERS[route];

    if (!resolvedHandler) {
        return sendJson(res, 404, {
            success: false,
            message: 'Admin route not found'
        });
    }

    if (route === 'shop/delivery-strategy') {
        url.searchParams.set('route', 'delivery-strategy');
        req.url = `${url.pathname}${url.search}`;
    }

    return resolvedHandler(req, res);
};
