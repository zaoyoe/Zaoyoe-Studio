function normalizeText(value, maxLength = 200) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function uniqueNormalized(values = [], maxLength = 200) {
    return [...new Set(
        (Array.isArray(values) ? values : [])
            .map((value) => normalizeText(value, maxLength))
            .filter(Boolean)
    )];
}

async function loadInventoryRecordsByIds(supabase, inventoryIds = [], columns = 'id, content, status, buyer_id, sold_at, remark, product_id, sku_id, source_batch_id, purchase_unit_cost, purchase_currency, purchase_exchange_rate_to_cny, purchase_unit_cost_cny') {
    const ids = uniqueNormalized(inventoryIds, 160);
    if (!ids.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('shop_inventory')
        .select(columns)
        .in('id', ids);

    if (error) {
        throw error;
    }

    return new Map((Array.isArray(data) ? data : []).map((row) => [normalizeText(row?.id, 160), row]));
}

async function loadOrderItemsByOrderIds(supabase, orderIds = []) {
    const ids = uniqueNormalized(orderIds, 160);
    if (!ids.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('shop_order_items')
        .select('id, order_id, inventory_id, snapshot_product_name, price_paid, created_at')
        .in('order_id', ids)
        .order('created_at', { ascending: true });

    if (error) {
        throw error;
    }

    const grouped = new Map();
    (Array.isArray(data) ? data : []).forEach((row) => {
        const orderId = normalizeText(row?.order_id, 160);
        if (!orderId) return;
        if (!grouped.has(orderId)) {
            grouped.set(orderId, []);
        }
        grouped.get(orderId).push(row);
    });

    return grouped;
}

function collectLinkedInventoryIds(order = {}, orderItems = []) {
    const directInventoryId = normalizeText(order?.inventory_id, 160);
    const itemInventoryIds = (Array.isArray(orderItems) ? orderItems : [])
        .map((item) => normalizeText(item?.inventory_id, 160))
        .filter(Boolean);

    return uniqueNormalized([directInventoryId, ...itemInventoryIds], 160);
}

function buildLinkedInventoryItems(order = {}, orderItems = [], inventoryRecordsById = new Map()) {
    const safeOrderItems = Array.isArray(orderItems) ? orderItems.filter(Boolean) : [];
    const orderProductName = normalizeText(order?.snapshot_product_name) || 'Unknown';

    if (safeOrderItems.length) {
        return safeOrderItems.map((item) => {
            const inventoryId = normalizeText(item?.inventory_id, 160);
            const inventoryRecord = inventoryId ? inventoryRecordsById.get(inventoryId) : null;
            return {
                id: inventoryId || null,
                order_item_id: normalizeText(item?.id, 160) || null,
                product_name: normalizeText(item?.snapshot_product_name) || orderProductName,
                price_paid: Number(item?.price_paid || 0) || 0,
                content: inventoryRecord?.content || '',
                status: inventoryRecord?.status || null,
                buyer_id: inventoryRecord?.buyer_id || null,
                sold_at: inventoryRecord?.sold_at || null,
                remark: inventoryRecord?.remark || null,
                sku_id: inventoryRecord?.sku_id || null,
                source_batch_id: inventoryRecord?.source_batch_id || null,
                purchase_unit_cost: inventoryRecord?.purchase_unit_cost ?? null,
                purchase_currency: inventoryRecord?.purchase_currency || null,
                purchase_exchange_rate_to_cny: inventoryRecord?.purchase_exchange_rate_to_cny ?? null,
                purchase_unit_cost_cny: inventoryRecord?.purchase_unit_cost_cny ?? null
            };
        });
    }

    const directInventoryId = normalizeText(order?.inventory_id, 160);
    if (!directInventoryId) {
        return [];
    }

    const inventoryRecord = inventoryRecordsById.get(directInventoryId) || null;
    return [{
        id: directInventoryId,
        order_item_id: null,
        product_name: orderProductName,
        price_paid: Number(order?.price_paid || order?.total_price || 0) || 0,
        content: inventoryRecord?.content || '',
        status: inventoryRecord?.status || null,
        buyer_id: inventoryRecord?.buyer_id || null,
        sold_at: inventoryRecord?.sold_at || null,
        remark: inventoryRecord?.remark || null,
        sku_id: inventoryRecord?.sku_id || null,
        source_batch_id: inventoryRecord?.source_batch_id || null,
        purchase_unit_cost: inventoryRecord?.purchase_unit_cost ?? null,
        purchase_currency: inventoryRecord?.purchase_currency || null,
        purchase_exchange_rate_to_cny: inventoryRecord?.purchase_exchange_rate_to_cny ?? null,
        purchase_unit_cost_cny: inventoryRecord?.purchase_unit_cost_cny ?? null
    }];
}

function buildResolvedItems(order = {}, orderItems = [], inventoryRecordsById = new Map()) {
    const inlineItems = Array.isArray(order?.items) ? order.items.filter(Boolean) : [];
    if (inlineItems.length) {
        return inlineItems;
    }

    const linkedInventoryItems = buildLinkedInventoryItems(order, orderItems, inventoryRecordsById);
    if (linkedInventoryItems.length) {
        return linkedInventoryItems.map((item) => ({
            product_name: item.product_name || normalizeText(order?.snapshot_product_name) || 'Unknown',
            content: item.content || '无内容',
            price: Number(item?.price_paid || order?.price_paid || order?.total_price || 0) || 0,
            inventory_id: item.id || null,
            inventory_status: item.status || null
        }));
    }

    return [{
        product_name: normalizeText(order?.snapshot_product_name) || 'Unknown',
        content: '无内容',
        price: Number(order?.price_paid || order?.total_price || 0) || 0,
        inventory_id: null,
        inventory_status: null
    }];
}

async function loadOrderLinksByInventoryIds(supabase, inventoryIds = []) {
    const ids = uniqueNormalized(inventoryIds, 160);
    if (!ids.length) {
        return new Map();
    }

    const [directOrderResult, orderItemResult] = await Promise.all([
        supabase
            .from('shop_orders')
            .select('id, inventory_id, created_at')
            .in('inventory_id', ids)
            .order('created_at', { ascending: false }),
        supabase
            .from('shop_order_items')
            .select('order_id, inventory_id, created_at')
            .in('inventory_id', ids)
            .order('created_at', { ascending: true })
    ]);

    if (directOrderResult.error) {
        throw directOrderResult.error;
    }
    if (orderItemResult.error) {
        throw orderItemResult.error;
    }

    const linkMap = new Map();

    (Array.isArray(orderItemResult.data) ? orderItemResult.data : []).forEach((row) => {
        const inventoryId = normalizeText(row?.inventory_id, 160);
        const orderId = normalizeText(row?.order_id, 160);
        if (!inventoryId || !orderId || linkMap.has(inventoryId)) {
            return;
        }
        linkMap.set(inventoryId, {
            order_id: orderId,
            inventory_id: inventoryId,
            source: 'order_item'
        });
    });

    (Array.isArray(directOrderResult.data) ? directOrderResult.data : []).forEach((row) => {
        const inventoryId = normalizeText(row?.inventory_id, 160);
        const orderId = normalizeText(row?.id, 160);
        if (!inventoryId || !orderId || linkMap.has(inventoryId)) {
            return;
        }
        linkMap.set(inventoryId, {
            order_id: orderId,
            inventory_id: inventoryId,
            source: 'order'
        });
    });

    return linkMap;
}

function resolveOrderLinkageSource(order = {}, orderItems = []) {
    if (Array.isArray(order?.items) && order.items.filter(Boolean).length) {
        return 'inline_items';
    }
    if (Array.isArray(orderItems) && orderItems.length) {
        return 'order_items';
    }
    if (normalizeText(order?.inventory_id, 160)) {
        return 'order_inventory';
    }
    return 'unlinked';
}

module.exports = {
    normalizeText,
    uniqueNormalized,
    loadInventoryRecordsByIds,
    loadOrderItemsByOrderIds,
    collectLinkedInventoryIds,
    buildLinkedInventoryItems,
    buildResolvedItems,
    loadOrderLinksByInventoryIds,
    resolveOrderLinkageSource
};
