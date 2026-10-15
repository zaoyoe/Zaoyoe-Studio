(function initTelegramAdminPage(globalScope) {
    'use strict';
    const document = globalScope.document;
    const $ = (id) => document.getElementById(id);
    const text = (value) => String(value ?? '').trim();
    const PAGE_SIZE = 25;
    const state = { authenticated: false, generating: false, initializing: true, loggingIn: false, batchPage: 1, orderPage: 1, purchasePage: 1, batchVersion: 0, orderVersion: 0, purchaseVersion: 0, productVersion: 0 };
    const OAUTH_PENDING_KEY = 'tg-admin-google-pending-v1';
    const OAUTH_TTL_MS = 10 * 60 * 1000;
    const priceProducts = new Map();
    const priceSaves = new Set();
    const productIds = ['premium_3', 'premium_6', 'premium_12', 'stars'];
    const paymentLabels = { pending: '待付款', paid: '已付款', expired: '已过期', cancelled: '已取消', failed: '支付未完成', manual_review: '人工核对' };
    const fulfillmentLabels = { not_started: '尚未发货', pending: '待发货', processing: '处理中', retry_waiting: '等待确认', succeeded: '已发货', failed: '发货失败', manual_review: '人工复核', cancelled: '已取消' };
    const labels = { pending: '待处理', processing: '处理中', retry_waiting: '等待重试', succeeded: '已完成', failed: '失败', manual_review: '人工复核', cancelled: '已取消', active: '启用', available: '可兑换', reserved: '已预留', fulfilling: '履约中', fulfilled: '已兑换', revoked: '已撤销', expired: '已过期', disabled: '已停用', exhausted: '已耗尽', draft: '草稿' };
    const date = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
    let client;
    let authOrigin;

    function updateLoginControls() {
        const busy = state.initializing || state.loggingIn || !client;
        $('tgLoginSubmit').disabled = busy; $('tgGoogleLogin').disabled = busy;
        $('tgGoogleLoginLabel').textContent = state.loggingIn ? '正在安全登录…' : '使用 Google 账号登录';
    }
    function callbackUrl() { return new globalScope.URL('/tg-admin.html', globalScope.location.origin).href; }
    function clearPendingOAuth() { try { globalScope.sessionStorage.removeItem(OAUTH_PENDING_KEY); } catch (_) {} }
    function consumePendingOAuth() {
        try {
            const pending = JSON.parse(globalScope.sessionStorage.getItem(OAUTH_PENDING_KEY) || 'null');
            clearPendingOAuth();
            const age = Date.now() - pending?.createdAt;
            return pending?.provider === 'google' && pending?.redirectTo === callbackUrl() && Number.isFinite(age) && age >= 0 && age < OAUTH_TTL_MS;
        } catch (_) { clearPendingOAuth(); return false; }
    }
    function readOAuthCallback() {
        const url = new globalScope.URL(globalScope.location.href);
        const fragment = new globalScope.URLSearchParams(url.hash.slice(1));
        const keys = ['code', 'error', 'error_code', 'error_description', 'access_token', 'refresh_token', 'token_type', 'expires_in', 'expires_at'];
        const hasCallback = keys.some((key) => url.searchParams.has(key) || fragment.has(key));
        if (!hasCallback) return null;
        // Remove credentials and provider errors from the address bar before any
        // network operation. This page never consumes implicit-flow tokens.
        globalScope.history.replaceState(null, '', '/tg-admin.html');
        const pending = consumePendingOAuth();
        if (!pending || url.pathname !== '/tg-admin.html' || url.hash || url.searchParams.has('access_token') || url.searchParams.has('refresh_token')) return { error: '登录请求已过期或无效，请重新使用 Google 登录' };
        if (url.searchParams.has('error') || url.searchParams.has('error_code') || url.searchParams.has('error_description')) return { error: 'Google 登录未完成，请重新选择账号登录' };
        const codes = url.searchParams.getAll('code');
        if (codes.length !== 1 || !/^[A-Za-z0-9_-]{1,2048}$/.test(codes[0])) return { error: '登录请求已过期或无效，请重新使用 Google 登录' };
        return { code: codes[0] };
    }

    function productLabel(data) {
        const family = Object.hasOwn(data, 'product_family') ? data.product_family : 'telegram_premium';
        if (family === 'telegram_premium' && [3, 6, 12].includes(Number(data.term_months)) && data.stars_quantity == null) return `Premium · ${Number(data.term_months)} 个月`;
        const quantity = Number(data.stars_quantity);
        if (family === 'telegram_stars' && data.term_months == null && Number.isInteger(quantity) && quantity >= 50 && quantity <= 1000000) return `Stars · ${quantity.toLocaleString('zh-CN')} 颗`;
        return '产品权益未确认';
    }
    function syncProductFields() {
        const stars = $('tgProductFamily').value === 'telegram_stars';
        $('tgPremiumTermField').hidden = stars; $('tgPremiumTerm').disabled = stars;
        $('tgStarsQuantityField').hidden = !stars; $('tgStarsQuantity').disabled = !stars; $('tgStarsQuantity').required = stars;
    }

    function node(tag, value, className) {
        const element = document.createElement(tag);
        if (value !== undefined) element.textContent = String(value);
        if (className) element.className = className;
        return element;
    }
    function notice(id, message, type = '') { const element = $(id); element.textContent = message || ''; element.classList.toggle('error', type === 'error'); element.classList.toggle('success', type === 'success'); }
    function status(value) { return node('span', labels[value] || '未知状态', `tg-status-pill${['succeeded', 'active', 'fulfilled'].includes(value) ? ' success' : ['failed', 'revoked'].includes(value) ? ' danger' : ''}`); }
    function cell(row, value) { const element = node('td'); element.append(typeof value === 'object' && value ? value : node('span', value ?? '—')); row.append(element); return element; }
    function button(label, action, className = 'tg-link-button') {
        const element = node('button', label, className); element.type = 'button';
        element.addEventListener('click', async () => { if (element.disabled) return; element.disabled = true; try { await action(); } catch (error) { showError(error); } finally { element.disabled = false; } });
        return element;
    }
    function empty(body, count, message) { const row = node('tr'); const element = cell(row, message); element.colSpan = count; element.className = 'tg-empty'; body.replaceChildren(row); }
    function showLogin(message, denied = false, failed = false) {
        state.authenticated = false;
        $('tgAdminApp').hidden = true; $('tgLoginPanel').hidden = false;
        // An anonymous visitor has no session to log out of. Keep the action
        // visible only when a signed-in account was denied TG access.
        $('tgAdminLogout').hidden = !denied;
        $('tgAdminIdentity').textContent = denied ? '无 TG 管理权限' : '独立业务管理';
        notice('tgLoginMessage', message || '请登录超级管理员账号', denied || failed ? 'error' : '');
    }
    function showError(error) {
        if (error?.status === 401) return showLogin('登录已失效，请重新登录');
        if (error?.status === 403) return showLogin('当前账号没有 TG 管理权限，请切换超级管理员账号', true);
        notice('tgAdminAlert', error?.message || '操作失败，请稍后重试', 'error');
    }
    async function request(url, options = {}) {
        const response = await globalScope.fetch(url, { ...options, credentials: 'same-origin', cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            const error = Object.assign(new Error(response.status >= 500 ? '服务暂不可用，请稍后重试' : data.message || '请求失败'), { status: response.status });
            if ([401, 403].includes(response.status)) showError(error);
            throw error;
        }
        return data;
    }
    const post = (url, body) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    function pager(id, page, total, change) {
        const root = $(id); const max = Math.max(1, Math.ceil(total / PAGE_SIZE));
        const previous = button('上一页', () => change(page - 1), 'tg-button tg-button-secondary'); previous.disabled = page <= 1;
        const next = button('下一页', () => change(page + 1), 'tg-button tg-button-secondary'); next.disabled = page >= max;
        root.replaceChildren(node('span', `共 ${total} 条 · 第 ${page} / ${max} 页`, 'tg-muted'), previous, next);
    }
    async function loadBatches() {
        const version = ++state.batchVersion;
        const data = await request(`/api/admin/tg/codes?page=${state.batchPage}&pageSize=${PAGE_SIZE}`);
        if (version !== state.batchVersion || !state.authenticated) return;
        $('tgBatchCount').textContent = data.total ?? 0;
        const body = $('tgBatchesBody'); const rows = [];
        for (const batch of data.batches || []) {
            const row = node('tr'); const identity = node('div', batch.batch_no, 'tg-row-identity');
            if (batch.metadata?.name) identity.append(node('small', batch.metadata.name));
            cell(row, identity); cell(row, productLabel(batch)); cell(row, `${batch.generated_count ?? 0} / ${batch.quantity ?? 0}`); cell(row, status(batch.status)); cell(row, date(batch.created_at));
            const actions = node('div', undefined, 'tg-row-actions'); actions.append(button('详情', () => inspectBatch(batch.id)));
            if (batch.status === 'active') actions.append(button('撤销批次', () => revoke({ batch_id: batch.id }, `批次 ${batch.batch_no}`), 'tg-link-button tg-danger-link'));
            cell(row, actions); rows.push(row);
        }
        if (rows.length) body.replaceChildren(...rows); else empty(body, 6, '暂无兑换码批次');
        pager('tgBatchesPager', state.batchPage, data.total || 0, async (page) => { state.batchPage = page; await loadBatches(); });
    }
    async function loadOrders() {
        const version = ++state.orderVersion;
        const params = new URLSearchParams({ page: String(state.orderPage), pageSize: String(PAGE_SIZE) });
        if ($('tgOrderFilter').value) params.set('status', $('tgOrderFilter').value);
        const data = await request(`/api/admin/tg/orders?${params}`);
        if (version !== state.orderVersion || !state.authenticated) return;
        $('tgOrderCount').textContent = data.total ?? 0;
        const body = $('tgOrdersBody'); const rows = [];
        for (const order of data.orders || []) {
            const row = node('tr'); cell(row, order.order_no); cell(row, `@${order.telegram_username}`); cell(row, productLabel(order)); cell(row, status(order.status)); cell(row, date(order.updated_at || order.created_at));
            cell(row, button('详情 / 对账', () => inspectOrder(order.id))); rows.push(row);
        }
        if (rows.length) body.replaceChildren(...rows); else empty(body, 6, '暂无兑换订单');
        pager('tgOrdersPager', state.orderPage, data.total || 0, async (page) => { state.orderPage = page; await loadOrders(); });
    }
    async function loadProvider() {
        const data = await request('/api/admin/tg/provider');
        if (!state.authenticated) return;
        $('tgProviderStatus').textContent = data.healthy ? '服务连接正常' : data.configured ? '服务暂不可用' : '尚未配置上游';
        $('tgGramBalance').textContent = data.balances?.gram ?? '—'; $('tgUsdtBalance').textContent = data.balances?.usdt ?? '—';
        $('tgProviderCurrency').textContent = `当前扣款：${data.payment_currency === 'usdt' ? 'USDT' : data.payment_currency === 'gram' ? 'GRAM' : '未确认'}`;
        $('tgProviderSwitches').textContent = `兑换${data.redemption_enabled ? '已开放' : '未开放'} · 自动履约${data.fulfillment_enabled ? '已开启' : '未开启'}`;
        $('tgProviderChecked').textContent = `最近检查：${date(data.checked_at)}`;
    }
    function validPriceProduct(product) {
        if (!product || !productIds.includes(product.product_id) || product.currency !== 'CNY' || typeof product.enabled !== 'boolean'
            || !Number.isSafeInteger(product.price_version) || product.price_version < 1) return false;
        const stars = product.product_id === 'stars';
        const price = stars ? product.unit_price_micros : product.price_minor;
        if (stars ? product.product_family !== 'telegram_stars' || product.term_months != null
            : product.product_family !== 'telegram_premium' || product.product_id !== `premium_${product.term_months}`) return false;
        return price == null ? !product.enabled : Number.isSafeInteger(price) && price > 0;
    }
    async function loadProducts() {
        const version = ++state.productVersion;
        const data = await request('/api/admin/tg/products');
        if (version !== state.productVersion || !state.authenticated) return;
        if (!Array.isArray(data.products) || data.products.some((product) => !validPriceProduct(product))
            || new Set(data.products.map((product) => product.product_id)).size !== data.products.length) throw new Error('商品价格未能确认，请稍后刷新');
        priceProducts.clear(); data.products.forEach((product) => priceProducts.set(product.product_id, product));
        for (const id of productIds) {
            const product = priceProducts.get(id); const amount = id === 'stars' ? product?.unit_price_micros : product?.price_minor;
            $('tgPrice-' + id).value = Number.isSafeInteger(amount) && amount > 0 ? id === 'stars'
                ? (amount / 1000000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : (amount / 100).toFixed(2) : '';
            $('tgEnabled-' + id).checked = product?.enabled === true;
            $('tgVersion-' + id).textContent = product ? `v${product.price_version}` : '未配置';
            $('tgSave-' + id).disabled = !product || priceSaves.has(id);
        }
    }
    function decimalUnits(raw, places) {
        if (!new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${places}})?$`).test(raw)) return null;
        const parts = raw.split('.'); const digits = parts[0] + (parts[1] || '').padEnd(places, '0'); const amount = Number(digits);
        return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
    }
    async function saveProduct(id) {
        if (!state.authenticated || priceSaves.has(id)) return;
        const product = priceProducts.get(id); if (!product) return notice('tgPriceMessage', '商品尚未配置，请刷新后重试', 'error');
        const amount = decimalUnits(text($('tgPrice-' + id).value), id === 'stars' ? 6 : 2);
        if (amount === null) return notice('tgPriceMessage', id === 'stars' ? 'Stars 每颗单价须大于零，最多保留 6 位小数' : 'Premium 售价须大于零，最多保留 2 位小数', 'error');
        priceSaves.add(id); $('tgSave-' + id).disabled = true; notice('tgPriceMessage', '正在保存商品价格…');
        try {
            const data = await post('/api/admin/tg/products', { product_id: id, enabled: $('tgEnabled-' + id).checked, expected_price_version: product.price_version,
                [id === 'stars' ? 'unit_price_micros' : 'price_minor']: amount });
            if (!validPriceProduct(data.product) || data.product.product_id !== id || data.product.price_version <= product.price_version) throw new Error('保存结果未确认，请刷新价格后再操作');
            notice('tgPriceMessage', '商品价格已保存', 'success'); await loadProducts();
        } catch (error) { notice('tgPriceMessage', error.message || '商品价格保存失败，请刷新后重试', 'error'); showError(error); }
        finally { priceSaves.delete(id); $('tgSave-' + id).disabled = !state.authenticated || !priceProducts.has(id); }
    }
    async function loadPurchases() {
        const version = ++state.purchaseVersion;
        const data = await request(`/api/admin/tg/purchases?page=${state.purchasePage}&pageSize=${PAGE_SIZE}`);
        if (version !== state.purchaseVersion || !state.authenticated) return;
        const body = $('tgPurchasesBody'); const rows = [];
        for (const order of data.purchases || []) {
            const row = node('tr'); cell(row, order.order_no); cell(row, `@${order.telegram_username || order.username || '—'}`); cell(row, productLabel(order));
            cell(row, order.currency === 'CNY' && Number.isSafeInteger(order.total_minor) && order.total_minor > 0 ? `¥${(order.total_minor / 100).toFixed(2)}` : '金额未确认');
            cell(row, order.payment_channel === 'alipay' || order.channel === 'alipay' ? '支付宝' : order.payment_channel === 'wxpay' || order.channel === 'wxpay' ? '微信支付' : '—');
            cell(row, paymentLabels[order.payment_status] || '状态未确认'); cell(row, fulfillmentLabels[order.fulfillment_status] || '状态未确认'); cell(row, date(order.created_at)); rows.push(row);
        }
        if (rows.length) body.replaceChildren(...rows); else empty(body, 8, '暂无购买订单');
        pager('tgPurchasesPager', state.purchasePage, data.total || 0, async (page) => { state.purchasePage = page; await loadPurchases(); });
    }
    async function refresh() {
        if (!state.authenticated) return;
        $('tgAdminRefresh').disabled = true; notice('tgAdminAlert', '正在更新数据…');
        try { await Promise.all([loadBatches(), loadOrders(), loadProvider(), loadProducts(), loadPurchases()]); if (state.authenticated) notice('tgAdminAlert', '数据已更新', 'success'); }
        catch (error) { showError(error); } finally { $('tgAdminRefresh').disabled = false; }
    }
    function openDetail(title, content) { $('tgDetailTitle').textContent = title; $('tgDetailContent').replaceChildren(content); if (!$('tgDetailModal').open) $('tgDetailModal').showModal(); }
    async function inspectBatch(id) {
        const data = await request(`/api/admin/tg/codes?batchId=${encodeURIComponent(id)}`);
        const content = node('div'); const batch = data.batch || {};
        content.append(node('p', `${productLabel(batch)} · ${labels[batch.status] || '未知状态'} · 有效期：${date(batch.valid_until)}`, 'tg-muted'));
        const wrap = node('div', undefined, 'tg-table-wrap'); const table = node('table'); const head = node('tr');
        for (const label of ['后四位', '状态', '兑换账号', '更新时间 / 兑换时间', '操作']) head.append(node('th', label));
        const thead = node('thead'); thead.append(head); const body = node('tbody');
        for (const code of data.codes || []) {
            const row = node('tr'); cell(row, `…${code.code_last4}`); cell(row, status(code.status)); cell(row, code.telegram_username ? `@${code.telegram_username}` : '—'); cell(row, date(code.fulfilled_at || code.reserved_at || code.created_at));
            cell(row, code.status === 'available' ? button('撤销', async () => { const done = await revoke({ code_id: code.id }, `兑换码 …${code.code_last4}`); if (done) await inspectBatch(id); }, 'tg-link-button tg-danger-link') : '—'); body.append(row);
        }
        if (!data.codes?.length) empty(body, 5, '暂无兑换码');
        table.append(thead, body); wrap.append(table); content.append(wrap);
        if (batch.status === 'active') content.append(button('撤销此批次', async () => { const done = await revoke({ batch_id: id }, `批次 ${batch.batch_no}`); if (done) await inspectBatch(id); }, 'tg-button tg-button-secondary tg-danger-link'));
        openDetail(`批次 ${text(batch.batch_no)}`, content);
    }
    async function revoke(target, label) {
        if (!globalScope.confirm(`确认撤销${label}？未兑换的码将无法继续使用；正在履约的订单仍会保留。`)) return false;
        await post('/api/admin/tg/codes', { action: 'revoke', ...target });
        notice('tgAdminAlert', '撤销操作已完成', 'success'); await loadBatches(); return true;
    }
    function detailItem(list, name, value) { const group = node('div'); group.append(node('dt', name), node('dd', value ?? '—')); list.append(group); }
    async function inspectOrder(id, reconcile = false) {
        const data = await request(`/api/admin/tg/orders?orderId=${encodeURIComponent(id)}${reconcile ? '&reconcile=1' : ''}`);
        const order = data.order || {}; const content = node('div'); const list = node('dl', undefined, 'tg-order-details');
        detailItem(list, '订单号', order.order_no); detailItem(list, '兑换账号', `@${order.telegram_username}`); detailItem(list, '产品 / 权益', productLabel(order)); detailItem(list, '本地状态', labels[order.status] || '未知状态'); detailItem(list, '上游订单号', order.provider_order_id); detailItem(list, '扣款币种', ['usdt', 'gram'].includes(order.provider_payment_currency) ? order.provider_payment_currency.toUpperCase() : '未确认'); detailItem(list, '提交时间', date(order.submitted_at)); detailItem(list, '完成时间', date(order.completed_at)); detailItem(list, '最近异常', order.last_error_message);
        content.append(list);
        if (order.provider_order_id) content.append(button('只读核对上游订单', () => inspectOrder(id, true), 'tg-button tg-button-secondary'));
        else content.append(node('p', '尚无上游订单号，不能自动重试购买或重新释放兑换码。', 'tg-muted'));
        if (data.reconciliation) {
            const check = data.reconciliation;
            content.append(node('p', check.verified ? '上游订单身份与产品权益核对一致。' : '上游订单信息未通过核对，请人工处理。', check.verified ? 'tg-success-text' : 'tg-warning'));
            if (check.verified) content.append(node('p', `上游状态：${check.snapshot?.provider_status || '未知'} · 检查时间：${date(check.checked_at)}`, 'tg-muted'));
            content.append(node('p', '此次仅查询和核对，不会修改订单、重新扣款或重置兑换码。', 'tg-muted'));
        }
        openDetail('兑换订单详情', content);
    }
    async function generate(event) {
        event.preventDefault(); if (state.generating || !state.authenticated) return;
        const form = event.currentTarget; const input = Object.fromEntries(new globalScope.FormData(form).entries());
        input.product_family = input.product_family || 'telegram_premium'; input.count = Number(input.count);
        if (!Number.isInteger(input.count) || input.count < 1 || input.count > 1000) return notice('tgGenerateMessage', '兑换码张数须为 1 至 1,000 的整数', 'error');
        if (input.product_family === 'telegram_stars') {
            input.stars_quantity = Number(input.stars_quantity); delete input.term_months;
            if (!Number.isInteger(input.stars_quantity) || input.stars_quantity < 50 || input.stars_quantity > 1000000) return notice('tgGenerateMessage', '每码星星数量须为 50 至 1,000,000 的整数', 'error');
        } else if (input.product_family === 'telegram_premium') {
            input.term_months = Number(input.term_months); delete input.stars_quantity;
            if (![3, 6, 12].includes(input.term_months)) return notice('tgGenerateMessage', '请选择有效的 Premium 会员时长', 'error');
        } else return notice('tgGenerateMessage', '请选择有效的兑换产品', 'error');
        if (input.valid_until) {
            if (!Number.isFinite(Date.parse(input.valid_until))) return notice('tgGenerateMessage', '请选择有效的兑换码有效期', 'error');
            input.valid_until = new Date(input.valid_until).toISOString();
        }
        state.generating = true; $('tgGenerateSubmit').disabled = true; notice('tgGenerateMessage', '正在生成，请勿重复操作…');
        try {
            const data = await post('/api/admin/tg/codes', { action: 'generate', ...input });
            const codePattern = input.product_family === 'telegram_stars' ? /^TG-STAR-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/ : /^TG-PREM-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/;
            if (!Array.isArray(data.codes) || data.codes.length !== input.count || !data.codes.every((code) => typeof code === 'string' && codePattern.test(code))) throw new Error('生成结果异常，请先核对批次，勿重复生成');
            $('tgCodesText').value = data.codes.join('\n'); data.codes.fill('');
            $('tgCodesSaved').checked = false; notice('tgCodesCopyMessage', ''); $('tgCodesModal').showModal();
            notice('tgGenerateMessage', '生成成功，请先保存弹窗内的兑换码', 'success'); form.reset(); syncProductFields(); state.batchPage = 1;
            await loadBatches();
        } catch (error) { notice('tgGenerateMessage', `${error.message || '生成结果未确认'}。请先检查批次列表再重试。`, 'error'); showError(error); }
        finally { state.generating = false; $('tgGenerateSubmit').disabled = false; }
    }
    function closeCodes() {
        if (!$('tgCodesSaved').checked) { notice('tgCodesCopyMessage', '请先保存兑换码，并勾选保存确认后关闭', 'error'); return; }
        $('tgCodesText').value = ''; $('tgCodesSaved').checked = false; notice('tgCodesCopyMessage', ''); $('tgCodesModal').close();
    }
    async function copyCodes() {
        try {
            if (!globalScope.navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
            await globalScope.navigator.clipboard.writeText($('tgCodesText').value); notice('tgCodesCopyMessage', '已复制，请粘贴到安全位置保存', 'success');
        } catch (_) { $('tgCodesText').focus(); $('tgCodesText').select(); notice('tgCodesCopyMessage', '自动复制失败，请手动复制已选中的兑换码', 'error'); }
    }
    async function verifyAccess() {
        const isolated = { supabaseClient: client, forceRefresh: true, allowPersistedSessionFallback: false };
        let access;
        try { access = await globalScope.AdminAccess.getCurrentAdminAccess(isolated); }
        catch (_) { throw new Error('管理员权限核验暂不可用，请稍后重试'); }
        if (!access.user) { showLogin('请登录超级管理员账号'); return false; }
        if (access.error) throw new Error('管理员权限核验暂不可用，请稍后重试');
        // Use the identity verified by Supabase, never the editable login form.
        // Recheck restored sessions too, so reload cannot skip an account lock.
        try { await securityCheck('preflight', access.user.email); }
        catch (error) { await clearTgSession(); throw error; }
        if (!access.isSuperAdmin) { showLogin('当前账号没有 TG 管理权限，请切换超级管理员账号', true); return false; }
        const session = await globalScope.AdminAccess.createAdminStudioSession({ ...isolated, userId: access.user.id });
        if (!session?.ok) { if ([401, 403].includes(session?.status)) showLogin(session.status === 403 ? '当前账号没有 TG 管理权限' : '登录已失效，请重新登录', session.status === 403); else throw new Error('安全访问凭证签发失败，请稍后重试'); return false; }
        state.authenticated = true; $('tgLoginPanel').hidden = true; $('tgAdminApp').hidden = false; $('tgAdminLogout').hidden = false; $('tgAdminIdentity').textContent = access.user.email || '超级管理员';
        await refresh(); return true;
    }
    async function securityCheck(action, email) {
        if (action !== 'preflight_ip' && !text(email)) throw new Error('无法确认账号信息，请重新登录');
        let data;
        try { data = await post('/api/auth/login-security', { action, ...(email ? { email } : {}) }); }
        catch (_) { throw new Error('登录安全检查暂不可用，请稍后重试'); }
        if (typeof data.security?.ip_blocked !== 'boolean' || typeof data.security?.account_locked !== 'boolean') throw new Error('登录安全检查暂不可用，请稍后重试');
        if (data.security.ip_blocked) throw new Error('当前网络受到安全限制，请稍后再试或联系管理员');
        if (data.security.account_locked) {
            const seconds = Number(data.security.remaining_seconds);
            const wait = Number.isFinite(seconds) && seconds > 0 ? `，请约 ${Math.ceil(seconds / 60)} 分钟后重试` : '，请稍后再试或联系管理员';
            throw new Error(`该账号登录受到安全限制${wait}`);
        }
    }
    async function clearTgSession() {
        state.authenticated = false; $('tgAdminApp').hidden = true;
        await Promise.allSettled([globalScope.AdminAccess.clearAdminStudioSession(), client?.auth.signOut({ scope: 'local' })]);
        globalScope.AdminAccess.clearAccessCache();
    }
    async function googleLogin() {
        if (state.initializing || state.loggingIn || !client) return;
        state.loggingIn = true; updateLoginControls(); notice('tgLoginMessage', '正在连接 Google 安全登录…');
        let navigating = false;
        let securityMessage = '';
        try {
            try { await securityCheck('preflight_ip'); } catch (error) { securityMessage = error.message; throw error; }
            const redirectTo = callbackUrl();
            // This marker contains no credential. PKCE's verifier stays in the
            // isolated Supabase client and binds the returned authorization code.
            globalScope.sessionStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify({ provider: 'google', redirectTo, createdAt: Date.now() }));
            const result = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } } });
            if (result.error || !result.data?.url) throw new Error('oauth_unavailable');
            const authorize = new globalScope.URL(result.data.url);
            if (authorize.origin !== authOrigin || authorize.username || authorize.password || authorize.hash || authorize.pathname !== '/auth/v1/authorize'
                || authorize.searchParams.getAll('provider').length !== 1 || authorize.searchParams.get('provider') !== 'google'
                || authorize.searchParams.getAll('redirect_to').length !== 1 || authorize.searchParams.get('redirect_to') !== redirectTo
                || authorize.searchParams.getAll('code_challenge_method').length !== 1 || authorize.searchParams.get('code_challenge_method') !== 's256'
                || authorize.searchParams.getAll('code_challenge').length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(authorize.searchParams.get('code_challenge') || '')) throw new Error('oauth_invalid_url');
            globalScope.location.assign(authorize.href); navigating = true;
        } catch (_) {
            clearPendingOAuth();
            // Preserve a precise lock message, but never echo provider URLs,
            // authorization codes, or raw provider errors into the page.
            notice('tgLoginMessage', securityMessage || 'Google 登录暂未完成，请稍后重试', 'error');
        } finally { if (!navigating) { state.loggingIn = false; updateLoginControls(); } }
    }
    async function login(event) {
        event.preventDefault(); if (state.initializing || state.loggingIn || !client) return;
        clearPendingOAuth(); state.loggingIn = true; updateLoginControls();
        const form = event.currentTarget; const email = text(form.elements.email.value).toLowerCase(); const password = form.elements.password.value;
        notice('tgLoginMessage', '正在安全验证并登录…');
        try {
            await securityCheck('preflight', email);
            const result = await client.auth.signInWithPassword({ email, password });
            if (result.error) {
                if (result.error.code === 'invalid_credentials') { await securityCheck('record_failure', email); throw new Error('邮箱或密码错误，或当前账号暂不可登录'); }
                throw new Error('邮箱登录暂不可用，请稍后重试');
            }
            form.elements.password.value = ''; globalScope.AdminAccess.clearAccessCache(); await verifyAccess();
        } catch (error) { notice('tgLoginMessage', error.message || '登录失败，请稍后重试', 'error'); }
        finally { form.elements.password.value = ''; state.loggingIn = false; updateLoginControls(); }
    }
    async function logout() {
        if ($('tgCodesModal').open && !$('tgCodesSaved').checked) { notice('tgCodesCopyMessage', '请先保存本次兑换码，再退出登录', 'error'); return; }
        if ($('tgCodesModal').open) closeCodes();
        clearPendingOAuth();
        try { await globalScope.AdminAccess.clearAdminStudioSession(); await client?.auth.signOut({ scope: 'local' }); globalScope.AdminAccess.clearAccessCache(); showLogin('已退出，请登录超级管理员账号'); }
        catch (_) { showLogin('退出请求未完成，请刷新后确认登录状态'); }
    }
    $('tgGenerateForm').addEventListener('submit', generate); $('tgLoginForm').addEventListener('submit', login); $('tgGoogleLogin').addEventListener('click', googleLogin); $('tgAdminRefresh').addEventListener('click', refresh); $('tgAdminLogout').addEventListener('click', logout);
    $('tgOrderFilter').addEventListener('change', () => { state.orderPage = 1; loadOrders().catch(showError); });
    $('tgProductFamily').addEventListener('change', syncProductFields);
    for (const id of productIds) $('tgSave-' + id).addEventListener('click', () => saveProduct(id));
    $('tgCodesClose').addEventListener('click', closeCodes); $('tgCodesCopy').addEventListener('click', copyCodes); $('tgCodesModal').addEventListener('cancel', (event) => { event.preventDefault(); closeCodes(); });
    $('tgCodesModal').addEventListener('close', () => { $('tgCodesText').value = ''; });
    $('tgDetailClose').addEventListener('click', () => { $('tgDetailModal').close(); $('tgDetailContent').replaceChildren(); });
    globalScope.addEventListener('beforeunload', (event) => { if ($('tgCodesText').value) { event.preventDefault(); event.returnValue = ''; } });
    globalScope.addEventListener('pageshow', (event) => { if (event.persisted) { clearPendingOAuth(); state.loggingIn = false; updateLoginControls(); } });
    syncProductFields();
    async function boot() {
        updateLoginControls();
        let callback;
        try {
            callback = readOAuthCallback();
            const config = globalScope.requireZaoyoeSupabaseConfig();
            if (!globalScope.supabase?.createClient || !globalScope.AdminAccess) throw new Error('登录组件未就绪，请刷新重试');
            authOrigin = new globalScope.URL(config.url).origin;
            client = globalScope.supabase.createClient(config.url, config.publishableKey, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'tg-admin-auth-v1' } });
            globalScope.supabaseClient = client;
            if (callback?.error) { await clearTgSession(); throw new Error(callback.error); }
            if (callback?.code) {
                notice('tgLoginMessage', '正在核验 Google 账号及管理权限…');
                let result;
                try { result = await client.auth.exchangeCodeForSession(callback.code); }
                catch (_) { await clearTgSession(); throw new Error('Google 登录暂未完成，请稍后重试'); }
                callback.code = '';
                if (result.error) { await clearTgSession(); throw new Error('Google 登录已失效，请重新选择账号登录'); }
                globalScope.AdminAccess.clearAccessCache();
            }
            await verifyAccess();
        } catch (error) { showLogin(error.message || '管理后台初始化失败，请稍后重试', false, true); }
        finally { if (callback) callback.code = ''; state.initializing = false; updateLoginControls(); }
    }
    boot();
})(window);
