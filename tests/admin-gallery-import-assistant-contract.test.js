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
    const thumbnailHandler = readRepoFile(path.join('server', 'api-handlers', 'admin', 'prompts', 'image-thumbnail.js'));
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
        'id="galleryImportPagination"',
        'id="galleryImportBatchTracker"',
        'id="galleryImportBatchSelect"',
        'id="galleryImportBatchSummary"',
        '批次追踪',
        'id="galleryImportParallelismDropdown"',
        'id="galleryImportParallelism" value="8"',
        '同时处理',
        'data-value="4">4 条',
        'data-value="5">5 条',
        'data-value="6">6 条',
        'data-value="10">10 条',
        'id="galleryImportAnalyzeAfterSave" checked disabled',
        '完整分析后发布',
        'id="galleryImportAutoDetectQueue"',
        '自动检测服务端队列',
        'data-admin-action="gallery-import-start"',
        'data-admin-action="gallery-import-upload-staged"',
        'data-admin-action="gallery-import-cleanup"',
        'data-admin-action="gallery-import-clear-current"',
        '清空当前队列',
        'data-admin-action="gallery-import-delete-batch"',
        '删除批次记录',
        'galleryImportRetry=20260710_GALLERY_FULL_ANALYSIS_BILINGUAL_2',
        'galleryImportPipeline=20260710_GALLERY_FULL_ANALYSIS_BILINGUAL_2',
        'galleryImportPagination=20260714_ADMIN_GALLERY_IMPORT_PAGINATION_1',
        'galleryImportThumb=20260714_ADMIN_GALLERY_IMPORT_THUMBNAIL_1',
        'galleryImportControls=20260714_GALLERY_IMPORT_CONTROLS_1'
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
        "const GALLERY_IMPORT_COLLECTOR_VERSION = '2026-07-14.82';",
        'const GALLERY_IMPORT_FAILURE_STAGES = Object.freeze({',
        'function normalizeGalleryImportFailureMessage(errorOrMessage = \'\', fallback = \'处理失败\')',
        'Codex Relay 当前上游账号被限流或暂无可用账号，系统将延迟重试',
        'Codex Relay 上游网关暂时不可用，系统将延迟重试',
        'Codex Relay 上游账号额度不足，请检查账号额度后重试',
        'function createGalleryImportStageError(stage = \'unknown\', error = null)',
        '当前 AI 服务密钥无效或已失效',
        'function getGalleryImportFailureInfo(item = {})',
        'function buildGalleryImportCollectorBookmarklet()',
        'function copyGalleryImportCollector()',
        'function buildGalleryImportPreviewItems(items = [])',
        'function loadGalleryImportRawText(rawText = \'\', statusPrefix = \'已读取\')',
        'function pasteGalleryImportClipboard()',
        "case 'gallery-import-open-source':",
        "case 'gallery-import-copy-collector':",
        "case 'gallery-import-paste-clipboard':",
        "case 'gallery-import-delete-batch':",
        'async function deleteCurrentGalleryImportBatch()',
        "mutateGalleryImport('delete_batch'",
        'const galleryImportState = {',
        "mode: 'crawl_only'",
        'function parseGalleryImportRawInput(rawText = \'\')',
        'function getGalleryImportAuthorHandle(item = {}, originalWorkUrl = \'\')',
        'function runGalleryImportUploadQueue(options = {})',
        'function isGalleryImportItemAutoUploadable(item = {})',
        'function setGalleryImportAutoDetectionEnabled(enabled, options = {})',
        'async function runGalleryImportAutoDetectionCycle()',
        'navigator.locks.request(',
        '服务端 Worker 正在处理',
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
        'const GALLERY_IMPORT_AUTO_DETECT_INTERVAL_MS = 5000;',
        "const GALLERY_IMPORT_AUTO_DETECT_STORAGE_KEY = 'fatherKey.galleryImport.autoDetectQueue';",
        "const GALLERY_IMPORT_AUTO_DETECT_LOCK_NAME = 'father-key-gallery-import-auto-upload';",
        'const GALLERY_IMPORT_MAX_PARALLELISM = 10;',
        'const GALLERY_IMPORT_DEFAULT_PARALLELISM = 8;',
        "const GALLERY_IMPORT_PARALLELISM_STORAGE_KEY = 'fatherKey.galleryImport.parallelism';",
        'const GALLERY_IMPORT_ADAPTIVE_INITIAL_PARALLELISM = 8;',
        'const GALLERY_IMPORT_ADAPTIVE_MIN_PARALLELISM = 1;',
        'const GALLERY_IMPORT_ADAPTIVE_LAUNCH_GAP_MS = 500;',
        'const GALLERY_IMPORT_ADAPTIVE_COOLDOWN_MS = 6000;',
        'GALLERY_IMPORT_MAX_PARALLELISM',
        'const applyAdaptivePressure = (result = {}) => {',
        'adaptiveParallelism = Math.max(',
        'stableCompletions >= adaptiveParallelism',
        'const launchAdaptiveTask = (index) => {',
        'await Promise.race(runningTasks);',
        'onRetryableError: onPressureSignal',
        'pressureLimited: pressureSignaled',
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
        'const GALLERY_IMPORT_PAGE_SIZE = 10;',
        'pageSize: 10',
        'function getGalleryImportTotalItems()',
        'function normalizeGalleryImportPage(page = galleryImportState.page, totalItems = getGalleryImportTotalItems())',
        'function renderGalleryImportPagination(totalItems = getGalleryImportTotalItems())',
        'async function changeGalleryImportPage(page)',
        'const pageRows = galleryImportState.serverPaginated',
        'serverPaginated: false',
        'async function loadAllGalleryImportBatchItems(batchId, options = {})',
        'pageSize: galleryImportState.pageSize',
        'data-admin-action="gallery-import-pagination-go"',
        'data-admin-change-action="gallery-import-pagination-go"',
        'function scheduleGalleryImportQueueRender()',
        'function upsertGalleryImportItems(items = [])',
        'fetchpriority="low"',
        'function getGalleryImportBatchStats(batch = {})',
        'function selectGalleryImportBatch(batches = [], options = {})',
        'batchSelectionLocked: false',
        'localPreviewLocked: false',
        'galleryImportState.localPreviewLocked = true',
        "batch_id: wasLocalPreviewLocked ? '' : (galleryImportState.batch?.id || ''),",
        'if (galleryImportState.localPreviewLocked && options.force !== true)',
        '|| galleryImportState.localPreviewLocked',
        'preferPending: options.preferPending === true && !galleryImportState.batchSelectionLocked',
        'function renderGalleryImportBatchTracker()',
        'async function loadGalleryImportBatchById(batchId, options = {})',
        'preferPending: options.preferPending === true',
        'await loadLatestGalleryImportBatch({ silent: true, preferPending: true });',
        '实际入队 ${stats.accepted}',
        '仓库重复 ${stats.skippedDuplicates}',
        '阶段：${pipelineStage}',
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
        'function getGalleryImportPreviewImageUrl(imageUrl = \'\')',
        "proxyUrl.searchParams.set('route', 'prompts/image-thumbnail');",
        'function handleGalleryImportPreviewImageError(event)',
        "document.addEventListener('error', handleGalleryImportPreviewImageError, true);",
        'function getPromptImageUrlsFromAssets',
        "mutateGalleryImport('stage_items'",
        'compact_response: true',
        "mutateGalleryImport('upload_item'",
        "mutateGalleryImport('skip_items'",
        "mutateGalleryImport('fail_items'",
        "mutateGalleryImport('cleanup_items'",
        "mutateGalleryImport('cleanup_rejected_items'",
        'function autoCleanupRejectedGalleryImportItems',
        'localStorage.setItem(GALLERY_IMPORT_PARALLELISM_STORAGE_KEY, String(value))',
        'function clearCurrentGalleryImportQueue',
        "hadSavedPromptReference ? 'lookup' : 'upload'",
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
    assert.equal(api.includes("'prompts/image-thumbnail': promptsImageThumbnailHandler"), true);
    assert.equal(thumbnailHandler.includes(".webp({ quality: 72, effort: 2 })"), true);
    assert.equal(thumbnailHandler.includes("'Cache-Control', 'private, max-age=86400'"), true);
    assert.equal(js.includes('const workers = Array.from({ length: parallelism }'), false);

    const cssMarkers = [
        '.gallery-import-assistant',
        '.gallery-import-mode-tabs',
        '.gallery-import-progress__row',
        '.gallery-import-queue',
        '.gallery-import-pagination',
        '.gallery-import-pagination__summary',
        'content-visibility: auto;',
        'contain-intrinsic-size: 280px 380px;',
        '.gallery-import-item__count',
        '.gallery-import-item__error',
        '.gallery-import-item__notice',
        '.gallery-import-summary .is-warning',
        '.gallery-import-batch-tracker',
        '.gallery-import-batch-tracker__summary',
        '.gallery-import-item__worker',
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
        'async function checkImportItemDuplicates',
        "sourceIdentityOnly: settings.source === 'meigen'",
        "sourceIdentityOnly: source === 'meigen'",
        "existingBySourceItemId.has(String(row.source_item_id || ''))",
        'ignoredExistingCount: ignoredExistingIndexes.size',
        "if (action === 'check_duplicates')",
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
        'async function cleanupRejectedImportItems',
        'async function deleteImportBatch',
        "if (action === 'delete_batch')",
        "actionType: 'prompt_import.delete_batch'",
        'skippedDuplicateCount: duplicateIndexes.size',
        'attemptedCount: rows.length',
        'stagedCount: data.length',
        'items: body.compact_response === true ? [] : result.items',
        'skipped_duplicates: Math.max(0, Number(previousStats.skipped_duplicates || 0))',
        "request = request.neq('status', 'cleaned')",
        ".select(IMPORT_ITEM_SELECT, { count: 'exact' })",
        '.range(pageStart, pageStart + pageSize - 1)',
        'pagination: itemPage.pagination',
        "status: 'imported'",
        "prompt_text: ''",
        'image_sources: []',
        "action === 'skip_items'",
        "action === 'fail_items'",
        "action === 'cleanup_rejected_items'",
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

test('prompt import batch details use server-side pagination with exact totals', async () => {
    const { _private } = require('../server/api-handlers/admin/prompts/imports');
    const query = _private.getImportPageQuery(new URLSearchParams({
        batchId: 'batch-paged',
        page: '3',
        pageSize: '10'
    }));
    assert.deepEqual(query, {
        batchId: 'batch-paged',
        status: '',
        includeCleaned: false,
        page: 3,
        pageSize: 10
    });

    const calls = [];
    const request = {
        select(columns, options) {
            calls.push(['select', columns, options]);
            return this;
        },
        eq(field, value) {
            calls.push(['eq', field, value]);
            return this;
        },
        neq(field, value) {
            calls.push(['neq', field, value]);
            return this;
        },
        order(field, options) {
            calls.push(['order', field, options]);
            return this;
        },
        async range(from, to) {
            calls.push(['range', from, to]);
            return {
                data: Array.from({ length: 10 }, (_, index) => ({ id: `item-${index + 21}` })),
                count: 57,
                error: null
            };
        }
    };
    const supabase = {
        from(table) {
            calls.push(['from', table]);
            return request;
        }
    };
    const result = await _private.listImportItems(supabase, query);

    assert.equal(result.items.length, 10);
    assert.deepEqual(result.pagination, {
        page: 3,
        pageSize: 10,
        total: 57,
        totalPages: 6
    });
    assert.deepEqual(calls.at(-1), ['range', 20, 29]);
    assert.deepEqual(calls[1][2], { count: 'exact' });
});

test('prompt import batch deletion cascades idle queue records', async () => {
    const { _private } = require('../server/api-handlers/admin/prompts/imports');
    const calls = [];
    const batch = {
        id: 'batch-delete',
        source: 'meigen',
        site: 'cn',
        status: 'needs_attention',
        stats: { total: 12 }
    };
    const supabase = {
        from(table) {
            if (table === 'prompt_import_batches') {
                return {
                    select() {
                        return {
                            eq() {
                                return { async single() { return { data: batch, error: null }; } };
                            }
                        };
                    },
                    delete() {
                        calls.push('delete-batch');
                        return {
                            eq() {
                                return {
                                    select() {
                                        return { async single() { return { data: batch, error: null }; } };
                                    }
                                };
                            }
                        };
                    }
                };
            }
            if (table === 'prompt_import_items') {
                return {
                    select() {
                        return {
                            eq() {
                                return { async in() { return { data: [], error: null }; } };
                            }
                        };
                    }
                };
            }
            assert.equal(table, 'admin_audit_logs');
            return {
                async insert(payload) {
                    calls.push(payload.action_type);
                    return { error: null };
                }
            };
        }
    };

    const result = await _private.deleteImportBatch(supabase, { id: 'admin-1' }, {
        batch_id: batch.id
    });
    assert.equal(result.deletedBatchId, batch.id);
    assert.equal(result.deletedItemCount, 12);
    assert.deepEqual(calls, ['delete-batch', 'prompt_import.delete_batch']);
});

test('prompt import batch deletion blocks active worker records', async () => {
    const { _private } = require('../server/api-handlers/admin/prompts/imports');
    const batch = {
        id: 'batch-busy',
        source: 'meigen',
        site: 'cn',
        status: 'ready',
        stats: { total: 2 }
    };
    const supabase = {
        from(table) {
            if (table === 'prompt_import_batches') {
                return {
                    select() {
                        return {
                            eq() {
                                return { async single() { return { data: batch, error: null }; } };
                            }
                        };
                    }
                };
            }
            assert.equal(table, 'prompt_import_items');
            return {
                select() {
                    return {
                        eq() {
                            return {
                                async in() {
                                    return { data: [{ id: 'active-1', status: 'uploading' }], error: null };
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    await assert.rejects(
        _private.deleteImportBatch(supabase, { id: 'admin-1' }, { batch_id: batch.id }),
        (error) => error.statusCode === 409 && error.code === 'prompt_import_batch_busy'
    );
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

    const derivedHandleItem = _private.normalizeImportItemPayload({
        prompt: 'A vivid herbal candy commercial poster',
        original_work_url: 'https://x.com/user_3f39e769/status/2074535407157653609',
        author_name: '只吃苹果派',
        images: ['https://images.example.com/herbal-candy.jpg']
    }, { max_images_per_item: 12 });
    assert.equal(derivedHandleItem.status, 'staged');
    assert.equal(derivedHandleItem.author_handle, '@user_3f39e769');
    assert.equal(
        _private.deriveAuthorHandleFromOriginalWorkUrl('https://twitter.com/example/status/1234567890'),
        '@example'
    );

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

    const identityBoundItem = _private.normalizeImportItemPayload({
        source: 'meigen',
        prompt: 'High-end fashion portrait with a teal coat and editorial typography',
        original_work_url: 'https://x.com/artist/status/2052602437530243303',
        author_name: 'Artist',
        author_handle: '@artist',
        expected_image_count: 17,
        images: [
            'https://images.meigen.ai/tweets/2052602437530243303/0.jpg',
            'https://images.meigen.ai/tweets/9999999999999999999/0.jpg',
            'https://www.meigen.ai/image'
        ]
    }, { max_images_per_item: 12 });
    assert.deepEqual(identityBoundItem.image_sources, [
        { url: 'https://images.meigen.ai/tweets/2052602437530243303/0.jpg' }
    ]);
    assert.equal(identityBoundItem.error_details.expected_image_count, 1);
    assert.equal(identityBoundItem.error_details.import_image_count, 1);

    const cleanedItemPayload = _private.buildCleanedImportedItemPayload({
        finalPromptId: 379,
        finalImageAssets: [{ original: 'https://cdn.fatherkey.com/prompts/imports/a.jpg' }]
    });
    assert.equal(cleanedItemPayload.final_prompt_id, '379');
});

test('prompt import image guard rejects private hosts and non-image payloads', () => {
    const { _private } = require('../server/api-handlers/admin/prompts/imports');
    assert.equal(_private.isBlockedImportHostname('127.0.0.1'), true);
    assert.equal(_private.isBlockedImportHostname('[::1]'), true);
    assert.equal(_private.isBlockedImportHostname('metadata.google.internal'), true);
    assert.equal(_private.isBlockedImportHostname('images.meigen.ai'), false);
    assert.equal(_private.isSupportedImageBuffer(Buffer.from('<!doctype html>not an image')), false);
    assert.equal(_private.isSupportedImageBuffer(Buffer.from([0xff, 0xd8, 0xff, ...new Array(16).fill(0)])), true);
});

test('prompt repository dedupe scans fixed-size pages instead of putting prompts in query URLs', async () => {
    const { _private } = require('../server/api-handlers/admin/prompts/imports');
    const longPrompt = `cinematic scene ${'detail '.repeat(1000)}`;
    const calls = [];
    const supabase = {
        from(table) {
            assert.equal(table, 'prompts');
            return {
                select(fields) {
                    calls.push({ type: 'select', fields });
                    return {
                        order(field) {
                            calls.push({ type: 'order', field });
                            return {
                                async range(start, end) {
                                    calls.push({ type: 'range', start, end });
                                    return {
                                        data: [{
                                            id: 'existing-prompt',
                                            source_url: 'https://x.com/artist/status/123',
                                            prompt_text: longPrompt,
                                            prompt_text_en: '',
                                            prompt_text_zh: ''
                                        }],
                                        error: null
                                    };
                                }
                            };
                        }
                    };
                }
            };
        }
    };
    const result = await _private.findExistingPromptDuplicates(supabase, [{
        original_work_url: 'https://x.com/artist/status/123',
        prompt_text: longPrompt
    }]);
    assert.equal(result.bySourceUrl.get('https://x.com/artist/status/123'), 'existing-prompt');
    assert.equal(result.byPromptHash.get(_private.hashPromptText(longPrompt)), 'existing-prompt');
    assert.deepEqual(calls.find((call) => call.type === 'range'), { type: 'range', start: 0, end: 499 });
});

test('Meigen repository dedupe uses direct source identity lookup', async () => {
    const { _private } = require('../server/api-handlers/admin/prompts/imports');
    const calls = [];
    const supabase = {
        from(table) {
            assert.equal(table, 'prompts');
            return {
                select() {
                    return {
                        async in(field, values) {
                            calls.push({ field, values });
                            return {
                                data: [{
                                    id: 'existing-source',
                                    source_url: 'https://x.com/artist/status/123',
                                    prompt_text: 'Existing long prompt',
                                    prompt_text_en: '',
                                    prompt_text_zh: ''
                                }],
                                error: null
                            };
                        }
                    };
                }
            };
        }
    };
    const result = await _private.findExistingPromptDuplicates(supabase, [{
        original_work_url: 'https://x.com/artist/status/123',
        prompt_text: `long prompt ${'detail '.repeat(1000)}`
    }], { sourceIdentityOnly: true });
    assert.equal(result.bySourceUrl.get('https://x.com/artist/status/123'), 'existing-source');
    assert.deepEqual(calls, [{
        field: 'source_url',
        values: ['https://x.com/artist/status/123']
    }]);
});

test('collector duplicate preflight reports repository and candidate duplicates without writing', async () => {
    const { _private } = require('../server/api-handlers/admin/prompts/imports');
    const calls = [];
    const supabase = {
        from(table) {
            calls.push(table);
            if (table === 'prompt_import_items') {
                return {
                    select() {
                        return {
                            in() {
                                return {
                                    eq() {
                                        return {
                                            async is() {
                                                return { data: [], error: null };
                                            }
                                        };
                                    }
                                };
                            }
                        };
                    }
                };
            }
            assert.equal(table, 'prompts');
            return {
                select() {
                    return {
                        async in() {
                            return {
                                data: [{
                                    id: 'existing-prompt',
                                    source_url: 'https://x.com/artist/status/123456789012',
                                    prompt_text: 'Existing repository prompt',
                                    prompt_text_en: '',
                                    prompt_text_zh: ''
                                }],
                                error: null
                            };
                        }
                    };
                }
            };
        }
    };
    const result = await _private.checkImportItemDuplicates(supabase, {
        source: 'meigen',
        settings: { max_items: 10 },
        items: [
            { source_item_id: 'repo-copy', original_work_url: 'https://x.com/artist/status/123456789012', prompt: 'Existing repository prompt' },
            { source_item_id: 'new-one', original_work_url: 'https://x.com/artist/status/223456789012', prompt: 'New unique prompt' },
            { source_item_id: 'candidate-copy', original_work_url: 'https://x.com/artist/status/323456789012', prompt: 'New unique prompt' }
        ]
    });
    assert.deepEqual(result, {
        checkedCount: 3,
        duplicateCount: 2,
        duplicateSourceItemIds: ['repo-copy', 'candidate-copy'],
        persistentFailureCount: 0,
        persistentFailureSourceItemIds: [],
        rejectedIdentityCount: 0,
        rejectedIdentitySourceItemIds: []
    });
    assert.deepEqual(calls, ['prompts', 'prompt_import_items']);
});

test('collector suppresses only unresolved sources cleaned across distinct batches', () => {
    const { _private } = require('../server/api-handlers/admin/prompts/imports');
    assert.deepEqual(_private.getPersistentFailureSourceItemIds([
        { batch_id: 'batch-a', source_item_id: 'persistent', status: 'cleaned', final_prompt_id: null },
        { batch_id: 'batch-a', source_item_id: 'persistent', status: 'cleaned', final_prompt_id: null },
        { batch_id: 'batch-b', source_item_id: 'persistent', status: 'cleaned', final_prompt_id: null },
        { batch_id: 'batch-a', source_item_id: 'single-batch', status: 'cleaned', final_prompt_id: null },
        { batch_id: 'batch-a', source_item_id: 'imported', status: 'cleaned', final_prompt_id: 'prompt-1' },
        { batch_id: 'batch-b', source_item_id: 'imported', status: 'cleaned', final_prompt_id: 'prompt-1' },
        { batch_id: 'batch-a', source_item_id: 'not-cleaned', status: 'failed', final_prompt_id: null },
        { batch_id: 'batch-b', source_item_id: 'not-cleaned', status: 'failed', final_prompt_id: null }
    ]), ['persistent']);
});

test('Meigen import rejects mismatched detail, source, and image identities', () => {
    const { _private } = require('../server/api-handlers/admin/prompts/imports');
    assert.match(_private.getMeigenImportIdentityConflictReason({
        source: 'meigen',
        source_item_id: '2029817553288319295',
        source_page_url: 'https://www.meigen.ai/prompt/2045717144319697140',
        original_work_url: 'https://x.com/Kashberg_0/status/2029817553288319295',
        image_sources: [{ url: 'https://images.meigen.ai/tweets/2063224488494575823/0.jpg' }]
    }), /身份不一致/);
    assert.equal(_private.getMeigenImportIdentityConflictReason({
        source: 'meigen',
        source_item_id: '2070884374904525180',
        source_page_url: 'https://www.meigen.ai/prompt/2070884374904525180',
        original_work_url: 'https://x.com/codewithhajra/status/2070884374904525180',
        image_sources: [{ url: 'https://images.meigen.ai/tweets/2070884374904525180/0.jpg' }]
    }), '');
    assert.equal(_private.getMeigenImportIdentityConflictReason({
        source: 'meigen',
        source_item_id: 'meigen-community',
        source_page_url: 'https://www.meigen.ai/prompt/community_abc',
        original_work_url: 'https://x.com/user/status/2070884374904525180',
        image_sources: [{ url: 'https://images.meigen.ai/generations/community_abc.png' }]
    }), '');
});

test('streaming imports remain in review until detail enrichment arrives', () => {
    const { _private } = require('../server/api-handlers/admin/prompts/imports');
    const pending = _private.normalizeImportItemPayload({
        source: 'meigen',
        source_item_id: '2070884374904525180',
        source_page_url: 'https://www.meigen.ai/prompt/2070884374904525180',
        original_work_url: 'https://x.com/codewithhajra/status/2070884374904525180',
        author_name: 'H A J R A',
        author_handle: '@codewithhajra',
        prompt: 'A complete-looking list prompt',
        images: ['https://images.meigen.ai/tweets/2070884374904525180/0.jpg'],
        stream_pending_detail: true
    });
    assert.equal(pending.status, 'needs_review');
    assert.match(pending.error_summary, /等待详情补全/);
});

test('automatic import cleanup preserves complete transient failures', () => {
    const { _private } = require('../server/api-handlers/admin/prompts/imports');
    const complete = {
        id: 'complete-failed',
        status: 'failed',
        prompt_text: 'Complete prompt',
        image_sources: [{ url: 'https://images.example.com/a.jpg' }],
        original_work_url: 'https://x.com/artist/status/1234567890',
        author_name: 'Artist',
        author_handle: '@artist'
    };
    const incomplete = { ...complete, id: 'incomplete-review', status: 'needs_review', prompt_text: '' };
    const skipped = { ...complete, id: 'skipped', status: 'skipped' };
    const duplicate = { ...complete, id: 'duplicate', status: 'duplicate' };
    const pendingDetail = {
        ...incomplete,
        id: 'pending-detail',
        error_summary: '没有抓到提示词；等待详情补全'
    };
    assert.deepEqual(
        _private.getRejectedImportCleanupIds([complete, incomplete, skipped, duplicate, pendingDetail]),
        ['incomplete-review', 'skipped', 'duplicate']
    );
});

test('collector recovery cleanup only removes unresolved detail placeholders', () => {
    const { _private } = require('../server/api-handlers/admin/prompts/imports');
    assert.deepEqual(_private.getPendingDetailCleanupIds([
        { id: 'pending', status: 'needs_review', error_summary: '没有抓到提示词；等待详情补全' },
        { id: 'manual-review', status: 'needs_review', error_summary: '缺少原作者昵称' },
        { id: 'failed-pending', status: 'failed', error_summary: '等待详情补全' },
        { id: 'ready', status: 'staged', error_summary: '' }
    ]), ['pending']);
});

test('admin prompt image base64 helper only accepts public image urls', () => {
    const { _private } = require('../server/api-handlers/admin/prompts/image-base64');

    assert.equal(_private.normalizeImageUrl('https://cdn.example.com/a.jpg'), 'https://cdn.example.com/a.jpg');
    assert.equal(_private.normalizeImageUrl('http://localhost:3000/a.jpg'), '');
    assert.equal(_private.normalizeImageUrl('http://127.0.0.1/a.jpg'), '');
    assert.equal(_private.normalizeImageUrl('file:///tmp/a.jpg'), '');
});

test('gallery import supports R2-backed video sources without requiring image media', () => {
    const { _private } = require('../server/api-handlers/admin/prompts/imports');
    const sourceUrl = 'https://images.meigen.ai/videos/2073446047326810304/video.mp4';
    const posterUrl = 'https://images.meigen.ai/videos/2073446047326810304/thumb.jpg';
    const normalized = _private.normalizeVideoSources([{
        url: sourceUrl,
        poster_url: posterUrl,
        width: 1080,
        height: 1920,
        mime_type: 'video/mp4'
    }]);
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].url, sourceUrl);
    assert.equal(normalized[0].poster_url, posterUrl);

    const payload = _private.buildPromptPayloadFromImportItem({
        prompt_text: 'A cinematic vertical fashion video.',
        original_work_url: 'https://x.com/example/status/2073446047326810304',
        author_name: 'Example',
        author_handle: '@example'
    }, {
        imageAssets: [],
        videoAssets: [{
            original: 'https://cdn.fatherkey.com/prompts/videos/example.mp4',
            poster: 'https://cdn.fatherkey.com/prompts/example.jpg'
        }]
    });
    assert.deepEqual(payload.images, []);
    assert.equal(payload.video_assets.length, 1);
});
