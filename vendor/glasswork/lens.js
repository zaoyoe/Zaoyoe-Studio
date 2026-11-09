import { ROUND_CORNER, rimDisplacement, lensLayout } from './lens-map.mjs?v=20261108_1';
import { generateTilePixels } from './lens-tiles.mjs?v=20261108_1';

/*
 * The rim lens of Lumno's liquid glass, as a standalone module.
 *
 *   import { liquidGlass } from './lens.js';
 *   const lens = liquidGlass(element, { rim: 40, edge: 1.1, power: 2.6, dispersion: 0.15 });
 *   lens.update({ rim: 32 });   // change any option later
 *   lens.destroy();
 *
 * The wallpaper behind a surface's rim bends inward, the way the edge of a
 * thick glass slab refracts, and splits slightly into its colors there. An
 * SVG displacement map drives the bend through `backdrop-filter: url(#…)`,
 * which only Chromium draws; everywhere else nothing happens and the
 * CSS-only glass stays. The element must put `var(--glass-lens,)` last in
 * its backdrop-filter:
 *
 *   backdrop-filter: blur(2px) saturate(180%) var(--glass-lens,);
 *
 * Ported from lumno-extension (src/domain/liquid-glass-lens.ts and
 * src/newtab/dom/liquid-glass.ts). The map is a nine-slice lens: only the
 * rim bends, and a rim depends on the corner's radius and shape and the
 * rim's width alone, so a lens is four corner tiles and four one-pixel edge
 * strips (stretched along the sides) over a flat middle. The tiles are built
 * and decoded once per rim and shared by every surface; a surface that
 * resizes only moves its tiles.
 */

export const LENS_DEFAULTS = {
  // The widest the rim gets, in CSS pixels. Small surfaces narrow it to a
  // third and a half of their short side, so they keep a flat middle.
  rim: 40,
  // How far inward the very edge samples the scene, in rim widths.
  edge: 1.1,
  // How fast the bend falls off across the rim: (1 - d / rim) ^ power.
  power: 2.6,
  // Red bends this much further and blue this much less; 0 for one pass.
  dispersion: 0.15,
  preserveSourceAlpha: false,
  // The corner's radius in pixels and its superellipse exponent (2 is a
  // circle, 2^k is CSS superellipse(k)); read from the element when null.
  radius: null,
  corner: null,
  // Turns the lens off without destroying it.
  enabled: true,
  // The custom property the filter goes in.
  property: '--glass-lens',
};

// A circular corner's exponent (CSS corner-shape: round).
export { ROUND_CORNER, rimDisplacement } from './lens-map.mjs?v=20261108_1';

// Too small a surface has no flat middle to look through.
const LENS_MIN_PX = 32;

// While the rim keeps changing (a slider being dragged, a window being
// resized), the lens already there bends to the new width and the new
// tiles are built once it has been still this long.
const SETTLE_MS = 140;

const SVG = 'http://www.w3.org/2000/svg';
// Read-only foreground probes share the map that is actually installed. During
// resize settling this can differ from the newest requested geometry.
const activeLenses = new WeakMap();

export function lensSamplePoint(el, x, y, rect = el.getBoundingClientRect()) {
  const active = activeLenses.get(el);
  if (!active || !rect.width || !rect.height) return [x, y];
  const { width, height, lens } = active;
  const sx = rect.width / width, sy = rect.height / height;
  const [dx, dy] = rimDisplacement((x - rect.left) / sx, (y - rect.top) / sy, width, height, lens.tiles.geometry);
  // The green pass is the central chromatic pass. Match the map's 8-bit
  // encoding and SVG scale, including the neutral 128/255 offset.
  const offset = d => (Math.round(128 + d * 127) / 255 - .5) * lens.sampleScale;
  return [x + offset(dx) * sx, y + offset(dy) * sy];
}

// Only Chromium draws url() in backdrop-filter. Firefox parses it and draws
// nothing; Safari (and every browser on iOS) draws none of it either.
export function isLensSupported() {
  if (typeof CSS === 'undefined' || !CSS.supports?.('backdrop-filter', 'url(#a)')) return false;
  const ua = navigator.userAgent;
  return /Chrome\//.test(ua) && !/Firefox\//.test(ua);
}

// The superellipse exponent of a computed CSS corner-shape. round is a
// circle and squircle is superellipse(2); anything else reads as round.
export function cornerExponent(shape) {
  const value = String(shape || '').trim();
  if (value === 'squircle') return 4;
  const match = /^superellipse\(\s*([^)\s]+)\s*\)$/.exec(value);
  const k = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(k) && k >= 0 ? 2 ** k : ROUND_CORNER;
}

// ---------- The map ----------

// Tiles for one rim, as decoded PNG data URLs: a filter whose images are
// still decoding draws without its blur, so no surface points at one early.
const tileCache = new Map();
const resolvedTileCache = new Map();
const TILE_CACHE_MAX = 48;

function lensTiles(radius, bezel, corner, power) {
  const key = `${radius}:${bezel}:${corner.toFixed(3)}:${power.toFixed(3)}`;
  let entry = tileCache.get(key);
  if (entry) {
    // Most recently used last.
    tileCache.delete(key);
    tileCache.set(key, entry);
    return entry;
  }
  entry = generateTilePixels([radius, bezel, corner, power]).then(({ size, tiles }) => {
    // Encoded with toBlob, which compresses off the main thread, and kept as
    // object URLs for as long as the page lives (a rim's tiles are small).
    return Promise.all(tiles.map((tile) => {
      const canvas = document.createElement('canvas');
      canvas.width = tile.width;
      canvas.height = tile.height;
      const context = canvas.getContext('2d');
      const image = context.createImageData(tile.width, tile.height);
      image.data.set(tile.data);
      context.putImageData(image, 0, 0);
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/png')).then(async (blob) => {
        const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png');
        const decoded = new Image();
        decoded.src = url;
        await decoded.decode();
        return url;
      });
    })).then((urls) => {
      const resolved = { size, urls, geometry: { radius, bezel, corner, power } };
      resolvedTileCache.set(key, resolved);
      while (resolvedTileCache.size > TILE_CACHE_MAX) {
        resolvedTileCache.delete(resolvedTileCache.keys().next().value);
      }
      return resolved;
    });
  }).catch(error => {
    tileCache.delete(key);
    resolvedTileCache.delete(key);
    throw error;
  });
  tileCache.set(key, entry);
  while (tileCache.size > TILE_CACHE_MAX) {
    const oldestKey = tileCache.keys().next().value;
    tileCache.delete(oldestKey);
    resolvedTileCache.delete(oldestKey);
  }
  return entry;
}

export function warmLiquidGlass({
  radius = 28,
  rim = LENS_DEFAULTS.rim,
  corner = ROUND_CORNER,
  power = LENS_DEFAULTS.power,
} = {}) {
  if (!isLensSupported()) return Promise.resolve(false);
  const safeRadius = Math.max(0, Math.round(radius));
  const bezel = Math.round(Math.max(4, rim));
  return lensTiles(safeRadius, bezel, corner, power).then(() => true, () => false);
}

// ---------- The filter ----------

function setAttribute(el, name, value) {
  const next = String(value);
  if (el.getAttribute(name) !== next) el.setAttribute(name, next);
}

function node(tag, attrs, parent) {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  parent?.append(el);
  return el;
}

let filterCount = 0;

// The lens tiles over a flat flood make the map; the backdrop is displaced
// by it once, or once per color channel by its own share of the bend, the
// three added back together (screen on single channels is a sum). Each
// filter gets an <svg> of its own: adding one to an <svg> that holds others
// can make Chrome reload all their images, and a backdrop naming a filter
// whose images are reloading drops its blur.
function buildFilter(width, height, tiles, split, preserveSourceAlpha) {
  const id = `liquid-glass-lens-${++filterCount}`;
  const host = node('svg', {
    'aria-hidden': 'true', 'data-glass-lens-map': '', width: 0, height: 0,
    style: 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none',
  });
  const filter = node('filter', {
    id, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB', x: 0, y: 0, width, height,
  }, host);
  node('feFlood', { 'flood-color': 'rgb(128,128,128)', result: 'flat' }, filter);
  const rects = lensLayout(width, height, tiles.size);
  const pieces = rects.map(([x, y, w, h], index) => node('feImage', {
    href: tiles.urls[index], preserveAspectRatio: 'none', x, y, width: w, height: h, result: `t${index}`,
  }, filter));
  const merge = node('feMerge', { result: 'map' }, filter);
  node('feMergeNode', { in: 'flat' }, merge);
  rects.forEach((_, index) => node('feMergeNode', { in: `t${index}` }, merge));
  const passes = [];
  const pass = () => {
    passes.push({
      el: node('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', xChannelSelector: 'R', yChannelSelector: 'G', scale: 0 }, filter),
    });
  };
  if (split) {
    ['r', 'g', 'b'].forEach((name, channel) => {
      pass();
      // Modal backdrops can be translucent. Blend opaque RGB branches, then
      // restore the source alpha once so screen does not thicken the scrim.
      const alphaCell = preserveSourceAlpha ? 19 : 18;
      const keep = Array.from({ length: 20 }, (_, cell) => Number(cell === channel * 6 || cell === alphaCell)).join(' ');
      node('feColorMatrix', { type: 'matrix', values: keep, result: name }, filter);
    });
    node('feBlend', { in: 'r', in2: 'g', mode: 'screen' }, filter);
    node('feBlend', { in2: 'b', mode: 'screen' }, filter);
    if (preserveSourceAlpha) node('feComposite', { operator: 'in', in2: 'SourceGraphic' }, filter);
  } else {
    pass();
  }
  document.body.append(host);
  return { id, host, filter, pieces, passes, tiles };
}

function placeFilter(lens, width, height) {
  setAttribute(lens.filter, 'width', width);
  setAttribute(lens.filter, 'height', height);
  lensLayout(width, height, lens.tiles.size).forEach(([x, y, w, h], index) => {
    const piece = lens.pieces[index];
    setAttribute(piece, 'x', x);
    setAttribute(piece, 'y', y);
    setAttribute(piece, 'width', w);
    setAttribute(piece, 'height', h);
  });
}

// ---------- A surface ----------

/*
 * Gives `el` a rim lens in its --glass-lens property and keeps it fitted as
 * the element resizes. Returns { supported, bezel, update(options),
 * refresh(), pause(), resume(), paused, ready, destroy() }. ready resolves after decoded tiles and the
 * complete filter have been attached (false for the native fallback).
 */
export function liquidGlass(el, options = {}) {
  let opts = { ...LENS_DEFAULTS, ...options };
  const supported = isLensSupported();
  let current = null; // { key, lens, width, height }
  let token = 0;
  let frame = 0;
  let lastChange = 0;
  let settle = 0;
  let observer = null;
  let destroyed = false;
  let paused = false;
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const api = {
    ready,
    supported,
    bezel: 0,
    update(next = {}) {
      opts = { ...opts, ...next };
      schedule();
    },
    refresh: () => schedule(),
    get paused() { return paused; },
    pause,
    resume,
    destroy,
  };
  if (!supported) {
    // Nothing to draw: every call is a no-op.
    api.update = () => {};
    api.refresh = () => {};
    api.pause = api.resume = () => {};
    api.destroy = () => {};
    resolveReady(false);
    return api;
  }

  function clear() {
    token += 1;
    activeLenses.delete(el);
    el.style.removeProperty(opts.property);
    current?.lens.host.remove();
    current = null;
  }

  function setScale(lens, bezel) {
    const scale = 2 * opts.edge * bezel;
    lens.sampleScale = Number(scale.toFixed(1));
    const split = lens.passes.length > 1;
    lens.passes.forEach((p, channel) => {
      const share = split ? 1 + (1 - channel) * opts.dispersion : 1;
      setAttribute(p.el, 'scale', (scale * share).toFixed(1));
    });
  }

  async function fit() {
    frame = 0;
    if (destroyed || paused) return;
    const width = Math.round(el.offsetWidth);
    const height = Math.round(el.offsetHeight);
    if (!opts.enabled) {
      clear();
      resolveReady(false);
      return;
    }
    // display:none is a temporary layout state, not the end of a surface.
    // Keep its decoded filter for the next opening instead of rebuilding it.
    if (width < LENS_MIN_PX || height < LENS_MIN_PX) return;
    const style = getComputedStyle(el);
    const cssRadius = Number.parseFloat(style.borderTopLeftRadius) || 0;
    const radius = Math.round(Math.min(opts.radius ?? cssRadius, width / 2, height / 2));
    const corner = opts.corner ?? cornerExponent(style.getPropertyValue('corner-top-left-shape'));
    const bezel = Math.round(Math.max(4, Math.min(opts.rim, Math.min(width, height) / 3.5)));
    const split = opts.dispersion > 0;
    const key = `${radius}:${bezel}:${corner.toFixed(3)}:${opts.power.toFixed(3)}:${split}:${Boolean(opts.preserveSourceAlpha)}`;
    api.bezel = bezel;
    if (current?.key === key) {
      if (current.width !== width || current.height !== height) {
        placeFilter(current.lens, width, height);
        current.width = width;
        current.height = height;
      }
      setScale(current.lens, bezel);
      // A paused lens stays decoded, but is only reattached after fitting the
      // final geometry. Identical geometry can reuse the existing SVG graph.
      if (activeLenses.get(el) !== current) {
        el.style.setProperty(opts.property, `url(#${current.lens.id})`);
        activeLenses.set(el, current);
      }
      return;
    }
    const now = performance.now();
    const settling = current && now - lastChange < SETTLE_MS;
    lastChange = now;
    if (settling) {
      if (current.width !== width || current.height !== height) {
        placeFilter(current.lens, width, height);
        current.width = width;
        current.height = height;
      }
      setScale(current.lens, bezel);
      clearTimeout(settle);
      settle = setTimeout(schedule, SETTLE_MS);
      return;
    }
    // New tiles can take a few frames; until then the lens in use covers
    // the new size, so no part of the surface goes without it.
    if (current && (current.width !== width || current.height !== height)) {
      placeFilter(current.lens, width, height);
      current.width = width;
      current.height = height;
      setScale(current.lens, bezel);
    }
    const mine = ++token;
    let tiles;
    try {
      tiles = await lensTiles(radius, bezel, corner, opts.power);
    } catch {
      if (mine === token) resolveReady(false);
      return;
    }
    if (mine !== token || destroyed || paused) return;
    let lens;
    const previous = current;
    try {
      lens = buildFilter(width, height, tiles, split, opts.preserveSourceAlpha);
      setScale(lens, bezel);
      el.style.setProperty(opts.property, `url(#${lens.id})`);
    } catch {
      lens?.host.remove();
      resolveReady(false);
      return;
    }
    current = { key, lens, width, height };
    activeLenses.set(el, current);
    resolveReady(true);
    // Let the new filter draw before the old one goes.
    if (previous) requestAnimationFrame(() => requestAnimationFrame(() => previous.lens.host.remove()));
  }

  function tryAttachWarmFilter() {
    if (!opts.enabled) return false;
    const width = Math.round(el.offsetWidth);
    const height = Math.round(el.offsetHeight);
    if (width < LENS_MIN_PX || height < LENS_MIN_PX) return false;
    const style = getComputedStyle(el);
    const cssRadius = Number.parseFloat(style.borderTopLeftRadius) || 0;
    const radius = Math.round(Math.min(opts.radius ?? cssRadius, width / 2, height / 2));
    const corner = opts.corner ?? cornerExponent(style.getPropertyValue('corner-top-left-shape'));
    const bezel = Math.round(Math.max(4, Math.min(opts.rim, Math.min(width, height) / 3.5)));
    const tileKey = `${radius}:${bezel}:${corner.toFixed(3)}:${opts.power.toFixed(3)}`;
    const tiles = resolvedTileCache.get(tileKey);
    if (!tiles) return false;
    const split = opts.dispersion > 0;
    const key = `${tileKey}:${split}:${Boolean(opts.preserveSourceAlpha)}`;
    api.bezel = bezel;
    let lens;
    try {
      lens = buildFilter(width, height, tiles, split, opts.preserveSourceAlpha);
      setScale(lens, bezel);
      el.style.setProperty(opts.property, `url(#${lens.id})`);
    } catch {
      lens?.host.remove();
      return false;
    }
    current = { key, lens, width, height };
    activeLenses.set(el, current);
    resolveReady(true);
    return true;
  }

  function schedule() {
    if (!destroyed && !paused && !frame) frame = requestAnimationFrame(fit);
  }

  function pause() {
    if (destroyed || paused) return;
    paused = true;
    token += 1; // An in-flight decode must not reattach during the morph.
    observer.disconnect();
    cancelAnimationFrame(frame);
    clearTimeout(settle);
    frame = settle = 0;
    activeLenses.delete(el);
    el.style.removeProperty(opts.property);
  }

  function resume() {
    if (destroyed || !paused) return;
    paused = false;
    // Fit once at the destination, without the intermediate-resize debounce.
    lastChange = -Infinity;
    observer.observe(el);
    schedule();
  }

  observer = new ResizeObserver(schedule);
  observer.observe(el);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    resolveReady(false);
    observer.disconnect();
    cancelAnimationFrame(frame);
    clearTimeout(settle);
    clear();
  }

  if (!tryAttachWarmFilter()) {
    schedule();
  }
  return api;
}
