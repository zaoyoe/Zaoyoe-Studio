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
        "requireWritableCommentsSite({ label: `${scopeLabel}用户解封` })"
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

test('comments summary handler includes guestbook replies alongside messages and gallery comments', () => {
    const source = readRepoFile('server/api-handlers/admin/comments/summary.js');

    assert.match(source, /from\('guestbook_messages'\)\.select\('\*', \{ count: 'exact', head: true \}\)/);
    assert.match(source, /from\('guestbook_comments'\)\.select\('\*', \{ count: 'exact', head: true \}\)/);
    assert.match(source, /from\('prompt_comments'\)\.select\('\*', \{ count: 'exact', head: true \}\)/);
    assert.match(source, /const totalCount = \(guestbookMessageCount \|\| 0\) \+ \(guestbookCommentCount \|\| 0\) \+ \(galleryCount \|\| 0\);/);
});

test('comments list handler loads guestbook replies and guestbook comment like counts', () => {
    const source = readRepoFile('server/api-handlers/admin/comments/list.js');

    assert.equal(/from\('guestbook_messages'\)\s*\.select\(/.test(source), true);
    assert.equal(/from\('guestbook_comments'\)\s*\.select\(/.test(source), true);
    assert.equal(/from\('guestbook_likes'\)\s*\.select\('target_id, target_type'\)/.test(source), true);
    assert.equal(/record_type: comment\.parent_id \? 'reply' : 'comment'/.test(source), true);
    assert.equal(/reply_count: commentReplyCounts\[comment\.id\] \|\| 0/.test(source), true);
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
