const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    DEFAULT_PRODUCT_RANK_LIMIT,
    buildRangeWindow,
    normalizePositiveInteger,
    loadProductAnalyticsDataset,
    buildProductMetricEntries,
    buildProductSummaryPayload,
    buildProductTrendPayload,
    buildProductSiteComparisonPayload,
    buildProductCategoryBreakdownPayload,
    buildProductOperatingMatrixPayload,
    buildProductRankPayloads,
    buildProductHealthPayloads,
    buildProductFunnelPayload,
    buildProductBundleSuccess,
    buildProductBundleFailure
} = require('./_product-analytics-builders');

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

module.exports = async function analyticsProductDashboardBundleHandler(req, res) {
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
        const limit = normalizePositiveInteger(params.get('limit'), DEFAULT_PRODUCT_RANK_LIMIT, 1, 50);

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

        const metricEntries = dataset
            ? buildProductMetricEntries({
                ...dataset,
                site
            })
            : null;
        const entriesBySite = site !== 'all' && metricEntries
            ? { [site]: metricEntries }
            : null;
        const rankPayloads = dataset
            ? buildProductRankPayloads({
                ...dataset,
                site,
                limit,
                entries: metricEntries
            })
            : null;
        const healthPayloads = dataset
            ? buildProductHealthPayloads({
                ...dataset,
                site,
                limit,
                entries: metricEntries
            })
            : null;
        const funnelPayload = dataset
            ? buildProductFunnelPayload({
                ...dataset,
                site,
                limit,
                entries: metricEntries
            })
            : null;

        const segments = dataset ? {
            summary: buildProductBundleSuccess(
                buildProductSummaryPayload({
                    ...dataset,
                    site,
                    entries: metricEntries
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
                    activeSite: site,
                    entriesBySite
                }),
                { source: 'shop_products + shop_orders + shop_inventory + user_events' }
            ),
            categoryBreakdown: buildProductBundleSuccess(
                buildProductCategoryBreakdownPayload({
                    ...dataset,
                    site,
                    entries: metricEntries
                }),
                { source: 'shop_products + shop_orders + shop_inventory + user_events' }
            ),
            productMatrix: buildProductBundleSuccess(
                buildProductOperatingMatrixPayload({
                    ...dataset,
                    site,
                    entries: metricEntries
                }),
                { source: 'shop_products + shop_orders + shop_inventory + user_events' }
            ),
            salesTop: buildProductBundleSuccess(rankPayloads.salesTop, { source: 'shop_orders' }),
            gmvTop: buildProductBundleSuccess(rankPayloads.gmvTop, { source: 'shop_orders' }),
            conversionTop: buildProductBundleSuccess(rankPayloads.conversionTop, { source: 'shop_orders + user_events' }),
            refundRateTop: buildProductBundleSuccess(rankPayloads.refundRateTop, { source: 'shop_orders' }),
            deliveryRiskRateTop: buildProductBundleSuccess(rankPayloads.deliveryRiskRateTop, { source: 'shop_orders' }),
            contentDrivenTop: buildProductBundleSuccess(rankPayloads.contentDrivenTop, { source: 'shop_orders + user_events' }),
            highExposureLowConversion: buildProductBundleSuccess(rankPayloads.highExposureLowConversion, { source: 'shop_orders + user_events' }),
            lowStockProducts: buildProductBundleSuccess(healthPayloads.lowStockProducts, { source: 'shop_products + shop_orders' }),
            soldOutProducts: buildProductBundleSuccess(healthPayloads.soldOutProducts, { source: 'shop_products + shop_orders' }),
            deliveryRiskProducts: buildProductBundleSuccess(healthPayloads.deliveryRiskProducts, { source: 'shop_orders' }),
            refundRiskProducts: buildProductBundleSuccess(healthPayloads.refundRiskProducts, { source: 'shop_orders' }),
            inventoryTurnoverHints: buildProductBundleSuccess(healthPayloads.inventoryTurnoverHints, { source: 'shop_products + shop_orders + shop_inventory' }),
            funnelSummary: buildProductBundleSuccess(funnelPayload.summary, { source: 'user_events + shop_orders' }),
            funnelSiteComparison: buildProductBundleSuccess(funnelPayload.siteComparison, { source: 'user_events + shop_orders' }),
            funnelProductRows: buildProductBundleSuccess(funnelPayload.productRows, { source: 'shop_products + user_events + shop_orders' })
        } : {
            summary: buildProductBundleFailure(datasetError, 'Failed to load product analytics summary'),
            trend: buildProductBundleFailure(datasetError, 'Failed to load product analytics trend'),
            siteComparison: buildProductBundleFailure(datasetError, 'Failed to load product analytics site comparison'),
            categoryBreakdown: buildProductBundleFailure(datasetError, 'Failed to load product analytics category breakdown'),
            productMatrix: buildProductBundleFailure(datasetError, 'Failed to load product analytics operating matrix'),
            salesTop: buildProductBundleFailure(datasetError, 'Failed to load product sales rank'),
            gmvTop: buildProductBundleFailure(datasetError, 'Failed to load product revenue rank'),
            conversionTop: buildProductBundleFailure(datasetError, 'Failed to load product conversion rank'),
            refundRateTop: buildProductBundleFailure(datasetError, 'Failed to load product refund-rate rank'),
            deliveryRiskRateTop: buildProductBundleFailure(datasetError, 'Failed to load product delivery-risk rank'),
            contentDrivenTop: buildProductBundleFailure(datasetError, 'Failed to load product content-driven rank'),
            highExposureLowConversion: buildProductBundleFailure(datasetError, 'Failed to load product exposure-conversion rank'),
            lowStockProducts: buildProductBundleFailure(datasetError, 'Failed to load low-stock product health'),
            soldOutProducts: buildProductBundleFailure(datasetError, 'Failed to load sold-out product health'),
            deliveryRiskProducts: buildProductBundleFailure(datasetError, 'Failed to load delivery risk product health'),
            refundRiskProducts: buildProductBundleFailure(datasetError, 'Failed to load refund risk product health'),
            inventoryTurnoverHints: buildProductBundleFailure(datasetError, 'Failed to load inventory turnover hints'),
            funnelSummary: buildProductBundleFailure(datasetError, 'Failed to load product funnel summary'),
            funnelSiteComparison: buildProductBundleFailure(datasetError, 'Failed to load product funnel site comparison'),
            funnelProductRows: buildProductBundleFailure(datasetError, 'Failed to load product funnel product comparison')
        };

        return sendJson(res, 200, {
            success: true,
            site,
            generated_at: new Date().toISOString(),
            range: rangeWindow,
            limit,
            partial_failure_count: Object.values(segments).filter((segment) => !segment.ok).length,
            segments
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load product analytics dashboard bundle'
        });
    }
};
