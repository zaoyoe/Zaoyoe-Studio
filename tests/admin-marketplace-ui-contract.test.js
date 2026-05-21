const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('admin marketplace settings render a no-code Xianyu auto-delivery form', () => {
    const html = readRepoFile('admin-studio.html');
    const configJs = readRepoFile('admin-config.js');
    const studioJs = readRepoFile('admin-studio.js');
    const css = readRepoFile('admin-studio.css');

    [
        '<span>闲鱼自动发货</span>',
        'id="marketplaceXianyuEnabledToggle"',
        'id="marketplaceXianyuDefaultAccount"',
        'class="config-input marketplace-native-select"',
        'id="marketplaceXianyuDefaultAccountDropdown"',
        'data-sync-select-id="marketplaceXianyuDefaultAccount"',
        'id="marketplaceXianyuAccountsList"',
        'data-admin-action="marketplace-add-xianyu-account"',
        'id="marketplaceXianyuProductMappingsList"',
        'data-admin-action="marketplace-add-product-mapping"',
        '闲鱼商品映射',
        '开发者高级配置',
        '保存闲鱼自动发货设置'
    ].forEach((marker) => {
        assert.equal(html.includes(marker), true, `admin-studio.html should contain ${marker}`);
    });

    assert.equal(
        html.includes('<span>商城渠道注册表</span>'),
        false,
        'marketplace card should not expose the old JSON-first title'
    );

    const advancedStart = html.indexOf('<details class="marketplace-advanced-config">');
    const configJson = html.indexOf('id="marketplaceChannelsConfigJson"');
    const secretsJson = html.indexOf('id="marketplaceChannelsSecretsJson"');
    const advancedEnd = html.indexOf('</details>', advancedStart);
    assert.ok(advancedStart > -1, 'advanced marketplace JSON config should be inside a collapsed details panel');
    assert.ok(configJson > advancedStart && configJson < advancedEnd, 'registry JSON textarea should stay under advanced config');
    assert.ok(secretsJson > advancedStart && secretsJson < advancedEnd, 'secret JSON textarea should stay under advanced config');

    [
        'renderMarketplaceXianyuSimpleForm',
        'renderMarketplaceDefaultAccountDropdown',
        'collectMarketplaceXianyuConfigFromForm',
        'collectMarketplaceXianyuSecretInputs',
        'collectMarketplaceXianyuProductMappingsFromForm',
        'buildMarketplaceXianyuProductMappingRow',
        'ensureMarketplaceChannelConfigCardExpanded',
        'restoreMarketplaceAdvancedConfigState',
        'focusMarketplaceXianyuProductMapping',
        'scrollIntoView',
        'generateMarketplaceIngestToken',
        'resolveMarketplaceAccountKeyForAction',
        'loadMarketplaceProductPickerOptions',
        'loadMarketplaceProductPickerCatalog',
        'fetchMarketplaceProductPickerProducts',
        'preloadMarketplaceProductPickerCatalog',
        'searchMarketplaceProductPickerOptions',
        'selectMarketplaceProductMapping',
        'clearMarketplaceProductMapping',
        'matchesMarketplaceProductPickerQuery',
        'getMarketplaceProductPickerLocalRows',
        'ShopAdmin?.productGridCache',
        'allProductsLoaded',
        "fields: 'full'",
        "order: 'name_asc'",
        '网站商品加载失败',
        '已加载 ${loadedCount} 个可发货商品',
        '接口识别名',
        '闲鱼商品 ID',
        '搜索并选择网站商品',
        'data-marketplace-product-mapping-field="product_id"',
        'data-marketplace-product-search-input',
        "searchParams.set('fields', 'picker')",
        '没有找到可发货的网站商品',
        '/api/admin?route=shop/products',
        '共享网站库存',
        '自动发货'
    ].forEach((marker) => {
        assert.equal(configJs.includes(marker), true, `admin-config.js should contain ${marker}`);
    });

    assert.equal(
        configJs.includes('适配器 account 参数'),
        false,
        'operator-facing Xianyu account cards should avoid adapter jargon'
    );

    [
        "case 'marketplace-toggle-xianyu-enabled'",
        "case 'marketplace-toggle-xianyu-account'",
        "case 'marketplace-add-xianyu-account'",
        "case 'marketplace-remove-xianyu-account'",
        "case 'marketplace-generate-ingest-token'",
        "case 'marketplace-add-product-mapping'",
        "case 'marketplace-remove-product-mapping'",
        "case 'marketplace-toggle-product-mapping'",
        "case 'marketplace-select-product-mapping'",
        "case 'marketplace-clear-product-mapping'",
        "case 'marketplace-search-product-mapping'",
        "case 'marketplace-open-product-mapping'",
        "case 'marketplace-change-default-account'"
    ].forEach((marker) => {
        assert.equal(studioJs.includes(marker), true, `admin-studio.js should wire ${marker}`);
    });

    [
        '.marketplace-simple-panel',
        '.marketplace-simple-toolbar',
        '.marketplace-native-select',
        '.marketplace-default-account-dropdown',
        '.marketplace-account-card',
        '.marketplace-simple-field .config-input',
        '.marketplace-code-input',
        '.marketplace-product-mapping-section',
        '.marketplace-product-mapping-row',
        '.marketplace-product-mapping-row.is-newly-added',
        '.marketplace-channel-config-card:not(.collapsed) .config-card-body',
        '.marketplace-product-picker',
        '.marketplace-product-picker-field',
        '.marketplace-product-picker .marketplace-product-picker__search.config-input',
        '.marketplace-product-picker__menu',
        '.marketplace-product-picker__menu[hidden]',
        '.marketplace-product-picker__option',
        'max-width: none',
        'position: static',
        '.marketplace-token-row',
        '.marketplace-advanced-config'
    ].forEach((marker) => {
        assert.equal(css.includes(marker), true, `admin-studio.css should contain ${marker}`);
    });
});