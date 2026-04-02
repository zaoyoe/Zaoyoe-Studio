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

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeInteger(value, fallback) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function loadProfilesByIds(supabase, userIds = []) {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(normalizeText).filter(Boolean))];
    if (!ids.length) {
        return new Map();
    }

    let data = null;
    let error = null;

    ({ data, error } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, email')
        .in('id', ids));

    if (error) {
        ({ data, error } = await supabase
            .from('profiles')
            .select('id, username, avatar_url')
            .in('id', ids));
    }

    if (error) throw error;

    return new Map((data || []).map((row) => [normalizeText(row?.id), row]));
}

async function loadAuthEmailsByIds(adminSupabase, userIds = []) {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(normalizeText).filter(Boolean))];
    if (!ids.length || !adminSupabase?.auth?.admin?.getUserById) {
        return new Map();
    }

    const rows = await Promise.all(ids.map(async (id) => {
        try {
            const { data, error } = await adminSupabase.auth.admin.getUserById(id);
            if (error || !data?.user) return [id, null];
            return [id, normalizeText(data.user.email) || null];
        } catch (_) {
            return [id, null];
        }
    }));

    return new Map(rows);
}

async function loadInventoryContentMap(supabase, inventoryIds = []) {
    const ids = [...new Set((Array.isArray(inventoryIds) ? inventoryIds : []).map(normalizeText).filter(Boolean))];
    if (!ids.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('shop_inventory')
        .select('id, content')
        .in('id', ids);

    if (error) throw error;

    return new Map((data || []).map((row) => [normalizeText(row?.id), row?.content || '']));
}

async function loadFallbackInventoryContent(supabase, orders = []) {
    const safeOrders = Array.isArray(orders) ? orders : [];
    const userIds = [...new Set(
        safeOrders
            .filter((row) => !row?.inventory_id && row?.user_id)
            .map((row) => normalizeText(row.user_id))
            .filter(Boolean)
    )];

    if (!userIds.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('shop_inventory')
        .select('id, content, buyer_id, sold_at, product_id')
        .in('buyer_id', userIds)
        .eq('status', 'sold')
        .order('sold_at', { ascending: false });

    if (error) throw error;

    const buckets = new Map();
    (data || []).forEach((row) => {
        const key = `${normalizeText(row?.buyer_id)}:${normalizeText(row?.product_id)}`;
        const existing = buckets.get(key) || [];
        existing.push(row?.content || '');
        buckets.set(key, existing);
    });

    const fallbackMap = new Map();
    safeOrders.forEach((order) => {
        if (order?.inventory_id || !order?.user_id) return;
        const key = `${normalizeText(order.user_id)}:${normalizeText(order.product_id)}`;
        const bucket = buckets.get(key);
        if (!bucket?.length) return;
        const count = Math.max(1, Number.parseInt(String(order?.item_count || '1'), 10) || 1);
        fallbackMap.set(normalizeText(order.id), bucket.splice(0, count));
    });

    return fallbackMap;
}

function buildResolvedItems(order, inventoryContentMap, fallbackContentMap) {
    const safeItems = Array.isArray(order?.items) ? order.items.filter(Boolean) : [];
    if (safeItems.length) {
        return safeItems;
    }

    const productName = normalizeText(order?.snapshot_product_name) || 'Unknown';
    const fallbackContents = fallbackContentMap.get(normalizeText(order?.id)) || [];
    if (fallbackContents.length) {
        return fallbackContents.map((content) => ({
            product_name: productName,
            content,
            price: order?.price_paid || 0
        }));
    }

    const inventoryContent = inventoryContentMap.get(normalizeText(order?.inventory_id)) || '无内容';
    return [{
        product_name: productName,
        content: inventoryContent,
        price: order?.price_paid || 0
    }];
}

async function queryOrders(supabase, { site, query, page, pageSize }) {
    const limit = pageSize;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const normalizedQuery = normalizeText(query);
    const searchedById = normalizedQuery.includes('-');

    let queryBuilder = supabase
        .from('shop_orders')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

    if (site !== 'all') {
        queryBuilder = queryBuilder.eq('site', site);
    }

    if (searchedById) {
        queryBuilder = queryBuilder.eq('id', normalizedQuery.replace(/^SHOP_ORDER_/i, ''));
    } else {
        queryBuilder = queryBuilder.range(from, to);
    }

    let { data, count, error } = await queryBuilder;
    if (error) throw error;

    if (searchedById && (!data || data.length === 0)) {
        const cleanedId = normalizedQuery.replace(/^SHOP_ORDER_/i, '');
        const { data: ledgerData, error: ledgerError } = await supabase
            .from('points_ledger')
            .select('id, user_id, reference_id, created_at')
            .or(`id.eq.${cleanedId},reference_id.ilike.%${cleanedId}%`)
            .limit(5);

        if (!ledgerError && ledgerData?.length) {
            const ledgerRecord = ledgerData[0];
            let orderId = null;
            if (String(ledgerRecord.reference_id || '').startsWith('SHOP_ORDER_')) {
                orderId = String(ledgerRecord.reference_id).replace('SHOP_ORDER_', '');
            }

            if (orderId) {
                const directResult = await supabase
                    .from('shop_orders')
                    .select('*', { count: 'exact' })
                    .eq('id', orderId);
                if (!directResult.error && directResult.data?.length) {
                    data = directResult.data;
                    count = directResult.count || directResult.data.length;
                }
            }

            if ((!data || !data.length) && ledgerRecord.user_id && ledgerRecord.created_at) {
                const ledgerTime = new Date(ledgerRecord.created_at);
                const timeWindow = 60 * 1000;
                let userOrdersQuery = supabase
                    .from('shop_orders')
                    .select('*', { count: 'exact' })
                    .eq('user_id', ledgerRecord.user_id)
                    .gte('created_at', new Date(ledgerTime.getTime() - timeWindow).toISOString())
                    .lte('created_at', new Date(ledgerTime.getTime() + timeWindow).toISOString())
                    .order('created_at', { ascending: false });

                if (site !== 'all') {
                    userOrdersQuery = userOrdersQuery.eq('site', site);
                }

                const userOrdersResult = await userOrdersQuery;
                if (!userOrdersResult.error && userOrdersResult.data?.length) {
                    data = userOrdersResult.data;
                    count = userOrdersResult.count || userOrdersResult.data.length;
                }
            }
        }
    }

    return {
        rows: Array.isArray(data) ? data : [],
        count: Number(count) || 0
    };
}

module.exports = async function adminShopOrdersHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase, adminSupabase } = await requireAdmin(req, { permission: 'shop.manage' });
        const searchParams = getSearchParams(req);
        const site = normalizeSite(searchParams.get('site') || req.adminSite);
        const query = normalizeText(searchParams.get('query'));
        const page = normalizeInteger(searchParams.get('page'), 1);
        const pageSize = Math.min(normalizeInteger(searchParams.get('pageSize'), 20), 100);

        const { rows, count } = await queryOrders(supabase, {
            site,
            query,
            page,
            pageSize
        });

        const userIds = rows.map((row) => row?.user_id);
        const inventoryIds = rows.map((row) => row?.inventory_id);
        const [profileMap, authEmailMap, inventoryContentMap, fallbackContentMap] = await Promise.all([
            loadProfilesByIds(supabase, userIds),
            loadAuthEmailsByIds(adminSupabase, userIds),
            loadInventoryContentMap(supabase, inventoryIds),
            loadFallbackInventoryContent(supabase, rows)
        ]);

        const enrichedRows = rows.map((row) => {
            const userId = normalizeText(row?.user_id);
            const profile = profileMap.get(userId) || {};
            return {
                ...row,
                profiles: {
                    id: userId,
                    username: normalizeText(profile?.username) || 'Unknown',
                    avatar_url: profile?.avatar_url || null,
                    email: normalizeText(profile?.email) || authEmailMap.get(userId) || null
                },
                resolved_items: buildResolvedItems(row, inventoryContentMap, fallbackContentMap)
            };
        });

        return sendJson(res, 200, {
            success: true,
            site,
            page,
            pageSize,
            count,
            rows: enrichedRows
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load shop orders'
        });
    }
};
