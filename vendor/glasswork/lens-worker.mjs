import { tilePixels } from './lens-map.mjs?v=20261108_1';

// Pixel math stays off the rendering thread. Transfer the buffers instead of
// copying them; image encoding and decoded-image readiness stay in lens.js.
self.onmessage = ({ data: { id, geometry } }) => {
  try {
    const result = tilePixels(...geometry);
    self.postMessage({ id, result }, result.tiles.map(tile => tile.data.buffer));
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
