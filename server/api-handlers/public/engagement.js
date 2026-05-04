function createPublicEngagementHandlers({
    admin
} = {}) {
    const {
        notifyUsers
    } = require('../../../api/_lib/admin-notifications');
    const {
        getOptionalSupabaseAdmin,
        parseJsonBody,
        requireAuthenticatedUser,
        sendJson
    } = admin || {};

    const PAGE_ALIASES = Object.freeze({
        index: 'home',
        homepage: 'home',
        '/': 'home',
        gallery: 'prompts',
        prompt: 'prompts',
        gongyi: 'gongyi',
        shop: 'shop',
        verify: 'verify',
        guestbook: 'guestbook'
    });
    const VALID_PAGES = Object.freeze(new Set(['home', 'prompts', 'gongyi', 'shop', 'verify', 'guestbook']));
    const VALID_EVENTS = Object.freeze(new Set(['view', 'click', 'dismiss', 'conversion']));
    const VALID_REPLY_SOURCES = Object.freeze(new Set(['prompt_comment', 'guestbook_comment']));

    function sanitizeText(value, maxLength = 4000) {
        return String(value || '').trim().slice(0, Math.max(0, maxLength));
    }

    function normalizeSite(value = 'cn') {
        const normalized = sanitizeText(value, 20).toLowerCase();
        return normalized === 'intl' ? 'intl' : 'cn';
    }

    function normalizePageId(value = '') {
        const raw = sanitizeText(value, 80).toLowerCase()
            .replace(/\.html$/i, '')
            .replace(/^\/+|\/+$/g, '');
        const aliased = PAGE_ALIASES[raw] || raw;
        return VALID_PAGES.has(aliased) ? aliased : 'home';
    }

    function normalizeStringArray(value) {
        const source = Array.isArray(value) ? value : (value ? [value] : []);
        return [...new Set(source.map((item) => sanitizeText(item, 80).toLowerCase()).filter(Boolean))];
    }

    function normalizeMetadata(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function createHttpError(message, statusCode = 400) {
        const error = new Error(message);
        error.statusCode = statusCode;
        return error;
    }

    function getRequestValue(body = {}, ...keys) {
        for (const key of keys) {
            const value = body?.[key];
            const normalized = sanitizeText(value, 240);
            if (normalized) return normalized;
        }
        return '';
    }

    function collapsePreview(value, maxLength = 120) {
        return sanitizeText(value, maxLength).replace(/\s+/g, ' ');
    }

    function buildInternalUrl(pathname = '/', params = {}) {
        const query = new URLSearchParams();
        Object.entries(params || {}).forEach(([key, value]) => {
            const normalized = sanitizeText(value, 240);
            if (normalized) query.set(key, normalized);
        });
        const queryText = query.toString();
        return queryText ? `${pathname}?${queryText}` : pathname;
    }

    function buildReplyCopy({ site, targetType, pageId, preview, promptTitle }) {
        const english = site === 'intl';
        if (pageId === 'prompts') {
            return {
                title: english ? 'Your comment has a new reply' : '你的评论收到了新回复',
                content: preview
                    ? (english
                        ? `New reply${promptTitle ? ` on ${promptTitle}` : ''}: ${preview}`
                        : `${promptTitle ? `「${promptTitle}」` : '你的 Prompt 评论'}有新回复：${preview}`)
                    : (english ? 'Open the Prompt page to view the latest reply.' : '打开提示词页面查看最新回复。')
            };
        }

        if (targetType === 'message') {
            return {
                title: english ? 'Your guestbook post has a new comment' : '你的留言收到了新评论',
                content: preview
                    ? (english ? `New comment: ${preview}` : `新评论：${preview}`)
                    : (english ? 'Open the guestbook to view the latest comment.' : '打开留言板查看最新评论。')
            };
        }

        return {
            title: english ? 'Your guestbook comment has a new reply' : '你的评论收到了新回复',
            content: preview
                ? (english ? `New reply: ${preview}` : `新回复：${preview}`)
                : (english ? 'Open the guestbook to view the latest reply.' : '打开留言板查看最新回复。')
        };
    }

    function isMissingRelationOrColumnError(error, relationName = '') {
        const text = [
            error?.code,
            error?.message,
            error?.details,
            error?.hint
        ].filter(Boolean).join(' ').toLowerCase();
        const relation = sanitizeText(relationName).toLowerCase();
        return error?.code === '42P01'
            || error?.code === '42703'
            || error?.code === 'PGRST205'
            || text.includes('schema cache')
            || (relation && text.includes(relation));
    }

    async function getOptionalUser(req) {
        if (typeof requireAuthenticatedUser !== 'function') {
            return null;
        }
        try {
            const result = await requireAuthenticatedUser(req);
            return result?.user || null;
        } catch (error) {
            const status = Number(error?.statusCode || error?.status || 0);
            if (status === 401 || status === 403 || error?.code === 'auth_session_missing') {
                return null;
            }
            return null;
        }
    }

    async function loadRowById(supabase, tableName, selectFields, rowId) {
        const id = sanitizeText(rowId, 160);
        if (!id) return null;

        const { data, error } = await supabase
            .from(tableName)
            .select(selectFields)
            .eq('id', id)
            .maybeSingle();

        if (error) {
            if (isMissingRelationOrColumnError(error, tableName)) {
                return null;
            }
            throw error;
        }

        return data || null;
    }

    async function hasExistingSourceNotification(supabase, { userId, sourceModule, sourceEventId, dedupeKey }) {
        const normalizedUserId = sanitizeText(userId, 160);
        const normalizedSourceModule = sanitizeText(sourceModule, 80);
        const normalizedSourceEventId = sanitizeText(sourceEventId, 160);
        const normalizedDedupeKey = sanitizeText(dedupeKey, 180);
        if (!normalizedUserId || (!normalizedSourceEventId && !normalizedDedupeKey)) {
            return false;
        }

        let query = supabase
            .from('system_notifications')
            .select('id')
            .eq('user_id', normalizedUserId)
            .limit(1);

        if (normalizedSourceEventId) {
            query = query
                .eq('source_module', normalizedSourceModule || 'engagement')
                .eq('source_event_id', normalizedSourceEventId);
        } else {
            query = query.eq('dedupe_key', normalizedDedupeKey);
        }

        const { data, error } = await query;
        if (error) {
            if (isMissingRelationOrColumnError(error, 'system_notifications')) {
                return false;
            }
            throw error;
        }

        return Array.isArray(data) && data.length > 0;
    }

    function isRuleActive(row = {}, now = new Date()) {
        if (row.enabled !== true || sanitizeText(row.status, 40).toLowerCase() !== 'published') {
            return false;
        }
        if (!sanitizeText(row.title, 240) && !sanitizeText(row.content, 1200)) {
            return false;
        }
        const startsAt = row.starts_at ? new Date(row.starts_at) : null;
        const endsAt = row.ends_at ? new Date(row.ends_at) : null;
        if (startsAt && Number.isFinite(startsAt.getTime()) && startsAt > now) return false;
        if (endsAt && Number.isFinite(endsAt.getTime()) && endsAt <= now) return false;
        return true;
    }

    function ruleMatchesContext(row = {}, { pageId, site }) {
        const rowSite = sanitizeText(row.site || 'all', 20).toLowerCase() || 'all';
        if (rowSite !== 'all' && rowSite !== site) {
            return false;
        }
        const pageIds = normalizeStringArray(row.page_ids);
        return !pageIds.length || pageIds.includes('all') || pageIds.includes(pageId);
    }

    function normalizeRuleBubble(row = {}, context = {}) {
        const metadata = normalizeMetadata(row.metadata);
        return {
            id: sanitizeText(row.id, 160),
            rule_id: sanitizeText(row.id, 160),
            notification_id: '',
            source: 'rule',
            source_module: sanitizeText(row.metadata?.source_module || 'engagement', 80) || 'engagement',
            source_event_id: sanitizeText(row.metadata?.source_event_id, 160),
            title: sanitizeText(row.title || row.name || '小助手提醒', 160) || '小助手提醒',
            content: sanitizeText(row.content, 1200),
            category: sanitizeText(metadata.category || 'engagement', 80) || 'engagement',
            page_id: context.pageId,
            site: context.site,
            priority: Number(row.priority || 0) || 0,
            action_label: sanitizeText(row.action_label, 80),
            action_url: sanitizeText(row.action_url, 1000),
            dismiss_ttl_hours: Math.max(0, Number(row.dismiss_ttl_hours || 24) || 0),
            tone: sanitizeText(row.tone || 'info', 40) || 'info',
            icon: sanitizeText(row.icon || 'robot', 40) || 'robot',
            metadata
        };
    }

    function normalizeNotificationBubble(row = {}, context = {}) {
        const metadata = normalizeMetadata(row.metadata);
        const category = sanitizeText(row.category || metadata.category || 'user_notice', 80) || 'user_notice';
        return {
            id: `notification:${sanitizeText(row.id, 160)}`,
            rule_id: '',
            notification_id: sanitizeText(row.id, 160),
            source: 'notification',
            source_module: sanitizeText(row.source_module || metadata.source_module || category, 80) || category,
            source_event_id: sanitizeText(row.source_event_id || metadata.source_event_id, 160),
            title: sanitizeText(row.title || '小助手提醒', 160) || '小助手提醒',
            content: sanitizeText(row.content, 1200),
            category,
            page_id: sanitizeText(metadata.page_id || context.pageId, 80) || context.pageId,
            site: sanitizeText(metadata.site || context.site, 20) || context.site,
            priority: Number(row.priority || metadata.priority || 20) || 20,
            action_label: sanitizeText(row.action_label || metadata.action_label, 80),
            action_url: sanitizeText(row.action_url || metadata.action_url, 1000),
            dismiss_ttl_hours: Math.max(0, Number(metadata.dismiss_ttl_hours || 24) || 0),
            tone: sanitizeText(row.type || metadata.tone || 'info', 40) || 'info',
            icon: sanitizeText(metadata.icon || 'robot', 40) || 'robot',
            metadata
        };
    }

    async function fetchRuleBubbles(supabase, context) {
        const { data, error } = await supabase
            .from('engagement_rules')
            .select('id,name,description,site,page_ids,placement,trigger_type,audience,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,updated_at')
            .eq('enabled', true)
            .eq('status', 'published')
            .order('priority', { ascending: false })
            .order('updated_at', { ascending: false })
            .limit(50);

        if (error) {
            if (isMissingRelationOrColumnError(error, 'engagement_rules')) {
                return [];
            }
            throw error;
        }

        const now = new Date();
        return (Array.isArray(data) ? data : [])
            .filter((row) => isRuleActive(row, now))
            .filter((row) => ruleMatchesContext(row, context))
            .filter((row) => sanitizeText(row.placement || 'robot_bubble', 80) === 'robot_bubble')
            .map((row) => normalizeRuleBubble(row, context));
    }

    async function fetchNotificationBubbles(supabase, userId, context) {
        if (!userId) return [];

        let response = await supabase
            .from('system_notifications')
            .select('id,title,content,type,scope,category,is_read,created_at,action_url,action_label,metadata,priority,expires_at,dedupe_key,source_module,source_event_id')
            .eq('user_id', userId)
            .eq('is_read', false)
            .neq('scope', 'admin_personal')
            .order('priority', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(20);

        if (response.error && isMissingRelationOrColumnError(response.error, 'system_notifications')) {
            response = await supabase
                .from('system_notifications')
                .select('id,title,content,type,scope,category,is_read,created_at')
                .eq('user_id', userId)
                .eq('is_read', false)
                .order('created_at', { ascending: false })
                .limit(20);
        }

        const { data, error } = response;
        if (error) {
            if (isMissingRelationOrColumnError(error, 'system_notifications')) {
                return [];
            }
            throw error;
        }

        const nowMs = Date.now();
        return (Array.isArray(data) ? data : [])
            .filter((row) => {
                const expiresAt = sanitizeText(row.expires_at, 120);
                if (!expiresAt) return true;
                const expiresMs = new Date(expiresAt).getTime();
                return !Number.isFinite(expiresMs) || expiresMs > nowMs;
            })
            .map((row) => normalizeNotificationBubble(row, context));
    }

    async function resolvePromptReplyNotification(supabase, actorUserId, body = {}) {
        const commentId = getRequestValue(body, 'comment_id', 'commentId');
        if (!commentId) {
            throw createHttpError('comment_id is required', 400);
        }

        const child = await loadRowById(
            supabase,
            'prompt_comments',
            'id,user_id,parent_id,prompt_id,content,site',
            commentId
        );

        if (!child) {
            return {
                skipped: 'comment_not_found'
            };
        }

        if (sanitizeText(child.user_id, 160) !== actorUserId) {
            throw createHttpError('Cannot notify for another user reply', 403);
        }

        const parentId = sanitizeText(child.parent_id, 160);
        const requestedParentId = getRequestValue(body, 'parent_id', 'parentId');
        if (!parentId) {
            return {
                skipped: 'not_a_reply'
            };
        }
        if (requestedParentId && requestedParentId !== parentId) {
            throw createHttpError('parent_id does not match the stored comment', 400);
        }

        const parent = await loadRowById(
            supabase,
            'prompt_comments',
            'id,user_id,parent_id,prompt_id,content,site',
            parentId
        );
        const recipientId = sanitizeText(parent?.user_id, 160);
        if (!recipientId) {
            return {
                skipped: 'parent_not_found'
            };
        }
        if (recipientId === actorUserId) {
            return {
                skipped: 'self_reply'
            };
        }

        const site = normalizeSite(child.site || parent?.site || body.site || 'cn');
        const promptId = sanitizeText(child.prompt_id || parent?.prompt_id || body.prompt_id || body.promptId, 160);
        const promptTitle = sanitizeText(body.prompt_title || body.promptTitle, 120);
        const preview = collapsePreview(child.content || body.content_preview || body.content, 120);
        const copy = buildReplyCopy({
            site,
            pageId: 'prompts',
            targetType: 'comment',
            preview,
            promptTitle
        });
        const sourceEventId = `prompt_comment_reply:${commentId}`;

        return {
            recipientId,
            title: copy.title,
            content: copy.content,
            category: 'comment_replied',
            actionLabel: site === 'intl' ? 'View reply' : '查看回复',
            actionUrl: buildInternalUrl('/prompts.html', {
                id: promptId,
                comments: '1',
                commentId
            }),
            priority: 55,
            sourceModule: 'comments',
            sourceEventId,
            dedupeKey: sourceEventId,
            metadata: {
                page_id: 'prompts',
                site,
                event_type: 'comment_replied',
                source: 'prompt_comment',
                comment_id: commentId,
                parent_id: parentId,
                prompt_id: promptId,
                prompt_title: promptTitle
            }
        };
    }

    async function resolveGuestbookReplyNotification(supabase, actorUserId, body = {}) {
        const commentId = getRequestValue(body, 'comment_id', 'commentId');
        if (!commentId) {
            throw createHttpError('comment_id is required', 400);
        }

        const child = await loadRowById(
            supabase,
            'guestbook_comments',
            'id,user_id,parent_id,message_id,content,site',
            commentId
        );

        if (!child) {
            return {
                skipped: 'comment_not_found'
            };
        }

        if (sanitizeText(child.user_id, 160) !== actorUserId) {
            throw createHttpError('Cannot notify for another user reply', 403);
        }

        const parentId = sanitizeText(child.parent_id, 160);
        const requestedParentId = getRequestValue(body, 'parent_id', 'parentId');
        if (requestedParentId && requestedParentId !== parentId) {
            throw createHttpError('parent_id does not match the stored comment', 400);
        }

        const messageId = sanitizeText(child.message_id || body.message_id || body.messageId, 160);
        if (!messageId) {
            return {
                skipped: 'message_not_found'
            };
        }

        let recipientId = '';
        let targetType = 'message';
        if (parentId) {
            targetType = 'comment';
            const parent = await loadRowById(
                supabase,
                'guestbook_comments',
                'id,user_id,parent_id,message_id,content,site',
                parentId
            );
            recipientId = sanitizeText(parent?.user_id, 160);
        } else {
            const message = await loadRowById(
                supabase,
                'guestbook_messages',
                'id,user_id,content,site',
                messageId
            );
            recipientId = sanitizeText(message?.user_id, 160);
        }

        if (!recipientId) {
            return {
                skipped: targetType === 'comment' ? 'parent_not_found' : 'message_not_found'
            };
        }
        if (recipientId === actorUserId) {
            return {
                skipped: 'self_reply'
            };
        }

        const site = normalizeSite(child.site || body.site || 'cn');
        const preview = collapsePreview(child.content || body.content_preview || body.content, 120);
        const eventType = targetType === 'message' ? 'message_replied' : 'comment_replied';
        const copy = buildReplyCopy({
            site,
            pageId: 'guestbook',
            targetType,
            preview
        });
        const sourceEventId = targetType === 'message'
            ? `guestbook_message_reply:${commentId}`
            : `guestbook_comment_reply:${commentId}`;

        return {
            recipientId,
            title: copy.title,
            content: copy.content,
            category: eventType,
            actionLabel: site === 'intl' ? 'View reply' : '查看回复',
            actionUrl: buildInternalUrl('/guestbook.html', {
                messageId,
                commentId
            }),
            priority: targetType === 'message' ? 50 : 55,
            sourceModule: 'guestbook',
            sourceEventId,
            dedupeKey: sourceEventId,
            metadata: {
                page_id: 'guestbook',
                site,
                event_type: eventType,
                source: 'guestbook_comment',
                target_type: targetType,
                comment_id: commentId,
                parent_id: parentId,
                message_id: messageId
            }
        };
    }

    async function replyNotifyHandler(req, res) {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        if (typeof requireAuthenticatedUser !== 'function') {
            return sendJson(res, 503, {
                success: false,
                message: 'Engagement notification service is unavailable'
            });
        }

        try {
            const auth = await requireAuthenticatedUser(req);
            const actorUserId = sanitizeText(auth?.user?.id, 160);
            if (!actorUserId) {
                throw createHttpError('Unauthorized', 401);
            }

            const supabase = auth?.adminSupabase
                || (typeof getOptionalSupabaseAdmin === 'function' ? getOptionalSupabaseAdmin() : null)
                || auth?.supabase;

            if (!supabase?.from) {
                return sendJson(res, 503, {
                    success: false,
                    message: 'Engagement notification service is unavailable'
                });
            }

            const body = typeof parseJsonBody === 'function' ? await parseJsonBody(req) : (req.body || {});
            const source = sanitizeText(body.source || body.source_type, 80).toLowerCase();
            if (!VALID_REPLY_SOURCES.has(source)) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'Invalid reply notification source'
                });
            }

            const notification = source === 'prompt_comment'
                ? await resolvePromptReplyNotification(supabase, actorUserId, body)
                : await resolveGuestbookReplyNotification(supabase, actorUserId, body);

            if (notification?.skipped) {
                return sendJson(res, 200, {
                    success: true,
                    created: 0,
                    skipped: notification.skipped
                });
            }

            const exists = await hasExistingSourceNotification(supabase, notification);
            if (exists) {
                return sendJson(res, 200, {
                    success: true,
                    created: 0,
                    skipped: 'duplicate'
                });
            }

            const result = await notifyUsers(supabase, {
                userIds: [notification.recipientId],
                title: notification.title,
                content: notification.content,
                type: 'info',
                scope: 'user_personal',
                category: notification.category,
                actionUrl: notification.actionUrl,
                actionLabel: notification.actionLabel,
                metadata: notification.metadata,
                priority: notification.priority,
                dedupeKey: notification.dedupeKey,
                sourceModule: notification.sourceModule,
                sourceEventId: notification.sourceEventId,
                dedupeWindowMinutes: 0
            });

            return sendJson(res, 200, {
                success: true,
                created: result?.created || 0,
                skipped: result?.skipped || 0
            });
        } catch (error) {
            const statusCode = Number(error?.statusCode || error?.status || 500);
            return sendJson(res, statusCode, {
                success: false,
                message: error?.message || 'Failed to create reply notification'
            });
        }
    }

    async function feedHandler(req, res) {
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const supabase = typeof getOptionalSupabaseAdmin === 'function'
            ? getOptionalSupabaseAdmin()
            : null;

        if (!supabase) {
            return sendJson(res, 503, {
                success: false,
                message: 'Engagement feed is unavailable'
            });
        }

        const url = new URL(req.url || '/api/public/engagement/feed', 'http://localhost');
        const context = {
            pageId: normalizePageId(url.searchParams.get('page_id') || url.searchParams.get('page')),
            site: normalizeSite(url.searchParams.get('site') || 'cn'),
            readerKey: sanitizeText(url.searchParams.get('reader_key'), 160)
        };
        const user = await getOptionalUser(req);
        const userId = sanitizeText(user?.id, 160);

        const [rules, notifications] = await Promise.all([
            fetchRuleBubbles(supabase, context),
            fetchNotificationBubbles(supabase, userId, context)
        ]);

        const items = [...notifications, ...rules]
            .sort((left, right) => {
                const priorityDelta = Number(right.priority || 0) - Number(left.priority || 0);
                if (priorityDelta) return priorityDelta;
                return String(right.id || '').localeCompare(String(left.id || ''));
            })
            .slice(0, Math.max(1, Math.min(10, Number(url.searchParams.get('limit') || 5) || 5)));

        res.setHeader('Cache-Control', 'no-store');
        return sendJson(res, 200, {
            success: true,
            page_id: context.pageId,
            site: context.site,
            user_id: userId || null,
            items
        });
    }

    async function eventHandler(req, res) {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const supabase = typeof getOptionalSupabaseAdmin === 'function'
            ? getOptionalSupabaseAdmin()
            : null;

        if (!supabase) {
            return sendJson(res, 202, {
                success: true,
                recorded: false
            });
        }

        const body = typeof parseJsonBody === 'function' ? await parseJsonBody(req) : (req.body || {});
        const eventType = sanitizeText(body.event_type || body.type, 40).toLowerCase();
        if (!VALID_EVENTS.has(eventType)) {
            return sendJson(res, 400, {
                success: false,
                message: 'Invalid engagement event'
            });
        }

        const user = await getOptionalUser(req);
        const userId = sanitizeText(user?.id, 160) || null;
        const ruleId = sanitizeText(body.rule_id, 160) || null;
        const notificationId = sanitizeText(body.notification_id, 160) || null;
        const pageId = normalizePageId(body.page_id || body.page);
        const site = normalizeSite(body.site || 'cn');
        const readerKey = sanitizeText(body.reader_key, 160);
        const metadata = normalizeMetadata(body.metadata);

        let recorded = false;
        try {
            const { error } = await supabase
                .from('engagement_events')
                .insert({
                    rule_id: ruleId,
                    notification_id: notificationId,
                    user_id: userId,
                    reader_key: readerKey,
                    page_id: pageId,
                    site,
                    event_type: eventType,
                    source_module: sanitizeText(body.source_module || metadata.source_module || 'engagement', 80) || 'engagement',
                    source_event_id: sanitizeText(body.source_event_id || metadata.source_event_id, 160),
                    metadata
                });
            if (error) throw error;
            recorded = true;
        } catch (error) {
            if (!isMissingRelationOrColumnError(error, 'engagement_events')) {
                throw error;
            }
        }

        if (notificationId && ['click', 'dismiss'].includes(eventType)) {
            await supabase
                .from('system_notifications')
                .update({ is_read: true })
                .eq('id', notificationId)
                .eq('user_id', userId || '');
        }

        return sendJson(res, 200, {
            success: true,
            recorded
        });
    }

    return {
        feed: feedHandler,
        event: eventHandler,
        'reply-notify': replyNotifyHandler
    };
}

module.exports = {
    createPublicEngagementHandlers
};
