const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createGlassImageSampleHandler, sampleUrl } = require('../api/_lib/glass-image-sample');
const photo = 'https://cdn.fatherkey.com/prompts/imports/test.jpg?v=1';
const invoke = async (handler, url = photo, method = 'GET', suffix = '') => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method, url: `/api/runtime/glass-image-sample?url=${encodeURIComponent(url)}${suffix}` }, res);
  return res;
};
const image = async () => sharp({ create: { width: 128, height: 64, channels: 3, background: '#080c10' } }).jpeg().toBuffer();
const response = bytes => new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });

test('sampling accepts only public gallery raster URLs on the fixed HTTPS CDN', () => {
  assert.equal(sampleUrl(photo), photo);
  for (const url of [
    'http://cdn.fatherkey.com/prompts/a.jpg', 'https://evil.test/prompts/a.jpg',
    'https://cdn.fatherkey.com.evil.test/prompts/a.jpg', 'https://cdn.fatherkey.com:444/prompts/a.jpg',
    'https://user:pass@cdn.fatherkey.com/prompts/a.jpg', 'https://cdn.fatherkey.com/private/a.jpg',
    'https://cdn.fatherkey.com/prompts/a.svg', 'https://cdn.fatherkey.com/prompts/a.jpg#x',
    'https://cdn.fatherkey.com/prompts/a.jpg?redirect=https://evil.test',
    'https://cdn.fatherkey.com/prompts/a.jpg?v=1&v=2', 'https://cdn.fatherkey.com/prompts/%2e%2fprivate/a.jpg'
  ]) assert.equal(sampleUrl(url), null, url);
});

test('method and duplicate query rejection do not fetch upstream', async () => {
  let calls = 0;
  const handler = createGlassImageSampleHandler({ fetchImpl: () => { calls++; } });
  assert.equal((await invoke(handler, photo, 'POST')).statusCode, 405);
  assert.equal((await invoke(handler, 'https://evil.test/a.jpg')).statusCode, 400);
  assert.equal((await invoke(handler, photo, 'GET', '&url=other')).statusCode, 400);
  assert.equal(calls, 0);
});

test('produces an RGBA grid, caches it, and deduplicates concurrent requests', async () => {
  const bytes = await image(); let calls = 0; let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const handler = createGlassImageSampleHandler({ fetchImpl: async (url, options) => {
    calls++; assert.equal(url, photo); assert.equal(options.redirect, 'manual'); await waiting; return response(bytes);
  } });
  const first = invoke(handler), second = invoke(handler); release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1); assert.equal(a.statusCode, 200); assert.deepEqual(a.body, b.body);
  assert.deepEqual([a.body.width, a.body.height, a.body.naturalWidth, a.body.naturalHeight], [64, 32, 128, 64]);
  const pixels = Buffer.from(a.body.pixels, 'base64'); assert.equal(pixels.length, 64 * 32 * 4);
  assert.equal(pixels[3], 255); assert.ok(pixels[0] < 12); assert.match(a.headers['Cache-Control'], /s-maxage=86400/);
  assert.deepEqual((await invoke(handler)).body, a.body); assert.equal(calls, 1);
});

test('EXIF orientation keeps the displayed aspect ratio and sample coordinates', async () => {
  const bytes = await sharp(await image()).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const handler = createGlassImageSampleHandler({ fetchImpl: async () => response(bytes) });
  const res = await invoke(handler);
  assert.equal(res.statusCode, 200);
  assert.deepEqual([res.body.width, res.body.height, res.body.naturalWidth, res.body.naturalHeight], [32, 64, 64, 128]);
});

test('redirects and non-raster responses are never followed or cached', async () => {
  let calls = 0;
  const handler = createGlassImageSampleHandler({ fetchImpl: async () => {
    calls++; return calls === 1 ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }) : new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
  } });
  for (let i = 0; i < 2; i++) {
    const res = await invoke(handler); assert.equal(res.statusCode, 502); assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  assert.equal(calls, 2);
});

test('enforces declared and streaming byte limits and decode pixel limits', async () => {
  const declared = createGlassImageSampleHandler({ maxBytes: 3, fetchImpl: async () => new Response('1234', { headers: { 'content-type': 'image/jpeg', 'content-length': '4' } }) });
  assert.equal((await invoke(declared)).statusCode, 413);
  const streaming = createGlassImageSampleHandler({ maxBytes: 3, fetchImpl: async () => response(Buffer.from('1234')) });
  assert.equal((await invoke(streaming)).statusCode, 413);
  const bytes = await image();
  const oversized = createGlassImageSampleHandler({ maxPixels: 100, fetchImpl: async () => response(bytes) });
  assert.equal((await invoke(oversized)).statusCode, 422);
});

test('timeout releases the concurrency slot and allows recovery', async () => {
  const bytes = await image(); let calls = 0;
  const handler = createGlassImageSampleHandler({ timeoutMs: 10, maxConcurrent: 1, fetchImpl: async (_url, { signal }) => {
    if (++calls === 1) return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    return response(bytes);
  } });
  const first = invoke(handler);
  assert.equal((await invoke(handler, photo.replace('test.jpg', 'other.jpg'))).statusCode, 503);
  assert.equal((await first).statusCode, 504);
  assert.equal((await invoke(handler)).statusCode, 200);
});

test('server cache expires and evicts old entries', async () => {
  const bytes = await image(); let calls = 0, time = 0;
  const handler = createGlassImageSampleHandler({ maxEntries: 1, now: () => time, fetchImpl: async () => { calls++; return response(bytes); } });
  await invoke(handler); await invoke(handler); assert.equal(calls, 1);
  time = 86400001; await invoke(handler); assert.equal(calls, 2);
  await invoke(handler, photo.replace('test.jpg', 'other.jpg')); await invoke(handler); assert.equal(calls, 4);
});
