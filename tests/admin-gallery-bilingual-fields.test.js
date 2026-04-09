const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('gallery admin form exposes explicit bilingual editing controls', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const adminStyles = readRepoFile('admin-studio.css');

    const htmlMarkers = [
        'id="gallerySiteContextBanner"',
        'id="languageFilter"',
        'id="statusFilter"',
        'id="promptBilingualToggleBtn"',
        'id="promptBilingualToggleLabel"',
        'id="promptBilingualFields"',
        'id="promptTitleZh"',
        'id="promptTitleEn"',
        'id="promptDescriptionZh"',
        'id="promptDescriptionEn"',
        'id="promptTextZh"',
        'id="promptTextEn"',
        'id="promptOpsStatusDropdown"',
        'id="promptOpsStatus"',
        'id="promptOpsNote"',
        '主字段会先由 AI 分析自动回填；这里用于显式校对和覆盖 `zh / en` 双语文案，避免继续黑盒翻译。'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(adminHtml.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    const styleMarkers = [
        '.gallery-bilingual-panel',
        '.gallery-bilingual-toggle',
        '.gallery-bilingual-toggle.is-active',
        '.gallery-bilingual-fields',
        '.gallery-bilingual-grid',
        '.gallery-ops-panel',
        '.gallery-ops-grid',
        '.gallery-bilingual-grid .form-group--full',
        '.admin-card-media',
        '.admin-card-badges',
        '.admin-card-badges--overlay',
        '.admin-card-badge--global',
        '.admin-card-badge--lang.is-ready',
        '.gallery-site-context-banner',
        '.admin-card-header',
        '.admin-card-status',
        '.admin-card-status--review',
        '.admin-card-status--featured',
        '.admin-card-status--archived',
        '.admin-card-ops-note',
        '.admin-card-context-actions',
        '.admin-card-context-btn',
        '.admin-card-subtitle',
        '.admin-card-site-metrics',
        '.admin-card-site-metric',
        '.admin-card-site-metric.is-current',
        '.gallery-pagination-shell',
        '.admin-card--hidden-by-pagination'
    ];

    for (const marker of styleMarkers) {
        assert.equal(adminStyles.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }
});

test('gallery admin runtime populates and saves bilingual fields explicitly', () => {
    const adminSource = readRepoFile('admin-studio.js');

    const requiredMarkers = [
        'function setPromptBilingualFieldsOpen(open)',
        'function initPromptBilingualFieldToggle()',
        'function hasPromptBilingualContent(data = {})',
        'function populatePromptBilingualFields(data = {})',
        'function collectPromptBilingualFieldValues()',
        'function resetPromptBilingualFields()',
        'function getPromptLanguageCoverage(prompt = {})',
        'function getPromptLifecycleState(prompt = {})',
        'function renderGallerySiteContextBanner(site = getAdminPromptsReadSite())',
        'function focusAdminGalleryPromptCard(promptId = \'\', options = {})',
        'function normalizePromptAdminOpsData(value = {})',
        'function getPromptAdminOpsData(prompt = {})',
        'function getPromptHomepageFeatureState(promptId = \'\', site = getAdminPromptsReadSite())',
        'function populatePromptOpsFields(data = {})',
        'function collectPromptOpsFieldValues()',
        'function resetPromptOpsFields()',
        'function buildPromptAiTagsPayload(existingAiTags = {}, options = {})',
        'const PROMPT_CATEGORY_VALUE_ALIASES = Object.freeze({',
        'const PROMPT_CATEGORY_INFERENCE_KEYWORDS = Object.freeze({',
        'const PROMPT_CATEGORY_FALLBACK_TITLES = Object.freeze({',
        'function normalizePromptCategoryValue(value = \'\')',
        'function inferPromptCategoryValue(analysisData = {})',
        'function buildPromptCategoryInferenceSource(formValues = {}, analysisData = {})',
        'function buildPromptFallbackTitle(formValues = {}, analysisData = {}, category = \'\')',
        'function getPromptFormSnapshot()',
        'function resolvePromptPrimaryFields(formValues = {}, analysisData = {})',
        'const categoryInferenceSource = buildPromptCategoryInferenceSource(formValues, analysisData);',
        'const PROMPT_BILINGUAL_FIELD_KEYS = Object.freeze([',
        'const PROMPT_BILINGUAL_SQL_GUIDE = \'supabase/migrations/add_bilingual_prompts_fields.sql\';',
        'const PROMPT_BILINGUAL_VERIFY_SELECT_FIELDS = [',
        'function getPromptMissingPersistedBilingualFields(attemptedPayload = {}, savedRow = {})',
        'function isMissingPromptBilingualSchemaCacheError(error = null)',
        'async function fetchPromptBilingualVerificationRow(promptId = \'\')',
        'async function fetchPromptBilingualVerificationRows(promptIds = [])',
        'function buildPromptBilingualPersistencePayload(attemptedPayload = {})',
        'function promptHasAnyBilingualCopy(prompt = {})',
        'async function persistPromptBilingualFieldsViaSupabase(promptId = \'\', attemptedPayload = {})',
        'async function hydratePromptRowsBilingualProjection(rows = [])',
        'async function verifyPromptPersistedBilingualFields(promptId = \'\', attemptedPayload = {}, savedRow = {})',
        'const missingFieldsAfterVerification = getPromptMissingPersistedBilingualFields(attemptedPayload, mergedRow);',
        'const persistedRow = await persistPromptBilingualFieldsViaSupabase(promptId, attemptedPayload);',
        'function buildPromptBilingualPersistenceWarningMessage(missingFields = [])',
        'function populateForm(data, options = {})',
        'async function addPromptToHomepagePromptsSection(promptId = \'\', options = {})',
        'function normalizePromptSiteMetrics(prompt = {})',
        'function buildPromptSiteMetricElement(siteLabel, siteMetrics, currentSite = \'all\')',
        'const ADMIN_GALLERY_PAGE_SIZE = 10;',
        'function renderAdminGalleryPagination()',
        'function applyAdminGalleryFilters(options = {})',
        'function changeAdminGalleryPage(page)',
        'const preserveExisting = Boolean(options.preserveExisting);',
        "setCustomDropdownValue('categoryDropdown', resolvedPrimaryFields.category);",
        "document.getElementById('promptTitleZh').value = data.title_zh || '';",
        "document.getElementById('promptTextEn').value = data.prompt_text_en || '';",
        'setPromptBilingualFieldsOpen(hasPromptBilingualContent(nextBilingualValues));',
        "media.className = 'admin-card-media';",
        "badges.className = 'admin-card-badges admin-card-badges--overlay';",
        "globalBadge.textContent = 'Global Asset';",
        "zhBadge.textContent = 'ZH';",
        "enBadge.textContent = 'EN';",
        "statusBadge.className = `admin-card-status admin-card-status--${lifecycleState.key}`;",
        "subtitle.className = 'admin-card-subtitle';",
        "contextActions.className = 'admin-card-context-actions';",
        "commentsBtn.setAttribute('data-admin-action', 'gallery-open-prompt-comments');",
        "analyticsBtn.setAttribute('data-admin-action', 'gallery-open-prompt-analytics');",
        "homepageBtn.setAttribute('data-admin-action', featureState.currentSite ? 'gallery-open-prompt-homepage' : 'gallery-add-prompt-homepage');",
        "metrics.className = 'admin-card-site-metrics';",
        "metricCounts.textContent = `解锁 ${siteMetrics.unlock_count} · 评论 ${siteMetrics.comment_count}`;",
        'const container = document.getElementById(\'adminGalleryPagination\');',
        'data-admin-action="gallery-pagination-go"',
        'data-admin-change-action="gallery-pagination-go"',
        'const bilingualValues = collectPromptBilingualFieldValues();',
        'const promptOps = collectPromptOpsFieldValues();',
        "showToast('未检测到分析结果，正在自动分析并保存...', 'warning');",
        'activeAnalysisResult = await analyzeImages({',
        'preserveExisting: true,',
        'silentSuccessToast: true,',
        'const formValues = getPromptFormSnapshot();',
        'const resolvedPrimaryFields = resolvePromptPrimaryFields(formValues, activeAnalysisResult || {});',
        'payload.rows = await hydratePromptRowsBilingualProjection(payload.rows);',
        'const [hydratedRow] = await hydratePromptRowsBilingualProjection([payload.row]);',
        "if (title && document.getElementById('promptTitle').value.trim() !== title) {",
        "if (category && document.getElementById('promptCategory').value !== category) {",
        "throw new Error(`请填写${missingFields.join('和')}`);",
        'queueAdminGalleryPromptFocus(savedPromptId);',
        'await loadAdminPrompts();',
        'promptData.title_en = promptData.title_en || activeAnalysisResult.title_en || activeAnalysisResult.title || title;',
        'let translationSoftFailed = false;',
        'translationSoftFailed = true;',
        'const promptPayload = {',
        'bilingualPersistenceState = await verifyPromptPersistedBilingualFields(savedPromptId, promptPayload, savedRow);',
        "title_en: promptData.title_en || '',",
        "prompt_text_zh: promptData.prompt_text_zh || ''",
        'const savedCoverage = getPromptLanguageCoverage(savedRow);',
        'const bilingualPersistenceWarning = buildPromptBilingualPersistenceWarningMessage(',
        'hydrateAdminGalleryPromptsLocally([savedRow]);',
        "showToast(bilingualPersistenceWarning, 'warning');",
        "showToast('Prompt 已保存，但双语仍未补全。可在高级语言字段中继续校对补齐。', 'warning');",
        "action: 'update',",
        "action: 'create',",
        'await mutateAdminPrompt({',
        'resetPromptBilingualFields();'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(adminSource.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }
});
