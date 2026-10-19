const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../js/components/WalletModal.js'), 'utf8');
const wheelLockSource = source.match(/^    function bindWalletModalWheelLock\(overlay\) \{[\s\S]*?^    \}/m)?.[0];
assert.ok(wheelLockSource, 'load the production wallet wheel handler');
const bindWheelLock = vm.runInNewContext(`(${wheelLockSource.trim()})`, {
    window: { getComputedStyle: (element) => element.style }
});

function element(parentElement = null, properties = {}) {
    return {
        parentElement,
        nodeType: 1,
        style: { overflowY: 'visible', overflowX: 'visible' },
        clientHeight: 200,
        scrollHeight: 200,
        scrollTop: 0,
        clientWidth: 200,
        scrollWidth: 200,
        scrollLeft: 0,
        ...properties
    };
}

function fixture() {
    const listeners = [];
    const page = element(null, { scrollHeight: 4000, style: { overflowY: 'auto' } });
    const overlay = element(page, {
        active: true,
        dataset: {},
        classList: { contains: (name) => name === 'active' && overlay.active },
        contains(target) {
            for (let current = target; current; current = current.parentElement) {
                if (current === this) return true;
            }
            return false;
        },
        addEventListener(type, listener, options) { listeners.push({ type, listener, options }); }
    });
    bindWheelLock(overlay);
    const layout = element(overlay);
    const sidebar = element(layout);
    const content = element(layout, {
        style: { overflowY: 'auto', overflowX: 'hidden' },
        scrollHeight: 1000,
        scrollTop: 100
    });
    const wheel = (target, overrides = {}) => {
        const event = {
            target, deltaX: 0, deltaY: 90, cancelable: true, defaultPrevented: false,
            prevented: false, stopped: false,
            preventDefault() { this.defaultPrevented = true; this.prevented = true; },
            stopPropagation() { this.stopped = true; },
            ...overrides
        };
        listeners[0].listener(event);
        return event;
    };
    return { overlay, page, layout, sidebar, content, listeners, wheel };
}

function assertContained(event) {
    assert.equal(event.prevented, true, 'prevent native scrolling of the background');
    assert.equal(event.stopped, true, 'do not forward a blocked gesture to page handlers');
}

function assertNative(event) {
    assert.equal(event.prevented, false, 'preserve native scrolling or zooming');
    assert.equal(event.stopped, false, 'preserve inner control event handlers');
}

test('wallet binds one cancellable capture listener when its cached shell is reused', () => {
    const { overlay, listeners } = fixture();
    bindWheelLock(overlay);
    assert.equal(listeners.length, 1);
    assert.equal(listeners[0].type, 'wheel');
    assert.equal(listeners[0].options.capture, true);
    assert.equal(listeners[0].options.passive, false);
    const delegatedBinding = source.slice(source.indexOf('bindDelegatedHandlers(overlay = this.modalEl) {'));
    assert.match(delegatedBinding.split("overlay.addEventListener('click'")[0], /bindWalletModalWheelLock\(overlay\);/);
});

test('wheel over sidebar buttons, header, backdrop and overlay cannot scroll the page', () => {
    const { overlay, sidebar, wheel } = fixture();
    for (const target of [element(sidebar), element(overlay), overlay]) assertContained(wheel(target));
});

test('scrollable wallet content retains native scrolling in both directions', () => {
    const { content, wheel } = fixture();
    assertNative(wheel(element(content)));
    assertNative(wheel(element(content), { deltaY: -90 }));
});

test('wallet content contains overscroll at both ends, including fractional boundaries', () => {
    const { content, wheel } = fixture();
    for (const offset of [0, 0.5]) {
        content.scrollTop = offset;
        assertContained(wheel(content, { deltaY: -90 }));
        assertNative(wheel(content));
    }
    for (const offset of [799.5, 800]) {
        content.scrollTop = offset;
        assertContained(wheel(content));
        assertNative(wheel(content, { deltaY: -90 }));
    }
});

test('a short content pane cannot pass a wheel gesture to a scrollable page ancestor', () => {
    const { content, wheel } = fixture();
    content.scrollHeight = content.clientHeight;
    assertContained(wheel(element(content)));
});

test('nested scroll areas consume the gesture, then defer only to wallet ancestors', () => {
    const { content, wheel } = fixture();
    const nested = element(content, { scrollHeight: 700, scrollTop: 100, style: { overflowY: 'auto' } });
    content.scrollTop = 800;
    assertNative(wheel(nested));
    nested.scrollTop = 500;
    assertContained(wheel(nested));
    content.scrollTop = 100;
    assertNative(wheel(nested));
});

test('hidden overflow cannot count as an inner native scroll target', () => {
    const { sidebar, wheel } = fixture();
    const clipped = element(sidebar, { scrollHeight: 700, style: { overflowY: 'hidden' } });
    assertContained(wheel(clipped));
});

test('narrow wallet layout can scroll vertically from its navigation', () => {
    const { layout, sidebar, wheel } = fixture();
    layout.style.overflowY = 'auto';
    layout.scrollHeight = 1000;
    assertNative(wheel(sidebar));
    layout.scrollTop = 800;
    assertContained(wheel(sidebar));
});

test('horizontal navigation supports trackpads and shift-wheel, and contains its ends', () => {
    const { sidebar, wheel } = fixture();
    sidebar.style.overflowX = 'auto';
    sidebar.scrollWidth = 600;
    assertNative(wheel(sidebar, { deltaX: 90, deltaY: 0 }));
    assertNative(wheel(sidebar, { shiftKey: true }));
    sidebar.scrollLeft = 400;
    assertContained(wheel(sidebar, { deltaX: 90, deltaY: 0 }));
    assertContained(wheel(sidebar, { shiftKey: true }));
    assertNative(wheel(sidebar, { deltaX: -90, deltaY: 0 }));
    assertContained(wheel(sidebar));
});

test('text-node event targets use the containing wallet control', () => {
    const { sidebar, content, wheel } = fixture();
    assertContained(wheel({ nodeType: 3, parentElement: element(sidebar) }));
    assertNative(wheel({ nodeType: 3, parentElement: element(content) }));
});

test('closed wallet, zoom gestures, handled gestures and zero deltas are left alone', () => {
    const { overlay, sidebar, wheel } = fixture();
    assertNative(wheel(sidebar, { ctrlKey: true }));
    assertNative(wheel(sidebar, { defaultPrevented: true }));
    assertNative(wheel(sidebar, { deltaY: 0 }));
    overlay.active = false;
    assertNative(wheel(sidebar));
    overlay.active = true;
    assertContained(wheel(sidebar));
});
