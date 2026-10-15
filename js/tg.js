(function initTelegramRedeemPage(globalScope) {
    'use strict';
    const document = globalScope.document;
    const $ = (id) => document.getElementById(id);
    const text = (value) => String(value ?? '').trim();
    const STORAGE_KEY = 'tg.premium.attempts.v1';
    const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
    const ORDER_PATTERN = /^TG-[A-Z0-9]{12,24}$/;
    const labels = { pending: '等待处理', processing: '正在开通', retry_waiting: '等待官方确认', succeeded: '开通完成', failed: '处理失败，请联系客服', manual_review: '正在人工复核，请勿重复兑换', cancelled: '订单已取消' };
    const activeStatuses = new Set(['pending', 'processing', 'retry_waiting']);
    let redemptionEnabled = false;
    let submitting = false;
    let tracking = null;
    let pollTimer = null;
    let pollCount = 0;
    let queryVersion = 0;
    let records = [];
    const PURCHASE_STORAGE_KEY = 'tg.purchase.attempts.v1';
    const PURCHASE_ORDER_PATTERN = /^TGP-[A-Z0-9]{20}$/;
    const paymentLabels = { pending: '等待付款', paid: '已付款', expired: '支付已过期', cancelled: '支付已取消', failed: '支付未完成', manual_review: '支付待人工核对' };
    const fulfillmentLabels = { not_started: '等待付款后处理', pending: '等待发货', processing: '正在处理', retry_waiting: '等待官方确认', succeeded: '发货完成', failed: '处理失败，请联系客服', manual_review: '正在人工复核', cancelled: '已取消' };
    let purchaseEnabled = false;
    let saleProducts = [];
    let paymentChannels = [];
    let selectedFamily = 'telegram_premium';
    let serviceMode = 'purchase';
    let purchaseBusy = false;
    let purchaseQuote = null;
    let purchaseRecords = [];
    let purchaseTracking = null;
    let purchaseTimer = null;
    let purchasePollCount = 0;
    let purchaseQueryVersion = 0;
    let quoteVersion = 0;
    const channelLabels = { alipay: '支付宝', wxpay: '微信支付', usdt_bep20: 'USDT · BSC（BEP20）' };
    const channelSubtitles = { alipay: '即时到账 · 推荐', wxpay: '微信扫码支付', usdt_bep20: '链上确认 · 0 手续费加价' };
    const STARS_PRESETS = [100, 500, 1000, 5000, 10000, 50000];
    const recipientStates = new Map();
    const recipientBoxIds = { tgPurchaseUsername: 'tgPurchaseUsernameBox', tgUsername: 'tgRedeemUsernameBox' };
    const recipientHintIds = { tgPurchaseUsername: 'tgPurchaseUsernameHint', tgUsername: 'tgRedeemUsernameHint' };

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

            const topRow = document.createElement('span');
            topRow.className = 'tg-option-card-head';
            const title = document.createElement('strong');
            title.className = 'tg-option-card-title';
            title.textContent = `${months} 个月`;
            const indicator = document.createElement('span');
            indicator.className = 'tg-option-radio';
            indicator.textContent = isSelected ? '✓' : '';
            topRow.replaceChildren(title, indicator);

            const priceEl = document.createElement('span');
            priceEl.className = 'tg-option-card-price';
            priceEl.textContent = priced ? money(product.price_minor) : '待公布';

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
        if (!paymentChannels.length) {
            const empty = document.createElement('div');
            empty.className = 'tg-option-empty';
            empty.textContent = '支付方式暂未开放';
            container.replaceChildren(empty);
            return;
        }
        const cards = paymentChannels.map((channel) => {
            const id = channel.id;
            const isSelected = currentChannel === id;
            const card = document.createElement('button');
            card.type = 'button';
            card.className = `tg-option-card tg-channel-card tg-channel-${id}${isSelected ? ' is-selected' : ''}`;
            card.setAttribute('aria-pressed', String(isSelected));

            const iconBadge = document.createElement('span');
            iconBadge.className = `tg-channel-icon is-${id}`;
            iconBadge.textContent = id === 'alipay' ? '支' : id === 'wxpay' ? '微' : '₮';

            const info = document.createElement('span');
            info.className = 'tg-channel-info';
            const title = document.createElement('strong');
            title.className = 'tg-option-card-title';
            title.textContent = channelLabels[id] || id;
            const sub = document.createElement('small');
            sub.className = 'tg-option-card-meta';
            sub.textContent = channelSubtitles[id] || '安全支付';
            info.replaceChildren(title, sub);

            const indicator = document.createElement('span');
            indicator.className = 'tg-option-radio';
            indicator.textContent = isSelected ? '✓' : '';

            card.replaceChildren(iconBadge, info, indicator);
            card.addEventListener('click', () => {
                if ($('tgPurchaseChannel').value !== id) {
                    $('tgPurchaseChannel').value = id;
                    resetPurchaseQuote();
                    updatePurchaseProduct();
                }
            });
            return card;
        });
        container.replaceChildren(...cards);
    }

    function updatePurchaseProduct() {
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
        const price = $('tgPurchasePrice');
        if (!pricedSaleProduct(product)) price.textContent = '价格暂未公布';
        else if (total === null) { const { min, max } = starsBounds(product); price.textContent = `请输入 ${min.toLocaleString('zh-CN')} 至 ${max.toLocaleString('zh-CN')} 之间的整数星星数量`; }
        else {
            const label = document.createElement('span'); label.className = 'tg-price-label'; label.textContent = '总计：';
            const amount = document.createElement('strong'); amount.className = 'tg-price-amount'; amount.textContent = money(total);
            const detail = document.createElement('small');
            detail.textContent = stars
                ? `${purchaseQuantity().toLocaleString('zh-CN')} 颗 · 每颗 ¥${(product.unit_price_micros / 1000000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
                : `Premium ${product.term_months} 个月`;
            if (!product.enabled) detail.textContent += ' · 暂未开售';
            if ($('tgPurchaseChannel').value === 'usdt_bep20') detail.textContent += ' · USDT 转账金额将在创建订单后锁定';
            price.replaceChildren(label, amount, detail);
        }
        const bounds = starsBounds(product); $('tgPurchaseStars').min = String(bounds.min); $('tgPurchaseStars').max = String(bounds.max);
        const rangeHint = $('tgStarsRangeHint');
        if (rangeHint) rangeHint.textContent = `${bounds.min.toLocaleString('zh-CN')} — ${bounds.max.toLocaleString('zh-CN')}`;
        $('tgPurchaseButton').disabled = purchaseBusy || !purchaseEnabled || !valid || total === null || !paymentChannels.length;
        $('tgPurchaseButton').textContent = purchaseBusy ? '正在核对订单…' : purchaseEnabled && valid ? '核对订单与金额 →' : '购买服务暂未开放';
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
        $('tgLookupTabPurchase')?.setAttribute('aria-pressed', String(buying));
        $('tgLookupTabRedeem')?.setAttribute('aria-pressed', String(!buying));
        $('tgPurchaseStatusPanel').hidden = !buying;
        $('tgRedeemStatusPanel').hidden = buying;
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
        quoteVersion += 1; purchaseQuote = null;
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
        $('tgProductDescription').textContent = serviceMode === 'purchase'
            ? stars ? '选择所需 Stars 星星数量，付款确认后自动发放至指定 Telegram 用户名。' : '选择 3、6 或 12 个月 Premium 会员，付款确认后自动处理。'
            : stars
            ? '领取 Telegram Stars 星星，到账数量以兑换码绑定的权益为准。无需提供账号密码。'
            : '开通 Telegram Premium，时长以兑换码绑定的 3、6 或 12 个月套餐为准。';
        updatePurchaseProduct();
        if (changed) {
            const slideCls = stars ? 'tg-product-slide-right' : 'tg-product-slide-left';
            const targets = [
                $('tgProductDescription'),
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
        $('tgRedeemButton').textContent = submitting ? '正在提交…' : redemptionEnabled ? '立即兑换 →' : '兑换服务暂未开放';
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
        pollTimer = globalScope.setTimeout(() => { pollCount += 1; queryStatus(tracking.orderNo, tracking.statusToken, true); }, pollCount < 6 ? 5000 : 15000);
    }
    function fillTracking(record) {
        $('tgOrderNo').value = record.orderNo;
        $('tgStatusToken').value = record.statusToken;
        $('tgCopyTracking').hidden = false;
        syncLookupBadge();
    }
    function renderStatus(data, product) {
        const result = $('tgStatusResult');
        const title = document.createElement('strong');
        title.textContent = product.stars && data.status === 'succeeded' ? '星星已到账'
            : product.stars && data.status === 'processing' ? '正在发放星星' : labels[data.status] || '状态待确认';
        const details = document.createElement('p');
        details.textContent = `${data.order_no} · @${text(data.username) || '—'} · ${product.label}`;
        const hint = document.createElement('p');
        hint.className = 'tg-muted';
        hint.textContent = data.status === 'succeeded' ? product.completed
            : activeStatuses.has(data.status) ? '系统会自动更新进度，可稍后使用订单号与凭证查询。'
                : '请保留订单号联系客服，我们会核对处理结果。';
        result.replaceChildren(title, details, hint);
        result.hidden = false;
    }
    async function queryStatus(orderNo = text($('tgOrderNo').value), statusToken = text($('tgStatusToken').value), automatic = false) {
        const result = $('tgStatusResult');
        stopPolling();
        const version = ++queryVersion;
        if (!ORDER_PATTERN.test(orderNo) || !TOKEN_PATTERN.test(statusToken)) {
            tracking = null;
            result.hidden = false;
            result.textContent = '请输入正确的订单号和查询凭证。';
            return;
        }
        if (!automatic) {
            pollCount = 0;
            result.hidden = false;
            result.textContent = '正在查询…';
        }
        tracking = { orderNo, statusToken, status: tracking?.orderNo === orderNo ? tracking.status : 'pending' };
        try {
            const { response, data } = await request(`/api/tg/status?order_no=${encodeURIComponent(orderNo)}`, { headers: { 'X-TG-Status-Token': statusToken } });
            if (version !== queryVersion) return;
            if (!response.ok || data.success !== true) {
                result.textContent = text(data.message) || '订单查询失败，请稍后重试。';
                // Invalid credentials and permanent failures must not keep polling.
                if (response.status >= 500 || response.status === 429) schedulePoll();
                return;
            }
            if (data.order_no !== orderNo || !Object.hasOwn(labels, data.status)) throw new Error('unconfirmed_response');
            const product = productInfo(data);
            if (!product) { tracking = null; throw new Error('unconfirmed_product'); }
            tracking.status = data.status;
            fillTracking(tracking);
            renderStatus(data, product);
            schedulePoll();
        } catch (error) {
            if (version !== queryVersion) return;
            result.hidden = false;
            result.textContent = error.message === 'unconfirmed_product' ? '订单权益尚未确认，请保留订单号联系客服。' : '暂时无法查询，订单不会重复提交。请稍后再查询。';
            schedulePoll();
        }
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
        submitting = true;
        syncButton();
        let record;
        let sent = false;
        try {
            const digest = await fingerprint(code, username);
            record = records.find((item) => item.fingerprint === digest);
            if (!record) {
                if (records.length >= 30) throw new Error('attempt_limit');
                record = { fingerprint: digest, username, statusToken: randomToken(), idempotencyKey: `tg_${randomToken()}`, orderNo: '', savedAt: Date.now() };
                records.push(record);
            }
            // Persist before sending: a lost response or reload must reuse the
            // same credentials. The plaintext redemption code is never stored.
            persistRecords();
            setMessage(message, '正在安全提交兑换请求…');
            sent = true;
            const { response, data } = await request('/api/tg/redeem', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': record.idempotencyKey },
                body: JSON.stringify({ code, username, status_token: record.statusToken, idempotency_key: record.idempotencyKey })
            });
            if (!response.ok || data.success !== true) {
                setMessage(message, text(data.message) || '兑换请求暂未确认，请保留原兑换码稍后重试。', 'error');
                return;
            }
            if (!ORDER_PATTERN.test(data.order_no) || !Object.hasOwn(labels, data.status) || (data.status_token && data.status_token !== record.statusToken)) throw new Error('unconfirmed_response');
            record.orderNo = data.order_no;
            try { persistRecords(); } catch (_) { /* Credentials were saved before submission and remain in memory. */ }
            fillTracking(record);
            $('tgCode').value = '';
            setMessage(message, '兑换请求已受理。请保存订单号和查询凭证。', 'success');
            setOrderLookupOpen(true, 'redeem');
            await queryStatus(record.orderNo, record.statusToken);
        } catch (error) {
            const description = sent ? '请求结果暂未确认。请保留原兑换码、用户名，在当前标签页重试，系统会核对原请求。'
                : error.message === 'attempt_limit' ? '当前标签页提交记录较多，请先查询已有订单或联系客服。'
                    : '浏览器暂不支持安全保存兑换凭证，请使用 HTTPS 或本地预览，并允许当前标签页存储。尚未提交兑换。';
            setMessage(message, description, 'error');
        } finally { submitting = false; syncButton(); }
    }
    async function loadCatalog() {
        try {
            const { response, data } = await request('/api/tg/catalog');
            redemptionEnabled = response.ok && data.success === true && data.redemption_enabled === true;
            purchaseEnabled = response.ok && data.success === true && data.purchase_enabled === true && data.currency === 'CNY';
            saleProducts = Array.isArray(data.sale_products) ? data.sale_products : [];
            paymentChannels = (Array.isArray(data.payment_channels) ? data.payment_channels : []).filter((channel) => Object.hasOwn(channelLabels, channel.id));
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
        } catch (_) { setMessage($('tgFormMessage'), '暂时无法连接兑换服务，请稍后刷新。', 'error'); }
        syncButton();
        updatePurchaseProduct();
    }

    function restorePurchases() {
        try {
            const saved = JSON.parse(globalScope.sessionStorage.getItem(PURCHASE_STORAGE_KEY) || '[]');
            purchaseRecords = Array.isArray(saved) ? saved.filter((record) => record && /^[a-f0-9]{64}$/.test(record.fingerprint)
                && TOKEN_PATTERN.test(record.statusToken) && /^tg_buy_[a-f0-9]{64}$/.test(record.idempotencyKey)
                && /^[A-Za-z0-9_]{5,32}$/.test(record.request?.username) && (!record.orderNo || PURCHASE_ORDER_PATTERN.test(record.orderNo))).slice(-30) : [];
        } catch (_) { purchaseRecords = []; }
    }
    function persistPurchases() {
        const saved = JSON.stringify(purchaseRecords); globalScope.sessionStorage.setItem(PURCHASE_STORAGE_KEY, saved);
        if (globalScope.sessionStorage.getItem(PURCHASE_STORAGE_KEY) !== saved) throw new Error('storage_unavailable');
    }
    function safeCheckoutUrl(value) {
        try { const url = new globalScope.URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch (_) { return ''; }
    }
    function renderCryptoCheckout(value) {
        if (!value || value.pay_currency !== 'usdtbsc' || value.network !== 'BSC (BEP20)'
            || typeof value.pay_amount !== 'string' || !/^(?:0|[1-9]\d{0,20})(?:\.\d{1,18})?$/.test(value.pay_amount)
            || !/[1-9]/.test(value.pay_amount) || !/^0x[0-9a-fA-F]{40}$/.test(value.pay_address || '')
            || typeof value.quote_expires_at !== 'string' || !Number.isFinite(Date.parse(value.quote_expires_at))) throw new Error('unconfirmed_crypto_payment');
        const panel = document.createElement('div'); panel.className = 'tg-crypto-checkout';
        const title = document.createElement('strong'); title.textContent = 'USDT · BSC（BEP20）';
        if (Date.parse(value.quote_expires_at) <= Date.now()) {
            const expired = document.createElement('p'); expired.textContent = '此转账报价已过期，请联系客服核对订单，勿向旧地址继续转账。';
            panel.replaceChildren(title, expired); return panel;
        }
        const amount = document.createElement('p'); amount.className = 'tg-crypto-amount'; amount.textContent = `${value.pay_amount} USDT`;
        const address = document.createElement('code'); address.textContent = value.pay_address;
        const expiry = document.createElement('p'); expiry.className = 'tg-muted'; expiry.textContent = `请在 ${new Date(value.quote_expires_at).toLocaleString('zh-CN', { hour12: false })} 前完成转账`;
        const warning = document.createElement('p'); warning.className = 'tg-warning'; warning.textContent = '仅支持 BSC（BEP20）网络。请按上方精确金额转账，并保留网络手续费。系统核对实际到账后处理。';
        const actions = document.createElement('div'); actions.className = 'tg-crypto-actions';
        const buttons = [['复制收款地址', value.pay_address], ['复制 USDT 金额', value.pay_amount]].map(([label, content]) => {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'tg-button tg-button-secondary'; button.textContent = label;
            button.addEventListener('click', async () => { try { await globalScope.navigator.clipboard.writeText(content); button.textContent = '已复制'; } catch (_) { button.textContent = '复制失败，请手动复制'; } });
            return button;
        });
        actions.replaceChildren(...buttons); panel.replaceChildren(title, amount, address, expiry, warning, actions); return panel;
    }
    function purchaseOrderMatches(order, request) {
        const family = request.product_family || (request.product_id === 'stars' ? 'telegram_stars' : 'telegram_premium');
        const months = request.term_months ?? (family === 'telegram_premium' ? Number(request.product_id.replace('premium_', '')) : null);
        return order && order.product_family === family && order.term_months === months
            && order.stars_quantity === (request.stars_quantity ?? null) && text(order.username).toLowerCase() === text(request.username).toLowerCase()
            && order.currency === 'CNY' && order.total_minor === request.expected_total_minor
            && order.price_version === request.price_version && order.payment_channel === request.channel;
    }
    function fillPurchaseTracking(record) {
        $('tgPurchaseOrderNo').value = record.orderNo; $('tgPurchaseStatusToken').value = record.statusToken; $('tgPurchaseCopyTracking').hidden = false;
        syncLookupBadge();
    }
    function stopPurchasePolling() { if (purchaseTimer !== null) globalScope.clearTimeout(purchaseTimer); purchaseTimer = null; }
    function schedulePurchasePoll() {
        stopPurchasePolling();
        if (!purchaseTracking || purchasePollCount >= 60 || document.hidden || purchaseTracking.finished) return;
        purchaseTimer = globalScope.setTimeout(() => { purchasePollCount += 1; queryPurchaseStatus(purchaseTracking.orderNo, purchaseTracking.statusToken, true); }, purchasePollCount < 12 ? 5000 : 15000);
    }
    async function queryPurchaseStatus(orderNo = text($('tgPurchaseOrderNo').value), statusToken = text($('tgPurchaseStatusToken').value), automatic = false) {
        stopPurchasePolling(); const version = ++purchaseQueryVersion; const result = $('tgPurchaseStatusResult');
        $('tgPurchaseCheckout').hidden = true;
        if (!PURCHASE_ORDER_PATTERN.test(orderNo) || !TOKEN_PATTERN.test(statusToken)) { purchaseTracking = null; result.hidden = false; result.textContent = '请输入正确的购买订单号和查询凭证。'; return; }
        purchaseTracking = { orderNo, statusToken, finished: false }; if (!automatic) { purchasePollCount = 0; result.hidden = false; result.textContent = '正在查询支付与发货进度…'; }
        try {
            const { response, data } = await request(`/api/tg/purchase/status?order_no=${encodeURIComponent(orderNo)}`, { headers: { 'X-TG-Status-Token': statusToken } });
            if (version !== purchaseQueryVersion) return;
            if (!response.ok || data.success !== true) { result.textContent = text(data.message) || '购买订单暂时无法查询。'; if (response.status >= 500 || response.status === 429) schedulePurchasePoll(); return; }
            const order = data.order; const product = order && productInfo(order, false);
            if (!order || order.order_no !== orderNo || !product || order.currency !== 'CNY' || !Number.isSafeInteger(order.total_minor) || order.total_minor <= 0
                || !Object.hasOwn(paymentLabels, order.payment_status) || !Object.hasOwn(fulfillmentLabels, order.fulfillment_status)) throw new Error('unconfirmed_order');
            const savedRecord = purchaseRecords.find((record) => record.orderNo === orderNo);
            if (savedRecord && !purchaseOrderMatches(order, savedRecord.request)) throw new Error('purchase_mismatch');
            const title = document.createElement('strong'); title.textContent = order.fulfillment_status === 'succeeded' ? product.stars ? '星星已到账' : '会员已开通' : `${paymentLabels[order.payment_status]} · ${fulfillmentLabels[order.fulfillment_status]}`;
            const details = document.createElement('p'); details.textContent = `${orderNo} · @${text(order.username)} · ${product.label} · ${money(order.total_minor)}`;
            const hint = document.createElement('p'); hint.className = 'tg-muted'; hint.textContent = order.fulfillment_status === 'succeeded' ? product.completed
                : order.payment_status === 'pending' ? '请先保存订单号和查询凭证，再前往支付。付款后回到本页，系统会自动核对到账并更新进度。' : '系统会自动核对处理。请勿重复付款，遇到问题请保留订单号联系客服。';
            const cryptoPending = order.payment_status === 'pending' && order.payment_channel === 'usdt_bep20';
            const cryptoPanel = cryptoPending && order.crypto_checkout ? renderCryptoCheckout(order.crypto_checkout) : null;
            if (cryptoPending && !cryptoPanel) hint.textContent = '正在核对 USDT 转账信息，请保留订单号与查询凭证，勿重复创建订单。';
            result.replaceChildren(title, details, hint, ...(cryptoPanel ? [cryptoPanel] : [])); result.hidden = false; fillPurchaseTracking(purchaseTracking);
            const checkoutUrl = safeCheckoutUrl(order.checkout_url);
            if (order.payment_status === 'pending' && order.payment_channel !== 'usdt_bep20' && checkoutUrl) { $('tgPurchaseCheckout').href = checkoutUrl; $('tgPurchaseCheckout').hidden = false; }
            purchaseTracking.finished = ['succeeded', 'failed', 'manual_review', 'cancelled'].includes(order.fulfillment_status)
                || ['expired', 'cancelled', 'failed', 'manual_review'].includes(order.payment_status);
            if (savedRecord) { savedRecord.retryable = order.payment_status === 'expired' && order.fulfillment_status === 'not_started'; try { persistPurchases(); } catch (_) {} }
            if (order.fulfillment_status === 'succeeded') { if (savedRecord) { savedRecord.completed = true; try { persistPurchases(); } catch (_) {} } }
            schedulePurchasePoll();
        } catch (error) { if (version !== purchaseQueryVersion) return; result.hidden = false; result.textContent = error.message === 'purchase_mismatch' ? '订单信息与本次确认内容不一致，已停止显示支付入口。请保留订单号并联系客服核对。' : '购买订单暂未确认，请稍后查询。系统不会再次创建订单。'; schedulePurchasePoll(); }
    }
    async function quotePurchase(event) {
        event.preventDefault(); if (purchaseBusy) return;
        if (!purchaseEnabled || !validSaleProduct(selectedSaleProduct())) return setMessage($('tgPurchaseMessage'), '当前产品暂未开售。', 'error');
        const username = text($('tgPurchaseUsername').value).replace(/^@+/, '').toLowerCase(); const quantity = purchaseQuantity(); const product = selectedSaleProduct(); const channel = $('tgPurchaseChannel').value;
        if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) return setMessage($('tgPurchaseMessage'), '请输入正确的 Telegram 用户名。', 'error');
        if (displayedTotal(product, quantity) === null) return setMessage($('tgPurchaseMessage'), '请输入当前范围内的整数星星数量。', 'error');
        if (!paymentChannels.some((item) => item.id === channel)) return setMessage($('tgPurchaseMessage'), '请选择可用的支付方式。', 'error');
        const version = ++quoteVersion;
        purchaseBusy = true; updatePurchaseProduct(); setMessage($('tgPurchaseMessage'), '正在核对最新售价…');
        try {
            const input = { product_id: product.id, username, ...(quantity !== null ? { stars_quantity: quantity } : {}) };
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
                || quote.total_minor !== displayedTotal(product, quantity)
                || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(quote.quote_id)
                || (quantity !== null ? quote.stars_quantity !== quantity : Number(quote.term_months) !== Number(product.term_months))) throw new Error('订单金额或产品未能确认，请稍后再试。');
            purchaseQuote = { ...quote, username, channel };
            $('tgPurchaseQuoteSummary').textContent = `@${username} · ${productInfo(quote).label} · ${money(quote.total_minor)} · ${channelLabels[channel]}`;
            $('tgPurchaseConfirmation').hidden = false; $('tgPurchaseForm').hidden = true; setMessage($('tgPurchaseMessage'), '');
        } catch (error) { if (version === quoteVersion) setMessage($('tgPurchaseMessage'), error.message || '售价核验暂不可用。', 'error'); }
        finally { purchaseBusy = false; updatePurchaseProduct(); }
    }
    async function confirmPurchase() {
        if (purchaseBusy || !purchaseQuote) return;
        const quote = purchaseQuote; purchaseBusy = true; $('tgPurchaseConfirm').disabled = true; $('tgPurchaseCancel').disabled = true;
        $('tgPurchaseCheckout').hidden = true;
        let sent = false; let record;
        try {
            const signature = await fingerprint(`${quote.product_id}:${quote.stars_quantity || ''}:${quote.channel}`, quote.username);
            record = purchaseRecords.find((item) => item.fingerprint === signature && item.completed !== true && item.retryable !== true);
            if (record && (record.request.expected_total_minor !== quote.total_minor || record.request.price_version !== quote.price_version)) {
                // Unknown results must recover the original request. Show its
                // actual amount before a separate confirmation can replay it.
                purchaseQuote = { ...record.request, total_minor: record.request.expected_total_minor };
                $('tgPurchaseQuoteSummary').textContent = `原订单：@${record.request.username} · ${productInfo(record.request).label} · ${money(record.request.expected_total_minor)} · ${channelLabels[record.request.channel] || '待核对支付方式'}`;
                setMessage($('tgPurchaseMessage'), '检测到尚未完成的原订单。请核对上方原订单金额，再次确认将查询或恢复原请求，不会新建订单。');
                return;
            }
            if (!record) {
                if (purchaseRecords.length >= 30) throw new Error('本标签页订单较多，请先查询已有订单或联系客服。');
                record = { fingerprint: signature, statusToken: randomToken(), idempotencyKey: `tg_buy_${randomToken()}`, orderNo: '', request: { product_id: quote.product_id, quote_id: quote.quote_id, product_family: quote.product_family, term_months: quote.term_months ?? null, stars_quantity: quote.stars_quantity ?? null, username: quote.username, channel: quote.channel, expected_total_minor: quote.total_minor, price_version: quote.price_version } };
                purchaseRecords.push(record);
            }
            persistPurchases();
            if (!record.orderNo) {
                sent = true;
                const { response, data } = await request('/api/tg/purchase/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': record.idempotencyKey }, body: JSON.stringify({ ...record.request, status_token: record.statusToken, idempotency_key: record.idempotencyKey }) });
                if (!response.ok || data.success !== true) {
                    const rejection = new Error(text(data.message) || '订单结果暂未确认，请保留当前页面稍后重试。');
                    rejection.confirmedQuoteRejection = response.status === 409 && data.success === false && !data.order
                        && ['quote_expired', 'quote_stale', 'quote_conflict', 'quote_mismatch', 'price_changed', 'price_version_conflict'].includes(data.code);
                    throw rejection;
                }
                if (!PURCHASE_ORDER_PATTERN.test(data.order?.order_no) || data.status_token && data.status_token !== record.statusToken) throw new Error('订单结果暂未确认，请保留当前页面稍后重试。');
                record.orderNo = data.order.order_no; persistPurchases();
                if (!purchaseOrderMatches(data.order, record.request)) throw new Error('服务器返回的订单信息与已确认内容不一致');
            }
            fillPurchaseTracking(record); purchaseQuote = null; $('tgPurchaseConfirmation').hidden = true; $('tgPurchaseForm').hidden = false;
            setMessage($('tgPurchaseMessage'), quote.channel === 'usdt_bep20' ? '订单已创建。请先保存查询凭证，再按下方网络、地址和精确金额完成转账。' : '订单已创建。请先保存查询凭证，再点击下方按钮前往支付。', 'success');
            setOrderLookupOpen(true, 'purchase');
            await queryPurchaseStatus(record.orderNo, record.statusToken);
        } catch (error) {
            const result = $('tgPurchaseStatusResult'); result.hidden = false;
            if (error.confirmedQuoteRejection === true) {
                if (record) { record.retryable = true; try { persistPurchases(); } catch (_) {} }
                purchaseQuote = null; $('tgPurchaseConfirmation').hidden = true; $('tgPurchaseForm').hidden = false;
                await loadCatalog();
                setMessage($('tgPurchaseMessage'), '价格或报价已更新，请重新核对最新价格后继续。', 'error');
                result.textContent = '旧报价已失效，未创建订单。请重新核对价格。';
            } else {
                if (record?.orderNo) fillPurchaseTracking(record);
                if (sent) setOrderLookupOpen(true, 'purchase');
                result.textContent = sent ? `${error.message || '订单结果暂未确认'} 请勿重新付款；在当前页面重试会核对原订单。` : `${error.message || '浏览器无法安全保存订单凭证'} 尚未创建新订单。`;
            }
        } finally { purchaseBusy = false; $('tgPurchaseConfirm').disabled = false; $('tgPurchaseCancel').disabled = false; updatePurchaseProduct(); }
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
    $('tgUsername')?.addEventListener('input', () => queueRecipientPreview('tgUsername', 'tgRedeemRecipient'));
    $('tgUsername')?.addEventListener('blur', () => queueRecipientPreview('tgUsername', 'tgRedeemRecipient', true));
    $('tgPurchaseForm')?.addEventListener('submit', quotePurchase);
    $('tgPurchaseConfirm')?.addEventListener('click', confirmPurchase);
    $('tgPurchaseCancel')?.addEventListener('click', resetPurchaseQuote);
    $('tgPurchaseStatusForm')?.addEventListener('submit', (event) => { event.preventDefault(); return queryPurchaseStatus(); });
    $('tgPurchaseChannel')?.addEventListener('change', () => { resetPurchaseQuote(); updatePurchaseProduct(); });
    $('tgPurchaseCopyTracking')?.addEventListener('click', async () => {
        try {
            const orderNo = text($('tgPurchaseOrderNo').value); const statusToken = text($('tgPurchaseStatusToken').value);
            if (!PURCHASE_ORDER_PATTERN.test(orderNo) || !TOKEN_PATTERN.test(statusToken)) return;
            await globalScope.navigator.clipboard.writeText(`Telegram 购买订单\n订单号：${orderNo}\n查询凭证：${statusToken}`);
            $('tgPurchaseCopyTracking').textContent = '已复制，请保存到安全位置';
        } catch (_) { $('tgPurchaseCopyTracking').textContent = '复制失败，请手动保存订单号和查询凭证'; }
    });
    $('tgStatusForm')?.addEventListener('submit', (event) => { event.preventDefault(); return queryStatus(); });
    $('tgCopyTracking')?.addEventListener('click', async () => {
        try {
            const orderNo = text($('tgOrderNo').value);
            const statusToken = text($('tgStatusToken').value);
            if (!ORDER_PATTERN.test(orderNo) || !TOKEN_PATTERN.test(statusToken)) return;
            await globalScope.navigator.clipboard.writeText(`Telegram 兑换订单\n订单号：${orderNo}\n查询凭证：${statusToken}`);
            $('tgCopyTracking').textContent = '已复制，请保存到安全位置';
        } catch (_) { $('tgCopyTracking').textContent = '复制失败，请手动保存订单号和查询凭证'; }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopPolling();
        else if (tracking && activeStatuses.has(tracking.status)) schedulePoll();
        if (document.hidden) stopPurchasePolling();
        else if (purchaseTracking && !purchaseTracking.finished) schedulePurchasePoll();
    });
    globalScope.addEventListener('pagehide', () => {
        stopPolling(); stopPurchasePolling();
        for (const state of recipientStates.values()) { state.version += 1; if (state.timer !== null) globalScope.clearTimeout(state.timer); state.controller?.abort(); }
    });
    $('tgPremiumPreview')?.addEventListener('click', () => previewProduct('telegram_premium'));
    $('tgStarsPreview')?.addEventListener('click', () => previewProduct('telegram_stars'));
    restoreRecords();
    const latestOrder = records.filter((record) => record.orderNo).at(-1);
    if (latestOrder) { fillTracking(latestOrder); queryStatus(latestOrder.orderNo, latestOrder.statusToken); }
    restorePurchases();
    const latestPurchase = purchaseRecords.filter((record) => record.orderNo).at(-1);
    if (latestPurchase) { fillPurchaseTracking(latestPurchase); queryPurchaseStatus(latestPurchase.orderNo, latestPurchase.statusToken); }
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
