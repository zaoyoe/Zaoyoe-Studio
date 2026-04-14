const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('points module exposes package catalog view in admin studio shell', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const bootstrapSource = readRepoFile('js/admin-studio-bootstrap.js');
    const adminStudioSource = readRepoFile('admin-studio.js');

    const htmlMarkers = [
        '<span>兑换码/套餐</span>',
        'data-points-view="catalog"',
        'id="points-view-catalog"',
        'id="pointsCatalogSummary"',
        'id="pointsCatalogPackageCount"',
        'id="pointsCatalogSearchInput"',
        'id="pointsCatalogStatusFilter"',
        'id="pointsCatalogSortFilter"',
        'id="pointsGeneratePreview"',
        'id="pointsGeneratePreviewStatus"',
        'id="pointsCatalogWriteContext"',
        'id="pointsGenerateWriteContext"',
        'id="pointsBatchQuickFilters"',
        'id="pointsBatchOverview"',
        'id="pointsBatchListInlineFeedback"',
        'id="pointsPackagesTableBody"',
        'id="pointsPackageForm"',
        'id="pointsPackageDeleteBtn"',
        'data-points-action="new-package"',
        'data-points-action="clear-package-filters"',
        'data-points-action="jump-generated-batch"',
        'data-points-submit="save-package"',
        '套餐编辑已经迁到 Points 模块的“套餐目录”里；这里不再承担日常套餐运营，只保留支付相关开关和迁移说明。'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(adminHtml.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    assert.equal(
        adminHtml.includes('class="glass-panel points-catalog-panel"'),
        false,
        'admin-studio.html should no longer wrap the points catalog workspace in an outer glass panel'
    );

    assert.equal(bootstrapSource.includes("label: '兑换码与套餐'"), true, 'admin-studio-bootstrap.js should relabel the points permission group');
    assert.equal(bootstrapSource.includes("label: '兑换码/套餐'"), true, 'admin-studio-bootstrap.js should relabel the points module entry');
    assert.equal(adminStudioSource.includes("case 'settings-open-points-catalog':"), true, 'admin-studio.js should route settings shortcut into the points catalog');
    assert.equal(adminStudioSource.includes("document.querySelectorAll('.custom-select:not(.points-select)')"), true, 'admin-studio.js should exclude points dropdowns from the generic custom-select initializer');
    assert.equal(adminStudioSource.includes("dropdown.classList.contains('points-select')"), true, 'admin-studio.js should guard setupCustomDropdown against points-specific selects');
});

test('points runtime loads package catalog through dedicated admin handler and exposes package editor workflow', () => {
    const pointsSource = readRepoFile('admin-points.js');
    const stylesSource = readRepoFile('admin-studio.css');

    const runtimeMarkers = [
        "function getPointsReadSite()",
        "async function copyPointsTextToClipboard(text = '', {",
        "function buildPointsInlineFeedbackMarkup(message = '', tone = 'info')",
        'function renderPointsLookupFeedback()',
        "function setPointsLookupFeedback(message = '', tone = 'info')",
        'function renderPointsBatchCodesFeedback()',
        "function setPointsBatchCodesFeedback(message = '', tone = 'info', batchId = '')",
        'function renderPointsBatchListFeedback()',
        "function setPointsBatchListFeedback(message = '', tone = 'info', kind = 'action')",
        "function buildPointsBatchActionFeedback(action = '', payload = {}, options = {})",
        'function hasActiveBatchListFilters()',
        "function announcePointsScopedAction(message = '', tone = 'success', {",
        "const sourceInLookup = Boolean(sourceEl?.closest?.('#lookupResult'));",
        "} else if (inBatch && normalizedBatchId) {",
        "buildAdminPointsUrl('points/batches'",
        "buildAdminPointsUrl('points/catalog'",
        "buildAdminPointsUrl('points/lookup'",
        "buildAdminPointsUrl('points/manage'",
        "buildAdminPointsUrl('points/packages'",
        'async function fetchPointsCatalogSnapshot({ site = getPointsReadSite(), force = false } = {})',
        'function renderPointsPackageCatalog(payload = {})',
        'function renderPointsPackageCatalogTable(rows = getPointsCatalogRows())',
        'function renderPointsPackageEditor()',
        'function getPointsWriteContextState()',
        'function buildPointsSiteContextMarkup(mode = \'catalog\')',
        'function renderPointsSiteContexts()',
        'function syncPointsGenerateSubmitState()',
        'function getPointsBatchQuickCounts(rows = allBatches)',
        'function getPointsBatchInsights(batch = {}, referenceDate = new Date())',
        'function buildPointsBatchRiskBadges(batch = {})',
        'function buildPointsBatchEditOverviewCard({',
        'function getPointsBatchCodeStatusCounts(codes = [])',
        'function buildPointsBatchCodesSummaryCard({',
        'function buildPointsBatchCodesActionButton({',
        'function getFilteredPointsBatchCodes(codes = pointsBatchCodesUiState.codes)',
        'function buildPointsBatchCodesTableSection(codes = pointsBatchCodesUiState.codes)',
        'function copyVisibleBatchCodes()',
        'function openPointsLookupFromCode(code = \'\')',
        'function queuePointsBatchCodeFocus(batchId = \'\', code = \'\')',
        'function focusPointsBatchCodeInModal(code = \'\', { applySearch = false } = {})',
        'function buildPointsLookupBatchAction(action = \'\', batchId = \'\', code = \'\', label = \'前往批次\', icon = \'fas fa-box-archive\')',
        'function buildPointsLookupCodeOpsPanel(data = {})',
        'function getPointsBatchInvalidateModalPayload(batchIds = [])',
        'function getPointsPackageDeleteModalPayload(packageId = \'\')',
        'function syncPointsPackageDeleteModalState()',
        'function syncPointsBatchInvalidateModalState()',
        'function buildPointsCodeActionModalConfig(mode = \'\', code = \'\', currentExpiry = \'\')',
        'function openPointsPackageDeleteModal(packageId = \'\')',
        'function openPointsBatchInvalidateModal(batchIds = [])',
        'function openPointsCodeActionModal({ mode = \'\', code = \'\', currentExpiry = \'\', source = \'\' } = {})',
        'function syncPointsCodeActionModalState()',
        'async function submitPointsPackageDelete(event) {',
        'async function submitPointsBatchInvalidate(event) {',
        'async function submitPointsCodeAction(event) {',
        'function syncPointsBatchEditModalState()',
        'function renderPointsBatchOverview()',
        'function seedGenerateFromBatch(batchId = \'\')',
        'function duplicatePointsPackageToEditor(packageId = \'\')',
        'function renderPointsGeneratePreview()',
        'function filterBatchByQuick(value = \'all\')',
        'function jumpToGeneratedBatch(batchName = generatedBatchContext.batchName)',
        'function getFilteredPointsCatalogRows(rows = getPointsCatalogRows())',
        'function collectPointsPackageFormPayload()',
        'async function mutatePointsManage({ action = \'\', site = \'\', payload = {} } = {})',
        "const writableSite = requireWritablePointsSite({ label });",
        'async function fetchPointsBatchesPayload(params = {}) {',
        'async function fetchPointsLookupPayload(params = {}) {',
        'function buildPointsBatchLoadingSkeleton(rowCount = batchPageSize) {',
        'function formatPointsPackageMetricCell(metric = {}) {',
        'payments-kpi-card payments-kpi-card-visual',
        "label: isCreate ? '创建套餐' : '保存套餐'",
        "label: '删除套餐'",
        "data-points-action=\"duplicate-package\"",
        "data-points-action=\"clear-package-filters\"",
        "data-points-action=\"edit-package\"",
        "data-points-action=\"reissue-batch\"",
        "data-points-action=\"open-batch-codes-from-edit\"",
        "data-points-action=\"reissue-batch-from-edit\"",
        "action: 'open-batch-edit-from-codes'",
        "action: 'reissue-batch-from-codes'",
        "action: 'export-batch-codes-from-modal'",
        "action: 'invalidate-batch-from-codes'",
        "data-points-action=\"copy-visible-batch-codes\"",
        "data-points-action=\"clear-batch-code-filters\"",
        "action: 'lookup-code-item'",
        "data-points-action=\"navigate-batch\" data-batch-id=\"${encodeURIComponent(data.batch_id)}\" data-code=\"${encodeURIComponent(data.code || '')}\"",
        "data-points-overlay-close=\"package-delete\"",
        "data-points-action=\"close-package-delete-modal\"",
        "data-points-overlay-close=\"batch-invalidate\"",
        "data-points-submit=\"submit-package-delete\"",
        "data-points-action=\"close-batch-invalidate-modal\"",
        "data-points-overlay-close=\"code-action\"",
        "data-points-submit=\"submit-batch-invalidate\"",
        "data-points-action=\"close-code-action-modal\"",
        "data-points-submit=\"submit-code-action\"",
        "document.getElementById('pointsCatalogPackageCount')",
        "document.getElementById('pointsCatalogSummary')",
        "document.getElementById('pointsPackagesTableBody')",
        "document.getElementById('pointsCatalogSearchInput')",
        "document.getElementById('pointsCatalogStatusFilter')",
        "document.getElementById('pointsCatalogSortFilter')",
        "document.getElementById('pointsGeneratePreview')",
        "document.getElementById('pointsGeneratePreviewStatus')",
        "document.getElementById('pointsPackageForm')",
        "formatPointsPackageMetricCell(metrics.cn)",
        "if (viewName === 'catalog') loadPointsPackageCatalog();",
        "if (activeView === 'points-view-catalog') {",
        "const payload = await fetchPointsBatchesPayload({ site: currentSite });",
        "const payload = await fetchPointsLookupPayload({",
        "const payload = await fetchPointsBatchesPayload({ site: currentSite, code: searchTerm });"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(pointsSource.includes(marker), true, `admin-points.js should contain ${marker}`);
    }

    assert.equal(
        (pointsSource.match(/function setPointsPackageSaveButtonState/g) || []).length,
        1,
        'admin-points.js should only define setPointsPackageSaveButtonState once'
    );
    assert.equal(
        pointsSource.includes('class="codes-count"'),
        false,
        'admin-points.js should not render a batch-code count pill in the modal header'
    );
    assert.equal(
        stylesSource.includes('.codes-count'),
        false,
        'admin-studio.css should not style a legacy batch-code count pill'
    );
    assert.equal(
        (pointsSource.match(/\b(alert|confirm|prompt)\s*\(/g) || []).length,
        1,
        'admin-points.js should only retain the alert fallback inside announcePointsAction'
    );

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
        '.points-catalog-panel',
        '.points-catalog-workspace',
        '.points-catalog-list-shell',
        '.points-package-editor-shell',
        '.points-catalog-summary-card:hover',
        '.points-package-editor-badge',
        '.points-site-context',
        '.points-site-context__item.is-blocked',
        '.points-batch-overview',
        '.points-batch-overview-card',
        '.points-batch-name-cell',
        '.points-batch-risk-row',
        '.points-batch-risk--expiring',
        '.points-batch-edit-layout',
        '.points-batch-edit-overview-card',
        '.points-batch-edit-actions',
        '.points-site-context--batch-edit',
        '.codes-modal--batch',
        '.points-batch-codes-workbench',
        '.points-batch-codes-summary-card',
        '.points-batch-codes-actions',
        '.points-batch-codes-toolbar',
        '.points-batch-codes-search',
        '.points-batch-codes-toolbar-btn',
        '.points-batch-codes-table-empty',
        '.points-batch-codes-row-tools',
        '.points-batch-codes-row-btn',
        '.points-batch-code-row--focused',
        '.lookup-inline-hint',
        '.lookup-section--ops',
        '.lookup-ops-panel',
        '.lookup-action-btn--danger',
        '.lookup-action-btn--success',
        '.points-inline-feedback-shell',
        '.points-batch-list-feedback',
        '.points-batch-list-feedback .points-inline-feedback',
        '.points-inline-feedback',
        '.points-inline-feedback__stats',
        '.points-inline-feedback__stat',
        '.points-inline-feedback--success',
        '.points-inline-feedback--error',
        '.points-site-context--lookup-ops',
        '.edit-modal--code-action',
        '.edit-modal--package-delete',
        '.edit-modal--batch-invalidate',
        '.points-code-action-summary',
        '.points-code-action-summary--danger',
        '.points-code-action-error',
        '.points-code-action-submit--danger',
        '.points-code-action-submit--success',
        '.points-site-context--code-action',
        '.points-package-delete-summary',
        '.points-package-delete-summary__meta-item',
        '.points-package-delete-warning',
        '.points-batch-invalidate-list',
        '.points-batch-invalidate-item',
        '.points-batch-codes-status-pill',
        '.points-catalog-toolbar',
        '.points-catalog-search',
        '.points-catalog-select',
        '.points-generate-preview',
        '.points-generate-preview__status',
        '.points-generate-preview__grid',
        '.points-package-form__actions',
        '.points-package-action-btn',
        '.points-package-action-btn--primary',
        '.points-catalog-summary',
        '.points-catalog-summary-card',
        '.points-package-name__secondary',
        '.points-package-row.is-selected',
        '.points-package-status.is-active',
        '.points-package-status.is-inactive',
        '.points-package-metric-cell',
        '.points-package-metric-pill',
        '.points-package-empty-state',
        '.points-batch-quick-filters',
        '.points-batch-quick-filter__count',
        '.points-batch-empty-state',
        '.points-batch-quick-filter.is-active',
        '.settings-package-shortcut'
    ];

    for (const marker of styleMarkers) {
        assert.equal(stylesSource.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }
});

test('points local smoke opens a batch row with codes when verifying batch detail loading', () => {
    const smokeSource = readRepoFile('js/local-smoke-fixtures.js');

    const markers = [
        "let generatedBatchId = '';",
        "generatedBatchId = String(",
        "row.name === 'Smoke 批次生成'",
        "return getTableRows('redemption_codes').some((codeRow) => String(codeRow?.batch_id || '').trim() === batchId);",
        "batch=${targetBatchRow.dataset.batchId || '<unknown>'}"
    ];

    for (const marker of markers) {
        assert.equal(smokeSource.includes(marker), true, `js/local-smoke-fixtures.js should contain ${marker}`);
    }
});

test('points batch detail view guards against stale responses and can hydrate a batch outside the local list snapshot', () => {
    const pointsSource = readRepoFile('admin-points.js');

    const markers = [
        'let pointsBatchListLoadRequestId = 0;',
        'let pointsBatchCodesRequestId = 0;',
        'let pointsPendingBatchOpenHandle = 0;',
        'let pointsPendingBatchOpenToken = 0;',
        'function upsertPointsBatchRow(batch = null) {',
        'function clearPendingPointsBatchOpen() {',
        'function schedulePointsBatchOpen(batchId = \'\', { code = \'\', delayMs = 200 } = {}) {',
        'const requestId = ++pointsBatchListLoadRequestId;',
        'const requestId = ++pointsBatchCodesRequestId;',
        "const headerTitle = batch?.name || '批次详情';",
        'let initialPayload = null;',
        'batch = upsertPointsBatchRow(initialPayload?.batch || null) || null;',
        'batch = upsertPointsBatchRow(payload?.batch || batch) || batch;',
        "if (requestId !== pointsBatchCodesRequestId || String(window.currentViewBatchId || '').trim() !== normalizedBatchId) {"
    ];

    for (const marker of markers) {
        assert.equal(pointsSource.includes(marker), true, `admin-points.js should contain ${marker}`);
    }
});

test('points batch edit save refreshes both the batch list and the active batch detail workbench', () => {
    const pointsSource = readRepoFile('admin-points.js');

    const markers = [
        'async function refreshPointsAfterBatchMutation({ batchId = \'\', onMissing = null } = {}) {',
        'await loadBatches();',
        'const activeBatchId = normalizedBatchId || String(window.currentViewBatchId || \'\').trim();',
        'await syncCurrentPointsBatchDetailAfterListReload({ onMissing });',
        'await refreshPointsAfterBatchMutation({ batchId: normalizedBatchId });',
        'if (shouldReturnToCodes) {',
        'await viewBatchCodes(normalizedBatchId);'
    ];

    for (const marker of markers) {
        assert.equal(pointsSource.includes(marker), true, `admin-points.js should contain ${marker}`);
    }
});

test('points batch workflows preserve return-to-detail context and clear stale cross-site state', () => {
    const pointsSource = readRepoFile('admin-points.js');

    const markers = [
        'let pointsBatchEditContext = {',
        'function clearPointsLookupResult({ renderEmptyState = false } = {}) {',
        'async function refreshPointsLookupResultIfNeeded({ activeViewOnly = false } = {}) {',
        'function syncSelectedBatchIdsWithAvailableRows(rows = allBatches) {',
        'async function syncCurrentPointsBatchDetailAfterListReload({ onMissing = null } = {}) {',
        'function dismissPointsSiteScopedOverlaysOnSiteChange() {',
        'function openBatchEditModal(batchId, { returnToCodes = false } = {}) {',
        'returnToCodes: Boolean(returnToCodes)',
        'const shouldReturnToCodes = pointsBatchEditContext.returnToCodes',
        'await refreshPointsLookupResultIfNeeded();',
        'await syncCurrentPointsBatchDetailAfterListReload({ onMissing });',
        'clearPendingPointsBatchCodeFocus();',
        'clearPendingPointsBatchOpen();',
        'Boolean(window.__pointsSiteChangeClosedBatchDetail)',
        "clearPointsLookupResult({ renderEmptyState: activeView === 'points-view-lookup' });",
        'announcePointsAction(`已切换站点，旧站点的${dismissedOverlays.join(\'、\')}弹窗已关闭。`, \'info\');',
        "setPointsBatchListFeedback('已切换站点，原来的批次详情已关闭，请在当前站点重新选择批次。', 'info', 'action');"
    ];

    for (const marker of markers) {
        assert.equal(pointsSource.includes(marker), true, `admin-points.js should contain ${marker}`);
    }
});

test('points local smoke exercises batch edit, invalidate, lookup refresh, site change, and delete closure flows', () => {
    const smokeSource = readRepoFile('js/local-smoke-fixtures.js');

    const markers = [
        '批次编辑保存会同步刷新当前详情工作台',
        '批次作废后详情和兑换码状态会同步刷新',
        '批次和兑换码变更后 Lookup 会回刷最新状态',
        '切换站点会关闭旧批次详情并清空过期 Lookup 结果',
        '删除当前批次会关闭详情并清理选中态',
        "globalScope.AdminSiteFilter.select('intl');",
        "String(globalScope.currentViewBatchId || '').trim() === generatedBatchId",
        "typeof globalScope.batchDeleteBatches === 'function'",
        "document.querySelector('.delete-options-modal [data-points-action=\"execute-delete-option\"]')"
    ];

    for (const marker of markers) {
        assert.equal(smokeSource.includes(marker), true, `js/local-smoke-fixtures.js should contain ${marker}`);
    }
});
