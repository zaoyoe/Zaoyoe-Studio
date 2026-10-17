'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(require.resolve('../js/tg-admin.js'), 'utf8');
const html = fs.readFileSync(require.resolve('../tg-admin.html'), 'utf8');
const shellScript = fs.readFileSync(require.resolve('../js/tg-admin-shell.js'), 'utf8');
const USER = { id: 'admin-user', email: 'admin@example.test' };
const CODE = 'TG-PREM-12345678-12345678-12345678-12345678';
const STARS_CODE = 'TG-STAR-12345678-12345678-12345678-12345678';
const OAUTH_PENDING_KEY = 'tg-admin-google-pending-v1';
const LOCAL_ADMIN_URL = 'http://127.0.0.1:8000/tg-admin.html';
const validAuthorizeUrl = (redirectTo = LOCAL_ADMIN_URL) => `https://database.example.test/auth/v1/authorize?${new URLSearchParams({ provider: 'google', redirect_to: redirectTo, code_challenge_method: 's256', code_challenge: 'a'.repeat(43) })}`;
const pendingMarker = (overrides = {}) => JSON.stringify({ provider: 'google', redirectTo: LOCAL_ADMIN_URL, createdAt: Date.now(), ...overrides });
const businessCalls = (ui) => ui.calls.filter((call) => call.url.startsWith('/api/admin/tg/'));
const response = (data = {}, status = 200) => ({ ok: status < 400, status, json: async () => data });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function page(options = {}) {
    const elements = new Map();
    const events = new Map();
    const calls = [];
    const accessCalls = [];
    const authCalls = [];
    const configurations = [];
    const confirmations = [];
    const navigation = [];
    const history = [];
    const timeline = [];
    const storage = options.storage || new Map();
    if (Object.hasOwn(options, 'pending')) storage.set(OAUTH_PENDING_KEY, options.pending);
    const currentUrl = new URL(options.url || LOCAL_ADMIN_URL);
    let signedIn = options.signedIn !== false;
    function element(tag = 'div') {
        const classes = new Set();
        return { tag, value: '', textContent: '', hidden: false, disabled: false, checked: false, open: false, children: [], listeners: new Map(),
            attributes: new Map(), setAttribute(name, value) { this[name] = value; this.attributes.set(name, value); },
            removeAttribute(name) { this.attributes.delete(name); delete this[name]; },
            contains(candidate) { return this === candidate || this.children.some(child => child.contains?.(candidate)); },
            classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name) },
            addEventListener(name, listener) { this.listeners.set(name, listener); },
            append(...nodes) { this.children.push(...nodes); },
            replaceChildren(...nodes) { this.children = nodes; },
            showModal() { this.open = true; },
            showPopover() { this.popoverOpen = true; }, hidePopover() { this.popoverOpen = false; },
            close() { this.open = false; this.listeners.get('close')?.({ currentTarget: this }); },
            focus() { this.focused = true; document.activeElement = this; }, select() { this.selected = true; },
            reset() { this.resetCalled = true; },
            async trigger(name, event = {}) { await this.listeners.get(name)?.({ preventDefault() {}, currentTarget: this, ...event }); }
        };
    }
    const document = { documentElement: element('html'), body: element('body'), activeElement: null, getElementById(id) { if (!elements.has(id)) elements.set(id, Object.assign(element(), { id })); return elements.get(id); }, createElement: element };
    const get = document.getElementById;
    const navMedia = { matches: options.compact === true, addEventListener(_name, listener) { this.listener = listener; } };
    get('tgAdminSidebar').children = [get('tgAdminNavClose'), ...['Dashboard', 'Query', 'Purchases', 'Orders', 'Codes', 'Products', 'Provider'].map(key => get('tgAdminTab' + key))];
    get('tgLoginForm').elements = { email: { value: 'Admin@Example.Test ' }, password: { value: 'never-persist-this' } };
    for (const id of ['tgGoogleLogin', 'tgLoginSubmit']) get(id).disabled = true;
    get('tgGenerateForm').entries = { product_family: 'telegram_premium', term_months: '3', count: '1', name: '首发批次', valid_until: '' };
    get('tgOrderFilter').value = '';
    get('tgCopyToast').hidden = true;
    const client = { auth: {
        async getSession() { return options.getSession ? options.getSession() : { data: { session: signedIn ? { user: USER } : null } }; },
        async signInWithPassword(input) { authCalls.push({ action: 'login', ...input }); if (options.signInThrows) throw new Error('network_unavailable'); if (options.signInError) return { error: Object.assign(new Error('private provider error'), { code: options.signInError === true ? 'invalid_credentials' : options.signInError }) }; signedIn = true; return { data: { user: USER } }; },
        async signInWithOAuth(input) { authCalls.push({ action: 'oauth', ...input }); timeline.push('oauth'); if (options.oauth) return options.oauth(input); return { data: { url: options.authorizeUrl || validAuthorizeUrl(input.options.redirectTo) } }; },
        async exchangeCodeForSession(code) { authCalls.push({ action: 'exchange', code }); timeline.push('exchange'); if (options.exchange) { const result = await options.exchange(code); if (!result.error) signedIn = true; return result; } signedIn = true; return { data: { user: USER } }; },
        async signOut(input) { signedIn = false; authCalls.push({ action: 'logout', ...input }); }
    } };
    const window = { document, crypto: { randomUUID: () => options.operationId || 'f47ac10b-58cc-4372-a567-0e02b2c3d483' },
        setTimeout: options.setTimeout || setTimeout, clearTimeout: options.clearTimeout || clearTimeout, matchMedia: () => navMedia,
        URL, URLSearchParams,
        location: { origin: currentUrl.origin, href: currentUrl.href, assign(url) { navigation.push(url); timeline.push('navigate'); } },
        history: { replaceState(_state, _title, url) { history.push(url); timeline.push('clean-url'); window.location.href = new URL(url, currentUrl).href; } },
        sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
        FormData: class { constructor(form) { this.form = form; } entries() { return Object.entries(this.form.entries); } },
        requireZaoyoeSupabaseConfig: () => ({ url: 'https://database.example.test', publishableKey: 'public-key' }),
        supabase: { createClient(...args) { configurations.push(args); return client; } },
        AdminAccess: {
            async getCurrentAdminAccess(input) { accessCalls.push({ action: 'verify', ...input }); timeline.push('verify'); return options.accessLookup ? options.accessLookup() : { user: signedIn ? USER : null, isSuperAdmin: options.isSuperAdmin !== false, error: options.accessError }; },
            async createAdminStudioSession(input) { accessCalls.push({ action: 'issue', ...input }); timeline.push('issue'); return options.issueSession ? options.issueSession() : { ok: true }; },
            async clearAdminStudioSession() { accessCalls.push({ action: 'clear' }); }, clearAccessCache() {}
        },
        navigator: { clipboard: options.clipboard || { writeText: async () => {} } },
        confirm(message) { confirmations.push(message); return options.confirm !== false; },
        addEventListener: (name, fn) => events.set(name, fn),
        async fetch(url, request = {}) {
            calls.push({ url, request });
            timeline.push(url.includes('/auth/') ? JSON.parse(request.body).action : 'load');
            if (options.fetch) { const custom = await options.fetch(url, request); if (custom) return custom; }
            if (url.includes('/tg/codes?')) return response({ success: true, batches: options.batches || [], total: options.total || 0 });
            if (url.includes('/tg/orders?')) return response({ success: true, orders: options.orders || [], total: 0 });
            if (url.endsWith('/tg/products')) return response({ success: true, products: options.products || [] });
            if (url.includes('/tg/purchases?')) return response({ success: true, purchases: options.purchases || [], total: options.purchaseTotal || 0 });
            if (url.endsWith('/tg/provider')) return response({ success: true, healthy: true, payment_currency: 'usdt', balances: { gram: '4.50', usdt: '10.00' } });
            return response({ success: true, security: { ip_blocked: false, account_locked: false } });
        }
    };
    if (options.selects) window.TgAdminSelects = options.selects;
    if (options.dataCenter) window.TgAdminDataCenter = options.dataCenter;
    vm.runInNewContext(shellScript, { window });
    vm.runInNewContext(script, { window, URLSearchParams, Date });
    return { get, calls, accessCalls, authCalls, configurations, confirmations, events, client, window, storage, navigation, history, timeline, setCompact(value) { navMedia.matches = value; navMedia.listener?.({ matches: value }); }, async ready() { await tick(); await tick(); } };
}

test('TG administration uses independent local assets and no HTML interpolation', () => {
    assert.match(html, /\/vendor\/supabase\/2\.95\.3\/supabase\.js/);
    assert.match(html, /\/js\/admin-access\.js/);
    assert.match(html, /\/css\/tg-admin\.css/);
    assert.match(html, /id="tgGoogleLogin"[^>]*disabled/);
    assert.match(html, /id="tgLoginSubmit"[^>]*disabled/);
    assert.doesNotMatch(script, /\.innerHTML\b|localStorage/);
    assert.doesNotMatch(html, /tgAdminIdentity|独立业务管理/);
    assert.doesNotMatch(script, /tgAdminIdentity/);
    assert.match(script, /sessionStorage\.setItem\(OAUTH_PENDING_KEY, JSON\.stringify\(\{ provider: 'google', redirectTo, createdAt: Date\.now\(\) \}\)\)/);
});

test('boot validates super-admin access before issuing a host session or loading TG data', async () => {
    const ui = page(); await ui.ready();
    assert.equal(ui.configurations[0][0], 'https://database.example.test');
    assert.equal(ui.configurations[0][1], 'public-key');
    assert.equal(ui.configurations[0][2].auth.storageKey, 'tg-admin-auth-v1');
    assert.equal(ui.configurations[0][2].auth.flowType, 'pkce');
    assert.equal(ui.configurations[0][2].auth.detectSessionInUrl, false);
    assert.deepEqual(ui.accessCalls.map((call) => call.action), ['verify', 'issue']);
    assert.ok(ui.accessCalls.every((call) => call.supabaseClient === ui.client && call.forceRefresh === true && call.allowPersistedSessionFallback === false));
    assert.equal(ui.get('tgAdminApp').hidden, false);
    assert.equal(ui.get('tgAdminLogout').hidden, false);
    assert.ok(ui.calls.every((call) => call.request.credentials === 'same-origin'));
    for (const options of [{ signedIn: false }, { isSuperAdmin: false }]) {
        const denied = page(options); await denied.ready();
        assert.equal(denied.get('tgAdminApp').hidden, true);
        assert.equal(businessCalls(denied).length, 0);
        assert.ok(!denied.accessCalls.some((call) => call.action === 'issue'));
    }
});

test('reload waits for the isolated SDK session and host authorization without showing the login form', async () => {
    assert.match(html, /id="tgLoginPanel"[^>]*hidden/);
    assert.match(html, /id="tgAdminLoading"[^>]*aria-busy="true"/);
    const restoring = deferred(); const issuing = deferred(); const loading = deferred();
    const ui = page({ getSession: () => restoring.promise, issueSession: () => issuing.promise, fetch: url => url.startsWith('/api/admin/tg/') ? loading.promise : null });
    await ui.ready();
    assert.equal(ui.get('tgAdminLoading').hidden, false);
    assert.equal(ui.get('tgLoginPanel').hidden, true);
    assert.equal(ui.get('tgAdminApp').hidden, true);
    assert.equal(ui.get('tgAdminLogout').hidden, true);
    assert.equal(ui.accessCalls.length, 0);
    assert.equal(ui.calls.length, 0);
    restoring.resolve({ data: { session: { user: USER } } }); await ui.ready();
    assert.deepEqual(ui.accessCalls.map(call => call.action), ['verify', 'issue']);
    assert.equal(ui.get('tgAdminLoading').hidden, false);
    assert.equal(ui.get('tgLoginPanel').hidden, true);
    assert.equal(businessCalls(ui).length, 0);
    issuing.resolve({ ok: true }); await ui.ready();
    assert.equal(businessCalls(ui).length, 5);
    assert.equal(ui.get('tgAdminLoading').hidden, false, 'keep the matching skeleton until initial data is ready');
    assert.equal(ui.get('tgAdminApp').hidden, true);
    assert.equal(ui.get('tgAdminRefresh').hidden, true);
    assert.equal(ui.window.document.body.classList.contains('tg-admin-is-loading'), true);
    loading.resolve(response({ success: true })); await ui.ready();
    assert.equal(ui.window.document.body.classList.contains('tg-admin-is-loading'), false);
    assert.equal(ui.get('tgAdminRefresh').hidden, false);
    assert.equal(ui.get('tgAdminLoading').hidden, true);
    assert.equal(ui.get('tgLoginPanel').hidden, true);
    assert.equal(ui.get('tgAdminApp').hidden, false);
    assert.equal(businessCalls(ui).length, 5);
});

test('the remembered module chooses its skeleton before session recovery, with a safe fallback', async () => {
    assert.ok(html.indexOf('/js/tg-admin-shell.js') < html.indexOf('<body'), 'choose the layout before the first paint');
    for (const saved of ['Dashboard', 'Query', 'Purchases', 'Orders', 'Codes', 'Products', 'Provider', 'unknown', '<script>', null]) {
        const restoring = deferred();
        const ui = page({ signedIn: false, storage: new Map([['tg-admin-section-v1', saved]]), getSession: () => restoring.promise });
        const expected = ['Dashboard', 'Query', 'Purchases', 'Orders', 'Codes', 'Products', 'Provider'].includes(saved) ? saved : 'Dashboard';
        assert.equal(ui.window.document.documentElement.attributes.get('data-tg-admin-section'), expected);
        assert.equal(businessCalls(ui).length, 0);
        restoring.resolve({ data: { session: null } }); await ui.ready();
        assert.equal(ui.window.document.body.classList.contains('tg-admin-is-loading'), false);
        assert.equal(ui.get('tgLoginPanel').hidden, false);
    }
    const ui = page({ storage: { get() { throw new Error('storage unavailable'); } } }); await ui.ready();
    assert.equal(ui.window.document.documentElement.attributes.get('data-tg-admin-section'), 'Dashboard');
    assert.equal(ui.get('tgAdminApp').hidden, false);
});

test('a partial initial load keeps the skeleton until all requests settle and then exposes the error', async () => {
    const loading = deferred();
    const ui = page({ fetch: url => url.endsWith('/tg/provider') ? response({}, 503) : url.startsWith('/api/admin/tg/') ? loading.promise : null });
    await ui.ready();
    assert.equal(ui.get('tgAdminLoading').hidden, false);
    assert.equal(ui.get('tgAdminApp').hidden, true);
    loading.resolve(response({ success: true })); await ui.ready();
    assert.equal(ui.get('tgAdminLoading').hidden, true);
    assert.equal(ui.get('tgAdminApp').hidden, false);
    assert.equal(ui.get('tgAdminAlert').classList.contains('error'), true);
    assert.match(ui.get('tgAdminAlert').textContent, /服务暂不可用/);
    assert.equal(ui.get('tgAdminRefresh').disabled, false);
});

test('a rejected initial data session cannot reveal the workspace when the remaining requests finish', async () => {
    for (const status of [401, 403]) {
        const loading = deferred();
        const ui = page({ fetch: url => url.endsWith('/tg/provider') ? response({}, status) : url.startsWith('/api/admin/tg/') ? loading.promise : null });
        await ui.ready();
        assert.equal(ui.get('tgLoginPanel').hidden, false);
        loading.resolve(response({ success: true })); await ui.ready();
        assert.equal(ui.get('tgAdminApp').hidden, true);
        assert.equal(ui.get('tgAdminLoading').hidden, true);
        assert.equal(ui.get('tgAdminRefresh').hidden, true);
        assert.equal(ui.window.document.body.classList.contains('tg-admin-is-loading'), false);
    }
});

test('temporary session recovery failure offers retry and reuses the isolated client without signing out', async () => {
    let attempts = 0;
    const restoring = deferred();
    const ui = page({ getSession: () => ++attempts === 1 ? { error: { status: 503 } } : restoring.promise }); await ui.ready();
    assert.equal(ui.get('tgLoginPanel').hidden, true);
    assert.equal(ui.get('tgAdminApp').hidden, true);
    assert.equal(ui.get('tgAdminLoading').hidden, false);
    assert.equal(ui.get('tgAdminLoading').attributes.get('aria-busy'), 'false');
    assert.equal(ui.get('tgAdminRetry').hidden, false);
    assert.equal(ui.get('tgAdminSkeleton').hidden, true);
    assert.equal(ui.authCalls.length, 0);
    assert.equal(ui.accessCalls.length, 0);
    const retrying = ui.get('tgAdminRetry').trigger('click');
    await ui.get('tgAdminRetry').trigger('click'); await ui.ready();
    assert.equal(attempts, 2, 'duplicate retries cannot start competing session checks');
    assert.equal(ui.get('tgAdminRetry').hidden, true);
    assert.equal(ui.get('tgAdminSkeleton').hidden, false);
    assert.equal(ui.get('tgAdminLoading').attributes.get('aria-busy'), 'true');
    restoring.resolve({ data: { session: { user: USER } } }); await retrying;
    assert.equal(ui.configurations.length, 1);
    assert.equal(ui.get('tgAdminApp').hidden, false);
    assert.equal(ui.authCalls.length, 0);
    assert.equal(businessCalls(ui).length, 5);
});

test('restored-session network failures never become logout or login flashes and retry must reverify access', async () => {
    const cases = [
        () => ({ getSession: async () => { throw new Error('network unavailable'); } }),
        () => ({ accessLookup: async () => { throw new Error('network unavailable'); } }),
        () => ({ accessLookup: async () => ({ user: null, error: { status: 503 } }) }),
        () => ({ accessError: new Error('RPC timeout') }),
        () => ({ fetch: async () => { throw new Error('network unavailable'); } }),
        () => ({ fetch: async () => response({}, 503) }),
        () => ({ fetch: async () => response({ success: true }) }),
        () => ({ issueSession: async () => { throw new Error('network unavailable'); } }),
        () => ({ issueSession: async () => ({ ok: false, status: 503 }) })
    ];
    for (const makeOptions of cases) {
        const options = makeOptions(); const ui = page(options); await ui.ready();
        assert.equal(ui.get('tgLoginPanel').hidden, true);
        assert.equal(ui.get('tgAdminApp').hidden, true);
        assert.equal(ui.get('tgAdminRetry').hidden, false);
        assert.equal(businessCalls(ui).length, 0);
        assert.equal(ui.authCalls.length, 0, 'connection failures must preserve SDK credentials');
        const priorVerifications = ui.accessCalls.filter(call => call.action === 'verify').length;
        for (const key of Object.keys(options)) delete options[key];
        await ui.get('tgAdminRetry').trigger('click');
        assert.equal(ui.get('tgAdminApp').hidden, false);
        assert.equal(ui.get('tgLoginPanel').hidden, true);
        assert.equal(ui.accessCalls.filter(call => call.action === 'verify').length, priorVerifications + 1);
        assert.equal(ui.configurations.length, 1);
        assert.equal(businessCalls(ui).length, 5);
    }
});

test('missing or definitively rejected sessions show login and cannot fetch management data', async () => {
    for (const options of [
        { signedIn: false },
        { signedIn: false, getSession: async () => ({ data: { session: null }, error: { status: 401 } }) },
        { accessLookup: async () => ({ user: null, error: { status: 401 } }) },
        { issueSession: async () => ({ ok: false, status: 401 }) },
        { issueSession: async () => ({ ok: false, status: 403 }) },
        { fetch: async () => response({}, 401) },
        { fetch: async () => response({}, 403) }
    ]) {
        const ui = page(options); await ui.ready();
        assert.equal(ui.get('tgLoginPanel').hidden, false);
        assert.equal(ui.get('tgAdminLoading').hidden, true);
        assert.equal(ui.get('tgAdminApp').hidden, true);
        assert.equal(businessCalls(ui).length, 0);
    }
});

test('refresh icon stays busy for the pending data requests and blocks duplicate refreshes', async () => {
    const options = {}; const ui = page(options); await ui.ready();
    assert.equal(ui.get('tgAdminAlert').textContent, '');
    ui.get('tgAdminAlert').textContent = '订单处理结果';
    const loading = deferred();
    options.fetch = async url => url.startsWith('/api/admin/tg/') ? loading.promise : null;
    const refreshing = ui.get('tgAdminRefresh').trigger('click');
    await ui.get('tgAdminRefresh').trigger('click');
    assert.equal(ui.get('tgAdminRefresh').disabled, true);
    assert.equal(ui.get('tgAdminRefresh').attributes.get('aria-busy'), 'true');
    assert.equal(businessCalls(ui).length, 10);
    assert.equal(ui.get('tgAdminRefresh').attributes.get('aria-label'), '正在刷新数据');
    assert.equal(ui.get('tgAdminAlert').textContent, '订单处理结果');
    loading.resolve(response({ success: true, products: [] })); await refreshing;
    assert.equal(ui.get('tgAdminRefresh').disabled, false);
    assert.equal(ui.get('tgAdminRefresh').attributes.get('aria-busy'), 'false');
    assert.equal(ui.get('tgAdminRefresh').attributes.get('aria-label'), '刷新数据');
    assert.equal(ui.get('tgAdminAlert').textContent, '订单处理结果', 'ordinary refresh must not overwrite important operation feedback');
});

test('provider summary distinguishes the configured debit currency from independent balances', async () => {
    assert.match(html, /id="tgProviderCurrency"[^>]*>当前扣款：未确认<\/p>/);
    const current = page(); await current.ready();
    assert.equal(current.get('tgProviderCurrency').textContent, '当前扣款：USDT');
    assert.equal(current.get('tgGramBalance').textContent, '4.50');
    assert.equal(current.get('tgUsdtBalance').textContent, '10.00');
    for (const [currency, label] of [['gram', 'GRAM'], [null, '未确认'], [undefined, '未确认'], ['untrusted-private-value', '未确认'], ['toString', '未确认']]) {
        const ui = page({ fetch: async (url) => url.endsWith('/tg/provider') ? response({ success: true, healthy: true, payment_currency: currency }) : null });
        await ui.ready();
        assert.equal(ui.get('tgProviderCurrency').textContent, `当前扣款：${label}`);
        assert.ok(businessCalls(ui).every((call) => !call.request.method || call.request.method === 'GET'));
    }
});

test('login runs security preflight, records failed passwords and always clears the password field', async () => {
    const failed = page({ signedIn: false, signInError: true }); await failed.ready();
    await failed.get('tgLoginForm').trigger('submit');
    assert.deepEqual(failed.calls.map((call) => JSON.parse(call.request.body).action), ['preflight', 'record_failure']);
    assert.equal(JSON.parse(failed.calls[0].request.body).email, 'admin@example.test');
    assert.equal(failed.authCalls.length, 1);
    assert.equal(failed.get('tgLoginForm').elements.password.value, '');
    assert.match(failed.get('tgLoginMessage').textContent, /邮箱或密码错误/);
    const blocked = page({ signedIn: false, fetch: async () => response({ success: true, security: { ip_blocked: false, account_locked: true } }) }); await blocked.ready();
    await blocked.get('tgLoginForm').trigger('submit');
    assert.equal(blocked.authCalls.length, 0);
    assert.equal(blocked.get('tgLoginForm').elements.password.value, '');
    assert.match(blocked.get('tgLoginMessage').textContent, /安全限制/);
});

test('HTTP 401 and 403 return to a specific login message without a redirect loop', async () => {
    for (const [status, message] of [[401, /登录已失效/], [403, /没有 TG 管理权限/]]) {
        const ui = page({ fetch: async (url) => url.startsWith('/api/admin/tg/') ? response({ success: false }, status) : null }); await ui.ready();
        assert.equal(ui.get('tgAdminApp').hidden, true);
        assert.equal(ui.get('tgLoginPanel').hidden, false);
        assert.match(ui.get('tgLoginMessage').textContent, message);
        assert.equal(businessCalls(ui).length, 5);
    }
});

test('generation blocks duplicate submissions and requires saved confirmation before clearing plaintext', async () => {
    const generated = deferred();
    const payload = { success: true, codes: [CODE] };
    const ui = page({ fetch: async (url, request) => url.endsWith('/tg/codes') && request.method === 'POST' ? generated.promise : null }); await ui.ready();
    const submitting = ui.get('tgGenerateForm').trigger('submit');
    await ui.get('tgGenerateForm').trigger('submit');
    assert.equal(businessCalls(ui).filter((call) => call.request.method === 'POST').length, 1);
    assert.equal(ui.get('tgGenerateSubmit').disabled, true);
    generated.resolve(response(payload)); await submitting;
    assert.equal(ui.get('tgCodesModal').open, true);
    assert.equal(ui.get('tgCodesText').value, CODE);
    assert.equal(payload.codes[0], '');
    await ui.get('tgCodesClose').trigger('click');
    assert.equal(ui.get('tgCodesModal').open, true);
    assert.match(ui.get('tgCodesCopyMessage').textContent, /请先保存兑换码/);
    await ui.get('tgAdminLogout').trigger('click');
    assert.equal(ui.authCalls.length, 0, 'logout must not silently discard the only plaintext copy');
    ui.get('tgCodesSaved').checked = true;
    await ui.get('tgCodesClose').trigger('click');
    assert.equal(ui.get('tgCodesModal').open, false);
    assert.equal(ui.get('tgCodesText').value, '');
    assert.equal(ui.get('tgGenerateSubmit').disabled, false);
});

test('copy errors preserve the visible plaintext and offer manual copying', async () => {
    const ui = page({ clipboard: { writeText: async () => { throw new Error('permission_denied'); } } }); await ui.ready();
    ui.get('tgCodesText').value = CODE;
    await ui.get('tgCodesCopy').trigger('click');
    assert.equal(ui.get('tgCodesText').value, CODE);
    assert.equal(ui.get('tgCodesText').selected, true);
    assert.match(ui.get('tgCodesCopyMessage').textContent, /请手动复制/);
});

test('batch list renders upstream text literally, paginates, and confirms revocation', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    const batch = { id: 'batch-id', batch_no: payload, term_months: 3, status: 'active', metadata: { name: payload } };
    const ui = page({ batches: [batch], total: 26, confirm: false }); await ui.ready();
    const identity = ui.get('tgBatchesBody').children[0].children[0].children[0];
    assert.equal(identity.textContent, payload);
    assert.equal(identity.children[0].textContent, payload);
    const actions = ui.get('tgBatchesBody').children[0].children[6].children[0];
    await actions.children[1].trigger('click');
    assert.match(ui.confirmations[0], /确认撤销批次/);
    assert.ok(!businessCalls(ui).some((call) => call.request.method === 'POST'));
    await ui.get('tgBatchesPager').children[2].trigger('click');
    assert.ok(ui.calls.some((call) => call.url.includes('/tg/codes?page=2&pageSize=25')));
    assert.equal(ui.get('tgBatchesPager').children[2].disabled, true);
    assert.equal(ui.get('tgOrdersPager').children[1].disabled, true);
    assert.equal(ui.get('tgOrdersPager').children[2].disabled, true);
});

test('Stars generation separates quantity per code from the number of codes', async () => {
    const ui = page({ fetch: async (url, request) => url.endsWith('/tg/codes') && request.method === 'POST'
        ? response({ success: true, codes: [STARS_CODE, STARS_CODE] }) : null }); await ui.ready();
    ui.get('tgProductFamily').value = 'telegram_stars';
    await ui.get('tgProductFamily').trigger('change');
    assert.equal(ui.get('tgPremiumTerm').disabled, true);
    assert.equal(ui.get('tgStarsQuantityField').hidden, false);
    assert.equal(ui.get('tgStarsQuantity').required, true);
    ui.get('tgGenerateForm').entries = { product_family: 'telegram_stars', term_months: '3', stars_quantity: '1500', count: '2', name: 'Stars' };
    await ui.get('tgGenerateForm').trigger('submit');
    const call = businessCalls(ui).find((call) => call.request.method === 'POST');
    const body = JSON.parse(call.request.body);
    assert.equal(body.product_family, 'telegram_stars');
    assert.equal(body.stars_quantity, 1500);
    assert.equal(body.count, 2);
    assert.ok(!Object.hasOwn(body, 'term_months'));
    assert.equal(ui.get('tgCodesText').value, `${STARS_CODE}\n${STARS_CODE}`);
});

test('invalid Stars quantities and unknown products fail before generation', async () => {
    for (const product of [
        { product_family: 'telegram_stars', stars_quantity: '49' },
        { product_family: 'telegram_stars', stars_quantity: '1000001' },
        { product_family: 'telegram_stars', stars_quantity: '50.5' },
        { product_family: 'unknown', term_months: '3' }
    ]) {
        const ui = page(); await ui.ready();
        ui.get('tgGenerateForm').entries = { ...product, count: '1' };
        await ui.get('tgGenerateForm').trigger('submit');
        assert.ok(!businessCalls(ui).some((call) => call.request.method === 'POST'));
        assert.ok(ui.get('tgGenerateMessage').textContent.length > 0);
    }
});

test('mixed product records show verified entitlements and reject unknown records', async () => {
    const products = [
        { term_months: 3 },
        { product_family: 'telegram_stars', stars_quantity: 1500, term_months: null },
        { product_family: 'unexpected', term_months: 6 },
        { product_family: 'telegram_stars', stars_quantity: 1500, term_months: 3 }
    ];
    const ui = page({ batches: products, orders: products }); await ui.ready();
    for (const [index, label] of ['Premium · 3 个月', 'Stars · 1,500 颗', '产品权益未确认', '产品权益未确认'].entries()) {
        assert.equal(ui.get('tgBatchesBody').children[index].children[1].children[0].textContent, label);
        assert.equal(ui.get('tgOrdersBody').children[index].children[2].children[0].textContent, label);
    }
});

test('Premium generation omits stale Stars values and validates the returned product prefix', async () => {
    const ui = page({ fetch: async (url, request) => url.endsWith('/tg/codes') && request.method === 'POST'
        ? response({ success: true, codes: [STARS_CODE] }) : null }); await ui.ready();
    ui.get('tgGenerateForm').entries.stars_quantity = '1500';
    await ui.get('tgGenerateForm').trigger('submit');
    const body = JSON.parse(businessCalls(ui).find((call) => call.request.method === 'POST').request.body);
    assert.equal(body.term_months, 3);
    assert.ok(!Object.hasOwn(body, 'stars_quantity'));
    assert.equal(ui.get('tgCodesModal').open, false);
    assert.match(ui.get('tgGenerateMessage').textContent, /生成结果异常/);
});

const PRICE_PRODUCTS = [
    ...[3, 6, 12].map((term) => ({ product_id: `premium_${term}`, product_family: 'telegram_premium', term_months: term, enabled: false, currency: 'CNY', price_version: 1, price_minor: term === 3 ? 12999 : null })),
    { product_id: 'stars', product_family: 'telegram_stars', term_months: null, enabled: false, currency: 'CNY', price_version: 2, unit_price_micros: 12345 }
];

test('product price management renders configured prices precisely and keeps absent prices unconfigured', async () => {
    const ui = page({ products: PRICE_PRODUCTS }); await ui.ready();
    assert.equal(ui.get('tgPrice-premium_3').value, '129.99');
    assert.equal(ui.get('tgPrice-premium_6').value, '');
    assert.equal(ui.get('tgPrice-stars').value, '0.012345');
    assert.equal(ui.get('tgEnabled-stars').checked, false);
    assert.equal(ui.get('tgVersion-stars').textContent, 'v2');
    assert.equal(ui.get('tgSave-stars').disabled, false);
    assert.ok(businessCalls(ui).every((call) => !call.request.method || call.request.method === 'GET'));
    const unavailable = page(); await unavailable.ready();
    assert.equal(unavailable.get('tgPrice-stars').value, ''); assert.equal(unavailable.get('tgSave-stars').disabled, true);
});

test('price saving converts currency decimals to exact integers with optimistic versions', async () => {
    for (const [id, value, key, expected, version] of [['premium_3', '129.99', 'price_minor', 12999, 1], ['stars', '0.012345', 'unit_price_micros', 12345, 2]]) {
        const product = PRICE_PRODUCTS.find((item) => item.product_id === id);
        const ui = page({ products: PRICE_PRODUCTS, fetch: async (url, request) => url.endsWith('/tg/products') && request.method === 'POST'
            ? response({ success: true, product: { ...product, enabled: true, price_version: version + 1, [key]: expected } }) : null });
        await ui.ready(); ui.get(`tgPrice-${id}`).value = value; ui.get(`tgEnabled-${id}`).checked = true;
        await ui.get(`tgSave-${id}`).trigger('click');
        const input = JSON.parse(businessCalls(ui).find((call) => call.request.method === 'POST').request.body);
        assert.deepEqual(input, { product_id: id, enabled: true, expected_price_version: version, [key]: expected });
        assert.match(ui.get('tgPriceMessage').textContent, /已保存/);
    }
});

test('invalid decimal prices never save and conflict responses do not overwrite displayed versions', async () => {
    for (const [id, value] of [['premium_3', '1.001'], ['premium_3', '1e3'], ['premium_3', '0'], ['premium_3', '-1'], ['stars', '0.0000001'], ['stars', 'Infinity'], ['stars', '9007199254740992']]) {
        const ui = page({ products: PRICE_PRODUCTS }); await ui.ready(); ui.get(`tgPrice-${id}`).value = value; await ui.get(`tgSave-${id}`).trigger('click');
        assert.ok(!businessCalls(ui).some((call) => call.request.method === 'POST')); assert.match(ui.get('tgPriceMessage').textContent, /须大于零/);
    }
    const ui = page({ products: PRICE_PRODUCTS, fetch: async (url, request) => url.endsWith('/tg/products') && request.method === 'POST' ? response({ success: false, message: '商品价格已更新，请刷新后重试' }, 409) : null });
    await ui.ready(); ui.get('tgPrice-stars').value = '0.1'; await ui.get('tgSave-stars').trigger('click');
    assert.equal(ui.get('tgVersion-stars').textContent, 'v2'); assert.match(ui.get('tgPriceMessage').textContent, /刷新后重试/);
});

test('direct purchase orders keep payment and fulfillment states separate and paginate', async () => {
    const ui = page({ purchaseTotal: 26, purchases: [{ order_no: 'TGP-12345678901234567890', telegram_username: 'recipient_test', product_family: 'telegram_stars', stars_quantity: 1500, term_months: null,
        currency: 'CNY', total_minor: 1234, payment_channel: 'wxpay', payment_status: 'paid', fulfillment_status: 'processing', created_at: '2026-10-15T01:00:00Z' }] }); await ui.ready();
    const row = ui.get('tgPurchasesBody').children[0];
    assert.equal(row.children[2].children[0].textContent, 'Stars · 1,500 颗');
    assert.equal(row.children[3].children[0].textContent, '¥12.34');
    assert.equal(row.children[4].children[0].textContent, '微信支付');
    assert.equal(row.children[5].children[0].textContent, '已付款');
    assert.equal(row.children[6].children[0].textContent, '处理中');
    await ui.get('tgPurchasesPager').children[2].trigger('click');
    assert.ok(ui.calls.some((call) => call.url.includes('/tg/purchases?page=2&pageSize=25')));
    assert.equal(ui.get('tgPurchasesPager').children[2].disabled, true);
});

test('Google login requires no typed email or password and uses a fixed same-origin PKCE callback', async () => {
    for (const origin of ['http://127.0.0.1:8000', 'http://localhost:8000', 'https://tg.adm.fatherkey.com']) {
        const ui = page({ signedIn: false, url: `${origin}/tg-admin.html?next=https://untrusted.example/` }); await ui.ready();
        ui.get('tgLoginForm').elements.email.value = '';
        ui.get('tgLoginForm').elements.password.value = '';
        await ui.get('tgGoogleLogin').trigger('click');
        assert.equal(ui.authCalls.length, 1);
        assert.equal(ui.authCalls[0].action, 'oauth');
        assert.equal(ui.authCalls[0].provider, 'google');
        assert.equal(ui.authCalls[0].options.redirectTo, `${origin}/tg-admin.html`);
        assert.equal(ui.authCalls[0].options.skipBrowserRedirect, true);
        assert.equal(ui.authCalls[0].options.queryParams.prompt, 'select_account');
        assert.deepEqual(JSON.parse(ui.calls[0].request.body), { action: 'preflight_ip' });
        const authorize = new URL(ui.navigation[0]);
        assert.equal(authorize.origin, 'https://database.example.test');
        assert.equal(authorize.pathname, '/auth/v1/authorize');
        assert.equal(authorize.searchParams.get('code_challenge_method'), 's256');
        assert.match(authorize.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
        const pending = JSON.parse(ui.storage.get(OAUTH_PENDING_KEY));
        assert.deepEqual(Object.keys(pending).sort(), ['createdAt', 'provider', 'redirectTo']);
        assert.equal(pending.provider, 'google');
        assert.equal(pending.redirectTo, `${origin}/tg-admin.html`);
        assert.ok(Math.abs(pending.createdAt - Date.now()) < 10000);
        assert.equal(ui.storage.size, 1, 'only a credential-free pending marker is persisted by the page');
        assert.equal(ui.get('tgGoogleLogin').disabled, true);
        assert.equal(businessCalls(ui).length, 0);
    }
});

test('Google IP preflight blocks authorization and gives a precise static security message', async () => {
    const ui = page({ signedIn: false, fetch: async () => response({ success: true, security: { ip_blocked: true, account_locked: false } }) });
    await ui.ready(); await ui.get('tgGoogleLogin').trigger('click');
    assert.equal(ui.authCalls.length, 0);
    assert.equal(ui.navigation.length, 0);
    assert.equal(ui.storage.size, 0);
    assert.equal(ui.get('tgGoogleLogin').disabled, false);
    assert.match(ui.get('tgLoginMessage').textContent, /当前网络受到安全限制/);
});

test('Google login rejects untrusted or malformed authorization URLs without navigation', async () => {
    const base = validAuthorizeUrl();
    const update = (key, value) => { const url = new URL(base); if (value === null) url.searchParams.delete(key); else url.searchParams.set(key, value); return url.href; };
    for (const authorizeUrl of [
        base.replace('https://database.example.test', 'https://untrusted.example'),
        base.replace('https://', 'http://'),
        base.replace('https://', 'https://user:password@'),
        base.replace('/auth/v1/authorize', '/auth/v1/other'),
        `${base}#private-fragment`,
        `${base}&provider=github`,
        `${base}&redirect_to=https%3A%2F%2Funtrusted.example`,
        `${base}&code_challenge_method=s256`,
        `${base}&code_challenge=${'A'.repeat(43)}`,
        update('provider', 'github'),
        update('redirect_to', `${LOCAL_ADMIN_URL}?next=https://untrusted.example/`),
        update('code_challenge_method', 'plain'),
        update('code_challenge', 'short'),
        update('code_challenge', null),
        'javascript:alert(1)'
    ]) {
        const ui = page({ signedIn: false, authorizeUrl }); await ui.ready(); await ui.get('tgGoogleLogin').trigger('click');
        assert.equal(ui.navigation.length, 0, authorizeUrl);
        assert.equal(ui.storage.size, 0);
        assert.equal(ui.get('tgLoginMessage').textContent, 'Google 登录暂未完成，请稍后重试');
        assert.equal(ui.get('tgGoogleLogin').disabled, false);
    }
});

test('Google duplicate clicks cannot create multiple authorization requests', async () => {
    const gate = deferred();
    const ui = page({ signedIn: false, oauth: () => gate.promise }); await ui.ready();
    const first = ui.get('tgGoogleLogin').trigger('click'); await tick();
    assert.equal(ui.get('tgGoogleLogin').disabled, true);
    assert.equal(ui.get('tgLoginSubmit').disabled, true);
    await ui.get('tgGoogleLogin').trigger('click');
    await ui.get('tgLoginForm').trigger('submit');
    assert.equal(ui.authCalls.length, 1);
    assert.equal(ui.calls.length, 1);
    gate.resolve({ data: { url: validAuthorizeUrl() } }); await first;
    assert.equal(ui.navigation.length, 1);
});

test('valid Google callback cleans the URL before exchanging once and checks the authenticated identity', async () => {
    const gate = deferred();
    const ui = page({ signedIn: false, url: `${LOCAL_ADMIN_URL}?code=valid_code`, pending: pendingMarker(), exchange: () => gate.promise });
    await ui.ready();
    assert.deepEqual(ui.history, ['/tg-admin.html']);
    assert.equal(ui.window.location.href, LOCAL_ADMIN_URL);
    assert.equal(ui.storage.size, 0);
    assert.deepEqual(ui.timeline, ['clean-url', 'exchange']);
    assert.equal(ui.get('tgGoogleLogin').disabled, true);
    gate.resolve({ data: { user: USER } }); await ui.ready();
    assert.deepEqual(ui.authCalls.map((call) => call.action), ['exchange']);
    assert.equal(ui.authCalls[0].code, 'valid_code');
    assert.deepEqual(ui.accessCalls.map((call) => call.action), ['verify', 'issue']);
    assert.deepEqual(JSON.parse(ui.calls[0].request.body), { action: 'preflight', email: USER.email });
    assert.ok(ui.accessCalls.every((call) => call.allowPersistedSessionFallback === false));
    assert.ok(ui.timeline.indexOf('clean-url') < ui.timeline.indexOf('exchange'));
    assert.ok(ui.timeline.indexOf('exchange') < ui.timeline.indexOf('preflight'));
    assert.ok(ui.timeline.indexOf('preflight') < ui.timeline.indexOf('issue'));
    assert.equal(ui.get('tgAdminApp').hidden, false);
    assert.equal(ui.get('tgAdminLogout').hidden, false);
});

test('Google success without super-admin permissions cannot issue a host session or load business data', async () => {
    const ui = page({ signedIn: false, isSuperAdmin: false, url: `${LOCAL_ADMIN_URL}?code=valid_code`, pending: pendingMarker() }); await ui.ready();
    assert.equal(ui.authCalls.filter((call) => call.action === 'exchange').length, 1);
    assert.deepEqual(ui.accessCalls.map((call) => call.action), ['verify']);
    assert.equal(ui.get('tgAdminApp').hidden, true);
    assert.equal(ui.get('tgAdminLogout').hidden, false);
    assert.match(ui.get('tgLoginMessage').textContent, /没有 TG 管理权限/);
    assert.equal(businessCalls(ui).length, 0);
});

test('Google callback survives Vercel cleanUrls without changing the allowlisted redirect or PKCE marker', async () => {
    const origin = 'https://tg.adm.fatherkey.com';
    const redirectTo = `${origin}/tg-admin.html`;
    const url = `${origin}/tg-admin?code=clean_url_code`;
    const ui = page({ signedIn: false, url, pending: pendingMarker({ redirectTo }) });
    await ui.ready();
    assert.deepEqual(ui.history, ['/tg-admin']);
    assert.equal(ui.window.location.href, `${origin}/tg-admin`);
    assert.equal(ui.storage.size, 0);
    assert.equal(ui.authCalls.filter((call) => call.action === 'exchange').length, 1);
    assert.equal(ui.authCalls[0].code, 'clean_url_code');
    assert.deepEqual(ui.accessCalls.map((call) => call.action), ['verify', 'issue']);
    assert.equal(ui.get('tgAdminApp').hidden, false);

    for (const options of [
        { url },
        { url, pending: pendingMarker({ redirectTo, createdAt: Date.now() - 600001 }) },
        { url, pending: pendingMarker({ redirectTo: `${origin}/tg-admin` }) },
        { url: `${url}&code=second`, pending: pendingMarker({ redirectTo }) },
        { url: `${url}&access_token=untrusted`, pending: pendingMarker({ redirectTo }) },
        { url: `${url}#refresh_token=untrusted`, pending: pendingMarker({ redirectTo }) }
    ]) {
        const rejected = page({ signedIn: false, ...options }); await rejected.ready();
        assert.equal(rejected.authCalls.some((call) => call.action === 'exchange'), false);
        assert.equal(rejected.accessCalls.some((call) => call.action === 'issue'), false);
        assert.equal(rejected.get('tgAdminApp').hidden, true);
        assert.equal(rejected.storage.size, 0);
    }
});

test('Google callbacks without a matching recent marker, duplicate codes or implicit tokens are rejected', async () => {
    const cases = [
        { url: `${LOCAL_ADMIN_URL}?code=valid_code` },
        { pending: pendingMarker({ createdAt: Date.now() - 600001 }), url: `${LOCAL_ADMIN_URL}?code=valid_code` },
        { pending: pendingMarker({ createdAt: Date.now() + 60000 }), url: `${LOCAL_ADMIN_URL}?code=valid_code` },
        { pending: pendingMarker({ provider: 'github' }), url: `${LOCAL_ADMIN_URL}?code=valid_code` },
        { pending: pendingMarker({ redirectTo: 'https://untrusted.example/' }), url: `${LOCAL_ADMIN_URL}?code=valid_code` },
        { pending: '{malformed', url: `${LOCAL_ADMIN_URL}?code=valid_code` },
        { pending: pendingMarker(), url: `${LOCAL_ADMIN_URL}?code=one&code=two` },
        { pending: pendingMarker(), url: `${LOCAL_ADMIN_URL}?code=` },
        { pending: pendingMarker(), url: `${LOCAL_ADMIN_URL}?code=invalid%20code` },
        { pending: pendingMarker(), url: `${LOCAL_ADMIN_URL}?code=valid_code#ignored` },
        { pending: pendingMarker(), url: `${LOCAL_ADMIN_URL}?access_token=secret&refresh_token=private` },
        { pending: pendingMarker(), url: `${LOCAL_ADMIN_URL}#access_token=secret&refresh_token=private` },
        { pending: pendingMarker(), url: `${LOCAL_ADMIN_URL.replace('/tg-admin.html', '/other.html')}?code=valid_code` }
    ];
    for (const options of cases) {
        const ui = page(options); await ui.ready();
        assert.deepEqual(ui.history, ['/tg-admin.html']);
        assert.equal(ui.window.location.href, LOCAL_ADMIN_URL);
        assert.deepEqual(ui.authCalls.map((call) => call.action), ['logout']);
        assert.equal(ui.authCalls[0].scope, 'local');
        assert.ok(!ui.accessCalls.some((call) => call.action === 'verify' || call.action === 'issue'));
        assert.equal(ui.storage.size, 0);
        assert.equal(ui.get('tgAdminApp').hidden, true);
        assert.match(ui.get('tgLoginMessage').textContent, /已过期或无效/);
        assert.equal(ui.calls.length, 0);
    }
});

test('consumed Google callback marker cannot be replayed in a second page instance', async () => {
    const storage = new Map([[OAUTH_PENDING_KEY, pendingMarker()]]);
    const first = page({ signedIn: false, storage, url: `${LOCAL_ADMIN_URL}?code=one_time_code` }); await first.ready();
    assert.equal(first.get('tgAdminApp').hidden, false);
    const replay = page({ signedIn: false, storage, url: `${LOCAL_ADMIN_URL}?code=one_time_code` }); await replay.ready();
    assert.equal(replay.authCalls.filter((call) => call.action === 'exchange').length, 0);
    assert.equal(replay.get('tgAdminApp').hidden, true);
    assert.equal(storage.size, 0);
});

test('provider rejection and code exchange failures use static copy and never record password failures', async () => {
    for (const options of [
        { url: `${LOCAL_ADMIN_URL}?error=access_denied&error_description=private_provider_secret`, pending: pendingMarker() },
        { url: `${LOCAL_ADMIN_URL}?code=valid_code`, pending: pendingMarker(), exchange: async () => ({ error: new Error('private_provider_secret') }) },
        { url: `${LOCAL_ADMIN_URL}?code=valid_code`, pending: pendingMarker(), exchange: async () => { throw new Error('private_provider_secret'); } }
    ]) {
        const ui = page({ signedIn: false, ...options }); await ui.ready();
        assert.equal(ui.get('tgAdminApp').hidden, true);
        assert.doesNotMatch(ui.get('tgLoginMessage').textContent, /private_provider_secret|valid_code/);
        assert.match(ui.get('tgLoginMessage').textContent, /Google 登录/);
        assert.equal(ui.storage.size, 0);
        assert.equal(ui.calls.length, 0);
        assert.ok(ui.authCalls.some((call) => call.action === 'logout' && call.scope === 'local'));
    }
});

test('restored sessions still honor account locks and clear local credentials before host-session issuance', async () => {
    const ui = page({ fetch: async () => response({ success: true, security: { ip_blocked: false, account_locked: true, remaining_seconds: 125 } }) }); await ui.ready();
    assert.deepEqual(JSON.parse(ui.calls[0].request.body), { action: 'preflight', email: USER.email });
    assert.equal(ui.get('tgAdminApp').hidden, true);
    assert.match(ui.get('tgLoginMessage').textContent, /约 3 分钟后重试/);
    assert.ok(!ui.accessCalls.some((call) => call.action === 'issue'));
    assert.ok(ui.authCalls.some((call) => call.action === 'logout' && call.scope === 'local'));
    assert.equal(businessCalls(ui).length, 0);
});

test('password fallback still works and checks actual identity after authentication', async () => {
    const ui = page({ signedIn: false }); await ui.ready();
    await ui.get('tgLoginForm').trigger('submit');
    assert.equal(ui.get('tgAdminApp').hidden, false);
    assert.deepEqual(ui.authCalls.map((call) => call.action), ['login']);
    assert.deepEqual(ui.calls.filter((call) => call.url.includes('/auth/')).map((call) => JSON.parse(call.request.body)), [
        { action: 'preflight', email: 'admin@example.test' }, { action: 'preflight', email: USER.email }
    ]);
    assert.equal(ui.get('tgLoginForm').elements.password.value, '');
    assert.equal(ui.storage.size, 0);
});

test('password provider outages and network failures do not increment invalid-password counters', async () => {
    for (const options of [{ signInThrows: true }, { signInError: 'request_timeout' }]) {
        const ui = page({ signedIn: false, ...options }); await ui.ready(); await ui.get('tgLoginForm').trigger('submit');
        assert.deepEqual(ui.calls.map((call) => JSON.parse(call.request.body).action), ['preflight']);
        assert.equal(ui.get('tgAdminApp').hidden, true);
        assert.equal(ui.get('tgLoginForm').elements.password.value, '');
        assert.equal(ui.get('tgGoogleLogin').disabled, false);
        assert.equal(ui.storage.size, 0);
    }
});

test('returning through browser history releases Google loading state and invalidates the old marker', async () => {
    const ui = page({ signedIn: false }); await ui.ready(); await ui.get('tgGoogleLogin').trigger('click');
    assert.equal(ui.get('tgGoogleLogin').disabled, true);
    assert.ok(ui.storage.has(OAUTH_PENDING_KEY));
    ui.events.get('pageshow')({ persisted: true });
    assert.equal(ui.get('tgGoogleLogin').disabled, false);
    assert.equal(ui.get('tgLoginSubmit').disabled, false);
    assert.equal(ui.storage.size, 0);
});

const descendants = root => [root, ...(root.children || []).flatMap(descendants)];
const findButton = (root, label) => descendants(root).find(item => item.tag === 'button' && item.textContent === label);
const contentText = root => descendants(root).map(item => item.textContent).join(' ');
const OPERATIONS_VERSION = '2026-10-17T10:00:00.000Z';
const PURCHASE_DETAIL = { order_no: 'TGP-ABCDEFGHIJKLMNOPQRST', username: 'telegram_user', product_family: 'telegram_stars', term_months: null,
    stars_quantity: 500, total_minor: 1234, currency: 'CNY', price_version: 2, payment_channel: 'usdt_bep20', payment_status: 'pending',
    fulfillment_status: 'not_started', can_close: true, updated_at: OPERATIONS_VERSION };

test('purchase filters belong to the order table, retain combinations across pages and reset together', async () => {
    const section = html.slice(html.lastIndexOf('<section', html.indexOf('id="tgPurchaseFilters"')), html.indexOf('id="tgPurchasesBody"'));
    assert.match(section, /即时购买订单/); assert.doesNotMatch(section, /tg-price-table/);
    const ui = page({ purchaseTotal: 60 }); await ui.ready();
    ui.get('tgPurchaseUsername').value = '@telegram_user'; ui.get('tgPurchasePaymentFilter').value = 'manual_review';
    ui.get('tgPurchaseChannel').value = 'usdt_bep20'; ui.get('tgPurchaseFamily').value = 'telegram_stars';
    await ui.get('tgPurchaseFilters').trigger('submit');
    await findButton(ui.get('tgPurchasesPager'), '下一页').trigger('click');
    let url = new URL(ui.calls.filter(call => call.url.includes('/tg/purchases?')).at(-1).url, LOCAL_ADMIN_URL);
    assert.equal(url.searchParams.get('page'), '2'); assert.equal(url.searchParams.get('payment_status'), 'manual_review');
    assert.equal(url.searchParams.get('username'), '@telegram_user'); assert.equal(url.searchParams.get('payment_channel'), 'usdt_bep20');
    assert.match(contentText(ui.get('tgPurchasesBody')), /暂无符合条件/);
    await ui.get('tgPurchaseReset').trigger('click');
    url = new URL(ui.calls.filter(call => call.url.includes('/tg/purchases?')).at(-1).url, LOCAL_ADMIN_URL);
    assert.equal(url.searchParams.get('page'), '1'); assert.equal(url.searchParams.has('payment_channel'), false);
    assert.equal(ui.get('tgPurchaseUsername').value, '');
});

test('purchase detail labels USDT accurately and closes with a reason and the displayed version', async () => {
    const wait = deferred(); let detail = { ...PURCHASE_DETAIL };
    const ui = page({ purchases: [PURCHASE_DETAIL], fetch: (url, req) => {
        if (url.includes('/tg/purchases?order_no=')) return response({ success: true, order: detail, history: [] });
        if (url === '/api/admin/tg/purchases' && req.method === 'POST') return wait.promise;
    } }); await ui.ready();
    assert.match(contentText(ui.get('tgPurchasesBody')), /USDT/);
    await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    const root = ui.get('tgDetailContent'); const close = findButton(root, '关闭未付款订单');
    await close.trigger('click'); assert.equal(ui.calls.filter(call => call.request.method === 'POST' && call.url.endsWith('/tg/purchases')).length, 0);
    assert.match(contentText(root), /请填写/);
    const note = descendants(root).find(item => item.tag === 'textarea'); note.value = '客户确认未付款，关闭原订单';
    const closing = close.trigger('click'); await tick(); await findButton(root, '保存核对记录').trigger('click');
    const writes = ui.calls.filter(call => call.request.method === 'POST' && call.url.endsWith('/tg/purchases')); assert.equal(writes.length, 1);
    assert.deepEqual(JSON.parse(writes[0].request.body), { order_no: PURCHASE_DETAIL.order_no, action: 'close', expected_updated_at: OPERATIONS_VERSION, note: note.value });
    assert.match(ui.confirmations.at(-1), /迟到付款/);
    detail = { ...detail, payment_status: 'cancelled', can_close: false }; wait.resolve(response({ success: true })); await closing;
    assert.equal(findButton(ui.get('tgDetailContent'), '关闭未付款订单'), undefined);
});

test('purchase review offers fulfillment links and provider lookups stay read-only until explicitly synchronized', async () => {
    const fulfillment = { id: 'order-id', order_no: 'TG-ABCDEFGHIJKLMNOP', order_source: 'purchase', status: 'manual_review', telegram_username: 'telegram_user',
        product_family: 'telegram_stars', stars_quantity: 500, term_months: null, provider_order_id: 'provider-id', updated_at: OPERATIONS_VERSION };
    const ui = page({ purchases: [PURCHASE_DETAIL], fetch: url => {
        if (url.includes('/tg/purchases?order_no=')) return response({ success: true, order: { ...PURCHASE_DETAIL, payment_status: 'paid', can_close: false }, fulfillment, history: [] });
        if (url.includes('/tg/orders?orderId=')) return response({ success: true, order: fulfillment, history: [{ event_type: 'order_review', metadata: { note: '<img src=x onerror=alert(1)>' } }],
            reconciliation: url.includes('reconcile=1') ? { verified: true, checked_at: OPERATIONS_VERSION, snapshot: { provider_status: 'completed' } } : null });
    } }); await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    assert.match(contentText(ui.get('tgDetailContent')), /TG-ABCDEFGHIJKLMNOP/);
    await findButton(ui.get('tgDetailContent'), '查看履约详情 / 人工复核').trigger('click');
    await findButton(ui.get('tgDetailContent'), '查询上游状态').trigger('click');
    assert.match(contentText(ui.get('tgDetailContent')), /已完成/); assert.match(contentText(ui.get('tgDetailContent')), /<img src=x onerror=alert\(1\)>/);
    assert.equal(descendants(ui.get('tgDetailContent')).filter(item => item.tag === 'img').length, 0);
    assert.equal(businessCalls(ui).filter(call => call.request.method === 'POST').length, 0);
    assert.ok(findButton(ui.get('tgDetailContent'), '核验上游并同步结果'));
});

test('failed manual review preserves the reason and shows conflicts inside the open detail dialog', async () => {
    const detail = { ...PURCHASE_DETAIL, payment_status: 'manual_review', paid_at: OPERATIONS_VERSION, can_close: false };
    const ui = page({ purchases: [detail], fetch: (url, req) => {
        if (url.includes('/tg/purchases?order_no=')) return response({ success: true, order: detail, history: [] });
        if (url === '/api/admin/tg/purchases' && req.method === 'POST') return response({ success: false, message: '订单已发生变化，请刷新详情后再操作' }, 409);
    } }); await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    const root = ui.get('tgDetailContent'); const note = descendants(root).find(item => item.attributes.get('aria-label') === '处理原因'); note.value = '已核对到账与客户授权';
    assert.equal(findButton(root, '核准已到账款并发货'), undefined);
    assert.ok(findButton(root, '支付核对 / 补发审核'));
    await findButton(root, '保存核对记录').trigger('click');
    assert.equal(note.value, '已核对到账与客户授权'); assert.equal(note.disabled, false);
    assert.match(contentText(root), /订单已发生变化/); assert.equal(ui.get('tgDetailModal').open, true);
});

test('a completed write cannot reopen a detail dialog that the operator already closed', async () => {
    const wait = deferred();
    const ui = page({ purchases: [PURCHASE_DETAIL], fetch: (url, req) => {
        if (url.includes('/tg/purchases?order_no=')) return response({ success: true, order: PURCHASE_DETAIL, history: [] });
        if (url === '/api/admin/tg/purchases' && req.method === 'POST') return wait.promise;
    } }); await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    const root = ui.get('tgDetailContent'); descendants(root).find(item => item.tag === 'textarea').value = '记录核对结果';
    const saving = findButton(root, '保存核对记录').trigger('click'); await tick(); ui.get('tgDetailModal').close();
    wait.resolve(response({ success: true })); await saving; assert.equal(ui.get('tgDetailModal').open, false); assert.equal(root.children.length, 0);
});


test('a list refresh after a successful review cannot reopen a closed detail dialog', async () => {
    const wait = deferred(); let wrote = false; let detailReads = 0;
    const ui = page({ purchases: [PURCHASE_DETAIL], fetch: (url, req) => {
        if (url.includes('/tg/purchases?order_no=')) { detailReads += 1; return response({ success: true, order: PURCHASE_DETAIL, history: [] }); }
        if (url === '/api/admin/tg/purchases' && req.method === 'POST') { wrote = true; return response({ success: true }); }
        if (wrote && url.includes('/tg/purchases?page=')) return wait.promise;
    } }); await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    const root = ui.get('tgDetailContent'); descendants(root).find(item => item.tag === 'textarea').value = '记录核对结果';
    const saving = findButton(root, '保存核对记录').trigger('click'); await tick();
    assert.equal(wrote, true); ui.get('tgDetailModal').close();
    wait.resolve(response({ success: true, purchases: [PURCHASE_DETAIL], total: 1 })); await saving;
    assert.equal(ui.get('tgDetailModal').open, false); assert.equal(root.children.length, 0); assert.equal(detailReads, 1);
});

const REVIEW_ORDER = { order_no: 'TGP-ABCDEFGHIJKLMNOPQRST', username: 'recipient_test', product_family: 'telegram_stars', term_months: null, stars_quantity: 50,
    currency: 'CNY', total_minor: 707, subtotal_minor: 700, payment_fee_minor: 7, payment_fee_rate_bps: 100, price_version: 3, payment_channel: 'alipay',
    payment_status: 'manual_review', paid_at: '2026-10-16T10:14:31Z', fulfillment_status: 'not_started', created_at: '2026-10-16T09:00:00Z', updated_at: '2026-10-16T10:14:31.392691+00:00' };
function reviewData(order = REVIEW_ORDER, changes = {}) {
    return { success: true, order: { ...order }, fulfillment: null, reviews: [],
        review: { can_approve: true, ready: true, reason: 'payment_received_after_expiry', receipt_recorded_at: '2026-10-16T10:14:31Z',
            worker_enabled: true, message: '收款核对一致，确认未退款且未另行发货后可提交审核。' },
        payment_check: { status: 'confirmed', checked_at: '2026-10-16T10:30:00Z', amount_minor: 707, currency: 'CNY' }, ...changes };
}
const purchaseReviewButton = (ui, index = 0) => ({ async trigger(event) {
    await ui.get('tgPurchasesBody').children[index].children[8].children[0].trigger(event);
    await findButton(ui.get('tgDetailContent'), '支付核对 / 补发审核').trigger(event);
} });
function reviewPage(options = {}) {
    return page({ purchases: [REVIEW_ORDER], ...options, async fetch(url, request) {
        if (options.fetch) { const custom = await options.fetch(url, request); if (custom) return custom; }
        if (url.includes('/tg/purchases?order_no=')) {
            const orderNo = new URL(url, LOCAL_ADMIN_URL).searchParams.get('order_no');
            const order = (options.purchases || [REVIEW_ORDER]).find(item => item.order_no === orderNo);
            return response({ success: true, order: { ...order, can_close: false }, history: [] });
        }
        if (url.includes('/tg/purchases?orderNo=')) return response(reviewData());
        return null;
    } });
}
async function completeReview(ui) {
    ui.get('tgPurchaseReviewNote').value = '已在支付后台核对，无退款且未另行发货';
    await ui.get('tgPurchaseReviewNote').trigger('input');
    ui.get('tgPurchaseReviewNoRefund').checked = true; await ui.get('tgPurchaseReviewNoRefund').trigger('change');
    ui.get('tgPurchaseReviewNoDelivery').checked = true; await ui.get('tgPurchaseReviewNoDelivery').trigger('change');
}
function allText(root) { return [root.textContent || '', ...root.children.map(allText)].join(' '); }
const approvalCalls = (ui) => ui.calls.filter((c) => c.url === '/api/admin/tg/purchases' && c.request.method === 'POST');

test('purchase review dialog is explicit about real fulfillment and uses local styling', () => {
    assert.match(html, /id="tgPurchaseReviewModal"/);
    assert.match(html, /id="tgPurchaseReviewNote"[^>]*minlength="6"[^>]*maxlength="500"/);
    assert.match(html, /没有进行中的退款/); assert.match(html, /未另行发货/); assert.match(html, /worker 处理时会使用上游余额/);
    assert.doesNotMatch(script.slice(script.indexOf('function resetPurchaseReview'), script.indexOf('async function refresh')), /globalScope\.confirm|innerHTML|createPayment|createPurchase/);
});
test('purchase review opens read-only, shows receipt and recipient in separate fields, and requires both confirmations', async () => {
    const ui = reviewPage(); await ui.ready(); await purchaseReviewButton(ui).trigger('click');
    assert.equal(ui.get('tgPurchaseReviewModal').open, true); assert.equal(ui.get('tgPurchaseReviewForm').hidden, false);
    const content = allText(ui.get('tgPurchaseReviewContent'));
    assert.match(content, /@recipient_test/); assert.match(content, /Stars · 50 颗/); assert.match(content, /¥7\.07/);
    assert.match(content, /已确认足额收款/); assert.match(content, /不代表实际付款时间/);
    assert.equal(approvalCalls(ui).length, 0); assert.equal(ui.get('tgPurchaseReviewApprove').disabled, true);
    ui.get('tgPurchaseReviewNote').value = '核对'; await ui.get('tgPurchaseReviewNote').trigger('input');
    ui.get('tgPurchaseReviewNoRefund').checked = true; ui.get('tgPurchaseReviewNoDelivery').checked = true;
    await ui.get('tgPurchaseReviewNoDelivery').trigger('change'); assert.equal(ui.get('tgPurchaseReviewApprove').disabled, true);
    await completeReview(ui); assert.equal(ui.get('tgPurchaseReviewApprove').disabled, false);
    assert.equal(ui.get('tgPurchaseReviewApprove').textContent, '确认审核并补发 50 Stars');
    ui.get('tgPurchaseReviewNoRefund').checked = false; await ui.get('tgPurchaseReviewNoRefund').trigger('change');
    assert.equal(ui.get('tgPurchaseReviewApprove').disabled, true);
    await ui.get('tgPurchaseReviewForm').trigger('submit'); assert.equal(approvalCalls(ui).length, 0);
});
test('purchase approval sends immutable version once and stays in the same dialog while worker fulfillment is queued', async () => {
    const pending = deferred(); let approved = false;
    const paid = { ...REVIEW_ORDER, payment_status: 'paid', fulfillment_status: 'pending', updated_at: '2026-10-16T10:31:00Z' };
    const ui = reviewPage({ fetch: async (url, request) => {
        if (url === '/api/admin/tg/purchases' && request.method === 'POST') { await pending.promise; approved = true; return response({ success: true, existing: false, order: paid }); }
        if (url.includes('/tg/purchases?orderNo=') && approved) return response(reviewData(paid, {
            review: { can_approve: false, message: '已有发货任务', worker_enabled: true },
            fulfillment: { id: 'original-task', order_no: 'TG-ABCDEFGHIJKLMNOPQRST', status: 'pending', has_provider_order: false },
            reviews: [{ created_at: '2026-10-16T10:31:00Z', note: '已核对未退款，进入发货队列' }] }));
        return null;
    } });
    await ui.ready(); await purchaseReviewButton(ui).trigger('click'); await completeReview(ui);
    const submit = ui.get('tgPurchaseReviewForm').trigger('submit'); await tick();
    assert.equal(ui.get('tgPurchaseReviewApprove').disabled, true); assert.equal(ui.get('tgPurchaseReviewRecheck').disabled, true);
    await ui.get('tgPurchaseReviewForm').trigger('submit'); assert.equal(approvalCalls(ui).length, 1);
    const body = JSON.parse(approvalCalls(ui)[0].request.body);
    assert.deepEqual(body, { action: 'approve_fulfillment', order_no: REVIEW_ORDER.order_no, expected_updated_at: REVIEW_ORDER.updated_at,
        note: '已在支付后台核对，无退款且未另行发货', confirm_no_refund: true, confirm_no_delivery: true });
    assert.equal(ui.get('tgPurchaseReviewApprove').attributes.get('aria-busy'), 'true');
    pending.resolve(); await submit;
    assert.equal(ui.get('tgPurchaseReviewModal').open, true); assert.match(ui.get('tgPurchaseReviewMessage').textContent, /进入发货队列/);
    assert.doesNotMatch(ui.get('tgPurchaseReviewMessage').textContent, /已发货|发货成功/);
    assert.equal(ui.get('tgPurchaseReviewForm').hidden, true); assert.equal(ui.get('tgPurchaseReviewApprove').disabled, true);
    assert.match(allText(ui.get('tgPurchaseReviewContent')), /原发货单.*TG-ABCDEFGHIJKLMNOPQRST/);
    assert.match(allText(ui.get('tgPurchaseReviewContent')), /审核记录.*已核对未退款/);
    assert.equal(ui.get('tgPurchaseReviewRecheck').disabled, false);
    assert.ok(ui.calls.filter((c) => c.url.includes('/tg/purchases?page=')).length > 1);
});
test('idempotent approval response shows the existing task and completed state without claiming another shipment', async () => {
    const ui = reviewPage({ fetch: async (url, request) => url === '/api/admin/tg/purchases' && request.method === 'POST'
        ? response({ success: true, existing: true, order: { ...REVIEW_ORDER, payment_status: 'paid', fulfillment_status: 'succeeded' } }) : null });
    await ui.ready(); await purchaseReviewButton(ui).trigger('click'); await completeReview(ui); await ui.get('tgPurchaseReviewForm').trigger('submit');
    assert.match(ui.get('tgPurchaseReviewMessage').textContent, /原发货任务已完成.*没有重复补发/); assert.equal(approvalCalls(ui).length, 1);
    assert.equal(ui.get('tgPurchaseReviewApprove').disabled, true); assert.equal(ui.get('tgPurchaseReviewForm').hidden, true);
    // A stale follow-up GET must not overwrite the confirmed approval with the
    // pre-approval manual-review snapshot or show that delivery never started.
    const content = allText(ui.get('tgPurchaseReviewContent'));
    assert.match(content, /本地收款状态\s*已付款/); assert.match(content, /发货状态\s*已发货/);
    assert.doesNotMatch(content, /本地收款状态\s*人工核对|发货状态\s*尚未发货/);
});
for (const [name, status, code] of [['stale review', 409, 'review_stale'], ['service failure', 503, 'tg_service_error'], ['lost connection', 0, '']]) {
    test(`${name} preserves the original order and requires read-only recheck before any resubmission`, async () => {
        const ui = reviewPage({ fetch: async (url, request) => {
            if (url === '/api/admin/tg/purchases' && request.method === 'POST') {
                if (!status) throw new Error('network unavailable');
                return response({ success: false, code, message: '订单已发生变化' }, status);
            }
            return null;
        } });
        await ui.ready(); await purchaseReviewButton(ui).trigger('click'); await completeReview(ui); await ui.get('tgPurchaseReviewForm').trigger('submit');
        assert.equal(ui.get('tgPurchaseReviewModal').open, true); assert.match(allText(ui.get('tgPurchaseReviewContent')), /TGP-ABCDEFGHIJKLMNOPQRST/);
        assert.match(ui.get('tgPurchaseReviewMessage').textContent, /重新核对原订单/); assert.equal(ui.get('tgPurchaseReviewApprove').disabled, true);
        await ui.get('tgPurchaseReviewForm').trigger('submit'); assert.equal(approvalCalls(ui).length, 1);
        await ui.get('tgPurchaseReviewRecheck').trigger('click');
        assert.equal(ui.get('tgPurchaseReviewNoRefund').checked, false); assert.equal(ui.get('tgPurchaseReviewNoDelivery').checked, false);
        assert.equal(ui.get('tgPurchaseReviewApprove').disabled, true); assert.match(ui.get('tgPurchaseReviewNote').value, /已在支付后台核对/);
        await completeReview(ui); assert.equal(ui.get('tgPurchaseReviewApprove').disabled, false);
    });
}
for (const [code, message] of [['migration_required', '数据库迁移尚未生效'], ['fulfillment_exists', '已有发货任务'], ['payment_unconfirmed', '渠道暂时无法确认收款']]) {
    test(`blocked review ${code} has no approval form and leaves read-only recheck available`, async () => {
        const ui = reviewPage({ fetch: async (url) => url.includes('/tg/purchases?orderNo=')
            ? response(reviewData(REVIEW_ORDER, { review: { can_approve: false, blocked_code: code, message } })) : null });
        await ui.ready(); await purchaseReviewButton(ui).trigger('click');
        assert.equal(ui.get('tgPurchaseReviewForm').hidden, true); assert.equal(ui.get('tgPurchaseReviewApprove').disabled, true);
        assert.match(allText(ui.get('tgPurchaseReviewContent')), new RegExp(message)); assert.equal(ui.get('tgPurchaseReviewRecheck').disabled, false);
    });
}
test('a disabled API switch is scoped to the API and never presented as the remote worker state', async () => {
    const data = reviewData(); data.review.worker_enabled = false;
    const ui = reviewPage({ fetch: async (url) => url.includes('/tg/purchases?orderNo=') ? response(data) : null });
    await ui.ready(); await purchaseReviewButton(ui).trigger('click'); assert.match(allText(ui.get('tgPurchaseReviewContent')), /当前 API 的自动履约开关未开启/);
    assert.match(allText(ui.get('tgPurchaseReviewContent')), /不能据此判断独立 worker 是否运行/);
    assert.doesNotMatch(allText(ui.get('tgPurchaseReviewContent')), /待 worker 启用后处理/);
    assert.equal(approvalCalls(ui).length, 0);
});
test('closing or switching an order invalidates a late detail response', async () => {
    const pending = deferred(); const other = { ...REVIEW_ORDER, order_no: 'TGP-ZYXWVUTSRQPONMLKJIHG', username: 'other_user' };
    const ui = reviewPage({ purchases: [REVIEW_ORDER, other], fetch: async (url) => {
        if (url.includes(`orderNo=${REVIEW_ORDER.order_no}`)) { await pending.promise; return response(reviewData()); }
        if (url.includes(`orderNo=${other.order_no}`)) return response(reviewData(other));
        return null;
    } });
    await ui.ready(); const first = purchaseReviewButton(ui).trigger('click'); await tick();
    assert.equal(ui.get('tgPurchaseReviewApprove').disabled, true);
    await ui.get('tgPurchaseReviewClose').trigger('click'); assert.equal(ui.get('tgPurchaseReviewModal').open, false);
    await purchaseReviewButton(ui, 1).trigger('click'); pending.resolve(); await first;
    assert.match(allText(ui.get('tgPurchaseReviewContent')), /@other_user/); assert.doesNotMatch(allText(ui.get('tgPurchaseReviewContent')), /@recipient_test/);
    await completeReview(ui); assert.equal(ui.get('tgPurchaseReviewApprove').disabled, false);
});
test('closing a submitted review cannot let a late approval response overwrite another order', async () => {
    const pending = deferred(); const other = { ...REVIEW_ORDER, order_no: 'TGP-ZYXWVUTSRQPONMLKJIHG', username: 'other_user' };
    const ui = reviewPage({ purchases: [REVIEW_ORDER, other], fetch: async (url, request) => {
        if (url === '/api/admin/tg/purchases' && request.method === 'POST') { await pending.promise; return response({ success: true, existing: false, order: { ...REVIEW_ORDER, payment_status: 'paid', fulfillment_status: 'pending' } }); }
        if (url.includes(`orderNo=${other.order_no}`)) return response(reviewData(other));
        return null;
    } });
    await ui.ready(); await purchaseReviewButton(ui).trigger('click'); await completeReview(ui);
    const submit = ui.get('tgPurchaseReviewForm').trigger('submit'); await tick();
    await ui.get('tgPurchaseReviewClose').trigger('click'); await purchaseReviewButton(ui, 1).trigger('click');
    pending.resolve(); await submit;
    assert.match(allText(ui.get('tgPurchaseReviewContent')), /@other_user/); assert.equal(ui.get('tgPurchaseReviewMessage').textContent, '');
    assert.equal(ui.get('tgPurchaseReviewForm').hidden, false);
});
for (const status of [401, 403]) test(`review ${status} closes protected details and clears confirmation state`, async () => {
    const ui = reviewPage({ fetch: async (url, request) => url === '/api/admin/tg/purchases' && request.method === 'POST'
        ? response({ success: false, message: '登录已失效' }, status) : null });
    await ui.ready(); await purchaseReviewButton(ui).trigger('click'); await completeReview(ui); await ui.get('tgPurchaseReviewForm').trigger('submit');
    assert.equal(ui.get('tgPurchaseReviewModal').open, false); assert.equal(ui.get('tgAdminApp').hidden, true);
    assert.equal(ui.get('tgPurchaseReviewNote').value, ''); assert.equal(ui.get('tgPurchaseReviewNoRefund').checked, false);
    assert.equal(ui.get('tgPurchaseReviewApprove').disabled, true); assert.equal(ui.get('tgPurchaseReviewContent').children.length, 0);
});
test('logout clears an open review and a delayed GET cannot restore it', async () => {
    const pending = deferred(); const ui = reviewPage({ fetch: async (url) => {
        if (url.includes('/tg/purchases?orderNo=')) { await pending.promise; return response(reviewData()); } return null;
    } });
    await ui.ready(); const load = purchaseReviewButton(ui).trigger('click'); await tick(); await ui.get('tgAdminLogout').trigger('click');
    pending.resolve(); await load; assert.equal(ui.get('tgPurchaseReviewModal').open, false); assert.equal(ui.get('tgPurchaseReviewContent').children.length, 0);
    assert.equal(approvalCalls(ui).length, 0);
});
test('a malformed detail or approval response never leaves the approve action enabled', async () => {
    const ui = reviewPage({ fetch: async (url) => url.includes('/tg/purchases?orderNo=') ? response({ success: true, order: REVIEW_ORDER }) : null });
    await ui.ready(); await purchaseReviewButton(ui).trigger('click'); assert.match(ui.get('tgPurchaseReviewMessage').textContent, /审核信息未确认/);
    assert.equal(ui.get('tgPurchaseReviewApprove').disabled, true);
    const malformed = reviewPage({ fetch: async (url, request) => url === '/api/admin/tg/purchases' && request.method === 'POST'
        ? response({ success: true, existing: false, order: { ...REVIEW_ORDER, payment_status: 'paid', fulfillment_status: 'not_started' } }) : null });
    await malformed.ready(); await purchaseReviewButton(malformed).trigger('click'); await completeReview(malformed); await malformed.get('tgPurchaseReviewForm').trigger('submit');
    assert.match(malformed.get('tgPurchaseReviewMessage').textContent, /提交结果尚未确认/); assert.equal(malformed.get('tgPurchaseReviewApprove').disabled, true);
});

const FULFILLMENT_ID = 'f43af4e6-e5dd-4498-810d-944cd2a69a31';
const FULFILLMENT_ROW = { id: FULFILLMENT_ID, order_no: 'TG-ABCDEFGHIJKLMNOPQRST', status: 'manual_review', provider_order_id: null,
    telegram_username: 'recipient_test', product_family: 'telegram_stars', term_months: null, stars_quantity: 50,
    provider_payment_currency: 'usdt', submitted_at: '2026-10-16T11:01:33Z', last_error_code: 'gramix_http_error' };
function taskReviewData() {
    return reviewData({ ...REVIEW_ORDER, payment_status: 'paid', fulfillment_status: 'manual_review' }, {
        fulfillment: { id: FULFILLMENT_ID, order_no: FULFILLMENT_ROW.order_no, status: 'manual_review', has_provider_order: false },
        review: { can_approve: false, worker_enabled: false, worker_scope: 'current_api', message: '已有发货任务，请查看原任务及上游状态，不能再次创建。' }
    });
}
function descendantButton(root, label) {
    if (root.tag === 'button' && root.textContent === label) return root;
    for (const child of root.children) { const found = descendantButton(child, label); if (found) return found; }
    return null;
}
const upstreamData = (changes = {}) => ({ success: true, order: { ...FULFILLMENT_ROW }, reconciliation: {
    checked_at: '2026-10-16T11:30:00Z', status: 'not_found', verified: false, snapshot: null,
    message: '本次未查到与原任务提交标识匹配的上游订单；提交结果仍未确认，请勿重复补发。', search: { scanned: 0, exhausted: true }
}, ...changes });
const fulfillmentButton = (ui, index = 0) => ui.get('tgOrdersBody').children[index].children[5].children[0];
const REDEMPTION_VERSION = '2026-10-17T10:00:00.123456+00:00';
const redemptionResolutionData = (changes = {}) => upstreamData({
    ...changes,
    order: { ...FULFILLMENT_ROW, order_source: 'redemption', updated_at: REDEMPTION_VERSION, ...changes.order },
    resolution: { ready: true, can_link: true, can_record_nonacceptance: true, can_complete: true, can_release_code: true,
        expected_updated_at: REDEMPTION_VERSION, expected_code_updated_at: REDEMPTION_VERSION, code_status: 'fulfilling', records: [],
        message: '请选择与实际处理结果相符的方式。', ...changes.resolution }
});

test('an existing purchase task has an inline upstream query even without a saved provider order id', async () => {
    const ui = reviewPage({ fetch: async (url) => url.includes('/tg/purchases?orderNo=') ? response(taskReviewData())
        : url.includes(`/tg/orders?orderId=${FULFILLMENT_ID}`) ? response(upstreamData()) : null });
    await ui.ready(); await purchaseReviewButton(ui).trigger('click');
    const query = descendantButton(ui.get('tgPurchaseReviewContent'), '查询上游状态'); assert.ok(query);
    await query.trigger('click');
    const content = allText(ui.get('tgPurchaseReviewContent')); assert.match(content, /提交结果仍未确认/); assert.match(content, /gramix_http_error/); assert.match(content, /人工复核/);
    assert.equal(ui.get('tgPurchaseReviewModal').open, true); assert.equal(ui.get('tgDetailModal').open, false); assert.equal(ui.get('tgPurchaseReviewForm').hidden, true);
    assert.equal(approvalCalls(ui).length, 0); assert.equal(ui.calls.filter(c => c.url.includes('reconcile=1')).length, 1);
    assert.ok(ui.calls.filter(c => c.url.includes('reconcile=1')).every(c => !c.request.method || c.request.method === 'GET'));
});

test('an upstream query displays confirmed provider completion separately from local manual review', async () => {
    const ui = reviewPage({ fetch: async (url) => url.includes('/tg/purchases?orderNo=') ? response(taskReviewData())
        : url.includes('/tg/orders?orderId=') ? response(upstreamData({ reconciliation: { verified: true, status: 'verified', checked_at: '2026-10-16T11:30:00Z',
            message: '已核对上游订单身份、接收账号及商品权益。', snapshot: { provider_order_id: FULFILLMENT_ID, provider_status: 'completed' } } })) : null });
    await ui.ready(); await purchaseReviewButton(ui).trigger('click'); await descendantButton(ui.get('tgPurchaseReviewContent'), '查询上游状态').trigger('click');
    const content = allText(ui.get('tgPurchaseReviewContent')); assert.match(content, /已完成/); assert.match(content, /人工复核/); assert.match(content, /只读查询/);
    assert.equal(approvalCalls(ui).length, 0);
});

test('an unavailable upstream leaves the original task visible and the query retryable', async () => {
    const ui = reviewPage({ fetch: async (url) => url.includes('/tg/purchases?orderNo=') ? response(taskReviewData())
        : url.includes('/tg/orders?orderId=') ? response(upstreamData({ reconciliation: { verified: false, status: 'unavailable', checked_at: '2026-10-16T11:30:00Z', message: '上游查询暂不可用，请稍后重试；原发货任务已保留。' } })) : null });
    await ui.ready(); await purchaseReviewButton(ui).trigger('click'); const query = descendantButton(ui.get('tgPurchaseReviewContent'), '查询上游状态'); await query.trigger('click');
    assert.equal(query.disabled, false); assert.match(allText(ui.get('tgPurchaseReviewContent')), /原发货任务已保留/); assert.equal(approvalCalls(ui).length, 0);
});

test('a malformed upstream detail cannot display another task in the purchase dialog', async () => {
    const ui = reviewPage({ fetch: async (url) => url.includes('/tg/purchases?orderNo=') ? response(taskReviewData())
        : url.includes('/tg/orders?orderId=') ? response(upstreamData({ order: { ...FULFILLMENT_ROW, id: 'other-task-id', order_no: 'DO-NOT-DISPLAY' } })) : null });
    await ui.ready(); await purchaseReviewButton(ui).trigger('click'); await descendantButton(ui.get('tgPurchaseReviewContent'), '查询上游状态').trigger('click');
    assert.match(allText(ui.get('tgPurchaseReviewContent')), /查单结果未确认/); assert.doesNotMatch(allText(ui.get('tgPurchaseReviewContent')), /DO-NOT-DISPLAY/);
});

test('closing a purchase review invalidates a pending upstream result and suppresses duplicate clicks', async () => {
    const pending = deferred();
    const ui = reviewPage({ fetch: async (url) => url.includes('/tg/purchases?orderNo=') ? response(taskReviewData())
        : url.includes('/tg/orders?orderId=') ? (await pending.promise, response(upstreamData())) : null });
    await ui.ready(); await purchaseReviewButton(ui).trigger('click'); const query = descendantButton(ui.get('tgPurchaseReviewContent'), '查询上游状态');
    const waiting = query.trigger('click'); await tick(); await query.trigger('click'); assert.equal(ui.calls.filter(c => c.url.includes('reconcile=1')).length, 1);
    await ui.get('tgPurchaseReviewClose').trigger('click'); pending.resolve(); await waiting;
    assert.equal(ui.get('tgPurchaseReviewModal').open, false); assert.equal(ui.get('tgPurchaseReviewContent').children.length, 0);
});

test('fulfillment detail can query an uncertain submission without creating another purchase', async () => {
    const ui = page({ orders: [FULFILLMENT_ROW], fetch: async (url) => url.includes('/tg/orders?orderId=')
        ? response(upstreamData({ reconciliation: url.includes('reconcile=1') ? upstreamData().reconciliation : null })) : null });
    await ui.ready(); await fulfillmentButton(ui).trigger('click');
    const query = descendantButton(ui.get('tgDetailContent'), '查询上游状态'); assert.ok(query); await query.trigger('click');
    assert.match(allText(ui.get('tgDetailContent')), /未查到/); assert.equal(ui.get('tgDetailModal').open, true); assert.equal(approvalCalls(ui).length, 0);
});

test('redemption detail loads the same overview and upstream sections before enabling its actions', async () => {
    const pending = deferred();
    const ui = page({ orders: [FULFILLMENT_ROW], fetch: url => url.includes('/tg/orders?orderId=') ? pending.promise : null });
    await ui.ready(); const loading = fulfillmentButton(ui).trigger('click'); await tick();
    const dialog = ui.get('tgDetailModal'); const root = ui.get('tgDetailContent');
    const sections = () => descendants(root).filter(item => item.tag === 'section').map(item => item.attributes.get('aria-label'));
    assert.equal(dialog.open, true); assert.equal(dialog.classList.contains('tg-order-dialog'), true);
    assert.equal(root.attributes.get('aria-busy'), 'true');
    assert.deepEqual(sections(), ['订单概览', '上游核对', '订单处理', '核对记录']);
    assert.equal(descendants(root).filter(item => item.tag === 'dt').length, 9);
    assert.ok(descendants(root).some(item => item.attributes.get('role') === 'status'));
    assert.equal(descendants(root).filter(item => item.tag === 'button').length, 0, 'loading cannot offer order operations');
    pending.resolve(response(redemptionResolutionData({ reconciliation: null }))); await loading;
    assert.equal(root.attributes.get('aria-busy'), 'false');
    assert.deepEqual(sections(), ['订单概览', '上游核对', '订单处理', '核对记录', '处理记录']);
    assert.equal(dialog.classList.contains('tg-order-dialog'), true);
    assert.ok(findButton(root, '查询上游状态')); assert.ok(findButton(root, '保存核对记录'));
    assert.equal(approvalCalls(ui).length, 0);
});

test('a failed upstream detail query keeps its frame and retries the original read-only query', async () => {
    let attempts = 0;
    const ui = page({ orders: [FULFILLMENT_ROW], fetch: url => url.includes('/tg/orders?orderId=')
        ? url.includes('reconcile=1') && ++attempts === 1 ? response({ success: false }, 503) : response(upstreamData({ reconciliation: url.includes('reconcile=1') ? upstreamData().reconciliation : null })) : null });
    await ui.ready(); await fulfillmentButton(ui).trigger('click');
    await findButton(ui.get('tgDetailContent'), '查询上游状态').trigger('click');
    assert.equal(ui.get('tgDetailModal').open, true); assert.equal(ui.get('tgDetailModal').classList.contains('tg-order-dialog'), true);
    assert.equal(ui.get('tgDetailContent').attributes.get('aria-busy'), 'false');
    assert.match(allText(ui.get('tgDetailContent')), /服务暂不可用/);
    await findButton(ui.get('tgDetailContent'), '重试加载').trigger('click');
    assert.equal(attempts, 2); assert.equal(ui.get('tgDetailContent').attributes.get('aria-busy'), 'false');
    assert.match(allText(ui.get('tgDetailContent')), /未查到/); assert.equal(approvalCalls(ui).length, 0);
});

test('an older redemption response cannot clear the busy state or contents of a newer detail', async () => {
    const first = deferred(); const second = deferred();
    const other = { ...FULFILLMENT_ROW, id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', order_no: 'TG-ZYXWVUTSRQPONMLKJIHG' };
    const ui = page({ orders: [FULFILLMENT_ROW, other], fetch: url => url.includes(`/tg/orders?orderId=${FULFILLMENT_ID}`) ? first.promise : url.includes(`/tg/orders?orderId=${other.id}`) ? second.promise : null });
    await ui.ready(); const oldLoading = fulfillmentButton(ui).trigger('click'); await tick();
    const newLoading = fulfillmentButton(ui, 1).trigger('click'); await tick();
    first.resolve(response(upstreamData({ reconciliation: null }))); await oldLoading;
    assert.equal(ui.get('tgDetailContent').attributes.get('aria-busy'), 'true');
    assert.doesNotMatch(allText(ui.get('tgDetailContent')), new RegExp(FULFILLMENT_ROW.order_no));
    second.resolve(response({ success: true, order: other, history: [] })); await newLoading;
    assert.equal(ui.get('tgDetailContent').attributes.get('aria-busy'), 'false');
    assert.match(allText(ui.get('tgDetailContent')), new RegExp(other.order_no));
});

test('a pending task detail query cannot reopen its dialog after close or logout', async () => {
    for (const action of ['tgDetailClose', 'tgAdminLogout']) {
        const pending = deferred(); const ui = page({ orders: [FULFILLMENT_ROW], fetch: async (url) => url.includes('/tg/orders?orderId=') ? (await pending.promise, response(upstreamData())) : null });
        await ui.ready(); const waiting = fulfillmentButton(ui).trigger('click'); await tick(); assert.equal(ui.get('tgDetailModal').open, true);
        await ui.get(action).trigger('click'); pending.resolve(); await waiting;
        assert.equal(ui.get('tgDetailModal').open, false); assert.equal(ui.get('tgDetailContent').children.length, 0);
    }
});

test('a late fulfillment detail cannot overwrite a newer selected task', async () => {
    const pending = deferred(); const other = { ...FULFILLMENT_ROW, id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', order_no: 'TG-ZYXWVUTSRQPONMLKJIHG' };
    const ui = page({ orders: [FULFILLMENT_ROW, other], fetch: async (url) => url.includes(`/tg/orders?orderId=${FULFILLMENT_ID}`) ? (await pending.promise, response(upstreamData()))
        : url.includes(`/tg/orders?orderId=${other.id}`) ? response({ success: true, order: other, reconciliation: null }) : null });
    await ui.ready(); const waiting = fulfillmentButton(ui).trigger('click'); await tick(); await fulfillmentButton(ui, 1).trigger('click'); pending.resolve(); await waiting;
    assert.match(allText(ui.get('tgDetailContent')), /TG-ZYXWVUTSRQPONMLKJIHG/); assert.doesNotMatch(allText(ui.get('tgDetailContent')), /TG-ABCDEFGHIJKLMNOPQRST/);
});


test('upstream diagnostics show missing historical details separately from the current zero balance', async () => {
    const { recordedErrorDiagnostic } = require('../server/tg/gramix-errors');
    const data = upstreamData(); data.reconciliation.diagnostics = {
        recorded_error: recordedErrorDiagnostic(FULFILLMENT_ROW),
        balance: { status: 'available', checked_at: '2026-10-16T11:40:00Z', balances: { usdt: '0.0000', gram: '0.0000' },
            payment_currency: 'usdt', payment_balance_zero: true, message: '当前上游 USDT 余额为 0；此结果不能代替原提交的错误或扣款记录。' }
    };
    const ui = reviewPage({ fetch: async (url) => url.includes('/tg/purchases?orderNo=') ? response(taskReviewData())
        : url.includes('/tg/orders?orderId=') ? response(data) : null });
    await ui.ready(); await purchaseReviewButton(ui).trigger('click');
    await descendantButton(ui.get('tgPurchaseReviewContent'), '查询上游状态').trigger('click');
    const content = allText(ui.get('tgPurchaseReviewContent'));
    assert.match(content, /具体 HTTP 状态和上游原因未留存/); assert.match(content, /当前上游 USDT 余额/);
    assert.match(content, /0\.0000/); assert.match(content, /不能代替原提交/); assert.doesNotMatch(content, /Insufficient balance/);
    assert.equal(approvalCalls(ui).length, 0); assert.equal(ui.get('tgPurchaseReviewForm').hidden, true);
});

test('recorded provider rejection and a current query error display their own HTTP states and actions', async () => {
    const { recordedErrorDiagnostic, describeGramixError } = require('../server/tg/gramix-errors');
    const data = upstreamData(); data.reconciliation.http_status = 401;
    data.reconciliation.error = describeGramixError({ code: 'gramix_http_error', statusCode: 401, providerReason: 'unauthorized' });
    data.reconciliation.diagnostics = { recorded_error: recordedErrorDiagnostic({
        last_error_code: 'gramix_insufficient_balance', last_error_message: '[HTTP 403] 上游余额不足' }), balance: null };
    const ui = reviewPage({ fetch: async (url) => url.includes('/tg/purchases?orderNo=') ? response(taskReviewData())
        : url.includes('/tg/orders?orderId=') ? response(data) : null });
    await ui.ready(); await purchaseReviewButton(ui).trigger('click');
    await descendantButton(ui.get('tgPurchaseReviewContent'), '查询上游状态').trigger('click');
    const content = allText(ui.get('tgPurchaseReviewContent'));
    assert.match(content, /原任务异常原因/); assert.match(content, /HTTP 403.*上游余额不足/);
    assert.match(content, /原异常 HTTP 状态/); assert.match(content, /本次查单错误/); assert.match(content, /HTTP 401.*身份验证失败/);
    assert.match(content, /处理建议/); assert.equal(approvalCalls(ui).length, 0);
});


test('a domain-specific task error keeps its existing explanation when no Gramix diagnostic applies', async () => {
    const { recordedErrorDiagnostic } = require('../server/tg/gramix-errors');
    const data = upstreamData({ order: { ...FULFILLMENT_ROW, last_error_code: 'tg_payment_currency_unconfirmed',
        last_error_message: '历史订单扣款币种未确认，等待人工核查' } });
    data.reconciliation.diagnostics = { recorded_error: recordedErrorDiagnostic(data.order), balance: null };
    assert.equal(data.reconciliation.diagnostics.recorded_error, null);
    const ui = reviewPage({ fetch: async (url) => url.includes('/tg/purchases?orderNo=') ? response(taskReviewData())
        : url.includes('/tg/orders?orderId=') ? response(data) : null });
    await ui.ready(); await purchaseReviewButton(ui).trigger('click');
    await descendantButton(ui.get('tgPurchaseReviewContent'), '查询上游状态').trigger('click');
    assert.match(allText(ui.get('tgPurchaseReviewContent')), /历史订单扣款币种未确认，等待人工核查/);
    assert.equal(approvalCalls(ui).length, 0);
});

const SECTION_STORAGE_KEY = 'tg-admin-section-v1';
const ADMIN_SECTIONS = ['Dashboard', 'Purchases', 'Orders', 'Codes', 'Products', 'Provider'];
const ADMIN_QUERY_EMAIL = 'customer@example.test';
const adminSearchCalls = ui => ui.calls.filter(call => call.url === '/api/admin/tg/order-query');
function adminSearchResponse(body = {}, request = {}) {
    const input = request.body ? JSON.parse(request.body) : {};
    return response({ success: true, kind: input.kind || 'purchase', orders: [REVIEW_ORDER], total: 1, page: input.page || 1, page_size: 20, ...body });
}
function fillAdminSearch(ui, mode = 'email', value = ADMIN_QUERY_EMAIL) {
    ui.get('tgAdminQuerySearchBy').value = mode;
    ui.get('tgAdminQueryValue').value = value;
}
function assertOnlyAdminSection(ui, section) {
    for (const name of ADMIN_SECTIONS) {
        assert.equal(ui.get('tgAdminPanel' + name).hidden, name !== section, name);
        assert.equal(ui.get('tgAdminTab' + name).attributes.get('aria-selected'), String(name === section));
        assert.equal(ui.get('tgAdminTab' + name).attributes.get('tabindex'), name === section ? '0' : '-1');
    }
}

test('admin navigation separates all seven functions and restores the selected section across reloads', async () => {
    const storage = new Map(); const ui = page({ storage }); await ui.ready();
    assertOnlyAdminSection(ui, 'Dashboard');
    assert.equal(adminSearchCalls(ui).length, 0, 'opening the search section does not submit a query');
    for (const name of ADMIN_SECTIONS) {
        await ui.get('tgAdminTab' + name).trigger('click'); assertOnlyAdminSection(ui, name);
        assert.equal(storage.get(SECTION_STORAGE_KEY), name);
    }
    const reloaded = page({ storage }); await reloaded.ready(); assertOnlyAdminSection(reloaded, 'Provider');
    const invalid = page({ storage: new Map([[SECTION_STORAGE_KEY, 'RemovedSection']]) }); await invalid.ready(); assertOnlyAdminSection(invalid, 'Dashboard');
});

test('admin function navigation supports arrow keys, wrapping, Home and End without reloading data', async () => {
    const ui = page(); await ui.ready(); const count = ui.calls.length;
    for (const [from, key, to] of [['Dashboard', 'ArrowLeft', 'Provider'], ['Provider', 'ArrowRight', 'Dashboard'], ['Dashboard', 'End', 'Provider'], ['Provider', 'Home', 'Dashboard'], ['Dashboard', 'ArrowDown', 'Query'], ['Query', 'ArrowRight', 'Purchases'], ['Purchases', 'ArrowUp', 'Query'], ['Query', 'ArrowDown', 'Purchases']]) {
        await ui.get('tgAdminTab' + from).trigger('keydown', { key }); assertOnlyAdminSection(ui, to); assert.equal(ui.get('tgAdminTab' + to).focused, true);
    }
    assert.equal(ui.calls.length, count);
});

test('desktop navigation starts as an icon rail and keeps module state without persisting a wide sidebar', async () => {
    const storage = new Map([['tg-admin-nav-collapsed-v1', 'false']]);
    const ui = page({ storage }); await ui.ready(); const count = ui.calls.length;
    assert.equal(ui.get('tgAdminNavToggle').hidden, false);
    assert.equal(ui.get('tgAdminNavToggle').attributes.get('aria-expanded'), 'false');
    assert.equal(ui.get('tgAdminApp').classList.contains('is-nav-expanded'), false);
    assert.equal(ui.get('tgAdminSidebar').inert, false, 'icon navigation remains usable');
    await ui.get('tgAdminNavClose').trigger('click');
    assert.equal(ui.get('tgAdminApp').classList.contains('is-nav-expanded'), true);
    assert.equal(ui.get('tgAdminNavBackdrop').hidden, true, 'desktop expansion leaves the workspace available');
    assert.equal(ui.get('tgAdminWorkspace').inert, false);
    await ui.get('tgAdminTabPurchases').trigger('click');
    assertOnlyAdminSection(ui, 'Purchases');
    assert.equal(ui.get('tgAdminApp').classList.contains('is-nav-expanded'), false);
    assert.equal(ui.calls.length, count);
    await ui.get('tgAdminNavClose').trigger('click');
    const reloaded = page({ storage }); await reloaded.ready();
    assertOnlyAdminSection(reloaded, 'Purchases');
    assert.equal(reloaded.get('tgAdminApp').classList.contains('is-nav-expanded'), false);
});

test('rail reveals labels on mouse hover and keyboard focus and collapses on leave or Escape', async () => {
    const ui = page(); await ui.ready(); const sidebar = ui.get('tgAdminSidebar');
    await sidebar.trigger('pointerenter', { pointerType: 'touch' });
    assert.equal(ui.get('tgAdminApp').classList.contains('is-nav-expanded'), false);
    await sidebar.trigger('pointerenter', { pointerType: 'mouse' });
    assert.equal(ui.get('tgAdminNavClose').attributes.get('aria-expanded'), 'true');
    await sidebar.trigger('pointerleave');
    assert.equal(ui.get('tgAdminApp').classList.contains('is-nav-expanded'), false);
    await sidebar.trigger('focusin', { target: { matches: () => false } });
    assert.equal(ui.get('tgAdminApp').classList.contains('is-nav-expanded'), false, 'mouse clicks do not pin labels open');
    await sidebar.trigger('focusin', { target: { matches: () => true } });
    assert.equal(ui.get('tgAdminApp').classList.contains('is-nav-expanded'), true);
    await sidebar.trigger('focusout', { relatedTarget: ui.get('tgAdminTabQuery') });
    assert.equal(ui.get('tgAdminApp').classList.contains('is-nav-expanded'), true);
    await sidebar.trigger('focusout', { relatedTarget: ui.get('tgAdminRefresh') });
    assert.equal(ui.get('tgAdminApp').classList.contains('is-nav-expanded'), false);
    await ui.get('tgAdminTabQuery').trigger('keydown', { key: 'ArrowDown' });
    assertOnlyAdminSection(ui, 'Purchases');
    assert.equal(ui.get('tgAdminApp').classList.contains('is-nav-expanded'), true);
    ui.events.get('keydown')({ key: 'Escape', preventDefault() {} });
    assert.equal(ui.get('tgAdminApp').classList.contains('is-nav-expanded'), false);
    assert.equal(ui.get('tgAdminSidebar').inert, false);
});

test('compact drawer opens on the current module, traps focus and supports Escape and backdrop dismissal', async () => {
    const ui = page({ compact: true }); await ui.ready();
    assert.equal(ui.get('tgAdminSidebar').inert, true);
    assert.equal(ui.get('tgAdminNavBackdrop').hidden, true);
    assert.equal(ui.get('tgAdminNavToggle').attributes.get('aria-expanded'), 'false');
    await ui.get('tgAdminNavToggle').trigger('click');
    assert.equal(ui.get('tgAdminApp').classList.contains('is-nav-open'), true);
    assert.equal(ui.get('tgAdminSidebar').attributes.get('aria-modal'), 'true');
    assert.equal(ui.get('tgAdminSidebar').attributes.get('role'), 'dialog');
    assert.equal(ui.get('tgAdminNavBackdrop').hidden, false);
    assert.equal(ui.get('tgAdminWorkspace').inert, true);
    assert.equal(ui.get('tgAdminHeader').inert, true);
    assert.equal(ui.window.document.body.classList.contains('tg-admin-drawer-open'), true);
    assert.equal(ui.window.document.activeElement, ui.get('tgAdminTabDashboard'));
    ui.events.get('keydown')({ key: 'Tab', preventDefault() {} });
    assert.equal(ui.window.document.activeElement, ui.get('tgAdminNavClose'));
    ui.events.get('keydown')({ key: 'Tab', shiftKey: true, preventDefault() {} });
    assert.equal(ui.window.document.activeElement, ui.get('tgAdminTabDashboard'));
    ui.events.get('keydown')({ key: 'Escape', preventDefault() {} });
    assert.equal(ui.window.document.activeElement, ui.get('tgAdminNavToggle'));
    assert.equal(ui.get('tgAdminNavBackdrop').hidden, true);
    assert.equal(ui.get('tgAdminWorkspace').inert, false);
    assert.equal(ui.window.document.body.classList.contains('tg-admin-drawer-open'), false);
    await ui.get('tgAdminNavToggle').trigger('click'); await ui.get('tgAdminNavBackdrop').trigger('click');
    assert.equal(ui.get('tgAdminNavToggle').attributes.get('aria-expanded'), 'false');
    assert.equal(ui.window.document.activeElement, ui.get('tgAdminNavToggle'));
    await ui.get('tgAdminNavToggle').trigger('click'); await ui.get('tgAdminNavClose').trigger('click');
    assert.equal(ui.get('tgAdminNavBackdrop').hidden, true);
});

test('drawer module selection preserves filters and draft forms, closes the drawer and focuses content', async () => {
    const ui = page({ compact: true }); await ui.ready(); const count = ui.calls.length;
    ui.get('tgAdminQueryValue').value = 'saved search';
    ui.get('tgPurchaseFilter').value = 'manual_review';
    ui.get('tgGenerateForm').entries.name = 'unsaved batch';
    for (const name of ['Purchases', 'Orders', 'Codes', 'Products', 'Provider', 'Query']) {
        await ui.get('tgAdminNavToggle').trigger('click'); await ui.get('tgAdminTab' + name).trigger('click');
        assertOnlyAdminSection(ui, name);
        assert.equal(ui.get('tgAdminNavBackdrop').hidden, true);
        assert.equal(ui.window.document.activeElement, ui.get('tgAdminPanel' + name));
        assert.equal(ui.get('tgAdminWorkspace').inert, false);
    }
    assert.equal(ui.get('tgAdminQueryValue').value, 'saved search');
    assert.equal(ui.get('tgPurchaseFilter').value, 'manual_review');
    assert.equal(ui.get('tgGenerateForm').entries.name, 'unsaved batch');
    assert.equal(ui.calls.length, count);
});

test('crossing the drawer breakpoint releases locks and returns to the narrow icon rail', async () => {
    const ui = page(); await ui.ready(); await ui.get('tgAdminNavClose').trigger('click');
    ui.get('tgAdminTabQuery').focus(); ui.setCompact(true);
    assert.equal(ui.window.document.activeElement, ui.get('tgAdminNavToggle'));
    assert.equal(ui.get('tgAdminSidebar').inert, true);
    await ui.get('tgAdminNavToggle').trigger('click'); ui.setCompact(false);
    assert.equal(ui.get('tgAdminSidebar').inert, false);
    assert.equal(ui.get('tgAdminSidebar').attributes.has('aria-modal'), false);
    assert.equal(ui.get('tgAdminNavBackdrop').hidden, true);
    assert.equal(ui.get('tgAdminHeader').inert, false);
    assert.equal(ui.window.document.body.classList.contains('tg-admin-drawer-open'), false);
    assert.equal(ui.get('tgAdminApp').classList.contains('is-nav-expanded'), false);
    ui.setCompact(true);
    assert.equal(ui.get('tgAdminNavToggle').attributes.get('aria-expanded'), 'false');
});

test('logout and expired sessions close the drawer and anonymous users cannot reopen it', async () => {
    for (const expiry of [false, true]) {
        let expired = false;
        const ui = page({ compact: true, fetch: async url => expired && url.includes('/api/admin/tg/') ? response({ success: false }, 401) : null });
        await ui.ready(); await ui.get('tgAdminNavToggle').trigger('click');
        if (expiry) { expired = true; await ui.get('tgAdminRefresh').trigger('click'); }
        else await ui.get('tgAdminLogout').trigger('click');
        assert.equal(ui.get('tgAdminNavToggle').hidden, true);
        assert.equal(ui.get('tgAdminNavBackdrop').hidden, true);
        assert.equal(ui.get('tgAdminSidebar').inert, true);
        assert.equal(ui.get('tgAdminHeader').inert, false);
        assert.equal(ui.window.document.body.classList.contains('tg-admin-drawer-open'), false);
        await ui.get('tgAdminNavToggle').trigger('click');
        assert.equal(ui.get('tgAdminApp').classList.contains('is-nav-open'), false);
    }
});

test('anonymous and unauthorized users cannot use section navigation or start an admin query', async () => {
    for (const options of [{ signedIn: false }, { isSuperAdmin: false }]) {
        const ui = page(options); await ui.ready(); fillAdminSearch(ui);
        await ui.get('tgAdminTabProducts').trigger('click'); await ui.get('tgAdminTabProducts').trigger('keydown', { key: 'End' });
        await ui.get('tgAdminQueryForm').trigger('submit');
        assert.equal(ui.get('tgAdminApp').hidden, true); assert.equal(businessCalls(ui).length, 0); assert.ok(!ui.storage.has(SECTION_STORAGE_KEY));
    }
});

test('admin order search submits a private POST and renders purchase states as literal card text', async () => {
    const literal = '<img src=x onerror=alert(1)>';
    const ui = page({ fetch: async (url, request) => url === '/api/admin/tg/order-query' ? adminSearchResponse({ orders: [{ ...REVIEW_ORDER, username: literal }] }, request) : null });
    await ui.ready(); fillAdminSearch(ui); await ui.get('tgAdminQueryForm').trigger('submit');
    const call = adminSearchCalls(ui)[0]; assert.equal(call.request.method, 'POST'); assert.equal(call.request.headers['Content-Type'], 'application/json');
    assert.equal(call.request.credentials, 'same-origin'); assert.equal(call.request.cache, 'no-store');
    assert.deepEqual(JSON.parse(call.request.body), { kind: 'purchase', search_by: 'email', query: ADMIN_QUERY_EMAIL, page: 1 });
    assert.equal(ui.get('tgAdminQueryResults').hidden, false); assert.equal(ui.get('tgAdminQueryCount').textContent, '共 1 笔订单');
    const content = allText(ui.get('tgAdminQueryList'));
    for (const text of [REVIEW_ORDER.order_no, literal, 'Stars · 50 颗', '人工核对', '尚未发货', '¥7.07', '支付宝']) assert.ok(content.includes(text), text);
    assert.ok(ui.calls.every(call => !call.url.includes(ADMIN_QUERY_EMAIL)));
    assert.ok(!JSON.stringify([...ui.storage]).includes(ADMIN_QUERY_EMAIL));
    assert.doesNotMatch(html, /id="tgAdminQuery(?:Password|PasswordConfirm)"/);
});

test('admin search paginates twenty orders and refresh keeps the current query page', async () => {
    const ui = page({ fetch: async (url, request) => url === '/api/admin/tg/order-query' ? adminSearchResponse({ total: 21 }, request) : null });
    await ui.ready(); fillAdminSearch(ui); await ui.get('tgAdminQueryForm').trigger('submit');
    assert.match(allText(ui.get('tgAdminQueryPager')), /第 1 \/ 2 页/);
    assert.equal(descendantButton(ui.get('tgAdminQueryPager'), '上一页').disabled, true);
    await descendantButton(ui.get('tgAdminQueryPager'), '下一页').trigger('click');
    assert.deepEqual(adminSearchCalls(ui).map(call => JSON.parse(call.request.body).page), [1, 2]);
    assert.match(allText(ui.get('tgAdminQueryPager')), /第 2 \/ 2 页/);
    assert.equal(descendantButton(ui.get('tgAdminQueryPager'), '下一页').disabled, true);
    await ui.get('tgAdminRefresh').trigger('click');
    assert.deepEqual(adminSearchCalls(ui).map(call => JSON.parse(call.request.body).page), [1, 2, 2]);
});

test('admin search switching order type ignores a late purchase result and retains the query input', async () => {
    const pending = deferred();
    const ui = page({ fetch: async (url, request) => url === '/api/admin/tg/order-query'
        ? JSON.parse(request.body).kind === 'purchase' ? pending.promise : adminSearchResponse({ orders: [{ ...FULFILLMENT_ROW, status: 'succeeded' }] }, request) : null });
    await ui.ready(); fillAdminSearch(ui); const first = ui.get('tgAdminQueryForm').trigger('submit'); await ui.ready();
    assert.equal(ui.get('tgAdminQuerySubmit').disabled, true);
    await ui.get('tgAdminQueryRedeem').trigger('click');
    assert.equal(ui.get('tgAdminQueryValue').value, ADMIN_QUERY_EMAIL); assert.equal(ui.get('tgAdminQuerySubmit').disabled, false);
    assert.equal(ui.get('tgAdminQueryPurchase').attributes.get('aria-selected'), 'false');
    assert.equal(ui.get('tgAdminQueryRedeem').attributes.get('aria-selected'), 'true');
    await ui.get('tgAdminQueryForm').trigger('submit');
    assert.match(allText(ui.get('tgAdminQueryList')), /兑换码订单/);
    pending.resolve(adminSearchResponse()); await first;
    assert.equal(ui.get('tgAdminQueryTitle').textContent, '兑换订单');
    assert.doesNotMatch(allText(ui.get('tgAdminQueryList')), /TGP-/);
    await ui.get('tgAdminQueryRedeem').trigger('keydown', { key: 'Home' });
    assert.equal(ui.get('tgAdminQueryPurchase').focused, true); assert.equal(ui.get('tgAdminQueryResults').hidden, true);
});

for (const action of ['input', 'method', 'clear', 'logout']) test(`admin ${action} invalidates pending search responses and detached result actions`, async () => {
    const options = { fetch: async (url, request) => url === '/api/admin/tg/order-query' ? adminSearchResponse({ total: 21 }, request) : null };
    const ui = page(options); await ui.ready(); fillAdminSearch(ui); await ui.get('tgAdminQueryForm').trigger('submit');
    const oldCard = descendantButton(ui.get('tgAdminQueryList'), '审核补发');
    const oldPage = descendantButton(ui.get('tgAdminQueryPager'), '下一页');
    const pending = deferred(); options.fetch = async url => url === '/api/admin/tg/order-query' ? pending.promise : null;
    const loading = ui.get('tgAdminQueryForm').trigger('submit'); await ui.ready();
    if (action === 'input') { ui.get('tgAdminQueryValue').value = 'other@example.test'; await ui.get('tgAdminQueryValue').trigger('input'); }
    else if (action === 'method') { ui.get('tgAdminQuerySearchBy').value = 'order_no'; await ui.get('tgAdminQuerySearchBy').trigger('change'); }
    else await ui.get(action === 'clear' ? 'tgAdminQueryClear' : 'tgAdminLogout').trigger('click');
    const count = ui.calls.length; await oldCard.trigger('click'); await oldPage.trigger('click');
    assert.equal(ui.calls.length, count, 'detached controls must not inspect or query another order');
    pending.resolve(adminSearchResponse()); await loading;
    assert.equal(ui.get('tgAdminQueryResults').hidden, true); assert.equal(ui.get('tgAdminQueryList').children.length, 0);
    assert.equal(ui.get('tgAdminQuerySubmit').disabled, false);
    if (action !== 'input') assert.equal(ui.get('tgAdminQueryValue').value, '');
});

test('admin changing search method updates the field prompt and handles empty queries without a request', async () => {
    const ui = page(); await ui.ready();
    for (const [value, label, inputmode] of [['order_no', '订单号', 'text'], ['username', 'Telegram 用户名', 'text'], ['email', '查询邮箱', 'email']]) {
        ui.get('tgAdminQuerySearchBy').value = value; await ui.get('tgAdminQuerySearchBy').trigger('change');
        assert.equal(ui.get('tgAdminQueryLabel').textContent, label); assert.equal(ui.get('tgAdminQueryValue').attributes.get('inputmode'), inputmode);
    }
    await ui.get('tgAdminQueryForm').trigger('submit'); assert.equal(adminSearchCalls(ui).length, 0); assert.equal(ui.get('tgAdminQueryValue').focused, true);
});

test('admin crypto order card displays native USDT and empty results have a useful fallback', async () => {
    const options = { fetch: async (url, request) => url === '/api/admin/tg/order-query' ? adminSearchResponse({ orders: [{ ...REVIEW_ORDER, payment_channel: 'usdt_bep20', crypto_pay_amount: '1.0101', crypto_network: 'TRON (TRC20)' }] }, request) : null };
    const ui = page(options); await ui.ready(); fillAdminSearch(ui); await ui.get('tgAdminQueryForm').trigger('submit');
    assert.match(allText(ui.get('tgAdminQueryList')), /1\.0101 USDT/); assert.match(allText(ui.get('tgAdminQueryList')), /TRON/);
    assert.doesNotMatch(allText(ui.get('tgAdminQueryList')), /¥7\.07/);
    options.fetch = async (url, request) => url === '/api/admin/tg/order-query' ? adminSearchResponse({ orders: [], total: 0 }, request) : null;
    await ui.get('tgAdminQueryForm').trigger('submit'); assert.equal(ui.get('tgAdminQueryResults').hidden, false);
    assert.match(allText(ui.get('tgAdminQueryList')), /没有找到.*订单.*未绑定查询邮箱/);
});

test('admin USDT search cards identify missing historical amounts without directing users to an empty detail', async () => {
    let order;
    const ui = page({ fetch: async (url, request) => url === '/api/admin/tg/order-query' ? adminSearchResponse({ orders: [order] }, request) : null });
    await ui.ready(); fillAdminSearch(ui);
    for (const state of [
        { payment_status: 'manual_review', fulfillment_status: 'closed', closed_at: '2026-10-17T11:11:17.131Z' },
        { payment_status: 'pending', fulfillment_status: 'closed', closed_at: '2026-10-17T11:11:17.131Z' },
        { payment_status: 'manual_review', fulfillment_status: 'not_started' },
        { payment_status: 'paid', fulfillment_status: 'succeeded' },
        { payment_status: 'expired', fulfillment_status: 'not_started' },
        { payment_status: 'cancelled', fulfillment_status: 'not_started' }
    ]) {
        order = { ...REVIEW_ORDER, payment_channel: 'usdt_bep20', ...state };
        await ui.get('tgAdminQueryForm').trigger('submit');
        assert.match(allText(ui.get('tgAdminQueryList')), /未记录 USDT 金额/);
        assert.doesNotMatch(allText(ui.get('tgAdminQueryList')), /USDT 金额见详情|7\.07 USDT/);
    }
    order = { ...REVIEW_ORDER, payment_channel: 'usdt_bep20', payment_status: 'pending', fulfillment_status: 'not_started' };
    await ui.get('tgAdminQueryForm').trigger('submit');
    assert.match(allText(ui.get('tgAdminQueryList')), /USDT 金额见详情/);
    order = { ...order, fulfillment_status: 'closed', closed_at: '2026-10-17T11:11:17.131Z', crypto_pay_amount: '1.0101', crypto_network: 'TON' };
    await ui.get('tgAdminQueryForm').trigger('submit');
    assert.match(allText(ui.get('tgAdminQueryList')), /1\.0101 USDT/);
    assert.doesNotMatch(allText(ui.get('tgAdminQueryList')), /未记录 USDT 金额/);
});

test('admin search result actions open the existing purchase review and redemption upstream details', async () => {
    const ui = page({ fetch: async (url, request) => {
        if (url === '/api/admin/tg/order-query') return adminSearchResponse({ orders: [JSON.parse(request.body).kind === 'purchase' ? REVIEW_ORDER : FULFILLMENT_ROW] }, request);
        if (url.startsWith('/api/admin/tg/purchases?orderNo=')) return response(reviewData());
        if (url.startsWith('/api/admin/tg/orders?orderId=')) return response(upstreamData());
        return null;
    } });
    await ui.ready(); fillAdminSearch(ui); await ui.get('tgAdminQueryForm').trigger('submit');
    await descendantButton(ui.get('tgAdminQueryList'), '审核补发').trigger('click');
    assert.equal(ui.get('tgPurchaseReviewModal').open, true); assert.match(allText(ui.get('tgPurchaseReviewContent')), /recipient_test/);
    assert.equal(approvalCalls(ui).length, 0, 'opening search details must not submit fulfillment');
    await ui.get('tgPurchaseReviewClose').trigger('click'); await ui.get('tgAdminQueryRedeem').trigger('click'); await ui.get('tgAdminQueryForm').trigger('submit');
    await descendantButton(ui.get('tgAdminQueryList'), '详情 / 对账').trigger('click');
    assert.equal(ui.get('tgDetailModal').open, true); assert.ok(ui.calls.some(call => call.url.includes(`orderId=${FULFILLMENT_ID}`)));
});

test('admin order query displays migration guidance, rejects malformed success data and allows retry', async () => {
    const options = {}; const ui = page(options); await ui.ready(); fillAdminSearch(ui);
    for (const data of [response({ success: false, code: 'order_query_migration_required', message: 'upgrade' }, 503),
        adminSearchResponse({ kind: 'redeem' }), adminSearchResponse({ page_size: 25 }), adminSearchResponse({ total: '1' }), adminSearchResponse({ orders: {} })]) {
        options.fetch = async url => url === '/api/admin/tg/order-query' ? data : null;
        await ui.get('tgAdminQueryForm').trigger('submit');
        assert.equal(ui.get('tgAdminQueryResults').hidden, true); assert.equal(ui.get('tgAdminQuerySubmit').disabled, false);
        assert.match(ui.get('tgAdminQueryMessage').textContent, /数据库升级.*订单号.*用户名|查询结果尚未确认/);
    }
    options.fetch = async (url, request) => url === '/api/admin/tg/order-query' ? adminSearchResponse({}, request) : null;
    await ui.get('tgAdminQueryForm').trigger('submit'); assert.equal(ui.get('tgAdminQueryResults').hidden, false);
});

for (const code of [401, 403]) test(`admin search ${code} removes all query data and returns to login`, async () => {
    const ui = page({ fetch: async url => url === '/api/admin/tg/order-query' ? response({ success: false }, code) : null });
    await ui.ready(); fillAdminSearch(ui); await ui.get('tgAdminQueryForm').trigger('submit');
    assert.equal(ui.get('tgAdminApp').hidden, true); assert.equal(ui.get('tgLoginPanel').hidden, false);
    assert.equal(ui.get('tgAdminQueryResults').hidden, true); assert.equal(ui.get('tgAdminQueryValue').value, '');
});

test('purchase list has one detail entry per order while preserving review and history inside details', async () => {
    const purchases = [REVIEW_ORDER, { ...REVIEW_ORDER, payment_status: 'paid', fulfillment_status: 'succeeded' },
        { ...REVIEW_ORDER, payment_status: 'pending', fulfillment_status: 'not_started' }, { ...REVIEW_ORDER, fulfillment_status: 'closed' }];
    const ui = reviewPage({ purchases }); await ui.ready();
    for (const row of ui.get('tgPurchasesBody').children) {
        const buttons = descendants(row.children[8]).filter(item => item.tag === 'button');
        assert.deepEqual(buttons.map(item => item.textContent), ['详情 / 处理']);
    }
    await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    assert.equal(ui.get('tgDetailModal').open, true);
    assert.ok(findButton(ui.get('tgDetailContent'), '支付核对 / 补发审核'));
    assert.ok(findButton(ui.get('tgDetailContent'), '核对关闭条件'));
    assert.equal(findButton(ui.get('tgDetailContent'), '确认关闭订单').hidden, true);
    assert.ok(findButton(ui.get('tgDetailContent'), '保存核对记录'));
    assert.equal(approvalCalls(ui).length, 0);
});

const closureControls = ui => {
    const section = descendants(ui.get('tgDetailContent')).find(item => item.className === 'tg-order-closure');
    if (!section) return null;
    const inputs = descendants(section).filter(item => item.tag === 'input');
    return { section, note: descendants(section).find(item => item.tag === 'textarea'), delivery: inputs[0], payment: inputs[1],
        confirm: findButton(section, '确认关闭订单'), check: descendants(section).find(item => item.tag === 'button') };
};
const closeReview = (changes = {}) => reviewData(REVIEW_ORDER, { resolution: { ready: true, can_close: true, can_resume: false, message: '已核对原任务，符合关闭条件。' }, ...changes });
async function confirmClosure(controls) {
    controls.note.value = '已核对原任务未发货，按记录处理收款和退款'; await controls.note.trigger('input');
    controls.delivery.checked = true; await controls.delivery.trigger('change');
    controls.payment.checked = true; await controls.payment.trigger('change');
}

for (const message of [
    '原任务可能已提交上游，尚不能确认未发货。请核对上游。',
    '发货任务仍在运行，当前不能关闭或重新提交。',
    '订单处理数据库迁移尚未生效，请先执行迁移。'
]) test(`inline close-order check explains the blocked resolution and cannot submit: ${message}`, async () => {
    const ui = reviewPage({ fetch: url => url.includes('/tg/purchases?orderNo=') ? response(closeReview({
        resolution: { ready: !message.includes('迁移'), can_close: false, can_resume: false, message }
    })) : null });
    await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    const controls = closureControls(ui);
    assert.equal(controls.confirm.hidden, true);
    await controls.check.trigger('click');
    assert.equal(ui.get('tgDetailModal').open, true);
    assert.equal(ui.get('tgPurchaseReviewModal').open, false);
    assert.equal(controls.confirm.hidden, false); assert.equal(controls.confirm.disabled, true);
    assert.match(contentText(controls.section), /尚未提交关闭操作/);
    assert.ok(contentText(controls.section).includes(`当前不能关闭：${message}`));
    assert.equal(controls.note.disabled, true);
    await confirmClosure(controls); await controls.confirm.trigger('click');
    assert.equal(approvalCalls(ui).length, 0, 'operator confirmations cannot override the server eligibility decision');
});

test('purchase loading keeps its order frame and skeleton until details replace the content', async () => {
    const wait = deferred();
    const ui = reviewPage({ fetch: url => url.includes('/tg/purchases?order_no=') ? wait.promise : null });
    await ui.ready(); const loading = findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click'); await tick();
    const dialog = ui.get('tgDetailModal'); const content = ui.get('tgDetailContent');
    assert.equal(dialog.open, true); assert.equal(dialog.classList.contains('tg-order-dialog'), true);
    assert.equal(content.attributes.get('aria-busy'), 'true');
    assert.ok(descendants(content).some(item => item.attributes.get('role') === 'status'));
    assert.equal(descendants(content).filter(item => item.tag === 'dt').length, 10);
    assert.match(contentText(content), new RegExp(REVIEW_ORDER.order_no));
    assert.equal(findButton(content, '确认关闭订单'), undefined);
    wait.resolve(response({ success: true, order: REVIEW_ORDER, history: [] })); await loading;
    assert.equal(dialog.open, true); assert.equal(dialog.classList.contains('tg-order-dialog'), true);
    assert.equal(content.attributes.get('aria-busy'), 'false');
    assert.ok(findButton(content, '核对关闭条件'));
});

test('a dismissed purchase loading request cannot restore its content or reopen the dialog', async () => {
    const wait = deferred(); const ui = reviewPage({ fetch: url => url.includes('/tg/purchases?order_no=') ? wait.promise : null });
    await ui.ready(); const loading = findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click'); await tick();
    await ui.get('tgDetailClose').trigger('click');
    wait.resolve(response({ success: true, order: REVIEW_ORDER, history: [] })); await loading;
    assert.equal(ui.get('tgDetailModal').open, false); assert.equal(ui.get('tgDetailContent').children.length, 0);
    assert.equal(ui.get('tgDetailContent').attributes.get('aria-busy'), 'false');
});

test('failed detail loading keeps the order frame and offers a working retry', async () => {
    let attempts = 0;
    const ui = reviewPage({ fetch: url => url.includes('/tg/purchases?order_no=') ? ++attempts === 1
        ? response({ success: false, message: '详情暂时不可用' }, 503) : response({ success: true, order: REVIEW_ORDER, history: [] }) : null });
    await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    assert.equal(ui.get('tgDetailModal').classList.contains('tg-order-dialog'), true);
    assert.match(contentText(ui.get('tgDetailContent')), /服务暂不可用，请稍后重试/);
    await findButton(ui.get('tgDetailContent'), '重试加载').trigger('click');
    assert.ok(closureControls(ui)); assert.equal(attempts, 2);
});

test('inline closure requires a reason and both confirmations, uses the checked version and refreshes closed details, history and lists', async () => {
    const pending = deferred(); const latest = '2026-10-17T11:00:00.123456+00:00'; let closed = false;
    const closedOrder = { ...REVIEW_ORDER, fulfillment_status: 'closed', updated_at: latest, closed_at: latest };
    const ui = reviewPage({ fetch: (url, req) => {
        if (url.includes('/tg/purchases?orderNo=')) return response(closeReview({ order: { ...REVIEW_ORDER, updated_at: latest } }));
        if (url === '/api/admin/tg/purchases' && req.method === 'POST') return pending.promise;
        if (closed && url.includes('/tg/purchases?order_no=')) return response({ success: true, order: closedOrder,
            history: [{ event_type: 'purchase_closed', created_at: latest, metadata: { note: '已核对关闭' } }] });
        if (closed && url.includes('/tg/purchases?')) return response({ success: true, purchases: [closedOrder], total: 1 });
        return null;
    } });
    await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    const controls = closureControls(ui); await controls.check.trigger('click');
    assert.equal(controls.confirm.disabled, true); assert.equal(controls.confirm.hidden, false);
    controls.note.value = '  太短  '; await controls.note.trigger('input');
    controls.delivery.checked = true; await controls.delivery.trigger('change');
    controls.payment.checked = true; await controls.payment.trigger('change');
    assert.equal(controls.confirm.disabled, true);
    controls.note.value = '核对支付及原任务，按退款方案关闭订单'; await controls.note.trigger('input');
    controls.payment.checked = false; await controls.payment.trigger('change'); assert.equal(controls.confirm.disabled, true);
    controls.payment.checked = true; await controls.payment.trigger('change'); assert.equal(controls.confirm.disabled, false);
    const submitting = controls.confirm.trigger('click'); await tick(); await controls.confirm.trigger('click');
    assert.equal(approvalCalls(ui).length, 1); assert.equal(controls.note.disabled, true);
    assert.equal(controls.confirm.textContent, '正在关闭订单…');
    assert.deepEqual(JSON.parse(approvalCalls(ui)[0].request.body), { action: 'close_order', order_no: REVIEW_ORDER.order_no,
        expected_updated_at: latest, note: controls.note.value, confirm_no_delivery: true, confirm_payment_handled: true });
    closed = true; pending.resolve(response({ success: true, existing: false, order: closedOrder })); await submitting;
    assert.equal(ui.get('tgDetailModal').open, true); assert.equal(ui.get('tgPurchaseReviewModal').open, false);
    assert.equal(closureControls(ui), null); assert.match(contentText(ui.get('tgDetailContent')), /订单已关闭.*收款记录已保留/);
    assert.match(contentText(ui.get('tgDetailContent')), /购买订单已关闭.*已核对关闭/);
    assert.match(contentText(ui.get('tgPurchasesBody')), /已完结/);
    assert.equal(approvalCalls(ui).length, 1);
});

test('rechecking closure discards prior confirmations and reads the newest order version', async () => {
    let checks = 0;
    const ui = reviewPage({ fetch: url => url.includes('/tg/purchases?orderNo=') ? response(closeReview({
        order: { ...REVIEW_ORDER, updated_at: checks++ ? OPERATIONS_VERSION : REVIEW_ORDER.updated_at }
    })) : null });
    await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    const controls = closureControls(ui); await controls.check.trigger('click'); await confirmClosure(controls);
    assert.equal(controls.confirm.disabled, false); await controls.check.trigger('click');
    assert.equal(controls.delivery.checked, false); assert.equal(controls.payment.checked, false);
    assert.equal(controls.confirm.disabled, true); assert.ok(controls.note.value);
    assert.equal(checks, 2); assert.equal(approvalCalls(ui).length, 0);
});

for (const [name, result, status] of [
    ['stale version', { success: false, message: '订单已变化，请重新核对' }, 409],
    ['unknown server outcome', { success: false, message: '暂时不可用' }, 503],
    ['missing close timestamp', { success: true, existing: false, order: { ...REVIEW_ORDER, fulfillment_status: 'closed' } }, 200],
    ['different order', { success: true, existing: false, order: { ...REVIEW_ORDER, order_no: 'TGP-OTHER', fulfillment_status: 'closed', closed_at: OPERATIONS_VERSION } }, 200],
    ['unchanged state', { success: true, existing: false, order: REVIEW_ORDER }, 200]
]) test(`inline closure does not claim success and requires a new check after ${name}`, async () => {
    const ui = reviewPage({ fetch: (url, req) => {
        if (url.includes('/tg/purchases?orderNo=')) return response(closeReview());
        if (url === '/api/admin/tg/purchases' && req.method === 'POST') return response(result, status);
        return null;
    } });
    await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    const controls = closureControls(ui); await controls.check.trigger('click'); await confirmClosure(controls);
    await controls.confirm.trigger('click');
    assert.match(contentText(controls.section), /尚未取得订单已关闭的确认/);
    assert.equal(controls.confirm.disabled, true); assert.doesNotMatch(contentText(ui.get('tgDetailContent')), /订单已关闭，停止发货/);
    await controls.confirm.trigger('click'); assert.equal(approvalCalls(ui).length, 1);
    await controls.check.trigger('click'); assert.equal(controls.delivery.checked, false); assert.equal(controls.payment.checked, false);
});

test('an eligible flag without migration readiness cannot enable inline closure', async () => {
    const ui = reviewPage({ fetch: url => url.includes('/tg/purchases?orderNo=') ? response(closeReview({
        resolution: { ready: false, can_close: true, message: '迁移状态未确认' }
    })) : null });
    await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    const controls = closureControls(ui); await controls.check.trigger('click'); await confirmClosure(controls);
    await controls.confirm.trigger('click'); assert.equal(controls.confirm.disabled, true); assert.equal(approvalCalls(ui).length, 0);
});

test('dismissal invalidates an in-flight closure check and its detached controls', async () => {
    const pending = deferred(); const ui = reviewPage({ fetch: url => url.includes('/tg/purchases?orderNo=') ? pending.promise : null });
    await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    const controls = closureControls(ui); const checking = controls.check.trigger('click'); await tick();
    await ui.get('tgDetailClose').trigger('click'); pending.resolve(response(closeReview())); await checking;
    await confirmClosure(controls); await controls.confirm.trigger('click');
    assert.equal(ui.get('tgDetailModal').open, false); assert.equal(ui.get('tgDetailContent').children.length, 0);
    assert.equal(approvalCalls(ui).length, 0);
});

test('a completed closure refreshes lists without reopening a dismissed detail dialog', async () => {
    const pending = deferred(); let closed = false;
    const ui = reviewPage({ fetch: (url, req) => {
        if (url.includes('/tg/purchases?orderNo=')) return response(closeReview());
        if (url === '/api/admin/tg/purchases' && req.method === 'POST') return pending.promise;
        if (closed && url.includes('/tg/purchases?')) return response({ success: true, purchases: [{ ...REVIEW_ORDER, fulfillment_status: 'closed' }], total: 1 });
        return null;
    } });
    await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    const controls = closureControls(ui); await controls.check.trigger('click'); await confirmClosure(controls);
    const submitting = controls.confirm.trigger('click'); await tick(); await ui.get('tgDetailClose').trigger('click');
    closed = true; pending.resolve(response({ success: true, existing: false, order: { ...REVIEW_ORDER, fulfillment_status: 'closed', closed_at: OPERATIONS_VERSION } }));
    await submitting; assert.equal(ui.get('tgDetailModal').open, false); assert.equal(ui.get('tgDetailContent').children.length, 0);
    assert.match(contentText(ui.get('tgPurchasesBody')), /已完结/);
});

test('the payment-review dialog closes an eligible order only with the note and delivery/payment confirmations and submits once', async () => {
    const pending = deferred();
    const ui = reviewPage({ fetch: (url, req) => {
        if (url.includes('/tg/purchases?orderNo=')) return response(reviewData(REVIEW_ORDER, {
            review: { can_approve: false, message: '请核对退款处理方式。' },
            resolution: { can_close: true, can_resume: false, message: '可关闭此订单；关闭后停止发货。' }
        }));
        if (url === '/api/admin/tg/purchases' && req.method === 'POST') return pending.promise;
        return null;
    } });
    await ui.ready(); await purchaseReviewButton(ui).trigger('click');
    assert.equal(ui.get('tgPurchaseCloseOrder').hidden, false);
    assert.equal(ui.get('tgPurchaseCloseBlocked').hidden, true);
    assert.equal(ui.get('tgPurchaseCloseOrder').disabled, true);
    ui.get('tgPurchaseReviewNote').value = '核对支付及原任务，按退款方案关闭订单';
    await ui.get('tgPurchaseReviewNote').trigger('input');
    assert.equal(ui.get('tgPurchaseCloseOrder').disabled, true);
    ui.get('tgPurchaseReviewNoDelivery').checked = true;
    await ui.get('tgPurchaseReviewNoDelivery').trigger('change');
    assert.equal(ui.get('tgPurchaseCloseOrder').disabled, true);
    ui.get('tgPurchasePaymentHandled').checked = true;
    await ui.get('tgPurchasePaymentHandled').trigger('change');
    assert.equal(ui.get('tgPurchaseReviewNoRefund').checked, false, 'closing supports an already handled refund');
    assert.equal(ui.get('tgPurchaseCloseOrder').disabled, false);
    const submitting = ui.get('tgPurchaseCloseOrder').trigger('click');
    await tick(); await ui.get('tgPurchaseCloseOrder').trigger('click');
    assert.equal(approvalCalls(ui).length, 1);
    assert.deepEqual(JSON.parse(approvalCalls(ui)[0].request.body), {
        action: 'close_order', order_no: REVIEW_ORDER.order_no, expected_updated_at: REVIEW_ORDER.updated_at,
        note: ui.get('tgPurchaseReviewNote').value, confirm_no_delivery: true, confirm_payment_handled: true
    });
    pending.resolve(response({ success: true, existing: false, order: { ...REVIEW_ORDER, fulfillment_status: 'closed', closed_at: OPERATIONS_VERSION } }));
    await submitting;
    assert.equal(ui.get('tgPurchaseCloseActions').hidden, true);
    assert.match(ui.get('tgPurchaseReviewMessage').textContent, /订单已关闭.*收款记录已保留/);
    assert.equal(approvalCalls(ui).length, 1);
});

test('fulfilled and closed orders have no actionable close-order shortcut', async () => {
    for (const state of ['succeeded', 'closed']) {
        const order = { ...REVIEW_ORDER, payment_status: 'paid', fulfillment_status: state };
        const ui = reviewPage({ purchases: [order], fetch: url => url.includes('/tg/purchases?orderNo=') ? response(reviewData(order, {
            review: { can_approve: false, message: '订单已结束。' }, resolution: { can_close: false, can_resume: false }
        })) : null });
        await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
        assert.equal(findButton(ui.get('tgDetailContent'), '核对关闭条件'), undefined);
        await findButton(ui.get('tgDetailContent'), '支付核对 / 补发审核').trigger('click');
        assert.equal(ui.get('tgPurchaseCloseActions').hidden, true);
        assert.equal(ui.get('tgPurchaseCloseOrder').disabled, true);
        assert.equal(approvalCalls(ui).length, 0);
    }
});

const RECOVERY_PROVIDER = 'f47ac10b-58cc-4372-a567-0e02b2c3d482';
const RECOVERY_ORDER = { ...REVIEW_ORDER, payment_status: 'paid', paid_at: '2026-10-16T10:14:31Z', fulfillment_status: 'manual_review' };
const RECOVERY_TASK = { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480', order_no: 'TG-ABCDEFGHIJKLMNOPQRST', status: 'manual_review', provider_order_id: null,
    submitted_at: '2026-10-16T11:00:00Z', updated_at: RECOVERY_ORDER.updated_at };
const RECOVERY_PERMISSIONS = { success: true, ready: true, can_link: true, can_record_nonacceptance: true, records: [], message: '原上游恢复条件已核对' };
const recoveryCheck = (action) => ({ success: true, order_no: RECOVERY_ORDER.order_no, expected_updated_at: RECOVERY_ORDER.updated_at,
    expected_task_updated_at: RECOVERY_TASK.updated_at, checked_at: '2026-10-17T06:00:00Z', message: action === 'inspect_upstream_order' ? '原提交标识及商品权益核验一致' : '查无结果仍须提供明确未受理凭据',
    ...(action === 'inspect_upstream_order' ? { snapshot: { provider_order_id: RECOVERY_PROVIDER, idempotency_key_matches: true, provider_status: 'completed' } } : {}) });
function recoveryPage(options = {}) {
    return reviewPage({ purchases: [RECOVERY_ORDER], ...options, async fetch(url, req) {
        if (options.fetch) { const custom = await options.fetch(url, req); if (custom) return custom; }
        if (url.includes('&recovery=1')) return response(RECOVERY_PERMISSIONS);
        if (url.includes('/tg/purchases?order_no=')) return response({ success: true, order: RECOVERY_ORDER, fulfillment: RECOVERY_TASK, history: [] });
        if (url === '/api/admin/tg/purchases' && req.method === 'POST') return response(recoveryCheck(JSON.parse(req.body).action));
        return null;
    } });
}
async function openRecovery(ui) {
    await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    await findButton(ui.get('tgDetailContent'), '补录原上游单 / 查看结案凭据').trigger('click');
}
const recoveryForm = (ui, label = '补录原上游订单') => descendants(ui.get('tgDetailContent')).find(item => item.attributes.get('aria-label') === label && item.tag === 'div');
const fieldByLabel = (root, label) => descendants(root).find(item => item.attributes.get('aria-label') === label);
async function fillRecovery(ui, mode = 'link') {
    const form = recoveryForm(ui, mode === 'link' ? '补录原上游订单' : '登记明确未受理凭据');
    if (mode === 'link') { const input = fieldByLabel(form, '原上游订单号'); input.value = RECOVERY_PROVIDER; await input.trigger('input'); }
    else {
        for (const [label, value] of [['凭据编号 / 留档位置', 'GRAMIX-TICKET-123'], ['上游确认时间', '2026-10-17T13:50:00'],
            ['上游明确答复摘要', '上游工单明确确认本次原始提交未受理、未发货且不会后续发货，原记录已归档。']]) {
            const input = fieldByLabel(form, label); input.value = value; await input.trigger('input');
        }
    }
    const note = fieldByLabel(form, mode === 'link' ? '补录处理原因' : '结案处理原因'); note.value = '已核对本次原请求并留档收款及处理依据'; await note.trigger('input');
    for (const input of descendants(form).filter(item => item.type === 'checkbox')) { input.checked = true; await input.trigger('change'); }
    return form;
}
const recoveryWrites = ui => approvalCalls(ui).map(call => JSON.parse(call.request.body)).filter(value => ['link_upstream_order', 'close_with_nonacceptance'].includes(value.action));

test('recovery migration-pending state cannot expose writable forms', async () => {
    const ui = recoveryPage({ fetch: url => url.includes('&recovery=1') ? response({ success: true, ready: false, can_link: false, can_record_nonacceptance: false, records: [], message: '上游订单恢复迁移尚未生效' }) : null });
    await openRecovery(ui); assert.match(contentText(ui.get('tgDetailContent')), /迁移尚未生效/); assert.equal(recoveryForm(ui), undefined); assert.equal(approvalCalls(ui).length, 0);
});
test('recovery read dismissed during loading cannot restore content', async () => {
    const wait = deferred(); const ui = recoveryPage({ fetch: url => url.includes('&recovery=1') ? wait.promise : null });
    await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    const loading = findButton(ui.get('tgDetailContent'), '补录原上游单 / 查看结案凭据').trigger('click'); await tick(); await ui.get('tgDetailClose').trigger('click');
    wait.resolve(response(RECOVERY_PERMISSIONS)); await loading; assert.equal(ui.get('tgDetailModal').open, false); assert.equal(ui.get('tgDetailContent').children.length, 0);
});
test('candidate requires read-only inspect, exact proof, reason and confirmation; editing invalidates it', async () => {
    const ui = recoveryPage(); await openRecovery(ui); const form = await fillRecovery(ui); const confirm = findButton(form, '确认补录原上游订单');
    assert.equal(confirm.disabled, true); await findButton(form, '核验原上游订单').trigger('click'); assert.equal(confirm.disabled, false); assert.match(contentText(form), /核验一致/);
    assert.equal(recoveryWrites(ui).length, 0);
    const id = fieldByLabel(form, '原上游订单号'); id.value = 'f47ac10b-58cc-4372-a567-0e02b2c3d489'; await id.trigger('input');
    assert.equal(confirm.disabled, true); assert.doesNotMatch(contentText(form), /核验一致/);
});
test('candidate mismatch and missing proof never enable confirmation', async () => {
    for (const result of [{ success: false, message: '原提交标识不一致' }, { ...recoveryCheck('inspect_upstream_order'), snapshot: { provider_order_id: RECOVERY_PROVIDER } }]) {
        const ui = recoveryPage({ fetch: (url, req) => url === '/api/admin/tg/purchases' && req.method === 'POST' ? response(result, result.success === false ? 409 : 200) : null });
        await openRecovery(ui); const form = await fillRecovery(ui); await findButton(form, '核验原上游订单').trigger('click');
        assert.equal(findButton(form, '确认补录原上游订单').disabled, true); assert.equal(recoveryWrites(ui).length, 0);
    }
});
test('confirm link sends original versions and fresh operation id, blocks double-clicks and renders confirmed status', async () => {
    const wait = deferred(); let done = false; const ui = recoveryPage({ fetch: (url, req) => {
        if (url === '/api/admin/tg/purchases' && req.method === 'POST' && JSON.parse(req.body).action === 'link_upstream_order') return wait.promise;
        if (done && url.includes('/tg/purchases?order_no=') && !url.includes('&recovery=')) return response({ success: true, order: { ...RECOVERY_ORDER, fulfillment_status: 'succeeded' }, fulfillment: { ...RECOVERY_TASK, provider_order_id: RECOVERY_PROVIDER }, history: [] });
        return null;
    } });
    await openRecovery(ui); const form = await fillRecovery(ui); await findButton(form, '核验原上游订单').trigger('click'); const confirm = findButton(form, '确认补录原上游订单');
    const sending = confirm.trigger('click'); await tick(); await confirm.trigger('click'); assert.equal(recoveryWrites(ui).length, 1); assert.equal(confirm.disabled, true);
    assert.deepEqual(recoveryWrites(ui)[0], { action: 'link_upstream_order', order_no: RECOVERY_ORDER.order_no, expected_updated_at: RECOVERY_ORDER.updated_at, expected_task_updated_at: RECOVERY_TASK.updated_at,
        operation_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d483', provider_order_id: RECOVERY_PROVIDER, note: '已核对本次原请求并留档收款及处理依据', confirm_original_request: true });
    done = true; wait.resolve(response({ success: true, existing: false, operation_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d483', order: { ...RECOVERY_ORDER, fulfillment_status: 'succeeded' } })); await sending;
    assert.match(contentText(ui.get('tgDetailContent')), /原上游订单已补录/); assert.match(contentText(ui.get('tgDetailContent')), /已发货/); assert.equal(ui.get('tgDetailModal').open, true);
});
test('nonacceptance needs real reference, timestamp, summary, all four confirmations and server check', async () => {
    const ui = recoveryPage(); await openRecovery(ui); await findButton(ui.get('tgDetailContent'), '登记未受理凭据').trigger('click');
    const form = recoveryForm(ui, '登记明确未受理凭据'); assert.equal(form.hidden, false); assert.equal(recoveryForm(ui).hidden, true);
    await findButton(form, '核验原任务与结案条件').trigger('click'); assert.equal(findButton(form, '登记凭据并关闭订单').disabled, true);
    await fillRecovery(ui, 'nonacceptance'); await findButton(form, '核验原任务与结案条件').trigger('click'); const confirm = findButton(form, '登记凭据并关闭订单'); assert.equal(confirm.disabled, false);
    const checks = descendants(form).filter(item => item.type === 'checkbox'); assert.equal(checks.length, 4);
    for (const check of checks) { check.checked = false; await check.trigger('change'); assert.equal(confirm.disabled, true); check.checked = true; await check.trigger('change'); }
    fieldByLabel(form, '上游明确答复摘要').value = '超时未查到'; await fieldByLabel(form, '上游明确答复摘要').trigger('input'); assert.equal(confirm.disabled, true); assert.equal(recoveryWrites(ui).length, 0);
});
test('nonacceptance commit stores structured evidence and reports closed only after confirmed reply', async () => {
    let sent; let closed = false; const closedOrder = { ...RECOVERY_ORDER, closed_at: '2026-10-17T06:00:00Z', fulfillment_status: 'closed' };
    const ui = recoveryPage({ fetch: (url, req) => {
        if (url === '/api/admin/tg/purchases' && req.method === 'POST' && JSON.parse(req.body).action === 'close_with_nonacceptance') { sent = JSON.parse(req.body); closed = true; return response({ success: true, existing: false, operation_id: sent.operation_id, order: closedOrder }); }
        if (closed && url.includes('/tg/purchases?order_no=') && !url.includes('&recovery=')) return response({ success: true, order: closedOrder, fulfillment: { ...RECOVERY_TASK, status: 'cancelled' }, history: [{ event_type: 'purchase_nonacceptance_closed', metadata: { note: '未受理凭据结案' } }] });
        return null;
    } });
    await openRecovery(ui); await findButton(ui.get('tgDetailContent'), '登记未受理凭据').trigger('click'); const form = await fillRecovery(ui, 'nonacceptance');
    await findButton(form, '核验原任务与结案条件').trigger('click'); await findButton(form, '登记凭据并关闭订单').trigger('click');
    assert.equal(sent.evidence.kind, 'provider_support'); assert.equal(sent.evidence.reference, 'GRAMIX-TICKET-123'); assert.ok(sent.evidence.confirmed_at.endsWith('Z'));
    for (const key of ['confirm_original_request', 'confirm_nonacceptance', 'confirm_no_delivery', 'confirm_payment_handled']) assert.equal(sent[key], true);
    assert.equal(sent.snapshot, undefined); assert.equal(sent.actor_id, undefined); assert.match(contentText(ui.get('tgDetailContent')), /未受理凭据已登记，订单已关闭/); assert.match(contentText(ui.get('tgDetailContent')), /未受理凭据结案/);
});
test('response lost permits retry with same operation id and exact payload', async () => {
    let count = 0; const ui = recoveryPage({ fetch: (url, req) => {
        if (url === '/api/admin/tg/purchases' && req.method === 'POST' && JSON.parse(req.body).action === 'link_upstream_order') { count++; throw new Error('network failed'); }
        return null;
    } });
    await openRecovery(ui); const form = await fillRecovery(ui); await findButton(form, '核验原上游订单').trigger('click'); const confirm = findButton(form, '确认补录原上游订单');
    await confirm.trigger('click'); assert.equal(confirm.disabled, false); await confirm.trigger('click'); assert.equal(count, 2); assert.deepEqual(recoveryWrites(ui)[0], recoveryWrites(ui)[1]);
    assert.match(contentText(form), /保持原内容重试/);
});
test('late recovery write response cannot reopen a dismissed dialog', async () => {
    const wait = deferred(); const ui = recoveryPage({ fetch: (url, req) => url === '/api/admin/tg/purchases' && req.method === 'POST' && JSON.parse(req.body).action === 'link_upstream_order' ? wait.promise : null });
    await openRecovery(ui); const form = await fillRecovery(ui); await findButton(form, '核验原上游订单').trigger('click'); const sending = findButton(form, '确认补录原上游订单').trigger('click'); await tick();
    await ui.get('tgDetailClose').trigger('click'); wait.resolve(response({ success: true, existing: false, operation_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d483', order: { ...RECOVERY_ORDER, fulfillment_status: 'succeeded' } })); await sending;
    assert.equal(ui.get('tgDetailModal').open, false); assert.equal(ui.get('tgDetailContent').children.length, 0);
});
for (const status of [401, 403]) test(`recovery ${status} clears protected form and cannot submit`, async () => {
    const ui = recoveryPage({ fetch: (url, req) => url === '/api/admin/tg/purchases' && req.method === 'POST' ? response({ success: false, message: '登录已失效' }, status) : null });
    await openRecovery(ui); const form = await fillRecovery(ui); await findButton(form, '核验原上游订单').trigger('click');
    assert.equal(ui.get('tgDetailModal').open, false); assert.equal(ui.get('tgAdminApp').hidden, true); assert.equal(recoveryWrites(ui).length, 0);
});
test('recovery evidence renders as text, including references and summaries', async () => {
    const markup = '<img src=x onerror=alert(1)>'; const ui = recoveryPage({ fetch: url => url.includes('&recovery=1') ? response({ ...RECOVERY_PERMISSIONS, can_link: false, can_record_nonacceptance: false,
        records: [{ action: 'close_with_nonacceptance', note: markup, evidence: { reference: markup, summary: markup }, actor_user_id: markup }] }) : null });
    await openRecovery(ui); assert.match(contentText(ui.get('tgDetailContent')), /<img src=x/); assert.equal(descendants(ui.get('tgDetailContent')).some(item => item.tag === 'img' || item.innerHTML), false);
});

test('a linked failed order releases the submission lock for the refreshed close-order controls', async () => {
    let committed = false;
    const linked = { success: true, order: { ...RECOVERY_ORDER, fulfillment_status: 'failed' },
        fulfillment: { ...RECOVERY_TASK, status: 'failed', provider_order_id: RECOVERY_PROVIDER }, history: [] };
    const ui = recoveryPage({ fetch: (url, req) => {
        if (url === '/api/admin/tg/purchases' && req.method === 'POST' && JSON.parse(req.body).action === 'link_upstream_order') {
            committed = true;
            return response({ success: true, operation_id: JSON.parse(req.body).operation_id, order: linked.order });
        }
        if (committed && url.includes('/tg/purchases?order_no=') && !url.includes('&recovery=')) return response(linked);
        return null;
    } });
    await openRecovery(ui); const form = await fillRecovery(ui);
    await findButton(form, '核验原上游订单').trigger('click');
    await findButton(form, '确认补录原上游订单').trigger('click');
    assert.match(contentText(ui.get('tgDetailContent')), /原上游订单已补录/);
    assert.equal(findButton(ui.get('tgDetailContent'), '核对关闭条件').disabled, false);
    await findButton(ui.get('tgDetailContent'), '补录原上游单 / 查看结案凭据').trigger('click');
    assert.ok(recoveryForm(ui));
    assert.equal(recoveryWrites(ui).length, 1);
});

test('a delayed stale detail refresh cannot replace a confirmed nonacceptance closure', async () => {
    const ui = recoveryPage({ fetch: (url, req) => {
        if (url === '/api/admin/tg/purchases' && req.method === 'POST' && JSON.parse(req.body).action === 'close_with_nonacceptance') {
            return response({ success: true, operation_id: JSON.parse(req.body).operation_id,
                order: { ...RECOVERY_ORDER, fulfillment_status: 'closed', closed_at: OPERATIONS_VERSION } });
        }
        return null;
    } });
    await openRecovery(ui); await findButton(ui.get('tgDetailContent'), '登记未受理凭据').trigger('click');
    const form = await fillRecovery(ui, 'nonacceptance'); await findButton(form, '核验原任务与结案条件').trigger('click');
    await findButton(form, '登记凭据并关闭订单').trigger('click');
    assert.match(contentText(ui.get('tgDetailContent')), /订单已关闭/);
    assert.equal(findButton(ui.get('tgDetailContent'), '核对关闭条件'), undefined);
    assert.equal(recoveryWrites(ui).length, 1);
});

test('a nonacceptance reply without a valid closure timestamp remains unconfirmed', async () => {
    const ui = recoveryPage({ fetch: (url, req) => {
        if (url === '/api/admin/tg/purchases' && req.method === 'POST' && JSON.parse(req.body).action === 'close_with_nonacceptance') {
            return response({ success: true, operation_id: JSON.parse(req.body).operation_id, order: { ...RECOVERY_ORDER, fulfillment_status: 'closed' } });
        }
        return null;
    } });
    await openRecovery(ui); await findButton(ui.get('tgDetailContent'), '登记未受理凭据').trigger('click');
    const form = await fillRecovery(ui, 'nonacceptance'); await findButton(form, '核验原任务与结案条件').trigger('click');
    await findButton(form, '登记凭据并关闭订单').trigger('click');
    assert.match(contentText(form), /处理结果尚未确认/);
    assert.doesNotMatch(contentText(ui.get('tgDetailContent')), /未受理凭据已登记，订单已关闭/);
    assert.equal(recoveryWrites(ui).length, 1);
});

test('recovery history exposes the attested source and committed outcome', async () => {
    const ui = recoveryPage({ fetch: url => url.includes('&recovery=1') ? response({ ...RECOVERY_PERMISSIONS, can_link: false, can_record_nonacceptance: false,
        records: [{ action: 'close_with_nonacceptance', note: '依据原请求拒绝凭据结案', result_status: 'closed', created_at: OPERATIONS_VERSION,
            evidence: { kind: 'provider_rejection', reference: 'REJECTION-ORIGINAL-123', confirmed_at: OPERATIONS_VERSION, summary: '上游已明确确认原请求未受理且不会后续发货，已完成核实并留档。' } }] }) : null });
    await openRecovery(ui);
    assert.match(contentText(ui.get('tgDetailContent')), /处理结果：已完结/);
    assert.match(contentText(ui.get('tgDetailContent')), /凭据来源：原请求明确拒绝记录/);
    assert.match(contentText(ui.get('tgDetailContent')), /人工核实/);
    assert.equal(recoveryWrites(ui).length, 0);
});

const COPY_CODE_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
async function openCopyBatch(options = {}) {
    const sample = options.code || CODE;
    const batch = { id: 'copy-batch', batch_no: 'TGB-OFFLINE-COPY', status: 'active', product_family: sample.includes('-STAR-') ? 'telegram_stars' : 'telegram_premium', term_months: 3, stars_quantity: 50 };
    const ui = page({ ...options, batches: [batch], fetch: async (url, request) => {
        if (options.fetch) { const custom = await options.fetch(url, request); if (custom) return custom; }
        if (url.includes('/tg/codes?batchId=')) return response({ success: true, batch, codes: [{ id: COPY_CODE_ID, code_last4: sample.slice(-4), status: 'available' }] });
        if (url.endsWith('/tg/codes') && request.method === 'POST') return response({ success: true, code_id: COPY_CODE_ID, code: sample });
        return null;
    } });
    await ui.ready();
    const open = () => ui.get('tgBatchesBody').children[0].children[6].children[0].children[0].trigger('click');
    await open();
    const control = () => descendants(ui.get('tgDetailContent')).find(item => item.className === 'tg-code-copy');
    return { ui, open, control };
}
function backdropGeometry(dialog) { dialog.getBoundingClientRect = () => ({ left: 100, top: 100, right: 700, bottom: 600 }); }
async function clickBackdrop(dialog) {
    backdropGeometry(dialog);
    const event = { target: dialog, button: 0, clientX: 50, clientY: 50 };
    await dialog.trigger('pointerdown', event); await dialog.trigger('click', event);
}

test('batch codes copy complete Premium and Stars values on click while displaying only the suffix', async () => {
    for (const code of [CODE, STARS_CODE]) {
        const copied = [];
        const { ui, open, control } = await openCopyBatch({ code, clipboard: { writeText: async value => copied.push(value) } });
        assert.equal(ui.get('tgDetailModal').open, true);
        assert.equal(contentText(ui.get('tgDetailContent')).includes(code), false);
        assert.equal(contentText(control()).trim(), `…${code.slice(-4)}`);
        await control().trigger('click');
        assert.deepEqual(copied, [code]);
        assert.equal(control().children[0].textContent, `…${code.slice(-4)}`);
        assert.equal(contentText(ui.get('tgDetailContent')).includes(code), false);
        assert.equal(ui.get('tgCopyToast').hidden, false);
        assert.equal(ui.get('tgCopyToast').popoverOpen, true);
        assert.equal(control()['aria-busy'], 'false');
        const reads = businessCalls(ui).filter(call => call.request.method === 'POST');
        assert.equal(reads.length, 1);
        assert.deepEqual(JSON.parse(reads[0].request.body), { action: 'reveal', code_id: COPY_CODE_ID });
        assert.equal(reads[0].request.cache, 'no-store');
        await control().trigger('click');
        assert.deepEqual(copied, [code, code]);
        assert.equal(businessCalls(ui).filter(call => call.request.method === 'POST').length, 1);
        assert.equal([...ui.storage.values()].some(value => String(value).includes(code)), false);
        await clickBackdrop(ui.get('tgDetailModal'));
        assert.equal(ui.get('tgDetailModal').open, false);
        assert.equal(ui.get('tgDetailContent').children.length, 0);
        assert.equal(ui.get('tgCopyToast').hidden, true);
        assert.equal(ui.get('tgCopyToast').popoverOpen, false);
        await open();
        assert.equal(control().children[0].textContent, `…${code.slice(-4)}`);
        assert.equal(contentText(ui.get('tgDetailContent')).includes(code), false);
    }
});

test('batch code copy failures allow retry without expanding or exposing the complete code', async () => {
    for (const unavailable of [false, true]) {
        const copied = [];
        const clipboard = unavailable ? {} : { writeText: async () => { throw new Error('permission denied'); } };
        const { ui, control } = await openCopyBatch({ clipboard });
        await control().trigger('click');
        assert.equal(descendants(ui.get('tgDetailContent')).some(item => item.tag === 'input'), false);
        assert.equal(contentText(ui.get('tgDetailContent')).includes(CODE), false);
        assert.equal(contentText(control()).trim(), `…${CODE.slice(-4)}`);
        assert.match(contentText(ui.get('tgDetailContent')), /复制失败.*剪贴板.*重试/);
        assert.equal(ui.get('tgCopyToast').hidden, true);
        clipboard.writeText = async value => copied.push(value);
        await control().trigger('click');
        assert.deepEqual(copied, [CODE]);
        assert.equal(businessCalls(ui).filter(call => call.request.method === 'POST').length, 1);
        assert.equal(contentText(ui.get('tgDetailContent')).includes(CODE), false);
        assert.doesNotMatch(contentText(ui.get('tgDetailContent')), /复制失败/);
        assert.equal(ui.get('tgCopyToast').hidden, false);
        await ui.get('tgDetailClose').trigger('click');
        assert.equal(ui.get('tgDetailContent').children.length, 0);
    }
});

test('pending code reads are submitted once and cannot reveal or copy after the detail is dismissed', async () => {
    const pending = deferred(); const copied = []; const payload = { success: true, code_id: COPY_CODE_ID, code: CODE };
    const { ui, control } = await openCopyBatch({ clipboard: { writeText: async value => copied.push(value) }, fetch: (url, req) => url.endsWith('/tg/codes') && req.method === 'POST' ? pending.promise : null });
    const reading = control().trigger('click'); await tick();
    assert.equal(control().disabled, true);
    await control().trigger('click');
    assert.equal(businessCalls(ui).filter(call => call.request.method === 'POST').length, 1);
    await clickBackdrop(ui.get('tgDetailModal'));
    pending.resolve(response(payload)); await reading;
    assert.equal(payload.code, ''); assert.deepEqual(copied, []);
    assert.equal(ui.get('tgDetailModal').open, false);
    assert.equal(ui.get('tgDetailContent').children.length, 0);
});

test('an old code response cannot overwrite a newly opened batch detail', async () => {
    const pending = deferred(); const copied = [];
    const { ui, open, control } = await openCopyBatch({ clipboard: { writeText: async value => copied.push(value) }, fetch: (url, req) => url.endsWith('/tg/codes') && req.method === 'POST' ? pending.promise : null });
    const reading = control().trigger('click'); await tick();
    await ui.get('tgDetailClose').trigger('click'); await open();
    pending.resolve(response({ success: true, code_id: COPY_CODE_ID, code: CODE })); await reading;
    assert.deepEqual(copied, []);
    assert.equal(ui.get('tgDetailModal').open, true);
    assert.equal(contentText(ui.get('tgDetailContent')).includes(CODE), false);
    assert.equal(contentText(control()).trim(), `…${CODE.slice(-4)}`);
});

test('batch code reads validate the returned identity and full code before copying it', async () => {
    for (const altered of [{ code_id: 'another-code' }, { code: 'TG-PREM-12345678-12345678-12345678-1234FFFF' }, { code: '<img src=x>' }, { code: null }]) {
        const copied = []; const payload = { success: true, code_id: COPY_CODE_ID, code: CODE, ...altered };
        const { ui, control } = await openCopyBatch({ clipboard: { writeText: async value => copied.push(value) }, fetch: (url, req) => url.endsWith('/tg/codes') && req.method === 'POST' ? response(payload) : null });
        await control().trigger('click');
        assert.deepEqual(copied, []); assert.equal(payload.code, '');
        assert.equal(contentText(control()).trim(), `…${CODE.slice(-4)}`);
        assert.equal(ui.get('tgCopyToast').hidden, true);
        assert.match(contentText(ui.get('tgDetailContent')), /完整兑换码读取结果异常/);
        assert.equal(control().children[0].textContent, `…${CODE.slice(-4)}`);
        assert.equal(control().disabled, false);
    }
});

test('legacy code recovery reports the missing original and permits a later retry', async () => {
    let attempts = 0; const copied = [];
    const { ui, control } = await openCopyBatch({ clipboard: { writeText: async value => copied.push(value) }, fetch: (url, req) => {
        if (!url.endsWith('/tg/codes') || req.method !== 'POST') return null;
        attempts++;
        return attempts === 1 ? response({ success: false, code: 'tg_code_plaintext_unavailable', message: '此兑换码没有可恢复的加密原文，请使用生成时保存的原码' }, 409) : response({ success: true, code_id: COPY_CODE_ID, code: CODE });
    } });
    await control().trigger('click');
    assert.deepEqual(copied, []);
    assert.match(contentText(ui.get('tgDetailContent')), /没有可恢复的加密原文/);
    await control().trigger('click');
    assert.deepEqual(copied, [CODE]); assert.equal(attempts, 2);
});

test('expired code-read authorization closes the detail without displaying or copying plaintext', async () => {
    for (const status of [401, 403]) {
        const copied = [];
        const { ui, control } = await openCopyBatch({ clipboard: { writeText: async value => copied.push(value) }, fetch: (url, req) => url.endsWith('/tg/codes') && req.method === 'POST' ? response({ success: false }, status) : null });
        await control().trigger('click');
        assert.deepEqual(copied, []);
        assert.equal(ui.get('tgDetailModal').open, false);
        assert.equal(ui.get('tgDetailContent').children.length, 0);
        assert.equal(ui.get('tgAdminApp').hidden, true);
    }
});

test('backdrop dismissal requires a primary press and release outside each modal', async () => {
    const ui = page(); await ui.ready();
    for (const id of ['tgDetailModal', 'tgPurchaseReviewModal', 'tgCodesModal']) {
        const dialog = ui.get(id); backdropGeometry(dialog); dialog.showModal(); ui.get('tgCodesSaved').checked = true;
        const outside = { target: dialog, button: 0, clientX: 50, clientY: 50 };
        const padding = { target: dialog, button: 0, clientX: 120, clientY: 120 };
        const child = { ...padding, target: ui.get('tgDetailContent') };
        for (const event of [padding, child, { ...outside, button: 2 }]) {
            await dialog.trigger('pointerdown', event); await dialog.trigger('click', event);
            assert.equal(dialog.open, true, `${id}: body, padding and secondary clicks stay open`);
        }
        await dialog.trigger('pointerdown', child); await dialog.trigger('click', outside);
        assert.equal(dialog.open, true, 'dragging from the form must not dismiss it');
        await dialog.trigger('pointerdown', outside); await dialog.trigger('pointercancel'); await dialog.trigger('click', outside);
        assert.equal(dialog.open, true, 'cancelled pointers must not dismiss it');
        await dialog.trigger('pointerdown', outside); await dialog.trigger('click', padding);
        assert.equal(dialog.open, true, 'ending inside the modal must not dismiss it');
        await clickBackdrop(dialog);
        assert.equal(dialog.open, false, id);
    }
});

test('backdrop clicks preserve the generated-code save confirmation and clear plaintext after saving', async () => {
    const ui = page({ fetch: (url, req) => url.endsWith('/tg/codes') && req.method === 'POST' ? response({ success: true, codes: [CODE] }) : null }); await ui.ready();
    await ui.get('tgGenerateForm').trigger('submit');
    await clickBackdrop(ui.get('tgCodesModal'));
    assert.equal(ui.get('tgCodesModal').open, true); assert.equal(ui.get('tgCodesText').value, CODE);
    assert.match(ui.get('tgCodesCopyMessage').textContent, /请先保存兑换码/);
    ui.get('tgCodesSaved').checked = true; await clickBackdrop(ui.get('tgCodesModal'));
    assert.equal(ui.get('tgCodesModal').open, false); assert.equal(ui.get('tgCodesText').value, '');
});


test('a delayed clipboard completion cannot show a success toast in a different batch detail', async () => {
    const pending = deferred();
    const { ui, open, control } = await openCopyBatch({ clipboard: { writeText: () => pending.promise } });
    const copying = control().trigger('click'); await tick();
    await ui.get('tgDetailClose').trigger('click'); await open();
    pending.resolve(); await copying;
    assert.equal(ui.get('tgDetailModal').open, true);
    assert.equal(ui.get('tgCopyToast').hidden, true);
    assert.equal(contentText(control()).trim(), `…${CODE.slice(-4)}`);
    assert.equal(contentText(ui.get('tgDetailContent')).includes(CODE), false);
});

test('copy success toast renews its timeout and is cleared on dismissal without moving focus', async () => {
    const timers = new Map(); let next = 1;
    const { ui, control } = await openCopyBatch({
        setTimeout(callback, delay) {
            if (delay !== 2400) return setTimeout(callback, delay);
            const id = next++; timers.set(id, callback); return id;
        },
        clearTimeout(id) { if (timers.has(id)) timers.delete(id); else clearTimeout(id); }
    });
    control().focus();
    await control().trigger('click');
    assert.equal(ui.get('tgCopyToast').hidden, false);
    assert.equal(ui.get('tgCopyToast').popoverOpen, true);
    assert.equal(ui.window.document.activeElement, control());
    assert.equal(timers.size, 1); const firstId = [...timers.keys()][0];
    await control().trigger('click');
    assert.equal(timers.size, 1); assert.equal(timers.has(firstId), false);
    [...timers.values()][0]();
    assert.equal(ui.get('tgCopyToast').hidden, true);
    assert.equal(ui.get('tgCopyToast').popoverOpen, false);
    await control().trigger('click');
    assert.equal(ui.get('tgCopyToast').hidden, false);
    await clickBackdrop(ui.get('tgDetailModal'));
    assert.equal(ui.get('tgCopyToast').hidden, true);
    assert.equal(ui.get('tgCopyToast').popoverOpen, false);
    assert.equal(timers.size, 0);
});


test('batch usage shows successful redemptions over generated codes for active and disabled batches', async () => {
    const batches = [
        { id: 'unused', status: 'active', generated_count: 5, quantity: 5, redeemed_count: 0 },
        { id: 'partial', status: 'active', generated_count: 3, quantity: 10, redeemed_count: 1, reserved_count: 2 },
        { id: 'complete', status: 'exhausted', generated_count: 5, quantity: 5, redeemed_count: 5 },
        { id: 'revoked', status: 'disabled', generated_count: '10', quantity: 10, redeemed_count: '4', revoked_count: 6 }
    ];
    const ui = page({ batches }); await ui.ready();
    const expected = [['0%', '0 / 5'], ['33.3%', '1 / 3'], ['100%', '5 / 5'], ['40%', '4 / 10']];
    for (const [index, batch] of batches.entries()) {
        const row = ui.get('tgBatchesBody').children[index];
        assert.equal(row.children.length, 7);
        const usage = row.children[3].children[0];
        assert.deepEqual(Array.from(usage.children[0].children, item => item.textContent), expected[index]);
        const meter = usage.children[1];
        assert.equal(meter.value, Number(batch.redeemed_count));
        assert.equal(meter.max, Number(batch.generated_count));
        assert.match(meter.attributes.get('aria-label'), /已成功兑换/);
    }
    assert.equal(businessCalls(ui).filter(call => call.url.includes('/tg/codes?')).length, 1, 'usage must not request each batch or recover any complete codes');
    assert.equal(businessCalls(ui).filter(call => call.request.method === 'POST').length, 0);
});

test('empty or unavailable batch statistics never divide by zero or invent a usage rate', async () => {
    const batches = [
        { generated_count: 0, redeemed_count: 0 }, {},
        { generated_count: 5 }, { generated_count: 5, redeemed_count: null },
        { generated_count: 5, redeemed_count: -1 }, { generated_count: 5, redeemed_count: 6 },
        { generated_count: 5, redeemed_count: 1.5 }, { generated_count: '', redeemed_count: 0 }
    ];
    const ui = page({ batches }); await ui.ready();
    const unused = ui.get('tgBatchesBody').children[0].children[3].children[0];
    assert.match(allText(unused), /0%/); assert.match(allText(unused), /0 \/ 0/);
    assert.equal(unused.children[1].value, 0); assert.equal(unused.children[1].max, 1);
    for (const row of ui.get('tgBatchesBody').children.slice(1)) {
        const usage = row.children[3].children[0];
        assert.equal(allText(usage).trim(), '—');
        assert.equal(descendants(usage).some(item => item.tag === 'progress'), false);
    }
    assert.doesNotMatch(allText(ui.get('tgBatchesBody')), /NaN|Infinity/);
    const empty = page(); await empty.ready();
    assert.equal(empty.get('tgBatchesBody').children[0].children[0].colSpan, 7);
});

test('batch table loading headers and rows match the seven-column result including usage', () => {
    const skeleton = html.slice(html.indexOf('<div class="tg-admin-skeleton-section" data-section="Codes">'), html.indexOf('class="tg-admin-skeleton-section" data-section="Products"'));
    const table = skeleton.slice(skeleton.indexOf('<table>'), skeleton.indexOf('</table>'));
    const actual = html.slice(html.indexOf('id="tgBatchFilters"'), html.indexOf('id="tgBatchesPager"'));
    const headers = value => Array.from(value.matchAll(/<th(?:\s[^>]*)?>(.*?)<\/th>/g), match => match[1]);
    assert.deepEqual(headers(table), headers(actual));
    assert.equal(headers(table).length, 7);
    const rows = Array.from(table.matchAll(/<tr>(.*?)<\/tr>/g)).slice(1);
    assert.equal(rows.length, 3);
    for (const row of rows) assert.equal(Array.from(row[1].matchAll(/<td>/g)).length, 7);
});

test('successful revocation updates batch list and detail without a corner success notice', async () => {
    for (const fromDetail of [false, true]) {
        let revoked = false;
        const batch = () => ({ id: 'revoke-batch', batch_no: 'TGB-OFFLINE-REVOKE', status: revoked ? 'disabled' : 'active', generated_count: 5, quantity: 5, redeemed_count: 1 });
        const ui = page({ fetch: async (url, request) => {
            if (url.endsWith('/tg/codes') && request.method === 'POST') { revoked = true; return response({ success: true }); }
            if (url.includes('/tg/codes?batchId=')) return response({ success: true, batch: batch(), codes: [] });
            if (url.includes('/tg/codes?')) return response({ success: true, batches: [batch()], total: 1 });
            return null;
        } });
        await ui.ready();
        const actions = ui.get('tgBatchesBody').children[0].children[6].children[0];
        ui.get('tgAdminAlert').textContent = '较早的错误提示';
        if (fromDetail) {
            await actions.children[0].trigger('click');
            const footer = descendants(ui.get('tgDetailContent')).find(item => item.className === 'tg-batch-detail-actions');
            assert.ok(footer); assert.equal(footer.children[0].textContent, '撤销此批次');
            await footer.children[0].trigger('click');
            assert.equal(ui.get('tgDetailModal').open, true);
            assert.match(allText(ui.get('tgDetailContent')), /已停用/);
            assert.doesNotMatch(allText(ui.get('tgDetailContent')), /撤销此批次/);
        } else await actions.children[1].trigger('click');
        assert.equal(revoked, true);
        assert.match(allText(ui.get('tgBatchesBody')), /已停用/);
        assert.equal(ui.get('tgAdminAlert').textContent, '');
        assert.doesNotMatch(allText(ui.get('tgBatchesBody')), /撤销批次/);
        assert.match(allText(ui.get('tgBatchesBody')), /20%/);
        assert.equal(businessCalls(ui).filter(call => call.request.method === 'POST').length, 1);
    }
});

test('failed revocation keeps the actionable error and leaves batch status unchanged', async () => {
    const ui = page({ batches: [{ id: 'failure', status: 'active' }], fetch: (url, request) => url.endsWith('/tg/codes') && request.method === 'POST' ? response({ success: false }, 503) : null });
    await ui.ready();
    await ui.get('tgBatchesBody').children[0].children[6].children[0].children[1].trigger('click');
    assert.equal(ui.get('tgAdminAlert').textContent, '服务暂不可用，请稍后重试');
    assert.equal(ui.get('tgAdminAlert').classList.contains('error'), true);
    assert.match(allText(ui.get('tgBatchesBody')), /启用/);
});


test('data center drilldown synchronizes paid-time fields, removable chips and list receipts', async () => {
    let navigation;
    const ui = page({ dataCenter: { money: (amount, currency) => amount + ' ' + currency, create(input) { navigation = input.navigate; return { async refresh() {}, reset() {}, setProvider() {} }; } },
        purchases: [{ order_no: 'TGP-ABCDEFGHIJKLMNOPQRST', username: 'telegram_user', product_family: 'telegram_premium', term_months: 3,
            currency: 'CNY', total_minor: 99999, payment_status: 'paid', fulfillment_status: 'succeeded', receipt_amount: '13.000001', receipt_currency: 'USDT', pay_currency: 'usdtton', receipt_confirmed: true, paid_at: '2026-10-17T07:30:00Z' }] });
    await ui.ready();
    await navigation('Purchase', { data_center: '1', from: '2026-10-10T16:00:00.000Z', to: '2026-10-17T07:30:00.000Z', as_of: '2026-10-17T07:30:00.000Z', date_field: 'paid_at', receipt: 'confirmed', currency: 'USDT', pay_currency: 'usdtton' });
    assert.equal(ui.get('tgAdminPanelPurchases').hidden, false);
    assert.equal(ui.get('tgPurchaseFrom').value, '2026-10-11T00:00:00');
    assert.match(ui.get('tgPurchaseFromLabel').textContent, /付款确认时间.*北京时间/);
    assert.equal(ui.get('tgPurchaseTimeHeading').textContent, '付款确认时间');
    assert.match(ui.calls.at(-1).url, /date_field=paid_at/); assert.match(ui.calls.at(-1).url, /pay_currency=usdtton/);
    const body = ui.get('tgPurchasesBody').children[0];
    assert.match(body.children.map(el => el.textContent || el.children.map(child => child.textContent).join('')).join(' '), /13\.000001 USDT/);
    const context = ui.get('tgPurchaseDataCenterContext');
    const currencyChip = context.children.find(child => child.children?.some(el => el['aria-label'] === '移除筛选：收款 USDT'));
    assert.ok(currencyChip); await currencyChip.children[1].trigger('click');
    assert.doesNotMatch(ui.calls.at(-1).url, /(?:[?&])currency=/); assert.match(ui.calls.at(-1).url, /date_field=paid_at/);
    await context.children[0].trigger('click'); assert.equal(ui.get('tgAdminPanelDashboard').hidden, false);
});

test('delivery and code drilldowns retain completion/source and inventory predicates in details', async () => {
    let navigation;
    const ui = page({ dataCenter: { money: (amount, currency) => amount + ' ' + currency, create(input) { navigation = input.navigate; return { async refresh() {}, reset() {}, setProvider() {} }; } },
        batches: [{ id: 'batch-id', batch_no: 'TGB-EXAMPLE', product_family: 'telegram_premium', term_months: 3, status: 'active', quantity: 10, generated_count: 10, redeemed_count: 2, matching_code_count: 4 }] });
    await ui.ready();
    await navigation('Order', { data_center: '1', date_field: 'completed_at', status: 'succeeded', order_source: 'all' });
    assert.equal(ui.get('tgOrderFilter').value, 'succeeded'); assert.equal(ui.get('tgOrderTimeHeading').textContent, '交付完成时间');
    assert.match(ui.calls.at(-1).url, /order_source=all/); assert.match(ui.calls.at(-1).url, /date_field=completed_at/);
    await navigation('Batch', { data_center: '1', inventory: 'expiring', as_of: '2026-10-17T07:30:00.000Z' });
    assert.match(ui.calls.at(-1).url, /inventory=expiring/);
    const detail = ui.get('tgBatchesBody').children[0].children[6].children[0].children[0];
    await detail.trigger('click');
    assert.ok(ui.calls.some(call => call.url.includes('batchId=batch-id') && call.url.includes('inventory=expiring') && call.url.includes('as_of=')));
});

const COMPLETION_ORDER = { ...REVIEW_ORDER, payment_status: 'paid', paid_at: OPERATIONS_VERSION, fulfillment_status: 'manual_review' };
const COMPLETION_TASK = 'f47ac10b-58cc-4372-a567-0e02b2c3d480';
const COMPLETION_NOTE = '已与您核对并完成退款，到账时间以支付渠道为准。';
const completionCapability = (patch = {}) => ({ ready: true, can_complete: true, expected_updated_at: OPERATIONS_VERSION,
    expected_task_id: COMPLETION_TASK, expected_task_updated_at: OPERATIONS_VERSION, upstream_submitted: true, ...patch });
function completionPage(options = {}) {
    return reviewPage({ ...options, purchases: options.purchases || [COMPLETION_ORDER], fetch: async (url, req) => {
        if (options.fetch) { const result = await options.fetch(url, req); if (result) return result; }
        if (url.includes('&completion=1')) return response({ success: true, order_no: COMPLETION_ORDER.order_no, completion: completionCapability(options.capability) });
        if (url.includes(`/tg/purchases?order_no=${COMPLETION_ORDER.order_no}`)) return response({ success: true, order: COMPLETION_ORDER, history: [] });
        return null;
    } });
}
function completionControls(ui) {
    const section = descendants(ui.get('tgDetailContent')).find(item => item.tag === 'section' && item.attributes.get('aria-label') === '人工完结');
    if (!section) return null;
    return { section, check: findButton(section, '填写完结说明') || findButton(section, '重新核对完结条件'),
        submit: descendants(section).find(item => item.tag === 'button' && /确认完结订单|查询并重试本次完结|正在完结/.test(item.textContent)),
        outcome: fieldByLabel(section, '实际处理结果'), internal: fieldByLabel(section, '内部处理依据'), publicNote: fieldByLabel(section, '给用户的完结说明'),
        confirmations: descendants(section).filter(item => item.tag === 'input' && item.type === 'checkbox') };
}
async function fillCompletion(controls) {
    controls.outcome.value = 'refunded'; await controls.outcome.trigger('change');
    controls.internal.value = '已核对退款平台，原退款凭据编号留存于工单。'; await controls.internal.trigger('input');
    controls.publicNote.value = COMPLETION_NOTE; await controls.publicNote.trigger('input');
    for (const input of controls.confirmations) { input.checked = true; await input.trigger('change'); }
}
const completionWrites = ui => ui.calls.filter(call => call.url === '/api/admin/tg/purchases' && call.request.method === 'POST' && JSON.parse(call.request.body).action === 'complete_review');
async function openCompletion(ui) { await ui.ready(); await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click'); return completionControls(ui); }

test('manual completion requires a fresh eligibility read, a real outcome, both notes and all confirmations', async () => {
    const ui = completionPage(); const controls = await openCompletion(ui);
    assert.ok(controls); assert.equal(controls.submit.hidden, true); assert.equal(controls.submit.disabled, true);
    await controls.check.trigger('click'); assert.equal(controls.submit.hidden, false); assert.equal(controls.submit.disabled, true);
    controls.outcome.value = 'refunded'; await controls.outcome.trigger('change');
    controls.publicNote.value = COMPLETION_NOTE; await controls.publicNote.trigger('input');
    assert.equal(controls.submit.disabled, true); await controls.submit.trigger('click'); assert.equal(completionWrites(ui).length, 0);
    await fillCompletion(controls); assert.equal(controls.submit.disabled, false);
    assert.match(contentText(controls.section), /用户订单 · 已完结.*已与您核对并完成退款/);
    controls.confirmations[2].checked = false; await controls.confirmations[2].trigger('change'); assert.equal(controls.submit.disabled, true);
    assert.match(contentText(controls.section), /不能撤回上游/);
});

test('manual completion cannot be enabled by absent migration, active task or another purchase capability', async () => {
    for (const capability of [{ ready: false, can_complete: true, message: '请先执行数据库迁移' },
        { can_complete: false, message: '原发货任务仍在运行' }]) {
        const ui = completionPage({ capability }); const controls = await openCompletion(ui); await controls.check.trigger('click');
        assert.equal(controls.submit.hidden, true); await fillCompletion(controls); await controls.submit.trigger('click');
        assert.equal(completionWrites(ui).length, 0); assert.match(contentText(controls.section), /请先执行数据库迁移|原发货任务仍在运行/);
    }
    const ui = completionPage({ fetch: url => url.includes('&completion=1') ? response({ success: true, order_no: 'TGP-ZYXWVUTSRQPONMLKJIHG', completion: completionCapability() }) : null });
    const controls = await openCompletion(ui); await controls.check.trigger('click'); assert.equal(controls.submit.disabled, true);
    assert.match(contentText(controls.section), /尚未确认/); assert.equal(completionWrites(ui).length, 0);
});

test('manual completion rechecks clear the prior confirmations and bind the latest versions', async () => {
    let checks = 0;
    const ui = completionPage({ fetch: url => url.includes('&completion=1') ? response({ success: true, order_no: COMPLETION_ORDER.order_no,
        completion: completionCapability({ expected_updated_at: checks++ ? REVIEW_ORDER.updated_at : OPERATIONS_VERSION }) }) : null });
    const controls = await openCompletion(ui); await controls.check.trigger('click'); await fillCompletion(controls);
    await controls.check.trigger('click'); assert.ok(controls.confirmations.every(input => !input.checked)); assert.equal(controls.submit.disabled, true);
});

test('manual completion submits once, freezes controls and renders the committed explanation even while list refreshes lag', async () => {
    const pending = deferred(); let closed = false;
    const completed = { ...COMPLETION_ORDER, fulfillment_status: 'closed', closed_at: OPERATIONS_VERSION, completion_note: COMPLETION_NOTE };
    const ui = completionPage({ fetch: (url, req) => {
        if (url === '/api/admin/tg/purchases' && req.method === 'POST') return pending.promise;
        if (closed && url.includes('/tg/purchases?') && !url.includes('&completion=1')) return response(url.includes('order_no=')
            ? { success: true, order: completed, history: [{ event_type: 'purchase_manually_completed', metadata: { note: '内部处理依据已存档' } }] }
            : { success: true, purchases: [completed], total: 1 });
        return null;
    } });
    const controls = await openCompletion(ui); await controls.check.trigger('click'); await fillCompletion(controls);
    const submitting = controls.submit.trigger('click'); await tick(); await controls.submit.trigger('click');
    assert.equal(completionWrites(ui).length, 1); assert.equal(controls.submit.disabled, true); assert.equal(controls.publicNote.disabled, true); assert.equal(controls.check.disabled, true);
    const payload = JSON.parse(completionWrites(ui)[0].request.body);
    assert.equal(payload.action, 'complete_review'); assert.equal(payload.outcome, 'refunded'); assert.equal(payload.completion_note, COMPLETION_NOTE);
    assert.equal(payload.expected_task_id, COMPLETION_TASK); assert.equal(payload.expected_updated_at, OPERATIONS_VERSION);
    assert.ok(payload.confirm_payment_handled && payload.confirm_stop_fulfillment && payload.confirm_upstream_risk);
    closed = true; pending.resolve(response({ success: true, existing: false, order: completed })); await submitting;
    assert.equal(completionControls(ui), null); assert.match(contentText(ui.get('tgDetailContent')), /用户可见的完结说明/);
    assert.match(contentText(ui.get('tgDetailContent')), new RegExp(COMPLETION_NOTE)); assert.match(contentText(ui.get('tgDetailContent')), /管理员已人工完结/);
    assert.match(contentText(ui.get('tgPurchasesBody')), /已完结/); assert.equal(ui.get('tgDetailModal').open, true);
});

test('uncertain manual completion freezes edits and retries the identical operation and payload', async () => {
    let writes = 0;
    const ui = completionPage({ fetch: (url, req) => {
        if (url === '/api/admin/tg/purchases' && req.method === 'POST') {
            if (++writes === 1) throw new Error('response_lost');
            return response({ success: true, existing: true, order: { ...COMPLETION_ORDER, fulfillment_status: 'closed', closed_at: OPERATIONS_VERSION, completion_note: COMPLETION_NOTE } });
        }
        return null;
    } });
    const controls = await openCompletion(ui); await controls.check.trigger('click'); await fillCompletion(controls); await controls.submit.trigger('click');
    assert.equal(controls.submit.textContent, '查询并重试本次完结'); assert.equal(controls.submit.disabled, false);
    assert.equal(controls.publicNote.disabled, true); assert.equal(controls.outcome.disabled, true); assert.equal(controls.check.disabled, true);
    await controls.submit.trigger('click'); assert.equal(completionWrites(ui).length, 2);
    assert.equal(completionWrites(ui)[0].request.body, completionWrites(ui)[1].request.body);
    assert.match(contentText(ui.get('tgDetailContent')), /订单已完结，用户端将显示完结说明/);
});

test('a stale completion version remains blocked until eligibility and all confirmations are checked again', async () => {
    const ui = completionPage({ fetch: (url, req) => url === '/api/admin/tg/purchases' && req.method === 'POST'
        ? response({ success: false, code: 'completion_stale', message: '订单版本已变化' }, 409) : null });
    const controls = await openCompletion(ui); await controls.check.trigger('click'); await fillCompletion(controls); await controls.submit.trigger('click');
    assert.equal(controls.submit.disabled, true); assert.equal(controls.publicNote.disabled, true); assert.match(contentText(controls.section), /重新核对/);
    await controls.submit.trigger('click'); assert.equal(completionWrites(ui).length, 1);
    await controls.check.trigger('click'); assert.ok(controls.confirmations.every(input => !input.checked)); assert.equal(controls.submit.disabled, true);
});

for (const result of [{ success: true, existing: false, order: { ...COMPLETION_ORDER, fulfillment_status: 'closed', completion_note: COMPLETION_NOTE } },
    { success: true, existing: false, order: { ...COMPLETION_ORDER, closed_at: OPERATIONS_VERSION, fulfillment_status: 'closed', completion_note: '另外一份未确认的说明' } },
    { success: true, existing: false, order: COMPLETION_ORDER }]) test('incomplete or inconsistent completion replies preserve an uncertain retry instead of declaring success', async () => {
    const ui = completionPage({ fetch: (url, req) => url === '/api/admin/tg/purchases' && req.method === 'POST' ? response(result) : null });
    const controls = await openCompletion(ui); await controls.check.trigger('click'); await fillCompletion(controls); await controls.submit.trigger('click');
    assert.match(contentText(controls.section), /尚未收到完结确认/); assert.equal(controls.submit.textContent, '查询并重试本次完结');
    assert.ok(completionControls(ui)); assert.doesNotMatch(contentText(ui.get('tgDetailContent')), /订单已完结，用户端将显示完结说明/);
});

test('dismissing a pending completion read invalidates its detached controls', async () => {
    const pending = deferred(); const ui = completionPage({ fetch: url => url.includes('&completion=1') ? pending.promise : null });
    const controls = await openCompletion(ui); const checking = controls.check.trigger('click'); await tick(); await ui.get('tgDetailClose').trigger('click');
    pending.resolve(response({ success: true, order_no: COMPLETION_ORDER.order_no, completion: completionCapability() })); await checking;
    await fillCompletion(controls); await controls.submit.trigger('click'); assert.equal(completionWrites(ui).length, 0); assert.equal(ui.get('tgDetailModal').open, false);
});

test('completion committed after dismissal refreshes lists without reopening the dialog', async () => {
    const pending = deferred(); const ui = completionPage({ fetch: (url, req) => url === '/api/admin/tg/purchases' && req.method === 'POST' ? pending.promise : null });
    const controls = await openCompletion(ui); await controls.check.trigger('click'); await fillCompletion(controls);
    const submitting = controls.submit.trigger('click'); await tick(); await ui.get('tgDetailClose').trigger('click');
    pending.resolve(response({ success: true, existing: false, order: { ...COMPLETION_ORDER, closed_at: OPERATIONS_VERSION, fulfillment_status: 'closed', completion_note: COMPLETION_NOTE } })); await submitting;
    assert.equal(ui.get('tgDetailModal').open, false); assert.equal(ui.get('tgDetailContent').children.length, 0);
});

function fakeNoticeTimers() {
    const active = new Map(); const cancelled = []; let next = 0;
    return { active, cancelled, setTimeout(fn, ms) { const id = ++next; active.set(id, { fn: () => { active.delete(id); fn(); }, ms }); return id; }, clearTimeout(id) { cancelled.push(id); active.delete(id); } };
}
async function saveNote(ui) {
    await findButton(ui.get('tgPurchasesBody'), '详情 / 处理').trigger('click');
    const note = fieldByLabel(ui.get('tgDetailContent'), '处理原因'); note.value = '已核对并留存内部记录';
    await findButton(ui.get('tgDetailContent'), '保存核对记录').trigger('click');
}
test('operation success disappears in three seconds and an older timer cannot erase a newer notice', async () => {
    const timers = fakeNoticeTimers(); const ui = reviewPage({ ...timers }); await ui.ready(); await saveNote(ui);
    assert.match(ui.get('tgAdminAlert').textContent, /核对记录已保存，订单状态未变更/);
    const [oldId, old] = [...timers.active].find(([, timer]) => timer.ms === 3000); assert.ok(old);
    await saveNote(ui); assert.ok(timers.cancelled.includes(oldId));
    old.fn(); assert.match(ui.get('tgAdminAlert').textContent, /核对记录已保存/);
    const current = [...timers.active.values()].find(timer => timer.ms === 3000); current.fn();
    assert.equal(ui.get('tgAdminAlert').textContent, ''); assert.equal(ui.get('tgAdminAlert').classList.contains('success'), false);
});

test('operation errors disappear in seven seconds and logout clears outstanding notices', async () => {
    const timers = fakeNoticeTimers(); const ui = reviewPage({ ...timers, fetch: (url, req) => url === '/api/admin/tg/purchases' && req.method === 'POST'
        ? response({ success: false, message: '保存失败，请稍后重试' }, 500) : null }); await ui.ready(); await saveNote(ui);
    assert.match(ui.get('tgAdminAlert').textContent, /服务暂不可用/); const error = [...timers.active.values()].find(timer => timer.ms === 7000); assert.ok(error);
    error.fn(); assert.equal(ui.get('tgAdminAlert').textContent, '');
    await saveNote(ui); assert.match(ui.get('tgAdminAlert').textContent, /服务暂不可用/);
    await ui.get('tgAdminLogout').trigger('click'); assert.equal(ui.get('tgAdminAlert').textContent, ''); assert.equal(timers.active.size, 0);
});

const PAYMENT_REVIEW_ORDER = { ...COMPLETION_ORDER, payment_status: 'manual_review', paid_at: null, fulfillment_status: 'not_started', last_error_code: 'payment_create_unconfirmed' };
const NO_PAYMENT_NOTE = '已核对原支付订单，未发现有效付款，本订单现已完结。如有付款凭据请联系管理员。';
function paymentCompletionPage(options = {}) {
    return completionPage({ ...options, purchases: [PAYMENT_REVIEW_ORDER], fetch: async (url, req) => {
        if (options.fetch) { const result = await options.fetch(url, req); if (result) return result; }
        if (url.includes('&completion=1')) return response({ success: true, order_no: PAYMENT_REVIEW_ORDER.order_no,
            completion: completionCapability({ payment_unverified: true, expected_task_id: null, expected_task_updated_at: null,
                upstream_submitted: false, allowed_outcomes: ['no_valid_payment', 'refunded', 'agreed_settlement'], ...options.capability }) });
        if (url.includes(`/tg/purchases?order_no=${PAYMENT_REVIEW_ORDER.order_no}`)) return response({ success: true, order: PAYMENT_REVIEW_ORDER, history: [] });
        return null;
    } });
}

test('payment exceptions expose manual completion with dynamic custom selects and no failing legacy close check', async () => {
    const enhanced = []; const synced = [];
    const ui = paymentCompletionPage({ selects: { close() {}, enhance(root) { enhanced.push(root); }, sync(root) { synced.push(root); } } });
    const controls = await openCompletion(ui);
    assert.ok(controls); assert.equal(findButton(ui.get('tgDetailContent'), '核对关闭条件'), undefined);
    assert.ok(enhanced.some(root => descendants(root).includes(controls.outcome)), 'the attached completion form must enter the custom-select enhancer');
    await controls.check.trigger('click');
    assert.deepEqual(controls.outcome.children.map(option => option.value), ['', 'no_valid_payment', 'refunded', 'agreed_settlement']);
    assert.match(contentText(controls.section), /迟到付款仍需另行处理/);
    assert.match(controls.internal.placeholder, /链上核验/);
    assert.ok(synced.includes(controls.section)); assert.equal(controls.submit.disabled, true);
    controls.outcome.value = 'delivery_confirmed'; await controls.outcome.trigger('change');
    controls.internal.value = '已核对原支付渠道，尚无有效到账记录'; controls.publicNote.value = NO_PAYMENT_NOTE;
    for (const input of controls.confirmations) input.checked = true;
    await controls.publicNote.trigger('input'); await controls.submit.trigger('click');
    assert.equal(controls.submit.disabled, true); assert.equal(completionWrites(ui).length, 0);
});

test('payment exception completion records no-payment outcome and exposes committed customer copy without altering payment status', async () => {
    const completed = { ...PAYMENT_REVIEW_ORDER, fulfillment_status: 'closed', closed_at: OPERATIONS_VERSION, completion_note: NO_PAYMENT_NOTE };
    const ui = paymentCompletionPage({ fetch: (url, req) => url === '/api/admin/tg/purchases' && req.method === 'POST'
        ? response({ success: true, existing: false, order: completed }) : null });
    const controls = await openCompletion(ui); await controls.check.trigger('click');
    await fillCompletion(controls); controls.outcome.value = 'no_valid_payment'; controls.publicNote.value = NO_PAYMENT_NOTE;
    controls.internal.value = '已核对支付平台的原订单和链上到账记录，确认无有效付款。';
    await controls.outcome.trigger('change'); assert.equal(controls.submit.disabled, false);
    await controls.submit.trigger('click');
    const sent = JSON.parse(completionWrites(ui)[0].request.body);
    assert.equal(sent.outcome, 'no_valid_payment'); assert.equal(sent.expected_task_id, null); assert.equal(sent.expected_task_updated_at, null);
    assert.equal(sent.completion_note, NO_PAYMENT_NOTE); assert.match(contentText(ui.get('tgDetailContent')), /已完结/);
    assert.match(contentText(ui.get('tgDetailContent')), /人工核对/); assert.ok(contentText(ui.get('tgDetailContent')).includes(NO_PAYMENT_NOTE));
    assert.equal(completionControls(ui), null);
});

test('a verified receipt arriving before recheck removes no-payment outcome and clears prior confirmations', async () => {
    let checks = 0;
    const ui = paymentCompletionPage({ fetch: url => url.includes('&completion=1') && checks++ > 0 ? response({ success: true,
        order_no: PAYMENT_REVIEW_ORDER.order_no, completion: completionCapability({ payment_unverified: false,
            allowed_outcomes: ['refunded', 'delivery_confirmed', 'agreed_settlement'] }) }) : null });
    const controls = await openCompletion(ui); await controls.check.trigger('click'); await fillCompletion(controls);
    controls.outcome.value = 'no_valid_payment'; await controls.outcome.trigger('change');
    await controls.check.trigger('click');
    assert.equal(controls.outcome.value, ''); assert.deepEqual(controls.outcome.children.map(option => option.value), ['', 'refunded', 'delivery_confirmed', 'agreed_settlement']);
    assert.ok(controls.confirmations.every(input => !input.checked)); assert.equal(controls.submit.disabled, true);
    assert.equal(completionWrites(ui).length, 0);
});

test('an uninstalled payment-review increment explains the required upgrade without enabling settlement inputs', async () => {
    const ui = paymentCompletionPage({ capability: { ready: false, can_complete: false, allowed_outcomes: [], message: '支付人工核对订单的完结功能需要增量数据库升级' } });
    const controls = await openCompletion(ui); await controls.check.trigger('click');
    assert.match(contentText(controls.section), /增量数据库升级/); assert.equal(controls.submit.hidden, true);
    assert.equal(controls.outcome.disabled, true); assert.equal(completionWrites(ui).length, 0);
});

function redemptionResolutionPage(options = {}) {
    return page({ orders: [FULFILLMENT_ROW], ...options, fetch: async (url, req) => {
        const custom = await options.fetch?.(url, req); if (custom) return custom;
        if (url.includes('/tg/orders?order_no=') && url.includes('&operation_id=')) return response({ success: true,
            operation_id: new URL(url, LOCAL_ADMIN_URL).searchParams.get('operation_id'), state: 'not_recorded',
            order: { id: FULFILLMENT_ID, order_no: FULFILLMENT_ROW.order_no, status: 'manual_review' } });
        if (url.includes('/tg/orders?orderId=')) return response(redemptionResolutionData(options.data));
        if (url === '/api/admin/tg/orders' && req.method === 'POST') {
            const input = JSON.parse(req.body);
            if (input.action.startsWith('inspect_')) return response({ success: true, order_no: FULFILLMENT_ROW.order_no,
                expected_updated_at: REDEMPTION_VERSION, expected_code_updated_at: REDEMPTION_VERSION, message: '已核验原请求；查无结果不能代替未受理凭据。' });
        }
        return null;
    } });
}
const redemptionPanel = ui => descendants(ui.get('tgDetailContent')).find(item => item.className?.includes('tg-resolution-fields') && !item.hidden);
const redemptionPosts = ui => ui.calls.filter(call => call.url === '/api/admin/tg/orders' && call.request.method === 'POST').map(call => JSON.parse(call.request.body));
async function setRedemptionField(ui, label, value, event = 'input') {
    const field = fieldByLabel(redemptionPanel(ui), label); assert.ok(field, label); field.value = value; await field.trigger(event); return field;
}
async function fillRedemptionCompletion(ui) {
    await setRedemptionField(ui, '兑换单实际处理结果', 'refunded', 'change');
    await setRedemptionField(ui, '兑换单内部处理依据', '已核实原渠道退款，内部凭据 PRIVATE-REFUND-123。');
    await setRedemptionField(ui, '兑换单给用户的完结说明', '已完成退款处理，本兑换订单已完结。');
    for (const input of descendants(redemptionPanel(ui)).filter(item => item.type === 'checkbox')) { input.checked = true; await input.trigger('change'); }
}

test('redemption migration gating disables all three routes while keeping existing read-only detail usable', async () => {
    const ui = redemptionResolutionPage({ data: { resolution: { ready: false, can_link: false, can_record_nonacceptance: false, can_complete: false, message: '请先执行兑换单结案迁移及只读验证。' } } });
    await ui.ready(); await fulfillmentButton(ui).trigger('click');
    for (const label of ['补录原上游订单', '凭未受理证明结案', '人工完结']) {
        const button = findButton(ui.get('tgDetailContent'), label); assert.equal(button.disabled, true); await button.trigger('click');
    }
    assert.match(contentText(ui.get('tgDetailContent')), /执行兑换单结案迁移/); assert.equal(redemptionPanel(ui), undefined);
    assert.equal(findButton(ui.get('tgDetailContent'), '查询上游状态').disabled, false); assert.equal(redemptionPosts(ui).length, 0);
});

test('redemption resolution routes are mutually exclusive and use the shared custom select enhancer', async () => {
    const enhanced = [], synced = [];
    const ui = redemptionResolutionPage({ selects: { close() {}, enhance: root => enhanced.push(root), sync: root => synced.push(root) } });
    await ui.ready(); await fulfillmentButton(ui).trigger('click');
    const root = ui.get('tgDetailContent'); await findButton(root, '人工完结').trigger('click'); const complete = redemptionPanel(ui);
    assert.equal(findButton(complete, '确认完结订单').disabled, true); assert.equal(fieldByLabel(complete, '兑换单实际处理结果').value, '');
    await findButton(root, '凭未受理证明结案').trigger('click'); const negative = redemptionPanel(ui);
    assert.equal(complete.hidden, true); assert.notEqual(complete, negative); assert.equal(findButton(negative, '确认完结订单').disabled, true);
    await findButton(root, '凭未受理证明结案').trigger('click'); assert.equal(redemptionPanel(ui), undefined);
    assert.ok(enhanced.length > 0); assert.ok(synced.length > 0); assert.equal(redemptionPosts(ui).length, 0);
});

test('redemption link keeps its checked proof while notes change and invalidates it when the upstream UUID changes', async () => {
    const ui = redemptionResolutionPage(); await ui.ready(); await fulfillmentButton(ui).trigger('click');
    await findButton(ui.get('tgDetailContent'), '补录原上游订单').trigger('click');
    await setRedemptionField(ui, '原上游订单号', 'f47ac10b-58cc-4372-a567-0e02b2c3d482');
    const form = redemptionPanel(ui); const submit = findButton(form, '确认补录并同步'); assert.equal(submit.disabled, true);
    await findButton(form, '核验原上游订单').trigger('click');
    await setRedemptionField(ui, '兑换单内部处理依据', '已核验原上游订单和本次提交标识。');
    const confirmation = descendants(form).find(item => item.type === 'checkbox'); confirmation.checked = true; await confirmation.trigger('change');
    assert.equal(submit.disabled, false); await setRedemptionField(ui, '兑换单内部处理依据', '已核验原上游订单和本次提交标识，内部记录已归档。'); assert.equal(submit.disabled, false);
    await setRedemptionField(ui, '原上游订单号', 'f47ac10b-58cc-4372-a567-0e02b2c3d483'); assert.equal(submit.disabled, true);
    assert.equal(redemptionPosts(ui).length, 1); assert.equal(redemptionPosts(ui)[0].action, 'inspect_upstream_order');
    assert.match(contentText(ui.get('tgDetailContent')), /订单号已变更，请重新核验/);
});

test('redemption nonacceptance needs explicit evidence, separate public note and all confirmations after lookup', async () => {
    const ui = redemptionResolutionPage({ data: { resolution: { can_release_code: false } } }); await ui.ready(); await fulfillmentButton(ui).trigger('click');
    await findButton(ui.get('tgDetailContent'), '凭未受理证明结案').trigger('click'); const form = redemptionPanel(ui);
    assert.deepEqual(fieldByLabel(form, '兑换码处置').children.map(item => item.value), ['revoked']);
    await findButton(form, '核对上游记录').trigger('click'); assert.equal(findButton(form, '确认完结订单').disabled, true);
    await setRedemptionField(ui, '凭据编号或链接', 'GRAMIX-TICKET-123');
    await setRedemptionField(ui, '上游确认时间', '2026-10-17T09:00');
    await setRedemptionField(ui, '上游明确答复', '上游已明确确认本次原始请求未受理且不会后续发货，客服工单已归档。');
    await setRedemptionField(ui, '兑换单内部处理依据', '核实工单和对应原始请求，登记未受理凭据。');
    await setRedemptionField(ui, '兑换单给用户的完结说明', '上游未受理此订单，兑换码已作废。');
    const checks = descendants(form).filter(item => item.type === 'checkbox');
    for (const input of checks.slice(0, -1)) { input.checked = true; await input.trigger('change'); }
    assert.equal(findButton(form, '确认完结订单').disabled, true);
    checks.at(-1).checked = true; await checks.at(-1).trigger('change'); assert.equal(findButton(form, '确认完结订单').disabled, false);
    assert.equal(redemptionPosts(ui).length, 1, 'checking never commits closure');
});

test('redemption response loss locks the original payload and reuses its UUID to confirm the same result', async () => {
    let saved = null, attempts = 0, closed = false;
    const ui = redemptionResolutionPage({ fetch: async (url, req) => {
        if (url === '/api/admin/tg/orders' && req.method === 'POST') {
            const input = JSON.parse(req.body); if (input.action !== 'complete_review') return null;
            attempts++; if (!saved) saved = input;
            if (attempts === 1) throw new Error('response lost');
            assert.deepEqual(input, saved); closed = true;
            return response({ success: true, existing: true, operation_id: input.operation_id,
                order: { id: FULFILLMENT_ID, order_no: FULFILLMENT_ROW.order_no, status: 'closed', completion_note: input.completion_note } });
        }
        if (closed && url.includes('/tg/orders?orderId=')) return response(redemptionResolutionData({ order: { status: 'closed' }, resolution: {
            can_complete: false, can_link: false, can_record_nonacceptance: false, completion: { closed_at: '2026-10-17T10:00:00Z',
                completion_outcome: 'refunded', completion_note: saved.completion_note, code_disposition: 'revoked' } } }));
        return null;
    } });
    await ui.ready(); await fulfillmentButton(ui).trigger('click'); await findButton(ui.get('tgDetailContent'), '人工完结').trigger('click');
    await fillRedemptionCompletion(ui); const form = redemptionPanel(ui); assert.equal(findButton(form, '确认完结订单').disabled, false);
    await findButton(form, '确认完结订单').trigger('click');
    assert.match(contentText(ui.get('tgDetailContent')), /尚未收到处理确认/); assert.equal(fieldByLabel(form, '兑换单内部处理依据').disabled, true);
    assert.equal(findButton(ui.get('tgDetailContent'), '补录原上游订单').disabled, true);
    await findButton(form, '查询并重试本次处理').trigger('click');
    assert.equal(attempts, 2); assert.equal(saved.expected_code_updated_at, REDEMPTION_VERSION); assert.equal(saved.expected_updated_at, REDEMPTION_VERSION);
    assert.notEqual(saved.note, saved.completion_note); assert.match(contentText(ui.get('tgDetailContent')), /完结结果|已作废，不能再次使用/);
    assert.ok(contentText(ui.get('tgDetailContent')).includes(saved.completion_note)); assert.equal(findButton(ui.get('tgDetailContent'), '人工完结'), undefined);
});

test('redemption validation conflicts retain explanations for correction without pretending completion', async () => {
    const ui = redemptionResolutionPage({ fetch: (url, req) => url === '/api/admin/tg/orders' && req.method === 'POST'
        ? response({ success: false, code: 'redemption_resolution_stale', message: '订单或兑换码已变化' }, 409) : null });
    await ui.ready(); await fulfillmentButton(ui).trigger('click'); await findButton(ui.get('tgDetailContent'), '人工完结').trigger('click'); await fillRedemptionCompletion(ui);
    const form = redemptionPanel(ui); await findButton(form, '确认完结订单').trigger('click');
    assert.match(contentText(ui.get('tgDetailContent')), /已变化.*刷新详情/); assert.equal(fieldByLabel(form, '兑换单内部处理依据').disabled, false);
    assert.match(fieldByLabel(form, '兑换单给用户的完结说明').value, /已完成退款处理/); assert.equal(findButton(form, '查询并重试本次处理'), undefined);
    assert.equal(findButton(ui.get('tgDetailContent'), '完结结果'), undefined);
});

test('redemption submission suppresses duplicate clicks and prevents closing or switching the active detail', async () => {
    const pending = deferred();
    const ui = redemptionResolutionPage({ fetch: (url, req) => url === '/api/admin/tg/orders' && req.method === 'POST' ? pending.promise : null });
    await ui.ready(); await fulfillmentButton(ui).trigger('click'); await findButton(ui.get('tgDetailContent'), '人工完结').trigger('click'); await fillRedemptionCompletion(ui);
    const submit = findButton(redemptionPanel(ui), '确认完结订单'); const sending = submit.trigger('click'); await tick();
    await submit.trigger('click'); await ui.get('tgDetailClose').trigger('click');
    assert.equal(ui.get('tgDetailModal').open, true); assert.equal(redemptionPosts(ui).length, 1);
    assert.equal(findButton(ui.get('tgDetailContent'), '补录原上游订单').disabled, true);
    pending.resolve(response({ success: false, message: '订单版本已变化' }, 409)); await sending;
    await ui.get('tgDetailClose').trigger('click'); assert.equal(ui.get('tgDetailModal').open, false);
});

test('redemption receipt query confirms an already applied result without repeating the POST', async () => {
    let input; let closed = false;
    const ui = redemptionResolutionPage({ fetch: (url, req) => {
        if (url === '/api/admin/tg/orders' && req.method === 'POST') { input = JSON.parse(req.body); throw new Error('response lost'); }
        if (url.includes('&operation_id=')) { closed = true; return response({ success: true, operation_id: input.operation_id, state: 'applied', action: input.action, existing: true,
            order: { id: FULFILLMENT_ID, order_no: FULFILLMENT_ROW.order_no, status: 'closed', completion_note: input.completion_note } }); }
        if (closed && url.includes('/tg/orders?orderId=')) return response(redemptionResolutionData({ order: { status: 'closed' }, resolution: { completion: {
            closed_at: '2026-10-17T10:00:00Z', completion_outcome: 'refunded', completion_note: input.completion_note, code_disposition: 'revoked' } } }));
        return null;
    } });
    await ui.ready(); await fulfillmentButton(ui).trigger('click'); await findButton(ui.get('tgDetailContent'), '人工完结').trigger('click'); await fillRedemptionCompletion(ui);
    await findButton(redemptionPanel(ui), '确认完结订单').trigger('click'); await findButton(redemptionPanel(ui), '查询处理结果').trigger('click');
    assert.equal(redemptionPosts(ui).length, 1); assert.match(contentText(ui.get('tgDetailContent')), /完结结果/);
    assert.equal([...ui.storage.keys()].some(key => key.startsWith('tg-admin-redemption-pending-v1:')), false);
});
test('pending redemption survives closing, reloading and a missing repair without a new operation or POST', async () => {
    const storage = new Map();
    const ui = redemptionResolutionPage({ storage, fetch: (url, req) => url === '/api/admin/tg/orders' && req.method === 'POST' ? Promise.reject(new Error('response lost')) : null });
    await ui.ready(); await fulfillmentButton(ui).trigger('click'); await findButton(ui.get('tgDetailContent'), '人工完结').trigger('click'); await fillRedemptionCompletion(ui);
    await findButton(redemptionPanel(ui), '确认完结订单').trigger('click'); const original = redemptionPosts(ui)[0];
    await ui.get('tgDetailClose').trigger('click'); await fulfillmentButton(ui).trigger('click');
    assert.match(contentText(ui.get('tgDetailContent')), /已恢复上次待确认操作/);
    assert.equal(fieldByLabel(redemptionPanel(ui), '兑换单内部处理依据').value, original.note);
    assert.equal(fieldByLabel(redemptionPanel(ui), '兑换单内部处理依据').disabled, true);
    const reload = redemptionResolutionPage({ storage, data: { resolution: { ready: false, can_complete: false, can_link: false, can_record_nonacceptance: false, message: '请执行处理确认修复及只读验证' } } });
    await reload.ready(); await fulfillmentButton(reload).trigger('click'); const form = redemptionPanel(reload);
    assert.ok(form); assert.equal(findButton(form, '查询并重试本次处理').disabled, true); assert.equal(findButton(form, '查询处理结果').disabled, false);
    await findButton(form, '查询处理结果').trigger('click');
    assert.match(contentText(reload.get('tgDetailContent')), /暂未查到.*人工复核.*确认修复/);
    assert.equal(redemptionPosts(reload).length, 0); assert.ok([...storage.values()].some(value => value.includes(original.operation_id)));
});
test('known database rejection shows the repair reason and retains the same operation for recovery', async () => {
    const ui = redemptionResolutionPage({ fetch: (url, req) => url === '/api/admin/tg/orders' && req.method === 'POST'
        ? response({ success: false, code: 'redemption_resolution_confirmation_required', not_applied: true, message: '兑换单处理确认功能需要增量数据库修复' }, 503) : null });
    await ui.ready(); await fulfillmentButton(ui).trigger('click'); await findButton(ui.get('tgDetailContent'), '人工完结').trigger('click'); await fillRedemptionCompletion(ui);
    await findButton(redemptionPanel(ui), '确认完结订单').trigger('click');
    assert.match(contentText(ui.get('tgDetailContent')), /增量数据库修复.*操作编号和说明已保留/);
    assert.equal(fieldByLabel(redemptionPanel(ui), '兑换单给用户的完结说明').disabled, true);
    await findButton(redemptionPanel(ui), '查询处理结果').trigger('click');
    assert.equal(redemptionPosts(ui).length, 1); assert.match(contentText(ui.get('tgDetailContent')), /暂未查到本次操作/);
});
test('an uncertain receipt lookup never starts a second POST and preserves the pending input', async () => {
    const ui = redemptionResolutionPage({ fetch: (url, req) => url === '/api/admin/tg/orders' && req.method === 'POST' ? Promise.reject(new Error('response lost'))
        : url.includes('&operation_id=') ? response({ success: false, message: 'offline' }, 500) : null });
    await ui.ready(); await fulfillmentButton(ui).trigger('click'); await findButton(ui.get('tgDetailContent'), '人工完结').trigger('click'); await fillRedemptionCompletion(ui);
    await findButton(redemptionPanel(ui), '确认完结订单').trigger('click'); await findButton(redemptionPanel(ui), '查询并重试本次处理').trigger('click');
    assert.equal(redemptionPosts(ui).length, 1); assert.equal(fieldByLabel(redemptionPanel(ui), '兑换单内部处理依据').disabled, true);
});


test('purchase review reserves its detail layout before the request completes and removes placeholders on errors', async () => {
    const pending = deferred();
    const ui = reviewPage({ fetch: async url => url.includes('/tg/purchases?orderNo=') ? pending.promise : null });
    await ui.ready();
    const open = purchaseReviewButton(ui).trigger('click'); await tick();
    const content = ui.get('tgPurchaseReviewContent');
    assert.equal(ui.get('tgPurchaseReviewModal').open, true);
    assert.equal(content.attributes.get('aria-busy'), 'true');
    assert.equal(descendants(content).filter(item => item.tag === 'dt').length, 12);
    assert.match(allText(content), new RegExp(REVIEW_ORDER.order_no));
    assert.equal(ui.get('tgPurchaseReviewForm').hidden, true);
    assert.equal(ui.get('tgPurchaseReviewRecheck').disabled, true);
    assert.equal(approvalCalls(ui).length, 0);
    pending.resolve(response(reviewData(REVIEW_ORDER, { fulfillment: { id: 'task', order_no: 'TG-ABCDEFGHIJKLMNOPQRST', has_provider_order: true } }))); await open;
    assert.equal(content.attributes.get('aria-busy'), 'false');
    assert.equal(descendants(content).filter(item => item.tag === 'dt').length, 12);
    assert.equal(descendants(content).some(item => /tg-skeleton/.test(item.className || '')), false);
    const css = fs.readFileSync(require.resolve('../css/tg-admin.css'), 'utf8');
    assert.match(css, /\.tg-purchase-review\[open\]\s*\{[^}]*display: flex/);
    assert.match(css, /\.tg-purchase-review-body\s*\{[^}]*overflow-y: auto/);

    const failed = reviewPage({ fetch: async url => url.includes('/tg/purchases?orderNo=') ? response({ success: false, message: '暂时无法核对' }, 503) : null });
    await failed.ready(); await purchaseReviewButton(failed).trigger('click');
    assert.equal(failed.get('tgPurchaseReviewModal').open, true);
    assert.match(failed.get('tgPurchaseReviewMessage').textContent, /服务暂不可用/);
    assert.equal(failed.get('tgPurchaseReviewContent').attributes.get('aria-busy'), 'false');
    assert.equal(descendants(failed.get('tgPurchaseReviewContent')).some(item => /tg-skeleton/.test(item.className || '')), false);
    assert.equal(failed.get('tgPurchaseReviewRecheck').disabled, false);
});
