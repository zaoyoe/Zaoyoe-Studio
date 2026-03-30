const {
    getOptionalSupabaseAdmin,
    parseJsonBody,
    requireAuthenticatedUser,
    sendJson
} = require('./_lib/admin');
const {
    enqueueOpsAlertJob
} = require('./_lib/ops-alerts');
const {
    applyRateLimitHeaders,
    resolveClientIp,
    takeRateLimitToken
} = require('./_lib/request-security');
const {
    buildTicketCreatedAlert
} = require('./_lib/ticket-alerts');

function normalizeText(value, maxLength = 256) {
    return String(value || '').trim().slice(0, maxLength);
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function createError(message, statusCode = 400, code = 'bad_request') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

async function handleCodeStatus({ adminSupabase, input }) {
    const codeOrOrder = normalizeText(input, 120).toUpperCase();
    if (!codeOrOrder) {
        throw createError('请输入兑换码或外部订单号');
    }

    const { data, error } = await adminSupabase.rpc('fn_check_code_status', {
        p_code: codeOrOrder
    });

    if (error) {
        throw createError(error.message || '兑换码状态查询失败', 500, 'code_status_failed');
    }

    return {
        success: true,
        payload: data || null
    };
}

async function handleAfdianLookup({ adminSupabase, user, input }) {
    const orderNo = normalizeText(input, 120);
    if (!orderNo) {
        throw createError('请输入爱发电订单号');
    }

    const { data, error } = await adminSupabase.rpc('fn_claim_and_query_afdian_code', {
        p_order_no: orderNo,
        p_user_id: user.id
    });

    if (error) {
        throw createError(error.message || '爱发电订单查询失败', error.message === 'Access denied' ? 403 : 500, 'afdian_lookup_failed');
    }

    const payload = Array.isArray(data) ? data[0] : data;
    if (!payload) {
        throw createError('未找到该订单号', 404, 'afdian_order_not_found');
    }

    return {
        success: true,
        payload
    };
}

async function handleShopOrderStatus({ requestSupabase, input }) {
    const orderId = normalizeText(input, 120);
    if (!isUuid(orderId)) {
        throw createError('订单号格式不正确');
    }

    const { data, error } = await requestSupabase
        .from('shop_orders')
        .select('id, snapshot_product_name, delivery_status, delivery_task_id, delivery_last_error, created_at, delivery_updated_at, delivery_completed_at, price_paid, total_price, item_count')
        .eq('id', orderId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            throw createError('订单不存在或无权访问', 404, 'shop_order_not_found');
        }
        throw createError(error.message || '订单状态查询失败', 500, 'shop_order_status_failed');
    }

    return {
        success: true,
        payload: data
    };
}

async function handleShopOrderContent({ requestSupabase, input }) {
    const orderId = normalizeText(input, 120);
    if (!isUuid(orderId)) {
        throw createError('订单号格式不正确');
    }

    const [orderResult, itemsResult] = await Promise.all([
        requestSupabase
            .from('shop_orders')
            .select('id, snapshot_product_name, created_at')
            .eq('id', orderId)
            .single(),
        requestSupabase
            .from('shop_order_items')
            .select('id, snapshot_product_name, price_paid, shop_inventory ( content )')
            .eq('order_id', orderId)
    ]);

    const { data: order, error: orderError } = orderResult;
    const { data: items, error: itemsError } = itemsResult;

    if (orderError) {
        if (orderError.code === 'PGRST116') {
            throw createError('订单不存在或无权访问', 404, 'shop_order_not_found');
        }
        throw createError(orderError.message || '订单内容查询失败', 500, 'shop_order_content_failed');
    }

    if (itemsError) {
        throw createError(itemsError.message || '订单内容查询失败', 500, 'shop_order_content_failed');
    }

    const normalizedItems = Array.isArray(items)
        ? items.map((item) => ({
            name: item?.snapshot_product_name || order?.snapshot_product_name || '未知商品',
            content: item?.shop_inventory?.content || '',
            price: item?.price_paid || 0
        }))
        : [];

    return {
        success: true,
        payload: {
            order_id: order.id,
            product_name: order.snapshot_product_name || '',
            created_at: order.created_at || null,
            items: normalizedItems
        }
    };
}

function normalizeTicketCreateInput(input) {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const description = normalizeText(
            input.description || input.reason || input.content || '',
            1500
        );
        const issueType = normalizeText(input.issue_type || input.issueType, 60).toUpperCase() || 'OTHER';
        const normalizedOrderId = normalizeText(input.order_id || input.orderId, 120);
        return {
            description,
            issueType,
            orderId: isUuid(normalizedOrderId) ? normalizedOrderId : ''
        };
    }

    return {
        description: normalizeText(input, 1500),
        issueType: 'OTHER',
        orderId: ''
    };
}

async function handleCreateTicket({ requestSupabase, adminSupabase, user, input }) {
    const normalizedInput = normalizeTicketCreateInput(input);
    const description = normalizedInput.description;
    if (!description) {
        throw createError('请输入问题描述');
    }

    const insertPayload = {
        user_id: user.id,
        issue_type: normalizedInput.issueType,
        status: 'PENDING',
        description
    };
    if (normalizedInput.orderId) {
        insertPayload.order_id = normalizedInput.orderId;
    }

    const { data, error } = await requestSupabase
        .from('shop_tickets')
        .insert(insertPayload)
        .select('id, user_id, order_id, issue_type, status, description, created_at, updated_at')
        .single();

    if (error) {
        throw createError(error.message || '工单提交失败', 500, 'ticket_create_failed');
    }

    const ticketAlert = buildTicketCreatedAlert(data || insertPayload);
    if (adminSupabase?.from && ticketAlert) {
        try {
            await enqueueOpsAlertJob(adminSupabase, {
                ...ticketAlert,
                createdAt: data?.created_at || undefined,
                source: 'support_ticket'
            });
        } catch (enqueueError) {
            console.warn('[SupportAPI] Failed to enqueue ticket alert:', enqueueError.message || enqueueError);
        }
    }

    return {
        success: true,
        payload: {
            ticket_id: data?.id || ''
        }
    };
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    const rateLimit = await takeRateLimitToken({
        supabase: getOptionalSupabaseAdmin(),
        key: `support:${resolveClientIp(req, { env: process.env }) || 'unknown'}`,
        limit: Math.max(1, Number(process.env.SUPPORT_RATE_LIMIT_MAX || 30)),
        windowMs: Math.max(10_000, Number(process.env.SUPPORT_RATE_LIMIT_WINDOW_MS || 60_000))
    });
    applyRateLimitHeaders(res, rateLimit);
    if (!rateLimit.allowed) {
        return sendJson(res, 429, {
            success: false,
            code: 'rate_limited',
            message: 'Too many support requests',
            retry_after_seconds: rateLimit.retryAfterSeconds
        });
    }

    try {
        const body = await parseJsonBody(req);
        const action = normalizeText(body.action, 64);
        const input = body.input;
        const {
            user,
            requestSupabase,
            adminSupabase
        } = await requireAuthenticatedUser(req);

        if (!requestSupabase || !adminSupabase) {
            throw createError('Support service is not configured correctly', 500, 'support_not_configured');
        }

        let result = null;
        switch (action) {
            case 'code_status':
                result = await handleCodeStatus({ adminSupabase, input });
                break;
            case 'afdian_lookup':
                result = await handleAfdianLookup({ adminSupabase, user, input });
                break;
            case 'shop_order_status':
                result = await handleShopOrderStatus({ requestSupabase, input });
                break;
            case 'shop_order_content':
                result = await handleShopOrderContent({ requestSupabase, input });
                break;
            case 'create_ticket':
                result = await handleCreateTicket({ requestSupabase, adminSupabase, user, input });
                break;
            default:
                throw createError('Unsupported support action', 400, 'unsupported_action');
        }

        return sendJson(res, 200, result);
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            code: error.code || 'support_request_failed',
            message: error.message || '支持请求失败'
        });
    }
};
