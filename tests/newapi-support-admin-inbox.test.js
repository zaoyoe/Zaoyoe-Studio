const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('Admin Studio preserves the NewAPI product boundary when replying', () => {
    const source = readRepoFile('js/admin-chat.js');
    const replyProductMarker = 'product: this.getSessionProduct(this.currentSessionInfo),';

    assert.equal(
        source.split(replyProductMarker).length - 1,
        2,
        'text and image replies must both retain the active session product'
    );
    assert.equal(source.includes("query = query.eq('product', 'newapi');"), true);
    assert.equal(source.includes("sourceBadge: isNewApiSupport ? 'NewAPI' : ''"), true);
    assert.equal(source.includes('externalUserId: isNewApiSupport ? externalUserId :'), true);
});

test('Admin Studio treats a NewAPI identity as external rather than a Supabase user', () => {
    const source = readRepoFile('js/admin-chat.js');

    for (const marker of [
        'if (this.isNewApiSupportSession(session)) {',
        'externalSupport: true,',
        "accountState: 'NewAPI Dashboard'",
        "return `newapi:${identity.userId || String(session?.sessionId || '').trim()}`;"
    ]) {
        assert.equal(source.includes(marker), true, `missing NewAPI identity isolation marker: ${marker}`);
    }
});
