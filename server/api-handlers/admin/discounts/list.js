const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeSite(value) {
    return normalizeAdminSite(value, { defaultValue: 'all' }) || 'all';
}

function normalizeDiscountApplicableSite(value) {
    return normalizeAdminSite(value, { defaultValue: 'all' }) || 'all';
}

function buildScopeSummary(rows = [], site = 'all') {
    const normalizedSite = normalizeSite(site);
    const rowList = Array.isArray(rows) ? rows : [];
    const globalCount = rowList.filter((row) => normalizeDiscountApplicableSite(row?.applicable_site) === 'all').length;
    const cnCount = rowList.filter((row) => normalizeDiscountApplicableSite(row?.applicable_site) === 'cn').length;
    const intlCount = rowList.filter((row) => normalizeDiscountApplicableSite(row?.applicable_site) === 'intl').length;

    if (normalizedSite === 'all') {
        return {
            mode: 'aggregate',
            visible_count: rowList.length,
            global_count: globalCount,
            cn_count: cnCount,
            intl_count: intlCount
        };
    }

    const otherSite = normalizedSite === 'cn' ? 'intl' : 'cn';
    const siteSpecificCount = normalizedSite === 'cn' ? cnCount : intlCount;
    const otherSiteCount = otherSite === 'cn' ? cnCount : intlCount;

    return {
        mode: 'site_plus_global',
        site: normalizedSite,
        other_site: otherSite,
        visible_count: globalCount + siteSpecificCount,
        global_count: globalCount,
        site_specific_count: siteSpecificCount,
        other_site_count: otherSiteCount
    };
}

module.exports = async function adminDiscountsListHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'discounts.manage' });
        const searchParams = getSearchParams(req);
        const site = normalizeSite(searchParams.get('site') || req.adminSite);

        let query = supabase
            .from('discount_codes')
            .select('*')
            .order('created_at', { ascending: false });

        const { data, error } = await query;
        if (error) throw error;
        const allRows = Array.isArray(data) ? data : [];
        const rows = site === 'all'
            ? allRows
            : allRows.filter((row) => {
                const applicableSite = normalizeDiscountApplicableSite(row?.applicable_site);
                return applicableSite === 'all' || applicableSite === site;
            });

        return sendJson(res, 200, {
            success: true,
            site,
            scope_summary: buildScopeSummary(allRows, site),
            rows
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load discounts'
        });
    }
};
