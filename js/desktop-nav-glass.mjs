import { affectsGlass } from './glass-mutations.mjs?v=20261108_1';
import { startGlassForeground } from './glass-foreground.mjs?v=20261108_SCROLL_1';
import { ROUND_CORNER, cornerExponent, liquidGlass, warmLiquidGlass } from '../vendor/glasswork/lens.js?v=20261109_NAV_MOTION_1';
import { pauseNavGlassDuringMotion } from './nav-glass-motion.mjs?v=20261109_1';
import { adapt, luma, pickInk, tintFloor } from '../vendor/glasswork/adapt.js';

// Same lens and parameters as glasswork-preview.html. No DOM screenshots,
// cloned backgrounds or per-scroll displacement-map regeneration.
export const DESKTOP_NAV_GLASS = Object.freeze({
  rim: 24, edge: 1.3, power: 2.6, dispersion: .32,
  property: '--desktop-glass-lens',
});
// Keep the same refraction/dispersion while preserving translucent modal scrims.
export const MODAL_RIM_GLASS = Object.freeze({
  ...DESKTOP_NAV_GLASS, preserveSourceAlpha: true,
});
const CORE_SURFACES = '.framer-nav, .avatar-dropdown, .nav-dropdown-portal, .nav-dropdown, .nav-support-dropdown, .gdock, .chat-widget-fab .message-preview, .engagement-surface:not(.engagement-surface--modal), .glass-ring';
// Only adopt these additional components when their original computed style
// actually has glass. Solid cards, loading placeholders and full-page scrims
// keep their existing presentation and behavior.
const EXISTING_GLASS = [
  '.glass-card', '.glass-box', '.glass-input', '.calculator-card',
  '.floating-back-btn', '.home-btn', '.lang-toggle-btn', '.masonry-tag',
  '.verify-widget',
  '#guestbook-section .home-guestbook-empty', '.custom-dropdown-menu',
  '.modal-content:not(.profile-modal)', '.premium-modal', '.login-card', '.modal-link-card',
  '.contact-popup', '.message-card', '.message-item', '.user-dropdown',
  '.google-login-btn', '.security-input',
  '#guestbookModal .guestbook-composer-upload-inline',
  'body.guestbook-page .guestbook-launcher__button', '#notifBtn',
  '.shop-stock-badge', '.shop-success-toast[data-shop-toast-global="1"]',
  '.shop-cart-anchor', '.shop-cart-drawer', '.list-aside__panel', '.flash-badge-glass',
  '.tier-badge-glass', '.shop-main .filter-tab', '.shop-tier-rules-popover',
  '.chat-window', '.chat-messages', '.chat-support-panel', '.chat-support-card',
  '.chat-action-btn', '.chat-input', '.emoji-picker-popover',
  '.modal-content-col', '.announcement-modal .announcement-text',
  '.announcement-ack-btn', '.announcement-toast',
  '.zaoyoe-announcement-modal', '.zaoyoe-announcement-text', '.zaoyoe-announcement-ack-btn',
  '.card-tags span',
  '.modal-img-nav', '.modal-img-counter', '.modal-img-thumbs.is-visible',
  '.prompt-image-palette--image.is-visible.is-over-image', '.prompt-area.docked',
  '.comment-sort-dropdown', '.floating', '.close-modal-btn',
  '.modal-inner.comment-mode .comment-sort-btn',
  '.ai-image-dock-popover', '.ai-image-fab', '.ai-image-fab-glass',
  '.ai-image-shell-close', '.ai-image-video-progress',
  '.ai-image-result-resolution', '.ai-image-result-sequence',
  '.ai-image-result-original-status', '.ai-image-result-continue',
  '.ai-image-result-action', '.ai-image-inline-stopped-visual i',
  '.ai-image-full-preview__icon', '.ai-image-full-preview__pending',
].join(', ');
const CANDIDATES = `${CORE_SURFACES}, ${EXISTING_GLASS}`;
const SURFACES = `${CORE_SURFACES}, [data-desktop-glass-surface]`;
const MOBILE = '(hover: none) and (pointer: coarse), (max-width: 768px) and (pointer: coarse)';

export function startDesktopNavGlass({ doc = document, win = window, lens = liquidGlass } = {}) {
  const mobile = win.matchMedia(MOBILE);
  const opaque = win.matchMedia('(prefers-reduced-transparency: reduce), (forced-colors: active)');
  const surfaces = new Map();
  const colorCache = new Map();
  let stopped = false;
  let active = false;
  let frame = 0;
  let themeSample;
  let colorContext;
  let frameStyleCache = null;
  let scrollTimer = 0;
  let warmIdleHandle = 0;
  let warmTimerHandle = 0;
  const guestbookPage = doc.body.matches('.guestbook-page');
  const verifyPage = doc.body.matches('.verify-page');

  function isSolidCard(el) {
    return (guestbookPage && el.matches('.message-item')) ||
      (verifyPage && el.matches('.verify-widget'));
  }

  function clearWarmHandles() {
    if (warmIdleHandle) {
      win.cancelIdleCallback?.(warmIdleHandle);
      warmIdleHandle = 0;
    }
    if (warmTimerHandle) {
      win.clearTimeout?.(warmTimerHandle);
      warmTimerHandle = 0;
    }
  }

  function scheduleGlassRingWarmup() {
    if (lens !== liquidGlass || opaque.matches) return;
    clearWarmHandles();
    const runWarmup = () => {
      warmIdleHandle = 0;
      warmTimerHandle = 0;
      if (!active || stopped || opaque.matches) return;
      const corner = typeof CSS !== 'undefined' && CSS.supports?.('corner-shape', 'superellipse(1.2)')
        ? cornerExponent('superellipse(1.2)')
        : ROUND_CORNER;
      void warmLiquidGlass({ radius: 36, rim: DESKTOP_NAV_GLASS.rim, corner, power: DESKTOP_NAV_GLASS.power });
      void warmLiquidGlass({ radius: 32, rim: DESKTOP_NAV_GLASS.rim, corner, power: DESKTOP_NAV_GLASS.power });
      void warmLiquidGlass({ radius: 28, rim: DESKTOP_NAV_GLASS.rim, corner, power: DESKTOP_NAV_GLASS.power });
      void warmLiquidGlass({ radius: 26, rim: DESKTOP_NAV_GLASS.rim, corner, power: DESKTOP_NAV_GLASS.power });
      void warmLiquidGlass({ radius: 24, rim: DESKTOP_NAV_GLASS.rim, corner, power: DESKTOP_NAV_GLASS.power });
    };
    if (typeof win.requestIdleCallback === 'function') {
      warmIdleHandle = win.requestIdleCallback(runWarmup, { timeout: 1200 });
    } else if (typeof win.setTimeout === 'function') {
      warmTimerHandle = win.setTimeout(runWarmup, 240);
    }
  }

  function rgba(color) {
    if (colorCache.has(color)) return colorCache.get(color);
    if (!colorContext) {
      const canvas = doc.createElement('canvas');
      canvas.width = canvas.height = 1;
      colorContext = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!colorContext) return [0, 0, 0, 0];
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillStyle = color;
    colorContext.fillRect(0, 0, 1, 1);
    const parsed = [...colorContext.getImageData(0, 0, 1, 1).data];
    if (colorCache.size >= 512) colorCache.clear();
    colorCache.set(color, parsed);
    return parsed;
  }

  function readTheme() {
    const light = doc.documentElement.dataset.theme === 'light';
    // Read the painted page background. Some light pages retain a black
    // --bg-black token even though body/html paint a light background.
    const fallback = light ? [248, 250, 252] : [0, 0, 0];
    const root = rgba(win.getComputedStyle(doc.documentElement).backgroundColor);
    const body = rgba(win.getComputedStyle(doc.body).backgroundColor);
    const rgb = fallback.map((channel, i) => {
      const base = root[i] * root[3] / 255 + channel * (1 - root[3] / 255);
      return body[i] * body[3] / 255 + base * (1 - body[3] / 255);
    });
    themeSample = { color: rgb, luminance: luma(rgb), texture: 0 };
  }

  function backdrop(el) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return themeSample;
    // Read existing backdrop colors, never render/copy the DOM. In particular,
    // the homepage hero remains a dark backdrop even in the site's light theme.
    // Nine points and the playground's hysteresis avoid one-pixel tone flips.
    const colors = [];
    const cache = frameStyleCache || new Map();
    for (const fx of [.2, .5, .8]) for (const fy of [.25, .5, .75]) {
      const x = rect.left + rect.width * fx;
      const y = rect.top + rect.height * fy;
      if (x < 0 || y < 0 || x >= win.innerWidth || y >= win.innerHeight) continue;
      const color = [0, 0, 0];
      let remaining = 1;
      for (const node of doc.elementsFromPoint(x, y)) {
        if (node === doc.body || node === doc.documentElement) break;
        if (node.closest(SURFACES)) continue;
        if (!cache.has(node)) cache.set(node, rgba(win.getComputedStyle(node).backgroundColor));
        const pixel = cache.get(node);
        const alpha = pixel[3] / 255;
        for (let i = 0; i < 3; i++) color[i] += pixel[i] * alpha * remaining;
        remaining *= 1 - alpha;
        if (remaining < .01) break;
      }
      colors.push(color.map((v, i) => v + themeSample.color[i] * remaining));
    }
    if (!colors.length) return themeSample;
    const luminances = colors.map(luma);
    return {
      color: [0, 1, 2].map(i => colors.reduce((sum, color) => sum + color[i], 0) / colors.length),
      luminance: luminances.reduce((sum, value) => sum + value, 0) / luminances.length,
      texture: Math.max(...luminances) - Math.min(...luminances),
    };
  }

  function applyTone(el) {
    const sample = backdrop(el);
    const prior = el.dataset.desktopGlassKind;
    // Dialog content is opaque; its empty rim needs a consistent theme palette,
    // rather than per-surface ink hysteresis. Keep adapting to the real backdrop.
    const ink = el.matches('.glass-ring')
      ? doc.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
      : pickInk(sample.luminance, prior ? prior === 'dark' ? 'light' : 'dark' : undefined);
    const adjusted = adapt(sample, ink);
    const kind = ink === 'light' ? 'dark' : 'light';
    if (el.dataset.desktopGlassKind !== kind) el.dataset.desktopGlassKind = kind;
    const tone = {
      '--dng-density': adjusted.density.toFixed(3),
      '--dng-keep': adjusted.saturate.toFixed(3),
      '--dng-floor': tintFloor(sample.luminance, sample.texture, ink, ink === 'light' ? .12 : .96).toFixed(3),
    };
    const record = surfaces.get(el);
    for (const [name, value] of Object.entries(tone)) {
      if (record.tone?.[name] !== value) el.style.setProperty(name, value);
    }
    record.tone = tone;
  }

  function hasGlass(style) {
    return [style.backdropFilter, style.webkitBackdropFilter].some(value => value && value !== 'none');
  }

  function clearLegacySheen(el) {
    if (el.matches(CORE_SURFACES)) return; // Core sheen is removed by CSS.
    const rect = el.getBoundingClientRect();
    for (const side of ['before', 'after']) {
      const style = win.getComputedStyle(el, `::${side}`);
      if (style.content === 'none' || style.content === 'normal') continue;
      const fullSize = style.position === 'absolute' &&
        Math.abs(parseFloat(style.width) - rect.width) < 4 &&
        Math.abs(parseFloat(style.height) - rect.height) < 4;
      if (hasGlass(style) || (fullSize && (style.backgroundImage !== 'none' || style.maskImage !== 'none'))) {
        el.setAttribute(`data-desktop-glass-clear-${side}`, '');
      }
    }
  }

  function bind(el) {
    if (surfaces.has(el)) return;
    // Guestbook and Gemini Pro cards stay solid and never allocate a lens.
    if (isSolidCard(el)) return;
    if (el.matches?.('#profileModal, .profile-modal') || el.closest?.('.profile-modal')) return;
    if (el.closest?.('#profileModal') && !el.matches?.('.glass-ring')) return;
    if (el.closest?.('.glass-ring__surface') && !el.matches?.('.glass-ring')) return;
    if (el.closest?.('.auth-sheet') && !el.matches?.('.glass-ring')) return;
    if (!el.matches(CORE_SURFACES) && !hasGlass(win.getComputedStyle(el))) return;
    clearLegacySheen(el);
    el.dataset.desktopGlassSurface = '';
    surfaces.set(el, { instance: null, revealFrame: 0 });
  }

  function markGlassRingSurface(el) {
    if (!el) return;
    if (el.classList?.add) el.classList.add('glass-ring__surface');
    else if (typeof el.className === 'string' && !el.className.includes('glass-ring__surface')) {
      el.className = `${el.className} glass-ring__surface`.trim();
    }
  }

  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches?.('.profile-modal') || node.closest?.('.profile-modal')) return;
    if (node.dataset?.glassRingSurface === '1' || node.hasAttribute?.('data-glass-ring-surface')) {
      markGlassRingSurface(node);
    }
    node.querySelectorAll?.('[data-glass-ring-surface="1"]').forEach(markGlassRingSurface);
    if (node.matches(CANDIDATES)) bind(node);
    node.querySelectorAll(CANDIDATES).forEach(bind);
  }

  function unbind(el, record) {
    win.cancelAnimationFrame(record.revealFrame);
    record.motion?.destroy();
    record.instance?.destroy();
    for (const attr of ['surface', 'kind', 'nested', 'hidden', 'pending', 'ready', 'clear-before', 'clear-after']) {
      el.removeAttribute(`data-desktop-glass-${attr}`);
    }
    ['--dng-density', '--dng-keep', '--dng-floor', '--desktop-glass-lens'].forEach(key => el.style.removeProperty(key));
    surfaces.delete(el);
  }

  function syncSurfaces(roots, sampleTone = true) {
    // A glass card inside another glass card inherits its material. Detached
    // popovers (absolute/fixed) remain independent surfaces. In particular the
    // dropdown within the nav portal must never add a second lens.
    frameStyleCache = new Map();
    try {
      for (const [el, record] of surfaces) {
        if (!el.isConnected || !el.matches(CANDIDATES) || isSolidCard(el)) {
          unbind(el, record);
          continue;
        }
        if (roots && !roots.some(root => root === el || root.contains?.(el))) continue;
        // Retain the current tone and avoid geometry/style sampling while the
        // navbar is morphing. The motion controller resamples after resuming.
        if (record.motion?.paused && !opaque.matches) continue;
        const style = win.getComputedStyle(el);
        const parent = el.parentElement?.closest('[data-desktop-glass-surface]');
        const nested = Boolean(parent) && (
          Boolean(el.closest('.nav-dropdown-portal') && !el.matches('.nav-dropdown-portal')) ||
          !['absolute', 'fixed'].includes(style.position)
        );
        el.toggleAttribute('data-desktop-glass-nested', nested);
        const visible = typeof el.checkVisibility === 'function'
          ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
          : style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0 && Boolean(el.getClientRects().length);
        el.toggleAttribute('data-desktop-glass-hidden', !visible);
        if (nested || opaque.matches) {
          win.cancelAnimationFrame(record.revealFrame);
          record.motion?.destroy();
          record.motion = null;
          record.instance?.destroy();
          record.instance = null;
          el.removeAttribute('data-desktop-glass-pending');
          el.setAttribute('data-desktop-glass-ready', '');
          continue;
        }
        // visibility/opacity-hidden menus still have their final layout. Prepare
        // those rims before the user opens them, and retain them while closed.
        // display:none surfaces wait until they acquire a measurable layout.
        if (!record.instance || (sampleTone && visible)) applyTone(el);
        if (!record.instance && el.offsetWidth >= 32 && el.offsetHeight >= 32) {
          // The navbar and Google One card can already be painted before lens
          // setup. Keep them visible so enhancement never hides loaded content.
          // .glass-ring also retains its opaque dialog surface and initial rim;
          // transparent popovers still wait for their complete material.
          el.removeAttribute('data-desktop-glass-ready');
          if (!el.matches('.framer-nav, .glass-ring, .verify-widget')) el.setAttribute('data-desktop-glass-pending', '');
          const instance = lens(el, el.matches('.glass-ring') ? MODAL_RIM_GLASS : DESKTOP_NAV_GLASS);
          record.instance = instance;
          if (el.matches('.framer-nav') && instance.supported && instance.pause && instance.resume) {
            record.motion = pauseNavGlassDuringMotion(el, instance, win, scheduleTone);
          }
          const reveal = () => {
            if (!active || surfaces.get(el) !== record || record.instance !== instance) return;
            record.revealFrame = 0;
            el.removeAttribute('data-desktop-glass-pending');
            el.setAttribute('data-desktop-glass-ready', '');
          };
          if (!instance.supported) reveal();
          else Promise.resolve(instance.ready).then(() => {
            if (!active || surfaces.get(el) !== record || record.instance !== instance) return;
            // Commit the decoded filter before revealing the whole surface.
            record.revealFrame = win.requestAnimationFrame(() => {
              record.revealFrame = win.requestAnimationFrame(reveal);
            });
          });
        }
      }
    } finally {
      frameStyleCache = null;
    }
  }

  function scheduleTone() {
    if (!active || frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      // Theme backgrounds may finish a color transition after data-theme flips.
      // Resample the painted page at each settled update, not just the mutation.
      readTheme();
      syncSurfaces();
    });
  }

  function onTransitionEnd(event) {
    if (guestbookPage && event.target.closest?.('.message-item')) return;
    if (event.type === 'transitionstart' && event.target.closest?.('.framer-nav')) return;
    // Opening transitions and ancestor opacity changes can make a previously
    // hidden surface visible. A closed surface retains its prepared filter.
    if (event.target.matches?.(CANDIDATES) || event.target.querySelector?.('[data-desktop-glass-surface]')) scheduleTone();
  }

  function onScroll() {
    win.clearTimeout(scrollTimer);
    // Steady-state refraction is native; morphs suspend it independently.
    // Only sample tone after scroll settling.
    scrollTimer = win.setTimeout(scheduleTone, 120);
  }

  // Some popovers toggle visibility through inline styles. Ignore our own
  // material properties and the Dock's per-frame transforms to avoid a loop.
  function visibilityStyle(value = '') {
    return (value.match(/(?:^|;)\s*(?:display|visibility|opacity|content-visibility)\s*:[^;]*/gi) || []).join(';');
  }

  const tree = new win.MutationObserver(records => {
    if (!active) return;
    const roots = new Set();
    let changed = false;
    for (const record of records) {
      if (!affectsGlass(record)) continue;
      if (record.type === 'attributes') {
        if (record.attributeName === 'style' &&
            visibilityStyle(record.oldValue || '') === visibilityStyle(record.target.getAttribute('style') || '')) continue;
        roots.add(record.target);
      } else {
        record.addedNodes.forEach(node => { if (node.nodeType === 1) roots.add(node); });
      }
      changed = true;
    }
    if (changed) {
      // Prepare only the changed subtree before paint, preserving popover
      // readiness. Global backdrop sampling is coalesced into one later frame.
      for (const node of roots) if (node.isConnected) scan(node);
      syncSurfaces([...roots], false);
      scheduleTone();
    }
  });
  const theme = new win.MutationObserver(() => {
    if (!active) return;
    scheduleTone();
  });
  // Scrolling changes the navbar's geometry/class, not its tone. Vendor's
  // ResizeObserver fits the maps; refresh also handles radius-only changes.
  const nav = new win.MutationObserver(records => {
    if (!active) return;
    const targets = new Set(records.filter(affectsGlass).map(record => record.target));
    for (const target of targets) surfaces.get(target)?.instance?.refresh();
  });

  function syncMedia() {
    if (stopped) return;
    active = !mobile.matches;
    doc.documentElement.dataset.desktopGlassState = active ? 'active' : 'bypass';
    tree.disconnect();
    theme.disconnect();
    nav.disconnect();
    win.cancelAnimationFrame(frame);
    win.clearTimeout(scrollTimer);
    clearWarmHandles();
    frame = 0;
    if (!active) {
      for (const [el, instance] of surfaces) unbind(el, instance);
      return;
    }
    readTheme();
    scan(doc.body);
    syncSurfaces();
    scheduleGlassRingWarmup();
    tree.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'hidden', 'open', 'aria-hidden', 'aria-expanded', 'style'] });
    theme.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    doc.querySelectorAll('.framer-nav').forEach(el => nav.observe(el, { attributes: true, attributeOldValue: true, attributeFilter: ['class'] }));
  }
  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', scheduleTone);
  const motionEvents = ['transitionstart', 'transitionend', 'animationstart', 'animationend'];
  motionEvents.forEach(type => doc.addEventListener(type, onTransitionEnd));
  mobile.addEventListener('change', syncMedia);
  opaque.addEventListener('change', syncMedia);
  syncMedia();
  return {
    destroy() {
      if (stopped) return;
      stopped = true;
      active = false;
      delete doc.documentElement.dataset.desktopGlassState;
      win.removeEventListener('scroll', onScroll);
      win.removeEventListener('resize', scheduleTone);
      motionEvents.forEach(type => doc.removeEventListener(type, onTransitionEnd));
      win.clearTimeout(scrollTimer);
      clearWarmHandles();
      mobile.removeEventListener('change', syncMedia);
      opaque.removeEventListener('change', syncMedia);
      tree.disconnect(); theme.disconnect(); nav.disconnect();
      win.cancelAnimationFrame(frame);
      for (const [el, instance] of surfaces) unbind(el, instance);
    },
  };
}

if (typeof document !== 'undefined') {
  startDesktopNavGlass();
  startGlassForeground();
}
