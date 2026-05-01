const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function getFunctionSegment(source, functionName, nextFunctionName) {
    const start = source.indexOf(`function ${functionName}`);
    const end = source.indexOf(`function ${nextFunctionName}`, start + 1);
    assert.notEqual(start, -1, `Expected ${functionName} to exist`);
    assert.notEqual(end, -1, `Expected ${nextFunctionName} to follow ${functionName}`);
    return source.slice(start, end);
}

test('points batches load renders rows before warming package filters', () => {
    const source = readRepoFile('admin-points.js');
    const loadBatchesSegment = getFunctionSegment(source, 'loadBatches', 'initBatchTableHorizontalScroll');

    assert.equal(
        loadBatchesSegment.includes('void loadPackagesForFilter({ site: currentSite });'),
        true,
        'loadBatches should warm package filters in the background'
    );
    assert.equal(
        loadBatchesSegment.includes('await loadPackagesForFilter()'),
        false,
        'loadBatches should not block the batch list on package filter options'
    );

    const warmIndex = loadBatchesSegment.indexOf('void loadPackagesForFilter({ site: currentSite });');
    const applyIndex = loadBatchesSegment.indexOf('applyBatchFilters();');
    assert.notEqual(warmIndex, -1, 'loadBatches should schedule the package filter warm path');
    assert.notEqual(applyIndex, -1, 'loadBatches should still render the filtered batch list');
    assert.ok(
        applyIndex > warmIndex,
        'loadBatches should proceed to apply filters after scheduling the background warm path'
    );
});

test('points batch filter package cache is scoped by site and supports loading placeholders', () => {
    const source = readRepoFile('admin-points.js');
    const loadPackagesSegment = getFunctionSegment(source, 'loadPackagesForFilter', 'renderBatches');

    const markers = [
        "let pointsBatchFilterPackagesSite = '';",
        "let pointsBatchFilterPackagesPendingSite = '';",
        'function hasPointsBatchFilterPackagesForSite(site = getPointsReadSite()) {',
        "loadingOption.textContent = '套餐加载中...';",
        'renderBatchPackageFilterOptions(fallbackPackages, { loading: true });',
        'pointsBatchFilterPackagesSite = normalizedSite;',
        'const filterChanged = renderBatchPackageFilterOptions(allPackages);'
    ];

    for (const marker of markers) {
        assert.equal(
            source.includes(marker),
            true,
            `admin-points.js should contain ${marker}`
        );
    }

    assert.equal(
        loadPackagesSegment.includes('fetchPointsCatalogSnapshot({ site: normalizedSite, force })'),
        true,
        'loadPackagesForFilter should fetch site-scoped catalog snapshots'
    );
    assert.equal(
        loadPackagesSegment.includes('if (!force && hasPointsBatchFilterPackagesForSite(normalizedSite)) {'),
        true,
        'loadPackagesForFilter should reuse package filters only for the active site cache'
    );
});

test('points batch mobile summary cards stay two-up on phone widths', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');

    assert.equal(
        styles.includes('20260429_ADMIN_STUDIO_POINTS_MOBILE_CARD_GRIDS_2UP_1'),
        true,
        'points mobile card grid fix should carry a unique marker'
    );
    assert.match(
        styles,
        /#module-points #points-view-batches \.points-batch-overview,[\s\S]*#module-points \.points-catalog-summary,[\s\S]*\.codes-modal\.codes-modal--batch \.points-batch-codes-summary-grid,[\s\S]*\.edit-modal--batch \.points-batch-edit-overview,[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/,
        'batch overview, catalog summary, batch detail, and batch edit cards should share two mobile columns'
    );
    assert.match(
        styles,
        /\.edit-modal--batch \.points-batch-edit-actions,[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/,
        'batch edit action tiles should not be pushed back to one mobile column'
    );
    assert.match(
        styles,
        /\.edit-modal--batch \.points-batch-edit-overview-card :is\([\s\S]*\.points-batch-edit-overview-card__label,[\s\S]*\.points-batch-edit-overview-card__value,[\s\S]*\.points-batch-edit-overview-card__meta[\s\S]*\) \{[\s\S]*overflow-wrap: anywhere !important;/,
        'batch edit overview text should wrap safely inside narrow two-column cards'
    );
    assert.equal(
        html.includes('pointsTwoColumnMobile=20260429_ADMIN_STUDIO_POINTS_MOBILE_CARD_GRIDS_2UP_1'),
        true,
        'admin studio should cache-bust the points mobile two-column card fix'
    );
});

test('admin studio mobile short forms and two-action groups stay two-up where they fit', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');

    assert.equal(
        styles.includes('20260429_ADMIN_STUDIO_MOBILE_TWO_UP_FIELDS_CONTROLS_1'),
        true,
        'shared mobile two-up form/control layer should carry a unique marker'
    );
    assert.match(
        styles,
        /\.admin-main-content \.module-container \.form-row:has\(> \.form-group:nth-child\(2\)\),[\s\S]*#module-points \.points-package-form__actions \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/,
        'mobile form rows and the points package editor controls should prefer two columns'
    );
    assert.match(
        styles,
        /\.admin-main-content \.module-container :is\([\s\S]*\.form-actions,[\s\S]*\.config-actions,[\s\S]*\.editor-actions,[\s\S]*\.batch-modal-actions[\s\S]*\):has\(> :is\(button, a, \.btn-primary, \.btn-secondary, \.btn-add-config, \.btn-sm, \.modal-action-btn\):nth-child\(2\):last-child\)[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/,
        'shared two-button action rows should stay two-up on mobile'
    );
    assert.match(
        styles,
        /#module-points \.points-site-context__item strong,[\s\S]*#module-points \.points-package-editor-metric \.value \{[\s\S]*overflow-wrap: anywhere !important;/,
        'points context and metrics text should wrap safely inside two-column mobile cards'
    );
    assert.equal(
        html.includes('mobileTwoUpFieldsControls=20260429_ADMIN_STUDIO_MOBILE_TWO_UP_FIELDS_CONTROLS_1'),
        true,
        'admin studio should cache-bust the shared mobile two-up form/control layer'
    );
});

test('points generate expiry picker is compact while staying below count on mobile', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');

    assert.equal(
        styles.includes('20260430_ADMIN_STUDIO_POINTS_GENERATE_EXPIRY_COMPACT_STACK_1'),
        true,
        'points generate expiry compact stack fix should carry a unique marker'
    );
    assert.match(
        styles,
        /#module-points #generateCodesForm \.points-generate-expiry-row > \.form-group:has\(#batchExpires\) \{[\s\S]*grid-column: 1 \/ -1 !important;[\s\S]*width: min\(100%, 320px\) !important;/,
        'the expiry field should move below the count but keep a compact width'
    );
    assert.equal(
        html.includes('class="form-row points-generate-expiry-row"'),
        true,
        'the count and expiry controls should be isolated from the other two-column rows'
    );
    assert.match(
        styles,
        /#module-points #generateCodesForm \.points-generate-expiry-row :is\([\s\S]*#batchCount,[\s\S]*#batchExpires,[\s\S]*\.flatpickr-mobile[\s\S]*\) \{[\s\S]*height: 44px !important;/,
        'count and expiry inputs should use a normal compact control height'
    );
    assert.equal(
        html.includes('pointsGenerateExpiryMobile=20260430_ADMIN_STUDIO_POINTS_GENERATE_EXPIRY_COMPACT_STACK_1'),
        true,
        'admin studio should cache-bust the points generate expiry compact stack fix'
    );
});

test('admin studio date and time controls stack on mobile before they can overflow', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');

    assert.equal(
        styles.includes('20260430_ADMIN_STUDIO_DATE_TIME_MOBILE_STACK_1'),
        true,
        'shared mobile date/time overflow guard should carry a unique marker'
    );
    assert.match(
        styles,
        /\.admin-main-content \.module-container :is\(\.form-row, \.input-group-row\):has\(:is\([\s\S]*input\[type="datetime-local"\][\s\S]*grid-template-columns: minmax\(0, 1fr\) !important;/,
        'form rows containing native date/time controls should collapse to one column on mobile'
    );
    assert.match(
        styles,
        /\.filter-custom-date,[\s\S]*#module-shop \.admin-studio-inline-style-attr-99,[\s\S]*#module-payments \.payments-date-menu \.custom-range-inputs \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important;/,
        'custom date ranges in filters, inventory, and payments should stack instead of squeezing two date inputs'
    );
    assert.match(
        styles,
        /#discountGenerateModal \.admin-discount-form-modal__datetime-row,[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important;/,
        'discount modal date plus time controls should stack on mobile'
    );
    assert.equal(
        html.includes('dateTimeMobileStack=20260430_ADMIN_STUDIO_DATE_TIME_MOBILE_STACK_1'),
        true,
        'admin studio should cache-bust the shared date/time mobile stack fix'
    );
});

test('similar admin studio mobile card grids stay two-up where cards are compact', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');

    assert.equal(
        styles.includes('20260429_ADMIN_STUDIO_MOBILE_SIMILAR_CARD_GRIDS_2UP_1'),
        true,
        'similar compact mobile card grids should carry a unique marker'
    );
    assert.match(
        styles,
        /#module-gallery \.admin-card-site-metrics,[\s\S]*#userModalOverlay \.users-coupon-summary-strip,[\s\S]*#userModalOverlay \.users-coupon-meta-grid,[\s\S]*#module-settings #settings-view-google-one #verifyMonitorFactsGrid\.verify-monitor-facts,[\s\S]*#module-payments \.payments-breakdown-stats,[\s\S]*#module-payments \.payments-cleanup-grid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/,
        'gallery metrics, user coupon summary/meta cards, Google One facts, and payments stats should keep two phone columns'
    );
    assert.match(
        styles,
        /#module-settings #settings-view-google-one #verifyMonitorFactsGrid \.verify-monitor-fact-list__label \{[\s\S]*white-space: normal !important;/,
        'Google One fact rows should wrap labels instead of clipping inside two-column phone cards'
    );
    assert.match(
        styles,
        /#module-payments :is\([\s\S]*\.payments-breakdown-stat small,[\s\S]*\.payments-breakdown-stat strong,[\s\S]*\.payments-cleanup-stat span,[\s\S]*\.payments-cleanup-stat strong[\s\S]*\) \{[\s\S]*overflow-wrap: anywhere !important;/,
        'payments compact stat text should wrap safely inside two-column phone cards'
    );
    assert.equal(
        html.includes('similarCardGridsMobile=20260429_ADMIN_STUDIO_MOBILE_SIMILAR_CARD_GRIDS_2UP_1'),
        true,
        'admin studio should cache-bust the similar mobile card grid fix'
    );
});
