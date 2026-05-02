const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('shop purchase modal remains scrollable when the mobile keyboard docks it', () => {
    const shopStyles = readRepoFile(path.join('css', 'shop-page.css'));
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const shopHtml = readRepoFile('shop.html');

    assert.equal(
        shopHtml.includes('css/shop-page.css?v=20260502_PURCHASE_MODAL_KEYBOARD_SCROLL_1'),
        true,
        'shop.html should load the keyboard-scroll cache-busted storefront stylesheet'
    );

    assert.match(
        shopStyles,
        /#shopPurchaseModal \.modal-content\.shop-purchase-height-locked \{[\s\S]*overflow-y: auto !important;[\s\S]*overflow-x: hidden !important;/,
        'keyboard-locked purchase modal height should still expose a scrollable content area'
    );

    assert.match(
        shopStyles,
        /@media \(max-width: 768px\) \{[\s\S]*#shopPurchaseModal \.modal-content \{[\s\S]*overflow-y: auto !important;[\s\S]*-webkit-overflow-scrolling: touch;[\s\S]*touch-action: pan-y;[\s\S]*scroll-padding-bottom: calc\(96px \+ env\(safe-area-inset-bottom, 0px\)\);/s,
        'mobile purchase modal content should be the scroll container accepted by the iOS scroll lock'
    );

    assert.match(
        shopClientSource,
        /schedulePurchaseModalKeyboardContentSync:\s*function\s*\(/,
        'shop-client.js should schedule a dock refresh after modal content changes'
    );

    assert.match(
        shopClientSource,
        /const liveScrollHeight = Math\.round\(card\.scrollHeight \|\| 0\);[\s\S]*const baseCardHeight = Math\.max\(320,[\s\S]*liveScrollHeight\);/,
        'keyboard dock height should account for the full scrollHeight of coupon-rich modal content'
    );

    assert.match(
        shopClientSource,
        /renderPurchaseDiscountAssets:\s*function\s*\(\) \{[\s\S]*this\.schedulePurchaseModalKeyboardContentSync\(\);[\s\S]*this\.schedulePurchaseModalKeyboardContentSync\(\);[\s\S]*\},/,
        'discount asset rendering should resync the dock for both empty/loading and populated states'
    );
});
