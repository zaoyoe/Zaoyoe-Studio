const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    normalizeText,
    loadOrderLinksByInventoryIds,
    loadInventoryRecordsByIds
} = require('./_order-linkage');

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

async function selectSingleRow(queryBuilder) {
    const { data, error } = await queryBuilder.limit(1);
    if (error) {
        throw error;
    }
    return Array.isArray(data) ? (data[0] || null) : (data || null);
}

async function loadInventoryRecord(supabase, inventoryId) {
    const { data, error } = await supabase
        .from('shop_inventory')
        .select('*, shop_products(name)')
        .eq('id', inventoryId)
        .single();

    if (error) {
        throw error;
    }

    return data || null;
}

async function loadProcurementContext(supabase, sourceBatchId) {
    const normalizedBatchId = normalizeText(sourceBatchId, 160);
    if (!normalizedBatchId) {
        return {
            procurementBatch: null,
            inventorySource: null
        };
    }

    const procurementBatch = await selectSingleRow(
        supabase
            .from('shop_procurement_batches')
            .select('*')
            .eq('id', normalizedBatchId)
    );

    if (!procurementBatch?.source_id) {
        return {
            procurementBatch,
            inventorySource: null
        };
    }

    const inventorySource = await selectSingleRow(
        supabase
            .from('shop_inventory_sources')
            .select('*')
            .eq('id', procurementBatch.source_id)
    );

    return {
        procurementBatch,
        inventorySource
    };
}

async function loadOrderForInventory(supabase, inventoryRecord) {
    const status = normalizeText(inventoryRecord?.status, 40).toLowerCase();
    const inventoryId = normalizeText(inventoryRecord?.id, 160);
    const shouldLookupOrder = ['sold', 'frozen', 'fault'].includes(status) || Boolean(inventoryId);

    if (!shouldLookupOrder) {
        return null;
    }

    let orderRecord = await selectSingleRow(
        supabase
            .from('shop_orders')
            .select('*')
            .eq('inventory_id', inventoryId)
            .order('created_at', { ascending: false })
    );
    let orderLinkSource = orderRecord ? 'order' : null;

    if (!orderRecord && inventoryId) {
        const linkage = await loadOrderLinksByInventoryIds(supabase, [inventoryId]);
        const linkedOrderId = linkage.get(inventoryId)?.order_id || null;
        if (linkedOrderId) {
            orderRecord = await selectSingleRow(
                supabase
                    .from('shop_orders')
                    .select('*')
                    .eq('id', linkedOrderId)
                    .order('created_at', { ascending: false })
            );
            orderLinkSource = linkage.get(inventoryId)?.source || 'order_item';
        }
    }

    if (!orderRecord?.user_id) {
        return orderRecord || null;
    }

    const profileRecord = await selectSingleRow(
        supabase
            .from('profiles')
            .select('email, username')
            .eq('id', orderRecord.user_id)
    );

    if (!profileRecord) {
        return {
            ...orderRecord,
            order_link_source: orderLinkSource
        };
    }

    return {
        ...orderRecord,
        order_link_source: orderLinkSource,
        profiles: profileRecord
    };
}

async function loadHistoryItems(supabase, inventoryRecord, inventoryId, buyerId) {
    if (!buyerId) {
        return [];
    }

    const { data, error } = await supabase
        .from('shop_inventory')
        .select('id, content, sold_at')
        .eq('buyer_id', buyerId)
        .eq('product_id', inventoryRecord.product_id)
        .eq('status', 'sold')
        .neq('id', inventoryId)
        .order('sold_at', { ascending: false })
        .limit(10);

    if (error) {
        throw error;
    }

    return (Array.isArray(data) ? data : []).map((row) => ({
        shop_inventory: row
    }));
}

async function loadSameOrderItems(supabase, orderId, inventoryId) {
    if (!orderId) {
        return [];
    }

    const { data, error } = await supabase
        .from('shop_order_items')
        .select('inventory_id')
        .eq('order_id', orderId);

    if (error) {
        throw error;
    }

    const relatedInventoryIds = (Array.isArray(data) ? data : [])
        .map((row) => normalizeText(row?.inventory_id, 160))
        .filter((id) => id && id !== inventoryId);

    if (!relatedInventoryIds.length) {
        return [];
    }

    const inventoryRecordsById = await loadInventoryRecordsByIds(
        supabase,
        relatedInventoryIds,
        'id, content, sold_at'
    );

    return relatedInventoryIds
        .map((relatedInventoryId) => inventoryRecordsById.get(relatedInventoryId))
        .filter(Boolean)
        .map((row) => ({
        shop_inventory: row
    }));
}

module.exports = async function adminShopInventoryDetailHandler(req, res) {
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
        const inventoryId = normalizeText(searchParams.get('id') || searchParams.get('inventoryId'), 160);

        if (!inventoryId) {
            return sendJson(res, 400, {
                success: false,
                message: 'Missing inventory id'
            });
        }

        const inventory = await loadInventoryRecord(supabase, inventoryId);
        if (!inventory) {
            return sendJson(res, 404, {
                success: false,
                message: 'Inventory record not found'
            });
        }

        const order = await loadOrderForInventory(supabase, inventory);
        const buyerId = normalizeText(order?.user_id || inventory?.buyer_id, 160);
        const [historyItems, sameOrderItems] = await Promise.all([
            loadHistoryItems(supabase, inventory, inventoryId, buyerId),
            loadSameOrderItems(supabase, normalizeText(order?.id, 160), inventoryId)
        ]);
        const procurementContext = await loadProcurementContext(supabase, inventory?.source_batch_id);

        return sendJson(res, 200, {
            success: true,
            inventory,
            order,
            procurementBatch: procurementContext.procurementBatch,
            inventorySource: procurementContext.inventorySource,
            historyItems,
            sameOrderItems
        });
    } catch (error) {
        if (Number(error?.code) === 406 || String(error?.message || '').toLowerCase().includes('no rows')) {
            return sendJson(res, 404, {
                success: false,
                message: 'Inventory record not found'
            });
        }

        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load inventory detail'
        });
    }
};
