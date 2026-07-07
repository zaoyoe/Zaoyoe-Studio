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
    assert.match(promptsPoetry, /const keyboardClearance = PROMPT_COMMENT_COMPOSER_KEYBOARD_CLEARANCE;[\s\S]*const targetBottom = Math\.max\(40, Math\.round\(keyboardTop - keyboardClearance\)\);/);
    assert.match(promptsPoetry, /function getPromptCommentComposerStableViewportHeight\(\) \{/);
    assert.match(promptsPoetry, /function getPromptCommentComposerNativeViewportFrame\(\) \{/);
    assert.match(promptsPoetry, /function freezePromptCommentComposerUnderlay\(\) \{/);
    assert.match(promptsPoetry, /function restorePromptCommentComposerUnderlay\(\) \{/);
    assert.match(promptsPoetry, /function capturePromptCommentComposerOverlayFrame\(force = false\) \{/);
    assert.match(promptsPoetry, /'--prompt-comment-composer-viewport-top': `\$\{baseFrame\.top\}px`,[\s\S]*'--prompt-comment-composer-overlay-height': `\$\{overlayHeight\}px`/);
    assert.match(promptsPoetry, /window\.iOSScrollLock\.lockLight\(overlay, \{ restoreScrollDuringViewport: false \}\);/);
    assert.doesNotMatch(promptsPoetry, /promptCommentComposerScrollClampCleanup\s*=\s*clampPromptModalPageScroll/);
    assert.doesNotMatch(promptsPoetry, /function clampPromptModalPageScroll/);
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_KEYBOARD_SETTLE_MS = 520;/);
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_FOCUSED_RELEASE_MS = 260;/);
    assert.match(promptsPoetry, /const PROMPT_COMMENT_COMPOSER_HIDDEN_RESET_MS = 160;/);
    assert.match(promptsPoetry, /function isPromptCommentComposerKeyboardSettling\(\) \{/);
    assert.match(promptsPoetry, /function resetPromptCommentComposerKeyboardCycle\(\) \{/);
    assert.match(promptsPoetry, /function schedulePromptCommentComposerKeyboardCycleReset\(delay = PROMPT_COMMENT_COMPOSER_HIDDEN_RESET_MS\) \{/);
    assert.match(promptsPoetry, /input\.addEventListener\('touchstart', \(\) => \{[\s\S]*preparePromptCommentComposerForInputFocus\(\);[\s\S]*focusPromptCommentComposerInputWithoutScroll\(input\);[\s\S]*\}, \{ passive: true \}\);/);
    assert.doesNotMatch(promptsPoetry, /isStaleFocusedHiddenKeyboard/);
    assert.doesNotMatch(promptsPoetry, /schedulePromptCommentComposerHiddenFocusDetach/);
    assert.doesNotMatch(promptsPoetry, /input\.blur\(\);/);
    assert.match(promptsPoetry, /function preparePromptCommentComposerForInputFocus\(\) \{[\s\S]*sheet\?\.classList\.remove\('composer-animating'\);[\s\S]*resetPromptCommentComposerKeyboardCycle\(\);[\s\S]*clearPromptCommentComposerKeyboardCycleResetTimer\(\);/);
    assert.match(promptsPoetry, /promptCommentComposerBaseViewportHeight = 0;[\s\S]*promptCommentComposerBaseVisualHeight = 0;[\s\S]*promptCommentComposerBaseSheetHeight = 0;[\s\S]*promptCommentComposerOverlayBaseHeight = 0;/);
    assert.match(promptsPoetry, /function resetPromptCommentComposerKeyboardCycle\(\) \{[\s\S]*promptCommentComposerOverlayBaseFrame = null;[\s\S]*capturePromptCommentComposerViewportBase\(\);[\s\S]*\}/);
    assert.doesNotMatch(promptsPoetry, /function resetPromptCommentComposerKeyboardCycle\(\) \{[\s\S]*restorePromptCommentComposerUnderlay\(\);[\s\S]*\}/);
    assert.match(promptsPoetry, /if \(isInsetDroppingWhileFocused\) \{[\s\S]*promptCommentComposerPendingInset = previousInset;[\s\S]*return;[\s\S]*\}/);
    assert.match(promptsPoetry, /if \(promptCommentComposerDocked && nextInset < previousInset\) \{[\s\S]*return;[\s\S]*\}/);
    assert.doesNotMatch(promptsPoetry, /const handleInputBlur = \(\) => \{[\s\S]*releasePromptCommentComposerDock\(true\);[\s\S]*\};/);
    assert.match(promptsPoetry, /const shouldPreserveKeyboardBase = isActive && baseHeight > 0;/);
    assert.match(promptsPoetry, /const zeroBottom = Math\.round\(overlayTop \+ \(sheet\.offsetTop \|\| 0\) \+ dockHeight\);/);
    assert.match(promptsPoetry, /Math\.round\(targetBottom - zeroBottom\)/);
    assert.match(promptsPoetry, /function preparePromptCommentComposerForInputFocus\(\) \{[\s\S]*finishPromptCommentComposerEnterAnimation\(\);[\s\S]*capturePromptCommentComposerViewportBase\(\);[\s\S]*lockPromptCommentComposerPage\(\);[\s\S]*setPromptCommentComposerKeyboardSettling\(true\);/);
    assert.match(promptsPoetry, /function focusPromptCommentComposerInputWithoutScroll\(input\) \{[\s\S]*preparePromptCommentComposerForInputFocus\(\);[\s\S]*input\.focus\(\{ preventScroll: true \}\);/);
    assert.match(promptsPoetry, /detachPromptModalKeyboardDock\(\);[\s\S]*freezePromptCommentComposerOverlay\(\);[\s\S]*capturePromptCommentComposerViewportBase\(\);/);
    assert.match(promptsPoetry, /overlay\.classList\.add\('ios-focus-lock'\);/);
    assert.match(promptsPoetry, /setTimeout\(handleViewportChange, 60\);[\s\S]*setTimeout\(handleViewportChange, 120\);[\s\S]*setTimeout\(handleViewportChange, 260\);/);
    assert.match(promptsPoetry, /if \(!isFocused && bottomInset <= 8\) \{[\s\S]*resetPromptCommentComposerKeyboardCycle\(\);[\s\S]*\}/);
    assert.match(promptsPoetry, /const handleInputBlur = \(\) => \{[\s\S]*schedulePromptCommentComposerKeyboardCycleReset\(240\);[\s\S]*\};/);
    assert.match(promptsPoetry, /function schedulePromptCommentComposerSettleSync\(\) \{/);
    const promptComposerInsetDropBlock = promptsPoetry.match(/if \(isInsetDroppingWhileFocused\) \{[\s\S]*?\n    \}/)?.[0] || '';

    assert.match(adminChat, /classList\.add\('admin-chat-keyboard-docked'\)/);
    assert.match(adminChat, /const targetBottom = Math\.max\(40, keyboardTop - 12\);/);
    assert.match(adminChat, /scheduleAdminChatFocusedRelease\(\) \{/);
    assert.match(shopClient, /schedulePurchaseModalFocusedRelease: function \(\) \{/);
    assert.match(homepageGuestbookModal, /function scheduleGuestbookFocusedRelease\(\) \{/);
    assert.match(guestbook, /function scheduleCommentModalFocusedRelease\(\) \{/);
    assert.match(profileAuth, /function scheduleProfileModalFocusedRelease\(\) \{/);
    assert.match(walletModal, /function scheduleWalletModalFocusedRelease\(\) \{/);
    assert.match(promptsPoetry, /function schedulePromptModalFocusedRelease\(\) \{/);
    assert.match(promptsPoetry, /function schedulePromptCommentComposerFocusedRelease\(\) \{/);
    assert.match(injectAuth, /function scheduleAuthInputFocusedRelease\(\) \{/);
    assert.match(homepageGuestbookModal, /if \(isInsetDroppingWhileFocused\) \{[\s\S]*guestbookModalKeyboardState\.pendingInset = 0;[\s\S]*applyGuestbookModalKeyboardDock\(nextInset, false\);[\s\S]*return;/);
    assert.match(guestbook, /if \(isInsetDroppingWhileFocused\) \{[\s\S]*commentModalKeyboardState\.pendingInset = 0;[\s\S]*applyCommentModalKeyboardDock\(nextInset, false\);[\s\S]*return;/);
    assert.match(shopClient, /if \(isInsetDroppingWhileFocused\) \{[\s\S]*this\.purchaseModalKeyboardPendingInset = 0;[\s\S]*this\.applyPurchaseModalKeyboardDock\(nextInset, false\);[\s\S]*return;/);
    assert.doesNotMatch(promptComposerInsetDropBlock, /applyPromptCommentComposerDock\(nextInset, false\);/);
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
    assert.match(promptsCss, /body\.prompt-comment-composer-underlay-frozen #promptModal,[\s\S]*body\.prompt-comment-composer-underlay-frozen \.poetry-modal-backdrop,[\s\S]*body\.prompt-comment-composer-underlay-frozen #promptModal \.modal-inner \{[\s\S]*transition: none !important;[\s\S]*overflow: hidden !important;/);
    assert.match(promptsCss, /\.prompt-comment-composer\.ios-focus-lock \.prompt-comment-composer-sheet,[\s\S]*\.prompt-comment-composer\.keyboard-docked-active\.active \.prompt-comment-composer-sheet \{[\s\S]*transform: translate3d\(0, var\(--composer-translate-y, 0px\), 0\) scale\(1\) !important;[\s\S]*animation: none !important;/);
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
        ['prompt comments page', promptModalAnimatingRule],
        ['prompt write-comment composer', promptComposerAnimatingRule]
    ]) {
        assert.match(rule, /transition: transform (?:var\(--chat-keyboard-motion-duration, )?250ms/, `${label} should dock with one 250ms transform transition`);
        assert.doesNotMatch(rule, /\bheight\s+\d+ms|\bmax-height\s+\d+ms/, `${label} should not animate height while docking to the keyboard`);
    }

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
