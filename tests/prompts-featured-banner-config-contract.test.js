const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('prompts featured banner prefers homepage manual featured items before daily random fallback', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsHtml = readRepoFile('prompts.html');
    const promptsPageCss = readRepoFile('css/prompts-page.css');

    const requiredMarkers = [
        'void renderFeaturedBanner();',
        'async function loadHomepagePromptsConfigForBanner(site = getPromptHomepageBannerSite())',
        ".rpc('fn_get_homepage_config', {",
        'p_include_hidden: true',
        'function getPromptAdminVisibilityStatus(prompt = {})',
        'function hasPromptPageVisibleCopy(value) {',
        "if (status === 'draft' || status === 'archived') {",
        'const hasBaseTitle = hasPromptPageVisibleCopy(prompt?.title);',
        'const hasPromptText = hasPromptPageVisibleCopy(prompt?.prompt_text || prompt?.prompt);',
        'const hasImages = Array.isArray(prompt?.images) && prompt.images.some((item) => hasPromptPageVisibleCopy(item));',
        'const visibleSupabasePrompts = filterVisiblePromptsForPromptsPage(supabasePrompts);',
        'function findPromptByHomepageFeaturedItemId(featuredItemId = \'\')',
        'String(item?.supabaseId || item?.id || \'\').trim() === normalizedId',
        'function resolveHomepageFeaturedBannerPrompt(config = null)',
        'config?.prompts?.featured_items',
        'const featured = resolveHomepageFeaturedBannerPrompt(homepageConfig) || resolveDailyFeaturedPrompt();',
        "const localizedDescription = String(getLocalizedField(featured, 'description') || '').trim();",
        "title.textContent = getLocalizedField(featured, 'title') || featured.title || '';",
        'const currentLanguage = getCurrentLanguage();',
        "window.addEventListener('languageChanged', () => {"
    ];

    for (const marker of requiredMarkers) {
        assert.equal(
            promptsSource.includes(marker),
            true,
            `prompts-poetry.js should contain ${marker}`
        );
    }

    assert.equal(
        promptsHtml.includes('prompts-poetry.js?v=20260409_PROMPTS_VISIBILITY_2'),
        true,
        'prompts.html should reference the featured-banner homepage-config bundle version'
    );

    assert.equal(
        promptsPageCss.includes('.featured-banner:not(.featured-banner--visible)'),
        true,
        'css/prompts-page.css should hide the featured banner only before the visible state class is applied'
    );
});
