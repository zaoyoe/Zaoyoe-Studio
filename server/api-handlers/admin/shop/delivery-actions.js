const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

function normalizeAction(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeText(value) {
    return String(value || '').trim();
}

function releaseTaskLocks(patch = {}) {
    return {
        ...patch,
        locked_at: null,
        lock_expires_at: null,
        lock_token: null,
        worker_name: null
    };
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, user } = await requireAdmin(req);
        const body = await parseJsonBody(req);
        const taskId = String(body.taskId || '').trim();
        const action = normalizeAction(body.action);
        const note = normalizeText(body.note);

        if (!taskId || !action) {
            return sendJson(res, 400, { success: false, message: 'taskId and action are required' });
        }

        const { data: task, error: taskError } = await supabase
            .from('shop_webhook_tasks')
            .select(`
                id,
                order_id,
                status,
                attempt_count,
                max_attempts,
                last_error,
                last_response_status,
                last_response_body,
                manual_replay_count,
                executed_at,
                target_url,
                locked_at,
                lock_expires_at,
                lock_token,
                worker_name,
                updated_at
            `)
            .eq('id', taskId)
            .single();

        if (taskError || !task) {
            return sendJson(res, 404, { success: false, message: '履约任务不存在' });
        }

        const now = new Date().toISOString();
        let taskPatch = {};
        let orderPatch = null;
        let actionType = '';
        let successMessage = '履约任务已更新';

        switch (action) {
            case 'requeue':
                taskPatch = releaseTaskLocks({
                    status: 'requeued',
                    next_attempt_at: now,
                    updated_at: now
                });
                orderPatch = {
                    delivery_status: 'retry_waiting',
                    delivery_updated_at: now
                };
                actionType = 'shop.delivery.requeue';
                successMessage = '履约任务已重排队。';
                break;
            case 'replay':
                taskPatch = releaseTaskLocks({
                    status: 'pending',
                    next_attempt_at: now,
                    dead_lettered_at: null,
                    last_error: note || null,
                    manual_replay_requested_at: now,
                    manual_replay_requested_by: user.id,
                    manual_replay_count: Number(task.manual_replay_count || 0) + 1,
                    updated_at: now
                });
                orderPatch = {
                    delivery_status: 'pending',
                    delivery_last_error: null,
                    delivery_updated_at: now
                };
                actionType = 'shop.delivery.replay';
                successMessage = '已登记人工重放，任务会重新进入履约队列。';
                break;
            case 'mark_dead_letter':
                taskPatch = releaseTaskLocks({
                    status: 'dead_letter',
                    last_error: note ? `人工死信: ${note}` : (task.last_error || '人工死信'),
                    dead_lettered_at: now,
                    updated_at: now
                });
                orderPatch = {
                    delivery_status: 'dead_letter',
                    delivery_last_error: taskPatch.last_error,
                    delivery_updated_at: now
                };
                actionType = 'shop.delivery.dead_letter';
                successMessage = '履约任务已标记为死信。';
                break;
            case 'mark_delivered':
                taskPatch = releaseTaskLocks({
                    status: 'delivered',
                    delivered_at: now,
                    executed_at: task.executed_at || now,
                    updated_at: now
                });
                orderPatch = {
                    delivery_status: 'delivered',
                    delivery_completed_at: now,
                    delivery_last_error: null,
                    delivery_attempt_count: Number(task.attempt_count || 0),
                    delivery_updated_at: now
                };
                actionType = 'shop.delivery.mark_delivered';
                successMessage = '履约任务已标记为已履约。';
                break;
            case 'force_unlock':
                taskPatch = releaseTaskLocks({
                    status: task.status === 'processing' ? 'retry_waiting' : task.status,
                    next_attempt_at: now,
                    updated_at: now
                });
                orderPatch = {
                    delivery_status: task.status === 'processing' ? 'retry_waiting' : task.status,
                    delivery_updated_at: now
                };
                actionType = 'shop.delivery.force_unlock';
                successMessage = '履约任务已强制解锁。';
                break;
            default:
                return sendJson(res, 400, { success: false, message: 'Unsupported action' });
        }

        const { error: updateTaskError } = await supabase
            .from('shop_webhook_tasks')
            .update(taskPatch)
            .eq('id', taskId);

        if (updateTaskError) {
            throw updateTaskError;
        }

        if (task.order_id && orderPatch) {
            const { error: updateOrderError } = await supabase
                .from('shop_orders')
                .update(orderPatch)
                .eq('id', task.order_id);

            if (updateOrderError) {
                throw updateOrderError;
            }
        }

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            actionType,
            details: {
                task_id: taskId,
                order_id: task.order_id,
                previous_status: task.status,
                next_status: taskPatch.status,
                manual_replay_count: taskPatch.manual_replay_count ?? task.manual_replay_count ?? 0,
                note: note || null,
                previous_lock: {
                    locked_at: task.locked_at || null,
                    lock_expires_at: task.lock_expires_at || null,
                    lock_token: task.lock_token || null,
                    worker_name: task.worker_name || null
                },
                task_snapshot: {
                    target_url: task.target_url || null,
                    last_error: task.last_error || null,
                    last_response_status: task.last_response_status || null,
                    last_response_body: task.last_response_body || null,
                    updated_at: task.updated_at || null
                }
            }
        });

        return sendJson(res, 200, {
            success: true,
            message: successMessage,
            taskId,
            action,
            status: taskPatch.status
        });
    } catch (error) {
        console.error('[shop/delivery-actions] failed:', error);
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Failed to update delivery task'
        });
    }
};
