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
    // Once payment is confirmed, provider polling is no longer the bottleneck:
    // the worker only needs to finish the reserved inventory claim. Poll that
    // short transition more closely so the buyer sees delivery promptly while
    // keeping the normal unpaid-order polling interval unchanged.
    const CONFIRMED_FULFILLMENT_POLL_INTERVAL_MS = 1000;
    // Smart polling intervals optimize for different order states: aggressive
    // polling right after payment confirmation (when fulfillment is imminent),
    // backing off when backend throttling is detected, and providing rapid
    // feedback during active fulfillment. This reduces perceived wait time
    // without hammering the backend unnecessarily.
    const SMART_POLL_INTERVALS = Object.freeze({
        AWAITING_PAYMENT: 3500,           // Waiting for payment
        PAYMENT_JUST_CONFIRMED: 800,      // 0-3s after confirmation (aggressive)
        PAYMENT_CONFIRMED_EARLY: 1200,    // 3-10s after confirmation
        PAYMENT_CONFIRMED_LATE: 2000,     // 10s+ after confirmation
        FULFILLING: 600,                  // Active fulfillment (most aggressive)
        THROTTLED_HINT: 5000              // Backend throttle detected
    });
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
        paymentConfirmed: false,
        status: 'configure',
        pollTimer: null,
        pollStartedAt: 0,
        pollGeneration: 0,
        pollActiveGeneration: null,
        requestInFlight: false,
        claimInFlight: false,
        contextKey: '',
        zpayCountdownTimer: null,
        confirmedPricing: null,
        paymentConfirmedAt: null,         // Timestamp when payment was confirmed
        lastStatusQueryTime: null,        // Last backend provider query time
        smartPollingEnabled: true         // Smart polling feature flag
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
        if (status === 'delivered' || status === 'confirmed') {
            state.paymentConfirmed = true;
        }
        syncAbandonOrderButton();
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
        state.paymentConfirmed = false;
        return Boolean(state.orderNo);
    }

    function clearStoredCheckout() {
        const storage = getSessionStorage();
        if (!storage) return;
        try {
            storage.removeItem(STORAGE_KEY);
        } catch (_) {
            // Storage may be unavailable in locked-down browsers.
        }
    }

    function isAbandonableOrder() {
        if (!normalizeText(state.orderNo, 200)) return false;
        if (state.paymentConfirmed) return false;
        if (state.status === 'delivered' || state.status === 'confirmed') return false;
        if (state.claimInFlight) return false;
        return true;
    }

    function syncAbandonOrderButton() {
        setHidden('guestCashAbandonOrderBtn', !isAbandonableOrder());
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
        state.paymentConfirmed = false;
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

    function formatAmount(amount) {
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) return '-';
        // Catalog and settlement are always CNY on both sites. USDT-BEP20 is
        // only the NOWPayments pay-in quote, rendered separately.
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

    function roundMoneyAmount(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return null;
        return Number((Math.round(amount * 100) / 100).toFixed(2));
    }

    function roundUpMoneyAmount(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount <= 0) return 0;
        return Number((Math.ceil(amount * 100) / 100).toFixed(2));
    }

    function normalizeSurchargeRate(value, fallback = 0) {
        const parsed = Number(value);
        const fallbackRate = Number(fallback);
        const rate = Number.isFinite(parsed) ? parsed : (Number.isFinite(fallbackRate) ? fallbackRate : 0);
        if (!(rate > 0)) return 0;
        return Math.min(0.1, Math.round(rate * 10000) / 10000);
    }

    function paymentProviderSummary(provider) {
        const key = normalizeText(provider, 80).toLowerCase();
        const summaries = state.preview?.payment_providers;
        const summary = summaries && typeof summaries === 'object' ? summaries[key] : null;
        const fallbackRate = (key === 'zpay' || key === 'nowpayments') ? 0.01 : 0;
        const parsedRate = normalizeSurchargeRate(summary?.surcharge_rate, fallbackRate);
        return {
            surcharge_rate: parsedRate > 0 ? parsedRate : fallbackRate,
            surcharge_label: normalizeText(summary?.surcharge_label, 40) || '通道手续费'
        };
    }

    function computePreviewPricing() {
        const baseAmount = roundMoneyAmount(state.preview?.price?.amount);
        const payment = selectedPayment();
        const summary = paymentProviderSummary(payment.provider);
        const surchargeAmount = baseAmount > 0 && summary.surcharge_rate > 0
            ? roundUpMoneyAmount(baseAmount * summary.surcharge_rate)
            : 0;
        const payableAmount = baseAmount > 0
            ? roundMoneyAmount(baseAmount + surchargeAmount)
            : baseAmount;
        return {
            baseAmount,
            surchargeAmount,
            surchargeLabel: summary.surcharge_label,
            payableAmount
        };
    }

    function applyServerPricing(order) {
        if (!order || typeof order !== 'object') return;
        const pricing = order.payment_pricing && typeof order.payment_pricing === 'object'
            ? order.payment_pricing
            : null;
        const payable = roundMoneyAmount(pricing?.payable_amount ?? order.amount);
        if (!(payable > 0)) return;
        const storedPayable = roundMoneyAmount(pricing?.payable_amount);
        const useBreakdown = Boolean(pricing)
            && storedPayable === payable
            && roundMoneyAmount(pricing.base_amount) > 0;
        state.confirmedPricing = {
            baseAmount: useBreakdown ? roundMoneyAmount(pricing.base_amount) : payable,
            surchargeAmount: useBreakdown ? (roundMoneyAmount(pricing.payment_fee_amount) || 0) : 0,
            surchargeLabel: useBreakdown
                ? (normalizeText(pricing.payment_fee_label, 40) || '通道手续费')
                : '通道手续费',
            payableAmount: payable
        };
        renderPayableSummary();
    }

    function renderPayableSummary() {
        const pricing = state.confirmedPricing || computePreviewPricing();
        const surchargeAmount = Number(pricing?.surchargeAmount) || 0;
        setText('guestCashProductAmount', formatAmount(pricing?.baseAmount));
        setText('guestCashPrice', formatAmount(pricing?.payableAmount));
        setText('guestCashFeeLabel', pricing?.surchargeLabel || '通道手续费');
        setText('guestCashFeeAmount', formatAmount(surchargeAmount));
        setHidden('guestCashFeeRow', !(surchargeAmount > 0));
    }

    function handlePaymentChannelChange() {
        if (state.orderNo) return;
        renderPayableSummary();
    }

    function renderPreview(context, preview) {
        state.preview = preview;
        state.previewKey = context.contextKey;
        const product = preview?.product || {};
        const options = normalizePaymentOptions(preview?.payment_channels);
        setText('guestCashProductName', product.name || context.productName || '-');
        setText('guestCashSkuName', product.sku_name || context.skuName || '-');
        renderPaymentOptions(options);
        if (!state.orderNo) state.confirmedPricing = null;
        renderPayableSummary();
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

    function safePaymentUrl(value) {
        try {
            const parsed = new URL(normalizeText(value, 2000), window.location.origin);
            return parsed.protocol === 'https:' || parsed.protocol === 'http:'
                ? parsed.toString()
                : '';
        } catch (_) {
            return '';
        }
    }

    function isMobilePaymentBrowser() {
        const userAgent = String(window.navigator?.userAgent || '').trim().toLowerCase();
        if (!userAgent) return false;
        return /android|iphone|ipad|ipod|mobile|micromessenger|wechat|harmonyos/.test(userAgent);
    }

    function isHostedPaymentQrDesktopLayout() {
        return !window.matchMedia('(max-width: 760px)').matches;
    }

    function isMobileAlipayHandoff() {
        // Desktop, Codex IAB, and other wide viewports must keep the hosted QR.
        // Opening ZPay WAP there lands on Alipay's official app-download page.
        return isMobilePaymentBrowser() && !isHostedPaymentQrDesktopLayout();
    }

    function normalizeAlipayAppSchemeUrl(value = '') {
        const normalized = String(value || '').trim();
        if (!/^alipays:\/\//i.test(normalized)) return '';
        return normalized.replace(/^alipays:\/\//i, 'alipays://');
    }

    function extractAlipayAppSchemeUrl(value = '', depth = 0) {
        const normalized = String(value || '').trim();
        if (!normalized || depth > 3) return '';
        const directScheme = normalizeAlipayAppSchemeUrl(normalized);
        if (directScheme) return directScheme;

        const decodedCandidates = [normalized];
        let decoded = normalized;
        for (let index = 0; index < 3; index += 1) {
            try {
                const nextDecoded = decodeURIComponent(decoded);
                if (!nextDecoded || nextDecoded === decoded) break;
                decoded = nextDecoded;
                decodedCandidates.push(decoded);
                const decodedScheme = normalizeAlipayAppSchemeUrl(decoded);
                if (decodedScheme) return decodedScheme;
            } catch (_) {
                break;
            }
        }

        for (const candidate of decodedCandidates) {
            try {
                const parsed = new URL(candidate, window.location.href);
                for (const paramValue of parsed.searchParams.values()) {
                    const nestedScheme = extractAlipayAppSchemeUrl(paramValue, depth + 1);
                    if (nestedScheme) return nestedScheme;
                }
            } catch (_) {
                // Keep scanning other decoded candidates.
            }
        }
        return '';
    }

    function buildAlipayAppLaunchUrl(paymentUrl = '') {
        const normalized = String(paymentUrl || '').trim();
        if (!normalized) return '';
        const directScheme = extractAlipayAppSchemeUrl(normalized);
        if (directScheme) return directScheme;
        try {
            const parsed = new URL(normalized, window.location.href);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
            if (/\.(?:apng|avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i.test(parsed.pathname)) return '';
            return `alipays://platformapi/startapp?appId=20000067&url=${encodeURIComponent(parsed.href)}`;
        } catch (_) {
            return '';
        }
    }

    function resolveMobileAlipayAppLaunchUrl(...paymentUrls) {
        if (!isMobileAlipayHandoff()) return '';
        for (const paymentUrl of paymentUrls) {
            const launchUrl = buildAlipayAppLaunchUrl(paymentUrl);
            if (launchUrl) return launchUrl;
        }
        return '';
    }

    function buildQrImageUrl(data, size = 240) {
        const normalized = String(data || '').trim();
        if (!normalized) return '';
        const normalizedSize = Math.min(480, Math.max(180, Math.round(Number(size) || 240)));
        return `https://api.qrserver.com/v1/create-qr-code/?size=${normalizedSize}x${normalizedSize}&data=${encodeURIComponent(normalized)}&margin=8`;
    }

    function formatCountdownDuration(ms) {
        const totalSeconds = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const pad = (value) => String(value).padStart(2, '0');
        return hours > 0
            ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
            : `${pad(minutes)}:${pad(seconds)}`;
    }

    function checkoutDetails(checkout) {
        const source = checkout?.checkout && typeof checkout.checkout === 'object'
            ? { ...checkout, ...checkout.checkout }
            : (checkout && typeof checkout === 'object' ? checkout : {});
        return {
            provider: normalizeText(source.provider, 80).toLowerCase(),
            channel: normalizeText(source.channel, 80).toLowerCase(),
            checkoutUrl: safePaymentUrl(source.checkout_url || source.payment_url),
            qrcodeUrl: safePaymentUrl(source.qrcode_url),
            qrcodeImageUrl: safePaymentUrl(source.qrcode_image_url || source.qrcode_img_url),
            address: normalizeText(source.pay_address || source.qr_data, 240),
            payAmount: normalizeText(source.pay_amount_text || source.pay_amount, 80),
            payCurrency: normalizeText(source.pay_currency, 40).toUpperCase(),
            network: normalizeText(source.network_name || 'BNB Smart Chain', 80)
        };
    }

    function setZpayStatus(message, tone = 'info') {
        const node = element('guestCashZpayStatus');
        if (!node) return;
        node.textContent = normalizeText(message, 240);
        node.classList.remove('is-info', 'is-success', 'is-error');
        node.classList.add(`is-${tone}`);
        node.hidden = !message;
    }

    function stopZpayCountdown() {
        if (state.zpayCountdownTimer) {
            window.clearInterval(state.zpayCountdownTimer);
            state.zpayCountdownTimer = null;
        }
    }

    function presentZpayTimeout({ pendingConfirmation = false } = {}) {
        const image = element('guestCashZpayQrImage');
        const fallback = element('guestCashZpayQrFallback');
        const success = element('guestCashZpaySuccess');
        const timeout = element('guestCashZpayTimeout');
        const card = element('guestCashZpayQrCard');
        const openBtn = element('guestCashZpayOpenBtn');
        if (image) image.hidden = true;
        if (fallback) fallback.hidden = true;
        if (success) success.hidden = true;
        if (timeout) timeout.hidden = false;
        if (openBtn) openBtn.hidden = true;
        card?.classList.add('is-timeout');
        card?.classList.remove('is-success');
        setZpayStatus(
            pendingConfirmation
                ? '付款有效期已结束，正在等待支付确认...'
                : '付款已超时，请不要再扫码付款。',
            pendingConfirmation ? 'info' : 'error'
        );
    }

    function presentZpaySuccess() {
        stopZpayCountdown();
        const image = element('guestCashZpayQrImage');
        const fallback = element('guestCashZpayQrFallback');
        const success = element('guestCashZpaySuccess');
        const timeout = element('guestCashZpayTimeout');
        const card = element('guestCashZpayQrCard');
        const openBtn = element('guestCashZpayOpenBtn');
        if (image) image.hidden = true;
        if (fallback) fallback.hidden = true;
        if (timeout) timeout.hidden = true;
        if (success) success.hidden = false;
        if (openBtn) openBtn.hidden = true;
        card?.classList.remove('is-timeout');
        card?.classList.add('is-success');
        setZpayStatus('支付成功', 'success');
    }

    function startZpayCountdown() {
        stopZpayCountdown();
        const countdown = element('guestCashZpayCountdown');
        const valueEl = element('guestCashZpayCountdownValue');
        const expiresAtMs = Date.parse(String(state.expiresAt || '').trim());
        if (!countdown || !valueEl || !Number.isFinite(expiresAtMs)) {
            if (countdown) countdown.hidden = true;
            return;
        }
        countdown.hidden = false;
        const tick = () => {
            const remainingMs = expiresAtMs - Date.now();
            const expired = remainingMs <= 0;
            countdown.classList.toggle('is-warning', remainingMs > 0 && remainingMs <= 60000);
            countdown.classList.toggle('is-expired', expired);
            valueEl.textContent = expired ? '已超时' : formatCountdownDuration(remainingMs);
            countdown.setAttribute(
                'aria-label',
                expired
                    ? '付款有效期已结束，正在等待付款确认'
                    : `付款有效期剩余 ${formatCountdownDuration(remainingMs)}`
            );
            if (expired) {
                presentZpayTimeout({ pendingConfirmation: true });
                stopZpayCountdown();
            }
        };
        tick();
        if (expiresAtMs > Date.now()) {
            state.zpayCountdownTimer = window.setInterval(tick, 1000);
        }
    }

    function resetZpayHostedQr() {
        stopZpayCountdown();
        const image = element('guestCashZpayQrImage');
        const fallback = element('guestCashZpayQrFallback');
        const success = element('guestCashZpaySuccess');
        const timeout = element('guestCashZpayTimeout');
        const card = element('guestCashZpayQrCard');
        const openBtn = element('guestCashZpayOpenBtn');
        const countdown = element('guestCashZpayCountdown');
        if (image) {
            image.removeAttribute('src');
            image.hidden = true;
        }
        if (fallback) {
            fallback.hidden = true;
            fallback.textContent = '';
        }
        if (success) success.hidden = true;
        if (timeout) timeout.hidden = true;
        if (openBtn) {
            openBtn.hidden = true;
            delete openBtn.dataset.launchUrl;
        }
        if (countdown) {
            countdown.hidden = true;
            countdown.classList.remove('is-warning', 'is-expired');
        }
        card?.classList.remove('is-timeout', 'is-success');
        setZpayStatus('请使用支付宝扫码支付。', 'info');
    }

    function presentZpayHostedQr(details) {
        const isMobileHandoff = isMobileAlipayHandoff();
        const qrcodeUrl = details.qrcodeUrl || '';
        const checkoutUrl = details.checkoutUrl || '';
        const hostedImageUrl = isMobileHandoff
            ? ''
            : (details.qrcodeImageUrl || buildQrImageUrl(qrcodeUrl || checkoutUrl));
        const mobileAppLaunchUrl = isMobileHandoff
            ? resolveMobileAlipayAppLaunchUrl(checkoutUrl, qrcodeUrl)
            : '';
        const image = element('guestCashZpayQrImage');
        const fallback = element('guestCashZpayQrFallback');
        const success = element('guestCashZpaySuccess');
        const timeout = element('guestCashZpayTimeout');
        const card = element('guestCashZpayQrCard');
        const openBtn = element('guestCashZpayOpenBtn');
        const hint = element('guestCashZpayHint');

        if (success) success.hidden = true;
        if (timeout) timeout.hidden = true;
        card?.classList.remove('is-timeout', 'is-success');

        if (hint) {
            hint.textContent = isMobileHandoff
                ? '请打开支付宝 App 完成付款。支付完成后回到此页面等待自动核验。'
                : '请使用支付宝扫码支付。支付完成后保持此页面，系统会自动核验。';
        }

        if (image) {
            if (hostedImageUrl) {
                image.src = hostedImageUrl;
                image.hidden = false;
            } else {
                image.removeAttribute('src');
                image.hidden = true;
            }
        }

        if (fallback) {
            if (hostedImageUrl) {
                fallback.hidden = true;
                fallback.textContent = '';
            } else {
                fallback.hidden = false;
                fallback.textContent = isMobileHandoff
                    ? '请点击下方按钮直接拉起支付宝 App。支付完成后回到本页，系统会自动同步结果。'
                    : '当前通道没有返回付款码，请稍后重试或联系客服。不要在电脑浏览器打开支付宝链接。';
            }
        }

        if (openBtn) {
            const showOpen = Boolean(isMobileHandoff && mobileAppLaunchUrl);
            openBtn.hidden = !showOpen;
            if (showOpen) openBtn.dataset.launchUrl = mobileAppLaunchUrl;
            else delete openBtn.dataset.launchUrl;
        }

        if (isMobileHandoff) {
            setZpayStatus('支付页已准备好。请打开支付宝 App 支付，完成后回到此页面等待同步。', 'info');
        } else if (hostedImageUrl) {
            setZpayStatus('请使用支付宝扫码支付。', 'info');
        } else {
            setZpayStatus('支付页面链接无效，请稍后重试或联系客服', 'error');
            setStateMessage('支付页面链接无效，请稍后重试或联系客服', 'manual_review');
        }

        startZpayCountdown();
    }

    function renderCheckout(checkout) {
        const details = checkoutDetails(checkout);
        state.checkout = details;
        setHidden('guestCashCheckoutPanel', false);
        setHidden('guestCashConfigurePanel', true);
        setHidden('guestCashZpayPanel', details.provider !== 'zpay');
        setHidden('guestCashNowpaymentsPanel', details.provider !== 'nowpayments');
        if (details.provider === 'zpay') {
            presentZpayHostedQr(details);
        } else {
            resetZpayHostedQr();
        }
        setText('guestCashNowNetwork', details.network);
        setText('guestCashNowAmount', details.payAmount && details.payCurrency
            ? `${details.payAmount} ${details.payCurrency}`
            : '-');
        setText('guestCashNowAddress', details.address || '-');
        if (details.provider === 'zpay' && !details.qrcodeImageUrl && !details.qrcodeUrl && !details.checkoutUrl) {
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
        state.paymentConfirmed = false;
        state.status = 'configure';
        state.confirmedPricing = null;
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
        setHidden('guestCashConfigurePanel', Boolean(state.checkout) && state.status !== 'delivered');
        if (state.checkout?.provider === 'zpay' && state.status !== 'delivered') {
            presentZpayHostedQr(state.checkout);
        }
        if (state.orderNo) {
            // An existing order is resumed by order number + server cookie.
            // Do not let a preview failure overwrite its payment status, and
            // do not offer a second create action for the same idempotent order.
            showOrderNo(state.orderNo);
            setHidden('guestCashCreateOrderBtn', true);
            setHidden('guestCashCheckStatusBtn', state.status === 'delivered');
        } else {
            showOrderNo('');
            setHidden('guestCashCreateOrderBtn', false);
            setHidden('guestCashCheckStatusBtn', true);
            setStateMessage('正在确认商品信息...', 'configure');
            void loadPreview(context || getPurchaseContext(), { revealButton: false });
        }
        if (state.orderNo) {
            void pollStatus({ immediate: true });
        }
        syncAbandonOrderButton();
    }

    function closeGuestModal() {
        if (state.status === 'delivered') clearCompletedCheckout();
        stopPolling();
        stopZpayCountdown();
        const modal = getModal();
        if (!modal) return;
        modal.hidden = true;
        modal.classList.remove('active');
        document.body?.classList.remove('guest-shop-modal-open');
    }

    function clearCompletedCheckout() {
        if (state.status !== 'delivered') return false;
        stopPolling();
        stopZpayCountdown();
        clearStoredCheckout();
        state.orderNo = '';
        state.idempotencyKey = '';
        state.expiresAt = '';
        state.provider = '';
        state.channel = '';
        state.recoveryCode = '';
        state.paymentConfirmed = false;
        state.status = 'configure';
        state.confirmedPricing = null;
        state.paymentConfirmedAt = null;
        state.lastStatusQueryTime = null;
        resetOrderUi();
        setStateMessage('发货内容已关闭，可以重新购买。', 'configure');
        return true;
    }

    function resetOrderUi({ preserveRecovery = false } = {}) {
        setHidden('guestCashCheckoutPanel', true);
        setHidden('guestCashConfigurePanel', false);
        setHidden('guestCashDeliveryPanel', true);
        setHidden('guestCashCheckStatusBtn', true);
        setHidden('guestCashCreateOrderBtn', false);
        resetZpayHostedQr();
        setText('guestCashDeliveredContent', '');
        state.checkout = null;
        if (!preserveRecovery) {
            state.recoveryCode = '';
            setHidden('guestCashRecoveryCodePanel', true);
            setText('guestCashRecoveryCode', '');
            state.paymentConfirmedAt = null;
            state.lastStatusQueryTime = null;
        }
        setHidden('guestCashRecoveryPanel', true);
        if (!state.orderNo) showOrderNo('');
        syncAbandonOrderButton();
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

    function abandonCurrentOrder() {
        if (!isAbandonableOrder()) {
            syncAbandonOrderButton();
            if (state.orderNo && (state.paymentConfirmed || state.status === 'delivered' || state.status === 'confirmed')) {
                setStateMessage('当前订单已确认付款或已发货，不能关闭。请保留订单号。', state.status);
            }
            return;
        }
        stopPolling();
        stopZpayCountdown();
        clearStoredCheckout();
        state.orderNo = '';
        state.idempotencyKey = '';
        state.expiresAt = '';
        state.provider = '';
        state.channel = '';
        state.recoveryCode = '';
        state.checkout = null;
        state.paymentConfirmed = false;
        state.status = 'configure';
        state.confirmedPricing = null;
        state.paymentConfirmedAt = null;
        state.lastStatusQueryTime = null;
        resetOrderUi();
        showOrderNo('');
        setStateMessage('当前未付款订单已关闭。请不要再支付旧付款码。可以重新创建订单。旧库存预占会在过期后自动释放。', 'configure');
        const context = getPurchaseContext();
        if (context) {
            state.contextKey = context.contextKey;
            state.site = context.site;
            state.productId = context.productId;
            state.skuId = context.skuId;
            setText('guestCashProductName', context.productName || '-');
            setText('guestCashSkuName', context.skuName || '-');
            void loadPreview(context, { revealButton: false });
        }
    }

    function showOrderNo(orderNo) {
        const normalized = normalizeText(orderNo, 200);
        if (!normalized) {
            setText('guestCashOrderNo', '-');
            setHidden('guestCashOrderNoRow', true);
            return;
        }
        setText('guestCashOrderNo', normalized);
        setHidden('guestCashOrderNoRow', false);
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
            state.paymentConfirmed = false;
            state.status = 'awaiting_payment';
            persistCheckout();
            resetOrderUi({ preserveRecovery: Boolean(state.recoveryCode) });
            showOrderNo(orderNo);
            showRecoveryCode(order.recovery_code);
            applyServerPricing(order);
            if (payload.checkout) renderCheckout(payload.checkout);
            setHidden('guestCashCreateOrderBtn', true);
            setHidden('guestCashCheckStatusBtn', false);
            syncAbandonOrderButton();
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
            const paymentStatus = normalizeText(order.payment_status, 80).toLowerCase();
            state.status = paymentStatus || 'checking';
            state.paymentConfirmed = paymentStatus === 'confirmed';
            state.recoveryCode = '';
            persistCheckout();
            showOrderNo(state.orderNo);
            applyServerPricing(order);
            if (payload.checkout) renderCheckout(payload.checkout);
            setHidden('guestCashRecoveryPanel', true);
            setHidden('guestCashCreateOrderBtn', true);
            setHidden('guestCashCheckStatusBtn', false);
            syncAbandonOrderButton();
            setStateMessage('订单已找回，正在核验支付状态。', 'checking');
            startPolling();
        } catch (error) {
            setStateMessage(error?.message || '订单找回失败，请检查订单号和取货口令', error?.status === 403 ? 'error' : 'manual_review');
        } finally {
            setActionBusy(button, false);
        }
    }

    async function fetchStatus({ forceRefresh = false } = {}) {
        if (!state.orderNo) return null;
        const query = new URLSearchParams({ orderNo: state.orderNo });
        // The status endpoint also runs a throttled active provider query so a
        // dropped webhook can still settle the order. An explicit user action
        // forces that provider refresh instead of waiting for the poll window.
        if (forceRefresh) query.set('force_provider_refresh', '1');
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
            state.paymentConfirmed = true;
            state.status = 'delivered';
            if (state.checkout?.provider === 'zpay') presentZpaySuccess();
            setText('guestCashDeliveredContent', payload.content || '');
            setHidden('guestCashDeliveryPanel', false);
            setHidden('guestCashCheckoutPanel', true);
            setHidden('guestCashCheckStatusBtn', true);
            setStateMessage('支付已确认，订单已发货。', 'delivered');
            syncAbandonOrderButton();
            stopPolling();
            // A delivered order is intentionally not auto-restored after a
            // refresh. Keep the content in memory until the user closes this
            // modal, while removing the resumable checkout handle now.
            clearStoredCheckout();
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

    function calculateSmartPollInterval(paymentStatus, fulfillmentStatus, statusPayload) {
        const now = Date.now();

        // Track when payment was confirmed
        if (paymentStatus === 'confirmed' && !state.paymentConfirmedAt) {
            state.paymentConfirmedAt = now;
        }

        // Payment confirmed: use aggressive intervals based on time elapsed
        if (paymentStatus === 'confirmed') {
            const timeSinceConfirmed = state.paymentConfirmedAt
                ? (now - state.paymentConfirmedAt)
                : 0;

            // Active fulfillment: most aggressive (0.6s)
            if (fulfillmentStatus === 'fulfilling') {
                return SMART_POLL_INTERVALS.FULFILLING;
            }

            // Just confirmed (0-3s): very aggressive (0.8s)
            if (timeSinceConfirmed < 3000) {
                return SMART_POLL_INTERVALS.PAYMENT_JUST_CONFIRMED;
            }

            // Early confirmation (3-10s): aggressive (1.2s)
            if (timeSinceConfirmed < 10000) {
                return SMART_POLL_INTERVALS.PAYMENT_CONFIRMED_EARLY;
            }

            // Late confirmation (10s+): moderate (2s)
            return SMART_POLL_INTERVALS.PAYMENT_CONFIRMED_LATE;
        }

        // Check for backend throttle hints
        try {
            const queryTime = statusPayload?.throttle_hint?.query_verified_at;
            if (queryTime) {
                const lastQueryMs = Date.parse(queryTime);
                if (Number.isFinite(lastQueryMs)) {
                    state.lastStatusQueryTime = lastQueryMs;
                    const timeSinceQuery = now - lastQueryMs;

                    // Backend queried provider within 8s: back off to 5s
                    if (timeSinceQuery < 8000) {
                        return SMART_POLL_INTERVALS.THROTTLED_HINT;
                    }
                }
            }
        } catch (_) {
            // Ignore parsing errors, fall through to default
        }

        // Default: awaiting payment (3.5s)
        return SMART_POLL_INTERVALS.AWAITING_PAYMENT;
    }

    async function pollStatus({ immediate = false, resetWindow = false, forceProviderRefresh = false } = {}) {
        if (!state.orderNo) return;
        if (resetWindow) stopPolling();
        if (state.pollTimer) return;
        const generation = state.pollGeneration;
        if (state.pollActiveGeneration === generation) return;
        state.pollStartedAt = state.pollStartedAt || Date.now();
        // A manual status check should force only its first request. Once the
        // server has performed that live provider query, ordinary polling is
        // enough and avoids repeatedly bypassing the background throttle.
        let forceProviderRefreshNext = forceProviderRefresh === true;
        const run = async () => {
            if (generation !== state.pollGeneration || !state.orderNo) return;
            state.pollTimer = null;
            state.pollActiveGeneration = generation;
            let shouldContinue = true;
            let nextPollIntervalMs = POLL_INTERVAL_MS;
            if (Date.now() - state.pollStartedAt > POLL_MAX_MS) {
                setStateMessage('自动核验已暂停，请点击“查询支付状态”继续。', 'manual_review');
                state.pollStartedAt = 0;
                state.pollActiveGeneration = null;
                return;
            }
            try {
                const payload = await fetchStatus({ forceRefresh: forceProviderRefreshNext });
                forceProviderRefreshNext = false;
                if (generation !== state.pollGeneration || !state.orderNo) return;
                if (payload?.checkout && !state.checkout) renderCheckout(payload.checkout);
                const order = payload?.order || {};
                applyServerPricing(order);
                const paymentStatus = normalizeText(order.payment_status, 80).toLowerCase();
                const fulfillmentStatus = normalizeText(order.fulfillment_status, 80).toLowerCase();
                // Smart polling: calculate interval based on order state
                if (state.smartPollingEnabled) {
                    nextPollIntervalMs = calculateSmartPollInterval(
                        paymentStatus,
                        fulfillmentStatus,
                        payload
                    );
                } else {
                    // Fallback to original logic if smart polling is disabled
                    if (paymentStatus === 'confirmed' && ['pending', 'fulfilling'].includes(fulfillmentStatus)) {
                        nextPollIntervalMs = CONFIRMED_FULFILLMENT_POLL_INTERVAL_MS;
                    }
                }
                if (paymentStatus === 'confirmed') {
                    state.paymentConfirmed = true;
                    syncAbandonOrderButton();
                }
                if (paymentStatus === 'confirmed' && fulfillmentStatus === 'delivered') {
                    if (state.checkout?.provider === 'zpay') presentZpaySuccess();
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
                    if (state.checkout?.provider === 'zpay') presentZpayTimeout();
                    setStateMessage('订单支付未完成或已关闭，请勿重复付款。', 'error');
                    shouldContinue = false;
                } else if (paymentStatus === 'confirmed' && fulfillmentStatus === 'paid_unfulfillable') {
                    setStateMessage('支付已确认，但当前库存不足，正在处理退款或人工补发。请保留订单号。', 'manual_review');
                    // This is a durable stock decision recorded by the claim
                    // RPC. Do not keep hammering status while the refund or
                    // manual fulfilment queue is handled by operations.
                    shouldContinue = false;
                } else if (paymentStatus === 'confirmed' && fulfillmentStatus === 'dead_letter') {
                    setStateMessage('支付已确认，但自动发货失败，订单已转人工处理。请保留订单号。', 'manual_review');
                    shouldContinue = false;
                } else {
                    if (paymentStatus === 'confirmed' && state.checkout?.provider === 'zpay') {
                        presentZpaySuccess();
                    }
                    setStateMessage(
                        paymentStatus === 'confirmed'
                            ? (fulfillmentStatus === 'failed'
                                ? '支付已确认，发货正在重试，请保持页面打开。'
                                : '支付已确认，正在等待发货...')
                            : '等待支付确认，请完成付款后保持页面打开。',
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
                state.pollTimer = window.setTimeout(run, nextPollIntervalMs);
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
        const abandonButton = target.closest('#guestCashAbandonOrderBtn');
        if (abandonButton) {
            event.preventDefault();
            abandonCurrentOrder();
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
        const zpayOpenButton = target.closest('#guestCashZpayOpenBtn');
        if (zpayOpenButton) {
            event.preventDefault();
            const launchUrl = normalizeAlipayAppSchemeUrl(zpayOpenButton.dataset.launchUrl);
            if (launchUrl && isMobileAlipayHandoff()) {
                window.location.href = launchUrl;
                setZpayStatus('请在支付宝完成付款，回到此页面后会立即同步结果。', 'info');
            }
            return;
        }
        const statusButton = target.closest('#guestCashCheckStatusBtn');
        if (statusButton) {
            event.preventDefault();
            // Manual "查询支付状态" always asks the server for a live provider
            // query so a lost webhook cannot strand a paid order in `pending`.
            void pollStatus({ immediate: true, resetWindow: true, forceProviderRefresh: true });
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

    async function maybeRestoreReturn() {
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
        const restoredOrderNo = state.orderNo;
        // Older clients persisted the order even after delivery. Check the
        // server-owned status before opening the modal so those stale records
        // cannot resurrect a completed delivery after a page refresh.
        try {
            const snapshot = await fetchStatus();
            if (state.orderNo !== restoredOrderNo) return;
            const restoredOrder = snapshot?.order || {};
            const paymentStatus = normalizeText(restoredOrder.payment_status, 80).toLowerCase();
            const fulfillmentStatus = normalizeText(restoredOrder.fulfillment_status, 80).toLowerCase();
            if (paymentStatus === 'confirmed' && fulfillmentStatus === 'delivered') {
                state.status = 'delivered';
                state.paymentConfirmed = true;
                clearCompletedCheckout();
                return;
            }
        } catch (error) {
            // A transient status failure should not discard an unpaid order;
            // retain the existing modal-and-poll recovery path below. This
            // also preserves the manual recovery UI when the claim cookie has
            // expired or was lost on another device.
        }
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
        element('guestCashPaymentChannel')?.addEventListener('change', handlePaymentChannelChange);
        const stored = storedCheckout();
        if (stored) hydrateCheckout(stored);
        window.setInterval(syncPurchaseButton, 350);
        maybeRestoreReturn();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
