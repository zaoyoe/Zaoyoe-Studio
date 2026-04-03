const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');

module.exports = async function adminShopCategoriesHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'shop.manage' });
        const { data, error } = await supabase
            .from('shop_categories')
            .select('*')
            .order('sort_order');

        if (error) {
            throw error;
        }

        return sendJson(res, 200, {
            success: true,
            rows: Array.isArray(data) ? data : []
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load shop categories'
        });
    }
};
