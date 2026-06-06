const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    normalizeText,
    loadInventoryRecordsByIds,
    loadOrderItemsByOrderIds,
    collectLinkedInventoryIds,
    buildLinkedInventoryItems,
    buildResolvedItems,
    resolveOrderLinkageSource
} = require('./_order-linkage');
const {
    buildOrderProfitAttribution
} = require('./_profit');
const {
    attachProfitLedgerSyncResult,
    syncOrderProfitLedger
} = require('./_profit-ledger');
const {
    loadPointLotConsumptionsByOrderIds,
    summarizePointLotConsumptions
} = require('./_point-lots');

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeSite(value) {
    return normalizeAdminSite(value, { defaultValue: 'all' }) || 'all';
}

function normalizeInteger(value, fallback) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeRefundStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized && normalized !== 'all' ? normalized : 'all';
}

function normalizeDeliveryStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    const allowed = new Set(['all', 'pending', 'processing', 'retry_waiting', 'requeued', 'dead_letter', 'delivered']);
    return allowed.has(normalized) ? normalized : 'all';
}

function escapePostgrestLikeValue(value) {
    return String(value || '')
        .trim()
        .replace(/\\/g, '\\\\')
        .replace(/,/g, '\\,')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
}

function escapePostgrestEqValue(value) {
    return String(value || '')
        .trim()
        .replace(/\\/g, '\\\\')
        .replace(/,/g, '\\,')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function filterUuidValues(values = []) {
    return [...new Set(
        (Array.isArray(values) ? values : [])
            .map((value) => normalizeText(value, 160))
            .filter((value) => value && isUuid(value))
    )];
}

function buildOrderSearchExpression(query) {
    const normalizedQuery = normalizeText(query, 160);
    if (!normalizedQuery) {
        return '';
    }

    const escapedLikeQuery = escapePostgrestLikeValue(normalizedQuery);
    const filters = [
        `snapshot_product_name.ilike.%${escapedLikeQuery}%`
    ];

    if (normalizedQuery.length >= 3 || /[a-z_-]/i.test(normalizedQuery)) {
        filters.push(
            `source_channel.ilike.%${escapedLikeQuery}%`,
            `channel_account_key.ilike.%${escapedLikeQuery}%`,
            `external_order_id.ilike.%${escapedLikeQuery}%`
        );
    }

    if (isUuid(normalizedQuery)) {
        const escapedEqQuery = escapePostgrestEqValue(normalizedQuery);
        filters.unshift(
            `id.eq.${escapedEqQuery}`,
            `product_id.eq.${escapedEqQuery}`,
            `user_id.eq.${escapedEqQuery}`
        );
    }

    return filters.join(',');
}

async function loadProfilesByIds(supabase, userIds = []) {
    const ids = filterUuidValues(userIds);
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

async function searchProfileIdsByQuery(supabase, query) {
    const normalizedQuery = normalizeText(query, 160);
    if (!normalizedQuery) {
        return [];
    }

    const escapedQuery = escapePostgrestLikeValue(normalizedQuery);
    const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .or([
            `username.ilike.%${escapedQuery}%`,
            `email.ilike.%${escapedQuery}%`
        ].join(','))
        .range(0, 49);

    if (error) {
        throw error;
    }

    return [...new Set((Array.isArray(data) ? data : []).map((row) => normalizeText(row?.id)).filter(Boolean))];
}

async function queryOrdersByUserIds(supabase, { site, userIds, refundStatus, deliveryStatus, page, pageSize }) {
    const normalizedUserIds = filterUuidValues(userIds);
    if (!normalizedUserIds.length) {
        return {
            rows: [],
            count: 0
        };
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let queryBuilder = supabase
        .from('shop_orders')
        .select('*', { count: 'exact' })
        .in('user_id', normalizedUserIds)
        .order('created_at', { ascending: false })
        .range(from, to);

    if (site !== 'all') {
        queryBuilder = queryBuilder.eq('site', site);
    }

    if (normalizeRefundStatus(refundStatus) !== 'all') {
        queryBuilder = queryBuilder.eq('refund_status', normalizeRefundStatus(refundStatus));
    }

    if (normalizeDeliveryStatus(deliveryStatus) !== 'all') {
        queryBuilder = queryBuilder.eq('delivery_status', normalizeDeliveryStatus(deliveryStatus));
    }

    const { data, count, error } = await queryBuilder;
    if (error) {
        throw error;
    }

    return {
        rows: Array.isArray(data) ? data : [],
        count: Number(count) || 0
    };
}

async function loadAuthEmailsByIds(adminSupabase, userIds = []) {
    const ids = filterUuidValues(userIds);
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

async function queryOrders(supabase, { site, query, refundStatus, deliveryStatus, page, pageSize }) {
    const limit = pageSize;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const normalizedQuery = normalizeText(query);
    const searchedById = /^SHOP_ORDER_/i.test(normalizedQuery);
    const cleanedShopOrderId = searchedById
        ? normalizeText(normalizedQuery.replace(/^SHOP_ORDER_/i, ''), 160)
        : '';

    let queryBuilder = supabase
        .from('shop_orders')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

    if (site !== 'all') {
        queryBuilder = queryBuilder.eq('site', site);
    }

    if (normalizeRefundStatus(refundStatus) !== 'all') {
        queryBuilder = queryBuilder.eq('refund_status', normalizeRefundStatus(refundStatus));
    }

    if (normalizeDeliveryStatus(deliveryStatus) !== 'all') {
        queryBuilder = queryBuilder.eq('delivery_status', normalizeDeliveryStatus(deliveryStatus));
    }

    if (searchedById) {
        if (isUuid(cleanedShopOrderId)) {
            queryBuilder = queryBuilder
                .eq('id', cleanedShopOrderId)
                .range(0, 0);
        } else {
            queryBuilder = null;
        }
    } else {
        if (normalizedQuery) {
            queryBuilder = queryBuilder.or(buildOrderSearchExpression(normalizedQuery));
        }
        queryBuilder = queryBuilder.range(from, to);
    }

    let data = [];
    let count = 0;
    if (queryBuilder) {
        const result = await queryBuilder;
        data = result.data;
        count = result.count;
        if (result.error) throw result.error;
    }

    if (searchedById && cleanedShopOrderId && (!data || data.length === 0)) {
        const cleanedId = cleanedShopOrderId;
        const ledgerFilters = [
            `reference_id.ilike.%${escapePostgrestLikeValue(cleanedId)}%`
        ];
        if (isUuid(cleanedId)) {
            ledgerFilters.unshift(`id.eq.${escapePostgrestEqValue(cleanedId)}`);
        }

        const { data: ledgerData, error: ledgerError } = await supabase
            .from('points_ledger')
            .select('id, user_id, reference_id, created_at')
            .or(ledgerFilters.join(','))
            .limit(5);

        if (!ledgerError && ledgerData?.length) {
            const ledgerRecord = ledgerData[0];
            let orderId = null;
            if (String(ledgerRecord.reference_id || '').startsWith('SHOP_ORDER_')) {
                orderId = String(ledgerRecord.reference_id).replace('SHOP_ORDER_', '');
            }

            if (orderId && isUuid(orderId)) {
                const directResult = await supabase
                    .from('shop_orders')
                    .select('*', { count: 'exact' })
                    .eq('id', orderId);
                if (!directResult.error && directResult.data?.length) {
                    data = directResult.data;
                    count = directResult.count || directResult.data.length;
                }
            }

        }
    }

    const rows = Array.isArray(data) ? data : [];
    const totalCount = Number(count) || 0;

    if (!rows.length && normalizedQuery && !searchedById) {
        const profileIds = await searchProfileIdsByQuery(supabase, normalizedQuery);
        if (profileIds.length) {
            return queryOrdersByUserIds(supabase, {
                site,
                userIds: profileIds,
                refundStatus,
                deliveryStatus,
                page,
                pageSize
            });
        }
    }

    return {
        rows,
        count: totalCount
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
        const { supabase, adminSupabase, user } = await requireAdmin(req, { permission: 'shop.manage' });
        const searchParams = getSearchParams(req);
        const site = normalizeSite(searchParams.get('site') || req.adminSite);
        const query = normalizeText(searchParams.get('query'));
        const refundStatus = normalizeRefundStatus(searchParams.get('refundStatus'));
        const deliveryStatus = normalizeDeliveryStatus(searchParams.get('deliveryStatus'));
        const page = normalizeInteger(searchParams.get('page'), 1);
        const pageSize = Math.min(normalizeInteger(searchParams.get('pageSize'), 20), 100);

        const { rows, count } = await queryOrders(supabase, {
            site,
            query,
            refundStatus,
            deliveryStatus,
            page,
            pageSize
        });

        const userIds = rows.map((row) => row?.user_id);
        const orderItemsByOrderId = await loadOrderItemsByOrderIds(supabase, rows.map((row) => row?.id));
        const linkedInventoryIds = rows.flatMap((row) => (
            collectLinkedInventoryIds(row, orderItemsByOrderId.get(normalizeText(row?.id, 160)) || [])
        ));
        const orderIds = rows.map((row) => row?.id);
        const [profileMap, authEmailMap, inventoryRecordsById, pointLotConsumptionsByOrderId] = await Promise.all([
            loadProfilesByIds(supabase, userIds),
            loadAuthEmailsByIds(adminSupabase, userIds),
            loadInventoryRecordsByIds(supabase, linkedInventoryIds),
            loadPointLotConsumptionsByOrderIds(supabase, orderIds)
        ]);

        const enrichedRows = await Promise.all(rows.map(async (row) => {
            const userId = normalizeText(row?.user_id);
            const profile = profileMap.get(userId) || {};
            const orderId = normalizeText(row?.id, 160);
            const orderItems = orderItemsByOrderId.get(orderId) || [];
            const linkedItems = buildLinkedInventoryItems(row, orderItems, inventoryRecordsById);
            const pointLotSummary = summarizePointLotConsumptions(
                pointLotConsumptionsByOrderId.get(orderId) || [],
                Number(row?.price_paid || row?.total_price || 0) || 0
            );
            const profitAttribution = buildOrderProfitAttribution(row, linkedItems, {
                pointLotSummary
            });
            const profitLedgerSync = await syncOrderProfitLedger(supabase, row, profitAttribution, {
                userId: user?.id
            });
            const resolvedProfitAttribution = attachProfitLedgerSyncResult(profitAttribution, profitLedgerSync);
            return {
                ...row,
                profiles: {
                    id: userId,
                    username: normalizeText(profile?.username) || 'Unknown',
                    avatar_url: profile?.avatar_url || null,
                    email: normalizeText(profile?.email) || authEmailMap.get(userId) || null
                },
                linkage_source: resolveOrderLinkageSource(row, orderItems),
                linked_inventory_ids: collectLinkedInventoryIds(row, orderItems),
                linked_inventory_items: linkedItems,
                order_item_count: orderItems.length,
                resolved_items: buildResolvedItems(row, orderItems, inventoryRecordsById),
                profit_attribution: resolvedProfitAttribution
            };
        }));

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
