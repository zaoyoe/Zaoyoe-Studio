const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

const SOURCE_FIELDS = [
    'source_url',
    'source_author_name',
    'source_author_handle',
    'source_author_avatar_url'
];

function getArrayDeclarationBlock(source, declarationName) {
    const start = source.indexOf(`const ${declarationName} = [`);
    assert.notEqual(start, -1, `${declarationName} should be declared`);

    const end = source.indexOf('].join', start);
    assert.notEqual(end, -1, `${declarationName} should join an array declaration`);
    return source.slice(start, end);
}

function getFunctionBlock(source, functionName) {
    const start = source.indexOf(`function ${functionName}(`);
    assert.notEqual(start, -1, `${functionName} should be declared`);

    const nextFunction = source.indexOf('\nfunction ', start + 1);
    assert.notEqual(nextFunction, -1, `${functionName} should be followed by another function`);
    return source.slice(start, nextFunction);
}

test('public prompt cards preserve source attribution fields from Supabase to hover UI', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsStyles = readRepoFile('prompts-poetry.css');
    const promptsHtml = readRepoFile('prompts.html');
    const relatedKeywordBlock = getFunctionBlock(promptsSource, 'collectPromptRelatedKeywordValues');

    for (const selectName of [
        'PROMPTS_SUPABASE_SUMMARY_SELECT',
        'PROMPTS_SUPABASE_DETAIL_SELECT',
        'PROMPTS_SUPABASE_SEARCH_DETAIL_SELECT'
    ]) {
        const selectBlock = getArrayDeclarationBlock(promptsSource, selectName);
        for (const field of SOURCE_FIELDS) {
            assert.equal(selectBlock.includes(`'${field}'`), true, `${selectName} should include ${field}`);
        }
    }

    const sourceMarkers = [
        'const PROMPTS_SOURCE_ATTRIBUTION_FIELD_KEYS = [',
        'const PROMPTS_SUPABASE_SEARCH_DETAIL_LEGACY_SELECT = PROMPTS_SUPABASE_SEARCH_DETAIL_SELECT',
        'function normalizePromptSourceLink(value = \'\')',
        'function getPromptSourceAttribution(item = {})',
        'function buildPromptSourceAttributionMarkup(item = {})',
        'function buildPromptFavoriteClusterMarkup(item = {}, options = {})',
        'function buildPromptSourceLinkMarkup(item = {}, options = {})',
        'function buildPromptShareButtonMarkup(item = {})',
        'function getPromptShareUrl(item = {})',
        'function copyPromptShareLink(item = {}, button = null, event = null)',
        'function bindPromptSourceActionEvents(root, favoriteId = \'\')',
        'function getPromptRelatedActionLabel()',
        'function getPromptShareActionLabel()',
        'function getPromptShareCopiedLabel()',
        'function getPromptShareCopyFailedLabel()',
        'function schedulePromptRelatedProfileWarmup()',
        'const PROMPT_RELATED_MIN_SCORE = 60;',
        'const PROMPT_RELATED_MIN_STRUCTURED_OVERLAPS = 4;',
        'const PROMPT_RELATED_MIN_BRIDGE_OVERLAPS = 3;',
        'const PROMPT_RELATED_MIN_TOTAL_EVIDENCE = 7;',
        'const PROMPT_RELATED_MIN_STRUCTURED_JACCARD = 0.16;',
        'const PROMPT_RELATED_MIN_STRUCTURED_COVERAGE = 0.22;',
        'const PROMPT_RELATED_STOPWORDS = new Set([',
        'const PROMPT_RELATED_FACET_DEFINITIONS = [',
        'const PROMPT_RELATED_PROFILE_CACHE = new WeakMap();',
        'function warmPromptRelatedProfiles()',
        'function hasPromptRelatedSignal(value = \'\')',
        'function getPromptRelatedTokenSet(item = {})',
        'function countPromptRelatedTokenOverlap(leftTokens = new Set(), rightTokens = new Set())',
        'function getPromptRelatedSetMetrics(leftTokens = new Set(), rightTokens = new Set())',
        'function getPromptRelatedFacetSet(item = {})',
        'function havePromptRelatedFacetOverlap(leftFacets = new Set(), rightFacets = new Set())',
        'function getPromptRelatedProfile(item = {})',
        'function getPromptRelatedScoreDetails(baseItem = {}, candidate = {})',
        'function scoreRelatedPromptCandidate(baseItem = {}, candidate = {})',
        'function isPromptRelatedCandidateStrongEnough(details = {})',
        'function getRelatedPrompts(currentItem = {}, limit = 12)',
        'let lastRenderedRelatedPromptKey = \'\';',
        'function getRelatedPromptRenderKey(item = findPromptAnalyticsItem())',
        'const RELATED_PROMPT_CARD_LAYOUTS = [',
        'function getRelatedPromptCardLayout(index = 0)',
        'function getRelatedPromptCardAspectWeight(index = 0)',
        'function getRelatedPromptTargetColumnIndex(columnHeights = [])',
        'function getRelatedPromptImagesInVisualOrder(grid)',
        'function renderRelatedPrompts(item = findPromptAnalyticsItem())',
        'function toggleRelatedMode()',
        'function openPromptDetailSideMode(mode)',
        'function closePromptDetailSideMode()',
        'const columns = [[], []];',
        'const columnHeights = [0, RELATED_PROMPT_COLUMN_STAGGER_WEIGHT];',
        'const targetColumnIndex = getRelatedPromptTargetColumnIndex(columnHeights);',
        'columns[targetColumnIndex].push(buildRelatedPromptCardMarkup(relatedItem, index));',
        'columnHeights[targetColumnIndex] += getRelatedPromptCardAspectWeight(index) + RELATED_PROMPT_CARD_GAP_WEIGHT;',
        'class="related-prompt-column related-prompt-column--${index === 0 ? \'left\' : \'right\'}"',
        'button.dataset.tooltip = relatedLabel;',
        'const promptId = getPromptStableOpenId(item);',
        'isRelatedMode = normalizedMode === \'related\';',
        'modalInner?.classList.toggle(\'related-mode\', isRelatedMode);',
        'scheduleRelatedPromptsRender(updatedItem);',
        'function renderPromptModalSourceActions(item = {})',
        'function syncPromptModalUnlockPriceState()',
        'normalizePromptUnlockPrice(_unlockPrice, 1) === 0',
        'class="card-source-empty"',
        'class="card-source-author"',
        'class="card-source-handle"',
        'class="card-source-actions"',
        'class="card-favorite-cluster"',
        "const countClassName = options.countClassName || 'card-favorite-count';",
        'const PROMPT_FAVORITES_USER_STORAGE_PREFIX = \'promptFavorites:user:\';',
        'let promptFavoriteAuthUserId = \'\'',
        'function normalizePromptFavoriteId(id = \'\')',
        'function isPromptFavoriteUserAuthenticated()',
        'function isPromptFavoriteSaved(id)',
        'function getPromptFavoriteLocalKnownCount(id = \'\')',
        'function getPromptFavoriteDisplayCount(item = {})',
        'function getPromptFavoriteIdForItem(item = {})',
        'baseCount + getPromptFavoriteLocalKnownCount(favoriteId)',
        'function openPromptFavoriteLoginModal()',
        'window.requestLoginModalOpen(\'login\')',
        'bindPromptFavoriteAuthListener();',
        'await syncPromptFavoriteAuthState({ force: true });',
        'const promptFavoriteId = normalizePromptFavoriteId(item.id)',
        'const isSaved = isPromptFavoriteSaved(favoriteId);',
        'function getPromptActionCopy(key, zhFallback, enFallback)',
        'function getPromptFavoriteActionLabel(isSaved = false)',
        "getPromptActionCopy('unsavePrompt', '取消收藏', 'Unsave')",
        'function getPromptSourceActionLabel()',
        "getPromptActionCopy('viewOriginalAuthor', '去看原作者', 'View original author')",
        "getPromptActionCopy('viewSameStylePrompts', '相同风格', 'Same style')",
        "getPromptActionCopy('sharePrompt', '分享', 'Share')",
        "getPromptActionCopy('promptShareCopied', '分享链接已复制', 'Share link copied')",
        "window.i18n?.t('gallery.sameStyleEmpty')",
        'function syncPromptSourceActionLabels()',
        'const favoriteLabel = getPromptFavoriteActionLabel(isSaved);',
        'const sourceLabel = getPromptSourceActionLabel();',
        'const shareLabel = getPromptShareActionLabel();',
        'const shareIconMarkup = \'<svg class="share-upload-icon"',
        'button.innerHTML = \'<i class="fas fa-check" aria-hidden="true"></i>\';',
        'const markMarkup = \'<span class="x-logo-mark" aria-hidden="true"></span>\';',
        "const className = options.className || 'card-source-link';",
        '<div class="card-source-author">',
        'root.querySelectorAll(\'.card-source-link\')',
        'syncPromptFavoriteButtons();',
        '${buildPromptSourceLinkMarkup(item)}\n            ${buildPromptFavoriteClusterMarkup(item, { favoriteId })}',
        'renderPromptHeaderShareAction(item);',
        'renderPromptModalSourceActions(item);',
        'renderPromptModalSourceActions(updatedItem);'
    ];

    for (const marker of sourceMarkers) {
        assert.equal(promptsSource.includes(marker), true, `prompts-poetry.js should contain ${marker}`);
    }

    assert.equal(
        promptsSource.includes('card-title--fallback'),
        false,
        'prompt card hover should not fall back to showing the prompt title when source attribution is missing'
    );
    assert.equal(
        promptsStyles.includes('.card-title--fallback'),
        false,
        'prompt card styles should not keep a title fallback block in the hover overlay'
    );
    assert.equal(
        promptsSource.includes('buildPromptSourceAvatarMarkup'),
        false,
        'prompt card hover should not render a source author avatar block'
    );
    assert.equal(
        promptsSource.includes('card-source-avatar'),
        false,
        'prompt card hover markup should not include source avatar nodes'
    );
    assert.equal(
        promptsSource.includes('columns[index % 2].push'),
        false,
        'related prompt masonry should not use odd/even assignment that can leave the second column empty'
    );
    assert.equal(
        promptsSource.includes('const fallback = PROMPTS'),
        false,
        'related prompt results should not backfill unrelated image prompts just to fill the panel'
    );
    assert.equal(
        promptsSource.includes('Math.max(0, limit - scored.length)'),
        false,
        'related prompt results should not calculate a fallback count for weakly related prompts'
    );
    assert.equal(
        relatedKeywordBlock.includes('dominantColors'),
        false,
        'related prompt structured matching should not treat broad dominant colors as precise related keywords'
    );
    assert.equal(
        relatedKeywordBlock.includes('category: item?.category'),
        false,
        'related prompt structured matching should not treat a broad category alone as a precise related keyword'
    );
    assert.equal(
        promptsSource.includes('const hasStructuredMatch = (details.keywordOverlapCount || 0) > 0;'),
        false,
        'related prompt matching should not accept candidates from only one structured token overlap'
    );
    for (const broadToken of ['fashion', 'storyboard', 'city', 'girl', '时尚', '分镜', '城市', '少女']) {
        assert.equal(
            promptsSource.includes(`'${broadToken}'`),
            true,
            `related prompt stopwords should include broad token ${broadToken}`
        );
    }
    assert.equal(
        promptsSource.includes('structuredJaccard: structuredMetrics.jaccard'),
        true,
        'related prompt scoring should expose structured Jaccard similarity'
    );
    assert.equal(
        promptsSource.includes('structuredCoverage: structuredMetrics.coverage'),
        true,
        'related prompt scoring should expose structured coverage similarity'
    );
    assert.equal(
        promptsSource.includes('totalEvidenceCount'),
        true,
        'related prompt scoring should require multi-signal evidence, not one-off token matches'
    );
    for (const facetKey of ["key: 'apparel'", "key: 'beauty'", "key: 'architecture'", "key: 'packaging'", "key: 'food'", "key: 'poster'", "key: 'character'"]) {
        assert.equal(
            promptsSource.includes(facetKey),
            true,
            `related prompt facet definitions should include ${facetKey}`
        );
    }
    assert.equal(
        promptsSource.includes('if (!havePromptRelatedFacetOverlap(baseProfile.facets, candidateProfile.facets))'),
        true,
        'related prompt scoring should reject mismatched high-level creative facets before scoring'
    );
    assert.equal(
        promptsSource.includes('if (!leftFacets.size || !rightFacets.size) {\n        return false;\n    }'),
        true,
        'related prompt facet gating should reject one-sided facet matches instead of letting unknown facets pass'
    );
    assert.equal(
        promptsSource.includes('details.sameCategory && structuredOverlapCount >= 3 && keywordBridgeCount >= 2'),
        true,
        'related prompt category bridge should require stronger structured and bridge overlap'
    );
    assert.equal(
        promptsSource.includes('hasCategoryBridge || hasStrongKeywordBridge || structuredOverlapCount >= 5'),
        true,
        'related prompt fallback acceptance should require a higher structured overlap ceiling'
    );
    assert.equal(
        promptsSource.includes('arePromptRelatedDomainsCompatible'),
        false,
        'related prompt matching should not rely on case-specific subject-domain patches'
    );
    assert.equal(
        promptsSource.includes('if (renderKey && renderKey === lastRenderedRelatedPromptKey && grid.children.length > 0)'),
        true,
        'related prompt rendering should skip repeated work for the same prompt/detail state'
    );
    assert.equal(
        promptsSource.includes("schedulePromptIdleTask('related-profile-warmup', warmPromptRelatedProfiles"),
        true,
        'related prompt profiles should be warmed during idle time to reduce click latency'
    );
    assert.equal(
        promptsSource.includes('if (isRelatedMode) {\n                scheduleRelatedPromptsRender(updatedItem);\n            } else {\n                scheduleRelatedPromptWarmup(updatedItem);\n            }'),
        true,
        'prompt detail hydration should only rerender related prompts while the related panel is open and warm them otherwise'
    );
    assert.equal(
        promptsSource.includes('href="${escapeHtml(attribution.sourceUrl)}"'),
        false,
        'source author identity should not link to the original work'
    );
    assert.equal(
        promptsSource.includes("'.card-source-author',"),
        false,
        'source author identity should not be treated as a card interactive target'
    );
    assert.equal(
        promptsSource.includes('const isSaved = favorites.has(promptFavoriteId)'),
        false,
        'favorite UI should not show a red heart from raw local favorites without checking the current authenticated user'
    );
    assert.equal(
        promptsSource.includes("localStorage.getItem('promptFavorites') || '[]'"),
        false,
        'prompt favorites should not read the legacy shared browser favorite key for active UI state'
    );
    assert.equal(
        promptsSource.includes('PROMPT_FAVORITES_LEGACY_STORAGE_KEY'),
        false,
        'prompt favorites should not migrate anonymous/shared favorites into the current authenticated user state'
    );
    assert.equal(
        promptsSource.includes('baseCount + (isSaved ? 1 : 0)'),
        false,
        'favorite count should remain a public total and should not reset to zero when the current user signs out'
    );

    const styleMarkers = [
        '.card-overlay-bottom',
        '.card-source-author',
        '.card-source-name',
        '.card-source-handle',
        '.card-source-actions',
        '.card-favorite-cluster',
        '.card-favorite-count',
        '.card-fav-btn[data-tooltip]::after',
        '.card-source-link[data-tooltip]::after',
        '.card-share-btn[data-tooltip]::after',
        '.card-fav-btn.saved::before',
        '.card-fav-btn.saved i',
        '.card-source-link',
        '.card-share-btn',
        '.card-share-btn .share-upload-icon',
        '.card-share-btn.copied',
        '--x-logo-mask',
        'mask: var(--x-logo-mask) center / contain no-repeat',
        '.card-source-link--disabled',
        '.prompt-card--loading .card-source-author',
        '.prompt-content-header',
        '.prompt-header-actions',
        '.prompt-header-share-slot',
        '.prompt-action-ai-image-slot',
        '.prompt-modal-source-actions',
        '.prompt-modal-card-source-actions',
        '.related-trigger-btn',
        '.related-section',
        '.modal-inner.related-mode .related-section',
        '.related-prompt-grid',
        '.related-prompt-column',
        '.related-prompt-column--right',
        '.related-prompt-card',
        '.related-prompt-card--hero',
        '.related-prompt-card--wide',
        '20260619_PROMPT_DETAIL_ACTION_BAR_COMPACT_5'
    ];

    for (const marker of styleMarkers) {
        assert.equal(promptsStyles.includes(marker), true, `prompts-poetry.css should contain ${marker}`);
    }
    assert.equal(
        promptsStyles.includes('.card-source-avatar'),
        false,
        'prompt card styles should not include source avatar rules'
    );
    assert.equal(
        /\.prompt-modal-card-source-actions \.card-fav-btn,[\s\S]*\.prompt-modal-card-source-actions \.card-source-link\s*\{[\s\S]*color:\s*var\(--text-dim\);/.test(promptsStyles),
        true,
        'prompt modal source actions should default to the same dim color as the comment button'
    );
    assert.equal(
        /\[data-theme="dark"\] \.modal-content-col\s*\{[\s\S]*background:\s*rgba\(15,\s*23,\s*42,\s*0\.08\);[\s\S]*backdrop-filter:\s*blur\(12px\) saturate\(112%\);[\s\S]*-webkit-backdrop-filter:\s*blur\(12px\) saturate\(112%\);/.test(promptsStyles),
        true,
        'dark prompt detail right panel should keep a subtle frosted-glass blur'
    );
    assert.equal(
        /\.prompt-action-bar\s*\{[\s\S]*min-height:\s*30px;[\s\S]*margin-top:\s*12px;[\s\S]*padding-top:\s*10px;/.test(promptsStyles),
        true,
        'prompt detail action bar should stay compact so the bottom toolbar does not create excess empty height'
    );
    assert.equal(
        /\.prompt-area\s*\{[\s\S]*padding:\s*14px 20px 16px;/.test(promptsStyles),
        true,
        'prompt detail card should keep the title row close to the top without excess blank space'
    );
    assert.equal(
        /\.prompt-content-header\s*\{[\s\S]*margin-bottom:\s*8px;/.test(promptsStyles),
        true,
        'prompt detail title/copy row should sit closer to the prompt text'
    );
    assert.equal(
        /\.prompt-label\s*\{[\s\S]*min-height:\s*30px;/.test(promptsStyles),
        true,
        'prompt label row should not reserve the old tall header height'
    );
    assert.equal(
        /\.prompt-text\s*\{[\s\S]*padding-right:\s*0;/.test(promptsStyles),
        true,
        'prompt detail text should not add extra right padding beyond the card inset'
    );
    assert.equal(
        /\.prompt-text\s*\{[\s\S]*height:\s*120px;[\s\S]*min-height:\s*120px;[\s\S]*max-height:\s*120px;/.test(promptsStyles),
        true,
        'prompt detail text should reserve the final content height while loading'
    );
    assert.equal(
        /\.prompt-text\.prompt-text--loading\s*\{[\s\S]*min-height:\s*28px;/.test(promptsStyles),
        false,
        'prompt detail loading state should not use a shorter loading-only height'
    );
    assert.equal(
        /\.copy-btn\s*\{[\s\S]*width:\s*30px;[\s\S]*height:\s*30px;/.test(promptsStyles),
        true,
        'prompt copy button should match the compact title row height'
    );
    assert.equal(
        /\.prompt-modal-source-actions\s*\{[\s\S]*min-height:\s*30px;/.test(promptsStyles),
        true,
        'prompt detail source action wrapper should not reserve the old tall toolbar height'
    );
    assert.equal(
        /\.prompt-modal-card-source-actions \.card-fav-btn,[\s\S]*\.prompt-modal-card-source-actions \.card-source-link\s*\{[\s\S]*width:\s*30px;[\s\S]*height:\s*30px;/.test(promptsStyles),
        true,
        'prompt detail source icon hitboxes should be compact and visually balanced'
    );
    assert.equal(
        /\.prompt-header-actions \.card-share-btn\s*\{[\s\S]*width:\s*30px;[\s\S]*height:\s*30px;[\s\S]*color:\s*var\(--prompt-detail-accent\);/.test(promptsStyles),
        true,
        'prompt share action should sit in the title row next to the copy button'
    );
    assert.equal(
        /\.card-share-btn\.copied\s*\{[\s\S]*color:\s*#10b981;[\s\S]*background:\s*rgba\(16,\s*185,\s*129,\s*0\.14\);/.test(promptsStyles),
        true,
        'prompt share action should show the same green copied feedback as the copy action'
    );
    assert.equal(
        /\.card-share-btn \.share-upload-icon\s*\{[\s\S]*stroke-linecap:\s*round;[\s\S]*stroke-linejoin:\s*round;/.test(promptsStyles),
        true,
        'prompt share action should use a rounded upload/share icon'
    );
    assert.equal(
        /\.prompt-header-actions \.card-share-btn \.share-upload-icon\s*\{[\s\S]*width:\s*20px;[\s\S]*height:\s*20px;[\s\S]*stroke-width:\s*2\.55;/.test(promptsStyles),
        true,
        'prompt header share icon should visually match the copy icon size'
    );
    assert.equal(
        promptsSource.includes('showGalleryToast(getPromptShareCopiedLabel()'),
        false,
        'prompt share success should rely on the inline check feedback instead of a bottom toast'
    );
    assert.equal(
        /\.comment-trigger-btn\s*\{[\s\S]*width:\s*30px;[\s\S]*height:\s*30px;/.test(promptsStyles),
        true,
        'prompt detail comment button should match the compact action toolbar height'
    );
    assert.equal(
        /\.prompt-modal-card-source-actions \.card-fav-btn:hover,[\s\S]*\.prompt-modal-card-source-actions \.card-source-link:focus-visible\s*\{[\s\S]*color:\s*var\(--prompt-detail-accent\);/.test(promptsStyles),
        true,
        'prompt modal source actions should become accent blue on hover'
    );
    assert.equal(
        promptsStyles.includes('.card-fav-btn.saved::before {\n    background: rgba(255, 71, 87'),
        false,
        'saved favorite state should not fill the button background red'
    );
    assert.equal(
        /\.card-fav-btn::before\s*\{[\s\S]*content:\s*none;/.test(promptsStyles),
        true,
        'favorite button should not render a circular hover/background disk'
    );
    assert.equal(
        /\.card-source-link::before\s*\{[\s\S]*content:\s*none;/.test(promptsStyles),
        true,
        'X button should not render a circular hover/background disk'
    );
    assert.equal(
        /\.card-fav-btn\.saved i,[\s\S]*\.card-fav-btn\[aria-pressed="true"\] i\s*\{[\s\S]*color:\s*#ff4757;/.test(promptsStyles),
        true,
        'saved favorite state should color the heart outline red'
    );
    assert.equal(
        /\.card-fav-btn\.saved i\s*\{\s*color:\s*white;\s*\}/.test(promptsStyles),
        false,
        'saved favorite state should not be overridden back to a white heart outline'
    );
    assert.equal(
        /\.card-source-link\[data-tooltip\]::after\s*\{[^}]*right:\s*0;/.test(promptsStyles),
        false,
        'source tooltip should stay centered instead of being shifted left from the right edge'
    );
    assert.equal(
        /\.card-overlay-bottom\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*max-content;/.test(promptsStyles),
        true,
        'card hover footer should let the right action cluster grow leftward with longer favorite counts'
    );
    assert.equal(
        /\.card-source-actions\s*\{[\s\S]*min-width:\s*max-content;/.test(promptsStyles),
        true,
        'card action cluster should keep X, heart, and multi-digit counts together without clipping'
    );
    assert.equal(
        /\.card-favorite-count\s*\{[\s\S]*font-variant-numeric:\s*tabular-nums;/.test(promptsStyles),
        true,
        'favorite counts should use stable digit widths as they grow'
    );
    assert.equal(
        /\.related-prompt-grid\s*\{[\s\S]*display:\s*flex;[\s\S]*gap:\s*16px;/.test(promptsStyles),
        true,
        'related prompt panel should use two masonry columns with visible column spacing'
    );
    assert.equal(
        /\.related-trigger-btn\s*\{[\s\S]*width:\s*30px;[\s\S]*height:\s*30px;[\s\S]*padding:\s*0;/.test(promptsStyles),
        true,
        'related trigger should render as a compact icon-only control'
    );
    assert.equal(
        /\.prompt-modal-card-source-actions \.card-fav-btn,[\s\S]*\.prompt-modal-card-source-actions \.card-source-link\s*\{[\s\S]*width:\s*30px;[\s\S]*height:\s*30px;/.test(promptsStyles),
        true,
        'prompt detail source action should match favorite icon sizing'
    );
    assert.equal(
        /\.related-prompt-column\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*gap:\s*16px;/.test(promptsStyles),
        true,
        'related prompt columns should keep vertical breathing room between cards'
    );
    assert.equal(
        /\.related-prompt-column--right\s*\{[\s\S]*padding-top:\s*28px;/.test(promptsStyles),
        true,
        'related prompt right column should be vertically offset for a masonry stagger'
    );
    assert.equal(
        /\.modal-inner\.related-mode \.related-prompt-grid--entering \.related-prompt-card\s*\{[\s\S]*animation:\s*relatedPromptCardEnter 0\.56s cubic-bezier\(0\.19, 0\.92, 0\.22, 1\) both;/.test(promptsStyles),
        true,
        'related prompt cards should share the 0.56 second staggered entry animation on desktop and mobile'
    );
    assert.equal(
        promptsSource.includes("getRelatedPromptImagesInVisualOrder(grid)\n        .slice(0, limit)"),
        true,
        'related image warmup should alternate visible rows across both masonry columns'
    );
    assert.equal(
        promptsSource.includes('forceDefer: isMobileLayout,\n            animateEntry: true'),
        true,
        'desktop related mode should explicitly start the shared card entry animation'
    );
    assert.equal(
        promptsSource.includes('if (!isRelatedPromptRenderReady(item)) {\n        scheduleRelatedPromptsRender(item);\n        return;'),
        true,
        'a cold desktop related panel should render through the existing frame scheduler instead of the click frame'
    );
    assert.equal(
        promptsSource.includes('function playRelatedPromptGridEntryAnimation(options = {})')
            && promptsSource.includes('frameDelay: isPromptModalMobileLayout() ? 1 : 2'),
        true,
        'a ready desktop related panel should leave one painted layout frame before starting card entry motion'
    );
    assert.equal(
        /\.related-prompt-card__title\s*\{[\s\S]*opacity:\s*0;[\s\S]*transform:\s*translateY\(6px\);/.test(promptsStyles),
        true,
        'related prompt titles should stay hidden until the card is hovered or focused'
    );
    assert.equal(
        /\.related-prompt-card:hover \.related-prompt-card__title,[\s\S]*\.related-prompt-card:focus-visible \.related-prompt-card__title\s*\{[\s\S]*opacity:\s*1;[\s\S]*transform:\s*translateY\(0\);/.test(promptsStyles),
        true,
        'related prompt titles should fade in on hover or keyboard focus'
    );

    assert.equal(
        (promptsHtml.match(/sourceAttribution=20260619_PROMPT_SOURCE_ATTRIBUTION_16/g) || []).length,
        2,
        'prompts.html should cache-bust both prompt source attribution CSS and runtime'
    );
    assert.equal(
        /@media \(min-width:\s*769px\)\s*\{[\s\S]*?\.modal-content-col\s*\{[\s\S]*?padding-bottom:\s*16px;/.test(promptsStyles),
        true,
        'desktop prompt detail content column should place the prompt card at the same bottom height as the docked comment card'
    );
    assert.equal(
        /\.modal-inner:not\(\.comment-mode\):not\(\.related-mode\) \.prompt-area\s*\{[\s\S]*?margin-left:\s*-24px;[\s\S]*?margin-right:\s*-24px;/.test(promptsStyles),
        true,
        'desktop prompt card should keep equal sixteen pixel insets beside the image and modal edge'
    );
    assert.equal(
        /\.modal-inner\s*\{[\s\S]*?width:\s*86%;[\s\S]*?max-width:\s*940px;/.test(promptsStyles),
        true,
        'desktop prompt detail modal should use the narrower balanced width'
    );
    assert.equal(
        promptsHtml.includes('promptCardSpacing=20260716_PROMPT_CARD_SPACING_1'),
        true,
        'the prompt detail stylesheet should be cache-busted for the balanced card spacing'
    );
    assert.equal(
        promptsHtml.includes('promptModalWidth=20260716_PROMPT_MODAL_WIDTH_1'),
        true,
        'the prompt detail stylesheet should be cache-busted for the narrower modal width'
    );
    assert.equal(
        promptsHtml.includes('promptEqualColumns=20260716_PROMPT_EQUAL_COLUMNS_1'),
        true,
        'the prompt detail stylesheet should be cache-busted for equal desktop columns'
    );
    assert.equal(
        /\.modal-inner\.related-mode \.related-section\s*\{[\s\S]*?padding-left:\s*16px;[\s\S]*?padding-right:\s*16px;/.test(promptsStyles),
        true,
        'desktop same-style content should use the compact horizontal modal inset'
    );
    assert.equal(
        /\.modal-inner\.related-mode \.related-prompt-grid\s*\{[\s\S]*?padding-left:\s*0;[\s\S]*?padding-right:\s*0;/.test(promptsStyles),
        true,
        'desktop same-style image grid should not add a second horizontal inset'
    );
    assert.equal(
        promptsHtml.includes('relatedHorizontalSpacing=20260716_PROMPT_RELATED_HORIZONTAL_SPACING_1'),
        true,
        'the prompt detail stylesheet should be cache-busted for compact same-style spacing'
    );
    assert.equal(
        /\.modal-inner\.comment-mode \.modal-image-col img\s*\{[\s\S]*?transform:\s*translate3d\(-50%, -65%, 0\) scale\(0\.85\);/.test(promptsStyles)
            && promptsStyles.includes('transform 500ms cubic-bezier(0.16, 1, 0.3, 1),')
            && !promptsStyles.includes('top 500ms cubic-bezier(0.16, 1, 0.3, 1),')
            && !promptsStyles.includes('will-change: top, transform, opacity, filter;'),
        true,
        'desktop side-mode zoom should use compositor-only translation with the natural zoom curve'
    );
    assert.equal(
        /\.modal-image-col img\.blur-motion\s*\{[\s\S]*?animation:\s*promptDesktopZoomFocusBlur 500ms linear both;/.test(promptsStyles),
        true,
        'desktop return blur should share the zoom duration instead of trailing it'
    );
    assert.equal(
        /@keyframes promptDesktopZoomFocusBlur\s*\{[\s\S]*?0%\s*\{[\s\S]*?blur\(0\);[\s\S]*?18%\s*\{[\s\S]*?blur\(1px\);[\s\S]*?58%\s*\{[\s\S]*?blur\(0\.25px\);[\s\S]*?78%,[\s\S]*?100%\s*\{[\s\S]*?blur\(0\);/.test(promptsStyles),
        true,
        'desktop return blur should peak early and clear before the zoom settles'
    );
    assert.equal(
        promptsHtml.includes('returnFocusBlur=20260716_PROMPT_RETURN_FOCUS_BLUR_2'),
        true,
        'the prompt detail stylesheet should be cache-busted for the softer return focus blur'
    );
    assert.equal(
        promptsHtml.includes('returnZoomCurve=20260716_PROMPT_RETURN_ZOOM_CURVE_1'),
        true,
        'the prompt detail stylesheet should be cache-busted for the synchronized zoom curve'
    );
    assert.equal(
        promptsHtml.includes('imageTransformMotion=20260716_PROMPT_IMAGE_TRANSFORM_MOTION_1'),
        true,
        'the prompt detail stylesheet should be cache-busted for compositor-only image motion'
    );
    assert.equal(
        promptsStyles.includes('@keyframes promptReturn') || promptsStyles.includes('.prompt-area.returning'),
        false,
        'desktop prompt card return should use the shared compositor-only motion helper'
    );
    assert.equal(
        /\.modal-inner\.comment-mode-returning \.modal-content-col\s*\{[\s\S]*?padding 500ms cubic-bezier\(0\.16, 1, 0\.3, 1\);/.test(promptsStyles),
        true,
        'desktop content column should settle on the shared return timing'
    );
    assert.equal(
        /\.modal-inner\.comment-mode-returning \.prompt-area\s*\{[^}]*max-height 500ms/.test(promptsStyles),
        false,
        'desktop prompt card geometry should settle before its horizontal return motion'
    );
    assert.equal(
        promptsHtml.includes('returnChoreography=20260716_PROMPT_RETURN_CHOREOGRAPHY_1'),
        true,
        'the prompt detail stylesheet should be cache-busted for synchronized return elements'
    );
    assert.equal(
        promptsStyles.includes('@keyframes promptDockIn'),
        false,
        'desktop prompt dock entrance should use the shared compositor-only motion helper'
    );
    assert.equal(
        /\.modal-inner\.related-mode \.related-section\s*\{[\s\S]*?animation:\s*commentsFadeIn 400ms cubic-bezier\(0\.16, 1, 0\.3, 1\) 100ms both;/.test(promptsStyles),
        true,
        'desktop same-style panel entrance should end with the image zoom after a short load-smoothing delay'
    );
    assert.equal(
        promptsSource.includes('const PROMPT_DESKTOP_SIDE_MODE_PROMPT_OFFSET_PX = 24;')
            && promptsSource.includes('const PROMPT_DESKTOP_SIDE_MODE_PROMPT_MOTION_MS = 500;'),
        true,
        'desktop prompt enter and return should use the same compact distance and duration'
    );
    assert.equal(
        (promptsHtml.match(/promptHorizontalMotion=20260716_PROMPT_HORIZONTAL_MOTION_1/g) || []).length,
        2,
        'the prompt script and stylesheet should be cache-busted for symmetric horizontal motion'
    );
    assert.equal(
        promptsSource.includes('isMobileLayout ? 220 : 80'),
        true,
        'desktop related cards should finish their compact stagger inside the shared zoom window'
    );
    assert.equal(
        promptsStyles.includes('animation-duration: calc(400ms - var(--related-card-enter-delay, 0ms));')
            && promptsStyles.includes('animation-delay: calc(100ms + var(--related-card-enter-delay, 0ms));'),
        true,
        'desktop related card stagger should keep every card on the shared five hundred millisecond endpoint'
    );
    assert.equal(
        promptsSource.includes('isMobileLayout ? 820 : 520'),
        true,
        'desktop related card animation state should clear immediately after the shared endpoint'
    );
    assert.equal(
        /\.prompt-dock-target\s*\{[\s\S]*bottom:\s*16px;/.test(promptsStyles),
        true,
        'comment mode docked prompt card should keep its original bottom position'
    );
    assert.equal(
        /\.modal-inner\.comment-mode \.modal-img-thumbs\.is-visible\s*\{[\s\S]*bottom:\s*var\(--modal-img-thumbs-docked-bottom, 188px\);/.test(promptsStyles),
        true,
        'all desktop side-mode thumbnails should lift above the docked prompt card instead of covering actions'
    );
    assert.equal(
        /\.modal-image-col:has\(> img:hover\) \.modal-img-thumbs\.is-visible,[\s\S]*\.modal-img-thumbs\.is-visible:hover,[\s\S]*\.modal-img-thumbs\.is-visible:focus-within\s*\{/.test(promptsStyles),
        true,
        'desktop thumbnail hover target should be narrowed to the image or thumbnails, not the whole left column'
    );
    assert.equal(
        /\.modal-img-thumb-btn > img\s*\{[\s\S]*width:\s*100%;[\s\S]*height:\s*100%;[\s\S]*object-fit:\s*cover;/.test(promptsStyles),
        true,
        'modal image thumbnails should fill their thumbnail button instead of inheriting main image sizing'
    );
    assert.equal(
        /\.modal-image-col \.modal-img-thumbs \.modal-img-thumb-btn > img,[\s\S]*\.modal-inner\.related-mode \.modal-image-col \.modal-img-thumbs \.modal-img-thumb-btn > img,[\s\S]*html\[data-theme="light"\] \.modal-inner\.related-mode \.modal-image-col \.modal-img-thumbs \.modal-img-thumb-btn > img,[\s\S]*html:not\(\[data-theme="dark"\]\) \.modal-inner\.related-mode \.modal-image-col \.modal-img-thumbs \.modal-img-thumb-btn > img\s*\{[\s\S]*position:\s*absolute !important;[\s\S]*inset:\s*0 !important;[\s\S]*top:\s*0 !important;[\s\S]*object-fit:\s*cover !important;[\s\S]*transform:\s*var\(--modal-img-thumb-transform, none\) !important;/.test(promptsStyles),
        true,
        'modal image thumbnail images should have a high-specificity fill rule that wins over main modal image styles'
    );
    assert.equal(
        /\.modal-inner\.related-mode \.modal-image-col > img,[\s\S]*html\[data-theme="light"\] \.modal-inner\.related-mode \.modal-image-col > img,[\s\S]*html:not\(\[data-theme="dark"\]\) \.modal-inner\.related-mode \.modal-image-col > img\s*\{/.test(promptsStyles),
        true,
        'related-mode main image styling should only target direct modal images, not thumbnail images'
    );
    assert.equal(
        promptsSource.includes('function syncModalImageThumbnailPlacement()')
            && /const shouldLiftAboveDockedPrompt = Boolean\(\s*promptArea\?\.classList\.contains\('docked'\)\s*&& promptArea\.parentElement\?\.id === 'promptDockTarget'/.test(promptsSource)
            && promptsSource.includes("--modal-img-thumbs-docked-bottom"),
        true,
        'runtime should measure the docked prompt card height in both comment and related modes'
    );
    assert.equal(
        (promptsHtml.match(/promptDockedThumbs=20260716_PROMPT_DOCKED_THUMBS_1/g) || []).length,
        2,
        'the prompt script and stylesheet should be cache-busted for docked thumbnail placement'
    );
    assert.equal(
        /function getPromptModalThumbnailUrl\(value\)\s*\{\s*return getPromptModalImageUrl\(value\);\s*\}/.test(promptsSource),
        true,
        'prompt detail modal thumbnails should use the original modal image URL instead of potentially stale responsive thumbnail variants'
    );
    assert.equal(
        promptsHtml.includes('modalThumbFill=20260707_PROMPT_MODAL_THUMBS_FILL_3'),
        true,
        'prompts.html should cache-bust the prompt modal thumbnail fill styles'
    );
    assert.equal(
        promptsHtml.includes('modalThumbSource=20260707_PROMPT_MODAL_THUMBS_ORIGINAL_1'),
        true,
        'prompts.html should cache-bust prompt modal thumbnail source selection logic'
    );
    assert.equal(
        (promptsHtml.match(/detailActionBar=20260619_PROMPT_DETAIL_ACTION_BAR_COMPACT_5/g) || []).length,
        1,
        'prompts.html should cache-bust the compact prompt detail action bar stylesheet'
    );
    assert.match(
        promptsHtml,
        /<div class="prompt-content-header">[\s\S]*?<span class="prompt-label"[\s\S]*?<div class="prompt-header-actions">[\s\S]*?id="unlockPromptBtn"[\s\S]*?id="promptHeaderShareSlot"[\s\S]*?<\/div>[\s\S]*?<\/div>[\s\S]*?<div id="modalPromptText"/,
        'prompt modal should place the share action directly right of the unlock/copy action in the prompt title row'
    );
    assert.match(
        promptsHtml,
        /<div class="action-left">[\s\S]*?<div id="promptModalSourceActions" class="prompt-modal-source-actions"/,
        'prompt modal should move favorite and X source actions into the former unlock action slot'
    );
    assert.match(
        promptsHtml,
        /id="relatedTriggerBtn" class="related-trigger-btn"[\s\S]*aria-label="相同风格"[\s\S]*data-tooltip="相同风格"[\s\S]*?<i class="fas fa-diagram-project"><\/i>[\s\S]*?<\/button>/,
        'prompt modal should render a relationship-style same-style prompt icon trigger after the favorite/source/share actions'
    );
    assert.match(
        promptsHtml,
        /id="relatedTriggerBtn"[\s\S]*?<\/button>\s*<span id="promptActionAiImageSlot" class="prompt-action-ai-image-slot"/,
        'prompt modal should place AI image actions directly to the right of the same-style trigger'
    );
    assert.doesNotMatch(
        promptsHtml,
        /id="relatedTriggerBtn"[\s\S]*?<span>(查看相关|相同风格)<\/span>/,
        'same-style prompt trigger should not show visible text in the action bar'
    );
    assert.match(
        promptsHtml,
        /<div id="relatedSection" class="related-section"[\s\S]*?<div id="relatedPromptGrid" class="related-prompt-grid"/,
        'prompt modal should include a related prompt side panel scaffold'
    );
    assert.match(
        promptsHtml,
        /<span class="related-title" data-i18n="gallery\.sameStyleTitle">相同风格<\/span>[\s\S]*<span class="related-subtitle" data-i18n="gallery\.sameStyleSubtitle">同风格作品<\/span>/,
        'same-style side panel should use localized same-style heading copy'
    );
    assert.equal(
        (promptsHtml.match(/relatedPrompts=20260620_RELATED_PROMPTS_SHARE_5/g) || []).length,
        2,
        'prompts.html should cache-bust both related prompt CSS and runtime'
    );
});

test('admin gallery editor and API preserve source attribution fields', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const adminSource = readRepoFile('admin-studio.js');
    const adminStyles = readRepoFile('admin-studio.css');
    const manageHandler = readRepoFile(path.join('server', 'api-handlers', 'admin', 'prompts', 'manage.js'));
    const schemaSql = readRepoFile(path.join('supabase', 'prompts-schema.sql'));
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260619_add_prompt_source_attribution.sql'));
    const rpcSql = readRepoFile(path.join('supabase', 'migrations', '20260503_admin_gallery_manage_list_rpc.sql'));

    const adminHtmlMarkers = [
        'class="gallery-source-panel"',
        'id="promptSourceUrl"',
        'id="promptSourceAuthorName"',
        'id="promptSourceAuthorHandle"',
        'placeholder="https://x.com/username/status/..."'
    ];

    for (const marker of adminHtmlMarkers) {
        assert.equal(adminHtml.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }
    assert.equal(
        adminHtml.includes('promptSourceAuthorAvatarUrl'),
        false,
        'admin-studio.html should not render a source author avatar URL field'
    );
    assert.equal(
        adminHtml.includes('原作者头像 URL'),
        false,
        'admin-studio.html should not show source author avatar copy'
    );

    const adminSourceMarkers = [
        'const PROMPT_SOURCE_ATTRIBUTION_FIELD_KEYS = Object.freeze([',
        "const PROMPT_SOURCE_ATTRIBUTION_SQL_GUIDE = 'supabase/migrations/20260619_add_prompt_source_attribution.sql';",
        'function normalizePromptSourceAuthorHandle(value = \'\')',
        'function populatePromptSourceFields(data = {})',
        'function collectPromptSourceFieldValues()',
        'function resetPromptSourceFields()',
        'function getPromptMissingPersistedSourceAttributionFields(attemptedPayload = {}, savedRow = {})',
        'function isMissingPromptSourceAttributionSchemaCacheError(error = null)',
        'function buildPromptSourceAttributionPersistencePayload(attemptedPayload = {})',
        'async function persistPromptSourceAttributionFieldsViaSupabase(promptId = \'\', attemptedPayload = {})',
        'async function verifyPromptPersistedSourceAttributionFields(promptId = \'\', attemptedPayload = {}, savedRow = {})',
        'function buildPromptSourceAttributionPersistenceWarningMessage(missingFields = [])',
        'const sourceValues = collectPromptSourceFieldValues();',
        '...sourceValues',
        'sourceAttributionPersistenceState = await verifyPromptPersistedSourceAttributionFields(savedPromptId, promptPayload, savedRow);',
        'const sourceAttributionPersistenceWarning = buildPromptSourceAttributionPersistenceWarningMessage(',
        'resetPromptSourceFields();'
    ];

    for (const marker of adminSourceMarkers) {
        assert.equal(adminSource.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    for (const field of SOURCE_FIELDS) {
        assert.equal(adminSource.includes(`'${field}'`), true, `admin-studio.js should include ${field}`);
        assert.equal(manageHandler.includes(`'${field}'`), true, `manage handler should include ${field}`);
        assert.equal(schemaSql.includes(`${field} TEXT`), true, `prompt schema should include ${field}`);
        assert.equal(migrationSql.includes(`ADD COLUMN IF NOT EXISTS ${field} TEXT`), true, `source migration should add ${field}`);
        assert.equal(rpcSql.includes(`'${field}', coalesce(page_rows.${field}, '')`), true, `gallery manage RPC should return ${field}`);
    }

    const manageSourceMarkers = [
        'const PROMPT_SOURCE_ATTRIBUTION_FIELD_KEYS = [',
        'Prompt 引用原作者字段尚未被 API schema cache 识别'
    ];

    for (const marker of manageSourceMarkers) {
        assert.equal(manageHandler.includes(marker), true, `manage handler should contain ${marker}`);
    }

    const adminStyleMarkers = [
        '.gallery-source-panel',
        '.gallery-source-grid',
        '.gallery-source-x-mark'
    ];

    for (const marker of adminStyleMarkers) {
        assert.equal(adminStyles.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    assert.equal(
        (adminHtml.match(/sourceAttribution=20260619_PROMPT_SOURCE_ATTRIBUTION_16/g) || []).length,
        3,
        'admin-studio.html should cache-bust prompt source attribution CSS and runtime assets'
    );
});
