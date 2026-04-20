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
    const batchDeleteSegment = getSegment(source, 'async function batchDeleteComments(actionEl = null)', 'async function deleteComment(id, type, recordType = \'\')');
    const deleteSegment = getSegment(source, 'async function deleteComment(id, type, recordType = \'\')', 'function viewCommentContext(contextUrl)');

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
