// Theme material belongs entirely to CSS. Scroll only updates source geometry;
// it never selects ink, opacity, saturation or the light/dark theme.
import { createMobileRefraction } from './mobile-glass-refraction.mjs?v=20261106_MOBILE_NAV_PROD_1';

export const MOBILE_GLASS_PRESET = Object.freeze({ blur: 6, strength: 0.78, refraction: 1.1, dispersion: 0.40 });
export const MOBILE_GLASS_TARGETS = '.dock-cluster .gdock-glass, .prompt-spotlight-capsule .gdock-glass, .avatar-dropdown, .nav-dropdown-portal, .nav-dropdown, .nav-support-dropdown, .mobile-menu, .chat-widget-fab .message-preview, .glass-ring';
const intersects = (a, b, pad = 0) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;

// Conservative eligibility: a source-only render must never cover page text,
// cards, overlays or another glass pane. Everything else keeps native backdrop.
export function canRefract(rect, source, occluders) {
  return rect.width > 0 && rect.height > 0 && rect.left >= source.left && rect.right <= source.right &&
    rect.top >= source.top && rect.bottom <= source.bottom - 200 && !occluders.some(r => intersects(rect, r, 24));
}

export function createMobileGlassController({ win = window, doc = document, createRenderer = createMobileRefraction } = {}) {
  const panes = new Map();
  const reduced = win.matchMedia('(prefers-reduced-transparency: reduce)');
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
  let running = false;
  let source;
  let previousHook;
  let renderer;
  let renderCanvas;
  let sceneRect;
  let list = [];
  let dirty = true;
  let lastFrame = -Infinity;
  let hasSourceFrame = false;
  let failed = false;
  let observer;
  let resizeObserver;

  const removePane = el => {
    panes.get(el)?.canvas.remove();
    el.removeAttribute('data-mobile-glass-optics');
    panes.delete(el);
  };
  const clearPanes = () => { for (const el of panes.keys()) removePane(el); };
  // Keep valid canvases mounted between source frames. Replacing them on every
  // scroll or unrelated class animation exposes the native material for a frame.
  const invalidate = () => { dirty = true; };
  const releaseRenderer = () => {
    renderer?.destroy();
    renderer = null;
    renderCanvas = null;
  };
  const refresh = () => {
    dirty = false;
    sceneRect = source.getBoundingClientRect();
    const foreground = [...source.parentElement.children].filter(el => el !== source && !el.matches('[aria-hidden="true"]'));
    const occluders = foreground.filter(el => {
      const s = win.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0;
    }).map(el => el.getBoundingClientRect());
    list = [];
    for (const el of doc.querySelectorAll(MOBILE_GLASS_TARGETS)) {
      // Modal material belongs only to its hollow CSS rim, never a full canvas.
      if (el.matches('.glass-ring')) continue;
      if (el.parentElement?.closest(MOBILE_GLASS_TARGETS)) continue;
      const rect = el.getBoundingClientRect();
      const style = win.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || rect.bottom < 0 || rect.top >= win.innerHeight) continue;
      if (!canRefract(rect, sceneRect, occluders)) continue;
      // A modal or foreign page layer between the glass and hero requires native blur.
      const stack = doc.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (stack.some(node => !node.closest(MOBILE_GLASS_TARGETS) && node !== source.parentElement &&
        node !== doc.body && node !== doc.documentElement && !node.contains(source) && !source.parentElement.contains(node))) continue;
      list.push({ el, rect, x: rect.left - sceneRect.left, y: rect.top - sceneRect.top,
        // Match glasswork-preview's WebGL surface descriptor, including its
        // fixed optical tone. CSS brightness is for the native fallback only.
        w: rect.width, h: rect.height, radius: parseFloat(style.borderTopLeftRadius) || 22,
        rim: 24, edge: MOBILE_GLASS_PRESET.refraction, power: 2.6,
        blur: MOBILE_GLASS_PRESET.blur, saturate: 1.5, contrast: 1.04, brightness: 1.02,
        keep: 1, dispersion: MOBILE_GLASS_PRESET.dispersion,
        tint: `rgba(${style.getPropertyValue('--mg-tint')},${style.getPropertyValue('--mg-alpha')})` });
      if (list.length === 8) break;
    }
    const visible = new Set(list.map(s => s.el));
    for (const el of panes.keys()) if (!visible.has(el)) removePane(el);
  };
  // Geometry changes retire ineligible panes immediately, even if the hero is
  // offscreen and has stopped producing frames. Eligible panes stay mounted.
  const geometryChanged = () => {
    invalidate();
    if (running && source && !failed) refresh();
  };
  const preferenceChanged = () => {
    invalidate();
    if (reduced.matches || reducedMotion.matches) {
      clearPanes();
      releaseRenderer();
    }
  };
  const draw = (force = false) => {
    if (!running || failed || doc.hidden || reduced.matches || reducedMotion.matches) return;
    const now = win.performance.now();
    if (!force && !dirty && now - lastFrame < 1000 / 30) return;
    lastFrame = now;
    try {
      if (dirty) refresh();
      if (!list.length) return;
      if (!renderer) {
        renderCanvas = doc.createElement('canvas');
        renderer = createRenderer(renderCanvas, {
          source: () => ({ el: source }), surfaces: () => list,
          size: () => sceneRect, pixelRatio: Math.min(win.devicePixelRatio || 1, 1.5),
        });
        if (!renderer) throw new Error('Mobile source optics unavailable');
      }
      if (!renderer.draw(true)) throw new Error('Mobile source optics unavailable');
      const scaleX = renderCanvas.width / sceneRect.width;
      const scaleY = renderCanvas.height / sceneRect.height;
      for (const s of list) {
        let pane = panes.get(s.el);
        if (!pane) {
          const canvas = doc.createElement('canvas');
          canvas.className = 'mobile-glass-optics';
          canvas.setAttribute('aria-hidden', 'true');
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          pane = { canvas, ctx };
          panes.set(s.el, pane);
        }
        const { canvas, ctx } = pane;
        const width = Math.max(1, Math.round(s.w * scaleX));
        const height = Math.max(1, Math.round(s.h * scaleY));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(renderCanvas, s.x * scaleX, s.y * scaleY, s.w * scaleX, s.h * scaleY, 0, 0, width, height);
        // Tint is composited once, after refraction; these values are fixed by theme.
        ctx.fillStyle = s.tint;
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
        if (!canvas.isConnected) s.el.prepend(canvas);
        s.el.dataset.mobileGlassOptics = 'canvas';
      }
    } catch {
      failed = true;
      clearPanes();
      // Also release a partially initialized context on compilation failure.
      if (!renderer) renderCanvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
      releaseRenderer();
    }
  };
  const frame = () => {
    previousHook?.();
    hasSourceFrame = true;
    draw();
  };
  // Opening a pane must use the already-rendered source before the next paint,
  // including the first transparent frame of its fade. Do not call the source
  // hook again or wait for its throttled animation to produce another frame.
  const openingChanged = () => {
    invalidate();
    if (hasSourceFrame) draw(true);
  };
  const layoutStyle = value => (value || '').match(/(?:^|;)\s*(?:display|visibility|opacity|transform|translate|scale|position|inset|top|right|bottom|left|(?:min-|max-)?(?:width|height))\s*:[^;]*/g)?.join(';') || '';
  return {
    start() {
      if (running) return;
      running = true;
      source = doc.getElementById('heroLiquidCanvas');
      // Arbitrary DOM has no readable source texture. Keep the native material.
      if (!source) return;
      previousHook = source.__mobileGlassFrame;
      source.__mobileGlassFrame = frame;
      observer = new win.MutationObserver(records => {
        if (records.some(r => {
          if (r.type === 'attributes') {
            const el = r.target;
            if (r.attributeName === 'style' && layoutStyle(r.oldValue) === layoutStyle(el.getAttribute('style'))) return false;
            return el === doc.documentElement || el === doc.body || el.matches(MOBILE_GLASS_TARGETS) ||
              el.contains(source) || el.querySelector(MOBILE_GLASS_TARGETS) || el.parentElement === source.parentElement;
          }
          return [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && !n.matches?.('.mobile-glass-optics'));
        })) openingChanged();
      });
      observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-theme'] });
      observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      resizeObserver = new win.ResizeObserver(invalidate);
      resizeObserver.observe(source);
      for (const event of ['scroll', 'resize', 'orientationchange']) win.addEventListener(event, geometryChanged, { passive: true, capture: true });
      win.addEventListener('visibilitychange', invalidate);
      win.addEventListener('transitionend', invalidate, true);
      reduced.addEventListener('change', preferenceChanged);
      reducedMotion.addEventListener('change', preferenceChanged);
    },
    stop() {
      if (!running) return;
      running = false;
      if (source?.__mobileGlassFrame === frame) {
        if (previousHook) source.__mobileGlassFrame = previousHook;
        else delete source.__mobileGlassFrame;
      }
      observer?.disconnect();
      resizeObserver?.disconnect();
      for (const event of ['scroll', 'resize', 'orientationchange']) win.removeEventListener(event, geometryChanged, true);
      win.removeEventListener('visibilitychange', invalidate);
      win.removeEventListener('transitionend', invalidate, true);
      reduced.removeEventListener('change', preferenceChanged);
      reducedMotion.removeEventListener('change', preferenceChanged);
      releaseRenderer();
      clearPanes();
      list = [];
      dirty = true;
      failed = false;
      lastFrame = -Infinity;
      hasSourceFrame = false;
    },
    refresh: invalidate,
  };
}
