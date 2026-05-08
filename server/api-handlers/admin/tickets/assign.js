const adminHelpers = require('../../../../api/_lib/admin');
const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = adminHelpers;

function normalizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
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

function normalizeTicketAdminSite(value, defaultValue = 'all') {
    if (typeof adminHelpers.normalizeAdminSite === 'function') {
        return adminHelpers.normalizeAdminSite(value, { defaultValue }) || defaultValue;
    }
    const normalized = String(value || '').trim().toLowerCase();
    return ['all', 'cn', 'intl'].includes(normalized) ? normalized : defaultValue;
}

async function fetchAuditRows(supabase, tableName = 'admin_audit_logs_view', selection = 'id, action_type, details, created_at, admin_id, admin_email') {
    const { data, error } = await supabase
        .from(tableName)
        .select(selection)
        .in('action_type', ['ticket.assign'])
        .order('created_at', { ascending: false })
        .limit(500);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function loadCurrentAssignmentMap(supabase, ticketIds = []) {
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

        const assigneeId = normalizeText(details.assignee_id, 120);
        const assigneeLabel = normalizeText(details.assignee_label, 255);
        const assigned = details.assigned !== false && (assigneeId || assigneeLabel);
        assignmentByTicketId.set(ticketId, {
            assigned_to_id: assigned ? assigneeId : '',
            assigned_to_label: assigned ? assigneeLabel : ''
        });
    });

    return assignmentByTicketId;
}

function normalizeTicketIds(ticketIds = []) {
    return Array.from(new Set(
        (Array.isArray(ticketIds) ? ticketIds : [])
            .map((ticketId) => normalizeText(ticketId, 120))
            .filter(Boolean)
    )).slice(0, 50);
}

module.exports = async function adminTicketsAssignHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'tickets.manage' });
        const body = await parseJsonBody(req);
        const ticketIds = normalizeTicketIds(body.ticketIds);
        const operation = normalizeText(body.operation, 40).toLowerCase();
        const adminSite = normalizeTicketAdminSite(body.site || req.adminSite, 'all');

        if (!ticketIds.length) {
            return sendJson(res, 400, {
                success: false,
                message: 'ticketIds is required'
            });
        }

        if (!['assign_self', 'clear'].includes(operation)) {
            return sendJson(res, 400, {
                success: false,
                message: 'Unsupported assignment operation'
            });
        }

        let ticketQuery = supabase
            .from('shop_tickets')
            .select('id, user_id, order_id, status')
            .in('id', ticketIds);
        if (adminSite !== 'all') {
            ticketQuery = ticketQuery.eq('site', adminSite);
        }

        const { data: tickets, error: ticketError } = await ticketQuery;

        if (ticketError) {
            throw ticketError;
        }

        const rows = Array.isArray(tickets) ? tickets : [];
        const pendingTickets = rows.filter((ticket) => normalizeText(ticket?.status, 40).toUpperCase() === 'PENDING' || normalizeText(ticket?.status, 40).toUpperCase() === 'OPEN');
        if (!pendingTickets.length) {
            return sendJson(res, 200, {
                success: true,
                changedCount: 0,
                skippedCount: ticketIds.length,
                ticketIds: [],
                assignment: {
                    assigned_to_id: '',
                    assigned_to_label: ''
                }
            });
        }

        const currentAssignments = await loadCurrentAssignmentMap(supabase, pendingTickets.map((ticket) => ticket.id));
        const nextAssigneeId = operation === 'assign_self' ? normalizeText(user?.id, 120) : '';
        const nextAssigneeLabel = operation === 'assign_self'
            ? (normalizeText(user?.email, 255) || normalizeText(user?.id, 120))
            : '';

        const changedTickets = pendingTickets.filter((ticket) => {
            const currentAssignment = currentAssignments.get(normalizeText(ticket?.id, 120)) || {};
            const currentAssigneeId = normalizeText(currentAssignment.assigned_to_id, 120);
            const currentAssigneeLabel = normalizeText(currentAssignment.assigned_to_label, 255);

            if (operation === 'assign_self') {
                return currentAssigneeId !== nextAssigneeId || currentAssigneeLabel !== nextAssigneeLabel;
            }

            return Boolean(currentAssigneeId || currentAssigneeLabel);
        });

        for (const ticket of changedTickets) {
            const ticketId = normalizeText(ticket?.id, 120);
            const currentAssignment = currentAssignments.get(ticketId) || {};
            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                targetUserId: normalizeText(ticket?.user_id, 120) || null,
                actionType: 'ticket.assign',
                details: {
                    ticket_id: ticketId,
                    order_id: normalizeText(ticket?.order_id, 120) || null,
                    site: adminSite === 'all' ? null : adminSite,
                    operation,
                    assigned: operation === 'assign_self',
                    assignee_id: nextAssigneeId || null,
                    assignee_label: nextAssigneeLabel || null,
                    previous_assignee_id: normalizeText(currentAssignment.assigned_to_id, 120) || null,
                    previous_assignee_label: normalizeText(currentAssignment.assigned_to_label, 255) || null,
                    ticket_status: normalizeText(ticket?.status, 40).toUpperCase() || null
                }
            });
        }

        return sendJson(res, 200, {
            success: true,
            changedCount: changedTickets.length,
            skippedCount: ticketIds.length - changedTickets.length,
            ticketIds: changedTickets.map((ticket) => normalizeText(ticket?.id, 120)),
            assignment: {
                assigned_to_id: nextAssigneeId,
                assigned_to_label: nextAssigneeLabel
            }
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to assign tickets'
        });
    }
};
