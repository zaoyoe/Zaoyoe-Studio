const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('prompts gallery renders as a top-aligned masonry grid with intrinsic-ratio cards', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsStyles = readRepoFile('prompts-poetry.css');
    const promptsHtml = readRepoFile('prompts.html');
    const mobileGridMediaStart = promptsStyles.indexOf('@media (max-width: 768px) {\n\n    .gallery-container');
    assert.notEqual(mobileGridMediaStart, -1, 'mobile gallery media block should exist');
    const mobileGridMediaBeforeOverlay = promptsStyles.slice(
        mobileGridMediaStart,
        promptsStyles.indexOf('    .card-overlay {', mobileGridMediaStart)
    );

    [
        "const PROMPT_GALLERY_MOBILE_MASONRY_QUERY = '(max-width: 768px)';",
        'const PROMPT_GALLERY_MASONRY_MIN_COLUMN_WIDTH_PX = 280;',
        'const PROMPT_GALLERY_MASONRY_MAX_COLUMN_COUNT = 5;',
        'const PROMPT_GALLERY_MASONRY_RESIZE_DEBOUNCE_MS = 520;',
        'const PROMPT_GALLERY_RESIZE_PRELOAD_IDLE_MS = 620;',
        'const PROMPT_GALLERY_RESIZE_LIGHT_MODE_MS = 680;',
        "const PROMPT_GALLERY_RESIZE_LIGHT_MODE_CLASS = 'prompt-gallery-resizing';",
        'const PROMPT_GALLERY_MOBILE_MASONRY_COLUMN_COUNT = 2;',
        'const PROMPT_GALLERY_MASONRY_CARD_LAYOUTS = [',
        'function getPromptGalleryMasonryColumnCount(grid = null) {',
        'function getPromptGalleryMasonrySignature(grid = null) {',
        'function createPromptGalleryMasonryState(grid) {',
        "index === 0",
        "prompt-gallery-column--left",
        "prompt-gallery-column--right",
        "prompt-gallery-column--middle",
        "prompt-gallery-column ${positionClass}",
        'function appendPromptGalleryCard(grid, card, index = 0, masonryState = null) {',
        'getPromptGalleryMasonryTargetColumnIndex(masonryState.columnHeights)',
        'function getPromptImageAssetAspectRatio(value) {',
        'function applyPromptCardNaturalImageAspectRatio(card, cardImage) {',
        'applyPromptCardImageAssetAspectRatio(card, primaryImageAsset);',
        'getPromptGalleryMasonryCardAspectWeight(card, index)',
        'function setPromptGalleryResizeLightMode() {',
        'document.documentElement.classList.add(PROMPT_GALLERY_RESIZE_LIGHT_MODE_CLASS);',
        'document.documentElement.classList.remove(PROMPT_GALLERY_RESIZE_LIGHT_MODE_CLASS);',
        'grid.classList.toggle(\'gallery-container--desktop-masonry\', !isMobileMasonry);',
        'renderCurrentPage({ preserveScroll: true });',
        'bindPromptGalleryMasonryWatcher();'
    ].forEach((marker) => {
        assert.equal(promptsSource.includes(marker), true, `prompts-poetry.js should include ${marker}`);
    });

    assert.match(
        promptsStyles,
        /\.gallery-container\s*\{[\s\S]*?padding:\s*10px 10px 10vh;[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*flex-start;[\s\S]*?gap:\s*10px;[\s\S]*?contain:\s*layout paint;/,
        'desktop prompt gallery should use a compact top-aligned masonry flex container with isolated layout work'
    );
    assert.match(
        promptsStyles,
        /\.prompt-gallery-column\s*\{[\s\S]*?flex-direction:\s*column;[\s\S]*?gap:\s*10px;/,
        'desktop prompt gallery columns should stack cards independently with narrow-window spacing'
    );
    assert.match(
        promptsStyles,
        /\.gallery-container--masonry \.prompt-card\s*\{[\s\S]*?aspect-ratio:\s*var\(--prompt-card-masonry-aspect-ratio,\s*var\(--prompt-card-masonry-fallback-aspect-ratio,\s*1\)\);/,
        'masonry cards should use the real image aspect ratio when available'
    );
    assert.match(
        promptsStyles,
        /\.gallery-container--masonry \.prompt-card\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?border-color:\s*transparent;[\s\S]*?box-shadow:\s*none;[\s\S]*?content-visibility:\s*auto;[\s\S]*?contain-intrinsic-size:\s*320px 420px;/,
        'masonry cards should not draw a second background border and should skip offscreen layout work'
    );
    assert.match(
        promptsStyles,
        /html\.prompt-gallery-resizing body\.prompts-page \.gallery-container--masonry\s*\{[\s\S]*?pointer-events:\s*none;/,
        'masonry gallery should avoid hover work while the desktop window is being resized'
    );
    assert.match(
        promptsStyles,
        /html\.prompt-gallery-resizing body\.prompts-page \.gallery-container--masonry \.prompt-card\.breathing\s*\{[\s\S]*?animation-play-state:\s*paused !important;[\s\S]*?will-change:\s*auto;/,
        'masonry breathing animation should pause only during active resize'
    );
    assert.match(
        promptsStyles,
        /\.prompt-card\s*\{[\s\S]*?transition:\s*[\s\S]*?transform 0\.4s[\s\S]*?box-shadow 0\.4s[\s\S]*?border-color 0\.4s[\s\S]*?background-color 0\.4s ease;/,
        'prompt cards should not transition every property during resize-sensitive masonry layouts'
    );
    assert.match(
        promptsStyles,
        /\.gallery-container--masonry \.card-image\s*\{[\s\S]*?object-fit:\s*cover;[\s\S]*?background:\s*transparent;/,
        'masonry images should fill the column-width card while the card keeps the real image ratio'
    );
    assert.match(
        promptsStyles,
        /@media \(hover:\s*hover\) and \(pointer:\s*fine\)\s*\{[\s\S]*?\.gallery-container--masonry \.prompt-card:hover\s*\{[\s\S]*?border-color:\s*transparent;[\s\S]*?box-shadow:\s*none;/,
        'masonry hover should not reintroduce a container border or shadow behind images'
    );
    assert.match(
        promptsStyles,
        /@media \(hover:\s*hover\) and \(pointer:\s*fine\)\s*\{[\s\S]*?\.gallery-container--masonry \.prompt-card:hover \.card-image\s*\{[\s\S]*?transform:\s*none;/,
        'desktop hover should keep the full masonry image visible'
    );
    assert.match(
        promptsStyles,
        /@media \(max-width:\s*768px\)\s*\{[\s\S]*?\.gallery-container\s*\{[\s\S]*?padding:\s*24px 0 calc\(40px \+ env\(safe-area-inset-bottom\)\);[\s\S]*?gap:\s*10px;/,
        'mobile prompt gallery should fill both horizontal edges without side padding'
    );
    assert.match(
        promptsStyles,
        /@media \(max-width:\s*768px\)\s*\{[\s\S]*?\.prompt-gallery-column\s*\{[\s\S]*?flex-direction:\s*column;[\s\S]*?gap:\s*10px;/,
        'mobile prompt gallery columns should stack cards independently'
    );
    assert.match(
        promptsStyles,
        /@media \(max-width:\s*768px\)\s*\{[\s\S]*?\.featured-banner\s*\{[\s\S]*?display:\s*none !important;[\s\S]*?height:\s*0;[\s\S]*?margin:\s*0;[\s\S]*?padding:\s*0;/,
        'narrow prompt gallery should remove the featured recommendation banner without leaving vertical space'
    );
    assert.match(
        promptsStyles,
        /\.prompt-gallery-column--right\s*\{[\s\S]*?padding-top:\s*0;/,
        'masonry columns should align at the top'
    );
    assert.equal(
        mobileGridMediaBeforeOverlay.includes('.gallery-container--mobile-masonry .card-overlay'),
        false,
        'narrow desktop windows should not lose the hover author/action overlay'
    );
    assert.match(
        promptsStyles,
        /@media \(max-width:\s*768px\) and \(hover:\s*none\),\s*\(max-width:\s*768px\) and \(pointer:\s*coarse\)\s*\{[\s\S]*?\.gallery-container--mobile-masonry \.card-overlay\s*\{[\s\S]*?padding:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?opacity:\s*1;/,
        'touch mobile masonry cards should not show the dark author/action overlay'
    );
    assert.match(
        promptsStyles,
        /@media \(max-width:\s*768px\) and \(hover:\s*none\),\s*\(max-width:\s*768px\) and \(pointer:\s*coarse\)\s*\{[\s\S]*?\.gallery-container--mobile-masonry \.card-overlay-bottom\s*\{[\s\S]*?display:\s*none;/,
        'touch mobile masonry cards should hide author name, handle, X link, favorite icon, and favorite count'
    );
    assert.match(
        promptsStyles,
        /@media \(max-width:\s*768px\) and \(hover:\s*none\),\s*\(max-width:\s*768px\) and \(pointer:\s*coarse\)\s*\{[\s\S]*?\.gallery-container--mobile-masonry \.card-indicators\s*\{[\s\S]*?bottom:\s*12px;[\s\S]*?gap:\s*7px;/,
        'touch mobile masonry cards should keep only the multi-image indicator dots'
    );

    [
        '.gallery-container--masonry .prompt-card--mobile-hero',
        '.gallery-container--masonry .prompt-card--mobile-wide',
        '.gallery-container--masonry .prompt-card--mobile-portrait',
        '.gallery-container--masonry .prompt-card--mobile-square'
    ].forEach((marker) => {
        assert.equal(promptsStyles.includes(marker), true, `prompts-poetry.css should include ${marker}`);
    });
    const mobileHeroFallbackBlock = promptsStyles.match(/\.gallery-container--masonry \.prompt-card--mobile-hero\s*\{([\s\S]*?)\}/)?.[1] || '';
    assert.equal(
        /(^|\n)\s*aspect-ratio\s*:/.test(mobileHeroFallbackBlock),
        false,
        'masonry fallback classes should not hard-crop cards to fixed ratios'
    );

    assert.equal(
        (promptsHtml.match(/galleryMasonry=20260709_PROMPTS_GALLERY_MASONRY_DENSE_GAP_1/g) || []).length,
        2,
        'prompts.html should cache-bust both masonry CSS and runtime changes'
    );
});
