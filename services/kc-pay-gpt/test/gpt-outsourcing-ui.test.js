import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const outsourcing = require('../public/gpt-outsourcing.js');

function harness(handler = async () => ({ success: true })) {
    const elements = new Map();
    const calls = [];
    const listeners = new Map();
    function element(id) {
        if (!elements.has(id)) elements.set(id, { id, value: '', textContent: '', innerHTML: '', hidden: false,
            checked: false, disabled: false, placeholder: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
            addEventListener(name, listener) { listeners.set(`${id}:${name}`, listener); }, focus: vi.fn() });
        return elements.get(id);
    }
    const fetch = vi.fn(async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => handler(url, init) }; });
    const document = { getElementById: element, addEventListener: vi.fn() };
    const ui = outsourcing.create({ document, fetch, onMessage: vi.fn() });
    return { ui, element, fetch, calls, listeners };
}

describe('GPT outsource channel configuration', () => {
    it('keeps local canonical plans and country/currency explicit', () => {
        const payload = outsourcing.buildPayload({ enabled: true, base_url: 'https://supplier.example/', api_key: 'secret', country: 'US',
            plan_mapping: { go: '', plus: 'plus-us', pro_100: 'pro100', pro_200: '', pro_500: 'pro500' } });
        expect(payload).toMatchObject({ country: 'US', currency: 'USD', plan_mapping: { go: '', plus: 'plus-us', pro_100: 'pro100', pro_200: '', pro_500: 'pro500' } });
        expect(() => outsourcing.buildPayload({ country: 'ZZ' })).toThrow('供应商支持的地区');
    });

    it('loads local config and order history only; it never auto-queries the supplier', async () => {
        const h = harness(async url => url === '/api/admin/gpt-api'
            ? { success: true, config: { enabled: true, base_url: 'https://supplier.example/', api_key_saved: true, country: 'CL', plan_mapping: { plus: 'monthly-plus' } } }
            : { success: true, orders: [], total: 0, limit: 10, offset: 0 });
        await h.ui.load();
        expect(h.calls.map(call => call.url)).toEqual(['/api/admin/gpt-api', '/api/admin/gpt-api/orders?limit=10&offset=0&status=']);
        expect(h.element('gpt_api_currency').value).toBe('CLP');
        expect(h.element('gpt_api_map_plus').value).toBe('monthly-plus');
        expect(h.element('gpt_api_map_go').value).toBe('');
    });

    it('clears a submitted Session immediately and keeps it out of persistent config', async () => {
        const h = harness(async url => url === '/api/admin/gpt-api' ? { success: true, config: { api_key_saved: true } }
            : url.includes('/orders?') ? { success: true, orders: [], total: 0 }
            : { success: true, checks: [{ key: 'session', label: 'Session 格式', state: 'passed' }] });
        h.element('gpt_api_inspect_session').value = '{"accessToken":"test-token"}';
        await h.ui.load();
        await h.ui.test();
        expect(h.element('gpt_api_inspect_session').value).toBe('');
        expect(h.element('gpt_api_action_overlay').hidden).toBe(false);
        expect(h.calls.some(call => call.url.endsWith('/test'))).toBe(false);
        expect(h.calls[0].init?.body || '').not.toContain('test-token');
    });

    it('shows test checks returned with a rejected response', async () => {
        const h = harness(async () => ({ success: true }));
        h.element('gpt_api_enabled').checked = true;
        h.element('gpt_api_key').value = 'offline-key';
        h.fetch.mockImplementation(async (url, init) => ({ ok: false, status: 400, json: async () => ({ success: false, message: '商品未匹配', checks: [
            { key: 'plan_mapping', label: '套餐映射', state: 'failed', error: '当前商品不可用' },
            { key: 'amount', label: '付款金额', state: 'unverified', error: '协议不提供报价验证' }
        ] }) }));
        await h.ui.test();
        expect(h.element('gpt_api_checks').innerHTML).toContain('当前商品不可用');
        expect(h.element('gpt_api_checks').innerHTML).toContain('未验证');
    });

    it('renders canonical protocol states and errors without treating a passed check as unverified', () => {
        const h = harness();
        h.ui.renderChecks([
            { key: 'balance', label: '账户余额', state: 'passed' },
            { key: 'mapping', label: '套餐映射', state: 'failed', error: '<当前商品不可用>', code: 'OUTSOURCE_PLAN_INVALID' },
            { key: 'submit', label: '实际付款', state: 'unverified' }
        ]);
        const markup = h.element('gpt_api_checks').innerHTML;
        expect(markup).toContain('outsource-check passed');
        expect(markup).toContain('已确认');
        expect(markup).toContain('outsource-check failed');
        expect(markup).toContain('&lt;当前商品不可用&gt;');
        expect(markup).toContain('outsource-check unverified');
    });

    it('renders local order history safely and gates CVC resubmission on explicit server eligibility', async () => {
        const h = harness();
        h.ui.renderOrders({ total: 1, orders: [{ job_key: '<img src=x>', status: 'manual', phase: 'awaiting_credentials', order_id: '42',
            message: '<unsafe>', plan_type: 'plus', provider_plan_key: 'plus', country: 'US', currency: 'USD', can_recheck: true, can_supplement_credentials: false }] });
        expect(h.element('gpt_api_recent_orders').innerHTML).toContain('&lt;img src=x&gt;');
        expect(h.element('gpt_api_recent_orders').innerHTML).not.toContain('data-outsource-credentials');
        expect(h.element('gpt_api_recent_orders').innerHTML).toContain('data-outsource-recheck');
    });

    it('retains finished order information while omitting actions rejected by server eligibility', () => {
        const h = harness();
        h.ui.renderOrders({ total: 1, orders: [{ job_key: 'settled-order', order_id: '42', status: 'success', phase: 'finished',
            payment_state: 'succeeded', last_checked_at: '2026-10-14T09:00:00Z', can_recheck: false, can_supplement_credentials: false }] });
        const markup = h.element('gpt_api_recent_orders').innerHTML;
        expect(markup).toContain('settled-order');
        expect(markup).toContain('订单 42');
        expect(markup).toContain('付款成功');
        expect(markup).not.toContain('data-outsource-recheck');
        expect(markup).not.toContain('data-outsource-credentials');
    });

    it('rechecks only the original order after explicit admin confirmation', async () => {
        const h = harness(async () => ({ success: true, message: '原订单核查完成', orders: [], total: 0 }));
        h.ui.openAction({ type: 'recheck', jobKey: 'order-1' });
        expect(h.calls).toHaveLength(0);
        await h.ui.submitAction();
        const bodies = h.calls.filter(call => call.init?.body).map(call => [call.url, JSON.parse(call.init.body)]);
        expect(bodies).toEqual([['/api/admin/gpt-api/orders/order-1/recheck', {}]]);
        expect(h.calls.some(call => call.url.includes('/verify-secondary'))).toBe(false);
    });

    it('clears CVC and Session when cancelling a supplement and does not continue upstream payment', async () => {
        const h = harness();
        h.ui.openAction({ type: 'credentials', jobKey: 'order-1' });
        expect(h.element('gpt_api_action_hint').textContent).toContain('可能继续扣款');
        h.element('gpt_api_action_cvc').value = '123';
        h.element('gpt_api_action_session').value = '{"accessToken":"private"}';
        h.ui.closeAction();
        expect(h.element('gpt_api_action_cvc').value).toBe('');
        expect(h.element('gpt_api_action_session').value).toBe('');
        expect(h.ui.state.action).toBe(null);
        expect(h.calls).toHaveLength(0);
    });
});

describe('GPT outsource admin UI wiring', () => {
    it('uses the requested board name and keeps this as supplier-side protocol documentation', () => {
        const html = fs.readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
        expect(html).toContain('GPT 外包代充渠道');
        expect(html).toContain('Claude、Grok 继续使用本地流程');
        expect(html).toContain('/gpt-outsourcing.js');
        expect(html).not.toContain('第三方代充 API（协议对接）');
    });
});
