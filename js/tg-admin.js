(function initTelegramAdminPage(globalScope) {
    'use strict';
    const document = globalScope.document;
    const $ = (id) => document.getElementById(id);
    const text = (value) => String(value ?? '').trim();
    const PAGE_SIZE = 25;
    const state = { authenticated: false, workspaceLoading: true, generating: false, initializing: true, loggingIn: false, batchPage: 1, orderPage: 1, purchasePage: 1, batchVersion: 0, orderVersion: 0, purchaseVersion: 0, productVersion: 0, detailVersion: 0, reviewVersion: 0, reviewOrderNo: null, reviewSnapshot: null, reviewSubmitting: false, reviewLoading: false, purchaseClosing: false, redemptionResolving: false };
    const pendingRedemptions = new Map();
    const appliedFilters = { Batch: {}, Order: {}, Purchase: {} };
    const channelLabels = { alipay: '支付宝', wxpay: '微信支付', usdt_bep20: 'USDT' };
    const OAUTH_PENDING_KEY = 'tg-admin-google-pending-v1';
    const OAUTH_TTL_MS = 10 * 60 * 1000;
    const priceProducts = new Map();
    const priceSaves = new Set();
    const productIds = ['premium_3', 'premium_6', 'premium_12', 'stars'];
    const paymentLabels = { pending: '待付款', paid: '已付款', expired: '已过期', cancelled: '已取消', failed: '支付未完成', manual_review: '人工核对' };
    const fulfillmentLabels = { not_started: '尚未发货', pending: '待发货', processing: '处理中', retry_waiting: '等待确认', succeeded: '已发货', failed: '发货失败', manual_review: '人工复核', cancelled: '已取消', closed: '已完结' };
    const labels = { pending: '待处理', processing: '处理中', retry_waiting: '等待重试', succeeded: '已完成', failed: '失败', manual_review: '人工复核', cancelled: '已取消', closed: '已完结', active: '启用', available: '可兑换', reserved: '已预留', fulfilling: '履约中', fulfilled: '已兑换', revoked: '已撤销', expired: '已过期', disabled: '已停用', exhausted: '已耗尽', draft: '草稿' };
    const date = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
    let client;
    let authOrigin;
    let dataCenter;
    let providerVersion = 0;

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
        const isCallbackPath = url.pathname === '/tg-admin' || url.pathname === '/tg-admin.html';
        globalScope.history.replaceState(null, '', isCallbackPath ? url.pathname : '/tg-admin.html');
        const pending = consumePendingOAuth();
        if (!pending || !isCallbackPath || url.hash || url.searchParams.has('access_token') || url.searchParams.has('refresh_token')) return { error: '登录请求已过期或无效，请重新使用 Google 登录' };
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
        globalScope.TgAdminSelects?.sync();
    }

    function node(tag, value, className) {
        const element = document.createElement(tag);
        if (value !== undefined) element.textContent = String(value);
        if (className) element.className = className;
        return element;
    }
    let alertTimer = null;
    let alertVersion = 0;
    function notice(id, message, type = '') {
        const element = $(id);
        element.textContent = message || '';
        element.classList.toggle('error', type === 'error'); element.classList.toggle('success', type === 'success');
        if (id !== 'tgAdminAlert') return;
        if (alertTimer !== null) globalScope.clearTimeout(alertTimer);
        alertTimer = null;
        const version = ++alertVersion;
        if (message) alertTimer = globalScope.setTimeout(() => {
            if (version === alertVersion) { alertTimer = null; notice(id, ''); }
        }, type === 'error' ? 7000 : 3000);
    }
    function status(value, names = labels) {
        const tone = ['succeeded', 'paid', 'active', 'fulfilled', 'available'].includes(value) ? 'success'
            : ['failed', 'revoked'].includes(value) ? 'danger'
                : ['manual_review', 'reserved'].includes(value) ? 'warning'
                    : ['processing', 'retry_waiting', 'pending', 'fulfilling'].includes(value) ? 'progress' : 'neutral';
        return node('span', names[value] || '状态未确认', `tg-status-pill ${tone}`);
    }
    function cell(row, value) { const element = node('td'); element.append(typeof value === 'object' && value ? value : node('span', value ?? '—')); row.append(element); return element; }
    function button(label, action, className = 'tg-link-button') {
        const element = node('button', label, className); element.type = 'button';
        element.addEventListener('click', async () => { if (element.disabled) return; element.disabled = true; try { await action(); } catch (error) { showError(error); } finally { element.disabled = false; } });
        return element;
    }
    function empty(body, count, message) { const row = node('tr'); const element = cell(row, message); element.colSpan = count; element.className = 'tg-empty'; body.replaceChildren(row); }
    function showLogin(message, denied = false, failed = false) {
        notice('tgAdminAlert', '');
        state.authenticated = false;
        providerVersion++; dataCenter?.reset(); clearDataCenterContexts();
        state.workspaceLoading = false;
        document.body.classList.toggle('tg-admin-is-loading', false);
        closeAdminNavigation();
        resetOrderSearch({ clearInput: true });
        closePurchaseReview(); closeDetail();
        globalScope.TgAdminSelects?.close();
        $('tgAdminLoading').hidden = true;
        $('tgAdminApp').hidden = true; $('tgLoginPanel').hidden = false;
        // An anonymous visitor has no session to log out of. Keep the action
        // visible only when a signed-in account was denied TG access.
        $('tgAdminLogout').hidden = !denied;
        notice('tgLoginMessage', message || '请登录超级管理员账号', denied || failed ? 'error' : '');
    }
    function showSessionLoading(message = '正在恢复管理会话…', retry = false) {
        state.authenticated = false;
        providerVersion++; dataCenter?.reset(); clearDataCenterContexts();
        state.workspaceLoading = true;
        document.body.classList.toggle('tg-admin-is-loading', true);
        closeAdminNavigation();
        resetOrderSearch({ clearInput: true });
        closePurchaseReview(); closeDetail();
        globalScope.TgAdminSelects?.close();
        $('tgLoginPanel').hidden = true; $('tgAdminApp').hidden = true; $('tgAdminLogout').hidden = true;
        $('tgAdminLoading').hidden = false; $('tgAdminLoading').setAttribute('aria-busy', String(!retry));
        $('tgAdminLoading').classList.toggle('is-retry', retry);
        $('tgAdminLoadingMessage').textContent = message;
        $('tgAdminSkeleton').hidden = retry; $('tgAdminRetry').hidden = !retry;
    }
    function sessionRetryError(message) { return Object.assign(new Error(message), { retryableSession: true }); }
    async function restoreSession() {
        if (typeof client.auth.getSession !== 'function') throw sessionRetryError('会话恢复组件暂不可用，请重试连接。');
        let timer;
        try {
            const result = await Promise.race([client.auth.getSession(), new Promise((_, reject) => {
                timer = globalScope.setTimeout(() => reject(sessionRetryError('恢复会话超时，请重试连接。')), 12000);
            })]);
            if (result.error) {
                if ([400, 401, 403].includes(result.error.status)) return false;
                throw sessionRetryError('暂时无法恢复管理会话，请重试连接。');
            }
            return !!result.data?.session;
        } catch (error) {
            if ([400, 401, 403].includes(error.status)) return false;
            throw error.retryableSession ? error : sessionRetryError('暂时无法恢复管理会话，请重试连接。');
        }
        finally { globalScope.clearTimeout(timer); }
    }
    function showError(error) {
        if (error?.status === 401) return showLogin('登录已失效，请重新登录');
        if (error?.status === 403) return showLogin('当前账号没有 TG 管理权限，请切换超级管理员账号', true);
        notice('tgAdminAlert', error?.message || '操作失败，请稍后重试', 'error');
    }
    function redemptionPendingKey(orderNo) { return `tg-admin-redemption-pending-v1:${state.actorId}:${orderNo}`; }
    function readPendingRedemption(orderNo) {
        const key = redemptionPendingKey(orderNo);
        try {
            const input = JSON.parse(globalScope.sessionStorage.getItem(key) || 'null') || pendingRedemptions.get(key);
            if (input?.order_no === orderNo && ['link_upstream_order', 'close_with_nonacceptance', 'complete_review'].includes(input.action)
                && /^[0-9a-f-]{36}$/i.test(input.operation_id || '') && typeof input.note === 'string'
                && typeof input.expected_updated_at === 'string' && typeof input.expected_code_updated_at === 'string') return input;
        } catch (_) { return pendingRedemptions.get(key) || null; }
        return null;
    }
    function savePendingRedemption(orderNo, input) {
        const key = redemptionPendingKey(orderNo); pendingRedemptions.set(key, input);
        try { globalScope.sessionStorage.setItem(key, JSON.stringify(input)); } catch (_) {}
    }
    function clearPendingRedemption(orderNo) {
        const key = redemptionPendingKey(orderNo); pendingRedemptions.delete(key);
        try { globalScope.sessionStorage.removeItem(key); } catch (_) {}
    }
    async function request(url, options = {}) {
        const response = await globalScope.fetch(url, { ...options, credentials: 'same-origin', cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            const notApplied = data.not_applied === true && ['redemption_resolution_confirmation_required', 'redemption_resolution_database_rejected'].includes(data.code);
            const error = Object.assign(new Error(response.status >= 500 && !notApplied ? '服务暂不可用，请稍后重试' : data.message || '请求失败'),
                { status: response.status, code: data.code, notApplied });
            if ([401, 403].includes(response.status)) showError(error);
            throw error;
        }
        return data;
    }
    const post = (url, body) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const ADMIN_SECTIONS = ['Dashboard', 'Query', 'Purchases', 'Orders', 'Codes', 'Products', 'Provider'];
    const SECTION_KEY = 'tg-admin-section-v1';
    const navMedia = globalScope.matchMedia('(max-width: 620px)');
    const navState = { open: false, hovered: false, keyboard: false, section: 'Dashboard' };
    function updateAdminNavigation() {
        const open = state.authenticated && navMedia.matches && navState.open;
        const expanded = state.authenticated && (navMedia.matches ? open : navState.open || navState.hovered || navState.keyboard);
        const label = expanded ? '收起管理导航' : '展开管理导航';
        $('tgAdminApp').classList.toggle('is-nav-open', open);
        $('tgAdminApp').classList.toggle('is-nav-expanded', expanded);
        $('tgAdminNavToggle').hidden = !state.authenticated || state.workspaceLoading;
        $('tgAdminRefresh').hidden = !state.authenticated || state.workspaceLoading;
        for (const id of ['tgAdminNavToggle', 'tgAdminNavClose']) {
            $(id).setAttribute('aria-expanded', String(expanded));
            $(id).setAttribute('aria-label', label);
            $(id).setAttribute('title', label);
        }
        $('tgAdminNavBackdrop').hidden = !open;
        $('tgAdminSidebar').inert = !state.authenticated || (navMedia.matches && !open);
        $('tgAdminSidebar').setAttribute('aria-hidden', String($('tgAdminSidebar').inert));
        $('tgAdminSidebar').setAttribute('role', open ? 'dialog' : 'complementary');
        if (open) $('tgAdminSidebar').setAttribute('aria-modal', 'true');
        else $('tgAdminSidebar').removeAttribute('aria-modal');
        $('tgAdminWorkspace').inert = open;
        $('tgAdminHeader').inert = open;
        document.body.classList.toggle('tg-admin-has-navigation', state.authenticated);
        document.body.classList.toggle('tg-admin-drawer-open', open);
    }
    function closeAdminNavigation({ returnFocus = false } = {}) {
        const wasExpanded = navState.open || navState.hovered || navState.keyboard;
        navState.open = false;
        navState.hovered = false;
        navState.keyboard = false;
        updateAdminNavigation();
        if (returnFocus && wasExpanded && state.authenticated && navMedia.matches) $('tgAdminNavToggle').focus();
    }
    function toggleAdminNavigation() {
        if (!state.authenticated) return;
        globalScope.TgAdminSelects?.close();
        if (navState.open || navState.hovered || navState.keyboard) closeAdminNavigation({ returnFocus: true });
        else {
            navState.open = true;
            updateAdminNavigation();
            if (navMedia.matches) $('tgAdminTab' + navState.section).focus();
        }
    }
    function handleAdminNavigationKey(event) {
        if (!state.authenticated || !(navState.open || navState.hovered || navState.keyboard)) return;
        if (event.key === 'Escape') { event.preventDefault(); closeAdminNavigation({ returnFocus: true }); }
        if (!navMedia.matches || !navState.open || event.key !== 'Tab') return;
        const first = $('tgAdminNavClose'); const last = $('tgAdminTab' + navState.section);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    const searchState = { kind: 'purchase', version: 0, page: 1, busy: false, submitted: false };
    function selectAdminSection(section, { focus = false, remember = true } = {}) {
        if (!ADMIN_SECTIONS.includes(section)) section = 'Dashboard';
        globalScope.TgAdminSelects?.close();
        for (const key of ADMIN_SECTIONS) {
            const active = section === key;
            $('tgAdminPanel' + key).hidden = !active;
            $('tgAdminTab' + key).setAttribute('aria-selected', String(active));
            $('tgAdminTab' + key).setAttribute('tabindex', active ? '0' : '-1');
        }
        navState.section = section;
        document.documentElement.setAttribute('data-tg-admin-section', section);
        if (focus) $('tgAdminTab' + section).focus();
        if (remember) { try { globalScope.sessionStorage.setItem(SECTION_KEY, section); } catch (_) {} }
    }
    function restoreAdminSection() {
        let section;
        try { section = globalScope.sessionStorage.getItem(SECTION_KEY); } catch (_) {}
        selectAdminSection(section, { remember: false });
    }
    function resetOrderSearch({ clearInput = false, message = '' } = {}) {
        searchState.version++; searchState.busy = false; searchState.submitted = false; searchState.page = 1;
        if (clearInput) $('tgAdminQueryValue').value = '';
        $('tgAdminQueryResults').hidden = true;
        $('tgAdminQueryResults').setAttribute('aria-busy', 'false');
        $('tgAdminQueryForm').setAttribute('aria-busy', 'false');
        $('tgAdminQuerySubmit').disabled = false;
        $('tgAdminQueryList').replaceChildren(); $('tgAdminQueryPager').replaceChildren();
        $('tgAdminQueryCount').textContent = '';
        notice('tgAdminQueryMessage', message);
    }
    function syncOrderSearchField() {
        const mode = $('tgAdminQuerySearchBy').value || 'email';
        const labels = { email: ['查询邮箱', '输入用户下单时设置的查询邮箱'], order_no: ['订单号', searchState.kind === 'purchase' ? '输入完整的 TGP- 购买订单号' : '输入完整的 TG- 兑换订单号'], username: ['Telegram 用户名', '输入 Telegram 用户名，可带 @'] };
        const [label, placeholder] = labels[mode] || labels.email;
        $('tgAdminQueryLabel').textContent = label;
        $('tgAdminQueryValue').setAttribute('placeholder', placeholder);
        $('tgAdminQueryValue').setAttribute('inputmode', mode === 'email' ? 'email' : 'text');
    }
    function selectOrderSearchKind(kind, { focus = false } = {}) {
        if (!state.authenticated) return;
        if (kind !== searchState.kind) {
            searchState.kind = kind;
            resetOrderSearch({ message: '订单类型已切换，请确认查询信息后重新查询。' });
        }
        for (const [name, value] of [['Purchase', 'purchase'], ['Redeem', 'redeem']]) {
            const active = kind === value;
            $('tgAdminQuery' + name).setAttribute('aria-selected', String(active));
            $('tgAdminQuery' + name).setAttribute('tabindex', active ? '0' : '-1');
            if (active && focus) $('tgAdminQuery' + name).focus();
        }
        $('tgAdminQueryResults').setAttribute('aria-labelledby', kind === 'purchase' ? 'tgAdminQueryPurchase' : 'tgAdminQueryRedeem');
        syncOrderSearchField();
    }
    function orderSearchCard(order, kind, version) {
        const purchase = kind === 'purchase';
        const card = node('article', undefined, 'tg-panel tg-orders-order-card');
        const head = node('div', undefined, 'tg-orders-card-head');
        const identity = node('div', undefined, 'tg-orders-card-number');
        identity.append(node('strong', order.order_no), node('small', date(order.created_at)));
        const statuses = node('div', undefined, 'tg-admin-query-status');
        statuses.append(node('span', purchase ? paymentLabels[order.payment_status] || '支付状态未确认' : labels[order.status] || '状态未确认', `tg-orders-badge is-${purchase ? order.payment_status : order.status}`));
        if (purchase) statuses.append(node('span', fulfillmentLabels[order.fulfillment_status] || '发货状态未确认', `tg-orders-badge is-${order.fulfillment_status}`));
        head.append(identity, statuses);
        const body = node('div', undefined, 'tg-orders-card-body');
        const details = node('div');
        details.append(node('h3', productLabel(order)), node('p', `接收账号：@${order.username}`));
        if (purchase) details.append(node('p', `支付方式：${({ alipay: '支付宝', wxpay: '微信支付', usdt_bep20: 'USDT' })[order.payment_channel] || '—'}${order.crypto_network ? ` · ${order.crypto_network}` : ''}`, 'tg-admin-query-channel'));
        const actions = node('div', undefined, 'tg-orders-card-bottom');
        const checkoutPending = order.payment_status === 'pending' && order.fulfillment_status === 'not_started' && !order.closed_at;
        const amount = !purchase ? '兑换码订单' : order.payment_channel === 'usdt_bep20'
            ? order.crypto_pay_amount ? `${order.crypto_pay_amount} USDT` : checkoutPending ? 'USDT 金额见详情' : '未记录 USDT 金额'
            : Number.isSafeInteger(order.total_minor) ? `¥${(order.total_minor / 100).toFixed(2)}` : '金额未确认';
        actions.append(node('strong', amount, 'tg-orders-card-amount'), button(purchase ? order.payment_status === 'manual_review' ? '审核补发' : '详情 / 核对' : '详情 / 对账', async () => {
            if (version !== searchState.version || !state.authenticated) return;
            if (purchase) await inspectPurchase(order.order_no); else await inspectOrder(order.id);
        }, 'tg-button tg-button-secondary'));
        body.append(details, actions); card.append(head, body); return card;
    }
    async function queryAdminOrders(page = 1) {
        if (!state.authenticated || searchState.busy) return;
        const query = text($('tgAdminQueryValue').value);
        if (!query) { resetOrderSearch({ message: '请先填写查询信息。' }); $('tgAdminQueryValue').focus(); return; }
        const kind = searchState.kind;
        const version = ++searchState.version;
        searchState.busy = true; searchState.submitted = false;
        $('tgAdminQueryResults').hidden = true; $('tgAdminQueryList').replaceChildren(); $('tgAdminQueryPager').replaceChildren();
        $('tgAdminQueryForm').setAttribute('aria-busy', 'true'); $('tgAdminQueryResults').setAttribute('aria-busy', 'true');
        $('tgAdminQuerySubmit').disabled = true;
        notice('tgAdminQueryMessage', '正在查询订单…');
        try {
            const data = await post('/api/admin/tg/order-query', { kind, search_by: $('tgAdminQuerySearchBy').value || 'email', query, page });
            if (version !== searchState.version || !state.authenticated) return;
            if (data.success !== true || data.kind !== kind || data.page !== page || data.page_size !== 20 || !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.orders) || data.orders.length > 20) throw new Error('查询结果尚未确认，请重试。');
            searchState.page = page; searchState.submitted = true;
            $('tgAdminQueryTitle').textContent = kind === 'purchase' ? '购买订单' : '兑换订单';
            $('tgAdminQueryCount').textContent = `共 ${data.total} 笔订单`;
            if (data.orders.length) $('tgAdminQueryList').replaceChildren(...data.orders.map(order => orderSearchCard(order, kind, version)));
            else {
                const empty = node('article', undefined, 'tg-panel tg-orders-empty');
                empty.append(node('strong', '没有找到匹配的订单'), node('p', '请核对订单类型和查询信息；未绑定查询邮箱的旧订单可改用订单号或 Telegram 用户名查找。'));
                $('tgAdminQueryList').replaceChildren(empty);
            }
            pager('tgAdminQueryPager', page, data.total, nextPage => {
                if (version === searchState.version && state.authenticated) return queryAdminOrders(nextPage);
            }, 20);
            $('tgAdminQueryResults').hidden = false;
            notice('tgAdminQueryMessage', data.total ? '已找到订单，可查看详情并核对支付与发货状态。' : '查询完成，暂无匹配订单。');
        } catch (error) {
            if (version !== searchState.version || !state.authenticated) return;
            notice('tgAdminQueryMessage', error.code === 'order_query_migration_required' ? '邮箱查询尚未完成数据库升级，请改用订单号或 Telegram 用户名查询。' : error.message || '查询暂不可用，请稍后重试。', 'error');
        } finally {
            if (version === searchState.version) {
                searchState.busy = false; $('tgAdminQuerySubmit').disabled = false;
                $('tgAdminQueryForm').setAttribute('aria-busy', 'false'); $('tgAdminQueryResults').setAttribute('aria-busy', 'false');
            }
        }
    }
    function pager(id, page, total, change, pageSize = PAGE_SIZE) {
        const root = $(id); const max = Math.max(1, Math.ceil(total / pageSize));
        const previous = button('上一页', () => change(page - 1), 'tg-button tg-button-secondary'); previous.disabled = page <= 1;
        const next = button('下一页', () => change(page + 1), 'tg-button tg-button-secondary'); next.disabled = page >= max;
        root.replaceChildren(node('span', `共 ${total} 条 · 第 ${page} / ${max} 页`, 'tg-muted'), previous, next);
    }
    function filterParams(kind) {
        const params = new URLSearchParams(appliedFilters[kind]);
        const value = params.toString(); return value ? `&${value}` : '';
    }
    function filterFields(kind) {
        return { Search: 'search', Family: 'product_family', From: 'from', To: 'to',
            ...(kind === 'Batch' ? { Status: 'status' } : { Username: 'username' }),
            ...(kind === 'Purchase' ? { PaymentFilter: 'payment_status', FulfillmentFilter: 'fulfillment_status', Channel: 'payment_channel' } : {}),
            ...(kind === 'Order' ? { Source: 'order_source' } : {}) };
    }
    const centerSections = { Purchase: 'Purchases', Order: 'Orders', Batch: 'Codes' };
    const centerPages = { Purchase: 'purchasePage', Order: 'orderPage', Batch: 'batchPage' };
    const centerLoaders = { Purchase: loadPurchases, Order: loadOrders, Batch: loadBatches };
    const networkLabels = { usdtbsc: 'BEP20', usdtton: 'TON', usdtmatic: 'Polygon', usdttrc20: 'TRC20', unknown: '协议未确认' };
    function syncCenterFields(kind) {
        const filters = appliedFilters[kind];
        for (const [suffix, key] of Object.entries(filterFields(kind))) {
            let value = filters[key] || '';
            if (value && ['from', 'to'].includes(key)) value = new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 19);
            $('tg' + kind + suffix).value = value;
        }
        if (kind === 'Order') $('tgOrderFilter').value = filters.status || '';
        for (const suffix of ['From', 'To']) {
            const label = $('tg' + kind + suffix + 'Label');
            if (label) label.textContent = (filters.date_field === 'paid_at' ? '付款确认时间' : filters.date_field === 'completed_at' ? '交付完成时间' : '创建时间') + (suffix === 'From' ? '起' : '止（不含）') + (filters.data_center ? ' · 北京时间' : '');
        }
        const heading = $('tg' + kind + 'TimeHeading');
        if (heading) heading.textContent = filters.date_field === 'paid_at' ? '付款确认时间' : filters.date_field === 'completed_at' ? '交付完成时间' : kind === 'Order' ? '更新时间' : '创建时间';
        globalScope.TgAdminSelects?.sync();
    }
    function clearDataCenterContexts() {
        for (const kind of Object.keys(centerSections)) {
            appliedFilters[kind] = {};
            syncCenterFields(kind);
            const root = $('tg' + kind + 'DataCenterContext');
            if (root) { root.replaceChildren(); root.hidden = true; }
        }
    }
    function renderCenterContext(kind) {
        const filters = appliedFilters[kind], root = $('tg' + kind + 'DataCenterContext');
        if (!root) return;
        root.hidden = filters.data_center !== '1'; root.replaceChildren();
        if (root.hidden) return;
        root.append(button('← 返回数据中心', () => selectAdminSection('Dashboard'), 'tg-dc-inline-link'));
        const groups = [];
        if (filters.from || filters.to) groups.push({ keys: ['from', 'to', 'date_field'], label: (filters.date_field === 'paid_at' ? '付款确认' : filters.date_field === 'completed_at' ? '交付完成' : '创建时间') + '：' + (filters.from ? date(filters.from) : '不限') + ' — ' + (filters.to ? date(filters.to) + '（不含）' : '不限') });
        const names = {
            receipt: { confirmed: '已核验付款', review: '已收款待核对', amount_unknown: '付款凭据 / 金额待核验' },
            currency: { CNY: '收款 CNY', USDT: '收款 USDT' },
            pay_currency: networkLabels,
            product_family: { telegram_premium: 'Premium', telegram_stars: 'Stars' },
            term_months: { 3: '3 个月', 6: '6 个月', 12: '12 个月' },
            attention: { all: '全部需关注', payment_review: '收款人工核对', fulfillment_review: '发货人工复核', failed: '发货失败', overdue: '处理超过 30 分钟' },
            inventory: { all: '全部兑换码', available: '当前可兑换', in_flight: '预留 / 履约中', expiring: '7 天内到期', used: '已成功兑换' },
            order_source: { all: '全部来源', purchase: '即时购买', redemption: '兑换码' },
            status: labels, payment_status: paymentLabels, fulfillment_status: fulfillmentLabels, payment_channel: channelLabels
        };
        for (const [key, values] of Object.entries(names)) if (filters[key]) groups.push({ keys: [key], label: values[filters[key]] || filters[key] });
        for (const group of groups) {
            const chip = node('span', undefined, 'tg-dc-context-chip');
            const remove = button('×', async () => {
                for (const key of group.keys) delete appliedFilters[kind][key];
                state[centerPages[kind]] = 1; syncCenterFields(kind); renderCenterContext(kind); await centerLoaders[kind]();
            }, 'tg-dc-chip-remove');
            remove.setAttribute('aria-label', '移除筛选：' + group.label);
            chip.append(node('span', group.label), remove); root.append(chip);
        }
        root.append(button('清除条件', async () => {
            appliedFilters[kind] = {}; state[centerPages[kind]] = 1;
            syncCenterFields(kind); renderCenterContext(kind); await centerLoaders[kind]();
        }, 'tg-dc-inline-link'));
        if (filters.as_of) root.append(node('span', '统计截至 ' + date(filters.as_of) + '；订单状态会随处理更新。', 'tg-dc-context-hint'));
    }
    async function navigateDataCenter(kind, filters = {}) {
        if (!state.authenticated) return;
        if (kind === 'Provider') { selectAdminSection('Provider'); return; }
        if (!Object.hasOwn(centerSections, kind)) return;
        appliedFilters[kind] = { ...filters }; state[centerPages[kind]] = 1;
        syncCenterFields(kind); renderCenterContext(kind); selectAdminSection(centerSections[kind]);
        try { await centerLoaders[kind](); } catch (error) { showError(error); }
    }
    function bindFilters(kind, pageKey, loader) {
        const fields = filterFields(kind);
        $('tg' + kind + 'Filters').addEventListener('submit', async (event) => {
            event.preventDefault(); const values = { ...appliedFilters[kind] };
            try {
                for (const [suffix, key] of Object.entries(fields)) {
                    delete values[key];
                    const value = text($('tg' + kind + suffix).value); if (!value) continue;
                    values[key] = ['from', 'to'].includes(key) ? new Date(values.data_center ? value + '+08:00' : value).toISOString() : value;
                }
                appliedFilters[kind] = values; state[pageKey] = 1; renderCenterContext(kind); await loader();
            } catch (error) { showError(error); }
        });
        $('tg' + kind + 'Reset').addEventListener('click', async () => {
            appliedFilters[kind] = {}; state[pageKey] = 1; syncCenterFields(kind); renderCenterContext(kind);
            try { await loader(); } catch (error) { showError(error); }
        });
    }
    function batchUsage(batch) {
        const usage = node('div', undefined, 'tg-batch-usage');
        const generated = Number(batch.generated_count); const redeemed = Number(batch.redeemed_count);
        const valid = [batch.generated_count, batch.redeemed_count].every(value => /^\d+$/.test(String(value)))
            && Number.isSafeInteger(generated) && Number.isSafeInteger(redeemed) && redeemed <= generated;
        if (!valid) {
            usage.append(node('span', '—')); usage.title = '兑换统计暂不可用';
            return usage;
        }
        const percentage = generated ? Number((redeemed / generated * 100).toFixed(1)) : 0;
        const summary = node('div', undefined, 'tg-batch-usage-summary');
        summary.append(node('span', `${percentage}%`), node('small', `${redeemed} / ${generated}`));
        const meter = node('progress'); meter.max = Math.max(generated, 1); meter.value = redeemed;
        meter.setAttribute('aria-label', `使用率 ${percentage}%，已成功兑换 ${redeemed} 张，共生成 ${generated} 张`);
        usage.title = '已成功兑换张数 / 实际生成张数'; usage.append(summary, meter);
        return usage;
    }
    async function loadBatches() {
        const version = ++state.batchVersion;
        renderCenterContext('Batch');
        const data = await request(`/api/admin/tg/codes?page=${state.batchPage}&pageSize=${PAGE_SIZE}${filterParams('Batch')}`);
        if (version !== state.batchVersion || !state.authenticated) return;
        $('tgBatchCount').textContent = data.total ?? 0;
        const body = $('tgBatchesBody'); const rows = [];
        for (const batch of data.batches || []) {
            const row = node('tr'); const identity = node('div', batch.batch_no, 'tg-row-identity');
            if (batch.metadata?.name) identity.append(node('small', batch.metadata.name));
            if (appliedFilters.Batch.inventory && Number.isSafeInteger(batch.matching_code_count)) identity.append(node('small', `符合当前条件 ${batch.matching_code_count} 张`));
            cell(row, identity); cell(row, productLabel(batch)); cell(row, `${batch.generated_count ?? 0} / ${batch.quantity ?? 0}`); cell(row, batchUsage(batch)); cell(row, status(batch.status)); cell(row, date(batch.created_at));
            const actions = node('div', undefined, 'tg-row-actions'); actions.append(button('详情', () => inspectBatch(batch.id)));
            if (batch.status === 'active') actions.append(button('撤销批次', () => revoke({ batch_id: batch.id }, `批次 ${batch.batch_no}`), 'tg-link-button tg-danger-link'));
            cell(row, actions); rows.push(row);
        }
        if (rows.length) body.replaceChildren(...rows); else empty(body, 7, '暂无符合条件的兑换码批次');
        if (appliedFilters.Batch.data_center && Number.isSafeInteger(data.matching_codes)) $('tgBatchDataCenterContext').append(node('span', `符合条件 ${data.matching_codes} 张兑换码，分布于 ${data.total} 个批次`, 'tg-dc-context-hint'));
        pager('tgBatchesPager', state.batchPage, data.total || 0, async (page) => { state.batchPage = page; await loadBatches(); });
    }
    async function loadOrders() {
        const version = ++state.orderVersion;
        const params = new URLSearchParams({ ...appliedFilters.Order, page: String(state.orderPage), pageSize: String(PAGE_SIZE) });
        if ($('tgOrderFilter').value) params.set('status', $('tgOrderFilter').value); else params.delete('status');
        const data = await request(`/api/admin/tg/orders?${params}`);
        if (version !== state.orderVersion || !state.authenticated) return;
        $('tgOrderCount').textContent = data.total ?? 0;
        const body = $('tgOrdersBody'); const rows = [];
        for (const order of data.orders || []) {
            const row = node('tr'); cell(row, order.order_no); cell(row, `@${order.telegram_username}`); cell(row, productLabel(order)); cell(row, status(order.status)); cell(row, date(appliedFilters.Order.date_field === 'completed_at' ? order.completed_at : order.updated_at || order.created_at));
            cell(row, button('详情 / 对账', () => inspectOrder(order.id))); rows.push(row);
        }
        if (rows.length) body.replaceChildren(...rows); else empty(body, 6, '暂无符合条件的兑换订单');
        pager('tgOrdersPager', state.orderPage, data.total || 0, async (page) => { state.orderPage = page; await loadOrders(); });
    }
    async function loadProvider() {
        const version = ++providerVersion;
        try {
            const data = await request('/api/admin/tg/provider');
            if (version !== providerVersion || !state.authenticated) return;
            dataCenter?.setProvider(data);
            $('tgProviderStatus').textContent = data.healthy ? '服务连接正常' : data.configured ? '服务暂不可用' : '尚未配置上游';
            $('tgGramBalance').textContent = data.healthy ? data.balances?.gram ?? '—' : '—'; $('tgUsdtBalance').textContent = data.healthy ? data.balances?.usdt ?? '—' : '—';
            $('tgProviderCurrency').textContent = `当前扣款：${data.payment_currency === 'usdt' ? 'USDT' : data.payment_currency === 'gram' ? 'GRAM' : '未确认'}`;
            $('tgProviderSwitches').textContent = `兑换${data.redemption_enabled ? '已开放' : '未开放'} · 当前 API 履约开关${data.fulfillment_enabled ? '已开启' : '已关闭'} · 独立 worker 状态尚未核验`;
            $('tgProviderChecked').textContent = `最近检查：${date(data.checked_at)}`;
        } catch (error) {
            if (version !== providerVersion || !state.authenticated) return;
            dataCenter?.setProvider(null, error);
            $('tgProviderStatus').textContent = '服务状态未确认'; $('tgGramBalance').textContent = '—'; $('tgUsdtBalance').textContent = '—';
            throw error;
        }
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
        const data = await request(`/api/admin/tg/purchases?page=${state.purchasePage}&pageSize=${PAGE_SIZE}${filterParams('Purchase')}`);
        if (version !== state.purchaseVersion || !state.authenticated) return;
        const body = $('tgPurchasesBody'); const rows = [];
        for (const order of data.purchases || []) {
            const row = node('tr'); cell(row, order.order_no); cell(row, `@${order.telegram_username || order.username || '—'}`); cell(row, productLabel(order));
            const reporting = appliedFilters.Purchase.data_center === '1';
            cell(row, reporting ? order.receipt_confirmed ? globalScope.TgAdminDataCenter.money(order.receipt_amount, order.receipt_currency) : '金额待核验' : order.currency === 'CNY' && Number.isSafeInteger(order.total_minor) && order.total_minor > 0 ? `¥${(order.total_minor / 100).toFixed(2)}` : '金额未确认');
            cell(row, order.payment_channel === 'alipay' || order.channel === 'alipay' ? '支付宝' : order.payment_channel === 'wxpay' || order.channel === 'wxpay' ? '微信支付' : order.payment_channel === 'usdt_bep20' ? 'USDT' : '—');
            if (reporting && order.pay_currency) row.children[4].append(node('small', networkLabels[order.pay_currency] || '协议未确认', 'tg-dc-product-unit'));
            cell(row, status(order.payment_status, paymentLabels)); cell(row, status(order.fulfillment_status, fulfillmentLabels)); cell(row, date(appliedFilters.Purchase.date_field === 'paid_at' ? order.paid_at : order.created_at));
            cell(row, button('详情 / 处理', () => inspectPurchaseOperations(order.order_no))); rows.push(row);
        }
        if (rows.length) body.replaceChildren(...rows); else empty(body, 9, '暂无符合条件的购买订单');
        pager('tgPurchasesPager', state.purchasePage, data.total || 0, async (page) => { state.purchasePage = page; await loadPurchases(); });
    }
    function canRequestPurchaseClose(order) {
        return !!order && !!order.paid_at && !order.closed_at && !['closed', 'cancelled', 'succeeded'].includes(order.fulfillment_status)
            && (['paid', 'manual_review'].includes(order.payment_status) || ['manual_review', 'failed'].includes(order.fulfillment_status));
    }
    function resetPurchaseReview() {
        state.reviewVersion++; state.reviewOrderNo = null; state.reviewSnapshot = null; state.reviewSubmitting = false; state.reviewLoading = false;
        $('tgPurchaseReviewContent').replaceChildren(); $('tgPurchaseReviewForm').hidden = true;
        $('tgPurchaseReviewNote').value = ''; $('tgPurchaseReviewNoRefund').checked = false; $('tgPurchaseReviewNoDelivery').checked = false; $('tgPurchasePaymentHandled').checked = false;
        notice('tgPurchaseReviewMessage', ''); syncPurchaseReviewControls();
    }
    function closePurchaseReview() {
        resetPurchaseReview();
        if ($('tgPurchaseReviewModal').open) $('tgPurchaseReviewModal').close();
    }
    function syncPurchaseReviewControls() {
        const busy = state.reviewSubmitting || state.reviewLoading;
        const snapshot = state.reviewSnapshot;
        const available = state.authenticated && !busy;
        const noteValid = text($('tgPurchaseReviewNote').value).length >= 6 && text($('tgPurchaseReviewNote').value).length <= 500;
        const confirmed = noteValid && $('tgPurchaseReviewNoDelivery').checked;
        const actions = {
            tgPurchaseReviewApprove: snapshot?.review?.can_approve === true,
            tgPurchaseResume: snapshot?.resolution?.can_resume === true,
            tgPurchaseCloseOrder: snapshot?.resolution?.can_close === true
        };
        const closeVisible = actions.tgPurchaseCloseOrder || !!snapshot?.resolution && canRequestPurchaseClose(snapshot.order);
        $('tgPurchaseCloseActions').hidden = !closeVisible;
        $('tgPurchaseCloseBlocked').hidden = !closeVisible || actions.tgPurchaseCloseOrder;
        $('tgPurchaseCloseBlocked').textContent = closeVisible && !actions.tgPurchaseCloseOrder
            ? `当前不能关闭：${snapshot?.resolution?.message || '请重新核对原订单及上游状态，确认未发货后再处理。'}` : '';
        for (const [id, allowed] of Object.entries(actions)) {
            $(id).hidden = id === 'tgPurchaseCloseOrder' ? !closeVisible : !allowed;
            $(id).disabled = !available || !allowed || !confirmed || (id === 'tgPurchaseCloseOrder' ? !$('tgPurchasePaymentHandled').checked : !$('tgPurchaseReviewNoRefund').checked);
            $(id).setAttribute('aria-busy', String(state.reviewSubmitting));
        }
        for (const id of ['tgPurchaseReviewNote', 'tgPurchaseReviewNoRefund', 'tgPurchaseReviewNoDelivery', 'tgPurchasePaymentHandled']) $(id).disabled = !available || !Object.values(actions).some(Boolean);
        $('tgPurchaseReviewRecheck').disabled = !state.authenticated || busy || !state.reviewOrderNo;
        $('tgPurchaseReviewClose').disabled = false;
        $('tgPurchaseReviewContent').setAttribute('aria-busy', String(state.reviewLoading));
    }
    function purchaseReviewSkeleton(orderNo) {
        const content = node('div', undefined, 'tg-purchase-review-loading');
        content.setAttribute('role', 'status'); content.setAttribute('aria-label', '正在核对收款与原发货记录');
        const list = node('dl', undefined, 'tg-order-details');
        for (const label of ['购买订单', '接收账号', '商品 / 数量', '订单金额（含手续费）', '支付方式', '本地收款状态', '渠道实时查单', '本次查单时间', '到账记录时间', '发货状态', '原发货单', '上游提交记录']) {
            const value = label === '购买订单' ? node('span', orderNo) : node('span', undefined, 'tg-skeleton');
            if (label !== '购买订单') value.setAttribute('aria-hidden', 'true');
            detailItem(list, label, value);
        }
        const hints = node('div', undefined, 'tg-review-loading-hints'); hints.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 2; i++) hints.append(node('span', undefined, 'tg-skeleton tg-skeleton-hint'));
        const actions = node('div', undefined, 'tg-review-footer'); actions.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 2; i++) actions.append(node('span', undefined, 'tg-skeleton tg-skeleton-button'));
        content.append(list, hints, actions);
        return content;
    }
    function renderPurchaseReview(data) {
        const order = data.order; const review = data.review; const payment = data.payment_check;
        const list = node('dl', undefined, 'tg-order-details');
        detailItem(list, '购买订单', order.order_no); detailItem(list, '接收账号', `@${order.username}`);
        detailItem(list, '商品 / 数量', productLabel(order)); detailItem(list, '订单金额（含手续费）', `¥${(order.total_minor / 100).toFixed(2)}`);
        detailItem(list, '支付方式', order.payment_channel === 'alipay' ? '支付宝' : order.payment_channel === 'wxpay' ? '微信支付' : 'USDT');
        detailItem(list, '本地收款状态', paymentLabels[order.payment_status] || '状态未确认');
        detailItem(list, '渠道实时查单', { confirmed: '已确认足额收款，与原订单一致', unpaid: '渠道未确认付款', mismatch: '收款凭据与原订单不一致', unconfirmed: '暂时无法确认，请重新核对', unsupported: '此渠道暂不支持审核补发' }[payment.status] || '暂时无法确认');
        detailItem(list, '本次查单时间', date(payment.checked_at));
        detailItem(list, '到账记录时间', date(review.receipt_recorded_at));
        detailItem(list, '发货状态', status(order.fulfillment_status, fulfillmentLabels));
        if (order.closed_at) { detailItem(list, '完结时间', date(order.closed_at)); if (order.completion_note) detailItem(list, '用户可见的完结说明', order.completion_note); }
        detailItem(list, '原发货单', data.fulfillment?.order_no || '尚无关联发货任务');
        detailItem(list, '上游提交记录', data.fulfillment?.has_provider_order ? '已有上游订单，继续核对原任务' : '暂未记录上游订单号');
        const content = $('tgPurchaseReviewContent'); content.replaceChildren(list);
        if (review.reason === 'payment_received_after_expiry') content.append(node('p', '系统核对到账时付款窗口已过期，因此转为人工审核。到账记录时间不代表实际付款时间。', 'tg-muted'));
        content.append(node('p', review.message, review.can_approve ? 'tg-success-text' : 'tg-warning'));
        if (data.resolution?.message) content.append(node('p', data.resolution.message, 'tg-muted'));
        if (!review.worker_enabled && order.fulfillment_status !== 'closed') content.append(node('p', '当前 API 的自动履约开关未开启。此值只代表当前 API 的配置，不能据此判断独立 worker 是否运行；本地预览与线上 worker 的配置可不同。', 'tg-muted'));
        if (data.fulfillment?.id) {
            const taskId = data.fulfillment.id; const orderNo = order.order_no; const version = state.reviewVersion;
            const actions = node('div', undefined, 'tg-review-footer');
            const panel = node('section', undefined, 'tg-review-history'); panel.hidden = true; panel.setAttribute('aria-live', 'polite');
            const queryButton = button('查询上游状态', async () => {
                panel.hidden = false; panel.replaceChildren(node('p', '正在查询原发货任务及上游状态…', 'tg-muted')); panel.setAttribute('aria-busy', 'true');
                queryButton.textContent = '查询中…';
                try {
                    const result = await request(`/api/admin/tg/orders?orderId=${encodeURIComponent(taskId)}&reconcile=1`);
                    if (version !== state.reviewVersion || state.reviewOrderNo !== orderNo || !state.authenticated) return;
                    if (result.success !== true || result.order?.id !== taskId || !result.reconciliation) throw new Error('上游查单结果未确认，请重新查询');
                    renderUpstreamStatus(panel, result);
                } catch (error) {
                    if (version === state.reviewVersion && state.authenticated) panel.replaceChildren(node('p', error.message || '上游查询暂不可用，请稍后重试', 'tg-warning'));
                } finally { panel.setAttribute('aria-busy', 'false'); queryButton.textContent = '查询上游状态'; }
            }, 'tg-button tg-button-secondary');
            actions.append(queryButton, button('查看原发货任务', () => inspectOrder(taskId), 'tg-button tg-button-secondary'));
            content.append(actions, panel);
        }
        if (!order.closed_at && !order.paid_at && order.payment_status === 'manual_review' && !data.fulfillment) {
            content.append(orderActions(button('处理购买订单 / 人工完结', () => inspectPurchaseOperations(order.order_no), 'tg-button tg-button-secondary')));
        }
        if (data.reviews?.length) {
            const history = node('div', undefined, 'tg-review-history'); history.append(node('h3', '审核记录'));
            for (const entry of data.reviews) history.append(node('p', `${date(entry.created_at)} · ${entry.note}`, 'tg-muted'));
            content.append(history);
        }
        const resolution = data.resolution || {};
        $('tgPurchaseReviewForm').hidden = !(review.can_approve || resolution.can_close || resolution.can_resume);
        $('tgPurchaseCloseConfirm').hidden = !resolution.can_close;
        $('tgPurchaseCloseHint').hidden = !resolution.can_close;
        $('tgPurchaseReviewWarning').textContent = review.can_approve || resolution.can_resume
            ? '补发或恢复任务后，worker 可能使用上游余额。请核对收款、退款和原发货记录，系统会保留原任务与上游订单记录。'
            : '关闭订单将停止发货，用户端会显示“已完结”。请记录处理依据，并核对是否需要在支付后台退款。';
        $('tgPurchaseReviewApprove').textContent = order.product_family === 'telegram_stars' ? `确认审核并补发 ${order.stars_quantity} Stars` : `确认审核并补发 ${order.term_months} 个月 Premium`;
    }
    function validPurchaseReview(data, orderNo) {
        return data.success === true && data.order?.order_no === orderNo && typeof data.order.updated_at === 'string'
            && typeof data.review?.can_approve === 'boolean' && typeof data.payment_check?.status === 'string';
    }
    async function inspectPurchase(orderNo) {
        if (!state.authenticated || state.reviewSubmitting || state.purchaseClosing) return;
        if ($('tgDetailModal').open) closeDetail();
        const note = state.reviewOrderNo === orderNo ? $('tgPurchaseReviewNote').value : '';
        resetPurchaseReview(); const version = state.reviewVersion; state.reviewOrderNo = orderNo; state.reviewLoading = true;
        $('tgPurchaseReviewNote').value = note;
        $('tgPurchaseReviewContent').replaceChildren(purchaseReviewSkeleton(orderNo));
        $('tgPurchaseReviewBody').scrollTop = 0; syncPurchaseReviewControls();
        if (!$('tgPurchaseReviewModal').open) $('tgPurchaseReviewModal').showModal();
        try {
            const data = await request(`/api/admin/tg/purchases?orderNo=${encodeURIComponent(orderNo)}`);
            if (version !== state.reviewVersion || !state.authenticated) return;
            if (!validPurchaseReview(data, orderNo)) throw new Error('审核信息未确认，请重新核对原订单');
            state.reviewSnapshot = data; renderPurchaseReview(data); notice('tgPurchaseReviewMessage', '');
        } catch (error) {
            if (version !== state.reviewVersion || !state.authenticated) return;
            const list = node('dl', undefined, 'tg-order-details'); detailItem(list, '购买订单', orderNo);
            $('tgPurchaseReviewContent').replaceChildren(list);
            notice('tgPurchaseReviewMessage', error.message || '暂时无法核对，请稍后重试', 'error');
        } finally { if (version === state.reviewVersion) { state.reviewLoading = false; syncPurchaseReviewControls(); } }
    }
    async function approvePurchase(event) {
        event.preventDefault(); syncPurchaseReviewControls();
        if ($('tgPurchaseReviewApprove').disabled) return;
        const version = state.reviewVersion; const snapshot = state.reviewSnapshot; const orderNo = state.reviewOrderNo;
        state.reviewSubmitting = true; syncPurchaseReviewControls(); notice('tgPurchaseReviewMessage', '正在复核收款并提交审核，请稍候…');
        try {
            const result = await post('/api/admin/tg/purchases', { action: 'approve_fulfillment', order_no: orderNo, expected_updated_at: snapshot.order.updated_at,
                note: text($('tgPurchaseReviewNote').value), confirm_no_refund: true, confirm_no_delivery: true });
            if (version !== state.reviewVersion || !state.authenticated) return;
            if (result.success !== true || result.order?.order_no !== orderNo || result.order.payment_status !== 'paid' || !Object.hasOwn(fulfillmentLabels, result.order.fulfillment_status) || result.order.fulfillment_status === 'not_started' || typeof result.existing !== 'boolean') throw new Error('审核结果尚未确认');
            state.reviewSnapshot = { ...snapshot, order: result.order, review: { ...snapshot.review, can_approve: false, message: '已有发货任务；后续请核对原任务的处理结果。' } };
            renderPurchaseReview(state.reviewSnapshot);
            const approved = result.order.fulfillment_status === 'succeeded' ? '原发货任务已完成，本次没有重复补发。'
                : result.existing ? '此订单已有审核通过的发货任务，本次没有重复创建。' : '审核通过，已进入发货队列。实际发货结果请查看原任务。';
            notice('tgPurchaseReviewMessage', approved, 'success');
            try {
                const data = await request(`/api/admin/tg/purchases?orderNo=${encodeURIComponent(orderNo)}`);
                if (version === state.reviewVersion && state.authenticated && validPurchaseReview(data, orderNo)
                    && data.order.payment_status === 'paid' && Object.hasOwn(fulfillmentLabels, data.order.fulfillment_status) && data.order.fulfillment_status !== 'not_started') {
                    data.review.can_approve = false; state.reviewSnapshot = data; renderPurchaseReview(data);
                }
            } catch (_) { /* Approval is confirmed. Leave it visible and allow a read-only recheck. */ }
            if (state.authenticated) {
                const results = await Promise.allSettled([loadPurchases(), loadOrders()]);
                if (results.some((item) => item.status === 'rejected') && state.authenticated) notice('tgAdminAlert', '审核已完成，列表暂未刷新，请稍后刷新数据。', 'error');
            }
        } catch (error) {
            if (version !== state.reviewVersion || !state.authenticated) return;
            if (state.reviewSnapshot) { state.reviewSnapshot.review.can_approve = false; state.reviewSnapshot.resolution = { can_close: false, can_resume: false }; }
            const message = !error.status || error.status >= 500 ? '提交结果尚未确认，请重新核对原订单；不要另建订单或重复补发。' : `${error.message} 请重新核对原订单。`;
            notice('tgPurchaseReviewMessage', message, 'error');
        } finally { if (version === state.reviewVersion) { state.reviewSubmitting = false; syncPurchaseReviewControls(); } }
    }
    async function resolvePurchase(action) {
        syncPurchaseReviewControls();
        const control = $(action === 'close_order' ? 'tgPurchaseCloseOrder' : 'tgPurchaseResume');
        if (control.disabled) return;
        const snapshot = state.reviewSnapshot; const version = state.reviewVersion; const orderNo = state.reviewOrderNo;
        state.reviewSubmitting = true; syncPurchaseReviewControls();
        notice('tgPurchaseReviewMessage', action === 'close_order' ? '正在关闭订单…' : '正在恢复原发货任务…');
        try {
            const data = await post('/api/admin/tg/purchases', { action, order_no: orderNo, expected_updated_at: snapshot.order.updated_at,
                note: text($('tgPurchaseReviewNote').value), confirm_no_delivery: true, confirm_payment_handled: true });
            if (version !== state.reviewVersion || !state.authenticated) return;
            if (data.success !== true || data.order?.order_no !== orderNo || typeof data.existing !== 'boolean'
                || (action === 'close_order' ? data.order.fulfillment_status !== 'closed' : !['pending', 'retry_waiting'].includes(data.order.fulfillment_status))) throw new Error('处理结果尚未确认');
            state.reviewSnapshot = { ...snapshot, order: data.order, review: { ...snapshot.review, can_approve: false,
                message: action === 'close_order' ? '订单已关闭，停止发货。收款记录已保留，请按核对结果处理退款。' : '原发货任务已恢复，请核对后续处理结果。' },
                resolution: { can_close: false, can_resume: false } };
            renderPurchaseReview(state.reviewSnapshot);
            notice('tgPurchaseReviewMessage', state.reviewSnapshot.review.message, 'success');
            const results = await Promise.allSettled([loadPurchases(), loadOrders()]);
            if (version === state.reviewVersion && results.some(result => result.status === 'rejected')) notice('tgAdminAlert', '订单处理已完成，列表暂未刷新，请稍后刷新数据。', 'error');
        } catch (error) {
            if (version !== state.reviewVersion || !state.authenticated) return;
            state.reviewSnapshot = { ...snapshot, review: { ...snapshot.review, can_approve: false }, resolution: { can_close: false, can_resume: false } };
            renderPurchaseReview(state.reviewSnapshot);
            notice('tgPurchaseReviewMessage', `${error.status && error.status < 500 ? error.message : '处理结果尚未确认。'} 请重新核对原订单，不要重复补发。`, 'error');
        } finally { if (version === state.reviewVersion) { state.reviewSubmitting = false; syncPurchaseReviewControls(); } }
    }
    async function refresh() {
        const control = $('tgAdminRefresh');
        if (!state.authenticated || control.disabled) return;
        control.disabled = true;
        control.setAttribute('aria-busy', 'true');
        control.setAttribute('aria-label', '正在刷新数据');
        control.setAttribute('title', '正在刷新数据');
        try {
            // Keep the initial skeleton until every request settles, including
            // partial failures. An ordinary refresh leaves operation feedback intact.
            const results = await Promise.allSettled([loadBatches(), loadOrders(), loadProvider(), loadProducts(), loadPurchases(), ...(dataCenter ? [dataCenter.refresh()] : []), ...(searchState.submitted ? [queryAdminOrders(searchState.page)] : [])]);
            const failure = results.find(result => result.status === 'rejected');
            if (failure && state.authenticated) showError(failure.reason);
        } catch (error) { showError(error); }
        finally {
            control.disabled = false;
            control.setAttribute('aria-busy', 'false');
            control.setAttribute('aria-label', '刷新数据');
            control.setAttribute('title', '刷新数据');
        }
    }
    function openDetail(title, content, layout = '') {
        hideCopyToast(); globalScope.TgAdminSelects?.close();
        state.detailVersion++; $('tgDetailTitle').textContent = title;
        $('tgDetailModal').classList.toggle('tg-order-dialog', layout === 'order');
        $('tgDetailContent').setAttribute('aria-busy', 'false'); $('tgDetailContent').replaceChildren(content);
        $('tgDetailContent').scrollTop = 0; globalScope.TgAdminSelects?.sync();
        if (!$('tgDetailModal').open) $('tgDetailModal').showModal();
    }
    let copyToastTimer;
    function hideCopyToast() {
        globalScope.clearTimeout(copyToastTimer); copyToastTimer = undefined;
        const toast = $('tgCopyToast');
        if (typeof toast.hidePopover === 'function') toast.hidePopover();
        toast.hidden = true;
    }
    function showCopyToast() {
        hideCopyToast();
        const toast = $('tgCopyToast'); toast.hidden = false;
        if (typeof toast.showPopover === 'function') toast.showPopover();
        copyToastTimer = globalScope.setTimeout(hideCopyToast, 2400);
    }
    function batchCodeControl(code, isCurrent, feedback) {
        const group = node('div', undefined, 'tg-code-copy-cell');
        const value = node('span', `…${text(code.code_last4)}`, 'tg-code-copy-value');
        let plaintext = '';
        const control = button('', async () => {
            if (!isCurrent()) return;
            control.setAttribute('aria-busy', 'true'); hideCopyToast();
            feedback.textContent = ''; feedback.classList.toggle('error', false);
            try {
                if (!plaintext) {
                    const data = await post('/api/admin/tg/codes', { action: 'reveal', code_id: code.id });
                    const candidate = data.code; data.code = '';
                    if (!isCurrent()) return;
                    if (data.code_id !== code.id || typeof candidate !== 'string'
                        || !/^TG-(?:PREM|STAR)-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/.test(candidate)
                        || candidate.slice(-4) !== code.code_last4) throw new Error('完整兑换码读取结果异常，请重试');
                    plaintext = candidate;
                }
                try {
                    if (!globalScope.navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
                    await globalScope.navigator.clipboard.writeText(plaintext);
                    if (!isCurrent()) return;
                    showCopyToast();
                } catch (_) {
                    if (!isCurrent()) return;
                    feedback.textContent = '复制失败，请允许浏览器访问剪贴板后点击兑换码重试'; feedback.classList.toggle('error', true);
                }
            } catch (error) {
                if (!isCurrent()) return;
                feedback.textContent = error.message || '兑换码读取失败，请重试'; feedback.classList.toggle('error', true);
            } finally { control.setAttribute('aria-busy', 'false'); }
        }, 'tg-code-copy');
        control.setAttribute('aria-label', `复制完整兑换码，尾号 ${text(code.code_last4)}`);
        control.append(value); group.append(control); return group;
    }
    async function inspectBatch(id) {
        let version = ++state.detailVersion;
        const filters = appliedFilters.Batch;
        const inventory = filters.data_center && filters.inventory ? '&' + new URLSearchParams({ data_center: '1', inventory: filters.inventory, as_of: filters.as_of }) : '';
        const data = await request(`/api/admin/tg/codes?batchId=${encodeURIComponent(id)}${inventory}`);
        if (version !== state.detailVersion || !state.authenticated) return;
        const content = node('div'); const batch = data.batch || {};
        content.append(node('p', `${productLabel(batch)} · ${labels[batch.status] || '未知状态'} · 有效期：${date(batch.valid_until)}`, 'tg-muted'));
        if (data.filtered) content.append(node('p', `仅显示符合当前库存条件的兑换码，共 ${data.total} 张`, 'tg-dc-note'));
        const wrap = node('div', undefined, 'tg-table-wrap'); const table = node('table'); const head = node('tr');
        for (const label of ['兑换码', '状态', '兑换账号', '更新时间 / 兑换时间', '操作']) head.append(node('th', label));
        const thead = node('thead'); thead.append(head); const body = node('tbody');
        const feedback = node('p', '', 'tg-form-message tg-code-copy-message'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
        const isCurrent = () => version === state.detailVersion && state.authenticated && $('tgDetailModal').open;
        for (const code of data.codes || []) {
            const row = node('tr'); cell(row, batchCodeControl(code, isCurrent, feedback)); cell(row, status(code.status)); cell(row, code.telegram_username ? `@${code.telegram_username}` : '—'); cell(row, date(code.fulfilled_at || code.reserved_at || code.created_at));
            cell(row, code.status === 'available' ? button('撤销', async () => { const done = await revoke({ code_id: code.id }, `兑换码 …${code.code_last4}`); if (done && version === state.detailVersion && state.authenticated) await inspectBatch(id); }, 'tg-link-button tg-danger-link') : '—'); body.append(row);
        }
        if (!data.codes?.length) empty(body, 5, '暂无兑换码');
        table.append(thead, body); wrap.append(table); content.append(node('p', '点击兑换码即可复制完整码。', 'tg-muted tg-code-copy-description'), wrap, feedback);
        if (batch.status === 'active') {
            const actions = node('div', undefined, 'tg-batch-detail-actions');
            actions.append(button('撤销此批次', async () => { const done = await revoke({ batch_id: id }, `批次 ${batch.batch_no}`); if (done && version === state.detailVersion && state.authenticated) await inspectBatch(id); }, 'tg-button tg-button-secondary tg-danger-link'));
            content.append(actions);
        }
        openDetail(`批次 ${text(batch.batch_no)}`, content); version = state.detailVersion;
    }
    async function revoke(target, label) {
        if (!globalScope.confirm(`确认撤销${label}？未兑换的码将无法继续使用；正在履约的订单仍会保留。`)) return false;
        await post('/api/admin/tg/codes', { action: 'revoke', ...target });
        notice('tgAdminAlert', ''); await loadBatches(); return true;
    }
    function detailItem(list, name, value) { const group = node('div', undefined, ['关联履约单', '上游订单号', '原履约任务', '原发货任务'].includes(name) ? 'tg-detail-identifier' : ''); const detail = node('dd'); detail.append(typeof value === 'object' && value ? value : node('span', value ?? '—')); group.append(node('dt', name), detail); list.append(group); }
    function orderSection(title, description = '', action) {
        const section = node('section', undefined, 'tg-order-section'); section.setAttribute('aria-label', title);
        const head = node('div', undefined, 'tg-order-section-head'); head.append(node('h3', title));
        if (action) head.append(action);
        section.append(head);
        if (description) section.append(node('p', description, 'tg-order-section-description tg-muted'));
        return section;
    }
    function orderActions(...actions) {
        const group = node('div', undefined, 'tg-row-actions tg-order-actions'); group.append(...actions); return group;
    }
    function orderStatus(label, status) {
        const tone = ['paid', 'succeeded'].includes(status) ? 'success' : ['manual_review', 'retry_waiting', 'failed'].includes(status) ? 'warning' : 'neutral';
        return node('span', label || '未知状态', `tg-detail-status is-${tone}`);
    }
    function dismissOnBackdrop(dialog, close) {
        let startedOutside = false;
        const isOutside = event => {
            if (event.target !== dialog) return false;
            const rect = dialog.getBoundingClientRect();
            return event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom;
        };
        dialog.addEventListener('pointerdown', event => { startedOutside = event.button === 0 && isOutside(event); });
        dialog.addEventListener('pointercancel', () => { startedOutside = false; });
        dialog.addEventListener('click', event => {
            const dismiss = startedOutside && event.button === 0 && isOutside(event); startedOutside = false;
            if (dismiss) close();
        });
    }
    function closeDetail() {
        if (state.authenticated && state.redemptionResolving) return;
        globalScope.TgAdminSelects?.close();
        state.detailVersion++;
        if ($('tgDetailModal').open) $('tgDetailModal').close();
        $('tgDetailContent').replaceChildren(); $('tgDetailContent').setAttribute('aria-busy', 'false');
        globalScope.TgAdminSelects?.sync();
    }
    function renderUpstreamStatus(target, data) {
        const check = data.reconciliation; const order = data.order;
        const list = node('dl', undefined, 'tg-order-details');
        const providerStates = { created: '已受理，等待处理', processing: '处理中', completed: '已完成', failed: '失败', canceled: '已取消' };
        detailItem(list, '原发货任务', order.order_no);
        detailItem(list, '本地任务状态', labels[order.status] || '未知状态');
        detailItem(list, '最近提交时间', date(order.submitted_at));
        detailItem(list, '最近异常代码', order.last_error_code);
        const recordedError = check.diagnostics?.recorded_error;
        if (recordedError) {
            detailItem(list, '原任务异常原因', recordedError.message);
            if (recordedError.http_status) detailItem(list, '原异常 HTTP 状态', recordedError.http_status);
            detailItem(list, '处理建议', recordedError.action);
        } else if (order.last_error_message) detailItem(list, '原任务异常原因', order.last_error_message);
        detailItem(list, '上游订单号', check.verified ? check.snapshot?.provider_order_id : order.provider_order_id);
        detailItem(list, '上游确认状态', check.verified ? providerStates[check.snapshot?.provider_status] || '未确认' : '尚未确认');
        detailItem(list, '本次查询时间', date(check.checked_at));
        if (check.http_status) detailItem(list, '上游查询 HTTP 状态', check.http_status);
        if (check.error) {
            detailItem(list, '本次查单错误', check.error.message);
            detailItem(list, '查单处理建议', check.error.action);
        }
        target.replaceChildren(node('h3', '上游查单结果'), node('p', check.message || (check.verified ? '上游订单身份与产品权益核对一致。' : '上游订单尚未通过核对，请人工处理。'), check.verified ? 'tg-success-text' : 'tg-warning'), list);
        const balance = check.diagnostics?.balance;
        if (balance) {
            const balances = node('dl', undefined, 'tg-order-details');
            if (balance.status === 'available') {
                detailItem(balances, '当前上游 USDT 余额', balance.balances?.usdt);
                detailItem(balances, '当前上游 GRAM 余额', balance.balances?.gram);
                detailItem(balances, '原任务扣款币种', balance.payment_currency?.toUpperCase() || '未确认');
            }
            detailItem(balances, '余额检查时间', date(balance.checked_at));
            if (balance.error) detailItem(balances, '余额检查错误', balance.error.message);
            target.append(node('h3', '当前上游余额'), balances, node('p', balance.message, balance.payment_balance_zero ? 'tg-warning' : 'tg-muted'));
        }
        if (check.search) target.append(node('p', `本次已查询 ${check.search.scanned} 条记录${check.search.exhausted ? '，已查完本次返回的订单列表' : '，查询范围有限'}。`, 'tg-muted'));
        target.append(node('p', '此入口为只读查询，不会重新扣款、重复发货或修改任务状态。', 'tg-muted'));
    }
    function appendHistory(content, events) {
        const section = orderSection('处理记录', '最近 50 条操作与核对记录');
        const eventLabels = {
            code_reserved: '兑换码已预留', fulfillment_claimed: '发货任务已领取', provider_submission_marked: '已记录上游提交',
            fulfillment_result: '发货结果已记录', fulfillment_manual_review: '发货转入人工复核', order_review: '订单人工复核',
            purchase_created: '购买订单已创建', purchase_payment_confirmed: '已确认付款', purchase_payment_rejected: '支付通知核验未通过',
            purchase_payment_manual_review: '付款转入人工核对', purchase_payment_trade_reconciled: '支付流水已核对',
            purchase_fulfillment_approved: '已审核允许发货', purchase_fulfillment_resumed: '原发货任务已恢复',
            purchase_manually_completed: '管理员已人工完结', purchase_upstream_linked: '原上游订单已补录', purchase_nonacceptance_closed: '已凭上游未受理证明结案',
            purchase_review: '购买订单审核', purchase_closed: '购买订单已关闭', purchase_order_closed: '购买订单已关闭',
            order_closed: '兑换订单已关闭', admin_note: '管理员核对记录'
        };
        const reasonLabels = {
            payment_binding_mismatch: '支付通知与订单信息不一致', payment_received_after_expiry: '订单过期后收到付款',
            payment_received_after_close: '订单关闭后收到付款', payment_received_requires_review: '已收到付款，需人工核对'
        };
        if (!events?.length) { section.append(node('p', '暂无处理记录', 'tg-order-empty tg-muted')); content.append(section); return; }
        const list = node('ol', undefined, 'tg-audit-history tg-order-timeline');
        for (const event of events) {
            const metadata = event.metadata || {};
            const item = node('li'); const head = node('div', undefined, 'tg-order-event-head');
            head.append(node('strong', eventLabels[event.event_type] || event.event_type || '订单记录'), node('time', date(event.created_at)));
            item.append(head, node('p', metadata.note || reasonLabels[metadata.reason] || metadata.reason || metadata.error_code || labels[metadata.result_status] || metadata.result_status || labels[metadata.status] || metadata.status || '已记录'), node('small', `处理人：${event.actor_user_id || metadata.actor || '系统'}`, 'tg-muted'));
            list.append(item);
        }
        section.append(list); content.append(section);
    }
    function appendReview(content, url, identity, updatedAt, actions, reload) {
        const group = orderSection(actions.length ? '人工处理' : '核对记录', actions.length ? '填写处理依据后，选择下方操作。' : '仅保存核对记录，不会完结订单。'); group.className = 'tg-order-section tg-review-form';
        const label = node('label', '处理原因 / 核对记录');
        const note = node('textarea'); note.maxLength = 500; note.rows = 3; note.setAttribute('aria-label', '处理原因');
        note.placeholder = '填写处理依据，请勿填写兑换码、查询凭证或密钥'; label.append(note);
        const message = node('p', '', 'tg-form-message'); message.setAttribute('role', 'status');
        const controls = orderActions(); let pending = false;
        const detailVersion = state.detailVersion;
        for (const [action, title, confirmation] of [...actions, ['note', '保存核对记录', '']]) {
            controls.append(button(title, async () => {
                if (pending || state.reviewSubmitting || state.purchaseClosing) return;
                if (!text(note.value) || note.value.length > 500) { message.textContent = '请填写 1–500 字处理原因。'; return; }
                if (confirmation && !globalScope.confirm(confirmation)) return;
                pending = true; note.disabled = true; message.textContent = '正在核对订单版本并提交…';
                try {
                    await post(url, { ...identity, action, expected_updated_at: updatedAt, note: text(note.value) });
                    if (detailVersion === state.detailVersion && state.authenticated) await reload(detailVersion);
                    notice('tgAdminAlert', action === 'note' ? '核对记录已保存，订单状态未变更' : '订单处理已保存', 'success');
                } catch (error) { message.textContent = error.message; throw error; }
                finally { pending = false; note.disabled = false; }
            }, `tg-button ${action === 'close' ? 'tg-button-danger' : action === 'note' ? 'tg-button-secondary' : 'tg-button-primary'}`));
        }
        group.append(label, controls, message); content.append(group);
    }
    function appendReconciliation(content, check) {
        if (!check) return;
        content.append(node('p', check.verified ? '上游订单身份与产品权益核对一致。' : '上游订单信息未通过核对，请人工处理。', check.verified ? 'tg-success-text' : 'tg-warning'));
        if (check.verified) content.append(node('p', `上游状态：${check.snapshot?.provider_status || '未知'} · 检查时间：${date(check.checked_at)}`, 'tg-muted'));
        content.append(node('p', '此次仅查询和核对，不会修改订单、重新扣款或重置兑换码。', 'tg-muted'));
    }
    function orderDetailSkeleton(kind, orderNo) {
        const purchase = kind === 'purchase';
        const content = node('div', undefined, 'tg-order-workspace tg-detail-loading');
        content.setAttribute('role', 'status'); content.setAttribute('aria-label', purchase ? '正在加载购买订单详情' : '正在加载兑换订单详情');
        const refresh = node('span', undefined, 'tg-skeleton tg-skeleton-button tg-skeleton-refresh'); refresh.setAttribute('aria-hidden', 'true');
        const overview = orderSection('订单概览', '', refresh);
        const labels = purchase ? ['购买订单号', '收件人', '产品 / 权益', '金额 / 渠道', '支付状态', '发货状态', '已核验到账时间', '最近异常', '关联履约单', '更新时间'] : ['订单号', '兑换账号', '产品 / 权益', '本地状态'];
        function loadingDetails(names) {
            const list = node('dl', undefined, 'tg-order-details');
            for (const label of names) {
                const known = orderNo && ['购买订单号', '订单号'].includes(label);
                const value = known ? node('span', orderNo) : node('span', undefined, 'tg-skeleton');
                if (!known) value.setAttribute('aria-hidden', 'true');
                detailItem(list, label, value);
            }
            return list;
        }
        overview.append(loadingDetails(labels));
        const upstream = orderSection(purchase ? '支付与履约' : '上游核对', purchase ? '选择需要核对的订单环节。' : '核对原发货任务与上游受理、发货情况。');
        if (!purchase) upstream.append(loadingDetails(['上游订单号', '扣款币种', '提交时间', '完成时间', '最近异常']));
        const actions = orderActions(); actions.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < (purchase ? 2 : 1); i++) actions.append(node('span', undefined, 'tg-skeleton tg-skeleton-button'));
        upstream.append(actions);
        if (!purchase) { const hint = node('span', undefined, 'tg-skeleton tg-skeleton-hint'); hint.setAttribute('aria-hidden', 'true'); upstream.append(hint); }
        const review = orderSection('核对记录', '仅保存核对记录，不会完结订单。'); review.className = 'tg-order-section tg-review-form';
        const label = node('label', '处理原因 / 核对记录'); const fields = node('span', undefined, 'tg-skeleton tg-skeleton-note'); fields.setAttribute('aria-hidden', 'true'); label.append(fields);
        const save = node('span', undefined, 'tg-skeleton tg-skeleton-button'); save.setAttribute('aria-hidden', 'true'); review.append(label, orderActions(save));
        content.append(overview, upstream);
        if (!purchase) {
            const processing = orderSection('订单处理', '核验原始请求，或登记已实际完成的处理结果。');
            const choices = orderActions(); choices.setAttribute('aria-hidden', 'true');
            for (let i = 0; i < 3; i++) choices.append(node('span', undefined, 'tg-skeleton tg-skeleton-button'));
            processing.append(choices, node('span', undefined, 'tg-skeleton tg-skeleton-hint')); content.append(processing);
        }
        content.append(review);
        return content;
    }
    function purchaseDetailSkeleton(orderNo) { return orderDetailSkeleton('purchase', orderNo); }
    function orderDetailError(error, retry) {
        const section = orderSection('详情加载未完成');
        section.append(node('p', error.message || '订单详情暂不可用，请稍后重试', 'tg-warning'), orderActions(button('重试加载', retry, 'tg-button tg-button-secondary')));
        $('tgDetailContent').replaceChildren(section);
    }
    function appendPurchaseCompletion(content, data, version) {
        const order = data.order;
        if (order.closed_at || !['paid', 'manual_review'].includes(order.payment_status)
            || !order.paid_at && (order.payment_status !== 'manual_review' || data.fulfillment)
            || !['manual_review', 'failed', 'not_started'].includes(order.fulfillment_status)) return;
        const current = () => version === state.detailVersion && state.authenticated;
        const section = orderSection('人工完结', '核实支付、交付或协商结果后，可在这里结束订单，并向用户说明结果。');
        const message = node('p', '', 'tg-form-message'); message.setAttribute('role', 'status');
        const fields = node('div', undefined, 'tg-completion-fields'); fields.hidden = true;
        const outcomeLabel = node('label', '实际处理结果');
        const outcome = node('select'); outcome.setAttribute('aria-label', '实际处理结果');
        const outcomeLabels = { no_valid_payment: '已核实无有效付款', refunded: '已另行退款', delivery_confirmed: '已核实用户收货', agreed_settlement: '已与用户协商处理' };
        let allowedOutcomes = [];
        function setCompletionMode(capability = {}) {
            const paymentUnverified = capability.payment_unverified ?? !order.paid_at;
            const possible = paymentUnverified ? ['no_valid_payment', 'refunded', 'agreed_settlement'] : ['refunded', 'delivery_confirmed', 'agreed_settlement'];
            allowedOutcomes = possible.filter(value => !Array.isArray(capability.allowed_outcomes) || capability.allowed_outcomes.includes(value));
            if (!allowedOutcomes.length) throw new Error('可登记的处理结果尚未确认，请重新核对。');
            const previous = outcome.value;
            outcome.replaceChildren(...['', ...allowedOutcomes].map(value => {
                const option = node('option', outcomeLabels[value] || '请选择处理结果'); option.value = value; return option;
            }));
            outcome.value = allowedOutcomes.includes(previous) ? previous : '';
            internal.placeholder = paymentUnverified ? '记录支付渠道或链上核验结果、退款凭据或协商依据（6–500 字，仅管理员可见）'
                : '记录退款凭据、收货核实或协商依据（6–500 字，仅管理员可见）';
            const riskLabel = paymentUnverified ? '已核对支付渠道或链上记录；理解完结后迟到付款仍需另行处理'
                : '已核对原上游请求；理解本地完结不能撤回上游，已提交的请求仍可能发货';
            confirmations[2].copy.textContent = riskLabel; confirmations[2].input.setAttribute('aria-label', riskLabel);
        }
        outcomeLabel.append(outcome);
        const internalLabel = node('label', '内部处理依据');
        const internal = node('textarea'); internal.rows = 2; internal.maxLength = 500; internal.setAttribute('aria-label', '内部处理依据');
        internal.placeholder = '记录退款凭据、收货核实或协商依据（6–500 字，仅管理员可见）'; internalLabel.append(internal);
        const publicLabel = node('label', '给用户的完结说明');
        const publicNote = node('textarea'); publicNote.rows = 3; publicNote.maxLength = 500; publicNote.setAttribute('aria-label', '给用户的完结说明');
        publicNote.placeholder = '说明处理结果及用户需要了解的信息（6–500 字，将展示在用户订单中）'; publicLabel.append(publicNote);
        const preview = node('div', undefined, 'tg-completion-preview');
        const previewText = node('p', '填写后可在这里预览用户看到的说明。');
        preview.append(node('strong', '用户订单 · 已完结'), previewText);
        const confirmations = [
            ['已完成所选处理，并核对对应的款项或交付结果', 'confirm_payment_handled'],
            ['停止此订单的自动发货，后续不再通过此订单补发', 'confirm_stop_fulfillment'],
            ['已核对原上游请求；理解本地完结不能撤回上游，已提交的请求仍可能发货', 'confirm_upstream_risk']
        ].map(([label, name]) => {
            const input = node('input'); input.type = 'checkbox'; input.setAttribute('aria-label', label); input.name = name;
            const field = node('label', undefined, 'tg-save-confirm'); const copy = node('span', label); field.append(input, copy);
            return { input, field, copy };
        });
        setCompletionMode();
        fields.append(outcomeLabel, internalLabel, publicLabel, preview, ...confirmations.map(item => item.field));
        let snapshot = null; let loading = false; let submitting = false; let retryInput = null;
        // These controls own their disabled state across eligibility checks and
        // uncertain retries; the generic button helper would re-enable them.
        function control(label, action, className) {
            const element = node('button', label, className); element.type = 'button';
            element.addEventListener('click', async () => {
                if (element.disabled) return;
                try { await action(); } catch (error) { if (current()) showError(error); }
                finally { if (current()) sync(); }
            });
            return element;
        }
        const submit = control('确认完结订单', async () => {
            sync(); if (submit.disabled) return;
            if (!retryInput) {
                if (typeof globalScope.crypto?.randomUUID !== 'function') { message.textContent = '当前浏览器无法生成操作凭证，请更新浏览器后重试。'; return; }
                retryInput = { action: 'complete_review', order_no: order.order_no,
                    expected_updated_at: snapshot.expected_updated_at, expected_task_id: snapshot.expected_task_id,
                    expected_task_updated_at: snapshot.expected_task_updated_at, operation_id: globalScope.crypto.randomUUID(),
                    outcome: outcome.value, note: text(internal.value), completion_note: text(publicNote.value),
                    confirm_payment_handled: true, confirm_stop_fulfillment: true, confirm_upstream_risk: true };
            }
            submitting = true; state.purchaseClosing = true; sync(); message.textContent = '正在保存完结结果与用户说明…';
            try {
                const result = await post('/api/admin/tg/purchases', retryInput);
                if (result.success !== true || typeof result.existing !== 'boolean' || result.order?.order_no !== order.order_no
                    || result.order.fulfillment_status !== 'closed' || !Number.isFinite(Date.parse(result.order.closed_at))
                    || result.order.completion_note !== retryInput.completion_note) throw new Error('完结结果尚未确认');
                const success = '订单已完结，用户端将显示完结说明；自动发货已停止。';
                let confirmedVersion = null;
                if (current()) {
                    confirmedVersion = ++state.detailVersion;
                    renderPurchaseOperations({ ...data, order: { ...order, ...result.order }, fulfillment: data.fulfillment ? { ...data.fulfillment, status: 'cancelled' } : null }, confirmedVersion, success);
                }
                if (state.authenticated) {
                    const results = await Promise.allSettled([loadPurchases(), loadOrders(), request(`/api/admin/tg/purchases?order_no=${encodeURIComponent(order.order_no)}`)]);
                    const fresh = results[2];
                    if (confirmedVersion === state.detailVersion && state.authenticated && fresh.status === 'fulfilled' && fresh.value.success === true
                        && fresh.value.order?.order_no === order.order_no && fresh.value.order.fulfillment_status === 'closed') renderPurchaseOperations(fresh.value, confirmedVersion, success);
                    if (results.some(item => item.status === 'rejected')) notice('tgAdminAlert', '订单已完结，部分列表暂未刷新，请稍后刷新数据。', 'error');
                }
            } catch (error) {
                if (current()) {
                    if (error.status && error.status < 500) {
                        snapshot = null; retryInput = null; message.textContent = `${error.message} 请重新核对，或刷新详情查看结果。`;
                    } else message.textContent = '尚未收到完结确认。可点击“查询并重试本次完结”，安全核对同一次操作的结果。';
                }
            } finally { submitting = false; state.purchaseClosing = false; if (current()) sync(); }
        }, 'tg-button tg-button-primary');
        const check = control('填写完结说明', async () => {
            if (!current() || loading || submitting || state.purchaseClosing || retryInput) return;
            loading = true; snapshot = null; for (const { input } of confirmations) input.checked = false; message.textContent = '正在核对支付记录和原发货任务…'; sync();
            try {
                const result = await request(`/api/admin/tg/purchases?order_no=${encodeURIComponent(order.order_no)}&completion=1`);
                if (!current()) return;
                if (result.success !== true || result.order_no !== order.order_no || typeof result.completion?.can_complete !== 'boolean') throw new Error('人工完结条件尚未确认');
                const next = result.completion;
                if (next.closed_at) { await inspectPurchaseOperations(order.order_no); return; }
                if (!next.ready || !next.can_complete) { message.textContent = next.message || '当前不能人工完结，请刷新详情后核对。'; return; }
                if (typeof next.expected_updated_at !== 'string' || !Object.hasOwn(next, 'expected_task_id') || !Object.hasOwn(next, 'expected_task_updated_at')) throw new Error('订单版本尚未确认');
                setCompletionMode(next); snapshot = next; fields.hidden = false; message.textContent = '';
            } catch (error) { if (current()) message.textContent = error.message || '人工完结条件查询失败'; }
            finally { loading = false; if (current()) sync(); }
        }, 'tg-button tg-button-secondary');
        function sync() {
            const busy = loading || submitting || state.purchaseClosing;
            const frozen = busy || !snapshot || !!retryInput || !current();
            for (const input of [outcome, internal, publicNote, ...confirmations.map(item => item.input)]) input.disabled = frozen;
            previewText.textContent = text(publicNote.value) || '填写后可在这里预览用户看到的说明。';
            submit.hidden = fields.hidden;
            submit.disabled = busy || !current() || !snapshot || !retryInput && (!allowedOutcomes.includes(outcome.value) || text(internal.value).length < 6 || text(publicNote.value).length < 6
                || text(internal.value).length > 500 || text(publicNote.value).length > 500 || confirmations.some(item => !item.input.checked));
            submit.textContent = submitting ? '正在完结…' : retryInput ? '查询并重试本次完结' : '确认完结订单';
            submit.setAttribute('aria-busy', String(submitting));
            check.disabled = busy || !!retryInput || !current(); check.textContent = loading ? '正在核对…' : fields.hidden ? '填写完结说明' : '重新核对完结条件';
            section.setAttribute('aria-busy', String(loading || submitting));
            globalScope.TgAdminSelects?.sync(section);
        }
        for (const input of [outcome, internal, publicNote]) { input.addEventListener('input', sync); input.addEventListener('change', sync); }
        for (const { input } of confirmations) input.addEventListener('change', sync);
        section.append(fields, orderActions(check, submit), message); content.append(section); sync();
    }
    function appendPurchaseClosure(content, data, version) {
        const order = data.order;
        if (!canRequestPurchaseClose(order)) return;
        const current = () => version === state.detailVersion && state.authenticated;
        const section = node('section', undefined, 'tg-order-closure'); section.setAttribute('aria-label', '关闭订单核对');
        const message = node('p', '先核对原发货任务和上游状态，符合条件后才能确认关闭。', 'tg-muted');
        message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
        const stateMessage = node('p', `当前发货状态：${fulfillmentLabels[order.fulfillment_status] || '尚未确认'}。核对条件不会改变订单状态。`, 'tg-muted');
        const fields = node('div', undefined, 'tg-close-fields'); fields.hidden = true;
        const label = node('label', '关闭原因');
        const note = node('textarea'); note.maxLength = 500; note.rows = 3; note.setAttribute('aria-label', '关闭原因');
        note.placeholder = '记录未发货依据及收款、退款处理方式（6–500 字）'; label.append(note);
        const delivery = node('input'); delivery.type = 'checkbox';
        const payment = node('input'); payment.type = 'checkbox';
        const deliveryLabel = node('label', undefined, 'tg-save-confirm'); deliveryLabel.append(delivery, node('span', '已核对接收账号和原发货记录，确认未发货'));
        const paymentLabel = node('label', undefined, 'tg-save-confirm'); paymentLabel.append(payment, node('span', '已核对收款与退款，确认后续退款处理方式'));
        fields.append(label, deliveryLabel, paymentLabel);
        const confirm = node('button', '确认关闭订单', 'tg-button tg-button-danger'); confirm.type = 'button'; confirm.hidden = true; confirm.disabled = true;
        let snapshot = null; let checking = false; let submitting = false; let checked = false;
        function sync() {
            const eligible = snapshot?.resolution?.ready === true && snapshot.resolution.can_close === true;
            const busy = checking || submitting || state.purchaseClosing;
            fields.hidden = !eligible;
            for (const input of [note, delivery, payment]) input.disabled = !current() || busy || !eligible;
            confirm.hidden = !checked;
            confirm.disabled = !current() || busy || !eligible || text(note.value).length < 6 || text(note.value).length > 500 || !delivery.checked || !payment.checked;
            confirm.textContent = submitting ? '正在关闭订单…' : '确认关闭订单';
            confirm.setAttribute('aria-busy', String(submitting));
            check.disabled = !current() || busy;
            section.setAttribute('aria-busy', String(checking || submitting));
        }
        const check = button('核对关闭条件', async () => {
            if (!current() || checking || submitting || state.purchaseClosing) return;
            checking = true; checked = false; snapshot = null; delivery.checked = false; payment.checked = false;
            message.className = 'tg-muted'; message.textContent = '正在核对原发货任务和上游状态…'; sync();
            try {
                const result = await request(`/api/admin/tg/purchases?orderNo=${encodeURIComponent(order.order_no)}`);
                if (!current()) return;
                if (!validPurchaseReview(result, order.order_no) || typeof result.resolution?.can_close !== 'boolean') throw new Error('关闭条件尚未确认，请重新核对');
                if (result.order.fulfillment_status === 'closed' && result.order.closed_at) {
                    renderPurchaseOperations({ ...data, order: { ...order, ...result.order } }, version, '订单已关闭，停止发货；收款记录已保留。'); return;
                }
                snapshot = result; checked = true;
                const eligible = result.resolution.ready === true && result.resolution.can_close === true;
                message.className = eligible ? 'tg-success-text' : 'tg-warning';
                message.textContent = eligible ? '核对通过。请填写关闭原因并完成下方确认，再提交关闭。' : `当前不能关闭：${result.resolution.message || '尚不能确认原订单未发货，请核对原任务与上游状态。'}`;
                stateMessage.textContent = `最新发货状态：${fulfillmentLabels[result.order.fulfillment_status] || '尚未确认'}。尚未提交关闭操作。`;
            } catch (error) {
                if (current()) { checked = true; message.className = 'tg-warning'; message.textContent = error.message || '关闭条件查询失败，请稍后重试'; }
            } finally { checking = false; check.textContent = '重新核对关闭条件'; if (current()) sync(); }
        }, 'tg-button tg-button-secondary');
        confirm.addEventListener('click', async () => {
            sync(); if (confirm.disabled) return;
            const checkedOrder = snapshot.order;
            submitting = true; state.purchaseClosing = true; sync();
            message.className = 'tg-muted'; message.textContent = '正在提交关闭，请等待处理结果…';
            try {
                const result = await post('/api/admin/tg/purchases', { action: 'close_order', order_no: order.order_no,
                    expected_updated_at: checkedOrder.updated_at, note: text(note.value), confirm_no_delivery: true, confirm_payment_handled: true });
                if (result.success !== true || typeof result.existing !== 'boolean' || result.order?.order_no !== order.order_no
                    || result.order.fulfillment_status !== 'closed' || !Number.isFinite(Date.parse(result.order.closed_at))) throw new Error('关闭结果尚未确认');
                const success = '订单已关闭，停止发货；收款记录已保留，请按核对结果处理退款。';
                let confirmedVersion = null;
                if (current()) {
                    confirmedVersion = ++state.detailVersion;
                    renderPurchaseOperations({ ...data, order: { ...order, ...result.order } }, confirmedVersion, success);
                }
                if (state.authenticated) {
                    const results = await Promise.allSettled([loadPurchases(), loadOrders(), request(`/api/admin/tg/purchases?order_no=${encodeURIComponent(order.order_no)}`)]);
                    if (confirmedVersion === state.detailVersion && state.authenticated) {
                        const fresh = results[2];
                        if (fresh.status === 'fulfilled' && fresh.value.success === true && fresh.value.order?.order_no === order.order_no && fresh.value.order.fulfillment_status === 'closed') {
                            renderPurchaseOperations(fresh.value, confirmedVersion, success);
                        }
                    }
                    if (results.some(item => item.status === 'rejected')) notice('tgAdminAlert', '订单已关闭，部分数据暂未刷新，请稍后刷新数据。', 'error');
                }
            } catch (error) {
                snapshot = null;
                if (current()) {
                    message.className = 'tg-warning';
                    message.textContent = error.status && error.status < 500 ? `${error.message} 请重新核对关闭条件。` : '关闭结果尚未确认，请重新查询原订单状态后再处理。';
                    stateMessage.textContent = '尚未取得订单已关闭的确认，请勿按关闭成功处理。';
                }
            } finally { submitting = false; state.purchaseClosing = false; if (current()) sync(); }
        });
        note.addEventListener('input', sync); delivery.addEventListener('change', sync); payment.addEventListener('change', sync);
        const actions = node('div', undefined, 'tg-row-actions'); actions.append(check, confirm);
        section.append(node('h3', '关闭订单'), message, stateMessage, fields, actions, node('p', '关闭后停止发货，用户会看到“订单已完结”。此操作不会自动退款。', 'tg-muted'));
        content.append(section); sync();
    }
    function appendPurchaseRecovery(content, data, version) {
        const order = data.order; const task = data.fulfillment;
        if (!order.paid_at || !task) return;
        const current = () => version === state.detailVersion && state.authenticated;
        const section = node('section', undefined, 'tg-order-closure tg-order-recovery'); section.setAttribute('aria-label', '原上游订单恢复');
        const message = node('p', '原任务提交结果不明确时，可核验并补录原上游单，或登记上游明确未受理且不会发货的凭据。', 'tg-muted');
        message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
        const body = node('div'); let loading = false;
        const open = button('补录原上游单 / 查看结案凭据', async () => {
            if (!current() || loading || state.purchaseClosing) return;
            loading = true; message.textContent = '正在检查恢复条件与处理记录…';
            try {
                const result = await request(`/api/admin/tg/purchases?order_no=${encodeURIComponent(order.order_no)}&recovery=1`);
                if (!current()) return;
                body.replaceChildren(); message.textContent = result.message;
                if (result.ready === true && (result.can_link === true || result.can_record_nonacceptance === true)) renderForms(result);
                if (result.records?.length) {
                    body.append(node('h3', '上游恢复 / 凭据记录'));
                    const records = node('ol', undefined, 'tg-audit-history');
                    for (const record of result.records) {
                        const item = node('li'); item.append(node('p', `${date(record.created_at)} · ${record.action === 'link_upstream_order' ? '补录原上游订单' : '未受理凭据结案'} · ${record.actor_user_id || '管理员'}`), node('p', record.note));
                        item.append(node('p', `处理结果：${fulfillmentLabels[record.result_status] || '待核对'}`));
                        if (record.provider_order_id) item.append(node('p', `原上游单：${record.provider_order_id}`));
                        if (record.evidence) item.append(node('p', `管理员登记的上游凭据（人工核实）：${record.evidence.reference} · ${date(record.evidence.confirmed_at)}`),
                            node('p', `凭据来源：${({ provider_support: '上游客服 / 工单明确确认', provider_rejection: '原请求明确拒绝记录' })[record.evidence.kind] || '待核对'}`), node('p', record.evidence.summary));
                        records.append(item);
                    }
                    body.append(records);
                }
            } catch (error) { if (current()) message.textContent = error.message || '恢复条件暂不可用，请重试'; }
            finally { loading = false; }
        }, 'tg-button tg-button-secondary');
        function renderForms(permissions) {
            const tabs = node('div', undefined, 'tg-row-actions tg-recovery-tabs'); tabs.setAttribute('aria-label', '恢复方式');
            const forms = []; const selectors = [];
            for (const mode of ['link', 'nonacceptance']) {
                if (mode === 'link' ? !permissions.can_link : !permissions.can_record_nonacceptance) continue;
                const link = mode === 'link';
                const form = node('div', undefined, 'tg-recovery-form'); form.setAttribute('aria-label', link ? '补录原上游订单' : '登记明确未受理凭据');
                const fields = [];
                function field(title, tag, placeholder, maxLength) {
                    const label = node('label', title); const input = node(tag); input.setAttribute('aria-label', title);
                    if (placeholder) input.placeholder = placeholder;
                    if (maxLength) input.maxLength = maxLength;
                    if (tag === 'textarea') input.rows = 3;
                    label.append(input); form.append(label); fields.push(input); return input;
                }
                let providerId; let kind; let reference; let confirmedAt; let summary;
                if (link) {
                    form.append(node('p', '只填写本次原始请求的上游单号。系统会核验原提交标识、账号、权益和币种；同一用户的其他订单不能关联。', 'tg-muted'));
                    providerId = field('原上游订单号', 'input', 'Gramix 原订单 UUID', 36); providerId.value = task.provider_order_id || '';
                } else {
                    form.append(node('p', '先取得上游明确答复：本次原请求未受理，且不会后续发货。查无结果、超时、余额不足推测均不能替代凭据。凭据由管理员人工核实并留档。', 'tg-warning'));
                    kind = field('凭据来源', 'select');
                    for (const [value, label] of [['provider_support', '上游客服 / 工单明确确认'], ['provider_rejection', '原请求明确拒绝记录']]) { const option = node('option', label); option.value = value; kind.append(option); }
                    kind.value = 'provider_support';
                    reference = field('凭据编号 / 留档位置', 'input', '工单编号、原请求日志编号或受控留档位置；勿填密钥', 200);
                    confirmedAt = field('上游确认时间', 'input'); confirmedAt.type = 'datetime-local'; confirmedAt.step = '1';
                    summary = field('上游明确答复摘要', 'textarea', '写明答复针对本次原提交，明确未受理且不会后续发货（20–1000 字）', 1000);
                }
                const note = field(link ? '补录处理原因' : '结案处理原因', 'textarea', link ? '记录补录依据（6–500 字）' : '记录凭据核实及收款、退款处理方式（6–500 字）', 500);
                const checks = [];
                function confirmation(label) { const control = node('input'); control.type = 'checkbox'; control.setAttribute('aria-label', label); const wrapper = node('label', undefined, 'tg-save-confirm'); wrapper.append(control, node('span', label)); form.append(wrapper); checks.push(control); return control; }
                confirmation('已确认针对本次原始提交，而非同一用户的另一笔订单');
                if (!link) { confirmation('上游已明确确认本次原请求未受理，且不会后续发货'); confirmation('已核对接收账号和原发货记录，确认未发货'); confirmation('已核对收款与退款，确认后续退款处理方式'); }
                const status = node('p', '', 'tg-muted'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
                const preview = node('div'); let checked = false; let busy = false; let payload = null;
                const inspect = node('button', link ? '核验原上游订单' : '核验原任务与结案条件', 'tg-button tg-button-secondary'); inspect.type = 'button';
                const confirm = node('button', link ? '确认补录原上游订单' : '登记凭据并关闭订单', link ? 'tg-button tg-button-primary' : 'tg-button tg-button-danger'); confirm.type = 'button';
                const validText = (value, min, max) => text(value).length >= min && text(value).length <= max && !/[\x00-\x1f\x7f]/.test(value);
                function valid() { return validText(note.value, 6, 500) && (link ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text(providerId.value))
                    : validText(reference.value, 6, 200) && validText(summary.value, 20, 1000) && !!confirmedAt.value && Number.isFinite(Date.parse(confirmedAt.value))); }
                function sync() {
                    const pending = busy || state.purchaseClosing;
                    for (const input of [...fields, ...checks]) input.disabled = pending;
                    inspect.disabled = pending;
                    confirm.disabled = pending || !checked || !valid() || checks.some(input => !input.checked);
                    for (const selector of selectors) selector.disabled = pending;
                }
                function invalidate() { checked = false; payload = null; preview.replaceChildren(); status.textContent = '内容已变化，请重新核验后确认。'; sync(); }
                for (const input of fields) { input.addEventListener('input', invalidate); input.addEventListener('change', invalidate); }
                for (const input of checks) input.addEventListener('change', () => { payload = null; sync(); });
                const identity = () => ({ order_no: order.order_no, expected_updated_at: order.updated_at, expected_task_updated_at: task.updated_at });
                inspect.addEventListener('click', async () => {
                    if (!current() || busy || state.purchaseClosing) return;
                    checked = false; preview.replaceChildren(); busy = true; sync(); status.textContent = '正在只读核验原请求…';
                    try {
                        const result = await post('/api/admin/tg/purchases', { ...identity(), action: link ? 'inspect_upstream_order' : 'inspect_nonacceptance', ...(link ? { provider_order_id: text(providerId.value).toLowerCase() } : {}) });
                        if (!current()) return;
                        if (result.success !== true || result.order_no !== order.order_no || result.expected_updated_at !== order.updated_at || result.expected_task_updated_at !== task.updated_at) throw new Error('核验版本未确认，请刷新订单');
                        if (link && (result.snapshot?.idempotency_key_matches !== true || result.snapshot?.provider_order_id !== text(providerId.value).toLowerCase() || !['created', 'processing', 'completed', 'failed', 'canceled'].includes(result.snapshot?.provider_status))) throw new Error('原上游订单身份尚未确认，请重新核验');
                        checked = true; status.textContent = result.message;
                        if (link) { const list = node('dl', undefined, 'tg-order-details'); detailItem(list, '核验上游单', result.snapshot?.provider_order_id); detailItem(list, '上游状态', ({ created: '已受理', processing: '处理中', completed: '已完成', failed: '失败', canceled: '已取消' })[result.snapshot?.provider_status] || '未知'); detailItem(list, '原提交标识', result.snapshot?.idempotency_key_matches === true ? '核验一致' : '尚未确认'); detailItem(list, '核验时间', date(result.checked_at)); preview.append(list); }
                    } catch (error) { if (current()) status.textContent = error.message || '核验未完成，请重试'; }
                    finally { busy = false; if (current()) sync(); }
                });
                confirm.addEventListener('click', async () => {
                    sync(); if (!current() || confirm.disabled) return;
                    let confirmedView = null;
                    busy = true; state.purchaseClosing = true; sync(); status.textContent = link ? '正在重新核验并关联原上游订单…' : '正在重新核验并保存凭据、关闭订单…';
                    try {
                        if (!payload) {
                            const operationId = globalScope.crypto?.randomUUID?.();
                            if (!operationId) throw new Error('当前浏览器无法生成操作编号，请刷新或使用本地安全预览地址。');
                            payload = { ...identity(), action: link ? 'link_upstream_order' : 'close_with_nonacceptance', operation_id: operationId,
                                note: text(note.value), confirm_original_request: true, ...(link ? { provider_order_id: text(providerId.value).toLowerCase() }
                                    : { evidence: { kind: kind.value, reference: text(reference.value), confirmed_at: new Date(confirmedAt.value).toISOString(), summary: text(summary.value) },
                                        confirm_nonacceptance: true, confirm_no_delivery: true, confirm_payment_handled: true }) };
                        }
                        const result = await post('/api/admin/tg/purchases', payload);
                        if (result.success !== true || result.operation_id !== payload.operation_id || result.order?.order_no !== order.order_no
                            || (!link && (result.order.fulfillment_status !== 'closed' || !Number.isFinite(Date.parse(result.order.closed_at))))) throw new Error('处理结果尚未确认，请使用相同内容重试确认或刷新详情核对记录。');
                        const success = link ? `原上游订单已补录；当前发货状态：${fulfillmentLabels[result.order.fulfillment_status] || '待核对'}。` : '未受理凭据已登记，订单已关闭，停止发货；请按核对结果处理退款。';
                        let confirmedVersion = null;
                        if (current()) {
                            confirmedVersion = ++state.detailVersion;
                            confirmedView = { version: confirmedVersion, message: success, data: { ...data, order: { ...order, ...result.order },
                                fulfillment: { ...task, status: result.order.fulfillment_status === 'closed' ? 'cancelled' : result.order.fulfillment_status, provider_order_id: payload.provider_order_id || task.provider_order_id } } };
                            renderPurchaseOperations(confirmedView.data, confirmedVersion, success);
                        }
                        if (state.authenticated) {
                            const results = await Promise.allSettled([loadPurchases(), loadOrders(), request(`/api/admin/tg/purchases?order_no=${encodeURIComponent(order.order_no)}`)]);
                            const fresh = results[2];
                            if (confirmedView && confirmedVersion === state.detailVersion && state.authenticated && fresh.status === 'fulfilled'
                                && fresh.value.success === true && fresh.value.order?.order_no === order.order_no
                                && (link ? fresh.value.fulfillment?.provider_order_id?.toLowerCase() === payload.provider_order_id
                                    : fresh.value.order.fulfillment_status === 'closed' && Number.isFinite(Date.parse(fresh.value.order.closed_at)))) confirmedView.data = fresh.value;
                        }
                        if (state.authenticated) notice('tgAdminAlert', success, 'success');
                    } catch (error) {
                        if (current()) {
                            if (['recovery_stale', 'recovery_active', 'recovery_provider_mismatch', 'recovery_negative_unconfirmed', 'recovery_conflict'].includes(error.code)) checked = false;
                            status.textContent = `${error.message || '处理结果尚未确认'}；未确认结果时请保持原内容重试，或刷新详情核对记录。`;
                        }
                    } finally {
                        busy = false; state.purchaseClosing = false;
                        if (confirmedView && confirmedView.version === state.detailVersion && state.authenticated) renderPurchaseOperations(confirmedView.data, confirmedView.version, confirmedView.message);
                        else if (current()) sync();
                    }
                });
                const controls = node('div', undefined, 'tg-row-actions'); controls.append(inspect, confirm); form.append(preview, status, controls);
                const selector = button(link ? '补录原上游订单' : '登记未受理凭据', () => {
                    if (busy || state.purchaseClosing) return;
                    for (let i = 0; i < forms.length; i++) { forms[i].hidden = forms[i] !== form; selectors[i].setAttribute('aria-pressed', String(forms[i] === form)); }
                }, 'tg-button tg-button-secondary');
                selectors.push(selector); forms.push(form); tabs.append(selector); form.hidden = forms.length > 1; selector.setAttribute('aria-pressed', String(forms.length === 1)); sync();
            }
            body.append(tabs, ...forms);
        }
        const identityList = node('dl', undefined, 'tg-order-details');
        detailItem(identityList, '原履约任务', task.order_no); detailItem(identityList, '原提交时间', date(task.submitted_at));
        section.append(node('h3', '原上游订单恢复'), identityList, message, open, body); content.append(section);
    }
    function renderPurchaseOperations(data, version, resultMessage = '') {
        const order = data.order; const content = node('div', undefined, 'tg-order-workspace'); const list = node('dl', undefined, 'tg-order-details');
        if (resultMessage) { const result = node('p', resultMessage, 'tg-operation-result'); result.setAttribute('role', 'status'); content.append(result); }
        const overview = orderSection('订单概览', '', button('刷新详情', () => inspectPurchaseOperations(order.order_no), 'tg-button tg-button-secondary'));
        detailItem(list, '购买订单号', order.order_no); detailItem(list, '收件人', `@${order.username}`); detailItem(list, '产品 / 权益', productLabel(order));
        detailItem(list, '金额 / 渠道', `¥${(order.total_minor / 100).toFixed(2)} · ${channelLabels[order.payment_channel] || '未知'}`);
        detailItem(list, '支付状态', orderStatus(paymentLabels[order.payment_status], order.payment_status)); detailItem(list, '发货状态', orderStatus(fulfillmentLabels[order.fulfillment_status], order.fulfillment_status));
        detailItem(list, '已核验到账时间', date(order.paid_at)); detailItem(list, '最近异常', order.last_error_code);
        detailItem(list, '关联履约单', data.fulfillment?.order_no); detailItem(list, '更新时间', date(order.updated_at));
        if (order.closed_at) { detailItem(list, '完结时间', date(order.closed_at)); if (order.completion_note) detailItem(list, '用户可见的完结说明', order.completion_note); }
        overview.append(list); content.append(overview);
        const handling = orderSection('支付与履约', '选择需要核对的订单环节。');
        const controls = orderActions(button('支付核对 / 补发审核', () => inspectPurchase(order.order_no), 'tg-button tg-button-secondary'));
        if (data.fulfillment) controls.append(button('查看履约详情 / 人工复核', () => inspectOrder(data.fulfillment.id), 'tg-button tg-button-secondary'));
        if (data.fulfillment?.provider_order_id) controls.append(button('只读核对上游订单', () => inspectPurchaseOperations(order.order_no, true), 'tg-button tg-button-primary'));
        handling.append(controls); appendReconciliation(handling, data.reconciliation);
        if (order.payment_status === 'manual_review' && !order.paid_at) handling.append(node('p', '尚无已核验到账记录。先核对支付渠道或链上记录，再在下方“人工完结”登记实际结果；后续迟到付款仍需另行处理。', 'tg-warning'));
        content.append(handling);
        appendPurchaseCompletion(content, data, version);
        appendPurchaseClosure(content, data, version);
        appendPurchaseRecovery(content, data, version);
        const actions = [];
        if (order.can_close) actions.push(['close', '关闭未付款订单', '确认关闭这笔未付款订单？迟到付款仍会保留并进入人工核对，此操作不执行退款。']);
        appendReview(content, '/api/admin/tg/purchases', { order_no: order.order_no }, order.updated_at, actions, async (detailVersion) => { await Promise.all([loadPurchases(), loadOrders()]); if (detailVersion === state.detailVersion && state.authenticated) await inspectPurchaseOperations(order.order_no); });
        appendHistory(content, data.history); $('tgDetailContent').replaceChildren(content);
            globalScope.TgAdminSelects?.enhance(content);
        globalScope.TgAdminSelects?.enhance(content);
    }
    async function inspectPurchaseOperations(orderNo, reconcile = false) {
        if (!state.authenticated || state.reviewSubmitting || state.purchaseClosing) return;
        if ($('tgPurchaseReviewModal').open) closePurchaseReview();
        openDetail('购买订单详情', purchaseDetailSkeleton(orderNo), 'order');
        $('tgDetailContent').setAttribute('aria-busy', 'true');
        const version = state.detailVersion;
        try {
            const data = await request(`/api/admin/tg/purchases?order_no=${encodeURIComponent(orderNo)}${reconcile ? '&reconcile=1' : ''}`);
            if (version !== state.detailVersion || !state.authenticated) return;
            if (data.success !== true || data.order?.order_no !== orderNo || typeof data.order.updated_at !== 'string') throw new Error('订单详情尚未确认，请重试');
            renderPurchaseOperations(data, version);
        } catch (error) {
            if (version === state.detailVersion && state.authenticated) orderDetailError(error, () => inspectPurchaseOperations(orderNo, reconcile));
        } finally { if (version === state.detailVersion) $('tgDetailContent').setAttribute('aria-busy', 'false'); }
    }
    function appendRedemptionResolution(content, data, version) {
        const order = data.order; const capability = data.resolution;
        if (order.order_source !== 'redemption' || !capability) return;
        const current = () => version === state.detailVersion && state.authenticated;
        const outcomes = { delivery_confirmed: '已核实用户收货', refunded: '已另行退款', agreed_settlement: '已与用户协商处理', not_accepted: '上游明确未受理' };
        const dispositions = { fulfilled: '记为已兑换', revoked: '已作废，不能再次使用', available: '恢复可兑换', fulfilling: '继续核对原上游单', failed: '等待管理员处理' };
        if (capability.completion) {
            clearPendingRedemption(order.order_no);
            const result = capability.completion;
            const section = orderSection('完结结果', '用户查询此订单时将显示以下完结说明。');
            const list = node('dl', undefined, 'tg-order-details');
            detailItem(list, '完结时间', date(result.closed_at)); detailItem(list, '处理结果', outcomes[result.completion_outcome]);
            detailItem(list, '兑换码处置', dispositions[result.code_disposition]);
            const note = node('p', result.completion_note, 'tg-completion-preview tg-resolution-public-note');
            section.append(list, note); content.append(section);
        } else {
            const section = orderSection('订单处理', '核验原始请求，或登记已实际完成的处理结果。');
            const message = node('p', capability.message || '', 'tg-form-message'); message.setAttribute('role', 'status');
            const body = node('div', undefined, 'tg-resolution-body');
            let mode = null; let busy = false; let retryInput = readPendingRedemption(order.order_no);
            const panels = new Map(); const tabs = new Map();
            function control(label, action, className = 'tg-button tg-button-secondary') {
                const button = node('button', label, className); button.type = 'button';
                button.addEventListener('click', async () => {
                    if (button.disabled || !current()) return;
                    try { await action(); } catch (error) { if (current()) message.textContent = error.message || '处理未完成，请稍后重试。'; }
                    finally { if (current()) sync(); }
                });
                return button;
            }
            function field(panel, title, tag = 'textarea', placeholder = '') {
                const label = node('label', title); const input = node(tag); input.setAttribute('aria-label', title);
                if (tag === 'textarea') { input.rows = 2; input.maxLength = 500; }
                input.placeholder = placeholder; label.append(input); panel.element.append(label); panel.inputs.push(input);
                const changed = () => {
                    if (input === panel.provider) {
                        panel.checked = false;
                        message.textContent = '原上游订单号已变更，请重新核验。';
                    }
                    sync();
                };
                input.addEventListener('input', changed);
                input.addEventListener('change', changed);
                return input;
            }
            function select(panel, title, choices) {
                const input = field(panel, title, 'select');
                for (const [value, label] of choices) { const option = node('option', label); option.value = value; input.append(option); }
                input.value = choices[0][0]; return input;
            }
            function confirmation(panel, title, key) {
                const label = node('label', undefined, 'tg-save-confirm'); const input = node('input'); input.type = 'checkbox'; input.setAttribute('aria-label', title);
                label.append(input, node('span', title)); panel.element.append(label); panel.inputs.push(input); panel.confirmations.push({ input, key });
                input.addEventListener('change', sync);
            }
            function validText(value, min = 6, max = 500) { return text(value).length >= min && text(value).length <= max; }
            function valid(panel) {
                if (!validText(panel.note.value) || panel.confirmations.some(item => !item.input.checked)) return false;
                if (panel.publicNote && !validText(panel.publicNote.value)) return false;
                if (panel.kind === 'link') return panel.checked && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text(panel.provider.value));
                if (panel.kind === 'negative') return panel.checked && validText(panel.reference.value, 6, 200) && validText(panel.summary.value, 20, 1000)
                    && Number.isFinite(Date.parse(panel.confirmed.value));
                return ['delivery_confirmed', 'refunded', 'agreed_settlement'].includes(panel.outcome.value);
            }
            function sync() {
                for (const [key, tab] of tabs) {
                    tab.disabled = busy || !!retryInput || capability.ready !== true || !({ link: capability.can_link, negative: capability.can_record_nonacceptance, complete: capability.can_complete })[key];
                    tab.setAttribute('aria-expanded', String(mode === key)); tab.className = `tg-button ${mode === key ? 'tg-button-primary' : 'tg-button-secondary'}`;
                }
                for (const panel of panels.values()) {
                    panel.element.hidden = panel.kind !== mode;
                    for (const input of panel.inputs) input.disabled = busy || !!retryInput;
                    if (panel.inspect) panel.inspect.disabled = busy || !!retryInput || panel.kind === 'link' && !/^[0-9a-f-]{36}$/i.test(text(panel.provider.value));
                    if (panel.query) { panel.query.hidden = !retryInput; panel.query.disabled = busy || !retryInput; }
                    panel.submit.disabled = busy || capability.ready !== true || (!retryInput && !valid(panel));
                    panel.submit.textContent = busy ? '正在处理…' : retryInput ? '查询并重试本次处理' : panel.kind === 'link' ? '确认补录并同步' : '确认完结订单';
                }
                globalScope.TgAdminSelects?.sync(section);
            }
            async function inspect(panel) {
                if (busy || retryInput || !current()) return;
                busy = true; state.reviewSubmitting = true; state.redemptionResolving = true; panel.checked = false; message.textContent = '正在核验原始上游请求…'; sync();
                try {
                    const result = await post('/api/admin/tg/orders', { action: panel.kind === 'link' ? 'inspect_upstream_order' : 'inspect_nonacceptance',
                        order_no: order.order_no, expected_updated_at: capability.expected_updated_at, expected_code_updated_at: capability.expected_code_updated_at,
                        ...(panel.kind === 'link' ? { provider_order_id: text(panel.provider.value) } : {}) });
                    if (!current()) return;
                    if (result.success !== true || result.order_no !== order.order_no || result.expected_updated_at !== capability.expected_updated_at
                        || result.expected_code_updated_at !== capability.expected_code_updated_at) throw new Error('订单版本已变化，请刷新详情重新核对。');
                    panel.checked = true; message.textContent = result.message;
                } finally { busy = false; state.reviewSubmitting = false; state.redemptionResolving = false; if (current()) sync(); }
            }
            async function confirmResult(result, panel) {
                if (result.success !== true || result.operation_id !== retryInput.operation_id || result.order?.id !== order.id
                    || result.order.order_no !== order.order_no || typeof result.existing !== 'boolean'
                    || panel.kind !== 'link' && (result.order.status !== 'closed' || result.order.completion_note !== retryInput.completion_note)) throw new Error('尚未收到完整的处理确认');
                clearPendingRedemption(order.order_no); retryInput = null;
                const success = panel.kind === 'link' ? '已补录原上游订单并同步结果。' : '订单已完结，用户端将显示完结说明。';
                busy = false; state.reviewSubmitting = false; state.redemptionResolving = false;
                await Promise.allSettled([loadOrders(), loadBatches()]);
                if (current()) await inspectOrder(order.id, false, success);
            }
            async function submit(panel, queryOnly = false) {
                if (busy || !current() || queryOnly && !retryInput || !retryInput && !valid(panel)) return;
                const checking = !!retryInput;
                if (!retryInput) {
                    if (capability.ready !== true) return;
                    if (typeof globalScope.crypto?.randomUUID !== 'function') throw new Error('当前浏览器无法生成操作凭证，请更新浏览器后重试。');
                    retryInput = { action: ({ link: 'link_upstream_order', negative: 'close_with_nonacceptance', complete: 'complete_review' })[panel.kind],
                        order_no: order.order_no, expected_updated_at: capability.expected_updated_at, expected_code_updated_at: capability.expected_code_updated_at,
                        operation_id: globalScope.crypto.randomUUID(), note: text(panel.note.value),
                        ...Object.fromEntries(panel.confirmations.map(item => [item.key, item.input.checked])),
                        ...(panel.publicNote ? { completion_note: text(panel.publicNote.value) } : {}),
                        ...(panel.kind === 'link' ? { provider_order_id: text(panel.provider.value) } : {}),
                        ...(panel.kind === 'complete' ? { outcome: panel.outcome.value } : {}),
                        ...(panel.kind === 'negative' ? { code_disposition: panel.disposition.value, evidence: { kind: panel.evidenceKind.value,
                            reference: text(panel.reference.value), confirmed_at: new Date(panel.confirmed.value).toISOString(), summary: text(panel.summary.value) } } : {}) };
                    savePendingRedemption(order.order_no, retryInput);
                }
                busy = true; state.reviewSubmitting = true; state.redemptionResolving = true;
                message.textContent = checking ? '正在查询本次操作的处理凭据…' : '正在保存处理结果…'; sync();
                try {
                    if (checking) {
                        const result = await request(`/api/admin/tg/orders?order_no=${encodeURIComponent(order.order_no)}&operation_id=${encodeURIComponent(retryInput.operation_id)}`);
                        if (result.success !== true || result.operation_id !== retryInput.operation_id || result.order?.id !== order.id || result.order.order_no !== order.order_no) throw new Error('尚未收到完整的处理确认');
                        if (result.state === 'applied' && result.action === retryInput.action) { await confirmResult(result, panel); return; }
                        if (result.state !== 'not_recorded') throw new Error('本次操作凭据尚未确认');
                        if (queryOnly) {
                            message.textContent = `暂未查到本次操作的处理凭据，当前订单为“${labels[result.order.status] || '待核对'}”。${capability.ready === true ? '可查询并重试同一次处理，操作编号和输入保持不变。' : capability.message}`;
                            return;
                        }
                        if (capability.ready !== true) { message.textContent = capability.message; return; }
                    }
                    await confirmResult(await post('/api/admin/tg/orders', retryInput), panel);
                } catch (error) {
                    if (current()) {
                        if (error.notApplied) message.textContent = `${error.message} 本次操作编号和说明已保留；完成修复后刷新详情，再查询并重试本次处理。`;
                        else if (!checking && error.status && error.status < 500) {
                            clearPendingRedemption(order.order_no); retryInput = null; panel.checked = false; message.textContent = `${error.message} 请重新核验或刷新详情。`;
                        } else message.textContent = '尚未收到处理确认。可先“查询处理结果”；使用“查询并重试本次处理”会先查询凭据，再沿用原操作编号重试。输入已暂时锁定，刷新或重开详情会恢复本次操作。';
                    }
                } finally { busy = false; state.reviewSubmitting = false; state.redemptionResolving = false; if (current()) sync(); }
            }
            function makePanel(kind) {
                const panel = { kind, element: node('div', undefined, 'tg-completion-fields tg-resolution-fields'), inputs: [], confirmations: [], checked: false };
                if (kind === 'link') {
                    panel.provider = field(panel, '原上游订单号', 'input', '填写本次原始请求对应的 Gramix 订单 UUID'); panel.provider.value = order.provider_order_id || '';
                    panel.element.append(node('p', '补录会校验原提交标识、接收人、商品权益和扣款币种。处理中只恢复查单，不会重新购买。', 'tg-muted'));
                } else if (kind === 'negative') {
                    panel.element.append(node('p', '须取得上游明确未受理且不会后续交付的记录。查询为空或超时不能代替凭据。', 'tg-muted'));
                    panel.evidenceKind = select(panel, '上游凭据类型', [['provider_support', '上游客服明确确认'], ['provider_rejection', '上游明确拒绝受理记录']]);
                    panel.reference = field(panel, '凭据编号或链接', 'input', '可追溯的工单、记录编号或链接（6–200 字）'); panel.reference.maxLength = 200;
                    panel.confirmed = field(panel, '上游确认时间', 'input'); panel.confirmed.type = 'datetime-local';
                    panel.summary = field(panel, '上游明确答复', 'textarea', '写明对应原始请求、未受理和不会后续发货的答复（20–1000 字，仅管理员可见）'); panel.summary.maxLength = 1000;
                    panel.disposition = select(panel, '兑换码处置', [['revoked', '作废兑换码'], ...(capability.can_release_code ? [['available', '恢复可兑换']] : [])]);
                    if (!capability.can_release_code) panel.element.append(node('p', '当前兑换码或批次已失效，只能作废后结案。', 'tg-muted'));
                } else {
                    panel.outcome = select(panel, '兑换单实际处理结果', [['', '请选择实际处理结果'], ['delivery_confirmed', '已核实用户收货'], ['refunded', '已另行退款'], ['agreed_settlement', '已与用户协商处理']]);
                    panel.element.append(node('p', '仅登记已实际完成的处理。核实收货会记为已兑换；退款或协商完结会作废兑换码。此操作不会发起退款或撤回上游请求。', 'tg-muted'));
                }
                if (kind !== 'complete') { panel.inspect = control(kind === 'link' ? '核验原上游订单' : '核对上游记录', () => inspect(panel)); panel.element.append(orderActions(panel.inspect)); }
                panel.note = field(panel, '兑换单内部处理依据', 'textarea', '填写核实记录、退款凭据或协商依据（6–500 字，仅管理员可见）');
                if (kind !== 'link') {
                    panel.publicNote = field(panel, '兑换单给用户的完结说明', 'textarea', '说明处理结果及用户需要了解的信息（6–500 字，用户可见）'); panel.publicNote.rows = 3;
                    const preview = node('div', undefined, 'tg-completion-preview'); const copy = node('p', '填写后可预览用户看到的说明。');
                    preview.append(node('strong', '用户订单 · 已完结'), copy); panel.element.append(preview);
                    panel.publicNote.addEventListener('input', () => { copy.textContent = text(panel.publicNote.value) || '填写后可预览用户看到的说明。'; sync(); });
                }
                confirmation(panel, '已核对本次原始兑换请求和接收账号', 'confirm_original_request');
                if (kind === 'negative') {
                    confirmation(panel, '凭据明确确认原请求未被上游受理', 'confirm_nonacceptance');
                    confirmation(panel, '已确认原请求不会后续发货', 'confirm_no_delivery');
                }
                if (kind === 'complete') confirmation(panel, '已完成所选处理并核对收货、退款或协商结果', 'confirm_result_handled');
                if (kind !== 'link') confirmation(panel, '停止此订单的自动履约，不再通过此订单补发', 'confirm_stop_fulfillment');
                if (kind === 'complete') confirmation(panel, '理解本地完结不能撤回上游，原请求仍可能发货；兑换码不会恢复可兑换', 'confirm_upstream_risk');
                panel.submit = control(kind === 'link' ? '确认补录并同步' : '确认完结订单', () => submit(panel), 'tg-button tg-button-primary');
                panel.query = control('查询处理结果', () => submit(panel, true)); panel.query.hidden = true;
                panel.element.append(orderActions(panel.query, panel.submit)); panels.set(kind, panel); body.append(panel.element); return panel;
            }
            const actions = orderActions(); actions.setAttribute('aria-label', '兑换订单处理方式');
            for (const [kind, label] of [['link', '补录原上游订单'], ['negative', '凭未受理证明结案'], ['complete', '人工完结']]) {
                const tab = control(label, () => { if (busy || retryInput) return; mode = mode === kind ? null : kind; if (mode && !panels.has(kind)) makePanel(kind); sync(); });
                tabs.set(kind, tab); actions.append(tab);
            }
            section.append(actions, body, message); content.append(section);
            if (retryInput) {
                mode = ({ link_upstream_order: 'link', close_with_nonacceptance: 'negative', complete_review: 'complete' })[retryInput.action];
                const panel = makePanel(mode); panel.note.value = retryInput.note;
                if (panel.publicNote) panel.publicNote.value = retryInput.completion_note || '';
                if (panel.outcome) panel.outcome.value = retryInput.outcome || '';
                if (panel.provider) panel.provider.value = retryInput.provider_order_id || '';
                if (panel.evidenceKind && retryInput.evidence) {
                    panel.evidenceKind.value = retryInput.evidence.kind; panel.reference.value = retryInput.evidence.reference;
                    panel.summary.value = retryInput.evidence.summary; panel.disposition.value = retryInput.code_disposition;
                    const confirmed = new Date(retryInput.evidence.confirmed_at);
                    if (Number.isFinite(confirmed.getTime())) panel.confirmed.value = new Date(confirmed.getTime() - confirmed.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                }
                for (const item of panel.confirmations) item.input.checked = retryInput[item.key] === true;
                message.textContent = `已恢复上次待确认操作，可先查询处理结果；重试将沿用原操作编号。${capability.ready === true ? '' : capability.message}`;
            }
            sync();
        }
        if (capability.records?.length) {
            const history = orderSection('订单处理记录'); const list = node('ol', undefined, 'tg-audit-history');
            for (const record of capability.records) {
                const item = node('li'); item.append(node('p', `${date(record.created_at)} · ${({ link_upstream_order: '补录原上游订单', close_with_nonacceptance: '未受理证明结案', complete_review: '人工完结' })[record.action] || '处理记录'}`), node('p', record.note));
                item.append(node('p', `结果：${labels[record.result_status] || '待核对'} · 兑换码：${dispositions[record.code_disposition] || labels[record.code_disposition] || '待核对'}`));
                if (record.evidence) item.append(node('p', `上游凭据：${record.evidence.reference} · ${date(record.evidence.confirmed_at)}`), node('p', record.evidence.summary));
                list.append(item);
            }
            history.append(list); content.append(history);
        }
    }
    async function inspectOrder(id, reconcile = false, successMessage = '') {
        if (!state.authenticated || state.reviewSubmitting || state.purchaseClosing) return;
        if ($('tgPurchaseReviewModal').open) closePurchaseReview();
        openDetail('兑换订单详情', orderDetailSkeleton('redemption'), 'order');
        $('tgDetailContent').setAttribute('aria-busy', 'true');
        const version = state.detailVersion;
        try {
            const data = await request(`/api/admin/tg/orders?orderId=${encodeURIComponent(id)}${reconcile ? '&reconcile=1' : ''}`);
            if (version !== state.detailVersion || !state.authenticated) return;
            const order = data.order || {}; const content = node('div', undefined, 'tg-order-workspace');
            if (successMessage) { const confirmation = node('p', successMessage, 'tg-form-message tg-success-text'); confirmation.setAttribute('role', 'status'); content.append(confirmation); }
            const overview = orderSection('订单概览', '', button('刷新详情', () => inspectOrder(id), 'tg-button tg-button-secondary'));
            const list = node('dl', undefined, 'tg-order-details');
            detailItem(list, '订单号', order.order_no); detailItem(list, '兑换账号', `@${order.telegram_username}`); detailItem(list, '产品 / 权益', productLabel(order)); detailItem(list, '本地状态', orderStatus(labels[order.status], order.status));
            overview.append(list);
            if (data.purchase?.order_no) {
                detailItem(list, '关联购买订单', data.purchase.order_no);
                if (data.purchase.closed_at) detailItem(list, '购买订单', '已完结，自动履约已停止');
                overview.append(orderActions(button(data.purchase.closed_at ? '查看购买订单与完结说明' : '处理购买订单 / 人工完结', () => inspectPurchaseOperations(data.purchase.order_no), 'tg-button tg-button-primary')));
            }
            content.append(overview);
            const upstream = orderSection('上游核对', '核对原发货任务与上游受理、发货情况。');
            const upstreamDetails = node('dl', undefined, 'tg-order-details');
            detailItem(upstreamDetails, '上游订单号', order.provider_order_id); detailItem(upstreamDetails, '扣款币种', ['usdt', 'gram'].includes(order.provider_payment_currency) ? order.provider_payment_currency.toUpperCase() : '未确认'); detailItem(upstreamDetails, '提交时间', date(order.submitted_at)); detailItem(upstreamDetails, '完成时间', date(order.completed_at)); detailItem(upstreamDetails, '最近异常', order.last_error_message);
            upstream.append(upstreamDetails, orderActions(button('查询上游状态', () => inspectOrder(id, true), 'tg-button tg-button-primary')));
            if (!order.provider_order_id) upstream.append(node('p', order.submitted_at ? '已有提交记录但没有上游订单号，可查询上游状态以继续核对原任务。' : '任务尚无上游提交记录，可查询当前任务状态。', 'tg-muted'));
            if (data.reconciliation) { const panel = node('div', undefined, 'tg-detail-query-result'); renderUpstreamStatus(panel, data); upstream.append(panel); }
            content.append(upstream);
            appendRedemptionResolution(content, data, version);
            const actions = [];
            if (order.status === 'manual_review') {
                if (order.provider_order_id && !data.resolution) actions.push(['reconcile', '核验上游并同步结果', '系统将重新查询上游并核验身份与权益；完成或失败将结案，处理中将恢复查询。不会重新购买。']);
                else if (!order.submitted_at && !order.provider_payment_currency && !order.attempt_count) actions.push(['resume_unsubmitted', '恢复尚未提交的履约', '仅在数据库确认从未提交上游时恢复履约。结果未知的订单会拒绝此操作。']);
            }
            if (order.order_source === 'redemption' && ['pending', 'manual_review'].includes(order.status) && !order.submitted_at && !order.provider_order_id && !order.attempt_count) actions.push(['close', '关闭未提交的兑换单', '仅关闭从未提交上游的兑换单，安全释放原兑换码。处理中或结果未知的订单不能关闭。']);
            appendReview(content, '/api/admin/tg/orders', { order_id: id }, order.updated_at, actions, async (version) => { await Promise.all([loadOrders(), loadPurchases()]); if (version === state.detailVersion && state.authenticated) await inspectOrder(id); });
            appendHistory(content, data.history); $('tgDetailContent').replaceChildren(content);
            globalScope.TgAdminSelects?.enhance(content);
        } catch (error) {
            if (version === state.detailVersion && state.authenticated) orderDetailError(error, () => inspectOrder(id, reconcile));
        } finally { if (version === state.detailVersion) $('tgDetailContent').setAttribute('aria-busy', 'false'); }
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
    async function verifyAccess({ restoredSession = false } = {}) {
        const isolated = { supabaseClient: client, forceRefresh: true, allowPersistedSessionFallback: false };
        let access;
        try { access = await globalScope.AdminAccess.getCurrentAdminAccess(isolated); }
        catch (error) { if ([401, 403].includes(error.status)) throw error; throw sessionRetryError('管理员权限核验暂不可用，请重试连接。'); }
        if (!access.user) {
            if (restoredSession && ![400, 401, 403].includes(access.error?.status)) throw sessionRetryError('管理会话仍在核验，请重试连接。');
            showLogin('请登录超级管理员账号'); return false;
        }
        if (access.error) {
            if ([401, 403].includes(access.error.status)) throw access.error;
            throw sessionRetryError('管理员权限核验暂不可用，请重试连接。');
        }
        // Use the identity verified by Supabase, never the editable login form.
        // Recheck restored sessions too, so reload cannot skip an account lock.
        try { await securityCheck('preflight', access.user.email); }
        catch (error) { if (!error.retryableSession) await clearTgSession(); throw error; }
        if (!access.isSuperAdmin) { showLogin('当前账号没有 TG 管理权限，请切换超级管理员账号', true); return false; }
        let session;
        try { session = await globalScope.AdminAccess.createAdminStudioSession({ ...isolated, userId: access.user.id }); }
        catch (error) { if ([401, 403].includes(error.status)) throw error; throw sessionRetryError('安全访问凭证暂未确认，请重试连接。'); }
        if (!session?.ok) { if ([401, 403].includes(session?.status)) showLogin(session.status === 403 ? '当前账号没有 TG 管理权限' : '登录已失效，请重新登录', session.status === 403); else throw sessionRetryError('安全访问凭证暂未确认，请重试连接。'); return false; }
        showSessionLoading('正在加载管理数据…');
        state.authenticated = true; state.actorId = access.user.id;
        restoreAdminSection();
        updateAdminNavigation();
        await refresh();
        if (!state.authenticated) return false;
        state.workspaceLoading = false;
        document.body.classList.toggle('tg-admin-is-loading', false);
        $('tgAdminLoading').hidden = true; $('tgLoginPanel').hidden = true; $('tgAdminApp').hidden = false; $('tgAdminLogout').hidden = false;
        updateAdminNavigation();
        return true;
    }
    async function securityCheck(action, email) {
        if (action !== 'preflight_ip' && !text(email)) throw new Error('无法确认账号信息，请重新登录');
        let data;
        try { data = await post('/api/auth/login-security', { action, ...(email ? { email } : {}) }); }
        catch (error) { if ([401, 403].includes(error.status)) throw error; throw sessionRetryError('登录安全检查暂不可用，请稍后重试'); }
        if (typeof data.security?.ip_blocked !== 'boolean' || typeof data.security?.account_locked !== 'boolean') throw sessionRetryError('登录安全检查暂不可用，请稍后重试');
        if (data.security.ip_blocked) throw new Error('当前网络受到安全限制，请稍后再试或联系管理员');
        if (data.security.account_locked) {
            const seconds = Number(data.security.remaining_seconds);
            const wait = Number.isFinite(seconds) && seconds > 0 ? `，请约 ${Math.ceil(seconds / 60)} 分钟后重试` : '，请稍后再试或联系管理员';
            throw new Error(`该账号登录受到安全限制${wait}`);
        }
    }
    async function clearTgSession() {
        state.authenticated = false; closePurchaseReview(); closeDetail(); $('tgAdminApp').hidden = true;
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
        clearPendingOAuth(); notice('tgAdminAlert', '');
        try { await globalScope.AdminAccess.clearAdminStudioSession(); await client?.auth.signOut({ scope: 'local' }); globalScope.AdminAccess.clearAccessCache(); showLogin('已退出，请登录超级管理员账号'); }
        catch (_) { showLogin('退出请求未完成，请刷新后确认登录状态'); }
    }
    $('tgAdminNavToggle').addEventListener('click', toggleAdminNavigation);
    $('tgAdminNavClose').addEventListener('click', toggleAdminNavigation);
    $('tgAdminNavBackdrop').addEventListener('click', () => closeAdminNavigation({ returnFocus: true }));
    globalScope.addEventListener('keydown', handleAdminNavigationKey);
    $('tgAdminSidebar').addEventListener('pointerenter', event => {
        if (!state.authenticated || navMedia.matches || event.pointerType !== 'mouse') return;
        navState.hovered = true;
        updateAdminNavigation();
    });
    $('tgAdminSidebar').addEventListener('pointerleave', () => {
        navState.hovered = false;
        updateAdminNavigation();
    });
    $('tgAdminSidebar').addEventListener('focusin', event => {
        if (navMedia.matches || !event.target?.matches?.(':focus-visible')) return;
        navState.keyboard = true;
        updateAdminNavigation();
    });
    $('tgAdminSidebar').addEventListener('focusout', event => {
        if ($('tgAdminSidebar').contains(event.relatedTarget)) return;
        navState.keyboard = false;
        updateAdminNavigation();
    });
    $('tgAdminSidebar').addEventListener('pointerdown', () => {
        navState.keyboard = false;
        updateAdminNavigation();
    });
    navMedia.addEventListener('change', () => {
        const focusWasInNav = $('tgAdminSidebar').contains(document.activeElement);
        closeAdminNavigation();
        if (state.authenticated && navMedia.matches && focusWasInNav) $('tgAdminNavToggle').focus();
    });
    for (const [index, key] of ADMIN_SECTIONS.entries()) {
        $('tgAdminTab' + key).addEventListener('click', () => {
            if (!state.authenticated) return;
            selectAdminSection(key);
            closeAdminNavigation();
            $('tgAdminPanel' + key).focus();
        });
        $('tgAdminTab' + key).addEventListener('keydown', event => {
            if (!state.authenticated || !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? ADMIN_SECTIONS.length - 1 : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + ADMIN_SECTIONS.length) % ADMIN_SECTIONS.length;
            navState.keyboard = true;
            updateAdminNavigation();
            selectAdminSection(ADMIN_SECTIONS[next], { focus: true });
        });
    }
    for (const [name, kind] of [['Purchase', 'purchase'], ['Redeem', 'redeem']]) {
        $('tgAdminQuery' + name).addEventListener('click', () => selectOrderSearchKind(kind));
        $('tgAdminQuery' + name).addEventListener('keydown', event => {
            if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            selectOrderSearchKind(event.key === 'Home' ? 'purchase' : event.key === 'End' ? 'redeem' : kind === 'purchase' ? 'redeem' : 'purchase', { focus: true });
        });
    }
    $('tgAdminQueryForm').addEventListener('submit', event => { event.preventDefault(); return queryAdminOrders(1); });
    $('tgAdminQueryClear').addEventListener('click', () => { resetOrderSearch({ clearInput: true }); $('tgAdminQueryValue').focus(); });
    $('tgAdminQueryValue').addEventListener('input', () => resetOrderSearch({ message: '查询信息已更新，请重新查询。' }));
    $('tgAdminQuerySearchBy').addEventListener('change', () => { resetOrderSearch({ clearInput: true }); syncOrderSearchField(); });
    syncOrderSearchField();
    $('tgGenerateForm').addEventListener('submit', generate); $('tgLoginForm').addEventListener('submit', login); $('tgGoogleLogin').addEventListener('click', googleLogin); $('tgAdminRefresh').addEventListener('click', refresh); $('tgAdminLogout').addEventListener('click', logout);
    dataCenter = globalScope.TgAdminDataCenter?.create({ request, navigate: navigateDataCenter, isAuthenticated: () => state.authenticated, refreshProvider: loadProvider });
    bindFilters('Batch', 'batchPage', loadBatches); bindFilters('Order', 'orderPage', loadOrders); bindFilters('Purchase', 'purchasePage', loadPurchases);
    $('tgAdminRetry').addEventListener('click', () => { if (!state.initializing) return boot(); });
    $('tgOrderFilter').addEventListener('change', () => { state.orderPage = 1; if ($('tgOrderFilter').value) appliedFilters.Order.status = $('tgOrderFilter').value; else delete appliedFilters.Order.status; renderCenterContext('Order'); loadOrders().catch(showError); });
    $('tgProductFamily').addEventListener('change', syncProductFields);
    for (const id of productIds) $('tgSave-' + id).addEventListener('click', () => saveProduct(id));
    $('tgCodesClose').addEventListener('click', closeCodes); $('tgCodesCopy').addEventListener('click', copyCodes); $('tgCodesModal').addEventListener('cancel', (event) => { event.preventDefault(); closeCodes(); });
    $('tgCodesModal').addEventListener('close', () => { $('tgCodesText').value = ''; });
    for (const [id, close] of [['tgDetailModal', closeDetail], ['tgPurchaseReviewModal', closePurchaseReview], ['tgCodesModal', closeCodes]]) dismissOnBackdrop($(id), close);
    $('tgDetailClose').addEventListener('click', closeDetail);
    $('tgDetailModal').addEventListener('close', () => { hideCopyToast(); state.detailVersion++; $('tgDetailContent').replaceChildren(); $('tgDetailContent').setAttribute('aria-busy', 'false'); });
    $('tgDetailModal').addEventListener('cancel', (event) => { event.preventDefault(); closeDetail(); });
    $('tgPurchaseReviewForm').addEventListener('submit', approvePurchase);
    $('tgPurchaseCloseOrder').addEventListener('click', () => resolvePurchase('close_order'));
    $('tgPurchaseResume').addEventListener('click', () => resolvePurchase('resume_fulfillment'));
    $('tgPurchaseReviewClose').addEventListener('click', closePurchaseReview);
    $('tgPurchaseReviewModal').addEventListener('close', () => { if (!$('tgPurchaseReviewModal').open) resetPurchaseReview(); });
    $('tgPurchaseReviewModal').addEventListener('cancel', (event) => { event.preventDefault(); closePurchaseReview(); });
    $('tgPurchaseReviewRecheck').addEventListener('click', () => inspectPurchase(state.reviewOrderNo));
    $('tgPurchaseReviewNote').addEventListener('input', syncPurchaseReviewControls);
    for (const id of ['tgPurchaseReviewNoRefund', 'tgPurchaseReviewNoDelivery', 'tgPurchasePaymentHandled']) $(id).addEventListener('change', syncPurchaseReviewControls);
    globalScope.addEventListener('beforeunload', (event) => { if ($('tgCodesText').value) { event.preventDefault(); event.returnValue = ''; } });
    globalScope.addEventListener('pageshow', (event) => { if (event.persisted) { clearPendingOAuth(); state.loggingIn = false; updateLoginControls(); } });
    syncProductFields();
    async function boot() {
        state.initializing = true;
        showSessionLoading();
        updateLoginControls();
        let callback;
        try {
            callback = readOAuthCallback();
            const config = globalScope.requireZaoyoeSupabaseConfig();
            if (!globalScope.supabase?.createClient || !globalScope.AdminAccess) throw new Error('登录组件未就绪，请刷新重试');
            authOrigin = new globalScope.URL(config.url).origin;
            if (!client) client = globalScope.supabase.createClient(config.url, config.publishableKey, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'tg-admin-auth-v1' } });
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
            const restoredSession = callback?.code === '' ? true : await restoreSession();
            await verifyAccess({ restoredSession });
        } catch (error) {
            if (error.retryableSession) showSessionLoading(error.message, true);
            else if ([401, 403].includes(error.status)) showError(error);
            else showLogin(error.message || '管理后台初始化失败，请稍后重试', false, true);
        }
        finally { if (callback) callback.code = ''; state.initializing = false; updateLoginControls(); }
    }
    boot();
})(window);
