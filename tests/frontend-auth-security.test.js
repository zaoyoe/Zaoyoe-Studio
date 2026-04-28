const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const authSource = fs.readFileSync(
    path.resolve(__dirname, '../supabase-auth-functions.js'),
    'utf8'
);
const injectAuthSource = fs.readFileSync(
    path.resolve(__dirname, '../inject-auth.js'),
    'utf8'
);
const indexSource = fs.readFileSync(
    path.resolve(__dirname, '../index.html'),
    'utf8'
);
const authCallbackSource = fs.readFileSync(
    path.resolve(__dirname, '../js/auth-callback-page.js'),
    'utf8'
);
const authPopupHandoffSource = fs.readFileSync(
    path.resolve(__dirname, '../js/auth-popup-handoff.js'),
    'utf8'
);
const authPopupHandoffStyles = fs.readFileSync(
    path.resolve(__dirname, '../css/auth-popup-handoff.css'),
    'utf8'
);
const zhLocale = fs.readFileSync(
    path.resolve(__dirname, '../lang/zh.json'),
    'utf8'
);
const enLocale = fs.readFileSync(
    path.resolve(__dirname, '../lang/en.json'),
    'utf8'
);

test('frontend auth flow no longer persists passwords in localStorage', () => {
    assert.equal(authSource.includes("localStorage.setItem('saved_passwords'"), false);
    assert.equal(authSource.includes("localStorage.setItem('remembered_credentials'"), false);
    assert.equal(authSource.includes('password: btoa(password)'), false);
    assert.equal(authSource.includes('btoa(password)'), false);
});

test('frontend auth flow uses the backend login-security endpoint and email-only remember state', () => {
    assert.match(authSource, /\/api\/auth\/login-security/);
    assert.match(authSource, /zaoyoe_remembered_login_email_v1/);
    assert.equal(authSource.includes('remembered_credentials'), true);
    assert.match(injectAuthSource, /记住邮箱/);
});

test('login locale strings describe email-only remembering and IP abuse blocking', () => {
    assert.match(zhLocale, /"rememberMe": "记住邮箱"/);
    assert.match(zhLocale, /"ipBlocked": "当前网络请求过于频繁/);
    assert.match(enLocale, /"rememberMe": "Remember email"/);
    assert.match(enLocale, /"ipBlocked": "Too many requests were sent from this network/);
});

test('password reset handler finds the auth-sheet submit button outside the form', () => {
    assert.match(injectAuthSource, /data-auth-submit="reset" form="resetForm"/);
    assert.match(authSource, /document\.querySelector\('\[data-auth-submit="reset"\]\[form="resetForm"\], button\[type="submit"\]\[form="resetForm"\]'\)/);
    assert.equal(authSource.includes("document.querySelector('#resetForm button[type=\"submit\"]')"), false);
});

test('google popup callback is handed to the lightweight auth callback before the home page renders', () => {
    assert.match(indexSource, /\.\/css\/auth-popup-handoff\.css\?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1/);
    assert.match(indexSource, /\.\/js\/auth-popup-handoff\.js\?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1/);
    assert.match(authPopupHandoffStyles, /html\.auth-popup-handoff body/);
    assert.match(authPopupHandoffSource, /state\.startsWith\('zaoyoe_google_popup:'\)/);
    assert.match(authPopupHandoffSource, /new URL\('\/auth-callback\.html', window\.location\.origin\)/);
    assert.match(authPopupHandoffSource, /window\.location\.replace\(callbackUrl\.toString\(\)\)/);

    assert.match(authCallbackSource, /GOOGLE_POPUP_STATE_PREFIX = 'zaoyoe_google_popup:'/);
    assert.match(authCallbackSource, /const isGooglePopupState = \(value\)/);
    assert.match(authCallbackSource, /url\.searchParams\.get\('popup'\) === '1' \|\| isGooglePopupState\(popupState\)/);
    assert.match(authCallbackSource, /status: 'credential'/);
    assert.match(authCallbackSource, /broadcast: false/);
    assert.match(authSource, /payload\.status === 'credential'/);
    assert.match(authSource, /handleGoogleCredentialResponse\(\{ credential: payload\.credential \}/);
    assert.match(authSource, /function closeGoogleAuthSurfacesAfterSuccess\(\)/);
    assert.match(authSource, /function hasActiveGoogleAuthLoading\(\)/);
    assert.match(authSource, /window\.closeLoginModal\(\)/);
    assert.match(authSource, /loginModal\.hidden = true/);
    assert.match(authSource, /window\.iOSScrollLock\.unlock\(\)/);
    assert.match(authSource, /closeGoogleAuthSurfacesAfterSuccess\(\);\s*await handleGoogleCredentialResponse/);
    assert.match(authSource, /event === 'SIGNED_IN' && session && hasActiveGoogleAuthLoading\(\)/);
    assert.doesNotMatch(authSource, /typeof toggleLoginModal === 'function'/);
});
