const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('product analytics indicator rails inherit semantic chart colors', () => {
    const panelLoaders = readRepoFile('js/admin-analytics-panel-loaders.js');
    const baseStyles = readRepoFile('admin-studio.css');
    const styles = readRepoFile('css/admin-studio-page.css');
    const html = readRepoFile('admin-studio.html');

    assert.equal(
        panelLoaders.includes('function getAnalyticsProductCategoryIndicatorColor(rowOrLabel = {}, index = 0)'),
        true,
        'product analytics should expose a shared category indicator color resolver'
    );
    assert.equal(
        panelLoaders.includes("key.includes('虚拟卡') || key.includes('virtualcard') || key.includes('vcard')"),
        true,
        'virtual-card categories should resolve to the semantic danger/red color'
    );
    assert.equal(
        panelLoaders.includes('const colors = rows.map((row, index) => getAnalyticsProductCategoryIndicatorColor(row, index));'),
        true,
        'category chart colors should use the same resolver as category cards'
    );
    assert.equal(
        panelLoaders.includes('backgroundColor: colors,'),
        true,
        'category doughnut segments should receive the resolved semantic colors'
    );
    assert.equal(
        panelLoaders.includes('<article class="analytics-product-category-row"${buildAnalyticsProductIndicatorStyle(indicatorColor)}>'),
        true,
        'category contribution cards should pass the chart color into the real left rail'
    );
    assert.equal(
        panelLoaders.includes('analytics-product-matrix-row analytics-product-matrix-row--${escapeHtml(item.tone || \'neutral\')}"${buildAnalyticsProductIndicatorStyle(indicatorColor)}'),
        true,
        'product matrix rows should pass their quadrant tone color into the real left rail'
    );
    assert.equal(
        panelLoaders.includes('items.slice(0, 5).map((item, index) => {'),
        true,
        'product matrix rows should declare index before using it for stable tone colors'
    );
    assert.equal(
        panelLoaders.includes('getAnalyticsProductSiteIndicatorColor(snapshot, index)'),
        true,
        'site comparison cards should pass a stable site color into the real left rail'
    );
    assert.equal(
        styles.includes('border-left: 2px solid var(--analytics-distribution-indicator, rgba(var(--admin-studio-module-card-edge-rgb), 0.64)) !important;'),
        true,
        'product analytics cards should render indicator colors through the shared real border rail'
    );
    assert.equal(
        baseStyles.includes('grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));'),
        true,
        'product analytics site comparison cards should fill wide rows with adaptive columns'
    );
    assert.equal(
        html.includes('productIndicatorColors=20260430_ADMIN_STUDIO_PRODUCT_INDICATOR_COLORS_1'),
        true,
        'admin studio should cache-bust product indicator color runtime updates'
    );
    assert.equal(
        html.includes('productSiteGrid=20260430_ADMIN_STUDIO_PRODUCT_SITE_GRID_1'),
        true,
        'admin studio should cache-bust product site comparison grid stylesheet updates'
    );
    assert.equal(
        html.includes('productMatrixIndexFix=20260430_ADMIN_STUDIO_PRODUCT_MATRIX_INDEX_FIX_1'),
        true,
        'admin studio should cache-bust the product matrix index runtime fix'
    );
    assert.equal(
        panelLoaders.includes("renderAnalyticsProductMetricCard('净利润'"),
        true,
        'product overview should expose net profit as a first-class operating metric'
    );
    assert.equal(
        panelLoaders.includes('成本覆盖 ${formatAnalyticsProductCostCoverage'),
        true,
        'product analytics should show cost coverage next to profit metrics'
    );
    assert.equal(
        html.includes('productProfitAudit=20260606_ADMIN_STUDIO_PRODUCT_PROFIT_AUDIT_1'),
        true,
        'admin studio should cache-bust product profit audit runtime updates'
    );
});
