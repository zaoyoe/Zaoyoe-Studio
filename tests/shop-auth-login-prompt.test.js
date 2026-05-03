const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('shop unauthenticated redeem flow opens the auth sheet directly without blocking alerts', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const injectAuthSource = readRepoFile('inject-auth.js');

    assert.match(
        shopClientSource,
        /promptLoginForPurchase:\s*function\s*\(/,
        'shop-client.js should centralize guest redeem login prompts so the auth sheet can open smoothly'
    );
    assert.match(
        shopClientSource,
        /window\.openLoginModalWithMessage/,
        'shop-client.js should use the shared auth helper when a guest taps redeem'
    );
    assert.doesNotMatch(
        shopClientSource,
        /alert\(window\.i18n\?\.t\('shop\.loginRequired'\)/,
        'shop-client.js should no longer rely on a blocking alert before opening the auth sheet'
    );
    assert.match(
        injectAuthSource,
        /window\.openLoginModalWithMessage = openLoginModalWithMessage;/,
        'inject-auth.js should expose a helper for opening the auth sheet with a contextual message'
    );
});

test('shop guest redeem auth prompt is part of the first auth sheet layout frame', () => {
    const injectAuthSource = readRepoFile('inject-auth.js');

    assert.match(
        injectAuthSource,
        /async function openLoginModal\(viewId = sheetState\.lastPrimaryView \|\| 'login', options = \{\}\)/,
        'openLoginModal should accept initial message options for first-frame rendering'
    );
    assert.match(
        injectAuthSource,
        /await setAuthView\(viewId, \{ clearMessage: true \}\);[\s\S]*?renderAuthMessage\(initialMessage, initialMessageType\);[\s\S]*?window\.requestAnimationFrame\(\(\) => \{\s*overlay\.classList\.add\('active'\);/s,
        'the contextual shop login message should render before the sheet becomes visible'
    );
    assert.match(
        injectAuthSource,
        /await openLoginModal\(viewId, \{\s*initialMessage: normalizedMessage,\s*initialMessageType: type\s*\}\);/,
        'openLoginModalWithMessage should pass the message into the initial auth sheet layout'
    );
    assert.doesNotMatch(
        injectAuthSource,
        /const presentMessage = \(\) =>/,
        'the shop login message should not be injected in a later animation frame'
    );
});

test('mobile safari auth input follows the deployed in-place focus contract', () => {
    const injectAuthSource = readRepoFile('inject-auth.js');
    const authSheetStyles = readRepoFile(path.join('css', 'auth-sheet.css'));

    assert.doesNotMatch(
        injectAuthSource,
        /authSheetKeyboardState|applyAuthSheetKeyboardViewportState|scheduleAuthSheetKeyboardStabilization|auth-sheet-keyboard-docked/,
        'inject-auth.js should not add a second custom visualViewport dock on top of iOS Safari focus handling'
    );
    assert.match(
        injectAuthSource,
        /function shouldUseInPlaceAuthInput\(\) \{\s*return isIOSMobile\(\) && window\.matchMedia\('\(max-width: 768px\)'\)\.matches;\s*\}/,
        'iOS mobile auth fields should keep the real input in place inside the sheet like the deployed version'
    );
    assert.match(
        injectAuthSource,
        /if \(useInPlaceInput\) \{[\s\S]*position: 'absolute',[\s\S]*pointerEvents: 'auto'[\s\S]*setPortaledInputVisibility\(input, portalState\.proxy, true\);[\s\S]*return;/,
        'iOS mobile auth fields should align the real input over its proxy instead of using the fixed input plane'
    );
    assert.match(
        injectAuthSource,
        /function lockAuthSheetScroll\(overlay, options = \{\}\) \{[\s\S]*const freezeScrollY = Math\.max\(0, Math\.round\(window\.scrollY \|\| window\.pageYOffset \|\| 0\)\);[\s\S]*window\.iOSScrollLock\.lock\(overlay, \{ freezeScrollY \}\);/,
        'the auth sheet should use the deployed full iOS scroll lock path for keyboard focus'
    );
    assert.doesNotMatch(
        injectAuthSource,
        /window\.visualViewport\?\.addEventListener\('resize'[\s\S]*authSheet/i,
        'auth sheet should not run its own visualViewport resize dock loop'
    );
    assert.match(
        authSheetStyles,
        /body\.auth-sheet-open \{\s*overflow: hidden;\s*\}/,
        'auth sheet should keep the deployed body lock stylesheet contract'
    );
    assert.doesNotMatch(
        authSheetStyles,
        /auth-sheet-keyboard-docked|auth-sheet-keyboard-translate-y|body\.auth-sheet-open[\s\S]*overflow: visible/,
        'auth-sheet.css should not keep the removed custom keyboard-dock styles'
    );
});
