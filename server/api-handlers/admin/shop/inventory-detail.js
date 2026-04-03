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

async function loadOrderForInventory(supabase, inventoryRecord) {
    const status = normalizeText(inventoryRecord?.status, 40).toLowerCase();
    const inventoryId = normalizeText(inventoryRecord?.id, 160);
    const buyerId = normalizeText(inventoryRecord?.buyer_id, 160);
    const productId = normalizeText(inventoryRecord?.product_id, 160);
    const shouldLookupOrder = ['sold', 'frozen', 'fault'].includes(status) || Boolean(buyerId);

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

    if (!orderRecord && buyerId) {
        orderRecord = await selectSingleRow(
            supabase
                .from('shop_orders')
                .select('*')
                .eq('user_id', buyerId)
                .eq('product_id', productId)
                .is('inventory_id', null)
                .order('created_at', { ascending: false })
        );
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
        return orderRecord;
    }

    return {
        ...orderRecord,
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

async function loadSameOrderItems(supabase, inventoryId, buyerId, anchorTime) {
    if (!buyerId || !anchorTime) {
        return [];
    }

    const anchorDate = new Date(anchorTime);
    if (Number.isNaN(anchorDate.getTime())) {
        return [];
    }

    const { data, error } = await supabase
        .from('shop_inventory')
        .select('id, content, sold_at')
        .eq('buyer_id', buyerId)
        .gte('sold_at', new Date(anchorDate.getTime() - 60000).toISOString())
        .lte('sold_at', new Date(anchorDate.getTime() + 60000).toISOString())
        .neq('id', inventoryId);

    if (error) {
        throw error;
    }

    return (Array.isArray(data) ? data : []).map((row) => ({
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
        const anchorTime = normalizeText(order?.created_at || inventory?.sold_at, 80) || null;
        const [historyItems, sameOrderItems] = await Promise.all([
            loadHistoryItems(supabase, inventory, inventoryId, buyerId),
            loadSameOrderItems(supabase, inventoryId, buyerId, anchorTime)
        ]);

        return sendJson(res, 200, {
            success: true,
            inventory,
            order,
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
