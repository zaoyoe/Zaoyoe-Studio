(function initTelegramRedeemPage(globalScope) {
    'use strict';
    const document = globalScope.document;
    const $ = (id) => document.getElementById(id);
    const text = (value) => String(value ?? '').trim();
    const STORAGE_KEY = 'tg.premium.attempts.v1';
    const QUERY_CLEARED_KEY = 'tg.orders.query-cleared.v1';
    let queryCleared = false;
    try { queryCleared = globalScope.sessionStorage.getItem(QUERY_CLEARED_KEY) === '1'; } catch (_) {}
    function rememberQueryCleared(value) {
        queryCleared = value;
        try { globalScope.sessionStorage.setItem(QUERY_CLEARED_KEY, value ? '1' : '0'); } catch (_) {}
    }
    const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
    const ORDER_PATTERN = /^TG-[A-Z0-9]{12,24}$/;
    const labels = { pending: '等待处理', processing: '正在开通', retry_waiting: '等待官方确认', succeeded: '开通完成', failed: '处理失败，请联系客服', manual_review: '正在人工复核，请勿重复兑换', cancelled: '订单已取消', closed: '订单已完结' };
    const activeStatuses = new Set(['pending', 'processing', 'retry_waiting']);
    let redemptionEnabled = false;
    let submitting = false;
    let redeemPreview = null;
    let redeemInputVersion = 0;
    let tracking = null;
    let orderQuery = null;
    let orderDetailView = null;
    let orderDetailReturnFocus = null;
    let paymentReturnToOrders = false;
    const purchaseSnapshots = new Map();
    const queryAccessHeaders = (statusToken, queryCredential) => queryCredential
        ? { 'X-TG-Order-Credential': queryCredential } : { 'X-TG-Status-Token': statusToken };
    let pollTimer = null;
    let pollCount = 0;
    let queryVersion = 0;
    let records = [];
    const PURCHASE_STORAGE_KEY = 'tg.purchase.attempts.v1';
    const PURCHASE_ORDER_PATTERN = /^TGP-[A-Z0-9]{20}$/;
    const paymentLabels = { pending: '等待付款', paid: '已付款', expired: '支付已过期', cancelled: '支付已取消', failed: '支付未完成', manual_review: '支付待人工核对' };
    const fulfillmentLabels = { not_started: '等待付款后处理', pending: '等待发货', processing: '正在处理', retry_waiting: '等待官方确认', succeeded: '发货完成', failed: '处理失败，请联系客服', manual_review: '正在人工复核', cancelled: '已取消', closed: '订单已完结' };
    let purchaseEnabled = false;
    let catalogState = 'loading';
    let catalogRequestFailed = false;
    let saleProducts = [];
    let paymentChannels = [];
    let renderedChannelCards = [];
    let renderedNetworkChoices = [];
    let renderedPaymentChannel = null;
    let purchasePriceMotion = null;
    let payCurrency = 'usdtbsc';
    const networkNames = { usdtbsc: 'BSC (BEP20)', usdtton: 'TON', usdtmatic: 'Polygon', usdttrc20: 'TRON (TRC20)' };
    const networkIcons = { usdtbsc: '/assets/tg-network-icons/bsc.svg', usdtton: '/assets/tg-network-icons/ton.svg', usdtmatic: '/assets/tg-network-icons/polygon.svg', usdttrc20: '/assets/tg-network-icons/tron.svg' };
    let usdtPerCny = null;
    let usdtFx = null;
    let marketFxEnabled = false;
    let fxCatalogTimer = null;
    let selectedFamily = 'telegram_premium';
    let serviceMode = 'purchase';
    let purchaseBusy = false;
    let purchaseQuote = null;
    let purchaseFreshQuote = null;
    let purchaseConfirmation = { mode: 'new', orderNo: '' };
    let purchaseRecords = [];
    let purchaseTracking = null;
    let purchaseTimer = null;
    let purchasePollCount = 0;
    let purchaseQueryVersion = 0;
    let quoteVersion = 0;
    const pricing = globalScope.TgPaymentPricing;
    let latestPurchaseOrder = null;
    let latestPurchasePaymentSync = null;
    const receivedPurchasePayments = new Map();
    let paymentExpiryTimer = null;
    let paymentDialogView = null;
    let purchaseQueryBusy = false;
    let purchaseCancelBusy = false;
    const CANCEL_INTENTS_KEY = 'tg.purchase.cancel-intents.v1';
    const purchaseCancelIntents = new Set();
    let returnAfterCancellation = true;
    try {
        const saved = JSON.parse(globalScope.sessionStorage.getItem(CANCEL_INTENTS_KEY) || '[]');
        if (Array.isArray(saved)) saved.filter(value => typeof value === 'string' && PURCHASE_ORDER_PATTERN.test(value)).slice(-60).forEach(value => purchaseCancelIntents.add(value));
    } catch (_) {}
    let paymentClockOffset = 0;
    const paymentNow = () => Date.now() + paymentClockOffset;
    function syncPaymentClock(data) {
        const serverTime = Date.parse(data.server_time);
        if (Number.isFinite(serverTime)) paymentClockOffset = serverTime - Date.now();
    }
    const channelLabels = { alipay: '支付宝', wxpay: '微信支付', usdt_bep20: 'USDT' };
    const STARS_PRESETS = [100, 500, 1000, 5000, 10000, 50000];
    const recipientStates = new Map();
    const recipientBoxIds = { tgPurchaseUsername: 'tgPurchaseUsernameBox', tgUsername: 'tgRedeemUsernameBox' };
    const recipientHintIds = { tgPurchaseUsername: 'tgPurchaseUsernameHint', tgUsername: 'tgRedeemUsernameHint' };
    const giftPreview = { version: 0, timer: null, controller: null };
    function renderGiftPreview(state, title = '', subtitle = '') {
        const panel = $('tgCodePreview'); const content = $('tgCodePreviewContent');
        if (!panel || !content) return;
        panel.dataset.state = state;
        panel.setAttribute('aria-busy', String(state === 'loading'));
        const icon = document.createElement('span'); icon.className = 'tg-gift-preview-icon'; icon.textContent = state === 'ready' ? '✦' : state === 'loading' ? '…' : '!';
        icon.setAttribute('aria-hidden', 'true');
        const detail = document.createElement('span'); detail.className = 'tg-gift-preview-detail';
        const name = document.createElement('strong'); name.textContent = title;
        const hint = document.createElement('small'); hint.textContent = subtitle;
        detail.replaceChildren(name, hint); content.replaceChildren(icon, detail);
    }
    function queueGiftPreview(immediate = false) {
        const version = ++giftPreview.version;
        if (giftPreview.timer !== null) globalScope.clearTimeout(giftPreview.timer);
        giftPreview.timer = null; giftPreview.controller?.abort(); giftPreview.controller = null;
        const code = text($('tgCode').value).toUpperCase().replace(/\s+/g, '');
        if (!code) return renderGiftPreview('empty');
        if (!/^TG-(?:PREM|STAR)-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/.test(code)) {
            return renderGiftPreview('hint', '输入完整兑换码后显示礼品', '请使用兑换码，批次编号不能用于兑换。');
        }
        renderGiftPreview('loading', '正在核验兑换礼品…', '仅查询权益，不占用兑换码。');
        const lookup = async () => {
            giftPreview.timer = null;
            const controller = new globalScope.AbortController(); giftPreview.controller = controller;
            const timeout = globalScope.setTimeout(() => controller.abort(), 10000);
            try {
                const response = await globalScope.fetch('/api/tg/code/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code }), cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
                const data = await response.json();
                if (giftPreview.version !== version) return;
                if (!response.ok || data.success !== true) return renderGiftPreview('error', text(data.message) || '兑换码暂不可用', '请检查兑换码，或稍后重新输入。');
                const product = data.product;
                if (product?.product_family === 'telegram_premium' && [3, 6, 12].includes(product.term_months) && product.stars_quantity == null) {
                    renderGiftPreview('ready', `Telegram Premium · ${product.term_months} 个月`, '兑换后将为上方收件人开通会员，请核对接收账号。');
                } else if (product?.product_family === 'telegram_stars' && product.term_months == null && Number.isSafeInteger(product.stars_quantity) && product.stars_quantity >= 50 && product.stars_quantity <= 1000000) {
                    renderGiftPreview('ready', `Telegram Stars · ${product.stars_quantity.toLocaleString()} 颗`, '兑换后将充值到上方收件人，请核对接收账号。');
                } else throw new Error('Invalid gift preview');
            } catch (_) {
                if (giftPreview.version === version) renderGiftPreview('error', '兑换礼品暂时无法核验', '请稍后重新输入兑换码，系统没有占用此码。');
            } finally {
                globalScope.clearTimeout(timeout);
                if (giftPreview.version === version) giftPreview.controller = null;
            }
        };
        if (immediate) return lookup();
        giftPreview.timer = globalScope.setTimeout(lookup, 300);
    }

    const money = (minor) => `¥${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
    function selectedSaleProduct() { return saleProducts.find((product) => product.id === (selectedFamily === 'telegram_stars' ? 'stars' : $('tgPurchaseProduct').value)); }
    function purchaseQuantity() { return selectedFamily === 'telegram_stars' ? Number($('tgPurchaseStars').value) : null; }
    function pricedSaleProduct(product) {
        return product && Number.isSafeInteger(product.price_version) && product.price_version >= 1 && (
            product.id === 'stars' && product.product_family === 'telegram_stars' && Number.isSafeInteger(product.unit_price_micros) && product.unit_price_micros > 0 && product.unit_price_micros <= 1000000000
            || ['premium_3', 'premium_6', 'premium_12'].includes(product.id) && product.product_family === 'telegram_premium'
                && product.id === `premium_${Number(product.term_months)}` && Number.isSafeInteger(product.price_minor) && product.price_minor > 0 && product.price_minor <= 100000000);
    }
    function validSaleProduct(product) { return pricedSaleProduct(product) && product.enabled === true; }
    function starsBounds(product) { return { min: Number.isSafeInteger(product?.min_stars) ? Math.max(50, product.min_stars) : 50, max: Number.isSafeInteger(product?.max_stars) ? Math.min(1000000, product.max_stars) : 1000000 }; }
    function displayedTotal(product, quantity = purchaseQuantity()) {
        if (!pricedSaleProduct(product)) return null;
        if (product.id !== 'stars') return product.price_minor;
        const { min, max } = starsBounds(product);
        if (!Number.isSafeInteger(quantity) || quantity < min || quantity > max) return null;
        const total = (BigInt(product.unit_price_micros) * BigInt(quantity) + 9999n) / 10000n;
        return total > 0n && total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
    }

    function syncStarsPresets() {
        const current = Number($('tgPurchaseStars').value);
        for (const preset of STARS_PRESETS) {
            const btn = $(`tgStarsPreset-${preset}`);
            if (btn) btn.setAttribute('aria-pressed', String(current === preset));
        }
    }

    function purchaseSkeleton(className) {
        const span = document.createElement('span');
        span.className = `tg-skeleton ${className}`;
        span.setAttribute('aria-hidden', 'true');
        return span;
    }

    function purchasePriceBreakdown(product, subtotal, fees) {
        const list = document.createElement('dl');
        list.className = 'tg-price-breakdown';
        const spec = product ? product.product_family === 'telegram_stars'
            ? `${purchaseQuantity().toLocaleString('zh-CN')} 颗 Stars` : `Premium ${product.term_months}个月` : '';
        const rows = [['商品规格', spec], ['商品金额', Number.isSafeInteger(subtotal) ? money(subtotal) : '—'], ['通道手续费', fees ? money(fees.payment_fee_minor) : '—']];
        for (const [index, [label, value]] of rows.entries()) {
            const item = document.createElement('div');
            const name = document.createElement('dt'); name.textContent = label;
            const detail = document.createElement('dd');
            if (catalogState === 'loading') detail.append(purchaseSkeleton('tg-skeleton-price-detail'));
            else {
                const amount = document.createElement('span'); amount.textContent = value; detail.append(amount);
                if (index === 2 && fees) {
                    const rate = document.createElement('small'); rate.className = 'tg-price-fee-rate';
                    rate.textContent = `${fees.payment_fee_rate_bps / 100}%`; detail.append(rate);
                }
            }
            item.replaceChildren(name, detail); list.append(item);
        }
        return list;
    }

    function renderPlanCards() {
        const container = $('tgPurchaseProductCards');
        if (!container) return;
        const currentVal = $('tgPurchaseProduct').value || 'premium_12';
        const cards = [
            { months: 12, value: 'premium_12', badge: '推荐', sub: '年度超值' },
            { months: 6, value: 'premium_6', badge: '省 15%', sub: '半年进阶' },
            { months: 3, value: 'premium_3', badge: '', sub: '季度体验' }
        ].map(({ months, value, badge, sub }) => {
            const product = saleProducts.find((item) => item.id === value);
            const isSelected = currentVal === value;
            const priced = pricedSaleProduct(product);
            const card = document.createElement('button');
            card.type = 'button';
            card.className = `tg-option-card tg-plan-card${isSelected ? ' is-selected' : ''}${product && !product.enabled ? ' is-disabled' : ''}`;
            card.setAttribute('aria-pressed', String(isSelected));
            card.disabled = catalogState !== 'ready';

            const topRow = document.createElement('span');
            topRow.className = 'tg-option-card-head';
            const title = document.createElement('strong');
            title.className = 'tg-option-card-title';
            title.textContent = `${months} 个月`;
            topRow.replaceChildren(title);

            const priceEl = document.createElement('span');
            priceEl.className = 'tg-option-card-price';
            if (catalogState === 'loading') priceEl.append(purchaseSkeleton('tg-skeleton-plan-price'));
            else priceEl.textContent = catalogState === 'error' ? '—' : priced ? money(product.price_minor) : '待公布';

            const metaEl = document.createElement('small');
            metaEl.className = 'tg-option-card-meta';
            metaEl.textContent = product && !product.enabled && priced ? '暂未开售' : sub;

            const children = [topRow, priceEl, metaEl];
            if (badge) {
                const badgeEl = document.createElement('span');
                badgeEl.className = `tg-plan-badge${months === 12 ? ' is-crown' : ''}`;
                badgeEl.textContent = months === 12 ? `👑 ${badge}` : badge;
                children.unshift(badgeEl);
            }
            card.replaceChildren(...children);
            card.addEventListener('click', () => {
                if ($('tgPurchaseProduct').value !== value) {
                    $('tgPurchaseProduct').value = value;
                    resetPurchaseQuote();
                    updatePurchaseProduct();
                }
            });
            return card;
        });
        container.replaceChildren(...cards);
    }

    function renderChannelCards() {
        const container = $('tgPurchaseChannelCards');
        if (!container) return;
        const currentChannel = $('tgPurchaseChannel').value;
        if (catalogState === 'loading') {
            const cards = Array.from({ length: 2 }, () => {
                const card = document.createElement('div');
                card.className = 'tg-option-card tg-channel-card tg-channel-skeleton';
                card.setAttribute('aria-hidden', 'true');
                card.replaceChildren(purchaseSkeleton('tg-skeleton-channel-icon'), purchaseSkeleton('tg-skeleton-channel-title'));
                return card;
            });
            renderedChannelCards = [];
            container.replaceChildren(...cards);
            return;
        }
        if (!paymentChannels.length) {
            const empty = document.createElement('div');
            empty.className = 'tg-option-empty';
            empty.textContent = catalogState === 'error' ? '支付方式加载失败' : '支付方式暂未开放';
            renderedChannelCards = [];
            container.replaceChildren(empty);
            return;
        }
        // Keep the controls mounted so selection transitions and keyboard focus survive updates.
        if (renderedChannelCards.length !== paymentChannels.length
            || paymentChannels.some((channel, index) => renderedChannelCards[index].id !== channel.id)) {
            renderedChannelCards = paymentChannels.map((channel) => {
                const id = channel.id;
                const card = document.createElement('button');
                card.type = 'button';

                const iconBadge = document.createElement('span');
                iconBadge.className = `tg-channel-icon is-${id}`;
                iconBadge.textContent = id === 'alipay' ? '支' : id === 'wxpay' ? '微' : '₮';

                const info = document.createElement('span');
                info.className = 'tg-channel-info';
                const title = document.createElement('strong');
                title.className = 'tg-option-card-title';
                title.textContent = channelLabels[id] || id;
                info.replaceChildren(title);

                card.replaceChildren(iconBadge, info);
                card.addEventListener('click', () => {
                    if ($('tgPurchaseChannel').value !== id) {
                        $('tgPurchaseChannel').value = id;
                        resetPurchaseQuote();
                        updatePurchaseProduct();
                    }
                });
                return { id, card };
            });
            container.replaceChildren(...renderedChannelCards.map(({ card }) => card));
        }
        for (const { id, card } of renderedChannelCards) {
            const isSelected = currentChannel === id;
            card.className = `tg-option-card tg-channel-card tg-channel-${id}${isSelected ? ' is-selected' : ''}`;
            card.setAttribute('aria-pressed', String(isSelected));
        }
    }

    function renderNetworkChoices() {
        const field = $('tgPurchaseNetworkField'); const container = $('tgPurchaseNetworkChoices');
        if (!field || !container) return;
        const visible = catalogState === 'ready' && $('tgPurchaseChannel').value === 'usdt_bep20';
        field.hidden = false;
        field.inert = !visible;
        field.setAttribute('aria-hidden', String(!visible));
        field.classList.toggle('is-expanded', visible);
        const offered = paymentChannels.find((item) => item.id === 'usdt_bep20')?.networks || [{ currency: 'usdtbsc' }];
        const choices = offered.filter((item) => Object.hasOwn(networkNames, item.currency));
        if (!choices.some((item) => item.currency === payCurrency)) payCurrency = choices[0]?.currency || 'usdtbsc';
        if (renderedNetworkChoices.length !== choices.length
            || choices.some((item, index) => renderedNetworkChoices[index].currency !== item.currency)) {
            renderedNetworkChoices = choices.map(({ currency }) => {
                const button = document.createElement('button');
                button.type = 'button'; button.className = 'tg-preset-btn tg-network-btn';
                button.setAttribute('data-pay-currency', currency);
                const icon = document.createElement('img');
                icon.className = 'tg-network-icon'; icon.src = networkIcons[currency]; icon.alt = '';
                icon.width = 22; icon.height = 22; icon.setAttribute('aria-hidden', 'true');
                const label = document.createElement('span');
                label.className = 'tg-network-label'; label.textContent = networkNames[currency];
                button.replaceChildren(icon, label);
                button.addEventListener('click', () => { if (purchaseBusy || payCurrency === currency) return; payCurrency = currency; resetPurchaseQuote(); updatePurchaseProduct(); });
                return { currency, button };
            });
            container.replaceChildren(...renderedNetworkChoices.map(({ button }) => button));
        }
        for (const { currency, button } of renderedNetworkChoices) {
            button.setAttribute('aria-pressed', String(currency === payCurrency));
            button.disabled = purchaseBusy;
        }
    }
    function updatePurchaseProduct() {
        const price = $('tgPurchasePrice');
        const loading = catalogState === 'loading';
        $('tgPurchaseForm').dataset.catalogState = catalogState;
        $('tgPurchaseForm').setAttribute('aria-busy', String(loading));
        const channel = $('tgPurchaseChannel').value;
        const animatePrice = renderedPaymentChannel && renderedPaymentChannel !== channel
            && typeof price.animate === 'function' && !globalScope.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        const previousHeight = animatePrice ? price.getBoundingClientRect().height : 0;
        purchasePriceMotion?.cancel();
        purchasePriceMotion = null;
        renderedPaymentChannel = channel;
        renderNetworkChoices();
        const stars = selectedFamily === 'telegram_stars';
        $('tgPurchasePremiumField').hidden = stars; $('tgPurchaseProduct').disabled = stars;
        $('tgPurchaseStarsField').hidden = !stars; $('tgPurchaseStars').disabled = !stars;
        $('purchase-title').textContent = stars ? '购买 Telegram Stars' : '购买 Telegram Premium';
        renderPlanCards();
        renderChannelCards();
        syncStarsPresets();
        const product = selectedSaleProduct();
        const valid = validSaleProduct(product);
        const total = displayedTotal(product);
        if (loading) price.replaceChildren(purchaseSkeleton('tg-skeleton-price-label'), purchaseSkeleton('tg-skeleton-price-amount'), purchasePriceBreakdown());
        else if (catalogState === 'error') price.textContent = '暂时无法读取售价';
        else if (!pricedSaleProduct(product)) price.textContent = '价格暂未公布';
        else if (total === null) { const { min, max } = starsBounds(product); price.textContent = `请输入 ${min.toLocaleString('zh-CN')} 至 ${max.toLocaleString('zh-CN')} 之间的整数星星数量`; }
        else {
            const fees = pricing.breakdown(total, $('tgPurchaseChannel').value);
            const label = document.createElement('span'); label.className = 'tg-price-label'; label.textContent = '应付金额：';
            const crypto = $('tgPurchaseChannel').value === 'usdt_bep20';
            const usdt = fees && pricing.usdtPayAmount(fees.total_minor, usdtPerCny);
            if (crypto) label.textContent = usdt ? '应付金额（USDT）：' : '应付金额（人民币）：';
            const amount = document.createElement('strong'); amount.className = 'tg-price-amount'; amount.textContent = fees ? (crypto && usdt ? pricing.displayCryptoAmount(usdt) : money(fees.total_minor)) : '金额暂不可用';
            price.replaceChildren(label, amount, purchasePriceBreakdown(product, total, fees));
        }
        if (animatePrice) {
            const timing = { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };
            const nextHeight = price.getBoundingClientRect().height;
            if (previousHeight && nextHeight && Math.abs(nextHeight - previousHeight) > 1) {
                purchasePriceMotion = price.animate([{ height: `${previousHeight}px` }, { height: `${nextHeight}px` }], timing);
            }
            for (const child of price.children) {
                child.animate([{ opacity: 0.6, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], timing);
            }
        }
        const bounds = starsBounds(product); $('tgPurchaseStars').min = String(bounds.min); $('tgPurchaseStars').max = String(bounds.max);
        const rangeHint = $('tgStarsRangeHint');
        if (rangeHint) rangeHint.textContent = `${bounds.min.toLocaleString('zh-CN')} — ${bounds.max.toLocaleString('zh-CN')}`;
        const fees = pricing.breakdown(total, $('tgPurchaseChannel').value);
        const button = $('tgPurchaseButton');
        button.formNoValidate = catalogState === 'error';
        button.disabled = loading || purchaseBusy || (catalogState !== 'error' && (!purchaseEnabled || !valid || !fees || !paymentChannels.length
            || ($('tgPurchaseChannel').value === 'usdt_bep20' && !pricing.usdtPayAmount(fees?.total_minor, usdtPerCny))));
        button.textContent = loading ? '正在加载…' : catalogState === 'error' ? '重新加载' : purchaseBusy ? '正在核对订单…'
            : !purchaseEnabled ? '购买服务暂未开放' : !valid ? '当前商品暂未开售' : '核对订单与金额 →';
    }

    function safeAvatarUrl(value) {
        try {
            const url = new globalScope.URL(value);
            return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
                && /^cdn\d+\.telesco\.pe$/.test(url.hostname)
                && /^\/file\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/.test(url.pathname) ? url.href : '';
        } catch (_) { return ''; }
    }
    function setRecipientInputVisible(inputId, visible) {
        const boxId = recipientBoxIds[inputId];
        if (boxId && $(boxId)) $(boxId).hidden = !visible;
        const hintId = recipientHintIds[inputId];
        if (hintId && $(hintId)) $(hintId).hidden = !visible;
    }
    function clearRecipientSelection(inputId, containerId) {
        let state = recipientStates.get(inputId);
        if (state) {
            state.version += 1;
            if (state.timer !== null) globalScope.clearTimeout(state.timer);
            state.timer = null; state.controller?.abort(); state.controller = null;
        }
        const box = $(recipientBoxIds[inputId]); if (box && box.classList) box.classList.remove('is-loading');
        const input = $(inputId);
        if (input) input.value = '';
        setRecipientInputVisible(inputId, true);
        const container = $(containerId);
        if (container) {
            container.replaceChildren();
            container.hidden = true;
            container.className = 'tg-recipient-preview';
            container.setAttribute('aria-busy', 'false');
        }
        if (inputId === 'tgPurchaseUsername') resetPurchaseQuote();
        input?.focus?.();
    }
    function renderRecipient(container, recipient, inputId, containerId) {
        const avatar = document.createElement('span'); avatar.className = 'tg-recipient-avatar';
        const fallback = document.createElement('span'); fallback.textContent = Array.from(recipient.display_name)[0] || '@';
        avatar.replaceChildren(fallback);
        const imageUrl = safeAvatarUrl(recipient.avatar_url);
        if (imageUrl) {
            const image = document.createElement('img'); image.alt = ''; image.hidden = true; image.referrerPolicy = 'no-referrer'; image.decoding = 'async';
            image.addEventListener('load', () => { image.hidden = false; fallback.hidden = true; });
            image.addEventListener('error', () => { image.hidden = true; fallback.hidden = false; });
            image.src = imageUrl; avatar.replaceChildren(fallback, image);
        }
        const details = document.createElement('span'); details.className = 'tg-recipient-details';
        const name = document.createElement('strong'); name.textContent = recipient.display_name;
        const metaRow = document.createElement('span'); metaRow.className = 'tg-recipient-meta';
        const username = document.createElement('small'); username.className = 'tg-recipient-handle'; username.textContent = `@${recipient.username}`;
        const statusBadge = document.createElement('small'); statusBadge.className = 'tg-recipient-found-badge'; statusBadge.textContent = '✓ 用户已找到';
        metaRow.replaceChildren(username, statusBadge);
        const warning = document.createElement('small'); warning.className = 'tg-warning';
        warning.textContent = ({ channel: '这是频道，请核对接收者的个人用户名。', group: '这是群组，请核对接收者的个人用户名。', bot: '这是机器人，请核对接收者的个人用户名。' })[recipient.recipient_type] || '';
        details.replaceChildren(name, metaRow, ...(warning.textContent ? [warning] : []));

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'tg-recipient-clear';
        clearBtn.setAttribute('aria-label', '更换收件人');
        clearBtn.textContent = '×';
        clearBtn.addEventListener('click', () => clearRecipientSelection(inputId, containerId));

        setRecipientInputVisible(inputId, false);
        container.className = 'tg-recipient-preview is-found';
        container.replaceChildren(avatar, details, clearBtn);
        container.hidden = false;
    }
    function queueRecipientPreview(inputId, containerId, immediate = false) {
        let state = recipientStates.get(inputId);
        if (!state) { state = { version: 0, timer: null, controller: null }; recipientStates.set(inputId, state); }
        state.version += 1;
        if (state.timer !== null) globalScope.clearTimeout(state.timer);
        state.timer = null; state.controller?.abort(); state.controller = null;
        const box = $(recipientBoxIds[inputId]); if (box && box.classList) box.classList.remove('is-loading');
        setRecipientInputVisible(inputId, true);
        const container = $(containerId); const username = text($(inputId).value).replace(/^@/, '').toLowerCase(); const version = state.version;
        container.replaceChildren(); container.hidden = true; container.setAttribute('aria-busy', 'false');
        if (!/^[a-z][a-z0-9_]{4,31}$/.test(username)) return;
        const lookup = async () => {
            state.timer = null; const controller = new globalScope.AbortController(); state.controller = controller;
            const box = $(recipientBoxIds[inputId]); if (box && box.classList) box.classList.add('is-loading');
            container.hidden = true; container.className = 'tg-recipient-preview'; container.textContent = ''; container.setAttribute('aria-busy', 'true');
            const timeout = globalScope.setTimeout(() => controller.abort(), 10000);
            try {
                const response = await globalScope.fetch(`/api/tg/recipient?username=${encodeURIComponent(username)}`, { cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
                const data = await response.json();
                if (state.version !== version) return;
                const recipient = data.recipient;
                if (!response.ok || data.success !== true) {
                    container.hidden = false;
                    container.className = 'tg-recipient-preview is-unavailable';
                    container.textContent = response.status === 404 ? '未找到该公开账号，请检查用户名。' : '暂时无法读取公开资料，请稍后重试。';
                    return;
                }
                if (!recipient || recipient.username !== username || typeof recipient.display_name !== 'string' || !recipient.display_name.trim() || recipient.display_name.length > 256) throw new Error('invalid_recipient_preview');
                renderRecipient(container, recipient, inputId, containerId);
            } catch (_) {
                if (state.version === version) { container.hidden = false; container.className = 'tg-recipient-preview is-unavailable'; container.textContent = '暂时无法读取公开资料，请稍后重试。'; }
            } finally {
                globalScope.clearTimeout(timeout);
                if (state.version === version) {
                    if (box && box.classList) box.classList.remove('is-loading');
                    container.setAttribute('aria-busy', 'false');
                    state.controller = null;
                }
            }
        };
        if (immediate) return lookup();
        state.timer = globalScope.setTimeout(lookup, 450);
    }
    let lookupOpen = false;
    let lookupTab = 'purchase';
    function syncLookupBadge() {
        const badge = $('tgOrderLookupBadge');
        if (!badge) return;
        const hasActivePurchase = Boolean(purchaseTracking && !purchaseTracking.finished);
        const hasActiveRedeem = Boolean(tracking && activeStatuses.has(tracking.status));
        badge.hidden = !(hasActivePurchase || hasActiveRedeem);
    }
    function setLookupTab(tab, animate = true) {
        const changed = tab !== lookupTab;
        lookupTab = tab === 'redeem' ? 'redeem' : 'purchase';
        const buying = lookupTab === 'purchase';
        orderQuery?.setKind(lookupTab);
        $('tgLookupTabPurchase')?.setAttribute('aria-pressed', String(buying));
        $('tgLookupTabRedeem')?.setAttribute('aria-pressed', String(!buying));
        const originalCredential = $('tgOrdersSearchBy')?.value === 'tracking';
        $('tgPurchaseStatusPanel').hidden = !originalCredential || !buying;
        $('tgRedeemStatusPanel').hidden = !originalCredential || buying;
        $('tgOrderLookupPage').dataset.orderKind = lookupTab;
        if (changed) { $('tgLegacyOrdersResults').hidden = true; closeOrderDetails(); }
        if (changed && animate) {
            const slideCls = buying ? 'tg-mode-slide-left' : 'tg-mode-slide-right';
            const activePanel = $(buying ? 'tgPurchaseStatusPanel' : 'tgRedeemStatusPanel');
            const inactivePanel = $(buying ? 'tgRedeemStatusPanel' : 'tgPurchaseStatusPanel');
            inactivePanel?.classList?.remove('tg-mode-slide-left', 'tg-mode-slide-right');
            if (activePanel && activePanel.classList) {
                activePanel.classList.remove('tg-mode-slide-left', 'tg-mode-slide-right');
                void activePanel.offsetWidth;
                activePanel.classList.add(slideCls);
            }
        }
    }
    function syncUrlWithSubpage(open, tab) {
        try {
            if (!globalScope.history?.pushState || !globalScope.location?.href) return;
            const url = new globalScope.URL(globalScope.location.href);
            if (open) {
                url.searchParams.set('view', 'orders');
                if (tab === 'redeem') url.searchParams.set('tab', 'redeem');
                else url.searchParams.delete('tab');
            } else {
                url.searchParams.delete('view');
                url.searchParams.delete('tab');
            }
            const nextHref = `${url.pathname}${url.search}${url.hash}`;
            const currentHref = `${globalScope.location.pathname || ''}${globalScope.location.search || ''}${globalScope.location.hash || ''}`;
            if (nextHref !== currentHref) {
                globalScope.history.pushState({ tgSubpage: open ? 'orders' : 'workspace', tab }, '', nextHref);
            }
        } catch (_) {}
    }
    function setOrderLookupOpen(open, preferredTab, options = {}) {
        const nextOpen = Boolean(open);
        const changed = nextOpen !== lookupOpen;
        if (preferredTab) setLookupTab(preferredTab, lookupOpen && nextOpen);
        lookupOpen = nextOpen;
        if (!lookupOpen) closeOrderDetails();
        const workspace = $('tgWorkspaceView');
        const subpage = $('tgOrderLookupPage');
        const toggle = $('tgOrderLookupToggle');
        if (workspace) workspace.hidden = lookupOpen;
        if (subpage) subpage.hidden = !lookupOpen;
        if (toggle) toggle.setAttribute('aria-current', lookupOpen ? 'page' : 'false');
        if (changed) {
            const target = lookupOpen ? subpage : workspace;
            if (target && target.classList) {
                target.classList.remove('tg-subpage-enter');
                void target.offsetWidth;
                target.classList.add('tg-subpage-enter');
            }
        }
        if (options.pushHistory !== false) {
            syncUrlWithSubpage(lookupOpen, lookupTab);
        }
    }
    function setServiceMode(mode) {
        const changed = mode !== serviceMode;
        if (changed) resetPurchaseQuote();
        serviceMode = mode;
        const buying = mode === 'purchase';
        $('tgModePurchase').setAttribute('aria-pressed', String(buying)); $('tgModeRedeem').setAttribute('aria-pressed', String(!buying));
        $('tgPurchasePanel').hidden = !buying;
        $('tgRedeemPanel').hidden = buying;
        setLookupTab(buying ? 'purchase' : 'redeem', false);
        if (changed) {
            const slideCls = buying ? 'tg-mode-slide-left' : 'tg-mode-slide-right';
            const activePanel = $(buying ? 'tgPurchasePanel' : 'tgRedeemPanel');
            const inactivePanel = $(buying ? 'tgRedeemPanel' : 'tgPurchasePanel');
            inactivePanel?.classList?.remove('tg-mode-slide-left', 'tg-mode-slide-right');
            if (activePanel && activePanel.classList) {
                activePanel.classList.remove('tg-mode-slide-left', 'tg-mode-slide-right');
                void activePanel.offsetWidth;
                activePanel.classList.add(slideCls);
            }
        }
        previewProduct(selectedFamily);
    }
    function resetPurchaseQuote() {
        quoteVersion += 1; purchaseQuote = null; purchaseFreshQuote = null;
        setPurchaseConfirmation();
        $('tgPurchaseConfirmation').hidden = true; $('tgPurchaseForm').hidden = false;
        setMessage($('tgPurchaseMessage'), '');
    }

    function productInfo(data, allowLegacyPremium = true) {
        const family = Object.hasOwn(data, 'product_family') ? data.product_family : allowLegacyPremium ? 'telegram_premium' : null;
        if (family === 'telegram_premium' && [3, 6, 12].includes(Number(data.term_months)) && data.stars_quantity == null) {
            return { label: `Premium ${Number(data.term_months)} 个月`, completed: '请在 Telegram 中查看 Premium 权益。' };
        }
        const quantity = Number(data.stars_quantity);
        if (family === 'telegram_stars' && data.term_months == null && Number.isInteger(quantity) && quantity >= 50 && quantity <= 1000000) {
            return { label: `Stars ${quantity.toLocaleString('zh-CN')} 颗`, completed: '请在 Telegram 中查看 Stars 星星余额。', stars: true };
        }
        return null;
    }
    function previewProduct(family) {
        const changed = family !== selectedFamily;
        if (changed) resetPurchaseQuote();
        selectedFamily = family;
        const stars = family === 'telegram_stars';
        $('tgPremiumPreview').setAttribute('aria-pressed', String(!stars));
        $('tgStarsPreview').setAttribute('aria-pressed', String(stars));
        updatePurchaseProduct();
        if (changed) {
            const slideCls = stars ? 'tg-product-slide-right' : 'tg-product-slide-left';
            const targets = [
                $(stars ? 'tgPurchaseStarsField' : 'tgPurchasePremiumField'),
                $('tgPurchasePrice')
            ];
            $(stars ? 'tgPurchasePremiumField' : 'tgPurchaseStarsField')?.classList?.remove('tg-product-slide-left', 'tg-product-slide-right');
            for (const el of targets) {
                if (el && el.classList) {
                    el.classList.remove('tg-product-slide-left', 'tg-product-slide-right');
                    void el.offsetWidth;
                    el.classList.add(slideCls);
                }
            }
        }
    }

    const setMessage = (element, message, type = '') => {
        element.textContent = message;
        element.className = `tg-form-message${type ? ` ${type}` : ''}`;
    };
    function syncButton() {
        $('tgRedeemButton').disabled = submitting || !redemptionEnabled;
        $('tgRedeemButton').textContent = submitting ? '正在提交…' : redemptionEnabled ? redeemPreview ? '确认权益并兑换 →' : '预览兑换权益 →' : '兑换服务暂未开放';
    }
    function validRecord(record) {
        return record && /^[a-f0-9]{64}$/.test(record.fingerprint) && TOKEN_PATTERN.test(record.statusToken)
            && /^tg_[a-f0-9]{64}$/.test(record.idempotencyKey) && /^[A-Za-z0-9_]{5,32}$/.test(record.username)
            && (!record.orderNo || ORDER_PATTERN.test(record.orderNo));
    }
    function restoreRecords() {
        try {
            const stored = JSON.parse(globalScope.sessionStorage.getItem(STORAGE_KEY) || '[]');
            records = Array.isArray(stored) ? stored.filter(validRecord).slice(-30) : [];
        } catch (_) { records = []; }
    }
    function persistRecords() {
        const serialized = JSON.stringify(records);
        globalScope.sessionStorage.setItem(STORAGE_KEY, serialized);
        if (globalScope.sessionStorage.getItem(STORAGE_KEY) !== serialized) throw new Error('storage_unavailable');
    }
    function randomToken() {
        // Credentials must remain strong even when randomUUID is unavailable.
        if (!globalScope.crypto?.getRandomValues) throw new Error('crypto_unavailable');
        return Array.from(globalScope.crypto.getRandomValues(new Uint8Array(32)), (item) => item.toString(16).padStart(2, '0')).join('');
    }
    async function fingerprint(code, username) {
        if (!globalScope.crypto?.subtle) throw new Error('crypto_unavailable');
        const bytes = new globalScope.TextEncoder().encode(`${code}:${username.toLowerCase()}`);
        return Array.from(new Uint8Array(await globalScope.crypto.subtle.digest('SHA-256', bytes)), (item) => item.toString(16).padStart(2, '0')).join('');
    }
    async function request(url, options = {}) {
        const controller = new globalScope.AbortController();
        const timeout = globalScope.setTimeout(() => controller.abort(), 15000);
        try {
            const response = await globalScope.fetch(url, { ...options, cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
            let data;
            try { data = await response.json(); } catch (_) { throw new Error('unconfirmed_response'); }
            return { response, data };
        } finally { globalScope.clearTimeout(timeout); }
    }
    function stopPolling() {
        if (pollTimer !== null) globalScope.clearTimeout(pollTimer);
        pollTimer = null;
    }
    function schedulePoll() {
        stopPolling();
        if (!tracking || !activeStatuses.has(tracking.status) || pollCount >= 45 || document.hidden) return;
        pollTimer = globalScope.setTimeout(() => { pollCount += 1; queryStatus(tracking.orderNo, tracking.statusToken, true, tracking.queryCredential); }, tracking.queryCredential || pollCount >= 6 ? 15000 : 5000);
    }
    function fillTracking(record) {
        rememberQueryCleared(false);
        $('tgOrderNo').value = record.orderNo;
        $('tgStatusToken').value = record.statusToken || '';
        $('tgCopyTracking').hidden = !TOKEN_PATTERN.test(record.statusToken || '');
        syncLookupBadge();
    }
    function detailNode(tag, className, value) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (value !== undefined) node.textContent = value;
        return node;
    }
    function renderCustomerDetails(kind, order = {}, product, title, hint, loading = false) {
        const purchase = kind === 'purchase';
        const result = $(purchase ? 'tgPurchaseStatusResult' : 'tgStatusResult');
        const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
        const status = (value, map) => detailNode('span', `tg-orders-badge is-${Object.hasOwn(map, value) ? value : 'unknown'}`, map[value] || '状态待确认');
        const section = (name, rows) => {
            const panel = detailNode('section', 'tg-orders-detail-section');
            const fields = detailNode('dl', 'tg-orders-detail-fields');
            for (const [label, value, className] of rows) {
                const field = detailNode('div', className);
                const content = detailNode('dd');
                if (loading) content.append(detailNode('span', 'tg-orders-detail-skeleton'));
                else if (value && typeof value === 'object') content.append(value);
                else content.textContent = value ?? '—';
                field.append(detailNode('dt', '', label), content); fields.append(field);
            }
            panel.append(detailNode('h3', '', name), fields); return panel;
        };
        const rows = [['订单号', order.order_no, 'is-identifier'], ['创建时间', date(order.created_at)], ['商品', product?.label], ['接收账号', order.username ? `@${order.username}` : '—']];
        if (purchase) rows.push(['支付状态', status(order.payment_status, paymentLabels)], ['发货状态', status(order.fulfillment_status, fulfillmentLabels)]);
        else rows.push(['订单状态', status(order.status, labels)]);
        const panels = [section('订单信息', rows)];
        if (purchase) {
            const crypto = order.payment_channel === 'usdt_bep20';
            const cryptoSnapshot = order.crypto_checkout || order.crypto_payment;
            const cryptoAmount = pricing.displayCryptoAmount(cryptoSnapshot?.pay_amount);
            const checkoutPending = order.payment_status === 'pending' && order.fulfillment_status === 'not_started' && !order.closed_at;
            const amount = loading ? '' : crypto ? cryptoAmount ? `${cryptoAmount} USDT`
                : checkoutPending ? 'USDT 金额待渠道确认' : '未记录 USDT 金额' : money(order.total_minor);
            const amountRows = [['支付方式', channelLabels[order.payment_channel]], ['商品金额', loading ? '' : money(order.subtotal_minor)],
                ['通道手续费', loading ? '' : `${order.payment_fee_rate_bps / 100}% · ${money(order.payment_fee_minor)}`],
                [order.payment_status === 'paid' ? '已付金额' : '应付金额', amount, 'is-amount']];
            if (crypto) amountRows.push(['网络协议', networkNames[cryptoSnapshot?.pay_currency] || cryptoSnapshot?.network
                || (checkoutPending ? '网络待确认' : '未记录网络协议')]);
            panels.push(section('金额明细', amountRows));
        }
        const progress = detailNode('section', 'tg-orders-detail-section');
        progress.append(detailNode('h3', '', '处理进度'));
        if (loading) progress.append(detailNode('span', 'tg-orders-detail-skeleton'), detailNode('span', 'tg-orders-detail-skeleton is-wide'));
        else {
            progress.append(title, hint);
            if ((purchase ? order.fulfillment_status : order.status) === 'closed') {
                if (purchase && order.closed_at) progress.append(detailNode('p', '', `完结时间：${date(order.closed_at)}`));
                if (order.completion_note) progress.append(detailNode('p', 'tg-orders-detail-note', `完结说明：${order.completion_note}`));
            }
        }
        panels.push(progress); result.replaceChildren(...panels); result.hidden = false;
    }
    function setDetailBusy(kind, orderNo, busy) {
        if (!orderDetailView || orderDetailView.kind !== kind || orderDetailView.orderNo !== orderNo) return;
        $('tgOrderDetailContent').setAttribute('aria-busy', String(busy));
        $('tgOrderDetailRefresh').disabled = busy;
        $('tgOrderDetailRefresh').textContent = busy ? '正在查询…' : '刷新状态';
    }
    function closeOrderDetails() {
        orderDetailView = null;
        if ($('tgOrderDetailDialog')?.open) $('tgOrderDetailDialog').close();
    }
    function orderDetailsClosed() {
        if ($('tgOrderDetailDialog').open) return;
        orderDetailView = null;
        const target = orderDetailReturnFocus; orderDetailReturnFocus = null;
        if (target?.isConnected !== false) target?.focus?.();
    }
    async function openOrderDetails(kind, orderNo, statusToken = '', queryCredential = '', showResult = false) {
        if (purchaseCancelBusy) return;
        setOrderLookupOpen(true, kind);
        orderDetailReturnFocus = document.activeElement;
        orderDetailView = { kind, orderNo, statusToken, queryCredential };
        const purchase = kind === 'purchase';
        $('tgOrderDetailTitle').textContent = purchase ? '购买订单详情' : '兑换订单详情';
        $('tgOrderDetailNumber').textContent = orderNo;
        $('tgOrderDetailPurchase').hidden = !purchase; $('tgOrderDetailRedeem').hidden = purchase;
        $('tgOrderDetailPurchaseActions').hidden = !purchase; $('tgOrderDetailRedeemActions').hidden = purchase;
        $('tgPurchaseClose').hidden = true; $('tgPurchaseCheckout').hidden = true;
        $('tgPurchaseCopyTracking').hidden = true; $('tgCopyTracking').hidden = true;
        renderCustomerDetails(kind, {}, null, null, null, true);
        $('tgOrderDetailContent').scrollTop = 0;
        setDetailBusy(kind, orderNo, true);
        if (!$('tgOrderDetailDialog').open) $('tgOrderDetailDialog').showModal();
        const order = purchase ? await queryPurchaseStatus(orderNo, statusToken, false, queryCredential) : await queryStatus(orderNo, statusToken, false, queryCredential);
        if (showResult && order && lookupTab === kind && $('tgOrdersSearchBy').value === 'tracking') {
            $('tgLegacyOrdersList').replaceChildren(globalScope.TgOrderQuery.createCard({ order, kind, onOpen: () => openOrderDetails(kind, orderNo, statusToken, queryCredential) }));
            $('tgLegacyOrdersResults').hidden = false;
        }
        return order;
    }
    function setOrderQueryMethod() {
        closeOrderDetails(); orderQuery?.reset();
        queryVersion++; purchaseQueryVersion++; stopPolling(); stopPurchasePolling();
        tracking = null; purchaseTracking = null; invalidatePurchasePayment(); setPurchaseQueryBusy(false);
        syncLookupBadge();
        const originalCredential = $('tgOrdersSearchBy').value === 'tracking';
        $('tgOrdersQueryForm').hidden = originalCredential;
        $('tgPurchaseStatusPanel').hidden = !originalCredential || lookupTab !== 'purchase';
        $('tgRedeemStatusPanel').hidden = !originalCredential || lookupTab !== 'redeem';
        $('tgLegacyOrdersResults').hidden = true;
        $('tgOrdersAccessHint').textContent = originalCredential ? '使用下单后保存的订单号和原查询凭证。' : '使用下单时填写的邮箱和查询密码。';
    }
    function renderStatus(data, product) {
        const result = $('tgStatusResult');
        const title = document.createElement('strong');
        title.textContent = product.stars && data.status === 'succeeded' ? '星星已到账'
            : product.stars && data.status === 'processing' ? '正在发放星星' : labels[data.status] || '状态待确认';
        const hint = document.createElement('p');
        hint.className = 'tg-muted';
        hint.textContent = data.status === 'closed' ? `完结时间：${new Date(data.closed_at).toLocaleString('zh-CN', { hour12: false })}`
            : data.status === 'succeeded' ? product.completed
            : activeStatuses.has(data.status) ? '系统会自动更新进度，可稍后使用订单号与凭证查询。'
                : '请保留订单号联系客服，我们会核对处理结果。';
        renderCustomerDetails('redeem', data, product, title, hint);
    }
    async function queryStatus(orderNo = text($('tgOrderNo').value), statusToken = text($('tgStatusToken').value), automatic = false, queryCredential = '') {
        const result = $('tgStatusResult');
        stopPolling();
        const version = ++queryVersion;
        if (!ORDER_PATTERN.test(orderNo) || !queryCredential && !TOKEN_PATTERN.test(statusToken)) {
            tracking = null;
            result.hidden = false;
            result.textContent = '请输入正确的订单号和查询凭证。';
            setDetailBusy('redeem', orderNo, false);
            return;
        }
        if (!automatic) {
            pollCount = 0;
            result.hidden = false;
            renderCustomerDetails('redeem', {}, null, null, null, true);
        }
        setDetailBusy('redeem', orderNo, true);
        tracking = { orderNo, statusToken, queryCredential, status: tracking?.orderNo === orderNo ? tracking.status : 'pending' };
        try {
            const { response, data } = await request(`/api/tg/status?order_no=${encodeURIComponent(orderNo)}`, { headers: queryAccessHeaders(statusToken, queryCredential) });
            if (version !== queryVersion) return;
            if (!response.ok || data.success !== true) {
                result.textContent = text(data.message) || '订单查询失败，请稍后重试。';
                // Invalid credentials and permanent failures must not keep polling.
                if (response.status >= 500 || response.status === 429) schedulePoll();
                return;
            }
            if (data.order_no !== orderNo || !Object.hasOwn(labels, data.status)) throw new Error('unconfirmed_response');
            if (data.status === 'closed' && (typeof data.closed_at !== 'string' || !Number.isFinite(Date.parse(data.closed_at))
                || typeof data.completion_note !== 'string' || text(data.completion_note).length < 6 || data.completion_note.length > 500)) throw new Error('unconfirmed_response');
            const product = productInfo(data);
            if (!product) { tracking = null; throw new Error('unconfirmed_product'); }
            tracking.status = data.status;
            fillTracking(tracking);
            renderStatus(data, product);
            schedulePoll();
            return data;
        } catch (error) {
            if (version !== queryVersion) return;
            result.hidden = false;
            result.textContent = error.message === 'unconfirmed_product' ? '订单权益尚未确认，请保留订单号联系客服。' : '暂时无法查询，订单不会重复提交。请稍后再查询。';
            schedulePoll();
        } finally { if (version === queryVersion) setDetailBusy('redeem', orderNo, false); }
    }
    function clearRedeemPreview() {
        redeemPreview = null; redeemInputVersion += 1;
        $('tgRedeemConfirmation').hidden = true; $('tgRedeemConfirmation').textContent = ''; syncButton();
    }
    async function postRedeem(event) {
        event.preventDefault();
        if (submitting) return;
        const message = $('tgFormMessage');
        if (!redemptionEnabled) return setMessage(message, '兑换服务暂未开放，已有订单仍可查询。');
        const username = text($('tgUsername').value).replace(/^@+/, '');
        const code = text($('tgCode').value).toUpperCase().replace(/\s+/g, '');
        if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) return setMessage(message, '请输入正确的 Telegram 用户名。', 'error');
        if (!/^TG-(?:PREM|STAR)-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/.test(code)) return setMessage(message, '请输入正确格式的 Premium 或 Stars 兑换码。', 'error');
        let queryCredentials;
        try { queryCredentials = orderQuery?.creationCredentials('redeem') || {}; }
        catch (error) { return setMessage(message, error.message, 'error'); }
        submitting = true;
        syncButton();
        let record;
        let previewing = false;
        const inputVersion = redeemInputVersion;
        let sent = false;
        try {
            const digest = await fingerprint(code, username);
            record = records.find((item) => item.fingerprint === digest);
            if (inputVersion !== redeemInputVersion) return;
            if (!redeemPreview || redeemPreview.fingerprint !== digest || redeemPreview.until < Date.now()) {
                previewing = true;
                if (record) {
                    if (record.orderNo) { fillTracking(record); setOrderLookupOpen(true, 'redeem'); await openOrderDetails('redeem', record.orderNo, record.statusToken); return; }
                    // A previously sent request may already own the code. Reuse
                    // its credentials instead of asking preview to reserve it again.
                    $('tgRedeemConfirmation').textContent = `@${username} · 上次兑换结果尚未确认。继续将核对同一请求，不会创建第二笔兑换。`;
                } else {
                    const { response, data } = await request('/api/tg/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
                    if (inputVersion !== redeemInputVersion) return;
                    const product = productInfo(data, false);
                    if (!response.ok || data.success !== true || !product) { clearRedeemPreview(); setMessage(message, text(data.message) || '兑换码权益尚未确认，请稍后重试。', 'error'); return; }
                    $('tgRedeemConfirmation').textContent = `@${username} · ${product.label} · 有效期：${data.expires_at ? new Date(data.expires_at).toLocaleString('zh-CN') : '长期有效'}。请核对账号和权益，再确认兑换。预览不占用兑换码。`;
                }
                redeemPreview = { fingerprint: digest, until: Date.now() + 60000 };
                $('tgRedeemConfirmation').hidden = false; setMessage(message, '请核对上方权益后确认。'); return;
            }

            if (!record) {
                if (records.length >= 30) throw new Error('attempt_limit');
                record = { fingerprint: digest, username, statusToken: randomToken(), idempotencyKey: `tg_${randomToken()}`, orderNo: '', savedAt: Date.now() };
                records.push(record);
            }
            if (!record.orderNo && record.queryEmail && record.queryEmail !== queryCredentials.query_email) throw new Error('query_email_changed');
            if (queryCredentials.query_email) record.queryEmail = queryCredentials.query_email;
            // Persist before sending: a lost response or reload must reuse the
            // same credentials. The plaintext redemption code is never stored.
            persistRecords();
            setMessage(message, '正在安全提交兑换请求…');
            sent = true;
            const { response, data } = await request('/api/tg/redeem', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': record.idempotencyKey },
                body: JSON.stringify({ code, username, status_token: record.statusToken, idempotency_key: record.idempotencyKey, ...queryCredentials })
            });
            if (!response.ok || data.success !== true) {
                setMessage(message, text(data.message) || '兑换请求暂未确认，请保留原兑换码稍后重试。', 'error');
                return;
            }
            if (!ORDER_PATTERN.test(data.order_no) || !Object.hasOwn(labels, data.status) || (data.status_token && data.status_token !== record.statusToken)) throw new Error('unconfirmed_response');
            record.orderNo = data.order_no;
            try { persistRecords(); } catch (_) { /* Credentials were saved before submission and remain in memory. */ }
            orderQuery?.rememberCreation(queryCredentials);
            fillTracking(record);
            $('tgCode').value = ''; clearRedeemPreview();
            queueGiftPreview();
            setMessage(message, '兑换请求已受理。请保存订单号和查询凭证。', 'success');
            setOrderLookupOpen(true, 'redeem');
            await openOrderDetails('redeem', record.orderNo, record.statusToken);
        } catch (error) {
            const description = previewing ? '兑换码暂时无法预览，请稍后重试。尚未提交兑换。' : sent ? '请求结果暂未确认。请保留原兑换码、用户名，在当前标签页重试，系统会核对原请求。'
                : error.message === 'query_email_changed' ? '原兑换请求尚未确认，请使用原查询邮箱和查询密码重试。'
                    : error.message === 'attempt_limit' ? '当前标签页提交记录较多，请先查询已有订单或联系客服。'
                    : '浏览器暂不支持安全保存兑换凭证，请使用 HTTPS 或本地预览，并允许当前标签页存储。尚未提交兑换。';
            setMessage(message, description, 'error');
        } finally { submitting = false; syncButton(); }
    }
    function scheduleFxCatalogRefresh() {
        if (fxCatalogTimer !== null) globalScope.clearTimeout(fxCatalogTimer);
        fxCatalogTimer = null;
        if (!marketFxEnabled || document.hidden) return;
        const delay = usdtFx ? Math.max(5000, Math.min(300000, Date.parse(usdtFx.expires_at) - Date.now())) : 300000;
        fxCatalogTimer = globalScope.setTimeout(async () => {
            fxCatalogTimer = null;
            if (!purchaseBusy && !purchaseQuote && !$('tgPaymentDialog').open) await loadCatalog();
            else scheduleFxCatalogRefresh();
        }, delay);
    }
    async function loadCatalog() {
        const retrying = catalogState === 'error';
        if (retrying) {
            catalogState = 'loading';
            setMessage($('tgPurchaseMessage'), '');
            setMessage($('tgFormMessage'), '');
            updatePurchaseProduct();
        }
        try {
            const { response, data } = await request('/api/tg/catalog');
            if (!response.ok || data.success !== true) throw new Error('catalog_unavailable');
            catalogState = 'ready';
            if (catalogRequestFailed) {
                setMessage($('tgPurchaseMessage'), '');
                setMessage($('tgFormMessage'), '');
                catalogRequestFailed = false;
            }
            orderQuery?.setReady(response.ok && data.success === true && data.order_query?.enabled === true);
            redemptionEnabled = response.ok && data.success === true && data.redemption_enabled === true;
            purchaseEnabled = response.ok && data.success === true && data.purchase_enabled === true && data.currency === 'CNY';
            saleProducts = Array.isArray(data.sale_products) ? data.sale_products : [];
            paymentChannels = (Array.isArray(data.payment_channels) ? data.payment_channels : []).filter((channel) => Object.hasOwn(channelLabels, channel.id));
            usdtPerCny = response.ok && data.success === true && pricing.usdtPayAmount(100, data.usdt_per_cny) ? data.usdt_per_cny : null;
            marketFxEnabled = data.usdt_fx_mode === 'market';
            usdtFx = marketFxEnabled && validMarketFx(data.usdt_fx) ? data.usdt_fx : null;
            const currentChannel = $('tgPurchaseChannel').value;
            const options = paymentChannels.map((channel) => { const option = document.createElement('option'); option.value = channel.id; option.textContent = channelLabels[channel.id]; return option; });
            if (!options.length) { const option = document.createElement('option'); option.value = ''; option.textContent = '支付方式暂未开放'; options.push(option); }
            $('tgPurchaseChannel').replaceChildren(...options);
            $('tgPurchaseChannel').value = paymentChannels.some((item) => item.id === currentChannel) ? currentChannel : options[0].value;
            const currentProduct = $('tgPurchaseProduct').value;
            const premiumOptions = [3, 6, 12].map((months) => {
                const option = document.createElement('option'); option.value = `premium_${months}`;
                const product = saleProducts.find((item) => item.id === option.value);
                option.textContent = `${months} 个月 · ${pricedSaleProduct(product) ? money(product.price_minor) : '价格待公布'}`;
                return option;
            });
            $('tgPurchaseProduct').replaceChildren(...premiumOptions);
            $('tgPurchaseProduct').value = premiumOptions.some((item) => item.value === currentProduct) ? currentProduct : 'premium_12';
            if (!purchaseEnabled) setMessage($('tgPurchaseMessage'), '购买服务暂未开放，已有订单仍可查询。');
            if (!redemptionEnabled) setMessage($('tgFormMessage'), '兑换服务暂未开放，已有订单仍可查询。');
        } catch (_) {
            if (catalogState === 'loading') catalogState = 'error';
            catalogRequestFailed = true;
            setMessage($('tgPurchaseMessage'), catalogState === 'error' ? '暂时无法连接购买服务，请点击重新加载。' : '暂时无法更新售价，请稍后重试。', 'error');
            setMessage($('tgFormMessage'), '暂时无法连接兑换服务，请稍后刷新。', 'error');
        }
        syncButton();
        updatePurchaseProduct();
        scheduleFxCatalogRefresh();
    }
    function validMarketFx(value) {
        return !!value && value.source === 'coingecko:tether/cny' && typeof value.usdt_per_cny === 'string'
            && !!pricing.usdtPayAmount(100, value.usdt_per_cny)
            && Number(value.cny_per_usdt) >= 2 && Number(value.cny_per_usdt) <= 20
            && Number.isFinite(Date.parse(value.expires_at));
    }

    function restorePurchases() {
        try {
            const saved = JSON.parse(globalScope.sessionStorage.getItem(PURCHASE_STORAGE_KEY) || '[]');
            purchaseRecords = Array.isArray(saved) ? saved.filter((record) => record && /^[a-f0-9]{64}$/.test(record.fingerprint)
                && TOKEN_PATTERN.test(record.statusToken) && /^tg_buy_[a-f0-9]{64}$/.test(record.idempotencyKey)
                && /^[A-Za-z0-9_]{5,32}$/.test(record.request?.username) && (!record.orderNo || PURCHASE_ORDER_PATTERN.test(record.orderNo))).slice(-30) : [];
        } catch (_) { purchaseRecords = []; }
    }
    function rememberPurchaseCryptoSnapshot(record, order) {
        if (!record?.request || order?.payment_channel !== 'usdt_bep20') return;
        const snapshot = order.crypto_checkout || order.crypto_payment;
        const amount = snapshot?.pay_amount;
        const currency = snapshot?.pay_currency;
        if (!pricing.displayCryptoAmount(amount) || !Object.hasOwn(networkNames, currency)) return;
        // Keep only the immutable display summary. Payment addresses, provider
        // IDs and memo values must never be copied into browser storage.
        record.request.usdt_pay_amount = amount;
        record.request.pay_currency = currency;
    }
    function persistPurchases() {
        const saved = JSON.stringify(purchaseRecords); globalScope.sessionStorage.setItem(PURCHASE_STORAGE_KEY, saved);
        if (globalScope.sessionStorage.getItem(PURCHASE_STORAGE_KEY) !== saved) throw new Error('storage_unavailable');
        renderRecentPurchases();
    }
    function renderRecentPurchases() {
        const saved = purchaseRecords.filter(record => record.orderNo).slice().reverse();
        $('tgRecentPurchases').hidden = saved.length === 0;
        $('tgRecentPurchaseCount').textContent = `共 ${saved.length} 笔`;
        $('tgRecentPurchaseList').replaceChildren(...saved.map(record => {
            const order = purchaseSnapshots.get(record.orderNo) || {
                ...record.request, order_no: record.orderNo, total_minor: record.request.expected_total_minor,
                payment_channel: record.request.channel,
                ...(record.request.usdt_pay_amount ? { crypto_checkout: { pay_amount: record.request.usdt_pay_amount, pay_currency: record.request.pay_currency } } : {})
            };
            return globalScope.TgOrderQuery.createCard({ order, onOpen: () => viewSavedPurchase(record) });
        }));
    }
    async function viewSavedPurchase(record) {
        if (purchaseBusy || purchaseCancelBusy || !record?.orderNo) return;
        fillPurchaseTracking(record);
        return openOrderDetails('purchase', record.orderNo, record.statusToken);
    }
    function setPurchaseConfirmation(mode = 'new', orderNo = '') {
        purchaseConfirmation = { mode, orderNo };
        syncPurchaseConfirmation();
    }
    function syncPurchaseConfirmation() {
        const additional = purchaseConfirmation.mode === 'additional';
        const recovering = purchaseConfirmation.mode === 'recover';
        if (!purchaseBusy) $('tgPurchaseConfirm').textContent = additional ? '确认另购并创建新订单' : recovering ? '查询或恢复原订单' : '确认并创建订单';
        $('tgPurchaseConfirmationHint').textContent = additional
            ? `原订单 ${purchaseConfirmation.orderNo} 已付款，无需再付。仅在确实需要再次购买时继续；新订单需另行付款，原订单继续处理。`
            : recovering ? '继续将查询或恢复原订单，不会新建订单。请核对原订单接收者和金额。'
                : '请再次核对接收者和金额。确认后将创建支付订单。';
        $('tgPurchaseViewOriginal').hidden = !additional;
        $('tgPurchaseViewOriginal').disabled = purchaseBusy || purchaseCancelBusy;
    }
    function safeCheckoutUrl(value) {
        try {
            const url = new globalScope.URL(value);
            if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href.length > 4096 || url.pathname === '/'
                || /(?:^|[-_/])(placeholder|loading|default|sample|demo|download)(?:[-_/.]|$)/i.test(url.pathname)
                || ['d.alipay.com', 'mobile.alipay.com'].includes(url.hostname)) return '';
            return url.href;
        } catch (_) { return ''; }
    }
    function feeSummary(value) {
        const crypto = value.payment_channel === 'usdt_bep20';
        const exact = crypto ? pricing.displayCryptoAmount(value.crypto_checkout?.pay_amount) : null;
        const amountLabel = value.payment_status === 'paid' ? '已付金额' : '应付金额';
        const payable = exact ? `${amountLabel} ${exact} USDT` : crypto ? `${amountLabel} USDT 金额将在支付订单创建后锁定` : `${amountLabel} ${money(value.total_minor)}`;
        return `商品金额 ${money(value.subtotal_minor)} · 通道手续费 ${value.payment_fee_rate_bps / 100}%：${money(value.payment_fee_minor)} · ${payable}`;
    }
    function renderPurchaseQuoteSummary(quote, { original = false } = {}) {
        setPurchaseConfirmation(original ? 'recover' : 'new');
        function group(label, rows) {
            const list = document.createElement('dl'); list.className = 'tg-confirm-details'; list.setAttribute('aria-label', label);
            list.replaceChildren(...rows.map(([name, value, total]) => {
                const row = document.createElement('div'); row.className = `tg-confirm-row${total ? ' is-total' : ''}`;
                const term = document.createElement('dt'); term.textContent = name;
                const detail = document.createElement('dd'); detail.textContent = value;
                row.replaceChildren(term, detail); return row;
            }));
            return list;
        }
        const details = group('购买信息', [
            ['接收账号', `@${quote.username}`], ['商品规格', productInfo(quote).label],
            ['支付方式', channelLabels[quote.channel] || '待核对支付方式'],
            ...(quote.channel === 'usdt_bep20' ? [['转账网络', networkNames[quote.pay_currency || 'usdtbsc']]] : [])
        ]);
        const crypto = quote.channel === 'usdt_bep20';
        const payable = crypto ? pricing.displayCryptoAmount(quote.usdt_pay_amount) : null;
        const amount = group('金额明细', [
            ['商品金额', money(quote.subtotal_minor)], [`通道手续费（${quote.payment_fee_rate_bps / 100}%）`, money(quote.payment_fee_minor)],
            ...(crypto && validMarketFx(quote.usdt_fx) ? [['锁定汇率', `1 USDT ≈ ¥${Number(quote.usdt_fx.cny_per_usdt).toFixed(4)}`]] : []),
            [crypto ? '应付金额（USDT）' : '应付金额', crypto ? (payable || '正在核对原订单金额') : money(quote.total_minor), true]
        ]);
        const notice = document.createElement('p'); notice.className = 'tg-confirm-original'; notice.textContent = original ? '原订单 · 请核对后继续' : crypto ? '应付金额已含上列通道手续费，链上 Gas 另付。' : '';
        if (!original && crypto && validMarketFx(quote.usdt_fx)) notice.textContent = '本次报价已锁定汇率与应付金额。已含通道手续费，链上 Gas 另付。';
        $('tgPurchaseQuoteSummary').replaceChildren(...(original ? [notice] : []), details, amount, ...(!original && crypto ? [notice] : []));
    }
    function paymentQr(value) {
        // Same local QR renderer as guest-shop-client; no payment URL/address
        // is sent to a third-party image service or opened as a browser link.
        if (typeof globalScope.qrcode !== 'function') throw new Error('qr_unavailable');
        const qr = globalScope.qrcode(0, 'M'); qr.addData(value); qr.make();
        const image = document.createElement('img'); image.className = 'tg-payment-qr'; image.alt = '支付二维码';
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag(5, 4))}`;
        return image;
    }
    function clearPaymentExpiry() {
        if (paymentExpiryTimer !== null) globalScope.clearTimeout(paymentExpiryTimer);
        paymentExpiryTimer = null;
    }
    function closePaymentDialog() {
        $('tgPaymentDialog').close();
    }
    function paymentDialogClosed() {
        clearPaymentExpiry();
        if (paymentReturnToOrders) {
            paymentReturnToOrders = false;
            if ($('tgOrderDetailDialog').open) $('tgPurchaseCheckout').focus?.();
            return;
        }
        setOrderLookupOpen(false, serviceMode);
        $(serviceMode === 'purchase' ? 'tgPurchaseButton' : 'tgRedeemButton').focus?.();
    }
    function paymentRow(label, value) {
        const row = document.createElement('div'); row.className = 'guest-shop-modal__summary-row';
        const name = document.createElement('span'); name.textContent = label;
        const detail = document.createElement('strong'); detail.textContent = value;
        row.replaceChildren(name, detail); return row;
    }
    function paymentOverview(order) {
        const overview = document.createElement('div'); overview.className = 'guest-shop-modal__order-overview';
        const summary = document.createElement('section'); summary.className = 'guest-shop-modal__summary'; summary.setAttribute('aria-label', '订单信息');
        summary.replaceChildren(...[
            ['商品', order.product_family === 'telegram_stars' ? 'Telegram Stars' : 'Telegram Premium'],
            ['规格', productInfo(order, false).label], ['接收账号', `@${order.username}`], ['订单号', order.order_no],
            ['订单状态', order.fulfillment_status === 'closed' ? '订单已完结' : latestPurchasePaymentSync?.state === 'received' ? '渠道已收款，等待核对' : paymentLabels[order.payment_status]], ['支付方式', channelLabels[order.payment_channel]]
        ].map(([name, value]) => paymentRow(name, value)));
        const fees = document.createElement('section'); fees.className = 'guest-shop-modal__amount'; fees.setAttribute('aria-label', '金额明细');
        const header = document.createElement('div'); header.className = 'guest-shop-modal__amount-header';
        const cryptoOrder = order.payment_channel === 'usdt_bep20';
        const cryptoAmount = cryptoOrder ? pricing.displayCryptoAmount((order.crypto_checkout || order.crypto_payment)?.pay_amount) : null;
        const checkoutPending = order.payment_status === 'pending' && order.fulfillment_status === 'not_started' && !order.closed_at;
        const amountLabel = order.payment_status === 'paid' ? '已付金额' : '应付金额';
        const label = document.createElement('span'); label.className = 'guest-shop-modal__amount-label'; label.textContent = cryptoOrder ? `${amountLabel}（USDT）` : amountLabel;
        const total = document.createElement('strong'); total.className = 'guest-shop-modal__amount-value';
        total.textContent = cryptoAmount ? `${cryptoAmount} USDT` : cryptoOrder
            ? checkoutPending ? '等待渠道锁定' : '未记录 USDT 金额' : money(order.total_minor);
        header.replaceChildren(label, total);
        const rows = document.createElement('div'); rows.className = 'guest-shop-modal__amount-rows';
        rows.replaceChildren(paymentRow(cryptoOrder ? '商品金额（CNY）' : '商品金额', money(order.subtotal_minor)),
            paymentRow(cryptoOrder ? `通道手续费（${order.payment_fee_rate_bps / 100}% · CNY）` : `通道手续费（${order.payment_fee_rate_bps / 100}%）`, money(order.payment_fee_minor)));
        const hint = document.createElement('p'); hint.className = 'tg-muted';
        hint.textContent = order.payment_status === 'paid'
            ? order.fulfillment_status === 'succeeded' ? '该订单已付款并完成发货，无需再次付款。' : '该订单已付款，无需再次付款。请保留订单号查询发货进度；待人工复核的订单请联系客服处理。'
            : latestPurchasePaymentSync?.state === 'received' ? '渠道已确认收款，请勿重复付款，等待订单核对。'
                : cryptoAmount
            ? 'USDT 展示金额已按 4 位小数向上取整；“复制精确 USDT 金额”使用支付渠道返回的完整金额。请优先复制精确值，少付不会确认支付或发货。'
            : cryptoOrder ? 'USDT 转账金额将在支付渠道锁定后显示，请勿根据人民币金额自行换算或付款。'
                : '请支付含通道手续费的完整金额。少付不会确认支付或发货。';
        fees.replaceChildren(header, rows, hint); overview.replaceChildren(summary, fees); return overview;
    }
    function startPaymentCountdown(expiry, overview) {
        const tick = () => {
            paymentExpiryTimer = null;
            const seconds = Math.max(0, Math.ceil((expiry - paymentNow()) / 1000));
            $('tgPaymentCountdown').hidden = false;
            $('tgPaymentCountdown').className = `guest-shop-modal__state-countdown${seconds === 0 ? ' is-expired' : seconds <= 60 ? ' is-warning' : ''}`;
            const pad = (value) => String(value).padStart(2, '0');
            $('tgPaymentCountdownValue').textContent = `${seconds >= 3600 ? `${pad(Math.floor(seconds / 3600))}:` : ''}${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
            if (seconds === 0) {
                // The displayed deadline also gates all copyable payment details.
                $('tgPaymentContent').replaceChildren(overview);
                $('tgPaymentStateMessage').textContent = '支付信息已过期，请查询订单状态，勿继续付款。';
                return;
            }
            if (!document.hidden) paymentExpiryTimer = globalScope.setTimeout(tick, Math.min(1000, expiry - paymentNow()));
        };
        tick();
    }
    function renderPaymentDialog() {
        syncPurchasePaymentActions();
        const order = latestPurchaseOrder; const content = $('tgPaymentContent');
        const key = order && JSON.stringify([order, latestPurchasePaymentSync]);
        if (key && paymentDialogView?.key === key) {
            if (paymentDialogView.expiry && paymentExpiryTimer === null) startPaymentCountdown(paymentDialogView.expiry, paymentDialogView.overview);
            return;
        }
        clearPaymentExpiry();
        const status = $('tgPaymentStateMessage'); $('tgPaymentCountdown').hidden = true;
        if (!order) {
            if (paymentDialogView) {
                // Keep the last confirmed summary and panel size, but remove
                // every payable detail until a new response is verified.
                paymentDialogView.key = null;
                paymentDialogView.expiry = null;
                const panel = paymentDialogView.panel;
                if (panel) {
                    const height = panel.getBoundingClientRect?.().height;
                    if (height > 0) panel.style.minHeight = `${height}px`;
                    panel.className = 'guest-shop-modal__panel tg-payment-unavailable';
                    const title = document.createElement('strong'); title.textContent = '暂时无法确认支付状态';
                    const hint = document.createElement('p'); hint.className = 'tg-muted';
                    hint.textContent = '请暂勿付款。状态确认后会恢复支付信息，也可以点击下方按钮重试。';
                    panel.replaceChildren(title, hint);
                }
            } else content.replaceChildren();
            status.textContent = '支付状态暂未确认，请稍后重新查询。';
            return;
        }
        const completed = order.fulfillment_status === 'closed';
        $('tgPaymentSteps').hidden = completed;
        $('tgPaymentTitle').textContent = completed ? '订单已完结' : order.payment_status === 'paid' ? '订单进度' : '订单支付';
        $('tgPaymentFooterHint').textContent = completed ? '订单已完结，处理结果已保存在订单中，可随时查询。' : order.payment_status === 'paid' || latestPurchasePaymentSync?.state === 'received'
            ? '该订单已收款，请勿重复付款。关闭后可从订单查询查看进度，请保存订单号和查询凭证。'
            : order.payment_status === 'pending' ? '关闭弹窗后订单保留，可在订单查询中继续支付。请保存订单号和查询凭证；支付以实际足额到账为准。'
                : '关闭弹窗后订单和查询凭证保留，请从订单查询核对处理进度，勿继续付款。';
        const delivered = order.fulfillment_status === 'succeeded';
        const delivery = order.payment_status === 'paid';
        for (const [id, step] of [['tgPaymentStepConfigure', 0], ['tgPaymentStepPayment', 1], ['tgPaymentStepDelivery', 2]]) {
            const current = delivery ? 2 : 1;
            $(id).className = `guest-shop-modal__step ${delivered || step < current ? 'is-done' : step === current ? 'is-current' : 'is-upcoming'}`;
            $(id).setAttribute('aria-current', !delivered && step === current ? 'step' : 'false');
        }
        const overview = paymentOverview(order);
        paymentDialogView = { key, overview, panel: null, expiry: null };
        status.textContent = `${paymentLabels[order.payment_status]} · ${fulfillmentLabels[order.fulfillment_status]}`;
        content.replaceChildren(overview);
        if (completed) {
            status.textContent = '订单已完结';
            const explanation = document.createElement('div'); explanation.className = 'tg-completion-note';
            const heading = document.createElement('strong'); heading.textContent = '管理员完结说明';
            const note = document.createElement('p'); note.textContent = order.completion_note || '管理员已完成处理，此订单的自动发货已停止。';
            explanation.append(heading, note); content.append(explanation); return;
        }
        if (order.payment_status === 'cancelled') {
            status.textContent = '订单已取消，请勿继续付款。若已转账，请保留订单号联系客服核对。';
        }
        if (latestPurchasePaymentSync?.state === 'received') {
            status.textContent = latestPurchasePaymentSync.message;
            return;
        }
        if (order.payment_status !== 'pending') return;
        if (purchaseCancelIntents.has(order.order_no)) {
            status.textContent = '已请求取消，请勿继续付款。可查询取消结果或再次点击取消订单。';
            return;
        }
        // Neither the provider quote nor the order's own deadline may be exceeded.
        const expiry = order.payment_channel === 'usdt_bep20'
            ? Math.min(Date.parse(order.crypto_checkout?.quote_expires_at), Date.parse(order.expires_at)) : Date.parse(order.expires_at);
        if (!Number.isFinite(expiry) || expiry <= paymentNow()) {
            status.textContent = '支付信息已过期或暂未确认，请查询订单状态，勿继续付款。'; return;
        }
        try {
            let panel;
            if (order.payment_channel === 'usdt_bep20') panel = renderCryptoCheckout(order.crypto_checkout, expiry);
            else {
                const url = safeCheckoutUrl(order.checkout_url); if (!url) throw new Error('unconfirmed_payment');
                panel = document.createElement('section'); panel.className = 'guest-shop-modal__panel tg-payment-scan'; panel.setAttribute('aria-label', '扫码付款');
                const title = document.createElement('strong'); title.textContent = `${channelLabels[order.payment_channel]}扫码支付`;
                const instruction = document.createElement('p'); instruction.className = 'tg-muted';
                instruction.textContent = `请使用${channelLabels[order.payment_channel]}扫描二维码，或保存二维码后在 App 中识别。请核对并支付完整应付金额（含通道手续费），勿修改金额。`;
                panel.replaceChildren(title, paymentQr(url), instruction);
            }
            paymentDialogView.panel = panel;
            paymentDialogView.expiry = expiry;
            content.replaceChildren(overview, panel);
            startPaymentCountdown(expiry, overview);
        } catch (_) { paymentDialogView.key = null; content.replaceChildren(overview); status.textContent = '支付二维码暂不可用，请稍后查询订单或联系客服，勿重复创建订单。'; }
    }
    function openPaymentDialog() {
        if (!latestPurchaseOrder) return;
        renderPaymentDialog();
        if (!$('tgPaymentDialog').open) { paymentReturnToOrders = lookupOpen; $('tgPaymentDialog').showModal(); }
    }
    function validCryptoAddress(currency, address) {
        if (currency === 'usdtton') return /^(?:[EUek]Q[A-Za-z0-9_-]{46}|-?\d+:[0-9a-fA-F]{64})$/.test(address || '');
        if (currency === 'usdttrc20') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address || '');
        return ['usdtbsc', 'usdtmatic'].includes(currency) && /^0x[0-9a-fA-F]{40}$/.test(address || '');
    }
    function renderCryptoCheckout(value, deadline = Date.parse(value?.quote_expires_at)) {
        const networkName = networkNames[value?.pay_currency];
        if (!value || !networkName || value.network !== networkName
            || typeof value.pay_amount !== 'string' || !/^(?:0|[1-9]\d{0,20})(?:\.\d{1,18})?$/.test(value.pay_amount)
            || !/[1-9]/.test(value.pay_amount) || !validCryptoAddress(value.pay_currency, value.pay_address)
            || typeof value.quote_expires_at !== 'string' || !Number.isFinite(Date.parse(value.quote_expires_at))
            || (value.payin_extra_id != null && !/^[\x21-\x7e]{1,128}$/.test(value.payin_extra_id))) throw new Error('unconfirmed_crypto_payment');
        const panel = document.createElement('div'); panel.className = 'guest-shop-modal__panel tg-crypto-checkout';
        const title = document.createElement('strong'); title.textContent = `USDT · ${networkName}`;
        if (deadline <= paymentNow()) {
            const expired = document.createElement('p'); expired.textContent = '此转账报价已过期，请联系客服核对订单，勿向旧地址继续转账。';
            panel.replaceChildren(title, expired); return panel;
        }
        const displayAmount = pricing.displayCryptoAmount(value.pay_amount);
        if (!displayAmount) throw new Error('unconfirmed_crypto_payment');
        const amount = document.createElement('p'); amount.className = 'tg-crypto-amount'; amount.textContent = `${displayAmount} USDT`;
        amount.setAttribute('aria-label', `应付金额 ${displayAmount} USDT，精确金额请使用复制按钮`);
        const address = document.createElement('code'); address.textContent = value.pay_address;
        const expiry = document.createElement('p'); expiry.className = 'tg-muted'; expiry.textContent = `请在 ${new Date(deadline).toLocaleString('zh-CN', { hour12: false })} 前完成转账（以支付渠道报价与订单期限中较早者为准）`;
        const warning = document.createElement('p'); warning.className = 'tg-warning'; warning.textContent = `仅支持 ${networkName} 网络。页面金额为便于阅读的 4 位小数展示值；请点击“复制精确 USDT 金额”并完整转账，勿自行扣减；链上 Gas 另付。少付不会确认支付或发货。二维码仅包含收款地址，请同时核对网络和金额。${value.payin_extra_id ? ' 必须同时填写下方 Memo，遗漏将无法自动确认付款。' : ''}`;
        const actions = document.createElement('div'); actions.className = 'tg-crypto-actions';
        const buttons = [['复制收款地址', value.pay_address], ['复制精确 USDT 金额', value.pay_amount], ...(value.payin_extra_id ? [['复制 Memo：' + value.payin_extra_id, value.payin_extra_id]] : [])].map(([label, content]) => {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'tg-button tg-button-secondary'; button.textContent = label;
            button.addEventListener('click', async () => { try { await globalScope.navigator.clipboard.writeText(content); button.textContent = '已复制'; } catch (_) { button.textContent = '复制失败，请手动复制'; } });
            return button;
        });
        actions.replaceChildren(...buttons); panel.replaceChildren(title, amount, address, expiry, warning, actions, paymentQr(value.pay_address)); return panel;
    }
    function purchaseOrderMatches(order, request) {
        const family = request.product_family || (request.product_id === 'stars' ? 'telegram_stars' : 'telegram_premium');
        const months = request.term_months ?? (family === 'telegram_premium' ? Number(request.product_id.replace('premium_', '')) : null);
        return order && order.product_family === family && order.term_months === months
            && order.stars_quantity === (request.stars_quantity ?? null) && text(order.username).toLowerCase() === text(request.username).toLowerCase()
            && order.currency === 'CNY' && order.total_minor === request.expected_total_minor
            && pricing.valid(order)
            && (request.subtotal_minor == null || (order.subtotal_minor === request.subtotal_minor
                && order.payment_fee_minor === request.payment_fee_minor && order.payment_fee_rate_bps === request.payment_fee_rate_bps))
            && (!order.crypto_checkout || order.crypto_checkout.pay_currency === (request.pay_currency || 'usdtbsc'))
            && order.price_version === request.price_version && order.payment_channel === request.channel;
    }
    function fillPurchaseTracking(record) {
        rememberQueryCleared(false);
        $('tgPurchaseOrderNo').value = record.orderNo; $('tgPurchaseStatusToken').value = record.statusToken || ''; $('tgPurchaseCopyTracking').hidden = !TOKEN_PATTERN.test(record.statusToken || '');
        syncLookupBadge();
        renderRecentPurchases();
    }
    function stopPurchasePolling() { if (purchaseTimer !== null) globalScope.clearTimeout(purchaseTimer); purchaseTimer = null; }
    function schedulePurchasePoll() {
        stopPurchasePolling();
        if (!purchaseTracking || purchaseCancelBusy || purchasePollCount >= 60 || document.hidden || purchaseTracking.finished) return;
        purchaseTimer = globalScope.setTimeout(() => { purchasePollCount += 1; queryPurchaseStatus(purchaseTracking.orderNo, purchaseTracking.statusToken, true, purchaseTracking.queryCredential); }, purchaseTracking.queryCredential || purchasePollCount >= 12 ? 15000 : 5000);
    }
    function invalidatePurchasePayment() {
        latestPurchaseOrder = null;
        latestPurchasePaymentSync = null;
        if (purchaseTracking) purchaseTracking.canClose = false;
        $('tgPurchaseClose').hidden = true;
        $('tgPurchaseCheckout').hidden = true;
        if ($('tgPaymentDialog').open) renderPaymentDialog();
        else paymentDialogView = null;
    }
    function syncPurchasePaymentActions() {
        const refresh = $('tgPaymentRefresh'); refresh.disabled = purchaseQueryBusy || purchaseCancelBusy;
        refresh.textContent = purchaseQueryBusy ? '正在查询支付状态…' : '查询支付状态'; refresh.setAttribute('aria-busy', String(purchaseQueryBusy));
        $('tgPurchaseCheckout').disabled = purchaseQueryBusy || purchaseCancelBusy;
        $('tgPurchaseClose').disabled = purchaseQueryBusy || purchaseCancelBusy;
        const cancel = $('tgPaymentCancelOrder');
        cancel.hidden = latestPurchaseOrder?.fulfillment_status === 'closed' || !purchaseCancelBusy && !['pending', 'expired'].includes(latestPurchaseOrder?.payment_status);
        cancel.disabled = purchaseQueryBusy || purchaseCancelBusy || !latestPurchaseOrder || latestPurchaseOrder.fulfillment_status !== 'not_started' || latestPurchasePaymentSync?.state === 'received';
        cancel.textContent = purchaseCancelBusy ? '正在取消…' : '取消订单'; cancel.setAttribute('aria-busy', String(purchaseCancelBusy));
    }
    function setPurchaseQueryBusy(busy) {
        purchaseQueryBusy = busy; syncPurchasePaymentActions();
    }
    function applyPurchaseStatus(order, orderNo, paymentSync = null) {
        const product = order && productInfo(order, false);
        if (!order || order.order_no !== orderNo || !product || order.currency !== 'CNY' || !Number.isSafeInteger(order.total_minor) || order.total_minor <= 0
            || !Object.hasOwn(paymentLabels, order.payment_status) || !Object.hasOwn(fulfillmentLabels, order.fulfillment_status)) throw new Error('unconfirmed_order');
        const savedRecord = purchaseRecords.find((record) => record.orderNo === orderNo);
        if (savedRecord && !purchaseOrderMatches(order, savedRecord.request)) throw new Error('purchase_mismatch');
        if (!pricing.valid(order)) throw new Error('unconfirmed_order');
        const completed = order.fulfillment_status === 'closed';
        const incomingSync = !completed && paymentSync && ['received', 'unavailable'].includes(paymentSync.state)
            && typeof paymentSync.message === 'string' && paymentSync.message.length <= 300 ? paymentSync : null;
        // A later provider outage or stale pending response cannot make a known
        // receipt payable again while its database reconciliation is pending.
        if (completed) receivedPurchasePayments.delete(orderNo);
        if (incomingSync?.state === 'received') receivedPurchasePayments.set(orderNo, incomingSync);
        else if (!incomingSync && ['paid', 'manual_review'].includes(order.payment_status)) receivedPurchasePayments.delete(orderNo);
        latestPurchasePaymentSync = completed ? null : receivedPurchasePayments.get(orderNo) || incomingSync;
        const received = latestPurchasePaymentSync?.state === 'received';
        const title = document.createElement('strong'); title.textContent = completed ? '订单已完结' : order.fulfillment_status === 'succeeded' ? product.stars ? '星星已到账' : '会员已开通' : `${paymentLabels[order.payment_status]} · ${fulfillmentLabels[order.fulfillment_status]}`;
        const hint = document.createElement('p'); hint.className = completed ? 'tg-completion-note' : 'tg-muted'; hint.textContent = completed ? '管理员已完成处理，此订单的自动发货已停止。' : order.fulfillment_status === 'succeeded' ? product.completed
            : order.payment_status === 'pending' ? '请先保存订单号和查询凭证，再打开支付弹窗。请支付含手续费的完整金额，系统核对到账后更新进度。'
                : order.payment_status === 'cancelled' ? '订单已取消，请勿继续付款。若已转账，请保留订单号联系客服核对。'
                    : '系统会自动核对处理。请勿重复付款，遇到问题请保留订单号联系客服。';
        if (received) title.textContent = '渠道已收款，等待核对';
        if (latestPurchasePaymentSync) hint.textContent = latestPurchasePaymentSync.message;
        const cryptoPending = !completed && order.payment_status === 'pending' && order.payment_channel === 'usdt_bep20';
        if (cryptoPending && !order.crypto_checkout) hint.textContent = '正在核对 USDT 转账信息，请保留订单号与查询凭证，勿重复创建订单。';
        const result = $('tgPurchaseStatusResult'); renderCustomerDetails('purchase', order, product, title, hint);
        purchaseSnapshots.set(orderNo, order);
        rememberPurchaseCryptoSnapshot(savedRecord, order);
        result.hidden = false; fillPurchaseTracking(purchaseTracking);
        latestPurchaseOrder = order;
        purchaseTracking.canClose = !purchaseCancelIntents.has(orderNo) && !received && ['pending', 'expired'].includes(order.payment_status) && order.fulfillment_status === 'not_started';
        $('tgPurchaseClose').hidden = !purchaseTracking.canClose;
        $('tgPurchaseCheckout').hidden = completed || purchaseCancelIntents.has(orderNo) || received || !(order.payment_status === 'pending' && (cryptoPending ? !!order.crypto_checkout : !!safeCheckoutUrl(order.checkout_url)));
        if ($('tgPaymentDialog').open) renderPaymentDialog();
        purchaseTracking.finished = !received && (['succeeded', 'failed', 'manual_review', 'cancelled', 'closed'].includes(order.fulfillment_status)
            || ['expired', 'cancelled', 'failed', 'manual_review'].includes(order.payment_status));
        if (savedRecord) {
            savedRecord.retryable = !received && ['expired', 'cancelled'].includes(order.payment_status) && order.fulfillment_status === 'not_started';
            if (['succeeded', 'closed'].includes(order.fulfillment_status)) savedRecord.completed = true;
            try { persistPurchases(); } catch (_) {}
        }
        if (completed || order.payment_status === 'cancelled') { $('tgPaymentActionMessage').hidden = true; $('tgPaymentActionMessage').textContent = ''; }
        syncPurchasePaymentActions();
        if (order.payment_status === 'cancelled' && purchaseCancelIntents.has(orderNo)) {
            if (returnAfterCancellation) returnToPurchaseWorkspaceAfterCancellation(orderNo);
            else { title.textContent = '订单已关闭'; purchaseCancelIntents.delete(orderNo); try { persistCancelIntents(); } catch (_) {} }
        }
    }
    function persistCancelIntents() {
        const saved = JSON.stringify([...purchaseCancelIntents].slice(-60));
        globalScope.sessionStorage.setItem(CANCEL_INTENTS_KEY, saved);
        if (globalScope.sessionStorage.getItem(CANCEL_INTENTS_KEY) !== saved) throw new Error('storage_unavailable');
    }
    function returnToPurchaseWorkspaceAfterCancellation(orderNo) {
        paymentReturnToOrders = false; closeOrderDetails();
        stopPurchasePolling();
        clearPaymentExpiry();
        if ($('tgPaymentDialog').open) $('tgPaymentDialog').close();
        latestPurchaseOrder = null;
        purchaseTracking = null;
        paymentDialogView = null;
        $('tgPaymentContent').replaceChildren();
        $('tgPaymentCountdown').hidden = true;
        $('tgPurchaseOrderNo').value = '';
        $('tgPurchaseStatusToken').value = '';
        $('tgPurchaseCopyTracking').hidden = true;
        $('tgPurchaseStatusResult').hidden = true;
        $('tgPurchaseStatusResult').replaceChildren();
        $('tgPurchaseCheckout').hidden = true;
        $('tgPurchaseClose').hidden = true;
        $('tgPaymentActionMessage').hidden = true;
        $('tgPaymentActionMessage').textContent = '';
        purchaseCancelIntents.delete(orderNo);
        try { persistCancelIntents(); } catch (_) {}
        resetPurchaseQuote();
        setOrderLookupOpen(false, serviceMode);
        setMessage($('tgPurchaseMessage'), '订单已取消，可以重新选择商品并创建新订单。', 'success');
        syncLookupBadge();
        updatePurchaseProduct();
    }
    async function cancelPurchaseOrder(returnToWorkspace = true) {
        if (purchaseCancelBusy || purchaseQueryBusy || !purchaseTracking || !['pending', 'expired'].includes(latestPurchaseOrder?.payment_status)) return;
        returnAfterCancellation = returnToWorkspace;
        const { orderNo, statusToken, queryCredential } = purchaseTracking;
        // Remember intent before sending: a timeout/reload must not bring back
        // a still-payable QR while the original cancellation may be completing.
        purchaseCancelIntents.add(orderNo);
        try {
            persistCancelIntents();
        } catch (_) {
            const message = $('tgPaymentActionMessage'); message.hidden = false;
            message.textContent = '浏览器无法保存取消状态，请允许当前标签页存储后重试。尚未发送取消请求。'; return;
        }
        stopPurchasePolling(); const version = ++purchaseQueryVersion;
        purchaseCancelBusy = true; invalidatePurchasePayment(); syncPurchasePaymentActions();
        const message = $('tgPaymentActionMessage'); message.hidden = false; message.textContent = '正在核对渠道并取消订单，请勿付款…';
        let confirmed = false; let failureMessage = '';
        try {
            const { response, data } = await request('/api/tg/purchase/cancel', {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...queryAccessHeaders(statusToken, queryCredential) }, body: JSON.stringify({ order_no: orderNo })
            });
            if (version !== purchaseQueryVersion) return;
            if (!response.ok || data.success !== true) throw Object.assign(new Error(text(data.message) || '取消结果暂未确认，请查询原订单，勿继续付款。'), { cancelMessage: true });
            if (data.order?.payment_status !== 'cancelled') throw new Error('取消结果暂未确认，请查询原订单，勿继续付款。');
            syncPaymentClock(data); applyPurchaseStatus(data.order, orderNo); confirmed = true;
            message.hidden = true; message.textContent = '';
        } catch (error) {
            if (version !== purchaseQueryVersion) return;
            message.textContent = error.cancelMessage ? error.message : '取消结果暂未确认，请查询原订单或重试取消，勿继续付款。';
            failureMessage = message.textContent;
        } finally {
            purchaseCancelBusy = false; syncPurchasePaymentActions();
            // Lost cancellation replies recover the same order; never create a
            // replacement or assume cancellation solely from the button click.
            if (!confirmed && version === purchaseQueryVersion) {
                const recovered = await queryPurchaseStatus(orderNo, statusToken, false, queryCredential);
                confirmed = recovered?.payment_status === 'cancelled';
            }
        }
        return { confirmed, message: failureMessage };
    }
    async function queryPurchaseStatus(orderNo = text($('tgPurchaseOrderNo').value), statusToken = text($('tgPurchaseStatusToken').value), automatic = false, queryCredential = '') {
        if (purchaseCancelBusy) return;
        stopPurchasePolling(); const version = ++purchaseQueryVersion; const result = $('tgPurchaseStatusResult');
        const sameOrder = purchaseTracking?.orderNo === orderNo && purchaseTracking?.statusToken === statusToken && purchaseTracking?.queryCredential === queryCredential;
        if (!sameOrder) { paymentDialogView = null; invalidatePurchasePayment(); $('tgPaymentActionMessage').hidden = true; $('tgPaymentActionMessage').textContent = ''; }
        if (!PURCHASE_ORDER_PATTERN.test(orderNo) || !queryCredential && !TOKEN_PATTERN.test(statusToken)) { purchaseTracking = null; setPurchaseQueryBusy(false); setDetailBusy('purchase', orderNo, false); result.hidden = false; result.textContent = '请输入正确的购买订单号和查询凭证。'; return; }
        purchaseTracking = { orderNo, statusToken, queryCredential, finished: false }; if (!automatic) { purchasePollCount = 0; result.hidden = false; renderCustomerDetails('purchase', {}, null, null, null, true); }
        setPurchaseQueryBusy(true); setDetailBusy('purchase', orderNo, true);
        try {
            const { response, data } = await request(`/api/tg/purchase/status?order_no=${encodeURIComponent(orderNo)}`, { headers: queryAccessHeaders(statusToken, queryCredential) });
            if (version !== purchaseQueryVersion) return;
            if (!response.ok || data.success !== true) { invalidatePurchasePayment(); result.textContent = text(data.message) || '购买订单暂时无法查询。'; if (response.status >= 500 || response.status === 429) schedulePurchasePoll(); return; }
            syncPaymentClock(data);
            applyPurchaseStatus(data.order, orderNo, data.payment_sync);
            schedulePurchasePoll();
            return data.order;
        } catch (error) { if (version !== purchaseQueryVersion) return; invalidatePurchasePayment(); result.hidden = false; result.textContent = error.message === 'purchase_mismatch' ? '订单信息与本次确认内容不一致，已停止显示支付入口。请保留订单号并联系客服核对。' : '购买订单暂未确认，请稍后查询。系统不会再次创建订单。'; schedulePurchasePoll(); }
        finally { if (version === purchaseQueryVersion) { setPurchaseQueryBusy(false); setDetailBusy('purchase', orderNo, false); } }
    }
    async function closePurchase() {
        if (!purchaseTracking?.canClose || purchaseCancelBusy || purchaseQueryBusy || $('tgPurchaseClose').disabled) return;
        if (!globalScope.confirm('确认关闭这笔未付款订单？关闭后请勿继续支付；已经转账的订单请等待核对或联系客服。')) return;
        $('tgPurchaseClose').disabled = true;
        try {
            const outcome = await cancelPurchaseOrder(false);
            if (outcome && !outcome.confirmed) {
                $('tgPurchaseStatusResult').hidden = false;
                $('tgPurchaseStatusResult').textContent = `关闭结果未确认。${outcome.message || '请重新查询原订单，勿继续付款。'}`;
            }
        } finally { $('tgPurchaseClose').disabled = false; }
    }
    async function quotePurchase(event) {
        event.preventDefault(); if (purchaseBusy || catalogState === 'loading') return;
        if (catalogState === 'error') { await loadCatalog(); return; }
        if (!purchaseEnabled || !validSaleProduct(selectedSaleProduct())) return setMessage($('tgPurchaseMessage'), '当前产品暂未开售。', 'error');
        const username = text($('tgPurchaseUsername').value).replace(/^@+/, '').toLowerCase(); const quantity = purchaseQuantity(); const product = selectedSaleProduct(); const channel = $('tgPurchaseChannel').value;
        if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) return setMessage($('tgPurchaseMessage'), '请输入正确的 Telegram 用户名。', 'error');
        if (displayedTotal(product, quantity) === null) return setMessage($('tgPurchaseMessage'), '请输入当前范围内的整数星星数量。', 'error');
        if (!paymentChannels.some((item) => item.id === channel)) return setMessage($('tgPurchaseMessage'), '请选择可用的支付方式。', 'error');
        const version = ++quoteVersion;
        purchaseBusy = true; updatePurchaseProduct(); setMessage($('tgPurchaseMessage'), '正在核对最新售价…');
        try {
            const input = { product_id: product.id, username, channel, ...(channel === 'usdt_bep20' ? { pay_currency: payCurrency } : {}), ...(quantity !== null ? { stars_quantity: quantity } : {}) };
            const { response, data } = await request('/api/tg/purchase/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
            if (version !== quoteVersion) return;
            if (!response.ok || data.success !== true) throw new Error(text(data.message) || '售价暂时无法确认，请稍后再试。');
            const quote = data.quote;
            if (Number.isSafeInteger(quote?.price_version) && quote.price_version > 0 && quote.price_version !== product.price_version) {
                await loadCatalog();
                throw new Error('商品价格已更新，请重新核对最新价格。');
            }
            if (!quote || quote.product_id !== product.id || quote.product_family !== product.product_family || quote.currency !== 'CNY'
                || !productInfo(quote) || !Number.isSafeInteger(quote.total_minor) || quote.total_minor <= 0 || !Number.isSafeInteger(quote.price_version) || quote.price_version < 1
                || quote.price_version !== product.price_version
                || quote.payment_channel !== channel || !pricing.valid(quote, { quote: true }) || quote.subtotal_minor !== displayedTotal(product, quantity)
                || (channel === 'usdt_bep20' && (!pricing.displayCryptoAmount(quote.usdt_pay_amount) || (quote.pay_currency || 'usdtbsc') !== payCurrency))
                || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(quote.quote_id)
                || (quantity !== null ? quote.stars_quantity !== quantity : Number(quote.term_months) !== Number(product.term_months))) throw new Error('订单金额或产品未能确认，请稍后再试。');
            const confirmedRate = marketFxEnabled && validMarketFx(quote.usdt_fx) ? quote.usdt_fx.usdt_per_cny : usdtPerCny;
            if (channel === 'usdt_bep20' && (marketFxEnabled && !validMarketFx(quote.usdt_fx)
                || !pricing.cryptoAmountsEqual(quote.usdt_pay_amount, pricing.usdtPayAmount(quote.total_minor, confirmedRate)))) {
                await loadCatalog();
                throw new Error('USDT 售价已更新，请核对商品页最新金额后重新确认。');
            }
            purchaseQuote = { ...quote, username, channel, ...(channel === 'usdt_bep20' ? { pay_currency: quote.pay_currency || 'usdtbsc' } : {}) };
            purchaseFreshQuote = purchaseQuote;
            renderPurchaseQuoteSummary(purchaseQuote);
            $('tgPurchaseConfirmation').hidden = false; $('tgPurchaseForm').hidden = true; setMessage($('tgPurchaseMessage'), '');
        } catch (error) { if (version === quoteVersion) setMessage($('tgPurchaseMessage'), error.message || '售价核验暂不可用。', 'error'); }
        finally { purchaseBusy = false; updatePurchaseProduct(); }
    }
    async function confirmPurchase() {
        if (purchaseBusy || purchaseCancelBusy || !purchaseQuote) return;
        const quote = purchaseQuote; const version = quoteVersion;
        const additionalOrderNo = purchaseConfirmation.mode === 'additional' ? purchaseConfirmation.orderNo : '';
        purchaseBusy = true; $('tgPurchaseConfirm').disabled = true; $('tgPurchaseCancel').disabled = true;
        syncPurchaseConfirmation();
        $('tgPurchaseConfirm').textContent = '正在创建支付订单…';
        setMessage($('tgPurchaseMessage'), '正在核对订单与支付信息…');
        $('tgPurchaseCheckout').hidden = true;
        let sent = false; let record; let confirmedOrder = null;
        try {
            const quoteCurrency = quote.pay_currency || 'usdtbsc';
            const signature = await fingerprint(`${quote.product_id}:${quote.stars_quantity || ''}:${quote.channel}${quote.channel === 'usdt_bep20' && quoteCurrency !== 'usdtbsc' ? ':' + quoteCurrency : ''}`, quote.username);
            if (version !== quoteVersion) return;
            // A newer unresolved attempt always owns retries, including when its
            // creation response was lost after an explicit additional purchase.
            record = purchaseRecords.slice().reverse().find((item) => item.fingerprint === signature && item.completed !== true && item.retryable !== true);
            if (record?.orderNo) {
                // Persisted pending records may have expired while the tab was
                // closed. Recheck the original before reusing it or issuing a
                // new idempotency key; a timeout never authorizes replacement.
                confirmedOrder = await queryPurchaseStatus(record.orderNo, record.statusToken);
                if (version !== quoteVersion) return;
                if (!confirmedOrder) throw new Error('原订单状态暂未确认，请稍后重试。系统会继续核对原订单，不会重复创建。');
                if (!record.retryable && confirmedOrder.payment_status !== 'paid' && purchaseCancelIntents.has(record.orderNo)) {
                    // The user already requested cancellation. Reopening its
                    // protected, QR-less checkout would look like a new order.
                    // Retry that intent; only server-confirmed terminal state
                    // can permit a new idempotency key.
                    $('tgPurchaseConfirm').textContent = '正在取消原订单…';
                    setMessage($('tgPurchaseMessage'), '正在重试取消原订单，确认取消后才会创建新订单…');
                    const cancellation = await cancelPurchaseOrder();
                    if (!record.retryable) throw new Error(`原订单 ${record.orderNo} 尚未确认取消。${cancellation?.message || '请从订单查询重试取消或联系客服，勿继续付款。'}`);
                }
                if (record.retryable === true || record.completed === true) {
                    stopPurchasePolling();
                    confirmedOrder = null;
                    record = null;
                }
            }
            if (record && confirmedOrder?.payment_status === 'paid') {
                if (additionalOrderNo !== record.orderNo) {
                    // Paid fulfillment remains independently queryable. Never
                    // silently turn an attempt to recover it into another bill.
                    purchaseQuote = purchaseFreshQuote || quote;
                    renderPurchaseQuoteSummary(purchaseQuote);
                    setPurchaseConfirmation('additional', record.orderNo);
                    setMessage($('tgPurchaseMessage'), `原订单 ${record.orderNo} 已付款，${fulfillmentLabels[confirmedOrder.fulfillment_status]}，无需再次付款。可查看原订单；如需另外购买，请核对本次金额后选择“确认另购并创建新订单”。`);
                    return;
                }
                stopPurchasePolling();
                record = null; confirmedOrder = null;
            }
            if (record) setPurchaseConfirmation('recover', record.orderNo);
            if (record && (record.request.expected_total_minor !== quote.total_minor || record.request.price_version !== quote.price_version)) {
                // Unknown results must recover the original request. Show its
                // actual amount before a separate confirmation can replay it.
                purchaseQuote = { ...record.request, total_minor: record.request.expected_total_minor,
                    subtotal_minor: record.request.subtotal_minor ?? record.request.expected_total_minor,
                    payment_fee_minor: record.request.payment_fee_minor ?? 0, payment_fee_rate_bps: record.request.payment_fee_rate_bps ?? 0,
                    usdt_pay_amount: confirmedOrder?.crypto_checkout?.pay_amount || record.request.usdt_pay_amount };
                renderPurchaseQuoteSummary(purchaseQuote, { original: true });
                setMessage($('tgPurchaseMessage'), '检测到尚未完成的原订单。请核对上方原订单金额，再次确认将查询或恢复原请求，不会新建订单。');
                return;
            }
            // Passwords are collected for this POST only, never put into the
            // persistent request/recovery record or a URL.
            let queryCredentials = {};
            if (!record?.orderNo) {
                try { queryCredentials = orderQuery?.creationCredentials('purchase') || {}; }
                catch (error) { setMessage($('tgPurchaseMessage'), error.message, 'error'); return; }
            }
            if (record?.queryEmail && !record.orderNo && record.queryEmail !== queryCredentials.query_email) throw new Error('原订单创建结果尚未确认，请使用原查询邮箱和查询密码重试。');
            if (!record) {
                if (purchaseRecords.length >= 30) throw new Error('本标签页订单较多，请先查询已有订单或联系客服。');
                record = { fingerprint: signature, statusToken: randomToken(), idempotencyKey: `tg_buy_${randomToken()}`, orderNo: '', request: { product_id: quote.product_id, quote_id: quote.quote_id, product_family: quote.product_family, term_months: quote.term_months ?? null, stars_quantity: quote.stars_quantity ?? null, username: quote.username, channel: quote.channel, expected_total_minor: quote.total_minor, subtotal_minor: quote.subtotal_minor, payment_fee_minor: quote.payment_fee_minor, payment_fee_rate_bps: quote.payment_fee_rate_bps, price_version: quote.price_version, ...(quote.channel === 'usdt_bep20' ? { usdt_pay_amount: quote.usdt_pay_amount, pay_currency: quote.pay_currency || 'usdtbsc' } : {}) } };
                purchaseRecords.push(record);
            }
            if (queryCredentials.query_email) record.queryEmail = queryCredentials.query_email;
            $('tgPurchaseConfirm').textContent = '正在创建支付订单…';
            persistPurchases();
            if (!record.orderNo) {
                sent = true;
                const { response, data } = await request('/api/tg/purchase/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': record.idempotencyKey }, body: JSON.stringify({ ...record.request, status_token: record.statusToken, idempotency_key: record.idempotencyKey, ...queryCredentials }) });
                if (!response.ok || data.success !== true) {
                    const rejection = new Error(text(data.message) || '订单结果暂未确认，请保留当前页面稍后重试。');
                    rejection.confirmedQuoteRejection = response.status === 409 && data.success === false && !data.order
                        && ['quote_expired', 'quote_stale', 'quote_conflict', 'quote_mismatch', 'price_changed', 'price_version_conflict'].includes(data.code);
                    throw rejection;
                }
                if (!PURCHASE_ORDER_PATTERN.test(data.order?.order_no) || data.status_token && data.status_token !== record.statusToken) throw new Error('订单结果暂未确认，请保留当前页面稍后重试。');
                record.orderNo = data.order.order_no; persistPurchases();
                orderQuery?.rememberCreation(queryCredentials);
                if (!purchaseOrderMatches(data.order, record.request)) throw new Error('服务器返回的订单信息与已确认内容不一致');
            }
            fillPurchaseTracking(record);
            if (!confirmedOrder) confirmedOrder = await queryPurchaseStatus(record.orderNo, record.statusToken);
            if (confirmedOrder?.payment_status === 'pending' && quote.channel === 'usdt_bep20' && confirmedOrder.crypto_checkout
                && !pricing.cryptoAmountsEqual(quote.usdt_pay_amount, confirmedOrder.crypto_checkout.pay_amount)) {
                purchaseQuote = { ...record.request, total_minor: confirmedOrder.total_minor, usdt_pay_amount: confirmedOrder.crypto_checkout.pay_amount };
                renderPurchaseQuoteSummary(purchaseQuote, { original: true });
                $('tgPurchaseConfirmation').hidden = false; $('tgPurchaseForm').hidden = true;
                setMessage($('tgPurchaseMessage'), `原订单 ${record.orderNo} 的 USDT 金额与当前售价不同。请核对上方原单实际金额，再次确认后继续；不会重复创建订单。`);
                return;
            }
            purchaseQuote = null; purchaseFreshQuote = null; setPurchaseConfirmation(); $('tgPurchaseConfirmation').hidden = true; $('tgPurchaseForm').hidden = false;
            setOrderLookupOpen(false, serviceMode);
            if (confirmedOrder && latestPurchaseOrder) {
                setMessage($('tgPurchaseMessage'), confirmedOrder.payment_status === 'paid' ? '订单已付款，无需再次付款。请保存订单查询凭证，查看发货进度。' : '请保存订单查询凭证，并按支付弹窗中的完整金额付款。', 'success');
                openPaymentDialog();
            } else setMessage($('tgPurchaseMessage'), '订单已保存，支付状态暂未确认。请稍后重试或从订单查询核对原订单，勿重复付款。', 'error');
        } catch (error) {
            const result = $('tgPurchaseStatusResult'); result.hidden = false;
            if (error.confirmedQuoteRejection === true) {
                if (record) { record.retryable = true; try { persistPurchases(); } catch (_) {} }
                purchaseQuote = null; purchaseFreshQuote = null; setPurchaseConfirmation(); $('tgPurchaseConfirmation').hidden = true; $('tgPurchaseForm').hidden = false;
                await loadCatalog();
                setMessage($('tgPurchaseMessage'), '价格或报价已更新，请重新核对最新价格后继续。', 'error');
                result.textContent = '旧报价已失效，未创建订单。请重新核对价格。';
            } else {
                if (record) setPurchaseConfirmation('recover', record.orderNo);
                if (record?.orderNo) fillPurchaseTracking(record);
                result.textContent = sent ? `${error.message || '订单结果暂未确认'} 请勿重新付款；在当前页面重试会核对原订单。` : `${error.message || '浏览器无法安全保存订单凭证'} 尚未创建新订单。`;
                setMessage($('tgPurchaseMessage'), result.textContent, 'error');
            }
        } finally { purchaseBusy = false; $('tgPurchaseConfirm').disabled = false; syncPurchaseConfirmation(); $('tgPurchaseCancel').disabled = false; updatePurchaseProduct(); }
    }
    $('tgRedeemForm')?.addEventListener('submit', postRedeem);
    $('tgModePurchase')?.addEventListener('click', () => setServiceMode('purchase'));
    $('tgModeRedeem')?.addEventListener('click', () => setServiceMode('redeem'));
    $('tgOrderLookupToggle')?.addEventListener('click', (event) => {
        event?.preventDefault?.();
        setOrderLookupOpen(true, lookupOpen ? lookupTab : (serviceMode === 'redeem' ? 'redeem' : 'purchase'));
    });
    $('tgOrderLookupBack')?.addEventListener('click', (event) => {
        event?.preventDefault?.();
        setOrderLookupOpen(false);
    });
    $('tgBrandHome')?.addEventListener('click', (event) => {
        if (lookupOpen) {
            event?.preventDefault?.();
            setOrderLookupOpen(false);
        }
    });
    $('tgLookupTabPurchase')?.addEventListener('click', () => {
        setLookupTab('purchase');
        if (lookupOpen) syncUrlWithSubpage(true, 'purchase');
    });
    $('tgLookupTabRedeem')?.addEventListener('click', () => {
        setLookupTab('redeem');
        if (lookupOpen) syncUrlWithSubpage(true, 'redeem');
    });
    globalScope.addEventListener('popstate', () => {
        try {
            const url = new globalScope.URL(globalScope.location.href);
            const isOrders = url.searchParams.get('view') === 'orders';
            const tab = url.searchParams.get('tab') === 'redeem' ? 'redeem' : (serviceMode === 'redeem' ? 'redeem' : 'purchase');
            setOrderLookupOpen(isOrders, tab, { pushHistory: false });
        } catch (_) {}
    });
    $('tgPurchaseProduct')?.addEventListener('change', () => { resetPurchaseQuote(); updatePurchaseProduct(); });
    $('tgPurchaseStars')?.addEventListener('input', () => { resetPurchaseQuote(); updatePurchaseProduct(); });
    for (const preset of STARS_PRESETS) {
        $(`tgStarsPreset-${preset}`)?.addEventListener('click', () => {
            if ($('tgPurchaseStars').disabled) return;
            $('tgPurchaseStars').value = String(preset);
            resetPurchaseQuote();
            updatePurchaseProduct();
        });
    }
    const stepStars = (delta) => {
        if ($('tgPurchaseStars').disabled) return;
        const bounds = starsBounds(selectedSaleProduct());
        const current = Number($('tgPurchaseStars').value);
        const base = Number.isFinite(current) ? Math.trunc(current) : bounds.min;
        const next = Math.min(bounds.max, Math.max(bounds.min, base + delta));
        $('tgPurchaseStars').value = String(next);
        resetPurchaseQuote();
        updatePurchaseProduct();
    };
    $('tgStarsStepUp')?.addEventListener('click', () => stepStars(50));
    $('tgStarsStepDown')?.addEventListener('click', () => stepStars(-50));
    $('tgPurchaseUsername')?.addEventListener('input', () => { resetPurchaseQuote(); queueRecipientPreview('tgPurchaseUsername', 'tgPurchaseRecipient'); });
    $('tgPurchaseUsername')?.addEventListener('blur', () => queueRecipientPreview('tgPurchaseUsername', 'tgPurchaseRecipient', true));
    $('tgUsername')?.addEventListener('input', () => { clearRedeemPreview(); queueRecipientPreview('tgUsername', 'tgRedeemRecipient'); });
    $('tgCode')?.addEventListener('input', clearRedeemPreview);
    $('tgUsername')?.addEventListener('blur', () => queueRecipientPreview('tgUsername', 'tgRedeemRecipient', true));
    $('tgCode')?.addEventListener('input', () => queueGiftPreview());
    $('tgCode')?.addEventListener('blur', () => queueGiftPreview(true));
    $('tgPurchaseForm')?.addEventListener('submit', quotePurchase);
    $('tgPurchaseConfirm')?.addEventListener('click', confirmPurchase);
    $('tgPurchaseViewOriginal')?.addEventListener('click', () => {
        const record = purchaseRecords.find(item => item.orderNo === purchaseConfirmation.orderNo);
        return viewSavedPurchase(record);
    });
    $('tgPurchaseCheckout')?.addEventListener('click', openPaymentDialog);
    $('tgPaymentClose')?.addEventListener('click', closePaymentDialog);
    $('tgPaymentDialog')?.addEventListener('close', paymentDialogClosed);
    $('tgPaymentRefresh')?.addEventListener('click', () => purchaseTracking ? queryPurchaseStatus(purchaseTracking.orderNo, purchaseTracking.statusToken, false, purchaseTracking.queryCredential) : queryPurchaseStatus());
    $('tgPaymentCancelOrder')?.addEventListener('click', () => cancelPurchaseOrder());
    $('tgPurchaseCancel')?.addEventListener('click', resetPurchaseQuote);
    $('tgPurchaseClose')?.addEventListener('click', closePurchase);
    $('tgPurchaseStatusForm')?.addEventListener('submit', (event) => { event.preventDefault(); return openOrderDetails('purchase', text($('tgPurchaseOrderNo').value).toUpperCase(), text($('tgPurchaseStatusToken').value), '', true); });
    $('tgPurchaseChannel')?.addEventListener('change', () => { resetPurchaseQuote(); updatePurchaseProduct(); });
    $('tgPurchaseCopyTracking')?.addEventListener('click', async () => {
        try {
            const orderNo = text($('tgPurchaseOrderNo').value); const statusToken = text($('tgPurchaseStatusToken').value);
            if (!PURCHASE_ORDER_PATTERN.test(orderNo) || !TOKEN_PATTERN.test(statusToken)) return;
            await globalScope.navigator.clipboard.writeText(`Telegram 购买订单\n订单号：${orderNo}\n查询凭证：${statusToken}`);
            $('tgPurchaseCopyTracking').textContent = '已复制，请保存到安全位置';
        } catch (_) { $('tgPurchaseCopyTracking').textContent = '复制失败，请手动保存订单号和查询凭证'; }
    });
    $('tgStatusForm')?.addEventListener('submit', (event) => { event.preventDefault(); return openOrderDetails('redeem', text($('tgOrderNo').value).toUpperCase(), text($('tgStatusToken').value), '', true); });
    $('tgCopyTracking')?.addEventListener('click', async () => {
        try {
            const orderNo = text($('tgOrderNo').value);
            const statusToken = text($('tgStatusToken').value);
            if (!ORDER_PATTERN.test(orderNo) || !TOKEN_PATTERN.test(statusToken)) return;
            await globalScope.navigator.clipboard.writeText(`Telegram 兑换订单\n订单号：${orderNo}\n查询凭证：${statusToken}`);
            $('tgCopyTracking').textContent = '已复制，请保存到安全位置';
        } catch (_) { $('tgCopyTracking').textContent = '复制失败，请手动保存订单号和查询凭证'; }
    });
    $('tgOrdersSearchBy')?.addEventListener('change', setOrderQueryMethod);
    $('tgOrdersClear')?.addEventListener('click', () => {
        rememberQueryCleared(true);
        queryVersion++; purchaseQueryVersion++; stopPolling(); stopPurchasePolling();
        tracking = null; purchaseTracking = null; invalidatePurchasePayment(); setPurchaseQueryBusy(false);
        for (const id of ['tgOrderNo', 'tgStatusToken', 'tgPurchaseOrderNo', 'tgPurchaseStatusToken']) $(id).value = '';
        $('tgLegacyOrdersResults').hidden = true; $('tgLegacyOrdersList').replaceChildren();
        closeOrderDetails(); syncLookupBadge();
    });
    for (const [kind, ids] of [['purchase', ['tgPurchaseOrderNo', 'tgPurchaseStatusToken']], ['redeem', ['tgOrderNo', 'tgStatusToken']]]) {
        for (const id of ids) $(id).addEventListener('input', () => {
            $('tgLegacyOrdersResults').hidden = true;
            if (kind === 'purchase' && !purchaseTracking?.queryCredential) { purchaseQueryVersion++; stopPurchasePolling(); purchaseTracking = null; invalidatePurchasePayment(); setPurchaseQueryBusy(false); }
            if (kind === 'redeem' && !tracking?.queryCredential) { queryVersion++; stopPolling(); tracking = null; }
            closeOrderDetails(); syncLookupBadge();
        });
    }
    $('tgOrderDetailClose')?.addEventListener('click', closeOrderDetails);
    $('tgOrderDetailDialog')?.addEventListener('close', orderDetailsClosed);
    $('tgOrderDetailDialog')?.addEventListener('cancel', event => { event.preventDefault(); closeOrderDetails(); });
    $('tgOrderDetailRefresh')?.addEventListener('click', () => {
        const view = orderDetailView;
        if (!view || $('tgOrderDetailRefresh').disabled) return;
        return view.kind === 'purchase' ? queryPurchaseStatus(view.orderNo, view.statusToken, false, view.queryCredential) : queryStatus(view.orderNo, view.statusToken, false, view.queryCredential);
    });
    let detailBackdropPressed = false;
    const outsideOrderDetail = event => {
        const dialog = $('tgOrderDetailDialog');
        if (event.target !== dialog) return false;
        const rect = dialog.getBoundingClientRect();
        return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    };
    $('tgOrderDetailDialog')?.addEventListener('pointerdown', event => { detailBackdropPressed = event.button === 0 && outsideOrderDetail(event); });
    $('tgOrderDetailDialog')?.addEventListener('pointercancel', () => { detailBackdropPressed = false; });
    $('tgOrderDetailDialog')?.addEventListener('click', event => {
        if (detailBackdropPressed && outsideOrderDetail(event)) closeOrderDetails();
        detailBackdropPressed = false;
    });
    document.addEventListener('visibilitychange', () => {
        scheduleFxCatalogRefresh();
        if (document.hidden) stopPolling();
        else if (tracking && activeStatuses.has(tracking.status)) schedulePoll();
        if (document.hidden) stopPurchasePolling();
        else if (purchaseTracking && !purchaseTracking.finished) schedulePurchasePoll();
        if (document.hidden) clearPaymentExpiry();
        if (!document.hidden && $('tgPaymentDialog').open) renderPaymentDialog();
    });
    globalScope.addEventListener('pageshow', () => {
        if (!queryCleared) return;
        for (const id of ['tgOrderNo', 'tgStatusToken', 'tgPurchaseOrderNo', 'tgPurchaseStatusToken']) $(id).value = '';
        syncLookupBadge();
    });
    globalScope.addEventListener('pagehide', () => {
        if (fxCatalogTimer !== null) globalScope.clearTimeout(fxCatalogTimer);
        fxCatalogTimer = null;
        stopPolling(); stopPurchasePolling(); clearPaymentExpiry();
        orderQuery?.dispose();
        if (tracking?.queryCredential) tracking = null;
        if (purchaseTracking?.queryCredential) purchaseTracking = null;
        for (const state of recipientStates.values()) { state.version += 1; if (state.timer !== null) globalScope.clearTimeout(state.timer); state.controller?.abort(); }
    });
    $('tgPremiumPreview')?.addEventListener('click', () => previewProduct('telegram_premium'));
    $('tgStarsPreview')?.addEventListener('click', () => previewProduct('telegram_stars'));
    orderQuery = globalScope.TgOrderQuery?.create({
        request,
        async onOpen(order, queryCredential, kind) {
            return openOrderDetails(kind, order.order_no, '', queryCredential);
        },
        onClear() {
            closeOrderDetails();
            // Invalidate pending replies as well as polling so changing query
            // credentials cannot restore an earlier account's details or QR.
            if (tracking?.queryCredential) { queryVersion++; stopPolling(); tracking = null; $('tgStatusResult').hidden = true; $('tgOrderNo').value = ''; $('tgStatusToken').value = ''; $('tgCopyTracking').hidden = true; }
            if (purchaseTracking?.queryCredential) {
                purchaseQueryVersion++; stopPurchasePolling(); purchaseTracking = null;
                invalidatePurchasePayment(); setPurchaseQueryBusy(false);
                $('tgPurchaseStatusResult').hidden = true; $('tgPurchaseOrderNo').value = ''; $('tgPurchaseStatusToken').value = ''; $('tgPurchaseCopyTracking').hidden = true;
                if ($('tgPaymentDialog').open) closePaymentDialog();
            }
        }
    }) || null;
    setOrderQueryMethod();
    restoreRecords();
    const latestOrder = records.filter((record) => record.orderNo).at(-1);
    if (latestOrder && !queryCleared) { fillTracking(latestOrder); queryStatus(latestOrder.orderNo, latestOrder.statusToken); }
    restorePurchases();
    renderRecentPurchases();
    const latestPurchase = purchaseRecords.filter((record) => record.orderNo).at(-1);
    if (latestPurchase && !queryCleared) { fillPurchaseTracking(latestPurchase); queryPurchaseStatus(latestPurchase.orderNo, latestPurchase.statusToken); }
    setServiceMode('purchase');
    setOrderLookupOpen(false, 'purchase', { pushHistory: false });
    try {
        if (globalScope.location?.href) {
            const initUrl = new globalScope.URL(globalScope.location.href);
            if (initUrl.searchParams.get('view') === 'orders') {
                const initTab = initUrl.searchParams.get('tab') === 'redeem' ? 'redeem' : 'purchase';
                setOrderLookupOpen(true, initTab, { pushHistory: false });
            }
        }
    } catch (_) {}
    loadCatalog();
})(window);
