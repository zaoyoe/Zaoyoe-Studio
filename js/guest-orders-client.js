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
        busy: false
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

    function togglePasswordVisibility(button) {
        const input = element('guestOrdersPassword');
        if (!input || !button) return;
        const wasRevealed = input.type === 'text';
        input.type = wasRevealed ? 'password' : 'text';
        button.setAttribute('aria-pressed', wasRevealed ? 'false' : 'true');
        button.title = wasRevealed ? '显示密码' : '隐藏密码';
        button.setAttribute('aria-label', wasRevealed ? '显示查询密码' : '隐藏查询密码');
        const icon = button.querySelector('i');
        if (icon) icon.className = wasRevealed ? 'fas fa-eye' : 'fas fa-eye-slash';
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
    function init() {
        syncSavedHint();
        const saved = loadSavedAuth();
        if (saved) {
            const emailInput = element('guestOrdersEmail');
            const passwordInput = element('guestOrdersPassword');
            if (emailInput && !emailInput.value) emailInput.value = saved.email;
            if (passwordInput && !passwordInput.value) passwordInput.value = saved.password;
        }
        const deepLinkOrderNo = readUrlOrderNo();
        if (deepLinkOrderNo) {
            const orderNoInput = element('guestOrdersOrderNo');
            if (orderNoInput) orderNoInput.value = deepLinkOrderNo;
            // A deep link is explicit intent, so run the query immediately when
            // a credential is already saved; otherwise wait for the buyer.
            if (saved) void handleSubmit(null);
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
        element('guestOrdersLegacyToggleBtn')?.addEventListener('click', toggleLegacyPanel);
        element('guestOrdersLegacyBtn')?.addEventListener('click', () => { void handleLegacyRecover(); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
