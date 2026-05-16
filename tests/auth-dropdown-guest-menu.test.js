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
    const navAuthFastPaintSource = readRepoFile('js/nav-auth-fast-paint.js');
    const authSheetStyles = readRepoFile('css/auth-sheet.css');
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
    assert.equal(
        injectSource.includes('const userOnlyAttrs = isLoggedIn ? \'\' : \' hidden aria-hidden="true" tabindex="-1"\';'),
        true,
        'guest dropdown should hide authenticated-only actions in the rendered markup before CSS loads'
    );
    assert.match(
        injectSource,
        /class="avatar-dropdown auth-dropdown-layer \$\{isLoggedIn \? 'is-authenticated' : 'is-guest'\}"/,
        'dropdown markup should include the initial auth mode class before the runtime sync pass'
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
    assert.equal(
        authSource.includes('!hasStoredAuthSessionCandidate(profile)') &&
        injectSource.includes('!hasStoredAuthSessionCandidate(profile)') &&
        navAuthFastPaintSource.includes('!hasStoredAuthSessionCandidate(profile)'),
        true,
        'cached profiles without a matching Supabase session should not make the nav render as authenticated'
    );
    assert.equal(
        authSource.includes('doesStoredSessionMatchCachedProfile') &&
        injectSource.includes('doesStoredSessionMatchCachedProfile') &&
        navAuthFastPaintSource.includes('doesStoredSessionMatchCachedProfile'),
        true,
        'cached profiles should be matched against the stored JWT identity before fast auth paint'
    );
    assert.equal(
        authSource.includes('return normalizeUserForAdminAccess(readCachedUserProfile());'),
        true,
        'admin entry warmup should reuse the verified cached profile reader'
    );
    assert.equal(
        authSource.includes('const cached = readCachedUserProfile();') &&
        authSource.includes('const cachedNickname = cached.nickname || cached.username'),
        true,
        'profile modal cache hydration should reuse the verified cached profile reader'
    );
    assert.equal(
        authSource.includes("item.hidden = shouldHide;"),
        true,
        'auth runtime should update hidden attributes when switching guest/authenticated dropdown modes'
    );

    for (const source of [authSheetStyles, homeStyles, criticalStyles]) {
        assert.equal(
            source.includes('.avatar-dropdown:not(.is-authenticated) .auth-user-only'),
            true,
            'guest dropdown should hide authenticated-only actions'
        );
        assert.equal(
            source.includes('.avatar-dropdown[data-auth-state="guest"] .auth-user-only'),
            true,
            'guest dropdown should also hide authenticated-only actions through data-auth-state'
        );
        assert.equal(
            source.includes('.avatar-dropdown [hidden]'),
            true,
            'dropdown hidden attributes should not be overridden by action display rules'
        );
        assert.equal(
            source.includes('.avatar-dropdown.is-authenticated .auth-guest-only'),
            true,
            'authenticated dropdown should hide guest-only actions'
        );
    }
});

test('logout cleanup clears admin chat bootstrap state before guest UI is restored', () => {
    const authSource = readRepoFile('supabase-auth-functions.js');

    assert.match(authSource, /function clearAuthStateForLogout\(\)/);
    assert.match(authSource, /window\.AdminAccess\?\.clearAccessCache\?\.\(\)/);
    assert.match(authSource, /window\.AdminAccess\?\.clearCachedAdminStudioSession\?\.\(\)/);
    assert.match(authSource, /sessionStorage\.removeItem\('zaoyoe_admin_access_cache_v1'\)/);
    assert.match(authSource, /sessionStorage\.removeItem\('zaoyoe_admin_studio_session_cache_v1'\)/);
    assert.match(authSource, /localStorage\.removeItem\('zaoyoe_chat_widget_last_shell_mode_v1'\)/);
    assert.match(authSource, /window\.adminStudioAccessGranted = false;/);
    assert.match(authSource, /window\.isAdmin = false;/);
    assert.match(authSource, /window\.isSuperAdmin = false;/);
    assert.match(authSource, /window\.__ZAOYOE_ADMIN_MODE_HINT__ = 'user';/);
    assert.match(authSource, /key\.includes\('-auth-token'\) \|\| key\.includes\('supabase\.auth'\) \|\| key\.startsWith\('sb-'\)/);
    assert.match(authSource, /if \(clearCacheOnLogout\) \{\s*clearAuthStateForLogout\(\);/);
    assert.match(authSource, /async function handleLogout[\s\S]*?clearAuthStateForLogout\(\);[\s\S]*?window\.supabaseClient\.auth\.signOut\(\)/);
});
