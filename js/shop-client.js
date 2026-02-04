/**
 * shop-client.js
 * User-side logic for Resource Shop
 * Handles product loading, purchase flow, and order history.
 */

const ShopClient = {
    init: async function () {
        console.log('🛍️ Shop Client Initialized');

        // Check if we are on the shop page (by checking for the grid container)
        const container = document.getElementById('userShopGrid');
        const filtersContainer = document.getElementById('shopCategoryFilters');

        if (container) {
            // Fallback timeout - show error after 5 seconds if loading fails
            const fallbackTimer = setTimeout(() => {
                console.warn('🛍️ Shop loading timeout');
                container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:rgba(255,100,100,0.7);">${window.i18n?.t('common.error') || '加载超时，请刷新重试'}</div>`;
            }, 5000);

            try {
                // Wait for Supabase to be ready
                if (!window.supabaseClient) {
                    console.warn('🛍️ Waiting for Supabase...');
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                // Load category filters first, then products
                await this.loadCategoryFilters();
                await this.loadProducts();

                clearTimeout(fallbackTimer);

            } catch (err) {
                console.error('🛍️ Shop loading error:', err);
                clearTimeout(fallbackTimer);
                container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:rgba(255,100,100,0.7);">${window.i18n?.t('common.error') || '加载失败，请刷新重试'}</div>`;
            }
        }

        // Listen for Modal Open (Backwards compatibility or for index.html link if we still used modal)
        // For now, we update the index.html link to point to shop.html, so this listener might be redundant
        // but harmless to keep if we ever revert.
        const shopCard = document.querySelector('[data-modal-target="shopModal"]');
        if (shopCard) {
            shopCard.addEventListener('click', () => {
                // Redirect instead of opening modal
                window.location.href = 'shop.html';
            });
        }

        // Listen for language change to reload products in real-time
        window.addEventListener('languageChanged', () => {
            console.log('🌐 Language changed, reloading shop content...');
            this.loadCategoryFilters();
            this.loadProducts();
        });
    },

    currentCategory: 'all',

    filterCategory: function (category, btn) {
        this.currentCategory = category;
        const tabs = document.querySelectorAll('#shopCategoryFilters .filter-tab');
        tabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        this.loadProducts();
    },

    // Load categories from shop_categories table dynamically
    loadCategoryFilters: async function () {
        const container = document.getElementById('shopCategoryFilters');
        if (!container) return;

        try {
            const { data, error } = await supabaseClient
                .from('shop_categories')
                .select('*')
                .order('sort_order');

            console.log('🛍️ Shop categories from DB:', { data, error });

            let categories = data || [];

            // Fallback to defaults if empty
            if (error || categories.length === 0) {
                console.warn('shop_categories load failed or empty, using defaults');
                categories = [
                    { name: 'account', color: '#6b9ece' },
                    { name: 'Gemini', color: '#f4b400' },
                    { name: 'other', color: '#9aa0a6' }
                ];
            }

            // Clear skeleton placeholders and rebuild all buttons
            container.innerHTML = '';

            const allBtn = document.createElement('button');
            allBtn.className = 'filter-tab active';
            allBtn.textContent = window.i18n?.t('shop.allCategories') || '全部';
            allBtn.setAttribute('data-i18n', 'shop.allCategories');
            allBtn.onclick = () => this.filterCategory('all', allBtn);
            container.appendChild(allBtn);

            // Add dynamic category buttons
            categories.forEach(cat => {
                const btn = document.createElement('button');
                btn.className = 'filter-tab';
                btn.textContent = cat.name;
                btn.onclick = () => this.filterCategory(cat.name, btn);
                container.appendChild(btn);
            });

        } catch (e) {
            console.error('Failed to load category filters:', e);
            // On error, show a simple "全部" button
            container.innerHTML = `<button class="filter-tab active" data-i18n="shop.allCategories" onclick="ShopClient.filterCategory('all', this)">${window.i18n?.t('shop.allCategories') || '全部'}</button>`;
        }
    },

    loadProducts: async function () {
        const container = document.getElementById('userShopGrid');
        if (!container) return;

        container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-dim);"><i class="fas fa-spinner fa-spin"></i> ${window.i18n?.t('common.loading') || '加载中...'}</div>`;

        try {
            // Fetch ONLY active products
            let query = supabaseClient
                .from('shop_products')
                .select('*')
                .eq('is_active', true)
                .order('display_order', { ascending: false });

            if (this.currentCategory !== 'all') {
                query = query.eq('category', this.currentCategory);
            }

            const { data, error } = await query;

            if (error) throw error;

            container.innerHTML = '';
            if (!data || data.length === 0) {
                container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-dim);" data-i18n="shop.noProducts">${window.i18n?.t('shop.noProducts') || '暂无商品上架'}</div>`;
                return;
            }

            data.forEach((p, index) => {
                const el = document.createElement('div');
                el.className = 'shop-card user-product-card breathing';
                // Randomize breathing delay for wave effect (-4s to 0s)
                const delay = -(Math.random() * 4).toFixed(2);
                el.style.setProperty('--breathe-delay', `${delay}s`);
                // Styles moved to CSS (shop.html or style.css)

                const iconHtml = p.icon_url?.startsWith('fa')
                    ? `<i class="${p.icon_url}" style="font-size: 24px; color: var(--accent-purple, #6b9ece);"></i>`
                    : (p.icon_url ? `<img src="${p.icon_url}" width="40" style="border-radius:8px;">` : '<i class="fas fa-box" style="font-size: 24px; color: var(--text-dim);"></i>');

                const stockCount = p.stock_count || 0;
                const noStock = stockCount <= 0;
                const buyBtnText = noStock
                    ? (window.i18n?.t('shop.outOfStock') || '售罄')
                    : (window.i18n?.t('shop.redeem') || '兑换');
                const stockLabel = noStock
                    ? (window.i18n?.t('shop.noStock') || '无货')
                    : `${window.i18n?.t('shop.stock') || '库存'}: ${stockCount}`;

                // Use class for button style
                const buyBtnClass = noStock ? 'shop-btn-disabled' : 'shop-btn-primary';

                // Cover Image Logic
                const displayHtml = p.icon_url?.startsWith('http')
                    ? `<img src="${p.icon_url}" style="width:100%; height:100%; object-fit:cover;">`
                    : `<div class="shop-icon-wrapper">${iconHtml.replace('font-size: 24px', 'font-size: 3rem;')}</div>`;

                // Select language-appropriate content
                const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
                const displayName = (currentLang === 'en' && p.name_en) ? p.name_en : p.name;
                const displayDesc = (currentLang === 'en' && p.description_en)
                    ? p.description_en
                    : (p.description || (window.i18n?.t('shop.noDescription') || '暂无描述'));

                el.innerHTML = `
                    <div class="shop-card-image">
                        ${displayHtml}
                        <div class="shop-stock-badge ${noStock ? 'out-of-stock' : 'in-stock'}" style="position:absolute; top:12px; right:12px;">
                            ${stockLabel}
                        </div>
                    </div>
                    
                    <div class="shop-content-padding">
                        <h3 class="shop-card-title">${displayName}</h3>
                        <p class="shop-card-desc">${displayDesc}</p>
                        
                        <div style="margin-top:auto; padding-top:20px; display:flex; justify-content:space-between; align-items:center;">
                            <div class="shop-card-price">${p.price_points} <span data-i18n="shop.points">${window.i18n?.t('shop.points') || '积分'}</span></div>
                            <button onclick="ShopClient.buyProduct('${p.id}', '${p.name}', '${p.name_en || ''}', ${p.price_points})"
                                ${noStock ? 'disabled' : ''}
                                class="shop-buy-btn ${buyBtnClass}">
                                ${buyBtnText}
                            </button>
                        </div>
                    </div>
                `;
                container.appendChild(el);
            });

        } catch (err) {
            console.error('[ShopClient] Load Error:', err);
            container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#ff4d4f;">加载失败: ${err.message}</div>`;
        }
    },

    // State for the purchase modal
    currentPurchase: { productId: null, productName: null, unitPrice: 0, quantity: 1, orderId: null },

    // ---- New Purchase Flow via Modal ----

    buyProduct: async function (productId, productName, productNameEn, price) {
        // 1. Open Modal immediately for instant feedback
        this.openPurchaseModal(productId, productName, productNameEn, price);

        // 2. Auth Check in background
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) {
            this.closePurchaseModal();
            alert(window.i18n?.t('shop.loginRequired') || '请先登录再进行兑换');
            // Open login modal after user clicks OK on alert
            if (typeof toggleLoginModal === 'function') {
                toggleLoginModal();
            }
            return;
        }
    },

    openPurchaseModal: function (productId, productName, productNameEn, price) {
        this.currentPurchase = { productId, productName, productNameEn, unitPrice: price, quantity: 1 };

        // Update UI - show name based on current language
        const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
        const displayName = (currentLang === 'en' && productNameEn) ? productNameEn : productName;
        document.getElementById('modalProductName').textContent = displayName;
        document.getElementById('modalUnitPrice').textContent = price;
        document.getElementById('modalTotalPrice').textContent = price;
        document.getElementById('purchaseQuantity').value = 1;

        // Reset purchase button state (in case previous purchase left it disabled)
        const btn = document.getElementById('confirmPurchaseBtn');
        if (btn) {
            const confirmText = window.i18n?.t('shop.confirmRedeem') || '确认兑换';
            btn.innerHTML = `<i class="fas fa-shopping-cart"></i> ${confirmText}`;
            btn.disabled = false;
        }

        // Show Modal
        document.getElementById('shopPurchaseModal').classList.add('active');
    },

    closePurchaseModal: function () {
        document.getElementById('shopPurchaseModal').classList.remove('active');
    },

    adjustQuantity: function (delta) {
        let newQty = this.currentPurchase.quantity + delta;
        if (newQty < 1) newQty = 1;
        if (newQty > 99) newQty = 99; // Cap at 99 for safety

        this.currentPurchase.quantity = newQty;
        document.getElementById('purchaseQuantity').value = newQty;

        // Update Total
        const total = newQty * this.currentPurchase.unitPrice;
        document.getElementById('modalTotalPrice').textContent = total;
    },

    // Handle direct keyboard input
    onQuantityInput: function (input) {
        let val = parseInt(input.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > 99) val = 99;

        this.currentPurchase.quantity = val;
        // Update Total
        const total = val * this.currentPurchase.unitPrice;
        document.getElementById('modalTotalPrice').textContent = total;
    },

    confirmPurchase: async function () {
        const { productId, productName, quantity, unitPrice } = this.currentPurchase;

        // Disable button
        const btn = document.getElementById('confirmPurchaseBtn');
        const originalText = btn.innerHTML;
        const processingText = window.i18n?.t('shop.processing') || '处理中...';
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${processingText}`;
        btn.disabled = true;

        try {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) throw new Error(window.i18n?.t('shop.loginRequired') || "未登录");

            // Previous logic used a loop (client-side batch). 
            // New logic uses atomic server-side batch via p_quantity.

            const { data, error } = await supabaseClient.rpc('fn_purchase_shop_item', {
                p_product_id: productId,
                p_user_id: user.id,
                p_quantity: quantity
            });

            if (error) {
                throw error;
            }

            if (!data.success) {
                throw new Error(data.message || (window.i18n?.t('shop.redeemFailed') || '兑换失败'));
            }

            // Success
            const purchaseData = data.data;
            const finalContent = (purchaseData.contents && purchaseData.contents.length > 0)
                ? purchaseData.contents.join('\n----\n')
                : (purchaseData.content || (window.i18n?.t('shop.noContent') || '（无内容）'));

            const remainingPoints = purchaseData.remaining_points;

            // Store order ID for export
            this.currentPurchase.orderId = purchaseData.order_id;

            // Handle Results
            this.closePurchaseModal();
            await this.loadProducts(); // Always refresh stock first

            this.showSuccessModal(finalContent);

            // Update Points UI
            if (window.updateUserPointsUI && remainingPoints != null) {
                window.updateUserPointsUI(remainingPoints);
                if (window.checkAuthState) window.checkAuthState();
            }

        } catch (err) {
            console.error(err);
            alert((window.i18n?.t('shop.redeemFailed') || '兑换失败') + ': ' + (err.message || (window.i18n?.t('shop.unknownError') || '未知错误')));

            // Re-enable button on error
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    },

    injectPremiumStyles: function () {
        if (document.getElementById('shop-premium-card-style')) return;
        const style = document.createElement('style');
        style.id = 'shop-premium-card-style';
        style.innerHTML = `
    .content - card {
    background: rgba(255, 255, 255, 0.05)!important;
    backdrop - filter: blur(12px)!important;
    -webkit - backdrop - filter: blur(12px)!important;
    border - radius: 16px!important;
    padding: 16px!important;
    margin - bottom: 12px!important;
    border: 1px solid rgba(255, 255, 255, 0.1)!important;
    border - width: 1px!important;
    border - style: solid!important;
    box - sizing: border - box!important;
    outline: none!important;
    box - shadow: 0 4px 16px rgba(0, 0, 0, 0.2)!important;
    cursor: default !important;
    transition: none!important;
    transform: none!important;
}
            .content - card:hover {
    background: rgba(255, 255, 255, 0.05)!important;
    border: 1px solid rgba(255, 255, 255, 0.1)!important;
    box - shadow: 0 4px 16px rgba(0, 0, 0, 0.2)!important;
    transform: none!important;
    filter: none!important;
}
            .item - name {
    font - size: 13px; font - weight: 600; color: #e2e8f0;
    margin - bottom: 8px;
    display: flex; align - items: center; gap: 6px;
}
            .item - content - box {
    background: transparent;
    border - radius: 0;
    padding: 0;
}
            .item - text {
    font - family: 'Monaco', monospace;
    font - size: 12px; color: #10b981;
    word -break: break-all;
    line - height: 1.5;
    opacity: 0.9;
}
`;
        document.head.appendChild(style);
    },

    showSuccessModal: function (content, warning) {
        this.injectPremiumStyles();
        const modal = document.getElementById('shopSuccessModal');
        const contentBox = document.getElementById('purchasedContent');
        const warningBox = document.getElementById('purchasedWarning');
        const warningText = document.getElementById('purchasedWarningText');
        const parentBox = contentBox.parentElement;

        // Reset parent box styles to be cleaner (remove padding if we want cards to flush, but padding is fine)
        // Ensure parent box is transparent to let cards stand out
        if (parentBox && parentBox.classList.contains('glass-box')) {
            parentBox.classList.remove('glass-box'); // Completely remove class to kill all hover effects
            parentBox.style.background = 'transparent';
            parentBox.style.border = 'none';
            parentBox.style.boxShadow = 'none';
            parentBox.style.padding = '0'; // Let cards handle spacing
        }

        if (modal && contentBox) {
            // Split content by separator (----) to get individual items
            const items = content.split(/\n----\n/);
            const totalItems = items.length;
            // Get product name based on current language
            const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
            const productName = (currentLang === 'en' && this.currentPurchase?.productNameEn)
                ? this.currentPurchase.productNameEn
                : (this.currentPurchase?.productName || '商品内容');

            // Store original content for copying (before adding UI elements)
            contentBox.dataset.originalContent = content;

            // Update the header dot with product name tooltip
            const productNameDot = document.getElementById('productNameDot');
            if (productNameDot) {
                productNameDot.setAttribute('data-tooltip', productName);
            }

            const createCardMsg = (text) => `
                <div class="content-card">
                    <div class="item-content-box">
                        <div class="item-text">${this.escapeHtml(text)}</div>
                    </div>
                </div>`;

            // Clear previous content style that might conflict
            contentBox.style.whiteSpace = 'normal';
            contentBox.style.fontFamily = 'inherit';

            if (totalItems <= 2) {
                // 2 or fewer items: show directly
                contentBox.innerHTML = items.map(createCardMsg).join('');
            } else {
                // More than 2 items: show first 2, collapse rest
                const visibleHTML = items.slice(0, 2).map(createCardMsg).join('');
                const hiddenHTML = items.slice(2).map(createCardMsg).join('');
                const hiddenCount = totalItems - 2;

                const expandBtn = `
                <div style="margin-top:12px;text-align:center;">
                    <span id="expandContentBtn" onclick="ShopClient.toggleExpandContent()"
                        style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;
                               font-size:12px;color:rgba(255,255,255,0.6);background:rgba(255,255,255,0.1);
                               padding:8px 16px;border-radius:20px;transition:all 0.2s;">
                        <span>${window.i18n?.t('shop.expandMore') || '展开其余'} ${hiddenCount} ${window.i18n?.t('shop.items') || '个'}</span>
                        <i class="fas fa-chevron-down" style="font-size:10px;"></i>
                    </span>
                </div>`;

                const hiddenSection = `<div id="hiddenContent" style="display:none;margin-top:12px;">${hiddenHTML}</div>`;

                contentBox.innerHTML = visibleHTML + expandBtn + hiddenSection;
            }

            // Handle Warning
            if (warning && warningBox && warningText) {
                warningText.textContent = warning;
                warningBox.style.display = 'block';
            } else if (warningBox) {
                warningBox.style.display = 'none';
            }

            setTimeout(() => {
                modal.classList.add('active');
            }, 50);
        }
    },

    escapeHtml: function (text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    toggleExpandContent: function () {
        const hiddenContent = document.getElementById('hiddenContent');
        const expandBtn = document.getElementById('expandContentBtn');

        if (hiddenContent && expandBtn) {
            const isHidden = hiddenContent.style.display === 'none';
            hiddenContent.style.display = isHidden ? 'block' : 'none';
            expandBtn.innerHTML = isHidden
                ? `<span>${window.i18n?.t('shop.collapse') || '收起'}</span><i class="fas fa-chevron-up" style="font-size: 10px;"></i>`
                : `<span>${window.i18n?.t('shop.expandMore') || '展开其余'}</span><i class="fas fa-chevron-down" style="font-size: 10px;"></i>`;
        }
    },

    loadMyOrders: async function () {
        const list = document.getElementById('ordersList');
        if (!list) return;

        list.innerHTML = `<div style="text-align:center; color:rgba(255,255,255,0.4); padding:20px;"><i class="fas fa-spinner fa-spin"></i> ${window.i18n?.t('common.loading') || '加载中...'}</div>`;

        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) {
            list.innerHTML = `<div style="text-align:center; padding:20px;">${window.i18n?.t('shop.loginRequired') || '请先登录'}</div>`;
            return;
        }

        try {
            const { data, error } = await supabaseClient
                .from('shop_orders')
                .select(`
    *,
    shop_products(name, icon_url)
        `)
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;

            list.innerHTML = '';
            if (!data || data.length === 0) {
                list.innerHTML = `<div style="text-align:center; color:rgba(255,255,255,0.3); padding:40px;">${window.i18n?.t('shop.noOrders') || '暂无订单记录'}</div>`;
                return;
            }

            data.forEach(order => {
                const item = document.createElement('div');
                item.className = 'glass-box';
                item.style.padding = '12px 16px';
                item.style.marginBottom = '8px';
                item.style.display = 'flex';
                item.style.justifyContent = 'space-between';
                item.style.alignItems = 'center';

                const date = new Date(order.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                const icon = order.shop_products?.icon_url || 'fas fa-box';
                const iconHtml = icon.startsWith('http') ? `<img src="${icon}" style="width:24px;height:24px;border-radius:4px;margin-right:8px;">` : `<i class="${icon}" style="margin-right:8px;color:#6b9ece;"></i>`;

                item.innerHTML = `
                    <div style="flex:1;">
                        <div style="display:flex; align-items:center; margin-bottom:4px;">
                            ${iconHtml}
                            <span style="font-weight:600; font-size:14px; color:#fff;">${order.shop_products?.name || (window.i18n?.t('shop.unknownProduct') || '未知商品')}</span>
                        </div>
                        <div style="font-size:12px; color:rgba(255,255,255,0.4);">
                            ${date} · <span style="color:#fbbf24;">-${order.price_points} ${window.i18n?.t('shop.points') || '积分'}</span>
                        </div>
                    </div>
                    <button onclick="event.stopPropagation(); ShopClient.viewOrderContent('${order.id}', '${encodeURIComponent(order.content_delivered || '')}')"
                        style="padding:6px 12px; border-radius:12px; background:rgba(255,255,255,0.1); border:none; color:#fff; cursor:pointer;">
                        ${window.i18n?.t('shop.view') || '查看'}
                    </button>
                `;
                list.appendChild(item);
            });
        } catch (err) {
            console.error(err);
            list.innerHTML = `<div style="text-align:center; color:#ff4d4f;">${window.i18n?.t('common.error') || '加载失败'}</div>`;
        }
    },

    viewOrderContent: function (id, encodedContent) {
        // Use unified WalletModal order detail view (premium glass style)
        if (window.WalletModal && window.WalletModal.showOrderDetail) {
            WalletModal.showOrderDetail(id);
        } else {
            // Fallback to old modal if WalletModal not loaded
            const content = decodeURIComponent(encodedContent);
            this.showSuccessModal(content);
            const modal = document.getElementById('shopSuccessModal');
            const title = modal.querySelector('.card-title');
            if (title) title.textContent = window.i18n?.t('shop.orderDetails') || "订单详情";
        }
    },

    copyContent: function () {
        const contentBox = document.getElementById('purchasedContent');
        // Use stored original content instead of textContent (which includes UI button text)
        let text = contentBox.dataset.originalContent || contentBox.textContent;

        // Remove '----' separators and replace with single newline for clean separation
        if (text) {
            text = text.split(/\n----\n/).join('\n');
        }

        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('copyContentBtn');
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `<i class="fas fa-check"></i> ${window.i18n?.t('common.copied') || '已复制'}`;
            btn.style.background = '#4ade80';
            btn.style.color = '#fff';
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.style.background = ''; // reset to class style
                btn.style.color = '';
            }, 2000);
        });
    },

    exportContent: function () {
        const contentBox = document.getElementById('purchasedContent');
        const content = contentBox.dataset.originalContent || contentBox.textContent;
        const productName = this.currentPurchase?.productName || (window.i18n?.t('shop.unknownProduct') || '商品');
        const orderId = this.currentPurchase?.orderId || '';
        const timestamp = new Date().toLocaleString('zh-CN');

        // Parse items
        const items = content.split(/\n----\n/);

        // Build CSV content with BOM for Excel Chinese support
        const BOM = '\uFEFF';
        let csv = BOM + `${window.i18n?.t('shop.csvOrderId') || '订单号'},${window.i18n?.t('shop.csvIndex') || '序号'},${window.i18n?.t('shop.csvProductName') || '商品名称'},${window.i18n?.t('shop.csvAccountInfo') || '账号信息'},${window.i18n?.t('shop.csvRedeemTime') || '兑换时间'}\n`;

        items.forEach((item, index) => {
            // Escape quotes and wrap in quotes for CSV
            const escapedItem = item.replace(/"/g, '""');
            csv += `"${orderId}", ${index + 1}, "${productName}", "${escapedItem}", "${timestamp}"\n`;
        });

        // Create and download file
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${window.i18n?.t('shop.orderPrefix') || '订单'}_${productName}_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Button feedback
        const btn = document.getElementById('exportContentBtn');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = `<i class="fas fa-check"></i> ${window.i18n?.t('common.exported') || '已导出'}`;
        btn.style.background = '#4ade80';
        btn.style.color = '#fff';
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.style.background = '';
            btn.style.color = '';
        }, 2000);
    }
};

// Auto-init if DOM ready, otherwise wait
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ShopClient.init());
} else {
    ShopClient.init();
}

// Expose globally
window.ShopClient = ShopClient;
