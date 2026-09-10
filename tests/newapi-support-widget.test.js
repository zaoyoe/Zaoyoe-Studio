const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('NewAPI support widget polls unread while closed and sends without waiting on the spinner', () => {
    const widget = readRepoFile('services/newapi/web/src/features/support/support-widget.tsx');
    const conversation = readRepoFile(
        'services/newapi/web/src/features/support/hooks/use-support-conversation.ts'
    );

    assert.match(widget, /authenticated && !isAdmin/);
    assert.match(widget, /useAdminSupportUnread\(/);
    assert.match(widget, /navigate\(\{ to: '\/support' \}\)/);
    assert.match(widget, /sending=\{false\}/);
    assert.match(conversation, /const enabled = authenticated/);
    assert.match(conversation, /onMutate: \(input\) => \{/);
});

test('NewAPI support bubbles shrink to their content and keep administrator text left-aligned', () => {
    const userList = readRepoFile(
        'services/newapi/web/src/features/support/components/support-message-list.tsx'
    );
    const adminInbox = readRepoFile(
        'services/newapi/web/src/features/support/admin-inbox.tsx'
    );

    assert.match(
        userList,
        /flex flex-1 flex-col items-start gap-4 overflow-y-auto/
    );
    assert.match(
        userList,
        /w-fit max-w-\[84%\] rounded-lg px-3 py-2 text-left/
    );
    assert.match(
        adminInbox,
        /flex min-h-0 flex-1 flex-col items-start gap-4 overflow-y-auto/
    );
    assert.match(
        adminInbox,
        /w-fit max-w-full rounded-2xl px-3 py-2 text-left/
    );
});
