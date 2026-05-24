const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('shop-related admin selects are marked for custom rendering instead of native system popups', () => {
    const adminHtml = readRepoFile('admin-studio.html');

    const markers = [
        'id="productDeliveryFilter" class="config-input shop-product-toolbar-select"\n                                    data-shop-custom-select="true"',
        'id="releaseProductSelect"\n                                data-shop-custom-select="true"',
        'id="importProductSelect"\n                                data-shop-custom-select="true"',
        'id="importViewSkuSelect"\n                                        data-shop-custom-select="true"',
        'id="inventorySkuSelect"\n                                        data-shop-custom-select="true"',
        'id="importModalSkuSelect"\n                                data-shop-custom-select="true"',
        'id="orderRefundStatusFilter" class="config-input shop-orders-filter-select"\n                                data-shop-custom-select="true"',
        'id="orderDeliveryStatusFilter" class="config-input shop-orders-filter-select"\n                                data-shop-custom-select="true"',
        'id="deliveryTaskStatusFilter" class="shop-delivery-filter"\n                                    data-shop-custom-select="true"',
        'id="deliveryAnalyticsWindowFilter" class="shop-delivery-filter"\n                                            data-shop-custom-select="true"',
        'id="deliveryDeadLetterReasonFilter" class="shop-delivery-filter"\n                                            data-shop-custom-select="true"',
        'id="deliveryLockStateFilter" class="shop-delivery-filter"\n                                            data-shop-custom-select="true"',
        'id="deliveryConflictAuditReasonFilter" class="shop-delivery-filter"\n                                            data-shop-custom-select="true"',
        'id="shopRiskCaseComposerOwnerSelect" class="config-input" data-shop-custom-select="true"',
        'data-shop-custom-select="true"\n                                                id="hp-shop-category"',
        'data-shop-custom-select="true"\n                                                id="hp-shop-sort"'
    ];

    for (const marker of markers) {
        assert.equal(adminHtml.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }
});

test('shop admin runtime exposes custom select enhancement and homepage sync hooks', () => {
    const shopSource = readRepoFile(path.join('js', 'admin-shop.js'));
    const homepageSource = readRepoFile('admin-homepage.js');
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));

    const runtimeMarkers = [
        'isManagedShopSelect: function (element)',
        'ensureShopCustomSelectBridge: function ()',
        'createShopCustomSelectWrapper: function (select)',
        'syncShopCustomSelect: function (selectOrId)',
        'enhanceShopCustomSelects: function (root = document)',
        'bindProductDeliveryFilterPlacement: function ()',
        'renderProductSkuEditor: function',
        'renderProductSkuEditorLoading: function',
        'productSkuEditorLoading',
        'collectProductSkuEditorRows: function',
        'product-add-sku-row',
        'product-remove-sku-row',
        'openProductSkuDeleteGuardModal: function',
        'product-export-sku-inventory',
        'exportProductSkuInventory: async function',
        'refreshImportSkuInventoryOverview: async function',
        'openInventoryFromImportView: function',
        'toggleImportSkuInventoryOverview: function',
        'setImportSkuInventoryStatus: function',
        'setImportSkuInventoryPage: function',
        'import-sku-inventory-toggle',
        'import-sku-inventory-status',
        'import-sku-inventory-page',
        'import-view-open-inventory',
        'inventory-clear-sku-filter',
        'this.enhanceShopCustomSelects();',
        'this.bindProductDeliveryFilterPlacement();',
        "window.ShopAdmin?.scheduleShopCustomSelectSync?.(el);"
    ];

    for (const marker of runtimeMarkers) {
        const source = marker.includes('scheduleShopCustomSelectSync') ? homepageSource : shopSource;
        assert.equal(source.includes(marker), true, `runtime should contain ${marker}`);
    }

    const styleMarkers = [
        'select[data-shop-custom-select="true"].shop-native-select--hidden',
        '.shop-custom-select__trigger',
        '.shop-custom-select__menu',
        '.shop-custom-select__option',
        '.shop-custom-select.is-open .shop-custom-select__menu',
        '.shop-import-inventory-overview',
        '.shop-inventory-sku-filter-badge',
        '.shop-product-sku-editor__loading',
        '.shop-product-delivery-filter-slot'
    ];

    for (const marker of styleMarkers) {
        assert.equal(stylesSource.includes(marker), true, `css/admin-studio-page.css should contain ${marker}`);
    }
});

test('editing an existing product waits for the full SKU payload before rendering rows', () => {
    const shopSource = readRepoFile(path.join('js', 'admin-shop.js'));

    assert.match(
        shopSource,
        /fillProductModalFromData: function \(data, options = \{\}\)[\s\S]*options\.skuLoading === true[\s\S]*this\.renderProductSkuEditorLoading\(skuEditorProduct\)/,
        'product modal should expose a SKU loading state while cached product rows are incomplete'
    );
    assert.match(
        shopSource,
        /const cachedProductHasSkus = Array\.isArray\(cachedProduct\.skus\);[\s\S]*this\.fillProductModalFromData\(cachedProduct, \{ skuLoading: !cachedProductHasSkus \}\)/,
        'editing from grid cache should not render a fallback default SKU until includeSkus details arrive'
    );
    assert.match(
        shopSource,
        /if \(this\.productSkuEditorLoading\)[\s\S]*商品规格还在加载中，请稍候再保存/,
        'saving should be blocked while SKU details are still loading'
    );
});

test('shop import view exposes per-SKU inventory overview and management shortcuts', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const shopSource = readRepoFile(path.join('js', 'admin-shop.js'));

    assert.equal(
        adminHtml.includes('id="importSkuInventoryOverview" class="shop-import-inventory-overview"'),
        true,
        'import page should render a per-SKU inventory overview panel'
    );
    assert.equal(
        adminHtml.includes('id="invFilterSku" value=""'),
        true,
        'inventory browser should preserve a hidden SKU filter for import-page deep links'
    );
    assert.equal(
        adminHtml.includes('data-shop-action="inventory-clear-sku-filter"'),
        true,
        'inventory browser should expose a visible way to clear SKU filtering'
    );
    assert.match(
        shopSource,
        /refreshImportSkuInventoryOverview: async function[\s\S]*Promise\.all\(\[[\s\S]*loadInventoryViaAdminApi\(\{[\s\S]*page,[\s\S]*pageSize,[\s\S]*productId,[\s\S]*skuId,[\s\S]*status,[\s\S]*includeOrderHints: true/,
        'import overview should load inventory by current product and SKU'
    );
    assert.match(
        shopSource,
        /status\s*\?\s*this\.loadInventoryViaAdminApi\(\{[\s\S]*page: 1,[\s\S]*pageSize: 1,[\s\S]*productId,[\s\S]*skuId,[\s\S]*includeOrderHints: false/,
        'status-filtered import overview should fetch unfiltered stats for clickable counters'
    );
    assert.match(
        shopSource,
        /data-shop-action="product-export-sku-inventory"[\s\S]*data-product-id="\$\{this\.escapeForAttr\(productId\)\}"[\s\S]*data-sku-id="\$\{this\.escapeForAttr\(skuId\)\}"/,
        'import overview export button should pass both product and SKU IDs to the shared exporter'
    );
    assert.match(
        shopSource,
        /data-shop-action="import-sku-inventory-toggle"[\s\S]*aria-expanded="\$\{expanded \? 'true' : 'false'\}"/,
        'import overview should default to a compact expandable summary'
    );
    assert.match(
        shopSource,
        /data-shop-action="import-sku-inventory-status"[\s\S]*data-inventory-status="\$\{this\.escapeForAttr\(key\)\}"/,
        'import overview status counters should be clickable filters'
    );
    assert.match(
        shopSource,
        /data-shop-action="import-sku-inventory-page"[\s\S]*data-inventory-page="\$\{currentPage \+ 1\}"/,
        'import overview should render pagination controls for more than one page of card inventory'
    );
    assert.match(
        shopSource,
        /openInventoryFromImportView: function[\s\S]*document\.getElementById\('invFilterProduct'\)[\s\S]*document\.getElementById\('invFilterSku'\)[\s\S]*this\.switchTab\('inventory', \{ load: false \}\)/,
        'import overview should jump into the inventory browser with product and SKU filters applied'
    );
    assert.match(
        shopSource,
        /exportProductSkuInventory: async function[\s\S]*source\?\.productId[\s\S]*document\.getElementById\('editProductId'\)/,
        'shared SKU exporter should accept productId from import-page buttons before falling back to the product modal'
    );
});
