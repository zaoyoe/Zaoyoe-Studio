const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('mobile keyboard overlays use the customer-service light-lock dock contract', () => {
    const shopClient = readRepoFile(path.join('js', 'shop-client.js'));
    const homepageGuestbookModal = readRepoFile(path.join('js', 'homepage-guestbook-modal.js'));
    const guestbook = readRepoFile('guestbook.js');
    const profileAuth = readRepoFile('supabase-auth-functions.js');
    const injectAuth = readRepoFile('inject-auth.js');
    const adminChat = readRepoFile(path.join('js', 'admin-chat.js'));
    const chatWidget = readRepoFile(path.join('js', 'components', 'ChatWidget.js'));
    const walletModal = readRepoFile(path.join('js', 'components', 'WalletModal.js'));
    const promptsPoetry = readRepoFile('prompts-poetry.js');
    const scrollLock = readRepoFile(path.join('js', 'ios-scroll-lock.js'));

    assert.doesNotMatch(
        shopClient,
        /iOSScrollLock\.lock\(card/,
        'purchase modal should not upgrade to fixed-body iOS scroll lock when the keyboard opens'
    );
    assert.doesNotMatch(
        homepageGuestbookModal,
        /iOSScrollLock\.lock\(card/,
        'homepage guestbook modal should keep the same light-lock behavior as the customer-service widget'
    );

    assert.match(shopClient, /window\.iOSScrollLock\.lockLight\(overlay\);/);
    assert.match(homepageGuestbookModal, /window\.iOSScrollLock\.lockLight\(overlay\);/);
    assert.match(guestbook, /window\.iOSScrollLock\.lockLight\(modal\);/);
    assert.match(profileAuth, /window\.iOSScrollLock\.lockLight\(overlay \|\| null, \{[\s\S]*restoreScrollDuringViewport: true/);
    assert.match(profileAuth, /function applyProfileModalLayout\(\{ ensureInput = true, allowUndock = true \} = \{\}\) \{/);
    assert.match(profileAuth, /const PROFILE_MODAL_KEYBOARD_SETTLE_MS = 260;/);
    assert.match(profileAuth, /const PROFILE_MODAL_KEYBOARD_RESIZE_IDLE_MS = 180;/);
    assert.match(profileAuth, /const PROFILE_MODAL_KEYBOARD_MOTION_MS = 250;/);
    assert.match(profileAuth, /scrollAnimationRafId: 0,/);
    assert.match(profileAuth, /focusScrollRafId: 0,[\s\S]*focusScrollTimer: null,[\s\S]*focusScrollSuppressUntil: 0,/);
    assert.match(profileAuth, /lastKeyboardBottomInset: 0,[\s\S]*lastDockHeight: 0,[\s\S]*lastTranslateY: 0,/);
    assert.match(profileAuth, /const duration = Math\.max\([\s\S]*options\.minDuration \?\? 180,[\s\S]*Math\.min\(options\.maxDuration \?\? 340, Math\.round\(Math\.abs\(distance\) \* \(options\.durationFactor \?\? 0\.72\)\)\)/);
    assert.match(profileAuth, /profileModalState\.scrollAnimationRafId = requestAnimationFrame\(step\);/);
    assert.doesNotMatch(profileAuth, /scrollTo\(\{ top: to, behavior: 'smooth' \}\)/);
    assert.match(profileAuth, /function getProfileModalInputTargetScrollTop\(input = getActiveProfileModalInput\(\)\) \{/);
    assert.match(profileAuth, /function animateProfileModalScroll\(scrollHost, targetScrollTop, options = \{\}\) \{/);
    assert.match(profileAuth, /options\.minDuration \?\? 180/);
    assert.match(profileAuth, /function markProfileModalKeyboardResizing\(\) \{/);
    assert.match(profileAuth, /function scheduleProfileModalInitialKeyboardDock\(metrics\) \{/);
    assert.match(profileAuth, /function scheduleProfileModalFocusedInputScroll\(input, delay = 0\) \{/);
    assert.match(profileAuth, /const requiresWarmup = profileModalState\.lastStableKeyboardInset <= 40;/);
    assert.match(profileAuth, /const fallbackHeight = Math\.min\(600, Math\.max\(420, Math\.round\(baseViewportHeight \* 0\.7\)\)\);/);
    assert.match(profileAuth, /const targetBottom = Math\.max\(40, keyboardTop - keyboardClearance\);/);
    assert.match(profileAuth, /setAuthStyleState\(card, \{[\s\S]*height: `\$\{dockHeight\}px`,[\s\S]*maxHeight: `\$\{dockHeight\}px`/);
    assert.match(profileAuth, /profileModalState\.keyboardBlurUndocking = true;[\s\S]*resetProfileModalKeyboardDock\(true\);/);
    assert.match(profileAuth, /const preserveFocusDock = Boolean\([\s\S]*profileModalState\.preserveLayoutDuringFocusTransfer[\s\S]*profileModalState\.lastDockHeight > 0/);
    assert.match(profileAuth, /else if \(!preserveFocusDock && Math\.abs\(metrics\.bottomInset - profileModalState\.lastKeyboardBottomInset\) > 1\)/);
    assert.match(profileAuth, /if \(docked\) \{[\s\S]*scheduleProfileModalFocusedInputScroll\(input\);[\s\S]*return;/);
    assert.match(profileAuth, /profileModalState\.focusScrollSuppressUntil = Date\.now\(\) \+ 120;/);
    assert.match(profileAuth, /if \(wasDockedBeforeFocus && scrollHost && Number\.isFinite\(beforeFocusScrollTop\)\) \{[\s\S]*scrollHost\.scrollTop = beforeFocusScrollTop;/);
    assert.match(profileAuth, /scheduleProfileModalFocusedInputScroll\(input, 34\);/);
    assert.match(profileAuth, /if \(options\.finishKeyboardResize\) \{[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*classList\.remove\('profile-modal-keyboard-resizing'\);[\s\S]*\}\);[\s\S]*\}/);
    assert.match(profileAuth, /const handleViewportChange = \(\) => \{[\s\S]*markProfileModalKeyboardResizing\(\);[\s\S]*scheduleProfileModalLayout\(\{ settled: true, ensureInput: false, allowUndock: false \}\);[\s\S]*\};/);
    assert.match(profileAuth, /runLayout\(\{ ensureInput: true, allowUndock: true, finishKeyboardResize: true \}\);/);

    [shopClient, guestbook, profileAuth].forEach((source) => {
        assert.match(
            source,
            /const keyboardClearance = 12;[\s\S]*const targetBottom = Math\.max\(40, keyboardTop - keyboardClearance\);/,
            'modal dock math should leave the same 12px keyboard/address-bar clearance as customer service'
        );
    });
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_KEYBOARD_CLEARANCE = 12;/);
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_FOCUS_SCROLL_RESTORE_DELAYS = \[0, 40, 90, 160, 260, 420, 620, 860, 1120, 1460\];/);
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_FOCUS_SCROLL_FOLLOWUP_DELAYS = \[48, 120, 240, 420, 680, 960, 1280\];/);
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_VIEWPORT_SETTLE_DELAYS = \[80, 160, 280, 420, 620, 860, 1120, 1460\];/);
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_FRESH_SAMPLE_MS = 900;/);
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_MAX_KEYBOARD_RATIO = 0\.62;/);
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_MIN_TOP = 12;/);
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_BASE_SHEET_HEIGHT = 400;/);
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_AUTH_FLASH_MS = 1080;/);
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_AUTH_GATE_DELAY_MS = 320;/);
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_BACKDROP_CLOSE_GUARD_MS = 260;/);
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_BACKDROP_TAP_MOVE_PX = 14;/);
    assert.match(promptsPoetry, /let promptCommentComposerLayoutHeight = 0;/);
    assert.match(promptsPoetry, /let promptCommentComposerKeyboardOffset = 0;/);
    assert.match(promptsPoetry, /let promptCommentComposerDeferredFocusRafId = null;/);
    assert.match(promptsPoetry, /let promptCommentComposerViewportSettleTimers = \[\];/);
    assert.match(promptsPoetry, /let promptCommentComposerLoginGateTimer = null;/);
    assert.match(promptsPoetry, /let promptCommentComposerAuthGateActive = false;/);
    assert.match(promptsPoetry, /let promptCommentComposerOpenedAt = 0;/);
    assert.match(promptsPoetry, /let promptCommentComposerBackdropTouch = null;/);
    assert.doesNotMatch(promptsPoetry, /let promptCommentComposerDocked/);
    assert.doesNotMatch(promptsPoetry, /let promptCommentComposerLastBottomInset/);
    assert.doesNotMatch(promptsPoetry, /let promptCommentComposerInitialDockTimer/);
    assert.doesNotMatch(promptsPoetry, /let promptCommentComposerFocusedReleaseTimer/);
    assert.doesNotMatch(promptsPoetry, /PROMPT_COMMENT_COMPOSER_DOCK_/);
    assert.doesNotMatch(promptsPoetry, /PROMPT_COMMENT_COMPOSER_FOCUSED_RELEASE_MS/);
    assert.match(promptsPoetry, /function getPromptCommentComposerStableViewportHeight\(\) \{/);
    assert.match(promptsPoetry, /function getPromptCommentComposerViewportSnapshot\(\) \{/);
    assert.match(promptsPoetry, /function freezePromptCommentComposerUnderlay\(\) \{/);
    assert.match(promptsPoetry, /function releasePromptCommentComposerUnderlayFreeze\(\) \{/);
    assert.match(promptsPoetry, /function syncPromptCommentComposerUnderlayFreeze\(\) \{/);
    assert.match(promptsPoetry, /function requestPromptCommentComposerUnderlayFreezeSync\(\) \{/);
    assert.match(promptsPoetry, /function hardRestorePromptCommentComposerPageScroll\(\) \{[\s\S]*document\.documentElement\.scrollTop = targetY;[\s\S]*document\.body\.scrollTop = targetY;/);
    assert.match(promptsPoetry, /function settlePromptCommentComposerParentFrame\(\) \{[\s\S]*modal\.classList\.remove\('modal-opening'\);[\s\S]*lockPromptModalCommentModeGeometry\(\{ force: true \}\);[\s\S]*hardRestorePromptCommentComposerPageScroll\(\);/);
    assert.match(promptsPoetry, /function capturePromptCommentComposerOverlayFrame\(force = false\) \{/);
    assert.match(promptsPoetry, /promptCommentComposerLayoutHeight = Math\.max\(PROMPT_COMMENT_COMPOSER_MIN_TOP, snapshot\.measuredHeight\);/);
    assert.match(promptsPoetry, /'--prompt-comment-composer-viewport-top': '0px',[\s\S]*'--prompt-comment-composer-viewport-left': '0px',[\s\S]*'--prompt-comment-composer-viewport-width': `\$\{snapshot\.layoutWidth\}px`,[\s\S]*'--prompt-comment-composer-overlay-height': `\$\{layoutHeight\}px`/);
    assert.match(promptsPoetry, /function getPromptCommentComposerSheetLayout\(sheet, snapshot, keyboardOffset\) \{/);
    assert.match(promptsPoetry, /const keyboardTop = Math\.max\(0, layoutHeight - Math\.max\(0, keyboardOffset\)\);/);
    assert.match(promptsPoetry, /const maxRestingTop = Math\.max\([\s\S]*Math\.round\(layoutHeight - sheetHeight - PROMPT_COMMENT_COMPOSER_MIN_TOP\)[\s\S]*\);/);
    assert.match(promptsPoetry, /Math\.min\(maxRestingTop, Math\.round\(\(layoutHeight - sheetHeight\) \/ 2\)\)/);
    assert.match(promptsPoetry, /Math\.round\(keyboardTop - sheetHeight - PROMPT_COMMENT_COMPOSER_KEYBOARD_CLEARANCE\)/);
    assert.match(promptsPoetry, /'--composer-keyboard-offset': `\$\{keyboardOffset\}px`,[\s\S]*'--composer-sheet-top': `\$\{sheetLayout\.sheetTop\}px`/);
    assert.doesNotMatch(promptsPoetry, /normalizedViewportDelta/);
    assert.doesNotMatch(promptsPoetry, /function getPromptCommentComposerViewportMetrics\(\) \{/);
    assert.doesNotMatch(promptsPoetry, /function getPromptCommentComposerDockGeometry/);
    assert.doesNotMatch(promptsPoetry, /function getPromptCommentComposerDockViewportHeight/);
    assert.doesNotMatch(promptsPoetry, /function applyPromptCommentComposerDock/);
    assert.doesNotMatch(promptsPoetry, /function releasePromptCommentComposerDock/);
    assert.doesNotMatch(promptsPoetry, /function applyPromptCommentComposerSheetHeight/);
    assert.doesNotMatch(promptsPoetry, /function getPromptCommentComposerDockKeyboardReserve/);
    assert.doesNotMatch(promptsPoetry, /PROMPT_COMMENT_COMPOSER_REST_BOTTOM/);
    assert.doesNotMatch(promptsPoetry, /PROMPT_COMMENT_COMPOSER_AUTH_ALERT_DURATION_MS/);
    assert.doesNotMatch(promptsPoetry, /function queuePromptCommentComposerLoginModal/);
    assert.doesNotMatch(promptsPoetry, /keyboardReserve/);
    assert.doesNotMatch(promptsPoetry, /const dockTargetBottom = Math\.max\(40, Math\.round\(viewportBottom - PROMPT_COMMENT_COMPOSER_KEYBOARD_CLEARANCE\)\);/);
    assert.doesNotMatch(promptsPoetry, /const centeredTop = \(baseViewportHeight - finalSheetHeight\) \/ 2;/);
    assert.doesNotMatch(promptsPoetry, /const shiftY = Math\.round\(desiredTop - centeredTop\);/);
    assert.doesNotMatch(promptsPoetry, /metrics\.keyboardTop/);
    assert.doesNotMatch(promptsPoetry, /getPromptCommentComposerEffectiveBottomInset/);
    assert.doesNotMatch(promptsPoetry, /getPromptCommentComposerStableScreenHeight/);
    assert.match(promptsPoetry, /window\.iOSScrollLock\.lockLight\(overlay, \{ restoreScrollDuringViewport: true \}\);/);
    assert.doesNotMatch(promptsPoetry, /window\.iOSScrollLock\.lock\(overlay/);
    assert.doesNotMatch(promptsPoetry, /window\.iOSScrollLock\.lockLight\(overlay, \{ restoreScrollDuringViewport: false \}\);/);
    assert.match(promptsPoetry, /window\.iOSScrollLock\.lockLight\(modalInner, \{ restoreScrollDuringViewport: true \}\);/);
    assert.match(promptsPoetry, /function getPromptCommentComposerFocusScrollSnapshot\(\) \{/);
    assert.match(promptsPoetry, /function restorePromptCommentComposerFocusScroll\(snapshot = promptCommentComposerFocusScrollLock\) \{/);
    assert.match(promptsPoetry, /function lockPromptCommentComposerFocusScroll\(snapshot = null\) \{/);
    assert.match(promptsPoetry, /promptCommentComposerFocusScrollFollowupTimers = PROMPT_COMMENT_COMPOSER_FOCUS_SCROLL_FOLLOWUP_DELAYS\.map/);
    assert.match(promptsPoetry, /function schedulePromptCommentComposerViewportSettleSync\(\) \{[\s\S]*PROMPT_COMMENT_COMPOSER_VIEWPORT_SETTLE_DELAYS\.forEach/);
    assert.match(promptsPoetry, /function schedulePromptCommentComposerSettledFocus\(input, snapshot = null\) \{[\s\S]*settlePromptCommentComposerParentFrame\(\);[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*focusPromptCommentComposerInputWithoutScroll\(input, focusSnapshot\);/);
    assert.match(promptsPoetry, /function canClosePromptCommentComposerFromBackdrop\(\) \{[\s\S]*Date\.now\(\) - promptCommentComposerOpenedAt >= PROMPT_COMMENT_COMPOSER_BACKDROP_CLOSE_GUARD_MS/);
    assert.match(promptsPoetry, /function closePromptCommentComposerFromBackdrop\(\) \{[\s\S]*closePromptCommentComposer\(\{ preserveModalDock: true \}\);[\s\S]*\}/);
    assert.match(promptsPoetry, /function getPromptCommentComposerTouchPoint\(event, changed = false\) \{/);
    assert.match(promptsPoetry, /window\.addEventListener\('scroll', handleRootScroll, \{ passive: true \}\);/);
    assert.match(promptsPoetry, /const handleBackdropClick = \(e\) => \{[\s\S]*closePromptCommentComposerFromBackdrop\(\);[\s\S]*\};/);
    assert.match(promptsPoetry, /const handleBackdropTouchStart = \(e\) => \{[\s\S]*promptCommentComposerBackdropTouch = \{[\s\S]*cancelled: false[\s\S]*\};/);
    assert.match(promptsPoetry, /const handleBackdropTouchMove = \(e\) => \{[\s\S]*PROMPT_COMMENT_COMPOSER_BACKDROP_TAP_MOVE_PX[\s\S]*promptCommentComposerBackdropTouch\.cancelled = true;/);
    assert.match(promptsPoetry, /const handleBackdropTouchEnd = \(e\) => \{[\s\S]*const wasTap = !promptCommentComposerBackdropTouch\.cancelled;[\s\S]*if \(wasTap\) \{[\s\S]*closePromptCommentComposerFromBackdrop\(\);/);
    assert.match(promptsPoetry, /overlay\.addEventListener\('touchend', handleBackdropTouchEnd, \{ passive: false \}\);/);
    assert.doesNotMatch(promptsPoetry, /if \(e\.target === overlay\) \{[\s\S]*closePromptCommentComposer\(\);[\s\S]*\}/);
    assert.doesNotMatch(promptsPoetry, /setPromptsCssVars\(modal, \{[\s\S]*display: 'none'/);
    assert.doesNotMatch(promptsPoetry, /setPromptsCssVars\(backdrop, \{[\s\S]*display: 'none'/);
    assert.doesNotMatch(promptsPoetry, /promptCommentComposerScrollClampCleanup\s*=\s*clampPromptModalPageScroll/);
    assert.doesNotMatch(promptsPoetry, /function clampPromptModalPageScroll/);
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_KEYBOARD_SETTLE_MS = 420;/);
    assert.doesNotMatch(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_HIDDEN_RESET_MS = 160;/);
    assert.doesNotMatch(promptsPoetry, /function isPromptCommentComposerKeyboardSettling\(\) \{/);
    assert.doesNotMatch(promptsPoetry, /function resetPromptCommentComposerKeyboardCycle\(\) \{/);
    assert.doesNotMatch(promptsPoetry, /function schedulePromptCommentComposerKeyboardCycleReset\(delay = PROMPT_COMMENT_COMPOSER_HIDDEN_RESET_MS\) \{/);
    const promptComposerInputTouchBlock = promptsPoetry.match(/input\.addEventListener\('touchstart', \(event\) => \{[\s\S]*?\n    \}, \{ passive: false \}\);/)?.[0] || '';
    assert.match(promptComposerInputTouchBlock, /if \(document\.activeElement === input\) \{[\s\S]*schedulePromptCommentComposerFocusScrollRestore\(\{ withFollowup: true \}\);[\s\S]*return;[\s\S]*\}/);
    assert.match(promptComposerInputTouchBlock, /if \(event\?\.cancelable\) event\.preventDefault\(\);[\s\S]*focusPromptCommentComposerInputWithoutScroll\(input\);/);
    assert.doesNotMatch(promptComposerInputTouchBlock, /preparePromptCommentComposerForInputFocus\(\);/);
    assert.doesNotMatch(promptsPoetry, /isStaleFocusedHiddenKeyboard/);
    assert.doesNotMatch(promptsPoetry, /schedulePromptCommentComposerHiddenFocusDetach/);
    assert.match(promptsPoetry, /commentInput\.setAttribute\('inputmode', 'none'\);/);
    assert.match(promptsPoetry, /commentInput\.setAttribute\('tabindex', '-1'\);/);
    assert.match(promptsPoetry, /commentInputProxy\?\.addEventListener\('touchstart', \(e\) => launchComposer\(e\), \{ passive: false \}\);/);
    assert.match(promptsPoetry, /commentInput\.addEventListener\('focus', \(e\) => launchComposer\(e\)\);/);
    assert.match(promptsPoetry, /if \(document\.activeElement === commentInput\) \{[\s\S]*commentInput\.blur\(\);[\s\S]*\}/);
    const promptComposerPrepareBlock = promptsPoetry.match(/function preparePromptCommentComposerForInputFocus\(focusSnapshot = null\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(promptComposerPrepareBlock, /sheet\?\.classList\.remove\('composer-animating'\);[\s\S]*suspendPromptModalKeyboardDockForCommentComposer\(\);[\s\S]*freezePromptCommentComposerUnderlay\(\);[\s\S]*capturePromptCommentComposerOverlayFrame\(!promptCommentComposerLayoutHeight\);[\s\S]*lockPromptCommentComposerPage\(\);[\s\S]*lockPromptCommentComposerFocusScroll\(focusSnapshot\);[\s\S]*syncPromptCommentComposerViewport\(\{ animate: false \}\);/);
    assert.doesNotMatch(promptComposerPrepareBlock, /clearPromptCommentComposerKeyboardTimers\(\);/);
    assert.doesNotMatch(promptComposerPrepareBlock, /capturePromptCommentComposerViewportBase\(\);/);
    assert.match(promptsPoetry, /promptCommentComposerLayoutHeight = 0;[\s\S]*promptCommentComposerBaseSheetHeight = 0;[\s\S]*promptCommentComposerOverlayBaseHeight = 0;[\s\S]*promptCommentComposerKeyboardOffset = 0;/);
    assert.match(promptsPoetry, /function resetPromptCommentComposerKeyboardState\(\) \{[\s\S]*overlay\?\.classList\.remove\('keyboard-docked', 'keyboard-active'\);[\s\S]*'--composer-keyboard-offset': '0px'/);
    assert.match(promptsPoetry, /function resetPromptCommentComposerViewportStyles\(\) \{[\s\S]*resetPromptCommentComposerKeyboardState\(\);[\s\S]*restorePromptCommentComposerOverlay\(\);[\s\S]*\}/);
    assert.match(promptsPoetry, /const rawKeyboardOffset = Math\.max\(0, Math\.round\(\(snapshot\?\.layoutHeight \|\| 0\) - \(snapshot\?\.visualBottom \|\| 0\)\)\);/);
    assert.match(promptsPoetry, /Date\.now\(\) - promptCommentComposerOpenedAt < PROMPT_COMMENT_COMPOSER_FRESH_SAMPLE_MS;/);
    assert.match(promptsPoetry, /if \(isFreshKeyboardSample && maxKeyboardOffset > 0 && rawKeyboardOffset > maxKeyboardOffset\) \{[\s\S]*schedulePromptCommentComposerViewportSettleSync\(\);[\s\S]*return;/);
    assert.match(promptsPoetry, /const keyboardOffset = activeInput \? Math\.min\(rawKeyboardOffset, maxKeyboardOffset \|\| rawKeyboardOffset\) : 0;/);
    assert.doesNotMatch(promptsPoetry, /function getPromptCommentComposerPredictedKeyboardOffset\(snapshot\) \{/);
    assert.doesNotMatch(promptsPoetry, /forceKeyboardOffset/);
    assert.doesNotMatch(promptsPoetry, /promptCommentComposerLastStableKeyboardOffset/);
    assert.doesNotMatch(promptsPoetry, /isInsetDroppingWhileFocused/);
    assert.doesNotMatch(promptsPoetry, /const handleInputBlur = \(\) => \{[\s\S]*releasePromptCommentComposerDock\(true\);[\s\S]*\};/);
    assert.doesNotMatch(promptsPoetry, /const zeroBottom = Math\.round\(overlayTop \+ \(sheet\.offsetTop \|\| 0\) \+ dockHeight\);/);
    assert.doesNotMatch(promptsPoetry, /Math\.round\(targetBottom - zeroBottom\)/);
    assert.match(promptsPoetry, /input\?\.addEventListener\('focus', \(\) => \{[\s\S]*preparePromptCommentComposerForInputFocus\(\);[\s\S]*overlay\.classList\.add\('ios-focus-lock'\);/);
    assert.match(promptComposerPrepareBlock, /finishPromptCommentComposerEnterAnimation\(\);[\s\S]*lockPromptCommentComposerPage\(\);[\s\S]*setPromptCommentComposerKeyboardSettling\(true\);/);
    assert.match(promptsPoetry, /function focusPromptCommentComposerInputWithoutScroll\(input, focusSnapshot = null\) \{[\s\S]*const snapshot = focusSnapshot \|\| getPromptCommentComposerFocusScrollSnapshot\(\);[\s\S]*preparePromptCommentComposerForInputFocus\(snapshot\);[\s\S]*input\.focus\(\{ preventScroll: true \}\);[\s\S]*restorePromptCommentComposerFocusScroll\(snapshot\);[\s\S]*schedulePromptCommentComposerViewportSettleSync\(\);/);
    assert.match(promptsPoetry, /suspendPromptModalKeyboardDockForCommentComposer\(\);[\s\S]*freezePromptCommentComposerUnderlay\(\);[\s\S]*capturePromptCommentComposerOverlayFrame\(true\);[\s\S]*syncPromptCommentComposerViewport\(\{ animate: false \}\);[\s\S]*startPromptCommentComposerEnterAnimation\(composer\.overlay\);[\s\S]*lockPromptCommentComposerPage\(\);/);
    assert.match(promptsPoetry, /const isAlreadyActive = composer\.overlay\.classList\.contains\('active'\) &&[\s\S]*!composer\.overlay\.classList\.contains\('composer-closing'\);[\s\S]*if \(isAlreadyActive\) \{[\s\S]*freezePromptCommentComposerUnderlay\(\);[\s\S]*lockPromptCommentComposerFocusScroll\(promptCommentComposerFocusScrollLock \|\| getPromptCommentComposerFocusScrollSnapshot\(\)\);[\s\S]*return true;[\s\S]*\}/);
    assert.match(promptsPoetry, /const openingScrollSnapshot = getPromptCommentComposerFocusScrollSnapshot\(\);[\s\S]*composer\.overlay\.classList\.add\('active'\);[\s\S]*promptCommentComposerOpenedAt = Date\.now\(\);[\s\S]*promptCommentComposerBackdropTouch = null;[\s\S]*lockPromptCommentComposerFocusScroll\(openingScrollSnapshot\);[\s\S]*freezePromptCommentComposerUnderlay\(\);[\s\S]*lockPromptCommentComposerPage\(\);[\s\S]*restorePromptCommentComposerFocusScroll\(openingScrollSnapshot\);/);
    assert.match(promptsPoetry, /syncPromptCommentComposerViewport\(\{ animate: true \}\);/);
    assert.match(promptsPoetry, /function openPromptCommentComposerLoginGate\(\) \{[\s\S]*closePromptCommentComposer\(\{ preserveModalDock: true \}\);[\s\S]*showLoginModal\(\);[\s\S]*PROMPT_COMMENT_COMPOSER_AUTH_GATE_DELAY_MS/);
    assert.match(promptsPoetry, /sendBtn\?\.addEventListener\('click', \(event\) => \{[\s\S]*submitComment\(\{ source: 'prompt-comment-composer-send' \}\);[\s\S]*\}\);/);
    assert.match(promptsPoetry, /function handleCommentKeydown\(e\) \{[\s\S]*if \(isPromptCommentComposerEnabled\(\) && e\.target\?\.id === 'promptCommentComposerInput'\) \{[\s\S]*return;[\s\S]*\}[\s\S]*submitComment\(\{ source: 'keyboard' \}\);/);
    assert.match(promptsPoetry, /async function submitComment\(options = \{\}\) \{[\s\S]*const input = getActiveCommentInput\(\);[\s\S]*if \(!input\) return;[\s\S]*const content = input\.value\.trim\(\);[\s\S]*if \(!content && !selectedCommentImage\) \{[\s\S]*return;[\s\S]*\}[\s\S]*window\.supabaseClient\.auth\.getUser\(\);/);
    assert.match(promptsPoetry, /if \(!user\) \{[\s\S]*if \(isPromptComposerInput && isPromptCommentComposerEnabled\(\)\) \{[\s\S]*flashPromptCommentComposerAuthRequired\(\);[\s\S]*if \(options\.source === 'prompt-comment-composer-send'\) \{[\s\S]*openPromptCommentComposerLoginGate\(\);[\s\S]*\}[\s\S]*return;[\s\S]*\}[\s\S]*showLoginModal\(\);/);
    assert.match(promptsPoetry, /overlay\.classList\.add\('ios-focus-lock'\);/);
    assert.doesNotMatch(promptsPoetry, /setTimeout\(handleViewportChange, 60\);[\s\S]*setTimeout\(handleViewportChange, 120\);[\s\S]*setTimeout\(handleViewportChange, 260\);/);
    assert.doesNotMatch(promptsPoetry, /if \(!isFocused && bottomInset <= 8\) \{[\s\S]*resetPromptCommentComposerKeyboardCycle\(\);[\s\S]*\}/);
    assert.doesNotMatch(promptsPoetry, /const handleInputBlur = \(\) => \{[\s\S]*schedulePromptCommentComposerKeyboardCycleReset\(240\);[\s\S]*\};/);
    assert.doesNotMatch(promptsPoetry, /function schedulePromptCommentComposerSettleSync\(\) \{/);

    assert.match(adminChat, /classList\.add\('admin-chat-keyboard-docked'\)/);
    assert.match(adminChat, /const targetBottom = Math\.max\(40, keyboardTop - 12\);/);
    assert.match(adminChat, /scheduleAdminChatFocusedRelease\(\) \{/);
    assert.match(shopClient, /schedulePurchaseModalFocusedRelease: function \(\) \{/);
    assert.match(homepageGuestbookModal, /function scheduleGuestbookFocusedRelease\(\) \{/);
    assert.match(guestbook, /function scheduleCommentModalFocusedRelease\(\) \{/);
    assert.match(profileAuth, /function scheduleProfileModalFocusedRelease\(\) \{/);
    assert.match(walletModal, /function scheduleWalletModalFocusedRelease\(\) \{/);
    assert.match(promptsPoetry, /function schedulePromptModalFocusedRelease\(\) \{/);
    assert.doesNotMatch(promptsPoetry, /function schedulePromptCommentComposerFocusedRelease\(\) \{/);
    assert.match(injectAuth, /function scheduleAuthInputFocusedRelease\(\) \{/);
    assert.match(homepageGuestbookModal, /if \(isInsetDroppingWhileFocused\) \{[\s\S]*guestbookModalKeyboardState\.pendingInset = 0;[\s\S]*applyGuestbookModalKeyboardDock\(nextInset, false\);[\s\S]*return;/);
    assert.match(guestbook, /if \(isInsetDroppingWhileFocused\) \{[\s\S]*commentModalKeyboardState\.pendingInset = 0;[\s\S]*applyCommentModalKeyboardDock\(nextInset, false\);[\s\S]*return;/);
    assert.match(shopClient, /if \(isInsetDroppingWhileFocused\) \{[\s\S]*this\.purchaseModalKeyboardPendingInset = 0;[\s\S]*this\.applyPurchaseModalKeyboardDock\(nextInset, false\);[\s\S]*return;/);
    assert.match(adminChat, /getAdminChatFocusKeyboardInset\(metrics = this\.getAdminChatKeyboardMetrics\(\)\) \{/);
    assert.match(adminChat, /getAdminChatKeyboardStableViewportProbe\(\) \{/);
    assert.match(adminChat, /dockTarget\.style\.setProperty\('--admin-chat-keyboard-dock-height', `\$\{dockHeight\}px`\);/);
    assert.match(adminChat, /const layoutBottom = layoutTop \+ dockHeight;/);
    assert.match(adminChat, /lockAdminChatKeyboardPage\(\) \{/);
    assert.match(adminChat, /window\.iOSScrollLock\.lockLight\(containerEl \|\| interfaceEl, \{[\s\S]*restoreScrollDuringViewport: true/);
    assert.match(chatWidget, /\.chat-window\.admin-mode-layout\.keyboard-docked,[\s\S]*left: 50% !important;[\s\S]*right: auto !important;[\s\S]*translate3d\(-50%, calc\(var\(--chat-base-translate-y, -50%\) \+ var\(--chat-shift-y, 0px\)\), 0\)/);
    assert.doesNotMatch(chatWidget, /\.chat-window\.admin-mode-layout\.keyboard-docked,[^{]*\{[^}]*transform: translate3d\(0,/);
    assert.match(chatWidget, /window\.iOSScrollLock\.lockLight\(this\.chatWindow, \{[\s\S]*restoreScrollDuringViewport: true/);
    assert.match(
        chatWidget,
        /@media \(max-width: 768px\), \(hover: none\), \(pointer: coarse\) \{[\s\S]*\.chat-window\.admin-mode-layout \.admin-search input,[\s\S]*\.chat-window\.admin-mode-layout \.chat-input \{[\s\S]*font-size: 16px !important;/,
        'mobile admin chat inputs should stay at 16px to avoid iOS Safari focus zoom'
    );
    assert.match(walletModal, /const targetBottom = Math\.max\(40, keyboardTop - keyboardClearance\);/);
    assert.match(walletModal, /function getWalletModalFocusKeyboardInset\(snapshot = getWalletModalViewportSnapshot\(\)\) \{/);
    assert.match(walletModal, /const effectiveBottomInset = focusDriven[\s\S]*getWalletModalFocusKeyboardInset\(snapshot\)/);
    assert.match(walletModal, /const WALLET_MODAL_KEYBOARD_SETTLE_MS = 260;/);
    assert.match(walletModal, /const WALLET_MODAL_KEYBOARD_RESIZE_IDLE_MS = 180;/);
    assert.match(walletModal, /const WALLET_MODAL_KEYBOARD_MOTION_MS = 250;/);
    assert.match(walletModal, /baseCardHeight: 0,[\s\S]*scrollAnimationRafId: 0,[\s\S]*focusScrollSuppressUntil: 0,/);
    assert.match(walletModal, /function getWalletModalInputTargetScrollTop\(input = getActiveWalletModalInput\(\)\) \{/);
    assert.match(walletModal, /function animateWalletModalScroll\(scrollHost, targetScrollTop, options = \{\}\) \{/);
    assert.match(walletModal, /const WALLET_MODAL_REDEEM_INPUT_BOTTOM_GUARD = 32;/);
    assert.match(walletModal, /const WALLET_MODAL_UNDOCK_CONTENT_RELEASE_MS = 260;/);
    assert.match(walletModal, /const WALLET_MODAL_UNDOCK_SCROLL_RESTORE_MS = 260;/);
    assert.match(walletModal, /function isWalletModalRedeemInput\(input\) \{/);
    assert.match(walletModal, /function getWalletModalInputScrollHost\(input\) \{/);
    assert.match(walletModal, /function scheduleWalletModalBalanceUndockScrollRestore\(delay = 0\) \{/);
    assert.match(walletModal, /function releaseWalletModalDockedContent\(activeOverlay\) \{/);
    assert.match(walletModal, /const candidates = isRedeemInput[\s\S]*\? \[content, layout, scroller, card\]/);
    assert.match(walletModal, /const bottomGuard = isRedeemInput[\s\S]*WALLET_MODAL_REDEEM_INPUT_BOTTOM_GUARD/);
    assert.doesNotMatch(walletModal, /WALLET_MODAL_REDEEM_INPUT_SCROLL_LIFT/);
    assert.match(walletModal, /walletModalState\.scrollAnimationRafId = requestAnimationFrame\(step\);/);
    assert.match(walletModal, /Math\.max\(WALLET_MODAL_SCROLL_STATE_CLEAR_MS, duration \+ 60\)/);
    assert.doesNotMatch(walletModal, /scrollTo\(\{ top: to, behavior: 'smooth' \}\)/);
    assert.match(walletModal, /function markWalletModalKeyboardResizing\(\) \{/);
    assert.match(walletModal, /function scheduleWalletModalInitialKeyboardDock\(snapshot\) \{/);
    assert.match(walletModal, /function scheduleWalletModalFocusedInputScroll\(input, delay = 0\) \{/);
    assert.match(walletModal, /const stableHeight = Math\.max\(320, Math\.round\(walletModalState\.baseCardHeight \|\| fallbackHeight\)\);/);
    assert.match(walletModal, /const preserveFocusDock = Boolean\([\s\S]*walletModalState\.preserveLayoutDuringFocusTransfer[\s\S]*walletModalState\.lastDockHeight > 0/);
    assert.match(walletModal, /walletModalState\.keyboardBlurUndocking = true;[\s\S]*resetWalletModalDockLayout\(true\);/);
    assert.match(walletModal, /walletModalState\.focusScrollSuppressUntil = Date\.now\(\) \+ 120;/);
    assert.match(walletModal, /if \(wasDockedBeforeFocus && scrollHost && Number\.isFinite\(beforeFocusScrollTop\)\) \{[\s\S]*scrollHost\.scrollTop = beforeFocusScrollTop;/);
    assert.match(walletModal, /scheduleWalletModalFocusedInputScroll\(input, 34\);/);
    assert.match(scrollLock, /function restoreLightLockedScroll\(\) \{/);
    assert.match(scrollLock, /function shouldAnchorLightLock\(modalElement\) \{/);
    assert.match(scrollLock, /function shouldEnableLightScrollAnchor\(modalElement, options = \{\}\) \{/);
    assert.match(scrollLock, /options\.restoreScrollDuringViewport === true/);
    assert.match(scrollLock, /scheduleLightLockedScrollRestore\(\{ withFollowup: true \}\);/);
    assert.match(scrollLock, /matches\?\.\('\.chat-window, \.chat-widget, \.chat-widget-window'\)/);
    assert.match(scrollLock, /scheduleLightLockedScrollRestore\(\);/);
    assert.doesNotMatch(shopClient, /stableViewportHeight \+ 24 < fallbackBaseHeight/);
    assert.doesNotMatch(promptsPoetry, /stableViewportHeight \+ 24 < fallbackBaseHeight/);
    assert.doesNotMatch(homepageGuestbookModal, /stableViewportHeight \+ 24 < fallbackBaseHeight/);
    assert.match(homepageGuestbookModal, /function getGuestbookModalNativeViewportFrame\(\) \{/);
    assert.match(homepageGuestbookModal, /const shouldPreserveKeyboardBase = overlay\.classList\.contains\('active'\)[\s\S]*&& baseHeight > measuredHeight;/);
    assert.match(homepageGuestbookModal, /'--guestbook-modal-viewport-top': `\$\{frame\.top\}px`,[\s\S]*'--guestbook-modal-overlay-height': `\$\{overlayHeight\}px`/);
    assert.match(homepageGuestbookModal, /requestAnimationFrame\(\(\) => \{[\s\S]*captureGuestbookModalOverlayBaseHeight\(\);[\s\S]*syncGuestbookModalKeyboardDock\(\);/);
});

test('keyboard dock styles and cache keys are wired for affected public/admin surfaces', () => {
    const styleCss = readRepoFile('style.css');
    const profileCss = readRepoFile(path.join('css', 'profile-modal.css'));
    const walletCss = readRepoFile(path.join('css', 'wallet.css'));
    const shopCss = readRepoFile(path.join('css', 'shop-page.css'));
    const chatWidgetCss = readRepoFile(path.join('css', 'chat-widget.css'));
    const homepageOverlayCss = readRepoFile(path.join('css', 'homepage-overlays.css'));
    const promptsCss = readRepoFile('prompts-poetry.css');
    const adminChatCss = readRepoFile(path.join('css', 'admin-chat.css'));
    const chatWidgetLoader = readRepoFile(path.join('js', 'chat-widget-loader.js'));
    const chatWidget = readRepoFile(path.join('js', 'components', 'ChatWidget.js'));
    const walletLoader = readRepoFile(path.join('js', 'wallet-modal-loader.js'));
    const shopHtml = readRepoFile('shop.html');
    const guestbookHtml = readRepoFile('guestbook.html');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    assert.match(styleCss, /--comment-modal-translate-y: 0px;/);
    assert.match(styleCss, /#guestbookModal \{[\s\S]*--guestbook-modal-viewport-top: 0px;[\s\S]*top: var\(--guestbook-modal-viewport-top\) !important;[\s\S]*width: var\(--guestbook-modal-viewport-width\) !important;/);
    assert.match(homepageOverlayCss, /#guestbookModal \{[\s\S]*--guestbook-modal-viewport-top: 0px;[\s\S]*top: var\(--guestbook-modal-viewport-top\) !important;[\s\S]*width: var\(--guestbook-modal-viewport-width\) !important;/);
    assert.match(promptsCss, /\.prompt-comment-composer \{[\s\S]*--prompt-comment-composer-viewport-top: 0px;[\s\S]*top: var\(--prompt-comment-composer-viewport-top\) !important;[\s\S]*width: var\(--prompt-comment-composer-viewport-width\) !important;[\s\S]*height: var\(--prompt-comment-composer-overlay-height\) !important;/);
    assert.match(styleCss, /#guestbookModal \.guestbook-composer-sheet,[\s\S]*width: 95vw !important;[\s\S]*max-width: 1000px !important;/);
    assert.match(homepageOverlayCss, /#guestbookModal \.guestbook-composer-sheet,[\s\S]*width: 95vw !important;[\s\S]*max-width: 1000px !important;/);
    assert.match(promptsCss, /\.prompt-comment-composer-sheet \{[\s\S]*width: 95vw;[\s\S]*max-width: 1000px;/);
    assert.match(promptsCss, /body\.prompt-comment-composer-underlay-frozen #promptModal,[\s\S]*body\.prompt-comment-composer-underlay-frozen \.poetry-modal-backdrop \{[\s\S]*top: var\(--prompt-comment-composer-viewport-top, 0px\) !important;[\s\S]*height: var\(--prompt-comment-composer-overlay-height, 100svh\) !important;[\s\S]*transform: translate3d\(0, 0, 0\) !important;[\s\S]*overflow: hidden !important;/);
    assert.match(promptsCss, /body\.prompt-comment-composer-underlay-frozen #promptModal \.modal-inner \{[\s\S]*transform: translate3d\(0, 0, 0\) scale\(1\) translateZ\(0\) !important;/);
    assert.doesNotMatch(promptsCss, /--prompt-comment-underlay-shift-y/);
    assert.match(promptsCss, /\.modal-inner\.comment-mode \.comment-input-area\.composer-proxy #commentInput \{[\s\S]*pointer-events: none;[\s\S]*touch-action: none;/);
    assert.match(promptsCss, /\.modal-inner\.comment-mode \.comment-input-area\.composer-proxy \.comment-input-proxy-ui \{[\s\S]*pointer-events: auto;[\s\S]*touch-action: manipulation;/);
    assert.match(promptsCss, /\.prompt-comment-composer \{[\s\S]*--composer-keyboard-offset: 0px;[\s\S]*--composer-sheet-top: max\(12px, calc\(\(var\(--prompt-comment-composer-overlay-height, 100dvh\) - 400px\) \/ 2\)\);/);
    assert.match(promptsCss, /\.prompt-comment-composer\.ios-focus-lock \.prompt-comment-composer-sheet,[\s\S]*\.prompt-comment-composer\.keyboard-docked \.prompt-comment-composer-sheet,[\s\S]*\.prompt-comment-composer\.keyboard-docked\.active \.prompt-comment-composer-sheet,[\s\S]*\.prompt-comment-composer\.keyboard-docked\.active:focus-within \.prompt-comment-composer-sheet \{[\s\S]*transform: translate3d\(-50%, 0, 0\) scale\(1\) !important;[\s\S]*animation: none !important;/);
    assert.match(promptsCss, /\.prompt-comment-composer-sheet \{[\s\S]*position: absolute;[\s\S]*top: var\(--composer-sheet-top, 24px\);[\s\S]*left: 50%;[\s\S]*transform: translate3d\(-50%, 0, 0\);/);
    assert.match(promptsCss, /\.prompt-comment-composer-sheet\.composer-animating \{[\s\S]*transition: top 220ms cubic-bezier\(0\.22, 1, 0\.36, 1\) !important;/);
    assert.match(styleCss, /#commentModal\.keyboard-docked \.comment-composer-sheet/);
    assert.match(profileCss, /--profile-modal-dock-height:/);
    assert.match(profileCss, /#profileModal\.active\.keyboard-active \.modal-content\.profile-modal/);
    assert.match(profileCss, /transform: translate3d\(0, var\(--profile-modal-shift-y, 0px\), 0\) scale\(0\.95\);/);
    assert.doesNotMatch(profileCss, /height 220ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
    assert.match(profileCss, /#profileModal\.active\.keyboard-active \.modal-content\.profile-modal \{[\s\S]*transform: translate3d\(0, var\(--profile-modal-shift-y, 0px\), 0\) scale\(1\) !important;/);
    assert.match(profileCss, /#profileModal\.active\.keyboard-active:focus-within,[\s\S]*animation: none !important;/);
    assert.match(profileCss, /#profileModal\.profile-modal-keyboard-resizing \.modal-content\.profile-modal \{[\s\S]*transition: none !important;/);
    assert.match(profileCss, /#profileModal\.profile-modal-keyboard-animating \.modal-content\.profile-modal \{[\s\S]*transform var\(--profile-modal-keyboard-motion-duration, 250ms\)/);
    assert.doesNotMatch(profileCss, /#profileModal\.active:focus-within[\s\S]*transition: none !important;/);
    assert.match(walletCss, /\.wallet-overlay\.wallet-modal-keyboard-resizing \.wallet-modal \{[\s\S]*transition: none !important;/);
    assert.match(walletCss, /\.wallet-overlay\.wallet-modal-keyboard-animating \.wallet-modal \{[\s\S]*transform var\(--wallet-modal-keyboard-motion-duration, 250ms\)/);
    assert.match(walletCss, /\.wallet-overlay\.wallet-modal-keyboard-content-releasing #view-balance \.redeem-section \{[\s\S]*transition: margin-bottom var\(--wallet-modal-content-release-duration, 260ms\)/);
    assert.match(walletCss, /\.wallet-overlay\.keyboard-docked #view-balance,[\s\S]*overflow-anchor: none;/);
    assert.match(walletCss, /\.wallet-overlay\.keyboard-active #view-balance \.redeem-section,[\s\S]*margin-bottom: 160px;/);
    assert.doesNotMatch(walletCss, /height 180ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
    assert.doesNotMatch(walletCss, /max-height 180ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/);

    const chatKeyboardAnimatingRule = chatWidgetCss.match(/\.chat-window\.chat-window--keyboard-animating \{[\s\S]*?\n\}/)?.[0] || '';
    const shopPurchaseAnimatingRule = shopCss.match(/#shopPurchaseModal \.modal-content\.shop-purchase-sheet-animating,[\s\S]*?#shopPurchaseModal\.keyboard-docked \.modal-content\.shop-purchase-sheet-animating \{[\s\S]*?\n\s*\}/)?.[0] || '';
    const guestbookSheetAnimatingRule = styleCss.match(/#guestbookModal \.guestbook-composer-sheet\.guestbook-sheet-animating \{[\s\S]*?\n\}/)?.[0] || '';
    const commentSheetAnimatingRule = styleCss.match(/#commentModal \.comment-composer-sheet\.comment-sheet-animating \{[\s\S]*?\n\}/)?.[0] || '';
    const homepageGuestbookAnimatingRule = homepageOverlayCss.match(/#guestbookModal \.guestbook-composer-sheet\.guestbook-sheet-animating \{[\s\S]*?\n\}/)?.[0] || '';
    const promptModalAnimatingRule = promptsCss.match(/\.poetry-modal\.active:focus-within \.modal-inner\.prompt-modal-animating,[\s\S]*?\.poetry-modal\.keyboard-docked \.modal-inner\.prompt-modal-animating \{[\s\S]*?\n\}/)?.[0] || '';
    const promptComposerAnimatingRule = promptsCss.match(/\.prompt-comment-composer-sheet\.composer-animating \{[\s\S]*?\n\}/)?.[0] || '';
    const promptCaretStabilizingRule = promptsCss.match(/\.poetry-modal\.prompt-caret-stabilizing #commentInput,[\s\S]*?#promptCommentComposerInput:focus \{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(promptsCss, /\.prompt-comment-composer\.keyboard-settling #promptCommentComposerInput/);

    for (const [label, rule] of [
        ['chat widget', chatKeyboardAnimatingRule],
        ['shop purchase', shopPurchaseAnimatingRule],
        ['guestbook composer', guestbookSheetAnimatingRule],
        ['comment composer', commentSheetAnimatingRule],
        ['homepage guestbook composer', homepageGuestbookAnimatingRule],
        ['prompt comments page', promptModalAnimatingRule]
    ]) {
        assert.match(rule, /transition: transform (?:var\(--chat-keyboard-motion-duration, )?250ms/, `${label} should dock with one 250ms transform transition`);
        assert.doesNotMatch(rule, /\bheight\s+\d+ms|\bmax-height\s+\d+ms/, `${label} should not animate height while docking to the keyboard`);
    }
    assert.match(promptComposerAnimatingRule, /transition: top 220ms cubic-bezier\(0\.22, 1, 0\.36, 1\) !important;/);
    assert.doesNotMatch(promptComposerAnimatingRule, /\bheight\s+\d+ms|\bmax-height\s+\d+ms/);
    assert.doesNotMatch(promptComposerAnimatingRule, /transition: transform/);

    assert.match(
        chatWidgetCss,
        /\.chat-messages\s*\{[\s\S]*?padding-bottom:\s*max\(20px, var\(--chat-messages-bottom-safe-space, 20px\)\);[\s\S]*?scroll-padding-bottom:\s*var\(--chat-messages-bottom-safe-space, 20px\);/,
        'customer chat messages should reserve a measured composer-safe scroll area'
    );
    assert.match(
        chatWidget,
        /syncUserMessageViewportPadding\(\) \{[\s\S]*?getBoundingClientRect[\s\S]*?'--chat-messages-bottom-safe-space'/,
        'customer chat should measure the input module before scrolling messages into view'
    );
    assert.doesNotMatch(
        chatWidget,
        /keyboardGuard/,
        'focused customer chat input should not add a fixed bottom spacer that creates a large gap above the composer'
    );
    assert.doesNotMatch(
        chatWidgetCss,
        /\.chat-window:not\(\.admin-mode-layout\) \.chat-messages::before\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;/,
        'customer chat should not rely on a pseudo spacer that can add a large composer gap during handoff'
    );
    assert.match(
        chatWidget,
        /this\.appendMessage\(text, this\.getMessageRenderType\(false\), 'text', optimisticCreatedAt, true\);/,
        'optimistic customer text messages should use the new-message scroll path'
    );
    assert.match(
        chatWidget,
        /scrollToBottom\(\{ settle = false \} = \{\}\) \{[\s\S]*?scheduleFrame[\s\S]*?setTimeout\(applyBottomScroll, 220\);/,
        'customer chat should retry bottom scroll after keyboard/composer layout settles'
    );

    assert.match(promptCaretStabilizingRule, /caret-color: transparent !important;/);
    assert.match(promptsCss, /\.prompts-caret-repaint \{[\s\S]*transform: translateZ\(0\);/);
    assert.match(adminChatCss, /\.chat-container\.admin-chat-keyboard-docked/);
    assert.match(adminChatCss, /--admin-chat-keyboard-dock-height/);
    assert.match(adminChatCss, /\.admin-chat-viewport-probe/);
    assert.match(
        adminChatCss,
        /@media \(max-width: 768px\), \(hover: none\), \(pointer: coarse\) \{[\s\S]*#module-chat \.chat-search input,[\s\S]*#module-chat \.chat-input \{[\s\S]*font-size: 16px !important;/,
        'mobile standalone admin chat inputs should stay at 16px to avoid iOS Safari focus zoom'
    );

    assert.match(shopHtml, /shop-client\.js\?v=20260520_SHOP_CARD_PROMPT_BREATHE_3/);
    assert.match(guestbookHtml, /guestbook\.js\?v=20260507_GUESTBOOK_DEEPLINK_REPLAY_1/);
    assert.match(shopHtml, /ios-scroll-lock\.js\?v=20260502_IOS_LIGHT_LOCK_SCROLL_ANCHOR_6/);
    assert.match(guestbookHtml, /ios-scroll-lock\.js\?v=20260502_IOS_LIGHT_LOCK_SCROLL_ANCHOR_6/);
    assert.match(guestbookHtml, /homepage-guestbook-modal\.js\?v=20260504_HOME_GUESTBOOK_KEYBOARD_RETRACT_1/);
    assert.match(adminStudioHtml, /admin-chat\.js\?v=20260514_CHAT_VERIFY_SUBMITTER_IDENTITY_1/);
    assert.match(adminStudioHtml, /ios-scroll-lock\.js\?v=20260502_IOS_LIGHT_LOCK_SCROLL_ANCHOR_6/);
    assert.match(chatWidgetLoader, /const VERSION = '20260707_CHAT_WIDGET_DARK_INPUT_GRAY_1';/);
    assert.match(chatWidgetCss, /--chat-input-bg: rgba\(31, 31, 31, 0\.94\);/);
    assert.match(chatWidgetCss, /--chat-input-bg-focus: rgba\(42, 42, 42, 0\.98\);/);
    assert.match(chatWidgetLoader, /chat-widget-bootstrap-user-input \.chat-input \{[\s\S]*background: var\(--chat-input-bg, rgba\(31, 31, 31, 0\.94\)\);/);
    assert.match(chatWidget, /\.admin-search input \{[\s\S]*background: var\(--chat-input-bg, rgba\(31, 31, 31, 0\.94\)\);/);
    assert.match(chatWidget, /\.chat-window\.admin-mode-layout \.chat-input \{[\s\S]*background: var\(--chat-input-bg, rgba\(31, 31, 31, 0\.94\)\) !important;/);
    assert.match(chatWidget, /\.chat-window:not\(\.admin-mode-layout\) \.chat-input \{[\s\S]*background: var\(--chat-input-bg, rgba\(31, 31, 31, 0\.94\)\) !important;/);
    assert.match(
        chatWidgetLoader,
        /@media \(max-width: 700px\) and \(hover: hover\) and \(pointer: fine\) \{[\s\S]*\.chat-window:not\(\.admin-mode-layout\):not\(\[data-chat-widget-bootstrap-shell="1"\]\) \{[\s\S]*--chat-base-translate-y: -50%;[\s\S]*width: min\(460px, max\(97vw, calc\(100vw - 16px\)\)\) !important;[\s\S]*height: 70vh !important;[\s\S]*top: 50% !important;[\s\S]*transform-origin: center center !important;[\s\S]*\.chat-window:not\(\.admin-mode-layout\):not\(\[data-chat-widget-bootstrap-shell="1"\]\)\.active \{[\s\S]*transform: translate3d\(-50%, calc\(var\(--chat-base-translate-y, -50%\) \+ var\(--chat-shift-y, 0px\)\), 0\) scale\(1\) !important;/,
        'critical chat widget CSS should center narrow desktop user windows on the final 460px geometry before runtime styles load'
    );
    assert.match(
        chatWidgetLoader,
        /@media \(max-width: 700px\) and \(hover: none\), \(max-width: 700px\) and \(pointer: coarse\) \{[\s\S]*\.chat-window:not\(\.admin-mode-layout\):not\(\[data-chat-widget-bootstrap-shell="1"\]\) \{[\s\S]*height: 70vh !important;[\s\S]*transform: translate3d\(-50%, calc\(-50% \+ 24px\), 0\) scale\(0\.94\) !important;/,
        'critical chat widget CSS should reserve centered 70vh user windows for touch narrow screens'
    );
    assert.equal(
        chatWidgetLoader.includes('@media (max-width: 700px) {\n    .chat-window:not(.admin-mode-layout):not([data-chat-widget-bootstrap-shell="1"])'),
        false,
        'critical chat widget CSS should not apply bare mobile user chat geometry to hover-fine narrow desktop windows'
    );
    assert.match(chatWidgetLoader, /<div class="chat-header-actions">[\s\S]*<button type="button" class="chat-header-mode-switch" tabindex="-1">常用入口<\/button>/);
    assert.match(chatWidgetLoader, /chat-widget-bootstrap-user-input \.chat-widget-bootstrap-user-emoji-btn \{[\s\S]*background: transparent;[\s\S]*box-shadow: none;/);
    assert.match(chatWidgetLoader, /chat-widget-bootstrap-user-input \.chat-send-btn \{[\s\S]*width: auto;[\s\S]*flex: 0 0 auto;/);
    assert.match(chatWidgetLoader, /html\.chat-widget-bootstrap-loading \.chat-widget-fab,[\s\S]*body\.chat-widget-bootstrap-loading \.chat-widget-fab \{[\s\S]*opacity: 0 !important;[\s\S]*visibility: hidden !important;/);
    assert.match(chatWidgetLoader, /html\.chat-widget-open,[\s\S]*body\.chat-widget-open,[\s\S]*html\.chat-widget-bootstrap-scroll-locked,[\s\S]*body\.chat-widget-bootstrap-scroll-locked \{[\s\S]*overflow: hidden !important;[\s\S]*overscroll-behavior: none !important;/);
    assert.match(chatWidgetLoader, /openingPlaceholder\.dataset\.chatWidgetPlaceholderOpening = '1';[\s\S]*loadingShell\.overlay\.classList\.add\('is-visible'\);[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*loadingShell\.overlay\.classList\.add\('is-active'\);[\s\S]*setPlaceholderSuppressed\(true\);/);
    assert.match(chatWidgetLoader, /let bootstrapScrollLockActive = 0;|let bootstrapScrollLockActive = false;/);
    assert.match(chatWidgetLoader, /let bootstrapDismissToken = 0;/);
    assert.match(chatWidgetLoader, /overlay\.addEventListener\('click', dismissBootstrapLoadingShell\);/);
    assert.match(chatWidgetLoader, /function dismissBootstrapLoadingShell\(event = null\) \{[\s\S]*clickedBootstrapOverlay[\s\S]*bootstrapDismissToken \+= 1;[\s\S]*pendingOpen = false;[\s\S]*hideBootstrapLoadingShell\(\{ dismissed: true \}\);/);
    assert.match(chatWidgetLoader, /function setBootstrapLoadingPageFabHidden\(hidden\) \{[\s\S]*document\.documentElement\?\.classList\?\.toggle\('chat-widget-bootstrap-loading', active\);[\s\S]*document\.body\?\.classList\?\.toggle\('chat-widget-bootstrap-loading', active\);/);
    assert.match(chatWidgetLoader, /function lockBootstrapLoadingPageScroll\(loadingShell\) \{[\s\S]*setBootstrapLoadingPageScrollLocked\(true\);[\s\S]*global\.iOSScrollLock\.lockLight\(shell, \{ restoreScrollDuringViewport: true \}\);/);
    assert.match(chatWidgetLoader, /function releaseBootstrapLoadingPageScroll\(options = \{\}\) \{[\s\S]*const preserveForHandoff = options\.preserveForHandoff === true;[\s\S]*global\.iOSScrollLock\.unlock\(\);/);
    assert.match(chatWidgetLoader, /syncBootstrapLoadingShellMode\(loadingShell\);[\s\S]*lockBootstrapLoadingPageScroll\(loadingShell\);[\s\S]*setBootstrapLoadingPageFabHidden\(true\);[\s\S]*openingPlaceholder\.dataset\.chatWidgetPlaceholderOpening = '1';[\s\S]*openingPlaceholder\.classList\.add\('chat-widget-fab--hidden'\);[\s\S]*suppressRuntimeFabDuringBootstrapLoading\(\);[\s\S]*loadingShell\.overlay\.classList\.add\('is-visible'\);/);
    assert.match(chatWidgetLoader, /function restoreClosedRuntimeFabVisibility\(\) \{[\s\S]*if \(widget\?\.isOpen\)[\s\S]*\.chat-widget-fab:not\(\[data-chat-widget-placeholder="1"\]\)[\s\S]*runtimeFab\.classList\.remove\([\s\S]*'chat-widget-fab--hidden',[\s\S]*'chat-widget-fab--disabled',[\s\S]*'chat-widget-fab--ambient-retracted'/);
    assert.match(chatWidgetLoader, /function suppressRuntimeFabDuringBootstrapLoading\(\) \{[\s\S]*\.chat-widget-fab:not\(\[data-chat-widget-placeholder="1"\]\)[\s\S]*runtimeFab\.classList\.add\('chat-widget-fab--hidden', 'chat-widget-fab--disabled'\);/);
    assert.match(chatWidgetLoader, /if \(!fab\) \{[\s\S]*if \(suppressed\) \{[\s\S]*suppressRuntimeFabDuringBootstrapLoading\(\);[\s\S]*return;/);
    assert.match(chatWidgetLoader, /if \(!fab\) \{[\s\S]*if \(!suppressed\) \{[\s\S]*restoreClosedRuntimeFabVisibility\(\);/);
    assert.match(chatWidgetLoader, /const shouldRestoreClosedRuntimeFab = !pendingOpen;[\s\S]*global\.chatWidget = new ChatWidgetCtor\(global\.supabaseClient\);[\s\S]*openWidgetIfPending\(\);[\s\S]*if \(shouldRestoreClosedRuntimeFab\) \{[\s\S]*restoreClosedRuntimeFabVisibility\(\);/);
    assert.match(chatWidgetLoader, /const showDismissToken = bootstrapDismissToken;[\s\S]*if \(showDismissToken !== bootstrapDismissToken\)/);
    assert.match(chatWidgetLoader, /const openDismissToken = bootstrapDismissToken;[\s\S]*if \(openDismissToken !== bootstrapDismissToken \|\| !activeWidget\?\.isOpen\)/);
    assert.match(chatWidgetLoader, /const opening = fab\.dataset\.chatWidgetPlaceholderOpening === '1';[\s\S]*if \(suppressed \|\| opening\) \{[\s\S]*fab\.removeAttribute\('data-chat-widget-loading'\);/);
    assert.doesNotMatch(chatWidgetLoader, /chat-widget-fab--disabled \.chat-widget-fab__robot|chat-widget-fab--disabled \.mascot-wrapper/);
    assert.match(chatWidget, /getChatLoadingDotsMarkup\(label = '', extraClass = ''\)/);
    assert.match(chatWidget, /const wasOpening = existingPlaceholder\.dataset\.chatWidgetPlaceholderOpening === '1';/);
    assert.match(chatWidget, /const shouldKeepHiddenForBootstrap = wasSuppressed \|\| wasOpening;[\s\S]*reusedFab\.removeAttribute\('data-chat-widget-placeholder-opening'\);[\s\S]*reusedFab\.classList\.toggle\('chat-widget-fab--hidden', shouldKeepHiddenForBootstrap\);[\s\S]*reusedFab\.classList\.toggle\('chat-widget-fab--disabled', shouldKeepHiddenForBootstrap\);/);
    assert.match(chatWidget, /getUserInitialMessagesMarkup\(\{ loading = false \} = \{\}\)/);
    assert.match(chatWidget, /loading-overlay--user-dots/);
    assert.match(chatWidget, /getChatLoadingDotsMarkup\([\s\S]*this\.t\('chat\.loading', '加载中\.\.\.'\),[\s\S]*'chat-loading-state--user-handoff'/);
    assert.match(chatWidget, /chat-loading-dots/);
    assert.doesNotMatch(chatWidget, /getUserComposerHandoffSkeletonMarkup/);
    assert.doesNotMatch(
        chatWidget,
        /chat-input-handoff-action--upload[\s\S]*chat-input-handoff-field[\s\S]*chat-input-handoff-action--emoji[\s\S]*chat-input-handoff-send/,
        'public chat loading state should use dots instead of composer skeleton slots'
    );
    assert.match(chatWidget, /const composerReleaseDelay = this\.releaseUserBootstrapComposer\(\);[\s\S]*chat-window--bootstrap-interaction-locked/);
    assert.doesNotMatch(chatWidget, /chat-input-area--handoff-(?:hidden|ready|revealing)/);
    assert.match(chatWidget, /getBootstrapContentSnapshotMarkup/);
    assert.match(chatWidget, /chat-window--bootstrap-content-ready > \*:not\(\.emoji-picker-popover\):not\(\.chat-bootstrap-content-snapshot\)/);
    assert.match(chatWidget, /removeBootstrapContentSnapshot\(\);/);
    assert.match(chatWidget, /const openingCleanupDelay = useBootstrapHandoffOpening \? 560 : 440;/);
    assert.match(chatWidget, /finishUserHistoryLoadHandoff\(\) \{[\s\S]*!this\.isBootstrapContentSettleInFlight\(\)[\s\S]*this\.scheduleBootstrapAdoptedContentSettle\(\);/);
    assert.match(chatWidget, /isBootstrapContentSettleInFlight\(\) \{/);
    assert.match(chatWidget, /const contentSettleDelayMs = 220;/);
    assert.match(chatWidget, /const shouldUseInitialLoadingHandoff = Boolean\(claimedShell\);[\s\S]*getUserInitialMessagesMarkup\(\{[\s\S]*loading: shouldUseInitialLoadingHandoff/);
    assert.match(chatWidget, /if \(shouldUseInitialLoadingHandoff\) \{[\s\S]*this\.scheduleBootstrapAdoptedContentSettle\(\);/);
    assert.match(chatWidget, /const useBootstrapHistoryHandoff = this\.isBootstrapShellAdopted\(\);[\s\S]*if \(!useBootstrapHistoryHandoff\) \{[\s\S]*this\.ensureSessionLoadingOverlay\(\);[\s\S]*\} else \{[\s\S]*this\.clearSessionLoadingOverlayTimer\(\);[\s\S]*\}/);
    assert.match(chatWidget, /const shouldRenderFullHistory = !this\.areUserHistoryMessagesEquivalent/);
    assert.match(chatWidget, /if \(!this\.isBootstrapShellAdopted\(\)\) \{[\s\S]*this\.completeBootstrapShellAdoption\(\);[\s\S]*const openingCleanupDelay/);
    assert.match(chatWidget, /if \(this\.isBootstrapShellAdopted\(\)[\s\S]*!this\.chatWindow\.classList\.contains\('chat-window--bootstrap-adopting-content'\)[\s\S]*this\.completeBootstrapShellAdoption\(\);[\s\S]*this\.chatWindow\.classList\.remove\('chat-opening'\);/);
    assert.match(chatWidget, /this\.chatWindow\.classList\.remove\('active'\);[\s\S]*this\._setChatWindowTransitionless\(true\);[\s\S]*this\._setChatWindowForceHidden\(true\);[\s\S]*this\._primeOpeningAnimationFromFab\(\);/);
    assert.match(chatWidget, /_primeOpeningAnimationFromFab\(\) \{[\s\S]*this\._usesTouchNarrowLayout\(\)[\s\S]*this\._primeOpeningAnimationForBootstrapLaunch\(\);/);
    assert.match(chatWidget, /_primeOpeningAnimationForBootstrapLaunch\(\) \{[\s\S]*--chat-open-offset-y', '24px'[\s\S]*--chat-open-scale', '0\.94'/);
    assert.match(chatWidget, /--chat-open-offset-y: 24px;[\s\S]*--chat-open-scale: 0\.94;[\s\S]*opacity 320ms cubic-bezier\(0\.22, 1, 0\.36, 1\),[\s\S]*transform 360ms cubic-bezier\(0\.18, 0\.88, 0\.24, 1\)/);
    assert.match(chatWidget, /_scheduleChatOpeningActivation\(useBootstrapHandoffOpening, options = \{\}\) \{[\s\S]*const immediateStartFrame = options\.immediateStartFrame === true;[\s\S]*if \(immediateStartFrame\) \{[\s\S]*commitOpeningStartFrame\(\);[\s\S]*this\._openingAnimationFrame = requestAnimationFrame\(commitOpeningStartFrame\);/);
    assert.match(chatWidget, /immediateStartFrame: deferFabHideForOpening/);
    assert.match(chatWidget, /Match admin mobile's compositor path[\s\S]*backdrop-filter: none !important;[\s\S]*will-change: transform, opacity !important;/);
    assert.match(chatWidget, /this\._setChatWindowForceHidden\(false\);[\s\S]*this\._setChatWindowTransitionless\(false\);[\s\S]*this\.chatWindow\.getBoundingClientRect\(\);[\s\S]*this\.chatWindow\.classList\.add\('active'\);/);
    assert.match(chatWidget, /if \(this\._openingAnimationFrame\) \{[\s\S]*cancelAnimationFrame\(this\._openingAnimationFrame\);/);
    assert.match(chatWidget, /_showChatOverlay\(\) \{[\s\S]*chat-overlay--active/);
    assert.match(chatWidget, /const alreadyActive = this\.overlay\.classList\.contains\('chat-overlay--active'\)[\s\S]*this\.overlay\.classList\.contains\('is-active'\);[\s\S]*if \(alreadyActive\) \{/);
    assert.match(chatWidget, /if \(this\.overlay\?\.dataset\?\.chatWidgetBootstrapAdopted === '1'\) \{[\s\S]*this\.overlay\.classList\.add\('chat-overlay', 'visible', 'chat-overlay--active'\);[\s\S]*this\.overlay\.classList\.remove\([\s\S]*'chat-widget-bootstrap-overlay'/);
    assert.match(chatWidget, /\.chat-overlay\.visible\.chat-overlay--active \{[\s\S]*backdrop-filter: var\(--chat-overlay-filter/);
    assert.match(chatWidget, /\.chat-overlay\.chat-overlay--user \{[\s\S]*backdrop-filter: blur\(0\) saturate\(100%\) !important;/);
    assert.match(chatWidget, /html\[data-theme="light"\] \.chat-window:not\(\.admin-mode-layout\) \{[\s\S]*--chat-panel-shadow: none;[\s\S]*--chat-avatar-bg: rgba\(107, 158, 206, 0\.18\);/);
    assert.match(chatWidget, /html\[data-theme="light"\] \.chat-window:not\(\.admin-mode-layout\) \.message\.user[\s\S]*0 10px 22px rgba\(35, 118, 78, 0\.14\),[\s\S]*inset 0 1px 0 rgba\(255, 255, 255, 0\.42\) !important;/);
    assert.doesNotMatch(chatWidget, /body\.chat-widget-open \.framer-nav/);
    assert.doesNotMatch(chatWidget, /html\.chat-widget-open \{[\s\S]*background-color: #000 !important;/);
    assert.doesNotMatch(chatWidget, /body\.chat-spotlight-suspended[\s\S]{0,260}opacity:\s*0 !important/);
    assert.match(chatWidget, /_getChatThemeChromeColor\(\) \{[\s\S]*meta\?\.getAttribute\('content'\)/);
    assert.doesNotMatch(chatWidget, /themeColor: '#000000'/);
    assert.doesNotMatch(chatWidget, /meta\.setAttribute\('content', '#000000'\)/);
    assert.match(chatWidget, /chat-window--bootstrap-content-ready \.emoji-picker-popover:not\(\.active\)/);
    assert.match(chatWidgetCss, /\.loading-overlay--user-dots \{[\s\S]*background: var\(--chat-panel-bg/);
    assert.match(chatWidgetCss, /\.chat-loading-state--user-handoff \{[\s\S]*position: absolute;[\s\S]*inset: 0;[\s\S]*pointer-events: none;[\s\S]*color: var\(--chat-accent-blue/);
    assert.match(chatWidgetCss, /\.chat-loading-dots span \{[\s\S]*animation: chat-widget-loading-dots 1\.05s ease-in-out infinite;/);
    assert.doesNotMatch(chatWidgetCss, /\.chat-window:not\(\.admin-mode-layout\) \.chat-input-handoff-skeleton \{/);
    assert.match(
        chatWidgetCss,
        /@media \(max-width: 700px\) and \(hover: hover\) and \(pointer: fine\) \{[\s\S]*\.chat-window:not\(\.admin-mode-layout\) \{[\s\S]*--chat-base-translate-y: -50%;[\s\S]*width: min\(460px, max\(97vw, calc\(100vw - 16px\)\)\) !important;[\s\S]*height: 70vh !important;[\s\S]*top: 50% !important;[\s\S]*transform-origin: center center !important;[\s\S]*\.chat-window:not\(\.admin-mode-layout\)\.active \{[\s\S]*transform: translate3d\(-50%, calc\(var\(--chat-base-translate-y, -50%\) \+ var\(--chat-shift-y, 0px\)\), 0\) scale\(1\) !important;/,
        'full chat widget CSS should keep the same centered 460px narrow desktop geometry after the deferred stylesheet activates'
    );
    assert.match(
        chatWidgetCss,
        /@media \(max-width: 480px\) and \(hover: none\), \(max-width: 480px\) and \(pointer: coarse\) \{[\s\S]*\.chat-window \{[\s\S]*width: 100%;[\s\S]*height: 100%;/,
        'full chat widget CSS should reserve full-height mobile windows for touch narrow screens'
    );
    assert.equal(
        chatWidgetCss.includes('@media (max-width: 480px) {\n    .chat-window {'),
        false,
        'full chat widget CSS should not treat hover-fine narrow desktop windows as phone-sized full-height chat windows'
    );
    assert.match(chatWidgetCss, /html\[data-theme="light"\] \.chat-window:not\(\.admin-mode-layout\) \{[\s\S]*--chat-panel-shadow: none;[\s\S]*--chat-avatar-bg: rgba\(107, 158, 206, 0\.18\);/);
    assert.match(chatWidgetCss, /\.chat-window--bootstrap-adopting-content > \*:not\(\.chat-bootstrap-content-snapshot\)/);
    assert.match(chatWidgetCss, /\.chat-window--bootstrap-adopting-content\.chat-window--bootstrap-content-ready > \*:not\(\.emoji-picker-popover\):not\(\.chat-bootstrap-content-snapshot\)/);
    assert.match(chatWidgetCss, /\.chat-window--bootstrap-adopting-content\.chat-window--bootstrap-content-ready > \*:not\(\.emoji-picker-popover\):not\(\.chat-bootstrap-content-snapshot\) \{[\s\S]*opacity: 1;[\s\S]*animation: none;/);
    assert.match(chatWidgetCss, /\.chat-bootstrap-content-snapshot \{[\s\S]*transition: opacity 160ms/);
    assert.match(chatWidgetCss, /\.chat-window--bootstrap-content-ready \.chat-bootstrap-content-snapshot \{[\s\S]*opacity: 0;[\s\S]*transition-delay: 0ms;/);
    assert.match(chatWidget, /\.chat-window--bootstrap-adopting-content\.chat-window--bootstrap-content-ready > \*:not\(\.emoji-picker-popover\):not\(\.chat-bootstrap-content-snapshot\)[\s\S]*opacity: 1;[\s\S]*animation: none;/);
    assert.match(chatWidgetCss, /\.chat-window--bootstrap-content-ready \.emoji-picker-popover:not\(\.active\) \{[\s\S]*opacity: 0 !important;/);
    assert.match(chatWidgetCss, /@keyframes chat-widget-loading-dots \{[\s\S]*transform: translate3d\(0, -2px, 0\);[\s\S]*opacity: 0\.96;/);
    assert.match(walletLoader, /const VERSION = '20260707_WALLET_MODAL_DARK_INPUT_GRAY_1';/);
});
