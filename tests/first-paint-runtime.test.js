const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { gzipSync } = require('node:zlib');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

class Events {
    constructor() { this.events = new Map(); }
    addEventListener(name, callback) {
        if (!this.events.has(name)) this.events.set(name, new Set());
        this.events.get(name).add(callback);
    }
    removeEventListener(name, callback) { this.events.get(name)?.delete(callback); }
    dispatchEvent(event) { for (const callback of [...(this.events.get(event.type) || [])]) callback(event); }
    fire(type) { this.dispatchEvent({ type }); }
}
class Element {
    constructor(attrs = {}, text = '') {
        this.nodeType = 1;
        this.attrs = { ...attrs };
        this.children = [];
        this.parentElement = null;
        this.dataset = {};
        this.text = text;
        this.writes = 0;
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    setAttribute(name, value) { this.attrs[name] = value; this.writes++; }
    hasAttribute(name) { return name in this.attrs; }
    get textContent() { return this.text; }
    set textContent(value) { this.text = value; this.writes++; }
    matches(selector) { return selector.split(',').some(part => this.hasAttribute(part.trim().slice(1, -1))); }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    append(child) { child.parentElement = this; this.children.push(child); return child; }
}
function environment(saved = 'en', blocked = false) {
    const observers = [];
    const document = Object.assign(new Events(), {
        documentElement: new Element(), readyState: 'loading',
        querySelectorAll(selector) { return this.documentElement.querySelectorAll(selector); },
        getElementById() { return null; }
    });
    const window = new Events();
    const context = vm.createContext({
        window, document, console: { log() {}, warn() {}, error() {} },
        localStorage: {
            getItem() { if (blocked) throw Error('Storage blocked'); return saved; },
            setItem(_key, value) { if (blocked) throw Error('Storage blocked'); saved = value; }
        },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; this.active = false; observers.push(this); }
            observe() { this.active = true; }
            disconnect() { this.active = false; }
        },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
    });
    return {
        context, document, window, observers,
        run(name) { vm.runInContext(read(name), context); },
        mutate(target, addedNodes = []) { for (const observer of observers) if (observer.active) observer.callback([{ target, addedNodes }]); },
        mount(attrs, text) { return document.documentElement.append(new Element(attrs, text)); }
    };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = data => ({ ok: true, json: async () => data });

test('English shell translates parser chunks and attributes without waiting for JSON', () => {
    const env = environment();
    env.run('js/i18n-preload.js');
    assert.equal(env.document.documentElement.lang, 'en');
    const title = env.mount({ 'data-i18n': 'common.retry' }, '重');
    env.mutate(env.document.documentElement, [title]);
    assert.equal(title.textContent, 'Retry');
    // The HTML parser can append a later text chunk to an already translated node.
    title.text = 'Retry · 新片段';
    env.mutate(title, [{ nodeType: 3, parentElement: title }]);
    assert.equal(title.textContent, 'Retry');
    const input = env.mount({ 'data-i18n-placeholder': 'gallery.searchPlaceholder', 'data-i18n-title': 'common.retry' });
    const meta = env.mount({ 'data-i18n': 'seo.index.description', 'data-i18n-attr': 'content' });
    env.mutate(env.document.documentElement, [input, meta]);
    assert.equal(input.getAttribute('placeholder'), 'Search prompts...');
    assert.equal(input.getAttribute('title'), 'Retry');
    assert.match(meta.getAttribute('content'), /Zaoyoe Studio/);
    const writes = title.writes + input.writes + meta.writes;
    env.mutate(env.document.documentElement);
    assert.equal(title.writes + input.writes + meta.writes, writes, 'identical translations must not create a mutation loop');
});

test('Chinese, unknown and blocked preferences preserve the Chinese default', () => {
    for (const [saved, blocked] of [['zh', false], ['fr', false], [null, false], ['en', true]]) {
        const env = environment(saved, blocked);
        const title = env.mount({ 'data-i18n': 'common.retry' }, '重试');
        env.run('js/i18n-preload.js');
        env.mutate(title);
        assert.equal(env.document.documentElement.lang, 'zh');
        assert.equal(title.textContent, '重试');
    }
});

test('parser observer stops at DOM readiness and cannot undo an interactive language change', () => {
    const env = environment();
    env.run('js/i18n-preload.js');
    const title = env.mount({ 'data-i18n': 'common.retry' }, '重试');
    env.document.fire('DOMContentLoaded');
    assert.equal(title.textContent, 'Retry');
    assert.ok(env.observers.every(observer => !observer.active));
    title.text = '重试';
    env.mutate(title);
    assert.equal(title.textContent, '重试');
});

test('runtime keeps the English first paint while full translations are delayed or fail', async () => {
    for (const fail of [false, true]) {
        const env = environment();
        const title = env.mount({ 'data-i18n': 'common.retry' }, '重试');
        env.run('js/i18n-preload.js');
        let finish;
        env.context.fetch = () => new Promise((resolve, reject) => { finish = fail ? () => reject(Error('Offline')) : () => resolve(response({ common: { retry: 'Retry' } })); });
        env.run('js/i18n.js');
        env.document.fire('DOMContentLoaded');
        assert.equal(title.textContent, 'Retry');
        assert.equal(env.window.i18n.t('nav.prompts'), 'Prompts');
        finish();
        await env.window.i18n.ready();
        assert.equal(title.textContent, 'Retry');
        assert.equal(env.document.documentElement.lang, 'en');
    }
});

test('Chinese boot never borrows English shell strings during delayed or failed translations', async () => {
    for (const fail of [false, true]) {
        const env = environment('zh');
        const title = env.mount({ 'data-i18n': 'common.retry' }, '重试');
        const nav = env.mount({ 'data-i18n': 'nav.prompts' }, '提示词');
        env.run('js/i18n-preload.js');
        let finish;
        env.context.fetch = () => new Promise((resolve, reject) => {
            finish = fail ? () => reject(Error('Offline')) : () => resolve(response({
                common: { retry: '重试' }, nav: { prompts: '提示词' }
            }));
        });
        env.run('js/i18n.js');
        env.document.fire('DOMContentLoaded');
        assert.equal(title.textContent, '重试');
        assert.equal(nav.textContent, '提示词');
        assert.equal(env.window.i18n.t('nav.prompts', '提示词'), '提示词');
        finish();
        await env.window.i18n.ready();
        assert.equal(title.textContent, '重试');
        assert.equal(nav.textContent, '提示词');
        assert.equal(env.document.documentElement.lang, 'zh');
    }
});

test('a stale translation request cannot reverse the most recent language selection', async () => {
    const env = environment();
    const title = env.mount({ 'data-i18n': 'common.retry' }, '重试');
    env.run('js/i18n-preload.js');
    let finishChinese;
    env.context.fetch = url => url.includes('/zh.json')
        ? new Promise(resolve => { finishChinese = () => resolve(response({ common: { retry: '重试' } })); })
        : Promise.resolve(response({ common: { retry: 'Retry' } }));
    env.run('js/i18n.js');
    env.document.fire('DOMContentLoaded');
    await env.window.i18n.ready();
    const older = env.window.i18n.switchLanguage('zh');
    assert.equal(env.document.documentElement.lang, 'en', 'pending translations must keep the displayed font language');
    assert.equal(title.textContent, 'Retry', 'keep existing text until translations can commit together');
    await env.window.i18n.switchLanguage('en');
    finishChinese();
    await older;
    assert.equal(env.document.documentElement.lang, 'en');
    assert.equal(title.textContent, 'Retry');
    // An unavailable localStorage must not prevent switching in this session.
    env.context.localStorage.setItem = () => { throw Error('Storage blocked'); };
    await env.window.i18n.switchLanguage('zh');
    assert.equal(title.textContent, '重试');
    assert.equal(env.document.documentElement.lang, 'zh');
    await tick();
});

test('first-paint dictionary is generated from canonical translations and precedes public body parsing', () => {
    const { generatedSource } = require('../scripts/sync-i18n-preload.js');
    const source = read('js/i18n-preload.js');
    assert.equal(source, generatedSource(source));
    assert.ok(gzipSync(source).length < 4096, 'synchronous language shell must remain small');
    const pages = fs.readdirSync(root).filter(name => name.endsWith('.html') && name !== 'index_old.html' && !name.startsWith('test'));
    for (const name of pages) {
        const html = read(name);
        if (!/src=["'][^"']*js\/i18n\.js\?/.test(html)) continue;
        const scripts = [...html.matchAll(/<script\b[^>]*src=["'][^"']*js\/i18n-preload\.js[^"']*["'][^>]*>/g)];
        assert.equal(scripts.length, 1, `${name}: one first-paint language bootstrap`);
        assert.ok(scripts[0].index < html.indexOf('<body'), `${name}: language before body`);
        assert.doesNotMatch(scripts[0][0], /\b(?:defer|async)\b/);
    }
});

function dockEnvironment({ mobile = false, scriptPresent = true, ready = false, complete = false, state = 'active' } = {}) {
    const env = environment();
    const script = new Events();
    const media = Object.assign(new Events(), { matches: mobile });
    const dock = new Element(ready ? { 'data-desktop-glass-ready': '' } : {});
    env.document.readyState = complete ? 'complete' : 'loading';
    env.document.documentElement.dataset.desktopGlassState = state;
    env.document.querySelector = () => scriptPresent ? script : null;
    Object.assign(env.context, { mobileMedia: media });
    const source = read('js/magnifying-dock.js');
    vm.runInContext(source.slice(source.indexOf('  function whenDockMaterialReady'), source.indexOf('  // Exclude admin studio')), env.context);
    let reveals = 0;
    env.context.whenDockMaterialReady(dock, () => { reveals++; });
    return { ...env, script, media, dock, reveals: () => reveals };
}

test('Dock starts its entrance only when the complete desktop material is paintable, once', () => {
    const env = dockEnvironment();
    assert.equal(env.reveals(), 0);
    env.mutate(env.dock);
    assert.equal(env.reveals(), 0);
    env.dock.setAttribute('data-desktop-glass-ready', '');
    env.mutate(env.dock);
    env.window.fire('load');
    env.media.fire('change');
    assert.equal(env.reveals(), 1);
    assert.ok(env.observers.every(observer => !observer.active));
});

test('Dock can enter immediately on touch, without a module, or after a late mount', () => {
    for (const config of [{ mobile: true }, { scriptPresent: false }, { ready: true }, { complete: true, state: 'bypass' }]) {
        assert.equal(dockEnvironment(config).reveals(), 1);
    }
});

test('failed module and desktop-to-touch changes release the Dock without a permanent hidden state', () => {
    const failed = dockEnvironment();
    failed.script.fire('error');
    assert.equal(failed.reveals(), 1);
    const bypass = dockEnvironment();
    bypass.media.matches = true;
    bypass.media.fire('change');
    assert.equal(bypass.reveals(), 1);
    const absentController = dockEnvironment({ state: undefined });
    absentController.document.readyState = 'complete';
    absentController.document.documentElement.dataset.desktopGlassState = undefined;
    absentController.window.fire('load');
    assert.equal(absentController.reveals(), 1);
});
