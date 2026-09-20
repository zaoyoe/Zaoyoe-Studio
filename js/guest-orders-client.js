'use strict';

/*
 * Guest Order Access 2.0 (§11.2) — the /guest-orders.html lookup page.
 *
 * Isolation rules, identical to js/guest-shop-client.js and enforced by
 * tests/guest-shop-frontend-contract.test.js:
 *   - public guest endpoints only; no supabase client, no access_token, no
 *     `Authorization:` header. The query credential travels in the dedicated
 *     X-Guest-Order-Credential header (§7.1) or in the server-issued HttpOnly
 *     session cookie, never in a URL.
 *   - §7.2 storage ladder: memory -> sessionStorage -> a ONE-TIME localStorage
 *     migration that reads and immediately removes. This file never writes to
 *     localStorage, which is why the read is an explicit window property lookup
 *     and the contract test forbids `localStorage.setItem`.
 *   - no Math.random, no innerHTML for server data: every order field is
 *     rendered through textContent so a poisoned product name cannot execute.
 */
(() => {
    const LIST_ENDPOINT = '/api/shop/guest/orders';
    const DETAIL_ENDPOINT = '/api/shop/guest/order';
    const DELIVERY_ENDPOINT = '/api/shop/guest/delivery';
    const LOGIN_ENDPOINT = '/api/shop/guest/access/login';
    const LOGOUT_ENDPOINT = '/api/shop/guest/access/logout';
    // Order Access 2.0 (A3). `reset` spends the admin-issued one-time link
    // (§10.5); `upgrade` is the §13.2 historical-order self-service that turns
    // orderNo + pickup code into email + query-password access. Flat keys like
    // every other guest route: the shared dispatcher has no path parameters.
    const RESET_ENDPOINT = '/api/shop/guest/access/reset';
    const UPGRADE_ENDPOINT = '/api/shop/guest/access/upgrade';
    const ACCESS_AVAILABILITY_ENDPOINT = '/api/shop/guest/access/availability';
    // Legacy (§13.4) historical-order path: order number + one-time pickup code.
    const RECOVER_ENDPOINT = '/api/shop/guest/recover';
    const CLAIM_ENDPOINT = '/api/shop/guest/claim';
    const CREDENTIAL_HEADER = 'X-Guest-Order-Credential';
    const AUTH_STORAGE_KEY = 'guest_order_auth';
    const AUTH_STORAGE_VERSION = 1;
    const PAGE_SIZE = 10;

    const PAYMENT_LABELS = Object.freeze({
        pending: { text: '待支付', tone: 'warn' },
        created: { text: '待支付', tone: 'warn' },
        confirmed: { text: '已支付', tone: 'ok' },
        partial: { text: '部分支付', tone: 'warn' },
        overpaid: { text: '多付待核', tone: 'warn' },
        amount_mismatch: { text: '金额不符', tone: 'danger' },
        expired: { text: '已过期', tone: 'danger' },
        refunded: { text: '已退款', tone: '' },
        chargeback: { text: '已拒付', tone: 'danger' },
        review: { text: '人工核查', tone: 'warn' },
        failed: { text: '支付失败', tone: 'danger' }
    });

    const FULFILLMENT_LABELS = Object.freeze({
        pending: { text: '待发货', tone: '' },
        fulfilling: { text: '发货中', tone: 'warn' },
        delivered: { text: '已发货', tone: 'ok' },
        failed: { text: '发货失败', tone: 'danger' },
        dead_letter: { text: '需人工处理', tone: 'danger' },
        paid_unfulfillable: { text: '库存不足', tone: 'danger' },
        refunded: { text: '已退款', tone: '' }
    });

    const state = {
        auth: null,
        orders: [],
        pagination: null,
        page: 1,
        orderNoFilter: '',
        detail: null,
        busy: false,
        // A3 §10.5: the one-time link token lives in MEMORY ONLY. It is read out
        // of the URL once during init(), the URL parameter is deleted before any
        // request, and it is never written to storage or sent as a query string.
        resetToken: '',
        resetSite: '',
        generatedPassword: '',
        pageAvailable: false,
        availabilityLoading: false,
        baseListenersBound: false,
        orderAccessInitialized: false
    };

    function element(id) {
        return document.getElementById(id);
    }

    function normalizeText(value, maxLength = 500) {
        return String(value ?? '').trim().slice(0, maxLength);
    }

    function normalizeSite(value) {
        const site = normalizeText(value, 10).toLowerCase();
        return site === 'intl' ? 'intl' : 'cn';
    }

    function currentSite() {
        return normalizeSite(window.SiteConfig?.site);
    }

    function setHidden(id, hidden) {
        const node = element(id);
        if (!node) return;
        node.hidden = Boolean(hidden);
        if (hidden) node.setAttribute('aria-hidden', 'true');
        else node.removeAttribute('aria-hidden');
    }

    function setText(id, value) {
        const node = element(id);
        if (node) node.textContent = normalizeText(value, 2000);
    }

    function showError(message) {
        const node = element('guestOrdersError');
        if (!node) return;
        node.textContent = normalizeText(message, 400);
        node.hidden = !message;
    }

    function setOrderAccessPageAvailable(available, message = '') {
        state.pageAvailable = available === true;
        setHidden('guestOrdersFeatureGate', state.pageAvailable);
        setHidden('guestOrdersProtectedContent', !state.pageAvailable);
        setHidden('guestOrdersUpgradeContent', !state.pageAvailable);
        setHidden('guestOrdersFeatureRetryBtn', state.pageAvailable);
        if (!state.pageAvailable) {
            setText('guestOrdersFeatureGateTitle', '邮箱密码查询暂未开放');
            setText(
                'guestOrdersFeatureGateMessage',
                message || '你仍可使用下方的「订单号 + 取货口令」找回历史订单。'
            );
        }
    }

    function setBusy(busy) {
        state.busy = Boolean(busy);
        const button = element('guestOrdersSubmitBtn');
        if (button) button.disabled = state.busy;
        setHidden('guestOrdersLoading', !state.busy);
        if (state.busy) showError('');
    }

    // ------------------------------------------------------------------
    // §7.2 storage ladder
    // ------------------------------------------------------------------
    function getSessionStorage() {
        try {
            return window.sessionStorage;
        } catch (_) {
            return null;
        }
    }

    function isSavedAuth(candidate) {
        return Boolean(candidate
            && candidate.version === AUTH_STORAGE_VERSION
            && normalizeText(candidate.email, 320)
            && typeof candidate.password === 'string'
            && candidate.password.length > 0
            && candidate.password.length <= 64);
    }

    /**
     * One-time migration for a credential an older build left in localStorage.
     * Read + removeItem only: this file must never WRITE there, because
     * localStorage survives across sessions and devices profiles in a way
     * sessionStorage does not, and the saved value is a live order credential.
     */
    function migrateLegacySavedAuth() {
        let store = null;
        try {
            store = window.localStorage;
        } catch (_) {
            return null;
        }
        if (!store) return null;
        try {
            const raw = store.getItem(AUTH_STORAGE_KEY);
            if (raw) store.removeItem(AUTH_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return isSavedAuth(parsed) ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    function persistAuth(auth) {
        state.auth = auth;
        const storage = getSessionStorage();
        if (!storage || !isSavedAuth(auth)) return;
        try {
            storage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
                version: AUTH_STORAGE_VERSION,
                email: auth.email,
                password: auth.password,
                site: auth.site,
                savedAt: new Date().toISOString()
            }));
        } catch (_) {
            // Private mode / quota: memory-only is an accepted degradation.
        }
    }

    function loadSavedAuth() {
        if (isSavedAuth(state.auth)) return state.auth;
        const storage = getSessionStorage();
        if (storage) {
            try {
                const parsed = JSON.parse(storage.getItem(AUTH_STORAGE_KEY) || 'null');
                if (isSavedAuth(parsed)) {
                    state.auth = parsed;
                    return parsed;
                }
                if (parsed) storage.removeItem(AUTH_STORAGE_KEY);
            } catch (_) { /* corrupt entry is treated as absent */ }
        }
        const migrated = migrateLegacySavedAuth();
        if (migrated) {
            persistAuth({ email: migrated.email, password: migrated.password, site: normalizeSite(migrated.site) });
            return state.auth;
        }
        return null;
    }

    function clearSavedAuth() {
        state.auth = null;
        const storage = getSessionStorage();
        if (storage) {
            try { storage.removeItem(AUTH_STORAGE_KEY); } catch (_) { /* ignore */ }
        }
        // The legacy copy is removed on read, but clear it here too so the
        // button is honest even if the migration never ran.
        try {
            const legacy = window.localStorage;
            if (legacy) legacy.removeItem(AUTH_STORAGE_KEY);
        } catch (_) { /* ignore */ }
    }

    function syncSavedHint() {
        const saved = loadSavedAuth();
        setHidden('guestOrdersSavedHint', !saved);
        if (saved) setText('guestOrdersSavedEmail', saved.email);
    }

    // ------------------------------------------------------------------
    // Transport
    // ------------------------------------------------------------------
    /**
     * §7.1. base64url(email_lower + "\n" + password). Built from UTF-8 bytes so
     * a non-ASCII password cannot produce a non-canonical encoding that the
     * server would reject as malformed. Padding is stripped: Node's base64url
     * form has none and the server compares against that exact string.
     */
    function buildCredentialHeader(email, password) {
        const bytes = new TextEncoder().encode(`${normalizeText(email, 320).toLowerCase()}\n${password}`);
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function credentialHeaders() {
        const auth = state.auth;
        if (!auth || !auth.password) return {};
        // The server prefers the session cookie and never even parses this
        // header when the cookie decrypts, so sending both costs nothing and
        // keeps the page working after the 30-minute cookie expires.
        return { [CREDENTIAL_HEADER]: buildCredentialHeader(auth.email, auth.password) };
    }

    async function requestJson(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'same-origin',
            cache: 'no-store',
            ...options,
            headers: {
                Accept: 'application/json',
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...(options.headers || {})
            }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            const error = new Error(normalizeText(payload?.message, 300) || '查询失败，请稍后重试');
            error.code = normalizeText(payload?.code, 100);
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    async function loadOrderAccessAvailability() {
        try {
            const payload = await requestJson(ACCESS_AVAILABILITY_ENDPOINT, { method: 'GET' });
            if (payload?.enabled !== true) throw new Error('guest_order_access_not_enabled');
            setOrderAccessPageAvailable(true);
            return true;
        } catch (_) {
            // A static page can be cached or linked before the matching Verify
            // Server release exists. Keep it visibly unavailable instead of
            // rendering a credential form that only fails after submission.
            setOrderAccessPageAvailable(false);
            return false;
        }
    }

    function describeError(error) {
        const base = error?.message || '查询失败，请稍后重试';
        if (error?.code === 'guest_feature_disabled') {
            return '游客订单查询尚未开放。历史订单可以用下方的「订单号 + 取货口令」找回。';
        }
        if (error?.code === 'guest_order_credentials_invalid') {
            return `${base}。同一邮箱最多保留 3 套互不可见的查询凭证，请使用下单当时设置的那一个。`;
        }
        if (error?.code === 'guest_order_locked') {
            return `${base}。连续输错会临时锁定该邮箱与本机 IP，锁定会在一段时间后自动解除。`;
        }
        if (error?.status === 429) return `${base}。请等待一分钟后再查询。`;
        return base;
    }

    // ------------------------------------------------------------------
    // Formatting / DOM building (no innerHTML for server data)
    // ------------------------------------------------------------------
    function formatAmount(amount) {
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) return '-';
        try {
            return new Intl.NumberFormat('zh-CN', {
                style: 'currency',
                currency: 'CNY',
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(value);
        } catch (_) {
            return `¥${value.toFixed(2)}`;
        }
    }

    function formatTime(value) {
        const parsed = Date.parse(String(value || ''));
        if (!Number.isFinite(parsed)) return '-';
        try {
            return new Date(parsed).toLocaleString('zh-CN', { hour12: false });
        } catch (_) {
            return new Date(parsed).toISOString();
        }
    }

    function createNode(tagName, className, text) {
        const node = document.createElement(tagName);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = normalizeText(text, 2000);
        return node;
    }

    function statusLabel(map, value) {
        const key = normalizeText(value, 40).toLowerCase();
        return map[key] || { text: key || '-', tone: '' };
    }

    function createBadge(map, value) {
        const label = statusLabel(map, value);
        const badge = createNode('span', 'guest-orders-badge', label.text);
        if (label.tone) badge.dataset.tone = label.tone;
        return badge;
    }

    /**
     * §11.2 discount lines. A2 renders the container only; the server sends
     * null until L1/L2 land, and an empty container is display:none, so nothing
     * misleading such as "已优惠 ¥0.00" can ever appear.
     */
    function createDiscountLines(order) {
        const wrap = createNode('div', 'guest-orders-item-discounts');
        const coupon = Number(order?.coupon_discount);
        const promo = Number(order?.promo_discount);
        if (Number.isFinite(coupon) && coupon > 0) {
            wrap.appendChild(createNode('div', 'guest-orders-discount-line', `优惠码已减 ${formatAmount(coupon)}`));
        }
        if (Number.isFinite(promo) && promo > 0) {
            wrap.appendChild(createNode('div', 'guest-orders-discount-line', `活动优惠已减 ${formatAmount(promo)}`));
        }
        return wrap;
    }

    function renderOrders() {
        const list = element('guestOrdersList');
        if (!list) return;
        list.textContent = '';
        const orders = Array.isArray(state.orders) ? state.orders : [];
        setHidden('guestOrdersEmpty', orders.length > 0);
        for (const order of orders) {
            const item = createNode('article', 'guest-orders-item');

            const top = createNode('div', 'guest-orders-item-top');
            const left = createNode('div');
            left.appendChild(createNode('div', 'guest-orders-item-no', order.order_no || '-'));
            left.appendChild(createDiscountLines(order));
            const amount = createNode('div', 'guest-orders-item-amount', formatAmount(order.amount));
            if (Number(order.quantity) > 1) amount.appendChild(createNode('small', '', `× ${Number(order.quantity)}`));
            top.appendChild(left);
            top.appendChild(amount);
            item.appendChild(top);

            const meta = createNode('div', 'guest-orders-item-meta');
            meta.appendChild(createBadge(PAYMENT_LABELS, order.payment_status));
            meta.appendChild(createBadge(FULFILLMENT_LABELS, order.fulfillment_status));
            meta.appendChild(createNode('span', '', `下单时间 ${formatTime(order.created_at)}`));
            item.appendChild(meta);

            const actions = createNode('div', 'guest-orders-item-actions');
            const detailButton = createNode('button', 'guest-orders-secondary-btn', '查看详情');
            detailButton.type = 'button';
            detailButton.addEventListener('click', () => { void openDetail(normalizeText(order.order_no, 200)); });
            actions.appendChild(detailButton);
            if (isDeliverable(order)) {
                const deliveryButton = createNode('button', 'guest-orders-secondary-btn', '查看发货内容');
                deliveryButton.type = 'button';
                deliveryButton.addEventListener('click', () => {
                    void openDetail(normalizeText(order.order_no, 200), { loadDelivery: true });
                });
                actions.appendChild(deliveryButton);
            } else if (normalizeText(order.payment_status).toLowerCase() === 'pending'
                || normalizeText(order.payment_status).toLowerCase() === 'created') {
                actions.appendChild(createNode('span', 'guest-orders-item-no', '未完成支付：请回到商城重新下单'));
            }
            item.appendChild(actions);

            list.appendChild(item);
        }
        renderPagination(orders.length);
    }

    function isDeliverable(order) {
        return normalizeText(order?.payment_status).toLowerCase() === 'confirmed'
            && normalizeText(order?.fulfillment_status).toLowerCase() === 'delivered';
    }

    function renderPagination(count) {
        const pagination = element('guestOrdersPagination');
        const total = Number(state.pagination?.total);
        const pageSize = Number(state.pagination?.page_size) || PAGE_SIZE;
        const page = Number(state.pagination?.page) || 1;
        const totalPages = Number.isFinite(total) && total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
        const show = Boolean(count) && (Number.isFinite(total) ? total > pageSize : false);
        setHidden('guestOrdersPagination', !show);
        if (!show) return;
        setText('guestOrdersPageInfo', `第 ${page} / ${totalPages} 页 · 共 ${total} 单`);
        const prev = element('guestOrdersPrevBtn');
        const next = element('guestOrdersNextBtn');
        if (prev) prev.disabled = page <= 1 || state.busy;
        if (next) next.disabled = page >= totalPages || state.busy;
    }

    function renderDetail() {
        const detail = state.detail;
        setHidden('guestOrdersDetail', !detail);
        setHidden('guestOrdersList', Boolean(detail));
        setHidden('guestOrdersEmpty', Boolean(detail));
        setHidden('guestOrdersPagination', Boolean(detail));
        setHidden('guestOrdersBackToListBtn', !detail);
        const rows = element('guestOrdersDetailRows');
        if (!rows || !detail) return;
        rows.textContent = '';
        const fields = [
            ['订单号', detail.order_no || '-', true],
            ['金额', formatAmount(detail.amount), false],
            ['数量', String(Number(detail.quantity) || 1), false],
            ['支付状态', statusLabel(PAYMENT_LABELS, detail.payment_status).text, false],
            ['发货状态', statusLabel(FULFILLMENT_LABELS, detail.fulfillment_status).text, false],
            ['下单时间', formatTime(detail.created_at), false],
            ['支付截止', formatTime(detail.expires_at), false]
        ];
        if (normalizeText(detail.refund_status) && normalizeText(detail.refund_status) !== 'none') {
            fields.splice(5, 0, ['退款状态', normalizeText(detail.refund_status, 40), false]);
        }
        for (const [label, value, mono] of fields) {
            const row = document.createElement('div');
            row.appendChild(createNode('dt', '', label));
            row.appendChild(createNode('dd', mono ? 'is-mono' : '', value));
            rows.appendChild(row);
        }

        const deliverable = isDeliverable(detail);
        setHidden('guestOrdersLoadDeliveryBtn', !deliverable);
        setHidden('guestOrdersDeliveryPanel', true);
        setText('guestOrdersDeliveryContent', '');
        const hint = element('guestOrdersDeliveryHint');
        if (hint) {
            hint.textContent = deliverable
                ? ''
                : '订单完成支付并发货后，这里会显示卡密内容。当前状态不会展示发货内容。';
            hint.hidden = deliverable;
        }
    }

    // ------------------------------------------------------------------
    // Queries
    // ------------------------------------------------------------------
    function buildQuery(params) {
        const search = new URLSearchParams({ site: currentSite() });
        for (const [key, value] of Object.entries(params)) {
            if (value === undefined || value === null || value === '') continue;
            search.set(key, String(value));
        }
        return search.toString();
    }

    async function login(email, password) {
        // Explicit login first (§12): it re-validates the credential, refreshes
        // the 30-minute session cookie, and is the only place a lockout or a
        // wrong password produces an actionable message.
        const payload = await requestJson(LOGIN_ENDPOINT, {
            method: 'POST',
            body: JSON.stringify({ email, password, site: currentSite() })
        });
        persistAuth({
            email: normalizeText(payload?.email || email, 320).toLowerCase(),
            password,
            site: currentSite()
        });
        syncSavedHint();
    }

    async function loadOrders(page = 1) {
        const payload = await requestJson(
            `${LIST_ENDPOINT}?${buildQuery({ page, pageSize: PAGE_SIZE, order_no: state.orderNoFilter })}`,
            { headers: credentialHeaders() }
        );
        state.orders = Array.isArray(payload?.orders) ? payload.orders : [];
        state.pagination = payload?.pagination || null;
        state.page = Number(state.pagination?.page) || page;
        state.detail = null;
        setHidden('guestOrdersResultCard', false);
        renderDetail();
        renderOrders();
    }

    async function openDetail(orderNo, { loadDelivery = false } = {}) {
        if (!orderNo || state.busy) return;
        setBusy(true);
        try {
            const payload = await requestJson(
                `${DETAIL_ENDPOINT}?${buildQuery({ order_no: orderNo })}`,
                { headers: credentialHeaders() }
            );
            state.detail = payload?.order || null;
            setHidden('guestOrdersResultCard', false);
            renderDetail();
            syncDetailUrl(orderNo);
            if (loadDelivery) await showDelivery(orderNo);
        } catch (error) {
            showError(describeError(error));
        } finally {
            setBusy(false);
        }
    }

    async function showDelivery(orderNo) {
        const button = element('guestOrdersLoadDeliveryBtn');
        if (button) button.disabled = true;
        try {
            const payload = await requestJson(
                `${DELIVERY_ENDPOINT}?${buildQuery({ order_no: orderNo })}`,
                { headers: credentialHeaders() }
            );
            setText('guestOrdersDeliveryContent', payload?.content || '');
            setHidden('guestOrdersDeliveryPanel', false);
            setHidden('guestOrdersLoadDeliveryBtn', true);
        } catch (error) {
            showError(describeError(error));
        } finally {
            if (button) button.disabled = false;
        }
    }

    /** Keep the address bar shareable but never put a credential in it. */
    function syncDetailUrl(orderNo) {
        try {
            const url = new URL(window.location.href);
            if (orderNo) url.searchParams.set('order_no', orderNo);
            else url.searchParams.delete('order_no');
            window.history.replaceState({}, '', url.toString());
        } catch (_) { /* file:// or a locked-down history API */ }
    }

    function readUrlOrderNo() {
        try {
            return normalizeText(new URL(window.location.href).searchParams.get('order_no'), 200);
        } catch (_) {
            return '';
        }
    }

    function readForm() {
        const emailInput = element('guestOrdersEmail');
        const passwordInput = element('guestOrdersPassword');
        const module = globalThis.GuestQueryPassword || null;
        const rawEmail = normalizeText(emailInput?.value, 320);
        const rawPassword = String(passwordInput?.value ?? '');
        // §6.1.2: fold fullwidth so a Chinese IME cannot turn a working
        // credential into a 403, and echo the folded value back to the buyer.
        const password = module ? module.foldFullwidth(rawPassword).slice(0, 64) : rawPassword.slice(0, 64);
        if (module && password !== rawPassword && passwordInput) passwordInput.value = password;
        return {
            email: rawEmail.toLowerCase(),
            password,
            orderNo: normalizeText(element('guestOrdersOrderNo')?.value, 200)
        };
    }

    async function handleSubmit(event) {
        if (event) event.preventDefault();
        if (state.busy) return;
        const form = readForm();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(form.email)) {
            showError('请输入正确的邮箱地址');
            return;
        }
        if (!form.password) {
            showError('请输入查询密码');
            return;
        }
        setBusy(true);
        try {
            await login(form.email, form.password);
            state.orderNoFilter = form.orderNo;
            if (state.orderNoFilter) {
                await openDetail(state.orderNoFilter);
            } else {
                await loadOrders(1);
            }
            showError('');
        } catch (error) {
            setHidden('guestOrdersResultCard', true);
            showError(describeError(error));
        } finally {
            setBusy(false);
        }
    }

    async function handleClearSaved() {
        clearSavedAuth();
        syncSavedHint();
        const passwordInput = element('guestOrdersPassword');
        if (passwordInput) passwordInput.value = '';
        state.orders = [];
        state.detail = null;
        state.pagination = null;
        state.orderNoFilter = '';
        setHidden('guestOrdersResultCard', true);
        syncDetailUrl('');
        try {
            // Best effort: dropping the local copy is what matters, the server
            // cookie expires on its own and logout is never switch-gated.
            await requestJson(LOGOUT_ENDPOINT, { method: 'POST', body: JSON.stringify({ site: currentSite() }) });
        } catch (_) { /* ignore */ }
        showError('');
    }

    /**
     * Shared by the lookup field and the two A3 credential forms. `inputId` and
     * `label` default to the lookup field so the original call site is unchanged.
     */
    function togglePasswordVisibility(button, inputId = 'guestOrdersPassword', label = '查询密码') {
        const input = element(inputId);
        if (!input || !button) return;
        const wasRevealed = input.type === 'text';
        input.type = wasRevealed ? 'password' : 'text';
        button.setAttribute('aria-pressed', wasRevealed ? 'false' : 'true');
        button.title = wasRevealed ? '显示密码' : '隐藏密码';
        button.setAttribute('aria-label', wasRevealed ? `显示${label}` : `隐藏${label}`);
        const icon = button.querySelector('i');
        if (icon) icon.className = wasRevealed ? 'fas fa-eye' : 'fas fa-eye-slash';
    }

    // ------------------------------------------------------------------
    // Order Access 2.0 (A3) — §10.5 one-time reset link
    // ------------------------------------------------------------------

    /**
     * Read the one-time token out of the address bar and DELETE the parameter
     * before anything else happens.
     *
     * The token is a BEARER credential: anyone holding it plus the buyer's email
     * can set a new query password. Left in the URL it would survive in browser
     * history, in the Referer header of every later navigation, in any support
     * screenshot the buyer takes, and in the server access log. Deleting it on
     * arrival shrinks that window to one page load, and keeping it in `state`
     * (memory only) is what §7.2's storage ladder already requires for the
     * password itself.
     */
    function consumeUrlResetToken() {
        try {
            const url = new URL(window.location.href);
            const token = normalizeText(url.searchParams.get('reset'), 200);
            const site = normalizeSite(url.searchParams.get('site'));
            if (!token) return { token: '', site: '' };
            url.searchParams.delete('reset');
            url.searchParams.delete('site');
            window.history.replaceState({}, '', url.toString());
            state.resetToken = token;
            state.resetSite = site;
            return { token, site };
        } catch (_) {
            return { token: '', site: '' };
        }
    }

    const POLICY_MESSAGES = Object.freeze({
        P1: '请填写查询密码（至少 8 位）',
        P2: '查询密码必须同时包含大写字母、小写字母、数字和标点',
        P7: '查询密码过于简单，请点击「帮我生成一个强密码」重新设置',
        P9: '查询密码不能有太长的重复字符，请点击「帮我生成一个强密码」',
        P10: '查询密码用到的字符种类太少，请点击「帮我生成一个强密码」'
    });

    function policyMessage(failure) {
        if (!failure) return '';
        const rule = String(failure.rule || '');
        if (POLICY_MESSAGES[rule]) return POLICY_MESSAGES[rule];
        if (rule.startsWith('P2')) return POLICY_MESSAGES.P2;
        if (rule.startsWith('P7')) return POLICY_MESSAGES.P7;
        return '查询密码强度不足，请点击「帮我生成一个强密码」重新设置';
    }

    /**
     * §6.1.2: fold fullwidth characters before comparing or sending, so a Chinese
     * IME cannot turn a working credential into a 403. The folded value is echoed
     * back into the field so what the buyer sees is what was sent.
     */
    function foldPassword(input) {
        if (!input) return '';
        const module = globalThis.GuestQueryPassword || null;
        const raw = String(input.value ?? '');
        const folded = module ? module.foldFullwidth(raw).slice(0, 64) : raw.slice(0, 64);
        if (folded !== raw) input.value = folded;
        return folded;
    }

    /**
     * Advisory mirror of the server's K26 rules. The server re-checks everything;
     * without the shared module loaded we send the password anyway rather than
     * blocking the buyer on a missing script.
     */
    function localPolicyFailure(rawPassword) {
        const value = String(rawPassword ?? '');
        if (!value) return { rule: 'P1', reason: 'missing' };
        const module = globalThis.GuestQueryPassword || null;
        return module ? module.policyFailure(value) : null;
    }

    /**
     * Render the inline policy line and report whether the form may submit.
     * `confirmValue === undefined` means the form has no confirm field.
     */
    function syncPolicyLine(nodeId, password, confirmValue) {
        const node = element(nodeId);
        const failure = localPolicyFailure(password);
        const mismatch = confirmValue !== undefined && confirmValue !== password;
        if (!password && !mismatch) {
            if (node) { node.hidden = true; node.textContent = ''; node.removeAttribute('data-tone'); }
            return false;
        }
        const ok = !failure && !mismatch;
        if (node) {
            node.hidden = false;
            if (ok) {
                node.dataset.tone = 'ok';
                node.textContent = '密码强度符合要求';
            } else {
                node.dataset.tone = 'danger';
                node.textContent = failure ? policyMessage(failure) : '两次输入的查询密码不一致';
            }
        }
        return ok;
    }

    function showFormMessage(nodeId, message, tone) {
        const node = element(nodeId);
        if (!node) return;
        if (!message) {
            node.hidden = true;
            node.textContent = '';
            node.removeAttribute('data-tone');
            return;
        }
        node.hidden = false;
        if (tone) node.dataset.tone = tone;
        else node.removeAttribute('data-tone');
        node.textContent = normalizeText(message, 400);
    }

    /**
     * Mint a K26-compliant password and copy it to the clipboard. Both new
     * credential forms get one because K26 (upper + lower + digit + punctuation,
     * no weak pattern) is genuinely hard to satisfy by hand, and a buyer who
     * cannot get past the local check never reaches their order.
     */
    async function generateIntoFields(button, passwordId, confirmId, noteId) {
        const module = globalThis.GuestQueryPassword || null;
        const input = element(passwordId);
        if (!module || !input) return;
        try {
            const generated = module.generate();
            input.value = generated;
            const confirm = element(confirmId);
            if (confirm) confirm.value = generated;
            state.generatedPassword = generated;
            syncPolicyLine(noteId, generated, generated);
            await copyGeneratedPassword(button, generated);
        } catch (error) {
            showFormMessage(noteId, normalizeText(error?.message, 200) || '无法生成查询密码，请手动设置一个', 'danger');
        }
    }

    async function copyGeneratedPassword(button, generated) {
        try {
            await navigator.clipboard.writeText(generated);
            const original = button ? button.textContent : '';
            if (button) button.textContent = '已生成并复制到剪贴板';
            window.setTimeout(() => { if (button) button.textContent = original; }, 2200);
        } catch (_) {
            showFormMessage('guestOrdersResetPolicy',
                '已生成查询密码，但当前浏览器不允许自动复制，请手动选择并妥善保存。', 'danger');
        }
    }

    function activateResetCard(token, site) {
        state.resetToken = token;
        state.resetSite = site || currentSite();
        const card = element('guestOrdersResetCard');
        if (!card) return;
        card.hidden = false;
        card.removeAttribute('aria-hidden');
        // The link IS the buyer's intent, so it takes the page: leaving the
        // lookup form on top would invite them to type the password the link is
        // about to replace, and every such attempt is a wasted login-budget hit.
        setHidden('guestOrdersQueryCard', true);
        setHidden('guestOrdersResultCard', true);
        const emailInput = element('guestOrdersResetEmail');
        if (emailInput) emailInput.focus();
        try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) { /* older browsers */ }
    }

    /**
     * After a successful reset/upgrade the buyer is already signed in (the
     * endpoint set the session cookie), so hand the page back to the normal
     * lookup flow with the new credential pre-filled and the list loaded.
     */
    async function finishCredentialSetup(email, password, site) {
        persistAuth({ email, password, site });
        syncSavedHint();
        setHidden('guestOrdersResetCard', true);
        setHidden('guestOrdersQueryCard', false);
        const emailInput = element('guestOrdersEmail');
        const passwordInput = element('guestOrdersPassword');
        if (emailInput) emailInput.value = email;
        if (passwordInput) passwordInput.value = password;
        state.orderNoFilter = '';
        syncDetailUrl('');
        await loadOrders(1);
    }

    function describeCredentialError(error) {
        const base = describeError(error);
        if (error?.code === 'guest_reset_invalid') {
            return '找回链接无效或已过期。链接有效期 15 分钟且只能使用一次，请联系客服重新签发。';
        }
        if (error?.code === 'guest_claim_invalid') {
            return '订单号或取货口令不正确，请核对后重试。连续输错会临时锁定该订单。';
        }
        if (error?.code === 'guest_buyer_credential_conflict') {
            return '该邮箱的查询凭证已达上限（同一邮箱最多 3 套）。请换一个邮箱，或联系客服处理。';
        }
        if (error?.code === 'guest_order_already_bound') {
            return '该订单已经绑定过另一个查询凭证，无法在这里合并。请联系客服处理。';
        }
        if (error?.code === 'guest_password_weak' || error?.status === 400) {
            return base;
        }
        return base;
    }

    async function handleResetSubmit(event) {
        if (event) event.preventDefault();
        if (state.busy) return;
        const token = state.resetToken;
        const policyId = 'guestOrdersResetPolicy';
        if (!token) {
            showFormMessage(policyId, '找回链接已失效，请联系客服重新签发。', 'danger');
            return;
        }
        const email = normalizeText(element('guestOrdersResetEmail')?.value, 320).toLowerCase();
        const password = foldPassword(element('guestOrdersResetPassword'));
        const confirm = foldPassword(element('guestOrdersResetPasswordConfirm'));
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
            showFormMessage(policyId, '请输入正确的邮箱地址', 'danger');
            return;
        }
        if (!syncPolicyLine(policyId, password, confirm)) return;

        const button = element('guestOrdersResetSubmitBtn');
        state.busy = true;
        if (button) { button.disabled = true; button.dataset.label = button.textContent; button.textContent = '正在设置...'; }
        try {
            const payload = await requestJson(RESET_ENDPOINT, {
                method: 'POST',
                body: JSON.stringify({ token, email, password, site: state.resetSite || currentSite() })
            });
            // Spent either way from here on: the server consumed it atomically.
            state.resetToken = '';
            if (payload?.authenticated === false || payload?.session_required === true) {
                // The password changed but the convenience session could not be
                // minted. Say exactly that instead of pretending it failed.
                showFormMessage(policyId, '查询密码已设置成功，请用下方表单登录查看订单。', 'ok');
                setHidden('guestOrdersResetCard', true);
                setHidden('guestOrdersQueryCard', false);
                const emailInput = element('guestOrdersEmail');
                const passwordInput = element('guestOrdersPassword');
                if (emailInput) emailInput.value = email;
                if (passwordInput) passwordInput.value = password;
                showError('');
                return;
            }
            showError('');
            await finishCredentialSetup(email, password, state.resetSite || currentSite());
        } catch (error) {
            // A spent/invalid link must not stay retryable — every retry is
            // another row in the access-attempt log and another confused buyer.
            // Anything else (network, 429, 503) keeps the token so a retry works.
            if (error?.code === 'guest_reset_invalid') state.resetToken = '';
            showFormMessage(policyId, describeCredentialError(error), 'danger');
        } finally {
            state.busy = false;
            if (button) {
                button.disabled = !state.resetToken;
                if (button.dataset.label) button.textContent = button.dataset.label;
            }
        }
    }

    // ------------------------------------------------------------------
    // Order Access 2.0 (A3) — §13.2 historical-order self-upgrade
    // ------------------------------------------------------------------

    /**
     * Same two legacy factors as the recover button above, spent once to attach a
     * query password to the order. The server takes the site from the ORDER, so
     * the site sent here is only a hint and cannot move the credential group.
     */
    async function handleUpgradeSubmit() {
        if (state.busy) return;
        const policyId = 'guestOrdersUpgradePolicy';
        const resultId = 'guestOrdersUpgradeResult';
        const orderNo = normalizeText(element('guestOrdersLegacyOrderNo')?.value, 200);
        const recoveryCode = normalizeText(element('guestOrdersLegacyCode')?.value, 200);
        const email = normalizeText(element('guestOrdersUpgradeEmail')?.value, 320).toLowerCase();
        const password = foldPassword(element('guestOrdersUpgradePassword'));
        const confirm = foldPassword(element('guestOrdersUpgradePasswordConfirm'));

        if (!orderNo || !recoveryCode) {
            showFormMessage(resultId, '请先在上方填写订单号和取货口令', 'danger');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
            showFormMessage(resultId, '', '');
            showFormMessage(policyId, '请输入正确的邮箱地址', 'danger');
            return;
        }
        if (!syncPolicyLine(policyId, password, confirm)) return;
        showFormMessage(resultId, '', '');

        const button = element('guestOrdersUpgradeBtn');
        state.busy = true;
        if (button) { button.disabled = true; button.dataset.label = button.textContent; button.textContent = '正在设置...'; }
        try {
            const payload = await requestJson(UPGRADE_ENDPOINT, {
                method: 'POST',
                body: JSON.stringify({ orderNo, recoveryCode, email, password, site: currentSite() })
            });
            const alreadyBound = payload?.already_bound === true;
            showError('');
            await finishCredentialSetup(email, password, normalizeSite(payload?.site) || currentSite());
            showFormMessage(resultId, alreadyBound
                ? `订单 ${normalizeText(payload?.order_no || orderNo, 200)} 之前已设置过查询密码，已为你直接登录。`
                : `已为订单 ${normalizeText(payload?.order_no || orderNo, 200)} 设置查询密码，以后用邮箱 + 查询密码即可查询。`,
            'ok');
            // The pickup code has done its job; clearing it removes the only
            // copy of a one-time secret from a page the buyer may leave open.
            const codeInput = element('guestOrdersLegacyCode');
            if (codeInput) codeInput.value = '';
            const passwordInput = element('guestOrdersUpgradePassword');
            const confirmInput = element('guestOrdersUpgradePasswordConfirm');
            if (passwordInput) passwordInput.value = '';
            if (confirmInput) confirmInput.value = '';
            syncPolicyLine(policyId, '', undefined);
        } catch (error) {
            showFormMessage(resultId, describeCredentialError(error), 'danger');
        } finally {
            state.busy = false;
            if (button) {
                button.disabled = false;
                if (button.dataset.label) button.textContent = button.dataset.label;
            }
        }
    }

    // ------------------------------------------------------------------
    // Legacy path (§13.4): order number + one-time pickup code
    // ------------------------------------------------------------------
    async function handleLegacyRecover() {
        const button = element('guestOrdersLegacyBtn');
        const result = element('guestOrdersLegacyResult');
        const orderNo = normalizeText(element('guestOrdersLegacyOrderNo')?.value, 200);
        const recoveryCode = normalizeText(element('guestOrdersLegacyCode')?.value, 200);
        if (result) { result.hidden = false; result.dataset.tone = ''; }
        if (!orderNo || !recoveryCode) {
            if (result) { result.textContent = '请输入订单号和取货口令'; result.dataset.tone = 'danger'; }
            return;
        }
        if (button) button.disabled = true;
        try {
            const payload = await requestJson(RECOVER_ENDPOINT, {
                method: 'POST',
                body: JSON.stringify({ orderNo, recoveryCode })
            });
            const order = payload?.order || {};
            if (result) {
                result.dataset.tone = 'ok';
                result.textContent = `已找回订单 ${normalizeText(order.order_no || orderNo, 200)}`
                    + `（${statusLabel(PAYMENT_LABELS, order.payment_status).text}`
                    + ` / ${statusLabel(FULFILLMENT_LABELS, order.fulfillment_status).text}）。`;
                if (isDeliverable(order)) appendLegacyClaimButton(result, normalizeText(order.order_no || orderNo, 200));
                else if (payload?.checkout) {
                    result.textContent += ' 该订单仍未完成支付，请回到商城页面继续支付。';
                }
            }
        } catch (error) {
            if (result) {
                result.dataset.tone = 'danger';
                result.textContent = describeError(error);
            }
        } finally {
            if (button) button.disabled = false;
        }
    }

    /**
     * The recover response sets the same HttpOnly proof cookie the shop modal
     * uses, so the legacy claim endpoint can be called straight from here
     * without this page ever seeing the pickup code again.
     */
    function appendLegacyClaimButton(container, orderNo) {
        const existing = container.querySelector('[data-legacy-claim]');
        if (existing) existing.remove();
        const button = createNode('button', 'guest-orders-secondary-btn', '查看发货内容');
        button.type = 'button';
        button.dataset.legacyClaim = '1';
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                const payload = await requestJson(CLAIM_ENDPOINT, {
                    method: 'POST',
                    body: JSON.stringify({ orderNo })
                });
                const pre = createNode('pre', 'guest-orders-delivery-content');
                pre.textContent = normalizeText(payload?.content || '', 20000);
                container.appendChild(pre);
                button.remove();
            } catch (error) {
                container.appendChild(createNode('div', 'guest-orders-legacy-result', describeError(error)));
                button.disabled = false;
            }
        });
        container.appendChild(button);
    }

    function toggleLegacyPanel() {
        const button = element('guestOrdersLegacyToggleBtn');
        const panel = element('guestOrdersLegacyPanel');
        if (!button || !panel) return;
        const expanded = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        panel.hidden = expanded;
    }

    // ------------------------------------------------------------------
    function bindBaseListeners() {
        if (state.baseListenersBound) return;
        state.baseListenersBound = true;
        // Legacy recovery predates the email/password feature switch. Bind it
        // before probing that switch so an unavailable or older Verify release
        // cannot strand buyers who still hold an order number + pickup code.
        element('guestOrdersLegacyToggleBtn')?.addEventListener('click', toggleLegacyPanel);
        element('guestOrdersLegacyBtn')?.addEventListener('click', () => { void handleLegacyRecover(); });
        element('guestOrdersFeatureRetryBtn')?.addEventListener('click', () => {
            void initializeOrderAccessPage();
        });
    }

    function initializeOrderAccessFeatures() {
        if (state.orderAccessInitialized) return;
        state.orderAccessInitialized = true;
        syncSavedHint();
        const saved = loadSavedAuth();
        if (saved) {
            const emailInput = element('guestOrdersEmail');
            const passwordInput = element('guestOrdersPassword');
            if (emailInput && !emailInput.value) emailInput.value = saved.email;
            if (passwordInput && !passwordInput.value) passwordInput.value = saved.password;
        }
        element('guestOrdersQueryForm')?.addEventListener('submit', handleSubmit);
        element('guestOrdersClearSavedBtn')?.addEventListener('click', () => { void handleClearSaved(); });
        element('guestOrdersTogglePasswordBtn')?.addEventListener('click', (event) => {
            togglePasswordVisibility(event.currentTarget);
        });
        element('guestOrdersBackToListBtn')?.addEventListener('click', () => {
            state.detail = null;
            syncDetailUrl('');
            renderDetail();
            renderOrders();
        });
        element('guestOrdersPrevBtn')?.addEventListener('click', () => {
            if (state.page > 1) void loadOrders(state.page - 1);
        });
        element('guestOrdersNextBtn')?.addEventListener('click', () => { void loadOrders(state.page + 1); });
        element('guestOrdersLoadDeliveryBtn')?.addEventListener('click', () => {
            const orderNo = normalizeText(state.detail?.order_no, 200);
            if (orderNo) void showDelivery(orderNo);
        });
        element('guestOrdersCopyDeliveryBtn')?.addEventListener('click', async (event) => {
            const button = event.currentTarget;
            const text = element('guestOrdersDeliveryContent')?.textContent || '';
            if (!text) return;
            try {
                await navigator.clipboard.writeText(text);
                const original = button.textContent;
                button.textContent = '已复制';
                window.setTimeout(() => { button.textContent = original; }, 1600);
            } catch (_) {
                showError('当前浏览器不允许自动复制，请手动选择内容复制');
            }
        });
        // --- A3 §10.5 one-time reset link ---------------------------------
        element('guestOrdersResetForm')?.addEventListener('submit', handleResetSubmit);
        element('guestOrdersResetToggleBtn')?.addEventListener('click', (event) => {
            togglePasswordVisibility(event.currentTarget, 'guestOrdersResetPassword', '新查询密码');
        });
        element('guestOrdersResetGenerateBtn')?.addEventListener('click', (event) => {
            void generateIntoFields(event.currentTarget, 'guestOrdersResetPassword',
                'guestOrdersResetPasswordConfirm', 'guestOrdersResetPolicy');
        });
        for (const id of ['guestOrdersResetPassword', 'guestOrdersResetPasswordConfirm']) {
            element(id)?.addEventListener('input', () => {
                syncPolicyLine('guestOrdersResetPolicy',
                    foldPassword(element('guestOrdersResetPassword')),
                    foldPassword(element('guestOrdersResetPasswordConfirm')));
            });
        }

        // --- A3 §13.2 historical-order self-upgrade ------------------------
        element('guestOrdersUpgradeBtn')?.addEventListener('click', () => { void handleUpgradeSubmit(); });
        element('guestOrdersUpgradeToggleBtn')?.addEventListener('click', (event) => {
            togglePasswordVisibility(event.currentTarget, 'guestOrdersUpgradePassword', '查询密码');
        });
        element('guestOrdersUpgradeGenerateBtn')?.addEventListener('click', (event) => {
            void generateIntoFields(event.currentTarget, 'guestOrdersUpgradePassword',
                'guestOrdersUpgradePasswordConfirm', 'guestOrdersUpgradePolicy');
        });
        for (const id of ['guestOrdersUpgradePassword', 'guestOrdersUpgradePasswordConfirm']) {
            element(id)?.addEventListener('input', () => {
                syncPolicyLine('guestOrdersUpgradePolicy',
                    foldPassword(element('guestOrdersUpgradePassword')),
                    foldPassword(element('guestOrdersUpgradePasswordConfirm')));
            });
        }

        // An arriving support link outranks a saved credential and a ?order_no=
        // deep link: the buyer came to SET a password, not to reuse one. The
        // token was moved into memory immediately after its URL was scrubbed, so
        // this still works after one or more failed availability probes.
        if (state.resetToken) activateResetCard(state.resetToken, state.resetSite);
        const deepLinkOrderNo = state.resetToken ? '' : readUrlOrderNo();
        if (deepLinkOrderNo) {
            const orderNoInput = element('guestOrdersOrderNo');
            if (orderNoInput) orderNoInput.value = deepLinkOrderNo;
            // A deep link is explicit intent, so run the query immediately when
            // a credential is already saved; otherwise wait for the buyer.
            if (saved) void handleSubmit(null);
        }
    }

    async function initializeOrderAccessPage() {
        if (state.orderAccessInitialized || state.availabilityLoading) return;
        state.availabilityLoading = true;
        const retryButton = element('guestOrdersFeatureRetryBtn');
        if (retryButton) retryButton.disabled = true;
        try {
            // The static document is deliberately shipped with its credential
            // forms hidden. Only the matching runtime switch may reveal them; an
            // old static asset paired with a rolled-back API therefore stays
            // controlled instead of accepting a password and failing on submit.
            if (!(await loadOrderAccessAvailability())) return;
            initializeOrderAccessFeatures();
        } finally {
            state.availabilityLoading = false;
            if (retryButton) retryButton.disabled = false;
        }
    }

    async function init() {
        // FIRST, before any request or rendering: scrub the one-time bearer from
        // the address bar and retain it only in memory for a possible retry.
        consumeUrlResetToken();
        bindBaseListeners();
        await initializeOrderAccessPage();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void init(); }, { once: true });
    else void init();
})();
