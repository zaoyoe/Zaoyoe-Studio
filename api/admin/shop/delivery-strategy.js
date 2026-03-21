const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../_lib/admin');
const {
    loadShopDeliveryStrategyConfig,
    normalizeShopDeliveryStrategyConfig,
    upsertShopDeliveryStrategyConfig
} = require('../../_lib/payments/shop-delivery-strategy');

const OPEN_TASK_STATUSES = ['pending', 'processing', 'retry_waiting', 'requeued'];

module.exports = async (req, res) => {
    try {
        const { supabase, user } = await requireAdmin(req);

        if (req.method === 'GET') {
            const config = await loadShopDeliveryStrategyConfig(supabase);
            return sendJson(res, 200, {
                success: true,
                config
            });
        }

        if (req.method === 'POST') {
            const body = await parseJsonBody(req);
            const nextConfig = normalizeShopDeliveryStrategyConfig(body.config || {});
            const applyToOpenTasks = body.applyToOpenTasks !== false;

            const savedConfig = await upsertShopDeliveryStrategyConfig(supabase, nextConfig, user.id);

            let syncedTaskCount = 0;
            if (applyToOpenTasks) {
                const { data, error } = await supabase
                    .from('shop_webhook_tasks')
                    .update({
                        max_attempts: savedConfig.max_attempts,
                        updated_at: new Date().toISOString()
                    })
                    .in('status', OPEN_TASK_STATUSES)
                    .select('id');

                if (error) {
                    throw new Error(error.message || 'Failed to sync delivery tasks with strategy');
                }

                syncedTaskCount = Array.isArray(data) ? data.length : 0;
            }

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                actionType: 'shop.delivery.strategy.update',
                details: {
                    config: savedConfig,
                    apply_to_open_tasks: applyToOpenTasks,
                    synced_task_count: syncedTaskCount
                }
            });

            return sendJson(res, 200, {
                success: true,
                message: applyToOpenTasks
                    ? `履约策略已保存，并同步到 ${syncedTaskCount} 条未完成任务。`
                    : '履约策略已保存。',
                config: savedConfig,
                synced_task_count: syncedTaskCount
            });
        }

        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Delivery strategy request failed'
        });
    }
};
