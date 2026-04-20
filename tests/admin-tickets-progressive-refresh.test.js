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

test('ticket mutations refresh the queue list before warming the overview', () => {
    const source = readRepoFile('js/admin-tickets.js');
    const refreshSegment = getSegment(
        source,
        'refreshQueueListFirst: async function (options = {}) {',
        'createTableStateRow: function ({ message, icon = \'fa-inbox\', variant = \'empty\', spinning = false }) {'
    );
    const bulkAssignmentSegment = getSegment(
        source,
        'submitBulkAssignment: async function (operation = \'assign_self\') {',
        'getSelectedPendingTickets: function () {'
    );
    const bulkProcessSegment = getSegment(
        source,
        'submitBulkProcess: async function () {',
        'render: function () {'
    );
    const submitReplySegment = getSegment(
        source,
        'submitReply: async function () {',
        'copyText: function (text) {'
    );

    assertOrder(
        refreshSegment,
        'await this.loadTickets(listOptions);',
        'void this.warmOverviewInBackground({',
        'ticket queue refresh helper should prioritize the list before overview warming'
    );

    for (const segment of [bulkAssignmentSegment, bulkProcessSegment, submitReplySegment]) {
        assert.equal(
            segment.includes('await Promise.all(['),
            false,
            'ticket mutation flows should no longer block on overview and list together'
        );
        assert.equal(
            segment.includes('await this.refreshQueueListFirst('),
            true,
            'ticket mutation flows should reuse the list-first refresh helper'
        );
    }
});
