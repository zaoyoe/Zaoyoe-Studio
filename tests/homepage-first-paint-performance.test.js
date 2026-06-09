const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('homepage ships a static first-paint hero while runtime data hydrates', () => {
    const indexSource = readRepoFile('index.html');
    const framerSource = readRepoFile('js/framer_home.js');
    const framerStyles = readRepoFile('css/framer_home.css');
    const criticalStyles = readRepoFile('css/framer_home_critical.css');
    const promptCriticalStyles = readRepoFile('css/home-prompts-skeleton-critical.css');
    const navAuthFastPaintSource = readRepoFile('js/nav-auth-fast-paint.js');

    assert.equal(
        indexSource.includes('id="hero-section" class="hero-section" data-home-static-hero="1"'),
        true,
        'index.html should seed a nonblank hero shell before homepage runtime data loads'
    );
    assert.equal(
        indexSource.includes('class="hero-title fade-in-up visible" data-i18n="home.hero.title"'),
        true,
        'static hero title should render immediately and still be localized by i18n'
    );
    assert.equal(
        indexSource.includes('./js/framer_home.js?v=20260608_SUPPORT_CHANNEL_CLICK_FEEDBACK_3'),
        true,
        'index.html should cache-bust the first-paint homepage runtime'
    );
    assert.equal(
        indexSource.includes('promptNoRepaint=20260510_PROMPT_NO_REPAINT_1'),
        true,
        'index.html should cache-bust the prompt no-repaint homepage runtime fix'
    );
    assert.equal(
        indexSource.includes('./css/framer_home_critical.css?v=20260608_SUPPORT_CHANNEL_CLICK_FEEDBACK_3'),
        true,
        'index.html should load a small blocking homepage critical stylesheet'
    );
    assert.equal(
        indexSource.includes('./css/home-prompts-skeleton-critical.css?v=20260530_HOME_PROMPTS_SKELETON_GRID_1'),
        true,
        'index.html should load the prompt skeleton geometry before the deferred homepage stylesheet'
    );
    assert.ok(
        indexSource.indexOf('./css/home-prompts-skeleton-critical.css?v=20260530_HOME_PROMPTS_SKELETON_GRID_1') < indexSource.indexOf('./css/framer_home.css?v=20260609_SUPPORT_COPY_REAL_CLIPBOARD_1'),
        'prompt skeleton critical CSS should load before the deferred full homepage stylesheet'
    );
    assert.match(
        indexSource,
        /<link rel="stylesheet" href="\.\/css\/framer_home\.css\?v=20260609_SUPPORT_COPY_REAL_CLIPBOARD_1&uiTextSelectGuard=20260530_UI_TEXT_SELECT_GUARD_1" media="print" data-deferred-style="1">/,
        'index.html should defer the full homepage stylesheet after the first-paint shell'
    );
    assert.equal(
        indexSource.includes('./css/framer_home.css?v=20260609_SUPPORT_COPY_REAL_CLIPBOARD_1'),
        true,
        'index.html should keep cache-busting the full static hero stability styles'
    );
    assert.equal(
        indexSource.includes('./js/nav-auth-fast-paint.js?v=20260528_AVATAR_CANONICAL_CDN_1'),
        true,
        'homepage should load the cached nav auth fast-paint helper before the lower auth runtime'
    );
    assert.ok(
        indexSource.indexOf('./js/nav-auth-fast-paint.js?v=20260528_AVATAR_CANONICAL_CDN_1') < indexSource.indexOf('./supabase-auth-functions.js?v=20260516_HOME_AUTH_CHAT_CACHE_BUST_1'),
        'homepage nav auth fast-paint helper should run before Supabase auth hydration'
    );
    assert.match(
        navAuthFastPaintSource,
        /const CACHE_KEY = 'cached_user_profile';[\s\S]*authContainer\.replaceChildren\(buildAuthButton\(profile\)\);/,
        'nav auth fast-paint helper should draw the nav auth button from cached profile data'
    );
    assert.match(
        navAuthFastPaintSource,
        /avatar\.loading = 'eager';[\s\S]*avatar\.decoding = 'sync';[\s\S]*avatar\.fetchPriority = 'high';/,
        'nav auth fast-paint helper should prioritize the cached nav avatar image'
    );
    assert.match(
        navAuthFastPaintSource,
        /FAST_PAINT_ASSET_CDN_HOSTS[\s\S]*'cdn\.fatherkey\.com'[\s\S]*'cdn\.zaoyoe\.xyz'/,
        'nav auth fast-paint helper should recognize canonical and intl CDN hosts'
    );
    assert.match(
        navAuthFastPaintSource,
        /FAST_PAINT_ASSET_CDN_PATH_PREFIXES[\s\S]*'avatars'/,
        'nav auth fast-paint helper should rewrite cached avatar assets for the current site'
    );
    assert.match(
        navAuthFastPaintSource,
        /parts\[0\] === 'avatars'[\s\S]*'https:\/\/cdn\.fatherkey\.com'/,
        'nav auth fast-paint helper should keep shared user avatars on the canonical CDN'
    );
    assert.match(
        navAuthFastPaintSource,
        /window\.SiteConfig\?\.normalizeAssetUrlForCurrentSite\?\.\(parsed\.href\)/,
        'nav auth fast-paint helper should reuse SiteConfig CDN normalization when available'
    );
    assert.match(
        navAuthFastPaintSource,
        /button\.dataset\.authFastPaint = '1';/,
        'nav auth fast-paint helper should mark fast-painted auth markup for diagnostics'
    );
    assert.ok(
        criticalStyles.length < 37000,
        'homepage critical stylesheet should stay small enough for first paint'
    );
    assert.ok(
        zlib.gzipSync(criticalStyles).length < 8000,
        'homepage critical stylesheet gzip budget should stay under 8KB'
    );
    assert.ok(
        promptCriticalStyles.length < 8500,
        'homepage prompt skeleton critical stylesheet should stay small enough for first paint'
    );
    assert.ok(
        zlib.gzipSync(promptCriticalStyles).length < 2300,
        'homepage prompt skeleton critical stylesheet gzip budget should stay compact'
    );
    assert.match(
        criticalStyles,
        /20260501_HOME_CRITICAL_CSS_SPLIT_1[\s\S]*html::-webkit-scrollbar,\s*body::-webkit-scrollbar\s*\{[\s\S]*display:\s*none !important;[\s\S]*width:\s*0 !important;[\s\S]*height:\s*0 !important;/,
        'homepage critical CSS should hide the root scrollbar before deferred helpers hydrate'
    );
    assert.match(
        framerSource,
        /FramerHome\.renderHeroFirstPaint\(\);[\s\S]*FramerHome\.init\(\);/,
        'homepage runtime should try cached hero paint before full data initialization'
    );
    assert.match(
        framerSource,
        /hydrateStaticHeroSection\(section, data, visibleEntries, heroSignature\)[\s\S]*Keep the seeded prism scene intact so its intro scale animation does not replay\./,
        'homepage runtime should hydrate the static hero in place so seeded prism cubes do not replay their intro animation'
    );
    const renderHeroStart = framerSource.indexOf('renderHero() {');
    const renderPromptsStart = framerSource.indexOf('renderPrompts()', renderHeroStart);
    const renderHeroSegment = framerSource.slice(renderHeroStart, renderPromptsStart);
    assert.ok(
        renderHeroSegment.indexOf('this.hydrateStaticHeroSection(section, data, visibleEntries, heroSignature)') < renderHeroSegment.indexOf('section.innerHTML = `'),
        'homepage runtime should attempt in-place hero hydration before falling back to replacing hero markup'
    );
    assert.match(
        criticalStyles,
        /\.hero-section\[data-home-static-hero="1"\]:not\(\[data-render-signature\]\) \.hero-carousel-track\s*\{[\s\S]*display:\s*grid;[\s\S]*justify-content:\s*center;/,
        'static hero carousel should match the runtime centered position before JS takes over'
    );
    assert.match(
        framerStyles,
        /\.hero-section\[data-home-hero-centering="1"\] \.hero-carousel\s*\{[\s\S]*20260507_HOME_HERO_CENTERING_LOCK_1[\s\S]*scroll-behavior:\s*auto !important;[\s\S]*scroll-snap-type:\s*none !important;/,
        'full homepage CSS should keep the carousel centering lock when deferred styles hydrate'
    );
    assert.match(
        framerStyles,
        /\.hero-section\[data-home-hero-centering="1"\] \.entry-card-ui\s*\{[\s\S]*transition:\s*none !important;/,
        'full homepage CSS should prevent entry card transition during hydration centering'
    );
    const hydrateHeroStart = framerSource.indexOf('hydrateStaticHeroSection(section, data, visibleEntries, heroSignature)');
    const renderHeroMethodStart = framerSource.indexOf('renderHero() {', hydrateHeroStart);
    const hydrateHeroSegment = framerSource.slice(hydrateHeroStart, renderHeroMethodStart);
    assert.ok(
        hydrateHeroSegment.indexOf("section.dataset.homeHeroCentering = '1';") < hydrateHeroSegment.indexOf('section.dataset.renderSignature = heroSignature;'),
        'homepage runtime should hold the hero centering lock before switching the static hero into carousel layout'
    );
    assert.match(
        framerSource,
        /applyHeroCenteringLock[\s\S]*setHomeRuntimeStyle\(carousel,\s*\{[\s\S]*scrollBehavior:\s*'auto'[\s\S]*scrollSnapType:\s*'none'[\s\S]*releaseHeroCenteringLock[\s\S]*scrollBehavior:\s*null[\s\S]*scrollSnapType:\s*null/,
        'homepage runtime should disable and then restore carousel scroll behavior with inline styles during initial centering'
    );
    assert.match(
        framerSource,
        /initCarousel\(options = \{\}\)[\s\S]*releaseHeroCenteringLock[\s\S]*requestAnimationFrame\(releaseHeroCenteringLock\);/,
        'homepage runtime should release the hero centering lock only after the initial carousel center is applied'
    );
    assert.match(
        criticalStyles,
        /@media \(max-width: 767px\)\s*\{[\s\S]*\.hero-section\[data-home-static-hero="1"\]:not\(\[data-render-signature\]\) \.hero-carousel\s*\{[\s\S]*overflow:\s*hidden;[\s\S]*scroll-snap-type:\s*none;[\s\S]*\.hero-section\[data-home-static-hero="1"\]:not\(\[data-render-signature\]\) \.hero-carousel-track\s*\{[\s\S]*grid-template-columns:\s*repeat\(5, 140px\);[\s\S]*gap:\s*16px;/,
        'mobile static hero carousel should stay centered during critical first paint before runtime hydration'
    );
    assert.match(
        criticalStyles,
        /\.progress-tick--covered\s*\{[\s\S]*opacity:\s*0;/,
        'critical homepage CSS should hide covered progress ticks before runtime hydration'
    );
    assert.equal(
        (indexSource.match(/class="progress-tick progress-tick--covered"/g) || []).length,
        4,
        'static homepage hero should pre-hide the center ticks covered by the transparent progress thumb'
    );
    assert.match(
        criticalStyles,
        /\.hero-progress-thumb\s*\{[\s\S]*20260501_HOME_PROGRESS_THUMB_TRANSPARENT_1[\s\S]*background:\s*transparent;/,
        'critical homepage CSS should keep the progress thumb transparent like the hydrated hero'
    );
    assert.match(
        framerStyles,
        /\.hero-progress-thumb\s*\{[\s\S]*20260501_HOME_PROGRESS_THUMB_TRANSPARENT_1[\s\S]*background:\s*transparent;/,
        'full homepage CSS should keep progress thumb transparency aligned with critical CSS'
    );
    assert.match(
        criticalStyles,
        /\.hero-section\[data-home-static-hero="1"\]:not\(\[data-render-signature\]\) \.entry-card:nth-child\(1\) \.home-entry-card-icon\s*\{[\s\S]*color:\s*#f472b6;/,
        'static hero icons should not flash the default blue color'
    );
    assert.match(
        criticalStyles,
        /\.hero-title\s*\{[\s\S]*padding-top:\s*max\(0px, calc\(60px - 5vw\)\);[\s\S]*font-size:\s*clamp\(48px, 10vw, 110px\);[\s\S]*letter-spacing:\s*0;/,
        'critical homepage CSS should match the final hero title typography before the full stylesheet loads'
    );
    assert.match(
        criticalStyles,
        /20260502_HOME_CRITICAL_NAV_AUTH_SHELL_1[\s\S]*\.auth-display-none\s*\{[\s\S]*display:\s*none !important;[\s\S]*\.avatar-dropdown\s*\{[\s\S]*position:\s*fixed;[\s\S]*visibility:\s*hidden;[\s\S]*pointer-events:\s*none;/,
        'critical homepage CSS should hide injected auth text and avatar dropdown before deferred styles load'
    );
    assert.match(
        criticalStyles,
        /@media \(max-width: 767px\)\s*\{[\s\S]*\.nav-container\s*\{[\s\S]*padding-right:\s*var\(--spacing-lg\);[\s\S]*padding-left:\s*var\(--spacing-lg\);[\s\S]*\.hero-title\s*\{[\s\S]*font-size:\s*clamp\(48px, 10vw, 110px\);/,
        'mobile critical nav and hero sizing should match the final stylesheet during refresh'
    );
    assert.match(
        criticalStyles,
        /@media \(max-width: 767px\)\s*\{[\s\S]*20260502_HOME_CRITICAL_MOBILE_SPACING_PARITY_1[\s\S]*:root\s*\{[\s\S]*--spacing-xl:\s*60px;[\s\S]*--spacing-2xl:\s*80px;/,
        'mobile critical spacing variables should match the deferred stylesheet so hero refresh does not recenter'
    );
    assert.match(
        framerStyles,
        /@media \(max-width: 767px\)[\s\S]*:root\s*\{[\s\S]*--spacing-xl:\s*60px;[\s\S]*--spacing-2xl:\s*80px;/,
        'full mobile stylesheet should keep the same spacing variables that critical CSS mirrors'
    );
    assert.match(
        criticalStyles,
        /20260502_HOME_CRITICAL_PRISM_MOBILE_PARITY_1[\s\S]*\.hero-prismchrono-field\s*\{transform:\s*translateY\(16%\);[\s\S]*\.hero-prismchrono-field span:nth-of-type\(1\)\s*\{[\s\S]*--hero-prism-cube-size:\s*132px;[\s\S]*--hero-prism-cube-y:\s*-70px;/,
        'mobile critical prism field should match the final deferred position before the full stylesheet activates'
    );
    assert.match(
        criticalStyles,
        /20260502_HOME_CRITICAL_PRISM_MOBILE_PARITY_1[\s\S]*\.hero-prismchrono-field span:nth-of-type\(2\)\s*\{[\s\S]*--hero-prism-cube-x:\s*-232px;[\s\S]*--hero-prism-cube-y:\s*-178px;[\s\S]*\.hero-prismchrono-field span:nth-of-type\(3\)\s*\{[\s\S]*--hero-prism-cube-x:\s*224px;[\s\S]*--hero-prism-cube-y:\s*144px;/,
        'mobile critical side prism cubes should use the final mobile offsets during refresh'
    );
    assert.equal(
        criticalStyles.includes('font-size: 56px;'),
        false,
        'mobile critical CSS should not use the old fixed hero title size that caused refresh jumps'
    );
    assert.equal(
        criticalStyles.includes('margin-top: 56px;'),
        false,
        'mobile critical CSS should not move the hero ruler away from the final vertical rhythm'
    );
    assert.equal(
        criticalStyles.includes('margin-top: 96px;'),
        false,
        'mobile critical CSS should not lift the hero entry icons above their final position'
    );
    assert.match(
        criticalStyles,
        /\.hero-progress\s*\{[\s\S]*20260502_HOME_CRITICAL_HERO_VERTICAL_LOCK_1[\s\S]*margin:\s*64px 0;/,
        'critical homepage CSS should keep the hero ruler on the final vertical rhythm during refresh'
    );
    assert.match(
        framerStyles,
        /\.hero-progress\s*\{[\s\S]*margin:\s*64px 0;/,
        'full homepage CSS should keep the same hero ruler vertical rhythm as critical CSS'
    );
    assert.match(
        criticalStyles,
        /\.hero-carousel\s*\{[\s\S]*margin-top:\s*120px;/,
        'critical homepage CSS should keep the hero entry icons at the same vertical offset as the final stylesheet'
    );
    assert.match(
        criticalStyles,
        /\.hero-subtitle\s*\{[\s\S]*font-size:\s*clamp\(18px, 2vw, 24px\);/,
        'critical homepage CSS should match the final hero subtitle size before the full stylesheet loads'
    );
    assert.match(
        framerStyles,
        /\.hero-title\s*\{[\s\S]*font-size:\s*clamp\(48px, 10vw, 110px\);[\s\S]*letter-spacing:\s*0;[\s\S]*padding-top:\s*max\(0px, calc\(60px - 5vw\)\);/,
        'full homepage CSS should keep the same hero title typography as critical CSS'
    );
    assert.match(
        framerStyles,
        /will-change:\s*transform, scale;[\s\S]*20260501_HOME_PRISM_CUBE_INTRO_2[\s\S]*animation:[\s\S]*hero-prismchrono-spin var\(--hero-prism-cube-speed, 8\.8s\) linear infinite,[\s\S]*hero-prismchrono-cube-intro 720ms cubic-bezier\(0\.22, 1, 0\.36, 1\) var\(--hero-prism-cube-intro-delay, 0ms\) both;/,
        'full homepage CSS should ease prism cubes in instead of snapping them into the hero scene'
    );
    const prismCubeSpanRule = framerStyles.match(/\.hero-prismchrono-field span\s*\{[\s\S]*?\n\}/)?.[0] || '';
    assert.equal(
        prismCubeSpanRule.includes('opacity:'),
        false,
        'prism cube container must not animate opacity because that flattens preserve-3d into thin planes'
    );
    assert.match(
        framerStyles,
        /\.hero-prismchrono-field span b\s*\{[\s\S]*20260502_HOME_PRISM_FACE_NO_SHADOW_1[\s\S]*box-shadow:\s*none;/,
        'full homepage CSS should not add cube-face shadows that veil the hero ruler after the intro animation'
    );
    assert.match(
        framerStyles,
        /\.hero-prismchrono-field i\s*\{[\s\S]*20260502_HOME_PRISM_FACE_NO_SHADOW_1[\s\S]*box-shadow:\s*none;/,
        'full homepage CSS should not add prism ring glows that look like gray shadows near the hero ruler'
    );
    assert.match(
        framerStyles,
        /\.hero-prismchrono-field em\s*\{[\s\S]*box-shadow:\s*none;/,
        'full homepage CSS should keep prism nodes shadowless like the critical first-paint scene'
    );
    assert.match(
        framerStyles,
        /\.hero-prismchrono-field span:nth-of-type\(2\)\s*\{[\s\S]*animation-direction:\s*reverse, normal;/,
        'prism cube intro should preserve the middle cube reverse spin while keeping the intro animation forward'
    );
    assert.match(
        framerStyles,
        /@keyframes hero-prismchrono-cube-intro\s*\{[\s\S]*from\s*\{[\s\S]*scale:\s*0\.58;[\s\S]*to\s*\{[\s\S]*scale:\s*1;/,
        'prism cube intro keyframes should scale cubes in one smooth non-overshooting ease-out segment'
    );
    assert.match(
        criticalStyles,
        /20260501_HOME_CRITICAL_FOOTER_GUARD_1[\s\S]*body\.home-page \.framer-footer\s*\{[\s\S]*display:\s*none;/,
        'critical homepage CSS should keep the deferred footer from flashing unstyled inside the hero viewport'
    );
    assert.match(
        criticalStyles,
        /html\[data-theme="light"\] body\.home-page \.hero-section\s*\{[\s\S]*20260501_HOME_LIGHT_HERO_CRITICAL_BG_1[\s\S]*radial-gradient\(circle at 50% 34%, rgba\(14, 165, 233, 0\.11\), transparent 32%\)/,
        'critical homepage CSS should give the light hero a nonblank visual background before the full stylesheet loads'
    );
    assert.match(
        framerStyles,
        /html\[data-theme="light"\] body\.home-page \.hero-section\s*\{[\s\S]*20260502_HOME_LIGHT_HERO_BG_PARITY_1[\s\S]*radial-gradient\(circle at 50% 34%, rgba\(14, 165, 233, 0\.11\), transparent 32%\)/,
        'full homepage CSS should keep the same light hero background as critical CSS'
    );
    assert.match(
        criticalStyles,
        /html\[data-theme="light"\] body\.home-page \.hero-section::after\s*\{[\s\S]*height:\s*220px;[\s\S]*background:\s*linear-gradient\(to bottom, transparent, #f8fafc 74%\);/,
        'critical homepage CSS should match the final light hero fade height'
    );
    assert.match(
        framerStyles,
        /html\[data-theme="light"\] body\.home-page \.hero-prism-preview-effect-layer\s*\{[\s\S]*mix-blend-mode:\s*normal;[\s\S]*animation:\s*none;[\s\S]*transform:\s*none;/,
        'full homepage CSS should not brighten the light hero preview layer after deferred styles activate'
    );
    assert.match(
        criticalStyles,
        /html\[data-theme="light"\] body\.home-page \.hero-prism-preview-bg\s*\{[\s\S]*display:\s*block;[\s\S]*position:\s*absolute;[\s\S]*pointer-events:\s*none;/,
        'critical homepage CSS should show the lightweight light-theme prism preview layer during first paint'
    );
    assert.match(
        criticalStyles,
        /20260501_HOME_CRITICAL_PRISM_SCENE_1[\s\S]*\.hero-prismchrono-field\s*\{[\s\S]*perspective:\s*1220px;[\s\S]*\.hero-prismchrono-field span\s*\{[\s\S]*transform-style:\s*preserve-3d;[\s\S]*hero-prismchrono-spin var\(--hero-prism-cube-speed, 8\.8s\) linear infinite,[\s\S]*hero-prismchrono-cube-intro 720ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/,
        'critical homepage CSS should render the prism cube scene without waiting for deferred full CSS'
    );
    assert.match(
        criticalStyles,
        /html\[data-theme="light"\] body\.home-page \.hero-prismchrono-scene\s*\{[\s\S]*display:\s*block;/,
        'light theme should enable the prism scene during critical first paint'
    );
    assert.match(
        criticalStyles,
        /\.hero-prismchrono-field span b:nth-child\(1\)\s*\{[\s\S]*rotateY\(0deg\) translateZ\(calc\(var\(--hero-prism-cube-size, 160px\) \/ 2\)\);/,
        'critical prism scene should include 3D cube faces, not flat placeholder panes'
    );
    assert.match(
        criticalStyles,
        /html\[data-theme="light"\] body\.home-page \.hero-prism-preview-effect-layer\s*\{[\s\S]*filter:\s*blur\(42px\);[\s\S]*opacity:\s*0\.8;/,
        'critical homepage CSS should style the first-paint prism preview effect without waiting for deferred CSS'
    );
    assert.equal(
        indexSource.includes('fa-solid-900.woff2'),
        false,
        'homepage should not make hero first paint wait on the Font Awesome webfont'
    );
    assert.equal(
        criticalStyles.includes('Font Awesome 6 Free'),
        false,
        'homepage critical CSS should not depend on the Font Awesome webfont for hero icons'
    );
    assert.match(
        criticalStyles,
        /20260501_HOME_HERO_FA_SVG_CRITICAL_SUBSET_1[\s\S]*\.entry-card-ui>i\.fa-wand-magic-sparkles\.home-entry-card-icon::before,[\s\S]*\.entry-card-ui>i\.fa-comment-dots\.home-entry-card-icon::before[\s\S]*-webkit-mask:\s*var\(--home-entry-fa-icon-mask\) center \/ contain no-repeat;/,
        'critical homepage CSS should render hero FA icons from inline original SVG masks'
    );
    [
        ['fa-wand-magic-sparkles', "viewBox='0 0 576 512'"],
        ['fa-store', "viewBox='0 0 576 512'"],
        ['fa-robot', "viewBox='0 0 640 512'"],
        ['fa-comment-dots', "viewBox='0 0 512 512'"]
    ].forEach(([iconClass, viewBox]) => {
        assert.equal(
            criticalStyles.includes(`.entry-card-ui>i.${iconClass}.home-entry-card-icon {`)
                && criticalStyles.includes(viewBox),
            true,
            `${iconClass} should use its original Font Awesome SVG viewBox`
        );
    });
    assert.match(
        framerStyles,
        /\.framer-footer\s*\{[\s\S]*display:\s*block;[\s\S]*border-top:\s*1px solid var\(--border-subtle\);/,
        'full homepage stylesheet should restore the footer after deferred styles load'
    );
    assert.match(
        framerStyles,
        /20260430_HOME_ROOT_SCROLLBAR_FULL_HIDE_1[\s\S]*html::-webkit-scrollbar,\s*body::-webkit-scrollbar\s*\{[\s\S]*display:\s*none !important;[\s\S]*width:\s*0 !important;[\s\S]*height:\s*0 !important;/,
        'full homepage stylesheet should keep the shared chrome scrollbar rules for deferred hydration'
    );
});

test('homepage ships static progressive shells below the hero before runtime hydration', () => {
    const indexSource = readRepoFile('index.html');
    const framerSource = readRepoFile('js/framer_home.js');
    const framerStyles = readRepoFile('css/framer_home.css');
    const criticalStyles = readRepoFile('css/framer_home_critical.css');
    const promptCriticalStyles = readRepoFile('css/home-prompts-skeleton-critical.css');
    const zhMessages = JSON.parse(readRepoFile('lang/zh.json'));
    const enMessages = JSON.parse(readRepoFile('lang/en.json'));
    const sectionExpectations = [
        ['prompts', 'content-section', 'home.prompts.title', '提示词'],
        ['shop', 'content-section', 'home.shop.title', '资源商城'],
        ['gongyi', 'content-section', 'home.gongyi.title', '核心秘钥'],
        ['verify', 'content-section', 'home.verify.title', 'Gemini Pro'],
        ['guestbook', 'content-section', 'home.guestbook.title', '留言板'],
        ['ticker', 'ticker-section', '', '']
    ];

    for (const [sectionKey, baseClass, titleKey, fallbackTitle] of sectionExpectations) {
        const sectionPattern = new RegExp(
            `<section id="${sectionKey}-section" class="${baseClass} home-section-shell-section home-section-shell-section--${sectionKey}"[\\s\\S]*?data-homepage-static-shell="1"[\\s\\S]*?<div class="home-section-shell">[\\s\\S]*?<div class="home-section-shell__body home-section-shell__body--${sectionKey}" aria-hidden="true">[\\s\\S]*?</section>`
        );
        assert.match(
            indexSource,
            sectionPattern,
            `${sectionKey} should ship a visible static shell instead of an empty black section`
        );

        assert.equal(
            indexSource.includes(`<section id="${sectionKey}-section" class="${baseClass}"></section>`),
            false,
            `${sectionKey} should not regress to an empty placeholder section`
        );

        if (titleKey) {
            assert.equal(
                indexSource.includes(`data-i18n="${titleKey}">${fallbackTitle}</h2>`),
                true,
                `${sectionKey} shell should include the real localized title text in initial HTML`
            );
        }
    }

    assert.equal(zhMessages.home.gongyi.title, '核心秘钥');
    assert.equal(enMessages.home.gongyi.title, 'Father Key');
    assert.equal(
        criticalStyles.includes('.home-section-shell-section{--home-shell-min-height:520px;min-height:var(--home-shell-min-height);display:flex;align-items:center;justify-content:center}'),
        true,
        'critical CSS should center the progressive section shell before deferred CSS loads'
    );
    assert.equal(
        criticalStyles.includes('.home-section-shell__header,.section-header{width:min(640px,88vw);margin:0 auto var(--spacing-xl);display:grid;gap:12px;justify-items:center;text-align:center}'),
        true,
        'critical CSS should center runtime section headers before deferred CSS loads'
    );
    assert.equal(
        criticalStyles.includes('.home-section-shell__header .section-title,.section-header .section-title{font-size:clamp(36px,5vw,72px);letter-spacing:0;line-height:1.2;margin:0}'),
        true,
        'critical CSS should keep runtime section titles full-size before deferred CSS loads'
    );
    assert.equal(
        criticalStyles.includes('.home-section-shell__header .section-subtitle,.section-header .section-subtitle{max-width:620px;margin:0;color:var(--text-secondary);font-size:clamp(16px,2vw,20px);line-height:1.6}'),
        true,
        'critical CSS should keep runtime section subtitles aligned before deferred CSS loads'
    );
    assert.equal(
        promptCriticalStyles.includes('20260530_HOME_PROMPTS_SKELETON_GRID_1'),
        true,
        'critical CSS should include prompt skeleton first-paint layout rules'
    );
    assert.equal(
        promptCriticalStyles.includes('body.home-page #main-content>.home-section-shell-section--prompts{max-width:none;padding:var(--spacing-xl) 0;overflow:hidden;display:block}'),
        true,
        'critical CSS should keep the prompt shell full-bleed before deferred CSS loads'
    );
    assert.equal(
        promptCriticalStyles.includes('.home-prompts-skeleton__grid{display:flex;align-items:flex-start;gap:12px;width:100%;padding:0 12px}'),
        true,
        'critical CSS should preserve the prompt skeleton masonry columns on first paint'
    );
    assert.equal(
        promptCriticalStyles.includes('.home-section-shell-section--prompts .home-section-shell__body--prompts{display:block;width:100%}'),
        true,
        'critical CSS should prevent the generic section shell grid from compressing the prompt skeleton into the first column'
    );
    assert.match(
        framerStyles,
        /\.home-section-shell-section--prompts \.home-section-shell__body--prompts\s*\{[\s\S]*display:\s*block;[\s\S]*width:\s*100%;[\s\S]*\}/,
        'full homepage CSS should keep the prompt skeleton body out of the generic 4-column shell grid'
    );
    assert.equal(
        promptCriticalStyles.includes('.home-prompts-skeleton__card{display:block;width:100%;min-height:0;aspect-ratio:2/3;'),
        true,
        'critical CSS should reserve prompt image-card aspect ratios on first paint'
    );
    assert.match(
        promptCriticalStyles,
        /@media \(max-width:768px\)\{[\s\S]*body\.home-page #main-content>\.home-section-shell-section--prompts[\s\S]*padding-top:var\(--spacing-lg\)[\s\S]*\.home-prompts-skeleton__grid[\s\S]*width:140%;margin-left:-20%/,
        'critical CSS should keep mobile prompt skeleton geometry stable before deferred CSS loads'
    );
    assert.equal(
        promptCriticalStyles.includes('html[data-theme="light"] body.home-page .home-prompts-skeleton__card{border-color:rgba(15,23,42,.07);'),
        true,
        'critical CSS should keep light-theme prompt skeleton colors aligned before deferred CSS loads'
    );
    assert.equal(
        promptCriticalStyles.includes('body.home-page #prompts-section.prompts-masonry-section .masonry-container{display:flex;align-items:flex-start;gap:12px;width:100%;padding:0 12px;position:relative}'),
        true,
        'critical CSS should preserve runtime prompt masonry columns before deferred CSS loads'
    );
    assert.equal(
        promptCriticalStyles.includes('body.home-page #prompts-section.prompts-masonry-section .masonry-card-preview{width:100%;min-height:0;aspect-ratio:var(--home-prompt-card-ratio,2/3);'),
        true,
        'critical CSS should reserve runtime prompt image-card aspect ratios before deferred CSS loads'
    );
    assert.equal(
        promptCriticalStyles.includes('body.home-page #prompts-section.prompts-masonry-section .masonry-card img{width:100%;height:auto;display:block;object-fit:cover;pointer-events:none;user-select:none;-webkit-user-drag:none;opacity:0;transition:opacity .18s ease}'),
        true,
        'critical CSS should hide runtime prompt images until decode finishes so native image placeholders do not flash in the card corner'
    );
    assert.equal(
        promptCriticalStyles.includes('body.home-page #prompts-section.prompts-masonry-section .masonry-card-preview[data-home-prompt-image-loaded="1"] img{opacity:1}'),
        true,
        'critical CSS should reveal runtime prompt images only after the card marks them loaded'
    );
    assert.match(
        framerStyles,
        /\.home-section-shell__header \.section-title[\s\S]*letter-spacing:\s*0;[\s\S]*\.home-section-shell__tile[\s\S]*animation:\s*home-section-shell-shimmer/,
        'full CSS should keep static and runtime section shells visually aligned'
    );
    assert.match(
        framerStyles,
        /\.masonry-card-preview\s*\{[\s\S]*position:\s*relative;[\s\S]*aspect-ratio:\s*var\(--home-prompt-card-ratio, auto\);[\s\S]*\.masonry-card img\s*\{[\s\S]*opacity:\s*0;[\s\S]*\.masonry-card-preview\[data-home-prompt-image-loaded="1"\] img\s*\{[\s\S]*opacity:\s*1;/,
        'full CSS should keep prompt images hidden until their skeleton can swap to decoded media'
    );
    assert.match(
        framerSource,
        /const HOMEPAGE_SECTION_SHELL_COPY = \{[\s\S]*gongyi:[\s\S]*titleKey: 'home\.gongyi\.title'[\s\S]*function renderHomepageSectionShellHeader\(sectionKey\)[\s\S]*<h2 class="section-title" data-i18n="\$\{escapeHomeHtml\(copy\.titleKey\)\}">/,
        'runtime fallback shells should use the same readable titles as the initial HTML shells'
    );
    assert.match(
        framerSource,
        /function clearHomepageSectionShell\(section\)[\s\S]*delete section\.dataset\.homepageStaticShell;[\s\S]*section\.removeAttribute\('aria-busy'\);/,
        'runtime hydration should clear static shell markers and busy state when real content takes over'
    );
});

test('homepage deferred runtime does not force users back to the top after scroll', () => {
    const indexSource = readRepoFile('index.html');
    const scrollBootstrap = readRepoFile('js/index-scroll-bootstrap.js');
    const framerSource = readRepoFile('js/framer_home.js');

    assert.equal(
        indexSource.includes('./js/index-scroll-bootstrap.js?v=20260516_HOME_AUTH_CHAT_CACHE_BUST_1'),
        true,
        'homepage should keep the early head scroll bootstrap for reload restoration'
    );
    assert.match(
        scrollBootstrap,
        /history\.scrollRestoration = 'manual';[\s\S]*window\.scrollTo\(0, 0\);/,
        'the early bootstrap should remain responsible for the initial top reset'
    );

    const initStart = framerSource.indexOf('async init()');
    const initEnd = framerSource.indexOf('checkPerformance()', initStart);
    assert.notEqual(initStart, -1, 'FramerHome.init should exist');
    assert.notEqual(initEnd, -1, 'FramerHome.init should call checkPerformance after startup comments');
    assert.equal(
        framerSource.slice(initStart, initEnd).includes('window.scrollTo(0, 0)'),
        false,
        'deferred homepage init must not reset scroll after the user has interacted'
    );
});

test('homepage defers below-fold section rendering off the first JS pass', () => {
    const framerSource = readRepoFile('js/framer_home.js');
    const initSegmentStart = framerSource.indexOf('async init()');
    const initSegmentEnd = framerSource.indexOf('window.addEventListener(\'languageChanged\'', initSegmentStart);
    const renderAllStart = framerSource.indexOf('renderAll(options = {})');
    const renderAllEnd = framerSource.indexOf('async loadNavData()', renderAllStart);

    assert.notEqual(initSegmentStart, -1, 'FramerHome.init should exist');
    assert.notEqual(initSegmentEnd, -1, 'FramerHome.init should bind language changes after first render scheduling');
    assert.notEqual(renderAllStart, -1, 'FramerHome.renderAll should accept render options');
    assert.notEqual(renderAllEnd, -1, 'FramerHome.renderAll should appear before nav data loading');

    const initSegment = framerSource.slice(initSegmentStart, initSegmentEnd);
    const renderAllSegment = framerSource.slice(renderAllStart, renderAllEnd);

    assert.match(
        framerSource,
        /const HOMEPAGE_FIRST_PAINT_SECTION_KEYS = new Set\(\['hero', 'prompts'\]\);/,
        'homepage should explicitly limit first-pass rendering to hero and prompts'
    );
    assert.match(
        initSegment,
        /this\.renderAll\(\{ phase: 'first-paint' \}\);[\s\S]*this\.scheduleDeferredSectionRender\(\);/,
        'homepage init should schedule below-fold rendering after the first-paint render pass'
    );
    assert.match(
        framerSource,
        /function renderHomepageSectionShell\(sectionKey, section\)[\s\S]*section\.dataset\.homepageDeferredRender = '1';[\s\S]*if \(firstPaintOnly && !HOMEPAGE_FIRST_PAINT_SECTION_KEYS\.has\(sectionKey\)\) \{[\s\S]*renderHomepageSectionShell\(sectionKey, sectionEl\);/,
        'homepage renderAll should mark below-fold sections for deferred render during first paint'
    );
    assert.match(
        framerSource,
        /const HOMEPAGE_DEFERRED_SECTION_ROOT_MARGIN = '900px 0px';/,
        'deferred homepage sections should render before the user reaches them'
    );
    assert.match(
        framerSource,
        /requestIdleCallback\(\(\) => \{[\s\S]*runDeferredRender\('idle'\);[\s\S]*\}, \{ timeout: HOMEPAGE_DEFERRED_SECTION_IDLE_TIMEOUT_MS \}\)/,
        'deferred homepage sections should also render on idle with an explicit timeout'
    );
});

test('homepage prompt masonry keeps first refresh light while warming thumbnails after load', () => {
    const framerSource = readRepoFile('js/framer_home.js');
    const homepagePromptsSource = readRepoFile('js/homepage-prompts-data.js');

    assert.match(
        framerSource,
        /const resolvedUrl = preferOriginal\s*\? rawUrl\s*: this\.getOptimizedImageUrl\(url,\s*\{\s*variant\s*\}\);/,
        'homepage prompt cards should prefer optimized thumbnail URLs'
    );
    assert.match(
        framerSource,
        /preferOriginal:\s*true/,
        'homepage prompt cards should keep the original image URL as an error fallback'
    );
    assert.match(
        framerSource,
        /loading="\$\{isPriorityPromptImage \? 'eager' : 'lazy'\}"/,
        'homepage prompt thumbnails should eagerly load the first visible masonry rows'
    );
    assert.match(
        framerSource,
        /const visiblePromptColumnCount = viewportWidth > 0 && viewportWidth <= 768/,
        'homepage prompt thumbnails should calculate the visible masonry columns before prioritizing rows'
    );
    assert.match(
        framerSource,
        /const isPriorityPromptImage = columnIndex < visiblePromptColumnCount && rowIndex < HOMEPAGE_PROMPT_EAGER_IMAGE_ROWS;/,
        'homepage prompt thumbnails should prioritize the first two visible masonry rows now that thumbnails are compact'
    );
    assert.match(
        framerSource,
        /fetchpriority="\$\{isPriorityPromptImage \? 'high' : 'low'\}"/,
        'homepage prompt thumbnails should keep later rows low-priority while boosting the first visible rows'
    );
    assert.match(
        framerSource,
        /this\.promptPool = await this\.fetchVisiblePromptPool\(\{ preferStaticFirst: true \}\);/,
        'homepage prompt cards should render from the static prompt bundle before live prompt sync'
    );
    assert.match(
        framerSource,
        /function getHomepageStaticPromptSource\(\)/,
        'homepage should read the lightweight prompt summary before falling back to the full prompt dataset'
    );
    assert.match(
        framerSource,
        /const promptsReady = isHomepagePromptSourceReady\(\);/,
        'homepage initialization should wait for the lightweight prompt source instead of hard-requiring full PROMPTS'
    );
    assert.equal(
        homepagePromptsSource.includes('window.__HOMEPAGE_PROMPTS__ = prompts;'),
        true,
        'homepage should ship a dedicated prompt summary payload'
    );
    assert.equal(
        homepagePromptsSource.includes('"prompt":'),
        false,
        'homepage prompt summary should not ship full prompt bodies'
    );
    assert.match(
        framerSource,
        /this\.schedulePromptPoolLiveSync\(\{ reason: 'initial-static-prompt-pool' \}\);/,
        'homepage live prompt sync should move off the blocking first render path'
    );
    assert.doesNotMatch(
        framerSource,
        /const updatedAt = String\(normalizedPrompt\?\.(?:updated_at|created_at)/,
        'homepage live prompt sync should not repaint cards just because live rows include timestamp metadata'
    );
    assert.match(
        framerSource,
        /const promptSectionAlreadyPainted = Boolean\(promptSection\?\.querySelector\?\.\('\.masonry-card'\)\);/,
        'homepage live prompt sync should detect when first-paint prompt cards are already on screen'
    );
    assert.match(
        framerSource,
        /if \(options\.forceRender === true \|\| !promptSectionAlreadyPainted\) \{\s*this\.renderPrompts\(\);/,
        'homepage live prompt sync should not clear already-painted prompt cards during first-load background refresh'
    );
    assert.match(
        framerSource,
        /const \[shop, guestbook, shopCategories\] = await Promise\.all\(/,
        'homepage shop data should load with supplemental data after prompt cards can paint'
    );
    assert.match(
        framerSource,
        /schedulePromptMasonryImageWarmup\(section\)/,
        'homepage should warm prompt thumbnails after the prompt section is rendered'
    );
    assert.match(
        framerSource,
        /requestIdleCallback\(startWarmup, \{ timeout: 900 \}\)/,
        'homepage prompt thumbnail warmup should use a shorter idle window for compact thumbnails'
    );
    assert.match(
        framerSource,
        /index \* HOMEPAGE_PROMPT_WARMUP_STAGGER_MS/,
        'homepage prompt thumbnail warmup should stagger compact thumbnails tightly'
    );
    assert.match(
        framerSource,
        /image\.fetchPriority = 'low';/,
        'background prompt thumbnail warmup should stay low-priority'
    );
    assert.match(
        framerSource,
        /rootMargin: '900px 0px'/,
        'homepage prompt thumbnail warmup should also start when the section nears the viewport'
    );
});

test('homepage prompts title paints immediately when prompt cards mount', () => {
    const framerSource = readRepoFile('js/framer_home.js');
    const renderPromptsStart = framerSource.indexOf('  renderPrompts() {');
    const renderPromptsEnd = framerSource.indexOf('renderShop()', renderPromptsStart);

    assert.notEqual(renderPromptsStart, -1, 'FramerHome.renderPrompts should exist');
    assert.notEqual(renderPromptsEnd, -1, 'FramerHome.renderPrompts should appear before renderShop');

    const renderPromptsSegment = framerSource.slice(renderPromptsStart, renderPromptsEnd);

    assert.match(
        renderPromptsSegment,
        /<div class="section-header fade-in-up visible" data-home-prompts-header="ready">/,
        'prompts heading should be visible immediately when prompt cards mount'
    );
    assert.match(
        renderPromptsSegment,
        /section\.className = 'prompts-masonry-section';/,
        'runtime prompt cards should use the masonry section class covered by critical prompt CSS'
    );
    assert.match(
        renderPromptsSegment,
        /class="masonry-card masonry-card-preview"[\s\S]*style="--home-prompt-card-ratio: \$\{promptCardRatio\}"/,
        'runtime prompt image skeletons should reserve a card ratio before images load'
    );
    assert.match(
        framerSource,
        /function bindHomepagePromptCardAspectRatioRelease\(section\)[\s\S]*card\.style\.setProperty\('--home-prompt-card-ratio', `\$\{image\.naturalWidth\} \/ \$\{image\.naturalHeight\}`\);[\s\S]*card\.dataset\.homePromptImageLoaded = '1';/,
        'prompt cards should keep a decoded natural image ratio before revealing the image over the skeleton'
    );
    assert.doesNotMatch(
        framerSource,
        /removeProperty\('--home-prompt-card-ratio'\)/,
        'prompt cards should not drop the reserved ratio at the same moment the image loads'
    );
});

test('homepage shop title paints before delayed product cards', () => {
    const indexSource = readRepoFile('index.html');
    const framerSource = readRepoFile('js/framer_home.js');
    const framerStyles = readRepoFile('css/framer_home.css');
    const criticalStyles = readRepoFile('css/framer_home_critical.css');
    const renderShopStart = framerSource.indexOf('  renderShop() {');
    const renderShopEnd = framerSource.indexOf('renderGongyi()', renderShopStart);

    assert.notEqual(renderShopStart, -1, 'FramerHome.renderShop should exist');
    assert.notEqual(renderShopEnd, -1, 'FramerHome.renderShop should appear before renderGongyi');

    const renderShopSegment = framerSource.slice(renderShopStart, renderShopEnd);

    assert.match(
        renderShopSegment,
        /<div class="section-header fade-in-up visible" data-home-shop-header="ready">/,
        'shop heading should be visible immediately when live products mount'
    );
    assert.match(
        renderShopSegment,
        /<div class="shop-carousel-wrapper" data-home-shop-staged="pending">[\s\S]*this\.scheduleHomeShopCarouselReveal\(section\);/,
        'shop product cards should be staged until after the heading has painted'
    );
    assert.match(
        renderShopSegment,
        /scheduleHomeShopCarouselReveal\(section\)[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame\(reveal\);/,
        'shop carousel reveal should wait for two animation frames before showing product cards'
    );
    assert.match(
        framerStyles,
        /\.shop-carousel-wrapper\[data-home-shop-staged="pending"\]\s*\{[\s\S]*opacity:\s*0;[\s\S]*transform:\s*translateY\(12px\);[\s\S]*\.shop-carousel-wrapper\[data-home-shop-staged="ready"\]\s*\{[\s\S]*opacity:\s*1;[\s\S]*transition:\s*opacity 0\.32s ease, transform 0\.32s ease;/,
        'shop carousel CSS should hide pending cards and fade in the ready state'
    );
    assert.match(
        criticalStyles,
        /20260517_HOME_SHOP_TITLE_FIRST_1[\s\S]*\.shop-carousel-wrapper\[data-home-shop-staged="pending"\]\s*\{[\s\S]*opacity:\s*0;[\s\S]*transform:\s*translateY\(12px\);/,
        'critical CSS should hide pending shop cards before deferred styles finish loading'
    );
    assert.equal(
        indexSource.includes('./js/framer_home.js?v=20260608_SUPPORT_CHANNEL_CLICK_FEEDBACK_3'),
        true,
        'index.html should cache-bust the shop title-first homepage runtime'
    );
    assert.equal(
        indexSource.includes('./css/framer_home.css?v=20260609_SUPPORT_COPY_REAL_CLIPBOARD_1'),
        true,
        'index.html should cache-bust the shop title-first homepage styles'
    );
});

test('homepage defers noncritical data boot scripts so HTML can reach the first-paint shell', () => {
    const indexSource = readRepoFile('index.html');
    const i18nSource = readRepoFile('js/i18n.js');
    const guestbookLoaderSource = readRepoFile('js/homepage-guestbook-modal-loader.js');
    const engagementLoaderSource = readRepoFile('js/engagement-runtime-loader.js');
    const vercelConfig = JSON.parse(readRepoFile('vercel.json'));
    const deferredScripts = [
        'vendor/supabase/2.95.3/supabase.js?v=20260519_VENDOR_PUBLIC_1',
        '/api/runtime/supabase-config',
        './js/runtime-supabase-config.js?v=20260510_REALTIME_GRACEFUL_FALLBACK_1',
        './supabase-client.js?v=20260504_NOTIFICATION_LOADING_VERTICAL_ONLY_1',
        './js/site-config.js?v=20260528_AVATAR_CANONICAL_CDN_1',
        './js/homepage-contract.js?v=20260512_HOMEPAGE_CONTRACT_VERIFY_I18N_1',
        './js/section-visibility.js?v=20260528_GONGYI_SITE_AWARE_1',
        './js/i18n.js?v=20260530_HOME_GONGYI_FATHER_KEY_1',
        './js/cache.js?v=20260512_HOME_CACHE_REFRESH_1',
        './js/homepage-prompts-data.js?v=20260501_HOME_PROMPTS_SUMMARY_1'
    ];

    assert.equal(
        indexSource.includes('./prompts-data.js?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1'),
        false,
        'homepage should not block first paint on the full prompt dataset'
    );
    assert.equal(
        indexSource.includes('./supabase-guestbook-functions.js?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1'),
        false,
        'homepage should not eagerly download the full guestbook data runtime'
    );
    assert.equal(
        indexSource.includes('./js/homepage-guestbook-modal.js?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1'),
        false,
        'homepage should not eagerly download the guestbook modal runtime'
    );
    assert.match(
        indexSource,
        /<script src="\.\/js\/homepage-guestbook-modal-loader\.js\?v=20260504_HOME_GUESTBOOK_LOADER_KEYBOARD_RETRACT_1&iosChromeKeyboard=20260514_ALL_KEYBOARD_RELEASE_1" defer><\/script>/,
        'homepage should keep only a small guestbook intent loader on the first load path'
    );
    assert.match(
        guestbookLoaderSource,
        /const HOMEPAGE_GUESTBOOK_RUNTIME_SOURCES = Object\.freeze\(\[[\s\S]*supabase-guestbook-functions\.js\?v=20260510_GUESTBOOK_R2_IMAGE_UPLOAD_1[\s\S]*homepage-guestbook-modal\.js\?v=20260504_HOME_GUESTBOOK_KEYBOARD_RETRACT_1/,
        'guestbook intent loader should own the deferred runtime sources'
    );
    assert.match(
        guestbookLoaderSource,
        /function openGuestbookModalIntentStub\(\)[\s\S]*loadHomepageGuestbookModalRuntime\(\)/,
        'guestbook intent loader should open the modal after loading deferred runtimes'
    );
    assert.equal(
        indexSource.includes('./js/engagement-runtime-loader.js?v=20260519_ANNOUNCEMENT_HAIRLINE_1'),
        true,
        'homepage should cache-bust the split engagement bootstrap'
    );
    assert.match(
        engagementLoaderSource,
        /function warmAnnouncementEagerly\(\)[\s\S]*function warmOnInteraction\(\) \{[\s\S]*ensureEngagementRuntime\(\{ includeAnnouncement: false \}\);/,
        'homepage engagement bootstrap should not pull announcement UI into the first user interaction path'
    );
    assert.match(
        engagementLoaderSource,
        /const ANNOUNCEMENT_BOOT_DELAY_MS = 0;[\s\S]*document\.addEventListener\('DOMContentLoaded', \(\) => \{[\s\S]*warmAnnouncementEagerly\(\);/,
        'homepage announcement runtime should warm soon after DOM readiness instead of waiting for the full page load'
    );
    assert.equal(
        i18nSource.includes('/lang/${lang}.json?v=${Date.now()}'),
        false,
        'homepage i18n should not force translation JSON to reload on every visit'
    );
    assert.match(
        i18nSource,
        /const I18N_ASSET_VERSION =/,
        'i18n should use a stable script-version cache key for language JSON'
    );
    assert.match(
        i18nSource,
        /fetch\(`\/lang\/\$\{lang\}\.json\?v=\$\{encodeURIComponent\(I18N_ASSET_VERSION\)\}`,\s*\{\s*cache: 'no-cache'\s*\}\)/,
        'i18n should revalidate language JSON so stale browser caches cannot overwrite fresh static nav copy'
    );
    assert.ok(
        vercelConfig.headers.some((entry) => {
            return entry.source === '/lang/:path*.json'
                && entry.has?.some((condition) => condition.type === 'query' && condition.key === 'v')
                && entry.headers?.some((header) => header.key === 'Cache-Control' && header.value === 'public, max-age=31536000, immutable');
        }),
        'versioned language JSON should get immutable CDN/browser cache headers'
    );
    assert.match(
        indexSource,
        /href="https:\/\/fonts\.googleapis\.com\/css2\?family=Inter:[^"]+&display=swap"\s+rel="stylesheet" media="print" data-deferred-style="1"/,
        'homepage should not block first paint on external Google font CSS'
    );
    assert.match(
        indexSource,
        /rel="stylesheet" href="vendor\/fontawesome\/6\.4\.0\/css\/all\.min\.css\?v=20260519_VENDOR_PUBLIC_1" media="print" data-deferred-style="1"/,
        'homepage should not block first paint on Font Awesome CSS'
    );

    for (const src of deferredScripts) {
        assert.match(
            indexSource,
            new RegExp(`<script src="${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" defer><\\/script>`),
            `${src} should be deferred on the homepage`
        );
    }
});
