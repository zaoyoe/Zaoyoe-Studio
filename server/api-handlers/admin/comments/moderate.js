const {
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    applyCommentsSiteFilter,
    collectDescendantCommentIds,
    uniqueIds
} = require('./shared');

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
            .select('id, message_id, parent_id')
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
            .select('id, message_id, parent_id')
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
        deletedGuestbookMessages: selectedMessageIds.length,
        deletedGuestbookComments: selectedCommentIds.length,
        cleanedGuestbookLikes: selectedMessageIds.length + likeCommentIds.length
    };
}

async function deleteGalleryItems(supabase, site, galleryIds) {
    const normalizedIds = uniqueIds(galleryIds);
    if (!normalizedIds.length) {
        return {
            deletedGalleryComments: 0
        };
    }

    const { data: existingRows, error: lookupError } = await applyCommentsSiteFilter(
        supabase
            .from('prompt_comments')
            .select('id')
            .in('id', normalizedIds),
        site
    );

    if (lookupError) throw lookupError;

    const existingIds = (existingRows || []).map(row => row.id).filter(Boolean);
    if (!existingIds.length) {
        return {
            deletedGalleryComments: 0
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
        deletedGalleryComments: existingIds.length
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
            .select('id, prompt_id, is_pinned'),
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

        const deletedCount =
            guestbookResult.deletedGuestbookMessages
            + guestbookResult.deletedGuestbookComments
            + galleryResult.deletedGalleryComments;

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            module: 'comments',
            site,
            actionType: 'comments.delete',
            details: {
                deleted_guestbook_messages: guestbookResult.deletedGuestbookMessages,
                deleted_guestbook_comments: guestbookResult.deletedGuestbookComments,
                deleted_gallery_comments: galleryResult.deletedGalleryComments,
                cleaned_guestbook_likes: guestbookResult.cleanedGuestbookLikes,
                requested_item_count: items.length,
                item_ids: items.map(item => item.id).slice(0, 20)
            }
        });

        return sendJson(res, 200, {
            success: true,
            site,
            deletedCount,
            summary: {
                guestbookMessages: guestbookResult.deletedGuestbookMessages,
                guestbookComments: guestbookResult.deletedGuestbookComments,
                galleryComments: galleryResult.deletedGalleryComments
            }
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Comments moderation failed'
        });
    }
};
