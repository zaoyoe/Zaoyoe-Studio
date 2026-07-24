const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('gallery p2 ops map adds overview, sorting, batch workflow actions, and homepage batch linkage', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const adminStudioSource = readRepoFile('admin-studio.js');
    const adminStudioCss = readRepoFile('admin-studio.css');
    const homepageSource = readRepoFile('admin-homepage.js');
    const siteFilterSource = readRepoFile('js/admin-site-filter.js');

    const htmlMarkers = [
        'id="sortFilterDropdown"',
        '互动最高',
        '运营优先',
        'id="galleryOpsOverview"',
        'data-admin-action="gallery-batch-set-status"',
        'data-admin-action="gallery-batch-add-homepage"',
        'data-gallery-batch-status="live"',
        '批量发布',
        'id="batchLocalizeMenuItem"',
        'data-admin-action="gallery-batch-localize"',
        'id="selectAllBtn"',
        '全选当前页',
        'id="selectAllVideoPromptsBtn"',
        '全选全部视频',
        'id="selectAllImagePromptsBtn"',
        '全选全部图片',
        'id="clearPromptSelectionBtn"',
        'gallerySelectAllMedia=20260723_ADMIN_GALLERY_SELECT_ALL_MEDIA_1',
        'id="batchBackfillPublishedPromptTextMenuItem"',
        'data-admin-action="gallery-batch-backfill-prompt-text"',
        '回填已发布提示词',
        'id="batchActionFeedback"'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(adminHtml.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    const studioMarkers = [
        'const ADMIN_GALLERY_SORT_LABELS = Object.freeze({',
        'const ADMIN_GALLERY_STATUS_PRIORITY = Object.freeze({',
        'function normalizeAdminGallerySortValue(value = \'\')',
        'function setAdminGallerySortFilterValue(value = \'updated-desc\')',
        'function setAdminGalleryStatusFilter(value = \'\')',
        'function getPromptEngagementScore(prompt = {}, site = getAdminPromptsReadSite())',
        'function compareAdminGalleryPrompts(leftPrompt = {}, rightPrompt = {}, sortValue = getAdminGallerySortValue())',
        'function sortAdminGalleryCards(sortValue = getAdminGallerySortValue(), rows = allPrompts)',
        'function renderGalleryOpsOverview()',
        'adminGalleryViewState.pagination?.totalItems',
        '全部提示词为当前筛选总数',
        "case 'gallery-set-status-filter':",
        "case 'gallery-batch-set-status':",
        "case 'gallery-batch-add-homepage':",
        "case 'gallery-batch-localize':",
        "case 'gallery-batch-backfill-prompt-text':",
        'async function batchSetSelectedPromptStatus(nextStatus = \'\')',
        'async function batchAddSelectedPromptsToHomepage()',
        'async function batchCompleteSelectedPromptBilingualFields()',
        'async function batchBackfillPublishedPromptTexts()',
        'const selectedPromptRecords = new Map();',
        'function setPromptSelected(promptId = \'\', selected = true, prompt = null)',
        'function clearSelectedPromptSelection({ syncCards = true } = {})',
        'function promptMatchesGalleryMediaSelection(prompt = {}, mediaType = \'\')',
        'async function fetchAllAdminPromptRowsForSelection({ onProgress } = {})',
        'async function selectAllFilteredPromptsByMedia(mediaType = \'\')',
        "selectAllFilteredPromptsByMedia('video')",
        "selectAllFilteredPromptsByMedia('image')",
        'return Array.from(selectedPrompts)',
        'async function backfillPublishedPromptText(prompt = {}, writableSite = getAdminPromptsReadSite())',
        "return ['live', 'featured'].includes(getPromptAdminOpsData(prompt).status);",
        'PromptTranslator.translateCanonicalPromptText(sourcePrompt)',
        'async function completePromptBilingualFields(prompt = {}, writableSite = getAdminPromptsReadSite(), options = {})',
        'function beginGalleryBatchMenuInteraction(actionEl, options = {})',
        'async function runGalleryBatchActionFromMenu(actionEl, operation, options = {})',
        'function buildPromptBilingualCompletionSource(prompt = {})',
        'function buildPromptBilingualCoveragePatch(prompt = {}, translatedFields = {})',
        'function getPromptMissingPersistedBilingualFields(attemptedPayload = {}, savedRow = {})',
        'async function verifyPromptPersistedBilingualFields(promptId = \'\', attemptedPayload = {}, savedRow = {})',
        'function buildPromptBilingualPersistenceWarningMessage(missingFields = [])',
        "document.getElementById('batchLocalizeMenuItem')?.addEventListener('click', (e) => {",
        "const progressToast = showAdminStudioToast(`正在为 ${selected.length} 条 Prompt 补全双语...`, 'info', { durationMs: 0 });",
        "setGalleryBatchPromptCardsPending(true, pendingLabel);",
        "countWrapper.dataset.batchBusy = 'true';",
        'function setToastContent(toast, message, type = \'info\')',
        'function scheduleToastDismiss(toast, durationMs = 3000)',
        'function withTimeout(promise, timeoutMs = 20000, timeoutMessage = \'操作超时\')',
        "setToastContent(progressToast, `正在补全双语 ${processedCount}/${selected.length}...`, 'info');",
        'let persistenceBlockedCount = 0;',
        'let persistenceWarningDetail = \'\';',
        'const persistenceState = await verifyPromptPersistedBilingualFields(promptId, payload, response?.row || {});',
        'finalizeProgressToast(',
        '双语结果暂未确认写入',
        'window.setAdminGalleryStatusFilter = setAdminGalleryStatusFilter;',
        'window.batchSetSelectedPromptStatus = batchSetSelectedPromptStatus;',
        'window.batchAddSelectedPromptsToHomepage = batchAddSelectedPromptsToHomepage;',
        'window.batchCompleteSelectedPromptBilingualFields = batchCompleteSelectedPromptBilingualFields;',
        'window.batchBackfillPublishedPromptTexts = batchBackfillPublishedPromptTexts;',
        'sortAdminGalleryCards(sortValue, filteredRows);',
        'renderGalleryOpsOverview();'
    ];

    for (const marker of studioMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const homepageMarkers = [
        'async function addFeaturedPrompts(prompts = [], options = {})',
        'addFeaturedPrompts,'
    ];

    for (const marker of homepageMarkers) {
        assert.equal(homepageSource.includes(marker), true, `admin-homepage.js should contain ${marker}`);
    }

    const cssMarkers = [
        '.gallery-ops-overview',
        '.gallery-ops-overview__status-row',
        '.gallery-ops-overview__status-btn',
        '.gallery-ops-overview__meta-pill',
        '.gallery-ops-overview__hint',
        '.batch-action-feedback',
        '.batch-menu-container.is-busy .batch-dropdown-menu',
        '.batch-menu-item.is-pending',
        '.admin-card.is-batch-pending'
    ];

    for (const marker of cssMarkers) {
        assert.equal(adminStudioCss.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    const siteFilterMarkers = [
        "'gallery-batch-add-homepage': '批量加入首页精选'",
        "'gallery-batch-localize': '批量补全 Prompt 双语'",
        "'gallery-batch-backfill-prompt-text': '回填已发布 Prompt 提示词'",
        "'gallery-batch-set-status': '批量更新 Prompt 运营状态'"
    ];

    for (const marker of siteFilterMarkers) {
        assert.equal(siteFilterSource.includes(marker), true, `js/admin-site-filter.js should contain ${marker}`);
    }
});
