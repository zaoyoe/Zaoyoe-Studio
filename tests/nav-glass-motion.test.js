const test = require('node:test');
const assert = require('node:assert/strict');

async function harness({ animationsApi = true } = {}) {
    const { pauseNavGlassDuringMotion } = await import('../js/nav-glass-motion.mjs');
    const frames = new Map(), timers = new Map(), listeners = new Map(), attributes = new Map();
    const calls = { pause: 0, resume: 0, sample: 0 };
    let id = 0, observer, animations = [];
    attributes.set('class', 'framer-nav nav-ready');
    const el = {
        getAttribute: name => attributes.get(name),
        setAttribute: (name, value) => attributes.set(name, value),
        removeAttribute: name => attributes.delete(name),
        addEventListener: (type, callback) => listeners.set(type, callback),
        removeEventListener: type => listeners.delete(type),
        ...(animationsApi ? { getAnimations: () => animations } : {}),
    };
    const win = {
        MutationObserver: class {
            constructor(callback) { observer = this; this.callback = callback; }
            observe() {}
            disconnect() { this.disconnected = true; }
        },
        requestAnimationFrame(callback) { frames.set(++id, callback); return id; },
        cancelAnimationFrame: id => frames.delete(id),
        setTimeout(callback, delay) { timers.set(++id, { callback, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        getComputedStyle: () => ({ transitionProperty: 'transform, width, border-radius',
            transitionDuration: '.45s, .45s, .45s', transitionDelay: '0s' }),
    };
    const motion = pauseNavGlassDuringMotion(el, {
        pause() { calls.pause++; }, resume() { calls.resume++; },
    }, win, () => { calls.sample++; });
    return {
        motion, el, calls, frames, timers, attributes, listeners,
        observer: () => observer,
        setAnimations: value => { animations = value; },
        classes(value) {
            const oldValue = attributes.get('class');
            attributes.set('class', value);
            observer.callback([{ oldValue }]);
        },
        event(type, propertyName, target = el, pseudoElement = '') {
            listeners.get(type)?.({ type, target, propertyName, pseudoElement });
        },
        async paint() {
            const batch = [...frames.values()]; frames.clear();
            batch.forEach(callback => callback());
            await Promise.resolve(); await Promise.resolve();
        },
    };
}

function transition(property = 'width') {
    let resolve, reject;
    const animation = { transitionProperty: property, playState: 'running',
        finished: new Promise((yes, no) => { resolve = yes; reject = no; }) };
    return { animation,
        end() { animation.playState = 'finished'; resolve(); },
        cancel() { animation.playState = 'idle'; reject(new Error('canceled')); },
    };
}

for (const direction of ['contract', 'expand']) {
    test(`${direction}: pauses before paint and waits for both width and radius before resuming once`, async () => {
        const h = await harness();
        try {
            if (direction === 'expand') h.attributes.set('class', 'framer-nav nav-ready scrolled');
            const width = transition(), radius = transition('border-top-left-radius');
            h.setAnimations([width.animation, radius.animation]);
            h.classes(`framer-nav nav-ready${direction === 'contract' ? ' scrolled' : ''}`);
            assert.equal(h.calls.pause, 1, 'Pause happens in the mutation turn');
            assert.equal(h.attributes.has('data-desktop-glass-motion'), true);
            await h.paint();
            width.end(); h.event('transitionend', 'width');
            await h.paint();
            assert.equal(h.calls.resume, 0, 'The remaining corner transition still owns the pause');
            radius.end(); h.event('transitionend', 'border-top-left-radius');
            await h.paint();
            assert.deepEqual(h.calls, { pause: 1, resume: 1, sample: 1 });
            assert.equal(h.attributes.has('data-desktop-glass-motion'), false);
            assert.equal(h.timers.size, 0);
        } finally { h.motion.destroy(); }
    });
}

test('rapid reversal ignores stale completion and cancellation, and missing end events still recover', async () => {
    const h = await harness();
    try {
        const outward = transition(); h.setAnimations([outward.animation]);
        h.classes('framer-nav nav-ready scrolled'); await h.paint();
        const inward = transition(); h.setAnimations([inward.animation]);
        h.classes('framer-nav nav-ready');
        outward.cancel(); h.event('transitioncancel', 'width');
        await h.paint();
        assert.equal(h.calls.resume, 0);
        assert.equal(h.calls.pause, 1, 'A reversal never flashes the lens back on');
        inward.end();
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        await h.paint();
        assert.equal(h.calls.resume, 1, 'The actual animation promise works without transitionend');
    } finally { h.motion.destroy(); }
});

test('no-animation/reduced-motion changes and canceled morphs never stay paused', async () => {
    const h = await harness();
    try {
        h.classes('framer-nav scrolled'); await h.paint();
        assert.equal(h.calls.resume, 1, 'No transition resumes on the next frame, not after 450ms');
        const width = transition(); h.setAnimations([width.animation]);
        h.classes('framer-nav'); await h.paint();
        width.cancel(); h.event('transitioncancel', 'width');
        await h.paint();
        assert.equal(h.calls.resume, 2);
        assert.equal(h.motion.paused, false);
    } finally { h.motion.destroy(); }
});

test('hide transforms, child dropdowns, pseudo-elements and unrelated class changes do not pause glass', async () => {
    const h = await harness();
    try {
        h.classes('framer-nav nav-ready nav-hidden');
        h.event('transitionrun', 'transform');
        h.event('transitionrun', 'width', {});
        h.event('transitionrun', 'width', h.el, '::before');
        await h.paint();
        assert.deepEqual(h.calls, { pause: 0, resume: 0, sample: 0 });
        h.event('transitionrun', 'border-top-right-radius');
        assert.equal(h.calls.pause, 1, 'Geometry transitions started without a scrolled mutation are covered');
        await h.paint();
        assert.equal(h.calls.resume, 1);
    } finally { h.motion.destroy(); }
});

test('duration-derived fallback and disposal cannot strand or revive a paused lens', async () => {
    const h = await harness({ animationsApi: false });
    h.classes('framer-nav scrolled'); await h.paint();
    assert.equal(h.timers.size, 1);
    const fallback = [...h.timers.values()][0];
    assert.equal(fallback.delay, 530);
    fallback.callback();
    assert.equal(h.calls.resume, 1);
    h.classes('framer-nav'); await h.paint();
    const abandoned = [...h.timers.values()][0];
    h.motion.destroy();
    abandoned.callback();
    assert.equal(h.calls.resume, 1, 'Disposal never resumes an instance owned by a removed surface');
    assert.equal(h.observer().disconnected, true);
    assert.equal(h.listeners.size, 0);
    assert.equal(h.frames.size, 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.attributes.has('data-desktop-glass-motion'), false);
});
