const {
    normalizeAdminSite,
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_SCAN_ROWS = 5000;

const EXCEPTION_KEYS = Object.freeze([
    'paid_unfulfilled',
    'reservation_expired',
    'payment_review',
    'payment_failed',
    'amount_mismatch',
    'refund_failed',
    'inventory_inconsistent',
    'dead_letter'
]);

const EXCEPTION_KEY_SET = new Set(EXCEPTION_KEYS);
const SUMMARY_KEYS = Object.freeze(['total', 'normal', 'critical', 'warning', ...EXCEPTION_KEYS]);

const WRITE_ACTIONS = Object.freeze({
    request_refund: {
        rpc: 'fn_guest_shop_admin_queue_refund',
        audit: 'shop.guest_order.request_refund'
    },
    manual_fulfill: {
        rpc: 'fn_guest_shop_admin_manual_fulfill',
        audit: 'shop.guest_order.manual_fulfill'
    },
    unlock_dead_letter: {
        rpc: 'fn_guest_shop_admin_unlock_dead_letter',
        audit: 'shop.guest_order.unlock_dead_letter'
    }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_ADMIN_REASON_LENGTH = 8;
const MAX_ADMIN_REASON_LENGTH = 500;

const RPC_ERROR_MAP = Object.freeze({
    guest_admin_reason_required: { status: 400, message: '请填写至少 8 个字的处理原因' },
    guest_admin_actor_required: { status: 400, message: '缺少管理员身份' },
    guest_order_required: { status: 400, message: '缺少游客订单 ID' },
    guest_order_not_found: { status: 404, message: '游客订单不存在' },
    guest_admin_site_mismatch: { status: 409, message: '订单站点与当前筛选不一致' },
    guest_admin_active_lease: { status: 409, message: '订单正在被履约任务处理，请稍后再试' },
    guest_admin_not_eligible: { status: 409, message: '当前订单状态不允许该操作' },
    guest_admin_manual_delivery: { status: 409, message: '人工发货订单不能自动补发' },
    guest_admin_quantity_unsupported: { status: 409, message: '当前订单数量不支持补发' },
    guest_inventory_unavailable: { status: 409, message: '暂无可用库存，无法补发' },
    guest_reservation_not_found: { status: 409, message: '订单预占记录不存在' }
});

// Keep this projection in sync with the content-free admin view. In particular,
// never select claim hashes, inventory content, raw webhook bodies, or secrets.
const SAFE_VIEW_FIELDS = Object.freeze([
    'id',
    'order_no',
    'site',
    'currency',
    'product_id',
    'sku_id',
    'snapshot_product_name',
    'snapshot_sku_name',
    'quantity',
    'unit_amount',
    'total_amount',
    'payment_status',
    'reservation_status',
    'fulfillment_status',
    'refund_status',
    'expires_at',
    'paid_at',
    'fulfilled_at',
    'last_error_code',
    'last_error_message',
    'reservation_id',
    'inventory_id',
    'reservation_row_status',
    'reserved_until',
    'payment_order_id',
    'provider',
    'channel',
    'provider_order_no',
    'payment_row_status',
    'expected_amount',
    'paid_amount',
    'sign_verified',
    'amount_verified',
    'currency_verified',
    'final_status_verified',
    'last_event_at',
    'payment_last_error_code',
    'payment_last_error_message',
    'created_at',
    'updated_at'
]);

const SAFE_VIEW_SELECT = SAFE_VIEW_FIELDS.join(',');

function normalizeText(value, maxLength = 160) {
    const normalized = String(value ?? '').trim();
    return normalized ? normalized.slice(0, maxLength) : '';
}

function normalizeLower(value, maxLength = 160) {
    return normalizeText(value, maxLength).toLowerCase();
}

function parsePositiveInteger(value, fallback, maxValue) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, maxValue);
}

function createInputError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'invalid_guest_order_filter';
    return error;
}

function resolveSite(searchParams, req) {
    const rawQuerySite = normalizeText(searchParams.get('site'), 20);
    const rawSite = rawQuerySite || normalizeText(req?.adminSite, 20);
    if (!rawSite) return 'all';

    const normalized = normalizeAdminSite(rawSite);
    if (!['all', 'cn', 'intl'].includes(normalized)) {
        throw createInputError('site must be all, cn, or intl');
    }
    return normalized;
}

function resolveExceptionFilter(searchParams) {
    const raw = normalizeText(searchParams.get('exception') || searchParams.get('status'), 80);
    if (!raw) return null;

    const normalized = raw.toLowerCase();
    if (normalized === 'all') return 'all';
    if (!EXCEPTION_KEY_SET.has(normalized)) {
        throw createInputError('Unsupported guest order exception filter');
    }
    return normalized;
}

function resolveProviderFilter(searchParams) {
    const raw = normalizeText(searchParams.get('provider'), 80);
    if (!raw) return null;

    const normalized = raw.toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
        throw createInputError('provider contains invalid characters');
    }
    return normalized;
}

function escapePostgrestLikeValue(value) {
    return String(value || '').replace(/[\\%_]/g, (match) => `\\${match}`);
}

function resolveOrderQuery(searchParams) {
    return normalizeText(searchParams.get('orderNo') || searchParams.get('order_no') || searchParams.get('query'), 160).toLowerCase();
}

function parseDate(value) {
    const timestamp = Date.parse(String(value || ''));
    return Number.isFinite(timestamp) ? timestamp : null;
}

function containsAny(value, needles) {
    const source = normalizeLower(value, 500);
    return needles.some((needle) => source.includes(needle));
}

function isRefundException(paymentStatus, fulfillmentStatus, refundStatus) {
    if (['failed', 'manual_review'].includes(refundStatus)) return true;
    return refundStatus === 'pending'
        && (['refunded', 'chargeback'].includes(paymentStatus) || fulfillmentStatus === 'refunded');
}

function classifyGuestOrder(row, now = Date.now()) {
    const paymentStatus = normalizeLower(row?.payment_status);
    const paymentRowStatus = normalizeLower(row?.payment_row_status);
    const reservationStatus = normalizeLower(row?.reservation_status);
    const reservationRowStatus = normalizeLower(row?.reservation_row_status);
    const fulfillmentStatus = normalizeLower(row?.fulfillment_status);
    const refundStatus = normalizeLower(row?.refund_status);
    const errorText = `${normalizeLower(row?.last_error_code, 160)} ${normalizeLower(row?.last_error_message, 500)} ${normalizeLower(row?.payment_last_error_code, 160)} ${normalizeLower(row?.payment_last_error_message, 500)}`;

    if (fulfillmentStatus === 'dead_letter' || containsAny(errorText, ['dead_letter', 'dead-letter', 'dead letter'])) {
        return {
            key: 'dead_letter',
            severity: 'critical',
            reason: '履约任务已进入死信，需要人工处理'
        };
    }

    if (fulfillmentStatus === 'paid_unfulfillable') {
        return {
            key: 'inventory_inconsistent',
            severity: 'critical',
            reason: '已付款但库存无法履约，需补偿或退款'
        };
    }

    // A refund that is stuck or failed must not disappear behind the broader
    // "paid but unfulfilled" signal. It has a different owner and SLA.
    if (isRefundException(paymentStatus, fulfillmentStatus, refundStatus)) {
        return {
            key: 'refund_failed',
            severity: 'critical',
            reason: refundStatus === 'pending' ? '退款状态长时间未完成，需要人工核对' : '退款失败或进入人工复核'
        };
    }

    if (['amount_mismatch', 'overpaid', 'partial'].includes(paymentStatus)
        || ['amount_mismatch', 'overpaid', 'partial'].includes(paymentRowStatus)) {
        return {
            key: 'amount_mismatch',
            severity: 'critical',
            reason: '支付金额与订单金额不一致'
        };
    }

    if (paymentStatus === 'review' || paymentRowStatus === 'review') {
        return {
            key: 'payment_review',
            severity: 'warning',
            reason: '支付需要人工复核，未满足自动确认条件'
        };
    }

    if (paymentStatus === 'failed' || paymentRowStatus === 'failed') {
        return {
            key: 'payment_failed',
            severity: 'warning',
            reason: '支付处理失败'
        };
    }

    if (paymentStatus === 'confirmed' && !['delivered', 'refunded'].includes(fulfillmentStatus)) {
        return {
            key: 'paid_unfulfilled',
            severity: 'critical',
            reason: '支付已确认但订单尚未完成发货'
        };
    }

    const reservationExpiresAt = parseDate(row?.reserved_until);
    // The reservation row is the authoritative lock state. The denormalized
    // order column can lag after an atomic release and must not mask expiry.
    const effectiveReservationStatus = reservationRowStatus || reservationStatus;
    if (effectiveReservationStatus === 'held'
        && reservationExpiresAt !== null
        && reservationExpiresAt < now) {
        return {
            key: 'reservation_expired',
            severity: 'warning',
            reason: '库存预占已超时但尚未释放'
        };
    }

    if (containsAny(errorText, ['amount', 'mismatch', 'overpaid', 'partial'])) {
        return {
            key: 'amount_mismatch',
            severity: 'critical',
            reason: '最近一次支付或回调记录报告金额异常'
        };
    }

    if (containsAny(errorText, ['refund', 'chargeback'])) {
        return {
            key: 'refund_failed',
            severity: 'critical',
            reason: '最近一次退款处理报告异常'
        };
    }

    if (containsAny(errorText, ['inventory', 'reservation', 'reserve', 'stock', 'fulfill', 'delivery'])) {
        return {
            key: 'inventory_inconsistent',
            severity: 'critical',
            reason: '最近一次库存或履约处理报告异常'
        };
    }

    return null;
}

function matchesOrderQuery(row, orderQuery) {
    if (!orderQuery) return true;
    return normalizeLower(row?.order_no, 200).startsWith(orderQuery);
}

function sanitizeErrorMessage(value) {
    const normalized = normalizeText(value, 500);
    return normalized || null;
}

function sanitizeViewRow(row, classification) {
    const safeRow = {};
    for (const field of SAFE_VIEW_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(row || {}, field)) continue;
        safeRow[field] = row[field];
    }

    if (Object.prototype.hasOwnProperty.call(safeRow, 'last_error_message')) {
        safeRow.last_error_message = sanitizeErrorMessage(safeRow.last_error_message);
    }
    if (Object.prototype.hasOwnProperty.call(safeRow, 'payment_last_error_message')) {
        safeRow.payment_last_error_message = sanitizeErrorMessage(safeRow.payment_last_error_message);
    }

    if (classification) {
        safeRow.exception_key = classification.key;
        safeRow.exception_severity = classification.severity;
        safeRow.exception_reason = classification.reason;
    }

    return safeRow;
}

function compareRows(left, right) {
    const leftUpdated = parseDate(left?.updated_at) || parseDate(left?.created_at) || 0;
    const rightUpdated = parseDate(right?.updated_at) || parseDate(right?.created_at) || 0;
    if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
    return normalizeText(left?.order_no, 200).localeCompare(normalizeText(right?.order_no, 200));
}

function buildSummary(rows) {
    const summary = Object.fromEntries(SUMMARY_KEYS.map((key) => [key, 0]));
    summary.total = rows.length;
    for (const row of rows) {
        const classification = classifyGuestOrder(row);
        if (classification && Object.prototype.hasOwnProperty.call(summary, classification.key)) {
            summary[classification.key] += 1;
            if (classification.severity && Object.prototype.hasOwnProperty.call(summary, classification.severity)) {
                summary[classification.severity] += 1;
            }
        } else {
            summary.normal += 1;
        }
    }
    return summary;
}

function isUuid(value) {
    return UUID_RE.test(String(value || '').trim());
}

function firstRpcRow(data) {
    if (Array.isArray(data)) return data[0] || null;
    if (data && typeof data === 'object') return data;
    return null;
}

function createHttpError(statusCode, message, code) {
    const error = new Error(message);
    error.statusCode = statusCode;
    if (code) error.code = code;
    return error;
}

function isMissingAdminRpcError(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    return code === '42883'
        || code === 'PGRST202'
        || message.includes('could not find the function')
        || (message.includes('function') && message.includes('does not exist'));
}

function extractRaisedException(error) {
    const raw = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
    const match = raw.match(/\bguest_[a-z0-9_]+\b/i);
    return match ? match[0].toLowerCase() : '';
}

function mapAdminRpcError(error) {
    if (isMissingAdminRpcError(error)) {
        return createHttpError(503, '游客后台写操作尚未启用', 'guest_admin_ops_unavailable');
    }
    const raised = extractRaisedException(error);
    const mapped = RPC_ERROR_MAP[raised];
    if (mapped) {
        return createHttpError(mapped.status, mapped.message, raised);
    }
    return createHttpError(500, '游客订单写操作失败', 'guest_admin_ops_failed');
}

function sanitizeWriteResult(row) {
    return {
        orderId: row?.order_id || row?.id || null,
        orderNo: row?.order_no || null,
        payment: row?.payment_status || null,
        fulfillment: row?.fulfillment_status || null,
        refund: row?.refund_status || null,
        reservation: row?.reservation_status || null
    };
}

function resolveWriteSite(body, req) {
    const raw = normalizeText(body?.site || req?.adminSite, 20) || 'all';
    const normalized = normalizeAdminSite(raw);
    if (!['all', 'cn', 'intl'].includes(normalized)) {
        throw createHttpError(400, 'site must be all, cn, or intl', 'invalid_guest_order_site');
    }
    return normalized;
}

function sendGuestOrderError(res, error, fallbackMessage) {
    const statusCode = Number(error?.statusCode) || 500;
    if (statusCode === 401 || statusCode === 403) {
        return sendJson(res, statusCode, {
            success: false,
            message: error?.message || (statusCode === 401 ? 'Unauthorized' : 'Admin access required')
        });
    }
    if (statusCode === 400 || statusCode === 404 || statusCode === 409 || statusCode === 503) {
        return sendJson(res, statusCode, {
            success: false,
            code: error?.code || undefined,
            message: error?.message || fallbackMessage
        });
    }
    return sendJson(res, 500, {
        success: false,
        message: fallbackMessage
    });
}

async function handleGuestOrderWrite(req) {
    const { adminSupabase, user } = await requireAdmin(req, { permission: 'shop.manage' });
    if (!adminSupabase || typeof adminSupabase.rpc !== 'function') {
        throw createHttpError(503, '游客后台写操作尚未启用', 'guest_admin_ops_unavailable');
    }

    let body;
    try {
        body = await parseJsonBody(req);
    } catch (_) {
        throw createHttpError(400, '请求体不是有效 JSON', 'invalid_json');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw createHttpError(400, '请求体无效', 'invalid_json');
    }

    const action = normalizeText(body.action, 64);
    const spec = WRITE_ACTIONS[action];
    if (!spec) {
        throw createHttpError(400, 'Unsupported guest order action', 'invalid_guest_order_action');
    }
    if (body.confirm !== true) {
        throw createHttpError(400, '写操作需要二次确认', 'guest_admin_confirm_required');
    }

    const reason = normalizeText(body.reason, MAX_ADMIN_REASON_LENGTH);
    if (reason.length < MIN_ADMIN_REASON_LENGTH) {
        throw createHttpError(400, '请填写至少 8 个字的处理原因', 'guest_admin_reason_required');
    }

    const orderId = normalizeText(body.orderId || body.order_id, 80);
    if (!isUuid(orderId)) {
        throw createHttpError(400, 'orderId must be a valid UUID', 'invalid_guest_order_id');
    }

    const adminId = normalizeText(user?.id, 80);
    if (!isUuid(adminId)) {
        throw createHttpError(400, '缺少管理员身份', 'guest_admin_actor_required');
    }

    const site = resolveWriteSite(body, req);
    const rpcResult = await adminSupabase.rpc(spec.rpc, {
        p_order_id: orderId,
        p_reason: reason,
        p_admin_id: adminId,
        p_expected_site: site
    });
    if (rpcResult?.error) {
        throw mapAdminRpcError(rpcResult.error);
    }

    const row = firstRpcRow(rpcResult?.data);
    if (!row) {
        throw createHttpError(500, '游客订单写操作失败', 'guest_admin_ops_failed');
    }

    const safeResult = sanitizeWriteResult(row);
    await writeAdminAuditLog({
        supabase: adminSupabase,
        adminId,
        actionType: spec.audit,
        module: 'shop',
        site,
        details: {
            order_id: safeResult.orderId,
            order_no: safeResult.orderNo,
            action,
            reason,
            payment_status: safeResult.payment,
            fulfillment_status: safeResult.fulfillment,
            refund_status: safeResult.refund,
            reservation_status: safeResult.reservation
        }
    });

    return {
        success: true,
        action,
        site,
        ...safeResult
    };
}

async function loadGuestOrders(supabase, { site, provider, orderQuery }) {
    let query = supabase
        .from('admin_guest_shop_orders')
        .select(SAFE_VIEW_SELECT, { count: 'exact' })
        .order('updated_at', { ascending: false })
        .range(0, MAX_SCAN_ROWS - 1);

    if (site !== 'all' && typeof query.eq === 'function') {
        query = query.eq('site', site);
    }
    if (provider && typeof query.eq === 'function') {
        query = query.eq('provider', provider);
    }
    if (orderQuery && typeof query.ilike === 'function') {
        query = query.ilike('order_no', `${escapePostgrestLikeValue(orderQuery)}%`);
    }

    const result = await query;
    if (result?.error) throw result.error;

    return {
        rows: Array.isArray(result?.data) ? result.data : [],
        count: Number.isFinite(Number(result?.count)) ? Number(result.count) : null
    };
}

module.exports = async function adminGuestShopOrdersHandler(req, res) {
    const method = String(req.method || '').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    if (method === 'POST') {
        try {
            const payload = await handleGuestOrderWrite(req);
            return sendJson(res, 200, payload);
        } catch (error) {
            return sendGuestOrderError(res, error, 'Failed to update guest shop order');
        }
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'shop.manage' });
        const searchParams = new URL(req.url || '', 'http://localhost').searchParams;
        const site = resolveSite(searchParams, req);
        const exceptionFilter = resolveExceptionFilter(searchParams);
        const provider = resolveProviderFilter(searchParams);
        const orderQuery = resolveOrderQuery(searchParams);
        const page = parsePositiveInteger(searchParams.get('page'), 1, 100000);
        const pageSize = parsePositiveInteger(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        const scan = await loadGuestOrders(supabase, { site, provider, orderQuery });
        const now = Date.now();

        const classifiedRows = scan.rows
            .filter((row) => matchesOrderQuery(row, orderQuery))
            .map((row) => ({
                row,
                classification: classifyGuestOrder(row, now)
            }))
            .filter(({ classification }) => {
                if (exceptionFilter === 'all') return true;
                if (exceptionFilter) return classification?.key === exceptionFilter;
                return Boolean(classification);
            })
            .sort((left, right) => compareRows(left.row, right.row));

        const filteredRows = classifiedRows.map(({ row }) => row);
        const from = (page - 1) * pageSize;
        const pagedRows = classifiedRows.slice(from, from + pageSize);
        const scanTruncated = scan.count !== null && scan.count > scan.rows.length;

        return sendJson(res, 200, {
            success: true,
            site,
            exception: exceptionFilter || 'any',
            page,
            pageSize,
            count: filteredRows.length,
            scanTruncated,
            rows: pagedRows.map(({ row, classification }) => sanitizeViewRow(row, classification)) ,
            summary: buildSummary(filteredRows)
        });
    } catch (error) {
        return sendGuestOrderError(res, error, 'Failed to load guest shop orders');
    }
};

module.exports.classifyGuestOrder = classifyGuestOrder;
module.exports.SAFE_VIEW_FIELDS = SAFE_VIEW_FIELDS;
