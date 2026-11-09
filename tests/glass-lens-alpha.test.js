const test = require('node:test');
const assert = require('node:assert/strict');

// Exercise the public lens API, including its cold and decoded-tile paths.
// The DOM shim records real SVG primitives; it does not replace the filter builder.
function environment({ decode = async () => {} } = {}) {
    const saved = new Map();
    function install(name, value) {
        saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
    const frames = new Map(), hosts = [], surfaces = [], observers = [];
    let frame = 0, clock = 1000;
    function node(tagName) {
        const attributes = new Map();
        return {
            tagName, children: [], style: {},
            setAttribute: (name, value) => attributes.set(name, String(value)),
            getAttribute: name => attributes.get(name) ?? null,
            append(child) { this.children.push(child); },
            remove() { const index = hosts.indexOf(this); if (index >= 0) hosts.splice(index, 1); },
        };
    }
    install('CSS', { supports: () => true });
    install('navigator', { userAgent: 'Chrome/140.0' });
    install('document', {
        body: { append: host => hosts.push(host) },
        createElementNS: (_ns, name) => node(name),
        createElement: () => ({
            getContext: () => ({
                createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
                putImageData() {},
            }),
            toBlob: done => done(new Blob()),
        }),
    });
    install('Image', class { decode() { return decode(); } });
    install('ResizeObserver', class {
        constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
        observe(el) { this.targets.add(el); }
        disconnect() { this.targets.clear(); }
    });
    install('getComputedStyle', () => ({ borderTopLeftRadius: '4px', getPropertyValue: () => 'round' }));
    install('requestAnimationFrame', callback => { frames.set(++frame, callback); return frame; });
    install('cancelAnimationFrame', id => frames.delete(id));
    install('performance', { now: () => clock });
    return {
        frames, hosts, observers,
        surface() {
            const props = new Map();
            const el = { offsetWidth: 160, offsetHeight: 100,
                style: { setProperty: (key, value) => props.set(key, value), removeProperty: key => props.delete(key) },
                props };
            surfaces.push(el);
            return el;
        },
        filter(el) {
            const id = el.props.get('--glass-lens')?.match(/#([^)]*)/)[1];
            return hosts.flatMap(host => host.children)
                .find(filter => filter.getAttribute('id') === id);
        },
        async paint() {
            clock += 1000; // A completed geometry change, outside resize settling.
            const batch = [...frames.values()]; frames.clear();
            await Promise.all(batch.map(callback => callback()));
        },
        restore() {
            for (const [name, descriptor] of saved) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else delete globalThis[name];
            }
        },
    };
}

// Evaluate the generated graph at one constant RGBA point. Displacement leaves a
// constant source unchanged, so any difference is an unwanted compositing change.
function compositePoint(filter, source) {
    const results = new Map([['SourceGraphic', source]]);
    let last = source;
    for (const node of filter.children) {
        const input = results.get(node.getAttribute('in')) || last;
        const other = results.get(node.getAttribute('in2'));
        if (node.tagName === 'feDisplacementMap') last = source;
        if (node.tagName === 'feColorMatrix') {
            const matrix = node.getAttribute('values').split(' ').map(Number);
            last = [0, 1, 2, 3].map(row => matrix.slice(row * 5, row * 5 + 4)
                .reduce((sum, value, i) => sum + value * input[i], matrix[row * 5 + 4]));
        }
        if (node.tagName === 'feBlend') {
            assert.equal(node.getAttribute('mode'), 'screen');
            const a = input[3], b = other[3], alpha = a + b - a * b;
            last = [0, 1, 2].map(i => (a * (1 - b) * input[i] + b * (1 - a) * other[i]
                + a * b * (input[i] + other[i] - input[i] * other[i])) / alpha).concat(alpha);
        }
        if (node.tagName === 'feComposite') {
            assert.equal(node.getAttribute('operator'), 'in');
            last = [...input.slice(0, 3), input[3] * other[3]];
        }
        if (node.getAttribute('result')) results.set(node.getAttribute('result'), last);
    }
    return last;
}

function assertSourcePreserved(filter) {
    assert.ok(filter, 'The filter must actually be attached');
    const passes = filter.children.filter(node => node.tagName === 'feDisplacementMap');
    assert.equal(passes.length, 3, 'All three chromatic refraction passes remain');
    const scales = passes.map(node => Number(node.getAttribute('scale')));
    assert.ok(scales[0] > scales[1] && scales[1] > scales[2] && scales[2] > 0);
    for (const source of [[0, 0, 0, .2], [.3, .5, .7, .6], [.8, .8, .8, 1]]) {
        compositePoint(filter, source).forEach((channel, i) => {
            assert.ok(Math.abs(channel - source[i]) < 1e-12, `RGBA ${source}: channel ${i} changed`);
        });
    }
}

test('modal chromatic refraction preserves translucent source alpha on cold, warm and updated lenses', async () => {
    const env = environment(), instances = [];
    try {
        const { liquidGlass, warmLiquidGlass } = await import('../vendor/glasswork/lens.js?alpha-regression');
        const options = { rim: 4, radius: 4, preserveSourceAlpha: true };
        const cold = env.surface();
        const coldLens = liquidGlass(cold, options); instances.push(coldLens);
        assert.equal(env.filter(cold), undefined, 'Cold tiles attach asynchronously');
        await env.paint();
        assert.equal(await coldLens.ready, true);
        assertSourcePreserved(env.filter(cold));

        await warmLiquidGlass(options);
        const warm = env.surface();
        const warmLens = liquidGlass(warm, options); instances.push(warmLens);
        assertSourcePreserved(env.filter(warm)); // Already decoded: attached before the next frame.
        await env.paint();
        assertSourcePreserved(env.filter(warm));

        const ordinary = env.surface();
        const ordinaryLens = liquidGlass(ordinary, { rim: 4, radius: 4 }); instances.push(ordinaryLens);
        const original = env.filter(ordinary);
        assert.equal(original.children.some(node => node.tagName === 'feComposite'), false,
            'Navbar/Dock retain their existing filter by default');
        ordinaryLens.update({ preserveSourceAlpha: true });
        await env.paint();
        assert.notEqual(env.filter(ordinary), original, 'Changing alpha policy must invalidate the filter');
        assertSourcePreserved(env.filter(ordinary));
        ordinaryLens.update({ preserveSourceAlpha: false });
        await env.paint();
        assert.equal(env.filter(ordinary).children.some(node => node.tagName === 'feComposite'), false);
    } finally {
        instances.forEach(instance => instance.destroy());
        env.restore();
    }
});

test('pausing detaches refraction and resize work, then reuses the decoded filter at the final size', async () => {
    const env = environment();
    let lens;
    try {
        const { liquidGlass } = await import('../vendor/glasswork/lens.js?pause-regression');
        const el = env.surface();
        lens = liquidGlass(el, { rim: 4, radius: 4 });
        await env.paint();
        const original = env.filter(el);
        assert.ok(original);
        lens.refresh();
        lens.pause();
        lens.pause();
        assert.equal(lens.paused, true);
        assert.equal(env.filter(el), undefined, 'No refraction graph is applied while moving');
        assert.equal(env.hosts.length, 1, 'The prepared SVG graph is retained');
        assert.equal(env.observers[0].targets.size, 0, 'ResizeObserver is disconnected');
        assert.equal(env.frames.size, 0, 'Pending fitting work is canceled');
        el.offsetWidth = 900;
        lens.refresh();
        lens.update({ edge: 1.4 });
        assert.equal(env.frames.size, 0, 'Refresh and option updates cannot fit during suspension');
        assert.notEqual(original.getAttribute('width'), '900');
        lens.resume();
        lens.resume();
        assert.equal(env.frames.size, 1, 'Resume coalesces into a single fit');
        assert.equal(env.filter(el), undefined, 'Do not expose the old geometry before fitting');
        assert.equal(env.observers[0].targets.has(el), true);
        await env.paint();
        assert.equal(env.filter(el), original, 'Same decoded graph is reused');
        assert.equal(original.getAttribute('width'), '900');
        lens.pause();
        lens.update({ radius: 8 });
        el.offsetWidth = 1000;
        lens.resume();
        assert.equal(env.filter(el), undefined);
        await env.paint();
        assert.notEqual(env.filter(el), original, 'Changed destination radius receives its own fitted map');
        assert.equal(env.filter(el).getAttribute('width'), '1000');
        await env.paint(); await env.paint(); // Retire the old SVG after replacement.
        lens.pause();
        lens.destroy();
        lens.resume();
        assert.equal(env.frames.size, 0, 'Destroyed lenses cannot resume');
        assert.equal(env.hosts.length, 0);
    } finally { lens?.destroy(); env.restore(); }
});

test('a tile decode completing during suspension cannot reattach until the final fit', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const env = environment({ decode: () => gate });
    let lens;
    try {
        const { liquidGlass } = await import('../vendor/glasswork/lens.js?paused-decode-regression');
        const el = env.surface();
        lens = liquidGlass(el, { rim: 4, radius: 4 });
        const pendingPaint = env.paint();
        lens.pause();
        release();
        await pendingPaint;
        assert.equal(env.filter(el), undefined);
        assert.equal(env.hosts.length, 0, 'Canceled decode never constructs a stale SVG');
        el.offsetWidth = 1000;
        lens.resume();
        await env.paint();
        assert.equal(await lens.ready, true);
        assert.equal(env.filter(el).getAttribute('width'), '1000');
    } finally { release(); lens?.destroy(); env.restore(); }
});
