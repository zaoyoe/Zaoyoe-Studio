const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    buildRangeWindow,
    normalizePositiveInteger,
    loadProductAnalyticsDataset,
    buildProductDetailPayload,
    buildProductBundleSuccess,
    buildProductBundleFailure
} = require('./_product-analytics-builders');

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

module.exports = async function analyticsProductDetailBundleHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const params = getQueryParams(req);
        const productId = String(params.get('productId') || '').trim();
        if (!productId) {
            return sendJson(res, 400, {
                success: false,
                message: 'Missing productId'
            });
        }

        const { supabase } = await requireAdmin(req, { permission: 'analytics.view' });
        const site = normalizeAdminSite(params.get('site') || req.adminSite, { defaultValue: 'all' }) || 'all';
        const rangeWindow = buildRangeWindow(params);
        const recentOrderLimit = normalizePositiveInteger(params.get('recentOrderLimit'), 6, 1, 20);

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

        const payload = dataset
            ? buildProductDetailPayload({
                ...dataset,
                site,
                productId,
                startIso: rangeWindow.startIso,
                endIso: rangeWindow.endIso,
                recentOrderLimit
            })
            : null;

        const segments = payload ? {
            summary: buildProductBundleSuccess(payload.summary, { source: 'shop_products + shop_orders + shop_inventory + user_events' }),
            trend: buildProductBundleSuccess(payload.trend, { source: 'shop_orders + user_events' }),
            funnel: buildProductBundleSuccess(payload.funnel, { source: 'user_events + shop_orders' }),
            recentOrders: buildProductBundleSuccess(payload.recentOrders, { source: 'shop_orders' })
        } : {
            summary: buildProductBundleFailure(datasetError, 'Failed to load product detail summary'),
            trend: buildProductBundleFailure(datasetError, 'Failed to load product detail trend'),
            funnel: buildProductBundleFailure(datasetError, 'Failed to load product detail funnel'),
            recentOrders: buildProductBundleFailure(datasetError, 'Failed to load product detail recent orders')
        };

        return sendJson(res, 200, {
            success: true,
            site,
            product_id: productId,
            generated_at: new Date().toISOString(),
            range: rangeWindow,
            partial_failure_count: Object.values(segments).filter((segment) => !segment.ok).length,
            segments
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load product analytics detail bundle'
        });
    }
};
