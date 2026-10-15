import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const diagnostic = require('../public/checkout-diagnostic.js');

const catalog = { version: 1, defaultRegion: 'US', regions: [
    { id: 'US', label: '美国', currency: 'USD' }, { id: 'PH', label: '菲律宾', currency: 'PHP' }
], platforms: [
    { id: 'chatgpt', name: 'ChatGPT', regions: ['PH', 'US'], modes: [{ id: 'link' }, { id: 'checkout' }], plans: [
        { id: 'plus', label: 'ChatGPT Plus', planName: 'chatgptplusplan', amount: 20, currency: 'USD', interval: 'month' }
    ] },
    { id: 'claude', name: 'Claude', regions: ['US'], modes: [{ id: 'checkout' }], plans: [
        { id: 'claude_pro_annual', label: 'Claude Pro 年付', planName: 'claude_pro_annual', amount: 200, currency: 'USD', interval: 'year' }
    ] },
    { id: 'grok', name: 'Grok / X', regions: ['US'], modes: [{ id: 'checkout' }], plans: [
        { id: 'grok_bundle_super_annual', label: 'The X Subscription Super 年付', amount: 1000, currency: 'USD', interval: 'year' },
        { id: 'supergrok', label: '不应出现的历史商品' }
    ] }
] };
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
function harness(handler) {
    const elements = new Map();
    function element(id) {
        if (!elements.has(id)) elements.set(id, { id, value: '', textContent: '', innerHTML: '', hidden: false, checked: false,
            disabled: false, dataset: {}, parentElement: { scrollTop: 0, scrollHeight: 100 },
            setAttribute: vi.fn(), addEventListener: vi.fn(), scrollIntoView: vi.fn(),
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 500 }) });
        return elements.get(id);
    }
    const stored = new Map();
    const timers = new Map();
    let seq = 0;
    const fetch = vi.fn(handler || (async path => {
        if (path.endsWith('/plans')) return response({ success: true, catalog });
        if (path.includes('/history')) return response({ success: true, tasks: [], total: 0, page: 1, limit: 10 });
        return response({ success: true, status: 'success', raw_output: 'offline output', report: { mode: 'link', checkout: { confirmed: false } } });
    }));
    const options = { document: { getElementById: element }, fetch,
        storage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
        onMessage: vi.fn(), screenshotPath: path => `/api/admin/screenshots?path=${encodeURIComponent(path)}`,
        copyText: vi.fn(async () => {}),
        randomId: () => 'offline-request-id',
        setTimeout: (callback, ms) => { timers.set(++seq, { callback, ms }); return seq; }, clearTimeout: id => timers.delete(id)
    };
    const ui = diagnostic.create(options);
    ui.state.catalog = diagnostic.normalizeCatalog({ catalog });
    element('checkout_platform').value = 'chatgpt'; element('checkout_plan_type').value = 'plus';
    element('checkout_region_selector').value = 'US'; element('checkout_mode').value = 'link';
    element('checkout_session_input').value = '{"accessToken":"offline-token"}'; ui.regionChanged();
    return { ui, element, stored, timers, fetch, options };
}

describe('diagnostic catalog and parameter contract', () => {
    it('uses the shared three-platform catalog, keeps billing periods and hides legacy Grok merchandise', () => {
        const normalized = diagnostic.normalizeCatalog({ success: true, catalog });
        expect(normalized.plans).toHaveLength(3);
        expect(normalized.plans[2]).toMatchObject({ platform: 'grok', planType: 'grok_bundle_super_annual', interval: 'year', modes: ['checkout'], regions: ['US'] });
    });
    it('submits a manual advanced override without resetting it', async () => {
        const h = harness(async path => path.endsWith('/generate') ? response({ success: false, message: 'offline test rejection' }, 400) : response({ success: true }));
        h.element('checkout_plan_override').value = 'custom-api-plan';
        await h.ui.start();
        expect(JSON.parse(h.fetch.mock.calls[0][1].body)).toMatchObject({ platform: 'chatgpt', plan_type: 'plus', country: 'US', mode: 'link', plan_name: 'custom-api-plan', request_id: 'offline-request-id' });
        expect(h.element('checkout_plan_override').value).toBe('custom-api-plan');
    });
    it('keeps a saved link override out of complete checkout diagnostics', () => {
        const h = harness();
        const payload = diagnostic.buildPayload({ catalog: h.ui.state.catalog, platform: 'chatgpt', planType: 'plus',
            country: 'US', mode: 'checkout', credential: '{"accessToken":"offline-token"}', override: 'custom-api-plan' });
        expect(payload).not.toHaveProperty('plan_name');
    });
    it('rejects bad Session JSON and non-ChatGPT link mode before any request', async () => {
        const h = harness(); h.element('checkout_session_input').value = '{bad';
        await h.ui.start(); expect(h.fetch).not.toHaveBeenCalled();
        expect(h.element('checkout_connection_hint').textContent).toContain('有效的 Session JSON');
        expect(() => diagnostic.buildPayload({ catalog: h.ui.state.catalog, platform: 'grok', planType: 'grok_bundle_super_annual', country: 'US', mode: 'link', credential: 'sso=offline-cookie' })).toThrow('不支持');
    });
    it('clears credentials when switching platform and restricts Claude to its supported region and mode', () => {
        const h = harness(); h.element('checkout_platform').value = 'claude'; h.ui.platformChanged();
        expect(h.element('checkout_session_input').value).toBe('');
        expect(h.element('checkout_plan_type').value).toBe('claude_pro_annual');
        expect(h.element('checkout_region_selector').value).toBe('US');
        expect(h.element('checkout_mode').value).toBe('checkout');
        expect(h.element('checkout_advanced').hidden).toBe(true);
        expect(h.element('checkout_credential_hint').textContent).toContain('sessionKey');
    });
    it('keeps the temporary region local and does not display US reference pricing as a PH price', () => {
        const h = harness(); h.element('checkout_region_selector').value = 'PH'; h.ui.regionChanged();
        expect(h.ui.state.region).toBe('PH');
        expect(h.element('checkout_region_hint').textContent).toContain('不会更改全局默认');
        expect(h.element('checkout_expected_hint').textContent).toContain('地区价格待收银台确认');
        expect(h.element('checkout_expected_hint').textContent).not.toContain('20 USD');
    });
});

describe('diagnostic evidence rendering', () => {
    it('copies only a trusted checkout URL on explicit interaction', async () => {
        const h = harness();
        await h.ui.copyUrl('https://chatgpt.com/checkout/offline');
        expect(h.options.copyText).toHaveBeenCalledWith('https://chatgpt.com/checkout/offline');
        h.options.copyText.mockClear();
        await h.ui.copyUrl('javascript:alert(1)');
        expect(h.options.copyText).not.toHaveBeenCalled();
    });
    it('does not present expected/requested values as verified in link mode', () => {
        const summary = diagnostic.checkoutSummary({ mode: 'link', checkout: { confirmed: false, product: 'plus', amount: 20, currency: 'USD', expectedAmount: 20, url: 'https://checkout.stripe.com/c/pay/offline' } });
        expect(summary).toMatchObject({ product: '未确认', amount: '未确认', currency: '未确认', confirmed: false });
        const h = harness(); h.ui.render({ status: 'success', progress: 100, report: { mode: 'link', checkout: { confirmed: false, amount: 20, currency: 'USD' } } });
        expect(h.element('checkout_facts').innerHTML).toContain('未确认');
        expect(h.element('checkout_verification_hint').textContent).toContain('不代表支付成功');
        expect(h.element('checkout_result_status').textContent).toContain('未核验收银台');
    });
    it('renders verified actual amounts, safe links and escaped stage/check messages', () => {
        const h = harness(); h.ui.render({ status: 'success', report: {
            checkout: { confirmed: true, product: 'Plus', amount: 20, currency: 'USD', interval: 'month', url: 'javascript:alert(1)' },
            stages: [{ id: 'login', label: '<script>unsafe</script>', status: 'passed', detail: 'safe', elapsedMs: 800 }],
            checks: [{ id: 'tax', label: '税费', status: 'skipped', message: '未填地址，不核验税费' }]
        } });
        expect(h.element('checkout_facts').innerHTML).toContain('USD');
        expect(h.element('checkout_stages').innerHTML).toContain('&lt;script&gt;');
        expect(h.element('checkout_result_url_wrap').innerHTML).not.toContain('javascript:');
        expect(h.element('checkout_checks').innerHTML).toContain('未填地址');
    });
    it('preserves observed quote mismatches as pending evidence without presenting expected price as an observation', () => {
        const summary = diagnostic.checkoutSummary({ mode: 'checkout', region: 'US', checkout: {
            confirmed: false, product: 'Plus', amount: 24, currency: 'USD', interval: 'month', expectedAmount: 20, expectedCurrency: 'USD'
        } });
        expect(summary).toMatchObject({ amount: '24（待核对）', currency: 'USD（待核对）', expectedAmount: 20, region: 'US', confirmed: false });
        expect(diagnostic.checkoutSummary({ mode: 'checkout', checkout: { confirmed: false, expectedAmount: 20 } }).amount).toBe('未确认');
    });
});

describe('diagnostic lifecycle without real workers', () => {
    it('allows only one status request at a time and stops polling on terminal status', async () => {
        let release;
        const h = harness(() => new Promise(resolve => { release = resolve; }));
        h.ui.state.jobKey = 'offline-job'; h.ui.state.status = 'running'; h.ui.startStream();
        const requests = [h.ui.refresh(), h.ui.refresh(), h.ui.refresh()];
        expect(h.fetch).toHaveBeenCalledOnce();
        release(response({ success: true, status: 'success', progress: 100, raw_output: 'completed offline' }));
        await Promise.all(requests);
        expect(h.ui.state.timer).toBe(null); expect(h.ui.state.visible).toBe(false);
        expect(h.timers.size).toBe(0); expect(h.element('checkout_generate_btn').disabled).toBe(false);
    });
    it('shows missing-task errors, releases controls and forgets the stale recovery key', async () => {
        const h = harness(async () => response({ success: false, error: '任务不存在' }, 404));
        h.ui.state.jobKey = 'missing-job'; h.ui.state.status = 'running'; h.stored.set(diagnostic.STORAGE_KEY, 'missing-job');
        await h.ui.refresh();
        expect(h.ui.state.status).toBe('expired'); expect(h.stored.size).toBe(0);
        expect(h.element('checkout_generate_btn').disabled).toBe(false);
        expect(h.element('checkout_connection_hint').textContent).toContain('任务不存在');
    });
    it('distinguishes clearing inputs from cancelling the worker', async () => {
        const h = harness(async path => response(path.includes('/cancel/') ? { success: true } : { success: true, status: 'cancelled', raw_output: '' }));
        h.ui.state.jobKey = 'offline-active'; h.ui.state.status = 'running';
        h.ui.clear(); expect(h.ui.state.jobKey).toBe('offline-active'); expect(h.fetch).not.toHaveBeenCalled();
        expect(h.element('checkout_session_input').value).toBe('');
        expect(h.element('checkout_connection_hint').textContent).toContain('继续运行');
        await h.ui.cancel();
        expect(h.fetch.mock.calls[0][0]).toBe('/api/admin/checkout/cancel/offline-active');
        expect(h.ui.state.status).toBe('cancelled'); expect(h.element('checkout_cancel_btn').disabled).toBe(true);
    });
    it('recovers only the saved job number, loads historical output and never stores credentials', async () => {
        const h = harness(); h.stored.set(diagnostic.STORAGE_KEY, 'offline-restored');
        h.element('checkout_session_input').value = '';
        await h.ui.load();
        expect(h.ui.state.jobKey).toBe('offline-restored');
        expect(h.element('checkout_debug_log_pre').textContent).toBe('offline output');
        expect([...h.stored.values()]).toEqual(['offline-restored']);
        expect(h.element('checkout_session_input').value).toBe('');
    });
    it('does not render a late response after clearing a completed view', async () => {
        let release;
        const h = harness(() => new Promise(resolve => { release = resolve; }));
        h.ui.state.jobKey = 'old-job'; h.ui.state.status = 'success';
        const pending = h.ui.refresh(); h.ui.clear();
        release(response({ success: true, status: 'success', raw_output: 'must-not-reappear' })); await pending;
        expect(h.ui.state.jobKey).toBe(''); expect(h.element('checkout_result_box').hidden).toBe(true);
        expect(h.element('checkout_debug_log_pre').textContent).toBe('');
    });
    it('supports pagination using total/limit when has_more is omitted', async () => {
        const h = harness(async () => response({ success: true, tasks: [], page: 2, total: 25, limit: 10 }));
        await h.ui.history(2); expect(h.element('checkout_history_next').disabled).toBe(false);
        expect(h.element('checkout_history_prev').disabled).toBe(false);
    });
    it('submits user-selected CAPTCHA points with the current frame and locks until a new frame', async () => {
        const h = harness(async () => response({ success: true, handled: true }));
        h.ui.state.jobKey = 'offline-captcha'; h.ui.state.status = 'running'; h.element('checkout_captcha_mode').value = 'select';
        h.ui.renderCaptcha({ active: true, image: 'data:image/png;base64,YQ==', frameSeq: 8, expiresAt: Date.now() + 60000 });
        h.ui.captchaClick({ clientX: 80, clientY: 150 });
        expect(h.fetch).not.toHaveBeenCalled();
        await h.ui.captchaClick({ clientX: 360, clientY: 460 });
        expect(h.fetch.mock.calls[0][0]).toBe('/api/admin/checkout/captcha-click/offline-captcha');
        expect(JSON.parse(h.fetch.mock.calls[0][1].body)).toMatchObject({ frameSeq: 8, action: 'submit', points: [{ ratioX: 0.2, ratioY: 0.3 }] });
        expect(h.ui.state.captchaBusy).toBe(true);
        h.ui.renderCaptcha({ active: true, image: 'data:image/png;base64,YQ==', frameSeq: 9 });
        expect(h.ui.state.points).toHaveLength(0); expect(h.ui.state.captchaBusy).toBe(false);
    });
});

it('mounts the diagnostic module only in the admin page and keeps credential fields out of storage', () => {
    const admin = fs.readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
    const frontend = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    expect(admin).toContain('充值链路诊断'); expect(admin).toContain('/checkout-diagnostic.js');
    expect(admin).toContain('checkout_plan_override'); expect(frontend).not.toContain('/checkout-diagnostic.js');
});
