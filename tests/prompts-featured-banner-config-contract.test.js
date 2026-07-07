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
    const promptsPoetryCss = readRepoFile('prompts-poetry.css');

    const requiredMarkers = [
        'const featuredFirstPaintPromise = renderFeaturedBanner({ waitForFirstImage: true });',
        'const galleryConfigPromise = loadGalleryConfigForFirstRender();',
        'await featuredFirstPaintPromise;',
        'await galleryConfigPromise;',
        'renderGallery(initialFilter);',
        'async function loadHomepagePromptsConfigForBanner(site = getPromptHomepageBannerSite())',
        ".rpc('fn_get_homepage_config', {",
        'p_include_hidden: true',
        'function getPromptAdminVisibilityStatus(prompt = {})',
        'function hasPromptPageVisibleCopy(value) {',
        "if (status === 'draft' || status === 'archived') {",
        'const hasBaseTitle = hasPromptPageVisibleCopy(prompt?.title);',
        'const hasPromptText = hasPromptPageVisibleCopy(prompt?.prompt_text || prompt?.prompt);',
        'const hasImages = getPromptImageAssets(prompt).some((item) => hasPromptPageVisibleCopy(getPromptImageAssetOriginalUrl(item)));',
        'const visibleSupabasePrompts = filterVisiblePromptsForPromptsPage(supabasePrompts);',
        'function findPromptByHomepageFeaturedItemId(featuredItemId = \'\')',
        'String(item?.supabaseId || item?.id || \'\').trim() === normalizedId',
        'function resolveHomepageFeaturedBannerPrompt(config = null)',
        'config?.prompts?.featured_items',
        'const prefetchedConfiguredFeatured = resolveHomepageFeaturedBannerPrompt(prefetchedHomepageConfig);',
        'const immediateFeatured = prefetchedConfiguredFeatured || resolveDailyFeaturedPrompt();',
        'const configuredFeatured = resolveHomepageFeaturedBannerPrompt(homepageConfig);',
        "const localizedDescription = String(getLocalizedField(featured, 'description') || '').trim();",
        'function getFeaturedBannerImageCandidates(imageAsset)',
        'function setFeaturedBannerImageSource(image, imageAsset)',
        "image.dataset.featuredFallbackIndex = '0';",
        'function waitForPromptFeaturedFirstImage(imagePromise)',
        'function bindFeaturedBannerActivation(banner, promptId = \'\')',
        "banner._promptFeaturedClickHandler = (event) => {",
        "target?.closest('.featured-image-container, .featured-content')",
        'openPromptModal(normalizedPromptId);',
        'function getFeaturedBannerModalPromptId(featured = {})',
        'const stablePromptId = getPromptStableOpenId(prompt);',
        'bindFeaturedBannerActivation(banner, getFeaturedBannerModalPromptId(featured));',
        'function findPromptForModalOpen(id)',
        'String(prompt?.supabaseId ?? prompt?.supabase_id ?? \'\').trim() === normalizedId',
        'PROMPTS.find((prompt) => String(prompt?.id ?? \'\').trim() === normalizedId)',
        'const item = findPromptForModalOpen(id);',
        'const configuredUpdatePromise = renderFeaturedBannerConfiguredUpdate(immediateFeatured);',
        'setFeaturedBannerImageSource(image, featuredImageAsset);',
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
        promptsSource.includes('banner.onclick = () => openPromptModal'),
        false,
        'featured banner should not make the invisible left/right gutters clickable'
    );
    assert.equal(
        promptsSource.includes('target.onclick = activate'),
        false,
        'featured banner should not rely on fragile child onclick handlers'
    );
    assert.equal(
        promptsSource.includes('bindFeaturedBannerActivation(banner, featured.id);'),
        false,
        'featured banner should not pass a possibly persistent Supabase id into the local modal opener'
    );
    assert.equal(
        promptsSource.includes('PROMPTS.find(p => p.id === id)'),
        false,
        'prompt modal opener should not silently reject stringified local ids from featured banner clicks'
    );

    assert.equal(
        promptsHtml.includes('prompts-poetry.js?v=20260507_REPLY_REALTIME_1&promptLangSignal=20260503_PROMPT_LANG_SIGNAL_1'),
        true,
        'prompts.html should reference the featured-banner homepage-config bundle version'
    );

    assert.equal(
        promptsHtml.includes('featuredHitbox=20260620_FEATURED_OPEN_1'),
        true,
        'prompts.html should cache-bust the featured banner open-id fix'
    );

    assert.equal(
        promptsHtml.includes('css/prompts-page.css?v=20260428_PROMPTS_SKELETON_CACHE_1'),
        true,
        'prompts.html should reference the prompt page CSS bundle with modal scroll lock styles'
    );

    assert.equal(
        promptsPageCss.includes('.featured-banner:not(.featured-banner--visible)'),
        true,
        'css/prompts-page.css should hide the featured banner only before the visible state class is applied'
    );

    assert.equal(
        /\.featured-image-container img\s*\{[\s\S]*pointer-events:\s*none;/.test(promptsPoetryCss),
        true,
        'featured banner image should not swallow clicks meant for the banner hitbox'
    );

    assert.equal(
        /\.featured-overlay\s*\{[\s\S]*pointer-events:\s*none;/.test(promptsPoetryCss),
        true,
        'featured banner overlay should not swallow clicks meant for the banner hitbox'
    );

    assert.equal(
        promptsPageCss.includes('html.no-scroll,'),
        true,
        'css/prompts-page.css should define the shared no-scroll state for prompt modal scroll locking'
    );

    assert.equal(
        promptsPageCss.includes('body.ios-scroll-lock-fixed {'),
        true,
        'css/prompts-page.css should define the fixed-body scroll lock state for prompt modals'
    );
});

test('prompts page keeps the AI workbench mounted', () => {
    const promptsHtml = readRepoFile('prompts.html');
    const workbenchSource = readRepoFile(path.join('js', 'ai-image-workbench.js'));
    const workbenchStyles = readRepoFile(path.join('css', 'ai-image-workbench.css'));

    assert.equal(
        promptsHtml.includes('css/ai-image-workbench.css'),
        true,
        'prompts.html should load the AI workbench stylesheet'
    );
    assert.equal(
        promptsHtml.includes('js/ai-image-workbench.js'),
        true,
        'prompts.html should load the AI workbench runtime'
    );
    assert.equal(
        promptsHtml.includes('id="promptActionAiImageSlot"'),
        true,
        'prompt detail modal should keep the AI workbench action slot'
    );
    assert.equal(
        workbenchSource.includes("root.className = 'ai-image-workbench-root'"),
        true,
        'AI workbench runtime should create the floating workbench root'
    );
    assert.equal(
        workbenchSource.includes("document.body.classList.add('ai-image-workbench-ready')"),
        true,
        'AI workbench runtime should mark the page ready after mounting'
    );
    assert.equal(
        workbenchStyles.includes('.ai-image-workbench-root'),
        true,
        'AI workbench stylesheet should include the root surface styles'
    );
});

test('prompts mobile search input suppresses native tap flash inside the search pill', () => {
    const promptsHtml = readRepoFile('prompts.html');
    const promptsCss = readRepoFile('prompts-poetry.css');

    const requiredStyleMarkers = [
        '.nav-search input {',
        'background-color: transparent !important;',
        'background-image: none !important;',
        '-webkit-appearance: none;',
        '-webkit-tap-highlight-color: transparent;',
        'body.prompts-page .nav-search input:focus',
        'body.prompts-page .nav-search input:active'
    ];

    for (const marker of requiredStyleMarkers) {
        assert.equal(
            promptsCss.includes(marker),
            true,
            `prompts-poetry.css should keep mobile search input neutral for ${marker}`
        );
    }

    assert.equal(
        promptsHtml.includes('prompts-poetry.css?v=20260617_AVATAR_MENU_ICON_HOVER_BLUE_1'),
        true,
        'prompts.html should cache-bust the mobile search tap highlight fix'
    );
});

test('prompts mobile comment mode keeps a dedicated light theme surface', () => {
    const promptsHtml = readRepoFile('prompts.html');
    const promptsCss = readRepoFile('prompts-poetry.css');
    const promptsSource = readRepoFile('prompts-poetry.js');

    const requiredStyleMarkers = [
        '20260425_PROMPTS_COMMENT_HOVER_LIGHT_1',
        'html[data-theme="light"] .modal-inner.comment-mode .modal-content-col',
        'html:not([data-theme="dark"]) .modal-inner.comment-mode .modal-content-col',
        'html[data-theme="light"] .modal-inner.comment-mode .comment-sort-btn',
        'html[data-theme="light"] .modal-inner.comment-mode .comment-footer-toggle',
        'html[data-theme="light"] .modal-inner.comment-mode .comment-input-area.composer-proxy #commentInput',
        'html[data-theme="light"] .modal-inner.comment-mode .comment-input-area.composer-proxy .comment-input-proxy-ui',
        '20260502_PROMPTS_COMMENT_FAB_COMPOSITE_1',
        '20260502_PROMPTS_PROMPT_CARD_STABLE_1',
        '.modal-inner:not(.comment-mode) .prompt-text.prompt-text--loading',
        'html[data-theme="light"] .modal-inner.comment-mode .close-modal-btn',
        'html[data-theme="light"] .prompt-comment-composer-sheet',
        'html[data-theme="light"] .prompt-comment-composer-send',
        'html:not([data-theme="dark"]) .prompt-comment-composer-editor',
        '.modal-inner.comment-mode.prompt-comment-geometry-locked:not(.keyboard-docked)'
    ];

    for (const marker of requiredStyleMarkers) {
        assert.equal(
            promptsCss.includes(marker),
            true,
            `prompts-poetry.css should contain ${marker}`
        );
    }

    assert.equal(
        /@media \(min-width:\s*769px\)\s*\{[\s\S]*?\.modal-image-col\s*\{[\s\S]*?flex:\s*0 0 calc\(50% - 40px\);/.test(promptsCss),
        true,
        'desktop comment mode should keep the image column width pinned instead of letting the right-column padding change resize it'
    );
    assert.equal(
        /\.modal-inner\.comment-mode \.modal-content-col\s*\{[\s\S]*?padding:\s*40px;/.test(promptsCss),
        true,
        'desktop comment mode should preserve the content column padding so the modal flex geometry does not jump'
    );
    assert.equal(
        /\.modal-inner\.comment-mode \.modal-header,[\s\S]*?\.modal-inner\.comment-mode \.modal-description\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?transform:\s*translateY\(-10px\);[\s\S]*?max-height:\s*0;/.test(promptsCss),
        true,
        'desktop comment mode should fade and collapse the prompt title and description area'
    );
    assert.equal(
        /@media \(min-width:\s*769px\)\s*\{[\s\S]*?\.modal-inner\.comment-mode \.modal-header,[\s\S]*?\.modal-inner\.comment-mode \.modal-description\s*\{[^}]*display:\s*none;/.test(promptsCss),
        false,
        'desktop comment mode should not hard-remove the prompt title with display:none'
    );
    assert.equal(
        /\.modal-inner\.comment-mode-returning \.modal-header,[\s\S]*?\.modal-inner\.comment-mode-returning \.modal-description\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?transition:[\s\S]*?opacity 0\.56s/.test(promptsCss),
        true,
        'desktop comment mode return should keep the title reveal paced with the other modal return animations'
    );
    assert.equal(
        /\.modal-inner\.comment-mode-title-revealing \.modal-header,[\s\S]*?\.modal-inner\.comment-mode-title-revealing \.modal-description\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*translateY\(0\);/.test(promptsCss),
        true,
        'desktop comment mode title reveal should use a dedicated state instead of ending early'
    );
    assert.equal(
        promptsSource.includes('function clearPromptCommentModeReturnState('),
        true,
        'comment mode return animation should clean up timers and transient return classes'
    );
    assert.equal(
        promptsSource.includes("modalInner.classList.add('comment-mode-returning');"),
        true,
        'closing comments should enter a transient title return animation state'
    );
    assert.equal(
        promptsSource.includes("modalInner.classList.add('comment-mode-title-revealing');"),
        true,
        'closing comments should explicitly start the slower title reveal'
    );
    assert.equal(
        promptsSource.includes("modalInner.classList.remove('comment-mode-returning', 'comment-mode-title-revealing');"),
        true,
        'comment mode return cleanup should remove both transient title animation classes together'
    );
    assert.equal(
        promptsSource.includes('}, 560);'),
        true,
        'comment mode title reveal should last long enough to match the prompt and image return animations'
    );
    assert.equal(
        /\.modal-inner\.comment-mode \.comment-section\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?margin-top:\s*0;/.test(promptsCss),
        true,
        'desktop comment mode should raise the comment section to the top of the modal column without changing column geometry'
    );
    assert.equal(
        /\.modal-inner\.comment-mode \.modal-image-col img\s*\{[\s\S]*?top:\s*35% !important;[\s\S]*?translate3d\(-50%, -50%, 0\) scale\(0\.85\);/.test(promptsCss),
        true,
        'desktop comment mode should keep the old upward image motion while the column width remains pinned'
    );
    assert.equal(
        /\.modal-inner\.comment-mode \.comment-section > \.comment-header\s*\{[\s\S]*?justify-content:\s*flex-start;/.test(promptsCss),
        true,
        'desktop comment sort control should sit at the upper-left of the comment card without affecting comment item headers'
    );

    assert.equal(
        promptsHtml.includes('commentModeLayout=20260619_COMMENT_MODE_LAYOUT_5'),
        true,
        'prompts.html should cache-bust the desktop comment mode motion/layout fix'
    );
});
