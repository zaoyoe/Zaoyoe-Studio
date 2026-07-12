const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('prompts gallery uses progressive fixed-batch loading instead of synchronous scroll rendering', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsHtml = readRepoFile('prompts.html');

    [
        'const PROMPT_GALLERY_SCROLL_PRELOAD_COUNT = 8;',
        'const PROMPT_GALLERY_RENDER_CHUNK_SIZE = 2;',
        'const PROMPT_GALLERY_DESKTOP_PREFETCH_ROWS = 2;',
        'const PROMPT_GALLERY_SCROLL_IDLE_MS = 180;',
        'const PROMPT_GALLERY_BOTTOM_LOAD_MARGIN_PX = 900;',
        'const PROMPT_GALLERY_SENTINEL_PREFETCH_MARGIN_PX = 1600;',
        'let promptGalleryRenderedCount = 0;',
        'let promptGalleryLastScrollDirection = \'down\';',
        'function createPromptGalleryCard(item, itemIndex = 0, batchIndex = 0) {',
        'card.dataset.galleryIndex = String(itemIndex);',
        'function renderPromptGalleryRange(startIndex = 0, endIndex = 0, options = {}) {',
        'function ensurePromptGalleryRenderedThrough(targetIndex = 0, options = {}) {',
        'function getPromptGalleryVisibleRange() {',
        'function preloadPromptGalleryAroundVisibleRange(direction = promptGalleryLastScrollDirection) {',
        'const preloadStart = visibleRange.maxIndex + 1;',
        'const preloadEnd = Math.min(allFilteredItems.length, preloadStart + preloadCount);',
        'return queuePromptGalleryRenderThrough(preloadEnd - 1);',
        'const startIndex = Math.max(0, visibleRange.minIndex - preloadCount);',
        'return preloadPromptGalleryItems(startIndex, visibleRange.minIndex);',
        'function isPromptGalleryNearDocumentBottom() {',
        "if (direction !== 'up' && isPromptGalleryNearDocumentBottom()) {",
        'return queuePromptGalleryNextScrollBatch();',
        'function queuePromptGalleryRenderThrough(targetIndex = 0) {',
        'promptGalleryRenderedCount + PROMPT_GALLERY_RENDER_CHUNK_SIZE',
        'warmImages: false',
        'function queuePromptGalleryNextScrollBatch() {',
        'function getPromptGalleryProgressiveBatchSize() {',
        'columnCount * PROMPT_GALLERY_DESKTOP_PREFETCH_ROWS',
        'function setupPromptGalleryLoadSentinel() {',
        'promptGalleryLoadSentinelObserver = new IntersectionObserver((entries) => {',
        'queuePromptGalleryNextScrollBatch();',
        'setupPromptGalleryLoadSentinel();',
        'function schedulePromptGalleryScrollIdlePreload(delayMs = PROMPT_GALLERY_SCROLL_IDLE_MS) {',
        'window.setTimeout(() => {',
        "document.documentElement.classList.remove('prompt-gallery-scrolling');",
        'preloadPromptGalleryAroundVisibleRange(promptGalleryLastScrollDirection);',
        'function schedulePromptGalleryResizeIdlePreload() {',
        'schedulePromptGalleryScrollIdlePreload(PROMPT_GALLERY_RESIZE_PRELOAD_IDLE_MS);',
        'function handlePromptGalleryScroll() {',
        "promptGalleryLastScrollDirection = deltaY > 0 ? 'down' : 'up';",
        "document.documentElement.classList.add('prompt-gallery-scrolling');",
        'function handlePromptGalleryTouchMove(event) {',
        "document.addEventListener('touchstart', handlePromptGalleryTouchStart, { passive: true });",
        "document.addEventListener('touchmove', handlePromptGalleryTouchMove, { passive: true });",
        "window.addEventListener('scroll', handlePromptGalleryScroll, { passive: true });",
        "window.visualViewport?.addEventListener('scroll', schedulePromptGalleryScrollIdlePreload, { passive: true });",
        "window.addEventListener('resize', schedulePromptGalleryResizeIdlePreload, { passive: true });",
        "window.visualViewport?.addEventListener('resize', schedulePromptGalleryResizeIdlePreload, { passive: true });",
        "document.addEventListener('touchend', schedulePromptGalleryScrollIdlePreload, { passive: true });"
    ].forEach((marker) => {
        assert.equal(promptsSource.includes(marker), true, `prompts-poetry.js should include ${marker}`);
    });

    assert.equal(
        promptsSource.includes('function renderPaginationControls('),
        false,
        'prompt gallery should not create pagination controls'
    );
    assert.equal(
        promptsSource.includes('let currentPage ='),
        false,
        'prompt gallery should not keep page-number state'
    );
    [
        'function getPromptGalleryScrollLoadCount(',
        'function queuePromptGalleryScrollLoad(',
        'PROMPT_GALLERY_SCROLL_LOAD_MAX_COUNT',
        'PROMPT_GALLERY_SCROLL_VELOCITY_MULTIPLIER'
    ].forEach((marker) => {
        assert.equal(
            promptsSource.includes(marker),
            false,
            `prompt scroll handlers should not include ${marker}`
        );
    });
    assert.equal(
        promptsHtml.includes('pagination.css'),
        false,
        'prompts.html should not load the prompt pagination stylesheet'
    );
    assert.equal(
        promptsHtml.includes('infiniteScroll=20260709_PROMPTS_INFINITE_SCROLL_VELOCITY_1'),
        true,
        'prompts.html should cache-bust the infinite scroll runtime change'
    );
    assert.equal(
        (promptsHtml.match(/scrollPerf=20260712_PROMPTS_SCROLL_PERF_1/g) || []).length,
        2,
        'prompts.html should cache-bust both optimized gallery styles and runtime'
    );
    assert.match(
        promptsSource,
        /const visibleRange = getPromptGalleryVisibleRange\(\);[\s\S]*?if \(!visibleRange\) \{[\s\S]*?direction === 'up'[\s\S]*?: queuePromptGalleryNextScrollBatch\(\);/,
        'an empty viewport at the document bottom should append from the current rendered count'
    );
    assert.equal(
        promptsSource.includes('ensurePromptGalleryRenderedThrough(getPromptGalleryBatchSize() + PROMPT_GALLERY_SCROLL_PRELOAD_COUNT - 1)'),
        false,
        'empty-viewport fallback should not stop forever at the initial batch boundary'
    );
    assert.equal(
        promptsHtml.includes('bottomSentinel=20260712_PROMPTS_PROGRESSIVE_SENTINEL_2'),
        true,
        'prompts should cache-bust the progressive bottom-sentinel loader'
    );
    assert.equal(
        promptsHtml.includes('id="promptGalleryLoadSentinel"'),
        true,
        'prompts should render a dedicated gallery loading sentinel'
    );
    assert.equal(
        promptsSource.includes('promptGalleryBottomLoadRequested'),
        false,
        'sentinel loading should not wait for a scroll-idle request flag'
    );
    assert.equal(
        promptsHtml.includes('desktopBalance=20260712_PROMPTS_DESKTOP_REAL_HEIGHT_1'),
        true,
        'prompts should cache-bust the real-height desktop balancing change'
    );
});

test('desktop masonry corrects estimated heights before placing progressive cards', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');

    [
        'let promptGalleryMasonryHeightSyncFrameId = null;',
        'function syncPromptGalleryMasonryColumnHeights(masonryState = promptGalleryMasonryState) {',
        'return Math.max(0, column.scrollHeight || 0) / columnWidth;',
        'function schedulePromptGalleryMasonryHeightSync() {',
        'schedulePromptGalleryMasonryHeightSync();',
        'syncPromptGalleryMasonryColumnHeights(promptGalleryMasonryState);',
        'gapWeight: PROMPT_GALLERY_MASONRY_CARD_GAP_WEIGHT',
        '(masonryState.gapWeight || PROMPT_GALLERY_MASONRY_CARD_GAP_WEIGHT)'
    ].forEach((marker) => {
        assert.equal(promptsSource.includes(marker), true, `prompts-poetry.js should include ${marker}`);
    });
});

test('prompts gallery limits breathing animation to cards near the viewport', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsStyles = readRepoFile('prompts-poetry.css');

    [
        'let promptGalleryCardMotionObserver = null;',
        'function disconnectPromptGalleryCardMotionObserver() {',
        'function getPromptGalleryCardMotionObserver() {',
        'promptGalleryCardMotionObserver = new IntersectionObserver((entries) => {',
        "entry.target.classList.toggle('prompt-card--in-viewport', isNearViewport);",
        "entry.target.classList.toggle('breathing', isNearViewport && !reduceMotion);",
        "rootMargin: '120px 0px'",
        'function activatePromptGalleryCardMotion(card) {',
        'disconnectPromptGalleryCardMotionObserver();'
    ].forEach((marker) => {
        assert.equal(promptsSource.includes(marker), true, `prompts-poetry.js should include ${marker}`);
    });

    assert.match(
        promptsStyles,
        /html\.prompt-gallery-scrolling body\.prompts-page \.gallery-container--masonry \.prompt-card\.breathing\s*\{[\s\S]*?animation-play-state:\s*paused !important;[\s\S]*?will-change:\s*auto;/,
        'visible card motion should pause while the page is actively scrolling'
    );
});
