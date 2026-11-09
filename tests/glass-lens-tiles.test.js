const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const math = import('../vendor/glasswork/lens-map.mjs');
const generators = import('../vendor/glasswork/lens-tiles.mjs');

// Captured from the original synchronous lens before moving its math. These
// cover circular/superellipse corners, tight rims and custom optical power.
const golden = [
    [[24, 24, 2, 2.6], '19c4b6fb00d401e1af4f04328880c5d1e10beab39a378d49b407949acd1e936b'],
    [[27, 15, 2, 2.6], 'f79d5b93851394e7fad6ce4d8284d37fe56ba8bd2098acfbbb7a4cdb3030f55c'],
    [[92, 24, 4, 2.6], '661c700dcdbd796b995b1849f2be7f0ddaddb8c7cb281ca2f1ed13c9d8016f20'],
    [[0, 12, 2, 2.6], '7299c534b1a0ab4bbdcef3b1789e669cb36ba13a051041089bdd508e76cd74a8'],
    [[54, 19, 3.1748021039363987, 1.8], 'a6f664374ac8ea6ef500caa761fe35dfa83dcf69244a1772fac6c6d463445e7c'],
];
function verify(result, geometry, hash) {
    const size = Math.max(1, Math.ceil(Math.max(geometry[0], geometry[1])));
    assert.equal(result.size, size);
    assert.deepEqual(result.tiles.map(({ width, height }) => [width, height]), [
        ...Array.from({ length: 4 }, () => [size, size]), [1, size], [1, size], [size, 1], [size, 1],
    ]);
    const digest = createHash('sha256');
    for (const tile of result.tiles) {
        assert.ok(tile.data instanceof Uint8ClampedArray);
        digest.update(tile.data);
    }
    assert.equal(digest.digest('hex'), hash, 'Refraction pixels must stay identical');
}
for (const [geometry, hash] of golden) {
    test(`lens pixels preserve the original optics for ${geometry.join(':')}`, async () => {
        const { tilePixels, tilePixelsAsync } = await math;
        verify(tilePixels(...geometry), geometry, hash);
        let clock = 0, yields = 0;
        const asyncResult = await tilePixelsAsync(geometry, {
            now: () => ++clock, budget: 4,
            yieldTask: async () => { yields++; },
        });
        verify(asyncResult, geometry, hash);
        assert.ok(yields > 0, 'Cooperative fallback must release the main thread');
    });
}

test('the real worker transfers unchanged tiles for concurrent geometries', async () => {
    const url = pathToFileURL(path.resolve(__dirname, '../vendor/glasswork/lens-worker.mjs')).href;
    const worker = new Worker(`
        const { parentPort } = require('node:worker_threads');
        global.self = { postMessage: (message, buffers) => parentPort.postMessage(message, buffers) };
        import(${JSON.stringify(url)}).then(() => {
            parentPort.on('message', data => self.onmessage({ data }));
        });
    `, { eval: true });
    const { createTileGenerator } = await generators;
    const client = { postMessage: data => worker.postMessage(data), terminate: () => worker.terminate() };
    worker.on('message', data => client.onmessage?.({ data }));
    worker.on('error', error => client.onerror?.(error));
    const generate = createTileGenerator({ createWorker: () => client, fallback: () => assert.fail('Worker must handle these geometries') });
    try {
        const results = await Promise.all(golden.map(([geometry]) => generate(geometry)));
        results.forEach((result, i) => verify(result, ...golden[i]));
    } finally {
        await worker.terminate();
    }
});

test('an unavailable worker uses one cooperative fallback at a time', async () => {
    const { createTileGenerator } = await generators;
    let starts = 0, running = 0, peak = 0;
    const generate = createTileGenerator({
        createWorker() { starts++; throw new Error('Workers unavailable'); },
        async fallback(geometry) {
            peak = Math.max(peak, ++running);
            await new Promise(resolve => setImmediate(resolve));
            running--;
            return geometry;
        },
    });
    assert.deepEqual(await Promise.all([1, 2, 3].map(n => generate([n]))), [[1], [2], [3]]);
    assert.equal(starts, 1);
    assert.equal(peak, 1);
});

for (const event of ['error', 'messageerror', 'postMessage', 'timeout']) {
    test(`worker ${event} recovers every pending lens without hanging readiness`, async () => {
        const { createTileGenerator } = await generators;
        let terminated = 0, starts = 0;
        const worker = {
            terminate() { terminated++; },
            postMessage() {
                if (event === 'postMessage') throw new Error('Transfer failed');
            },
        };
        const generate = createTileGenerator({
            createWorker() { starts++; return worker; },
            fallback: async geometry => geometry,
            timeoutMs: 10,
        });
        const keepAlive = setTimeout(() => {}, 1000);
        try {
            const one = generate([1]), two = generate([2]);
            if (event === 'error') worker.onerror({ preventDefault() {} });
            if (event === 'messageerror') worker.onmessageerror();
            assert.deepEqual(await Promise.all([one, two]), [[1], [2]]);
            assert.deepEqual(await generate([3]), [3]);
            assert.equal(terminated, 1);
            assert.equal(starts, 1, 'Do not keep retrying a failed worker');
        } finally {
            clearTimeout(keepAlive);
        }
    });
}

test('one failed geometry falls back without losing other worker requests', async () => {
    const { createTileGenerator } = await generators;
    const requests = [];
    const worker = { postMessage: message => requests.push(message), terminate() {} };
    const generate = createTileGenerator({ createWorker: () => worker, fallback: async geometry => geometry });
    const one = generate([1]), two = generate([2]);
    worker.onmessage({ data: { id: requests[0].id, error: 'Pixel generation failed' } });
    worker.onmessage({ data: { id: requests[1].id, result: 'complete map' } });
    assert.deepEqual(await Promise.all([one, two]), [[1], 'complete map']);
});
