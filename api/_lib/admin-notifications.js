function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeNotificationScope(scope = 'unspecified') {
    const normalized = normalizeText(scope).toLowerCase();
    if (['unspecified', 'user_personal', 'admin_personal'].includes(normalized)) {
        return normalized;
    }
    return 'unspecified';
}

function normalizeNotificationCategory(category = 'general') {
    const normalized = normalizeText(category).toLowerCase();
    return normalized || 'general';
}

function normalizeNotificationType(type = 'info') {
    const normalized = normalizeText(type).toLowerCase();
    if (['info', 'warning', 'success', 'alert'].includes(normalized)) {
        return normalized;
    }
    return 'info';
}

function isMissingNotificationColumnError(error) {
    const message = normalizeText(error?.message).toLowerCase();
    return error?.code === '42703'
        || error?.code === '42P01'
        || (message.includes('column') && message.includes('does not exist'))
        || (message.includes('schema cache') && (
            message.includes('scope')
            || message.includes('category')
            || message.includes('action_url')
            || message.includes('action_label')
            || message.includes('metadata')
            || message.includes('priority')
            || message.includes('expires_at')
            || message.includes('dedupe_key')
            || message.includes('source_module')
            || message.includes('source_event_id')
        ));
}

function isRoleActive(role = {}, nowMs = Date.now()) {
    const roleName = normalizeText(role.role_name).toLowerCase();
    if (!['admin', 'super_admin'].includes(roleName)) {
        return false;
    }

    const expiresAt = normalizeText(role.expires_at);
    if (!expiresAt) {
        return true;
    }

    const expiresMs = new Date(expiresAt).getTime();
    return Number.isFinite(expiresMs) && expiresMs > nowMs;
}

async function listActiveAdminUserIds(supabase) {
    if (!supabase) {
        return [];
    }

    const { data, error } = await supabase
        .from('admin_roles')
        .select('user_id, role_name, expires_at');

    if (error) {
        throw error;
    }

    const nowMs = Date.now();
    return Array.from(new Set(
        (data || [])
            .filter((role) => isRoleActive(role, nowMs))
            .map((role) => normalizeText(role.user_id))
            .filter(Boolean)
    ));
}

async function filterActiveAdminUserIds(supabase, userIds = []) {
    const normalizedUserIds = Array.from(new Set(
        (userIds || [])
            .map((userId) => normalizeText(userId))
            .filter(Boolean)
    ));

    if (!normalizedUserIds.length) {
        return [];
    }

    const activeAdminUserIds = new Set(await listActiveAdminUserIds(supabase));
    return normalizedUserIds.filter((userId) => activeAdminUserIds.has(userId));
}

async function hasRecentMatchingNotification(supabase, {
    userId,
    title,
    content,
    scope = 'unspecified',
    category = 'general',
    dedupeWindowMinutes = 30
}) {
    const normalizedUserId = normalizeText(userId);
    const normalizedTitle = normalizeText(title);
    const normalizedContent = normalizeText(content);
    const normalizedScope = normalizeNotificationScope(scope);
    const normalizedCategory = normalizeNotificationCategory(category);

    if (!normalizedUserId || !normalizedTitle || !normalizedContent || !(dedupeWindowMinutes > 0)) {
        return false;
    }

    const sinceIso = new Date(Date.now() - dedupeWindowMinutes * 60 * 1000).toISOString();
    let response = await supabase
        .from('system_notifications')
        .select('id, title, content, created_at, scope, category')
        .eq('user_id', normalizedUserId)
        .eq('title', normalizedTitle)
        .eq('scope', normalizedScope)
        .eq('category', normalizedCategory)
        .gte('created_at', sinceIso);

    if (response.error && isMissingNotificationColumnError(response.error)) {
        response = await supabase
            .from('system_notifications')
            .select('id, title, content, created_at')
            .eq('user_id', normalizedUserId)
            .eq('title', normalizedTitle)
            .gte('created_at', sinceIso);
    }

    const { data, error } = response;

    if (error) {
        throw error;
    }

    return (data || []).some((row) => normalizeText(row.content) === normalizedContent);
}

async function insertNotificationWithFallback(supabase, payload = {}) {
    const response = await supabase
        .from('system_notifications')
        .insert(payload);

    if (!response.error || !isMissingNotificationColumnError(response.error)) {
        return response;
    }

    const legacyPayload = { ...payload };
    delete legacyPayload.scope;
    delete legacyPayload.category;
    delete legacyPayload.action_url;
    delete legacyPayload.action_label;
    delete legacyPayload.metadata;
    delete legacyPayload.priority;
    delete legacyPayload.expires_at;
    delete legacyPayload.dedupe_key;
    delete legacyPayload.source_module;
    delete legacyPayload.source_event_id;

    return supabase
        .from('system_notifications')
        .insert(legacyPayload);
}

async function notifyUsers(supabase, {
    userIds = [],
    title,
    content,
    type = 'info',
    scope = 'user_personal',
    category = 'general',
    actionUrl = '',
    actionLabel = '',
    metadata = {},
    priority = 0,
    expiresAt = '',
    dedupeKey = '',
    sourceModule = '',
    sourceEventId = '',
    dedupeWindowMinutes = 30
}) {
    if (!supabase) {
        return {
            recipients: 0,
            created: 0,
            skipped: 0
        };
    }

    const normalizedTitle = normalizeText(title);
    const normalizedContent = normalizeText(content);
    if (!normalizedTitle || !normalizedContent) {
        return {
            recipients: 0,
            created: 0,
            skipped: 0
        };
    }

    const normalizedUserIds = Array.from(new Set(
        (userIds || [])
            .map((userId) => normalizeText(userId))
            .filter(Boolean)
    ));
    const notificationType = normalizeNotificationType(type);
    const notificationScope = normalizeNotificationScope(scope);
    const notificationCategory = normalizeNotificationCategory(category);
    const recipientUserIds = notificationScope === 'admin_personal'
        ? await filterActiveAdminUserIds(supabase, normalizedUserIds)
        : normalizedUserIds;
    let created = 0;
    let skipped = normalizedUserIds.length - recipientUserIds.length;

    for (const userId of recipientUserIds) {
        const exists = await hasRecentMatchingNotification(supabase, {
            userId,
            title: normalizedTitle,
            content: normalizedContent,
            scope: notificationScope,
            category: notificationCategory,
            dedupeWindowMinutes
        });
        if (exists) {
            skipped += 1;
            continue;
        }

        const { error } = await insertNotificationWithFallback(supabase, {
            user_id: userId,
            title: normalizedTitle,
            content: normalizedContent,
            type: notificationType,
            is_read: false,
            scope: notificationScope,
            category: notificationCategory,
            action_url: normalizeText(actionUrl) || null,
            action_label: normalizeText(actionLabel) || null,
            metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
            priority: Number(priority || 0) || 0,
            expires_at: normalizeText(expiresAt) || null,
            dedupe_key: normalizeText(dedupeKey) || null,
            source_module: normalizeText(sourceModule) || notificationCategory,
            source_event_id: normalizeText(sourceEventId) || ''
        });

        if (error) {
            throw error;
        }

        created += 1;
    }

    return {
        recipients: normalizedUserIds.length,
        created,
        skipped
    };
}

async function notifyActiveAdmins(supabase, payload = {}) {
    const adminUserIds = await listActiveAdminUserIds(supabase);
    if (!adminUserIds.length) {
        return {
            recipients: 0,
            created: 0,
            skipped: 0
        };
    }

    return notifyUsers(supabase, {
        ...payload,
        scope: payload.scope || 'admin_personal',
        category: payload.category || 'admin_notice',
        userIds: adminUserIds
    });
}

module.exports = {
    filterActiveAdminUserIds,
    listActiveAdminUserIds,
    notifyActiveAdmins,
    notifyUsers
};
