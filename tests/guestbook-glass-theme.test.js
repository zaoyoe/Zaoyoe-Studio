const test = require('node:test');
const assert = require('node:assert/strict');

// Exercise the shared controller across theme, DOM and media changes. The
// synthetic card still advertises native blur to verify the explicit exclusion.
async function harness({ theme = 'dark', observer = true, guestbook = true } = {}) {
  const { startDesktopNavGlass } = await import('../js/desktop-nav-glass.mjs');
  const frames = new Map(), timers = new Map(), observers = [], lenses = [];
  const events = new Map(), media = [], cards = [];
  let next = 0, viewport;
  const root = { dataset: { theme } };
  function surface(className) {
    const attributes = new Map();
    const values = new Map();
    const el = {
      nodeType: 1, className, isConnected: true, parentElement: null,
      offsetWidth: 320, offsetHeight: 180, styleReads: 0, geometryReads: 0,
      dataset: {},
      style: { setProperty: (k, v) => values.set(k, v), removeProperty: k => values.delete(k) },
      values,
      matches: selector => selector.split(',').some(s => s.trim() === `.${className}`),
      closest: () => null, querySelectorAll: () => [],
      getBoundingClientRect() { this.geometryReads++; return { left: 30, top: 100, width: 320, height: 180 }; },
      checkVisibility: () => true,
      getAttribute: name => attributes.get(name) ?? null,
      hasAttribute: name => attributes.has(name),
      setAttribute: (name, value = '') => attributes.set(name, value),
      removeAttribute: name => {
        attributes.delete(name);
        if (name.startsWith('data-')) delete el.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
      },
      toggleAttribute(name, value) { value ? this.setAttribute(name) : this.removeAttribute(name); },
    };
    return el;
  }
  const nav = surface('framer-nav'), dock = surface('gdock');
  const card = surface('message-item'); cards.push(card);
  const body = {
    nodeType: 1, matches: s => guestbook && s === '.guestbook-page',
    querySelectorAll: s => s === '.message-item' ? cards : [nav, dock, ...cards],
  };
  const context = { clearRect() {}, fillRect() {}, getImageData: () => ({ data: [0, 0, 0, 255] }) };
  const doc = {
    body, documentElement: root,
    createElement: () => ({ getContext: () => context }),
    elementsFromPoint: () => [body], querySelectorAll: () => [nav],
    addEventListener() {}, removeEventListener() {},
  };
  const win = {
    innerWidth: 1280, innerHeight: 900,
    getComputedStyle(el, pseudo) {
      if (el === nav || el === dock || cards.includes(el)) el.styleReads++;
      return {
        position: 'relative', backgroundColor: '#000', content: 'none',
        backdropFilter: !pseudo && cards.includes(el) &&
          (root.dataset.theme === 'light' || 'desktopGlassSurface' in el.dataset) ? 'blur(7px)' : 'none',
      };
    },
    matchMedia() {
      const item = { matches: false, addEventListener: (_, fn) => { item.change = fn; }, removeEventListener() {} };
      media.push(item); return item;
    },
    requestAnimationFrame(fn) { frames.set(++next, fn); return next; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout(fn) { timers.set(++next, fn); return next; }, clearTimeout: id => timers.delete(id),
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: name => events.delete(name),
    MutationObserver: class {
      constructor(fn) { this.callback = fn; observers.push(this); }
      observe() {} disconnect() {}
    },
  };
  if (observer) win.IntersectionObserver = class {
    constructor(fn, options) { this.callback = fn; this.options = options; this.targets = new Set(); viewport = this; }
    observe(el) { this.targets.add(el); }
    unobserve(el) { this.targets.delete(el); }
    disconnect() { this.targets.clear(); this.disconnected = true; }
  };
  const controller = startDesktopNavGlass({ doc, win, lens: el => {
    let resolve;
    const ready = new Promise(done => { resolve = done; });
    const instance = { el, supported: true, ready, resolve, destroyed: 0, destroy() { this.destroyed++; } };
    lenses.push(instance); return instance;
  } });
  function paint() {
    const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn());
  }
  function toggle(value) { root.dataset.theme = value; observers[1].callback([]); }
  function settledScroll() {
    events.get('scroll')(); const batch = [...timers.values()]; timers.clear(); batch.forEach(fn => fn()); paint();
  }
  async function decode() {
    lenses.forEach(lens => lens.resolve()); await Promise.resolve(); paint(); paint();
  }
  return { controller, card, cards, nav, dock, body, root, media, viewport, lenses, frames, paint, toggle, decode,
    settledScroll, tree: observers[0], surface, events };
}

const adopted = el => 'desktopGlassSurface' in el.dataset;
const cardLenses = h => h.lenses.filter(l => h.cards.includes(l.el));

test('guestbook cards never acquire glass in either theme; navbar and Dock keep their lenses', async () => {
  for (const theme of ['light', 'dark']) {
    const h = await harness({ theme });
    try {
      const coreLenses = h.lenses.slice();
      assert.equal(adopted(h.nav), true);
      assert.equal(adopted(h.dock), true);
      assert.equal(h.viewport, undefined, 'Solid cards need no glass viewport observer');
      for (const nextTheme of ['dark', 'light', 'dark', 'light']) {
        h.toggle(nextTheme); await h.decode();
        assert.equal(adopted(h.card), false);
        assert.equal(cardLenses(h).length, 0);
        assert.equal(h.card.values.size, 0, 'No material properties are written');
        assert.equal(h.card.hasAttribute('data-desktop-glass-pending'), false);
        assert.equal(h.card.hasAttribute('data-desktop-glass-ready'), false);
      }
      coreLenses.forEach(lens => assert.equal(lens.destroyed, 0, 'Theme toggles preserve navbar/Dock lenses'));
    } finally { h.controller.destroy(); }
  }
});

test('scrolling, card updates and newly loaded messages never allocate or sample card glass', async () => {
  const h = await harness({ theme: 'light' });
  try {
    await h.decode();
    const navReads = h.nav.styleReads;
    h.settledScroll(); h.settledScroll();
    assert.ok(h.nav.styleReads > navReads, 'Core surface sampling is preserved');
    h.card.setAttribute('class', 'message-item comment-open');
    h.tree.callback([{ type: 'attributes', target: h.card, attributeName: 'class', oldValue: 'message-item' }]);
    const added = h.surface('message-item'); h.cards.push(added);
    h.tree.callback([{ type: 'childList', target: h.body, addedNodes: [added], removedNodes: [] }]);
    h.paint(); await h.decode();
    for (const card of h.cards) {
      assert.equal(adopted(card), false);
      assert.equal(card.styleReads, 0, 'Excluded cards skip material style reads');
      assert.equal(card.geometryReads, 0, 'Excluded cards skip material geometry reads');
      assert.equal(card.values.size, 0);
    }
    h.card.isConnected = false;
    h.settledScroll();
    assert.equal(cardLenses(h).length, 0);
  } finally { h.controller.destroy(); }
});

test('desktop/mobile and reduced-transparency changes cannot re-adopt guestbook cards', async () => {
  const h = await harness({ theme: 'light' });
  try {
    for (const media of h.media) {
      media.matches = true; media.change();
      h.toggle('dark'); h.paint();
      media.matches = false; media.change();
      h.toggle('light'); await h.decode();
      assert.equal(adopted(h.card), false);
      assert.equal(cardLenses(h).length, 0);
    }
    assert.equal(adopted(h.nav), true);
    assert.equal(adopted(h.dock), true);
  } finally { h.controller.destroy(); }
});

test('card exclusion does not depend on IntersectionObserver support', async () => {
  const h = await harness({ theme: 'light', observer: false });
  try {
    await h.decode(); h.settledScroll();
    h.toggle('dark'); h.paint(); h.toggle('light'); await h.decode();
    assert.equal(adopted(h.card), false);
    assert.equal(cardLenses(h).length, 0);
    assert.equal(h.card.styleReads, 0);
    assert.equal(h.card.geometryReads, 0);
  } finally { h.controller.destroy(); }
});

test('message cards on other pages retain their existing glass lifecycle', async () => {
  const h = await harness({ theme: 'light', guestbook: false });
  try {
    await h.decode();
    assert.equal(h.viewport, undefined);
    h.toggle('dark'); h.paint();
    assert.equal(adopted(h.card), true);
    assert.equal(cardLenses(h)[0].destroyed, 0);
  } finally { h.controller.destroy(); }
});
