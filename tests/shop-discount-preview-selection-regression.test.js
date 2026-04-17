const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('shop purchase discount cards surface the coupon benefit and precise preview copy', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const shopCssSource = readRepoFile(path.join('css', 'shop-page.css'));

    assert.match(
        shopClientSource,
        /shop-discount-asset-card__benefit/,
        'shop-client.js should render a dedicated benefit pill alongside the discount code'
    );
    assert.match(
        shopClientSource,
        /当前实付/,
        'shop-client.js should explain the payable total directly when a coupon is applied'
    );
    assert.match(
        shopClientSource,
        /已优惠/,
        'shop-client.js should surface the exact saved amount instead of forcing the user to infer it'
    );
    assert.doesNotMatch(
        shopClientSource,
        /理论折后|整数结算实付/,
        'shop-client.js should no longer describe coupon settlement as an integer-only fallback'
    );
    assert.match(
        shopCssSource,
        /\.shop-discount-asset-card__benefit\s*\{/,
        'shop-page.css should style the new discount benefit pill'
    );
});

test('shop purchase discount cards humanize coupon channels and expose jumpable target products for unavailable coupons', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const shopCssSource = readRepoFile(path.join('css', 'shop-page.css'));

    assert.match(
        shopClientSource,
        /formatDiscountSourceLabel: function \(item = \{\}\)/,
        'shop-client.js should normalize raw channel keys into user-friendly coupon source labels'
    );
    assert.match(
        shopClientSource,
        /metaParts\.push\(sourceLabel\);/,
        'shop-client.js should render the coupon source directly in human-readable language instead of exposing raw source_channel keys'
    );
    assert.match(
        shopClientSource,
        /formatDiscountStackingLabel: function \(item = \{\}\)/,
        'shop-client.js should translate the raw stacking rule into a short user-facing label'
    );
    assert.match(
        shopClientSource,
        /metaParts\.push\(stackingSummary\);/,
        'shop-client.js should show the stacking summary directly without a redundant "叠加规则" prefix'
    );
    assert.match(
        shopClientSource,
        /shop-discount-asset-card__stacking--stackable/,
        'shop-client.js should render a dedicated stacking badge for stackable coupons'
    );
    assert.match(
        shopClientSource,
        /data-shop-discount-action="jump-product"/,
        'unavailable discount cards should render clickable target-product actions'
    );
    assert.match(
        shopClientSource,
        /jumpToDiscountTargetProduct: async function \(productId, options = \{\}\)/,
        'shop-client.js should support jumping from an unavailable coupon to its compatible product card'
    );
    assert.match(
        shopClientSource,
        /shop-discount-asset-card--collapsible/,
        'unavailable discount cards with compatible products should render as collapsible cards'
    );
    assert.match(
        shopClientSource,
        /formatDiscountExpiryLabel: function \(item = \{\}, \{ includePrefix = true, preferClaimWindow = false \} = \{\}\)/,
        'shop-client.js should format a dedicated expiry label for unavailable coupon cards'
    );
    assert.match(
        shopClientSource,
        /formatDiscountUnavailableReason: function \(item = \{\}, \{ short = false \} = \{\}\)/,
        'shop-client.js should humanize unavailable coupon reasons into user-facing copy'
    );
    assert.match(
        shopClientSource,
        /不支持全额抵扣/,
        'unavailable fixed-amount coupons should explain when they would reduce the payable total to zero'
    );
    assert.match(
        shopClientSource,
        /shop-discount-asset-card__fold-inner/,
        'shop-client.js should render unavailable coupon meta and targets inside a dedicated collapsible fold body'
    );
    assert.match(
        shopClientSource,
        /if \(!isUnavailableCard\) \{[\s\S]*Number\.isFinite\(effectiveFinalTotal\)/,
        'shop-client.js should keep unavailable coupon cards from surfacing misleading discounted totals'
    );
    assert.match(
        shopClientSource,
        /metaParts\.push\(`有效期 \$\{this\.formatDiscountExpiryLabel\(item, \{ includePrefix: false \}\)\}`\);/,
        'shop-client.js should keep the validity label inside the unavailable coupon fold body'
    );
    assert.match(
        shopClientSource,
        /shop-discount-asset-card__summary-reason/,
        'collapsible unavailable coupon cards should show a concise unavailability reason before the fold is expanded'
    );
    assert.match(
        shopClientSource,
        /toggleDiscountAssetAccordion: function \(detailsEl\)/,
        'shop-client.js should animate unavailable coupon accordion expansion and collapse'
    );
    assert.doesNotMatch(
        shopClientSource,
        /可用商品见下方/,
        'unavailable discount cards should no longer rely on the old "see below" CTA copy'
    );
    assert.match(
        shopCssSource,
        /\.shop-discount-asset-card__stacking--exclusive\s*\{/,
        'shop-page.css should style the exclusive coupon stacking badge'
    );
    assert.match(
        shopCssSource,
        /\.shop-discount-asset-card__stacking--stackable\s*\{/,
        'shop-page.css should style the stackable coupon stacking badge'
    );
    assert.match(
        shopCssSource,
        /\.shop-discount-asset-card__targets\s*\{/,
        'shop-page.css should style the new compatible-product section inside discount cards'
    );
    assert.match(
        shopCssSource,
        /\.shop-discount-asset-card__target-link\s*\{/,
        'shop-page.css should style the target-product buttons as clickable pills'
    );
    assert.match(
        shopCssSource,
        /\.shop-discount-asset-card__target-link\s*\{[\s\S]*text-align:\s*left;/s,
        'shop-page.css should keep the unavailable target product name left-aligned for a tidier layout'
    );
    assert.match(
        shopCssSource,
        /\.shop-discount-asset-card__target-action\s*\{[\s\S]*border-radius:\s*999px;/s,
        'shop-page.css should render the jump action as a compact pill instead of a heavy full-width bar'
    );
    assert.match(
        shopCssSource,
        /\.shop-discount-asset-card__summary\s*\{/,
        'shop-page.css should style the collapsible unavailable coupon summary row'
    );
    assert.match(
        shopCssSource,
        /\.shop-discount-asset-card__summary-reason\s*\{/,
        'shop-page.css should style the concise unavailable-reason copy shown in collapsed coupon summaries'
    );
    assert.match(
        shopCssSource,
        /\.shop-discount-asset-card--collapsible\[open\]\s+\.shop-discount-asset-card__fold\s*\{/,
        'shop-page.css should animate unavailable coupon accordions from the native open state'
    );
    assert.match(
        shopCssSource,
        /\.shop-discount-asset-card--collapsible\.is-collapsing\s+\.shop-discount-asset-card__chevron\s*\{/,
        'shop-page.css should style the collapsing state so the accordion arrow animates smoothly on close'
    );
});

test('shop purchase selection keeps server preview totals authoritative after a coupon is applied', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));

    assert.match(
        shopClientSource,
        /this\.currentPurchase\.discountFinalTotal = finalTotal;/,
        'shop-client.js should persist the preview final total instead of recomputing it locally'
    );
    assert.match(
        shopClientSource,
        /const previewFinalTotal = Number\(preview\?\.final_total\);[\s\S]*document\.getElementById\('modalTotalPrice'\)\.textContent = this\.formatShopPointValue\(finalTotal\);/s,
        'applying a coupon should update the modal total directly from the server preview payload'
    );
    assert.match(
        shopClientSource,
        /当前实付 \$\{this\.formatShopPointValue\(normalizedFinalTotal\)\} \$\{pointsLabel\}/,
        'the success message should report the exact payable total returned by the server'
    );
});

test('shop purchase modal tracks selected coupons as an array and submits stacked selections to the server', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));

    assert.match(
        shopClientSource,
        /selectedDiscounts:\s*\[\],[\s\S]*appliedDiscounts:\s*\[\],/s,
        'shop-client.js should keep the live purchase selection as an array-based state instead of a single discount slot'
    );
    assert.match(
        shopClientSource,
        /validateDiscountSelectionsWithServer: async function \(discountSelections = \[\], options = \{\}\)/,
        'shop-client.js should validate the whole selected coupon set against the server'
    );
    assert.match(
        shopClientSource,
        /discountSelections:\s*this\.serializeDiscountSelectionsForRequest\(\)/,
        'shop purchase submissions should include the normalized stacked coupon selection array'
    );
    assert.match(
        shopClientSource,
        /discountSelections:\s*Array\.isArray\(purchasePayload\.discountSelections\) \? purchasePayload\.discountSelections : \[\]/,
        'requestPurchasePayloadWithServer should forward stacked coupon selections to the purchase API'
    );
    assert.match(
        shopClientSource,
        /const allowIdentityOnly = options\.allowIdentityOnly === true;/,
        'shop-client.js should support request-time coupon selections that only carry coupon identity before preview metadata is hydrated'
    );
    assert.match(
        shopClientSource,
        /if \(\(!code && !assetId\) \|\| \(!allowIdentityOnly && !hasPricingConfig\)\) \{/,
        'identity-only coupon selections should no longer be discarded when the user clicks a coupon card before preview details are available'
    );
    assert.match(
        shopClientSource,
        /this\.serializeDiscountSelectionsForRequest\(discountSelections,\s*\{\s*allowIdentityOnly:\s*true\s*\}\)/,
        'server validation should serialize clicked coupon cards with their asset/code identity intact instead of dropping them as empty selections'
    );
});

test('exclusive coupon conflicts should yield to the newly clicked coupon instead of leaving the old selection stuck', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));

    assert.match(
        shopClientSource,
        /isExclusiveDiscountStackingConflict: function \(error = null\)/,
        'shop-client.js should detect the dedicated exclusive-coupon stacking conflict returned by the server'
    );
    assert.match(
        shopClientSource,
        /applyExclusiveReplacementSelection: async function \(selection = \{\}, \{ conflictMessage = '' \} = \{\}\)/,
        'shop-client.js should expose a helper that retries validation with only the newly selected coupon'
    );
    assert.match(
        shopClientSource,
        /已改为仅应用你刚选择的优惠券/,
        'when stacking hits an exclusive coupon conflict, the UI should explain that it switched to the newly selected coupon'
    );
    assert.match(
        shopClientSource,
        /if \(!isSelected && currentSelections\.length && this\.isExclusiveDiscountStackingConflict\(error\)\) \{[\s\S]*await this\.applyExclusiveReplacementSelection\(/,
        'clicking a new coupon card should replace the prior selection when the existing selection is exclusive'
    );
    assert.match(
        shopClientSource,
        /if \(assetSelections\.length && this\.isExclusiveDiscountStackingConflict\(err\)\) \{[\s\S]*await this\.applyExclusiveReplacementSelection\(/,
        'manually applying a coupon code should also replace an existing exclusive selection instead of getting stuck on the error'
    );
});

test('wallet-to-shop product jumps can prefill coupon assets before the live refresh finishes', () => {
    const walletModalSource = readRepoFile(path.join('js', 'components', 'WalletModal.js'));
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const shopHandlerSource = readRepoFile(path.join('server', 'api-handlers', 'public', 'shop.js'));

    assert.match(
        walletModalSource,
        /sessionStorage\.setItem\('shop_purchase_prefill'/,
        'wallet modal should persist a temporary shop purchase prefill before jumping to the product page'
    );
    assert.match(
        shopClientSource,
        /const SHOP_PURCHASE_PREFILL_STORAGE_KEY = 'shop_purchase_prefill';/,
        'shop-client.js should define the shared purchase prefill storage key'
    );
    assert.match(
        shopClientSource,
        /consumePurchasePrefillForProduct: function \(productId = ''\)/,
        'shop-client.js should consume wallet-provided purchase prefills by product id'
    );
    assert.match(
        shopClientSource,
        /const hasImmediateVisibleDiscountData = Boolean\(cachedDiscountAssetsPayload\)[\s\S]*prefilledOwnedDiscounts\.some\(\(item\) => item\?\.available !== false\)[\s\S]*discountAssetsLoading: !hasImmediateVisibleDiscountData/s,
        'opening the purchase modal should only skip the loading state when cached or immediately usable coupon data is already available'
    );
    assert.match(
        shopHandlerSource,
        /scoped_product_preview: scopedProductAvailability\?\.preview \|\| null/,
        'wallet discount assets should expose the scoped product preview so the shop jump can reuse it instantly'
    );
});

test('wallet discount cards surface the coupon stacking rule in both summary chips and detail copy', () => {
    const walletModalSource = readRepoFile(path.join('js', 'components', 'WalletModal.js'));
    const walletCssSource = readRepoFile(path.join('css', 'wallet.css'));

    assert.match(
        walletModalSource,
        /formatDiscountAssetStackingLabel\(asset = \{\}\)/,
        'WalletModal should normalize stacking labels for wallet coupon cards'
    );
    assert.match(
        walletModalSource,
        /<span class="\$\{stackingChipClass\}">\$\{stackingLabel\}<\/span>/,
        'wallet coupon cards should show a stacking chip in the summary row'
    );
    assert.match(
        walletModalSource,
        /wallet-discount-assets-card-line wallet-discount-assets-card-line--wide">\s*<strong>\$\{stackingSummary\}<\/strong>/,
        'wallet coupon details should show the stacking summary directly without a separate "叠加规则" label'
    );
    assert.match(
        walletCssSource,
        /\.wallet-discount-assets-card-chip--exclusive\s*\{/,
        'wallet.css should style the exclusive coupon chip'
    );
    assert.match(
        walletCssSource,
        /\.wallet-discount-assets-card-chip--stackable\s*\{/,
        'wallet.css should style the stackable coupon chip'
    );
});

test('shop request failures should be translated into user-facing guidance instead of raw fetch errors', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));

    assert.match(
        shopClientSource,
        /normalizeShopRequestError: function \(error = null, \{ fallbackMessage = '优惠服务连接失败，请刷新后重试' \} = \{\}\)/,
        'shop-client.js should normalize raw request exceptions into user-facing messages'
    );
    assert.match(
        shopClientSource,
        /fallbackMessage: '优惠验证连接失败，请刷新页面后重试'/,
        'discount validation requests should no longer surface a raw fetch failed message'
    );
    assert.match(
        shopClientSource,
        /fallbackMessage: '卡券列表连接失败，请刷新页面后重试'/,
        'discount asset loading should report a friendly recovery message when the request transport fails'
    );
});

test('shop product cards prefetch discount assets so direct product opens can render coupons immediately', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));

    assert.match(
        shopClientSource,
        /discountAssetsCache: new Map\(\),[\s\S]*discountAssetsRequestCache: new Map\(\),/s,
        'shop-client.js should maintain dedicated discount asset caches and in-flight request dedupe maps'
    );
    assert.match(
        shopClientSource,
        /requestAvailableDiscountAssets: async function \(\{ productId = '', quantity = 1, agentId = null, site = '', preferCache = false, allowPending = true \} = \{\}\)/,
        'shop-client.js should expose a reusable discount asset request helper with cache and pending request controls'
    );
    assert.match(
        shopClientSource,
        /scheduleVisibleDiscountAssetsPrefetch: function \(products = \[\]\)/,
        'shop-client.js should prefetch discount assets for the first visible products after the grid renders'
    );
    assert.match(
        shopClientSource,
        /this\.scheduleVisibleDiscountAssetsPrefetch\(data\);/,
        'loadProducts should trigger visible product discount prefetching after the grid is rendered'
    );
    assert.match(
        shopClientSource,
        /el\.addEventListener\('pointerenter', prefetchProductDiscounts, \{ passive: true \}\);/,
        'shop-client.js should prefetch discount assets only once when the pointer actually enters a buyable product card'
    );
    assert.match(
        shopClientSource,
        /el\.addEventListener\('focus', prefetchProductDiscounts\);/,
        'keyboard focusing a buyable product card should also warm its discount assets before the modal opens'
    );
    assert.doesNotMatch(
        shopClientSource,
        /shopGrid\?\.addEventListener\('pointerover'/,
        'shop-client.js should no longer prefetch discount assets from a bubbling pointerover handler on the whole grid'
    );
    assert.match(
        shopClientSource,
        /const cachedDiscountAssetsPayload = this\.readDiscountAssetsCache\(this\.buildDiscountAssetsCacheKey\(/,
        'opening the purchase modal should consult the warm discount cache before showing a loading placeholder'
    );
    assert.match(
        shopClientSource,
        /void this\.prefetchDiscountAssetsForProduct\(\{\s+productId,\s+quantity: initialQuantity,\s+agentId: this\.currentAgentId,\s+site: window\.SiteConfig\?\.site \|\| 'cn'\s+\}\);[\s\S]*const hasImmediateVisibleDiscountData = Boolean\(cachedDiscountAssetsPayload\)/s,
        'purchase modal should kick off discount prefetch before opening and still treat cached discount data as immediately renderable'
    );
});

test('shop purchase modal renders a polished discount input group instead of a plain text field and boxy button', () => {
    const shopHtmlSource = readRepoFile('shop.html');
    const shopCssSource = readRepoFile(path.join('css', 'shop-page.css'));

    assert.match(
        shopHtmlSource,
        /class="shop-purchase-discount__input-wrap"[\s\S]*id="purchaseDiscountCode"[\s\S]*class="shop-purchase-discount__action/,
        'shop.html should render the coupon input and verify action as a unified discount input group'
    );
    assert.match(
        shopCssSource,
        /\.shop-purchase-discount__input-wrap\s*\{[\s\S]*border-radius:\s*16px;[\s\S]*background:\s*rgba\(13,\s*18,\s*26,\s*0\.88\)/s,
        'shop-page.css should style the coupon input shell in the same dark panel family as the purchase modal'
    );
    assert.match(
        shopCssSource,
        /\.shop-purchase-discount__action\s*\{[\s\S]*min-height:\s*44px;[\s\S]*rgba\(52,\s*211,\s*153,\s*0\.12\)/s,
        'shop-page.css should style the verify action as a restrained minimal accent pill'
    );
});
