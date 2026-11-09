const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the shared modal state logic itself; unrelated dock animation and
// navigation bootstrapping are intentionally outside this controlled DOM.
function createHarness() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js/magnifying-dock.js'), 'utf8');
    const start = source.indexOf('const MODAL_OPEN_SELECTOR = [');
    const end = source.indexOf('const items = [...dock.querySelectorAll', start);
    assert.ok(start >= 0 && end > start);
    let writes = 0;
    function root() {
        const classes = new Set();
        return {
            classList: {
                contains: name => classes.has(name),
                add: name => classes.add(name),
                remove: name => classes.delete(name),
                toggle(name, on) {
                    writes++;
                    if (on) classes.add(name);
                    else classes.delete(name);
                }
            },
            dataset: new Proxy({}, {
                set(target, key, value) { writes++; target[key] = value; return true; },
                deleteProperty(target, key) { writes++; delete target[key]; return true; }
            })
        };
    }
    const elements = [];
    const body = root();
    const html = root();
    const document = {
        body,
        documentElement: html,
        querySelectorAll(selector) {
            const selectors = selector.split(',');
            return elements.filter(el => el.matches.some(match => selectors.includes(match)));
        }
    };
    const window = {
        getComputedStyle: el => el.style,
        iOSScrollLock: { isLocked: false }
    };
    const observations = [];
    window.addEventListener = () => {};
    class MutationObserver {
        constructor(callback) { this.callback = callback; }
        observe(target, options) { observations.push({ target, options, callback: this.callback }); }
    }
    const context = { document, window, MutationObserver, syncAllNavPopups() {} };
    vm.runInNewContext(source.slice(start, end) + '\nglobalThis.sync = syncActiveModalState;', context);
    return {
        body, html, window, sync: context.sync,
        mutate(target, attribute) {
            observations.filter(entry => entry.target === target && entry.options.attributeFilter.includes(attribute))
                .forEach(entry => entry.callback());
        },
        writes: () => writes,
        add(match, options = {}) {
            const el = {
                matches: [match], id: '', hidden: false,
                style: { display: 'flex', visibility: 'visible' },
                excludedAncestor: false, rendered: true,
                closest() { return this.excludedAncestor ? {} : null; },
                getClientRects() { return this.rendered ? [{}] : []; },
                ...options
            };
            elements.push(el);
            return el;
        },
        active() {
            assert.equal(html.classList.contains('has-active-modal'), body.classList.contains('has-active-modal'));
            return body.classList.contains('has-active-modal');
        },
        navHidden: () => body.dataset.navModalOpen === 'true'
    };
}

test('a hidden first match does not mask a second visible dialog', () => {
    const h = createHarness();
    h.add('#myTicketDetailModal:not([hidden])', { style: { display: 'none' } });
    const login = h.add('.auth-sheet-overlay.active');
    h.sync();
    assert.equal(h.active(), true);
    assert.equal(h.navHidden(), true);
    login.style.display = 'none';
    h.sync();
    assert.equal(h.active(), false);
    assert.equal(h.navHidden(), false);
});

test('hidden, inaccessible and unrendered dialogs do not hide navigation', () => {
    for (const options of [
        { hidden: true },
        { excludedAncestor: true },
        { rendered: false },
        { style: { display: 'none', visibility: 'visible' } },
        { style: { display: 'flex', visibility: 'hidden' } }
    ]) {
        const h = createHarness();
        h.add('.modal-overlay.active', options);
        h.sync();
        assert.equal(h.active(), false);
        assert.equal(h.navHidden(), false);
    }
});

test('cart, nested dialog and close transitions retain their separate navigation behavior', () => {
    const h = createHarness();
    const cart = h.add('#shopCartDrawer.active', { id: 'shopCartDrawer' });
    h.body.classList.add('shop-cart-open');
    h.window.iOSScrollLock.isLocked = true;
    h.sync();
    assert.equal(h.active(), true);
    assert.equal(h.navHidden(), false);
    const checkout = h.add('#shopCartCheckoutModal.active');
    h.sync();
    assert.equal(h.navHidden(), true);
    checkout.hidden = true;
    h.sync();
    assert.equal(h.active(), true);
    assert.equal(h.navHidden(), false);
    cart.hidden = true;
    h.body.classList.remove('shop-cart-open');
    h.window.iOSScrollLock.isLocked = false;
    h.sync();
    assert.equal(h.active(), false);
    assert.equal(h.navHidden(), false);
});

test('announcement, image, wallet and purchase overlays participate in shared state', () => {
    for (const selector of [
        '.zaoyoe-announcement-overlay:not(.announcement-modal-force-hidden)',
        '.lightbox-overlay:not([hidden])', '.notif-backdrop.active',
        '.image-lightbox.active', '.image-modal.active',
        '.wallet-overlay.active', '.login-overlay.active',
        '.guest-orders-modal-overlay.active', '#guestCashPurchaseModal.active',
        '.poetry-modal.active', '.prompt-spotlight-overlay.is-open', 'dialog[open]'
    ]) {
        const h = createHarness();
        const modal = h.add(selector);
        h.sync();
        assert.equal(h.active(), true, selector);
        assert.equal(h.navHidden(), true, selector);
        modal.hidden = true;
        h.sync();
        assert.equal(h.active(), false, selector);
        assert.equal(h.navHidden(), false, selector);
    }
});

test('ordinary navigation menus, banners and nonblocking toasts do not count as dialogs', () => {
    const h = createHarness();
    for (const selector of ['.avatar-dropdown.active', '.announcement-banner', '.toast.active', '[role="dialog"]']) {
        h.add(selector);
    }
    h.sync();
    assert.equal(h.active(), false);
    assert.equal(h.navHidden(), false);
});

test('body and html explicit modal state and purchase attributes work without a modal node', () => {
    for (const target of ['body', 'html']) {
        const h = createHarness();
        h[target].classList.add('auth-sheet-open');
        h.sync();
        assert.equal(h.navHidden(), true);
        h[target].classList.remove('auth-sheet-open');
        h.sync();
        assert.equal(h.navHidden(), false);
    }
    const h = createHarness();
    h.body.dataset.shopPurchaseModalOpen = 'true';
    h.sync();
    assert.equal(h.navHidden(), true);
    delete h.body.dataset.shopPurchaseModalOpen;
    h.sync();
    assert.equal(h.active(), false);
});

test('unregistered scroll locks hide navigation while cart-only locks preserve its top state', () => {
    const h = createHarness();
    h.window.iOSScrollLock.isLocked = true;
    h.sync();
    assert.equal(h.navHidden(), true);
    h.body.dataset.shopCartOpen = 'true';
    h.sync();
    assert.equal(h.active(), true);
    assert.equal(h.navHidden(), false);
    delete h.body.dataset.shopCartOpen;
    h.window.iOSScrollLock.isLocked = false;
    h.sync();
    assert.equal(h.active(), false);
});

test('unchanged modal state does not write attributes and retrigger observers', () => {
    const h = createHarness();
    const modal = h.add('.modal-overlay.active');
    for (const hidden of [false, true]) {
        modal.hidden = hidden;
        h.sync();
        const writes = h.writes();
        for (let i = 0; i < 10; i++) h.sync();
        assert.equal(h.writes(), writes);
    }
});

test('root-only modal changes are observed even when body markup does not change', () => {
    const h = createHarness();
    h.html.classList.add('auth-sheet-open');
    h.mutate(h.html, 'class');
    assert.equal(h.navHidden(), true);
    h.html.classList.remove('auth-sheet-open');
    h.mutate(h.html, 'class');
    assert.equal(h.navHidden(), false);
    h.body.dataset.shopPurchaseModalOpen = 'true';
    h.mutate(h.body, 'data-shop-purchase-modal-open');
    assert.equal(h.navHidden(), true);
});

// Lightboxes retain their backdrop while fading out; notifications also keep
// their background lock until the mobile drawer's exit animation completes.
test('closing lightbox and notification locks keep navigation hidden until fully dismissed', () => {
    const h = createHarness();
    const lightbox = h.add('.lightbox-overlay:not([hidden])');
    h.sync();
    assert.equal(h.navHidden(), true);
    lightbox.hidden = true;
    h.body.classList.add('notif-scroll-locked');
    h.sync();
    assert.equal(h.navHidden(), true);
    h.body.classList.remove('notif-scroll-locked');
    h.sync();
    assert.equal(h.navHidden(), false);
    assert.equal(h.active(), false);
});
