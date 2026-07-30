const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const framerHomeScriptPath = path.resolve(__dirname, '../js/framer_home.js');
const framerHomeStylesPath = path.resolve(__dirname, '../css/framer_home.css');
const prefetchHomeScriptPath = path.resolve(__dirname, '../js/prefetch-home.js');

test('homepage shop carousel script repeats products into measured loop groups', () => {
    const script = fs.readFileSync(framerHomeScriptPath, 'utf8');

    assert.match(script, /HOME_SHOP_CAROUSEL_CARD_WIDTH = 200/);
    assert.match(script, /getHomeViewportWidth\(\)/);
    assert.match(script, /function getHomeLoopPixelsPerSecond\(speedValue\)/);
    assert.match(script, /function getHomeLoopDurationSeconds\(cycleWidth, speedValue\)/);
    assert.match(script, /const repeatCount = baseSequenceWidth > 0/);
    assert.match(script, /class="shop-carousel-group" data-home-shop-cycle="1"/);
    assert.match(script, /class="shop-carousel-group" aria-hidden="true"/);
    assert.match(script, /data-home-speed-value="\$\{shopSpeed\}"/);
    assert.match(script, /getHomeLoopDurationSeconds\(cycleWidth, speedValue\)/);
    assert.match(script, /--home-shop-cycle-width/);
});

test('homepage shop supplemental refresh keeps the carousel DOM when products are unchanged', () => {
    const script = fs.readFileSync(framerHomeScriptPath, 'utf8');

    assert.match(script, /function buildHomepageShopRenderSignature\(products = \[\], config = \{\}, speedValue = ''\)/);
    assert.match(script, /const previousSignature = buildHomepageShopRenderSignature\(/);
    assert.match(script, /const nextSignature = buildHomepageShopRenderSignature\(/);
    assert.match(script, /if \(previousSignature !== nextSignature \|\| !document\.querySelector\('#shop-section \[data-home-shop-id\]'\)\) \{\s*this\.renderShop\(\);\s*\}/);
});

test('homepage shop carousel styles animate by measured cycle width', () => {
    const styles = fs.readFileSync(framerHomeStylesPath, 'utf8');

    assert.match(styles, /\.shop-carousel-group\s*\{/);
    assert.match(styles, /padding:\s*0;/);
    assert.match(styles, /translate3d\(calc\(-1 \* var\(--home-shop-cycle-width, 50%\)\), 0, 0\)/);
    assert.match(styles, /will-change:\s*transform/);
});

test('homepage ticker script uses product categories and measured loop groups', () => {
    const script = fs.readFileSync(framerHomeScriptPath, 'utf8');

    assert.match(script, /function configureHomeMeasuredLoopTrack\(track, items, renderItem/);
    assert.match(script, /function getHomepageConfigLastUpdatedAt\(\)/);
    assert.match(script, /const configUpdatedAt = getHomepageConfigLastUpdatedAt\(\);/);
    assert.match(script, /prefetch\.timestamp \|\| 0\) >= configUpdatedAt/);
    assert.match(script, /this\.cachedData\.ticker = await this\.buildTickerData\(this\.config\.ticker \|\| \{\}\);/);
    assert.match(script, /const productCategories = Array\.from\(new Set/);
    assert.match(script, /shopScrollSpeed: config\.shop_scroll_speed \|\| config\.speed \|\| 30/);
    assert.match(script, /const tickerSpeed = data\.speed \|\| 30/);
    assert.match(script, /data-home-speed-value="\$\{tickerSpeed\}"/);
    assert.match(script, /speedValue: tickerSpeed/);
    assert.match(script, /data-home-ticker-role="top"/);
    assert.match(script, /data-home-ticker-role="bottom"/);
    assert.match(script, /groupClassName: 'ticker-track-group'/);
    assert.match(script, /cycleWidthVar: '--home-ticker-cycle-width'/);
});

test('homepage ticker styles animate by measured ticker cycle width', () => {
    const styles = fs.readFileSync(framerHomeStylesPath, 'utf8');

    assert.match(styles, /\.ticker-track-group\s*\{/);
    assert.match(styles, /translate3d\(calc\(-1 \* var\(--home-ticker-cycle-width, 50%\)\), 0, 0\)/);
    assert.match(styles, /\.ticker-left \.ticker-track\s*\{[\s\S]*animation-name:\s*scroll-left;/);
    assert.match(styles, /\.ticker-right \.ticker-track\s*\{[\s\S]*animation-name:\s*scroll-right;/);
    assert.match(styles, /\.ticker-track\s*\{[\s\S]*width:\s*max-content;/);
});

test('homepage prefetch script stores ticker data with current speed keys and categories', () => {
    const script = fs.readFileSync(prefetchHomeScriptPath, 'utf8');

    assert.match(script, /const HOMEPAGE_PREFETCH_CACHE_KEY = 'homepage_prefetch';/);
    assert.match(script, /const HOMEPAGE_CONFIG_LAST_UPDATED_KEY = 'homepage_config_last_updated_at';/);
    assert.match(script, /function getHomepagePrefetchCacheKey\(site = getCurrentSite\(\)\)/);
    assert.match(script, /function getHomepageConfigLastUpdatedKey\(site = getCurrentSite\(\)\)/);
    assert.match(script, /sessionStorage\.setItem\(getHomepagePrefetchCacheKey\(currentSite\), JSON\.stringify\(/);
    assert.match(script, /const productCategories = Array\.from\(new Set/);
    assert.match(script, /bottom: productCategories/);
    assert.match(script, /speed: config\.ticker\?\.speed \|\| 30/);
    assert.match(script, /shopScrollSpeed: config\.ticker\?\.shop_scroll_speed \|\| config\.ticker\?\.speed \|\| 30/);
});
