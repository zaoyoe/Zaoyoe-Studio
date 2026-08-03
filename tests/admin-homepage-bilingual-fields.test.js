const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const homepageShared = require('../server/api-handlers/admin/homepage/_shared');
const homepageContractPath = path.resolve(__dirname, '../js/homepage-contract.js');
const adminHomepagePath = path.resolve(__dirname, '../admin-homepage.js');
const framerHomePath = path.resolve(__dirname, '../js/framer_home.js');
const prefetchHomePath = path.resolve(__dirname, '../js/prefetch-home.js');
const promptsPoetryPath = path.resolve(__dirname, '../prompts-poetry.js');
const shopClientPath = path.resolve(__dirname, '../js/shop-client.js');

function loadBrowserHomepageContract() {
    const source = fs.readFileSync(homepageContractPath, 'utf8');
    const sandbox = { window: {}, URL };
    vm.runInNewContext(source, sandbox, { filename: homepageContractPath });
    return sandbox.window.HomepageContract;
}

test('homepage shared normalizer preserves hero bilingual fields for health checks', () => {
    const row = homepageShared.buildHomepageRowRecord({
        site: 'cn',
        section: 'hero',
        is_visible: true,
        display_order: 1,
        content: {
            title: '早鸟工作室',
            title_zh: '早鸟工作室',
            title_en: 'Zaoyoe Studio',
            subtitle: '创意 · 效率 · 无限可能',
            subtitle_zh: '创意 · 效率 · 无限可能',
            subtitle_en: 'Creativity, efficiency, infinite possibilities'
        }
    });

    assert.equal(row.content.title_zh, '早鸟工作室');
    assert.equal(row.content.title_en, 'Zaoyoe Studio');
    assert.equal(row.content.subtitle_en, 'Creativity, efficiency, infinite possibilities');

    const result = homepageShared.validateHomepageRow('hero', row);
    assert.equal(result.warnings.includes('Hero 标题未补齐双语字段'), false);
});

test('homepage browser contract preserves localized section title pairs', () => {
    const contract = loadBrowserHomepageContract();

    const content = contract.normalizeContent('prompts', {
        section_title: '提示词图库',
        section_title_zh: '提示词图库',
        section_title_en: 'Prompt Gallery',
        section_subtitle: '中文灵感池',
        section_subtitle_zh: '中文灵感池',
        section_subtitle_en: 'A pool of ideas'
    });

    assert.equal(content.section_title_zh, '提示词图库');
    assert.equal(content.section_title_en, 'Prompt Gallery');
    assert.equal(content.section_subtitle_en, 'A pool of ideas');

    const guestbook = contract.normalizeContent('guestbook', {
        section_title: '留言板',
        fallback_items: [{
            content: '中文兜底',
            content_en: 'English fallback',
            author: '早鸟社区',
            author_en: 'Zaoyoe Community'
        }]
    });
    assert.equal(guestbook.fallback_items[0].content_en, 'English fallback');
    assert.equal(guestbook.fallback_items[0].author_en, 'Zaoyoe Community');

    const verify = contract.normalizeContent('verify', {
        section_title: 'Google One',
        section_title_zh: 'Gemini Pro',
        section_title_en: 'Gemini Pro'
    });
    assert.equal(verify.section_title, 'Gemini Pro');
    assert.equal(verify.section_title_en, 'Gemini Pro');
});

test('homepage normalizers rewrite legacy API relay links to the NewAPI domain', () => {
    const contract = loadBrowserHomepageContract();
    const browserHero = contract.normalizeContent('hero', {
        entries: [
            { id: 'gongyi', text: 'API中转', link: 'https://gongyi.zaoyoe.com' }
        ],
        cta: {
            primary: { text: 'API中转', link: 'https://sub2api.fatherkey.com' },
            secondary: { text: 'Console', link: 'https://www.gongyi.zaoyoe.com/dashboard?tab=keys#top' }
        }
    });
    const browserGongyi = contract.normalizeContent('gongyi', {
        cta_link: 'https://sub2api.fatherkey.com'
    });
    const sharedHero = homepageShared.normalizeHomepageContent('hero', {
        entries: [
            { id: 'gongyi', text: 'API中转', link: 'https://sub2api.fatherkey.com' }
        ]
    });
    const sharedGongyi = homepageShared.normalizeHomepageContent('gongyi', {
        cta_link: 'https://www.gongyi.zaoyoe.com/dashboard'
    });

    assert.equal(browserHero.entries[0].link, 'https://new.fatherkey.com');
    assert.equal(browserHero.cta.primary.link, 'https://new.fatherkey.com');
    assert.equal(browserHero.cta.secondary.link, 'https://new.fatherkey.com/dashboard?tab=keys#top');
    assert.equal(browserGongyi.cta_link, 'https://new.fatherkey.com');
    assert.equal(sharedHero.entries[0].link, 'https://new.fatherkey.com');
    assert.equal(sharedGongyi.cta_link, 'https://new.fatherkey.com/dashboard');
});

test('homepage admin save path seeds the current site localized fallback', () => {
    const source = fs.readFileSync(adminHomepagePath, 'utf8');

    assert.match(source, /hero:\s*\['title', 'subtitle'\]/);
    assert.match(source, /gongyi:\s*\[[\s\S]*'brand_name'[\s\S]*'brand_subtitle'/);
    assert.match(source, /function ensureHomepageSectionLocalizedFallbacks\(section, content, site\)/);
    assert.match(source, /ensureHomepageLocalizedListFallbacks\(content\.fallback_items, \['content', 'author'\], site\)/);
    assert.match(source, /ensureHomepageSectionLocalizedFallbacks\(section, content, writableSite\);/);
});

test('homepage hero runtime avoids Chinese title fallback in English language mode', () => {
    const framerSource = fs.readFileSync(framerHomePath, 'utf8');
    const prefetchSource = fs.readFileSync(prefetchHomePath, 'utf8');

    assert.match(framerSource, /function resolveHomepageLocalizedText\(value, i18nKey, fallbackByLanguage = \{\}\)/);
    assert.match(framerSource, /function resolveHomepageLocalizedTextList\(value, fallbackItems = \[\]\)/);
    assert.match(framerSource, /function resolveHomepageHeroText\(value, i18nKey, fallbackByLanguage = \{\}\)/);
    assert.match(framerSource, /getHomepageRuntimeLanguage\(\) === 'en' && containsHomeCjkText\(normalized\)/);
    assert.match(framerSource, /currentLang === 'zh'[\s\S]*!containsHomeCjkText\(normalized\)[\s\S]*containsHomeCjkText\(fallback\)/);
    assert.match(framerSource, /currentLang === 'zh'[\s\S]*normalized\.every\(\(item\) => !containsHomeCjkText\(item\)\)[\s\S]*fallbackList\.some\(\(item\) => containsHomeCjkText\(item\)\)/);
    assert.match(framerSource, /text: resolveHomepageLocalizedText\(entryText, entryFallback\.i18nKey/);
    assert.match(framerSource, /brandName: resolveHomepageGongyiBrandName\(this\.getLocalizedField\(config, 'brand_name'\) \|\| config\.brand_name\)/);
    assert.match(framerSource, /if \(!text \|\| legacyLabels\.has\(text\)\) \{[\s\S]*return fallback;[\s\S]*if \(getHomepageRuntimeLanguage\(\) === 'en' && containsHomeCjkText\(text\)\) \{[\s\S]*return fallback;/);
    assert.match(framerSource, /resolveHomepageLocalizedText\(normalizeHomepageVerifyProductLabel\(this\.getLocalizedField\(config, 'section_title'\)\), 'home\.verify\.title'/);
    assert.match(framerSource, /this\.cachedData\.gongyi = this\.buildGongyiData\(this\.config\.gongyi \|\| \{\}\);/);
    assert.match(framerSource, /features: resolveHomepageLocalizedTextList\(config\.features, defaultFeatures\)/);
    assert.match(framerSource, /ctaText: resolveHomepageLocalizedText\(experimentCtaText \|\| config\.cta_text, 'home\.verify\.cta'/);
    assert.match(framerSource, /function getHomepageGongyiModelLabelFallback\(item = \{\}\)/);
    assert.match(framerSource, /'更多': \{ zh: '更多', en: 'More' \}/);
    assert.match(framerSource, /const label = resolveHomepageDataText\(rawLabel, getHomepageGongyiModelLabelFallback\(item\)\)/);
    assert.match(framerSource, /en: 'Supported AI Models'/);
    assert.match(framerSource, /emailLabel: copy\('verify\.emailLabel', \{ zh: 'Gmail 地址', en: 'Gmail Address' \}\)/);
    assert.match(framerSource, /submitTask: copy\(\{ zh: '提交任务', en: 'Submit Task' \}\)/);
    assert.match(framerSource, /language: getHomepageRuntimeLanguage\(\)/);
    assert.match(framerSource, /HOMEPAGE_HERO_TEXT_CACHE_VERSION/);

    assert.match(prefetchSource, /function resolveLocalizedText\(value, i18nKey, fallbackByLanguage = \{\}\)/);
    assert.match(prefetchSource, /function resolveLocalizedTextList\(value, fallbackItems = \[\]\)/);
    assert.match(prefetchSource, /function resolveHeroText\(value, i18nKey, fallbackByLanguage = \{\}\)/);
    assert.match(prefetchSource, /getCurrentLanguage\(\) === 'en' && containsCjkText\(normalized\)/);
    assert.match(prefetchSource, /currentLang === 'zh'[\s\S]*!containsCjkText\(normalized\)[\s\S]*containsCjkText\(fallback\)/);
    assert.match(prefetchSource, /currentLang === 'zh'[\s\S]*normalized\.every\(\(item\) => !containsCjkText\(item\)\)[\s\S]*fallbackList\.some\(\(item\) => containsCjkText\(item\)\)/);
    assert.match(prefetchSource, /text: resolveLocalizedText\(entryText, entryFallback\.i18nKey/);
    assert.match(prefetchSource, /brandName: resolveGongyiBrandName\(getLocalizedField\(config, 'brand_name'\) \|\| config\.brand_name\)/);
    assert.match(prefetchSource, /if \(!text \|\| legacyLabels\.has\(text\)\) \{[\s\S]*return fallback;[\s\S]*if \(getCurrentLanguage\(\) === 'en' && containsCjkText\(text\)\) \{[\s\S]*return fallback;/);
    assert.match(prefetchSource, /resolveLocalizedText\(normalizeVerifyProductLabel\(getLocalizedField\(config, 'section_title'\)\), 'home\.verify\.title'/);
    assert.match(prefetchSource, /features: resolveLocalizedTextList\(config\.features, defaultFeatures\)/);
    assert.match(prefetchSource, /ctaText: resolveLocalizedText\(experimentCtaText \|\| config\.cta_text, 'home\.verify\.cta'/);
    assert.match(prefetchSource, /function getGongyiModelLabelFallback\(item = \{\}\)/);
    assert.match(prefetchSource, /'更多': \{ zh: '更多', en: 'More' \}/);
    assert.match(prefetchSource, /const label = resolveDataText\(rawLabel, getGongyiModelLabelFallback\(item\)\)/);
    assert.match(prefetchSource, /data\?\.language && data\.language !== getCurrentLanguage\(\)/);
    assert.match(prefetchSource, /language: getCurrentLanguage\(\)/);
});

test('public pages localize static seo metadata and hidden headings', () => {
    const htmlExpectations = [
        ['index.html', 'seo.index'],
        ['prompts.html', 'seo.prompts'],
        ['shop.html', 'seo.shop'],
        ['verify.html', 'seo.verify'],
        ['guestbook.html', 'seo.guestbook']
    ];

    htmlExpectations.forEach(([file, key]) => {
        const source = fs.readFileSync(path.resolve(__dirname, `../${file}`), 'utf8');
        assert.match(source, new RegExp(`data-i18n="${key}\\.title"`));
        assert.match(source, new RegExp(`data-i18n="${key}\\.description" data-i18n-attr="content"`));
        assert.match(source, new RegExp(`class="visually-hidden-h1" data-i18n="${key}\\.h1"`));
    });

    const en = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../lang/en.json'), 'utf8'));
    const zh = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../lang/zh.json'), 'utf8'));
    assert.equal(en.seo.index.title, 'Zaoyoe Studio - Creativity, Efficiency, Endless Possibilities');
    assert.equal(zh.seo.index.title, '早鸟工作室 - 创意·效率·无限可能');
});

test('public runtime blocks Chinese business-data fallbacks in English language mode', () => {
    const framerSource = fs.readFileSync(framerHomePath, 'utf8');
    const prefetchSource = fs.readFileSync(prefetchHomePath, 'utf8');
    const promptsSource = fs.readFileSync(promptsPoetryPath, 'utf8');
    const shopSource = fs.readFileSync(shopClientPath, 'utf8');

    assert.match(framerSource, /function resolveHomepageDataText\(value, fallbackByLanguage = \{\}\)/);
    assert.match(framerSource, /getHomepageRuntimeLanguage\(\) === 'en' && containsHomeCjkText\(normalized\)/);
    assert.match(framerSource, /const promptTitle = getHomepageLocalizedDataField\(prompt, 'title'/);
    assert.match(framerSource, /const productName = getHomepageLocalizedDataField\(product, 'name'/);
    assert.match(framerSource, /function getHomepageProductCategoryLabel\(category\)/);
    assert.match(framerSource, /'API中转': 'API Relay'/);
    assert.match(framerSource, /sanitizeTickerItems\(config\.product_categories, \{ allowCjk: true \}\)/);
    assert.match(framerSource, /filterHomepageDataTextList\(langTags\)\.forEach/);
    assert.match(framerSource, /getHomepageRuntimeLanguage\(\) !== 'en' \|\| Boolean\(getHomepageLocalizedDataField\(item, 'content'/);

    assert.match(prefetchSource, /function resolveDataText\(value, fallbackByLanguage = \{\}\)/);
    assert.match(prefetchSource, /getCurrentLanguage\(\) === 'en' && containsCjkText\(normalized\)/);
    assert.match(prefetchSource, /sanitizeTickerItems\(config\.product_categories, \{ allowCjk: true \}\)/);
    assert.match(prefetchSource, /getCurrentLanguage\(\) !== 'en' \|\| Boolean\(getLocalizedDataField\(item, 'content'/);

    assert.match(promptsSource, /function resolvePromptLocalizedDataText\(value, field\)/);
    assert.match(promptsSource, /lang !== 'en' && item\[otherLangKey\]/);

    assert.match(shopSource, /resolveShopDataText: function \(value, fallback = ''\)/);
    assert.match(shopSource, /this\.isEnglishShopLocale\(\) && this\.containsCjkText\(normalized\)/);
    assert.match(shopSource, /getProductCategoryLabelMap: function \(\) \{/);
    assert.match(shopSource, /virtualCard:\s*\{[\s\S]*zh:\s*'虚拟卡'[\s\S]*en:\s*'Virtual Card'/);
    assert.match(shopSource, /const translationKey = this\.getProductCategoryTranslationKey\(category\)/);
    assert.doesNotMatch(shopSource, /containsCjkText\(cat\?\.name\)/);
    assert.match(shopSource, /const displayName = this\.getLocalizedProductName\(product\)/);
});
