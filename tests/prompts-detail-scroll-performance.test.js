const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const getRuleBlock = (styles, selector) => {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] || '';
};

test('prompt detail reading gets an isolated scroll path and can cancel hidden warmup', () => {
    const styles = read('prompts-poetry.css');
    const runtime = read('prompts-poetry.js');
    const scrollLock = read('js/ios-scroll-lock.js');
    const page = read('prompts.html');

    assert.match(
        styles,
        /\.prompt-text\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior-y:\s*contain;[\s\S]*?-webkit-overflow-scrolling:\s*touch;[\s\S]*?touch-action:\s*pan-y;[\s\S]*?contain:\s*layout paint style;/,
        'the prompt reader should stay on its own native scroll path'
    );
    assert.match(runtime, /let promptRelatedWarmupToken = 0;/);
    assert.match(runtime, /promptText\.dataset\.relatedWarmupBlocked = '1';/);
    assert.match(runtime, /warmupToken !== promptRelatedWarmupToken/);
    assert.match(runtime, /bindPromptDetailScrollWarmupGuard\(\);/);
    assert.match(scrollLock, /const promptReader = node\.closest\?\.\('#modalPromptText'\);/);
    assert.match(scrollLock, /if \(promptReader && promptReader\.scrollHeight > promptReader\.clientHeight\) \{/);
    assert.match(page, /modalBackdrop=20260801_PROMPT_MODAL_BACKDROP_COMPOSITOR_1/);
});

test('prompt detail and workbench backdrops keep blur on isolated compositor layers', () => {
    const promptStyles = read('prompts-poetry.css');
    const workbenchStyles = read('css/ai-image-workbench.css');
    const promptBackdropRule = getRuleBlock(promptStyles, '.poetry-modal-backdrop');
    const workbenchBackdropRule = getRuleBlock(workbenchStyles, '.ai-image-overlay');

    assert.match(promptBackdropRule, /backdrop-filter:\s*var\(--app-modal-backdrop-filter\);/);
    assert.match(promptBackdropRule, /isolation:\s*isolate;/);
    assert.match(promptBackdropRule, /contain:\s*paint;/);
    assert.match(promptBackdropRule, /backface-visibility:\s*hidden;/);
    assert.match(workbenchBackdropRule, /backdrop-filter:\s*var\(--app-modal-backdrop-filter,/);
    assert.match(workbenchBackdropRule, /isolation:\s*isolate;/);
    assert.match(workbenchBackdropRule, /contain:\s*paint;/);
    assert.match(workbenchBackdropRule, /transform:\s*translate3d\(0, 0, 0\);/);
    assert.match(
        promptStyles,
        /body\.prompts-page\.modal-open \.gallery-container,[\s\S]*?animation:\s*none !important;[\s\S]*?transition:\s*none !important;[\s\S]*?will-change:\s*auto !important;/,
        'background gallery layers should be demoted while the prompt detail blur samples them'
    );
});
