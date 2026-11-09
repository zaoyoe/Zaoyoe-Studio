// Shared optical math for the lens, foreground probes and tile worker.
export const ROUND_CORNER = 2;

// How much of the rim's bend a point keeps, `depth` of the way across it.
function rimStrength(depth, power) {
  return depth >= 1 ? 0 : (1 - Math.max(0, depth)) ** power;
}

// The rim's contours run from the outline (depth 0) to the rim's inner edge
// (depth 1), each the outline inset by that share of the rim. A corner
// tighter than the rim widens its inner contours toward one as wide as the
// rim, so the bend turns the corner smoothly instead of snapping along the
// diagonal (a seam the color split would light).
function contourRadius(depth, radius, bezel) {
  if (radius >= bezel) return radius - depth * bezel;
  return (1 - depth) * (radius + (bezel - radius) * depth * (2 - depth));
}

function isWithinContour(x, y, depth, radius, bezel, corner) {
  const inset = depth * bezel;
  if (x < inset || y < inset) return false;
  const curve = contourRadius(depth, radius, bezel);
  const center = inset + curve;
  if (x >= center || y >= center) return true;
  return ((center - x) / curve) ** corner + ((center - y) / curve) ** corner <= 1;
}

// The inward bend at a point `x` and `y` from a corner's two edges.
function bendNearCorner(x, y, radius, bezel, corner, power) {
  if (isWithinContour(x, y, 1, radius, bezel, corner)) return [0, 0];
  let depth = 0;
  if (isWithinContour(x, y, 0, radius, bezel, corner)) {
    // The contours are nested, so the depth a point lies at is found by halving.
    let low = 0;
    let high = 1;
    // 14 halvings place a point within 1/16000 of the rim: finer than a pixel.
    for (let step = 0; step < 14; step += 1) {
      const middle = (low + high) / 2;
      if (isWithinContour(x, y, middle, radius, bezel, corner)) low = middle;
      else high = middle;
    }
    depth = low;
  }
  const strength = rimStrength(depth, power);
  const curve = contourRadius(depth, radius, bezel);
  const center = depth * bezel + curve;
  if (x < center && y < center && curve > 0) {
    // Across the corner's curve: along its normal.
    const nx = Math.max(0, (center - x) / curve) ** (corner - 1);
    const ny = Math.max(0, (center - y) / curve) ** (corner - 1);
    const length = Math.hypot(nx, ny) || 1;
    return [(nx / length) * strength, (ny / length) * strength];
  }
  return x < y ? [strength, 0] : [0, strength];
}

// Inward offset at a point: unit direction times strength (1 at the rim's
// outer edge, 0 in the flat middle).
export function rimDisplacement(x, y, width, height, { bezel, radius, corner = ROUND_CORNER, power = 2.6 }) {
  const rim = Math.min(bezel, height / 2, width / 2);
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const [inwardX, inwardY] = bendNearCorner(Math.min(x, width - x), Math.min(y, height - y), r, rim, corner, power);
  if (inwardX === 0 && inwardY === 0) return [0, 0];
  return [x < width / 2 ? inwardX : -inwardX, y < height / 2 ? inwardY : -inwardY];
}

// Where each tile sits on a surface of this size: corners (top left, top
// right, bottom left, bottom right) then edges (top, bottom, left, right).
export function lensLayout(width, height, size) {
  const across = Math.max(1, width - size * 2);
  const down = Math.max(1, height - size * 2);
  return [
    [0, 0, size, size],
    [width - size, 0, size, size],
    [0, height - size, size, size],
    [width - size, height - size, size, size],
    [size, 0, across, size],
    [size, height - size, across, size],
    [0, size, size, down],
    [width - size, size, size, down],
  ];
}

// The tiles' pixels, read off a probe surface one pixel wider than two
// tiles. Red is the sideways bend and green the vertical one, 128 none.
// Yield after each row so the fallback can release the main thread without
// changing pixel positions, rounding, geometry or tile order.
function* tileRows(radius, bezel, corner, power) {
  const size = Math.max(1, Math.ceil(Math.max(radius, bezel)));
  const probe = size * 2 + 1;
  const geometry = { bezel, radius, corner, power };
  const tiles = [];
  for (const [left, top, width, height] of lensLayout(probe, probe, size)) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [dx, dy] = rimDisplacement(left + x + 0.5, top + y + 0.5, probe, probe, geometry);
        const i = (y * width + x) * 4;
        data[i] = Math.round(128 + dx * 127);
        data[i + 1] = Math.round(128 + dy * 127);
        data[i + 2] = 128;
        data[i + 3] = 255;
      }
      yield;
    }
    tiles.push({ width, height, data });
  }
  return { size, tiles };
}

export function tilePixels(...geometry) {
  const rows = tileRows(...geometry);
  let step;
  do { step = rows.next(); } while (!step.done);
  return step.value;
}

const yieldToBrowser = () => globalThis.scheduler?.yield
  ? globalThis.scheduler.yield()
  : new Promise(resolve => setTimeout(resolve, 0));

// Worker startup can be blocked or unavailable. The same math remains usable
// in short tasks rather than falling back to one long synchronous calculation.
export async function tilePixelsAsync(geometry, { yieldTask = yieldToBrowser, now = () => performance.now(), budget = 4 } = {}) {
  const rows = tileRows(...geometry);
  let deadline = now() + budget;
  let step;
  while (!(step = rows.next()).done) {
    if (now() >= deadline) {
      await yieldTask();
      deadline = now() + budget;
    }
  }
  return step.value;
}
