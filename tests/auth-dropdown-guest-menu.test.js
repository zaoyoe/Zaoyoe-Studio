const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('auth dropdown keeps a guest menu before opening the login sheet', () => {
    const injectSource = readRepoFile('inject-auth.js');
    const authSource = readRepoFile('supabase-auth-functions.js');
    const homeStyles = readRepoFile('css/framer_home.css');
    const criticalStyles = readRepoFile('css/framer_home_critical.css');

    assert.equal(
        injectSource.includes('class="dropdown-action auth-guest-only" data-auth-action="login"'),
        true,
        'guest dropdown should render a dedicated login action'
    );
    assert.equal(
        injectSource.includes('<span data-i18n="common.login">登录</span>'),
        true,
        'guest login action should use the shared bilingual login key'
    );
    assert.match(
        injectSource,
        /guestLoginActions = new Set\(\['notifications', 'profile', 'wallet', 'orders', 'switch-account', 'studio', 'logout'\]\)/,
        'guest-only protected menu actions should defer to the login sheet when clicked'
    );
    assert.equal(
        injectSource.includes("if (action === 'language')"),
        true,
        'language switching should remain available from the guest dropdown'
    );
    assert.equal(
        injectSource.includes("if (action === 'theme')"),
        true,
        'theme switching should remain available from the guest dropdown'
    );

    assert.equal(
        authSource.includes("const cachedProfile = readCachedUserProfile();"),
        true,
        'avatar click should resolve cached auth state through the parsed profile helper'
    );
    assert.equal(
        authSource.includes("openUserDropdownForAuthState(isLoggedIn, 'dropdown-open');"),
        true,
        'avatar click should open the dropdown for both guest and authenticated states'
    );
    assert.equal(
        authSource.includes('syncUserDropdownAuthMode(true);') && authSource.includes('syncUserDropdownAuthMode(false);'),
        true,
        'login and logout UI updates should switch the dropdown between authenticated and guest modes'
    );

    for (const source of [homeStyles, criticalStyles]) {
        assert.equal(
            source.includes('.avatar-dropdown:not(.is-authenticated) .auth-user-only'),
            true,
            'guest dropdown should hide authenticated-only actions'
        );
        assert.equal(
            source.includes('.avatar-dropdown.is-authenticated .auth-guest-only'),
            true,
            'authenticated dropdown should hide guest-only actions'
        );
    }
});
