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
        '.shop-product-delivery-filter-slot'
    ];

    for (const marker of styleMarkers) {
        assert.equal(stylesSource.includes(marker), true, `css/admin-studio-page.css should contain ${marker}`);
    }
});
