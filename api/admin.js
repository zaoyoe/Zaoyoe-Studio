const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('./_lib/admin');
const analyticsPanelSupportBundleHandler = require('../server/api-handlers/admin/analytics/panel-support-bundle');
const analyticsSnapshotBundleHandler = require('../server/api-handlers/admin/analytics/snapshot-bundle');
const analyticsSummaryPayloadBundleHandler = require('../server/api-handlers/admin/analytics/summary-payload-bundle');
const analyticsSummaryRowsBundleHandler = require('../server/api-handlers/admin/analytics/summary-rows-bundle');
const analyticsSummaryWindowBundleHandler = require('../server/api-handlers/admin/analytics/summary-window-bundle');
const analyticsTrendSeriesBundleHandler = require('../server/api-handlers/admin/analytics/trend-series-bundle');
const analyticsVisualPanelBundleHandler = require('../server/api-handlers/admin/analytics/visual-panel-bundle');
const analyticsProductDashboardBundleHandler = require('../server/api-handlers/admin/analytics/product-dashboard-bundle');
const analyticsProductSummaryBundleHandler = require('../server/api-handlers/admin/analytics/product-summary-bundle');
const analyticsProductRankBundleHandler = require('../server/api-handlers/admin/analytics/product-rank-bundle');
const analyticsProductHealthBundleHandler = require('../server/api-handlers/admin/analytics/product-health-bundle');
const analyticsProductFunnelBundleHandler = require('../server/api-handlers/admin/analytics/product-funnel-bundle');
const analyticsProductDetailBundleHandler = require('../server/api-handlers/admin/analytics/product-detail-bundle');
const codexHandler = require('../server/api-handlers/admin/codex');
const geminiHandler = require('../server/api-handlers/admin/gemini');
const commentsListHandler = require('../server/api-handlers/admin/comments/list');
const commentsBlocksHandler = require('../server/api-handlers/admin/comments/blocks');
const commentsModerateHandler = require('../server/api-handlers/admin/comments/moderate');
const commentsSummaryHandler = require('../server/api-handlers/admin/comments/summary');
const commentsWorkflowHandler = require('../server/api-handlers/admin/comments/workflow');
const discountsBatchHistoryHandler = require('../server/api-handlers/admin/discounts/batch-history');
const discountsAssetsHandler = require('../server/api-handlers/admin/discounts/assets');
const discountsDetailHandler = require('../server/api-handlers/admin/discounts/detail');
const discountsListHandler = require('../server/api-handlers/admin/discounts/list');
const discountsMutateHandler = require('../server/api-handlers/admin/discounts/mutate');
const engagementAssetsHandler = require('../server/api-handlers/admin/engagement/assets');
const engagementEntryHandler = require('../server/api-handlers/admin/engagement/entry');
const engagementExternalHandler = require('../server/api-handlers/admin/engagement/external');
const engagementOverviewHandler = require('../server/api-handlers/admin/engagement/overview');
const engagementRulesHandler = require('../server/api-handlers/admin/engagement/rules');
const engagementScenesHandler = require('../server/api-handlers/admin/engagement/scenes');
const engagementSegmentsHandler = require('../server/api-handlers/admin/engagement/segments');
const engagementTemplatesHandler = require('../server/api-handlers/admin/engagement/templates');
const marketingAssetsCenterHandler = require('../server/api-handlers/admin/marketing/assets-center');
const homepageConfigHandler = require('../server/api-handlers/admin/homepage/config');
const homepageContextHandler = require('../server/api-handlers/admin/homepage/context');
const homepageLayoutHandler = require('../server/api-handlers/admin/homepage/layout');
const pointsBatchesHandler = require('../server/api-handlers/admin/points/batches');
const pointsCatalogHandler = require('../server/api-handlers/admin/points/catalog');
const pointsLookupHandler = require('../server/api-handlers/admin/points/lookup');
const pointsManageHandler = require('../server/api-handlers/admin/points/manage');
const pointsPackagesHandler = require('../server/api-handlers/admin/points/packages');
const promptsManageHandler = require('../server/api-handlers/admin/prompts/manage');
const accessSessionHandler = require('../server/api-handlers/admin/access/session');
const shopCategoriesHandler = require('../server/api-handlers/admin/shop/categories');
const shopInventoryDetailHandler = require('../server/api-handlers/admin/shop/inventory-detail');
const shopInventoryHandler = require('../server/api-handlers/admin/shop/inventory');
const shopMutateHandler = require('../server/api-handlers/admin/shop/mutate');
const shopMarketplaceOrdersHandler = require('../server/api-handlers/admin/shop/marketplace-orders');
const shopOrderDetailHandler = require('../server/api-handlers/admin/shop/order-detail');
const shopOrdersHandler = require('../server/api-handlers/admin/shop/orders');
const shopProductsHandler = require('../server/api-handlers/admin/shop/products');
const shopProcurementHandler = require('../server/api-handlers/admin/shop/procurement');
const shopProfitLedgerBackfillHandler = require('../server/api-handlers/admin/shop/profit-ledger-backfill');
const shopDeliveryActionsHandler = require('../server/api-handlers/admin/shop/delivery-actions');
const shopDeliveryTasksHandler = require('../server/api-handlers/admin/shop/delivery-tasks');
const paymentsActionsHandler = require('../server/api-handlers/admin/payments/actions');
const paymentsCleanupHandler = require('../server/api-handlers/admin/payments/cleanup');
const paymentsShopRefundHandler = require('../server/api-handlers/admin/payments/shop-refund');
const paymentsSummaryHandler = require('../server/api-handlers/admin/payments/summary');
const settingsCodexConfigHandler = require('../server/api-handlers/admin/settings/codex-config');
const settingsDiscountTriggerOptionsHandler = require('../server/api-handlers/admin/settings/discount-trigger-options');
const settingsExternalMonitoringSmokeHandler = require('../server/api-handlers/admin/settings/external-monitoring-smoke');
const settingsGeminiKeyHandler = require('../server/api-handlers/admin/settings/gemini-key');
const settingsAdminAuditMonitorHandler = require('../server/api-handlers/admin/settings/admin-audit-monitor');
const settingsAnnouncementsHandler = require('../server/api-handlers/admin/settings/announcements');
const settingsMarketplaceChannelsHandler = require('../server/api-handlers/admin/settings/marketplace-channels');
const settingsOpsAlertHealthHandler = require('../server/api-handlers/admin/settings/ops-alert-health');
const settingsOpsAlertsHandler = require('../server/api-handlers/admin/settings/ops-alerts');
const settingsOpsAlertMonitorHandler = require('../server/api-handlers/admin/settings/ops-alert-monitor');
const settingsOpsAlertMonitorCasesHandler = require('../server/api-handlers/admin/settings/ops-alert-monitor-cases');
const settingsPaymentChannelsHandler = require('../server/api-handlers/admin/settings/payment-channels');
const settingsRecoveryReadinessHandler = require('../server/api-handlers/admin/settings/recovery-readiness');
const settingsSecurityLocksHandler = require('../server/api-handlers/admin/settings/security-locks');
const settingsSystemConfigHandler = require('../server/api-handlers/admin/settings/system-config');
const settingsVerifyMonitorHandler = require('../server/api-handlers/admin/settings/verify-monitor');
const settingsVerifyMonitorQuotaHandler = require('../server/api-handlers/admin/settings/verify-monitor-quota');
const settingsVerifyMonitorQueueHandler = require('../server/api-handlers/admin/settings/verify-monitor-queue');
const ticketAssignHandler = require('../server/api-handlers/admin/tickets/assign');
const ticketBatchProcessHandler = require('../server/api-handlers/admin/tickets/batch-process');
const ticketCreateHandler = require('../server/api-handlers/admin/tickets/create');
const ticketHistoryHandler = require('../server/api-handlers/admin/tickets/history');
const ticketListHandler = require('../server/api-handlers/admin/tickets/list');
const ticketMetricsHandler = require('../server/api-handlers/admin/tickets/metrics');
const ticketProcessHandler = require('../server/api-handlers/admin/tickets/process');
const ticketSummaryActionsHandler = require('../server/api-handlers/admin/tickets/summary-actions');
const ticketSummaryHistoryHandler = require('../server/api-handlers/admin/tickets/summary-history');
const usersBlocksHandler = require('../server/api-handlers/admin/users/blocks');
const usersManageHandler = require('../server/api-handlers/admin/users/manage');

const ROUTE_HANDLERS = {
    'analytics/panel-support-bundle': analyticsPanelSupportBundleHandler,
    'analytics/snapshot-bundle': analyticsSnapshotBundleHandler,
    'analytics/summary-payload-bundle': analyticsSummaryPayloadBundleHandler,
    'analytics/summary-rows-bundle': analyticsSummaryRowsBundleHandler,
    'analytics/summary-window-bundle': analyticsSummaryWindowBundleHandler,
    'analytics/trend-series-bundle': analyticsTrendSeriesBundleHandler,
    'analytics/visual-panel-bundle': analyticsVisualPanelBundleHandler,
    'analytics/product-dashboard-bundle': analyticsProductDashboardBundleHandler,
    'analytics/product-summary-bundle': analyticsProductSummaryBundleHandler,
    'analytics/product-rank-bundle': analyticsProductRankBundleHandler,
    'analytics/product-health-bundle': analyticsProductHealthBundleHandler,
    'analytics/product-funnel-bundle': analyticsProductFunnelBundleHandler,
    'analytics/product-detail-bundle': analyticsProductDetailBundleHandler,
    codex: codexHandler,
    gemini: geminiHandler,
    'comments/list': commentsListHandler,
    'comments/blocks': commentsBlocksHandler,
    'comments/moderate': commentsModerateHandler,
    'comments/summary': commentsSummaryHandler,
    'comments/workflow': commentsWorkflowHandler,
    'discounts/batch-history': discountsBatchHistoryHandler,
    'discounts/assets': discountsAssetsHandler,
    'discounts/detail': discountsDetailHandler,
    'discounts/list': discountsListHandler,
    'discounts/mutate': discountsMutateHandler,
    'engagement/assets': engagementAssetsHandler,
    'engagement/entry': engagementEntryHandler,
    'engagement/external': engagementExternalHandler,
    'engagement/overview': engagementOverviewHandler,
    'engagement/rules': engagementRulesHandler,
    'engagement/scenes': engagementScenesHandler,
    'engagement/segments': engagementSegmentsHandler,
    'engagement/templates': engagementTemplatesHandler,
    'marketing/assets-center': marketingAssetsCenterHandler,
    'homepage/config': homepageConfigHandler,
    'homepage/context': homepageContextHandler,
    'homepage/layout': homepageLayoutHandler,
    'points/batches': pointsBatchesHandler,
    'points/catalog': pointsCatalogHandler,
    'points/lookup': pointsLookupHandler,
    'points/manage': pointsManageHandler,
    'points/packages': pointsPackagesHandler,
    'prompts/manage': promptsManageHandler,
    'access/session': accessSessionHandler,
    'settings/admin-audit-monitor': settingsAdminAuditMonitorHandler,
    'settings/announcements': settingsAnnouncementsHandler,
    'settings/codex-config': settingsCodexConfigHandler,
    'settings/discount-trigger-options': settingsDiscountTriggerOptionsHandler,
    'settings/external-monitoring-smoke': settingsExternalMonitoringSmokeHandler,
    'settings/gemini-key': settingsGeminiKeyHandler,
    'settings/marketplace-channels': settingsMarketplaceChannelsHandler,
    'settings/ops-alert-health': settingsOpsAlertHealthHandler,
    'settings/ops-alerts': settingsOpsAlertsHandler,
    'settings/ops-alert-monitor': settingsOpsAlertMonitorHandler,
    'settings/ops-alert-monitor-cases': settingsOpsAlertMonitorCasesHandler,
    'settings/payment-channels': settingsPaymentChannelsHandler,
    'settings/recovery-readiness': settingsRecoveryReadinessHandler,
    'settings/security-locks': settingsSecurityLocksHandler,
    'settings/system-config': settingsSystemConfigHandler,
    'settings/verify-monitor': settingsVerifyMonitorHandler,
    'settings/verify-monitor/quota': settingsVerifyMonitorQuotaHandler,
    'settings/verify-monitor/queue': settingsVerifyMonitorQueueHandler,
    'tickets/assign': ticketAssignHandler,
    'tickets/batch-process': ticketBatchProcessHandler,
    'tickets/create': ticketCreateHandler,
    'tickets/history': ticketHistoryHandler,
    'tickets/list': ticketListHandler,
    'tickets/metrics': ticketMetricsHandler,
    'tickets/process': ticketProcessHandler,
    'tickets/summary-actions': ticketSummaryActionsHandler,
    'tickets/summary-history': ticketSummaryHistoryHandler,
    'shop/categories': shopCategoriesHandler,
    'shop/inventory-detail': shopInventoryDetailHandler,
    'shop/inventory': shopInventoryHandler,
    'shop/marketplace-orders': shopMarketplaceOrdersHandler,
    'shop/mutate': shopMutateHandler,
    'shop/order-detail': shopOrderDetailHandler,
    'shop/orders': shopOrdersHandler,
    'shop/products': shopProductsHandler,
    'shop/procurement': shopProcurementHandler,
    'shop/profit-ledger-backfill': shopProfitLedgerBackfillHandler,
    'shop/delivery-actions': shopDeliveryActionsHandler,
    'shop/delivery-tasks': shopDeliveryTasksHandler,
    'shop/delivery-strategy': shopDeliveryTasksHandler,
    'payments/actions': paymentsActionsHandler,
    'payments/cleanup': paymentsCleanupHandler,
    'payments/shop-refund': paymentsShopRefundHandler,
    'payments/summary': paymentsSummaryHandler,
    'users/blocks': usersBlocksHandler,
    'users/manage': usersManageHandler
};

function normalizeAdminRouteValue(value = '') {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    let normalized = raw;

    try {
        if (/^https?:\/\//i.test(normalized)) {
            const absoluteUrl = new URL(normalized);
            normalized = absoluteUrl.pathname || '';
        }
    } catch (_) {
        // keep the original value when it is not a valid absolute URL
    }

    normalized = normalized
        .replace(/[?#][\s\S]*$/, '')
        .replace(/^https?:\/\/[^/]+/i, '')
        .replace(/^\/+|\/+$/g, '')
        .replace(/^api\/admin\/?/i, '')
        .replace(/^admin\/?/i, '')
        .trim()
        .toLowerCase();

    return normalized;
}

function resolveAdminRoute(url) {
    const queryRoute = normalizeAdminRouteValue(url.searchParams.get('route'));
    if (queryRoute) {
        return queryRoute;
    }

    const pathRoute = normalizeAdminRouteValue(url.pathname || '');

    return pathRoute;
}

function shouldSkipDispatchAdminAuth(route, req) {
    const method = String(req?.method || 'GET').trim().toUpperCase();
    return route === 'access/session' && method === 'DELETE';
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

    if (!shouldSkipDispatchAdminAuth(route, req)) {
        try {
            req.adminContext = await requireAdmin(req);
        } catch (error) {
            return sendJson(res, Number(error?.statusCode) || 401, {
                success: false,
                message: error?.message || 'Admin access required',
                code: error?.code || 'admin_access_required'
            });
        }
    }

    return resolvedHandler(req, res);
};
