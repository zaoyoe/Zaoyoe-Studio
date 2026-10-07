'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function extractFunctionBlock(source, marker) {
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `expected to find ${marker}`);
    const nextMarker = source.indexOf('\n    },', start);
    assert.notEqual(nextMarker, -1, `expected ${marker} block to end`);
    return source.slice(start, nextMarker);
}

test('admin shop exposes a safe 16688 supplier catalog import workspace', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const shopSource = readRepoFile('js/admin-shop.js');
    const stylesSource = readRepoFile('css/admin-studio-page.css');

    assert.match(adminHtml, /id="shop-view-supplier-catalog" class="shop-view/);
    assert.match(adminHtml, /id="supplierCatalogProvider"/);
    assert.match(adminHtml, /<option value="16688">16688<\/option>/);
    assert.match(adminHtml, /<option value="cn">国内站<\/option>/);
    assert.match(adminHtml, /<option value="intl">国际站<\/option>/);
    assert.match(adminHtml, /未上架草稿/);
    assert.match(adminHtml, /不会自动上架、不会启用供应商映射，也不会开放游客购买/);
    assert.match(adminHtml, /不会自动上架/);
    assert.match(adminHtml, /不会启用供应商映射/);
    assert.match(adminHtml, /不会开放游客购买/);
    assert.match(adminHtml, /data-shop-action="supplier-catalog-import"/);
    assert.match(adminHtml, /id="supplierCatalogDetailModal"/);
    assert.match(adminHtml, /data-shop-action="supplier-catalog-import-detail"/);

    assert.match(shopSource, /SHOP_TAB_IDS: \['products', 'supplier-catalog'/);
    assert.match(shopSource, /case 'supplier-catalog':\s*return this\.runShopTabLoader/);
    assert.match(shopSource, /getSupplierCatalogQuery: function \(\)/);
    assert.match(shopSource, /providerId.*16688/);
    assert.match(shopSource, /\['cn', 'intl'\]\.includes\(siteValue\)/);
    assert.match(shopSource, /buildAdminShopUrl\('shop\/supplier-catalog', params\)/);
    assert.match(shopSource, /action: 'list'/);
    assert.match(shopSource, /action: 'detail'/);
    assert.match(shopSource, /method: 'POST'/);
    assert.match(shopSource, /goodsNos: selectedGoodsNos/);
    assert.match(shopSource, /selectedGoodsNos\.length > 20/);
    assert.match(shopSource, /result\.status === 'failed'/);
    assert.match(shopSource, /imported_as_draft/);
    assert.match(shopSource, /already_imported/);
    assert.match(shopSource, /不会自动上架/);
    assert.match(shopSource, /不会启用供应商映射/);
    assert.match(shopSource, /openSupplierCatalogDetail/);
    assert.match(shopSource, /importSupplierCatalogDetail/);
    assert.match(shopSource, /closeSupplierCatalogDetail/);

    const importBlock = extractFunctionBlock(shopSource, 'importSupplierCatalogGoods: async function');
    assert.match(importBlock, /action: 'import'/);
    assert.match(importBlock, /providerId: query\.providerId/);
    assert.match(importBlock, /site: query\.site/);
    assert.match(importBlock, /goodsNos: selectedGoodsNos/);
    assert.match(importBlock, /this\.invalidateShopTabCache\('products'\)/);

    assert.match(stylesSource, /#module-shop #shop-view-supplier-catalog \.shop-supplier-catalog/);
    assert.match(stylesSource, /\.shop-supplier-catalog-detail-modal__content/);
    assert.match(stylesSource, /@media \(max-width: 640px\)/);
});

test('supplier catalog import is visibly fail-closed instead of auto-publishing products', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const shopSource = readRepoFile('js/admin-shop.js');

    const supplierCatalogHtml = adminHtml.slice(
        adminHtml.indexOf('id="shop-view-supplier-catalog"'),
        adminHtml.indexOf('<!-- 3. Import View', adminHtml.indexOf('id="shop-view-supplier-catalog"'))
    );
    const supplierImportBlock = extractFunctionBlock(shopSource, 'importSupplierCatalogGoods: async function');

    assert.match(supplierCatalogHtml, /未上架草稿/);
    assert.match(supplierCatalogHtml, /导入后不会自动上架/);
    assert.doesNotMatch(supplierImportBlock, /publish|auto.?publish|enable.*mapping|guest.*purchase/i);
    assert.match(supplierImportBlock, /导入后不会自动上架/);
});
