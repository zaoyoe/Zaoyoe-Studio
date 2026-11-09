const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('wallet modal reuses the Dock liquid glass material and lens on the outer .glass-ring while keeping the inner surface opaque', () => {
    const walletModalSource = readRepoFile('js/components/WalletModal.js');
    const walletLoaderSource = readRepoFile('js/wallet-modal-loader.js');
    const walletCssSource = readRepoFile('css/wallet.css');
    const desktopGlassCss = readRepoFile('css/desktop-nav-glass.css');
    const desktopGlassJs = readRepoFile('js/desktop-nav-glass.mjs');
    const dockCss = readRepoFile('css/magnifying-dock.css');
    const modalGlassCss = readRepoFile('css/modal-glass.css');
    const mobileGlassJs = readRepoFile('js/mobile-glass.mjs');
    const lensSource = readRepoFile('vendor/glasswork/lens.js');
    const authSource = readRepoFile('supabase-auth-functions.js');

    assert.match(
        walletModalSource,
        /<div class="wallet-modal glass-ring">\s*<section\s+class="glass-ring__surface wallet-modal__surface"\s+role="dialog"\s+aria-modal="true"\s+aria-labelledby="wallet-modal-title"\s*>\s*<div class="wallet-header">\s*<h2 id="wallet-modal-title">/
    );
    assert.equal(
        walletModalSource.includes("!overlay.querySelector('.glass-ring__surface')"),
        true,
        'cached wallet overlays missing the glass-ring surface should be rebuilt'
    );
    assert.equal(
        walletModalSource.includes('warmShell() {') && walletModalSource.includes('this.warmShell();'),
        true,
        'WalletModal should pre-build its hidden DOM shell during warmup/prefetch'
    );
    assert.equal(
        walletLoaderSource.includes('function ensureWalletStylesheet() {') &&
            walletLoaderSource.includes('walletModal?.warmShell?.();'),
        true,
        'wallet-modal-loader.js should warm wallet.css in parallel and prewarm the DOM shell'
    );
    assert.equal(
        lensSource.includes('export function warmLiquidGlass(') &&
            lensSource.includes('function tryAttachWarmFilter() {'),
        true,
        'lens.js should pre-warm displacement tiles and attach warm filters synchronously'
    );
    assert.equal(
        authSource.includes("scheduleSupabaseAuthWalletWarmPrefetch('avatar-intent');") &&
            authSource.includes('walletWarmPrefetchHandle = window.setTimeout(runWarmPrefetch, 0);'),
        true,
        'supabase-auth-functions.js should warm the wallet runtime immediately on avatar hover/click intent'
    );

    assert.match(
        desktopGlassJs,
        /const CORE_SURFACES = '[^']*\.gdock[^']*\.glass-ring'/,
        'desktop glass controller should register .glass-ring alongside .gdock in CORE_SURFACES'
    );
    assert.match(
        desktopGlassCss,
        /@layer desktop-nav-glass[\s\S]*?:is\([^)]*\.gdock,\s*\.chat-widget-fab \.message-preview,\s*\.engagement-surface,\s*\.glass-ring,\s*\[data-desktop-glass-surface\]\)/,
        'desktop-nav-glass.css should share the exact Dock Glasswork material layer with .glass-ring'
    );
    assert.match(
        dockCss,
        /@layer mobile-glass[\s\S]*?:is\([^)]*\.dock-cluster \.gdock-glass[^)]*\.glass-ring\)\s*\{/,
        'magnifying-dock.css mobile-glass layer should share the mobile Dock glass material with .glass-ring'
    );
    assert.match(
        dockCss,
        /@layer mobile-glass[\s\S]*?:is\([^)]*\.dock-cluster \.gdock-glass[^)]*\.glass-ring\)::before\s*\{/,
        'magnifying-dock.css mobile-glass layer should share the mobile Dock chromatic dispersion rim with .glass-ring'
    );
    assert.match(
        mobileGlassJs,
        /MOBILE_GLASS_TARGETS\s*=\s*'[^']*\.glass-ring'/,
        'mobile-glass.mjs should include .glass-ring in MOBILE_GLASS_TARGETS'
    );

    const requiredWalletCssMarkers = [
        '--glass-ring-width: 8px;',
        '--glass-radius: 28px;',
        '--glass-panel: #fffefd;',
        'corner-shape: superellipse(1.2);',
        'max(0px, calc(var(--glass-radius) - var(--glass-ring-width)))',
        'corner-shape: inherit;',
        'background: var(--glass-panel);',
        'color: var(--glass-surface-ink);',
        '@media (max-width: 520px) {',
        '--glass-ring-width: 7px;',
        '[data-theme="dark"] .glass-ring {',
        '.wallet-modal__surface {'
    ];

    for (const marker of requiredWalletCssMarkers) {
        assert.equal(walletCssSource.includes(marker), true, `css/wallet.css should define ${marker}`);
    }

    assert.match(modalGlassCss, /--dng-k:\s*\.94 !important/);
    assert.match(modalGlassCss, /backdrop-filter:[^;]*var\(--desktop-glass-lens,/);
    assert.doesNotMatch(walletCssSource, /--(?:dng-(?:tint|alpha|filter)|mg-(?:tint|alpha)):/,
        'lazy wallet styles must not redefine shared rim material');

    assert.doesNotMatch(
        walletCssSource,
        /html\[data-theme="light"\]\s+\.wallet-modal\s*,\s*\[data-theme="light"\]\s+\.wallet-order-modal[\s\S]{0,160}background:\s*#ffffff;/,
        'light theme should not paint a solid white background onto the outer .wallet-modal glass ring'
    );
});

test('desktop glass controller preserves source alpha for the modal liquid-glass lens without blocking first-open visibility', async () => {
    const { startDesktopNavGlass, DESKTOP_NAV_GLASS, MODAL_RIM_GLASS } = await import('../js/desktop-nav-glass.mjs');

    function makeNode(classes, { insideSurface = false } = {}) {
        const classList = classes.split(/\s+/).filter(Boolean);
        const attributes = new Set();
        const node = {
            nodeType: 1,
            className: classes,
            dataset: {},
            isConnected: true,
            offsetWidth: 716,
            offsetHeight: 516,
            style: {
                props: {},
                setProperty(k, v) { this.props[k] = v; },
                removeProperty(k) { delete this.props[k]; }
            },
            parentElement: null,
            matches: selector => selector.split(',').some(part => {
                const trimmed = part.trim();
                return trimmed.startsWith('.') && !trimmed.includes(' ') && classList.includes(trimmed.slice(1));
            }),
            closest: selector => {
                if (selector.includes('.glass-ring__surface') && insideSurface) return surfaceNode;
                if (selector.includes('.glass-ring')) return ringNode;
                return null;
            },
            querySelectorAll: () => [],
            getBoundingClientRect: () => ({ left: 200, top: 120, width: 716, height: 516 }),
            checkVisibility: () => true,
            setAttribute: name => attributes.add(name),
            removeAttribute: name => attributes.delete(name),
            hasAttribute: name => attributes.has(name),
            toggleAttribute(name, force) { force ? attributes.add(name) : attributes.delete(name); }
        };
        return node;
    }

    const ringNode = makeNode('wallet-modal glass-ring');
    const surfaceNode = makeNode('glass-ring__surface wallet-modal__surface', { insideSurface: true });
    const innerControl = makeNode('close-modal-btn', { insideSurface: true });
    surfaceNode.parentElement = ringNode;
    innerControl.parentElement = surfaceNode;
    ringNode.querySelectorAll = () => [surfaceNode, innerControl];

    const body = {
        nodeType: 1,
        matches: () => false,
        querySelectorAll: () => [ringNode, surfaceNode, innerControl]
    };
    const colorContext = {
        clearRect() {},
        fillRect() {},
        getImageData: () => ({ data: [248, 250, 252, 255] })
    };
    const doc = {
        body,
        documentElement: { dataset: { theme: 'light' } },
        createElement: () => ({ getContext: () => colorContext }),
        elementsFromPoint: () => [surfaceNode, ringNode, body],
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {}
    };
    const frames = [];
    const win = {
        innerWidth: 1440,
        innerHeight: 900,
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        getComputedStyle: () => ({ backgroundColor: 'rgb(248, 250, 252)', position: 'relative', backdropFilter: 'blur(10px)' }),
        requestAnimationFrame: cb => { frames.push(cb); return frames.length; },
        cancelAnimationFrame() {},
        clearTimeout() {},
        addEventListener() {},
        removeEventListener() {},
        MutationObserver: class { observe() {} disconnect() {} }
    };

    let resolveLens;
    const lensReady = new Promise(resolve => { resolveLens = resolve; });
    const attachedLenses = [];
    const controller = startDesktopNavGlass({
        doc,
        win,
        lens: (el, opts) => {
            attachedLenses.push({ el, opts });
            return { supported: true, ready: lensReady, destroy() {} };
        }
    });

    try {
        assert.equal(attachedLenses.length, 1, 'only the outer .glass-ring should receive the Dock liquid-glass lens');
        assert.equal(attachedLenses[0].el, ringNode);
        assert.equal(attachedLenses[0].opts, MODAL_RIM_GLASS);
        assert.deepEqual(MODAL_RIM_GLASS, { ...DESKTOP_NAV_GLASS, preserveSourceAlpha: true });
        assert.equal('preserveSourceAlpha' in DESKTOP_NAV_GLASS, false, 'navbar/Dock optics retain their existing alpha behavior');
        assert.equal(ringNode.dataset.desktopGlassKind, 'light');
        assert.equal(
            ringNode.hasAttribute('data-desktop-glass-pending'),
            false,
            '.glass-ring must stay visible immediately on first open instead of hiding behind data-desktop-glass-pending'
        );
        assert.equal('desktopGlassSurface' in innerControl.dataset, false, 'controls inside opaque .glass-ring__surface must not be bound as nested glass');

        resolveLens(true);
        await lensReady;
        while (frames.length) {
            const batch = frames.splice(0, frames.length);
            batch.forEach(fn => fn());
        }
        assert.equal(ringNode.hasAttribute('data-desktop-glass-ready'), true);
    } finally {
        controller.destroy();
    }
});

test('sitewide modals use .glass-ring outer shell with .glass-ring__surface opaque inner panel', () => {
    // Group 1: Auth & Profile
    const authInject = readRepoFile('inject-auth.js');
    const authCss = readRepoFile('css/auth-sheet.css');
    const profileTpl = readRepoFile('js/profile-modal-template.js');
    const profileCss = readRepoFile('css/profile-modal.css');
    assert.match(authInject, /<div class="glass-ring glass-ring--shell auth-sheet-ring">[\s\S]*<section class="auth-sheet glass-ring__surface"/);
    assert.match(authCss, /\.auth-sheet-ring\s*\{[\s\S]*?--glass-ring-width:\s*8px;/);
    assert.match(authCss, /\.auth-sheet[\s\S]*?backdrop-filter:\s*none !important/);
    assert.match(profileTpl, /<div class="glass-ring glass-ring--shell profile-modal-ring">[\s\S]*<div class="modal-content profile-modal glass-ring__surface"/);
    assert.match(profileCss, /#profileModal \.profile-modal-ring/);
    assert.match(profileCss, /#profileModal \.profile-modal-ring > \.modal-content\.profile-modal[\s\S]*?backdrop-filter:\s*none !important/);

    // Group 2: Wallet Main & Sub-Modals
    const walletJs = readRepoFile('js/components/WalletModal.js');
    const walletCss = readRepoFile('css/wallet.css');
    assert.match(walletJs, /<div class="glass-ring glass-ring--shell wallet-order-modal-ring">[\s\S]*<div class="wallet-order-modal glass-ring__surface"/);
    assert.match(walletJs, /<div class="glass-ring glass-ring--shell wallet-date-picker-ring">[\s\S]*<div class="date-picker-content glass-ring__surface"/);
    assert.match(walletCss, /\.wallet-order-modal-ring/);
    assert.match(walletCss, /\.wallet-date-picker-ring/);
    assert.match(walletCss, /\.wallet-order-modal-ring > \.wallet-order-modal[\s\S]*?backdrop-filter:\s*none !important/);

    // Group 3: Shop Modals
    const shopHtml = readRepoFile('shop.html');
    const shopClient = readRepoFile('js/shop-client.js');
    const shopCss = readRepoFile('css/shop-page.css');
    assert.match(shopHtml, /<div class="glass-ring glass-ring--shell shop-modal-ring shop-purchase-modal-ring">[\s\S]*<div class="modal-content premium-modal glass-ring__surface"/);
    assert.match(shopHtml, /<div class="glass-ring glass-ring--shell shop-modal-ring guest-shop-modal__ring">[\s\S]*id="guestCashPurchaseDialog"/);
    assert.match(shopHtml, /<div class="glass-ring glass-ring--shell shop-modal-ring shop-cart-checkout-modal-ring">/);
    assert.match(shopHtml, /<div class="glass-ring glass-ring--shell shop-modal-ring shop-success-modal-ring">/);
    assert.match(shopClient, /dialog\.className = 'shop-step-up-dialog glass-ring'/);
    assert.match(shopClient, /form\.className = 'glass-ring__surface shop-step-up-dialog__surface'/);
    assert.match(shopCss, /#shopPurchaseModal > \.shop-purchase-modal-ring/);
    assert.match(shopCss, /#guestCashPurchaseModal > \.guest-shop-modal__ring/);
    assert.match(shopCss, /#shopCartCheckoutModal > \.shop-cart-checkout-modal-ring/);
    assert.match(shopCss, /#shopSuccessModal > \.shop-success-modal-ring/);
    assert.match(shopCss, /dialog\.shop-step-up-dialog\.glass-ring/);

    // Group 4: Guest Orders Modals
    const ordersHtml = readRepoFile('guest-orders.html');
    const ordersCss = readRepoFile('css/guest-orders.css');
    assert.match(ordersHtml, /id="guestOrdersTicketModal"[\s\S]*?<div class="glass-ring glass-ring--shell guest-orders-modal-ring[^"]*">[\s\S]*?<div class="guest-orders-modal-dialog[^"]*glass-ring__surface"/);
    assert.match(ordersHtml, /id="myTicketDetailModal"[\s\S]*?<div class="glass-ring glass-ring--shell guest-orders-modal-ring[^"]*">[\s\S]*?<div class="guest-orders-modal-dialog[^"]*glass-ring__surface"/);
    assert.match(ordersCss, /\.guest-orders-modal-overlay > \.guest-orders-modal-ring/);
    assert.match(ordersCss, /\.guest-orders-modal-dialog\.glass-ring__surface[\s\S]*?backdrop-filter:\s*none !important/);

    // Group 5: Guestbook & Prompts Modals
    const indexHtml = readRepoFile('index.html');
    const guestbookHtml = readRepoFile('guestbook.html');
    const styleCss = readRepoFile('style.css');
    const homepageOverlayCss = readRepoFile('css/homepage-overlays.css');
    const promptsHtml = readRepoFile('prompts.html');
    const promptsCss = readRepoFile('prompts-poetry.css');
    const aiWorkbenchJs = readRepoFile('js/ai-image-workbench.js');
    const aiWorkbenchCss = readRepoFile('css/ai-image-workbench.css');
    assert.match(indexHtml, /id="guestbookModal"[\s\S]*?class="[^"]*guestbook-composer-sheet[^"]*glass-ring[^"]*"[\s\S]*?class="[^"]*glass-ring__surface[^"]*guestbook-composer-surface[^"]*"/);
    assert.match(guestbookHtml, /id="guestbookModal"[\s\S]*?class="[^"]*guestbook-composer-sheet[^"]*glass-ring[^"]*"[\s\S]*?class="[^"]*glass-ring__surface[^"]*guestbook-composer-surface[^"]*"/);
    assert.match(guestbookHtml, /id="commentModal"[\s\S]*?class="[^"]*comment-composer-sheet[^"]*glass-ring[^"]*"[\s\S]*?class="[^"]*glass-ring__surface[^"]*comment-composer-surface[^"]*"/);
    assert.match(styleCss, /#guestbookModal \.guestbook-composer-sheet\.glass-ring/);
    assert.match(homepageOverlayCss, /#guestbookModal \.guestbook-composer-sheet\.glass-ring/);
    assert.match(promptsHtml, /id="promptModal"[\s\S]*?<div class="modal-inner glass-ring"[^>]*>[\s\S]*?<div class="glass-ring__surface poetry-modal-surface">/);
    assert.match(promptsCss, /#promptModal \.modal-inner\.glass-ring/);
    assert.match(aiWorkbenchJs, /isStandalone \? shellMarkup : `<div class="glass-ring glass-ring--shell ai-image-shell-ring">\$\{shellMarkup\}<\/div>`/);
    assert.match(aiWorkbenchCss, /\.ai-image-shell-ring\.glass-ring/);

    // Group 6: Announcements, Engagement, Support Detail
    const announcementJs = readRepoFile('announcement-loader.js');
    const chatWidgetJs = readRepoFile('js/components/ChatWidget.js');
    const chatWidgetCss = readRepoFile('css/chat-widget.css');
    const siteLayoutJs = readRepoFile('js/site-layout-runtime.js');
    const framerHomeCss = readRepoFile('css/framer_home.css');
    const desktopGlassCss = readRepoFile('css/desktop-nav-glass.css');
    assert.match(announcementJs, /<div class="glass-ring glass-ring--shell zaoyoe-announcement-ring">[\s\S]*?<div class="zaoyoe-announcement-modal glass-ring__surface"/);
    assert.match(announcementJs, /\.zaoyoe-announcement-ring/);
    assert.match(chatWidgetJs, /<div class="glass-ring glass-ring--shell engagement-surface__modal-ring">[\s\S]*?<div class="glass-ring__surface engagement-surface__modal-surface">/);
    assert.match(chatWidgetCss, /\.engagement-surface--modal \.engagement-surface__modal-ring/);
    assert.match(siteLayoutJs, /<div class="glass-ring glass-ring--shell site-layout-support-detail-dialog__ring">[\s\S]*?<section class="site-layout-support-detail-dialog__panel glass-ring__surface"/);
    assert.match(framerHomeCss, /\.site-layout-support-detail-dialog__ring/);
    assert.match(desktopGlassCss, /\.site-layout-support-detail-dialog__ring/);
    assert.match(desktopGlassCss, /\.glass-ring__surface[\s\S]*?backdrop-filter:\s*none !important/);
});
