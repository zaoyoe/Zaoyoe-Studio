const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const material = import('../js/mobile-glass.mjs');
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

function harness({ hasSource = true, motion = false, unavailable = false, paneStyle = {}, modalRing = false } = {}) {
  const listeners = new Map();
  const media = new Map();
  const observers = [];
  let now = 0;
  let sourceTop = 0;
  let reads = 0;
  let draws = 0;
  let styleReads = 0;
  let renderedSurfaces = [];
  let destroys = 0;
  let failDraw = false;
  const root = { dataset: { theme: 'light' } };
  const body = { closest: () => null, contains: () => true };
  const scene = { children: [], contains: el => el === source };
  const source = { parentElement: scene, closest: () => null, contains: () => false, getBoundingClientRect() { reads++; return rect(0, sourceTop, 393, 852); } };
  scene.children.push(source);
  const children = [];
  let inlineStyle = '';
  const pane = {
    getAttribute: name => name === 'style' ? inlineStyle : null,
    parentElement: body, dataset: {}, matches: selector => selector === '.glass-ring' ? modalRing : true, closest() { return this; },
    contains: () => false, querySelector: () => null,
    getBoundingClientRect: () => rect(0, 0, 393, 49),
    prepend(canvas) { children.unshift(canvas); canvas.isConnected = true; },
    removeAttribute() { delete this.dataset.mobileGlassOptics; },
  };
  const doc = {
    body, documentElement: root, hidden: false,
    getElementById: () => hasSource ? source : null,
    querySelectorAll: () => [pane], elementsFromPoint: () => [pane, source, body],
    createElement() {
      const ctx = { clearRect() {}, drawImage() {}, fillRect() {} };
      const canvas = { width: 0, height: 0, isConnected: false, ctx,
        setAttribute() {}, getContext: kind => kind === '2d' ? ctx : null,
        remove() { const i = children.indexOf(this); if (i >= 0) children.splice(i, 1); this.isConnected = false; },
      };
      return canvas;
    },
  };
  const win = {
    innerHeight: 852, devicePixelRatio: 3, performance: { now: () => now },
    getComputedStyle: el => { styleReads++; return { visibility: 'visible', display: 'block', opacity: '1', borderTopLeftRadius: '0', ...(el === pane ? paneStyle : {}),
      getPropertyValue(name) {
        return { '--mg-brightness': root.dataset.theme === 'dark' ? '.8284' : '1.039',
          '--mg-tint': root.dataset.theme === 'dark' ? '24, 27, 32' : '255, 255, 255',
          '--mg-alpha': root.dataset.theme === 'dark' ? '.64' : '.56' }[name];
      },
    }; },
    matchMedia(query) {
      if (!media.has(query)) {
        const callbacks = new Set();
        media.set(query, { matches: query.includes('motion') && motion,
          addEventListener: (_, cb) => callbacks.add(cb), removeEventListener: (_, cb) => callbacks.delete(cb),
          change(value) { this.matches = value; for (const cb of callbacks) cb(); }, callbacks,
        });
      }
      return media.get(query);
    },
    addEventListener(name, cb) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(cb); },
    removeEventListener: (name, cb) => listeners.get(name)?.delete(cb),
    MutationObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
    ResizeObserver: class { observe() {} disconnect() {} },
  };
  const createRenderer = (canvas, options) => {
    assert.equal(options.pixelRatio, 1.5, 'mobile rendering must cap DPR');
    if (unavailable) return null;
    return { draw() { draws++; renderedSurfaces = options.surfaces().map(s => ({ ...s })); canvas.width = 590; canvas.height = 1278; return !failDraw; }, destroy() { destroys++; } };
  };
  return { win, doc, source, pane, children, root, media, listeners, observers, createRenderer,
    tick(ms = 40) { now += ms; source.__mobileGlassFrame?.(); },
    event(name) { for (const cb of listeners.get(name) || []) cb(); },
    mutation(target, attributes = {}) { observers[0].cb([{ type: 'attributes', target, ...attributes }]); },
    setInlineStyle(value) { inlineStyle = value; },
    setModalRing(value) { modalRing = value; },
    sourceTop(value) { sourceTop = value; }, fail() { failDraw = true; },
    get styleReads() { return styleReads; }, get renderedSurfaces() { return renderedSurfaces; },
    get reads() { return reads; }, get draws() { return draws; }, get destroys() { return destroys; },
  };
}

test('mobile preset keeps CSS px independent of dock scale and DPR', async () => {
  const { MOBILE_GLASS_PRESET } = await material;
  assert.deepEqual(MOBILE_GLASS_PRESET, { blur: 6, strength: 0.78, refraction: 1.1, dispersion: 0.40 });
  assert.ok(Object.isFrozen(MOBILE_GLASS_PRESET));
});

test('source refraction rejects foreground text, bottom fade, empty and outside panes', async () => {
  const { canRefract } = await material;
  const scene = rect(0, 0, 393, 852);
  assert.equal(canRefract(rect(0, 0, 393, 49), scene, []), true);
  for (const pane of [rect(-1, 0, 393, 49), rect(0, -1, 393, 49), rect(0, 640, 393, 20), rect(0, 0, 0, 49)]) {
    assert.equal(canRefract(pane, scene, []), false);
  }
  assert.equal(canRefract(rect(0, 0, 393, 49), scene, [rect(30, 70, 300, 100)]), false, 'foreground needs a safety margin');
  assert.equal(canRefract(rect(0, 0, 393, 49), scene, [rect(30, 74, 300, 100)]), true);
});

test('eligible glass keeps its canvas across scrolling and unrelated class animations', async () => {
  const { createMobileGlassController } = await material;
  const h = harness(); const controller = createMobileGlassController(h);
  controller.start(); h.tick();
  const canvas = h.children[0];
  const reads = h.reads;
  h.mutation({ matches: () => false, contains: () => false, querySelector: () => null });
  h.tick();
  assert.equal(h.reads, reads, 'unrelated animations must not cause geometry reads');
  h.sourceTop(-10); h.event('scroll'); h.tick();
  assert.equal(h.children[0], canvas, 'keep the same canvas rather than flashing the native fallback');
  assert.equal(h.pane.dataset.mobileGlassOptics, 'canvas');
  h.sourceTop(-700); h.event('scroll');
  assert.equal(h.children.length, 0, 'retire an unsafe pane even if the hero no longer produces frames');
  assert.equal(h.pane.dataset.mobileGlassOptics, undefined);
  controller.stop();
});

test('theme changes recolor the mounted pane while scrolling preserves the theme', async () => {
  const { createMobileGlassController } = await material;
  const h = harness(); const controller = createMobileGlassController(h);
  controller.start(); h.tick(); const canvas = h.children[0];
  assert.equal(canvas.ctx.fillStyle, 'rgba(255, 255, 255,.56)');
  h.root.dataset.theme = 'dark'; h.mutation(h.root); h.tick();
  assert.equal(h.children[0], canvas);
  assert.equal(canvas.ctx.fillStyle, 'rgba(24, 27, 32,.64)');
  h.sourceTop(-20); h.event('scroll'); h.tick();
  assert.equal(canvas.ctx.fillStyle, 'rgba(24, 27, 32,.64)');
  controller.stop();
});

test('dynamic reduced motion/transparency removes optics and can resume safely', async () => {
  const { createMobileGlassController } = await material;
  const h = harness({ motion: true }); const controller = createMobileGlassController(h);
  controller.start(); h.tick(); assert.equal(h.children.length, 0);
  h.media.get('(prefers-reduced-motion: reduce)').change(false); h.tick();
  assert.equal(h.children.length, 1);
  h.media.get('(prefers-reduced-transparency: reduce)').change(true);
  assert.equal(h.children.length, 0); assert.equal(h.destroys, 1);
  h.media.get('(prefers-reduced-transparency: reduce)').change(false); h.tick();
  assert.equal(h.children.length, 1);
  controller.stop(); assert.equal(h.destroys, 2);
});

test('failed or unavailable optics leaves native CSS material without retrying each frame', async () => {
  const { createMobileGlassController } = await material;
  for (const unavailable of [false, true]) {
    const h = harness({ unavailable }); const controller = createMobileGlassController(h);
    controller.start(); h.tick();
    if (!unavailable) { h.fail(); h.tick(); }
    const draws = h.draws; h.tick();
    assert.equal(h.draws, draws); assert.equal(h.children.length, 0);
    assert.equal(h.pane.dataset.mobileGlassOptics, undefined);
    controller.stop();
  }
});

test('controller throttles drawing, restores the source hook and releases all listeners', async () => {
  const { createMobileGlassController } = await material;
  const h = harness(); let upstream = 0;
  const previous = () => upstream++;
  h.source.__mobileGlassFrame = previous;
  const controller = createMobileGlassController(h);
  controller.start(); controller.start(); h.tick(); h.tick(1);
  assert.equal(h.draws, 1); assert.equal(upstream, 2);
  controller.stop(); controller.stop();
  assert.equal(h.source.__mobileGlassFrame, previous);
  assert.equal(h.destroys, 1); assert.equal(h.children.length, 0);
  assert.ok([...h.listeners.values()].every(callbacks => callbacks.size === 0));
  assert.ok([...h.media.values()].every(m => m.callbacks.size === 0));
  assert.ok(h.observers.every(o => o.disconnected));
});

test('pages without a readable source keep native CSS without allocating a renderer', async () => {
  const { createMobileGlassController } = await material;
  const h = harness({ hasSource: false }); const controller = createMobileGlassController(h);
  controller.start(); h.tick(); controller.stop();
  assert.equal(h.draws, 0); assert.equal(h.listeners.size, 0); assert.equal(h.children.length, 0);
});

test('mobile theme material has no background-driven tone or tint writer', () => {
  const script = fs.readFileSync(path.join(__dirname, '../js/mobile-glass.mjs'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../css/magnifying-dock.css'), 'utf8').split('@layer mobile-glass')[1];
  assert.doesNotMatch(script, /pickInk|materialFor|getImageData|setProperty|mobileGlassTone/);
  assert.doesNotMatch(css, /data-mobile-glass-tone/);
  assert.match(css, /html:not\(\[data-theme="dark"\]\)/);
  assert.match(css, /\)\[data-mobile-glass-optics="canvas"\]\s*\{[^}]*backdrop-filter:\s*none/);
});

// Fingerprints of the four shader programs served by the phone-validated
// glasswork preview on 4174. The mobile lifecycle differs; the optics must not.
test('mobile optical shaders match the validated independent preview', () => {
  const { createHash } = require('node:crypto');
  const renderer = fs.readFileSync(path.join(__dirname, '../js/mobile-glass-refraction.mjs'), 'utf8');
  const reference = {
    VERT: '2794fdb48be3cb4eafecb0bf072e90518c4b575734fce8be1550403f5619e7b1',
    FRAG: 'c49bc21f609f398149e955c0b6cbc72315ba1b7ee7e906936967708a2e3fac8a',
    COPY_FRAG: 'af0188f2d666a81dde7cfab0db185dd87a32552a17ca20a4ff41c02484343c39',
    BLUR_FRAG: '795ce07f975496f5f14c283812a049e19c89a0adec1a84abc072f095ace49974',
  };
  for (const [name, fingerprint] of Object.entries(reference)) {
    const shader = renderer.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;'))?.[1];
    assert.ok(shader, name + ' must exist');
    assert.equal(createHash('sha256').update(shader).digest('hex'), fingerprint, name + ' must retain the preview optics');
  }
});

test('both themes retain the preview optical settings without style reads per frame', async () => {
  const { createMobileGlassController } = await material;
  const h = harness(); const controller = createMobileGlassController(h);
  controller.start(); h.tick();
  const check = () => {
    const s = h.renderedSurfaces[0];
    assert.deepEqual(
      [s.radius, s.rim, s.edge, s.power, s.blur, s.saturate, s.contrast, s.brightness, s.keep, s.dispersion],
      [22, 24, 1.1, 2.6, 6, 1.5, 1.04, 1.02, 1, .4]
    );
  };
  check();
  const reads = h.styleReads;
  h.tick(); h.tick();
  assert.equal(h.styleReads, reads, 'animated background frames must reuse theme material');
  h.root.dataset.theme = 'dark'; h.mutation(h.root); h.tick();
  check();
  assert.equal(h.children[0].ctx.fillStyle, 'rgba(24, 27, 32,.64)', 'theme still owns the tint');
  controller.stop();
});


test('fading panes have optics before their first visible frame without replaying the source hook', async () => {
  const { createMobileGlassController } = await material;
  const paneStyle = { visibility: 'hidden', opacity: '0' };
  const h = harness({ paneStyle }); let upstream = 0;
  h.source.__mobileGlassFrame = () => upstream++;
  const controller = createMobileGlassController(h);
  controller.start(); h.tick();
  assert.equal(h.children.length, 0);
  paneStyle.visibility = 'visible';
  h.mutation(h.pane);
  assert.equal(h.children.length, 1, 'prepare even the transparent start of a fade');
  assert.equal(h.pane.dataset.mobileGlassOptics, 'canvas');
  assert.equal(upstream, 1, 'opening uses the last source frame without replaying its hook');
  paneStyle.opacity = '.12'; h.tick(1);
  assert.equal(h.children.length, 1);
  assert.equal(h.draws, 1, 'normal source frames retain the 30fps cap');
  paneStyle.visibility = 'hidden'; h.mutation(h.pane);
  assert.equal(h.children.length, 0, 'closing before the next source frame retires the pane');
  controller.stop();
});

test('opening before the first source frame waits for valid pixels and ignores ink-only styles', async () => {
  const { createMobileGlassController } = await material;
  const h = harness(); const controller = createMobileGlassController(h);
  controller.start(); h.mutation(h.pane);
  assert.equal(h.draws, 0, 'never draw an uninitialized source');
  h.tick();
  const reads = h.reads, draws = h.draws;
  h.setInlineStyle('--glass-control-ink: #ffffff');
  h.mutation(h.pane, { attributeName: 'style', oldValue: '' });
  assert.equal(h.reads, reads); assert.equal(h.draws, draws);
  h.setInlineStyle('display: block; --glass-control-ink: #ffffff');
  h.mutation(h.pane, { attributeName: 'style', oldValue: '--glass-control-ink: #ffffff' });
  assert.equal(h.draws, draws + 1, 'an inline visibility/layout change paints before the next frame');
  controller.stop();
});


test('modal rings never receive a rectangular source canvas even over an eligible hero', async () => {
  const { createMobileGlassController } = await material;
  const h = harness({ modalRing: true });
  const controller = createMobileGlassController(h);
  controller.start();
  h.tick();
  assert.equal(h.children.length, 0);
  assert.equal(h.pane.dataset.mobileGlassOptics, undefined);
  assert.equal(h.draws, 0, 'the hollow CSS rim needs no source renderer');
  controller.stop();
});

test('an existing mobile pane is retired if its host becomes a modal ring', async () => {
  const { createMobileGlassController } = await material;
  const h = harness();
  const controller = createMobileGlassController(h);
  controller.start();
  h.tick();
  assert.equal(h.children.length, 1);
  h.setModalRing(true);
  h.event('resize');
  assert.equal(h.children.length, 0);
  assert.equal(h.pane.dataset.mobileGlassOptics, undefined);
  controller.stop();
});
