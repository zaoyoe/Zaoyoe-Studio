const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    normalizeText,
    loadOrderItemsByOrderIds,
    loadInventoryRecordsByIds,
    collectLinkedInventoryIds,
    buildLinkedInventoryItems,
    buildResolvedItems,
    resolveOrderLinkageSource
} = require('./_order-linkage');

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function isMissingRelationError(error, relationName = '') {
    const normalizedMessage = [
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(' ').toLowerCase();
    const normalizedRelation = normalizeText(relationName, 160).toLowerCase();

    if (!normalizedMessage || !normalizedRelation || !normalizedMessage.includes(normalizedRelation)) {
        return false;
    }

    return normalizedMessage.includes('does not exist')
        || normalizedMessage.includes('undefined table')
        || normalizedMessage.includes('could not find')
        || normalizeText(error?.code, 40).toUpperCase() === '42P01'
        || normalizeText(error?.code, 40).toUpperCase() === 'PGRST205';
}

async function selectSingleRow(queryBuilder) {
    if (typeof queryBuilder.maybeSingle === 'function') {
        const { data, error } = await queryBuilder.maybeSingle();
        if (error) {
            throw error;
        }
        return data || null;
    }

    const { data, error } = await queryBuilder.limit(1);
    if (error) {
        throw error;
    }
    return Array.isArray(data) ? (data[0] || null) : (data || null);
}

function normalizeCaseRecord(row = {}, categoryKey = '') {
    return {
        id: normalizeText(row?.id, 160) || null,
        category_key: normalizeText(row?.category_key || categoryKey, 80).toLowerCase() || null,
        target_id: normalizeText(row?.target_id, 200) || null,
        alert_type: normalizeText(row?.alert_type, 120).toLowerCase() || null,
        status: normalizeText(row?.status, 40).toLowerCase() || 'open',
        owner_label: normalizeText(row?.owner_label, 255) || null,
        note: normalizeText(row?.note, 2000) || null,
        resolution: normalizeText(row?.resolution, 2000) || null,
        updated_at: normalizeText(row?.updated_at, 80) || null,
        metadata: row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? row.metadata
            : {}
    };
}

async function loadOrderRecord(supabase, orderId) {
    return selectSingleRow(
        supabase
            .from('shop_orders')
            .select('*')
            .eq('id', orderId)
    );
}

async function loadOrderProfile(supabase, userId) {
    if (!userId) {
        return null;
    }

    return selectSingleRow(
        supabase
            .from('profiles')
            .select('id, username, avatar_url, email')
            .eq('id', userId)
    );
}

async function loadDeliveryTask(supabase, order) {
    const deliveryTaskId = normalizeText(order?.delivery_task_id, 160);
    if (deliveryTaskId) {
        return selectSingleRow(
            supabase
                .from('shop_webhook_tasks')
                .select(`
                    id,
                    order_id,
                    status,
                    attempt_count,
                    max_attempts,
                    next_attempt_at,
                    last_attempt_at,
                    last_error,
                    last_response_status,
                    dead_lettered_at,
                    delivered_at,
                    manual_replay_requested_at,
                    manual_replay_requested_by,
                    manual_replay_count,
                    lock_token,
                    lock_expires_at,
                    worker_name,
                    target_url,
                    target_key,
                    channel_key,
                    conflict_count,
                    last_conflict_at,
                    last_conflict_reason,
                    last_conflict_scope,
                    last_conflict_note,
                    created_at,
                    updated_at
                `)
                .eq('id', deliveryTaskId)
        );
    }

    const orderId = normalizeText(order?.id, 160);
    if (!orderId) {
        return null;
    }

    return selectSingleRow(
        supabase
            .from('shop_webhook_tasks')
            .select(`
                id,
                order_id,
                status,
                attempt_count,
                max_attempts,
                next_attempt_at,
                last_attempt_at,
                last_error,
                last_response_status,
                dead_lettered_at,
                delivered_at,
                manual_replay_requested_at,
                manual_replay_requested_by,
                manual_replay_count,
                lock_token,
                lock_expires_at,
                worker_name,
                target_url,
                target_key,
                channel_key,
                conflict_count,
                last_conflict_at,
                last_conflict_reason,
                last_conflict_scope,
                last_conflict_note,
                created_at,
                updated_at
            `)
            .eq('order_id', orderId)
            .order('created_at', { ascending: false })
    );
}

async function loadDeliveryAttempts(supabase, taskId) {
    if (!taskId) {
        return [];
    }

    const { data, error } = await supabase
        .from('shop_webhook_task_attempts')
        .select('id, task_id, attempt_no, worker_name, started_at, finished_at, success, response_status, error_message, duration_ms')
        .eq('task_id', taskId)
        .order('started_at', { ascending: false })
        .limit(10);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function loadTicketContext(supabase, orderId) {
    if (!orderId) {
        return {
            total: 0,
            pending: 0,
            resolved: 0,
            rejected: 0,
            records: []
        };
    }

    try {
        const { data, error } = await supabase
            .from('shop_tickets')
            .select('id, order_id, user_id, issue_type, status, description, created_at, updated_at')
            .eq('order_id', orderId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const records = Array.isArray(data) ? data : [];
        return {
            total: records.length,
            pending: records.filter((ticket) => normalizeText(ticket?.status, 40).toUpperCase() === 'PENDING').length,
            resolved: records.filter((ticket) => normalizeText(ticket?.status, 40).toUpperCase() === 'RESOLVED').length,
            rejected: records.filter((ticket) => normalizeText(ticket?.status, 40).toUpperCase() === 'REJECTED').length,
            records: records.slice(0, 5)
        };
    } catch (error) {
        if (isMissingRelationError(error, 'shop_tickets')) {
            return {
                total: 0,
                pending: 0,
                resolved: 0,
                rejected: 0,
                records: []
            };
        }
        throw error;
    }
}

async function loadOpsCaseByTarget(supabase, categoryKey, targetId) {
    if (!categoryKey || !targetId) {
        return null;
    }

    try {
        const record = await selectSingleRow(
            supabase
                .from('ops_alert_cases')
                .select('id, category_key, target_id, alert_type, status, owner_label, note, resolution, updated_at, metadata')
                .eq('category_key', categoryKey)
                .eq('target_id', targetId)
        );

        return record ? normalizeCaseRecord(record, categoryKey) : null;
    } catch (error) {
        if (isMissingRelationError(error, 'ops_alert_cases')) {
            return null;
        }
        throw error;
    }
}

async function loadRiskContext(supabase, order = {}) {
    const candidates = [];
    const userId = normalizeText(order?.user_id, 160);
    const discountCode = normalizeText(order?.discount_code, 160).toUpperCase();
    const totalPrice = Number(order?.total_price || order?.price_paid || 0) || 0;

    if (userId) {
        candidates.push(`shop_order_risk:user_velocity:${userId}`);
    }
    if (discountCode) {
        candidates.push(`shop_order_risk:coupon:${discountCode}`);
    }
    if (totalPrice <= 0) {
        candidates.push('shop_order_risk:zero_total:global');
    }

    if (!candidates.length) {
        return {
            total: 0,
            open: 0,
            resolved: 0,
            records: [],
            candidate_targets: []
        };
    }

    const candidateTargets = [...new Set(candidates)];

    try {
        const { data, error } = await supabase
            .from('ops_alert_cases')
            .select('id, category_key, target_id, alert_type, status, owner_label, note, resolution, updated_at, metadata')
            .eq('category_key', 'shop_risk')
            .in('target_id', candidateTargets)
            .order('updated_at', { ascending: false });

        if (error) throw error;

        const records = (Array.isArray(data) ? data : []).map((row) => normalizeCaseRecord(row, 'shop_risk'));
        return {
            total: records.length,
            open: records.filter((record) => record.status === 'open' || record.status === 'claimed').length,
            resolved: records.filter((record) => record.status === 'resolved').length,
            records,
            candidate_targets: candidateTargets
        };
    } catch (error) {
        if (!isMissingRelationError(error, 'ops_alert_cases')) {
            throw error;
        }

        try {
            const { data, error: legacyError } = await supabase
                .from('shop_risk_cases')
                .select('id, target_id, alert_type, status, owner_label, note, resolution, updated_at, metadata')
                .in('target_id', candidateTargets)
                .order('updated_at', { ascending: false });

            if (legacyError) throw legacyError;

            const records = (Array.isArray(data) ? data : []).map((row) => normalizeCaseRecord(row, 'shop_risk'));
            return {
                total: records.length,
                open: records.filter((record) => record.status === 'open' || record.status === 'claimed').length,
                resolved: records.filter((record) => record.status === 'resolved').length,
                records,
                candidate_targets: candidateTargets
            };
        } catch (legacyError) {
            if (isMissingRelationError(legacyError, 'shop_risk_cases')) {
                return {
                    total: 0,
                    open: 0,
                    resolved: 0,
                    records: [],
                    candidate_targets: candidateTargets
                };
            }
            throw legacyError;
        }
    }
}

module.exports = async function adminShopOrderDetailHandler(req, res) {
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
        const orderId = normalizeText(searchParams.get('id') || searchParams.get('orderId'), 160);

        if (!orderId) {
            return sendJson(res, 400, {
                success: false,
                message: 'Missing order id'
            });
        }

        const order = await loadOrderRecord(supabase, orderId);
        if (!order) {
            return sendJson(res, 404, {
                success: false,
                message: 'Order not found'
            });
        }

        const orderItemsByOrderId = await loadOrderItemsByOrderIds(supabase, [orderId]);
        const orderItems = orderItemsByOrderId.get(orderId) || [];
        const linkedInventoryIds = collectLinkedInventoryIds(order, orderItems);
        const [profile, inventoryRecordsById, deliveryTask, ticketContext, fulfillmentCase, riskContext] = await Promise.all([
            loadOrderProfile(supabase, normalizeText(order?.user_id, 160)),
            loadInventoryRecordsByIds(supabase, linkedInventoryIds),
            loadDeliveryTask(supabase, order),
            loadTicketContext(supabase, orderId),
            loadOpsCaseByTarget(supabase, 'fulfillment', orderId),
            loadRiskContext(supabase, order)
        ]);
        const deliveryAttempts = await loadDeliveryAttempts(supabase, normalizeText(deliveryTask?.id, 160));
        const linkedInventoryItems = buildLinkedInventoryItems(order, orderItems, inventoryRecordsById);
        const resolvedItems = buildResolvedItems(order, orderItems, inventoryRecordsById);

        return sendJson(res, 200, {
            success: true,
            order: {
                ...order,
                profiles: profile || null,
                linkage_source: resolveOrderLinkageSource(order, orderItems),
                linked_inventory_ids: linkedInventoryIds,
                linked_inventory_items: linkedInventoryItems,
                order_item_count: orderItems.length,
                resolved_items: resolvedItems
            },
            payment: {
                site: normalizeText(order?.site, 40) || 'cn',
                item_count: Math.max(1, Number(order?.item_count || orderItems.length || 1) || 1),
                price_paid: Number(order?.price_paid || 0) || 0,
                total_price: Number(order?.total_price || 0) || 0,
                discount_code: normalizeText(order?.discount_code, 160) || null,
                created_at: order?.created_at || null,
                refund_status: normalizeText(order?.refund_status, 40).toLowerCase() || 'none'
            },
            fulfillment: {
                task: deliveryTask || null,
                attempts: deliveryAttempts,
                case: fulfillmentCase,
                delivery_status: normalizeText(order?.delivery_status, 40).toLowerCase() || 'pending',
                delivery_last_error: normalizeText(order?.delivery_last_error, 2000) || null,
                delivery_completed_at: order?.delivery_completed_at || null,
                delivery_updated_at: order?.delivery_updated_at || null
            },
            tickets: ticketContext,
            risk: riskContext
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load order detail'
        });
    }
};
