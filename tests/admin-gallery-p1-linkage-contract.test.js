const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('gallery p1 workflow and cross-module linkage surfaces prompt ops, homepage sequencing, and shared context actions', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const adminStudioSource = readRepoFile('admin-studio.js');
    const adminStudioCss = readRepoFile('admin-studio.css');
    const homepageSource = readRepoFile('admin-homepage.js');
    const commentsSource = readRepoFile('admin-comments.js');
    const growthCenterSource = readRepoFile('js/admin-growth-center.js');
    const sidebarCss = readRepoFile('admin-sidebar.css');
    const analyticsPanelLoaders = readRepoFile('js/admin-analytics-panel-loaders.js');

    const htmlMarkers = [
        'id="promptOpsStatusDropdown"',
        'id="promptOpsStatus"',
        'id="promptOpsNote"',
        'id="promptAiTagsGroup"',
        'class="form-group admin-studio-inline-style-attr-3" id="promptAiTagsGroup" hidden',
        'id="promptAiTagsGroup" hidden',
        'id="tagUseCasePlatform"',
        'id="tagUseCasePurpose"',
        'id="tagUseCaseFormat"',
        'id="tagCommercialNiche"',
        'id="tagCommercialAudience"',
        'id="tagDifficulty"',
        '首页候选',
        '已上首页',
        '已归档',
        'id="commentsPromptContextBar"'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(adminHtml.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    assert.equal(
        readRepoFile(path.join('css', 'admin-studio-page.css')).includes('20260427_ADMIN_GALLERY_AI_TAGS_HARD_HIDE_1'),
        true,
        'admin studio page styles should force-hide gallery AI tags even when form-group display rules would override [hidden]'
    );

    const studioMarkers = [
        'let currentEditingPromptAiTags = null;',
        'const PROMPT_ADMIN_STATUS_LABELS = Object.freeze({',
        'function normalizePromptAdminOpsData(value = {})',
        'function getPromptAdminOpsData(prompt = {})',
        'function getPromptHomepageFeatureState(promptId = \'\', site = getAdminPromptsReadSite())',
        'function buildPromptAdminOpsSummary(prompt = {})',
        'function populatePromptOpsFields(data = {})',
        'function collectPromptOpsFieldValues()',
        'function resetPromptOpsFields()',
        'function syncGalleryEditModePanels(mode = currentMode)',
        'setAdminStudioVisibility(aiTagsGroup, false);',
        'function syncGalleryAnalyzeButtonLabel(mode = currentMode)',
        'function hydrateEditingImagesForAnalysis()',
        'function buildPromptAiTagsPayload(existingAiTags = {}, options = {})',
        'function renderSimpleTags(containerId, values = [])',
        'nextAiTags.useCase = analysisData.useCase || {};',
        'nextAiTags.commercial = analysisData.commercial || {};',
        'nextAiTags.difficulty = analysisData.difficulty || \'\';',
        'async function openAdminStudioPromptGalleryContext(promptId = \'\', options = {}) {',
        'async function openAdminStudioPromptCommentsContext(context = {}) {',
        'async function openAdminStudioPromptHomepageContext(promptId = \'\', options = {}) {',
        'async function openAdminStudioPromptAnalyticsContext(promptId = \'\', options = {}) {',
        "promptText: promptHasVisibleCopy(currentForm?.prompt) ? currentForm.prompt : ''",
        "const nextLabel = isEditMode ? '重新分析元数据' : 'Analyze';",
        'currentEditingPromptAiTags = clonePromptAiTags(data.ai_tags || {});',
        'const promptOps = collectPromptOpsFieldValues();',
        'promptData.aiTags = buildPromptAiTagsPayload(currentEditingPromptAiTags, {',
        "case 'gallery-open-prompt-homepage':",
        "case 'homepage-move-featured-prompt':",
        "case 'homepage-open-featured-gallery':",
        "case 'homepage-open-featured-comments':",
        "case 'homepage-open-featured-analytics':",
        "case 'analytics-open-prompt-gallery':",
        "case 'analytics-open-prompt-comments':",
        "case 'analytics-open-prompt-homepage':",
        'void openAdminStudioPromptGalleryContext(',
        'void openAdminStudioPromptCommentsContext({',
        'void openAdminStudioPromptHomepageContext(',
        'void openAdminStudioPromptAnalyticsContext(',
        "homepageBtn.setAttribute('data-admin-action', featureState.currentSite ? 'gallery-open-prompt-homepage' : 'gallery-add-prompt-homepage');",
        "opsNote.className = 'admin-card-ops-note';"
    ];

    for (const marker of studioMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const homepageMarkers = [
        'function getHomepageFeaturedPromptItemsForSite(site = getHomepageReadSite())',
        'function getHomepageFeaturedPromptSites(promptId = \'\')',
        'function isPromptFeatured(promptId = \'\', options = {})',
        'async function moveFeaturedPrompt(promptId, direction, options = {})',
        'async function openPromptSectionContext(promptId = \'\', options = {})',
        'async function activateHomepageModule(context = {}, options = {}) {',
        'async function handleHomepageShellContext(context = {}, options = {}) {',
        'async function handleHomepageSiteChange(detail = {}) {',
        'data-admin-action="homepage-move-featured-prompt"',
        'data-homepage-direction="top"',
        'data-admin-action="homepage-open-featured-gallery"',
        'data-admin-action="homepage-open-featured-comments"',
        'data-admin-action="homepage-open-featured-analytics"',
        'ensureLoaded: ensureHomepageConfigLoaded,',
        'activate: activateHomepageModule,',
        'moveFeaturedPrompt,',
        'openPromptSectionContext,',
        'openShellContext: openAdminHomepageShellContext,',
        'handleShellContext: handleHomepageShellContext,',
        'handleSiteChange: handleHomepageSiteChange,',
        'window.openAdminHomepageShellContext = (context = {}, options = {}) => window.HomepageAdmin?.openShellContext?.(context, options);',
        "window.AdminShell.registerModule('homepage', {"
    ];

    for (const marker of homepageMarkers) {
        assert.equal(homepageSource.includes(marker), true, `admin-homepage.js should contain ${marker}`);
    }

    const commentsMarkers = [
        'function renderCommentsPromptContextBar()',
        'data-comments-action="open-prompt-gallery"',
        'data-comments-action="open-prompt-homepage"',
        'data-comments-action="open-prompt-analytics"',
        'data-comments-action="clear-prompt-context"',
        "case 'open-prompt-gallery':",
        "case 'open-prompt-homepage':",
        "case 'open-prompt-analytics':",
        'async function openAdminCommentsPromptGalleryContext() {',
        'async function openAdminCommentsPromptHomepageContext() {',
        'async function openAdminCommentsPromptAnalyticsContext() {',
        "typeof window.openAdminHomepageShellContext === 'function'",
        "typeof window.openAdminGrowthCenterShellContext === 'function'",
        "await window.AdminShell.openContext('growth-center'",
        'renderCommentsPromptContextBar();'
    ];

    for (const marker of commentsMarkers) {
        assert.equal(commentsSource.includes(marker), true, `admin-comments.js should contain ${marker}`);
    }

    const growthCenterMarkers = [
        'handleContext(context = {}, options = {}) {',
        "window.openAnalyticsDestination(analyticsDestination, destinationContext)",
        'window.syncAnalyticsRouteState({',
        'window.switchAnalyticsTab(requestedTab, {',
        'async function openAdminGrowthCenterShellContext(context = {}, options = {}) {',
        'window.openAdminGrowthCenterShellContext = openAdminGrowthCenterShellContext;',
        'handleContext: (context = {}, options = {}) => window.AdminGrowthCenter?.handleContext?.(context, options)'
    ];

    for (const marker of growthCenterMarkers) {
        assert.equal(growthCenterSource.includes(marker), true, `js/admin-growth-center.js should contain ${marker}`);
    }

    const analyticsMarkers = [
        'data-admin-action="analytics-open-prompt-gallery"',
        'data-admin-action="analytics-open-prompt-comments"',
        'data-admin-action="analytics-open-prompt-homepage"'
    ];

    for (const marker of analyticsMarkers) {
        assert.equal(analyticsPanelLoaders.includes(marker), true, `js/admin-analytics-panel-loaders.js should contain ${marker}`);
    }

    const studioCssMarkers = [
        '.gallery-ops-panel',
        '.gallery-ops-grid',
        '.admin-card-status--review',
        '.admin-card-status--homepage-candidate',
        '.admin-card-status--featured',
        '.admin-card-status--archived',
        '.admin-card-ops-note',
        '.admin-card-context-btn.is-active',
        '.hp-featured-site-group',
        '.hp-featured-prompt__actions',
        '.hp-featured-prompt__sort-btn',
        '.hp-featured-prompt__jump'
    ];

    for (const marker of studioCssMarkers) {
        assert.equal(adminStudioCss.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    const sidebarCssMarkers = [
        '.comments-prompt-context',
        '.comments-prompt-context__title',
        '.comments-prompt-context__actions',
        '.comments-prompt-context__btn--primary'
    ];

    for (const marker of sidebarCssMarkers) {
        assert.equal(sidebarCss.includes(marker), true, `admin-sidebar.css should contain ${marker}`);
    }
});
