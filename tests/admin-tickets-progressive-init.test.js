const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function getObjectMethodSegment(source, methodName, nextMethodName) {
    const start = source.indexOf(`${methodName}:`);
    const end = source.indexOf(`${nextMethodName}:`, start + 1);
    assert.notEqual(start, -1, `Expected ${methodName} to exist`);
    assert.notEqual(end, -1, `Expected ${nextMethodName} to follow ${methodName}`);
    return source.slice(start, end);
}

test('tickets queue init loads list first and warms overview afterwards', () => {
    const source = readRepoFile('js/admin-tickets.js');
    const initSegment = getObjectMethodSegment(source, 'init', 'warmOverviewInBackground');

    assert.equal(
        initSegment.includes("if (activeWorkspace !== 'queue')"),
        true,
        'tickets should keep overview on the critical path only when that workspace is active'
    );
    assert.match(
        initSegment,
        /await this\.loadTickets\(options\);\s+void this\.warmOverviewInBackground\(\{/,
        'tickets queue init should wait for the list before warming overview'
    );
    assert.equal(
        initSegment.includes('this.loadOverview(overviewOptions),\n                        this.loadTickets(options)'),
        true,
        'tickets overview workspace should still load overview and list together'
    );
});
