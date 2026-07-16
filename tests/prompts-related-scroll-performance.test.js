const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function getFunctionBlock(source, functionName) {
    const start = source.indexOf(`function ${functionName}(`);
    assert.notEqual(start, -1, `${functionName} should be declared`);
    const end = source.indexOf('\nfunction ', start + 1);
    assert.notEqual(end, -1, `${functionName} should be followed by another function`);
    return source.slice(start, end);
}

function getStyleBlock(source, selector) {
    const start = source.indexOf(`${selector} {`);
    assert.notEqual(start, -1, `${selector} should be declared`);
    const end = source.indexOf('\n}', start);
    assert.notEqual(end, -1, `${selector} should have a closing brace`);
    return source.slice(start, end + 2);
}

test('same-style cards defer offscreen image decoding and isolate scroll painting', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsStyles = readRepoFile('prompts-poetry.css');
    const promptsHtml = readRepoFile('prompts.html');
    const cardMarkupBlock = getFunctionBlock(promptsSource, 'buildRelatedPromptCardMarkup');
    const observerBlock = getFunctionBlock(promptsSource, 'observeDeferredRelatedPromptImages');
    const warmupBlock = getFunctionBlock(promptsSource, 'warmRelatedPromptImages');
    const gridStyleBlock = getStyleBlock(promptsStyles, '.related-prompt-grid');
    const cardStyleBlock = getStyleBlock(promptsStyles, '.related-prompt-card');

    assert.equal(promptsSource.includes('const RELATED_PROMPT_INITIAL_IMAGE_COUNT = 4;'), true);
    assert.match(cardMarkupBlock, /index < RELATED_PROMPT_INITIAL_IMAGE_COUNT/);
    assert.match(cardMarkupBlock, /data-related-image-src=/);
    assert.match(cardMarkupBlock, /fetchpriority="low"/);
    assert.match(observerBlock, /new IntersectionObserver\(/);
    assert.match(observerBlock, /root: grid,/);
    assert.match(observerBlock, /rootMargin: `\$\{RELATED_PROMPT_IMAGE_ROOT_MARGIN_PX\}px 0px`/);
    assert.match(warmupBlock, /activateRelatedPromptImage\(image\);/);
    assert.match(warmupBlock, /image\.decode\(\)\.catch/);
    assert.equal(warmupBlock.includes('new Image()'), false);
    assert.match(gridStyleBlock, /overscroll-behavior-y:\s*contain;/);
    assert.match(gridStyleBlock, /contain:\s*layout paint style;/);
    assert.match(cardStyleBlock, /contain:\s*layout paint style;/);
    assert.equal(cardStyleBlock.includes('translateZ(0)'), false);
    assert.equal(
        (promptsHtml.match(/relatedScrollPerf=20260716_PROMPT_RELATED_SCROLL_PERF_1/g) || []).length,
        2,
        'both the related prompt script and stylesheet should be cache-busted'
    );
});
