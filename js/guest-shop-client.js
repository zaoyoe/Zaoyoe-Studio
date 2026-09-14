'use strict';

/*
 * Guest checkout is deliberately kept outside ShopClient's points flow. The
 * server owns price, stock, payment state and fulfilment; this client only
 * carries only a non-sensitive order handle in memory/sessionStorage. The
 * claim proof is kept in the server-issued encrypted HttpOnly cookie.
 */
(() => {
    const STORAGE_KEY = 'guest_shop_checkout_v1';
    const STORAGE_VERSION = 3;
    const POLL_INTERVAL_MS = 3500;
    const POLL_MAX_MS = 15 * 60 * 1000;
    const PREVIEW_ENDPOINT = '/api/shop/guest/preview';
    const ORDER_ENDPOINT = '/api/shop/guest/orders';
    const STATUS_ENDPOINT = '/api/shop/guest/status';
    const CLAIM_ENDPOINT = '/api/shop/guest/claim';
    const RECOVERY_ENDPOINT = '/api/shop/guest/recover';

    const state = {
        preview: null,
        previewKey: '',
        previewPending: false,
        previewError: false,
        orderNo: '',
        idempotencyKey: '',
        site: '',
        productId: '',
        skuId: '',
        expiresAt: '',
        provider: '',
        channel: '',
        recoveryCode: '',
        checkout: null,
        status: 'configure',
        pollTimer: null,
        pollStartedAt: 0,
        pollGeneration: 0,
        pollActiveGeneration: null,
        requestInFlight: false,
        claimInFlight: false,
        contextKey: ''
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

    function getPurchaseContext() {
        const purchase = window.ShopClient?.currentPurchase;
        const productId = normalizeText(purchase?.productId, 100);
        const skuId = normalizeText(purchase?.productSkuId, 100);
        if (!productId || !skuId) return null;
        return {
            productId,
            skuId,
            site: normalizeSite(window.SiteConfig?.site),
            productName: normalizeText(
                window.ShopClient?.isEnglishShopLocale?.() && purchase?.productNameEn
                    ? purchase.productNameEn
                    : purchase?.productName,
                240
            ),
            skuName: normalizeText(purchase?.productSkuName, 240),
            manualDelivery: purchase?.manualDelivery === true,
            soldOut: purchase?.soldOut === true,
            contextKey: [normalizeSite(window.SiteConfig?.site), productId, skuId].join(':')
        };
    }

    function getModal() {
        return element('guestCashPurchaseModal');
    }

    function setText(id, value) {
        const node = element(id);
        if (node) node.textContent = normalizeText(value, 10000);
    }

    function setHidden(id, hidden) {
        const node = element(id);
        if (!node) return;
        node.hidden = Boolean(hidden);
        if (hidden) node.setAttribute('aria-hidden', 'true');
        else node.removeAttribute('aria-hidden');
    }

    function setStateMessage(message, status = state.status) {
        state.status = status;
        const node = element('guestCashState');
        if (!node) return;
        node.textContent = normalizeText(message, 500);
        node.dataset.state = status;
    }

    function setActionBusy(button, busy, busyText = '处理中...') {
        if (!button) return;
        if (busy) {
            if (!button.dataset.originalText) button.dataset.originalText = button.textContent || '';
            button.textContent = busyText;
        } else if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
            delete button.dataset.originalText;
        }
        button.disabled = Boolean(busy);
        button.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function getSessionStorage() {
        try {
            return window.sessionStorage;
        } catch (_) {
            return null;
        }
    }

    function storedCheckout() {
        const storage = getSessionStorage();
        if (!storage) return null;
        try {
            const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
            if (!parsed || parsed.version !== STORAGE_VERSION) {
                // Version 2 persisted the idempotency key, which is also used
                // by the server to derive the claim proof. Remove stale data
                // rather than leaving credential material in sessionStorage.
                if (parsed) storage.removeItem(STORAGE_KEY);
                return null;
            }
            if (!normalizeText(parsed.orderNo, 200)) return null;
            if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= Date.now()) {
                storage.removeItem(STORAGE_KEY);
                return null;
            }
            return parsed;
        } catch (_) {
            return null;
        }
    }

    function persistCheckout() {
        if (!state.orderNo) return;
        const storage = getSessionStorage();
        if (!storage) return;
        try {
            storage.setItem(STORAGE_KEY, JSON.stringify({
                version: STORAGE_VERSION,
                orderNo: state.orderNo,
                site: state.site,
                productId: state.productId,
                skuId: state.skuId,
                expiresAt: state.expiresAt,
                provider: state.provider,
                channel: state.channel,
                savedAt: new Date().toISOString()
            }));
        } catch (_) {
            // A storage failure does not invalidate the in-memory checkout.
        }
    }

    function hydrateCheckout(parsed) {
        if (!parsed) return false;
        state.orderNo = normalizeText(parsed.orderNo, 200);
        state.idempotencyKey = '';
        state.site = normalizeSite(parsed.site);
        state.productId = normalizeText(parsed.productId, 100);
        state.skuId = normalizeText(parsed.skuId, 100);
        state.contextKey = state.productId && state.skuId
            ? [state.site, state.productId, state.skuId].join(':')
            : '';
        state.expiresAt = normalizeText(parsed.expiresAt, 80);
        state.provider = normalizeText(parsed.provider, 80).toLowerCase();
        state.channel = normalizeText(parsed.channel, 80).toLowerCase();
        return Boolean(state.orderNo);
    }

    function hydrateReturnOrderNo(orderNo) {
        const normalized = normalizeText(orderNo, 200);
        if (!normalized) return false;
        // A provider return can open in a new top-level browsing context where
        // sessionStorage is empty. Keep only the non-sensitive order handle;
        // status/claim endpoints still require the HttpOnly proof cookie.
        state.orderNo = normalized;
        state.idempotencyKey = '';
        state.site = normalizeSite(window.SiteConfig?.site);
        state.productId = '';
        state.skuId = '';
        state.expiresAt = '';
        state.provider = '';
        state.channel = '';
        state.checkout = null;
        state.contextKey = '';
        state.status = 'checking';
        return true;
    }

    function clearQueryReturnMarker() {
        try {
            const url = new URL(window.location.href);
            let changed = false;
            ['order_no', 'orderNo', 'success', 'payment_status'].forEach((key) => {
                if (url.searchParams.has(key)) {
                    url.searchParams.delete(key);
                    changed = true;
                }
            });
            if (changed) window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
        } catch (_) {
            // Invalid location objects are not actionable in a browser page.
        }
    }

    function readReturnOrderNo() {
        try {
            const url = new URL(window.location.href);
            return normalizeText(url.searchParams.get('order_no') || url.searchParams.get('orderNo'), 200);
        } catch (_) {
            return '';
        }
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
            const error = new Error(normalizeText(payload?.message, 300) || '游客购买请求失败');
            error.code = normalizeText(payload?.code, 100);
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function normalizePaymentOptions(channels) {
        const result = [];
        const seen = new Set();
        (Array.isArray(channels) ? channels : []).forEach((raw) => {
            const token = normalizeText(raw, 160).toLowerCase();
            if (!token || /[^a-z0-9:_-]/u.test(token)) return;
            let provider = '';
            let channel = '';
            if (token.includes(':')) {
                const parts = token.split(':');
                provider = parts[0];
                channel = parts[1];
            } else if (token === 'zpay' || token === 'nowpayments') {
                provider = token;
                channel = token === 'zpay' ? 'alipay' : 'usdtbsc';
            } else if (['alipay', 'wxpay', 'qqpay', 'tenpay', 'unionpay'].includes(token)) {
                provider = 'zpay';
                channel = token;
            } else if (token === 'usdtbsc') {
                provider = 'nowpayments';
                channel = token;
            }
            if (!provider || !channel || ['mock', 'test', 'fake'].includes(provider)) return;
            const key = `${provider}:${channel}`;
            if (seen.has(key)) return;
            seen.add(key);
            result.push({ provider, channel, key });
        });
        return result;
    }

    function paymentLabel(option) {
        if (option.provider === 'nowpayments') return 'USDT-BEP20（NOWPayments）';
        if (option.channel === 'wxpay') return '微信支付';
        if (option.channel === 'qqpay') return 'QQ钱包';
        return '支付宝';
    }

    function renderPaymentOptions(options) {
        const select = element('guestCashPaymentChannel');
        if (!select) return;
        select.textContent = '';
        options.forEach((option) => {
            const item = document.createElement('option');
            item.value = option.key;
            item.dataset.provider = option.provider;
            item.dataset.channel = option.channel;
            item.textContent = paymentLabel(option);
            select.appendChild(item);
        });
        select.disabled = options.length < 2;
    }

    function formatAmount(amount, currency) {
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) return '-';
        const code = normalizeText(currency, 8).toUpperCase();
        try {
            return new Intl.NumberFormat(code === 'USD' ? 'en-US' : 'zh-CN', {
                style: 'currency',
                currency: code === 'USD' ? 'USD' : 'CNY',
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(value);
        } catch (_) {
            return `${code === 'USD' ? '$' : '¥'}${value.toFixed(2)}`;
        }
    }

    function renderPreview(context, preview) {
        state.preview = preview;
        state.previewKey = context.contextKey;
        const product = preview?.product || {};
        const price = preview?.price || {};
        const options = normalizePaymentOptions(preview?.payment_channels);
        setText('guestCashProductName', product.name || context.productName || '-');
        setText('guestCashSkuName', product.sku_name || context.skuName || '-');
        setText('guestCashPrice', formatAmount(price.amount, price.currency));
        renderPaymentOptions(options);
        state.previewError = options.length === 0;
        setHidden('guestCashCreateOrderBtn', options.length === 0);
        if (options.length === 0) {
            setStateMessage('当前商品暂未开放游客支付', 'error');
            return false;
        }
        setStateMessage('请选择支付方式并创建订单', 'configure');
        return true;
    }

    async function loadPreview(context, { revealButton = true } = {}) {
        if (!context || context.manualDelivery || context.soldOut) return false;
        if (state.previewKey === context.contextKey && state.preview) {
            if (revealButton && !state.previewError) setHidden('guestCashPurchaseBtn', false);
            return !state.previewError;
        }
        if (state.previewPending) return false;
        state.previewPending = true;
        state.previewError = false;
        const query = new URLSearchParams({
            site: context.site,
            productId: context.productId,
            skuId: context.skuId
        });
        try {
            const payload = await requestJson(`${PREVIEW_ENDPOINT}?${query.toString()}`, { method: 'GET' });
            const available = renderPreview(context, payload);
            if (revealButton) setHidden('guestCashPurchaseBtn', !available);
            return available;
        } catch (error) {
            state.previewKey = context.contextKey;
            state.preview = null;
            state.previewError = true;
            if (revealButton) setHidden('guestCashPurchaseBtn', true);
            if (!getModal()?.hidden) setStateMessage(error.message || '游客支付暂不可用', 'error');
            return false;
        } finally {
            state.previewPending = false;
        }
    }

    function safeHttpsUrl(value) {
        try {
            const parsed = new URL(normalizeText(value, 2000), window.location.origin);
            return parsed.protocol === 'https:' ? parsed.toString() : '';
        } catch (_) {
            return '';
        }
    }

    function checkoutDetails(checkout) {
        const source = checkout?.checkout && typeof checkout.checkout === 'object'
            ? { ...checkout, ...checkout.checkout }
            : (checkout && typeof checkout === 'object' ? checkout : {});
        return {
            provider: normalizeText(source.provider, 80).toLowerCase(),
            channel: normalizeText(source.channel, 80).toLowerCase(),
            checkoutUrl: safeHttpsUrl(source.checkout_url || source.payment_url),
            address: normalizeText(source.pay_address || source.qr_data, 240),
            payAmount: normalizeText(source.pay_amount_text || source.pay_amount, 80),
            payCurrency: normalizeText(source.pay_currency, 40).toUpperCase(),
            network: normalizeText(source.network_name || 'BNB Smart Chain', 80)
        };
    }

    function renderCheckout(checkout) {
        const details = checkoutDetails(checkout);
        state.checkout = details;
        setHidden('guestCashCheckoutPanel', false);
        setHidden('guestCashZpayPanel', details.provider !== 'zpay');
        setHidden('guestCashNowpaymentsPanel', details.provider !== 'nowpayments');
        const link = element('guestCashCheckoutLink');
        if (link) {
            link.href = details.checkoutUrl || '#';
            link.hidden = !details.checkoutUrl;
            link.setAttribute('aria-disabled', details.checkoutUrl ? 'false' : 'true');
        }
        setText('guestCashNowNetwork', details.network);
        setText('guestCashNowAmount', details.payAmount && details.payCurrency
            ? `${details.payAmount} ${details.payCurrency}`
            : '-');
        setText('guestCashNowAddress', details.address || '-');
        if (details.provider === 'zpay' && !details.checkoutUrl) {
            setStateMessage('支付页面链接无效，请稍后重试或联系客服', 'manual_review');
        }
        if (details.provider === 'nowpayments' && (!details.address || details.payCurrency !== 'USDTBSC')) {
            setStateMessage('加密货币支付信息无效，请联系客服', 'manual_review');
        }
    }

    function selectedPayment() {
        const select = element('guestCashPaymentChannel');
        const option = select?.selectedOptions?.[0];
        return {
            provider: normalizeText(option?.dataset?.provider, 80).toLowerCase(),
            channel: normalizeText(option?.dataset?.channel, 80).toLowerCase()
        };
    }

    function newIdempotencyKey() {
        if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
        if (typeof globalThis.crypto?.getRandomValues === 'function') {
            const bytes = new Uint8Array(16);
            globalThis.crypto.getRandomValues(bytes);
            return `guest_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
        }
        throw new Error('当前浏览器不支持安全下单，请升级浏览器后重试');
    }

    function resetActiveOrderForContext(context) {
        if (!context || !state.orderNo || !state.contextKey || state.contextKey === context.contextKey) return;
        // A live order belongs to the product/SKU that created it. When the
        // authenticated purchase modal switches selection, never show or poll
        // that order in the new guest checkout dialog. Keep sessionStorage
        // untouched so a refresh can still recover the original order.
        stopPolling();
        state.orderNo = '';
        state.idempotencyKey = '';
        state.expiresAt = '';
        state.provider = '';
        state.channel = '';
        state.checkout = null;
        state.status = 'configure';
        resetOrderUi();
    }

    function openGuestModal(context) {
        const modal = getModal();
        if (!modal) return;
        if (context) {
            resetActiveOrderForContext(context);
            state.contextKey = context.contextKey;
            state.site = context.site;
            state.productId = context.productId;
            state.skuId = context.skuId;
            setText('guestCashProductName', context.productName || '-');
            setText('guestCashSkuName', context.skuName || '-');
        }
        modal.hidden = false;
        modal.classList.add('active');
        document.body?.classList.add('guest-shop-modal-open');
        setHidden('guestCashDeliveryPanel', state.status !== 'delivered');
        setHidden('guestCashCheckoutPanel', !state.checkout || state.status === 'delivered');
        if (state.orderNo) {
            // An existing order is resumed by order number + server cookie.
            // Do not let a preview failure overwrite its payment status, and
            // do not offer a second create action for the same idempotent order.
            setHidden('guestCashCreateOrderBtn', true);
            setHidden('guestCashCheckStatusBtn', state.status === 'delivered');
        } else {
            setHidden('guestCashCreateOrderBtn', false);
            setHidden('guestCashCheckStatusBtn', true);
            setStateMessage('正在确认商品信息...', 'configure');
            void loadPreview(context || getPurchaseContext(), { revealButton: false });
        }
        if (state.orderNo) {
            void pollStatus({ immediate: true });
        }
    }

    function closeGuestModal() {
        stopPolling();
        const modal = getModal();
        if (!modal) return;
        modal.hidden = true;
        modal.classList.remove('active');
        document.body?.classList.remove('guest-shop-modal-open');
    }

    function resetOrderUi({ preserveRecovery = false } = {}) {
        setHidden('guestCashCheckoutPanel', true);
        setHidden('guestCashDeliveryPanel', true);
        setHidden('guestCashCheckStatusBtn', true);
        setHidden('guestCashCreateOrderBtn', false);
        const link = element('guestCashCheckoutLink');
        if (link) {
            link.href = '#';
            link.hidden = false;
        }
        setText('guestCashDeliveredContent', '');
        state.checkout = null;
        if (!preserveRecovery) {
            state.recoveryCode = '';
            setHidden('guestCashRecoveryCodePanel', true);
            setText('guestCashRecoveryCode', '');
        }
        setHidden('guestCashRecoveryPanel', true);
    }

    function showRecoveryCode(code) {
        const normalized = normalizeText(code, 200);
        if (!/^[A-Za-z0-9_-]{40,200}$/u.test(normalized)) return;
        // Create retries may re-emit the same derived code. Show it only once
        // in this browsing context and never persist it to storage or URLs.
        if (state.recoveryCode) return;
        state.recoveryCode = normalized;
        setText('guestCashRecoveryCode', normalized);
        setHidden('guestCashRecoveryCodePanel', false);
    }

    async function createOrder() {
        if (state.requestInFlight) return;
        const context = getPurchaseContext();
        if (!context || context.manualDelivery || context.soldOut) {
            setStateMessage('当前商品不支持游客购买', 'error');
            return;
        }
        if (!(await loadPreview(context, { revealButton: false }))) return;
        const payment = selectedPayment();
        if (!payment.provider || !payment.channel) {
            setStateMessage('请选择有效的支付方式', 'error');
            return;
        }
        const email = normalizeText(element('guestCashContact')?.value, 160);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
            setStateMessage('邮箱格式不正确', 'error');
            return;
        }
        if (!state.idempotencyKey) {
            try {
                state.idempotencyKey = newIdempotencyKey();
            } catch (error) {
                setStateMessage(error?.message || '当前浏览器不支持安全下单，请升级浏览器后重试', 'error');
                return;
            }
        }
        state.requestInFlight = true;
        const button = element('guestCashCreateOrderBtn');
        setActionBusy(button, true);
        setStateMessage('正在创建支付订单...', 'creating');
        const body = {
            site: context.site,
            productId: context.productId,
            skuId: context.skuId,
            quantity: 1,
            idempotencyKey: state.idempotencyKey,
            provider: payment.provider,
            channel: payment.channel
        };
        if (email) body.email = email;
        try {
            const payload = await requestJson(ORDER_ENDPOINT, {
                method: 'POST',
                body: JSON.stringify(body)
            });
            const order = payload?.order || {};
            const orderNo = normalizeText(order.order_no, 200);
            if (!orderNo) throw new Error('订单凭证缺失，请联系客服');
            state.orderNo = orderNo;
            state.site = context.site;
            state.productId = context.productId;
            state.skuId = context.skuId;
            state.expiresAt = normalizeText(order.expires_at, 80);
            state.provider = payment.provider;
            state.channel = payment.channel;
            state.status = 'awaiting_payment';
            persistCheckout();
            resetOrderUi({ preserveRecovery: Boolean(state.recoveryCode) });
            showRecoveryCode(order.recovery_code);
            if (payload.checkout) renderCheckout(payload.checkout);
            setHidden('guestCashCreateOrderBtn', true);
            setHidden('guestCashCheckStatusBtn', false);
            setStateMessage('订单已创建，请完成支付；回跳页面不会直接视为支付成功。', 'awaiting_payment');
            if (!getModal()?.hidden) startPolling();
        } catch (error) {
            state.status = error?.code === 'guest_payment_reconciliation_required' ? 'manual_review' : 'error';
            setStateMessage(error?.message || '支付订单创建失败，请稍后重试', state.status);
        } finally {
            state.requestInFlight = false;
            setActionBusy(button, false);
        }
    }

    async function recoverOrder() {
        const orderNo = normalizeText(element('guestCashRecoveryOrderNo')?.value, 200);
        const recoveryCode = normalizeText(element('guestCashRecoveryCodeInput')?.value, 200);
        if (!orderNo || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u.test(orderNo)
            || !/^[A-Za-z0-9_-]{40,200}$/u.test(recoveryCode)) {
            setStateMessage('请输入订单号和取货口令', 'error');
            return;
        }
        const button = element('guestCashRecoverBtn');
        setActionBusy(button, true, '正在找回...');
        try {
            const payload = await requestJson(RECOVERY_ENDPOINT, {
                method: 'POST',
                body: JSON.stringify({ orderNo, recoveryCode })
            });
            const order = payload?.order || {};
            state.orderNo = normalizeText(order.order_no || orderNo, 200);
            state.site = normalizeSite(window.SiteConfig?.site);
            state.expiresAt = normalizeText(order.expires_at, 80);
            state.status = normalizeText(order.payment_status, 80).toLowerCase() || 'checking';
            state.recoveryCode = '';
            persistCheckout();
            if (payload.checkout) renderCheckout(payload.checkout);
            setHidden('guestCashRecoveryPanel', true);
            setHidden('guestCashCreateOrderBtn', true);
            setHidden('guestCashCheckStatusBtn', false);
            setStateMessage('订单已找回，正在核验支付状态。', 'checking');
            startPolling();
        } catch (error) {
            setStateMessage(error?.message || '订单找回失败，请检查订单号和取货口令', error?.status === 403 ? 'error' : 'manual_review');
        } finally {
            setActionBusy(button, false);
        }
    }

    async function fetchStatus() {
        if (!state.orderNo) return null;
        const query = new URLSearchParams({ orderNo: state.orderNo });
        return requestJson(`${STATUS_ENDPOINT}?${query.toString()}`, {
            method: 'GET',
            credentials: 'same-origin'
        });
    }

    async function claimDelivery(expectedGeneration = state.pollGeneration) {
        if (state.claimInFlight || !state.orderNo) return;
        state.claimInFlight = true;
        try {
            const payload = await requestJson(CLAIM_ENDPOINT, {
                method: 'POST',
                credentials: 'same-origin',
                body: JSON.stringify({ orderNo: state.orderNo })
            });
            if (expectedGeneration !== state.pollGeneration) return;
            state.status = 'delivered';
            setText('guestCashDeliveredContent', payload.content || '');
            setHidden('guestCashDeliveryPanel', false);
            setHidden('guestCashCheckoutPanel', true);
            setHidden('guestCashCheckStatusBtn', true);
            setStateMessage('支付已确认，订单已发货。', 'delivered');
            stopPolling();
            persistCheckout();
        } catch (error) {
            if (expectedGeneration !== state.pollGeneration) return;
            if (error?.code === 'guest_order_not_delivered') {
                setStateMessage('支付已确认，正在等待发货...', 'checking');
            } else {
                setStateMessage(error?.message || '取货失败，请保留订单号联系客服', 'manual_review');
                stopPolling();
            }
        } finally {
            state.claimInFlight = false;
        }
    }

    async function pollStatus({ immediate = false, resetWindow = false } = {}) {
        if (!state.orderNo) return;
        if (resetWindow) stopPolling();
        if (state.pollTimer) return;
        const generation = state.pollGeneration;
        if (state.pollActiveGeneration === generation) return;
        state.pollStartedAt = state.pollStartedAt || Date.now();
        const run = async () => {
            if (generation !== state.pollGeneration || !state.orderNo) return;
            state.pollTimer = null;
            state.pollActiveGeneration = generation;
            let shouldContinue = true;
            if (Date.now() - state.pollStartedAt > POLL_MAX_MS) {
                setStateMessage('自动核验已暂停，请点击“查询支付状态”继续。', 'manual_review');
                state.pollStartedAt = 0;
                state.pollActiveGeneration = null;
                return;
            }
            try {
                const payload = await fetchStatus();
                if (generation !== state.pollGeneration || !state.orderNo) return;
                if (payload?.checkout && !state.checkout) renderCheckout(payload.checkout);
                const order = payload?.order || {};
                const paymentStatus = normalizeText(order.payment_status, 80).toLowerCase();
                const fulfillmentStatus = normalizeText(order.fulfillment_status, 80).toLowerCase();
                if (paymentStatus === 'confirmed' && fulfillmentStatus === 'delivered') {
                    // Do not let a stale poll generation claim after the user
                    // switched products or reset the active order.
                    if (generation === state.pollGeneration) {
                        await claimDelivery(generation);
                        // A just-confirmed order may race the fulfilment worker.
                        // claimDelivery() leaves the state as `checking` for that
                        // transient case, so keep polling until delivery succeeds.
                        shouldContinue = state.status === 'checking';
                    } else {
                        shouldContinue = false;
                    }
                } else if (['failed', 'expired', 'refunded', 'chargeback', 'amount_mismatch', 'overpaid', 'partial'].includes(paymentStatus)) {
                    setStateMessage('订单支付未完成或已关闭，请勿重复付款。', 'error');
                    shouldContinue = false;
                } else {
                    setStateMessage(
                        paymentStatus === 'confirmed' ? '支付已确认，正在等待发货...' : '等待支付确认，请完成付款后保持页面打开。',
                        'checking'
                    );
                }
            } catch (error) {
                if (generation !== state.pollGeneration || !state.orderNo) return;
                if (error?.status === 403 || error?.code === 'guest_claim_invalid') {
                    setStateMessage('当前设备的取货凭证不可用，请勿重复付款，请联系客服恢复订单。', 'manual_review');
                    shouldContinue = false;
                } else {
                    setStateMessage('暂时无法查询支付状态，将自动重试。', 'checking');
                }
            } finally {
                if (state.pollActiveGeneration === generation) state.pollActiveGeneration = null;
            }
            if (shouldContinue && generation === state.pollGeneration && state.orderNo) {
                state.pollTimer = window.setTimeout(run, POLL_INTERVAL_MS);
            }
        };
        if (immediate) await run();
        else state.pollTimer = window.setTimeout(run, 0);
    }

    function startPolling() {
        stopPolling();
        state.pollStartedAt = Date.now();
        void pollStatus({ immediate: true });
    }

    function stopPolling() {
        state.pollGeneration += 1;
        if (state.pollTimer) window.clearTimeout(state.pollTimer);
        state.pollTimer = null;
        state.pollStartedAt = 0;
        state.pollActiveGeneration = null;
    }

    async function copyText(value, button) {
        const text = String(value || '');
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
        } catch (_) {
            const input = document.createElement('textarea');
            input.value = text;
            input.setAttribute('readonly', 'true');
            input.style.position = 'fixed';
            input.style.opacity = '0';
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            input.remove();
        }
        if (button) {
            const original = button.textContent;
            button.textContent = '已复制';
            window.setTimeout(() => { button.textContent = original; }, 1600);
        }
    }

    function syncPurchaseButton() {
        const button = element('guestCashPurchaseBtn');
        const modal = element('shopPurchaseModal');
        const context = getPurchaseContext();
        const active = Boolean(modal && !modal.hidden && modal.classList.contains('active'));
        if (!button || !active || !context || context.manualDelivery || context.soldOut) {
            if (button) setHidden('guestCashPurchaseBtn', true);
            return;
        }
        if (state.previewKey !== context.contextKey && !state.previewPending) {
            void loadPreview(context, { revealButton: true });
        }
        if (state.previewKey === context.contextKey && state.preview && !state.previewError) {
            setHidden('guestCashPurchaseBtn', false);
        }
    }

    function handlePurchaseButtonClick(event) {
        const target = event.target instanceof Element ? event.target.closest('#guestCashPurchaseBtn') : null;
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        openGuestModal(getPurchaseContext());
    }

    function handleGuestModalClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        if (target === getModal() || target.closest('#guestCashPurchaseCloseBtn, #guestCashPurchaseDismissBtn')) {
            event.preventDefault();
            closeGuestModal();
            return;
        }
        const createButton = target.closest('#guestCashCreateOrderBtn');
        if (createButton) {
            event.preventDefault();
            void createOrder();
            return;
        }
        const recoverButton = target.closest('#guestCashRecoverBtn');
        if (recoverButton) {
            event.preventDefault();
            void recoverOrder();
            return;
        }
        const showRecoveryButton = target.closest('#guestCashShowRecoveryBtn');
        if (showRecoveryButton) {
            event.preventDefault();
            const panel = element('guestCashRecoveryPanel');
            if (panel) {
                panel.hidden = !panel.hidden;
                panel.setAttribute('aria-hidden', panel.hidden ? 'true' : 'false');
            }
            return;
        }
        const statusButton = target.closest('#guestCashCheckStatusBtn');
        if (statusButton) {
            event.preventDefault();
            void pollStatus({ immediate: true, resetWindow: true });
            return;
        }
        const addressButton = target.closest('#guestCashNowCopyAddressBtn');
        if (addressButton) {
            event.preventDefault();
            void copyText(element('guestCashNowAddress')?.textContent || '', addressButton);
            return;
        }
        const deliveryButton = target.closest('#guestCashCopyDeliveryBtn');
        if (deliveryButton) {
            event.preventDefault();
            void copyText(element('guestCashDeliveredContent')?.textContent || '', deliveryButton);
        }
        const recoveryCopyButton = target.closest('#guestCashCopyRecoveryCodeBtn');
        if (recoveryCopyButton) {
            event.preventDefault();
            void copyText(element('guestCashRecoveryCode')?.textContent || '', recoveryCopyButton);
        }
    }

    function maybeRestoreReturn() {
        const saved = storedCheckout();
        const returnOrderNo = readReturnOrderNo();
        if (returnOrderNo) {
            // The provider return may be opened in a fresh tab, so a matching
            // sessionStorage record is optional. The server-side claim cookie
            // remains the authority; an arbitrary URL handle cannot reveal an
            // order through the 403-generic status endpoint.
            if (saved && saved.orderNo !== returnOrderNo) {
                // Never let a return URL replace a different persisted order.
                hydrateReturnOrderNo(returnOrderNo);
            } else {
                if (saved && saved.orderNo === returnOrderNo) hydrateCheckout(saved);
                else hydrateReturnOrderNo(returnOrderNo);
            }
            clearQueryReturnMarker();
            openGuestModal(null);
            setStateMessage('正在核验支付状态，回跳页面不会直接视为支付成功。', 'checking');
            return;
        }
        if (!saved) {
            clearQueryReturnMarker();
            return;
        }
        hydrateCheckout(saved);
        clearQueryReturnMarker();
        const context = getPurchaseContext();
        // A persisted order can outlive the currently selected product/SKU.
        // Restore it without passing a mismatched context through
        // resetActiveOrderForContext(), so the user can still query/claim the
        // original order after a refresh.
        openGuestModal(context?.contextKey === state.contextKey ? context : null);
        setStateMessage('正在核验支付状态，回跳页面不会直接视为支付成功。', 'checking');
    }

    function init() {
        document.addEventListener('click', handlePurchaseButtonClick, true);
        getModal()?.addEventListener('click', handleGuestModalClick);
        const stored = storedCheckout();
        if (stored) hydrateCheckout(stored);
        window.setInterval(syncPurchaseButton, 350);
        maybeRestoreReturn();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
