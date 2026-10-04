'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../js/shop-client.js'), 'utf8');

function methodSource(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `${startMarker} must remain a standalone method`);
    return source.slice(start, end);
}

test('guest quantity and promo modules stay visible while the matching preview resolves', () => {
    const candidateHelper = methodSource(
        'isGuestCashEntryCandidate: function () {',
        '\n    isGuestCashEntryActive: function () {'
    );
    assert.match(candidateHelper, /purchase\.forceGuestCash === true/);
    assert.match(candidateHelper, /purchase\.guestCashEligible === true && this\.shopAuthStateKnown !== true/);

    const pendingHelper = methodSource(
        'isGuestCashEntryProbePending: function () {',
        '\n    resolveShopAuthState: async function'
    );
    assert.match(pendingHelper, /!this\.isGuestCashEntryCandidate\(\)/);
    assert.match(pendingHelper, /!probe[\s\S]*!selection/);
    assert.match(pendingHelper, /probe\.productId !== selection\.productId/);
    assert.match(pendingHelper, /probe\.skuId !== selection\.skuId/);
    assert.match(pendingHelper, /probe\.site !== selection\.site/);

    const stage = methodSource(
        'setPurchaseStage: function (stage = \'configure\') {',
        '\n    proceedPurchaseConfirmation: function () {'
    );
    assert.match(stage, /const guestProbePending = this\.isGuestCashEntryProbePending\(\);/);
    assert.match(
        stage,
        /else if \(guestProbePending\) \{[\s\S]*?setElementHidden\(discountStage, false\);[\s\S]*?expandPurchaseDiscountDetails\(discountStage\);[\s\S]*?discountStage\?\.setAttribute\('aria-busy', 'true'\);/
    );
    assert.match(stage, /\.shop-purchase-stage-quantity'[\s\S]*?setElementHidden\(element, false\)/);
    assert.match(stage, /if \(discountInput\) discountInput\.value = '';[\s\S]*?guestCashDiscountCode = '';[\s\S]*?guestCashDiscountCodeFormatValid = false;/);
    assert.match(stage, /guestProbePending \|\| \(guestCashActive && !guestDiscountEnabled\)/);
    assert.match(stage, /control\.disabled = true;[\s\S]*?control\.setAttribute\('aria-disabled', 'true'\)/);
    assert.doesNotMatch(stage, /setElementHidden\(discountStage, !guestDiscountEnabled\)/);
    assert.match(stage, /quantityInput\.disabled = isPurchaseProcessing \|\| isManualDelivery \|\| isSoldOut;/);
    assert.doesNotMatch(stage, /quantityInput\.disabled = [^;]*guestProbePending/);
    assert.match(stage, /const locked = isPurchaseProcessing \|\| isManualDelivery;/);
    assert.doesNotMatch(stage, /const locked = [^;]*guestProbePending/);
    assert.doesNotMatch(stage, /const locked = [^;]*atGuestBoundary/);
    assert.match(stage, /control\.dataset\.guestPromoLocked === '1'[\s\S]*?delete control\.dataset\.guestPromoLocked/);

    const quantityCap = methodSource(
        'getGuestCashQuantityCap: function () {',
        '\n    setCurrentPurchaseQuantityCap: function ('
    );
    assert.match(quantityCap, /probe\.quantityCap/);
    assert.match(quantityCap, /: 1;/);
    const guestQuantity = methodSource(
        'syncGuestCashEntryQuantity: function () {',
        '\n    \/\/ Resolve auth state on modal open'
    );
    assert.match(guestQuantity, /const nextQuantity = Math\.min\(currentQuantity, quantityCap\)/);
    assert.match(guestQuantity, /quantityInput\.max = String\(quantityCap\)/);

    const applyDiscount = methodSource(
        'applyDiscount: async function (silent = false) {',
        '\n    adjustQuantity: function (delta) {'
    );
    assert.match(
        applyDiscount,
        /if \(this\.isGuestCashEntryProbePending\(\)\) return;[\s\S]*?if \(this\.isGuestCashEntryActive\(\)\)/
    );

    const startCheckout = methodSource(
        'startGuestCashCheckout: async function () {',
        '\n    findGuestCashReturnFocusTarget: function () {'
    );
    assert.match(startCheckout, /const guestCashActive = this\.isGuestCashEntryActive\(\);/);
    assert.match(startCheckout, /const discountCodeEnabled = guestCashActive && this\.guestCashEntryProbe\?\.discountEnabled === true;/);
});

test('a guest-capable direct purchase cannot flash the points flow while auth or preview is pending', () => {
    const copy = methodSource(
        'getPurchaseStageCopy: function (stage = \'configure\') {',
        '\n    // --- Guest cash entry'
    );
    assert.match(copy, /const guestCashEntryVisible = this\.isGuestCashEntryActive\(\) \|\| this\.isGuestCashEntryProbePending\(\);/);
    assert.match(copy, /nextLabel: guestCashEntryVisible/);

    const priceDisplay = methodSource(
        'isGuestPurchasePriceDisplay: function () {',
        '\n    formatPurchaseModalAmount: function'
    );
    assert.match(priceDisplay, /return this\.isGuestCashEntryCandidate\(\);/);

    const openModal = methodSource(
        'openPurchaseModal: function (productId, productName, productNameEn, price, rules, maxPurchaseQuantity = 99, purchaseNotes = \'\', usageInstructions = \'\', options = {}) {',
        '\n    closePurchaseModal: function (options = {}) {'
    );
    assert.match(openModal, /guestCashEligible: options\?\.guestCashEligible === true[\s\S]*?isShopProductGuestPurchasable\(liveProductForPricing, selectedSkuId\)/);
    assert.match(openModal, /guestCashModalGeneration = Number\(this\.guestCashModalGeneration \|\| 0\) \+ 1;/);

    const confirm = methodSource(
        'confirmPurchase: async function ({ triggerButton = null } = {}) {',
        '\n    injectPremiumStyles: function () {'
    );
    assert.match(confirm, /if \(this\.isGuestCashEntryCandidate\(\)\) \{[\s\S]*?await this\.startGuestCashCheckout\(\);/);
    assert.match(confirm, /该游客商品暂时无法现金结算，请稍后重试。/);
});

test('a guest product card preserves its cash qualification when the product cache refresh lags', () => {
    const cardDataset = methodSource(
        'buildProductCardPurchaseDataset: function (product, unitPrice) {',
        '\n    buildProductCardPricingState: function'
    );
    assert.match(cardDataset, /guestCashEligible: this\.isShopProductGuestPurchasable\(product, defaultSku\?\.id \|\| ''\)/);

    const applyDataset = methodSource(
        'applyShopPurchaseDataset: function (element, payload = {}) {',
        '\n    getShopPurchasePayloadFromDataset: function'
    );
    assert.match(applyDataset, /element\.dataset\.guestCashEligible = payload\.guestCashEligible \? 'true' : 'false';/);

    const readDataset = methodSource(
        'getShopPurchasePayloadFromDataset: function (dataset = {}) {',
        '\n    normalizeShopManualDeliveryFlag: function'
    );
    assert.match(readDataset, /guestCashEligible: dataset\.guestCashEligible === 'true'/);

    const openFromCard = methodSource(
        'openProductPurchaseFromDataset: function (dataset = {}, sourceContext = resolveShopSourceContext(), options = {}) {',
        '\n    trackProductAddToCartFromDataset: function'
    );
    assert.match(openFromCard, /guestCashEligible: payload\.guestCashEligible === true/);

    const buyProduct = methodSource(
        'buyProduct: async function (productId, productName, productNameEn, price, rulesStr, maxPurchaseQuantity = 99, showPurchaseNotes = false, purchaseNotesEncoded = \'\', showUsageInstructions = false, usageInstructionsEncoded = \'\', productCategory = \'\', sourceContext = null, options = {}) {',
        '\n    openPurchaseModal: function'
    );
    assert.match(buyProduct, /guestCashEligible: options\?\.guestCashEligible === true/);
});

test('closing and reopening the same guest SKU invalidates stale auth and availability callbacks', () => {
    const probe = methodSource(
        'maybeProbeGuestCashEntry: function () {',
        '\n    // Re-render the open purchase modal'
    );
    assert.match(probe, /const purchase = this\.currentPurchase;/);
    assert.match(probe, /const modalGeneration = Number\(this\.guestCashModalGeneration \|\| 0\);/);
    assert.match(probe, /modalGeneration !== Number\(this\.guestCashModalGeneration \|\| 0\) \|\| this\.currentPurchase !== purchase/);

    const refresh = methodSource(
        'refreshGuestCashEntryForOpenModal: async function () {',
        '\n    // Routes a logged-out primary-action click'
    );
    assert.match(refresh, /resolveShopAuthState\(\{ apply: false \}\)/);
    assert.match(refresh, /this\.currentPurchase !== purchase/);
    assert.match(refresh, /this\.shopAuthStateKnown = resolvedAuthState;/);

    const close = methodSource(
        'closePurchaseModal: function (options = {}) {',
        '\n    updatePriceForQuantity: function'
    );
    assert.match(close, /guestCashModalGeneration = Number\(this\.guestCashModalGeneration \|\| 0\) \+ 1;/);
    assert.match(close, /guestCashEntryProbeToken = Number\(this\.guestCashEntryProbeToken \|\| 0\) \+ 1;/);
    assert.match(close, /guestCashEntryProbe = null;/);
});

test('quantity delta sequence stays responsive while guest preview requests are pending', () => {
    const adjustQuantity = methodSource(
        'adjustQuantity: function (delta) {',
        '\n    // Handle direct keyboard input'
    );
    const quantityInput = { value: '1' };
    const updates = [];
    const adjust = Function(
        'document',
        `return ({${adjustQuantity}}).adjustQuantity;`
    )({
        getElementById: (id) => id === 'purchaseQuantity' ? quantityInput : null
    });
    const purchase = {
        quantity: 1
    };
    const client = {
        currentPurchase: purchase,
        isGuestCashEntryActive: () => false,
        isShopCurrentPurchaseManualDelivery: () => false,
        isShopCurrentPurchaseSoldOut: () => false,
        getCurrentPurchaseQuantityCap: () => 3,
        updatePriceForQuantity: (quantity) => updates.push(quantity)
    };

    [1, 1, -1, -1, 1, 1].forEach((delta) => adjust.call(client, delta));

    assert.equal(purchase.quantity, 3);
    assert.equal(quantityInput.value, '3');
    assert.deepEqual(updates, [2, 3, 2, 1, 2, 3]);
});

test('quantity adjustment normalizes string state before applying a delta', () => {
    const adjustQuantity = methodSource(
        'adjustQuantity: function (delta) {',
        '\n    // Handle direct keyboard input'
    );
    const quantityInput = { value: '3' };
    const updates = [];
    const adjust = Function(
        'document',
        `return ({${adjustQuantity}}).adjustQuantity;`
    )({
        getElementById: (id) => id === 'purchaseQuantity' ? quantityInput : null
    });
    const purchase = { quantity: '3' };
    const client = {
        currentPurchase: purchase,
        isGuestCashEntryActive: () => false,
        isShopCurrentPurchaseManualDelivery: () => false,
        isShopCurrentPurchaseSoldOut: () => false,
        getCurrentPurchaseQuantityCap: () => 3,
        updatePriceForQuantity: (quantity) => updates.push(quantity)
    };

    adjust.call(client, -1);

    assert.equal(purchase.quantity, 2);
    assert.equal(quantityInput.value, '2');
    assert.deepEqual(updates, [2]);
});

test('quantity stepper keeps working at boundaries and only blocks forbidden states', () => {
    const adjustQuantity = methodSource(
        'adjustQuantity: function (delta) {',
        '\n    // Handle direct keyboard input'
    );
    const quantityInput = { value: '3' };
    const updates = [];
    const adjust = Function(
        'document',
        `return ({${adjustQuantity}}).adjustQuantity;`
    )({
        getElementById: (id) => id === 'purchaseQuantity' ? quantityInput : null
    });
    const client = {
        currentPurchase: { quantity: 3 },
        purchaseProcessing: false,
        isGuestCashEntryActive: () => true,
        showGuestQuantityLimitToast: () => {},
        showPurchaseQuantityLimitToast: () => {},
        getGuestCashQuantityCap: () => 3,
        isShopCurrentPurchaseManualDelivery: () => false,
        isShopCurrentPurchaseSoldOut: () => false,
        updatePriceForQuantity: (quantity) => updates.push(quantity)
    };

    adjust.call(client, -1);
    adjust.call(client, 1);
    adjust.call(client, 1);

    assert.equal(client.currentPurchase.quantity, 3);
    assert.equal(quantityInput.value, '3');
    assert.deepEqual(updates, [2, 3]);

    client.isShopCurrentPurchaseSoldOut = () => true;
    adjust.call(client, 1);
    assert.equal(client.currentPurchase.quantity, 3);
    client.isShopCurrentPurchaseManualDelivery = () => true;
    adjust.call(client, -1);
    assert.equal(client.currentPurchase.quantity, 3);
});

test('partial realtime inventory snapshots do not mark the active SKU sold out', () => {
    const syncInventory = methodSource(
        'syncCurrentPurchaseInventoryFromCatalog: function () {',
        '\n    maybeShowShopDiscountEngagement: function () {'
    );
    const sync = Function(
        `return ({${syncInventory}}).syncCurrentPurchaseInventoryFromCatalog;`
    )();
    let stageCalls = 0;
    const previousSku = { id: 'sku-1', stock_count: 3, __shopStockCountKnown: true };
    const partialSku = { id: 'sku-1', stock_count: 0, __shopStockCountKnown: false };
    const client = {
        currentPurchase: {
            productId: 'product-1',
            productSkuId: 'sku-1',
            productSkus: [previousSku],
            quantity: 3,
            soldOut: false,
            manualDelivery: false,
            stage: 'configure'
        },
        getCachedProductById: () => ({
            id: 'product-1',
            max_purchase_quantity: 3,
            skus: [partialSku]
        }),
        getProductSkusForPurchase: (product) => product.skus || [],
        getPurchaseQuantityCapForProduct: () => 3,
        resolveShopProductSelectionManualDelivery: () => false,
        isShopProductSelectionSoldOut: () => true,
        setCurrentPurchaseQuantityCap: () => {
            throw new Error('partial snapshot should not update the active cap');
        },
        setPurchaseStage: () => { stageCalls += 1; }
    };

    sync.call(client);

    assert.equal(stageCalls, 0);
    assert.equal(client.currentPurchase.soldOut, false);
    assert.equal(client.currentPurchase.quantity, 3);
});

test('guest discount unavailable notice does not prompt automatically and pops up on interaction', () => {
    // 1. Confirm renderPurchaseModal does not automatically set inline notice when !guestDiscountEnabled
    assert.doesNotMatch(
        source,
        /if \(!guestDiscountEnabled\) \{[\s\S]*?setDiscountMessage\([\s\S]*?guestDiscountUnavailable/
    );

    // 2. Confirm showGuestDiscountUnavailableToast is defined and uses info variant
    assert.match(
        source,
        /showGuestDiscountUnavailableToast: function \(\) \{[\s\S]*?this\.showShopToast\([\s\S]*?guestDiscountUnavailable[\s\S]*?'info'\s*\);/
    );

    // 3. Confirm applyDiscount triggers the toast when guest discount is disabled
    assert.match(
        source,
        /if \(!guestGateEnabled\) \{[\s\S]*?this\.setDiscountMessage\(''\);[\s\S]*?if \(!silent\) \{[\s\S]*?this\.showGuestDiscountUnavailableToast\(\);/
    );

    // 4. Confirm focus and click interactions trigger the toast
    assert.match(
        source,
        /const handleDiscountInteraction = \(\) => \{[\s\S]*?this\.isGuestCashEntryActive\(\) && this\.guestCashEntryProbe\?\.discountEnabled !== true[\s\S]*?this\.showGuestDiscountUnavailableToast\(\);/
    );
    assert.match(
        source,
        /discountInputEl\?\.addEventListener\('focus', handleDiscountInteraction\);[\s\S]*?discountInputEl\?\.addEventListener\('click', handleDiscountInteraction\);/
    );
    assert.match(
        source,
        /discountInputWrap\?\.addEventListener\('click', handleDiscountInteraction\);/
    );
});

test('guest orders copy-all button is right aligned with delivery title and configure panel has hidden protection', () => {
    const ordersCss = fs.readFileSync(path.resolve(__dirname, '../css/guest-orders.css'), 'utf8');
    assert.match(
        ordersCss,
        /\.guest-orders-delivery-header-bar\s*\{[\s\S]*?justify-content:\s*space-between;[\s\S]*?align-items:\s*center;/
    );
    assert.match(
        ordersCss,
        /\.guest-orders-delivery-actions-bar\s*\{[\s\S]*?justify-content:\s*flex-end;/
    );

    const ordersHtml = fs.readFileSync(path.resolve(__dirname, '../guest-orders.html'), 'utf8');
    assert.match(
        ordersHtml,
        /<div class="guest-orders-delivery-header-bar">[\s\S]*?guest-orders-delivery-title[\s\S]*?guestOrdersDeliveryActionsBar[\s\S]*?<\/div>/
    );

    const shopCss = fs.readFileSync(path.resolve(__dirname, '../css/shop-page.css'), 'utf8');
    assert.match(
        shopCss,
        /\.guest-shop-modal__configure-panel\[hidden\][\s\S]*?display:\s*none !important;/
    );
});

test('light mode payment option loading dots color and back to list button text decoration', () => {
    const shopCss = fs.readFileSync(path.resolve(__dirname, '../css/shop-page.css'), 'utf8');
    assert.match(
        shopCss,
        /html:not\(\[data-theme="dark"\]\)[^}]*?\.guest-shop-modal__payment-option\.is-loading\s+\.guest-shop-modal__payment-loading\s*\{[\s\S]*?color:\s*#1e293b;/
    );

    const ordersCss = fs.readFileSync(path.resolve(__dirname, '../css/guest-orders.css'), 'utf8');
    assert.match(
        ordersCss,
        /#guestOrdersBackToListBtn\s*\{[\s\S]*?font-weight:\s*600;[\s\S]*?text-decoration:\s*none;/
    );
    assert.match(
        ordersCss,
        /#guestOrdersBackToListBtn:hover\s*\{[\s\S]*?transform:\s*translateY\(1px\);/
    );
});

test('modal amounts always include currency symbol and tiered rules popover shows currency instead of points', () => {
    // 1. Confirm formatPurchaseModalAmount unconditionally uses formatPurchasePriceDisplay
    assert.match(
        source,
        /formatPurchaseModalAmount: function \(value\) \{[\s\S]*?return this\.formatPurchasePriceDisplay\(value\);/
    );

    // 2. Confirm tiered pricing rules popover formats rule price with formatPurchasePriceDisplay
    assert.match(
        source,
        /buildTieredPricingRulesHelpHtml: function[\s\S]*?const formattedPrice = this\.formatPurchasePriceDisplay\(rule\.price\);/
    );

    // 3. Confirm locale files tieredPriceRuleInline do not reference {unit}
    const zhLocale = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../lang/zh.json'), 'utf8'));
    assert.equal(zhLocale.shop.tieredPriceRuleInline, '满 {qty} 件 {price}');

    const enLocale = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../lang/en.json'), 'utf8'));
    assert.equal(enLocale.shop.tieredPriceRuleInline, '{qty}+ {price}');
});
