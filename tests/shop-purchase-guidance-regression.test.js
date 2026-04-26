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

    assert.match(
        shopClientSource,
        /const SHOP_PREFETCH_SCHEMA_VERSION = '20260423_PRODUCT_DESCRIPTION_VISIBILITY_1';/,
        'shop-client.js should define a dedicated schema version for prefetched shop payloads'
    );
    assert.match(
        shopClientSource,
        /void this\.prefetchDiscountAssetsForProduct\(\{\s+productId,\s+quantity: 1,\s+agentId: this\.currentAgentId,\s+site: window\.SiteConfig\?\.site \|\| 'cn'\s+\}\);\s+this\.openPurchaseModal\(productId, productName, productNameEn, price, rules, quantityCap, purchaseNotes, usageInstructions, \{\s+category: productCategory,\s+sourceContext\s+\}\);\s+void this\.refreshCurrentPurchaseGuidance\(productId\);\s+void this\.syncPurchaseAccessAfterOpen\(productId, quantityCap\);/s,
        'shop purchase clicks should prefetch discount assets, open the modal immediately, refresh the latest product guidance, and sync purchase access in the background'
    );
    assert.doesNotMatch(
        shopClientSource,
        /buyProduct: async function[\s\S]*?supabaseClient\.auth\.getSession\(\)[\s\S]*?openPurchaseModal/s,
        'shop purchase clicks should no longer block the modal behind an upfront getSession() login check'
    );
    assert.match(
        shopClientSource,
        /confirmPurchase: async function \(\) \{\s+const token = await this\.getAccessToken\(\);\s+if \(!token\) \{\s+this\.promptLoginForPurchase/s,
        'confirmPurchase should prompt login only when the user actually tries to submit the order'
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
        /const SHOP_PREFETCH_SCHEMA_VERSION = '20260423_PRODUCT_DESCRIPTION_VISIBILITY_1';/,
        'homepage shop prefetch should use the same guidance-aware schema version'
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
        /\.from\('shop_products'\)\s*\.select\('show_purchase_notes, purchase_notes, show_usage_instructions, usage_instructions'\)/s,
        'shop-client.js should keep a direct product guidance fallback for local and static preview environments'
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
        /usage_instructions: normalizeGuidanceText\(responseData\.usage_instructions\) \|\| guidanceData\?\.usage_instructions \|\| null/,
        'purchase responses should fall back to the server-side product guidance when the RPC omits usage instructions'
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
        /css\/shop-page\.css\?v=20260426_SHOP_MOBILE_ENTER_STABLE_2/,
        'shop.html should bust the shop stylesheet cache after integrating the cart drawer module'
    );
    assert.match(
        shopCssSource,
        /html:not\(\[data-theme="dark"\]\) body\.shop-page #shopPurchaseModal,[\s\S]*?#shopCartCheckoutModal \{\s+background: transparent;\s+backdrop-filter: none;\s+-webkit-backdrop-filter: none;\s+\}[\s\S]*?#shopPurchaseModal\.active/s,
        'light shop modals should keep a transparent non-active overlay base so closing never falls back to the global dark modal backdrop'
    );
    assert.match(
        shopHtmlSource,
        /js\/shop-client\.js\?v=20260426_SHOP_MOBILE_ENTER_STABLE_2/,
        'shop.html should load the cart-enabled shop client runtime'
    );
    assert.match(
        shopHtmlSource,
        /id="shopCartAnchor"[\s\S]*id="shopCartDrawer"[\s\S]*id="shopCartCheckoutModal"/,
        'shop.html should render the floating cart anchor, drawer, and checkout review modal'
    );
    assert.match(
        shopClientSource,
        /当前商品可用[\s\S]*当前商品不可用/,
        'shop-client.js should separate discounts usable for the current product from owned but unusable discounts'
    );
    assert.match(
        shopClientSource,
        /const shouldWaitForLiveAvailableItems = discountAssetsLoading[\s\S]*currentlyUnavailableItems\.length > 0;[\s\S]*if \(\(\!ownedItems\.length && !claimableItems\.length\) \|\| shouldWaitForLiveAvailableItems\) \{\s+container\.innerHTML = discountAssetsLoading\s+\? '<div class="shop-discount-assets-empty">正在同步当前商品可用卡券\.\.\.<\/div>'/s,
        'purchase modal should keep the unified loading state while only stale unavailable coupon prefills are present'
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
        /openPurchaseModalFromCartEntry: function \(entry\) \{[\s\S]*void this\.prefetchDiscountAssetsForProduct\(\{\s+productId: entry\.productId,\s+quantity: entry\.quantity,\s+agentId: this\.currentAgentId,\s+site: window\.SiteConfig\?\.site \|\| 'cn'\s+\}\);[\s\S]*this\.openPurchaseModal\(/s,
        'cart re-entry should prefetch matching quantity coupon data before reopening the product modal'
    );
    assert.match(
        shopClientSource,
        /getPurchaseQuantityCapForProduct: function \(product, fallbackMaxQuantity = null\) \{[\s\S]*stockCount[\s\S]*Math\.min\(99,\s*Math\.trunc\(stockCount\)\)/s,
        'purchase modals should derive their quantity cap from live stock when stock is available'
    );
    assert.match(
        shopHtmlSource,
        /id="purchaseAddToCartBtn"[\s\S]*id="nextPurchaseStepBtn"/,
        'shop purchase modal should render the add-to-cart button before the direct confirm button'
    );
    assert.match(
        shopClientSource,
        /if \(event\.target instanceof Element && event\.target\.closest\('#nextPurchaseStepBtn'\)\) \{\s+event\.preventDefault\?\.\(\);\s+void this\.confirmPurchase\(\);\s+return;\s+\}/s,
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
        /buildProductCardElement: function \(product, agentPrices = \{}, index = 0, \{ waveTimeMs = performance\.now\(\) \} = \{}\)[\s\S]*el\.dataset\.shopAction = 'buy-product';[\s\S]*class="shop-card-cart-trigger[\s\S]*data-shop-action="add-product-to-cart"/,
        'product cards should open purchase from the card body and use a dedicated cart icon trigger'
    );
    assert.match(
        shopClientSource,
        /buyProduct: async function \([\s\S]*const liveProduct = this\.getCachedProductById\(productId\);[\s\S]*const quantityCap = this\.getPurchaseQuantityCapForProduct\(liveProduct, maxPurchaseQuantity\);/s,
        'opening the purchase modal from a product card should honor the current product stock when computing the quantity cap'
    );
    assert.match(
        shopClientSource,
        /openPurchaseModalFromCartEntry: function \(entry\) \{[\s\S]*const purchaseQuantityCap = this\.getPurchaseQuantityCapForProduct\(entry\.product, entry\.quantityCap\);/s,
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
