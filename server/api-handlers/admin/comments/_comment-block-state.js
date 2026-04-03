const SUPPORTED_COMMENT_BLOCK_SCOPES = new Set(['guestbook', 'gallery', 'all']);

function normalizeCommentBlockScope(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return SUPPORTED_COMMENT_BLOCK_SCOPES.has(normalized) ? normalized : '';
}

function isActiveCommentBlock(row, now = new Date()) {
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

function buildCommentBlockState(rows = [], now = new Date()) {
    const activeBlocks = (Array.isArray(rows) ? rows : [])
        .filter((row) => SUPPORTED_COMMENT_BLOCK_SCOPES.has(String(row?.scope || '').trim().toLowerCase()))
        .filter((row) => isActiveCommentBlock(row, now))
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

async function fetchCommentBlockStateRows(supabase, userIds = []) {
    const normalizedIds = Array.from(new Set((Array.isArray(userIds) ? userIds : []).filter(Boolean)));
    if (!normalizedIds.length) {
        return [];
    }

    const { data, error } = await supabase
        .from('blocked_users')
        .select('user_id, scope, reason, expires_at')
        .in('user_id', normalizedIds);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

function buildCommentUserBlockStateMap(rows = [], userIds = [], now = new Date()) {
    const groupedRows = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const userId = String(row?.user_id || '').trim();
        if (!userId) {
            return;
        }

        if (!groupedRows.has(userId)) {
            groupedRows.set(userId, []);
        }
        groupedRows.get(userId).push(row);
    });

    return Array.from(new Set((Array.isArray(userIds) ? userIds : []).filter(Boolean))).reduce((acc, userId) => {
        acc[userId] = buildCommentBlockState(groupedRows.get(userId) || [], now);
        return acc;
    }, {});
}

module.exports = {
    SUPPORTED_COMMENT_BLOCK_SCOPES,
    normalizeCommentBlockScope,
    isActiveCommentBlock,
    buildCommentBlockState,
    fetchCommentBlockStateRows,
    buildCommentUserBlockStateMap
};
