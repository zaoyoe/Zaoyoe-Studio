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

test('admin shop inventory renders procurement overview from admin API', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const shopSource = readRepoFile(path.join('js', 'admin-shop.js'));
    const apiAdminSource = readRepoFile(path.join('api', 'admin.js'));
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const loadProcurementApiBlock = extractFunctionBlock(shopSource, 'loadProcurementOverviewViaAdminApi: async function');
    const loadProcurementBlock = extractFunctionBlock(shopSource, 'loadProcurementOverview: async function');
    const renderProcurementBlock = extractFunctionBlock(shopSource, 'renderProcurementOverview: function');
    const renderProcurementContextBlock = extractFunctionBlock(shopSource, 'getProcurementOverviewRenderContext: function');
    const renderProcurementFilterBlock = extractFunctionBlock(shopSource, 'renderProcurementFilterBar: function');
    const renderProcurementBatchRowsBlock = extractFunctionBlock(shopSource, 'renderProcurementBatchRows: function');
    const resetProcurementFilterBlock = extractFunctionBlock(shopSource, 'resetProcurementOverviewFilters: function');
    const initProcurementDatePickersBlock = extractFunctionBlock(shopSource, 'initProcurementDatePickers: async function');
    const enhanceProcurementFiltersBlock = extractFunctionBlock(shopSource, 'enhanceProcurementFilterControls: function');
    const loadInventoryBlock = extractFunctionBlock(shopSource, 'loadInventoryList: async function');

    assert.equal(
        apiAdminSource.includes("const shopProcurementHandler = require('../server/api-handlers/admin/shop/procurement');"),
        true,
        'admin gateway should require the procurement overview handler'
    );
    assert.equal(
        apiAdminSource.includes("'shop/procurement': shopProcurementHandler"),
        true,
        'admin gateway should expose shop/procurement'
    );
    assert.equal(
        adminHtml.includes('id="shopProcurementOverview" class="shop-procurement-overview"'),
        true,
        'inventory view should mount the procurement overview container'
    );
    assert.equal(
        adminHtml.includes('data-shop-action="procurement-refresh"'),
        true,
        'inventory view should provide a delegated procurement refresh button'
    );
    assert.match(
        loadProcurementApiBlock,
        /const filters = this\.normalizeProcurementOverviewFilters\(params\.filters \|\| \{\}\);[\s\S]*this\.buildAdminShopUrl\('shop\/procurement', \{[\s\S]*site,[\s\S]*limit: params\.limit \|\| 1000,[\s\S]*\.\.\.filters/,
        'frontend should load procurement overview through the admin gateway with site scoping and filters'
    );
    assert.match(
        shopSource,
        /case 'procurement-refresh':[\s\S]*this\.loadProcurementOverview\(\{ force: true \}\);/,
        'delegated shop click handler should refresh procurement overview on demand'
    );
    assert.match(
        shopSource,
        /case 'procurement-filter-apply':[\s\S]*this\.applyProcurementOverviewFilters\(\);[\s\S]*case 'procurement-filter-reset':[\s\S]*this\.resetProcurementOverviewFilters\(\);/,
        'delegated shop click handler should apply and reset procurement filters'
    );
    assert.match(
        shopSource,
        /case 'procurement-date-open':[\s\S]*this\.openProcurementDatePicker\(actionEl\.dataset\.dateInputId\);/,
        'delegated shop click handler should open the custom procurement date picker'
    );
    assert.match(
        shopSource,
        /case 'procurement-quality-open':[\s\S]*this\.openProcurementQualityModal\(actionEl\.dataset\.procurementBatchId\);/,
        'delegated shop click handler should open the procurement quality verification modal'
    );
    assert.match(
        loadInventoryBlock,
        /void this\.loadProcurementOverview\(\);/,
        'inventory list refresh should refresh procurement overview without blocking the table'
    );
    assert.match(
        loadProcurementBlock,
        /getProcurementOverviewCachePayload\(site, options\)[\s\S]*shouldUseProcurementOverviewCache\(\{ force, cacheKey \}\)[\s\S]*getProcurementOverviewRequestParams\(\{ site, filters \}\)[\s\S]*finishProcurementOverviewLoad\(payload, \{ site, cacheKey, filters \}\)/,
        'procurement overview should cache by site and filters and render the latest payload'
    );
    assert.match(
        renderProcurementBlock,
        /renderProcurementFilterBar\(payload\)[\s\S]*质量分布[\s\S]*货源成本排行[\s\S]*renderContext\.batchTitle[\s\S]*renderProcurementBatchRows\(renderContext\.batchRecords\)/,
        'procurement overview should render filters, quality, source cost, and batch record sections'
    );
    assert.match(
        renderProcurementContextBlock,
        /batchRecords[\s\S]*batchTitle[\s\S]*采购批次记录/,
        'procurement overview render context should label the full batch record ledger'
    );
    assert.match(
        renderProcurementFilterBlock,
        /procurementFilterSearch[\s\S]*procurementFilterSource[\s\S]*procurementFilterQuality[\s\S]*procurementFilterCost[\s\S]*procurement-filter-apply[\s\S]*procurement-filter-reset/,
        'procurement overview should render searchable filter controls'
    );
    assert.match(
        renderProcurementFilterBlock,
        /procurementFilterSource[\s\S]*data-shop-custom-select="true"[\s\S]*procurementFilterQuality[\s\S]*data-shop-custom-select="true"[\s\S]*procurementFilterCost[\s\S]*data-shop-custom-select="true"/,
        'procurement filter dropdowns should use the shared custom select renderer'
    );
    assert.match(
        renderProcurementFilterBlock,
        /procurementFilterDateFrom" class="shop-procurement-date-input" type="text"[\s\S]*data-procurement-date-picker="from"[\s\S]*procurement-date-open[\s\S]*procurementFilterDateTo" class="shop-procurement-date-input" type="text"[\s\S]*data-procurement-date-picker="to"/,
        'procurement filter dates should render as custom text controls wired to the date picker'
    );
    assert.equal(
        renderProcurementFilterBlock.includes('type="date"'),
        false,
        'procurement filter dates should not use native browser date inputs'
    );
    assert.match(
        renderProcurementBlock,
        /container\.innerHTML[\s\S]*this\.enhanceProcurementFilterControls\(container\);/,
        'procurement overview should enhance custom controls after rendering dynamic HTML'
    );
    assert.match(
        resetProcurementFilterBlock,
        /element\._flatpickr[\s\S]*element\._flatpickr\.clear\(\)[\s\S]*element instanceof HTMLSelectElement[\s\S]*this\.syncShopCustomSelect\(element\)/,
        'resetting procurement filters should clear custom calendars and sync custom selects'
    );
    assert.match(
        initProcurementDatePickersBlock,
        /ensureAdminFlatpickr[\s\S]*dateFormat: 'Y-m-d'[\s\S]*monthSelectorType: 'static'[\s\S]*disableMobile: true[\s\S]*shop-procurement-date-calendar/,
        'procurement date pickers should load Flatpickr with custom styling and no native mobile picker'
    );
    assert.match(
        enhanceProcurementFiltersBlock,
        /this\.enhanceShopCustomSelects\(scope\);[\s\S]*this\.initProcurementDatePickers\(scope\);/,
        'procurement filter enhancement should initialize custom selects and date pickers together'
    );
    assert.match(
        renderProcurementBlock,
        /payload\.inventoryScope === 'shared' && payload\.site === 'intl'[\s\S]*国际站 · 共享库存/,
        'intl procurement overview should label that it is reading the shared inventory pool'
    );
    assert.match(
        renderProcurementBatchRowsBlock,
        /data-shop-action="procurement-quality-open"[\s\S]*data-procurement-batch-id/,
        'recent procurement rows should expose a quality verification action'
    );
    assert.match(
        renderProcurementBatchRowsBlock,
        /renderProcurementAutoQualityPill\(batch\)/,
        'recent procurement rows should show automatic quality suggestions'
    );
    assert.match(
        renderProcurementBatchRowsBlock,
        /net_profit_cny[\s\S]*recognized_revenue_cny[\s\S]*inventory_sold_rate[\s\S]*inventory_fault_rate[\s\S]*refund_order_count[\s\S]*negative_profit_order_count[\s\S]*missing_cost_item_count[\s\S]*avg_fulfillment_hours/,
        'batch rows should render profit, inventory quality, refund, negative-profit, missing-cost, and fulfillment signals'
    );
    assert.match(
        shopSource,
        /openProcurementQualityModal: function[\s\S]*renderProcurementAutoQualityPanel\(batch\)[\s\S]*procurementSourceTagsInput[\s\S]*submitProcurementQuality: async function[\s\S]*sourceTags[\s\S]*update_procurement_quality/,
        'frontend should render automatic scoring, source tags, and submit status metadata through shop/mutate'
    );
    for (const cssMarker of [
        '.shop-procurement-overview__metrics',
        '.shop-procurement-filter',
        '.shop-procurement-filter__field',
        '.shop-procurement-filter-select.shop-custom-select',
        '.shop-procurement-date-control',
        '.shop-procurement-date-input',
        '.shop-procurement-date-control__button',
        '.shop-procurement-date-calendar.flatpickr-calendar',
        '.shop-procurement-filter__btn',
        '.shop-procurement-quality-chip--watch',
        '.shop-procurement-source-row',
        '.shop-procurement-batch-row',
        '.shop-procurement-batch-row__performance',
        '.shop-procurement-batch-row__quality-action',
        '.shop-procurement-auto-quality',
        '.shop-procurement-quality-modal',
        '.shop-procurement-quality-auto',
        '.shop-procurement-source-tags',
        '.shop-import-source-auto-score[readonly]',
        'overflow: visible;',
        'html[data-theme="light"] #module-shop .shop-procurement-filter__field :is(input, select)',
        'html[data-theme="light"] #module-shop .shop-procurement-filter-select.shop-custom-select .shop-custom-select__trigger',
        'html[data-theme="light"] #module-shop .shop-procurement-date-control',
        'html[data-theme="light"] .shop-procurement-date-calendar.flatpickr-calendar',
        'html[data-theme="light"] #module-shop .shop-procurement-filter__btn',
        'html[data-theme="light"] #module-shop .shop-procurement-quality-chip strong',
        'html[data-theme="light"] #module-shop .shop-procurement-auto-quality',
        'html[data-theme="light"] #module-shop :is(\n    .shop-procurement-filter__field span',
        'html[data-theme="light"] #module-shop .shop-procurement-overview'
    ]) {
        assert.equal(stylesSource.includes(cssMarker), true, `styles should include ${cssMarker}`);
    }
    assert.equal(
        adminHtml.includes('procurementOverview=20260606_ADMIN_STUDIO_PROCUREMENT_OVERVIEW_7'),
        true,
        'admin studio CSS should be cache-busted for procurement overview styles'
    );
    assert.equal(
        adminHtml.includes('procurementOverview=20260606_ADMIN_SHOP_PROCUREMENT_OVERVIEW_8'),
        true,
        'admin shop JS should be cache-busted for procurement overview logic'
    );
});
