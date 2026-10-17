'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { AS_OF, payload } = require('./fixtures/tg-data-center');
const script = fs.readFileSync(require.resolve('../js/tg-admin-data-center.js'), 'utf8');
const html = fs.readFileSync(require.resolve('../tg-admin.html'), 'utf8');
const css = fs.readFileSync(require.resolve('../css/tg-admin-data-center.css'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const clone = value => JSON.parse(JSON.stringify(value));
function page(options = {}) {
    const elements = new Map(), storage = options.storage || new Map(), calls = [], navigations = [];
    let authenticated = true, providerCalls = 0;
    function element(tag = 'div') {
        const classes = new Set(), attrs = new Map(), listeners = new Map(); let text = '';
        return { tag, children: [], value: '', title: '', hidden: false, disabled: false, dataset: {}, style: {},
            get textContent() { return text + this.children.map(child => child.textContent).join(''); },
            set textContent(value) { text = String(value); this.children = []; },
            classList: { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
            setAttribute(name, value) { attrs.set(name, String(value)); }, getAttribute: name => attrs.get(name),
            addEventListener(name, action) { listeners.set(name, action); }, append(...nodes) { this.children.push(...nodes); },
            replaceChildren(...nodes) { text = ''; this.children = nodes; }, focus() { this.focused = true; }, scrollIntoView() { this.scrolled = true; },
            async trigger(name, extra = {}) { if (this.disabled) return; await listeners.get(name)?.({ preventDefault() {}, ...extra }); if (name === 'click') await this.onclick?.(); }
        };
    }
    const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
    const ranges = ['today', '7d', '30d', 'custom'].map(value => { const el = element('button'); el.dataset.dcRange = value; return el; });
    const document = { getElementById: get, createElement: element, querySelectorAll: () => ranges };
    class Clock extends Date { constructor(...args) { super(...(args.length ? args : [AS_OF])); } static now() { return Date.parse(AS_OF); } }
    const window = { document, AbortController, URLSearchParams, setTimeout, clearTimeout,
        sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } };
    vm.runInNewContext(script, { window, Date: Clock });
    const controller = window.TgAdminDataCenter.create({
        async request(url, settings) { calls.push({ url, settings }); const query = new URL(url, 'http://localhost').searchParams; return options.request ? options.request(query, settings) : payload(query.get('module'), { window: { as_of: query.get('as_of'), range: query.get('range') } }); },
        navigate(...args) { navigations.push(clone(args)); }, isAuthenticated: () => authenticated,
        async refreshProvider() { providerCalls++; if (options.providerError) throw options.providerError; }
    });
    const buttons = root => [root, ...root.children.flatMap(child => buttons(child))].filter(el => el.tag === 'button');
    return { get, calls, navigations, ranges, storage, controller, api: window.TgAdminDataCenter, buttons, providerCalls: () => providerCalls, setAuth(value) { authenticated = value; } };
}

test('three independent modules render without making a provider or business write', async () => {
    const ui = page(); await ui.controller.refresh();
    assert.equal(ui.calls.length, 3); assert.ok(ui.calls.every(call => call.settings.signal instanceof AbortSignal));
    assert.equal(new Set(ui.calls.map(call => new URL(call.url, 'http://localhost').searchParams.get('as_of'))).size, 1);
    assert.equal(ui.get('tgDcRevenue').textContent, '¥2,860.50'); assert.equal(ui.get('tgDcRevenueOther').textContent, '182.765432 USDT');
    assert.equal(ui.get('tgDcPaid').textContent, '28'); assert.equal(ui.get('tgDcCompleted').textContent, '31'); assert.equal(ui.get('tgDcAttention').textContent, '9');
    assert.equal(ui.get('tgDcTodos').children.length, 4); assert.equal(ui.get('tgDcProducts').children.length, 4);
    assert.match(ui.get('tgDcInventory').textContent, /成功兑换 42 \/ 总生成 120 张/); assert.equal(ui.providerCalls(), 0);
});
test('currency toggle is local and preserves decimal strings without summing currencies', async () => {
    const ui = page(); await ui.controller.refresh(); await ui.get('tgDcUsdt').trigger('click');
    assert.equal(ui.calls.length, 3); assert.equal(ui.get('tgDcRevenue').textContent, '182.765432 USDT');
    assert.equal(ui.get('tgDcRevenue').title, '182.76543210 USDT'); assert.equal(ui.get('tgDcRevenueOther').textContent, '¥2,860.50');
    await ui.get('tgDcRevenue').trigger('click');
    const [kind, filters] = ui.navigations[0]; assert.equal(kind, 'Purchase'); assert.equal(filters.currency, 'USDT'); assert.equal(filters.date_field, 'paid_at'); assert.equal(filters.receipt, 'confirmed'); assert.equal(filters.as_of, AS_OF);
});
test('delivery metric links all sources by completion time and product links retain their entitlement', async () => {
    const ui = page(); await ui.controller.refresh(); await ui.get('tgDcCompleted').trigger('click');
    assert.equal(ui.navigations[0][0], 'Order'); assert.equal(ui.navigations[0][1].date_field, 'completed_at'); assert.equal(ui.navigations[0][1].status, 'succeeded'); assert.equal(ui.navigations[0][1].order_source, 'all');
    const row = ui.get('tgDcProducts').children[1]; await row.children[3].children[0].trigger('click');
    assert.equal(ui.navigations[1][1].term_months, '6'); assert.equal(ui.navigations[1][1].currency, 'USDT');
});
test('day bars drill into that Beijing day with the original snapshot and currency', async () => {
    const ui = page(); await ui.controller.refresh(); const bar = ui.buttons(ui.get('tgDcChart'))[0]; await bar.trigger('click');
    assert.equal(ui.navigations[0][1].from, '2026-10-10T16:00:00.000Z'); assert.equal(ui.navigations[0][1].to, '2026-10-11T16:00:00.000Z');
});
test('attention and inventory drilldowns have no selected-period restriction or duplicate purchase task', async () => {
    const ui = page(); await ui.controller.refresh();
    await ui.buttons(ui.get('tgDcTodos'))[3].trigger('click');
    const [kind, filters] = ui.navigations[0]; assert.equal(kind, 'Order'); assert.equal(filters.order_source, 'redemption'); assert.equal(filters.attention, 'fulfillment_review'); assert.equal(filters.from, undefined);
    await ui.buttons(ui.get('tgDcInventory'))[2].trigger('click'); assert.equal(ui.navigations[1][0], 'Batch'); assert.equal(ui.navigations[1][1].inventory, 'expiring'); assert.equal(ui.navigations[1][1].from, undefined);
});
test('unconfirmed protocol drills into unknown only, and review receipts have a separate link', async () => {
    const ui = page(); await ui.controller.refresh();
    await ui.buttons(ui.get('tgDcChannels')).find(el => el.textContent === '1 笔').trigger('click');
    assert.equal(ui.navigations[0][1].pay_currency, 'unknown'); assert.match(ui.navigations[0][2], /协议未确认/);
    await ui.get('tgDcReviewReceipts').trigger('click'); assert.equal(ui.navigations[1][1].receipt, 'review');
});
test('payment channels come from receipt records and keep channel and protocol drilldowns', async () => {
    const ui = page(); await ui.controller.refresh();
    const card = ui.get('tgDcChannels');
    assert.equal(card.children.filter(row => row.tag === 'div').length, 2);
    assert.match(card.textContent, /支付宝22 笔USDT6 笔/); assert.doesNotMatch(card.textContent, /微信支付/);
    await ui.buttons(card).find(el => el.textContent === '22 笔').trigger('click');
    assert.equal(ui.navigations[0][1].payment_channel, 'alipay'); assert.equal(ui.navigations[0][1].receipt, 'confirmed');
    assert.equal(ui.navigations[0][1].from, payload().window.from); assert.equal(ui.navigations[0][1].as_of, AS_OF);
    await ui.buttons(card).find(el => el.textContent === '6 笔').trigger('click');
    assert.equal(ui.navigations[1][1].payment_channel, 'usdt_bep20'); assert.equal(ui.navigations[1][1].pay_currency, undefined);
    await ui.buttons(card).find(el => el.textContent === '3 笔').trigger('click');
    assert.equal(ui.navigations[2][1].pay_currency, 'usdtton');
});
test('an empty receipt period never invents channels or clickable zero counts', async () => {
    const ui = page({ request: query => payload(query.get('module'), query.get('module') === 'business' ? { data: { channels: [] } } : {}) });
    await ui.controller.refresh();
    assert.equal(ui.get('tgDcChannels').textContent, '所选时段暂无已确认收款');
    assert.equal(ui.buttons(ui.get('tgDcChannels')).length, 0);
});
test('zero-count padding is hidden and refreshing an empty period clears earlier channels', async () => {
    let empty = false;
    const ui = page({ request: query => payload(query.get('module'), query.get('module') === 'business' ? { data: { channels: empty ? [] : [
        ...payload().data.channels, { payment_channel: 'wxpay', pay_currency: null, receipt_currency: 'CNY', paid_count: 0, amount: '0' }
    ] } } : {}) });
    await ui.controller.refresh(); assert.doesNotMatch(ui.get('tgDcChannels').textContent, /微信支付/);
    empty = true; await ui.ranges[0].trigger('click'); await tick();
    assert.equal(ui.get('tgDcChannels').textContent, '所选时段暂无已确认收款');
    assert.equal(ui.buttons(ui.get('tgDcChannels')).length, 0);
});
test('a real historical channel remains visible only when receipt records include it', async () => {
    const ui = page({ request: query => payload(query.get('module'), query.get('module') === 'business' ? { data: { channels: [
        { payment_channel: 'wxpay', pay_currency: null, receipt_currency: 'CNY', paid_count: 2, amount: '100' }
    ] } } : {}) });
    await ui.controller.refresh(); assert.equal(ui.get('tgDcChannels').textContent, '微信支付2 笔');
    await ui.buttons(ui.get('tgDcChannels'))[0].trigger('click');
    assert.equal(ui.navigations[0][1].payment_channel, 'wxpay'); assert.equal(ui.navigations[0][2], '微信支付 · 已付款');
});
test('a module failure leaves other modules usable and retry reloads only that module', async () => {
    let fail = true; const ui = page({ request: async query => { if (query.get('module') === 'business' && fail) throw Object.assign(new Error('missing'), { code: 'tg_data_center_migration_required' }); return payload(query.get('module')); } });
    await ui.controller.refresh(); assert.equal(ui.get('tgDcRevenue').textContent, '—'); assert.equal(ui.get('tgDcRevenue').disabled, true);
    assert.match(ui.get('tgDcBusinessFeedback').textContent, /统计尚未初始化/); assert.equal(ui.get('tgDcAttention').textContent, '9');
    fail = false; await ui.buttons(ui.get('tgDcBusinessFeedback'))[0].trigger('click');
    assert.equal(ui.calls.length, 4); assert.equal(ui.get('tgDcRevenue').textContent, '¥2,860.50'); assert.equal(ui.get('tgDcBusinessFeedback').hidden, true);
});
test('refresh failure preserves the last successful snapshot and identifies its timestamp', async () => {
    let fail = false; const ui = page({ request: async query => { if (fail) throw new Error('temporary'); return payload(query.get('module')); } });
    await ui.controller.refresh(); fail = true; await ui.controller.load('business');
    assert.equal(ui.get('tgDcRevenue').textContent, '¥2,860.50'); assert.match(ui.get('tgDcBusinessFeedback').textContent, /更新失败，保留.*temporary/);
});
test('a late response from a cancelled earlier date selection cannot overwrite newer data', async () => {
    const first = deferred(), second = deferred(); let n = 0;
    const ui = page({ request: () => (++n === 1 ? first.promise : second.promise) });
    const older = ui.controller.load('business'); const newer = ui.controller.load('business');
    assert.equal(ui.calls[0].settings.signal.aborted, true);
    second.resolve(payload('business', { data: { metrics: { ...payload().data.metrics, current: { ...payload().data.metrics.current, cny: '999' } } } })); await newer;
    first.resolve(payload()); await older; assert.equal(ui.get('tgDcRevenue').textContent, '¥999.00');
});
test('switching date reloads only business and keeps independent operational totals', async () => {
    const ui = page(); await ui.controller.refresh(); await ui.ranges[2].trigger('click'); await tick();
    assert.equal(ui.calls.length, 4); assert.match(ui.calls[3].url, /module=business&range=30d/); assert.equal(ui.get('tgDcAttention').textContent, '9');
});
test('custom date validation prevents impossible, future, reversed and overlong requests', async () => {
    const ui = page();
    for (const [start, end] of [['2026-02-30', '2026-03-01'], ['2026-10-18', '2026-10-18'], ['2026-10-17', '2026-10-16'], ['2026-07-01', '2026-10-17']]) {
        ui.get('tgDcStart').value = start; ui.get('tgDcEnd').value = end; await ui.get('tgDcCustomRange').trigger('submit');
        assert.match(ui.get('tgDcRangeError').textContent, /请选择/);
    }
    assert.equal(ui.calls.length, 0);
    ui.get('tgDcStart').value = '2026-10-01'; ui.get('tgDcEnd').value = '2026-10-03'; await ui.get('tgDcCustomRange').trigger('submit'); await tick();
    assert.match(ui.calls[0].url, /range=custom/); assert.match(ui.calls[0].url, /start=2026-10-01&end=2026-10-03/);
});
test('only public range and currency preferences persist; bad stored dates fall back safely', async () => {
    const key = 'tg-admin-data-center-range-v1'; const storage = new Map([[key, JSON.stringify({ range: 'custom', currency: 'USDT', start: '2026-02-30', end: '2026-03-01' })]]);
    const ui = page({ storage }); await ui.controller.refresh(); assert.match(ui.calls[0].url, /range=7d/);
    await ui.get('tgDcUsdt').trigger('click'); const saved = JSON.parse(storage.get(key)); assert.deepEqual(Object.keys(saved).sort(), ['currency', 'end', 'range', 'start']);
    const returned = page({ storage }); await returned.controller.refresh(); assert.equal(returned.get('tgDcRevenue').textContent, '182.765432 USDT');
});
test('logout/reset aborts in-flight work and removes data, titles and provider balances', async () => {
    const pending = deferred(); let slow = false; const ui = page({ request: query => slow ? pending.promise : payload(query.get('module')) });
    await ui.controller.refresh(); ui.controller.setProvider({ healthy: true, balances: { usdt: '77.30', gram: '3.90' } });
    slow = true; const loading = ui.controller.load('business'); ui.setAuth(false); ui.controller.reset();
    pending.resolve(payload()); await loading;
    assert.equal(ui.get('tgDcRevenue').textContent, '—'); assert.equal(ui.get('tgDcRevenue').title, ''); assert.equal(ui.get('tgDcReviewReceipts').title, '');
    assert.equal(ui.get('tgDcProvider').textContent, ''); assert.doesNotMatch(ui.get('tgDcProducts').textContent, /900/); assert.equal(ui.calls[3].settings.signal.aborted, true);
    await ui.controller.refresh(); assert.equal(ui.calls.length, 4);
});
test('upstream unknown and failure show dashes, while verified zero remains zero', async () => {
    const ui = page(); ui.controller.setProvider({ healthy: false, balances: { usdt: '0', gram: '0' } });
    assert.match(ui.get('tgDcProvider').textContent, /状态未确认/); assert.equal((ui.get('tgDcProvider').textContent.match(/—/g) || []).length, 2);
    await ui.buttons(ui.get('tgDcProvider'))[0].trigger('click'); assert.equal(ui.providerCalls(), 1);
    ui.controller.setProvider({ healthy: true, balances: { usdt: '0', gram: '0.00' } });
    assert.match(ui.get('tgDcProvider').textContent, /连接正常.*USDT 余额0.*GRAM 余额0.00.*查询于/);
});
test('pending refresh disables stale drilldowns until an independent module finishes', async () => {
    const pending = deferred(); let slow = false; const ui = page({ request: query => slow ? pending.promise : payload(query.get('module')) });
    await ui.controller.refresh(); slow = true; const loading = ui.controller.load('business'); await ui.get('tgDcRevenue').trigger('click'); assert.equal(ui.navigations.length, 0);
    pending.resolve(payload()); await loading; await ui.get('tgDcRevenue').trigger('click'); assert.equal(ui.navigations.length, 1);
});
test('incomplete receipt metadata exposes a precise drilldown instead of hiding unknown money', async () => {
    const ui = page({ request: query => payload(query.get('module'), query.get('module') === 'business' ? { data: { metrics: { ...payload().data.metrics, current: { ...payload().data.metrics.current, unverified_count: 2 } } } } : {}) });
    await ui.controller.refresh(); assert.match(ui.get('tgDcBusinessFeedback').textContent, /2 笔付款凭据或原币金额待核验/);
    await ui.buttons(ui.get('tgDcBusinessFeedback'))[0].trigger('click'); assert.equal(ui.navigations[0][1].receipt, 'amount_unknown');
});
test('formatters distinguish absence, zero, history gaps and precise source values', () => {
    const ui = page(); assert.equal(ui.api.money(null, 'USDT'), '—'); assert.equal(ui.api.money('0', 'CNY'), '¥0.00');
    assert.equal(ui.api.money('1234567890123.123456789123', 'USDT'), '1,234,567,890,123.123456 USDT');
    assert.match(ui.api.comparison(10, 0, true), /暂无可比数据/); assert.match(ui.api.comparison(10, 5, false), /暂无可比数据/); assert.match(ui.api.comparison(10, 5, true), /\+100.0%/);
    assert.equal(ui.api.waiting(null, AS_OF), '—'); assert.equal(ui.api.waiting(AS_OF, 'invalid'), '—');
});
test('payload validation rejects missing windows, partial data, repeated buckets and false zeroes', () => {
    const ui = page(); for (const module of ['business', 'operations', 'inventory']) assert.equal(ui.api.validPayload(payload(module), module), true);
    const malformed = [];
    const noWindow = payload(); delete noWindow.window.from; malformed.push(['business', noWindow]);
    const wrongProduct = payload(); wrongProduct.data.products[0].term_months = 9; malformed.push(['business', wrongProduct]);
    const badDay = payload(); badDay.data.trend[0].date = '2026-02-30'; malformed.push(['business', badDay]);
    const badMoney = payload(); badMoney.data.metrics.current.usdt = 0; malformed.push(['business', badMoney]);
    const repeated = payload('operations'); repeated.data.groups[0].reason = repeated.data.groups[1].reason; malformed.push(['operations', repeated]);
    const inventory = payload('inventory'); inventory.data.available = 200; malformed.push(['inventory', inventory]);
    const zero = payload('inventory', { data: { generated: 0, used: 0, available: 0, in_flight: 0, expiring: 0, usage_rate: null } }); assert.equal(ui.api.validPayload(zero, 'inventory'), true);
    for (const [module, value] of malformed) assert.equal(ui.api.validPayload(value, module), false);
});
test('dashboard and restore skeleton use the same modules and existing focus/button treatment', () => {
    assert.match(html, /tg-admin-data-center\.css/); assert.match(html, /tg-admin-data-center\.js/);
    assert.match(html, /data-section="Dashboard"/); assert.match(html, /id="tgAdminPanelDashboard"/);
    assert.match(css, /\.tg-dc-metrics/); assert.match(css, /\.tg-dc-main-grid/); assert.match(css, /\.tg-dc-bottom-grid/);
    assert.doesNotMatch(script, /\.innerHTML\b|localStorage|\.fetch\(/);
});
