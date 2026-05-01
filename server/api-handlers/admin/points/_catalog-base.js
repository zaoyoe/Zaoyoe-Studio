const POINTS_CATALOG_BASE_CACHE_TTL_MS = 5000;

const PACKAGE_BASE_SELECT_FIELDS = [
    'id',
    'name',
    'name_en',
    'points_amount',
    'bonus_points',
    'price_cny',
    'is_active',
    'sort_order',
    'created_at'
].join(', ');

const BATCH_BASE_SELECT_FIELDS = [
    'id',
    'name',
    'site',
    'package_id',
    'channel',
    'total_count',
    'used_count',
    'status',
    'expires_at',
    'notes',
    'custom_points_amount',
    'created_at'
].join(', ');

const pointsCatalogBaseCache = new Map();

function cloneRows(rows = []) {
    return (Array.isArray(rows) ? rows : []).map((row) => ({ ...row }));
}

function cloneBaseData(baseData = {}) {
    return {
        packages: cloneRows(baseData.packages),
        batches: cloneRows(baseData.batches)
    };
}

function normalizeCacheScope(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'cn' || normalized === 'intl') {
        return normalized;
    }
    return 'all';
}

async function loadPointsPackageBaseRows(supabase) {
    const { data, error } = await supabase
        .from('points_packages')
        .select(PACKAGE_BASE_SELECT_FIELDS)
        .order('sort_order', { ascending: true })
        .order('points_amount', { ascending: true });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function loadRedemptionBatchBaseRows(supabase) {
    const { data, error } = await supabase
        .from('redemption_batches')
        .select(BATCH_BASE_SELECT_FIELDS)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function getPointsCatalogBaseData(supabase, options = {}) {
    const forceRefresh = options.forceRefresh === true;
    const cacheKey = `points-catalog-base:${normalizeCacheScope(options.site || options.cacheScope)}`;
    const cached = pointsCatalogBaseCache.get(cacheKey);
    const nowMs = Date.now();

    if (!forceRefresh && cached?.value && nowMs - cached.cachedAt <= POINTS_CATALOG_BASE_CACHE_TTL_MS) {
        return cloneBaseData(cached.value);
    }

    if (!forceRefresh && cached?.promise) {
        return cloneBaseData(await cached.promise);
    }

    const loadPromise = Promise.all([
        loadPointsPackageBaseRows(supabase),
        loadRedemptionBatchBaseRows(supabase)
    ]).then(([packages, batches]) => ({
        packages,
        batches
    }));

    pointsCatalogBaseCache.set(cacheKey, {
        cachedAt: nowMs,
        promise: loadPromise,
        value: null
    });

    try {
        const value = await loadPromise;
        pointsCatalogBaseCache.set(cacheKey, {
            cachedAt: Date.now(),
            value: cloneBaseData(value)
        });
        return cloneBaseData(value);
    } catch (error) {
        pointsCatalogBaseCache.delete(cacheKey);
        throw error;
    }
}

function clearPointsCatalogBaseCache() {
    pointsCatalogBaseCache.clear();
}

module.exports = {
    BATCH_BASE_SELECT_FIELDS,
    PACKAGE_BASE_SELECT_FIELDS,
    clearPointsCatalogBaseCache,
    getPointsCatalogBaseData,
    loadPointsPackageBaseRows,
    loadRedemptionBatchBaseRows
};
