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
