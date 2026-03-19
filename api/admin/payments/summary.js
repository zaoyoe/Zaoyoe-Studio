const {
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../_lib/admin');

module.exports = async function handler(req, res) {
    if (!['GET'].includes(req.method)) {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, user } = await requireAdmin(req);
        const site = typeof req.query?.site === 'string' && req.query.site.trim() ? req.query.site.trim() : null;
        const days = Number.parseInt(req.query?.days, 10);
        const normalizedDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30;

        const { data: overview, error: overviewError } = await supabase.rpc('get_payment_overview', {
            p_days: normalizedDays,
            p_site: site
        });

        if (overviewError) {
            throw overviewError;
        }

        let recentQuery = supabase
            .from('payment_orders')
            .select('id, provider_order_no, package_name, paid_amount, points_amount, status, user_id, created_at, paid_at, claimed_at, site')
            .eq('provider', 'afdian')
            .order('created_at', { ascending: false })
            .limit(20);

        if (site) {
            recentQuery = recentQuery.eq('site', site);
        }

        const { data: recentOrders, error: recentError } = await recentQuery;
        if (recentError) {
            throw recentError;
        }

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            actionType: 'payments.summary.view',
            details: {
                site,
                days: normalizedDays
            }
        });

        return sendJson(res, 200, {
            success: true,
            overview,
            recent_orders: recentOrders || []
        });
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        return sendJson(res, statusCode, {
            success: false,
            message: error.message || 'Failed to load payment summary'
        });
    }
};
