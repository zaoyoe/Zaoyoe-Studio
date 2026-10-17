(function installTgAdminDataCenter(scope) {
    'use strict';
    const DAY = 86400000;
    const OFFSET = 8 * 3600000;
    const KEY = 'tg-admin-data-center-range-v1';
    const reasons = { payment_review: '收款人工核对', fulfillment_review: '发货人工复核', failed: '发货失败', overdue: '处理超过 30 分钟' };
    const channels = { alipay: '支付宝', wxpay: '微信支付', usdt_bep20: 'USDT' };
    const networks = { usdtbsc: 'BEP20', usdtton: 'TON', usdtmatic: 'Polygon', usdttrc20: 'TRC20' };
    const count = value => Number.isSafeInteger(value) && value >= 0;
    const decimal = value => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
    const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
    const calendarDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && timestamp(value + 'T00:00:00Z') && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
    const localDay = value => new Date(value + OFFSET).toISOString().slice(0, 10);
    const stamp = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    function money(raw, currency) {
        if (!decimal(raw)) return '—';
        const [integer, fraction = ''] = raw.split('.');
        const places = currency === 'CNY' ? 2 : 6;
        const tail = currency === 'CNY' ? fraction.padEnd(2, '0').slice(0, 2) : fraction.slice(0, places).replace(/0+$/, '');
        return (currency === 'CNY' ? '¥' : '') + integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (tail ? '.' + tail : '') + (currency === 'USDT' ? ' USDT' : '');
    }
    function comparison(current, previous, comparable) {
        if (!comparable || !Number.isFinite(Number(previous)) || Number(previous) <= 0) return '较上期 · 暂无可比数据';
        const percent = (Number(current) - Number(previous)) / Number(previous) * 100;
        return `较上期 ${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`;
    }
    function waiting(since, asOf) {
        if (!timestamp(since) || !timestamp(asOf)) return '—';
        const minutes = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(since)) / 60000));
        if (minutes < 60) return minutes + ' 分钟';
        if (minutes < 1440) return Math.floor(minutes / 60) + ' 小时 ' + minutes % 60 + ' 分钟';
        return Math.floor(minutes / 1440) + ' 天 ' + Math.floor(minutes % 1440 / 60) + ' 小时';
    }
    function validPayload(payload, module) {
        const window = payload?.window, data = payload?.data;
        if (payload?.success !== true || !window || !['from', 'to', 'as_of'].every(key => timestamp(window[key]))
            || Date.parse(window.from) > Date.parse(window.to) || Date.parse(window.to) > Date.parse(window.as_of)
            || data?.version !== 1 || data.module !== module) return false;
        if (module === 'business') return typeof data.comparable === 'boolean' && ['current', 'previous'].every(period => {
            const metric = data.metrics?.[period];
            return metric && ['paid_count', 'completed_count', 'unverified_count', 'review_count'].every(key => count(metric[key])) && ['cny', 'usdt', 'review_cny', 'review_usdt'].every(key => decimal(metric[key]));
        }) && Array.isArray(data.trend) && data.trend.length <= 93 && data.trend.every((row, index, rows) => calendarDay(row.date) && (!index || row.date > rows[index - 1].date) && decimal(row.cny) && decimal(row.usdt))
            && Array.isArray(data.products) && data.products.length === 4 && new Set(data.products.map(row => row.product_family + ':' + row.term_months)).size === 4
            && data.products.every(row => (row.product_family === 'telegram_premium' && [3, 6, 12].includes(row.term_months) || row.product_family === 'telegram_stars' && row.term_months === null)
                && count(row.paid_count) && count(row.completed_count) && count(row.stars_sold) && decimal(row.cny) && decimal(row.usdt))
            && Array.isArray(data.channels) && data.channels.every(row => Object.hasOwn(channels, row.payment_channel) && count(row.paid_count) && decimal(row.amount)
                && (row.payment_channel === 'usdt_bep20' ? row.receipt_currency === 'USDT' && (row.pay_currency === null || Object.hasOwn(networks, row.pay_currency)) : row.receipt_currency === 'CNY' && row.pay_currency === null));
        if (module === 'operations') return count(data.total_attention) && count(data.normal_queue) && (data.oldest_since === null || timestamp(data.oldest_since))
            && Array.isArray(data.groups) && data.groups.length === 4 && new Set(data.groups.map(row => row.reason)).size === 4
            && data.groups.every(row => Object.hasOwn(reasons, row.reason) && count(row.purchase_count) && count(row.redemption_count) && (row.oldest_since === null || timestamp(row.oldest_since)))
            && data.groups.reduce((sum, row) => sum + row.purchase_count + row.redemption_count, 0) === data.total_attention;
        return module === 'inventory' && ['generated', 'used', 'available', 'in_flight', 'expiring'].every(key => count(data[key]))
            && data.used + data.available + data.in_flight <= data.generated && data.expiring <= data.available
            && (data.generated === 0 ? data.usage_rate === null : typeof data.usage_rate === 'number' && Number.isFinite(data.usage_rate) && data.usage_rate >= 0 && data.usage_rate <= 100);
    }
    function create({ request, navigate, isAuthenticated, refreshProvider }) {
        const document = scope.document;
        const $ = id => document.getElementById(id);
        const node = (tag, text, className) => { const element = document.createElement(tag); if (text != null) element.textContent = text; if (className) element.className = className; return element; };
        const button = (label, action, className = 'tg-dc-inline-link') => { const element = node('button', label, className); element.type = 'button'; element.addEventListener('click', action); return element; };
        const modules = Object.fromEntries(['business', 'operations', 'inventory'].map(key => [key, { version: 0, payload: null, busy: false, controller: null }]));
        let preferences = { range: '7d', currency: 'CNY', start: localDay(Date.now() - 6 * DAY), end: localDay(Date.now()) };
        try {
            const saved = JSON.parse(scope.sessionStorage.getItem(KEY) || 'null');
            if (saved && ['today', '7d', '30d', 'custom'].includes(saved.range) && ['CNY', 'USDT'].includes(saved.currency)
                && calendarDay(saved.start) && calendarDay(saved.end) && saved.start <= saved.end && saved.end <= localDay(Date.now())
                && Date.parse(saved.end) - Date.parse(saved.start) < 93 * DAY) preferences = { range: saved.range, currency: saved.currency, start: saved.start, end: saved.end };
        } catch (_) { /* Public layout preferences are optional. */ }
        function remember() { try { scope.sessionStorage.setItem(KEY, JSON.stringify(preferences)); } catch (_) {} }
        function feedback(module, message, retry = true) {
            const target = $('tgDc' + ({ business: 'Business', operations: 'Operations', inventory: 'Inventory' }[module]) + 'Feedback');
            target.hidden = !message; target.replaceChildren();
            if (message) target.append(node('span', message));
            if (message && retry) target.append(button('重试', () => load(module)));
        }
        function updateRangeControls() {
            for (const control of document.querySelectorAll('[data-dc-range]')) control.setAttribute('aria-pressed', String(control.dataset.dcRange === preferences.range));
            $('tgDcStart').value = preferences.start; $('tgDcEnd').value = preferences.end;
            $('tgDcStart').max = $('tgDcEnd').max = localDay(Date.now());
            $('tgDcCustomRange').hidden = preferences.range !== 'custom';
        }
        function businessFilters(extra = {}) {
            const window = modules.business.payload?.window;
            return window ? { from: window.from, to: window.to, as_of: window.as_of, ...extra } : null;
        }
        function drill(kind, filters, label, module = 'business') {
            if (!isAuthenticated() || modules[module].busy || !modules[module].payload || !filters) return;
            navigate(kind, { data_center: '1', ...filters }, label);
        }
        function paid(extra = {}, label = '已核验付款') { drill('Purchase', businessFilters({ date_field: 'paid_at', receipt: 'confirmed', ...extra }), label); }
        function completed(extra = {}, label = '完成交付') { drill('Order', businessFilters({ date_field: 'completed_at', status: 'succeeded', order_source: 'all', ...extra }), label); }
        function setMetric(id, value, action) {
            const control = $(id); control.textContent = value; control.disabled = false;
            control.onclick = action;
        }
        function chart() {
            const payload = modules.business.payload; if (!payload) return;
            const currency = preferences.currency;
            $('tgDcCny').setAttribute('aria-pressed', String(currency === 'CNY')); $('tgDcUsdt').setAttribute('aria-pressed', String(currency === 'USDT'));
            const metric = payload.data.metrics.current, previous = payload.data.metrics.previous;
            const key = currency.toLowerCase();
            setMetric('tgDcRevenue', money(metric[key], currency), () => paid({ currency }, '已确认收款 · ' + currency));
            const other = currency === 'CNY' ? 'USDT' : 'CNY';
            $('tgDcRevenueOther').textContent = money(metric[other.toLowerCase()], other);
            $('tgDcRevenueCompare').textContent = comparison(metric[key], previous[key], payload.data.comparable);
            $('tgDcRevenue').title = metric[key] + ' ' + currency;
            const series = payload.data.trend; const max = Math.max(...series.map(row => Number(row[key])), 0);
            const root = $('tgDcChart'); const plot = node('div', undefined, 'tg-dc-plot');
            const axis = node('div', undefined, 'tg-dc-axis'); axis.append(node('span', money(String(max), currency)), node('span', money(String(max / 2), currency)), node('span', '0'));
            const columns = node('div', undefined, 'tg-dc-columns');
            for (const [index, row] of series.entries()) {
                const value = Number(row[key]);
                const column = button('', () => {
                    const from = new Date(row.date + 'T00:00:00+08:00').toISOString();
                    const to = new Date(Math.min(Date.parse(from) + DAY, Date.parse(payload.window.to))).toISOString();
                    paid({ currency, from, to }, row.date + ' 收款 · ' + currency);
                }, 'tg-dc-column');
                column.disabled = value <= 0; column.title = `${row.date} · ${row[key]} ${currency}`;
                column.setAttribute('aria-label', `${row.date}，确认收款 ${row[key]} ${currency}，查看明细`);
                const track = node('span', undefined, 'tg-dc-bar-track'); const bar = node('i', undefined, 'tg-dc-bar');
                bar.style.height = `${max ? Math.max(1.5, value / max * 100) : 1.5}%`; track.append(bar);
                column.append(track, node('span', series.length <= 14 || index === 0 || index === series.length - 1 || index % Math.ceil(series.length / 7) === 0 ? row.date.slice(5).replace('-', '/') : '\u00a0', 'tg-dc-tick'));
                columns.append(column);
            }
            plot.append(axis, columns); root.replaceChildren(plot); root.setAttribute('aria-busy', 'false');
            if (!max) root.append(node('span', `所选时段暂无 ${currency} 确认收款`, 'tg-dc-chart-empty'));
        }
        function renderBusiness() {
            const payload = modules.business.payload, data = payload.data, current = data.metrics.current, previous = data.metrics.previous;
            chart(); setMetric('tgDcPaid', current.paid_count.toLocaleString('zh-CN'), () => paid());
            setMetric('tgDcCompleted', current.completed_count.toLocaleString('zh-CN'), () => completed());
            $('tgDcPaidCompare').textContent = comparison(current.paid_count, previous.paid_count, data.comparable);
            $('tgDcCompletedCompare').textContent = comparison(current.completed_count, previous.completed_count, data.comparable);
            $('tgDcReviewReceipts').hidden = current.review_count === 0;
            $('tgDcReviewReceipts').textContent = `含待核对款 ${current.review_count} 笔`;
            $('tgDcReviewReceipts').title = `${money(current.review_cny, 'CNY')} / ${money(current.review_usdt, 'USDT')}`;
            $('tgDcReviewReceipts').onclick = () => paid({ receipt: 'review' }, '已收款待核对');
            const products = [];
            for (const row of data.products) {
                const tr = node('tr'); const filters = { product_family: row.product_family, ...(row.term_months ? { term_months: String(row.term_months) } : {}) };
                const label = row.product_family === 'telegram_stars' ? 'Telegram Stars' : `Premium · ${row.term_months} 个月`;
                const name = node('td'); name.append(node('span', label));
                if (row.product_family === 'telegram_stars') name.append(node('small', `已销售 ${row.stars_sold.toLocaleString('zh-CN')} 颗`, 'tg-dc-product-unit'));
                else name.append(node('small', '按份统计', 'tg-dc-product-unit'));
                tr.append(name);
                for (const [value, action] of [[row.paid_count, () => paid(filters, label + ' · 已付款')], [money(row.cny, 'CNY'), () => paid({ ...filters, currency: 'CNY' }, label + ' · CNY')], [money(row.usdt, 'USDT'), () => paid({ ...filters, currency: 'USDT' }, label + ' · USDT')], [row.completed_count, () => completed(filters, label + ' · 完成交付')]]) {
                    const td = node('td'); td.append(button(String(value), action, 'tg-dc-number')); tr.append(td);
                }
                products.push(tr);
            }
            $('tgDcProducts').replaceChildren(...products);
            const list = [], receipts = data.channels.filter(row => row.paid_count > 0);
            for (const channel of new Set(receipts.map(row => row.payment_channel))) {
                const rows = receipts.filter(row => row.payment_channel === channel); const total = rows.reduce((sum, row) => sum + row.paid_count, 0);
                const item = node('div', undefined, 'tg-dc-list-row'); item.append(node('span', channels[channel]), button(total + ' 笔', () => paid({ payment_channel: channel }, channels[channel] + ' · 已付款'), 'tg-dc-number'));
                list.push(item);
                if (channel === 'usdt_bep20' && rows.length) {
                    const details = node('details', undefined, 'tg-dc-network-details'); details.append(node('summary', '网络明细'));
                    for (const row of rows) { const entry = node('div', undefined, 'tg-dc-list-row'); entry.append(node('span', networks[row.pay_currency] || '协议未确认'), button(row.paid_count + ' 笔', () => paid({ payment_channel: channel, pay_currency: row.pay_currency || 'unknown' }, 'USDT · ' + (networks[row.pay_currency] || '协议未确认')), 'tg-dc-number')); details.append(entry); }
                    list.push(details);
                }
            }
            if (!list.length) list.push(node('p', '所选时段暂无已确认收款', 'tg-dc-unavailable'));
            $('tgDcChannels').replaceChildren(...list);
            $('tgDcUpdated').textContent = '北京时间 · 更新于 ' + stamp(payload.window.as_of);
            $('tgDcRangeLabel').textContent = localDay(Date.parse(payload.window.from)) + ' — ' + localDay(Math.max(Date.parse(payload.window.from), Date.parse(payload.window.to) - 1)) + '，截止 ' + stamp(payload.window.to);
            if (current.unverified_count) {
                feedback('business', `${current.unverified_count} 笔付款凭据或原币金额待核验，收款统计可能不完整。`, false);
                $('tgDcBusinessFeedback').append(button('查看明细', () => drill('Purchase', businessFilters({ date_field: 'paid_at', receipt: 'amount_unknown' }), '付款金额待核验')));
            } else feedback('business', '');
        }
        function renderOperations() {
            const payload = modules.operations.payload, data = payload.data;
            setMetric('tgDcAttention', String(data.total_attention), () => { $('tgDcTodosPanel').focus(); $('tgDcTodosPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
            $('tgDcAttentionCard').classList.toggle('has-attention', data.total_attention > 0);
            $('tgDcOldest').textContent = data.total_attention ? '最长等待 ' + waiting(data.oldest_since, payload.window.as_of) : '当前没有需干预的订单';
            $('tgDcQueue').textContent = `正常排队 ${data.normal_queue} 笔 · 当前`;
            const rows = [];
            for (const row of data.groups) {
                const item = node('div', undefined, 'tg-dc-todo-row'); const description = node('div');
                description.append(node('span', reasons[row.reason]), node('small', row.oldest_since ? '最长 ' + waiting(row.oldest_since, payload.window.as_of) : '暂无待办'));
                const actions = node('div', undefined, 'tg-dc-todo-actions');
                for (const [kind, amount, source] of [['Purchase', row.purchase_count, '购买'], ['Order', row.redemption_count, '兑换']]) {
                    const control = button(source + ' ' + amount, () => drill(kind, { as_of: payload.window.as_of, attention: row.reason, ...(kind === 'Order' ? { order_source: 'redemption' } : {}) }, reasons[row.reason] + ' · ' + source, 'operations'), 'tg-dc-count');
                    control.disabled = amount === 0; actions.append(control);
                }
                item.append(description, actions); rows.push(item);
            }
            $('tgDcTodos').replaceChildren(...rows); $('tgDcTodos').setAttribute('aria-busy', 'false'); feedback('operations', '');
        }
        function renderInventory() {
            const payload = modules.inventory.payload, data = payload.data; const rows = [];
            for (const [key, label] of [['available', '当前可兑换'], ['in_flight', '预留 / 履约中'], ['expiring', '7 天内到期']]) {
                const row = node('div', undefined, 'tg-dc-list-row'); row.append(node('span', label), button(data[key] + ' 张', () => drill('Batch', { inventory: key, as_of: payload.window.as_of }, label, 'inventory'), 'tg-dc-number')); rows.push(row);
            }
            const usage = node('div', undefined, 'tg-dc-usage');
            const line = node('div', undefined, 'tg-dc-list-row'); line.append(node('span', '累计使用率'), button(data.usage_rate === null ? '—' : data.usage_rate + '%', () => drill('Batch', { inventory: 'used', as_of: payload.window.as_of }, '已成功兑换', 'inventory'), 'tg-dc-number'));
            const progress = node('progress'); progress.max = data.generated || 1; progress.value = data.used; progress.setAttribute('aria-label', `已成功兑换 ${data.used} 张，共生成 ${data.generated} 张`);
            usage.append(line, progress, node('small', `成功兑换 ${data.used} / 总生成 ${data.generated} 张`)); rows.push(usage);
            $('tgDcInventory').replaceChildren(...rows); $('tgDcInventory').setAttribute('aria-busy', 'false'); feedback('inventory', '');
        }
        function pending(module, busy) {
            modules[module].busy = busy;
            for (const id of module === 'business' ? ['tgDcMetrics', 'tgDcChart', 'tgDcProducts', 'tgDcChannels'] : module === 'operations' ? ['tgDcTodos'] : ['tgDcInventory']) $(id).setAttribute('aria-busy', String(busy));
            $('tgAdminPanelDashboard').classList.toggle('is-business-updating', modules.business.busy);
        }
        async function load(module, asOf = new Date().toISOString()) {
            if (!isAuthenticated()) return;
            const state = modules[module]; const version = ++state.version; state.controller?.abort();
            state.controller = new scope.AbortController(); const controller = state.controller;
            const timer = scope.setTimeout(() => controller.abort(), 20000);
            pending(module, true);
            feedback(module, '');
            try {
                const params = new scope.URLSearchParams({ module, range: preferences.range, as_of: asOf, ...(preferences.range === 'custom' ? { start: preferences.start, end: preferences.end } : {}) });
                const payload = await request('/api/admin/tg/data-center?' + params, { signal: controller.signal });
                if (version !== state.version || !isAuthenticated()) return;
                if (!validPayload(payload, module)) throw new Error('统计数据格式未确认，请重试');
                state.payload = payload;
                ({ business: renderBusiness, operations: renderOperations, inventory: renderInventory }[module])();
            } catch (error) {
                if (version !== state.version || !isAuthenticated()) return;
                const message = error.code === 'tg_data_center_migration_required' ? '统计尚未初始化，数据库迁移生效后即可显示。' : error.name === 'AbortError' ? '统计查询超时，请重试。' : error.message || '暂时无法获取统计数据。';
                feedback(module, (state.payload ? '更新失败，保留 ' + stamp(state.payload.window.as_of) + ' 的数据。' : '') + message);
                if (!state.payload) unavailable(module);
            } finally { scope.clearTimeout(timer); if (version === state.version) pending(module, false); }
        }
        function unavailable(module) {
            const metricIds = module === 'business' ? ['tgDcRevenue', 'tgDcPaid', 'tgDcCompleted'] : module === 'operations' ? ['tgDcAttention'] : [];
            for (const id of metricIds) { $(id).textContent = '—'; $(id).disabled = true; }
            const ids = module === 'business' ? ['tgDcChart', 'tgDcProducts', 'tgDcChannels'] : module === 'operations' ? ['tgDcTodos'] : ['tgDcInventory'];
            for (const id of ids) {
                const target = $(id);
                if (id === 'tgDcProducts') { const row = node('tr'), td = node('td', '统计暂不可用', 'tg-empty'); td.colSpan = 5; row.append(td); target.replaceChildren(row); }
                else target.replaceChildren(node('p', '统计暂不可用', 'tg-dc-unavailable'));
            }
        }
        function setProvider(data, error) {
            if (!isAuthenticated()) return;
            const root = $('tgDcProvider'); root.setAttribute('aria-busy', 'false');
            const available = !error && data?.healthy === true && decimal(data?.balances?.usdt) && decimal(data?.balances?.gram);
            const status = node('div', undefined, 'tg-dc-list-row'); status.append(node('span', 'Gramix'), node('span', available ? '连接正常' : (error || data?.configured !== false ? '状态未确认' : '尚未配置'), available ? 'tg-dc-health' : 'tg-dc-meta'));
            const rows = [status];
            for (const currency of ['usdt', 'gram']) { const row = node('div', undefined, 'tg-dc-list-row'); row.append(node('span', currency.toUpperCase() + ' 余额'), node('span', available ? data.balances[currency] : '—')); rows.push(row); }
            rows.push(node('p', available ? '查询于 ' + stamp(data.checked_at || new Date().toISOString()) : '余额暂不可用，请重新查询', 'tg-dc-note'));
            if (!available) rows.push(button('重新查询', () => refreshProvider().catch(failure => setProvider(null, failure))));
            root.replaceChildren(...rows);
        }
        function refresh() { const asOf = new Date().toISOString(); return Promise.allSettled(Object.keys(modules).map(module => load(module, asOf))); }
        function reset() {
            for (const [key, state] of Object.entries(modules)) { state.version++; state.controller?.abort(); state.payload = null; state.busy = false; feedback(key, ''); unavailable(key); }
            for (const id of ['tgDcRevenue', 'tgDcPaid', 'tgDcCompleted', 'tgDcAttention']) { $(id).textContent = '—'; $(id).disabled = true; $(id).onclick = null; $(id).title = ''; }
            $('tgDcReviewReceipts').title = ''; $('tgDcReviewReceipts').onclick = null;
            for (const id of ['tgDcRevenueCompare', 'tgDcPaidCompare', 'tgDcCompletedCompare', 'tgDcQueue', 'tgDcRangeLabel']) $(id).textContent = '';
            $('tgDcReviewReceipts').hidden = true; $('tgDcProvider').replaceChildren();
            $('tgDcRevenueOther').textContent = 'CNY / USDT 分币种'; $('tgDcOldest').textContent = '人工复核、失败与超时任务';
            $('tgDcUpdated').textContent = '北京时间 · 等待更新'; $('tgDcAttentionCard').classList.toggle('has-attention', false);
            pending('business', false); pending('operations', false); pending('inventory', false);
        }
        for (const control of document.querySelectorAll('[data-dc-range]')) control.addEventListener('click', () => {
            const range = control.dataset.dcRange;
            if (range === 'custom') { $('tgDcCustomRange').hidden = false; $('tgDcStart').focus(); return; }
            preferences.range = range; remember(); updateRangeControls(); load('business');
        });
        $('tgDcCustomRange').addEventListener('submit', event => {
            event.preventDefault();
            const start = $('tgDcStart').value, end = $('tgDcEnd').value;
            const duration = Date.parse(end + 'T00:00:00+08:00') - Date.parse(start + 'T00:00:00+08:00');
            if (!calendarDay(start) || !calendarDay(end) || !Number.isFinite(duration) || duration < 0 || duration >= 93 * DAY || end > localDay(Date.now())) { $('tgDcRangeError').textContent = '请选择不晚于今日、最多 93 天的日期范围'; return; }
            $('tgDcRangeError').textContent = ''; preferences = { ...preferences, range: 'custom', start, end }; remember(); updateRangeControls(); load('business');
        });
        $('tgDcCny').addEventListener('click', () => { preferences.currency = 'CNY'; remember(); chart(); });
        $('tgDcUsdt').addEventListener('click', () => { preferences.currency = 'USDT'; remember(); chart(); });
        $('tgDcProviderLink').addEventListener('click', () => navigate('Provider'));
        updateRangeControls();
        return { refresh, setProvider, reset, load };
    }
    scope.TgAdminDataCenter = Object.freeze({ create, money, comparison, validPayload, waiting });
})(window);
