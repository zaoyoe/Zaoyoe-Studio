const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('shop redemption success modal background board is completely opaque without semi-transparency or blur', () => {
    const shopCss = readRepoFile(path.join('css', 'shop-page.css'));

    // Dark theme / default modal card
    assert.match(
        shopCss,
        /#shopSuccessModal \.modal-content,\s*#shopSuccessModal \.modal-content\.shop-success-modal\s*\{[\s\S]*?background:\s*linear-gradient\(180deg,\s*#0e141d 0%,\s*#080c12 100%\)\s*!important;[\s\S]*?backdrop-filter:\s*none\s*!important;[\s\S]*?-webkit-backdrop-filter:\s*none\s*!important;/s,
        'dark success modal background board must use opaque linear-gradient and disable backdrop-filter'
    );

    // Light theme modal card
    assert.match(
        shopCss,
        /html:not\(\[data-theme="dark"\]\) body\.shop-page #shopSuccessModal \.modal-content[\s\S]*?background:\s*#ffffff\s*!important;[\s\S]*?backdrop-filter:\s*none\s*!important;[\s\S]*?-webkit-backdrop-filter:\s*none\s*!important;/s,
        'light success modal background board must use solid #ffffff and disable backdrop-filter'
    );

    // Inner plain shell and warning card
    assert.match(
        shopCss,
        /#shopSuccessModal \.shop-success-content-shell--plain\s*\{[\s\S]*?backdrop-filter:\s*none\s*!important;[\s\S]*?-webkit-backdrop-filter:\s*none\s*!important;/s,
        'inner plain delivery content shell must clear backdrop-filter'
    );

    assert.match(
        shopCss,
        /#shopSuccessModal #purchasedWarning\s*\{[\s\S]*?backdrop-filter:\s*none\s*!important;[\s\S]*?-webkit-backdrop-filter:\s*none\s*!important;/s,
        'warning card must clear backdrop-filter'
    );
});
