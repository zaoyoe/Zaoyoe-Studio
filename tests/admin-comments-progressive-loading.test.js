const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function getSegment(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + 1);
    assert.notEqual(start, -1, `Expected segment start ${startMarker}`);
    assert.notEqual(end, -1, `Expected segment end ${endMarker}`);
    return source.slice(start, end);
}

function assertOrder(segment, firstMarker, secondMarker, message) {
    const firstIndex = segment.indexOf(firstMarker);
    const secondIndex = segment.indexOf(secondMarker);
    assert.notEqual(firstIndex, -1, `Expected marker ${firstMarker}`);
    assert.notEqual(secondIndex, -1, `Expected marker ${secondMarker}`);
    assert.ok(firstIndex < secondIndex, message);
}

test('comments module loads the list before scheduling stats refresh', () => {
    const source = readRepoFile('admin-comments.js');
    const initSegment = getSegment(source, 'function initCommentsModule()', 'function setupCommentEventHandlers()');
    const switchSegment = getSegment(source, 'function switchCommentView(view)', 'function renderFilterTags()');

    assertOrder(
        initSegment,
        "loadComments(routeState.view || currentCommentView, {",
        "scheduleCommentStatsRefresh(routeState.view || currentCommentView, { showLoading: true });",
        'comments module re-entry should render the list before scheduling stats refresh'
    );
    assertOrder(
        initSegment,
        "loadComments(currentCommentView, { resetPage: true });",
        "scheduleCommentStatsRefresh(currentCommentView, { showLoading: true });",
        'comments module first entry should render the list before scheduling stats refresh'
    );
    assertOrder(
        switchSegment,
        "loadComments(view, { resetPage: true });",
        "scheduleCommentStatsRefresh(view, { showLoading: true });",
        'switching comment views should prioritize the list before refreshing stats'
    );
});

test('comments workflow actions refresh stats only after the list request is queued', () => {
    const source = readRepoFile('admin-comments.js');
    const createTicketSegment = getSegment(source, 'async function createCommentTicket(commentId)', 'async function updateCommentWorkflowStatus(commentId, status)');
    const updateStatusSegment = getSegment(source, 'async function updateCommentWorkflowStatus(commentId, status)', 'async function assignCommentWorkflowSelf(commentId)');
    const batchStatusSegment = getSegment(source, 'async function batchSetCommentWorkflowStatus(status = \'\', actionEl = null)', 'async function batchAssignCommentWorkflowSelf(actionEl = null)');

    assert.equal(
        createTicketSegment.includes('await loadCommentStats();'),
        false,
        'creating a comment ticket should no longer block on stats before reloading the list'
    );
    assertOrder(
        createTicketSegment,
        'await loadComments(currentCommentView, {',
        'loadCommentStats(currentCommentView, { showLoading: false });',
        'creating a comment ticket should refresh the list before the stats request'
    );

    assert.equal(
        updateStatusSegment.includes('await loadCommentStats();'),
        false,
        'updating comment workflow status should no longer block on stats before reloading the list'
    );
    assertOrder(
        updateStatusSegment,
        'await loadComments(currentCommentView, {',
        'loadCommentStats(currentCommentView, { showLoading: false });',
        'updating comment workflow status should refresh the list before the stats request'
    );

    assert.equal(
        batchStatusSegment.includes('await loadCommentStats();'),
        false,
        'batch workflow updates should no longer block on stats before reloading the list'
    );
    assertOrder(
        batchStatusSegment,
        'await loadComments(currentCommentView, { resetPage: true });',
        'loadCommentStats(currentCommentView, { showLoading: false });',
        'batch workflow updates should refresh the list before the stats request'
    );
});

test('comments side-effect refresh helpers keep list-first ordering for lightweight updates', () => {
    const source = readRepoFile('admin-comments.js');
    const refreshUserSegment = getSegment(source, 'function refreshCommentsForUserStatus(userId)', 'function getCommentById(commentId)');
    const batchDeleteSegment = getSegment(source, 'async function batchDeleteComments(actionEl = null)', 'async function deleteComment(id, type, recordType = \'\', actionEl = null)');
    const deleteSegment = getSegment(source, 'async function deleteComment(id, type, recordType = \'\', actionEl = null)', 'function viewCommentContext(contextUrl)');

    assertOrder(
        refreshUserSegment,
        'loadComments(currentCommentView, {',
        'loadCommentStats(currentCommentView, { showLoading: false });',
        'user-status driven refreshes should queue the list before the stats request'
    );
    assertOrder(
        batchDeleteSegment,
        'loadComments(currentCommentView, { preserveSelection: true });',
        'loadCommentStats(currentCommentView, { showLoading: false });',
        'batch deletes should refresh the list before the stats request'
    );
    assertOrder(
        deleteSegment,
        'loadComments(currentCommentView, {',
        'loadCommentStats(currentCommentView, { showLoading: false });',
        'single-comment deletes should refresh the list before the stats request'
    );
});

test('comments card moderation buttons provide inline action feedback', () => {
    const source = readRepoFile('admin-comments.js');
    const deleteDelegateSegment = getSegment(source, "case 'delete-comment':", "case 'block-user':");

    assert.match(
        source,
        /function beginAdminCommentsActionButtonFeedback\(actionEl,\s*options = \{\}\)/,
        'comments runtime should expose a compact per-button feedback helper'
    );
    assert.match(
        source,
        /data-comments-action="delete-comment"[\s\S]{0,220}aria-label="删除评论"/,
        'comment card delete buttons should be labelled for inline feedback and assistive tech'
    );
    assert.match(
        source,
        /async function deleteComment\(id,\s*type,\s*recordType = '',\s*actionEl = null\)[\s\S]{0,520}beginAdminCommentsActionButtonFeedback\(actionEl,\s*\{[\s\S]{0,120}loadingText: '删除中\.\.\.'/,
        'single comment delete should switch the clicked icon button into a deleting state'
    );
    assert.equal(
        deleteDelegateSegment.includes('actionEl'),
        true,
        'delete action delegation should pass the clicked button into deleteComment'
    );
    assert.match(
        source,
        /window\.togglePin = async function \(id,\s*currentStatus,\s*promptId,\s*actionEl = null\)[\s\S]{0,620}loadingText: currentStatus \? '取消中\.\.\.' : '置顶中\.\.\.'/,
        'pin/unpin should show inline button feedback while the request is in flight'
    );
    assert.match(
        source,
        /window\.blockUser = async function \(userId,\s*scope,\s*days,\s*actionEl = null\)[\s\S]{0,620}loadingText: '封禁中\.\.\.'/,
        'block user menu actions should show inline busy feedback'
    );
    assert.match(
        source,
        /window\.unblockUser = async function \(userId,\s*scope,\s*actionEl = null\)[\s\S]{0,620}loadingText: '解封中\.\.\.'/,
        'unblock user menu actions should show inline busy feedback'
    );
});

test('comments export menu options show progress feedback while exporting filtered data', () => {
    const source = readRepoFile('admin-comments.js');
    const styles = readRepoFile('admin-sidebar.css');

    assert.match(
        source,
        /function beginAdminCommentsMenuOptionFeedback\(actionEl,\s*options = \{\}\)/,
        'comments runtime should expose a menu-option feedback helper for export actions'
    );
    assert.match(
        source,
        /async function exportData\(format,\s*actionEl = null\)[\s\S]{0,240}beginAdminCommentsMenuOptionFeedback\(actionEl,\s*\{[\s\S]{0,120}loadingText: '导出中\.\.\.'/,
        'comments export should switch the clicked export option into a loading state'
    );
    assert.match(
        source,
        /finishMenuFeedback\(\{\s*state: 'saved',\s*text: '已导出'\s*\}\)/,
        'comments export should show completion feedback before restoring the menu option'
    );
    assert.match(
        styles,
        /\.filter-option\[data-comments-action-feedback-state="loading"\]/,
        'comments export menu feedback should have a visible loading style'
    );
});
