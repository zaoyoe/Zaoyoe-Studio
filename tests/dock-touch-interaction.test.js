const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'magnifying-dock.js'), 'utf8');
const start = source.indexOf('      const triggerItem =');
const end = source.indexOf('      if (pageType === "prompts" || pageType === "shop") {', start);
assert.ok(start >= 0 && end > start, 'Dock interaction block must be present');

function harness() {
    function surface() {
        const listeners = new Map();
        return {
            addEventListener(type, listener, options) {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push({ listener, options });
            },
            emit(type, init = {}) {
                const event = {
                    clientX: 25, detail: 1, pointerType: 'touch', cancelable: true,
                    defaultPrevented: false, immediatePropagationStopped: false,
                    preventDefault() {
                        if (this.cancelable) this.defaultPrevented = true;
                    },
                    stopImmediatePropagation() { this.immediatePropagationStopped = true; },
                    stopPropagation() {}, ...init
                };
                for (const { listener, options } of listeners.get(type) || []) {
                    listener(event);
                    assert.ok(options?.passive !== true || !event.defaultPrevented,
                        'a passive listener cannot cancel browser touch behavior');
                    if (event.immediatePropagationStopped) break;
                }
                return event;
            }
        };
    }
    const dock = surface();
    const window = surface();
    const actions = [];
    const hover = [];
    const items = [0, 1].map(index => ({
        ...surface(), dataset: {}, offsetWidth: 44,
        getAttribute(name) { return name === 'aria-label' ? `item-${index}` : null; },
        closest() { return this; }
    }));
    vm.runInNewContext(source.slice(start, end), {
        dock, window, items, downPointer: { active: false, type: '' },
        pageConfig: { items: items.map((_, index) => ({ action: () => actions.push(index) })) },
        selectedLabel: {}, updateTip() {},
        setHover: index => hover.push(index),
        at: x => x < 50 ? 0 : 1
    });
    const pointerdown = init => {
        window.emit('pointerdown', init);
        return dock.emit('pointerdown', init);
    };
    const click = init => {
        const event = window.emit('click', init);
        if (!event.immediatePropagationStopped) dock.emit('click', init);
        return event;
    };
    return { dock, window, items, actions, hover, pointerdown, click };
}

test('touch tap cancels browser touch defaults before activating navigation once', () => {
    const { dock, items, actions, pointerdown, click } = harness();
    const event = { target: items[0] };
    assert.equal(pointerdown(event).defaultPrevented, true);
    dock.emit('pointerup', event);
    assert.deepEqual(actions, [], 'pointerup must not navigate before touch defaults can be canceled');
    assert.equal(dock.emit('touchend', event).defaultPrevented, true);
    assert.deepEqual(actions, [0]);
    assert.equal(click(event).defaultPrevented, true);
    dock.emit('touchend', event);
    assert.deepEqual(actions, [0], 'compatibility click and duplicate touchend must not navigate twice');
});

test('pen keeps native click activation after preventing pointer focus', () => {
    const { dock, items, actions, pointerdown, click } = harness();
    const event = { pointerType: 'pen', target: items[0] };
    assert.equal(pointerdown(event).defaultPrevented, true);
    dock.emit('pointerup', event);
    assert.deepEqual(actions, []);
    click(event);
    assert.deepEqual(actions, [0]);
});

test('mouse click keeps native focus and hover feedback', () => {
    const { dock, items, actions, hover, pointerdown, click } = harness();
    const event = { pointerType: 'mouse', target: items[1], clientX: 75 };
    dock.emit('pointermove', event);
    assert.equal(hover.at(-1), 1);
    assert.equal(pointerdown(event).defaultPrevented, false);
    dock.emit('pointerup', event);
    assert.deepEqual(actions, []);
    click(event);
    assert.deepEqual(actions, [1]);
});

test('keyboard and assistive clicks activate the focused button after a completed touch', () => {
    const { dock, items, actions, pointerdown, click } = harness();
    pointerdown({ target: items[0] });
    dock.emit('pointerup');
    dock.emit('touchend');
    assert.equal(click({ target: items[1], pointerType: '', detail: 0, clientX: 0 }).defaultPrevented, false);
    assert.deepEqual(actions, [0, 1]);
});

test('a canceled vertical pan clears feedback without opening a destination', () => {
    const { dock, items, actions, hover, pointerdown } = harness();
    pointerdown({ target: items[0] });
    dock.emit('pointermove', { clientX: 75 });
    dock.emit('pointercancel');
    dock.emit('pointerup', { clientX: 75 });
    assert.equal(dock.emit('touchend').defaultPrevented, false);
    assert.equal(hover.at(-1), null);
    assert.deepEqual(actions, []);
});

test('touch sliding selects the release position and cancels its compatibility click', () => {
    const { dock, items, actions, pointerdown, click } = harness();
    pointerdown({ target: items[0] });
    dock.emit('pointermove', { clientX: 75 });
    dock.emit('pointerup', { clientX: 75 });
    assert.deepEqual(actions, []);
    assert.equal(dock.emit('touchend').defaultPrevented, true);
    click({ target: { closest: () => null }, clientX: 75 });
    assert.deepEqual(actions, [1]);
});

test('a horizontal slide can return to the starting button before release', () => {
    const { dock, items, actions, pointerdown } = harness();
    pointerdown({ target: items[0] });
    dock.emit('pointermove', { clientX: 75 });
    dock.emit('pointermove', { clientX: 25 });
    dock.emit('pointerup', { clientX: 25 });
    dock.emit('touchend');
    assert.deepEqual(actions, [0]);
});

test('a non-cancelable touchend waits for native click instead of activating twice', () => {
    const { dock, items, actions, pointerdown, click } = harness();
    pointerdown({ target: items[0] });
    dock.emit('pointerup');
    assert.equal(dock.emit('touchend', { cancelable: false }).defaultPrevented, false);
    assert.deepEqual(actions, []);
    assert.equal(click({ target: items[0] }).defaultPrevented, false);
    assert.deepEqual(actions, [0]);
});

for (const gesture of [
    { moves: [75], release: 75, expected: 1 },
    { moves: [75, 25], release: 25, expected: 0 },
    { moves: [], release: 75, expected: 1 }
]) {
    test(`a non-cancelable horizontal slide activates once at release (${gesture.moves.join('→')}→${gesture.release})`, () => {
        const { dock, items, actions, pointerdown, click } = harness();
        pointerdown({ target: items[0] });
        for (const clientX of gesture.moves) dock.emit('pointermove', { clientX });
        dock.emit('pointerup', { clientX: gesture.release });
        assert.deepEqual(actions, []);
        dock.emit('touchend', { cancelable: false });
        assert.deepEqual(actions, [gesture.expected], 'a slide must work even when Chrome omits its native click');
        click({ target: items[0], clientX: gesture.release });
        dock.emit('touchend', { cancelable: false });
        assert.deepEqual(actions, [gesture.expected], 'residual events must not activate a second time');
    });
}

test('failed touch cancellation also leaves activation to native click', () => {
    const { dock, items, actions, pointerdown, click } = harness();
    pointerdown({ target: items[0] });
    dock.emit('pointerup');
    dock.emit('touchend', { preventDefault() {} });
    assert.deepEqual(actions, []);
    click({ target: items[0] });
    assert.deepEqual(actions, [0]);
});

for (const origin of [{ pointerType: 'touch' }, { pointerType: '', sourceCapabilities: { firesTouchEvents: true } }]) {
    test(`residual touch click cannot reach a newly opened overlay (${origin.pointerType || 'compatibility mouse'})`, () => {
        const { dock, window, items, actions, pointerdown } = harness();
        pointerdown({ target: items[0] });
        dock.emit('pointerup');
        dock.emit('touchend');
        let overlayClicks = 0;
        window.addEventListener('click', () => overlayClicks++);
        const event = window.emit('click', { ...origin, target: { closest: () => null } });
        assert.equal(event.defaultPrevented, true);
        assert.equal(overlayClicks, 0);
        assert.deepEqual(actions, [0]);
    });
}

test('a new pointer gesture outside the Dock clears the residual click guard', () => {
    const { dock, window, items, pointerdown } = harness();
    pointerdown({ target: items[0] });
    dock.emit('pointerup');
    dock.emit('touchend');
    window.emit('pointerdown');
    assert.equal(window.emit('click').defaultPrevented, false);
});

test('consecutive touch and mouse gestures each activate once', () => {
    const { dock, items, actions, pointerdown, click } = harness();
    for (const clientX of [25, 75]) {
        pointerdown({ clientX });
        dock.emit('pointerup', { clientX });
        dock.emit('touchend');
    }
    const mouse = { pointerType: 'mouse', target: items[0] };
    pointerdown(mouse);
    dock.emit('pointerup', mouse);
    assert.equal(click(mouse).defaultPrevented, false);
    assert.deepEqual(actions, [0, 1, 0]);
});
