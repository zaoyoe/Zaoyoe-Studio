function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeNotificationType(type = 'info') {
    const normalized = normalizeText(type).toLowerCase();
    if (['info', 'warning', 'success', 'alert'].includes(normalized)) {
        return normalized;
    }
    return 'info';
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

async function hasRecentMatchingNotification(supabase, {
    userId,
    title,
    content,
    dedupeWindowMinutes = 30
}) {
    const normalizedUserId = normalizeText(userId);
    const normalizedTitle = normalizeText(title);
    const normalizedContent = normalizeText(content);

    if (!normalizedUserId || !normalizedTitle || !normalizedContent || !(dedupeWindowMinutes > 0)) {
        return false;
    }

    const sinceIso = new Date(Date.now() - dedupeWindowMinutes * 60 * 1000).toISOString();
    const { data, error } = await supabase
        .from('system_notifications')
        .select('id, title, content, created_at')
        .eq('user_id', normalizedUserId)
        .eq('title', normalizedTitle)
        .gte('created_at', sinceIso);

    if (error) {
        throw error;
    }

    return (data || []).some((row) => normalizeText(row.content) === normalizedContent);
}

async function notifyUsers(supabase, {
    userIds = [],
    title,
    content,
    type = 'info',
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
    let created = 0;
    let skipped = 0;

    for (const userId of normalizedUserIds) {
        const exists = await hasRecentMatchingNotification(supabase, {
            userId,
            title: normalizedTitle,
            content: normalizedContent,
            dedupeWindowMinutes
        });
        if (exists) {
            skipped += 1;
            continue;
        }

        const { error } = await supabase
            .from('system_notifications')
            .insert({
                user_id: userId,
                title: normalizedTitle,
                content: normalizedContent,
                type: notificationType,
                is_read: false
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
        userIds: adminUserIds
    });
}

module.exports = {
    listActiveAdminUserIds,
    notifyActiveAdmins,
    notifyUsers
};
