const {
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

async function countAvailableInventory(supabase, productId) {
    const { count } = await supabase
        .from('shop_inventory')
        .select('*', { count: 'exact', head: true })
        .eq('product_id', productId)
        .eq('status', 'available');
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
            sort_order: sortOrder
        })
        .select('*')
        .limit(1);

    if (insertResult.error || !insertResult.data?.length) {
        throw new Error(insertResult.error?.message || '创建默认分类失败');
    }

    return insertResult.data[0];
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

            let result;
            if (productId) {
                result = await supabase
                    .from('shop_products')
                    .upsert({ ...payload, id: productId }, { onConflict: 'id' })
                    .select('*')
                    .limit(1);
            } else {
                result = await supabase
                    .from('shop_products')
                    .insert(payload)
                    .select('*')
                    .limit(1);
            }

            if (result.error || !result.data?.length) {
                return sendJson(res, 400, {
                    success: false,
                    message: result.error?.message || '保存商品失败'
                });
            }

            const savedProduct = result.data[0];

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
                    is_active: savedProduct.is_active
                }
            });

            return sendJson(res, 200, {
                success: true,
                product: savedProduct
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
                    sort_order: sortOrder
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

            const fallbackCategory = await ensureFallbackCategory(supabase, 'other');

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
            const lines = Array.isArray(body.lines) ? body.lines : [];
            const importStatus = String(body.importStatus || 'available').trim() || 'available';
            const batchId = body.batchId ? String(body.batchId) : `batch_${Date.now()}`;

            if (!productId || !lines.length) {
                return sendJson(res, 400, { success: false, message: 'productId and lines are required' });
            }

            const inserts = lines
                .map((line) => String(line || '').trim())
                .filter(Boolean)
                .map((content) => ({
                    product_id: productId,
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
            await supabase.from('shop_products').update({ stock_count: stockCount }).eq('id', productId);

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: writableSite,
                actionType: 'shop.inventory.import',
                details: {
                    product_id: productId,
                    batch_id: batchId,
                    count: inserts.length,
                    import_status: importStatus
                }
            });

            return sendJson(res, 200, {
                success: true,
                imported: inserts.length,
                stockCount
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
            message: error.message || 'Shop mutation failed'
        });
    }
};
