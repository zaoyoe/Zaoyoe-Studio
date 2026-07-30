const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('prompt category skeletons reuse label geometry and wait for stable font metrics', () => {
    const html = readRepoFile('prompts.html');
    const source = readRepoFile('prompts-poetry.js');
    const css = readRepoFile('prompts-poetry.css');

    assert.match(html, /family=Playfair\+Display:[^"']+&display=optional/);
    assert.match(source, /const PROMPT_NAV_SKELETON_ITEMS = \[/);
    for (const label of ['All', 'Photography', 'Creative', 'Illustration', '3D Art', 'Miniature', 'Animation', 'Saved']) {
        assert.match(source, new RegExp(`\\['${label}',`));
    }
    assert.match(
        source,
        /async function generateDynamicNav\(\) \{[\s\S]*?await waitForPromptNavFont\(\);[\s\S]*?classList\.remove\('nav-items--skeleton'\)/
    );
    assert.match(source, /const PROMPT_NAV_CATEGORY_ITEMS = Object\.freeze\(/);
    assert.match(source, /PROMPT_NAV_CATEGORY_ITEMS\.forEach\(\(\[tag, cn\]\) => \{/);
    assert.doesNotMatch(source, /const topTags = Object\.entries\(tagCounts\)/);
    assert.match(
        source,
        /renderPromptNavSkeletons\(\);\s*void waitForPromptNavFont\(\);[\s\S]*?await loadPromptsFromSupabase\(\);/
    );
    assert.match(source, /class="en skeleton nav-item-skeleton nav-item-skeleton--title">\$\{englishLabel\}<\/span>/);
    assert.match(source, /class="cn skeleton nav-item-skeleton nav-item-skeleton--subtitle">\$\{chineseLabel\}<\/span>/);
    assert.match(css, /\.nav-item-skeleton--title\s*\{\s*width:\s*fit-content;\s*height:\s*auto;\s*margin:\s*0 auto 0\.2rem;/);
    assert.doesNotMatch(css, /\.nav-items\.nav-items--skeleton\s*\{\s*display:\s*grid;/);
});

test('narrow English prompt navigation does not retain bilingual minimum height', () => {
    const html = readRepoFile('prompts.html');
    const css = readRepoFile('prompts-poetry.css');

    assert.match(
        css,
        /@media \(max-width: 768px\) \{[\s\S]*?html\[lang="en"\] \.nav-items \{\s*min-height:\s*0;/
    );
    assert.match(html, /englishNavSpacing=20260725_PROMPTS_ENGLISH_NAV_SPACING_1/);
});

test('Chinese prompt navigation displays Chinese labels only', () => {
    const html = readRepoFile('prompts.html');
    const css = readRepoFile('prompts-poetry.css');

    assert.match(
        css,
        /html:not\(\[lang="en"\]\) \.nav-items\s*\{\s*min-height:\s*0;/
    );
    assert.match(
        css,
        /html:not\(\[lang="en"\]\) \.nav-item \.en\s*\{\s*display:\s*none;/
    );
    assert.match(
        css,
        /html:not\(\[lang="en"\]\) \.nav-item \.cn\s*\{[\s\S]*?font-size:\s*1rem;[\s\S]*?opacity:\s*1;/
    );
    assert.match(css, /html\[lang="en"\] \.nav-item \.cn\s*\{\s*display:\s*none;/);
    assert.match(html, /zhNav=20260726_PROMPTS_ZH_ONLY_NAV_1/);
});

test('Chinese prompt sub-navigation removes invisible gaps and keeps compact skeletons', () => {
    const html = readRepoFile('prompts.html');
    const source = readRepoFile('prompts-poetry.js');
    const css = readRepoFile('prompts-poetry.css');

    assert.match(
        source,
        /\.sort\(\(a, b\) => b\.count - a\.count \|\| a\.en\.localeCompare\(b\.en, 'en', \{ sensitivity: 'base' \}\)\)/
    );
    assert.match(
        source,
        /function getAISubTagChineseLabel\(tagObj = \{\}\) \{[\s\S]*?containsPromptCjkText\(englishLabel\)[\s\S]*?TAG_TRANSLATIONS/
    );
    assert.match(
        source,
        /const visibleSubTags = subTags[\s\S]*?\.filter\(\(tagObj\) => isEnglish \|\| tagObj\.cn\);/
    );
    assert.match(source, /visibleSubTags\.forEach\(\(tagObj, i\) => \{/);
    assert.match(
        css,
        /html:not\(\[lang="en"\]\) \.nav-item \.cn:not\(\.nav-item-skeleton\)\s*\{\s*width:\s*100%;/
    );
    assert.match(
        css,
        /html:not\(\[lang="en"\]\) \.nav-item \.cn\.nav-item-skeleton\s*\{\s*width:\s*2rem;/
    );
    assert.match(html, /navTagLayout=20260726_PROMPTS_NAV_TAG_LAYOUT_2/);
    assert.match(html, /subTagOrder=20260726_PROMPTS_SUBTAG_ORDER_1/);
    assert.match(html, /categoryCompleteness=20260730_PROMPTS_CATEGORY_COMPLETENESS_1/);
});
