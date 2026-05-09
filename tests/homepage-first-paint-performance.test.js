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
        indexSource.includes('./js/framer_home.js?v=20260508_HOME_BILINGUAL_RUNTIME_1'),
        true,
        'index.html should cache-bust the first-paint homepage runtime'
    );
    assert.equal(
        indexSource.includes('./css/framer_home_critical.css?v=20260504_HOME_SECTION_SHELLS_1'),
        true,
        'index.html should load a small blocking homepage critical stylesheet'
    );
    assert.match(
        indexSource,
        /<link rel="stylesheet" href="\.\/css\/framer_home\.css\?v=20260504_HOME_SECTION_SHELLS_1" media="print" data-deferred-style="1">/,
        'index.html should defer the full homepage stylesheet after the first-paint shell'
    );
    assert.equal(
        indexSource.includes('./css/framer_home.css?v=20260504_HOME_SECTION_SHELLS_1'),
        true,
        'index.html should keep cache-busting the full static hero stability styles'
    );
    assert.equal(
        indexSource.includes('./js/nav-auth-fast-paint.js?v=20260501_NAV_AUTH_FAST_PAINT_1'),
        true,
        'homepage should load the cached nav auth fast-paint helper before the lower auth runtime'
    );
    assert.ok(
        indexSource.indexOf('./js/nav-auth-fast-paint.js?v=20260501_NAV_AUTH_FAST_PAINT_1') < indexSource.indexOf('./supabase-auth-functions.js?v=20260509_GOOGLE_POPUP_ONLY_2'),
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

test('homepage deferred runtime does not force users back to the top after scroll', () => {
    const indexSource = readRepoFile('index.html');
    const scrollBootstrap = readRepoFile('js/index-scroll-bootstrap.js');
    const framerSource = readRepoFile('js/framer_home.js');

    assert.equal(
        indexSource.includes('./js/index-scroll-bootstrap.js?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1'),
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

test('homepage defers noncritical data boot scripts so HTML can reach the first-paint shell', () => {
    const indexSource = readRepoFile('index.html');
    const i18nSource = readRepoFile('js/i18n.js');
    const guestbookLoaderSource = readRepoFile('js/homepage-guestbook-modal-loader.js');
    const engagementLoaderSource = readRepoFile('js/engagement-runtime-loader.js');
    const vercelConfig = JSON.parse(readRepoFile('vercel.json'));
    const deferredScripts = [
        'https://unpkg.com/@supabase/supabase-js@2',
        '/api/runtime/supabase-config',
        './js/runtime-supabase-config.js?v=20260508_SITE_SCOPED_GOOGLE_CLIENT_IDS_1',
        './supabase-client.js?v=20260504_NOTIFICATION_LOADING_VERTICAL_ONLY_1',
        './js/site-config.js?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1',
        './js/homepage-contract.js?v=20260430_HOMEPAGE_BILINGUAL_FIELDS_1',
        './js/section-visibility.js?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1',
        './js/i18n.js?v=20260501_I18N_STABLE_LANG_CACHE_1',
        './js/cache.js?v=20260505_HOME_GUESTBOOK_PROFILE_NAME_1',
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
        /<script src="\.\/js\/homepage-guestbook-modal-loader\.js\?v=20260504_HOME_GUESTBOOK_LOADER_KEYBOARD_RETRACT_1" defer><\/script>/,
        'homepage should keep only a small guestbook intent loader on the first load path'
    );
    assert.match(
        guestbookLoaderSource,
        /const HOMEPAGE_GUESTBOOK_RUNTIME_SOURCES = Object\.freeze\(\[[\s\S]*supabase-guestbook-functions\.js\?v=20260507_REPLY_REALTIME_1[\s\S]*homepage-guestbook-modal\.js\?v=20260504_HOME_GUESTBOOK_KEYBOARD_RETRACT_1/,
        'guestbook intent loader should own the deferred runtime sources'
    );
    assert.match(
        guestbookLoaderSource,
        /function openGuestbookModalIntentStub\(\)[\s\S]*loadHomepageGuestbookModalRuntime\(\)/,
        'guestbook intent loader should open the modal after loading deferred runtimes'
    );
    assert.equal(
        indexSource.includes('./js/engagement-runtime-loader.js?v=20260504_NOTIFICATION_LOADING_VERTICAL_ONLY_1'),
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
        /fetch\(`\/lang\/\$\{lang\}\.json\?v=\$\{encodeURIComponent\(I18N_ASSET_VERSION\)\}`,\s*\{\s*cache: 'force-cache'\s*\}\)/,
        'i18n should fetch language JSON with browser-cache-friendly options'
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
        /rel="stylesheet" href="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/6\.0\.0\/css\/all\.min\.css" media="print" data-deferred-style="1"/,
        'homepage should not block first paint on external Font Awesome CSS'
    );

    for (const src of deferredScripts) {
        assert.match(
            indexSource,
            new RegExp(`<script src="${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" defer><\\/script>`),
            `${src} should be deferred on the homepage`
        );
    }
});
