const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('shared theme toggle wakes dark-mode starry sky on prompts and shop pages', () => {
    const injectAuthSource = readRepoFile('inject-auth.js');
    const promptsSource = readRepoFile('prompts-poetry.js');
    const shopClientSource = readRepoFile('js/shop-client.js');
    const promptsHtml = readRepoFile('prompts.html');
    const shopHtml = readRepoFile('shop.html');

    assert.equal(
        injectAuthSource.includes("window.dispatchEvent(new CustomEvent('zaoyoe:themechange'"),
        true,
        'shared auth theme toggle should notify page-level dark-mode effects'
    );

    assert.equal(
        promptsSource.includes('function bindPromptThemeStarryLoader()'),
        true,
        'prompts should bind a theme-change starry loader'
    );
    assert.equal(
        promptsSource.includes("window.addEventListener('zaoyoe:themechange', loadPromptStarrySkyRuntimeForTheme);"),
        true,
        'prompts should load starry sky when the shared theme toggle switches into dark mode'
    );
    assert.equal(
        promptsSource.includes('bindPromptThemeStarryLoader();'),
        true,
        'prompts should install the starry theme listener on DOMContentLoaded'
    );

    assert.equal(
        shopClientSource.includes('shopThemeStarryEventBound: false'),
        true,
        'shop should guard the shared theme-change listener against duplicate bindings'
    );
    assert.equal(
        shopClientSource.includes("window.addEventListener('zaoyoe:themechange', loadForDarkTheme);"),
        true,
        'shop should load starry sky after the shared theme toggle switches into dark mode'
    );

    for (const [file, source] of [['prompts.html', promptsHtml], ['shop.html', shopHtml]]) {
        assert.equal(
            source.includes('inject-auth.js?v=20260620_THEME_STARRY_EVENT_1'),
            true,
            `${file} should cache-bust the shared theme starry event runtime`
        );
    }
});

test('shared starry sky throttles drawing during scroll and background activity', () => {
    const starrySource = readRepoFile('starry-sky.js');
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsCss = readRepoFile('prompts-poetry.css');

    [
        'const frameIntervalMs = 1000 / 30;',
        'document.hidden',
        'pageScrolling',
        "document.documentElement.dataset.theme !== 'dark'",
        "document.documentElement.classList.contains('ai-image-workbench-open')",
        "window.addEventListener('scroll', handleScrollActivity, { passive: true });",
        'pageScrolling = true;',
        "document.documentElement.classList.add('starry-scroll-active');",
        "document.addEventListener('scroll', handleScrollActivity, { passive: true, capture: true });",
        "document.addEventListener('visibilitychange', () => {"
    ].forEach((marker) => {
        assert.equal(starrySource.includes(marker), true, `starry-sky.js should include ${marker}`);
    });

    assert.equal(
        promptsSource.includes("script.src = 'starry-sky.js?v=20260729_AI_WORKBENCH_SCROLL_PERF_1';"),
        true,
        'prompts should cache-bust the throttled starry runtime'
    );
    assert.match(
        promptsCss,
        /html\.ai-image-workbench-open body\.prompts-page \.gallery-container \.prompt-card\.breathing\s*\{[\s\S]*animation-play-state:\s*paused !important;[\s\S]*will-change:\s*auto;/,
        'AI workbench should pause the obscured prompt card animations'
    );
    assert.match(
        promptsCss,
        /body\.prompts-page\.modal-open \.gallery-container,[\s\S]*animation:\s*none !important;[\s\S]*transition:\s*none !important;[\s\S]*will-change:\s*auto !important;/,
        'prompt detail should demote obscured gallery compositor layers'
    );
    assert.match(
        promptsCss,
        /html\.ai-image-workbench-open canvas#starryCanvas,\s*\nhtml\.ai-image-workbench-open \.starry-sky-canvas\s*\{[\s\S]*visibility:\s*hidden;[\s\S]*transform:\s*none;[\s\S]*will-change:\s*auto;/,
        'AI workbench should release the covered starry canvas GPU layer'
    );
});

test('prompts page removes the full-screen ambient light runtime in every theme', () => {
    const promptsHtml = readRepoFile('prompts.html');
    const promptsCss = readRepoFile('prompts-poetry.css');
    const promptsSource = readRepoFile('prompts-poetry.js');

    assert.equal(promptsHtml.includes('id="ambientCanvas"'), false, 'prompts should not render an ambient canvas');
    assert.equal(promptsCss.includes('#ambientCanvas'), false, 'prompts should not style an ambient canvas');
    assert.equal(promptsSource.includes('function initAmbientLight()'), false, 'prompts should not define ambient drawing code');
    assert.equal(promptsSource.includes("schedulePromptIdleTask('ambient-light'"), false, 'prompts should not schedule ambient drawing');
    assert.equal(
        (promptsHtml.match(/ambientLight=20260712_PROMPTS_AMBIENT_LIGHT_REMOVED_1/g) || []).length,
        2,
        'prompts should cache-bust both CSS and runtime after removing ambient light'
    );
});

test('prompts auth sheet does not paint dark chrome shields behind the login modal', () => {
    const promptsCss = readRepoFile('prompts-poetry.css');
    const promptsHtml = readRepoFile('prompts.html');

    assert.match(
        promptsCss,
        /html\[data-theme="dark"\] body\.prompts-page\.auth-sheet-open::before,\s*\nhtml\[data-theme="dark"\] body\.prompts-page\.auth-sheet-open::after \{\s*\n\s*content:\s*none !important;\s*\n\s*display:\s*none !important;/,
        'dark prompts auth sheet should not create top or bottom black pseudo-element shields behind the login modal'
    );
    assert.doesNotMatch(
        promptsCss,
        /body\.prompts-page\.auth-sheet-open::after \{[\s\S]*?background:\s*linear-gradient\([^}]*#000000/,
        'dark prompts auth sheet should not paint a black bottom rectangle while the login sheet opens'
    );
    assert.equal(
        promptsHtml.includes('authSheetChrome=20260707_PROMPT_AUTH_SHEET_NO_CHROME_SHIELD_1'),
        true,
        'prompts.html should cache-bust the prompt auth sheet chrome shield fix'
    );
});
