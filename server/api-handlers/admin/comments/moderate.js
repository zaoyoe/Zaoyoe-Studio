const {
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const { notifyUsers } = require('../../../../api/_lib/admin-notifications');
const {
    applyCommentsSiteFilter,
    collectDescendantCommentIds,
    uniqueIds
} = require('./shared');
const {
    COMMENT_WORKFLOW_NOTES_TABLE,
    COMMENT_WORKFLOW_TABLE,
    COMMENT_WORKFLOW_TICKETS_TABLE,
    isMissingCommentWorkflowSchemaError
} = require('./_workflow');

function normalizeCommentItems(input) {
    const items = Array.isArray(input?.items)
        ? input.items
        : (input?.id ? [input] : []);

    return items
        .map(item => ({
            id: String(item?.id || '').trim(),
            type: String(item?.type || '').trim().toLowerCase(),
            recordType: String(item?.recordType || item?.record_type || '').trim().toLowerCase()
        }))
        .filter(item => item.id && (item.type === 'guestbook' || item.type === 'gallery'));
}

function normalizeText(value, maxLength = 200) {
    return String(value || '').trim().slice(0, maxLength);
}

function collapsePreview(value, maxLength = 80) {
    const normalized = normalizeText(value, maxLength * 2).replace(/\s+/g, ' ');
    if (!normalized) return '';
    return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…` : normalized;
}

function buildPromptActionUrl(promptId = '', commentId = '') {
    const normalizedPromptId = normalizeText(promptId, 160);
    if (!normalizedPromptId) return '/prompts.html';
    const params = new URLSearchParams({ id: normalizedPromptId, comments: '1' });
    if (commentId) {
        params.set('commentId', normalizeText(commentId, 160));
    }
    return `/prompts.html?${params.toString()}`;
}

function buildGuestbookActionUrl(messageId = '', commentId = '') {
    const params = new URLSearchParams();
    if (messageId) {
        params.set('messageId', normalizeText(messageId, 160));
    }
    if (commentId) {
        params.set('commentId', normalizeText(commentId, 160));
    }
    const serialized = params.toString();
    return serialized ? `/guestbook.html?${serialized}` : '/guestbook.html';
}

function buildContentModeratedCopy({ site = 'cn', targetLabel = '', preview = '', reason = '' } = {}) {
    const normalizedReason = collapsePreview(reason, 72);
    if (site === 'intl') {
        const lines = [`Your ${targetLabel || 'content'} was removed.`];
        if (normalizedReason) {
            lines.push(`Reason: ${normalizedReason}`);
        } else {
            lines.push('It did not meet the community guidelines.');
        }
        if (preview) {
            lines.push(`Content: ${preview}`);
        }
        return {
            title: 'Your content was removed',
            content: lines.join(' ')
        };
    }

    const lines = [`你发布的${targetLabel || '内容'}已被移除。`];
    if (normalizedReason) {
        lines.push(`原因：${normalizedReason}`);
    } else {
        lines.push('请留意社区规范。');
    }
    if (preview) {
        lines.push(`内容：${preview}`);
    }
    return {
        title: '你发布的内容已被移除',
        content: lines.join(' ')
    };
}

function buildContentFeaturedCopy({ site = 'cn', preview = '' } = {}) {
    if (site === 'intl') {
        return {
            title: 'Your comment was featured',
            content: preview
                ? `Your comment was featured: ${preview}`
                : 'Your comment was featured and may help more users.'
        };
    }

    return {
        title: '你的评论被设为精选',
        content: preview
            ? `你的评论被设为精选：${preview}`
            : '你的评论被设为精选，可能会帮助到更多用户。'
    };
}

async function fetchGuestbookMessagesByIds(supabase, site, messageIds) {
    const normalizedIds = uniqueIds(messageIds);
    if (!normalizedIds.length) return [];

    const { data, error } = await applyCommentsSiteFilter(
        supabase
            .from('guestbook_messages')
            .select('id, user_id, content, site')
            .in('id', normalizedIds),
        site
    );

    if (error) throw error;
    return data || [];
}

async function fetchGuestbookMessageIds(supabase, site, messageIds) {
    const normalizedIds = uniqueIds(messageIds);
    if (!normalizedIds.length) return [];

    const { data, error } = await applyCommentsSiteFilter(
        supabase
            .from('guestbook_messages')
            .select('id')
            .in('id', normalizedIds),
        site
    );

    if (error) throw error;
    return (data || []).map(row => row.id).filter(Boolean);
}

async function fetchGuestbookCommentsByIds(supabase, site, commentIds) {
    const normalizedIds = uniqueIds(commentIds);
    if (!normalizedIds.length) return [];

    const { data, error } = await applyCommentsSiteFilter(
        supabase
            .from('guestbook_comments')
            .select('id, message_id, parent_id, user_id, content, site')
            .in('id', normalizedIds),
        site
    );

    if (error) throw error;
    return data || [];
}

async function fetchGuestbookCommentsForMessageIds(supabase, site, messageIds) {
    const normalizedIds = uniqueIds(messageIds);
    if (!normalizedIds.length) return [];

    const { data, error } = await applyCommentsSiteFilter(
        supabase
            .from('guestbook_comments')
            .select('id, message_id, parent_id, user_id, content, site')
            .in('message_id', normalizedIds),
        site
    );

    if (error) throw error;
    return data || [];
}

async function deleteGuestbookLikes(supabase, site, targetType, targetIds) {
    const normalizedIds = uniqueIds(targetIds);
    if (!normalizedIds.length) {
        return;
    }

    const { error } = await applyCommentsSiteFilter(
        supabase
            .from('guestbook_likes')
            .delete()
            .eq('target_type', targetType)
            .in('target_id', normalizedIds),
        site
    );

    if (error) throw error;
}

async function deleteGuestbookItems(supabase, site, { messageIds = [], commentIds = [] }) {
    const selectedMessages = await fetchGuestbookMessagesByIds(supabase, site, messageIds);
    const selectedMessageIds = await fetchGuestbookMessageIds(supabase, site, messageIds);
    const selectedComments = await fetchGuestbookCommentsByIds(supabase, site, commentIds);
    const selectedCommentIds = selectedComments.map(comment => comment.id);
    const relatedMessageIds = uniqueIds([
        ...selectedMessageIds,
        ...selectedComments.map(comment => comment.message_id)
    ]);
    const threadComments = await fetchGuestbookCommentsForMessageIds(supabase, site, relatedMessageIds);
    const descendantCommentIds = collectDescendantCommentIds(threadComments, selectedCommentIds);
    const messageCascadeCommentIds = threadComments
        .filter(comment => selectedMessageIds.includes(comment.message_id))
        .map(comment => comment.id);
    const likeCommentIds = uniqueIds([...descendantCommentIds, ...messageCascadeCommentIds]);
    const deletedCommentIds = uniqueIds([...selectedCommentIds, ...likeCommentIds]);
    const deletedCommentRows = threadComments.filter(comment => deletedCommentIds.includes(comment.id));

    await Promise.all([
        deleteGuestbookLikes(supabase, site, 'message', selectedMessageIds),
        deleteGuestbookLikes(supabase, site, 'comment', likeCommentIds)
    ]);

    if (selectedCommentIds.length) {
        const { error } = await applyCommentsSiteFilter(
            supabase
                .from('guestbook_comments')
                .delete()
                .in('id', selectedCommentIds),
            site
        );

        if (error) throw error;
    }

    if (selectedMessageIds.length) {
        const { error } = await applyCommentsSiteFilter(
            supabase
                .from('guestbook_messages')
                .delete()
                .in('id', selectedMessageIds),
            site
        );

        if (error) throw error;
    }

    return {
        selectedGuestbookMessages: selectedMessageIds.length,
        selectedGuestbookComments: selectedCommentIds.length,
        deletedGuestbookMessages: selectedMessageIds.length,
        deletedGuestbookComments: deletedCommentIds.length,
        cascadeDeletedGuestbookComments: Math.max(0, deletedCommentIds.length - selectedCommentIds.length),
        cleanedGuestbookLikes: selectedMessageIds.length + likeCommentIds.length,
        deletedGuestbookMessageIds: selectedMessageIds,
        deletedGuestbookCommentIds: deletedCommentIds,
        deletedGuestbookMessageRows: selectedMessages,
        deletedGuestbookCommentRows: deletedCommentRows
    };
}

async function deleteGalleryItems(supabase, site, galleryIds) {
    const normalizedIds = uniqueIds(galleryIds);
    if (!normalizedIds.length) {
        return {
            deletedGalleryComments: 0,
            deletedGalleryIds: []
        };
    }

    const { data: existingRows, error: lookupError } = await applyCommentsSiteFilter(
        supabase
            .from('prompt_comments')
            .select('id, user_id, prompt_id, content, site, is_pinned')
            .in('id', normalizedIds),
        site
    );

    if (lookupError) throw lookupError;

    const existingIds = (existingRows || []).map(row => row.id).filter(Boolean);
    if (!existingIds.length) {
        return {
            deletedGalleryComments: 0,
            deletedGalleryIds: []
        };
    }

    const { error } = await applyCommentsSiteFilter(
        supabase
            .from('prompt_comments')
            .delete()
            .in('id', existingIds),
        site
    );

    if (error) throw error;

        return {
            deletedGalleryComments: existingIds.length,
            deletedGalleryIds: existingIds,
            deletedGalleryRows: existingRows || []
        };
}

async function fetchPromptTitlesByIds(supabase, promptIds = []) {
    const normalizedIds = uniqueIds(promptIds);
    if (!normalizedIds.length) return {};

    const { data, error } = await supabase
        .from('prompts')
        .select('id, title, title_zh, title_en')
        .in('id', normalizedIds);

    if (error) throw error;

    return (data || []).reduce((acc, row) => {
        acc[row.id] = normalizeText(row.title_zh || row.title || row.title_en, 120);
        return acc;
    }, {});
}

async function notifyModeratedCommentOwners(supabase, site, {
    guestbookMessageRows = [],
    guestbookCommentRows = [],
    galleryRows = [],
    moderationReason = ''
} = {}) {
    const promptTitleMap = await fetchPromptTitlesByIds(
        supabase,
        galleryRows.map((row) => row.prompt_id)
    );
    const notifications = [];

    (guestbookMessageRows || []).forEach((row) => {
        const userId = normalizeText(row?.user_id, 160);
        if (!userId) return;
        const preview = collapsePreview(row?.content, 60);
        const copy = buildContentModeratedCopy({ site, targetLabel: '留言', preview, reason: moderationReason });
        notifications.push({
            userIds: [userId],
            title: copy.title,
            content: copy.content,
            type: 'warning',
            scope: 'user_personal',
            category: 'content_moderated',
            actionLabel: site === 'intl' ? 'View details' : '查看详情',
            actionUrl: buildGuestbookActionUrl(row.id),
            sourceModule: 'comments.moderation',
            sourceEventId: `content_moderated:guestbook_message:${row.id}`,
            metadata: {
                site,
                page_id: 'guestbook',
                event_type: 'content_moderated',
                moderation_reason: normalizeText(moderationReason, 160),
                content_type: 'guestbook_message',
                message_id: row.id
            },
            dedupeWindowMinutes: 0
        });
    });

    (guestbookCommentRows || []).forEach((row) => {
        const userId = normalizeText(row?.user_id, 160);
        if (!userId) return;
        const preview = collapsePreview(row?.content, 60);
        const copy = buildContentModeratedCopy({ site, targetLabel: '留言回复', preview, reason: moderationReason });
        notifications.push({
            userIds: [userId],
            title: copy.title,
            content: copy.content,
            type: 'warning',
            scope: 'user_personal',
            category: 'content_moderated',
            actionLabel: site === 'intl' ? 'View details' : '查看详情',
            actionUrl: buildGuestbookActionUrl(row.message_id, row.id),
            sourceModule: 'comments.moderation',
            sourceEventId: `content_moderated:guestbook_comment:${row.id}`,
            metadata: {
                site,
                page_id: 'guestbook',
                event_type: 'content_moderated',
                moderation_reason: normalizeText(moderationReason, 160),
                content_type: 'guestbook_comment',
                comment_id: row.id,
                message_id: row.message_id
            },
            dedupeWindowMinutes: 0
        });
    });

    (galleryRows || []).forEach((row) => {
        const userId = normalizeText(row?.user_id, 160);
        if (!userId) return;
        const preview = collapsePreview(row?.content, 60);
        const promptTitle = promptTitleMap[row.prompt_id] || '';
        const copy = buildContentModeratedCopy({
            site,
            targetLabel: promptTitle ? `提示词评论《${promptTitle}》` : '提示词评论',
            preview,
            reason: moderationReason
        });
        notifications.push({
            userIds: [userId],
            title: copy.title,
            content: copy.content,
            type: 'warning',
            scope: 'user_personal',
            category: 'content_moderated',
            actionLabel: site === 'intl' ? 'View details' : '查看详情',
            actionUrl: buildPromptActionUrl(row.prompt_id, row.id),
            sourceModule: 'comments.moderation',
            sourceEventId: `content_moderated:prompt_comment:${row.id}`,
            metadata: {
                site,
                page_id: 'prompts',
                event_type: 'content_moderated',
                moderation_reason: normalizeText(moderationReason, 160),
                content_type: 'prompt_comment',
                comment_id: row.id,
                prompt_id: row.prompt_id,
                prompt_title: promptTitle
            },
            dedupeWindowMinutes: 0
        });
    });

    for (const payload of notifications) {
        await notifyUsers(supabase, payload);
    }
}

async function notifyFeaturedCommentOwner(supabase, site, row = {}) {
    const userId = normalizeText(row?.user_id, 160);
    const promptId = normalizeText(row?.prompt_id, 160);
    if (!userId || !promptId) {
        return;
    }

    const promptTitleMap = await fetchPromptTitlesByIds(supabase, [promptId]);
    const promptTitle = promptTitleMap[promptId] || '';
    const preview = collapsePreview(row?.content, 60);
    const copy = buildContentFeaturedCopy({ site, preview });

    await notifyUsers(supabase, {
        userIds: [userId],
        title: copy.title,
        content: promptTitle ? `${copy.content}\n所属提示词：${promptTitle}` : copy.content,
        type: 'success',
        scope: 'user_personal',
        category: 'content_featured',
        actionLabel: site === 'intl' ? 'View comment' : '查看评论',
        actionUrl: buildPromptActionUrl(promptId, row.id),
        sourceModule: 'comments.featured',
        sourceEventId: `content_featured:prompt_comment:${row.id}`,
        metadata: {
            site,
            page_id: 'prompts',
            event_type: 'content_featured',
            content_type: 'prompt_comment',
            comment_id: row.id,
            prompt_id: promptId,
            prompt_title: promptTitle
        },
        dedupeWindowMinutes: 0
    });
}

async function cleanupCommentWorkflowArtifacts(supabase, site, {
    guestbookMessageIds = [],
    guestbookCommentIds = [],
    galleryCommentIds = []
} = {}) {
    const workflowIds = [];
    const workflowRows = [];
    const groups = [
        {
            entityType: 'guestbook_message',
            ids: uniqueIds(guestbookMessageIds)
        },
        {
            entityType: 'guestbook_comment',
            ids: uniqueIds(guestbookCommentIds)
        },
        {
            entityType: 'prompt_comment',
            ids: uniqueIds(galleryCommentIds)
        }
    ].filter((group) => group.ids.length > 0);

    if (!groups.length) {
        return {
            deletedWorkflowRows: 0,
            deletedNoteRows: 0,
            deletedTicketLinkRows: 0
        };
    }

    try {
        for (const group of groups) {
            const { data, error } = await applyCommentsSiteFilter(
                supabase
                    .from(COMMENT_WORKFLOW_TABLE)
                    .select('id')
                    .eq('entity_type', group.entityType)
                    .in('entity_id', group.ids),
                site
            );

            if (error) {
                throw error;
            }

            workflowRows.push(...(data || []));
        }
    } catch (error) {
        if (isMissingCommentWorkflowSchemaError(error)) {
            return {
                deletedWorkflowRows: 0,
                deletedNoteRows: 0,
                deletedTicketLinkRows: 0
            };
        }
        throw error;
    }

    workflowIds.push(...uniqueIds(workflowRows.map((row) => row.id)));
    if (!workflowIds.length) {
        return {
            deletedWorkflowRows: 0,
            deletedNoteRows: 0,
            deletedTicketLinkRows: 0
        };
    }

    const [
        { data: deletedNotes, error: noteError },
        { data: deletedLinks, error: linkError },
        { data: deletedWorkflows, error: workflowError }
    ] = await Promise.all([
        supabase
            .from(COMMENT_WORKFLOW_NOTES_TABLE)
            .delete()
            .in('workflow_id', workflowIds),
        supabase
            .from(COMMENT_WORKFLOW_TICKETS_TABLE)
            .delete()
            .in('workflow_id', workflowIds),
        supabase
            .from(COMMENT_WORKFLOW_TABLE)
            .delete()
            .in('id', workflowIds)
    ]);

    if (noteError) throw noteError;
    if (linkError) throw linkError;
    if (workflowError) throw workflowError;

    return {
        deletedWorkflowRows: Array.isArray(deletedWorkflows) ? deletedWorkflows.length : 0,
        deletedNoteRows: Array.isArray(deletedNotes) ? deletedNotes.length : 0,
        deletedTicketLinkRows: Array.isArray(deletedLinks) ? deletedLinks.length : 0
    };
}

async function toggleGalleryPinStatus(supabase, site, { commentId, promptId, nextPinnedState }) {
    const normalizedCommentId = String(commentId || '').trim();
    const normalizedPromptId = String(promptId || '').trim();

    if (!normalizedCommentId || !normalizedPromptId) {
        const error = new Error('Comment id and prompt id are required for pin moderation');
        error.statusCode = 400;
        throw error;
    }

    if (nextPinnedState) {
        const { error: resetError } = await applyCommentsSiteFilter(
            supabase
                .from('prompt_comments')
                .update({ is_pinned: false })
                .eq('prompt_id', normalizedPromptId)
                .eq('is_pinned', true),
            site
        );

        if (resetError) throw resetError;
    }

    const pinQuery = applyCommentsSiteFilter(
        supabase
            .from('prompt_comments')
            .update({ is_pinned: nextPinnedState })
            .eq('id', normalizedCommentId)
            .eq('prompt_id', normalizedPromptId)
            .select('id, prompt_id, is_pinned, user_id, content, site'),
        site
    );

    const { data, error } = await pinQuery.single();

    if (error) {
        if (error.code === 'PGRST116') {
            const notFoundError = new Error('Comment not found for the selected site');
            notFoundError.statusCode = 404;
            throw notFoundError;
        }
        throw error;
    }

    return data || {
        id: normalizedCommentId,
        prompt_id: normalizedPromptId,
        is_pinned: nextPinnedState
    };
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'content.moderate' });
        const body = await parseJsonBody(req);
        const action = String(body.action || 'delete').trim().toLowerCase();
        const site = requireWritableAdminSite(body.site || req.adminSite, {
            fieldName: 'site'
        });
        const items = normalizeCommentItems(body);
        const moderationReason = normalizeText(body.reason || body.moderationReason || body.deleteReason, 160);

        if (action !== 'delete' && action !== 'delete_many') {
            if (action !== 'toggle_pin') {
                return sendJson(res, 400, { success: false, message: 'Unsupported comments moderation action' });
            }
        }

        if (action === 'toggle_pin') {
            const commentId = String(body.id || body.commentId || '').trim();
            const promptId = String(body.promptId || '').trim();
            const currentStatus = body.currentStatus === true || body.currentStatus === 'true' || body.currentStatus === 1 || body.currentStatus === '1';
            const pinResult = await toggleGalleryPinStatus(supabase, site, {
                commentId,
                promptId,
                nextPinnedState: !currentStatus
            });

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'comments',
                site,
                actionType: 'comments.pin',
                details: {
                    comment_id: pinResult.id,
                    prompt_id: pinResult.prompt_id,
                    is_pinned: pinResult.is_pinned
                }
            });

            if (pinResult.is_pinned) {
                await notifyFeaturedCommentOwner(supabase, site, pinResult);
            }

            return sendJson(res, 200, {
                success: true,
                site,
                comment: pinResult
            });
        }

        if (!items.length) {
            return sendJson(res, 400, { success: false, message: 'No comments selected for moderation' });
        }

        const guestbookMessageIds = items
            .filter(item => item.type === 'guestbook' && item.recordType === 'message')
            .map(item => item.id);
        const guestbookCommentIds = items
            .filter(item => item.type === 'guestbook' && item.recordType !== 'message')
            .map(item => item.id);
        const galleryIds = items
            .filter(item => item.type === 'gallery')
            .map(item => item.id);

        const guestbookResult = await deleteGuestbookItems(supabase, site, {
            messageIds: guestbookMessageIds,
            commentIds: guestbookCommentIds
        });
        const galleryResult = await deleteGalleryItems(supabase, site, galleryIds);
        const workflowCleanup = await cleanupCommentWorkflowArtifacts(supabase, site, {
            guestbookMessageIds: guestbookResult.deletedGuestbookMessageIds,
            guestbookCommentIds: guestbookResult.deletedGuestbookCommentIds,
            galleryCommentIds: galleryResult.deletedGalleryIds
        });
        await notifyModeratedCommentOwners(supabase, site, {
            guestbookMessageRows: guestbookResult.deletedGuestbookMessageRows,
            guestbookCommentRows: guestbookResult.deletedGuestbookCommentRows,
            galleryRows: galleryResult.deletedGalleryRows,
            moderationReason
        });

        const deletedCount =
            guestbookResult.deletedGuestbookMessages
            + guestbookResult.deletedGuestbookComments
            + galleryResult.deletedGalleryComments;
        const selectedCount = items.length;
        const cascadeDeletedCount = Math.max(0, deletedCount - selectedCount);

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            module: 'comments',
            site,
            actionType: 'comments.delete',
            details: {
                selected_guestbook_messages: guestbookResult.selectedGuestbookMessages,
                selected_guestbook_comments: guestbookResult.selectedGuestbookComments,
                deleted_guestbook_messages: guestbookResult.deletedGuestbookMessages,
                deleted_guestbook_comments: guestbookResult.deletedGuestbookComments,
                cascade_deleted_guestbook_comments: guestbookResult.cascadeDeletedGuestbookComments,
                deleted_gallery_comments: galleryResult.deletedGalleryComments,
                moderation_reason: moderationReason,
                cleaned_guestbook_likes: guestbookResult.cleanedGuestbookLikes,
                deleted_workflow_rows: workflowCleanup.deletedWorkflowRows,
                deleted_workflow_notes: workflowCleanup.deletedNoteRows,
                deleted_workflow_ticket_links: workflowCleanup.deletedTicketLinkRows,
                requested_item_count: selectedCount,
                item_ids: items.map(item => item.id).slice(0, 20)
            }
        });

        return sendJson(res, 200, {
            success: true,
            site,
            deletedCount,
            selectedCount,
            cascadeDeletedCount,
            summary: {
                guestbookMessages: guestbookResult.deletedGuestbookMessages,
                guestbookComments: guestbookResult.deletedGuestbookComments,
                galleryComments: galleryResult.deletedGalleryComments,
                workflowRows: workflowCleanup.deletedWorkflowRows
            }
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Comments moderation failed'
        });
    }
};
