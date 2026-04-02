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

        if (site !== 'all') {
            query = query.eq('applicable_site', site);
        }

        const { data, error } = await query;
        if (error) throw error;

        return sendJson(res, 200, {
            success: true,
            site,
            rows: Array.isArray(data) ? data : []
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load discounts'
        });
    }
};
