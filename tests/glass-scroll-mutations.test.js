const test = require('node:test');
const assert = require('node:assert/strict');
const subject = import('../js/glass-mutations.mjs');

function element(attributes = {}, lensMap = false) {
    return {
        nodeType: 1,
        getAttribute: name => attributes[name] ?? null,
        matches: () => lensMap, closest: () => null,
    };
}

test('unchanged attributes and scrollbar visibility never invalidate glass sampling', async () => {
    const { affectsGlass } = await subject;
    for (const [name, value] of [['class', 'framer-nav scrolled'], ['style', 'opacity:1'], ['aria-expanded', 'false'], ['data-desktop-glass-kind', 'dark']]) {
        assert.equal(affectsGlass({ type: 'attributes', target: element({ [name]: value }), attributeName: name, oldValue: value }), false);
    }
    for (const [oldValue, value] of [
        ['guestbook-page', 'guestbook-page public-scrollbar-auto-hide--visible'],
        ['guestbook-page public-scrollbar-auto-hide--visible', 'guestbook-page'],
    ]) {
        assert.equal(affectsGlass({ type: 'attributes', target: element({ class: value }), attributeName: 'class', oldValue }), false);
    }
    assert.equal(affectsGlass({ type: 'attributes', target: element({ class: 'framer-nav scrolled' }), attributeName: 'class', oldValue: 'framer-nav' }), true);
});

test('lens-map insertion, replacement and internal changes do not rescan the page', async () => {
    const { affectsGlass } = await subject;
    const map = element({}, true), body = element();
    for (const [addedNodes, removedNodes] of [[[map], []], [[], [map]], [[map], [map]]]) {
        assert.equal(affectsGlass({ type: 'childList', target: body, addedNodes, removedNodes }), false);
    }
    assert.equal(affectsGlass({ type: 'attributes', target: map, attributeName: 'style', oldValue: null }), false);
    assert.equal(affectsGlass({ type: 'childList', target: body, addedNodes: [map, element()], removedNodes: [] }), true, 'A real new popover must still be prepared');
    assert.equal(affectsGlass({ type: 'childList', target: body, addedNodes: [{ nodeType: 3 }], removedNodes: [] }), true, 'Changed page text still affects sampling');
});

// Exercise the controller with a manually flushed frame queue. A real new
// popover must be prepared in the mutation turn; existing glass may be sampled
// only once in the next frame, and redundant scroll state must schedule none.
async function controllerHarness() {
    const { startDesktopNavGlass } = await import('../js/desktop-nav-glass.mjs');
    const stats = { samples: 0, refreshes: 0, scans: 0, styleWrites: 0, instances: [] };
    const observers = [], frames = new Map(), surfaces = [];
    let frameId = 0;
    let background = '#000';
    function surface(className, visible = true) {
        const attributes = new Map([['class', className]]);
        const node = {
            nodeType: 1, className, dataset: {}, props: new Map(), isConnected: true, parentElement: null,
            offsetWidth: visible ? 200 : 0, offsetHeight: visible ? 54 : 0, visible,
            style: { setProperty(name, value) { stats.styleWrites++; node.props.set(name, value); }, removeProperty() {} },
            matches: selector => selector.split(',').some(s => s.trim() === `.${className}`),
            querySelectorAll: () => [], closest: () => null,
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 54 }),
            checkVisibility() { return this.visible; },
            getAttribute: name => attributes.get(name) ?? null,
            setAttribute: (name, value = '') => attributes.set(name, value),
            removeAttribute: name => attributes.delete(name),
            hasAttribute: name => attributes.has(name),
            toggleAttribute(name, force) { force ? attributes.set(name, '') : attributes.delete(name); },
        };
        surfaces.push(node);
        return node;
    }
    const nav = surface('framer-nav');
    const body = { nodeType: 1, matches: () => false, getAttribute: () => null,
        querySelectorAll() { stats.scans++; return surfaces; } };
    const colorContext = {
        clearRect() {}, fillRect() {},
        getImageData() {
            let hex = this.fillStyle.slice(1);
            if (hex.length === 3) hex = [...hex].map(value => value + value).join('');
            return { data: [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16)).concat(255) };
        },
    };
    const doc = {
        body, documentElement: { dataset: {} },
        createElement: () => ({ getContext: () => colorContext }),
        elementsFromPoint() { stats.samples++; return [body]; },
        querySelectorAll: () => [nav], addEventListener() {}, removeEventListener() {},
    };
    const win = {
        innerWidth: 1440, innerHeight: 900,
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        getComputedStyle: () => ({ backgroundColor: background, position: 'fixed' }),
        requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame: id => frames.delete(id), clearTimeout() {},
        addEventListener() {}, removeEventListener() {},
        MutationObserver: class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe(target, options) { this.target = target; this.options = options; }
            disconnect() {}
        },
    };
    const controller = startDesktopNavGlass({ doc, win, lens: (el, options) => {
        let resolve;
        const ready = new Promise(done => { resolve = done; });
        stats.instances.push({ el, resolve, options });
        return { supported: true, ready, destroy() {}, refresh() { stats.refreshes++; } };
    } });
    const paint = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); };
    return { controller, stats, frames, surface, nav, body, paint, tree: observers[0], theme: observers[1], navObserver: observers[2], doc,
        setBackdrop(color) { background = color; observers[1].callback([]); paint(); } };
}

test('no-op mutations skip controller sampling while real navbar batches refresh once', async () => {
    const h = await controllerHarness();
    try {
        const samples = h.stats.samples, scans = h.stats.scans, styleWrites = h.stats.styleWrites;
        const noOp = { type: 'attributes', target: h.nav, attributeName: 'class', oldValue: 'framer-nav' };
        h.tree.callback([noOp]); h.navObserver.callback([noOp]);
        assert.equal(h.frames.size, 0);
        assert.equal(h.stats.samples, samples);
        assert.equal(h.stats.scans, scans);
        assert.equal(h.stats.refreshes, 0);
        assert.equal(h.navObserver.options.attributeOldValue, true);
        h.nav.setAttribute('class', 'framer-nav scrolled');
        h.tree.callback([noOp, noOp]); h.navObserver.callback([noOp, noOp]);
        assert.equal(h.stats.refreshes, 1, 'One refresh per real target in a mutation batch');
        assert.equal(h.stats.samples, samples, 'Existing surfaces are not sampled synchronously again');
        assert.equal(h.frames.size, 1, 'Batch coalesces to one global tone frame');
        h.paint();
        assert.equal(h.stats.samples, samples * 2, 'Only one nine-point resample per existing surface');
        assert.equal(h.stats.styleWrites, styleWrites, 'The same tone is not written again');
    } finally { h.controller.destroy(); }
});

test('new and display-none popovers keep synchronous lens preparation and two-frame readiness', async () => {
    const h = await controllerHarness();
    try {
        const samples = h.stats.samples;
        const menu = h.surface('avatar-dropdown', false);
        h.tree.callback([{ type: 'childList', target: h.body, addedNodes: [menu], removedNodes: [] }]);
        assert.equal(h.stats.instances.length, 1, 'Zero-size menu waits for a measurable layout');
        menu.visible = true; menu.offsetWidth = 200; menu.offsetHeight = 54;
        menu.setAttribute('style', 'display: block');
        h.tree.callback([{ type: 'attributes', target: menu, attributeName: 'style', oldValue: 'display: none' }]);
        assert.equal(h.stats.instances.length, 2, 'Menu lens is prepared before the first paint');
        assert.equal(menu.hasAttribute('data-desktop-glass-pending'), true);
        assert.equal(h.stats.samples, samples * 3, 'Only the changed menu was sampled, once in each visibility state');
        h.stats.instances[1].resolve();
        await Promise.resolve();
        h.paint();
        assert.equal(menu.hasAttribute('data-desktop-glass-pending'), true, 'Decoded filter commits before reveal');
        h.paint();
        assert.equal(menu.hasAttribute('data-desktop-glass-pending'), false);
        assert.equal(menu.hasAttribute('data-desktop-glass-ready'), true);
    } finally { h.controller.destroy(); }
});


test('modal rims follow the page theme regardless of prior ink while retaining backdrop adaptation', async () => {
    const h = await controllerHarness();
    try {
        const first = h.surface('glass-ring'), second = h.surface('glass-ring');
        first.dataset.desktopGlassKind = 'dark';
        second.dataset.desktopGlassKind = 'light';
        h.doc.documentElement.dataset.theme = 'light';
        h.setBackdrop('#808080');
        h.tree.callback([{ type: 'childList', target: h.body, addedNodes: [first, second], removedNodes: [] }]);
        h.paint();
        assert.equal(first.dataset.desktopGlassKind, 'light');
        assert.equal(second.dataset.desktopGlassKind, 'light');
        assert.deepEqual(first.props, second.props, 'Identical backdrops give identical material despite different prior ink');
        const grayDensity = first.props.get('--dng-density');
        h.setBackdrop('#ffffff');
        assert.notEqual(first.props.get('--dng-density'), grayDensity, 'Background luminance is still sampled');
        const neutralKeep = first.props.get('--dng-keep');
        h.setBackdrop('#ff0000');
        assert.notEqual(first.props.get('--dng-keep'), neutralKeep, 'Background color still affects saturation');
        assert.equal(first.dataset.desktopGlassKind, 'light', 'Backdrop changes do not change the base theme');
        h.doc.documentElement.dataset.theme = 'dark';
        h.setBackdrop('#ffffff');
        assert.equal(first.dataset.desktopGlassKind, 'dark');
        assert.equal(second.dataset.desktopGlassKind, 'dark');
        assert.equal(h.nav.dataset.desktopGlassKind, 'light', 'Navbar keeps its existing backdrop-driven ink');
        for (const { el, options } of h.stats.instances) {
            assert.equal(options.preserveSourceAlpha === true, el.className === 'glass-ring',
                'Only modal rims use source-alpha preservation');
        }
    } finally { h.controller.destroy(); }
});
