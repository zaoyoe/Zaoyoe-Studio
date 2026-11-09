import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const source = read('public/admin-security.js');
const page = read('public/admin.html');
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.listeners = {}; this.textContent = ''; this.value = ''; this.classList = { add: vi.fn(), remove: vi.fn() }; }
    append(...children) { this.children.push(...children); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    emit(type) { for (const fn of this.listeners[type] || []) fn({}); }
    showModal() {} focus() {} remove() { this.removed = true; }
    close() { this.emit('close'); }
}
function harness() {
    const document = { hidden: false, body: new Element('body'), listeners: {}, createElement: tag => new Element(tag), addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); } };
    const window = { listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); } };
    const fetch = vi.fn();
    vm.runInNewContext(source, { window, document, fetch, Headers, URL, location: { origin: 'https://admin.example.test' }, Date, setTimeout, clearTimeout });
    const api = window.KcAdminSecurity;
    const event = (target, type) => { for (const fn of target.listeners[type] || []) fn(); };
    const dialog = () => document.body.children.filter(node => node.tag === 'dialog' && !node.removed).at(-1);
    const answer = value => { const current = dialog(), form = current.children[0]; form.children[1].value = value; form.emit('submit'); current.close(); };
    return { api, window, document, fetch, event, dialog, answer };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('KC sensitive response contents remain bound to the requesting page session', () => {
    it('preserves native Response methods, headers and clone behavior', async () => {
        const h = harness(); h.fetch.mockResolvedValue(new Response('{"success":true}', { headers: { 'x-fixture': 'yes' } }));
        const response = await h.api.fetch('/api/admin/billing', {}, 'offline-login');
        expect(response.ok).toBe(true); expect(response.headers.get('x-fixture')).toBe('yes');
        expect(await response.clone().json()).toEqual({ success: true }); expect(await response.text()).toBe('{"success":true}'); expect(response.bodyUsed).toBe(true);
    });
    it.each(['json', 'text', 'blob', 'arrayBuffer', 'formData'])('blocks a %s body that finishes after logout', async reader => {
        const h = harness(); let controller;
        const stream = new ReadableStream({ start(value) { controller = value; } });
        h.fetch.mockResolvedValue(new Response(stream, { headers: { 'Content-Type': reader === 'formData' ? 'application/x-www-form-urlencoded' : 'application/json' } }));
        const response = await h.api.fetch('/api/admin/billing/4/secret', {}, 'offline-login');
        const pending = response[reader](); const rejected = expect(pending).rejects.toThrow(/已取消/);
        h.api.clear(); controller.enqueue(new TextEncoder().encode(reader === 'formData' ? 'fixture=value' : '{"fixture":"value"}')); controller.close();
        await rejected;
    });
    it('rejects body reads and clone calls retained across a logout and login with the same token', async () => {
        const h = harness(); h.fetch.mockImplementation(async () => new Response('{"fixture":"value"}'));
        const old = await h.api.fetch('/api/admin/cards/1/secret', {}, 'same-offline-token'), clone = old.clone();
        h.api.clear(); await h.api.fetch('/api/admin/billing', {}, 'same-offline-token');
        await expect(old.json()).rejects.toThrow(/已取消/); await expect(clone.text()).rejects.toThrow(/已取消/); expect(() => old.clone()).toThrow(/已取消/);
    });
    it('rejects a network response that arrives after page hiding', async () => {
        const h = harness(), gate = deferred(); h.fetch.mockReturnValue(gate.promise);
        const pending = h.api.fetch('/api/admin/cards/1/secret', {}, 'offline-login'); const rejected = expect(pending).rejects.toThrow(/已取消/);
        h.document.hidden = true; h.event(h.document, 'visibilitychange'); gate.resolve(new Response('{}')); await rejected;
    });
    it('shares a single step-up dialog for concurrent rejected requests and retries each once', async () => {
        const h = harness(); let first = 0, second = 0;
        h.fetch.mockImplementation(async (url, options) => {
            if (url === '/api/admin/secondary/challenge') { first++; return new Response(JSON.stringify({ success: true, challengeId: 'offline-challenge', method: '' })); }
            if (url === '/api/admin/verify-secondary') { second++; return new Response(JSON.stringify({ success: true, secondaryToken: 'offline-proof', expiresAt: Date.now() + 300_000 })); }
            return options.headers.get('x-admin-secondary-token') === 'offline-proof' ? new Response('{"success":true}') : new Response('{"code":"STEP_UP_REQUIRED"}', { status: 403 });
        });
        const a = h.api.fetch('/api/admin/cards/1/secret', {}, 'offline-login');
        const b = h.api.fetch('/api/admin/billing/4/secret', {}, 'offline-login');
        // Response.clone() reads use the native stream scheduler, independent of fake timers.
        await vi.waitFor(() => expect(h.dialog()).toBeDefined()); h.answer('offline-password');
        const results = await Promise.all([a, b]); expect(await results[0].json()).toEqual({ success: true }); expect(await results[1].json()).toEqual({ success: true });
        expect(first).toBe(1); expect(second).toBe(1); expect(h.fetch).toHaveBeenCalledTimes(6);
    });
    it('renders secrets as text and clears dialogs after 30 seconds or page hiding', async () => {
        const h = harness(); const displayed = h.api.showSecret('<fixture-tag>'); const node = h.dialog().children[0].children[1];
        expect(node.tag).toBe('pre'); expect(node.textContent).toBe('<fixture-tag>'); expect(node.children).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(30_000); await displayed; expect(node.textContent).toBe(''); expect(h.dialog()).toBeUndefined();
        const next = h.api.showSecret('offline-fixture'); const another = h.dialog().children[0].children[1]; h.document.hidden = true; h.event(h.document, 'visibilitychange');
        await next; expect(another.textContent).toBe(''); await expect(h.api.showSecret('fixture')).rejects.toThrow(/隐藏/);
    });
});

function sessionHarness() {
    const nodes = Object.fromEntries(['session_modal_overlay', 'session_modal_body', 'session_modal_meta'].map(id => [id, new Element(id)]));
    const document = { hidden: false, getElementById: id => nodes[id], listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
    const window = { listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
    const authFetch = vi.fn(), readJsonResponse = async response => ({ ok: true, data: await response.json() });
    const a = page.indexOf("        let sessionModalPayload = ''"), b = page.indexOf('        async function copyTextToClipboard(', a);
    const context = vm.createContext({ document, window, setTimeout, clearTimeout, authFetch, readJsonResponse });
    vm.runInContext(page.slice(a, b), context);
    return { document, window, nodes, authFetch, open: context.openSessionModal, close: context.closeSessionModal, payload: () => vm.runInContext('sessionModalPayload', context) };
}
describe('KC existing Session modal clears credentials without breaking copy and export state', () => {
    it('clears rendered contents and its backing variable after 30 seconds', async () => {
        const h = sessionHarness(); h.authFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, session: { session_payload: 'offline-session' } }) });
        await h.open('fixture-job'); expect(h.payload()).toBe('offline-session');
        await vi.advanceTimersByTimeAsync(30_000); expect(h.payload()).toBe(''); expect(h.nodes.session_modal_body.textContent).toBe('');
    });
    it.each(['close', 'hide', 'pagehide', 'new-modal'])('ignores old Session contents after %s', async kind => {
        const h = sessionHarness(), gate = deferred(); h.authFetch.mockReturnValueOnce(gate.promise);
        const pending = h.open('old-job');
        if (kind === 'close') h.close();
        if (kind === 'hide') { h.document.hidden = true; h.document.listeners.visibilitychange(); }
        if (kind === 'pagehide') h.window.listeners.pagehide();
        if (kind === 'new-modal') {
            h.authFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, session: { session_payload: 'new-offline-session' } }) }); await h.open('new-job');
        }
        gate.resolve({ ok: true, json: async () => ({ success: true, session: { session_payload: 'old-offline-session' } }) }); await pending;
        expect(h.payload()).toBe(kind === 'new-modal' ? 'new-offline-session' : '');
        expect(h.nodes.session_modal_body.textContent).not.toContain('old-offline-session');
    });
    it('uses explicit recent-verification fetch for CDK reads and empties parsed secrets after display', () => {
        expect(page).toContain('data-reveal-billing=');
        const a = page.indexOf('async function revealBillingSecret('), b = page.indexOf('\n        async function ', a + 1);
        const fn = page.slice(a, b); expect(fn).toContain('authFetch('); expect(fn).toContain('encodeURIComponent(id)'); expect(fn).toContain('KcAdminSecurity.showSecret'); expect(fn).toContain('data.cdk = null');
        expect(page.slice(page.indexOf('function redirectToLogin()'), page.indexOf('function updateAdminPathPreview()'))).toContain('closeSessionModal();');
    });
});
