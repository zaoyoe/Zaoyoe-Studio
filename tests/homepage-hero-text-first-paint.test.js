const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { gzipSync } = require('node:zlib');

const root = path.resolve(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'js/framer_home.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'js/home-hero-text-preload.js'), 'utf8');
const schemaVersion = '20260508_HOME_TEXT_BILINGUAL_RUNTIME_1';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
function extract(start, end) {
    const from = runtime.indexOf(start);
    assert.ok(from >= 0, start);
    const to = runtime.indexOf(end, from);
    assert.ok(to >= 0, end);
    return runtime.slice(from, to + end.length);
}
function storedHero(overrides = {}) {
    return { schemaVersion, source: 'homepage-config', site: 'cn', language: 'zh',
        title: '飞鸟 AI', subtitle: '自定义副标题', timestamp: Date.now(), configUpdatedAt: 0, ...overrides };
}
function environment({ cache, language = 'zh', site = 'cn', hostname = 'localhost', search = '', updatedAt = 0, blocked = false, prefetch = null } = {}) {
    const stored = new Map();
    const local = new Map([[`homepage_config_last_updated_at_${site}`, String(updatedAt)]]);
    if (cache !== undefined) stored.set('homepage_hero_text', typeof cache === 'string' ? cache : JSON.stringify(cache));
    const storage = map => ({
        getItem(key) { if (blocked) throw Error('Storage blocked'); return map.get(key) ?? null; },
        setItem(key, value) { if (blocked) throw Error('Storage blocked'); map.set(key, String(value)); },
        removeItem(key) { if (blocked) throw Error('Storage blocked'); map.delete(key); }
    });
    const element = text => ({ textContent: text, pending: true,
        removeAttribute(name) { if (name === 'data-home-hero-text-pending') this.pending = false; }
    });
    const title = element('早鸟');
    const subtitle = element('创意 · 效率 · 无限可能');
    const section = { querySelector: selector => selector === '.hero-title' ? title : subtitle };
    const window = { __i18nBoot: { language }, SiteConfig: { site }, location: { hostname, search } };
    const context = vm.createContext({
        window, URLSearchParams, sessionStorage: storage(stored), localStorage: storage(local),
        document: { documentElement: { lang: language }, getElementById: () => section },
        console: { log() {}, warn() {}, error() {} },
        HomepageContract: null, HOMEPAGE_HERO_TEXT_CACHE_VERSION: schemaVersion,
        HOME_DEFAULT_SECTION_ORDER: ['hero', 'prompts', 'shop', 'gongyi', 'verify', 'guestbook', 'ticker'],
        getHomepageConfigLastUpdatedAt: () => updatedAt,
        getHomepagePromptPoolLastUpdatedKey: () => `homepage_prompt_pool_last_updated_at_${site}`,
        getHomepageSiteGongyiOrigin: () => 'https://new.fatherkey.com',
        readHomepagePrefetchCache: () => prefetch,
        clearHomepagePrefetchCache() { prefetch = null; },
        filterHomeVisiblePrompts: items => items,
        writeHomepagePrefetchCache: value => { prefetch = value; }
    });
    const functions = ['getHomepageRuntimeSite', 'getHomepageRuntimeLanguage', 'containsHomeCjkText',
        'getHomepageLanguageFallback', 'getHomepageStrictLanguageFallback', 'resolveHomepageLocalizedText', 'resolveHomepageHeroText'];
    for (const name of functions) vm.runInContext(extract(`function ${name}(`, '\n}'), context);
    const methods = ['readHeroTextCache', 'writeHeroTextCache', 'persistHomepagePrefetch', 'buildHeroData',
        'getLocalizedField', 'renderHeroText', 'useFallbackData', 'loadAll'];
    vm.runInContext(`var home = { ${methods.map(name => extract(`  ${name === 'loadAll' ? 'async ' : ''}${name}(`, '\n  },')).join('\n')} };`, context);
    const config = deferred();
    const prompts = deferred();
    const home = context.home;
    Object.assign(home, {
        heroConfigReady: false, buildDefaultHeroEntries: () => [], ensureGongyiHeroEntry: entries => entries,
        getSectionExperimentValue: () => '', resetActiveExperiments() {}, resolveSectionExperiments() {},
        schedulePromptPoolLiveSync() {}, buildGongyiData: () => ({}), buildVerifyData: () => ({}),
        fetchHomepageConfig: () => config.promise, fetchVisiblePromptPool: () => prompts.promise,
        hydrateConfiguredPromptPool: async (_config, pool) => pool, aggregatePrompts: async () => []
    });
    return { context, window, title, subtitle, home, config, prompts, stored,
        preload() { vm.runInContext(preload, context); }, getPrefetch: () => prefetch };
}

test('fresh configured Hero text is visible synchronously on a warm refresh', () => {
    const env = environment({ cache: storedHero() });
    env.preload();
    assert.equal(env.title.textContent, '飞鸟 AI');
    assert.equal(env.subtitle.textContent, '自定义副标题');
    assert.equal(env.title.pending, false);
    assert.equal(env.subtitle.pending, false);
    assert.equal(env.home.readHeroTextCache().title, '飞鸟 AI');
});

test('cold, corrupt, blocked, stale and default-only caches never expose the static default', () => {
    const now = Date.now();
    for (const options of [ {}, { cache: '{bad-json' }, { blocked: true, cache: storedHero() },
        { cache: storedHero({ timestamp: now - 300001 }) }, { cache: storedHero({ timestamp: now + 60000 }) },
        { cache: storedHero({ timestamp: 'invalid' }) }, { cache: storedHero({ source: undefined }) },
        { cache: storedHero({ title: {} }) }, { cache: storedHero({ title: '  ' }) },
        { updatedAt: now, cache: storedHero({ timestamp: now - 1000 }) },
        { updatedAt: now - 500, cache: storedHero({ timestamp: now, configUpdatedAt: now - 1000 }) }
    ]) {
        const env = environment(options);
        env.preload();
        assert.equal(env.title.pending, true, JSON.stringify(options));
        assert.equal(env.home.readHeroTextCache(), null, JSON.stringify(options));
    }
});

test('Hero first-paint cache stays isolated by site and language', () => {
    for (const options of [ { site: 'intl', search: '?site=intl' }, { language: 'en' },
        { site: 'intl', hostname: 'www.zaoyoe.xyz' } ]) {
        const env = environment({ ...options, cache: storedHero() });
        env.preload();
        assert.equal(env.title.pending, true);
        assert.equal(env.home.readHeroTextCache(), null);
    }
    const english = environment({ site: 'intl', search: '?site=intl', language: 'en',
        cache: storedHero({ site: 'intl', language: 'en', title: 'Flying Bird AI', subtitle: 'Create freely' }) });
    english.preload();
    assert.equal(english.title.textContent, 'Flying Bird AI');
    assert.equal(english.title.pending, false);
    const invalidEnglish = environment({ language: 'en', cache: storedHero({ language: 'en' }) });
    invalidEnglish.preload();
    assert.equal(invalidEnglish.title.pending, true);
});

test('config renders the title immediately while prompts and full translations remain pending', async () => {
    const env = environment();
    const localization = deferred();
    env.preload();
    const loaded = env.home.loadAll({ localizationReady: localization.promise });
    assert.equal(env.title.pending, true);
    env.config.resolve({ hero: { title: '飞鸟 AI', subtitle: '新副标题' }, prompts: {} });
    await tick();
    assert.equal(env.title.textContent, '飞鸟 AI');
    assert.equal(env.title.pending, false);
    assert.equal(env.subtitle.textContent, '新副标题');
    assert.equal(JSON.parse(env.stored.get('homepage_hero_text')).source, 'homepage-config');
    env.prompts.resolve([]);
    localization.resolve();
    await loaded;
    assert.equal(env.home.cachedData.hero.title, '飞鸟 AI');
});

test('English config fields work before the full i18n runtime is ready', async () => {
    const env = environment({ language: 'en' });
    const loaded = env.home.loadAll();
    env.config.resolve({ hero: { title: '飞鸟 AI', title_en: 'Flying Bird AI', subtitle_en: 'Create freely' }, prompts: {} });
    env.prompts.resolve([]);
    await loaded;
    assert.equal(env.title.textContent, 'Flying Bird AI');
    assert.equal(env.subtitle.textContent, 'Create freely');
    assert.equal(JSON.parse(env.stored.get('homepage_hero_text')).language, 'en');
});

test('prompt failure before or after config arrives retains the configured Hero', async () => {
    for (const promptFailsFirst of [true, false]) {
        const env = environment();
        const loaded = env.home.loadAll();
        const config = { hero: { title: '飞鸟 AI', subtitle: '已保存配置' }, shop: { section_title: '自定义商城' } };
        if (promptFailsFirst) {
            env.prompts.reject(Error('Prompt request failed'));
            await tick();
            assert.equal(env.title.pending, true);
        }
        env.config.resolve(config);
        await tick();
        if (!promptFailsFirst) env.prompts.reject(Error('Prompt request failed'));
        await loaded;
        env.home.renderHeroText(env.home.cachedData.hero);
        assert.equal(env.title.textContent, '飞鸟 AI');
        assert.equal(env.home.config.shop.section_title, '自定义商城');
        assert.equal(JSON.parse(env.stored.get('homepage_hero_text')).title, '飞鸟 AI');
    }
});

test('config failure releases a language-correct fallback without caching it as configured text', async () => {
    for (const language of ['zh', 'en']) {
        const env = environment({ language });
        const loaded = env.home.loadAll();
        env.config.reject(Error('Config unavailable'));
        env.prompts.resolve([]);
        await loaded;
        env.home.renderHeroText(env.home.cachedData.hero);
        env.home.persistHomepagePrefetch();
        assert.equal(env.title.pending, false);
        assert.equal(env.title.textContent, language === 'en' ? 'Zaoyoe Studio' : '早鸟');
        assert.equal(env.home.heroConfigReady, false);
        assert.equal(env.stored.has('homepage_hero_text'), false);
        assert.equal(env.getPrefetch(), null);
    }
});

test('a last-good configured cache survives temporary config failure without metadata leaking into Hero data', async () => {
    const env = environment({ cache: storedHero() });
    env.preload();
    const loaded = env.home.loadAll();
    env.config.reject(Error('Offline'));
    env.prompts.resolve([]);
    await loaded;
    env.home.renderHeroText(env.home.cachedData.hero);
    assert.equal(env.title.textContent, '飞鸟 AI');
    assert.equal(env.home.cachedData.hero.source, undefined);
    assert.equal(env.home.heroConfigReady, false);
});

test('warm full-page prefetch renders authoritative config and rejects prefetch without provenance', async () => {
    const makePrefetch = heroConfigReady => ({ heroConfigReady, timestamp: Date.now(), cacheKind: 'complete',
        config: { hero: { title: '飞鸟 AI' } }, cachedData: { hero: { title: '旧标题' }, prompts: [] } });
    const env = environment({ prefetch: makePrefetch(true) });
    await env.home.loadAll();
    assert.equal(env.title.textContent, '飞鸟 AI');
    const legacy = environment({ prefetch: makePrefetch(undefined) });
    const loaded = legacy.home.loadAll();
    assert.equal(legacy.title.pending, true);
    legacy.config.resolve({ hero: { title: '新飞鸟 AI' }, prompts: {} });
    legacy.prompts.resolve([]);
    await loaded;
    assert.equal(legacy.title.textContent, '新飞鸟 AI');
});

test('only config-owned Hero text is gated, retaining layout and a small synchronous bootstrap', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/framer_home_critical.css'), 'utf8');
    const title = html.match(/<h1\b[^>]*class="hero-title[^\n]+/)[0];
    assert.match(title, /data-home-hero-text-pending/);
    assert.doesNotMatch(title, /data-i18n=/);
    assert.match(css, /\[data-home-hero-text-pending\]\s*\{\s*visibility:\s*hidden;/);
    assert.match(html, /<script src="\.\/js\/home-hero-text-preload\.js[^\"]*"><\/script>/);
    assert.match(html, /<noscript><link rel="stylesheet" href="\.\/css\/home-hero-text-nojs\.css/);
    assert.match(fs.readFileSync(path.join(root, 'css/home-hero-text-nojs.css'), 'utf8'), /visibility:\s*visible/);
    assert.ok(gzipSync(preload).length < 1500, 'Hero cache reader must remain lightweight');
});

test('language switch commits Hero text before waiting for ticker data and ignores an older completion', async () => {
    const env = environment();
    let listener;
    let renders = 0;
    const pendingTicker = [];
    env.window.addEventListener = (_name, handler) => { listener = handler; };
    env.context.document.getElementById = id => id === 'hero-section'
        ? { querySelector: selector => selector === '.hero-title' ? env.title : env.subtitle } : null;
    Object.assign(env.home, {
        config: { hero: { title_zh: '飞鸟 AI', title_en: 'Flying Bird AI', subtitle_zh: '创意', subtitle_en: 'Create' } },
        cachedData: {},
        buildTickerData() { const pending = deferred(); pendingTicker.push(pending); return pending.promise; },
        renderAll() { renders += 1; }, scheduleScrollAnimationsInit() {}
    });
    vm.runInContext(`(function () { ${extract("    window.addEventListener('languageChanged', async (e) => {", '\n    });')} }).call(home);`, env.context);
    env.window.__i18nBoot.language = 'en';
    const english = listener({ detail: { lang: 'en' } });
    assert.equal(env.title.textContent, 'Flying Bird AI');
    assert.equal(env.subtitle.textContent, 'Create');
    assert.equal(renders, 0, 'ticker loading does not block the title commit');
    env.window.__i18nBoot.language = 'zh';
    const chinese = listener({ detail: { lang: 'zh' } });
    assert.equal(env.title.textContent, '飞鸟 AI');
    pendingTicker[1].resolve(['中文']);
    await chinese;
    pendingTicker[0].resolve(['English']);
    await english;
    assert.deepEqual(env.home.cachedData.ticker, ['中文']);
    assert.equal(renders, 1, 'an older language request must not re-render the page');
});

test('an already hydrated Hero updates language in place without replacing its title or scene', () => {
    const env = environment();
    const track = { querySelectorAll: () => [] };
    const section = {
        dataset: { homeStaticHero: '1', homeHeroHydrated: '1', renderSignature: 'previous-language' },
        querySelector: selector => selector === '.hero-title' ? env.title
            : selector === '.hero-subtitle' ? env.subtitle : selector === '.hero-carousel-track' ? track : null,
        querySelectorAll: () => [],
        set innerHTML(_value) { assert.fail('language changes must preserve the Hero DOM'); }
    };
    env.context.document.getElementById = () => section;
    env.context.setHomeRuntimeStyle = () => {};
    env.context.setHomeSectionVisibility = () => {};
    env.context.observeHomepageSectionImpression = () => {};
    for (const name of ['hydrateStaticHeroSection', 'renderHero']) {
        vm.runInContext(`home.${name} = ({ ${extract(`  ${name}(`, '\n  },')} }).${name};`, env.context);
    }
    Object.assign(env.home, { cachedData: { hero: { title: 'Flying Bird AI', subtitle: 'Create', entries: [] } },
        initHeroLiquidMatrix() {}, initCarousel() {},
        destroyHeroLiquidMatrix() { assert.fail('language changes must preserve the existing scene'); }
    });
    env.home.renderHero();
    assert.equal(section.querySelector('.hero-title'), env.title);
    assert.equal(env.title.textContent, 'Flying Bird AI');
    assert.equal(env.subtitle.textContent, 'Create');
    assert.notEqual(section.dataset.renderSignature, 'previous-language');
});
