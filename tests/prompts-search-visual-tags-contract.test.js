const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('prompts search uses visual ai tags across the full gallery dataset', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsHtml = readRepoFile('prompts.html');

    const requiredMarkers = [
        'function normalizePromptSearchText(value = \'\')',
        'function hasPromptSearchSignal(value = \'\')',
        'function collectPromptSearchValues(value, output = [])',
        'function getPromptSearchHaystack(item = {})',
        "const PROMPT_SEARCH_CONTROLLED_SINGLE_CJK_TERMS = new Set(['枪', '蛇']);",
        'function isPromptSearchSingleCjkTerm(value = \'\')',
        'function isPromptSearchControlledSingleCjkTerm(value = \'\')',
        'function shouldPromptSearchUsePartialIndexTerm(term = \'\')',
        'function shouldPromptSearchUseBodyTerm(term = \'\')',
        'function shouldPromptSearchUseAiFallback(term = \'\')',
        'function shouldPromptSearchHydrateDetails(term = \'\')',
        'function promptSearchCjkFuzzyMatches(haystack = \'\', term = \'\')',
        'function promptSearchHaystackMatchesTerm(haystack = \'\', term = \'\')',
        'function invalidatePromptSearchCaches()',
        'let PROMPT_SEARCH_REQUEST_ID = 0;',
        'const searchRequestId = ++PROMPT_SEARCH_REQUEST_ID;',
        'function isPromptSearchRequestCurrent(searchRequestId, normalizedQuery = \'\')',
        'const PROMPTS_SUPABASE_SEARCH_DETAIL_SELECT = [',
        'async function hydratePromptSearchDetails()',
        '.select(PROMPTS_SUPABASE_SEARCH_DETAIL_SELECT)',
        'void refinePromptSearchWithDetails(normalizedQuery, searchingForColor, localResults, searchRequestId);',
        'await refinePromptSearchWithDetails(normalizedQuery, searchingForColor, localResults, searchRequestId);',
        'if (!isPromptSearchRequestCurrent(searchRequestId, normalizedQuery))',
        'const isSingleCjkQuery = isPromptSearchSingleCjkTerm(q);',
        '? allTerms.includes(q)',
        'const searchableBodyTerms = expandedTerms.filter(shouldPromptSearchUseBodyTerm);',
        'const combinedResults = new Set(baseResults);',
        "'snake': ['serpent', 'cobra', 'viper', 'python', 'reptile', '蛇'",
        "'gun': ['枪', '枪械', '火器', '手枪', '步枪', '机枪', '狙击枪', '机械枪', 'rifle', 'pistol', 'firearm']",
        "'裙子': ['连衣裙', '半身裙', '长裙', '短裙', '公主裙', '礼服裙', '洛丽塔裙']",
        "'water': ['水', '水面', '水流', '水滴', '水下', '水花', '水波', '海水', '河流', '溪流', '湖泊', '瀑布', '雨水']",
        'if (!shouldPromptSearchUseAiFallback(normalizedQuery))',
        'if (!shouldPromptSearchHydrateDetails(normalizedQuery))',
        ".replace(/[氣気]/g, '气')",
        ".replace(/の/g, '之')",
        'invalidatePromptSearchCaches();\n    return visiblePrompts;',
        'currentFilter = \'search\';',
        'allFilteredItems = PROMPTS.filter((item, index) => {',
        'renderCurrentPage();',
        'aiTags: p.aiTags || p.ai_tags'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(promptsSource.includes(marker), true, `prompts-poetry.js should contain ${marker}`);
    }

    const dressSynonymMatch = promptsSource.match(/'裙子': \[([^\]]+)\]/);
    assert.ok(dressSynonymMatch, 'prompts-poetry.js should define a dedicated 裙子 synonym list');
    const dressSynonyms = Array.from(dressSynonymMatch[1].matchAll(/'([^']+)'/g), (match) => match[1]);
    const broadDressTerms = [
        'skirt',
        'dress',
        'gown',
        'one piece dress',
        'lolita dress',
        'princess dress',
        '服装',
        '衣服',
        '穿搭',
        'clothing',
        'clothes',
        'outfit',
        'apparel',
        '礼服',
        '洛丽塔'
    ];
    for (const broadTerm of broadDressTerms) {
        assert.equal(dressSynonyms.includes(broadTerm), false, `裙子 search should not expand to broad clothing synonym ${broadTerm}`);
    }

    const waterSynonymMatch = promptsSource.match(/'water': \[([^\]]+)\]/);
    assert.ok(waterSynonymMatch, 'prompts-poetry.js should define a dedicated water synonym list');
    const waterSynonyms = Array.from(waterSynonymMatch[1].matchAll(/'([^']+)'/g), (match) => match[1]);
    for (const broadWaterTerm of ['水彩', '水墨', '水感', '涉水']) {
        assert.equal(waterSynonyms.includes(broadWaterTerm), false, `水 search should not expand to broad style/body synonym ${broadWaterTerm}`);
    }

    const gunSynonymMatch = promptsSource.match(/'gun': \[([^\]]+)\]/);
    assert.ok(gunSynonymMatch, 'prompts-poetry.js should define a dedicated gun synonym list');
    const gunSynonyms = Array.from(gunSynonymMatch[1].matchAll(/'([^']+)'/g), (match) => match[1]);
    for (const requiredGunTerm of ['枪', '枪械', '机械枪', 'rifle', 'pistol', 'firearm']) {
        assert.equal(gunSynonyms.includes(requiredGunTerm), true, `枪 search should expand to precise weapon synonym ${requiredGunTerm}`);
    }

    assert.equal(
        promptsHtml.includes('prompts-poetry.js?v=20260504_ENGAGEMENT_REPLY_NOTIFY_1&promptLangSignal=20260503_PROMPT_LANG_SIGNAL_1'),
        true,
        'prompts.html should cache-bust the visual-tag search runtime'
    );
});

test('prompts search allows one missing Chinese character for long ordered terms only', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');

    assert.equal(
        promptsSource.includes('if (termChars.length < 4) return false;'),
        true,
        'short Chinese terms should not use fuzzy character matching'
    );
    assert.equal(
        promptsSource.includes('const requiredCount = Math.max(3, termChars.length - 1);'),
        true,
        'long Chinese terms should require all but one character to match'
    );
    assert.equal(
        promptsSource.includes('const compactHaystack = haystackChars.join(\'\');') &&
            promptsSource.includes('const omittedChars = termChars.filter((_, index) => index !== omittedIndex);'),
        true,
        'Chinese fuzzy matching should require the remaining characters to be close together'
    );
    assert.equal(
        promptsSource.includes('return normalizedHaystack.includes(normalizedTerm)') &&
            promptsSource.includes('|| promptSearchCjkFuzzyMatches(normalizedHaystack, normalizedTerm);'),
        true,
        'Chinese haystack matching should try exact substring before fuzzy fallback'
    );

    const helperStart = promptsSource.indexOf('function normalizePromptSearchText');
    const helperEnd = promptsSource.indexOf('function pushUniquePromptTag');
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'test should locate search helpers');
    const expandStart = promptsSource.indexOf('function expandSynonyms');
    const expandEnd = promptsSource.indexOf('// Layer 1 & 2: Local search', expandStart);
    assert.ok(expandStart >= 0 && expandEnd > expandStart, 'test should locate synonym expansion helper');

    const sandbox = {};
    vm.runInNewContext(`
        ${promptsSource.slice(helperStart, helperEnd)}
        const SYNONYM_DICTIONARY = {
            landscape: ['scenery', 'nature', '风景', '山水'],
            water: ['水', '水面', 'water'],
            gun: ['枪', '枪械', '机械枪', 'rifle']
        };
        ${promptsSource.slice(expandStart, expandEnd)}
        this.promptSearchCjkFuzzyMatches = promptSearchCjkFuzzyMatches;
        this.promptSearchHaystackMatchesTerm = promptSearchHaystackMatchesTerm;
        this.expandSynonyms = expandSynonyms;
        this.isPromptSearchControlledSingleCjkTerm = isPromptSearchControlledSingleCjkTerm;
        this.shouldPromptSearchUsePartialIndexTerm = shouldPromptSearchUsePartialIndexTerm;
        this.shouldPromptSearchUseBodyTerm = shouldPromptSearchUseBodyTerm;
        this.shouldPromptSearchUseAiFallback = shouldPromptSearchUseAiFallback;
        this.shouldPromptSearchHydrateDetails = shouldPromptSearchHydrateDetails;
    `, sandbox);

    assert.equal(
        sandbox.promptSearchCjkFuzzyMatches('顶部正中大型优雅发光中文标题「天气の子」', '天气之子'),
        true,
        '天气之子 should still match the near-contiguous 天气の子 title'
    );
    assert.equal(
        sandbox.promptSearchCjkFuzzyMatches('梦幻水感角色设定，整体气质安静，年轻女孩子', '天气之子'),
        false,
        '天气之子 should not match unrelated prompts where 天气子 only appear as scattered characters'
    );
    assert.equal(
        sandbox.promptSearchHaystackMatchesTerm('顶部正中大型优雅发光标题「天気の子」', '天气之子'),
        true,
        '天气之子 should match Japanese 天気の子 spelling'
    );
    assert.equal(
        sandbox.expandSynonyms('水').includes('landscape'),
        false,
        'single-character 水 should not expand through 山水 into landscape'
    );
    assert.equal(
        sandbox.shouldPromptSearchUsePartialIndexTerm('水'),
        false,
        'single-character Chinese searches should not use broad partial index matching'
    );
    assert.equal(
        sandbox.shouldPromptSearchUseBodyTerm('水'),
        false,
        'single-character Chinese searches should not scan long prompt bodies'
    );
    assert.equal(
        sandbox.shouldPromptSearchUseBodyTerm('水面'),
        true,
        'specific multi-character Chinese searches can still scan prompt bodies'
    );
    assert.equal(
        sandbox.shouldPromptSearchUseAiFallback('水'),
        false,
        'single-character Chinese searches should not fall back to open-ended AI search'
    );
    assert.equal(
        sandbox.shouldPromptSearchHydrateDetails('水'),
        false,
        'single-character Chinese searches should not trigger async detail refresh'
    );
    assert.equal(
        sandbox.isPromptSearchControlledSingleCjkTerm('枪'),
        true,
        '枪 should be treated as a controlled single-character object query'
    );
    assert.equal(
        sandbox.expandSynonyms('枪').includes('机械枪'),
        true,
        '枪 should expand to precise gun synonyms'
    );
    assert.equal(
        sandbox.shouldPromptSearchUseBodyTerm('枪'),
        true,
        '枪 should scan hydrated prompt bodies'
    );
    assert.equal(
        sandbox.shouldPromptSearchHydrateDetails('枪'),
        true,
        '枪 should trigger detail hydration so body-only matches can appear'
    );
    assert.equal(
        sandbox.shouldPromptSearchUseAiFallback('枪'),
        false,
        '枪 should not fall back to open-ended AI search'
    );
    assert.equal(
        sandbox.promptSearchHaystackMatchesTerm('废土少女手持巨大机械枪，站在荒原中央', '枪'),
        true,
        '枪 should match prompt bodies that mention 机械枪'
    );
});
