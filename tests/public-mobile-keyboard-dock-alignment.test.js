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
    assert.match(promptsPoetry, /const zeroBottom = Math\.round\(zeroRect\.bottom/);
    assert.match(promptsPoetry, /Math\.round\(targetBottom - zeroBottom\)/);

    assert.match(adminChat, /classList\.add\('admin-chat-keyboard-docked'\)/);
    assert.match(adminChat, /const targetBottom = Math\.max\(40, keyboardTop - 12\);/);
    assert.match(adminChat, /getAdminChatFocusKeyboardInset\(metrics = this\.getAdminChatKeyboardMetrics\(\)\) \{/);
    assert.match(adminChat, /getAdminChatKeyboardStableViewportProbe\(\) \{/);
    assert.match(adminChat, /dockTarget\.style\.setProperty\('--admin-chat-keyboard-dock-height', `\$\{dockHeight\}px`\);/);
    assert.match(adminChat, /const layoutBottom = layoutTop \+ dockHeight;/);
    assert.match(adminChat, /lockAdminChatKeyboardPage\(\) \{/);
    assert.match(adminChat, /window\.iOSScrollLock\.lockLight\(containerEl \|\| interfaceEl, \{[\s\S]*restoreScrollDuringViewport: true/);
    assert.match(chatWidget, /\.chat-window\.admin-mode-layout\.keyboard-docked,[\s\S]*left: 50% !important;[\s\S]*right: auto !important;[\s\S]*translate3d\(-50%, calc\(var\(--chat-base-translate-y, -50%\) \+ var\(--chat-shift-y, 0px\)\), 0\)/);
    assert.doesNotMatch(chatWidget, /\.chat-window\.admin-mode-layout\.keyboard-docked,[\s\S]*transform: translate3d\(0,/);
    assert.match(chatWidget, /window\.iOSScrollLock\.lockLight\(this\.chatWindow, \{[\s\S]*restoreScrollDuringViewport: true/);
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

    assert.match(promptCaretStabilizingRule, /caret-color: transparent !important;/);
    assert.match(promptsCss, /\.prompts-caret-repaint \{[\s\S]*transform: translateZ\(0\);/);
    assert.match(adminChatCss, /\.chat-container\.admin-chat-keyboard-docked/);
    assert.match(adminChatCss, /--admin-chat-keyboard-dock-height/);
    assert.match(adminChatCss, /\.admin-chat-viewport-probe/);

    assert.match(shopHtml, /shop-client\.js\?v=20260510_SHOP_CATALOG_API_1/);
    assert.match(guestbookHtml, /guestbook\.js\?v=20260507_GUESTBOOK_DEEPLINK_REPLAY_1/);
    assert.match(shopHtml, /ios-scroll-lock\.js\?v=20260502_IOS_LIGHT_LOCK_SCROLL_ANCHOR_6/);
    assert.match(guestbookHtml, /ios-scroll-lock\.js\?v=20260502_IOS_LIGHT_LOCK_SCROLL_ANCHOR_6/);
    assert.match(guestbookHtml, /homepage-guestbook-modal\.js\?v=20260504_HOME_GUESTBOOK_KEYBOARD_RETRACT_1/);
    assert.match(adminStudioHtml, /admin-chat\.js\?v=20260505_CHAT_USER_ACTIVITY_1/);
    assert.match(adminStudioHtml, /ios-scroll-lock\.js\?v=20260502_IOS_LIGHT_LOCK_SCROLL_ANCHOR_6/);
    assert.match(chatWidgetLoader, /const VERSION = '20260509_ENGAGEMENT_ORDER_DETAIL_ROUTE_1';/);
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
    assert.match(chatWidget, /const contentSettleDelayMs = 420;/);
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
    assert.match(chatWidget, /html\[data-theme="light"\] \.chat-window:not\(\.admin-mode-layout\) \.message\.user[\s\S]*box-shadow: 0 8px 18px rgba\(148, 163, 184, 0\.08\) !important;/);
    assert.doesNotMatch(chatWidget, /body\.chat-widget-open \.framer-nav/);
    assert.doesNotMatch(chatWidget, /html\.chat-widget-open \{[\s\S]*background-color: #000 !important;/);
    assert.doesNotMatch(chatWidget, /body\.chat-spotlight-suspended[\s\S]{0,260}opacity:\s*0 !important/);
    assert.match(chatWidget, /_getChatThemeChromeColor\(\) \{[\s\S]*meta\?\.getAttribute\('content'\)/);
    assert.doesNotMatch(chatWidget, /themeColor: '#000000'/);
    assert.doesNotMatch(chatWidget, /meta\.setAttribute\('content', '#000000'\)/);
    assert.match(chatWidget, /chat-window--bootstrap-content-ready \.emoji-picker-popover:not\(\.active\)/);
    assert.match(chatWidgetCss, /\.loading-overlay--user-dots \{[\s\S]*background: var\(--chat-panel-bg/);
    assert.match(chatWidgetCss, /\.chat-loading-state--user-handoff \{[\s\S]*margin: auto;[\s\S]*color: var\(--chat-accent-blue/);
    assert.match(chatWidgetCss, /\.chat-loading-dots span \{[\s\S]*animation: chat-widget-loading-dots 1\.05s ease-in-out infinite;/);
    assert.doesNotMatch(chatWidgetCss, /\.chat-window:not\(\.admin-mode-layout\) \.chat-input-handoff-skeleton \{/);
    assert.match(chatWidgetCss, /html\[data-theme="light"\] \.chat-window:not\(\.admin-mode-layout\) \{[\s\S]*--chat-panel-shadow: none;[\s\S]*--chat-avatar-bg: rgba\(107, 158, 206, 0\.18\);/);
    assert.match(chatWidgetCss, /\.chat-window--bootstrap-adopting-content > \*:not\(\.chat-bootstrap-content-snapshot\)/);
    assert.match(chatWidgetCss, /\.chat-window--bootstrap-adopting-content\.chat-window--bootstrap-content-ready > \*:not\(\.emoji-picker-popover\):not\(\.chat-bootstrap-content-snapshot\)/);
    assert.match(chatWidgetCss, /\.chat-window--bootstrap-adopting-content\.chat-window--bootstrap-content-ready > \*:not\(\.emoji-picker-popover\):not\(\.chat-bootstrap-content-snapshot\) \{[\s\S]*opacity: 1;[\s\S]*chat-widget-content-settle/);
    assert.match(chatWidgetCss, /\.chat-bootstrap-content-snapshot \{[\s\S]*transition: opacity 300ms/);
    assert.match(chatWidgetCss, /\.chat-window--bootstrap-content-ready \.chat-bootstrap-content-snapshot \{[\s\S]*opacity: 0;[\s\S]*transition-delay: 80ms;/);
    assert.match(chatWidget, /\.chat-window--bootstrap-adopting-content\.chat-window--bootstrap-content-ready > \*:not\(\.emoji-picker-popover\):not\(\.chat-bootstrap-content-snapshot\)[\s\S]*opacity: 1;[\s\S]*chat-widget-content-settle/);
    assert.match(chatWidgetCss, /\.chat-window--bootstrap-content-ready \.emoji-picker-popover:not\(\.active\) \{[\s\S]*opacity: 0 !important;/);
    assert.match(chatWidgetCss, /@keyframes chat-widget-loading-dots \{[\s\S]*transform: translateY\(-3px\);[\s\S]*opacity: 0\.96;/);
    assert.match(walletLoader, /const VERSION = '20260508_SITE_SCOPED_CONFIG_1';/);
});
