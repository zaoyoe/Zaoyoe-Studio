import { affectsGlass } from './glass-mutations.mjs?v=20261108_1';
// Foreground only: no changes to glass filters, tint, geometry or scene renderers.
import { lensSamplePoint } from '../vendor/glasswork/lens.js?v=20261108_SCROLL_1';
const MOBILE = '(hover: none) and (pointer: coarse), (max-width: 768px) and (pointer: coarse)';
const CHROME = '.dock-cluster,.gdock,.framer-nav,.avatar-dropdown,.nav-dropdown-portal,.nav-dropdown,.nav-support-dropdown,.mobile-menu,.mobile-glass-optics,.chat-widget-fab .message-preview,.engagement-surface';
const CONTROLS = [
  '.gdock-item:not(.gdock-item--ai-orb)', '.framer-nav .nav-menu > a',
  '.framer-nav .login-trigger-btn', '.framer-nav .user-avatar-btn', '.framer-nav .nav-hamburger',
  ':is(.nav-dropdown-portal,.nav-dropdown,.nav-support-dropdown) a',
  '.avatar-dropdown .dropdown-action', '.avatar-dropdown .dropdown-header button',
  '.mobile-menu :is(.mobile-menu-link,.mobile-menu-trigger,.mobile-submenu-link)',
  '.prompt-spotlight-input-wrap', '.prompt-spotlight-search-icon', '.prompt-spotlight-esc',
  '.chat-widget-fab .message-preview :is(.preview-sender,.preview-text)',
  '.engagement-surface :is(.engagement-surface__body > strong,.engagement-surface__body > p,.engagement-surface__close)',
].join(',');
const SEMANTIC = '[data-auth-action="logout"],.logout,.danger,[aria-disabled="true"],:disabled';
const INK = { light: '#f8fafc', dark: '#17212b' };
const LIGHT_THEME_INK = { ...INK, light: '#ffffff' };
const INK_SWITCH_MARGIN = 1.5;
const INK_SETTLE_MS = 64;
const SAMPLE_INTERVAL_MS = { desktop: 48, mobile: 64 };

export function foregroundColor(ink, theme = 'dark') {
  return (theme === 'light' ? LIGHT_THEME_INK : INK)[ink];
}

export function relativeLuminance(rgb) {
  const linear = rgb.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
const contrast = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
const INK_LUMA = Object.fromEntries(['light', 'dark'].map(theme => [theme, Object.fromEntries(['light', 'dark'].map(ink => [ink, relativeLuminance(foregroundColor(ink, theme).match(/\w\w/g).map(v => parseInt(v, 16)))]))]));

// Compare individual sample contrasts, not an average background color. In the
// light theme the median represents the majority behind each word: the lower
// quartile can give BOTH inks a poor score on a white/dark edge, locking in the
// old ink forever. Keep the existing gray crossover hysteresis in both themes.
function inkScore(colors, kind, theme = 'dark') {
  const values = colors.map(rgb => contrast(relativeLuminance(rgb), INK_LUMA[theme][kind])).sort((a, b) => a - b);
  return values[Math.floor((values.length - 1) * (theme === 'light' ? .5 : .25))];
}
export function chooseInk(colors, previous, fallback = 'dark', theme = 'dark') {
  if (!colors.length) return previous || fallback;
  const light = inkScore(colors, 'light', theme), dark = inkScore(colors, 'dark', theme);
  const next = light > dark ? 'light' : 'dark';
  if (previous && next !== previous && Math.max(light, dark) < inkScore(colors, previous, theme) * INK_SWITCH_MARGIN) return previous;
  return next;
}

// Each control has its own decision. Strong crossings commit immediately;
// marginal changes need to persist, so a fine edge cannot toggle the ink.
// Incomplete/tainted image samples retain the last trusted ink, or the theme
// fallback on first paint. Never synthesize a light/dark patch behind a glyph.
export function resolveControlInk(samples, state = {}, { theme = 'dark', now = 0, complete = samples.length >= 5 } = {}) {
  const previous = state.theme === theme ? state.ink : null;
  const next = chooseInk(complete ? samples : [], previous, theme === 'light' ? 'dark' : 'light', theme);
  if (!previous || next === previous) return { theme, ink: next, pending: null };
  const decisive = inkScore(samples, previous, theme) < 3 && inkScore(samples, next, theme) >= 4.5;
  const since = state.pending === next ? state.since : now;
  if (decisive || now - since >= INK_SETTLE_MS) return { theme, ink: next, pending: null };
  return { theme, ink: previous, pending: next, since };
}

// Decorative breathing is a 0..-3px translation. Sample its resting scene,
// then map that point into the live card for hit testing and media lookup.
// This leaves animation, scrolling, layout changes and image loading intact.
export function createBreathingBackdropSampler(cards, { styleOf, rectOf, hitTest }) {
  const anchors = [];
  for (const node of cards) {
    const style = styleOf(node);
    if (!/^(?:breathe|breatheMobileMasonry)$/.test(style.animationName)) continue;
    const match = /^matrix\(([^)]+)\)$/.exec(style.transform);
    const matrix = style.transform === 'none' ? [1, 0, 0, 1, 0, 0] : match?.[1].split(',').map(Number);
    // Don't suppress a hover scale, entrance, filter/reorder or larger motion.
    if (!matrix || matrix.length !== 6 || matrix.some(v => !Number.isFinite(v)) ||
      matrix.slice(0, 5).some((v, i) => Math.abs(v - [1, 0, 0, 1, 0][i]) > .00001) ||
      matrix[5] < -3.01 || matrix[5] > .01) continue;
    const rect = rectOf(node), dy = matrix[5];
    if (style.visibility !== 'visible' || style.display === 'none' || +style.opacity === 0 || !rect.width || !rect.height) continue;
    anchors.push({ node, dy, left: rect.left, right: rect.right, top: rect.top - dy, bottom: rect.bottom - dy });
  }
  return (x, y) => {
    const original = hitTest(x, y);
    const target = anchors.find(a => x >= a.left && x < a.right && y >= a.top && y < a.bottom);
    const shifted = target ? hitTest(x, y + target.dy).filter(node => target.node.contains(node)) : [];
    const nodes = [];
    let inserted = false;
    for (const node of original) {
      if (target && (target.node.contains(node) || node.contains(target.node))) {
        if (!inserted) { nodes.push(...shifted); inserted = true; }
        if (target.node.contains(node)) continue;
      }
      // A card's live top edge can enter a resting gap during the upward bob.
      if (anchors.some(a => a !== target && a.node.contains(node))) continue;
      nodes.push(node);
    }
    return { nodes, pointFor: node => target?.node.contains(node) ? [x, y + target.dy] : [x, y] };
  };
}

// Object-position / background-position, including edge offsets (right 12px).
function positionOffset(value, space) {
  const tokens = value.trim().split(/\s+/);
  let axes;
  if (tokens.length > 2) {
    axes = { x: ['50%'], y: ['50%'] };
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i], axis = /left|right/.test(token) ? 'x' : /top|bottom/.test(token) ? 'y' : null;
      if (axis) { axes[axis] = [token]; if (/^-?[\d.]+(?:px|%)$/.test(tokens[i + 1] || '')) axes[axis].push(tokens[++i]); }
    }
  } else {
    let [x = '50%', y = '50%'] = tokens;
    if (/top|bottom/.test(x) || /left|right/.test(y)) [x, y] = [y, x];
    axes = { x: [x], y: [y] };
  }
  return ['x', 'y'].map((axis, i) => {
    const [edge, offset] = axes[axis];
    const distance = v => v.endsWith('%') ? space[i] * parseFloat(v) / 100 : parseFloat(v) || 0;
    if (offset) return /right|bottom/.test(edge) ? space[i] - distance(offset) : distance(offset);
    if (/right|bottom/.test(edge)) return space[i];
    if (edge === 'center') return space[i] / 2;
    if (/left|top/.test(edge)) return 0;
    return distance(edge);
  });
}

export function imagePoint({ x, y, width, height, naturalWidth, naturalHeight, fit = 'fill', position = '50% 50%' }) {
  if (!naturalWidth || !naturalHeight || width <= 0 || height <= 0) return null;
  let w = width, h = height;
  if (fit !== 'fill') {
    let scale = fit === 'cover' ? Math.max(width / naturalWidth, height / naturalHeight) : Math.min(width / naturalWidth, height / naturalHeight);
    if (fit === 'none') scale = 1;
    if (fit === 'scale-down') scale = Math.min(1, scale);
    w = naturalWidth * scale; h = naturalHeight * scale;
  }
  const [left, top] = positionOffset(position, [width - w, height - h]);
  if (x < left || y < top || x >= left + w || y >= top + h) return null;
  return [(x - left) / w, (y - top) / h];
}

// Read simple CSS linear-gradient paint, including translucent gallery overlays.
// Unsupported paint stays unknown; it must never masquerade as a white page.
export function createLinearGradientSampler(value, parseColor) {
  const match = /^linear-gradient\((.*)\)$/.exec(value);
  if (!match) return null;
  const parts = []; let depth = 0, start = 0;
  for (let i = 0; i < match[1].length; i++) {
    const char = match[1][i];
    if (char === '(') depth++;
    if (char === ')' && --depth < 0) return null;
    if (char === ',' && depth === 0) { parts.push(match[1].slice(start, i).trim()); start = i + 1; }
  }
  if (depth) return null;
  parts.push(match[1].slice(start).trim());
  let angle = Math.PI;
  const directions = { 'to top': 0, 'to right': Math.PI / 2, 'to bottom': Math.PI, 'to left': Math.PI * 1.5 };
  if (parts[0] in directions) angle = directions[parts.shift()];
  else if (/^-?[\d.]+deg$/.test(parts[0])) angle = parseFloat(parts.shift()) * Math.PI / 180;
  else if (/^to |(?:deg|rad|turn|grad)$/.test(parts[0])) return null;
  const stops = parts.map(part => {
    const stop = /^(.*?)\s+(-?[\d.]+)(%|px)$/.exec(part);
    return { color: parseColor(stop ? stop[1] : part), offset: stop ? Number(stop[2]) : null, unit: stop?.[3] };
  });
  if (stops.length < 2 || stops.some(stop => stop.color?.length !== 4)) return null;
  const dx = Math.sin(angle), dy = -Math.cos(angle);
  return ({ x, y, width, height }) => {
    const length = Math.abs(width * dx) + Math.abs(height * dy);
    if (!length) return null;
    const offsets = stops.map(stop => stop.offset === null ? null : stop.unit === '%' ? stop.offset / 100 : stop.offset / length);
    offsets[0] ??= 0; offsets[offsets.length - 1] ??= 1;
    let previous = 0;
    for (let i = 1; i < offsets.length; i++) if (offsets[i] !== null) {
      offsets[i] = Math.max(offsets[previous], offsets[i]);
      for (let j = previous + 1; j < i; j++) offsets[j] = offsets[previous] + (offsets[i] - offsets[previous]) * (j - previous) / (i - previous);
      previous = i;
    }
    const t = .5 + ((x - width / 2) * dx + (y - height / 2) * dy) / length;
    if (t <= offsets[0]) return stops[0].color;
    for (let i = 1; i < stops.length; i++) if (t <= offsets[i]) {
      const a = stops[i - 1].color, b = stops[i].color;
      const weight = offsets[i] === offsets[i - 1] ? 1 : (t - offsets[i - 1]) / (offsets[i] - offsets[i - 1]);
      const alpha = a[3] * (1 - weight) + b[3] * weight;
      return [...a.slice(0, 3).map((channel, j) => alpha ? (channel * a[3] * (1 - weight) + b[j] * b[3] * weight) / alpha : 0), alpha];
    }
    return stops.at(-1).color;
  };
}

// Only unreadable public gallery photos use this small same-origin grid. Two
// requests at a time, one result per photo, and no automatic failure retry loop.
export function createGallerySampleReader({ win, baseURI, onReady = () => {}, maxEntries = 32 }) {
  const entries = new Map(), queue = [];
  let active = 0, stopped = false;
  function pump() {
    while (!stopped && active < 2 && queue.length) {
      const [url, entry] = queue.shift();
      if (entries.get(url) !== entry) continue;
      active++;
      const controller = new win.AbortController(); entry.controller = controller;
      const timeout = win.setTimeout(() => controller.abort(), 9000);
      Promise.resolve().then(() => win.fetch(`/api/runtime/glass-image-sample?url=${encodeURIComponent(url)}`, {
        signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer'
      })).then(async response => {
        if (!response.ok) return;
        const grid = await response.json();
        if (![grid.width, grid.height, grid.naturalWidth, grid.naturalHeight].every(Number.isInteger)
          || grid.width < 1 || grid.height < 1 || grid.width > 64 || grid.height > 64
          || grid.naturalWidth < 1 || grid.naturalHeight < 1
          || grid.naturalWidth * grid.naturalHeight > 24_000_000
          || typeof grid.pixels !== 'string' || grid.pixels.length > 21848) return;
        const raw = win.atob(grid.pixels);
        if (raw.length !== grid.width * grid.height * 4) return;
        if (!stopped && entries.get(url) === entry) Object.assign(entry, {
          width: grid.width, height: grid.height, naturalWidth: grid.naturalWidth,
          naturalHeight: grid.naturalHeight, data: Uint8ClampedArray.from(raw, char => char.charCodeAt(0))
        });
      }).catch(() => { /* Keep trusted ink on unavailable media. */ }).finally(() => {
        win.clearTimeout(timeout); entry.controller = null; active--;
        if (!stopped && entries.get(url) === entry && entry.data) onReady();
        pump();
      });
    }
  }
  return {
    read(value) {
      if (stopped) return null;
      let url;
      try {
        const parsed = new URL(value, baseURI);
        if (parsed.protocol !== 'https:' || parsed.hostname !== 'cdn.fatherkey.com'
          || parsed.port || parsed.username || parsed.password || parsed.hash
          || !/^\/prompts\/.*\.(jpe?g|png|webp|avif)$/i.test(parsed.pathname)
          || [...parsed.searchParams.keys()].some(key => key !== 'v') || parsed.href.length > 2048) return null;
        url = parsed.href;
      } catch { return null; }
      if (entries.has(url)) {
        const entry = entries.get(url); entries.delete(url); entries.set(url, entry); return entry;
      }
      const entry = {}; entries.set(url, entry); queue.push([url, entry]);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        entries.get(oldest).controller?.abort(); entries.delete(oldest);
        const index = queue.findIndex(([key]) => key === oldest); if (index >= 0) queue.splice(index, 1);
      }
      pump(); return entry;
    },
    destroy() { stopped = true; queue.length = 0; for (const entry of entries.values()) entry.controller?.abort(); entries.clear(); }
  };
}

export function startGlassForeground({ doc = document, win = window } = {}) {
  const mobile = win.matchMedia(MOBILE);
  const forced = win.matchMedia('(forced-colors: active)');
  const controls = new Map(), images = new Map(), colors = new Map(), gradients = new Map();
  const gallery = createGallerySampleReader({ win, baseURI: doc.baseURI, onReady: () => schedule() });
  const colorCanvas = doc.createElement('canvas'); colorCanvas.width = colorCanvas.height = 1;
  const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
  let stopped = false, timer = 0, scheduledAt = Infinity, frame = 0, lastUpdate = -Infinity, needsScan = true, decodeBudget = 0;
  let styles, rects, decorations, sampleBackdrop, deferredImages = false;
  const styleOf = node => { if (!styles.has(node)) styles.set(node, win.getComputedStyle(node)); return styles.get(node); };
  const rectOf = node => { if (!rects.has(node)) rects.set(node, node.getBoundingClientRect()); return rects.get(node); };
  function rgba(value) {
    if (!colors.has(value)) {
      if (colors.size >= 512) colors.clear();
      colorContext.clearRect(0, 0, 1, 1); colorContext.fillStyle = 'transparent'; colorContext.fillStyle = value;
      colorContext.fillRect(0, 0, 1, 1); colors.set(value, [...colorContext.getImageData(0, 0, 1, 1).data]);
    }
    return colors.get(value);
  }
  function pixels(source, entry) {
    const w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
    if (!w || !h) return false;
    const scale = Math.min(1, 128 / Math.max(w, h));
    const canvas = doc.createElement('canvas'); canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    entry.data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    entry.width = canvas.width; entry.height = canvas.height; entry.naturalWidth = w; entry.naturalHeight = h;
    return true;
  }
  function imageData(url, source, theme) {
    if (images.has(url)) { const entry = images.get(url); images.delete(url); images.set(url, entry); return entry; }
    // Reuse readable originals. Light-theme controls over the public CDN use a
    // cached colour grid; dark-theme sampling retains its original behaviour.
    let local = false;
    try { const parsed = new URL(url, doc.baseURI); local = parsed.origin === win.location.origin || parsed.protocol === 'data:'; } catch { /* Invalid source stays unknown. */ }
    if (!local && !source?.crossOrigin) return theme === 'light' ? gallery.read(url) : null;
    if (decodeBudget <= 0) { deferredImages = true; return null; }
    decodeBudget--;
    const entry = {}; images.set(url, entry);
    while (images.size > 32) { const oldest = images.keys().next().value; const evicted = images.get(oldest); if (evicted.loader) evicted.loader.onload = evicted.loader.onerror = null; images.delete(oldest); }
    if (source) {
      try { pixels(source, entry); } catch { /* Unreadable originals retain the stable foreground fallback. */ }
      return entry;
    }
    const loader = new win.Image(); entry.loader = loader; loader.crossOrigin = 'anonymous'; loader.decoding = 'async';
    loader.onload = () => {
      if (stopped) return;
      try { pixels(loader, entry); } catch { /* Cross-origin images retain the stable foreground fallback. */ }
      entry.loader = null; schedule();
    };
    loader.onerror = () => { entry.loader = null; schedule(); };
    loader.src = url;
    return entry;
  }
  function imagePixel(node, x, y, style, theme) {
    const rect = rectOf(node);
    let url, source, fit, position = style.objectPosition, box = rect;
    if (node.tagName === 'IMG') {
      if (!node.complete || !node.naturalWidth) return { pixel: null, unknown: false };
      url = node.currentSrc || node.src; source = node; fit = style.objectFit;
      const sx = rect.width / (node.offsetWidth || rect.width), sy = rect.height / (node.offsetHeight || rect.height);
      const inset = side => (parseFloat(style[`border${side}Width`]) || 0) + (parseFloat(style[`padding${side}`]) || 0);
      const l = inset('Left') * sx, r = inset('Right') * sx, t = inset('Top') * sy, b = inset('Bottom') * sy;
      box = { left: rect.left + l, top: rect.top + t, width: rect.width - l - r, height: rect.height - t - b };
    } else if (style.backgroundImage !== 'none') {
      if (theme === 'light' && style.backgroundImage.startsWith('linear-gradient(')) {
        if (!gradients.has(style.backgroundImage)) gradients.set(style.backgroundImage, createLinearGradientSampler(style.backgroundImage, value => win.CSS.supports('color', value) ? rgba(value) : null));
        const sampler = gradients.get(style.backgroundImage);
        return { pixel: sampler?.({ x: x - rect.left, y: y - rect.top, width: rect.width, height: rect.height }) || null, unknown: !sampler };
      }
      // Multiple layers / gradients cannot be reconstructed reliably without
      // rendering the scene. Use the stable foreground fallback instead of guessing.
      const match = /^url\(["']?(.*?)["']?\)$/.exec(style.backgroundImage);
      if (!match || !['cover', 'contain', 'auto', 'auto auto'].includes(style.backgroundSize) || style.backgroundAttachment === 'fixed') return { pixel: null, unknown: true };
      url = match[1]; fit = style.backgroundSize === 'auto' || style.backgroundSize === 'auto auto' ? 'none' : style.backgroundSize; position = style.backgroundPosition;
      // A repeating/shifted background needs tiling; don't sample the wrong tile.
      if (style.backgroundRepeat !== 'no-repeat') return { pixel: null, unknown: true };
    } else return { pixel: null, unknown: node.tagName === 'VIDEO' || node.tagName === 'CANVAS' };
    const entry = imageData(url, source, theme);
    if (!entry?.data) return { pixel: null, unknown: true };
    const point = imagePoint({ x: x - box.left, y: y - box.top, width: box.width, height: box.height, naturalWidth: entry.naturalWidth, naturalHeight: entry.naturalHeight, fit, position });
    if (!point) return { pixel: null, unknown: false };
    const index = (Math.min(entry.height - 1, Math.floor(point[1] * entry.height)) * entry.width + Math.min(entry.width - 1, Math.floor(point[0] * entry.width))) * 4;
    return { pixel: entry.data.subarray(index, index + 4), unknown: false };
  }
  function backdropAt(x, y, base, theme) {
    const result = [0, 0, 0]; let remaining = 1, unknown = false;
    const over = (pixel, opacity = 1) => {
      const alpha = pixel[3] / 255 * opacity;
      for (let i = 0; i < 3; i++) result[i] += pixel[i] * alpha * remaining;
      remaining *= 1 - alpha;
    };
    const { nodes: hitNodes, pointFor } = sampleBackdrop(x, y);
    const stack = [];
    for (const node of hitNodes) {
      if (node.closest(CHROME)) continue;
      // Hit testing omits pointer-events:none artwork. Include direct painted
      // children in front of their hit-tested container, without changing DOM/CSS.
      if (theme === 'light') {
        if (!decorations.has(node)) decorations.set(node, [...node.children].filter(child => {
          if (child.hidden || /^(?:SCRIPT|STYLE|LINK|TEMPLATE)$/.test(child.tagName)) return false;
          const style = styleOf(child);
          return style.pointerEvents === 'none' && !child.closest(CHROME) && (child.tagName === 'IMG' || style.backgroundImage !== 'none' || rgba(style.backgroundColor)[3] > 0);
        }).sort((a, b) => (parseInt(styleOf(b).zIndex) || 0) - (parseInt(styleOf(a).zIndex) || 0) || (a.compareDocumentPosition(b) & win.Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1)));
        for (const child of decorations.get(node)) {
          const r = rectOf(child), [px, py] = pointFor(child);
          if (!hitNodes.includes(child) && px >= r.left && px < r.right && py >= r.top && py < r.bottom) stack.push(child);
        }
      }
      stack.push(node);
    }
    for (const node of stack) {
      const style = styleOf(node);
      if (style.visibility !== 'visible' || style.display === 'none' || +style.opacity === 0) continue;
      const [px, py] = pointFor(node);
      const media = imagePixel(node, px, py, style, theme);
      if (media.pixel) over(media.pixel, +style.opacity);
      unknown ||= media.unknown;
      over(rgba(style.backgroundColor), +style.opacity);
      if (unknown || remaining < .01) break;
    }
    return unknown ? null : result.map((v, i) => v + base[i] * remaining);
  }
  function footprints(node, r, theme) {
    const glyph = node.querySelector('.gdock-glyph');
    if (glyph) return [rectOf(glyph)];
    const parts = [];
    const walker = doc.createTreeWalker(node, win.NodeFilter.SHOW_TEXT);
    for (let text; (text = walker.nextNode());) {
      if (!text.textContent.trim() || text.parentElement.closest('.gdock-label,svg,[hidden]')) continue;
      const range = doc.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) if (box.width && box.height) parts.push(box);
    }
    for (const icon of node.querySelectorAll('.dropdown-action-icon,.dropdown-svg-icon,.default-auth-icon,svg,.nav-hamburger-line')) {
      const box = rectOf(icon);
      if (box.width && box.height && styleOf(icon).visibility === 'visible') parts.push(box);
    }
    if (!parts.length) {
      // Photos and colored artwork retain their original appearance.
      if (node.querySelector('img')) return [];
      return [r];
    }
    // Sample the painted label and icon separately. A union rectangle can put
    // every probe in the empty gap between an icon, a word and its chevron.
    // Keep one foreground decision for the whole control, never per character.
    if (theme === 'light') return parts;
    // Preserve the dark theme's existing sampling geometry.
    const left = Math.min(...parts.map(p => p.left)), top = Math.min(...parts.map(p => p.top));
    const right = Math.max(...parts.map(p => p.right)), bottom = Math.max(...parts.map(p => p.bottom));
    return [{ left, top, right, bottom, width: right - left, height: bottom - top }];
  }
  function clear(node) {
    for (const key of ['ink', 'platform', 'sample']) node.removeAttribute(`data-glass-${key}`);
    node.style.removeProperty('--glass-control-ink');
    controls.delete(node);
  }
  function update() {
    frame = 0; lastUpdate = win.performance.now();
    if (stopped || doc.hidden || !colorContext) return;
    if (forced.matches) { for (const node of controls.keys()) clear(node); needsScan = true; return; }
    if (gradients.size >= 128) gradients.clear();
    styles = new Map(); rects = new Map(); decorations = new Map(); decodeBudget = 2; deferredImages = false;
    sampleBackdrop = createBreathingBackdropSampler(doc.querySelectorAll('.prompt-card.breathing,.shop-card-breathe-frame--breathing'), {
      styleOf, rectOf, hitTest: (x, y) => doc.elementsFromPoint(x, y),
    });
    if (needsScan) {
      for (const node of doc.querySelectorAll(CONTROLS)) if (!node.matches(SEMANTIC) && !controls.has(node)) controls.set(node, {});
      needsScan = false;
    }
    const theme = doc.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const base = theme === 'light' ? [248, 250, 252] : [12, 15, 20];
    const writes = [];
    let settleAt = Infinity;
    for (const [node, record] of controls) {
      if (!node.isConnected || !node.matches(CONTROLS) || node.matches(SEMANTIC)) { clear(node); continue; }
      const r = rectOf(node), style = styleOf(node);
      if (node.checkVisibility && !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      if (!r.width || !r.height || r.right <= 0 || r.left >= win.innerWidth || r.bottom <= 0 || r.top >= win.innerHeight || style.visibility !== 'visible' || +style.opacity === 0 || node.closest('[inert],[hidden]')) continue;
      const areas = footprints(node, r, theme);
      if (!areas.length) continue;
      const paints = [];
      for (let ancestor = node; ancestor && ancestor !== doc.body; ancestor = ancestor.parentElement) {
        if (ancestor === node || ancestor.matches(CHROME)) {
          const paint = mobile.matches && ancestor.matches('.gdock') ? ancestor.querySelector(':scope > .gdock-glass') || ancestor : ancestor;
          paints.unshift(rgba(styleOf(paint).backgroundColor));
        }
      }
      const surface = node.closest('[data-desktop-glass-surface]:not([data-desktop-glass-nested])');
      const surfaceRect = surface ? rectOf(surface) : null;
      const samples = [];
      let points = 0;
      for (const area of areas) for (const fx of [.18, .5, .82]) for (const fy of [.25, .5, .75]) {
        const x = area.left + area.width * fx, y = area.top + area.height * fy;
        if (x < 0 || y < 0 || x >= win.innerWidth || y >= win.innerHeight) continue;
        points++;
        const [sx, sy] = surface ? lensSamplePoint(surface, x, y, surfaceRect) : [x, y];
        const rgb = backdropAt(sx, sy, base, theme);
        if (rgb) samples.push(paints.reduce((color, tint) => color.map((c, i) => c * (1 - tint[3] / 255) + tint[i] * tint[3] / 255), rgb));
      }
      const complete = samples.length >= 5 && samples.length === points;
      record.state = resolveControlInk(samples, record.state, { theme, now: lastUpdate, complete });
      if (record.state.pending) settleAt = Math.min(settleAt, record.state.since + INK_SETTLE_MS);
      writes.push({ node, ink: record.state.ink, complete });
    }
    // Finish all geometry and paint reads before changing solid foregrounds.
    // The glass filters, tint and scene renderers remain owned by their engines.
    for (const { node, ink, complete } of writes) {
      if (node.dataset.glassInk !== ink) node.dataset.glassInk = ink;
      const color = foregroundColor(ink, theme);
      // A theme change can keep the same ink kind but require a different white.
      if (node.style.getPropertyValue('--glass-control-ink') !== color) node.style.setProperty('--glass-control-ink', color);
      const platform = mobile.matches ? 'mobile' : 'desktop', sample = complete ? 'pixels' : 'fallback';
      if (node.dataset.glassPlatform !== platform) node.dataset.glassPlatform = platform;
      if (node.dataset.glassSample !== sample) node.dataset.glassSample = sample;
    }
    if (deferredImages) schedule();
    if (Number.isFinite(settleAt)) requestUpdateAt(settleAt);
  }
  function requestUpdateAt(deadline) {
    if (stopped || frame || doc.hidden || (timer && deadline >= scheduledAt)) return;
    win.clearTimeout(timer);
    scheduledAt = deadline;
    const enqueue = () => { timer = 0; scheduledAt = Infinity; frame = win.requestAnimationFrame(update); };
    const delay = Math.max(0, deadline - win.performance.now());
    if (delay === 0) enqueue();
    else timer = win.setTimeout(enqueue, delay);
  }
  function schedule() {
    // Event-driven only: idle pages do not poll. New events may bring a pending
    // confirmation forward, but cannot postpone its original deadline.
    requestUpdateAt(lastUpdate + SAMPLE_INTERVAL_MS[mobile.matches ? 'mobile' : 'desktop']);
  }
  const observer = new win.MutationObserver(records => {
    for (const r of records) {
      if (!affectsGlass(r)) continue;
      if (r.type === 'attributes') {
        if (r.attributeName === 'style') {
          const visibility = value => (value || '').match(/(?:^|;)\s*(?:display|visibility|opacity|background(?:-image|-color)?)\s*:[^;]*/gi)?.join(';') || '';
          if (visibility(r.oldValue) === visibility(r.target.getAttribute('style'))) continue;
        }
      } else {
        needsScan = true;
      }
      schedule();
    }
  });
  const rescan = () => { needsScan = true; schedule(); };
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'src', 'srcset', 'aria-expanded', 'data-theme', 'data-desktop-glass-kind', 'data-desktop-glass-pending'] });
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const events = ['scroll', 'load', 'transitionend', 'animationend', 'visibilitychange'];
  events.forEach(event => doc.addEventListener(event, schedule, { passive: true, capture: true }));
  win.addEventListener('resize', schedule); mobile.addEventListener('change', rescan); forced.addEventListener('change', rescan);
  doc.fonts?.ready.then(() => { if (!stopped) schedule(); });
  schedule();
  return { refresh: rescan, destroy() {
    stopped = true; observer.disconnect(); win.clearTimeout(timer); win.cancelAnimationFrame(frame);
    events.forEach(event => doc.removeEventListener(event, schedule, true));
    win.removeEventListener('resize', schedule); mobile.removeEventListener('change', rescan); forced.removeEventListener('change', rescan);
    for (const node of controls.keys()) clear(node);
    for (const entry of images.values()) if (entry.loader) entry.loader.onload = entry.loader.onerror = null;
    images.clear(); gallery.destroy();
  } };
}
