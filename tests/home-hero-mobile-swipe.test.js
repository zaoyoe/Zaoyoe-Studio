const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('mobile hero uses native horizontal scrolling and settles swipes without opening a link', () => {
    const source = readRepoFile('js/framer_home.js');
    const marker = source.indexOf('20260727_HOME_HERO_NATIVE_SWIPE_1');
    const clickBehavior = source.indexOf('// Click behavior: center card first, then navigate', marker);
    const touchSegment = source.slice(marker, clickBehavior);

    assert.notEqual(marker, -1, 'hero swipe runtime marker should exist');
    assert.notEqual(clickBehavior, -1, 'hero swipe runtime should precede card click handling');
    assert.match(touchSegment, /addEventListener\('touchstart'/);
    assert.match(touchSegment, /addEventListener\('touchmove'/);
    assert.match(touchSegment, /addEventListener\('touchend'/);
    assert.match(touchSegment, /addEventListener\('touchcancel'/);
    assert.doesNotMatch(
        touchSegment,
        /touchmove[\s\S]*carousel\.scrollLeft\s*=/,
        'touchmove must not fight the browser by writing scrollLeft during native scrolling'
    );
    assert.match(touchSegment, /touchAxis === 'horizontal'/);
    assert.match(touchSegment, /centerCard\(targetIndex\)/);
    assert.match(source, /performance\.now\(\) < suppressClickUntil[\s\S]*e\.preventDefault\(\);[\s\S]*e\.stopPropagation\(\);/);
});

test('mobile hero swipe affordance is present without growing the critical stylesheet', () => {
    const styles = readRepoFile('css/framer_home.css');
    const criticalStyles = readRepoFile('css/framer_home_critical.css');
    const homepage = readRepoFile('index.html');

    assert.match(styles, /20260727_HOME_HERO_NATIVE_SWIPE_1/);
    assert.match(styles, /\.hero-carousel\s*\{[\s\S]*touch-action:\s*pan-x pan-y pinch-zoom;[\s\S]*overscroll-behavior-x:\s*contain;/);
    assert.match(styles, /\.entry-card\s*\{[\s\S]*touch-action:\s*manipulation;/);
    assert.match(styles, /\.hero-carousel\.is-dragging\s*\{[\s\S]*scroll-snap-type:\s*none;/);
    assert.match(
        criticalStyles,
        /\.entry-card\s*\{[\s\S]*touch-action:\s*manipulation;/,
        'critical CSS should keep its compact native pan-compatible touch action'
    );
    assert.equal(
        (homepage.match(/heroSwipe=20260727_HOME_HERO_NATIVE_SWIPE_1/g) || []).length,
        2,
        'homepage should cache-bust the deferred CSS and hero runtime'
    );
});
