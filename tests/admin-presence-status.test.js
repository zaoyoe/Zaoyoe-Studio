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
        chatWidgetSource.includes('if (this.adminPresenceOnline) {\n                statusText.innerText = this.t(\'chat.adminOnline\', \'管理员在线\');'),
        true,
        'user chat widget should only show admin online when realtime presence is currently online'
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
    const adminEntrySource = readRepoFile('admin-entry.html');
    const injectedAuthSource = readRepoFile('inject-auth.js');
    const adminChatSource = readRepoFile('js/admin-chat.js');
    const chatWidgetSource = readRepoFile('js/components/ChatWidget.js');
    const adminChatStyles = readRepoFile('css/admin-chat.css');
    const adminUsersSource = readRepoFile('admin-users.js');
    const heartbeatMigration = readRepoFile('supabase/migrations/20260505_user_presence_activity_heartbeat.sql');
    const adminUsersBootstrapSql = readRepoFile('supabase/admin_extensions.sql');
    const adminUsersStandaloneSql = readRepoFile('supabase/migrations/get_admin_users.sql');
    const adminUsersUpdateSql = readRepoFile('supabase/migrations/update_get_admin_users_activity.sql');
    const adminUsersSql = [heartbeatMigration, adminUsersBootstrapSql, adminUsersStandaloneSql, adminUsersUpdateSql].join('\n');

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
        adminAccessSource.includes("rpc('fn_record_user_activity_heartbeat'"),
        true,
        'public user presence should persist heartbeat activity through the server RPC'
    );
    assert.equal(
        adminEntrySource.includes('js/admin-access.js?v=20260606_ADMIN_STUDIO_SESSION_RENEWAL_1'),
        true,
        'admin entry should load the heartbeat-aware admin access runtime'
    );
    assert.equal(
        adminUsersSource.includes(".from('engagement_user_activity')"),
        true,
        'admin users should enrich active time from persisted user activity heartbeats'
    );
    assert.equal(
        adminUsersSource.includes("fetchOptionalUsersRows(activityQuery, 'engagement_user_activity')"),
        true,
        'admin user drawer warmup should not overwrite heartbeat activity with older login history'
    );
    assert.equal(
        adminUsersSource.includes('const lastActive = profile.out_last_active_at || profile.last_active_at || null;'),
        true,
        'admin users should map RPC activity output without auth login fallback'
    );
    assert.equal(
        adminUsersSource.includes('latestActivityMap?.get(id) || enrichment.latestLoginMap'),
        false,
        'admin users list enrichment should not display login history as last active'
    );
    assert.equal(
        adminUsersSource.includes('ensureUsersActivityLiveRefresh();'),
        true,
        'admin users should keep visible active times refreshed while the module is open'
    );
    assert.equal(
        heartbeatMigration.includes('CREATE OR REPLACE FUNCTION public.fn_record_user_activity_heartbeat'),
        true,
        'migration should create a secure heartbeat persistence RPC'
    );
    assert.equal(
        heartbeatMigration.includes('latest_activity AS'),
        true,
        'admin users RPC should sort by persisted latest activity'
    );
    assert.equal(
        adminUsersBootstrapSql.includes('latest_activity AS') && adminUsersStandaloneSql.includes('latest_activity AS'),
        true,
        'admin user SQL baselines should use persisted latest activity instead of legacy login-only activity'
    );
    assert.equal(
        adminUsersSql.includes('la.last_active_at AS out_last_active_at'),
        true,
        'admin user SQL should expose heartbeat activity as the displayed last active field'
    );
    assert.equal(
        adminUsersSql.includes('COALESCE(la.last_active_at, au.last_sign_in_at'),
        false,
        'admin user SQL should not blend auth login time into displayed last active'
    );
    assert.equal(
        adminUsersSql.includes('lc.last_comment_at') || adminUsersSql.includes('ll.last_ledger_at'),
        false,
        'admin user SQL should not blend comments or points ledgers into displayed last active'
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
        adminChatSource.includes('this.subscribeToUserActivity();'),
        true,
        'admin chat workspace should subscribe to persisted user activity heartbeats'
    );
    assert.equal(
        adminChatSource.includes(".from('engagement_user_activity')"),
        true,
        'admin chat workspace should use persisted heartbeat activity when realtime presence is unavailable'
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
        chatWidgetSource.includes('this.subscribeToUserActivity();'),
        true,
        'legacy admin chat widget should subscribe to persisted user activity heartbeats'
    );
    assert.equal(
        chatWidgetSource.includes(".from('engagement_user_activity')"),
        true,
        'legacy admin chat widget should use persisted heartbeat activity when realtime presence is unavailable'
    );
    assert.equal(
        chatWidgetSource.includes("statusText = this.t('chat.noActiveRecord', '暂无活跃记录');"),
        true,
        'legacy admin chat widget should show an explicit empty active state when no heartbeat exists'
    );
    assert.equal(
        chatWidgetSource.includes('const fallbackLastSeen = Date.parse(sessionInfo.lastLogin || sessionInfo.lastTime || \'\');'),
        false,
        'legacy admin chat selected-session header should not infer active time from login/message timestamps'
    );
    assert.equal(
        adminChatSource.includes('const inactiveActivityFallback = this.hasKnownUserIdentityForSession(session)'),
        true,
        'admin chat session list should treat identified users without heartbeats as missing active records'
    );
    assert.equal(
        chatWidgetSource.includes('const inactiveActivityFallback = this.hasKnownUserIdentityForSession(session)'),
        true,
        'legacy admin chat session list should treat identified users without heartbeats as missing active records'
    );
    assert.equal(
        adminChatSource.includes('presenceStatus?.value || this.formatSessionTime(session.timestamp)'),
        false,
        'admin chat session list should not show message time as the active fallback for identified users'
    );
    assert.equal(
        chatWidgetSource.includes('presenceLabel || this.formatTime(session.lastTime)'),
        false,
        'legacy admin chat session list should not show message time as the active fallback for identified users'
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
