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

function looksLikeEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeText(value, 255));
}

function looksLikeRedeemCode(value) {
    const normalized = normalizeText(value, 120).toUpperCase();
    return /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(normalized) && /[A-Z]/.test(normalized);
}

function looksLikeAfdianOrderNo(value) {
    const normalized = normalizeText(value, 120);
    if (!normalized || isUuid(normalized) || looksLikeEmail(normalized) || looksLikeRedeemCode(normalized)) {
        return false;
    }

    if (/^afd/i.test(normalized)) return true;
    return /^[A-Za-z0-9_-]{10,40}$/.test(normalized) && /\d/.test(normalized);
}

function parseVerifyHistoryMessage(message) {
    if (typeof message !== 'string' || !message.trim().startsWith('{')) {
        return null;
    }

    try {
        const parsed = JSON.parse(message);
        if (parsed?.kind === 'google_one_job' || parsed?.job_id || parsed?.error_message || parsed?.stage_label) {
            return parsed;
        }
    } catch (_) {
        return null;
    }

    return null;
}

function normalizeRefType(value) {
    const normalized = normalizeText(value, 40).toLowerCase();
    switch (normalized) {
        case 'order':
        case 'order_id':
        case 'shop_order':
            return 'order_id';
        case 'task':
        case 'task_id':
        case 'verify':
        case 'verify_task':
            return 'task_id';
        case 'code':
        case 'redeem_code':
        case 'exchange_code':
            return 'redeem_code';
        case 'afdian':
        case 'afdian_order':
        case 'afdian_order_no':
            return 'afdian_order_no';
        case 'email':
            return 'email';
        default:
            return normalized;
    }
}

function normalizeReferenceInput(input) {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        return {
            value: normalizeText(input.value || input.ref_id || input.refId || input.id || input.input || '', 160),
            refType: normalizeRefType(input.ref_type || input.refType || input.type || ''),
            site: normalizeText(input.site, 20).toLowerCase() || 'cn'
        };
    }

    return {
        value: normalizeText(input, 160),
        refType: '',
        site: 'cn'
    };
}

async function queryMaybeSingle(query) {
    if (typeof query.maybeSingle === 'function') {
        return query.maybeSingle();
    }

    const { data, error } = await query.limit(1);
    return {
        data: Array.isArray(data) ? (data[0] || null) : (data || null),
        error
    };
}

async function findShopOrderSummary(requestSupabase, orderId) {
    if (!requestSupabase?.from || !isUuid(orderId)) return null;

    const { data, error } = await queryMaybeSingle(
        requestSupabase
            .from('shop_orders')
            .select('id, snapshot_product_name, delivery_status, delivery_task_id, delivery_last_error, created_at, delivery_updated_at, delivery_completed_at')
            .eq('id', orderId)
    );

    if (error) {
        const message = normalizeText(error.message, 240).toLowerCase();
        if (error.code === 'PGRST116' || message.includes('0 rows') || message.includes('no rows')) {
            return null;
        }
        throw error;
    }

    return data || null;
}

async function findVerificationLogByTaskId(requestSupabase, userId, taskId, site = 'cn') {
    if (!requestSupabase?.from || !userId || !taskId) return null;

    const exactQuery = requestSupabase
        .from('verification_logs')
        .select('id, user_id, verification_id, status, message, created_at, site')
        .eq('user_id', userId)
        .eq('site', site)
        .eq('verification_id', taskId)
        .order('created_at', { ascending: false });

    const { data: exactData, error: exactError } = await exactQuery.limit(1);
    if (exactError) {
        const message = normalizeText(exactError.message, 240).toLowerCase();
        if (!(exactError.code === 'PGRST116' || message.includes('0 rows') || message.includes('no rows'))) {
            throw exactError;
        }
    }
    if (Array.isArray(exactData) && exactData.length) {
        return exactData[0];
    }

    const { data, error } = await requestSupabase
        .from('verification_logs')
        .select('id, user_id, verification_id, status, message, created_at, site')
        .eq('user_id', userId)
        .eq('site', site)
        .order('created_at', { ascending: false })
        .limit(80);

    if (error) {
        throw error;
    }

    return (data || []).find((row) => normalizeText(parseVerifyHistoryMessage(row.message)?.job_id, 120) === taskId) || null;
}

async function detectReferencePayload({ requestSupabase, user, input }) {
    const normalized = normalizeReferenceInput(input);
    const rawValue = normalized.value;

    if (!rawValue) {
        throw createError('请输入要识别的内容');
    }

    if (normalized.refType === 'email' || (!normalized.refType && looksLikeEmail(rawValue))) {
        return {
            ref_type: 'email',
            normalized_value: rawValue.trim().toLowerCase(),
            confidence: 0.99,
            next_action: 'verify_precheck',
            matched_by: 'email_pattern'
        };
    }

    if (normalized.refType === 'order_id' || (!normalized.refType && isUuid(rawValue))) {
        const order = await findShopOrderSummary(requestSupabase, rawValue);
        if (order) {
            return {
                ref_type: 'order_id',
                normalized_value: order.id,
                confidence: 0.99,
                next_action: 'shop_order_status',
                matched_by: 'shop_order_lookup'
            };
        }
    }

    if (normalized.refType === 'task_id' || (!normalized.refType && isUuid(rawValue))) {
        const verifyLog = await findVerificationLogByTaskId(requestSupabase, user.id, rawValue, normalized.site);
        if (verifyLog) {
            const payload = parseVerifyHistoryMessage(verifyLog.message) || {};
            return {
                ref_type: 'task_id',
                normalized_value: normalizeText(payload.job_id || verifyLog.verification_id, 120),
                confidence: 0.96,
                next_action: 'verify_task_status',
                matched_by: 'verification_log_lookup',
                site: normalizeText(verifyLog.site, 20).toLowerCase() || normalized.site
            };
        }
    }

    if (normalized.refType === 'redeem_code' || (!normalized.refType && looksLikeRedeemCode(rawValue))) {
        return {
            ref_type: 'redeem_code',
            normalized_value: rawValue.trim().toUpperCase(),
            confidence: normalized.refType === 'redeem_code' ? 0.99 : 0.88,
            next_action: 'code_status',
            matched_by: 'redeem_code_pattern'
        };
    }

    if (normalized.refType === 'afdian_order_no' || (!normalized.refType && looksLikeAfdianOrderNo(rawValue))) {
        return {
            ref_type: 'afdian_order_no',
            normalized_value: rawValue.trim(),
            confidence: normalized.refType === 'afdian_order_no' ? 0.99 : 0.68,
            next_action: 'afdian_lookup',
            matched_by: 'afdian_order_pattern'
        };
    }

    return {
        ref_type: 'unknown',
        normalized_value: rawValue.trim(),
        confidence: 0.2,
        next_action: 'create_ticket',
        matched_by: 'fallback'
    };
}

function buildCodeExplanation(statusPayload = {}) {
    const status = normalizeText(statusPayload.status, 60).toLowerCase();
    const message = normalizeText(statusPayload.message, 600);

    if (statusPayload.valid === true && status === 'pending') {
        return {
            status: 'pending',
            category: 'redeem_code_available',
            title: '兑换码可以正常使用',
            message: '这张兑换码当前未使用，也没有失效，可以继续兑换。',
            retryable: false,
            suggested_actions: ['redeem_code']
        };
    }

    if (status === 'used') {
        return {
            status,
            category: 'redeem_code_used',
            title: '兑换码已经被使用',
            message: message || '这张兑换码已经被领取，不能再次兑换。',
            retryable: false,
            suggested_actions: ['create_ticket']
        };
    }

    if (status === 'revoked' || status === 'disabled' || status === 'locked') {
        return {
            status,
            category: 'redeem_code_unavailable',
            title: '兑换码当前不可用',
            message: message || '这张兑换码当前不可继续使用，建议提交工单处理。',
            retryable: false,
            suggested_actions: ['create_ticket']
        };
    }

    return {
        status: status || 'invalid',
        category: 'redeem_code_invalid',
        title: '兑换码无法识别',
        message: message || '没有找到这张兑换码，或它已经不属于当前可用范围。',
        retryable: false,
        suggested_actions: ['create_ticket']
    };
}

function buildShopOrderExplanation(order = {}) {
    const status = normalizeText(order.delivery_status, 60).toLowerCase();
    const lastError = normalizeText(order.delivery_last_error, 1000);

    switch (status) {
        case 'delivered':
            return {
                status,
                category: 'shop_delivered',
                title: '订单已经发放完成',
                message: '这个订单已经履约完成，如果你需要查看具体内容，可以继续查“已发放内容”。',
                retryable: false,
                suggested_actions: ['shop_order_content']
            };
        case 'pending':
        case 'processing':
            return {
                status,
                category: 'shop_delivery_in_progress',
                title: '订单还在发放中',
                message: '系统还在处理这个订单，通常不需要重复提交。可以稍后再次查看状态。',
                retryable: false,
                suggested_actions: ['shop_order_status', 'create_ticket']
            };
        case 'retry_waiting':
        case 'requeued':
            return {
                status,
                category: 'shop_delivery_retrying',
                title: '订单正在自动重试',
                message: lastError
                    ? `系统已经把订单放进自动重试队列。最近一次错误是：${lastError}`
                    : '系统已经把订单放进自动重试队列，可以稍后再次查看。',
                retryable: false,
                suggested_actions: ['shop_order_status', 'create_ticket']
            };
        case 'dead_letter':
            return {
                status,
                category: 'shop_delivery_dead_letter',
                title: '订单需要人工处理',
                message: lastError
                    ? `这个订单已经进入死信状态，最近错误是：${lastError}`
                    : '这个订单已经进入死信状态，建议直接提交工单。',
                retryable: false,
                suggested_actions: ['create_ticket']
            };
        default:
            return {
                status: status || 'unknown',
                category: 'shop_delivery_unknown',
                title: '订单状态还不明确',
                message: lastError || '暂时无法明确判断订单问题，建议继续观察或提交工单。',
                retryable: false,
                suggested_actions: ['shop_order_status', 'create_ticket']
            };
    }
}

function classifyVerifyFailure(payload = {}, row = {}) {
    const searchText = [
        payload.error_message,
        payload.error_code,
        payload.stage_label,
        payload.raw_status,
        row.status
    ].map((item) => normalizeText(item, 240).toLowerCase()).filter(Boolean).join(' ');

    if (/(region|country|地区|国家|unsupported region|not supported)/.test(searchText)) {
        return {
            category: 'verify_region_unsupported',
            title: '当前地区暂不支持',
            message: '这个任务失败更像是地区限制导致的，通常重试也不会解决。',
            retryable: false
        };
    }

    if (/(sso|workspace|domain|组织|企业邮箱|工作区|google workspace)/.test(searchText)) {
        return {
            category: 'verify_sso_unsupported',
            title: '当前邮箱类型不支持',
            message: '这类失败通常和 SSO / 组织域邮箱有关，建议换普通个人账号再试。',
            retryable: false
        };
    }

    if (/(timeout|timed out|超时|upstream|上游|temporary|temporarily|network|网络|queue)/.test(searchText)) {
        return {
            category: 'verify_upstream_temporary',
            title: '上游接口临时异常',
            message: '这更像是上游服务超时或短暂异常，稍后重试通常有机会恢复。',
            retryable: true
        };
    }

    if (/(duplicate|already|冲突|trial exists|already activated|已存在|已开通过)/.test(searchText)) {
        return {
            category: 'verify_conflict_existing_state',
            title: '账号当前状态与试用要求冲突',
            message: '这个失败更像是账号已有冲突记录或不满足再次试用条件。',
            retryable: false
        };
    }

    return {
        category: 'verify_failed_unknown',
        title: '任务执行失败',
        message: '任务已经失败，但当前无法从错误文本里稳定归类，建议稍后重试或提交工单。',
        retryable: true
    };
}

function buildVerifyExplanation(logRow = {}) {
    const payload = parseVerifyHistoryMessage(logRow.message) || {};
    const status = normalizeText(logRow.status || payload.raw_status, 60).toLowerCase();
    const stageLabel = normalizeText(payload.stage_label, 120);
    const errorMessage = normalizeText(payload.error_message || payload.error || '', 600);

    if (status === 'success') {
        return {
            status,
            category: 'verify_success',
            title: '任务已经完成',
            message: normalizeText(payload.url, 500)
                ? '任务已经成功完成，你可以直接查看结果链接。'
                : '任务已经成功完成。',
            retryable: false,
            suggested_actions: ['verify_task_status']
        };
    }

    if (['queued', 'pending', 'processing', 'requeued', 'retry_waiting'].includes(status)) {
        return {
            status,
            category: 'verify_in_progress',
            title: '任务还在处理中',
            message: stageLabel
                ? `当前任务还在处理，阶段是：${stageLabel}`
                : '当前任务还在排队或处理中，不需要重复提交。',
            retryable: false,
            suggested_actions: ['verify_task_status']
        };
    }

    if (status === 'failed') {
        const failure = classifyVerifyFailure(payload, logRow);
        return {
            status,
            category: failure.category,
            title: failure.title,
            message: errorMessage || failure.message,
            retryable: failure.retryable,
            suggested_actions: failure.retryable
                ? ['verify_task_status', 'create_ticket']
                : ['create_ticket']
        };
    }

    return {
        status: status || 'unknown',
        category: 'verify_unknown',
        title: '任务状态暂时不明确',
        message: errorMessage || stageLabel || '暂时无法判断这个验证任务的具体问题。',
        retryable: false,
        suggested_actions: ['verify_task_status', 'create_ticket']
    };
}

async function handleDetectReference({ requestSupabase, user, input }) {
    return {
        success: true,
        payload: await detectReferencePayload({ requestSupabase, user, input })
    };
}

async function handleExplainFailure({ requestSupabase, adminSupabase, user, input }) {
    const normalized = normalizeReferenceInput(input);
    const detected = normalized.refType
        ? {
            ref_type: normalized.refType,
            normalized_value: normalized.value,
            confidence: 0.99,
            next_action: 'create_ticket',
            matched_by: 'explicit_ref_type',
            site: normalized.site
        }
        : await detectReferencePayload({ requestSupabase, user, input });

    if (!detected?.ref_type || detected.ref_type === 'unknown') {
        throw createError('暂时无法识别这段内容属于哪类问题，请提供兑换码、订单号或任务号', 400, 'reference_not_detected');
    }

    if (detected.ref_type === 'redeem_code') {
        const result = await handleCodeStatus({ adminSupabase, input: detected.normalized_value });
        return {
            success: true,
            payload: {
                ref_type: detected.ref_type,
                ref_id: detected.normalized_value,
                ...buildCodeExplanation(result.payload || {})
            }
        };
    }

    if (detected.ref_type === 'order_id') {
        const order = await findShopOrderSummary(requestSupabase, detected.normalized_value);
        if (!order) {
            throw createError('订单不存在或无权访问', 404, 'shop_order_not_found');
        }

        return {
            success: true,
            payload: {
                ref_type: 'order_id',
                ref_id: order.id,
                ...buildShopOrderExplanation(order),
                delivery_task_id: normalizeText(order.delivery_task_id, 120) || '',
                raw_error: normalizeText(order.delivery_last_error, 1000) || ''
            }
        };
    }

    if (detected.ref_type === 'task_id') {
        const verifyLog = await findVerificationLogByTaskId(requestSupabase, user.id, detected.normalized_value, detected.site || normalized.site);
        if (!verifyLog) {
            throw createError('任务不存在或无权访问', 404, 'verify_task_not_found');
        }

        const payload = parseVerifyHistoryMessage(verifyLog.message) || {};
        return {
            success: true,
            payload: {
                ref_type: 'task_id',
                ref_id: normalizeText(payload.job_id || verifyLog.verification_id, 120),
                site: normalizeText(verifyLog.site, 20).toLowerCase() || normalized.site,
                stage_label: normalizeText(payload.stage_label, 120) || '',
                raw_error: normalizeText(payload.error_message || payload.error_code, 1000) || '',
                ...buildVerifyExplanation(verifyLog)
            }
        };
    }

    if (detected.ref_type === 'afdian_order_no') {
        return {
            success: true,
            payload: {
                ref_type: 'afdian_order_no',
                ref_id: detected.normalized_value,
                status: 'manual_lookup_required',
                category: 'afdian_lookup_required',
                title: '爱发电订单建议直接查询',
                message: '这类问题最稳妥的方式还是直接查爱发电订单找回结果，再决定是否需要提交工单。',
                retryable: false,
                suggested_actions: ['afdian_lookup', 'create_ticket']
            }
        };
    }

    if (detected.ref_type === 'email') {
        return {
            success: true,
            payload: {
                ref_type: 'email',
                ref_id: detected.normalized_value,
                status: 'precheck_only',
                category: 'verify_email_precheck',
                title: '邮箱更适合做前置检查',
                message: '仅凭邮箱还不足以解释某一次失败任务，建议提供任务号；如果你是想先判断可不可做，再走“重新提交前检查”。',
                retryable: false,
                suggested_actions: ['verify_precheck', 'create_ticket']
            }
        };
    }

    throw createError('暂不支持解释这一类问题', 400, 'unsupported_explain_ref_type');
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

async function fetchProfileEmailByUserId(supabase, userId) {
    const normalizedUserId = normalizeText(userId, 120);
    if (!supabase?.from || !normalizedUserId) {
        return '';
    }

    try {
        const query = supabase
            .from('profiles')
            .select('id, email')
            .eq('id', normalizedUserId);
        const { data, error } = await (typeof query.maybeSingle === 'function'
            ? query.maybeSingle()
            : query.single());

        if (error) {
            const message = normalizeText(error.message, 240).toLowerCase();
            if (error.code === 'PGRST116' || message.includes('0 rows') || message.includes('no rows')) {
                return '';
            }
            throw error;
        }

        return normalizeText(data?.email, 255);
    } catch (error) {
        console.warn('[SupportAPI] Failed to load profile email:', error.message || error);
        return '';
    }
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

    const profileEmail = await fetchProfileEmailByUserId(adminSupabase || requestSupabase, user.id);
    const ticketAlert = buildTicketCreatedAlert({
        ...(data || insertPayload),
        user_email: profileEmail || normalizeText(user?.email, 255) || null
    });
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
            case 'detect_reference':
                result = await handleDetectReference({ requestSupabase, user, input });
                break;
            case 'explain_failure':
                result = await handleExplainFailure({ requestSupabase, adminSupabase, user, input });
                break;
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
