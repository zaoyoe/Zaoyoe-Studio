const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function extractFunction(source, functionName) {
    const marker = `function ${functionName}(`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `Expected to find ${marker}`);

    const paramsStart = source.indexOf('(', start);
    assert.notEqual(paramsStart, -1, `Expected to find parameter list for ${functionName}`);

    let paramsDepth = 0;
    let paramsEnd = -1;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;

    for (let index = paramsStart; index < source.length; index += 1) {
        const char = source[index];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\') {
            escaped = true;
            continue;
        }

        if (inSingle) {
            if (char === '\'') inSingle = false;
            continue;
        }

        if (inDouble) {
            if (char === '"') inDouble = false;
            continue;
        }

        if (inTemplate) {
            if (char === '`') inTemplate = false;
            continue;
        }

        if (char === '\'') {
            inSingle = true;
            continue;
        }

        if (char === '"') {
            inDouble = true;
            continue;
        }

        if (char === '`') {
            inTemplate = true;
            continue;
        }

        if (char === '(') {
            paramsDepth += 1;
            continue;
        }

        if (char === ')') {
            paramsDepth -= 1;
            if (paramsDepth === 0) {
                paramsEnd = index;
                break;
            }
        }
    }

    assert.notEqual(paramsEnd, -1, `Expected to find parameter terminator for ${functionName}`);

    const bodyStart = source.indexOf('{', paramsEnd);
    assert.notEqual(bodyStart, -1, `Expected to find function body for ${functionName}`);

    let depth = 0;
    inSingle = false;
    inDouble = false;
    inTemplate = false;
    escaped = false;

    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\') {
            escaped = true;
            continue;
        }

        if (inSingle) {
            if (char === '\'') inSingle = false;
            continue;
        }

        if (inDouble) {
            if (char === '"') inDouble = false;
            continue;
        }

        if (inTemplate) {
            if (char === '`') inTemplate = false;
            continue;
        }

        if (char === '\'') {
            inSingle = true;
            continue;
        }

        if (char === '"') {
            inDouble = true;
            continue;
        }

        if (char === '`') {
            inTemplate = true;
            continue;
        }

        if (char === '{') {
            depth += 1;
            continue;
        }

        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Failed to extract function ${functionName}`);
}

function extractBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `Expected to find ${startMarker}`);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(end, -1, `Expected to find ${endMarker}`);
    return source.slice(start, end);
}

function createFakeField(value = '') {
    return {
        value: String(value),
        dataset: {},
        textContent: '',
        querySelectorAll() {
            return [];
        }
    };
}

function loadGalleryPopulateFormRuntime() {
    const adminSource = readRepoFile('admin-studio.js');
    const elements = {
        categoryDropdown: {
            dataset: {},
            querySelectorAll() {
                return [];
            }
        },
        promptTitle: createFakeField(),
        promptCategory: createFakeField(),
        promptText: createFakeField(),
        promptDescription: createFakeField(),
        promptTitleZh: createFakeField(),
        promptTitleEn: createFakeField(),
        promptDescriptionZh: createFakeField(),
        promptDescriptionEn: createFakeField(),
        promptTextZh: createFakeField(),
        promptTextEn: createFakeField(),
        promptOpsStatus: createFakeField(),
        promptOpsNote: createFakeField(),
        promptOpsStatusDropdown: createFakeField()
    };
    const bilingualOpenStates = [];

    const script = [
        extractFunction(adminSource, 'promptHasVisibleCopy'),
        extractBetween(adminSource, 'const PROMPT_CATEGORY_VALUE_ALIASES = Object.freeze({', 'const PROMPT_CATEGORY_INFERENCE_KEYWORDS = Object.freeze({'),
        extractBetween(adminSource, 'const PROMPT_CATEGORY_INFERENCE_KEYWORDS = Object.freeze({', 'const PROMPT_CATEGORY_FALLBACK_TITLES = Object.freeze({'),
        extractBetween(adminSource, 'const PROMPT_CATEGORY_FALLBACK_TITLES = Object.freeze({', 'function normalizePromptCategoryValue(value = \'\') {'),
        extractFunction(adminSource, 'normalizePromptCategoryValue'),
        extractFunction(adminSource, 'inferPromptCategoryValue'),
        extractFunction(adminSource, 'buildPromptCategoryInferenceSource'),
        extractFunction(adminSource, 'buildPromptFallbackTitle'),
        extractFunction(adminSource, 'hasPromptBilingualContent'),
        extractFunction(adminSource, 'populatePromptBilingualFields'),
        extractFunction(adminSource, 'collectPromptBilingualFieldValues'),
        extractFunction(adminSource, 'getPromptFormSnapshot'),
        extractFunction(adminSource, 'resolvePromptPrimaryFields'),
        extractFunction(adminSource, 'populatePromptOpsFields'),
        extractFunction(adminSource, 'populateForm'),
        'globalThis.__galleryPopulateFormExports = { populateForm, getPromptFormSnapshot, resolvePromptPrimaryFields };'
    ].join('\n\n');

    const context = {
        console: {
            log() {},
            warn() {},
            error() {}
        },
        document: {
            getElementById(id) {
                return elements[id] || null;
            }
        },
        setCustomDropdownValue(dropdownId, value) {
            if (dropdownId === 'categoryDropdown') {
                elements.promptCategory.value = String(value || '');
                return;
            }
            if (dropdownId === 'promptOpsStatusDropdown') {
                elements.promptOpsStatus.value = String(value || '');
            }
        },
        setPromptBilingualFieldsOpen(open) {
            bilingualOpenStates.push(Boolean(open));
        },
        renderTags() {},
        renderColors() {},
        globalThis: null
    };

    context.globalThis = context;
    vm.runInNewContext(script, context);

    return {
        elements,
        bilingualOpenStates,
        exports: context.__galleryPopulateFormExports
    };
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
        '标题 / 描述会先由 AI 分析自动回填；主提示词和提示词（中文）请手动填写。这里用于显式校对和覆盖 `zh / en` 双语文案，避免继续黑盒翻译。',
        'type="hidden" id="promptTextEn"'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(adminHtml.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    assert.equal(adminHtml.includes('Prompt Text (EN)'), false, 'admin-studio.html should not render a visible Prompt Text (EN) field');

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
        "const source = String(options.source || 'record').trim().toLowerCase();",
        "const isAnalysisSource = source === 'analysis';",
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
        "source: 'analysis'",
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
        "promptData.prompt_text_en = promptData.prompt;",
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

test('gallery smoke harness covers manual prompt fields in create analyze flow', () => {
    const smokeSource = readRepoFile('js/local-smoke-fixtures.js');

    const markers = [
        'Gallery Create 不会渲染 Prompt Text (EN) 可见字段',
        'Gallery Create Analyze 只会回填标题和描述',
        "globalScope.switchView?.('create');",
        "hiddenPromptTextEnInput.type === 'hidden'",
        "source: 'analysis'",
        "document.getElementById('promptText')?.value === ''",
        "document.getElementById('promptTextZh')?.value === ''",
        "document.getElementById('promptTextEn')?.value === ''"
    ];

    for (const marker of markers) {
        assert.equal(smokeSource.includes(marker), true, `js/local-smoke-fixtures.js should contain ${marker}`);
    }
});

test('gallery populateForm keeps prompt fields manual for analysis results and preserves existing manual prompt text', () => {
    const runtime = loadGalleryPopulateFormRuntime();
    const { elements, bilingualOpenStates, exports } = runtime;

    exports.populateForm({
        title: 'Smoke Analysis Title',
        title_en: 'Smoke Analysis Title',
        title_zh: '烟雾分析标题',
        category: 'Photography',
        description: 'Smoke analysis description.',
        description_en: 'Smoke analysis description.',
        description_zh: '烟雾分析描述。',
        prompt_suggestion_en: 'This prompt suggestion should stay manual.',
        prompt_suggestion_zh: '这个提示词建议应该保持手动填写。'
    }, {
        preserveExisting: false,
        source: 'analysis'
    });

    assert.equal(elements.promptTitle.value, 'Smoke Analysis Title');
    assert.equal(elements.promptCategory.value, 'Photography');
    assert.equal(elements.promptDescription.value, 'Smoke analysis description.');
    assert.equal(elements.promptText.value, '');
    assert.equal(elements.promptTitleZh.value, '烟雾分析标题');
    assert.equal(elements.promptTitleEn.value, 'Smoke Analysis Title');
    assert.equal(elements.promptDescriptionZh.value, '烟雾分析描述。');
    assert.equal(elements.promptDescriptionEn.value, 'Smoke analysis description.');
    assert.equal(elements.promptTextZh.value, '');
    assert.equal(elements.promptTextEn.value, '');
    assert.equal(bilingualOpenStates.at(-1), true);

    elements.promptTitle.value = '';
    elements.promptCategory.value = '';
    elements.promptDescription.value = '';
    elements.promptText.value = 'Manual primary prompt';
    elements.promptTextZh.value = '手动中文提示词';
    elements.promptTextEn.value = 'Manual English prompt';

    exports.populateForm({
        title: 'Fresh Analysis Title',
        title_en: 'Fresh Analysis Title',
        title_zh: '新的分析标题',
        category: 'Creative',
        description: 'Fresh analysis description.',
        description_en: 'Fresh analysis description.',
        description_zh: '新的分析描述。',
        prompt_suggestion_en: 'New prompt suggestion that should not overwrite manual prompt.',
        prompt_suggestion_zh: '新的提示词建议，不应覆盖手动提示词。'
    }, {
        preserveExisting: true,
        source: 'analysis'
    });

    assert.equal(elements.promptTitle.value, 'Fresh Analysis Title');
    assert.equal(elements.promptCategory.value, 'Creative');
    assert.equal(elements.promptDescription.value, 'Fresh analysis description.');
    assert.equal(elements.promptText.value, 'Manual primary prompt');
    assert.equal(elements.promptTextZh.value, '手动中文提示词');
    assert.equal(elements.promptTextEn.value, 'Manual English prompt');

    elements.promptTitle.value = 'Old title';
    elements.promptCategory.value = 'Photography';
    elements.promptDescription.value = 'Old description';
    elements.promptText.value = 'Keep this primary prompt';
    elements.promptTextZh.value = '保留这段中文提示词';
    elements.promptTextEn.value = 'Keep this English prompt';

    exports.populateForm({
        title: 'Recomputed Title',
        title_en: 'Recomputed Title',
        title_zh: '重算标题',
        category: 'Miniature',
        description: 'Recomputed description.',
        description_en: 'Recomputed description.',
        description_zh: '重算描述。'
    }, {
        preserveExisting: false,
        source: 'analysis'
    });

    assert.equal(elements.promptTitle.value, 'Recomputed Title');
    assert.equal(elements.promptCategory.value, 'Miniature');
    assert.equal(elements.promptDescription.value, 'Recomputed description.');
    assert.equal(elements.promptText.value, 'Keep this primary prompt');
    assert.equal(elements.promptTextZh.value, '保留这段中文提示词');
    assert.equal(elements.promptTextEn.value, 'Keep this English prompt');
});
