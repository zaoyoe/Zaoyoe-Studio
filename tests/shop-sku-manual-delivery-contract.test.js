const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('SKU manual delivery schema is added and backfilled from product-level manual delivery', () => {
    const migrationSource = readRepoFile('supabase/migrations/20260605_add_shop_sku_manual_delivery.sql');

    assert.match(
        migrationSource,
        /ALTER TABLE public\.shop_product_skus[\s\S]*ADD COLUMN IF NOT EXISTS manual_delivery BOOLEAN NOT NULL DEFAULT false/,
        'migration should add a non-null SKU manual delivery flag'
    );
    assert.match(
        migrationSource,
        /UPDATE public\.shop_product_skus s[\s\S]*FROM public\.shop_products p[\s\S]*s\.product_id = p\.id[\s\S]*COALESCE\(p\.manual_delivery, false\)/,
        'existing SKUs should inherit the old product-level manual delivery state'
    );
});

test('admin product editor renders and saves manual delivery per SKU row', () => {
    const adminSource = readRepoFile('js/admin-shop.js');
    const mutateSource = readRepoFile('server/api-handlers/admin/shop/mutate.js');
    const productsSource = readRepoFile('server/api-handlers/admin/shop/products.js');

    assert.match(
        adminSource,
        /normalizeProductSkus: function[\s\S]*manual_delivery: this\.normalizeSkuManualDeliveryFlag\(sku\.manual_delivery \?\? sku\.manualDelivery, false\)/,
        'admin SKU normalization should keep the SKU manual delivery flag'
    );
    assert.match(
        adminSource,
        /data-product-sku-field="manual_delivery"[\s\S]*人工/,
        'the SKU editor row should expose an independent manual delivery checkbox'
    );
    assert.match(
        adminSource,
        /collectProductSkuEditorRows: function[\s\S]*manual_delivery: read\('manual_delivery'\)\?\.checked === true/,
        'saving the product modal should serialize per-SKU manual delivery'
    );
    assert.match(
        mutateSource,
        /SHOP_PRODUCT_SKU_SELECT[\s\S]*'inventory_sku_id',[\s\S]*'manual_delivery',[\s\S]*'price_points'/,
        'admin mutations should return SKU manual delivery in SKU selects'
    );
    assert.match(
        mutateSource,
        /normalizeProductSkuDrafts[\s\S]*manual_delivery: normalizeBoolean\(source\.manual_delivery \?\? source\.manualDelivery, false\)/,
        'admin mutations should normalize the per-SKU manual delivery payload'
    );
    assert.match(
        mutateSource,
        /const basePayload = \{[\s\S]*manual_delivery: draft\.manual_delivery === true/,
        'admin mutations should persist per-SKU manual delivery on insert/update'
    );
    assert.match(
        productsSource,
        /SHOP_PRODUCT_SKU_SELECT[\s\S]*'manual_delivery'[\s\S]*SHOP_PRODUCT_SKU_SELECT_WITHOUT_MANUAL_DELIVERY/,
        'admin product reads should include SKU manual delivery with a schema fallback'
    );
});

test('public shop exposes SKU manual delivery and purchase availability checks selected SKU first', () => {
    const publicHandlerSource = readRepoFile('server/api-handlers/public/shop.js');

    assert.match(
        publicHandlerSource,
        /function resolvePublicShopSkuManualDelivery\(sku = \{\}, product = \{\}\)[\s\S]*hasSkuManualDelivery[\s\S]*normalizeBoolean\(sku\?\.manual_delivery \?\? sku\?\.manualDelivery, false\)[\s\S]*normalizeBoolean\(product\?\.manual_delivery \?\? product\?\.manualDelivery, false\)/,
        'public catalog should prefer SKU manual delivery and only fall back to product-level state'
    );
    assert.match(
        publicHandlerSource,
        /selectAttempts = \[[\s\S]*inventory_sku_id, inventory_source_sku_ids, inventory_source_sku_ids_intl, manual_delivery, price_points[\s\S]*inventory_sku_id, manual_delivery, price_points[\s\S]*spec_values, manual_delivery, price_points/,
        'public catalog should select SKU manual delivery with compatibility fallbacks'
    );
    assert.match(
        publicHandlerSource,
        /async function loadShopProductPurchaseAvailability\(dataSupabase, productId = '', productSkuId = ''\)/,
        'purchase availability should accept a selected SKU id'
    );
    assert.match(
        publicHandlerSource,
        /hasSkuManualDelivery[\s\S]*manualDelivery: hasSkuManualDelivery[\s\S]*normalizeBoolean\(skuData\?\.manual_delivery, false\)[\s\S]*productManualDelivery/,
        'purchase availability should let SKU manual delivery override product-level state'
    );
    assert.match(
        publicHandlerSource,
        /loadShopProductPurchaseAvailability\(availabilityClient, payload\.productId, payload\.productSkuId\)/,
        'purchase endpoint should pass the selected SKU into the availability check'
    );
});

test('storefront interaction follows selected SKU manual delivery state', () => {
    const shopSource = readRepoFile('js/shop-client.js');

    assert.match(
        shopSource,
        /isShopSkuManualDelivery: function \(product = \{\}, sku = null\)[\s\S]*hasShopSkuManualDeliveryField\(sku\)[\s\S]*sku\.manual_delivery \?\? sku\.manualDelivery[\s\S]*isShopProductManualDelivery\(product\)/,
        'storefront should prefer SKU manual delivery and use product-level state only as a fallback'
    );
    assert.match(
        shopSource,
        /resolveShopProductSelectionManualDelivery: function[\s\S]*getDefaultPurchaseSku\(product\)[\s\S]*isShopSkuManualDelivery\(product, selectedSku\)/,
        'storefront should resolve the default or selected SKU manual delivery state'
    );
    assert.match(
        shopSource,
        /selectPurchaseSku: function[\s\S]*const manualDelivery = this\.isShopSkuManualDelivery\(product, sku\)[\s\S]*this\.currentPurchase\.manualDelivery = manualDelivery[\s\S]*this\.setPurchaseStage\('configure'\)/,
        'changing purchase SKU should immediately refresh manual delivery controls'
    );
    assert.match(
        shopSource,
        /selectPurchaseSku: function[\s\S]*const manualDelivery = this\.isShopSkuManualDelivery\(product, sku\)[\s\S]*this\.currentPurchase\.soldOut = !manualDelivery && this\.getShopSkuStockCount\(sku\) <= 0;/,
        'changing purchase SKU should allow zero-stock SKUs while switching the modal into sold-out state'
    );
    assert.doesNotMatch(
        shopSource,
        /if \(Number\(sku\.stock_count \|\| 0\) <= 0 && !manualDelivery\) return;/,
        'zero-stock auto-delivery SKUs should not be blocked before selection'
    );
    assert.match(
        shopSource,
        /addProductToCart: function[\s\S]*resolveShopProductSelectionManualDelivery\(product, selectedSkuId\)[\s\S]*showManualDeliveryProductToast/,
        'adding to cart should block only the selected manual-delivery SKU'
    );
    assert.match(
        shopSource,
        /renderPurchaseSkuPills: function[\s\S]*const soldOut = stock <= 0 && !manualDelivery;[\s\S]*const disabled = !skuId;[\s\S]*is-sold-out/,
        'zero-stock SKU pills should stay selectable and only carry a sold-out visual state'
    );
    assert.match(
        shopSource,
        /getShopProductCardFulfillmentState: function[\s\S]*const autoStockSku = this\.getPreferredAutoDeliverySkuFromList\(product, skus\);[\s\S]*const manualSku = this\.getPreferredManualDeliverySkuFromList\(product, skus\);[\s\S]*const manualDelivery = hasSkuRows[\s\S]*\(!autoStockSku && Boolean\(manualSku\)\)[\s\S]*const soldOut = hasSkuRows[\s\S]*\(!autoStockSku && !manualSku\)/,
        'storefront cards should prefer in-stock auto-delivery SKUs, then manual-delivery SKUs, before marking the card sold out'
    );
    assert.match(
        shopSource,
        /getShopProductCardStockCount: function \(product = \{\}\) \{[\s\S]*const skus = this\.getProductSkusForPurchase\(product\);[\s\S]*const inventorySkus = \(Array\.isArray\(product\?\.inventory_skus\)[\s\S]*const stockByInventoryPool = new Map\(\);[\s\S]*const stockBySkuId = new Map\(\);[\s\S]*inventorySkus\.forEach\(\(sku\) => \{[\s\S]*sku\?\.inventory_source_sku_ids[\s\S]*const allSourceStocksKnown = sourceIds\.every[\s\S]*sourceIds\.forEach\(\(sourceId\) => \{[\s\S]*Math\.max\(stockByInventoryPool\.get\(inventoryKey\) \|\| 0, stockBySkuId\.get\(inventoryKey\) \|\| 0\)[\s\S]*reduce\(\(total, stockCount\) => total \+ stockCount, 0\);[\s\S]*\}/,
        'storefront card stock should sum all visible SKU inventory pools instead of showing only the display SKU'
    );
    assert.match(
        shopSource,
        /syncProductCardPricing: function[\s\S]*const stockCount = this\.getShopProductCardStockCount\(product\);[\s\S]*buildProductCardElement: function[\s\S]*const stockCount = this\.getShopProductCardStockCount\(product\);/,
        'both initial product cards and refreshed cards should render the aggregate SKU stock badge'
    );
});
