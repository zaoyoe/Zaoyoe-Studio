const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('wallet loader and auth runtime prewarm the balance overview before modal open', () => {
    const walletLoaderSource = readRepoFile('js/wallet-modal-loader.js');
    const authSource = readRepoFile('supabase-auth-functions.js');

    const loaderMarkers = [
        "const VERSION = '20260423_WALLET_ORDER_DETAIL_FASTPATH_1';",
        "const POINTS_SERVICE_SRC = 'js/services/PointsService.js?v=20260423_WALLET_ORDER_DETAIL_FASTPATH_1';",
        "const WALLET_MODAL_SRC = 'js/components/WalletModal.js?v=20260423_WALLET_ORDER_DETAIL_FASTPATH_1';",
        'function ensurePointsServiceReady() {',
        'function warmWalletOverview(options = {}) {',
        'warmOverview: warmWalletOverview'
    ];

    for (const marker of loaderMarkers) {
        assert.equal(walletLoaderSource.includes(marker), true, `js/wallet-modal-loader.js should contain ${marker}`);
    }

    const authMarkers = [
        "function scheduleSupabaseAuthWalletWarmPrefetch(reason = 'auth-ready') {",
        "scheduleSupabaseAuthWalletWarmPrefetch('dropdown-open');",
        "scheduleSupabaseAuthWalletWarmPrefetch('initial-session');",
        "scheduleSupabaseAuthWalletWarmPrefetch('signed-in');",
        "reason === 'dropdown-open'"
    ];

    for (const marker of authMarkers) {
        assert.equal(authSource.includes(marker), true, `supabase-auth-functions.js should contain ${marker}`);
    }
});

test('wallet sidebar highlight hands off from active item styling to the indicator without double borders', () => {
    const walletModalSource = readRepoFile('js/components/WalletModal.js');
    const walletCssSource = readRepoFile('css/wallet.css');

    const modalMarkers = [
        'function resetWalletSidebarIndicatorState() {',
        "sidebar?.classList.remove('wallet-sidebar--indicator-ready');",
        "sidebar.classList.add('wallet-sidebar--indicator-ready');"
    ];

    for (const marker of modalMarkers) {
        assert.equal(walletModalSource.includes(marker), true, `js/components/WalletModal.js should contain ${marker}`);
    }

    const cssMarkers = [
        '.wallet-sidebar.wallet-sidebar--indicator-ready .wallet-menu-item.active {',
        '[data-theme="light"] .wallet-sidebar.wallet-sidebar--indicator-ready .wallet-menu-item.active {'
    ];

    for (const marker of cssMarkers) {
        assert.equal(walletCssSource.includes(marker), true, `css/wallet.css should contain ${marker}`);
    }
});
