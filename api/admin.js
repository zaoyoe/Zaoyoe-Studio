const {
    normalizeAdminSite,
    sendJson
} = require('./_lib/admin');
const geminiHandler = require('../server/api-handlers/admin/gemini');
const commentsListHandler = require('../server/api-handlers/admin/comments/list');
const commentsBlocksHandler = require('../server/api-handlers/admin/comments/blocks');
const commentsModerateHandler = require('../server/api-handlers/admin/comments/moderate');
const commentsSummaryHandler = require('../server/api-handlers/admin/comments/summary');
const discountsListHandler = require('../server/api-handlers/admin/discounts/list');
const homepageConfigHandler = require('../server/api-handlers/admin/homepage/config');
const pointsBatchesHandler = require('../server/api-handlers/admin/points/batches');
const pointsCatalogHandler = require('../server/api-handlers/admin/points/catalog');
const pointsLookupHandler = require('../server/api-handlers/admin/points/lookup');
const pointsManageHandler = require('../server/api-handlers/admin/points/manage');
const pointsPackagesHandler = require('../server/api-handlers/admin/points/packages');
const promptsManageHandler = require('../server/api-handlers/admin/prompts/manage');
const accessSessionHandler = require('../server/api-handlers/admin/access/session');
const shopMutateHandler = require('../server/api-handlers/admin/shop/mutate');
const shopOrdersHandler = require('../server/api-handlers/admin/shop/orders');
const shopDeliveryActionsHandler = require('../server/api-handlers/admin/shop/delivery-actions');
const shopDeliveryTasksHandler = require('../server/api-handlers/admin/shop/delivery-tasks');
const paymentsActionsHandler = require('../server/api-handlers/admin/payments/actions');
const paymentsCleanupHandler = require('../server/api-handlers/admin/payments/cleanup');
const paymentsShopRefundHandler = require('../server/api-handlers/admin/payments/shop-refund');
const paymentsSummaryHandler = require('../server/api-handlers/admin/payments/summary');
const settingsGeminiKeyHandler = require('../server/api-handlers/admin/settings/gemini-key');
const settingsAdminAuditMonitorHandler = require('../server/api-handlers/admin/settings/admin-audit-monitor');
const settingsOpsAlertHealthHandler = require('../server/api-handlers/admin/settings/ops-alert-health');
const settingsOpsAlertsHandler = require('../server/api-handlers/admin/settings/ops-alerts');
const settingsOpsAlertMonitorHandler = require('../server/api-handlers/admin/settings/ops-alert-monitor');
const settingsOpsAlertMonitorCasesHandler = require('../server/api-handlers/admin/settings/ops-alert-monitor-cases');
const settingsPaymentChannelsHandler = require('../server/api-handlers/admin/settings/payment-channels');
const settingsVerifyMonitorHandler = require('../server/api-handlers/admin/settings/verify-monitor');
const settingsVerifyMonitorQuotaHandler = require('../server/api-handlers/admin/settings/verify-monitor-quota');
const settingsVerifyMonitorQueueHandler = require('../server/api-handlers/admin/settings/verify-monitor-queue');
const ticketCreateHandler = require('../server/api-handlers/admin/tickets/create');
const ticketProcessHandler = require('../server/api-handlers/admin/tickets/process');

const ROUTE_HANDLERS = {
    gemini: geminiHandler,
    'comments/list': commentsListHandler,
    'comments/blocks': commentsBlocksHandler,
    'comments/moderate': commentsModerateHandler,
    'comments/summary': commentsSummaryHandler,
    'discounts/list': discountsListHandler,
    'homepage/config': homepageConfigHandler,
    'points/batches': pointsBatchesHandler,
    'points/catalog': pointsCatalogHandler,
    'points/lookup': pointsLookupHandler,
    'points/manage': pointsManageHandler,
    'points/packages': pointsPackagesHandler,
    'prompts/manage': promptsManageHandler,
    'access/session': accessSessionHandler,
    'settings/admin-audit-monitor': settingsAdminAuditMonitorHandler,
    'settings/gemini-key': settingsGeminiKeyHandler,
    'settings/ops-alert-health': settingsOpsAlertHealthHandler,
    'settings/ops-alerts': settingsOpsAlertsHandler,
    'settings/ops-alert-monitor': settingsOpsAlertMonitorHandler,
    'settings/ops-alert-monitor-cases': settingsOpsAlertMonitorCasesHandler,
    'settings/payment-channels': settingsPaymentChannelsHandler,
    'settings/verify-monitor': settingsVerifyMonitorHandler,
    'settings/verify-monitor/quota': settingsVerifyMonitorQuotaHandler,
    'settings/verify-monitor/queue': settingsVerifyMonitorQueueHandler,
    'tickets/create': ticketCreateHandler,
    'tickets/process': ticketProcessHandler,
    'shop/mutate': shopMutateHandler,
    'shop/orders': shopOrdersHandler,
    'shop/delivery-actions': shopDeliveryActionsHandler,
    'shop/delivery-tasks': shopDeliveryTasksHandler,
    'shop/delivery-strategy': shopDeliveryTasksHandler,
    'payments/actions': paymentsActionsHandler,
    'payments/cleanup': paymentsCleanupHandler,
    'payments/shop-refund': paymentsShopRefundHandler,
    'payments/summary': paymentsSummaryHandler
};

function resolveAdminRoute(url) {
    const queryRoute = String(url.searchParams.get('route') || '').trim().toLowerCase();
    if (queryRoute) {
        return queryRoute;
    }

    const pathname = String(url.pathname || '').trim();
    const pathRoute = pathname
        .replace(/^\/api\/admin\/?/i, '')
        .replace(/^\/+|\/+$/g, '')
        .toLowerCase();

    return pathRoute;
}

module.exports = async function handler(req, res) {
    const url = new URL(req.url || '', 'http://localhost');
    const route = resolveAdminRoute(url);
    const querySite = normalizeAdminSite(url.searchParams.get('site'));
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

    req.adminRoute = route;
    if (querySite) {
        req.adminSite = querySite;
    }

    return resolvedHandler(req, res);
};
