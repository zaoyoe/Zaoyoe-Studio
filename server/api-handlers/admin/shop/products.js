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

function buildProductSearchExpression(searchQuery) {
    const normalizedQuery = normalizeText(searchQuery, 160);
    if (!normalizedQuery) {
        return '';
    }

    const escapedQuery = escapePostgrestLikeValue(normalizedQuery);
    const filters = [
        `name.ilike.%${escapedQuery}%`,
        `category.ilike.%${escapedQuery}%`,
        `delivery_type.ilike.%${escapedQuery}%`
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

    if (fieldsMode === 'import') {
        return 'id, name, category, sort_order, stock_count, is_active';
    }

    return '*';
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
        const fields = normalizeEnum(searchParams.get('fields'), ['full', 'names', 'import'], 'full');
        const searchQuery = normalizeText(searchParams.get('query'), 160);
        const deliveryType = normalizeEnum(
            searchParams.get('deliveryType') || searchParams.get('delivery_type'),
            ['all', 'key', 'api'],
            'all'
        );
        const order = normalizeEnum(
            searchParams.get('order'),
            ['display_order_desc', 'name_asc', 'sort_order_asc'],
            fields === 'names' ? 'name_asc' : 'display_order_desc'
        );
        const category = normalizeText(searchParams.get('category'), 120);

        if (productId) {
            const { data, error } = await supabase
                .from('shop_products')
                .select('*')
                .eq('id', productId)
                .single();

            if (error) {
                throw error;
            }

            return sendJson(res, 200, {
                success: true,
                product: data || null
            });
        }

        let query = supabase
            .from('shop_products')
            .select(getSelectClause(fields));

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

        query = applyOrder(query, order);

        const { data, error } = await query;
        if (error) {
            throw error;
        }

        return sendJson(res, 200, {
            success: true,
            rows: Array.isArray(data) ? data : []
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load shop products'
        });
    }
};
