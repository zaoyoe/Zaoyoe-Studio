const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('admin studio exposes the marketing asset center workspace inside the growth tab shell', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const adminApiSource = readRepoFile('api/admin.js');

    const htmlMarkers = [
        'id="marketingAssetCenterWorkspace"',
        'id="marketingAssetCenterMeta"',
        '营销资产中心',
        'js/admin-growth-center.js?v=20260409_MARKETING_ASSET_CENTER_P2_1'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(adminHtml.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    assert.equal(
        adminApiSource.includes("'marketing/assets-center': marketingAssetsCenterHandler"),
        true,
        'api/admin.js should register the marketing assets center route'
    );
});

test('growth center runtime and styles expose unified asset and workflow surfaces', () => {
    const growthSource = readRepoFile('js/admin-growth-center.js');
    const stylesSource = readRepoFile('css/admin-studio-page.css');

    const runtimeMarkers = [
        'const AdminGrowthCenter = {',
        "buildUrl('marketing/assets-center'",
        'renderSummaryCards(summary = {})',
        'renderUnifiedAssets(items = [])',
        'renderWorkflows(workflows = [])',
        "data-growth-center-action=\"run-workflow\"",
        "data-growth-center-action=\"open-asset\"",
        'window.AdminGrowthCenter = AdminGrowthCenter;'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(growthSource.includes(marker), true, `js/admin-growth-center.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.marketing-asset-center__summary-grid',
        '.marketing-asset-center__family-card',
        '.marketing-asset-center__workflow-card',
        '.marketing-asset-center__list-item',
        '.marketing-asset-center__detail-btn',
        '.marketing-asset-center__error'
    ];

    for (const marker of styleMarkers) {
        assert.equal(stylesSource.includes(marker), true, `css/admin-studio-page.css should contain ${marker}`);
    }
});
