const {
    normalizeAdminSite,
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const { notifyUsers } = require('../../../../api/_lib/admin-notifications');
const {
    assertNoLockedTargets,
    fetchUserProfilesByIds,
    normalizeUserIds,
    sanitizeText,
    uniqueValues
} = require('./_shared');

const SUPPORTED_USER_BLOCK_SCOPES = new Set(['all', 'guestbook', 'gallery', 'points_usage']);

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeBlockScope(value) {
    const normalized = sanitizeText(value, 40).toLowerCase();
    return SUPPORTED_USER_BLOCK_SCOPES.has(normalized) ? normalized : '';
}

function normalizeBlockAction(value) {
    const normalized = sanitizeText(value, 40).toLowerCase();
    if (normalized === 'unban') {
        return 'unblock';
    }
    return normalized === 'block' || normalized === 'unblock'
        ? normalized
        : '';
}

function normalizeBlockDurationDays(value) {
    const normalized = sanitizeText(value, 20).toLowerCase();
    if (!normalized || normalized === 'permanent') {
        return null;
    }

    const days = Number.parseInt(normalized, 10);
    if (!Number.isFinite(days) || days <= 0) {
        return null;
    }

    return Math.min(days, 365);
}

function isActiveBlock(row, now = new Date()) {
    const expiresAt = sanitizeText(row?.expires_at, 80);
    if (!expiresAt) {
        return true;
    }

    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
        return true;
    }

    return expiresAtMs > now.getTime();
}

function buildBlockState(rows = [], now = new Date()) {
    const activeBlocks = (Array.isArray(rows) ? rows : [])
        .filter((row) => SUPPORTED_USER_BLOCK_SCOPES.has(normalizeBlockScope(row?.scope)))
        .filter((row) => isActiveBlock(row, now))
        .map((row) => ({
            user_id: sanitizeText(row?.user_id, 160),
            scope: normalizeBlockScope(row?.scope),
            reason: sanitizeText(row?.reason, 500),
            expires_at: sanitizeText(row?.expires_at, 80) || null
        }));

    activeBlocks.sort((left, right) => {
        const leftScope = left.scope === 'all' ? '0' : left.scope;
        const rightScope = right.scope === 'all' ? '0' : right.scope;
        return leftScope.localeCompare(rightScope);
    });

    const scopeSet = new Set(activeBlocks.map((row) => row.scope));
    const hasGlobalBlock = scopeSet.has('all');

    return {
        blocks: activeBlocks,
        scopes: Array.from(scopeSet),
        hasGlobalBlock,
        isGuestbookBlocked: hasGlobalBlock || scopeSet.has('guestbook'),
        isGalleryBlocked: hasGlobalBlock || scopeSet.has('gallery'),
        isPointsUsageBlocked: hasGlobalBlock || scopeSet.has('points_usage')
    };
}

async function fetchUserBlocks(supabase, userId) {
    const { data, error } = await supabase
        .from('blocked_users')
        .select('user_id, scope, reason, expires_at')
        .eq('user_id', userId);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

function resolveBlockReason(scope, days) {
    const scopeLabel = scope === 'guestbook'
        ? '留言板'
        : (scope === 'gallery' ? '画廊' : (scope === 'points_usage' ? '积分权限' : '全部'));

    if (!days) {
        return `永久封禁 ${scopeLabel} 权限`;
    }

    return `临时封禁 ${scopeLabel} 权限 ${days} 天`;
}

async function writeBlockHistory(supabase, payload) {
    const { error } = await supabase
        .from('block_history')
        .insert(payload);

    if (error) {
        throw error;
    }
}

function buildNotificationContent(scope, days, action) {
    const scopeLabel = scope === 'all'
        ? '全站'
        : (scope === 'guestbook' ? '留言板' : (scope === 'gallery' ? '画廊' : '积分权限'));

    if (action === 'block') {
        return `您已被封禁 [${scopeLabel}] 权限。\n时长：${days ? `${days}天` : '永久'}。\n此期间您将无法使用相关功能。`;
    }

    return `您的 [${scopeLabel}] 封禁已被管理员解除。您可以正常使用了。`;
}

function normalizeBlockItems(body = {}) {
    if (Array.isArray(body.items)) {
        return body.items
            .map((item) => ({
                userId: sanitizeText(item?.userId || item?.user_id, 160),
                scope: normalizeBlockScope(item?.scope),
                action: normalizeBlockAction(item?.action),
                days: normalizeBlockDurationDays(item?.days),
                reason: sanitizeText(item?.reason, 500),
                notifyUser: item?.notifyUser !== false
            }))
            .filter((item) => item.userId && item.scope && item.action);
    }

    const userId = sanitizeText(body.userId || body.user_id, 160);
    const scope = normalizeBlockScope(body.scope);
    const action = normalizeBlockAction(body.action);
    if (!userId || !scope || !action) {
        return [];
    }

    return [{
        userId,
        scope,
        action,
        days: normalizeBlockDurationDays(body.days),
        reason: sanitizeText(body.reason, 500),
        notifyUser: body.notifyUser !== false
    }];
}

async function handleApplySelection({ supabase, user, body, site }) {
    const items = normalizeBlockItems(body);
    if (!items.length) {
        const error = new Error('No valid block mutations were provided');
        error.statusCode = 400;
        throw error;
    }

    const profileMap = await fetchUserProfilesByIds(
        supabase,
        items.map((item) => item.userId)
    );
    assertNoLockedTargets(profileMap, items.map((item) => item.userId));

    const results = [];

    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const reason = item.reason || resolveBlockReason(item.scope, item.days);
        const expiresAt = item.action === 'block' && item.days
            ? new Date(Date.now() + item.days * 24 * 60 * 60 * 1000).toISOString()
            : null;

        if (item.action === 'block') {
            const { error } = await supabase
                .from('blocked_users')
                .upsert({
                    user_id: item.userId,
                    scope: item.scope,
                    reason,
                    admin_id: user.id,
                    expires_at: expiresAt
                }, {
                    onConflict: 'user_id,scope'
                });

            if (error) {
                throw error;
            }

            await writeBlockHistory(supabase, {
                user_id: item.userId,
                action: 'block',
                scope: item.scope,
                reason,
                admin_id: user.id
            });

            if (item.notifyUser) {
                await notifyUsers(supabase, {
                    userIds: [item.userId],
                    title: '账号封禁通知',
                    content: buildNotificationContent(item.scope, item.days, 'block'),
                    type: 'warning',
                    scope: 'user_personal',
                    category: 'admin_notice',
                    dedupeWindowMinutes: 0
                });
            }

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                targetUserId: item.userId,
                module: 'users',
                site,
                actionType: 'BAN_USER',
                details: {
                    scope: item.scope,
                    days: item.days,
                    expires_at: expiresAt,
                    mutation_index: index
                }
            });
        } else {
            const { error } = await supabase
                .from('blocked_users')
                .delete()
                .eq('user_id', item.userId)
                .eq('scope', item.scope);

            if (error) {
                throw error;
            }

            await writeBlockHistory(supabase, {
                user_id: item.userId,
                action: 'unblock',
                scope: item.scope,
                reason: item.reason || '后台手动解封',
                admin_id: user.id
            });

            if (item.notifyUser) {
                await notifyUsers(supabase, {
                    userIds: [item.userId],
                    title: '封禁解除通知',
                    content: buildNotificationContent(item.scope, item.days, 'unblock'),
                    type: 'success',
                    scope: 'user_personal',
                    category: 'admin_notice',
                    dedupeWindowMinutes: 0
                });
            }

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                targetUserId: item.userId,
                module: 'users',
                site,
                actionType: 'UNBAN_USER',
                details: {
                    scope: item.scope,
                    mutation_index: index
                }
            });
        }

        results.push({
            userId: item.userId,
            scope: item.scope,
            action: item.action
        });
    }

    const singleUserId = uniqueValues(results.map((result) => result.userId));
    if (singleUserId.length === 1) {
        const rows = await fetchUserBlocks(supabase, singleUserId[0]);
        return {
            results,
            userId: singleUserId[0],
            ...buildBlockState(rows)
        };
    }

    return {
        results
    };
}

async function handleClearAll({ supabase, user, body, site }) {
    const userIds = normalizeUserIds(body.userIds || body.user_ids, body.userId || body.user_id);
    if (!userIds.length) {
        const error = new Error('At least one userId is required');
        error.statusCode = 400;
        throw error;
    }

    const profileMap = await fetchUserProfilesByIds(supabase, userIds);
    assertNoLockedTargets(profileMap, userIds);

    const { data: existingRows, error: selectError } = await supabase
        .from('blocked_users')
        .select('user_id, scope')
        .in('user_id', userIds);

    if (selectError) {
        throw selectError;
    }

    const { error } = await supabase
        .from('blocked_users')
        .delete()
        .in('user_id', userIds);

    if (error) {
        throw error;
    }

    for (const row of existingRows || []) {
        await writeBlockHistory(supabase, {
            user_id: row.user_id,
            action: 'unblock',
            scope: normalizeBlockScope(row.scope) || 'all',
            reason: '后台批量解封',
            admin_id: user.id
        });
    }

    for (const userId of userIds) {
        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            targetUserId: userId,
            module: 'users',
            site,
            actionType: 'UNBAN_USER',
            details: {
                scope: 'all',
                cleared_all_scopes: true
            }
        });
    }

    return {
        userIds,
        cleared: (existingRows || []).length
    };
}

module.exports = async (req, res) => {
    try {
        if (req.method === 'GET') {
            const { supabase } = await requireAdmin(req, { permission: 'users.manage' });
            const searchParams = getQueryParams(req);
            const userId = sanitizeText(searchParams.get('userId') || searchParams.get('user_id'), 160);
            const site = normalizeAdminSite(searchParams.get('site') || req.adminSite, { defaultValue: 'all' }) || 'all';

            if (!userId) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'userId is required'
                });
            }

            const rows = await fetchUserBlocks(supabase, userId);
            return sendJson(res, 200, {
                success: true,
                site,
                userId,
                ...buildBlockState(rows)
            });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const { supabase, user } = await requireAdmin(req, { permission: 'users.manage' });
        const body = await parseJsonBody(req);
        const action = sanitizeText(body.action, 40).toLowerCase();
        const site = normalizeAdminSite(body.site || req.adminSite, { defaultValue: 'all' }) || 'all';

        let payload;
        if (action === 'apply_selection' || action === 'block' || action === 'unblock' || action === 'unban') {
            payload = await handleApplySelection({ supabase, user, body, site });
        } else if (action === 'clear_all') {
            payload = await handleClearAll({ supabase, user, body, site });
        } else {
            return sendJson(res, 400, {
                success: false,
                message: 'Unsupported user block action'
            });
        }

        return sendJson(res, 200, {
            success: true,
            action,
            site,
            ...payload
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'User block request failed'
        });
    }
};
