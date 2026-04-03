const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeText(value, maxLength = 200) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizePositiveInteger(value, fallback, maxValue = 10000) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    return Math.min(parsed, maxValue);
}

function normalizeBoolean(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

async function resolveMissingOrderIds(supabase, items = []) {
    const safeItems = Array.isArray(items) ? items : [];
    const candidates = safeItems.filter((item) => (
        String(item?.status || '').trim().toLowerCase() === 'sold'
        && !normalizeText(item?.order_id, 160)
        && normalizeText(item?.buyer_id, 160)
        && normalizeText(item?.product_id, 160)
    ));

    if (!candidates.length) {
        return safeItems;
    }

    const buyerIds = [...new Set(candidates.map((item) => normalizeText(item?.buyer_id, 160)).filter(Boolean))];
    const productIds = [...new Set(candidates.map((item) => normalizeText(item?.product_id, 160)).filter(Boolean))];

    if (!buyerIds.length || !productIds.length) {
        return safeItems;
    }

    const { data, error } = await supabase
        .from('shop_orders')
        .select('id, user_id, product_id, created_at')
        .in('user_id', buyerIds)
        .in('product_id', productIds)
        .is('inventory_id', null)
        .order('created_at', { ascending: false });

    if (error) {
        throw error;
    }

    const orphanPool = Array.isArray(data) ? [...data] : [];
    return safeItems.map((item) => {
        if (
            String(item?.status || '').trim().toLowerCase() !== 'sold'
            || normalizeText(item?.order_id, 160)
            || !normalizeText(item?.buyer_id, 160)
            || !normalizeText(item?.product_id, 160)
        ) {
            return item;
        }

        const matchIndex = orphanPool.findIndex((entry) => (
            normalizeText(entry?.user_id, 160) === normalizeText(item?.buyer_id, 160)
            && normalizeText(entry?.product_id, 160) === normalizeText(item?.product_id, 160)
        ));

        if (matchIndex === -1) {
            return item;
        }

        const [matchedOrder] = orphanPool.splice(matchIndex, 1);
        return {
            ...item,
            order_id: matchedOrder?.id || item?.order_id || null
        };
    });
}

module.exports = async function adminShopInventoryHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'shop.manage' });
        const searchParams = getSearchParams(req);
        const page = normalizePositiveInteger(searchParams.get('page'), 1, 100000);
        const pageSize = normalizePositiveInteger(searchParams.get('pageSize'), 10, 10000);
        const productId = normalizeText(searchParams.get('productId') || searchParams.get('product_id'), 160) || null;
        const status = normalizeText(searchParams.get('status'), 40) || null;
        const search = normalizeText(searchParams.get('search'), 200) || null;
        const dateFrom = normalizeText(searchParams.get('dateFrom') || searchParams.get('date_from'), 80) || null;
        const dateTo = normalizeText(searchParams.get('dateTo') || searchParams.get('date_to'), 80) || null;
        const includeOrderHints = normalizeBoolean(searchParams.get('includeOrderHints') || searchParams.get('include_order_hints'));

        const { data, error } = await supabase.rpc('fn_admin_list_inventory', {
            p_product_id: productId,
            p_status: status,
            p_search: search,
            p_page: page,
            p_page_size: pageSize,
            p_date_from: dateFrom,
            p_date_to: dateTo
        });

        if (error) {
            throw error;
        }

        if (!data || data.success !== true) {
            return sendJson(res, 400, {
                success: false,
                message: data?.message || 'Failed to load inventory'
            });
        }

        const items = includeOrderHints
            ? await resolveMissingOrderIds(supabase, data.items)
            : (Array.isArray(data.items) ? data.items : []);

        return sendJson(res, 200, {
            success: true,
            page,
            pageSize,
            total: Number(data.total || 0),
            stats: data.stats && typeof data.stats === 'object' ? data.stats : {},
            items
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load inventory'
        });
    }
};
