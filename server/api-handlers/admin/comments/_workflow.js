const COMMENT_WORKFLOW_TABLE = 'admin_comment_workflows';
const COMMENT_WORKFLOW_NOTES_TABLE = 'admin_comment_workflow_notes';
const COMMENT_WORKFLOW_TICKETS_TABLE = 'admin_comment_ticket_links';

const SUPPORTED_COMMENT_ENTITY_TYPES = new Set([
    'guestbook_message',
    'guestbook_comment',
    'prompt_comment'
]);

const SUPPORTED_COMMENT_WORKFLOW_STATUSES = new Set([
    'pending',
    'in_review',
    'escalated',
    'resolved',
    'ignored'
]);

const SUPPORTED_COMMENT_WORKFLOW_PRIORITIES = new Set([
    'low',
    'normal',
    'high'
]);

function sanitizeCommentWorkflowText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeCommentEntityType(value) {
    const normalized = sanitizeCommentWorkflowText(value, 80).toLowerCase();
    return SUPPORTED_COMMENT_ENTITY_TYPES.has(normalized) ? normalized : '';
}

function normalizeCommentWorkflowStatus(value, fallback = 'pending') {
    const normalized = sanitizeCommentWorkflowText(value, 40).toLowerCase();
    return SUPPORTED_COMMENT_WORKFLOW_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeCommentWorkflowPriority(value, fallback = 'normal') {
    const normalized = sanitizeCommentWorkflowText(value, 20).toLowerCase();
    return SUPPORTED_COMMENT_WORKFLOW_PRIORITIES.has(normalized) ? normalized : fallback;
}

function normalizeCommentWorkflowTags(value, maxItems = 8) {
    const values = Array.isArray(value)
        ? value
        : String(value || '')
            .split(',')
            .map((item) => item.trim());

    return Array.from(new Set(
        values
            .map((item) => sanitizeCommentWorkflowText(item, 30).toLowerCase())
            .filter(Boolean)
    )).slice(0, Math.max(0, maxItems));
}

function uniqueValues(values = []) {
    return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function buildCommentWorkflowEntityKey(site, entityType, entityId) {
    return [
        sanitizeCommentWorkflowText(site || 'all', 20).toLowerCase() || 'all',
        normalizeCommentEntityType(entityType) || 'unknown',
        sanitizeCommentWorkflowText(entityId, 160)
    ].join('::');
}

function buildDefaultCommentWorkflow({
    site = 'all',
    entityType = '',
    entityId = ''
} = {}) {
    return {
        exists: false,
        site: sanitizeCommentWorkflowText(site || 'all', 20).toLowerCase() || 'all',
        entity_type: normalizeCommentEntityType(entityType),
        entity_id: sanitizeCommentWorkflowText(entityId, 160),
        status: 'pending',
        priority: 'normal',
        assignee_id: '',
        assignee_label: '',
        tags: [],
        note_count: 0,
        linked_ticket_count: 0,
        linked_ticket_ids: [],
        resolved_at: null,
        updated_at: null,
        last_activity_at: null,
        metadata: {}
    };
}

function isMissingCommentWorkflowSchemaError(error) {
    const message = sanitizeCommentWorkflowText(error?.message || error?.details || '', 500).toLowerCase();
    if (!message) {
        return false;
    }

    return [
        COMMENT_WORKFLOW_TABLE,
        COMMENT_WORKFLOW_NOTES_TABLE,
        COMMENT_WORKFLOW_TICKETS_TABLE
    ].some((tableName) => message.includes(tableName));
}

function shapeCommentWorkflowRow(row, assigneeMap = new Map()) {
    const site = sanitizeCommentWorkflowText(row?.site || 'all', 20).toLowerCase() || 'all';
    const entityType = normalizeCommentEntityType(row?.entity_type);
    const entityId = sanitizeCommentWorkflowText(row?.entity_id, 160);
    const assigneeId = sanitizeCommentWorkflowText(row?.assignee_id, 160);
    const assignee = assigneeMap.get(assigneeId) || null;
    const linkedTicketIds = uniqueValues(row?.linked_ticket_ids);

    return {
        exists: true,
        site,
        entity_type: entityType,
        entity_id: entityId,
        status: normalizeCommentWorkflowStatus(row?.status),
        priority: normalizeCommentWorkflowPriority(row?.priority),
        assignee_id: assigneeId,
        assignee_label: sanitizeCommentWorkflowText(
            row?.assignee_label
            || assignee?.email
            || assignee?.username
            || assignee?.id,
            255
        ),
        tags: normalizeCommentWorkflowTags(row?.tags),
        note_count: Math.max(0, Number.parseInt(row?.note_count, 10) || 0),
        linked_ticket_count: Math.max(
            0,
            Number.parseInt(row?.linked_ticket_count, 10) || linkedTicketIds.length || 0
        ),
        linked_ticket_ids: linkedTicketIds,
        resolved_at: row?.resolved_at || null,
        updated_at: row?.updated_at || null,
        last_activity_at: row?.last_activity_at || null,
        metadata: row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? row.metadata
            : {}
    };
}

async function fetchProfilesByIds(supabase, ids = []) {
    const normalizedIds = uniqueValues(ids.map((id) => sanitizeCommentWorkflowText(id, 160)));
    if (!normalizedIds.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('profiles')
        .select('id, username, email')
        .in('id', normalizedIds);

    if (error) {
        throw error;
    }

    return new Map(
        (data || [])
            .filter((row) => row?.id)
            .map((row) => [row.id, row])
    );
}

async function fetchCommentWorkflowMap(supabase, comments = []) {
    const normalizedComments = Array.isArray(comments) ? comments : [];
    if (!normalizedComments.length) {
        return new Map();
    }

    const entityIds = uniqueValues(
        normalizedComments.map((comment) => sanitizeCommentWorkflowText(comment?.id, 160))
    );
    if (!entityIds.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from(COMMENT_WORKFLOW_TABLE)
        .select('site, entity_type, entity_id, status, priority, assignee_id, assignee_label, tags, note_count, linked_ticket_count, linked_ticket_ids, resolved_at, updated_at, last_activity_at, metadata')
        .in('entity_id', entityIds);

    if (error) {
        if (isMissingCommentWorkflowSchemaError(error)) {
            return new Map();
        }
        throw error;
    }

    const workflowRows = Array.isArray(data) ? data : [];
    const assigneeMap = await fetchProfilesByIds(
        supabase,
        workflowRows.map((row) => row?.assignee_id)
    );

    return workflowRows.reduce((acc, row) => {
        const workflow = shapeCommentWorkflowRow(row, assigneeMap);
        if (!workflow.entity_type || !workflow.entity_id) {
            return acc;
        }
        acc.set(
            buildCommentWorkflowEntityKey(workflow.site, workflow.entity_type, workflow.entity_id),
            workflow
        );
        return acc;
    }, new Map());
}

async function fetchCommentWorkflowRow(supabase, { site, entityType, entityId } = {}) {
    const normalizedSite = sanitizeCommentWorkflowText(site || 'all', 20).toLowerCase() || 'all';
    const normalizedEntityType = normalizeCommentEntityType(entityType);
    const normalizedEntityId = sanitizeCommentWorkflowText(entityId, 160);

    if (!normalizedEntityType || !normalizedEntityId) {
        return null;
    }

    const query = supabase
        .from(COMMENT_WORKFLOW_TABLE)
        .select('id, site, entity_type, entity_id, status, priority, assignee_id, assignee_label, tags, note_count, linked_ticket_count, linked_ticket_ids, resolved_at, updated_at, last_activity_at, metadata, created_at')
        .eq('entity_type', normalizedEntityType)
        .eq('entity_id', normalizedEntityId)
        .eq('site', normalizedSite);

    const { data, error } = typeof query.maybeSingle === 'function'
        ? await query.maybeSingle()
        : await query.single();

    if (error) {
        if (error.code === 'PGRST116') {
            return null;
        }
        if (isMissingCommentWorkflowSchemaError(error)) {
            return null;
        }
        throw error;
    }

    return data || null;
}

async function upsertCommentWorkflowRow(supabase, payload = {}) {
    const normalizedPayload = {
        site: sanitizeCommentWorkflowText(payload.site || 'all', 20).toLowerCase() || 'all',
        entity_type: normalizeCommentEntityType(payload.entity_type),
        entity_id: sanitizeCommentWorkflowText(payload.entity_id, 160),
        status: normalizeCommentWorkflowStatus(payload.status),
        priority: normalizeCommentWorkflowPriority(payload.priority),
        assignee_id: sanitizeCommentWorkflowText(payload.assignee_id, 160) || null,
        assignee_label: sanitizeCommentWorkflowText(payload.assignee_label, 255) || null,
        tags: normalizeCommentWorkflowTags(payload.tags),
        note_count: Math.max(0, Number.parseInt(payload.note_count, 10) || 0),
        linked_ticket_count: Math.max(0, Number.parseInt(payload.linked_ticket_count, 10) || 0),
        linked_ticket_ids: uniqueValues(payload.linked_ticket_ids || []),
        resolved_at: payload.resolved_at || null,
        last_activity_at: payload.last_activity_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
            ? payload.metadata
            : {}
    };

    if (!normalizedPayload.entity_type || !normalizedPayload.entity_id) {
        const error = new Error('Missing workflow entity reference');
        error.statusCode = 400;
        throw error;
    }

    const { data, error } = await supabase
        .from(COMMENT_WORKFLOW_TABLE)
        .upsert(normalizedPayload, {
            onConflict: 'site,entity_type,entity_id'
        })
        .select('id, site, entity_type, entity_id, status, priority, assignee_id, assignee_label, tags, note_count, linked_ticket_count, linked_ticket_ids, resolved_at, updated_at, last_activity_at, metadata, created_at')
        .single();

    if (error) {
        throw error;
    }

    return data || normalizedPayload;
}

async function fetchCommentWorkflowNotes(supabase, workflowId, limit = 20) {
    const normalizedWorkflowId = sanitizeCommentWorkflowText(workflowId, 160);
    if (!normalizedWorkflowId) {
        return [];
    }

    const { data, error } = await supabase
        .from(COMMENT_WORKFLOW_NOTES_TABLE)
        .select('id, workflow_id, note, admin_id, admin_label, created_at, metadata')
        .eq('workflow_id', normalizedWorkflowId)
        .order('created_at', { ascending: false })
        .limit(Math.max(1, Math.min(Number.parseInt(limit, 10) || 20, 50)));

    if (error) {
        if (isMissingCommentWorkflowSchemaError(error)) {
            return [];
        }
        throw error;
    }

    return (data || []).map((row) => ({
        id: sanitizeCommentWorkflowText(row?.id, 160),
        workflow_id: sanitizeCommentWorkflowText(row?.workflow_id, 160),
        note: sanitizeCommentWorkflowText(row?.note, 2000),
        admin_id: sanitizeCommentWorkflowText(row?.admin_id, 160),
        admin_label: sanitizeCommentWorkflowText(row?.admin_label, 255),
        created_at: row?.created_at || null,
        metadata: row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? row.metadata
            : {}
    }));
}

async function insertCommentWorkflowNote(supabase, payload = {}) {
    const workflowId = sanitizeCommentWorkflowText(payload.workflow_id, 160);
    const note = sanitizeCommentWorkflowText(payload.note, 2000);
    if (!workflowId || !note) {
        const error = new Error('Workflow note is required');
        error.statusCode = 400;
        throw error;
    }

    const insertPayload = {
        workflow_id: workflowId,
        note,
        admin_id: sanitizeCommentWorkflowText(payload.admin_id, 160) || null,
        admin_label: sanitizeCommentWorkflowText(payload.admin_label, 255) || null,
        metadata: payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
            ? payload.metadata
            : {}
    };

    const { data, error } = await supabase
        .from(COMMENT_WORKFLOW_NOTES_TABLE)
        .insert(insertPayload)
        .select('id, workflow_id, note, admin_id, admin_label, created_at, metadata')
        .single();

    if (error) {
        throw error;
    }

    return data || insertPayload;
}

async function fetchCommentWorkflowTicketLinks(supabase, workflowId) {
    const normalizedWorkflowId = sanitizeCommentWorkflowText(workflowId, 160);
    if (!normalizedWorkflowId) {
        return [];
    }

    const { data, error } = await supabase
        .from(COMMENT_WORKFLOW_TICKETS_TABLE)
        .select('id, workflow_id, ticket_id, created_at, created_by, metadata')
        .eq('workflow_id', normalizedWorkflowId)
        .order('created_at', { ascending: false });

    if (error) {
        if (isMissingCommentWorkflowSchemaError(error)) {
            return [];
        }
        throw error;
    }

    return (data || []).map((row) => ({
        id: sanitizeCommentWorkflowText(row?.id, 160),
        workflow_id: sanitizeCommentWorkflowText(row?.workflow_id, 160),
        ticket_id: sanitizeCommentWorkflowText(row?.ticket_id, 160),
        created_at: row?.created_at || null,
        created_by: sanitizeCommentWorkflowText(row?.created_by, 160),
        metadata: row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? row.metadata
            : {}
    }));
}

async function insertCommentWorkflowTicketLink(supabase, payload = {}) {
    const insertPayload = {
        workflow_id: sanitizeCommentWorkflowText(payload.workflow_id, 160),
        ticket_id: sanitizeCommentWorkflowText(payload.ticket_id, 160),
        site: sanitizeCommentWorkflowText(payload.site || 'all', 20).toLowerCase() || 'all',
        entity_type: normalizeCommentEntityType(payload.entity_type),
        entity_id: sanitizeCommentWorkflowText(payload.entity_id, 160),
        created_by: sanitizeCommentWorkflowText(payload.created_by, 160) || null,
        metadata: payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
            ? payload.metadata
            : {}
    };

    if (!insertPayload.workflow_id || !insertPayload.ticket_id || !insertPayload.entity_type || !insertPayload.entity_id) {
        const error = new Error('Missing comment ticket link reference');
        error.statusCode = 400;
        throw error;
    }

    const { data, error } = await supabase
        .from(COMMENT_WORKFLOW_TICKETS_TABLE)
        .insert(insertPayload)
        .select('id, workflow_id, ticket_id, created_at, created_by, metadata')
        .single();

    if (error) {
        throw error;
    }

    return data || insertPayload;
}

async function fetchTicketsByIds(supabase, ticketIds = []) {
    const normalizedIds = uniqueValues(ticketIds.map((id) => sanitizeCommentWorkflowText(id, 160)));
    if (!normalizedIds.length) {
        return [];
    }

    const { data, error } = await supabase
        .from('shop_tickets')
        .select('id, user_id, order_id, issue_type, status, description, created_at, updated_at')
        .in('id', normalizedIds);

    if (error) {
        throw error;
    }

    const byId = new Map(
        (data || [])
            .filter((row) => row?.id)
            .map((row) => [row.id, row])
    );

    return normalizedIds
        .map((id) => byId.get(id))
        .filter(Boolean);
}

module.exports = {
    COMMENT_WORKFLOW_TABLE,
    COMMENT_WORKFLOW_NOTES_TABLE,
    COMMENT_WORKFLOW_TICKETS_TABLE,
    SUPPORTED_COMMENT_ENTITY_TYPES,
    SUPPORTED_COMMENT_WORKFLOW_STATUSES,
    SUPPORTED_COMMENT_WORKFLOW_PRIORITIES,
    sanitizeCommentWorkflowText,
    normalizeCommentEntityType,
    normalizeCommentWorkflowStatus,
    normalizeCommentWorkflowPriority,
    normalizeCommentWorkflowTags,
    uniqueValues,
    buildCommentWorkflowEntityKey,
    buildDefaultCommentWorkflow,
    isMissingCommentWorkflowSchemaError,
    fetchCommentWorkflowMap,
    fetchCommentWorkflowRow,
    upsertCommentWorkflowRow,
    fetchCommentWorkflowNotes,
    insertCommentWorkflowNote,
    fetchCommentWorkflowTicketLinks,
    insertCommentWorkflowTicketLink,
    fetchTicketsByIds,
    fetchProfilesByIds,
    shapeCommentWorkflowRow
};
