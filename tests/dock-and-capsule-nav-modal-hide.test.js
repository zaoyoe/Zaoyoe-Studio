const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DOCK_CSS = fs.readFileSync(
    path.resolve(__dirname, '..', 'css', 'magnifying-dock.css'),
    'utf8'
);
const FRAMER_CSS = fs.readFileSync(
    path.resolve(__dirname, '..', 'css', 'framer_home.css'),
    'utf8'
);
const FRAMER_CRITICAL_CSS = fs.readFileSync(
    path.resolve(__dirname, '..', 'css', 'framer_home_critical.css'),
    'utf8'
);
const IOS_SCROLL_LOCK_JS = fs.readFileSync(
    path.resolve(__dirname, '..', 'js', 'ios-scroll-lock.js'),
    'utf8'
);
const FRAMER_NAV_RUNTIME_JS = fs.readFileSync(
    path.resolve(__dirname, '..', 'js', 'framer-nav-runtime.js'),
    'utf8'
);
const FRAMER_HOME_JS = fs.readFileSync(
    path.resolve(__dirname, '..', 'js', 'framer_home.js'),
    'utf8'
);
const DOCK_JS = fs.readFileSync(
    path.resolve(__dirname, '..', 'js', 'magnifying-dock.js'),
    'utf8'
);
const GUEST_ORDERS_JS = fs.readFileSync(
    path.resolve(__dirname, '..', 'js', 'guest-orders-client.js'),
    'utf8'
);
const GUEST_ORDERS_HTML = fs.readFileSync(
    path.resolve(__dirname, '..', 'guest-orders.html'),
    'utf8'
);

test('CSS contract: Dock downward exit motion when any modal is opened', () => {
    // Must include has-active-modal and modal states
    assert.match(DOCK_CSS, /body\.has-active-modal \.dock-cluster/);
    assert.match(DOCK_CSS, /body:has\(#profileModal\.active\) \.dock-cluster/);
    assert.match(DOCK_CSS, /body:has\(#walletModal\.active\) \.dock-cluster/);
    assert.match(DOCK_CSS, /body:has\(#guestbookModal\.active\) \.dock-cluster/);
    assert.match(DOCK_CSS, /body:has\(#commentModal\.active\) \.dock-cluster/);
    assert.match(DOCK_CSS, /body:has\(#shopPurchaseModal\.active\) \.dock-cluster/);
    assert.match(DOCK_CSS, /body:has\(#loginModal\.active\) \.dock-cluster/);
    assert.match(DOCK_CSS, /body:has\(\.modal-overlay\.active\) \.dock-cluster/);

    // Elegant downward physics motion: 140px translate, opacity 0, pointer-events none, cubic-bezier
    assert.match(DOCK_CSS, /transform:\s*translate3d\(0,\s*140px,\s*0\)\s*!important/);
    assert.match(DOCK_CSS, /opacity:\s*0\s*!important/);
    assert.match(DOCK_CSS, /pointer-events:\s*none\s*!important/);
    assert.match(DOCK_CSS, /transition:[^;]*cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)[^;]*opacity/);
});

test('CSS contract: Capsule Navbar upward exit motion when any modal is opened', () => {
    // Only matches when navbar is in capsule state (.scrolled)
    assert.match(DOCK_CSS, /body\.has-active-modal \.framer-nav\.scrolled/);
    assert.match(DOCK_CSS, /body:has\(#profileModal\.active\) \.framer-nav\.scrolled/);
    assert.match(DOCK_CSS, /body:has\(#walletModal\.active\) \.framer-nav\.scrolled/);
    assert.match(DOCK_CSS, /body:has\(#guestbookModal\.active\) \.framer-nav\.scrolled/);
    assert.match(DOCK_CSS, /body:has\(#shopPurchaseModal\.active\) \.framer-nav\.scrolled/);
    assert.match(DOCK_CSS, /body:has\(#loginModal\.active\) \.framer-nav\.scrolled/);
    assert.match(DOCK_CSS, /body:has\(\.modal-overlay\.active\) \.framer-nav\.scrolled/);

    // Elegant upward exit motion: translate upwards beyond viewport, opacity 0, shadow cleared, pointer-events none
    assert.match(DOCK_CSS, /transform:\s*translateY\(calc\(-100% - 40px\)\)\s*!important/);
    assert.match(DOCK_CSS, /box-shadow:\s*none\s*!important/);

    // Also guaranteed in framer_home.css and framer_home_critical.css
    assert.match(FRAMER_CSS, /body\.has-active-modal \.framer-nav\.scrolled/);
    assert.match(FRAMER_CSS, /transform:\s*translateY\(calc\(-100% - 40px\)\)\s*!important/);
    assert.match(FRAMER_CRITICAL_CSS, /body\.has-active-modal \.framer-nav\.scrolled/);
});

test('JS contract: iOSScrollLock manages has-active-modal and preserves savedScrollY', () => {
    assert.match(IOS_SCROLL_LOCK_JS, /document\.body\.classList\.add\(['"]has-active-modal['"]\)/);
    assert.match(IOS_SCROLL_LOCK_JS, /document\.body\.classList\.remove\(['"]has-active-modal['"]\)/);
    assert.match(IOS_SCROLL_LOCK_JS, /get savedScrollY\(\)\s*\{\s*return savedScrollY;\s*\}/);
});

test('JS contract: Nav runtime preserves scrolled capsule state during modal lock', () => {
    assert.match(FRAMER_NAV_RUNTIME_JS, /getEffectiveScrollY/);
    assert.match(FRAMER_NAV_RUNTIME_JS, /isModalActive/);
    assert.match(FRAMER_HOME_JS, /getEffectiveScrollY/);
    assert.match(FRAMER_HOME_JS, /isModalActive/);
});

test('JS contract: magnifying-dock synchronizes active modal state on mutations', () => {
    assert.match(DOCK_JS, /syncActiveModalState/);
    assert.match(DOCK_JS, /classList\.toggle\(["']has-active-modal["']/);
});

test('Safety contract: No overly broad selectors that cause false-positive dock hiding on cold load', () => {
    // Overly broad selectors like [role="dialog"] or :not([hidden]) match static inactive elements
    assert.doesNotMatch(DOCK_CSS, /\[role="dialog"\]/);
    assert.doesNotMatch(FRAMER_CSS, /\[role="dialog"\]/);
    assert.doesNotMatch(FRAMER_CRITICAL_CSS, /\[role="dialog"\]/);
    assert.doesNotMatch(DOCK_JS, /\[role="dialog"\]/);

    assert.doesNotMatch(DOCK_CSS, /#guestCashPurchaseModal:not\(\[hidden\]\)/);
    assert.doesNotMatch(FRAMER_CSS, /#guestCashPurchaseModal:not\(\[hidden\]\)/);
    assert.doesNotMatch(DOCK_JS, /#guestCashPurchaseModal:not\(\[hidden\]\)/);

    // .codes-modal-overlay must be qualified with .is-visible
    assert.doesNotMatch(DOCK_CSS, /body:has\(\.codes-modal-overlay\)\s*\.dock-cluster/);
    assert.doesNotMatch(FRAMER_CSS, /body:has\(\.codes-modal-overlay\)\s*\.framer-nav/);
    assert.match(DOCK_CSS, /body:has\(\.codes-modal-overlay\.is-visible\) \.dock-cluster/);
    assert.match(FRAMER_CSS, /body:has\(\.codes-modal-overlay\.is-visible\) \.framer-nav/);
});

test('Dock return motion contract: Upward float transition is preserved when modal closes', () => {
    // .dock-cluster and .dock-cluster.is-ready must declare transform transition
    assert.match(DOCK_CSS, /\.dock-cluster\s*\{[^}]*transition:[^}]*transform 520ms/);
    assert.match(DOCK_CSS, /\.dock-cluster\.is-ready\s*\{[^}]*transition:[^}]*transform 520ms/);

    // Later width transition rules must NOT clobber .dock-cluster's transform transition
    assert.doesNotMatch(DOCK_CSS, /\.dock-cluster,\s*\.gdock\s*\{\s*transition:\s*width/);
});

test('Dock unified return contract: Dock enters as a complete unified body without staggered glass-before-icons lag', () => {
    // Dock cluster uses rapid opacity synchronization (<100ms) so glass and icons are fully opaque before crossing viewport
    assert.match(DOCK_CSS, /\.dock-cluster\.is-ready\s*\{[^}]*opacity 60ms linear/);
    assert.match(DOCK_CSS, /\.dock-cluster\s*\{[^}]*will-change:\s*transform/);
    assert.match(DOCK_CSS, /\.gdock\s*\{[^}]*will-change:\s*transform/);
    assert.match(DOCK_CSS, /\.dock-cluster\s*\{[^}]*contain:\s*layout style/);
});

test('Ticket detail modal contract: Hides dock & capsule nav when opened', () => {
    // CSS rules must include ticket modal selectors
    assert.match(DOCK_CSS, /body\.ticket-detail-modal-open \.dock-cluster/);
    assert.match(DOCK_CSS, /body:has\(#myTicketDetailModal\.active\) \.dock-cluster/);
    assert.match(FRAMER_CSS, /body\.ticket-detail-modal-open \.framer-nav\.scrolled/);
    assert.match(FRAMER_CSS, /body:has\(#myTicketDetailModal\.active\) \.framer-nav\.scrolled/);
    assert.match(FRAMER_CRITICAL_CSS, /body\.ticket-detail-modal-open \.framer-nav\.scrolled/);

    // JS guest-orders-client must activate modal and lock scroll
    assert.match(GUEST_ORDERS_JS, /modal\.classList\.add\(['"]active['"]\)/);
    assert.match(GUEST_ORDERS_JS, /document\.body\.classList\.add\(['"]ticket-detail-modal-open['"]\)/);
    assert.match(GUEST_ORDERS_JS, /window\.iOSScrollLock\.lockLight\(modal\)/);

    // guest-orders.html must load ios-scroll-lock.js
    assert.match(GUEST_ORDERS_HTML, /src="\.\/js\/ios-scroll-lock\.js[^"]*"/);

    // magnifying-dock.js must track ticket modal
    assert.match(DOCK_JS, /ticket-detail-modal-open/);
    assert.match(DOCK_JS, /#myTicketDetailModal\.active/);
});

test('Shop list drawer contract: Dock downward exit motion when category drawer is open on mobile', () => {
    assert.match(DOCK_CSS, /body\.shop-list-drawer-open \.dock-cluster/);
    assert.match(DOCK_CSS, /body:has\(\.shop-main\.is-list-drawer-open\) \.dock-cluster/);
    const shopPageCss = fs.readFileSync(
        path.resolve(__dirname, '..', 'css', 'shop-page.css'),
        'utf8'
    );
    assert.match(shopPageCss, /body\.shop-list-drawer-open \.dock-cluster/);
    assert.match(shopPageCss, /body\.shop-list-drawer-open \.framer-nav/);
});

test('Dock hover tooltip & top-button hygiene contracts', () => {
    // 1. Tooltip is enabled on desktop (not globally killed by display: none)
    assert.doesNotMatch(DOCK_CSS, /\/\* Preserve the existing desktop tooltip policy\. \*\/\s*\.gdock-tip\s*\{\s*display:\s*none\s*!important;\s*\}/);
    assert.match(DOCK_CSS, /\.gdock-tip\[data-on="true"\]\s*\{\s*opacity:\s*1;\s*\}/);

    // 2. guest-orders does NOT early return before globalTopBtn collapse handling
    assert.doesNotMatch(DOCK_JS, /if\s*\(pageType === "guest-orders"\)\s*\{[^}]*return;\s*\}/);
    assert.match(DOCK_JS, /else if\s*\(pageType === "prompts"\)/);

    // 3. Initial rendering collapses top button when scrollY <= 120
    assert.match(DOCK_JS, /shouldCollapseInitial\s*=\s*isTopItem/);
    assert.match(DOCK_JS, /data-collapsed="true"\s*aria-hidden="true"\s*tabindex="-1"/);
});
