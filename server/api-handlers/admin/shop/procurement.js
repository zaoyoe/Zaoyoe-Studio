const {
    normalizeAdminSite,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    buildOrderProfitAttribution,
    isRefundedOrder
} = require('./_profit');

const PROCUREMENT_ORDER_COLUMNS = 'id, user_id, product_id, inventory_id, price_paid, paid_points_spent, bonus_points_spent, points_spend_breakdown, total_price, discount_amount, discount_refund_amount, snapshot_product_name, refund_status, created_at, site';

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeText(value, maxLength = 200) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeSite(value) {
    return normalizeAdminSite(value, { defaultValue: 'all' }) || 'all';
}

function resolveInventoryScopeSite(requestedSite) {
    const site = normalizeSite(requestedSite);
    if (site === 'intl') {
        return {
            requestedSite: site,
            inventorySite: 'cn',
            inventoryScope: 'shared'
        };
    }

    return {
        requestedSite: site,
        inventorySite: site,
        inventoryScope: site === 'all' ? 'all' : 'site'
    };
}

function normalizePositiveInteger(value, fallback, maxValue = 5000) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    return Math.min(parsed, maxValue);
}

function toNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function roundMoney(value) {
    const numeric = toNumber(value, 0);
    return Math.round(numeric * 10000) / 10000;
}

function roundRate(value) {
    const numeric = toNumber(value, 0);
    return Math.round(numeric * 10000) / 10000;
}

function clampInteger(value, min, max, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }
    return Math.min(Math.max(Math.round(numeric), min), max);
}

function uniq(values = []) {
    return [...new Set(
        (Array.isArray(values) ? values : [])
            .map((value) => normalizeText(value, 160))
            .filter(Boolean)
    )];
}

function normalizeProcurementTagList(value) {
    const rawItems = Array.isArray(value)
        ? value
        : String(value || '').split(/[,，;；\n\r\t]+/);
    const seen = new Set();
    const tags = [];

    rawItems.forEach((item) => {
        const tag = normalizeText(item, 32);
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) {
            return;
        }
        seen.add(key);
        tags.push(tag);
    });

    return tags.slice(0, 12);
}

function mergeProcurementTagLists(...values) {
    return normalizeProcurementTagList(values.flatMap((value) => normalizeProcurementTagList(value)));
}

function normalizeDateFilter(value, { endOfDay = false } = {}) {
    const raw = normalizeText(value, 64);
    if (!raw) {
        return '';
    }

    const isoLike = /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
        : raw;
    const parsed = new Date(isoLike);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function normalizeProcurementFilters(searchParams) {
    return {
        sourceId: normalizeText(searchParams.get('sourceId') || searchParams.get('source_id'), 160),
        productId: normalizeText(searchParams.get('productId') || searchParams.get('product_id'), 160),
        skuId: normalizeText(searchParams.get('skuId') || searchParams.get('sku_id'), 160),
        qualityStatus: normalizeText(searchParams.get('qualityStatus') || searchParams.get('quality_status'), 32).toLowerCase(),
        costStatus: normalizeText(searchParams.get('costStatus') || searchParams.get('cost_status'), 32).toLowerCase(),
        search: normalizeText(searchParams.get('search'), 160),
        dateFrom: normalizeDateFilter(searchParams.get('dateFrom') || searchParams.get('date_from')),
        dateTo: normalizeDateFilter(searchParams.get('dateTo') || searchParams.get('date_to'), { endOfDay: true })
    };
}

function buildProcurementFilterPayload(filters = {}) {
    return {
        sourceId: filters.sourceId || '',
        productId: filters.productId || '',
        skuId: filters.skuId || '',
        qualityStatus: filters.qualityStatus || '',
        costStatus: filters.costStatus || '',
        search: filters.search || '',
        dateFrom: filters.dateFrom || '',
        dateTo: filters.dateTo || ''
    };
}

function isMissingProcurementSchemaError(error = {}) {
    const text = [
        error?.message,
        error?.details,
        error?.hint,
        error?.code
    ].filter(Boolean).join(' ').toLowerCase();

    return text.includes('relation "shop_inventory_sources" does not exist')
        || text.includes('relation "shop_procurement_batches" does not exist')
        || text.includes('undefined table')
        || text.includes('schema cache')
        || text.includes('shop_procurement_batches')
        || text.includes('shop_inventory_sources')
        || text.includes("could not find the 'source_batch_id' column")
        || text.includes('column "source_batch_id"');
}

function getQualityMeta(status) {
    const normalized = normalizeText(status, 32).toLowerCase() || 'unverified';
    const metas = {
        accepted: { status: 'accepted', label: '稳定', tone: 'accepted' },
        watch: { status: 'watch', label: '观察', tone: 'watch' },
        rejected: { status: 'rejected', label: '停用', tone: 'rejected' },
        unverified: { status: 'unverified', label: '待验证', tone: 'unverified' }
    };

    return metas[normalized] || {
        status: normalized,
        label: status || '未知',
        tone: 'unknown'
    };
}

function getCostStatusLabel(status) {
    const normalized = normalizeText(status, 32).toLowerCase();
    const labels = {
        actual: '实际成本',
        estimated: '预估成本',
        missing: '缺少成本'
    };
    return labels[normalized] || (status || '未知');
}

async function loadProcurementBatches(supabase, { inventorySite, limit, filters = {} }) {
    let query = supabase
        .from('shop_procurement_batches')
        .select('*', { count: 'exact' });

    if (inventorySite !== 'all') {
        query = query.eq('site', inventorySite);
    }
    if (filters.sourceId) {
        query = query.eq('source_id', filters.sourceId);
    }
    if (filters.productId) {
        query = query.eq('product_id', filters.productId);
    }
    if (filters.skuId) {
        query = query.eq('sku_id', filters.skuId);
    }
    if (filters.qualityStatus) {
        query = query.eq('quality_status', filters.qualityStatus);
    }
    if (filters.costStatus) {
        query = query.eq('cost_status', filters.costStatus);
    }

    const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    return {
        rows,
        totalCount: Number.isFinite(Number(count)) ? Number(count) : rows.length
    };
}

async function loadRowsByIds(supabase, table, ids, columns) {
    const normalizedIds = uniq(ids);
    if (!normalizedIds.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from(table)
        .select(columns)
        .in('id', normalizedIds);

    if (error) {
        throw error;
    }

    return new Map((Array.isArray(data) ? data : [])
        .map((row) => [normalizeText(row?.id, 160), row]));
}

function createEmptyInventoryStats() {
    return {
        sampleCount: 0,
        availableCount: 0,
        reserveCount: 0,
        soldCount: 0,
        faultCount: 0,
        frozenCount: 0,
        otherCount: 0,
        evidenceCount: 0,
        faultRate: 0,
        latestSoldAt: null,
        latestFaultAt: null
    };
}

function finalizeInventoryStats(stats) {
    stats.evidenceCount = stats.soldCount + stats.faultCount;
    stats.faultRate = stats.evidenceCount > 0
        ? Math.round((stats.faultCount / stats.evidenceCount) * 1000) / 1000
        : 0;
    return stats;
}

function buildInventoryStatsByBatch(rows = []) {
    const statsByBatchId = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const batchId = normalizeText(row?.source_batch_id, 160);
        if (!batchId) {
            return;
        }

        const stats = statsByBatchId.get(batchId) || createEmptyInventoryStats();
        const status = normalizeText(row?.status, 32).toLowerCase();
        stats.sampleCount += 1;
        if (status === 'sold') {
            stats.soldCount += 1;
            stats.latestSoldAt = [stats.latestSoldAt, row?.sold_at || row?.created_at]
                .filter(Boolean)
                .sort()
                .pop() || null;
        } else if (status === 'fault') {
            stats.faultCount += 1;
            stats.latestFaultAt = [stats.latestFaultAt, row?.created_at]
                .filter(Boolean)
                .sort()
                .pop() || null;
        } else if (status === 'available') {
            stats.availableCount += 1;
        } else if (status === 'reserve') {
            stats.reserveCount += 1;
        } else if (status === 'frozen') {
            stats.frozenCount += 1;
        } else {
            stats.otherCount += 1;
        }
        statsByBatchId.set(batchId, stats);
    });

    statsByBatchId.forEach(finalizeInventoryStats);
    return statsByBatchId;
}

async function loadInventoryRowsByBatchIds(supabase, batchIds) {
    const normalizedIds = uniq(batchIds);
    if (!normalizedIds.length) {
        return [];
    }

    const { data, error } = await supabase
        .from('shop_inventory')
        .select('id, source_batch_id, status, sold_at, created_at, buyer_id, remark, product_id, purchase_unit_cost, purchase_currency, purchase_exchange_rate_to_cny, purchase_unit_cost_cny')
        .in('source_batch_id', normalizedIds);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function loadInventoryRowsByIds(supabase, inventoryIds) {
    const normalizedIds = uniq(inventoryIds);
    if (!normalizedIds.length) {
        return [];
    }

    const { data, error } = await supabase
        .from('shop_inventory')
        .select('id, source_batch_id, status, sold_at, created_at, buyer_id, remark, product_id, purchase_unit_cost, purchase_currency, purchase_exchange_rate_to_cny, purchase_unit_cost_cny')
        .in('id', normalizedIds);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

function createInventoryMap(rows = []) {
    return new Map((Array.isArray(rows) ? rows : [])
        .map((row) => [normalizeText(row?.id, 160), row])
        .filter(([id]) => Boolean(id)));
}

function buildBatchMap(rows = []) {
    return new Map((Array.isArray(rows) ? rows : [])
        .map((row) => [normalizeText(row?.id, 160), row])
        .filter(([id]) => Boolean(id)));
}

function getInventoryCostSnapshot(inventory = {}, batchesById = new Map()) {
    const batch = batchesById.get(normalizeText(inventory?.source_batch_id, 160)) || null;
    const unitCostCny = inventory?.purchase_unit_cost_cny ?? batch?.unit_cost_cny ?? null;
    const unitCost = inventory?.purchase_unit_cost ?? batch?.unit_cost ?? null;
    const currency = inventory?.purchase_currency || batch?.currency || null;
    const exchangeRate = inventory?.purchase_exchange_rate_to_cny ?? batch?.exchange_rate_to_cny ?? null;

    return {
        purchase_unit_cost_cny: unitCostCny,
        purchase_unit_cost: unitCost,
        purchase_currency: currency,
        purchase_exchange_rate_to_cny: exchangeRate
    };
}

function buildProfitLinkedItem(order = {}, orderItem = {}, inventory = {}, batchesById = new Map()) {
    const costSnapshot = getInventoryCostSnapshot(inventory, batchesById);
    return {
        id: normalizeText(inventory?.id || orderItem?.inventory_id || order?.inventory_id, 160) || null,
        order_item_id: normalizeText(orderItem?.id, 160) || null,
        product_name: normalizeText(orderItem?.snapshot_product_name || order?.snapshot_product_name) || 'Unknown',
        price_paid: toNumber(orderItem?.price_paid, toNumber(order?.price_paid, toNumber(order?.total_price, 0))),
        status: inventory?.status || null,
        buyer_id: inventory?.buyer_id || null,
        sold_at: inventory?.sold_at || null,
        remark: inventory?.remark || null,
        source_batch_id: inventory?.source_batch_id || null,
        ...costSnapshot
    };
}

function buildOrderLinkedItems(order = {}, orderItems = [], inventoryById = new Map(), batchesById = new Map()) {
    const safeOrderItems = Array.isArray(orderItems) ? orderItems.filter(Boolean) : [];
    if (safeOrderItems.length) {
        return safeOrderItems.map((item) => {
            const inventory = inventoryById.get(normalizeText(item?.inventory_id, 160)) || {};
            return buildProfitLinkedItem(order, item, inventory, batchesById);
        });
    }

    const directInventoryId = normalizeText(order?.inventory_id, 160);
    if (!directInventoryId) {
        return [];
    }

    const inventory = inventoryById.get(directInventoryId) || { id: directInventoryId };
    return [buildProfitLinkedItem(order, { inventory_id: directInventoryId }, inventory, batchesById)];
}

function groupRowsByOrderId(rows = []) {
    const grouped = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const orderId = normalizeText(row?.order_id, 160);
        if (!orderId) {
            return;
        }
        if (!grouped.has(orderId)) {
            grouped.set(orderId, []);
        }
        grouped.get(orderId).push(row);
    });
    return grouped;
}

async function loadOrdersByIds(supabase, orderIds) {
    const ids = uniq(orderIds);
    if (!ids.length) {
        return [];
    }

    const { data, error } = await supabase
        .from('shop_orders')
        .select(PROCUREMENT_ORDER_COLUMNS)
        .in('id', ids);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function loadOrderItemsByOrderIds(supabase, orderIds) {
    const ids = uniq(orderIds);
    if (!ids.length) {
        return [];
    }

    const { data, error } = await supabase
        .from('shop_order_items')
        .select('id, order_id, inventory_id, snapshot_product_name, price_paid, created_at')
        .in('order_id', ids)
        .order('created_at', { ascending: true });

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function loadProcurementOrderContext(supabase, inventoryRows = [], batchesById = new Map()) {
    const inventoryIds = uniq((Array.isArray(inventoryRows) ? inventoryRows : []).map((row) => row?.id));
    const emptyContext = {
        orders: [],
        orderItemsByOrderId: new Map(),
        inventoryById: createInventoryMap(inventoryRows)
    };
    if (!inventoryIds.length) {
        return emptyContext;
    }

    const [directOrderResult, linkedOrderItemResult] = await Promise.all([
        supabase
            .from('shop_orders')
            .select(PROCUREMENT_ORDER_COLUMNS)
            .in('inventory_id', inventoryIds)
            .order('created_at', { ascending: false }),
        supabase
            .from('shop_order_items')
            .select('id, order_id, inventory_id, snapshot_product_name, price_paid, created_at')
            .in('inventory_id', inventoryIds)
            .order('created_at', { ascending: true })
    ]);

    if (directOrderResult.error) {
        throw directOrderResult.error;
    }
    if (linkedOrderItemResult.error) {
        throw linkedOrderItemResult.error;
    }

    const directOrders = Array.isArray(directOrderResult.data) ? directOrderResult.data : [];
    const linkedOrderItems = Array.isArray(linkedOrderItemResult.data) ? linkedOrderItemResult.data : [];
    const orderIds = uniq([
        ...directOrders.map((order) => order?.id),
        ...linkedOrderItems.map((item) => item?.order_id)
    ]);

    if (!orderIds.length) {
        return emptyContext;
    }

    const [orders, allOrderItems] = await Promise.all([
        loadOrdersByIds(supabase, orderIds),
        loadOrderItemsByOrderIds(supabase, orderIds)
    ]);
    const inventoryById = createInventoryMap(inventoryRows);
    const missingInventoryIds = uniq(allOrderItems
        .map((item) => item?.inventory_id)
        .filter((id) => !inventoryById.has(normalizeText(id, 160))));

    if (missingInventoryIds.length) {
        const extraInventoryRows = await loadInventoryRowsByIds(supabase, missingInventoryIds);
        extraInventoryRows.forEach((row) => {
            const id = normalizeText(row?.id, 160);
            if (id) {
                inventoryById.set(id, row);
            }
        });
    }

    return {
        orders,
        orderItemsByOrderId: groupRowsByOrderId(allOrderItems),
        inventoryById,
        batchesById
    };
}

function createEmptyProcurementPerformance() {
    return {
        orderCount: 0,
        soldItemCount: 0,
        refundOrderCount: 0,
        refundItemCount: 0,
        negativeProfitOrderCount: 0,
        incompleteOrderCount: 0,
        recognizedRevenueCny: 0,
        recognizedCostCny: 0,
        netProfitCny: 0,
        discountPoints: 0,
        nonCashPoints: 0,
        costedItemCount: 0,
        missingCostItemCount: 0,
        latestOrderAt: null,
        fulfillmentHoursTotal: 0,
        fulfillmentSampleCount: 0,
        avgFulfillmentHours: null,
        refundRate: 0,
        negativeProfitRate: 0,
        marginRate: null
    };
}

function getLinkedItemCostCny(item = {}) {
    if (item?.purchase_unit_cost_cny === null || item?.purchase_unit_cost_cny === undefined || item?.purchase_unit_cost_cny === '') {
        return null;
    }
    const numeric = Number(item.purchase_unit_cost_cny);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

function finalizeProcurementPerformance(stats = createEmptyProcurementPerformance()) {
    stats.recognizedRevenueCny = roundMoney(stats.recognizedRevenueCny);
    stats.recognizedCostCny = roundMoney(stats.recognizedCostCny);
    stats.netProfitCny = roundMoney(stats.netProfitCny);
    stats.discountPoints = roundMoney(stats.discountPoints);
    stats.nonCashPoints = roundMoney(stats.nonCashPoints);
    stats.refundRate = stats.orderCount > 0 ? roundRate(stats.refundOrderCount / stats.orderCount) : 0;
    stats.negativeProfitRate = stats.orderCount > 0 ? roundRate(stats.negativeProfitOrderCount / stats.orderCount) : 0;
    stats.marginRate = stats.recognizedRevenueCny > 0 ? roundRate(stats.netProfitCny / stats.recognizedRevenueCny) : null;
    stats.avgFulfillmentHours = stats.fulfillmentSampleCount > 0
        ? Math.round((stats.fulfillmentHoursTotal / stats.fulfillmentSampleCount) * 100) / 100
        : null;
    return stats;
}

function addFulfillmentSample(stats, order = {}, item = {}) {
    const orderCreatedAt = new Date(order?.created_at || '');
    const soldAt = new Date(item?.sold_at || '');
    if (Number.isNaN(orderCreatedAt.getTime()) || Number.isNaN(soldAt.getTime())) {
        return;
    }

    const diffHours = (soldAt.getTime() - orderCreatedAt.getTime()) / 36e5;
    if (!Number.isFinite(diffHours) || diffHours < 0) {
        return;
    }

    stats.fulfillmentHoursTotal += diffHours;
    stats.fulfillmentSampleCount += 1;
}

function buildProcurementPerformanceByBatch(orderContext = {}) {
    const performanceByBatchId = new Map();
    const orders = Array.isArray(orderContext.orders) ? orderContext.orders : [];
    const orderItemsByOrderId = orderContext.orderItemsByOrderId || new Map();
    const inventoryById = orderContext.inventoryById || new Map();
    const batchesById = orderContext.batchesById || new Map();

    orders.forEach((order) => {
        const orderId = normalizeText(order?.id, 160);
        const orderItems = orderItemsByOrderId.get(orderId) || [];
        const linkedItems = buildOrderLinkedItems(order, orderItems, inventoryById, batchesById)
            .filter((item) => normalizeText(item?.source_batch_id, 160));
        if (!linkedItems.length) {
            return;
        }

        const attribution = buildOrderProfitAttribution(order, linkedItems);
        const totalPriceBasis = linkedItems.reduce((sum, item) => sum + Math.max(0, toNumber(item?.price_paid, 0)), 0);
        const fallbackItemBasis = linkedItems.length || 1;
        const groupedByBatch = new Map();

        linkedItems.forEach((item) => {
            const batchId = normalizeText(item?.source_batch_id, 160);
            if (!batchId) {
                return;
            }
            if (!groupedByBatch.has(batchId)) {
                groupedByBatch.set(batchId, []);
            }
            groupedByBatch.get(batchId).push(item);
        });

        groupedByBatch.forEach((batchItems, batchId) => {
            const stats = performanceByBatchId.get(batchId) || createEmptyProcurementPerformance();
            const batchPriceBasis = batchItems.reduce((sum, item) => sum + Math.max(0, toNumber(item?.price_paid, 0)), 0);
            const share = totalPriceBasis > 0
                ? batchPriceBasis / totalPriceBasis
                : batchItems.length / fallbackItemBasis;
            const refunded = isRefundedOrder(order);
            const recognizedRevenueCny = roundMoney(toNumber(attribution.recognized_revenue_cny, 0) * share);
            const recognizedCostCny = refunded
                ? 0
                : roundMoney(batchItems.reduce((sum, item) => sum + toNumber(getLinkedItemCostCny(item), 0), 0));
            const netProfitCny = roundMoney(recognizedRevenueCny - recognizedCostCny);
            const missingCostItemCount = batchItems.filter((item) => getLinkedItemCostCny(item) === null).length;

            stats.orderCount += 1;
            stats.soldItemCount += batchItems.length;
            stats.recognizedRevenueCny += recognizedRevenueCny;
            stats.recognizedCostCny += recognizedCostCny;
            stats.netProfitCny += netProfitCny;
            stats.discountPoints += roundMoney(toNumber(attribution.discount_points, 0) * share);
            stats.nonCashPoints += roundMoney(toNumber(attribution.non_cash_points, 0) * share);
            stats.costedItemCount += Math.max(0, batchItems.length - missingCostItemCount);
            stats.missingCostItemCount += missingCostItemCount;
            stats.latestOrderAt = [stats.latestOrderAt, order?.created_at].filter(Boolean).sort().pop() || null;

            if (refunded) {
                stats.refundOrderCount += 1;
                stats.refundItemCount += batchItems.length;
            }
            if (!refunded && netProfitCny < 0) {
                stats.negativeProfitOrderCount += 1;
            }
            if (missingCostItemCount > 0 || attribution.cost_coverage === 'partial' || attribution.cost_coverage === 'no_cost') {
                stats.incompleteOrderCount += 1;
            }

            batchItems.forEach((item) => addFulfillmentSample(stats, order, item));
            performanceByBatchId.set(batchId, stats);
        });
    });

    performanceByBatchId.forEach(finalizeProcurementPerformance);
    return performanceByBatchId;
}

function getBatchComparableDate(row = {}) {
    return row.purchased_at || row.created_at || row.updated_at || '';
}

function normalizedRowMatchesProcurementFilters(row = {}, filters = {}) {
    if (filters.sourceId && normalizeText(row.source_id, 160) !== filters.sourceId) {
        return false;
    }
    if (filters.productId && normalizeText(row.product_id, 160) !== filters.productId) {
        return false;
    }
    if (filters.skuId && normalizeText(row.sku_id, 160) !== filters.skuId) {
        return false;
    }
    if (filters.qualityStatus && normalizeText(row.quality_status, 32).toLowerCase() !== filters.qualityStatus) {
        return false;
    }
    if (filters.costStatus && normalizeText(row.cost_status, 32).toLowerCase() !== filters.costStatus) {
        return false;
    }

    if (filters.dateFrom || filters.dateTo) {
        const parsedDate = new Date(getBatchComparableDate(row) || '');
        if (Number.isNaN(parsedDate.getTime())) {
            return false;
        }
        if (filters.dateFrom && parsedDate < new Date(filters.dateFrom)) {
            return false;
        }
        if (filters.dateTo && parsedDate > new Date(filters.dateTo)) {
            return false;
        }
    }

    const search = normalizeText(filters.search, 160).toLowerCase();
    if (search) {
        const haystack = [
            row.id,
            row.batch_code,
            row.source_name,
            row.source_url,
            row.source_platform,
            row.product_name,
            row.sku_name,
            row.sku_code,
            row.cost_status_label,
            row.quality_label,
            row.notes,
            ...(Array.isArray(row.source_tags) ? row.source_tags : [])
        ].map((value) => normalizeText(value, 240).toLowerCase()).join(' ');

        if (!haystack.includes(search)) {
            return false;
        }
    }

    return true;
}

function filterNormalizedProcurementRows(rows = [], filters = {}) {
    return (Array.isArray(rows) ? rows : [])
        .filter((row) => normalizedRowMatchesProcurementFilters(row, filters));
}

function getAutoQualityConfidence(stats = {}) {
    const evidenceCount = toNumber(stats.evidenceCount, 0);
    const sampleCount = toNumber(stats.sampleCount, 0);
    if (evidenceCount >= 20 || sampleCount >= 50) {
        return { level: 'high', label: '高' };
    }
    if (evidenceCount >= 5 || sampleCount >= 15) {
        return { level: 'medium', label: '中' };
    }
    if (evidenceCount >= 1 || sampleCount >= 3) {
        return { level: 'low', label: '低' };
    }
    return { level: 'none', label: '无样本' };
}

function getSourceRiskAdjustment(row = {}, reasons = []) {
    const riskTier = normalizeText(row.source_risk_tier, 32).toLowerCase();
    const qualityGrade = normalizeText(row.source_quality_grade, 32).toLowerCase();
    let scoreAdjustment = 0;

    if (['high', 'danger', 'blocked', 'blacklist', 'rejected', 'stop'].includes(riskTier)) {
        scoreAdjustment -= 18;
        reasons.push('货源风险等级偏高');
    } else if (['watch', 'medium', 'risk'].includes(riskTier)) {
        scoreAdjustment -= 8;
        reasons.push('货源处于观察风险等级');
    } else if (['low', 'trusted', 'standard'].includes(riskTier)) {
        scoreAdjustment += 2;
        reasons.push('货源风险等级正常');
    }

    if (['a', 'a+', 'excellent', 'accepted', 'stable'].includes(qualityGrade)) {
        scoreAdjustment += 6;
        reasons.push('货源历史质量较好');
    } else if (['b', 'good'].includes(qualityGrade)) {
        scoreAdjustment += 2;
    } else if (['c', 'watch'].includes(qualityGrade)) {
        scoreAdjustment -= 6;
        reasons.push('货源历史质量需要观察');
    } else if (['d', 'bad', 'rejected', 'blocked'].includes(qualityGrade)) {
        scoreAdjustment -= 16;
        reasons.push('货源历史质量偏差');
    }

    return scoreAdjustment;
}

function buildAutoQualitySuggestion(row = {}, stats = createEmptyInventoryStats()) {
    const normalizedStats = finalizeInventoryStats({ ...createEmptyInventoryStats(), ...(stats || {}) });
    const reasons = [];
    let score = 100;

    getSourceRiskAdjustment(row, reasons);

    if (row.source_id) {
        reasons.push('已归因到明确货源');
    } else {
        reasons.push('未归因到明确货源');
    }

    if (row.unit_cost_cny === null || row.unit_cost_cny === undefined) {
        reasons.push('缺少进价成本');
    } else {
        reasons.push('成本已归因');
    }

    if (row.proof_url) {
        reasons.push('采购凭证已记录');
    } else {
        reasons.push('缺少采购凭证');
    }

    if (row.notes) {
        reasons.push('采购备注已记录');
    } else {
        reasons.push('缺少采购备注');
    }

    const sampleCount = toNumber(normalizedStats.sampleCount, 0);
    const soldCount = toNumber(normalizedStats.soldCount, 0);
    const faultCount = toNumber(normalizedStats.faultCount, 0);
    const evidenceCount = toNumber(normalizedStats.evidenceCount, 0);
    const faultRate = toNumber(normalizedStats.faultRate, 0);

    if (sampleCount <= 0) {
        reasons.push('导入默认 100 分，等待库存表现');
    } else if (evidenceCount <= 0) {
        reasons.push(`已有 ${sampleCount} 件库存，暂无售出或故障反馈`);
    } else {
        reasons.push(`${soldCount} 件售出，${faultCount} 件故障`);
    }

    if (soldCount >= 20 && faultRate <= 0.03) {
        reasons.push('售出样本充足且故障率低');
    } else if (soldCount >= 5 && faultRate <= 0.03) {
        reasons.push('已有有效售出样本且故障率低');
    }

    if (faultCount > 0) {
        if (faultRate >= 0.2 && evidenceCount >= 3) {
            score -= 45;
            reasons.push('故障率达到停用阈值');
        } else if (faultRate >= 0.1) {
            score -= 30;
            reasons.push('故障率偏高');
        } else if (faultRate >= 0.03) {
            score -= 16;
            reasons.push('出现少量故障反馈');
        } else {
            score -= 6;
            reasons.push('出现零星故障反馈');
        }
    }

    const autoScore = clampInteger(score, 0, 100, 0);
    let status = 'unverified';
    if ((faultRate >= 0.2 && evidenceCount >= 3) || autoScore < 55) {
        status = 'rejected';
    } else if (evidenceCount < 3) {
        status = 'unverified';
    } else if (autoScore >= 85 && soldCount >= 5 && faultRate <= 0.03) {
        status = 'accepted';
    } else if (autoScore >= 65) {
        status = 'watch';
    } else {
        status = 'rejected';
    }

    const meta = getQualityMeta(status);
    const confidence = getAutoQualityConfidence(normalizedStats);

    return {
        status: meta.status,
        label: meta.label,
        tone: meta.tone,
        score: autoScore,
        confidence_level: confidence.level,
        confidence_label: confidence.label,
        sample_count: sampleCount,
        evidence_count: evidenceCount,
        sold_count: soldCount,
        fault_count: faultCount,
        fault_rate: faultRate,
        reasons: uniq(reasons).slice(0, 8),
        rule_version: 'procurement_quality_rules_v1'
    };
}

function normalizeMetadata(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function getQualityControlMode(batch = {}) {
    const metadata = normalizeMetadata(batch.metadata);
    const mode = normalizeText(metadata.quality_control_mode, 32).toLowerCase();
    if (mode === 'manual' || mode === 'auto') {
        return mode;
    }

    const status = normalizeText(batch.quality_status, 32).toLowerCase() || 'unverified';
    const hasSavedScore = batch.quality_score !== null && batch.quality_score !== undefined;
    return status === 'unverified' && !hasSavedScore ? 'auto' : 'manual';
}

function getAutoQualitySyncDecision(row = {}) {
    const suggestion = row.auto_quality || null;
    const mode = getQualityControlMode(row);
    if (mode === 'manual') {
        return {
            eligible: false,
            reason: 'manual_locked',
            mode
        };
    }

    if (!suggestion || !suggestion.status || suggestion.status === 'unverified') {
        return {
            eligible: false,
            reason: 'suggestion_unverified',
            mode
        };
    }

    const evidenceCount = toNumber(suggestion.evidence_count, 0);
    const faultRate = toNumber(suggestion.fault_rate, 0);
    const confidenceLevel = normalizeText(suggestion.confidence_level, 32).toLowerCase();
    const hasReviewConfidence = ['medium', 'high'].includes(confidenceLevel) && evidenceCount >= 5;
    const isSevereReject = suggestion.status === 'rejected' && evidenceCount >= 3 && faultRate >= 0.2;
    if (!hasReviewConfidence && !isSevereReject) {
        return {
            eligible: false,
            reason: 'insufficient_confidence',
            mode
        };
    }

    const metadata = normalizeMetadata(row.metadata);
    const currentScore = row.quality_score === null || row.quality_score === undefined ? null : Number(row.quality_score);
    const nextScore = clampInteger(suggestion.score, 0, 100, null);
    const statusChanged = normalizeText(row.quality_status, 32).toLowerCase() !== suggestion.status;
    const scoreChanged = currentScore !== nextScore;
    const sampleChanged = Number(metadata.quality_auto_sample_count || 0) !== toNumber(suggestion.sample_count, 0)
        || Number(metadata.quality_auto_evidence_count || 0) !== evidenceCount
        || Number(metadata.quality_auto_sold_count || 0) !== toNumber(suggestion.sold_count, 0)
        || Number(metadata.quality_auto_fault_count || 0) !== toNumber(suggestion.fault_count, 0);

    if (!statusChanged && !scoreChanged && !sampleChanged) {
        return {
            eligible: false,
            reason: 'already_current',
            mode
        };
    }

    return {
        eligible: true,
        reason: 'eligible',
        mode,
        nextScore
    };
}

function buildAutoQualitySyncMetadata(metadata = {}, suggestion = {}, { userId = '', nowIso = '' } = {}) {
    return {
        ...normalizeMetadata(metadata),
        quality_control_mode: 'auto',
        quality_auto_last_synced_at: nowIso,
        quality_auto_last_synced_by: userId || null,
        quality_auto_rule_version: suggestion.rule_version || 'procurement_quality_rules_v1',
        quality_auto_confidence_level: suggestion.confidence_level || null,
        quality_auto_confidence_label: suggestion.confidence_label || null,
        quality_auto_sample_count: toNumber(suggestion.sample_count, 0),
        quality_auto_evidence_count: toNumber(suggestion.evidence_count, 0),
        quality_auto_sold_count: toNumber(suggestion.sold_count, 0),
        quality_auto_fault_count: toNumber(suggestion.fault_count, 0),
        quality_auto_fault_rate: toNumber(suggestion.fault_rate, 0),
        quality_auto_reasons: Array.isArray(suggestion.reasons) ? suggestion.reasons.slice(0, 6) : []
    };
}

async function syncAutoManagedQuality(supabase, rows = [], { userId = '', site = '' } = {}) {
    const result = {
        reviewedCount: rows.length,
        updatedCount: 0,
        skippedManualCount: 0,
        skippedConfidenceCount: 0,
        skippedCurrentCount: 0,
        updatedRowsById: new Map()
    };
    const nowIso = new Date().toISOString();

    for (const row of rows) {
        const decision = getAutoQualitySyncDecision(row);
        if (!decision.eligible) {
            if (decision.reason === 'manual_locked') {
                result.skippedManualCount += 1;
            } else if (decision.reason === 'insufficient_confidence' || decision.reason === 'suggestion_unverified') {
                result.skippedConfidenceCount += 1;
            } else if (decision.reason === 'already_current') {
                result.skippedCurrentCount += 1;
            }
            continue;
        }

        const suggestion = row.auto_quality;
        const metadata = buildAutoQualitySyncMetadata(row.metadata, suggestion, { userId, nowIso });
        const updatePayload = {
            quality_status: suggestion.status,
            quality_score: decision.nextScore,
            metadata,
            updated_at: nowIso
        };

        const { data, error } = await supabase
            .from('shop_procurement_batches')
            .update(updatePayload)
            .eq('id', row.id)
            .select('*')
            .single();

        if (error) {
            throw error;
        }

        const updatedRow = data || {
            ...row,
            ...updatePayload
        };
        result.updatedCount += 1;
        result.updatedRowsById.set(row.id, updatedRow);

        await writeAdminAuditLog?.({
            supabase,
            adminId: userId || null,
            module: 'shop',
            site: site || row.site || null,
            actionType: 'shop.procurement.quality.auto_sync',
            details: {
                procurement_batch_id: row.id,
                procurement_batch_code: row.batch_code || null,
                previous_quality_status: row.quality_status || null,
                next_quality_status: suggestion.status,
                previous_quality_score: row.quality_score ?? null,
                next_quality_score: decision.nextScore,
                confidence_level: suggestion.confidence_level || null,
                sample_count: suggestion.sample_count || 0,
                evidence_count: suggestion.evidence_count || 0,
                sold_count: suggestion.sold_count || 0,
                fault_count: suggestion.fault_count || 0,
                fault_rate: suggestion.fault_rate || 0,
                rule_version: suggestion.rule_version || null
            }
        });
    }

    return result;
}

function normalizeBatchForDisplay(batch, context = {}) {
    const sourcesById = context.sourcesById || new Map();
    const productsById = context.productsById || new Map();
    const skusById = context.skusById || new Map();
    const inventoryStatsByBatchId = context.inventoryStatsByBatchId || new Map();
    const procurementPerformanceByBatchId = context.procurementPerformanceByBatchId || new Map();
    const source = sourcesById.get(normalizeText(batch?.source_id, 160)) || null;
    const product = productsById.get(normalizeText(batch?.product_id, 160)) || null;
    const sku = skusById.get(normalizeText(batch?.sku_id, 160)) || null;
    const batchId = normalizeText(batch?.id, 160);
    const inventoryStats = inventoryStatsByBatchId.get(batchId) || createEmptyInventoryStats();
    const performance = finalizeProcurementPerformance({
        ...createEmptyProcurementPerformance(),
        ...(procurementPerformanceByBatchId.get(batchId) || {})
    });
    const qualityMeta = getQualityMeta(batch?.quality_status);
    const sourceMetadata = normalizeMetadata(source?.metadata);
    const batchMetadata = normalizeMetadata(batch?.metadata);
    const sourceTags = mergeProcurementTagLists(
        sourceMetadata.source_tags,
        sourceMetadata.sourceTags,
        batchMetadata.source_tags,
        batchMetadata.sourceTags
    );
    const unitCostCny = batch?.unit_cost_cny === null || batch?.unit_cost_cny === undefined
        ? null
        : roundMoney(batch.unit_cost_cny);
    const totalCostCny = batch?.total_cost_cny === null || batch?.total_cost_cny === undefined
        ? (unitCostCny === null ? null : roundMoney(unitCostCny * toNumber(batch?.imported_count, 0)))
        : roundMoney(batch.total_cost_cny);

    const normalized = {
        id: batchId || null,
        site: batch?.site || null,
        batch_code: batch?.batch_code || '',
        source_id: batch?.source_id || null,
        source_name: source?.source_name || '未归因货源',
        source_url: source?.source_url || '',
        source_platform: source?.platform || '',
        source_risk_tier: source?.risk_tier || '',
        source_quality_grade: source?.quality_grade || '',
        source_tags: sourceTags,
        product_id: batch?.product_id || null,
        product_name: product?.name || '未关联商品',
        sku_id: batch?.sku_id || null,
        sku_name: sku?.sku_name || '',
        sku_code: sku?.sku_code || '',
        imported_count: toNumber(batch?.imported_count, 0),
        unit_cost: batch?.unit_cost === null || batch?.unit_cost === undefined ? null : roundMoney(batch.unit_cost),
        currency: batch?.currency || 'CNY',
        exchange_rate_to_cny: batch?.exchange_rate_to_cny === null || batch?.exchange_rate_to_cny === undefined
            ? null
            : toNumber(batch.exchange_rate_to_cny, 1),
        unit_cost_cny: unitCostCny,
        total_cost_cny: totalCostCny,
        purchased_at: batch?.purchased_at || null,
        proof_url: batch?.proof_url || '',
        quality_status: qualityMeta.status,
        quality_label: qualityMeta.label,
        quality_tone: qualityMeta.tone,
        quality_score: batch?.quality_score ?? null,
        cost_status: batch?.cost_status || 'missing',
        cost_status_label: getCostStatusLabel(batch?.cost_status || 'missing'),
        notes: batch?.notes || '',
        metadata: batchMetadata,
        quality_control_mode: getQualityControlMode(batch),
        created_at: batch?.created_at || null,
        updated_at: batch?.updated_at || null
    };

    normalized.inventory_sample_count = toNumber(inventoryStats.sampleCount, 0);
    normalized.inventory_sold_count = toNumber(inventoryStats.soldCount, 0);
    normalized.inventory_fault_count = toNumber(inventoryStats.faultCount, 0);
    normalized.inventory_evidence_count = toNumber(inventoryStats.evidenceCount, 0);
    normalized.inventory_fault_rate = toNumber(inventoryStats.faultRate, 0);
    normalized.inventory_available_count = toNumber(inventoryStats.availableCount, 0);
    normalized.inventory_reserve_count = toNumber(inventoryStats.reserveCount, 0);
    normalized.inventory_frozen_count = toNumber(inventoryStats.frozenCount, 0);
    normalized.inventory_sold_rate = normalized.imported_count > 0
        ? roundRate(normalized.inventory_sold_count / normalized.imported_count)
        : 0;
    normalized.performance = performance;
    normalized.order_count = performance.orderCount;
    normalized.refund_order_count = performance.refundOrderCount;
    normalized.refund_item_count = performance.refundItemCount;
    normalized.refund_rate = performance.refundRate;
    normalized.negative_profit_order_count = performance.negativeProfitOrderCount;
    normalized.negative_profit_rate = performance.negativeProfitRate;
    normalized.incomplete_order_count = performance.incompleteOrderCount;
    normalized.recognized_revenue_cny = performance.recognizedRevenueCny;
    normalized.recognized_cost_cny = performance.recognizedCostCny;
    normalized.net_profit_cny = performance.netProfitCny;
    normalized.margin_rate = performance.marginRate;
    normalized.discount_points = performance.discountPoints;
    normalized.non_cash_points = performance.nonCashPoints;
    normalized.costed_item_count = performance.costedItemCount;
    normalized.missing_cost_item_count = performance.missingCostItemCount;
    normalized.avg_fulfillment_hours = performance.avgFulfillmentHours;
    normalized.latest_order_at = performance.latestOrderAt;
    normalized.auto_quality = buildAutoQualitySuggestion(normalized, inventoryStats);

    return normalized;
}

function buildOverview(rows, context = {}) {
    const filters = context.filters || {};
    const normalizedRows = filterNormalizedProcurementRows(
        rows.map((batch) => normalizeBatchForDisplay(batch, context)),
        filters
    );
    const totalBatches = normalizedRows.length;
    const totalImported = normalizedRows.reduce((sum, row) => sum + toNumber(row.imported_count, 0), 0);
    const totalCostCny = roundMoney(normalizedRows.reduce((sum, row) => sum + toNumber(row.total_cost_cny, 0), 0));
    const recognizedRevenueCny = roundMoney(normalizedRows.reduce((sum, row) => sum + toNumber(row.recognized_revenue_cny, 0), 0));
    const recognizedCostCny = roundMoney(normalizedRows.reduce((sum, row) => sum + toNumber(row.recognized_cost_cny, 0), 0));
    const netProfitCny = roundMoney(normalizedRows.reduce((sum, row) => sum + toNumber(row.net_profit_cny, 0), 0));
    const costedImported = normalizedRows.reduce((sum, row) => (
        row.unit_cost_cny === null ? sum : sum + toNumber(row.imported_count, 0)
    ), 0);
    const avgUnitCostCny = costedImported > 0 ? roundMoney(totalCostCny / costedImported) : null;

    const qualityMap = new Map();
    const sourceMap = new Map();
    const costStatusMap = new Map();

    normalizedRows.forEach((row) => {
        const qualityMeta = getQualityMeta(row.quality_status);
        const qualityEntry = qualityMap.get(qualityMeta.status) || {
            status: qualityMeta.status,
            label: qualityMeta.label,
            tone: qualityMeta.tone,
            batchCount: 0,
            importedCount: 0,
            costedImportedCount: 0,
            totalCostCny: 0,
            avgUnitCostCny: null,
            percentage: 0
        };
        qualityEntry.batchCount += 1;
        qualityEntry.importedCount += toNumber(row.imported_count, 0);
        if (row.unit_cost_cny !== null) {
            qualityEntry.costedImportedCount += toNumber(row.imported_count, 0);
        }
        qualityEntry.totalCostCny = roundMoney(qualityEntry.totalCostCny + toNumber(row.total_cost_cny, 0));
        qualityMap.set(qualityMeta.status, qualityEntry);

        const costStatusKey = normalizeText(row.cost_status, 32).toLowerCase() || 'missing';
        const costStatusEntry = costStatusMap.get(costStatusKey) || {
            status: costStatusKey,
            label: getCostStatusLabel(costStatusKey),
            batchCount: 0,
            importedCount: 0,
            totalCostCny: 0
        };
        costStatusEntry.batchCount += 1;
        costStatusEntry.importedCount += toNumber(row.imported_count, 0);
        costStatusEntry.totalCostCny = roundMoney(costStatusEntry.totalCostCny + toNumber(row.total_cost_cny, 0));
        costStatusMap.set(costStatusKey, costStatusEntry);

        const sourceKey = normalizeText(row.source_id, 160) || `batch:${row.id || row.batch_code}`;
        const sourceEntry = sourceMap.get(sourceKey) || {
            source_id: row.source_id || null,
            source_name: row.source_name || '未归因货源',
            source_url: row.source_url || '',
            platform: row.source_platform || '',
            risk_tier: row.source_risk_tier || '',
            quality_grade: row.source_quality_grade || '',
            source_tags: [],
            batchCount: 0,
            importedCount: 0,
            costedImportedCount: 0,
            totalCostCny: 0,
            recognizedRevenueCny: 0,
            recognizedCostCny: 0,
            netProfitCny: 0,
            orderCount: 0,
            refundOrderCount: 0,
            negativeProfitOrderCount: 0,
            missingCostItemCount: 0,
            avgUnitCostCny: null,
            latestPurchasedAt: null,
            latestCreatedAt: null,
            unverifiedCount: 0,
            acceptedCount: 0,
            watchCount: 0,
            rejectedCount: 0
        };
        sourceEntry.batchCount += 1;
        sourceEntry.importedCount += toNumber(row.imported_count, 0);
        if (row.unit_cost_cny !== null) {
            sourceEntry.costedImportedCount += toNumber(row.imported_count, 0);
        }
        sourceEntry.source_tags = mergeProcurementTagLists(sourceEntry.source_tags, row.source_tags);
        sourceEntry.totalCostCny = roundMoney(sourceEntry.totalCostCny + toNumber(row.total_cost_cny, 0));
        sourceEntry.recognizedRevenueCny = roundMoney(sourceEntry.recognizedRevenueCny + toNumber(row.recognized_revenue_cny, 0));
        sourceEntry.recognizedCostCny = roundMoney(sourceEntry.recognizedCostCny + toNumber(row.recognized_cost_cny, 0));
        sourceEntry.netProfitCny = roundMoney(sourceEntry.netProfitCny + toNumber(row.net_profit_cny, 0));
        sourceEntry.orderCount += toNumber(row.order_count, 0);
        sourceEntry.refundOrderCount += toNumber(row.refund_order_count, 0);
        sourceEntry.negativeProfitOrderCount += toNumber(row.negative_profit_order_count, 0);
        sourceEntry.missingCostItemCount += toNumber(row.missing_cost_item_count, 0);
        sourceEntry[`${qualityMeta.status}Count`] = toNumber(sourceEntry[`${qualityMeta.status}Count`], 0) + 1;
        sourceEntry.latestPurchasedAt = [sourceEntry.latestPurchasedAt, row.purchased_at]
            .filter(Boolean)
            .sort()
            .pop() || null;
        sourceEntry.latestCreatedAt = [sourceEntry.latestCreatedAt, row.created_at]
            .filter(Boolean)
            .sort()
            .pop() || null;
        sourceMap.set(sourceKey, sourceEntry);
    });

    const qualityOrder = ['unverified', 'accepted', 'watch', 'rejected'];
    const qualityBreakdown = [...qualityMap.values()]
        .map((entry) => ({
            ...entry,
            totalCostCny: roundMoney(entry.totalCostCny),
            avgUnitCostCny: entry.costedImportedCount > 0 ? roundMoney(entry.totalCostCny / entry.costedImportedCount) : null,
            percentage: totalBatches > 0 ? Math.round((entry.batchCount / totalBatches) * 1000) / 10 : 0
        }))
        .sort((a, b) => {
            const indexA = qualityOrder.indexOf(a.status);
            const indexB = qualityOrder.indexOf(b.status);
            return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
        });

    const costBySource = [...sourceMap.values()]
        .map((entry) => ({
            ...entry,
            totalCostCny: roundMoney(entry.totalCostCny),
            recognizedRevenueCny: roundMoney(entry.recognizedRevenueCny),
            recognizedCostCny: roundMoney(entry.recognizedCostCny),
            netProfitCny: roundMoney(entry.netProfitCny),
            avgUnitCostCny: entry.costedImportedCount > 0 ? roundMoney(entry.totalCostCny / entry.costedImportedCount) : null,
            refundRate: entry.orderCount > 0 ? roundRate(entry.refundOrderCount / entry.orderCount) : 0,
            marginRate: entry.recognizedRevenueCny > 0 ? roundRate(entry.netProfitCny / entry.recognizedRevenueCny) : null
        }))
        .sort((a, b) => (
            toNumber(b.netProfitCny, 0) - toNumber(a.netProfitCny, 0)
            || toNumber(b.totalCostCny, 0) - toNumber(a.totalCostCny, 0)
            || toNumber(b.importedCount, 0) - toNumber(a.importedCount, 0)
        ))
        .slice(0, 8);

    const costStatusBreakdown = [...costStatusMap.values()]
        .map((entry) => ({
            ...entry,
            totalCostCny: roundMoney(entry.totalCostCny)
        }))
        .sort((a, b) => b.batchCount - a.batchCount);

    const countQuality = (status) => qualityMap.get(status)?.batchCount || 0;

    return {
        summary: {
            totalBatches,
            totalImported,
            totalCostCny,
            avgUnitCostCny,
            recognizedRevenueCny,
            recognizedCostCny,
            netProfitCny,
            marginRate: recognizedRevenueCny > 0 ? roundRate(netProfitCny / recognizedRevenueCny) : null,
            sourceCount: sourceMap.size,
            unverifiedCount: countQuality('unverified'),
            acceptedCount: countQuality('accepted'),
            watchCount: countQuality('watch'),
            rejectedCount: countQuality('rejected'),
            missingCostCount: normalizedRows.filter((row) => row.unit_cost_cny === null).length,
            orderCount: normalizedRows.reduce((sum, row) => sum + toNumber(row.order_count, 0), 0),
            refundOrderCount: normalizedRows.reduce((sum, row) => sum + toNumber(row.refund_order_count, 0), 0),
            negativeProfitOrderCount: normalizedRows.reduce((sum, row) => sum + toNumber(row.negative_profit_order_count, 0), 0),
            missingCostItemCount: normalizedRows.reduce((sum, row) => sum + toNumber(row.missing_cost_item_count, 0), 0)
        },
        qualityBreakdown,
        costStatusBreakdown,
        costBySource,
        batchRecords: normalizedRows,
        recentBatches: normalizedRows.slice(0, 10)
    };
}

module.exports = async function adminShopProcurementHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'shop.manage' });
        const searchParams = getSearchParams(req);
        const scope = resolveInventoryScopeSite(searchParams.get('site') || req.adminSite);
        const limit = normalizePositiveInteger(searchParams.get('limit'), 1000, 5000);
        const filters = normalizeProcurementFilters(searchParams);

        const { rows, totalCount } = await loadProcurementBatches(supabase, {
            inventorySite: scope.inventorySite,
            limit,
            filters
        });
        const inventoryRows = await loadInventoryRowsByBatchIds(
            supabase,
            rows.map((row) => row?.id)
        );
        const inventoryStatsByBatchId = buildInventoryStatsByBatch(inventoryRows);
        const batchesById = buildBatchMap(rows);
        const orderContext = await loadProcurementOrderContext(supabase, inventoryRows, batchesById);
        const procurementPerformanceByBatchId = buildProcurementPerformanceByBatch(orderContext);
        const [sourcesById, productsById, skusById] = await Promise.all([
            loadRowsByIds(
                supabase,
                'shop_inventory_sources',
                rows.map((row) => row?.source_id),
                'id, source_name, source_url, platform, risk_tier, quality_grade, default_currency, notes, metadata'
            ),
            loadRowsByIds(
                supabase,
                'shop_products',
                rows.map((row) => row?.product_id),
                'id, name'
            ),
            loadRowsByIds(
                supabase,
                'shop_product_skus',
                rows.map((row) => row?.sku_id),
                'id, product_id, sku_name, sku_code'
            )
        ]);

        const context = {
            sourcesById,
            productsById,
            skusById,
            inventoryStatsByBatchId,
            procurementPerformanceByBatchId,
            filters
        };
        const normalizedRowsForSync = rows.map((batch) => normalizeBatchForDisplay(batch, context));
        const autoQualitySync = await syncAutoManagedQuality(supabase, normalizedRowsForSync, {
            userId: user?.id || '',
            site: scope.inventorySite
        });
        const rowsForOverview = autoQualitySync.updatedCount > 0
            ? rows.map((row) => autoQualitySync.updatedRowsById.get(normalizeText(row?.id, 160)) || row)
            : rows;
        const overview = buildOverview(rowsForOverview, context);

        return sendJson(res, 200, {
            success: true,
            site: scope.requestedSite,
            requestedSite: scope.requestedSite,
            inventorySite: scope.inventorySite,
            inventoryScope: scope.inventoryScope,
            limit,
            totalCount,
            filteredCount: overview?.summary?.totalBatches || 0,
            isTruncated: totalCount > rows.length,
            filters: buildProcurementFilterPayload(filters),
            autoQualitySync: {
                reviewedCount: autoQualitySync.reviewedCount,
                updatedCount: autoQualitySync.updatedCount,
                skippedManualCount: autoQualitySync.skippedManualCount,
                skippedConfidenceCount: autoQualitySync.skippedConfidenceCount,
                skippedCurrentCount: autoQualitySync.skippedCurrentCount
            },
            ...overview
        });
    } catch (error) {
        if (isMissingProcurementSchemaError(error)) {
            return sendJson(res, 400, {
                success: false,
                code: 'shop_procurement_schema_missing',
                message: '货源/采购批次数据库结构尚未部署，请先执行 20260606_add_shop_inventory_procurement_sources.sql 后再查看采购概览。',
                details: error?.details || '',
                hint: error?.hint || ''
            });
        }

        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load procurement overview'
        });
    }
};
