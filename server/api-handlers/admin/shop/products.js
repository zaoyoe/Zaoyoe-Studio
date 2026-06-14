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

function normalizeEnum(value, allowedValues, fallback) {
    const normalized = normalizeText(value, 40).toLowerCase();
    return allowedValues.includes(normalized) ? normalized : fallback;
}

function parseIdList(value) {
    return [...new Set(
        String(value || '')
            .split(',')
            .map((item) => normalizeText(item, 160))
            .filter(Boolean)
    )];
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
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = normalizeText(value, 20).toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

const SHOP_PRODUCT_SKU_SELECT = [
    'id',
    'product_id',
    'sku_code',
    'sku_name',
    'spec_values',
    'inventory_sku_id',
    'inventory_source_sku_ids',
    'manual_delivery',
    'price_points',
    'price_points_intl',
    'quantity_rules',
    'quantity_rules_intl',
    'is_default',
    'is_active',
    'stock_count',
    'sort_order'
].join(', ');
const SHOP_PRODUCT_SKU_SELECT_WITHOUT_INVENTORY_SOURCE_LIST = SHOP_PRODUCT_SKU_SELECT
    .replace('inventory_source_sku_ids, ', '');
const SHOP_PRODUCT_SKU_SELECT_WITHOUT_INVENTORY = SHOP_PRODUCT_SKU_SELECT
    .replace('spec_values, inventory_sku_id, inventory_source_sku_ids, manual_delivery, price_points', 'spec_values, manual_delivery, price_points');
const SHOP_PRODUCT_SKU_SELECT_WITHOUT_MANUAL_DELIVERY = SHOP_PRODUCT_SKU_SELECT
    .replace('manual_delivery, ', '');
const SHOP_PRODUCT_SKU_SELECT_LEGACY = SHOP_PRODUCT_SKU_SELECT_WITHOUT_INVENTORY
    .replace('manual_delivery, ', '');

function isMissingColumnError(error, columnName = '') {
    const normalizedMessage = String(error?.message || '').trim().toLowerCase();
    const normalizedColumn = String(columnName || '').trim().toLowerCase();
    if (!normalizedMessage || !normalizedColumn) {
        return false;
    }

    return normalizedMessage.includes(normalizedColumn)
        && (
            normalizedMessage.includes('does not exist')
            || normalizedMessage.includes('not exist')
            || normalizedMessage.includes('undefined column')
            || normalizedMessage.includes('schema cache')
        );
}

function buildProductSearchExpression(searchQuery) {
    const normalizedQuery = normalizeText(searchQuery, 160);
    if (!normalizedQuery) {
        return '';
    }

    const escapedQuery = escapePostgrestLikeValue(normalizedQuery);
    const filters = [
        `name.ilike.%${escapedQuery}%`,
        `category.ilike.%${escapedQuery}%`
    ];

    if (isUuid(normalizedQuery)) {
        filters.unshift(`id.eq.${escapePostgrestEqValue(normalizedQuery)}`);
    }

    return filters.join(',');
}

function getSelectClause(fieldsMode) {
    if (fieldsMode === 'names') {
        return 'id, name';
    }

    if (fieldsMode === 'picker') {
        return 'id, name, category, stock_count, is_active';
    }

    if (fieldsMode === 'import') {
        return 'id, name, category, sort_order, display_order, stock_count, is_active';
    }

    return '*';
}

function getFullSelectAttempts() {
    return [
        '*',
        [
            'id',
            'name',
            'name_en',
            'description',
            'description_en',
            'icon_url',
            'image_assets',
            'price_points',
            'price_points_intl',
            'stock_count',
            'category',
            'tags',
            'display_order',
            'sort_order',
            'is_active',
            'quantity_rules',
            'quantity_rules_intl',
            'max_purchase_quantity',
            'purchase_limit_24h_quantity',
            'purchase_limit_window_quantity',
            'purchase_limit_window_minutes',
            'per_account_purchase_limit',
            'delivery_type',
            'webhook_target',
            'manual_delivery',
            'show_product_description',
            'show_purchase_notes',
            'purchase_notes',
            'purchase_notes_zh',
            'purchase_notes_en',
            'show_usage_instructions',
            'usage_instructions',
            'usage_instructions_zh',
            'usage_instructions_en',
            'flash_sale_price',
            'flash_sale_price_intl',
            'flash_sale_end',
            'flash_sale_end_intl'
        ].join(', ')
    ];
}

function buildShopProductImageCacheVersion(row = {}) {
    return normalizeText(row?.image_updated_at || row?.updated_at || row?.created_at || '', 80);
}

function attachShopProductImageCacheVersion(row = {}) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return row;
    }

    const version = buildShopProductImageCacheVersion(row);
    if (!version) {
        return row;
    }

    return {
        ...row,
        image_cache_version: row.image_cache_version || version
    };
}

function attachShopProductsImageCacheVersion(rows = []) {
    return (Array.isArray(rows) ? rows : []).map((row) => attachShopProductImageCacheVersion(row));
}

function normalizeProductSkuSpecValues(value = {}) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isAdminRemovedProductSku(row = {}) {
    const specValues = normalizeProductSkuSpecValues(row?.spec_values);
    return specValues.__admin_removed_from_editor === true;
}

function filterEditableProductSkus(rows = []) {
    return (Array.isArray(rows) ? rows : []).filter((row) => !isAdminRemovedProductSku(row));
}

async function runProductSelectWithFallback(baseQueryFactory, selectAttempts = []) {
    let lastError = null;
    const attempts = Array.isArray(selectAttempts) && selectAttempts.length ? selectAttempts : ['*'];

    for (const selectClause of attempts) {
        const query = baseQueryFactory(selectClause);
        const result = await query;
        if (!result.error) {
            return result;
        }
        lastError = result.error;
    }

    return {
        data: null,
        error: lastError
    };
}

async function loadProductSkusWithSharedInventoryFallback(supabase, applyFilter) {
    const buildQuery = (selectClause) => {
        let query = supabase
            .from('shop_product_skus')
            .select(selectClause);

        query = applyFilter(query);

        return query
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });
    };

    let response = { data: null, error: null };
    const selectAttempts = [
        SHOP_PRODUCT_SKU_SELECT,
        SHOP_PRODUCT_SKU_SELECT_WITHOUT_INVENTORY_SOURCE_LIST,
        SHOP_PRODUCT_SKU_SELECT_WITHOUT_INVENTORY,
        SHOP_PRODUCT_SKU_SELECT_WITHOUT_MANUAL_DELIVERY,
        SHOP_PRODUCT_SKU_SELECT_LEGACY
    ];

    for (const selectClause of selectAttempts) {
        response = await buildQuery(selectClause);
        if (!response.error) {
            break;
        }
        if (
            !isMissingColumnError(response.error, 'inventory_sku_id')
            && !isMissingColumnError(response.error, 'inventory_source_sku_ids')
            && !isMissingColumnError(response.error, 'manual_delivery')
        ) {
            break;
        }
    }

    return response;
}

function applyOrder(query, orderMode) {
    if (orderMode === 'name_asc') {
        return query.order('name', { ascending: true });
    }

    if (orderMode === 'sort_order_asc') {
        return query.order('sort_order', { ascending: true });
    }

    return query.order('display_order', { ascending: false });
}

module.exports = async function adminShopProductsHandler(req, res) {
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
        const productId = normalizeText(searchParams.get('id') || searchParams.get('productId'), 160);
        const ids = parseIdList(searchParams.get('ids'));
        const status = normalizeEnum(searchParams.get('status'), ['all', 'active', 'deleted'], 'all');
        const fields = normalizeEnum(searchParams.get('fields'), ['full', 'names', 'import', 'picker'], 'full');
        const searchQuery = normalizeText(searchParams.get('query'), 160);
        const deliveryType = normalizeEnum(
            searchParams.get('deliveryType') || searchParams.get('delivery_type'),
            ['all', 'key', 'api'],
            'all'
        );
        const order = normalizeEnum(
            searchParams.get('order'),
            ['display_order_desc', 'name_asc', 'sort_order_asc'],
            fields === 'names' || fields === 'picker' ? 'name_asc' : 'display_order_desc'
        );
        const category = normalizeText(searchParams.get('category'), 120);
        const includeSkus = normalizeBoolean(searchParams.get('includeSkus') || searchParams.get('include_skus'), false);

        if (productId) {
            const { data, error } = await runProductSelectWithFallback(
                (selectClause) => supabase
                    .from('shop_products')
                    .select(selectClause)
                    .eq('id', productId)
                    .single(),
                getFullSelectAttempts()
            );

            if (error) {
                throw error;
            }

            let product = attachShopProductImageCacheVersion(data || null);
            if (includeSkus && product?.id) {
                const { data: skuRows, error: skuError } = await loadProductSkusWithSharedInventoryFallback(
                    supabase,
                    (query) => query.eq('product_id', product.id)
                );

                if (skuError) {
                    throw skuError;
                }

                product = {
                    ...product,
                    skus: filterEditableProductSkus(skuRows)
                };
            }

            return sendJson(res, 200, {
                success: true,
                product
            });
        }

        const buildQuery = (selectClause) => {
            let query = supabase
                .from('shop_products')
                .select(selectClause);

            if (ids.length) {
                query = query.in('id', ids);
            }

            if (status === 'active') {
                query = query.eq('is_active', true);
            } else if (status === 'deleted') {
                query = query.eq('is_active', false);
            }

            if (category && category !== 'all') {
                query = query.eq('category', category);
            }

            if (deliveryType === 'key') {
                query = query.eq('delivery_type', 'KEY');
            } else if (deliveryType === 'api') {
                query = query.eq('delivery_type', 'API');
            }

            if (searchQuery) {
                query = query.or(buildProductSearchExpression(searchQuery));
            }

            return applyOrder(query, order);
        };

        const { data, error } = fields === 'full'
            ? await runProductSelectWithFallback(buildQuery, getFullSelectAttempts())
            : await buildQuery(getSelectClause(fields));
        if (error) {
            throw error;
        }

        let rows = attachShopProductsImageCacheVersion(Array.isArray(data) ? data : []);

        if (includeSkus && rows.length) {
            const productIds = rows.map((row) => normalizeText(row?.id, 160)).filter(Boolean);
            const { data: skuRows, error: skuError } = await loadProductSkusWithSharedInventoryFallback(
                supabase,
                (query) => query.in('product_id', productIds)
            );

            if (skuError) {
                throw skuError;
            }

            const skusByProductId = new Map();
            filterEditableProductSkus(skuRows).forEach((sku) => {
                const skuProductId = normalizeText(sku?.product_id, 160);
                if (!skuProductId) return;
                if (!skusByProductId.has(skuProductId)) {
                    skusByProductId.set(skuProductId, []);
                }
                skusByProductId.get(skuProductId).push(sku);
            });

            rows = rows.map((row) => ({
                ...row,
                skus: skusByProductId.get(normalizeText(row?.id, 160)) || []
            }));
        }

        return sendJson(res, 200, {
            success: true,
            rows
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load shop products'
        });
    }
};
