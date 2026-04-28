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
        "const VERSION = '20260428_WALLET_MOBILE_NAV_STABLE_1';",
        "const POINTS_SERVICE_SRC = 'js/services/PointsService.js?v=20260428_WALLET_MOBILE_NAV_STABLE_1';",
        "const WALLET_MODAL_SRC = 'js/components/WalletModal.js?v=20260428_WALLET_MOBILE_NAV_STABLE_1';",
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

test('wallet sidebar highlight keeps mobile tab measurements stable while sliding the indicator', () => {
    const walletModalSource = readRepoFile('js/components/WalletModal.js');
    const walletCssSource = readRepoFile('css/wallet.css');

    const modalMarkers = [
        'function resetWalletSidebarIndicatorState() {',
        "sidebar?.classList.remove('wallet-sidebar--indicator-ready');",
        'const isCompactMobile = isWalletModalCompactMobile();',
        'const minReadyWidth = isCompactMobile ? 48 : 1;',
        "indicator.dataset.walletPendingRetry = '1';",
        "indicator.classList.add('sidebar-indicator--settling');",
        "indicator.classList.remove('sidebar-indicator--settling');",
        "sidebar.classList.add('wallet-sidebar--indicator-ready');"
    ];

    for (const marker of modalMarkers) {
        assert.equal(walletModalSource.includes(marker), true, `js/components/WalletModal.js should contain ${marker}`);
    }

    const cssMarkers = [
        '.wallet-sidebar.wallet-sidebar--indicator-ready .wallet-menu-item.active {',
        '[data-theme="light"] .wallet-sidebar.wallet-sidebar--indicator-ready .wallet-menu-item.active {',
        '.sidebar-indicator.sidebar-indicator--settling {',
        '/* 20260428_WALLET_MOBILE_NAV_STABLE_1 */',
        '.sidebar-indicator {\n        display: block;',
        'width: clamp(58px, 14.5vw, 76px);',
        'height: 70px;',
        'flex: 0 0 clamp(58px, 14.5vw, 76px);',
        'html[data-theme="light"] .wallet-sidebar .sidebar-indicator',
        'html[data-theme="light"] .wallet-sidebar:focus-within .sidebar-indicator',
        'html[data-theme="light"] .wallet-sidebar.wallet-sidebar--indicator-ready .wallet-menu-item:focus-visible',
        'box-shadow: none !important;'
    ];

    for (const marker of cssMarkers) {
        assert.equal(walletCssSource.includes(marker), true, `css/wallet.css should contain ${marker}`);
    }

    assert.ok(
        walletCssSource.indexOf('/* 20260428_WALLET_MOBILE_NAV_STABLE_1 */') >
        walletCssSource.indexOf('[data-theme="light"] .wallet-sidebar.wallet-sidebar--indicator-ready .wallet-menu-item.active {'),
        'mobile light focus frame override should be defined after the desktop light indicator handoff'
    );

    const menuMarkers = [
        '<button type="button" class="wallet-menu-item active" data-view="balance" aria-current="page" aria-controls="view-balance"',
        "item.setAttribute('aria-current', 'page');",
        "item.removeAttribute('aria-current');",
        "this.updateIndicatorPosition(menuItem);",
        "updateIndicatorPosition(targetItem = null) {",
        "left: `${left}px`,",
        "width: `${width}px`,"
    ];

    for (const marker of menuMarkers) {
        assert.equal(walletModalSource.includes(marker), true, `js/components/WalletModal.js should contain ${marker}`);
    }
});
