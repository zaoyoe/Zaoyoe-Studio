const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    buildDefaultCommentWorkflow,
    fetchCommentWorkflowNotes,
    fetchCommentWorkflowRow,
    fetchCommentWorkflowTicketLinks,
    fetchProfilesByIds,
    fetchTicketsByIds,
    insertCommentWorkflowNote,
    insertCommentWorkflowTicketLink,
    isMissingCommentWorkflowSchemaError,
    normalizeCommentEntityType,
    normalizeCommentWorkflowPriority,
    normalizeCommentWorkflowStatus,
    normalizeCommentWorkflowTags,
    sanitizeCommentWorkflowText,
    shapeCommentWorkflowRow,
    upsertCommentWorkflowRow
} = require('./_workflow');

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeWorkflowAction(value) {
    const normalized = sanitizeCommentWorkflowText(value, 40).toLowerCase();
    return [
        'set_status',
        'set_priority',
        'set_tags',
        'assign_self',
        'add_note',
        'create_ticket'
    ].includes(normalized)
        ? normalized
        : '';
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        sanitizeCommentWorkflowText(value, 160)
    );
}

function buildViewerLabel(user = {}) {
    return sanitizeCommentWorkflowText(user?.email || user?.id, 255) || 'unknown';
}

function buildCommentSnapshot(body = {}) {
    const input = body && typeof body === 'object' && !Array.isArray(body)
        ? (body.comment && typeof body.comment === 'object' && !Array.isArray(body.comment) ? body.comment : body)
        : {};

    return {
        id: sanitizeCommentWorkflowText(input.id || input.comment_id || input.commentId, 160),
        site: sanitizeCommentWorkflowText(input.site || body.site || 'all', 20).toLowerCase() || 'all',
        type: sanitizeCommentWorkflowText(input.type, 40).toLowerCase(),
        entity_type: normalizeCommentEntityType(input.entity_type || input.entityType || body.entityType),
        entity_label: sanitizeCommentWorkflowText(input.entity_label || input.entityLabel, 80),
        record_type: sanitizeCommentWorkflowText(input.record_type || input.recordType, 40).toLowerCase(),
        user_id: sanitizeCommentWorkflowText(input.user_id || input.userId, 160),
        author: sanitizeCommentWorkflowText(input.author, 255),
        content: sanitizeCommentWorkflowText(input.content, 1600),
        context_title: sanitizeCommentWorkflowText(input.context_title || input.contextTitle, 240),
        prompt_title: sanitizeCommentWorkflowText(input.prompt_title || input.promptTitle, 240),
        message_id: sanitizeCommentWorkflowText(input.message_id || input.messageId, 160),
        prompt_id: sanitizeCommentWorkflowText(input.prompt_id || input.promptId, 160),
        parent_snippet: sanitizeCommentWorkflowText(input.parent_snippet || input.parentSnippet, 500),
        root_snippet: sanitizeCommentWorkflowText(input.root_snippet || input.rootSnippet, 500)
    };
}

function buildCommentTicketDescription(comment = {}, actorLabel = '') {
    const sourceLabel = comment.type === 'gallery' ? '画廊评论' : '留言板';
    const normalizedView = comment.type === 'gallery' ? 'gallery' : 'guestbook';
    const lines = ['[评论管理转工单]'];

    if (comment.entity_label) {
        lines.push(`评论类型：${comment.entity_label}`);
    } else {
        lines.push(`评论来源：${sourceLabel}`);
    }

    lines.push(`评论视图：${normalizedView}`);

    if (comment.entity_type) {
        lines.push(`实体类型：${comment.entity_type}`);
    }

    if (comment.id) {
        lines.push(`评论ID：${comment.id}`);
    }

    if (comment.prompt_id) {
        lines.push(`Prompt ID：${comment.prompt_id}`);
    }

    if (comment.message_id) {
        lines.push(`留言主贴 ID：${comment.message_id}`);
    }

    if (comment.context_title || comment.prompt_title) {
        lines.push(`上下文：${comment.context_title || comment.prompt_title}`);
    }

    if (comment.author) {
        lines.push(`评论作者：${comment.author}`);
    }

    if (comment.parent_snippet) {
        lines.push(`上级内容：${comment.parent_snippet}`);
    }

    if (comment.root_snippet) {
        lines.push(`线程主文：${comment.root_snippet}`);
    }

    if (comment.site) {
        lines.push(`站点：${comment.site}`);
    }

    if (actorLabel) {
        lines.push(`升级管理员：${actorLabel}`);
    }

    if (comment.content) {
        lines.push('评论内容：');
        lines.push(comment.content);
    }

    return sanitizeCommentWorkflowText(lines.join('\n'), 1800);
}

async function buildWorkflowDetailPayload(supabase, workflowRow, viewer = {}) {
    const assigneeMap = await fetchProfilesByIds(supabase, [workflowRow?.assignee_id].filter(Boolean));
    const workflow = workflowRow
        ? shapeCommentWorkflowRow(workflowRow, assigneeMap)
        : buildDefaultCommentWorkflow({
            site: '',
            entityType: '',
            entityId: ''
        });
    const notes = workflowRow?.id
        ? await fetchCommentWorkflowNotes(supabase, workflowRow.id)
        : [];
    const ticketLinks = workflowRow?.id
        ? await fetchCommentWorkflowTicketLinks(supabase, workflowRow.id)
        : [];
    const tickets = await fetchTicketsByIds(
        supabase,
        ticketLinks.map((link) => link.ticket_id)
    );

    return {
        workflow,
        notes,
        ticket_links: ticketLinks,
        tickets,
        viewer: {
            admin_id: sanitizeCommentWorkflowText(viewer?.id, 160),
            admin_label: buildViewerLabel(viewer)
        }
    };
}

async function ensureWorkflowBaseRow(supabase, existingRow, {
    site,
    entityType,
    entityId,
    user
} = {}) {
    if (existingRow?.id) {
        return existingRow;
    }

    return upsertCommentWorkflowRow(supabase, {
        site,
        entity_type: entityType,
        entity_id: entityId,
        status: 'pending',
        priority: 'normal',
        assignee_id: sanitizeCommentWorkflowText(user?.id, 160) || null,
        assignee_label: buildViewerLabel(user),
        tags: [],
        note_count: 0,
        linked_ticket_count: 0,
        linked_ticket_ids: []
    });
}

module.exports = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        if (req.method === 'GET') {
            const { supabase, user } = await requireAdmin(req, { permission: 'content.moderate' });
            const searchParams = getQueryParams(req);
            const site = sanitizeCommentWorkflowText(searchParams.get('site') || req.adminSite || 'all', 20).toLowerCase() || 'all';
            const entityType = normalizeCommentEntityType(searchParams.get('entityType') || searchParams.get('entity_type'));
            const entityId = sanitizeCommentWorkflowText(searchParams.get('entityId') || searchParams.get('entity_id'), 160);

            if (!entityType || !entityId) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'entityType and entityId are required'
                });
            }

            const workflowRow = await fetchCommentWorkflowRow(supabase, {
                site,
                entityType,
                entityId
            });
            const detail = await buildWorkflowDetailPayload(supabase, workflowRow, user);
            if (!detail.workflow.exists) {
                detail.workflow = buildDefaultCommentWorkflow({
                    site,
                    entityType,
                    entityId
                });
            }

            return sendJson(res, 200, {
                success: true,
                site,
                entityType,
                entityId,
                ...detail
            });
        }

        const body = await parseJsonBody(req);
        const action = normalizeWorkflowAction(body.action);
        const permission = action === 'create_ticket' ? 'tickets.manage' : 'content.moderate';
        const { supabase, user } = await requireAdmin(req, { permission });
        const site = sanitizeCommentWorkflowText(body.site || req.adminSite || 'all', 20).toLowerCase() || 'all';
        const entityType = normalizeCommentEntityType(body.entityType || body.entity_type);
        const entityId = sanitizeCommentWorkflowText(body.entityId || body.entity_id, 160);

        if (!action) {
            return sendJson(res, 400, { success: false, message: 'Unsupported workflow action' });
        }

        if (!entityType || !entityId) {
            return sendJson(res, 400, {
                success: false,
                message: 'entityType and entityId are required'
            });
        }

        let existingRow = await fetchCommentWorkflowRow(supabase, {
            site,
            entityType,
            entityId
        });

        if (action === 'set_status' || action === 'set_priority' || action === 'set_tags' || action === 'assign_self') {
            const currentWorkflow = existingRow
                ? shapeCommentWorkflowRow(existingRow)
                : buildDefaultCommentWorkflow({ site, entityType, entityId });
            const nextPayload = {
                site,
                entity_type: entityType,
                entity_id: entityId,
                status: currentWorkflow.status,
                priority: currentWorkflow.priority,
                assignee_id: currentWorkflow.assignee_id || null,
                assignee_label: currentWorkflow.assignee_label || null,
                tags: currentWorkflow.tags,
                note_count: currentWorkflow.note_count,
                linked_ticket_count: currentWorkflow.linked_ticket_count,
                linked_ticket_ids: currentWorkflow.linked_ticket_ids,
                metadata: currentWorkflow.metadata,
                resolved_at: currentWorkflow.resolved_at
            };

            if (action === 'set_status') {
                nextPayload.status = normalizeCommentWorkflowStatus(body.status);
                nextPayload.resolved_at = nextPayload.status === 'resolved'
                    ? new Date().toISOString()
                    : null;
            } else if (action === 'set_priority') {
                nextPayload.priority = normalizeCommentWorkflowPriority(body.priority);
            } else if (action === 'set_tags') {
                nextPayload.tags = normalizeCommentWorkflowTags(body.tags);
            } else if (action === 'assign_self') {
                nextPayload.assignee_id = sanitizeCommentWorkflowText(user?.id, 160) || null;
                nextPayload.assignee_label = buildViewerLabel(user);
            }

            existingRow = await upsertCommentWorkflowRow(supabase, nextPayload);

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'comments',
                site,
                actionType: 'comments.workflow.update',
                details: {
                    entity_type: entityType,
                    entity_id: entityId,
                    action,
                    status: nextPayload.status,
                    priority: nextPayload.priority,
                    tags: nextPayload.tags,
                    assignee_id: nextPayload.assignee_id || null
                }
            });
        } else if (action === 'add_note') {
            const baseRow = await ensureWorkflowBaseRow(supabase, existingRow, {
                site,
                entityType,
                entityId,
                user
            });
            const noteText = sanitizeCommentWorkflowText(body.note, 2000);
            if (!noteText) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'note is required'
                });
            }

            await insertCommentWorkflowNote(supabase, {
                workflow_id: baseRow.id,
                note: noteText,
                admin_id: sanitizeCommentWorkflowText(user?.id, 160),
                admin_label: buildViewerLabel(user)
            });

            const currentWorkflow = shapeCommentWorkflowRow(baseRow);
            existingRow = await upsertCommentWorkflowRow(supabase, {
                site,
                entity_type: entityType,
                entity_id: entityId,
                status: currentWorkflow.status,
                priority: currentWorkflow.priority,
                assignee_id: currentWorkflow.assignee_id || null,
                assignee_label: currentWorkflow.assignee_label || null,
                tags: currentWorkflow.tags,
                note_count: currentWorkflow.note_count + 1,
                linked_ticket_count: currentWorkflow.linked_ticket_count,
                linked_ticket_ids: currentWorkflow.linked_ticket_ids,
                metadata: currentWorkflow.metadata,
                resolved_at: currentWorkflow.resolved_at
            });

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'comments',
                site,
                actionType: 'comments.workflow.note',
                details: {
                    entity_type: entityType,
                    entity_id: entityId,
                    note_preview: noteText.slice(0, 120)
                }
            });
        } else if (action === 'create_ticket') {
            const comment = buildCommentSnapshot(body);
            if (!comment.user_id) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'comment.user_id is required to create a ticket'
                });
            }

            const baseRow = await ensureWorkflowBaseRow(supabase, existingRow, {
                site,
                entityType,
                entityId,
                user
            });
            const currentWorkflow = shapeCommentWorkflowRow(baseRow);
            const dedupeEnabled = body.dedupe !== false;

            if (dedupeEnabled && currentWorkflow.linked_ticket_ids.length > 0) {
                const existingTickets = await fetchTicketsByIds(supabase, currentWorkflow.linked_ticket_ids);
                const detail = await buildWorkflowDetailPayload(supabase, baseRow, user);
                return sendJson(res, 200, {
                    success: true,
                    site,
                    entityType,
                    entityId,
                    message: '当前评论已有关联工单，未重复创建',
                    ticket: existingTickets[0] || null,
                    ticket_id: existingTickets[0]?.id || null,
                    ...detail
                });
            }

            const description = buildCommentTicketDescription(comment, buildViewerLabel(user));
            const insertPayload = {
                user_id: comment.user_id,
                issue_type: 'OTHER',
                status: 'PENDING',
                description
            };

            if (isUuid(body.orderId || body.order_id)) {
                insertPayload.order_id = sanitizeCommentWorkflowText(body.orderId || body.order_id, 160);
            }

            const { data: ticket, error: ticketError } = await supabase
                .from('shop_tickets')
                .insert(insertPayload)
                .select('id, user_id, order_id, issue_type, status, description, created_at, updated_at')
                .single();

            if (ticketError || !ticket) {
                return sendJson(res, 400, {
                    success: false,
                    message: ticketError?.message || '工单创建失败'
                });
            }

            await insertCommentWorkflowTicketLink(supabase, {
                workflow_id: baseRow.id,
                ticket_id: ticket.id,
                site,
                entity_type: entityType,
                entity_id: entityId,
                created_by: sanitizeCommentWorkflowText(user?.id, 160),
                metadata: {
                    comment_id: comment.id || entityId,
                    record_type: comment.record_type || '',
                    prompt_id: comment.prompt_id || null,
                    message_id: comment.message_id || null
                }
            });

            existingRow = await upsertCommentWorkflowRow(supabase, {
                site,
                entity_type: entityType,
                entity_id: entityId,
                status: 'escalated',
                priority: currentWorkflow.priority === 'high' ? 'high' : 'high',
                assignee_id: currentWorkflow.assignee_id || sanitizeCommentWorkflowText(user?.id, 160) || null,
                assignee_label: currentWorkflow.assignee_label || buildViewerLabel(user),
                tags: normalizeCommentWorkflowTags([
                    ...(Array.isArray(currentWorkflow.tags) ? currentWorkflow.tags : []),
                    'ticketed'
                ]),
                note_count: currentWorkflow.note_count,
                linked_ticket_count: currentWorkflow.linked_ticket_count + 1,
                linked_ticket_ids: [
                    ...(Array.isArray(currentWorkflow.linked_ticket_ids) ? currentWorkflow.linked_ticket_ids : []),
                    ticket.id
                ],
                metadata: currentWorkflow.metadata,
                resolved_at: null
            });

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                targetUserId: ticket.user_id,
                module: 'comments',
                site,
                actionType: 'comments.ticket.create',
                details: {
                    entity_type: entityType,
                    entity_id: entityId,
                    ticket_id: ticket.id,
                    comment_id: comment.id || entityId
                }
            });

            const detail = await buildWorkflowDetailPayload(supabase, existingRow, user);
            return sendJson(res, 200, {
                success: true,
                site,
                entityType,
                entityId,
                message: '已从评论治理创建售后工单',
                ticket,
                ticket_id: ticket.id,
                ...detail
            });
        }

        const detail = await buildWorkflowDetailPayload(supabase, existingRow, user);
        return sendJson(res, 200, {
            success: true,
            site,
            entityType,
            entityId,
            ...detail
        });
    } catch (error) {
        const statusCode = isMissingCommentWorkflowSchemaError(error)
            ? 412
            : (error.statusCode || 500);
        const message = isMissingCommentWorkflowSchemaError(error)
            ? '评论治理 workflow 表尚未就绪，请先执行本次 P0 提供的 SQL 迁移'
            : (error.message || 'Comments workflow request failed');

        return sendJson(res, statusCode, {
            success: false,
            message
        });
    }
};
