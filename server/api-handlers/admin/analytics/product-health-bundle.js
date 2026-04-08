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
    buildProductHealthPayloads,
    buildProductBundleSuccess,
    buildProductBundleFailure
} = require('./_product-analytics-builders');

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

module.exports = async function analyticsProductHealthBundleHandler(req, res) {
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

        const payloads = dataset
            ? buildProductHealthPayloads({
                ...dataset,
                site,
                limit
            })
            : null;

        const segments = payloads ? {
            lowStockProducts: buildProductBundleSuccess(payloads.lowStockProducts, { source: 'shop_products + shop_orders' }),
            soldOutProducts: buildProductBundleSuccess(payloads.soldOutProducts, { source: 'shop_products + shop_orders' }),
            deliveryRiskProducts: buildProductBundleSuccess(payloads.deliveryRiskProducts, { source: 'shop_orders' }),
            refundRiskProducts: buildProductBundleSuccess(payloads.refundRiskProducts, { source: 'shop_orders' }),
            inventoryTurnoverHints: buildProductBundleSuccess(payloads.inventoryTurnoverHints, { source: 'shop_products + shop_orders + shop_inventory' })
        } : {
            lowStockProducts: buildProductBundleFailure(datasetError, 'Failed to load low-stock product health'),
            soldOutProducts: buildProductBundleFailure(datasetError, 'Failed to load sold-out product health'),
            deliveryRiskProducts: buildProductBundleFailure(datasetError, 'Failed to load delivery risk product health'),
            refundRiskProducts: buildProductBundleFailure(datasetError, 'Failed to load refund risk product health'),
            inventoryTurnoverHints: buildProductBundleFailure(datasetError, 'Failed to load inventory turnover hints')
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
            message: error?.message || 'Failed to load product analytics health bundle'
        });
    }
};
