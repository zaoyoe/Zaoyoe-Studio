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
    // Smart polling intervals per order state: tighter right after payment
    // confirmation (when fulfilment is imminent), backing off when backend
    // throttling is detected.
    //
    // Hard floor of 1000ms: the status endpoint allows 60 requests/min per
    // client IP, and that bucket is shared by every buyer behind the same
    // NAT/mobile-carrier IP. Sub-second polling would spend the whole budget on
    // one buyer and turn the delivery window into 429s plus a 3.5s retry, which
    // is slower than polling calmly. Delivery itself is server-side (payment
    // webhook / status kick), so polling faster does not deliver faster; it only
    // shortens the moment the buyer sees an already-delivered order.
    const SMART_POLL_INTERVALS = Object.freeze({
        AWAITING_PAYMENT: 3500,           // waiting for payment
        PAYMENT_JUST_CONFIRMED: 1000,     // 0-3s after confirmation
        PAYMENT_CONFIRMED_EARLY: 1500,    // 3-10s after confirmation
        PAYMENT_CONFIRMED_LATE: 2500,     // 10s+ after confirmation
        FULFILLING: 1000,                 // active fulfilment
        THROTTLED_HINT: 5000              // backend throttle detected
    });
    const POLL_MAX_MS = 15 * 60 * 1000;
    const PREVIEW_ENDPOINT = '/api/shop/guest/preview';
    const ORDER_ENDPOINT = '/api/shop/guest/orders';
    const STATUS_ENDPOINT = '/api/shop/guest/status';
    const CLAIM_ENDPOINT = '/api/shop/guest/claim';
    const RECOVERY_ENDPOINT = '/api/shop/guest/recover';

    // ---------------------------------------------------------------------
    // Promo L1/L2 client-side mirrors of api/_lib/guest-shop/{security,promo}.js.
    // Every one of these is a COURTESY check: the server re-validates the code
    // format, the quantity cap and the discount itself, and only the database
    // ever decides an amount. Nothing here multiplies, discounts or rounds a
    // price (plan §11.1) - the browser formats numbers the server sent.
    // ---------------------------------------------------------------------
    const DISCOUNT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,49}$/u;
    const DISCOUNT_CODE_MAX_LENGTH = 50;
    // preview is limited to 60 requests/min per IP and that bucket is shared by
    // every buyer behind the same NAT, so a quantity stepper must not fire one
    // request per keystroke. Debounced re-quote instead.
    const QUANTITY_PREVIEW_DEBOUNCE_MS = 400;
    // Outer bound only (promo.GUEST_MAX_QUANTITY_CEILING). The cap that actually
    // applies arrives as preview.quantity_cap and is 1 while the switches are off.
    const QUANTITY_HARD_CEILING = 5;

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
        // Order Access 2.0 (§6.4/§11.3). The credential requirement is read from
        // GET /guest/preview, never guessed, so the form is unchanged while
        // GUEST_SHOP_BUYER_CREDENTIAL_ENABLED is off.
        buyerCredentialRequired: false,
        // Only ever holds a password THIS client generated, and only so a
        // server-side P7a rejection can be re-minted instead of silently
        // discarding what the buyer typed. Never persisted (§7.2).
        generatedOrderPassword: '',
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
        smartPollingEnabled: true,        // Smart polling feature flag
        // Promo L1/L2. quantity is the buyer's selection for the CURRENT product;
        // quantityCap/discountEnabled are read from GET /guest/preview and never
        // guessed, so with the switches off the cap stays 1, the stepper stays
        // hidden and the checkout is unchanged. listSubtotal and amountBreakdown
        // are server-authored amounts only: the first is the preview list total
        // (unit*tier quantity, rounded server-side), the second is the committed
        // order breakdown echoed by the create/status/recover responses.
        quantity: 1,
        quantityCap: 1,
        discountEnabled: false,
        listSubtotal: null,
        amountBreakdown: null,
        quantityPreviewTimer: null
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

    // ---------------------------------------------------------------------
    // Dujiao alignment. Payment.vue keeps a subtitle under the title,
    // CheckoutSteps.vue keeps a progress rail, and its order card keeps
    // 订单号 / 订单状态 / 支付方式 fact rows. All of them are pure functions of
    // the guest order status, so they are derived from this one table and
    // driven from setStateMessage() instead of being poked at ~30 call sites.
    //
    // Dujiao's step keys are cart / checkout / payment. A guest single-product
    // flow has no cart and its third phase is key delivery, so the rail is
    // 确认订单 -> 支付 -> 发货.
    // ---------------------------------------------------------------------
    const STEP_PHASES = ['configure', 'payment', 'delivery'];
    const STEP_SUBTITLES = {
        configure: '选择支付方式后创建订单，支付完成会自动核验并展示发货内容。',
        payment: '请完成支付。支付成功后系统会自动核验并展示发货内容，请勿重复付款。',
        delivery: '支付已确认，发货内容如下，请及时复制并妥善保存。'
    };
    // Only statuses that positively advance the flow move the rail. creating /
    // error / manual_review deliberately map to nothing, so a transient poll
    // failure never walks an already-paid buyer back to 确认订单.
    const STEP_PHASE_BY_STATUS = {
        configure: 'configure',
        awaiting_payment: 'payment',
        checking: 'payment',
        confirmed: 'payment',
        delivered: 'delivery'
    };
    const ORDER_STATUS_LABELS = {
        configure: '待创建',
        creating: '创建中',
        awaiting_payment: '待支付',
        checking: '核验中',
        confirmed: '已支付，待发货',
        delivered: '已发货',
        error: '需要处理',
        manual_review: '人工处理中'
    };

    function setSubtitle(text) {
        setText('guestCashSubtitle', text);
    }

    function syncStepState(phase) {
        const rail = element('guestCashSteps');
        if (!rail || !STEP_PHASES.includes(phase)) return;
        rail.dataset.step = phase;
        const activeIndex = STEP_PHASES.indexOf(phase);
        Array.from(rail.querySelectorAll('.guest-shop-modal__step')).forEach((step, index) => {
            step.classList.toggle('is-done', index < activeIndex);
            step.classList.toggle('is-current', index === activeIndex);
            step.classList.toggle('is-upcoming', index > activeIndex);
            if (index === activeIndex) step.setAttribute('aria-current', 'step');
            else step.removeAttribute('aria-current');
        });
        setSubtitle(STEP_SUBTITLES[phase]);
    }

    function paymentMethodLabel(provider, channel) {
        if (!provider) return '';
        return paymentLabel({ provider, channel });
    }

    // The 订单状态 / 支付方式 rows only carry meaning once an order exists, so
    // they stay hidden during 确认订单 instead of showing "待创建" noise.
    function syncOrderMeta(status = state.status) {
        const hasOrder = Boolean(state.orderNo);
        setHidden('guestCashStatusRow', !hasOrder);
        if (hasOrder) setText('guestCashStatusValue', ORDER_STATUS_LABELS[status] || status);
        const provider = normalizeText(state.provider || state.checkout?.provider, 80).toLowerCase();
        const channel = normalizeText(state.channel || state.checkout?.channel, 80).toLowerCase();
        setHidden('guestCashMethodRow', !provider);
        if (provider) setText('guestCashMethodValue', paymentMethodLabel(provider, channel));
    }

    // Dujiao renders the polling hint inside the amount card, under a divider.
    // It belongs to the awaiting-payment window only: once the payload is on
    // screen the delivery card is the live region, and a second "please keep
    // this page open" line would contradict it.
    function syncPollingHint(status = state.status) {
        const active = Boolean(state.orderNo)
            && (status === 'awaiting_payment' || status === 'checking' || status === 'confirmed');
        setHidden('guestCashAmountFooter', !active);
        if (!active) return;
        setText('guestCashPollingHint', status === 'confirmed'
            ? '支付已确认，正在等待系统发货，请保持此页面打开。'
            : '正在自动核验支付结果，请保持此页面打开。');
    }

    function setStateMessage(message, status = state.status) {
        state.status = status;
        if (status === 'delivered' || status === 'confirmed') {
            state.paymentConfirmed = true;
        }
        syncAbandonOrderButton();
        // Derived before the guestCashState guard so the rail still tracks the
        // status even if the message node is missing from the markup.
        syncStepState(STEP_PHASE_BY_STATUS[status] || '');
        syncOrderMeta(status);
        syncPollingHint(status);
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
        // Server-authored list subtotal only. The browser never multiplies a unit
        // price by a quantity (§11.1): GET /guest/preview ships `price.subtotal`
        // for exactly this. The `price.amount` fallback covers a payload from a
        // server that predates the field, and is honoured ONLY for a single unit -
        // for any other quantity the hero renders '-' until the re-quote lands,
        // which is strictly better than showing a total nobody committed to.
        const quantity = normalizeQuantity(state.quantity);
        const serverSubtotal = roundMoneyAmount(state.listSubtotal);
        const baseAmount = serverSubtotal !== null
            ? serverSubtotal
            : (quantity === 1 ? roundMoneyAmount(state.preview?.price?.amount) : null);
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
        // L1/L2: the committed breakdown is what the 小计 / 优惠 / 手续费 rows are
        // allowed to render. Only overwrite when the response actually carries the
        // key. status/recover snapshots omit it for a pre-L1 row (list_unit_amount
        // NULL) and for a row buildGuestAmountBreakdown judged inconsistent, and in
        // both cases there is nothing better to show than what create committed;
        // blanking it on every poll would wipe the discount line of a live order
        // while the buyer is watching it.
        if (Object.prototype.hasOwnProperty.call(order, 'amount_breakdown')) {
            const breakdown = order.amount_breakdown;
            state.amountBreakdown = breakdown && typeof breakdown === 'object' ? breakdown : null;
        }
        renderPayableSummary();
    }

    function renderPayableSummary() {
        const pricing = state.confirmedPricing || computePreviewPricing();
        const breakdown = state.amountBreakdown && typeof state.amountBreakdown === 'object'
            ? state.amountBreakdown
            : null;
        const surchargeAmount = Number(pricing?.surchargeAmount) || 0;
        // 商品金额 prefers the LIST total so the 优惠码 row below subtracts from a
        // base the buyer can actually read (list - discount = net). A pre-L1 row
        // has no list_unit_amount, so it falls back to net_amount and then to the
        // preview base - i.e. legacy orders render exactly as they do today.
        const listAmount = roundMoneyAmount(breakdown?.list_amount);
        const netAmount = roundMoneyAmount(breakdown?.net_amount);
        const productAmount = listAmount !== null && listAmount > 0
            ? listAmount
            : (netAmount !== null && netAmount > 0 ? netAmount : pricing?.baseAmount);
        // Both rows are committed-amount-only. A negative or missing value hides
        // the row, so the client can never invent a saving the database did not
        // record. `promo_amount` is not emitted by the server yet (tiered/flash
        // savings are already folded into the list unit price); the row is wired
        // anyway so a future server field lights it up with no markup change.
        const discountAmount = roundMoneyAmount(breakdown?.discount_amount);
        const promoAmount = roundMoneyAmount(breakdown?.promo_amount);
        setText('guestCashProductAmount', formatAmount(productAmount));
        setText('guestCashPrice', formatAmount(pricing?.payableAmount));
        setText('guestCashFeeLabel', pricing?.surchargeLabel || '通道手续费');
        setText('guestCashFeeAmount', formatAmount(surchargeAmount));
        setHidden('guestCashFeeRow', !(surchargeAmount > 0));
        setText('guestCashCouponAmount', discountAmount > 0 ? `-${formatAmount(discountAmount)}` : '-');
        setHidden('guestCashCouponRow', !(discountAmount > 0));
        setText('guestCashPromoAmount', promoAmount > 0 ? `-${formatAmount(promoAmount)}` : '-');
        setHidden('guestCashPromoRow', !(promoAmount > 0));
        renderQuantityFact();
    }

    function handlePaymentChannelChange() {
        if (state.orderNo) return;
        renderPayableSummary();
    }

    // ---------------------------------------------------------------------
    // Order Access 2.0 (§11.3): the buyer query credential on the order form.
    // js/guest-query-password.js owns the alphabet and the generator so the
    // shop modal and /guest-orders.html cannot drift apart. Everything here is
    // a courtesy check: api/_lib/guest-shop/security.js stays authoritative.
    // ---------------------------------------------------------------------
    function queryPasswordModule() {
        return globalThis.GuestQueryPassword || null;
    }

    function orderPasswordInput() {
        return element('guestCashOrderPassword');
    }

    /**
     * §6.1.2 step 2, mirrored in the browser: fold fullwidth ASCII to halfwidth
     * and cap at the server's P3 length. Deliberately does NOT trim — the
     * frozen normalization contract never trims a query password, and trimming
     * here but not on the lookup page would strand an order behind a space.
     */
    function foldQueryPassword(value) {
        const module = queryPasswordModule();
        const folded = module ? module.foldFullwidth(value) : String(value ?? '');
        return folded.slice(0, 64);
    }

    function setOrderPasswordNote(message) {
        const note = element('guestCashOrderPasswordNote');
        if (!note) return;
        note.textContent = normalizeText(message, 300);
        note.hidden = !message;
    }

    function syncOrderPasswordChecks() {
        const list = element('guestCashOrderPasswordChecks');
        if (!list) return;
        const module = queryPasswordModule();
        const result = module ? module.inspect(orderPasswordInput()?.value || '') : null;
        for (const item of list.querySelectorAll('[data-pw-check]')) {
            item.classList.toggle('is-pass', Boolean(result && result[item.dataset.pwCheck]));
        }
    }

    function clearOrderPassword() {
        const input = orderPasswordInput();
        if (input) input.value = '';
        state.generatedOrderPassword = '';
        setOrderPasswordNote('');
        syncOrderPasswordChecks();
    }

    function syncBuyerCredentialUi() {
        const required = state.buyerCredentialRequired;
        setHidden('guestCashOrderPasswordField', !required);
        // §11.3 frozen copy. The email is the lookup key for the order and its
        // card secret, so it becomes mandatory the moment a password is asked
        // for, and stays "可选" on the legacy path.
        setText('guestCashContactHint', required ? '必填，用于查询订单与获取发货通知' : '可选');
        setHidden('guestCashOrdersPageLink', !required);
        if (!required) clearOrderPassword();
        else syncOrderPasswordChecks();
    }

    function orderPasswordPolicyFailure() {
        const value = foldQueryPassword(orderPasswordInput()?.value || '');
        if (!value) return { rule: 'P1', reason: 'missing' };
        const module = queryPasswordModule();
        // Without the shared module the client cannot judge strength; sending it
        // anyway is correct because the server rejects with the exact rule.
        return module ? module.policyFailure(value) : null;
    }

    function orderPasswordPolicyMessage(failure) {
        if (!failure) return '';
        if (failure.rule === 'P1') return '请填写查询密码（至少 8 位）';
        if (failure.rule.startsWith('P2')) return '查询密码必须同时包含大写字母、小写字母、数字和标点';
        return '查询密码过于简单，请点击「帮我生成」重新设置';
    }

    async function generateOrderPassword(button) {
        const module = queryPasswordModule();
        const input = orderPasswordInput();
        if (!module || !input) return;
        try {
            const generated = module.generate();
            input.value = generated;
            state.generatedOrderPassword = generated;
            syncOrderPasswordChecks();
            // Copied to the clipboard because §6.1.3 decouples "strong" from
            // "must be memorised"; the plaintext is never persisted anywhere.
            await copyText(generated, button);
            setOrderPasswordNote('已生成并复制到剪贴板，请妥善保存。本站不保存明文，关闭页面后无法找回。');
        } catch (error) {
            state.generatedOrderPassword = '';
            setOrderPasswordNote(normalizeText(error?.message, 200) || '无法生成查询密码，请手动设置一个');
        }
    }

    /**
     * The server can still refuse a password we minted (P7a denylist, which the
     * browser deliberately does not carry, ~1 in 200k). Re-mint and re-copy
     * instead of resubmitting: a silent second submit would store a different
     * secret than the one already in the buyer's clipboard.
     */
    async function refreshRejectedOrderPassword() {
        const input = orderPasswordInput();
        const current = foldQueryPassword(input?.value || '');
        if (!current || current !== state.generatedOrderPassword) {
            setOrderPasswordNote('该查询密码强度不足，请点击「帮我生成」换一个。');
            syncOrderPasswordChecks();
            return;
        }
        const module = queryPasswordModule();
        if (!module) return;
        try {
            const next = module.generate();
            input.value = next;
            state.generatedOrderPassword = next;
            syncOrderPasswordChecks();
            await copyText(next);
            setOrderPasswordNote('已重新生成并复制查询密码，请妥善保存后再次点击「创建订单」。');
        } catch (_) {
            setOrderPasswordNote('无法重新生成查询密码，请手动设置一个。');
        }
    }

    function toggleOrderPasswordVisibility(button) {
        const input = orderPasswordInput();
        if (!input || !button) return;
        const wasRevealed = input.type === 'text';
        input.type = wasRevealed ? 'password' : 'text';
        button.setAttribute('aria-pressed', wasRevealed ? 'false' : 'true');
        button.title = wasRevealed ? '显示密码' : '隐藏密码';
        button.setAttribute('aria-label', wasRevealed ? '显示查询密码' : '隐藏查询密码');
        const icon = button.querySelector('i');
        if (icon) icon.className = wasRevealed ? 'fas fa-eye' : 'fas fa-eye-slash';
    }

    function handleOrderPasswordInput() {
        const input = orderPasswordInput();
        if (!input) return;
        const folded = foldQueryPassword(input.value);
        if (folded !== input.value) input.value = folded;
        // Any manual edit invalidates the "we minted this" marker, so a later
        // server rejection never overwrites what the buyer typed.
        if (state.generatedOrderPassword && folded !== state.generatedOrderPassword) {
            state.generatedOrderPassword = '';
        }
        setOrderPasswordNote('');
        syncOrderPasswordChecks();
    }

    // ---------------------------------------------------------------------
    // Promo L1/L2 UI. Two hard rules shape every function below:
    //
    //  1. The browser NEVER derives an amount (plan §11.1). The list subtotal
    //     comes from GET /guest/preview `price.subtotal`; the discount, fee and
    //     payable come from the created order's `amount_breakdown` /
    //     `payment_pricing`. A discount is therefore never displayed before the
    //     database has committed it, which is what makes "前端能报价、后端不认账"
    //     structurally impossible instead of merely unlikely.
    //  2. Nothing promo-related is persisted. The code lives in the input only,
    //     travels once in the POST body, and is never written to storage, a URL
    //     or a GET query (§7.2, and the contract test that asserts it).
    // ---------------------------------------------------------------------

    /**
     * The preview cache is keyed by product/SKU AND quantity, because L1 made
     * the unit price quantity-dependent (tiered rules pick the cheapest rule
     * whose qty <= quantity). Keying on the context alone would serve a 1-unit
     * price for a 3-unit selection.
     */
    function previewCacheKey(context) {
        const key = normalizeText(context?.contextKey, 200);
        return `${key}#${normalizeQuantity(state.quantity)}`;
    }

    function quantityCapValue() {
        const cap = Number.parseInt(String(state.quantityCap ?? ''), 10);
        if (!Number.isInteger(cap) || cap < 1) return 1;
        return Math.min(cap, QUANTITY_HARD_CEILING);
    }

    function normalizeQuantity(value) {
        const parsed = Number.parseInt(String(value ?? ''), 10);
        if (!Number.isInteger(parsed) || parsed < 1) return 1;
        return Math.min(parsed, quantityCapValue());
    }

    function quantityInput() {
        return element('guestCashQuantity');
    }

    function discountCodeInput() {
        return element('guestCashDiscountCode');
    }

    function discountCodeValue() {
        return normalizeText(discountCodeInput()?.value, DISCOUNT_CODE_MAX_LENGTH).toUpperCase();
    }

    // Mirrors security.isGuestDiscountCodeFormat. Courtesy only: the server
    // re-validates and returns guest_invalid_discount_code, and an order is
    // never created with a malformed code.
    function isDiscountCodeFormat(value) {
        return DISCOUNT_CODE_PATTERN.test(normalizeText(value, DISCOUNT_CODE_MAX_LENGTH));
    }

    function cancelScheduledPreview() {
        if (state.quantityPreviewTimer) window.clearTimeout(state.quantityPreviewTimer);
        state.quantityPreviewTimer = null;
    }

    function invalidatePreviewQuote() {
        // Drop the cached quote so the next loadPreview() re-quotes at the new
        // quantity, and drop the derived totals so the modal can never keep
        // showing an amount that belongs to another selection. state.preview is
        // kept: it still owns the payment-channel list and the surcharge labels,
        // which are quantity-independent.
        cancelScheduledPreview();
        state.previewKey = '';
        state.listSubtotal = null;
        state.amountBreakdown = null;
    }

    function schedulePreviewRefresh() {
        cancelScheduledPreview();
        state.quantityPreviewTimer = window.setTimeout(() => {
            state.quantityPreviewTimer = null;
            const context = getPurchaseContext();
            if (context && !state.orderNo) void loadPreview(context);
        }, QUANTITY_PREVIEW_DEBOUNCE_MS);
    }

    function syncQuantityUi() {
        const cap = quantityCapValue();
        // With the L1 switch off the cap is 1, the stepper stays hidden and the
        // configure panel is byte-identical to the pre-promo checkout.
        const multiUnit = cap >= 2;
        const locked = Boolean(state.orderNo);
        const quantity = normalizeQuantity(state.quantity);
        setHidden('guestCashQuantityField', !multiUnit);
        const input = quantityInput();
        if (input) {
            input.value = String(quantity);
            input.disabled = locked || !multiUnit;
            input.maxLength = 1;
        }
        const minus = element('guestCashQuantityMinus');
        const plus = element('guestCashQuantityPlus');
        if (minus) minus.disabled = locked || !multiUnit || quantity <= 1;
        if (plus) plus.disabled = locked || !multiUnit || quantity >= cap;
        setText('guestCashQuantityHint', multiUnit ? `单笔最多 ${cap} 件，价格按数量阶梯计算` : '');
    }

    function renderQuantityFact() {
        // After the order exists the committed count wins: the buyer must not see
        // a 数量 row that disagrees with the amount they are being asked to pay.
        const committed = Number.parseInt(String(state.amountBreakdown?.quantity ?? ''), 10);
        const quantity = Number.isInteger(committed) && committed >= 1
            ? Math.min(committed, QUANTITY_HARD_CEILING)
            : normalizeQuantity(state.quantity);
        setText('guestCashQuantityValue', String(quantity));
        setHidden('guestCashQuantityRow', !(quantity > 1 || quantityCapValue() >= 2));
    }

    function setQuantity(next) {
        if (state.orderNo) return;
        const quantity = normalizeQuantity(next);
        if (quantity === normalizeQuantity(state.quantity)) {
            syncQuantityUi();
            return;
        }
        state.quantity = quantity;
        invalidatePreviewQuote();
        syncQuantityUi();
        renderQuantityFact();
        renderPayableSummary();
        setStateMessage('正在按新的数量重新报价...', 'configure');
        schedulePreviewRefresh();
    }

    function handleQuantityInput() {
        if (state.orderNo) return;
        // maxlength=1 plus this clamp keeps the field a stepper, not a free-text
        // quantity: anything unparsable falls back to the current selection.
        const digits = String(quantityInput()?.value ?? '').replace(/[^0-9]/gu, '');
        const parsed = Number.parseInt(digits, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
            syncQuantityUi();
            return;
        }
        setQuantity(parsed);
    }

    function syncDiscountHint() {
        const hint = element('guestCashDiscountHint');
        if (!hint) return;
        const value = discountCodeValue();
        hint.hidden = false;
        hint.classList.remove('is-error');
        if (!value) {
            hint.textContent = '选填。优惠码按等额现金抵扣，实际优惠以下单结果为准。';
            return;
        }
        if (isDiscountCodeFormat(value)) {
            hint.textContent = '优惠码在创建订单时由服务端核验，核验通过后直接抵扣现金金额。';
            return;
        }
        hint.textContent = '优惠码格式不正确：仅限大写字母、数字、下划线和短横线，最长 50 位。';
        hint.classList.add('is-error');
    }

    function setDiscountInvalid(invalid) {
        const field = element('guestCashDiscountField');
        if (!field) return;
        if (invalid) field.classList.add('is-invalid');
        else field.classList.remove('is-invalid');
    }

    function handleDiscountCodeInput() {
        const input = discountCodeInput();
        if (!input) return;
        // Uppercase as typed so what the buyer sees is what gets sent; the server
        // normalizes the same way, so this is presentation, not validation.
        const upper = String(input.value ?? '').toUpperCase().slice(0, DISCOUNT_CODE_MAX_LENGTH);
        if (upper !== input.value) input.value = upper;
        setDiscountInvalid(false);
        syncDiscountHint();
    }

    function clearDiscountCode() {
        const input = discountCodeInput();
        if (input) input.value = '';
        setDiscountInvalid(false);
        syncDiscountHint();
    }

    function syncDiscountUi() {
        // discount_enabled is read from the preview only. It already requires the
        // buyer-credential switch server-side, because the database refuses a
        // redemption it cannot attribute to a buyer group.
        const enabled = state.discountEnabled === true;
        setHidden('guestCashDiscountField', !enabled);
        if (!enabled) {
            // Wipe instead of hide-and-keep: a code that cannot be submitted must
            // not survive into a later createOrder body.
            const input = discountCodeInput();
            if (input) input.value = '';
            setDiscountInvalid(false);
            const hint = element('guestCashDiscountHint');
            if (hint) hint.hidden = true;
            return;
        }
        const input = discountCodeInput();
        if (input) input.disabled = Boolean(state.orderNo);
        syncDiscountHint();
    }

    function syncPromoUi(preview) {
        const rawCap = Number.parseInt(String(preview?.quantity_cap ?? ''), 10);
        state.quantityCap = Number.isInteger(rawCap) && rawCap >= 1
            ? Math.min(rawCap, QUANTITY_HARD_CEILING)
            : 1;
        state.discountEnabled = preview?.discount_enabled === true;
        // A cap can shrink between two previews (operator lowered the switch, or
        // this SKU has its own guest_max_quantity). Clamp rather than reject so
        // the modal stays usable; the server re-applies the same cap on create.
        // price.quantity is the server's own normalized count for this quote, so
        // adopting it keeps the stepper and the quoted subtotal in agreement
        // instead of letting the two drift by one request.
        const echoedQuantity = Number.parseInt(String(preview?.price?.quantity ?? ''), 10);
        state.quantity = normalizeQuantity(
            Number.isInteger(echoedQuantity) && echoedQuantity >= 1
                ? echoedQuantity
                : state.quantity
        );
        syncQuantityUi();
        syncDiscountUi();
        renderQuantityFact();
    }

    /**
     * A different product/SKU has its own cap, tiers, flash window and code
     * eligibility, so nothing from the previous selection may carry over -
     * least of all a typed discount code, which is scoped per SKU.
     */
    function resetPromoSelection() {
        invalidatePreviewQuote();
        state.preview = null;
        state.quantity = 1;
        state.quantityCap = 1;
        state.discountEnabled = false;
        clearDiscountCode();
        syncQuantityUi();
        renderQuantityFact();
    }

    // A create-order rejection that says "this discount will not be applied"
    // must visibly retract the discount UI. Keeping a discount line on screen for
    // an order that was never created is the exact failure mode §9.6 wanted a
    // quote endpoint to prevent; retracting on the authoritative error is the
    // stronger guarantee, because it cannot disagree with a committed row.
    // Only the codes POST /guest/orders can actually emit. Plan §11.2 (C-E6)
    // collapses every coupon-lifecycle rejection - unknown, not guest, expired,
    // wrong site or scope, uses exhausted, daily budget exhausted, per-identity
    // limit, breaker open, below the discount floor, reservation race - onto the
    // single `guest_discount_unavailable` / 400 / 「优惠码不可用」, so the granular
    // SQL codes deliberately never appear here: listing them would mean waiting
    // for a signal the server is forbidden to send (and the pre-L1
    // guest_idempotency_conflict branch is a reminder of what a dead code costs).
    // The other two are raised by the Node layer before the RPC: a format failure
    // on the submitted string, and a code submitted while the switch is off.
    const PROMO_DISCOUNT_CODES = new Set([
        'guest_discount_unavailable',
        'guest_invalid_discount_code',
        'guest_discount_disabled'
    ]);
    // Rejections that mean the quote this modal holds no longer describes the
    // product. Drop it and re-quote instead of letting the buyer retry into the
    // same wall.
    const PROMO_REQUOTE_CODES = new Set([
        'guest_quantity_not_allowed',
        'guest_credit_price_unavailable',
        'guest_pricing_parity_mismatch'
    ]);

    function handleCreateOrderError(error) {
        const code = normalizeText(error?.code, 80);
        if (!code) return;
        if (PROMO_DISCOUNT_CODES.has(code)) {
            state.amountBreakdown = null;
            setDiscountInvalid(true);
            const input = discountCodeInput();
            if (input && !input.disabled) {
                try { input.focus(); } catch (_) { /* focus is best effort */ }
            }
            renderPayableSummary();
            return;
        }
        if (PROMO_REQUOTE_CODES.has(code)) {
            invalidatePreviewQuote();
            renderPayableSummary();
            const context = getPurchaseContext();
            if (context) void loadPreview(context);
            return;
        }
        // The database raises this only when an existing row carries a DIFFERENT
        // fingerprint. L1 put quantity and the discount code into that
        // fingerprint, so "changed the quantity, clicked again" now lands here.
        // Retrying the same key would conflict forever, and with no order number
        // in hand there is nothing to resume - so mint a fresh key on the next
        // click. The abandoned unpaid order expires and its reservations are
        // released by the TTL sweep. This is exactly what a page reload already
        // did; it is a strict improvement, never a new charge path.
        if (code === 'guest_idempotency_conflict' && !state.orderNo) {
            state.idempotencyKey = '';
        }
    }

    function renderPreview(context, preview) {
        state.preview = preview;
        // §12/§13.4: preview is the only unauthenticated signal that the buyer
        // credential switch is on. Reading it here (and nowhere else) keeps the
        // switch-off checkout byte-identical to today.
        state.buyerCredentialRequired = preview?.buyer_credential_required === true;
        syncBuyerCredentialUi();
        // L1/L2 runs BEFORE the cache key is written: syncPromoUi may clamp (or
        // adopt) state.quantity, the key includes the quantity, and a key written
        // from a stale quantity would make the very next loadPreview() re-quote in
        // a loop.
        syncPromoUi(preview);
        state.previewKey = previewCacheKey(context);
        // The list subtotal for THIS quantity, rounded server-side. null (an older
        // payload, or an out-of-bounds amount) makes the hero render '-' rather
        // than a client-side multiplication.
        state.listSubtotal = roundMoneyAmount(preview?.price?.subtotal);
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

    // Preview requests are serialized so a caller that lands while an earlier
    // probe is still in flight waits for that result instead of getting a
    // "not available yet" answer. The merged logged-out entry point treats an
    // unavailable preview as "fall back to login", so a duplicate probe must
    // never look like a negative result.
    let previewQueue = Promise.resolve();

    function loadPreview(context) {
        if (!context) return Promise.resolve({ available: false, reason: 'missing_context' });
        if (context.manualDelivery) return Promise.resolve({ available: false, reason: 'manual_delivery' });
        if (context.soldOut) return Promise.resolve({ available: false, reason: 'sold_out' });
        const task = previewQueue.then(() => runPreviewRequest(context));
        previewQueue = task.then(() => undefined, () => undefined);
        return task;
    }

    async function runPreviewRequest(context) {
        const cacheKey = previewCacheKey(context);
        if (state.previewKey === cacheKey && state.preview) {
            return { available: !state.previewError, reason: state.previewError ? 'unavailable' : 'available' };
        }
        state.previewPending = true;
        state.previewError = false;
        // L1: quantity rides along so the modal quotes the tier the buyer will
        // actually be charged. It is the only promo input on this request - a
        // discount code is NEVER sent to preview, never appears in a URL and is
        // never cached, because preview is an unauthenticated GET (§11.1). The
        // code is validated for real once, in the create-order body.
        const query = new URLSearchParams({
            site: context.site,
            productId: context.productId,
            skuId: context.skuId,
            quantity: String(normalizeQuantity(state.quantity))
        });
        try {
            const payload = await requestJson(`${PREVIEW_ENDPOINT}?${query.toString()}`, { method: 'GET' });
            const available = renderPreview(context, payload);
            return { available, reason: available ? 'available' : 'unavailable' };
        } catch (error) {
            state.previewKey = cacheKey;
            state.preview = null;
            state.previewError = true;
            // A failed quote leaves no list subtotal behind, so the amount card
            // renders '-' instead of the previous selection's total. The promo
            // switches and the buyer's quantity/code are deliberately untouched:
            // preview failures are retryable (429 shares one per-IP bucket), and
            // resetting a typed discount code on a transient error would be a
            // worse outcome than showing '-' for a moment.
            state.listSubtotal = null;
            renderPayableSummary();
            if (!getModal()?.hidden) setStateMessage(error.message || '游客支付暂不可用', 'error');
            const reason = error.status === 429
                ? 'rate_limited'
                : (error.code === 'guest_product_unavailable' ? 'unavailable' : 'preview_error');
            return { available: false, reason };
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
        state.amountBreakdown = null;
        resetOrderUi();
    }

    function openGuestModal(context) {
        const modal = getModal();
        if (!modal) return;
        if (context) {
            resetActiveOrderForContext(context);
            if (context.contextKey !== state.contextKey) {
                // A different product/SKU has its own quantity cap, tier rules,
                // flash window and code eligibility. Dropping the previous
                // selection here is what stops a code typed for SKU A from being
                // submitted against SKU B (the server would reject it, but the
                // buyer should never get that far).
                resetPromoSelection();
            }
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
        // Re-derive the rail from whatever order state survived, so resuming a
        // paid-but-undelivered order never flashes 确认订单 on the way in.
        syncStepState(state.status === 'delivered'
            ? 'delivery'
            : (state.orderNo || state.checkout ? 'payment' : 'configure'));
        syncOrderMeta(state.status);
        syncPollingHint(state.status);
        setHidden('guestCashDeliveryPanel', state.status !== 'delivered');
        setHidden('guestCashCheckoutPanel', !state.checkout || state.status === 'delivered');
        setHidden('guestCashConfigurePanel', Boolean(state.checkout) && state.status !== 'delivered');
        // A resumed order arrives without a fresh preview, so re-derive the promo
        // controls from state instead of leaving whatever the last render did.
        syncQuantityUi();
        syncDiscountUi();
        renderQuantityFact();
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
            void loadPreview(context || getPurchaseContext());
        }
        if (state.orderNo) {
            void pollStatus({ immediate: true });
        }
        syncAbandonOrderButton();
    }

    function closeGuestModal() {
        // A query password must not outlive the modal it was typed in.
        clearOrderPassword();
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
        state.amountBreakdown = null;
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
        // L1/L2: the stepper and the code field are order-scoped inputs, so they
        // lock while an order exists and unlock again on 关闭当前订单. Both stay
        // hidden unless the preview turned them on, which keeps the switch-off
        // checkout markup identical to before this batch.
        syncQuantityUi();
        syncDiscountUi();
        renderQuantityFact();
        resetZpayHostedQr();
        setText('guestCashDeliveredContent', '');
        // Dujiao fulfillment facts and the amount-card footer are order-scoped,
        // so they reset with the rest of the order UI instead of leaking the
        // previous order's 已发货 into a fresh 确认订单 screen.
        setText('guestCashDeliveryType', '-');
        setText('guestCashDeliveryStatus', '-');
        setHidden('guestCashAmountFooter', true);
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
        syncStepState('configure');
        syncOrderMeta('configure');
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
        // The abandoned order's committed breakdown must not survive into the
        // next 确认订单 screen: it would show a discount for an order that no
        // longer exists. The typed code itself is kept (it is a public coupon,
        // not a secret) so the buyer can retry without retyping it.
        state.amountBreakdown = null;
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
            void loadPreview(context);
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
        // A quantity change schedules a debounced re-quote. Drop the timer here:
        // loadPreview() below fetches the same key synchronously in this flow, so
        // leaving the timer armed would only spend a second preview request from
        // the shared per-IP budget.
        cancelScheduledPreview();
        const previewResult = await loadPreview(context);
        if (!previewResult.available) return;
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
        // §6.1.4. The password travels once, in the request body, and is never
        // written to sessionStorage or a URL (§7.1/§7.2). The server re-checks
        // strength and resolves the credential group (§6.4).
        let orderPassword = '';
        if (state.buyerCredentialRequired) {
            if (!email) {
                setStateMessage('请填写邮箱，用于查询订单与获取发货通知', 'error');
                return;
            }
            const passwordFailure = orderPasswordPolicyFailure();
            if (passwordFailure) {
                syncOrderPasswordChecks();
                setStateMessage(orderPasswordPolicyMessage(passwordFailure), 'error');
                return;
            }
            orderPassword = foldQueryPassword(orderPasswordInput()?.value || '');
        }
        // L2: the code is read here and validated BEFORE an idempotency key is
        // minted, so a typo cannot burn a key or spend a create-order rate-limit
        // slot on a guaranteed 400. This mirrors security.normalizeGuestDiscountCode
        // as a courtesy; the server re-validates and fn_guest_shop_reserve_discount
        // decides whether it applies. Nothing is displayed as a result of this
        // check - the discount line only appears once the committed order echoes it.
        const discountCode = state.discountEnabled ? discountCodeValue() : '';
        if (discountCode && !isDiscountCodeFormat(discountCode)) {
            setDiscountInvalid(true);
            syncDiscountHint();
            setStateMessage('优惠码格式不正确，请修改后再创建订单', 'error');
            discountCodeInput()?.focus();
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
            // L1: the buyer's selection, clamped to the cap the preview reported.
            // It stays 1 while the switch is off (cap 1), so the pre-L1 request
            // body is unchanged. quantity is part of the request fingerprint, so
            // changing it between two clicks is a conflict, not a silent reprice.
            quantity: normalizeQuantity(state.quantity),
            idempotencyKey: state.idempotencyKey,
            provider: payment.provider,
            channel: payment.channel
        };
        if (email) body.email = email;
        if (orderPassword) body.orderPassword = orderPassword;
        // L2: the code travels once, in this POST body, and only while the preview
        // said discounts are on. It is never appended to a URL, never written to
        // sessionStorage and never sent to preview.
        if (discountCode) body.discountCode = discountCode;
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
            // The order is bound to the buyer group server-side from here on, so
            // the plaintext has no further use in this page and is dropped.
            clearOrderPassword();
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
            if (error?.code === 'guest_password_weak') void refreshRejectedOrderPassword();
            // Runs before the message so a rejected discount retracts its UI in the
            // same frame the buyer reads the error, and a stale quote is dropped
            // instead of being retried into the same wall.
            handleCreateOrderError(error);
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
            // Guest checkout can only ever serve auto-delivery key products -
            // manual delivery is blocked before the modal is allowed to open -
            // and POST /guest/claim returns { order_no, content } only. So these
            // two Dujiao fact lines are constant rather than read off a field
            // the endpoint does not expose.
            setText('guestCashDeliveryType', '卡密（自动发货）');
            setText('guestCashDeliveryStatus', '已发货');
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

    /**
     * Dujiao never confirms a copy by overwriting the thing that was copied, and
     * never wipes an icon button. So the confirmation is expressed three ways,
     * picked per call site:
     *   - doneEl: reveal a separate success node (Payment.vue walletAddressCopied)
     *   - copiedClass: flip the button to its emerald "copied" treatment and swap
     *     its inner <span> label plus <i> icon (GuestOrderDetail.vue
     *     fulfillmentCopied), leaving the icon node itself intact
     *   - neither: legacy text swap, but only when the button actually has text;
     *     an icon-only button gets its glyph swapped instead, because writing
     *     textContent there used to destroy the <i> permanently.
     */
    async function copyText(value, button, { doneEl = '', copiedClass = '' } = {}) {
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
        const restore = [];
        if (doneEl) {
            const feedback = element(doneEl);
            if (feedback) {
                feedback.hidden = false;
                restore.push(() => { feedback.hidden = true; });
            }
        }
        if (button) {
            const icon = button.querySelector('i');
            const label = button.querySelector('span');
            if (copiedClass) {
                const originalIconClass = icon ? icon.className : '';
                const originalLabel = label ? label.textContent : '';
                button.classList.add(copiedClass);
                if (icon) icon.className = 'fas fa-check';
                if (label) label.textContent = '已复制';
                restore.push(() => {
                    button.classList.remove(copiedClass);
                    if (icon && originalIconClass) icon.className = originalIconClass;
                    if (label) label.textContent = originalLabel;
                });
            } else if (label && !button.textContent.trim().startsWith('已复制')) {
                const originalLabel = label.textContent;
                label.textContent = '已复制';
                restore.push(() => { label.textContent = originalLabel; });
            } else if (icon) {
                const originalIconClass = icon.className;
                icon.className = 'fas fa-check';
                restore.push(() => { icon.className = originalIconClass; });
            } else if (button.textContent.trim()) {
                const original = button.textContent;
                button.textContent = '已复制';
                restore.push(() => { button.textContent = original; });
            }
        }
        if (restore.length) window.setTimeout(() => { restore.forEach((undo) => undo()); }, 1600);
    }

    // The standalone "游客购买" button was removed. shop-client.js now merges the
    // guest cash entry into the primary "兑换 / 立即购买" action for logged-out
    // visitors. This bridge exposes just enough of the isolated guest flow for
    // that routing, without leaking auth/token concerns into this file.
    const availabilityCache = new Map();
    const availabilityInFlight = new Map();
    // Transient probe failures stay retryable: caching them would permanently
    // route a logged-out visitor to the login prompt for the rest of the page
    // session even though guest cash payment may well be available.
    const TRANSIENT_AVAILABILITY_REASONS = new Set(['pending', 'rate_limited', 'preview_error']);

    function guestContextBlockReason(context) {
        if (!context || !context.contextKey) return 'missing_context';
        if (context.manualDelivery) return 'manual_delivery';
        if (context.soldOut) return 'sold_out';
        return '';
    }

    // Synchronous, cache-only read used for render decisions. Returns null when
    // availability has not been probed yet for this selection.
    function peekAvailability(context = getPurchaseContext()) {
        const blocked = guestContextBlockReason(context);
        if (blocked) return { available: false, reason: blocked };
        return availabilityCache.get(context.contextKey) || null;
    }

    // Resolves guest cash availability for a selection, deduplicating in-flight
    // probes and caching negative results so a non-guest product is not re-probed
    // on every render (matching the old button-poll behaviour).
    async function probeAvailability(context = getPurchaseContext()) {
        const blocked = guestContextBlockReason(context);
        if (blocked) return { available: false, reason: blocked };
        const cached = availabilityCache.get(context.contextKey);
        if (cached) return cached;
        const inFlight = availabilityInFlight.get(context.contextKey);
        if (inFlight) return inFlight;
        const promise = (async () => {
            try {
                const result = await loadPreview(context);
                const normalized = {
                    available: Boolean(result && result.available),
                    reason: (result && result.reason) || ((result && result.available) ? 'available' : 'unavailable')
                };
                if (!TRANSIENT_AVAILABILITY_REASONS.has(normalized.reason)) {
                    availabilityCache.set(context.contextKey, normalized);
                }
                return normalized;
            } finally {
                availabilityInFlight.delete(context.contextKey);
            }
        })();
        availabilityInFlight.set(context.contextKey, promise);
        return promise;
    }

    // Opens the isolated guest cash modal when this selection supports it.
    async function startGuestCheckout(context = getPurchaseContext()) {
        const availability = await probeAvailability(context);
        if (!availability || !availability.available) {
            return { started: false, reason: (availability && availability.reason) || 'unavailable' };
        }
        openGuestModal(context);
        return { started: true, reason: 'available' };
    }

    window.GuestShopCheckout = {
        peekAvailability,
        probeAvailability,
        startGuestCheckout
    };

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
        // L1 stepper. Handled before the create branch and always
        // preventDefault-ed: these are <button type="button">, but a form-less
        // modal still must not let a stepper click fall through to anything else.
        const quantityStepButton = target.closest('#guestCashQuantityMinus, #guestCashQuantityPlus');
        if (quantityStepButton) {
            event.preventDefault();
            if (!quantityStepButton.disabled) {
                const delta = quantityStepButton.id === 'guestCashQuantityPlus' ? 1 : -1;
                setQuantity(normalizeQuantity(state.quantity) + delta);
            }
            return;
        }
        const createButton = target.closest('#guestCashCreateOrderBtn');
        if (createButton) {
            event.preventDefault();
            void createOrder();
            return;
        }
        const togglePasswordButton = target.closest('#guestCashToggleOrderPasswordBtn');
        if (togglePasswordButton) {
            event.preventDefault();
            toggleOrderPasswordVisibility(togglePasswordButton);
            return;
        }
        const generatePasswordButton = target.closest('#guestCashGenerateOrderPasswordBtn');
        if (generatePasswordButton) {
            event.preventDefault();
            void generateOrderPassword(generatePasswordButton);
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
            // Dujiao keeps the wallet-address button label fixed and confirms in
            // a separate success node, so the address itself is never at risk of
            // being overwritten by a "已复制" swap.
            void copyText(element('guestCashNowAddress')?.textContent || '', addressButton, { doneEl: 'guestCashNowCopyFeedback' });
            return;
        }
        const deliveryButton = target.closest('#guestCashCopyDeliveryBtn');
        if (deliveryButton) {
            event.preventDefault();
            // GuestOrderDetail.vue flips the fulfillment copy button to emerald
            // with a tick and a swapped label; is-copied carries that treatment.
            void copyText(element('guestCashDeliveredContent')?.textContent || '', deliveryButton, { copiedClass: 'is-copied' });
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
        getModal()?.addEventListener('click', handleGuestModalClick);
        element('guestCashPaymentChannel')?.addEventListener('change', handlePaymentChannelChange);
        element('guestCashOrderPassword')?.addEventListener('input', handleOrderPasswordInput);
        // L1/L2. `input` drives the live format hint and the uppercase fold;
        // `change` is bound too so a stepper value committed by autofill or a
        // browser "undo" still re-quotes. The discount code is never wired to a
        // GET request, a URL or storage - it only ever reaches the create body.
        const quantityField = element('guestCashQuantity');
        quantityField?.addEventListener('input', handleQuantityInput);
        quantityField?.addEventListener('change', handleQuantityInput);
        element('guestCashDiscountCode')?.addEventListener('input', handleDiscountCodeInput);
        syncQuantityUi();
        syncDiscountUi();
        const stored = storedCheckout();
        if (stored) hydrateCheckout(stored);
        maybeRestoreReturn();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
