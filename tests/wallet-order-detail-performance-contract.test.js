const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('wallet shop order detail reads route through PointsService cache and modal prefetch hooks', () => {
    const pointsServiceSource = readRepoFile('js/services/PointsService.js');
    const walletModalSource = readRepoFile('js/components/WalletModal.js');

    const pointsServiceMarkers = [
        'const WALLET_SHOP_ORDER_DETAIL_CACHE_TTL_MS = 60_000;',
        'peekWalletShopOrderDetail({ orderId = \'\' } = {})',
        'getWalletShopOrderDetail({ orderId = \'\', force = false } = {})',
        "this._postWalletJson('/api/wallet/order-detail', {",
        'this._shopOrderDetailPromises = new Map()'
    ];

    for (const marker of pointsServiceMarkers) {
        assert.equal(pointsServiceSource.includes(marker), true, `js/services/PointsService.js should contain ${marker}`);
    }

    const walletMarkers = [
        'prefetchShopOrderDetails(orders = [], { limit = 4 } = {})',
        'this.prefetchShopOrderDetails(this._prefetchedShopOrders, { limit: 4 });',
        'this.prefetchShopOrderDetails(orders, { limit: 4 });',
        'buildWalletShopOrderPreviewMarkup(orderId = \'\', previewOrder = {})',
        'const previewOrder = this.findShopOrderPreview(orderId);',
        'pointsService?.peekWalletShopOrderDetail?.({ orderId })',
        'await pointsService.getWalletShopOrderDetail({ orderId })'
    ];

    for (const marker of walletMarkers) {
        assert.equal(walletModalSource.includes(marker), true, `js/components/WalletModal.js should contain ${marker}`);
    }
});

test('shop order detail handler skips unnecessary item lookups and parallelizes guidance loading', () => {
    const shopHandlerSource = readRepoFile('server/api-handlers/public/shop.js');

    const markers = [
        "const needsOrderItems = normalizedItemCount > 1 || !String(order?.inventory_id || '').trim();",
        'const guidancePromise = (async () => {',
        'const [orderItems, guidance] = await Promise.all(['
    ];

    for (const marker of markers) {
        assert.equal(shopHandlerSource.includes(marker), true, `server/api-handlers/public/shop.js should contain ${marker}`);
    }
});
