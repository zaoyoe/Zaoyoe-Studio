'use strict';

const { createConfiguredSupplierAdapterRegistry } = require('./registry');

const DEFAULT_DETAIL_TTL_MS = 60 * 1000;
const DEFAULT_CHECKOUT_TTL_MS = 15 * 1000;
const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

// In-memory singleflight map keyed by mapping_id so concurrent requests for the
// same supplier item share a single upstream API request.
const inflightSyncByMappingId = new Map();
const memoryStockCacheByProduct = new Map();

function parseSnapshotQuantity(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const raw = snapshot.availableQuantity ?? snapshot.stock ?? null;
    if (raw === null || raw === undefined || raw === '') return null;
    const num = Number(raw);
    return Number.isFinite(num) && num >= 0 ? Math.trunc(num) : null;
}

function parseSnapshotPrice(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const raw = snapshot.supplierUnitPrice ?? snapshot.price_cny ?? null;
    if (raw === null || raw === undefined || raw === '') return null;
    const num = Number(raw);
    return Number.isFinite(num) && num >= 0 ? num : null;
}

function parseSnapshotCostCeiling(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const raw = snapshot.costCeilingCny ?? snapshot.cost_ceiling_cny ?? null;
    if (raw === null || raw === undefined || raw === '') return null;
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num : null;
}

async function fetchLiveStockForMapping(mapping, account, env = process.env, { includeQuote = false } = {}) {
    const mappingId = String(mapping?.id || '').trim();
    if (!mappingId) return null;

    const inflightKey = `${mappingId}:${includeQuote ? 'quote' : 'stock'}`;
    if (inflightSyncByMappingId.has(inflightKey)) {
        return inflightSyncByMappingId.get(inflightKey);
    }

    const promise = (async () => {
        try {
            const registry = createConfiguredSupplierAdapterRegistry({ env, account });
            const providerId = String(account?.provider_id || 'xiareng').trim();
            const adapter = registry.require(providerId, 'stock');
            const variant = mapping.supplier_variant && typeof mapping.supplier_variant === 'object'
                ? mapping.supplier_variant
                : {};
            const stockPromise = adapter.getStock({
                goodsNo: mapping.supplier_goods_no,
                variant
            });
            const quotePromise = includeQuote && typeof adapter.quotePrice === 'function'
                ? adapter.quotePrice({
                    goodsNo: mapping.supplier_goods_no,
                    quantity: 1,
                    variant
                }).catch(() => null)
                : Promise.resolve(null);
            const [stock, quote] = await Promise.all([stockPromise, quotePromise]);
            const qty = Math.max(0, Math.trunc(Number(stock?.availableQuantity) || 0));
            const rawQuoteAmount = quote?.amount ?? null;
            const parsedQuoteAmount = rawQuoteAmount !== null && rawQuoteAmount !== '' ? Number(rawQuoteAmount) : NaN;
            return {
                availableQuantity: qty,
                unitPrice: Number.isFinite(parsedQuoteAmount) && parsedQuoteAmount > 0 ? parsedQuoteAmount : null,
                checkedAt: stock?.checkedAt || new Date().toISOString(),
                live: true
            };
        } catch (_) {
            return null;
        } finally {
            inflightSyncByMappingId.delete(inflightKey);
        }
    })();

    inflightSyncByMappingId.set(inflightKey, promise);
    return promise;
}

/**
 * Synchronize supplier stock for a product's mappings using a TTL cache
 * (`shop_supplier_availability`) + Singleflight upstream query + piggyback write
 * to `shop_product_skus.stock_count` and `shop_products.stock_count`.
 */
async function syncSupplierProductStock(supabase, {
    productId,
    skuId = null,
    productSkuId = null,
    site = 'cn',
    maxAgeMs = DEFAULT_DETAIL_TTL_MS,
    enableMappings = false,
    allowStaleFallback = true,
    checkCostCeiling = false,
    env = process.env
} = {}) {
    const normalizedProductId = String(productId || '').trim();
    if (!UUID_REGEX.test(normalizedProductId) || typeof supabase?.from !== 'function') {
        return null;
    }

    const normalizedSite = String(site || 'cn').trim().toLowerCase() || 'cn';
    const normalizedSkuId = skuId || productSkuId ? String(skuId || productSkuId).trim() : '';
    const cacheKey = `${normalizedSite}:${normalizedProductId}:${normalizedSkuId || '*'}`;

    if (!enableMappings && !checkCostCeiling && maxAgeMs > 0) {
        const cached = memoryStockCacheByProduct.get(cacheKey);
        if (cached && (Date.now() - cached.checkedAtMs) < maxAgeMs) {
            return {
                ...cached.payload,
                synced: true,
                fromMemoryCache: true
            };
        }
    }

    try {
        const mappingsTable = supabase.from('shop_supplier_product_mappings');
        if (!mappingsTable || typeof mappingsTable.select !== 'function') return null;

        let query = mappingsTable
            .select('id, site, supplier_account_id, product_id, sku_id, supplier_goods_no, supplier_variant, import_snapshot, is_enabled, is_primary, contract_version')
            .eq('product_id', normalizedProductId);

        if (site && typeof query.eq === 'function') {
            query = query.eq('site', String(site).trim().toLowerCase() || 'cn');
        }

        const { data: mappings, error: mapErr } = await query;
        if (mapErr || !Array.isArray(mappings) || !mappings.length) {
            return null;
        }

        const activeMappings = enableMappings
            ? mappings
            : mappings.filter((m) => m?.is_enabled === true);

        const targetMappings = activeMappings.length ? activeMappings : (enableMappings ? mappings : []);
        if (!targetMappings.length) return null;

        const accountIds = [...new Set(targetMappings.map((m) => m.supplier_account_id).filter(Boolean))];
        const mappingIds = targetMappings.map((m) => m.id).filter(Boolean);

        const [accountsRes, availRes] = await Promise.all([
            accountIds.length
                ? supabase.from('shop_supplier_accounts').select('id, provider_id, account_key, credential_ref, is_enabled').in('id', accountIds)
                : { data: [] },
            mappingIds.length
                ? supabase.from('shop_supplier_availability').select('mapping_id, availability_status, available_quantity, supplier_unit_price, currency, checked_at, expires_at').in('mapping_id', mappingIds)
                : { data: [] }
        ]);

        const accountsById = new Map((accountsRes?.data || []).map((acc) => [acc.id, acc]));
        const availByMappingId = new Map((availRes?.data || []).map((row) => [row.mapping_id, row]));
        const nowMs = Date.now();
        const skuStockMap = new Map();
        const skuPriceMap = new Map();
        let totalStock = 0;
        let refreshedLive = false;
        let costExceeded = false;
        let matchedCostCeilingCny = null;
        let matchedUpstreamUnitPrice = null;

        for (const mapping of targetMappings) {
            if (normalizedSkuId && mapping.sku_id && mapping.sku_id !== normalizedSkuId) {
                continue;
            }
            const existingAvail = availByMappingId.get(mapping.id);
            const checkedAtMs = existingAvail?.checked_at ? Date.parse(existingAvail.checked_at) : 0;
            const costCeiling = parseSnapshotCostCeiling(mapping.import_snapshot);
            const snapshotMultiplier = mapping.import_snapshot?.markupMultiplier ?? mapping.import_snapshot?.markup_multiplier ?? null;
            const parsedMultiplier = snapshotMultiplier !== null && Number.isFinite(Number(snapshotMultiplier)) && Number(snapshotMultiplier) >= 1
                ? Number(snapshotMultiplier)
                : null;
            const hasMultiplier = parsedMultiplier !== null;
            const needsQuoteCheck = (checkCostCeiling && costCeiling !== null) || hasMultiplier;
            const isFresh = checkedAtMs > 0 && (nowMs - checkedAtMs) < maxAgeMs
                && Number.isFinite(Number(existingAvail?.available_quantity))
                && (!needsQuoteCheck || Number.isFinite(Number(existingAvail?.supplier_unit_price)));

            let resolvedQty = isFresh ? Math.max(0, Math.trunc(Number(existingAvail.available_quantity))) : null;
            let liveQuotePrice = null;
            const account = accountsById.get(mapping.supplier_account_id);

            if (resolvedQty === null && account?.is_enabled) {
                const live = await fetchLiveStockForMapping(mapping, account, env, {
                    includeQuote: needsQuoteCheck
                });
                if (live && Number.isFinite(live.availableQuantity)) {
                    resolvedQty = live.availableQuantity;
                    liveQuotePrice = live.unitPrice ?? null;
                    refreshedLive = true;
                    const nowIso = new Date().toISOString();
                    const expiresIso = new Date(Date.now() + Math.max(DEFAULT_DETAIL_TTL_MS, maxAgeMs)).toISOString();
                    const unitPrice = liveQuotePrice ?? existingAvail?.supplier_unit_price ?? parseSnapshotPrice(mapping.import_snapshot);
                    await supabase.from('shop_supplier_availability').upsert({
                        mapping_id: mapping.id,
                        availability_status: resolvedQty > 0 ? 'available' : 'unavailable',
                        available_quantity: resolvedQty,
                        minimum_quantity: 1,
                        ...(unitPrice !== null ? { supplier_unit_price: unitPrice } : {}),
                        currency: existingAvail?.currency || 'CNY',
                        checked_at: nowIso,
                        expires_at: expiresIso,
                        last_error_code: null,
                        updated_at: nowIso
                    }, { onConflict: 'mapping_id' });
                }
            }

            const observedPrice = liveQuotePrice
                ?? (existingAvail?.supplier_unit_price != null ? Number(existingAvail.supplier_unit_price) : null)
                ?? parseSnapshotPrice(mapping.import_snapshot);

            if (costCeiling !== null) {
                if (Number.isFinite(observedPrice) && observedPrice > costCeiling) {
                    costExceeded = true;
                    matchedCostCeilingCny = costCeiling;
                    matchedUpstreamUnitPrice = observedPrice;
                }
            }

            if (hasMultiplier && Number.isFinite(observedPrice) && observedPrice > 0) {
                const calculatedSalePrice = Math.round(observedPrice * parsedMultiplier * 100) / 100;
                if (calculatedSalePrice > 0) {
                    if (mapping.sku_id) {
                        skuPriceMap.set(mapping.sku_id, calculatedSalePrice);
                        if (refreshedLive) {
                            const isIntl = normalizedSite === 'intl';
                            const priceCol = isIntl ? 'price_points_intl' : 'price_points';
                            try {
                                await supabase
                                    .from('shop_product_skus')
                                    .update({ [priceCol]: calculatedSalePrice, updated_at: new Date().toISOString() })
                                    .eq('id', mapping.sku_id);
                            } catch (_) {}
                        }
                    }
                }
            }

            if (resolvedQty === null && allowStaleFallback) {
                if (existingAvail && Number.isFinite(Number(existingAvail.available_quantity))) {
                    resolvedQty = Math.max(0, Math.trunc(Number(existingAvail.available_quantity)));
                } else {
                    resolvedQty = parseSnapshotQuantity(mapping.import_snapshot);
                }
            }

            if (enableMappings && mapping.is_enabled !== true) {
                await supabase
                    .from('shop_supplier_product_mappings')
                    .update({ is_enabled: true, is_primary: true, updated_at: new Date().toISOString() })
                    .eq('id', mapping.id);
            }

            if (resolvedQty !== null) {
                if (mapping.sku_id) {
                    skuStockMap.set(mapping.sku_id, resolvedQty);
                    if (refreshedLive || enableMappings) {
                        await supabase
                            .from('shop_product_skus')
                            .update({ stock_count: resolvedQty, updated_at: new Date().toISOString() })
                            .eq('id', mapping.sku_id);
                    }
                }
                totalStock += resolvedQty;
            }
        }

        if (targetMappings.length > 0 && (refreshedLive || enableMappings)) {
            await supabase
                .from('shop_products')
                .update({ stock_count: totalStock, updated_at: new Date().toISOString() })
                .eq('id', normalizedProductId);

            if (skuStockMap.size === 0) {
                try {
                    const { data: defaultSkus } = await supabase
                        .from('shop_product_skus')
                        .select('id, is_default')
                        .eq('product_id', normalizedProductId)
                        .eq('is_active', true);

                    if (Array.isArray(defaultSkus) && defaultSkus.length) {
                        const targetSku = defaultSkus.find((s) => s.is_default) || defaultSkus[0];
                        if (targetSku?.id) {
                            skuStockMap.set(targetSku.id, totalStock);
                            await supabase
                                .from('shop_product_skus')
                                .update({ stock_count: totalStock, updated_at: new Date().toISOString() })
                                .eq('id', targetSku.id);
                        }
                    }
                } catch (_) {}
            }
        }

        let minSalePrice = null;
        if (skuPriceMap.size > 0) {
            const prices = [...skuPriceMap.values()].filter((p) => Number.isFinite(p) && p > 0);
            if (prices.length > 0) {
                minSalePrice = Math.min(...prices);
                if (refreshedLive) {
                    const isIntl = normalizedSite === 'intl';
                    const priceCol = isIntl ? 'price_points_intl' : 'price_points';
                    try {
                        await supabase
                            .from('shop_products')
                            .update({ [priceCol]: minSalePrice, updated_at: new Date().toISOString() })
                            .eq('id', normalizedProductId);
                    } catch (_) {}
                }
            }
        }

        const resultPayload = {
            synced: true,
            isSupplierProduct: true,
            productId: normalizedProductId,
            stockCount: totalStock,
            skuStockMap: Object.fromEntries(skuStockMap),
            skuPriceMap: Object.fromEntries(skuPriceMap),
            ...(minSalePrice !== null ? { priceCny: minSalePrice } : {}),
            refreshedLive,
            costExceeded,
            ...(matchedCostCeilingCny !== null ? { costCeilingCny: matchedCostCeilingCny } : {}),
            ...(matchedUpstreamUnitPrice !== null ? { upstreamUnitPrice: matchedUpstreamUnitPrice } : {})
        };

        memoryStockCacheByProduct.set(cacheKey, {
            checkedAtMs: Date.now(),
            payload: resultPayload
        });

        return resultPayload;
    } catch (_) {
        return null;
    }
}

/**
 * Record piggyback stock after a live upstream purchase check so local stock
 * stays aligned without extra API requests.
 */
async function recordPiggybackSupplierStock(supabase, {
    mappingId,
    productId,
    skuId,
    availableQuantity
} = {}) {
    if (typeof supabase?.from !== 'function' || !Number.isFinite(Number(availableQuantity))) {
        return;
    }
    const qty = Math.max(0, Math.trunc(Number(availableQuantity)));
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + DEFAULT_DETAIL_TTL_MS).toISOString();
    try {
        if (UUID_REGEX.test(String(mappingId || ''))) {
            await supabase.from('shop_supplier_availability').upsert({
                mapping_id: mappingId,
                availability_status: qty > 0 ? 'available' : 'unavailable',
                available_quantity: qty,
                checked_at: nowIso,
                expires_at: expiresIso,
                updated_at: nowIso
            }, { onConflict: 'mapping_id' });
        }
        if (UUID_REGEX.test(String(skuId || ''))) {
            await supabase.from('shop_product_skus').update({ stock_count: qty, updated_at: nowIso }).eq('id', skuId);
        }
        if (UUID_REGEX.test(String(productId || ''))) {
            await supabase.from('shop_products').update({ stock_count: qty, updated_at: nowIso }).eq('id', productId);
        }
    } catch (_) {
        // Non-blocking piggyback update
    }
}

module.exports = {
    DEFAULT_DETAIL_TTL_MS,
    DEFAULT_CHECKOUT_TTL_MS,
    syncSupplierProductStock,
    recordPiggybackSupplierStock
};
