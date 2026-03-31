const {
    parseJsonBody,
    requireAdmin,
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
                actionType: action === 'soft_delete_product' ? 'shop.product.delete' : 'shop.product.toggle',
                details: {
                    product_id: data[0].id,
                    name: data[0].name,
                    is_active: data[0].is_active
                }
            });

            return sendJson(res, 200, { success: true, product: data[0] });
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

        return sendJson(res, 400, { success: false, message: `Unsupported action: ${action}` });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Shop mutation failed'
        });
    }
};
