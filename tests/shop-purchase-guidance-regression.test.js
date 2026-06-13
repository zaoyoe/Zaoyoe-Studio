const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('shop purchase guidance flow refreshes latest notes and versions prefetched product snapshots', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const homeBootstrapSource = readRepoFile(path.join('js', 'index-home-bootstrap.js'));
    const shopHandlerSource = readRepoFile(path.join('server', 'api-handlers', 'public', 'shop.js'));
    const shopGuidanceApiSource = readRepoFile(path.join('api', 'shop', 'product-guidance.js'));
    const walletModalSource = readRepoFile(path.join('js', 'components', 'WalletModal.js'));
    const shopHtmlSource = readRepoFile('shop.html');
    const shopCssSource = readRepoFile(path.join('css', 'shop-page.css'));
    const chatWidgetCssSource = readRepoFile(path.join('css', 'chat-widget.css'));
    const chatWidgetLoaderSource = readRepoFile(path.join('js', 'chat-widget-loader.js'));
    const zhLang = JSON.parse(readRepoFile(path.join('lang', 'zh.json')));
    const enLang = JSON.parse(readRepoFile(path.join('lang', 'en.json')));
    const publicScrollbarSource = readRepoFile(path.join('js', 'public-scrollbar-auto-hide.js'));
    const publicScrollbarCss = readRepoFile(path.join('css', 'public-scrollbar-auto-hide.css'));

    assert.match(
        shopClientSource,
        /const SHOP_PREFETCH_SCHEMA_VERSION = '20260614_SHOP_CATEGORY_DEFAULT_FIRST_1';/,
        'shop-client.js should define a dedicated schema version for prefetched shop payloads'
    );
    assert.match(
        shopClientSource,
        /const initialQuantity = Math\.max\(1, Math\.min\(quantityCap[\s\S]*?if \(!manualDelivery && !soldOut\) \{\s+void this\.prefetchDiscountAssetsForProduct\(\{\s+productId,\s+productSkuId: options\?\.productSkuId \|\| options\?\.skuId \|\| '',\s+quantity: initialQuantity,\s+agentId: this\.currentAgentId,\s+site: window\.SiteConfig\?\.site \|\| 'cn'\s+\}\);\s+\}\s+this\.openPurchaseModal\(productId, productName, productNameEn, price, rules, quantityCap, purchaseNotes, usageInstructions, \{\s+category: productCategory,\s+sourceContext,\s+initialQuantity,\s+productSkuId: options\?\.productSkuId \|\| options\?\.skuId \|\| '',\s+manualDelivery,\s+soldOut\s+\}\);\s+void this\.refreshCurrentPurchaseGuidance\(productId\);\s+void this\.syncPurchaseAccessAfterOpen\(productId, quantityCap\);/s,
        'shop purchase clicks should prefetch discount assets, open the modal immediately, refresh the latest product guidance, and sync purchase access in the background'
    );
    assert.doesNotMatch(
        shopClientSource,
        /buyProduct: async function[\s\S]*?supabaseClient\.auth\.getSession\(\)[\s\S]*?openPurchaseModal/s,
        'shop purchase clicks should no longer block the modal behind an upfront getSession() login check'
    );
    assert.match(
        shopClientSource,
        /confirmPurchase: async function \(\{ triggerButton = null \} = \{\}\) \{\s+if \(this\.purchaseProcessing\) return;[\s\S]*const btn = this\.resolvePurchaseActionButton\(triggerButton\);[\s\S]*this\.purchaseProcessing = true;[\s\S]*btn\.innerHTML = `<i class="fas fa-spinner fa-spin"><\/i> <span>\$\{processingText\}<\/span>`;[\s\S]*try \{[\s\S]*await new Promise\(\(resolve\) => \{\s+window\.requestAnimationFrame\(\(\) => resolve\(\)\);\s+\}\);[\s\S]*const shouldContinueAfterCouponSync = await this\.waitForPurchaseDiscountAssetsBeforeSubmit\(\);[\s\S]*const token = await this\.getAccessToken\(\);[\s\S]*if \(!token\) \{[\s\S]*restoreIdleButtonState\(\);[\s\S]*this\.promptLoginForPurchase/s,
        'confirmPurchase should show processing immediately, flush one frame, briefly resolve coupon sync, and only then wait for auth before prompting login if needed'
    );
    assert.match(
        shopClientSource,
        /bindShopMobileTapFallback: function \(element, bindingKey, handler\) \{[\s\S]*element\.addEventListener\('touchend'[\s\S]*invoke\(event\);[\s\S]*handlePurchasePrimaryActionTap: function \(eventOrButton = null\) \{[\s\S]*void this\.confirmPurchase\(\{ triggerButton: actionButton \}\);/s,
        'shop purchase primary action should share the direct mobile tap fallback instead of relying only on modal click bubbling'
    );
    assert.match(
        shopClientSource,
        /bindPurchaseModalControlTapFallbacks: function \(\) \{[\s\S]*this\.bindPurchaseActionButtonTapFallbacks\(\);[\s\S]*\[data-shop-qty-delta\][\s\S]*applyDiscountBtn[\s\S]*purchaseNotesToggle[\s\S]*purchaseAddToCartBtn[\s\S]*this\.bindPurchaseDiscountActionTapFallbacks\(\);[\s\S]*bindCartCheckoutModalTapFallbacks: function \(\) \{[\s\S]*shopCartCheckoutBackBtn[\s\S]*shopCartCheckoutConfirmBtn/s,
        'shop purchase modal and cart checkout controls should get direct mobile tap fallbacks as well'
    );
    [
        "return this.isIOSMobileViewport() && /CriOS/i.test(navigator.userAgent || '');",
        'armShopModalBackdropTapGuard: function (durationMs = 650)',
        'document.addEventListener(type, consumeSyntheticClick, true);',
        'event.stopImmediatePropagation?.();',
        'bindShopModalBackdropTouchFallback: function (element, bindingKey, closeHandler)',
        "element.addEventListener('touchend'",
        'this.armShopModalBackdropTapGuard();',
        'closeHandler(event, element);'
    ].forEach((marker) => {
        assert.equal(
            shopClientSource.includes(marker),
            true,
            `shop modal backdrop touch fallback should include ${marker}`
        );
    });
    assert.match(
        shopClientSource,
        /bindShopModalBackdropTouchFallback\(document\.getElementById\('shopCartBackdrop'\), 'cart-drawer'[\s\S]*bindShopModalBackdropTouchFallback\(cartCheckoutModal, 'cart-checkout-modal'[\s\S]*bindShopModalBackdropTouchFallback\(purchaseModal, 'purchase-modal'[\s\S]*bindShopModalBackdropTouchFallback\(successModal, 'success-modal'/s,
        'shop backdrop touch fallback should cover cart, checkout, purchase, and success overlays'
    );
    assert.match(
        shopHtmlSource,
        /shopModalBackdropTap=20260514_SHOP_MODAL_CHROME_BACKDROP_TAP_1/,
        'shop.html should bust the shop client cache for the iOS Chrome backdrop tap fix'
    );
    assert.match(
        shopHtmlSource,
        /purchaseModalCenter=20260514_SHOP_PURCHASE_CENTER_CHROME_1/,
        'shop.html should bust the shop client cache for the iOS Chrome purchase modal centering fix'
    );
    assert.match(
        shopHtmlSource,
        /purchaseLightLock=20260514_SHOP_PURCHASE_CHROME_LIGHT_LOCK_1/,
        'shop.html should bust the shop client cache for the iOS Chrome purchase modal light-lock fix'
    );
    assert.match(
        shopClientSource,
        /const prefetchVersionMatches = prefetch\?\.version === SHOP_PREFETCH_SCHEMA_VERSION;/,
        'shop-client.js should reject stale shop_prefetch payloads from older schemas'
    );
    assert.match(
        shopClientSource,
        /revalidatePrefetchedShopData: async function \(\)/,
        'shop-client.js should expose a background revalidation path for prefetched shop data'
    );
    assert.match(
        shopClientSource,
        /const hasRenderedCards = !!grid\?\.querySelector\('\.shop-card\[data-product-id\]'\);[\s\S]*?if \(!hasRenderedCards\) \{[\s\S]*?await this\.loadProducts\(\{ forceRefresh: true \}\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?const products = await this\.getProductsForCategory\(this\.currentCategory, \{ forceRefresh: true \}\);/s,
        'prefetched shop revalidation should refresh caches without replacing already rendered product cards'
    );
    assert.match(
        shopClientSource,
        /if \(usedPrefetch\) \{\s+void this\.revalidatePrefetchedShopData\(\);\s+\}/s,
        'shop init should revalidate prefetched shop data after the instant first paint'
    );
    assert.match(
        shopClientSource,
        /loadCategoryFilters: async function \(\{ forceRefresh = false \} = \{\}\)/,
        'shop category loading should support force-refresh so prefetched categories can be revalidated'
    );
    assert.match(
        shopClientSource,
        /sessionStorage\.setItem\('shop_prefetch', JSON\.stringify\(\{\s+version: SHOP_PREFETCH_SCHEMA_VERSION,/s,
        'shop-client.js should persist shop_prefetch with an explicit schema version'
    );
    assert.match(
        homeBootstrapSource,
        /const SHOP_PREFETCH_SCHEMA_VERSION = '20260614_SHOP_CATEGORY_DEFAULT_FIRST_1';/,
        'homepage shop prefetch should use the same category-default-aware schema version'
    );
    assert.match(
        homeBootstrapSource,
        /sessionStorage\.setItem\('shop_prefetch', JSON\.stringify\(\{\s+version: SHOP_PREFETCH_SCHEMA_VERSION,/s,
        'homepage shop prefetch should stamp the schema version into sessionStorage'
    );
    assert.match(
        shopClientSource,
        /fetch\('\/api\/shop\/product-guidance'/,
        'shop-client.js should load latest purchase guidance through the dedicated server route'
    );
    assert.doesNotMatch(
        shopClientSource,
        /confirmNotesContent|confirmNotesTitle|confirmNotesBox/,
        'step 2 should no longer render a duplicated purchase notes block'
    );
    assert.doesNotMatch(
        shopClientSource,
        /purchaseStepBadge|shopPurchaseModalCloseBtn/,
        'shop-client.js should not depend on the removed purchase step badge or close button'
    );
    assert.match(
        shopClientSource,
        /guidanceSelect = 'show_purchase_notes, purchase_notes, purchase_notes_zh, purchase_notes_en, show_usage_instructions, usage_instructions, usage_instructions_zh, usage_instructions_en'/,
        'shop-client.js should keep a bilingual direct product guidance fallback for local and static preview environments'
    );
    assert.match(
        shopHandlerSource,
        /'product-guidance': async function productGuidanceHandler/,
        'shared shop handlers should expose a product-guidance route'
    );
    assert.doesNotMatch(
        shopHandlerSource,
        /shop-product-guidance:user:/,
        'product guidance route should no longer depend on an authenticated user rate-limit bucket'
    );
    assert.match(
        shopHandlerSource,
        /const responseUsageInstructions = normalizeGuidanceText\(responseData\.usage_instructions\);[\s\S]*const responseHasUsageInstructions = responseData\.show_usage_instructions === true[\s\S]*usage_instructions: responseUsageInstructions \|\| null,[\s\S]*show_usage_instructions: responseHasUsageInstructions/s,
        'purchase responses should normalize direct RPC usage instructions without blocking on a post-purchase guidance refetch'
    );
    assert.doesNotMatch(
        shopHandlerSource,
        /const guidancePromise = loadProductGuidance\(requestAdminSupabase \|\| adminSupabase \|\| supabase, \{/,
        'purchase responses should not refetch product guidance before returning success'
    );
    assert.match(
        shopClientSource,
        /this\.showSuccessModal\(finalContent, null, usageInstructions, successItems\);[\s\S]*this\.purchaseProcessing = false;[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*trackShopAnalyticsEvent\('product_purchase_success'/s,
        'confirmPurchase should show the success UI before running purchase analytics and product refresh follow-ups'
    );
    assert.match(
        shopHandlerSource,
        /resolveLocalizedGuidanceText\(product = \{\}, baseField = '', guidanceSite = 'cn'\)/,
        'shared shop handlers should resolve purchase guidance from bilingual fields by site'
    );
    assert.match(
        shopHandlerSource,
        /guidance:\s*\{\s*purchase_notes: purchaseNotes \|\| null,\s*has_purchase_notes: purchaseNotes\.length > 0,\s*usage_instructions: usageInstructions \|\| null,\s*has_usage_instructions: usageInstructions\.length > 0\s*\}/s,
        'order detail responses should carry guidance metadata so wallet order details can show purchase notes and usage instructions'
    );
    assert.match(
        shopGuidanceApiSource,
        /\}\)\['product-guidance'\];/,
        'standalone product-guidance API route should delegate to the shared shop handlers'
    );
    assert.match(
        walletModalSource,
        /detail\?\.guidance\?\.usage_instructions/,
        'wallet order detail modal should read usage instructions from the server-side order detail payload'
    );
    assert.match(
        walletModalSource,
        /detail\?\.guidance\?\.purchase_notes/,
        'wallet order detail modal should read purchase notes from the server-side order detail payload'
    );
    assert.match(
        walletModalSource,
        /renderStoredWalletOrderRichText\(item\.content\)/,
        'wallet order detail modal should render folded guidance content with rich-text fallback support'
    );
    assert.match(
        shopHtmlSource,
        /css\/shop-page\.css\?v=20260520_SHOP_CARD_PROMPT_BREATHE_3&shopProductSkus=20260523_SHOP_PRODUCT_SKUS_1/,
        'shop.html should bust the shop stylesheet cache after updating purchase guidance light-theme color visibility'
    );
    assert.equal(
        shopHtmlSource.includes('shopRobotMobileDock=20260608_SHOP_ROBOT_MOBILE_DOCK_1'),
        true,
        'shop.html should bust the shop stylesheet cache after aligning the mobile customer-service robot dock'
    );
    assert.equal(
        shopHtmlSource.includes('shopFloatingMobileDock=20260608_SHOP_FLOATING_MOBILE_DOCK_1'),
        true,
        'shop.html should bust shop floating CSS and JS after removing the mobile browser-chrome lift'
    );
    assert.match(
        shopHtmlSource,
        /<meta name="viewport" content="width=device-width, initial-scale=1\.0, interactive-widget=resizes-visual">[\s\S]*<meta name="theme-color" content="#eef2f7">[\s\S]*<meta name="site-theme-chrome-color" content="#eef2f7" data-light="#eef2f7" data-dark="#000000">[\s\S]*js\/theme-preload\.js\?v=20260503_MODAL_CHROME_CLOSE_1/,
        'shop.html should initialize iOS Safari chrome with the softer storefront chrome color before first paint'
    );
    assert.doesNotMatch(
        shopHtmlSource,
        /viewport-fit=cover/,
        'shop.html should not opt the storefront into the iOS 26 transparent browser chrome unsafe viewport'
    );
    assert.match(
        shopCssSource,
        /--bg-color: #eef2f7;[\s\S]*--shop-light-page-bg: #eef2f7;[\s\S]*html,\s+body \{\s+background-color: var\(--site-theme-chrome-color, var\(--bg-color\)\) !important;[\s\S]*html:not\(\[data-theme="dark"\]\),\s+html:not\(\[data-theme="dark"\]\) body\.shop-page \{\s+background-color: var\(--site-theme-chrome-color, var\(--shop-light-page-bg, #eef2f7\)\) !important;[\s\S]*background: var\(--site-theme-chrome-color, var\(--shop-light-page-bg, #eef2f7\)\);/s,
        'shop light root background should match the Safari chrome target instead of leaving the overscroll layer pure white'
    );
    assert.match(
        shopCssSource,
        /@supports \(-webkit-touch-callout: none\) \{[\s\S]*html:not\(\[data-theme="dark"\]\) body\.shop-page \.framer-nav \{[\s\S]*background-color: rgba\(255, 255, 255, 0\.76\) !important;[\s\S]*backdrop-filter: var\(--glass-blur, blur\(10px\)\) !important;[\s\S]*html:not\(\[data-theme="dark"\]\) body\.shop-page \.framer-nav\.scrolled \{[\s\S]*background-color: rgba\(255, 255, 255, 0\.9\) !important;[\s\S]*backdrop-filter: blur\(20px\) !important;[\s\S]*html:not\(\[data-theme="dark"\]\) body\.shop-page \.framer-nav:has\(\.nav-hamburger\.active\) \{[\s\S]*background-color: rgba\(255, 255, 255, 0\.92\) !important;[\s\S]*backdrop-filter: blur\(20px\) !important;/s,
        'shop iOS light navigation should keep a translucent frosted-glass surface'
    );
    assert.match(
        shopCssSource,
        /html:not\(\[data-theme="dark"\]\) body\.shop-page #shopPurchaseModal,[\s\S]*?#shopCartCheckoutModal \{\s+background: transparent;\s+backdrop-filter: none;\s+-webkit-backdrop-filter: none;\s+\}[\s\S]*?#shopPurchaseModal\.active/s,
        'light shop modals should keep a transparent non-active overlay base so closing never falls back to the global dark modal backdrop'
    );
    assert.match(
        shopHtmlSource,
        /js\/shop-client\.js\?v=20260520_SHOP_CARD_PROMPT_BREATHE_3/,
        'shop.html should load the purchase-guidance rich-text runtime'
    );
    assert.match(
        shopHtmlSource,
        /guidanceThemeText=20260607_SHOP_GUIDANCE_THEME_TEXT_1/,
        'shop.html should cache-bust storefront guidance theme text assets'
    );
    assert.match(
        shopClientSource,
        /const allowedColorValue = \/\^\(#[\s\S]*rgba\?[\s\S]*const sanitizeColor = \(colorText = ''\) => \{[\s\S]*lowContrastYellowPattern[\s\S]*allowedColorValue\.test\(normalized\) \? normalized : '';/,
        'storefront rich-text sanitizer should allow only safe stored admin color values'
    );
    assert.match(
        shopClientSource,
        /const styledTags = new Set\(\['A', 'B', 'STRONG', 'I', 'EM', 'U', 'DIV', 'P', 'SPAN', 'FONT', 'UL', 'OL', 'LI'\]\);[\s\S]*if \(prop === 'text-align' && allowedTextAlign\.test\(value\)\)[\s\S]*if \(prop === 'font-size' && allowedFontSize\.test\(value\)\)[\s\S]*if \(prop === 'color'\) \{[\s\S]*safeRules\.push\(`color: \$\{safeColor\}`\);/s,
        'storefront rich-text sanitizer should preserve safe structure, alignment, sizing, and admin text color'
    );
    assert.match(
        shopClientSource,
        /if \(child\.tagName === 'FONT'\) \{[\s\S]*const safeFontColor = sanitizeColor\(attrs\.color \|\| ''\);[\s\S]*child\.setAttribute\('style', \[currentStyle, `color: \$\{safeFontColor\}`\]\.filter\(Boolean\)\.join\('; '\)\);/s,
        'storefront rich-text sanitizer should also preserve legacy font color attributes as safe inline color'
    );
    assert.match(
        shopCssSource,
        /html:not\(\[data-theme="dark"\]\) body\.shop-page \.shop-cart-item__panel--notice,[\s\S]*html:not\(\[data-theme="dark"\]\) body\.shop-page \.shop-cart-item__panel--usage \{\s*background: #ffffff;\s*border-color: var\(--shop-light-border\);\s*color: #334155;\s*-webkit-text-fill-color: currentColor;\s*\}/,
        'light-theme cart guidance content panels should use the default white surface instead of notice or usage tinting'
    );
    assert.match(
        shopCssSource,
        /html:not\(\[data-theme="dark"\]\) body\.shop-page \.shop-cart-item__panel--notice :not\(a\),[\s\S]*\.shop-cart-item__panel--usage :not\(a\) \{\s*-webkit-text-fill-color: currentColor;\s*\}/,
        'light-theme cart guidance content should let sanitized admin colors control the rendered text color'
    );
    const lightCartGuidancePanelRule = shopCssSource.match(
        /html:not\(\[data-theme="dark"\]\) body\.shop-page \.shop-cart-item__panel--notice,[\s\S]*?html:not\(\[data-theme="dark"\]\) body\.shop-page \.shop-cart-item__panel--usage \{(?<body>[\s\S]*?)\n\}/
    )?.groups?.body || '';
    assert.doesNotMatch(
        lightCartGuidancePanelRule,
        /#fffbeb|#ecfdf5|#78350f|#064e3b|!important/,
        'light-theme cart guidance panels should not keep the old yellow/green surfaces or forced text colors'
    );
    assert.match(
        shopCssSource,
        /html:not\(\[data-theme="dark"\]\) body\.shop-page #shopPurchaseModal #purchaseNotesContent,[\s\S]*#purchaseUsageContent :not\(a\) \{[\s\S]*color: rgba\(23, 32, 51, 0\.74\) !important;[\s\S]*-webkit-text-fill-color: rgba\(23, 32, 51, 0\.74\) !important;/s,
        'light-theme purchase guidance should keep its dedicated readable theme copy color'
    );
    assert.match(
        shopCssSource,
        /html\[data-theme="dark"\] body\.shop-page #shopPurchaseModal #purchaseNotesContent,[\s\S]*#purchaseUsageContent :not\(a\) \{[\s\S]*color: rgba\(226, 232, 240, 0\.82\) !important;[\s\S]*-webkit-text-fill-color: rgba\(226, 232, 240, 0\.82\) !important;/s,
        'dark-theme purchase guidance should keep its dedicated readable theme copy color'
    );
    assert.match(
        shopCssSource,
        /html\[data-theme="dark"\] body\.shop-page \.shop-cart-item__panel--notice :not\(a\),[\s\S]*\.shop-cart-item__panel--usage :not\(a\) \{[\s\S]*-webkit-text-fill-color: currentColor !important;[\s\S]*html\[data-theme="dark"\] body\.shop-page \.shop-cart-item__panel--notice a,[\s\S]*color: #93c5fd !important;/s,
        'dark-theme cart guidance panels should keep copied notes readable while preserving link affordance'
    );
    assert.match(
        shopClientSource,
        /renderPurchaseSkuSelector: function \(\) \{[\s\S]*const shouldShow = skus\.length > 0;[\s\S]*container\.classList\.toggle\('is-single-sku', skus\.length === 1\);[\s\S]*window\.i18n\?\.t\('shop\.currentSpec'\)/s,
        'purchase modal should still display a compact current-spec row when a product has only one SKU'
    );
    assert.match(
        shopHtmlSource,
        /id="purchaseNotesBox"[\s\S]*id="purchaseUsageBox"[\s\S]*id="purchaseUsageToggle"[\s\S]*id="purchaseUsageContent"[\s\S]*<div class="shop-purchase-dock"/s,
        'purchase modal should expose usage instructions as a folded preview before the checkout dock'
    );
    assert.match(
        shopHtmlSource,
        /id="purchaseNotesCard" class="glass-box shop-success-usage-card" hidden>[\s\S]*id="purchaseNotesCopyBtn"[\s\S]*data-shop-guidance-copy="purchase_notes"[\s\S]*id="purchaseNotesContent"[\s\S]*id="purchaseUsageCard" class="glass-box shop-success-usage-card" hidden>[\s\S]*id="purchaseUsageCopyBtn"[\s\S]*data-shop-guidance-copy="usage_instructions"[\s\S]*id="purchaseUsageContent"/s,
        'purchase modal guidance content cards should expose custom top-right copy buttons for notes and usage instructions'
    );
    assert.equal(
        shopHtmlSource.includes('guidanceCopy=20260608_SHOP_GUIDANCE_COPY_4'),
        true,
        'shop.html should cache-bust storefront guidance copy UI assets'
    );
    assert.match(
        shopClientSource,
        /this\.renderPurchaseNotes\(\);\s+this\.renderPurchaseUsageInstructions\(\);[\s\S]*this\.setPurchaseStage\(this\.currentPurchase\.stage \|\| 'configure'\);/s,
        'latest guidance refresh should update both purchase notes and usage instructions while the modal is open'
    );
    assert.match(
        shopClientSource,
        /normalizeGuidanceCopyText: function \(content\)[\s\S]*getPurchaseGuidanceCopyText: function \(kind\)[\s\S]*copyPurchaseGuidance: async function \(kind, triggerButton = null\)/s,
        'purchase guidance copy buttons should copy normalized guidance text instead of rendered UI text'
    );
    assert.match(
        shopClientSource,
        /data-shop-success-action="copy-guidance"[\s\S]*class="shop-guidance-panel-content"/s,
        'success modal guidance panels should render a top-right copy action inside the guidance content box'
    );
    assert.match(
        shopClientSource,
        /purchaseUsageToggle[\s\S]*togglePurchaseUsageVisibility[\s\S]*renderPurchaseUsageInstructions: function \(\)/s,
        'purchase usage instructions should have their own compact disclosure control'
    );
    assert.match(
        shopClientSource,
        /togglePurchaseNotesVisibility: function \(\) \{[\s\S]*this\.currentPurchase\.purchaseNotesExpanded = nextExpanded;[\s\S]*if \(nextExpanded\) \{[\s\S]*this\.currentPurchase\.usageInstructionsExpanded = false;[\s\S]*this\.renderPurchaseNotes\(\);[\s\S]*this\.renderPurchaseUsageInstructions\(\);[\s\S]*this\.syncPurchaseGuidanceLayout\(\);/s,
        'opening purchase notes should collapse usage instructions and refresh both guidance disclosures'
    );
    assert.match(
        shopClientSource,
        /togglePurchaseUsageVisibility: function \(\) \{[\s\S]*this\.currentPurchase\.usageInstructionsExpanded = nextExpanded;[\s\S]*if \(nextExpanded\) \{[\s\S]*this\.currentPurchase\.purchaseNotesExpanded = false;[\s\S]*this\.renderPurchaseNotes\(\);[\s\S]*this\.renderPurchaseUsageInstructions\(\);[\s\S]*this\.syncPurchaseGuidanceLayout\(\);/s,
        'opening usage instructions should collapse purchase notes and refresh both guidance disclosures'
    );
    assert.match(
        shopClientSource,
        /getPurchaseGuidanceTrailingReserve: function \(expandedCard\) \{[\s\S]*const expandedStage = expandedCard\?\.closest\?\.\('\.shop-purchase-stage'\);[\s\S]*const expandedCardRect = expandedCard\?\.getBoundingClientRect\?\.\(\);[\s\S]*const rowGap = Number\.parseFloat\(panelStyle\.rowGap \|\| panelStyle\.gap \|\| '0'\) \|\| 0;[\s\S]*if \(expandedCardRect && rect\.top < expandedCardRect\.top - 1\) return total;[\s\S]*return Math\.ceil\(reserve \+ \(rowGap \* visibleTrailingCount\)\);/s,
        'purchase guidance layout should reserve room for any visible folded guidance rows after the expanded card'
    );
    assert.match(
        shopClientSource,
        /syncPurchaseGuidanceLayout: function \(\) \{[\s\S]*const dock = overlay\.querySelector\('\.shop-purchase-dock'\);[\s\S]*dockRect\.bottom[\s\S]*const trailingReserve = this\.getPurchaseGuidanceTrailingReserve\(expandedCard\);[\s\S]*const nextMaxHeight = Math\.max\(160, Math\.min\(520,[\s\S]*targetBottom - cardRect\.top - trailingReserve[\s\S]*'--shop-purchase-guidance-card-max': `\$\{nextMaxHeight\}px`,[\s\S]*'--shop-purchase-guidance-card-bottom-inset': bottomInset/s,
        'wide purchase guidance should derive its max height from the checkout dock bottom while keeping the next folded row below the card'
    );
    assert.match(
        shopClientSource,
        /getPurchaseGuidanceWheelChainTarget: function \(\) \{[\s\S]*if \(this\.isWidePurchaseModalLayout\(\)\) \{[\s\S]*return null;[\s\S]*return document\.querySelector\('#shopPurchaseModal \.shop-purchase-scroll'\);/s,
        'wide purchase guidance should stop wheel scrolling at the guidance card instead of scrolling the whole left panel'
    );
    assert.match(
        shopClientSource,
        /getPurchaseGuidanceScrollElement: function \(guidanceCard\)[\s\S]*querySelector\('#purchaseNotesContent, #purchaseUsageContent'\)[\s\S]*const notesScroll = this\.getPurchaseGuidanceScrollElement\(notesCard\);[\s\S]*bindContainedWheelIsolation\(notesScroll,[\s\S]*const usageScroll = this\.getPurchaseGuidanceScrollElement\(usageCard\);[\s\S]*bindContainedWheelIsolation\(usageScroll,/s,
        'purchase guidance wheel isolation should bind the scrollable rich-text body so copy buttons stay fixed in the content card'
    );
    assert.match(
        shopCssSource,
        /#shopPurchaseModal \.shop-success-usage-card\s*\{[\s\S]*max-height:\s*var\(--shop-purchase-guidance-card-max, min\(32vh, 220px\)\);[\s\S]*overflow:\s*hidden;[\s\S]*#shopPurchaseModal #purchaseNotesContent,[\s\S]*#shopPurchaseModal #purchaseUsageContent\s*\{[\s\S]*max-height:\s*calc\(var\(--shop-purchase-guidance-card-max, min\(32vh, 220px\)\) - 30px\);[\s\S]*overflow-y:\s*auto;[\s\S]*padding-bottom:\s*var\(--shop-purchase-guidance-card-bottom-inset, 30px\) !important;[\s\S]*scroll-padding-bottom:\s*var\(--shop-purchase-guidance-card-bottom-inset, 30px\);/s,
        'purchase guidance cards should keep the copy action fixed while the rich-text body uses dynamic scrolling and bottom padding'
    );
    assert.match(
        shopCssSource,
        /@media \(min-width: 901px\) \{[\s\S]*#shopPurchaseModal\s*\{[\s\S]*--shop-purchase-guidance-card-max:\s*min\(48vh, 360px\);[\s\S]*--shop-purchase-guidance-card-bottom-inset:\s*30px;/s,
        'wide purchase modal should define guidance sizing variables before JS refines them'
    );
    assert.match(
        shopCssSource,
        /@media \(min-width: 901px\) \{[\s\S]*#shopPurchaseModal \.shop-purchase-dock\s*\{[\s\S]*align-self:\s*start;[\s\S]*min-height:\s*0;[\s\S]*height:\s*fit-content;[\s\S]*display:\s*flex;/s,
        'wide checkout dock should keep its intrinsic height so guidance expansion does not resize the modal shell'
    );
    assert.match(
        shopCssSource,
        /@media \(min-width: 901px\) \{[\s\S]*#shopPurchaseModal \.shop-purchase-scroll\s*\{[\s\S]*padding:\s*6px 2px 0 0;[\s\S]*border:\s*0;/s,
        'wide purchase guidance scroll column should not add bottom padding that changes the modal height when expanded'
    );
    assert.match(
        shopCssSource,
        /@media \(min-width: 901px\) \{[\s\S]*#shopPurchaseModal\.has-purchase-notes\.has-purchase-usage #purchaseNotesBox,[\s\S]*#shopPurchaseModal\.has-purchase-notes\.has-purchase-usage #purchaseUsageBox\s*\{[\s\S]*display:\s*contents;[\s\S]*#shopPurchaseModal\.has-purchase-notes\.has-purchase-usage #purchaseNotesBox > \.shop-inline-style-attr-22,[\s\S]*#shopPurchaseModal\.has-purchase-notes\.has-purchase-usage #purchaseUsageBox > \.shop-inline-style-attr-22\s*\{[\s\S]*width:\s*100%;[\s\S]*min-height:\s*40px;[\s\S]*margin-bottom:\s*0;[\s\S]*#shopPurchaseModal\.has-purchase-notes\.has-purchase-usage #purchaseNotesBox > \.shop-inline-style-attr-22\s*\{[\s\S]*order:\s*10;[\s\S]*#shopPurchaseModal\.has-purchase-notes\.has-purchase-usage #purchaseUsageBox > \.shop-inline-style-attr-22\s*\{[\s\S]*order:\s*20;[\s\S]*#shopPurchaseModal\.has-purchase-notes\.has-purchase-usage #purchaseNotesCard\.shop-success-usage-card,[\s\S]*#shopPurchaseModal\.has-purchase-notes\.has-purchase-usage #purchaseUsageCard\.shop-success-usage-card\s*\{[\s\S]*order:\s*30;[\s\S]*width:\s*100%;/s,
        'wide purchase modal should keep both guidance switch rows fixed above the expanded guidance card'
    );
    assert.match(
        shopCssSource,
        /#shopPurchaseModal #purchaseNotesBox:not\(\.is-expanded\) > \.shop-inline-style-attr-22,[\s\S]*#shopPurchaseModal #purchaseUsageBox:not\(\.is-expanded\) > \.shop-inline-style-attr-22\s*\{[\s\S]*min-height:\s*40px;[\s\S]*margin-bottom:\s*0;/s,
        'folded purchase guidance title rows should use the same row height and spacing regardless of which switch is active'
    );
    assert.equal(
        shopHtmlSource.includes('purchaseGuidanceMutexAlign=20260605_SHOP_PURCHASE_GUIDANCE_MUTEX_ALIGN_7'),
        true,
        'shop.html should cache-bust the mutual guidance accordion and alignment fix'
    );
    assert.match(
        shopCssSource,
        /#purchaseNotesContent,\s+#purchaseNotesContent \*,\s+#purchaseUsageContent,\s+#purchaseUsageContent \*[\s\S]*html:not\(\[data-theme="dark"\]\) body\.shop-page #shopPurchaseModal #purchaseUsageContent/s,
        'purchase usage instructions should share selectable rich-text and light-theme readability rules'
    );
    [
        '.shop-guidance-copy-btn',
        '.shop-guidance-panel-copy',
        '.shop-guidance-panel-content'
    ].forEach((marker) => {
        assert.equal(
            shopCssSource.includes(marker),
            true,
            `storefront guidance copy buttons should have custom non-native icon button style marker ${marker}`
        );
    });
    assert.match(
        shopCssSource,
        /\.shop-success-item__notes-panel,[\s\S]*\.shop-success-item__usage-panel\s*\{[\s\S]*max-height:\s*min\(34vh, 260px\);[\s\S]*overflow:\s*hidden;[\s\S]*\.shop-guidance-panel-content\s*\{[\s\S]*max-height:\s*calc\(min\(34vh, 260px\) - 18px\);[\s\S]*overflow-y:\s*auto;/s,
        'success modal guidance panels should keep copy buttons fixed while the inner rich-text body scrolls'
    );
    assert.equal(zhLang.shop.currentSpec, '规格');
    assert.equal(enLang.shop.currentSpec, 'Option');
    assert.match(
        shopHtmlSource,
        /id="shopCartAnchor"[\s\S]*id="shopCartAnchorBadge"[\s\S]*id="shopCartDrawer"[\s\S]*id="shopCartCheckoutModal"/,
        'shop.html should render the floating cart anchor count badge, drawer, and checkout review modal'
    );
    assert.equal(
        shopHtmlSource.includes('cartDrawerNarrowWidth=20260524_SHOP_CART_DRAWER_NARROW_WIDTH_1'),
        true,
        'shop.html should bust storefront styles after aligning the narrow cart drawer width with the purchase modal'
    );
    assert.doesNotMatch(
        shopHtmlSource + shopCssSource + shopClientSource,
        /shopCartChromeGuard|shop-cart-chrome-guard|shopCartChromeBacking|shop-cart-chrome-backing|shopCartAnchorVisible|syncCartChromeBacking|cartThemeChrome|shop-cart-chrome-lock|shop-cart-theme-chrome-color|requestCartThemeChromeRepaint|lockCartThemeChrome|data-shop-cart-theme-lock/,
        'floating cart should not keep deprecated Safari chrome backing or theme-color repaint code'
    );
    assert.doesNotMatch(
        shopClientSource,
        /syntheticThemeChromeMenuTap|site-theme-synthetic-menu-tap/,
        'shop cart chrome refresh should use the official theme-color meta update path instead of synthetic mobile-menu taps'
    );
    assert.match(
        shopCssSource,
        /--shop-mobile-floating-glass-bg: rgba\(0, 0, 0, 0\.48\);[\s\S]*--shop-mobile-floating-glass-border: rgba\(255, 255, 255, 0\.055\);[\s\S]*inset 0 0\.5px 0 rgba\(255, 255, 255, 0\.025\);[\s\S]*--shop-mobile-floating-glass-bg: rgba\(255, 255, 255, 0\.76\);[\s\S]*--shop-mobile-floating-glass-border: rgba\(15, 23, 42, 0\.065\);[\s\S]*inset 0 0\.5px 0 rgba\(255, 255, 255, 0\.34\);/s,
        'mobile floating button bases should keep a thin glass outline without heavy top strokes'
    );
    assert.match(
        shopCssSource,
        /body\.shop-page \.shop-cart-anchor,[\s\S]*body\.shop-page \.chat-widget-fab,[\s\S]*body\.shop-page \.chat-widget-fab:focus-visible \{[\s\S]*width: 56px !important;[\s\S]*height: 56px !important;[\s\S]*background: var\(--shop-mobile-floating-glass-bg\) !important;[\s\S]*backdrop-filter: var\(--shop-mobile-floating-glass-filter\) !important;/s,
        'mobile cart and customer-service entries should use matching square frosted glass containers'
    );
    assert.match(
        shopCssSource,
        /@media \(max-width: 1180px\) \{[\s\S]*body\.shop-page \.chat-widget-fab \{[\s\S]*top: auto !important;[\s\S]*bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 40px\) !important;[\s\S]*body\.shop-page \.shop-cart-anchor \{[\s\S]*bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 108px\);[\s\S]*body\.shop-page \.shop-cart-anchor__copy,[\s\S]*body\.shop-page \.shop-cart-anchor__hint \{[\s\S]*display: none !important;/s,
        'narrow desktop shop windows should use the same stacked floating icon placement as mobile'
    );
    const narrowDesktopChatStackPattern = /@media \(max-width: 1180px\) and \(hover: hover\) and \(pointer: fine\) \{[\s\S]*body\.shop-page \.chat-widget-fab \{[\s\S]*top: auto !important;[\s\S]*right: 16px !important;[\s\S]*bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 40px\) !important;[\s\S]*transform: none !important;[\s\S]*body\.shop-page \.chat-widget-fab\.chat-widget-fab--peek \.chat-widget-fab__robot,[\s\S]*width: 56px !important;[\s\S]*transform: none !important;/s;
    assert.match(
        chatWidgetCssSource,
        narrowDesktopChatStackPattern,
        'full chat widget CSS should not restore the desktop side-peek robot on narrow shop windows'
    );
    assert.match(
        chatWidgetLoaderSource,
        narrowDesktopChatStackPattern,
        'chat widget critical loader CSS should keep the shop robot in the lower mobile slot before full styles load'
    );
    assert.match(
        shopCssSource,
        narrowDesktopChatStackPattern,
        'shop stylesheet should keep its final narrow-desktop robot override aligned with the mobile stack'
    );
    assert.doesNotMatch(
        `${shopCssSource}\n${chatWidgetCssSource}\n${chatWidgetLoaderSource}`,
        /@media \(max-width: 1180px\) and \(hover: hover\) and \(pointer: fine\) \{[\s\S]*body\.shop-page \.chat-widget-fab \{[\s\S]*top: 85% !important;[\s\S]*right: 0 !important;[\s\S]*bottom: auto !important;/s,
        'narrow shop desktop should not use the old edge-peeking robot placement'
    );
    assert.match(
        shopCssSource,
        /@media \(max-width: 720px\) \{[\s\S]*body\.shop-page \.chat-widget-fab \{\s+bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 40px\);[\s\S]*\.shop-cart-anchor \{[\s\S]*bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 108px\);/s,
        'mobile customer-service robot should sit in the lower floating slot, with the cart icon above it'
    );
    assert.match(
        shopCssSource,
        /body\.shop-page \.chat-widget-fab\.chat-widget-fab--peek \.chat-widget-fab__robot,[\s\S]*body\.shop-page \.chat-widget-fab\.chat-widget-fab--peek\.chat-widget-fab--ambient-retracted \.chat-widget-fab__robot \{[\s\S]*top: 5px !important;[\s\S]*width: 56px !important;[\s\S]*transform: none !important;/s,
        'mobile customer-service robot should sit inside the square container instead of peeking from the edge'
    );
    assert.match(
        shopCssSource,
        /body\.shop-page \.chat-widget-fab:has\(\.message-preview\.engagement-preview\),[\s\S]*body\.shop-page \.chat-widget-fab:has\(\.message-preview\.engagement-preview\):active,[\s\S]*\{[\s\S]*background: transparent !important;[\s\S]*backdrop-filter: none !important;[\s\S]*box-shadow: none !important;/s,
        'shop robot should keep the outer floating shell transparent while an engagement rule bubble is attached'
    );
    assert.match(
        shopCssSource,
        /body\.shop-page \.chat-widget-fab:has\(\.message-preview\.engagement-preview\)\.chat-widget-fab--peek \.chat-widget-fab__robot,[\s\S]*body\.shop-page \.chat-widget-fab:has\(\.message-preview\.engagement-preview\)\.chat-widget-fab--peek:active \.chat-widget-fab__robot,[\s\S]*height: 56px !important;[\s\S]*background: var\(--shop-mobile-floating-glass-bg\) !important;[\s\S]*transform: none !important;[\s\S]*opacity: 1 !important;/s,
        'shop robot engagement rule bubble should not shrink or turn transparent while pressed'
    );
    assert.match(
        shopCssSource,
        /\.shop-cart-anchor__badge \{\s+display: none;\s+\}[\s\S]*\.shop-cart-anchor__badge \{[\s\S]*position: absolute;[\s\S]*min-width: 18px;[\s\S]*background: rgba\(217, 119, 6, 0\.94\);[\s\S]*\.shop-cart-anchor__badge\[hidden\] \{[\s\S]*display: none !important;/s,
        'mobile cart icon should show an elegant count badge'
    );
    assert.match(
        shopCssSource,
        /\.shop-cart-anchor\.is-feedback \.shop-cart-anchor__icon i \{[\s\S]*animation: shop-cart-anchor-basket-wiggle 620ms cubic-bezier\(0\.22, 1, 0\.36, 1\);/s,
        'cart add feedback should keep the shopping-bag wiggle animation'
    );
    assert.doesNotMatch(
        shopCssSource,
        /body\.shop-page \.shop-cart-anchor\.is-feedback \.shop-cart-anchor__icon(?: i)? \{[^}]*animation: none !important|body\.shop-page \.chat-widget-fab\.chat-widget-fab--peek \.mascot-wrapper \{[^}]*animation: none !important/s,
        'mobile icon overrides should not disable the cart bag wiggle or robot idle animation'
    );
    assert.match(
        shopCssSource,
        /\.shop-cart-anchor__icon i \{[\s\S]*font-size: 24px;[\s\S]*@supports \(-webkit-touch-callout: none\) \{[\s\S]*body\.shop-page \.shop-cart-anchor \{[\s\S]*bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 108px\);[\s\S]*backdrop-filter: var\(--shop-mobile-floating-glass-filter\) !important;[\s\S]*body\.shop-page \.chat-widget-fab \{[\s\S]*bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 40px\) !important;[\s\S]*html:not\(\[data-theme="dark"\]\) body\.shop-page \.shop-cart-anchor,[\s\S]*html:not\(\[data-theme="dark"\]\) body\.shop-page \.chat-widget-fab \{[\s\S]*background: var\(--shop-mobile-floating-glass-bg\) !important;[\s\S]*box-shadow: var\(--shop-mobile-floating-glass-shadow\) !important;/s,
        'iOS mobile shop floating entries should stay in the same lower stack instead of adding browser-chrome lift'
    );
    assert.doesNotMatch(
        shopCssSource,
        /shop-mobile-browser-chrome-bottom-gap/,
        'mobile shop floating entries should not keep the browser-chrome bottom-gap variable'
    );
    assert.match(
        shopCssSource,
        /body\.shop-page\[data-shop-cart-open="true"\] \.chat-widget-fab \{\s+opacity: 0 !important;\s+visibility: hidden !important;\s+pointer-events: none !important;\s+\}/s,
        'cart drawer should hide the customer-service robot entry while the cart popup is open'
    );
    assert.match(
        shopCssSource,
        /body\.shop-page\[data-shop-purchase-modal-open="true"\] \.chat-widget-fab,\s+body\.shop-page:has\(#shopPurchaseModal\.active\) \.chat-widget-fab \{\s+z-index: 9998 !important;\s+pointer-events: none !important;\s+\}/s,
        'purchase confirmation modal should keep the customer-service robot entry below the modal layer'
    );
    assert.match(
        shopClientSource,
        /setPurchaseModalLayerOpen: function \(open\) \{[\s\S]*document\.body\.dataset\.shopPurchaseModalOpen = 'true';[\s\S]*delete document\.body\.dataset\.shopPurchaseModalOpen;[\s\S]*this\.setPurchaseModalLayerOpen\(true\);\s+modal\.classList\.add\('active'\);[\s\S]*modal\.classList\.remove\('active'\);\s+void modal\.offsetHeight;\s+this\.setPurchaseModalLayerOpen\(false\);/s,
        'shop-client.js should expose a body state for keeping the robot below the purchase confirmation modal'
    );
    assert.match(
        shopCssSource,
        /body\.shop-page\.shop-cart-force-hidden \.shop-cart-backdrop \{[\s\S]*background: transparent !important;[\s\S]*backdrop-filter: none !important;[\s\S]*-webkit-backdrop-filter: none !important;[\s\S]*transition: none !important;[\s\S]*body\.shop-page\.shop-cart-force-hidden \.shop-cart-drawer \{[\s\S]*opacity: 0 !important;[\s\S]*visibility: hidden !important;[\s\S]*transform: translateX\(calc\(100% \+ 24px\)\) !important;[\s\S]*backdrop-filter: none !important;[\s\S]*@media \(max-width: 720px\) \{[\s\S]*body\.shop-page\.shop-cart-force-hidden \.shop-cart-drawer \{[\s\S]*transform: translate\(-50%, calc\(100% \+ 36px\)\) !important;/s,
        'cart close should immediately hard-hide fixed drawer and backdrop layers so Safari stops sampling them'
    );
    assert.match(
        shopCssSource,
        /@media \(max-width: 720px\) \{[\s\S]*\.shop-cart-drawer \{[\s\S]*width: min\(calc\(100% - 28px\), 620px\);[\s\S]*max-height: min\(78dvh, 760px\);/s,
        'narrow cart drawer should match the purchase modal width instead of using the older narrow 420px sheet'
    );
    assert.match(
        shopClientSource,
        /anchor\.setAttribute\('aria-label', anchorLabel\);[\s\S]*anchor\.setAttribute\('title', copy\.drawerTitle\);/,
        'icon-only floating cart should keep an accessible cart label after hiding the visible copy'
    );
    assert.match(
        shopClientSource,
        /const anchorBadge = document\.getElementById\('shopCartAnchorBadge'\);[\s\S]*anchorBadge\.textContent = hasAnchorItems \? \(summary\.itemCount > 99 \? '99\+' : String\(summary\.itemCount\)\) : '';[\s\S]*this\.setElementHidden\(anchorBadge, !hasAnchorItems\);/s,
        'floating cart badge should display the current item quantity and cap large counts cleanly'
    );
    assert.match(
        shopClientSource,
        /lockCartDrawerThemeColor: function \(\) \{[\s\S]*data-shop-cart-theme-restore[\s\S]*metaTheme\.setAttribute\('content', this\.getThemeChromeColor\(\)\);[\s\S]*clearCartDrawerThemeColor: function \(options = \{\}\) \{[\s\S]*metaTheme\.removeAttribute\('content'\);[\s\S]*const restoreDelayMs = Math\.max\(50,[\s\S]*metaTheme\.setAttribute\('content', restoreContent\);[\s\S]*metaTheme\.removeAttribute\('data-shop-cart-theme-restore'\);[\s\S]*forceHideCartDrawerDuringClose: function \(\) \{[\s\S]*document\.body\.classList\.add\('shop-cart-force-hidden'\);[\s\S]*document\.body\.classList\.remove\('shop-cart-force-hidden'\);[\s\S]*setCartOpen: function \(open\) \{[\s\S]*if \(this\.cartOpen && !wasOpen\) \{[\s\S]*this\.releaseCartDrawerForceHidden\(\);[\s\S]*this\.lockCartDrawerThemeColor\(\);[\s\S]*\} else if \(!this\.cartOpen && wasOpen\) \{[\s\S]*this\.forceHideCartDrawerDuringClose\(\);[\s\S]*this\.clearCartDrawerThemeColor\(\{ restoreDelayMs: 320 \}\);/s,
        'cart drawer should use the chat-style immediate theme-color clear and repaint when the drawer closes'
    );
    assert.doesNotMatch(
        shopClientSource,
        /syncMobileBrowserChromeInset|bindMobileBrowserChromeInset|mobileBrowserChromeInset|shop-mobile-browser-chrome-bottom-gap/,
        'shop-client.js should not dynamically lift mobile floating entries above the shared lower dock'
    );
    assert.match(
        shopClientSource,
        /当前商品可用[\s\S]*当前商品不可用/,
        'shop-client.js should separate discounts usable for the current product from owned but unusable discounts'
    );
    assert.match(
        shopClientSource,
        /const shouldWaitForLiveAvailableItems = discountAssetsLoading[\s\S]*currentlyUnavailableItems\.length > 0;[\s\S]*if \(\(\!ownedItems\.length && !claimableItems\.length\) \|\| shouldWaitForLiveAvailableItems\) \{\s+container\.innerHTML = discountAssetsLoading\s+\? `<div class="shop-discount-assets-empty">\$\{this\.trShop\('syncingCurrentCoupons', '正在同步当前商品可用卡券\.\.\.'\)\}<\/div>`[\s\S]*: `<div class="shop-discount-assets-empty">\$\{this\.trShop\('noSelectableCoupons', '当前没有可直接选择的卡券，仍可继续输入暗码。'\)\}<\/div>`;/s,
        'purchase modal should keep the localized unified loading state while only stale unavailable coupon prefills are present'
    );
    assert.match(
        shopClientSource,
        /selectPurchaseSku: function \(skuId = ''\) \{[\s\S]*this\.currentPurchase\.soldOut = !manualDelivery && this\.getShopSkuStockCount\(sku\) <= 0;[\s\S]*const cachedDiscountAssetsPayload = this\.currentPurchase\.soldOut\s+\? null\s+: this\.readDiscountAssetsCache\(this\.buildCurrentPurchaseDiscountAssetsCacheKey\(\)\);[\s\S]*this\.currentPurchase\.discountAssetsLoading = this\.currentPurchase\.soldOut !== true;[\s\S]*if \(manualDelivery \|\| this\.currentPurchase\.soldOut\) \{[\s\S]*this\.currentPurchase\.discountAssetsLoading = false;[\s\S]*void this\.refreshPurchaseDiscountAssets\(\{ silent: true, forceLoading: true, clearCurrent: true \}\);/s,
        'switching specs should reuse loaded coupon cards when available, show loading only for unknown specs, and stop coupon loading for sold-out specs'
    );
    assert.match(
        shopClientSource,
        /renderPurchaseSkuPills: function \(skus = \[\], selectedSkuId = ''\) \{[\s\S]*const soldOut = stock <= 0 && !manualDelivery;[\s\S]*const disabled = !skuId;[\s\S]*is-sold-out[\s\S]*\$\{disabled \? 'disabled aria-disabled="true"' : ''\}/s,
        'sold-out SKU pills should remain clickable and only invalid empty SKU entries should be disabled'
    );
    assert.match(
        shopClientSource,
        /renderPurchaseSkuSpecGroups: function \(groups = \[\], selectedSkuId = ''\) \{[\s\S]*const soldOut = Boolean\(skuId && !manualDelivery && stock <= 0\);[\s\S]*const disabled = !skuId;[\s\S]*is-sold-out[\s\S]*\$\{disabled \? 'disabled aria-disabled="true"' : ''\}/s,
        'sold-out grouped SKU options should remain selectable while impossible combinations stay disabled'
    );
    assert.doesNotMatch(
        shopClientSource,
        /if \(Number\(sku\.stock_count \|\| 0\) <= 0 && !manualDelivery\) return;/,
        'selecting a sold-out SKU should update the modal instead of being ignored'
    );
    assert.match(
        shopClientSource,
        /const requestProductSkuId = String\(this\.currentPurchase\.productSkuId \|\| ''\)\.trim\(\);[\s\S]*const isCurrentDiscountAssetsRequest = \(\) => \([\s\S]*String\(this\.currentPurchase\.productSkuId \|\| ''\)\.trim\(\) === requestProductSkuId[\s\S]*if \(!isCurrentDiscountAssetsRequest\(\)\) \{\s+return;\s+\}/s,
        'coupon refreshes should guard against slower responses from a previously selected spec'
    );
    assert.doesNotMatch(
        shopHtmlSource,
        /shopCartCloseBtn|shopCartDrawerBody|先继续逛商品，再统一结算。/,
        'shop drawer header should no longer render the close arrow or helper copy'
    );
    assert.doesNotMatch(
        shopHtmlSource,
        /shopCartDrawerEyebrow|shopCartSummaryNotesLabel|shopCartSummaryUsageLabel/,
        'shop drawer should no longer render the floating eyebrow or notes and usage summary rows'
    );
    assert.doesNotMatch(
        shopHtmlSource,
        /shopCartDrawerTitle|<h3[^>]*>\s*购物车\s*<\/h3>/,
        'shop drawer header should no longer render the cart title text node'
    );
    assert.match(
        shopHtmlSource,
        /<header class="shop-cart-drawer__header">\s*<div class="shop-cart-drawer__title" aria-hidden="true"><\/div>\s*<\/header>/s,
        'shop drawer header should render only the centered cart icon shell'
    );
    assert.match(
        shopClientSource,
        /openCartCheckoutModal: function \(\)[\s\S]*openPurchaseModalFromCartEntry: function \(entry\)[\s\S]*confirmCartCheckout: async function \(\)/,
        'shop-client.js should support single-item cart checkout, multi-item cart checkout review, and sequential cart redemption'
    );
    assert.match(
        shopClientSource,
        /openPurchaseModalFromCartEntry: function \(entry\) \{[\s\S]*void this\.prefetchDiscountAssetsForProduct\(\{\s+productId: entry\.productId,\s+productSkuId: entry\.productSkuId \|\| '',\s+quantity: entry\.quantity,\s+agentId: this\.currentAgentId,\s+site: window\.SiteConfig\?\.site \|\| 'cn'\s+\}\);[\s\S]*this\.openPurchaseModal\(/s,
        'cart re-entry should prefetch matching quantity coupon data before reopening the product modal'
    );
    assert.match(
        shopClientSource,
        /getPurchaseQuantityCapForProduct: function \(product, fallbackMaxQuantity = null, options = \{\}\) \{[\s\S]*selectedSku[\s\S]*stockCount[\s\S]*Math\.min\(99,\s*Math\.trunc\(stockCount\)\)/s,
        'purchase modals should derive their quantity cap from live stock when stock is available'
    );
    assert.match(
        shopHtmlSource,
        /id="purchaseAddToCartBtn"[\s\S]*id="nextPurchaseStepBtn"/,
        'shop purchase modal should render the add-to-cart button before the direct confirm button'
    );
    assert.match(
        shopClientSource,
        /if \(event\.target instanceof Element && event\.target\.closest\('#nextPurchaseStepBtn'\)\) \{\s+this\.handlePurchasePrimaryActionTap\(event\);\s+return;\s+\}/s,
        'single-item purchase should submit directly from the primary action instead of navigating into a second confirmation stage'
    );
    assert.match(
        shopClientSource,
        /addCurrentPurchaseToCart: function \(\)[\s\S]*closePurchaseModal\(\);/,
        'shop-client.js should support adding the currently configured purchase quantity into the cart from the modal'
    );
    assert.match(
        shopClientSource,
        /buildCartItemMarkup: function \(entry\)[\s\S]*data-shop-cart-action="toggle-notes"[\s\S]*data-shop-cart-action="toggle-usage"/,
        'cart guidance pills should expose dedicated toggles for notes and usage instructions'
    );
    assert.match(
        shopClientSource,
        /toggleCartItemDisclosure: function \(productId, kind\) \{[\s\S]*if \(normalizedKind === 'notes' && nextState\.notes\) \{\s+nextState\.usage = false;\s+\}[\s\S]*if \(normalizedKind === 'usage' && nextState\.usage\) \{\s+nextState\.notes = false;\s+\}[\s\S]*this\.renderCart\(\);/s,
        'cart notes and usage disclosure pills should be mutually exclusive when opened'
    );
    assert.match(
        publicScrollbarSource,
        /'.shop-cart-drawer__body'[\s\S]*'.shop-cart-item__panel'[\s\S]*target\.classList\.add\(PUBLIC_SCROLLBAR_AUTO_HIDE_NO_GUTTER_CLASS\);/s,
        'cart drawer and disclosure scroll surfaces should opt into no-gutter scrollbar handling'
    );
    assert.match(
        publicScrollbarCss,
        /\.public-scrollbar-auto-hide\.public-scrollbar-auto-hide--no-gutter[\s\S]*scrollbar-width:\s*none !important;[\s\S]*scrollbar-gutter:\s*auto !important;[\s\S]*\.public-scrollbar-auto-hide\.public-scrollbar-auto-hide--no-gutter::-webkit-scrollbar[\s\S]*width:\s*0 !important;[\s\S]*height:\s*0 !important;/s,
        'cart guidance expansion should not make scrollbars consume layout width and squeeze cards left'
    );
    assert.match(
        shopClientSource,
        /buildCartItemMarkup: function \(entry\)[\s\S]*class="shop-cart-item__title shop-cart-item__title-btn"[\s\S]*data-shop-cart-action="open-product"/,
        'cart item titles should render as clickable triggers that reopen the purchase modal for that product'
    );
    assert.match(
        shopClientSource,
        /if \(action === 'checkout'\) \{\s+void this\.confirmCartCheckout\(\);\s+return;\s+\}\s+if \(action === 'open-product'\)/s,
        'cart drawer checkout button should trigger direct cart redemption and cart titles should open the product purchase modal'
    );
    assert.match(
        shopClientSource,
        /guardCartBackdropClose: function \(durationMs = 240\)[\s\S]*shouldIgnoreCartBackdropClose: function \(\)/,
        'shop-client.js should guard against backdrop close events firing immediately after cart drawer interactions'
    );
    assert.match(
        shopClientSource,
        /shopCartBackdrop'\)\?\.addEventListener\('click', \(event\) => \{\s+event\.preventDefault\?\.\(\);\s+if \(this\.shouldIgnoreCartBackdropClose\(\)\) \{\s+return;\s+\}\s+this\.closeCart\(\);/s,
        'cart backdrop clicks should ignore taps that just originated from within the cart drawer'
    );
    assert.match(
        shopClientSource,
        /const refreshProductsPromise = this\.loadProducts\(\{ forceRefresh: true \}\)\.catch\([\s\S]*this\.showSuccessModal\(successPayload\.content, warningMessage, successPayload\.usageInstructions, successPayload\.items\);[\s\S]*await refreshProductsPromise;/s,
        'successful cart checkout should show the success modal before waiting on the background product refresh to finish'
    );
    assert.match(
        shopClientSource,
        /const purchasedProduct = this\.getCachedProductById\(this\.currentPurchase\?\.productId\);[\s\S]*const purchasedProductSnapshot = purchasedProduct[\s\S]*this\.buildCartProductSnapshot\(purchasedProduct,[\s\S]*product: purchasedProductSnapshot \|\| purchasedProduct/s,
        'single-item purchase success should capture the product snapshot before force refresh clears thumbnail data from caches'
    );
    assert.match(
        shopClientSource,
        /const providedProduct = product && typeof product === 'object' && !Array\.isArray\(product\)[\s\S]*const cachedProduct = this\.getCachedProductById\(normalizedProductId\);[\s\S]*icon_url: providedProduct\.icon_url \|\| cachedProduct\?\.icon_url \|\| ''/s,
        'success modal item payloads should merge cached thumbnail data into partial product objects'
    );
    assert.match(
        shopClientSource,
        /confirmCartCheckout: async function \(\) \{[\s\S]*this\.cartCheckoutProcessing = true;[\s\S]*this\.renderCartCheckoutModal\(\);[\s\S]*this\.renderCart\(\);[\s\S]*const token = await this\.getAccessToken\(\);[\s\S]*if \(!token\) \{[\s\S]*this\.cartCheckoutProcessing = false;[\s\S]*this\.renderCartCheckoutModal\(\);[\s\S]*this\.renderCart\(\);[\s\S]*this\.promptLoginForPurchase/s,
        'cart checkout should enter a guarded processing state before waiting for the auth token so backdrop closes cannot win the race'
    );
    assert.match(
        shopClientSource,
        /anchor\.hidden = shouldDisableAnchor;[\s\S]*anchor\.disabled = shouldDisableAnchor;[\s\S]*anchor\.style\.pointerEvents = shouldDisableAnchor \? 'none' : '';/s,
        'cart anchor should be fully disabled and non-interactive while the cart drawer is open'
    );
    assert.match(
        shopClientSource,
        /setCartOpen: function \(open\) \{[\s\S]*const wasOpen = this\.cartOpen === true;[\s\S]*const drawerBody = drawer\?\.querySelector\('\.shop-cart-drawer__body'\);[\s\S]*if \(this\.cartOpen && !wasOpen\) \{[\s\S]*drawerBody\.scrollTop = 0;[\s\S]*window\.requestAnimationFrame\(\(\) => \{[\s\S]*drawerBody\.scrollTop = 0;[\s\S]*drawer\.scrollTop = 0;/s,
        'opening the cart drawer should reset the drawer scroll position so the first cart card does not reopen half-clipped under the header'
    );
    assert.match(
        shopClientSource,
        /lockCartDrawerScroll: function \(drawer\) \{[\s\S]*window\.iOSScrollLock\.lockLight\(drawer, \{[\s\S]*restoreScrollDuringViewport: true[\s\S]*cartDrawerOwnsScrollLock = true[\s\S]*unlockCartDrawerScroll: function \(\) \{[\s\S]*window\.iOSScrollLock\.unlock\(\);/s,
        'opening the cart drawer should lock background scrolling with the shared mobile scroll lock and release it on close'
    );
    assert.match(
        shopClientSource,
        /setCartOpen: function \(open\) \{[\s\S]*if \(this\.cartOpen && !wasOpen\) \{[\s\S]*drawer\?\.classList\.add\('active'\);[\s\S]*this\.lockCartDrawerScroll\(drawer\);[\s\S]*\} else if \(!this\.cartOpen && wasOpen\) \{[\s\S]*this\.unlockCartDrawerScroll\(\);[\s\S]*drawer\.classList\.toggle\('active', this\.cartOpen\);/s,
        'cart drawer open state should own a restorable active scroll-lock target'
    );
    assert.match(
        shopClientSource,
        /buildProductCardElement: function \(product, agentPrices = \{}, index = 0\)[\s\S]*el\.dataset\.shopAction = 'buy-product';[\s\S]*class="shop-card-cart-trigger[\s\S]*data-shop-action="add-product-to-cart"/,
        'product cards should open purchase from the card body and use a dedicated cart icon trigger'
    );
    assert.match(
        shopClientSource,
        /el\.dataset\.shopAction = 'sold-out-product';[\s\S]*this\.applyShopPurchaseDataset\(el, purchaseDataset\);/s,
        'sold-out product cards should remain clickable and keep the purchase dataset for the detail modal'
    );
    assert.match(
        shopClientSource,
        /if \(action === 'sold-out-product'\) \{[\s\S]*this\.openProductPurchaseFromDataset\(target\.dataset, sourceContext\);/s,
        'sold-out product card clicks should route through the shared sold-out purchase guard'
    );
    assert.match(
        shopClientSource,
        /showSoldOutProductToast: function \(payload = \{\}\) \{[\s\S]*this\.trShop\('soldOutClickHint', '已售罄'\),\s+'sold-out'[\s\S]*if \(action === 'add-product-to-cart'\) \{[\s\S]*const payload = this\.getShopPurchasePayloadFromDataset\(target\.dataset\);[\s\S]*this\.isShopPurchasePayloadSoldOut\(payload\)[\s\S]*this\.showSoldOutProductToast\(payload\);/s,
        'sold-out cart icon clicks should show the same sold-out toast without adding the product to the cart'
    );
    assert.match(
        shopClientSource,
        /isShopPurchasePayloadManualDelivery: function \(payload = \{\}\)[\s\S]*showManualDeliveryProductToast: function \(payload = \{\}\)[\s\S]*if \(action === 'add-product-to-cart'\) \{[\s\S]*this\.isShopPurchasePayloadManualDelivery\(payload\)[\s\S]*this\.showManualDeliveryProductToast\(payload\);/s,
        'manual delivery products should keep the detail card clickable while blocking cart icon adds'
    );
    assert.match(
        shopClientSource,
        /const stockLabel = manualDelivery[\s\S]*人工发货[\s\S]*const cartDisabled = manualDelivery \|\| noStock[\s\S]*el\.classList\.toggle\('shop-card--manual-delivery', manualDelivery\)[\s\S]*el\.dataset\.shopAction = 'buy-product';/s,
        'manual delivery cards should show their own badge and remain detail-view cards instead of sold-out cards'
    );
    assert.match(
        shopClientSource,
        /setPurchaseStage: function \(stage = 'configure'\)[\s\S]*const isManualDelivery = this\.isShopCurrentPurchaseManualDelivery\(\);[\s\S]*const isSoldOut = this\.isShopCurrentPurchaseSoldOut\(\);[\s\S]*getSoldOutRestockSupportLabel\(\)[\s\S]*shop-sold-out-restock-btn[\s\S]*shop-purchase-sold-out-btn[\s\S]*nextBtn\.disabled = isPurchaseProcessing \|\| isManualDelivery \|\| isSoldOut;/s,
        'purchase modal should turn manual delivery or sold-out secondary actions into support while keeping redemption disabled'
    );
    assert.match(
        shopClientSource,
        /nextBtn\.classList\.toggle\('shop-btn-primary', !isSoldOut\);\s+nextBtn\.classList\.toggle\('shop-purchase-sold-out-btn', isSoldOut\);/,
        'sold-out purchase primary button should leave the green primary button class while keeping its sold-out class'
    );
    assert.match(
        shopClientSource,
        /openManualDeliverySupport: function \(options = \{\}\)[\s\S]*this\.closePurchaseModal\(\);[\s\S]*window\.chatWidget\?\.chatWindow && typeof window\.chatWidget\.openChat === 'function'[\s\S]*window\.chatWidget\.openChat\(\)[\s\S]*return;[\s\S]*ZaoyoeChatWidgetBootstrap\?\.open[\s\S]*zaoyoe:chat-widget-runtime-pending-open/s,
        'manual delivery support action should close the product modal and directly open the ready public chat widget before falling back to bootstrap loading'
    );
    assert.match(
        shopClientSource,
        /purchaseAddToCartBtn'\), 'purchase-add-cart'[\s\S]*this\.isShopCurrentPurchaseManualDelivery\(\)[\s\S]*this\.openManualDeliverySupport\(\{ source: 'purchase_modal_mobile_tap' \}\)[\s\S]*if \(event\.target instanceof Element && event\.target\.closest\('#purchaseAddToCartBtn'\)\)[\s\S]*this\.openManualDeliverySupport\(\{ source: 'purchase_modal_button' \}\)/s,
        'manual delivery secondary action should open support from both touch fallback and modal click paths'
    );
    assert.match(
        shopClientSource,
        /purchaseAddToCartBtn'\), 'purchase-add-cart'[\s\S]*this\.isShopCurrentPurchaseSoldOut\(\)[\s\S]*this\.openSoldOutRestockSupport\(\{ source: 'purchase_modal_mobile_tap' \}\)[\s\S]*if \(event\.target instanceof Element && event\.target\.closest\('#purchaseAddToCartBtn'\)\)[\s\S]*this\.openSoldOutRestockSupport\(\{ source: 'purchase_modal_button' \}\)/s,
        'sold-out secondary action should open restock support from both touch fallback and modal click paths'
    );
    assert.equal(
        zhLang.shop.manualDeliveryContactSupport,
        '联系我/客服咨询',
        'manual delivery support label should match the requested Chinese storefront copy'
    );
    assert.equal(
        enLang.shop.manualDeliveryContactSupport,
        'Contact support',
        'manual delivery support label should have an English storefront copy'
    );
    assert.equal(
        zhLang.shop.soldOutRestockContactSupport,
        '联系客服补货',
        'sold-out restock support label should match the requested Chinese storefront copy'
    );
    assert.equal(
        enLang.shop.soldOutRestockContactSupport,
        'Contact support for restock',
        'sold-out restock support label should have an English storefront copy'
    );
    assert.equal(
        zhLang.shop.soldOutDiscountUnavailable,
        '商品售罄后暂不可使用优惠码，请联系客服补货。',
        'sold-out purchase modal should explain why coupons are disabled in Chinese'
    );
    assert.equal(
        enLang.shop.soldOutDiscountUnavailable,
        'Coupons are unavailable while this product is sold out. Contact support for restock.',
        'sold-out purchase modal should explain why coupons are disabled in English'
    );
    assert.match(
        shopClientSource,
        /setPurchaseStage: function \(stage = 'configure'\)[\s\S]*const shouldShow = element\.dataset\.purchaseStep === nextStage[\s\S]*&& \(!isUsageStage \|\| hasUsageInstructions\);[\s\S]*this\.syncPurchaseDiscountInteractivity\(\);/s,
        'sold-out purchase modal should keep the discount stage mounted instead of hiding it during stage sync'
    );
    assert.doesNotMatch(
        shopClientSource,
        /isDiscountStage[\s\S]*!isSoldOut/,
        'sold-out purchase modal should not hide the coupon module just because the product is sold out'
    );
    assert.match(
        shopClientSource,
        /syncPurchaseDiscountInteractivity: function \(\)[\s\S]*classList\.toggle\('is-purchase-sold-out', isSoldOut\)[\s\S]*discountPanel instanceof HTMLDetailsElement[\s\S]*discountPanel\.open = true[\s\S]*classList\.add\('is-expanded'\)[\s\S]*purchaseDiscountCode[\s\S]*discountInput\.disabled = true[\s\S]*soldOutDiscountPlaceholder[\s\S]*applyBtn\.disabled = true[\s\S]*soldOutDisabled/s,
        'sold-out purchase modal should keep the coupon module visible and expanded while disabling coupon input and verification'
    );
    assert.match(
        shopClientSource,
        /renderPurchaseDiscountAssets: function \(\)[\s\S]*isShopCurrentPurchaseSoldOut\(\)[\s\S]*shop-discount-assets-empty--sold-out[\s\S]*soldOutDiscountUnavailable[\s\S]*this\.syncPurchaseDiscountInteractivity\(\);/s,
        'sold-out purchase modal should render a stable sold-out coupon message instead of collapsing the coupon module'
    );
    assert.match(
        shopCssSource,
        /\.shop-purchase-discount\.is-purchase-sold-out[\s\S]*\.shop-discount-assets-empty--sold-out[\s\S]*html:not\(\[data-theme="dark"\]\) body\.shop-page \.shop-purchase-discount\.is-purchase-sold-out/s,
        'sold-out coupon module should have disabled-state styling in dark and light storefront themes'
    );
    assert.match(
        shopCssSource,
        /\.shop-discount-assets-empty--sold-out\s*\{[\s\S]*box-sizing:\s*border-box;[\s\S]*padding:\s*9px 11px;[\s\S]*border:\s*1px solid rgba\(248, 113, 113, 0\.16\);/s,
        'sold-out coupon message should compensate for its border so switching to a sold-out SKU does not grow the purchase modal'
    );
    assert.equal(
        shopCssSource.includes('.shop-btn-primary:hover:not(:disabled):not([aria-disabled="true"])'),
        true,
        'primary shop button hover styling should not apply to disabled or aria-disabled buttons'
    );
    assert.match(
        shopCssSource,
        /#nextPurchaseStepBtn:hover:not\(:disabled\):not\(\[aria-disabled="true"\]\):not\(\.shop-purchase-sold-out-btn\),\s+#confirmPurchaseBtn:hover:not\(:disabled\):not\(\[aria-disabled="true"\]\)/,
        'purchase modal primary hover styling should only apply to enabled action buttons'
    );
    assert.match(
        shopCssSource,
        /#shopPurchaseModal \.shop-purchase-dock #nextPurchaseStepBtn:hover:not\(\.shop-purchase-sold-out-btn\)\s*\{[\s\S]*?background:\s*linear-gradient\(135deg,\s*#43d675 0%,\s*#20b957 100%\);/,
        'wide dock purchase button hover should exclude the sold-out button before applying the green hover background'
    );
    assert.match(
        shopCssSource,
        /#nextPurchaseStepBtn\.shop-purchase-sold-out-btn,[\s\S]*?#nextPurchaseStepBtn\.shop-purchase-sold-out-btn:disabled\s*\{[\s\S]*?background:\s*linear-gradient\(135deg, var\(--shop-sold-out-soft-red\) 0%, var\(--shop-sold-out-soft-red-deep\) 100%\);[\s\S]*?filter:\s*none;[\s\S]*?transition:\s*none;/,
        'sold-out purchase button should keep the same static treatment across hover, active, focus, and disabled states'
    );
    assert.match(
        shopCssSource,
        /html:not\(\[data-theme="dark"\]\) body\.shop-page #nextPurchaseStepBtn\.shop-purchase-sold-out-btn,[\s\S]*?html:not\(\[data-theme="dark"\]\) body\.shop-page #nextPurchaseStepBtn\.shop-purchase-sold-out-btn:disabled\s*\{[\s\S]*?background:\s*linear-gradient\(135deg, var\(--shop-sold-out-soft-red\) 0%, var\(--shop-sold-out-soft-red-deep\) 100%\);[\s\S]*?filter:\s*none;[\s\S]*?transition:\s*none;/,
        'light theme sold-out purchase button should also stay visually unchanged when hovered'
    );
    assert.match(
        shopCssSource,
        /#shopPurchaseModal \.shop-purchase-dock #nextPurchaseStepBtn\.shop-purchase-sold-out-btn:hover,[\s\S]*?body\.shop-page #shopPurchaseModal #nextPurchaseStepBtn\.shop-purchase-sold-out-btn:disabled\s*\{[\s\S]*?background:\s*linear-gradient\(135deg, var\(--shop-sold-out-soft-red\) 0%, var\(--shop-sold-out-soft-red-deep\) 100%\) !important;[\s\S]*?filter:\s*none !important;[\s\S]*?transform:\s*none !important;[\s\S]*?cursor:\s*not-allowed !important;/,
        'final sold-out purchase button override should win over later dock hover and cursor rules'
    );
    assert.match(
        shopCssSource,
        /body\.shop-page #shopPurchaseModal #nextPurchaseStepBtn\.shop-purchase-sold-out-btn \*\s*\{\s*cursor:\s*not-allowed !important;\s*\}/,
        'sold-out purchase button child text and icon should keep the disabled cursor'
    );
    assert.match(
        shopHtmlSource,
        /soldOutHoverStatic=20260609_SHOP_SOLD_OUT_HOVER_STATIC_3/,
        'shop.html should bust the shop stylesheet cache after making the sold-out hover state static'
    );
    assert.match(
        shopHtmlSource,
        /soldOutDiscountStable=20260607_SHOP_SOLD_OUT_DISCOUNT_STABLE_2/,
        'shop.html should bust storefront assets after stabilizing the sold-out coupon module'
    );
    assert.match(
        shopHtmlSource,
        /restockChatDirectOpen=20260607_SHOP_RESTOCK_CHAT_DIRECT_OPEN_1/,
        'shop.html should bust the shop runtime after making restock support open the ready chat widget directly'
    );
    assert.match(
        shopCssSource,
        /\.shop-success-toast\[data-shop-toast-global="1"\]\[data-variant="sold-out"\]\s*\{[\s\S]*border-color:\s*rgba\(239,\s*68,\s*68,\s*0\.82\);[\s\S]*color:\s*#111827;[\s\S]*\.shop-success-toast\[data-shop-toast-global="1"\]\[data-variant="sold-out"\]::before\s*\{[\s\S]*content:\s*'';[\s\S]*data:image\/svg\+xml[\s\S]*stroke-linecap='round'/s,
        'sold-out storefront toast should use black text, a red capsule border, and a custom red X icon'
    );
    assert.match(
        shopCssSource,
        /\.shop-stock-badge\.manual-delivery\s*\{[\s\S]*color:\s*#fbbf24;[\s\S]*\.shop-success-toast\[data-shop-toast-global="1"\]\[data-variant="manual-delivery"\]\s*\{/s,
        'manual delivery badge and toast should have dedicated styling'
    );
    assert.doesNotMatch(
        shopCssSource,
        /0 0 0 3px rgba\(239,\s*68,\s*68,\s*0\.(?:1|12)\)/,
        'sold-out storefront toast should not render a red glow outside the capsule border'
    );
    assert.match(
        shopClientSource,
        /buyProduct: async function \([\s\S]*const liveProduct = this\.getCachedProductById\(productId\);[\s\S]*const soldOut = !manualDelivery && \(options\?\.soldOut === true \|\| this\.isShopProductSelectionSoldOut\(liveProduct, requestedSkuId\)\);[\s\S]*const quantityCap = this\.getPurchaseQuantityCapForProduct\(liveProduct, maxPurchaseQuantity, \{\s+skuId: requestedSkuId\s+\}\);/s,
        'opening the purchase modal from a product card should honor the current product stock when computing the quantity cap'
    );
    assert.match(
        shopClientSource,
        /openPurchaseModalFromCartEntry: function \(entry\) \{[\s\S]*const purchaseQuantityCap = this\.getPurchaseQuantityCapForProduct\(entry\.product, entry\.quantityCap, \{\s+skuId: entry\.productSkuId \|\| ''\s+\}\);/s,
        'opening the purchase modal from the cart should also cap quantity by the current product stock'
    );
    assert.match(
        shopClientSource,
        /class="shop-cart-item__remove"[\s\S]*aria-label="\$\{this\.escapeAttribute\(copy\.removeLabel\)\}"[\s\S]*class="shop-cart-item__remove-icon"/,
        'cart items should render the remove action as a compact minus button with an accessible label'
    );
    assert.match(
        shopClientSource,
        /buildCartItemMarkup: function \(entry\)[\s\S]*this\.renderStoredRichText\(noteText\)/,
        'cart purchase notes should still render through the rich-text sanitizer'
    );
    assert.match(
        shopClientSource,
        /buildCartItemMarkup: function \(entry\)[\s\S]*this\.renderStoredRichText\(usageText\)/,
        'cart usage instructions should render through the rich-text sanitizer when expanded'
    );
    assert.match(
        shopClientSource,
        /buildSuccessItemMarkup: function \(item = \{\}, index = 0\)(?=[\s\S]*data-shop-success-action="toggle-item-content")(?=[\s\S]*data-shop-success-action="toggle-notes")(?=[\s\S]*data-shop-success-action="toggle-usage")(?=[\s\S]*data-shop-success-action="copy-item")(?=[\s\S]*class="shop-cart-item__panel shop-success-item__content-panel")(?=[\s\S]*class="shop-cart-item__panel shop-cart-item__panel--notice shop-success-item__notes-panel")(?=[\s\S]*class="shop-cart-item__panel shop-cart-item__panel--usage shop-success-item__usage-panel")/s,
        'success modal should render each purchased product as a clickable compact row with right-aligned notes and usage pills, inline copy, and collapsed delivery content'
    );
    assert.match(
        shopClientSource,
        /class="shop-cart-item__panel shop-success-item__content-panel"\s+aria-hidden="true"/,
        'success modal delivery content panel should stay in the DOM while collapsed so CSS can animate the expansion'
    );
    assert.match(
        shopClientSource,
        /panel\.setAttribute\('aria-hidden', nextExpanded \? 'false' : 'true'\);[\s\S]*item\.classList\.toggle\('is-content-expanded', nextExpanded\);/,
        'success modal item toggles should drive animated expansion through class state instead of toggling display immediately'
    );
    assert.match(
        shopClientSource,
        /toggleSuccessItemDisclosure: function \(toggleButton\)[\s\S]*panel\.hidden = !nextExpanded;[\s\S]*this\.syncSuccessDisclosureScroll\(panel, \{ focusToggle: toggleButton, expanded: nextExpanded \}\);[\s\S]*syncSuccessDisclosureScroll: function \(panel, \{ focusToggle = null, expanded = true \} = \{\}\)[\s\S]*modalScroll\.scrollTo\(\{ top: nextScrollTop, behavior: 'auto' \}\);/s,
        'success modal should jump opened notes or usage panels into view without a smooth-scroll animation fighting user wheel input'
    );
    assert.match(
        shopClientSource,
        /toggleSuccessItemDisclosure: function \(toggleButton\)[\s\S]*if \(nextExpanded\) \{[\s\S]*querySelectorAll\('\[data-shop-success-action="toggle-notes"\], \[data-shop-success-action="toggle-usage"\]'\)[\s\S]*toggle\.setAttribute\('aria-expanded', 'false'\);[\s\S]*toggle\.classList\.remove\('is-active'\);[\s\S]*querySelectorAll\('\.shop-success-item__notes-panel, \.shop-success-item__usage-panel'\)[\s\S]*candidate\.hidden = true;/s,
        'success modal notes and usage pills should close the other guidance panel before opening the selected one'
    );
    assert.match(
        shopCssSource,
        /#shopSuccessModal \.shop-success-item__tag--notice \{[\s\S]*background:\s*transparent;[\s\S]*#shopSuccessModal \.shop-success-item__tag--usage \{[\s\S]*background:\s*transparent;[\s\S]*\.shop-success-item__tag--notice\.is-active \{[\s\S]*background:\s*rgba\(255,\s*214,\s*102,\s*0\.14\);[\s\S]*\.shop-success-item__tag--usage\.is-active \{[\s\S]*background:\s*rgba\(34,\s*197,\s*94,\s*0\.14\);/s,
        'success modal guidance pills should be outline-only until selected'
    );
    assert.match(
        shopCssSource,
        /html:not\(\[data-theme="dark"\]\) body\.shop-page #shopSuccessModal \.shop-success-item__tag--notice \{[\s\S]*background:\s*transparent;[\s\S]*color:\s*#92400e;[\s\S]*html:not\(\[data-theme="dark"\]\) body\.shop-page #shopSuccessModal \.shop-success-item__tag--usage \{[\s\S]*background:\s*transparent;[\s\S]*color:\s*#047857;[\s\S]*\.shop-success-item__tag--notice\.is-active \{[\s\S]*background:\s*#fff7ed;[\s\S]*\.shop-success-item__tag--usage\.is-active \{[\s\S]*background:\s*#ecfdf5;/s,
        'light success modal guidance pills should match the cart outline and selected-fill treatment'
    );
    assert.doesNotMatch(
        shopClientSource,
        /bindSuccessUsageWheelIsolation|clearSuccessUsageWheelIsolation|successUsageWheelCleanup/,
        'success modal should use native main-scroll behavior without non-passive wheel interception'
    );
    assert.doesNotMatch(
        shopClientSource,
        /chainToSiblingPanels|chainSuccessDisclosureWheel|shop-success-handoff-spacer|is-scroll-handoff-ready/,
        'success modal should no longer ship nested disclosure handoff paths that can block native scrolling'
    );
    assert.match(
        shopHtmlSource,
        /successDisclosureScroll=20260524_SHOP_SUCCESS_DISCLOSURE_SCROLL_5/,
        'shop success modal should cache-bust the runtime after removing wheel interception from success disclosures'
    );
    assert.match(
        shopHtmlSource,
        /id="shopSuccessSummaryCount"[\s\S]*复制全部[\s\S]*导出全部[\s\S]*id="purchasedContent"/,
        'shop success modal should render the purchase summary header with inline copy/export-all actions and the rebuilt purchased content container'
    );
    assert.match(
        shopCssSource,
        /\.shop-cart-list\[hidden\],\s*\.shop-cart-empty\[hidden\]\s*\{\s*display:\s*none\s*!important;/,
        'cart drawer should force-hide the empty state shell whenever hidden is applied'
    );
    assert.match(
        shopCssSource,
        /\.shop-card-cart-trigger\.is-disabled\s+\.shop-card-cart-trigger__shell,\s*\.shop-card-cart-trigger:disabled\s+\.shop-card-cart-trigger__shell\s*\{[\s\S]*color:\s*rgba\(148,\s*163,\s*184,\s*0\.82\);/s,
        'sold-out product cards should tint the cart trigger icon gray instead of leaving it warm yellow'
    );
    assert.match(
        shopCssSource,
        /#shopPurchaseModal\s+\.modal-content\s*\{[\s\S]*background:\s*linear-gradient\(180deg,\s*rgba\(14,\s*20,\s*29,\s*0\.96\)\s*0%,\s*rgba\(8,\s*12,\s*18,\s*0\.98\)\s*100%\)\s*!important;[\s\S]*backdrop-filter:\s*none\s*!important;/s,
        'the purchase modal should reuse the cart drawer surface instead of the older frosted-glass background'
    );
    assert.doesNotMatch(
        shopCssSource,
        /\.shop-cart-drawer__header::before/,
        'mobile cart drawer should no longer render the short handle bar above the cart icon'
    );
    assert.doesNotMatch(
        shopCssSource,
        /body\[data-shop-cart-open="true"\]\s+\.shop-main\s*\{\s*padding-right:/,
        'cart drawer should overlay the storefront instead of pushing the product grid sideways'
    );
    assert.doesNotMatch(
        shopHtmlSource,
        /purchaseConfirmSummary|purchaseConfirmProductName|purchaseConfirmQuantity|purchaseConfirmUnitPrice|purchaseConfirmSubtotal|purchaseConfirmDiscountRow|purchaseConfirmTotal/,
        'shop.html should not render the legacy final confirmation summary for single-item checkout'
    );
    assert.doesNotMatch(
        shopHtmlSource,
        /purchaseBackBtn|confirmPurchaseBtn/,
        'shop.html should not render the legacy back/confirm buttons for the removed final confirmation stage'
    );
    assert.doesNotMatch(
        shopHtmlSource,
        /purchaseConfirmNotesBox|purchaseConfirmNotesContent|purchaseConfirmNotesTitle/,
        'shop.html should not render purchase notes in step 2'
    );
    assert.doesNotMatch(
        shopHtmlSource,
        /purchaseStepBadge|STEP 1 \/ 配置订单|STEP 2 \/ 最终确认/,
        'shop.html should not render the purchase step badge copy'
    );
    assert.doesNotMatch(
        shopHtmlSource,
        /shopPurchaseModalCloseBtn/,
        'shop.html should not render the mac-style close dot in the purchase modal'
    );
    assert.doesNotMatch(
        shopCssSource,
        /\.shop-inline-style-attr-21\s*\{[^}]*display:\s*none/s,
        'purchase notes shell should not be permanently hidden by extracted inline styles'
    );
    assert.doesNotMatch(
        shopCssSource,
        /\.shop-inline-style-attr-33\s*\{[^}]*display:\s*none/s,
        'usage instructions shell should not be permanently hidden by extracted inline styles'
    );
    assert.doesNotMatch(
        shopCssSource,
        /\.shop-inline-style-attr-37\s*\{[^}]*display:\s*none/s,
        'purchase warning shell should not be permanently hidden by extracted inline styles'
    );
    assert.match(
        shopCssSource,
        /\.shop-inline-style-attr-21\[hidden\],[\s\S]*\.shop-inline-style-attr-33\[hidden\],[\s\S]*\.shop-inline-style-attr-37\[hidden\]\s*\{\s*display:\s*none !important;/s,
        'guidance-related shells should only hide through the hidden attribute'
    );
});
