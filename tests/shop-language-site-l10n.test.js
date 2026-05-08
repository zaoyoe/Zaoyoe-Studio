const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('shop runtime derives points label from current language instead of site', () => {
    const siteConfigSource = readRepoFile('js/site-config.js');
    const shopClientSource = readRepoFile('js/shop-client.js');

    assert.match(
        siteConfigSource,
        /window\.i18n\?\.getCurrentLanguage\?\.\(\)/,
        'SiteConfig.getPointsLabel should prioritize the current i18n language'
    );
    assert.match(
        shopClientSource,
        /getShopPointsLabel: function \(\{ lowercaseEnglish = false \} = \{\}\)/,
        'shop client should keep a shared helper for localized points labels'
    );
    assert.doesNotMatch(
        shopClientSource,
        /window\.SiteConfig\?\.getPointsLabel\(\) \|\| window\.i18n\?\.t\('shop\.points'\) \|\| '积分'/,
        'shop client should not keep a site-biased inline fallback for points labels'
    );
});

test('shop category aliases localize for zh and en storefront views', () => {
    const zh = JSON.parse(readRepoFile('lang/zh.json'));
    const en = JSON.parse(readRepoFile('lang/en.json'));
    const shopClientSource = readRepoFile('js/shop-client.js');

    assert.deepEqual(zh.shop.categoryLabels, {
        communityAccess: '公益站',
        virtualCard: '虚拟卡',
        account: '账号',
        other: '其他'
    }, 'Chinese shop translations should define canonical category labels');
    assert.deepEqual(en.shop.categoryLabels, {
        communityAccess: 'Community Access',
        virtualCard: 'Virtual Card',
        account: 'Account',
        other: 'Other'
    }, 'English shop translations should define canonical category labels');
    assert.match(
        shopClientSource,
        /normalizeProductCategoryAliasKey: function \(value = ''\)/,
        'shop client should normalize category aliases before translation'
    );
    assert.match(
        shopClientSource,
        /window\.i18n\?\.t\(`shop\.categoryLabels\.\$\{translationKey\}`\)/,
        'shop client should resolve category names through translation keys when available'
    );
});

test('shop cart copy keeps zh storefront copy free from leaked english labels', () => {
    const shopClientSource = readRepoFile('js/shop-client.js');

    assert.match(
        shopClientSource,
        /drawerEyebrow: '浮动购物车'/,
        'Chinese cart drawer eyebrow should stay localized'
    );
    assert.match(
        shopClientSource,
        /checkoutReviewEyebrow: '购物车确认'/,
        'Chinese cart review eyebrow should stay localized'
    );
});
