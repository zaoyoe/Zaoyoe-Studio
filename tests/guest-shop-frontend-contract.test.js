'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Order Access 2.0 (A2): the browser generator is judged against the REAL
// server policy, not against a copy of it, so a drift in either side fails here.
const security = require('../api/_lib/guest-shop/security');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const markup = read('shop.html');
const client = read('js/guest-shop-client.js');
const shopClient = read('js/shop-client.js');
const styles = read('css/shop-page.css');
const guestShopHandler = read('server/api-handlers/public/guest-shop.js');
// A2 deliverables: the standalone lookup page and the shared password module.
const ordersPage = read('guest-orders.html');
const ordersClient = read('js/guest-orders-client.js');
const ordersStyles = read('css/guest-orders.css');
const passwordModuleSource = read('js/guest-query-password.js');
const iosScrollLockSource = read('js/ios-scroll-lock.js');

function guestCheckoutModalMarkup() {
    const start = markup.indexOf('id="guestCashPurchaseModal"');
    const end = markup.indexOf('<div class="modal-overlay" id="shopCartCheckoutModal">', start);
    assert.ok(start >= 0 && end > start, 'guest checkout modal markup must have a clear boundary');
    return markup.slice(start, end);
}

/**
 * Comments are prose; code is the contract. The guest scripts legitimately
 * document WHY supabase / Authorization / localStorage.setItem are forbidden,
 * so the isolation assertions below run against comment-stripped source and
 * fail on a real reference only. Same helper convention as
 * tests/guest-shop-buyer-credentials.test.js: block comments and whole-line
 * comments go, trailing `// ...` on a code line stays so a URL inside a string
 * literal is never mangled.
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//gu, ' ')
        .replace(/^[ \t]*\/\/.*$/gmu, '');
}

// Entry-merge deliverable: the logged-out primary action copy lives in the
// shared language bundles, not in inline markup.
const zhLang = JSON.parse(read('lang/zh.json'));
const enLang = JSON.parse(read('lang/en.json'));

// The polling client and the server-side per-IP status budget must stay in sync,
// so read both instead of pinning magic interval numbers.
function parseSmartPollIntervals(source) {
    const block = /const SMART_POLL_INTERVALS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(source);
    assert.ok(block, 'SMART_POLL_INTERVALS must stay a frozen literal');
    const intervals = {};
    for (const line of block[1].split('\n')) {
        const entry = /^\s*([A-Z][A-Z_]*):\s*(\d+)/.exec(line);
        if (entry) intervals[entry[1]] = Number(entry[2]);
    }
    return intervals;
}

function parseStatusRateLimitPerMinute(source) {
    const match = /limit\(req, res, 'status', \{ limit: (\d+) \}\)/.exec(source);
    assert.ok(match, 'the guest status endpoint must keep an explicit rate limit');
    return Number(match[1]);
}

test('shop page mounts the isolated guest cash checkout after the authenticated shop client', () => {
    // Anchored on the <script src= prefix, not the bare path: an explanatory
    // HTML comment that mentions the client would otherwise win the indexOf race
    // and make load order look inverted.
    const shopClientIndex = markup.indexOf('<script src="js/shop-client.js');
    const guestClientIndex = markup.indexOf('<script src="js/guest-shop-client.js');

    assert.ok(shopClientIndex >= 0, 'the existing shop client must remain mounted');
    assert.ok(guestClientIndex > shopClientIndex, 'guest checkout must initialize after the shop client');
    assert.doesNotMatch(
        markup,
        /guestCashPurchaseBtn/,
        'the standalone 游客购买 button must stay removed from the product detail modal'
    );
    assert.match(markup, /id="nextPurchaseStepBtn"[^>]*class="shop-btn shop-btn-primary"/);
    assert.match(markup, /id="guestCashPurchaseModal"[^>]*hidden/);
    assert.match(markup, /id="guestCashState"[^>]*hidden/);
    assert.match(markup, /<footer id="guestCashActionFooter"[^>]*hidden/);
    assert.match(markup, /id="guestCashDeliveredContent"[^>]*class="guest-shop-modal__delivery-content"/);
    assert.match(styles, /\.guest-shop-modal__content/);
    assert.match(
        styles,
        /html\[data-theme="dark"\] body\.shop-page \.guest-shop-modal__payment-option \{[\s\S]*?background: rgba\(30,41,59,.88\);[\s\S]*?color: #e2e8f0;/
    );
    assert.match(
        styles,
        /html\[data-theme="dark"\] body\.shop-page \.guest-shop-modal__payment-option\[aria-checked="true"\] \{[\s\S]*?background: rgba\(56,189,248,.14\);/
    );
    assert.match(
        styles,
        /html:not\(\[data-theme="dark"\]\) body\.shop-page \.guest-shop-modal__payment-option \{[\s\S]*?background: #fff;[\s\S]*?color: #1e293b;/
    );
    assert.match(styles, /@media \(max-width: 600px\)[\s\S]*\.guest-shop-modal__actions/);
    assert.match(styles, /\.guest-shop-modal__content \{[\s\S]*?overflow-y: auto;[\s\S]*?scroll-padding-bottom: 88px;/);
    assert.match(
        styles,
        /\.guest-shop-modal__content \{[\s\S]*?background:\s*\n\s*linear-gradient\(180deg, rgba\(14, 20, 29, 0\.96\) 0%, rgba\(8, 12, 18, 0\.98\) 100%\)[\s\S]*?border: 1px solid rgba\(255, 255, 255, 0\.08\) !important;/
    );
    assert.match(
        styles,
        /html:not\(\[data-theme="dark"\]\) body\.shop-page \.guest-shop-modal__content \{[\s\S]*?background: rgba\(255, 255, 255, 0\.96\) !important;[\s\S]*?border: 1px solid var\(--shop-light-border\) !important;/
    );
    assert.match(
        styles,
        /@media \(max-width: 600px\) \{[\s\S]*?\.guest-shop-modal__content \{[\s\S]*?width: calc\(100% - 40px\) !important;[\s\S]*?max-width: 620px !important;[\s\S]*?border-radius: 30px !important;/
    );
    assert.match(
        styles,
        /@media \(max-width: 768px\) \{[\s\S]*?#shopPurchaseModal \.modal-content,[\s\S]*?#guestCashPurchaseModal #guestCashPurchaseDialog\.premium-modal \{[\s\S]*?width: min\(calc\(100% - 28px\), 620px\) !important;[\s\S]*?max-width: 620px !important;/
    );
    assert.match(
        styles,
        /@media \(min-width: 769px\) and \(max-width: 900px\) \{[\s\S]*?#shopPurchaseModal \.modal-content,[\s\S]*?#guestCashPurchaseModal #guestCashPurchaseDialog\.premium-modal \{[\s\S]*?width: min\(calc\(100% - 56px\), 760px\) !important;[\s\S]*?max-width: 760px !important;/
    );
    assert.match(
        styles,
        /@media \(min-width: 901px\) \{[\s\S]*?#shopPurchaseModal \.modal-content,[\s\S]*?#guestCashPurchaseModal #guestCashPurchaseDialog\.premium-modal \{[\s\S]*?width: min\(calc\(100% - 64px\), 1040px\) !important;[\s\S]*?max-width: 1040px !important;/
    );
    assert.match(styles, /\.guest-shop-modal__actions \{[\s\S]*?position: sticky;[\s\S]*?bottom: 0;/);
    assert.match(styles, /\.guest-shop-modal__actions\[hidden\] \{ display: none !important; \}/);
    assert.match(markup, /js\/shop-client\.js[^\"]*guestModalHandoff=20260920_GUEST_MODAL_HANDOFF_1/);
    assert.match(markup, /js\/guest-shop-client\.js[^\"]*guestModalScrollLock=20260920_GUEST_MODAL_SCROLL_LOCK_1/);
    assert.match(markup, /js\/ios-scroll-lock\.js[^\"]*guestModalOwner=20260920_GUEST_MODAL_OWNER_1/);
});

test('the logged-out guest cash entry is merged into the primary purchase action', () => {
    // The guest script no longer watches the shop purchase modal or owns a button.
    assert.doesNotMatch(client, /guestCashPurchaseBtn/);
    assert.doesNotMatch(client, /shopPurchaseModal/);
    assert.doesNotMatch(client, /syncPurchaseButton|handlePurchaseButtonClick/);
    assert.doesNotMatch(client, /window\.setInterval\(syncPurchaseButton/);
    assert.match(client, /function loadPreview\(context\) \{/);
    assert.match(client, /async function runPreviewRequest\(context, request = capturePreviewRequest\(context\)\) \{/);
    assert.doesNotMatch(client, /reason: 'pending' \};/);

    // It exposes only a routing bridge, and that bridge stays free of auth material.
    assert.match(
        client,
        /window\.GuestShopCheckout = \{\s*peekAvailability,\s*probeAvailability,\s*isDiscountCodeFormat,\s*startGuestCheckout,\s*startGuestBatchCheckout,\s*setModalReturnFocusTarget,\s*focusGuestModal\s*\};/
    );
    assert.match(client, /function peekAvailability\(context = getPurchaseContext\(\)\) \{/);
    assert.match(client, /async function probeAvailability\(context = getPurchaseContext\(\)\) \{/);
    assert.match(client, /async function startGuestCheckout\([\s\S]*?context = getPurchaseContext\(\),[\s\S]*?deferScrollLock = false,[\s\S]*?shouldOpen = null,[\s\S]*?discountCode = '',[\s\S]*?replaceDiscountCode = false[\s\S]*?\} = \{\}[\s\S]*?\) \{/);
    assert.match(client, /if \(typeof shouldOpen === 'function'\) \{[\s\S]*?sourceStillValid = shouldOpen\(\) === true;[\s\S]*?reason: 'source_stale'/);
    assert.match(client, /const TRANSIENT_AVAILABILITY_REASONS = new Set\(\['pending', 'rate_limited', 'preview_error', 'stale'\]\);/);
    assert.match(client, /if \(!TRANSIENT_AVAILABILITY_REASONS\.has\(normalized\.reason\)\) \{/);

    // shop-client.js owns the auth decision and also honors a guest-cash cart entry
    // when the visitor already has an authenticated shop session.
    assert.match(shopClient, /shopAuthStateKnown: null,/);
    assert.match(shopClient, /getGuestCashEntryContext: function \(\) \{[\s\S]*?contextKey: \[selection\.site, selection\.productId, selection\.skuId\]\.join\(':\'\)/);
    assert.match(shopClient, /isGuestCashEntryCandidate: function \(\) \{[\s\S]*?purchase\.guestCashEligible === true && this\.shopAuthStateKnown !== true;/);
    assert.match(shopClient, /isGuestCashEntryActive: function \(\) \{\s*if \(!this\.isGuestCashEntryCandidate\(\)\) return false;/);
    assert.match(shopClient, /startGuestCashCheckout: async function \(\) \{/);
    assert.match(shopClient, /window\.GuestShopCheckout/);
    assert.match(shopClient, /formatValidator\(normalizedCode\) !== true/);
    assert.match(shopClient, /currentPurchase\.guestCashDiscountCodeFormatValid = true/);
    assert.match(
        shopClient,
        /const returnFocusTarget = this\.findGuestCashReturnFocusTarget\(\);[\s\S]*?const sourceGuestContext = this\.getGuestCashEntryContext\(\);[\s\S]*?const shouldOpenGuestModal = \(\) => this\.guestCashHandoffGeneration === handoffGeneration[\s\S]*?sourceModal\?\.classList\?\.contains\('active'\) === true;[\s\S]*?const result = await bridge\.startGuestCheckout\(sourceGuestContext, \{[\s\S]*?deferScrollLock: canHandoffScrollLock,[\s\S]*?shouldOpen: shouldOpenGuestModal[\s\S]*?if \(result && result\.started\) \{[\s\S]*?this\.closePurchaseModal\(\{[\s\S]*?scrollLockHandoffTarget:[\s\S]*?guestCashPurchaseModal[\s\S]*?bridge\.setModalReturnFocusTarget\?\.\(returnFocusTarget\);[\s\S]*?window\.requestAnimationFrame\(\(\) => bridge\.focusGuestModal\?\.\(\)\);/
    );
    assert.match(client, /function discardIdleBatchDraftForSingleContext\(context\) \{[\s\S]*?!state\.batchMode[\s\S]*?state\.batchMode = false;[\s\S]*?state\.batchEntries = \[\];/);
    assert.match(client, /async function probeAvailability\(context = getPurchaseContext\(\)\) \{[\s\S]*?discardIdleBatchDraftForSingleContext\(context\);/);
    assert.match(shopClient, /handoffPurchaseModalScrollLock: function \(target\) \{[\s\S]*?unfreezePurchaseModalPage\(\{ restoreScroll: false \}\)[\s\S]*?window\.scrollTo\(0, restoreScrollY\)[\s\S]*?iOSScrollLock\.lockLight\(target/);
    assert.match(shopClient, /const scrollLockHandedOff = this\.handoffPurchaseModalScrollLock\(scrollLockHandoffTarget\);[\s\S]*?if \(!scrollLockHandedOff\) \{/);
    assert.match(client, /function lockGuestModalScroll\(modal\) \{[\s\S]*?iOSScrollLock\.lockLight\(modal/);
    assert.match(client, /function closeGuestModal\(\) \{[\s\S]*?unlockGuestModalScroll\(\);/);
    assert.match(iosScrollLockSource, /function unlock\(ownerModal = null\)[\s\S]*?if \(ownerModal && currentModal !== ownerModal\)[\s\S]*?suspendedLightLock = null;[\s\S]*?isOwnedBy\(modalElement\)/);
    assert.match(shopClient, /findGuestCashReturnFocusTarget: function \(\) \{[\s\S]*?\[data-shop-action="buy-product"\]\[data-product-id\]/);
    assert.match(shopClient, /candidates\.find\(\(candidate\) => candidate\.matches\?\.\('button'\) && isVisibleCandidate\(candidate\)\)/);
    assert.match(client, /function isUsableReturnFocusTarget\(target\) \{[\s\S]*?target\.hidden === true[\s\S]*?current\.getAttribute\?\.\('aria-hidden'\) === 'true'/);
    assert.match(client, /function fallbackReturnFocusTarget\(\) \{[\s\S]*?state\.productId[\s\S]*?\[data-shop-action="buy-product"\]\[data-product-id\]/);
    assert.match(client, /const trigger = isUsableReturnFocusTarget\(state\.lastTriggerElement\)[\s\S]*?: fallbackReturnFocusTarget\(\);/);
    assert.match(
        shopClient,
        /const token = await this\.getAccessToken\(\);[\s\S]*?if \(!token\) \{[\s\S]*?const guestEntry = await this\.startGuestCashCheckout\(\);[\s\S]*?if \(!guestEntry\.started[\s\S]*?guestEntry\.reason !== 'source_stale'[\s\S]*?guestEntry\.reason !== 'discount_format_not_checked'[\s\S]*?this\.promptLoginForPurchase\(/
    );
    // Guest cash keeps the shared quantity and promo controls visible. The
    // server preview supplies the quantity cap and whether code entry is enabled.
    assert.match(
        shopClient,
        /if \(guestCashActive\) this\.syncGuestCashEntryQuantity\(\);/
    );
    assert.match(
        shopClient,
        /const guestDiscountEnabled = guestCashActive && this\.guestCashEntryProbe\?\.discountEnabled === true;[\s\S]*setElementHidden\(discountStage, false\);[\s\S]*expandPurchaseDiscountDetails\(discountStage\)/
    );
    // The bridge cache is read synchronously before the stage copy is computed so
    // the merged label does not flash "兑换" on a reopened, already-probed product.
    assert.match(shopClient, /hydrateGuestCashEntryFromBridge: function \(\) \{/);
    assert.match(
        shopClient,
        /this\.hydrateGuestCashEntryFromBridge\(\);\s*\n\s*const copy = this\.getPurchaseStageCopy\(nextStage\);/
    );
    assert.match(shopClient, /const guestCashEntryVisible = this\.isGuestCashEntryActive\(\) \|\| this\.isGuestCashEntryProbePending\(\);[\s\S]*?nextLabel: guestCashEntryVisible/);
    assert.equal(zhLang.shop.guestCashBuyNow, '立即购买');
    assert.equal(enLang.shop.guestCashBuyNow, 'Buy now');

    // Guest quantity changes respect the preview cap and use the canonical
    // repricing path without requesting points-coupon assets.
    assert.match(
        shopClient,
        /syncGuestCashEntryQuantity: function \(\) \{[\s\S]*?const quantityCap = this\.getGuestCashQuantityCap\(\);[\s\S]*?const nextQuantity = Math\.min\(currentQuantity, quantityCap\);[\s\S]*?this\.updatePriceForQuantity\(nextQuantity, \{ refreshDiscountAssets: false \}\);/
    );
    assert.match(shopClient, /quantityInput\.disabled = isPurchaseProcessing \|\| isManualDelivery \|\| isSoldOut;/);
    assert.doesNotMatch(
        shopClient,
        /quantityInput\.disabled = [^;]*guestProbePending/,
        'a late guest availability probe must not lock the quantity input'
    );
    assert.match(shopClient, /const locked = isPurchaseProcessing \|\| isManualDelivery;/);
    assert.doesNotMatch(shopClient, /const atGuestBoundary = guestCashActive/);
    assert.doesNotMatch(shopClient, /const soldOutIncrease = isSoldOut && delta > 0;/);
    assert.match(shopClient, /if \(newQty === currentQuantity\) \{\s*return;\s*\}/);
    assert.match(shopClient, /if \(refreshDiscountAssets[\s\S]*!this\.isGuestCashEntryActive\(\)/);
    assert.doesNotMatch(
        shopClient,
        /const locked = [^;]*guestProbePending/,
        'a late guest availability probe must not lock quantity +/- controls'
    );
    assert.match(shopClient, /quantity: Math\.max\(1, Number\.parseInt\(String\(sourcePurchase\?\.quantity \|\| '1'\), 10\) \|\| 1\)/);
    assert.match(markup, /class="[^"]*shop-purchase-stage-quantity/);
    assert.match(markup, /class="[^"]*shop-purchase-stage-discount/);
    assert.match(
        styles,
        /#shopPurchaseModal \.shop-purchase-dock \.shop-purchase-stage-quantity\[hidden\] \{\s*display:\s*none !important;/
    );

    // The user explicitly rejected an explanatory hint line for logged-out visitors.
    assert.doesNotMatch(shopClient, /未登录可直接现金购买/);
    assert.doesNotMatch(markup, /未登录可直接现金购买/);
});

test('cart checkout routes guest cash, wallet, and mixed items to separate payment branches', () => {
    assert.match(
        shopClient,
        /getCartCheckoutPaymentMode: function \(entries = this\.getCartEntries\(\)\) \{[\s\S]*?const hasGuestCash = normalizedEntries\.some\(\(entry\) => entry\?\.guestPurchasable === true\);[\s\S]*?const hasWallet = normalizedEntries\.some\(\(entry\) => entry\?\.guestPurchasable !== true\);[\s\S]*?if \(hasGuestCash && hasWallet\) return 'mixed';[\s\S]*?return hasGuestCash \? 'guest_cash' : 'wallet';/s
    );
    assert.match(
        shopClient,
        /openCartCheckoutModal: function \(\)[\s\S]*?if \(paymentMode === 'mixed'\) \{[\s\S]*?this\.showShopToast\(this\.getCartCopy\(\)\.mixedCheckoutToast, 'error'\);[\s\S]*?const modal = document\.getElementById\('shopCartCheckoutModal'\);/s
    );
    assert.match(
        shopClient,
        /openPurchaseModalFromCartEntry: function \(entry\)[\s\S]*?forceGuestCash: entry\.guestPurchasable === true,/s
    );
    assert.match(
        shopClient,
        /confirmCartCheckout: async function \(\)[\s\S]*?if \(paymentMode === 'mixed'\) \{[\s\S]*?this\.showShopToast\(this\.getCartCopy\(\)\.mixedCheckoutToast, 'error'\);[\s\S]*?if \(paymentMode === 'guest_cash'\) \{[\s\S]*?this\.getGuestCashBatchDiscountEntry\(entries\)[\s\S]*?this\.closeCartCheckoutModal\(\);[\s\S]*?this\.closeCart\(\);[\s\S]*?bridge\.startGuestBatchCheckout\(entries\)[\s\S]*?\.then\(/s
    );
    assert.match(
        shopClient,
        /bindCartCheckoutModalTapFallbacks: function \(\)[\s\S]*?confirmCartCheckout\(\)/s
    );
    assert.match(
        shopClient,
        /data-shop-cart-action.*checkout|action === 'checkout'[\s\S]*?void this\.confirmCartCheckout\(\);/s
    );
    assert.match(shopClient, /handleGuestShopDelivered: function \(event\)[\s\S]*?consumePurchasedCartQuantity\(/s);
    assert.match(
        client,
        /window\.dispatchEvent\(new CustomEvent\('zaoyoe:guest-shop-closed',[\s\S]*?delivered: wasDelivered,[\s\S]*?productId: closedProductId,[\s\S]*?skuId: closedSkuId/s
    );
    assert.match(
        shopClient,
        /if \(this\.currentPurchase\?\.forceGuestCash === true\) \{[\s\S]*?const guestEntry = await this\.startGuestCashCheckout\(\);[\s\S]*?return;[\s\S]*?\}\s*\n\s*const token = await this\.getAccessToken\(\);/s
    );
});

test('guest checkout uses only the public cash endpoints and same-origin cookie credentials', () => {
    assert.match(client, /const PREVIEW_ENDPOINT = ['"]\/api\/shop\/guest\/preview['"];/);
    assert.match(client, /const ORDER_ENDPOINT = ['"]\/api\/shop\/guest\/orders['"];/);
    assert.match(client, /const STATUS_ENDPOINT = ['"]\/api\/shop\/guest\/status['"];/);
    assert.match(client, /const CLAIM_ENDPOINT = ['"]\/api\/shop\/guest\/claim['"];/);
    assert.match(client, /credentials:\s*['"]same-origin['"]/);
    assert.match(client, /cache:\s*['"]no-store['"]/);
    assert.doesNotMatch(client, /localStorage/);
    assert.doesNotMatch(client, /supabase|access_token|Authorization\s*:/i);
    assert.doesNotMatch(client, /X-Guest-Claim-Secret|claimSecret|claim_secret/);
    // The checkout modal has one lookup destination. The standalone page is
    // credential-first too; the old public order-number + pickup-code path is gone.
    assert.doesNotMatch(client, /\/api\/shop\/guest\/recover|guestCashRecoverBtn|guestCashRecovery(OrderNo|Code)/);
    assert.doesNotMatch(markup, /guestCashRecovery(CodePanel|Panel)|guestCashRecovery(OrderNo|CodeInput)/);
    assert.doesNotMatch(markup, /guestCashShowRecoveryBtn/);
});

test('guest order creation clamps quantity to the server cap and keeps secret material out of browser persistence and URLs', () => {
    // L1: quantity is no longer a hardcoded 1 — it is the buyer's selection run
    // through normalizeQuantity(), which clamps to the preview-reported cap (1
    // while the switch is off, so the pre-L1 body is byte-identical). The raw
    // state.quantity is never sent, so a forged stepper value cannot widen an
    // order; fn_guest_shop_create_order re-applies the same cap server-side.
    assert.match(client, /const prepareBody = \{[\s\S]*checkoutAction:\s*['"]prepare['"][\s\S]*quantity:\s*normalizeQuantity\(state\.quantity\),/);
    assert.match(client, /body = \{\s*checkoutAction:\s*['"]commit['"],\s*intentId:/);
    const persistStart = client.indexOf('function persistCheckoutRecord(record)');
    const persistEnd = client.indexOf('\n    function hydrateCheckout', persistStart);
    assert.ok(persistStart >= 0 && persistEnd > persistStart, 'checkout persistence must stay isolated');
    const persistedCheckout = client.slice(persistStart, persistEnd);
    assert.match(persistedCheckout, /storage\.setItem\(STORAGE_KEY, JSON\.stringify\(\{[\s\S]*orderNo,[\s\S]*site:[\s\S]*productId:[\s\S]*skuId:[\s\S]*expiresAt:[\s\S]*provider:[\s\S]*channel:/);
    assert.doesNotMatch(persistedCheckout, /claim|secret/i);
    assert.doesNotMatch(persistedCheckout, /idempotencyKey/i);
    assert.match(client, /const STORAGE_VERSION = 3/);
    assert.doesNotMatch(client, /Math\.random\(\)/);
    assert.doesNotMatch(client, /searchParams\.set\([^)]*(?:secret|token|claim)/i);
    assert.match(client, /clearQueryReturnMarker\(\)/);
    assert.match(client, /回跳页面不会直接视为支付成功/);
    assert.match(client, /body:\s*JSON\.stringify\(\{\s*orderNo\s*\}\)/);
});

test('the guest promo UI ships hidden, the preview stays code-free and every discount gate is server-driven', () => {
    // The version pin for this batch rides the same script tag as the earlier pins.
    assert.match(markup, /js\/guest-shop-client\.js\?v=20260917_GUEST_POLL_RATE_LIMIT_SAFE_1/);
    assert.match(markup, /guestPromo=20260923_GUEST_PROMO_L1L2_1/);

    // Quantity-only promo controls remain hidden in the guest modal itself.
    // Guest discount-code entry reuses the purchase-details dialog and stays
    // server-gated there until the current SKU's availability preview completes.
    const guestCheckoutMarkup = guestCheckoutModalMarkup();
    assert.doesNotMatch(guestCheckoutMarkup, /id="guestCashQuantityField"/);
    assert.doesNotMatch(guestCheckoutMarkup, /id="guestCashQuantity(?:Minus|Plus|Hint)"/);
    assert.match(markup, /id="guestCashQuantityRow" class="guest-shop-modal__summary-row" hidden/);
    assert.match(markup, /id="guestCashCouponRow"[^>]*hidden/);
    assert.match(markup, /id="guestCashPromoRow"[^>]*hidden/);
    assert.doesNotMatch(markup, /id="guestCashDiscountField"/);
    assert.match(markup, /<input id="guestCashDiscountCode" type="hidden"/);
    const purchaseModalStart = markup.indexOf('id="shopPurchaseModal"');
    const guestModalStart = markup.indexOf('id="guestCashPurchaseModal"');
    const cartModalStart = markup.indexOf('id="shopCartCheckoutModal"', guestModalStart);
    assert.ok(purchaseModalStart >= 0 && guestModalStart > purchaseModalStart && cartModalStart > guestModalStart);
    const purchaseModalMarkup = markup.slice(purchaseModalStart, guestModalStart);
    const guestModalMarkup = markup.slice(guestModalStart, cartModalStart);
    assert.match(purchaseModalMarkup, /<input type="text" id="purchaseDiscountCode"/);
    assert.match(guestModalMarkup, /<input id="guestCashDiscountCode" type="hidden"/);
    assert.doesNotMatch(guestModalMarkup, /<input[^>]+type="text"[^>]*(?:discount|coupon)|<input[^>]+(?:discount|coupon)[^>]+type="text"/iu);
    // `hidden` must win over the flex display the modal CSS gives these fields.
    assert.match(styles, /\.guest-shop-modal__field\[hidden\] \{ display: none !important; \}/);

    // The preview GET is unauthenticated, so a discount code must never ride
    // along in its URL: the whitelist is exactly the four quote inputs. Asserted
    // on comment-stripped source because the function's explanatory comments
    // legitimately discuss the code they forbid.
    const previewStart = client.indexOf('async function runPreviewRequest(context, request = capturePreviewRequest(context)) {');
    const previewEnd = client.indexOf('function safeHttpsUrl(value) {', previewStart);
    assert.ok(previewStart >= 0 && previewEnd > previewStart, 'runPreviewRequest must stay a standalone function');
    const previewSource = stripComments(client.slice(previewStart, previewEnd));
    assert.match(
        previewSource,
        /const query = new URLSearchParams\(\{\s*site: context\.site,\s*productId: context\.productId,\s*skuId: context\.skuId,\s*quantity: String\(request\.quantity\)\s*\}\);/
    );
    assert.doesNotMatch(
        previewSource,
        /\bdiscountCode\b|\bdiscount_code\b|\bcoupon(?:Code)?\b|\bpromo(?:Code)?\b|(?:query|searchParams)\.(?:set|append)\(|\.append\(/iu
    );

    // The only signal that unlocks the guest code path is the server's preview
    // flag, and the state literal defaults it closed. The shared purchase modal
    // shows a disabled coupon-entry loading state while that preview is pending.
    assert.match(client, /discountEnabled: false,/);
    assert.match(client, /state\.discountEnabled = preview\?\.discount_enabled === true;/);
    assert.match(
        client,
        /function syncPromoUi\(preview\) \{[\s\S]*state\.discountEnabled = preview\?\.discount_enabled === true;[\s\S]*syncDiscountUi\(\);/
    );
    assert.match(
        client,
        /function syncDiscountUi\(\) \{[\s\S]*const enabled = state\.discountEnabled === true;[\s\S]*if \(!enabled\) \{[\s\S]*input\.value = '';[\s\S]*return;/
    );
    assert.match(
        shopClient,
        /const guestDiscountEnabled = guestCashActive && this\.guestCashEntryProbe\?\.discountEnabled === true;[\s\S]*setElementHidden\(discountStage, false\);[\s\S]*setElementHidden\(document\.getElementById\('purchaseDiscountAssetsPanel'\), true\)/
    );
    // A disabled gate wipes whatever was typed, so a code can never survive from
    // an enabled SKU into a later createOrder body.
    assert.match(client, /if \(!enabled\) \{[\s\S]{0,400}?input\.value = '';/);
    // createOrder consults the same gate right before building the body - the
    // code is sent only when the server enabled the discount channel.
    assert.match(client, /const discountCode = state\.discountEnabled \? discountCodeValue\(\) : '';/);
    assert.match(shopClient, /discountCode: discountCodeEnabled && discountCodeFormatAccepted \? formatAcceptedDiscountCode : ''/);
    assert.match(client, /if \(replaceDiscountCode === true && handoffCode && !isDiscountCodeFormat\(handoffCode\)\)/);
    assert.match(client, /applyPendingDiscountHandoff\(context, preview\)/);
    // Switching product/SKU resets the gate and drops the typed code, because
    // eligibility, caps and tiers are all per-SKU.
    assert.match(
        client,
        /function resetPromoSelection\(\) \{[\s\S]*?state\.discountEnabled = false;[\s\S]*?clearDiscountCode\(\);/
    );
});

test('Task 2.1 binds preview and create responses to the view that started them', () => {
    assert.match(client, /viewGeneration: 0,[\s\S]*actionGeneration: 0,[\s\S]*quoteGeneration: 0,/);
    assert.match(
        client,
        /function capturePreviewRequest\(context\) \{[\s\S]*contextKey:[\s\S]*cacheKey:[\s\S]*quantity,[\s\S]*quoteGeneration: state\.quoteGeneration,[\s\S]*viewGeneration: state\.viewGeneration/
    );
    assert.match(
        client,
        /function isCurrentPreviewRequest\(request\) \{[\s\S]*request\.viewGeneration === state\.viewGeneration[\s\S]*request\.quoteGeneration === state\.quoteGeneration[\s\S]*request\.cacheKey === previewCacheKey[\s\S]*current\.contextKey === request\.contextKey/
    );

    const previewStart = client.indexOf('async function runPreviewRequest(context, request = capturePreviewRequest(context)) {');
    const previewEnd = client.indexOf('\n    function safeHttpsUrl', previewStart);
    assert.ok(previewStart >= 0 && previewEnd > previewStart, 'runPreviewRequest must stay a standalone function');
    const previewSource = client.slice(previewStart, previewEnd);
    assert.ok(
        (previewSource.match(/isCurrentPreviewRequest\(request\)/g) || []).length >= 3,
        'preview must reject stale work before I/O and after both resolve/reject paths'
    );
    assert.match(previewSource, /await requestJson[\s\S]*if \(!isCurrentPreviewRequest\(request\)\) return \{ available: false, reason: 'stale' \};[\s\S]*renderPreview/);

    const createStart = client.indexOf('async function createOrder() {');
    const createEnd = client.indexOf('\n    async function fetchStatus', createStart);
    assert.ok(createStart >= 0 && createEnd > createStart, 'createOrder must stay a standalone function');
    const createSource = client.slice(createStart, createEnd);
    const createLock = createSource.indexOf('state.requestInFlight = true;');
    const createFirstAwait = createSource.indexOf('await ');
    assert.ok(createLock >= 0 && createLock < createFirstAwait, 'the create single-flight lock must be acquired before the first await');
    assert.match(createSource, /state\.requestInFlight = true;[\s\S]*const operation = beginAction\(\);[\s\S]*const quoteGeneration = state\.quoteGeneration;[\s\S]*await refreshPreview\(context\)/);
    assert.match(createSource, /await refreshPreview\(context\);[\s\S]*!isCurrentAction\(operation\)[\s\S]*quoteGeneration !== state\.quoteGeneration[\s\S]*contextKey/);
    assert.match(createSource, /previouslyAcknowledgedQuote[\s\S]*refreshedQuoteFingerprint[\s\S]*商品报价已变化，请核对新的应付金额后再次点击付款方式。/);
    assert.match(client, /guest_checkout_quote_changed/);
    assert.match(client, /function refreshPreview\(context\)[\s\S]*request\.forceRefresh = true/);
    assert.match(
        createSource,
        /const safeCheckoutRecord = \{\s*orderNo,\s*site: context\.site,\s*productId: context\.productId,\s*skuId: context\.skuId,\s*productName:[\s\S]*skuName:[\s\S]*expiresAt: order\.expires_at,\s*provider: payment\.provider,\s*channel: payment\.channel,\s*intentId: attempt\?\.intentId\s*\};/
    );
    const staleCreateStart = createSource.indexOf('if (!isCurrentAction(operation)) {', createSource.indexOf('await requestJson(ORDER_ENDPOINT'));
    const staleCreateEnd = createSource.indexOf('\n            state.orderNo = orderNo;', staleCreateStart);
    assert.ok(staleCreateStart >= 0 && staleCreateEnd > staleCreateStart, 'late create responses need an isolated safe-handle branch');
    const staleCreateSource = createSource.slice(staleCreateStart, staleCreateEnd);
    assert.match(
        staleCreateSource,
        /persistCheckoutRecord\(safeCheckoutRecord\);\s*state\.detachedCheckout = safeCheckoutRecord;\s*clearPendingCreateAttempt\(attempt\);\s*return;/
    );
    assert.doesNotMatch(staleCreateSource, /recovery_code|showRecoveryCode|renderCheckout|startPolling/);
    assert.match(createSource, /finally \{\s*state\.requestInFlight = false;\s*renderGuestActions\(\);/);

    // The payment modal no longer owns a recovery request or a second lookup
    // link; the shop-level order query control is the single lookup entry.
    assert.doesNotMatch(client, /async function recoverOrder\s*\(/);
    assert.doesNotMatch(client, /RECOVERY_ENDPOINT|guestCashRecoverBtn|guestCashRecovery/);
});

test('an unknown create result can only replay the original server-held checkout intent', () => {
    const createStart = client.indexOf('async function createOrder() {');
    const createEnd = client.indexOf('\n    async function fetchStatus', createStart);
    assert.ok(createStart >= 0 && createEnd > createStart, 'createOrder must stay a standalone function');
    const createSource = client.slice(createStart, createEnd);
    assert.match(
        createSource,
        /const retryAttempt = \(state\.paymentCreationUnknown \|\| state\.pendingCreateAttempt\?\.unresolved\)\s*\? state\.pendingCreateAttempt\s*: null;\s*const retryingUnknown = Boolean\(retryAttempt\);/
    );
    assert.match(createSource, /if \(retryingUnknown\) \{[\s\S]*?body = \{ checkoutAction: 'commit', intentId: attempt\.intentId \};/);
    const retryBranchStart = createSource.indexOf('if (retryingUnknown) {');
    const retryBranchEnd = createSource.indexOf('\n            } else {', retryBranchStart);
    assert.ok(retryBranchStart >= 0 && retryBranchEnd > retryBranchStart, 'the unknown-result replay branch must stay explicit');
    assert.doesNotMatch(createSource.slice(retryBranchStart, retryBranchEnd), /newIdempotencyKey|selectedPayment|discountCodeValue/);
    assert.match(client, /function rememberCheckoutIntent\(intent, fallbackContext = null\) \{[\s\S]*state\.pendingCreateAttempt = attempt;/);
    assert.match(createSource.slice(retryBranchStart, retryBranchEnd), /if \(attempt\.requiresOrderPassword\) \{[\s\S]*orderPasswordPolicyFailure\(\)[\s\S]*body\.orderPassword = foldQueryPassword\(orderPasswordInput\(\)\?\.value \|\| ''\);/);
    assert.match(createSource, /const prepareBody = \{[\s\S]*checkoutAction: 'prepare'[\s\S]*quantity:\s*normalizeQuantity\(state\.quantity\),/);
    assert.match(createSource, /const prepared = await requestJson\(ORDER_ENDPOINT,[\s\S]*body: JSON\.stringify\(prepareBody\)/);
    assert.match(createSource, /body: JSON\.stringify\(body\)/);
    assert.match(client, /function createResultIsUnknown\(error,[\s\S]*if \(DEFINITIVE_CREATE_FAILURE_CODES\.has\(code\)\) return false;\s*if \(retryingUnknown\) return true;/);
    assert.match(
        client,
        /const DEFINITIVE_CREATE_FAILURE_CODES = new Set\(\[[\s\S]*['"]guest_provider_checkout_missing['"][\s\S]*\]\);/
    );
    for (const code of [
        'guest_promo_safety_limit',
        'guest_inventory_unavailable',
        'guest_inventory_source_invalid',
        'guest_inventory_source_unavailable',
        'guest_inventory_source_snapshot_failed',
        'guest_product_unavailable',
        'guest_sku_unavailable',
        'guest_quantity_not_allowed',
        'guest_delivery_mode_unsupported'
    ]) {
        assert.match(client, new RegExp(`['"]${code}['"]`, 'u'), `${code} must remain a definitive create failure`);
    }
    assert.match(createSource, /const unknownResult = createResultIsUnknown\(error,[\s\S]*if \(unknownResult && attempt\) \{[\s\S]*attempt\.unresolved = true;/);
    const persistStart = client.indexOf('function persistCheckoutRecord(record)');
    const persistEnd = client.indexOf('\n    function hydrateCheckout', persistStart);
    const persisted = client.slice(persistStart, persistEnd);
    assert.doesNotMatch(persisted, /pendingCreateAttempt|idempotencyKey|orderPassword|discountCode/);
});

test('checkout intent inspection and acknowledgement stay recoverable when browser storage fails', () => {
    const persistStart = client.indexOf('function persistCheckoutRecord(record)');
    const persistEnd = client.indexOf('\n    function hydrateCheckout', persistStart);
    assert.ok(persistStart >= 0 && persistEnd > persistStart, 'checkout persistence must stay isolated');
    const persistSource = client.slice(persistStart, persistEnd);
    assert.match(persistSource, /const storage = getSessionStorage\(\);\s*if \(!storage\) return false;/);
    assert.match(persistSource, /intentId:\s*checkoutIntentId\(record\?\.intentId\)/);
    assert.match(client, /function persistCheckout\(\) \{\s*return persistCheckoutRecord\(state\);\s*\}/);

    const inspectStart = client.indexOf('async function inspectCheckoutIntent(');
    const inspectEnd = client.indexOf('\n    function acknowledgeCheckoutIntent', inspectStart);
    assert.ok(inspectStart >= 0 && inspectEnd > inspectStart, 'inspectCheckoutIntent must stay a standalone function');
    const inspectSource = client.slice(inspectStart, inspectEnd);
    assert.match(inspectSource, /body: JSON\.stringify\(\{\s*checkoutAction: ['"]inspect['"]\s*\}\)/);
    assert.match(inspectSource, /if \(intent\?\.pending === true\)/);
    assert.match(inspectSource, /rememberCheckoutIntent\(intent, context\)/);

    const ackStart = client.indexOf('function acknowledgeCheckoutIntent(intentId) {');
    const ackEnd = client.indexOf('\n    function clearPendingCreateAttempt', ackStart);
    assert.ok(ackStart >= 0 && ackEnd > ackStart, 'acknowledgeCheckoutIntent must stay a standalone function');
    const ackSource = client.slice(ackStart, ackEnd);
    assert.match(ackSource, /const selector = checkoutIntentId\(intentId\)/);
    assert.match(ackSource, /checkoutAction: ['"]ack['"]/);
    assert.match(ackSource, /credentials|requestJson\(ORDER_ENDPOINT/);

    const createStart = client.indexOf('async function createOrder() {');
    const createEnd = client.indexOf('\n    async function fetchStatus', createStart);
    const createSource = client.slice(createStart, createEnd);
    assert.match(createSource, /if \(!attempt\.intentId\) \{[\s\S]*await inspectCheckoutIntent\(attempt\.context/);
    assert.match(
        createSource,
        /const checkoutPersisted = persistCheckoutRecord\([\s\S]*?clearPendingCreateAttempt\(attempt\);\s*if \(checkoutPersisted\) acknowledgeCheckoutIntent\(attempt\?\.intentId\);/
    );
    assert.doesNotMatch(createSource, /clearPendingCreateAttempt\(attempt\);\s*acknowledgeCheckoutIntent\(attempt\?\.intentId\);\s*state\.orderNo/);
    assert.match(client, /sessionStorageUnavailable: false,/);
    assert.match(client, /setHidden\('guestCashStorageWarning', !state\.sessionStorageUnavailable\)/);
});

test('failed creates and stale recovery selectors are cleaned up safely', () => {
    const clearStart = client.indexOf('function discardCheckoutIntentBestEffort(intentId) {');
    const clearEnd = client.indexOf('\n    function clearFailedCheckoutContext', clearStart);
    assert.ok(clearStart >= 0 && clearEnd > clearStart, 'failed-create intent cleanup helper must stay explicit');
    const clearSource = client.slice(clearStart, clearEnd);
    assert.match(clearSource, /checkoutAction: ['"]discard['"]/);
    assert.match(clearSource, /intentId: selector/);

    const createStart = client.indexOf('async function createOrder() {');
    const createEnd = client.indexOf('\n    async function fetchStatus', createStart);
    assert.ok(createStart >= 0 && createEnd > createStart, 'createOrder must stay a standalone function');
    const createSource = client.slice(createStart, createEnd);
    assert.match(createSource, /const definitiveCreateFailure = !unknownResult[\s\S]*DEFINITIVE_CREATE_FAILURE_CODES\.has/);
    assert.match(createSource, /if \(definitiveCreateFailure\) clearFailedCheckoutContext\(attempt\?\.intentId\);/);

    const discardStart = client.indexOf('async function discardPendingCheckoutIntent() {');
    const discardEnd = client.indexOf('\n\n    function', discardStart);
    assert.ok(discardStart >= 0 && discardEnd > discardStart, 'discard handler must stay a standalone function');
    const discardSource = client.slice(discardStart, discardEnd);
    assert.match(discardSource, /await inspectCheckoutIntent\(attempt\?\.context \|\| getPurchaseContext\(\), \{ announce: false \}\)/);
    assert.match(discardSource, /guest_checkout_intent_invalid/);
    assert.match(discardSource, /guest_checkout_intent_missing/);
    assert.match(discardSource, /guest_checkout_intent_expired/);
    assert.match(discardSource, /const refreshed = checkoutIntentId\(state\.pendingCreateAttempt\?\.intentId\)/);
    assert.match(discardSource, /checkoutAction: ['"]discard['"]/);
});

test('Task 2.1 status polling is single-flight and an invalid checkout stays unknown', () => {
    assert.match(client, /statusRequestInFlight: false,/);
    assert.match(client, /statusRequestContext: null,\s*queuedStatusRequest: null,/);
    const pollStart = client.indexOf('async function pollStatus({ immediate = false, resetWindow = false, forceProviderRefresh = false } = {}) {');
    const pollEnd = client.indexOf('\n    function startPolling()', pollStart);
    assert.ok(pollStart >= 0 && pollEnd > pollStart, 'pollStatus must stay a standalone function');
    const pollSource = client.slice(pollStart, pollEnd);
    assert.match(
        pollSource,
        /if \(state\.statusRequestInFlight\) \{\s*const active = state\.statusRequestContext;\s*if \(!active\s*\|\| active\.orderNo !== state\.orderNo\s*\|\| active\.generation !== state\.pollGeneration\s*\|\| \(forceProviderRefresh && !state\.manualStatusRequestInFlight\)\) \{\s*state\.queuedStatusRequest = \{\s*orderNo: state\.orderNo,\s*generation: state\.pollGeneration,\s*forceProviderRefresh: forceProviderRefresh === true\s*\};\s*\}\s*renderGuestActions\(\);\s*return;\s*\}/
    );
    assert.match(
        pollSource,
        /if \(state\.statusRequestInFlight\) \{\s*const active = state\.statusRequestContext;\s*if \(!active\s*\|\| active\.orderNo !== expectedOrderNo\s*\|\| active\.generation !== generation\) \{\s*state\.queuedStatusRequest = \{\s*orderNo: expectedOrderNo,\s*generation,\s*forceProviderRefresh: forceProviderRefreshNext\s*\};\s*\}\s*return;\s*\}/
    );
    assert.match(pollSource, /state\.manualStatusRequestInFlight = forceProviderRefreshNext;\s*const requestContext = \{ orderNo: expectedOrderNo, generation \};\s*state\.pollActiveGeneration = generation;\s*state\.statusRequestInFlight = true;\s*state\.statusRequestContext = requestContext;\s*renderGuestActions\(\);/);
    assert.ok(
        pollSource.indexOf('state.statusRequestInFlight = true;') < pollSource.indexOf('await fetchStatus('),
        'the status lock must be acquired before issuing GET /status'
    );
    assert.match(pollSource, /await fetchStatus\(\{\s*forceRefresh: forceProviderRefreshNext,\s*orderNo: expectedOrderNo\s*\}\);/);
    assert.match(pollSource, /generation !== state\.pollGeneration \|\| state\.orderNo !== expectedOrderNo/);
    assert.match(
        pollSource,
        /finally \{\s*if \(state\.statusRequestContext === requestContext\) \{\s*state\.statusRequestInFlight = false;\s*state\.statusRequestContext = null;\s*const queued = state\.queuedStatusRequest;\s*state\.queuedStatusRequest = null;\s*if \(queued\s*&& queued\.orderNo === state\.orderNo\s*&& queued\.generation === state\.pollGeneration\) \{\s*handoff = queued;\s*\}/
    );
    assert.match(
        pollSource,
        /if \(handoff\) \{\s*shouldContinue = false;\s*void pollStatus\(\{\s*immediate: true,\s*forceProviderRefresh: handoff\.forceProviderRefresh\s*\}\);\s*\}/
    );
    assert.match(client, /function stopPolling\(\) \{[\s\S]*state\.queuedStatusRequest = null;\s*\}/);

    const checkoutStart = client.indexOf('function renderCheckout(checkout, { autoLaunch = false } = {}) {');
    const checkoutEnd = client.indexOf('\n    function selectedPayment()', checkoutStart);
    assert.ok(checkoutStart >= 0 && checkoutEnd > checkoutStart, 'renderCheckout must stay a standalone function');
    const checkoutSource = client.slice(checkoutStart, checkoutEnd);
    assert.match(checkoutSource, /if \(!valid\) \{[\s\S]*state\.checkout = null;[\s\S]*state\.paymentCreationUnknown = true;[\s\S]*'payment_creation_unknown'[\s\S]*return false;/);

    const createStart = client.indexOf('async function createOrder() {');
    const createEnd = client.indexOf('\n    async function fetchStatus', createStart);
    const createSource = client.slice(createStart, createEnd);
    assert.match(createSource, /const checkoutReady = !replayNeedsReview && payload\.checkout[\s\S]*\? renderCheckout\(payload\.checkout, \{ autoLaunch: true \}\)[\s\S]*: false;/);
    assert.match(createSource, /if \(replayNeedsReview\) \{[\s\S]*suppressUnsafeCheckout\(\);[\s\S]*'payment_creation_unknown'[\s\S]*stopPolling\(\);\s*return;/);
    assert.match(createSource, /if \(!checkoutReady && !state\.paymentConfirmed\) \{[\s\S]*state\.paymentCreationUnknown = true;[\s\S]*'payment_creation_unknown'[\s\S]*stopPolling\(\);\s*return;/);

    assert.match(pollSource, /else if \(state\.paymentCreationUnknown\) \{[\s\S]*'payment_creation_unknown'[\s\S]*shouldContinue = false;/);
});

test('Task 2.1 renders payment-driven checkout and order-state actions', () => {
    assert.match(markup, /id="guestCashPurchaseModal"[^>]*hidden[^>]*aria-hidden="true"/);
    assert.match(markup, /id="guestCashPurchaseDialog"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="guestCashPurchaseTitle"/);
    assert.doesNotMatch(markup, /id="guestCashPurchaseDialog"[^>]*aria-describedby=/, 'the removed subtitle must not remain as an accessible description target');
    assert.match(markup, /id="guestCashStorageWarning"[^>]*role="status"[^>]*hidden[^>]*>此浏览器无法暂存订单。请保持当前页面；查询能力开启后可用邮箱 \+ 查询密码继续。</);
    for (const id of [
        'guestCashCheckStatusBtn',
        'guestCashAbandonOrderBtn'
    ]) {
        assert.match(markup, new RegExp(`id="${id}"`), `missing guest order action ${id}`);
    }
    assert.doesNotMatch(markup, /guestCashCreateOrderBtn|guestCashShowRecoveryBtn/);
    assert.match(client, /function handlePaymentOptionClick\(option\) \{[\s\S]*?selectPaymentOption\(option\.key\);[\s\S]*?void createOrder\(\);/);
    assert.doesNotMatch(client, /closest\(['"]#guestCashShowRecoveryBtn['"]\)/);
    assert.doesNotMatch(markup, /guestCashRecoveryPanel|guestCashRecoveryOrderNo|guestCashRecoveryCodeInput/);

    const policyStart = client.indexOf('function deriveGuestActionPolicy(snapshot = state) {');
    const policyEnd = client.indexOf('\n    function applyActionPolicy', policyStart);
    assert.ok(policyStart >= 0 && policyEnd > policyStart, 'deriveGuestActionPolicy must stay a standalone function');
    const policySource = client.slice(policyStart, policyEnd);
    assert.match(policySource, /const canAdoptDetachedCheckout = !hasOrder[\s\S]*Boolean\(snapshot\.detachedCheckout\)[\s\S]*!creating/);
    assert.match(policySource, /const canResumeUnknownCreate = !hasOrder[\s\S]*Boolean\(snapshot\.pendingCreateAttempt\)[\s\S]*snapshot\.paymentCreationUnknown === true \|\| snapshot\.pendingCreateAttempt\?\.unresolved === true[\s\S]*!creating[\s\S]*!inspectingIntent/);
    assert.match(policySource, /const canQuery = hasOrder[\s\S]*!delivered[\s\S]*status !== 'configure'/);
    assert.match(policySource, /const canLeaveOrder = hasOrder[\s\S]*\['awaiting_payment', 'checking', 'payment_creation_unknown'\]\.includes\(status\)[\s\S]*!snapshot\.paymentConfirmed/);
    assert.doesNotMatch(policySource, /dismiss:/);
    assert.match(policySource, /const canRestartTerminalOrder = isRestartableTerminalOrder\(snapshot\);/);
    assert.match(policySource, /query: \{[\s\S]*visible: canQuery,[\s\S]*disabled: manuallyChecking \|\| snapshot\.claimInFlight === true,[\s\S]*busy: manuallyChecking/);
    assert.match(policySource, /abandon: \{[\s\S]*visible: canLeaveOrder,[\s\S]*disabled: !\['awaiting_payment', 'checking', 'payment_creation_unknown'\]\.includes\(status\)[\s\S]*busy: snapshot\.cancelRequestInFlight === true,[\s\S]*label: '取消订单'/);
    assert.match(policySource, /const unresolvedLocalCreate = Boolean\(snapshot\.detachedCheckout\)[\s\S]*snapshot\.pendingCreateAttempt[\s\S]*snapshot\.paymentCreationUnknown === true[\s\S]*snapshot\.pendingCreateAttempt\?\.unresolved === true/);

    const openStart = client.indexOf('function openGuestModal(');
    const openEnd = client.indexOf('\n    function closeGuestModal()', openStart);
    const openSource = client.slice(openStart, openEnd);
    assert.match(openSource, /if \(!state\.orderNo && state\.detachedCheckout\) \{[\s\S]*hydrateCheckout\(detached\);[\s\S]*context = null;/);

    assert.doesNotMatch(client, /async function recoverOrder\s*\(/);

    const applyStart = client.indexOf('function applyActionPolicy(buttonId, policy');
    const applyEnd = client.indexOf('\n    function syncConfigureControls()', applyStart);
    const applySource = client.slice(applyStart, applyEnd);
    assert.match(applySource, /setHidden\(buttonId, !policy\.visible\)/);
    assert.match(applySource, /button\.disabled = Boolean\(policy\.disabled\)/);
    assert.match(applySource, /button\.setAttribute\('aria-disabled', policy\.disabled \? 'true' : 'false'\)/);
    assert.match(applySource, /button\.setAttribute\('aria-busy', policy\.busy \? 'true' : 'false'\)/);

    assert.match(client, /function renderGuestActions\(\) \{\s*const policy = deriveGuestActionPolicy\(\);[\s\S]*policy\.query[\s\S]*policy\.abandon/);
    assert.match(client, /checkoutAction: 'discard'/u);
    assert.match(guestShopHandler, /const GUEST_CHECKOUT_INTENT_ACTIONS = new Set\(\['prepare', 'inspect', 'commit', 'ack', 'discard'\]\)/u);
    assert.match(guestShopHandler, /discard: new Set\(\['checkoutAction', 'intentId'\]\)/u);
    assert.match(guestShopHandler, /async function discardCheckoutIntent\(req, res, body\)/u);
    assert.match(client, /const hasVisibleAction = policy\.query\.visible \|\| policy\.abandon\.visible;\s*setHidden\('guestCashActionFooter', !hasVisibleAction\);/);
    assert.doesNotMatch(client, /setStateMessage\('正在检查未完成订单\.\.\.', 'configure'\)/);
    assert.doesNotMatch(client, /setStateMessage\('正在确认商品信息\.\.\.', 'configure'\)/);
    assert.doesNotMatch(client, /guestCashPurchaseCloseBtn|guestCashPurchaseDismissBtn|guestCashDismissHint|policy\.dismiss|稍后处理|关闭已发货内容/);
    assert.match(client, /function handleGuestModalKeydown\(event\) \{[\s\S]*event\.key === 'Escape'[\s\S]*closeGuestModal\(\)[\s\S]*event\.key !== 'Tab'[\s\S]*focusable/);
    assert.match(client, /function focusGuestModal\(\) \{[\s\S]*modalFocusableElements\(\)[\s\S]*first\.focus\(\)/);
    assert.match(client, /document\.addEventListener\('keydown', handleGuestModalKeydown\)/);
    assert.match(client, /modal\.setAttribute\('aria-hidden', 'false'\)/);
    assert.match(client, /modal\.setAttribute\('aria-hidden', 'true'\)/);
    assert.match(client, /function noteSessionStorageUnavailable\(\) \{[\s\S]*state\.sessionStorageUnavailable = true;[\s\S]*syncSessionStorageWarning\(\);/);
    assert.match(client, /function syncSessionStorageWarning\(\) \{[\s\S]*guestCashStorageWarning/);
    assert.match(client, /state\.buyerCredentialRequired[\s\S]*请保存下单邮箱和查询密码[\s\S]*请保持当前页面；查询能力开启后可用邮箱 \+ 查询密码继续/);
    assert.doesNotMatch(client, /syncGuestOrdersLink|guestCashShowRecoveryBtn/);
    assert.match(styles, /\.guest-shop-modal__field\[hidden\] \{ display: none !important; \}/);
    assert.match(styles, /\.guest-shop-modal__actions > \.shop-btn\[hidden\] \{ display: none !important; \}/);
    assert.match(styles, /@media \(max-width: 600px\) \{[\s\S]*\.guest-shop-modal__actions \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(styles, /#guestCashOrderNo \{[^}]*font-size: 12px/);
    assert.match(styles, /\.guest-shop-modal__summary-row strong \{[^}]*font-size: 12px[^}]*letter-spacing: \.015em/);
    assert.match(styles, /#guestCashAbandonOrderBtn \{[^}]*background: rgba\(239,68,68/);
    assert.match(styles, /\.guest-shop-modal__step\[data-step-key="configure"\] \.guest-shop-modal__step-index/);
    assert.match(styles, /\.guest-shop-modal__step\[data-step-key="payment"\] \.guest-shop-modal__step-index/);
    assert.match(styles, /\.guest-shop-modal__step\[data-step-key="delivery"\] \.guest-shop-modal__step-index/);
});

test('guest delivery is claim-gated by confirmed payment and delivered fulfillment', () => {
    assert.match(
        client,
        /paymentStatus === ['"]confirmed['"] && fulfillmentStatus === ['"]delivered['"][\s\S]*await claimDelivery\(generation, expectedOrderNo\)/
    );
    assert.match(client, /CLAIM_ENDPOINT[\s\S]*method:\s*['"]POST['"][\s\S]*credentials:\s*['"]same-origin['"]/);
    assert.match(client, /renderDeliveredContent\(isBatchOrder\(orderNo\)[\s\S]*?batchDeliveryContent\(payload\.items\)[\s\S]*?payload\.content \|\| ['"]['"]\)/);
    assert.match(client, /function groupBatchDeliveryItems\(items\)/);
    assert.match(client, /product_name \|\| item\?\.productName/);
    assert.match(client, /guest-shop-modal__delivery-group/);
    assert.match(client, /function batchDeliveryCopyText\(items\)/);
    assert.match(styles, /\.guest-shop-modal__delivery-group-heading/);
    assert.match(styles, /\.guest-shop-modal__delivery-group-items/);
    assert.doesNotMatch(client, /innerHTML\s*=\s*[^;]*payload\.content/);
    const claimStart = client.indexOf('async function claimDelivery(');
    const claimEnd = client.indexOf('\n    function calculateSmartPollInterval', claimStart);
    assert.ok(claimStart >= 0 && claimEnd > claimStart, 'claimDelivery must stay a standalone function');
    const claimSource = client.slice(claimStart, claimEnd);
    assert.match(claimSource, /expectedGeneration = state\.pollGeneration,[\s\S]*expectedOrderNo = state\.orderNo/);
    assert.match(claimSource, /expectedGeneration !== state\.pollGeneration \|\| state\.orderNo !== orderNo/);
    assert.match(claimSource, /clearStoredCheckoutAfterAcknowledgement\(\)/);
    assert.doesNotMatch(claimSource, /persistCheckout\(\)/);
    assert.match(markup, /<div id="guestCashDeliveredContent"[^>]*role="list"/);
});

test('delivered guest orders clear their resumable handle when the modal closes', () => {
    assert.match(client, /function clearCompletedCheckout\(\)/);
    assert.match(client, /function clearCompletedCheckout\(\)[\s\S]*state\.orderNo = ['"]['"][\s\S]*state\.status = ['"]configure['"][\s\S]*resetOrderUi\(\)/);
    assert.match(client, /function clearCompletedCheckout\(\)[\s\S]*clearStoredCheckout\(\)/);
    const closeStart = client.indexOf('function closeGuestModal() {');
    const closeEnd = client.indexOf('\n    function clearCompletedCheckout()', closeStart);
    assert.ok(closeStart >= 0 && closeEnd > closeStart, 'closeGuestModal must stay a standalone function');
    const closeSource = client.slice(closeStart, closeEnd);
    assert.match(closeSource, /state\.status === 'delivered'[\s\S]*clearCompletedCheckout\(\)/);
    assert.match(closeSource, /state\.status === 'delivered'[\s\S]*!state\.deliveryCopied[\s\S]*发货内容尚未复制/);
    assert.doesNotMatch(closeSource, /recoveryCode|recovery_code|取货口令/);
    assert.match(client, /setStateMessage\('', 'delivered'\)[\s\S]*clearStoredCheckoutAfterAcknowledgement\(\)/);
    assert.doesNotMatch(client, /支付已确认，订单已发货。/);
    assert.match(client, /async function maybeRestoreReturn\(\)[\s\S]*const restoredOrderNo = state\.orderNo[\s\S]*state\.orderNo !== restoredOrderNo/);
    assert.match(client, /restoredOrder\.payment_status[\s\S]*restoredOrder\.fulfillment_status[\s\S]*clearCompletedCheckout\(\)/);
});

test('terminal guest orders require a payment-option click before a replacement order', () => {
    assert.doesNotMatch(markup, /guestCashCreateOrderBtn|guestCashTerminalRestartHint/);

    const terminalStart = client.indexOf('function isRestartableTerminalOrder(snapshot = state) {');
    const terminalEnd = client.indexOf('\n    function deriveGuestActionPolicy', terminalStart);
    assert.ok(terminalStart >= 0 && terminalEnd > terminalStart, 'terminal restart predicate must stay isolated');
    const terminalSource = client.slice(terminalStart, terminalEnd);
    for (const status of ['failed', 'expired', 'refunded', 'chargeback', 'cancelled', 'canceled', 'amount_mismatch', 'overpaid', 'partial']) {
        assert.match(terminalSource, /TERMINAL_PAYMENT_STATUSES\.has\(status\)/, `${status} must use the terminal allowlist`);
        assert.match(client, new RegExp(`['\"]${status}['\"]`), `missing terminal status ${status}`);
    }
    assert.match(terminalSource, /fulfillmentStatus !== 'delivered'/);
    assert.match(terminalSource, /snapshot\.requestInFlight !== true[\s\S]*snapshot\.statusRequestInFlight !== true[\s\S]*snapshot\.claimInFlight !== true[\s\S]*snapshot\.paymentCreationUnknown !== true/);

    const resetStart = client.indexOf('function returnTerminalOrderToConfiguration() {');
    const resetEnd = client.indexOf('\n    function showOrderNo', resetStart);
    assert.ok(resetStart >= 0 && resetEnd > resetStart, 'terminal reset must stay a standalone local transition');
    const resetSource = client.slice(resetStart, resetEnd);
    assert.match(resetSource, /isRestartableTerminalOrder\(\)/);
    assert.doesNotMatch(resetSource, /recoveryCode|recovery_code|取货口令/);
    assert.match(resetSource, /clearStoredCheckout\(\)[\s\S]*state\.orderNo = ['"]['"][\s\S]*state\.checkoutIntentId = ['"]['"]/);
    assert.match(resetSource, /不会取消服务端订单或立即释放库存。旧付款码不可再付/);
    assert.match(resetSource, /previousContextKey !== context\.contextKey[\s\S]*resetPromoSelection\(\)/);
    assert.match(resetSource, /state\.preview = null[\s\S]*invalidatePreviewQuote\(\)[\s\S]*void loadPreview\(context\)/);
    assert.doesNotMatch(resetSource, /ORDER_ENDPOINT|requestJson\(|fetch\s*\(/);

    assert.match(client, /function handlePaymentOptionClick\(option\) \{[\s\S]*if \(isRestartableTerminalOrder\(\)\) \{\s*returnTerminalOrderToConfiguration\(\);\s*return;\s*\}/);
    assert.match(client, /const CANCEL_ENDPOINT = ['"]\/api\/shop\/guest\/cancel['"];/);
    assert.match(client, /requestJson\(isBatchOrder\(orderNo\) \? BATCH_CANCEL_ENDPOINT : CANCEL_ENDPOINT,[\s\S]*method: 'POST'/);
});

test('payment return markers only restore an order handle and do not unlock delivery', () => {
    assert.match(client, /readReturnOrderNo\(\)/);
    assert.match(client, /saved && saved\.orderNo === returnOrderNo/);
    assert.match(client, /else hydrateReturnOrderNo\(returnOrderNo\)/);
    assert.match(client, /void pollStatus\(\{ immediate: true \}\)/);
    assert.doesNotMatch(client, /readReturnOrderNo\(\)[\s\S]{0,300}(?:claimDelivery|setText\(['"]guestCashDeliveredContent)/);
});

test('payment return can recover in a fresh tab without persisting a claim secret', () => {
    assert.match(client, /function hydrateReturnOrderNo\(orderNo\)/);
    assert.match(client, /if \(saved && saved\.orderNo === returnOrderNo\) hydrateCheckout\(saved\);[\s\S]*else hydrateReturnOrderNo\(returnOrderNo\)/);
    assert.match(client, /openGuestModal\(null\);[\s\S]*回跳页面不会直接视为支付成功/);
    assert.match(client, /server-side claim cookie|HttpOnly proof cookie/);
    assert.doesNotMatch(client, /sessionStorage\.setItem\([\s\S]*returnOrderNo/);
    assert.match(
        client,
        /if \(payload\?\.checkout\s*&& !state\.checkout\s*&& displayStatus !== 'payment_creation_unknown'\s*&& !TERMINAL_PAYMENT_STATUSES\.has\(displayStatus\)\) \{\s*renderCheckout\(payload\.checkout\);\s*\}/
    );
});

test('polling remains recoverable after transient fulfilment lag and manual retry resets its window', () => {
    assert.match(client, /paymentStatus === ['"]confirmed['"] && fulfillmentStatus === ['"]delivered['"][\s\S]*await claimDelivery\(generation, expectedOrderNo\)[\s\S]*shouldContinue = state\.status === ['"]checking['"]/);
    assert.match(client, /void pollStatus\(\{ immediate: true, resetWindow: true, forceProviderRefresh: true \}\)/);
    assert.match(client, /pollGeneration/);
    assert.match(client, /generation !== state\.pollGeneration/);
    assert.match(client, /if \(generation !== state\.pollGeneration \|\| state\.orderNo !== expectedOrderNo\) return;/);
    assert.match(client, /\} catch \(error\) \{[\s\S]*if \(generation !== state\.pollGeneration \|\| state\.orderNo !== expectedOrderNo\) return;[\s\S]*guest_claim_invalid/);
    assert.match(client, /当前设备的取货凭证不可用，请勿重复付款/);
});

test('confirmed payments poll fulfilment faster while unpaid orders keep the normal interval', () => {
    assert.match(client, /const POLL_INTERVAL_MS = 3500/);
    assert.match(client, /const CONFIRMED_FULFILLMENT_POLL_INTERVAL_MS = 1000/);
    assert.match(client, /calculateSmartPollInterval/);
    assert.match(
        client,
        /if \(state\.smartPollingEnabled\)[\s\S]*calculateSmartPollInterval/
    );
    assert.match(client, /window\.setTimeout\(run, nextPollIntervalMs\)/);
    // A failed/transient status request falls back to the ordinary interval;
    // it must not create a tight retry loop or a second modal flow.
    assert.match(client, /let nextPollIntervalMs = POLL_INTERVAL_MS/);

    const intervals = parseSmartPollIntervals(client);
    const statusLimitPerMinute = parseStatusRateLimitPerMinute(guestShopHandler);
    const confirmedStates = [
        'FULFILLING',
        'PAYMENT_JUST_CONFIRMED',
        'PAYMENT_CONFIRMED_EARLY',
        'PAYMENT_CONFIRMED_LATE'
    ];
    for (const key of confirmedStates) {
        assert.ok(Number.isFinite(intervals[key]), `${key} interval must exist`);
        // One buyer must fit inside the shared per-IP status budget while polling
        // the confirmed window.  Exceeding it turns delivery into 429s plus the
        // 3.5s error retry, which is slower than polling calmly.
        assert.ok(
            Math.ceil(60000 / intervals[key]) <= statusLimitPerMinute,
            `${key}=${intervals[key]}ms needs ${Math.ceil(60000 / intervals[key])}/min `
            + `but the status endpoint allows ${statusLimitPerMinute}/min per IP`
        );
        assert.ok(
            intervals[key] < intervals.AWAITING_PAYMENT,
            `${key} must poll faster than an unpaid order`
        );
    }
    assert.equal(intervals.AWAITING_PAYMENT, 3500);
    assert.ok(intervals.THROTTLED_HINT >= 5000, 'a backend throttle hint must back off to at least 5s');
    assert.ok(
        intervals.FULFILLING <= intervals.PAYMENT_CONFIRMED_LATE,
        'active fulfilment must not poll slower than the late confirmed window'
    );
});

test('terminal fulfilment failures stop tight polling and show an actionable state', () => {
    assert.match(
        client,
        /paymentStatus === ['"]confirmed['"] && fulfillmentStatus === ['"]paid_unfulfillable['"][\s\S]*正在处理退款或人工补发[\s\S]*shouldContinue = false/
    );
    assert.match(
        client,
        /paymentStatus === ['"]confirmed['"] && fulfillmentStatus === ['"]dead_letter['"][\s\S]*已转人工处理[\s\S]*shouldContinue = false/
    );
    assert.match(client, /fulfillmentStatus === ['"]failed['"][\s\S]*发货正在重试/);
    assert.match(client, /\['pending', 'fulfilling'\]\.includes\(fulfillmentStatus\)/);
});

test('manual status check forces a live provider query while background polling does not', () => {
    assert.match(client, /async function fetchStatus\(\{ forceRefresh = false, orderNo = state\.orderNo \} = \{\}\)/);
    assert.match(client, /if \(forceRefresh\) query\.set\('force_provider_refresh', '1'\)/);
    assert.match(client, /async function pollStatus\(\{ immediate = false, resetWindow = false, forceProviderRefresh = false \} = \{\}\)/);
    assert.match(client, /let forceProviderRefreshNext = forceProviderRefresh === true/);
    assert.match(client, /fetchStatus\(\{\s*forceRefresh: forceProviderRefreshNext,\s*orderNo: expectedOrderNo\s*\}\)/);
    assert.match(client, /forceProviderRefreshNext = false/);
    assert.match(
        client,
        /const statusButton = target\.closest\('#guestCashCheckStatusBtn'\);[\s\S]*?setStateMessage\([\s\S]*?正在查询支付状态，请稍候\.\.\.[\s\S]*?pollStatus\(\{ immediate: true, resetWindow: true, forceProviderRefresh: true \}\)/,
        'manual status checks must show immediate feedback before polling'
    );
    // The automatic poll path stays non-forced so it cannot bypass the server throttle.
    assert.match(client, /void pollStatus\(\{ immediate: true \}\)/);
});

test('switching product or SKU cannot reuse the previous guest order context', () => {
    assert.match(client, /function resetActiveOrderForContext\(context\)/);
    assert.match(
        client,
        /resetActiveOrderForContext\(context\);[\s\S]*state\.contextKey = context\.contextKey/
    );
    assert.match(client, /state\.contextKey = state\.productId && state\.skuId/);
    assert.match(client, /resetActiveOrderForContext[\s\S]*stopPolling\(\)[\s\S]*state\.orderNo = ['"]['"]/);
    assert.match(client, /resetActiveOrderForContext[\s\S]*resetOrderUi\(\)/);
});

test('created guest orders surface the non-secret order number in the existing summary', () => {
    assert.match(markup, /id="guestCashOrderNoRow"[^>]*class="guest-shop-modal__summary-row"/);
    assert.match(markup, /id="guestCashOrderNo"/);
    assert.match(client, /function showOrderNo\(orderNo\)/);
    assert.match(client, /showOrderNo\(orderNo\)/);
    assert.match(client, /showOrderNo\(state\.orderNo\)/);
});

test('the payment modal never displays or handles the legacy pickup-code recovery flow', () => {
    // A new order is queried through the standalone credential-first page.
    // Claim proof remains an internal fulfillment mechanism only; no secret is
    // rendered, copied, persisted, or sent by this payment modal.
    assert.doesNotMatch(markup, /guestCashRecovery(CodePanel|Panel)|guestCashRecoveryCode|口令只显示一次/);
    assert.doesNotMatch(client, /RECOVERY_ENDPOINT|showRecoveryCode|recoveryCode|recovery_code|guestCashRecover/);
    assert.doesNotMatch(markup, /guestCashShowRecoveryBtn/);
    const persistStart = client.indexOf('function persistCheckoutRecord(record)');
    const persistEnd = client.indexOf('\n    function hydrateCheckout', persistStart);
    assert.ok(persistStart >= 0 && persistEnd > persistStart, 'checkout persistence must stay isolated');
    const persistedCheckout = client.slice(persistStart, persistEnd);
    assert.doesNotMatch(persistedCheckout, /recoveryCode|recovery_code|claim/i);
    assert.doesNotMatch(client, /body:\s*JSON\.stringify\(\{\s*orderNo,\s*recoveryCode\s*\}\)/);
    const eyebrowStart = styles.indexOf('.guest-shop-modal__eyebrow');
    assert.ok(eyebrowStart >= 0, 'guest checkout eyebrow must reuse shop styles');
    const eyebrowRule = styles.slice(eyebrowStart, styles.indexOf('}', eyebrowStart) + 1);
    assert.doesNotMatch(eyebrowRule, /text-transform:\s*uppercase/);
    assert.match(markup, /class="modal-content premium-modal guest-shop-modal__content"/);
    assert.match(markup, /class="shop-btn shop-btn-primary"/);
    assert.match(markup, /class="shop-btn shop-btn-secondary"/);
    assert.doesNotMatch(guestCheckoutModalMarkup(), /无需登录|游客购买/, 'the confirmation dialog must not repeat guest-only messaging');
    assert.doesNotMatch(markup, /Guest checkout/);
    assert.match(markup, /应付金额/);
    assert.match(client, /function formatAmount\(amount\)/);
    assert.match(client, /style:\s*'currency',\s*currency:\s*'CNY'/);
    assert.doesNotMatch(client, /currency:\s*'USD'/);
});

test('guest ZPay checkout hosts an in-page Alipay QR and hands mobile buyers to the Alipay app', () => {
    const guestModalStart = markup.indexOf('id="guestCashPurchaseModal"');
    const guestModalEnd = markup.indexOf('<div class="modal-overlay" id="shopCartCheckoutModal">', guestModalStart);
    assert.ok(guestModalStart >= 0 && guestModalEnd > guestModalStart, 'guest cash modal markup must exist');
    const guestModal = markup.slice(guestModalStart, guestModalEnd);
    assert.doesNotMatch(guestModal, /id="guestCashCheckoutLink"/);
    assert.doesNotMatch(guestModal, /打开支付页面/);
    assert.doesNotMatch(guestModal, /target="_blank"/);
    assert.match(markup, /id="guestCashZpayQrImage"[^>]*class="guest-shop-modal__qr-image"/);
    assert.match(markup, /id="guestCashZpayCountdown"[^>]*class="guest-shop-modal__state-countdown"/);
    assert.match(markup, /id="guestCashStateMessage"/);
    assert.match(markup, /付款剩余 <\/span><strong id="guestCashZpayCountdownValue"/);
    assert.match(client, /const visibleMessage = active && !state\.stateMessage\.startsWith\('查询完成：'\)/);
    assert.match(client, /付款剩余 \$\{state\.zpayCountdownText\}/);
    assert.doesNotMatch(guestModal, /guestCashZpayOpenBtn|打开支付宝支付|请使用支付宝扫码支付/);
    assert.match(markup, /guestPayableFee=20260916_GUEST_PAYABLE_FEE_2/);
    assert.match(markup, /guestDeliveryLightTheme=20260929_GUEST_DELIVERY_LIGHT_THEME_1/);
    assert.match(markup, /js\/guest-shop-client\.js\?v=20260917_GUEST_POLL_RATE_LIMIT_SAFE_1/);
    // Asserted as an independent marker (same convention as the
    // `guestOrderAccess` marker below) so adding or reordering cache-buster
    // params never silently invalidates the entry-merge release pin.
    assert.match(markup, /guestEntryMerge=20260917_GUEST_ENTRY_MERGE_1/);

    assert.match(styles, /\.guest-shop-modal__qr-card/);
    assert.match(styles, /\.guest-shop-modal__state-countdown/);
    assert.match(styles, /\.guest-shop-modal__state-countdown\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
    assert.match(styles, /\.guest-shop-modal__qr-image/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) body\.shop-page \.guest-shop-modal__qr-card/);
    assert.doesNotMatch(markup, /href="css\/wallet\.css/);

    assert.match(client, /function checkoutDetails\(checkout\)/);
    assert.match(client, /qrcodeUrl:\s*safePaymentUrl\(source\.qrcode_url \|\| source\.qrcodeUrl\)/);
    assert.match(client, /qrcodeImageUrl:\s*safePaymentUrl\(source\.qrcode_image_url \|\| source\.qrcode_img_url \|\| source\.qrcodeImageUrl\)/);
    assert.match(client, /function isHostedPaymentQrDesktopLayout\(\)/);
    assert.match(client, /function isMobileAlipayHandoff\(\)/);
    assert.match(client, /return isMobilePaymentBrowser\(\) && !isHostedPaymentQrDesktopLayout\(\);/);
    assert.match(client, /function presentZpayHostedQr\(details, \{ autoLaunch = false, qrRetryAttempt = 0 \} = \{\}\)/);
    assert.match(client, /image\.onerror = \(\) => \{[\s\S]*二维码图片加载失败[\s\S]*setZpayStatus\('二维码暂时无法加载，请刷新页面或稍后重试。', 'error'\)/);
    assert.doesNotMatch(client, /guestCashZpayOpenBtn|zpayOpenButton|desktopUrl/);
    assert.match(client, /function startZpayCountdown\(\)/);
    assert.match(client, /function buildQrImageUrl\(data, size = 240\)/);
    assert.match(client, /hostname === 'localhost'[\s\S]*url\.pathname === '\/'[\s\S]*opaque token[\s\S]*return false;/);
    assert.doesNotMatch(client, /comparable\.toLowerCase\(\)\.includes\(orderReference\)/);
    assert.match(client, /const qrSource = qrcodeUrl \|\| \(isImageLikeUrl\(checkoutUrl\) \? '' : checkoutUrl\);\s*const localQrImageUrl = buildQrImageUrl\(qrSource\);[\s\S]*?const hostedImageUrl = localQrImageUrl/);
    assert.match(client, /const orderScopedQr = Boolean\(/);
    assert.match(client, /Boolean\(state\.batchMode \? orderScopedQr : \(orderScopedQr \|\| directImageFallback\)\)/);
    assert.match(client, /!state\.batchMode && !qrSource && !isLikelyQrPlaceholder\(details\.qrcodeImageUrl\)/);
    assert.match(client, /scheduleZpayQrRetry\(details, \{ autoLaunch, attempt: qrRetryAttempt \}\)/);
    assert.match(client, /alipays:\/\/platformapi\/startapp\?appId=20000067&url=/);
    assert.match(client, /window\.location\.href = launchUrl/);
    assert.match(client, /if \(autoLaunch && launchUrl && state\.orderNo && state\.mobileAlipayHandoffOrderNo !== state\.orderNo\)[\s\S]*state\.mobileAlipayHandoffOrderNo = state\.orderNo;[\s\S]*window\.location\.href = launchUrl/);
    assert.match(client, /renderCheckout\(payload\.checkout, \{ autoLaunch: true \}\)/);
    assert.match(client, /setHidden\('guestCashConfigurePanel', true\)/);
    assert.match(client, /presentZpaySuccess\(\)/);
    assert.doesNotMatch(client, /window\.open\s*\(/);
    assert.doesNotMatch(client, /location\.assign\s*\(/);
    assert.doesNotMatch(client, /guestCashCheckoutLink/);
    assert.doesNotMatch(client, /不要在电脑浏览器打开支付宝链接[\s\S]{0,80}window\.location/);
});

test('unpaid guest orders require a server cancellation before local cleanup', () => {
    assert.doesNotMatch(markup, /id="guestCashPurchaseCloseBtn"|id="guestCashPurchaseDismissBtn"|id="guestCashDismissHint"|稍后处理|关闭已发货内容/);
    assert.match(client, /if \(target === getModal\(\)\)/);
    assert.match(client, /event\.key === 'Escape'[\s\S]*closeGuestModal\(\)/);
    assert.match(markup, /id="guestCashAbandonOrderBtn"[^>]*class="shop-btn shop-btn-secondary"/);
    assert.match(markup, /id="guestCashAbandonOrderBtn"[^>]*hidden/);
    assert.match(markup, /id="guestCashAbandonOrderBtn"[^>]*>取消订单</);
    assert.doesNotMatch(markup, /id="guestCashAbandonOrderBtn"[^>]*>关闭当前订单</);
    assert.doesNotMatch(markup, /guestCashAbandonOrderHint|此操作仅离开当前订单页面，不会取消服务端订单，也不会立即释放库存；离开后请勿再支付旧付款码/);
    assert.match(styles, /\.guest-shop-modal__actions > \.shop-btn\[hidden\] \{ display: none !important; \}/);
    assert.match(markup, /guestPayableFee=20260916_GUEST_PAYABLE_FEE_2/);
    assert.match(markup, /js\/guest-shop-client\.js\?v=20260917_GUEST_POLL_RATE_LIMIT_SAFE_1/);
    // Asserted as an independent marker (same convention as the
    // `guestOrderAccess` marker below) so adding or reordering cache-buster
    // params never silently invalidates the entry-merge release pin.
    assert.match(markup, /guestEntryMerge=20260917_GUEST_ENTRY_MERGE_1/);
    assert.match(markup, /css\/shop-page\.css[^\"]*guestTask21=20260919_GUEST_TASK_2_1_P0_AB_PARTIAL_2/);
    assert.match(markup, /js\/guest-shop-client\.js[^\"]*guestTask21=20260920_GUEST_TASK_2_1_TERMINAL_RESTART_1/);

    assert.match(client, /function clearStoredCheckout\(\)/);
    assert.match(client, /function isAbandonableOrder\(\)/);
    assert.match(client, /async function abandonCurrentOrder\(\)/);
    assert.match(client, /storage\.removeItem\(STORAGE_KEY\)/);
    assert.match(client, /function abandonCurrentOrder\(\)[\s\S]*clearStoredCheckout\(\)/);
    assert.match(client, /function abandonCurrentOrder\(\)[\s\S]*state\.checkoutIntentId = ['"]['"]/);
    assert.match(client, /function isAbandonableOrder\(\)[\s\S]*\['awaiting_payment', 'checking', 'payment_creation_unknown'\]\.includes\(state\.status\)/);
    assert.match(client, /function isAbandonableOrder\(\)[\s\S]*state\.paymentConfirmed/);
    assert.match(client, /当前订单已确认付款或已发货，不能取消/);
    assert.match(client, /服务端会立即释放库存并作废旧付款码/);
    assert.doesNotMatch(client, /unsavedRecoveryWarning|recoveryCodeCopied|取货口令尚未复制或保存/);
    assert.match(client, /target\.closest\(['"]#guestCashAbandonOrderBtn['"]\)/);
    assert.doesNotMatch(client, /guestCashPurchaseCloseBtn|guestCashPurchaseDismissBtn|guestCashDismissHint|policy\.dismiss|稍后处理|关闭已发货内容/);

    assert.match(client, /const CANCEL_ENDPOINT = ['"]\/api\/shop\/guest\/cancel['"];/);
    assert.match(client, /requestJson\(isBatchOrder\(orderNo\) \? BATCH_CANCEL_ENDPOINT : CANCEL_ENDPOINT,[\s\S]*method: 'POST'/);
    assert.match(client, /state\.cancelRequestInFlight = true;[\s\S]*invalidateView\(\);[\s\S]*stopPolling\(\);/);
    assert.doesNotMatch(client, /window\.open\s*\(/);
    assert.doesNotMatch(markup, /id="guestCashCheckoutLink"/);
    assert.doesNotMatch(client, /guestCashCheckoutLink/);
});

test('guest payment QR omits the static waiting label', () => {
    assert.match(markup, /id="guestCashZpayStatus"[^>]*role="status"[^>]*hidden[^>]*><\/div>/);
    assert.match(client, /setZpayStatus\('', 'info'\);/);
    assert.doesNotMatch(client, /setZpayStatus\('等待付款', 'info'\)/);
});

test('payment countdown cannot leak into cancellation or a fresh create attempt', () => {
    const countdownStart = client.indexOf('function syncPaymentCountdownState() {');
    const countdownEnd = client.indexOf('\n    function stopZpayCountdown()', countdownStart);
    assert.ok(countdownStart >= 0 && countdownEnd > countdownStart, 'countdown renderer must stay isolated');
    const countdownSource = client.slice(countdownStart, countdownEnd);
    assert.match(countdownSource, /state\.status === 'awaiting_payment'[\s\S]*Boolean\(state\.orderNo\)[\s\S]*provider \|\| state\.checkout\?\.provider[\s\S]*=== 'zpay'/);
    assert.match(countdownSource, /if \(valueEl && !active\) valueEl\.textContent = '';/);

    const cancelStart = client.indexOf('async function abandonCurrentOrder() {');
    const cancelEnd = client.indexOf('\n    function returnTerminalOrderToConfiguration()', cancelStart);
    assert.ok(cancelStart >= 0 && cancelEnd > cancelStart, 'cancellation must stay isolated');
    const cancelSource = client.slice(cancelStart, cancelEnd);
    assert.match(cancelSource, /state\.cancelRequestInFlight = true;[\s\S]*stopZpayCountdown\(\);[\s\S]*setStateMessage\('正在取消订单并释放库存\.\.\.', 'awaiting_payment'\)/);

    const createStart = client.indexOf('async function createOrder() {');
    const createEnd = client.indexOf('\n    async function fetchStatus', createStart);
    assert.ok(createStart >= 0 && createEnd > createStart, 'create flow must stay isolated');
    const createSource = client.slice(createStart, createEnd);
    assert.match(createSource, /当前商品不支持游客购买'[\s\S]*return;[\s\S]*stopZpayCountdown\(\);[\s\S]*state\.requestInFlight = true;/);
});

test('guest checkout auto-adds a 1% channel fee to Alipay and USDT payable amounts', () => {
    assert.match(markup, /id="guestCashProductAmount"/);
    assert.match(markup, /id="guestCashFeeRow"[^>]*hidden/);
    assert.match(markup, /id="guestCashFeeLabel"[^>]*>通道手续费</);
    assert.match(markup, /id="guestCashFeeAmount"/);
    assert.match(markup, /class="guest-shop-modal__amount-header"[\s\S]*id="guestCashAmountLabel"[\s\S]*id="guestCashPrice"/);
    assert.match(styles, /\.guest-shop-modal__amount-header[\s\S]*display: flex[\s\S]*justify-content: space-between/);
    assert.match(markup, /应付金额/);
    assert.match(markup, /guestPayableFee=20260916_GUEST_PAYABLE_FEE_2/);
    assert.match(markup, /js\/guest-shop-client\.js\?v=20260917_GUEST_POLL_RATE_LIMIT_SAFE_1/);
    // Asserted as an independent marker (same convention as the
    // `guestOrderAccess` marker below) so adding or reordering cache-buster
    // params never silently invalidates the entry-merge release pin.
    assert.match(markup, /guestEntryMerge=20260917_GUEST_ENTRY_MERGE_1/);

    assert.match(client, /function paymentProviderSummary\(provider\)/);
    assert.match(client, /const fallbackRate = \(key === ['"]zpay['"] \|\| key === ['"]nowpayments['"]\) \? 0\.01 : 0;/);
    assert.match(client, /const parsedRate = normalizeSurchargeRate\(summary\?\.surcharge_rate, fallbackRate\)/);
    assert.match(client, /surcharge_rate:\s*parsedRate > 0 \? parsedRate : fallbackRate/);
    assert.match(client, /function computePreviewPricing\(\)/);
    assert.match(client, /roundUpMoneyAmount\(baseAmount \* summary\.surcharge_rate\)/);
    assert.match(client, /setAmountValue\(['"]guestCashPrice['"], formatAmount\(pricing\?\.payableAmount\), \{ loading: amountLoading \}\)/);
    assert.match(client, /setHidden\(['"]guestCashFeeRow['"], !\(surchargeAmount > 0\)\)/);
    assert.doesNotMatch(client, /surcharge_rate:\s*normalizeSurchargeRate\(summary\?\.surcharge_rate, fallbackRate\)/);
});

test('guest checkout confirmation uses concise copy and accessible capsule payment options in light theme', () => {
    const modal = guestCheckoutModalMarkup();
    for (const removedCopy of [
        '游客购买',
        '无需登录',
        '选择支付方式后创建订单，支付完成会自动核验并展示发货内容。',
        '请设置一个只用于查询本站订单的密码，不要使用你在其他网站常用的密码。再次购买时请填写上次设置的查询密码；如果忘记了，直接设置一个新密码即可，原订单仍用原密码查询。',
        '支付完成后，页面会自动核验支付回调并展示发货内容。回跳页面本身不会被视为支付成功。',
        '请选择支付方式并创建订单'
    ]) {
        assert.ok(!modal.includes(removedCopy), `confirmation dialog should not include removed copy: ${removedCopy}`);
    }

    assert.match(modal, /<h3 id="guestCashPurchaseTitle" class="card-title guest-shop-modal__title-sr">确认订单<\/h3>/);
    assert.doesNotMatch(modal, /id="guestCashSubtitle"|guest-shop-modal__subtitle/);
    assert.match(modal, /<span id="guestCashPaymentLabel">付款方式<\/span>/);
    assert.match(modal, /id="guestCashPaymentOptions"[^>]*role="radiogroup"[^>]*aria-labelledby="guestCashPaymentLabel"/);
    assert.match(modal, /<select id="guestCashPaymentChannel"[^>]*hidden[^>]*aria-hidden="true"[^>]*tabindex="-1"><\/select>/);

    assert.match(client, /button\.setAttribute\('role', 'radio'\)/);
    assert.match(client, /radio\.setAttribute\('aria-checked', selected \? 'true' : 'false'\)/);
    assert.match(client, /event\.key === 'ArrowRight'[\s\S]*event\.key === 'ArrowLeft'[\s\S]*event\.key === 'Home'[\s\S]*event\.key === 'End'/);
    assert.match(client, /\['guestCashPaymentChannel', 'guestCashDiscountCode'\][\s\S]*node\.disabled = Boolean\(locked\)/);
    assert.match(client, /paymentOptions\.querySelectorAll\('\[role="radio"\]'\)[\s\S]*radio\.disabled = Boolean\([\s\S]*?\)/);

    assert.match(styles, /\.guest-shop-modal__payment-options \{[\s\S]*display: flex;[\s\S]*flex-wrap: wrap/);
    assert.match(styles, /\.guest-shop-modal__payment-option \{[\s\S]*min-height: 42px/);
    assert.match(styles, /\.guest-shop-modal__payment-option \{[\s\S]*border-radius: 999px/);
    assert.match(styles, /\.guest-shop-modal__payment-loading \{[\s\S]*display: none;[\s\S]*width: 0;/);
    assert.match(styles, /#guestCashPurchaseModal \.guest-shop-modal__payment-option \{[\s\S]*min-width: 0;/);
    assert.match(styles, /\.guest-shop-modal__payment-option\.is-loading \.guest-shop-modal__payment-loading \{[\s\S]*display: inline-flex;[\s\S]*width: 22px;/);
    assert.match(styles, /#guestCashPurchaseModal \.guest-shop-modal__payment-option\.is-loading \.guest-shop-modal__payment-icon,[\s\S]*?visibility: hidden;/);
    assert.doesNotMatch(styles, /#guestCashPurchaseModal \.guest-shop-modal__payment-option\.is-loading \.guest-shop-modal__payment-icon,[\s\S]*?display: none;/);
    assert.match(styles, /#guestCashPurchaseModal \.guest-shop-modal__payment-option\.is-loading \.guest-shop-modal__payment-loading \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;/);
    assert.match(styles, /#guestCashPurchaseModal \.guest-shop-modal__payment-option\.is-loading:disabled \{[\s\S]*?opacity: 1;/);
    assert.match(styles, /html\[data-theme="dark"\] body\.shop-page \.guest-shop-modal__payment-option\[data-channel="alipay"\] \.guest-shop-modal__payment-icon \{[\s\S]*?background: #e8f1ff;[\s\S]*?color: #1677ff;[\s\S]*?filter: none;/);
    assert.match(styles, /html\[data-theme="dark"\] body\.shop-page \.guest-shop-modal__payment-option\[data-channel="alipay"\] \.guest-shop-modal__payment-icon > i \{[\s\S]*?color: #1677ff;[\s\S]*?filter: none;/);
    assert.match(client, /alipay: 'fa-brands fa-alipay'/);
    assert.match(client, /iconGlyph\.src = 'assets\/tether-mark\.svg'/);
    assert.doesNotMatch(client, /（NOWPayments）/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) body\.shop-page \.guest-shop-modal__payment-option \{[\s\S]*background: #fff[\s\S]*color: #1e293b/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) body\.shop-page \.guest-shop-modal__field input[\s\S]*color: #172033 !important[\s\S]*-webkit-text-fill-color: #172033 !important/);
    assert.match(markup, /<span>邮箱 <small id="guestCashContactHint">可选<\/small><\/span>/);
    assert.ok(
        modal.indexOf('id="guestCashContact"') < modal.indexOf('id="guestCashPaymentOptions"'),
        'email collection must appear before payment choices'
    );
    assert.match(markup, /<span>密码 <small>必填<\/small><\/span>/);
    assert.doesNotMatch(guestCheckoutModalMarkup(), /接收通知邮箱|查询密码 <small>必填/);
});

test('the guest checkout modal mirrors the Dujiao payment and delivery layout', () => {
    const guestModalStart = markup.indexOf('id="guestCashPurchaseModal"');
    const guestModalEnd = markup.indexOf('<div class="modal-overlay" id="shopCartCheckoutModal">', guestModalStart);
    assert.ok(guestModalStart >= 0 && guestModalEnd > guestModalStart, 'guest cash modal markup must exist');
    const modal = markup.slice(guestModalStart, guestModalEnd);

    // Release pin for this UI-alignment batch (independent marker convention, so
    // reordering cache-buster params never silently invalidates it).
    assert.match(markup, /guestCheckoutUi=20260918_GUEST_CHECKOUT_DUJIAO_UI_1/);

    // Confirmation dialog: keep a concise title, with no subtitle or guest-only eyebrow.
    assert.match(modal, /<h3 id="guestCashPurchaseTitle" class="card-title guest-shop-modal__title-sr">确认订单<\/h3>/);
    assert.doesNotMatch(modal, /guestCashSubtitle|guest-shop-modal__subtitle|游客购买|无需登录/);

    // CheckoutSteps.vue -> a 3-step rail (确认订单 -> 支付 -> 发货). A guest single-product
    // flow has no cart, so the同构 mapping drops Dujiao's cart step.
    assert.match(modal, /id="guestCashSteps"[^>]*class="guest-shop-modal__steps"[^>]*data-step="configure"/);
    for (const key of ['configure', 'payment', 'delivery']) {
        assert.match(modal, new RegExp('data-step-key="' + key + '"'));
    }
    assert.equal((modal.match(/class="guest-shop-modal__step"/g) || []).length, 3, 'the rail keeps exactly three steps');
    assert.equal((modal.match(/guest-shop-modal__step-index/g) || []).length, 3);
    assert.equal((modal.match(/guest-shop-modal__step-label/g) || []).length, 3);
    assert.doesNotMatch(modal, /guest-shop-modal__step-index[^>]*>\s*\d+\s*</);

    // PaymentAmountBreakdown.vue -> payable hero + line items.
    assert.match(modal, /class="guest-shop-modal__amount"/);
    assert.match(modal, /id="guestCashAmountLabel" class="guest-shop-modal__amount-label">应付金额</);
    assert.match(client, /setText\('guestCashAmountLabel', status === 'delivered' \? '已付金额' : '应付金额'\)/);
    assert.match(modal, /id="guestCashPrice"[^>]*class="guest-shop-modal__amount-value(?:\s+[^\"]+)?"/);
    assert.match(modal, /id="guestCashPrice"[^>]*is-amount-placeholder[^>]*><span class="guest-amount-currency">￥<\/span><span class="guest-amount-digits">0\.00<\/span>/);
    assert.match(styles, /@keyframes guest-amount-reveal/);
    assert.doesNotMatch(styles, /@keyframes guest-amount-roll-up/);
    assert.doesNotMatch(styles, /@keyframes guest-amount-reveal\s*\{[^}]*transform/);
    assert.doesNotMatch(styles, /@keyframes guest-amount-placeholder-fade\s*\{[^}]*transform/);
    assert.doesNotMatch(styles, /guest-amount-skeleton-pulse/);
    assert.match(modal, /class="guest-shop-modal__amount-rows"/);
    assert.doesNotMatch(modal, /guestCashAmountFooter|guestCashPollingHint|正在自动核验支付结果，请保持此页面打开/);
    assert.match(modal, /class="guest-shop-modal__order-overview"[\s\S]*class="guest-shop-modal__summary"[\s\S]*class="guest-shop-modal__amount"/);
    // Order meta rows Dujiao renders in its side card; hidden until an order exists.
    assert.match(modal, /id="guestCashStatusRow"[^>]*hidden/);
    assert.match(modal, /id="guestCashStatusValue"/);
    assert.match(modal, /id="guestCashMethodRow"[^>]*hidden/);
    assert.match(modal, /id="guestCashMethodValue"/);
    // L1/L2 containers ship hidden, filled with no markup change once promos land.
    assert.match(modal, /id="guestCashCouponRow"[^>]*guest-shop-modal__row--discount[^>]*hidden/);
    assert.match(modal, /id="guestCashCouponAmount"/);
    assert.match(modal, /id="guestCashPromoRow"[^>]*guest-shop-modal__row--discount[^>]*hidden/);
    assert.match(modal, /id="guestCashPromoAmount"/);

    // Payment.vue cryptoPaymentDetails -> bordered label/value list + its own copy row.
    assert.match(modal, /id="guestCashNowpaymentsPanel"[^>]*class="guest-shop-modal__crypto"[^>]*hidden/);
    assert.match(modal, /class="guest-shop-modal__crypto-list"/);
    assert.equal((modal.match(/class="guest-shop-modal__crypto-row"/g) || []).length, 3, '网络 / 支付金额 / 付款地址');
    assert.match(modal, /id="guestCashNowAddress"[^>]*class="guest-shop-modal__crypto-value guest-shop-modal__crypto-address"/);
    assert.match(modal, /id="guestCashNowCopyAddressBtn"[^>]*class="shop-btn shop-btn-secondary guest-shop-modal__crypto-copy"/);
    // The copy confirmation lives in its own node, never inside the address.
    assert.match(modal, /id="guestCashNowCopyFeedback"[^>]*class="guest-shop-modal__copy-feedback"[^>]*hidden/);

    // Guest delivery reuses the wallet success-item rows. The shell only owns
    // the all-cards copy action; type/status fact rows are intentionally absent.
    assert.match(modal, /id="guestCashDeliveryPanel"[^>]*class="guest-shop-modal__panel guest-shop-modal__delivery"[^>]*hidden/);
    assert.match(modal, /class="guest-shop-modal__delivery-actions"/);
    assert.doesNotMatch(modal, /guest-shop-modal__delivery-title|fa-circle-check/);
    assert.match(modal, /id="guestCashCopyDeliveryBtn"[^>]*class="guest-shop-modal__delivery-item-copy guest-shop-modal__delivery-copy"[^>]*aria-label="复制所有卡密"/);
    assert.ok(modal.indexOf('class="guest-shop-modal__delivery-actions"') < modal.indexOf('id="guestCashDeliveredContent"'));
    assert.doesNotMatch(modal, /guestCashDeliveryType|guestCashDeliveryStatus|guestCashDeliveryTime/);

    // The pre-Dujiao wrappers are gone from both markup and styles.
    assert.doesNotMatch(modal, /guest-shop-modal__payment-meta/);
    assert.doesNotMatch(modal, /guest-shop-modal__copy-all/);
    assert.doesNotMatch(styles, /\.guest-shop-modal__payment-meta/);
    assert.doesNotMatch(styles, /\.guest-shop-modal__copy-all/);

    // Styles cover the new cards in dark AND light theme, plus the done/copied states.
    for (const sel of [
        '.guest-shop-modal__subtitle',
        '.guest-shop-modal__steps',
        '.guest-shop-modal__step-index',
        '.guest-shop-modal__step.is-current',
        '.guest-shop-modal__step.is-done',
        '.guest-shop-modal__amount {',
        '.guest-shop-modal__amount-value',
        '.guest-shop-modal__row--discount',
        '.guest-shop-modal__crypto-list',
        '.guest-shop-modal__crypto-row:last-child',
        '.guest-shop-modal__copy-feedback',
        '.guest-shop-modal__delivery-actions',
        '.guest-shop-modal__delivery-copy.is-copied'
    ]) {
    assert.ok(styles.includes(sel), 'missing style rule: ' + sel);
    }
    assert.match(styles, /\.guest-shop-modal__order-overview \{[\s\S]*display: grid/);
    assert.match(styles, /@media \(min-width: 769px\) \{[\s\S]*\.guest-shop-modal__order-overview[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) body\.shop-page \.guest-shop-modal__amount/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) body\.shop-page \.guest-shop-modal__crypto-list/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) body\.shop-page \.guest-shop-modal__step-index/);
    assert.match(styles, /--guest-step-rgb: 83,199,223;/);
    assert.match(styles, /--guest-step-rgb: 169,151,231;/);
    assert.match(styles, /--guest-step-rgb: 101,207,172;/);
    assert.match(styles, /\.guest-shop-modal__step-index \{[\s\S]*width: 14px;[\s\S]*background: #94a3b8/);
    assert.match(styles, /\.guest-shop-modal__step\.is-current \.guest-shop-modal__step-index \{[\s\S]*background: rgb\(var\(--guest-step-rgb\)\);[\s\S]*box-shadow: none/);
    assert.doesNotMatch(styles, /\.guest-shop-modal__step-index \{[^}]*linear-gradient/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) body\.shop-page \.guest-shop-modal__actions \{[\s\S]*background: transparent;[\s\S]*box-shadow: none;/);
    assert.match(styles, /\.guest-shop-modal__delivery-copy \{ min-width: 0; \}/);
    assert.match(styles, /\.guest-shop-modal__delivery-copy-label \{ position: static;[\s\S]*white-space: nowrap/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) body\.shop-page \.guest-shop-modal__delivery-content \{[\s\S]*linear-gradient\(180deg, #ffffff 0%, #f8fbff 100%\)/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) body\.shop-page #guestCashPurchaseModal \.shop-success-item__copy-btn \{/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) body\.shop-page #guestCashPurchaseModal \.shop-success-item__tag--notice \{/);
    assert.match(styles, /#shopSuccessModal \.shop-success-item__tag--notice,\s*#guestCashPurchaseModal \.shop-success-item__tag--notice \{/);
    assert.match(styles, /#shopSuccessModal \.shop-success-item__tag-label,\s*#guestCashPurchaseModal \.shop-success-item__tag-label \{/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) body\.shop-page #guestCashPurchaseModal \.shop-success-item__content-card \.item-text/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) body\.shop-page #guestCashPurchaseModal \.shop-guidance-panel-copy \{/);
    assert.match(client, /createdAt: state\.fulfilledAt/);
    assert.doesNotMatch(client, /guestCashDeliveryType|guestCashDeliveryStatus|guestCashDeliveryTime/);
    assert.match(styles, /#guestCashPurchaseModal \.shop-success-item__surface:hover,[\s\S]*box-shadow: none/);
    assert.match(styles, /#guestCashPurchaseModal \.shop-success-item\.is-content-expanded \.shop-success-item__reveal-code \.shop-success-item__submeta-label/);

    // The client derives rail/meta/hint from one status table inside setStateMessage,
    // so a transient poll error can never walk a paid buyer back to 确认订单.
    assert.match(client, /const STEP_PHASES = \['configure', 'payment', 'delivery'\];/);
    assert.match(client, /const STEP_PHASE_BY_STATUS = \{/);
    assert.match(client, /const ORDER_STATUS_LABELS = \{/);
    assert.match(client, /function syncStepState\(phase\) \{/);
    assert.match(client, /function syncOrderMeta\(status = state\.status\) \{/);
    assert.doesNotMatch(client, /syncPollingHint|guestCashAmountFooter|guestCashPollingHint/);
    assert.match(client, /syncStepState\(STEP_PHASE_BY_STATUS\[status\] \|\| ''\);\s*\n\s*syncOrderMeta\(status\);/);
    // Creating is still the configuration phase; error/manual_review preserve the
    // last meaningful phase instead of walking a paid buyer backwards.
    assert.match(client, /creating: 'configure'/);
    assert.doesNotMatch(client, /error: 'configure'|manual_review: 'configure'/);

    // Delivery time is rendered on each shared success-item row through createdAt.
    assert.match(client, /createdAt: state\.fulfilledAt/);

    // copyText never overwrites the copied node and never wipes an icon button: the
    // wallet address confirms via a separate node, the delivery button via is-copied.
    assert.match(client, /async function copyText\(value, button, \{ doneEl = '', copiedClass = '' \} = \{\}\) \{/);
    assert.match(client, /copyText\(element\('guestCashNowAddress'\)\?\.textContent \|\| '', addressButton, \{ doneEl: 'guestCashNowCopyFeedback' \}\)/);
    assert.match(client, /copyText\(\s*deliveredContentForCopy\(\),\s*deliveryButton,\s*\{ copiedClass: 'is-copied' \}\s*\)\.then\(\(\) => \{ state\.deliveryCopied = true; \}\)/);
    assert.match(client, /guest-shop-modal__delivery-item-copy/);
    assert.match(styles, /\.guest-shop-modal__delivery-item-copy/);
    assert.doesNotMatch(client, /guestCashRecoveryCode|recoveryCopyButton|recoveryCodeCopied/);
});

// ---------------------------------------------------------------------------
// Order Access 2.0 (A2) — query password collection, generator and lookup page
// ---------------------------------------------------------------------------

test('the shared query-password module is CSPRNG-only, storage-free and network-free', () => {
    const code = stripComments(passwordModuleSource);
    assert.match(code, /getRandomValues/);
    assert.doesNotMatch(code, /Math\.random/);
    assert.doesNotMatch(code, /localStorage|sessionStorage|document\.cookie/);
    assert.doesNotMatch(code, /fetch\s*\(|XMLHttpRequest|sendBeacon/);
    assert.doesNotMatch(code, /supabase|access_token|Authorization\s*:|Bearer/i);
    assert.doesNotMatch(code, /innerHTML/);
    assert.doesNotMatch(code, /X-Guest-Claim-Secret|claimSecret|claim_secret/);
    // Unbiased rejection sampling. A plain `buffer[0] % max` would over-represent
    // the first alphabet characters and quietly narrow the effective keyspace of
    // every generated query password.
    assert.match(code, /Math\.floor\(0x100000000 \/ max\) \* max/);
    assert.match(code, /globalThis\.GuestQueryPassword = Object\.freeze\(\{/);
    // The module must stay a pure companion to the generator button: it never
    // sees an order, a credential or a recovery code.
    assert.doesNotMatch(code, /order_no|orderNo|recovery/i);
});

test('the browser query-password generator only mints passwords the real server policy accepts', () => {
    // Deterministic xorshift32 so a policy regression reproduces exactly instead
    // of flaking. In the browser the module uses crypto.getRandomValues; here we
    // only need a stable, unbiased enough byte source to exercise the alphabet.
    let seed = 0x2545f491;
    const nextUint32 = () => {
        seed ^= seed << 13; seed >>>= 0;
        seed ^= seed >>> 17;
        seed ^= seed << 5; seed >>>= 0;
        return seed;
    };
    const context = vm.createContext({
        crypto: {
            getRandomValues(buffer) {
                for (let index = 0; index < buffer.length; index += 1) buffer[index] = nextUint32();
                return buffer;
            }
        }
    });
    vm.runInContext(passwordModuleSource, context, { filename: 'js/guest-query-password.js' });
    const api = context.GuestQueryPassword;
    assert.ok(api, 'the module must expose globalThis.GuestQueryPassword');

    // Frozen parity with the server. These three values are the whole reason the
    // button exists: if the alphabet, the length or the minimum drift, every
    // "帮我生成" password becomes a guaranteed 400 guest_password_weak and the
    // buyer is told the password WE minted is too weak.
    assert.deepEqual(
        { ...api.CLASSES },
        { ...security._private.GENERATED_QUERY_PASSWORD_CLASSES },
        'the browser alphabet must mirror GENERATED_QUERY_PASSWORD_CLASSES character-for-character'
    );
    assert.equal(api.GENERATED_LENGTH, security.GENERATED_QUERY_PASSWORD_LENGTH);
    assert.equal(api.MIN_LENGTH, security.GUEST_QUERY_PASSWORD_MIN_LENGTH);

    const alphabet = new Set(Object.values(security._private.GENERATED_QUERY_PASSWORD_CLASSES).join(''));
    const SAMPLES = 20000;
    const seen = new Set();
    let denylistHits = 0;
    for (let index = 0; index < SAMPLES; index += 1) {
        const candidate = api.generate();
        assert.equal([...candidate].length, api.GENERATED_LENGTH);
        for (const ch of candidate) {
            assert.equal(alphabet.has(ch), true, `${candidate} contains an out-of-alphabet character`);
        }
        assert.equal(seen.has(candidate), false, 'generated passwords must not repeat');
        seen.add(candidate);

        const result = security.validateGuestQueryPasswordPolicy(candidate);
        if (result.ok) continue;
        // P7a is the ONE rule the browser deliberately does not mirror: shipping
        // the ~120-entry server denylist to the client would leak a policy asset
        // to save a round trip, and a random 12-character string collides with
        // it at roughly 1/200k. The client turns that residual into a re-mint +
        // re-copy (asserted below), never a dead end, so it is tolerated here but
        // bounded. Any other rule means the local structural mirror drifted.
        assert.equal(
            result.rule,
            'P7a',
            `${candidate} was rejected by ${result.rule}, which js/guest-query-password.js must mirror`
        );
        denylistHits += 1;
    }
    assert.ok(
        denylistHits / SAMPLES < 0.001,
        `P7a residual rate ${denylistHits}/${SAMPLES} is far above the ~1/200k expectation`
    );

    // The live checklist (§11.3) and the submit gate must agree with the server's
    // P1/P2a-P2d on the same input, otherwise the modal shows five green ticks
    // for a password the server is about to refuse.
    for (const probe of [api.generate(), 'Ab3!xY9#', 'short1!', 'alllowercase1!', 'NOUPPERCASE!']) {
        const inspected = api.inspect(probe);
        const server = security.validateGuestQueryPasswordPolicy(probe);
        const clientOk = api.policyFailure(probe) === null;
        // P6-P8/P10 inputs the client cannot judge are allowed to differ, but the
        // four-class + length verdict surfaced in the UI must match exactly.
        assert.equal(
            inspected.length,
            [...probe].length >= security.GUEST_QUERY_PASSWORD_MIN_LENGTH,
            `length tick disagrees for ${probe}`
        );
        assert.equal(inspected.upper, /[A-Z]/.test(probe));
        assert.equal(inspected.lower, /[a-z]/.test(probe));
        assert.equal(inspected.digit, /[0-9]/.test(probe));
        assert.equal(inspected.punct, /[^A-Za-z0-9]/.test(probe));
        assert.equal(inspected.ok, inspected.length && inspected.upper && inspected.lower && inspected.digit && inspected.punct);
        if (server.ok) assert.equal(clientOk, true, `client rejected a password the server accepts: ${probe}`);
        if (!server.ok && ['P1', 'P2a', 'P2b', 'P2c', 'P2d'].includes(server.rule)) {
            assert.equal(clientOk, false, `client accepted a password the server rejects with ${server.rule}: ${probe}`);
        }
    }

    // §6.1.2 step 2: fullwidth folding must be identical on both sides, or a
    // Chinese IME turns a working credential into a permanent 403.
    assert.equal(
        api.foldFullwidth('Ａｂ３！'),
        security._private.foldFullwidthAscii('Ａｂ３！')
    );
    assert.equal(api.foldFullwidth('Ab3!xY9#'), 'Ab3!xY9#');
});

test('the shop modal collects the query password only when the server says it is required', () => {
    // Markup: the whole block ships hidden, so with GUEST_SHOP_BUYER_CREDENTIAL_ENABLED
    // off the checkout a buyer sees is byte-identical to today (D1).
    assert.match(markup, /id="guestCashOrderPasswordField"[^>]*hidden/);
    assert.match(
        markup,
        /id="guestCashOrderPassword"[^>]*type="password"[^>]*autocomplete="new-password"[^>]*maxlength="64"[^>]*spellcheck="false"/
    );
    // new-password, never current-password: this field MINTS a secret, and
    // current-password makes browsers offer a reused site password (§8.3).
    assert.doesNotMatch(markup, /id="guestCashOrderPassword"[^>]*autocomplete="current-password"/);
    assert.match(markup, /id="guestCashOrderPasswordChecks"[^>]*class="guest-shop-modal__pw-checks"/);
    for (const key of ['length', 'upper', 'lower', 'digit', 'punct']) {
        assert.match(markup, new RegExp(`<li data-pw-check="${key}">`), `missing checklist item ${key}`);
    }
    assert.match(markup, /id="guestCashOrderPasswordNote"[^>]*role="status"[^>]*hidden/);
    assert.match(markup, /id="guestCashToggleOrderPasswordBtn"[^>]*aria-pressed="false"/);
    assert.match(markup, /id="guestCashGenerateOrderPasswordBtn"[^>]*>帮我生成</);
    assert.doesNotMatch(markup, /guestCashShowRecoveryBtn/);
    assert.match(styles, /\.guest-shop-modal__pw-checks/);
    assert.match(styles, /\.guest-shop-modal__pw-btn/);
    assert.match(styles, /\.guest-shop-modal__pw-note/);

    // The generator module must be mounted BEFORE the client that calls into it,
    // and both carry the A2 cachebuster.
    // Anchored on the <script src= prefix for the same reason as the mount-order
    // test above: prose in the markup must never decide load order.
    const generatorIndex = markup.indexOf('<script src="js/guest-query-password.js');
    const guestClientIndex = markup.indexOf('<script src="js/guest-shop-client.js');
    assert.ok(generatorIndex >= 0, 'js/guest-query-password.js must be mounted');
    assert.ok(guestClientIndex > generatorIndex, 'the generator must load before the guest client');
    assert.match(markup, /js\/guest-query-password\.js\?v=20260921_GUEST_ORDER_ACCESS_A2_1/);
    assert.match(markup, /guestOrderAccess=20260921_GUEST_ORDER_ACCESS_DIRECT_1/);

    // Client: the switch is driven ONLY by the server's preview flag, never by a
    // client-side guess, so the server stays authoritative (§6.1.4).
    assert.match(client, /buyerCredentialRequired:\s*false,/);
    assert.match(client, /state\.buyerCredentialRequired = preview\?\.buyer_credential_required === true;/);
    assert.match(client, /setHidden\('guestCashOrderPasswordField', !required\);/);
    assert.doesNotMatch(client, /guestCashOrdersPageLink|guestCashShowRecoveryBtn/);
    assert.match(client, /setText\('guestCashContactHint', required/);
    assert.match(client, /pendingIntentRequiresEmail/);
    assert.match(client, /'必填'/);
    assert.doesNotMatch(client, /必填，用于查询订单/);
    assert.match(client, /'可选'/);
    // Off path must actively wipe any plaintext left in the field.
    assert.match(client, /if \(!required\) clearOrderPassword\(\);/);

    // maxlength=64 is the server's P3 cap; folding slices to the same bound.
    assert.match(client, /return folded\.slice\(0, 64\);/);
    // The frozen normalization contract NEVER trims a query password. A trim
    // here but not on the lookup page would strand an order behind one space.
    const foldStart = client.indexOf('function foldQueryPassword(value)');
    const foldEnd = client.indexOf('\n    function setOrderPasswordNote', foldStart);
    assert.ok(foldStart > 0 && foldEnd > foldStart, 'foldQueryPassword must stay a standalone function');
    assert.doesNotMatch(client.slice(foldStart, foldEnd), /\.trim\(/);
});

test('the query password travels once in the order body and is never persisted, URL-encoded or silently retried', () => {
    // Mandatory email + client-side strength gate before the request is built.
    assert.match(client, /if \(state\.buyerCredentialRequired\) \{[\s\S]*?if \(!email\) \{[\s\S]*?请填写邮箱，用于查询订单/);
    assert.match(client, /const passwordFailure = orderPasswordPolicyFailure\(\);[\s\S]*?setStateMessage\(orderPasswordPolicyMessage\(passwordFailure\), 'error'\);\s*return;/);
    assert.match(client, /if \(orderPassword\) body\.orderPassword = orderPassword;/);
    // The A2 credential rides in the same body as the (L1-clamped) quantity;
    // it must not become a back door that bypasses normalizeQuantity's cap.
    // L1: quantity is no longer a hardcoded 1 — it is the buyer's selection run
    // through normalizeQuantity(), which clamps to the preview-reported cap (1
    // while the switch is off, so the pre-L1 body is byte-identical). The raw
    // state.quantity is never sent, so a forged stepper value cannot widen an
    // order; fn_guest_shop_create_order re-applies the same cap server-side.
    assert.match(client, /const prepareBody = \{[\s\S]*checkoutAction:\s*['"]prepare['"][\s\S]*quantity:\s*normalizeQuantity\(state\.quantity\),/);
    assert.match(client, /body = \{\s*checkoutAction:\s*['"]commit['"],\s*intentId:\s*attempt\.intentId\s*\};/);

    // Never persisted: the checkout snapshot keeps only a safe order handle and
    // non-secret product/payment context needed to render a recovered order.
    const persistStart = client.indexOf('function persistCheckoutRecord(record)');
    const persistEnd = client.indexOf('\n    function hydrateCheckout', persistStart);
    assert.ok(persistStart > 0 && persistEnd > persistStart, 'checkout persistence must stay isolated');
    const persisted = client.slice(persistStart, persistEnd);
    assert.doesNotMatch(persisted, /orderPassword|queryPassword|generatedOrderPassword/i);
    assert.doesNotMatch(persisted, /password/i);

    // Plaintext is dropped after the server has accepted the request and on
    // modal close, so it never outlives the request that needed it.
    const createStart = client.indexOf('async function createOrder() {');
    const createEnd = client.indexOf('\n    async function fetchStatus', createStart);
    assert.ok(createStart > 0 && createEnd > createStart, 'createOrder must stay a standalone function');
    assert.match(client.slice(createStart, createEnd), /clearOrderPassword\(\)/);
    const closeStart = client.indexOf('function closeGuestModal(');
    assert.ok(closeStart > 0, 'closeGuestModal must exist');
    assert.match(client.slice(closeStart, closeStart + 2000), /clearOrderPassword\(\);/);

    // A server-side rejection must re-mint and ask the buyer to click again.
    // Auto-resubmitting would loop against the order-creation rate limit and
    // could mint a second credential group behind the buyer's back.
    assert.match(client, /if \(error\?\.code === 'guest_password_weak'\) void refreshRejectedOrderPassword\(\);/);
    const refreshStart = client.indexOf('async function refreshRejectedOrderPassword()');
    const refreshEnd = client.indexOf('\n    function toggleOrderPasswordVisibility', refreshStart);
    assert.ok(refreshStart > 0 && refreshEnd > refreshStart, 'refreshRejectedOrderPassword must stay a standalone function');
    const refreshBody = client.slice(refreshStart, refreshEnd);
    assert.doesNotMatch(refreshBody, /createOrder|ORDER_ENDPOINT|requestJson|fetch\s*\(/);
    assert.match(refreshBody, /请点击「帮我生成」换一个/);
    assert.match(refreshBody, /请妥善保存后再次点击付款方式/);
    // A password the buyer typed by hand is NEVER replaced without asking.
    assert.match(refreshBody, /if \(!current \|\| current !== state\.generatedOrderPassword\) \{/);
});

test('the guest order lookup page is a lean standalone page with no account runtime', () => {
    assert.match(ordersPage, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(ordersPage, /<body class="guest-orders-page">/);
    assert.match(ordersPage, /css\/guest-orders\.css\?v=20261001_GUEST_ORDERS_ACCENT_FOOTER_1/);
    for (const id of [
        'guestOrdersFeatureGate', 'guestOrdersFeatureGateMessage', 'guestOrdersFeatureRetryBtn',
        'guestOrdersProtectedContent',
        'guestOrdersSavedHint', 'guestOrdersSavedEmail', 'guestOrdersClearSavedBtn',
        'guestOrdersQueryForm', 'guestOrdersEmail', 'guestOrdersPassword',
        'guestOrdersTogglePasswordBtn', 'guestOrdersOrderNo', 'guestOrdersSubmitBtn',
        'guestOrdersError', 'guestOrdersLoading', 'guestOrdersResultCard',
        'guestOrdersEmpty', 'guestOrdersList', 'guestOrdersPagination',
        'guestOrdersPageInfo', 'guestOrdersPrevBtn', 'guestOrdersNextBtn',
        'guestOrdersDetail', 'guestOrdersDetailRows', 'guestOrdersDeliveryContent',
        'guestOrdersCopyDeliveryBtn', 'guestOrdersLoadDeliveryBtn',
        // A3 §10.5 one-time reset-link card
        'guestOrdersResetCard', 'guestOrdersResetForm', 'guestOrdersResetEmail',
        'guestOrdersResetPassword', 'guestOrdersResetPasswordConfirm',
        'guestOrdersResetToggleBtn', 'guestOrdersResetGenerateBtn',
        'guestOrdersResetPolicy', 'guestOrdersResetSubmitBtn',
    ]) {
        assert.match(ordersPage, new RegExp(`id="${id}"`), `guest-orders.html is missing #${id}`);
    }
    // The lookup field LOOKS UP an existing secret, so current-password is the
    // correct (and opposite) choice to the order form's new-password.
    assert.match(ordersPage, /id="guestOrdersPassword"[\s\S]{0,120}autocomplete="current-password"[^>]*maxlength="64"/);
    assert.match(ordersPage, /id="guestOrdersEmail"[^>]*type="email"/);
    assert.match(ordersPage, /id="guestOrdersQueryForm"[^>]*novalidate/);
    assert.match(ordersPage, /id="guestOrdersProtectedContent"[^>]*hidden[^>]*aria-hidden="true"/);
    assert.doesNotMatch(ordersPage, /guestOrdersLegacy|guestOrdersUpgrade|订单号\s*\+\s*取货口令|历史订单/);

    // A3: the two credential-MINTING forms must ask a password manager for a NEW
    // password (the opposite of the lookup field), and the reset card must start
    // hidden — it is revealed only after the client has read a real ?reset= token,
    // so a hand-typed /guest-orders.html?reset=xxx cannot pre-open a form.
    assert.match(ordersPage, /id="guestOrdersResetCard"[^>]*hidden/);
    assert.match(ordersPage, /id="guestOrdersResetPassword"[\s\S]{0,200}autocomplete="new-password"/);
    assert.doesNotMatch(ordersPage, /id="guestOrdersReset[^>]*autocomplete="current-password"/);
    // The page must not advertise the reset link as a self-service entry point:
    // it exists only in a support message from an admin (§10.5).
    assert.doesNotMatch(ordersPage, /href="[^"]*\?reset=/);

    // No account runtime at all: mounting shop-client would drag in supabase,
    // the wallet and the auth modal, which is exactly what the guest channel
    // must never touch.
    assert.doesNotMatch(ordersPage, /supabase/i);
    assert.doesNotMatch(ordersPage, /js\/shop-client\.js/);
    assert.doesNotMatch(ordersPage, /js\/guest-shop-client\.js/);
    assert.doesNotMatch(ordersPage, /chat-widget/);
    assert.doesNotMatch(ordersPage, /wallet-modal/);

    // Script order: site config, then the shared generator, then the page client.
    const siteConfig = ordersPage.indexOf('js/site-config.js');
    const generator = ordersPage.indexOf('js/guest-query-password.js');
    const pageClient = ordersPage.indexOf('js/guest-orders-client.js');
    assert.ok(siteConfig >= 0, 'site-config must be mounted');
    assert.ok(generator > siteConfig, 'the generator must load after site-config');
    assert.ok(pageClient > generator, 'the lookup client must load after the generator');
    assert.match(ordersPage, /js\/guest-orders-client\.js\?v=20260924_GUEST_ORDERS_CREDENTIAL_ONLY_1/);
    assert.doesNotMatch(ordersPage, /<script(?![^>]*\bdefer\b)[^>]*js\/guest-orders-client\.js/);
    assert.match(ordersStyles, /body\.guest-orders-page/);
    assert.match(ordersStyles, /\.guest-orders-gate/);
    assert.match(ordersStyles, /--go-accent:\s*#7eb8ef/);
    assert.match(ordersStyles, /\.guest-orders-shell[\s\S]*min-height:\s*100vh/);
    assert.match(ordersStyles, /\.guest-orders-footer[\s\S]*margin-top:\s*auto/);
    assert.match(ordersStyles, /\.guest-orders-item-discounts:empty/);

    // The standalone lookup page has no storefront/legal navigation. Its only
    // footer content is the local-credential privacy reminder.
    assert.doesNotMatch(ordersPage, /class="guest-orders-back"/);
    assert.doesNotMatch(ordersPage, /href="\/shop\.html"|href="\/refund-policy\.html"|href="\/terms\.html"|href="\/privacy\.html"/);
    assert.match(ordersPage, /<footer class="guest-orders-footer">\s*<p>查询凭证只保存在本机浏览器/);
});

test('the lookup client stays isolated from the account auth system and never writes the query password to storage or a URL', () => {
    const code = stripComments(ordersClient);
    // Transport: the dedicated guest credential header, same-origin cookies only.
    assert.match(code, /const CREDENTIAL_HEADER = 'X-Guest-Order-Credential';/);
    assert.match(code, /credentials:\s*'same-origin'/);
    assert.match(code, /cache:\s*'no-store'/);
    assert.match(code, /sessionStorage/);
    assert.doesNotMatch(code, /supabase|access_token|Authorization\s*:|Bearer/i);
    // The lookup page must never see a one-time claim secret: delivery access is
    // credential-gated, and re-exposing claimSecret here would rebuild the exact
    // URL-leak surface the checkout client already removed.
    assert.doesNotMatch(code, /X-Guest-Claim-Secret|claimSecret|claim_secret/);
    assert.doesNotMatch(code, /Math\.random/);
    // Every order field is built with createElement/textContent: a product name
    // or delivery body is attacker-influenceable and must not become markup.
    assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);

    // §7.2 storage ladder: memory -> sessionStorage -> a ONE-TIME localStorage
    // read + removeItem migration for credentials an older build left behind.
    // Writing to localStorage is forbidden because it survives across sessions
    // and browser profiles on a shared machine.
    assert.match(code, /window\.localStorage/);
    assert.match(code, /\.removeItem\(/);
    assert.doesNotMatch(code, /localStorage\s*\.\s*setItem/);
    assert.doesNotMatch(code, /localStorage\s*\[[^\]]*\]\s*=/);
    assert.doesNotMatch(code, /document\.cookie\s*=/);

    // Flat-key endpoints per the dispatcher contract (no path params), and the
    // credential never rides along in a query string.
    for (const endpoint of [
        "'/api/shop/guest/access/availability'",
        "'/api/shop/guest/orders'",
        "'/api/shop/guest/order'",
        "'/api/shop/guest/delivery'",
        "'/api/shop/guest/access/login'",
        "'/api/shop/guest/access/logout'",
        // A3: the one-time reset link (§10.5) rides the same public flat-key dispatcher.
        "'/api/shop/guest/access/reset'",
    ]) {
        assert.ok(code.includes(endpoint), `the lookup client must call ${endpoint}`);
    }
    assert.match(code, /setOrderAccessPageAvailable\(false/);
    assert.match(code, /setOrderAccessPageAvailable\(true\)/);
    const initStart = code.indexOf('async function init()');
    const initEnd = code.indexOf("if (document.readyState === 'loading')", initStart);
    assert.ok(initStart >= 0 && initEnd > initStart, 'async gated init must exist');
    const initBody = code.slice(initStart, initEnd);
    assert.ok(initBody.indexOf('consumeUrlResetToken()') < initBody.indexOf('bindBaseListeners()'),
        'reset tokens must leave the URL before any listeners or requests run');
    assert.ok(initBody.indexOf('bindBaseListeners()') < initBody.indexOf('await initializeOrderAccessPage()'),
        'retry must bind before the new credential feature probe');
    const baseListenersStart = code.indexOf('function bindBaseListeners()');
    const baseListenersEnd = code.indexOf('\n    function initializeOrderAccessFeatures()', baseListenersStart);
    const baseListenersBody = code.slice(baseListenersStart, baseListenersEnd);
    assert.match(baseListenersBody, /if \(state\.baseListenersBound\) return;/);
    assert.match(baseListenersBody, /guestOrdersFeatureRetryBtn/);
    const gateStart = code.indexOf('function setOrderAccessPageAvailable(');
    const gateEnd = code.indexOf('\n    function setBusy(', gateStart);
    const gateBody = code.slice(gateStart, gateEnd);
    assert.match(gateBody, /setHidden\('guestOrdersProtectedContent', !state\.pageAvailable\)/);
    assert.doesNotMatch(gateBody, /guestOrdersLegacy|guestOrdersUpgrade/);
    assert.match(code, /searchParams\.set\('order_no', orderNo\)/);
    assert.doesNotMatch(code, /searchParams\.set\(\s*['"](?:password|orderPassword|credential|secret|token|email)/i);
    assert.doesNotMatch(code, /history\.(?:push|replace)State\([^)]*(?:password|credential|secret)/i);
    assert.doesNotMatch(code, /location\.(?:href|assign|replace)\s*=?\s*[^;]*(?:password|credential|secret)/i);

    // A3 §10.5: the one-time link token is a BEARER credential. It must be read
    // out of the address bar and deleted before any request, must never be put
    // back into a URL, and must never reach a storage tier.
    assert.match(code, /searchParams\.delete\('reset'\)/);
    assert.match(code, /history\.replaceState\(/);
    const resetConsumeStart = code.indexOf('function consumeUrlResetToken()');
    const resetConsumeEnd = code.indexOf('\n    const POLICY_MESSAGES', resetConsumeStart);
    const resetConsumeBody = code.slice(resetConsumeStart, resetConsumeEnd);
    assert.ok(resetConsumeBody.indexOf('history.replaceState(') < resetConsumeBody.indexOf('state.resetToken = token'),
        'the scrubbed reset token must move directly into memory before any availability probe can fail');
    assert.doesNotMatch(code, /searchParams\.set\(\s*['"]reset['"]/);
    assert.doesNotMatch(code, /\?reset=/);
    assert.doesNotMatch(code, /resetToken\s*[:=][^;]*(sessionStorage|localStorage)/);
    // Both new surfaces send their secrets in the JSON body, under exactly one
    // canonical field spelling each, so the server cannot be probed with an
    // alternative normalization (§16.1).
    assert.match(code, /body: JSON\.stringify\(\{ token, email, password, site:/);
    assert.doesNotMatch(code, /guest\/recover|access\/upgrade|recoveryCode|recovery_code/);
    assert.doesNotMatch(code, /reset_token\s*:/);
    // K26 is mirrored locally through the shared module, never re-implemented
    // here, and never weakened by a Math.random generator.
    assert.match(code, /globalThis\.GuestQueryPassword/);
    assert.match(code, /policyFailure\(/);
    assert.match(code, /foldFullwidth\(/);
});

test('a reset link survives a failed availability probe and resumes in place after retry', async () => {
    const resetToken = 'reset-token-that-must-stay-in-memory';
    const elements = new Map();
    const requests = [];
    const historyUrls = [];
    let availabilityAttempts = 0;

    const initiallyHidden = new Set([
        'guestOrdersFeatureRetryBtn',
        'guestOrdersProtectedContent',
        'guestOrdersResetCard',
        'guestOrdersResultCard',
        'guestOrdersSavedHint',
        'guestOrdersError',
        'guestOrdersLoading'
    ]);
    const makeElement = (id) => {
        const listeners = new Map();
        const attributes = new Map();
        return {
            id,
            hidden: initiallyHidden.has(id),
            disabled: false,
            value: '',
            type: id.includes('Password') ? 'password' : 'text',
            textContent: '',
            dataset: {},
            listenerCount(type) { return (listeners.get(type) || []).length; },
            setAttribute(name, value) { attributes.set(name, String(value)); },
            getAttribute(name) { return attributes.get(name) ?? null; },
            removeAttribute(name) { attributes.delete(name); },
            addEventListener(type, listener) {
                const current = listeners.get(type) || [];
                current.push(listener);
                listeners.set(type, current);
            },
            dispatch(type) {
                for (const listener of listeners.get(type) || []) {
                    listener({
                        currentTarget: this,
                        target: this,
                        preventDefault() {}
                    });
                }
            },
            focus() { this.focused = true; },
            scrollIntoView() {},
            querySelector() { return null; },
            appendChild() {}
        };
    };
    const document = {
        readyState: 'complete',
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, makeElement(id));
            return elements.get(id);
        },
        addEventListener() {},
        createElement(tagName) { return makeElement(tagName); }
    };
    const window = {
        document,
        location: {
            href: `https://www.fatherkey.com/guest-orders.html?reset=${resetToken}&site=intl`
        },
        history: {
            replaceState(_state, _title, nextUrl) {
                historyUrls.push(nextUrl);
                window.location.href = nextUrl;
            }
        },
        SiteConfig: { site: 'cn' },
        setTimeout,
        clearTimeout
    };
    const fetch = async (url, options = {}) => {
        requests.push({ url, options });
        if (url.endsWith('/access/availability')) {
            availabilityAttempts += 1;
            if (availabilityAttempts === 1) {
                return { ok: false, status: 503, async json() { return { success: false }; } };
            }
            return { ok: true, status: 200, async json() { return { success: true, enabled: true }; } };
        }
        if (url.endsWith('/access/reset')) {
            return {
                ok: true,
                status: 200,
                async json() {
                    return { success: true, authenticated: false, session_required: true };
                }
            };
        }
        throw new Error(`unexpected request: ${url}`);
    };
    window.window = window;
    const context = {
        window,
        document,
        fetch,
        URL,
        URLSearchParams,
        GuestQueryPassword: {
            foldFullwidth(value) { return String(value); },
            policyFailure() { return null; }
        },
        setTimeout,
        clearTimeout,
        console
    };
    vm.runInNewContext(ordersClient, context, { filename: 'js/guest-orders-client.js' });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(historyUrls.length, 1, 'the bearer URL should be replaced exactly once');
    assert.equal(new URL(historyUrls[0]).searchParams.has('reset'), false);
    assert.equal(new URL(historyUrls[0]).searchParams.has('site'), false);
    assert.equal(window.location.href.includes(resetToken), false, 'the reset token must not return to the URL');
    assert.equal(availabilityAttempts, 1);
    assert.equal(document.getElementById('guestOrdersFeatureRetryBtn').hidden, false);
    assert.equal(document.getElementById('guestOrdersProtectedContent').hidden, true);
    assert.equal(document.getElementById('guestOrdersResetCard').hidden, true);

    const retryButton = document.getElementById('guestOrdersFeatureRetryBtn');
    retryButton.dispatch('click');
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(availabilityAttempts, 2);
    assert.equal(retryButton.hidden, true);
    assert.equal(document.getElementById('guestOrdersProtectedContent').hidden, false);
    assert.equal(document.getElementById('guestOrdersResetCard').hidden, false,
        'retry success should resume the reset flow without a refresh');
    assert.equal(document.getElementById('guestOrdersQueryCard').hidden, true);
    assert.equal(document.getElementById('guestOrdersResetEmail').focused, true);

    assert.equal(retryButton.listenerCount('click'), 1, 'retry must bind once');
    assert.equal(document.getElementById('guestOrdersResetForm').listenerCount('submit'), 1,
        'protected reset listeners must bind once after availability succeeds');

    // A stale/programmatic retry cannot duplicate listeners or issue a third
    // availability request after the page is already initialized.
    retryButton.dispatch('click');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(availabilityAttempts, 2);
    assert.equal(document.getElementById('guestOrdersResetForm').listenerCount('submit'), 1);

    document.getElementById('guestOrdersResetEmail').value = 'buyer@example.com';
    document.getElementById('guestOrdersResetPassword').value = 'Strong!Pass9';
    document.getElementById('guestOrdersResetPasswordConfirm').value = 'Strong!Pass9';
    document.getElementById('guestOrdersResetForm').dispatch('submit');
    await new Promise((resolve) => setImmediate(resolve));

    const resetRequest = requests.find((entry) => entry.url.endsWith('/access/reset'));
    assert.ok(resetRequest, 'the resumed card should submit without another page load');
    assert.equal(JSON.parse(resetRequest.options.body).token, resetToken,
        'the reset request must use the token retained across the failed probe');
    assert.equal(window.location.href.includes(resetToken), false, 'submitting must not put the token back in the URL');
});

test('the shared scroll lock releases only the modal that currently owns it', () => {
    const makeClassList = (initial = []) => {
        const values = new Set(initial);
        return {
            add: (...tokens) => tokens.forEach((token) => values.add(token)),
            remove: (...tokens) => tokens.forEach((token) => values.delete(token)),
            contains: (token) => values.has(token)
        };
    };
    const makeStyle = () => {
        const values = new Map();
        return {
            setProperty: (key, value) => values.set(key, value),
            removeProperty: (key) => values.delete(key)
        };
    };
    const root = { classList: makeClassList(), style: makeStyle(), scrollTop: 0 };
    const body = { classList: makeClassList(), style: makeStyle(), scrollTop: 0 };
    const document = {
        body,
        documentElement: root,
        activeElement: body,
        addEventListener() {},
        removeEventListener() {}
    };
    const window = {
        document,
        navigator: { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 1 },
        scrollY: 240,
        pageYOffset: 240,
        visualViewport: null,
        addEventListener() {},
        removeEventListener() {},
        scrollTo(_x, y) {
            this.scrollY = y;
            this.pageYOffset = y;
        }
    };
    const context = {
        window,
        document,
        navigator: window.navigator,
        requestAnimationFrame(callback) { callback(); return 1; },
        cancelAnimationFrame() {},
        setTimeout,
        clearTimeout,
        console
    };
    window.window = window;
    vm.runInNewContext(iosScrollLockSource, context, { filename: 'js/ios-scroll-lock.js' });

    const modal = (name) => ({
        name,
        isConnected: true,
        classList: makeClassList(['active']),
        matches: () => false,
        closest: () => null,
        contains: () => true
    });
    const guest = modal('guest');
    const auth = modal('auth');

    window.iOSScrollLock.lockLight(guest);
    window.iOSScrollLock.lock(auth);
    window.iOSScrollLock.unlock(guest);
    assert.equal(window.iOSScrollLock.isOwnedBy(auth), true, 'a stale guest close must not release the auth lock above it');
    window.iOSScrollLock.unlock(auth);
    assert.equal(window.iOSScrollLock.isLocked, false);

    window.iOSScrollLock.lockLight(guest);
    window.iOSScrollLock.lock(auth);
    window.iOSScrollLock.unlock(auth);
    assert.equal(window.iOSScrollLock.isOwnedBy(guest), true, 'closing the top owner should restore the still-active guest lock');
    window.iOSScrollLock.unlock(guest);
    assert.equal(window.iOSScrollLock.isLocked, false);

    const purchase = modal('purchase');
    window.iOSScrollLock.lockLight(purchase);
    purchase.classList.remove('active');
    window.iOSScrollLock.lockLight(guest);
    window.iOSScrollLock.lock(auth);
    window.iOSScrollLock.unlock(auth);
    assert.equal(
        window.iOSScrollLock.isOwnedBy(guest),
        true,
        'an inactive purchase modal must not displace the active guest restoration owner'
    );
    window.iOSScrollLock.unlock(guest);
    assert.equal(window.iOSScrollLock.isLocked, false);
});
