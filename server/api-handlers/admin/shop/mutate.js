const {
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

async function countAvailableInventory(supabase, productId, skuId = '') {
    let query = supabase
        .from('shop_inventory')
        .select('*', { count: 'exact', head: true })
        .eq('product_id', productId)
        .eq('status', 'available');

    if (skuId) {
        query = query.eq('sku_id', skuId);
    }

    const { count } = await query;
    return Number(count || 0);
}

function normalizePositiveInteger(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const normalized = Number.parseInt(String(value), 10);
    if (!Number.isFinite(normalized) || normalized <= 0) {
        return null;
    }

    return normalized;
}

function normalizeNonNegativeInteger(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const normalized = Number.parseInt(String(value), 10);
    if (!Number.isFinite(normalized) || normalized < 0) {
        return null;
    }

    return normalized;
}

function normalizeIsoDate(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const timestamp = Date.parse(String(value));
    if (!Number.isFinite(timestamp)) {
        return null;
    }

    return new Date(timestamp).toISOString();
}

function normalizeText(value, maxLength = 200) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeNullableNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return null;
    }

    return Math.round(parsed * 100) / 100;
}

function normalizeSkuQuantityPricingRules(value) {
    let sourceRules = value;
    if (typeof sourceRules === 'string' && sourceRules.trim()) {
        try {
            sourceRules = JSON.parse(sourceRules);
        } catch (_) {
            sourceRules = [];
        }
    }

    const rules = (Array.isArray(sourceRules) ? sourceRules : [])
        .map((rule) => {
            const qty = Math.trunc(Number(rule?.qty ?? rule?.quantity ?? rule?.min_quantity));
            const price = normalizeNullableNumber(rule?.price ?? rule?.unit_price);
            return { qty, price };
        })
        .filter((rule) => Number.isFinite(rule.qty)
            && rule.qty > 0
            && rule.price !== null)
        .sort((left, right) => (left.qty - right.qty) || (left.price - right.price));

    return rules.length ? rules : null;
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }

    const normalized = normalizeText(value, 20).toLowerCase();
    if (!normalized) {
        return fallback;
    }

    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
        return true;
    }

    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
        return false;
    }

    return fallback;
}

const SHOP_PRODUCT_SKU_SELECT = [
    'id',
    'product_id',
    'sku_code',
    'sku_name',
    'spec_values',
    'inventory_sku_id',
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

async function resolveProductSkuForInventoryImport(supabase, productId, requestedSkuId = '') {
    const normalizedProductId = normalizeText(productId, 160);
    const normalizedSkuId = normalizeText(requestedSkuId, 160);

    if (!normalizedProductId) {
        return null;
    }

    let query = supabase
        .from('shop_product_skus')
        .select('id, product_id, sku_name, sku_code, inventory_sku_id, is_default, is_active, stock_count')
        .eq('product_id', normalizedProductId);

    query = normalizedSkuId
        ? query.eq('id', normalizedSkuId)
        : query.eq('is_default', true);

    const { data, error } = await query.single();

    if (error || !data) {
        if (normalizedSkuId) {
            throw Object.assign(new Error('选择的商品规格不存在，或不属于当前商品'), {
                statusCode: 400,
                code: 'shop_product_sku_not_found'
            });
        }
        return null;
    }

    if (data.is_active === false) {
        throw Object.assign(new Error('选择的商品规格已停用，不能导入库存'), {
            statusCode: 400,
            code: 'shop_product_sku_inactive'
        });
    }

    const inventorySourceSkuId = normalizeText(data.inventory_sku_id, 160);
    if (inventorySourceSkuId) {
        let sourceLabel = '被关联的规格';
        try {
            const { data: sourceSku } = await supabase
                .from('shop_product_skus')
                .select('id, sku_name, sku_code')
                .eq('product_id', normalizedProductId)
                .eq('id', inventorySourceSkuId)
                .single();

            const sourceName = normalizeText(sourceSku?.sku_name, 120);
            const sourceCode = normalizeText(sourceSku?.sku_code, 80);
            if (sourceName || sourceCode) {
                sourceLabel = `${sourceName || '被关联的规格'}${sourceCode ? ` / ${sourceCode}` : ''}`;
            }
        } catch (_error) {
            sourceLabel = '被关联的规格';
        }

        throw Object.assign(new Error(`该规格共用其他规格库存，请上传到被关联的规格：${sourceLabel}`), {
            statusCode: 400,
            code: 'shop_product_sku_inventory_alias_not_importable'
        });
    }

    return data;
}

function normalizeProductSkuDrafts(value = []) {
    const rawEntries = Array.isArray(value) ? value : [];
    const normalized = rawEntries
        .map((entry, index) => {
            const source = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
            const skuName = normalizeText(source.sku_name || source.skuName || source.name, 120);
            const skuCode = normalizeText(source.sku_code || source.skuCode || source.code, 80);
            const id = normalizeText(source.id || source.sku_id || source.skuId, 160);
            const inventorySkuId = normalizeText(
                source.inventory_sku_id
                || source.inventorySkuId
                || source.inventory_source_sku_id
                || source.inventorySourceSkuId
                || source.stock_sku_id
                || source.stockSkuId,
                160
            );

            if (!skuName && !skuCode && !id && !inventorySkuId) {
                return null;
            }

            return {
                id,
                sku_code: skuCode || null,
                sku_name: skuName || skuCode || `规格 ${index + 1}`,
                spec_values: source.spec_values && typeof source.spec_values === 'object' && !Array.isArray(source.spec_values)
                    ? source.spec_values
                    : {},
                inventory_sku_id: inventorySkuId || null,
                price_points: normalizeNullableNumber(source.price_points ?? source.pricePoints),
                price_points_intl: normalizeNullableNumber(source.price_points_intl ?? source.pricePointsIntl),
                quantity_rules: normalizeSkuQuantityPricingRules(source.quantity_rules ?? source.quantityRules),
                quantity_rules_intl: normalizeSkuQuantityPricingRules(source.quantity_rules_intl ?? source.quantityRulesIntl),
                manual_delivery: normalizeBoolean(source.manual_delivery ?? source.manualDelivery, false),
                is_default: normalizeBoolean(source.is_default ?? source.isDefault, false),
                is_active: normalizeBoolean(source.is_active ?? source.isActive, true),
                sort_order: normalizeNonNegativeInteger(source.sort_order ?? source.sortOrder) ?? index
            };
        })
        .filter(Boolean);

    const seenCodes = new Set();
    normalized.forEach((sku) => {
        const codeKey = normalizeText(sku.sku_code, 80).toLowerCase();
        if (codeKey) {
            if (seenCodes.has(codeKey)) {
                sku.sku_code = null;
            } else {
                seenCodes.add(codeKey);
            }
        }
    });

    if (!normalized.length) {
        return [];
    }

    const firstActiveIndex = normalized.findIndex((sku) => sku.is_active !== false);
    let defaultIndex = normalized.findIndex((sku) => sku.is_default && sku.is_active !== false);
    if (defaultIndex < 0) {
        defaultIndex = firstActiveIndex >= 0 ? firstActiveIndex : 0;
    }

    return normalized.map((sku, index) => ({
        ...sku,
        is_default: index === defaultIndex
    }));
}

function normalizeProductSkuCodeKey(value) {
    return normalizeText(value, 80).toLowerCase();
}

function extractDuplicateProductSkuCode(error = {}) {
    const text = [
        error?.details,
        error?.message,
        error?.hint
    ].filter(Boolean).join(' ');
    const detailMatch = text.match(/Key\s*\([^)]*sku_code[^)]*\)=\([^,]+,\s*([^)]+)\)/i);
    if (detailMatch?.[1]) {
        return normalizeText(detailMatch[1].replace(/^"|"$/g, ''), 80);
    }

    return '';
}

function isDuplicateProductSkuCodeError(error = {}) {
    const text = [
        error?.code,
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(' ').toLowerCase();

    return text.includes('23505')
        || text.includes('ux_shop_product_skus_product_code')
        || text.includes('duplicate key value violates unique constraint');
}

function createDuplicateProductSkuCodeError(skuCode = '', sourceError = null) {
    const normalizedCode = normalizeText(skuCode || extractDuplicateProductSkuCode(sourceError), 80);
    const codeLabel = normalizedCode ? `「${normalizedCode}」` : '当前编码';
    const error = Object.assign(
        new Error(`商品规格编码重复：同一个商品下已存在编码 ${codeLabel}。请给每个规格设置唯一编码，或先把旧规格改成其它编码后再保存。`),
        {
            statusCode: 400,
            code: 'shop_product_sku_code_duplicate',
            details: sourceError?.details || '',
            hint: sourceError?.hint || ''
        }
    );
    return error;
}

function createInvalidProductSkuInventorySourceError(sourceSkuId = '') {
    const normalizedSourceSkuId = normalizeText(sourceSkuId, 160);
    const sourceLabel = normalizedSourceSkuId ? `「${normalizedSourceSkuId}」` : '当前库存来源';
    return Object.assign(
        new Error(`商品规格库存来源无效：${sourceLabel} 必须是本商品本次保留的规格，且不能指向另一个共享库存规格。`),
        {
            statusCode: 400,
            code: 'shop_product_sku_inventory_source_invalid'
        }
    );
}

async function ensureDefaultProductSku(supabase, product = {}) {
    const productId = normalizeText(product?.id, 160);
    if (!productId) {
        return null;
    }

    const { data: existing, error: existingError } = await supabase
        .from('shop_product_skus')
        .select(SHOP_PRODUCT_SKU_SELECT)
        .eq('product_id', productId)
        .eq('is_default', true)
        .limit(1);

    if (existingError) {
        throw existingError;
    }

    if (Array.isArray(existing) && existing.length) {
        return existing[0];
    }

    const { data: existingDefaultCode, error: existingDefaultCodeError } = await supabase
        .from('shop_product_skus')
        .select(SHOP_PRODUCT_SKU_SELECT)
        .eq('product_id', productId)
        .eq('sku_code', 'default')
        .limit(1);

    if (existingDefaultCodeError) {
        throw existingDefaultCodeError;
    }

    if (Array.isArray(existingDefaultCode) && existingDefaultCode.length) {
        const defaultCodeSku = existingDefaultCode[0];
        if (defaultCodeSku?.id && defaultCodeSku.is_default !== true) {
            const { error: activateDefaultError } = await supabase
                .from('shop_product_skus')
                .update({ is_default: true, is_active: true })
                .eq('id', defaultCodeSku.id);

            if (activateDefaultError) {
                throw activateDefaultError;
            }

            defaultCodeSku.is_default = true;
            defaultCodeSku.is_active = true;
        }
        return defaultCodeSku;
    }

    const { data, error } = await supabase
        .from('shop_product_skus')
        .insert({
            product_id: productId,
            sku_code: 'default',
            sku_name: normalizeText(product?.name, 120) || '默认规格',
            spec_values: { label: '默认规格' },
            price_points: normalizeNullableNumber(product?.price_points),
            price_points_intl: normalizeNullableNumber(product?.price_points_intl),
            quantity_rules: normalizeSkuQuantityPricingRules(product?.quantity_rules),
            quantity_rules_intl: normalizeSkuQuantityPricingRules(product?.quantity_rules_intl),
            manual_delivery: normalizeBoolean(product?.manual_delivery, false),
            is_default: true,
            is_active: true,
            sort_order: 0
        })
        .select(SHOP_PRODUCT_SKU_SELECT)
        .limit(1);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data[0] || null : null;
}

async function syncProductSkus(supabase, product = {}, skuDrafts = []) {
    const productId = normalizeText(product?.id, 160);
    if (!productId) {
        return [];
    }

    const normalizedDrafts = normalizeProductSkuDrafts(skuDrafts);
    if (!normalizedDrafts.length) {
        const defaultSku = await ensureDefaultProductSku(supabase, product);
        return defaultSku ? [defaultSku] : [];
    }

    const { data: existingRows, error: existingError } = await supabase
        .from('shop_product_skus')
        .select(SHOP_PRODUCT_SKU_SELECT)
        .eq('product_id', productId);

    if (existingError) {
        throw existingError;
    }

    const existingRowList = Array.isArray(existingRows) ? existingRows : [];
    const existingIds = new Set(existingRowList
        .map((row) => normalizeText(row?.id, 160))
        .filter(Boolean));
    const existingRowsByCode = new Map();
    const existingInventorySourceById = new Map();
    existingRowList.forEach((row) => {
        const rowId = normalizeText(row?.id, 160);
        const codeKey = normalizeProductSkuCodeKey(row?.sku_code);
        if (rowId && codeKey && !existingRowsByCode.has(codeKey)) {
            existingRowsByCode.set(codeKey, row);
        }
        if (rowId) {
            existingInventorySourceById.set(rowId, normalizeText(row?.inventory_sku_id, 160) || null);
        }
    });
    const matchedDrafts = normalizedDrafts.map((draft) => {
        const draftId = normalizeText(draft.id, 160);
        const draftCodeKey = normalizeProductSkuCodeKey(draft.sku_code);
        const matchedExistingByCode = draftCodeKey ? existingRowsByCode.get(draftCodeKey) || null : null;
        const resolvedExistingId = draftId && existingIds.has(draftId)
            ? draftId
            : normalizeText(matchedExistingByCode?.id, 160);

        return {
            draft,
            draftCodeKey,
            resolvedExistingId
        };
    });
    const retainedResolvedIds = new Set(matchedDrafts
        .map((entry) => normalizeText(entry.resolvedExistingId, 160))
        .filter(Boolean));
    const desiredInventorySourceById = new Map();
    matchedDrafts.forEach((entry) => {
        const resolvedExistingId = normalizeText(entry.resolvedExistingId, 160);
        if (!resolvedExistingId) return;

        const sourceId = normalizeText(entry.draft.inventory_sku_id, 160);
        desiredInventorySourceById.set(
            resolvedExistingId,
            sourceId && sourceId !== resolvedExistingId ? sourceId : null
        );
    });

    for (const entry of matchedDrafts) {
        const sourceId = normalizeText(entry.draft.inventory_sku_id, 160);
        if (!sourceId) {
            continue;
        }

        const resolvedExistingId = normalizeText(entry.resolvedExistingId, 160);
        if (sourceId === resolvedExistingId) {
            entry.draft.inventory_sku_id = null;
            continue;
        }

        if (!retainedResolvedIds.has(sourceId)) {
            throw createInvalidProductSkuInventorySourceError(sourceId);
        }

        const targetDesiredSource = desiredInventorySourceById.has(sourceId)
            ? desiredInventorySourceById.get(sourceId)
            : existingInventorySourceById.get(sourceId);
        if (targetDesiredSource) {
            throw createInvalidProductSkuInventorySourceError(sourceId);
        }
    }

    const desiredCodeTargets = new Map();
    for (const entry of matchedDrafts) {
        if (!entry.draftCodeKey) continue;
        const previousTarget = desiredCodeTargets.get(entry.draftCodeKey);
        if (previousTarget && previousTarget !== entry.resolvedExistingId) {
            throw createDuplicateProductSkuCodeError(entry.draft.sku_code);
        }
        desiredCodeTargets.set(entry.draftCodeKey, entry.resolvedExistingId);
    }

    for (const [codeKey, targetId] of desiredCodeTargets.entries()) {
        const existingOwner = existingRowsByCode.get(codeKey) || null;
        const existingOwnerId = normalizeText(existingOwner?.id, 160);
        if (!existingOwnerId || existingOwnerId === targetId) {
            continue;
        }

        const { error: releaseCodeError } = await supabase
            .from('shop_product_skus')
            .update({ sku_code: null })
            .eq('id', existingOwnerId);

        if (releaseCodeError) {
            if (isDuplicateProductSkuCodeError(releaseCodeError)) {
                throw createDuplicateProductSkuCodeError(existingOwner?.sku_code, releaseCodeError);
            }
            throw releaseCodeError;
        }
    }

    const retainedIds = new Set();
    const savedRows = [];
    let defaultSkuId = '';

    for (const { draft, resolvedExistingId } of matchedDrafts) {
        const basePayload = {
            product_id: productId,
            sku_code: draft.sku_code,
            sku_name: draft.sku_name,
            spec_values: draft.spec_values,
            inventory_sku_id: draft.inventory_sku_id || null,
            manual_delivery: draft.manual_delivery === true,
            price_points: draft.price_points,
            price_points_intl: draft.price_points_intl,
            quantity_rules: draft.quantity_rules,
            quantity_rules_intl: draft.quantity_rules_intl,
            is_default: false,
            is_active: draft.is_active,
            sort_order: draft.sort_order
        };
        const hasExistingId = Boolean(resolvedExistingId && existingIds.has(resolvedExistingId));
        const query = hasExistingId
            ? supabase
                .from('shop_product_skus')
                .update(basePayload)
                .eq('id', resolvedExistingId)
            : supabase
                .from('shop_product_skus')
                .insert(basePayload);

        const { data, error } = await query
            .select(SHOP_PRODUCT_SKU_SELECT)
            .limit(1);

        if (error) {
            if (isDuplicateProductSkuCodeError(error)) {
                throw createDuplicateProductSkuCodeError(draft.sku_code, error);
            }
            throw error;
        }

        const saved = Array.isArray(data) ? data[0] || null : null;
        if (saved?.id) {
            retainedIds.add(saved.id);
            if (draft.is_default) {
                defaultSkuId = saved.id;
            }
            savedRows.push(saved);
        }
    }

    if (defaultSkuId) {
        const { error: clearDefaultError } = await supabase
            .from('shop_product_skus')
            .update({ is_default: false })
            .eq('product_id', productId);

        if (clearDefaultError) {
            throw clearDefaultError;
        }

        const { error: setDefaultError } = await supabase
            .from('shop_product_skus')
            .update({ is_default: true, is_active: true })
            .eq('id', defaultSkuId);

        if (setDefaultError) {
            throw setDefaultError;
        }

        savedRows.forEach((row) => {
            row.is_default = row.id === defaultSkuId;
            if (row.id === defaultSkuId) {
                row.is_active = true;
            }
        });
    }

    const removableIds = [...existingIds].filter((id) => !retainedIds.has(id));
    for (const removableId of removableIds) {
        const { count, error: countError } = await supabase
            .from('shop_inventory')
            .select('*', { count: 'exact', head: true })
            .eq('sku_id', removableId);

        if (countError) {
            throw countError;
        }

        const updatePayload = { is_active: false, is_default: false, sku_code: null };
        const { error: updateError } = await supabase
            .from('shop_product_skus')
            .update(updatePayload)
            .eq('id', removableId);

        if (updateError) {
            throw updateError;
        }

        if (Number(count || 0) > 0) {
            const existing = (Array.isArray(existingRows) ? existingRows : []).find((row) => row.id === removableId);
            savedRows.push({
                ...(existing || { id: removableId, product_id: productId }),
                ...updatePayload
            });
        }
    }

    return savedRows.sort((left, right) => {
        if (left.is_default !== right.is_default) return left.is_default ? -1 : 1;
        return Number(left.sort_order || 0) - Number(right.sort_order || 0)
            || normalizeText(left.sku_name, 120).localeCompare(normalizeText(right.sku_name, 120), 'zh-CN');
    });
}

function normalizeStringArray(value, maxLength = 160) {
    return [...new Set(
        (Array.isArray(value) ? value : [])
            .map((entry) => normalizeText(entry, maxLength))
            .filter(Boolean)
    )];
}

function normalizeCategoryColor(value, fallback = null) {
    const normalized = normalizeText(value, 32);
    if (!normalized) {
        return fallback;
    }

    return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

async function getNextCategorySortOrder(supabase) {
    const { data, error } = await supabase
        .from('shop_categories')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1);

    if (error) {
        throw error;
    }

    return (Number(data?.[0]?.sort_order || 0) || 0) + 10;
}

async function ensureFallbackCategory(supabase, categoryName = 'other') {
    const fallbackName = normalizeText(categoryName, 120) || 'other';
    const { data, error } = await supabase
        .from('shop_categories')
        .select('id, name, color, sort_order')
        .eq('name', fallbackName)
        .limit(1);

    if (error) {
        throw error;
    }

    if (Array.isArray(data) && data.length) {
        return data[0];
    }

    const sortOrder = await getNextCategorySortOrder(supabase);
    const insertResult = await supabase
        .from('shop_categories')
        .insert({
            name: fallbackName,
            color: '#9aa0a6',
            sort_order: sortOrder,
            is_public: true
        })
        .select('*')
        .limit(1);

    if (insertResult.error || !insertResult.data?.length) {
        throw new Error(insertResult.error?.message || '创建默认分类失败');
    }

    return insertResult.data[0];
}

function appendProductValidationIssue(list, type, code, message, field = '') {
    if (!Array.isArray(list) || !message) {
        return;
    }

    list.push({
        type,
        code: normalizeText(code, 80) || null,
        field: normalizeText(field, 80) || null,
        message: normalizeText(message, 500)
    });
}

function isLocalWebhookUrl(urlObject) {
    const hostname = normalizeText(urlObject?.hostname, 255).toLowerCase();
    return ['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname);
}

function validateWebhookTarget(rawValue) {
    const value = normalizeText(rawValue, 2000);
    if (!value) {
        return {
            valid: false,
            message: 'API 商品必须填写 Webhook URL。'
        };
    }

    let parsed = null;
    try {
        parsed = new URL(value);
    } catch (error) {
        return {
            valid: false,
            message: 'Webhook URL 格式无效，请填写完整的 http(s) 地址。'
        };
    }

    const protocol = normalizeText(parsed.protocol, 20).toLowerCase();
    if (!['https:', 'http:'].includes(protocol)) {
        return {
            valid: false,
            message: 'Webhook URL 仅支持 http 或 https。'
        };
    }

    if (protocol === 'http:' && !isLocalWebhookUrl(parsed)) {
        return {
            valid: true,
            warning: '当前 Webhook 使用的是非加密 HTTP 地址，正式环境建议改为 HTTPS。'
        };
    }

    return {
        valid: true
    };
}

function formatValidationMessages(issues = []) {
    return (Array.isArray(issues) ? issues : [])
        .map((issue) => normalizeText(issue?.message, 500))
        .filter(Boolean)
        .join('；');
}

const PRODUCT_SCHEMA_COMPATIBILITY_FIELDS = [
    'updated_at',
    'purchase_notes_zh',
    'purchase_notes_en',
    'usage_instructions_zh',
    'usage_instructions_en',
    'purchase_notes',
    'show_purchase_notes',
    'usage_instructions',
    'show_usage_instructions',
    'show_product_description',
    'max_purchase_quantity',
    'purchase_limit_24h_quantity',
    'purchase_limit_window_quantity',
    'purchase_limit_window_minutes',
    'per_account_purchase_limit',
    'delivery_type',
    'webhook_target',
    'manual_delivery',
    'quantity_rules',
    'quantity_rules_intl',
    'flash_sale_price',
    'flash_sale_price_intl',
    'flash_sale_end',
    'flash_sale_end_intl',
    'name_en',
    'description_en',
    'image_assets'
];

function getProductSchemaErrorText(error) {
    return [
        error?.message,
        error?.details,
        error?.hint,
        error?.code
    ].filter(Boolean).join(' ').toLowerCase();
}

function getMissingProductSchemaFields(error) {
    const message = getProductSchemaErrorText(error);
    if (!message) {
        return [];
    }

    return PRODUCT_SCHEMA_COMPATIBILITY_FIELDS.filter((field) => {
        const pattern = new RegExp(`(^|[^a-z0-9_])${field}([^a-z0-9_]|$)`);
        return pattern.test(message);
    });
}

function isMissingProductSchemaColumnError(error) {
    const message = getProductSchemaErrorText(error);
    if (!message) {
        return false;
    }

    if (getMissingProductSchemaFields(error).length) {
        return true;
    }

    return (
        message.includes('shop_products')
        && (
            message.includes('schema cache')
            || message.includes('could not find')
            || message.includes('does not exist')
            || message.includes('column')
        )
    );
}

function buildSchemaCompatibleProductPayload(payload = {}, { site = 'cn', missingFields = [] } = {}) {
    const nextPayload = { ...(payload && typeof payload === 'object' ? payload : {}) };
    const removedFields = [];
    const missingSet = new Set(Array.isArray(missingFields) && missingFields.length
        ? missingFields
        : PRODUCT_SCHEMA_COMPATIBILITY_FIELDS);

    const hasMissing = (...fields) => fields.some((field) => missingSet.has(field));
    const removeFields = (fields = []) => {
        fields.forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(nextPayload, field)) {
                delete nextPayload[field];
                removedFields.push(field);
            }
        });
    };

    if (hasMissing('purchase_notes_zh', 'purchase_notes_en')) {
        if (site !== 'intl' && Object.prototype.hasOwnProperty.call(nextPayload, 'purchase_notes_zh')) {
            nextPayload.purchase_notes = nextPayload.purchase_notes_zh;
        }
        removeFields(['purchase_notes_zh', 'purchase_notes_en']);
    }

    if (hasMissing('usage_instructions_zh', 'usage_instructions_en')) {
        if (site !== 'intl' && Object.prototype.hasOwnProperty.call(nextPayload, 'usage_instructions_zh')) {
            nextPayload.usage_instructions = nextPayload.usage_instructions_zh;
        }
        removeFields(['usage_instructions_zh', 'usage_instructions_en']);
    }

    if (hasMissing('purchase_notes', 'show_purchase_notes')) {
        removeFields(['show_purchase_notes', 'purchase_notes', 'purchase_notes_zh', 'purchase_notes_en']);
    }

    if (hasMissing('usage_instructions', 'show_usage_instructions')) {
        removeFields(['show_usage_instructions', 'usage_instructions', 'usage_instructions_zh', 'usage_instructions_en']);
    }

    if (hasMissing('show_product_description')) {
        removeFields(['show_product_description']);
    }

    if (hasMissing(
        'purchase_limit_24h_quantity',
        'purchase_limit_window_quantity',
        'purchase_limit_window_minutes',
        'per_account_purchase_limit'
    )) {
        removeFields([
            'purchase_limit_24h_quantity',
            'purchase_limit_window_quantity',
            'purchase_limit_window_minutes',
            'per_account_purchase_limit'
        ]);
    }

    if (hasMissing('max_purchase_quantity')) {
        removeFields(['max_purchase_quantity']);
    }

    if (hasMissing('delivery_type', 'webhook_target')) {
        removeFields(['delivery_type', 'webhook_target']);
    }

    if (hasMissing('manual_delivery')) {
        removeFields(['manual_delivery']);
    }

    if (hasMissing(
        'quantity_rules',
        'quantity_rules_intl',
        'flash_sale_price',
        'flash_sale_price_intl',
        'flash_sale_end',
        'flash_sale_end_intl'
    )) {
        removeFields([
            'quantity_rules',
            'quantity_rules_intl',
            'flash_sale_price',
            'flash_sale_price_intl',
            'flash_sale_end',
            'flash_sale_end_intl'
        ]);
    }

    if (hasMissing('name_en')) {
        removeFields(['name_en']);
    }

    if (hasMissing('description_en')) {
        removeFields(['description_en']);
    }

    if (hasMissing('image_assets')) {
        removeFields(['image_assets']);
    }

    if (hasMissing('updated_at')) {
        removeFields(['updated_at']);
    }

    return {
        payload: nextPayload,
        removedFields: Array.from(new Set(removedFields))
    };
}

async function writeProductRow(supabase, { productId = null, payload = {} } = {}) {
    if (productId) {
        return supabase
            .from('shop_products')
            .upsert({ ...payload, id: productId }, { onConflict: 'id' })
            .select('*')
            .limit(1);
    }

    return supabase
        .from('shop_products')
        .insert(payload)
        .select('*')
        .limit(1);
}

async function writeProductRowWithSchemaFallback(supabase, {
    productId = null,
    payload = {},
    site = 'cn'
} = {}) {
    let nextPayload = { ...(payload && typeof payload === 'object' ? payload : {}) };
    let removedFields = [];
    let usedCompatibilityFallback = false;
    let lastResult = null;

    for (let attempt = 0; attempt < 8; attempt += 1) {
        const result = await writeProductRow(supabase, { productId, payload: nextPayload });
        lastResult = result;

        if (!result.error || result.data?.length) {
            return {
                result,
                payload: nextPayload,
                compatibilityFallback: usedCompatibilityFallback,
                compatibilityRemovedFields: Array.from(new Set(removedFields))
            };
        }

        if (!isMissingProductSchemaColumnError(result.error)) {
            return {
                result,
                payload: nextPayload,
                compatibilityFallback: usedCompatibilityFallback,
                compatibilityRemovedFields: Array.from(new Set(removedFields))
            };
        }

        const missingFields = getMissingProductSchemaFields(result.error);
        const fallback = buildSchemaCompatibleProductPayload(nextPayload, { site, missingFields });
        if (!fallback.removedFields.length) {
            return {
                result,
                payload: nextPayload,
                compatibilityFallback: usedCompatibilityFallback,
                compatibilityRemovedFields: Array.from(new Set(removedFields))
            };
        }

        usedCompatibilityFallback = true;
        removedFields = removedFields.concat(fallback.removedFields);
        nextPayload = fallback.payload;
    }

    return {
        result: lastResult || { data: null, error: new Error('保存商品失败') },
        payload: nextPayload,
        compatibilityFallback: usedCompatibilityFallback,
        compatibilityRemovedFields: Array.from(new Set(removedFields))
    };
}

function prepareProductPayloadForWritableSite(payload = {}, { productId = '', site = 'cn' } = {}) {
    const nextPayload = { ...(payload && typeof payload === 'object' ? payload : {}) };
    const writableSite = site === 'intl' ? 'intl' : 'cn';
    const normalizedProductId = normalizeText(productId, 160);

    if (!nextPayload.updated_at) {
        nextPayload.updated_at = new Date().toISOString();
    }

    if (writableSite === 'intl' && !normalizedProductId) {
        const baseName = normalizeText(nextPayload.name, 160);
        const englishName = normalizeText(nextPayload.name_en, 160);
        if (!baseName && englishName) {
            nextPayload.name = englishName;
        }
    }

    return nextPayload;
}

function isMissingRpcFunctionError(error, functionName = '') {
    const message = normalizeText(error?.message, 400).toLowerCase();
    const hint = normalizeText(error?.hint, 400).toLowerCase();
    const normalizedFunctionName = normalizeText(functionName, 120).toLowerCase();
    if (!normalizedFunctionName) {
        return false;
    }

    return message.includes('could not find the function')
        || message.includes('function')
        && message.includes(normalizedFunctionName)
        || hint.includes(normalizedFunctionName);
}

async function validateProductPayload(supabase, { productId = '', payload = {}, pendingCategory = null, site = 'cn' } = {}) {
    const safePayload = prepareProductPayloadForWritableSite(payload, { productId, site });
    const safePendingCategory = pendingCategory && typeof pendingCategory === 'object' ? pendingCategory : null;
    const blockingIssues = [];
    const warnings = [];

    const name = normalizeText(safePayload.name, 160);
    const category = normalizeText(safePayload.category || safePendingCategory?.name, 120);
    const deliveryType = normalizeText(safePayload.delivery_type, 20).toUpperCase() === 'API' ? 'API' : 'KEY';
    const manualDelivery = normalizeBoolean(safePayload.manual_delivery, false);
    const webhookTarget = normalizeText(safePayload.webhook_target, 2000);
    const isActive = normalizeBoolean(safePayload.is_active, true);
    const maxPurchaseQuantity = normalizePositiveInteger(safePayload.max_purchase_quantity);
    const purchaseLimit24hQuantity = normalizePositiveInteger(safePayload.purchase_limit_24h_quantity);
    const purchaseLimitWindowQuantity = normalizePositiveInteger(safePayload.purchase_limit_window_quantity);
    const purchaseLimitWindowMinutes = normalizePositiveInteger(safePayload.purchase_limit_window_minutes);
    const perAccountPurchaseLimit = normalizePositiveInteger(safePayload.per_account_purchase_limit);
    const showPurchaseNotes = normalizeBoolean(safePayload.show_purchase_notes, false);
    const purchaseNotes = normalizeText(safePayload.purchase_notes, 4000);
    const purchaseNotesZh = normalizeText(safePayload.purchase_notes_zh, 4000);
    const purchaseNotesEn = normalizeText(safePayload.purchase_notes_en, 4000);
    const showUsageInstructions = normalizeBoolean(safePayload.show_usage_instructions, false);
    const usageInstructions = normalizeText(safePayload.usage_instructions, 4000);
    const usageInstructionsZh = normalizeText(safePayload.usage_instructions_zh, 4000);
    const usageInstructionsEn = normalizeText(safePayload.usage_instructions_en, 4000);

    if (!name) {
        appendProductValidationIssue(blockingIssues, 'blocking', 'name_required', '商品名称不能为空。', 'name');
    }

    if (!category) {
        appendProductValidationIssue(blockingIssues, 'blocking', 'category_required', '请选择商品分类。', 'category');
    }

    if (
        Number.isFinite(maxPurchaseQuantity)
        && Number.isFinite(perAccountPurchaseLimit)
        && maxPurchaseQuantity > perAccountPurchaseLimit
    ) {
        appendProductValidationIssue(
            blockingIssues,
            'blocking',
            'purchase_limit_conflict',
            '单次限购不能大于每账号限购数量，请先调整限购配置。',
            'max_purchase_quantity'
        );
    }

    if (purchaseLimitWindowQuantity && !purchaseLimitWindowMinutes) {
        appendProductValidationIssue(
            blockingIssues,
            'blocking',
            'window_minutes_required',
            '填写 N 分钟累计上限时，必须同时填写 N 分钟。',
            'purchase_limit_window_minutes'
        );
    }

    if (deliveryType === 'API') {
        const webhookValidation = validateWebhookTarget(webhookTarget);
        if (!webhookValidation.valid) {
            appendProductValidationIssue(
                blockingIssues,
                'blocking',
                'webhook_target_invalid',
                webhookValidation.message,
                'webhook_target'
            );
        } else if (webhookValidation.warning) {
            appendProductValidationIssue(
                warnings,
                'warning',
                'webhook_target_http',
                webhookValidation.warning,
                'webhook_target'
            );
        }
    }

    let availableStockCount = null;
    if (productId) {
        availableStockCount = await countAvailableInventory(supabase, productId);
    }

    if (deliveryType === 'KEY' && !manualDelivery && productId && isActive && Number(availableStockCount || 0) <= 0) {
        appendProductValidationIssue(
            warnings,
            'warning',
            'key_stock_empty',
            '当前 KEY 商品可用库存为 0，上架后会直接暴露缺货风险。',
            'delivery_type'
        );
    }

    if (deliveryType === 'API' && productId && Number(availableStockCount || 0) > 0) {
        appendProductValidationIssue(
            warnings,
            'warning',
            'api_with_stock',
            `当前商品仍有 ${availableStockCount} 条可用库存，切换到 API 模式后这些 KEY 库存不会参与发货。`,
            'delivery_type'
        );
    }

    if (deliveryType === 'KEY' && purchaseLimit24hQuantity && purchaseLimit24hQuantity < 2) {
        appendProductValidationIssue(
            warnings,
            'warning',
            'tight_daily_limit',
            '24 小时累计上限当前非常严格，建议确认是否真的要把单日购买限制为 1。',
            'purchase_limit_24h_quantity'
        );
    }

    if (
        isActive
        && !showPurchaseNotes
        && !purchaseNotes
        && !purchaseNotesZh
        && !purchaseNotesEn
        && !showUsageInstructions
        && !usageInstructions
        && !usageInstructionsZh
        && !usageInstructionsEn
    ) {
        appendProductValidationIssue(
            warnings,
            'warning',
            'missing_post_purchase_guidance',
            '当前商品没有填写注意事项或使用说明，建议至少补 1 个，减少购买后的人工解释成本。',
            'purchase_notes'
        );
    }

    return {
        blockingIssues,
        warnings,
        inventoryHealth: {
            availableStockCount: Number.isFinite(Number(availableStockCount))
                ? Number(availableStockCount)
                : null
        }
    };
}

async function tryRpcCategoryRename(supabase, categoryId, nextName) {
    if (!supabase || typeof supabase.rpc !== 'function') {
        return null;
    }

    const { data, error } = await supabase.rpc('fn_admin_shop_rename_category', {
        p_category_id: categoryId,
        p_next_name: nextName
    });

    if (error) {
        if (isMissingRpcFunctionError(error, 'fn_admin_shop_rename_category')) {
            return null;
        }
        throw error;
    }

    return data && typeof data === 'object' ? data : {};
}

async function tryRpcCategoryDelete(supabase, categoryId, fallbackName = 'other') {
    if (!supabase || typeof supabase.rpc !== 'function') {
        return null;
    }

    const { data, error } = await supabase.rpc('fn_admin_shop_delete_category', {
        p_category_id: categoryId,
        p_fallback_name: fallbackName
    });

    if (error) {
        if (isMissingRpcFunctionError(error, 'fn_admin_shop_delete_category')) {
            return null;
        }
        throw error;
    }

    return data && typeof data === 'object' ? data : {};
}

async function tryRpcCategoryReorder(supabase, assignments = []) {
    if (!supabase || typeof supabase.rpc !== 'function') {
        return null;
    }

    const { data, error } = await supabase.rpc('fn_admin_shop_reorder_categories', {
        p_assignments: assignments
    });

    if (error) {
        if (isMissingRpcFunctionError(error, 'fn_admin_shop_reorder_categories')) {
            return null;
        }
        throw error;
    }

    return data && typeof data === 'object' ? data : {};
}

async function tryRpcProductReorder(supabase, assignments = []) {
    if (!supabase || typeof supabase.rpc !== 'function') {
        return null;
    }

    const { data, error } = await supabase.rpc('fn_admin_shop_reorder_products', {
        p_assignments: assignments
    });

    if (error) {
        if (isMissingRpcFunctionError(error, 'fn_admin_shop_reorder_products')) {
            return null;
        }
        throw error;
    }

    return data && typeof data === 'object' ? data : {};
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'shop.manage' });
        const body = await parseJsonBody(req);
        const action = String(body.action || '').trim();

        if (!action) {
            return sendJson(res, 400, { success: false, message: 'action is required' });
        }

        const writableSite = requireWritableAdminSite(body.site || req.adminSite, {
            fieldName: 'site'
        });

        if (action === 'upsert_product') {
            const payload = body.payload && typeof body.payload === 'object' ? body.payload : null;
            const productId = body.productId ? String(body.productId) : null;
            const pendingCategory = body.pendingCategory && typeof body.pendingCategory === 'object'
                ? body.pendingCategory
                : null;

            if (!payload) {
                return sendJson(res, 400, { success: false, message: 'payload is required' });
            }

            const validation = await validateProductPayload(supabase, {
                productId,
                payload,
                pendingCategory,
                site: writableSite
            });

            if (validation.blockingIssues.length) {
                return sendJson(res, 400, {
                    success: false,
                    message: formatValidationMessages(validation.blockingIssues) || '商品配置校验失败',
                    validation
                });
            }

            if (pendingCategory?.name) {
                const { count: categoryCount } = await supabase
                    .from('shop_categories')
                    .select('*', { count: 'exact', head: true });

                await supabase.from('shop_categories').upsert({
                    name: pendingCategory.name,
                    color: pendingCategory.color || '#6b9ece',
                    sort_order: (Number(categoryCount || 0) + 1) * 10
                }, { onConflict: 'name' });
            }

            const writeResult = await writeProductRowWithSchemaFallback(supabase, {
                productId,
                payload: prepareProductPayloadForWritableSite(payload, { productId, site: writableSite }),
                site: writableSite
            });
            const result = writeResult.result;

            if (result.error || !result.data?.length) {
                return sendJson(res, 400, {
                    success: false,
                    message: result.error?.message || '保存商品失败',
                    details: result.error?.details || '',
                    hint: result.error?.hint || '',
                    code: result.error?.code || ''
                });
            }

            const savedProduct = result.data[0];
            let savedSkus = [];
            try {
                savedSkus = await syncProductSkus(supabase, savedProduct, body.skus || payload.skus || payload.product_skus);
            } catch (error) {
                return sendJson(res, Number(error?.statusCode) || 400, {
                    success: false,
                    message: error?.message || '保存商品规格失败',
                    details: error?.details || '',
                    hint: error?.hint || '',
                    code: error?.code || 'shop_product_skus_save_failed'
                });
            }

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: productId ? 'shop.product.update' : 'shop.product.create',
                details: {
                    product_id: savedProduct.id,
                    name: savedProduct.name,
                    category: savedProduct.category,
                    is_active: savedProduct.is_active,
                    manual_delivery: savedProduct.manual_delivery === true,
                    sku_count: savedSkus.length
                }
            });

            return sendJson(res, 200, {
                success: true,
                product: {
                    ...savedProduct,
                    skus: savedSkus
                },
                skus: savedSkus,
                validation,
                compatibilityFallback: writeResult.compatibilityFallback,
                compatibilityRemovedFields: writeResult.compatibilityRemovedFields
            });
        }

        if (action === 'validate_product') {
            const payload = body.payload && typeof body.payload === 'object' ? body.payload : null;
            const productId = normalizeText(body.productId, 160);
            const pendingCategory = body.pendingCategory && typeof body.pendingCategory === 'object'
                ? body.pendingCategory
                : null;

            if (!payload) {
                return sendJson(res, 400, { success: false, message: 'payload is required' });
            }

            const validation = await validateProductPayload(supabase, {
                productId,
                payload,
                pendingCategory,
                site: writableSite
            });

            return sendJson(res, 200, {
                success: true,
                validation
            });
        }

        if (action === 'toggle_product' || action === 'soft_delete_product') {
            const productId = String(body.productId || '').trim();
            const nextStatus = action === 'soft_delete_product' ? false : Boolean(body.isActive);

            if (!productId) {
                return sendJson(res, 400, { success: false, message: 'productId is required' });
            }

            const { data, error } = await supabase
                .from('shop_products')
                .update({ is_active: nextStatus })
                .eq('id', productId)
                .select('id, name, is_active')
                .limit(1);

            if (error || !data?.length) {
                return sendJson(res, 400, {
                    success: false,
                    message: error?.message || '更新商品状态失败'
                });
            }

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: action === 'soft_delete_product' ? 'shop.product.delete' : 'shop.product.toggle',
                details: {
                    product_id: data[0].id,
                    name: data[0].name,
                    is_active: data[0].is_active
                }
            });

            return sendJson(res, 200, { success: true, product: data[0] });
        }

        if (action === 'batch_soft_delete_products') {
            const productIds = normalizeStringArray(body.productIds, 160);

            if (!productIds.length) {
                return sendJson(res, 400, { success: false, message: 'productIds is required' });
            }

            const { data: rows, error: rowsError } = await supabase
                .from('shop_products')
                .select('id, name, is_active')
                .in('id', productIds);

            if (rowsError) {
                return sendJson(res, 400, { success: false, message: rowsError.message });
            }

            if (!rows?.length) {
                return sendJson(res, 404, { success: false, message: '商品不存在' });
            }

            const { error: updateError } = await supabase
                .from('shop_products')
                .update({ is_active: false })
                .in('id', productIds);

            if (updateError) {
                return sendJson(res, 400, { success: false, message: updateError.message });
            }

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: 'shop.product.batch_delete',
                details: {
                    product_ids: productIds,
                    names: rows.map((row) => row.name).filter(Boolean),
                    count: rows.length
                }
            });

            return sendJson(res, 200, {
                success: true,
                deleted: rows.length
            });
        }

        if (action === 'create_category') {
            const name = normalizeText(body.name, 120);
            const color = normalizeCategoryColor(body.color, '#6b9ece');

            if (!name) {
                return sendJson(res, 400, { success: false, message: 'name is required' });
            }

            const sortOrder = await getNextCategorySortOrder(supabase);
            const result = await supabase
                .from('shop_categories')
                .insert({
                    name,
                    color,
                    sort_order: sortOrder,
                    is_public: true
                })
                .select('*')
                .limit(1);

            if (result.error || !result.data?.length) {
                return sendJson(res, 400, {
                    success: false,
                    message: result.error?.message || '创建分类失败'
                });
            }

            const category = result.data[0];
            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: 'shop.category.create',
                details: {
                    category_id: category.id,
                    name: category.name,
                    color: category.color,
                    sort_order: category.sort_order
                }
            });

            return sendJson(res, 200, {
                success: true,
                category
            });
        }

        if (action === 'rename_category') {
            const categoryId = normalizeText(body.categoryId, 160);
            const nextName = normalizeText(body.name, 120);

            if (!categoryId || !nextName) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'categoryId and name are required'
                });
            }

            const { data: categoryRow, error: categoryError } = await supabase
                .from('shop_categories')
                .select('id, name, color, sort_order')
                .eq('id', categoryId)
                .single();

            if (categoryError || !categoryRow) {
                return sendJson(res, 404, { success: false, message: '分类不存在' });
            }

            const previousName = categoryRow.name;
            if (previousName !== nextName) {
                const rpcResult = await tryRpcCategoryRename(supabase, categoryId, nextName);

                if (rpcResult?.success === false) {
                    return sendJson(res, 400, {
                        success: false,
                        message: normalizeText(rpcResult.message, 500) || '分类重命名失败'
                    });
                }

                if (!rpcResult) {
                    const { error: renameError } = await supabase
                        .from('shop_categories')
                        .update({ name: nextName })
                        .eq('id', categoryId);

                    if (renameError) {
                        return sendJson(res, 400, { success: false, message: renameError.message });
                    }

                    const { error: moveProductsError } = await supabase
                        .from('shop_products')
                        .update({ category: nextName })
                        .eq('category', previousName);

                    if (moveProductsError) {
                        return sendJson(res, 400, { success: false, message: moveProductsError.message });
                    }
                }
            }

            const updatedCategory = {
                ...categoryRow,
                name: nextName
            };

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: 'shop.category.rename',
                details: {
                    category_id: categoryId,
                    old_name: previousName,
                    new_name: nextName
                }
            });

            return sendJson(res, 200, {
                success: true,
                category: updatedCategory
            });
        }

        if (action === 'set_category_color') {
            const categoryId = normalizeText(body.categoryId, 160);
            const nextColor = normalizeCategoryColor(body.color);

            if (!categoryId || !nextColor) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'categoryId and valid color are required'
                });
            }

            const { data: categoryRow, error: categoryError } = await supabase
                .from('shop_categories')
                .select('id, name, color, sort_order')
                .eq('id', categoryId)
                .single();

            if (categoryError || !categoryRow) {
                return sendJson(res, 404, { success: false, message: '分类不存在' });
            }

            const { error: updateError } = await supabase
                .from('shop_categories')
                .update({ color: nextColor })
                .eq('id', categoryId);

            if (updateError) {
                return sendJson(res, 400, { success: false, message: updateError.message });
            }

            const updatedCategory = {
                ...categoryRow,
                color: nextColor
            };

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: 'shop.category.color',
                details: {
                    category_id: categoryId,
                    name: categoryRow.name,
                    previous_color: categoryRow.color,
                    next_color: nextColor
                }
            });

            return sendJson(res, 200, {
                success: true,
                category: updatedCategory
            });
        }

        if (action === 'set_category_public') {
            const categoryId = normalizeText(body.categoryId, 160);
            const nextPublic = normalizeBoolean(body.isPublic ?? body.is_public, true);

            if (!categoryId) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'categoryId is required'
                });
            }

            const { data: categoryRow, error: categoryError } = await supabase
                .from('shop_categories')
                .select('id, name, color, sort_order, is_public')
                .eq('id', categoryId)
                .single();

            if (categoryError || !categoryRow) {
                return sendJson(res, 404, { success: false, message: '分类不存在' });
            }

            const previousIsPublic = categoryRow.is_public !== false;
            const { error: updateError } = await supabase
                .from('shop_categories')
                .update({ is_public: nextPublic })
                .eq('id', categoryId);

            if (updateError) {
                return sendJson(res, 400, { success: false, message: updateError.message });
            }

            const updatedCategory = {
                ...categoryRow,
                is_public: nextPublic
            };

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: 'shop.category.public_visibility',
                details: {
                    category_id: categoryId,
                    name: categoryRow.name,
                    previous_is_public: previousIsPublic,
                    next_is_public: nextPublic
                }
            });

            return sendJson(res, 200, {
                success: true,
                category: updatedCategory
            });
        }

        if (action === 'delete_category') {
            const categoryId = normalizeText(body.categoryId, 160);

            if (!categoryId) {
                return sendJson(res, 400, { success: false, message: 'categoryId is required' });
            }

            const { data: categoryRow, error: categoryError } = await supabase
                .from('shop_categories')
                .select('id, name, color, sort_order')
                .eq('id', categoryId)
                .single();

            if (categoryError || !categoryRow) {
                return sendJson(res, 404, { success: false, message: '分类不存在' });
            }

            if (String(categoryRow.name || '').trim().toLowerCase() === 'other') {
                return sendJson(res, 400, {
                    success: false,
                    message: '默认分类 other 不允许删除'
                });
            }

            let fallbackCategory = null;
            const rpcResult = await tryRpcCategoryDelete(supabase, categoryId, 'other');

            if (rpcResult?.success === false) {
                return sendJson(res, 400, {
                    success: false,
                    message: normalizeText(rpcResult.message, 500) || '分类删除失败'
                });
            }

            if (rpcResult?.success === true) {
                fallbackCategory = {
                    name: normalizeText(rpcResult.fallback_category, 120) || 'other'
                };
            } else {
                fallbackCategory = await ensureFallbackCategory(supabase, 'other');

                const { error: moveProductsError } = await supabase
                    .from('shop_products')
                    .update({ category: fallbackCategory.name })
                    .eq('category', categoryRow.name);

                if (moveProductsError) {
                    return sendJson(res, 400, { success: false, message: moveProductsError.message });
                }

                const { error: deleteError } = await supabase
                    .from('shop_categories')
                    .delete()
                    .eq('id', categoryId);

                if (deleteError) {
                    return sendJson(res, 400, { success: false, message: deleteError.message });
                }
            }

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: 'shop.category.delete',
                details: {
                    category_id: categoryId,
                    name: categoryRow.name,
                    fallback_category: fallbackCategory.name
                }
            });

            return sendJson(res, 200, {
                success: true,
                deleted: true,
                fallbackCategory: fallbackCategory.name
            });
        }

        if (action === 'reorder_categories') {
            const assignments = (Array.isArray(body.assignments) ? body.assignments : [])
                .map((entry) => ({
                    id: normalizeText(entry?.id || entry?.categoryId, 160),
                    sort_order: normalizeNonNegativeInteger(entry?.sortOrder ?? entry?.sort_order)
                }))
                .filter((entry) => entry.id || entry.sort_order !== null);

            if (!assignments.length) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'assignments is required'
                });
            }

            if (assignments.some((entry) => !entry.id || entry.sort_order === null)) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'Each assignment requires id and non-negative sortOrder'
                });
            }

            const categoryIds = normalizeStringArray(assignments.map((entry) => entry.id), 160);
            const uniqueAssignments = categoryIds.map((categoryId) => (
                assignments.find((entry) => entry.id === categoryId)
            )).filter(Boolean);

            const { data: categoryRows, error: categoryError } = await supabase
                .from('shop_categories')
                .select('id, name, color, sort_order')
                .in('id', categoryIds);

            if (categoryError) {
                return sendJson(res, 400, { success: false, message: categoryError.message });
            }

            if (!categoryRows?.length) {
                return sendJson(res, 404, { success: false, message: '分类不存在' });
            }

            const existingMap = new Map((categoryRows || []).map((row) => [String(row.id), row]));
            const missingIds = categoryIds.filter((categoryId) => !existingMap.has(categoryId));
            if (missingIds.length) {
                return sendJson(res, 404, {
                    success: false,
                    message: `分类不存在: ${missingIds.join(', ')}`
                });
            }

            const rpcResult = await tryRpcCategoryReorder(supabase, uniqueAssignments);

            if (rpcResult?.success === false) {
                return sendJson(res, 400, {
                    success: false,
                    message: normalizeText(rpcResult.message, 500) || '分类排序更新失败'
                });
            }

            if (!rpcResult) {
                for (const assignment of uniqueAssignments) {
                    const { error: updateError } = await supabase
                        .from('shop_categories')
                        .update({
                            sort_order: assignment.sort_order
                        })
                        .eq('id', assignment.id);

                    if (updateError) {
                        return sendJson(res, 400, { success: false, message: updateError.message });
                    }
                }
            }

            const categories = uniqueAssignments.map((assignment) => {
                const existingRow = existingMap.get(assignment.id) || {};
                return {
                    ...existingRow,
                    sort_order: assignment.sort_order
                };
            });

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: 'shop.category.reorder',
                details: {
                    count: categories.length,
                    category_ids: categories.map((row) => row.id),
                    changes: categories.map((row) => ({
                        id: row.id,
                        name: row.name,
                        sort_order: row.sort_order
                    }))
                }
            });

            return sendJson(res, 200, {
                success: true,
                updated: categories.length,
                categories
            });
        }

        if (action === 'move_product_category') {
            const productId = normalizeText(body.productId, 160);
            const targetCategory = normalizeText(body.targetCategory, 120);

            if (!productId || !targetCategory) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'productId and targetCategory are required'
                });
            }

            const { data: productRow, error: productError } = await supabase
                .from('shop_products')
                .select('id, name, category')
                .eq('id', productId)
                .single();

            if (productError || !productRow) {
                return sendJson(res, 404, { success: false, message: '商品不存在' });
            }

            const { error: updateError } = await supabase
                .from('shop_products')
                .update({ category: targetCategory })
                .eq('id', productId);

            if (updateError) {
                return sendJson(res, 400, { success: false, message: updateError.message });
            }

            const updatedProduct = {
                ...productRow,
                category: targetCategory
            };

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: 'shop.product.move_category',
                details: {
                    product_id: productId,
                    name: productRow.name,
                    old_category: productRow.category,
                    new_category: targetCategory
                }
            });

            return sendJson(res, 200, {
                success: true,
                product: updatedProduct
            });
        }

        if (action === 'reorder_products') {
            const assignments = (Array.isArray(body.assignments) ? body.assignments : [])
                .map((entry) => ({
                    id: normalizeText(entry?.id || entry?.productId, 160),
                    category: normalizeText(entry?.category || entry?.targetCategory, 120),
                    sort_order: normalizeNonNegativeInteger(entry?.sortOrder ?? entry?.sort_order)
                }))
                .filter((entry) => entry.id || entry.category || entry.sort_order !== null);

            if (!assignments.length) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'assignments is required'
                });
            }

            if (assignments.some((entry) => !entry.id || !entry.category || entry.sort_order === null)) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'Each assignment requires id, category, and non-negative sortOrder'
                });
            }

            const productIds = normalizeStringArray(assignments.map((entry) => entry.id), 160);
            const uniqueAssignments = productIds.map((productId) => (
                assignments.find((entry) => entry.id === productId)
            )).filter(Boolean);

            const { data: productRows, error: productError } = await supabase
                .from('shop_products')
                .select('id, name, category, sort_order')
                .in('id', productIds);

            if (productError) {
                return sendJson(res, 400, { success: false, message: productError.message });
            }

            if (!productRows?.length) {
                return sendJson(res, 404, { success: false, message: '商品不存在' });
            }

            const existingMap = new Map((productRows || []).map((row) => [String(row.id), row]));
            const missingIds = productIds.filter((productId) => !existingMap.has(productId));
            if (missingIds.length) {
                return sendJson(res, 404, {
                    success: false,
                    message: `商品不存在: ${missingIds.join(', ')}`
                });
            }

            const rpcResult = await tryRpcProductReorder(supabase, uniqueAssignments);

            if (rpcResult?.success === false) {
                return sendJson(res, 400, {
                    success: false,
                    message: normalizeText(rpcResult.message, 500) || '商品排序更新失败'
                });
            }

            if (!rpcResult) {
                for (const assignment of uniqueAssignments) {
                    const { error: updateError } = await supabase
                        .from('shop_products')
                        .update({
                            category: assignment.category,
                            sort_order: assignment.sort_order
                        })
                        .eq('id', assignment.id);

                    if (updateError) {
                        return sendJson(res, 400, { success: false, message: updateError.message });
                    }
                }
            }

            const products = uniqueAssignments.map((assignment) => {
                const existingRow = existingMap.get(assignment.id) || {};
                return {
                    ...existingRow,
                    category: assignment.category,
                    sort_order: assignment.sort_order
                };
            });

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: 'shop.product.reorder',
                details: {
                    count: products.length,
                    product_ids: products.map((row) => row.id),
                    changes: products.map((row) => ({
                        id: row.id,
                        name: row.name,
                        category: row.category,
                        sort_order: row.sort_order
                    }))
                }
            });

            return sendJson(res, 200, {
                success: true,
                updated: products.length,
                products
            });
        }

        if (action === 'import_inventory') {
            const productId = String(body.productId || '').trim();
            const skuId = normalizeText(
                body.skuId
                || body.sku_id
                || body.productSkuId
                || body.product_sku_id
                || body.websiteSkuId
                || body.website_sku_id,
                160
            );
            const lines = Array.isArray(body.lines) ? body.lines : [];
            const importStatus = String(body.importStatus || 'available').trim() || 'available';
            const batchId = body.batchId ? String(body.batchId) : `batch_${Date.now()}`;

            if (!productId || !lines.length) {
                return sendJson(res, 400, { success: false, message: 'productId and lines are required' });
            }

            let sku = null;
            try {
                sku = await resolveProductSkuForInventoryImport(supabase, productId, skuId);
            } catch (error) {
                return sendJson(res, Number(error?.statusCode) || 400, {
                    success: false,
                    code: error?.code || 'shop_product_sku_invalid',
                    message: error?.message || '商品规格无效'
                });
            }

            const inventorySkuId = normalizeText(sku?.id, 160) || null;
            const inserts = lines
                .map((line) => String(line || '').trim())
                .filter(Boolean)
                .map((content) => ({
                    product_id: productId,
                    sku_id: inventorySkuId,
                    content,
                    status: importStatus,
                    batch_id: batchId
                }));

            if (!inserts.length) {
                return sendJson(res, 400, { success: false, message: '没有有效库存数据' });
            }

            const { error } = await supabase.from('shop_inventory').insert(inserts);
            if (error) {
                return sendJson(res, 400, { success: false, message: error.message });
            }

            const stockCount = await countAvailableInventory(supabase, productId);
            const skuStockCount = inventorySkuId ? await countAvailableInventory(supabase, productId, inventorySkuId) : null;
            await supabase.from('shop_products').update({ stock_count: stockCount }).eq('id', productId);

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: 'shop.inventory.import',
                details: {
                    product_id: productId,
                    sku_id: sku?.id || null,
                    inventory_sku_id: inventorySkuId,
                    sku_name: sku?.sku_name || null,
                    batch_id: batchId,
                    count: inserts.length,
                    import_status: importStatus
                }
            });

            return sendJson(res, 200, {
                success: true,
                imported: inserts.length,
                stockCount,
                skuId: sku?.id || null,
                inventorySkuId,
                skuStockCount
            });
        }

        if (action === 'inventory_update_status' || action === 'inventory_delete') {
            const inventoryId = String(body.inventoryId || '').trim();

            if (!inventoryId) {
                return sendJson(res, 400, { success: false, message: 'inventoryId is required' });
            }

            const { data: existingRow, error: existingError } = await supabase
                .from('shop_inventory')
                .select('id, product_id, status, batch_id')
                .eq('id', inventoryId)
                .single();

            if (existingError || !existingRow) {
                return sendJson(res, 404, { success: false, message: '库存项不存在' });
            }

            if (action === 'inventory_delete') {
                const { error } = await supabase.from('shop_inventory').delete().eq('id', inventoryId);
                if (error) {
                    return sendJson(res, 400, { success: false, message: error.message });
                }
            } else {
                const nextStatus = String(body.status || '').trim();
                const nextRemark = typeof body.remark === 'string' ? body.remark.trim() : undefined;
                if (!nextStatus) {
                    return sendJson(res, 400, { success: false, message: 'status is required' });
                }

                const updatePayload = { status: nextStatus };
                if (nextRemark !== undefined) {
                    updatePayload.remark = nextRemark || null;
                }

                const { error } = await supabase
                    .from('shop_inventory')
                    .update(updatePayload)
                    .eq('id', inventoryId);

                if (error) {
                    return sendJson(res, 400, { success: false, message: error.message });
                }
            }

            const stockCount = await countAvailableInventory(supabase, existingRow.product_id);
            await supabase
                .from('shop_products')
                .update({ stock_count: stockCount })
                .eq('id', existingRow.product_id);

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: action === 'inventory_delete' ? 'shop.inventory.delete' : 'shop.inventory.status',
                details: {
                    inventory_id: inventoryId,
                    product_id: existingRow.product_id,
                    previous_status: existingRow.status,
                    next_status: action === 'inventory_delete' ? 'deleted' : body.status,
                    batch_id: existingRow.batch_id || null,
                    remark: typeof body.remark === 'string' ? body.remark.trim() || null : undefined
                }
            });

            return sendJson(res, 200, {
                success: true,
                stockCount
            });
        }

        if (action === 'inventory_batch_delete') {
            const inventoryIds = Array.isArray(body.inventoryIds)
                ? body.inventoryIds.map((id) => String(id || '').trim()).filter(Boolean)
                : [];

            if (!inventoryIds.length) {
                return sendJson(res, 400, { success: false, message: 'inventoryIds is required' });
            }

            const { data: rows, error: rowsError } = await supabase
                .from('shop_inventory')
                .select('id, product_id, status, batch_id')
                .in('id', inventoryIds);

            if (rowsError) {
                return sendJson(res, 400, { success: false, message: rowsError.message });
            }

            if (!rows?.length) {
                return sendJson(res, 404, { success: false, message: '库存项不存在' });
            }

            const { error: deleteError } = await supabase
                .from('shop_inventory')
                .delete()
                .in('id', inventoryIds);

            if (deleteError) {
                return sendJson(res, 400, { success: false, message: deleteError.message });
            }

            const productIds = [...new Set(rows.map((row) => row.product_id).filter(Boolean))];
            for (const productId of productIds) {
                const stockCount = await countAvailableInventory(supabase, productId);
                await supabase.from('shop_products').update({ stock_count: stockCount }).eq('id', productId);
            }

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: 'shop.inventory.batch_delete',
                details: {
                    inventory_ids: inventoryIds,
                    product_ids: productIds,
                    count: inventoryIds.length
                }
            });

            return sendJson(res, 200, {
                success: true,
                deleted: inventoryIds.length
            });
        }

        if (action === 'inventory_release_reserve') {
            const productId = String(body.productId || '').trim();
            const count = normalizePositiveInteger(body.count);
            const beforeDate = normalizeIsoDate(body.beforeDate ?? body.before_date);

            if (!productId) {
                return sendJson(res, 400, { success: false, message: 'productId is required' });
            }

            if ((body.count !== null && body.count !== undefined && body.count !== '') && !count) {
                return sendJson(res, 400, { success: false, message: 'count must be a positive integer' });
            }

            if ((body.beforeDate || body.before_date) && !beforeDate) {
                return sendJson(res, 400, { success: false, message: 'beforeDate is invalid' });
            }

            if (!count && !beforeDate) {
                return sendJson(res, 400, { success: false, message: 'count or beforeDate is required' });
            }

            let releaseQuery = supabase
                .from('shop_inventory')
                .select('id, product_id, status, batch_id, buyer_id, sold_at, created_at, remark')
                .eq('product_id', productId)
                .eq('status', 'reserve')
                .order('created_at', { ascending: true });

            if (beforeDate) {
                releaseQuery = releaseQuery.lt('created_at', beforeDate);
            }

            if (count) {
                releaseQuery = releaseQuery.limit(count);
            }

            const { data: rows, error: releaseQueryError } = await releaseQuery;
            if (releaseQueryError) {
                return sendJson(res, 400, { success: false, message: releaseQueryError.message });
            }

            const releaseRows = Array.isArray(rows) ? rows : [];
            if (!releaseRows.length) {
                return sendJson(res, 200, {
                    success: true,
                    released: 0,
                    stockCount: await countAvailableInventory(supabase, productId),
                    message: '未找到符合条件的储备库存'
                });
            }

            const inventoryIds = releaseRows.map((row) => row.id).filter(Boolean);
            const { error: updateError } = await supabase
                .from('shop_inventory')
                .update({
                    status: 'available',
                    buyer_id: null,
                    sold_at: null,
                    remark: null
                })
                .in('id', inventoryIds);

            if (updateError) {
                return sendJson(res, 400, { success: false, message: updateError.message });
            }

            const stockCount = await countAvailableInventory(supabase, productId);
            await supabase.from('shop_products').update({ stock_count: stockCount }).eq('id', productId);

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: 'shop.inventory.release_reserve',
                details: {
                    product_id: productId,
                    released_count: inventoryIds.length,
                    requested_count: count || null,
                    before_date: beforeDate,
                    inventory_ids: inventoryIds.slice(0, 50)
                }
            });

            return sendJson(res, 200, {
                success: true,
                released: inventoryIds.length,
                stockCount,
                message: `成功释放 ${inventoryIds.length} 条储备库存`
            });
        }

        return sendJson(res, 400, { success: false, message: `Unsupported action: ${action}` });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            code: error.code || undefined,
            message: error.message || 'Shop mutation failed'
        });
    }
};
