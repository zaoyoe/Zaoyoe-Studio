const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function sliceSourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
    return source.slice(start, end);
}

test('shop success item hides order id and uses the old order area to reveal card content', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const shopCssSource = readRepoFile(path.join('css', 'shop-page.css'));
    const successItemSource = sliceSourceBetween(
        shopClientSource,
        'buildSuccessItemMarkup: function (item = {}, index = 0) {',
        'toggleSuccessItemContent: function'
    );

    assert.doesNotMatch(
        successItemSource,
        /copy-order-id|fullOrderId|orderNoLabel|copyOrderNoWithId|shop-success-item__submeta-value/,
        'success cards should not render or copy the order id'
    );
    assert.match(
        successItemSource,
        /const revealContentLabel = this\.trShop\('tapToViewCardContent', '点击查看卡密'\);/,
        'success cards should label the old order-id area as a card-content reveal control'
    );
    assert.match(
        successItemSource,
        /class="shop-success-item__reveal-code"[\s\S]*data-shop-success-action="toggle-item-content"[\s\S]*aria-controls="\$\{this\.escapeAttribute\(contentPanelId\)\}"/,
        'clicking the reveal control should reuse the existing card-content expansion action'
    );
    assert.doesNotMatch(
        successItemSource,
        /下单于/,
        'success cards should not prefix the timestamp with 下单于'
    );
    assert.match(
        shopClientSource,
        /item\.querySelectorAll\('\[data-shop-success-action="toggle-item-content"\]'\)\.forEach\(\(toggle\) => \{[\s\S]*toggle\.setAttribute\('aria-expanded', nextExpanded \? 'true' : 'false'\);/,
        'expanding card content should keep both the card surface and reveal button aria-expanded in sync'
    );
    assert.match(
        shopClientSource,
        /writeShopTextWithLegacyClipboard: async function \(text\) \{[\s\S]*document\.execCommand\('copy'\);[\s\S]*writeShopTextToClipboard: async function \(text\) \{[\s\S]*window\.isSecureContext[\s\S]*navigator\.clipboard\.writeText\(normalizedText\);[\s\S]*await this\.writeShopTextWithLegacyClipboard\(normalizedText\);/,
        'success modal copy actions should fall back to legacy textarea copy on non-secure mobile LAN previews'
    );
    assert.match(
        shopClientSource,
        /copySuccessCardContent: async function \(encodedText\) \{[\s\S]*await this\.writeShopTextToClipboard\(text\);/,
        'single card copy should use the shared shop clipboard helper'
    );
    assert.match(
        shopClientSource,
        /copyContent: async function \(\) \{[\s\S]*await this\.writeShopTextToClipboard\(text\);/,
        'copy-all should use the shared shop clipboard helper'
    );
    assert.match(
        shopCssSource,
        /\.shop-success-item__order-id,\s*\.shop-success-item__reveal-code \{/,
        'the reveal control should reuse the compact success-meta affordance styling'
    );
    assert.match(
        shopCssSource,
        /\.shop-success-item__footer-meta \{[\s\S]*padding-top: 14px;[\s\S]*transform: translateY\(10px\);/,
        'the reveal control row should sit visibly lower in the success card'
    );
    assert.match(
        shopCssSource,
        /\.shop-success-item__time \{[\s\S]*padding-top: 14px;[\s\S]*transform: translateY\(10px\);/,
        'the success timestamp should sit visibly lower in the success card'
    );
    assert.match(
        shopCssSource,
        /@media \(max-width: 720px\) \{[\s\S]*\.shop-success-item__time \{[\s\S]*padding-top: 10px;[\s\S]*transform: translateY\(10px\);/,
        'the mobile success timestamp should keep the same lower visual offset'
    );
});
