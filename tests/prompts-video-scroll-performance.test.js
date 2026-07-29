const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('video gallery defers media work without removing card motion', () => {
    const runtime = read('prompts-poetry.js');
    const styles = read('prompts-poetry.css');
    const html = read('prompts.html');

    [
        'const PROMPT_GALLERY_INITIAL_RENDER_MAX_COUNT = 20;',
        'const PROMPT_GALLERY_IMAGE_ACTIVATION_MARGIN_PX = 360;',
        'const PROMPT_GALLERY_IMAGE_ACTIVATION_CHUNK_SIZE = 2;',
        'const PROMPT_GALLERY_IMAGE_ACTIVATION_INTERVAL_MS = 80;',
        'function getPromptGalleryInitialRenderCount() {',
        'function observePromptGalleryCardImage(cardImage, imageAsset) {',
        'function activatePromptGalleryCardImage(cardImage) {',
        'function queuePromptGalleryPendingImageActivations() {',
        'rootMargin: `${PROMPT_GALLERY_IMAGE_ACTIVATION_MARGIN_PX}px 0px`',
        'disconnectPromptGalleryCardImageObserver();',
        "document.documentElement.classList.contains('prompt-gallery-scrolling')",
        'queuePromptGalleryPendingImageActivations();',
        'queuePromptGalleryRenderThrough(promptGalleryQueuedRenderTarget - 1);'
    ].forEach((marker) => {
        assert.equal(runtime.includes(marker), true, `prompts-poetry.js should include ${marker}`);
    });

    assert.match(
        runtime,
        /if \(shouldLoadImageEagerly\) \{\s*setPromptCardImageSource\(cardImage, primaryImageAsset\);\s*\} else \{\s*observePromptGalleryCardImage\(cardImage, primaryImageAsset\);/,
        'only eager cards should receive an immediate image source'
    );
    assert.match(
        runtime,
        /Math\.max\(getPromptGalleryInitialRenderCount\(\), requestedCount, preserveScroll \? previousRenderedCount : 0\)/,
        'initial rendering should remain bounded even when remote items_per_page is large'
    );
    assert.match(
        runtime,
        /shouldContinueSentinelFill[\s\S]*?!allCardsRendered[\s\S]*?isPromptGalleryLoadSentinelNearViewport\(\)[\s\S]*?queuePromptGalleryNextScrollBatch\(\{ continueWhileSentinelNear: true \}\);/,
        'one sentinel trigger should keep filling bounded batches until new content moves it past the prefetch margin'
    );
    assert.match(
        runtime,
        /classList\.contains\('prompt-gallery-scrolling'\)\s*&& !promptGallerySentinelFillRequested/,
        'only the sentinel refill may append lightweight card DOM while scrolling'
    );
    assert.doesNotMatch(
        runtime,
        /renderPromptGalleryRange\([^;]+allFilteredItems\.length/,
        'sentinel refill should never synchronously render the full filtered collection'
    );
    assert.match(
        styles,
        /\.prompt-card-video-badge\s*\{[\s\S]*?backdrop-filter:\s*none;[\s\S]*?-webkit-backdrop-filter:\s*none;/,
        'video badges should not create a backdrop-filter layer per visible card'
    );

    assert.match(styles, /\.prompt-card\.breathing\s*\{[\s\S]*?animation:\s*breathe 4s ease-in-out infinite;/);
    assert.match(styles, /\.prompt-card\.card-visible\s*\{[\s\S]*?transform:\s*translateY\(0\);/);
    assert.equal((html.match(/videoScrollPerf=20260726_PROMPT_VIDEO_SCROLL_PERF_1/g) || []).length, 2);
});

test('prompt and shop cards share the same compact breathe height', () => {
    const promptsStyles = read('prompts-poetry.css');
    const shopStyles = read('css/shop-page.css');
    const promptsHtml = read('prompts.html');
    const adminHtml = read('admin-studio.html');
    const compactBreathe = /@keyframes breathe\s*\{[\s\S]*?0%,\s*100%\s*\{[\s\S]*?translateY\(0px\);[\s\S]*?50%\s*\{[\s\S]*?translateY\(-3px\);/;

    assert.match(promptsStyles, compactBreathe);
    assert.match(shopStyles, compactBreathe);
    assert.equal(promptsHtml.includes('cardBreathe=20260729_PROMPT_CARD_BREATHE_AMPLITUDE_1'), true);
    assert.equal(adminHtml.includes('cardBreathe=20260729_PROMPT_CARD_BREATHE_AMPLITUDE_1'), true);
});
