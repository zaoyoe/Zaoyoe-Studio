'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/tg-admin-selects.js'), 'utf8');

class Element {
    constructor(tag, document) {
        this.tagName = tag.toUpperCase();
        this.document = document;
        this.children = [];
        this.listeners = new Map();
        this.attributes = new Map();
        this.classList = {
            add: name => this.classes.add(name),
            remove: name => this.classes.delete(name),
            toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
            contains: name => this.classes.has(name)
        };
        this.classes = new Set();
        this.style = {};
        this.hidden = false;
        this.disabled = false;
        this.scrollHeight = 100;
        this.clientHeight = 100;
        this.scrollTop = 0;
        this.offsetTop = 0;
        this.offsetHeight = 30;
    }

    set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classes].join(' '); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(name, listener) {
        const listeners = this.listeners.get(name) || [];
        listeners.push(listener);
        this.listeners.set(name, listeners);
    }
    removeEventListener(name, listener) { this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item !== listener)); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; this.removed = true; }
    matches(selector) { return selector === 'select' && this.tagName === 'SELECT'; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    closest() { return this.clippingContainer || null; }
    append(...nodes) {
        for (const node of nodes) {
            node.parentNode = this;
            this.children.push(node);
        }
    }
    replaceChildren(...nodes) {
        for (const child of this.children) child.parentNode = null;
        this.children = [];
        this.append(...nodes);
    }
    after(node) { node.parentNode = this.parentNode; this.insertedAfter = node; }
    contains(target) { return this === target || this.children.some(child => child.contains(target)); }
    getBoundingClientRect() { return { top: 20, bottom: 66 }; }
    focus() { this.document.dispatch('focusin', { target: this }); }
    dispatch(name, init = {}) {
        const event = {
            target: this,
            defaultPrevented: false,
            propagationStopped: false,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() { this.propagationStopped = true; },
            ...init
        };
        for (const listener of this.listeners.get(name) || []) listener(event);
        return event;
    }
    dispatchEvent(event) {
        for (const listener of this.listeners.get(event.type) || []) listener(event);
        return true;
    }
}

function setup() {
    const documentListeners = new Map();
    const selects = []; const observers = [];
    const document = {
        createElement: tag => new Element(tag, document),
        querySelectorAll: () => selects.filter(select => select.isConnected),
        getElementById: id => selects.find(select => select.isConnected && select.id === id) || null,
        addEventListener(name, listener) {
            const listeners = documentListeners.get(name) || [];
            listeners.push(listener);
            documentListeners.set(name, listeners);
        },
        dispatch(name, event) {
            for (const listener of documentListeners.get(name) || []) listener(event);
        }
    };
    function makeSelect(labels = ['请选择', '已核实无有效付款', '已另行退款', '已与用户协商处理'], id = '') {
        const select = new Element('select', document); select.id = id; select.isConnected = true; select.selectedIndex = 0;
        select.options = labels.map((textContent, index) => ({ textContent, disabled: false, hidden: false,
            get selected() { return select.selectedIndex === index; } }));
        Object.defineProperty(select, 'selectedOptions', { get: () => [select.options[select.selectedIndex]] });
        select.labels = []; selects.push(select); return select;
    }
    const select = makeSelect(['查询邮箱', '订单号', 'Telegram 用户名'], 'tgAdminQuerySearchBy');
    const scope = {
        document,
        innerHeight: 800, queueMicrotask,
        MutationObserver: class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe(target) { this.target = target; }
            disconnect() { this.disconnected = true; }
        },
        Event: class { constructor(type, init) { this.type = type; Object.assign(this, init); } }
    };
    vm.runInNewContext(source, { window: scope });
    return { document, select, wrapper: select.insertedAfter, scope, makeSelect, observers };
}

test('clicking TG admin query options keeps focus long enough to select order number and username', () => {
    const { document, select, wrapper } = setup();
    const trigger = wrapper.children[0];
    const menu = wrapper.children[1];
    const changes = [];
    select.addEventListener('change', () => changes.push(select.options[select.selectedIndex].textContent));
    const body = new Element('body', document);

    for (const [index, expected] of [[1, '订单号'], [2, 'Telegram 用户名']]) {
        trigger.dispatch('click');
        const option = menu.children[index];
        document.dispatch('pointerdown', { target: option });
        const down = option.dispatch('mousedown');
        if (!down.defaultPrevented) document.dispatch('focusin', { target: body });
        assert.equal(menu.hidden, false, 'the menu must stay open through the pointer press');
        option.dispatch('click');
        assert.equal(select.selectedIndex, index);
        assert.equal(trigger.children[0].textContent, expected);
        assert.equal(menu.hidden, true);
    }

    assert.deepEqual(changes, ['订单号', 'Telegram 用户名']);
});


test('completion selects added after page init gain one custom keyboard-accessible control with unique IDs', () => {
    const { scope, makeSelect } = setup();
    const first = makeSelect(); const second = makeSelect();
    first.setAttribute('aria-label', '实际处理结果');
    scope.TgAdminSelects.enhance(first); scope.TgAdminSelects.enhance(second);
    const wrapper = first.insertedAfter; const [trigger, menu] = wrapper.children;
    scope.TgAdminSelects.sync(); scope.TgAdminSelects.enhance(first);
    assert.equal(first.insertedAfter, wrapper, 'repeated enhancement must not add another control');
    assert.equal(first.listeners.get('change').length, 1);
    assert.equal(first.hidden, true); assert.equal(trigger.getAttribute('role'), 'combobox');
    assert.equal(trigger.getAttribute('aria-label'), '实际处理结果');
    assert.notEqual(first.id, second.id); assert.equal(trigger.getAttribute('aria-controls'), menu.id);
    trigger.dispatch('keydown', { key: 'ArrowDown' }); trigger.dispatch('keydown', { key: 'ArrowDown' });
    trigger.dispatch('keydown', { key: 'Enter' });
    assert.equal(first.selectedIndex, 1); assert.equal(trigger.children[0].textContent, '已核实无有效付款'); assert.equal(menu.hidden, true);
});

test('completion control tracks disabled and changed options, closes before modal Escape, and releases detached observers', () => {
    const { scope, makeSelect, observers } = setup(); const select = makeSelect();
    scope.TgAdminSelects.enhance(select); const [trigger, menu] = select.insertedAfter.children;
    select.disabled = true; scope.TgAdminSelects.sync(select); trigger.dispatch('click');
    assert.equal(trigger.disabled, true); assert.equal(menu.hidden, true);
    select.disabled = false; select.options[1].disabled = true; scope.TgAdminSelects.sync(select);
    trigger.dispatch('keydown', { key: 'ArrowDown' }); trigger.dispatch('keydown', { key: 'ArrowDown' });
    assert.equal(trigger.getAttribute('aria-activedescendant'), `${select.id}-option-2`);
    const escape = trigger.dispatch('keydown', { key: 'Escape' });
    assert.equal(escape.defaultPrevented, true); assert.equal(menu.hidden, true);
    trigger.dispatch('click'); select.isConnected = false; scope.TgAdminSelects.sync();
    assert.equal(menu.hidden, true); assert.equal(select.insertedAfter.removed, true);
    assert.equal(observers.find(observer => observer.target === select).disconnected, true);
    assert.equal(select.listeners.get('change').length, 0); assert.equal(select.hidden, false);
    select.isConnected = true; scope.TgAdminSelects.enhance(select);
    assert.equal(select.hidden, true); assert.equal(select.listeners.get('change').length, 1);
});

test('completion option list opens within the dialog scroll boundary and closes on outside pointerdown', () => {
    const { scope, document, makeSelect } = setup(); const select = makeSelect(); scope.TgAdminSelects.enhance(select);
    const wrapper = select.insertedAfter; const [trigger, menu] = wrapper.children;
    trigger.getBoundingClientRect = () => ({ top: 400, bottom: 442 });
    wrapper.clippingContainer = { getBoundingClientRect: () => ({ top: 180, bottom: 470 }) };
    menu.scrollHeight = 220; trigger.dispatch('click');
    assert.equal(wrapper.classList.contains('opens-up'), true); assert.equal(menu.style.maxHeight, '208px');
    document.dispatch('pointerdown', { target: new Element('section', document) }); assert.equal(menu.hidden, true);
});
