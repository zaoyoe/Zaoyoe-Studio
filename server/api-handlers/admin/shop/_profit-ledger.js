const {
    loadOrderItemsByOrderIds,
    loadInventoryRecordsByIds,
    collectLinkedInventoryIds,
    buildLinkedInventoryItems
} = require('./_order-linkage');
const {
    buildOrderProfitAttribution
} = require('./_profit');
const {
    loadPointLotConsumptionsByOrderIds,
    summarizePointLotConsumptions
} = require('./_point-lots');

function normalizeText(value, maxLength = 200) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function roundNumber(value, decimals = 2) {
    const numeric = normalizeNumber(value, 0);
    const factor = 10 ** Math.max(0, Number(decimals) || 0);
    return Math.round((numeric + Number.EPSILON) * factor) / factor;
}

function normalizeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isMissingProfitLedgerSchemaError(error = {}) {
    const text = [
        error?.message,
        error?.details,
        error?.hint,
        error?.code
    ].filter(Boolean).join(' ').toLowerCase();

    return text.includes('shop_order_profit_ledger')
        && (
            text.includes('does not exist')
            || text.includes('undefined table')
            || text.includes('could not find')
            || text.includes('schema cache')
            || text.includes('42p01')
            || text.includes('pgrst205')
        );
}

function resolveLedgerDirection(amountCny = 0, group = '') {
    const amount = normalizeNumber(amountCny, 0);
    if (amount > 0) return 'credit';
    if (amount < 0) return 'debit';
    return group === 'cost' ? 'debit' : 'neutral';
}

function mapProfitLedgerEntryToRow(entry = {}, order = {}, userId = '') {
    const orderId = normalizeText(entry.order_id || order?.id, 160);
    const entryType = normalizeText(entry.entry_type, 64);
    const entryGroup = normalizeText(entry.group, 32) || 'adjustment';
    const amountCny = roundNumber(entry.amount_cny, 4);
    const snapshot = {
        ...normalizeJsonObject(entry.snapshot),
        title: normalizeText(entry.title, 160) || null,
        treatment: normalizeText(entry.treatment, 260) || null,
        tone: normalizeText(entry.tone, 40) || null,
        source: 'admin_runtime_profit_attribution_v1'
    };
    const dedupeKey = normalizeText(entry.entry_id, 300)
        || [
            orderId,
            normalizeText(entry.order_item_id, 160),
            normalizeText(entry.inventory_id, 160),
            entryType
        ].filter(Boolean).join(':');

    if (!orderId || !entryType || !dedupeKey) {
        return null;
    }

    return {
        site: normalizeText(order?.site, 16).toLowerCase() || 'cn',
        order_id: orderId,
        order_item_id: normalizeText(entry.order_item_id, 160) || null,
        inventory_id: normalizeText(entry.inventory_id, 160) || null,
        source_batch_id: normalizeText(entry.source_batch_id, 160) || null,
        dedupe_key: dedupeKey,
        entry_type: entryType,
        entry_group: entryGroup,
        direction: resolveLedgerDirection(amountCny, entryGroup),
        amount: amountCny,
        currency: normalizeText(entry.currency, 12).toUpperCase() || 'CNY',
        cash_value_cny: amountCny,
        points_amount: entry.points_amount === null || entry.points_amount === undefined
            ? null
            : roundNumber(entry.points_amount, 2),
        status: normalizeText(entry.status, 32) || 'estimated',
        confidence: normalizeText(entry.confidence, 32) || 'exact',
        occurred_at: entry.occurred_at || order?.created_at || new Date().toISOString(),
        settled_at: ['settled', 'reversed', 'excluded'].includes(normalizeText(entry.status, 32))
            ? new Date().toISOString()
            : null,
        created_by: normalizeText(userId, 160) || null,
        snapshot,
        updated_at: new Date().toISOString()
    };
}

function normalizePersistedProfitLedgerRow(row = {}) {
    const snapshot = normalizeJsonObject(row.snapshot);
    return {
        entry_id: normalizeText(row.dedupe_key || row.id, 300) || null,
        entry_type: normalizeText(row.entry_type, 64) || null,
        title: normalizeText(snapshot.title || row.entry_type, 160) || null,
        amount_cny: roundNumber(row.cash_value_cny ?? row.amount, 4),
        currency: normalizeText(row.currency, 12).toUpperCase() || 'CNY',
        points_amount: row.points_amount === null || row.points_amount === undefined
            ? null
            : roundNumber(row.points_amount, 2),
        status: normalizeText(row.status, 32) || 'estimated',
        confidence: normalizeText(row.confidence, 32) || 'exact',
        group: normalizeText(row.entry_group, 32) || 'adjustment',
        tone: normalizeText(snapshot.tone, 40) || (row.status === 'incomplete' ? 'warning' : 'info'),
        treatment: normalizeText(snapshot.treatment, 260) || null,
        order_id: normalizeText(row.order_id, 160) || null,
        order_item_id: normalizeText(row.order_item_id, 160) || null,
        inventory_id: normalizeText(row.inventory_id, 160) || null,
        source_batch_id: normalizeText(row.source_batch_id, 160) || null,
        occurred_at: row.occurred_at || null,
        snapshot
    };
}

function resolveProfitLedgerStatus(entries = []) {
    const safeEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (!safeEntries.length) return 'none';
    if (safeEntries.some((entry) => entry.status === 'incomplete' || entry.confidence === 'missing')) {
        return 'incomplete';
    }
    if (safeEntries.some((entry) => entry.confidence === 'estimated' || String(entry.status || '').includes('estimated'))) {
        return 'estimated';
    }
    return 'settled';
}

async function selectSingleProfitLedgerRow(queryBuilder) {
    if (!queryBuilder) return null;

    if (typeof queryBuilder.maybeSingle === 'function') {
        const { data, error } = await queryBuilder.maybeSingle();
        if (error) throw error;
        return data || null;
    }

    if (typeof queryBuilder.single === 'function') {
        const { data, error } = await queryBuilder.single();
        if (error) throw error;
        return data || null;
    }

    const { data, error } = await queryBuilder.limit(1);
    if (error) throw error;
    return Array.isArray(data) ? (data[0] || null) : (data || null);
}

async function buildOrderProfitAttributionByOrderId(supabase, orderId = '') {
    const normalizedOrderId = normalizeText(orderId, 160);
    if (!supabase?.from || !normalizedOrderId) {
        return {
            order: null,
            orderItems: [],
            linkedInventoryItems: [],
            attribution: null
        };
    }

    const orderQuery = supabase
        .from('shop_orders');

    if (!orderQuery || typeof orderQuery.select !== 'function') {
        return {
            order: null,
            orderItems: [],
            linkedInventoryItems: [],
            attribution: null
        };
    }

    const order = await selectSingleProfitLedgerRow(
        orderQuery
            .select('*')
            .eq('id', normalizedOrderId)
    );

    if (!order) {
        return {
            order: null,
            orderItems: [],
            linkedInventoryItems: [],
            attribution: null
        };
    }

    const orderItemsByOrderId = await loadOrderItemsByOrderIds(supabase, [normalizedOrderId]);
    const orderItems = orderItemsByOrderId.get(normalizedOrderId) || [];
    const linkedInventoryIds = collectLinkedInventoryIds(order, orderItems);
    const [inventoryRecordsById, pointLotConsumptionsByOrderId] = await Promise.all([
        loadInventoryRecordsByIds(supabase, linkedInventoryIds),
        loadPointLotConsumptionsByOrderIds(supabase, [normalizedOrderId])
    ]);
    const linkedInventoryItems = buildLinkedInventoryItems(order, orderItems, inventoryRecordsById);
    const pointLotSummary = summarizePointLotConsumptions(
        pointLotConsumptionsByOrderId.get(normalizedOrderId) || [],
        Number(order?.price_paid || order?.total_price || 0) || 0
    );
    const attribution = buildOrderProfitAttribution(order, linkedInventoryItems, {
        pointLotSummary
    });

    return {
        order,
        orderItems,
        linkedInventoryItems,
        pointLotSummary,
        attribution
    };
}

async function loadPersistedProfitLedgerEntries(supabase, orderId = '') {
    const normalizedOrderId = normalizeText(orderId, 160);
    if (!supabase || !normalizedOrderId) {
        return {
            source: 'none',
            entries: [],
            status: 'none'
        };
    }

    try {
        const { data, error } = await supabase
            .from('shop_order_profit_ledger')
            .select('id, site, order_id, order_item_id, inventory_id, source_batch_id, dedupe_key, entry_type, entry_group, direction, amount, currency, cash_value_cny, points_amount, status, confidence, occurred_at, settled_at, snapshot')
            .eq('order_id', normalizedOrderId)
            .order('occurred_at', { ascending: true });

        if (error) {
            if (isMissingProfitLedgerSchemaError(error)) {
                return {
                    source: 'missing_schema',
                    entries: [],
                    status: 'missing_schema'
                };
            }
            throw error;
        }

        const entries = (Array.isArray(data) ? data : []).map(normalizePersistedProfitLedgerRow);
        return {
            source: entries.length ? 'persisted' : 'empty',
            entries,
            status: resolveProfitLedgerStatus(entries)
        };
    } catch (error) {
        if (isMissingProfitLedgerSchemaError(error)) {
            return {
                source: 'missing_schema',
                entries: [],
                status: 'missing_schema'
            };
        }
        throw error;
    }
}

async function syncOrderProfitLedger(supabase, order = {}, attribution = {}, options = {}) {
    const orderId = normalizeText(order?.id, 160);
    const entries = Array.isArray(attribution?.profit_ledger_entries)
        ? attribution.profit_ledger_entries.filter(Boolean)
        : [];

    if (!supabase || !orderId || !entries.length) {
        return {
            source: 'preview',
            synced: false,
            entries,
            status: attribution?.profit_ledger_status || resolveProfitLedgerStatus(entries)
        };
    }

    const rows = entries
        .map((entry) => mapProfitLedgerEntryToRow(entry, order, options.userId))
        .filter(Boolean);

    if (!rows.length) {
        return {
            source: 'preview',
            synced: false,
            entries,
            status: attribution?.profit_ledger_status || resolveProfitLedgerStatus(entries)
        };
    }

    try {
        const { error } = await supabase
            .from('shop_order_profit_ledger')
            .upsert(rows, { onConflict: 'order_id,dedupe_key' });

        if (error) {
            if (isMissingProfitLedgerSchemaError(error)) {
                return {
                    source: 'missing_schema',
                    synced: false,
                    entries,
                    status: attribution?.profit_ledger_status || resolveProfitLedgerStatus(entries)
                };
            }
            throw error;
        }

        const persisted = await loadPersistedProfitLedgerEntries(supabase, orderId);
        return {
            source: persisted.source === 'persisted' ? 'persisted' : 'synced',
            synced: true,
            entries: persisted.entries.length ? persisted.entries : entries,
            status: persisted.entries.length ? persisted.status : resolveProfitLedgerStatus(entries)
        };
    } catch (error) {
        if (isMissingProfitLedgerSchemaError(error)) {
            return {
                source: 'missing_schema',
                synced: false,
                entries,
                status: attribution?.profit_ledger_status || resolveProfitLedgerStatus(entries)
            };
        }
        throw error;
    }
}

async function syncOrderProfitLedgerByOrderId(supabase, orderId = '', options = {}) {
    const normalizedOrderId = normalizeText(orderId, 160);
    if (!supabase?.from || !normalizedOrderId) {
        return {
            source: 'none',
            synced: false,
            entries: [],
            status: 'none',
            order: null,
            attribution: null
        };
    }

    const {
        order,
        orderItems,
        linkedInventoryItems,
        attribution
    } = await buildOrderProfitAttributionByOrderId(supabase, normalizedOrderId);

    if (!order || !attribution) {
        return {
            source: 'missing_order',
            synced: false,
            entries: [],
            status: 'none',
            order: null,
            orderItems: [],
            linkedInventoryItems: [],
            attribution: null
        };
    }

    const syncResult = await syncOrderProfitLedger(supabase, order, attribution, options);
    const resolvedAttribution = attachProfitLedgerSyncResult(attribution, syncResult);

    return {
        ...syncResult,
        order,
        orderItems,
        linkedInventoryItems,
        attribution: resolvedAttribution
    };
}

async function safeSyncOrderProfitLedgerByOrderId(supabase, orderId = '', options = {}) {
    try {
        return await syncOrderProfitLedgerByOrderId(supabase, orderId, options);
    } catch (error) {
        const logger = options?.logger || console;
        if (logger?.warn) {
            logger.warn('[ShopProfitLedger] Failed to sync order profit ledger:', error?.message || error);
        }
        return {
            source: 'sync_failed',
            synced: false,
            entries: [],
            status: 'error',
            order: null,
            attribution: null,
            error: error?.message || String(error || 'Unknown error')
        };
    }
}

function attachProfitLedgerSyncResult(attribution = {}, syncResult = {}) {
    const entries = Array.isArray(syncResult.entries) && syncResult.entries.length
        ? syncResult.entries
        : (Array.isArray(attribution.profit_ledger_entries) ? attribution.profit_ledger_entries : []);
    return {
        ...attribution,
        profit_ledger_entries: entries,
        profit_ledger_status: syncResult.status || attribution.profit_ledger_status || resolveProfitLedgerStatus(entries),
        profit_ledger_source: syncResult.source || 'preview',
        profit_ledger_synced: Boolean(syncResult.synced)
    };
}

module.exports = {
    attachProfitLedgerSyncResult,
    buildOrderProfitAttributionByOrderId,
    isMissingProfitLedgerSchemaError,
    loadPersistedProfitLedgerEntries,
    mapProfitLedgerEntryToRow,
    normalizePersistedProfitLedgerRow,
    resolveProfitLedgerStatus,
    safeSyncOrderProfitLedgerByOrderId,
    syncOrderProfitLedgerByOrderId,
    syncOrderProfitLedger
};
