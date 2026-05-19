const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('shop purchase modal remains scrollable when the mobile keyboard docks it', () => {
    const shopStyles = readRepoFile(path.join('css', 'shop-page.css'));
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const shopHtml = readRepoFile('shop.html');

    assert.equal(
        shopHtml.includes('css/shop-page.css?v=20260513_SHOP_PURCHASE_QTY_SHADOW_1'),
        true,
        'shop.html should load the keyboard-dock cache-busted storefront stylesheet'
    );

    assert.equal(
        shopHtml.includes('js/shop-client.js?v=20260519_PUBLIC_API_FAST_PATH_1'),
        true,
        'shop.html should load the viewport-sync cache-busted storefront runtime'
    );

    assert.match(
        shopStyles,
        /#shopPurchaseModal \{[\s\S]*--shop-purchase-overlay-height: 100dvh;[\s\S]*--shop-purchase-viewport-top: 0px;[\s\S]*--shop-purchase-viewport-left: 0px;[\s\S]*--shop-purchase-viewport-width: 100vw;[\s\S]*top: var\(--shop-purchase-viewport-top\) !important;[\s\S]*height: var\(--shop-purchase-overlay-height\) !important;[\s\S]*overflow: hidden !important;/,
        'purchase modal overlay should be positioned against the native visual viewport like the wallet modal'
    );

    assert.match(
        shopStyles,
        /html\.shop-purchase-modal-lock,[\s\S]*body\.shop-purchase-modal-lock \{[\s\S]*overflow: hidden !important;[\s\S]*background: var\(--shop-purchase-theme-chrome-color, var\(--site-theme-chrome-color, var\(--bg-color\)\)\) !important;[\s\S]*body\.shop-purchase-modal-lock \{[\s\S]*position: fixed !important;[\s\S]*top: var\(--shop-purchase-lock-top, 0px\) !important;/,
        'purchase modal should freeze the page with a theme-aware body background before the active overlay frame'
    );

    assert.match(
        shopStyles,
        /#shopPurchaseModal\.shop-purchase-force-hidden,[\s\S]*#shopPurchaseModal\[hidden\] \{[\s\S]*display: none !important;[\s\S]*transition: none !important;/,
        'purchase modal should bypass overlay fade rules when closing so the iOS address-bar white area disappears immediately'
    );

    assert.equal(
        shopStyles.includes('shop-purchase-chrome-fill'),
        false,
        'purchase modal should not retain the old extra-height chrome fill'
    );

    assert.match(
        shopStyles,
        /#shopPurchaseModal \.modal-content\.shop-purchase-height-locked \{[\s\S]*overflow-y: auto !important;[\s\S]*overflow-x: hidden !important;/,
        'keyboard-locked purchase modal height should still expose a scrollable content area'
    );

    assert.match(
        shopStyles,
        /@media \(max-width: 768px\) \{[\s\S]*#shopPurchaseModal \.modal-content \{[\s\S]*overflow-y: auto !important;[\s\S]*-webkit-overflow-scrolling: touch;[\s\S]*touch-action: pan-y;[\s\S]*scroll-padding-bottom: calc\(96px \+ env\(safe-area-inset-bottom, 0px\)\);/s,
        'mobile purchase modal content should be the scroll container accepted by the iOS scroll lock'
    );

    assert.match(
        shopClientSource,
        /schedulePurchaseModalKeyboardContentSync:\s*function\s*\(/,
        'shop-client.js should schedule a dock refresh after modal content changes'
    );

    assert.match(
        shopClientSource,
        /const liveScrollHeight = Math\.round\(card\.scrollHeight \|\| 0\);[\s\S]*const baseCardHeight = Math\.max\(320,[\s\S]*liveScrollHeight\);/,
        'keyboard dock height should account for the full scrollHeight of coupon-rich modal content'
    );

    assert.match(
        shopClientSource,
        /shouldDockPurchaseModalForInput:\s*function\s*\(input, metrics = this\.getPurchaseModalViewportMetrics\(\)\) \{[\s\S]*const keyboardTop = Math\.max\(0, Math\.round\(\(metrics\.baseViewportHeight \|\| 0\) - bottomInset\)\);[\s\S]*return inputRect\.bottom > keyboardTop - bottomGuard;/,
        'purchase modal should only dock upward when the focused input would be covered by the keyboard'
    );

    assert.match(
        shopClientSource,
        /const needsKeyboardDock = !!activeInput && this\.shouldDockPurchaseModalForInput\(activeInput, metrics\);[\s\S]*const shouldDock = needsKeyboardDock && \(this\.purchaseModalKeyboardDocked \? bottomInset > 8 : bottomInset > 24\);[\s\S]*if \(!this\.shouldDockPurchaseModalForInput\(liveInput, liveMetrics\)\) return;/,
        'purchase modal should recheck focused-input coverage before running the first keyboard dock animation'
    );

    assert.match(
        shopClientSource,
        /getPurchaseModalNativeViewportFrame:\s*function \(\) \{[\s\S]*const visualTop = Math\.max\(0, vv\?\.offsetTop \|\| 0\);[\s\S]*const visualLeft = Math\.max\(0, vv\?\.offsetLeft \|\| 0\);[\s\S]*const overlayHeight = Math\.max\(320, Math\.round\([\s\S]*visualHeight[\s\S]*return \{[\s\S]*top: Math\.round\(visualTop\),[\s\S]*left: Math\.round\(visualLeft\),[\s\S]*width: visualWidth,[\s\S]*overlayHeight,/,
        'purchase modal should derive its overlay frame from visualViewport top/left/width/height'
    );

    assert.match(
        shopClientSource,
        /const visualWidth = Math\.max\(\s*1,\s*Math\.round\(vv\?\.width \|\| window\.innerWidth \|\| document\.documentElement\.clientWidth \|\| document\.body\?\.clientWidth \|\| 0\)\s*\);/,
        'purchase modal should use the live visual viewport width instead of pinning the overlay to a 320px minimum'
    );

    assert.doesNotMatch(
        shopClientSource,
        /const visualWidth = Math\.max\(320,/,
        'purchase modal should not keep the retired 320px viewport-width clamp that breaks narrow desktop windows'
    );

    assert.match(
        shopClientSource,
        /freezePurchaseModalPage:\s*function \(\) \{[\s\S]*const theme = this\.getCurrentThemeChromeMode\(\);[\s\S]*const themeColor = this\.getThemeChromeColor\(theme\);[\s\S]*document\.documentElement\.classList\.add\('shop-purchase-modal-lock'\);[\s\S]*document\.body\.classList\.add\('shop-purchase-modal-lock'\);[\s\S]*'--shop-purchase-theme-chrome-color': themeColor,[\s\S]*'--shop-purchase-lock-top': `-\$\{this\.purchaseModalBaseScrollY\}px`[\s\S]*metaTheme\.setAttribute\('data-shop-purchase-theme-lock', 'true'\);[\s\S]*metaTheme\.setAttribute\('data-mobile-theme-lock', 'true'\);[\s\S]*window\.applySiteThemeChrome\(theme, \{ forceRepaint: true \}\);[\s\S]*this\.stabilizePurchaseModalViewport\(\);/,
        'purchase modal should freeze the page and lock the iOS address-bar chrome to the current theme before opening'
    );

    assert.match(
        shopClientSource,
        /shouldUsePurchaseModalLightOpenLock:\s*function \(\) \{[\s\S]*return this\.shouldUseShopBackdropTouchFallback\(\);[\s\S]*freezePurchaseModalPage:\s*function \(\) \{[\s\S]*if \(this\.shouldUsePurchaseModalLightOpenLock\(\)\) return;[\s\S]*window\.iOSScrollLock\.lockLight\(modal, \{[\s\S]*restoreScrollDuringViewport: true/,
        'iOS Chrome purchase modal should use light scroll lock on open so background cards do not jump when opened from the page bottom'
    );

    assert.match(
        shopClientSource,
        /unfreezePurchaseModalPage:\s*function \(\) \{[\s\S]*document\.documentElement\.classList\.remove\('shop-purchase-modal-lock'\);[\s\S]*document\.body\.classList\.remove\('shop-purchase-modal-lock'\);[\s\S]*'--shop-purchase-theme-chrome-color': '',[\s\S]*metaTheme\.removeAttribute\('data-shop-purchase-theme-lock'\);[\s\S]*metaTheme\.removeAttribute\('data-mobile-theme-lock'\);[\s\S]*window\.applySiteThemeChrome\(theme, \{ forceRepaint: true \}\);/,
        'purchase modal should release its theme chrome lock immediately when closing'
    );

    assert.match(
        shopClientSource,
        /capturePurchaseModalOverlayHeight:\s*function \(force = false\) \{[\s\S]*const frame = this\.getPurchaseModalNativeViewportFrame\(\);[\s\S]*const measuredHeight = Math\.max\(0, Math\.round\(frame\.overlayHeight \|\| 0\)\);[\s\S]*const baseHeight = Math\.round\(this\.purchaseModalKeyboardBaseViewportHeight \|\| 0\);[\s\S]*const shouldPreserveForKeyboard = this\.purchaseModalKeyboardDocked \|\| !!this\.getActivePurchaseModalInput\(\);[\s\S]*const shouldPreserveKeyboardBase = overlay\.classList\.contains\('active'\)\s+&& shouldPreserveForKeyboard\s+&& baseHeight > measuredHeight;[\s\S]*const overlayHeight = shouldPreserveKeyboardBase \? baseHeight : measuredHeight;[\s\S]*'--shop-purchase-viewport-top': `\$\{frame\.top\}px`,[\s\S]*'--shop-purchase-viewport-left': `\$\{frame\.left\}px`,[\s\S]*'--shop-purchase-viewport-width': `\$\{frame\.width\}px`,[\s\S]*'--shop-purchase-overlay-height': `\$\{overlayHeight\}px`[\s\S]*if \(shouldPreserveKeyboardBase\) return;/,
        'purchase modal should preserve the pre-keyboard overlay height only while keyboard-related focus or docking is active'
    );

    assert.match(
        shopClientSource,
        /schedulePurchaseModalOpenViewportStabilization:\s*function \(\) \{[\s\S]*this\.schedulePurchaseModalViewportSync\(true\);[\s\S]*\[48, 140, 320\]\.forEach\(\(delayMs\) => \{[\s\S]*this\.syncPurchaseModalOverlayViewport\(true\);[\s\S]*this\.syncPurchaseModalKeyboardDock\(\);[\s\S]*detachPurchaseModalViewportSync:\s*function \(\) \{[\s\S]*this\.clearPurchaseModalOpenViewportStabilization\(\);/,
        'purchase modal should resample the iOS Chrome viewport after opening so the sheet recenters when browser chrome settles'
    );

    assert.match(
        shopClientSource,
        /schedulePurchaseModalViewportSync:\s*function \(force = false\) \{[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*this\.syncPurchaseModalOverlayViewport\(force\);[\s\S]*\}\);/,
        'purchase modal should coalesce live viewport resizes through one animation-frame sync'
    );

    assert.match(
        shopClientSource,
        /attachPurchaseModalViewportSync:\s*function \(\) \{[\s\S]*window\.addEventListener\('resize', handleViewportChange, \{ passive: true \}\);[\s\S]*window\.addEventListener\('orientationchange', handleViewportChange, \{ passive: true \}\);[\s\S]*window\.visualViewport\?\.addEventListener\('resize', handleViewportChange, \{ passive: true \}\);[\s\S]*window\.visualViewport\?\.addEventListener\('scroll', handleViewportChange, \{ passive: true \}\);/,
        'purchase modal should keep listening for desktop and visual viewport changes while it is open'
    );

    assert.equal(
        shopClientSource.includes('shop-purchase-chrome-fill'),
        false,
        'shop-client.js should not retain the retired artificial chrome fill runtime'
    );

    assert.match(
        shopClientSource,
        /modal\.classList\.remove\('shop-purchase-force-hidden'\);\s+modal\.hidden = false;\s+modal\.classList\.remove\('active'\);\s+this\.freezePurchaseModalPage\(\);\s+this\.capturePurchaseModalOverlayHeight\(true\);\s+if \(!this\.purchaseModalPageFrozen && window\.iOSScrollLock\) \{[\s\S]*window\.iOSScrollLock\.lockLight\(modal, \{[\s\S]*restoreScrollDuringViewport: true[\s\S]*modal\.classList\.add\('active'\);\s+this\.attachPurchaseModalViewportSync\(\);\s+this\.attachPurchaseModalKeyboardDock\(\);\s+this\.schedulePurchaseModalOpenViewportStabilization\(\);/,
        'purchase modal should freeze the iOS page and capture the visual viewport before the active overlay frame is painted'
    );

    assert.match(
        shopClientSource,
        /closePurchaseModal:\s*function \(\) \{[\s\S]*activeInput\?\.blur\(\);[\s\S]*modal\.classList\.add\('shop-purchase-force-hidden'\);\s+modal\.hidden = true;\s+modal\.classList\.remove\('active'\);\s+void modal\.offsetHeight;[\s\S]*this\.detachPurchaseModalViewportSync\(\);[\s\S]*this\.detachPurchaseModalKeyboardDock\(\);[\s\S]*if \(this\.purchaseModalPageFrozen\) \{[\s\S]*this\.unfreezePurchaseModalPage\(\);/,
        'purchase modal should force-hide before cleanup and lock release so the address-bar white area disappears in the close frame'
    );

    assert.match(
        shopClientSource,
        /requestAnimationFrame\(\(\) => \{[\s\S]*this\.capturePurchaseModalOverlayHeight\(\);[\s\S]*this\.syncPurchaseModalKeyboardDock\(\);[\s\S]*\}\);/,
        'purchase modal should keep the native overlay height aligned while iOS Safari settles viewport changes'
    );

    assert.equal(
        shopClientSource.includes('getPurchaseModalStableViewportProbe'),
        false,
        'purchase modal should not use a 100svh stable viewport probe that can overrun the native address bar'
    );

    assert.match(
        shopClientSource,
        /renderPurchaseDiscountAssets:\s*function\s*\(\) \{[\s\S]*this\.schedulePurchaseModalKeyboardContentSync\(\);[\s\S]*this\.schedulePurchaseModalKeyboardContentSync\(\);[\s\S]*\},/,
        'discount asset rendering should resync the dock for both empty/loading and populated states'
    );
});
