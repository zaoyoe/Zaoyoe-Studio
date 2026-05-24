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

test('shop import view patches product stock badges immediately after inventory import', () => {
    const shopSource = readRepoFile(path.join('js', 'admin-shop.js'));
    const doImportFromViewBlock = extractFunctionBlock(shopSource, 'doImportFromView: async function');
    const importInventoryBlock = extractFunctionBlock(shopSource, 'importInventory: async function');

    assert.equal(
        shopSource.includes('syncProductStockAfterInventoryMutation: function'),
        true,
        'ShopAdmin should expose a shared stock sync helper for inventory mutations'
    );
    assert.equal(
        shopSource.includes('patchImportTreeProductStock: function'),
        true,
        'ShopAdmin should patch the import tree stock badge without waiting for a tab reload'
    );
    assert.equal(
        shopSource.includes('patchInventoryProductListStock: function'),
        true,
        'ShopAdmin should keep the legacy inventory product selector in sync too'
    );
    assert.match(
        doImportFromViewBlock,
        /const \{ batchId, imported, stockCount \} = await this\.performInventoryImport/,
        'the import workspace should retain the exact stock count returned by the admin mutation'
    );
    assert.match(
        doImportFromViewBlock,
        /this\.syncProductStockAfterInventoryMutation\(\{[\s\S]*productId,[\s\S]*stockCount,[\s\S]*imported,[\s\S]*status[\s\S]*\}\);/,
        'the import workspace should sync the left tree stock count right after a successful import'
    );
    assert.ok(
        doImportFromViewBlock.indexOf('this.syncProductStockAfterInventoryMutation') < doImportFromViewBlock.indexOf('this.refreshInventoryStockViews'),
        'the left tree should update before slower background refreshes run'
    );
    assert.match(
        importInventoryBlock,
        /const result = await this\.callAdminMutation\('import_inventory'/,
        'legacy inventory import should retain the mutation response'
    );
    assert.match(
        importInventoryBlock,
        /this\.syncProductStockAfterInventoryMutation\(\{[\s\S]*productId: this\.selectedProductId,[\s\S]*stockCount: result\?\.stockCount,[\s\S]*imported,[\s\S]*status: importStatus[\s\S]*\}\);/,
        'legacy inventory import should also update cached stock counts'
    );
    assert.match(
        doImportFromViewBlock,
        /const skuId = document\.getElementById\('importViewSkuSelect'\)\?\.value \|\| this\.selectedImportViewProductSkuId \|\| '';/,
        'the import workspace should submit inventory into the selected product SKU'
    );
    assert.match(
        importInventoryBlock,
        /const skuId = document\.getElementById\('inventorySkuSelect'\)\?\.value \|\| this\.selectedProductSkuId \|\| '';/,
        'the legacy inventory view should submit inventory into the selected product SKU'
    );
    assert.match(
        shopSource,
        /performInventoryImport: async function \(\{ productId, skuId = '', contentLines[\s\S]*skuId: String\(skuId \|\| ''\)\.trim\(\),/,
        'the shared import helper should forward skuId to the admin mutation'
    );
});
