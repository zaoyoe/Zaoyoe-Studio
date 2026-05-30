const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const PAGE_PATHS = [
    'index.html',
    'prompts.html',
    'shop.html',
    'verify.html',
    'guestbook.html'
];
const NAV_LABEL_PAGE_PATHS = [
    ...PAGE_PATHS,
    'privacy.html',
    'reset-password.html'
];

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function extractSupportMobileBlock(source) {
    const match = source.match(/<div class="mobile-submenu" id="support-mobile">([\s\S]*?)<\/div>/);
    return match ? match[1] : '';
}

test('primary pages place verify before gongyi and shop after gongyi', () => {
    PAGE_PATHS.forEach((relativePath) => {
        const source = readRepoFile(relativePath);
        const promptsIndex = source.indexOf('href="/prompts.html"');
        const verifyIndex = source.indexOf('href="/verify.html"');
        const gongyiIndex = source.indexOf('href="https://sub2api.fatherkey.com"');
        const shopIndex = source.indexOf('href="/shop.html"');

        assert.ok(promptsIndex >= 0, `${relativePath} should include the prompts nav link`);
        assert.ok(verifyIndex >= 0, `${relativePath} should include the verify nav link`);
        assert.ok(gongyiIndex >= 0, `${relativePath} should include the gongyi nav link`);
        assert.ok(shopIndex >= 0, `${relativePath} should include the shop nav link`);
        assert.ok(
            promptsIndex < verifyIndex && verifyIndex < gongyiIndex && gongyiIndex < shopIndex,
            `${relativePath} should place verify after prompts, then gongyi, then shop`
        );
    });
});

test('gongyi top nav label uses Father Key branding in zh and en', () => {
    NAV_LABEL_PAGE_PATHS.forEach((relativePath) => {
        const source = readRepoFile(relativePath);
        const desktopNavLabel = 'data-i18n="nav.gongyi">核心秘钥</a>';
        const mobileNavLabel = 'class="mobile-menu-link" data-i18n="nav.gongyi">核心秘钥</a>';

        assert.ok(source.includes(desktopNavLabel), `${relativePath} should seed the zh gongyi desktop nav label`);
        assert.ok(source.includes(mobileNavLabel), `${relativePath} should seed the zh gongyi mobile nav label`);
    });

    const zh = JSON.parse(readRepoFile('lang/zh.json'));
    const en = JSON.parse(readRepoFile('lang/en.json'));
    const i18nRuntime = readRepoFile('js/i18n.js');
    const framerRuntime = readRepoFile('js/framer_home.js');
    const prefetchRuntime = readRepoFile('js/prefetch-home.js');

    assert.equal(zh.nav.gongyi, '核心秘钥');
    assert.equal(en.nav.gongyi, 'Father Key');
    assert.equal(zh.home.entries.gongyi, '核心秘钥');
    assert.equal(en.home.entries.gongyi, 'Father Key');
    assert.equal(zh.home.gongyi.title, '核心秘钥');
    assert.equal(en.home.gongyi.title, 'Father Key');
    assert.match(i18nRuntime, /'nav\.gongyi': Object\.freeze\(\{ value: '核心秘钥'/);
    assert.match(i18nRuntime, /'nav\.gongyi': Object\.freeze\(\{ value: 'Father Key'/);
    assert.match(i18nRuntime, /'home\.entries\.gongyi': Object\.freeze\(\{ value: '核心秘钥'/);
    assert.match(i18nRuntime, /'home\.entries\.gongyi': Object\.freeze\(\{ value: 'Father Key'/);
    assert.match(framerRuntime, /function resolveHomepageGongyiBrandName\(value\)[\s\S]*en: 'Father Key'[\s\S]*legacyLabels[\s\S]*'API Relay'/);
    assert.match(prefetchRuntime, /function resolveGongyiBrandName\(value\)[\s\S]*en: 'Father Key'[\s\S]*legacyLabels[\s\S]*'API Relay'/);
});

test('support mobile submenu removes status and does not nest gongyi', () => {
    PAGE_PATHS.forEach((relativePath) => {
        const supportBlock = extractSupportMobileBlock(readRepoFile(relativePath));
        assert.equal(supportBlock.includes('https://status.zaoyoe.com'), false, `${relativePath} support submenu should not keep the status link`);
        assert.equal(supportBlock.includes('https://sub2api.fatherkey.com'), false, `${relativePath} support submenu should not keep the gongyi link`);
    });
});

test('homepage footer places gongyi product link directly after shop', () => {
    const source = readRepoFile('index.html');
    const promptsIndex = source.indexOf('data-i18n="footer.products.prompts"');
    const shopIndex = source.indexOf('data-i18n="footer.products.shop"');
    const gongyiIndex = source.indexOf('data-i18n="footer.products.gongyi"');
    const verifyIndex = source.indexOf('data-i18n="footer.products.verify"');
    const guestbookIndex = source.indexOf('data-i18n="footer.products.guestbook"');

    assert.ok(promptsIndex >= 0, 'homepage footer should include prompts product link');
    assert.ok(shopIndex >= 0, 'homepage footer should include shop product link');
    assert.ok(gongyiIndex >= 0, 'homepage footer should include gongyi product link');
    assert.ok(verifyIndex >= 0, 'homepage footer should include verify product link');
    assert.ok(guestbookIndex >= 0, 'homepage footer should include guestbook product link');
    assert.ok(
        promptsIndex < shopIndex && shopIndex < gongyiIndex && gongyiIndex < verifyIndex && verifyIndex < guestbookIndex,
        'homepage footer product links should place gongyi directly after shop'
    );
});

test('homepage defaults keep gongyi hero entry directly before shop', () => {
    const runtimeSource = readRepoFile('js/framer_home.js');
    const adminSource = readRepoFile('admin-homepage.js');

    const runtimeGongyiIndex = runtimeSource.indexOf("{ id: 'gongyi'");
    const runtimeShopIndex = runtimeSource.indexOf("{ id: 'shop'");
    const runtimeVerifyIndex = runtimeSource.indexOf("{ id: 'verify'");
    assert.ok(runtimeShopIndex >= 0 && runtimeGongyiIndex >= 0 && runtimeVerifyIndex >= 0, 'runtime hero defaults should include shop, gongyi, and verify');
    assert.ok(runtimeGongyiIndex < runtimeShopIndex && runtimeShopIndex < runtimeVerifyIndex, 'runtime hero defaults should place gongyi before shop and shop before verify');

    const adminGongyiIndex = adminSource.indexOf("{ id: 'gongyi'");
    const adminShopIndex = adminSource.indexOf("{ id: 'shop'");
    const adminVerifyIndex = adminSource.indexOf("{ id: 'verify'");
    assert.ok(adminShopIndex >= 0 && adminGongyiIndex >= 0 && adminVerifyIndex >= 0, 'admin hero defaults should include shop, gongyi, and verify');
    assert.ok(adminGongyiIndex < adminShopIndex && adminShopIndex < adminVerifyIndex, 'admin hero defaults should place gongyi before shop and shop before verify');
});

test('homepage inserts gongyi section between shop and verify, and admin exposes gongyi editor', () => {
    const homepageSource = readRepoFile('index.html');
    const adminStudioSource = readRepoFile('admin-studio.html');

    const shopSectionIndex = homepageSource.indexOf('id="shop-section"');
    const gongyiSectionIndex = homepageSource.indexOf('id="gongyi-section"');
    const verifySectionIndex = homepageSource.indexOf('id="verify-section"');

    assert.ok(shopSectionIndex >= 0 && gongyiSectionIndex >= 0 && verifySectionIndex >= 0, 'homepage should include shop, gongyi, and verify sections');
    assert.ok(shopSectionIndex < gongyiSectionIndex && gongyiSectionIndex < verifySectionIndex, 'homepage should place gongyi between shop and verify');
    assert.ok(adminStudioSource.includes('data-hp-section="gongyi"'), 'admin studio should expose a gongyi homepage tab');
    assert.ok(adminStudioSource.includes('data-hp-view="gongyi"'), 'admin studio should expose a gongyi homepage panel');
});
