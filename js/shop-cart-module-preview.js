(function () {
    'use strict';

    const products = [
        {
            id: 'gmail-2fa',
            eyebrow: 'Account Asset',
            name: '两年期 Gmail · 2FA',
            subtitle: '随机地区 · 可即时发货',
            price: 26,
            inventoryText: '库存稳定 · 限购 2 件',
            notice: '兑换后 20 分钟内请完成首次登录，并尽快替换恢复邮箱。',
            usageCount: 1,
            accent: 'amber',
            icon: 'fa-envelope'
        },
        {
            id: 'gemini-pack',
            eyebrow: 'AI Tool',
            name: 'Gemini 高级资源包',
            subtitle: '含常用场景配置和交付模板',
            price: 34,
            inventoryText: '库存充足 · 可批量加购',
            notice: '',
            usageCount: 2,
            accent: 'teal',
            icon: 'fa-sparkles'
        },
        {
            id: 'midjourney-kit',
            eyebrow: 'Creative Kit',
            name: 'Midjourney 出图组合包',
            subtitle: '适合多账号工作流',
            price: 18,
            inventoryText: '余量 11 · 可与折扣券叠加',
            notice: '组合包里有 1 个商品含注意事项，建议在统一确认时再看完整说明。',
            usageCount: 1,
            accent: 'rose',
            icon: 'fa-wand-magic-sparkles'
        },
        {
            id: 'chatgpt-seat',
            eyebrow: 'Workspace Slot',
            name: 'Chat Workspace 席位',
            subtitle: '适合短期共创与验收',
            price: 22,
            inventoryText: '浮动库存 · 支持先加购后比较',
            notice: '',
            usageCount: 1,
            accent: 'mint',
            icon: 'fa-comments'
        }
    ];

    const initialCart = [
        { id: 'gmail-2fa', quantity: 1 },
        { id: 'midjourney-kit', quantity: 2 }
    ];

    const variantCopy = {
        drawer: {
            note: {
                desktop: '当前在看主方案：右下悬浮入口配右侧抽屉，购物车始终是“次主角”，用户先逛商品，想结算时再拉开。',
                mobile: '当前在看主方案的移动版：入口固定悬浮在屏幕底部，点击后入口隐藏，再从底部拉起抽屉。'
            },
            drawerEyebrow: 'Floating Cart',
            drawerTitle: '抽屉式购物车',
            drawerBody: '购物车贴在页面边缘，需要时再拉开，不和商品列表抢主舞台。',
            anchorHint: '点开购物车',
            dockCta: '查看明细',
            strategyTitle: '为什么推荐这套',
            strategyBody: '它最适合当前商城的单商品兑换基因。用户仍然可以直接兑换，也可以边逛边加购，不需要你先造一个购物车整页。',
            filterTrayTitle: '筛选区托盘',
            filterTrayBody: '这个方案不是当前激活项。切过去之后，购物车会嵌进筛选区下方，作为页面内托盘存在。',
            checkoutTitle: '这里接统一确认层',
            checkoutBody: '在抽屉方案里，点击“去结算”会从侧边抽屉过渡到统一确认层，而不是把用户送去新的购物车整页。',
            checkoutToast: '抽屉方案会从侧边购物车过渡到统一确认层'
        },
        bar: {
            note: {
                desktop: '当前在看底部结算条方案：购物车持续贴在底边，只负责提醒“你已经选了多少、总价多少”，需要时再展开明细层。',
                mobile: '当前在看底部结算条方案的移动版：这条底栏就是主要入口，适合强转化、少打扰的节奏。'
            },
            drawerEyebrow: 'Bottom Summary Bar',
            drawerTitle: '底部结算条',
            drawerBody: '先用底栏持续显示件数和总价，点击后再把明细层从底部拉起来。',
            anchorHint: '点开购物车',
            dockCta: '展开结算条',
            strategyTitle: '它更像持续提醒',
            strategyBody: '这套更强调结算感，适合你想把“已选数量”和“总积分”一直留在用户视线里，但又不想占据右侧区域的时候。',
            filterTrayTitle: '筛选区托盘',
            filterTrayBody: '这个方案不是当前激活项。切过去之后，购物车会并入页面内容区，而不是停在底边。',
            checkoutTitle: '这里接底栏结算层',
            checkoutBody: '底部条方案里，点击“去结算”通常会先拉起一个底部确认层，然后再进入统一确认，不需要新页面。',
            checkoutToast: '底部结算条会先拉起底部确认层'
        },
        tray: {
            note: {
                desktop: '当前在看筛选区托盘方案：购物车直接并入页面内容区，像一个可展开的选品托盘，不新增悬浮入口。',
                mobile: '当前在看筛选区托盘方案的移动版：它更像页面里的一段可折叠模块，适合不想要浮层入口的版本。'
            },
            drawerEyebrow: 'Inline Tray',
            drawerTitle: '筛选区托盘',
            drawerBody: '购物车不悬浮、不贴边，而是并入页面内容区，成为一个可折叠托盘。',
            anchorHint: '点开购物车',
            dockCta: '查看明细',
            strategyTitle: '它最克制',
            strategyBody: '这套最像“商品筛选的延伸”，适合你希望页面气质更安静、不想引入悬浮组件时使用。',
            filterTrayTitle: '筛选区托盘',
            filterTrayBody: '购物车和筛选区放在同一层级里，用户滑到商品区前，就能先扫一眼自己已选了什么。',
            checkoutTitle: '这里接页面内确认层',
            checkoutBody: '托盘方案会从页面内托盘直接衔接统一确认层，过渡最平，不需要从页面边缘唤起新模块。',
            checkoutToast: '托盘方案会从页面内模块过渡到统一确认层'
        }
    };

    const productMap = new Map(products.map((product) => [product.id, product]));

    const state = {
        layoutMode: document.body.dataset.layoutMode || 'desktop',
        cartVariant: document.body.dataset.cartVariant || 'drawer',
        cartOpen: document.body.dataset.cartOpen !== 'false',
        cart: new Map(),
        toastTimer: 0,
        hintTimer: 0
    };

    const elements = {
        body: document.body,
        productGrid: document.getElementById('productGrid'),
        conceptCards: Array.from(document.querySelectorAll('[data-cart-variant-target]')),
        cartList: document.getElementById('cartList'),
        cartEmptyState: document.getElementById('cartEmptyState'),
        cartAnchor: document.getElementById('cartAnchor'),
        cartAnchorCount: document.getElementById('cartAnchorCount'),
        cartAnchorTotal: document.getElementById('cartAnchorTotal'),
        cartAnchorHint: document.getElementById('cartAnchorHint'),
        mobileCartBar: document.getElementById('mobileCartBar'),
        mobileCartCount: document.getElementById('mobileCartCount'),
        mobileCartTotal: document.getElementById('mobileCartTotal'),
        mobileCartCta: document.getElementById('mobileCartCta'),
        cartSummaryCount: document.getElementById('cartSummaryCount'),
        cartSummaryTotal: document.getElementById('cartSummaryTotal'),
        cartSummaryNotice: document.getElementById('cartSummaryNotice'),
        cartSummaryUsage: document.getElementById('cartSummaryUsage'),
        checkoutBtn: document.getElementById('checkoutBtn'),
        checkoutHint: document.getElementById('checkoutHint'),
        checkoutHintTitle: document.getElementById('checkoutHintTitle'),
        checkoutHintBody: document.getElementById('checkoutHintBody'),
        previewToast: document.getElementById('previewToast'),
        previewModeNote: document.getElementById('previewModeNote'),
        cartDrawer: document.getElementById('cartDrawer'),
        cartDrawerEyebrow: document.getElementById('cartDrawerEyebrow'),
        cartModuleTitle: document.getElementById('cartModuleTitle'),
        cartModuleBody: document.getElementById('cartModuleBody'),
        filterTray: document.getElementById('filterTray'),
        filterTrayTitle: document.getElementById('filterTrayTitle'),
        filterTrayBody: document.getElementById('filterTrayBody'),
        filterTrayToggle: document.getElementById('filterTrayToggle'),
        filterTrayCount: document.getElementById('filterTrayCount'),
        filterTrayTotal: document.getElementById('filterTrayTotal'),
        filterTrayNotice: document.getElementById('filterTrayNotice'),
        filterTrayDetails: document.getElementById('filterTrayDetails'),
        filterTrayList: document.getElementById('filterTrayList'),
        filterTrayCheckoutBtn: document.getElementById('filterTrayCheckoutBtn')
    };

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function formatPoints(value) {
        return `${value} 积分`;
    }

    function getVariant() {
        return variantCopy[state.cartVariant] || variantCopy.drawer;
    }

    function getDefaultOpenState() {
        if (state.cartVariant === 'tray') {
            return true;
        }
        return false;
    }

    function seedCart() {
        state.cart = new Map(initialCart.map((item) => [item.id, item.quantity]));
        state.cartOpen = getDefaultOpenState();
    }

    function getCartEntries() {
        return Array.from(state.cart.entries())
            .map(([id, quantity]) => {
                const product = productMap.get(id);
                if (!product || quantity <= 0) return null;
                return { product, quantity };
            })
            .filter(Boolean);
    }

    function getSummary() {
        return getCartEntries().reduce((summary, entry) => {
            summary.itemCount += entry.quantity;
            summary.totalPoints += entry.quantity * entry.product.price;
            summary.noticeCount += entry.product.notice ? 1 : 0;
            summary.usageCount += entry.product.usageCount || 0;
            return summary;
        }, {
            itemCount: 0,
            totalPoints: 0,
            noticeCount: 0,
            usageCount: 0
        });
    }

    function setCartOpen(open) {
        state.cartOpen = Boolean(open);
        elements.body.dataset.cartOpen = String(state.cartOpen);
        elements.cartAnchor.setAttribute('aria-expanded', String(state.cartOpen));
        elements.mobileCartBar.setAttribute('aria-expanded', String(state.cartOpen));
        elements.filterTrayToggle.setAttribute('aria-expanded', String(state.cartOpen));
        elements.filterTrayToggle.textContent = state.cartOpen ? '收起托盘' : '展开托盘';
    }

    function showToast(message) {
        window.clearTimeout(state.toastTimer);
        elements.previewToast.hidden = false;
        elements.previewToast.textContent = message;
        state.toastTimer = window.setTimeout(() => {
            elements.previewToast.hidden = true;
        }, 1800);
    }

    function showCheckoutHint() {
        const variant = getVariant();
        window.clearTimeout(state.hintTimer);
        elements.checkoutHintTitle.textContent = variant.checkoutTitle;
        elements.checkoutHintBody.textContent = variant.checkoutBody;
        elements.checkoutHint.hidden = false;
        state.hintTimer = window.setTimeout(() => {
            elements.checkoutHint.hidden = true;
        }, 2800);
    }

    function bumpCartEntry() {
        [elements.cartAnchor, elements.mobileCartBar, elements.filterTray].forEach((element) => {
            element.classList.remove('is-bumping');
        });

        window.requestAnimationFrame(() => {
            [elements.cartAnchor, elements.mobileCartBar, elements.filterTray].forEach((element) => {
                element.classList.add('is-bumping');
            });
        });

        window.setTimeout(() => {
            [elements.cartAnchor, elements.mobileCartBar, elements.filterTray].forEach((element) => {
                element.classList.remove('is-bumping');
            });
        }, 460);
    }

    function applyVariantCopy() {
        const variant = getVariant();

        elements.body.dataset.layoutMode = state.layoutMode;
        elements.body.dataset.cartVariant = state.cartVariant;
        elements.previewModeNote.textContent = variant.note[state.layoutMode] || variant.note.desktop;

        elements.conceptCards.forEach((card) => {
            const isActive = card.dataset.cartVariantTarget === state.cartVariant;
            card.classList.toggle('concept-card--active', isActive);
            card.setAttribute('aria-pressed', String(isActive));
            const badge = card.querySelector('.concept-card__badge');
            if (badge) {
                badge.classList.toggle('concept-card__badge--muted', !isActive);
                badge.textContent = isActive ? '当前预览' : '备选';
            }
        });

        elements.cartDrawerEyebrow.textContent = variant.drawerEyebrow;
        elements.cartModuleTitle.textContent = variant.drawerTitle;
        elements.cartModuleBody.textContent = variant.drawerBody;
        elements.cartAnchorHint.textContent = variant.anchorHint;
        elements.mobileCartCta.textContent = variant.dockCta;
        elements.filterTrayTitle.textContent = variant.filterTrayTitle;
        elements.filterTrayBody.textContent = variant.filterTrayBody;

        elements.filterTray.hidden = state.cartVariant !== 'tray';
        elements.cartDrawer.hidden = state.cartVariant === 'tray';
        elements.cartAnchor.hidden = state.cartVariant !== 'drawer';
        elements.mobileCartBar.hidden = state.cartVariant !== 'bar';
    }

    function setLayoutMode(mode, options = {}) {
        state.layoutMode = mode === 'mobile' ? 'mobile' : 'desktop';
        if (!options.preserveOpen) {
            state.cartOpen = getDefaultOpenState();
        }
        applyVariantCopy();
        render();
    }

    function setCartVariant(variant, options = {}) {
        state.cartVariant = variantCopy[variant] ? variant : 'drawer';
        if (!options.preserveOpen) {
            state.cartOpen = getDefaultOpenState();
        }
        applyVariantCopy();
        render();
    }

    function addToCart(productId) {
        const current = Number(state.cart.get(productId) || 0);
        state.cart.set(productId, current + 1);

        if (state.cartVariant === 'tray') {
            setCartOpen(true);
        }

        render();
        bumpCartEntry();

        const product = productMap.get(productId);
        showToast(`已加入购物车：${product ? product.name : '商品'}`);
    }

    function updateQuantity(productId, nextQuantity) {
        if (nextQuantity <= 0) {
            state.cart.delete(productId);
        } else {
            state.cart.set(productId, nextQuantity);
        }
        render();
    }

    function buildCartItemMarkup(entry) {
        const subtotal = entry.quantity * entry.product.price;

        return `
            <article class="cart-item cart-item--${escapeHtml(entry.product.accent)}">
                <div class="cart-item__top">
                    <div class="cart-item__heading">
                        <div class="cart-item__icon" aria-hidden="true">
                            <i class="fas ${escapeHtml(entry.product.icon)}"></i>
                        </div>
                        <div class="cart-item__title-wrap">
                            <div class="cart-item__title">${escapeHtml(entry.product.name)}</div>
                            <div class="cart-item__subtitle">${escapeHtml(entry.product.subtitle)}</div>
                        </div>
                    </div>

                    <button class="cart-item__remove" type="button" data-cart-action="remove" data-product-id="${escapeHtml(entry.product.id)}">
                        移除
                    </button>
                </div>

                <div class="cart-item__pills">
                    <span class="cart-item__pill">${escapeHtml(entry.product.inventoryText)}</span>
                    ${entry.product.notice ? '<span class="cart-item__pill cart-item__pill--notice">含注意事项摘要</span>' : ''}
                    ${entry.product.usageCount ? `<span class="cart-item__pill cart-item__pill--usage">结算后附 ${entry.product.usageCount} 条说明</span>` : ''}
                </div>

                ${entry.product.notice ? `<div class="cart-item__notice">${escapeHtml(entry.product.notice)}</div>` : ''}

                <div class="cart-item__footer">
                    <div class="cart-item__price">
                        <strong>${subtotal}</strong>
                        <span>${entry.product.price} x ${entry.quantity}</span>
                    </div>

                    <div class="cart-item__qty" aria-label="数量调节">
                        <button class="cart-item__qty-btn" type="button" data-cart-action="decrease" data-product-id="${escapeHtml(entry.product.id)}">−</button>
                        <span class="cart-item__qty-value">${entry.quantity}</span>
                        <button class="cart-item__qty-btn" type="button" data-cart-action="increase" data-product-id="${escapeHtml(entry.product.id)}">+</button>
                    </div>
                </div>
            </article>
        `;
    }

    function buildFilterTrayItemMarkup(entry) {
        return `
            <article class="cart-item cart-item--${escapeHtml(entry.product.accent)}">
                <div class="cart-item__top">
                    <div class="cart-item__heading">
                        <div class="cart-item__icon" aria-hidden="true">
                            <i class="fas ${escapeHtml(entry.product.icon)}"></i>
                        </div>
                        <div class="cart-item__title-wrap">
                            <div class="cart-item__title">${escapeHtml(entry.product.name)}</div>
                            <div class="cart-item__subtitle">${escapeHtml(entry.product.subtitle)}</div>
                        </div>
                    </div>

                    <button class="cart-item__remove" type="button" data-cart-action="remove" data-product-id="${escapeHtml(entry.product.id)}">
                        移除
                    </button>
                </div>

                <div class="cart-item__pills">
                    <span class="cart-item__pill">${entry.quantity} 件</span>
                    ${entry.product.notice ? '<span class="cart-item__pill cart-item__pill--notice">有注意事项</span>' : ''}
                    ${entry.product.usageCount ? `<span class="cart-item__pill cart-item__pill--usage">${entry.product.usageCount} 条说明</span>` : ''}
                </div>
            </article>
        `;
    }

    function renderProducts() {
        const cartCounts = state.cart;
        elements.productGrid.innerHTML = products.map((product) => {
            const count = Number(cartCounts.get(product.id) || 0);

            return `
                <article class="product-card product-card--${escapeHtml(product.accent)}">
                    <div class="product-card__top">
                        <div class="product-card__icon" aria-hidden="true">
                            <i class="fas ${escapeHtml(product.icon)}"></i>
                        </div>
                        <div class="product-card__count">
                            已加购
                            <strong>${count}</strong>
                        </div>
                    </div>

                    <div class="product-card__body">
                        <div class="product-card__eyebrow">${escapeHtml(product.eyebrow)}</div>
                        <h4>${escapeHtml(product.name)}</h4>
                        <p class="product-card__subtitle">${escapeHtml(product.subtitle)}</p>

                        <div class="product-card__pills">
                            <span class="product-card__pill">${escapeHtml(product.inventoryText)}</span>
                            ${product.notice ? '<span class="product-card__pill product-card__pill--notice">含注意事项</span>' : ''}
                            ${product.usageCount ? `<span class="product-card__pill product-card__pill--usage">${product.usageCount} 条使用说明</span>` : ''}
                        </div>

                        <div class="product-card__detail">
                            <div class="product-card__price">
                                <strong>${product.price}</strong>
                                <span>${formatPoints(product.price)}</span>
                            </div>

                            <div class="product-card__actions">
                                <button class="product-card__btn product-card__btn--ghost" type="button" data-product-action="buy-now" data-product-id="${escapeHtml(product.id)}">
                                    立即兑换
                                </button>
                                <button class="product-card__btn product-card__btn--primary" type="button" data-product-action="add" data-product-id="${escapeHtml(product.id)}">
                                    ${count > 0 ? '再加 1 件' : '加入购物车'}
                                </button>
                            </div>
                        </div>
                    </div>
                </article>
            `;
        }).join('');
    }

    function renderCart() {
        const entries = getCartEntries();
        const summary = getSummary();

        elements.cartEmptyState.hidden = entries.length !== 0;
        elements.cartList.hidden = entries.length === 0;

        elements.cartAnchorCount.textContent = summary.itemCount > 0 ? `${summary.itemCount} 件商品` : '购物车暂空';
        elements.cartAnchorTotal.textContent = summary.itemCount > 0 ? `合计 ${formatPoints(summary.totalPoints)}` : '可先挑选，再统一结算';
        elements.mobileCartCount.textContent = summary.itemCount > 0 ? `${summary.itemCount} 件已选` : '购物车暂空';
        elements.mobileCartTotal.textContent = summary.itemCount > 0 ? formatPoints(summary.totalPoints) : '点击开始加购';

        elements.cartSummaryCount.textContent = `${summary.itemCount} 件`;
        elements.cartSummaryTotal.textContent = formatPoints(summary.totalPoints);
        elements.cartSummaryNotice.textContent = `${summary.noticeCount} 个`;
        elements.cartSummaryUsage.textContent = `${summary.usageCount} 条`;
        elements.checkoutBtn.disabled = entries.length === 0;

        if (entries.length === 0) {
            elements.cartList.innerHTML = '';
            return;
        }

        elements.cartList.innerHTML = entries.map(buildCartItemMarkup).join('');
    }

    function renderFilterTray() {
        const entries = getCartEntries();
        const summary = getSummary();

        elements.filterTrayCount.textContent = `${summary.itemCount} 件商品`;
        elements.filterTrayTotal.textContent = formatPoints(summary.totalPoints);
        elements.filterTrayNotice.textContent = `${summary.noticeCount} 个注意事项`;
        elements.filterTrayDetails.hidden = !state.cartOpen;
        elements.filterTrayCheckoutBtn.disabled = entries.length === 0;

        if (entries.length === 0) {
            elements.filterTrayList.innerHTML = '<div class="filter-tray__empty">还没有加购内容，先从下面的商品卡片试试。</div>';
            return;
        }

        elements.filterTrayList.innerHTML = entries.map(buildFilterTrayItemMarkup).join('');
    }

    function render() {
        applyVariantCopy();
        renderProducts();
        renderCart();
        renderFilterTray();
        setCartOpen(state.cartOpen);
    }

    function handleCartAction(target) {
        const productId = target.dataset.productId || '';
        const current = Number(state.cart.get(productId) || 0);
        const action = target.dataset.cartAction || '';

        if (action === 'increase') {
            updateQuantity(productId, current + 1);
            return true;
        }

        if (action === 'decrease') {
            updateQuantity(productId, current - 1);
            return true;
        }

        if (action === 'remove') {
            state.cart.delete(productId);
            render();
            showToast('已从购物车移除');
            return true;
        }

        return false;
    }

    elements.productGrid.addEventListener('click', (event) => {
        const target = event.target instanceof Element
            ? event.target.closest('[data-product-action]')
            : null;
        if (!target) return;

        const productId = target.dataset.productId || '';
        const action = target.dataset.productAction || '';
        if (!productMap.has(productId)) return;

        if (action === 'add') {
            addToCart(productId);
            return;
        }

        if (action === 'buy-now') {
            const product = productMap.get(productId);
            showToast(`这里仍然保留单商品直购：${product ? product.name : '商品'}`);
            showCheckoutHint();
        }
    });

    [elements.cartList, elements.filterTrayList].forEach((container) => {
        container.addEventListener('click', (event) => {
            const target = event.target instanceof Element
                ? event.target.closest('[data-cart-action]')
                : null;
            if (!target) return;
            handleCartAction(target);
        });
    });

    document.addEventListener('click', (event) => {
        const variantCard = event.target instanceof Element
            ? event.target.closest('[data-cart-variant-target]')
            : null;
        if (variantCard) {
            setCartVariant(variantCard.dataset.cartVariantTarget || 'drawer');
            return;
        }

        const layoutButton = event.target instanceof Element
            ? event.target.closest('[data-layout-mode-target]')
            : null;
        if (layoutButton) {
            setLayoutMode(layoutButton.dataset.layoutModeTarget || 'desktop');
            return;
        }

        const actionTrigger = event.target instanceof Element
            ? event.target.closest('[data-preview-action]')
            : null;
        if (!actionTrigger) return;

        const action = actionTrigger.dataset.previewAction || '';

        if (action === 'seed') {
            seedCart();
            render();
            showToast('已重置为默认示例');
            return;
        }

        if (action === 'toggle-cart') {
            if (state.cartVariant !== 'tray' && getCartEntries().length === 0) {
                showToast('先从卡片里加购几件看看效果');
                return;
            }
            setCartOpen(!state.cartOpen);
            return;
        }

        if (action === 'continue') {
            setCartOpen(false);
            return;
        }

        if (action === 'checkout') {
            if (getCartEntries().length === 0) return;
            showCheckoutHint();
            showToast(getVariant().checkoutToast);
        }
    });

    [elements.cartAnchor, elements.mobileCartBar].forEach((element) => {
        element.addEventListener('click', () => {
            if (getCartEntries().length === 0) {
                showToast('先从卡片里加购几件看看效果');
                return;
            }
            setCartOpen(!state.cartOpen);
        });
    });

    document.addEventListener('keydown', (event) => {
        const variantCard = event.target instanceof Element
            ? event.target.closest('[data-cart-variant-target]')
            : null;
        if (variantCard && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            setCartVariant(variantCard.dataset.cartVariantTarget || 'drawer');
            return;
        }

        if (event.key === 'Escape' && state.cartOpen) {
            setCartOpen(false);
        }
    });

    seedCart();
    applyVariantCopy();
    render();
}());
