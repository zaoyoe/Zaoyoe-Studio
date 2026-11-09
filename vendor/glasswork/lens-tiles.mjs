import { tilePixelsAsync } from './lens-map.mjs?v=20261108_1';

// One worker serves all lenses. If workers are unavailable or fail to start,
// serialize the cooperative fallback so simultaneous lenses cannot combine
// several short slices into one long task on the rendering thread.
export function createTileGenerator({
  createWorker = () => new Worker(new URL('./lens-worker.mjs?v=20261108_1', import.meta.url), { type: 'module' }),
  fallback = tilePixelsAsync,
  timeoutMs = 15000,
} = {}) {
  let worker;
  let disabled = false;
  let sequence = 0;
  let fallbackQueue = Promise.resolve();
  const pending = new Map();

  function cooperative(geometry) {
    const result = fallbackQueue.then(() => fallback(geometry));
    fallbackQueue = result.catch(() => {});
    return result;
  }

  function fail(error) {
    disabled = true;
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  }

  function start() {
    if (worker || disabled) return;
    try {
      worker = createWorker();
      worker.onmessage = ({ data }) => {
        const entry = pending.get(data?.id);
        if (!entry) return;
        pending.delete(data.id);
        clearTimeout(entry.timer);
        if (data.error) entry.reject(new Error(data.error));
        else entry.resolve(data.result);
      };
      worker.onerror = event => {
        event.preventDefault?.();
        fail(new Error('Lens tile worker failed'));
      };
      worker.onmessageerror = () => fail(new Error('Lens tile worker message failed'));
    } catch (error) {
      fail(error);
    }
  }

  return function generate(geometry) {
    start();
    if (disabled) return cooperative(geometry);
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error('Lens tile worker timed out')), timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      try {
        worker.postMessage({ id, geometry });
      } catch (error) {
        fail(error);
      }
    }).catch(() => cooperative(geometry));
  };
}

export const generateTilePixels = createTileGenerator();
