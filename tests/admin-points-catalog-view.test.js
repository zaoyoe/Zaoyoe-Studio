const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('points module exposes package catalog view and scope note in admin studio shell', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const bootstrapSource = readRepoFile('js/admin-studio-bootstrap.js');
    const adminStudioSource = readRepoFile('admin-studio.js');

    const htmlMarkers = [
        '<span>兑换码/套餐</span>',
        'data-points-view="catalog"',
        'id="points-view-catalog"',
        'id="pointsCatalogSummary"',
        'id="pointsPackagesTableBody"',
        'id="pointsPackageForm"',
        'id="pointsPackageDeleteBtn"',
        'data-points-action="new-package"',
        'data-points-submit="save-package"',
        '这里当前主要管理兑换码批次、套餐目录和兑换追踪；真实积分余额与资产流水仍在用户详情、支付链路里收口。',
        '套餐内容本身是全站共享资产；下方的 CN / INTL 指标代表各站点下兑换码批次的发放与使用表现',
        '套餐编辑已经迁到 Points 模块的“套餐目录”里；这里不再承担日常套餐运营，只保留支付相关开关和迁移说明。'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(adminHtml.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    assert.equal(bootstrapSource.includes("label: '兑换码与套餐'"), true, 'admin-studio-bootstrap.js should relabel the points permission group');
    assert.equal(bootstrapSource.includes("label: '兑换码/套餐'"), true, 'admin-studio-bootstrap.js should relabel the points module entry');
    assert.equal(adminStudioSource.includes("case 'settings-open-points-catalog':"), true, 'admin-studio.js should route settings shortcut into the points catalog');
});

test('points runtime loads package catalog through dedicated admin handler and exposes package editor workflow', () => {
    const pointsSource = readRepoFile('admin-points.js');
    const stylesSource = readRepoFile('admin-studio.css');

    const runtimeMarkers = [
        "function getPointsReadSite()",
        "buildAdminPointsUrl('points/batches'",
        "buildAdminPointsUrl('points/catalog'",
        "buildAdminPointsUrl('points/lookup'",
        "buildAdminPointsUrl('points/manage'",
        "buildAdminPointsUrl('points/packages'",
        'async function fetchPointsCatalogSnapshot({ site = getPointsReadSite(), force = false } = {})',
        'function renderPointsPackageCatalog(payload = {})',
        'function renderPointsPackageEditor()',
        'function collectPointsPackageFormPayload()',
        'async function mutatePointsManage({ action = \'\', site = \'\', payload = {} } = {})',
        "const writableSite = requireWritablePointsSite({ label });",
        'async function fetchPointsBatchesPayload(params = {}) {',
        'async function fetchPointsLookupPayload(params = {}) {',
        "label: isCreate ? '创建套餐' : '保存套餐'",
        "label: '删除套餐'",
        "data-points-action=\"edit-package\"",
        "document.getElementById('pointsCatalogSummary')",
        "document.getElementById('pointsPackagesTableBody')",
        "document.getElementById('pointsPackageForm')",
        "formatPointsPackageMetricText(metrics.cn)",
        "if (viewName === 'catalog') loadPointsPackageCatalog();",
        "if (activeView === 'points-view-catalog') {",
        "const payload = await fetchPointsBatchesPayload({ site: currentSite });",
        "const payload = await fetchPointsLookupPayload({",
        "const payload = await fetchPointsBatchesPayload({ site: currentSite, code: searchTerm });"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(pointsSource.includes(marker), true, `admin-points.js should contain ${marker}`);
    }

    const removedWriteMarkers = [
        ".from('redemption_batches')",
        ".from('redemption_codes')",
        ".from('profiles')",
        ".from('prompts')",
        ".from('points_ledger')",
        "fn_check_code_status",
        ".rpc('fn_generate_custom_codes'",
        ".rpc('fn_generate_codes'",
        ".rpc('fn_revoke_code'"
    ];

    for (const marker of removedWriteMarkers) {
        assert.equal(pointsSource.includes(marker), false, `admin-points.js should not contain ${marker}`);
    }

    const styleMarkers = [
        '#points-view-catalog',
        '.points-module-note',
        '.points-catalog-panel',
        '.points-catalog-workspace',
        '.points-package-editor-shell',
        '.points-package-editor-badge',
        '.points-package-form__actions',
        '.points-catalog-summary',
        '.points-catalog-summary-card',
        '.points-package-name__secondary',
        '.points-package-row.is-selected',
        '.points-package-status.is-active',
        '.points-package-status.is-inactive',
        '.points-package-metric-cell',
        '.settings-package-shortcut'
    ];

    for (const marker of styleMarkers) {
        assert.equal(stylesSource.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }
});
