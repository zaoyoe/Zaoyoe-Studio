// The same rounded-box normal and rim falloff as glasswork/refract.js.
// Ordinary SVG filters operate on a real DOM scene on WebKit as well as Chromium;
// unlike backdrop-filter:url(), this does not require a readable canvas texture.
const SVG = 'http://www.w3.org/2000/svg';
let serial = 0;
const box = (x, y, hx, hy, radius) => {
  const qx = Math.abs(x) - hx + radius, qy = Math.abs(y) - hy + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
};
export function rimVector(x, y, width, height, radius, rim, power = 1.5) {
  const px = x - width / 2, py = y - height / 2;
  const d = box(px, py, width / 2, height / 2, radius);
  const depth = Math.max(0, Math.min(1, -d / rim));
  const dx = box(px + .5, py, width / 2, height / 2, radius) - box(px - .5, py, width / 2, height / 2, radius);
  const dy = box(px, py + .5, width / 2, height / 2, radius) - box(px, py - .5, width / 2, height / 2, radius);
  const length = Math.max(Math.hypot(dx, dy), .00001);
  const amount = (1 - depth) ** power;
  return [-dx / length * amount, -dy / length * amount];
}
export function createSceneLens(doc, shadow, preset) {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  const filter = doc.createElementNS(SVG, 'filter');
  const id = `mobile-scene-lens-${++serial}`;
  filter.id = id;
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const node = (name, attrs) => {
    const el = doc.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    filter.append(el); return el;
  };
  const blur = node('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: preset.blur, result: 'soft' });
  const map = node('feImage', { result: 'lens', preserveAspectRatio: 'none' });
  const passes = [];
  for (let channel = 0; channel < 3; channel++) {
    passes.push(node('feDisplacementMap', { in: 'soft', in2: 'lens', xChannelSelector: 'R', yChannelSelector: 'G', result: `shift${channel}` }));
    const matrix = Array.from({ length: 20 }, (_, cell) => Number(cell === channel * 6 || cell === 18)).join(' ');
    node('feColorMatrix', { in: `shift${channel}`, type: 'matrix', values: matrix, result: `channel${channel}` });
  }
  node('feBlend', { in: 'channel0', in2: 'channel1', mode: 'screen', result: 'rg' });
  node('feBlend', { in: 'rg', in2: 'channel2', mode: 'screen' });
  svg.append(filter); shadow.append(svg);
  let key;
  return {
    id,
    update(width, height, radius) {
      const next = `${width}:${height}:${radius}`;
      const rim = Math.min(18, height * .28);
      const padding = Math.ceil(preset.blur * 3 + preset.refraction * rim * (1 + preset.dispersion) + 2);
      if (next === key) return padding;
      key = next;
      const w = Math.ceil(width + padding * 2), h = Math.ceil(height + padding * 2);
      // One CSS-pixel map. Browser filtering interpolates it at device resolution.
      const canvas = doc.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Mobile lens map unavailable');
      const pixels = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const [dx, dy] = rimVector(x - padding + .5, y - padding + .5, width, height, radius, rim);
        const i = (y * w + x) * 4;
        pixels.data[i] = Math.round(127.5 + dx * 127.5);
        pixels.data[i + 1] = Math.round(127.5 + dy * 127.5);
        pixels.data[i + 2] = 128; pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      map.setAttribute('href', canvas.toDataURL());
      for (const [name, value] of Object.entries({ x: 0, y: 0, width: w, height: h })) {
        filter.setAttribute(name, value); map.setAttribute(name, value);
      }
      passes.forEach((pass, channel) => pass.setAttribute('scale', 2 * preset.refraction * rim * (1 + (1 - channel) * preset.dispersion)));
      blur.setAttribute('stdDeviation', preset.blur);
      return padding;
    },
    destroy() { svg.remove(); },
  };
}
