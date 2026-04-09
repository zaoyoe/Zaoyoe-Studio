const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('comments admin frontend routes stats, list, and moderation through admin comment handlers', () => {
    const source = readRepoFile('admin-comments.js');

    const requiredMarkers = [
        "buildAdminCommentsUrl('comments/blocks'",
        "buildAdminCommentsUrl('comments/summary'",
        "buildAdminCommentsUrl('comments/list'",
        "/api/admin/comments/moderate",
        "requireWritableCommentsSite({ action: 'comments-batch-delete' })",
        "label: recordType === 'message' ? '删除留言主贴' : '删除评论'",
        "requireWritableCommentsSite({ label: currentStatus ? '取消评论置顶' : '置顶评论' })",
        "action: 'toggle_pin'",
        "requireWritableCommentsSite({ label: `${scopeStr}用户封禁` })",
        "requireWritableCommentsSite({ label: `${scopeLabel}用户解封` })",
        "function buildCommentContextUrl(comment = {})",
        "function openAdminPromptCommentContext(context = {})",
        "function syncAdminCommentsRouteState(nextState = {}, options = {})",
        "function prepareCommentReloadState({ preserveSelection = false, removeSelectionIds = [], focusCommentId = '' } = {})",
        "function restoreCommentSelectionState()",
        "function focusCommentCard(commentId)",
        "function getCommentCurrentScopeBlockState(comment)",
        "function buildCommentUserBlockBadge(comment)",
        "function findVisibleCommentIdByUser(userId)",
        "function refreshCommentsForUserStatus(userId)",
        "new URL('guestbook.html', window.location.origin)",
        "url.searchParams.set('messageId', contextId)",
        "new URL('prompts.html', window.location.origin)",
        'data-user-id="${escapeHtml(comment.user_id || \'\')}"',
        "window.openAdminPromptCommentContext = openAdminPromptCommentContext;",
        'action-btn action-block${blockState.blocked ? \' action-btn--blocked\' : \'\'}',
        'refreshCommentsForUserStatus(userId);'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(source.includes(marker), true, `admin-comments.js should contain ${marker}`);
    }

    const removedMarkers = [
        ".from('guestbook_messages').select('*', { count: 'exact', head: true })",
        ".from('guestbook_comments').select('*', { count: 'exact', head: true })",
        ".from('prompt_comments').select('*', { count: 'exact', head: true })",
        ".from('guestbook_messages')\n                .select(`",
        ".from('prompt_comments')\n                .delete()",
        ".from('prompt_comments')\n                .update({ is_pinned: false })",
        ".from('prompt_comments')\n            .update({ is_pinned: !currentStatus })",
        ".from('blocked_users')"
    ];

    for (const marker of removedMarkers) {
        assert.equal(source.includes(marker), false, `admin-comments.js should not contain ${marker}`);
    }
});

test('guestbook page consumes admin deep links and routes them through smart scroll', () => {
    const source = readRepoFile('guestbook.js');

    assert.match(source, /function getGuestbookDeepLinkTarget\(\)/);
    assert.match(source, /const params = new URLSearchParams\(window\.location\.search \|\| ''\);/);
    assert.match(source, /const messageId = String\(params\.get\('messageId'\) \|\| ''\)\.trim\(\);/);
    assert.match(source, /const commentId = String\(params\.get\('commentId'\) \|\| ''\)\.trim\(\);/);
    assert.match(source, /function maybeHandleGuestbookDeepLink\(\)/);
    assert.match(source, /window\.handleSmartScroll\(deepLink\.commentId, 'comment', deepLink\.messageId\);/);
    assert.match(source, /window\.handleSmartScroll\(deepLink\.messageId, 'message'\);/);
    assert.match(source, /maybeHandleGuestbookDeepLink\(\);/);
});

test('comments summary handler includes guestbook replies alongside messages and gallery comments', () => {
    const source = readRepoFile('server/api-handlers/admin/comments/summary.js');

    assert.match(source, /from\('guestbook_messages'\)\.select\('id, user_id, created_at'\)/);
    assert.match(source, /from\('guestbook_comments'\)\.select\('id, user_id, parent_id, message_id, created_at'\)/);
    assert.match(source, /from\('prompt_comments'\)\.select\('id, user_id, parent_id, created_at'\)/);
    assert.match(source, /from\('admin_comment_workflows'\)/);
    assert.match(source, /const totalFeedback = totalMessages \+ totalComments \+ totalReplies;/);
    assert.match(source, /queueCounts:\s*\{/);
});

test('comments list handler loads guestbook replies and guestbook comment like counts', () => {
    const source = readRepoFile('server/api-handlers/admin/comments/list.js');

    assert.equal(/from\('guestbook_messages'\)\s*\.select\(/.test(source), true);
    assert.equal(/from\('guestbook_comments'\)\s*\.select\(/.test(source), true);
    assert.equal(/from\('guestbook_likes'\)\s*\.select\('target_id, target_type'\)/.test(source), true);
    assert.equal(/promptId:\s*sanitizeText\(searchParams\.get\('promptId'\), 160\)/.test(source), true);
    assert.equal(/if \(filters\.promptId && sanitizeText\(comment\?\.context \|\| comment\?\.prompt_id, 160\) !== filters\.promptId\)/.test(source), true);
    assert.equal(/function applyCommentQueueFilter\(comment, queue = 'all'\)/.test(source), true);
    assert.equal(/record_type: comment\.parent_id \? 'reply' : 'comment'/.test(source), true);
    assert.equal(/reply_count: commentReplyCounts\[comment\.id\] \|\| 0/.test(source), true);
    assert.equal(/context_title:\s*promptTitle/.test(source), true);
    assert.equal(/prompt_id:\s*comment\.prompt_id/.test(source), true);
    assert.equal(/pagination:\s*\{/.test(source), true);
    assert.equal(/totalItems: pagination\.totalItems/.test(source), true);
    assert.equal(/totalPages: pagination\.totalPages/.test(source), true);
    assert.equal(/fetchCommentBlockStateRows/.test(source), true);
    assert.equal(/buildCommentUserBlockStateMap/.test(source), true);
    assert.equal(/user_block_state: userBlockStateMap\[String\(comment\?\.user_id \|\| ''\)\.trim\(\)\]/.test(source), true);
    assert.equal(/\.limit\(50\)/.test(source), false);
    assert.equal(/\.limit\(100\)/.test(source), false);
});

test('comments moderation handler clears orphan guestbook likes and enforces writable site', () => {
    const source = readRepoFile('server/api-handlers/admin/comments/moderate.js');

    assert.match(source, /requireWritableAdminSite\(body\.site \|\| req\.adminSite/);
    assert.match(source, /from\('guestbook_likes'\)\s*\.delete\(\)\s*\.eq\('target_type', targetType\)\s*\.in\('target_id', normalizedIds\)/);
    assert.match(source, /const guestbookMessageIds = items/);
    assert.match(source, /const guestbookCommentIds = items/);
    assert.match(source, /action !== 'toggle_pin'/);
    assert.match(source, /async function toggleGalleryPinStatus/);
    assert.match(source, /actionType: 'comments\.pin'/);
    assert.match(source, /writeAdminAuditLog\(\{/);
});

test('comments blocks handler manages blocked users through admin api with users permission and audit', () => {
    const source = readRepoFile('server/api-handlers/admin/comments/blocks.js');

    assert.match(source, /requireAdmin\(req, \{ permission: 'users\.manage' \}\)/);
    assert.match(source, /from\('blocked_users'\)\s*\.select\('user_id, scope, reason, expires_at'\)/);
    assert.match(source, /from\('blocked_users'\)\s*\.upsert\(\{/);
    assert.match(source, /from\('blocked_users'\)\s*\.delete\(\)\s*\.eq\('user_id', userId\)\s*\.eq\('scope', scope\)/);
    assert.match(source, /from\('block_history'\)\s*\.insert\(payload\)/);
    assert.match(source, /requireWritableAdminSite\(body\.site \|\| req\.adminSite/);
    assert.match(source, /actionType: 'comments\.block_user'/);
    assert.match(source, /actionType: 'comments\.unblock_user'/);
});
