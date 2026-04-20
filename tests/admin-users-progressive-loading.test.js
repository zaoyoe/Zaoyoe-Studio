const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('admin users module renders first-screen data before heavy enrichment', () => {
    const source = readRepoFile('admin-users.js');

    const requiredMarkers = [
        'let usersEnrichmentLoadPromise = null;',
        'let usersEnrichmentLoadRequestId = 0;',
        'function buildBasicUserListRow(profile = {}) {',
        'async function fetchUserListEnrichment(siteFilter = null) {',
        'function warmUserListEnrichmentInBackground({ requestId, siteFilter = null } = {}) {',
        'userState.users = profiles.map((profile) => buildBasicUserListRow(profile));',
        'void warmUserListEnrichmentInBackground({ requestId, siteFilter });',
        'return buildBasicUserListRow({',
        'async function fetchUserModalSummaryEnrichment(userId) {',
        'async function warmUserModalOverviewInBackground(userId, user) {',
        'void warmUserModalOverviewInBackground(userId, user);'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(source.includes(marker), true, `admin-users.js should contain ${marker}`);
    }

    assert.equal(
        source.includes('prefetchOnOpen: true'),
        false,
        'user detail tabs should not prefetch sibling tabs when the modal opens'
    );

    assert.match(
        source,
        /async function fetchUserSummaryRecord\(criteria = \{\}\) \{[\s\S]*return buildBasicUserListRow\(\{[\s\S]*\}\);[\s\S]*\}/,
        'fetchUserSummaryRecord should only fetch the lightweight profile shell'
    );
});
