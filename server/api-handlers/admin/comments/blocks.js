const {
    normalizeAdminSite,
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const SUPPORTED_COMMENT_BLOCK_SCOPES = new Set(['guestbook', 'gallery', 'all']);

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeCommentBlockScope(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return SUPPORTED_COMMENT_BLOCK_SCOPES.has(normalized) ? normalized : '';
}

function isActiveBlock(row, now = new Date()) {
    const expiresAt = String(row?.expires_at || '').trim();
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
        .filter((row) => SUPPORTED_COMMENT_BLOCK_SCOPES.has(String(row?.scope || '').trim().toLowerCase()))
        .filter((row) => isActiveBlock(row, now))
        .map((row) => ({
            user_id: String(row?.user_id || '').trim(),
            scope: normalizeCommentBlockScope(row?.scope),
            reason: String(row?.reason || '').trim(),
            expires_at: String(row?.expires_at || '').trim() || null
        }));

    activeBlocks.sort((left, right) => {
        const leftScope = left.scope === 'all' ? '0' : left.scope;
        const rightScope = right.scope === 'all' ? '0' : right.scope;
        if (leftScope !== rightScope) {
            return leftScope.localeCompare(rightScope);
        }
        return 0;
    });

    const scopeSet = new Set(activeBlocks.map((row) => row.scope));
    const hasGlobalBlock = scopeSet.has('all');

    return {
        blocks: activeBlocks,
        scopes: Array.from(scopeSet),
        hasGlobalBlock,
        isGuestbookBlocked: hasGlobalBlock || scopeSet.has('guestbook'),
        isGalleryBlocked: hasGlobalBlock || scopeSet.has('gallery')
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

function normalizeBlockDurationDays(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || normalized === 'permanent') {
        return null;
    }

    const days = Number.parseInt(normalized, 10);
    if (!Number.isFinite(days) || days <= 0) {
        return null;
    }

    return Math.min(days, 365);
}

function resolveBlockReason(scope, days) {
    const scopeLabel = scope === 'guestbook'
        ? '留言板'
        : (scope === 'gallery' ? '画廊' : '全部');

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

module.exports = async (req, res) => {
    try {
        if (req.method === 'GET') {
            const { supabase } = await requireAdmin(req, { permission: 'users.manage' });
            const searchParams = getQueryParams(req);
            const userId = String(searchParams.get('userId') || searchParams.get('user_id') || '').trim();
            const site = normalizeAdminSite(searchParams.get('site') || req.adminSite, { defaultValue: 'all' }) || 'all';

            if (!userId) {
                return sendJson(res, 400, { success: false, message: 'userId is required' });
            }

            const rows = await fetchUserBlocks(supabase, userId);
            const state = buildBlockState(rows);

            return sendJson(res, 200, {
                success: true,
                site,
                userId,
                ...state
            });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }

        const { supabase, user } = await requireAdmin(req, { permission: 'users.manage' });
        const body = await parseJsonBody(req);
        const action = String(body.action || '').trim().toLowerCase();
        const site = requireWritableAdminSite(body.site || req.adminSite, { fieldName: 'site' });
        const userId = String(body.userId || body.user_id || '').trim();
        const scope = normalizeCommentBlockScope(body.scope);

        if (!userId) {
            return sendJson(res, 400, { success: false, message: 'userId is required' });
        }

        if (!scope) {
            return sendJson(res, 400, { success: false, message: 'Unsupported block scope' });
        }

        if (action !== 'block' && action !== 'unblock') {
            return sendJson(res, 400, { success: false, message: 'Unsupported block action' });
        }

        if (action === 'block') {
            const days = normalizeBlockDurationDays(body.days);
            const expiresAt = days
                ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
                : null;
            const reason = String(body.reason || '').trim() || resolveBlockReason(scope, days);
            const { error } = await supabase
                .from('blocked_users')
                .upsert({
                    user_id: userId,
                    scope,
                    reason,
                    admin_id: user.id,
                    expires_at: expiresAt
                }, {
                    onConflict: 'user_id, scope'
                });

            if (error) {
                throw error;
            }

            await writeBlockHistory(supabase, {
                user_id: userId,
                action: 'block',
                scope,
                reason,
                admin_id: user.id
            });

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'comments',
                site,
                actionType: 'comments.block_user',
                details: {
                    user_id: userId,
                    scope,
                    reason,
                    expires_at: expiresAt,
                    applies_globally: true
                }
            });
        } else {
            const { error } = await supabase
                .from('blocked_users')
                .delete()
                .eq('user_id', userId)
                .eq('scope', scope);

            if (error) {
                throw error;
            }

            await writeBlockHistory(supabase, {
                user_id: userId,
                action: 'unblock',
                scope,
                reason: String(body.reason || '').trim() || '后台手动解封',
                admin_id: user.id
            });

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'comments',
                site,
                actionType: 'comments.unblock_user',
                details: {
                    user_id: userId,
                    scope,
                    applies_globally: true
                }
            });
        }

        const rows = await fetchUserBlocks(supabase, userId);
        const state = buildBlockState(rows);

        return sendJson(res, 200, {
            success: true,
            site,
            userId,
            ...state
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Comment block request failed'
        });
    }
};
