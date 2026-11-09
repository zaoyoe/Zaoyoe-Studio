const test = require('node:test');
const assert = require('node:assert/strict');

// Delay the real controller's lens dependency to exercise first-paint behavior.
// Persistent content must stay visible; popovers must wait for a full lens.
test('solid Gemini Pro card is excluded while navbar and popovers retain their readiness behavior', async () => {
    const { startDesktopNavGlass } = await import('../js/desktop-nav-glass.mjs');
    function surface(className) {
        const attributes = new Set();
        return {
            className, dataset: {}, isConnected: true, offsetWidth: 200, offsetHeight: 54,
            style: { setProperty() {}, removeProperty() {} },
            parentElement: null,
            matches: selector => selector.split(',').some(part => part.trim() === `.${className}`),
            closest: () => null,
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 54 }),
            checkVisibility: () => true,
            setAttribute: name => attributes.add(name),
            removeAttribute: name => attributes.delete(name),
            hasAttribute: name => attributes.has(name),
            toggleAttribute(name, force) { force ? attributes.add(name) : attributes.delete(name); }
        };
    }
    const nav = surface('framer-nav');
    const menu = surface('avatar-dropdown');
    const dock = surface('gdock');
    const verifyCard = surface('verify-widget');
    const body = { nodeType: 1, matches: selector => selector === '.verify-page', querySelectorAll: () => [nav, menu, dock, verifyCard] };
    const colorContext = {
        clearRect() {}, fillRect() {},
        getImageData: () => ({ data: [0, 0, 0, 255] })
    };
    const doc = {
        body, documentElement: { dataset: {} },
        createElement: () => ({ getContext: () => colorContext }),
        elementsFromPoint: () => [body],
        querySelectorAll: () => [nav],
        addEventListener() {}, removeEventListener() {}
    };
    let frameId = 0;
    const frames = new Map();
    const win = {
        innerWidth: 1440, innerHeight: 900,
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        getComputedStyle: el => ({
            backgroundColor: '#000', position: el === verifyCard ? 'relative' : 'fixed',
            backdropFilter: el === verifyCard ? 'blur(10px)' : 'none'
        }),
        requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame: id => frames.delete(id),
        clearTimeout() {},
        addEventListener() {}, removeEventListener() {},
        MutationObserver: class { observe() {} disconnect() {} }
    };
    let resolveLens;
    const ready = new Promise(resolve => { resolveLens = resolve; });
    const lensTargets = [];
    const controller = startDesktopNavGlass({ doc, win, lens: el => {
        lensTargets.push(el);
        return { supported: true, ready, destroy() {} };
    } });
    const pending = el => el.hasAttribute('data-desktop-glass-pending');
    const paint = () => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach(callback => callback());
        assert.equal(pending(nav), false, 'Navbar is never hidden for lens initialization');
        assert.equal(pending(verifyCard), false, 'Solid card never waits for a lens');
    };
    try {
        assert.equal(pending(nav), false);
        assert.equal(pending(verifyCard), false, 'Solid card stays visible');
        assert.equal(verifyCard.hasAttribute('data-desktop-glass-surface'), false);
        assert.equal(lensTargets.includes(verifyCard), false, 'No lens is allocated even if legacy CSS advertises blur');
        assert.equal(pending(menu), true, 'Popover stays gated until its lens decodes');
        assert.equal(pending(dock), true);
        assert.equal(dock.hasAttribute('data-desktop-glass-ready'), false, 'Dock entrance waits for the actual lens');
        resolveLens();
        await ready;
        assert.equal(pending(verifyCard), false);
        assert.equal(pending(menu), true);
        paint();
        assert.equal(pending(menu), true, 'First frame commits the decoded filter');
        assert.equal(dock.hasAttribute('data-desktop-glass-ready'), false);
        paint();
        assert.equal(pending(menu), false, 'Popover is revealed with its complete material');
        assert.equal(dock.hasAttribute('data-desktop-glass-ready'), true, 'Dock may now start its full entrance');
        assert.equal(verifyCard.hasAttribute('data-desktop-glass-ready'), false, 'Delayed decoding cannot adopt the solid card');
    } finally {
        controller.destroy();
        assert.equal(dock.hasAttribute('data-desktop-glass-ready'), false, 'Disposal clears the readiness of the old lens');
    }
});

test('profile modal and its content are strictly excluded from glass surfaces', async () => {
    const { startDesktopNavGlass } = await import('../js/desktop-nav-glass.mjs');
    function surface(className, id = '') {
        const attributes = new Set();
        const obj = {
            className, id, dataset: {}, isConnected: true, offsetWidth: 380, offsetHeight: 600,
            style: { setProperty() {}, removeProperty() {} },
            parentElement: null,
            matches: selector => selector.split(',').some(part => {
                const s = part.trim();
                if (s === `.${className}`) return true;
                if (id && s === `#${id}`) return true;
                if (id && s.includes(`#${id}`)) return true;
                return false;
            }),
            closest: selector => {
                if (selector.includes('profileModal') || selector.includes('profile-modal')) {
                    return obj.id === 'profileModal' || obj.className.includes('profile-modal') ? obj : null;
                }
                return null;
            },
            getBoundingClientRect: () => ({ left: 100, top: 100, width: 380, height: 600 }),
            checkVisibility: () => true,
            setAttribute: name => attributes.add(name),
            removeAttribute: name => attributes.delete(name),
            hasAttribute: name => attributes.has(name),
            toggleAttribute(name, force) { force ? attributes.add(name) : attributes.delete(name); }
        };
        return obj;
    }

    const profileModal = surface('modal-content profile-modal', 'profileModal');
    const profileModalContent = surface('modal-content profile-modal');
    profileModalContent.parentElement = profileModal;

    const body = { nodeType: 1, matches: () => false, querySelectorAll: () => [profileModal, profileModalContent] };
    const doc = {
        body, documentElement: { dataset: {} },
        createElement: () => ({ getContext: () => null }),
        elementsFromPoint: () => [body],
        querySelectorAll: () => [profileModal, profileModalContent],
        addEventListener() {}, removeEventListener() {}
    };
    const win = {
        innerWidth: 1440, innerHeight: 900,
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        getComputedStyle: () => ({ backgroundColor: '#000', position: 'fixed', backdropFilter: 'blur(10px)' }),
        requestAnimationFrame: callback => setTimeout(callback, 0),
        cancelAnimationFrame: () => {},
        clearTimeout: () => {},
        addEventListener() {}, removeEventListener() {},
        MutationObserver: class { observe() {} disconnect() {} }
    };

    let lensCalled = false;
    const controller = startDesktopNavGlass({
        doc, win, lens: () => {
            lensCalled = true;
            return { supported: true, ready: Promise.resolve(), destroy() {} };
        }
    });

    try {
        assert.equal(profileModal.hasAttribute('data-desktop-glass-surface'), false, 'profile modal overlay must not be a glass surface');
        assert.equal(profileModalContent.hasAttribute('data-desktop-glass-surface'), false, 'profile modal dialog content must not be a glass surface');
        assert.equal(lensCalled, false, 'liquid glass lens must not be instantiated on profile modal');
    } finally {
        controller.destroy();
    }
});

