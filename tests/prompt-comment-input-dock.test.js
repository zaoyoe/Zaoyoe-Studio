const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(
    path.resolve(__dirname, '..', 'js', 'prompt-comment-input-dock.js'),
    'utf8'
);

class FakeClassList {
    constructor() {
        this.values = new Set();
    }

    add(...values) {
        values.forEach((value) => this.values.add(value));
    }

    remove(...values) {
        values.forEach((value) => this.values.delete(value));
    }

    contains(value) {
        return this.values.has(value);
    }

    toggle(value, force) {
        const enabled = force === undefined ? !this.values.has(value) : Boolean(force);
        if (enabled) this.values.add(value);
        else this.values.delete(value);
        return enabled;
    }
}

class FakeElement {
    constructor(tagName, document) {
        this.tagName = String(tagName || '').toUpperCase();
        this.ownerDocument = document;
        this.children = [];
        this.classList = new FakeClassList();
        this.dataset = {};
        this.attributes = new Map();
        this.listeners = new Map();
        this.styleValues = new Map();
        this.stylePriorities = new Map();
        this.style = {
            setProperty: (name, value, priority = '') => {
                this.styleValues.set(name, String(value));
                this.stylePriorities.set(name, String(priority));
            },
            removeProperty: (name) => {
                this.styleValues.delete(name);
                this.stylePriorities.delete(name);
            },
            getPropertyValue: (name) => this.styleValues.get(name) || '',
            getPropertyPriority: (name) => this.stylePriorities.get(name) || ''
        };
        this.value = '';
        this.hidden = false;
        this.isConnected = false;
        this.scrollHeight = 54;
    }

    append(...children) {
        children.forEach((child) => this.appendChild(child));
    }

    appendChild(child) {
        this.children.push(child);
        child.isConnected = this.isConnected;
        return child;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }

    removeEventListener(type) {
        this.listeners.delete(type);
    }

    focus() {
        this.ownerDocument.activeElement = this;
    }

    blur() {
        if (this.ownerDocument.activeElement === this) {
            this.ownerDocument.activeElement = null;
        }
    }

    setSelectionRange() {}

    remove() {
        this.isConnected = false;
    }
}

function createHarness(options = {}) {
    const rafCallbacks = new Map();
    const timerCallbacks = new Map();
    let nextId = 1;
    let now = 1000;
    const scrollCalls = [];

    const document = {
        activeElement: null,
        createElement(tagName) {
            return new FakeElement(tagName, document);
        }
    };
    document.documentElement = new FakeElement('html', document);
    document.documentElement.clientWidth = 430;
    document.documentElement.clientHeight = 900;
    document.documentElement.isConnected = true;
    document.body = new FakeElement('body', document);
    document.body.isConnected = true;

    const visualViewport = {
        offsetTop: 0,
        height: 900,
        width: 430,
        listeners: new Map(),
        addEventListener(type, listener) {
            this.listeners.set(type, listener);
        },
        removeEventListener(type) {
            this.listeners.delete(type);
        }
    };

    const window = {
        document,
        visualViewport,
        innerHeight: 900,
        scrollX: options.scrollX || 0,
        scrollY: options.scrollY || 0,
        pageXOffset: options.scrollX || 0,
        pageYOffset: options.scrollY || 0,
        addEventListener() {},
        removeEventListener() {},
        requestAnimationFrame(callback) {
            const id = nextId++;
            rafCallbacks.set(id, callback);
            return id;
        },
        cancelAnimationFrame(id) {
            rafCallbacks.delete(id);
        },
        setTimeout(callback, delay = 0) {
            const id = nextId++;
            timerCallbacks.set(id, { callback, delay });
            return id;
        },
        clearTimeout(id) {
            timerCallbacks.delete(id);
        },
        scrollTo(x, y) {
            this.scrollX = Number(x) || 0;
            this.scrollY = Number(y) || 0;
            this.pageXOffset = this.scrollX;
            this.pageYOffset = this.scrollY;
            scrollCalls.push({ x: this.scrollX, y: this.scrollY });
        }
    };

    const context = vm.createContext({
        window,
        document,
        Date: { now: () => now }
    });
    vm.runInContext(SOURCE, context, { filename: 'prompt-comment-input-dock.js' });

    return {
        Dock: window.PromptCommentInputDock,
        document,
        visualViewport,
        window,
        flushRaf() {
            const callbacks = [...rafCallbacks.values()];
            rafCallbacks.clear();
            callbacks.forEach((callback) => callback());
        },
        flushFrames(count, frameDuration = 16) {
            for (let index = 0; index < count; index += 1) {
                now += frameDuration;
                this.flushRaf();
            }
        },
        advanceTime(duration) {
            now += duration;
        },
        runTimers(maxDelay = Infinity) {
            const callbacks = [...timerCallbacks.entries()]
                .filter(([, timer]) => timer.delay <= maxDelay);
            callbacks.forEach(([id]) => timerCallbacks.delete(id));
            callbacks.forEach(([, timer]) => timer.callback());
        },
        getScrollWrites() {
            return scrollCalls.length;
        },
        getScrollCalls() {
            return [...scrollCalls];
        }
    };
}

function settleKeyboard(harness, { height = 500, top = 0 } = {}) {
    harness.visualViewport.height = height;
    harness.visualViewport.offsetTop = top;
    harness.flushFrames(7);
}

test('comment input dock keeps a clean full-height baseline across repeated keyboard cycles', () => {
    const harness = createHarness({ scrollY: 286 });
    const states = [];
    let sessionsStarted = 0;
    let sessionsEnded = 0;
    const dock = new harness.Dock({
        placeholder: '写下你的评论…',
        onSessionStart: () => { sessionsStarted += 1; },
        onSessionEnd: () => { sessionsEnded += 1; },
        onStateChange: (state) => states.push(state)
    });

    assert.equal(dock.open({ value: '第一次' }), true);
    assert.equal(dock.state, 'focusing');
    assert.equal(dock.baselineHeight, 900);
    assert.equal(harness.document.body.styleValues.get('position'), undefined);
    assert.equal(harness.document.body.styleValues.get('width'), '100%');
    assert.equal(harness.document.documentElement.styleValues.get('overflow'), 'hidden');
    assert.equal(harness.getScrollWrites(), 0);

    settleKeyboard(harness);
    assert.equal(dock.state, 'visible');
    assert.equal(dock.root.styleValues.get('--prompt-comment-input-height'), '500px');

    harness.document.activeElement = null;
    dock.handleBlur();
    assert.equal(dock.state, 'dismissing');
    assert.equal(dock.root.classList.contains('is-visible'), false);

    harness.visualViewport.height = 900;
    harness.visualViewport.offsetTop = 0;
    dock.handleViewportChange();
    harness.flushFrames(2);
    assert.equal(dock.state, 'idle');
    assert.equal(dock.baselineHeight, 900);
    assert.deepEqual(harness.getScrollCalls(), [{ x: 0, y: 286 }]);

    assert.equal(dock.open({ value: '第二次' }), true);
    assert.equal(dock.state, 'focusing');
    assert.equal(dock.baselineHeight, 900);

    settleKeyboard(harness);
    assert.equal(dock.state, 'visible');
    assert.equal(dock.input.value, '第二次');

    dock.close({ immediate: true });
    assert.equal(dock.state, 'idle');
    assert.equal(sessionsStarted, 2);
    assert.equal(sessionsEnded, 2);
    assert.deepEqual(harness.getScrollCalls(), [
        { x: 0, y: 286 },
        { x: 0, y: 286 }
    ]);
    assert.deepEqual(
        states.filter((state) => state === 'visible'),
        ['visible', 'visible']
    );
});

test('comment input dock reopens in place while the previous keyboard is still descending', () => {
    const harness = createHarness();
    let sessionsStarted = 0;
    let sessionsEnded = 0;
    const dock = new harness.Dock({
        onSessionStart: () => { sessionsStarted += 1; },
        onSessionEnd: () => { sessionsEnded += 1; }
    });

    dock.open({ value: '草稿' });
    settleKeyboard(harness);
    assert.equal(dock.state, 'visible');

    harness.visualViewport.height = 650;
    dock.handleViewportChange();
    harness.flushRaf();
    assert.equal(dock.state, 'dismissing');

    assert.equal(dock.open({ value: '继续输入' }), true);
    assert.equal(dock.state, 'focusing');
    assert.equal(dock.baselineHeight, 900);
    assert.equal(sessionsStarted, 1);
    assert.equal(sessionsEnded, 0);

    settleKeyboard(harness);
    assert.equal(dock.state, 'visible');
    assert.equal(dock.input.value, '继续输入');

    dock.close({ immediate: true });
    assert.equal(sessionsEnded, 1);
    assert.equal(harness.getScrollWrites(), 1);
});

test('comment input dock detects keyboard geometry even when iOS misses the resize event', () => {
    const harness = createHarness();
    const dock = new harness.Dock();

    dock.open({ value: '等待键盘' });
    harness.flushRaf();
    assert.equal(dock.state, 'focusing');

    harness.visualViewport.height = 500;
    harness.flushFrames(7);
    assert.equal(dock.state, 'visible');
    assert.equal(dock.keyboardSeen, true);
    assert.equal(harness.getScrollWrites(), 0);
});

test('comment input dock applies real viewport events in the same frame', () => {
    const harness = createHarness({ scrollY: 180 });
    const frames = [];
    const dock = new harness.Dock({
        onViewportChange: (frame) => frames.push(frame)
    });

    dock.open({ value: '当帧同步' });
    harness.visualViewport.offsetTop = 90;
    harness.visualViewport.height = 510;
    dock.handleViewportChange();

    assert.equal(dock.root.styleValues.get('--prompt-comment-input-top'), '90px');
    assert.equal(dock.root.styleValues.get('--prompt-comment-input-height'), '510px');
    assert.equal(frames[frames.length - 1].top, 90);
    assert.equal(frames[frames.length - 1].height, 510);
});

test('comment input dock skips duplicate writes after viewport geometry stabilizes', () => {
    const harness = createHarness();
    const frames = [];
    const dock = new harness.Dock({
        onViewportChange: (frame) => frames.push(frame)
    });

    dock.open({ value: '稳定后不重算' });
    settleKeyboard(harness, { height: 510, top: 84 });
    const stableFrameCount = frames.length;

    harness.flushFrames(30);

    assert.equal(dock.state, 'visible');
    assert.equal(stableFrameCount, 2);
    assert.equal(frames.length, stableFrameCount);
});

test('comment input dock ignores the transient high frame until viewport geometry settles', () => {
    const harness = createHarness();
    const frames = [];
    const states = [];
    const dock = new harness.Dock({
        onViewportChange: (frame) => frames.push({ top: frame.top, height: frame.height }),
        onStateChange: (state) => states.push(state)
    });

    dock.open({ value: '稳定后显示' });
    harness.visualViewport.offsetTop = 260;
    harness.visualViewport.height = 260;
    harness.flushFrames(12);

    assert.equal(dock.state, 'focusing');
    assert.equal(states.includes('visible'), false);
    assert.equal(dock.root.styleValues.get('--prompt-comment-input-top'), '260px');

    harness.visualViewport.offsetTop = 124;
    harness.visualViewport.height = 506;
    harness.flushFrames(3);
    assert.equal(dock.state, 'focusing');

    harness.visualViewport.offsetTop = 84;
    harness.visualViewport.height = 520;
    harness.flushFrames(7);

    assert.equal(dock.state, 'visible');
    assert.equal(dock.root.styleValues.get('--prompt-comment-input-top'), '84px');
    assert.equal(dock.root.styleValues.get('--prompt-comment-input-height'), '520px');
    assert.deepEqual(frames[frames.length - 1], { top: 84, height: 520 });
    assert.equal(harness.getScrollWrites(), 0);
});

test('comment input dock never publishes page-underlay compensation', () => {
    const harness = createHarness({ scrollY: 300 });
    const frames = [];
    const dock = new harness.Dock({
        onViewportChange: (frame) => frames.push(frame)
    });

    dock.open({ value: '冻结底层' });
    harness.window.scrollY = 460;
    harness.window.pageYOffset = 460;
    settleKeyboard(harness, { height: 510, top: 120 });

    assert.equal(dock.state, 'visible');
    assert.equal(frames[frames.length - 1].top, 120);
    assert.equal('pageTop' in frames[frames.length - 1], false);
    assert.equal('visualPageDelta' in frames[frames.length - 1], false);
    assert.equal(dock.root.styleValues.get('--prompt-comment-input-top'), '120px');
    assert.equal(harness.getScrollWrites(), 0);

    dock.close({ immediate: true });
    assert.deepEqual(harness.getScrollCalls(), [{ x: 0, y: 300 }]);
});

test('comment input dock keeps focus while keyboard geometry is delayed but still plausible', () => {
    const harness = createHarness();
    const dock = new harness.Dock();

    dock.open({ value: '保持焦点' });
    harness.flushFrames(20);
    assert.equal(dock.state, 'focusing');
    assert.equal(harness.document.activeElement, dock.input);

    settleKeyboard(harness);

    assert.equal(dock.state, 'visible');
    assert.equal(harness.document.activeElement, dock.input);
    assert.equal(dock.root.hidden, false);
    assert.equal(harness.getScrollWrites(), 0);
});

test('comment input dock waits for visual viewport pan to return before cleanup', () => {
    const harness = createHarness({ scrollY: 240 });
    const frames = [];
    const dock = new harness.Dock({
        onViewportChange: (frame) => frames.push(frame)
    });

    dock.open({ value: '等待完全回落' });
    settleKeyboard(harness, { height: 510, top: 96 });
    assert.equal(dock.state, 'visible');

    harness.document.activeElement = null;
    dock.handleBlur();
    harness.visualViewport.height = 900;
    harness.visualViewport.offsetTop = 72;
    harness.flushFrames(3);

    assert.equal(dock.state, 'dismissing');
    assert.equal(frames[frames.length - 1].top, 72);
    assert.equal(harness.getScrollWrites(), 0);

    harness.visualViewport.offsetTop = 0;
    harness.flushRaf();
    assert.equal(dock.state, 'idle');
    assert.deepEqual(harness.getScrollCalls(), [{ x: 0, y: 240 }]);
});

test('comment input dock restores the modal page coordinate exactly once after dismissal', () => {
    const harness = createHarness({ scrollX: 9, scrollY: 640 });
    const dock = new harness.Dock({
        getScrollPosition: () => ({ x: 0, y: 372 })
    });

    harness.document.documentElement.style.setProperty('overflow', 'hidden', 'important');
    harness.document.body.style.setProperty('overflow', 'hidden');
    harness.document.body.style.setProperty('position', 'relative');

    dock.open({ value: '锁住背景' });
    assert.equal(harness.document.body.styleValues.get('position'), 'relative');
    assert.equal(harness.document.body.styleValues.get('width'), '100%');
    assert.equal(harness.document.body.stylePriorities.get('width'), 'important');
    assert.equal(harness.getScrollWrites(), 0);

    settleKeyboard(harness);
    assert.equal(dock.state, 'visible');
    assert.equal(harness.getScrollWrites(), 0);

    dock.close({ immediate: true });
    assert.deepEqual(harness.getScrollCalls(), [{ x: 0, y: 372 }]);
    assert.equal(harness.document.documentElement.styleValues.get('overflow'), 'hidden');
    assert.equal(harness.document.documentElement.stylePriorities.get('overflow'), 'important');
    assert.equal(harness.document.body.styleValues.get('overflow'), 'hidden');
    assert.equal(harness.document.body.styleValues.get('position'), 'relative');
    assert.equal(harness.document.body.styleValues.has('width'), false);
});

test('comment input dock keeps one page lock while reopening during keyboard descent', () => {
    const harness = createHarness({ scrollY: 418 });
    const dock = new harness.Dock();

    dock.open({ value: '第一轮' });
    settleKeyboard(harness);
    harness.visualViewport.height = 650;
    dock.handleViewportChange();
    harness.flushRaf();
    assert.equal(dock.state, 'dismissing');

    dock.open({ value: '继续' });
    assert.equal(dock.pageScrollLock.y, 418);
    assert.equal(harness.getScrollWrites(), 0);

    dock.close({ immediate: true });
    assert.deepEqual(harness.getScrollCalls(), [{ x: 0, y: 418 }]);
});
