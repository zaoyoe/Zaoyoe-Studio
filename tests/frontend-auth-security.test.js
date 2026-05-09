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
const shopSource = fs.readFileSync(
    path.resolve(__dirname, '../shop.html'),
    'utf8'
);
const promptsSource = fs.readFileSync(
    path.resolve(__dirname, '../prompts.html'),
    'utf8'
);
const verifySource = fs.readFileSync(
    path.resolve(__dirname, '../verify.html'),
    'utf8'
);
const guestbookSource = fs.readFileSync(
    path.resolve(__dirname, '../guestbook.html'),
    'utf8'
);
const privacySource = fs.readFileSync(
    path.resolve(__dirname, '../privacy.html'),
    'utf8'
);
const resetPasswordSource = fs.readFileSync(
    path.resolve(__dirname, '../reset-password.html'),
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
const authPopupCloseHtmlSource = fs.readFileSync(
    path.resolve(__dirname, '../auth-popup-close.html'),
    'utf8'
);
const authPopupCloseSource = fs.readFileSync(
    path.resolve(__dirname, '../js/auth-popup-close-page.js'),
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
    assert.match(authSource, /zaoyoe_remember_login_email_preference_v1/);
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

test('password reset invalid email feedback follows the active locale', () => {
    assert.match(authSource, /function isValidAuthEmailFormat\(email\)/);
    assert.match(authSource, /showAuthFeedback\(getInvalidResetEmailMessage\(\), 'error', 'reset'\)/);
    assert.match(authSource, /message\.includes\('unable to validate email address'\)/);
    assert.match(zhLocale, /"invalidResetEmailFormat": "请输入有效的邮箱地址"/);
    assert.match(enLocale, /"invalidResetEmailFormat": "Please enter a valid email address"/);
    assert.doesNotMatch(zhLocale, /invalidResetEmailFormat": "[^"]*Please enter a valid email address/);
    assert.doesNotMatch(enLocale, /invalidResetEmailFormat": "[^"]*请输入有效的邮箱地址/);
});

test('google popup callback is handed to the lightweight auth callback before the home page renders', () => {
    assert.match(indexSource, /\.\/css\/auth-popup-handoff\.css\?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1/);
    assert.match(indexSource, /\.\/js\/auth-popup-handoff\.js\?v=20260501_IOS_GOOGLE_REDIRECT_1/);
    assert.match(shopSource, /\.\/css\/auth-popup-handoff\.css\?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1/);
    assert.match(shopSource, /\.\/js\/auth-popup-handoff\.js\?v=20260501_IOS_GOOGLE_REDIRECT_1/);
    assert.match(promptsSource, /\.\/css\/auth-popup-handoff\.css\?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1/);
    assert.match(promptsSource, /\.\/js\/auth-popup-handoff\.js\?v=20260501_IOS_GOOGLE_REDIRECT_1/);
    assert.match(verifySource, /\.\/css\/auth-popup-handoff\.css\?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1/);
    assert.match(verifySource, /\.\/js\/auth-popup-handoff\.js\?v=20260501_IOS_GOOGLE_REDIRECT_1/);
    assert.match(guestbookSource, /\.\/css\/auth-popup-handoff\.css\?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1/);
    assert.match(guestbookSource, /\.\/js\/auth-popup-handoff\.js\?v=20260501_IOS_GOOGLE_REDIRECT_1/);
    assert.match(privacySource, /\.\/css\/auth-popup-handoff\.css\?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1/);
    assert.match(privacySource, /\.\/js\/auth-popup-handoff\.js\?v=20260501_IOS_GOOGLE_REDIRECT_1/);
    assert.match(resetPasswordSource, /\.\/css\/auth-popup-handoff\.css\?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1/);
    assert.match(resetPasswordSource, /\.\/js\/auth-popup-handoff\.js\?v=20260501_IOS_GOOGLE_REDIRECT_1/);
    assert.match(authPopupHandoffStyles, /html\.auth-popup-handoff body/);
    assert.match(authPopupHandoffSource, /state\.startsWith\('zaoyoe_google_popup:'\)/);
    assert.match(authPopupHandoffSource, /state\.startsWith\('zaoyoe_google_redirect:'\)/);
    assert.match(authPopupHandoffSource, /new URL\('\/auth-callback\.html', window\.location\.origin\)/);
    assert.match(authPopupHandoffSource, /window\.location\.replace\(callbackUrl\.toString\(\)\)/);

    assert.match(authCallbackSource, /GOOGLE_POPUP_STATE_PREFIX = 'zaoyoe_google_popup:'/);
    assert.match(authCallbackSource, /GOOGLE_REDIRECT_STATE_PREFIX = 'zaoyoe_google_redirect:'/);
    assert.match(authCallbackSource, /const isGooglePopupState = \(value\)/);
    assert.match(authCallbackSource, /const isGoogleRedirectState = \(value\)/);
    assert.match(authCallbackSource, /const isRedirectMode = isGoogleRedirectState\(googleAuthState\)/);
    assert.match(authCallbackSource, /url\.searchParams\.get\('popup'\) === '1' \|\| \(isGooglePopupState\(googleAuthState\) && !isRedirectMode\)/);
    assert.match(authCallbackSource, /status: 'credential'/);
    assert.match(authCallbackSource, /broadcast: false/);
    assert.match(authSource, /payload\.status === 'credential'/);
    assert.match(authSource, /function shouldUseGoogleSameTabRedirect\(\)/);
    assert.match(authSource, /function startGoogleSameTabRedirectLogin\(\)/);
    assert.match(authSource, /buildGoogleImplicitAuthUrl\(redirectState\)/);
    assert.match(authSource, /function buildGoogleImplicitAuthRedirectUri\(mode = 'same-tab'\)/);
    assert.match(authSource, /const GOOGLE_POPUP_ACK_MESSAGE_TYPE = 'zaoyoe:google-auth-popup-ack'/);
    assert.match(authSource, /const GOOGLE_POPUP_CLOSE_PREFETCH_SCRIPT_VERSION = '20260509_AUTH_POPUP_FAST_RETRY_1'/);
    assert.match(authSource, /const GOOGLE_POPUP_CLOSE_PREFETCH_STYLE_VERSION = '20260509_AUTH_POPUP_CLOSE_THEME_1'/);
    assert.match(authSource, /new URL\('\/auth-popup-close', window\.location\.origin\)/);
    assert.match(authSource, /function prefetchGooglePopupCloseShell\(\)/);
    assert.match(authSource, /link\.rel = 'prefetch'/);
    assert.match(authSource, /cache: 'force-cache'/);
    assert.match(authSource, /buildGoogleImplicitAuthUrl\(popupState, \{ mode: 'popup' \}\)/);
    assert.match(authSource, /ensureGooglePopupMessageBridge\(\);\s*openGooglePopupFallback\(\);/);
    assert.match(authSource, /authUrl\.searchParams\.set\('redirect_uri', buildGoogleImplicitAuthRedirectUri\(redirectMode\)\)/);
    assert.match(authSource, /function buildGooglePopupRedirectUrl\(mode = 'callback'\)/);
    assert.match(authSource, /let googlePopupClosureErrorTimer = null/);
    assert.match(authSource, /function clearGooglePopupClosureErrorTimer\(\)/);
    assert.match(authSource, /event\.source\.postMessage\(\{\s*type: GOOGLE_POPUP_ACK_MESSAGE_TYPE/);
    assert.match(authSource, /googlePopupClosureErrorTimer = setTimeout\(\(\) => \{/);
    assert.match(authSource, /handleGoogleCredentialResponse\(\{ credential: payload\.credential \}/);
    assert.match(authSource, /function closeGoogleAuthSurfacesAfterSuccess\(\)/);
    assert.match(authSource, /function hasActiveModalBehindLogin\(\)/);
    assert.match(authSource, /function hasActiveGoogleAuthLoading\(\)/);
    assert.match(authSource, /window\.closeLoginModal\(\)/);
    assert.match(authSource, /loginModal\.hidden = true/);
    assert.match(authSource, /window\.iOSScrollLock && !hasActiveModalBehindLogin\(\)/);
    assert.match(authSource, /window\.iOSScrollLock\.unlock\(\)/);
    assert.match(authSource, /closeGoogleAuthSurfacesAfterSuccess\(\);\s*await handleGoogleCredentialResponse/);
    assert.match(authSource, /event === 'SIGNED_IN' && session && hasActiveGoogleAuthLoading\(\)/);
    assert.doesNotMatch(authSource, /async function tryGoogleInteractivePrompt\(\)/);
    assert.doesNotMatch(authSource, /window\.google\.accounts\.id\.prompt\(\(notification\) => \{/);
    assert.doesNotMatch(authSource, /typeof toggleLoginModal === 'function'/);

    assert.match(authPopupCloseHtmlSource, /\.\/js\/auth-popup-close-page\.js\?v=20260509_AUTH_POPUP_FAST_RETRY_1/);
    assert.doesNotMatch(authPopupCloseHtmlSource, /@supabase\/supabase-js/);
    assert.match(authPopupCloseSource, /const isPopupMode = url\.searchParams\.get\('popup'\) === '1' \|\| \(isPopupState && !isRedirectState\)/);
    assert.match(authPopupCloseSource, /function createPopupMessage\(payload\)/);
    assert.match(authPopupCloseSource, /function dispatchPopupResult\(message, options = \{\}\)/);
    assert.match(authPopupCloseSource, /setTimeout\(\(\) => notifyOpener\(message, \{ broadcast: shouldBroadcast \}\), 10\)/);
    assert.match(authPopupCloseSource, /setTimeout\(\(\) => \{\s*attemptClosePopup\(true\);\s*\}, 24\)/);
    assert.match(authPopupCloseSource, /dispatchPopupResult\(credentialMessage, \{ broadcast: false \}\)/);
    assert.match(authPopupCloseSource, /fallbackToFullCallback\(\)/);
});

test('public login modal waits for the auth sheet runtime before becoming visible', () => {
    assert.match(authSource, /function requestLoginModalOpen\(view = 'login'\)/);
    assert.match(authSource, /window\.addEventListener\('zaoyoe:auth-markup-ready', retryOpen, \{ once: true \}\)/);
    assert.match(authSource, /const pendingLoginModalKey = 'openLoginModal';[\s\S]*sessionStorage\.setItem\(pendingLoginModalKey, 'true'\)/);
    assert.doesNotMatch(
        authSource,
        /loginModal\.hidden = false;\s*loginModal\.setAttribute\('aria-hidden', 'false'\);\s*loginModal\.classList\.add\('active'\);/
    );

    assert.match(injectAuthSource, /id="loginModal"[\s\S]*style="display: none;"/);
    assert.match(injectAuthSource, /function areAuthSheetStylesApplied\(overlay = document\.getElementById\('loginModal'\)\)/);
    assert.match(injectAuthSource, /sheetStyle\.display === 'grid'[\s\S]*inputProxyHeight >= 40/);
    assert.match(injectAuthSource, /await waitForAuthSheetStylesApplied\(overlay\);[\s\S]*setInjectedAuthStyleProperty\(overlay, 'display', null\);\s*overlay\.hidden = false;/);
    assert.match(injectAuthSource, /function hasActiveShopModalBehindAuthSheet\(\)/);
    assert.match(injectAuthSource, /function lockAuthSheetScroll\(overlay, options = \{\}\)/);
    assert.match(injectAuthSource, /overlay\.classList\.toggle\('auth-sheet-over-shop-modal', overShopModal\)/);
    assert.match(injectAuthSource, /window\.iOSScrollLock\.lock\(overlay, \{ freezeScrollY \}\)/);
    assert.match(injectAuthSource, /lockAuthSheetScroll\(overlay, \{ overShopModal \}\);/);
});
