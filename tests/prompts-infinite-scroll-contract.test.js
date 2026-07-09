const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('prompts gallery uses scroll-idle infinite loading instead of pagination controls', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsHtml = readRepoFile('prompts.html');

    [
        'const PROMPT_GALLERY_SCROLL_PRELOAD_COUNT = 12;',
        'const PROMPT_GALLERY_SCROLL_IDLE_MS = 160;',
        'const PROMPT_GALLERY_BOTTOM_LOAD_MARGIN_PX = 900;',
        'const PROMPT_GALLERY_SCROLL_LOAD_MAX_COUNT = 72;',
        'const PROMPT_GALLERY_SCROLL_DISTANCE_PER_CARD_PX = 260;',
        'const PROMPT_GALLERY_SCROLL_VELOCITY_MULTIPLIER = 10;',
        'let promptGalleryRenderedCount = 0;',
        'let promptGalleryLastScrollDirection = \'down\';',
        'let promptGalleryPendingScrollLoadCount = 0;',
        'function createPromptGalleryCard(item, itemIndex = 0, batchIndex = 0) {',
        'card.dataset.galleryIndex = String(itemIndex);',
        'function renderPromptGalleryRange(startIndex = 0, endIndex = 0, options = {}) {',
        'function ensurePromptGalleryRenderedThrough(targetIndex = 0, options = {}) {',
        'function getPromptGalleryVisibleRange() {',
        'function preloadPromptGalleryAroundVisibleRange(direction = promptGalleryLastScrollDirection) {',
        'const preloadStart = visibleRange.maxIndex + 1;',
        'const preloadEnd = Math.min(allFilteredItems.length, preloadStart + PROMPT_GALLERY_SCROLL_PRELOAD_COUNT);',
        'return ensurePromptGalleryRenderedThrough(preloadEnd - 1);',
        'const startIndex = Math.max(0, visibleRange.minIndex - PROMPT_GALLERY_SCROLL_PRELOAD_COUNT);',
        'return preloadPromptGalleryItems(startIndex, visibleRange.minIndex);',
        'function isPromptGalleryNearDocumentBottom() {',
        "if (direction !== 'up' && isPromptGalleryNearDocumentBottom()) {",
        'return ensurePromptGalleryNextScrollBatch();',
        'function ensurePromptGalleryNextScrollBatch(options = {}) {',
        'promptGalleryRenderedCount + PROMPT_GALLERY_SCROLL_PRELOAD_COUNT - 1',
        'function getPromptGalleryScrollLoadCount(deltaPx = 0, deltaMs = 16) {',
        'const velocityPxPerMs = safeDeltaPx / safeDeltaMs;',
        'const distanceBonus = Math.floor(safeDeltaPx / PROMPT_GALLERY_SCROLL_DISTANCE_PER_CARD_PX);',
        'const velocityBonus = Math.floor(velocityPxPerMs * PROMPT_GALLERY_SCROLL_VELOCITY_MULTIPLIER);',
        'function queuePromptGalleryScrollLoad(loadCount = PROMPT_GALLERY_SCROLL_PRELOAD_COUNT) {',
        'promptGalleryPendingScrollLoadCount = Math.max(promptGalleryPendingScrollLoadCount, safeLoadCount);',
        'promptGalleryScrollLoadFrameId = requestAnimationFrame(() => {',
        'promptGalleryRenderedCount + nextLoadCount - 1',
        'function schedulePromptGalleryScrollIdlePreload(delayMs = PROMPT_GALLERY_SCROLL_IDLE_MS) {',
        'window.setTimeout(() => {',
        'preloadPromptGalleryAroundVisibleRange(promptGalleryLastScrollDirection);',
        'function schedulePromptGalleryResizeIdlePreload() {',
        'schedulePromptGalleryScrollIdlePreload(PROMPT_GALLERY_RESIZE_PRELOAD_IDLE_MS);',
        'function handlePromptGalleryScroll() {',
        "promptGalleryLastScrollDirection = deltaY > 0 ? 'down' : 'up';",
        'const scrollLoadCount = getPromptGalleryScrollLoadCount(deltaY, deltaMs);',
        'queuePromptGalleryScrollLoad(scrollLoadCount);',
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
});
