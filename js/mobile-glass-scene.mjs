import { createSceneLens } from './mobile-glass-lens.mjs?v=20261106_MOBILE_GLASS_3';

// A private, inert DOM mirror is painted by the browser, then refracted. No
// screenshots, DOM-to-canvas approximation, cross-origin pixel reads or copies
// of page scripts. IDs and styles stay inside the shadow tree.
const OMIT = 'script,noscript,iframe,object,embed,audio,source,link,meta,style,.mobile-glass-optics';
const CHROME = '.dock-cluster,.prompt-spotlight-capsule,.framer-nav,.avatar-dropdown,.nav-dropdown-portal,.nav-dropdown,.nav-support-dropdown,.mobile-menu,.chat-widget-fab';
const FORCE = (style, key, value) => style.setProperty(key, value, 'important');

export function collectSceneStyles(doc) {
  return [...doc.styleSheets].map(sheet => {
    try { return { css: [...sheet.cssRules].map(rule => rule.cssText).join('\n').replace(/:root\b/g, 'html') }; }
    catch { return sheet.href ? { href: sheet.href } : { css: '' }; }
  });
}

export function createDOMScene({ win, doc, el, preset, styles = collectSceneStyles(doc) }) {
  const host = doc.createElement('div');
  host.className = 'mobile-glass-optics';
  host.setAttribute('aria-hidden', 'true'); host.setAttribute('inert', '');
  const shadow = host.attachShadow({ mode: 'open' });
  for (const sheet of styles) {
    const copy = doc.createElement(sheet.href ? 'link' : 'style');
    if (sheet.href) { copy.rel = 'stylesheet'; copy.href = sheet.href; } else copy.textContent = sheet.css;
    shadow.append(copy);
  }
  const reset = doc.createElement('style');
  reset.textContent = `
    :host { contain: strict; overflow: hidden; isolation:isolate; }
    .mg-sampler,.mg-viewport,.mg-scroll,.mg-tint { position:absolute; box-sizing:border-box; pointer-events:none; }
    .mg-sampler { filter:var(--mg-scene-filter); }
    .mg-viewport { overflow:hidden; contain:strict; }
    .mg-scroll { left:0; top:0; width:100%; }
    .mg-tint { inset:0; background:rgba(var(--mg-tint),var(--mg-alpha)); }
    html[data-mg-root] { display:block!important; position:relative!important; margin:0!important; padding:0!important; overflow:visible!important; min-height:100%!important; width:100%!important; height:auto!important; transform:none!important; }
    html[data-mg-root] body { min-height:100vh!important; }
    html[data-mg-root] *,html[data-mg-root] *::before,html[data-mg-root] *::after { animation:none!important; transition:none!important; caret-color:transparent!important; }
    html[data-mg-root] :is(${CHROME}) { visibility:hidden!important; }
    html[data-mg-root] :is(${CHROME}) * { visibility:hidden!important; }
    html[data-mg-root] .mobile-glass-optics { display:none!important; }
  `;
  shadow.append(reset);
  const sampler = doc.createElement('div'); sampler.className = 'mg-sampler';
  const viewport = doc.createElement('div'); viewport.className = 'mg-viewport';
  const scroller = doc.createElement('div'); scroller.className = 'mg-scroll';
  const root = doc.documentElement.cloneNode(false); root.setAttribute('data-mg-root', '');
  const pairs = [], live = [], anchored = [], scrollables = [];
  const clone = source => {
    if (source.nodeType === 1 && source.matches(OMIT)) return null;
    const copy = source.cloneNode(false);
    if (source.nodeType === 1) {
      for (const attr of [...copy.attributes]) if (/^on/i.test(attr.name) || attr.name === 'autofocus' || attr.name === 'data-mobile-glass-optics') copy.removeAttribute(attr.name);
      pairs.push([source, copy]);
      // Do not reproduce the glass UI inside its own backdrop, including a
      // nested open menu. Preserve its box so normal page layout is identical.
      if (source.matches(CHROME)) return copy;
      if (source.tagName === 'CANVAS' || source.tagName === 'VIDEO') {
        const canvas = source.tagName === 'CANVAS' ? copy : doc.createElement('canvas');
        if (source.tagName === 'VIDEO') for (const attr of [...copy.attributes]) canvas.setAttribute(attr.name, attr.value);
        live.push({ source, copy: canvas, ctx: canvas.getContext('2d') });
        return canvas;
      }
      if (source.tagName === 'IMG' && source.currentSrc) { copy.src = source.currentSrc; copy.removeAttribute('srcset'); }
      if (source.tagName === 'INPUT') { copy.value = source.value; copy.checked = source.checked; }
      if (source.tagName === 'TEXTAREA') copy.value = source.value;
      // CSS position:fixed is relative to the private viewport's containing
      // block. Normalize it along with sticky elements after layout instead.
      const style = win.getComputedStyle(source);
      if (style.position === 'fixed' || style.position === 'sticky') anchored.push({ source, copy, x: 0, y: 0 });
      if (source.scrollTop || source.scrollLeft || /auto|scroll/.test(style.overflowY + style.overflowX)) scrollables.push([source, copy]);
    }
    for (const child of source.childNodes) { const c = clone(child); if (c) copy.append(c); }
    return copy;
  };
  root.append(clone(doc.body));
  scroller.append(root); viewport.append(scroller); sampler.append(viewport);
  shadow.append(sampler);
  const tint = doc.createElement('div'); tint.className = 'mg-tint'; shadow.append(tint);
  const lens = createSceneLens(doc, shadow, preset);
  let paneRect, padding, destroyed = false;
  // The host is mounted only after its scene is complete; no unfiltered frame.
  el.prepend(host);
  const sync = (rect = el.getBoundingClientRect()) => {
    if (destroyed) return;
    paneRect = rect;
    const radius = Math.min(parseFloat(win.getComputedStyle(el).borderTopLeftRadius) || 0, rect.width / 2, rect.height / 2);
    padding = lens.update(rect.width, rect.height, radius);
    sampler.style.cssText = `left:${-padding}px;top:${-padding}px;width:${rect.width + padding * 2}px;height:${rect.height + padding * 2}px;filter:url(#${lens.id}) saturate(1.35) brightness(var(--mg-brightness));`;
    viewport.style.cssText = `left:${padding - rect.left}px;top:${padding - rect.top}px;width:${win.innerWidth}px;height:${win.innerHeight}px;`;
    scroller.style.transform = `translate(${-win.scrollX}px,${-win.scrollY}px)`;
    for (const [source, copy] of scrollables) { copy.scrollTop = source.scrollTop; copy.scrollLeft = source.scrollLeft; }
    // Measure after translating the mirror. Fixed/sticky source geometry may
    // differ from normal-flow clones, especially in nested scrolling panels.
    for (const entry of anchored) {
      if (!entry.copy.isConnected) continue;
      const a = entry.source.getBoundingClientRect(), b = entry.copy.getBoundingClientRect();
      entry.x += a.left - b.left; entry.y += a.top - b.top;
      entry.copy.style.translate = `${entry.x}px ${entry.y}px`;
    }
    for (const entry of live) {
      const { source, copy, ctx } = entry;
      const r = source.getBoundingClientRect();
      if (!ctx || r.right < rect.left - padding || r.left > rect.right + padding || r.bottom < rect.top - padding || r.top > rect.bottom + padding) continue;
      const width = source.videoWidth || source.width, height = source.videoHeight || source.height;
      if (!width || !height || (source.readyState !== undefined && source.readyState < 2)) continue;
      if (copy.width !== width) copy.width = width; if (copy.height !== height) copy.height = height;
      try { ctx.clearRect(0, 0, width, height); ctx.drawImage(source, 0, 0); } catch { /* A media frame may not be decoded yet. */ }
    }
    return true;
  };
  sync();
  return {
    host, sync,
    updateAttributes(source) {
      const copy = source === doc.documentElement ? root : pairs.find(pair => pair[0] === source)?.[1];
      if (!copy) return;
      for (const name of ['class','style','hidden','open','aria-hidden','data-theme']) {
        if (source.hasAttribute(name)) copy.setAttribute(name, source.getAttribute(name)); else copy.removeAttribute(name);
      }
      root.setAttribute('data-mg-root', '');
    },
    destroy() { destroyed = true; lens.destroy(); host.remove(); pairs.length = live.length = anchored.length = scrollables.length = 0; },
  };
}
