const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    buildRangeWindow,
    normalizePositiveInteger,
    loadProductAnalyticsDataset,
    buildProductFunnelPayload,
    buildProductBundleSuccess,
    buildProductBundleFailure
} = require('./_product-analytics-builders');

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

module.exports = async function analyticsProductFunnelBundleHandler(req, res) {
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
        const limit = normalizePositiveInteger(params.get('limit'), 6, 1, 20);

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
            ? buildProductFunnelPayload({
                ...dataset,
                site,
                limit
            })
            : null;

        const segments = payload ? {
            summary: buildProductBundleSuccess(payload.summary, { source: 'user_events + shop_orders' }),
            siteComparison: buildProductBundleSuccess(payload.siteComparison, { source: 'user_events + shop_orders' }),
            productRows: buildProductBundleSuccess(payload.productRows, { source: 'shop_products + user_events + shop_orders' })
        } : {
            summary: buildProductBundleFailure(datasetError, 'Failed to load product funnel summary'),
            siteComparison: buildProductBundleFailure(datasetError, 'Failed to load product funnel site comparison'),
            productRows: buildProductBundleFailure(datasetError, 'Failed to load product funnel product comparison')
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
            message: error?.message || 'Failed to load product analytics funnel bundle'
        });
    }
};
