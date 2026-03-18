// ==========================================
// Admin Studio - Shop Management Module
// ==========================================

const SHOP_ADMIN_PROJECT_URL = 'https://mmkugdibsaeoevliebzk.supabase.co';
const SHOP_ADMIN_PUBLISHABLE_KEY = typeof SUPABASE_KEY !== 'undefined'
    ? SUPABASE_KEY
    : 'sb_publishable_lwkiF-sQ80z8e9oMcejFPQ_j7oezjcF';

// Keep auth on the custom domain client, but route shop data reads/writes
// through the official project endpoint to avoid PATCH/DELETE fetch failures.
const supabaseClient = (() => {
    const authClient = window.supabaseClient;

    if (!authClient || typeof window.supabase?.createClient !== 'function') {
        return authClient;
    }

    if (window.__shopAdminDbClient) {
        return window.__shopAdminDbClient;
    }

    window.__shopAdminDbClient = window.supabase.createClient(
        SHOP_ADMIN_PROJECT_URL,
        SHOP_ADMIN_PUBLISHABLE_KEY,
        {
            accessToken: async () => {
                const { data: { session } = {} } = await authClient.auth.getSession();
                return session?.access_token ?? null;
            },
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        }
    );

    return window.__shopAdminDbClient;
})();

const ShopAdmin = {
    currentTab: 'products',
    selectedProductId: null,
    inventoryPage: 1,
    ordersPage: 1,
    pageSize: 10,
    currentCategory: 'all', // State for category filter
    currentStatusFilter: 'active', // State for status filter: 'active' or 'deleted'
    currentImportCategory: 'all', // State for import filter
    allProductsForImport: [], // Cache for import list (active products)
    deletedProductsForImport: [], // Cache for deleted products (recycle bin)
    isProductSelectionMode: false, // State for product multi-select mode
    editingProductSnapshot: null, // Original product row for resilient saves on existing items
    purchaseNotesSchemaAvailable: null, // null = unknown, false = remote DB not migrated yet
    richTextEditorsReady: false,

    // ==================== Site-Context Editing ====================
    SITE_FIELD_MAP: {
        cn: { price: 'price_points', name: 'name', desc: 'description' },
        intl: { price: 'price_points_intl', name: 'name_en', desc: 'description_en' }
    },

    /** Get the active editing site based on admin site filter */
    getEditSite() {
        const filter = window.AdminSiteFilter?.getSiteFilter?.() || 'all';
        return filter === 'intl' ? 'intl' : 'cn'; // 'all' defaults to 'cn'
    },

    /** Get field mapping for current editing site */
    getFieldMap() {
        return this.SITE_FIELD_MAP[this.getEditSite()];
    },

    /** Update modal labels and hint based on current site */
    updateModalLabels() {
        const site = this.getEditSite();
        const isCN = site === 'cn';
        const filter = window.AdminSiteFilter?.getSiteFilter?.() || 'all';

        // Update labels
        const nameLabel = document.getElementById('prodNameLabel');
        const priceLabel = document.getElementById('prodPriceLabel');
        const descLabel = document.getElementById('prodDescLabel');
        const hint = document.getElementById('productSiteHint');

        if (nameLabel) nameLabel.textContent = isCN ? '商品名称' : 'Product Name (EN)';
        if (priceLabel) priceLabel.textContent = isCN ? '价格 (积分)' : 'Price (Points)';
        if (descLabel) descLabel.textContent = isCN ? '商品描述' : 'Description (EN)';

        // Update placeholder
        const nameInput = document.getElementById('prodName');
        const descInput = document.getElementById('prodDesc');
        if (nameInput) nameInput.placeholder = isCN ? '输入商品名称' : 'Enter product name in English';
        if (descInput) descInput.placeholder = isCN ? '商品简介...' : 'Product description in English...';

        // Show site hint
        if (hint) {
            if (filter === 'all') {
                hint.style.display = 'block';
                hint.innerHTML = '⚠️ 当前为“全部”模式，默认编辑 <strong>CN</strong> 商品信息。切换站点可编辑对应站点的名称/价格/描述。';
            } else {
                hint.style.display = 'block';
                hint.innerHTML = isCN
                    ? '🇨🇳 正在编辑 <strong>CN</strong> 商品信息'
                    : '🌍 Editing <strong>EN</strong> product info';
            }
        }
    },

    getProductRichTextConfigs() {
        return [
            {
                key: 'productPurchaseNotes',
                hiddenInputId: 'prodPurchaseNotes',
                editorId: 'prodPurchaseNotesEditor',
                toolbarRootId: 'prodPurchaseNotesToolbar',
                emojiPickerId: 'prodPurchaseNotesEmojiPicker',
                emojiButtonId: 'prodPurchaseNotesEmojiBtn',
                alignPickerId: 'prodPurchaseNotesAlignPicker',
                alignButtonId: 'prodPurchaseNotesAlignBtn',
                colorDropdownId: 'prodPurchaseNotesColorDropdown',
                colorPreviewId: 'prodPurchaseNotesColorPreview',
                sizeDropdownId: 'prodPurchaseNotesSizeDropdown',
                sizePreviewId: 'prodPurchaseNotesSizePreview',
                placeholder: '输入确认兑换前展示的注意事项（支持链接，如 https://example.com）',
                onInput: () => this.refreshFormSectionHeight('purchaseNotesWrapper'),
                onRender: () => this.refreshFormSectionHeight('purchaseNotesWrapper')
            },
            {
                key: 'productUsageInstructions',
                hiddenInputId: 'prodUsageInstructions',
                editorId: 'prodUsageInstructionsEditor',
                toolbarRootId: 'prodUsageInstructionsToolbar',
                emojiPickerId: 'prodUsageInstructionsEmojiPicker',
                emojiButtonId: 'prodUsageInstructionsEmojiBtn',
                alignPickerId: 'prodUsageInstructionsAlignPicker',
                alignButtonId: 'prodUsageInstructionsAlignBtn',
                colorDropdownId: 'prodUsageInstructionsColorDropdown',
                colorPreviewId: 'prodUsageInstructionsColorPreview',
                sizeDropdownId: 'prodUsageInstructionsSizeDropdown',
                sizePreviewId: 'prodUsageInstructionsSizePreview',
                placeholder: '输入使用说明 / 注意事项（支持链接，如 https://example.com）',
                onInput: () => this.refreshFormSectionHeight('usageInstructionsWrapper'),
                onRender: () => this.refreshFormSectionHeight('usageInstructionsWrapper')
            }
        ];
    },

    ensureRichTextEditors() {
        if (this.richTextEditorsReady) return true;
        if (!window.AdminRichTextEditor?.ensureInjectedEditor) return false;

        const configs = this.getProductRichTextConfigs();
        configs.forEach((config) => {
            window.AdminRichTextEditor.ensureInjectedEditor(config);
        });

        this.richTextEditorsReady = configs.every(({ editorId }) => !!document.getElementById(editorId));
        return this.richTextEditorsReady;
    },

    syncRichTextEditorsFromInputs() {
        if (!this.ensureRichTextEditors()) return;

        const purchaseNotesInput = document.getElementById('prodPurchaseNotes');
        const usageInstructionsInput = document.getElementById('prodUsageInstructions');

        window.AdminRichTextEditor.setContent('productPurchaseNotes', purchaseNotesInput?.value || '', {
            syncHiddenInput: false
        });
        window.AdminRichTextEditor.setContent('productUsageInstructions', usageInstructionsInput?.value || '', {
            syncHiddenInput: false
        });
    },

    refreshFormSectionHeight(wrapperId) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;

        const currentMaxHeight = Number.parseFloat(wrapper.style.maxHeight || '0');
        if (currentMaxHeight <= 0 && wrapper.style.opacity !== '1') return;

        requestAnimationFrame(() => {
            const nextHeight = Math.max(wrapper.scrollHeight + 12, 220);
            wrapper.style.maxHeight = `${nextHeight}px`;
        });
    },

    // Translate Chinese text to English using Gemini API
    translateToEnglish: async function (name, description) {
        const apiKey = window.GEMINI_API_KEY;
        if (!apiKey) {
            console.warn('[ShopAdmin] No Gemini API key, skipping translation');
            return { name_en: null, description_en: null };
        }

        const prompt = `Translate the following Chinese product information to English. Return ONLY a JSON object with "name" and "description" fields, no markdown or extra text.

Product Name: ${name}
Description: ${description || 'N/A'}

Example output format:
{"name": "English Name", "description": "English description"}`;

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
                })
            });

            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            // Parse JSON from response
            const jsonMatch = text.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                console.log('[ShopAdmin] Translation result:', parsed);
                return {
                    name_en: parsed.name || null,
                    description_en: parsed.description || null
                };
            }
        } catch (err) {
            console.error('[ShopAdmin] Translation failed:', err);
        }
        return { name_en: null, description_en: null };
    },

    // Category Filter Logic
    filterCategory: function (category, btn) {
        this.currentCategory = category;

        // Update UI - only update category tabs, not status tabs
        const container = document.getElementById('productCategoryFilters');
        const categoryTabs = container.querySelectorAll('.filter-tab:not(.status-filter)');
        categoryTabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');

        // Reload Grid
        this.loadProducts();
    },

    // Status Filter Logic (Active vs Deleted/Recycle Bin)
    filterStatus: function (status, btn) {
        this.currentStatusFilter = status;

        // Update ALL status tabs (icon buttons)
        const allStatusTabs = document.querySelectorAll('.status-filter');
        allStatusTabs.forEach(t => {
            t.classList.remove('active');
            t.style.background = 'rgba(255,255,255,0.03)';
            t.style.borderColor = 'rgba(255,255,255,0.1)';
            t.style.color = 'rgba(255,255,255,0.5)';

            // If this tab matches the selected status, activate it
            if (t.dataset.status === status) {
                t.classList.add('active');
                if (status === 'active') {
                    t.style.background = 'rgba(74, 222, 128, 0.2)';
                    t.style.borderColor = 'rgba(74, 222, 128, 0.5)';
                    t.style.color = '#4ade80';
                } else {
                    t.style.background = 'rgba(239, 68, 68, 0.2)';
                    t.style.borderColor = 'rgba(239, 68, 68, 0.5)';
                    t.style.color = '#ef4444';
                }
            }
        });

        // Reload Grid
        this.loadProducts();
    },

    renderPagination: function (elementId, currentPage, total, pageSize, loadFuncStr) {
        const container = document.getElementById(elementId);
        if (!container) return;
        const totalPages = Math.ceil(total / pageSize) || 1;

        container.innerHTML = `
            <div style="display: flex; align-items: center; gap: 15px;">
                <div class="pagination-control">
                    <button class="pagination-btn" onclick="ShopAdmin.${loadFuncStr}(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''} style="font-family:'Outfit',sans-serif;font-weight:300;font-size:20px;">
                        −
                    </button>
                    
                    <input type="number" class="pagination-input" 
                        value="${currentPage}" min="1" max="${totalPages}"
                        onchange="let v=parseInt(this.value)||1; if(v<1)v=1; if(v>${totalPages})v=${totalPages}; ShopAdmin.${loadFuncStr}(v)">
                    
                    <button class="pagination-btn" onclick="ShopAdmin.${loadFuncStr}(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''} style="font-family:'Outfit',sans-serif;font-weight:300;font-size:20px;">
                        +
                    </button>
                </div>
                <div class="pagination-total" style="margin:0;">共 ${totalPages} 页 / ${total} 条</div>
            </div>
        `;
    },

    // Render Product Category Filter Buttons dynamically
    renderProductCategoryFilters: async function () {
        const container = document.getElementById('productCategoryFilters');
        if (!container) {
            console.log('productCategoryFilters container not found');
            return;
        }

        try {
            // Use the same category source as Import tab
            await this.loadCategories();

            console.log('Categories for filters:', this.categoryData);

            // Rebuild: first add "全部" button
            container.innerHTML = '';
            const allBtn = document.createElement('button');
            allBtn.className = 'filter-tab active';
            allBtn.textContent = '全部';
            allBtn.onclick = () => this.filterCategory('all', allBtn);
            container.appendChild(allBtn);

            // Add dynamic category buttons from categoryData
            (this.categoryData || []).forEach(cat => {
                const btn = document.createElement('button');
                btn.className = 'filter-tab';
                btn.textContent = cat.name;
                btn.onclick = () => this.filterCategory(cat.name, btn);
                container.appendChild(btn);
            });

        } catch (e) {
            console.error('Failed to load category filters:', e);
        }
    },

    init: async function () {
        // Prevent double initialization causing flash
        if (this._initialized) {
            console.log('ShopAdmin already initialized, skipping...');
            return;
        }
        this._initialized = true;

        console.log('Admin Shop Init...');
        await this.renderProductCategoryFilters();
        await this.loadProducts();
        this.ensureRichTextEditors();

        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            // Close custom dropdown menu
            const dropdown = document.querySelector('.custom-dropdown');
            const menu = document.querySelector('.custom-dropdown-menu');
            if (dropdown && menu && !dropdown.contains(e.target) && !menu.contains(e.target)) {
                menu.classList.remove('show');
            }

            // Close category dropdown in product modal
            const categoryDropdown = document.getElementById('prodCategoryDropdown');
            if (categoryDropdown && !categoryDropdown.contains(e.target)) {
                categoryDropdown.classList.remove('open');
            }
        });

        // Bind New Product Button
        if (btnNew) {
            // Remove old listeners by cloning (optional but safe)
            const newBtn = btnNew.cloneNode(true);
            btnNew.parentNode.replaceChild(newBtn, btnNew);
            newBtn.addEventListener('click', () => {
                console.log('Button Clicked');
                this.openProductModal();
            });
        }

        // Initialize with Products Tab Active
        this.switchTab('products');

        // Listen to textarea changes for line count
        const inventoryInput = document.getElementById('inventoryInput');
        if (inventoryInput) {
            inventoryInput.addEventListener('input', (e) => {
                const count = e.target.value.split('\n').filter(line => line.trim().length > 0).length;
                document.getElementById('lineCount').textContent = count;
            });
        }

        // Initialize order-related event listeners
        this._initOrderEvents();
    },

    switchTab: function (tabName) {
        this.currentTab = tabName;

        // Update Tab UI
        document.querySelectorAll('.shop-tab').forEach(el => {
            el.classList.remove('active');
            el.style.borderBottom = 'none';
            el.style.color = 'rgba(255,255,255,0.6)';

            if (el.onclick.toString().includes(tabName)) {
                el.classList.add('active');
                el.style.borderBottom = '2px solid #6b9ece';
                el.style.color = '#fff';
            }
        });

        // Hide all views
        document.querySelectorAll('.shop-view').forEach(el => el.style.display = 'none');

        // Show target view
        document.getElementById(`shop-view-${tabName}`).style.display = 'block';

        // Load Data
        if (tabName === 'products') {
            this.renderProductCategoryFilters();
            this.loadProducts();
        }
        if (tabName === 'import') this.initImportView();
        if (tabName === 'inventory') this.initInventoryBrowser(); // Renamed from loadInventoryProductList, consistent with previous edit
        if (tabName === 'orders') this.searchOrders();
    },

    // ==================== Products (Grid View) ====================
    loadProducts: async function () {
        const container = document.getElementById('productsGrid');
        if (!container) return; // Grid container might be missing if HTML update failed

        container.innerHTML = '<div class="loading-spinner">Loading...</div>';

        // Add Grid Style dynamically if not in CSS
        container.style.display = 'grid';
        container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
        container.style.gap = '20px';
        container.style.padding = '10px 0';

        try {
            let query = supabaseClient
                .from('shop_products')
                .select('*')
                .order('display_order', { ascending: false });

            // Apply Status Filter (active vs deleted/recycle bin)
            if (this.currentStatusFilter === 'active') {
                query = query.eq('is_active', true);
            } else {
                query = query.eq('is_active', false);
            }

            // Apply Category Filter
            if (this.currentCategory !== 'all') {
                query = query.eq('category', this.currentCategory);
            }

            const { data, error } = await query;

            if (error) throw error;

            container.innerHTML = '';

            // Add "New Product" Card
            const addCard = document.createElement('div');
            addCard.className = 'shop-card add-new-card';
            addCard.style.cssText = `
                display: flex; flex-direction: column; align-items: center; justify-content: center;
                background: rgba(255, 255, 255, 0.05); border: 2px dashed rgba(255, 255, 255, 0.2);
                border-radius: 12px; min-height: 200px; cursor: pointer; transition: all 0.3s ease;
            `;
            addCard.innerHTML = `
                <div style="font-size: 40px; color: rgba(255,255,255,0.3); margin-bottom: 10px;">+</div>
                <div style="color: rgba(255,255,255,0.6);">新建商品</div>
            `;
            addCard.onclick = () => ShopAdmin.openProductModal();
            addCard.onmouseover = () => { addCard.style.background = 'rgba(255,255,255,0.1)'; addCard.style.borderColor = '#6b9ece'; };
            addCard.onmouseout = () => { addCard.style.background = 'rgba(255,255,255,0.05)'; addCard.style.borderColor = 'rgba(255,255,255,0.2)'; };
            container.appendChild(addCard);

            if (!data || data.length === 0) return;

            data.forEach(p => {
                const iconHtml = p.icon_url?.startsWith('fa')
                    ? `<i class="${p.icon_url}" style="font-size: 24px; color: #6b9ece;"></i>`
                    : (p.icon_url ? `<img src="${p.icon_url}" width="40" style="border-radius:8px;">` : '<i class="fas fa-box" style="font-size: 24px;"></i>');

                const statusBadge = p.is_active
                    ? '<span class="status-badge status-active" style="display:inline-block; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:500; color:#4ade80; background:rgba(40, 40, 40, 0.6); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); border:1px solid rgba(74, 222, 128, 0.3); box-shadow:0 2px 10px rgba(0, 0, 0, 0.2); min-width:auto;">上架中</span>'
                    : '<span class="status-badge status-inactive" style="display:inline-block; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:500; color:#94a3b8; background:rgba(40, 40, 40, 0.6); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); border:1px solid rgba(148, 163, 184, 0.3); box-shadow:0 2px 10px rgba(0, 0, 0, 0.2); min-width:auto;">已下架</span>';

                const stock = p.stock_count || 0;
                const stockColor = stock < 5 ? '#ff4d4f' : '#389e0d';

                const card = document.createElement('div');
                card.className = 'shop-card' + (p.is_active ? '' : ' inactive-product');
                card.style.cssText = `
                    background: rgba(30, 35, 50, 0.6); 
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 16px; 
                    padding: 0; 
                    display: flex;
                    flex-direction: column;
                    overflow: hidden; 
                    transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
                    backdrop-filter: blur(10px);
                `;
                // ... (skip mouseover/out as they are fine)

                const imageContainerStyle = `
                    width: 100%;
                    height: 160px;
                    background: rgba(56, 189, 248, 0.1);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                `;

                // If it's an image, make it cover. If icon, keep it centered.
                const displayHtml = p.icon_url?.startsWith('http')
                    ? `<img src="${p.icon_url}" style="width:100%; height:100%; object-fit:cover;">`
                    : iconHtml.replace('font-size: 24px', 'font-size: 48px');

                // Checkbox display based on selection mode
                const checkboxDisplay = this.isProductSelectionMode ? 'block' : 'none';

                card.innerHTML = `
                    <div style="${imageContainerStyle}">
                        ${displayHtml}
                        <div style="position:absolute; top:12px; left:12px; display:${checkboxDisplay};" class="product-checkbox-wrapper">
                            <input type="checkbox" class="inv-checkbox product-select-checkbox" data-product-id="${p.id}" 
                                onclick="event.stopPropagation(); ShopAdmin.updateProductSelectionCount();">
                        </div>
                        <div style="position:absolute; top:12px; right:12px;">${statusBadge}</div>
                    </div>
                    
                    <div style="padding: 24px; padding-bottom: 12px; flex: 1; display: flex; flex-direction: column;">
                        <h3 style="margin:0 0 6px 0; font-size:16px; font-weight:600; color:#fff; line-height:1.4;">${p.name}</h3>
                        <p style="margin:0; font-size:13px; color:rgba(255,255,255,0.5); line-height:1.5; height:40px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${p.description || '暂无描述'}</p>
                    </div>
                    
                    <div style="margin-top:0; padding:15px 24px 20px; border-top:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            ${(() => {
                        const editSite = ShopAdmin.getEditSite();
                        if (editSite === 'intl') {
                            const intlPrice = p.price_points_intl;
                            return intlPrice != null
                                ? `<div style="font-weight:700; color:#60a5fa; font-size:16px;">${intlPrice} <span style="font-size:12px; font-weight:normal; opacity:0.8;">Points</span></div>`
                                : `<div style="font-weight:700; color:rgba(255,255,255,0.3); font-size:14px;">未设置国际价格</div>`;
                        } else {
                            return `<div style="font-weight:700; color:#fbbf24; font-size:16px;">${p.price_points} <span style="font-size:12px; font-weight:normal; opacity:0.8;">积分</span></div>`;
                        }
                    })()}
                            <div style="font-size:12px; color:${stockColor}; margin-top:2px; font-weight:500;">库存: ${stock}</div>
                        </div>
                        
                        <div style="display:flex; gap:8px;">
                           <button class="action-btn" onclick="ShopAdmin.editProduct('${p.id}')" title="编辑"
                                style="width:32px; height:32px; border-radius:8px; border:none; background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.7); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
                                <i class="fas fa-edit" style="font-size:14px;"></i>
                           </button>
                           <button class="action-btn" onclick="ShopAdmin.toggleStatus('${p.id}', ${!p.is_active})" title="${p.is_active ? '下架' : '上架'}"
                                style="width:32px; height:32px; border-radius:8px; border:none; background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.7); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
                                <i class="fas fa-${p.is_active ? 'eye-slash' : 'eye'}" style="font-size:14px;"></i>
                           </button>
                           <button class="action-btn" onclick="ShopAdmin.deleteProduct('${p.id}', '${p.name}')" title="删除"
                                style="width:32px; height:32px; border-radius:8px; border:none; background:rgba(255,80,80,0.1); color:#ff6b6b; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
                                <i class="fas fa-trash" style="font-size:14px;"></i>
                           </button>
                        </div>
                    </div>
`;
                // Add hover effect via JS since inline styles are tricky for pseudo-classes
                const btns = card.querySelectorAll('.action-btn');
                btns.forEach(btn => {
                    btn.onmouseover = () => {
                        if (btn.title === '删除') { btn.style.background = 'rgba(255,80,80,0.2)'; }
                        else { btn.style.background = 'rgba(255,255,255,0.15)'; btn.style.color = '#fff'; }
                    };
                    btn.onmouseout = () => {
                        if (btn.title === '删除') { btn.style.background = 'rgba(255,80,80,0.1)'; }
                        else { btn.style.background = 'rgba(255,255,255,0.05)'; btn.style.color = 'rgba(255,255,255,0.7)'; }
                    };
                    // Stop propagation on buttons to prevent triggering card selection
                    // Use addEventListener instead of onclick to avoid overwriting HTML onclick attribute
                    btn.addEventListener('click', (e) => e.stopPropagation());
                });

                // Card Click Selection
                card.onclick = (e) => {
                    if (this.isProductSelectionMode) {
                        // Avoid triggering if clicking on buttons (though stopPropagation above helps)
                        if (e.target.closest('.action-btn')) return;

                        const checkbox = card.querySelector('.product-select-checkbox');
                        if (checkbox) {
                            checkbox.checked = !checkbox.checked;
                            ShopAdmin.updateProductSelectionCount();
                        }
                    }
                };

                // Add pointer cursor in selection mode
                if (this.isProductSelectionMode) {
                    card.style.cursor = 'pointer';
                }

                container.appendChild(card);
            });

            // Refresh sidebar list
            this.loadInventoryProductList(data);

        } catch (err) {
            console.error(err);
            container.innerHTML = `<div style="color:red;">Error: ${err.message}</div>`;
        }
    },

    // ==================== Product Selection Mode ====================
    toggleProductSelectionMode: function () {
        this.isProductSelectionMode = !this.isProductSelectionMode;
        const btn = document.getElementById('toggleProductSelectionBtn');
        const batchBtn = document.getElementById('productBatchActionsBtn');
        const batchMenu = document.getElementById('productBatchActionMenu');
        const checkboxes = document.querySelectorAll('.product-checkbox-wrapper');
        // Find product cards by excluding the first one (Add New) which has class 'add-new-card'
        // Or better, select parent of checkboxes
        const productCards = Array.from(checkboxes).map(cb => cb.closest('.shop-card'));

        if (this.isProductSelectionMode) {
            btn.classList.add('active');
            if (batchBtn) batchBtn.style.display = 'flex';
            checkboxes.forEach(el => el.style.display = 'block');
            productCards.forEach(card => card.style.cursor = 'pointer');
        } else {
            btn.classList.remove('active');
            if (batchBtn) batchBtn.style.display = 'none';
            if (batchMenu) batchMenu.style.display = 'none';
            checkboxes.forEach(el => {
                el.style.display = 'none';
                el.querySelector('input').checked = false;
            });
            productCards.forEach(card => card.style.cursor = 'default');
            this.updateProductSelectionCount();
        }
    },

    /* Dynamic Batch Menu Handling */
    _batchMenuCloseHandler: null,

    closeProductBatchMenu: function () {
        const menu = document.getElementById('productBatchActionMenu');
        if (menu) menu.style.display = 'none';
        if (this._batchMenuCloseHandler) {
            document.removeEventListener('click', this._batchMenuCloseHandler);
            this._batchMenuCloseHandler = null;
        }
    },

    toggleProductBatchMenu: function () {
        const menu = document.getElementById('productBatchActionMenu');
        const btn = document.getElementById('productBatchActionsBtn');
        if (!menu) return;

        const isVisible = menu.style.display === 'block';

        if (isVisible) {
            this.closeProductBatchMenu();
        } else {
            menu.style.display = 'block';
            this.updateProductSelectionCount();

            // Cleanup existing if any (edge case)
            if (this._batchMenuCloseHandler) {
                document.removeEventListener('click', this._batchMenuCloseHandler);
            }

            // Define handler
            this._batchMenuCloseHandler = (e) => {
                // If click is inside menu or on the toggle button, ignore
                if (menu.contains(e.target) || (btn && btn.contains(e.target))) {
                    return;
                }
                this.closeProductBatchMenu();
            };

            // Add listener asynchronously to avoid immediate trigger
            setTimeout(() => {
                document.addEventListener('click', this._batchMenuCloseHandler);
            }, 0);
        }
    },

    updateProductSelectionCount: function () {
        const count = document.querySelectorAll('.product-select-checkbox:checked').length;
        const countEl = document.getElementById('productBatchSelectedCount');
        if (countEl) countEl.textContent = count;
    },

    selectAllProducts: function () {
        const checkboxes = document.querySelectorAll('.product-select-checkbox');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);

        checkboxes.forEach(cb => cb.checked = !allChecked);
        this.updateProductSelectionCount();

        // Keep menu open
        const menu = document.getElementById('productBatchActionMenu');
        if (menu) menu.style.display = 'block';
    },

    batchDeleteProducts: async function () {
        const selectedIds = Array.from(document.querySelectorAll('.product-select-checkbox:checked'))
            .map(cb => cb.dataset.productId);

        if (selectedIds.length === 0) {
            alert('请先选择要删除的商品');
            return;
        }

        if (!confirm(`确定删除这 ${selectedIds.length} 个商品吗？商品将被下架但保留历史订单记录。`)) return;

        try {
            // Soft delete: set is_active=false instead of hard delete
            // This preserves order history (foreign key references)
            const { error } = await supabaseClient
                .from('shop_products')
                .update({ is_active: false })
                .in('id', selectedIds);

            if (error) throw error;

            // Exit selection mode and refresh
            this.isProductSelectionMode = true; // Will be toggled off by next line
            this.toggleProductSelectionMode(); // Exit mode
            await this.loadProducts();

            alert(`成功删除 ${selectedIds.length} 个商品`);
        } catch (err) {
            console.error('Batch delete failed:', err);
            alert('删除失败: ' + err.message);
        }
    },

    exportProducts: async function (selectedOnly = false) {
        try {
            let products;
            if (selectedOnly) {
                const selectedIds = Array.from(document.querySelectorAll('.product-select-checkbox:checked'))
                    .map(cb => cb.dataset.productId);

                if (selectedIds.length === 0) {
                    alert('请先选择要导出的商品');
                    return;
                }

                const { data, error } = await supabaseClient
                    .from('shop_products')
                    .select('*')
                    .in('id', selectedIds);

                if (error) throw error;
                products = data;
            } else {
                const { data, error } = await supabaseClient
                    .from('shop_products')
                    .select('*')
                    .order('display_order', { ascending: false });

                if (error) throw error;
                products = data;
            }

            // Convert to CSV
            const headers = ['ID', '名称', '名称(EN)', '分类', '价格(积分)', '价格(Points)', '状态', '库存', '描述', '描述(EN)'];
            const rows = products.map(p => [
                p.id,
                p.name,
                p.name_en || '',
                p.category,
                p.price_points,
                p.price_points_intl != null ? p.price_points_intl : '',
                p.is_active ? '上架' : '下架',
                p.stock_count || 0,
                (p.description || '').replace(/,/g, '，'),
                (p.description_en || '').replace(/,/g, '，')
            ]);

            const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
            const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `products_export_${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            URL.revokeObjectURL(url);

            // Close menu
            const menu = document.getElementById('productBatchActionMenu');
            if (menu) menu.style.display = 'none';
        } catch (err) {
            console.error('Export failed:', err);
            alert('导出失败: ' + err.message);
        }
    },

    updatePreview: function () {
        const name = document.getElementById('prodName').value || '商品名称';
        const price = document.getElementById('prodPrice').value || '0';
        const iconInput = document.getElementById('prodIcon').value || 'fas fa-box';
        const desc = document.getElementById('prodDesc').value || '无描述...';

        document.getElementById('previewTitle').textContent = name;
        document.getElementById('previewPrice').textContent = `${price} 积分`;
        document.getElementById('previewDesc').textContent = desc.length > 50 ? desc.substring(0, 50) + '...' : desc;

        // Icon Logic
        const iconBox = document.getElementById('previewIconBox');
        if (iconInput.startsWith('http') || iconInput.startsWith('data:image')) {
            iconBox.innerHTML = `<img src="${iconInput}" style="width:100%; height:100%; object-fit:cover; border-radius:12px;">`;
        } else {
            // Assume FontAwesome class
            iconBox.innerHTML = `<i class="${iconInput}"></i>`;
        }
    },

    handleIconUpload: async function (input) {
        if (!input.files || input.files.length === 0) return;
        const file = input.files[0];

        const uploadText = document.querySelector('.upload-text');
        const iconBox = document.querySelector('.upload-box');

        uploadText.textContent = '⏳ 压缩上传中...';
        iconBox.style.opacity = '0.7';

        try {
            // 1. Compress Image
            const compressedBlob = await this.compressImage(file);

            // 2. Convert to Base64
            const base64Data = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(compressedBlob);
            });

            // 3. Get current user session
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (!session) {
                throw new Error('请先登录');
            }

            // 4. Upload to R2 via Edge Function
            uploadText.textContent = '⏳ 上传到 R2...';
            const productId = document.getElementById('editProductId').value || `product_${Date.now()}`;

            const response = await fetch(
                'https://mmkugdibsaeoevliebzk.supabase.co/functions/v1/upload-avatar',
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        userId: session.user.id,
                        type: 'product',
                        productId: productId,
                        imageData: base64Data
                    })
                }
            );

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Upload failed');
            }

            const { imageUrl } = await response.json();

            // 5. Set value
            document.getElementById('prodIcon').value = imageUrl;

            // 6. Update Preview
            this.updatePreview();

            uploadText.textContent = '✅ 上传成功';
            setTimeout(() => {
                uploadText.textContent = '点击更换图片 (支持 JPG, PNG, WebP)';
                iconBox.style.opacity = '1';
            }, 2000);

            console.log('✅ Product image uploaded to R2:', imageUrl);

        } catch (err) {
            console.error('Upload failed:', err);
            alert('上传失败: ' + err.message);
            uploadText.textContent = '❌ 上传失败';
            iconBox.style.opacity = '1';
        }
    },

    // Helper: Image Compression
    compressImage: function (file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    // Max dimensions
                    const MAX_WIDTH = 1200;
                    const MAX_HEIGHT = 1200;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);

                    // Convert to WebP with 0.8 quality
                    canvas.toBlob((blob) => {
                        if (!blob) {
                            reject(new Error('Canvas to Blob failed'));
                            return;
                        }
                        resolve(blob);
                    }, 'image/webp', 0.8);
                };
                img.onerror = (err) => reject(err);
            };
            reader.onerror = (err) => reject(err);
        });
    },

    // Populate the category dropdown in product modal
    // Populate the custom category dropdown in product modal
    populateCategoryDropdown: async function () {
        const optionsContainer = document.getElementById('prodCategoryOptions');
        if (!optionsContainer) return;

        try {
            // Use categoryData from loadCategories
            await this.loadCategories();

            const categories = this.categoryData || [];

            let optionsHtml = categories.map(cat => {
                const color = cat.color || '#6b9ece';
                return `<div class="custom-category-option" onclick="ShopAdmin.selectCategory('${cat.name}', '${color}')">
                    <span class="option-dot" style="background: ${color}"></span>
                    <span>${cat.name}</span>
                </div>`;
            }).join('');

            // If no categories, add default
            if (categories.length === 0) {
                optionsHtml = `<div class="custom-category-option" onclick="ShopAdmin.selectCategory('other', '#9aa0a6')">
                    <span class="option-dot" style="background: #9aa0a6"></span>
                    <span>其他</span>
                </div>`;
            }

            // Add "Create new category" option at the bottom
            optionsHtml += `<div class="custom-category-option add-new-category" onclick="ShopAdmin.showAddCategoryInput(event)" style="border-top: 1px solid rgba(255,255,255,0.1); margin-top: 6px; padding-top: 12px; color: #6b9ece;">
                <i class="fas fa-plus" style="width: 10px; text-align: center; font-size: 10px;"></i>
                <span>添加新分类</span>
            </div>`;

            // Add input container (hidden by default)
            optionsHtml += `<div id="newCategoryInputContainer" style="display: none; padding: 12px; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 6px; box-sizing: border-box;">
                <input type="text" id="newCategoryName" placeholder="输入分类名称" 
                    style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08); color: #fff; font-size: 13px; outline: none; box-sizing: border-box;"
                    onkeydown="if(event.key==='Enter') ShopAdmin.saveNewCategory()" onclick="event.stopPropagation()">
                <div style="display: flex; gap: 10px; margin-top: 10px;">
                    <button onclick="event.stopPropagation(); ShopAdmin.cancelAddCategory()" style="flex:1; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.7); cursor: pointer; font-size: 13px; transition: all 0.2s;">取消</button>
                    <button onclick="event.stopPropagation(); ShopAdmin.saveNewCategory()" style="flex:1; padding: 8px 12px; border-radius: 8px; border: none; background: linear-gradient(135deg, #6b9ece 0%, #5a8fc0 100%); color: #fff; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.2s;">确定</button>
                </div>
            </div>`;

            optionsContainer.innerHTML = optionsHtml;
        } catch (e) {
            console.error('Failed to populate category dropdown:', e);
        }
    },

    // Show input field for adding new category
    showAddCategoryInput: function (event) {
        event.stopPropagation();
        const inputContainer = document.getElementById('newCategoryInputContainer');
        const addBtn = document.querySelector('.add-new-category');
        if (inputContainer) {
            inputContainer.style.display = 'block';
            addBtn.style.display = 'none';
            document.getElementById('newCategoryName').focus();
        }
    },

    // Cancel adding new category
    cancelAddCategory: function () {
        const inputContainer = document.getElementById('newCategoryInputContainer');
        const addBtn = document.querySelector('.add-new-category');
        if (inputContainer) {
            inputContainer.style.display = 'none';
            addBtn.style.display = 'flex';
            document.getElementById('newCategoryName').value = '';
        }
    },

    // Pending new category (not yet saved to database)
    pendingCategory: null,

    // Save new category (deferred - only stores temporarily until product is saved)
    saveNewCategory: async function () {
        const nameInput = document.getElementById('newCategoryName');
        const name = nameInput.value.trim();

        if (!name) {
            alert('请输入分类名称');
            return;
        }

        // Check if category already exists
        const exists = this.categoryData.some(c => c.name.toLowerCase() === name.toLowerCase());
        if (exists) {
            alert('该分类已存在');
            return;
        }

        // Generate a random pastel color
        const colors = ['#6b9ece', '#f4b400', '#4ade80', '#a78bfa', '#f472b6', '#fb923c', '#22d3d8'];
        const color = colors[Math.floor(Math.random() * colors.length)];

        // Store pending category (will be saved when product is saved)
        this.pendingCategory = { name, color };

        // Add to dropdown temporarily and select it
        const optionsContainer = document.getElementById('prodCategoryOptions');
        const addNewBtn = document.querySelector('.add-new-category');

        // Insert new option before the "add new" button
        const newOptionHtml = `<div class="custom-category-option pending-category" onclick="ShopAdmin.selectCategory('${name}', '${color}')">
            <span class="option-dot" style="background: ${color}"></span>
            <span>${name}</span>
            <span style="font-size: 10px; color: rgba(255,255,255,0.4); margin-left: auto;">(新)</span>
        </div>`;
        addNewBtn.insertAdjacentHTML('beforebegin', newOptionHtml);

        // Select the new category
        this.selectCategory(name, color);

        // Hide input and clear
        this.cancelAddCategory();

        console.log('Pending category set:', this.pendingCategory);
    },

    // Toggle the custom category dropdown
    toggleCategoryDropdown: function () {
        const dropdown = document.getElementById('prodCategoryDropdown');
        if (dropdown) {
            dropdown.classList.toggle('open');
        }
    },

    // Select a category from the custom dropdown
    selectCategory: function (categoryName, categoryColor) {
        // Update hidden input value
        document.getElementById('prodCategory').value = categoryName;

        // Update display
        const dropdown = document.getElementById('prodCategoryDropdown');
        const nameSpan = dropdown.querySelector('.category-name');
        const colorDot = dropdown.querySelector('.category-color-dot');

        nameSpan.textContent = categoryName;
        colorDot.style.background = categoryColor || '#6b9ece';

        // Update selected state on options
        document.querySelectorAll('.custom-category-option').forEach(opt => {
            opt.classList.remove('selected');
            if (opt.textContent.trim() === categoryName) {
                opt.classList.add('selected');
            }
        });

        // Close dropdown
        dropdown.classList.remove('open');
    },

    toggleFormSection: function (wrapperId, show) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;
        if (show) {
            wrapper.style.opacity = '1';
            wrapper.style.marginTop = '8px';
            requestAnimationFrame(() => this.refreshFormSectionHeight(wrapperId));
        } else {
            wrapper.style.maxHeight = '0';
            wrapper.style.opacity = '0';
            wrapper.style.marginTop = '0';
        }
    },

    // Toggle purchase notes textarea visibility with animation
    togglePurchaseNotes: function (show) {
        this.toggleFormSection('purchaseNotesWrapper', show);
    },

    // Toggle usage instructions textarea visibility with animation
    toggleUsageInstructions: function (show) {
        this.toggleFormSection('usageInstructionsWrapper', show);
    },

    buildExistingProductUpsertPayload: function (id, payload) {
        const snapshot = this.editingProductSnapshot && this.editingProductSnapshot.id === id
            ? this.editingProductSnapshot
            : null;

        const upsertPayload = { id, ...payload };

        if (upsertPayload.name == null) {
            const fallbackName = typeof snapshot?.name === 'string' ? snapshot.name.trim() : '';
            if (!fallbackName) {
                throw new Error('缺少商品基础名称，无法保存现有商品');
            }
            upsertPayload.name = fallbackName;
        }

        if (upsertPayload.price_points == null) {
            const fallbackPrice = Number.parseInt(snapshot?.price_points, 10);
            if (!Number.isFinite(fallbackPrice) || fallbackPrice < 0) {
                throw new Error('缺少商品基础价格，无法保存现有商品');
            }
            upsertPayload.price_points = fallbackPrice;
        }

        return upsertPayload;
    },

    isPurchaseNotesSchemaError: function (err) {
        const message = `${err?.message || ''} ${err?.details || ''} ${err?.hint || ''}`.toLowerCase();
        return message.includes('purchase_notes') || message.includes('show_purchase_notes');
    },

    getFriendlySaveErrorMessage: function (err) {
        if (this.isPurchaseNotesSchemaError(err)) {
            this.purchaseNotesSchemaAvailable = false;
            return '保存失败：当前 Supabase 数据库还没有“注意事项”字段。请先执行 `supabase/add_purchase_notes.sql`，再保存商品。';
        }

        const details = [err?.message, err?.details, err?.hint].filter(Boolean).join(' | ');
        return `Save failed: ${details}`;
    },

    // Toggle Custom Delivery Type Dropdown
    toggleDeliveryTypeDropdown: function (e) {
        if (e) e.stopPropagation();
        const dropdown = document.getElementById('prodDeliveryTypeDropdown');
        if (dropdown) dropdown.classList.toggle('open');
    },

    // Handle selection from custom dropdown — fully self-contained
    selectDeliveryType: function (newType, typeName) {
        const dropdown = document.getElementById('prodDeliveryTypeDropdown');
        if (dropdown) dropdown.classList.remove('open');

        const input = document.getElementById('prodDeliveryType');
        if (!input) return;
        const previousType = input.value;
        if (previousType === newType) return;

        // Show confirmation modal
        const warningText = newType === 'API'
            ? '切换为 API 模式后，系统将停止从卡密池发货，改为向您提供的 Webhook 地址发送 POST 请求。<br><br>请确保您的接口已准备就绪。'
            : '切换为卡密模式后，系统将自动从库存池中提取尚未使用的卡密发给买家。<br><br>请确保底层库存充足。';

        const modalId = 'deliveryConfirmModal';
        let modal = document.getElementById(modalId);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = modalId;
            modal.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.55); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); z-index:10000; align-items:center; justify-content:center;';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div style="background: rgba(18, 22, 36, 0.95); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 30px; width: 90%; max-width: 400px; box-shadow: 0 24px 60px rgba(0,0,0,0.5); animation: modalFadeIn 0.3s ease-out;">
                <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px;">
                    <div style="width:40px; height:40px; border-radius:12px; background:rgba(239, 68, 68, 0.1); display:flex; align-items:center; justify-content:center; color:#ef4444;">
                        <i class="fas fa-exclamation-triangle" style="font-size:18px;"></i>
                    </div>
                    <h3 style="margin:0; font-size:1.1rem; color:#fff; font-weight:600;">切换发货模式</h3>
                </div>
                <div style="color:rgba(255,255,255,0.7); font-size:0.95rem; line-height:1.6; margin-bottom:24px;">
                    即将发货模式切换为 <strong style="color:#6b9ece;">${typeName}</strong>。<br><br>
                    <span style="color:rgba(255,255,255,0.5); font-size:0.85rem;">${warningText}</span>
                </div>
                <div style="display:flex; gap:12px;">
                    <button id="cancelDeliveryChange" style="flex:1; padding:10px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:rgba(255,255,255,0.7); cursor:pointer; font-size:0.95rem; transition:all 0.2s;">取消</button>
                    <button id="confirmDeliveryChange" style="flex:1; padding:10px; background:#ef4444; border:none; border-radius:8px; color:#fff; cursor:pointer; font-size:0.95rem; font-weight:500; transition:all 0.2s;">确定切换</button>
                </div>
            </div>
        `;

        modal.style.display = 'flex';

        document.getElementById('cancelDeliveryChange').onclick = function () {
            modal.style.display = 'none';
        };

        document.getElementById('confirmDeliveryChange').onclick = function () {
            // Apply the change
            input.value = newType;
            var nameLabel = document.getElementById('prodDeliveryTypeName');
            if (nameLabel) nameLabel.textContent = typeName;
            // Toggle webhook field
            var group = document.getElementById('webhookTargetGroup');
            if (group) group.style.display = (newType === 'API') ? 'block' : 'none';
            modal.style.display = 'none';
        };
    },

    // Toggle Webhook field visibility
    toggleWebhookField: function (deliveryType) {
        const group = document.getElementById('webhookTargetGroup');
        if (group) {
            group.style.display = (deliveryType === 'API') ? 'block' : 'none';
        }
    },

    // Legacy handler kept for backward compatibility — no longer used by custom dropdown
    handleDeliveryTypeChange: function (selectElement) {
        if (!selectElement || !selectElement.value) return;
        var newType = selectElement.value;
        var label = newType === 'API' ? '外部接口履约 (API Webhook)' : '卡密池发放 (KEY)';
        this.selectDeliveryType(newType, label);
    },

    openProductModal: async function (isEdit = false) {
        console.log('Opening Modal', isEdit); // Debug
        const modal = document.getElementById('productModal');
        if (!modal) { alert('Modal not found in DOM'); return; }
        this.ensureRichTextEditors();

        // Populate category dropdown first
        await this.populateCategoryDropdown();

        const title = document.getElementById('productModalTitle');
        const siteEmoji = this.getEditSite() === 'intl' ? ' 🌍' : ' 🇨🇳';
        title.textContent = (isEdit ? '编辑商品' : '新建商品') + siteEmoji;
        modal.style.display = 'flex'; // Ensure Flex is set to center it

        // Force visibility properties
        modal.style.opacity = '1';
        modal.style.visibility = 'visible';
        modal.classList.add('active'); // In case CSS uses .active for transition
        modal.style.zIndex = '9999';

        if (!isEdit) {
            this.editingProductSnapshot = null;
            document.getElementById('editProductId').value = '';
            document.getElementById('prodName').value = '';
            document.getElementById('prodPrice').value = '';
            document.getElementById('prodIcon').value = '';

            // Use current category filter as default, or fall back to first option
            let defaultCategory = null;
            if (this.currentCategory && this.currentCategory !== 'all') {
                // Find the category in our data to get its color
                const catData = this.categoryData.find(c => c.name === this.currentCategory);
                if (catData) {
                    this.selectCategory(catData.name, catData.color);
                    defaultCategory = catData;
                }
            }

            // If no current category or it's 'all', select first available
            if (!defaultCategory) {
                const firstOption = document.querySelector('#prodCategoryOptions .custom-category-option');
                if (firstOption) {
                    firstOption.click(); // This will trigger selectCategory
                } else {
                    // Fallback to default
                    this.selectCategory('other', '#9aa0a6');
                }
            }

            document.getElementById('prodDesc').value = '';
            document.getElementById('prodSort').value = '0';

            document.getElementById('prodSort').value = '0';

            // Reset marketing fields
            this.renderTieredPricingRules([]);
            document.getElementById('prodFlashSalePrice').value = '';
            document.getElementById('prodFlashSaleEnd').value = '';

            // Reset delivery fields
            document.getElementById('prodDeliveryType').value = 'KEY';
            const nameLabel = document.getElementById('prodDeliveryTypeName');
            if (nameLabel) nameLabel.textContent = '卡密池发放 (KEY)';
            document.getElementById('prodWebhookTarget').value = '';
            this.toggleWebhookField('KEY');

            // Reset purchase notes
            document.getElementById('prodShowPurchaseNotes').checked = false;
            document.getElementById('prodPurchaseNotes').value = '';
            this.togglePurchaseNotes(false);

            // Reset usage instructions
            document.getElementById('prodShowUsageInstructions').checked = false;
            document.getElementById('prodUsageInstructions').value = '';
            this.toggleUsageInstructions(false);
        }

        // Update labels for current site context
        this.updateModalLabels();
        this.syncRichTextEditorsFromInputs();
        this.refreshFormSectionHeight('purchaseNotesWrapper');
        this.refreshFormSectionHeight('usageInstructionsWrapper');

        // Trigger initial preview update
        this.updatePreview();
    },

    editProduct: async function (id) {
        const { data } = await supabaseClient.from('shop_products').select('*').eq('id', id).single();
        if (data) {
            this.editingProductSnapshot = data;
            const fields = this.getFieldMap();
            const sortValue = Number.parseInt(data.display_order, 10);
            const normalizedDeliveryType = data.delivery_type === 'API' ? 'API' : 'KEY';

            document.getElementById('editProductId').value = data.id;
            document.getElementById('prodName').value = data[fields.name] || '';
            document.getElementById('prodPrice').value = data[fields.price] != null ? data[fields.price] : '';
            document.getElementById('prodIcon').value = data.icon_url;
            document.getElementById('prodDesc').value = data[fields.desc] || '';
            document.getElementById('prodSort').value = Number.isFinite(sortValue) ? sortValue : 0;

            // Populate marketing fields (Phase 2)
            let parsedRules = [];
            if (data.quantity_rules && Array.isArray(data.quantity_rules)) {
                parsedRules = data.quantity_rules;
            } else if (typeof data.quantity_rules === 'string' && data.quantity_rules.trim() !== '') {
                try {
                    parsedRules = JSON.parse(data.quantity_rules);
                } catch (e) {
                    console.error("Failed to parse quantity rules:", e);
                }
            }
            this.renderTieredPricingRules(parsedRules);

            document.getElementById('prodFlashSalePrice').value = data.flash_sale_price != null ? data.flash_sale_price : '';
            if (data.flash_sale_end) {
                const date = new Date(data.flash_sale_end);
                const localIso = new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
                document.getElementById('prodFlashSaleEnd').value = localIso;
            } else {
                document.getElementById('prodFlashSaleEnd').value = '';
            }

            // Populate delivery fields
            const deliveryType = normalizedDeliveryType;
            document.getElementById('prodDeliveryType').value = deliveryType;
            const typeName = deliveryType === 'API' ? '外部接口履约 (API Webhook)' : '卡密池发放 (KEY)';
            const nameLabel = document.getElementById('prodDeliveryTypeName');
            if (nameLabel) nameLabel.textContent = typeName;

            document.getElementById('prodWebhookTarget').value = data.webhook_target || '';
            this.toggleWebhookField(deliveryType);

            // Populate purchase notes
            const showPurchaseNotes = !!data.show_purchase_notes;
            document.getElementById('prodShowPurchaseNotes').checked = showPurchaseNotes;
            document.getElementById('prodPurchaseNotes').value = typeof data.purchase_notes === 'string' ? data.purchase_notes : '';
            this.togglePurchaseNotes(showPurchaseNotes);

            // Populate usage instructions
            const showUI = !!data.show_usage_instructions;
            document.getElementById('prodShowUsageInstructions').checked = showUI;
            document.getElementById('prodUsageInstructions').value = typeof data.usage_instructions === 'string' ? data.usage_instructions : '';
            this.toggleUsageInstructions(showUI);

            await this.openProductModal(true);

            // Set category value in custom dropdown (after modal opens and populates dropdown)
            const categoryName = data.category || 'other';
            const categoryData = this.categoryData.find(c => c.name === categoryName);
            const categoryColor = categoryData?.color || '#6b9ece';
            this.selectCategory(categoryName, categoryColor);

            // Trigger preview update after data population
            this.updatePreview();
        }
    },

    saveProduct: async function () {
        console.log('[ShopAdmin] saveProduct started');
        try {
            const id = document.getElementById('editProductId').value;
            const name = document.getElementById('prodName').value.trim();
            const price = document.getElementById('prodPrice').value;
            const description = document.getElementById('prodDesc').value;
            console.log('[ShopAdmin] Base fields read successfully');

            if (!name || !price) { alert('名称和价格必填'); return; }
            const normalizedPrice = Number.parseInt(price, 10);
            if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
                alert('价格格式错误');
                return;
            }

            // Auto-translate to English if Gemini API is available
            let name_en = null, description_en = null;
            try {
                const saveBtn = document.querySelector('#productModal .primary-btn');
                if (saveBtn) {
                    saveBtn.disabled = true;
                    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 翻译中...';
                }
                const translation = await this.translateToEnglish(name, description);
                name_en = translation.name_en;
                description_en = translation.description_en;
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '保存';
                }
            } catch (e) {
                console.warn('[ShopAdmin] Translation step failed, continuing without:', e);
            }

            const fields = this.getFieldMap();
            const editSite = this.getEditSite();
            const sortInput = document.getElementById('prodSort').value;
            const parsedSort = Number.parseInt(sortInput, 10);
            const normalizedSort = Number.isFinite(parsedSort) ? parsedSort : 0;
            const deliveryTypeValue = document.getElementById('prodDeliveryType').value;
            const normalizedDeliveryType = deliveryTypeValue === 'API' ? 'API' : 'KEY';
            if (window.AdminRichTextEditor?.syncHiddenInput) {
                window.AdminRichTextEditor.syncHiddenInput('productPurchaseNotes', false);
                window.AdminRichTextEditor.syncHiddenInput('productUsageInstructions', false);
            }
            const rawUsageInstructions = document.getElementById('prodUsageInstructions').value || '';
            const normalizedUsageInstructions = rawUsageInstructions.replace(/\r\n/g, '\n').trim();
            const showUsageInstructions = document.getElementById('prodShowUsageInstructions').checked;
            const rawPurchaseNotes = document.getElementById('prodPurchaseNotes').value || '';
            const normalizedPurchaseNotes = rawPurchaseNotes.replace(/\r\n/g, '\n').trim();
            const showPurchaseNotes = document.getElementById('prodShowPurchaseNotes').checked;
            const webhookTargetValue = document.getElementById('prodWebhookTarget').value.trim();

            document.getElementById('prodSort').value = String(normalizedSort);

            if (this.purchaseNotesSchemaAvailable === false && (showPurchaseNotes || normalizedPurchaseNotes)) {
                alert('保存失败：当前 Supabase 数据库还没有“注意事项”字段。请先执行 `supabase/add_purchase_notes.sql`，再保存商品。');
                return;
            }

            const payload = {
                [fields.name]: name,
                [fields.price]: normalizedPrice,
                [fields.desc]: description,
                icon_url: document.getElementById('prodIcon').value,
                category: document.getElementById('prodCategory').value,
                display_order: normalizedSort,
                show_usage_instructions: showUsageInstructions,
                usage_instructions: showUsageInstructions ? (normalizedUsageInstructions || null) : null,
                delivery_type: normalizedDeliveryType,
                webhook_target: normalizedDeliveryType === 'API' ? (webhookTargetValue || null) : null,

                // Marketing fields
                quantity_rules: null,
                flash_sale_price: null,
                flash_sale_end: null
            };

            if (this.purchaseNotesSchemaAvailable !== false) {
                payload.show_purchase_notes = showPurchaseNotes;
                payload.purchase_notes = showPurchaseNotes ? (normalizedPurchaseNotes || null) : null;
            }

            // Parse marketing fields visually
            let quantityRulesRaw = null;
            const container = document.getElementById('prodQuantityRulesContainer');
            if (container) {
                const rows = container.querySelectorAll('.tiered-pricing-row');
                if (rows.length > 0) {
                    const rulesArray = [];
                    let hasError = false;

                    rows.forEach(row => {
                        const qtyVal = row.querySelector('.tp-qty').value;
                        const priceVal = row.querySelector('.tp-price').value;

                        if (qtyVal && priceVal) {
                            const qty = parseInt(qtyVal);
                            const price = parseFloat(priceVal);

                            if (isNaN(qty) || isNaN(price) || qty <= 0 || price < 0) {
                                alert('阶梯定价规则格式错误：满减数量必须大于0，单价不能为负数');
                                hasError = true;
                                return;
                            }

                            rulesArray.push({ qty, price });
                        }
                    });

                    if (hasError) return;

                    if (rulesArray.length > 0) {
                        quantityRulesRaw = rulesArray;
                    }
                }
            }

            if (quantityRulesRaw) {
                payload.quantity_rules = quantityRulesRaw;
            }

            const flashPriceRaw = document.getElementById('prodFlashSalePrice').value.trim();
            if (flashPriceRaw !== '') {
                payload.flash_sale_price = parseInt(flashPriceRaw);
            }

            const flashEndRaw = document.getElementById('prodFlashSaleEnd').value;
            if (flashEndRaw) {
                payload.flash_sale_end = new Date(flashEndRaw).toISOString();
            }

            // For CN site, also save auto-translated English fields
            if (editSite === 'cn' && name_en) {
                payload.name_en = name_en;
                payload.description_en = description_en;
            }

            try {
                // If there's a pending new category, save it first
                if (this.pendingCategory && payload.category === this.pendingCategory.name) {
                    console.log('Saving pending category:', this.pendingCategory);
                    const { error: catError } = await supabaseClient
                        .from('shop_categories')
                        .insert([{
                            name: this.pendingCategory.name,
                            color: this.pendingCategory.color,
                            sort_order: (this.categoryData.length + 1) * 10
                        }]);

                    if (catError) {
                        console.error('Failed to save new category:', catError);
                        // Continue anyway, the product can still be saved with the category name
                    }
                }

                let error;
                if (id) {
                    const upsertPayload = this.buildExistingProductUpsertPayload(id, payload);
                    const res = await supabaseClient
                        .from('shop_products')
                        .upsert(upsertPayload, { onConflict: 'id' })
                        .select();
                    error = res.error;
                    console.log('[ShopAdmin] Upsert result:', res);
                    if (!error && (!res.data || res.data.length === 0)) {
                        throw new Error('更新失败：没有权限修改此商品，请确认您已登录管理员账号。\n(RLS policy blocked the update)');
                    }
                    if (!error && Array.isArray(res.data) && res.data[0]) {
                        this.editingProductSnapshot = res.data[0];
                    }
                } else {
                    const res = await supabaseClient.from('shop_products').insert(payload).select();
                    error = res.error;
                    console.log('[ShopAdmin] Insert result:', res);
                }

                if (error) throw error;

                // Clear pending category after successful save
                this.pendingCategory = null;

                document.getElementById('productModal').style.display = 'none';
                alert('保存成功' + (name_en ? ' (已自动翻译)' : ''));

                // Refresh products and category filters
                this.loadProducts();
                await this.renderProductCategoryFilters();
            } catch (err) {
                console.error('[ShopAdmin] Save process completely failed:', err);
                alert(this.getFriendlySaveErrorMessage(err));
            }
        } catch (err) {
            console.error('[ShopAdmin] Outer try-catch failed:', err);
            alert(this.getFriendlySaveErrorMessage(err));
        }
    },

    deleteProduct: async function (id, name) {
        if (!confirm(`确定要删除商品 "${name}" 吗？\n商品将被下架但保留历史订单记录。`)) return;

        try {
            // Soft delete: set is_active=false instead of hard delete
            // This preserves order history (foreign key references)
            const { error } = await supabaseClient
                .from('shop_products')
                .update({ is_active: false })
                .eq('id', id);

            if (error) throw error;

            alert('商品已删除');
            this.loadProducts();
        } catch (err) {
            alert('删除失败: ' + err.message);
        }
    },

    toggleStatus: async function (id, newStatus) {
        if (!confirm(`确定要${newStatus ? '上架' : '下架'} 该商品吗？`)) return;
        const { error } = await supabaseClient.from('shop_products').update({ is_active: newStatus }).eq('id', id);
        if (error) alert('Error: ' + error.message);
        else this.loadProducts();
    },

    // ==================== Inventory ====================
    loadInventoryProductList: async function (preloadedData = null) {
        const container = document.getElementById('inventoryProductList');
        if (!container) return;

        let data = preloadedData;
        if (!data) {
            const res = await supabaseClient.from('shop_products').select('*').order('display_order', { ascending: false });
            data = res.data || [];
        }

        container.innerHTML = '';
        if (data.length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:rgba(255,255,255,0.3);">暂无商品，请先新建</div>';
            return;
        }

        // Auto-select first product if none selected
        if (!this.selectedProductId && data.length > 0) {
            this.selectedProductId = data[0].id;
        }

        data.forEach(p => {
            const el = document.createElement('div');
            el.className = 'product-select-item';
            // Use CSS class for hover/active state, remove inline styles conflict

            if (this.selectedProductId === p.id) {
                el.classList.add('active');
                // Also update header text if selected
                setTimeout(() => {
                    const nameEl = document.getElementById('targetProductName');
                    if (nameEl) {
                        nameEl.textContent = p.name;
                        nameEl.style.display = 'inline-block';
                    }
                }, 0);
            }

            el.innerHTML = `
    < div style = "font-weight: bold; color:#eee;" > ${p.name}</div >
        <div style="font-size: 0.8em; color: rgba(255,255,255,0.5);">库存: ${p.stock_count || 0}</div>
`;

            el.onclick = () => {
                this.selectedProductId = p.id;
                const nameEl = document.getElementById('targetProductName');
                if (nameEl) {
                    nameEl.textContent = p.name;
                    nameEl.style.display = 'inline-block';
                }
                // Reload list to update active state
                this.loadInventoryProductList(data);
            };
            container.appendChild(el);
        });
    },

    importInventory: async function (btnElement) {
        if (!this.selectedProductId) { alert('请先选择要导入的商品'); return; }

        const input = document.getElementById('inventoryInput');
        const text = input.value;
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        if (lines.length === 0) { alert('没有检测到有效数据'); return; }

        if (!confirm(`即将为商品导入 ${lines.length} 条库存数据，确定吗？`)) return;

        // UI Feedback
        let originalText = '';
        if (btnElement) {
            originalText = btnElement.innerHTML;
            btnElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
            btnElement.disabled = true;
        }

        const batchId = 'batch_' + Date.now();
        const importStatus = document.querySelector('input[name="importStatus"]:checked')?.value || 'available';
        const inserts = lines.map(content => ({
            product_id: this.selectedProductId,
            content: content,
            status: importStatus,
            batch_id: batchId
        }));

        try {
            console.log(`[ShopAdmin] Importing ${inserts.length} items...`);
            const { error } = await supabaseClient.from('shop_inventory').insert(inserts);

            if (error) {
                console.error('[ShopAdmin] Insert Error:', error);
                throw error;
            }

            // Sync stock_count: count actual available inventory
            const { count, error: countError } = await supabaseClient
                .from('shop_inventory')
                .select('*', { count: 'exact', head: true })
                .eq('product_id', this.selectedProductId)
                .eq('status', 'available');

            if (!countError) {
                await supabaseClient
                    .from('shop_products')
                    .update({ stock_count: count || 0 })
                    .eq('id', this.selectedProductId);
            }

            alert(`✅ 成功导入 ${inserts.length} 条库存`);

            // Clear input
            input.value = '';
            document.getElementById('lineCount').textContent = '0';

            // Refresh visuals
            await this.loadProducts();

            // Also refresh the inventory list selection to update stock count
            await this.loadInventoryProductList();

        } catch (err) {
            console.error('[ShopAdmin] Import Failed:', err);
            alert('❌ 导入失败: ' + (err.message || '未知错误'));
        } finally {
            if (btnElement) {
                btnElement.innerHTML = originalText;
                btnElement.disabled = false;
            }
        }
    },

    // ==================== Marketing Visual Builders ====================
    renderTieredPricingRules: function (rules = []) {
        const container = document.getElementById('prodQuantityRulesContainer');
        if (!container) return;

        container.innerHTML = '';

        if (rules.length === 0) {
            // Empty initially 
        } else {
            rules.forEach((rule, index) => {
                this.injectTieredPricingRow(rule.qty, rule.price, index);
            });
        }
    },

    injectTieredPricingRow: function (qty = '', price = '', index = Date.now()) {
        const container = document.getElementById('prodQuantityRulesContainer');
        if (!container) return;

        const row = document.createElement('div');
        row.className = 'tiered-pricing-row';
        row.style.cssText = 'display: flex; gap: 8px; align-items: center; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); animation: modalFadeIn 0.2s ease-out;';
        row.innerHTML = `
            <div style="flex: 1; display: flex; align-items: center; gap: 6px;">
                <span style="color: rgba(255,255,255,0.5); font-size: 13px;">满</span>
                <input type="number" class="modern-input tp-qty" placeholder="10" value="${qty}" style="padding: 8px; flex: 1; min-width: 50px;">
                <span style="color: rgba(255,255,255,0.5); font-size: 13px;">件</span>
            </div>
            <div style="flex: 1; display: flex; align-items: center; gap: 6px;">
                <span style="color: rgba(255,255,255,0.5); font-size: 13px;">单价降至</span>
                <input type="number" class="modern-input tp-price" placeholder="8" value="${price}" style="padding: 8px; flex: 1; min-width: 50px;">
                <span style="color: rgba(255,255,255,0.5); font-size: 13px;">积分</span>
            </div>
            <button type="button" onclick="this.parentElement.remove()" style="background: rgba(239,68,68,0.1); border: none; color: #ef4444; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.2)'" onmouseout="this.style.background='rgba(239,68,68,0.1)'">
                <i class="fas fa-trash-alt"></i>
            </button>
        `;
        container.appendChild(row);
    },

    addTieredPricingRow: function () {
        this.injectTieredPricingRow();
    },

    // ==================== Orders (Fix FK Issue) ====================
    searchOrders: async function (page = 1) {
        this.ordersPage = page;
        const query = document.getElementById('orderSearchInput')?.value?.trim() || '';
        const tbody = document.getElementById('ordersTableBody');
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">加载中...</td></tr>';

        const limit = this.pageSize;
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        try {
            // 1. Fetch Orders (Pagination)
            let queryBuilder = supabaseClient
                .from('shop_orders')
                .select('*', { count: 'exact' })
                .order('created_at', { ascending: false });

            // Apply admin site filter
            if (window.AdminSiteFilter) queryBuilder = AdminSiteFilter.applySiteFilter(queryBuilder);

            let searchedById = false;
            if (query && query.includes('-')) {
                // Clean the query (remove SHOP_ORDER_ prefix if present)
                let cleanedId = query.replace(/^SHOP_ORDER_/i, '').trim();
                console.log('[ShopAdmin] Searching by order ID:', cleanedId);
                queryBuilder = queryBuilder.eq('id', cleanedId);
                searchedById = true;
            } else {
                queryBuilder = queryBuilder.range(from, to);
            }

            let { data, count, error } = await queryBuilder;

            if (error) throw error;

            // Fallback: If searched by ID but no results, try via points_ledger
            if (searchedById && (!data || data.length === 0)) {
                console.log('[ShopAdmin] No direct match, trying points_ledger fallback...');
                const cleanedId = query.replace(/^SHOP_ORDER_/i, '').trim();

                // Try searching by ledger record ID directly (wallet shows ledger.id as "订单号")
                const { data: ledgerData, error: ledgerError } = await supabaseClient
                    .from('points_ledger')
                    .select('id, user_id, reference_id, created_at')
                    .or(`id.eq.${cleanedId}, reference_id.ilike.% ${cleanedId}% `)
                    .limit(5);

                console.log('[ShopAdmin] Ledger search result:', ledgerData, 'Error:', ledgerError);

                if (ledgerData && ledgerData.length > 0) {
                    // Found in ledger, get user_id and extract order_id from reference_id
                    const ledgerRecord = ledgerData[0];
                    const userId = ledgerRecord.user_id;

                    // Try to extract order_id from reference_id (format: SHOP_ORDER_uuid)
                    let orderId = null;
                    if (ledgerRecord.reference_id && ledgerRecord.reference_id.startsWith('SHOP_ORDER_')) {
                        orderId = ledgerRecord.reference_id.replace('SHOP_ORDER_', '');
                    }

                    console.log('[ShopAdmin] Extracted user_id:', userId, 'order_id:', orderId);

                    // First try to find by extracted order_id
                    if (orderId) {
                        const { data: orderById } = await supabaseClient
                            .from('shop_orders')
                            .select('*', { count: 'exact' })
                            .eq('id', orderId);

                        if (orderById && orderById.length > 0) {
                            data = orderById;
                            count = orderById.length;
                            console.log('[ShopAdmin] Found order by extracted ID:', data);
                        }
                    }

                    // If still not found, get user's recent orders around the ledger time
                    if (!data || data.length === 0) {
                        const ledgerTime = new Date(ledgerRecord.created_at);
                        const timeWindow = 60 * 1000; // ±1 minute

                        const { data: userOrders, count: userCount } = await supabaseClient
                            .from('shop_orders')
                            .select('*', { count: 'exact' })
                            .eq('user_id', userId)
                            .gte('created_at', new Date(ledgerTime.getTime() - timeWindow).toISOString())
                            .lte('created_at', new Date(ledgerTime.getTime() + timeWindow).toISOString())
                            .order('created_at', { ascending: false });

                        if (userOrders && userOrders.length > 0) {
                            data = userOrders;
                            count = userCount;
                            console.log('[ShopAdmin] Found orders via time window:', data.length);
                        }
                    }
                }
            }

            tbody.innerHTML = '';
            if (!data || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center">无数据 - 请检查订单号是否正确</td></tr>';
                return;
            }

            // 2. Fetch Profiles via RPC (same as user management for reliable email access)
            const userIds = [...new Set(data.map(o => o.user_id))];
            console.log('[ShopAdmin] User IDs to fetch:', userIds);
            let userMap = {};
            if (userIds.length > 0) {
                // Try RPC first (includes email from auth.users)
                const { data: rpcUsers, error: rpcError } = await supabaseClient.rpc('get_admin_users');

                if (rpcUsers && !rpcError) {
                    rpcUsers.forEach(u => {
                        const id = u.out_id || u.id;
                        userMap[id] = {
                            id: id,
                            email: u.out_email || u.email,
                            username: u.out_username || u.username || 'Unknown',
                            avatar_url: u.out_avatar_url || u.avatar_url
                        };
                    });
                    console.log('[ShopAdmin] RPC users loaded:', Object.keys(userMap).length);
                } else {
                    console.warn('[ShopAdmin] RPC failed, fallback to profiles:', rpcError);
                    // Fallback to profiles table
                    const { data: users } = await supabaseClient
                        .from('profiles')
                        .select('id, email, display_name, username, avatar_url')
                        .in('id', userIds);
                    if (users) {
                        users.forEach(u => userMap[u.id] = u);
                    }
                }
            }
            console.log('[ShopAdmin] User map:', userMap);

            // 3. Fetch inventory content for orders that have inventory_id
            const inventoryIds = [...new Set(data.filter(o => o.inventory_id).map(o => o.inventory_id))];
            console.log('[ShopAdmin] Order data:', data);
            console.log('[ShopAdmin] First order fields:', data[0] ? Object.keys(data[0]) : 'no orders');
            console.log('[ShopAdmin] First order inventory_id:', data[0]?.inventory_id);
            console.log('[ShopAdmin] First order items:', data[0]?.items);
            console.log('[ShopAdmin] Inventory IDs:', inventoryIds);

            let inventoryMap = {};
            if (inventoryIds.length > 0) {
                const { data: inventories, error: invError } = await supabaseClient
                    .from('shop_inventory')
                    .select('id, content')
                    .in('id', inventoryIds);

                console.log('[ShopAdmin] Inventory query result:', inventories, 'Error:', invError);

                if (inventories) {
                    inventories.forEach(inv => inventoryMap[inv.id] = inv.content);
                }
            }

            // 4. Fallback: For orders without inventory_id, query by buyer_id + time window
            const ordersNeedingFallback = data.filter(o => !o.inventory_id && o.user_id);
            if (ordersNeedingFallback.length > 0) {
                // Group by user_id to batch query
                const userIds = [...new Set(ordersNeedingFallback.map(o => o.user_id))];

                const { data: soldInventories } = await supabaseClient
                    .from('shop_inventory')
                    .select('id, content, buyer_id, sold_at, product_id')
                    .in('buyer_id', userIds)
                    .eq('status', 'sold')
                    .order('sold_at', { ascending: false });

                if (soldInventories) {
                    // Build a map keyed by "user_id + product_id + approximate_time"
                    // For simplicity, just map by "user_id:product_id" and get latest
                    const userProductInventory = {};
                    soldInventories.forEach(inv => {
                        const key = `${inv.buyer_id}:${inv.product_id} `;
                        if (!userProductInventory[key]) {
                            userProductInventory[key] = [];
                        }
                        userProductInventory[key].push(inv.content);
                    });

                    // Attach to orders
                    ordersNeedingFallback.forEach(order => {
                        const key = `${order.user_id}:${order.product_id} `;
                        if (userProductInventory[key]) {
                            // Take item_count items from the array
                            const count = order.item_count || 1;
                            const contents = userProductInventory[key].splice(0, count);
                            order._fallbackContents = contents;
                        }
                    });
                }
            }

            console.log('[ShopAdmin] Inventory map:', inventoryMap);

            for (const order of data) {
                const date = new Date(order.created_at).toLocaleString();
                // Get user info from map
                const user = userMap[order.user_id] || {};
                const userName = user.username || 'Unknown';
                const userEmail = user.email || order.user_id.substring(0, 8) + '...';
                const userAvatar = user.avatar_url
                    ? user.avatar_url
                    : `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(userName)}&backgroundColor=6b9ece`;

                // Two-line layout like user management page
                const userDisplay = `
                    <div style="display:flex;align-items:center;gap:10px;">
                        <img src="${userAvatar}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.src='https://api.dicebear.com/7.x/initials/svg?seed=U&backgroundColor=6b9ece'">
                        <div style="line-height:1.3;">
                            <div style="font-weight:600;color:#fff;">${userName}</div>
                            <div style="font-size:12px;color:rgba(255,255,255,0.5);">${userEmail}</div>
                        </div>
                    </div>
                `;

                // Handle new items array structure
                const items = order.items || [];
                let productName = 'Unknown';
                let contentData = '';

                if (items.length > 0) {
                    productName = items[0].product_name || 'Unknown';
                    // Encode items array for passing to function
                    contentData = encodeURIComponent(JSON.stringify(items)).replace(/'/g, '%27');
                } else if (order._fallbackContents && order._fallbackContents.length > 0) {
                    // Use fallback contents from inventory query by buyer
                    productName = order.snapshot_product_name || 'Unknown';
                    const itemsFromFallback = order._fallbackContents.map(content => ({
                        product_name: productName,
                        content: content,
                        price: order.price_paid
                    }));
                    contentData = encodeURIComponent(JSON.stringify(itemsFromFallback)).replace(/'/g, '%27');
                } else {
                    // Get content from inventory map (original path)
                    const inventoryContent = inventoryMap[order.inventory_id] || '无内容';
                    productName = order.snapshot_product_name || 'Unknown';
                    contentData = encodeURIComponent(JSON.stringify([{
                        product_name: productName,
                        content: inventoryContent,
                        price: order.price_paid
                    }])).replace(/'/g, '%27');
                }

                if (order.item_count > 1) {
                    productName += ` 等 ${order.item_count} 件`;
                }

                const status = (order.refund_status === 'refunded' || order.refund_status === 'full_refund')
                    ? '<span class="status-badge status-inactive">已退款</span>'
                    : '<span class="status-badge status-active">已完成</span>';

                tbody.innerHTML += `
                <tr onclick="ShopAdmin.showOrderContent('${order.id}', '${contentData}')" style="cursor: pointer;" title="点击查看订单详情">
                    <td title="${order.user_id}" style="white-space:nowrap;">${userDisplay}</td>
                    <td>${date}</td>
                    <td>${productName}</td>
                    <td>${order.total_price || order.price_paid}</td>
                    <td>${status}</td>
                    <td onclick="event.stopPropagation()">
                        ${(order.refund_status !== 'refunded' && order.refund_status !== 'full_refund') ?
                        `<button class="btn-icon danger" onclick="ShopAdmin.refundOrder('${order.id}')" title="退款"><i class="fas fa-undo"></i></button>`
                        : '<span style="color: rgba(255,255,255,0.3); font-size: 12px;">-</span>'}
                    </td>
                </tr>
                `;
            }



            // Render Pagination
            this.renderPagination('ordersPagination', page, count || 0, this.pageSize, 'searchOrders');

            // Enable horizontal scroll with mouse wheel for mobile
            const ordersTableContainer = document.querySelector('#shop-view-orders .shop-table-container');
            if (ordersTableContainer && window.enableHorizontalScroll) {
                window.enableHorizontalScroll(ordersTableContainer);
            }

        } catch (err) {
            console.error(err);
            tbody.innerHTML = `< tr > <td colspan="6" class="text-danger">Error: ${err.message}</td></tr > `;
        }
    },

    // Escape content for HTML attribute
    escapeForAttr: function (str) {
        if (!str) return '';
        return str.replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    // Escape HTML special characters
    escapeHtml: function (str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    // Show order content in a modal
    showOrderContent: function (orderId, itemsData) {
        let items = [];
        try {
            items = JSON.parse(decodeURIComponent(itemsData));
        } catch (e) {
            console.error('Failed to parse items:', e);
            items = [{ content: decodeURIComponent(itemsData) || '解析失败' }];
        }

        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.classList.add('order-content-overlay');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.zIndex = '1000';
        overlay.style.backdropFilter = 'blur(4px)';

        const contentHtml = items.map(item => `
            <div style="margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
                <div style="font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 4px;">
                    ${item.product_name || '商品'}
                </div>
                <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 4px; font-family: monospace; word-break: break-all; margin-bottom: 5px; color: #e2e8f0;">
                    ${this.escapeHtml(item.content)}
                </div>
            </div>
        `).join('');

        const allContent = items.map(p => p.content).join('\n');

        overlay.innerHTML = `
            <div style="
                background: rgba(30,35,50,0.95);
                backdrop-filter: blur(20px);
                border-radius: 20px; border: 1px solid rgba(255,255,255,0.12);
                max-width: 500px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                overflow: hidden;
            ">
                <div style="
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 20px 24px; border-bottom: 1px solid rgba(255,255,255,0.08);
                ">
                    <h3 style="margin: 0; font-size: 18px; color: #fff;">📦 订单内容</h3>
                </div>
                <div style="padding: 24px;">
                    <div style="font-size: 12px; color: rgba(255,255,255,0.5); margin-bottom: 8px;">
                        订单号: <code style="color: #60a5fa; user-select: all;">${orderId}</code>
                    </div>
                    <div id="orderContentBox" style="
                        background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1);
                        border-radius: 12px; padding: 16px;
                        font-family: 'Monaco', 'Consolas', monospace;
                        font-size: 14px; color: #22c55e; word-break: break-all;
                        cursor: pointer; line-height: 1.6;
                        max-height: 300px; overflow-y: auto;
                    ">${contentHtml}</div>
                    <div style="font-size: 11px; color: rgba(255,255,255,0.35); text-align: center; margin-top: 10px;">
                        点击上方内容框可复制
                    </div>
                </div>
            </div>
        `;

        // Click to copy
        overlay.querySelector('#orderContentBox').addEventListener('click', () => {
            navigator.clipboard.writeText(allContent).then(() => {
                alert('✅ 内容已复制到剪贴板');
            }).catch(() => {
                alert('复制失败，请手动选择复制');
            });
        });

        // Close on backdrop click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.body.appendChild(overlay);
    },

    // Open Enhanced Refund Modal
    openRefundModal: function (orderId) {
        const modalHtml = `
            <style>
                @keyframes modalFadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
                .refund-modal-input:focus {
                    border-color: #6b9ece !important;
                    box-shadow: 0 0 0 3px rgba(107, 158, 206, 0.25) !important;
                    outline: none;
                }
                .status-option input:checked + span {
                    font-weight: 600;
                    text-shadow: 0 0 10px rgba(255,255,255,0.2);
                }
                .refund-btn-cancel {
                    padding: 10px 20px;
                    background: rgba(255,255,255,0.05);
                    border: none;
                    color: #94a3b8;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 500;
                    transition: all 0.2s;
                }
                .refund-btn-cancel:hover {
                    background: rgba(255,255,255,0.1);
                    color: #fff;
                }
                .refund-btn-confirm {
                    padding: 10px 24px;
                    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                    box-shadow: 0 4px 12px rgba(239,68,68,0.3);
                    border: none;
                    color: #fff;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 600;
                    transition: all 0.2s;
                }
                .refund-btn-confirm:hover {
                    filter: brightness(1.1);
                    transform: translateY(-1px);
                    box-shadow: 0 6px 16px rgba(239,68,68,0.4);
                }
                .refund-btn-confirm:active {
                    transform: translateY(0);
                    filter: brightness(0.95);
                }
            </style>
            <div id="refundModal" onclick="if(event.target.id==='refundModal')this.remove()" 
                style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);backdrop-filter:blur(12px);z-index:9999;display:flex;justify-content:center;align-items:center;">
                <div style="background:rgba(20,25,40,0.9);border:1px solid rgba(255,255,255,0.08);box-shadow:0 20px 50px rgba(0,0,0,0.5);border-radius:20px;padding:30px;width:480px;animation:modalFadeIn 0.3s ease-out;">
                    <h3 style="margin:0 0 25px 0;color:#fff;font-size:18px;font-weight:600;display:flex;align-items:center;gap:10px;">
                        <span style="background:rgba(239,68,68,0.15);padding:8px;border-radius:10px;display:flex;">
                             <i class="fas fa-undo" style="color:#ef4444;"></i>
                        </span>
                        订单退款处理
                    </h3>
                    
                    <div style="margin-bottom:25px;">
                        <label style="display:block;color:#94a3b8;font-size:13px;font-weight:500;margin-bottom:12px;">选择退款后的库存状态</label>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                            <label class="status-option" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);padding:12px;border-radius:10px;cursor:pointer;display:flex;align-items:center;transition:all 0.2s;">
                                <input type="radio" name="refundTargetStatus" value="frozen" checked style="accent-color:#f59e0b;"> 
                                <span style="margin-left:10px;color:#cbd5e1;font-size:13px;display:flex;align-items:center;gap:6px;"><i class="fas fa-ban" style="color:#f59e0b;"></i> 冻结问题</span>
                            </label>
                            <label class="status-option" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);padding:12px;border-radius:10px;cursor:pointer;display:flex;align-items:center;transition:all 0.2s;">
                                <input type="radio" name="refundTargetStatus" value="available" style="accent-color:#10b981;"> 
                                <span style="margin-left:10px;color:#cbd5e1;font-size:13px;display:flex;align-items:center;gap:6px;"><i class="fas fa-check-circle" style="color:#10b981;"></i> 重新上架</span>
                            </label>
                            <label class="status-option" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);padding:12px;border-radius:10px;cursor:pointer;display:flex;align-items:center;transition:all 0.2s;">
                                <input type="radio" name="refundTargetStatus" value="fault" style="accent-color:#d946ef;"> 
                                <span style="margin-left:10px;color:#cbd5e1;font-size:13px;display:flex;align-items:center;gap:6px;"><i class="fas fa-exclamation-triangle" style="color:#d946ef;"></i> 故障维修</span>
                            </label>
                            <label class="status-option" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);padding:12px;border-radius:10px;cursor:pointer;display:flex;align-items:center;transition:all 0.2s;">
                                <input type="radio" name="refundTargetStatus" value="reserve" style="accent-color:#3b82f6;"> 
                                <span style="margin-left:10px;color:#cbd5e1;font-size:13px;display:flex;align-items:center;gap:6px;"><i class="fas fa-box" style="color:#3b82f6;"></i> 保留库存</span>
                            </label>
                        </div>
                    </div>

                    <div style="margin-bottom:30px;">
                        <label style="display:block;color:#94a3b8;font-size:13px;font-weight:500;margin-bottom:12px;">备注说明</label>
                        <textarea id="refundRemarkInput" class="refund-modal-input" style="width:100%;box-sizing:border-box;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;border-radius:10px;padding:12px;height:80px;resize:none;font-family:inherit;font-size:13px;line-height:1.5;transition:all 0.2s;" placeholder="请填写退款的具体原因..."></textarea>
                    </div>
                    
                    <div style="display:flex;justify-content:flex-end;gap:12px;">
                        <button onclick="document.getElementById('refundModal').remove()" class="refund-btn-cancel">取消</button>
                        <button onclick="ShopAdmin.submitRefund('${orderId}')" class="refund-btn-confirm">确认退款</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    },

    submitRefund: async function (orderId) {
        const targetStatus = document.querySelector('input[name="refundTargetStatus"]:checked').value;
        const remark = document.getElementById('refundRemarkInput').value.trim();

        // Disable button to prevent double submit
        const btn = event.target;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '处理中...';

        try {
            const { data, error } = await supabaseClient.rpc('fn_admin_refund_order', {
                p_order_id: orderId,
                p_admin_id: (await window.supabaseClient.auth.getUser()).data.user.id,
                p_target_status: targetStatus,
                p_remark: remark || null
            });

            if (error) throw error;

            if (data.success) {
                alert(data.message);
                document.getElementById('refundModal').remove();
                this.searchOrders(); // Refresh Order List
                // Also try refresh inventory list if possible, or user will switch tab
                if (this.currentTab === 'inventory') this.loadInventoryList();
            } else {
                alert('Refund Failed: ' + data.message);
                btn.disabled = false;
                btn.textContent = originalText;
            }
        } catch (err) {
            console.error(err);
            alert('Error: ' + err.message);
            btn.disabled = false;
            btn.textContent = originalText;
        }
    },

    refundOrder: function (orderId) {
        this.openRefundModal(orderId);
    },

    // State
    currentPage: 1,
    pageSize: 10,
    inventoryPage: 1,
    inventoryData: [],
    isSelectionMode: false, // New state for selection mode

    _initOrderEvents: function () {
        // This is called from the main init for order-related event bindings
        if (typeof this.searchOrders === 'function') {
            this.searchOrders();
        } else {
            console.error('searchOrders function missing');
        }

        // Global Click Listener (Close menus & Delegate Items)
        document.addEventListener('click', (e) => {
            // Dropdown Item Selection
            const item = e.target.closest('.custom-dropdown-item');
            if (item) {
                // Skip if item has inline onclick (static items like status/date) to avoid double-trigger
                // Dynamic product items usually don't have inline onclick
                if (item.getAttribute('onclick')) return;

                const dropdown = item.closest('.custom-dropdown');
                if (dropdown) {
                    let type = 'status';
                    if (dropdown.id.includes('product')) type = 'product';
                    else if (dropdown.id.includes('Date')) type = 'date';
                    const value = item.dataset.value;
                    const label = item.textContent.trim();
                    if (typeof this.selectDropdown === 'function') {
                        this.selectDropdown(type, value, label);
                    } else if (typeof ShopAdmin.selectDropdown === 'function') {
                        ShopAdmin.selectDropdown(type, value, label);
                    }
                    return;
                }
            }

            // Global Click Listener (Close menus)

            // Batch Menu
            const batchMenu = document.getElementById('batchActionMenu');
            const batchBtn = document.getElementById('batchActionsBtn');
            if (batchMenu && batchBtn && !batchMenu.contains(e.target) && !batchBtn.contains(e.target)) {
                batchMenu.style.display = 'none';
            }





            // Custom Dropdowns (Close if clicking outside)
            if (!e.target.closest('.custom-dropdown')) {
                document.querySelectorAll('.custom-dropdown-menu.show').forEach(m => m.classList.remove('show'));
                document.querySelectorAll('.custom-dropdown-trigger.open').forEach(t => t.classList.remove('open'));
            }
        }, true);

        // FIX: Re-bind Dropdown Triggers to avoid inline handler issues
        setTimeout(() => {
            document.querySelectorAll('.custom-dropdown-trigger').forEach(trigger => {
                // Remove inline onclick to prevent conflicts
                trigger.removeAttribute('onclick');

                // Remove existing listeners (clone node trick if needed, but simple add is fine since init runs once per load usually)
                // We assume init runs once or we check a flag
                if (trigger.dataset.bound) return;
                trigger.dataset.bound = 'true';

                trigger.addEventListener('click', (e) => {
                    e.stopPropagation(); // Stop bubbling
                    const dropdown = trigger.closest('.custom-dropdown');
                    if (dropdown) {
                        const menu = dropdown.querySelector('.custom-dropdown-menu');
                        if (menu) {
                            // Close others
                            document.querySelectorAll('.custom-dropdown-menu.show').forEach(m => {
                                if (m !== menu) m.classList.remove('show');
                            });
                            document.querySelectorAll('.custom-dropdown-trigger.open').forEach(t => {
                                if (t !== trigger) t.classList.remove('open');
                            });

                            trigger.classList.toggle('open');
                            menu.classList.toggle('show');
                        }
                    }
                });
            });
        }, 100);

        // Initialize Flatpickr for Inventory Date Filter
        setTimeout(() => {
            if (window.flatpickr) {
                const config = {
                    locale: 'zh',
                    dateFormat: 'Y-m-d',
                    theme: "dark",
                    onChange: (selectedDates, dateStr, instance) => {
                        const from = document.getElementById('invDateFrom').value;
                        const to = document.getElementById('invDateTo').value;
                        if (from || to) {
                            if (typeof ShopAdmin.selectDropdown === 'function') {
                                ShopAdmin.selectDropdown('date', 'custom', '自定义');
                            }
                        }
                    }
                };
                flatpickr('#invDateFrom', config);
                flatpickr('#invDateTo', config);
            }
        }, 500);
    },

    toggleSelectionMode: function () {
        this.isSelectionMode = !this.isSelectionMode;
        const btn = document.getElementById('toggleSelectionBtn');
        const batchBtn = document.getElementById('batchActionsBtn');
        const cols = document.querySelectorAll('.inv-checkbox-col');
        const contentCells = document.querySelectorAll('#inventoryTableBody td:nth-child(3)');

        if (this.isSelectionMode) {
            btn.classList.add('active');
            if (batchBtn) batchBtn.style.display = 'flex'; // Show batch button
            cols.forEach(el => el.style.display = '');
            contentCells.forEach(td => td.style.cursor = 'pointer');
        } else {
            btn.classList.remove('active');
            if (batchBtn) batchBtn.style.display = 'none'; // Hide batch button
            document.getElementById('batchActionMenu').style.display = 'none'; // Close menu
            cols.forEach(el => el.style.display = 'none');
            contentCells.forEach(td => td.style.cursor = '');
        }
    },

    toggleBatchMenu: function () {
        const menu = document.getElementById('batchActionMenu');
        if (menu) {
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
            this.updateSelectionCount(); // Update count when opening
        }
    },

    selectAllRows: function () {
        const cb = document.getElementById('selectAllInv');
        if (cb) {
            cb.checked = !cb.checked;
            this.toggleSelectAll(cb);
        }
        // Ensure menu stays open
        const menu = document.getElementById('batchActionMenu');
        if (menu) menu.style.display = 'block';
    },

    batchDelete: async function () {
        const selectedIds = Array.from(document.querySelectorAll('.inv-checkbox:checked')).map(cb => cb.dataset.id);
        if (selectedIds.length === 0) {
            alert('请先选择要删除的库存项');
            return;
        }
        if (!confirm(`确定删除这 ${selectedIds.length} 项库存吗？`)) return;

        try {
            const { error } = await supabaseClient
                .from('shop_inventory')
                .delete()
                .in('id', selectedIds);

            if (error) throw error;

            // Refresh
            this.loadInventoryList(this.inventoryPage);
            document.getElementById('selectAllInv').checked = false;
            this.updateSelectionCount();

            // Close menu
            document.getElementById('batchActionMenu').style.display = 'none';

        } catch (err) {
            console.error('Batch delete error:', err);
            if (err.message && err.message.includes('foreign key constraint')) {
                alert('删除失败: 该库存项被订单引用。请先如果在 Supabase 中运行 fix_inventory_delete_constraint.sql 修复约束，或先删除关联订单。');
            } else {
                alert('删除失败: ' + err.message);
            }
        }
    },    // ==================== Inventory Browser ====================
    switchInventorySubtab: function (tab) {
        document.querySelectorAll('.subtab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`[data-subtab="${tab}"]`).classList.add('active');

        document.querySelectorAll('.inventory-subtab-content').forEach(el => el.style.display = 'none');
        document.getElementById(`inventory-subtab-${tab}`).style.display = 'block';

        if (tab === 'browser') {
            this.initInventoryBrowser();
        } else if (tab === 'import') {
            this.loadInventoryProductList();
        }
    },

    initInventoryBrowser: async function () {
        // Load products for custom dropdown
        const menu = document.getElementById('productDropdownMenu');
        if (menu && menu.children.length <= 1) {
            const { data } = await supabaseClient.from('shop_products').select('id, name').order('name');
            if (data) {
                data.forEach(p => {
                    const item = document.createElement('div');
                    item.className = 'custom-dropdown-item';
                    item.dataset.value = p.id;
                    item.textContent = p.name;
                    item.onclick = () => this.selectDropdown('product', p.id, p.name);
                    menu.appendChild(item);
                });
            }
        }

        // Initialize Flatpickr for date inputs if not already initialized
        this.initInventoryDatePickers();

        this.loadInventoryList();
    },

    initInventoryDatePickers: function () {
        if (!window.flatpickr) return;

        const fromInput = document.getElementById('invDateFrom');
        const toInput = document.getElementById('invDateTo');

        // Skip if already initialized
        if (fromInput && fromInput._flatpickr) return;

        const config = {
            locale: 'zh',
            dateFormat: 'Y-m-d',
            theme: "dark",
            allowInput: false,
            clickOpens: true,
            onChange: (selectedDates, dateStr, instance) => {
                const from = document.getElementById('invDateFrom').value;
                const to = document.getElementById('invDateTo').value;
                if (from || to) {
                    if (typeof ShopAdmin.selectDropdown === 'function') {
                        ShopAdmin.selectDropdown('date', 'custom', '自定义');
                    }
                }
            }
        };

        if (fromInput) flatpickr(fromInput, config);
        if (toInput) flatpickr(toInput, config);
    },

    toggleDropdown: function (dropdownId) {
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown) return;

        const trigger = dropdown.querySelector('.custom-dropdown-trigger');
        const menu = dropdown.querySelector('.custom-dropdown-menu');

        if (!trigger || !menu) return;

        // Close other dropdowns
        document.querySelectorAll('.custom-dropdown-menu.show').forEach(m => {
            if (m !== menu) m.classList.remove('show');
        });
        document.querySelectorAll('.custom-dropdown-trigger.open').forEach(t => {
            if (t !== trigger) t.classList.remove('open');
        });

        trigger.classList.toggle('open');
        menu.classList.toggle('show');
    },

    selectDropdown: function (type, value, label) {
        if (type === 'product') {
            const input = document.getElementById('invFilterProduct');
            if (input) input.value = value;

            const labelEl = document.getElementById('productDropdownLabel');
            if (labelEl) labelEl.textContent = label;

            document.querySelectorAll('#productDropdownMenu .custom-dropdown-item').forEach(i => {
                i.classList.toggle('selected', i.dataset.value === value);
            });
        } else if (type === 'status') {
            const input = document.getElementById('invFilterStatus');
            if (input) input.value = value;

            const labelEl = document.getElementById('statusDropdownLabel');
            if (labelEl) labelEl.textContent = label;

            const statusMenu = document.querySelector('#statusDropdown .custom-dropdown-menu');
            if (statusMenu) {
                statusMenu.querySelectorAll('.custom-dropdown-item').forEach(i => {
                    i.classList.toggle('selected', i.dataset.value === value);
                });
            }
        } else if (type === 'date') {
            const input = document.getElementById('invFilterDateType');
            if (input) input.value = value;

            const labelEl = document.getElementById('invDateFilterLabel');
            if (labelEl) labelEl.textContent = label;

            const menu = document.querySelector('#invDateFilterDropdown .custom-dropdown-menu');
            if (menu) {
                menu.querySelectorAll('.custom-dropdown-item').forEach(i => {
                    i.classList.toggle('selected', i.dataset.value === value);
                });
            }

            // Clear inputs if not custom
            if (value !== 'custom') {
                const f = document.getElementById('invDateFrom');
                const t = document.getElementById('invDateTo');
                if (f) f.value = '';
                if (t) t.value = '';
                if (f && f._flatpickr) f._flatpickr.clear();
                if (t && t._flatpickr) t._flatpickr.clear();
            }
        }

        // Close dropdown
        document.querySelectorAll('.custom-dropdown-menu.show').forEach(m => m.classList.remove('show'));
        document.querySelectorAll('.custom-dropdown-trigger.open').forEach(t => t.classList.remove('open'));

        // Reload list
        this.loadInventoryList();
    },


    loadInventoryList: async function (page = 1) {
        this.inventoryPage = page;
        const tbody = document.getElementById('inventoryTableBody');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;"><i class="fas fa-spinner fa-spin"></i> 加载中...</td></tr>';

        const productId = document.getElementById('invFilterProduct')?.value || null;
        const status = document.getElementById('invFilterStatus')?.value || null;
        const search = document.getElementById('invSearchInput')?.value || null;
        const dateType = document.getElementById('invFilterDateType')?.value || 'all';

        // Calculate Date Range
        let dateFrom = null;
        let dateTo = null;

        if (dateType === 'all') {
            // No filter
        } else if (dateType === 'custom') {
            const f = document.getElementById('invDateFrom')?.value;
            const t = document.getElementById('invDateTo')?.value;
            // Flatpickr gives YYYY-MM-DD. 
            if (f) dateFrom = f + ' 00:00:00';
            if (t) dateTo = t + ' 23:59:59';
        } else {
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            if (dateType === 'today') {
                dateFrom = todayStart.toISOString();
                const todayEnd = new Date(todayStart); todayEnd.setHours(23, 59, 59, 999);
                dateTo = todayEnd.toISOString();
            } else if (dateType === 'week') {
                // Last 7 days? Or "This Week" (Monday start)?
                // Comments logic: "weekAgo = now - 7 days". Relative.
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                dateFrom = weekAgo.toISOString();
                dateTo = new Date().toISOString();
            } else if (dateType === 'month') {
                const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                dateFrom = monthAgo.toISOString();
                dateTo = new Date().toISOString();
            }
        }


        try {
            const { data, error } = await supabaseClient.rpc('fn_admin_list_inventory', {
                p_product_id: productId || null,
                p_status: status || null,
                p_search: search || null,
                p_page: page,
                p_page_size: this.pageSize,
                p_date_from: dateFrom,
                p_date_to: dateTo
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.message);

            this.inventoryData = data.items || [];

            // Update stats
            const stats = data.stats || {};
            document.getElementById('statReserve').textContent = stats.reserve || 0;
            document.getElementById('statAvailable').textContent = stats.available || 0;
            document.getElementById('statSold').textContent = stats.sold || 0;
            document.getElementById('statFrozen').textContent = stats.frozen || 0;
            if (stats.fault !== undefined) document.getElementById('statFault').textContent = stats.fault; // Update fault stats
            document.getElementById('statFault').textContent = stats.fault || 0; // Fault stat

            // Render table
            if (this.inventoryData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:rgba(255,255,255,0.4);">暂无数据</td></tr>';
                return;
            }

            tbody.innerHTML = this.inventoryData.map(item => {
                const statusBadge = this.getStatusBadge(item.status);
                const createdAt = new Date(item.created_at).toLocaleString('zh-CN');
                const buyerInfo = item.status === 'sold'
                    ? `<div style="font-size:12px;">${item.buyer_email || '-'}</div><div style="font-size:11px;color:#888;">${item.order_id?.slice(0, 8) || ''}</div>`
                    : '-';

                // Extract email only (assuming format: email----password----recovery)
                const emailOnly = item.content.split('----')[0] || item.content;

                // Checkbox visibility
                const checkboxDisplay = this.isSelectionMode ? '' : 'none';

                return `
                    <tr>
                        <td class="inv-checkbox-col" style="display:${checkboxDisplay}">
                            <input type="checkbox" class="inv-checkbox" data-id="${item.id}" onchange="ShopAdmin.updateSelectionCount()">
                        </td>
                        <td>${item.product_name || '-'}</td>
                        <td onclick="ShopAdmin.toggleSelectionClick(this)">
                            <div class="content-cell" 
                                 data-content="${this.escapeForAttr(item.content)}" 
                                 onclick="ShopAdmin.copyContent(this, event)"
                                 title="点击复制全部内容&#10;───────────&#10;${this.escapeForAttr(item.content)}"
                                 style="cursor:pointer; padding:5px 10px; border-radius:6px; background:rgba(255,255,255,0.03); transition:all 0.2s; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                ${emailOnly}
                            </div>
                        </td>
                        <td>${statusBadge}</td>
                        <td style="font-size:12px;">${createdAt}</td>
                        <td>${buyerInfo}</td>
                        <td>
                            <div style="display:flex;gap:5px;">
                                <button onclick="ShopAdmin.showInventoryDetail('${item.id}')" class="btn-icon-sm" title="详情"><i class="fas fa-info-circle"></i></button>
                                ${item.status === 'sold' ? `<button onclick="ShopAdmin.openFaultModal('${item.id}')" class="btn-icon-sm" title="标记故障"><i class="fas fa-exclamation-triangle" style="color:#ef4444;"></i></button>` : ''}
                                ${item.status !== 'sold' ? `<button onclick="ShopAdmin.deleteInventoryItem('${item.id}')" class="btn-icon-sm" title="删除"><i class="fas fa-trash"></i></button>` : ''}
                                ${item.status === 'available' ? `<button onclick="ShopAdmin.freezeInventoryItem('${item.id}', true)" class="btn-icon-sm" title="冻结"><i class="fas fa-ban"></i></button>` : ''}
                                ${item.status === 'frozen' ? `<button onclick="ShopAdmin.freezeInventoryItem('${item.id}', false)" class="btn-icon-sm" title="解冻"><i class="fas fa-check"></i></button>` : ''}
                                ${item.status === 'reserve' ? `<button onclick="ShopAdmin.releaseOne('${item.id}')" class="btn-icon-sm" title="上架"><i class="fas fa-rocket"></i></button>` : ''}
                                ${item.status === 'fault' ? `<button onclick="ShopAdmin.releaseOne('${item.id}')" class="btn-icon-sm" title="修复/上架"><i class="fas fa-wrench" style="color:#e879f9;"></i></button>` : ''}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            // Calculate total for pagination
            // Calculate total for pagination
            const total = (stats.reserve || 0) + (stats.available || 0) + (stats.sold || 0) + (stats.frozen || 0) + (stats.fault || 0);
            this.renderPagination('inventoryPagination', page, total, this.pageSize, 'loadInventoryList');

            // Enable horizontal scroll with mouse wheel for mobile
            const invTableContainer = document.querySelector('#shop-view-inventory .shop-table-container');
            if (invTableContainer && window.enableHorizontalScroll) {
                window.enableHorizontalScroll(invTableContainer);
            }

        } catch (err) {
            console.error('[ShopAdmin] Load inventory error:', err);
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:#ef4444;">加载失败: ${err.message}</td></tr>`;
        }
    },

    getStatusBadge: function (status) {
        const badges = {
            'reserve': '<span style="background:rgba(107,158,206,0.2);color:#bfdbfe;padding:3px 10px;border-radius:20px;font-size:12px;"><i class="fas fa-archive"></i> 储备</span>',
            'available': '<span style="background:rgba(16,185,129,0.2);color:#34d399;padding:3px 10px;border-radius:20px;font-size:12px;"><i class="fas fa-check-circle"></i> 在售</span>',
            'sold': '<span style="background:rgba(239,68,68,0.2);color:#f87171;padding:3px 10px;border-radius:20px;font-size:12px;"><i class="fas fa-shopping-cart"></i> 已售</span>',
            'frozen': '<span style="background:rgba(245,158,11,0.2);color:#fbbf24;padding:3px 10px;border-radius:20px;font-size:12px;"><i class="fas fa-ban"></i> 冻结</span>',
            'fault': '<span style="background:rgba(192,132,252,0.2);color:#e879f9;padding:3px 10px;border-radius:20px;font-size:12px;"><i class="fas fa-exclamation-triangle"></i> 故障</span>' // Purple badge
        };
        return badges[status] || status;
    },

    toggleSelectAll: function (checkbox) {
        document.querySelectorAll('.inv-checkbox').forEach(cb => cb.checked = checkbox.checked);
        this.updateSelectionCount();
    },

    updateSelectionCount: function () {
        const selected = document.querySelectorAll('.inv-checkbox:checked').length;
        // Update batch menu count
        const batchNumEl = document.getElementById('batchSelectedCount');
        if (batchNumEl) {
            batchNumEl.textContent = selected;
        }
    },

    deleteInventoryItem: async function (id) {
        if (!confirm('确定删除此库存项？')) return;
        try {
            const { error } = await supabaseClient.from('shop_inventory').delete().eq('id', id);
            if (error) throw error;
            this.loadInventoryList(this.inventoryPage);
        } catch (err) {
            alert('删除失败: ' + err.message);
        }
    },

    freezeInventoryItem: async function (id, freeze) {
        try {
            const { error } = await supabaseClient.from('shop_inventory').update({ status: freeze ? 'frozen' : 'available' }).eq('id', id);
            if (error) throw error;
            this.loadInventoryList(this.inventoryPage);
        } catch (err) {
            alert('操作失败: ' + err.message);
        }
    },

    releaseOne: async function (id) {
        try {
            const { error } = await supabaseClient.from('shop_inventory').update({ status: 'available' }).eq('id', id);
            if (error) throw error;
            this.loadInventoryList(this.inventoryPage);
        } catch (err) {
            alert('上架失败: ' + err.message);
        }
    },

    // Copy content with visual feedback
    toggleSelectionClick: function (el) {
        if (!this.isSelectionMode) return false;
        const tr = el.closest('tr');
        if (tr) {
            const cb = tr.querySelector('.inv-checkbox');
            if (cb) {
                cb.checked = !cb.checked;
                this.updateSelectionCount();
            }
        }
        return true;
    },

    copyContent: function (element, event) {
        // Fix: In selection mode, clicking toggles selection instead of copying
        if (this.toggleSelectionClick(element)) {
            if (event) event.stopPropagation();
            return;
        }

        event.stopPropagation();
        const content = element.dataset.content;
        navigator.clipboard.writeText(content).then(() => {
            // Visual feedback
            const originalBg = element.style.background;
            const originalText = element.textContent;
            element.style.background = 'rgba(16, 185, 129, 0.2)';
            element.innerHTML = '<i class="fas fa-check" style="color:#10b981;"></i> 已复制';
            setTimeout(() => {
                element.style.background = originalBg;
                element.textContent = originalText;
            }, 1000);
        }).catch(err => {
            console.error('Copy failed:', err);
            alert('复制失败');
        });
    },

    // Copy list content
    copyListContent: function (btn) {
        if (event) event.stopPropagation();
        const content = btn.dataset.content;
        navigator.clipboard.writeText(content).then(() => {
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => btn.innerHTML = originalHtml, 1500);
        });
    },

    // Export list content
    exportListContent: function (btn, filename) {
        if (event) event.stopPropagation();
        const content = btn.dataset.content;
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'export.txt';
        a.click();
        URL.revokeObjectURL(url);
    },

    // Open Fault Marking Modal
    openFaultModal: function (itemId) {
        const modalHtml = `
            <div id="markFaultModal" onclick="if(event.target.id==='markFaultModal')this.remove()" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);z-index:9999;display:flex;justify-content:center;align-items:center;">
                <div style="background:rgba(30,35,50,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:25px;width:400px;">
                    <h3 style="margin:0 0 20px 0;color:#fff;"><i class="fas fa-exclamation-triangle" style="color:#ef4444;"></i> 标记故障</h3>
                    
                    <div style="margin-bottom:15px;">
                        <label style="display:block;color:#888;font-size:12px;margin-bottom:5px;">故障说明 / 备注</label>
                        <textarea id="faultRemarkInput" style="width:100%;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.1);color:#fff;border-radius:6px;padding:10px;height:80px;resize:none;" placeholder="请输入故障原因..."></textarea>
                    </div>
                    
                    <div style="display:flex;justify-content:flex-end;gap:10px;">
                        <button onclick="document.getElementById('markFaultModal').remove()" style="padding:8px 16px;background:none;border:1px solid rgba(255,255,255,0.2);color:#ccc;border-radius:6px;cursor:pointer;">取消</button>
                        <button onclick="ShopAdmin.submitFault('${itemId}')" style="padding:8px 16px;background:#ef4444;border:none;color:#fff;border-radius:6px;cursor:pointer;">确认标记</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        setTimeout(() => document.getElementById('faultRemarkInput').focus(), 100);
    },

    submitFault: async function (itemId) {
        const remark = document.getElementById('faultRemarkInput').value.trim();
        // Allow empty remark if just marking as fault? Usually user wants to verify reason.
        if (!remark) {
            alert('请输入故障原因');
            return;
        }

        try {
            const { error } = await supabaseClient
                .from('shop_inventory')
                .update({
                    status: 'fault',
                    remark: remark
                })
                .eq('id', itemId);

            if (error) throw error;

            document.getElementById('markFaultModal').remove();

            // Reload list
            this.loadInventoryList(this.inventoryPage);

        } catch (err) {
            console.error(err);
            alert('操作失败: ' + (err.message || '未知错误'));
        }
    },

    // Show inventory detail modal
    showInventoryDetail: async function (inventoryId) {
        // Find item in current data first
        let item = this.inventoryData.find(i => i.id === inventoryId);

        // Build modal content
        let modalHtml = `
            <div id="inventoryDetailModal" onclick="if(event.target.id==='inventoryDetailModal')this.remove()" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);z-index:9999;display:flex;justify-content:center;align-items:center;">
                <div style="background:rgba(30,35,50,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:25px;width:500px;max-width:90%;max-height:80vh;overflow-y:auto;" class="custom-scrollbar">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                        <h3 style="margin:0;color:#fff;"><i class="fas fa-info-circle" style="color:#6b9ece;"></i> 库存详情</h3>
                        <button onclick="document.getElementById('inventoryDetailModal').remove()" style="background:none;border:none;color:#888;font-size:20px;cursor:pointer;">&times;</button>
                    </div>
                    <div id="detailContent" style="color:#e2e8f0;">
                        <div style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        try {
            // Fetch detailed info - only join shop_products (profiles doesn't have FK from inventory)
            const { data: invData, error: invError } = await supabaseClient
                .from('shop_inventory')
                .select('*, shop_products(name)')
                .eq('id', inventoryId)
                .single();

            if (invError) throw invError;

            // Get order info if sold
            let orderData = null;
            let historyItems = [];
            let sameOrderItems = [];
            // Fetch order if sold, frozen or fault (any status implying it was sold)
            if (['sold', 'frozen', 'fault'].includes(invData.status) || invData.buyer_id) {
                let fetchedOrder = null;

                // 1. Try direct link
                const { data: direct } = await supabaseClient
                    .from('shop_orders')
                    .select('*')
                    .eq('inventory_id', inventoryId)
                    .single();
                fetchedOrder = direct;

                // 2. Fallback: Lookup orphaned orders (same user, same product, null inventory_id)
                if (!fetchedOrder && invData.buyer_id) {
                    const { data: orphan } = await supabaseClient
                        .from('shop_orders')
                        .select('*')
                        .eq('user_id', invData.buyer_id)
                        .eq('product_id', invData.product_id)
                        .is('inventory_id', null)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single();
                    fetchedOrder = orphan;
                }

                if (fetchedOrder && fetchedOrder.user_id) {
                    const { data: user } = await supabaseClient
                        .from('profiles')
                        .select('email, username')
                        .eq('id', fetchedOrder.user_id)
                        .single();
                    if (user) fetchedOrder.profiles = user;
                }
                orderData = fetchedOrder;

                // Get related items (History & Same Order)
                const anchorTime = orderData?.created_at || invData.sold_at;
                const buyerId = orderData?.user_id || invData.buyer_id;

                if (buyerId) {
                    // 1. History (Same User, Same Product)
                    // 1. History (Same User, Same Product) - Query Inventory directly
                    const { data: historyInv } = await supabaseClient
                        .from('shop_inventory')
                        .select('id, content, sold_at')
                        .eq('buyer_id', buyerId)
                        .eq('product_id', invData.product_id)
                        .eq('status', 'sold')
                        .neq('id', inventoryId)
                        .order('sold_at', { ascending: false })
                        .limit(10);

                    if (historyInv) {
                        historyItems = historyInv.map(i => ({ shop_inventory: i }));
                    }

                    // 2. Same Order (Same User, Time +/- 60s) - Query Inventory directly
                    if (anchorTime) {
                        const t = new Date(anchorTime);
                        const tMin = new Date(t.getTime() - 60000).toISOString();
                        const tMax = new Date(t.getTime() + 60000).toISOString();

                        const { data: sameTimeInv } = await supabaseClient
                            .from('shop_inventory')
                            .select('id, content, sold_at')
                            .eq('buyer_id', buyerId)
                            .gte('sold_at', tMin)
                            .lte('sold_at', tMax)
                            .neq('id', inventoryId);

                        if (sameTimeInv) {
                            sameOrderItems = sameTimeInv.map(i => ({ shop_inventory: i }));
                        }
                    }
                }
            }

            // Build detail content
            const statusMap = { reserve: '储备', available: '在售', sold: '已售', frozen: '冻结' };
            const statusColors = { reserve: '#a5b4fc', available: '#34d399', sold: '#f87171', frozen: '#fbbf24' };

            let detailHtml = `
                <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:15px;margin-bottom:15px;">
                    <div style="color:#888;font-size:12px;margin-bottom:5px;">账号内容</div>
                    <div style="font-family:monospace;word-break:break-all;background:rgba(0,0,0,0.2);padding:10px;border-radius:8px;">${invData.content}</div>
                    <button onclick="navigator.clipboard.writeText('${this.escapeForAttr(invData.content)}');this.innerHTML='<i class=\\'fas fa-check\\'></i> 已复制';setTimeout(()=>this.innerHTML='<i class=\\'fas fa-copy\\'></i> 复制',1000);" 
                        style="margin-top:10px;background:rgba(107,158,206,0.2);border:1px solid rgba(107,158,206,0.3);color:#6b9ece;padding:6px 15px;border-radius:6px;cursor:pointer;">
                        <i class="fas fa-copy"></i> 复制
                    </button>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:15px;">
                    <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:12px;">
                        <div style="color:#888;font-size:11px;">商品</div>
                        <div style="font-weight:bold;">${invData.shop_products?.name || '-'}</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:12px;">
                        <div style="color:#888;font-size:11px;">状态</div>
                        <div style="color:${statusColors[invData.status]};font-weight:bold;">${statusMap[invData.status] || invData.status}</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:12px;">
                        <div style="color:#888;font-size:11px;">导入时间</div>
                        <div style="font-size:13px;">${new Date(invData.created_at).toLocaleString('zh-CN')}</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:12px;">
                        <div style="color:#888;font-size:11px;">批次</div>
                        <div style="font-size:13px;">${invData.batch_id || '-'}</div>
                    </div>
                </div>
                </div>
            `;

            // Fault Remark Display
            if (invData.remark) {
                detailHtml += `
                    <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:15px;margin-bottom:15px;">
                        <div style="color:#f87171;font-size:12px;margin-bottom:5px;font-weight:bold;"><i class="fas fa-exclamation-triangle"></i> 故障/备注</div>
                        <div style="color:#fca5a5;word-break:break-all;">${this.escapeHtml(invData.remark)}</div>
                    </div>
                `;
            }

            // Add order info if sold or frozen (with buyer)
            if (invData.buyer_id || invData.status === 'sold') {
                const buyerEmail = orderData?.profiles?.email || invData.buyer_email || invData.profiles?.email || '-';
                const orderId = orderData?.id || invData.order_id || null;
                const payTime = orderData?.created_at || invData.sold_at;
                const price = orderData?.price_paid !== undefined ? orderData.price_paid : '-';
                detailHtml += `
                    <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:15px;margin-top:15px;">
                        <div style="color:#94a3b8;font-weight:bold;margin-bottom:10px;"><i class="fas fa-shopping-cart"></i> 售出信息</div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                            <div style="background:rgba(239,68,68,0.1);border-radius:8px;padding:12px;">
                                <div style="color:#888;font-size:11px;">购买者</div>
                                <div style="font-size:13px;word-break:break-all;">${buyerEmail}</div>
                            </div>
                            <div style="background:rgba(239,68,68,0.1);border-radius:8px;padding:12px;">
                                <div style="color:#888;font-size:11px;">订单号</div>
                                <div style="font-size:12px;font-family:monospace;word-break:break-all;" title="${orderId || ''}">
                                    ${orderId ? orderId : '<span style="opacity:0.7">未找到关联订单</span>'}
                                </div>
                            </div>
                            <div style="background:rgba(239,68,68,0.1);border-radius:8px;padding:12px;">
                                <div style="color:#888;font-size:11px;">下单时间</div>
                                <div style="font-size:13px;">${payTime ? new Date(payTime).toLocaleString('zh-CN') : '-'}</div>
                            </div>
                            <div style="background:rgba(239,68,68,0.1);border-radius:8px;padding:12px;">
                                <div style="color:#888;font-size:11px;">支付积分</div>
                                <div style="font-size:13px;font-weight:bold;">${price}</div>
                            </div>
                        </div>
                    </div>
                `;

                // Add Same Order Items
                if (sameOrderItems.length > 0) {
                    detailHtml += `
                        <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:15px;margin-top:15px;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                                <div style="color:#fbbf24;font-weight:bold;"><i class="fas fa-layer-group"></i> 本次交易关联商品 (${sameOrderItems.length})</div>
                                <div style="display:flex;gap:5px;">
                                    <button onclick="ShopAdmin.copyListContent(this)" data-content="${this.escapeForAttr(sameOrderItems.map(i => i.shop_inventory?.content || '').join('\n'))}" 
                                        style="background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);color:#fbbf24;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">
                                        <i class="fas fa-copy"></i> 复制
                                    </button>
                                    <button onclick="ShopAdmin.exportListContent(this, 'sameday_orders.txt')" data-content="${this.escapeForAttr(sameOrderItems.map(i => i.shop_inventory?.content || '').join('\n'))}"
                                        style="background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);color:#fbbf24;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">
                                        <i class="fas fa-download"></i> 导出
                                    </button>
                                </div>
                            </div>
                            <div style="max-height:150px;overflow-y:auto;" class="custom-scrollbar">
                                ${sameOrderItems.map(r => `
                                    <div style="background:rgba(251,191,36,0.1);border-radius:6px;padding:8px 12px;margin-bottom:5px;font-size:12px;font-family:monospace;cursor:pointer;transition:all 0.2s;"
                                         onclick="navigator.clipboard.writeText('${this.escapeForAttr(r.shop_inventory?.content || '')}');this.style.background='rgba(16,185,129,0.2)';"
                                         title="点击复制">
                                        ${this.escapeHtml((r.shop_inventory?.content || '').split('----')[0])}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }

                // Add History Items
                if (historyItems.length > 0) {
                    detailHtml += `
                        <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:15px;margin-top:15px;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                                <div style="color:#818cf8;font-weight:bold;"><i class="fas fa-history"></i> 该买家购买历史 (${historyItems.length})</div>
                                <div style="display:flex;gap:5px;">
                                    <button onclick="ShopAdmin.copyListContent(this)" data-content="${this.escapeForAttr(historyItems.map(i => i.shop_inventory?.content || '').join('\n'))}"
                                        style="background:rgba(129,140,248,0.1);border:1px solid rgba(129,140,248,0.3);color:#818cf8;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">
                                        <i class="fas fa-copy"></i> 复制
                                    </button>
                                    <button onclick="ShopAdmin.exportListContent(this, 'order_history.txt')" data-content="${this.escapeForAttr(historyItems.map(i => i.shop_inventory?.content || '').join('\n'))}"
                                        style="background:rgba(129,140,248,0.1);border:1px solid rgba(129,140,248,0.3);color:#818cf8;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">
                                        <i class="fas fa-download"></i> 导出
                                    </button>
                                </div>
                            </div>
                            <div style="max-height:150px;overflow-y:auto;" class="custom-scrollbar">
                                ${historyItems.map(r => `
                                    <div style="background:rgba(99,102,241,0.1);border-radius:6px;padding:8px 12px;margin-bottom:5px;font-size:12px;font-family:monospace;cursor:pointer;transition:all 0.2s;"
                                         onclick="navigator.clipboard.writeText('${this.escapeForAttr(r.shop_inventory?.content || '')}');this.style.background='rgba(16,185,129,0.2)';"
                                         title="点击复制">
                                        ${this.escapeHtml((r.shop_inventory?.content || '').split('----')[0])}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }
            }

            document.getElementById('detailContent').innerHTML = detailHtml;

        } catch (err) {
            console.error('[ShopAdmin] Detail error:', err);
            document.getElementById('detailContent').innerHTML = `<div style="color:#ef4444;text-align:center;">加载失败: ${err.message}</div>`;
        }
    },

    // Release Reserve Modal
    openReleaseModal: async function () {
        const modal = document.getElementById('releaseReserveModal');
        const select = document.getElementById('releaseProductSelect');

        // Load products
        select.innerHTML = '<option value="">请选择商品</option>';
        const { data } = await supabaseClient.from('shop_products').select('id, name').order('name');
        if (data) {
            data.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                select.appendChild(opt);
            });
        }

        document.getElementById('releaseCount').value = '';
        document.getElementById('releaseBeforeDate').value = '';
        modal.style.display = 'flex';
    },

    closeReleaseModal: function () {
        document.getElementById('releaseReserveModal').style.display = 'none';
    },

    releaseReserve: async function () {
        const productId = document.getElementById('releaseProductSelect').value;
        const count = parseInt(document.getElementById('releaseCount').value) || null;
        const beforeDate = document.getElementById('releaseBeforeDate').value || null;

        if (!productId) { alert('请选择商品'); return; }
        if (!count && !beforeDate) { alert('请指定数量或日期'); return; }

        try {
            const { data, error } = await supabaseClient.rpc('fn_admin_release_reserve', {
                p_product_id: productId,
                p_count: count,
                p_before_date: beforeDate ? new Date(beforeDate).toISOString() : null
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.message);

            alert(data.message);
            this.closeReleaseModal();
            this.loadInventoryList(this.inventoryPage);
        } catch (err) {
            alert('释放失败: ' + err.message);
        }
    },

    // Import View Functions
    categoryData: [], // Dynamic category data from database
    contextMenuCategory: null, // Currently selected category for context menu

    // Load categories from database
    loadCategories: async function () {
        try {
            console.log('loadCategories: fetching from shop_categories...');
            const { data, error } = await supabaseClient
                .from('shop_categories')
                .select('*')
                .order('sort_order');

            console.log('loadCategories result:', { data, error });

            if (error) {
                // If table doesn't exist, use fallback hardcoded categories
                console.warn('shop_categories table error, using defaults:', error.message);
                this.categoryData = [
                    { id: 'account', name: 'account', color: '#6b9ece', sort_order: 0 },
                    { id: 'gemini', name: 'Gemini', color: '#f4b400', sort_order: 1 },
                    { id: 'other', name: 'other', color: '#9aa0a6', sort_order: 99 }
                ];
                return;
            }

            // If data is empty, also use fallback
            if (!data || data.length === 0) {
                console.warn('shop_categories table is empty, using defaults');
                this.categoryData = [
                    { id: 'account', name: 'account', color: '#6b9ece', sort_order: 0 },
                    { id: 'gemini', name: 'Gemini', color: '#f4b400', sort_order: 1 },
                    { id: 'other', name: 'other', color: '#9aa0a6', sort_order: 99 }
                ];
                return;
            }

            this.categoryData = data;
            console.log('loadCategories: loaded', this.categoryData.length, 'categories');
        } catch (e) {
            console.error('Failed to load categories:', e);
            this.categoryData = [
                { id: 'account', name: 'account', color: '#6b9ece', sort_order: 0 },
                { id: 'gemini', name: 'Gemini', color: '#f4b400', sort_order: 1 },
                { id: 'other', name: 'other', color: '#9aa0a6', sort_order: 99 }
            ];
        }
    },

    initImportView: async function () {
        // Target the tree container (new structure)
        const treeContainer = document.getElementById('importProductTree');
        // Clear and add loading state
        treeContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.4); font-size: 13px;">正在加载商品...</div>';

        // Reset selection
        document.getElementById('importViewProductId').value = '';
        document.getElementById('targetProductName').style.display = 'none';
        document.getElementById('targetProductName').textContent = '';

        try {
            // Load categories first
            await this.loadCategories();

            // Fetch active products
            const { data: activeData, error: activeError } = await supabaseClient.from('shop_products')
                .select('id, name, category, sort_order')
                .eq('is_active', true)
                .order('sort_order');

            if (activeError) throw activeError;

            // Fetch deleted products for recycle bin
            const { data: deletedData, error: deletedError } = await supabaseClient.from('shop_products')
                .select('id, name, category')
                .eq('is_active', false)
                .order('name');

            if (deletedError) throw deletedError;

            this.allProductsForImport = activeData || [];
            this.deletedProductsForImport = deletedData || [];
            this.renderImportList();

        } catch (e) {
            console.error('Failed to load products for import view', e);
            treeContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,100,100,0.6);">加载失败</div>';
        }
    },

    // Filter Import List
    filterImportList: function (categoryOrBtn, btnEl) {
        let category = categoryOrBtn;

        // Handle if called via button click (legacy/subtab)
        if (typeof categoryOrBtn !== 'string' && categoryOrBtn.tagName) {
            // It's an element, but wait, onclick="filter('gemini', this)" means arg1 is string, arg2 is el.
            // If onclick="filter(this.value)" from select, arg1 is string, arg2 undefined.
        }

        // Correct logic:
        // By default, categoryOrBtn is the Category String.
        // btnEl is optional (passed from button onclick).

        this.currentImportCategory = category;

        // Update Button UI (if relevant)
        if (btnEl) {
            if (window.updateImportFilterStyles) {
                window.updateImportFilterStyles(btnEl);
            } else {
                const container = btnEl.closest('.category-filters-small');
                if (container) {
                    const tabs = container.querySelectorAll('button');
                    tabs.forEach(t => t.classList.remove('active'));
                    btnEl.classList.add('active');
                }
            }
        }

        // Update Dropdown UI (if relevant)
        const dropdownLabel = document.getElementById('import-dropdown-label');
        if (dropdownLabel) {
            // Find label text map
            const map = { 'all': '全部', 'gemini': 'Gemini', 'chatgpt': 'ChatGPT', 'gmail': 'Gmail' };
            dropdownLabel.textContent = map[category] || '选择分类';
        }

        // Update selection in custom menu
        const menuItems = document.querySelectorAll('.custom-dropdown-menu .dropdown-item');
        menuItems.forEach(item => {
            if (item.onclick.toString().includes(`'${category}'`)) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        this.renderImportList();
    },

    // Custom Dropdown Logic
    toggleImportDropdown: function () {
        const menu = document.getElementById('custom-import-menu');
        if (menu) menu.classList.toggle('show');
    },

    selectImportCategory: function (category, label, itemEl) {
        const menu = document.getElementById('custom-import-menu');
        if (menu) menu.classList.remove('show');

        // Update Label
        const labelEl = document.getElementById('import-dropdown-label');
        if (labelEl) labelEl.textContent = label;

        // Update Active Item
        if (itemEl && itemEl.parentNode) {
            itemEl.parentNode.querySelectorAll('.capsule-menu-item').forEach(i => i.classList.remove('active'));
            itemEl.classList.add('active');
        }

        this.filterImportList(category);
    },

    // Inventory Subtab Dropdown Logic
    selectInvCategory: function (category, label, itemEl) {
        // Close menu
        const menu = document.getElementById('custom-inv-menu');
        if (menu) menu.classList.remove('show');

        // Update Label
        const labelEl = document.getElementById('inv-dropdown-label');
        if (labelEl) labelEl.textContent = label;

        // Update Active Item
        if (itemEl && itemEl.parentNode) {
            itemEl.parentNode.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('active'));
            itemEl.classList.add('active');
        }

        this.filterImportList(category);
    },

    // Render Import List from Cache
    renderImportList: function () {
        const treeContainer = document.getElementById('importProductTree');
        if (!treeContainer) return;

        // Save expanded state before clearing
        const expandedCategories = new Set();
        treeContainer.querySelectorAll('.tree-category.expanded').forEach(cat => {
            const key = cat.querySelector('.tree-category-header')?.dataset.category;
            if (key) expandedCategories.add(key);
        });

        treeContainer.innerHTML = '';

        // Initialize ALL categories from categoryData first (including empty ones)
        const categories = {};
        this.categoryData.forEach(cat => {
            categories[cat.name] = { name: cat.name, products: [] };
        });

        // Then group products into their categories
        this.allProductsForImport.forEach(p => {
            const cat = p.category || 'other';
            if (!categories[cat]) {
                // Product has a category not in categoryData, create it
                categories[cat] = { name: this.getCategoryLabel(cat), products: [] };
            }
            categories[cat].products.push(p);
        });

        // Sort products within each category by sort_order
        Object.values(categories).forEach(cat => {
            cat.products.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        });

        // Sort keys based on categoryData order, or alphabetically as fallback
        const categoryOrder = this.categoryData.map(c => c.name);
        const sortedKeys = Object.keys(categories).sort((a, b) => {
            const aIdx = categoryOrder.indexOf(a);
            const bIdx = categoryOrder.indexOf(b);
            // If both found, sort by order; if one not found, put it at end
            if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
            if (aIdx >= 0) return -1;
            if (bIdx >= 0) return 1;
            return a.localeCompare(b);
        });

        if (sortedKeys.length === 0) {
            treeContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.4);">暂无商品</div>';
            return;
        }

        sortedKeys.forEach((catKey, index) => {
            const cat = categories[catKey];
            const catDiv = document.createElement('div');
            // Restore expanded state, or default first category as expanded on initial load
            const shouldExpand = expandedCategories.size > 0 ? expandedCategories.has(catKey) : (index === 0);
            catDiv.className = 'tree-category' + (shouldExpand ? ' expanded' : '');
            catDiv.dataset.category = catKey;

            // Category Header - Drop Zone
            const header = document.createElement('div');
            header.className = 'tree-category-header';
            header.dataset.category = catKey;

            // Get dynamic color for this category
            const folderColor = this.getCategoryColor(catKey);

            header.innerHTML = `
                <i class="fas fa-chevron-right tree-chevron"></i>
                <i class="fas fa-folder tree-folder-icon" style="color: ${folderColor};"></i>
                <span class="tree-category-name">${cat.name}</span>
                <span class="tree-category-count">${cat.products.length}</span>
            `;
            header.onclick = (e) => {
                if (!e.defaultPrevented) this.toggleTreeCategory(catDiv);
            };

            // Right-click context menu
            header.oncontextmenu = (e) => this.showCategoryContextMenu(e, catKey);

            // Touch long-press for mobile context menu
            let longPressTimer = null;
            let touchStartX = 0;
            let touchStartY = 0;

            header.addEventListener('touchstart', (e) => {
                const touch = e.touches[0];
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;

                longPressTimer = setTimeout(() => {
                    // Prevent the click event from firing
                    e.preventDefault();
                    // Create a synthetic event with touch coordinates
                    const syntheticEvent = {
                        preventDefault: () => { },
                        stopPropagation: () => { },
                        clientX: touchStartX,
                        clientY: touchStartY
                    };
                    this.showCategoryContextMenu(syntheticEvent, catKey);
                    // Add haptic feedback if available
                    if (navigator.vibrate) {
                        navigator.vibrate(50);
                    }
                }, 500); // 500ms long press threshold
            }, { passive: false });

            header.addEventListener('touchmove', (e) => {
                // Cancel if finger moved too much
                const touch = e.touches[0];
                const moveThreshold = 10;
                if (Math.abs(touch.clientX - touchStartX) > moveThreshold ||
                    Math.abs(touch.clientY - touchStartY) > moveThreshold) {
                    if (longPressTimer) {
                        clearTimeout(longPressTimer);
                        longPressTimer = null;
                    }
                }
            });

            header.addEventListener('touchend', () => {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            });

            header.addEventListener('touchcancel', () => {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            });

            // Drop zone events
            header.ondragover = (e) => {
                e.preventDefault();
                header.classList.add('drag-over');
            };
            header.ondragleave = () => {
                header.classList.remove('drag-over');
            };
            header.ondrop = (e) => {
                e.preventDefault();
                header.classList.remove('drag-over');
                const productId = e.dataTransfer.getData('text/plain');
                const targetCategory = header.dataset.category;
                this.moveProductToCategory(productId, targetCategory);
            };

            // Children Container (Sortable)
            const children = document.createElement('div');
            children.className = 'tree-children';
            children.dataset.category = catKey;

            // Make children container a drop zone for reordering
            children.ondragover = (e) => {
                e.preventDefault();
                const draggingItem = treeContainer.querySelector('.tree-product-item.dragging');
                if (!draggingItem) return;

                const afterElement = this.getDragAfterElement(children, e.clientY);
                const indicator = children.querySelector('.drop-indicator');

                // Remove existing indicator
                if (indicator) indicator.remove();

                // Create new indicator
                const newIndicator = document.createElement('div');
                newIndicator.className = 'drop-indicator';

                if (afterElement) {
                    children.insertBefore(newIndicator, afterElement);
                } else {
                    children.appendChild(newIndicator);
                }
            };

            children.ondragleave = (e) => {
                // Only remove if leaving the container entirely
                if (!children.contains(e.relatedTarget)) {
                    const indicator = children.querySelector('.drop-indicator');
                    if (indicator) indicator.remove();
                }
            };

            children.ondrop = (e) => {
                e.preventDefault();
                e.stopPropagation();

                const indicator = children.querySelector('.drop-indicator');
                if (indicator) indicator.remove();

                const productId = e.dataTransfer.getData('text/plain');
                const targetCategory = children.dataset.category;
                const afterElement = this.getDragAfterElement(children, e.clientY);

                // Get the ID of the element we're dropping before (if any)
                const beforeId = afterElement ? afterElement.dataset.id : null;

                this.reorderProduct(productId, targetCategory, beforeId);
            };

            cat.products.forEach((p, idx) => {
                const item = document.createElement('div');
                item.className = 'tree-product-item';
                item.dataset.id = p.id;
                item.dataset.name = p.name;
                item.dataset.sortOrder = p.sort_order || idx;
                item.draggable = true;

                // Drag events
                item.ondragstart = (e) => {
                    e.dataTransfer.setData('text/plain', p.id);
                    e.dataTransfer.effectAllowed = 'move';
                    item.classList.add('dragging');
                    setTimeout(() => item.style.opacity = '0.4', 0);
                };
                item.ondragend = () => {
                    item.classList.remove('dragging');
                    item.style.opacity = '';
                    // Clean up any remaining indicators
                    document.querySelectorAll('.drop-indicator').forEach(i => i.remove());
                };

                item.onclick = () => this.selectImportProduct(p.id, p.name);
                item.innerHTML = `
                    <i class="fas fa-grip-vertical tree-drag-handle"></i>
                    <i class="fas fa-file-alt tree-product-icon"></i>
                    <span class="tree-product-name">${p.name}</span>
                `;
                children.appendChild(item);
            });

            catDiv.appendChild(header);
            catDiv.appendChild(children);
            treeContainer.appendChild(catDiv);
        });

        // Add Recycle Bin folder at the end (for deleted products)
        if (this.deletedProductsForImport && this.deletedProductsForImport.length > 0) {
            const recycleBinDiv = document.createElement('div');
            const isRecycleBinExpanded = expandedCategories.has('__recycle_bin__');
            recycleBinDiv.className = 'tree-category recycle-bin-category' + (isRecycleBinExpanded ? ' expanded' : '');
            recycleBinDiv.dataset.category = '__recycle_bin__';

            const recycleBinHeader = document.createElement('div');
            recycleBinHeader.className = 'tree-category-header recycle-bin-header';
            recycleBinHeader.dataset.category = '__recycle_bin__';
            recycleBinHeader.innerHTML = `
                <i class="fas fa-chevron-right tree-chevron"></i>
                <i class="fas fa-trash tree-folder-icon" style="color: #ef4444;"></i>
                <span class="tree-category-name" style="color: rgba(255,255,255,0.5);">回收站</span>
                <span class="tree-category-count" style="background:rgba(239, 68, 68, 0.2); color:#ef4444;">${this.deletedProductsForImport.length}</span>
            `;
            recycleBinHeader.onclick = () => this.toggleTreeCategory(recycleBinDiv);

            const recycleBinChildren = document.createElement('div');
            recycleBinChildren.className = 'tree-children';
            recycleBinChildren.dataset.category = '__recycle_bin__';

            this.deletedProductsForImport.forEach(p => {
                const item = document.createElement('div');
                item.className = 'tree-product-item deleted-product';
                item.dataset.id = p.id;
                item.dataset.name = p.name;
                item.style.opacity = '0.6';
                item.onclick = () => this.selectImportProduct(p.id, p.name);
                item.innerHTML = `
                    <i class="fas fa-file-alt tree-product-icon" style="color: #ef4444;"></i>
                    <span class="tree-product-name">${p.name}</span>
                `;
                recycleBinChildren.appendChild(item);
            });

            recycleBinDiv.appendChild(recycleBinHeader);
            recycleBinDiv.appendChild(recycleBinChildren);
            treeContainer.appendChild(recycleBinDiv);
        }
    },

    // Helper: Get element after which to insert the dragged item
    getDragAfterElement: function (container, y) {
        const draggableElements = [...container.querySelectorAll('.tree-product-item:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;

            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    },

    // Reorder product within or across categories
    reorderProduct: async function (productId, targetCategory, beforeId) {
        if (!productId) return;

        const product = this.allProductsForImport.find(p => p.id === productId);
        if (!product) return;

        // Skip if same category and no reorder needed
        const isMovingCategory = product.category !== targetCategory;

        // Get products in target category (excluding the dragged one)
        const categoryProducts = this.allProductsForImport
            .filter(p => p.category === targetCategory && p.id !== productId)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

        // Find insertion index
        let insertIndex = categoryProducts.length;
        if (beforeId) {
            const beforeIndex = categoryProducts.findIndex(p => p.id === beforeId);
            if (beforeIndex !== -1) insertIndex = beforeIndex;
        }

        // Insert product at new position
        categoryProducts.splice(insertIndex, 0, product);

        // Update local sort orders
        categoryProducts.forEach((p, idx) => {
            p.sort_order = idx;
        });

        try {
            // Only update database if category changed
            if (isMovingCategory) {
                await supabaseClient
                    .from('shop_products')
                    .update({ category: targetCategory })
                    .eq('id', productId);
            }

            // Update local cache
            product.category = targetCategory;

            // Re-render (uses local sort_order)
            this.renderImportList();

        } catch (e) {
            console.error('Failed to reorder:', e);
            alert('操作失败: ' + e.message);
        }
    },

    getCategoryLabel: function (key) {
        // Check dynamic categoryData first
        const cat = this.categoryData.find(c => c.name === key || c.id === key);
        if (cat) return cat.name;
        // Fallback labels for legacy keys
        const labels = { gemini: 'Gemini', chatgpt: 'ChatGPT', gmail: 'Gmail', other: '其他' };
        return labels[key] || key;
    },

    getCategoryColor: function (key) {
        const cat = this.categoryData.find(c => c.name === key || c.id === key);
        if (cat) return cat.color || '#6b9ece';
        // Fallback colors
        const colors = { gemini: '#f4b400', chatgpt: '#74aa9c', gmail: '#ea4335', other: '#9aa0a6' };
        return colors[key] || '#6b9ece';
    },

    toggleTreeCategory: function (catDiv) {
        catDiv.classList.toggle('expanded');
    },

    // Show context menu for category
    showCategoryContextMenu: function (e, categoryKey) {
        e.preventDefault();
        e.stopPropagation();

        this.contextMenuCategory = categoryKey;
        const menu = document.getElementById('categoryContextMenu');
        if (!menu) return;

        // Show menu first to measure its dimensions
        menu.classList.add('show');

        // Get viewport dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const menuRect = menu.getBoundingClientRect();

        // Calculate position, ensuring menu stays within viewport
        let left = e.clientX;
        let top = e.clientY;

        // Adjust horizontal position if menu would overflow right edge
        if (left + menuRect.width > viewportWidth - 10) {
            left = viewportWidth - menuRect.width - 10;
        }

        // Adjust vertical position if menu would overflow bottom edge
        if (top + menuRect.height > viewportHeight - 10) {
            top = viewportHeight - menuRect.height - 10;
        }

        // Ensure minimum position
        left = Math.max(10, left);
        top = Math.max(10, top);

        menu.style.left = left + 'px';
        menu.style.top = top + 'px';

        // Highlight current color
        const currentColor = this.getCategoryColor(categoryKey);
        menu.querySelectorAll('.color-option').forEach(opt => {
            opt.classList.toggle('selected', opt.style.background === currentColor);
        });

        // Close on click or touch outside
        const closeHandler = (evt) => {
            if (!menu.contains(evt.target)) {
                menu.classList.remove('show');
                document.removeEventListener('click', closeHandler);
                document.removeEventListener('touchstart', closeHandler);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeHandler);
            document.addEventListener('touchstart', closeHandler, { passive: true });
        }, 10);
    },

    // Create new category
    showCreateCategoryDialog: function () {
        const name = prompt('请输入新分类名称:');
        if (!name || !name.trim()) return;

        this.createCategory(name.trim());
    },

    createCategory: async function (name) {
        try {
            const { data, error } = await supabaseClient
                .from('shop_categories')
                .insert({ name: name, color: '#6b9ece', sort_order: this.categoryData.length })
                .select()
                .single();

            if (error) throw error;

            this.categoryData.push(data);
            this.renderImportList();
        } catch (e) {
            console.error('Failed to create category:', e);
            alert('创建失败: ' + e.message);
        }
    },

    // Rename category from context menu
    renameCategoryFromMenu: function () {
        const key = this.contextMenuCategory;
        if (!key) return;

        const cat = this.categoryData.find(c => c.name === key || c.id === key);
        const currentName = cat ? cat.name : key;

        const newName = prompt('重命名分类:', currentName);
        if (!newName || !newName.trim() || newName.trim() === currentName) {
            document.getElementById('categoryContextMenu')?.classList.remove('show');
            return;
        }

        this.renameCategory(key, newName.trim());
        document.getElementById('categoryContextMenu')?.classList.remove('show');
    },

    renameCategory: async function (oldKey, newName) {
        const cat = this.categoryData.find(c => c.name === oldKey || c.id === oldKey);
        if (!cat) return;

        try {
            // Update category name
            const { error: catError } = await supabaseClient
                .from('shop_categories')
                .update({ name: newName })
                .eq('id', cat.id);

            if (catError) throw catError;

            // Update all products with this category
            const { error: prodError } = await supabaseClient
                .from('shop_products')
                .update({ category: newName })
                .eq('category', cat.name);

            if (prodError) console.warn('Failed to update products:', prodError);

            // Update local data
            cat.name = newName;
            this.allProductsForImport.forEach(p => {
                if (p.category === oldKey) p.category = newName;
            });

            this.renderImportList();
        } catch (e) {
            console.error('Failed to rename category:', e);
            alert('重命名失败: ' + e.message);
        }
    },

    // Set category color
    setCategoryColor: async function (color) {
        const key = this.contextMenuCategory;
        if (!key) return;

        const cat = this.categoryData.find(c => c.name === key || c.id === key);
        if (!cat) return;

        try {
            const { error } = await supabaseClient
                .from('shop_categories')
                .update({ color: color })
                .eq('id', cat.id);

            if (error) throw error;

            cat.color = color;
            this.renderImportList();
        } catch (e) {
            console.error('Failed to set color:', e);
        }

        document.getElementById('categoryContextMenu')?.classList.remove('show');
    },

    // Delete category
    deleteCategoryFromMenu: function () {
        const key = this.contextMenuCategory;
        if (!key) return;

        const cat = this.categoryData.find(c => c.name === key || c.id === key);
        if (!cat) return;

        const productCount = this.allProductsForImport.filter(p => p.category === cat.name).length;
        const msg = productCount > 0
            ? `确定删除分类"${cat.name}"吗？\n其中的 ${productCount} 个商品将移动到"other"分类。`
            : `确定删除分类"${cat.name}"吗？`;

        if (!confirm(msg)) {
            document.getElementById('categoryContextMenu')?.classList.remove('show');
            return;
        }

        this.deleteCategory(cat);
        document.getElementById('categoryContextMenu')?.classList.remove('show');
    },

    deleteCategory: async function (cat) {
        try {
            // Move products to 'other'
            const { error: prodError } = await supabaseClient
                .from('shop_products')
                .update({ category: 'other' })
                .eq('category', cat.name);

            if (prodError) console.warn('Failed to move products:', prodError);

            // Delete the category
            const { error } = await supabaseClient
                .from('shop_categories')
                .delete()
                .eq('id', cat.id);

            if (error) throw error;

            // Update local data
            this.categoryData = this.categoryData.filter(c => c.id !== cat.id);
            this.allProductsForImport.forEach(p => {
                if (p.category === cat.name) p.category = 'other';
            });

            this.renderImportList();
        } catch (e) {
            console.error('Failed to delete category:', e);
            alert('删除失败: ' + e.message);
        }
    },

    // Move product to different category (Drag & Drop)
    moveProductToCategory: async function (productId, targetCategory) {
        if (!productId || !targetCategory) return;

        // Find current product info
        const product = this.allProductsForImport.find(p => p.id === productId);
        if (!product) return;

        // Skip if same category
        if (product.category === targetCategory) return;

        try {
            // Update in database
            const { error } = await supabaseClient
                .from('shop_products')
                .update({ category: targetCategory })
                .eq('id', productId);

            if (error) throw error;

            // Update local cache
            product.category = targetCategory;

            // Re-render tree
            this.renderImportList();

            // Show toast/feedback
            console.log(`Moved "${product.name}" to ${this.getCategoryLabel(targetCategory)}`);
        } catch (e) {
            console.error('Failed to move product:', e);
            alert('移动失败: ' + e.message);
        }
    },

    selectImportProduct: function (id, name) {
        // Update hidden input
        document.getElementById('importViewProductId').value = id;

        // Update UI Badge
        const badge = document.getElementById('selectedProductBadge');
        badge.textContent = name;
        badge.style.display = 'inline-block';

        // Update Tree UI
        document.querySelectorAll('.tree-product-item').forEach(item => {
            if (item.dataset.id == id) {
                item.classList.add('selected');
                // Ensure parent category is expanded
                const parent = item.closest('.tree-category');
                if (parent) parent.classList.add('expanded');
            } else {
                item.classList.remove('selected');
            }
        });
    },

    doImportFromView: async function () {
        const productId = document.getElementById('importViewProductId').value;
        const content = document.getElementById('importViewContentInput').value;
        const status = document.querySelector('input[name="importViewStatus"]:checked').value;

        if (!productId) { alert('请先在左侧选择商品'); return; }
        if (!content.trim()) { alert('请输入账号内容'); return; }

        const contentLines = content.split('\n').map(l => l.trim()).filter(l => l);
        if (contentLines.length === 0) return;

        // Generate batch ID
        const date = new Date();
        const batchId = date.getFullYear().toString().slice(-2) +
            (date.getMonth() + 1).toString().padStart(2, '0') +
            date.getDate().toString().padStart(2, '0') +
            date.getHours().toString().padStart(2, '0') +
            date.getMinutes().toString().padStart(2, '0');

        try {
            const { data, error } = await supabaseClient.rpc('fn_import_inventory', {
                p_product_id: productId,
                p_content_list: contentLines,
                p_batch_id: batchId,
                p_status: status
            });

            if (error) throw error;

            alert(`成功导入 ${contentLines.length} 个账号\n批次号: ${batchId}`);

            // Clear input
            document.getElementById('importViewContentInput').value = '';
            document.getElementById('importViewLineCount').textContent = '(0个)';

            // Note: We don't clear selection so user can continue importing if needed.

        } catch (err) {
            console.error('Import error:', err);
            alert('导入失败: ' + err.message);
        }
    },


    // Export to Excel
    exportInventory: async function (onlySelected = false) {
        if (!window.XLSX) {
            alert('Excel导出库未加载，请刷新页面重试');
            return;
        }

        try {
            let items = [];
            let filenamePrefix = '库存导出';

            if (onlySelected) {
                const selectedIds = Array.from(document.querySelectorAll('.inv-checkbox:checked')).map(cb => cb.dataset.id);
                if (selectedIds.length === 0) {
                    alert('请先选择要导出的库存项');
                    return;
                }
                // Filter from currently loaded data
                items = this.inventoryData.filter(item => selectedIds.includes(item.id));
                filenamePrefix = '库存导出_选中';

                // Close menu
                const menu = document.getElementById('batchActionMenu');
                if (menu) menu.style.display = 'none';

            } else {
                const productId = document.getElementById('invFilterProduct')?.value || null;
                const status = document.getElementById('invFilterStatus')?.value || null;

                // Get all data (no pagination for export)
                const { data, error } = await supabaseClient.rpc('fn_admin_list_inventory', {
                    p_product_id: productId || null,
                    p_status: status || null,
                    p_search: null,
                    p_page: 1,
                    p_page_size: 10000
                });

                if (error) throw error;
                items = data.items || [];
                const statusName = status ? { reserve: '储备', available: '在售', sold: '已售', frozen: '冻结' }[status] : '全部';
                filenamePrefix = `库存导出_${statusName}`;
            }

            if (items.length === 0) {
                alert('没有可导出的数据');
                return;
            }

            // Patch missing Order IDs (Orphaned Orders Check)
            // Some old orders lost the inventory_id link. We attempt to find them by User+Product.
            const missingOrdItems = items.filter(i => i.status === 'sold' && !i.order_id && i.buyer_id);
            if (missingOrdItems.length > 0 && missingOrdItems.length < 200) { // Limit to batch size to avoid URL overflow
                try {
                    const buyerIds = [...new Set(missingOrdItems.map(i => i.buyer_id))];
                    const productIds = [...new Set(missingOrdItems.map(i => i.product_id))];

                    const { data: orphans } = await supabaseClient
                        .from('shop_orders')
                        .select('id, user_id, product_id, created_at')
                        .in('user_id', buyerIds)
                        .in('product_id', productIds) // Optimization
                        .is('inventory_id', null)
                        .order('created_at', { ascending: false });

                    if (orphans) {
                        // Greedy match
                        const orphanPool = [...orphans];
                        missingOrdItems.forEach(item => {
                            const matchIdx = orphanPool.findIndex(o =>
                                o.user_id === item.buyer_id &&
                                o.product_id === item.product_id
                            );
                            if (matchIdx !== -1) {
                                item.order_id = orphanPool[matchIdx].id;
                                orphanPool.splice(matchIdx, 1); // Consume one
                            }
                        });
                    }
                } catch (e) {
                    console.warn('[Export] Failed to patch orphans:', e);
                }
            }

            // Format for Excel
            const statusMap = { available: '在售', sold: '已售', frozen: '冻结', reserve: '储备' };
            const excelData = items.map(item => ({
                '商品': item.product_name || item.shop_products?.name || '-',
                '账号内容': item.content,
                '状态': statusMap[item.status] || item.status,
                '导入时间': item.created_at ? new Date(item.created_at).toLocaleString() : '-',
                '售出时间': item.sold_at ? new Date(item.sold_at).toLocaleString() : '-',
                '买家邮箱': item.buyer_email || item.profiles?.email || '-',
                '订单号': item.order_id || '-',
                '批次': item.batch_id || '-'
            }));

            const ws = XLSX.utils.json_to_sheet(excelData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '库存列表');

            XLSX.writeFile(wb, `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
        } catch (err) {
            console.error(err);
            alert('导出失败: ' + err.message);
        }
    },

    // Orders Export
    exportOrders: async function () {
        if (!window.XLSX) { alert('Excel导出库未加载'); return; }

        try {
            const { data, error } = await supabaseClient.from('shop_orders').select(`
                id, created_at, price_paid, snapshot_product_name, refund_status, user_id
            `).order('created_at', { ascending: false }).limit(1000);

            if (error) throw error;

            // Fetch Profiles Manually
            const userIds = [...new Set(data.map(o => o.user_id))];
            let userMap = {};
            if (userIds.length > 0) {
                const { data: users } = await supabaseClient
                    .from('profiles')
                    .select('id, email, display_name')
                    .in('id', userIds);
                if (users) {
                    users.forEach(u => userMap[u.id] = u);
                }
            }

            const rows = data.map((o, idx) => {
                const profile = userMap[o.user_id] || {};
                return {
                    '序号': idx + 1,
                    '订单号': o.id,
                    '商品': o.snapshot_product_name || '',
                    '支付积分': o.price_paid,
                    '买家邮箱': profile.email || '',
                    '退款状态': o.refund_status === 'refunded' ? '已退款' : '正常',
                    '下单时间': new Date(o.created_at).toLocaleString('zh-CN')
                };
            });

            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '订单列表');
            XLSX.writeFile(wb, `订单导出_${new Date().toISOString().slice(0, 10)}.xlsx`);
        } catch (err) {
            alert('导出失败: ' + err.message);
        }
    }
};

window.ShopAdmin = ShopAdmin;
