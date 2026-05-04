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
        "const VERSION = '20260504_USDT_DIRECT_CHECKOUT_1';",
        "const POINTS_SERVICE_SRC = 'js/services/PointsService.js?v=20260430_WALLET_GUIDANCE_BILINGUAL_1';",
        "const WALLET_MODAL_SRC = 'js/components/WalletModal.js?v=20260504_USDT_DIRECT_CHECKOUT_1';",
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

test('wallet sidebar highlight keeps mobile tabs instant while preserving desktop indicator', () => {
    const walletModalSource = readRepoFile('js/components/WalletModal.js');
    const walletCssSource = readRepoFile('css/wallet.css');

    const modalMarkers = [
        'function resetWalletSidebarIndicatorState() {',
        'let walletCssReady = false;',
        'function waitForWalletCssReady(link, options = {}) {',
        'function queueWalletSidebarIndicatorRefresh(targetItem = null) {',
        "sidebar?.classList.remove('wallet-sidebar--indicator-ready');",
        'const isCompactMobile = isWalletModalCompactMobile();',
        'if (!walletCssReady) {',
        'queueWalletSidebarIndicatorRefresh(activeItem);',
        'if (isCompactMobile) {',
        "left: '',",
        "height: '',",
        'const minReadyWidth = 1;',
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
        'height: 54px;\n    /* Initial height (approx) */',
        'min-height: 54px;',
        'line-height: 1.25;',
        '/* 20260428_WALLET_MOBILE_LIGHT_CUE_1 */',
        '.sidebar-indicator {\n        display: none;',
        'width: clamp(58px, 14.5vw, 76px);',
        'height: 70px;',
        'flex: 0 0 clamp(58px, 14.5vw, 76px);',
        'html[data-theme="light"] .wallet-recharge-scroll-cue::before',
        'html:not([data-theme="dark"]) .wallet-recharge-scroll-cue::before',
        'html[data-theme="light"] .wallet-recharge-scroll-cue-icon #walletScrollCueGradient stop:first-child',
        '/* 20260428_AFFILIATE_MOBILE_SCROLL_1 */',
        '.wallet-affiliate-shell {\n        overflow: visible;',
        '/* 20260428_AFFILIATE_STATS_GRID_1 */',
        '.wallet-affiliate-stats {\n        grid-template-columns: repeat(2, minmax(0, 1fr));',
        '/* 20260428_AFFILIATE_COMPACT_DETAILS_1 */',
        '.affiliate-stage-track {\n        grid-template-columns: repeat(2, minmax(0, 1fr));',
        '/* 20260428_DISCOUNT_ASSETS_SUMMARY_2COL_1 */',
        '.wallet-discount-assets-summary {\n        grid-template-columns: repeat(2, minmax(0, 1fr));',
        'html[data-theme="light"] .wallet-sidebar .sidebar-indicator',
        'html[data-theme="light"] .wallet-sidebar:focus-within .sidebar-indicator',
        'html[data-theme="light"] .wallet-sidebar.wallet-sidebar--indicator-ready .wallet-menu-item:focus-visible',
        'box-shadow: none !important;'
    ];

    for (const marker of cssMarkers) {
        assert.equal(walletCssSource.includes(marker), true, `css/wallet.css should contain ${marker}`);
    }

    assert.ok(
        walletCssSource.indexOf('/* 20260428_WALLET_MOBILE_LIGHT_CUE_1 */') >
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

test('wallet records view clamps mobile horizontal motion', () => {
    const walletModalSource = readRepoFile('js/components/WalletModal.js');
    const walletCssSource = readRepoFile('css/wallet.css');

    const touchLockMarkers = [
        'function bindWalletHorizontalPanGuard(host, {',
        'function bindWalletContentTouchLock(overlay) {',
        'function bindWalletRecordsTouchLock(overlay) {',
        "dataKey: 'walletContentTouchLock'",
        "return Boolean(target?.closest?.('.orders-container'));",
        'horizontalLocked = absX > 8 && absX > absY * 1.2;',
        'event.preventDefault();',
        "dataKey: 'walletRecordsTouchLock'",
        'bindWalletContentTouchLock(overlay);',
        'bindWalletRecordsTouchLock(overlay);'
    ];

    for (const marker of touchLockMarkers) {
        assert.equal(walletModalSource.includes(marker), true, `js/components/WalletModal.js should contain ${marker}`);
    }

    const recordsCssMarkers = [
        '/* 20260428_WALLET_MOBILE_PAN_CLAMP_1 */',
        '/* 20260428_WALLET_RECORDS_BOTTOM_EDGE_1 */',
        '.wallet-discount-assets-shell,',
        '.wallet-affiliate-panel,',
        '#view-orders .orders-container {\n        max-height: 220px;',
        '.history-container {\n        overflow-x: hidden;',
        '.wallet-order-modal-body {\n    padding: 24px;',
        'overscroll-behavior-x: none;',
        'touch-action: pan-y;',
        '#view-orders .order-product {\n        display: -webkit-box;',
        '#view-orders .order-right {\n        max-width: 40%;'
    ];

    for (const marker of recordsCssMarkers) {
        assert.equal(walletCssSource.includes(marker), true, `css/wallet.css should contain ${marker}`);
    }
});
