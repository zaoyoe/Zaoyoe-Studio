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
    buildProductRankPayloads,
    buildProductBundleSuccess,
    buildProductBundleFailure
} = require('./_product-analytics-builders');

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

module.exports = async function analyticsProductRankBundleHandler(req, res) {
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
            ? buildProductRankPayloads({
                ...dataset,
                site,
                limit
            })
            : null;

        const segments = payloads ? {
            salesTop: buildProductBundleSuccess(payloads.salesTop, { source: 'shop_orders' }),
            gmvTop: buildProductBundleSuccess(payloads.gmvTop, { source: 'shop_orders' }),
            conversionTop: buildProductBundleSuccess(payloads.conversionTop, { source: 'shop_orders + user_events' }),
            refundRateTop: buildProductBundleSuccess(payloads.refundRateTop, { source: 'shop_orders' }),
            deliveryRiskRateTop: buildProductBundleSuccess(payloads.deliveryRiskRateTop, { source: 'shop_orders' }),
            contentDrivenTop: buildProductBundleSuccess(payloads.contentDrivenTop, { source: 'shop_orders + user_events' }),
            highExposureLowConversion: buildProductBundleSuccess(payloads.highExposureLowConversion, { source: 'shop_orders + user_events' })
        } : {
            salesTop: buildProductBundleFailure(datasetError, 'Failed to load product sales rank'),
            gmvTop: buildProductBundleFailure(datasetError, 'Failed to load product revenue rank'),
            conversionTop: buildProductBundleFailure(datasetError, 'Failed to load product conversion rank'),
            refundRateTop: buildProductBundleFailure(datasetError, 'Failed to load product refund-rate rank'),
            deliveryRiskRateTop: buildProductBundleFailure(datasetError, 'Failed to load product delivery-risk rank'),
            contentDrivenTop: buildProductBundleFailure(datasetError, 'Failed to load product content-driven rank'),
            highExposureLowConversion: buildProductBundleFailure(datasetError, 'Failed to load product exposure-conversion rank')
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
            message: error?.message || 'Failed to load product analytics rank bundle'
        });
    }
};
