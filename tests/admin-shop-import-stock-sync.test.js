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
    const adminHtml = readRepoFile('admin-studio.html');
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const renderSkuSelectOptionsBlock = extractFunctionBlock(shopSource, 'renderSkuSelectOptions: function');
    const doImportFromViewBlock = extractFunctionBlock(shopSource, 'doImportFromView: async function');
    const importInventoryBlock = extractFunctionBlock(shopSource, 'importInventory: async function');
    const performInventoryImportBlock = extractFunctionBlock(shopSource, 'performInventoryImport: async function');
    const toggleInventorySourcePanelBlock = extractFunctionBlock(shopSource, 'toggleInventorySourcePanel: function');
    const initInventorySourceDateTimeBlock = extractFunctionBlock(shopSource, 'initInventorySourceDateTimePickers: async function');
    const buildInventoryProcurementPayloadBlock = extractFunctionBlock(shopSource, 'buildInventoryProcurementPayload: function');
    const showInventoryDetailBlock = extractFunctionBlock(shopSource, 'showInventoryDetail: async function');
    const searchOrdersBlock = extractFunctionBlock(shopSource, 'searchOrders: async function');
    const renderOrderDetailBodyBlock = extractFunctionBlock(shopSource, 'renderOrderDetailBody: function');

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
    assert.equal(
        shopSource.includes('buildInventoryProcurementPayload: function'),
        true,
        'ShopAdmin should collect shared procurement/source metadata for inventory imports'
    );
    for (const elementId of [
        'importViewSourceName',
        'importViewSourceUrl',
        'importViewSourceUnitCost',
        'importViewSourcePurchasedAt',
        'importViewSourceAutoScore',
        'importViewSourceTags',
        'importModalSourceName',
        'importModalSourceUrl',
        'importModalSourceUnitCost',
        'importModalSourcePurchasedAt',
        'importModalSourceAutoScore',
        'importModalSourceTags'
    ]) {
        assert.equal(adminHtml.includes(`id="${elementId}"`), true, `admin studio should render ${elementId}`);
    }
    for (const elementId of ['importViewSourcePurchasedAt', 'importModalSourcePurchasedAt']) {
        assert.equal(
            adminHtml.includes(`type="datetime-local" id="${elementId}"`),
            false,
            `${elementId} should not use the native browser datetime-local control`
        );
        assert.equal(
            adminHtml.includes(`id="${elementId}" class="glass-input shop-import-source-datetime-input"`),
            true,
            `${elementId} should render as a custom styled text input`
        );
        assert.equal(
            adminHtml.includes(`data-shop-action="inventory-source-datetime-open" data-date-input-id="${elementId}"`),
            true,
            `${elementId} should be wired to the custom datetime picker open action`
        );
    }
    assert.equal(
        adminHtml.includes('<details class="shop-import-source-panel'),
        false,
        'the procurement source panel should not rely on native details/summary in the import layout'
    );
    for (const bodyId of ['importViewSourcePanelBody', 'importModalSourcePanelBody']) {
        assert.equal(
            adminHtml.includes(`data-shop-action="inventory-source-toggle" aria-expanded="false" aria-controls="${bodyId}"`),
            true,
            `admin studio should wire ${bodyId} to an explicit delegated toggle button`
        );
        assert.equal(
            adminHtml.includes(`id="${bodyId}" class="shop-import-source-panel__body" hidden`),
            true,
            `admin studio should render ${bodyId} as a hidden body that can be expanded in normal layout flow`
        );
    }
    assert.equal(
        shopSource.includes('toggleInventorySourcePanel: function'),
        true,
        'ShopAdmin should expose an explicit procurement source panel toggle helper'
    );
    assert.match(
        shopSource,
        /case 'inventory-source-toggle':[\s\S]*event\.preventDefault\(\);[\s\S]*this\.toggleInventorySourcePanel\(actionEl\);/,
        'the delegated shop click handler should toggle procurement source panels'
    );
    assert.match(
        shopSource,
        /case 'inventory-source-datetime-open':[\s\S]*event\.preventDefault\(\);[\s\S]*this\.openInventorySourceDateTimePicker\(actionEl\.dataset\.dateInputId\);/,
        'the delegated shop click handler should open procurement source custom datetime pickers'
    );
    assert.match(
        toggleInventorySourcePanelBlock,
        /body\.hidden = !nextExpanded;[\s\S]*panel\.classList\.toggle\('is-open', nextExpanded\);/,
        'the procurement source panel toggle should update body visibility and open styling together'
    );
    assert.match(
        toggleInventorySourcePanelBlock,
        /if \(nextExpanded\)[\s\S]*this\.enhanceInventorySourceDateTimeControls\(panel\);/,
        'opening the procurement source panel should initialize custom datetime controls'
    );
    assert.match(
        initInventorySourceDateTimeBlock,
        /ensureAdminFlatpickr[\s\S]*enableTime: true[\s\S]*time_24hr: true[\s\S]*dateFormat: 'Y-m-d H:i'[\s\S]*disableMobile: true[\s\S]*shop-import-source-datetime-calendar/,
        'procurement source datetime pickers should use Flatpickr with custom date-time styling'
    );
    assert.match(
        buildInventoryProcurementPayloadBlock,
        /parseInventorySourceDateTimeValue\(purchasedAtRaw\)[\s\S]*parsedDate\.toISOString\(\)/,
        'inventory procurement payload should normalize custom datetime values before submit'
    );
    assert.match(
        doImportFromViewBlock,
        /const \{ batchId, imported, stockCount, procurementWarning \} = await this\.performInventoryImport/,
        'the import workspace should retain the exact stock count returned by the admin mutation'
    );
    assert.match(
        doImportFromViewBlock,
        /procurement = this\.buildInventoryProcurementPayload\('importView'\);[\s\S]*procurement/,
        'the import workspace should read procurement metadata before submitting inventory'
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
        renderSkuSelectOptionsBlock,
        /const uploadableSkus = safeSkus\.filter\(\(sku\) => !String\(sku\.inventory_sku_id \|\| ''\)\.trim\(\)\);[\s\S]*uploadableSkus\.some\(\(sku\) => sku\.id === selectedSkuId\)[\s\S]*uploadableSkus\.find\(\(sku\) => sku\.is_default\)\?\.id/,
        'SKU import selectors should default only to source SKUs that accept card uploads'
    );
    assert.match(
        renderSkuSelectOptionsBlock,
        /const disabled = meta\.isSharedAlias;[\s\S]*disabled \? ' disabled' : ''[\s\S]*data-shop-custom-select-note="\$\{this\.escapeForAttr\(note\)\}"[\s\S]*data-shop-custom-select-tone="\$\{meta\.isSharedAlias \? 'alias' : \(meta\.isPoolSource \? 'source' : 'standalone'\)\}"/,
        'SKU import selectors should show alias SKUs as disabled options with relation notes'
    );
    assert.match(
        shopSource,
        /getSkuImportBlocker: function \(productId = '', skuId = ''\)[\s\S]*inventory_sku_id[\s\S]*该规格共用其他规格库存，请上传到被关联的规格/,
        'the client should expose a blocker for shared-inventory alias SKU imports'
    );
    assert.match(
        performInventoryImportBlock,
        /const blocker = this\.getSkuImportBlocker\(resolvedProductId, skuId\);[\s\S]*if \(blocker\) \{[\s\S]*throw new Error\(blocker\.message\);/,
        'the shared import helper should reject alias SKU uploads before calling the mutation'
    );
    assert.match(
        importInventoryBlock,
        /const blocker = this\.getSkuImportBlocker\(this\.selectedProductId, skuId\);[\s\S]*this\.showActionToast\(blocker\.message, 'warning', \{ durationMs: 5000 \}\);[\s\S]*return;/,
        'the legacy inventory view should block alias SKU uploads before the confirm dialog'
    );
    assert.match(
        shopSource,
        /performInventoryImport: async function \(\{ productId, skuId = '', contentLines[\s\S]*skuId: String\(skuId \|\| ''\)\.trim\(\),/,
        'the shared import helper should forward skuId to the admin mutation'
    );
    assert.match(
        performInventoryImportBlock,
        /if \(procurement && typeof procurement === 'object'\) \{[\s\S]*mutationPayload\.procurement = procurement;/,
        'the shared import helper should forward procurement metadata only when present'
    );
    assert.match(
        performInventoryImportBlock,
        /procurementWarning: result\?\.procurementWarning \|\| result\?\.sourceWarning \|\| null/,
        'the shared import helper should surface source warnings returned by the admin mutation'
    );
    assert.match(
        showInventoryDetailBlock,
        /const procurementNotes = String\(procurementBatch\?\.notes \|\| inventorySource\?\.notes \|\| ''\)\.trim\(\);/,
        'inventory detail should read procurement notes from the imported procurement batch before falling back to source notes'
    );
    assert.match(
        showInventoryDetailBlock,
        /<div class="shop-inventory-detail-card-label">采购备注<\/div>[\s\S]*shop-inventory-detail-card-value--note/,
        'inventory detail should render procurement notes in the procurement section'
    );
    assert.equal(
        showInventoryDetailBlock.includes('data-shop-action="inventory-detail-close"'),
        false,
        'inventory detail should not render a top-right close button in the modal header'
    );
    assert.match(
        showInventoryDetailBlock,
        /const procurementProofUrl = String\(procurementBatch\?\.proof_url \|\| ''\)\.trim\(\);[\s\S]*<div class="shop-inventory-detail-card-label">凭证链接<\/div>/,
        'inventory detail should render procurement proof links when provided during import'
    );
    assert.match(
        showInventoryDetailBlock,
        /const sourceMetadata = inventorySource\?\.metadata[\s\S]*const procurementMetadata = procurementBatch\?\.metadata[\s\S]*const sourceTags = this\.normalizeProcurementSourceTags\(/,
        'inventory detail should derive procurement source tags from source and batch metadata'
    );
    assert.match(
        showInventoryDetailBlock,
        /sourceTagsMarkup[\s\S]*<div class="shop-inventory-detail-card-label">货源标签<\/div>/,
        'inventory detail should render procurement source tags when available'
    );
    assert.equal(
        adminHtml.includes('inventoryDetailNoClose=20260606_ADMIN_SHOP_INVENTORY_DETAIL_NO_CLOSE_1'),
        true,
        'admin studio should cache-bust the inventory detail no-close-button update'
    );
    assert.equal(
        adminHtml.includes('inventoryDetailSourceTags=20260606_ADMIN_SHOP_INVENTORY_DETAIL_SOURCE_TAGS_1'),
        true,
        'admin studio should cache-bust the inventory detail source tag update'
    );
    assert.equal(
        adminHtml.includes('<th>净利润</th>'),
        true,
        'admin studio should show a net profit column in the shop orders table'
    );
    assert.match(
        searchOrdersBlock,
        /<td data-label="净利润">\$\{this\.renderOrderProfitCell\(order\.profit_attribution\)\}<\/td>/,
        'shop order rows should render the backend profit attribution payload'
    );
    assert.match(
        renderOrderDetailBodyBlock,
        /const profitAttribution = payload\?\.profit_attribution \|\| order\?\.profit_attribution \|\| \{\};[\s\S]*const profitMarkup = this\.renderOrderProfitDetailSection\(profitAttribution, payment, order\);[\s\S]*\$\{profitMarkup\}/,
        'shop order detail should render the profit and reconciliation section from the shared payload'
    );
    assert.equal(
        adminHtml.includes('orderProfitAttribution=20260606_ADMIN_SHOP_ORDER_PROFIT_ATTRIBUTION_1'),
        true,
        'admin studio should cache-bust the admin shop order profit update'
    );
    assert.equal(
        adminHtml.includes('orderProfitAttribution=20260606_ADMIN_STUDIO_ORDER_PROFIT_ATTRIBUTION_1'),
        true,
        'admin studio should cache-bust the order profit styles'
    );
    assert.match(
        stylesSource,
        /\.shop-inventory-detail-modal \{[\s\S]*width: min\(960px, calc\(100vw - 48px\)\);[\s\S]*@media \(min-width: 900px\) \{[\s\S]*\.shop-inventory-detail-modal \{[\s\S]*width: min\(1040px, calc\(100vw - 72px\)\);/,
        'inventory detail modal should use a wider desktop layout instead of a narrow vertical strip'
    );
    assert.match(
        stylesSource,
        /\.shop-inventory-detail-card--note[\s\S]*\.shop-inventory-detail-card-value--note[\s\S]*white-space: pre-wrap;/,
        'inventory detail procurement notes should use a full-width readable note card'
    );
    assert.match(
        stylesSource,
        /\.shop-inventory-detail-source-tags[\s\S]*\.shop-inventory-detail-source-tags span[\s\S]*html\[data-theme="light"\] \.shop-inventory-detail-source-tags span/,
        'inventory detail source tags should render as readable chips in both themes'
    );
    assert.match(
        stylesSource,
        /\.shop-order-profit-cell[\s\S]*\.shop-order-profit-cell__trace[\s\S]*\.shop-order-detail-section--profit[\s\S]*\.shop-order-profit-summary[\s\S]*\.shop-order-profit-summary__trace[\s\S]*html\[data-theme="light"\] #module-shop #shop-view-orders \.shop-order-profit-cell strong/,
        'shop order profit cells and detail cards should have readable styles in both themes'
    );
    assert.equal(
        shopSource.includes('getPointSourceTraceabilityLabel: function'),
        true,
        'admin shop should normalize point-source traceability labels for order profit views'
    );
    assert.equal(
        shopSource.includes('shop-order-profit-summary__trace'),
        true,
        'order profit detail should render point-source traceability state'
    );
    assert.equal(
        adminHtml.includes('pointSourceTraceability=20260606_ADMIN_SHOP_POINT_SOURCE_TRACEABILITY_1'),
        true,
        'admin shop JS should be cache-busted for point source traceability UI'
    );
    assert.equal(
        adminHtml.includes('pointSourceTraceability=20260606_ADMIN_STUDIO_POINT_SOURCE_TRACEABILITY_1'),
        true,
        'admin studio CSS should be cache-busted for point source traceability styles'
    );
    for (const cssMarker of [
        '.shop-import-source-datetime-control',
        '.shop-import-source-datetime-input',
        '.shop-import-source-datetime-control__button',
        '.shop-import-source-datetime-calendar.flatpickr-calendar',
        'html[data-theme="light"] #module-shop .shop-import-source-datetime-control',
        'html[data-theme="light"] .shop-import-source-datetime-calendar.flatpickr-calendar'
    ]) {
        assert.equal(stylesSource.includes(cssMarker), true, `styles should include ${cssMarker}`);
    }
    assert.equal(
        adminHtml.includes('importSourceDateTime=20260606_ADMIN_STUDIO_IMPORT_SOURCE_DATETIME_1'),
        true,
        'admin studio CSS should be cache-busted for import source datetime styles'
    );
    assert.equal(
        adminHtml.includes('importSourceDateTime=20260606_ADMIN_SHOP_IMPORT_SOURCE_DATETIME_1'),
        true,
        'admin shop JS should be cache-busted for import source datetime behavior'
    );
});
