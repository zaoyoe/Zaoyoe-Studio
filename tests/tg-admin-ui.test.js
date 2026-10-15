'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(require.resolve('../js/tg-admin.js'), 'utf8');
const html = fs.readFileSync(require.resolve('../tg-admin.html'), 'utf8');
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
            classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name) },
            addEventListener(name, listener) { this.listeners.set(name, listener); },
            append(...nodes) { this.children.push(...nodes); },
            replaceChildren(...nodes) { this.children = nodes; },
            showModal() { this.open = true; },
            close() { this.open = false; this.listeners.get('close')?.({ currentTarget: this }); },
            focus() { this.focused = true; }, select() { this.selected = true; },
            reset() { this.resetCalled = true; },
            async trigger(name) { await this.listeners.get(name)?.({ preventDefault() {}, currentTarget: this }); }
        };
    }
    const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element };
    const get = document.getElementById;
    get('tgLoginForm').elements = { email: { value: 'Admin@Example.Test ' }, password: { value: 'never-persist-this' } };
    for (const id of ['tgGoogleLogin', 'tgLoginSubmit']) get(id).disabled = true;
    get('tgGenerateForm').entries = { product_family: 'telegram_premium', term_months: '3', count: '1', name: '首发批次', valid_until: '' };
    get('tgOrderFilter').value = '';
    const client = { auth: {
        async signInWithPassword(input) { authCalls.push({ action: 'login', ...input }); if (options.signInThrows) throw new Error('network_unavailable'); if (options.signInError) return { error: Object.assign(new Error('private provider error'), { code: options.signInError === true ? 'invalid_credentials' : options.signInError }) }; signedIn = true; return { data: { user: USER } }; },
        async signInWithOAuth(input) { authCalls.push({ action: 'oauth', ...input }); timeline.push('oauth'); if (options.oauth) return options.oauth(input); return { data: { url: options.authorizeUrl || validAuthorizeUrl(input.options.redirectTo) } }; },
        async exchangeCodeForSession(code) { authCalls.push({ action: 'exchange', code }); timeline.push('exchange'); if (options.exchange) { const result = await options.exchange(code); if (!result.error) signedIn = true; return result; } signedIn = true; return { data: { user: USER } }; },
        async signOut(input) { signedIn = false; authCalls.push({ action: 'logout', ...input }); }
    } };
    const window = { document,
        URL, URLSearchParams,
        location: { origin: currentUrl.origin, href: currentUrl.href, assign(url) { navigation.push(url); timeline.push('navigate'); } },
        history: { replaceState(_state, _title, url) { history.push(url); timeline.push('clean-url'); window.location.href = new URL(url, currentUrl).href; } },
        sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
        FormData: class { constructor(form) { this.form = form; } entries() { return Object.entries(this.form.entries); } },
        requireZaoyoeSupabaseConfig: () => ({ url: 'https://database.example.test', publishableKey: 'public-key' }),
        supabase: { createClient(...args) { configurations.push(args); return client; } },
        AdminAccess: {
            async getCurrentAdminAccess(input) { accessCalls.push({ action: 'verify', ...input }); timeline.push('verify'); return { user: signedIn ? USER : null, isSuperAdmin: options.isSuperAdmin !== false, error: options.accessError }; },
            async createAdminStudioSession(input) { accessCalls.push({ action: 'issue', ...input }); timeline.push('issue'); return { ok: true }; },
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
    vm.runInNewContext(script, { window, URLSearchParams, Date });
    return { get, calls, accessCalls, authCalls, configurations, confirmations, events, client, window, storage, navigation, history, timeline, async ready() { await tick(); await tick(); } };
}

test('TG administration uses independent local assets and no HTML interpolation', () => {
    assert.match(html, /\/vendor\/supabase\/2\.95\.3\/supabase\.js/);
    assert.match(html, /\/js\/admin-access\.js/);
    assert.match(html, /\/css\/tg-admin\.css/);
    assert.match(html, /id="tgGoogleLogin"[^>]*disabled/);
    assert.match(html, /id="tgLoginSubmit"[^>]*disabled/);
    assert.doesNotMatch(script, /\.innerHTML\b|localStorage/);
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
    assert.equal(ui.get('tgAdminIdentity').textContent, USER.email);
    assert.ok(ui.calls.every((call) => call.request.credentials === 'same-origin'));
    for (const options of [{ signedIn: false }, { isSuperAdmin: false }]) {
        const denied = page(options); await denied.ready();
        assert.equal(denied.get('tgAdminApp').hidden, true);
        assert.equal(businessCalls(denied).length, 0);
        assert.ok(!denied.accessCalls.some((call) => call.action === 'issue'));
    }
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
    const actions = ui.get('tgBatchesBody').children[0].children[5].children[0];
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
    assert.equal(ui.get('tgAdminIdentity').textContent, USER.email);
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
