const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('public pages prevent image dragging and nonessential text selection', () => {
    const framerHomeCss = readRepoFile(path.join('css', 'framer_home.css'));
    const sharedShellPages = [
        'index.html',
        'shop.html',
        'prompts.html',
        'verify.html',
        'guestbook.html',
        'privacy.html',
        'reset-password.html'
    ];
    const shopHtml = readRepoFile('shop.html');
    const shopCss = readRepoFile(path.join('css', 'shop-page.css'));
    const shopClient = readRepoFile(path.join('js', 'shop-client.js'));
    const promptsHtml = readRepoFile('prompts.html');
    const promptsCss = readRepoFile('prompts-poetry.css');
    const promptsRuntime = readRepoFile('prompts-poetry.js');

    sharedShellPages.forEach((relativePath) => {
        const source = readRepoFile(relativePath);
        assert.match(
            source,
            /css\/framer_home\.css\?v=[^"']*uiTextSelectGuard=20260530_UI_TEXT_SELECT_GUARD_1/,
            `${relativePath} should cache-bust the shared nonessential text selection guard`
        );
    });
    assert.match(
        framerHomeCss,
        /20260530_PUBLIC_UI_TEXT_SELECT_GUARD_1[\s\S]*\.verify-mode-selector,[\s\S]*\.guestbook-composer-header,[\s\S]*\.reset-title,[\s\S]*\.privacy-page \.update-date\) \{\s+-webkit-user-select: none;\s+user-select: none;[\s\S]*\.privacy-page \.content,[\s\S]*\.message-content,[\s\S]*\.verify-result-link,[\s\S]*\.index-footer-email,[\s\S]*-webkit-user-select: text;\s+user-select: text;/
    );

    assert.match(
        shopHtml,
        /css\/shop-page\.css\?v=20260520_SHOP_CARD_PROMPT_BREATHE_3[\s\S]*imageDragLock=20260530_IMAGE_DRAG_LOCK_1/
    );
    assert.match(
        shopHtml,
        /js\/shop-client\.js\?v=20260520_SHOP_CARD_PROMPT_BREATHE_3[\s\S]*imageDragLock=20260530_IMAGE_DRAG_LOCK_1/
    );
    assert.equal(
        (shopHtml.match(/uiTextSelectGuard=20260530_UI_TEXT_SELECT_GUARD_1/g) || []).length,
        3,
        'shop.html should cache-bust the shared, shop CSS, and shop JS nonessential text selection guards'
    );
    assert.equal(
        (shopHtml.match(/cartDrawerSelectGuard=20260530_SHOP_CART_DRAWER_SELECT_GUARD_1/g) || []).length,
        2,
        'shop.html should cache-bust cart drawer text selection guards on shop CSS and JS'
    );
    assert.match(
        shopCss,
        /body\.shop-page img \{\s+-webkit-user-drag: none;\s+user-drag: none;\s+user-select: none;\s+\}/
    );
    assert.match(
        shopCss,
        /body\.shop-page \.shop-card,\s+body\.shop-page \.shop-card \* \{\s+-webkit-user-select: none;\s+user-select: none;\s+\}/
    );
    assert.match(
        shopCss,
        /body\.shop-page \.framer-nav,[\s\S]*body\.shop-page #shopCategoryFilters,[\s\S]*body\.shop-page \.shop-cart-anchor \*,[\s\S]*body\.shop-page #shopPurchaseModal \.shop-purchase-stage-summary,[\s\S]*body\.shop-page #purchaseDiscountCode:placeholder-shown \{\s+-webkit-user-select: none;\s+user-select: none;\s+\}/
    );
    assert.match(
        shopCss,
        /20260530_SHOP_CART_DRAWER_SELECT_GUARD_1[\s\S]*body\.shop-page #shopCartDrawer,\s+body\.shop-page #shopCartDrawer \* \{\s+-webkit-user-select: none;\s+user-select: none;\s+\}/
    );
    assert.match(
        shopCss,
        /body\.shop-page #purchaseDiscountCode:not\(:placeholder-shown\) \{\s+-webkit-user-select: text;\s+user-select: text;\s+\}/
    );
    assert.match(
        shopCss,
        /body\.shop-page #shopCartDrawer \.shop-cart-item__panel--notice,[\s\S]*body\.shop-page #shopCartDrawer \.shop-cart-item__panel--usage \* \{\s+-webkit-user-select: text;\s+user-select: text;\s+\}/
    );
    assert.match(
        shopClient,
        /function preventShopImageDrag\(event\)[\s\S]*event\.target\.closest\('img'\)[\s\S]*event\.preventDefault\(\);/
    );
    assert.match(
        shopClient,
        /function preventShopCardTextSelection\(event\)[\s\S]*event\.target\.closest\('\.shop-card'\)[\s\S]*event\.preventDefault\(\);/
    );
    [
        'const SHOP_NON_SELECTABLE_UI_SELECTOR = [',
        '\'.framer-nav\'',
        '\'#shopCategoryFilters\'',
        '\'.filter-tab\'',
        '\'.shop-cart-anchor\'',
        '\'#shopCartDrawer\'',
        '\'#shopPurchaseModal .shop-purchase-stage-summary\'',
        '\'#purchaseDiscountCode\'',
        'const SHOP_SELECTABLE_TEXT_SELECTOR = [',
        '\'#purchaseNotesContent\'',
        '\'#purchaseUsageContent\'',
        '\'#shopCartDrawer .shop-cart-item__panel--notice\'',
        '\'#shopCartDrawer .shop-cart-item__panel--usage\'',
        'if (discountInput && discountInput.value) return;',
        'if (event.target.closest(SHOP_SELECTABLE_TEXT_SELECTOR)) return;',
        'event.target.closest(SHOP_NON_SELECTABLE_UI_SELECTOR)'
    ].forEach((marker) => {
        assert.equal(shopClient.includes(marker), true, `shop-client.js should include ${marker}`);
    });
    [
        'document.addEventListener(\'dragstart\', preventShopImageDrag);',
        'document.addEventListener(\'selectstart\', preventShopCardTextSelection);',
        '<img src="${safeIconSource}" class="${imageClass}" alt="${safeAlt}" loading="lazy" decoding="async" draggable="false">',
        '<img src="${safeIconUrl}" width="40" class="shop-card-thumb" alt="${safeCardImageAlt}" loading="lazy" decoding="async" draggable="false">',
        '<img class="shop-card-image-cover" alt="${safeCardImageAlt}" width="480" height="320" draggable="false">',
        '<img src="${safeIcon}" class="shop-order-history-icon shop-order-history-icon--image" alt="" draggable="false">'
    ].forEach((marker) => {
        assert.equal(shopClient.includes(marker), true, `shop-client.js should include ${marker}`);
    });

    assert.match(
        promptsHtml,
        /prompts-poetry\.css\?v=20260503_PROMPTS_MODAL_CHROME_CLOSE_1[\s\S]*imageDragLock=20260530_IMAGE_DRAG_LOCK_1/
    );
    assert.match(
        promptsHtml,
        /prompts-poetry\.js\?v=20260507_REPLY_REALTIME_1[\s\S]*imageDragLock=20260530_IMAGE_DRAG_LOCK_1/
    );
    assert.equal(
        (promptsHtml.match(/uiTextSelectGuard=20260530_UI_TEXT_SELECT_GUARD_1/g) || []).length,
        3,
        'prompts.html should cache-bust the shared, prompts CSS, and prompts JS nonessential text selection guards'
    );
    assert.match(
        promptsHtml,
        /<img id="featuredImage" src="" alt="Featured Artwork" loading="eager" draggable="false">/
    );
    assert.match(
        promptsHtml,
        /<img id="modalImg" src="" alt="Prompt Visual" draggable="false">/
    );
    assert.match(
        promptsCss,
        /body\.prompts-page img \{\s+-webkit-user-drag: none;\s+user-drag: none;\s+user-select: none;\s+\}/
    );
    assert.match(
        promptsCss,
        /body\.prompts-page \.prompt-card,\s+body\.prompts-page \.prompt-card \* \{\s+-webkit-user-select: none;\s+user-select: none;\s+\}/
    );
    assert.match(
        promptsCss,
        /body\.prompts-page \.framer-nav,[\s\S]*body\.prompts-page \.search-dropdown,[\s\S]*body\.prompts-page \.sort-option \* \{\s+-webkit-user-select: none;\s+user-select: none;\s+\}/
    );
    assert.match(
        promptsCss,
        /body\.prompts-page input,[\s\S]*body\.prompts-page #modalPromptText \* \{\s+-webkit-user-select: text;\s+user-select: text;\s+\}/
    );
    assert.match(
        promptsRuntime,
        /function preventPromptImageDrag\(event\)[\s\S]*event\.target\.closest\('img'\)[\s\S]*event\.preventDefault\(\);/
    );
    assert.match(
        promptsRuntime,
        /function preventPromptCardTextSelection\(event\)[\s\S]*event\.target\.closest\('\.prompt-card'\)[\s\S]*event\.preventDefault\(\);/
    );
    [
        'const PROMPTS_NON_SELECTABLE_UI_SELECTOR = [',
        '\'.framer-nav\'',
        '\'.search-dropdown\'',
        '\'.inline-hot-tag\'',
        '\'.sort-option\'',
        'event.target.closest(PROMPTS_NON_SELECTABLE_UI_SELECTOR)'
    ].forEach((marker) => {
        assert.equal(promptsRuntime.includes(marker), true, `prompts-poetry.js should include ${marker}`);
    });
    [
        'document.addEventListener(\'dragstart\', preventPromptImageDrag);',
        'document.addEventListener(\'selectstart\', preventPromptCardTextSelection);',
        '<img class="card-image" loading="${shouldLoadImageEagerly ? \'eager\' : \'lazy\'}" decoding="async" alt="${getLocalizedField(item, \'title\')}" draggable="false">',
        '<img src="" alt="Full size" draggable="false" />',
        '<img src="${avatarUrl}" class="comment-avatar" alt="${name}" draggable="false">',
        'disablePromptImageDrag(newImg);',
        'disablePromptImageDrag(cardImage);'
    ].forEach((marker) => {
        assert.equal(promptsRuntime.includes(marker), true, `prompts-poetry.js should include ${marker}`);
    });
});

test('shared public overlays prevent nonessential component text selection', () => {
    const marker = '20260530_PUBLIC_COMPONENT_SELECT_GUARD_1';
    const componentPages = [
        'index.html',
        'shop.html',
        'prompts.html',
        'verify.html',
        'guestbook.html',
        'privacy.html',
        'reset-password.html'
    ];
    const authCss = readRepoFile(path.join('css', 'auth-sheet.css'));
    const profileCss = readRepoFile(path.join('css', 'profile-modal.css'));
    const walletCss = readRepoFile(path.join('css', 'wallet.css'));
    const notificationCss = readRepoFile(path.join('css', 'notification-client.css'));
    const chatCss = readRepoFile(path.join('css', 'chat-widget.css'));
    const profileLoader = readRepoFile(path.join('js', 'profile-modal-loader.js'));
    const walletLoader = readRepoFile(path.join('js', 'wallet-modal-loader.js'));
    const walletModal = readRepoFile(path.join('js', 'components', 'WalletModal.js'));

    componentPages.forEach((relativePath) => {
        const source = readRepoFile(relativePath);
        assert.match(
            source,
            /componentSelectGuard=20260530_PUBLIC_COMPONENT_SELECT_GUARD_1/,
            `${relativePath} should cache-bust component-level selection guards`
        );
    });

    assert.match(
        authCss,
        /20260530_PUBLIC_COMPONENT_SELECT_GUARD_1[\s\S]*#loginModal\.auth-sheet-overlay,\s+#loginModal\.auth-sheet-overlay \* \{\s+-webkit-user-select: none;\s+user-select: none;[\s\S]*#loginModal\.auth-sheet-overlay :where\(input, textarea, select, \[contenteditable="true"\], \[contenteditable="true"\] \*\) \{\s+-webkit-user-select: text;\s+user-select: text;/
    );
    assert.match(
        profileCss,
        /20260530_PUBLIC_COMPONENT_SELECT_GUARD_1[\s\S]*#profileModal,\s+#profileModal \* \{\s+-webkit-user-select: none;\s+user-select: none;[\s\S]*#profileModal :where\(#profileMobileHeroEmail, #profileMobileHeroId, #profileMobileEmailValue, \.profile-mobile-info-value, \.profile-mobile-info-value \*\) \{\s+-webkit-user-select: text;\s+user-select: text;/
    );
    assert.match(
        walletCss,
        /20260530_PUBLIC_COMPONENT_SELECT_GUARD_1[\s\S]*\.wallet-overlay,[\s\S]*\.wallet-order-modal-overlay \* \{\s+-webkit-user-select: none;\s+user-select: none;[\s\S]*\.wallet-order-modal-overlay :where\(\.detail-val\.copyable,[\s\S]*\.wallet-order-guidance-content,[\s\S]*\.wallet-crypto-address-text,[\s\S]*\.item-text/
    );
    assert.match(
        notificationCss,
        /20260530_PUBLIC_COMPONENT_SELECT_GUARD_1[\s\S]*\.notif-drawer,\s+\.notif-drawer \* \{\s+-webkit-user-select: none;\s+user-select: none;[\s\S]*\.notif-drawer img \{\s+-webkit-user-drag: none;\s+user-drag: none;/
    );
    assert.match(
        chatCss,
        /20260530_PUBLIC_COMPONENT_SELECT_GUARD_1[\s\S]*\.chat-window :where\(\.chat-header,[\s\S]*\.chat-input-area,[\s\S]*\.message-time-separator,[\s\S]*-webkit-user-select: none;[\s\S]*\.chat-window :where\(\.message,[\s\S]*\.chat-input,[\s\S]*\.chat-support-ticket-copy/
    );
    [
        'css/profile-modal.css?v=20260503_PROFILE_MODAL_CHROME_CLOSE_1&componentSelectGuard=20260530_PUBLIC_COMPONENT_SELECT_GUARD_1',
        'js/components/WalletModal.js?v=20260525_WALLET_DISCOUNT_SKU_SCOPE_1&componentSelectGuard=20260530_PUBLIC_COMPONENT_SELECT_GUARD_1',
        'css/wallet.css?v=20260525_WALLET_DISCOUNT_SKU_SCOPE_1&componentSelectGuard=20260530_PUBLIC_COMPONENT_SELECT_GUARD_1'
    ].forEach((markerText) => {
        assert.equal(
            profileLoader.includes(markerText) || walletLoader.includes(markerText) || walletModal.includes(markerText),
            true,
            `lazy component runtimes should load ${markerText}`
        );
    });
});
