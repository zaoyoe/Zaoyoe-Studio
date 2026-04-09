const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('prompts loading skeleton covers featured banner, nav, and richer gallery cards', () => {
    const promptsHtml = readRepoFile('prompts.html');
    const promptsJs = readRepoFile('prompts-poetry.js');
    const promptsCss = readRepoFile('prompts-poetry.css');

    const htmlMarkers = [
        'featured-banner-skeleton',
        'featured-banner-skeleton__backdrop',
        'featured-banner-skeleton__vignette',
        'featured-banner-skeleton__headline--secondary'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(promptsHtml.includes(marker), true, `prompts.html should contain ${marker}`);
    }

    const jsMarkers = [
        'function renderFeaturedBannerSkeleton()',
        "banner.classList.add('featured-banner--visible', 'featured-banner--loading');",
        'renderFeaturedBannerSkeleton();',
        'prompt-card-skeleton-topbar',
        'prompt-card-skeleton-fav',
        'prompt-card-skeleton-dots'
    ];

    for (const marker of jsMarkers) {
        assert.equal(promptsJs.includes(marker), true, `prompts-poetry.js should contain ${marker}`);
    }

    const cssMarkers = [
        '.featured-banner--loading .featured-banner-skeleton',
        '.featured-banner--loading {',
        '.featured-banner-skeleton__backdrop',
        '.featured-banner-skeleton__vignette',
        '.featured-banner-skeleton__content',
        'justify-content: flex-start;',
        'align-items: flex-start;',
        '.prompts-skeleton-block',
        '.prompt-card-skeleton-topbar',
        '.prompt-card-skeleton-fav',
        '.prompt-card-skeleton-title--wide',
        '.prompt-card-skeleton-dot'
    ];

    for (const marker of cssMarkers) {
        assert.equal(promptsCss.includes(marker), true, `prompts-poetry.css should contain ${marker}`);
    }
});
