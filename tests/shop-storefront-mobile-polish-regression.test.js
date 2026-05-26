const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('shop mobile storefront keeps card corners clean and guidance height animation enabled', () => {
    const shopHtmlSource = readRepoFile('shop.html');
    const shopCssSource = readRepoFile(path.join('css', 'shop-page.css'));

    assert.equal(
        shopHtmlSource.includes('storefrontMobilePolish=20260526_SHOP_STOREFRONT_MOBILE_POLISH_1'),
        true,
        'shop.html should bust the stylesheet cache for the storefront mobile polish fixes'
    );
    assert.match(
        shopCssSource,
        /\.shop-card-breathe-frame\s*\{[^}]*overflow:\s*visible;[^}]*contain:\s*layout;[^}]*isolation:\s*isolate;/,
        'product cards should not use paint containment on the breathe frame because it clips the rounded card shadow into square gray corners'
    );
    assert.doesNotMatch(
        shopCssSource,
        /\.shop-card-breathe-frame\s*\{[^}]*contain:\s*layout paint;/,
        'product card breathe frames should avoid layout-paint containment'
    );
    assert.match(
        shopCssSource,
        /@media \(max-width: 768px\) \{[\s\S]*#shopPurchaseModal \.modal-content,[\s\S]*transition:\s*none !important;[\s\S]*#shopPurchaseModal \.modal-content\.shop-purchase-notes-height-animating,[\s\S]*height 240ms cubic-bezier\(0\.22, 1, 0\.36, 1\),[\s\S]*max-height 240ms cubic-bezier\(0\.22, 1, 0\.36, 1\) !important;/,
        'mobile purchase modal should restate the height transition after the base transition reset so notes and usage disclosures animate'
    );
});
