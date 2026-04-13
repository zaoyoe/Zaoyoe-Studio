const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('shop unauthenticated redeem flow opens the auth sheet directly without blocking alerts', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const injectAuthSource = readRepoFile('inject-auth.js');

    assert.match(
        shopClientSource,
        /promptLoginForPurchase:\s*function\s*\(/,
        'shop-client.js should centralize guest redeem login prompts so the auth sheet can open smoothly'
    );
    assert.match(
        shopClientSource,
        /window\.openLoginModalWithMessage/,
        'shop-client.js should use the shared auth helper when a guest taps redeem'
    );
    assert.doesNotMatch(
        shopClientSource,
        /alert\(window\.i18n\?\.t\('shop\.loginRequired'\)/,
        'shop-client.js should no longer rely on a blocking alert before opening the auth sheet'
    );
    assert.match(
        injectAuthSource,
        /window\.openLoginModalWithMessage = openLoginModalWithMessage;/,
        'inject-auth.js should expose a helper for opening the auth sheet with a contextual message'
    );
});
