'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('storefront card stock chip returns exact real stock count instead of vague words like "充足" or "非常多"', () => {
    const shopClientSource = readRepoFile('js/shop-client.js');
    const shopListLayoutSource = readRepoFile('js/shop-list-layout.js');

    // Verify shop-client.js getShopProductCardStockChipMeta logic
    assert.match(
        shopClientSource,
        /getShopProductCardStockChipMeta:\s*function\s*\([^)]*\)\s*\{[\s\S]*const stock = this\.getShopProductCardStockCount\(product\);[\s\S]*const chip = stock < 3 \? 'low' : \(stock <= 10 \? 'ok' : 'plenty'\);[\s\S]*return\s*\{\s*label:\s*String\(stock\),\s*kind:\s*'in-stock',\s*chip\s*\};/,
        'shop-client.js should return String(stock) as the label instead of labels.ok or labels.plenty'
    );

    // Verify shop-list-layout.js listStockMeta logic
    assert.match(
        shopListLayoutSource,
        /function listStockMeta\([^)]*\)\s*\{[\s\S]*const stock = getStockCount\(product\);[\s\S]*const chip = stock < 3 \? 'low' : \(stock <= 10 \? 'ok' : 'plenty'\);[\s\S]*return\s*\{\s*label:\s*String\(stock\),\s*kind:\s*'in-stock',\s*chip\s*\};/,
        'shop-list-layout.js should return String(stock) as the label instead of labels.ok or labels.plenty'
    );
});

test('storefront refreshes card chips when live guidance returns upstream supplier stock', () => {
    const shopClientSource = readRepoFile('js/shop-client.js');

    assert.match(
        shopClientSource,
        /refreshCurrentPurchaseGuidance:\s*async function\s*\([^)]*\)\s*\{[\s\S]*applySkuStockMap\(liveProduct\.inventory_skus\);[\s\S]*this\.refreshVisibleProductCardChips\(\);/,
        'refreshCurrentPurchaseGuidance should refresh visible product card chips when stock guidance updates'
    );

    assert.match(
        shopClientSource,
        /prefetchProductGuidanceStock:\s*async function\s*\(productId\)\s*\{[\s\S]*const guidance = await this\.loadProductGuidance\(id\);[\s\S]*this\.refreshVisibleProductCardChips\(\);/,
        'prefetchProductGuidanceStock should prefetch live guidance and update card chips on interaction'
    );
});

test('public catalog includes supplier availability in loadAvailableShopInventoryStockByProduct', () => {
    const publicShopSource = readRepoFile('server/api-handlers/public/shop.js');

    assert.match(
        publicShopSource,
        /loadAvailableShopInventoryStockByProduct[\s\S]*shop_supplier_product_mappings[\s\S]*shop_supplier_availability[\s\S]*avail\.available_quantity/,
        'loadAvailableShopInventoryStockByProduct should query supplier product mappings and availability'
    );

    assert.match(
        publicShopSource,
        /normalizeShopCatalogProductForSite[\s\S]*const aggregatedStockCount = skus\.length[\s\S]*reduce\(\(total,\s*s\)\s*=>\s*total\s*\+\s*\(Number\(s\.stock_count\)\s*\|\|\s*0\),\s*0\)[\s\S]*stock_count:\s*aggregatedStockCount/,
        'normalizeShopCatalogProductForSite should aggregate SKU stock_count into product.stock_count'
    );
});

test('syncSupplierProductStock updates product and default SKU stock for product-level mappings', () => {
    const stockSyncSource = readRepoFile('server/integrations/suppliers/stock-sync.js');

    assert.match(
        stockSyncSource,
        /if\s*\(targetMappings\.length\s*>\s*0\s*&&\s*\(refreshedLive\s*\|\|\s*enableMappings\)\)\s*\{[\s\S]*\.from\('shop_products'\)\s*\.update\(\{\s*stock_count:\s*totalStock[\s\S]*if\s*\(skuStockMap\.size\s*===\s*0\)\s*\{[\s\S]*\.from\('shop_product_skus'\)[\s\S]*\.update\(\{\s*stock_count:\s*totalStock/,
        'syncSupplierProductStock should persist totalStock to shop_products and default SKU even when mapping has no sku_id'
    );
});

test('Xiareng client count parser trims whitespace for safe integer parsing while rejecting non-numeric values', () => {
    const { buildXiarengForm } = require('../server/integrations/suppliers/xiareng/client');
    assert.equal(typeof buildXiarengForm, 'function');

    const clientSource = readRepoFile('server/integrations/suppliers/xiareng/client.js');
    assert.match(
        clientSource,
        /function count\(value\)\s*\{[\s\S]*const str = String\(value\)\.trim\(\);[\s\S]*![\/\^\\d\+\$\/]+\.test\(str\)[\s\S]*Number\.isSafeInteger\(parsed\)/,
        'count() should trim strings and parse safe integers'
    );
});

test('Xiareng client parses upstream salesCount from candidate fields and public shop aggregates upstream sales', () => {
    const clientSource = readRepoFile('server/integrations/suppliers/xiareng/client.js');
    assert.match(
        clientSource,
        /salesCount:\s*count\(source\.sales\s*\?\?\s*source\.sales_count\s*\?\?\s*source\.sold/,
        'xiareng client should extract salesCount from upstream sales/sold aliases'
    );

    const publicShopSource = readRepoFile('server/api-handlers/public/shop.js');
    assert.match(
        publicShopSource,
        /attachPublicShopProductSales[\s\S]*shop_supplier_product_mappings[\s\S]*raw = m\?\.import_snapshot\?\.salesCount[\s\S]*localCount\s*\+\s*upstreamCount/,
        'attachPublicShopProductSales should add upstream sales from import_snapshot to local order sales'
    );
});
