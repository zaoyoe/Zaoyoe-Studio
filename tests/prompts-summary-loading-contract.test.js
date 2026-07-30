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

test('prompts gallery first paint uses summary data and lazy prompt details', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const summarySource = readRepoFile('js/prompts-summary-data.js');
    const promptDataSource = readRepoFile('prompts-data.js');
    const promptsHtml = readRepoFile('prompts.html');

    assert.equal(
        promptsSource.includes('STATIC_PROMPTS_SUMMARY_SRC'),
        false,
        'prompts runtime should not load static summary snapshots as gallery fallback data'
    );
    assert.equal(
        promptsSource.includes('loadStaticPromptFallbackData'),
        false,
        'prompts runtime should not hydrate the gallery from stale static prompt snapshots'
    );
    assert.equal(
        promptsSource.includes('keeping prompt gallery loading instead of showing static snapshots'),
        true,
        'slow Supabase loads should keep skeletons instead of showing deleted static cards'
    );
    assert.equal(
        promptsSource.includes("const STATIC_PROMPTS_DETAIL_SRC = 'prompts-data.js?v=20260302_G_AUTH';"),
        true,
        'prompts runtime should keep full static prompt data for detail fallback only'
    );
    assert.equal(
        promptsSource.includes('buildPromptSupabaseSummaryQuery(PROMPTS_SUPABASE_SUMMARY_SELECT'),
        true,
        'Supabase first-paint query should request only summary fields'
    );
    const summarySelectBlock = promptsSource.match(/const PROMPTS_SUPABASE_SUMMARY_SELECT = \[([\s\S]*?)\]\.join\(','\);/)?.[1] || '';
    ['description', 'description_en', 'description_zh', 'image_palettes', 'ai_tags'].forEach((field) => {
        assert.equal(
            summarySelectBlock.includes(`'${field}'`),
            false,
            `Supabase first-paint summary should defer ${field} until detail load`
        );
    });
    ['id', 'title', 'tags', 'images', 'image_assets', 'video_assets', 'gallery_status', 'created_at'].forEach((field) => {
        assert.equal(
            summarySelectBlock.includes(`'${field}'`),
            true,
            `Supabase first-paint summary should keep card field ${field}`
        );
    });
    assert.equal(
        /PROMPTS_SUPABASE_SUMMARY_LEGACY_SELECT[\s\S]*?\['image_assets', 'video_assets', 'gallery_status'\][\s\S]*?'ai_tags'/.test(promptsSource),
        true,
        'legacy summary fallback should preserve draft filtering until gallery_status exists'
    );
    assert.equal(
        promptsSource.includes('const PROMPT_SUPABASE_PAGE_SIZE = 40;')
            && promptsSource.includes('.limit(PROMPT_SUPABASE_PAGE_SIZE);'),
        true,
        'first paint should use a bounded database page instead of loading the full prompt table'
    );
    assert.equal(
        promptsSource.includes("createdAt: item.created_at || ''"),
        true,
        'Supabase summary prompts should keep created_at for stable first-render sorting'
    );
    assert.equal(
        promptsSource.includes(".select(PROMPTS_SUPABASE_DETAIL_SELECT)"),
        true,
        'prompt modal should fetch full details only on demand'
    );
    assert.equal(
        promptsSource.includes("getOptimizedImageUrl(imageAsset, { variant: 'featured' })") &&
            promptsSource.includes("getOptimizedImageUrl(imageAsset, { variant: 'thumb' })"),
        true,
        'featured banner should prefer the banner-sized image variant on first paint'
    );
    assert.equal(
        promptsSource.includes('function setFeaturedBannerImageSource(image, imageAsset)'),
        true,
        'featured banner should install an image fallback chain'
    );
    assert.equal(
        promptsSource.includes('const PROMPT_FEATURED_FIRST_IMAGE_TIMEOUT_MS = 240;'),
        true,
        'featured image priority wait should be a short head start, not a long gallery blocker'
    );
    assert.equal(
        promptsSource.includes('const featuredFirstPaintPromise = renderFeaturedBanner({ waitForFirstImage: true });'),
        true,
        'featured banner should get first image priority before the gallery renders'
    );
    assert.equal(
        promptsSource.includes('void loadGalleryConfig().then'),
        false,
        'gallery config should not trigger a second post-render thumbnail reorder'
    );
    assert.equal(
        promptsSource.includes('const rawId = item?.supabaseId || item?.id;'),
        true,
        'gallery sorting should not rely on temporary render ids after Supabase data loads'
    );
    assert.equal(
        promptsSource.includes('function loadGalleryConfigForFirstRender()'),
        true,
        'first render should use a bounded gallery config read'
    );
    assert.equal(
        promptsSource.includes('const PROMPT_GALLERY_CONFIG_FIRST_RENDER_TIMEOUT_MS = 320;'),
        true,
        'gallery config should not block first thumbnails on a slow settings request'
    );
    assert.equal(
        promptsSource.includes('cancellationToken.cancelled = true;'),
        true,
        'late gallery config responses should not mutate prompt order after first render'
    );
    assert.equal(
        promptsSource.includes('await galleryConfigPromise;\\n    renderGallery(initialFilter);') ||
            promptsSource.includes('await galleryConfigPromise;\n    renderGallery(initialFilter);'),
        true,
        'gallery config should settle before the first gallery render'
    );
    assert.equal(
        promptsSource.includes('if (Array.isArray(available)) {') &&
            promptsSource.includes('return \'\';') &&
            promptsSource.includes('function hasPromptResponsiveVariantManifest()'),
        true,
        'new prompt images should not waste first paint on guessed missing CDN variants'
    );
    assert.equal(
        promptsSource.includes("image.dataset.featuredFallbackIndex = '0';"),
        true,
        'featured banner should track failed image variants before falling back'
    );
    assert.equal(
        promptsSource.includes("script.src = 'starry-sky.js?v=20260729_AI_WORKBENCH_SCROLL_PERF_1';"),
        true,
        'starry sky animation should be lazy-loaded after the prompts first paint path'
    );
    assert.equal(
        promptsSource.includes('function bindPromptThemeStarryLoader()'),
        true,
        'prompts should bind a theme-change starry loader for shared auth dropdown theme toggles'
    );
    assert.equal(
        promptsSource.includes("window.addEventListener('zaoyoe:themechange', loadPromptStarrySkyRuntimeForTheme);"),
        true,
        'prompts should load starry sky when the shared theme toggle switches into dark mode'
    );
    assert.equal(
        promptsSource.includes("schedulePromptIdleTask('comment-count-prefetch'"),
        true,
        'comment count prefetch should be scheduled as a late idle task'
    );
    assert.equal(
        promptsSource.includes('function loadAnnouncement() {'),
        false,
        'prompts runtime should not keep the old embedded announcement loader'
    );
    assert.equal(
        promptsSource.includes('const ParticleSystem = {'),
        false,
        'prompts runtime should not parse the old announcement particle engine on first paint'
    );
    assert.equal(
        promptsHtml.includes('starry-sky.js?v=20260302_G_AUTH'),
        false,
        'prompts.html should not eagerly load the starry sky animation'
    );
    assert.equal(
        promptsHtml.includes('data-load-announcement="1"'),
        true,
        'prompts.html should defer announcements through the shared engagement loader'
    );
    assert.equal(
        promptsHtml.includes('id="announcementBanner"'),
        false,
        'prompts.html should not keep the old static announcement banner shell'
    );
    assert.equal(
        promptsHtml.includes('id="announcementCloseBtn"'),
        false,
        'prompts.html should not keep the old unbound announcement close button'
    );
    assert.equal(
        promptsHtml.includes('prompts-poetry.js?v=20260507_REPLY_REALTIME_1&promptLangSignal=20260503_PROMPT_LANG_SIGNAL_1'),
        true,
        'prompts.html should cache-bust the split-data runtime'
    );

    assert.equal(
        summarySource.includes('window.__PROMPTS_SUMMARY__ = prompts;'),
        true,
        'summary data should expose the lightweight prompt summary array'
    );
    assert.equal(
        summarySource.includes('window.PROMPTS = prompts'),
        false,
        'summary data should not seed the live prompt gallery with stale snapshots'
    );
    assert.equal(
        promptDataSource.includes('window.PROMPTS = window.__STATIC_PROMPTS__'),
        false,
        'detail fallback data should not seed the live prompt gallery with stale snapshots'
    );
    assert.equal(
        summarySource.includes('"prompt":'),
        false,
        'summary data should not include full prompt bodies'
    );
    assert.equal(
        summarySource.includes('prompt_text'),
        false,
        'summary data should not include prompt text fields'
    );
});

test('prompts gallery folds CDN variant urls into one visible image per original', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const script = [
        "const PROMPT_IMAGE_ASSET_KEYS = Object.freeze(['original', 'thumb', 'featured', 'card', 'home']);",
        "const PROMPT_IMAGE_CDN_VARIANT_PATHS = new Set(['thumb', 'featured', 'card', 'home']);",
        extractFunction(promptsSource, 'getPromptImageCdnVariantInfo'),
        extractFunction(promptsSource, 'getPromptImageCanonicalOriginalUrl'),
        extractFunction(promptsSource, 'getPromptImageCanonicalDedupeKey'),
        extractFunction(promptsSource, 'assignPromptImageAssetUrl'),
        extractFunction(promptsSource, 'getPromptImageAssetPositiveNumber'),
        extractFunction(promptsSource, 'assignPromptImageAssetDimensions'),
        extractFunction(promptsSource, 'normalizePromptImageAsset'),
        extractFunction(promptsSource, 'getPromptImageAssetOriginalUrl'),
        extractFunction(promptsSource, 'normalizePromptImageAssetsFromRecord'),
        extractFunction(promptsSource, 'normalizePromptImagePalettesFromRecord'),
        extractFunction(promptsSource, 'normalizeSupabasePromptSummary'),
        'globalThis.__promptImageExports = { normalizeSupabasePromptSummary, normalizePromptImageAssetsFromRecord };'
    ].join('\n\n');

    const context = {
        URL,
        window: {
            location: { origin: 'https://www.fatherkey.com' }
        },
        globalThis: null
    };

    context.globalThis = context;
    vm.runInNewContext(script, context);

    const row = {
        id: 'prompt-variant-fold',
        title: 'Variant Fold',
        tags: ['Photography'],
        image_assets: [
            {
                original: 'https://cdn.fatherkey.com/prompts/a.webp',
                card: 'https://cdn.fatherkey.com/prompts/card/a.webp'
            }
        ],
        images: [
            'https://cdn.fatherkey.com/prompts/a.webp',
            'https://cdn.fatherkey.com/prompts/thumb/a.webp',
            'https://cdn.fatherkey.com/prompts/featured/b.webp',
            'https://cdn.fatherkey.com/prompts/b.webp'
        ]
    };

    const summary = context.__promptImageExports.normalizeSupabasePromptSummary(row, 0);
    assert.deepEqual(
        JSON.parse(JSON.stringify(summary.images)),
        [
            'https://cdn.fatherkey.com/prompts/a.webp',
            'https://cdn.fatherkey.com/prompts/b.webp'
        ],
        'summary images should not double-count CDN thumbnail/card/featured variants'
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(summary.image_assets)),
        [
            {
                original: 'https://cdn.fatherkey.com/prompts/a.webp',
                card: 'https://cdn.fatherkey.com/prompts/card/a.webp',
                thumb: 'https://cdn.fatherkey.com/prompts/thumb/a.webp'
            },
            {
                featured: 'https://cdn.fatherkey.com/prompts/featured/b.webp',
                original: 'https://cdn.fatherkey.com/prompts/b.webp'
            }
        ],
        'summary image assets should retain variant urls under a single canonical original'
    );
});
