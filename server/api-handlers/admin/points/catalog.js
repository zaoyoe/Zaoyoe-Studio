const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');

const PACKAGE_SELECT_FIELDS = [
    'id',
    'name',
    'name_en',
    'points_amount',
    'bonus_points',
    'price_cny',
    'is_active',
    'sort_order',
    'created_at'
].join(', ');

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizePointsCatalogSite(value) {
    return normalizeAdminSite(value, { defaultValue: 'all' }) || 'all';
}

function normalizeMetricSite(value) {
    return String(value || '').trim().toLowerCase() === 'intl' ? 'intl' : 'cn';
}

function createEmptyPackageMetrics() {
    return {
        cn: { batch_count: 0, generated_count: 0, used_count: 0 },
        intl: { batch_count: 0, generated_count: 0, used_count: 0 },
        total: { batch_count: 0, generated_count: 0, used_count: 0 }
    };
}

async function loadPointsPackages(supabase) {
    const { data, error } = await supabase
        .from('points_packages')
        .select(PACKAGE_SELECT_FIELDS)
        .order('sort_order', { ascending: true })
        .order('points_amount', { ascending: true });

    if (error) throw error;
    return data || [];
}

async function loadRedemptionBatches(supabase) {
    const { data, error } = await supabase
        .from('redemption_batches')
        .select('id, package_id, total_count, used_count, status, site, created_at');

    if (error) throw error;
    return data || [];
}

function buildSummaryFromBatches(batches, siteContext) {
    const normalizedSite = normalizePointsCatalogSite(siteContext);
    const scopedBatches = normalizedSite === 'all'
        ? batches
        : batches.filter((batch) => normalizeMetricSite(batch?.site) === normalizedSite);

    return {
        package_count: 0,
        active_package_count: 0,
        batch_count: scopedBatches.length,
        generated_code_count: scopedBatches.reduce((sum, batch) => sum + Math.max(0, Number(batch?.total_count) || 0), 0),
        used_code_count: scopedBatches.reduce((sum, batch) => sum + Math.max(0, Number(batch?.used_count) || 0), 0),
        custom_batch_count: scopedBatches.filter((batch) => !String(batch?.package_id || '').trim()).length
    };
}

function attachPackageMetrics(packages, batches) {
    const packageMetrics = new Map(
        packages.map((pkg) => [String(pkg?.id || '').trim(), createEmptyPackageMetrics()])
    );

    for (const batch of batches) {
        const packageId = String(batch?.package_id || '').trim();
        if (!packageId || !packageMetrics.has(packageId)) continue;
        const metrics = packageMetrics.get(packageId);
        const site = normalizeMetricSite(batch?.site);
        const totalCount = Math.max(0, Number(batch?.total_count) || 0);
        const usedCount = Math.max(0, Number(batch?.used_count) || 0);

        metrics[site].batch_count += 1;
        metrics[site].generated_count += totalCount;
        metrics[site].used_count += usedCount;
        metrics.total.batch_count += 1;
        metrics.total.generated_count += totalCount;
        metrics.total.used_count += usedCount;
    }

    return packages.map((pkg) => {
        const metrics = packageMetrics.get(String(pkg?.id || '').trim()) || createEmptyPackageMetrics();
        return {
            ...pkg,
            total_points: Math.max(0, Number(pkg?.points_amount) || 0) + Math.max(0, Number(pkg?.bonus_points) || 0),
            metrics
        };
    });
}

module.exports = async (req, res) => {
    if (String(req.method || 'GET').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'points.manage' });
        const searchParams = getSearchParams(req);
        const siteContext = normalizePointsCatalogSite(searchParams.get('site') || req.adminSite);
        const [packages, batches] = await Promise.all([
            loadPointsPackages(supabase),
            loadRedemptionBatches(supabase)
        ]);

        const packageRows = attachPackageMetrics(packages, batches);
        const summary = buildSummaryFromBatches(batches, siteContext);
        summary.package_count = packageRows.length;
        summary.active_package_count = packageRows.filter((row) => row.is_active !== false).length;

        return sendJson(res, 200, {
            success: true,
            siteContext,
            summary,
            packages: packageRows
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Points catalog request failed'
        });
    }
};
