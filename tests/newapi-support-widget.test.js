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
        /min-w-0 w-max max-w-\[84%\] rounded-lg px-3 py-2 text-left/
    );
    assert.match(
        adminInbox,
        /flex min-h-0 flex-1 flex-col items-start gap-4 overflow-y-auto/
    );
    assert.match(
        adminInbox,
        /min-w-0 w-max max-w-\[84%\] rounded-2xl px-3 py-2 text-left/
    );
});

test('NewAPI support launcher keeps a solid unread badge and pinned composer', () => {
    const widget = readRepoFile('services/newapi/web/src/features/support/support-widget.tsx');
    const composer = readRepoFile(
        'services/newapi/web/src/features/support/components/support-composer.tsx'
    );
    const adminInbox = readRepoFile(
        'services/newapi/web/src/features/support/admin-inbox.tsx'
    );

    assert.match(
        widget,
        /fixed right-4 bottom-14 z-40 size-11 overflow-visible rounded-full shadow-lg sm:right-6 sm:bottom-16/
    );
    assert.match(
        widget,
        /bg-destructive text-destructive-foreground ring-background/
    );
    assert.match(widget, /bg-background shrink-0/);
    assert.match(composer, /bg-background shrink-0 border-t p-4/);
    assert.match(adminInbox, /h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden/);
    assert.match(adminInbox, /bg-background shrink-0/);
});

test('NewAPI admin inbox follows the same latest-message viewport as the user widget', () => {
    const hook = readRepoFile(
        'services/newapi/web/src/features/support/hooks/use-stick-to-latest-message.ts'
    );
    const userList = readRepoFile(
        'services/newapi/web/src/features/support/components/support-message-list.tsx'
    );
    const adminInbox = readRepoFile(
        'services/newapi/web/src/features/support/admin-inbox.tsx'
    );

    assert.match(hook, /list\.scrollTop = list\.scrollHeight/);
    assert.match(hook, /shouldStickToBottomRef/);
    assert.match(userList, /useStickToLatestMessage\(/);
    assert.match(adminInbox, /useStickToLatestMessage\(/);
    assert.match(adminInbox, /Jump to latest message/);
    assert.match(adminInbox, /onClick=\{handleLoadOlderMessages\}/);
});

test('NewAPI admin inbox user bubbles are visibly gray and omit the customer label', () => {
    const adminInbox = readRepoFile(
        'services/newapi/web/src/features/support/admin-inbox.tsx'
    );

    assert.doesNotMatch(adminInbox, /\{isAgent \? <span>\{t\('You'\)\}<\/span> : null\}/);
    assert.doesNotMatch(adminInbox, /t\('You'\)/);
    assert.doesNotMatch(adminInbox, /isAgent \? t\('You'\) : t\('Customer'\)/);
    assert.match(
        adminInbox,
        /bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100 rounded-bl-sm/
    );
});

test('NewAPI support widget and inbox send compressed images through the gateway', () => {
    const widget = readRepoFile('services/newapi/web/src/features/support/support-widget.tsx');
    const conversation = readRepoFile(
        'services/newapi/web/src/features/support/hooks/use-support-conversation.ts'
    );
    const composer = readRepoFile(
        'services/newapi/web/src/features/support/components/support-composer.tsx'
    );
    const userList = readRepoFile(
        'services/newapi/web/src/features/support/components/support-message-list.tsx'
    );
    const adminInbox = readRepoFile(
        'services/newapi/web/src/features/support/admin-inbox.tsx'
    );
    const userApi = readRepoFile('services/newapi/web/src/features/support/api.ts');
    const adminApi = readRepoFile('services/newapi/web/src/features/support/admin-api.ts');

    assert.match(composer, /aria-label=\{t\('Attach image'\)\}/);
    assert.match(composer, /accept='image\/\*'/);
    assert.match(widget, /compressSupportImage\(file\)/);
    assert.match(widget, /kind: 'image'/);
    assert.match(conversation, /kind: input.kind === 'image' \? 'image' : 'text'/);
    assert.match(userApi, /message_type: 'image'/);
    assert.match(userApi, /image_data: input.imageData/);
    assert.match(adminApi, /message_type: 'image'/);
    assert.match(adminApi, /image_data: options.imageData/);
    assert.match(userList, /getSupportImageUrl\(message.text\)/);
    assert.match(adminInbox, /compressSupportImage\(file\)/);
    assert.match(adminInbox, /getSupportImageUrl\(message.text\)/);
    assert.match(adminInbox, /<img/);
    assert.doesNotMatch(adminInbox, /t\('You'\)/);
});

test('NewAPI support bubbles hide the calendar date for later same-day messages', () => {
    const userList = readRepoFile(
        'services/newapi/web/src/features/support/components/support-message-list.tsx'
    );
    const adminInbox = readRepoFile(
        'services/newapi/web/src/features/support/admin-inbox.tsx'
    );
    const helper = readRepoFile(
        'services/newapi/web/src/features/support/lib/format-support-message-time.ts'
    );

    assert.match(helper, /localDayKey\(previous\) === localDayKey\(timestamp\)/);
    assert.match(helper, /export function formatSupportMessageDate\(/);
    assert.match(userList, /formatSupportMessageTime\(/);
    assert.match(adminInbox, /formatSupportMessageTime\(/);
    assert.match(userList, /data-testid='support-message-date'/);
    assert.match(userList, /justify-center/);
    assert.match(adminInbox, /formatSupportMessageDate\(/);
    assert.match(adminInbox, /justify-center/);
    assert.match(adminInbox, /formatSupportConversationTime\(/);
});

test('NewAPI support image compression keeps large client uploads under the gateway limit', () => {
    const compressor = readRepoFile(
        'services/newapi/web/src/features/support/lib/compress-support-image.ts'
    );

    assert.match(compressor, /SUPPORT_IMAGE_MAX_BYTES/);
    assert.match(compressor, /blob\.size <= SUPPORT_IMAGE_MAX_BYTES/);
    assert.match(compressor, /Unable to upload image/);
    assert.match(compressor, /'image\/jpeg'/);
    assert.match(compressor, /blob\.type/);
    assert.doesNotMatch(compressor, /type: 'image\/webp'/);
});
