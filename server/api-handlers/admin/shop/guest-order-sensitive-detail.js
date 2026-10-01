const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');

function text(value, max = 300) {
    const result = String(value ?? '').trim();
    return result ? result.slice(0, max) : '';
}

function queryParams(req) {
    return new URL(req.url || '', 'http://localhost').searchParams;
}

async function one(query) {
    const { data, error } = await query.limit(1);
    if (error) throw error;
    return Array.isArray(data) ? (data[0] || null) : (data || null);
}

async function many(query) {
    const { data, error } = await query;
    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function count(query) {
    const { count: value, error } = await query;
    if (error) throw error;
    return Number.isFinite(value) ? value : 0;
}

async function optional(loader, fallback, section) {
    try {
        return { value: await loader(), failed: false };
    } catch (error) {
        console.warn(`[AdminGuestOrderSensitiveDetail] ${section} read failed:`, error.message);
        return { value: fallback, failed: true };
    }
}

function safeError(res, status, message) {
    return sendJson(res, status, { success: false, message });
}

async function writeRequiredSensitiveAuditLog(supabase, adminId, order) {
    let result;
    try {
        result = await supabase.from('admin_audit_logs').insert({
            admin_id: adminId,
            target_user_id: null,
            action_type: 'shop.guest_order.view_sensitive_detail',
            details: {
                module: 'shop',
                site: order.site || '',
                order_id: order.id,
                order_no: order.order_no,
                inventory_content_requested: true,
                claim_secret_plaintext_returned: false,
                raw_webhook_body_returned: false
            }
        });
    } catch (_) {
        result = null;
    }
    if (!result || result.error) {
        const error = new Error('Sensitive detail audit write failed');
        error.code = 'ADMIN_SENSITIVE_AUDIT_FAILED';
        throw error;
    }
}

const INVENTORY_FIELDS = 'id,product_id,content,status,is_shared,sold_at,created_at';

module.exports = async function guestOrderSensitiveDetailHandler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');

    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return safeError(res, 405, 'Method not allowed');
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'shop.manage' });
        const params = queryParams(req);
        const orderId = text(params.get('orderId') || params.get('id'), 160);
        const orderNo = text(params.get('orderNo') || params.get('order_no'), 160);
        if (!orderId && !orderNo) return safeError(res, 400, 'Missing order id or order number');

        const order = await one(orderId
            ? supabase.from('guest_shop_orders').select('id,order_no,site').eq('id', orderId)
            : supabase.from('guest_shop_orders').select('id,order_no,site').eq('order_no', orderNo));
        if (!order) return safeError(res, 404, '游客订单不存在');

        // Record the access before reading card contents or claim diagnostics. If
        // the audit insert fails, the handler returns no sensitive data.
        await writeRequiredSensitiveAuditLog(supabase, user?.id, order);

        const [claimResult, reservationsResult, orderItemsResult, paymentEventCountResult] = await Promise.all([
            one(supabase.from('guest_shop_orders').select('claim_secret_hash,claim_attempt_count').eq('id', order.id)),
            optional(
                () => many(supabase.from('guest_shop_inventory_reservations').select('inventory_id,status').eq('order_id', order.id).order('created_at', { ascending: true })),
                [],
                'reservations'
            ),
            optional(
                () => many(supabase.from('shop_order_items').select('inventory_id').eq('order_id', order.id).order('created_at', { ascending: true })),
                [],
                'order items'
            ),
            optional(
                () => count(supabase.from('guest_shop_payment_events').select('id', { count: 'exact', head: true }).eq('merchant_order_no', order.order_no)),
                0,
                'payment event count'
            )
        ]);

        const reservations = reservationsResult.value;
        const orderItems = orderItemsResult.value;
        const inventoryIds = Array.from(new Set([
            ...reservations.map((row) => text(row?.inventory_id, 160)),
            ...orderItems.map((row) => text(row?.inventory_id, 160))
        ].filter(Boolean)));
        let inventoryRows = [];
        let inventoryReadFailed = false;
        if (inventoryIds.length) {
            const inventoryResult = await optional(
                () => many(supabase.from('shop_inventory').select(INVENTORY_FIELDS).in('id', inventoryIds)),
                [],
                'inventory'
            );
            inventoryRows = inventoryResult.value;
            inventoryReadFailed = inventoryResult.failed;

            if (inventoryRows.length < inventoryIds.length) {
                const knownIds = new Set(inventoryRows.map((row) => text(row?.id, 160)));
                const missingIds = inventoryIds.filter((id) => !knownIds.has(id));
                const individualResults = await Promise.all(missingIds.map((id) => optional(
                    async () => one(supabase.from('shop_inventory').select(INVENTORY_FIELDS).eq('id', id)),
                    null,
                    'inventory item'
                )));
                inventoryRows = [...inventoryRows, ...individualResults.map((result) => result.value).filter(Boolean)];
                inventoryReadFailed = inventoryReadFailed || individualResults.some((result) => result.failed);
            }
        }

        const inventoryById = new Map(inventoryRows.map((row) => [text(row?.id, 160), row]));
        const resolvedInventoryRows = inventoryIds
            .map((id) => inventoryById.get(id))
            .filter(Boolean);
        const sectionErrors = {};
        if (reservationsResult.failed) sectionErrors.reservation = '预占信息读取失败';
        if (orderItemsResult.failed) sectionErrors.order_items = '订单商品关联读取失败';
        if (inventoryReadFailed || resolvedInventoryRows.length < inventoryIds.length) {
            sectionErrors.inventory = '库存内容读取不完整，请查看服务端日志';
        }
        if (paymentEventCountResult.failed) sectionErrors.payment_events = '支付事件数量读取失败';

        return sendJson(res, 200, {
            success: true,
            order: {
                id: order.id,
                order_no: order.order_no,
                site: order.site,
                claim_secret_hash_present: Boolean(claimResult?.claim_secret_hash),
                claim_secret_plaintext_status: 'not_saved_unrecoverable',
                claim_attempt_count: claimResult?.claim_attempt_count ?? null
            },
            reservation: reservations[0] || null,
            inventories: resolvedInventoryRows,
            payment_event_count: paymentEventCountResult.value,
            webhook_raw_body_status: 'not_saved_hash_only',
            section_errors: sectionErrors
        });
    } catch (error) {
        console.error('[AdminGuestOrderSensitiveDetail] failed:', error.message);
        if (error?.code === 'ADMIN_SENSITIVE_AUDIT_FAILED') {
            return safeError(res, 503, '无法记录敏感详情访问记录，未返回敏感内容，请稍后重试');
        }
        if ([401, 403].includes(Number(error?.statusCode))) {
            return safeError(res, Number(error.statusCode), 'Admin access required');
        }
        return safeError(res, 500, '游客订单敏感详情加载失败');
    }
};
