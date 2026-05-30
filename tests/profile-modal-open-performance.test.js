const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('profile modal first open uses fast mount instead of waiting for full security runtime', () => {
    const loaderSource = readRepoFile('js/profile-modal-loader.js');
    const authSource = readRepoFile('supabase-auth-functions.js');
    const injectSource = readRepoFile('inject-auth.js');

    for (const marker of [
        'function ensureProfileModalCriticalStyles() {',
        'function mountProfileModalFast() {',
        'function warmProfileModalRuntime() {',
        'startProfileModalBackgroundWarmup();',
        'mount: mountProfileModalFast',
        'warm: warmProfileModalRuntime'
    ]) {
        assert.equal(loaderSource.includes(marker), true, `js/profile-modal-loader.js should contain ${marker}`);
    }

    for (const marker of [
        "const PROFILE_MODAL_BOOTSTRAP_SRC = 'js/profile-modal-loader.js?v=20260503_PROFILE_MODAL_CHROME_CLOSE_1&componentSelectGuard=20260530_PUBLIC_COMPONENT_SELECT_GUARD_1';",
        'function scheduleSupabaseAuthProfileModalWarmup(reason =',
        'await loader.mount();',
        "scheduleSupabaseAuthProfileModalWarmup('dropdown-open');",
        "scheduleSupabaseAuthProfileModalWarmup('auth-ready');"
    ]) {
        assert.equal(authSource.includes(marker), true, `supabase-auth-functions.js should contain ${marker}`);
    }

    assert.equal(
        injectSource.includes("window.ZaoyoeProfileModalBootstrap?.warm?.({ reason: 'profile-click' });"),
        true,
        'inject-auth.js should warm the modal runtime before handing off a profile click'
    );
});

test('profile security actions wait for lazy security runtime when needed', () => {
    const authSource = readRepoFile('supabase-auth-functions.js');

    for (const marker of [
        'function finishProfileSecurityAction(actionName, callback) {',
        "finishProfileSecurityAction('changePassword', window.changePassword);",
        "finishProfileSecurityAction('sendPhoneVerificationCode', window.sendPhoneVerificationCode);",
        "finishProfileSecurityAction('bindPhone', window.bindPhone);",
        "finishProfileSecurityAction('deleteAccount', window.deleteAccount);",
        "ensureProfileModalRuntime({ fast: false }).then(() => {"
    ]) {
        assert.equal(authSource.includes(marker), true, `supabase-auth-functions.js should contain ${marker}`);
    }
});
