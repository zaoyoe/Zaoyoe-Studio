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
        'const PROMPT_GALLERY_SKELETON_COUNT = 6;',
        'function renderFeaturedBannerSkeleton()',
        "banner.classList.add('featured-banner--visible', 'featured-banner--loading');",
        'renderFeaturedBannerSkeleton();',
        'prompt-card-skeleton-overlay',
        'prompt-card-skeleton-title',
        'prompt-card-skeleton-meta'
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
        '.prompt-card-skeleton-overlay',
        '.prompt-card-skeleton-title',
        '.prompt-card-skeleton-title--wide',
        '.prompt-card-skeleton-meta',
        '.prompt-card-skeleton-meta--wide',
        '.nav-item.nav-item--skeleton',
        '.nav-item-skeleton--title',
        'width: fit-content;',
        'margin: 0 auto 0.2rem;'
    ];

    for (const marker of cssMarkers) {
        assert.equal(promptsCss.includes(marker), true, `prompts-poetry.css should contain ${marker}`);
    }

    assert.doesNotMatch(
        promptsCss,
        /\.nav-items\.nav-items--skeleton\s*\{[^}]*display:\s*grid;/,
        'mobile skeletons should reuse the live flex layout so category positions remain stable'
    );

    assert.match(
        promptsCss,
        /\.prompt-card--loading:not\(\.prompt-card--skeleton\) \.prompt-card-media-skeleton \.prompts-skeleton-block\s*\{[\s\S]*?background-size:\s*100% 100%;[\s\S]*?animation:\s*none;[\s\S]*?will-change:\s*auto;/,
        'incremental image-card skeletons should remain static and compositor-light'
    );
    assert.equal(
        promptsCss.includes('promptSkeletonShimmer'),
        false,
        'prompts should not define or run any skeleton shimmer animation'
    );
    assert.equal(
        promptsCss.includes('will-change: background-position'),
        false,
        'static prompt skeletons should not reserve animated background layers'
    );
    const skeletonRuleBodies = [...promptsCss.matchAll(/([^{}]*skeleton[^{}]*)\{([^{}]*)\}/gi)]
        .map((match) => match[2]);
    for (const ruleBody of skeletonRuleBodies) {
        assert.doesNotMatch(ruleBody, /(?:linear|radial)-gradient\(/, 'prompt skeletons should use flat solid fills');
        for (const shadowMatch of ruleBody.matchAll(/box-shadow:\s*([^;]+)/g)) {
            assert.equal(shadowMatch[1].trim(), 'none', 'prompt skeletons should not use weighted shadows');
        }
    }
    assert.match(
        promptsCss,
        /body\.prompts-page \.prompts-skeleton-block\s*\{[\s\S]*?background-size:\s*100% 100%;[\s\S]*?animation:\s*none;[\s\S]*?will-change:\s*auto;/,
        'all prompt skeleton surfaces should use the static lightweight treatment'
    );
    assert.equal(
        (promptsHtml.match(/staticSkeleton=20260712_PROMPTS_STATIC_SKELETON_1/g) || []).length,
        2,
        'prompts should cache-bust both static skeleton styles and runtime'
    );
});

test('prompts initial HTML paints the complete loading skeleton before runtime starts', () => {
    const promptsHtml = readRepoFile('prompts.html');
    const promptsJs = readRepoFile('prompts-poetry.js');
    const promptsCss = readRepoFile('prompts-poetry.css');

    assert.match(promptsHtml, /class="nav-items nav-items--skeleton" id="navItems"/);
    assert.match(
        promptsHtml,
        /class="featured-banner featured-banner--visible featured-banner--loading" id="featuredBanner"/
    );
    assert.match(
        promptsHtml,
        /class="gallery-container gallery-container--initial-skeleton visible" data-initial-prompt-skeleton="true"/
    );
    assert.equal(
        (promptsHtml.match(/class="prompt-card prompt-card--skeleton/g) || []).length,
        6,
        'the initial document should include a full first row of gallery skeleton cards'
    );
    assert.equal(promptsCss.includes('.gallery-container--initial-skeleton {'), true);
    assert.equal(promptsCss.includes('display: grid;'), true);
    assert.equal(
        promptsJs.includes("classList.remove('gallery-container--standard', 'gallery-container--initial-skeleton')"),
        true
    );
    assert.equal(promptsJs.includes("removeAttribute('data-initial-prompt-skeleton')"), true);
    assert.match(promptsHtml, /initialSkeleton=20260729_PROMPTS_INITIAL_SKELETON_1/);
});
