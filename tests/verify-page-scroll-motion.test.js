const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/verify-page.js'), 'utf8');
const activeAttribute = 'data-verify-scroll-active';

function createScrollHarness() {
    const listeners = new Map();
    const attributes = new Map();
    const timers = new Map();
    const writes = [];
    let now = 0;
    let nextTimer = 0;
    const window = {
        addEventListener(name, listener, options) {
            listeners.set(name, { listener, options });
        },
        setTimeout(callback, delay) {
            const id = ++nextTimer;
            timers.set(id, { callback, at: now + delay });
            return id;
        },
        clearTimeout(id) { timers.delete(id); }
    };
    const document = {
        documentElement: {
            setAttribute(name, value) {
                attributes.set(name, value);
                writes.push(['set', name]);
            },
            removeAttribute(name) {
                attributes.delete(name);
                writes.push(['remove', name]);
            }
        },
        addEventListener() {}
    };
    vm.runInNewContext(source, {
        window, document, localStorage: { getItem: () => null }
    }, { filename: 'js/verify-page.js' });
    return {
        listeners, timers, writes,
        active: () => attributes.has(activeAttribute),
        emit: name => listeners.get(name).listener(),
        advance(ms) {
            now += ms;
            for (const [id, timer] of [...timers]) {
                if (timer.at <= now) {
                    timers.delete(id);
                    timer.callback();
                }
            }
        }
    };
}

test('verify decorations stay running initially and pause on a passive scroll listener', () => {
    const h = createScrollHarness();
    assert.equal(h.active(), false);
    assert.equal(h.timers.size, 0);
    assert.equal(h.listeners.get('scroll').options.passive, true);
    h.emit('scroll');
    assert.equal(h.active(), true);
    assert.equal(h.timers.size, 1);
});

test('verify decorations stay paused through the capsule transition and then resume', () => {
    const h = createScrollHarness();
    h.emit('scroll');
    h.advance(450);
    assert.equal(h.active(), true, 'Decorations do not compete with the 450ms nav morph');
    h.advance(49);
    assert.equal(h.active(), true);
    h.advance(1);
    assert.equal(h.active(), false);
    assert.equal(h.timers.size, 0);
});

test('continuous scrolling extends the pause without repeated DOM mutations', () => {
    const h = createScrollHarness();
    h.emit('scroll');
    h.advance(400);
    h.emit('scroll');
    h.advance(400);
    h.emit('scroll');
    assert.equal(h.active(), true);
    assert.equal(h.timers.size, 1);
    assert.deepEqual(h.writes, [['set', activeAttribute]]);
    h.advance(499);
    assert.equal(h.active(), true);
    h.advance(1);
    assert.equal(h.active(), false);
    assert.deepEqual(h.writes, [['set', activeAttribute], ['remove', activeAttribute]]);
});

test('pagehide clears the timer and pause state so a restored page can scroll again', () => {
    const h = createScrollHarness();
    h.emit('scroll');
    h.emit('pagehide');
    assert.equal(h.active(), false);
    assert.equal(h.timers.size, 0);
    h.advance(1000);
    assert.equal(h.writes.length, 2, 'No stale timeout mutates the page after it is hidden');
    h.emit('scroll');
    assert.equal(h.active(), true);
    h.advance(500);
    assert.equal(h.active(), false);
});
