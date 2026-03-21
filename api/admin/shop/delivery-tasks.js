const { requireAdmin, sendJson } = require('../../_lib/admin');

const SUMMARY_STATUSES = ['pending', 'processing', 'retry_waiting', 'requeued', 'dead_letter', 'delivered'];

function parsePositiveInt(value, fallback, max = 100) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
}

function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

async function countTasksByStatus(supabase, status) {
    const { count, error } = await supabase
        .from('shop_webhook_tasks')
        .select('*', { count: 'exact', head: true })
        .eq('status', status);

    if (error) {
        throw error;
    }

    return Number(count || 0);
}

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase } = await requireAdmin(req);
        const url = new URL(req.url || '', 'http://localhost');
        const page = parsePositiveInt(url.searchParams.get('page'), 1, 100000);
        const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 8, 50);
        const statusFilter = String(url.searchParams.get('status') || 'all').trim().toLowerCase();
        const query = String(url.searchParams.get('query') || '').trim();

        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        let taskQuery = supabase
            .from('shop_webhook_tasks')
            .select(`
                id,
                order_id,
                target_url,
                payload,
                status,
                attempt_count,
                max_attempts,
                next_attempt_at,
                last_attempt_at,
                last_error,
                last_response_status,
                dedupe_key,
                worker_name,
                delivered_at,
                dead_lettered_at,
                manual_replay_count,
                updated_at,
                created_at
            `, { count: 'exact' })
            .order('created_at', { ascending: false });

        if (statusFilter && statusFilter !== 'all') {
            taskQuery = taskQuery.eq('status', statusFilter);
        }

        if (query) {
            if (isUuidLike(query)) {
                taskQuery = taskQuery.eq('order_id', query);
            } else {
                const escapedQuery = query.replace(/,/g, ' ');
                taskQuery = taskQuery.or(`target_url.ilike.%${escapedQuery}%,dedupe_key.ilike.%${escapedQuery}%`);
            }
        }

        const { data: tasks, count, error } = await taskQuery.range(from, to);
        if (error) {
            throw error;
        }

        const orderIds = [...new Set((tasks || []).map((task) => task.order_id).filter(Boolean))];
        let ordersById = {};

        if (orderIds.length) {
            const { data: orders, error: orderError } = await supabase
                .from('shop_orders')
                .select(`
                    id,
                    user_id,
                    snapshot_product_name,
                    price_paid,
                    total_price,
                    delivery_status,
                    delivery_attempt_count,
                    delivery_last_error,
                    delivery_completed_at,
                    created_at,
                    item_count,
                    refund_status
                `)
                .in('id', orderIds);

            if (orderError) {
                throw orderError;
            }

            ordersById = Object.fromEntries((orders || []).map((order) => [order.id, order]));
        }

        const summaryCounts = await Promise.all(SUMMARY_STATUSES.map(async (status) => {
            const taskCount = await countTasksByStatus(supabase, status);
            return [status, taskCount];
        }));

        const summary = Object.fromEntries(summaryCounts);
        summary.total = SUMMARY_STATUSES.reduce((acc, status) => acc + Number(summary[status] || 0), 0);
        summary.retryable = Number(summary.pending || 0)
            + Number(summary.processing || 0)
            + Number(summary.retry_waiting || 0)
            + Number(summary.requeued || 0);

        return sendJson(res, 200, {
            success: true,
            page,
            pageSize,
            total: Number(count || 0),
            summary,
            tasks: (tasks || []).map((task) => ({
                ...task,
                order: task.order_id ? (ordersById[task.order_id] || null) : null
            }))
        });
    } catch (error) {
        console.error('[shop/delivery-tasks] failed:', error);
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Failed to load delivery tasks'
        });
    }
};
