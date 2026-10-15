(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.GptOutsourcing = api;
})(typeof window === 'object' ? window : this, function () {
    'use strict';
    const PLANS = ['go', 'plus', 'pro_100', 'pro_200', 'pro_500'];
    const CURRENCIES = { PH: 'PHP', US: 'USD', EG: 'EGP', CL: 'CLP' };
    const LABELS = { running: '处理中', pending: '处理中', queued: '等待处理', manual: '待人工核对', failed: '失败', success: '成功', cancelled: '已取消',
        awaiting_credentials: '待补交凭证', unknown: '结果待确认', polling: '查询原订单', finished: '已结束', submitting: '提交中', prepared: '提交准备',
        not_started: '尚未付款', submitted: '已提交付款', succeeded: '付款成功', paid: '已扣款', declined: '未扣款', confirmed_unpaid: '确认未扣款' };
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const date = value => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
    const label = value => LABELS[value] || String(value || '—');
    function buildPayload(values) {
        const country = String(values.country || 'PH').toUpperCase();
        if (!CURRENCIES[country]) throw new Error('请选择供应商支持的地区');
        const mapping = {};
        PLANS.forEach(plan => { mapping[plan] = String(values.plan_mapping?.[plan] || '').trim(); });
        return { enabled: Boolean(values.enabled), base_url: String(values.base_url || '').trim(), api_key: String(values.api_key || '').trim(),
            country, currency: CURRENCIES[country], plan_mapping: mapping };
    }
    function sessionObject(text) {
        let parsed;
        try { parsed = JSON.parse(String(text || '').trim()); } catch (_) { throw new Error('Session 必须是有效的 JSON 对象'); }
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || !(parsed.accessToken || parsed.access_token)) throw new Error('Session JSON 缺少 accessToken / access_token');
        return parsed;
    }
    function create(options) {
        const doc = options.document;
        const fetcher = options.fetch;
        const notify = options.onMessage || (() => {});
        const state = { keySaved: false, config: null, limit: 10, offset: 0, total: 0, orders: [], action: null,
            busy: new Set(), ordersEpoch: 0 };
        const el = id => doc.getElementById(id);
        const text = (id, value) => { if (el(id)) el(id).textContent = String(value ?? ''); };
        const html = (id, value) => { if (el(id)) el(id).innerHTML = value; };
        const value = id => el(id)?.value || '';
        const set = (id, v) => { if (el(id)) el(id).value = v ?? ''; };
        const hidden = (id, v) => { if (el(id)) el(id).hidden = v; };
        const failure = (error, id = 'gpt_api_config_hint') => { const message = error?.message || '操作未完成，请稍后重试'; text(id, message); notify(message, 'error'); };
        function busy(id, on) { if (on) state.busy.add(id); else state.busy.delete(id); if (el(id)) el(id).disabled = on; }
        async function request(path, init = {}) {
            const response = await fetcher(path, init);
            let data;
            try { data = await response.json(); } catch (_) { throw new Error('服务响应异常，请刷新页面后重试'); }
            if (!response.ok || data.success === false) {
                const error = new Error(data.message || data.error || '请求未完成'); error.data = data; error.status = response.status; throw error;
            }
            return data;
        }
        const post = (path, body) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        function payload() {
            return buildPayload({ enabled: el('gpt_api_enabled')?.checked, base_url: value('gpt_api_base_url'), api_key: value('gpt_api_key'),
                country: value('gpt_api_country'), plan_mapping: Object.fromEntries(PLANS.map(p => [p, value(`gpt_api_map_${p}`)])) });
        }
        function countryChanged() { set('gpt_api_currency', CURRENCIES[value('gpt_api_country')] || ''); }
        function renderConfig(cfg) {
            state.config = cfg; state.keySaved = Boolean(cfg.api_key_saved);
            if (el('gpt_api_enabled')) el('gpt_api_enabled').checked = Boolean(cfg.enabled);
            set('gpt_api_base_url', cfg.base_url || ''); set('gpt_api_key', '');
            if (el('gpt_api_key')) el('gpt_api_key').placeholder = state.keySaved ? '已保存，留空不修改' : 'gptk_...';
            text('gpt_api_key_hint', state.keySaved ? 'API Key 已保存；留空不修改。' : '尚未配置 API Key');
            set('gpt_api_country', CURRENCIES[cfg.country] ? cfg.country : 'PH'); countryChanged();
            PLANS.forEach(plan => set(`gpt_api_map_${plan}`, cfg.plan_mapping?.[plan] || ''));
            text('gpt_api_status_hint', cfg.enabled ? '渠道已启用；点击查询，检查已保存的供应商账户。' : '渠道已关闭，GPT 使用本地银行卡池；Claude、Grok 不受影响。');
        }
        async function load() {
            try { const data = await request('/api/admin/gpt-api'); renderConfig(data.config || {}); }
            catch (error) { failure(error); }
            await orders();
        }
        async function save() {
            if (state.busy.has('gpt_api_save_btn')) return;
            busy('gpt_api_save_btn', true);
            try {
                const data = await post('/api/admin/gpt-api', payload());
                set('gpt_api_key', '');
                const config = data.config || (await request('/api/admin/gpt-api')).config;
                if (config) renderConfig(config);
                html('gpt_api_checks', '<p class="outsource-muted">配置已更改，请重新运行协议检查。</p>');
                text('gpt_api_config_hint', data.message || '渠道配置已保存'); notify(data.message || '渠道配置已保存', 'success');
            } catch (error) { failure(error); }
            finally { busy('gpt_api_save_btn', false); }
        }
        function renderChecks(checks) {
            html('gpt_api_checks', Array.isArray(checks) && checks.length ? checks.map(check => {
                const status = ['passed', 'failed', 'unverified'].includes(check.state) ? check.state : 'unverified';
                const statusLabel = { passed: '已确认', failed: '未通过', unverified: '未验证' }[status];
                return `<div class="outsource-check ${status}"><span class="outsource-check-state">${statusLabel}</span><div><strong>${escape(check.label || check.key || '协议检查')}</strong><p>${escape(check.error || '')}</p></div></div>`;
            }).join('') : '<p class="outsource-muted">暂无检查结果，实际建单与付款能力未验证。</p>');
        }
        function renderStatus(data) {
            const balance = data.balance || {};
            text('gpt_api_credits', balance.credits ?? '—');
            text('gpt_api_balance_usd', balance.balance_usd != null ? `$${balance.balance_usd}` : (balance.balance != null ? `${balance.balance} cents` : '—'));
            const plans = (data.gpt_plans || []).filter(p => p.enabled !== false && p.enabled !== 0);
            text('gpt_api_plans', plans.length ? plans.map(p => `${p.name || p.key} (${p.key || '—'})`).join('、') : '无可用商品');
            html('gpt_api_plan_keys', plans.filter(p => p.key).map(p => `<option value="${escape(p.key)}">${escape(p.name || p.key)}</option>`).join(''));
            text('gpt_api_credit_plans', (data.credit_plans || []).map(p => `${p.name || p.id || '积分套餐'}：${p.credits ?? '—'} 积分`).join('、') || '无');
            text('gpt_api_status_hint', data.enabled === false ? (data.message || '渠道已关闭，未查询供应商。') : data.balance_error ? `供应商查询未完成：${data.balance_error}；本地订单记录仍可查看。` : '供应商账户查询完成；服务积分与官方订阅费用分别计算。');
            if (data.checks) renderChecks(data.checks);
        }
        async function status() {
            if (state.busy.has('gpt_api_status_btn')) return;
            busy('gpt_api_status_btn', true);
            try { renderStatus(await request('/api/admin/gpt-api/status')); }
            catch (error) { if (error.data?.checks) renderChecks(error.data.checks); failure(error, 'gpt_api_status_hint'); }
            finally { busy('gpt_api_status_btn', false); }
        }
        async function runTest(data) {
            busy('gpt_api_test_btn', true);
            try {
                const result = await post('/api/admin/gpt-api/test', data); renderChecks(result.checks);
                notify(result.message || '协议检查完成；实际建单与付款仍未验证', 'success'); return true;
            } catch (error) { if (error.data?.checks) renderChecks(error.data.checks); failure(error, 'gpt_api_status_hint'); return false; }
            finally { busy('gpt_api_test_btn', false); }
        }
        async function test() {
            if (state.busy.has('gpt_api_test_btn') || state.action) return;
            try {
                const data = payload();
                if (!data.api_key && !state.keySaved) throw new Error('请填写供应商 API Key');
                const sessionText = value('gpt_api_inspect_session').trim();
                set('gpt_api_inspect_session', '');
                if (sessionText) {
                    data.session = sessionObject(sessionText);
                    openAction({ type: 'test', payload: data });
                } else await runTest(data);
            } catch (error) { failure(error); }
        }
        function renderOrders(data) {
            state.orders = Array.isArray(data.orders) ? data.orders : []; state.total = Number(data.total) || 0;
            const start = state.total ? state.offset + 1 : 0;
            text('gpt_api_orders_page', `${start}–${Math.min(state.offset + state.orders.length, state.total)} / ${state.total}`);
            if (el('gpt_api_orders_prev')) el('gpt_api_orders_prev').disabled = state.offset <= 0;
            if (el('gpt_api_orders_next')) el('gpt_api_orders_next').disabled = state.offset + state.limit >= state.total;
            html('gpt_api_recent_orders', state.orders.length ? `<table><thead><tr><th>本地 / 供应商订单</th><th>套餐与地区</th><th>进度与资金状态</th><th>最后核查</th><th>操作</th></tr></thead><tbody>${state.orders.map(order => {
                const terminal = ['success', 'failed', 'cancelled'].includes(order.status);
                const canRecheck = order.can_recheck === true;
                const canSupplement = !terminal && order.phase === 'awaiting_credentials' && order.order_id && order.can_supplement_credentials === true;
                return `<tr><td><strong>${escape(order.job_key || '—')}</strong><small>订单 ${escape(order.order_id || '—')} · 任务 ${escape(order.task_id || '—')}</small><small>${escape(date(order.created_at))}</small></td><td>${escape(order.plan_type || '—')} → ${escape(order.provider_plan_key || '—')}<small>${escape(order.country || '—')} / ${escape(order.currency || '—')}${order.card_last4 ? ` · 卡尾 ${escape(order.card_last4)}` : ''}</small></td><td><span class="outsource-order-state ${terminal ? escape(order.status) : 'pending'}">${escape(label(order.phase === 'awaiting_credentials' ? order.phase : order.status))}</span><small>${escape(label(order.payment_state))}${order.recovery_required ? ' · 保留资产待核对' : ''}</small><small>${escape(order.message || '')}</small></td><td>${escape(date(order.last_checked_at || order.updated_at))}</td><td><div class="outsource-order-actions">${canRecheck ? `<button type="button" class="btn btn-secondary" data-outsource-recheck="${escape(order.job_key)}">核查原订单</button>` : ''}${canSupplement ? `<button type="button" class="btn btn-secondary" data-outsource-credentials="${escape(order.job_key)}">补交凭证</button>` : ''}${!canRecheck && !canSupplement ? '<span class="outsource-muted">—</span>' : ''}</div></td></tr>`;
            }).join('')}</tbody></table>` : '<p class="outsource-empty">暂无符合条件的外包订单。</p>');
            text('gpt_api_orders_hint', '这里只读取本地记录；“核查原订单”会查询供应商，不会再次建单。');
        }
        async function orders() {
            const epoch = ++state.ordersEpoch;
            busy('gpt_api_orders_btn', true);
            try {
                const query = `limit=${state.limit}&offset=${state.offset}&status=${encodeURIComponent(value('gpt_api_order_filter'))}`;
                const data = await request(`/api/admin/gpt-api/orders?${query}`);
                if (epoch === state.ordersEpoch) renderOrders(data);
            } catch (error) { if (epoch === state.ordersEpoch) failure(error, 'gpt_api_orders_hint'); }
            finally { if (epoch === state.ordersEpoch) busy('gpt_api_orders_btn', false); }
        }
        function filter() { state.offset = 0; return orders(); }
        function page(delta) { state.offset = Math.max(0, state.offset + Number(delta) * state.limit); return orders(); }
        function clearActionSecrets() { ['gpt_api_action_cvc', 'gpt_api_action_session'].forEach(id => set(id, '')); }
        function openAction(action) {
            if (state.action || state.busy.has('gpt_api_action_submit')) return;
            clearActionSecrets(); state.action = action;
            const credentials = action.type === 'credentials';
            text('gpt_api_action_title', credentials ? '补交原订单凭证' : action.type === 'test' ? '检查账号凭证' : '核查原订单');
            text('gpt_api_action_hint', credentials ? '此操作会把原供应商订单重新排入充值任务，可能继续扣款。请先核对原订单结果；CVC 和 Session 仅本次使用，不保存到本地订单。' : action.type === 'test' ? '仅调用供应商的凭证预检，不建单、不付款。凭证会发送给供应商，本地不保存。' : '只查询原供应商订单并更新本地结果；不会再次建单或主动提交支付。');
            hidden('gpt_api_credential_fields', !credentials);
            text('gpt_api_action_submit', credentials ? '确认补交并继续原订单' : action.type === 'test' ? '确认预检' : '确认核查');
            hidden('gpt_api_action_overlay', false);
            el(credentials ? 'gpt_api_action_cvc' : 'gpt_api_action_submit')?.focus?.();
        }
        function closeAction() { if (state.busy.has('gpt_api_action_submit')) return; state.action = null; clearActionSecrets(); hidden('gpt_api_action_overlay', true); }
        async function submitAction() {
            if (!state.action || state.busy.has('gpt_api_action_submit')) return;
            const action = state.action; let credentials;
            try {
                if (action.type === 'credentials') {
                    const cvc = value('gpt_api_action_cvc').trim();
                    if (!/^\d{3,4}$/.test(cvc)) throw new Error('请填写 3–4 位 CVC');
                    credentials = { cvc };
                    if (value('gpt_api_action_session').trim()) credentials.session = sessionObject(value('gpt_api_action_session'));
                }
                busy('gpt_api_action_submit', true);
                clearActionSecrets();
                if (action.type === 'test') await runTest(action.payload);
                else {
                    const data = await post(`/api/admin/gpt-api/orders/${encodeURIComponent(action.jobKey)}/${action.type === 'credentials' ? 'credentials' : 'recheck'}`, credentials || {});
                    notify(data.message || (action.type === 'credentials' ? '凭证已提交给原订单' : '原订单核查完成'), 'success');
                    await orders();
                }
                state.action = null; hidden('gpt_api_action_overlay', true);
            } catch (error) {
                clearActionSecrets();
                failure(error, 'gpt_api_action_hint');
            } finally { busy('gpt_api_action_submit', false); }
        }
        el('gpt_api_recent_orders')?.addEventListener('click', event => {
            const recheck = event.target.closest?.('[data-outsource-recheck]');
            const supplement = event.target.closest?.('[data-outsource-credentials]');
            if (recheck) openAction({ type: 'recheck', jobKey: recheck.getAttribute('data-outsource-recheck') });
            if (supplement) openAction({ type: 'credentials', jobKey: supplement.getAttribute('data-outsource-credentials') });
        });
        doc.addEventListener?.('keydown', event => { if (event.key === 'Escape') closeAction(); });
        return { state, load, payload, save, countryChanged, renderStatus, renderChecks, renderOrders, status, test, orders, filter, page, openAction, closeAction, submitAction };
    }
    return { create, buildPayload, sessionObject, escape, PLANS, CURRENCIES };
});
