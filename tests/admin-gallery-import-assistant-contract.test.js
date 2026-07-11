const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
    return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('admin gallery exposes Meigen import assistant workflow and progress UI', () => {
    const html = readRepoFile('admin-studio.html');
    const js = readRepoFile('admin-studio.js');
    const css = readRepoFile('admin-studio.css');
    const api = readRepoFile('api/admin.js');
    const handler = readRepoFile(path.join('server', 'api-handlers', 'admin', 'prompts', 'imports.js'));
    const migration = readRepoFile(path.join('supabase', 'migrations', '20260709_prompt_gallery_import_staging.sql'));
    const promptIdFixMigration = readRepoFile(path.join('supabase', 'migrations', '20260709_prompt_gallery_import_prompt_ids_text.sql'));

    const htmlMarkers = [
        'data-view="create"',
        'data-view="import"',
        'data-view="manage"',
        'id="view-import"',
        'id="galleryImportAssistant"',
        'Gallery 导入助手',
        'Meigen 批量导入',
        'data-admin-action="gallery-import-open-source"',
        '打开 Meigen',
        'data-admin-action="gallery-import-copy-collector"',
        '复制采集器',
        'data-admin-action="gallery-import-paste-clipboard"',
        '粘贴结果',
        'data-admin-action="gallery-import-refresh-status"',
        '刷新处理状态',
        'data-import-mode="crawl_only"',
        'data-import-mode="stream"',
        'data-import-mode="upload_only"',
        'id="galleryImportCrawlProgress"',
        'id="galleryImportUploadProgress"',
        'id="galleryImportTotalProgress"',
        'id="galleryImportQueue"',
        'id="galleryImportParallelismDropdown"',
        'id="galleryImportParallelism" value="2"',
        '同时处理',
        'id="galleryImportAnalyzeAfterSave" checked disabled',
        '完整分析后发布',
        'data-admin-action="gallery-import-start"',
        'data-admin-action="gallery-import-upload-staged"',
        'data-admin-action="gallery-import-cleanup"',
        'data-admin-action="gallery-import-clear-current"',
        '清空当前队列',
        'galleryImportRetry=20260710_GALLERY_FULL_ANALYSIS_BILINGUAL_2',
        'galleryImportPipeline=20260710_GALLERY_FULL_ANALYSIS_BILINGUAL_2'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(html.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }
    assert.ok(
        html.indexOf('data-view="create"') < html.indexOf('data-view="import"'),
        'Import tab should appear after Create tab'
    );
    assert.ok(
        html.indexOf('data-view="import"') < html.indexOf('data-view="manage"'),
        'Import tab should appear before Manage tab'
    );
    assert.ok(
        html.indexOf('id="view-import"') < html.indexOf('id="view-manage"'),
        'Import view should appear before Manage view'
    );
    assert.equal(
        html.includes('<select id="galleryImportDefaultStatus"'),
        false,
        'Import must not expose a native status selector'
    );
    assert.equal(
        html.includes('id="galleryImportDefaultStatusDropdown"'),
        false,
        'Import must not allow bypassing the full analysis and publish pipeline with a preset live status'
    );

    const jsMarkers = [
        "const GALLERY_VIEW_NAMES = Object.freeze(new Set(['create', 'import', 'manage']));",
        "galleryRouteState.view !== 'create'",
        "normalizedView === 'import'",
        "const GALLERY_IMPORT_SOURCE_URL = 'https://www.meigen.ai';",
        "const GALLERY_IMPORT_COLLECTOR_SCRIPT_PATH = '/integrations/meigen-gallery-collector/meigen-gallery-collector.user.js';",
        "const GALLERY_IMPORT_COLLECTOR_VERSION = '2026-07-10.48';",
        'const GALLERY_IMPORT_FAILURE_STAGES = Object.freeze({',
        'function normalizeGalleryImportFailureMessage(errorOrMessage = \'\', fallback = \'处理失败\')',
        'function createGalleryImportStageError(stage = \'unknown\', error = null)',
        'function getGalleryImportFailureInfo(item = {})',
        'function buildGalleryImportCollectorBookmarklet()',
        'function copyGalleryImportCollector()',
        'function buildGalleryImportPreviewItems(items = [])',
        'function loadGalleryImportRawText(rawText = \'\', statusPrefix = \'已读取\')',
        'function pasteGalleryImportClipboard()',
        "case 'gallery-import-open-source':",
        "case 'gallery-import-copy-collector':",
        "case 'gallery-import-paste-clipboard':",
        'const galleryImportState = {',
        "mode: 'crawl_only'",
        'function parseGalleryImportRawInput(rawText = \'\')',
        'function runGalleryImportUploadQueue()',
        'function isGalleryImportItemReadyForUpload(item = {})',
        'function skipGalleryImportItems(items = [], reason = \'信息不完整，已跳过\')',
        'function failGalleryImportItems(items = [], reason = \'已保存，但发布流程未完成\')',
        'function hasMeaningfulGalleryImportAnalysisValue(value)',
        'function isGalleryImportGeneratedTitle(value = \'\')',
        'function getGalleryImportPromptAnalysisChecks(prompt = {})',
        'function getGalleryImportMissingAnalysisLabels(prompt = {})',
        'function hasGalleryImportPromptAnalysis(prompt = {})',
        'function getGalleryImportMissingBilingualLabels(prompt = {})',
        'function getGalleryImportPromptProcessingState(prompt = {}, settings = {})',
        'function buildGalleryImportProcessingStatusReason(processingState = {})',
        'function refreshGalleryImportProcessingStatus(options = {})',
        'objects: hasMeaningfulGalleryImportAnalysisValue(aiTags.objects)',
        'commercial: hasMeaningfulGalleryImportAnalysisValue(aiTags.commercial)',
        'dominantColors: hasMeaningfulGalleryImportAnalysisValue(',
        'const missingBilingual = getGalleryImportMissingBilingualLabels(prompt);',
        "const published = getPromptAdminOpsData(prompt).status === 'live'",
        "(status === 'imported' && Boolean(finalPromptId))",
        'function runGalleryImportPostSavePipeline(prompt = {}, item = {}, context = {})',
        'function runGalleryImportPipelineStageWithRetry({',
        'function isGalleryImportPipelineRetryableError(error = null)',
        'function loadGalleryImportSavedPrompt(item = {}, writableSite = getAdminPromptsReadSite())',
        'function loadRecentGalleryImportSavedItems(limit = 20)',
        'function buildCompletePromptAnalysisResult(result = {})',
        'function buildPromptFullAnalysisPayload(prompt = {}, result = {})',
        'function preparePromptImagesForFullAnalysis(prompt = {}, maxImages = 6)',
        'const GALLERY_IMPORT_ANALYSIS_MAX_ATTEMPTS = 2;',
        'const GALLERY_IMPORT_BILINGUAL_MAX_ATTEMPTS = 3;',
        "parallelism: normalizeGalleryImportNumber(document.getElementById('galleryImportParallelism')?.value, 2, 3) || 2",
        'const parallelism = Math.max(1, Math.min(Number(settings.parallelism || 2), readyItems.length, 3));',
        'const workers = Array.from({ length: parallelism }, async () => {',
        'await Promise.all(workers);',
        'reportStatus(`检查当前状态 ${index + 1} / ${readyItems.length}`);',
        '__processingStatus: statusText',
        'const seenSourceUrls = new Set();',
        'const processingState = getGalleryImportPromptProcessingState(pipelinePrompt, settings);',
        'let processingState = context.processingState',
        'if (!processingState.analyzed)',
        'if (!processingState.bilingual)',
        'if (!processingState.published)',
        "if (processingState.nextStage !== 'cleanup')",
        'await sleep(GALLERY_IMPORT_STAGE_GAP_MS);',
        'function completePromptBilingualFields(prompt = {}, writableSite = getAdminPromptsReadSite(), options = {})',
        'function setPromptAdminStatus(prompt = {}, nextStatus = \'\', writableSite = getAdminPromptsReadSite())',
        'function updateGalleryImportProgress()',
        'function renderGalleryImportQueue(items = galleryImportState.items)',
        'function getGalleryImportAssetUrls(item = {}, fieldName = \'final_image_assets\')',
        'function getGalleryImportExpectedImageCount(item = {})',
        'function getGalleryImportDisplayImageCount(item = {})',
        'return Math.max(\n        getGalleryImportAssetUrls(item, \'final_image_assets\').length',
        'const failureStages = rows.reduce((acc, item) => {',
        'const failureBreakdown = Object.entries(failureStageCounts)',
        "throw createGalleryImportStageError('analysis', error);",
        "throw createGalleryImportStageError('bilingual', error);",
        "throw createGalleryImportStageError('publish', error);",
        'function getGalleryImportCoverUrl(item = {})',
        'function getPromptImageUrlsFromAssets',
        "mutateGalleryImport('stage_items'",
        "mutateGalleryImport('upload_item'",
        "mutateGalleryImport('skip_items'",
        "mutateGalleryImport('fail_items'",
        "mutateGalleryImport('cleanup_items'",
        'function clearCurrentGalleryImportQueue',
        'function fetchImageBase64ViaAdmin',
        "route=prompts/image-base64",
        'function getImageBase64ForAnalysis',
        'currentEditingPromptImageUrls = getPromptImageUrlsFromAssets(currentEditingPromptImageAssets);',
        'const imageData = await getImageBase64ForAnalysis(imageUrl);',
        'await runGalleryImportPostSavePipeline(pipelinePrompt, pipelineItem, {',
        "await setPromptAdminStatus(currentPrompt, 'live', writableSite);",
        "mode: 'full'",
        'await refreshGalleryImportProcessingStatus({ silent: true });',
        'initCustomDropdown?.();',
        "case 'gallery-import-set-mode':",
        "case 'gallery-import-start':",
        "case 'gallery-import-refresh-status':"
    ];

    for (const marker of jsMarkers) {
        assert.equal(js.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const cssMarkers = [
        '.gallery-import-assistant',
        '.gallery-import-mode-tabs',
        '.gallery-import-progress__row',
        '.gallery-import-queue',
        '.gallery-import-item__count',
        '.gallery-import-item__error',
        '.gallery-import-item__notice',
        '.gallery-import-summary .is-warning',
        '.gallery-import-select .select-display',
        'grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));',
        '--gallery-import-accent: var(--accent-purple, #6b9ece);',
        'box-sizing: border-box;',
        '.gallery-import-controls input[type="number"]::-webkit-inner-spin-button',
        '.gallery-import-control-toggle input[type="checkbox"]',
        '.gallery-import-control-toggle input[type="checkbox"]:checked + span::before',
        'appearance: none;'
    ];

    for (const marker of cssMarkers) {
        assert.equal(css.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }
    assert.equal(
        css.includes('.gallery-import-mode-tab.is-active {\n    background: rgba(59, 130, 246'),
        false,
        'Import active tab should use Admin Studio accent instead of bright blue'
    );
    assert.equal(
        css.includes('.gallery-import-controls input:focus,\n.gallery-import-raw-input:focus {\n    border-color: rgba(37, 99, 235'),
        false,
        'Import input focus should use Admin Studio accent instead of bright blue'
    );

    assert.equal(api.includes("const promptsImportsHandler = require('../server/api-handlers/admin/prompts/imports');"), true);
    assert.equal(api.includes("const promptsImageBase64Handler = require('../server/api-handlers/admin/prompts/image-base64');"), true);
    assert.equal(api.includes("'prompts/image-base64': promptsImageBase64Handler"), true);
    assert.equal(api.includes("'prompts/imports': promptsImportsHandler"), true);

    const handlerMarkers = [
        'async function stageImportItems',
        'const maxItems = normalizePositiveInteger(settings.max_items, 50, 1000);',
        '.slice(0, maxItems)',
        'async function importSingleItem',
        'async function findExistingPromptForImportItem',
        'prompt_import.skip_duplicate',
        'async function uploadImportItemImages',
        'function buildCleanedImportedItemPayload',
        'function buildDeferredImportedItemPayload',
        'import_image_count',
        'expected_image_count',
        'source_image_count',
        'async function skipImportItems',
        'async function markImportItemsFailed',
        "status: 'imported'",
        "prompt_text: ''",
        'image_sources: []',
        "action === 'skip_items'",
        "action === 'fail_items'",
        "await requireAdmin(req, { permission: 'prompts.manage' })"
    ];
    for (const marker of handlerMarkers) {
        assert.equal(handler.includes(marker), true, `imports handler should contain ${marker}`);
    }

    const migrationMarkers = [
        'CREATE TABLE IF NOT EXISTS public.prompt_import_batches',
        'CREATE TABLE IF NOT EXISTS public.prompt_import_items',
        'image_sources JSONB NOT NULL DEFAULT',
        'final_prompt_id UUID',
        'cleaned_at TIMESTAMPTZ',
        'Service role can manage prompt import batches.',
        'Service role can manage prompt import items.'
    ];
    for (const marker of migrationMarkers) {
        assert.equal(migration.includes(marker), true, `migration should contain ${marker}`);
    }

    const promptIdFixMarkers = [
        'ALTER TABLE public.prompt_import_items',
        'ALTER COLUMN final_prompt_id TYPE TEXT',
        'ALTER COLUMN duplicate_of_prompt_id TYPE TEXT',
        'Supports numeric or UUID prompt tables.'
    ];
    for (const marker of promptIdFixMarkers) {
        assert.equal(promptIdFixMigration.includes(marker), true, `prompt id fix migration should contain ${marker}`);
    }
});

test('prompt import payload requires source attribution, prompt, and images', () => {
    const { _private } = require('../server/api-handlers/admin/prompts/imports');
    const item = _private.normalizeImportItemPayload({
        prompt: 'A tiny city inside a crystal apple',
        original_work_url: 'https://x.com/artist/status/1234567890',
        author_name: 'Crystal Artist',
        author_handle: '@crystal_artist',
        images: [
            'https://images.example.com/a.jpg',
            { url: 'https://images.example.com/b.webp' }
        ]
    }, { max_images_per_item: 12 });

    assert.equal(item.status, 'staged');
    assert.equal(item.original_work_url, 'https://x.com/artist/status/1234567890');
    assert.equal(item.author_name, 'Crystal Artist');
    assert.equal(item.author_handle, '@crystal_artist');
    assert.equal(item.image_sources.length, 2);
    assert.equal(item.error_details.import_image_count, 2);

    const promptPayload = _private.buildPromptPayloadFromImportItem(item, {
        imageAssets: [
            { original: 'https://cdn.fatherkey.com/prompts/imports/a.jpg' },
            { original: 'https://cdn.fatherkey.com/prompts/imports/b.webp' }
        ],
        defaultStatus: 'live'
    });

    assert.equal(promptPayload.title, '');
    assert.equal(promptPayload.source_url, 'https://x.com/artist/status/1234567890');
    assert.equal(promptPayload.source_author_name, 'Crystal Artist');
    assert.equal(promptPayload.source_author_handle, '@crystal_artist');
    assert.equal(promptPayload.prompt_text_zh, '');
    assert.equal(promptPayload.ai_tags.admin.status, 'review');
    assert.deepEqual(promptPayload.images, [
        'https://cdn.fatherkey.com/prompts/imports/a.jpg',
        'https://cdn.fatherkey.com/prompts/imports/b.webp'
    ]);

    const missingPrompt = _private.normalizeImportItemPayload({
        images: ['https://images.example.com/a.jpg']
    }, { max_images_per_item: 12 });
    assert.equal(missingPrompt.status, 'needs_review');
    assert.equal(missingPrompt.error_summary.includes('没有抓到提示词'), true);

    const missingSource = _private.normalizeImportItemPayload({
        prompt: 'A tiny city inside a crystal apple',
        images: ['https://images.example.com/a.jpg']
    }, { max_images_per_item: 12 });
    assert.equal(missingSource.status, 'needs_review');
    assert.equal(missingSource.error_summary.includes('缺少 X 原帖链接'), true);
    assert.equal(missingSource.error_summary.includes('缺少原作者昵称'), true);
    assert.equal(missingSource.error_summary.includes('缺少原作者 ID'), true);

    const expectedCountItem = _private.normalizeImportItemPayload({
        prompt: 'A tiny city inside a crystal apple',
        original_work_url: 'https://x.com/artist/status/1234567890',
        author_name: 'Crystal Artist',
        author_handle: '@crystal_artist',
        expected_image_count: 4,
        images: ['https://images.example.com/a.jpg']
    }, { max_images_per_item: 12 });
    assert.equal(expectedCountItem.error_details.import_image_count, 4);
    assert.equal(expectedCountItem.error_details.source_image_count, 1);

    const cleanedItemPayload = _private.buildCleanedImportedItemPayload({
        finalPromptId: 379,
        finalImageAssets: [{ original: 'https://cdn.fatherkey.com/prompts/imports/a.jpg' }]
    });
    assert.equal(cleanedItemPayload.final_prompt_id, '379');
});

test('admin prompt image base64 helper only accepts public image urls', () => {
    const { _private } = require('../server/api-handlers/admin/prompts/image-base64');

    assert.equal(_private.normalizeImageUrl('https://cdn.example.com/a.jpg'), 'https://cdn.example.com/a.jpg');
    assert.equal(_private.normalizeImageUrl('http://localhost:3000/a.jpg'), '');
    assert.equal(_private.normalizeImageUrl('http://127.0.0.1/a.jpg'), '');
    assert.equal(_private.normalizeImageUrl('file:///tmp/a.jpg'), '');
});
