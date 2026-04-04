const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    loadOpsAlertsRuntimeConfig
} = require('../../../../api/_lib/ops-alerts');
const {
    DEFAULT_TICKET_SLA_MONITOR_CONFIG
} = require('../../../../api/_lib/ticket-sla-alerts');
const {
    parseLinkedChatSessionContext,
    parseLinkedOpsAlertContext
} = require('../../../../js/admin-ticket-links');

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizePage(value, fallback = 1) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePageSize(value, fallback = 12) {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.min(parsed, 100);
}

function normalizeStatusFilter(value) {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (['pending', 'resolved', 'rejected', 'all'].includes(normalized)) {
        return normalized;
    }
    if (normalized === 'open') {
        return 'pending';
    }
    return 'all';
}

function normalizePriorityFilter(value) {
    const normalized = normalizeText(value, 40).toLowerCase();
    return normalized === 'high' ? 'high' : 'all';
}

function normalizeAssigneeFilter(value) {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (normalized === 'mine' || normalized === 'unassigned') {
        return normalized;
    }
    return 'all';
}

function normalizeBooleanFlag(value) {
    const normalized = normalizeText(value, 20).toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeTicketStatus(value) {
    const normalized = normalizeText(value, 40).toUpperCase();
    return !normalized || normalized === 'OPEN' ? 'PENDING' : normalized;
}

function getStatusValuesForFilter(statusFilter = 'all') {
    if (statusFilter === 'pending') {
        return ['PENDING', 'OPEN'];
    }
    if (statusFilter === 'resolved') {
        return ['RESOLVED'];
    }
    if (statusFilter === 'rejected') {
        return ['REJECTED'];
    }
    return [];
}

function getTicketStatusLabel(value) {
    const normalized = normalizeTicketStatus(value);
    if (normalized === 'PENDING') return '待处理';
    if (normalized === 'RESOLVED') return '已解决';
    if (normalized === 'REJECTED') return '已拒绝';
    return normalized || '待处理';
}

function isMissingRelationError(error, relationName = '') {
    const normalizedMessage = normalizeText(error?.message, 600).toLowerCase();
    const normalizedRelation = normalizeText(relationName, 120).toLowerCase();

    if (!normalizedMessage) {
        return false;
    }

    const mentionsRelation = normalizedRelation
        ? normalizedMessage.includes(normalizedRelation)
        : normalizedMessage.includes('relation') || normalizedMessage.includes('table');

    return mentionsRelation && (
        normalizedMessage.includes('does not exist')
        || normalizedMessage.includes('not exist')
        || normalizedMessage.includes('could not find')
        || normalizedMessage.includes('undefined table')
    );
}

function getIssueTypeLabel(value) {
    const normalized = normalizeText(value, 60).toUpperCase();
    const labelMap = {
        DELIVERY: '履约问题',
        VERIFICATION: '验证问题',
        REFUND: '退款问题',
        PAYMENT: '支付问题',
        ORDER: '订单问题',
        ACCOUNT: '账号问题',
        OTHER: '其他问题'
    };

    if (labelMap[normalized]) {
        return labelMap[normalized];
    }

    if (!normalized) {
        return '其他问题';
    }

    return normalized
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatWaitLabel(waitMinutes) {
    const normalized = Math.max(0, Math.round(Number(waitMinutes || 0)));
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    if (hours > 0 && minutes > 0) {
        return `${hours} 小时 ${minutes} 分钟`;
    }
    if (hours > 0) {
        return `${hours} 小时`;
    }
    return `${minutes} 分钟`;
}

function buildPagination(totalItems, page, pageSize) {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;

    return {
        page: currentPage,
        pageSize,
        totalItems,
        totalPages,
        hasPrevPage: currentPage > 1,
        hasNextPage: currentPage < totalPages,
        returnedItems: Math.max(0, Math.min(totalItems, end) - start),
        start,
        end
    };
}

async function fetchAuditRows(supabase, tableName = 'admin_audit_logs_view', selection = 'id, action_type, details, created_at, admin_id, admin_email') {
    const { data, error } = await supabase
        .from(tableName)
        .select(selection)
        .in('action_type', ['ticket.assign'])
        .order('created_at', { ascending: false })
        .limit(400);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function loadTicketAssignmentMap(supabase, ticketIds = []) {
    const normalizedTicketIds = Array.from(new Set((ticketIds || []).map((ticketId) => normalizeText(ticketId, 120)).filter(Boolean)));
    if (!normalizedTicketIds.length) {
        return new Map();
    }

    let rows = [];
    try {
        rows = await fetchAuditRows(supabase, 'admin_audit_logs_view', 'id, action_type, details, created_at, admin_id, admin_email');
    } catch (error) {
        if (!isMissingRelationError(error, 'admin_audit_logs_view')) {
            throw error;
        }

        try {
            rows = await fetchAuditRows(supabase, 'admin_audit_logs', 'id, action_type, details, created_at, admin_id');
        } catch (fallbackError) {
            if (isMissingRelationError(fallbackError, 'admin_audit_logs')) {
                return new Map();
            }
            throw fallbackError;
        }
    }

    const assignmentByTicketId = new Map();
    rows.forEach((row) => {
        const details = row && typeof row.details === 'object' && !Array.isArray(row.details) ? row.details : {};
        const ticketId = normalizeText(details.ticket_id, 120);
        if (!normalizedTicketIds.includes(ticketId) || assignmentByTicketId.has(ticketId)) {
            return;
        }

        const assigned = details.assigned !== false && (normalizeText(details.assignee_id, 120) || normalizeText(details.assignee_label, 255));
        assignmentByTicketId.set(ticketId, {
            assigned_to_id: assigned ? normalizeText(details.assignee_id, 120) : '',
            assigned_to_label: assigned ? normalizeText(details.assignee_label, 255) : '',
            assigned_at: normalizeText(row.created_at, 80),
            assigned_by: normalizeText(row.admin_email, 255) || normalizeText(row.admin_id, 120),
            assignment_summary: assigned
                ? `负责人：${normalizeText(details.assignee_label, 255) || normalizeText(details.assignee_id, 120)}`
                : '负责人：未指派'
        });
    });

    return assignmentByTicketId;
}

async function loadProfilesByIds(supabase, userIds = []) {
    const uniqueIds = Array.from(new Set((userIds || []).map((userId) => normalizeText(userId, 120)).filter(Boolean)));
    if (!uniqueIds.length) {
        return new Map();
    }

    const rows = [];
    const chunkSize = 200;
    for (let index = 0; index < uniqueIds.length; index += chunkSize) {
        const batch = uniqueIds.slice(index, index + chunkSize);
        const { data, error } = await supabase
            .from('profiles')
            .select('id, email')
            .in('id', batch);

        if (error) {
            throw error;
        }

        rows.push(...(Array.isArray(data) ? data : []));
    }

    return new Map(rows.map((row) => [normalizeText(row?.id, 120), row]));
}

async function loadMatchingProfileIdsByEmail(supabase, query = '') {
    const normalizedQuery = normalizeText(query, 255);
    if (!normalizedQuery) {
        return new Set();
    }

    const { data, error } = await supabase
        .from('profiles')
        .select('id, email')
        .ilike('email', `%${normalizedQuery}%`)
        .limit(100);

    if (error) {
        throw error;
    }

    return new Set((data || []).map((row) => normalizeText(row?.id, 120)).filter(Boolean));
}

async function loadOrdersByIds(supabase, orderIds = []) {
    const uniqueIds = Array.from(new Set((orderIds || []).map((orderId) => normalizeText(orderId, 120)).filter(Boolean)));
    if (!uniqueIds.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('shop_orders')
        .select('id, price_paid, refund_status')
        .in('id', uniqueIds);

    if (error) {
        throw error;
    }

    return new Map((data || []).map((row) => [normalizeText(row?.id, 120), row]));
}

function buildTicketSearchHaystack(ticket = {}) {
    return [
        normalizeText(ticket.id, 120),
        normalizeText(ticket.order_id, 120),
        normalizeText(ticket.user_id, 120),
        normalizeText(ticket.issue_type, 60),
        normalizeText(ticket.reason, 1500),
        normalizeText(ticket.description, 1500),
        normalizeText(ticket.admin_notes, 1500)
    ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
}

function applyTicketSearch(rows = [], query = '', emailMatchedUserIds = new Set()) {
    const normalizedQuery = normalizeText(query, 255).toLowerCase();
    if (!normalizedQuery) {
        return Array.isArray(rows) ? rows : [];
    }

    return (Array.isArray(rows) ? rows : []).filter((ticket) => {
        if (emailMatchedUserIds.has(normalizeText(ticket?.user_id, 120))) {
            return true;
        }

        return buildTicketSearchHaystack(ticket).includes(normalizedQuery);
    });
}

function inferTicketSourceMeta(ticket = {}) {
    const description = normalizeText(ticket.description, 4000);
    if (parseLinkedChatSessionContext(description)) {
        return {
            source_type: 'chat_session',
            source_label: '客服会话'
        };
    }

    if (parseLinkedOpsAlertContext(description)) {
        return {
            source_type: 'ops_alert',
            source_label: '站内代办'
        };
    }

    return {
        source_type: 'user_ticket',
        source_label: '用户提交'
    };
}

function buildTicketTimingMeta(ticket = {}, pendingOverdueMinutes = DEFAULT_TICKET_SLA_MONITOR_CONFIG.pending_overdue_minutes, nowDate = new Date()) {
    const createdAtMs = Date.parse(ticket?.created_at || '');
    const ticketAgeMinutes = Number.isFinite(createdAtMs)
        ? Math.max(0, Math.round((nowDate.getTime() - createdAtMs) / 60000))
        : 0;
    const normalizedStatus = normalizeTicketStatus(ticket?.status);
    const isOverdue = normalizedStatus === 'PENDING' && ticketAgeMinutes >= Number(pendingOverdueMinutes || 0);
    const waitLabel = formatWaitLabel(ticketAgeMinutes);

    return {
        ticket_age_minutes: ticketAgeMinutes,
        wait_label: waitLabel,
        is_overdue: isOverdue,
        sla_threshold_minutes: Number(pendingOverdueMinutes || 0),
        sla_label: normalizedStatus === 'PENDING'
            ? (isOverdue
                ? `已超时 ${waitLabel}`
                : `等待 ${waitLabel}`)
            : `已处理 · ${getTicketStatusLabel(normalizedStatus)}`
    };
}

function buildRefundMeta(ticket = {}, order = null) {
    const orderId = normalizeText(ticket?.order_id, 120);
    if (!orderId) {
        return {
            order_price_paid: 0,
            order_refund_status: 'none',
            can_refund: false,
            refund_summary: '无关联订单'
        };
    }

    const refundStatus = normalizeText(order?.refund_status, 40).toLowerCase() || 'none';
    const refunded = refundStatus === 'refunded' || refundStatus === 'full_refund';
    const paidAmount = Math.max(0, Math.round(Number(order?.price_paid || 0)));
    const pendingTicket = normalizeTicketStatus(ticket?.status) === 'PENDING';
    const canRefund = pendingTicket && !refunded && paidAmount > 0;

    let refundSummary = '可发起退款';
    if (refunded) {
        refundSummary = '订单已退款';
    } else if (paidAmount > 0) {
        refundSummary = canRefund ? `可退 ${paidAmount} 积分` : `订单金额 ${paidAmount} 积分`;
    } else {
        refundSummary = '订单无可退积分';
    }

    return {
        order_price_paid: paidAmount,
        order_refund_status: refundStatus,
        can_refund: canRefund,
        refund_summary: refundSummary
    };
}

function buildPriorityMeta(ticket = {}, sourceMeta = {}, timingMeta = {}, refundMeta = {}) {
    const normalizedIssueType = normalizeText(ticket?.issue_type, 60).toUpperCase();
    const reasons = [];
    let score = 0;

    if (timingMeta.is_overdue === true) {
        reasons.push('超时待处理');
        score += 4;
    }

    if (refundMeta.can_refund === true) {
        reasons.push('可直接退款');
        score += 2;
    }

    if (normalizeText(sourceMeta.source_type, 80) === 'ops_alert') {
        reasons.push('站内代办');
        score += 1;
    }

    if (['REFUND', 'PAYMENT', 'ACCOUNT', 'VERIFICATION'].includes(normalizedIssueType)) {
        reasons.push('敏感售后');
        score += 1;
    }

    const isHighPriority = score >= 3;
    return {
        priority_score: score,
        priority_level: isHighPriority ? 'high' : 'normal',
        priority_label: isHighPriority ? '高优先' : '常规',
        priority_summary: reasons.slice(0, 2).join(' · ') || '常规跟进',
        is_high_priority: isHighPriority
    };
}

function enrichTicketRow(ticket = {}, context = {}) {
    const userId = normalizeText(ticket?.user_id, 120);
    const orderId = normalizeText(ticket?.order_id, 120);
    const normalizedStatus = normalizeTicketStatus(ticket?.status);
    const profile = context.profilesById.get(userId) || {};
    const order = context.ordersById.get(orderId) || null;
    const sourceMeta = inferTicketSourceMeta(ticket);
    const timingMeta = buildTicketTimingMeta(ticket, context.pendingOverdueMinutes, context.nowDate);
    const refundMeta = buildRefundMeta(ticket, order);
    const priorityMeta = buildPriorityMeta(ticket, sourceMeta, timingMeta, refundMeta);
    const assignmentMeta = context.assignmentByTicketId?.get(normalizeText(ticket?.id, 120)) || {
        assigned_to_id: '',
        assigned_to_label: '',
        assigned_at: '',
        assigned_by: '',
        assignment_summary: '负责人：未指派'
    };

    return {
        ...ticket,
        status: normalizedStatus,
        status_label: getTicketStatusLabel(normalizedStatus),
        issue_type_label: getIssueTypeLabel(ticket?.issue_type),
        user_email: normalizeText(profile?.email, 255),
        ...sourceMeta,
        ...timingMeta,
        ...refundMeta,
        ...priorityMeta,
        ...assignmentMeta
    };
}

function matchesAssigneeFilter(ticket = {}, filters = {}) {
    const assigneeFilter = normalizeAssigneeFilter(filters?.assigneeFilter);
    if (assigneeFilter === 'all') {
        return true;
    }

    const assignedToId = normalizeText(ticket?.assigned_to_id, 120);
    const assignedToLabel = normalizeText(ticket?.assigned_to_label, 255);
    if (assigneeFilter === 'unassigned') {
        return !(assignedToId || assignedToLabel);
    }

    const currentAdminId = normalizeText(filters?.currentAdminId, 120);
    const currentAdminEmail = normalizeText(filters?.currentAdminEmail, 255).toLowerCase();
    return Boolean(
        (assignedToId && assignedToId === currentAdminId)
        || (assignedToLabel && assignedToLabel.toLowerCase() === currentAdminEmail)
    );
}

function applyDerivedFilters(rows = [], filters = {}) {
    const overdueOnly = filters?.overdueOnly === true;
    const priorityFilter = normalizePriorityFilter(filters?.priorityFilter);
    const assigneeFilter = normalizeAssigneeFilter(filters?.assigneeFilter);

    return (Array.isArray(rows) ? rows : []).filter((ticket) => {
        if (overdueOnly && ticket?.is_overdue !== true) {
            return false;
        }
        if (priorityFilter === 'high' && ticket?.is_high_priority !== true) {
            return false;
        }
        if (assigneeFilter !== 'all' && !matchesAssigneeFilter(ticket, filters)) {
            return false;
        }
        return true;
    });
}

async function queryTicketRows(supabase, { statusFilter, page, pageSize, query, loadAllRows = false }) {
    const normalizedQuery = normalizeText(query, 255);
    const statusValues = getStatusValuesForFilter(statusFilter);

    if (!normalizedQuery && !loadAllRows) {
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        let queryBuilder = supabase
            .from('shop_tickets')
            .select('id, user_id, order_id, issue_type, status, description, admin_notes, created_at, updated_at', { count: 'exact' })
            .order('created_at', { ascending: false });

        if (statusValues.length === 1) {
            queryBuilder = queryBuilder.eq('status', statusValues[0]);
        } else if (statusValues.length > 1) {
            queryBuilder = queryBuilder.in('status', statusValues);
        }

        const { data, count, error } = await queryBuilder.range(from, to);
        if (error) {
            throw error;
        }

        return {
            rows: Array.isArray(data) ? data : [],
            pagination: buildPagination(Number(count) || 0, page, pageSize),
            paged: true
        };
    }

    let queryBuilder = supabase
        .from('shop_tickets')
        .select('id, user_id, order_id, issue_type, status, description, admin_notes, created_at, updated_at')
        .order('created_at', { ascending: false });

    if (statusValues.length === 1) {
        queryBuilder = queryBuilder.eq('status', statusValues[0]);
    } else if (statusValues.length > 1) {
        queryBuilder = queryBuilder.in('status', statusValues);
    }

    const [ticketResponse, matchedProfileIds] = await Promise.all([
        queryBuilder,
        loadMatchingProfileIdsByEmail(supabase, normalizedQuery)
    ]);

    if (ticketResponse.error) {
        throw ticketResponse.error;
    }

    const filteredRows = applyTicketSearch(ticketResponse.data || [], normalizedQuery, matchedProfileIds);
    return {
        rows: filteredRows,
        pagination: buildPagination(filteredRows.length, page, pageSize),
        paged: false
    };
}

module.exports = async function adminTicketsListHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'tickets.manage' });
        const searchParams = getSearchParams(req);
        const statusFilter = normalizeStatusFilter(searchParams.get('status'));
        const page = normalizePage(searchParams.get('page'), 1);
        const pageSize = normalizePageSize(searchParams.get('pageSize'), 12);
        const query = normalizeText(searchParams.get('query'), 255);
        const overdueOnly = normalizeBooleanFlag(searchParams.get('overdue'));
        const priorityFilter = normalizePriorityFilter(searchParams.get('priority'));
        const assigneeFilter = normalizeAssigneeFilter(searchParams.get('assignee'));
        const loadAllRows = overdueOnly || priorityFilter === 'high' || assigneeFilter !== 'all';

        const runtime = await loadOpsAlertsRuntimeConfig(supabase).catch(() => null);
        const runtimeTicketsConfig = runtime?.config?.tickets && typeof runtime.config.tickets === 'object'
            ? runtime.config.tickets
            : (runtime?.tickets && typeof runtime.tickets === 'object' ? runtime.tickets : null);
        const pendingOverdueMinutes = Number(runtimeTicketsConfig?.pending_overdue_minutes || DEFAULT_TICKET_SLA_MONITOR_CONFIG.pending_overdue_minutes) || DEFAULT_TICKET_SLA_MONITOR_CONFIG.pending_overdue_minutes;
        const ticketCollection = await queryTicketRows(supabase, {
            statusFilter,
            page,
            pageSize,
            query,
            loadAllRows
        });

        const rows = Array.isArray(ticketCollection.rows) ? ticketCollection.rows : [];
        const [profilesById, ordersById, assignmentByTicketId] = await Promise.all([
            loadProfilesByIds(supabase, rows.map((ticket) => ticket?.user_id)),
            loadOrdersByIds(supabase, rows.map((ticket) => ticket?.order_id)),
            loadTicketAssignmentMap(supabase, rows.map((ticket) => ticket?.id)).catch(() => new Map())
        ]);
        const nowDate = new Date();
        const enrichedRows = rows.map((ticket) => enrichTicketRow(ticket, {
            profilesById,
            ordersById,
            pendingOverdueMinutes,
            nowDate,
            assignmentByTicketId
        }));
        const filteredRows = applyDerivedFilters(enrichedRows, {
            overdueOnly,
            priorityFilter,
            assigneeFilter,
            currentAdminId: normalizeText(user?.id, 120),
            currentAdminEmail: normalizeText(user?.email, 255)
        });
        const pagination = ticketCollection.paged
            ? (ticketCollection.pagination || buildPagination(filteredRows.length, page, pageSize))
            : buildPagination(filteredRows.length, page, pageSize);
        const currentRows = ticketCollection.paged
            ? filteredRows
            : filteredRows.slice(pagination.start, pagination.end);

        return sendJson(res, 200, {
            success: true,
            filters: {
                status: statusFilter,
                query,
                overdueOnly,
                priority: priorityFilter,
                assignee: assigneeFilter
            },
            templateConfig: {
                reply_templates: Array.isArray(runtimeTicketsConfig?.reply_templates)
                    ? runtimeTicketsConfig.reply_templates
                    : null
            },
            rows: currentRows,
            pagination: {
                page: pagination.page,
                pageSize: pagination.pageSize,
                totalItems: pagination.totalItems,
                totalPages: pagination.totalPages,
                hasPrevPage: pagination.hasPrevPage,
                hasNextPage: pagination.hasNextPage,
                returnedItems: pagination.returnedItems
            }
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load tickets'
        });
    }
};
module.exports.normalizeText = normalizeText;
module.exports.normalizeTicketStatus = normalizeTicketStatus;
module.exports.getTicketStatusLabel = getTicketStatusLabel;
module.exports.isMissingRelationError = isMissingRelationError;
module.exports.getIssueTypeLabel = getIssueTypeLabel;
module.exports.formatWaitLabel = formatWaitLabel;
module.exports.loadProfilesByIds = loadProfilesByIds;
module.exports.loadOrdersByIds = loadOrdersByIds;
module.exports.loadTicketAssignmentMap = loadTicketAssignmentMap;
module.exports.inferTicketSourceMeta = inferTicketSourceMeta;
module.exports.buildTicketTimingMeta = buildTicketTimingMeta;
module.exports.buildRefundMeta = buildRefundMeta;
module.exports.buildPriorityMeta = buildPriorityMeta;
module.exports.enrichTicketRow = enrichTicketRow;
