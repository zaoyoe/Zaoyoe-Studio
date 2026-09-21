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
        site: '',
        productId: '',
        skuId: '',
        expiresAt: '',
        provider: '',
        channel: '',
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
        statusRequestInFlight: false,
        statusRequestContext: null,
        queuedStatusRequest: null,
        claimInFlight: false,
        // Every async UI operation captures both values. Closing the modal or
        // switching product context advances the view;
        // changing a quote input advances the quote. Late responses may still
        // finish server-side, but they can no longer overwrite a newer view.
        viewGeneration: 0,
        actionGeneration: 0,
        quoteGeneration: 0,
        paymentCreationUnknown: false,
        // Opaque public selector used only to retry an acknowledgement after a
        // successful order snapshot was restored. It is never the server's
        // idempotency key and cannot authorize an order by itself.
        checkoutIntentId: '',
        // The server owns the actual idempotency key inside its encrypted,
        // HttpOnly checkout-intent cookie. This client keeps only the public
        // intent selector and never writes a replay key to JS storage, URLs or
        // telemetry. An order password is deliberately omitted and must be
        // re-entered after the modal is closed.
        pendingCreateAttempt: null,
        // The initial acknowledgement is best-effort. A gateway/network hiccup
        // must be retryable once a terminal snapshot proves the order is safely
        // persisted, without issuing an ack on every status poll.
        checkoutIntentAckedId: '',
        checkoutIntentAckInFlightId: '',
        checkoutIntentAckRetryId: '',
        checkoutIntentClearAfterAckId: '',
        checkoutIntentInspectInFlight: false,
        // A successful response may arrive after its view was closed. Keep the
        // safe handle separate until the next explicit open/click so the stale
        // response cannot repaint a different product already on screen.
        detachedCheckout: null,
        fulfillmentStatus: '',
        refundStatus: '',
        deliveryCopied: false,
        lastTriggerElement: null,
        fallbackModalScrollLock: false,
        sessionStorageUnavailable: false,
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
        // order breakdown echoed by the create/status responses.
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

    function getModalDialog() {
        return element('guestCashPurchaseDialog') || getModal();
    }

    function modalFocusableElements() {
        const dialog = getModalDialog();
        if (!dialog || typeof dialog.querySelectorAll !== 'function') return [];
        // A single selector preserves DOM order. Grouping by tag would move
        // footer buttons ahead of fields and makes the Tab trap skip visible
        // controls in a way real keyboard users cannot predict.
        const nodes = [...dialog.querySelectorAll('button, input, select, textarea, a')];
        return nodes.filter((node) => {
            if (!node || node.disabled === true || node.getAttribute?.('tabindex') === '-1') return false;
            let current = node;
            while (current) {
                if (current.hidden === true || current.getAttribute?.('aria-hidden') === 'true') return false;
                current = current.parentElement;
            }
            return true;
        });
    }

    function focusGuestModal() {
        const [first] = modalFocusableElements();
        if (first && typeof first.focus === 'function') {
            try { first.focus(); } catch (_) { /* focus is best effort */ }
        }
    }

    function setModalReturnFocusTarget(target) {
        if (!target || typeof target.focus !== 'function') return;
        state.lastTriggerElement = target;
    }

    function isUsableReturnFocusTarget(target) {
        if (!target || target.isConnected === false || target.disabled === true
            || target.hidden === true || typeof target.focus !== 'function') return false;
        let current = target;
        while (current) {
            if (current.hidden === true || current.getAttribute?.('aria-hidden') === 'true') return false;
            current = current.parentElement;
        }
        if (typeof target.getClientRects === 'function' && target.getClientRects().length === 0) return false;
        return true;
    }

    function fallbackReturnFocusTarget() {
        const productId = normalizeText(state.productId, 100);
        if (!productId || typeof document.querySelectorAll !== 'function') return null;
        const candidates = Array.from(document.querySelectorAll('[data-shop-action="buy-product"][data-product-id]'));
        const isMatchingVisibleCandidate = (candidate) => String(candidate?.dataset?.productId || '').trim() === productId
            && candidate.hidden !== true
            && candidate.getAttribute?.('aria-hidden') !== 'true'
            && (typeof candidate.getClientRects !== 'function' || candidate.getClientRects().length > 0)
            && isUsableReturnFocusTarget(candidate);
        // A list/card tile can expose both a pseudo-button container and a real
        // purchase button. Give keyboard focus to the directly operable control.
        return candidates.find((candidate) => candidate.matches?.('button') && isMatchingVisibleCandidate(candidate))
            || candidates.find(isMatchingVisibleCandidate)
            || null;
    }

    function handleGuestModalKeydown(event) {
        const modal = getModal();
        if (!modal || modal.hidden) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeGuestModal();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = modalFocusableElements();
        if (!focusable.length) return;
        const active = document.activeElement;
        const currentIndex = focusable.indexOf(active);
        if (currentIndex < 0) {
            event.preventDefault();
            focusable[0].focus();
            return;
        }
        const nextIndex = event.shiftKey
            ? (currentIndex - 1 + focusable.length) % focusable.length
            : (currentIndex + 1) % focusable.length;
        if (nextIndex !== currentIndex + (event.shiftKey ? -1 : 1)) event.preventDefault();
        if (nextIndex === 0 || nextIndex === focusable.length - 1
            || currentIndex === 0 || currentIndex === focusable.length - 1) {
            event.preventDefault();
            focusable[nextIndex].focus();
        }
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

    function invalidateView() {
        state.viewGeneration += 1;
        state.actionGeneration += 1;
        return state.viewGeneration;
    }

    function beginAction() {
        state.actionGeneration += 1;
        return {
            actionGeneration: state.actionGeneration,
            viewGeneration: state.viewGeneration
        };
    }

    function isCurrentAction(operation) {
        return Boolean(operation)
            && operation.actionGeneration === state.actionGeneration
            && operation.viewGeneration === state.viewGeneration;
    }

    function isModalVisible() {
        return !getModal()?.hidden;
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
        creating: 'configure',
        awaiting_payment: 'payment',
        checking: 'payment',
        review: 'payment',
        payment_creation_unknown: 'payment',
        failed: 'payment',
        expired: 'payment',
        refunded: 'payment',
        chargeback: 'payment',
        cancelled: 'payment',
        canceled: 'payment',
        amount_mismatch: 'payment',
        overpaid: 'payment',
        partial: 'payment',
        confirmed: 'payment',
        paid_unfulfillable: 'payment',
        dead_letter: 'payment',
        delivered: 'delivery'
    };
    const ORDER_STATUS_LABELS = {
        configure: '待创建',
        creating: '创建中',
        awaiting_payment: '待支付',
        checking: '核验中',
        review: '待人工对账',
        payment_creation_unknown: '支付结果待确认',
        confirmed: '已支付，待发货',
        paid_unfulfillable: '已支付，人工处理中',
        dead_letter: '已支付，自动发货失败',
        failed: '支付失败',
        expired: '已过期',
        refunded: '已退款',
        chargeback: '已撤单',
        cancelled: '已取消',
        canceled: '已取消',
        amount_mismatch: '金额异常',
        overpaid: '多付待处理',
        partial: '少付待处理',
        delivered: '已发货',
        error: '需要处理',
        manual_review: '人工处理中'
    };

    const TERMINAL_PAYMENT_STATUSES = new Set([
        'failed', 'expired', 'refunded', 'chargeback', 'cancelled', 'canceled',
        'amount_mismatch', 'overpaid', 'partial'
    ]);

    function orderStatusMessage(status) {
        const messages = {
            failed: '支付未成功，请勿继续支付旧付款码。',
            expired: '订单已过期，请勿继续支付旧付款码。',
            refunded: '订单已退款。如资金尚未到账，请保留订单号联系客服。',
            chargeback: '订单支付已撤销或发生争议，请保留订单号联系客服。',
            cancelled: '订单已取消，请勿继续支付旧付款码。',
            canceled: '订单已取消，请勿继续支付旧付款码。',
            amount_mismatch: '收到的付款金额与订单不一致，已停止自动发货并转人工核对。',
            overpaid: '检测到多付金额，已停止自动发货并转人工处理。',
            partial: '检测到付款不足，请勿再向旧付款码补款，并保留订单号联系客服。'
        };
        return messages[status] || '订单状态需要人工处理，请保留订单号。';
    }

    function deriveOrderDisplayStatus(paymentStatus, fulfillmentStatus, refundStatus) {
        const payment = normalizeText(paymentStatus, 80).toLowerCase();
        const fulfillment = normalizeText(fulfillmentStatus, 80).toLowerCase();
        const refund = normalizeText(refundStatus, 80).toLowerCase();
        if (TERMINAL_PAYMENT_STATUSES.has(payment)) return payment;
        if (payment === 'refunded' || refund === 'succeeded' || fulfillment === 'refunded') return 'refunded';
        if (payment === 'chargeback') return 'chargeback';
        if (['review', 'payment_creation_unknown'].includes(payment)) return 'payment_creation_unknown';
        if (payment === 'confirmed') {
            if (['paid_unfulfillable', 'dead_letter'].includes(fulfillment)) return fulfillment;
            return 'confirmed';
        }
        return 'checking';
    }

    function isRestartableTerminalOrder(snapshot = state) {
        const status = normalizeText(snapshot.status, 80).toLowerCase();
        const fulfillmentStatus = normalizeText(snapshot.fulfillmentStatus, 80).toLowerCase();
        return Boolean(normalizeText(snapshot.orderNo, 200))
            && TERMINAL_PAYMENT_STATUSES.has(status)
            // An inconsistent snapshot must never let a terminal-payment label
            // discard already-delivered content from this browsing context.
            && fulfillmentStatus !== 'delivered'
            && snapshot.requestInFlight !== true
            && snapshot.statusRequestInFlight !== true
            && snapshot.claimInFlight !== true
            && snapshot.paymentCreationUnknown !== true;
    }

    function deriveGuestActionPolicy(snapshot = state) {
        const status = normalizeText(snapshot.status, 80).toLowerCase() || 'configure';
        const hasOrder = Boolean(normalizeText(snapshot.orderNo, 200));
        const creating = snapshot.requestInFlight === true || status === 'creating';
        const checking = snapshot.statusRequestInFlight === true;
        const inspectingIntent = snapshot.checkoutIntentInspectInFlight === true;
        const delivered = status === 'delivered';
        const canAdoptDetachedCheckout = !hasOrder
            && Boolean(snapshot.detachedCheckout)
            && !creating;
        const canResumeUnknownCreate = !hasOrder
            && Boolean(snapshot.pendingCreateAttempt)
            && (snapshot.paymentCreationUnknown === true || snapshot.pendingCreateAttempt?.unresolved === true)
            && !creating
            && !inspectingIntent;
        const unresolvedLocalCreate = Boolean(snapshot.detachedCheckout)
            || Boolean(snapshot.pendingCreateAttempt
                && (snapshot.paymentCreationUnknown === true
                    || snapshot.pendingCreateAttempt?.unresolved === true));
        const canCreate = !hasOrder
            && !snapshot.paymentCreationUnknown
            && !creating
            && !inspectingIntent
            && !snapshot.previewPending
            && ['configure', 'error'].includes(status);
        const canQuery = hasOrder
            && !creating
            && !delivered
            && status !== 'configure';
        const canLeaveOrder = hasOrder
            && status === 'awaiting_payment'
            && !snapshot.paymentConfirmed
            && !snapshot.paymentCreationUnknown
            && snapshot.statusRequestInFlight !== true
            && !snapshot.claimInFlight;
        const canRestartTerminalOrder = isRestartableTerminalOrder(snapshot);
        return {
            dismiss: {
                visible: true,
                // Closing is supported while a request is in flight: the action
                // generation prevents its late result from repainting this view.
                // Keep this aligned with Escape and backdrop behavior so a buyer
                // is never trapped behind a slow network request.
                disabled: false,
                busy: false,
                label: delivered ? '关闭已发货内容' : '稍后处理'
            },
            create: {
                visible: canCreate || canResumeUnknownCreate || canAdoptDetachedCheckout
                    || canRestartTerminalOrder || creating || inspectingIntent || (!hasOrder && snapshot.previewPending),
                disabled: !(canCreate || canResumeUnknownCreate || canAdoptDetachedCheckout || canRestartTerminalOrder),
                busy: creating || inspectingIntent,
                restartTerminal: canRestartTerminalOrder,
                label: canRestartTerminalOrder
                    ? '回到配置后创建新订单'
                    : (canAdoptDetachedCheckout
                    ? '查看已创建订单'
                    : (canResumeUnknownCreate ? '确认原订单结果'
                    : (inspectingIntent ? '正在检查未完成订单...' : '创建支付订单')))
            },
            query: {
                visible: canQuery,
                disabled: checking || snapshot.claimInFlight === true,
                busy: checking,
                label: TERMINAL_PAYMENT_STATUSES.has(status) || ['paid_unfulfillable', 'dead_letter'].includes(status)
                    ? '刷新处理状态'
                    : '查询支付状态'
            },
            abandon: {
                visible: canLeaveOrder,
                disabled: false,
                busy: false,
                label: '离开当前订单'
            }
        };
    }

    function applyActionPolicy(buttonId, policy, busyText = '处理中...') {
        const button = element(buttonId);
        if (!button) return;
        setHidden(buttonId, !policy.visible);
        if (!button.dataset.defaultLabel) button.dataset.defaultLabel = policy.label;
        if (!policy.busy) {
            button.textContent = policy.label;
            delete button.dataset.originalText;
        }
        button.disabled = Boolean(policy.disabled);
        button.setAttribute('aria-disabled', policy.disabled ? 'true' : 'false');
        button.setAttribute('aria-busy', policy.busy ? 'true' : 'false');
        if (policy.busy) {
            if (!button.dataset.originalText) button.dataset.originalText = policy.label;
            button.textContent = busyText;
        }
    }

    function syncConfigureControls() {
        const locked = state.requestInFlight
            || state.checkoutIntentInspectInFlight
            || Boolean(state.orderNo)
            || Boolean(state.pendingCreateAttempt
                && (state.paymentCreationUnknown || state.pendingCreateAttempt.unresolved));
        const resumeNeedsCredentials = Boolean(
            (state.paymentCreationUnknown || state.pendingCreateAttempt?.unresolved)
            && (state.pendingCreateAttempt?.requiresOrderPassword || state.pendingCreateAttempt?.requiresEmail)
            && !state.requestInFlight
        );
        ['guestCashPaymentChannel', 'guestCashDiscountCode']
            .forEach((id) => {
                const node = element(id);
                if (node) node.disabled = Boolean(locked);
            });
        const contact = element('guestCashContact');
        if (contact) contact.disabled = Boolean(locked && !resumeNeedsCredentials);
        const password = element('guestCashOrderPassword');
        if (password) password.disabled = Boolean(locked && !resumeNeedsCredentials);
        ['guestCashToggleOrderPasswordBtn', 'guestCashGenerateOrderPasswordBtn']
            .forEach((id) => {
                const node = element(id);
                if (node) node.disabled = Boolean(locked && !resumeNeedsCredentials);
            });
        syncQuantityUi();
    }

    function renderGuestActions() {
        const policy = deriveGuestActionPolicy();
        syncGuestOrdersLink();
        applyActionPolicy('guestCashPurchaseDismissBtn', policy.dismiss);
        applyActionPolicy(
            'guestCashCreateOrderBtn',
            policy.create,
            state.checkoutIntentInspectInFlight ? '正在检查...' : (state.pendingCreateAttempt ? '正在确认...' : '创建中...')
        );
        applyActionPolicy('guestCashCheckStatusBtn', policy.query, '查询中...');
        applyActionPolicy('guestCashAbandonOrderBtn', policy.abandon);
        setHidden('guestCashAbandonOrderHint', !policy.abandon.visible);
        setHidden('guestCashTerminalRestartHint', !policy.create.restartTerminal);
        setHidden(
            'guestCashDismissHint',
            !(state.orderNo || state.requestInFlight || state.checkoutIntentInspectInFlight || state.paymentCreationUnknown
                || state.pendingCreateAttempt?.unresolved || state.detachedCheckout)
        );
        syncConfigureControls();
    }

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
        renderGuestActions();
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
            const storage = window.sessionStorage;
            if (!storage) noteSessionStorageUnavailable();
            return storage || null;
        } catch (_) {
            noteSessionStorageUnavailable();
            return null;
        }
    }

    function syncSessionStorageWarning() {
        setText(
            'guestCashStorageWarning',
            state.buyerCredentialRequired
                ? '此浏览器无法暂存订单。请保存下单邮箱和查询密码；刷新或换页后可用“找回订单”继续。'
                : '此浏览器无法暂存订单。请保持当前页面；查询能力开启后可用邮箱 + 查询密码继续。'
        );
        setHidden('guestCashStorageWarning', !state.sessionStorageUnavailable);
    }

    function syncGuestOrdersLink() {
        const link = element('guestCashShowRecoveryBtn');
        if (!link) return;
        try {
            const current = new URL(window.location.href);
            const target = new URL('/guest-orders.html', current.origin);
            const site = String(current.searchParams.get('site') || '').trim().toLowerCase();
            if (site === 'cn' || site === 'intl') target.searchParams.set('site', site);
            const orderNo = normalizeText(state.orderNo, 200);
            if (/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u.test(orderNo)) {
                // The order number is a non-secret locator. Carrying it lets
                // the credential page open the exact pending order when the
                // buyer has several orders; credentials never enter this URL.
                target.searchParams.set('order_no', orderNo);
            }
            link.setAttribute('href', `${target.pathname}${target.search}`);
        } catch (_) {
            // Keep the static same-origin fallback when the location object is
            // unavailable in a constrained browser/test harness.
        }
    }

    function noteSessionStorageUnavailable() {
        state.sessionStorageUnavailable = true;
        syncSessionStorageWarning();
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

    function persistCheckoutRecord(record) {
        const orderNo = normalizeText(record?.orderNo, 200);
        if (!orderNo) return false;
        const storage = getSessionStorage();
        if (!storage) return false;
        try {
            storage.setItem(STORAGE_KEY, JSON.stringify({
                version: STORAGE_VERSION,
                orderNo,
                site: normalizeSite(record?.site),
                productId: normalizeText(record?.productId, 100),
                skuId: normalizeText(record?.skuId, 100),
                expiresAt: normalizeText(record?.expiresAt, 80),
                provider: normalizeText(record?.provider, 80).toLowerCase(),
                channel: normalizeText(record?.channel, 80).toLowerCase(),
                intentId: checkoutIntentId(record?.intentId),
                savedAt: new Date().toISOString()
            }));
            return true;
        } catch (_) {
            // A storage failure does not invalidate the in-memory checkout.
            noteSessionStorageUnavailable();
            return false;
        }
    }

    function persistCheckout() {
        return persistCheckoutRecord(state);
    }

    function hydrateCheckout(parsed) {
        if (!parsed) return false;
        state.orderNo = normalizeText(parsed.orderNo, 200);
        state.checkoutIntentId = checkoutIntentId(parsed.intentId);
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
        state.paymentCreationUnknown = false;
        state.pendingCreateAttempt = null;
        state.detachedCheckout = null;
        state.status = 'checking';
        state.fulfillmentStatus = '';
        state.refundStatus = '';
        state.deliveryCopied = false;
        return Boolean(state.orderNo);
    }

    function clearStoredCheckout() {
        const storage = getSessionStorage();
        if (!storage) return;
        try {
            storage.removeItem(STORAGE_KEY);
        } catch (_) {
            // Storage may be unavailable in locked-down browsers.
            noteSessionStorageUnavailable();
        }
    }

    function clearStoredCheckoutAfterAcknowledgement() {
        const selector = checkoutIntentId(state.checkoutIntentId);
        if (selector && state.checkoutIntentAckInFlightId === selector) {
            // Keep the safe handle until the in-flight ack settles. If that
            // request fails, the queued terminal retry can still use it.
            state.checkoutIntentClearAfterAckId = selector;
            return;
        }
        clearStoredCheckout();
    }

    function hasPersistedCheckoutHandle(orderNo = state.orderNo) {
        const expected = normalizeText(orderNo, 200);
        if (!expected) return false;
        const storage = getSessionStorage();
        if (!storage) return false;
        try {
            const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
            // Do not call storedCheckout() here: an expired terminal order may
            // still have a valid local handle that is sufficient to retry ack.
            return Boolean(parsed
                && parsed.version === STORAGE_VERSION
                && normalizeText(parsed.orderNo, 200) === expected);
        } catch (_) {
            return false;
        }
    }

    function isAbandonableOrder() {
        if (!normalizeText(state.orderNo, 200)) return false;
        if (state.paymentConfirmed) return false;
        if (state.status !== 'awaiting_payment') return false;
        if (state.paymentCreationUnknown) return false;
        if (state.statusRequestInFlight) return false;
        if (state.claimInFlight) return false;
        return true;
    }

    function syncAbandonOrderButton() {
        renderGuestActions();
    }

    function hydrateReturnOrderNo(orderNo) {
        const normalized = normalizeText(orderNo, 200);
        if (!normalized) return false;
        // A provider return can open in a new top-level browsing context where
        // sessionStorage is empty. Keep only the non-sensitive order handle;
        // status/claim endpoints still require the HttpOnly proof cookie.
        state.orderNo = normalized;
        state.site = normalizeSite(window.SiteConfig?.site);
        state.productId = '';
        state.skuId = '';
        state.expiresAt = '';
        state.provider = '';
        state.channel = '';
        state.checkout = null;
        state.contextKey = '';
        state.paymentConfirmed = false;
        state.paymentCreationUnknown = false;
        state.pendingCreateAttempt = null;
        state.detachedCheckout = null;
        state.fulfillmentStatus = '';
        state.refundStatus = '';
        state.deliveryCopied = false;
        state.status = 'checking';
        if (state.checkoutIntentId) acknowledgeCheckoutIntent(state.checkoutIntentId);
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
            // A fail-closed checkout-intent response can safely carry a public
            // selector. Keep it only on this transient error object; it is never
            // persisted and contains no idempotency key or buyer credential.
            error.payload = payload;
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
        // key. status snapshots omit it for a pre-L1 row (list_unit_amount
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
        state.quoteGeneration += 1;
        renderPayableSummary();
        if (state.previewPending) {
            const context = getPurchaseContext();
            if (context) void loadPreview(context);
        }
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
        const pendingIntentRequiresEmail = Boolean(
            state.pendingCreateAttempt
            && (state.paymentCreationUnknown || state.pendingCreateAttempt.unresolved)
            && state.pendingCreateAttempt.requiresEmail
        );
        const contactRequired = required || pendingIntentRequiresEmail;
        setHidden('guestCashOrderPasswordField', !required);
        // §11.3 frozen copy. The email is the lookup key for the order and its
        // card secret, so it becomes mandatory the moment a password is asked
        // for, and remains optional while the credential capability is OFF.
        setText('guestCashContactHint', required
            ? '必填，用于查询订单'
            : (pendingIntentRequiresEmail ? '必填，需与原订单一致' : '可选'));
        const contact = element('guestCashContact');
        if (contact) contact.required = contactRequired;
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

    function hasFrozenCreateAttempt() {
        return Boolean(state.pendingCreateAttempt
            && (state.paymentCreationUnknown || state.pendingCreateAttempt.unresolved));
    }

    function invalidatePreviewQuote() {
        // Drop the cached quote so the next loadPreview() re-quotes at the new
        // quantity, and drop the derived totals so the modal can never keep
        // showing an amount that belongs to another selection. state.preview is
        // kept: it still owns the payment-channel list and the surcharge labels,
        // which are quantity-independent.
        cancelScheduledPreview();
        state.quoteGeneration += 1;
        state.previewKey = '';
        state.listSubtotal = null;
        state.amountBreakdown = null;
    }

    function schedulePreviewRefresh() {
        cancelScheduledPreview();
        state.quantityPreviewTimer = window.setTimeout(() => {
            state.quantityPreviewTimer = null;
            const context = getPurchaseContext();
            if (context && !state.orderNo && !hasFrozenCreateAttempt()) void loadPreview(context);
        }, QUANTITY_PREVIEW_DEBOUNCE_MS);
    }

    function syncQuantityUi() {
        const cap = quantityCapValue();
        // With the L1 switch off the cap is 1, the stepper stays hidden and the
        // configure panel is byte-identical to the pre-promo checkout.
        const multiUnit = cap >= 2;
        const locked = Boolean(state.orderNo)
            || state.requestInFlight
            || hasFrozenCreateAttempt();
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
        if (state.orderNo || hasFrozenCreateAttempt()) return;
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
        if (state.orderNo || hasFrozenCreateAttempt()) return;
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
        if (input) input.disabled = Boolean(state.orderNo) || state.requestInFlight;
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
    // for a signal the server is forbidden to send.
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
        if (options.length === 0) {
            if (!state.requestInFlight) setStateMessage('当前商品暂未开放游客支付', 'error');
            return false;
        }
        if (!state.requestInFlight) setStateMessage('请选择支付方式并创建订单', 'configure');
        return true;
    }

    // Preview requests are serialized so a caller that lands while an earlier
    // probe is still in flight waits for that result instead of getting a
    // "not available yet" answer. The merged logged-out entry point treats an
    // unavailable preview as "fall back to login", so a duplicate probe must
    // never look like a negative result.
    let previewQueue = Promise.resolve();

    function capturePreviewRequest(context) {
        const quantity = normalizeQuantity(state.quantity);
        return {
            contextKey: normalizeText(context?.contextKey, 200),
            cacheKey: `${normalizeText(context?.contextKey, 200)}#${quantity}`,
            quantity,
            quoteGeneration: state.quoteGeneration,
            viewGeneration: state.viewGeneration
        };
    }

    function isCurrentPreviewRequest(request) {
        const current = getPurchaseContext();
        return Boolean(request)
            && request.viewGeneration === state.viewGeneration
            && request.quoteGeneration === state.quoteGeneration
            && request.cacheKey === previewCacheKey({ contextKey: request.contextKey })
            && (!current || current.contextKey === request.contextKey);
    }

    function loadPreview(context) {
        if (!context) return Promise.resolve({ available: false, reason: 'missing_context' });
        if (context.manualDelivery) return Promise.resolve({ available: false, reason: 'manual_delivery' });
        if (context.soldOut) return Promise.resolve({ available: false, reason: 'sold_out' });
        const request = capturePreviewRequest(context);
        const task = previewQueue.then(() => runPreviewRequest(context, request));
        previewQueue = task.then(() => undefined, () => undefined);
        return task;
    }

    async function runPreviewRequest(context, request = capturePreviewRequest(context)) {
        if (!isCurrentPreviewRequest(request)) return { available: false, reason: 'stale' };
        const cacheKey = request.cacheKey;
        if (state.previewKey === cacheKey && state.preview) {
            return { available: !state.previewError, reason: state.previewError ? 'unavailable' : 'available' };
        }
        state.previewPending = true;
        state.previewError = false;
        renderGuestActions();
        // L1: quantity rides along so the modal quotes the tier the buyer will
        // actually be charged. It is the only promo input on this request - a
        // discount code is NEVER sent to preview, never appears in a URL and is
        // never cached, because preview is an unauthenticated GET (§11.1). The
        // code is validated for real once, in the create-order body.
        const query = new URLSearchParams({
            site: context.site,
            productId: context.productId,
            skuId: context.skuId,
            quantity: String(request.quantity)
        });
        try {
            const payload = await requestJson(`${PREVIEW_ENDPOINT}?${query.toString()}`, { method: 'GET' });
            if (!isCurrentPreviewRequest(request)) return { available: false, reason: 'stale' };
            const available = renderPreview(context, payload);
            return { available, reason: available ? 'available' : 'unavailable' };
        } catch (error) {
            if (!isCurrentPreviewRequest(request)) return { available: false, reason: 'stale' };
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
            renderGuestActions();
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
        const valid = (details.provider === 'zpay'
            && Boolean(details.qrcodeImageUrl || details.qrcodeUrl || details.checkoutUrl))
            || (details.provider === 'nowpayments'
                && Boolean(details.address)
                && details.payCurrency === 'USDTBSC');
        if (!valid) {
            state.checkout = null;
            state.paymentCreationUnknown = true;
            setHidden('guestCashCheckoutPanel', true);
            setHidden('guestCashConfigurePanel', true);
            resetZpayHostedQr();
            setStateMessage(
                details.provider === 'nowpayments'
                    ? '加密货币支付信息无效，请保留订单号并联系客服'
                    : '支付凭证暂时无法安全展示，请保留订单号并先查询状态',
                'payment_creation_unknown'
            );
            return false;
        }
        state.checkout = details;
        state.paymentCreationUnknown = false;
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
        return true;
    }

    function suppressUnsafeCheckout() {
        state.checkout = null;
        setHidden('guestCashCheckoutPanel', true);
        setHidden('guestCashZpayPanel', true);
        setHidden('guestCashNowpaymentsPanel', true);
        resetZpayHostedQr();
        setText('guestCashNowAmount', '-');
        setText('guestCashNowAddress', '');
    }

    function selectedPayment() {
        const select = element('guestCashPaymentChannel');
        const option = select?.selectedOptions?.[0];
        return {
            provider: normalizeText(option?.dataset?.provider, 80).toLowerCase(),
            channel: normalizeText(option?.dataset?.channel, 80).toLowerCase()
        };
    }

    const DEFINITIVE_CREATE_FAILURE_CODES = new Set([
        'guest_provider_create_failed',
        'guest_payment_channel_unavailable',
        'guest_payment_provider_disabled',
        'guest_payment_provider_not_ready',
        'guest_payment_provider_unavailable',
        'guest_checkout_intent_missing',
        'guest_checkout_intent_invalid',
        'guest_checkout_intent_expired',
        'guest_checkout_intent_contact_mismatch'
    ]);

    function createResultIsUnknown(error, { requestStarted = false, retryingUnknown = false } = {}) {
        if (!requestStarted) return false;
        const code = normalizeText(error?.code, 100).toLowerCase();
        if (DEFINITIVE_CREATE_FAILURE_CODES.has(code)) return false;
        if (retryingUnknown) return true;
        // A checkout commit may have reached the server after its response was
        // lost. The server-held intent key makes the retry a lookup-first replay,
        // so retain only the public intent selector until it resolves.
        return code === 'guest_payment_reconciliation_required'
            || code === 'guest_payment_creation_in_progress'
            || !Number.isFinite(Number(error?.status))
            || Number(error?.status) >= 500;
    }

    function checkoutIntentId(value) {
        const normalized = normalizeText(value, 120);
        return /^ci\.[A-Za-z0-9_-]{24,96}$/u.test(normalized) ? normalized : '';
    }

    function checkoutIntentPaymentPart(value) {
        const normalized = normalizeText(value, 80).toLowerCase();
        return /^[a-z0-9][a-z0-9._:-]{0,79}$/u.test(normalized) ? normalized : '';
    }

    function checkoutIntentContext(intent, fallbackContext = null) {
        const site = normalizeText(intent?.site, 10).toLowerCase();
        const productId = normalizeText(intent?.product_id, 100);
        const skuId = normalizeText(intent?.sku_id, 100);
        if (!['cn', 'intl'].includes(site) || !productId || !skuId) return null;
        const fallback = fallbackContext || getPurchaseContext();
        const sameSelection = fallback
            && fallback.site === site
            && fallback.productId === productId
            && fallback.skuId === skuId;
        return {
            context: {
                site,
                productId,
                skuId,
                productName: sameSelection ? normalizeText(fallback.productName, 240) : '原订单商品',
                skuName: sameSelection ? normalizeText(fallback.skuName, 240) : '原订单规格',
                contextKey: [site, productId, skuId].join(':')
            }
        };
    }

    function checkoutIntentAttempt(intent, fallbackContext = null) {
        const intentId = checkoutIntentId(intent?.intent_id);
        const provider = checkoutIntentPaymentPart(intent?.provider);
        const channel = checkoutIntentPaymentPart(intent?.channel);
        const contextResult = checkoutIntentContext(intent, fallbackContext);
        if (!intentId || !provider || !channel || !contextResult) return null;
        return {
            intentId,
            context: contextResult.context,
            payment: { provider, channel },
            requiresOrderPassword: intent?.buyer_credential_required === true,
            requiresEmail: intent?.contact_required === true || intent?.buyer_credential_required === true,
            createDeadlineAt: normalizeText(intent?.create_deadline_at, 80),
            expiresAt: normalizeText(intent?.expires_at, 80),
            unresolved: false
        };
    }

    function rememberCheckoutIntent(intent, fallbackContext = null) {
        const attempt = checkoutIntentAttempt(intent, fallbackContext);
        if (!attempt) return null;
        state.pendingCreateAttempt = attempt;
        return attempt;
    }

    function rememberUnresolvedCheckoutIntent(context, payment, { requiresOrderPassword = false, requiresEmail = false } = {}) {
        const safeContext = context || getPurchaseContext();
        const provider = checkoutIntentPaymentPart(payment?.provider);
        const channel = checkoutIntentPaymentPart(payment?.channel);
        if (!safeContext || !provider || !channel) return null;
        const attempt = {
            intentId: '',
            context: {
                site: normalizeSite(safeContext.site),
                productId: normalizeText(safeContext.productId, 100),
                skuId: normalizeText(safeContext.skuId, 100),
                productName: normalizeText(safeContext.productName, 240),
                skuName: normalizeText(safeContext.skuName, 240),
                contextKey: normalizeText(safeContext.contextKey, 300)
            },
            payment: { provider, channel },
            requiresOrderPassword: Boolean(requiresOrderPassword),
            requiresEmail: Boolean(requiresEmail),
            createDeadlineAt: '',
            expiresAt: '',
            unresolved: true
        };
        state.pendingCreateAttempt = attempt;
        return attempt;
    }

    function applyPendingCheckoutIntent(attempt, { message = '', refreshed = false } = {}) {
        if (!attempt) return false;
        state.pendingCreateAttempt = attempt;
        state.paymentCreationUnknown = true;
        state.status = 'payment_creation_unknown';
        state.site = attempt.context.site;
        state.productId = attempt.context.productId;
        state.skuId = attempt.context.skuId;
        state.contextKey = attempt.context.contextKey;
        state.provider = attempt.payment.provider;
        state.channel = attempt.payment.channel;
        state.buyerCredentialRequired = attempt.requiresOrderPassword;
        state.checkout = null;
        state.expiresAt = '';
        suppressUnsafeCheckout();
        setText('guestCashProductName', attempt.context.productName || '原订单商品');
        setText('guestCashSkuName', attempt.context.skuName || '原订单规格');
        showOrderNo('');
        syncBuyerCredentialUi();
        setHidden('guestCashConfigurePanel', !(attempt.requiresEmail || attempt.requiresOrderPassword));
        setStateMessage(
            message || (refreshed
                ? '检测到上次未确认的订单。请填写原邮箱和查询密码后确认原订单结果；系统不会创建新订单。'
                : '上一笔订单创建结果待确认。请确认原订单结果；系统不会创建新订单。'),
            'payment_creation_unknown'
        );
        renderGuestActions();
        return true;
    }

    async function inspectCheckoutIntent(context = null, { operation = null, announce = true } = {}) {
        if (state.checkoutIntentInspectInFlight || state.orderNo) return null;
        state.checkoutIntentInspectInFlight = true;
        renderGuestActions();
        try {
            const payload = await requestJson(ORDER_ENDPOINT, {
                method: 'POST',
                body: JSON.stringify({ checkoutAction: 'inspect' })
            });
            if (operation && !isCurrentAction(operation)) return null;
            const intent = payload?.intent;
            if (intent?.pending === true) {
                const attempt = rememberCheckoutIntent(intent, context);
                if (!attempt) throw new Error('未完成订单的安全凭证无效，请重新确认商品后再试');
                applyPendingCheckoutIntent(attempt, { refreshed: announce });
                return attempt;
            }
            const hadUnresolvedIntent = Boolean(state.pendingCreateAttempt?.unresolved || state.paymentCreationUnknown);
            clearPendingCreateAttempt();
            state.paymentCreationUnknown = false;
            if (hadUnresolvedIntent && isModalVisible()) {
                state.status = 'configure';
                setHidden('guestCashConfigurePanel', false);
                setStateMessage('未找到可恢复的原订单，请重新确认报价后再创建订单。', 'configure');
            }
            return null;
        } catch (error) {
            if (operation && !isCurrentAction(operation)) return null;
            const fallback = state.pendingCreateAttempt
                || rememberUnresolvedCheckoutIntent(context, selectedPayment(), {
                    requiresOrderPassword: state.buyerCredentialRequired,
                    requiresEmail: state.buyerCredentialRequired || Boolean(normalizeText(element('guestCashContact')?.value, 160))
                });
            if (fallback) {
                fallback.unresolved = true;
                applyPendingCheckoutIntent(fallback, {
                    message: '暂时无法确认未完成订单。请稍后点击“确认原订单结果”重试；不要重新付款。'
                });
            } else if (isModalVisible()) {
                state.status = 'error';
                setStateMessage(normalizeText(error?.message, 300) || '暂时无法确认未完成订单，请稍后重试', 'error');
            }
            return null;
        } finally {
            state.checkoutIntentInspectInFlight = false;
            renderGuestActions();
        }
    }

    function acknowledgeCheckoutIntent(intentId) {
        const selector = checkoutIntentId(intentId);
        if (!selector) return;
        if (state.checkoutIntentAckedId === selector) {
            if (state.checkoutIntentAckRetryId === selector) state.checkoutIntentAckRetryId = '';
            return;
        }
        if (state.checkoutIntentAckInFlightId === selector) return;
        // Ack is intentionally best-effort. Failure leaves an encrypted cookie
        // that can only replay the same order; it must not discard the safe
        // order handle the buyer already received.
        state.checkoutIntentAckInFlightId = selector;
        void requestJson(ORDER_ENDPOINT, {
            method: 'POST',
            body: JSON.stringify({ checkoutAction: 'ack', intentId: selector })
        }).then(() => {
            state.checkoutIntentAckedId = selector;
            if (state.checkoutIntentAckRetryId === selector) state.checkoutIntentAckRetryId = '';
        }).catch(() => undefined).finally(() => {
            if (state.checkoutIntentAckInFlightId === selector) {
                state.checkoutIntentAckInFlightId = '';
            }
            // A terminal snapshot can arrive before the first best-effort ack
            // settles. Queue exactly one same-selector retry in that case; a
            // successful first request clears the queue above, and a failed
            // retry is left for a later explicit terminal action.
            if (state.checkoutIntentAckRetryId === selector
                && state.checkoutIntentAckedId !== selector) {
                state.checkoutIntentAckRetryId = '';
                if (hasPersistedCheckoutHandle()) acknowledgeCheckoutIntent(selector);
            }
            if (state.checkoutIntentClearAfterAckId === selector
                && state.checkoutIntentAckedId === selector
                && state.checkoutIntentAckInFlightId !== selector) {
                state.checkoutIntentClearAfterAckId = '';
                clearStoredCheckout();
            }
        });
    }

    function retryCheckoutIntentAcknowledgement() {
        const selector = checkoutIntentId(state.checkoutIntentId);
        if (!selector || !hasPersistedCheckoutHandle()) return;
        if (state.checkoutIntentAckedId === selector) return;
        if (state.checkoutIntentAckInFlightId === selector) {
            state.checkoutIntentAckRetryId = selector;
            return;
        }
        state.checkoutIntentAckRetryId = '';
        acknowledgeCheckoutIntent(selector);
    }

    function clearPendingCreateAttempt(attempt = null) {
        if (attempt && state.pendingCreateAttempt !== attempt) return;
        state.pendingCreateAttempt = null;
    }

    function resetActiveOrderForContext(context) {
        if (!context || !state.orderNo || !state.contextKey || state.contextKey === context.contextKey) return;
        // A live order belongs to the product/SKU that created it. When the
        // authenticated purchase modal switches selection, never show or poll
        // that order in the new guest checkout dialog. Keep sessionStorage
        // untouched so a refresh can still recover the original order.
        invalidateView();
        stopPolling();
        state.orderNo = '';
        state.checkoutIntentId = '';
        state.expiresAt = '';
        state.provider = '';
        state.channel = '';
        state.checkout = null;
        state.paymentConfirmed = false;
        state.paymentCreationUnknown = false;
        state.pendingCreateAttempt = null;
        state.detachedCheckout = null;
        state.fulfillmentStatus = '';
        state.refundStatus = '';
        state.deliveryCopied = false;
        state.status = 'configure';
        state.confirmedPricing = null;
        state.amountBreakdown = null;
        resetOrderUi();
    }

    function lockGuestModalScroll(modal) {
        if (!modal) return;
        if (window.iOSScrollLock) {
            // A light lock participates in the shared suspended-owner protocol,
            // so a temporary auth/notice overlay can restore this modal's lock.
            window.iOSScrollLock.lockLight(modal, { restoreScrollDuringViewport: true });
            return;
        }
        document.documentElement?.classList.add('no-scroll');
        document.body?.classList.add('no-scroll');
        state.fallbackModalScrollLock = true;
    }

    function unlockGuestModalScroll(modal = getModal()) {
        if (window.iOSScrollLock?.isLocked) window.iOSScrollLock.unlock(modal);
        if (!state.fallbackModalScrollLock) return;
        document.documentElement?.classList.remove('no-scroll');
        document.body?.classList.remove('no-scroll');
        state.fallbackModalScrollLock = false;
    }

    function openGuestModal(context, { deferScrollLock = false } = {}) {
        const modal = getModal();
        if (!modal) return;
        if (modal.hidden) {
            const active = document.activeElement;
            if (active && active !== modal && typeof active.focus === 'function') {
                state.lastTriggerElement = active;
            }
            invalidateView();
        }
        const inspectOperation = {
            actionGeneration: state.actionGeneration,
            viewGeneration: state.viewGeneration
        };
        if (!state.orderNo && state.detachedCheckout) {
            const detached = state.detachedCheckout;
            hydrateCheckout(detached);
            setText('guestCashProductName', detached.productName || '-');
            setText('guestCashSkuName', detached.skuName || '-');
            // The explicit late-success handle wins over the product tile that
            // happened to reopen the modal. Passing that tile through the context
            // reset below would immediately discard the order we just adopted.
            context = null;
        }
        if (!state.orderNo) {
            const saved = storedCheckout();
            const savedContextKey = saved?.productId && saved?.skuId
                ? [normalizeSite(saved.site), normalizeText(saved.productId, 100), normalizeText(saved.skuId, 100)].join(':')
                : '';
            if (saved && (!context || !savedContextKey || savedContextKey === context.contextKey)) {
                hydrateCheckout(saved);
                clearPendingCreateAttempt();
            }
        }
        if (!state.orderNo
            && (state.paymentCreationUnknown || state.pendingCreateAttempt?.unresolved)
            && state.pendingCreateAttempt?.context) {
            // A new product click cannot silently replace an unresolved create.
            // Keep presenting the original immutable attempt until it yields an
            // order handle or a definitive failure.
            context = state.pendingCreateAttempt.context;
        }
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
        modal.setAttribute('aria-hidden', 'false');
        modal.classList.add('active');
        document.body?.classList.add('guest-shop-modal-open');
        if (!deferScrollLock) lockGuestModalScroll(modal);
        syncSessionStorageWarning();
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
        } else if ((state.paymentCreationUnknown || state.pendingCreateAttempt?.unresolved)
            && state.pendingCreateAttempt) {
            showOrderNo('');
            setHidden('guestCashCheckoutPanel', true);
            setHidden(
                'guestCashConfigurePanel',
                !(state.pendingCreateAttempt.requiresOrderPassword || state.pendingCreateAttempt.requiresEmail)
            );
            syncBuyerCredentialUi();
            setStateMessage(
                state.pendingCreateAttempt.requiresOrderPassword
                    ? '上一笔订单创建结果待确认。请重新输入原邮箱和查询密码，再确认原订单；不要重新付款。'
                    : (state.pendingCreateAttempt.requiresEmail
                        ? '上一笔订单创建结果待确认。请重新输入原邮箱，再确认原订单；不要重新付款。'
                        : '上一笔订单创建结果待确认。请确认原订单结果；系统不会创建新订单。'),
                'payment_creation_unknown'
            );
        } else {
            showOrderNo('');
            setHidden('guestCashCreateOrderBtn', false);
            setHidden('guestCashCheckStatusBtn', true);
            setStateMessage('正在检查未完成订单...', 'configure');
            void inspectCheckoutIntent(context || getPurchaseContext(), { operation: inspectOperation })
                .then((attempt) => {
                    if (attempt || !isCurrentAction(inspectOperation) || state.orderNo
                        || state.paymentCreationUnknown || !isModalVisible()) return;
                    setStateMessage('正在确认商品信息...', 'configure');
                    void loadPreview(context || getPurchaseContext());
                });
        }
        if (state.orderNo) {
            void pollStatus({ immediate: true });
        }
        renderGuestActions();
        focusGuestModal();
    }

    function closeGuestModal() {
        const deliveryNotCopied = state.status === 'delivered'
            && normalizeText(element('guestCashDeliveredContent')?.textContent, 10000)
            && !state.deliveryCopied;
        if (deliveryNotCopied) {
            const warnings = [];
            if (deliveryNotCopied) warnings.push('发货内容尚未复制。');
            const confirmed = typeof window.confirm !== 'function' || window.confirm(
                `${warnings.join('')}关闭后刷新页面可能无法再次显示，确定仍要关闭吗？`
            );
            if (!confirmed) return;
        }
        // A query password must not outlive the modal it was typed in.
        clearOrderPassword();
        invalidateView();
        cancelScheduledPreview();
        stopPolling();
        stopZpayCountdown();
        const modal = getModal();
        if (!modal) return;
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        modal.classList.remove('active');
        document.body?.classList.remove('guest-shop-modal-open');
        unlockGuestModalScroll();
        const trigger = isUsableReturnFocusTarget(state.lastTriggerElement)
            ? state.lastTriggerElement
            : fallbackReturnFocusTarget();
        if (isUsableReturnFocusTarget(trigger)) {
            try { trigger.focus(); } catch (_) { /* focus restoration is best effort */ }
        }
        renderGuestActions();
    }

    function clearCompletedCheckout() {
        if (state.status !== 'delivered') return false;
        stopPolling();
        stopZpayCountdown();
        clearStoredCheckout();
        acknowledgeCheckoutIntent(state.checkoutIntentId);
        state.orderNo = '';
        state.checkoutIntentId = '';
        state.expiresAt = '';
        state.provider = '';
        state.channel = '';
        state.paymentConfirmed = false;
        state.paymentCreationUnknown = false;
        state.pendingCreateAttempt = null;
        state.detachedCheckout = null;
        state.fulfillmentStatus = '';
        state.refundStatus = '';
        state.deliveryCopied = false;
        state.status = 'configure';
        state.confirmedPricing = null;
        state.amountBreakdown = null;
        state.paymentConfirmedAt = null;
        state.lastStatusQueryTime = null;
        resetOrderUi();
        setStateMessage('发货内容已关闭，可以重新购买。', 'configure');
        return true;
    }

    function resetOrderUi() {
        setHidden('guestCashCheckoutPanel', true);
        setHidden('guestCashConfigurePanel', false);
        setHidden('guestCashDeliveryPanel', true);
        setHidden('guestCashCheckStatusBtn', true);
        setHidden('guestCashCreateOrderBtn', false);
        // L1/L2: the stepper and the code field are order-scoped inputs, so they
        // lock while an order exists and unlock again on 离开当前订单. Both stay
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
        state.paymentConfirmedAt = null;
        state.lastStatusQueryTime = null;
        if (!state.orderNo) showOrderNo('');
        syncAbandonOrderButton();
        syncStepState('configure');
        syncOrderMeta('configure');
    }

    function abandonCurrentOrder() {
        if (!isAbandonableOrder()) {
            syncAbandonOrderButton();
            if (state.orderNo && (state.paymentConfirmed || state.status === 'delivered' || state.status === 'confirmed')) {
                setStateMessage('当前订单已确认付款或已发货，不能离开并清除本地句柄。请保留订单号。', state.status);
            }
            return;
        }
        const confirmed = typeof window.confirm !== 'function' || window.confirm(
            '这只会从当前页面移除订单，不会取消服务端订单或立即释放库存。请勿再支付旧付款码，确定离开吗？'
        );
        if (!confirmed) return;
        invalidateView();
        stopPolling();
        stopZpayCountdown();
        clearStoredCheckout();
        acknowledgeCheckoutIntent(state.checkoutIntentId);
        clearOrderPassword();
        const contact = element('guestCashContact');
        if (contact) contact.value = '';
        state.orderNo = '';
        state.checkoutIntentId = '';
        state.expiresAt = '';
        state.provider = '';
        state.channel = '';
        state.checkout = null;
        state.paymentConfirmed = false;
        state.paymentCreationUnknown = false;
        state.pendingCreateAttempt = null;
        state.detachedCheckout = null;
        state.fulfillmentStatus = '';
        state.refundStatus = '';
        state.deliveryCopied = false;
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
        setStateMessage('已从当前页面离开旧订单。这不代表服务端订单已取消：请勿再支付旧付款码，库存预占将按过期时间释放。', 'configure');
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

    function returnTerminalOrderToConfiguration() {
        if (!isRestartableTerminalOrder()) {
            renderGuestActions();
            return false;
        }
        const context = getPurchaseContext();
        const terminalStatus = state.status;
        if (!context || context.manualDelivery || context.soldOut) {
            setStateMessage('当前商品暂时无法创建新订单；已保留终态订单与订单号。', terminalStatus);
            return false;
        }
        const confirmed = typeof window.confirm !== 'function' || window.confirm(
            '此操作只会清除本地订单句柄，不会取消服务端订单或立即释放库存。旧付款码不可再付；回到配置后需再次确认报价并创建新订单，确定继续吗？'
        );
        if (!confirmed) return false;

        const previousContextKey = state.contextKey;
        invalidateView();
        stopPolling();
        stopZpayCountdown();
        clearStoredCheckout();
        acknowledgeCheckoutIntent(state.checkoutIntentId);
        clearOrderPassword();
        const contact = element('guestCashContact');
        if (contact) contact.value = '';
        state.orderNo = '';
        state.checkoutIntentId = '';
        state.expiresAt = '';
        state.provider = '';
        state.channel = '';
        state.checkout = null;
        state.paymentConfirmed = false;
        state.paymentCreationUnknown = false;
        state.pendingCreateAttempt = null;
        state.detachedCheckout = null;
        state.fulfillmentStatus = '';
        state.refundStatus = '';
        state.deliveryCopied = false;
        state.status = 'configure';
        state.confirmedPricing = null;
        state.amountBreakdown = null;
        state.paymentConfirmedAt = null;
        state.lastStatusQueryTime = null;
        state.preview = null;
        state.previewError = false;
        state.buyerCredentialRequired = false;
        if (previousContextKey !== context.contextKey) resetPromoSelection();
        else invalidatePreviewQuote();
        state.site = context.site;
        state.productId = context.productId;
        state.skuId = context.skuId;
        state.contextKey = context.contextKey;
        setText('guestCashProductName', context.productName || '-');
        setText('guestCashSkuName', context.skuName || '-');
        syncBuyerCredentialUi();
        resetOrderUi();
        showOrderNo('');
        setStateMessage('已回到配置。旧订单仍保留在服务端，旧付款码不可再付；请确认报价后再创建新订单。', 'configure');
        void loadPreview(context);
        return true;
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
        if (state.requestInFlight
            || state.statusRequestInFlight
            || state.checkoutIntentInspectInFlight
            || state.claimInFlight) return;
        if (isRestartableTerminalOrder()) {
            returnTerminalOrderToConfiguration();
            return;
        }
        if (state.orderNo && !state.detachedCheckout) return;
        if (state.detachedCheckout) {
            const detached = state.detachedCheckout;
            hydrateCheckout(detached);
            setText('guestCashProductName', detached.productName || '-');
            setText('guestCashSkuName', detached.skuName || '-');
            openGuestModal(null);
            setStateMessage('已接管刚才创建的订单，正在核验支付状态。', 'checking');
            return;
        }
        const retryAttempt = (state.paymentCreationUnknown || state.pendingCreateAttempt?.unresolved)
            ? state.pendingCreateAttempt
            : null;
        const retryingUnknown = Boolean(retryAttempt);
        const context = retryAttempt?.context || getPurchaseContext();
        if (!context || (!retryingUnknown && (context.manualDelivery || context.soldOut))) {
            setStateMessage('当前商品不支持游客购买', 'error');
            return;
        }
        // The lock and operation token are acquired before the first await.
        // A double click therefore joins the same attempt instead of issuing a
        // second preview/create sequence after both previews resolve.
        state.requestInFlight = true;
        if (!retryingUnknown) state.paymentCreationUnknown = false;
        const operation = beginAction();
        const quoteGeneration = state.quoteGeneration;
        const contextKey = context.contextKey;
        let commitRequestStarted = false;
        let attempt = retryAttempt;
        setStateMessage(
            retryingUnknown ? '正在使用原请求确认订单结果...' : '正在确认报价并准备支付订单...',
            'creating'
        );
        // A quantity change schedules a debounced re-quote. Drop the timer here:
        // loadPreview() below fetches the same key synchronously in this flow, so
        // leaving the timer armed would only spend a second preview request from
        // the shared per-IP budget.
        cancelScheduledPreview();
        try {
            let payment;
            let body;
            if (retryingUnknown) {
                if (!attempt.intentId) {
                    await inspectCheckoutIntent(attempt.context, { operation, announce: false });
                    attempt = state.pendingCreateAttempt;
                }
                if (!attempt?.intentId) {
                    clearPendingCreateAttempt();
                    state.paymentCreationUnknown = false;
                    setStateMessage('未找到可安全恢复的原订单，请重新确认商品后再试。', 'error');
                    return;
                }
                payment = { ...attempt.payment };
                body = { checkoutAction: 'commit', intentId: attempt.intentId };
                const email = normalizeText(element('guestCashContact')?.value, 160);
                if (attempt.requiresEmail && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))) {
                    setHidden('guestCashConfigurePanel', false);
                    setStateMessage('请填写创建原订单时使用的邮箱，再确认原订单结果。', 'payment_creation_unknown');
                    return;
                }
                if (email) body.email = email;
                if (attempt.requiresOrderPassword) {
                    const passwordFailure = orderPasswordPolicyFailure();
                    if (passwordFailure) {
                        setHidden('guestCashConfigurePanel', false);
                        syncOrderPasswordChecks();
                        setStateMessage(
                            `请重新输入原查询密码后确认订单结果。${orderPasswordPolicyMessage(passwordFailure)}`,
                            'payment_creation_unknown'
                        );
                        return;
                    }
                    body.orderPassword = foldQueryPassword(orderPasswordInput()?.value || '');
                }
            } else {
                const previewResult = await loadPreview(context);
                if (!isCurrentAction(operation)
                    || quoteGeneration !== state.quoteGeneration
                    || getPurchaseContext()?.contextKey !== contextKey) return;
                if (!previewResult.available) {
                    setStateMessage('当前商品暂时无法创建游客订单', 'error');
                    return;
                }
                payment = selectedPayment();
                if (!payment.provider || !payment.channel) {
                    setStateMessage('请选择有效的支付方式', 'error');
                    return;
                }
                const email = normalizeText(element('guestCashContact')?.value, 160);
                if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
                    setStateMessage('邮箱格式不正确', 'error');
                    return;
                }
                let orderPassword = '';
                if (state.buyerCredentialRequired) {
                    if (!email) {
                        setStateMessage('请填写邮箱，用于查询订单', 'error');
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
                const discountCode = state.discountEnabled ? discountCodeValue() : '';
                if (discountCode && !isDiscountCodeFormat(discountCode)) {
                    setDiscountInvalid(true);
                    syncDiscountHint();
                    setStateMessage('优惠码格式不正确，请修改后再创建订单', 'error');
                    discountCodeInput()?.focus();
                    return;
                }
                const prepareBody = {
                    checkoutAction: 'prepare',
                    site: context.site,
                    productId: context.productId,
                    skuId: context.skuId,
                    quantity: normalizeQuantity(state.quantity),
                    provider: payment.provider,
                    channel: payment.channel
                };
                if (email) prepareBody.email = email;
                if (discountCode) prepareBody.discountCode = discountCode;
                const prepared = await requestJson(ORDER_ENDPOINT, {
                    method: 'POST',
                    body: JSON.stringify(prepareBody)
                });
                if (!isCurrentAction(operation)) return;
                attempt = rememberCheckoutIntent(prepared?.intent, context);
                if (!attempt) throw new Error('支付订单准备失败，请稍后重试');
                body = { checkoutAction: 'commit', intentId: attempt.intentId };
                if (email) body.email = email;
                if (orderPassword) body.orderPassword = orderPassword;
            }
            setStateMessage(
                retryingUnknown ? '正在确认原支付订单...' : '正在创建支付订单...',
                'creating'
            );
            commitRequestStarted = true;
            const payload = await requestJson(ORDER_ENDPOINT, {
                method: 'POST',
                body: JSON.stringify(body)
            });
            const order = payload?.order || {};
            const orderNo = normalizeText(order.order_no, 200);
            if (!orderNo) throw new Error('订单凭证缺失，请联系客服');
            const safeCheckoutRecord = {
                orderNo,
                site: context.site,
                productId: context.productId,
                skuId: context.skuId,
                productName: normalizeText(order.product_name || context.productName, 240),
                skuName: normalizeText(order.sku_name || context.skuName, 240),
                expiresAt: order.expires_at,
                provider: payment.provider,
                channel: payment.channel,
                intentId: attempt?.intentId
            };
            if (!isCurrentAction(operation)) {
                // The buyer left after the POST was sent. Preserve only the safe
                // resumable handle; never let the late response repaint another
                // product view or start polling behind a hidden modal.
                persistCheckoutRecord(safeCheckoutRecord);
                state.detachedCheckout = safeCheckoutRecord;
                clearPendingCreateAttempt(attempt);
                return;
            }
            const checkoutPersisted = persistCheckoutRecord({
                orderNo,
                site: context.site,
                productId: context.productId,
                skuId: context.skuId,
                expiresAt: order.expires_at,
                provider: payment.provider,
                channel: payment.channel,
                intentId: attempt?.intentId
            });
            clearPendingCreateAttempt(attempt);
            if (checkoutPersisted) acknowledgeCheckoutIntent(attempt?.intentId);
            state.orderNo = orderNo;
            state.checkoutIntentId = checkoutIntentId(attempt?.intentId);
            state.site = context.site;
            state.productId = context.productId;
            state.skuId = context.skuId;
            state.expiresAt = normalizeText(order.expires_at, 80);
            state.provider = payment.provider;
            state.channel = payment.channel;
            const replayStatus = normalizeText(payload?.payment_status || order.payment_status, 80).toLowerCase();
            state.paymentConfirmed = replayStatus === 'confirmed';
            const replayNeedsReview = ['review', 'payment_creation_unknown'].includes(replayStatus);
            const replayTerminal = TERMINAL_PAYMENT_STATUSES.has(replayStatus);
            state.paymentCreationUnknown = replayNeedsReview;
            state.status = replayNeedsReview
                ? 'payment_creation_unknown'
                : (replayTerminal
                    ? replayStatus
                    : (state.paymentConfirmed ? 'confirmed' : 'awaiting_payment'));
            // The order is bound to the buyer group server-side from here on, so
            // the plaintext has no further use in this page and is dropped.
            clearOrderPassword();
            resetOrderUi();
            showOrderNo(orderNo);
            applyServerPricing(order);
            const checkoutReady = !replayNeedsReview && payload.checkout
                ? renderCheckout(payload.checkout)
                : false;
            if (replayNeedsReview) {
                suppressUnsafeCheckout();
                setHidden('guestCashConfigurePanel', true);
                setStateMessage('原订单已定位，但支付创建结果仍待对账。请勿重复付款，可稍后查询状态。', 'payment_creation_unknown');
                stopPolling();
                return;
            }
            if (replayTerminal) {
                suppressUnsafeCheckout();
                setHidden('guestCashConfigurePanel', true);
                setStateMessage(orderStatusMessage(replayStatus), replayStatus);
                // A create response can arrive while the first best-effort ack
                // is still in flight (or after it failed). The terminal
                // snapshot is sufficient proof that the order exists, so retry
                // the same intent selector without preparing or committing a
                // second order.
                retryCheckoutIntentAcknowledgement();
                stopPolling();
                return;
            }
            if (!checkoutReady && !state.paymentConfirmed) {
                state.paymentCreationUnknown = true;
                setHidden('guestCashConfigurePanel', true);
                setStateMessage('订单已建立，但支付凭证结果未知。请先查询状态或找回订单，不要重复付款。', 'payment_creation_unknown');
                stopPolling();
                return;
            }
            setStateMessage(
                state.paymentConfirmed
                    ? '支付已确认，正在等待发货。'
                    : '订单已创建，请完成支付；回跳页面不会直接视为支付成功。',
                state.paymentConfirmed ? 'confirmed' : 'awaiting_payment'
            );
            if (isModalVisible()) startPolling();
        } catch (error) {
            const unknownResult = createResultIsUnknown(error, {
                requestStarted: commitRequestStarted,
                retryingUnknown
            });
            if (unknownResult && attempt) {
                attempt.unresolved = true;
                state.pendingCreateAttempt = attempt;
            }
            if (!isCurrentAction(operation)) {
                if (unknownResult) {
                    // Closing the modal invalidates the view, but it does not make
                    // an indeterminate POST safe to forget. Advance only the
                    // in-memory state so the next explicit open exposes the
                    // same-key confirmation action instead of a stuck busy label.
                    state.paymentCreationUnknown = true;
                    state.status = 'payment_creation_unknown';
                } else {
                    clearPendingCreateAttempt(attempt);
                }
                return;
            }
            state.paymentCreationUnknown = unknownResult;
            state.status = unknownResult ? 'payment_creation_unknown' : 'error';
            if (!unknownResult) {
                clearPendingCreateAttempt(attempt);
            }
            if (error?.code === 'guest_password_weak') void refreshRejectedOrderPassword();
            // Runs before the message so a rejected discount retracts its UI in the
            // same frame the buyer reads the error, and a stale quote is dropped
            // instead of being retried into the same wall.
            if (!(retryingUnknown && error?.code === 'guest_idempotency_conflict')) {
                handleCreateOrderError(error);
            }
            setStateMessage(
                unknownResult
                    ? (state.orderNo
                        ? '支付创建结果暂时无法确认。请先查询或找回订单，不要重复付款。'
                        : '支付创建结果暂时无法确认。请点击“确认原订单结果”，系统只会重放同一笔请求；不要重新付款。')
                    : (error?.message || '支付订单创建失败，请检查输入后重试'),
                state.status
            );
        } finally {
            state.requestInFlight = false;
            renderGuestActions();
        }
    }

    async function fetchStatus({ forceRefresh = false, orderNo = state.orderNo } = {}) {
        const expectedOrderNo = normalizeText(orderNo, 200);
        if (!expectedOrderNo) return null;
        const query = new URLSearchParams({ orderNo: expectedOrderNo });
        // The status endpoint also runs a throttled active provider query so a
        // dropped webhook can still settle the order. An explicit user action
        // forces that provider refresh instead of waiting for the poll window.
        if (forceRefresh) query.set('force_provider_refresh', '1');
        return requestJson(`${STATUS_ENDPOINT}?${query.toString()}`, {
            method: 'GET',
            credentials: 'same-origin'
        });
    }

    async function fetchStatusForRestore(orderNo = state.orderNo) {
        const expectedOrderNo = normalizeText(orderNo, 200);
        if (!expectedOrderNo || state.statusRequestInFlight) return null;
        const requestContext = {
            orderNo: expectedOrderNo,
            generation: state.pollGeneration
        };
        state.statusRequestInFlight = true;
        state.statusRequestContext = requestContext;
        renderGuestActions();
        let handoff = null;
        try {
            return await fetchStatus({ orderNo: expectedOrderNo });
        } finally {
            if (state.statusRequestContext === requestContext) {
                state.statusRequestInFlight = false;
                state.statusRequestContext = null;
                const queued = state.queuedStatusRequest;
                state.queuedStatusRequest = null;
                if (queued
                    && queued.orderNo === state.orderNo
                    && queued.generation === state.pollGeneration) {
                    handoff = queued;
                }
            }
            renderGuestActions();
            if (handoff) {
                void pollStatus({
                    immediate: true,
                    forceProviderRefresh: handoff.forceProviderRefresh
                });
            }
        }
    }

    async function claimDelivery(
        expectedGeneration = state.pollGeneration,
        expectedOrderNo = state.orderNo
    ) {
        const orderNo = normalizeText(expectedOrderNo, 200);
        if (state.claimInFlight || !orderNo) return;
        state.claimInFlight = true;
        renderGuestActions();
        try {
            const payload = await requestJson(CLAIM_ENDPOINT, {
                method: 'POST',
                credentials: 'same-origin',
                body: JSON.stringify({ orderNo })
            });
            if (expectedGeneration !== state.pollGeneration || state.orderNo !== orderNo) return;
            state.paymentConfirmed = true;
            state.status = 'delivered';
            state.deliveryCopied = false;
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
            clearStoredCheckoutAfterAcknowledgement();
        } catch (error) {
            if (expectedGeneration !== state.pollGeneration || state.orderNo !== orderNo) return;
            if (error?.code === 'guest_order_not_delivered') {
                setStateMessage('支付已确认，正在等待发货...', 'checking');
            } else {
                setStateMessage(error?.message || '取货失败，请保留订单号联系客服', 'manual_review');
                stopPolling();
            }
        } finally {
            state.claimInFlight = false;
            renderGuestActions();
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
        // GET /status is not a passive read: it may query the provider, record an
        // event, confirm payment and kick fulfilment. Never let rapid clicks or
        // an automatic tick issue a second request while one is in flight.
        if (state.statusRequestInFlight) {
            const active = state.statusRequestContext;
            if (!active
                || active.orderNo !== state.orderNo
                || active.generation !== state.pollGeneration) {
                state.queuedStatusRequest = {
                    orderNo: state.orderNo,
                    generation: state.pollGeneration,
                    forceProviderRefresh: forceProviderRefresh === true
                };
            }
            renderGuestActions();
            return;
        }
        if (resetWindow) stopPolling();
        if (state.pollTimer) return;
        const generation = state.pollGeneration;
        const expectedOrderNo = state.orderNo;
        if (state.pollActiveGeneration === generation) return;
        state.pollStartedAt = state.pollStartedAt || Date.now();
        // A manual status check should force only its first request. Once the
        // server has performed that live provider query, ordinary polling is
        // enough and avoids repeatedly bypassing the background throttle.
        let forceProviderRefreshNext = forceProviderRefresh === true;
        const run = async () => {
            if (generation !== state.pollGeneration || state.orderNo !== expectedOrderNo) return;
            state.pollTimer = null;
            if (state.statusRequestInFlight) {
                const active = state.statusRequestContext;
                if (!active
                    || active.orderNo !== expectedOrderNo
                    || active.generation !== generation) {
                    state.queuedStatusRequest = {
                        orderNo: expectedOrderNo,
                        generation,
                        forceProviderRefresh: forceProviderRefreshNext
                    };
                }
                return;
            }
            if (Date.now() - state.pollStartedAt > POLL_MAX_MS) {
                setStateMessage('自动核验已暂停，请点击“查询支付状态”继续。', 'manual_review');
                state.pollStartedAt = 0;
                state.pollActiveGeneration = null;
                renderGuestActions();
                return;
            }
            const requestContext = { orderNo: expectedOrderNo, generation };
            state.pollActiveGeneration = generation;
            state.statusRequestInFlight = true;
            state.statusRequestContext = requestContext;
            renderGuestActions();
            let shouldContinue = true;
            let nextPollIntervalMs = POLL_INTERVAL_MS;
            let handoff = null;
            try {
                const payload = await fetchStatus({
                    forceRefresh: forceProviderRefreshNext,
                    orderNo: expectedOrderNo
                });
                forceProviderRefreshNext = false;
                if (generation !== state.pollGeneration || state.orderNo !== expectedOrderNo) return;
                const order = payload?.order || {};
                const responseOrderNo = normalizeText(order.order_no, 200);
                if (responseOrderNo && responseOrderNo !== expectedOrderNo) return;
                state.site = normalizeSite(order.site || state.site);
                state.productId = normalizeText(order.product_id || state.productId, 100);
                state.skuId = normalizeText(order.sku_id || state.skuId, 100);
                state.contextKey = state.productId && state.skuId
                    ? [state.site, state.productId, state.skuId].join(':')
                    : state.contextKey;
                state.expiresAt = normalizeText(order.expires_at || state.expiresAt, 80);
                state.provider = normalizeText(order.provider || state.provider, 80).toLowerCase();
                state.channel = normalizeText(order.channel || state.channel, 80).toLowerCase();
                if (order.product_name) setText('guestCashProductName', order.product_name);
                if (order.sku_name) setText('guestCashSkuName', order.sku_name);
                applyServerPricing(order);
                const paymentStatus = normalizeText(order.payment_status, 80).toLowerCase();
                const fulfillmentStatus = normalizeText(order.fulfillment_status, 80).toLowerCase();
                state.fulfillmentStatus = fulfillmentStatus;
                state.refundStatus = normalizeText(order.refund_status, 80).toLowerCase();
                const displayStatus = deriveOrderDisplayStatus(
                    paymentStatus,
                    fulfillmentStatus,
                    state.refundStatus
                );
                if (payload?.checkout
                    && !state.checkout
                    && displayStatus !== 'payment_creation_unknown'
                    && !TERMINAL_PAYMENT_STATUSES.has(displayStatus)) {
                    renderCheckout(payload.checkout);
                }
                persistCheckout();
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
                    state.paymentCreationUnknown = false;
                    syncAbandonOrderButton();
                }
                if (paymentStatus === 'confirmed' && fulfillmentStatus === 'delivered') {
                    if (state.checkout?.provider === 'zpay') presentZpaySuccess();
                    // Keep this before claimDelivery() clears the resumable
                    // browser handle. A failed initial ack must get one more
                    // chance while the matching safe handle is still present.
                    retryCheckoutIntentAcknowledgement();
                    // Do not let a stale poll generation claim after the user
                    // switched products or reset the active order.
                    if (generation === state.pollGeneration) {
                        await claimDelivery(generation, expectedOrderNo);
                        // A just-confirmed order may race the fulfilment worker.
                        // claimDelivery() leaves the state as `checking` for that
                        // transient case, so keep polling until delivery succeeds.
                        shouldContinue = state.status === 'checking';
                    } else {
                        shouldContinue = false;
                    }
                } else if (TERMINAL_PAYMENT_STATUSES.has(displayStatus)) {
                    if (state.checkout?.provider === 'zpay' && ['failed', 'expired'].includes(displayStatus)) {
                        presentZpayTimeout();
                    } else {
                        stopZpayCountdown();
                        setHidden('guestCashCheckoutPanel', true);
                    }
                    state.paymentCreationUnknown = false;
                    setStateMessage(orderStatusMessage(displayStatus), displayStatus);
                    retryCheckoutIntentAcknowledgement();
                    shouldContinue = false;
                } else if (paymentStatus === 'confirmed' && fulfillmentStatus === 'paid_unfulfillable') {
                    // A confirmed payment must never leave an old QR or checkout
                    // handle available once fulfillment has moved to human follow-up.
                    suppressUnsafeCheckout();
                    retryCheckoutIntentAcknowledgement();
                    clearStoredCheckoutAfterAcknowledgement();
                    setStateMessage('支付已确认，但当前库存不足，正在处理退款或人工补发。请保留订单号。', 'paid_unfulfillable');
                    // This is a durable stock decision recorded by the claim
                    // RPC. Do not keep hammering status while the refund or
                    // manual fulfilment queue is handled by operations.
                    shouldContinue = false;
                } else if (paymentStatus === 'confirmed' && fulfillmentStatus === 'dead_letter') {
                    // The payment is final but automatic fulfillment failed, so
                    // stale payment credentials must not survive this transition.
                    suppressUnsafeCheckout();
                    retryCheckoutIntentAcknowledgement();
                    clearStoredCheckoutAfterAcknowledgement();
                    setStateMessage('支付已确认，但自动发货失败，订单已转人工处理。请保留订单号。', 'dead_letter');
                    shouldContinue = false;
                } else if (['review', 'payment_creation_unknown'].includes(paymentStatus)) {
                    state.paymentCreationUnknown = true;
                    suppressUnsafeCheckout();
                    setStateMessage('支付创建或回调结果待对账。请勿重复付款，可稍后手动刷新状态。', 'payment_creation_unknown');
                    shouldContinue = false;
                } else if (state.paymentCreationUnknown) {
                    setStateMessage('订单支付凭证仍不可用。请勿重复付款，可稍后手动刷新状态。', 'payment_creation_unknown');
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
                        paymentStatus === 'confirmed' ? 'confirmed' : 'awaiting_payment'
                    );
                }
            } catch (error) {
                if (generation !== state.pollGeneration || state.orderNo !== expectedOrderNo) return;
                if (error?.status === 403 || error?.code === 'guest_claim_invalid') {
                    setStateMessage('当前设备的取货凭证不可用，请勿重复付款，请联系客服恢复订单。', 'manual_review');
                    shouldContinue = false;
                } else {
                    setStateMessage('暂时无法查询支付状态，将自动重试。', 'checking');
                }
            } finally {
                if (state.statusRequestContext === requestContext) {
                    state.statusRequestInFlight = false;
                    state.statusRequestContext = null;
                    const queued = state.queuedStatusRequest;
                    state.queuedStatusRequest = null;
                    if (queued
                        && queued.orderNo === state.orderNo
                        && queued.generation === state.pollGeneration) {
                        handoff = queued;
                    }
                }
                if (state.pollActiveGeneration === generation) state.pollActiveGeneration = null;
                renderGuestActions();
                if (handoff) {
                    shouldContinue = false;
                    void pollStatus({
                        immediate: true,
                        forceProviderRefresh: handoff.forceProviderRefresh
                    });
                }
            }
            if (shouldContinue && generation === state.pollGeneration && state.orderNo === expectedOrderNo) {
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
        state.queuedStatusRequest = null;
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
    const TRANSIENT_AVAILABILITY_REASONS = new Set(['pending', 'rate_limited', 'preview_error', 'stale']);

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
    async function startGuestCheckout(
        context = getPurchaseContext(),
        { deferScrollLock = false, shouldOpen = null } = {}
    ) {
        const availability = await probeAvailability(context);
        if (!availability || !availability.available) {
            return { started: false, reason: (availability && availability.reason) || 'unavailable' };
        }
        if (typeof shouldOpen === 'function') {
            let sourceStillValid = false;
            try { sourceStillValid = shouldOpen() === true; } catch (_) { sourceStillValid = false; }
            if (!sourceStillValid) return { started: false, reason: 'source_stale' };
        }
        openGuestModal(context, { deferScrollLock });
        return { started: true, reason: 'available' };
    }

    window.GuestShopCheckout = {
        peekAvailability,
        probeAvailability,
        startGuestCheckout,
        setModalReturnFocusTarget,
        focusGuestModal
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
            void copyText(
                element('guestCashDeliveredContent')?.textContent || '',
                deliveryButton,
                { copiedClass: 'is-copied' }
            ).then(() => { state.deliveryCopied = true; });
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
            const snapshot = await fetchStatusForRestore(restoredOrderNo);
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
            // retain the existing modal-and-poll status path below. A buyer
            // who needs cross-device access uses the standalone credential
            // lookup page, not a second recovery form inside this modal.
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
        document.addEventListener('keydown', handleGuestModalKeydown);
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
