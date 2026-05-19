const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const smoke = require('../scripts/engagement-public-visual-smoke');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('engagement public visual smoke parses coverage flags', () => {
    const options = smoke.parseArgs([
        '--pages', 'home,shop,gongyi',
        '--scenarios', 'desktop,dark',
        '--timeout-ms', '12345',
        '--skip-external'
    ]);

    assert.deepEqual(options.pages, ['home', 'shop', 'gongyi']);
    assert.deepEqual(options.scenarios, ['desktop', 'dark']);
    assert.equal(options.timeoutMs, 12345);
    assert.equal(options.skipExternal, true);
});

test('engagement public visual smoke covers local pages and external gongyi explicitly', () => {
    assert.deepEqual(smoke.DEFAULT_PAGES, ['home', 'prompts', 'shop', 'verify', 'guestbook', 'gongyi']);
    assert.equal(smoke.PAGE_DEFINITIONS.home.path, '/');
    assert.equal(smoke.PAGE_DEFINITIONS.prompts.path, '/prompts.html');
    assert.equal(smoke.PAGE_DEFINITIONS.shop.path, '/shop.html');
    assert.equal(smoke.PAGE_DEFINITIONS.verify.path, '/verify.html');
    assert.equal(smoke.PAGE_DEFINITIONS.guestbook.path, '/guestbook.html');
    assert.equal(smoke.PAGE_DEFINITIONS.gongyi.externalRedirect, true);
    assert.equal(smoke.PAGE_DEFINITIONS.gongyi.externalHost, 'sub2api.zaoyoe.com');
});

test('engagement public visual smoke feed item exercises route CTA and wallet cards', () => {
    const item = smoke.buildSmokeFeedItem('shop', { placement: 'robot_bubble' });

    assert.equal(item.page_id, 'shop');
    assert.equal(item.placement, 'robot_bubble');
    assert.equal(item.action_url, 'wallet://cards');
    assert.equal(item.dismiss_ttl_hours, 0);
    assert.equal(item.metadata.wallet_view, 'cards');
    assert.match(item.content, /My Wallet > Cards/);
});

test('engagement public visual smoke validates bubble dimensions and route links', () => {
    const failures = smoke.assertSmokeMetrics({
        exists: true,
        display: 'block',
        visibility: 'visible',
        opacity: 1,
        width: 320,
        height: 120,
        left: 20,
        top: 80,
        right: 340,
        bottom: 200,
        viewportWidth: 1366,
        viewportHeight: 860,
        role: 'status',
        ariaLive: 'polite',
        overflowViewport: false,
        hasRouteLink: true,
        routeText: 'My Wallet > Cards',
        backgroundColor: 'rgb(255, 255, 255)'
    }, {
        placement: 'robot_bubble',
        scenario: smoke.SCENARIO_DEFINITIONS.desktop
    });

    assert.deepEqual(failures, []);
});

test('engagement public visual smoke is wired into package scripts and contract checks', () => {
    const packageJson = JSON.parse(readRepoFile('package.json'));
    const scriptSource = readRepoFile('scripts/engagement-public-visual-smoke.js');

    assert.equal(packageJson.scripts['smoke:engagement-public'], 'node scripts/engagement-public-visual-smoke.js');
    assert.match(scriptSource, /createLocalPreviewApp/);
    assert.match(scriptSource, /ZaoyoeChatWidgetBootstrap\.warm/);
    assert.match(scriptSource, /window\.ZaoyoeEngagement\.refresh/);
    assert.match(scriptSource, /engagement-preview__path-link/);
    assert.match(scriptSource, /overflows viewport|overflowViewport/);
    assert.match(scriptSource, /route click did not open wallet cards/);
});
