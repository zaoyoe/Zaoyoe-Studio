const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('customer chat admin status uses shared realtime admin presence before chat-message fallback', () => {
    const adminAccessSource = readRepoFile('js/admin-access.js');
    const chatWidgetSource = readRepoFile('js/components/ChatWidget.js');
    const adminChatSource = readRepoFile('js/admin-chat.js');
    const promptsSource = readRepoFile('prompts-poetry.js');

    assert.equal(
        adminAccessSource.includes("const ADMIN_PRESENCE_CHANNEL = 'zaoyoe-admin-presence';"),
        true,
        'admin access should define a shared admin presence topic'
    );
    assert.equal(
        adminAccessSource.includes('globalScope.ZaoyoeAdminPresence = {'),
        true,
        'admin access should expose the shared admin presence helper'
    );
    assert.equal(
        chatWidgetSource.includes(".on('presence', { event: 'sync' }, () => {"),
        true,
        'user chat widget should subscribe to admin presence sync events'
    );
    assert.equal(
        chatWidgetSource.includes('if (this.adminPresenceOnline && this.applyAdminPresenceStatusFromCache()) {'),
        true,
        'user chat widget should prefer presence status before querying latest admin chat messages'
    );
    assert.equal(
        chatWidgetSource.includes(".on('presence', { event: 'leave' },"),
        true,
        'user chat widget should capture admin presence leave events as the latest offline time'
    );
    assert.equal(
        chatWidgetSource.includes('const presenceIsFreshest = Number.isFinite(presenceLastSeenTime)'),
        true,
        'user chat widget should not turn a fresh offline presence timestamp back into online via message heuristics'
    );
    assert.equal(
        adminChatSource.includes('this.startAdminPresence();'),
        true,
        'admin chat workspace should publish admin presence'
    );
    assert.equal(
        promptsSource.includes('window.ZaoyoeAdminPresence?.start?.(window.supabaseClient);'),
        true,
        'prompt gallery should publish presence when the current user is an admin'
    );
});

test('admin chat user status uses shared realtime user presence before chat-message activity', () => {
    const adminAccessSource = readRepoFile('js/admin-access.js');
    const injectedAuthSource = readRepoFile('inject-auth.js');
    const adminChatSource = readRepoFile('js/admin-chat.js');
    const chatWidgetSource = readRepoFile('js/components/ChatWidget.js');
    const adminChatStyles = readRepoFile('css/admin-chat.css');

    assert.equal(
        adminAccessSource.includes("const USER_PRESENCE_CHANNEL = 'zaoyoe-user-presence';"),
        true,
        'admin access should define a shared user presence topic'
    );
    assert.equal(
        adminAccessSource.includes('globalScope.ZaoyoeUserPresence = {'),
        true,
        'admin access should expose the shared user presence helper'
    );
    assert.equal(
        injectedAuthSource.includes('void syncInjectedAuthUserPresence();'),
        true,
        'public auth runtime should publish user presence after auth initialization'
    );
    assert.equal(
        adminChatSource.includes('this.subscribeToUserPresence();'),
        true,
        'admin chat workspace should subscribe to realtime user presence'
    );
    assert.equal(
        adminChatSource.includes('presenceOnline: presence.online'),
        true,
        'admin chat sessions should carry realtime user presence state'
    );
    assert.equal(
        chatWidgetSource.includes('this.subscribeToUserPresence();'),
        true,
        'legacy admin chat widget should subscribe to realtime user presence'
    );
    assert.equal(
        chatWidgetSource.includes("session-time${isPresenceOnline ? ' session-time--online' : ''}"),
        true,
        'legacy admin chat widget should mark online session timestamps for green styling'
    );
    assert.equal(
        adminChatSource.includes("session-time${isPresenceOnline ? ' session-time--online' : ''}"),
        true,
        'admin chat workspace should mark online session timestamps for green styling'
    );
    assert.equal(
        chatWidgetSource.includes('.session-time--online'),
        true,
        'legacy admin chat widget should style online session timestamps'
    );
    assert.equal(
        adminChatStyles.includes('.session-time--online'),
        true,
        'admin chat stylesheet should style online session timestamps'
    );
    assert.equal(
        chatWidgetSource.includes("const time = isOpsSession\n                ? ''"),
        true,
        'legacy admin chat widget should not render online time for the fixed ops session'
    );
    assert.equal(
        adminChatSource.includes('timeEl.textContent = isOpsSession'),
        true,
        'admin chat workspace should not render online time for the fixed ops session'
    );
});
