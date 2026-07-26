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
    assert.doesNotMatch(
        runtime,
        /if \(!allCardsRendered && isPromptGalleryLoadSentinelNearViewport\(\)\)/,
        'one sentinel trigger should not recursively append every nearby batch'
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
