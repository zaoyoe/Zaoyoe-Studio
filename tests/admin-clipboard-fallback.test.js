const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('admin studio installs a clipboard fallback before admin modules load', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const bootstrapSource = readRepoFile(path.join('js', 'admin-studio-bootstrap.js'));
    const bootstrapScriptIndex = adminHtml.indexOf('js/admin-studio-bootstrap.js?v=20260503_ADMIN_CLIPBOARD_FALLBACK_1');

    assert.notEqual(bootstrapScriptIndex, -1, 'admin-studio.html should load the cache-busted clipboard fallback bootstrap');
    [
        'admin-users.js?',
        'admin-discounts.js?',
        'admin-comments.js?',
        'js/admin-payments.js?',
        'admin-homepage.js?',
        'js/admin-tickets.js?',
        'admin-studio.js?',
        'js/admin-shop.js?'
    ].forEach((scriptMarker) => {
        const moduleIndex = adminHtml.indexOf(scriptMarker);
        assert.notEqual(moduleIndex, -1, `admin-studio.html should include ${scriptMarker}`);
        assert.ok(
            bootstrapScriptIndex < moduleIndex,
            `admin clipboard fallback should load before ${scriptMarker}`
        );
    });

    assert.match(
        bootstrapSource,
        /async function writeAdminTextWithLegacyClipboard\(text\) \{[\s\S]*document\.execCommand\('copy'\);/,
        'admin bootstrap should provide a textarea-based legacy copy fallback'
    );
    assert.match(
        bootstrapSource,
        /function installAdminClipboardFallback\(\) \{[\s\S]*navigator\.clipboard[\s\S]*Object\.defineProperty\(clipboardTarget, 'writeText'[\s\S]*Object\.defineProperty\(navigator, 'clipboard'[\s\S]*window\.AdminClipboard = Object\.freeze/,
        'admin bootstrap should patch navigator.clipboard.writeText and expose AdminClipboard'
    );
    assert.match(
        bootstrapSource,
        /Clipboard API failed, trying legacy copy/,
        'admin clipboard wrapper should fall back after native Clipboard API failures'
    );
});
