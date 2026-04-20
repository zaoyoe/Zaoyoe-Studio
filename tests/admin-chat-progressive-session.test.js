const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('admin chat renders session messages before user 360 context finishes', () => {
    const source = readRepoFile('js/admin-chat.js');

    const requiredMarkers = [
        'fetchSessionMessages(sessionIds = []) {',
        'warmUser360ContextForSession(session = {}, contextRequestId = this._userContextRequestId) {',
        'const contextPromise = this.warmUser360ContextForSession(session || {}, contextRequestId);',
        'messagesResult = await this.fetchSessionMessages(sessionIds);',
        '(messagesResult?.data || []).forEach((message) => this.appendMessage(message, { scroll: false }));',
        'void contextPromise;'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(source.includes(marker), true, `js/admin-chat.js should contain ${marker}`);
    }

    assert.doesNotMatch(
        source,
        /const \[messagesResult, contextResult\] = await Promise\.allSettled\(\[[\s\S]*this\.fetchUser360Context\(session \|\| \{\}\)[\s\S]*\]\);/,
        'loadSession should not await messages and user 360 context in the same Promise.allSettled call'
    );
});
