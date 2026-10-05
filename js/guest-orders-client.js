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
 *   - §7.2 storage ladder is scoped to the current page: the live credential
 *     stays in memory while the page is open, and any sessionStorage/legacy
 *     localStorage copy is removed at fresh initialization instead of being
 *     restored into the query form. This file never writes to localStorage.
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
    // (§10.5). Flat keys like every other guest route: the shared dispatcher has
    // no path parameters.
    const RESET_ENDPOINT = '/api/shop/guest/access/reset';
    const ACCESS_AVAILABILITY_ENDPOINT = '/api/shop/guest/access/availability';
    const CREDENTIAL_HEADER = 'X-Guest-Order-Credential';
    const AUTH_STORAGE_KEY = 'guest_order_auth';
    const AUTH_STORAGE_VERSION = 1;
    const PAGE_SIZE = 10;

    const PAYMENT_LABELS = Object.freeze({
        pending: { text: '待支付', tone: 'warn' },
        created: { text: '待支付', tone: 'warn' },
        confirmed: { text: '已完成', tone: 'ok' },
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
        // Monotonic list request token prevents a slower, older response from
        // replacing the newest credential result or a detail view.
        ordersRequestSerial: 0,
        detailRequestSerial: 0,
        deliveryRequestSerial: 0,
        detail: null,
        delivery: null,
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

    function togglePasswordVisibility(button, inputId = 'guestOrdersPassword', label = '查询密码') {
        const target = element(inputId);
        if (!target || !button) return;
        const visible = target.type === 'text';
        target.type = visible ? 'password' : 'text';
        button.setAttribute('aria-pressed', String(!visible));
        button.setAttribute('aria-label', `${visible ? '显示' : '隐藏'}${label}`);
        button.title = `${visible ? '显示' : '隐藏'}${label}`;
        const icon = button.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-eye', visible);
            icon.classList.toggle('fa-eye-slash', !visible);
        }
        // Keep focus on the toggle; refocusing the input causes its focus border to repaint.
    }

    function showError(message) {
        const node = element('guestOrdersError');
        if (!node) return;
        node.textContent = normalizeText(message, 400);
        node.hidden = !message;
    }

    function setOrderAccessPageAvailable(available, message = '') {
        state.pageAvailable = available === true;
        setHidden('guestOrdersProtectedContent', !state.pageAvailable);
        setHidden('guestOrdersFeatureGate', state.pageAvailable);
        setHidden('guestOrdersFeatureRetryBtn', state.pageAvailable);
        if (!state.pageAvailable) {
            // Keep every protected/reset surface closed while availability is
            // unknown or unavailable. This also preserves a reset token in
            // memory without exposing the reset form before a successful retry.
            setHidden('guestOrdersResetCard', true);
            setText('guestOrdersFeatureGateMessage', message || '查询服务暂不可用，请稍后重试。');
        }
    }

    function setBusy(busy) {
        state.busy = Boolean(busy);
        const button = element('guestOrdersSubmitBtn');
        if (button) {
            button.disabled = state.busy;
            button.classList.toggle('is-loading', state.busy);
            button.setAttribute('aria-busy', state.busy ? 'true' : 'false');
        }
        setHidden('guestOrdersLoading', true);
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
            setOrderAccessPageAvailable(false, '查询服务暂不可用，请稍后重试。');
            return false;
        }
    }

    function describeError(error) {
        const base = error?.message || '查询失败，请稍后重试';
        if (error?.code === 'guest_feature_disabled') {
            return '游客订单查询尚未开放，请稍后重试或联系客服。';
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

    const orderDetailsCache = new Map();
    let catalogProductsMap = new Map();
    let catalogLoadingPromise = null;

    function isShopImageSource(url) {
        if (!url || typeof url !== 'string') return false;
        const trimmed = url.trim();
        return trimmed.startsWith('http://')
            || trimmed.startsWith('https://')
            || trimmed.startsWith('/')
            || trimmed.startsWith('./')
            || trimmed.startsWith('data:image/');
    }

    function escapeCssSelector(str) {
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
            return CSS.escape(str);
        }
        return String(str || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }

    async function loadShopCatalog() {
        if (catalogProductsMap.size > 0) return catalogProductsMap;
        if (catalogLoadingPromise) return catalogLoadingPromise;
        catalogLoadingPromise = (async () => {
            try {
                const site = currentSite();
                const response = await fetch(`/api/shop/catalog?site=${encodeURIComponent(site)}`, {
                    method: 'GET',
                    credentials: 'same-origin',
                    headers: { Accept: 'application/json' }
                });
                const payload = await response.json().catch(() => ({}));
                const products = Array.isArray(payload?.products)
                    ? payload.products
                    : (Array.isArray(payload?.data?.products) ? payload.data.products : []);
                for (const product of products) {
                    if (product?.id) {
                        catalogProductsMap.set(String(product.id).trim(), product);
                    }
                    if (product?.name) {
                        catalogProductsMap.set(String(product.name).trim(), product);
                    }
                }
            } catch (_) {}
            return catalogProductsMap;
        })();
        return catalogLoadingPromise;
    }

    async function fetchOrderDetailForList(orderNo) {
        const key = normalizeText(orderNo, 200);
        if (!key) return null;
        if (orderDetailsCache.has(key)) return orderDetailsCache.get(key);
        try {
            const payload = await requestJson(
                `${DETAIL_ENDPOINT}?${buildQuery({ order_no: key })}`,
                { headers: credentialHeaders() }
            );
            if (payload?.order) {
                orderDetailsCache.set(key, payload.order);
                return payload.order;
            }
        } catch (_) {}
        return null;
    }

    function resolvePaymentMethod(order, detail) {
        const channel = normalizeText(
            order?.channel || detail?.channel || detail?.payment_channel || order?.payment_channel
        ).toLowerCase();
        const provider = normalizeText(
            order?.provider || detail?.provider || detail?.payment_provider || order?.payment_provider
        ).toLowerCase();
        const feeLabel = normalizeText(detail?.payment_pricing?.payment_fee_label || order?.payment_pricing?.payment_fee_label);

        if (channel.includes('alipay') || provider.includes('alipay') || feeLabel.includes('支付宝')) {
            return { label: '支付宝', icon: 'fa-brands fa-alipay', key: 'alipay' };
        }
        if (channel.includes('wx') || channel.includes('wechat') || provider.includes('wx') || feeLabel.includes('微信')) {
            return { label: '微信支付', icon: 'fa-brands fa-weixin', key: 'wxpay' };
        }
        if (channel.includes('qq') || provider.includes('qq')) {
            return { label: 'QQ钱包', icon: 'fa-brands fa-qq', key: 'qqpay' };
        }
        if (channel.includes('usdt') || channel.includes('crypto') || provider.includes('nowpayments') || feeLabel.includes('加密')) {
            return { label: 'USDT', icon: 'fa-solid fa-coins', key: 'crypto' };
        }
        if (normalizeSite(order?.site || detail?.site) === 'intl' || normalizeText(order?.currency || detail?.currency).toUpperCase() === 'USD') {
            return { label: '加密货币', icon: 'fa-solid fa-coins', key: 'crypto' };
        }
        return { label: '在线支付', icon: 'fa-solid fa-credit-card', key: 'online' };
    }

    function resolveProductInfo(order, detail) {
        const items = (Array.isArray(detail?.items) && detail.items.length > 0)
            ? detail.items
            : (Array.isArray(order?.items) && order.items.length > 0 ? order.items : null);

        if (items && items.length > 1) {
            const firstItem = items[0];
            const firstName = normalizeText(
                firstItem.snapshot_product_name
                || firstItem.product_name
                || firstItem.name
                || ''
            );
            const firstProductId = normalizeText(
                firstItem.product_id
                || firstItem.productId
                || ''
            );

            let catalogProduct = null;
            if (firstProductId && catalogProductsMap.has(firstProductId)) {
                catalogProduct = catalogProductsMap.get(firstProductId);
            } else if (firstName && catalogProductsMap.has(firstName)) {
                catalogProduct = catalogProductsMap.get(firstName);
            }

            const totalCount = items.reduce((sum, it) => sum + (Number(it.quantity) || 1), 0);
            const baseTitle = firstName || catalogProduct?.name || '商品';
            const countText = totalCount > items.length
                ? `${items.length} 种共 ${totalCount} 件`
                : `${items.length} 件`;
            const displayName = `${baseTitle} 等共 ${countText}商品`;

            let imageUrl = null;
            if (catalogProduct) {
                const assets = catalogProduct.image_assets || catalogProduct.imageAssets;
                imageUrl = assets?.card?.url
                    || assets?.original?.url
                    || assets?.thumbnail?.url
                    || null;
                if (!imageUrl && catalogProduct.icon_url && isShopImageSource(catalogProduct.icon_url)) {
                    imageUrl = catalogProduct.icon_url;
                }
            }

            const iconClass = (catalogProduct?.icon_url && catalogProduct.icon_url.startsWith('fa'))
                ? catalogProduct.icon_url
                : null;

            return {
                title: displayName,
                imageUrl,
                iconClass
            };
        }

        const singleItem = (items && items.length === 1) ? items[0] : null;
        const productName = normalizeText(
            singleItem?.snapshot_product_name
            || singleItem?.product_name
            || detail?.snapshot_product_name
            || detail?.product_name
            || order?.snapshot_product_name
            || order?.product_name
            || ''
        );
        const skuName = normalizeText(
            singleItem?.snapshot_sku_name
            || singleItem?.sku_name
            || detail?.snapshot_sku_name
            || detail?.sku_name
            || order?.snapshot_sku_name
            || order?.sku_name
            || ''
        );
        const productId = normalizeText(
            singleItem?.product_id
            || detail?.product_id
            || order?.product_id
            || ''
        );
        const quantity = Number(singleItem?.quantity || detail?.quantity || order?.quantity) || 1;

        let catalogProduct = null;
        if (productId && catalogProductsMap.has(productId)) {
            catalogProduct = catalogProductsMap.get(productId);
        } else if (productName && catalogProductsMap.has(productName)) {
            catalogProduct = catalogProductsMap.get(productName);
        }

        let displayName = productName
            ? (skuName ? `${productName} / ${skuName}` : productName)
            : (catalogProduct?.name ? (skuName ? `${catalogProduct.name} / ${skuName}` : catalogProduct.name) : '已购商品');

        if (quantity > 1) {
            displayName += ` ×${quantity}`;
        }

        let imageUrl = null;
        if (catalogProduct) {
            const assets = catalogProduct.image_assets || catalogProduct.imageAssets;
            imageUrl = assets?.card?.url
                || assets?.original?.url
                || assets?.thumbnail?.url
                || null;
            if (!imageUrl && catalogProduct.icon_url && isShopImageSource(catalogProduct.icon_url)) {
                imageUrl = catalogProduct.icon_url;
            }
        }

        const iconClass = (catalogProduct?.icon_url && catalogProduct.icon_url.startsWith('fa'))
            ? catalogProduct.icon_url
            : null;

        return {
            title: displayName,
            imageUrl,
            iconClass
        };
    }

    function renderThumbnailNode(container, info) {
        container.textContent = '';
        if (info.imageUrl) {
            const img = document.createElement('img');
            img.className = 'guest-orders-item-thumb-img';
            img.src = info.imageUrl;
            img.alt = info.title || '商品预览';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.onerror = () => {
                img.remove();
                const fallback = document.createElement('i');
                fallback.className = 'fas fa-box guest-orders-item-thumb-icon';
                fallback.setAttribute('aria-hidden', 'true');
                container.appendChild(fallback);
            };
            container.appendChild(img);
        } else if (info.iconClass) {
            const icon = document.createElement('i');
            icon.className = `${info.iconClass} guest-orders-item-thumb-icon`;
            icon.setAttribute('aria-hidden', 'true');
            container.appendChild(icon);
        } else {
            const defIcon = document.createElement('i');
            defIcon.className = 'fas fa-box guest-orders-item-thumb-icon';
            defIcon.setAttribute('aria-hidden', 'true');
            container.appendChild(defIcon);
        }
    }

    function resolveDeliveryProductInfo(item, detail) {
        const productId = normalizeText(item?.productId || detail?.product_id || '', 200);
        const productName = normalizeText(item?.productName || detail?.snapshot_product_name || detail?.product_name || '', 200);

        let catalogProduct = null;
        if (productId && catalogProductsMap.has(productId)) {
            catalogProduct = catalogProductsMap.get(productId);
        } else if (productName && catalogProductsMap.has(productName)) {
            catalogProduct = catalogProductsMap.get(productName);
        }

        let imageUrl = null;
        if (catalogProduct) {
            const assets = catalogProduct.image_assets || catalogProduct.imageAssets;
            imageUrl = assets?.card?.url
                || assets?.original?.url
                || assets?.thumbnail?.url
                || null;
            if (!imageUrl && catalogProduct.icon_url && isShopImageSource(catalogProduct.icon_url)) {
                imageUrl = catalogProduct.icon_url;
            }
        }

        const iconClass = (catalogProduct?.icon_url && catalogProduct.icon_url.startsWith('fa'))
            ? catalogProduct.icon_url
            : null;

        return {
            title: item?.productName || '商品图片',
            imageUrl,
            iconClass
        };
    }

    function renderDeliveryThumbnailNode(container, info) {
        container.textContent = '';
        if (info && info.imageUrl) {
            const img = document.createElement('img');
            img.className = 'guest-orders-delivery-thumb-img';
            img.src = info.imageUrl;
            img.alt = info.title || '商品图片';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.onerror = () => {
                img.remove();
                const fallback = document.createElement('i');
                fallback.className = 'fas fa-box';
                fallback.setAttribute('aria-hidden', 'true');
                container.appendChild(fallback);
            };
            container.appendChild(img);
        } else if (info && info.iconClass) {
            const icon = document.createElement('i');
            icon.className = info.iconClass;
            icon.setAttribute('aria-hidden', 'true');
            container.appendChild(icon);
        } else {
            const icon = document.createElement('i');
            icon.className = 'fas fa-box';
            icon.setAttribute('aria-hidden', 'true');
            container.appendChild(icon);
        }
    }

    function createPaymentBadge(payment) {
        const badge = createNode('span', 'guest-orders-badge guest-orders-payment-badge');
        if (payment?.key) badge.dataset.key = payment.key;
        const icon = document.createElement('i');
        icon.className = payment.icon;
        icon.setAttribute('aria-hidden', 'true');
        badge.appendChild(icon);
        const label = createNode('span', 'guest-orders-payment-badge-label', payment.label);
        badge.appendChild(label);
        return badge;
    }

    function renderOrders() {
        const list = element('guestOrdersList');
        if (!list) return;
        list.textContent = '';
        const orders = Array.isArray(state.orders) ? state.orders : [];
        // The empty state belongs to the result card, not to a single render
        // pass. Keep it hidden while a detail view is active even if a stale
        // list render happens to run afterwards.
        setHidden('guestOrdersEmpty', Boolean(state.detail) || orders.length > 0);

        const currentSerial = state.ordersRequestSerial;

        for (const order of orders) {
            const orderNo = normalizeText(order.order_no, 200);
            const cachedDetail = orderDetailsCache.get(orderNo) || null;
            const productInfo = resolveProductInfo(order, cachedDetail);
            const payment = resolvePaymentMethod(order, cachedDetail);

            const item = createNode('article', 'guest-orders-item');
            item.dataset.orderNo = orderNo;

            // 1. Top row: Order number on left, badges on right (Payment method + Status)
            const top = createNode('div', 'guest-orders-item-top');
            const left = createNode('div', 'guest-orders-item-left');
            const noEl = createNode('div', 'guest-orders-item-no', orderNo || '-');
            if (orderNo && orderNo !== '-') {
                noEl.classList.add('is-copyable');
                noEl.title = '点击复制订单号';
                noEl.setAttribute('role', 'button');
                noEl.setAttribute('tabindex', '0');
                noEl.setAttribute('aria-label', `复制订单号 ${orderNo}`);

                const copyIcon = document.createElement('i');
                copyIcon.className = 'far fa-copy guest-orders-item-no-copy-icon';
                copyIcon.setAttribute('aria-hidden', 'true');
                noEl.appendChild(copyIcon);

                const handleCopyOrderNo = (e) => {
                    e.stopPropagation();
                    if (window.getSelection) {
                        try { window.getSelection().removeAllRanges(); } catch (_) {}
                    }
                    void handleCopyText(orderNo, noEl);
                };

                noEl.addEventListener('click', handleCopyOrderNo);
                noEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleCopyOrderNo(e);
                    }
                });
            }
            left.appendChild(noEl);
            left.appendChild(createDiscountLines(order));
            top.appendChild(left);

            const badges = createNode('div', 'guest-orders-item-badges');
            badges.appendChild(createPaymentBadge(payment));
            badges.appendChild(createBadge(PAYMENT_LABELS, order.payment_status));
            top.appendChild(badges);

            item.appendChild(top);

            // 2. Main body row: Thumbnail + Product Name & Meta Info + Price
            const body = createNode('div', 'guest-orders-item-body');

            // Thumbnail
            const thumb = createNode('div', 'guest-orders-item-thumb');
            renderThumbnailNode(thumb, productInfo);
            body.appendChild(thumb);

            // Content (Title + Meta)
            const content = createNode('div', 'guest-orders-item-content');
            const titleEl = createNode('h3', 'guest-orders-item-product-name', productInfo.title);
            content.appendChild(titleEl);

            const metaRow = createNode('div', 'guest-orders-item-meta-row');

            // 下单时间
            const timeEl = createNode('span', 'guest-orders-meta-item');
            const clockIcon = document.createElement('i');
            clockIcon.className = 'far fa-clock';
            clockIcon.setAttribute('aria-hidden', 'true');
            timeEl.appendChild(clockIcon);
            const timeText = createNode('span', 'guest-orders-meta-time', formatTime(order.created_at));
            timeEl.appendChild(timeText);
            metaRow.appendChild(timeEl);

            // Separator
            metaRow.appendChild(createNode('span', 'guest-orders-meta-dot', '·'));

            // 提示：点击查看订单详情
            metaRow.appendChild(createNode('span', 'guest-orders-meta-item guest-orders-meta-hint', '点击查看订单详情'));

            content.appendChild(metaRow);
            body.appendChild(content);

            // Price / 实付金额
            const priceCol = createNode('div', 'guest-orders-item-price-col');
            const amountEl = createNode('div', 'guest-orders-item-amount', formatAmount(order.amount));
            priceCol.appendChild(amountEl);
            body.appendChild(priceCol);

            item.appendChild(body);

            // Warning hint if order is still pending/created
            if (normalizeText(order.payment_status).toLowerCase() === 'pending'
                || normalizeText(order.payment_status).toLowerCase() === 'created') {
                const pendingNotice = createNode('div', 'guest-orders-item-pending-notice');
                pendingNotice.appendChild(createNode(
                    'span',
                    'guest-orders-item-no',
                    '订单仍待支付：请勿重复下单或付款；如需继续处理，请联系支持'
                ));
                item.appendChild(pendingNotice);
            }

            // Click entire item to open details
            item.setAttribute('role', 'button');
            item.setAttribute('tabindex', '0');
            item.setAttribute('aria-label', `查看订单 ${orderNo} 详情`);
            item.addEventListener('click', (event) => {
                if (event.target && event.target.closest('a, button, .guest-orders-item-no')) return;
                void openDetail(orderNo);
            });
            item.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    if (event.target && event.target.closest('.guest-orders-item-no')) return;
                    event.preventDefault();
                    void openDetail(orderNo);
                }
            });

            list.appendChild(item);
        }
        renderPagination(orders.length);

        // Async enrichment for visible orders
        void enrichOrdersList(orders, currentSerial);
    }

    async function enrichOrdersList(orders, expectedSerial) {
        if (!Array.isArray(orders) || orders.length === 0) return;

        await loadShopCatalog();
        if (expectedSerial !== state.ordersRequestSerial) return;

        for (const order of orders) {
            const orderNo = normalizeText(order.order_no, 200);
            if (!orderNo) continue;
            let detail = orderDetailsCache.get(orderNo);
            if (!detail) {
                detail = await fetchOrderDetailForList(orderNo);
                if (expectedSerial !== state.ordersRequestSerial) return;
            }
            if (!detail) continue;

            const list = element('guestOrdersList');
            if (!list) return;
            const itemEl = list.querySelector(`.guest-orders-item[data-order-no="${escapeCssSelector(orderNo)}"]`);
            if (!itemEl) continue;

            const productInfo = resolveProductInfo(order, detail);
            const payment = resolvePaymentMethod(order, detail);

            const titleEl = itemEl.querySelector('.guest-orders-item-product-name');
            if (titleEl && productInfo.title) {
                titleEl.textContent = productInfo.title;
            }

            const thumbEl = itemEl.querySelector('.guest-orders-item-thumb');
            if (thumbEl) {
                renderThumbnailNode(thumbEl, productInfo);
            }

            const badgeEl = itemEl.querySelector('.guest-orders-payment-badge');
            if (badgeEl && payment.key) {
                badgeEl.dataset.key = payment.key;
            }
            const paymentLabelEl = itemEl.querySelector('.guest-orders-payment-badge-label');
            const paymentIconEl = itemEl.querySelector('.guest-orders-payment-badge i');
            if (paymentLabelEl && payment.label) {
                paymentLabelEl.textContent = payment.label;
            }
            if (paymentIconEl && payment.icon) {
                paymentIconEl.className = payment.icon;
            }
        }
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

    function resolveOrderDiscounts(detail) {
        const paidAmount = Number(detail?.total_amount ?? detail?.amount ?? detail?.amount_breakdown?.total_amount) || 0;
        const breakdown = detail?.amount_breakdown;
        let listAmount = Number(breakdown?.list_amount);
        let discountAmount = Number(breakdown?.discount_amount);
        const discountCode = normalizeText(breakdown?.discount_code || detail?.discount_code || detail?.coupon_code, 50);
        const quantity = Number(detail?.quantity || breakdown?.quantity || 1) || 1;

        if (!Number.isFinite(discountAmount) || discountAmount < 0) {
            if (Number.isFinite(Number(detail?.discount_amount))) {
                discountAmount = Number(detail.discount_amount);
            } else if (Number.isFinite(Number(detail?.coupon_discount))) {
                discountAmount = Number(detail.coupon_discount);
            } else if (Number.isFinite(Number(detail?.promo_discount))) {
                discountAmount = Number(detail.promo_discount);
            } else {
                discountAmount = 0;
            }
        }

        if (!Number.isFinite(listAmount) || listAmount <= 0) {
            const listUnit = Number(detail?.list_unit_amount || breakdown?.list_unit_amount);
            if (Number.isFinite(listUnit) && listUnit > 0) {
                listAmount = Math.round(listUnit * quantity * 100) / 100;
            }
        }

        const discountItems = [];

        // 1. Snapshot applied discounts
        let snapshot = detail?.discount_snapshot;
        if (typeof snapshot === 'string') {
            try { snapshot = JSON.parse(snapshot); } catch (_) { snapshot = null; }
        }
        const appliedDiscounts = Array.isArray(snapshot?.applied_discounts) ? snapshot.applied_discounts : [];
        if (appliedDiscounts.length > 0) {
            for (const item of appliedDiscounts) {
                if (!item || typeof item !== 'object') continue;
                const itemCode = normalizeText(item.code || item.discount_code || item.coupon_code, 50);
                const itemType = normalizeText(item.type || item.discount_type, 30).toLowerCase();
                const itemAmount = Number(item.discount_amount || item.amount || 0);
                const itemLabel = normalizeText(item.name || item.benefit_label || item.label, 100);

                let label = itemLabel || '活动优惠';
                if (itemType === 'coupon' || itemType === 'code' || itemCode) {
                    label = itemCode ? `优惠码 (${itemCode})` : '优惠券优惠';
                } else if (itemType === 'flash_sale' || itemType === 'flash' || /秒杀/u.test(itemLabel)) {
                    label = '秒杀价优惠';
                } else if (itemType === 'tier' || itemType === 'quantity' || /阶梯/u.test(itemLabel)) {
                    label = '阶梯价优惠';
                } else if (itemType === 'percent') {
                    label = itemCode ? `折扣优惠 (${itemCode})` : '折扣优惠';
                } else if (itemType === 'fixed') {
                    label = itemCode ? `满减优惠 (${itemCode})` : '满减优惠';
                } else if (itemLabel) {
                    label = itemLabel;
                }

                discountItems.push({
                    label,
                    amount: itemAmount > 0 ? itemAmount : null,
                    text: itemAmount > 0 ? `-¥${itemAmount.toFixed(2)}` : (itemLabel || '已优惠')
                });
            }
        }

        // 2. Catalog check for product & SKU specific flash sale or tier pricing
        const productId = normalizeText(detail?.product_id, 100);
        const productName = normalizeText(detail?.snapshot_product_name || detail?.product_name, 100);
        const skuId = normalizeText(detail?.sku_id, 100);
        const skuName = normalizeText(detail?.snapshot_sku_name || detail?.sku_name, 100);

        const catalogProduct = (productId && catalogProductsMap.get(productId))
            || (productName && catalogProductsMap.get(productName));

        let catalogOriginalTotal = null;
        let catalogBaseUnit = 0;
        let flashSalePrice = 0;
        let hasFlash = false;
        if (catalogProduct) {
            // Find SKU in product.skus or product.inventory_skus
            const skus = Array.isArray(catalogProduct.skus) ? catalogProduct.skus
                : (Array.isArray(catalogProduct.inventory_skus) ? catalogProduct.inventory_skus : []);
            let matchedSku = null;
            if (skuId) {
                matchedSku = skus.find((s) => String(s.id || '').trim() === skuId);
            }
            if (!matchedSku && skuName) {
                matchedSku = skus.find((s) => String(s.sku_name || s.name || '').trim() === skuName);
            }
            if (!matchedSku && skus.length > 0) {
                matchedSku = skus.find((s) => s.is_default) || skus[0];
            }

            // Catalog base price
            catalogBaseUnit = Number(
                matchedSku?.price_points
                ?? matchedSku?.pricePoints
                ?? catalogProduct.price_points
                ?? catalogProduct.pricePoints
                ?? catalogProduct.price
            );

            // Flash sale price
            flashSalePrice = Number(
                matchedSku?.flash_sale_price
                ?? matchedSku?.product_flash_sale_price
                ?? catalogProduct.flash_sale_price
                ?? catalogProduct.product_flash_sale_price
                ?? catalogProduct.productFlashSalePrice
            );
            hasFlash = Number.isFinite(flashSalePrice) && flashSalePrice > 0;

            // Tier quantity rules
            const quantityRules = matchedSku?.quantity_rules
                || matchedSku?.quantityRules
                || catalogProduct.quantity_rules
                || catalogProduct.productQuantityRules;

            const unitAmount = Number(detail?.unit_amount ?? breakdown?.unit_amount);
            const listUnit = Number(detail?.list_unit_amount ?? breakdown?.list_unit_amount);

            if (Number.isFinite(catalogBaseUnit) && catalogBaseUnit > 0) {
                catalogOriginalTotal = Math.round(catalogBaseUnit * quantity * 100) / 100;

                // Check flash sale match
                if (hasFlash && (listUnit === flashSalePrice || unitAmount === flashSalePrice) && catalogBaseUnit > flashSalePrice) {
                    const flashSaved = Math.round((catalogBaseUnit - flashSalePrice) * quantity * 100) / 100;
                    if (flashSaved > 0 && !discountItems.some((d) => d.label.includes('秒杀'))) {
                        discountItems.unshift({
                            label: '秒杀价优惠',
                            amount: flashSaved,
                            text: `-¥${flashSaved.toFixed(2)}`
                        });
                        discountAmount = Math.max(discountAmount, Math.round((discountAmount + flashSaved) * 100) / 100);
                    }
                } else if (Array.isArray(quantityRules) && quantityRules.length > 0) {
                    // Check tier quantity rules
                    let matchedRule = null;
                    for (const rule of quantityRules) {
                        const ruleQty = Number(rule.qty || rule.quantity);
                        const rulePrice = Number(rule.price);
                        if (quantity >= ruleQty && catalogBaseUnit > rulePrice) {
                            if (!matchedRule || ruleQty > matchedRule.qty) {
                                matchedRule = { qty: ruleQty, price: rulePrice };
                            }
                        }
                    }
                    if (matchedRule) {
                        const tierSaved = Math.round((catalogBaseUnit - matchedRule.price) * quantity * 100) / 100;
                        if (tierSaved > 0 && !discountItems.some((d) => d.label.includes('阶梯'))) {
                            discountItems.unshift({
                                label: `阶梯价优惠 (满${matchedRule.qty}件)`,
                                amount: tierSaved,
                                text: `-¥${tierSaved.toFixed(2)}`
                            });
                            discountAmount = Math.max(discountAmount, Math.round((discountAmount + tierSaved) * 100) / 100);
                        }
                    }
                }
            }
        }

        // 3. Coupon code check
        if (discountCode && !discountItems.some((d) => d.label.includes('优惠码') || d.label.includes(discountCode))) {
            const couponAmt = Number(detail?.coupon_discount || breakdown?.discount_amount || detail?.discount_amount);
            const amt = Number.isFinite(couponAmt) && couponAmt > 0 ? couponAmt : (discountAmount > 0 ? discountAmount : null);
            discountItems.push({
                label: `优惠码优惠 (${discountCode})`,
                amount: amt,
                text: amt > 0 ? `-¥${amt.toFixed(2)}` : '已减免'
            });
        }

        // 4. Promo discount check
        const promoAmt = Number(detail?.promo_discount);
        if (Number.isFinite(promoAmt) && promoAmt > 0 && !discountItems.some((d) => d.label.includes('活动') || d.label.includes('促销'))) {
            discountItems.push({
                label: '促销立减优惠',
                amount: promoAmt,
                text: `-¥${promoAmt.toFixed(2)}`
            });
        }

        // 5. Fallback if discountAmount > 0 and no specific item
        if (discountAmount > 0 && discountItems.length === 0) {
            let label = '活动立减优惠';
            if (hasFlash && Number.isFinite(catalogBaseUnit) && catalogBaseUnit > flashSalePrice) {
                label = '秒杀价优惠';
            } else if (quantity > 1) {
                label = `阶梯价优惠 (共${quantity}件)`;
            }
            discountItems.push({
                label,
                amount: discountAmount,
                text: `-¥${discountAmount.toFixed(2)}`
            });
        }

        // 6. Determine original amount
        let originalAmount = null;
        if (Number.isFinite(catalogOriginalTotal) && catalogOriginalTotal > paidAmount) {
            originalAmount = catalogOriginalTotal;
        } else if (Number.isFinite(listAmount) && listAmount > 0) {
            originalAmount = listAmount;
        } else if (discountAmount > 0) {
            originalAmount = Math.round((paidAmount + discountAmount) * 100) / 100;
        } else {
            originalAmount = paidAmount;
        }

        if (originalAmount > paidAmount) {
            const netDiff = Math.round((originalAmount - paidAmount) * 100) / 100;
            if (discountAmount <= 0 || Math.abs(discountAmount - netDiff) <= 0.05) {
                discountAmount = netDiff;
            }
            if (discountItems.length === 0) {
                let label = '活动立减优惠';
                if (hasFlash && Number.isFinite(catalogBaseUnit) && catalogBaseUnit > flashSalePrice) {
                    label = '秒杀价优惠';
                } else if (quantity > 1) {
                    label = `阶梯价优惠 (共${quantity}件)`;
                }
                discountItems.push({
                    label,
                    amount: discountAmount,
                    text: `-¥${discountAmount.toFixed(2)}`
                });
            }
        }

        // Align single discount item amount with total discountAmount if within 5 cents (handles channel fee rounding)
        if (discountItems.length === 1 && discountAmount > 0 && Number.isFinite(discountItems[0].amount)) {
            if (Math.abs(discountItems[0].amount - discountAmount) <= 0.05) {
                discountItems[0].amount = discountAmount;
                discountItems[0].text = `-¥${discountAmount.toFixed(2)}`;
            }
        }

        return {
            originalAmount,
            discountAmount: Math.max(0, discountAmount || 0),
            paidAmount,
            discountItems
        };
    }

    function renderDetail() {
        const detail = state.detail;
        setHidden('guestOrdersDetail', !detail);
        setHidden('guestOrdersList', Boolean(detail));
        // Empty-state visibility is derived from the same result set as the
        // list. A detail deep-link has no list rows to show, so it also hides
        // the empty state while the detail card is active.
        const hasOrders = Array.isArray(state.orders) && state.orders.length > 0;
        setHidden('guestOrdersEmpty', Boolean(detail) || hasOrders);
        setHidden('guestOrdersPagination', Boolean(detail));
        setHidden('guestOrdersBackToListBtn', !detail);
        const rows = element('guestOrdersDetailRows');
        if (!rows || !detail) return;
        rows.textContent = '';
        const payment = resolvePaymentMethod(detail, detail);
        const discountData = resolveOrderDiscounts(detail);

        const origText = discountData.originalAmount > 0
            ? formatAmount(discountData.originalAmount)
            : (discountData.paidAmount > 0 ? formatAmount(discountData.paidAmount) : '-');
        const paidText = discountData.paidAmount > 0 ? formatAmount(discountData.paidAmount) : '-';

        const fields = [
            ['订单号', detail.order_no || '-', true, 'order-no'],
            ['支付方式', payment?.label || '-', false, 'payment'],
            ['支付状态', statusLabel(PAYMENT_LABELS, detail.payment_status).text, false, 'status'],
            ['原始金额', origText, false, 'original-amount'],
            ['优惠金额', discountData, false, 'discount-amount'],
            ['实付金额', paidText, false, 'paid-amount']
        ];
        if (normalizeText(detail.refund_status) && normalizeText(detail.refund_status) !== 'none') {
            fields.push(['退款状态', normalizeText(detail.refund_status, 40), false, 'refund-status']);
        }

        for (const [label, value, mono, key] of fields) {
            const row = document.createElement('div');
            row.className = `guest-orders-detail-row guest-orders-detail-row--${key}`;

            if (key === 'discount-amount') {
                const dt = document.createElement('dt');
                dt.className = 'guest-orders-detail-discount-dt';
                dt.appendChild(createNode('span', '', label));

                const help = document.createElement('span');
                help.className = 'guest-orders-discount-help';
                help.setAttribute('role', 'button');
                help.setAttribute('tabindex', '0');
                help.setAttribute('aria-label', '查看优惠明细');

                const icon = document.createElement('i');
                icon.className = 'fas fa-circle-exclamation guest-orders-discount-help-icon';
                icon.setAttribute('aria-hidden', 'true');
                help.appendChild(icon);

                const popover = document.createElement('div');
                popover.className = 'guest-orders-discount-popover';
                popover.setAttribute('role', 'tooltip');

                const popTitle = document.createElement('div');
                popTitle.className = 'guest-orders-discount-popover__title';
                const tagIcon = document.createElement('i');
                tagIcon.className = 'fas fa-tags';
                tagIcon.setAttribute('aria-hidden', 'true');
                popTitle.appendChild(tagIcon);
                popTitle.appendChild(createNode('span', '', '优惠明细'));
                popover.appendChild(popTitle);

                if (value.discountItems && value.discountItems.length > 0) {
                    const list = document.createElement('div');
                    list.className = 'guest-orders-discount-popover__list';
                    for (const item of value.discountItems) {
                        const itemEl = document.createElement('div');
                        itemEl.className = 'guest-orders-discount-popover__row';
                        itemEl.appendChild(createNode('span', 'disc-name', item.label));
                        itemEl.appendChild(createNode('span', 'disc-amt', item.text));
                        list.appendChild(itemEl);
                    }
                    popover.appendChild(list);
                } else {
                    const empty = createNode('div', 'guest-orders-discount-popover__empty', '未享受优惠');
                    popover.appendChild(empty);
                }

                help.appendChild(popover);

                const handleToggle = (e) => {
                    e.stopPropagation();
                    const active = help.classList.toggle('is-active');
                    if (active) {
                        const handleOutside = (evt) => {
                            if (!help.contains(evt.target)) {
                                help.classList.remove('is-active');
                                document.removeEventListener('click', handleOutside);
                            }
                        };
                        setTimeout(() => document.addEventListener('click', handleOutside), 10);
                    }
                };
                help.addEventListener('click', handleToggle);
                help.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleToggle(e);
                    }
                });

                dt.appendChild(help);
                row.appendChild(dt);

                const dd = createNode('dd', 'guest-orders-detail-discount-val', '');
                const hasDiscount = value.discountAmount > 0;
                const amountText = hasDiscount ? `-${formatAmount(value.discountAmount)}` : '¥0.00';
                const numSpan = createNode('span', `guest-orders-detail-amount-num${hasDiscount ? ' has-discount' : ''}`, amountText);
                dd.appendChild(numSpan);
                row.appendChild(dd);
            } else {
                row.appendChild(createNode('dt', '', label));
                const dd = createNode('dd', mono ? 'is-mono' : '', value);
                if (key === 'paid-amount') {
                    dd.classList.add('is-paid-amount');
                }
                if (label === '订单号' && value && value !== '-') {
                    dd.classList.add('is-copyable');
                    dd.title = '点击复制订单号';
                    dd.setAttribute('role', 'button');
                    dd.setAttribute('tabindex', '0');
                    dd.setAttribute('aria-label', `复制订单号 ${value}`);

                    const copyIcon = document.createElement('i');
                    copyIcon.className = 'far fa-copy guest-orders-item-no-copy-icon';
                    copyIcon.setAttribute('aria-hidden', 'true');
                    dd.appendChild(copyIcon);

                    const handleCopyDetailNo = (e) => {
                        e.stopPropagation();
                        if (window.getSelection) {
                            try { window.getSelection().removeAllRanges(); } catch (_) {}
                        }
                        void handleCopyText(value, dd);
                    };
                    dd.addEventListener('click', handleCopyDetailNo);
                    dd.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleCopyDetailNo(e);
                        }
                    });
                }
                row.appendChild(dd);
            }
            rows.appendChild(row);
        }

        const deliverable = isDeliverable(detail);
        if (!deliverable) {
            clearDelivery();
            const hint = element('guestOrdersDeliveryHint');
            if (hint) {
                hint.textContent = '订单完成支付并发货后，这里会显示卡密内容。当前状态不会展示发货内容。';
                hint.hidden = false;
            }
        }
    }

    // ------------------------------------------------------------------
    // Delivery Rendering & Interactions (Safe DOM & Multi-item Support)
    // ------------------------------------------------------------------
    function clearDelivery() {
        state.delivery = null;
        const list = element('guestOrdersDeliveryList');
        if (list) list.textContent = '';
        const actionsBar = element('guestOrdersDeliveryActionsBar');
        if (actionsBar) actionsBar.textContent = '';
        setHidden('guestOrdersDeliveryPanel', true);
        const hint = element('guestOrdersDeliveryHint');
        if (hint) {
            hint.textContent = '';
            hint.hidden = true;
        }
    }

    function splitDeliveryContent(raw) {
        const text = String(raw || '').trim();
        if (!text) return [];
        if (/\n\s*----\s*\n/.test(text)) {
            return text.split(/\n\s*----\s*\n/).map((s) => s.trim()).filter(Boolean);
        }
        if (/\n\n+/.test(text)) {
            return text.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
        }
        return [text];
    }

    function showShopToast(message, variant = 'success') {
        const normalizedMessage = String(message || '').trim();
        if (!normalizedMessage) return;

        let toast = element('shopStorefrontToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'shopStorefrontToast';
            toast.className = 'shop-success-toast';
            toast.dataset.shopToastGlobal = '1';
            toast.setAttribute('aria-live', 'polite');
            toast.setAttribute('aria-atomic', 'true');
            toast.setAttribute('role', 'status');
            document.body.appendChild(toast);
        }

        toast.textContent = normalizedMessage;
        toast.dataset.variant = variant;
        toast.classList.add('is-visible');

        if (toast.__hideTimer) {
            clearTimeout(toast.__hideTimer);
        }
        toast.__hideTimer = setTimeout(() => {
            toast.classList.remove('is-visible');
        }, 1800);
    }

    function formatItemTimestamp(timestamp) {
        const normalizedTimestamp = String(timestamp || '').trim();
        if (!normalizedTimestamp) return '';

        const parsed = new Date(normalizedTimestamp);
        if (Number.isNaN(parsed.getTime())) {
            return normalizedTimestamp;
        }

        return new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(parsed);
    }

    function normalizeDeliveryItems(payload, detail) {
        if (Array.isArray(payload?.items) && payload.items.length > 0) {
            const groups = new Map();
            for (const item of payload.items) {
                const productName = normalizeText(
                    item.product_name || item.name || item.displayName || detail?.snapshot_product_name || detail?.product_name || '商品',
                    200
                );
                const skuName = normalizeText(
                    item.sku_name || item.sku || detail?.snapshot_sku_name || detail?.sku_name || '',
                    100
                );
                const productId = String(item.product_id || item.productId || detail?.product_id || '').trim();
                const skuId = String(item.sku_id || item.skuId || detail?.product_sku_id || detail?.sku_id || '').trim();
                const key = `${productId}|${skuId}|${productName}|${skuName}`;

                const rawContent = item.contentSegments || item.content || '';
                const segments = Array.isArray(rawContent)
                    ? rawContent.map((s) => String(s || '').trim()).filter(Boolean)
                    : splitDeliveryContent(rawContent);

                const itemQuantity = Number(item.quantity);
                const qty = Number.isFinite(itemQuantity) && itemQuantity > 0
                    ? itemQuantity
                    : (payload.items.length === 1 && Number(detail?.quantity) > 0 ? Number(detail.quantity) : 1);

                const notes = normalizeText(item.purchase_notes || item.purchaseNotes || detail?.purchase_notes || '', 2000);
                const usage = normalizeText(item.usage_instructions || item.usageInstructions || detail?.usage_instructions || '', 2000);
                const createdAt = item.created_at || detail?.paid_at || detail?.created_at || payload?.created_at || '';

                if (groups.has(key)) {
                    const existing = groups.get(key);
                    existing.quantity += qty;
                    if (segments.length > 0) {
                        existing.contentSegments.push(...segments);
                    }
                    if (!existing.purchaseNotes && notes) existing.purchaseNotes = notes;
                    if (!existing.usageInstructions && usage) existing.usageInstructions = usage;
                    if (!existing.createdAt && createdAt) existing.createdAt = createdAt;
                } else {
                    groups.set(key, {
                        productId,
                        skuId,
                        productName,
                        skuName,
                        quantity: qty,
                        contentSegments: [...segments],
                        purchaseNotes: notes,
                        usageInstructions: usage,
                        createdAt
                    });
                }
            }

            return Array.from(groups.values()).map((g) => {
                if (g.contentSegments.length === 0) {
                    g.contentSegments = ['（暂无卡密内容）'];
                }
                return g;
            });
        }

        const rawContent = payload?.content || '';
        const segments = splitDeliveryContent(rawContent);
        return [{
            productId: String(detail?.product_id || '').trim(),
            skuId: String(detail?.product_sku_id || detail?.sku_id || '').trim(),
            productName: normalizeText(detail?.snapshot_product_name || detail?.product_name || detail?.name || '已购商品', 200),
            skuName: normalizeText(detail?.snapshot_sku_name || detail?.sku_name || detail?.sku || '', 100),
            quantity: Math.max(1, Number(detail?.quantity || 0) || segments.length || 1),
            contentSegments: segments.length > 0 ? segments : ['（暂无卡密内容）'],
            purchaseNotes: normalizeText(detail?.purchase_notes || '', 2000),
            usageInstructions: normalizeText(detail?.usage_instructions || '', 2000),
            createdAt: detail?.paid_at || detail?.created_at || payload?.created_at || ''
        }];
    }

    function renderDelivery(payload, detail) {
        const list = element('guestOrdersDeliveryList');
        if (!list) return;
        list.textContent = '';
        const actionsBar = element('guestOrdersDeliveryActionsBar');
        if (actionsBar) actionsBar.textContent = '';

        const items = normalizeDeliveryItems(payload, detail);
        if (items.length === 0) {
            list.appendChild(createNode('div', 'guest-orders-delivery-empty', '暂无可展示的发货内容'));
            return;
        }

        const allSegments = items.flatMap((it) => it.contentSegments).filter((s) => s && s !== '（暂无卡密内容）');
        if (allSegments.length > 0) {
            const targetBar = actionsBar || createNode('div', 'guest-orders-delivery-actions-bar');
            const copyAllBtn = createNode('button', 'guest-orders-delivery-copy-all-btn');
            copyAllBtn.type = 'button';
            copyAllBtn.dataset.action = 'copy-all';
            copyAllBtn.dataset.allContent = allSegments.join('\n----\n');
            copyAllBtn.title = '复制所有卡密';
            copyAllBtn.setAttribute('aria-label', '复制所有卡密');
            const copyAllIcon = document.createElement('i');
            copyAllIcon.className = 'fas fa-copy';
            copyAllIcon.setAttribute('aria-hidden', 'true');
            copyAllBtn.appendChild(copyAllIcon);
            const copyAllLabel = createNode('span', '', '复制所有卡密');
            copyAllBtn.appendChild(copyAllLabel);
            targetBar.appendChild(copyAllBtn);
            if (!actionsBar) list.appendChild(targetBar);
        }

        items.forEach((item, index) => {
            const itemEl = createNode('article', 'guest-orders-delivery-item');
            itemEl.dataset.itemIndex = String(index);

            const surface = createNode('div', 'guest-orders-delivery-surface');
            surface.setAttribute('role', 'button');
            surface.setAttribute('tabindex', '0');
            surface.setAttribute('aria-expanded', 'false');
            surface.dataset.action = 'toggle-item-content';

            const header = createNode('div', 'guest-orders-delivery-header');
            const heading = createNode('div', 'guest-orders-delivery-heading');

            const icon = createNode('div', 'guest-orders-delivery-icon');
            const info = resolveDeliveryProductInfo(item, detail);
            renderDeliveryThumbnailNode(icon, info);
            heading.appendChild(icon);

            const copy = createNode('div', 'guest-orders-delivery-copy');
            const titleRow = createNode('div', 'guest-orders-delivery-title-row');
            const displayName = item.skuName ? `${item.productName} / ${item.skuName}` : item.productName;
            const title = createNode('h3', 'guest-orders-delivery-product-title', displayName);
            titleRow.appendChild(title);
            copy.appendChild(titleRow);

            if (item.quantity > 1) {
                const qtyRow = createNode('div', 'guest-orders-delivery-quantity-row');
                const qtyTag = createNode('span', 'guest-orders-delivery-tag guest-orders-delivery-tag--quantity', `数量 ${item.quantity}`);
                qtyRow.appendChild(qtyTag);
                copy.appendChild(qtyRow);
            }

            const revealLabel = createNode('div', 'guest-orders-delivery-reveal-label');
            const revealBtn = createNode('span', 'guest-orders-delivery-reveal-btn', '点击查看卡密');
            revealLabel.appendChild(revealBtn);
            copy.appendChild(revealLabel);

            heading.appendChild(copy);
            header.appendChild(heading);

            const actions = createNode('div', 'guest-orders-delivery-actions');
            const toolbar = createNode('div', 'guest-orders-delivery-toolbar');

            if (item.purchaseNotes) {
                const notesBtn = createNode('button', 'guest-orders-delivery-tag guest-orders-delivery-tag--notice');
                notesBtn.type = 'button';
                notesBtn.dataset.action = 'toggle-notes';
                notesBtn.setAttribute('aria-expanded', 'false');
                const notesLabel = createNode('span', 'guest-orders-delivery-tag-label', '注意事项');
                notesBtn.appendChild(notesLabel);
                toolbar.appendChild(notesBtn);
            }

            if (item.usageInstructions) {
                const usageBtn = createNode('button', 'guest-orders-delivery-tag guest-orders-delivery-tag--usage');
                usageBtn.type = 'button';
                usageBtn.dataset.action = 'toggle-usage';
                usageBtn.setAttribute('aria-expanded', 'false');
                const usageLabel = createNode('span', 'guest-orders-delivery-tag-label', '使用说明');
                usageBtn.appendChild(usageLabel);
                toolbar.appendChild(usageBtn);
            }

            const itemCopyBtn = createNode('button', 'guest-orders-delivery-item-copy-btn');
            itemCopyBtn.type = 'button';
            itemCopyBtn.dataset.action = 'copy-item';
            itemCopyBtn.dataset.itemContent = item.contentSegments.join('\n');
            itemCopyBtn.title = '复制该商品卡密';
            itemCopyBtn.setAttribute('aria-label', '复制该商品卡密');
            const itemCopyIcon = document.createElement('i');
            itemCopyIcon.className = 'fas fa-copy';
            itemCopyIcon.setAttribute('aria-hidden', 'true');
            itemCopyBtn.appendChild(itemCopyIcon);
            toolbar.appendChild(itemCopyBtn);

            actions.appendChild(toolbar);

            const formattedCreatedAt = formatItemTimestamp(item.createdAt);
            if (formattedCreatedAt) {
                const timeEl = createNode('div', 'guest-orders-delivery-time', formattedCreatedAt);
                actions.appendChild(timeEl);
            }

            header.appendChild(actions);
            surface.appendChild(header);
            itemEl.appendChild(surface);

            const body = createNode('div', 'guest-orders-delivery-body');
            const disclosures = createNode('div', 'guest-orders-delivery-disclosures');

            const contentPanel = createNode('section', 'guest-orders-delivery-content-panel');
            contentPanel.setAttribute('aria-hidden', 'true');
            const grid = createNode('div', 'guest-orders-delivery-content-grid');

            item.contentSegments.forEach((segment) => {
                const card = createNode('div', 'guest-orders-delivery-card-key');
                card.dataset.action = 'copy-card';
                card.dataset.cardContent = segment;
                card.title = '点击复制';

                const cardBox = createNode('div', 'guest-orders-delivery-card-key-box');
                const cardText = createNode('div', 'guest-orders-delivery-card-key-text', segment);
                cardBox.appendChild(cardText);
                card.appendChild(cardBox);

                grid.appendChild(card);
            });

            contentPanel.appendChild(grid);
            disclosures.appendChild(contentPanel);

            if (item.purchaseNotes) {
                const notesPanel = createNode('section', 'guest-orders-delivery-guidance-panel guest-orders-delivery-guidance-panel--notice');
                notesPanel.hidden = true;

                const copyGuidanceBtn = createNode('button', 'guest-orders-delivery-guidance-copy');
                copyGuidanceBtn.type = 'button';
                copyGuidanceBtn.dataset.action = 'copy-guidance';
                copyGuidanceBtn.dataset.guidanceContent = item.purchaseNotes;
                copyGuidanceBtn.title = '复制注意事项';
                copyGuidanceBtn.setAttribute('aria-label', '复制注意事项');
                const copyGIcon = document.createElement('i');
                copyGIcon.className = 'fas fa-copy';
                copyGIcon.setAttribute('aria-hidden', 'true');
                copyGuidanceBtn.appendChild(copyGIcon);
                notesPanel.appendChild(copyGuidanceBtn);

                const notesContent = createNode('div', 'guest-orders-delivery-guidance-content', item.purchaseNotes);
                notesPanel.appendChild(notesContent);
                disclosures.appendChild(notesPanel);
            }

            if (item.usageInstructions) {
                const usagePanel = createNode('section', 'guest-orders-delivery-guidance-panel guest-orders-delivery-guidance-panel--usage');
                usagePanel.hidden = true;

                const copyUsageBtn = createNode('button', 'guest-orders-delivery-guidance-copy');
                copyUsageBtn.type = 'button';
                copyUsageBtn.dataset.action = 'copy-guidance';
                copyUsageBtn.dataset.guidanceContent = item.usageInstructions;
                copyUsageBtn.title = '复制使用说明';
                copyUsageBtn.setAttribute('aria-label', '复制使用说明');
                const copyUIcon = document.createElement('i');
                copyUIcon.className = 'fas fa-copy';
                copyUIcon.setAttribute('aria-hidden', 'true');
                copyUsageBtn.appendChild(copyUIcon);
                usagePanel.appendChild(copyUsageBtn);

                const usageContent = createNode('div', 'guest-orders-delivery-guidance-content', item.usageInstructions);
                usagePanel.appendChild(usageContent);
                disclosures.appendChild(usagePanel);
            }

            body.appendChild(disclosures);
            itemEl.appendChild(body);
            list.appendChild(itemEl);
        });
    }

    function toggleItemContent(surface) {
        const item = surface.closest('.guest-orders-delivery-item');
        if (!item) return;
        const panel = item.querySelector('.guest-orders-delivery-content-panel');
        const isExpanded = item.classList.contains('is-content-expanded');
        const nextExpanded = !isExpanded;

        item.classList.toggle('is-content-expanded', nextExpanded);
        surface.setAttribute('aria-expanded', String(nextExpanded));
        if (panel) {
            panel.setAttribute('aria-hidden', String(!nextExpanded));
        }
    }

    function toggleGuidance(button, type) {
        const item = button.closest('.guest-orders-delivery-item');
        if (!item) return;
        const panel = item.querySelector(`.guest-orders-delivery-guidance-panel--${type}`);
        if (!panel) return;

        const isExpanded = button.getAttribute('aria-expanded') === 'true';
        const nextExpanded = !isExpanded;

        if (nextExpanded) {
            item.querySelectorAll('[data-action="toggle-notes"], [data-action="toggle-usage"]').forEach((toggle) => {
                if (toggle !== button) {
                    toggle.setAttribute('aria-expanded', 'false');
                    toggle.classList.remove('is-active');
                }
            });
            item.querySelectorAll('.guest-orders-delivery-guidance-panel').forEach((candidate) => {
                if (candidate !== panel) {
                    candidate.hidden = true;
                }
            });
        }

        button.setAttribute('aria-expanded', String(nextExpanded));
        button.classList.toggle('is-active', nextExpanded);
        panel.hidden = !nextExpanded;
    }

    async function writeClipboardText(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (_) {}
        }
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            const success = document.execCommand('copy');
            document.body.removeChild(textarea);
            if (success) return true;
        } catch (_) {}
        return false;
    }

    async function handleCopyText(text, triggerButton) {
        if (!text) return;
        const success = await writeClipboardText(text);
        if (!success) {
            showError('当前浏览器不允许自动复制，请手动选择内容复制');
            return;
        }

        showShopToast('已复制');

        if (triggerButton) {
            triggerButton.classList.add('is-copied');
            const icon = triggerButton.querySelector('.guest-orders-item-no-copy-icon');
            if (icon) {
                icon.className = 'fas fa-check guest-orders-item-no-copy-icon';
            }
            window.setTimeout(() => {
                triggerButton.classList.remove('is-copied');
                if (icon) {
                    icon.className = 'far fa-copy guest-orders-item-no-copy-icon';
                }
            }, 1500);
        }
    }

    function bindDeliveryDelegation() {
        const list = element('guestOrdersDeliveryList');
        if (!list || list.dataset.delegationBound) return;
        list.dataset.delegationBound = 'true';

        list.addEventListener('click', (event) => {
            const target = event.target;
            if (!target) return;

            const copyAllBtn = target.closest('[data-action="copy-all"]');
            if (copyAllBtn) {
                event.stopPropagation();
                const content = copyAllBtn.dataset.allContent || '';
                void handleCopyText(content, copyAllBtn);
                return;
            }

            const itemCopyBtn = target.closest('[data-action="copy-item"]');
            if (itemCopyBtn) {
                event.stopPropagation();
                const content = itemCopyBtn.dataset.itemContent || '';
                void handleCopyText(content, itemCopyBtn);
                return;
            }

            const guidanceBtn = target.closest('[data-action="copy-guidance"]');
            if (guidanceBtn) {
                event.stopPropagation();
                const content = guidanceBtn.dataset.guidanceContent || '';
                void handleCopyText(content, guidanceBtn);
                return;
            }

            const notesToggle = target.closest('[data-action="toggle-notes"]');
            if (notesToggle) {
                event.stopPropagation();
                toggleGuidance(notesToggle, 'notice');
                return;
            }

            const usageToggle = target.closest('[data-action="toggle-usage"]');
            if (usageToggle) {
                event.stopPropagation();
                toggleGuidance(usageToggle, 'usage');
                return;
            }

            const cardKey = target.closest('[data-action="copy-card"]');
            if (cardKey) {
                event.stopPropagation();
                if (window.getSelection) {
                    try {
                        window.getSelection().removeAllRanges();
                    } catch (_) {}
                }
                const content = cardKey.dataset.cardContent || cardKey.querySelector('.guest-orders-delivery-card-key-text')?.textContent || '';
                void handleCopyText(content);
                return;
            }

            const surface = target.closest('[data-action="toggle-item-content"]');
            if (surface) {
                toggleItemContent(surface);
                return;
            }
        });

        list.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                const surface = event.target.closest('[data-action="toggle-item-content"]');
                if (surface && event.target === surface) {
                    event.preventDefault();
                    toggleItemContent(surface);
                }
            }
        });

        list.addEventListener('wheel', (event) => {
            const deltaY = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
            if (deltaY === 0) return;

            const guidanceContent = event.target ? event.target.closest('.guest-orders-delivery-guidance-content') : null;
            if (guidanceContent && guidanceContent.scrollHeight > guidanceContent.clientHeight + 1) {
                const canScrollUp = deltaY < 0 && guidanceContent.scrollTop > 0;
                const canScrollDown = deltaY > 0 && (guidanceContent.scrollTop + guidanceContent.clientHeight < guidanceContent.scrollHeight - 1);
                if (canScrollUp || canScrollDown) {
                    return;
                }
            }

            const canScrollList = list.scrollHeight > list.clientHeight + 1;
            if (canScrollList) {
                const canScrollUp = deltaY < 0 && list.scrollTop > 0;
                const canScrollDown = deltaY > 0 && (list.scrollTop + list.clientHeight < list.scrollHeight - 1);
                if (canScrollUp || canScrollDown) {
                    return;
                }
            }

            window.scrollBy({ top: deltaY, behavior: 'auto' });
        }, { passive: true });
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
    }

    async function loadOrders(page = 1) {
        const requestSerial = ++state.ordersRequestSerial;
        const payload = await requestJson(
            `${LIST_ENDPOINT}?${buildQuery({ page, pageSize: PAGE_SIZE, order_no: state.orderNoFilter })}`,
            { headers: credentialHeaders() }
        );
        // Pagination clicks and a fresh credential lookup can overlap. Only
        // the newest response may mutate the rendered result.
        if (requestSerial !== state.ordersRequestSerial) return;
        state.orders = Array.isArray(payload?.orders) ? payload.orders : [];
        state.pagination = payload?.pagination || null;
        state.page = Number(state.pagination?.page) || page;
        state.detail = null;
        state.detailRequestSerial += 1;
        state.deliveryRequestSerial += 1;
        clearDelivery();
        setHidden('guestOrdersResultCard', false);
        renderDetail();
        renderOrders();
    }

    async function openDetail(orderNo) {
        if (!orderNo) return;
        const detailSerial = ++state.detailRequestSerial;
        const deliverySerial = ++state.deliveryRequestSerial;
        state.ordersRequestSerial += 1;

        clearDelivery();
        setBusy(true);
        try {
            const [payload] = await Promise.all([
                requestJson(
                    `${DETAIL_ENDPOINT}?${buildQuery({ order_no: orderNo })}`,
                    { headers: credentialHeaders() }
                ),
                loadShopCatalog()
            ]);
            if (detailSerial !== state.detailRequestSerial) return;
            state.detail = payload?.order || null;
            if (payload?.order) {
                const orderKey = normalizeText(orderNo, 200);
                if (orderKey) {
                    orderDetailsCache.set(orderKey, payload.order);
                }
            }
            setHidden('guestOrdersResultCard', false);
            renderDetail();
            syncDetailUrl(orderNo);
            if (isDeliverable(state.detail)) {
                await loadDelivery(orderNo, deliverySerial);
            }
        } catch (error) {
            if (detailSerial === state.detailRequestSerial) {
                showError(describeError(error));
            }
        } finally {
            if (detailSerial === state.detailRequestSerial) {
                setBusy(false);
            }
        }
    }

    async function loadDelivery(orderNo, deliverySerial) {
        const hint = element('guestOrdersDeliveryHint');
        if (hint) {
            hint.textContent = '正在获取发货内容...';
            hint.hidden = false;
        }
        try {
            const [payload] = await Promise.all([
                requestJson(
                    `${DELIVERY_ENDPOINT}?${buildQuery({ order_no: orderNo })}`,
                    { headers: credentialHeaders() }
                ),
                loadShopCatalog().catch(() => null)
            ]);
            if (deliverySerial !== state.deliveryRequestSerial) return;
            state.delivery = payload || null;
            renderDelivery(payload, state.detail);
            setHidden('guestOrdersDeliveryPanel', false);
            if (hint) {
                hint.textContent = '';
                hint.hidden = true;
            }
        } catch (error) {
            if (deliverySerial !== state.deliveryRequestSerial) return;
            if (hint) {
                hint.textContent = '暂无法获取发货内容，请稍后刷新重试。';
                hint.hidden = false;
            }
            showError(describeError(error));
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

    function consumeUrlResetToken() {
        try {
            const url = new URL(window.location.href);
            const token = normalizeText(url.searchParams.get('reset'), 500);
            const site = normalizeSite(url.searchParams.get('site'));
            if (!token) return;
            url.searchParams.delete('reset');
            url.searchParams.delete('site');
            window.history.replaceState({}, '', url.toString());
            state.resetToken = token;
            state.resetSite = site;
        } catch (_) { /* file:// or a locked-down history API */ }
    }

    function readUrlOrderNo() {
        try {
            return normalizeText(new URL(window.location.href).searchParams.get('order_no'), 200);
        } catch (_) {
            return '';
        }
    }

    /**
     * Query credentials are intentionally session-only. A fresh page load must
     * start with empty fields; neither this page nor a password manager should
     * silently repopulate the live order credential.
     */
    function clearQueryCredentialFields() {
        for (const id of ['guestOrdersEmail', 'guestOrdersPassword']) {
            const input = element(id);
            if (input) input.value = '';
        }
    }

    /**
     * Browser password managers can ignore autocomplete=off and restore a
     * credential after the page script has run. Keep the live lookup fields
     * readonly until the buyer explicitly interacts with each field. This
     * blocks silent autofill while preserving normal mouse, touch, and
     * keyboard entry.
     */
    function unlockQueryCredentialField(event) {
        const input = event?.currentTarget;
        if (!input || input.readOnly !== true) return;
        input.readOnly = false;
        input.removeAttribute('readonly');
    }

    function lockQueryCredentialFields() {
        for (const id of ['guestOrdersEmail', 'guestOrdersPassword']) {
            const input = element(id);
            if (!input) continue;
            input.value = '';
            input.readOnly = true;
            input.setAttribute('readonly', '');
        }
        const orderNoInput = element('guestOrdersOrderNo');
        if (orderNoInput) {
            orderNoInput.value = '';
        }
    }

    function bindQueryCredentialAutofillGuard() {
        for (const id of ['guestOrdersEmail', 'guestOrdersPassword']) {
            const input = element(id);
            if (!input || input.dataset.autofillGuardBound === 'true') continue;
            input.dataset.autofillGuardBound = 'true';
            // pointerdown runs before focus, so a real click unlocks the field
            // before the browser can apply its focus-time autofill heuristic.
            input.addEventListener('pointerdown', unlockQueryCredentialField);
            input.addEventListener('touchstart', unlockQueryCredentialField, { passive: true });
            input.addEventListener('keydown', unlockQueryCredentialField);
            // Keyboard users can reach the field with Tab rather than a
            // pointer. The focus is still a user-visible interaction.
            input.addEventListener('focus', unlockQueryCredentialField);
        }
    }

    function foldPassword(input) {
        const raw = typeof input === 'string' ? input : String(input?.value ?? '');
        const module = globalThis.GuestQueryPassword || null;
        const value = module && typeof module.foldFullwidth === 'function'
            ? module.foldFullwidth(raw).slice(0, 64)
            : raw.slice(0, 64);
        if (input && typeof input === 'object' && 'value' in input && value !== raw) input.value = value;
        return value;
    }

    function showFormMessage(id, message, tone = 'danger') {
        const node = element(id);
        if (!node) return;
        node.textContent = normalizeText(message, 300);
        node.dataset.tone = message ? tone : '';
        node.hidden = !message;
    }

    function syncPolicyLine(noteId, password, confirm) {
        const failure = policyFailure(password);
        const mismatch = password !== confirm ? '两次输入的查询密码不一致。' : '';
        const message = failure || mismatch;
        showFormMessage(noteId, message, message ? 'danger' : 'ok');
        return !message;
    }

    function policyFailure(value) {
        const module = globalThis.GuestQueryPassword || null;
        return module && typeof module.policyFailure === 'function' ? module.policyFailure(value) : null;
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
     * After a successful reset the buyer is already signed in (the
     * endpoint set the session cookie), so hand the page back to the normal
     * lookup flow with the new credential pre-filled and the list loaded.
     */
    async function finishCredentialSetup(email, password, site) {
        persistAuth({ email, password, site });
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

    function bindBaseListeners() {
        if (state.baseListenersBound) return;
        state.baseListenersBound = true;
        element('guestOrdersFeatureRetryBtn')?.addEventListener('click', () => {
            void initializeOrderAccessPage();
        });
    }

    function initializeOrderAccessFeatures() {
        if (state.orderAccessInitialized) return;
        state.orderAccessInitialized = true;
        element('guestOrdersQueryForm')?.addEventListener('submit', handleSubmit);
        bindQueryCredentialAutofillGuard();
        element('guestOrdersTogglePasswordBtn')?.addEventListener('click', (event) => {
            togglePasswordVisibility(event.currentTarget);
        });
        bindDeliveryDelegation();
        element('guestOrdersBackToListBtn')?.addEventListener('click', () => {
            state.detail = null;
            state.detailRequestSerial += 1;
            state.deliveryRequestSerial += 1;
            clearDelivery();
            syncDetailUrl('');
            renderDetail();
            renderOrders();
        });
        element('guestOrdersPrevBtn')?.addEventListener('click', () => {
            if (state.page > 1) void loadOrders(state.page - 1);
        });
        element('guestOrdersNextBtn')?.addEventListener('click', () => { void loadOrders(state.page + 1); });
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

        // An arriving support link outranks a saved credential and a ?order_no=
        // deep link: the buyer came to SET a password, not to reuse one. The
        // token was moved into memory immediately after its URL was scrubbed, so
        // this still works after one or more failed availability probes.
        if (state.resetToken) activateResetCard(state.resetToken, state.resetSite);
        const deepLinkOrderNo = state.resetToken ? '' : readUrlOrderNo();
        const orderNoInput = element('guestOrdersOrderNo');
        if (orderNoInput) {
            orderNoInput.value = '';
        }
        if (deepLinkOrderNo) {
            syncDetailUrl('');
        }
    }

    async function initializeOrderAccessPage() {
        if (state.orderAccessInitialized || state.availabilityLoading) return;
        state.availabilityLoading = true;
        try {
            const available = await loadOrderAccessAvailability();
            if (available) initializeOrderAccessFeatures();
        } finally {
            state.availabilityLoading = false;
        }
    }

    async function init() {
        // FIRST, before any request or rendering: scrub the one-time bearer from
        // the address bar and retain it only in memory for a possible retry.
        consumeUrlResetToken();
        // Clear both application storage and any browser-restored values before
        // the availability probe can leave the visible form on screen.
        clearSavedAuth();
        lockQueryCredentialFields();
        bindQueryCredentialAutofillGuard();
        window.setTimeout(lockQueryCredentialFields, 0);
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('pageshow', () => {
                // bfcache restores can happen after the initial load and may also
                // reapply a browser-managed credential. Re-lock and clear again.
                lockQueryCredentialFields();
            });
        }
        bindBaseListeners();
        await initializeOrderAccessPage();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void init(); }, { once: true });
    else void init();
})();
