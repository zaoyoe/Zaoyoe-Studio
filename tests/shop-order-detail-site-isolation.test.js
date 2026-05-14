const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('public shop and wallet order detail routes scope orders to the active site', () => {
    const shopSource = readRepoFile(path.join('server', 'api-handlers', 'public', 'shop.js'));
    const walletSource = readRepoFile(path.join('server', 'api-handlers', 'public', 'wallet.js'));

    assert.match(
        shopSource,
        /async function loadShopOrderDetail[\s\S]*\.from\('shop_orders'\)[\s\S]*\.eq\('id', normalizedOrderId\)[\s\S]*\.eq\('user_id', normalizedUserId\)[\s\S]*\.eq\('site', site\)[\s\S]*\.single\(\)/,
        'shop order detail should not return an order from another site'
    );
    assert.match(
        walletSource,
        /async function loadWalletShopOrderDetail[\s\S]*\.from\('shop_orders'\)[\s\S]*\.eq\('id', normalizedOrderId\)[\s\S]*\.eq\('user_id', normalizedUserId\)[\s\S]*\.eq\('site', site\)[\s\S]*\.single\(\)/,
        'wallet order detail should not return an order from another site'
    );
});
