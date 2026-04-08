const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    buildRangeWindow,
    loadProductAnalyticsDataset,
    buildProductSummaryPayload,
    buildProductTrendPayload,
    buildProductSiteComparisonPayload,
    buildProductCategoryBreakdownPayload,
    buildProductOperatingMatrixPayload,
    buildProductBundleSuccess,
    buildProductBundleFailure
} = require('./_product-analytics-builders');

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

module.exports = async function analyticsProductSummaryBundleHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'analytics.view' });
        const params = getQueryParams(req);
        const site = normalizeAdminSite(params.get('site') || req.adminSite, { defaultValue: 'all' }) || 'all';
        const rangeWindow = buildRangeWindow(params);

        let dataset = null;
        let datasetError = null;
        try {
            dataset = await loadProductAnalyticsDataset(supabase, {
                site,
                startIso: rangeWindow.startIso,
                endIso: rangeWindow.endIso,
                includeInventory: true,
                includeEvents: true
            });
        } catch (error) {
            datasetError = error;
        }

        const segments = dataset ? {
            summary: buildProductBundleSuccess(
                buildProductSummaryPayload({
                    ...dataset,
                    site
                }),
                { source: 'shop_products + shop_orders + shop_inventory + user_events' }
            ),
            trend: buildProductBundleSuccess(
                buildProductTrendPayload({
                    orders: dataset.orders,
                    events: dataset.events,
                    startIso: rangeWindow.startIso,
                    endIso: rangeWindow.endIso
                }),
                { source: 'shop_orders + user_events' }
            ),
            siteComparison: buildProductBundleSuccess(
                buildProductSiteComparisonPayload({
                    ...dataset,
                    activeSite: site
                }),
                { source: 'shop_products + shop_orders + shop_inventory + user_events' }
            ),
            categoryBreakdown: buildProductBundleSuccess(
                buildProductCategoryBreakdownPayload({
                    ...dataset,
                    site
                }),
                { source: 'shop_products + shop_orders + shop_inventory + user_events' }
            ),
            productMatrix: buildProductBundleSuccess(
                buildProductOperatingMatrixPayload({
                    ...dataset,
                    site
                }),
                { source: 'shop_products + shop_orders + shop_inventory + user_events' }
            )
        } : {
            summary: buildProductBundleFailure(datasetError, 'Failed to load product analytics summary'),
            trend: buildProductBundleFailure(datasetError, 'Failed to load product analytics trend'),
            siteComparison: buildProductBundleFailure(datasetError, 'Failed to load product analytics site comparison'),
            categoryBreakdown: buildProductBundleFailure(datasetError, 'Failed to load product analytics category breakdown'),
            productMatrix: buildProductBundleFailure(datasetError, 'Failed to load product analytics operating matrix')
        };

        return sendJson(res, 200, {
            success: true,
            site,
            generated_at: new Date().toISOString(),
            range: rangeWindow,
            partial_failure_count: Object.values(segments).filter((segment) => !segment.ok).length,
            segments
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load product analytics summary bundle'
        });
    }
};
