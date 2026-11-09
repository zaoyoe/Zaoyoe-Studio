const { test } = require('node:test');
const assert = require('node:assert/strict');
const subject = import('../js/glass-foreground.mjs');

test('foreground luminance uses linear sRGB, including channel weighting', async () => {
  const { relativeLuminance } = await subject;
  assert.equal(relativeLuminance([0, 0, 0]), 0);
  assert.equal(relativeLuminance([255, 255, 255]), 1);
  assert.ok(Math.abs(relativeLuminance([128, 128, 128]) - .21586) < .00001);
  assert.ok(relativeLuminance([0, 255, 0]) > relativeLuminance([255, 0, 0]));
});

test('separate controls over black and white images choose opposite inks', async () => {
  const { chooseInk } = await subject;
  assert.equal(chooseInk(Array(9).fill([4, 4, 4]), null), 'light');
  assert.equal(chooseInk(Array(9).fill([248, 248, 248]), null), 'dark');
});

test('a small bright detail does not flip a mostly dark image control', async () => {
  const { chooseInk } = await subject;
  assert.equal(chooseInk([...Array(8).fill([8, 12, 16]), [255, 255, 255]], null), 'light');
});

// Captured from the shop dropdown over the gallery at scrollY=360. Both
// controls previously kept black OR white indefinitely, depending on history.
test('mixed gallery edges converge to readable white from either previous ink', async () => {
  const { chooseInk, resolveControlInk } = await subject;
  const samples = [
    [...Array(4).fill([255, 255, 255]), ...Array(5).fill([14, 14, 14])],
    [...Array(3).fill([255, 255, 255]), [36.68, 35.74, 43.30], [38.57, 37.63, 42.35],
      [39.52, 38.57, 43.30], [41.41, 40.46, 45.19], [42.35, 41.41, 46.13], [43.30, 43.30, 47.08]],
  ];
  for (const colors of samples) for (const ink of [null, 'dark', 'light']) {
    assert.equal(chooseInk(colors, ink, 'dark', 'light'), 'light');
    const state = resolveControlInk(colors, { theme: 'light', ink }, { theme: 'light', now: 20 });
    assert.equal(state.ink, 'light', 'an unreadable historical ink must switch immediately');
    assert.equal(state.pending, null);
  }
});

test('scrolling through contrasting panels and back restores the same mixed-image ink', async () => {
  const { resolveControlInk } = await subject;
  const image = [...Array(3).fill([255, 255, 255]), ...Array(6).fill([39, 39, 43])];
  let state = {};
  let now = 0;
  for (const colors of [image, Array(9).fill([255, 255, 255]), image, Array(9).fill([0, 0, 0]), image]) {
    state = resolveControlInk(colors, state, { theme: 'light', now: now += 48 });
    assert.equal(state.ink, colors === image || colors[0][0] === 0 ? 'light' : 'dark');
  }
});

test('hysteresis suppresses near-threshold oscillation but permits a decisive change', async () => {
  const { chooseInk } = await subject;
  let threshold;
  for (let v = 30; v < 200; v++) {
    if (chooseInk([[v, v, v]], null) === 'dark') { threshold = v; break; }
  }
  assert.ok(threshold);
  assert.equal(chooseInk([[threshold, threshold, threshold]], 'light'), 'light');
  assert.equal(chooseInk([[255, 255, 255]], 'light'), 'dark');
  assert.equal(chooseInk([[0, 0, 0]], 'dark'), 'light');
});

test('slow fluctuations on either side of the crossover retain both settled inks', async () => {
  const { resolveControlInk } = await subject;
  for (const theme of ['light', 'dark']) for (const ink of ['light', 'dark']) {
    let state = { theme, ink, pending: null };
    // Each fluctuation lasts well beyond settling time. Stability must come
    // from distinct entry/exit thresholds, not a slow response or cooldown.
    for (let i = 0; i < 40; i++) {
      const v = i % 2 ? 139 : 115;
      state = resolveControlInk(Array(9).fill([v, v, v]), state, { theme, now: i * 400 });
      assert.equal(state.ink, ink, `${theme}/${ink} fluctuation ${i}`);
      assert.equal(state.pending, null);
    }
  }
});

test('a completed marginal switch resists noisy reversals and still responds immediately to black', async () => {
  const { resolveControlInk } = await subject;
  for (const theme of ['light', 'dark']) {
    let state = resolveControlInk(Array(9).fill([0, 0, 0]), {}, { theme });
    state = resolveControlInk(Array(9).fill([145, 145, 145]), state, { theme, now: 20 });
    assert.equal(state.pending, 'dark');
    state = resolveControlInk(Array(9).fill([145, 145, 145]), state, { theme, now: 84 });
    assert.equal(state.ink, 'dark');
    for (const [i, v] of [139, 115, 125, 117].entries()) {
      state = resolveControlInk(Array(9).fill([v, v, v]), state, { theme, now: 100 + i * 400 });
      assert.equal(state.ink, 'dark');
    }
    state = resolveControlInk(Array(9).fill([0, 0, 0]), state, { theme, now: 1301 });
    assert.equal(state.ink, 'light');
    assert.equal(state.pending, null);
    state = resolveControlInk(Array(9).fill([255, 255, 255]), state, { theme, now: 1317 });
    assert.equal(state.ink, 'dark', 'no global cooldown may block a real reverse crossing');
  }
});

test('unavailable samples have an explicit theme fallback', async () => {
  const { chooseInk } = await subject;
  assert.equal(chooseInk([], null, 'light'), 'light');
  assert.equal(chooseInk([], null, 'dark'), 'dark');
});

test('cover maps the cropped photo, rather than stretching the complete source', async () => {
  const { imagePoint } = await subject;
  assert.deepEqual(imagePoint({ x: 0, y: 50, width: 100, height: 100, naturalWidth: 200, naturalHeight: 100, fit: 'cover' }), [.25, .5]);
  assert.deepEqual(imagePoint({ x: 0, y: 50, width: 100, height: 100, naturalWidth: 200, naturalHeight: 100, fit: 'cover', position: 'right center' }), [.5, .5]);
});

test('contain leaves letterboxing unpainted', async () => {
  const { imagePoint } = await subject;
  const photo = { width: 100, height: 100, naturalWidth: 200, naturalHeight: 100, fit: 'contain' };
  assert.equal(imagePoint({ ...photo, x: 50, y: 10 }), null);
  assert.deepEqual(imagePoint({ ...photo, x: 50, y: 50 }), [.5, .5]);
});

test('edge-offset positions, natural sizing and scale-down map correctly', async () => {
  const { imagePoint } = await subject;
  const photo = { width: 100, height: 100, naturalWidth: 20, naturalHeight: 20 };
  assert.deepEqual(imagePoint({ ...photo, x: 60, y: 70, fit: 'none', position: 'right 30px bottom 20px' }), [.5, .5]);
  assert.deepEqual(imagePoint({ ...photo, x: 50, y: 50, fit: 'scale-down' }), [.5, .5]);
  assert.equal(imagePoint({ ...photo, x: 1, y: 1, fit: 'scale-down' }), null);
  assert.equal(imagePoint({ ...photo, naturalWidth: 0, x: 1, y: 1 }), null);
});

test('controls on one glass surface keep independent foreground decisions', async () => {
  const { resolveControlInk } = await subject;
  const darkPhoto = Array(9).fill([4, 4, 4]);
  const brightPhoto = Array(9).fill([248, 248, 248]);
  const state = { theme: 'dark', ink: 'light', pending: null };
  assert.equal(resolveControlInk(darkPhoto, state).ink, 'light');
  assert.equal(resolveControlInk(brightPhoto, state).ink, 'dark');
  assert.equal(state.ink, 'light', 'one control must not mutate another control state');
});

test('decisive black and white crossings change ink in the current update', async () => {
  const { resolveControlInk } = await subject;
  const initial = resolveControlInk(Array(9).fill([0, 0, 0]), {}, { now: 0 });
  const bright = resolveControlInk(Array(9).fill([255, 255, 255]), initial, { now: 120 });
  assert.equal(bright.ink, 'dark');
  assert.equal(bright.pending, null);
  const dark = resolveControlInk(Array(9).fill([0, 0, 0]), bright, { now: 240 });
  assert.equal(dark.ink, 'light');
  assert.equal(dark.pending, null);
});

test('marginal edges must persist and interrupted decisions restart their settling time', async () => {
  const { resolveControlInk } = await subject;
  const grey = Array(9).fill([145, 145, 145]);
  const darkPhoto = Array(9).fill([0, 0, 0]);
  const initial = resolveControlInk(darkPhoto);
  const pending = resolveControlInk(grey, initial, { now: 120 });
  assert.equal(pending.ink, 'light');
  assert.equal(pending.pending, 'dark');
  assert.equal(resolveControlInk(grey, pending, { now: 183 }).ink, 'light');
  assert.equal(resolveControlInk(grey, pending, { now: 184 }).ink, 'dark');
  const interrupted = resolveControlInk(darkPhoto, pending, { now: 150 });
  assert.equal(interrupted.pending, null);
  const restarted = resolveControlInk(grey, interrupted, { now: 250 });
  assert.equal(resolveControlInk(grey, restarted, { now: 313 }).ink, 'light');
  assert.equal(resolveControlInk(grey, restarted, { now: 314 }).ink, 'dark');
});

test('unreadable and partial photos retain trusted ink and cancel pending decisions', async () => {
  const { resolveControlInk } = await subject;
  const initial = resolveControlInk(Array(9).fill([0, 0, 0]));
  const pending = resolveControlInk(Array(9).fill([145, 145, 145]), initial, { now: 120 });
  for (const samples of [[], [[255, 255, 255]], Array(6).fill([255, 255, 255])]) {
    const state = resolveControlInk(samples, pending, { now: 1000, complete: false });
    assert.equal(state.ink, 'light');
    assert.equal(state.pending, null);
  }
});

test('first paint and theme changes select the matching fallback for unknown media', async () => {
  const { resolveControlInk } = await subject;
  assert.equal(resolveControlInk([], {}, { theme: 'light' }).ink, 'dark');
  assert.equal(resolveControlInk([], {}, { theme: 'dark' }).ink, 'light');
  const previous = { theme: 'dark', ink: 'light', pending: null };
  const lightTheme = resolveControlInk([], previous, { theme: 'light' });
  assert.equal(lightTheme.ink, 'dark');
  assert.equal(resolveControlInk([], lightTheme, { theme: 'dark' }).ink, 'light');
});


test('light theme uses pure white on dark backgrounds while preserving dark-theme ink', async () => {
  const { resolveControlInk, foregroundColor } = await subject;
  for (const theme of ['light', 'dark']) {
    const dark = resolveControlInk(Array(9).fill([8, 12, 16]), {}, { theme });
    const bright = resolveControlInk(Array(9).fill([248, 250, 252]), {}, { theme });
    assert.equal(dark.ink, 'light');
    assert.equal(bright.ink, 'dark');
    assert.equal(foregroundColor(dark.ink, theme), theme === 'light' ? '#ffffff' : '#f8fafc');
    assert.equal(foregroundColor(bright.ink, theme), '#17212b');
  }
});

test('a theme change updates the white even when the foreground kind stays light', async () => {
  const { resolveControlInk, foregroundColor } = await subject;
  const photo = Array(9).fill([8, 12, 16]);
  const dark = resolveControlInk(photo, {}, { theme: 'dark' });
  const light = resolveControlInk(photo, dark, { theme: 'light', now: 120 });
  const restored = resolveControlInk(photo, light, { theme: 'dark', now: 240 });
  assert.equal(light.ink, dark.ink);
  assert.notEqual(foregroundColor(light.ink, light.theme), foregroundColor(dark.ink, dark.theme));
  assert.equal(foregroundColor(restored.ink, restored.theme), foregroundColor(dark.ink, dark.theme));
});

test('light-theme controls switch independently and keep a stable decision on interrupted edges', async () => {
  const { resolveControlInk } = await subject;
  const white = Array(18).fill([255, 255, 255]);
  const black = Array(18).fill([0, 0, 0]);
  const grey = Array(18).fill([145, 145, 145]);
  const first = resolveControlInk(white, {}, { theme: 'light' });
  const second = resolveControlInk(black, {}, { theme: 'light' });
  assert.equal(first.ink, 'dark');
  assert.equal(second.ink, 'light');
  const pending = resolveControlInk(grey, second, { theme: 'light', now: 160 });
  assert.equal(pending.pending, 'dark');
  const returned = resolveControlInk(black, pending, { theme: 'light', now: 192 });
  assert.equal(returned.ink, 'light');
  assert.equal(returned.pending, null);
  assert.equal(resolveControlInk(white, returned, { theme: 'light', now: 400 }).ink, 'dark');
  assert.equal(first.ink, 'dark');
});

const tick = () => new Promise(resolve => setImmediate(resolve));
const grid = { width: 1, height: 1, naturalWidth: 100, naturalHeight: 100, pixels: Buffer.from([8, 12, 16, 255]).toString('base64') };
const sampleWin = fetch => ({ fetch, AbortController, setTimeout, clearTimeout, atob });
const cdnPhoto = n => `https://cdn.fatherkey.com/prompts/test-${n}.jpg`;

test('gallery sampling is lazy, deduplicated, limited to two requests and cached', async () => {
  const { createGallerySampleReader } = await subject;
  const jobs = []; let ready = 0;
  const reader = createGallerySampleReader({ win: sampleWin((url, options) => new Promise(resolve => jobs.push({ url, options, resolve }))), baseURI: 'http://localhost/', onReady: () => ready++ });
  assert.equal(jobs.length, 0);
  const first = reader.read(cdnPhoto(1)); reader.read(cdnPhoto(1)); reader.read(cdnPhoto(2)); reader.read(cdnPhoto(3));
  await tick(); assert.equal(jobs.length, 2); assert.equal(jobs[0].options.credentials, 'omit');
  jobs[0].resolve({ ok: true, json: async () => grid }); await tick(); assert.equal(jobs.length, 3);
  assert.deepEqual([...first.data], [8, 12, 16, 255]); assert.equal(ready, 1);
  assert.equal(reader.read(cdnPhoto(1)), first); assert.equal(jobs.length, 3);
  jobs[1].resolve({ ok: false }); jobs[2].resolve({ ok: true, json: async () => grid }); await tick(); reader.destroy();
});

test('failed or malformed grids stay stable without request or update loops', async () => {
  const { createGallerySampleReader } = await subject;
  let calls = 0, ready = 0;
  const reader = createGallerySampleReader({ win: sampleWin(async () => { calls++; return { ok: true, json: async () => ({ ...grid, pixels: 'bad' }) }; }), baseURI: 'http://localhost/', onReady: () => ready++ });
  const entry = reader.read(cdnPhoto(1)); await tick();
  for (let i = 0; i < 10; i++) assert.equal(reader.read(cdnPhoto(1)), entry);
  assert.equal(calls, 1); assert.equal(ready, 0); assert.equal(entry.data, undefined); reader.destroy();
});

test('gallery reader rejects foreign sources and aborts active work on destroy', async () => {
  const { createGallerySampleReader } = await subject;
  const signals = [];
  const reader = createGallerySampleReader({ win: sampleWin(async (_url, { signal }) => { signals.push(signal); throw new Error('offline'); }), baseURI: 'http://localhost/' });
  for (const url of ['https://evil.test/a.jpg', 'https://cdn.fatherkey.com/private/a.jpg', 'https://cdn.fatherkey.com/prompts/a.svg']) assert.equal(reader.read(url), null);
  reader.read(cdnPhoto(1)); await tick(); reader.read(cdnPhoto(2)); await tick(); reader.destroy();
  assert.equal(reader.read(cdnPhoto(3)), null);
  assert.equal(signals.length, 2);
  const running = [];
  const active = createGallerySampleReader({ win: sampleWin((_url, { signal }) => new Promise((_resolve, reject) => { running.push(signal); signal.addEventListener('abort', () => reject(new Error('aborted'))); })), baseURI: 'http://localhost/' });
  active.read(cdnPhoto(1)); active.read(cdnPhoto(2)); active.read(cdnPhoto(3)); await tick(); active.destroy(); await tick();
  assert.equal(running.length, 2); assert.ok(running.every(signal => signal.aborted));
});


const gradientColors = value => ({
  black: [0, 0, 0, 255], white: [255, 255, 255, 255],
  transparent: [0, 0, 0, 0], red: [255, 0, 0, 255],
  'rgba(0, 0, 0, 0.7)': [0, 0, 0, 178.5],
  'rgba(0, 0, 0, 0.4)': [0, 0, 0, 102],
  'rgba(0, 0, 0, 0.1)': [0, 0, 0, 25.5],
})[value] || null;

test('featured-banner gradient samples translucent stops in painted order', async () => {
  const { createLinearGradientSampler } = await subject;
  const sample = createLinearGradientSampler('linear-gradient(to right, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.4) 50%, rgba(0, 0, 0, 0.1) 100%)', gradientColors);
  const at = x => sample({ x, y: 40, width: 1000, height: 200 });
  assert.ok(Math.abs(at(0)[3] - 178.5) < 1e-8);
  assert.ok(Math.abs(at(250)[3] - 140.25) < 1e-8);
  assert.ok(Math.abs(at(1000)[3] - 25.5) < 1e-8);
});

test('gradient direction and line geometry work on rectangular artwork', async () => {
  const { createLinearGradientSampler } = await subject;
  const at = (direction, x, y) => createLinearGradientSampler(`linear-gradient(${direction}, black, white)`, gradientColors)({ x, y, width: 200, height: 100 });
  assert.ok(at('to bottom', 100, 0)[0] < 1e-8);
  assert.ok(at('to left', 0, 50)[0] > 254.999);
  assert.ok(Math.abs(at('45deg', 200, 0)[0] - 255) < 1e-8);
  assert.ok(Math.abs(at('90deg', 50, 50)[0] - 63.75) < 1e-8);
});

test('gradient interpolation preserves alpha and resolves pixel and omitted stops', async () => {
  const { createLinearGradientSampler } = await subject;
  const transparent = createLinearGradientSampler('linear-gradient(to right, transparent, red)', gradientColors)({ x: 50, y: 20, width: 100, height: 40 });
  assert.deepEqual(transparent, [255, 0, 0, 127.5]);
  const sample = createLinearGradientSampler('linear-gradient(to right, black 20px, red, white 80px)', gradientColors);
  assert.deepEqual(sample({ x: 50, y: 20, width: 100, height: 40 }), [255, 0, 0, 255]);
  assert.deepEqual(sample({ x: 0, y: 20, width: 100, height: 40 }), [0, 0, 0, 255]);
});

test('unsupported multilayer, angled keywords and invalid paint stay unknown', async () => {
  const { createLinearGradientSampler } = await subject;
  for (const paint of ['none', 'radial-gradient(black, white)', 'linear-gradient(black, white), linear-gradient(white, black)', 'linear-gradient(to top right, black, white)', 'linear-gradient(in oklab, black, white)', 'linear-gradient(black 20% 40%, white)', 'linear-gradient(not-a-color, white)']) {
    assert.equal(createLinearGradientSampler(paint, gradientColors), null, paint);
  }
});

function breathingScene({ phase = 0, scroll = 0, transform, animationName = 'breathe', overlay = false } = {}) {
  const body = { contains: () => true };
  const image = { contains: node => node === image };
  const card = { contains: node => node === card || node === image };
  const panel = { contains: node => node === panel };
  const top = 100 - scroll + phase;
  const box = { left: 0, right: 200, top, bottom: top + 200, width: 200, height: 200 };
  const style = { animationName, transform: transform || `matrix(1, 0, 0, 1, 0, ${phase})`, visibility: 'visible', display: 'block', opacity: '1' };
  const options = { styleOf: () => style, rectOf: () => box,
    hitTest: (x, y) => [...(overlay ? [panel] : []), ...(x >= 0 && x < 200 && y >= top && y < top + 200 ? [image, card] : []), body] };
  return { card, image, panel, body, box, options };
}

test('breathing phases keep the same image coordinate and ink without a cooldown', async () => {
  const { createBreathingBackdropSampler, resolveControlInk } = await subject;
  for (const animationName of ['breathe', 'breatheMobileMasonry']) {
    let state = {};
    for (const [i, phase] of [0, -1, -2.5, -3, -1.5, 0].entries()) {
      const h = breathingScene({ phase, animationName });
      const sample = createBreathingBackdropSampler([h.card], h.options)(50, 130);
      assert.ok(sample.nodes.includes(h.image));
      const localY = sample.pointFor(h.image)[1] - h.box.top;
      assert.equal(localY, 30, 'decorative motion must not move the probe across an image edge');
      state = resolveControlInk(Array(9).fill(localY < 31 ? [0, 0, 0] : [255, 255, 255]), state, { theme: 'light', now: i * 1000 });
      assert.equal(state.ink, 'light');
    }
  }
});

test('resting card hit tests keep both edges and stationary overlays consistent', async () => {
  const { createBreathingBackdropSampler } = await subject;
  const h = breathingScene({ phase: -3, overlay: true });
  const sample = createBreathingBackdropSampler([h.card], h.options);
  assert.deepEqual(sample(50, 99).nodes, [h.panel, h.body], 'the upward bob must not enter the resting gap');
  const bottom = sample(50, 299);
  assert.deepEqual(bottom.nodes, [h.panel, h.image, h.card, h.body], 'the resting bottom must not disappear during the bob');
  assert.deepEqual(bottom.pointFor(h.image), [50, 296]);
  assert.deepEqual(bottom.pointFor(h.panel), [50, 299], 'stationary artwork must use its original coordinates');
});

test('real scroll and changed images remain immediately responsive with breathing anchored', async () => {
  const { createBreathingBackdropSampler, resolveControlInk } = await subject;
  let state = {};
  for (const [i, scroll] of [0, 50, 0].entries()) {
    const h = breathingScene({ phase: -2, scroll });
    const sample = createBreathingBackdropSampler([h.card], h.options)(50, 130);
    const localY = sample.pointFor(h.image)[1] - h.box.top;
    const expected = scroll ? 'dark' : 'light';
    state = resolveControlInk(Array(9).fill(localY < 50 ? [0, 0, 0] : [255, 255, 255]), state, { theme: 'light', now: i * 16 });
    assert.equal(state.ink, expected, 'no delay or position cache may hide a real scroll');
  }
  state = resolveControlInk(Array(9).fill([255, 255, 255]), state, { theme: 'light', now: 49 });
  assert.equal(state.ink, 'dark', 'new image pixels must still update without moving the page');
});

test('entrance, scale, reordering and unrelated animations use live sampling', async () => {
  const { createBreathingBackdropSampler } = await subject;
  for (const options of [{ phase: -20 }, { phase: -2, animationName: 'entrance' }, { phase: -2, transform: 'matrix(1.1, 0, 0, 1.1, 0, -2)' }]) {
    const h = breathingScene(options);
    const sample = createBreathingBackdropSampler([h.card], h.options)(50, 130);
    assert.deepEqual(sample.pointFor(h.image), [50, 130]);
  }
});
