const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('admin marketplace renders a dedicated no-code Xianyu fulfillment module', () => {
    const html = readRepoFile('admin-studio.html');
    const configJs = readRepoFile('admin-config.js');
    const studioJs = readRepoFile('admin-studio.js');
    const bootstrapJs = readRepoFile('js/admin-studio-bootstrap.js');
    const css = readRepoFile('admin-studio.css');

    [
        'data-module="xianyu-fulfillment"',
        'id="module-xianyu-fulfillment"',
        '<span>闲鱼发货</span>',
        '添加发货规则',
        'xianyuTopTabs=20260525_XIANYU_TOP_TABS_1',
        'xianyuMappingCollapse=20260525_XIANYU_MAPPING_COLLAPSE_1',
        'xianyuStageWidth=20260525_XIANYU_STAGE_WIDTH_1',
        'xianyuProductPickerInline=20260525_XIANYU_PRODUCT_PICKER_INLINE_1',
        'id="xianyuFulfillmentTabsNav"',
        'data-admin-action="marketplace-switch-xianyu-tab"',
        'data-xianyu-tab="overview"',
        'data-xianyu-tab="mappings"',
        'data-xianyu-tab="accounts"',
        'data-xianyu-tab="advanced"',
        'data-xianyu-panel="overview"',
        'data-xianyu-panel="mappings"',
        'data-xianyu-panel="accounts"',
        'data-xianyu-panel="advanced"',
        '商品映射',
        '账号接口',
        'class="xianyu-fulfillment-admin-link"',
        'href="https://xianyu-admin.fatherkey.com/admin"',
        'target="_blank"',
        'rel="noopener noreferrer"',
        '打开 KVM4 管理台',
        'id="marketplaceXianyuEnabledToggle"',
        'id="marketplaceXianyuDefaultAccount"',
        'class="config-input marketplace-native-select"',
        'id="marketplaceXianyuDefaultAccountDropdown"',
        'data-sync-select-id="marketplaceXianyuDefaultAccount"',
        'id="marketplaceXianyuReadinessPanel"',
        'id="marketplaceXianyuReadinessSummary"',
        'id="marketplaceXianyuReadinessList"',
        'data-admin-action="marketplace-run-xianyu-readiness"',
        '上线自检',
        'id="marketplaceXianyuRecoveryPanel"',
        'id="marketplaceXianyuRecoverySummary"',
        'id="marketplaceXianyuRecoveryStats"',
        'id="marketplaceXianyuRecoveryList"',
        'data-admin-action="marketplace-refresh-xianyu-failures"',
        '异常订单处理',
        '刷新异常',
        '未指定账号时使用；多账号仍可分别发货',
        '每个闲鱼账号有自己的接口密钥',
        '后续可扩展独立库存或混合库存',
        '底层配置已预留手动、混合、停用等模式',
        'id="marketplaceXianyuAccountsList"',
        'data-admin-action="marketplace-add-xianyu-account"',
        'id="marketplaceXianyuProductMappingsList"',
        'data-admin-action="marketplace-add-product-mapping"',
        'id="marketplaceChannelsConfigJson" rows="22"',
        'id="marketplaceChannelsSecretsJson" rows="12"',
        '商品发货规则',
        '高级 JSON 配置（排查时使用）',
        '保存闲鱼自动发货设置'
    ].forEach((marker) => {
        assert.equal(html.includes(marker), true, `admin-studio.html should contain ${marker}`);
    });

    assert.equal(
        html.includes('<span>商城渠道注册表</span>'),
        false,
        'marketplace card should not expose the old JSON-first title'
    );
    assert.equal(
        html.includes('开发者高级配置'),
        false,
        'marketplace card should avoid developer-first advanced wording'
    );
    assert.equal(
        html.includes('id="xianyuFulfillmentTitle"'),
        false,
        'xianyu fulfillment module should not render the large instructional hero'
    );
    assert.equal(
        html.includes('<h2>闲鱼自动发货</h2>'),
        false,
        'xianyu fulfillment module should not render the top hero heading'
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
        'switchMarketplaceXianyuFulfillmentTab',
        'applyMarketplaceXianyuFulfillmentTabState',
        'normalizeMarketplaceXianyuFulfillmentTab',
        'marketplaceXianyuFulfillmentActiveTab',
        'collectMarketplaceXianyuConfigFromForm',
        'collectMarketplaceXianyuSecretInputs',
        'collectMarketplaceXianyuProductMappingsFromForm',
        'buildMarketplaceXianyuProductMappingRow',
        'ensureMarketplaceChannelConfigCardExpanded',
        'restoreMarketplaceAdvancedConfigState',
        'focusMarketplaceXianyuProductMapping',
        'scrollIntoView',
        'generateMarketplaceIngestToken',
        'copyMarketplaceIngestToken',
        'marketplace-copy-ingest-token',
        'resolveMarketplaceAccountKeyForAction',
        'loadMarketplaceProductPickerOptions',
        'loadMarketplaceProductPickerCatalog',
        'validateMarketplaceXianyuReadiness',
        'renderMarketplaceXianyuReadiness',
        'runMarketplaceXianyuReadinessCheck',
        'loadMarketplaceXianyuRecoveryTasks',
        'performMarketplaceXianyuDeliveryAction',
        "compact: 'marketplace_recovery'",
        "sourceChannel: 'xianyu'",
        "statuses: ['dead_letter', 'retry_waiting', 'requeued', 'processing']",
        'renderMarketplaceXianyuRecovery',
        'renderMarketplaceXianyuRecoveryTask',
        'fetchMarketplaceProductPickerProducts',
        'preloadMarketplaceProductPickerCatalog',
        'searchMarketplaceProductPickerOptions',
        'selectMarketplaceProductMapping',
        'clearMarketplaceProductMapping',
        'matchesMarketplaceProductPickerQuery',
        'getMarketplaceProductPickerLocalRows',
        'ShopAdmin?.productGridCache',
        'includeSkus: true',
        'renderMarketplaceProductSkuFieldHtml',
        'marketplace-sku-dropdown',
        'data-sync-input-id',
        'data-marketplace-product-sku-field',
        'allProductsLoaded',
        "fields: 'full'",
        "order: 'name_asc'",
        '网站商品加载失败',
        '已加载 ${loadedCount} 个可发货商品',
        '账号识别名',
        '发货接口密钥',
        '规则名称',
        '闲鱼商品编号',
        '发哪个网站商品',
        '发哪个网站规格',
        '闲鱼规格关键词',
        '规格子映射',
        '添加规格映射',
        'marketplace-add-product-mapping-child',
        'marketplace-remove-product-mapping-child',
        'marketplace-toggle-product-mapping-collapse',
        'toggleMarketplaceXianyuProductMappingCollapse',
        'resolveMarketplaceXianyuProductMappingRow',
        'setMarketplaceXianyuProductMappingRowCollapsed',
        'handleMarketplaceXianyuProductMappingCollapseAction',
        'bindMarketplaceXianyuProductMappingCollapseControls',
        'marketplaceProductMappingCollapseBound',
        'marketplaceXianyuProductMappingCollapsedKeys',
        'data-marketplace-product-mapping-collapsed',
        "actionEl.addEventListener('click', (event) => {",
        'handleMarketplaceXianyuProductMappingCollapseAction(actionEl, event)',
        'body.hidden = collapsed',
        'draft_group_key',
        'buildMarketplaceProductMappingGroups',
        'getMarketplaceProductMappingCollapseKey',
        'data-marketplace-product-mapping-collapse-key',
        'data-marketplace-product-mapping-child',
        '条规格',
        '高级匹配（通常不用填）',
        'data-marketplace-product-mapping-field="product_id"',
        'data-marketplace-product-search-input',
        'marketplace-product-picker__control-row',
        '已绑定网站商品',
        "searchParams.set('fields', 'picker')",
        '没有找到可发货的网站商品',
        '/api/admin?route=shop/products',
        '共享网站库存',
        '自动发货'
    ].forEach((marker) => {
        assert.equal(configJs.includes(marker), true, `admin-config.js should contain ${marker}`);
    });

    [
        '适配器 account 参数',
        '发货接口 Token',
        '<span>接口识别名</span>',
        '<span>闲鱼商品 ID</span>',
        '<span>SKU ID（可选）</span>',
        '<span>网站规格/SKU ID（可选）</span>',
        '<span>规格文字包含（可选）</span>',
        '<span>搜索并选择网站商品</span>',
        '`已绑定：${selectedId}`',
        '`已选择：${escapeConfigHtml(selectedProductId)}`',
        '闲鱼订单默认使用此账号发货',
        'class="config-input marketplace-sku-select"',
        'onclick="return window.handleMarketplaceXianyuProductMappingCollapseAction?.(this, event) === true ? false : undefined"'
    ].forEach((marker) => {
        assert.equal(configJs.includes(marker), false, `operator-facing config UI should avoid ${marker}`);
    });

    [
        "'xianyu-fulfillment'",
        "label: '闲鱼发货'",
        'warmXianyuFulfillmentModuleData',
        'loadMarketplaceChannelSettings?.()'
    ].forEach((marker) => {
        assert.equal(bootstrapJs.includes(marker), true, `admin-studio-bootstrap.js should contain ${marker}`);
    });

    [
        "case 'marketplace-toggle-xianyu-enabled'",
        "case 'marketplace-run-xianyu-readiness'",
        "case 'marketplace-refresh-xianyu-failures'",
        "case 'marketplace-xianyu-delivery-action'",
        "case 'marketplace-switch-xianyu-tab'",
        "case 'marketplace-toggle-xianyu-account'",
        "case 'marketplace-add-xianyu-account'",
        "case 'marketplace-remove-xianyu-account'",
        "case 'marketplace-generate-ingest-token'",
        "case 'marketplace-copy-ingest-token'",
        "case 'marketplace-add-product-mapping'",
        "case 'marketplace-remove-product-mapping'",
        "case 'marketplace-add-product-mapping-child'",
        "case 'marketplace-remove-product-mapping-child'",
        "case 'marketplace-toggle-product-mapping'",
        "case 'marketplace-toggle-product-mapping-collapse'",
        'window.handleMarketplaceXianyuProductMappingCollapseAction(actionEl, event)',
        'event.stopImmediatePropagation?.()',
        "case 'marketplace-select-product-mapping'",
        "case 'marketplace-clear-product-mapping'",
        "case 'marketplace-search-product-mapping'",
        "case 'marketplace-open-product-mapping'",
        "case 'marketplace-change-default-account'"
    ].forEach((marker) => {
        assert.equal(studioJs.includes(marker), true, `admin-studio.js should wire ${marker}`);
    });

    [
        '--xianyu-surface-raised',
        '--xianyu-card-header',
        '--xianyu-field-compact',
        '--xianyu-field-wide',
        'width: min(100%, var(--admin-studio-stage-max-width, 1600px))',
        'padding-right: var(--admin-studio-stage-inline-gutter, 24px)',
        '#module-xianyu-fulfillment > .module-content.xianyu-fulfillment-layout',
        'box-sizing: border-box',
        '[data-theme="dark"] .xianyu-fulfillment-layout',
        '.xianyu-fulfillment-shell',
        '.xianyu-fulfillment-topbar',
        'grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)',
        '.xianyu-fulfillment-topbar::before',
        '.xianyu-fulfillment-tabs',
        'grid-column: 2',
        '.xianyu-fulfillment-admin-link',
        'grid-column: 3',
        'justify-self: end',
        'justify-content: center',
        '.xianyu-fulfillment-panel[hidden]',
        '.xianyu-fulfillment-panel-heading',
        '.xianyu-fulfillment-overview-status',
        '.marketplace-readiness-panel',
        '.marketplace-readiness-item.is-error',
        '.marketplace-recovery-panel',
        '.marketplace-recovery-panel__head',
        '.marketplace-recovery-stats',
        '.marketplace-recovery-item',
        '.marketplace-recovery-action',
        '.marketplace-recovery-action--danger',
        '.marketplace-simple-panel',
        '.marketplace-simple-toolbar',
        '.marketplace-native-select',
        '.marketplace-default-account-dropdown',
        '.marketplace-account-card',
        '.marketplace-simple-field .config-input',
        '.marketplace-code-input',
        '.marketplace-product-mapping-section',
        '.marketplace-product-mapping-row',
        '.marketplace-product-mapping-row.is-collapsed',
        '.marketplace-product-mapping-row.is-newly-added',
        '.marketplace-product-mapping-summary',
        '.marketplace-product-mapping-summary__chips',
        '.marketplace-product-mapping-row__body',
        '.marketplace-product-mapping-row__body[hidden]',
        '.marketplace-mapping-child-section',
        '.marketplace-mapping-child-row',
        '.marketplace-channel-config-card:not(.collapsed) .config-card-body',
        '.marketplace-product-picker',
        '.marketplace-product-picker-field',
        '.marketplace-product-picker__control-row',
        'grid-template-columns: minmax(260px, 1fr) minmax(280px, 1fr)',
        '.marketplace-product-picker .marketplace-product-picker__search.config-input',
        '.marketplace-product-picker__menu',
        '.marketplace-product-picker__menu[hidden]',
        '.marketplace-product-picker__option',
        'max-width: none',
        'position: static',
        'max-width: 960px',
        '.marketplace-token-row',
        '.marketplace-copy-token-btn',
        '.marketplace-sku-dropdown',
        '.marketplace-sku-dropdown .dropdown-menu',
        'grid-template-columns: minmax(280px, 560px) minmax(260px, var(--xianyu-field-medium))',
        'grid-template-columns: repeat(3, minmax(220px, var(--xianyu-field-compact)))',
        'max-width: var(--xianyu-field-wide)',
        '@media (max-width: 1120px)',
        '.marketplace-rule-advanced',
        '.marketplace-field-hint',
        '.marketplace-advanced-config',
        '.marketplace-advanced-config .config-input-wrapper--stacked',
        'min-height: 360px',
        '#marketplaceChannelsSecretsJson.config-input--code'
    ].forEach((marker) => {
        assert.equal(css.includes(marker), true, `admin-studio.css should contain ${marker}`);
    });
});
