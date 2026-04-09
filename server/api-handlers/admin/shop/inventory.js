const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    normalizeText,
    loadOrderLinksByInventoryIds
} = require('./_order-linkage');

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizePositiveInteger(value, fallback, maxValue = 10000) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    return Math.min(parsed, maxValue);
}

async function resolveMissingOrderIds(supabase, items = []) {
    const safeItems = Array.isArray(items) ? items : [];
    const candidates = safeItems.filter((item) => (
        ['sold', 'frozen', 'fault'].includes(String(item?.status || '').trim().toLowerCase())
        && !normalizeText(item?.order_id, 160)
        && normalizeText(item?.id, 160)
    ));

    if (!candidates.length) {
        return safeItems;
    }

    const orderLinksByInventoryId = await loadOrderLinksByInventoryIds(
        supabase,
        candidates.map((item) => item?.id)
    );

    return safeItems.map((item) => {
        if (
            !['sold', 'frozen', 'fault'].includes(String(item?.status || '').trim().toLowerCase())
            || normalizeText(item?.order_id, 160)
            || !normalizeText(item?.id, 160)
        ) {
            return item;
        }

        const link = orderLinksByInventoryId.get(normalizeText(item?.id, 160));
        if (!link?.order_id) {
            return item;
        }

        return {
            ...item,
            order_id: link.order_id || item?.order_id || null,
            order_link_source: link.source || null
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

        const items = await resolveMissingOrderIds(supabase, data.items);

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
